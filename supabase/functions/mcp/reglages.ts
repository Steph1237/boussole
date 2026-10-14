// Réglages par propositions (spec docs/superpowers/specs/2026-10-11-saisie-par-agent.md : l'app est en lecture seule, toute saisie
// passe par l'assistant, les montants par des propositions validées dans Boussole › Agent › Propositions). Quatre outils
// d'écriture, qui déposent des propositions (source obligatoire, comme set_protection) et n'écrivent rien directement :
//   regler_matelas    → cible config, apres { cushion } : { mode: "amount", min, max } ou { mode: "months", months, depenses }
//                       (forme de Calc.matelas, web/src/calc.js) ;
//   regler_versements → cible config, apres { recurring } : liste complète des versements programmés, appliqués chaque nuit
//                       par apply_recurring (0003) ; champs inconnus d'un versement existant conservés ; lastApplied tenu par
//                       la base (jamais proposé) ;
//   corriger_classe   → cible profil, apres { classes: { <poche>: <classe> | null } } (surcharge de profiles.classes) ;
//   regler_frais_enveloppe → cible config, apres { frais_enveloppes: { <enveloppe>: { gestion_uc_pct?, gestion_euro_pct?, garde_pct?,
//                       source, le } } } : frais d'un contrat (assurance-vie, PER, PEA, compte-titres) relevés par Claude dans les
//                       documents du contrat (spec CP4 § 2) ; fusion par enveloppe en base (les autres enveloppes restent).
//   regler_infos_enveloppe → cible config, apres { enveloppes_infos: { <clé d'enveloppe>: { type, titulaire, date_ouverture?, … } } } :
//                       les dates qui font courir les délais fiscaux d'une enveloppe (DAT1, spec § 2.1) ; fusion par clé en base ;
//   regler_infos_pret → apres { prets_infos: { "credit:<id>" | "bien:<id>": { date_signature?, date_fin?, … } } } (DAT1 § 2.2) ;
//   regler_donations  → apres { donations: [...] } : liste complète des donations consenties (DAT1 § 2.3) ;
//   regler_avis_impot → apres { avis_impot: {...} } : plafond épargne retraite non utilisé et revenu fiscal de référence (DAT1 § 2.4).
// Application par public.appliquer_propositions (migrations 0019, 0026, 0027 pour frais_enveloppes ; 0029 pour les quatre clés DAT1),
// qui revalide tout.
// Ce module ne dépend pas d'index.ts : utilitaires (wrap, must, UserError…), champs DEPOT, fonction deposer et dépenses
// mensuelles du budget sont passés en paramètre. Les fonctions de validation sont pures et exportées pour les tests.
import { z } from "zod";

/** Classes d'actifs permises (CLASSES de web/src/marche.js, CLASSES_RISQUE d'index.ts ; liste fermée de la migration 0019). */
export const CLASSES = ["actions", "small_caps", "emergents", "levier", "obligations", "immobilier", "monetaire", "fonds_euros", "or", "crypto", "autres"] as const;
export const LIBELLES_CLASSES: Record<string, string> = {
  actions: "actions (monde développé)", small_caps: "actions de petites entreprises", emergents: "actions émergentes", levier: "produits à effet de levier",
  obligations: "obligations", immobilier: "immobilier", monetaire: "monétaire et livrets", fonds_euros: "fonds euros", or: "or", crypto: "cryptoactifs",
  autres: "autres (non classé)",
};
export const JOUR_MAX = 28;
export const VERSEMENTS_MAX = 50;
export const MOIS_MAX = 120;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const nombre = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const dateReelle = (s: unknown) => typeof s === "string" && DATE_RE.test(s) && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const eur = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(v) + " €";
/** Égalité structurelle, clés dans n'importe quel ordre. */
export function pareil(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => pareil(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => pareil(a[k], b[k]));
  }
  return false;
}

/** Cible du matelas proposée → { cushion } (forme de config.cushion) ou { erreurs }. `depensesBudget` : dépenses mensuelles du budget. */
export function cushionDe(a: { mode?: string; montant?: number; maximum?: number | null; mois?: number; depenses?: number }, depensesBudget = 0):
    { cushion?: Record<string, unknown>; erreurs: string[] } {
  const erreurs: string[] = [];
  if (a.mode === "mois") {
    const mois = nombre(a.mois);
    if (!(mois > 0 && mois <= MOIS_MAX)) erreurs.push(`mois : nombre de mois de dépenses entre 0 et ${MOIS_MAX} (ex. 6).`);
    if (a.montant != null || a.maximum != null) erreurs.push("montant et maximum : seulement en mode montant.");
    const dep = a.depenses != null ? nombre(a.depenses) : depensesBudget;
    if (!(dep > 0)) erreurs.push(a.depenses != null ? "depenses : dépenses mensuelles strictement positives." :
      "depenses : aucune dépense mensuelle dans le budget ; demande à l'utilisateur ses dépenses mensuelles et passe-les dans depenses.");
    return erreurs.length ? { erreurs } : { cushion: { mode: "months", months: mois, depenses: Math.round(dep * 100) / 100 }, erreurs };
  }
  if (a.mode === "montant") {
    const min = nombre(a.montant);
    if (!(min >= 0)) erreurs.push("montant : montant minimum à garder de côté, en euros (0 ou plus).");
    const max = a.maximum == null ? null : nombre(a.maximum);
    if (max != null && !(max >= min)) erreurs.push("maximum : au moins égal au montant minimum (ou absent).");
    if (a.mois != null || a.depenses != null) erreurs.push("mois et depenses : seulement en mode mois.");
    return erreurs.length ? { erreurs } : { cushion: { mode: "amount", min, max }, erreurs };
  }
  return { erreurs: ["mode : montant (somme fixe) ou mois (mois de dépenses)."] };
}

/** Phrase lisible d'une cible de matelas : « 6 mois de dépenses (2 500 €/mois, soit 15 000 €) », « 15 000 € à 20 000 € ». */
export function texteMatelas(c: any): string {
  if (!isObj(c)) return "aucune cible";
  if (c.mode === "months") return `${c.months} mois de dépenses (${eur(+c.depenses)}/mois, soit ${eur(Math.round(+c.months * +c.depenses))})`;
  const min = +c.min || 0, max = c.max == null || c.max === "" ? null : +c.max;
  return max != null && max > 0 ? `${eur(min)} à ${eur(max)}` : `au moins ${eur(min)}`;
}

/** Versements proposés → liste complète normalisée (forme de config.recurring) ou erreurs.
    `existants` : config.recurring actuel ; `positions` : lignes de l'utilisateur { id, name, envelope, status }.
    Un versement dont l'id existe part du versement existant (champs inconnus conservés), complété par les champs fournis ;
    un versement sans id reçoit un identifiant neuf. lastApplied n'est jamais proposé (tenu par l'agent nocturne). */
export function normaliserVersements(liste: any[], existants: any[], positions: any[], nouvelId: () => string):
    { versements: any[]; erreurs: string[]; retires: any[] } {
  const erreurs: string[] = [];
  if (!Array.isArray(liste)) return { versements: [], erreurs: ["versements : liste attendue."], retires: [] };
  if (liste.length > VERSEMENTS_MAX) erreurs.push(`versements : ${VERSEMENTS_MAX} au plus.`);
  const cur = (Array.isArray(existants) ? existants : []).filter(isObj);
  const parId = new Map(cur.filter((r) => r.id != null).map((r) => [String(r.id), r]));
  const lignes = new Map((positions ?? []).map((p: any) => [String(p.id), p]));
  const vus = new Set<string>();
  const versements = liste.map((v: any, i: number) => {
    const n = `versement ${i + 1}`;
    if (!isObj(v)) { erreurs.push(`${n} : objet attendu.`); return null; }
    const id = v.id == null || String(v.id).trim() === "" ? nouvelId() : String(v.id).trim();
    if (id.length > 64) erreurs.push(`${n} : identifiant trop long (64 caractères au plus).`);
    if (vus.has(id)) erreurs.push(`${n} : identifiant « ${id} » en double.`);
    vus.add(id);
    const base = parId.get(id) ?? {};
    const r: Record<string, any> = { ...base, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)), id };
    delete r.lastApplied;
    const label = String(r.label ?? "").trim();
    if (!label || label.length > 80) erreurs.push(`${n} : libellé (label) de 1 à 80 caractères.`);
    r.label = label;
    const p = lignes.get(String(r.positionId ?? ""));
    if (!p) erreurs.push(`${n} (${label || id}) : ligne « ${r.positionId ?? ""} » introuvable (identifiant d'une ligne de list_positions).`);
    else if (p.status === "clôturé") erreurs.push(`${n} (${label || id}) : la ligne « ${p.name} » est clôturée.`);
    const amount = nombre(r.amount);
    if (!(amount > 0)) erreurs.push(`${n} (${label || id}) : montant (amount) strictement positif, en euros.`);
    else r.amount = amount;
    const day = nombre(r.day);
    if (!(Number.isInteger(day) && day >= 1 && day <= JOUR_MAX)) erreurs.push(`${n} (${label || id}) : jour du mois (day) entier de 1 à ${JOUR_MAX}.`);
    else r.day = day;
    if (r.start != null && !dateReelle(r.start)) erreurs.push(`${n} (${label || id}) : date de début (start) au format AAAA-MM-JJ.`);
    return r;
  }).filter(Boolean);
  const retires = cur.filter((r) => !vus.has(String(r.id)));
  return { versements, erreurs, retires };
}

/** Phrase lisible d'un versement : « Versement PEA : 200 € le 5 du mois sur PEA · ETF Monde ». */
export function texteVersement(r: any, positions: any[] = []): string {
  const p = (positions ?? []).find((x: any) => String(x.id) === String(r?.positionId));
  const ligne = p ? [p.envelope, p.name].filter(Boolean).join(" · ") : "ligne " + (r?.positionId ?? "?");
  return `${r?.label || "Versement"} : ${eur(+r?.amount || 0)} le ${+r?.day === 1 ? "1er" : r?.day} du mois sur ${ligne}`;
}
/* ---------- frais d'un contrat (frais_enveloppes, mêmes règles que appliquer_propositions de 0026 / 0027) ---------- */
export const FRAIS_CHAMPS = ["gestion_uc_pct", "gestion_euro_pct", "garde_pct"] as const;
export const FRAIS_LIBELLES: Record<string, string> = { gestion_uc_pct: "gestion des unités de compte", gestion_euro_pct: "gestion du fonds en euros", garde_pct: "droits de garde" };
export const FRAIS_PCT_MAX = 5;
export const FRAIS_SOURCE_MAX = 300;
const sansAccent = (s: unknown) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const nombreFr = (v: unknown) => (typeof v === "string" ? nombre(v.replace(",", ".")) : nombre(v));
/** Frais d'un contrat proposés → { enveloppe, frais: { <pourcentages>, source, le } } ou { erreurs }. aujourdhui : AAAA-MM-JJ (Europe/Paris) ;
    le absent = aujourdhui ; jamais dans le futur (date du document consulté). */
export function fraisEnveloppeDe(a: any, aujourdhui: string): { enveloppe?: string; frais?: Record<string, unknown>; erreurs: string[] } {
  const erreurs: string[] = [];
  const enveloppe = String(a?.enveloppe ?? "").trim();
  if (!enveloppe || enveloppe.length > 80) erreurs.push("enveloppe : nom de 1 à 80 caractères (champ envelope des lignes de list_positions).");
  const frais: Record<string, unknown> = {};
  for (const k of FRAIS_CHAMPS) {
    if (a?.[k] == null) continue;
    const x = nombreFr(a[k]);
    if (!(x >= 0 && x <= FRAIS_PCT_MAX)) erreurs.push(`${k} : pourcentage par an entre 0 et ${FRAIS_PCT_MAX} (0.5 pour 0,50 % par an).`);
    else frais[k] = x;
  }
  if (!FRAIS_CHAMPS.some((k) => a?.[k] != null)) erreurs.push("au moins un pourcentage : gestion_uc_pct, gestion_euro_pct ou garde_pct.");
  const source = String(a?.source ?? "").trim();
  if (!source) erreurs.push("source : document du contrat consulté (obligatoire).");
  else if (source.length > FRAIS_SOURCE_MAX) erreurs.push(`source : ${FRAIS_SOURCE_MAX} caractères au plus (référence du document).`);
  let le = aujourdhui;
  if (a?.le != null) {
    if (!dateReelle(a.le)) erreurs.push("le : date AAAA-MM-JJ du document consulté.");
    else if (a.le > aujourdhui) erreurs.push("le : date du document consulté, pas dans le futur.");
    else le = a.le;
  }
  return erreurs.length ? { erreurs } : { enveloppe, frais: { ...frais, source, le }, erreurs };
}
/** Phrase lisible des frais d'un contrat : « gestion des unités de compte 0,5 % par an, droits de garde 0 % par an ». */
export function texteFrais(f: any): string {
  if (!isObj(f)) return "aucun frais renseigné";
  const pc = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(v) + " % par an";
  return FRAIS_CHAMPS.filter((k) => f[k] != null).map((k) => `${FRAIS_LIBELLES[k]} ${pc(+f[k])}`).join(", ") || "aucun pourcentage";
}

/* ---------- DAT1 : informations des enveloppes, des prêts, donations et avis d'impôt (mêmes règles que la migration 0029) ---------- */
export const TYPES_ENVELOPPE = ["pea", "pea_pme", "pea_jeune", "assurance_vie", "capitalisation", "per", "pel", "cel", "pee", "percol", "compte_titres", "livret_a", "ldds", "lep", "autre"] as const;
export const ORIGINES_VERSEMENT = ["versement", "abondement", "participation", "interessement"] as const;
export const LIENS_DONATION = ["enfant", "petit_enfant", "arriere_petit_enfant", "autre"] as const;
export const NATURES_DONATION = ["donation", "don_argent_790g", "don_logement_790a_bis"] as const;
export const ENVELOPPES_MAX = 30, PRETS_MAX = 50, DONATIONS_MAX = 100, VERSEMENTS_PEE_MAX = 120, MOINS_VALUES_MAX = 15, PLAFONDS_PER_MAX = 6;
export const DATE_MIN = "1950-01-01";
const LIBELLES_TYPE: Record<string, string> = { pea: "PEA", pea_pme: "PEA PME-ETI", pea_jeune: "PEA d'un majeur rattaché", assurance_vie: "assurance-vie", capitalisation: "contrat de capitalisation",
  per: "PER", pel: "PEL", cel: "CEL", pee: "PEE", percol: "PERCOL", compte_titres: "compte-titres", livret_a: "Livret A", ldds: "LDDS", lep: "LEP", autre: "autre enveloppe" };
const frDate = (s: string) => (dateReelle(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : String(s));
/** Date AAAA-MM-JJ réelle, après 1950 et pas dans le futur ; sinon le message d'erreur. */
function dateOk(nom: string, v: unknown, aujourdhui: string, futur = false): string | null {
  if (!dateReelle(v)) return `${nom} : date AAAA-MM-JJ réelle attendue.`;
  if (!futur && (v as string) > aujourdhui) return `${nom} : pas dans le futur (la date du document ou de l'événement est attendue).`;
  if ((v as string) < DATE_MIN) return `${nom} : pas avant le 01/01/1950.`;
  return null;
}
const sourceDe = (a: any, erreurs: string[]) => {
  const source = String(a?.source ?? "").trim();
  if (!source) erreurs.push("source : document consulté ou « déclaration de l'utilisateur » (obligatoire).");
  else if (source.length > FRAIS_SOURCE_MAX) erreurs.push(`source : ${FRAIS_SOURCE_MAX} caractères au plus (référence du document).`);
  return source;
};
const leDe = (a: any, aujourdhui: string, erreurs: string[]) => {
  if (a?.le == null) return aujourdhui;
  const e = dateOk("le", a.le, aujourdhui);
  if (e) { erreurs.push(e.replace("la date du document ou de l'événement", "date du document consulté")); return aujourdhui; }
  return a.le as string;
};
const CHAMPS_ENVELOPPE = ["date_ouverture", "date_ouverture_approx", "date_cloture", "versements_cumules", "versements_avant_70", "beneficiaires_revus_le", "versements", "moins_values"] as const;

/** Informations d'une enveloppe proposées → { nom, suffixe, infos } ou { erreurs }. `actuel` : enveloppes_infos[clé] actuel, dont les
    champs non fournis sont repris (null retire un champ) ; la base remplace l'objet en entier. aujourdhui : AAAA-MM-JJ (Europe/Paris). */
export function infosEnveloppeDe(a: any, aujourdhui: string, actuel: any = null):
    { nom?: string; suffixe?: string | null; infos?: Record<string, unknown>; erreurs: string[] } {
  const erreurs: string[] = [];
  const brut = String(a?.enveloppe ?? "").trim();
  const m = /^(.*)\|(p[12])$/.exec(brut);
  const nom = (m ? m[1] : brut).trim();
  if (!nom || nom.length > 80) erreurs.push("enveloppe : nom de 1 à 80 caractères (champ envelope des lignes de list_positions).");
  const type = a?.type;
  if (!(TYPES_ENVELOPPE as readonly string[]).includes(type)) erreurs.push(`type : ${TYPES_ENVELOPPE.join(", ")}.`);
  const titulaire = a?.titulaire;
  if (titulaire !== "p1" && titulaire !== "p2") erreurs.push("titulaire : p1 ou p2 (l'assuré pour une assurance-vie).");
  else if (m && m[2] !== titulaire) erreurs.push(`enveloppe : le suffixe |${m[2]} ne correspond pas au titulaire ${titulaire}.`);
  const fusion: Record<string, any> = {};
  if (isObj(actuel)) for (const k of CHAMPS_ENVELOPPE) if (actuel[k] != null) fusion[k] = actuel[k];
  for (const k of CHAMPS_ENVELOPPE) { if (a?.[k] === null) delete fusion[k]; else if (a?.[k] !== undefined) fusion[k] = a[k]; }
  if (a?.date_ouverture != null && a?.date_ouverture_approx != null) erreurs.push("date_ouverture et date_ouverture_approx ne vont pas ensemble : une date exacte, ou l'année (ou le mois) seulement.");
  else if (a?.date_ouverture != null) delete fusion.date_ouverture_approx;
  else if (a?.date_ouverture_approx != null) delete fusion.date_ouverture;
  for (const k of ["date_ouverture", "date_cloture", "beneficiaires_revus_le"]) if (fusion[k] != null) { const e = dateOk(k, fusion[k], aujourdhui); if (e) erreurs.push(e); }
  if (fusion.date_ouverture_approx != null) {
    const x = /^(\d{4})(?:-(\d{2}))?$/.exec(String(fusion.date_ouverture_approx));
    const debut = x ? `${x[1]}-${x[2] ?? "01"}-01` : "";
    if (!x || !dateReelle(debut)) erreurs.push("date_ouverture_approx : AAAA ou AAAA-MM.");
    else if (debut > aujourdhui) erreurs.push("date_ouverture_approx : pas dans le futur.");
    else if (debut < DATE_MIN) erreurs.push("date_ouverture_approx : pas avant 1950.");
  }
  if (fusion.date_cloture != null && fusion.date_ouverture != null && dateReelle(fusion.date_cloture) && dateReelle(fusion.date_ouverture) && fusion.date_cloture < fusion.date_ouverture)
    erreurs.push("date_cloture : après la date d'ouverture.");
  for (const k of ["versements_cumules", "versements_avant_70"]) if (fusion[k] != null) {
    const x = nombreFr(fusion[k]);
    if (!(x >= 0)) erreurs.push(`${k} : montant en euros, 0 ou plus.`); else fusion[k] = x;
  }
  if (typeof fusion.versements_cumules === "number" && typeof fusion.versements_avant_70 === "number" && fusion.versements_avant_70 > fusion.versements_cumules)
    erreurs.push("versements_avant_70 : au plus égal à versements_cumules.");
  if (fusion.versements != null) {
    if (type !== "pee" && type !== "percol") erreurs.push("versements : réservés aux types pee et percol.");
    else if (!Array.isArray(fusion.versements)) erreurs.push("versements : liste attendue.");
    else if (fusion.versements.length > VERSEMENTS_PEE_MAX) erreurs.push(`versements : ${VERSEMENTS_PEE_MAX} au plus.`);
    else fusion.versements = fusion.versements.map((v: any, i: number) => {
      const n = `versement ${i + 1}`;
      if (!isObj(v)) { erreurs.push(`${n} : objet attendu.`); return v; }
      const e = dateOk(`${n} : le`, v.le, aujourdhui);
      if (e) erreurs.push(e);
      const montant = nombreFr(v.montant);
      if (!(montant >= 0)) erreurs.push(`${n} : montant en euros, 0 ou plus.`);
      if (!(ORIGINES_VERSEMENT as readonly string[]).includes(v.origine)) erreurs.push(`${n} : origine ${ORIGINES_VERSEMENT.join(", ")}.`);
      const sortie: Record<string, unknown> = { le: v.le, montant, origine: v.origine };
      if (v.disponible_le != null) {
        if (!dateReelle(v.disponible_le)) erreurs.push(`${n} : disponible_le au format AAAA-MM-JJ.`);
        else if (dateReelle(v.le) && v.disponible_le < v.le) erreurs.push(`${n} : disponible_le avant la date du versement.`);
        else sortie.disponible_le = v.disponible_le;
      }
      return sortie;
    });
  }
  if (fusion.moins_values != null) {
    const an = +aujourdhui.slice(0, 4);
    if (type !== "compte_titres") erreurs.push("moins_values : réservées au type compte_titres.");
    else if (!Array.isArray(fusion.moins_values)) erreurs.push("moins_values : liste attendue.");
    else if (fusion.moins_values.length > MOINS_VALUES_MAX) erreurs.push(`moins_values : ${MOINS_VALUES_MAX} au plus.`);
    else fusion.moins_values = fusion.moins_values.map((v: any, i: number) => {
      const n = `moins-value ${i + 1}`;
      if (!isObj(v)) { erreurs.push(`${n} : objet attendu.`); return v; }
      if (!(Number.isInteger(v.annee) && v.annee >= 2000 && v.annee <= an)) erreurs.push(`${n} : annee, entier de 2000 à ${an}.`);
      const montant = nombreFr(v.montant);
      if (!(montant > 0)) erreurs.push(`${n} : montant strictement positif, en euros.`);
      return { annee: v.annee, montant };
    });
  }
  for (const k of ["versements", "moins_values"]) if (Array.isArray(fusion[k]) && !fusion[k].length) delete fusion[k]; // liste vide : non stockée (comme la base)
  const source = sourceDe(a, erreurs), le = leDe(a, aujourdhui, erreurs);
  if (erreurs.length) return { erreurs };
  return { nom, suffixe: m ? m[2] : null, erreurs, infos: { type, titulaire, ...fusion, source, le } };
}
/** La table propositions limite `apres` à 20 000 octets : message clair plutôt que le refus de la table. */
export const APRES_OCTETS_MAX = 20000;
export const tropVolumineux = (items: any[]): string | null =>
  items.some((i) => JSON.stringify(i?.apres ?? {}).length > APRES_OCTETS_MAX - 500) ? "La proposition est trop volumineuse pour la table des propositions (20 000 octets) : propose moins de lignes à la fois." : null;
/** Phrase lisible des informations d'une enveloppe : « PEA, titulaire p1, ouverte le 15/06/2021, 92 000 € versés (relevé annuel 2025) ». */
export function texteInfosEnveloppe(i: any): string {
  if (!isObj(i)) return "aucune information";
  const l: string[] = [LIBELLES_TYPE[i.type] ?? String(i.type ?? "?")];
  if (i.date_ouverture) l.push("ouverte le " + frDate(i.date_ouverture));
  if (i.date_ouverture_approx) l.push("ouverte en " + i.date_ouverture_approx);
  if (i.date_cloture) l.push("close le " + frDate(i.date_cloture));
  if (i.versements_cumules != null) l.push(eur(+i.versements_cumules) + " versés");
  if (i.versements_avant_70 != null) l.push(eur(+i.versements_avant_70) + " avant 70 ans");
  if (i.beneficiaires_revus_le) l.push("clause bénéficiaire revue le " + frDate(i.beneficiaires_revus_le));
  if (Array.isArray(i.versements)) l.push(i.versements.length + " versement" + (i.versements.length > 1 ? "s" : ""));
  if (Array.isArray(i.moins_values)) l.push(i.moins_values.length + " moins-value" + (i.moins_values.length > 1 ? "s" : ""));
  return l.join(", ") + (i.source ? ` (${i.source})` : "");
}

const PRET_RE = /^(credit|bien):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const CHAMPS_PRET = ["date_signature", "date_fin", "duree_mois", "taux_pct", "assurance_taux_pct", "ira_exoneration"] as const;
/** Informations d'un prêt proposées → { pret, infos } ou { erreurs }. `actuel` : prets_infos[clé] actuel (champs non fournis repris, null retire). */
export function infosPretDe(a: any, aujourdhui: string, actuel: any = null): { pret?: string; infos?: Record<string, unknown>; erreurs: string[] } {
  const erreurs: string[] = [];
  const pret = String(a?.pret ?? "").trim();
  if (!PRET_RE.test(pret)) erreurs.push("pret : credit:<identifiant> ou bien:<identifiant> (identifiants de get_overview, listes credits et biens).");
  const f: Record<string, any> = {};
  if (isObj(actuel)) for (const k of CHAMPS_PRET) if (actuel[k] != null) f[k] = actuel[k];
  for (const k of CHAMPS_PRET) { if (a?.[k] === null) delete f[k]; else if (a?.[k] !== undefined) f[k] = a[k]; }
  for (const k of ["date_signature", "date_fin"]) if (f[k] != null) { const e = dateOk(k, f[k], aujourdhui, k === "date_fin"); if (e) erreurs.push(e); }
  if (f.date_signature != null && f.date_fin != null && dateReelle(f.date_signature) && dateReelle(f.date_fin) && f.date_fin <= f.date_signature) erreurs.push("date_fin : après date_signature.");
  if (f.duree_mois != null) { const x = nombre(f.duree_mois); if (!(Number.isInteger(x) && x >= 1 && x <= 480)) erreurs.push("duree_mois : entier de 1 à 480."); else f.duree_mois = x; }
  for (const [k, max] of [["taux_pct", 20], ["assurance_taux_pct", 5]] as [string, number][]) if (f[k] != null) {
    const x = nombreFr(f[k]);
    if (!(x >= 0 && x <= max)) erreurs.push(`${k} : pourcentage par an entre 0 et ${max} (0.5 pour 0,50 %).`); else f[k] = x;
  }
  if (f.ira_exoneration != null && typeof f.ira_exoneration !== "boolean") erreurs.push("ira_exoneration : true ou false.");
  if (!CHAMPS_PRET.some((k) => f[k] != null)) erreurs.push("au moins une information : date_signature, date_fin, duree_mois, taux_pct, assurance_taux_pct ou ira_exoneration.");
  const source = sourceDe(a, erreurs), le = leDe(a, aujourdhui, erreurs);
  return erreurs.length ? { erreurs } : { pret, erreurs, infos: { ...f, source, le } };
}
/** Phrase lisible d'un prêt : « signé le 15/04/2022, fin le 15/04/2029, 84 mois, 3,5 % (offre de prêt) ». */
export function texteInfosPret(i: any): string {
  if (!isObj(i)) return "aucune information";
  const l: string[] = [];
  if (i.date_signature) l.push("signé le " + frDate(i.date_signature));
  if (i.date_fin) l.push("fin le " + frDate(i.date_fin));
  if (i.duree_mois != null) l.push(i.duree_mois + " mois");
  if (i.taux_pct != null) l.push(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(+i.taux_pct) + " % par an");
  if (i.assurance_taux_pct != null) l.push("assurance " + new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(+i.assurance_taux_pct) + " % par an");
  if (i.ira_exoneration != null) l.push(i.ira_exoneration ? "sans indemnité de remboursement anticipé" : "avec indemnité de remboursement anticipé");
  return l.join(", ") + (i.source ? ` (${i.source})` : "");
}

/** Donations consenties proposées → liste complète normalisée ou erreurs. `existantes` : config.donations actuel (source et date de saisie
    d'une donation inchangée reprises par id) ; nouvelId : identifiant d'une donation sans id. */
export function donationsDe(a: any, existantes: any[], aujourdhui: string, nouvelId: () => string):
    { donations: any[]; erreurs: string[]; retires: any[] } {
  const erreurs: string[] = [];
  const liste = a?.donations;
  if (!Array.isArray(liste)) return { donations: [], erreurs: ["donations : liste attendue."], retires: [] };
  if (liste.length > DONATIONS_MAX) erreurs.push(`donations : ${DONATIONS_MAX} au plus.`);
  const cur = (Array.isArray(existantes) ? existantes : []).filter(isObj);
  const parId = new Map(cur.filter((d) => d.id != null).map((d) => [String(d.id), d]));
  const sourceDefaut = String(a?.source ?? "").trim();
  if (!sourceDefaut) erreurs.push("source : document consulté ou « déclaration de l'utilisateur » (obligatoire).");
  else if (sourceDefaut.length > FRAIS_SOURCE_MAX) erreurs.push(`source : ${FRAIS_SOURCE_MAX} caractères au plus.`);
  const vus = new Set<string>();
  const donations = liste.map((d: any, i: number) => {
    const n = `donation ${i + 1}`;
    if (!isObj(d)) { erreurs.push(`${n} : objet attendu.`); return null; }
    const id = d.id == null || String(d.id).trim() === "" ? nouvelId() : String(d.id).trim();
    if (id.length > 64) erreurs.push(`${n} : identifiant trop long (64 caractères au plus).`);
    if (vus.has(id)) erreurs.push(`${n} : identifiant « ${id} » en double.`);
    vus.add(id);
    const e = dateOk(`${n} : date`, d.date, aujourdhui);
    if (e) erreurs.push(e);
    const montant = nombreFr(d.montant);
    if (!(montant > 0)) erreurs.push(`${n} : montant strictement positif, en euros.`);
    if (d.donateur !== "p1" && d.donateur !== "p2") erreurs.push(`${n} : donateur p1 ou p2.`);
    if (!(LIENS_DONATION as readonly string[]).includes(d.lien)) erreurs.push(`${n} : lien ${LIENS_DONATION.join(", ")}.`);
    const benef = String(d.beneficiaire ?? "").trim();
    if (!benef || benef.length > 40) erreurs.push(`${n} : beneficiaire, libellé court de 1 à 40 caractères (« Enfant 1 » : jamais un nom imposé).`);
    if (!(NATURES_DONATION as readonly string[]).includes(d.nature)) erreurs.push(`${n} : nature ${NATURES_DONATION.join(", ")}.`);
    const base = parId.get(id);
    const memeDonnee = base && base.date === d.date && +base.montant === montant;
    const src = String(d.source ?? (memeDonnee ? base.source : sourceDefaut) ?? "").trim();
    if (!src || src.length > FRAIS_SOURCE_MAX) erreurs.push(`${n} : source de 1 à ${FRAIS_SOURCE_MAX} caractères.`);
    const le = d.le != null ? d.le : memeDonnee && base.le ? base.le : aujourdhui;
    if (!dateReelle(le) || le > aujourdhui) erreurs.push(`${n} : le, date du document consulté (AAAA-MM-JJ), pas dans le futur.`);
    return { id, date: d.date, montant, donateur: d.donateur, lien: d.lien, beneficiaire: benef, nature: d.nature, source: src, le };
  }).filter(Boolean);
  return { donations, erreurs, retires: cur.filter((d) => !vus.has(String(d.id))) };
}
export function texteDonation(d: any): string {
  return `${d?.nature === "don_argent_790g" ? "Don familial" : d?.nature === "don_logement_790a_bis" ? "Don pour un logement" : "Donation"} à ${d?.beneficiaire ?? "?"} du ${frDate(d?.date)} : ${eur(+d?.montant || 0)}`;
}

/** Avis d'impôt proposé → { avis, avertissements } ou erreurs. aujourdhui : AAAA-MM-JJ. Remplace l'avis précédent en entier. */
export function avisImpotDe(a: any, aujourdhui: string): { avis?: Record<string, unknown>; avertissements: string[]; erreurs: string[] } {
  const erreurs: string[] = [], avertissements: string[] = [];
  const an = +aujourdhui.slice(0, 4);
  const annee = a?.annee_revenus;
  if (!(Number.isInteger(annee) && annee >= 2000 && annee <= an)) erreurs.push(`annee_revenus : année des revenus de l'avis (2000 à ${an}).`);
  const avis: Record<string, unknown> = {};
  if (a?.rfr != null) { const x = nombreFr(a.rfr); if (!(x >= 0)) erreurs.push("rfr : revenu fiscal de référence en euros, 0 ou plus."); else avis.rfr = x; }
  if (a?.plafonds_per != null) {
    if (!isObj(a.plafonds_per)) erreurs.push("plafonds_per : objet { p1, p2 } attendu.");
    else {
      const out: Record<string, unknown> = {};
      for (const [p, l] of Object.entries(a.plafonds_per)) {
        if (p !== "p1" && p !== "p2") { erreurs.push(`plafonds_per : personne « ${p} » inconnue (p1 ou p2).`); continue; }
        if (!Array.isArray(l)) { erreurs.push(`plafonds_per.${p} : liste attendue.`); continue; }
        if (l.length > PLAFONDS_PER_MAX) erreurs.push(`plafonds_per.${p} : ${PLAFONDS_PER_MAX} lignes au plus.`);
        const vus = new Set<number>();
        out[p] = l.map((x: any, i: number) => {
          const n = `plafonds_per.${p} ligne ${i + 1}`;
          if (!isObj(x)) { erreurs.push(`${n} : objet attendu.`); return x; }
          if (!(Number.isInteger(x.annee) && x.annee >= 2000 && x.annee <= an + 1)) erreurs.push(`${n} : annee, entier de 2000 à ${an + 1} (année imprimée sur l'avis).`);
          else if (vus.has(x.annee)) erreurs.push(`${n} : annee ${x.annee} en double.`);
          else { vus.add(x.annee); if (Number.isInteger(annee) && (x.annee < annee - 4 || x.annee > annee + 1)) avertissements.push(`${n} : l'année ${x.annee} sort de ${annee - 4} à ${annee + 1} : vérifie le libellé imprimé sur l'avis.`); }
          const montant = nombreFr(x.montant);
          if (!(montant > 0)) erreurs.push(`${n} : montant strictement positif, en euros.`);
          return { annee: x.annee, montant };
        });
      }
      avis.plafonds_per = out;
    }
  }
  const source = sourceDe(a, erreurs), le = leDe(a, aujourdhui, erreurs);
  return erreurs.length ? { avertissements, erreurs } : { avertissements, erreurs, avis: { annee_revenus: annee, ...avis, source, le } };
}
export function texteAvisImpot(v: any): string {
  if (!isObj(v) || v.annee_revenus == null) return "aucun avis d'impôt";
  const l = [`revenus ${v.annee_revenus}`];
  if (v.rfr != null) l.push("revenu fiscal de référence " + eur(+v.rfr));
  for (const p of ["p1", "p2"]) if (Array.isArray(v.plafonds_per?.[p]) && v.plafonds_per[p].length)
    l.push(`plafond épargne retraite ${p} : ` + v.plafonds_per[p].map((x: any) => `${x.annee} ${eur(+x.montant)}`).join(", "));
  return l.join(", ") + (v.source ? ` (${v.source})` : "");
}
const sansLastApplied = (l: any[]) => (Array.isArray(l) ? l : []).map((r) => { if (!isObj(r)) return r; const { lastApplied: _l, ...x } = r; return x; });

export type Reglages = {
  db: any; wrap: any; must: any; UserError: any; RO: any; RW: any;
  DEPOT: Record<string, any>;
  deposer: (items: any[], d: { source: string; justification?: string; lot?: string }, extra?: Record<string, unknown>) => Promise<unknown>;
  depensesMensuelles: () => Promise<number>;
  nouvelId?: () => string;
  /** Date du jour (AAAA-MM-JJ, Europe/Paris) ; par défaut, l'horloge. */
  today?: () => string;
  /** Fonctions du calendrier (calendrier.ts) : type déduit du nom et clé d'enveloppe. */
  calendrier?: { typeDeduit: (nom: unknown) => string | null; cleEnveloppe: (nom: string, titulaire: string, positions: any[], infos?: any) => string };
};

export function registerReglages(server: any, h: Reglages) {
  const { db, wrap, must, UserError, RW, DEPOT, deposer } = h;
  const nouvelId = h.nouvelId ?? (() => "rec-" + crypto.randomUUID().slice(0, 8));
  const aujourdhui = h.today ?? (() => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date()));
  const PROPOSE = "Rien n'est écrit directement : dépose une proposition (avant / après, source) que l'utilisateur valide dans Boussole › Agent › Propositions.";
  const lireConfig = async (cols: string) => (must("config", await db.from("config").select(cols).maybeSingle()) as any) ?? {};

  server.registerTool("regler_matelas", {
    title: "Proposer la cible du matelas de précaution",
    description: "Propose la cible du matelas de précaution (épargne disponible de la poche « Épargne » du foyer) : en montant (mode montant : montant minimum, maximum facultatif) ou en mois de dépenses (mode mois : mois, et depenses mensuelles ; sans depenses, celles du budget). Remplace la cible actuelle (lis-la avec get_config, champ cushion). Demande d'abord à l'utilisateur la cible qu'il veut ; n'en décide jamais à sa place. " + PROPOSE,
    inputSchema: z.strictObject({
      mode: z.enum(["montant", "mois"], { error: "mode : montant ou mois." }).describe("montant = somme fixe à garder de côté ; mois = nombre de mois de dépenses."),
      montant: z.number().min(0, { error: "Montant négatif interdit." }).optional().describe("Mode montant : minimum à garder de côté, en euros."),
      maximum: z.number().min(0, { error: "Montant négatif interdit." }).nullable().optional().describe("Mode montant : plafond facultatif, en euros (au moins le minimum)."),
      mois: z.number().gt(0, { error: "mois : nombre strictement positif." }).max(MOIS_MAX).optional().describe("Mode mois : nombre de mois de dépenses (ex. 6)."),
      depenses: z.number().gt(0, { error: "depenses : montant strictement positif." }).optional().describe("Mode mois : dépenses mensuelles en euros ; absent = dépenses mensuelles du budget."),
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const dep = a.mode === "mois" && a.depenses == null ? await h.depensesMensuelles() : 0;
    const r = cushionDe(a, dep);
    if (r.erreurs.length) throw new UserError("Aucune proposition déposée :\n- " + r.erreurs.join("\n- "));
    const cur = (await lireConfig("cushion")).cushion ?? null;
    const items = pareil(cur, r.cushion) ? [] : [{ cible: "config", operation: "modifier", avant: { cushion: cur }, apres: { cushion: r.cushion } }];
    return deposer(items, a, { cible_proposee: texteMatelas(r.cushion), cible_actuelle: texteMatelas(cur),
      ...(a.mode === "mois" && a.depenses == null ? { depenses_du_budget: dep } : {}) });
  }));

  const Versement = z.looseObject({
    id: z.string().trim().min(1).max(64).optional().describe("Identifiant du versement (get_config, recurring[].id) pour le garder ou le modifier ; absent : nouveau versement."),
    label: z.string().trim().min(1).max(80).describe("Libellé (ex. « Versement PEA »)."),
    positionId: z.string().regex(UUID_RE, { error: "positionId : identifiant d'une ligne (UUID, list_positions)." }).describe("Ligne qui reçoit le versement (id de list_positions)."),
    amount: z.number().gt(0, { error: "amount : montant strictement positif." }).describe("Montant en euros."),
    day: z.number().int({ error: "day : jour entier." }).min(1).max(JOUR_MAX, { error: `day : jour du mois de 1 à ${JOUR_MAX}.` }).describe(`Jour du mois (1 à ${JOUR_MAX}).`),
    start: z.string().regex(DATE_RE, { error: "start : date AAAA-MM-JJ." }).nullable().optional().describe("Date de début (AAAA-MM-JJ) ; absent : dès le prochain jour prévu."),
  });
  server.registerTool("regler_versements", {
    title: "Proposer les versements programmés",
    description: "Propose la liste complète des versements programmés (appliqués chaque nuit par Boussole : le jour prévu, le montant est ajouté à la ligne). mode remplacer : la liste fournie remplace la liste existante ; lis d'abord get_config (recurring) et renvoie TOUS les versements à garder, avec leur id (les champs non fournis d'un versement existant sont conservés ; un versement absent de la liste est supprimé). Récapitule à l'utilisateur ce qui change avant de déposer. " + PROPOSE,
    inputSchema: z.strictObject({
      versements: z.array(Versement).max(VERSEMENTS_MAX).describe("Liste complète des versements programmés à garder (vide : plus aucun versement)."),
      mode: z.literal("remplacer", { error: "mode : remplacer (la liste fournie remplace la liste existante)." }).describe("remplacer : la liste fournie remplace la liste existante."),
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    if (a.mode !== "remplacer") throw new UserError("mode : remplacer (la liste fournie remplace la liste existante).");
    const [cfg, po] = await Promise.all([lireConfig("recurring"), db.from("positions").select("id, name, envelope, status")]);
    const positions = (must("positions", po) as any[]) ?? [];
    const cur = Array.isArray(cfg.recurring) ? cfg.recurring : [];
    const r = normaliserVersements(a.versements, cur, positions, nouvelId);
    if (r.erreurs.length) throw new UserError("Aucune proposition déposée :\n- " + r.erreurs.join("\n- "));
    const avant = sansLastApplied(cur);
    const items = pareil(avant, r.versements) ? [] : [{ cible: "config", operation: "modifier", avant: { recurring: avant }, apres: { recurring: r.versements } }];
    const avertissements = r.retires.map((x: any) => `Supprimé si l'utilisateur valide : ${texteVersement(x, positions)}.`);
    return deposer(items, a, { avertissements, versements_proposes: r.versements.map((x: any) => texteVersement(x, positions)) });
  }));

  server.registerTool("corriger_classe", {
    title: "Proposer la classe d'actifs d'une poche",
    description: "Propose la classe d'actifs d'une poche de placements (rattachement poche → classe, qui sert au profil de risque, à l'allocation et aux bonnes pratiques), quand la classe déduite de son nom ne correspond pas à son contenu. classe null : la poche reprend la classe déduite de son nom. Classes : " +
      CLASSES.map((c) => `${c} (${LIBELLES_CLASSES[c]})`).join(", ") + ". " + PROPOSE,
    inputSchema: z.strictObject({
      poche: z.string().trim().min(1).max(60).describe("Nom exact de la poche (champ bloc des lignes de list_positions)."),
      classe: z.enum(CLASSES, { error: "classe : " + CLASSES.join(", ") + " (ou null)." }).nullable().describe("Classe d'actifs ; null retire la correction."),
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const poche = String(a.poche ?? "").trim();
    if (!poche || poche.length > 60) throw new UserError("poche : nom de 1 à 60 caractères.");
    if (a.classe !== null && !(CLASSES as readonly string[]).includes(a.classe)) throw new UserError("classe : " + CLASSES.join(", ") + " (ou null).");
    const [pr, po] = await Promise.all([db.from("profiles").select("classes").maybeSingle(), db.from("positions").select("bloc")]);
    const profil = must("profiles", pr) as any;
    const classes = isObj(profil?.classes) ? profil.classes : {};
    const blocs = new Set(((must("positions", po) as any[]) ?? []).map((p: any) => p.bloc));
    const actuelle = Object.prototype.hasOwnProperty.call(classes, poche) ? classes[poche] : null;
    const avertissements = blocs.has(poche) ? [] : [`Aucune ligne dans la poche « ${poche} » : vérifie son nom exact (list_positions, champ bloc).`];
    const items = actuelle === a.classe ? [] : [{ cible: "profil", operation: "modifier", avant: { classes: { [poche]: actuelle } }, apres: { classes: { [poche]: a.classe } } }];
    return deposer(items, a, { avertissements, classe_proposee: a.classe === null ? "classe déduite du nom de la poche" : LIBELLES_CLASSES[a.classe] });
  }));

  const Pct = (k: string) => z.union([z.number(), z.string()]).optional()
    .describe(`${FRAIS_LIBELLES[k]}, en % par an (0.5 pour 0,50 %), entre 0 et ${FRAIS_PCT_MAX}, tel qu'écrit dans le document du contrat.`);
  server.registerTool("regler_frais_enveloppe", {
    title: "Proposer les frais d'un contrat (enveloppe)",
    description: "Propose les frais d'une enveloppe (assurance-vie, PER, PEA, compte-titres) : frais de gestion sur les unités de compte (gestion_uc_pct), sur le fonds en euros (gestion_euro_pct) et droits de garde (garde_pct), en % par an. Ils servent au critère « Frais des supports » de Pilotage › Santé. Relève-les dans les documents du contrat que l'utilisateur te donne ou que tu consultes : conditions générales, annexe de frais, relevé annuel ; cite le document et sa date dans source (et le : date du document, AAAA-MM-JJ, jamais dans le futur). N'invente jamais un pourcentage : sans document, ne propose rien et dis ce qui manque. Une proposition remplace les frais de cette enveloppe en entier (lis-les avec get_config, frais_enveloppes) ; les autres enveloppes ne changent pas. " + PROPOSE,
    inputSchema: z.strictObject({
      enveloppe: z.string().trim().min(1).max(80).describe("Nom de l'enveloppe, tel que dans le champ envelope des lignes de list_positions (ex. « Assurance-vie Linxea »)."),
      gestion_uc_pct: Pct("gestion_uc_pct"), gestion_euro_pct: Pct("gestion_euro_pct"), garde_pct: Pct("garde_pct"),
      le: z.string().regex(DATE_RE, { error: "le : date AAAA-MM-JJ du document consulté." }).optional().describe("Date du document consulté (AAAA-MM-JJ) ; absente : aujourd'hui."),
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const r = fraisEnveloppeDe(a, aujourdhui());
    if (r.erreurs.length) throw new UserError("Aucune proposition déposée :\n- " + r.erreurs.join("\n- "));
    const [cfg, po] = await Promise.all([lireConfig("frais_enveloppes"), db.from("positions").select("envelope, status")]);
    const actuels = isObj(cfg.frais_enveloppes) ? cfg.frais_enveloppes : {};
    const enveloppes = [...new Set(((must("positions", po) as any[]) ?? []).filter((p: any) => p.status !== "clôturé").map((p: any) => String(p.envelope ?? "")).filter(Boolean))];
    /* Nom aligné sur une enveloppe connue (lignes, puis frais déjà enregistrés), à la casse et aux accents près. */
    const nom = enveloppes.find((e) => sansAccent(e) === sansAccent(r.enveloppe)) ?? Object.keys(actuels).find((e) => sansAccent(e) === sansAccent(r.enveloppe)) ?? r.enveloppe!;
    const cleActuelle = Object.keys(actuels).find((e) => sansAccent(e) === sansAccent(nom));
    const cur = cleActuelle != null && isObj(actuels[cleActuelle]) ? actuels[cleActuelle] : null;
    const avertissements = enveloppes.includes(nom) ? [] : [`Aucune ligne dans l'enveloppe « ${nom} » : vérifie son nom exact (list_positions, champ envelope).`];
    const items = pareil(cur, r.frais) ? [] : [{ cible: "config", operation: "modifier", avant: { frais_enveloppes: { [nom]: cur } }, apres: { frais_enveloppes: { [nom]: r.frais } } }];
    return deposer(items, a, { avertissements, enveloppe: nom, frais_proposes: texteFrais(r.frais), frais_actuels: texteFrais(cur) });
  }));

  /* ---------- DAT1 : dates et informations du calendrier patrimonial (calendrier.ts lit, ces outils proposent) ---------- */
  const DOC = "Relève la donnée dans un document que l'utilisateur te donne (jamais de mémoire, jamais de la synchronisation bancaire) ; sans document, demande-la une seule fois, et à défaut propose l'année seule (date_ouverture_approx). Cite le document dans source.";
  const DateIso = (k: string, aide: string) => z.string().regex(DATE_RE, { error: `${k} : date AAAA-MM-JJ.` }).nullable().optional().describe(aide);
  const Euros = (aide: string) => z.union([z.number(), z.string()]).nullable().optional().describe(aide);
  const LeDoc = z.string().regex(DATE_RE, { error: "le : date AAAA-MM-JJ du document consulté." }).optional().describe("Date du document consulté (AAAA-MM-JJ), jamais dans le futur ; absente : aujourd'hui.");
  server.registerTool("regler_infos_enveloppe", {
    title: "Proposer les informations d'une enveloppe (calendrier)",
    description: "Propose les informations d'une enveloppe qui font courir ses délais fiscaux : type (pea, pea_pme, pea_jeune, assurance_vie, capitalisation, per, pel, cel, pee, percol, compte_titres, livret_a, ldds, lep, autre), titulaire (p1 ou p2 ; l'assuré pour une assurance-vie), date d'ouverture (date du premier versement pour un PEA ou une assurance-vie) ou, à défaut, l'année ou le mois seul (date_ouverture_approx), date de clôture, versements cumulés (plafond du PEA, seuil de l'assurance-vie), versements avant 70 ans, dernière revue de la clause bénéficiaire (la date seulement : aucun nom n'est gardé), versements d'épargne salariale (pee, percol : date, montant, origine, disponible_le du relevé) et moins-values reportables (compte_titres : année et montant). " + DOC + " Les champs non fournis d'une enveloppe déjà renseignée sont conservés ; null retire un champ. Le nom est aligné sur une enveloppe connue (casse et accents ignorés) ; si deux titulaires ont une enveloppe de ce nom, la clé porte le titulaire. " + PROPOSE,
    inputSchema: z.strictObject({
      enveloppe: z.string().trim().min(1).max(80).describe("Nom de l'enveloppe, tel que dans le champ envelope des lignes de list_positions (ex. « PEA Exemple »)."),
      type: z.enum(TYPES_ENVELOPPE, { error: "type : " + TYPES_ENVELOPPE.join(", ") + "." }).describe("Type de l'enveloppe ; le nom permet de le déduire, mais confirme-le."),
      titulaire: z.enum(["p1", "p2"], { error: "titulaire : p1 ou p2." }).describe("Titulaire (p1 ou p2) ; l'assuré pour une assurance-vie."),
      date_ouverture: DateIso("date_ouverture", "Date du premier versement (PEA, assurance-vie, capitalisation) ou d'ouverture (PEL, CEL), AAAA-MM-JJ, lue dans un document."),
      date_ouverture_approx: z.string().regex(/^\d{4}(-\d{2})?$/, { error: "date_ouverture_approx : AAAA ou AAAA-MM." }).nullable().optional().describe("Année (AAAA) ou mois (AAAA-MM) seuls, quand l'utilisateur ne connaît pas la date exacte ; exclusif de date_ouverture. Boussole retient alors la date la plus tardive possible."),
      date_cloture: DateIso("date_cloture", "Date de clôture de l'enveloppe (plus aucun jalon futur)."),
      versements_cumules: Euros("Versements nets cumulés, en euros (plafond du PEA, seuil de 150 000 € de l'assurance-vie), à la date le du document."),
      versements_avant_70: Euros("Assurance-vie : primes versées avant les 70 ans de l'assuré, en euros (au plus versements_cumules)."),
      beneficiaires_revus_le: DateIso("beneficiaires_revus_le", "Date de la dernière revue de la clause bénéficiaire (aucun nom n'est gardé)."),
      versements: z.array(z.looseObject({})).max(VERSEMENTS_PEE_MAX).nullable().optional().describe("pee, percol : [{ le: AAAA-MM-JJ, montant, origine: versement | abondement | participation | interessement, disponible_le?: AAAA-MM-JJ du relevé }], " + VERSEMENTS_PEE_MAX + " au plus. Remplace la liste actuelle."),
      moins_values: z.array(z.looseObject({})).max(MOINS_VALUES_MAX).nullable().optional().describe("compte_titres : [{ annee: année de la moins-value, montant > 0 }], " + MOINS_VALUES_MAX + " au plus. Remplace la liste actuelle."),
      le: LeDoc,
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const auj = aujourdhui();
    const [cfg, po] = await Promise.all([lireConfig("enveloppes_infos"), db.from("positions").select("envelope, owner, status")]);
    const actuels = isObj(cfg.enveloppes_infos) ? cfg.enveloppes_infos : {};
    const positions = ((must("positions", po) as any[]) ?? []).filter((p: any) => String(p.envelope ?? "").trim());
    /* Nom aligné sur une enveloppe connue (lignes, puis informations déjà enregistrées), à la casse et aux accents près. */
    const brut = String(a.enveloppe ?? "").trim().replace(/\|p[12]$/, "").trim();
    const nom = positions.map((p: any) => String(p.envelope).trim()).find((e: string) => sansAccent(e) === sansAccent(brut))
      ?? Object.keys(actuels).map((k) => k.replace(/\|p[12]$/, "")).find((k) => sansAccent(k) === sansAccent(brut)) ?? brut;
    const cle0 = String(a.enveloppe ?? "").trim().match(/\|(p[12])$/);
    const cleCalc = h.calendrier ? h.calendrier.cleEnveloppe(nom, a.titulaire, positions, actuels) : nom;
    const cle = cle0 ? `${nom}|${cle0[1]}` : cleCalc;
    const cleActuelle = Object.keys(actuels).find((k) => sansAccent(k) === sansAccent(cle));
    const cur = cleActuelle != null && isObj(actuels[cleActuelle]) ? actuels[cleActuelle] : null;
    const r = infosEnveloppeDe({ ...a, enveloppe: cle0 ? `${nom}|${cle0[1]}` : nom }, auj, cur);
    if (r.erreurs.length) throw new UserError("Aucune proposition déposée :\n- " + r.erreurs.join("\n- "));
    const lignes = positions.filter((p: any) => sansAccent(p.envelope) === sansAccent(nom));
    const avertissements: string[] = [];
    if (!lignes.length) avertissements.push(`Aucune ligne dans l'enveloppe « ${nom} » : vérifie son nom exact (list_positions, champ envelope).`);
    else if (!lignes.some((p: any) => p.owner === a.titulaire)) avertissements.push(`Les lignes de « ${nom} » appartiennent à ${[...new Set(lignes.map((p: any) => p.owner))].join(" et ")}, pas à ${a.titulaire} : vérifie le titulaire.`);
    const deduit = h.calendrier?.typeDeduit(nom);
    if (deduit && deduit !== a.type) avertissements.push(`Le nom « ${nom} » évoque le type ${deduit}, tu proposes ${a.type} : confirme-le avec l'utilisateur.`);
    const cles = Object.keys(actuels);
    if (!cleActuelle && cles.length >= ENVELOPPES_MAX) avertissements.push(`${ENVELOPPES_MAX} enveloppes au plus : retire-en une avant d'en ajouter.`);
    const items = pareil(cur, r.infos) ? [] : [{ cible: "config", operation: "modifier", avant: { enveloppes_infos: { [cle]: cur } }, apres: { enveloppes_infos: { [cle]: r.infos } } }];
    const gros = tropVolumineux(items);
    if (gros) throw new UserError("Aucune proposition déposée :\n- " + gros);
    return deposer(items, a, { avertissements, enveloppe: cle, infos_proposees: texteInfosEnveloppe(r.infos), infos_actuelles: texteInfosEnveloppe(cur) });
  }));

  server.registerTool("regler_infos_pret", {
    title: "Proposer les informations d'un prêt (calendrier)",
    description: "Propose les informations du contrat d'un crédit ou du prêt d'un bien : date de signature, date de fin, durée en mois, taux, taux de l'assurance emprunteur, exonération d'indemnités de remboursement anticipé. Elles datent la dernière échéance (calendrier) et serviront aux astuces. pret : credit:<id> ou bien:<id> (identifiants de get_overview). Relève-les dans l'offre de prêt ou le tableau d'amortissement. " + DOC + " Les champs non fournis sont conservés ; null retire un champ. " + PROPOSE,
    inputSchema: z.strictObject({
      pret: z.string().regex(PRET_RE, { error: "pret : credit:<identifiant> ou bien:<identifiant>." }).describe("credit:<id> ou bien:<id> (identifiants des listes credits et biens de get_overview)."),
      date_signature: DateIso("date_signature", "Date de signature de l'offre, AAAA-MM-JJ."),
      date_fin: DateIso("date_fin", "Date de la dernière échéance, AAAA-MM-JJ (après la signature)."),
      duree_mois: z.number().int().min(1).max(480).nullable().optional().describe("Durée du prêt en mois (1 à 480)."),
      taux_pct: Euros("Taux nominal annuel en % (0.5 pour 0,50 %), de 0 à 20."),
      assurance_taux_pct: Euros("Taux annuel de l'assurance emprunteur en %, de 0 à 5."),
      ira_exoneration: z.boolean().nullable().optional().describe("true si l'offre exclut les indemnités de remboursement anticipé."),
      le: LeDoc,
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const auj = aujourdhui();
    const pret = String(a.pret ?? "").trim().toLowerCase();
    const m = PRET_RE.exec(pret);
    if (!m) throw new UserError("Aucune proposition déposée :\n- pret : credit:<identifiant> ou bien:<identifiant> (identifiants de get_overview).");
    const [ligne, cfg] = await Promise.all([db.from(m[1] === "credit" ? "credits" : "biens").select("id").eq("id", m[2]).maybeSingle(), lireConfig("prets_infos")]);
    if (!must(m[1] === "credit" ? "credits" : "biens", ligne)) throw new UserError(`Aucune proposition déposée :\n- pret : ${m[1] === "credit" ? "crédit" : "bien"} inconnu (${pret}) : utilise un identifiant de get_overview.`);
    const actuels = isObj(cfg.prets_infos) ? cfg.prets_infos : {};
    const cur = isObj(actuels[pret]) ? actuels[pret] : null;
    const r = infosPretDe({ ...a, pret }, auj, cur);
    if (r.erreurs.length) throw new UserError("Aucune proposition déposée :\n- " + r.erreurs.join("\n- "));
    const items = pareil(cur, r.infos) ? [] : [{ cible: "config", operation: "modifier", avant: { prets_infos: { [pret]: cur } }, apres: { prets_infos: { [pret]: r.infos } } }];
    return deposer(items, a, { pret, infos_proposees: texteInfosPret(r.infos), infos_actuelles: texteInfosPret(cur) });
  }));

  const Donation = z.looseObject({});
  server.registerTool("regler_donations", {
    title: "Proposer les donations consenties (calendrier)",
    description: "Propose la liste complète des donations consenties par le foyer (celles qu'il reçoit sont hors périmètre) : elles datent la fin du rappel fiscal de 15 ans. Chaque donation : { id? (pour la garder ou la modifier), date AAAA-MM-JJ, montant, donateur p1 ou p2, lien enfant | petit_enfant | arriere_petit_enfant | autre, beneficiaire (libellé court choisi par l'utilisateur, 40 caractères au plus, ex. « Enfant 1 » : jamais un nom), nature donation | don_argent_790g | don_logement_790a_bis }. Relève-les dans l'acte ou la déclaration de don. mode remplacer : la liste fournie remplace la liste existante ; lis d'abord get_config (donations) et renvoie TOUTES les donations à garder avec leur id ; une donation absente est supprimée. " + PROPOSE,
    inputSchema: z.strictObject({
      donations: z.array(Donation).max(DONATIONS_MAX).describe("Liste complète des donations consenties à garder (vide : aucune)."),
      mode: z.literal("remplacer", { error: "mode : remplacer (la liste fournie remplace la liste existante)." }).describe("remplacer : la liste fournie remplace la liste existante."),
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    if (a.mode !== "remplacer") throw new UserError("mode : remplacer (la liste fournie remplace la liste existante).");
    const d0 = (await lireConfig("donations")).donations;
    const cur = Array.isArray(d0) ? d0 : [];
    const r = donationsDe(a, cur, aujourdhui(), () => "don-" + crypto.randomUUID().slice(0, 8));
    if (r.erreurs.length) throw new UserError("Aucune proposition déposée :\n- " + r.erreurs.join("\n- "));
    const items = pareil(cur, r.donations) ? [] : [{ cible: "config", operation: "modifier", avant: { donations: cur }, apres: { donations: r.donations } }];
    const avertissements = r.retires.map((x: any) => `Supprimée si l'utilisateur valide : ${texteDonation(x)}.`);
    const gros = tropVolumineux(items);
    if (gros) throw new UserError("Aucune proposition déposée :\n- " + gros);
    return deposer(items, a, { avertissements, donations_proposees: r.donations.map(texteDonation) });
  }));

  server.registerTool("regler_avis_impot", {
    title: "Proposer les données de l'avis d'impôt (calendrier)",
    description: "Propose les données de l'avis d'impôt : année des revenus (annee_revenus), revenu fiscal de référence (rfr) et plafond épargne retraite non utilisé de chaque déclarant, par année du plafond (plafonds_per : { p1: [{ annee, montant }], p2: [...] }, 6 lignes au plus par personne). Elles datent l'expiration de chaque part du plafond. Recopie, pour chaque montant, l'année imprimée sur l'avis et son libellé dans source. Quand le libellé n'est pas « plafond <année> » mais renvoie à des revenus (« non utilisé pour les revenus de N », « calculé sur les revenus de N »), montre à l'utilisateur la date d'expiration qui en découle et fais-la confirmer avant de déposer : lecture attendue, à confirmer, « non utilisé pour les revenus de N » → annee N ; « calculé sur les revenus de N » → annee N + 1. Un avis remplace le précédent en entier. " + DOC + " " + PROPOSE,
    inputSchema: z.strictObject({
      annee_revenus: z.number().int().min(2000).describe("Année des revenus de l'avis (2025 pour l'avis reçu en 2026)."),
      rfr: Euros("Revenu fiscal de référence, en euros."),
      plafonds_per: z.strictObject({ p1: z.array(z.looseObject({})).max(PLAFONDS_PER_MAX).optional(), p2: z.array(z.looseObject({})).max(PLAFONDS_PER_MAX).optional() })
        .optional().describe("Plafond épargne retraite non utilisé par personne : [{ annee: année du plafond (« plafond 2024 »), montant > 0 }]."),
      le: LeDoc,
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const r = avisImpotDe(a, aujourdhui());
    if (r.erreurs.length) throw new UserError("Aucune proposition déposée :\n- " + r.erreurs.join("\n- "));
    const c = (await lireConfig("avis_impot")).avis_impot;
    const cur = isObj(c) && Object.keys(c).length ? c : {};
    const items = pareil(cur, r.avis) ? [] : [{ cible: "config", operation: "modifier", avant: { avis_impot: cur }, apres: { avis_impot: r.avis } }];
    return deposer(items, a, { avertissements: r.avertissements, avis_propose: texteAvisImpot(r.avis), avis_actuel: texteAvisImpot(cur) });
  }));
}
