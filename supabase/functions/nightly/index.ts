// Boussole : fonction nocturne.
//
// Appelée par pg_cron (job `boussole-nightly`, 20:30 UTC) via pg_net, avec
// `Authorization: Bearer <jeton>` où le jeton est lu dans Supabase Vault (`nightly_token`).
// Déployée avec verify_jwt = false : l'authentification est faite ici, par
// public.check_nightly_token() (exécutable par le rôle service uniquement).
//
// Étapes, de la plus importante à la moins urgente (la plateforme coupe la fonction à 150 s) :
// 1. cours Yahoo, repli Euronext → instruments (en EUR, source yahoo | euronext) ; les clôtures lues (5 derniers jours Yahoo,
//    14 derniers jours Euronext) sont enregistrées dans `cours` (upsert sur (isin, date), par paquets de 500) ; boucle bornée :
//    aucun nouveau cours après 70 s écoulées (les cours restants sont reportés et signalés) ;
// 2. take_snapshots() ; apply_recurring() ; take_snapshots() (la photo du jour inclut les versements, appliqués seulement
//    le jour exact : ils ne doivent jamais être perdus) ;
// 3. Binance en lecture seule (binance.ts, spec CP1 § 7) : seulement si BINANCE_API_KEY et BINANCE_API_SECRET existent et
//    qu'un seul utilisateur a fonctionnalites(binance) active, et s'il reste assez de temps (sinon reporté et noté) ;
//    quantités des lignes de l'enveloppe « Crypto (Binance) » (reprises par la photo de la nuit suivante) ;
//    une erreur Binance est journalisée (message traduit, jamais de secret) et n'arrête pas la nuit ;
// 4. rattrapage de l'historique (spec CP1 § 4) : au plus 10 ISIN par nuit, d'abord les ISIN dont les mouvements importés (HIS2) remontent plus
//    loin que les cours stockés (photos.ts : plage « max » au-delà de 5 ans), puis ceux de la RPC cours_a_rattraper (détenus, moins de 30
//    cours) ; 5 ans quotidiens (Yahoo range=5y&interval=1d sur le symbole déjà résolu, sinon CSV historique Euronext), upsert par
//    paquets ; instruments.cours_rattrapage_le marque chaque tentative (nouvel essai au plus tôt 7 jours après) ; aucun
//    nouveau rattrapage après 110 s écoulées (le reste est reporté à la nuit suivante) ; des cours anciens arrivés demandent le recalcul
//    des photos des utilisateurs concernés (status.historique_a_recalculer) ;
// 4 bis. photos reconstituées (HIS2, photos.ts) : pour chaque utilisateur dont status.historique_a_recalculer est posé, le passé en fins de
//    mois est recalculé avec le moteur de l'app (historique.gen.js) et écrit dans photos_reconstituees (jamais à partir de la première photo
//    observée) ; aucun nouvel utilisateur après 100 s écoulées, lecture interrompue à 135 s (la demande reste posée : reprise la nuit suivante) ;
//    rétention : le contenu des propositions « historique » décidées depuis 30 jours est réduit à { type, empreinte, resume } (20 par nuit) ;
// 5. frais des fonds (frais.ts, spec CP4 § 2) : au plus 10 ISIN par nuit (RPC frais_a_chercher : fonds détenus sans TER, TER
//    Yahoo de plus de 180 jours, ou TER tiré d'un DIC de plus de 365 jours (0027) ; dernier essai il y a plus de 30 jours), Yahoo
//    quoteSummary (fundProfile, defaultKeyStatistics) avec la session et le crumb ; TER écrit en % par an avec ter_source = yahoo et
//    ter_le ; un TER tiré d'un DIC (renseigné par Claude) n'est remplacé que si l'écart dépasse 50 % ET que le DIC a plus de 365 jours
//    (remplaceTerDic ; écriture gardée par ter_source = dic et la même date ter_le, annotateur ter_par effacé), sinon il est gardé
//    (avertissement) ; ter_essai_le marque chaque tentative, même en échec ; aucun nouvel
//    ISIN après 120 s écoulées, appels coupés à 125 s ; tout échec est un avertissement ;
// 6. finish_nightly() (status + job_runs) : toujours exécuté (finally), même si une étape lève.
// Chaque appel Yahoo, Euronext ou Binance est abandonné au bout de 10 s, et au plus tard à 120 s écoulées (80 s pendant
// les cours du jour, 125 s pendant les frais des fonds). Le compte rendu sépare les erreurs (job_runs.errors, job_runs.ok faux)
// des avertissements (réponse et journaux seulement : ils ne rendent pas la nuit fautive).
// Variables d'environnement : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (fournies par la plateforme) ; BINANCE_API_KEY et
// BINANCE_API_SECRET (facultatives, secrets du projet, jamais journalisées). Préproduction locale (SEC5) : BOUSSOLE_HORS_LIGNE=1 coupe
// tout appel externe (Yahoo, Euronext, Binance, frais des fonds, rattrapage) et lit les cours dans BOUSSOLE_COURS_FIGES
// (« ISIN=prix,ISIN=prix ») ; sans cette variable, rien ne change.
// Le client Supabase a la clé de service : toute lecture ou écriture de données personnelles filtre user_id.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  arrondi6, convertir, convertirAvecSerie, coursFiges, decalerDate, devise, lignesCours, paquets, parisDate, serieEuronext, serieYahoo,
} from "./cours.ts";
import type { LigneCours, Point } from "./cours.ts";
import { actifDeIsin, agreger, BinanceErreur, client as clientBinance, ENVELOPPE_BINANCE, memeEnveloppe, nomActif, planBinance } from "./binance.ts";
import { fraisYahoo, remplaceTerDic, urlFrais } from "./frais.ts";
import { coursAnciens, demanderRecalcul, marquerCalcule, recalculerPhotos, reduirePropositions, utilisateursARecalculer } from "./photos.ts";
import type { CoursAncien } from "./photos.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const DELAY_MS = 150;
// Budget de temps (ms écoulées depuis le début du passage ; limite d'exécution de la plateforme : 150 s).
const DELAI_APPEL_MS = 10_000; // délai maximal d'un appel Yahoo, Euronext ou Binance
const COURS_FIN_MS = 70_000; // aucun nouveau cours du jour au-delà (cours restants reportés)
const COURS_APPELS_FIN_MS = 80_000; // appels des cours du jour coupés au-delà
const BINANCE_DEBUT_MAX_MS = 90_000; // Binance reporté s'il n'a pas commencé avant
const RATTRAPAGE_FIN_MS = 110_000; // aucun nouveau rattrapage au-delà
const PHOTOS_DEBUT_MAX_MS = 100_000; // aucun nouvel utilisateur (photos reconstituées) au-delà
const PHOTOS_FIN_MS = 135_000; // lecture des photos interrompue au-delà (reprise la nuit suivante)
const APPELS_FIN_MS = 120_000; // tout appel réseau coupé au-delà (photos et versements déjà faits, finish_nightly ensuite)
const FRAIS_FIN_MS = 120_000; // aucun nouvel ISIN (frais des fonds) au-delà
const FRAIS_APPELS_FIN_MS = 125_000; // appels des frais des fonds coupés au-delà
const RATTRAPAGES_MAX = 10;
const FRAIS_MAX = 10;
const PAQUET = 500;
const JOURS_5_ANS = 1827;

// Points d'injection pour les tests (client Supabase, fetch, environnement, date, horloge du budget, signal d'abandon,
// attente) ; inchangés en production.
export const deps = {
  createClient: createClient as (...a: any[]) => any,
  fetch: ((...a: any[]) => (fetch as any)(...a)) as any,
  env: (k: string): string | undefined => Deno.env.get(k),
  maintenant: () => new Date(),
  horloge: (): number => Date.now(),
  signal: (ms: number): AbortSignal => AbortSignal.timeout(ms),
  attendre: (ms: number) => new Promise((r) => setTimeout(r, ms)),
};

// Mode hors ligne du passage en cours (BOUSSOLE_HORS_LIGNE=1, préproduction seulement) : tout appel externe est refusé.
let horsLigne = false;

// Budget du passage en cours : début (horloge) et limite des appels réseau (ms écoulées).
let debut = 0;
let finAppels = APPELS_FIN_MS;
const ecoule = () => deps.horloge() - debut;

/** Signal d'abandon d'un appel : `ms` au plus (10 s), et jamais au-delà de la limite des appels de la phase en cours. */
function signalAppel(ms = DELAI_APPEL_MS): AbortSignal {
  return deps.signal(Math.max(1, Math.min(ms, DELAI_APPEL_MS, finAppels - ecoule())));
}

/** fetch sous délai ; un abandon devient « délai dépassé ». */
async function appel(url: string, init: Record<string, unknown> = {}): Promise<Response> {
  if (horsLigne) throw new Error("hors ligne : appel externe refusé");
  try {
    return await deps.fetch(url, { ...init, signal: signalAppel() });
  } catch (e) {
    const nom = (e as any)?.name;
    if (nom === "TimeoutError" || nom === "AbortError") throw new Error("délai dépassé");
    throw e;
  }
}

// Yahoo renvoie souvent 429 aux requêtes sans cookie : en cas de 401/403/429, on ouvre une
// session (cookie A3 via fc.yahoo.com + crumb) une fois, puis on réessaie avec cookie et crumb.
type YahooSession = { cookie: string; crumb: string };
let yahooSession: Promise<YahooSession | null> | null = null;

async function openYahooSession(): Promise<YahooSession | null> {
  try {
    const r1 = await appel("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
    const cookie = r1.headers.getSetCookie().map((c: string) => c.split(";")[0]).filter(Boolean).join("; ");
    await r1.body?.cancel();
    if (!cookie) return null;
    const r2 = await appel("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    const crumb = (await r2.text()).trim();
    if (!r2.ok || !crumb || crumb.length > 64 || /\s/.test(crumb)) return null;
    return { cookie, crumb };
  } catch {
    return null;
  }
}

async function yahooGet(url: string): Promise<Response> {
  const headers = { "User-Agent": UA, Accept: "application/json" };
  const res = await appel(url, { headers });
  if (![401, 403, 429].includes(res.status)) return res;
  await res.body?.cancel();
  yahooSession ??= openYahooSession();
  const s = await yahooSession;
  if (!s) {
    yahooSession = null;
    return new Response(null, { status: res.status });
  }
  const sep = url.includes("?") ? "&" : "?";
  const retry = await appel(`${url}${sep}crumb=${encodeURIComponent(s.crumb)}`, { headers: { ...headers, Cookie: s.cookie } });
  if ([401, 403].includes(retry.status)) yahooSession = null; // crumb expiré : nouvelle session au prochain appel
  return retry;
}

type Quote = { price: number; currency: string; time: number | null; points: Point[] };
type RunError = { isin?: string; symbol?: string; error: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const aujourdhui = () => parisDate(null, deps.maintenant());
/** Contexte des travaux de photos.ts : date du jour à Paris, horloge, et contrôle du budget de temps (facultatif). */
const contexte = (verifier?: () => void) => ({ aujourdhui: aujourdhui(), maintenant: () => deps.maintenant(), verifier });

/** Graphique Yahoo quotidien (range = 5d pour le cours du jour, 5y pour le rattrapage, max pour les cours antérieurs aux mouvements importés). */
async function fetchChart(symbol: string, range: "5d" | "5y" | "max") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await yahooGet(url);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  return serieYahoo(await res.json());
}

async function fetchQuote(symbol: string): Promise<Quote> {
  const s = await fetchChart(symbol, "5d");
  const price = s.price ?? (s.points.length ? s.points[s.points.length - 1].close : null);
  if (price == null || !isFinite(price) || price <= 0) throw new Error("cours absent");
  return { price, currency: s.currency, time: s.time, points: s.points };
}

/** Taux de change CUR → EUR, mis en cache pendant le passage. */
const fxCache = new Map<string, Promise<number>>();
function fxToEur(cur: string): Promise<number> {
  if (cur === "EUR") return Promise.resolve(1);
  if (!fxCache.has(cur)) fxCache.set(cur, fetchQuote(`${cur}EUR=X`).then((q) => q.price));
  return fxCache.get(cur)!;
}

/** Facteur de conversion d'un cours Yahoo en EUR (GBp/GBX : pence → livres avant conversion). */
async function tauxEur(currency: string): Promise<{ taux: number; cur: string; facteur: number }> {
  const { cur, facteur } = devise(currency);
  if (cur === "EUR") return { taux: facteur, cur, facteur };
  try {
    return { taux: facteur * (await fxToEur(cur)), cur, facteur };
  } catch (e) {
    fxCache.delete(cur);
    throw new Error(`change ${cur}EUR indisponible (${(e as Error).message})`);
  }
}

/** Série de taux CUR → EUR sur 5 ans ou sur toute la durée (rattrapage), mise en cache pendant le passage ; vide si indisponible. */
const fxSerieCache = new Map<string, Promise<Point[]>>();
function fxSerie(cur: string, plage: "5y" | "max" = "5y"): Promise<Point[]> {
  const cle = `${cur}|${plage}`;
  if (!fxSerieCache.has(cle)) fxSerieCache.set(cle, fetchChart(`${cur}EUR=X`, plage).then((s) => s.points).catch(() => []));
  return fxSerieCache.get(cle)!;
}

// Repli Euronext, quand Yahoo échoue (429, symbole invalide…) ou quand l'instrument n'a pas de
// symbole Yahoo. Deux appels publics, sans clé ni cookie (sondés le 2026-10-09) :
//
// 1. Recherche du marché (MIC), mise en cache pendant le passage :
//    GET https://live.euronext.com/en/instrumentSearch/searchJSON?q={ISIN}
//    → [{"value":"FR0010342592","isin":"FR0010342592","mic":"XPAR","label":"<span…>","link":"/en/product/etfs/FR0010342592-XPAR","name":"Amundi NSDQ LEV"},
//       {"isin":"FR0010342592","mic":"ETFP",…}, {"value":"","isin":"","mic":"",…"See all results"}]
//    On garde la première MIC de MIC_PREF présente (marchés au comptant, cotations en EUR).
//
// 2. Historique des cours en CSV (14 derniers jours chaque nuit ; 5 ans pour le rattrapage) :
//    GET https://live.euronext.com/en/ajax/AwlHistoricalPrice/getFullDownloadAjax/{ISIN}-{MIC}
//        ?format=csv&decimal_separator=.&date_form=d/m/Y&startdate=YYYY-MM-DD&enddate=YYYY-MM-DD
//    → (BOM)"Historical Data"
//      "From 2026-09-25 to 2026-10-09"
//      FR0010342592
//      Date;Open;High;Low;Last;Close;"Number of Shares";"Number of Trades";Turnover[;vwap]
//      09/10/2026;10.766;10.812;10.65;10.682;10.682;469092;711;5030484;10.7239
//      … (du plus récent au plus ancien)
//    Colonne Close (à défaut Last), date JJ/MM/AAAA ; la ligne la plus récente donne le cours du jour.
//
// Écartés : getDetailedQuote et intraday_chart/getChartData renvoient un JSON chiffré
// ({ct, iv, s}) ; la même URL CSV en POST répond « No format specified ».
// Le CSV ne donne pas la devise : le repli n'est tenté que pour les instruments en EUR.
const EURONEXT = "https://live.euronext.com/en";
const MIC_PREF = ["XPAR", "XAMS", "XBRU", "XLIS", "XMIL", "ETFP"];
const REAL_ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

const micCache = new Map<string, Promise<string>>();
function euronextMic(isin: string): Promise<string> {
  if (!micCache.has(isin)) {
    const p = (async () => {
      const res = await appel(`${EURONEXT}/instrumentSearch/searchJSON?q=${encodeURIComponent(isin)}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`recherche HTTP ${res.status}`);
      }
      const list = await res.json();
      const mics = new Set((Array.isArray(list) ? list : []).filter((x: any) => x?.isin === isin).map((x: any) => String(x.mic)));
      const mic = MIC_PREF.find((m) => mics.has(m));
      if (!mic) throw new Error("non coté sur Euronext");
      return mic;
    })();
    p.catch(() => micCache.delete(isin));
    micCache.set(isin, p);
  }
  return micCache.get(isin)!;
}

/** Clôtures Euronext de `jours` jours jusqu'à aujourd'hui (date de Paris). */
async function fetchEuronext(isin: string, jours: number): Promise<{ points: Point[]; mic: string }> {
  const mic = await euronextMic(isin);
  const end = aujourdhui();
  const start = decalerDate(end, -jours);
  const qs = `format=csv&decimal_separator=.&date_form=d/m/Y&startdate=${start}&enddate=${end}`;
  const res = await appel(`${EURONEXT}/ajax/AwlHistoricalPrice/getFullDownloadAjax/${isin}-${mic}?${qs}`, {
    headers: { "User-Agent": UA, Accept: "text/csv,*/*" },
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  const points = serieEuronext(await res.text());
  if (!points.length) throw new Error("cours absent");
  return { points, mic };
}

/** Upsert dans cours par paquets ; renvoie le nombre de lignes écrites (erreurs ajoutées à `errors`). */
async function enregistrerCours(admin: any, lignes: LigneCours[], errors: RunError[], isin?: string): Promise<number> {
  // une ligne par (isin, date) : la dernière l'emporte (sinon l'upsert d'un même paquet échoue)
  const uniques = [...new Map(lignes.map((l) => [`${l.isin}|${l.date}`, l])).values()];
  let n = 0;
  for (const p of paquets(uniques, PAQUET)) {
    const { error } = await admin.from("cours").upsert(p, { onConflict: "isin,date" });
    if (error) {
      errors.push({ ...(isin ? { isin } : {}), error: `cours : ${error.message}` });
      continue;
    }
    n += p.length;
  }
  return n;
}

/* ---------- Binance ---------- */
type BilanBinance = { etat: string; mises_a_jour?: number; creees?: number; cloturees?: number; ignorees?: number; sans_cours?: number };

/** Cours EUR d'un actif crypto pour décider d'une création : instruments (X-<ACTIF>-EUR ou X-<ACTIF>), sinon Yahoo <ACTIF>-EUR. */
async function coursActif(admin: any, actif: string): Promise<{ isin: string; prix: number | null; existe: boolean }> {
  if (actif === "EUR") {
    const { data } = await admin.from("instruments").select("isin").in("isin", ["X-EUR"]);
    return { isin: "X-EUR", prix: 1, existe: (data || []).length > 0 };
  }
  const { data } = await admin.from("instruments").select("isin, price").in("isin", [`X-${actif}-EUR`, `X-${actif}`]);
  const connus = (data || []) as { isin: string; price: number | string | null }[];
  const avecPrix = connus.find((i) => Number(i.price) > 0);
  if (avecPrix) return { isin: avecPrix.isin, prix: Number(avecPrix.price), existe: true };
  const isin = connus[0]?.isin ?? `X-${actif}`;
  try {
    const q = await fetchQuote(`${actif}-EUR`);
    const { taux } = await tauxEur(q.currency);
    return { isin, prix: q.price * taux, existe: connus.length > 0 };
  } catch {
    return { isin, prix: null, existe: connus.length > 0 };
  }
}

async function synchroniserBinance(admin: any, errors: RunError[], avertissements: string[]): Promise<BilanBinance> {
  const cle = deps.env("BINANCE_API_KEY")?.trim(), secret = deps.env("BINANCE_API_SECRET")?.trim();
  if (!cle || !secret) return { etat: "non configuré" };
  const f = await admin.from("fonctionnalites").select("user_id").eq("cle", "binance").eq("active", true);
  if (f.error) {
    errors.push({ error: `binance : lecture des fonctionnalités : ${f.error.message}` });
    return { etat: "erreur" };
  }
  const users = [...new Set((f.data || []).map((r: any) => String(r.user_id)))];
  if (users.length === 0) return { etat: "inactif" };
  if (users.length > 1) {
    errors.push({ error: "binance : plusieurs utilisateurs l'ont activé ; les secrets sont communs au projet, synchronisation suspendue." });
    return { etat: "suspendu" };
  }
  const uid = users[0];
  if (ecoule() > BINANCE_DEBUT_MAX_MS) {
    avertissements.push("binance : temps insuffisant, synchronisation reportée à la prochaine nuit.");
    return { etat: "reporté" };
  }
  let actifs: Record<string, number>;
  try {
    actifs = agreger(await clientBinance(cle, secret, deps.fetch, () => deps.maintenant().getTime(), signalAppel).lire());
  } catch (e) {
    const msg = e instanceof BinanceErreur ? e.message : "Binance : lecture impossible.";
    errors.push({ error: `binance : ${msg}` });
    console.error(`nightly: binance en échec : ${msg}`);
    return { etat: "erreur" };
  }

  const lu = await admin.from("positions")
    .select("id, name, envelope, owner, bloc, isin, qty, status, source_auto, created_at")
    .eq("user_id", uid);
  if (lu.error) {
    errors.push({ error: `binance : lecture des lignes : ${lu.error.message}` });
    return { etat: "erreur" };
  }
  const lignes = (lu.data || []).filter((l: any) => memeEnveloppe(l.envelope, ENVELOPPE_BINANCE));
  const sansLigne = Object.keys(actifs).filter((a) => !lignes.some((l: any) => actifDeIsin(l.isin) === a));
  const cours: Record<string, number | null> = {};
  const instrumentDe: Record<string, { isin: string; existe: boolean }> = {};
  for (const a of sansLigne) {
    const c = await coursActif(admin, a);
    cours[a] = c.prix;
    instrumentDe[a] = { isin: c.isin, existe: c.existe };
  }
  const plan = planBinance({ actifs, lignes, cours });
  avertissements.push(...plan.avertissements); // non bloquants : job_runs.ok n'en dépend pas
  const le = deps.maintenant().toISOString();
  let majOk = 0, creees = 0, cloturees = 0;

  for (const m of plan.maj) {
    const { error } = await admin.from("positions")
      .update({ qty: m.qty, source_auto: "binance", source_auto_le: le, ...(m.reactiver ? { status: "actif" } : {}) })
      .eq("user_id", uid).eq("id", m.id);
    if (error) errors.push({ error: `binance : mise à jour ${m.actif} : ${error.message}` });
    else majOk++;
  }

  const modele = lignes.find((l: any) => l.status !== "clôturé") ?? lignes[0];
  const enveloppe = modele?.envelope ?? ENVELOPPE_BINANCE;
  for (const c of plan.creer) {
    const ins = instrumentDe[c.actif] ?? { isin: `X-${c.actif}`, existe: false };
    if (!ins.existe) {
      const prix = cours[c.actif];
      const { error } = await admin.from("instruments").upsert({
        isin: ins.isin, name: nomActif(c.actif), currency: "EUR",
        symbol: c.actif === "EUR" ? null : `${c.actif}-EUR`,
        price: prix != null ? arrondi6(prix) : null, price_date: aujourdhui(), source: c.actif === "EUR" ? "fixe" : "yahoo",
      }, { onConflict: "isin", ignoreDuplicates: true });
      if (error) {
        errors.push({ error: `binance : instrument ${ins.isin} : ${error.message}` });
        continue;
      }
    }
    const { error } = await admin.from("positions").insert({
      user_id: uid, name: nomActif(c.actif), envelope: enveloppe, owner: modele?.owner ?? "p1", bloc: modele?.bloc || "Crypto",
      mode: "market", isin: ins.isin, qty: c.qty, status: "actif", source_auto: "binance", source_auto_le: le,
    });
    if (error) errors.push({ error: `binance : création ${c.actif} : ${error.message}` });
    else creees++;
  }

  for (const c of plan.cloturer) {
    const { error } = await admin.from("positions")
      .update({ status: "clôturé", source_auto_le: le })
      .eq("user_id", uid).eq("id", c.id).eq("source_auto", "binance");
    if (error) errors.push({ error: `binance : clôture ${c.actif ?? ""} : ${error.message}` });
    else cloturees++;
  }
  console.log(`nightly: binance ${majOk} ligne(s) mise(s) à jour, ${creees} créée(s), ${cloturees} clôturée(s), ${plan.petits.length} petit(s) solde(s) ignoré(s), ${plan.sansCours.length} sans cours`);
  return { etat: "ok", mises_a_jour: majOk, creees, cloturees, ignorees: plan.petits.length, sans_cours: plan.sansCours.length };
}

/* ---------- Rattrapage de l'historique ---------- */
async function rattraper(ins: { isin: string; symbol: string | null; currency: string }, plage: "5y" | "max" = "5y", jours = JOURS_5_ANS): Promise<{ lignes: LigneCours[]; source: string }> {
  const isin = String(ins.isin);
  const symbol = String(ins.symbol || "").trim();
  const canFallback = REAL_ISIN.test(isin) && String(ins.currency || "EUR").toUpperCase() === "EUR";
  let yahooErr = "sans symbole";
  if (symbol) {
    try {
      const s = await fetchChart(symbol, plage);
      if (!s.points.length) throw new Error("historique vide");
      const { cur, facteur } = devise(s.currency);
      let points = convertir(s.points, facteur);
      if (cur !== "EUR") {
        const { taux } = await tauxEur(s.currency);
        points = convertirAvecSerie(points, await fxSerie(cur, plage), taux / facteur);
      }
      return { lignes: lignesCours(isin, points, "yahoo"), source: "yahoo" };
    } catch (e) {
      yahooErr = (e as Error).message;
    }
  }
  if (!canFallback) throw new Error(`yahoo: ${yahooErr}`);
  try {
    if (symbol) await deps.attendre(DELAY_MS);
    const f = await fetchEuronext(isin, jours);
    return { lignes: lignesCours(isin, f.points, "euronext"), source: "euronext" };
  } catch (e) {
    throw new Error(`yahoo: ${yahooErr} ; euronext: ${(e as Error).message}`);
  }
}

/* ---------- Frais des fonds ---------- */
/** Frais courants publiés par Yahoo (% par an) ; null si le symbole est introuvable ou sans frais ; lève sur une autre erreur. */
async function lireFrais(symbol: string): Promise<number | null> {
  const res = await yahooGet(urlFrais(symbol));
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  return fraisYahoo(await res.json());
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "méthode non autorisée" }, 405);

  const supabaseUrl = deps.env("SUPABASE_URL");
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "configuration manquante" }, 500);
  const admin = deps.createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Authentification par jeton (Vault).
  const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : "";
  if (!token) return json({ ok: false, error: "non autorisé" }, 401);
  const check = await admin.rpc("check_nightly_token", { p: token });
  if (check.error) {
    console.error("nightly: vérification du jeton impossible", check.error.message);
    return json({ ok: false, error: "vérification impossible" }, 500);
  }
  if (check.data !== true) return json({ ok: false, error: "non autorisé" }, 401);

  fxCache.clear(); fxSerieCache.clear(); micCache.clear(); yahooSession = null;
  horsLigne = deps.env("BOUSSOLE_HORS_LIGNE") === "1";
  const figes = horsLigne ? coursFiges(deps.env("BOUSSOLE_COURS_FIGES")) : null;
  const started = deps.maintenant();
  debut = deps.horloge();
  const errors: RunError[] = [];
  const avertissements: string[] = [];
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
  let updated = 0, coursEnregistres = 0, nbInstruments = 0, recurring = 0, users = 0;
  let binance: BilanBinance = { etat: "non tenté" };
  const rattrapages = { tentes: 0, reussis: 0, lignes: 0 };
  const photos = { utilisateurs: 0, mois: 0, supprimees: 0, reportes: 0, cours_anciens: 0 };
  let retention = 0;
  const frais = { tentes: 0, trouves: 0 };
  let fin: { error: { message: string } | null } = { error: { message: "non exécuté" } };

  /** RPC d'une étape : une erreur (renvoyée ou levée) est notée et n'arrête pas la nuit. */
  const step = async (name: string, args: Record<string, unknown> = {}) => {
    try {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw new Error(error.message);
      return data;
    } catch (e) {
      errors.push({ error: `${name} : ${message(e)}` });
      console.error(`nightly: ${name} en échec`, message(e));
      return null;
    }
  };

  try {
    // 2. Cours du jour (bornés à ~70 s) : Yahoo d'abord ; en cas d'échec (ou sans symbole Yahoo), repli Euronext pour les
    // instruments en EUR identifiés par un vrai ISIN (les ISIN de test `X-…` sont ignorés). X-EUR (euros détenus chez
    // Binance) : cours fixe de 1.
    try {
      finAppels = COURS_APPELS_FIN_MS;
      const coursDuJour: LigneCours[] = [];
      const { data: instruments, error: instErr } = await admin
        .from("instruments")
        .select("isin, symbol, currency")
        .order("isin");
      nbInstruments = instruments?.length ?? 0;
      if (instErr) {
        errors.push({ error: `lecture des instruments : ${instErr.message}` });
      } else {
        let reportes = 0;
        for (const ins of instruments || []) {
          const isin = String(ins.isin);
          const symbol = String(ins.symbol || "").trim();
          if (isin === "X-EUR") {
            const row = { price: 1, price_date: aujourdhui(), source: "fixe" };
            const { error } = await admin.from("instruments").update(row).eq("isin", isin);
            if (error) errors.push({ isin, error: `mise à jour : ${error.message}` });
            else { updated++; coursDuJour.push({ isin, date: row.price_date, cloture: 1, source: "fixe" }); }
            continue;
          }
          if (figes) { // hors ligne : cours figés du fichier fourni, aucun appel externe
            const prix = figes.get(isin);
            if (prix === undefined) continue;
            const row = { price: arrondi6(prix), price_date: aujourdhui(), source: "fige" };
            const { error } = await admin.from("instruments").update(row).eq("isin", isin);
            if (error) errors.push({ isin, error: `mise à jour : ${error.message}` });
            else { updated++; coursDuJour.push({ isin, date: row.price_date, cloture: row.price, source: "fige" }); }
            continue;
          }
          const canFallback = REAL_ISIN.test(isin) && String(ins.currency || "EUR").toUpperCase() === "EUR";
          if (!symbol && !canFallback) continue;
          if (ecoule() > COURS_FIN_MS) {
            reportes++;
            errors.push({ isin, symbol: symbol || undefined, error: "temps dépassé, cours reporté à la prochaine nuit" });
            continue;
          }
          let row: { price: number; price_date: string; source: string } | null = null;
          let yahooErr = "sans symbole";
          if (symbol) {
            try {
              const q = await fetchQuote(symbol);
              const { taux } = await tauxEur(q.currency);
              row = { price: q.price * taux, price_date: parisDate(q.time, deps.maintenant()), source: "yahoo" };
              const points = new Map(convertir(q.points, taux).map((p) => [p.date, p.close]));
              points.set(row.price_date, row.price); // le cours du jour (meta) fait foi pour sa date
              coursDuJour.push(...lignesCours(isin, [...points].map(([date, close]) => ({ date, close })), "yahoo"));
            } catch (e) {
              yahooErr = message(e);
            }
          }
          if (!row && canFallback && ecoule() <= COURS_FIN_MS) {
            if (symbol) await deps.attendre(DELAY_MS);
            try {
              const f = await fetchEuronext(isin, 14);
              const last = f.points[f.points.length - 1];
              row = { price: last.close, price_date: last.date, source: "euronext" };
              coursDuJour.push(...lignesCours(isin, f.points, "euronext"));
              console.log(`nightly: ${isin} via Euronext ${f.mic} (yahoo : ${yahooErr})`);
            } catch (e) {
              errors.push({ isin, symbol: symbol || undefined, error: `yahoo: ${yahooErr} ; euronext: ${message(e)}` });
            }
          } else if (!row) {
            errors.push({ isin, symbol: symbol || undefined, error: canFallback ? `yahoo: ${yahooErr} ; euronext: temps dépassé` : yahooErr });
          }
          if (row) {
            const { error } = await admin
              .from("instruments")
              .update({ ...row, price: arrondi6(row.price) })
              .eq("isin", isin);
            if (error) errors.push({ isin, symbol: symbol || undefined, error: `mise à jour : ${error.message}` });
            else updated++;
          }
          await deps.attendre(DELAY_MS);
        }
        if (reportes) console.warn(`nightly: temps dépassé, ${reportes} cours reporté(s) à la prochaine nuit`);
      }
      coursEnregistres = await enregistrerCours(admin, coursDuJour, errors);
    } catch (e) {
      errors.push({ error: `cours du jour : erreur inattendue (${message(e)}).` });
    }
    console.log(`nightly: ${updated}/${nbInstruments} cours mis à jour, ${coursEnregistres} clôture(s) enregistrée(s), ${ecoule()} ms`);

    // 3. Photo, versements programmés (seulement le jour exact), photo finale (elle inclut les versements).
    await step("take_snapshots");
    recurring = (await step("apply_recurring")) ?? 0;
    users = (await step("take_snapshots")) ?? 0;

    // 4. Binance (lecture seule), si le temps restant le permet : une erreur n'arrête pas la nuit.
    finAppels = APPELS_FIN_MS;
    try {
      binance = horsLigne ? { etat: "hors ligne" } : await synchroniserBinance(admin, errors, avertissements);
    } catch {
      errors.push({ error: "binance : erreur inattendue, synchronisation interrompue." });
      binance = { etat: "erreur" };
    }

    // 5. Rattrapage de l'historique (au plus 10 ISIN) ; aucun nouveau rattrapage après ~110 s.
    try {
      if (horsLigne) {
        avertissements.push("rattrapage : hors ligne, aucun appel externe.");
      } else if (ecoule() > RATTRAPAGE_FIN_MS) {
        avertissements.push("rattrapage : temps écoulé, reporté à la prochaine nuit.");
      } else {
        const aRattraper = await admin.rpc("cours_a_rattraper", { p_limite: RATTRAPAGES_MAX });
        if (aRattraper.error) {
          errors.push({ error: `cours_a_rattraper : ${aRattraper.error.message}` });
        } else {
          /* HIS2 : d'abord les ISIN dont les mouvements importés précèdent les cours stockés (plage « max » au-delà de 5 ans), puis ceux de la RPC ; 10 au plus */
          let anciens: CoursAncien[] = [];
          try {
            anciens = await coursAnciens(admin, contexte(), RATTRAPAGES_MAX);
          } catch (e) {
            avertissements.push(`rattrapage des cours anciens : ${message(e)}`);
          }
          const dejaLa = new Set(anciens.map((a) => a.isin));
          const liste: any[] = [...anciens, ...(aRattraper.data || []).filter((x: any) => !dejaLa.has(String(x.isin)))].slice(0, RATTRAPAGES_MAX);
          for (let k = 0; k < liste.length; k++) {
            const ins = liste[k];
            if (ecoule() > RATTRAPAGE_FIN_MS) {
              avertissements.push(`rattrapage interrompu (temps écoulé) : ${liste.length - k} ISIN reporté(s) à la prochaine nuit.`);
              break;
            }
            const isin = String(ins.isin);
            rattrapages.tentes++;
            try {
              const r = await rattraper(ins, ins.plage ?? "5y", ins.jours ?? JOURS_5_ANS);
              if (!r.lignes.length) throw new Error("historique vide");
              const n = await enregistrerCours(admin, r.lignes, errors, isin);
              rattrapages.lignes += n;
              if (n) {
                rattrapages.reussis++;
                if (ins.utilisateurs?.length) {
                  photos.cours_anciens++;
                  try { await demanderRecalcul(admin, ins.utilisateurs, contexte()); } catch (e) { avertissements.push(`photos reconstituées : demande de recalcul de ${isin} : ${message(e)}`); }
                }
              }
              console.log(`nightly: historique ${isin} via ${r.source}${ins.plage === "max" ? " (plage max)" : ""} : ${n} cours`);
            } catch (e) {
              errors.push({ isin, symbol: ins.symbol || undefined, error: `rattrapage : ${message(e)}` });
            }
            const { error } = await admin.from("instruments").update({ cours_rattrapage_le: deps.maintenant().toISOString() }).eq("isin", isin);
            if (error) errors.push({ isin, error: `rattrapage : ${error.message}` });
            await deps.attendre(DELAY_MS);
          }
        }
      }
    } catch (e) {
      errors.push({ error: `rattrapage : erreur inattendue (${message(e)}).` });
    }

    // 5 bis. Photos reconstituées (HIS2) des utilisateurs dont le recalcul est demandé, puis rétention des propositions d'historique décidées depuis 30 jours.
    // Non bloquant pour la suite : une erreur est notée (job_runs.errors), la demande reste posée et le travail reprend la nuit suivante.
    try {
      const demandes = await utilisateursARecalculer(admin);
      for (let k = 0; k < demandes.length; k++) {
        if (ecoule() > PHOTOS_DEBUT_MAX_MS) {
          photos.reportes = demandes.length - k;
          avertissements.push(`photos reconstituées : temps écoulé, ${photos.reportes} utilisateur(s) reporté(s) à la prochaine nuit.`);
          break;
        }
        const d = demandes[k];
        try {
          const r = await recalculerPhotos(admin, d.user_id, contexte(() => { if (ecoule() > PHOTOS_FIN_MS) throw new Error("temps écoulé"); }));
          await marquerCalcule(admin, d.user_id, d.demande);
          photos.utilisateurs++; photos.mois += r.mois; photos.supprimees += r.supprimees;
        } catch (e) {
          const m = message(e);
          if (m === "temps écoulé") { photos.reportes++; avertissements.push("photos reconstituées : lecture interrompue (temps écoulé), reprise à la prochaine nuit."); }
          else errors.push({ error: `photos reconstituées : ${m}` });
        }
      }
      if (ecoule() <= PHOTOS_FIN_MS) retention = await reduirePropositions(admin, contexte());
    } catch (e) {
      // migration 0034 pas appliquée (préproduction ancienne) : table ou colonne absente → avertissement, pas une nuit fautive
      if (/does not exist|schema cache|PGRST20\d|42P01|42703/i.test(message(e))) avertissements.push(`photos reconstituées : tables de l'historique absentes (migration 0034 ?) : ${message(e)}`);
      else errors.push({ error: `photos reconstituées : erreur inattendue (${message(e)}).` });
    }

    // 6. Frais des fonds (au plus 10 ISIN) ; aucun nouvel ISIN après ~120 s, appels coupés à 125 s. Non bloquant : tout échec
    // est un avertissement. Le TER n'est écrit que s'il est absent ou de source Yahoo ; un TER tiré d'un DIC passe avant, sauf s'il a
    // plus de 365 jours et s'écarte de plus de 50 % du chiffre Yahoo (remplaceTerDic).
    try {
      if (horsLigne) {
        avertissements.push("frais des fonds : hors ligne, aucun appel externe.");
      } else if (ecoule() > FRAIS_FIN_MS) {
        avertissements.push("frais des fonds : temps écoulé, reportés à la prochaine nuit.");
      } else {
        finAppels = FRAIS_APPELS_FIN_MS;
        const aChercher = await admin.rpc("frais_a_chercher", { p_limite: FRAIS_MAX });
        if (aChercher.error) {
          avertissements.push(`frais des fonds : frais_a_chercher : ${aChercher.error.message}`);
        } else {
          const liste = (aChercher.data || [])
            .filter((x: any) => REAL_ISIN.test(String(x?.isin)) && String(x?.symbol || "").trim())
            .slice(0, FRAIS_MAX);
          for (let k = 0; k < liste.length; k++) {
            if (ecoule() > FRAIS_FIN_MS) {
              avertissements.push(`frais des fonds interrompus (temps écoulé) : ${liste.length - k} ISIN reporté(s) à la prochaine nuit.`);
              break;
            }
            const isin = String(liste[k].isin), symbol = String(liste[k].symbol).trim();
            frais.tentes++;
            let ter: number | null = null;
            try {
              ter = await lireFrais(symbol);
              if (ter == null) avertissements.push(`frais des fonds : ${isin} (${symbol}) : frais non publiés par Yahoo, nouvel essai dans 30 jours.`);
            } catch (e) {
              avertissements.push(`frais des fonds : ${isin} (${symbol}) : ${message(e)}`);
            }
            const dic = liste[k].ter_source === "dic" ? { ter: liste[k].ter == null ? null : Number(liste[k].ter), le: liste[k].ter_le ?? null } : null;
            if (ter != null && dic && !remplaceTerDic(dic.ter, dic.le, ter, aujourdhui())) {
              frais.trouves++;
              avertissements.push(`frais des fonds : ${isin} (${symbol}) : TER du DIC gardé (${dic.ter} % par an, Yahoo : ${ter} %), écart de 50 % au plus ou DIC de moins d'un an.`);
            } else if (ter != null) {
              const ecriture = admin.from("instruments").update(dic ? { ter, ter_source: "yahoo", ter_le: aujourdhui(), ter_par: null } : { ter, ter_source: "yahoo", ter_le: aujourdhui() })
                .eq("isin", isin);
              /* DIC ancien et très différent : remplacé, sauf annotation faite entre-temps (ter_source et ter_le inchangés). */
              const { error } = dic ? await ecriture.eq("ter_source", "dic").eq("ter_le", String(dic.le)) : await ecriture.or("ter.is.null,ter_source.eq.yahoo");
              if (error) avertissements.push(`frais des fonds : ${isin} : ${error.message}`);
              else frais.trouves++;
            }
            const { error } = await admin.from("instruments").update({ ter_essai_le: deps.maintenant().toISOString() }).eq("isin", isin);
            if (error) avertissements.push(`frais des fonds : ${isin} : ${error.message}`);
            await deps.attendre(DELAY_MS);
          }
        }
      }
    } catch (e) {
      avertissements.push(`frais des fonds : erreur inattendue (${message(e)}).`);
    }
  } catch (e) {
    errors.push({ error: `erreur inattendue (${message(e)}).` });
  } finally {
    // 7. Compte rendu : toujours (status + job_runs). Les avertissements n'y figurent pas (job_runs.ok n'en dépend pas).
    try {
      fin = await admin.rpc("finish_nightly", {
        p_started: started.toISOString(),
        p_instruments: updated,
        p_errors: errors,
      });
    } catch (e) {
      fin = { error: { message: message(e) } };
    }
    if (fin.error) {
      console.error("nightly: finish_nightly en échec", fin.error.message);
      errors.push({ error: `finish_nightly : ${fin.error.message}` });
    }
  }

  for (const a of avertissements) console.warn(`nightly: avertissement : ${a}`);
  console.log(`nightly: ${users} utilisateur(s), ${recurring} versement(s), ${errors.length} erreur(s), ${avertissements.length} avertissement(s), ${ecoule()} ms`);
  return json({
    ok: !fin.error, instruments_updated: updated, cours_enregistres: coursEnregistres, rattrapages, photos, retention_propositions: retention, frais, binance,
    users, recurring_applied: recurring, errors, avertissements, ...(horsLigne ? { hors_ligne: true } : {}),
  });
});
