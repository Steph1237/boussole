// Boussole : fonction nocturne.
//
// Appelée par pg_cron (job `boussole-nightly`, 20:30 UTC) via pg_net, avec
// `Authorization: Bearer <jeton>` où le jeton est lu dans Supabase Vault (`nightly_token`).
// Déployée avec verify_jwt = false : l'authentification est faite ici, par
// public.check_nightly_token() (exécutable par le rôle service uniquement).
//
// Étapes :
// 1. cours Yahoo, repli Euronext → instruments (en EUR, source yahoo | euronext) ; les clôtures lues (5 derniers jours Yahoo,
//    14 derniers jours Euronext) sont enregistrées dans `cours` (upsert sur (isin, date), par paquets de 500) ;
// 2. Binance en lecture seule (binance.ts, spec CP1 § 7) : seulement si BINANCE_API_KEY et BINANCE_API_SECRET existent et
//    qu'un seul utilisateur a fonctionnalites(binance) active ; quantités des lignes de l'enveloppe « Crypto (Binance) » ;
//    une erreur Binance est journalisée (message traduit, jamais de secret) et n'arrête pas la nuit ;
// 3. rattrapage de l'historique (spec CP1 § 4) : au plus 10 ISIN par nuit (RPC cours_a_rattraper : détenus, moins de 30 cours),
//    5 ans quotidiens (Yahoo range=5y&interval=1d sur le symbole déjà résolu, sinon CSV historique Euronext), upsert par
//    paquets ; instruments.cours_rattrapage_le marque chaque tentative (nouvel essai au plus tôt 7 jours après) ;
// 4. take_snapshots() ; apply_recurring() ; take_snapshots() (la photo du jour inclut les versements) ;
//    finish_nightly() (status + job_runs).
// Variables d'environnement : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (fournies par la plateforme) ; BINANCE_API_KEY et
// BINANCE_API_SECRET (facultatives, secrets du projet, jamais journalisées).
// Le client Supabase a la clé de service : toute lecture ou écriture de données personnelles filtre user_id.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  arrondi6, convertir, convertirAvecSerie, decalerDate, devise, lignesCours, paquets, parisDate, serieEuronext, serieYahoo,
} from "./cours.ts";
import type { LigneCours, Point } from "./cours.ts";
import { actifDeIsin, agreger, BinanceErreur, client as clientBinance, ENVELOPPE_BINANCE, memeEnveloppe, nomActif, planBinance } from "./binance.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const DELAY_MS = 150;
const BUDGET_MS = 100_000;
const RATTRAPAGE_FIN_MS = 125_000; // aucun nouveau rattrapage au-delà (limite d'exécution de la plateforme : 150 s)
const RATTRAPAGES_MAX = 10;
const PAQUET = 500;
const JOURS_5_ANS = 1827;

// Points d'injection pour les tests (client Supabase, fetch, environnement, horloge, attente) ; inchangés en production.
export const deps = {
  createClient: createClient as (...a: any[]) => any,
  fetch: ((...a: any[]) => (fetch as any)(...a)) as any,
  env: (k: string): string | undefined => Deno.env.get(k),
  maintenant: () => new Date(),
  attendre: (ms: number) => new Promise((r) => setTimeout(r, ms)),
};

// Yahoo renvoie souvent 429 aux requêtes sans cookie : en cas de 401/403/429, on ouvre une
// session (cookie A3 via fc.yahoo.com + crumb) une fois, puis on réessaie avec cookie et crumb.
type YahooSession = { cookie: string; crumb: string };
let yahooSession: Promise<YahooSession | null> | null = null;

async function openYahooSession(): Promise<YahooSession | null> {
  try {
    const r1 = await deps.fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
    const cookie = r1.headers.getSetCookie().map((c: string) => c.split(";")[0]).filter(Boolean).join("; ");
    await r1.body?.cancel();
    if (!cookie) return null;
    const r2 = await deps.fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
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
  const res = await deps.fetch(url, { headers });
  if (![401, 403, 429].includes(res.status)) return res;
  await res.body?.cancel();
  yahooSession ??= openYahooSession();
  const s = await yahooSession;
  if (!s) {
    yahooSession = null;
    return new Response(null, { status: res.status });
  }
  const sep = url.includes("?") ? "&" : "?";
  const retry = await deps.fetch(`${url}${sep}crumb=${encodeURIComponent(s.crumb)}`, { headers: { ...headers, Cookie: s.cookie } });
  if ([401, 403].includes(retry.status)) yahooSession = null; // crumb expiré : nouvelle session au prochain appel
  return retry;
}

type Quote = { price: number; currency: string; time: number | null; points: Point[] };
type RunError = { isin?: string; symbol?: string; error: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const aujourdhui = () => parisDate(null, deps.maintenant());

/** Graphique Yahoo quotidien (range = 5d pour le cours du jour, 5y pour le rattrapage). */
async function fetchChart(symbol: string, range: "5d" | "5y") {
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

/** Série de taux CUR → EUR sur 5 ans (rattrapage), mise en cache pendant le passage ; vide si indisponible. */
const fxSerieCache = new Map<string, Promise<Point[]>>();
function fxSerie5ans(cur: string): Promise<Point[]> {
  if (!fxSerieCache.has(cur)) fxSerieCache.set(cur, fetchChart(`${cur}EUR=X`, "5y").then((s) => s.points).catch(() => []));
  return fxSerieCache.get(cur)!;
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
const EURONEXT_TIMEOUT_MS = 15_000;
const REAL_ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

const micCache = new Map<string, Promise<string>>();
function euronextMic(isin: string): Promise<string> {
  if (!micCache.has(isin)) {
    const p = (async () => {
      const res = await deps.fetch(`${EURONEXT}/instrumentSearch/searchJSON?q=${encodeURIComponent(isin)}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(EURONEXT_TIMEOUT_MS),
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
  const res = await deps.fetch(`${EURONEXT}/ajax/AwlHistoricalPrice/getFullDownloadAjax/${isin}-${mic}?${qs}`, {
    headers: { "User-Agent": UA, Accept: "text/csv,*/*" },
    signal: AbortSignal.timeout(EURONEXT_TIMEOUT_MS),
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

async function synchroniserBinance(admin: any, errors: RunError[]): Promise<BilanBinance> {
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
  let actifs: Record<string, number>;
  try {
    actifs = agreger(await clientBinance(cle, secret, deps.fetch, () => deps.maintenant().getTime()).lire());
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
  for (const w of plan.avertissements) errors.push({ error: w });
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
async function rattraper(ins: { isin: string; symbol: string | null; currency: string }): Promise<{ lignes: LigneCours[]; source: string }> {
  const isin = String(ins.isin);
  const symbol = String(ins.symbol || "").trim();
  const canFallback = REAL_ISIN.test(isin) && String(ins.currency || "EUR").toUpperCase() === "EUR";
  let yahooErr = "sans symbole";
  if (symbol) {
    try {
      const s = await fetchChart(symbol, "5y");
      if (!s.points.length) throw new Error("historique vide");
      const { cur, facteur } = devise(s.currency);
      let points = convertir(s.points, facteur);
      if (cur !== "EUR") {
        const { taux } = await tauxEur(s.currency);
        points = convertirAvecSerie(points, await fxSerie5ans(cur), taux / facteur);
      }
      return { lignes: lignesCours(isin, points, "yahoo"), source: "yahoo" };
    } catch (e) {
      yahooErr = (e as Error).message;
    }
  }
  if (!canFallback) throw new Error(`yahoo: ${yahooErr}`);
  try {
    if (symbol) await deps.attendre(DELAY_MS);
    const f = await fetchEuronext(isin, JOURS_5_ANS);
    return { lignes: lignesCours(isin, f.points, "euronext"), source: "euronext" };
  } catch (e) {
    throw new Error(`yahoo: ${yahooErr} ; euronext: ${(e as Error).message}`);
  }
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
  const started = deps.maintenant();
  const t0 = Date.now();
  const errors: RunError[] = [];
  let updated = 0;
  const coursDuJour: LigneCours[] = [];

  // 2. Cours : Yahoo d'abord ; en cas d'échec (ou sans symbole Yahoo), repli Euronext pour les
  // instruments en EUR identifiés par un vrai ISIN (les ISIN de test `X-…` sont ignorés). X-EUR (euros détenus chez Binance) :
  // cours fixe de 1.
  const { data: instruments, error: instErr } = await admin
    .from("instruments")
    .select("isin, symbol, currency")
    .order("isin");
  if (instErr) {
    errors.push({ error: `lecture des instruments : ${instErr.message}` });
  } else {
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
      const canFallback = REAL_ISIN.test(isin) && String(ins.currency || "EUR").toUpperCase() === "EUR";
      if (!symbol && !canFallback) continue;
      if (Date.now() - t0 > BUDGET_MS) {
        errors.push({ isin, symbol: symbol || undefined, error: "temps dépassé, cours non récupéré" });
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
          yahooErr = (e as Error).message;
        }
      }
      if (!row && canFallback && Date.now() - t0 <= BUDGET_MS) {
        if (symbol) await deps.attendre(DELAY_MS);
        try {
          const f = await fetchEuronext(isin, 14);
          const last = f.points[f.points.length - 1];
          row = { price: last.close, price_date: last.date, source: "euronext" };
          coursDuJour.push(...lignesCours(isin, f.points, "euronext"));
          console.log(`nightly: ${isin} via Euronext ${f.mic} (yahoo : ${yahooErr})`);
        } catch (e) {
          errors.push({ isin, symbol: symbol || undefined, error: `yahoo: ${yahooErr} ; euronext: ${(e as Error).message}` });
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
  }
  const coursEnregistres = await enregistrerCours(admin, coursDuJour, errors);
  console.log(`nightly: ${updated}/${instruments?.length ?? 0} cours mis à jour, ${coursEnregistres} clôture(s) enregistrée(s), ${errors.length} erreur(s)`);

  // 3. Binance (lecture seule) : une erreur n'arrête pas la nuit.
  let binance: BilanBinance;
  try {
    binance = await synchroniserBinance(admin, errors);
  } catch {
    errors.push({ error: "binance : erreur inattendue, synchronisation interrompue." });
    binance = { etat: "erreur" };
  }

  // 4. Rattrapage de l'historique (au plus 10 ISIN, dans le temps restant).
  const rattrapages = { tentes: 0, reussis: 0, lignes: 0 };
  const aRattraper = await admin.rpc("cours_a_rattraper", { p_limite: RATTRAPAGES_MAX });
  if (aRattraper.error) {
    errors.push({ error: `cours_a_rattraper : ${aRattraper.error.message}` });
  } else {
    for (const ins of (aRattraper.data || []).slice(0, RATTRAPAGES_MAX)) {
      if (Date.now() - t0 > RATTRAPAGE_FIN_MS) break;
      const isin = String(ins.isin);
      rattrapages.tentes++;
      try {
        const r = await rattraper(ins);
        if (!r.lignes.length) throw new Error("historique vide");
        const n = await enregistrerCours(admin, r.lignes, errors, isin);
        rattrapages.lignes += n;
        if (n) rattrapages.reussis++;
        console.log(`nightly: historique ${isin} via ${r.source} : ${n} cours`);
      } catch (e) {
        errors.push({ isin, symbol: ins.symbol || undefined, error: `rattrapage : ${(e as Error).message}` });
      }
      const { error } = await admin.from("instruments").update({ cours_rattrapage_le: deps.maintenant().toISOString() }).eq("isin", isin);
      if (error) errors.push({ isin, error: `rattrapage : ${error.message}` });
      await deps.attendre(DELAY_MS);
    }
  }

  // 5. Photos, versements, photo finale, compte rendu.
  const step = async (name: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc(name, args);
    if (error) {
      errors.push({ error: `${name} : ${error.message}` });
      console.error(`nightly: ${name} en échec`, error.message);
      return null;
    }
    return data;
  };

  await step("take_snapshots");
  const recurring = (await step("apply_recurring")) ?? 0;
  const users = (await step("take_snapshots")) ?? 0;
  const fin = await admin.rpc("finish_nightly", {
    p_started: started.toISOString(),
    p_instruments: updated,
    p_errors: errors,
  });
  if (fin.error) {
    console.error("nightly: finish_nightly en échec", fin.error.message);
    errors.push({ error: `finish_nightly : ${fin.error.message}` });
  }

  console.log(`nightly: ${users} utilisateur(s), ${recurring} versement(s), ${Date.now() - t0} ms`);
  return json({
    ok: !fin.error, instruments_updated: updated, cours_enregistres: coursEnregistres, rattrapages, binance,
    users, recurring_applied: recurring, errors,
  });
});
