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
// Budget réel (CP1, docs/superpowers/specs/2026-10-12-cp1-comptes-performance-design.md § 5, corrigé après relecture : migration
// 0025) : après la lecture d'une connexion, les opérations des 90 jours de l'utilisateur (toutes connexions) sont relues (par pages,
// jusqu'à une page vide) et fusionnées avec celles du passage ; le rapprochement est recalculé de zéro à chaque passage à partir de
// la catégorie Powens de chaque opération (banque_operations.categorie_powens) : `rapprocherVirements` (pur) classe les virements
// entre comptes suivis (montant opposé à 0,01 €, ≤ 3 jours, un pour un, le plus proche ; indice de virement d'un côté au moins ;
// jamais une carte, un prélèvement, un revenu ou une dépense catégorisée par Powens) en « virement_interne », ou « epargne » côté
// courant d'un virement avec l'épargne (versement, ou retour d'épargne en entrée), et trace la contrepartie (contrepartie_id) ;
// `epargneSansContrepartie` classe en « epargne » les versements vers des placements non synchronisés (mot de placement, nom
// entier d'une enveloppe, établissement d'investissement, versement programmé, virement vers soi ; jamais un nom du foyer seul,
// jamais une carte). Un appariement qui n'est plus trouvé est défait (catégorie Powens rendue) ; les opérations d'autres comptes
// qui changent sont mises à jour et leurs mois recalculés (banque_mois, un total par compte). `revenusDetectes` /
// `propositionRevenus` (purs) déposent au plus une proposition profil (salaire net de la personne la plus proche, p1 ou p2 ;
// abstention si ambigu ; source « Powens — revenus détectés », jamais appliquée).
// Robustesse : une lecture en échec n'efface rien (placements, opérations, comptes) ; une erreur sur un compte ou sur une étape
// d'écriture n'arrête pas les autres ; le dernier échec est résumé dans banque_connexions.message.
//
// Budget (BUD1, docs/superpowers/specs/2026-10-16-bud1-budget-design.md § 3.2, § 4 et § 13 ; migration 0035) : après `rapprocherVirements` et
// `epargneSansContrepartie`, `preparerOperations` classe chaque opération avec BudgetCategories.classer (copie générée du module partagé) : structure
// (rapprochement : virement_interne, epargne_precaution / investissement, apport_commun, transfert_foyer, releve_carte), puis tes règles (budget_regles
// actives), la table des marchands, la catégorie Powens, les motifs génériques, le revenu détecté, sinon « à classer ». La sous-catégorie, l'origine du
// classement, la règle et la clé de marchand sont écrites avec l'opération ; la catégorie large (`categorie`) devient celle de la sous-catégorie. Un
// virement apparié entre un compte de titulaire commun et un compte personnel est un apport_commun, entre deux comptes personnels de titulaires
// différents un transfert_foyer (titulaire inconnu : virement_interne). `detecterReleves` repère le relevé d'une carte à débit différé débité sur un
// courant de la même connexion (type Powens summary_card ou deferred_card, ou libellé « RELEVE CB / CARTE » d'un montant égal, à 1 € près, à la somme des
// opérations de la carte sur la période) : il devient releve_carte (hors budget) et banque_recalculer_mois compte alors les opérations de la carte à leur
// mois. `reclasser` (POST /powens/reclasser) rejoue le classement sur les 90 derniers jours avec les règles actives, recalcule les mois touchés et, de 90
// jours à 13 mois, reclasse banque_marchands_mois puis reconstruit banque_mois (budget_marchands_reclasser, budget_reclasser_historique).
//
// Données du prêt (DAT1, docs/superpowers/specs/2026-10-14-dat1-calendrier-design.md § 2.6 et § 7) : pour un compte de type credit,
// `pretDe` (pure) copie sur banque_comptes.pret les seuls champs documentés de l'objet `loan` qui sont présents et valides, et
// banque_comptes.ouverture_le reçoit loan.subscription_date (null pour tout autre type : Powens ne documente aucune date
// d'ouverture hors prêt). Un compte de crédit rattaché à un crédit (credit_id), avec un prêt renseigné, sans infos_proposees_le et
// sans clé « credit:<id> » déjà présente dans config.prets_infos, reçoit UNE proposition config/prets_infos (`infosPret`, pure),
// identifiant déterministe (powens-pret-<user>-<compte>), puis infos_proposees_le est posé, une seule fois même si la proposition
// est refusée. Jamais de proposition enveloppes_infos. Le rattachement d'un compte à un bien n'existe pas dans BQ1
// (banque_comptes n'a pas de bien_id) : seule la clé « credit:<id> » est proposée.
//
// Champs Powens lus (documentation consultée le 2026-10-14) :
// - connexion (https://docs.powens.com/api-reference/user-connections/connections) : id, state, error_message, last_update
//   (UTC, « AAAA-MM-JJ HH:MM:SS »), connector.name (expand=connector). États :
//   https://docs.powens.com/documentation/integration-guides/sca-and-connection-states ;
// - compte (https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts) : id, name, original_name, balance,
//   currency.id, type (AccountTypeName, https://docs.powens.com/api-reference/products/data-aggregation/bank-account-types),
//   disabled, deleted, last_update ; le numéro et l'IBAN ne sont jamais lus ;
// - prêt imbriqué `loan` du même objet compte (tous champs nullables, aucune garantie de remplissage par banque) : subscription_date,
//   maturity_date, start_repayment_date (dates AAAA-MM-JJ), rate, duration (mois), total_amount, insurance_rate, next_payment_date,
//   type (mortgage | consumercredit | revolvingcredit | loan). Unités : `insurance_rate` est documenté « entre 0 et 1 » (ratio) →
//   proposé en pourcentage (× 100, borné 0 à 5) ; l'échelle de `rate` n'est PAS documentée (« Rate of the loan ») → copié tel quel
//   dans banque_comptes.pret, jamais proposé comme taux_pct tant que Powens ne la précise pas. Capital restant dû (FIX3) :
//   l'objet `loan` documenté n'en porte aucun (total_amount, available_amount, used_amount = montant déjà débloqué, pas le restant dû ;
//   le capital restant dû n'existe que dans la ressource « amortizations », activée sur demande). Le CRD est donc le solde du compte
//   de prêt (documenté, négatif), en valeur absolue (`capitalRestantDu`) ; `loan.remaining_capital`, non documenté, ne sert que de repli ;
// - placement (https://docs.powens.com/api-reference/products/data-aggregation/investments) : id, code, code_type (ISIN | AMF),
//   label, quantity, unitprice (prix de revient unitaire), valuation, deleted ;
// - opération (https://docs.powens.com/api-reference/products/data-aggregation/bank-transactions) : id, date, value,
//   simplified_wording, wording, original_wording, categories, type (transfer, card, deferred_card, order…), coming, deleted.
import { categorieBoussole } from "./categories.ts";
import { BudgetCategories } from "./budget-categories.gen.js";

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

/* ---------- prêt (DAT1) ---------- */
const TYPES_PRET = ["mortgage", "consumercredit", "revolvingcredit", "loan"];
/** Jour AAAA-MM-JJ réel d'une date Powens (une chaîne ISO complète est tronquée au jour) ; null si absent ou impossible (2026-02-30). */
function jourReel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** Nombre fini (nombre JSON, ou chaîne numérique stricte) ; null sinon. */
function nombreFini(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}
/** Capital restant dû d'un compte de prêt, en valeur absolue : solde du compte (champ documenté) d'abord, puis `loan.remaining_capital`
 *  (non documenté par Powens, simple repli), sinon null. */
export function capitalRestantDu(compte: any): number | null {
  const solde = nombre(compte?.balance);
  if (solde != null) return Math.abs(solde);
  const repli = nombre(compte?.loan?.remaining_capital);
  return repli == null ? null : Math.abs(repli);
}

/** Champs documentés de `compte.loan`, présents et valides, rien d'autre ; null si `loan` est absent, vide ou sans champ exploitable.
    Aucune date n'est inventée ni déduite. Ne lève pas. */
export function pretDe(compte: any): Record<string, string | number> | null {
  const loan = compte?.loan;
  if (!loan || typeof loan !== "object" || Array.isArray(loan)) return null;
  const sortie: Record<string, string | number> = {};
  for (const k of ["subscription_date", "maturity_date", "start_repayment_date"]) {
    const j = jourReel(loan[k]);
    if (j) sortie[k] = j;
  }
  for (const k of ["rate", "duration", "total_amount", "insurance_rate"]) {
    const n = nombreFini(loan[k]);
    if (n != null) sortie[k] = n;
  }
  const next = jourReel(loan.next_payment_date);
  if (next) sortie.next_payment_date = next;
  const type = typeof loan.type === "string" ? loan.type.trim().toLowerCase() : "";
  if (TYPES_PRET.includes(type)) sortie.type = type;
  return Object.keys(sortie).length ? sortie : null;
}
/** Informations du prêt à proposer dans config.prets_infos (sans source ni date de saisie), bornées comme la base : un champ hors
    limites est omis (la base refuserait la proposition entière) ; null si aucun champ n'est proposable. `taux_pct` n'est jamais
    proposé (échelle de `rate` non documentée). `aujourdhui` : AAAA-MM-JJ à Paris. */
export function infosPret(pret: any, aujourdhui: string): Record<string, string | number> | null {
  if (!pret || typeof pret !== "object") return null;
  const sortie: Record<string, string | number> = {};
  const signature = jourReel(pret.subscription_date);
  if (signature && signature >= "1950-01-01" && signature <= aujourdhui) sortie.date_signature = signature;
  const fin = jourReel(pret.maturity_date);
  if (fin && (!sortie.date_signature || fin > sortie.date_signature)) sortie.date_fin = fin;
  const duree = nombreFini(pret.duration);
  if (duree != null && Number.isInteger(duree) && duree >= 1 && duree <= 480) sortie.duree_mois = duree;
  const assurance = nombreFini(pret.insurance_rate); // ratio de 0 à 1 (documentation Powens) → pourcentage
  if (assurance != null && assurance >= 0 && assurance <= 1) {
    const pct = Math.round(assurance * 1e6) / 1e4;
    if (pct <= 5) sortie.assurance_taux_pct = pct;
  }
  return Object.keys(sortie).length ? sortie : null;
}

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
/** Lot et identifiant de la proposition prets_infos d'un compte de crédit (une seule, même si deux synchronisations la déposent). */
export function lotPret(userId: string, compteId: number | string): Promise<string> {
  return uuidDeterministe(`powens-pret-lot-${userId}-${compteId}`);
}
export function idPret(userId: string, compteId: number | string): Promise<string> {
  return uuidDeterministe(`powens-pret-${userId}-${compteId}`);
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
/** Catégories posées par le rapprochement (virements entre comptes connectés, versements d'épargne sans contrepartie). Elles sont
    recalculées à chaque synchronisation à partir de la catégorie Powens (banque_operations.categorie_powens, migration 0025) :
    un appariement qui n'est plus valide (contrepartie disparue, règle plus stricte) rend sa catégorie Powens à l'opération. */
export const CATEGORIES_INTERNES = ["epargne", "virement_interne"];
/** Comptes d'épargne ou d'investissement : un virement du courant vers l'un d'eux est de l'épargne ; un virement de l'un d'eux
    vers le courant, un retour d'épargne (épargne nette, I9). */
export const TYPES_EPARGNE = ["livret", "pea", "compte_titres", "assurance_vie", "per"];
/** Écart maximal de dates (jours) et de montant (centimes) entre les deux côtés d'un virement interne. */
export const VIREMENT_JOURS = 3;
export const VIREMENT_CENTIMES = 1;
/** Indices d'un virement (suites de mots du libellé nettoyé, ou type Powens « transfer ») : exigés d'un côté au moins (I1). */
export const MARQUES_VIREMENT = [["vir"], ["virt"], ["virement"], ["virements"], ["transfert"], ["transferts"], ["transfer"]];
/** Types Powens (https://docs.powens.com/api-reference/products/data-aggregation/bank-transactions, champ type). */
const TYPES_POWENS_VIREMENT = ["transfer"];
const TYPES_POWENS_CARTE = ["card", "deferred_card", "summary_card"];
/** Catégories Powens qui permettent l'appariement : tout le reste (revenus, dépenses catégorisées) n'est jamais un virement interne. */
const CATEGORIES_APPARIABLES = ["divers", "epargne"];
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
/** Noms de mois (complets et abrégés, sans accents) retirés des libellés : « SALAIRE AOÛT » et « SALAIRE SEPT » sont le même flux.
    Même liste que MOIS_LIBELLES de mcp/banque.ts (parité testée). */
export const MOIS_LIBELLES = ["janvier", "janv", "jan", "fevrier", "fevr", "fev", "mars", "mar", "avril", "avr", "mai", "juin", "juillet", "juil",
  "juill", "aout", "septembre", "sept", "sep", "octobre", "oct", "novembre", "nov", "decembre", "dec"];
/** Libellé nettoyé pour repérer une récurrence : même règle que cleLibelle de mcp/banque.ts (minuscules, sans accents, sans
    chiffres ni ponctuation, sans noms de mois, espaces réduits). Dupliquée ici : la fonction powens ne charge pas le module du
    connecteur ; parité testée (test/banque-mcp.test.mjs). */
export function cleLibelle(t: unknown): string {
  return String(t ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, " ").trim()
    .split(" ").filter((m) => m && !MOIS_LIBELLES.includes(m)).join(" ");
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
const jetons = (t: unknown) => cleLibelle(t).split(" ").filter(Boolean);
const typePowens = (o: any) => String(o?.type_powens ?? "").trim().toLowerCase();
/** Paiement par carte : type Powens card / deferred_card / summary_card, ou libellé « CB … », « CARTE … », « PAIEMENT PAR CARTE ». */
export function estCarte(o: any): boolean {
  if (TYPES_POWENS_CARTE.includes(typePowens(o))) return true;
  const ts = jetons(o?.libelle);
  return ts[0] === "cb" || ts[0] === "carte" || ts.includes("cb") || contient(ts, ["par", "carte"]) || contient(ts, ["paiement", "carte"]);
}
/** Prélèvement (type Powens order, libellé « PRLV … » ou « PRELEVEMENT … ») : jamais un virement entre ses propres comptes. */
const estPrelevement = (o: any) => typePowens(o) === "order" || ((ts) => ts.includes("prlv") || ts[0] === "prelevement" || ts[0] === "prelevements")(jetons(o?.libelle));
/** Indice d'un virement : type Powens transfer, ou VIR / VIREMENT / TRANSFERT… dans le libellé (VIR INST, VIR SEPA, VIR.PERMANENT). */
const indiceVirement = (o: any) => TYPES_POWENS_VIREMENT.includes(typePowens(o)) || MARQUES_VIREMENT.some((m) => contient(jetons(o?.libelle), m));
const VIREMENT_INTERNE = "virement_interne";
/** Catégorie de départ d'une opération (avant rapprochement) : sa catégorie Powens (categorie_powens) ; à défaut (opération
    écrite avant la migration 0025), sa catégorie, sauf « virement_interne » (posée par un ancien rapprochement) → « divers ». */
export function categorieDeBase(o: any): string {
  const p = texte(o?.categorie_powens);
  if (p) return p;
  const c = texte(o?.categorie);
  return !c || c === VIREMENT_INTERNE ? "divers" : c;
}
/** Virements internes (pur) : sur les opérations de tous les comptes suivis de l'utilisateur, une sortie et une entrée de montant
    opposé (à VIREMENT_CENTIMES près), sur deux comptes différents, à VIREMENT_JOURS jours au plus, forment un virement, si (I1)
    l'un des deux côtés au moins porte un indice de virement (indiceVirement), qu'aucun n'est un paiement par carte ni un
    prélèvement, et que leur catégorie de départ (o.categorie, catégorie Powens) est « divers » ou « epargne » (un revenu ou une
    dépense catégorisée par Powens n'est jamais un virement interne). Appariement un pour un, le plus proche en date d'abord (puis
    le montant le plus proche, puis les identifiants : déterministe). Catégorie « virement_interne » des deux côtés, sauf côté
    courant d'un virement avec un compte d'épargne ou d'investissement : « epargne » (sortie : versement ; entrée : retour
    d'épargne, I9). Renvoie, pour les opérations appariées, la catégorie (identifiant → catégorie) et la contrepartie
    (identifiant → identifiant), et les paires (sortie, entrée). Recalcul idempotent : mêmes opérations → même résultat. */
export function rapprocherVirements(operations: any[], comptes: any[]) {
  const suivis = comptesSuivis(comptes);
  const appariable = (o: any) => CATEGORIES_APPARIABLES.includes(texte(o.categorie) ?? "divers") && !estCarte(o) && !estPrelevement(o);
  const ops = (operations ?? []).filter((o) => o && o.id != null && suivis.has(String(o.compte_id)) && jour(o.date) && centimes(o.montant) && appariable(o));
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
        if (String(e.compte_id) === String(d.compte_id) || !(indiceVirement(d) || indiceVirement(e))) continue;
        const jours = ecartJours(jour(d.date)!, jour(e.date)!);
        if (jours <= VIREMENT_JOURS) candidats.push({ d, e, jours, ecart: Math.abs(k + c) });
      }
    }
  }
  candidats.sort((a, b) => a.jours - b.jours || a.ecart - b.ecart || compareIds(a.d.id, b.d.id) || compareIds(a.e.id, b.e.id));
  const pris = new Set<string>(), categories: Record<string, string> = {}, contreparties: Record<string, number> = {}, paires: [unknown, unknown][] = [];
  const structures: Record<string, string> = {};
  for (const { d, e } of candidats) {
    if (pris.has(String(d.id)) || pris.has(String(e.id))) continue;
    pris.add(String(d.id)); pris.add(String(e.id));
    paires.push([d.id, e.id]);
    const kd = suivis.get(String(d.compte_id)), ke = suivis.get(String(e.compte_id));
    const td = kd.type, te = ke.type;
    categories[String(d.id)] = td === "courant" && TYPES_EPARGNE.includes(te) ? "epargne" : VIREMENT_INTERNE;
    categories[String(e.id)] = te === "courant" && TYPES_EPARGNE.includes(td) ? "epargne" : VIREMENT_INTERNE;
    structures[String(d.id)] = structureDeCote(kd, ke, categories[String(d.id)]);
    structures[String(e.id)] = structureDeCote(ke, kd, categories[String(e.id)]);
    contreparties[String(d.id)] = Number(e.id);
    contreparties[String(e.id)] = Number(d.id);
  }
  return { categories, contreparties, paires, structures };
}

/** Titulaire d'un compte pour le budget (BUD1 § 4.2, § 4.3) : "commun" (titulaire commun, ou compte rattaché à une ligne de titulaire commun), "p1" ou
    "p2" ; null quand il n'est pas connu (jamais deviné d'après le nom : le nom ne fait que le suggérer, voir suggestionTitulaireCommun). */
export function titulaireDe(k: any): "commun" | "p1" | "p2" | null {
  if (!k) return null;
  if (k.titulaire === "commun" || k.commun === true) return "commun";
  return k.titulaire === "p1" || k.titulaire === "p2" ? k.titulaire : null;
}
/** Sous-catégorie de structure d'un côté d'un virement apparié (BUD1 § 3.2 point 1). `cote` : le compte de cette opération, `autre` : le compte d'en face,
    `categorie` : la catégorie posée par le rapprochement. Côté courant d'un virement avec l'épargne : epargne_precaution (livret) ou investissement (PEA,
    compte-titres, assurance-vie, PER) ; entre un compte de titulaire commun et un compte personnel : apport_commun ; entre deux comptes personnels de
    titulaires différents : transfert_foyer ; sinon (titulaire inconnu, même titulaire, côté épargne du virement) : virement_interne. */
function structureDeCote(cote: any, autre: any, categorie: string): string {
  if (categorie === "epargne") return autre.type === "livret" ? "epargne_precaution" : "investissement";
  const a = titulaireDe(cote), b = titulaireDe(autre);
  if (a && b) {
    if ((a === "commun") !== (b === "commun")) return "apport_commun";
    if (a !== "commun" && a !== b) return "transfert_foyer";
  }
  return VIREMENT_INTERNE;
}
/** Suggestion de titulaire commun (BUD1, tâche 5) : un compte courant sans titulaire dont le nom contient « joint » ou « commun » (même règle que
    estCompteCommun) ; { titulaire: "commun", libelle, raison } ou null. Jamais appliquée seule : le titulaire se choisit (Compte › Données, ou Claude). */
export function suggestionTitulaireCommun(k: any): { titulaire: "commun"; libelle: string; raison: string } | null {
  if (!k || k.type !== "courant" || k.ignore === true || k.doublon_de != null || titulaireDe(k) !== null || texte(k.titulaire) !== null) return null;
  const ts = mots(k.nom);
  const mot = ts.includes("joint") ? "joint" : ts.includes("commun") || ts.includes("communs") ? "commun" : null;
  return mot ? { titulaire: "commun", libelle: "Compte commun", raison: `Le nom du compte contient « ${mot} » : choisis « Commun » pour qu'il soit compté comme le compte du foyer.` } : null;
}

/* Versements vers les placements de l'utilisateur sans contrepartie synchronisée (Powens ne lit pas les opérations d'un PEA, d'un
   PER ou d'une assurance-vie) : sortie d'un compte courant classée « epargne » plutôt qu'en dépense, d'après
   (1) son libellé nettoyé : mot de placement (MOTS_PLACEMENT), nom entier d'une enveloppe d'investissement de l'utilisateur, ou
       nom (entier ou mot significatif) d'un établissement où il a un compte d'investissement connecté (sans compte courant chez
       lui) ; les prénoms et noms du foyer ne sont jamais des termes (I5 : « PEA Camille » ne fait pas de « VIR CAMILLE » une épargne) ;
   (2) un versement programmé de config.recurring : montant à ±VERSEMENT_EUROS €, jour du mois à ±VERSEMENT_JOURS jours, opération
       sans catégorie précise (divers) ;
   (3) un virement vers soi-même (« vir permanent », ou « vir » suivi du nom d'une personne du foyer) dont le montant est celui
       d'un versement programmé (±VERSEMENT_EUROS €), quel que soit le jour.
   Jamais un paiement par carte ; jamais une opération rapprochée d'une contrepartie (virement interne) ; jamais une entrée. */
export const MOTS_PLACEMENT = [["pea"], ["per"], ["perin"], ["perp"], ["assurance", "vie"], ["linxea"], ["spirica"], ["versement", "programme"], ["compte", "titres"]];
export const MARQUES_VIREMENT_SOI = [["vir", "permanent"], ["virement", "permanent"], ["vir", "perm"]];
export const VERSEMENT_EUROS = 1;
export const VERSEMENT_JOURS = 5;
/** Mots trop généraux pour désigner à eux seuls une enveloppe ou un établissement. */
const MOTS_GENERIQUES = new Set(["banque", "bank", "banco", "credit", "caisse", "epargne", "assurance", "assurances", "societe", "generale",
  "compte", "comptes", "france", "groupe", "mutuel", "mutuelle", "populaire", "agricole", "postale", "titres", "titre", "retraite", "plan",
  "avenir", "placement", "placements", "enveloppe", "livret", "livrets", "courant", "courants", "bourse", "investissement", "invest", "moi"]);
/** Noms par défaut d'une personne du profil (calc.js, NOMS_PAR_DEFAUT) : jamais un nom. */
const NOMS_PAR_DEFAUT = new Set(["moi", "conjoint", "conjointe"]);
const TYPES_INVESTISSEMENT = ["pea", "compte_titres", "assurance_vie", "per"];
/** Prénoms et noms des personnes du foyer (profiles.personnes.p1 / p2 : prenom, nom, nomFamille, nom_famille), en mots nettoyés
    d'au moins 3 lettres, sans les noms par défaut (« Moi », « Conjoint ») ni les mots génériques. */
export function nomsFoyer(personnes: any): string[][] {
  const out: string[][] = [], vus = new Set<string>();
  for (const k of ["p1", "p2"]) {
    const p = personnes?.[k];
    for (const v of [p?.prenom, p?.nom, p?.nomFamille, p?.nom_famille]) {
      const ts = jetons(v).filter((m) => m.length >= 3 && !MOTS_GENERIQUES.has(m) && !NOMS_PAR_DEFAUT.has(m));
      if (ts.length && !vus.has(ts.join(" "))) { vus.add(ts.join(" ")); out.push(ts); }
    }
  }
  return out;
}
/** Termes d'un nom (enveloppe, établissement) : le nom entier (suite de mots), sauf s'il n'est fait que de noms du foyer et de mots
    génériques ; plus, si `mots`, chaque mot d'au moins 5 lettres ni générique ni nom du foyer. */
function termes(nom: unknown, foyer: Set<string>, mots: boolean): string[][] {
  const ts = jetons(nom);
  if (!ts.length || ts.every((m) => MOTS_GENERIQUES.has(m) || foyer.has(m))) return [];
  const out = [ts];
  if (mots && ts.length > 1) for (const m of ts) if (m.length >= 5 && !MOTS_GENERIQUES.has(m) && !foyer.has(m)) out.push([m]);
  return out;
}
export type ContexteEpargne = { termes: string[][]; versements: { montant: number; jour: number; debut: string | null }[]; noms: string[][] };
/** Contexte de l'épargne sans contrepartie (pur) : lignes de l'utilisateur (enveloppes d'investissement : type d'enveloppe ou ligne
    de marché ; nom entier seulement), comptes et connexions Powens (établissements d'investissement sans compte courant),
    config.recurring, personnes du foyer (noms, retirés des termes). */
export function contexteEpargne(e: { lignes?: any[]; comptes?: any[]; connexions?: any[]; recurring?: any; personnes?: any }): ContexteEpargne {
  const noms = nomsFoyer(e.personnes), foyer = new Set(noms.flat());
  const t: string[][] = [...MOTS_PLACEMENT];
  for (const p of e.lignes ?? []) {
    if (!p || p.status === "clôturé" || !texte(p.envelope)) continue;
    if (TYPES_INVESTISSEMENT.includes(typeEnveloppe(p.envelope).type ?? "") || p.mode === "market") t.push(...termes(p.envelope, foyer, false));
  }
  const parCx = new Map<string, Set<string>>();
  for (const k of e.comptes ?? []) {
    if (!k || k.connexion_id == null) continue;
    if (!parCx.has(String(k.connexion_id))) parCx.set(String(k.connexion_id), new Set());
    parCx.get(String(k.connexion_id))!.add(String(k.type));
  }
  for (const c of e.connexions ?? []) {
    const types = parCx.get(String(c?.id)) ?? new Set();
    if ([...types].some((x) => TYPES_INVESTISSEMENT.includes(x)) && !types.has("courant")) t.push(...termes(c.etablissement, foyer, true));
  }
  const vus = new Set<string>(), uniques = t.filter((x) => { const k = x.join(" "); if (vus.has(k)) return false; vus.add(k); return true; });
  const versements = (Array.isArray(e.recurring) ? e.recurring : []).filter((r: any) => r && Number(r.amount) > 0 && Number(r.day) >= 1)
    .map((r: any) => ({ montant: Number(r.amount), jour: Math.min(31, Math.trunc(Number(r.day))), debut: jour(r.start) }));
  return { termes: uniques, versements, noms };
}
/** Sorties des comptes courants suivis à classer « epargne » faute de contrepartie (pur) : identifiants → « epargne ».
    `exclues` : opérations rapprochées d'une contrepartie (jamais requalifiées). Les catégories lues sont les catégories de départ. */
export function epargneSansContrepartie(operations: any[], comptes: any[], ctx: ContexteEpargne | null | undefined, exclues: Set<string> = new Set()) {
  const out: Record<string, string> = {};
  if (!ctx) return out;
  const suivis = comptesSuivis(comptes);
  for (const o of operations ?? []) {
    if (!o || o.id == null || exclues.has(String(o.id)) || suivis.get(String(o.compte_id))?.type !== "courant") continue;
    if (CATEGORIES_INTERNES.includes(o.categorie) || estCarte(o)) continue;
    const m = nombre(o.montant), d = jour(o.date);
    if (m == null || m >= 0 || !d) continue;
    const ts = jetons(o.libelle), montant = -m;
    const memeMontant = (v: { montant: number; debut: string | null }) => Math.abs(v.montant - montant) <= VERSEMENT_EUROS + 1e-9 && (!v.debut || v.debut <= d);
    const jourOp = Number(d.slice(8, 10)), nbJours = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
    const procheJour = (j: number) => { const x = Math.abs(Math.min(j, nbJours) - jourOp); return Math.min(x, nbJours - x) <= VERSEMENT_JOURS; };
    const libelle = ctx.termes.some((t) => contient(ts, t));
    const programme = (o.categorie == null || o.categorie === "divers") && ctx.versements.some((v) => memeMontant(v) && procheJour(v.jour));
    const versSoi = (MARQUES_VIREMENT_SOI.some((t) => contient(ts, t)) || ((ts.includes("vir") || ts.includes("virement")) && ctx.noms.some((n) => contient(ts, n))))
      && ctx.versements.some(memeMontant);
    if (libelle || programme || versSoi) out[String(o.id)] = "epargne";
  }
  return out;
}

/* ---------- relevés de carte à débit différé (BUD1 § 4.5) ---------- */
/** Types Powens du relevé d'une carte à débit différé débité sur le courant (spec BUD1 § 4.5). */
export const TYPES_RELEVE_CARTE = ["summary_card", "deferred_card"];
/** Suites de mots du libellé nettoyé d'un relevé de carte : « RELEVE CB … », « RELEVE CARTE … ». */
export const MARQUES_RELEVE_CARTE = [["releve", "cb"], ["releve", "carte"], ["releve", "cartes"]];
/** Fenêtre (jours) précédant un premier relevé : un cycle de carte dure un mois au plus. */
export const RELEVE_FENETRE_JOURS = 45;
/** Écart toléré (centimes) entre le montant d'un relevé et la somme des opérations de la carte. */
export const RELEVE_CENTIMES = 100;
/** Relevés de carte identifiés (pur) : opérations de sortie d'un compte courant (non carte) qui ont, sur la même connexion, une carte à débit
    différé dont des opérations les précèdent. Un relevé est identifié si son type Powens est summary_card ou deferred_card, ou si son libellé est
    « RELEVE CB / CARTE » avec un montant égal, à 1 € près, à la somme (nette) des opérations de la carte sur sa période : de l'opération précédente de même
    nature sur ce courant (incluse) au jour du relevé (exclu), à défaut RELEVE_FENETRE_JOURS jours avant. Une carte sans aucune dépense sur la période
    n'identifie rien (le relevé resterait « à classer » plutôt que de faire disparaître une dépense). Renvoie les identifiants identifiés avec le début de leur
    période (AAAA-MM-JJ) : banque_recalculer_mois compte alors les opérations de la carte, à partir de ce début. */
export function detecterReleves(operations: any[], comptes: any[]): Map<string, string> {
  const out = new Map<string, string>();
  const actifs = (comptes ?? []).filter((k) => k && k.id != null && k.ignore !== true && k.doublon_de == null);
  const parConnexion = new Map<string, { cartes: Set<string>; courants: Set<string> }>();
  for (const k of actifs) {
    const cx = String(k.connexion_id ?? "");
    if (!parConnexion.has(cx)) parConnexion.set(cx, { cartes: new Set(), courants: new Set() });
    const g = parConnexion.get(cx)!;
    if (k.debit_differe === true) g.cartes.add(String(k.id));
    else if (k.type === "courant") g.courants.add(String(k.id));
  }
  const ops = (operations ?? []).filter((o) => o && o.id != null && jour(o.date) && centimes(o.montant) != null);
  for (const { cartes, courants } of parConnexion.values()) {
    if (!cartes.size || !courants.size) continue;
    const depenses = ops.filter((o) => cartes.has(String(o.compte_id)));
    for (const courant of courants) {
      const candidats = ops.filter((o) => String(o.compte_id) === courant && centimes(o.montant)! < 0
        && (TYPES_RELEVE_CARTE.includes(typePowens(o)) || MARQUES_RELEVE_CARTE.some((m) => contient(jetons(o.libelle), m))))
        .sort((a, b) => (jour(a.date)! < jour(b.date)! ? -1 : jour(a.date)! > jour(b.date)! ? 1 : compareIds(a.id, b.id)));
      candidats.forEach((r, i) => {
        const fin = jour(r.date)!, debut = i > 0 ? jour(candidats[i - 1].date)! : moinsJours(fin, RELEVE_FENETRE_JOURS);
        const somme = depenses.filter((o) => jour(o.date)! >= debut && jour(o.date)! < fin).reduce((t, o) => t - centimes(o.montant)!, 0);
        if (somme <= 0) return;
        const explicite = TYPES_RELEVE_CARTE.includes(typePowens(r));
        if (explicite || Math.abs(-centimes(r.montant)! - somme) <= RELEVE_CENTIMES) out.set(String(r.id), debut);
      });
    }
  }
  return out;
}

const memeId = (a: unknown, b: unknown) => (a == null || a === "" ? null : Number(a)) === (b == null || b === "" ? null : Number(b));
/** Contexte du classement des opérations (BUD1) : règles actives de budget_regles, code Powens brut de chaque opération de ce passage (identifiant →
    { code, parent_code } ; il n'est pas gardé en base), date du jour (revenus détectés) et noms du foyer. */
export type ContexteClassement = { regles?: any[]; codes?: Record<string, any>; aujourdhui?: string | null; noms?: string[][] };
/** Colonnes de banque_operations écrites par le classement (migration 0035). */
const CHAMPS_CLASSEMENT = ["sous_categorie", "origine_categorie", "regle_id", "cle_marchand"];
/** Classe une opération (pur) : BudgetCategories.classer, avec deux replis quand le code Powens brut n'est pas là (opération déjà en base, relue par
    `reclasser`) : la sous-catégorie retenue la fois d'avant si elle venait de Powens, puis, faute de mieux, la sous-catégorie par défaut de la catégorie
    large de Powens (reprise de banque_mois). Le code brut est relu à la prochaine synchronisation. */
function classerOperation(o: any, structure: string | undefined, revenu: boolean, regles: any[], code: unknown, precedente: any) {
  const entree = { libelle: o.libelle, montant: o.montant, compte_id: o.compte_id, categorie_powens: code ?? null, structure, revenu_detecte: revenu };
  let r = BudgetCategories.classer(entree, { regles });
  if (!structure && !code) {
    const rendre = (sous: string) => ({ sous_categorie: sous, categorie: BudgetCategories.largeDe(sous), origine: "powens", cle_marchand: r.cle_marchand });
    const memoire = precedente?.origine_categorie === "powens" && BudgetCategories.estSousCategorie(precedente.sous_categorie) ? precedente.sous_categorie : null;
    if (memoire && ["motif", "revenu", "defaut"].includes(r.origine)) r = rendre(memoire);
    else if (r.origine === "defaut") {
      const base = categorieDeBase(o);
      const par_defaut = base !== "divers" && base !== VIREMENT_INTERNE ? BudgetCategories.parDefautDe(base) : "a_classer";
      if (par_defaut !== "a_classer") r = rendre(par_defaut);
    }
  }
  return r;
}
/** Opérations d'une synchronisation fusionnées avec celles déjà en base (90 jours, toutes connexions), puis rapprochement recalculé
    de zéro (pur, idempotent) : chaque opération repart de sa catégorie Powens (categorieDeBase), puis virements internes
    (rapprocherVirements, avec leur contrepartie), versements vers les placements sans contrepartie (epargneSansContrepartie) et relevés de carte
    (detecterReleves), enfin le classement du budget (BUD1 : sous-catégorie, origine, règle, clé de marchand ; la catégorie large est celle de la
    sous-catégorie).
    Un appariement qui n'est plus trouvé (contrepartie retirée ou purgée, règle plus stricte) est donc défait : catégorie Powens
    rendue, contrepartie effacée.
    Renvoie les opérations à écrire (catégorie finale, catégorie Powens, contrepartie, classement), les opérations déjà en base hors de ce
    passage dont la catégorie ou la contrepartie change (groupes { categorie, contrepartie_id, ids }) et la plus ancienne de leurs
    dates, l'ensemble fusionné (catégories finales), le nombre de virements rapprochés qui changent quelque chose et le nombre de
    versements classés en épargne sans contrepartie. BUD1 : `reclasses` (opérations déjà en base dont la catégorie, la contrepartie ou l'une des
    colonnes du classement change, lignes complètes sans user_id) et `depuisClassement` (le plus ancien jour à recalculer pour elles, et pour les cartes
    dont un relevé vient d'être identifié ou ne l'est plus). */
export function preparerOperations(planOps: any[], supprimees: unknown[], existantes: any[], comptes: any[], ctx?: ContexteEpargne | null, cl: ContexteClassement = {}) {
  const ex = new Map((existantes ?? []).filter((o) => o && o.id != null).map((o) => [String(o.id), o]));
  const ecrites = (planOps ?? []).map((o) => ({ ...o, categorie_powens: texte(o.categorie_powens) ?? categorieDeBase(o) }));
  const vus = new Set(ecrites.map((o) => String(o.id))), retirees = new Set((supprimees ?? []).map(String));
  const fusion = [...[...ex.values()].filter((o) => !vus.has(String(o.id)) && !retirees.has(String(o.id))), ...ecrites]
    .map((o) => ({ ...o, categorie: categorieDeBase(o) }));
  const { categories: virements, contreparties, paires, structures } = rapprocherVirements(fusion, comptes);
  const apparies = new Set(paires.flat().map(String));
  const epargne = epargneSansContrepartie(fusion, comptes, ctx, apparies);
  const releves = detecterReleves(fusion, comptes);
  for (const id of [...releves.keys()]) if (apparies.has(id) || epargne[id]) releves.delete(id);
  const finale = (o: any) => ({ ...o, categorie: virements[String(o.id)] ?? epargne[String(o.id)] ?? o.categorie, contrepartie_id: contreparties[String(o.id)] ?? null });
  const avant = fusion.map(finale);
  // revenu détecté (salaire stable) : ses opérations passent en « salaires » si rien de plus précis ne les reconnaît
  const det = cl.aujourdhui ? revenusDetectes(avant, comptes, cl.aujourdhui, { noms: cl.noms ?? [] }) : null;
  const parCompte = new Map((comptes ?? []).filter((k) => k && k.id != null).map((k) => [String(k.id), k]));
  const regles = Array.isArray(cl.regles) ? cl.regles : [];
  const classee = (o: any) => {
    const id = String(o.id), k = parCompte.get(String(o.compte_id));
    const structure = structures[id] ?? (epargne[id] ? "investissement" : releves.has(id) ? "releve_carte" : undefined);
    const revenu = !!det && (nombre(o.montant) ?? 0) > 0 && k?.type === "courant" && k?.debit_differe !== true && !estCompteCommun(k)
      && !CATEGORIES_INTERNES.includes(o.categorie) && o.contrepartie_id == null && cleLibelle(o.libelle) === det.cle;
    const c = classerOperation(o, structure, revenu, regles, cl.codes?.[id] ?? null, ex.get(id));
    return { ...o, categorie: c.categorie, sous_categorie: c.sous_categorie, origine_categorie: c.origine, regle_id: c.regle_id ?? null, cle_marchand: c.cle_marchand || null };
  };
  const change = (o: any) => { const avant = ex.get(String(o.id)); return !avant || (avant.categorie ?? null) !== o.categorie || !memeId(avant.contrepartie_id, o.contrepartie_id); };
  const toutes = avant.map(classee), parId = new Map(toutes.map((o) => [String(o.id), o]));
  const groupes = new Map<string, { categorie: string; contrepartie_id: number | null; ids: number[] }>();
  let depuis: string | null = null;
  for (const o of toutes) {
    if (vus.has(String(o.id)) || !change(o)) continue;
    const k = o.categorie + "|" + (o.contrepartie_id ?? "");
    if (!groupes.has(k)) groupes.set(k, { categorie: o.categorie, contrepartie_id: o.contrepartie_id, ids: [] });
    groupes.get(k)!.ids.push(Number(o.id));
    const d = jour(o.date)!;
    if (!depuis || d < depuis) depuis = d;
  }
  // BUD1 : opérations déjà en base dont le classement change, et mois à recalculer pour elles (et pour les cartes dont le relevé change d'état)
  const reclasses: any[] = [];
  let depuisClassement: string | null = null;
  const reculer = (d: string | null) => { if (d && (!depuisClassement || d < depuisClassement)) depuisClassement = d; };
  for (const o of toutes) {
    const avantO = ex.get(String(o.id));
    const etaitReleve = avantO?.sous_categorie === "releve_carte", estReleve = o.sous_categorie === "releve_carte";
    if (etaitReleve !== estReleve) reculer(estReleve ? releves.get(String(o.id)) ?? null : moinsJours(jour(o.date)!, RELEVE_FENETRE_JOURS));
    if (vus.has(String(o.id))) continue;
    const different = !avantO || (avantO.categorie ?? null) !== o.categorie || !memeId(avantO.contrepartie_id, o.contrepartie_id)
      || CHAMPS_CLASSEMENT.some((c) => (avantO[c] ?? null) !== (o[c] ?? null));
    if (!different) continue;
    reclasses.push({ id: o.id, compte_id: o.compte_id, date: o.date, montant: o.montant, libelle: o.libelle, categorie: o.categorie, categorie_powens: o.categorie_powens ?? null,
      contrepartie_id: o.contrepartie_id ?? null, type_powens: o.type_powens ?? null, sous_categorie: o.sous_categorie, origine_categorie: o.origine_categorie,
      regle_id: o.regle_id ?? null, cle_marchand: o.cle_marchand ?? null });
    reculer(jour(o.date));
  }
  return {
    operations: ecrites.map((o) => parId.get(String(o.id))!), autres: [...groupes.values()], depuis, toutes, reclasses, depuisClassement,
    releves: [...releves.keys()],
    virements: paires.filter(([d, e]) => change(parId.get(String(d))) || change(parId.get(String(e)))).length, epargne: Object.keys(epargne).length,
  };
}

/** Compte de titulaire commun (I6) : titulaire « commun » (CP2), drapeau commun (ligne rattachée commune, posé par la
    synchronisation), ou nom contenant « joint » ou « commun ». Ses entrées ne sont jamais prises pour le salaire d'une personne. */
export function estCompteCommun(k: any): boolean {
  if (!k) return false;
  if (k.commun === true || k.titulaire === "commun") return true;
  const ts = mots(k.nom);
  return ts.includes("joint") || ts.includes("commun") || ts.includes("communs");
}
/** Revenus détectés (pur) : entrées des comptes courants suivis, hors comptes communs (estCompteCommun), hors épargne et virements
    internes (et toute opération appariée), hors virements reçus d'une personne du foyer (« VIR » + nom de `opts.noms`), groupées
    par libellé nettoyé (cleLibelle : sans noms de mois) et par mois sur les REVENU_MOIS derniers mois complets ; un groupe présent
    au moins REVENU_MOIS_MIN mois, dont chaque total mensuel reste à ±REVENU_STABILITE de la moyenne et dont la moyenne atteint
    REVENU_MIN €, est un salaire probable. Le plus élevé est retenu : { cle, moyenne, mois: [{ mois, montant }] } ; null sinon. */
export function revenusDetectes(operations: any[], comptes: any[], aujourdhui: string, opts: { noms?: string[][] } = {}) {
  const suivis = comptesSuivis(comptes);
  const mois = Array.from({ length: REVENU_MOIS }, (_, i) => moisDecale(aujourdhui, i - REVENU_MOIS));
  const groupes = new Map<string, Map<string, number>>();
  const noms = opts.noms ?? [];
  for (const o of operations ?? []) {
    const k0 = suivis.get(String(o?.compte_id));
    if (!o || k0?.type !== "courant" || estCompteCommun(k0) || CATEGORIES_INTERNES.includes(o.categorie) || o.contrepartie_id != null) continue;
    const m = nombre(o.montant), d = jour(o.date), k = cleLibelle(o.libelle), ts = k.split(" ");
    if (m == null || m <= 0 || !d || !k || !mois.includes(premierDuMois(d))) continue;
    if (MARQUES_VIREMENT.some((v) => contient(ts, v)) && noms.some((n) => contient(ts, n))) continue;
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
/** Personne concernée par une détection (pur, I6) : la moyenne est comparée au salaire net mensuel de p1 et, dans un foyer de deux
    personnes (foyer.adultes ≥ 2, à défaut une personne 2 renseignée), de p2. À REVENU_ECART près du salaire d'une personne : rien
    à proposer (null). Sinon la personne la plus proche (écart relatif), si l'autre est nettement plus loin (au moins REVENU_ECART
    de plus) ; ambigu (null) si les deux écarts sont proches ou si l'une des deux personnes n'a pas de salaire. Foyer d'une
    personne : p1. → { personne, actuel } ou null. */
export function personneRevenus(moyenne: number, profil: any): { personne: "p1" | "p2"; actuel: number } | null {
  const ps = profil?.personnes ?? {}, adultes = profil?.foyer?.adultes;
  const p2 = ps.p2 && typeof ps.p2 === "object" && Object.keys(ps.p2).length > 0;
  const deux = adultes != null && adultes !== "" ? Number(adultes) >= 2 : !!p2;
  const cles: ("p1" | "p2")[] = deux ? ["p1", "p2"] : ["p1"];
  const ecarts = cles.map((k) => { const actuel = salaireNetMensuel(ps[k]); return { personne: k, actuel, ecart: actuel > 0 ? Math.abs(moyenne - actuel) / actuel : Infinity }; });
  if (ecarts.some((x) => x.ecart <= REVENU_ECART)) return null;
  if (!deux) return { personne: "p1", actuel: ecarts[0].actuel };
  if (ecarts.some((x) => x.actuel <= 0)) return null;
  const [a, b] = [...ecarts].sort((x, y) => x.ecart - y.ecart);
  return b.ecart - a.ecart >= REVENU_ECART ? { personne: a.personne, actuel: a.actuel } : null;
}
/** Proposition profil (pur) : salaire net mensuel de la personne concernée (personneRevenus) = moyenne détectée, arrondie à
    l'euro ; null s'il n'y a rien à proposer ou si la personne est ambiguë. L'unité passe à « nm » (net mensuel) si le profil en
    déclarait une autre. Jamais appliquée par la synchronisation : l'utilisateur la valide dans Boussole. La justification donne
    les mois et les montants, jamais le libellé bancaire. */
export function propositionRevenus(det: any, profil: any, ids: { userId: string; id: string; lot: string }) {
  if (!det || !(Number(det.moyenne) > 0)) return null;
  const moyenne = Number(det.moyenne), nouveau = Math.round(moyenne);
  const qui = personneRevenus(moyenne, profil);
  if (!qui) return null;
  const k = qui.personne, p = profil?.personnes?.[k] ?? {}, actuel = qui.actuel;
  // unité absente : net mensuel par défaut (calc.js), sauf profil sans salaire où elle est posée explicitement
  const changeUnite = p.salaireUnite != null ? p.salaireUnite !== "nm" : p.salaire == null;
  const avant = { salaire: p.salaire ?? null, ...(changeUnite ? { salaireUnite: p.salaireUnite ?? null } : {}) };
  const apres = { salaire: nouveau, ...(changeUnite ? { salaireUnite: "nm" } : {}) };
  const detail = (det.mois ?? []).map((m: any) => `${MOIS_FR[Number(String(m.mois).slice(5, 7)) - 1]} ${String(m.mois).slice(0, 4)} : ${euros(Number(m.montant))}`).join(" ; ");
  const prenom = String(p.prenom ?? p.nom ?? "").trim();
  const nomDe = prenom && !NOMS_PAR_DEFAUT.has(plat(prenom)) ? prenom : "la personne 2";
  const de = k === "p1" ? "ton salaire" : `le salaire de ${nomDe}`;
  const profilDe = k === "p1" ? "ton profil" : `ton profil pour ${nomDe}`;
  const compare = actuel > 0
    ? `contre ${euros(Math.round(actuel), 0)} net par mois dans ${profilDe} (écart ${moyenne >= actuel ? "+" : "-"}${Math.round((Math.abs(moyenne - actuel) / actuel) * 100)} %)`
    : `alors que ${profilDe} n'indique aucun salaire`;
  return {
    id: ids.id, user_id: ids.userId, lot: ids.lot, cible: "profil", operation: "modifier",
    avant: { personnes: { [k]: avant } }, apres: { personnes: { [k]: apres } }, source: SOURCE_REVENUS,
    justification: (`Entrée récurrente sur ton compte courant, probablement ${de} : ${detail}. Moyenne : ${euros(nouveau, 0)} net par mois, ${compare}. `
      + "Rien n'est modifié sans ta validation.").slice(0, 1000),
  };
}

/* ---------- plan ---------- */
type LectureCompte = { compte: any; placements: any[] | null; operations: any[] | null; erreur?: string };
/** État local : comptes (rattachements, ignore, propose_le), placements (liens, ligne_creee_le ; tous ceux de l'utilisateur),
    lots des propositions déjà déposées, comptes à rattacher à la ligne créée par une proposition acceptée (id du compte → id de
    la ligne), et lignes de l'utilisateur candidates à l'adoption (id, user_id, name, envelope, owner, mode, isin, qty, status). */
export type Etat = { comptes: any[]; placements: any[]; lotsExistants: string[]; acceptes?: Record<string, string>; lignes?: any[];
  /** config.prets_infos de l'utilisateur ; absent ou null (illisible) : aucune proposition de prêt. */
  pretsInfos?: Record<string, unknown> | null };
export type Donnees = {
  userId: string; connexion: any; comptes: LectureCompte[]; lectureComptesOk: boolean; maintenant: string; aujourdhui: string;
  minDate: string; lots: Record<string, string>; idsPropositions?: Record<string, string>; idsLignes?: Record<string, string>;
  idsLiquidites?: Record<string, string>; erreurComptes?: string; idsPrets?: Record<string, { id: string; lot: string }>;
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
    // code Powens brut (ni gardé en base, ni écrit : lu par le classement du budget) de chaque opération de ce passage : identifiant → { code, parent_code? }
    codesPowens: {} as Record<string, { code: string; parent_code?: string }>,
    rattachements: [] as { id: number; position_id: string }[], comptesProposes: [] as number[], propositionsPrets: [] as { compte: number; proposition: any }[],
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
    // Prêt (DAT1) : seulement pour un compte de crédit ; la date d'ouverture n'est documentée que pour lui (loan.subscription_date).
    const pret = type === "credit" ? pretDe(c) : null;
    plan.comptes.push({
      user_id, id, connexion_id: Number(d.connexion.id), nom, type, debit_differe: String(c.type ?? "").toLowerCase() === "card", solde,
      devise: texte(c.currency?.id) ?? texte(c.currency) ?? "EUR", solde_le: jour(c.last_update) ?? aujourdhui, actif, maj_le: maintenant,
      ouverture_le: pret?.subscription_date ?? null, pret,
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
        const crd = capitalRestantDu(c) ?? solde;
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

    // Prêt transmis par la banque (DAT1, spec § 7) : une seule proposition config/prets_infos par compte de crédit rattaché à un
    // crédit, jamais si l'information existe déjà (clé présente), si elle a déjà été proposée (infos_proposees_le), pour un compte
    // inactif, ignoré ou en double, ni quand config.prets_infos est illisible. Une erreur ici n'arrête pas les autres comptes.
    try {
      const infos = actif && !ignore && creditId && !r.infos_proposees_le && rp?.doublon_de == null && etat.pretsInfos && pret
        ? infosPret(pret, aujourdhui) : null;
      const cle = creditId ? `credit:${creditId}` : "";
      const ids = d.idsPrets?.[String(id)];
      if (infos && ids && !Object.prototype.hasOwnProperty.call(etat.pretsInfos, cle)) {
        const origine = `Powens — ${etablissement ?? "connexion bancaire"}`;
        plan.propositionsPrets.push({ compte: id, proposition: {
          id: ids.id, user_id, lot: ids.lot, cible: "config", operation: "modifier",
          apres: { prets_infos: { [cle]: { ...infos, source: `${origine} : données du prêt transmises par la banque`.slice(0, 300), le: aujourdhui } } },
          source: origine.slice(0, 500),
          justification: "Ta banque transmet les données de ce prêt (date de souscription, fin, durée, assurance) : les voici pour le calendrier. Rien n'est modifié sans ta validation.",
        } });
      }
    } catch (e) {
      plan.erreurs.push({ compte_id: id, erreur: `prêt : ${e instanceof Error ? e.message : String(e)}` });
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
        const categorie = categorieBoussole(o.categories);
        plan.operations.push({
          user_id, id: Number(o.id), compte_id: id, date, montant,
          libelle: nettoyerLibelle(o.simplified_wording ?? o.wording ?? o.original_wording), categorie,
          // migration 0025 : catégorie Powens gardée (restaurée si un rapprochement est défait), trace de l'appariement (posée par
          // preparerOperations), type Powens (indice d'un virement ou d'un paiement par carte)
          categorie_powens: categorie, contrepartie_id: null, type_powens: texte(o.type)?.toLowerCase().slice(0, 40) ?? null,
        });
        const code = codePowens(o.categories);
        if (code) plan.codesPowens[String(Number(o.id))] = code;
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

/** Code Powens d'une opération (premier élément du tableau `categories`, ou un code seul) : { code, parent_code? }, null s'il n'y en a pas. */
export function codePowens(v: unknown): { code: string; parent_code?: string } | null {
  const c: any = Array.isArray(v) ? v[0] : v;
  if (typeof c === "string") return c.trim() ? { code: c.trim() } : null;
  if (c && typeof c === "object" && typeof c.code === "string" && c.code.trim()) {
    return { code: c.code.trim(), ...(typeof c.parent_code === "string" && c.parent_code.trim() ? { parent_code: c.parent_code.trim() } : {}) };
  }
  return null;
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
    virements_internes: 0, versements_epargne: 0, operations_reclassees: 0, revenus_proposes: 0, prets_proposes: 0, erreurs: [] as { compte_id?: number; erreur: string }[], notes: [] as string[] };

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
    tousComptes = await lireTable(db.from("banque_comptes").select("id, connexion_id, nom, actif, type, debit_differe, solde, position_id, enveloppe, titulaire, credit_id, ignore, propose_le, infos_proposees_le, doublon_de, rattache_auto, auto_retire_le")
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
  // Prêts transmis par la banque (DAT1) : config.prets_infos lu seulement s'il y a un prêt à proposer ; illisible → aucune proposition.
  const idsPrets: Record<string, { id: string; lot: string }> = {};
  let pretsInfos: Record<string, unknown> | null = null;
  const comptesPret = lectures.filter((l) => normaliserType(l.compte) === "credit" && pretDe(l.compte));
  if (comptesPret.length) {
    for (const l of comptesPret) idsPrets[String(l.compte.id)] = { id: await idPret(userId, l.compte.id), lot: await lotPret(userId, l.compte.id) };
    try {
      const cf = await db.from("config").select("prets_infos").eq("user_id", userId).maybeSingle();
      if (cf?.error) throw new Error(cf.error.message);
      const v = cf?.data?.prets_infos;
      pretsInfos = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch (e) {
      rapport.notes.push(`informations de prêt illisibles (${msg(e)}) : aucune proposition de prêt`);
    }
  }
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
        crd: capitalRestantDu(l.compte), actif: !l.compte.disabled && !l.compte.deleted,
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
    idsPropositions, idsLignes, idsLiquidites, idsPrets, rapprochement,
  };
  const etatPlan = { comptes: etatComptes, placements, lotsExistants, acceptes, lignes, pretsInfos };
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
  // Opérations : celles des 90 jours déjà en base (toutes connexions) sont relues d'abord : le rapprochement (virements internes,
  // épargne sans contrepartie) est recalculé sur tous les comptes à partir des catégories Powens, et seules les différences sont écrites.
  // Lecture en échec : aucune opération écrite (nouvel essai au prochain passage), les retraits et le recalcul restent faits.
  let existantes: any[] | null = null;
  try {
    existantes = await lireOperations(db, userId, minDate);
  } catch (e) {
    rapport.erreurs.push({ erreur: `${msg(e)} ; opérations non écrites, nouvel essai au prochain passage` });
  }
  let moisDepuis = plan.moisDepuis;
  const comptesFusion = fusionComptes(tousComptes, plan.comptes, lignes);
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
  // Règles de classement actives (BUD1) : sans elles, le classement défairait ce qu'elles ont décidé ; lecture en échec → opérations non écrites.
  let regles: any[] = [];
  if (existantes) {
    try {
      regles = await lireRegles(db, userId);
    } catch (e) {
      rapport.erreurs.push({ erreur: `${msg(e)} ; opérations non écrites, nouvel essai au prochain passage` });
      existantes = null;
    }
  }
  for (const k of comptesFusion) {
    if (Number(k.connexion_id) === Number(connexionId) && suggestionTitulaireCommun(k)) {
      rapport.notes.push(`compte ${k.id} : le nom évoque un compte commun ; choisis le titulaire « Commun » pour qu'il soit compté comme le compte du foyer`);
    }
  }
  let toutes: any[] | null = null;
  if (existantes) {
    const prep = preparerOperations(plan.operations, plan.operationsSupprimer, existantes, comptesFusion, ctxEpargne,
      { regles, codes: plan.codesPowens, aujourdhui, noms: ctxEpargne.noms });
    toutes = prep.toutes;
    for (const paquet of parPaquets(prep.operations)) {
      if (await etape("opérations", () => db.from("banque_operations").upsert(paquet, { onConflict: "user_id,id" }))) rapport.operations += paquet.length;
    }
    // Autres opérations dont la catégorie, la contrepartie ou le classement du budget change (virement rapproché ou défait sur un autre compte,
    // versement d'épargne, règle, relevé de carte) : lignes complètes réécrites, mois recalculés.
    for (const paquet of parPaquets(prep.reclasses.map((o: any) => ({ user_id: userId, ...o })))) {
      if (await etape("classement des opérations", () => db.from("banque_operations").upsert(paquet, { onConflict: "user_id,id" }))) rapport.operations_reclassees += paquet.length;
    }
    rapport.virements_internes = prep.virements;
    rapport.versements_epargne = prep.epargne;
    for (const d of [prep.depuis, prep.depuisClassement]) {
      if (!d) continue;
      const m = premierDuMois(d);
      if (!moisDepuis || m < moisDepuis) moisDepuis = m;
    }
  }
  if (plan.operationsSupprimer.length) {
    await etape("opérations retirées", () => db.from("banque_operations").delete().eq("user_id", userId).in("id", plan.operationsSupprimer));
  }
  if (moisDepuis) {
    await etape("totaux mensuels", () => db.rpc("banque_recalculer_mois", { p_user: userId, p_depuis: moisDepuis }));
  }
  // Revenus détectés : proposition profil (salaire net mensuel de la personne la plus proche, p1 ou p2), jamais appliquée ici.
  if (toutes) await proposerRevenus(db, userId, toutes, comptesFusion, aujourdhui, profil, rapport, etape, ctxEpargne.noms);
  if (plan.propositions.length && await etape("propositions",
    () => db.from("propositions").upsert(plan.propositions, { onConflict: "id", ignoreDuplicates: true }))) {
    rapport.propositions = plan.propositions.length;
    await etape("trace des propositions", () => db.from("banque_comptes").update({ propose_le: maintenant.toISOString() })
      .eq("user_id", userId).in("id", plan.comptesProposes));
  }
  // Prêts : une proposition par compte, déposée puis tracée compte par compte (une erreur n'arrête pas les autres).
  for (const p of plan.propositionsPrets) {
    if (!await etape("proposition de prêt", () => db.from("propositions").upsert(p.proposition, { onConflict: "id", ignoreDuplicates: true }))) continue;
    rapport.prets_proposes++;
    await etape("trace de la proposition de prêt", () => db.from("banque_comptes").update({ infos_proposees_le: maintenant.toISOString() })
      .eq("user_id", userId).eq("id", p.compte).is("infos_proposees_le", null));
  }
}

/** Opérations de l'utilisateur depuis `depuis` (toutes connexions), par pages de 1000 au plus, dans l'ordre des identifiants
    (entiers Powens) : page suivante = identifiants au-delà du dernier lu, jusqu'à une page vide (l'API de données peut plafonner
    une requête sous la limite demandée : une page courte ne veut pas dire la dernière). Lève en cas d'échec. */
async function lireOperations(db: any, userId: string, depuis: string): Promise<any[]> {
  const PAGE = 1000, tout: any[] = [];
  for (let apres: number | null = null; ;) {
    let q = db.from("banque_operations").select("id, compte_id, date, montant, libelle, categorie, categorie_powens, contrepartie_id, type_powens, sous_categorie, origine_categorie, regle_id, cle_marchand")
      .eq("user_id", userId).gte("date", depuis);
    if (apres != null) q = q.gte("id", apres + 1);
    const { data, error } = await q.order("id").limit(PAGE);
    if (error) throw new Error(`lecture des opérations : ${error.message}`);
    const l = data ?? [];
    if (!l.length) return tout;
    tout.push(...l);
    const dernier = Math.max(...l.map((o: any) => Number(o.id)));
    if (!Number.isSafeInteger(dernier) || (apres != null && dernier < apres + 1)) return tout;
    apres = dernier;
  }
}
/** Règles de classement actives de l'utilisateur (budget_regles, 300 au plus), de la plus ancienne à la plus récente. Lève en cas d'échec. */
async function lireRegles(db: any, userId: string): Promise<any[]> {
  const { data, error } = await db.from("budget_regles").select("id, motif, sous_categorie, sens, compte_id, montant_min, montant_max, annuelle, active, cree_le")
    .eq("user_id", userId).eq("active", true).order("cree_le").limit(300);
  if (error) throw new Error(`lecture des règles de classement : ${error.message}`);
  return data ?? [];
}
/** Comptes vus par le rapprochement des virements et les revenus détectés : ceux en base (ignore, doublon_de, titulaire,
    rattachement), complétés par ceux de ce passage (nom, type, carte à débit différé, compte en double) ; commun : compte
    rattaché à une ligne de titulaire commun (positions.owner = 'commun'). */
function fusionComptes(enBase: any[], frais: any[], lignes: any[] = []): any[] {
  const parId = new Map((enBase ?? []).map((k) => [String(k.id), { ...k }]));
  for (const c of frais ?? []) {
    const k = parId.get(String(c.id)) ?? { id: c.id, connexion_id: c.connexion_id };
    k.type = c.type; k.debit_differe = c.debit_differe;
    if (c.nom != null) k.nom = c.nom;
    if ("doublon_de" in c) k.doublon_de = c.doublon_de;
    parId.set(String(c.id), k);
  }
  const communes = new Set((lignes ?? []).filter((p) => p && p.owner === "commun").map((p) => String(p.id)));
  for (const k of parId.values()) if (texte(k.position_id) && communes.has(String(k.position_id))) k.commun = true;
  return [...parId.values()];
}
/** Revenus détectés → proposition profil : une par lot (libellé nettoyé, dernier mois complet) ; une détection précédente encore en
    attente est remplacée (jamais deux en attente) ; rien si une proposition de même source a été refusée pour un salaire à 10 %
    près. Ne lève pas (erreurs dans le rapport). */
async function proposerRevenus(db: any, userId: string, toutes: any[], comptes: any[], aujourdhui: string, profil: any, rapport: any,
  etape: (quoi: string, f: () => Promise<any>) => Promise<boolean>, noms: string[][] = []) {
  const det = revenusDetectes(toutes, comptes, aujourdhui, { noms });
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
  const [k, apres] = Object.entries(prop.apres.personnes)[0] as [string, any];
  const salaire = apres.salaire;
  const refuse = (p: any) => {
    const s = Number(p?.apres?.personnes?.[k]?.salaire);
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

/* ---------- reclassement après une règle (BUD1, POST /powens/reclasser) ---------- */
/** Sous-catégories posées par le rapprochement : un total par marchand qui les porte ne se reclasse pas (la structure ne se relit pas d'une clé). */
const SOUS_CATEGORIES_STRUCTURE = ["virement_interne", "epargne_precaution", "investissement", "apport_commun", "transfert_foyer", "releve_carte"];
/** Mois (AAAA-MM-JJ, premiers du mois) que banque_recalculer_mois peut recalculer : de celui où commencent 90 jours entièrement couverts au mois courant. */
export function moisRecalculables(aujourdhui: string): string[] {
  const borne = moinsJours(aujourdhui, JOURS_DETAIL);
  const premier = borne === premierDuMois(borne) ? borne : moisDecale(borne, 1);
  const out: string[] = [];
  for (let m = premier; m <= premierDuMois(aujourdhui); m = moisDecale(m, 1)) out.push(m);
  return out;
}
/** Nouvelle sous-catégorie d'un total par marchand (pur) : le classement de sa clé nettoyée, sans le code Powens ni la structure, que le total ne garde pas. Une
    règle ou une entrée de la table des marchands l'emporte ; un motif générique ne remplace qu'un « à classer » ; rien de reconnu : la sous-catégorie
    reste. Les règles à bornes de montant ne sont pas appliquées (le total mélange plusieurs montants). */
export function reclasserTotalMarchand(ligne: any, regles: any[]): string {
  const sous = String(ligne?.sous_categorie ?? "");
  if (SOUS_CATEGORIES_STRUCTURE.includes(sous)) return sous;
  const e = nombre(ligne.entrees) ?? 0, so = nombre(ligne.sorties) ?? 0;
  const montant = e - so !== 0 ? e - so : so ? -so : e || -0.01;
  const sansBornes = (Array.isArray(regles) ? regles : []).filter((r) => r && r.montant_min == null && r.montant_max == null);
  const r = BudgetCategories.classer({ libelle: String(ligne.cle_marchand ?? ""), montant, compte_id: ligne.compte_id }, { regles: sansBornes });
  if (r.origine === "regle" || r.origine === "marchand") return r.sous_categorie;
  if (r.origine === "motif" && sous === "a_classer") return r.sous_categorie;
  return sous;
}
/** Reclasse l'utilisateur après un changement de règle : les opérations des 90 derniers jours (lignes réécrites, mois recalculés), puis, de 90 jours à
    13 mois, les totaux par marchand (déplacés par budget_marchands_reclasser) et banque_mois (reconstruit par budget_reclasser_historique, seulement
    si les sommes retombent à 1 € près). Idempotent. Ne lève pas : les échecs sont dans `erreurs`.
    → { operations_reclassees, mois_recalcules: [AAAA-MM], mois_figes: [AAAA-MM], erreurs } ; les mois de plus de 13 mois restent figés. */
export async function reclasser(db: any, userId: string, opts: { maintenant?: Date } = {}) {
  const maintenant = opts.maintenant ?? new Date();
  const aujourdhui = dateParis(maintenant), minDate = moinsJours(aujourdhui, JOURS_DETAIL);
  const rapport = { operations_reclassees: 0, mois_recalcules: [] as string[], mois_figes: [] as string[], erreurs: [] as string[] };
  const lire = async (q: any, quoi: string) => {
    const { data, error } = await q;
    if (error) throw new Error(`lecture ${quoi} : ${error.message}`);
    return data ?? [];
  };
  let comptes: any[], lignes: any[], connexions: any[], existantes: any[], regles: any[];
  let profil: any = null, recurring: any[] = [];
  try {
    comptes = await lire(db.from("banque_comptes").select("id, connexion_id, nom, actif, type, debit_differe, titulaire, position_id, ignore, doublon_de").eq("user_id", userId), "des comptes");
    lignes = await lire(db.from("positions").select("id, user_id, name, envelope, owner, bloc, mode, isin, qty, value, status").eq("user_id", userId), "des lignes");
    connexions = await lire(db.from("banque_connexions").select("id, etablissement").eq("user_id", userId), "des connexions");
    regles = await lireRegles(db, userId);
    existantes = await lireOperations(db, userId, minDate);
  } catch (e) {
    rapport.erreurs.push(`${msg(e)} ; rien n'a été reclassé`);
    return rapport;
  }
  try {
    const pr = await db.from("profiles").select("personnes").eq("user_id", userId).maybeSingle();
    profil = pr?.data ?? null;
    const cf = await db.from("config").select("recurring").eq("user_id", userId).maybeSingle();
    recurring = Array.isArray(cf?.data?.recurring) ? cf.data.recurring : [];
  } catch (e) {
    rapport.erreurs.push(`profil et versements programmés illisibles (${msg(e)}) : épargne repérée par le libellé seulement`);
  }
  const comptesFusion = fusionComptes(comptes, [], lignes);
  const ctx = contexteEpargne({ lignes, comptes: comptesFusion, recurring, personnes: profil?.personnes, connexions });
  const prep = preparerOperations([], [], existantes, comptesFusion, ctx, { regles, codes: {}, aujourdhui, noms: ctx.noms });
  for (const paquet of parPaquets(prep.reclasses.map((o: any) => ({ user_id: userId, ...o })))) {
    const r = await db.from("banque_operations").upsert(paquet, { onConflict: "user_id,id" });
    if (r?.error) rapport.erreurs.push(`classement des opérations : ${r.error.message}`);
    else rapport.operations_reclassees += paquet.length;
  }
  const mois = new Set<string>();
  const depuis = [prep.depuis, prep.depuisClassement].filter(Boolean).sort()[0] ?? null;
  const recalculables = moisRecalculables(aujourdhui);
  if (depuis) {
    const r = await db.rpc("banque_recalculer_mois", { p_user: userId, p_depuis: premierDuMois(depuis) });
    if (r?.error) rapport.erreurs.push(`totaux mensuels : ${r.error.message}`);
    else for (const m of recalculables) if (m >= premierDuMois(depuis)) mois.add(m.slice(0, 7));
  }
  // De 90 jours à 13 mois : totaux par marchand reclassés, puis banque_mois reconstruit (les sommes doivent retomber à 1 € près).
  try {
    const debut13 = moisDecale(premierDuMois(aujourdhui), -13);
    const agregats = await lire(db.from("banque_marchands_mois").select("mois, compte_id, cle_marchand, sous_categorie, entrees, sorties, nombre")
      .eq("user_id", userId).gte("mois", debut13).lt("mois", recalculables[0] ?? premierDuMois(aujourdhui)), "des totaux par marchand");
    const changements = agregats.map((a: any) => ({ mois: jour(a.mois), compte_id: Number(a.compte_id), cle_marchand: String(a.cle_marchand ?? ""), de: String(a.sous_categorie),
      vers: reclasserTotalMarchand(a, regles) })).filter((c: any) => c.mois && c.de !== c.vers);
    for (const paquet of parPaquets(changements, 2000)) {
      const r = await db.rpc("budget_marchands_reclasser", { p_user: userId, p_changes: paquet });
      if (r?.error) throw new Error(`reclassement des totaux par marchand : ${r.error.message}`);
    }
    const h = await db.rpc("budget_reclasser_historique", { p_user: userId });
    if (h?.error) throw new Error(`reconstruction des mois : ${h.error.message}`);
    for (const m of h?.data?.reconstruits ?? []) mois.add(String(m));
    rapport.mois_figes = [...(h?.data?.figes ?? [])].map(String).sort();
  } catch (e) {
    rapport.erreurs.push(msg(e));
  }
  rapport.mois_recalcules = [...mois].sort();
  return rapport;
}
