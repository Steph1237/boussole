// Boussole : Binance en lecture seule (pilote, CP1, docs/superpowers/specs/2026-10-12-cp1-comptes-performance-design.md § 7).
//
// Lecture signée (HMAC-SHA256 de la chaîne de requête avec BINANCE_API_SECRET, hexadécimal, paramètre `signature` ; clé
// BINANCE_API_KEY dans l'en-tête X-MBX-APIKEY ; https://developers.binance.com/docs/binance-spot-api-docs/rest-api/request-security,
// consultée le 2026-10-12) de trois points d'accès, tous en GET :
// - /api/v3/account?omitZeroBalances=true&recvWindow=10000&timestamp=…&signature=… → { balances: [{ asset, free, locked }] } ;
// - /sapi/v1/simple-earn/flexible/position?current=…&size=100&… → { rows: [{ asset, totalAmount }], total } ;
// - /sapi/v1/simple-earn/locked/position?current=…&size=100&…   → { rows: [{ asset, amount }], total }.
// Horodatage : heure du serveur Binance (/api/v3/time, sans signature) quand elle répond, sinon l'horloge locale.
// La clé n'a que le droit de lecture ; aucune écriture chez Binance n'existe dans ce module.
// Les secrets ne sont jamais journalisés ni renvoyés : les erreurs sont traduites en phrases fixes (code Binance tout au plus),
// sans URL (la signature y figure), sans corps de réponse.
//
// Fonctions pures (testées par test/nightly-binance.test.mjs) : signer, traduireErreur, agreger, actifDeIsin, memeEnveloppe,
// planBinance. Client : client(cle, secret, fetch).

export const BINANCE = "https://api.binance.com";
export const ENVELOPPE_BINANCE = "Crypto (Binance)";
export const SEUIL_CREATION_EUR = 10;
const RECV_WINDOW = "10000";
const TAILLE_PAGE = 100;
const PAGES_MAX = 10;
const DELAI_MS = 15_000;
// Jetons réels dont le nom commence par « LD » (les autres « LD<ACTIF> » sont des parts Simple Earn flexible).
const LD_REELS = new Set(["LDO"]);

export class BinanceErreur extends Error {
  status: number;
  code: number | null;
  constructor(message: string, status = 0, code: number | null = null) {
    super(message);
    this.name = "BinanceErreur";
    this.status = status;
    this.code = code;
  }
}

/** Signature HMAC-SHA256 (hexadécimal, minuscules) de `charge` avec `secret`. */
export async function signer(secret: string, charge: string): Promise<string> {
  const enc = new TextEncoder();
  const cle = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cle, enc.encode(charge)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Message d'erreur en français pour une réponse Binance en échec (statut HTTP, code Binance éventuel). Jamais le corps. */
export function traduireErreur(status: number, code: number | null): string {
  if (code === -2014 || code === -2015 || code === -2008 || status === 401)
    return "Binance refuse la clé API (clé invalide, droit de lecture absent ou adresse IP non autorisée).";
  if (code === -1022) return "Binance refuse la signature de la requête (secret API incorrect).";
  if (code === -1021) return "Binance refuse l'horodatage de la requête (horloge décalée).";
  if (status === 429 || status === 418 || code === -1003) return "Binance limite les appels (trop de requêtes) : nouvel essai la nuit prochaine.";
  if (status >= 500) return `Binance est indisponible (HTTP ${status}).`;
  return `Binance a répondu HTTP ${status}${code != null ? ` (code ${code})` : ""}.`;
}

type Solde = { asset: string; free: string | number; locked: string | number };
type Ligne = { asset: string; totalAmount?: string | number; amount?: string | number };
export type LectureBinance = { compte: Solde[]; flexible: Ligne[]; verrouille: Ligne[] };

/** Client Binance en lecture seule. `f` : fetch ; `horloge` : millisecondes locales. */
export function client(cle: string, secret: string, f: typeof fetch, horloge: () => number = () => Date.now()) {
  let decalage = 0;

  async function appeler(chemin: string, params: Record<string, string>, signe: boolean): Promise<any> {
    let qs = new URLSearchParams(params).toString();
    if (signe) {
      qs = new URLSearchParams({ ...params, recvWindow: RECV_WINDOW, timestamp: String(horloge() + decalage) }).toString();
      qs += `&signature=${await signer(secret, qs)}`;
    }
    let res: Response;
    try {
      res = await f(`${BINANCE}${chemin}${qs ? "?" + qs : ""}`, {
        headers: { ...(signe ? { "X-MBX-APIKEY": cle } : {}), Accept: "application/json" },
        signal: AbortSignal.timeout(DELAI_MS),
      });
    } catch {
      throw new BinanceErreur("Binance est injoignable (réseau ou délai dépassé).");
    }
    const texte = await res.text().catch(() => "");
    let corps: any = null;
    try { corps = texte ? JSON.parse(texte) : null; } catch { corps = null; }
    if (!res.ok) {
      const code = typeof corps?.code === "number" ? corps.code : null;
      throw new BinanceErreur(traduireErreur(res.status, code), res.status, code);
    }
    if (corps == null) throw new BinanceErreur("Binance a renvoyé une réponse illisible.", res.status);
    return corps;
  }

  async function pages(chemin: string): Promise<Ligne[]> {
    const lignes: Ligne[] = [];
    for (let current = 1; current <= PAGES_MAX; current++) {
      const r = await appeler(chemin, { current: String(current), size: String(TAILLE_PAGE) }, true);
      const rows: Ligne[] = Array.isArray(r?.rows) ? r.rows : [];
      lignes.push(...rows);
      const total = Number(r?.total);
      if (rows.length < TAILLE_PAGE || (isFinite(total) && lignes.length >= total)) return lignes;
    }
    throw new BinanceErreur("Binance : trop de positions Simple Earn (plus de 1 000), lecture interrompue.");
  }

  return {
    /** Aligne l'horodatage sur l'heure du serveur Binance (sans effet si /api/v3/time échoue). */
    async synchroniserHeure(): Promise<void> {
      try {
        const r = await appeler("/api/v3/time", {}, false);
        if (typeof r?.serverTime === "number") decalage = r.serverTime - horloge();
      } catch { decalage = 0; }
    },
    async compte(): Promise<Solde[]> {
      const r = await appeler("/api/v3/account", { omitZeroBalances: "true" }, true);
      if (!Array.isArray(r?.balances)) throw new BinanceErreur("Binance a renvoyé un portefeuille illisible.");
      return r.balances;
    },
    flexible: () => pages("/sapi/v1/simple-earn/flexible/position"),
    verrouille: () => pages("/sapi/v1/simple-earn/locked/position"),
    /** Les trois lectures ; la moindre erreur interrompt tout (sinon des avoirs en Earn passeraient pour vendus). */
    async lire(): Promise<LectureBinance> {
      await this.synchroniserHeure();
      const compte = await this.compte();
      const flexible = await this.flexible();
      const verrouille = await this.verrouille();
      return { compte, flexible, verrouille };
    },
  };
}

const nombre = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return isFinite(n) ? n : 0;
};
const arrondi8 = (x: number) => parseFloat(x.toFixed(8));

/** Quantité totale par actif (au comptant libre + bloqué, Simple Earn flexible et verrouillé), quantités nulles ignorées.
 *  « LD<ACTIF> » (part Simple Earn flexible au comptant) est ramené à <ACTIF>, sauf si la position flexible de cet actif est
 *  déjà lue (pas de double compte) et sauf les vrais jetons en LD… (LDO). */
export function agreger({ compte, flexible, verrouille }: LectureBinance): Record<string, number> {
  const total = new Map<string, number>();
  const ajouter = (actif: string, q: number) => {
    const a = String(actif || "").trim().toUpperCase();
    if (!a || !/^[A-Z0-9]+$/.test(a) || !(q > 0)) return;
    total.set(a, (total.get(a) ?? 0) + q);
  };
  const enFlexible = new Set((flexible || []).filter((r) => nombre(r.totalAmount ?? r.amount) > 0).map((r) => String(r.asset || "").trim().toUpperCase()));
  for (const b of compte || []) {
    const actif = String(b.asset || "").trim().toUpperCase();
    const q = nombre(b.free) + nombre(b.locked);
    if (!(q > 0)) continue;
    if (actif.length > 2 && actif.startsWith("LD") && !LD_REELS.has(actif)) {
      const sous = actif.slice(2);
      if (!enFlexible.has(sous)) ajouter(sous, q);
      continue;
    }
    ajouter(actif, q);
  }
  for (const r of flexible || []) ajouter(r.asset, nombre(r.totalAmount ?? r.amount));
  for (const r of verrouille || []) ajouter(r.asset, nombre(r.amount ?? r.totalAmount));
  const out: Record<string, number> = {};
  for (const [a, q] of [...total.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const v = arrondi8(q);
    if (v > 0) out[a] = v;
  }
  return out;
}

/** Actif d'un ISIN crypto : « X-BTC » (format de l'app) ou « X-BTC-EUR » (format de la migration depuis le Pilotage) → « BTC ». */
export function actifDeIsin(isin: unknown): string | null {
  const m = String(isin ?? "").trim().toUpperCase().match(/^X-([A-Z0-9]+)(?:-EUR)?$/);
  return m ? m[1] : null;
}

const normEnveloppe = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, "");
/** Même enveloppe, sans tenir compte de la casse ni des espaces. */
export const memeEnveloppe = (a: unknown, b: unknown) => normEnveloppe(a) === normEnveloppe(b);

export type LignePosition = {
  id: string; name?: string; envelope: string; owner?: string; bloc?: string; isin: string | null; qty: number | string | null;
  status: string; source_auto: string | null; created_at?: string;
};
export type Plan = {
  maj: { id: string; actif: string; qty: number; reactiver: boolean }[];
  creer: { actif: string; qty: number; valeur: number }[];
  cloturer: { id: string; actif: string | null }[];
  petits: { actif: string; qty: number; valeur: number }[];
  sansCours: { actif: string; qty: number }[];
  avertissements: string[];
};

/** Plan d'application aux lignes de l'enveloppe Binance (pur).
 *  - actif détenu avec une ligne de même actif (X-<ACTIF> ou X-<ACTIF>-EUR) dans l'enveloppe : quantité mise à jour sur la
 *    ligne active (de préférence déjà alimentée par Binance, sinon la plus ancienne) ; à défaut une ligne clôturée est rouverte ;
 *  - actif détenu sans ligne : nouvelle ligne si sa valeur (quantité × cours EUR) dépasse 10 € ; sinon ignoré (petits) ou, sans
 *    cours, signalé (sansCours) ;
 *  - ligne alimentée par Binance (source_auto = 'binance'), non clôturée, dont l'actif n'est plus détenu : clôturée.
 *    Par prudence, rien n'est clôturé quand Binance renvoie un portefeuille entièrement vide. */
export function planBinance({ actifs, lignes, cours }: {
  actifs: Record<string, number>; lignes: LignePosition[]; cours: Record<string, number | null | undefined>;
}): Plan {
  const plan: Plan = { maj: [], creer: [], cloturer: [], petits: [], sansCours: [], avertissements: [] };
  const dansEnveloppe = (lignes || []).filter((l) => memeEnveloppe(l.envelope, ENVELOPPE_BINANCE) && actifDeIsin(l.isin));
  const rang = (l: LignePosition) => (l.status === "clôturé" ? 2 : 0) + (l.source_auto === "binance" ? 0 : 1);
  const retenues = new Set<string>();
  for (const [actif, qty] of Object.entries(actifs)) {
    const candidats = dansEnveloppe
      .filter((l) => actifDeIsin(l.isin) === actif)
      .sort((a, b) => rang(a) - rang(b) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id)));
    if (candidats.length) {
      const l = candidats[0];
      retenues.add(l.id);
      plan.maj.push({ id: l.id, actif, qty, reactiver: l.status === "clôturé" });
      if (candidats.filter((c) => c.status !== "clôturé").length > 1)
        plan.avertissements.push(`Binance : plusieurs lignes ${actif} dans l'enveloppe ${ENVELOPPE_BINANCE}, quantité reportée sur une seule.`);
      continue;
    }
    const prix = cours[actif];
    if (prix == null || !isFinite(prix) || prix <= 0) { plan.sansCours.push({ actif, qty }); continue; }
    const valeur = Math.round(qty * prix * 100) / 100;
    (valeur > SEUIL_CREATION_EUR ? plan.creer : plan.petits).push({ actif, qty, valeur });
  }
  const disparues = dansEnveloppe.filter((l) =>
    l.source_auto === "binance" && l.status !== "clôturé" && !retenues.has(l.id) && !(actifDeIsin(l.isin)! in actifs));
  if (disparues.length && Object.keys(actifs).length === 0)
    plan.avertissements.push("Binance renvoie un portefeuille vide : aucune ligne clôturée par prudence.");
  else for (const l of disparues) plan.cloturer.push({ id: l.id, actif: actifDeIsin(l.isin) });
  return plan;
}

const NOMS: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ether", BNB: "BNB", SOL: "Solana", XRP: "XRP", ADA: "Cardano", DOT: "Polkadot", AVAX: "Avalanche",
  LINK: "Chainlink", MATIC: "Polygon", POL: "Polygon", DOGE: "Dogecoin", USDT: "Tether (USDT)", USDC: "USD Coin (USDC)", EUR: "Euros",
};
/** Nom affiché d'une nouvelle ligne. */
export const nomActif = (actif: string) => NOMS[actif] ?? actif;
