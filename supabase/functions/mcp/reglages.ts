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
// Application par public.appliquer_propositions (migrations 0019, 0026 et 0027 pour frais_enveloppes), qui revalide tout.
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
const sansLastApplied = (l: any[]) => (Array.isArray(l) ? l : []).map((r) => { if (!isObj(r)) return r; const { lastApplied: _l, ...x } = r; return x; });

export type Reglages = {
  db: any; wrap: any; must: any; UserError: any; RO: any; RW: any;
  DEPOT: Record<string, any>;
  deposer: (items: any[], d: { source: string; justification?: string; lot?: string }, extra?: Record<string, unknown>) => Promise<unknown>;
  depensesMensuelles: () => Promise<number>;
  nouvelId?: () => string;
  /** Date du jour (AAAA-MM-JJ, Europe/Paris) ; par défaut, l'horloge. */
  today?: () => string;
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
}
