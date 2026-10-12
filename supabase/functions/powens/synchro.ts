// Boussole : synchronisation d'une connexion Powens (BQ1, docs/superpowers/specs/2026-10-12-bq1-powens-design.md § 2).
//
// La notification n'est qu'un déclencheur : connexion, comptes, placements et opérations sont relus par l'API avec le jeton de
// l'utilisateur, puis `planifier` (pure, testable sans base) calcule les écritures, que `synchroniser` applique. Idempotent :
// upserts sur les identifiants Powens, lignes de marché retrouvées par banque_placements.position_id, propositions repérées par
// un lot déterministe par compte. Toutes les écritures portent ou filtrent user_id (client avec la clé de service).
// Concurrence (deux notifications, nouvel essai de Powens) : bail par (utilisateur, connexion) pris par banque_verrouiller
// après la lecture de la connexion (synchronisation sautée et notée s'il est tenu, libéré à la fin) ; identifiants
// déterministes des lignes de marché (powens-pos-<user>-<placement>) et des propositions (powens-prop-<user>-<compte>),
// insérés par upsert … ignoreDuplicates ; banque_recalculer_mois prend un verrou consultatif par utilisateur.
// Ce qui appartient à l'utilisateur n'est jamais écrasé : quantité et clôture seulement sur une ligne encore alimentée
// (source_auto = 'powens') ; une ligne de placement supprimée n'est pas recréée (banque_placements.ligne_creee_le) ; un compte
// ignoré (banque_comptes.ignore) n'est ni rattaché ni proposé ; une proposition n'est déposée qu'une fois par compte
// (banque_comptes.propose_le), et jamais pour un compte enveloppe (pea, compte_titres, assurance_vie, per) ; le capital
// restant dû d'un crédit ne vient que d'un compte de type credit. Compte enveloppe : un placement encore sans lien adopte
// d'abord une ligne existante de l'utilisateur (même ISIN, même enveloppe, même titulaire ; liquidités : ligne manuelle
// « liquid… »/« espèces ») dont seuls qty/isin (ou value) passent à Powens ; une ligne n'est créée qu'à défaut (aucun doublon).
// Rapprochement automatique (migration 0022, `rapprocher`, pur) : connexion en double (même connecteur Powens, à défaut même
// établissement ; comptes identiques = même type, même nom normalisé, solde à 1 € près ; la connexion qui a le moins de comptes, à
// égalité la plus récente, est marquée ; ses comptes jumeaux ni rattachés ni proposés, leur rattachement automatique passe au jumeau),
// puis, pour chaque compte actif, suivi, sans rattachement ni refus d'un rattachement automatique (auto_retire_le, ou ligne créée puis
// supprimée) : crédit (capital restant dû à max(1 €, 1 %) près, sinon mot significatif partagé), livret (produit Livret A, LDDS, LEP,
// CEL, PEL par type ou nom ; générique : seule ligne d'une enveloppe livret*), courant (ligne « établissement + courant »), enveloppe
// (≥ 1 ISIN et ≥ 50 % des ISIN Powens ; PEA-PME jamais dans « PEA », et inversement). Un candidat : rattaché (rattache_auto) ; plusieurs :
// suggestion ; aucun : création (courant → « Compte courant <établissement> » ; livret → ligne au nom du produit dans « Livrets » ;
// PEA-PME → enveloppe « PEA-PME » ; compte-titres → « Compte-titres <établissement> », titulaire p1 si le foyer compte une personne,
// sinon suggestion), cree_auto. Jamais une ligne, un crédit ou une enveloppe déjà rattaché ; plus de proposition que pour un compte
// « autre ». Rattachement écrit seulement si le compte est encore libre (sinon la ligne créée pour l'occasion est retirée).
// Budget réel (CP1, docs/superpowers/specs/2026-10-12-cp1-comptes-performance-design.md § 5) : après la lecture d'une connexion, les
// opérations des 90 jours de l'utilisateur (toutes connexions) sont relues (par pages de 1000) et fusionnées avec celles du passage ;
// `rapprocherVirements` (pur) classe les virements entre comptes suivis (montant opposé à 0,01 €, ≤ 3 jours, un pour un, le plus
// proche) en « virement_interne », ou « epargne » pour la sortie d'un courant vers l'épargne ; `epargneSansContrepartie` classe en
// « epargne » les versements vers des placements non synchronisés (libellé, versement programmé, virement vers soi) ; ces deux
// catégories ne sont jamais remplacées par la catégorie Powens ; les autres comptes modifiés sont mis à jour et leurs mois
// recalculés. `revenusDetectes` / `propositionRevenus` (purs) déposent au plus une proposition profil (salaire net de la personne 1,
// source « Powens — revenus détectés », jamais appliquée).
// Robustesse : une lecture en échec n'efface rien (placements, opérations, comptes) ; une erreur sur un compte ou sur une étape
// d'écriture n'arrête pas les autres ; le dernier échec est résumé dans banque_connexions.message.
//
// Champs Powens lus (documentation consultée le 2026-10-12) :
// - connexion (https://docs.powens.com/api-reference/user-connections/connections) : id, state, error_message, last_update
//   (UTC, « AAAA-MM-JJ HH:MM:SS »), connector.name (expand=connector). États :
//   https://docs.powens.com/documentation/integration-guides/sca-and-connection-states ;
// - compte (https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts) : id, name, original_name, balance,
//   currency.id, type (AccountTypeName, https://docs.powens.com/api-reference/products/data-aggregation/bank-account-types),
//   disabled, deleted, last_update, loan.remaining_capital (si présent) ; le numéro et l'IBAN ne sont jamais lus ;
// - placement (https://docs.powens.com/api-reference/products/data-aggregation/investments) : id, code, code_type (ISIN | AMF),
//   label, quantity, unitprice (prix de revient unitaire), valuation, deleted ;
// - opération (https://docs.powens.com/api-reference/products/data-aggregation/bank-transactions) : id, date, value,
//   simplified_wording, wording, original_wording, categories, coming, deleted.
import { categorieBoussole } from "./categories.ts";

export const ETATS_POWENS = [
  "SCARequired", "webauthRequired", "additionalInformationNeeded", "wrongpass", "decoupled", "validating", "actionNeeded",
  "passwordExpired", "rateLimiting", "websiteUnavailable", "bug",
];
export const JOURS_DETAIL = 90;
const TYPES_PLACEMENTS = ["pea", "compte_titres", "assurance_vie", "per"];
const TYPES_OPERATIONS = ["courant", "livret", "autre"];
/** Comptes qui se rattachent à une enveloppe (une ligne par placement) : jamais de proposition « créer une ligne ». */
const TYPES_ENVELOPPE = TYPES_PLACEMENTS;
/** Comptes qui ne reçoivent jamais de proposition « créer une ligne » (rapprochement automatique ou rattachement dédié). */
const TYPES_SANS_PROPOSITION = ["courant", "livret", "credit", ...TYPES_ENVELOPPE];
/** Identifiant du connecteur Powens d'une connexion (id_connector, ou connector.id avec expand=connector) ; null s'il manque. */
export function connecteurDe(cx: any): number | null {
  const v = Number(cx?.id_connector ?? cx?.connector?.id);
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}
const ENVELOPPE_PROPOSEE: Record<string, string> = {
  courant: "Compte courant", livret: "Livret", pea: "PEA", compte_titres: "Compte-titres", assurance_vie: "Assurance-vie", per: "PER", autre: "",
};
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/* ---------- contenu sensible (mêmes motifs que public.contenu_sensible et mcp/memoire.ts SENSIBLE) ---------- */
export const SENSIBLE = [
  "[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]){11,30}",
  "(?<![0-9])[0-9]{4} ?[0-9]{4} ?[0-9]{4} ?[0-9]{1,7}(?![0-9])",
  "mot de passe|password|code secret|code pin|identifiant de connexion",
];
const IBAN_CHIFFRES_MIN = 12;
const MASQUE = "••••";

/** Libellé nettoyé : suites de 8 chiffres ou plus (sauf dans un ISIN valide), IBAN et numéros de carte masqués ; mots
    interdits → « Libellé masqué » ; espaces réduits ; 140 caractères au plus. Le résultat passe toujours la contrainte
    contenu_sensible (un ISIN a au plus 10 chiffres, sous le seuil de 12 de la contrainte). */
export function nettoyerLibelle(t: unknown): string {
  let s = String(t ?? "").replace(/\s+/g, " ").trim();
  // IBAN par groupes de 4 (sans manger le mot qui suit), puis carte, puis toute suite de 8 chiffres ou plus, puis le motif IBAN
  // large de contenu_sensible en dernier recours.
  s = s.replace(/(?<![A-Z0-9])[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Z0-9])/g,
    (m) => (m.replace(/[^0-9]/g, "").length >= IBAN_CHIFFRES_MIN ? MASQUE : m));
  s = s.replace(new RegExp(SENSIBLE[1], "g"), MASQUE);
  s = s.replace(/(?<![A-Z0-9])[A-Z]{2}[A-Z0-9]{9}[0-9](?![A-Z0-9])|[0-9]{8,}/g, (m) => (ISIN.test(m) ? m : MASQUE));
  s = s.replace(new RegExp(SENSIBLE[0], "g"), (m) => (m.replace(/[^0-9]/g, "").length >= IBAN_CHIFFRES_MIN ? MASQUE : m));
  if (new RegExp(SENSIBLE[2], "i").test(s)) return "Libellé masqué";
  s = s.replace(/\s+/g, " ").trim();
  return s.length > 140 ? s.slice(0, 140).trimEnd() : s;
}

/** Type Boussole d'un compte Powens (AccountTypeName). */
export function normaliserType(compte: any): string {
  const t = String(compte?.type ?? "").toLowerCase();
  if (["checking", "card", "deposit", "joint"].includes(t)) return "courant";
  if (["savings", "livret_a", "livret_b", "ldds", "cel", "pel", "csl", "cat"].includes(t)) return "livret";
  if (t === "pea") return "pea";
  if (t === "market") return "compte_titres";
  if (["lifeinsurance", "capitalisation"].includes(t)) return "assurance_vie";
  if (["per", "perp", "perco", "madelin", "article83"].includes(t)) return "per";
  if (["loan", "consumercredit", "revolvingcredit"].includes(t)) return "credit";
  return "autre";
}

/** État de connexion : null (à jour) ou l'un des 11 états Powens ; un état inconnu devient « bug » (contrainte de la base). */
export function normaliserEtat(etat: unknown): string | null {
  if (etat == null || etat === "") return null;
  return ETATS_POWENS.includes(String(etat)) ? String(etat) : "bug";
}

/** Date AAAA-MM-JJ à Paris. */
export function dateParis(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
}
export function premierDuMois(date: string): string {
  return date.slice(0, 8) + "01";
}
function moinsJours(date: string, jours: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - jours);
  return d.toISOString().slice(0, 10);
}
/** Décalage de Paris par rapport à UTC (en ms) à l'instant `t`. */
function decalageParis(t: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}
/** Horodatage Powens → ISO 8601 UTC ; null si illisible. Sans fuseau (« AAAA-MM-JJ HH:MM:SS »), Powens donne l'heure de
    Paris (constaté en sandbox le 2026-10-12 : last_update 11:13 pour une synchronisation à 09:13 UTC) : elle est convertie. */
export function datePowens(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  if (m[8]) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ""}${m[8]}`;
  const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  let t = local - decalageParis(local);
  t = local - decalageParis(t); // second passage : juste autour des changements d'heure
  return new Date(t).toISOString().replace(".000Z", "Z");
}
const jour = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const nombre = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const texte = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Uuid déterministe (forme v5 : SHA-256 tronqué, version 5, variante RFC 4122). */
export async function uuidDeterministe(graine: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(graine))).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
/** Lot de la proposition de création de ligne d'un compte : repère la proposition déjà déposée pour ce compte. */
export function lotProposition(userId: string, compteId: number | string): Promise<string> {
  return uuidDeterministe(`powens-${userId}-${compteId}`);
}
/** Identifiant de la proposition d'un compte (une seule, même si deux synchronisations la déposent en même temps). */
export function idProposition(userId: string, compteId: number | string): Promise<string> {
  return uuidDeterministe(`powens-prop-${userId}-${compteId}`);
}
/** Identifiant de la ligne de marché d'un placement. */
export function idLigne(userId: string, placementId: number | string): Promise<string> {
  return uuidDeterministe(`powens-pos-${userId}-${placementId}`);
}
/** Identifiant de la ligne « Compte courant <établissement> » créée pour un compte courant sans ligne correspondante. */
export function idCourant(userId: string, compteId: number | string): Promise<string> {
  return uuidDeterministe(`powens-cc-${userId}-${compteId}`);
}
/** Identifiant de la ligne créée pour un livret sans ligne correspondante. */
export function idLivret(userId: string, compteId: number | string): Promise<string> {
  return uuidDeterministe(`powens-lv-${userId}-${compteId}`);
}
/** Identifiant de la ligne de liquidités d'un compte enveloppe. */
export function idLiquidites(userId: string, compteId: number | string): Promise<string> {
  return uuidDeterministe(`powens-liq-${userId}-${compteId}`);
}

function isinDe(inv: any): string | null {
  if (inv?.code_type != null && String(inv.code_type).toUpperCase() !== "ISIN") return null;
  const c = String(inv?.code ?? "").toUpperCase().replace(/\s+/g, "");
  return ISIN.test(c) ? c : null;
}
/** Minuscules, sans accents. */
const plat = (v: unknown): string => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Enveloppe comparable : sans casse ni espaces (« PEA » = « pea » = « P E A »). */
const enveloppeCle = (v: unknown): string => String(v ?? "").toLowerCase().replace(/\s+/g, "");
/** Placement de liquidités : sans ISIN, libellé contenant « liquidit » (accents et casse ignorés). */
const estLiquidites = (inv: any): boolean => !isinDe(inv) && plat(inv?.label).includes("liquidit");

/* ---------- rapprochement automatique et doublons ---------- */
/** Texte comparable : minuscules, sans accents, tout ce qui n'est ni lettre ni chiffre devient une espace, espaces réduites. */
export const normNom = (v: unknown): string => plat(v).replace(/[^a-z0-9]+/g, " ").trim();
const mots = (v: unknown): string[] => normNom(v).split(" ").filter(Boolean);
/** La suite de mots `seq` apparaît d'un bloc dans `ts`. */
function contient(ts: string[], seq: string[]): boolean {
  if (!seq.length) return false;
  for (let i = 0; i + seq.length <= ts.length; i++) if (seq.every((m, j) => ts[i + j] === m)) return true;
  return false;
}
/** Produits d'épargne réglementée : type Powens, motifs du nom (suites de mots), nom de la ligne créée. */
export const PRODUITS_LIVRET = [
  { cle: "livret_a", nom: "Livret A", types: ["livret_a"], motifs: [["livret", "a"]] },
  { cle: "ldds", nom: "LDDS", types: ["ldds"], motifs: [["ldds"], ["ldd"], ["livret", "developpement", "durable"]] },
  { cle: "lep", nom: "LEP", types: ["lep"], motifs: [["lep"], ["livret", "epargne", "populaire"]] },
  { cle: "cel", nom: "CEL", types: ["cel"], motifs: [["cel"], ["compte", "epargne", "logement"]] },
  { cle: "pel", nom: "PEL", types: ["pel"], motifs: [["pel"], ["plan", "epargne", "logement"]] },
];
/** Produit d'un compte livret : type Powens d'abord, puis nom ; null = livret générique. */
export function produitLivret(typePowens: unknown, nom: unknown) {
  const t = String(typePowens ?? "").toLowerCase(), ts = mots(nom);
  return PRODUITS_LIVRET.find((p) => p.types.includes(t)) ?? PRODUITS_LIVRET.find((p) => p.motifs.some((m) => contient(ts, m))) ?? null;
}
const nomProduit = (nom: unknown) => { const ts = mots(nom); return PRODUITS_LIVRET.find((p) => p.motifs.some((m) => contient(ts, m))) ?? null; };
/** Mots significatifs d'un crédit, par famille ; « pret » est générique (ne sert que si le nom n'a rien de plus précis). */
const FAMILLES_CREDIT: Record<string, string[]> = {
  pret: ["pret", "prets", "emprunt", "credit", "credits"],
  etudiant: ["etudiant", "etudiants", "etudiante", "etude", "etudes"],
  immo: ["immo", "immobilier", "immobiliere", "habitat", "logement", "residence", "maison", "appartement"],
  auto: ["auto", "automobile", "voiture", "vehicule", "moto"],
  conso: ["conso", "consommation", "personnel", "perso"],
  travaux: ["travaux", "renovation"],
  ptz: ["ptz"],
  renouvelable: ["revolving", "renouvelable"],
};
function famillesCredit(nom: unknown): Set<string> {
  const ts = mots(nom), out = new Set<string>();
  for (const [f, ms] of Object.entries(FAMILLES_CREDIT)) if (ts.some((t) => ms.includes(t))) out.add(f);
  return out;
}
/** Type d'une enveloppe Boussole d'après son nom (null : nom non parlant) et drapeau PME. */
export function typeEnveloppe(nom: unknown): { type: string | null; pme: boolean } {
  const ts = mots(nom), n = ts.join(" ");
  const pme = ts.includes("pme") || /pme/.test(n);
  if (ts.includes("pea") || /^pea/.test(n)) return { type: "pea", pme };
  if (ts.includes("cto") || contient(ts, ["compte", "titres"]) || contient(ts, ["compte", "titre"]) || contient(ts, ["comptes", "titres"])) return { type: "compte_titres", pme };
  if (contient(ts, ["assurance", "vie"]) || ts.includes("av")) return { type: "assurance_vie", pme };
  if (["per", "perin", "perp", "perco"].some((m) => ts.includes(m))) return { type: "per", pme };
  if (/^livret/.test(n) || ["ldds", "lep", "cel", "pel"].some((m) => ts.includes(m))) return { type: "livret", pme };
  if (ts.includes("courant") || ts.includes("courants")) return { type: "courant", pme };
  return { type: null, pme };
}
const r2 = (v: number) => Math.round(v * 100) / 100;
const fr = (v: number) => r2(v).toFixed(2).replace(".", ",");

/** Compte frais (lu chez Powens) vu par le rapprochement. */
export type CompteRapproche = { id: number; type: string; typePowens: string; nom: string; solde: number | null; crd: number | null; actif: boolean;
  isins: string[] | null };
export type EntreeRapprochement = {
  userId: string; aujourdhui: string; maintenant: string;
  connexion: { id: number; etablissement: string | null; connecteur: number | null; cree_le?: string | null; doublon_de?: number | null };
  comptes: CompteRapproche[];
  /** Tous les comptes de l'utilisateur en base (toutes connexions) : rattachements, ignore, doublon_de, rattache_auto, auto_retire_le. */
  etatComptes: any[];
  /** Toutes les connexions de l'utilisateur en base (id, etablissement, connecteur, cree_le, doublon_de). */
  connexions: any[];
  lignes: any[]; credits: any[];
  /** Lignes déjà liées à un placement (banque_placements.position_id). */
  liees: string[];
  /** Foyer de deux personnes : true, false, ou null si inconnu (titulaire d'une enveloppe créée). */
  deuxPersonnes: boolean | null;
  /** Identifiants déterministes des lignes créées : courant (powens-cc-…) et livret (powens-lv-…), par compte. */
  idsCourant: Record<string, string>; idsLivret: Record<string, string>;
};
type Auto = { patch: Record<string, unknown>; cree: boolean; ligne?: any; suggestion: any };
export type ResultatRapprochement = {
  comptes: Record<string, { auto: Auto | null; suggestion: any; doublon_de: number | null }>;
  connexionDoublon: number | null;
  autres: {
    comptes: { connexion_id: number; id: number; doublon_de: number | null }[]; connexions: { id: number; doublon_de: number | null }[];
    /** Comptes en double dont le rattachement automatique passe au compte jumeau : détachés d'abord (unicité ligne / crédit). */
    detacher: number[];
    /** Rattachement automatique repris par le compte jumeau d'une autre connexion (le compte de cette connexion est en double). */
    transferts: { id: number; patch: Record<string, unknown>; cree: boolean }[];
  };
  nouveauxDoublons: number[];
};

/** Rapprochement automatique (pur) : comptes en double d'une autre connexion du même établissement, puis, pour chaque compte
    actif, non ignoré, sans rattachement ni refus d'un rattachement automatique, le rattachement évident (un seul candidat), une
    création (courant, livret, PEA-PME, compte-titres sans correspondance) ou une suggestion (plusieurs candidats). Jamais une ligne,
    un crédit ou une enveloppe déjà rattaché à un autre compte. */
export function rapprocher(e: EntreeRapprochement): ResultatRapprochement {
  const res: ResultatRapprochement = { comptes: {}, connexionDoublon: null, autres: { comptes: [], connexions: [], detacher: [], transferts: [] }, nouveauxDoublons: [] };
  const X = e.connexion, idX = Number(X.id);
  const etat = (e.etatComptes ?? []).filter(Boolean);
  const etatDe = new Map(etat.filter((c) => Number(c.connexion_id) === idX).map((c) => [String(c.id), c]));
  const actifsX = e.comptes.filter((c) => c.actif);

  /* 1. Doublons de connexion : autre connexion du même établissement (même connecteur Powens, à défaut même nom). Le
        rattachement automatique d'un compte en double passe à son jumeau (sans quoi le jumeau créerait une seconde ligne) ; un
        rattachement choisi par l'utilisateur reste où il est, et le jumeau reçoit seulement une suggestion. */
  const marqueX: Record<string, number> = {};
  const repris: Record<string, { patch: Record<string, unknown>; cree: boolean } | { suggestion: any }> = {};
  const cible = (k: any): Record<string, unknown> | null => k?.ignore === true ? null : texte(k?.position_id) ? { position_id: String(k.position_id) }
    : texte(k?.enveloppe) ? { enveloppe: String(k.enveloppe), titulaire: k.titulaire === "p2" ? "p2" : "p1" } : texte(k?.credit_id) ? { credit_id: String(k.credit_id) } : null;
  const libre = (k: any) => k?.ignore !== true && !cible(k) && !texte(k?.auto_retire_le) && !texte(k?.rattache_auto);
  const cleEtab = (c: any) => normNom(c?.etablissement);
  const memeEtab = (y: any) => (X.connecteur != null && y.connecteur != null ? Number(y.connecteur) === Number(X.connecteur)
    : !!cleEtab(X) && cleEtab(y) === cleEtab(X));
  const plusRecente = (a: any, b: any) => {
    const ta = Date.parse(a?.cree_le ?? ""), tb = Date.parse(b?.cree_le ?? "");
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb;
    return Number(a.id) > Number(b.id);
  };
  for (const Y of (e.connexions ?? []).filter((y) => y && Number(y.id) !== idX && memeEtab(y))) {
    const idY = Number(Y.id);
    const actifsY = etat.filter((c) => Number(c.connexion_id) === idY && c.actif !== false);
    const libres = [...actifsY], paires: [CompteRapproche, any][] = [];
    for (const x of actifsX) {
      const i = libres.findIndex((y) => y.type === x.type && normNom(y.nom) && normNom(y.nom) === normNom(x.nom)
        && x.solde != null && y.solde != null && Math.abs(Number(y.solde) - x.solde) <= 1);
      if (i >= 0) { paires.push([x, libres[i]]); libres.splice(i, 1); }
    }
    const xDoublon = paires.length > 0 && (actifsX.length < actifsY.length || (actifsX.length === actifsY.length && plusRecente(X, Y)));
    const marqueY: Record<string, number> = {};
    if (xDoublon) {
      for (const [x, y] of paires) {
        marqueX[String(x.id)] = Number(y.id);
        const kx = etatDe.get(String(x.id)), t = cible(kx);
        if (t && texte(kx?.rattache_auto) && libre(y)) {
          res.autres.detacher.push(Number(x.id));
          res.autres.transferts.push({ id: Number(y.id), patch: t, cree: kx?.cree_auto === true });
        }
      }
      if (paires.length === actifsX.length) res.connexionDoublon = idY;
    } else {
      for (const [x, y] of paires) {
        marqueY[String(y.id)] = Number(x.id);
        const t = cible(y);
        if (!t) continue;
        if (texte(y.rattache_auto)) { res.autres.detacher.push(Number(y.id)); repris[String(x.id)] = { patch: t, cree: y.cree_auto === true }; }
        else repris[String(x.id)] = { suggestion: t };
      }
    }
    // Comptes de Y : marque posée, ou retirée si elle visait un compte de X qui n'est plus jumeau.
    const idsX = new Set(e.comptes.map((c) => String(c.id)));
    for (const y of etat.filter((c) => Number(c.connexion_id) === idY)) {
      const avant = y.doublon_de == null ? null : Number(y.doublon_de);
      const apres = marqueY[String(y.id)] ?? (avant != null && idsX.has(String(avant)) ? null : avant);
      if (apres !== avant) {
        res.autres.comptes.push({ connexion_id: idY, id: Number(y.id), doublon_de: apres });
        if (apres != null && avant == null) res.nouveauxDoublons.push(Number(y.id));
      }
    }
    const yAvant = Y.doublon_de == null ? null : Number(Y.doublon_de);
    const yApres = !xDoublon && paires.length > 0 && paires.length === actifsY.length ? idX : yAvant === idX ? null : yAvant;
    if (yApres !== yAvant) res.autres.connexions.push({ id: idY, doublon_de: yApres });
  }

  /* 2. Rapprochement, compte par compte. Prises : lignes, crédits et enveloppes déjà rattachés ailleurs (mis à jour au fil). */
  const prisesLignes = new Set<string>((e.liees ?? []).map(String));
  const prisesCredits = new Set<string>(), prisesEnv = new Set<string>();
  const cleEnv = (env: unknown, tit: unknown) => enveloppeCle(env) + "|" + (tit === "p2" ? "p2" : "p1");
  const idsX = new Set(e.comptes.map((c) => String(c.id)));
  const detaches = new Set(res.autres.detacher.map(String));
  for (const c of etat) {
    if (Number(c.connexion_id) === idX && idsX.has(String(c.id))) continue; // comptes frais : ajoutés ci-dessous
    if (detaches.has(String(c.id))) continue; // rattachement repris par le jumeau
    if (texte(c.position_id)) prisesLignes.add(String(c.position_id));
    if (texte(c.credit_id)) prisesCredits.add(String(c.credit_id));
    if (texte(c.enveloppe)) prisesEnv.add(cleEnv(c.enveloppe, c.titulaire));
  }
  for (const c of e.comptes) {
    const r = etatDe.get(String(c.id)) ?? {};
    if (r.ignore === true || detaches.has(String(c.id))) continue;
    if (texte(r.position_id)) prisesLignes.add(String(r.position_id));
    if (texte(r.credit_id)) prisesCredits.add(String(r.credit_id));
    if (texte(r.enveloppe)) prisesEnv.add(cleEnv(r.enveloppe, r.titulaire));
  }
  const lignesOk = () => (e.lignes ?? []).filter((p) => p && texte(p.id) && (p.user_id == null || p.user_id === e.userId)
    && p.status !== "clôturé" && !prisesLignes.has(String(p.id)));
  const etab = texte(X.etablissement);
  const courantsX = actifsX.filter((c) => c.type === "courant" && !marqueX[String(c.id)]);

  for (const c of e.comptes) {
    const r = etatDe.get(String(c.id)) ?? {};
    const sortie = { auto: null as Auto | null, suggestion: null as any, doublon_de: marqueX[String(c.id)] ?? null };
    res.comptes[String(c.id)] = sortie;
    const avant = r.doublon_de == null ? null : Number(r.doublon_de);
    if (sortie.doublon_de != null && avant == null) res.nouveauxDoublons.push(Number(c.id));
    if (!c.actif || r.ignore === true || sortie.doublon_de != null) continue;
    if (texte(r.position_id) || texte(r.enveloppe) || texte(r.credit_id)) continue;
    // Compte jumeau d'un compte en double : il reprend son rattachement automatique (ou reçoit en suggestion le rattachement choisi).
    const rep = repris[String(c.id)];
    if (rep) {
      const t: any = "patch" in rep ? rep.patch : rep.suggestion;
      const sugg = { type: t.position_id ? "ligne" : t.enveloppe ? "enveloppe" : "credit", ...(t.position_id ? { id: t.position_id } : t.credit_id ? { id: t.credit_id } : { enveloppe: t.enveloppe, titulaire: t.titulaire }),
        libelle: t.enveloppe ? `${t.enveloppe} (${t.titulaire})` : (t.position_id ? (e.lignes ?? []).find((p) => String(p.id) === t.position_id)?.name : (e.credits ?? []).find((k) => String(k.id) === t.credit_id)?.nom) ?? "Rattachement du compte en double",
        raison: "patch" in rep ? "Repris du compte identique de la connexion en double." : "Rattachement du compte identique de la connexion en double : déconnecte-la, puis rattache ce compte." };
      if ("patch" in rep && !texte(r.auto_retire_le) && !texte(r.rattache_auto)) sortie.auto = { patch: rep.patch, cree: rep.cree, suggestion: sugg };
      else sortie.suggestion = sugg;
      continue;
    }
    // Rattachement automatique déjà posé puis retiré (auto_retire_le), ou ligne créée puis supprimée (rattache_auto encore posé,
    // cible effacée par la clé étrangère) : choix de l'utilisateur, jamais refait.
    if (texte(r.auto_retire_le) || texte(r.rattache_auto)) continue;

    const ligneSugg = (p: any, raison: string) => ({ type: "ligne", id: String(p.id), libelle: String(p.name ?? "Ligne") + (texte(p.envelope) ? ` · ${p.envelope}` : ""), raison });
    const proche = (xs: any[], v: (x: any) => number | null) => [...xs].sort((a, b) =>
      Math.abs((v(a) ?? Infinity) - (c.solde ?? 0)) - Math.abs((v(b) ?? Infinity) - (c.solde ?? 0)) || String(a.id).localeCompare(String(b.id)));
    const versLigne = (p: any, raison: string): Auto => { prisesLignes.add(String(p.id)); return { patch: { position_id: String(p.id) }, cree: false, suggestion: ligneSugg(p, raison) }; };
    const creer = (id: string | undefined, ligne: Record<string, unknown>, raison: string): Auto | null => {
      if (!id) return null;
      prisesLignes.add(id);
      const l = { id, user_id: e.userId, owner: "p1", mode: "manual", value: c.solde, value_date: e.aujourdhui, status: "actif",
        source_auto: "powens", source_auto_le: e.maintenant, ...ligne };
      return { patch: { position_id: id }, cree: true, ligne: l, suggestion: ligneSugg(l, raison) };
    };

    if (c.type === "credit") {
      const montant = Math.abs(c.crd ?? c.solde ?? NaN);
      const libres = (e.credits ?? []).filter((k) => k && texte(k.id) && !prisesCredits.has(String(k.id)));
      const forts = Number.isFinite(montant) ? libres.filter((k) => Math.abs(Number(k.crd ?? NaN) - montant) <= Math.max(1, montant * 0.01)) : [];
      const fc = famillesCredit(c.nom), precises = [...fc].filter((f) => f !== "pret");
      const familles = precises.length ? precises : [...fc];
      const faibles = libres.filter((k) => { const fk = famillesCredit(k.nom); return familles.some((f) => fk.has(f)); });
      const cands = forts.length ? forts : faibles;
      const parMontant = [...cands].sort((a, b) => Math.abs(Number(a.crd) - montant) - Math.abs(Number(b.crd) - montant) || String(a.id).localeCompare(String(b.id)));
      const sugg = (k: any, raison: string) => ({ type: "credit", id: String(k.id), libelle: String(k.nom || "Crédit"), raison });
      if (cands.length === 1) {
        prisesCredits.add(String(cands[0].id));
        sortie.auto = { patch: { credit_id: String(cands[0].id) }, cree: false,
          suggestion: sugg(cands[0], forts.length ? `Capital restant dû égal au solde du prêt (${fr(montant)} €).` : "Même type de prêt que le nom du compte.") };
      } else if (cands.length > 1) {
        sortie.suggestion = sugg(parMontant[0], `${cands.length} crédits possibles : le plus proche du capital restant dû est proposé.`);
      }
      continue;
    }

    if (c.type === "livret") {
      const produit = produitLivret(c.typePowens, c.nom);
      const manuelles = lignesOk().filter((p) => p.mode === "manual");
      let cands: any[];
      if (produit) cands = manuelles.filter((p) => produit.motifs.some((m) => contient(mots(p.name), m)));
      else cands = manuelles.filter((p) => !nomProduit(p.name) && ((/^livret/.test(normNom(p.envelope))) || (normNom(c.nom) && normNom(p.name) === normNom(c.nom))));
      const nomP = produit?.nom ?? "livret";
      if (cands.length === 1) sortie.auto = versLigne(cands[0], produit ? `Ligne « ${produit.nom} » existante.` : "Seule ligne de livret possible.");
      else if (cands.length > 1) sortie.suggestion = ligneSugg(proche(cands, (p) => nombre(p.value))[0], `${cands.length} lignes possibles pour ce ${nomP} : la plus proche du solde est proposée.`);
      else {
        // Aucune ligne : création dans l'enveloppe « Livrets » (ou l'enveloppe livret de l'utilisateur si elle est unique).
        const envs = new Map<string, any[]>();
        for (const p of (e.lignes ?? []).filter((p) => p && p.status !== "clôturé" && /^livret/.test(normNom(p.envelope)))) {
          const k = enveloppeCle(p.envelope); if (!envs.has(k)) envs.set(k, []); envs.get(k)!.push(p);
        }
        const unique = envs.size === 1 ? [...envs.values()][0] : null;
        const envelope = unique ? String(unique[0].envelope).trim() : "Livrets";
        const blocs = unique ? [...new Set(unique.map((p) => texte(p.bloc)).filter(Boolean))] : [];
        sortie.auto = creer(e.idsLivret?.[String(c.id)], { name: (produit?.nom ?? (c.nom || "Livret")).slice(0, 140), envelope,
          bloc: blocs.length === 1 ? blocs[0] : "Livrets" }, "Aucune ligne existante : ligne créée.");
      }
      continue;
    }

    if (c.type === "courant") {
      const te = mots(etab);
      const cands = te.length ? lignesOk().filter((p) => p.mode === "manual" && contient(mots(p.name), te) && mots(p.name).some((m) => m === "courant" || m === "courants")) : [];
      if (cands.length === 1) sortie.auto = versLigne(cands[0], `Ligne « ${cands[0].name} » existante.`);
      else if (cands.length > 1) sortie.suggestion = ligneSugg(proche(cands, (p) => nombre(p.value))[0], `${cands.length} lignes de compte courant ${etab} possibles : la plus proche du solde est proposée.`);
      else {
        const nom = `Compte courant${etab ? " " + etab : ""}` + (courantsX.length > 1 ? ` · ${c.nom}` : "");
        sortie.auto = creer(e.idsCourant?.[String(c.id)], { name: nom.slice(0, 140), envelope: "Comptes courants", bloc: "Comptes courants" }, "Aucune ligne existante : ligne créée.");
      }
      continue;
    }

    if (TYPES_ENVELOPPE.includes(c.type)) {
      if (!c.isins) continue; // placements non lus : rien de sûr
      const pme = c.type === "pea" && mots(c.nom).includes("pme");
      const compatible = (env: unknown) => {
        const t = typeEnveloppe(env);
        if (t.type != null && t.type !== c.type) return false;
        if (c.type === "pea" && t.type === "pea" && t.pme !== pme) return false;
        return true;
      };
      // Enveloppes de l'utilisateur : (nom, titulaire) → lignes actives ; jamais une enveloppe déjà rattachée à un autre compte.
      const groupes = new Map<string, any[]>();
      for (const p of (e.lignes ?? []).filter((p) => p && (p.user_id == null || p.user_id === e.userId) && p.status !== "clôturé" && texte(p.envelope))) {
        const k = cleEnv(p.envelope, p.owner);
        if (prisesEnv.has(k) || !compatible(p.envelope)) continue;
        if (!groupes.has(k)) groupes.set(k, []); groupes.get(k)!.push(p);
      }
      const nomDe = (ls: any[]) => { const n = new Map<string, number>(); for (const p of ls) { const v = String(p.envelope).trim(); n.set(v, (n.get(v) ?? 0) + 1); }
        return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]; };
      const isins = [...new Set(c.isins)];
      const scores = [...groupes.entries()].map(([k, ls]) => {
        const chez = new Set(ls.map((p) => String(p.isin ?? "").trim().toUpperCase()).filter(Boolean));
        const communs = isins.filter((i) => chez.has(i)).length;
        return { k, ls, communs, part: isins.length ? communs / isins.length : 0, nom: nomDe(ls), titulaire: ls[0].owner === "p2" ? "p2" : "p1" };
      }).filter((s) => s.communs >= 1 && s.part >= 0.5).sort((a, b) => b.communs - a.communs || b.part - a.part || a.k.localeCompare(b.k));
      const envSugg = (env: string, tit: string, raison: string) => ({ type: "enveloppe", enveloppe: env, titulaire: tit, libelle: `${env} (${tit})`, raison });
      const versEnv = (env: string, tit: string, cree: boolean, raison: string): Auto => {
        prisesEnv.add(cleEnv(env, tit));
        return { patch: { enveloppe: env, titulaire: tit }, cree, suggestion: envSugg(env, tit, raison) };
      };
      if (scores.length === 1) {
        const s = scores[0];
        sortie.auto = versEnv(s.nom, s.titulaire, false, `${s.communs} placement${s.communs > 1 ? "s" : ""} sur ${isins.length} déjà dans l'enveloppe.`);
      } else if (scores.length > 1) {
        sortie.suggestion = envSugg(scores[0].nom, scores[0].titulaire, `${scores.length} enveloppes possibles : celle qui a le plus de placements en commun est proposée.`);
      } else if (pme || c.type === "compte_titres") {
        // Aucune enveloppe correspondante : PEA-PME → « PEA-PME », compte-titres → « Compte-titres <établissement> ».
        const cible = pme ? "PEA-PME" : `Compte-titres${etab ? " " + etab : ""}`;
        const memes = [...groupes.entries()].filter(([k]) => k.split("|")[0] === enveloppeCle(cible));
        if (memes.length === 1) sortie.auto = versEnv(nomDe(memes[0][1]), memes[0][1][0].owner === "p2" ? "p2" : "p1", false, `Enveloppe « ${cible} » existante.`);
        else if (memes.length > 1) sortie.suggestion = envSugg(nomDe(memes[0][1]), memes[0][1][0].owner === "p2" ? "p2" : "p1", "Deux titulaires possibles pour cette enveloppe.");
        else if (prisesEnv.has(cleEnv(cible, "p1"))) { /* déjà rattachée à un autre compte : rien d'évident */ }
        else if (e.deuxPersonnes === false) sortie.auto = versEnv(cible, "p1", true, "Aucune enveloppe correspondante : enveloppe créée.");
        else sortie.suggestion = envSugg(cible, "p1", "Aucune enveloppe correspondante : choisis le titulaire de la nouvelle enveloppe.");
      }
      continue;
    }
  }
  return res;
}

/* ---------- virements internes et revenus détectés (CP1, docs/superpowers/specs/2026-10-12-cp1-comptes-performance-design.md § 5) ---------- */
/** Catégories posées par le rapprochement des virements : jamais écrasées par la catégorie Powens d'une synchronisation suivante. */
export const CATEGORIES_INTERNES = ["epargne", "virement_interne"];
/** Comptes d'épargne ou d'investissement : un virement du courant vers l'un d'eux est de l'épargne. */
export const TYPES_EPARGNE = ["livret", "pea", "compte_titres", "assurance_vie", "per"];
/** Écart maximal de dates (jours) et de montant (centimes) entre les deux côtés d'un virement interne. */
export const VIREMENT_JOURS = 3;
export const VIREMENT_CENTIMES = 1;
/** Revenus détectés : 2 des 3 derniers mois complets au moins, montant mensuel stable à ±15 %, écart au profil > 10 %. Une
    entrée récurrente sous REVENU_MIN € par mois (remboursement, petite allocation) n'est jamais prise pour un salaire. */
export const REVENU_MOIS = 3;
export const REVENU_MOIS_MIN = 2;
export const REVENU_STABILITE = 0.15;
export const REVENU_ECART = 0.1;
export const REVENU_MIN = 500;
export const SOURCE_REVENUS = "Powens — revenus détectés";

const centimes = (v: unknown): number | null => { const n = nombre(v); return n == null ? null : Math.round(n * 100); };
const ecartJours = (a: string, b: string) => Math.round(Math.abs(Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);
const compareIds = (a: unknown, b: unknown) => (Number(a) - Number(b)) || String(a).localeCompare(String(b));
/** 1er du mois décalé de `n` mois (n négatif : mois précédents), au format AAAA-MM-JJ. */
function moisDecale(date: string, n: number): string {
  const [a, m] = date.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}
/** Libellé nettoyé pour repérer une récurrence : même règle que cleLibelle de mcp/banque.ts (minuscules, sans accents, sans
    chiffres ni ponctuation, espaces réduits). Dupliquée ici : la fonction powens ne charge pas le module du connecteur. */
export function cleLibelle(t: unknown): string {
  return String(t ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, " ").trim();
}
/** Salaire net mensuel d'une personne du profil : même calcul que web/src/calc.js (brut → net : 0,75 cadre, 0,78 sinon). */
export function salaireNetMensuel(p: any): number {
  if (!p) return 0;
  const v = Math.max(0, Number(p.salaire) || 0), taux = p.statut === "cadre" ? 0.75 : 0.78;
  switch (p.salaireUnite) {
    case "na": return v / 12;
    case "bm": return v * taux;
    case "ba": return (v * taux) / 12;
    default: return v;
  }
}
/** Comptes suivis par le rapprochement : ni ignorés, ni en double, ni carte à débit différé (son relevé mensuel, débité sur le
    courant, croiserait le remboursement de la carte et effacerait des dépenses réelles). */
const comptesSuivis = (comptes: any[]) => new Map((comptes ?? []).filter((k) => k && k.id != null && k.ignore !== true && k.doublon_de == null
  && k.debit_differe !== true).map((k) => [String(k.id), k]));

/** Virements internes (pur) : sur les opérations de tous les comptes suivis de l'utilisateur, une sortie et une entrée de montant
    opposé (à VIREMENT_CENTIMES près), sur deux comptes différents, à VIREMENT_JOURS jours au plus, forment un virement. Appariement
    un pour un, le plus proche en date d'abord (puis le montant le plus proche, puis les identifiants : déterministe). Catégorie
    « virement_interne » des deux côtés, sauf une sortie d'un compte courant vers un compte d'épargne ou d'investissement :
    « epargne » côté courant (l'entrée depuis l'épargne reste « virement_interne »). Renvoie les catégories qui changent
    (identifiant → catégorie) et les paires (sortie, entrée). */
export function rapprocherVirements(operations: any[], comptes: any[]) {
  const suivis = comptesSuivis(comptes);
  const ops = (operations ?? []).filter((o) => o && o.id != null && suivis.has(String(o.compte_id)) && jour(o.date) && centimes(o.montant));
  const entrees = new Map<number, any[]>();
  for (const o of ops) {
    const c = centimes(o.montant)!;
    if (c > 0) { if (!entrees.has(c)) entrees.set(c, []); entrees.get(c)!.push(o); }
  }
  const candidats: { d: any; e: any; jours: number; ecart: number }[] = [];
  for (const d of ops) {
    const c = centimes(d.montant)!;
    if (c > 0) continue;
    for (let k = -c - VIREMENT_CENTIMES; k <= -c + VIREMENT_CENTIMES; k++) {
      for (const e of entrees.get(k) ?? []) {
        if (String(e.compte_id) === String(d.compte_id)) continue;
        const jours = ecartJours(jour(d.date)!, jour(e.date)!);
        if (jours <= VIREMENT_JOURS) candidats.push({ d, e, jours, ecart: Math.abs(k + c) });
      }
    }
  }
  candidats.sort((a, b) => a.jours - b.jours || a.ecart - b.ecart || compareIds(a.d.id, b.d.id) || compareIds(a.e.id, b.e.id));
  const pris = new Set<string>(), categories: Record<string, string> = {}, paires: [unknown, unknown][] = [];
  const poser = (o: any, cat: string) => { if ((o.categorie ?? null) !== cat) categories[String(o.id)] = cat; };
  for (const { d, e } of candidats) {
    if (pris.has(String(d.id)) || pris.has(String(e.id))) continue;
    pris.add(String(d.id)); pris.add(String(e.id));
    paires.push([d.id, e.id]);
    const versEpargne = suivis.get(String(d.compte_id)).type === "courant" && TYPES_EPARGNE.includes(suivis.get(String(e.compte_id)).type);
    poser(d, versEpargne ? "epargne" : "virement_interne");
    poser(e, "virement_interne");
  }
  return { categories, paires };
}

/* Versements vers les placements de l'utilisateur sans contrepartie synchronisée (Powens ne lit pas les opérations d'un PEA, d'un
   PER ou d'une assurance-vie) : sortie d'un compte courant classée « epargne » plutôt qu'en dépense, d'après
   (1) son libellé nettoyé : mot de placement (MOTS_PLACEMENT), nom d'une enveloppe d'investissement de l'utilisateur ou d'un
       établissement où il a un compte d'investissement connecté (sans compte courant chez lui) ;
   (2) un versement programmé de config.recurring : montant à ±VERSEMENT_EUROS €, jour du mois à ±VERSEMENT_JOURS jours, opération
       sans catégorie précise (divers) et pas un paiement par carte ;
   (3) un virement vers soi-même (« vir permanent », ou « vir » suivi du nom d'une personne du foyer) dont le montant est celui
       d'un versement programmé (±VERSEMENT_EUROS €), quel que soit le jour.
   Jamais une opération rapprochée d'une contrepartie (virement interne) ; jamais une entrée. */
export const MOTS_PLACEMENT = [["pea"], ["per"], ["perin"], ["perp"], ["assurance", "vie"], ["linxea"], ["spirica"], ["versement", "programme"], ["compte", "titres"]];
export const MARQUES_VIREMENT_SOI = [["vir", "permanent"], ["virement", "permanent"], ["vir", "perm"]];
export const VERSEMENT_EUROS = 1;
export const VERSEMENT_JOURS = 5;
/** Mots trop généraux pour désigner à eux seuls une enveloppe ou un établissement. */
const MOTS_GENERIQUES = new Set(["banque", "bank", "banco", "credit", "caisse", "epargne", "assurance", "assurances", "societe", "generale",
  "compte", "comptes", "france", "groupe", "mutuel", "mutuelle", "populaire", "agricole", "postale", "titres", "titre", "retraite", "plan",
  "avenir", "placement", "placements", "enveloppe", "livret", "livrets", "courant", "courants", "bourse", "investissement", "invest", "moi"]);
const TYPES_INVESTISSEMENT = ["pea", "compte_titres", "assurance_vie", "per"];
const jetons = (t: unknown) => cleLibelle(t).split(" ").filter(Boolean);
/** Termes d'un nom (enveloppe, établissement, prénom) : le nom entier (suite de mots), plus chaque mot d'au moins 5 lettres non générique. */
function termes(nom: unknown): string[][] {
  const ts = jetons(nom);
  if (!ts.length) return [];
  const out = [ts];
  for (const m of ts) if (m.length >= 5 && !MOTS_GENERIQUES.has(m) && ts.length > 1) out.push([m]);
  return ts.length === 1 && MOTS_GENERIQUES.has(ts[0]) ? [] : out;
}
export type ContexteEpargne = { termes: string[][]; versements: { montant: number; jour: number; debut: string | null }[]; noms: string[][] };
/** Contexte de l'épargne sans contrepartie (pur) : lignes de l'utilisateur (enveloppes d'investissement : type d'enveloppe ou ligne
    de marché), comptes et connexions Powens (établissements d'investissement sans compte courant), config.recurring, personnes du foyer. */
export function contexteEpargne(e: { lignes?: any[]; comptes?: any[]; connexions?: any[]; recurring?: any; personnes?: any }): ContexteEpargne {
  const t: string[][] = [...MOTS_PLACEMENT];
  for (const p of e.lignes ?? []) {
    if (!p || p.status === "clôturé" || !texte(p.envelope)) continue;
    if (TYPES_INVESTISSEMENT.includes(typeEnveloppe(p.envelope).type ?? "") || p.mode === "market") t.push(...termes(p.envelope));
  }
  const parCx = new Map<string, Set<string>>();
  for (const k of e.comptes ?? []) {
    if (!k || k.connexion_id == null) continue;
    if (!parCx.has(String(k.connexion_id))) parCx.set(String(k.connexion_id), new Set());
    parCx.get(String(k.connexion_id))!.add(String(k.type));
  }
  for (const c of e.connexions ?? []) {
    const types = parCx.get(String(c?.id)) ?? new Set();
    if ([...types].some((x) => TYPES_INVESTISSEMENT.includes(x)) && !types.has("courant")) t.push(...termes(c.etablissement));
  }
  const vus = new Set<string>(), uniques = t.filter((x) => { const k = x.join(" "); if (vus.has(k)) return false; vus.add(k); return true; });
  const versements = (Array.isArray(e.recurring) ? e.recurring : []).filter((r: any) => r && Number(r.amount) > 0 && Number(r.day) >= 1)
    .map((r: any) => ({ montant: Number(r.amount), jour: Math.min(31, Math.trunc(Number(r.day))), debut: jour(r.start) }));
  const noms: string[][] = [];
  for (const k of ["p1", "p2"]) {
    const p = e.personnes?.[k];
    for (const v of [p?.nom, p?.nomFamille, p?.nom_famille]) {
      const ts = jetons(v);
      if (ts.length && ts.join("").length >= 3 && !(ts.length === 1 && MOTS_GENERIQUES.has(ts[0]))) noms.push(ts);
    }
  }
  return { termes: uniques, versements, noms };
}
/** Sorties des comptes courants suivis à classer « epargne » faute de contrepartie (pur) : identifiants → « epargne ».
    `exclues` : opérations rapprochées d'une contrepartie (jamais requalifiées). */
export function epargneSansContrepartie(operations: any[], comptes: any[], ctx: ContexteEpargne | null | undefined, exclues: Set<string> = new Set()) {
  const out: Record<string, string> = {};
  if (!ctx) return out;
  const suivis = comptesSuivis(comptes);
  for (const o of operations ?? []) {
    if (!o || o.id == null || exclues.has(String(o.id)) || suivis.get(String(o.compte_id))?.type !== "courant") continue;
    if (CATEGORIES_INTERNES.includes(o.categorie)) continue;
    const m = nombre(o.montant), d = jour(o.date);
    if (m == null || m >= 0 || !d) continue;
    const ts = jetons(o.libelle), montant = -m;
    const memeMontant = (v: { montant: number; debut: string | null }) => Math.abs(v.montant - montant) <= VERSEMENT_EUROS + 1e-9 && (!v.debut || v.debut <= d);
    const jourOp = Number(d.slice(8, 10)), nbJours = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
    const procheJour = (j: number) => { const x = Math.abs(Math.min(j, nbJours) - jourOp); return Math.min(x, nbJours - x) <= VERSEMENT_JOURS; };
    const carte = ts[0] === "cb" || ts[0] === "carte";
    const libelle = ctx.termes.some((t) => contient(ts, t));
    const programme = !carte && (o.categorie == null || o.categorie === "divers") && ctx.versements.some((v) => memeMontant(v) && procheJour(v.jour));
    const versSoi = (MARQUES_VIREMENT_SOI.some((t) => contient(ts, t)) || ((ts.includes("vir") || ts.includes("virement")) && ctx.noms.some((n) => contient(ts, n))))
      && ctx.versements.some(memeMontant);
    if (libelle || programme || versSoi) out[String(o.id)] = "epargne";
  }
  return out;
}

/** Opérations d'une synchronisation fusionnées avec celles déjà en base (90 jours, toutes connexions), puis virements internes
    rapprochés et versements vers les placements sans contrepartie classés en épargne (pur). Une catégorie « epargne » ou
    « virement_interne » déjà en base n'est jamais remplacée par la catégorie Powens.
    Renvoie les opérations à écrire (catégories finales), les opérations d'autres comptes dont la catégorie change (catégorie →
    identifiants) et la plus ancienne de leurs dates, l'ensemble fusionné (catégories finales), le nombre de virements rapprochés
    qui changent quelque chose et le nombre de versements classés en épargne sans contrepartie. */
export function preparerOperations(planOps: any[], supprimees: unknown[], existantes: any[], comptes: any[], ctx?: ContexteEpargne | null) {
  const ex = new Map((existantes ?? []).filter((o) => o && o.id != null).map((o) => [String(o.id), o]));
  const ecrites = (planOps ?? []).map((o) => {
    const e = ex.get(String(o.id));
    return e && CATEGORIES_INTERNES.includes(e.categorie) ? { ...o, categorie: e.categorie } : o;
  });
  const vus = new Set(ecrites.map((o) => String(o.id))), retirees = new Set((supprimees ?? []).map(String));
  const fusion = [...[...ex.values()].filter((o) => !vus.has(String(o.id)) && !retirees.has(String(o.id))), ...ecrites];
  const { categories: virements, paires } = rapprocherVirements(fusion, comptes);
  const apparies = new Set(paires.flat().map(String));
  const epargne = epargneSansContrepartie(fusion, comptes, ctx, apparies);
  const categories = { ...epargne, ...virements };
  const finale = (o: any) => (categories[String(o.id)] ? { ...o, categorie: categories[String(o.id)] } : o);
  const autres: Record<string, number[]> = {};
  let depuis: string | null = null;
  for (const o of fusion) {
    const cat = categories[String(o.id)];
    if (!cat || vus.has(String(o.id))) continue;
    (autres[cat] ??= []).push(Number(o.id));
    const d = jour(o.date)!;
    if (!depuis || d < depuis) depuis = d;
  }
  return {
    operations: ecrites.map(finale), autres, depuis, toutes: fusion.map(finale),
    virements: paires.filter(([d, e]) => virements[String(d)] || virements[String(e)]).length, epargne: Object.keys(epargne).length,
  };
}

/** Revenus détectés (pur) : entrées des comptes courants suivis (hors épargne et virements internes), groupées par libellé
    nettoyé et par mois sur les REVENU_MOIS derniers mois complets ; un groupe présent au moins REVENU_MOIS_MIN mois, dont chaque
    total mensuel reste à ±REVENU_STABILITE de la moyenne et dont la moyenne atteint REVENU_MIN €, est un salaire probable. Le plus
    élevé est retenu : { cle, moyenne, mois: [{ mois, montant }] } ; null s'il n'y en a aucun. */
export function revenusDetectes(operations: any[], comptes: any[], aujourdhui: string) {
  const suivis = comptesSuivis(comptes);
  const mois = Array.from({ length: REVENU_MOIS }, (_, i) => moisDecale(aujourdhui, i - REVENU_MOIS));
  const groupes = new Map<string, Map<string, number>>();
  for (const o of operations ?? []) {
    if (!o || suivis.get(String(o.compte_id))?.type !== "courant" || CATEGORIES_INTERNES.includes(o.categorie)) continue;
    const m = nombre(o.montant), d = jour(o.date), k = cleLibelle(o.libelle);
    if (m == null || m <= 0 || !d || !k || !mois.includes(premierDuMois(d))) continue;
    if (!groupes.has(k)) groupes.set(k, new Map());
    const g = groupes.get(k)!;
    g.set(premierDuMois(d), (g.get(premierDuMois(d)) ?? 0) + m);
  }
  const retenus = [...groupes.entries()].map(([cle, g]) => {
    const presents = mois.filter((m) => g.has(m)).map((m) => ({ mois: m, montant: r2(g.get(m)!) }));
    const moyenne = presents.reduce((s, x) => s + x.montant, 0) / (presents.length || 1);
    return { cle, moyenne, mois: presents };
  }).filter((x) => x.mois.length >= REVENU_MOIS_MIN && x.moyenne >= REVENU_MIN
    && x.mois.every((m) => Math.abs(m.montant - x.moyenne) <= x.moyenne * REVENU_STABILITE))
    .sort((a, b) => b.moyenne - a.moyenne || a.cle.localeCompare(b.cle));
  return retenus.length ? { ...retenus[0], moyenne: r2(retenus[0].moyenne) } : null;
}

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
/** Montant en euros à la française (espace des milliers, virgule décimale). */
const euros = (v: number, decimales = 2) => {
  const [e, d] = Math.abs(v).toFixed(decimales).split(".");
  return (v < 0 ? "-" : "") + e.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (d ? "," + d : "") + " €";
};
/** Lot d'une détection de revenus : même libellé nettoyé, même dernier mois complet → même lot (une proposition au plus). */
export function lotRevenus(userId: string, cle: string, mois: string): Promise<string> {
  return uuidDeterministe(`powens-revenus-${userId}-${cle}-${mois}`);
}
/** Identifiant de la proposition d'une détection (upsert … ignoreDuplicates : jamais deux pour le même lot). */
export function idRevenus(lot: string): Promise<string> {
  return uuidDeterministe(`powens-revenus-prop-${lot}`);
}
/** Proposition profil (pur) : salaire net mensuel de la personne 1 = moyenne détectée, arrondie à l'euro, si elle s'écarte de
    plus de REVENU_ECART du salaire net mensuel du profil (ou si le profil n'en a pas) ; null sinon. L'unité passe à « nm » (net
    mensuel) si le profil en déclarait une autre. Jamais appliquée par la synchronisation : l'utilisateur la valide dans Boussole.
    La justification donne les mois et les montants, jamais le libellé bancaire. */
export function propositionRevenus(det: any, profil: any, ids: { userId: string; id: string; lot: string }) {
  if (!det || !(Number(det.moyenne) > 0)) return null;
  const p1 = profil?.personnes?.p1 ?? {};
  const actuel = salaireNetMensuel(p1), moyenne = Number(det.moyenne), nouveau = Math.round(moyenne);
  if (actuel > 0 && Math.abs(moyenne - actuel) / actuel <= REVENU_ECART) return null;
  // unité absente : net mensuel par défaut (calc.js), sauf profil sans salaire où elle est posée explicitement
  const changeUnite = p1.salaireUnite != null ? p1.salaireUnite !== "nm" : p1.salaire == null;
  const avant = { salaire: p1.salaire ?? null, ...(changeUnite ? { salaireUnite: p1.salaireUnite ?? null } : {}) };
  const apres = { salaire: nouveau, ...(changeUnite ? { salaireUnite: "nm" } : {}) };
  const detail = (det.mois ?? []).map((m: any) => `${MOIS_FR[Number(String(m.mois).slice(5, 7)) - 1]} ${String(m.mois).slice(0, 4)} : ${euros(Number(m.montant))}`).join(" ; ");
  const compare = actuel > 0
    ? `contre ${euros(Math.round(actuel), 0)} net par mois dans ton profil (écart ${moyenne >= actuel ? "+" : "-"}${Math.round((Math.abs(moyenne - actuel) / actuel) * 100)} %)`
    : "alors que ton profil n'indique aucun salaire";
  return {
    id: ids.id, user_id: ids.userId, lot: ids.lot, cible: "profil", operation: "modifier",
    avant: { personnes: { p1: avant } }, apres: { personnes: { p1: apres } }, source: SOURCE_REVENUS,
    justification: (`Entrée récurrente sur ton compte courant, probablement ton salaire : ${detail}. Moyenne : ${euros(nouveau, 0)} net par mois, ${compare}. `
      + "Rien n'est modifié sans ta validation.").slice(0, 1000),
  };
}

/* ---------- plan ---------- */
type LectureCompte = { compte: any; placements: any[] | null; operations: any[] | null; erreur?: string };
/** État local : comptes (rattachements, ignore, propose_le), placements (liens, ligne_creee_le ; tous ceux de l'utilisateur),
    lots des propositions déjà déposées, comptes à rattacher à la ligne créée par une proposition acceptée (id du compte → id de
    la ligne), et lignes de l'utilisateur candidates à l'adoption (id, user_id, name, envelope, owner, mode, isin, qty, status). */
export type Etat = { comptes: any[]; placements: any[]; lotsExistants: string[]; acceptes?: Record<string, string>; lignes?: any[] };
export type Donnees = {
  userId: string; connexion: any; comptes: LectureCompte[]; lectureComptesOk: boolean; maintenant: string; aujourdhui: string;
  minDate: string; lots: Record<string, string>; idsPropositions?: Record<string, string>; idsLignes?: Record<string, string>;
  idsLiquidites?: Record<string, string>; erreurComptes?: string;
  /** Résultat de rapprocher (absent : ni rattachement automatique, ni suggestion, ni marque de doublon écrits). */
  rapprochement?: ResultatRapprochement;
};

/** Calcule les écritures d'une synchronisation, sans accès à la base ni à Powens. */
export function planifier(etat: Etat, d: Donnees) {
  const { userId: user_id, maintenant, aujourdhui } = d;
  const auto = { source_auto: "powens", source_auto_le: maintenant };
  const plan = {
    connexion: null as any, comptes: [] as any[], comptesInactifs: [] as any[], instruments: [] as any[], positionsCreer: [] as any[],
    // auto : ligne de marché tenue par la synchronisation, écrite seulement si source_auto = 'powens' ;
    // adoption : ligne existante de l'utilisateur reprise par la synchronisation (écrite sans ce filtre, une fois)
    positionsMaj: [] as { id: string; patch: Record<string, unknown>; auto?: boolean; adoption?: boolean }[], placements: [] as any[], placementsSupprimer: [] as any[],
    creditsMaj: [] as { id: string; crd: number }[], operations: [] as any[], operationsSupprimer: [] as any[], propositions: [] as any[],
    rattachements: [] as { id: number; position_id: string }[], comptesProposes: [] as number[],
    // rattachements automatiques (rapprocher) : posés seulement si le compte est encore libre ; lignesAuto : lignes à créer avant
    rattachementsAuto: [] as { id: number; patch: Record<string, unknown>; cree: boolean; ligne: string | null }[], lignesAuto: [] as any[],
    moisDepuis: null as string | null, erreurs: [] as { compte_id?: number; erreur: string }[], notes: [] as string[],
  };
  const existants = new Map(etat.comptes.map((c) => [String(c.id), c]));
  const etablissement = texte(d.connexion?.connector?.name);
  // Lignes déjà liées (à un placement ou à un compte) : jamais adoptées une seconde fois.
  const prises = new Set<string>([...etat.placements, ...etat.comptes].map((x) => texte(x?.position_id)).filter(Boolean) as string[]);
  const lignes = (etat.lignes ?? []).filter((p) => p && texte(p.id) && (p.user_id == null || p.user_id === user_id) && p.status !== "clôturé");

  for (const l of d.comptes) if (l.erreur) plan.erreurs.push({ compte_id: Number(l.compte?.id), erreur: l.erreur });
  if (d.erreurComptes) plan.erreurs.push({ erreur: d.erreurComptes });
  const nonLus = d.comptes.filter((l) => l.erreur).length;
  const message = texte(d.connexion?.error_message) ?? (d.erreurComptes
    ? `Synchronisation partielle : comptes non lus (${d.erreurComptes})`
    : nonLus ? `Synchronisation partielle : ${nonLus} compte${nonLus > 1 ? "s" : ""} non lu${nonLus > 1 ? "s" : ""} (${d.comptes.find((l) => l.erreur)!.erreur})` : null);

  plan.connexion = {
    user_id, id: Number(d.connexion.id), etablissement, etat: normaliserEtat(d.connexion.state), message: message ? message.slice(0, 500) : null,
    derniere_synchro: datePowens(d.connexion.last_update), maj_le: maintenant,
  };
  if (plan.connexion.etablissement == null) delete plan.connexion.etablissement; // garde l'établissement déjà connu
  const connecteur = connecteurDe(d.connexion);
  if (connecteur != null) plan.connexion.connecteur = connecteur;
  if (d.rapprochement) plan.connexion.doublon_de = d.rapprochement.connexionDoublon ?? null;

  let plusAncien: string | null = null;
  const touche = (date: string) => { if (!plusAncien || date < plusAncien) plusAncien = date; };

  for (const l of d.comptes) {
    const c = l.compte;
    const id = Number(c.id);
    const type = normaliserType(c);
    const actif = !c.disabled && !c.deleted;
    const solde = nombre(c.balance);
    const nom = nettoyerLibelle(c.name ?? c.original_name) || "Compte";
    const rp = d.rapprochement?.comptes?.[String(id)];
    plan.comptes.push({
      user_id, id, connexion_id: Number(d.connexion.id), nom, type, debit_differe: String(c.type ?? "").toLowerCase() === "card", solde,
      devise: texte(c.currency?.id) ?? texte(c.currency) ?? "EUR", solde_le: jour(c.last_update) ?? aujourdhui, actif, maj_le: maintenant,
      ...(d.rapprochement ? { suggestion: rp?.auto ? null : rp?.suggestion ?? null, doublon_de: rp?.doublon_de ?? null } : {}),
    });
    let r = existants.get(String(id)) ?? {};
    // Compte en double dont le rattachement automatique passe à son jumeau : traité comme détaché dès ce passage.
    if (d.rapprochement?.autres.detacher.includes(id)) r = { ...r, position_id: null, enveloppe: null, titulaire: null, credit_id: null };
    // Rattachement automatique (rapprocher) d'un compte encore libre : appliqué dès ce passage comme s'il était choisi.
    const libre = r.ignore !== true && !texte(r.position_id) && !texte(r.enveloppe) && !texte(r.credit_id) && !texte(etat.acceptes?.[String(id)]);
    if (rp?.auto && libre && actif) {
      r = { ...r, ...rp.auto.patch };
      plan.rattachementsAuto.push({ id, patch: rp.auto.patch, cree: rp.auto.cree, ligne: rp.auto.ligne?.id ?? null });
      if (rp.auto.ligne) plan.lignesAuto.push(rp.auto.ligne);
    }
    const ignore = r.ignore === true;
    let positionId = ignore ? null : texte(r.position_id);
    const enveloppe = ignore ? null : texte(r.enveloppe), creditId = ignore || type !== "credit" ? null : texte(r.credit_id);
    const titulaire = r.titulaire === "p2" ? "p2" : "p1";
    // Proposition acceptée : le compte est rattaché à la ligne qu'elle a créée (retrouvée par synchroniser).
    const accepte = !ignore && !positionId && !enveloppe ? texte(etat.acceptes?.[String(id)]) : null;
    if (accepte) {
      positionId = accepte;
      plan.rattachements.push({ id, position_id: accepte });
    }

    // Placements (lus seulement pour les comptes titres) : lien conservé, ligne de marché pour une enveloppe rattachée.
    if (l.placements) {
      const anciens = etat.placements.filter((p) => String(p.compte_id) === String(id));
      const ancienDe = (inv: any) => anciens.find((p) => String(p.id) === String(inv.id));
      const presents = new Set<string>();
      // Lignes adoptables pour ce compte : même enveloppe (sans casse ni espaces), même titulaire s'il est connu, non clôturées,
      // non déjà liées. Plusieurs : la plus grande quantité (puis valeur), et c'est noté.
      const adopter = (filtre: (p: any) => boolean, rang: (p: any) => number, quoi: string) => {
        const cands = lignes.filter((p) => enveloppeCle(p.envelope) === enveloppeCle(enveloppe) && (!r.titulaire || p.owner === r.titulaire)
          && !prises.has(String(p.id)) && filtre(p));
        if (!cands.length) return null;
        cands.sort((a, b) => (rang(b) - rang(a)) || String(a.id).localeCompare(String(b.id)));
        if (cands.length > 1) plan.notes.push(`compte ${id} : ${cands.length} lignes « ${enveloppe} » pour ${quoi} ; adoptée : ligne ${cands[0].id} (la plus grande)`);
        prises.add(String(cands[0].id));
        return cands[0];
      };
      const rangQte = (p: any) => nombre(p.qty) ?? -1;

      // Liquidités (placements sans ISIN dont le libellé contient « liquidit ») : une ligne manuelle par compte enveloppe, adoptée
      // (manuelle, sans ISIN, nom contenant « liquid » ou « espèces ») ou créée (« Liquidités <enveloppe> », uuid déterministe).
      let liqLien: string | null = null;
      const liqs = enveloppe && actif ? l.placements.filter((inv) => inv?.id != null && !inv.deleted && estLiquidites(inv)) : [];
      if (liqs.length) {
        const valeurs = liqs.map((inv) => nombre(inv.valuation)).filter((v) => v != null) as number[];
        const valeur = valeurs.length ? Math.round(valeurs.reduce((a, b) => a + b, 0) * 100) / 100 : null;
        const valeurPatch = valeur == null ? {} : { value: valeur, value_date: aujourdhui };
        const dejaLiee = liqs.map((inv) => texte(ancienDe(inv)?.position_id)).find(Boolean) ?? null;
        if (dejaLiee) {
          liqLien = dejaLiee;
          if (valeur != null) plan.positionsMaj.push({ id: liqLien, patch: { ...valeurPatch, ...auto }, auto: true });
        } else if (liqs.some((inv) => texte(ancienDe(inv)?.ligne_creee_le))) {
          plan.notes.push(`compte ${id} : ligne de liquidités supprimée par l'utilisateur, non recréée`);
        } else if (valeur == null) {
          plan.notes.push(`compte ${id} : liquidités sans valeur, ignorées`);
        } else {
          const ligne = adopter((p) => p.mode === "manual" && !texte(p.isin) && /liquid|especes/.test(plat(p.name)),
            (p) => nombre(p.value) ?? -1, "les liquidités");
          if (ligne) {
            liqLien = String(ligne.id);
            plan.positionsMaj.push({ id: liqLien, patch: { ...valeurPatch, ...auto }, adoption: true });
          } else if (d.idsLiquidites?.[String(id)]) {
            liqLien = d.idsLiquidites[String(id)];
            plan.positionsCreer.push({ id: liqLien, user_id, name: `Liquidités ${enveloppe}`.slice(0, 140), envelope: enveloppe, owner: titulaire,
              bloc: "", mode: "manual", value: valeur, value_date: aujourdhui, status: "actif", ...auto });
          }
        }
      }

      for (const inv of l.placements) {
        if (inv?.id == null || inv.deleted) continue;
        presents.add(String(inv.id));
        const isin = isinDe(inv);
        const libelle = nettoyerLibelle(inv.label) || isin || "Placement";
        const qte = nombre(inv.quantity);
        const ancien = ancienDe(inv);
        let lien: string | null = texte(ancien?.position_id);
        let creeeLe: string | null = texte(ancien?.ligne_creee_le);
        if (enveloppe && actif && isin) {
          if (lien) plan.positionsMaj.push({ id: lien, patch: { qty: qte, isin, ...auto }, auto: true });
          else if (!creeeLe) { // ligne déjà créée (ou adoptée) puis supprimée par l'utilisateur : jamais recréée
            // D'abord adopter une ligne existante du même ISIN (casse ignorée) : nom, mode et valeur de l'utilisateur intacts.
            const ligne = adopter((p) => String(p.isin ?? "").trim().toUpperCase() === isin, rangQte, `l'ISIN ${isin}`);
            if (ligne) {
              lien = String(ligne.id);
              creeeLe = maintenant;
              if (String(ligne.isin) !== isin) plan.instruments.push({ isin, name: libelle, requested_by: user_id });
              plan.positionsMaj.push({ id: lien, patch: { ...(qte == null ? {} : { qty: qte }), isin, ...auto }, adoption: true });
            } else {
              lien = d.idsLignes?.[String(inv.id)] ?? null;
              if (lien) {
                creeeLe = maintenant;
                plan.instruments.push({ isin, name: libelle, requested_by: user_id });
                plan.positionsCreer.push({ id: lien, user_id, name: libelle, envelope: enveloppe, owner: titulaire, bloc: "", mode: "market",
                  isin, qty: qte, status: "actif", ...auto });
              }
            }
          }
        } else if (enveloppe && actif && !isin) {
          if (estLiquidites(inv)) {
            if (!lien && !creeeLe && liqLien) { lien = liqLien; creeeLe = maintenant; }
          } else {
            plan.notes.push(`compte ${id} : placement ${inv.id} (« ${libelle} ») sans ISIN, ignoré`);
          }
        }
        plan.placements.push({ user_id, id: Number(inv.id), compte_id: id, isin, libelle, quantite: qte, valeur: nombre(inv.valuation),
          prix_revient: nombre(inv.unitprice), position_id: lien, ligne_creee_le: creeeLe, maj_le: maintenant });
      }
      for (const p of anciens) {
        if (presents.has(String(p.id))) continue;
        plan.placementsSupprimer.push(Number(p.id));
        if (texte(p.position_id) && enveloppe) plan.positionsMaj.push({ id: p.position_id, patch: { status: "clôturé", ...auto }, auto: true });
      }
    }

    // Application aux lignes (spec § 2.5).
    if (actif && solde != null) {
      if (positionId) plan.positionsMaj.push({ id: positionId, patch: { value: solde, value_date: aujourdhui, ...auto } });
      if (creditId) {
        const crd = nombre(c.loan?.remaining_capital) ?? solde;
        plan.creditsMaj.push({ id: creditId, crd: Math.round(Math.abs(crd) * 100) / 100 });
      }
      const lot = d.lots[String(id)], idProp = d.idsPropositions?.[String(id)];
      // Proposition « créer une ligne » : seulement pour un compte « autre » (courant et livret : ligne créée automatiquement ;
      // enveloppe : placements suivis un par un ; crédit : crédit du profil), jamais pour un compte en double.
      if (!ignore && !r.propose_le && !positionId && !enveloppe && !texte(r.credit_id) && !TYPES_SANS_PROPOSITION.includes(type) && rp?.doublon_de == null
        && lot && idProp && !etat.lotsExistants.includes(lot)) {
        plan.propositions.push({
          id: idProp, user_id, lot, cible: "position", operation: "creer",
          apres: { name: nom, envelope: ENVELOPPE_PROPOSEE[type] ?? "", mode: "manual", value: solde, value_date: aujourdhui, owner: "p1" },
          source: `Powens — ${etablissement ?? "connexion bancaire"}`.slice(0, 500),
          justification: "Compte relié par Powens, pas encore rattaché à une ligne de Boussole.",
        });
        plan.comptesProposes.push(id);
      }
    }

    // Opérations des 90 derniers jours (déjà comptabilisées seulement).
    if (l.operations) {
      for (const o of l.operations) {
        if (o?.id == null) continue;
        const date = jour(o.date);
        if (o.deleted) {
          plan.operationsSupprimer.push(Number(o.id));
          if (date) touche(date);
          continue;
        }
        const montant = nombre(o.value);
        if (o.coming || !date || date < d.minDate || montant == null) continue;
        plan.operations.push({
          user_id, id: Number(o.id), compte_id: id, date, montant,
          libelle: nettoyerLibelle(o.simplified_wording ?? o.wording ?? o.original_wording), categorie: categorieBoussole(o.categories),
        });
        touche(date);
      }
    }
  }

  // Comptes connus absents de la réponse Powens (lecture réussie) : inactifs, sans rien effacer.
  if (d.lectureComptesOk) {
    const vus = new Set(d.comptes.map((l) => String(l.compte.id)));
    for (const c of etat.comptes) if (!vus.has(String(c.id)) && c.actif !== false) plan.comptesInactifs.push(Number(c.id));
  }
  plan.moisDepuis = plusAncien ? premierDuMois(plusAncien) : null;
  return plan;
}

/* ---------- application ---------- */
const parPaquets = <T>(xs: T[], n = 500): T[][] => { const r: T[][] = []; for (let i = 0; i < xs.length; i += n) r.push(xs.slice(i, i + n)); return r; };
const msg = (e: unknown) => (e instanceof Error ? e.message : String((e as any)?.message ?? e));

/** Écart toléré entre la décision d'une proposition et la création de la ligne qu'elle a demandée. */
const ECART_ACCEPTATION_MS = 2 * 60 * 1000;

/** Synchronise une connexion d'un utilisateur. `api` : client Powens portant le jeton de cet utilisateur. Ne lève pas.
    Bail par (utilisateur, connexion) : si une autre synchronisation le tient, rien n'est écrit (rapport.sautee). */
export async function synchroniser(db: any, api: any, userId: string, connexionId: number, opts: { maintenant?: Date } = {}) {
  const maintenant = opts.maintenant ?? new Date();
  const rapport = { ok: false, connexion: connexionId, etat: null as string | null, comptes: 0, operations: 0, positions_creees: 0, propositions: 0,
    rattaches: 0, lignes_adoptees: 0, rattaches_auto: 0, crees_auto: 0, suggestions: 0, comptes_en_double: 0, doublon_de: null as number | null, sautee: false,
    virements_internes: 0, versements_epargne: 0, revenus_proposes: 0, erreurs: [] as { compte_id?: number; erreur: string }[], notes: [] as string[] };

  let connexion: any;
  try {
    connexion = await api.connexion(connexionId);
    if (!connexion || connexion.id == null) throw new Error("connexion absente de la réponse Powens");
  } catch (e) {
    rapport.erreurs.push({ erreur: `Lecture de la connexion impossible : ${msg(e)}` });
    return rapport;
  }

  try {
    const v = await db.rpc("banque_verrouiller", { p_user: userId, p_connexion: connexionId });
    if (v?.error) throw new Error(v.error.message ?? String(v.error));
    if (v?.data !== true) {
      rapport.sautee = true;
      rapport.erreurs.push({ erreur: "Synchronisation déjà en cours pour cette connexion : sautée." });
      return rapport;
    }
  } catch (e) {
    rapport.erreurs.push({ erreur: `Verrou de synchronisation impossible : ${msg(e)}` });
    return rapport;
  }
  try {
    await appliquer(db, api, userId, connexionId, connexion, maintenant, rapport);
  } catch (e) {
    rapport.erreurs.push({ erreur: `Synchronisation interrompue : ${msg(e)}` });
  } finally {
    try {
      const r = await db.rpc("banque_deverrouiller", { p_user: userId, p_connexion: connexionId });
      if (r?.error) console.warn("powens: libération du verrou en échec", r.error.message);
    } catch (e) {
      console.warn("powens: libération du verrou en échec", msg(e));
    }
  }
  rapport.ok = rapport.erreurs.length === 0;
  return rapport;
}

/** Corps de la synchronisation, sous bail. Remplit `rapport`. */
async function appliquer(db: any, api: any, userId: string, connexionId: number, connexion: any, maintenant: Date, rapport: any) {
  const aujourdhui = dateParis(maintenant);
  const minDate = moinsJours(aujourdhui, JOURS_DETAIL);

  // État local (rattachements, liens des placements).
  const lireTable = async (q: any, quoi: string) => {
    const { data, error } = await q;
    if (error) throw new Error(`lecture ${quoi} : ${error.message}`);
    return data ?? [];
  };
  // Tous les comptes de l'utilisateur (toutes connexions) : rattachements pris ailleurs, comptes jumeaux d'une autre connexion.
  let etatComptes: any[] = [], tousComptes: any[] = [];
  try {
    tousComptes = await lireTable(db.from("banque_comptes").select("id, connexion_id, nom, actif, type, debit_differe, solde, position_id, enveloppe, titulaire, credit_id, ignore, propose_le, doublon_de, rattache_auto, auto_retire_le")
      .eq("user_id", userId), "des comptes");
    etatComptes = tousComptes.filter((c) => Number(c.connexion_id) === Number(connexionId));
  } catch (e) {
    rapport.erreurs.push({ erreur: msg(e) });
    return;
  }

  // Lecture Powens : comptes, puis placements et opérations compte par compte.
  let comptes: any[] = [];
  let lectureComptesOk = true, erreurComptes: string | undefined;
  try {
    comptes = (await api.comptes(connexionId)).filter((c: any) => c?.id != null);
  } catch (e) {
    lectureComptesOk = false;
    erreurComptes = msg(e);
  }
  const lectures: LectureCompte[] = [];
  for (const c of comptes) {
    const l: LectureCompte = { compte: c, placements: null, operations: null };
    const type = normaliserType(c);
    const actif = !c.disabled && !c.deleted;
    const erreurs: string[] = [];
    if (actif && TYPES_PLACEMENTS.includes(type)) {
      try { l.placements = await api.placements(c.id); } catch (e) { erreurs.push(`placements : ${msg(e)}`); }
    }
    if (actif && TYPES_OPERATIONS.includes(type)) {
      try {
        l.operations = await api.operations(c.id, minDate);
        if ((l.operations as any)?.tronque) erreurs.push("opérations : lecture tronquée (trop de pages chez Powens), les plus anciennes manquent");
      } catch (e) { erreurs.push(`opérations : ${msg(e)}`); }
    }
    if (erreurs.length) l.erreur = erreurs.join(" ; ");
    lectures.push(l);
  }

  let placements: any[] = [], propositions: any[] = [];
  let lignes: any[] = [], credits: any[] = [], connexions: any[] = [], profil: any = null;
  const lots: Record<string, string> = {}, idsPropositions: Record<string, string> = {}, idsLignes: Record<string, string> = {};
  const idsLiquidites: Record<string, string> = {}, idsCourant: Record<string, string> = {}, idsLivret: Record<string, string> = {};
  for (const c of comptes) {
    lots[String(c.id)] = await lotProposition(userId, c.id);
    idsPropositions[String(c.id)] = await idProposition(userId, c.id);
    idsLiquidites[String(c.id)] = await idLiquidites(userId, c.id);
    idsCourant[String(c.id)] = await idCourant(userId, c.id);
    idsLivret[String(c.id)] = await idLivret(userId, c.id);
  }
  for (const l of lectures) for (const inv of l.placements ?? []) if (inv?.id != null) idsLignes[String(inv.id)] = await idLigne(userId, inv.id);
  try {
    // Tous les placements de l'utilisateur (toutes connexions) : une ligne déjà liée n'est jamais adoptée une seconde fois.
    placements = await lireTable(db.from("banque_placements").select("id, compte_id, position_id, ligne_creee_le").eq("user_id", userId), "des placements");
    // Lignes, crédits, connexions et foyer : adoption par ISIN et rapprochement automatique.
    lignes = await lireTable(db.from("positions").select("id, user_id, name, envelope, owner, bloc, mode, isin, qty, value, status").eq("user_id", userId), "des lignes");
    credits = await lireTable(db.from("credits").select("id, nom, crd").eq("user_id", userId), "des crédits");
    connexions = await lireTable(db.from("banque_connexions").select("id, etablissement, connecteur, cree_le, doublon_de").eq("user_id", userId), "des connexions");
    const pr = await db.from("profiles").select("foyer, personnes").eq("user_id", userId).maybeSingle();
    if (pr?.error) throw new Error(`lecture du foyer : ${pr.error.message}`);
    profil = pr?.data ?? null;
    const valeurs = Object.values(lots);
    if (valeurs.length) {
      propositions = await lireTable(db.from("propositions").select("lot, statut, apres, decide_le").eq("user_id", userId).eq("cible", "position").in("lot", valeurs), "des propositions");
    }
  } catch (e) {
    rapport.erreurs.push({ erreur: msg(e) });
    return;
  }
  const lotsExistants = propositions.map((p: any) => String(p.lot));

  // Propositions acceptées d'un compte encore libre : la ligne créée (même nom et enveloppe, créée au plus tôt 2 min avant la
  // décision) doit être unique ; sinon rien n'est rattaché et c'est noté.
  const acceptes: Record<string, string> = {};
  for (const c of etatComptes) {
    if (c.ignore === true || texte(c.position_id) || texte(c.enveloppe)) continue;
    const p = propositions.find((x: any) => String(x.lot) === lots[String(c.id)]);
    if (!p || p.statut !== "acceptee" || !p.apres || typeof p.apres.name !== "string") continue;
    const decide = Date.parse(p.decide_le ?? "");
    if (!Number.isFinite(decide)) { rapport.notes.push(`compte ${c.id} : proposition acceptée sans date de décision, non rattaché`); continue; }
    try {
      const lignes = await lireTable(db.from("positions").select("id").eq("user_id", userId).eq("name", p.apres.name)
        .eq("envelope", String(p.apres.envelope ?? "")).gte("created_at", new Date(decide - ECART_ACCEPTATION_MS).toISOString()).limit(2), "des lignes");
      if (lignes.length === 1) acceptes[String(c.id)] = String(lignes[0].id);
      else rapport.notes.push(`compte ${c.id} : proposition acceptée, ${lignes.length ? "plusieurs lignes correspondent" : "aucune ligne correspondante"} ; non rattaché`);
    } catch (e) {
      rapport.notes.push(`compte ${c.id} : ligne de la proposition acceptée introuvable (${msg(e)})`);
    }
  }

  // Rapprochement automatique et doublons : seulement sur une lecture complète des comptes (sinon rien n'est marqué ni effacé).
  const stockee = connexions.find((c: any) => Number(c.id) === Number(connexionId)) ?? {};
  const foyer = profil?.foyer ?? {}, personnes = profil?.personnes ?? {};
  const deuxPersonnes = foyer.adultes != null && foyer.adultes !== "" ? Number(foyer.adultes) >= 2 : !!personnes.p2;
  let rapprochement: ResultatRapprochement | undefined;
  if (lectureComptesOk) {
    rapprochement = rapprocher({
      userId, aujourdhui, maintenant: maintenant.toISOString(),
      connexion: { id: Number(connexionId), etablissement: texte(connexion?.connector?.name) ?? texte(stockee.etablissement),
        connecteur: connecteurDe(connexion) ?? (stockee.connecteur == null ? null : Number(stockee.connecteur)), cree_le: stockee.cree_le ?? null,
        doublon_de: stockee.doublon_de ?? null },
      comptes: lectures.map((l) => ({
        id: Number(l.compte.id), type: normaliserType(l.compte), typePowens: String(l.compte.type ?? ""),
        nom: nettoyerLibelle(l.compte.name ?? l.compte.original_name) || "Compte", solde: nombre(l.compte.balance),
        crd: nombre(l.compte.loan?.remaining_capital), actif: !l.compte.disabled && !l.compte.deleted,
        isins: l.placements ? [...new Set(l.placements.filter((inv: any) => inv && !inv.deleted).map(isinDe).filter(Boolean) as string[])] : null,
      })),
      etatComptes: tousComptes,
      connexions, lignes, credits,
      liees: [...placements.map((p: any) => texte(p.position_id)), ...Object.values(acceptes)].filter(Boolean) as string[],
      deuxPersonnes, idsCourant, idsLivret,
    });
    // Compte dont la proposition acceptée attend son rattachement : jamais rapproché (la ligne existe déjà).
    for (const id of Object.keys(acceptes)) if (rapprochement.comptes[id]) rapprochement.comptes[id].auto = null;
  }
  const donnees = {
    userId, connexion, comptes: lectures, lectureComptesOk, erreurComptes, maintenant: maintenant.toISOString(), aujourdhui, minDate, lots,
    idsPropositions, idsLignes, idsLiquidites, rapprochement,
  };
  const etatPlan = { comptes: etatComptes, placements, lotsExistants, acceptes, lignes };
  let plan = planifier(etatPlan, donnees);
  rapport.erreurs.push(...plan.erreurs);
  rapport.notes.push(...plan.notes);
  rapport.etat = plan.connexion.etat;

  const etape = async (quoi: string, f: () => Promise<{ error: any } | any>) => {
    try {
      const r = await f();
      if (r?.error) throw new Error(r.error.message ?? String(r.error));
      return true;
    } catch (e) {
      rapport.erreurs.push({ erreur: `${quoi} : ${msg(e)}` });
      return false;
    }
  };

  await etape("enregistrement de la connexion", () => db.from("banque_connexions").upsert(plan.connexion, { onConflict: "user_id,id" }));
  if (plan.comptes.length && await etape("enregistrement des comptes", () => db.from("banque_comptes").upsert(plan.comptes, { onConflict: "user_id,id" }))) {
    rapport.comptes = plan.comptes.length;
  }

  // Rapprochement automatique : lignes à créer d'abord (la cible doit exister), puis rattachement, seulement si le compte est encore
  // libre (choix de l'utilisateur entre-temps, ligne ou crédit pris par un autre compte : rien n'est écrasé). En échec : la ligne
  // créée pour l'occasion est retirée, la cible devient une suggestion, et le plan est recalculé sans ce rattachement.
  if (rapprochement?.autres.detacher.length) {
    // Comptes en double : leur rattachement automatique est libéré pour le compte jumeau (index uniques ligne / crédit).
    await etape("détachement des comptes en double", () => db.from("banque_comptes")
      .update({ position_id: null, enveloppe: null, titulaire: null, credit_id: null, rattache_auto: null, cree_auto: false })
      .eq("user_id", userId).in("id", rapprochement!.autres.detacher).not("rattache_auto", "is", null));
  }
  const lignesAutoOk = new Set<string>();
  if (plan.lignesAuto.length && await etape("création des lignes (rattachement automatique)",
    () => db.from("positions").upsert(plan.lignesAuto, { onConflict: "id", ignoreDuplicates: true }))) {
    for (const l of plan.lignesAuto) lignesAutoOk.add(l.id);
  }
  const echecs: number[] = [], reussis: number[] = [];
  for (const a of plan.rattachementsAuto) {
    const n = { lignes: 0 };
    const ok = (!a.ligne || lignesAutoOk.has(a.ligne)) && await etape("rattachement automatique d'un compte", async () => {
      const r = await db.from("banque_comptes").update({ ...a.patch, rattache_auto: maintenant.toISOString(), cree_auto: a.cree, suggestion: null })
        .eq("user_id", userId).eq("id", a.id).is("position_id", null).is("enveloppe", null).is("credit_id", null).neq("ignore", true)
        .is("doublon_de", null).is("rattache_auto", null).is("auto_retire_le", null).select("id");
      n.lignes = Array.isArray(r?.data) ? r.data.length : 0;
      return r;
    });
    if (ok && n.lignes) { reussis.push(a.id); rapport.rattaches_auto++; if (a.cree) rapport.crees_auto++; continue; }
    echecs.push(a.id);
    if (ok) rapport.notes.push(`compte ${a.id} : rattachement automatique non posé (compte rattaché entre-temps)`);
    if (a.ligne && lignesAutoOk.has(a.ligne)) {
      await etape("retrait d'une ligne créée pour un rattachement non posé", () => db.from("positions").delete()
        .eq("user_id", userId).eq("id", a.ligne).eq("source_auto", "powens"));
    }
  }
  if (echecs.length && rapprochement) {
    for (const id of echecs) {
      const rp = rapprochement.comptes[String(id)];
      const sugg = rp?.auto?.ligne ? null : rp?.auto?.suggestion ?? null; // une ligne qui n'a pas été créée ne se suggère pas
      if (rp) { rp.auto = null; rp.suggestion = sugg; }
      if (sugg) await etape("suggestion", () => db.from("banque_comptes").update({ suggestion: sugg }).eq("user_id", userId).eq("id", id).is("rattache_auto", null));
    }
    plan = planifier(etatPlan, donnees);
    plan.rattachementsAuto = []; plan.lignesAuto = [];
  }
  // Doublons : marques sur les comptes et la connexion jumelles (autre connexion du même établissement).
  if (rapprochement) {
    for (const t of rapprochement.autres.transferts) {
      const n = { lignes: 0 };
      const ok = await etape("rattachement repris par le compte jumeau", async () => {
        const r = await db.from("banque_comptes").update({ ...t.patch, rattache_auto: maintenant.toISOString(), cree_auto: t.cree, suggestion: null })
          .eq("user_id", userId).eq("id", t.id).is("position_id", null).is("enveloppe", null).is("credit_id", null).neq("ignore", true)
          .is("rattache_auto", null).is("auto_retire_le", null).select("id");
        n.lignes = Array.isArray(r?.data) ? r.data.length : 0;
        return r;
      });
      if (ok && n.lignes) rapport.rattaches_auto++;
    }
    for (const c of rapprochement.autres.comptes) {
      await etape("compte en double", () => db.from("banque_comptes").update({ doublon_de: c.doublon_de }).eq("user_id", userId).eq("id", c.id));
    }
    for (const c of rapprochement.autres.connexions) {
      await etape("connexion en double", () => db.from("banque_connexions").update({ doublon_de: c.doublon_de }).eq("user_id", userId).eq("id", c.id));
    }
    rapport.doublon_de = rapprochement.connexionDoublon;
    rapport.comptes_en_double = Object.values(rapprochement.comptes).filter((c) => c.doublon_de != null).length;
    rapport.suggestions = Object.values(rapprochement.comptes).filter((c) => c.suggestion && !c.auto).length;
  }
  // Propositions « créer une ligne » encore en attente d'un compte désormais rattaché automatiquement ou en double : retirées
  // (les accepter créerait une seconde ligne).
  const caducs = [...new Set([...reussis, ...(rapprochement?.nouveauxDoublons ?? [])])];
  if (caducs.length) {
    const lotsCaducs: string[] = [];
    for (const id of caducs) lotsCaducs.push(lots[String(id)] ?? await lotProposition(userId, id));
    await etape("propositions devenues sans objet", () => db.from("propositions").delete().eq("user_id", userId).in("lot", lotsCaducs).eq("statut", "en_attente"));
  }
  for (const r of plan.rattachements) {
    // Seulement s'il est encore libre (l'utilisateur a pu le rattacher entre-temps).
    if (await etape("rattachement d'un compte (proposition acceptée)", () => db.from("banque_comptes").update({ position_id: r.position_id })
      .eq("user_id", userId).eq("id", r.id).is("position_id", null).is("enveloppe", null))) rapport.rattaches++;
  }
  if (plan.comptesInactifs.length) {
    await etape("comptes disparus", () => db.from("banque_comptes").update({ actif: false, maj_le: maintenant.toISOString() })
      .eq("user_id", userId).in("id", plan.comptesInactifs));
  }
  if (plan.instruments.length) {
    await etape("instruments", () => db.from("instruments").upsert(plan.instruments, { onConflict: "isin", ignoreDuplicates: true }));
  }
  const creees = new Set<string>();
  if (plan.positionsCreer.length && await etape("création des lignes de marché",
    () => db.from("positions").upsert(plan.positionsCreer, { onConflict: "id", ignoreDuplicates: true }))) {
    rapport.positions_creees = plan.positionsCreer.length;
    for (const p of plan.positionsCreer) creees.add(p.id);
  }
  const nonAdoptees = new Set<string>();
  for (const m of plan.positionsMaj) {
    if (m.adoption) {
      // Ligne existante reprise : écrite sans filtre source_auto ; si elle a disparu entre-temps, le lien n'est pas posé.
      const lues = { n: 0 };
      const ok = await etape("adoption d'une ligne", async () => {
        const r = await db.from("positions").update(m.patch).eq("user_id", userId).eq("id", m.id).select("id");
        lues.n = Array.isArray(r?.data) ? r.data.length : 0;
        return r;
      });
      if (ok && lues.n) rapport.lignes_adoptees++;
      else {
        nonAdoptees.add(m.id);
        if (ok) rapport.notes.push(`ligne ${m.id} introuvable au moment de l'adoption ; non liée`);
      }
      continue;
    }
    await etape("mise à jour d'une ligne", () => {
      const q = db.from("positions").update(m.patch).eq("user_id", userId).eq("id", m.id);
      return m.auto ? q.eq("source_auto", "powens") : q;
    });
  }
  // Un lien vers une ligne non créée ou non adoptée (échec ci-dessus) n'est pas enregistré : nouvel essai au prochain passage.
  const placementsOk = plan.placements.map((p) => (p.position_id && (nonAdoptees.has(p.position_id)
    || (plan.positionsCreer.some((c) => c.id === p.position_id) && !creees.has(p.position_id)))
    ? { ...p, position_id: null, ligne_creee_le: null } : p));
  if (placementsOk.length) await etape("placements", () => db.from("banque_placements").upsert(placementsOk, { onConflict: "user_id,id" }));
  if (plan.placementsSupprimer.length) {
    await etape("placements disparus", () => db.from("banque_placements").delete().eq("user_id", userId).in("id", plan.placementsSupprimer));
  }
  for (const c of plan.creditsMaj) {
    await etape("mise à jour du crédit", () => db.from("credits").update({ crd: c.crd }).eq("user_id", userId).eq("id", c.id));
  }
  // Opérations : celles des 90 jours déjà en base (toutes connexions) sont relues d'abord, pour ne jamais remplacer une catégorie
  // « epargne » / « virement_interne » par la catégorie Powens et pour rapprocher les virements internes sur tous les comptes.
  // Lecture en échec : aucune opération écrite (nouvel essai au prochain passage), les retraits et le recalcul restent faits.
  let existantes: any[] | null = null;
  try {
    existantes = await lireOperations(db, userId, minDate);
  } catch (e) {
    rapport.erreurs.push({ erreur: `${msg(e)} ; opérations non écrites, nouvel essai au prochain passage` });
  }
  let moisDepuis = plan.moisDepuis;
  const comptesFusion = fusionComptes(tousComptes, plan.comptes);
  // Versements programmés (config.recurring) : lecture tolérante (en échec, seules les règles de libellé s'appliquent).
  let recurring: any[] = [];
  try {
    const cf = await db.from("config").select("recurring").eq("user_id", userId).maybeSingle();
    if (cf?.error) throw new Error(cf.error.message);
    recurring = Array.isArray(cf?.data?.recurring) ? cf.data.recurring : [];
  } catch (e) {
    rapport.notes.push(`versements programmés illisibles (${msg(e)}) : épargne repérée par le libellé seulement`);
  }
  const ctxEpargne = contexteEpargne({ lignes, comptes: comptesFusion, recurring, personnes: profil?.personnes,
    connexions: [...connexions.filter((c: any) => Number(c.id) !== Number(connexionId)), { id: connexionId, etablissement: plan.connexion.etablissement ?? stockee.etablissement ?? null }] });
  let toutes: any[] | null = null;
  if (existantes) {
    const prep = preparerOperations(plan.operations, plan.operationsSupprimer, existantes, comptesFusion, ctxEpargne);
    toutes = prep.toutes;
    for (const paquet of parPaquets(prep.operations)) {
      if (await etape("opérations", () => db.from("banque_operations").upsert(paquet, { onConflict: "user_id,id" }))) rapport.operations += paquet.length;
    }
    // Autres opérations requalifiées (contrepartie d'un virement sur un autre compte, versement d'épargne) : mises à jour, mois recalculés.
    for (const [categorie, ids] of Object.entries(prep.autres)) {
      for (const paquet of parPaquets(ids)) {
        await etape("virements internes", () => db.from("banque_operations").update({ categorie }).eq("user_id", userId).in("id", paquet));
      }
    }
    rapport.virements_internes = prep.virements;
    rapport.versements_epargne = prep.epargne;
    if (prep.depuis) {
      const m = premierDuMois(prep.depuis);
      if (!moisDepuis || m < moisDepuis) moisDepuis = m;
    }
  }
  if (plan.operationsSupprimer.length) {
    await etape("opérations retirées", () => db.from("banque_operations").delete().eq("user_id", userId).in("id", plan.operationsSupprimer));
  }
  if (moisDepuis) {
    await etape("totaux mensuels", () => db.rpc("banque_recalculer_mois", { p_user: userId, p_depuis: moisDepuis }));
  }
  // Revenus détectés : proposition profil (salaire net mensuel de la personne 1), jamais appliquée ici.
  if (toutes) await proposerRevenus(db, userId, toutes, comptesFusion, aujourdhui, profil, rapport, etape);
  if (plan.propositions.length && await etape("propositions",
    () => db.from("propositions").upsert(plan.propositions, { onConflict: "id", ignoreDuplicates: true }))) {
    rapport.propositions = plan.propositions.length;
    await etape("trace des propositions", () => db.from("banque_comptes").update({ propose_le: maintenant.toISOString() })
      .eq("user_id", userId).in("id", plan.comptesProposes));
  }
}

/** Opérations de l'utilisateur depuis `depuis` (toutes connexions), par pages de 1000 (limite de l'API de données), dans l'ordre
    des identifiants (entiers Powens) : page suivante = identifiants au-delà du dernier lu. Lève en cas d'échec. */
async function lireOperations(db: any, userId: string, depuis: string): Promise<any[]> {
  const PAGE = 1000, tout: any[] = [];
  for (let apres: number | null = null; ;) {
    let q = db.from("banque_operations").select("id, compte_id, date, montant, libelle, categorie").eq("user_id", userId).gte("date", depuis);
    if (apres != null) q = q.gte("id", apres + 1);
    const { data, error } = await q.order("id").limit(PAGE);
    if (error) throw new Error(`lecture des opérations : ${error.message}`);
    const l = data ?? [];
    tout.push(...l);
    if (l.length < PAGE) return tout;
    const dernier = Math.max(...l.map((o: any) => Number(o.id)));
    if (!Number.isSafeInteger(dernier) || (apres != null && dernier < apres + 1)) return tout;
    apres = dernier;
  }
}
/** Comptes vus par le rapprochement des virements : ceux en base (ignore, doublon_de), complétés par ceux de ce passage (type,
    carte à débit différé, compte en double). */
function fusionComptes(enBase: any[], frais: any[]): any[] {
  const parId = new Map((enBase ?? []).map((k) => [String(k.id), { ...k }]));
  for (const c of frais ?? []) {
    const k = parId.get(String(c.id)) ?? { id: c.id, connexion_id: c.connexion_id };
    k.type = c.type; k.debit_differe = c.debit_differe;
    if ("doublon_de" in c) k.doublon_de = c.doublon_de;
    parId.set(String(c.id), k);
  }
  return [...parId.values()];
}
/** Revenus détectés → proposition profil : une par lot (libellé nettoyé, dernier mois complet) ; une détection précédente encore en
    attente est remplacée (jamais deux en attente) ; rien si une proposition de même source a été refusée pour un salaire à 10 %
    près. Ne lève pas (erreurs dans le rapport). */
async function proposerRevenus(db: any, userId: string, toutes: any[], comptes: any[], aujourdhui: string, profil: any, rapport: any,
  etape: (quoi: string, f: () => Promise<any>) => Promise<boolean>) {
  const det = revenusDetectes(toutes, comptes, aujourdhui);
  if (!det) return;
  const lot = await lotRevenus(userId, det.cle, moisDecale(aujourdhui, -1));
  const prop = propositionRevenus(det, profil, { userId, id: await idRevenus(lot), lot });
  if (!prop) return;
  let deja: any[] = [];
  const lu = await etape("lecture des propositions de revenus", async () => {
    const r = await db.from("propositions").select("id, lot, statut, apres").eq("user_id", userId).eq("source", SOURCE_REVENUS);
    deja = r?.data ?? [];
    return r;
  });
  if (!lu) return;
  const salaire = prop.apres.personnes.p1.salaire;
  const refuse = (p: any) => {
    const s = Number(p?.apres?.personnes?.p1?.salaire);
    return p.statut === "refusee" && s > 0 && Math.abs(salaire - s) / s <= REVENU_ECART;
  };
  if (deja.some((p) => String(p.lot) === lot) || deja.some(refuse)) return;
  if (deja.some((p) => p.statut === "en_attente")) {
    if (!await etape("propositions de revenus remplacées", () => db.from("propositions").delete().eq("user_id", userId).eq("source", SOURCE_REVENUS)
      .eq("statut", "en_attente").neq("lot", lot))) return;
  }
  if (await etape("proposition de revenus", () => db.from("propositions").upsert(prop, { onConflict: "id", ignoreDuplicates: true }))) rapport.revenus_proposes = 1;
}

/** Oublie localement une connexion (déconnexion ou CONNECTION_DELETED) : les lignes alimentées repassent en saisie manuelle,
    puis la connexion est supprimée (cascade sur comptes, placements et opérations) et les totaux recalculés. Lève en cas d'échec. */
export async function oublierConnexion(db: any, userId: string, connexionId: number, opts: { maintenant?: Date } = {}) {
  const maintenant = opts.maintenant ?? new Date();
  const ok = (r: any, quoi: string) => { if (r?.error) throw new Error(`${quoi} : ${r.error.message}`); return r?.data ?? []; };
  const comptes = ok(await db.from("banque_comptes").select("id, position_id").eq("user_id", userId).eq("connexion_id", connexionId), "lecture des comptes");
  const idsComptes = comptes.map((c: any) => Number(c.id));
  const placements = idsComptes.length
    ? ok(await db.from("banque_placements").select("position_id").eq("user_id", userId).in("compte_id", idsComptes), "lecture des placements")
    : [];
  const positions = [...new Set([...comptes, ...placements].map((x: any) => texte(x.position_id)).filter(Boolean))];
  if (positions.length) {
    ok(await db.from("positions").update({ source_auto: null, source_auto_le: null }).eq("user_id", userId).in("id", positions), "lignes");
  }
  ok(await db.from("banque_connexions").delete().eq("user_id", userId).eq("id", connexionId), "suppression de la connexion");
  // Mois encore couverts par le détail ; la fonction SQL ne recalcule jamais un mois de plus de 90 jours.
  const depuis = premierDuMois(moinsJours(dateParis(maintenant), JOURS_DETAIL));
  const r = await db.rpc("banque_recalculer_mois", { p_user: userId, p_depuis: depuis });
  if (r?.error) console.warn("powens: recalcul des mois après déconnexion en échec", r.error.message);
}
