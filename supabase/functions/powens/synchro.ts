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
// (banque_comptes.propose_le) ; le capital restant dû d'un crédit ne vient que d'un compte de type credit.
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
/** Horodatage Powens (UTC sans fuseau, « AAAA-MM-JJ HH:MM:SS ») → ISO 8601 ; null si illisible. */
export function datePowens(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  return `${m[1]}T${m[2]}${m[3] ?? "Z"}`;
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

function isinDe(inv: any): string | null {
  if (inv?.code_type != null && String(inv.code_type).toUpperCase() !== "ISIN") return null;
  const c = String(inv?.code ?? "").toUpperCase().replace(/\s+/g, "");
  return ISIN.test(c) ? c : null;
}

/* ---------- plan ---------- */
type LectureCompte = { compte: any; placements: any[] | null; operations: any[] | null; erreur?: string };
/** État local : comptes (rattachements, ignore, propose_le), placements (liens, ligne_creee_le), lots des propositions déjà
    déposées, et comptes à rattacher à la ligne créée par une proposition acceptée (id du compte → id de la ligne). */
export type Etat = { comptes: any[]; placements: any[]; lotsExistants: string[]; acceptes?: Record<string, string> };
export type Donnees = {
  userId: string; connexion: any; comptes: LectureCompte[]; lectureComptesOk: boolean; maintenant: string; aujourdhui: string;
  minDate: string; lots: Record<string, string>; idsPropositions?: Record<string, string>; idsLignes?: Record<string, string>;
  erreurComptes?: string;
};

/** Calcule les écritures d'une synchronisation, sans accès à la base ni à Powens. */
export function planifier(etat: Etat, d: Donnees) {
  const { userId: user_id, maintenant, aujourdhui } = d;
  const auto = { source_auto: "powens", source_auto_le: maintenant };
  const plan = {
    connexion: null as any, comptes: [] as any[], comptesInactifs: [] as any[], instruments: [] as any[], positionsCreer: [] as any[],
    // auto : ligne de marché tenue par la synchronisation, écrite seulement si source_auto = 'powens'
    positionsMaj: [] as { id: string; patch: Record<string, unknown>; auto?: boolean }[], placements: [] as any[], placementsSupprimer: [] as any[],
    creditsMaj: [] as { id: string; crd: number }[], operations: [] as any[], operationsSupprimer: [] as any[], propositions: [] as any[],
    rattachements: [] as { id: number; position_id: string }[], comptesProposes: [] as number[],
    moisDepuis: null as string | null, erreurs: [] as { compte_id?: number; erreur: string }[],
  };
  const existants = new Map(etat.comptes.map((c) => [String(c.id), c]));
  const etablissement = texte(d.connexion?.connector?.name);

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

  let plusAncien: string | null = null;
  const touche = (date: string) => { if (!plusAncien || date < plusAncien) plusAncien = date; };

  for (const l of d.comptes) {
    const c = l.compte;
    const id = Number(c.id);
    const type = normaliserType(c);
    const actif = !c.disabled && !c.deleted;
    const solde = nombre(c.balance);
    const nom = nettoyerLibelle(c.name ?? c.original_name) || "Compte";
    plan.comptes.push({
      user_id, id, connexion_id: Number(d.connexion.id), nom, type, debit_differe: String(c.type ?? "").toLowerCase() === "card", solde,
      devise: texte(c.currency?.id) ?? texte(c.currency) ?? "EUR", solde_le: jour(c.last_update) ?? aujourdhui, actif, maj_le: maintenant,
    });
    const r = existants.get(String(id)) ?? {};
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
      const presents = new Set<string>();
      for (const inv of l.placements) {
        if (inv?.id == null || inv.deleted) continue;
        presents.add(String(inv.id));
        const isin = isinDe(inv);
        const libelle = nettoyerLibelle(inv.label) || isin || "Placement";
        const qte = nombre(inv.quantity);
        const ancien = anciens.find((p) => String(p.id) === String(inv.id));
        let lien: string | null = texte(ancien?.position_id);
        let creeeLe: string | null = texte(ancien?.ligne_creee_le);
        if (enveloppe && actif && isin) {
          if (lien) plan.positionsMaj.push({ id: lien, patch: { qty: qte, isin, ...auto }, auto: true });
          else if (!creeeLe) { // ligne déjà créée puis supprimée par l'utilisateur : jamais recréée
            lien = d.idsLignes?.[String(inv.id)] ?? null;
            if (lien) {
              creeeLe = maintenant;
              plan.instruments.push({ isin, name: libelle, requested_by: user_id });
              plan.positionsCreer.push({ id: lien, user_id, name: libelle, envelope: enveloppe, owner: titulaire, bloc: "", mode: "market",
                isin, qty: qte, status: "actif", ...auto });
            }
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
      if (!ignore && !r.propose_le && !positionId && !enveloppe && !texte(r.credit_id) && type !== "credit" && lot && idProp && !etat.lotsExistants.includes(lot)) {
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
    rattaches: 0, sautee: false, erreurs: [] as { compte_id?: number; erreur: string }[], notes: [] as string[] };

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
  let etatComptes: any[] = [];
  try {
    etatComptes = await lireTable(db.from("banque_comptes").select("id, actif, type, position_id, enveloppe, titulaire, credit_id, ignore, propose_le")
      .eq("user_id", userId).eq("connexion_id", connexionId), "des comptes");
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

  const ids = [...new Set([...etatComptes.map((c) => Number(c.id)), ...comptes.map((c) => Number(c.id))])];
  let placements: any[] = [], propositions: any[] = [];
  const lots: Record<string, string> = {}, idsPropositions: Record<string, string> = {}, idsLignes: Record<string, string> = {};
  for (const c of comptes) {
    lots[String(c.id)] = await lotProposition(userId, c.id);
    idsPropositions[String(c.id)] = await idProposition(userId, c.id);
  }
  for (const l of lectures) for (const inv of l.placements ?? []) if (inv?.id != null) idsLignes[String(inv.id)] = await idLigne(userId, inv.id);
  try {
    if (ids.length) {
      placements = await lireTable(db.from("banque_placements").select("id, compte_id, position_id, ligne_creee_le").eq("user_id", userId).in("compte_id", ids), "des placements");
    }
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

  const plan = planifier({ comptes: etatComptes, placements, lotsExistants, acceptes }, {
    userId, connexion, comptes: lectures, lectureComptesOk, erreurComptes, maintenant: maintenant.toISOString(), aujourdhui, minDate, lots,
    idsPropositions, idsLignes,
  });
  rapport.erreurs.push(...plan.erreurs);
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
  for (const m of plan.positionsMaj) {
    await etape("mise à jour d'une ligne", () => {
      const q = db.from("positions").update(m.patch).eq("user_id", userId).eq("id", m.id);
      return m.auto ? q.eq("source_auto", "powens") : q;
    });
  }
  // Un lien vers une ligne non créée (échec ci-dessus) n'est pas enregistré : la ligne sera recréée au prochain passage.
  const placementsOk = plan.placements.map((p) => (p.position_id && plan.positionsCreer.some((c) => c.id === p.position_id) && !creees.has(p.position_id)
    ? { ...p, position_id: null, ligne_creee_le: null } : p));
  if (placementsOk.length) await etape("placements", () => db.from("banque_placements").upsert(placementsOk, { onConflict: "user_id,id" }));
  if (plan.placementsSupprimer.length) {
    await etape("placements disparus", () => db.from("banque_placements").delete().eq("user_id", userId).in("id", plan.placementsSupprimer));
  }
  for (const c of plan.creditsMaj) {
    await etape("mise à jour du crédit", () => db.from("credits").update({ crd: c.crd }).eq("user_id", userId).eq("id", c.id));
  }
  for (const paquet of parPaquets(plan.operations)) {
    if (await etape("opérations", () => db.from("banque_operations").upsert(paquet, { onConflict: "user_id,id" }))) rapport.operations += paquet.length;
  }
  if (plan.operationsSupprimer.length) {
    await etape("opérations retirées", () => db.from("banque_operations").delete().eq("user_id", userId).in("id", plan.operationsSupprimer));
  }
  if (plan.moisDepuis) {
    await etape("totaux mensuels", () => db.rpc("banque_recalculer_mois", { p_user: userId, p_depuis: plan.moisDepuis }));
  }
  if (plan.propositions.length && await etape("propositions",
    () => db.from("propositions").upsert(plan.propositions, { onConflict: "id", ignoreDuplicates: true }))) {
    rapport.propositions = plan.propositions.length;
    await etape("trace des propositions", () => db.from("banque_comptes").update({ propose_le: maintenant.toISOString() })
      .eq("user_id", userId).in("id", plan.comptesProposes));
  }
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
