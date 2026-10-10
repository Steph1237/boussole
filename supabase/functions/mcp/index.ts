// Boussole : serveur MCP (Streamable HTTP, sans état) authentifié par Supabase Auth (OAuth 2.1).
//
// Déploiement : verify_jwt = false. La passerelle Supabase ne vérifie donc pas le jeton :
// c'est ce serveur qui le fait (auth.getUser), afin de pouvoir répondre 401 avec l'en-tête
// WWW-Authenticate attendu par les clients MCP pour découvrir le serveur d'autorisation, et
// de servir /.well-known/oauth-protected-resource sans jeton.
//
// Isolation : chaque requête crée un client Supabase portant le JWT de l'utilisateur ; toutes les
// lectures et écritures passent par lui, donc RLS (user_id = auth.uid()) s'applique. Aucune clé
// de service n'est utilisée ici.
//
// Écritures (entretien guidé, docs/superpowers/specs/2026-10-10-entretien-guide.md) : les outils d'écriture ne touchent
// aucune table du bilan ; ils déposent des lignes dans `propositions` (avant / après, source obligatoire), que l'utilisateur
// valide dans l'application (RPC appliquer_propositions, security invoker). Exceptions : annotate_instrument (donnée
// publique du fonds, RPC annoter_instrument) et update_config limité aux préférences sans montant (cibles en %, règles,
// ordres, échéances, hypothèses).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

z.config(z.locales.fr());

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://oapcewpqsbbjdlcdeizi.supabase.co";
// Clé publiable (celle de web/config.js, publique par nature) : sert uniquement d'apikey ; l'identité vient
// du JWT utilisateur. Préférée à SUPABASE_ANON_KEY (clé héritée, désactivable dans le dashboard).
const SUPABASE_ANON_KEY = Deno.env.get("BOUSSOLE_PUBLISHABLE_KEY") ?? "sb_publishable_o5IJJ2Cf6xf6sPCEWHLZag_b9HefoZ_";

const RESOURCE = "https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/mcp";
const RESOURCE_METADATA_URL = `${RESOURCE}/.well-known/oauth-protected-resource`;
const WWW_AUTHENTICATE = `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`;
const PROTECTED_RESOURCE = {
  resource: RESOURCE,
  authorization_servers: ["https://oapcewpqsbbjdlcdeizi.supabase.co/auth/v1"],
  bearer_methods_supported: ["header"],
  resource_name: "Boussole",
};

// Point d'injection pour les tests locaux (client Supabase factice) ; inchangé en production.
export const deps = { createClient: createClient as (...a: any[]) => any };

const INSTRUCTIONS = [
  "Boussole est l'outil de suivi de patrimoine de l'utilisateur : placements (positions), immobilier (biens), crédits, profil du foyer (revenus, statut, tranche d'imposition), budget, objectifs, profil de risque et protection.",
  "Tous les montants sont en euros. Les dates sont au format AAAA-MM-JJ.",
  "p1 et p2 désignent les personnes du foyer dont les prénoms figurent dans le profil (get_profile, champ personnes) ; « foyer » est leur ensemble. Utilise leurs prénoms quand tu parles à l'utilisateur.",
  "Claude propose, l'utilisateur dispose : les outils d'écriture (update_profile, upsert_biens, upsert_credits, delete_bien, delete_credit, upsert_positions, record_transaction, update_budget, upsert_objectifs, delete_objectif, set_risk_answers, set_protection) n'écrivent rien directement. Ils déposent des propositions (avant / après, source, justification) que l'utilisateur valide, modifie ou refuse dans Boussole › Profil et données › Propositions. Dis-le à l'utilisateur après chaque dépôt.",
  "Chaque dépôt exige source : d'où vient le chiffre (« Relevé PEA du 30/09 collé par l'utilisateur », « Dit par l'utilisateur », « Avis d'imposition 2026 »…). Ajoute une justification d'une phrase si elle aide. Regroupe un entretien dans un seul lot : réutilise l'identifiant lot renvoyé par le premier dépôt.",
  "Entretien : commence par etat_du_bilan (ce qui manque, dans l'ordre, avec le pourquoi) et list_propositions (ce qui attend déjà une validation). Ne repose jamais une question déjà répondue ; une question à la fois, en français simple, avec son pourquoi en une phrase. Des parcours prêts à l'emploi existent (prompts bilan_complet, profil_de_risque, budget, placements, revue_mensuelle).",
  "L'utilisateur peut coller un relevé (banque, PEA, assurance-vie, tableau d'amortissement) : extrais-en les chiffres, cite le document et sa date. N'invente jamais un chiffre : si une information manque ou est ambiguë, demande-la. Pour un titre coté, l'ISIN et la quantité suffisent : le cours est mis à jour chaque nuit. Récapitule avant de proposer.",
  "Budget mensuel (get_budget, update_budget) : lignes de revenus, dépenses par catégorie et épargne, par mois ou par an. Le salaire et les mensualités de crédit viennent du profil : ne les ajoute pas au budget. update_budget fusionne par défaut (rapprochement par id ou par libellé).",
  "Objectifs datés (list_objectifs, upsert_objectifs, delete_objectif) : apport, matelas, retraite ou projet, avec cible, échéance, montant déjà réuni (saisi ou poches rattachées), rendement attendu et priorité ; list_objectifs calcule l'effort mensuel requis et le statut.",
  "Réglages (get_config, update_config) : update_config modifie directement les seules préférences sans montant du bilan (cibles d'allocation en %, règles d'alerte, ordres à passer, échéances, hypothèses) ; le matelas de sécurité et les versements programmés se règlent dans Boussole.",
  "get_overview inclut un score de santé financière sur 100 (matelas, taux d'épargne, endettement, diversification, patrimoine net selon l'âge), les bonnes pratiques notées (Sécurité, Effort, Allocation, Efficacité ; chaque critère avec sa règle, sa source et une piste) et le profil de risque : ce sont des indicateurs pédagogiques, pas un conseil en investissement ; présente-les comme tels.",
  "Profil de risque (get_risk_profile, set_risk_answers) : questionnaire de l'application (Prudent, Modéré, Équilibré, Dynamique, Offensif), allocation réelle par classe comparée aux fourchettes du profil, profil équivalent du portefeuille réel. Pose les questions et enregistre avec set_risk_answers les seules réponses choisies par l'utilisateur, jamais une réponse déduite ; le profil est calculé par l'application. Parle de classes d'actifs et de comportements, jamais de produits à acheter.",
  "Protection (set_protection) : prévoyance et assurance emprunteur déclarées par l'utilisateur.",
  "Frais, zone et devise des fonds (annotate_instrument, seule écriture directe : donnée publique du fonds, non personnelle) : renseigne-les seulement pour un fonds détenu, à partir d'une source consultée (document d'informations clés / DIC-KID, page officielle de l'émetteur), citée dans source (URL ou référence du document). Source obligatoire ; n'invente jamais un TER ni une zone : sans source fiable, ne renseigne rien et dis-le. Le TER s'exprime en % par an (0.2 pour 0,20 %).",
].join("\n");

/* Parcours d'entretien (prompts MCP) : une conduite commune et un objectif par parcours. */
const CONDUITE = [
  "Conduite de l'entretien :",
  "1. Commence par appeler etat_du_bilan et list_propositions : ne repose jamais une question déjà répondue ni un changement déjà proposé.",
  "2. Pose UNE seule question à la fois, en français simple, et explique en une phrase pourquoi elle compte (le « pourquoi » d'etat_du_bilan t'y aide).",
  "3. J'ai le droit de coller un relevé (banque, PEA, assurance-vie, PER, tableau d'amortissement, avis d'imposition) : extrais-en les chiffres, cite le document et sa date, et signale ce qui est illisible ou ambigu.",
  "4. N'invente jamais un chiffre : si une valeur manque, demande-la ; ne présente jamais une estimation comme un fait.",
  "5. Avant de proposer, récapitule ce que tu as compris (valeurs, dates, titulaires) et attends ma confirmation.",
  "6. Enregistre avec les outils d'écriture en renseignant toujours source (« Relevé PEA du 30/09 collé par l'utilisateur », « Dit par l'utilisateur »…) et, si utile, une justification d'une phrase. Tout l'entretien forme un seul lot : garde l'identifiant lot renvoyé par le premier dépôt et passe-le aux appels suivants.",
  "7. Rappelle-moi que rien n'est appliqué tant que je n'ai pas validé les propositions dans Boussole › Profil et données › Propositions (je peux y corriger une valeur avant de valider).",
  "8. Reste pédagogique : explique les notions (tranche d'imposition, matelas de précaution, PER, profil de risque…) sans jargon ; aucune recommandation de produit, ni d'achat ou de vente ; ce n'est pas un conseil en investissement.",
  "9. Termine par un court résumé : ce qui a été proposé, ce qui reste à compléter et la prochaine étape.",
].join("\n");

const PARCOURS = [
  { nom: "bilan_complet", titre: "Faire mon bilan patrimonial complet",
    description: "Entretien guidé de bout en bout : foyer, revenus, budget, placements, immobilier et crédits, protection, objectifs, profil de risque.",
    objectif: "Je veux faire mon bilan patrimonial complet avec Boussole. Suis les sections dans l'ordre d'etat_du_bilan (foyer, revenus, budget, épargne et placements, immobilier et crédits, protection, objectifs, profil de risque) en partant des « prochaines questions ». À la fin de chaque section, récapitule, dépose les propositions de la section, puis donne-moi l'avancement (pourcentage) avant de passer à la suivante." },
  { nom: "profil_de_risque", titre: "Établir mon profil de risque",
    description: "Les 10 questions du profil de risque, une à une, avec leurs réponses possibles en clair.",
    objectif: "Je veux établir mon profil de risque. Pose les questions manquantes du questionnaire (section « Profil de risque » d'etat_du_bilan) une à une, avec les réponses possibles en clair (pas les codes) et une phrase d'explication. Reformule ma réponse, puis enregistre mes choix avec set_risk_answers (codes des valeurs). Ne déduis jamais une réponse à ma place. Après validation dans Boussole, le profil est calculé par l'application ; tu pourras le commenter avec get_risk_profile, sans recommander de produit." },
  { nom: "budget", titre: "Établir mon budget mensuel",
    description: "Dépenses par catégorie et épargne mensuelle, à partir de mes réponses ou d'un relevé bancaire collé.",
    objectif: "Je veux établir mon budget mensuel. Lis d'abord get_budget. Demande mes dépenses par grande catégorie (logement, alimentation, transport, enfants, santé, loisirs, abonnements, impôts, divers), puis ce que je mets de côté chaque mois et où. Si je colle un relevé bancaire, regroupe les opérations récurrentes par catégorie et montre-moi le regroupement avant de proposer. N'ajoute ni salaire ni mensualités de crédit (ils viennent du profil). Dépose avec update_budget (mode fusionner)." },
  { nom: "placements", titre: "Mettre à jour mes placements",
    description: "Recenser comptes et placements avec des montants datés de moins de 90 jours.",
    objectif: "Je veux recenser et mettre à jour mes placements. Lis list_positions. Pour chaque enveloppe (livrets, PEA, assurance-vie, PER, compte-titres, crypto…), demande le relevé ou le solde avec sa date ; pour un titre coté, l'ISIN et la quantité suffisent. Dépose avec upsert_positions (ou record_transaction pour un achat, une vente, un versement). Signale les montants de plus de 90 jours. Pour les frais d'un fonds, n'utilise annotate_instrument qu'avec une source consultée." },
  { nom: "revue_mensuelle", titre: "Faire ma revue mensuelle",
    description: "Rafraîchir les soldes anciens, vérifier la dérive du budget, puis la vue d'ensemble.",
    objectif: "Je veux faire ma revue mensuelle. 1) Appelle etat_du_bilan et list_propositions. 2) Rafraîchis les soldes de plus de 90 jours (question de fraîcheur de la section placements) : demande un relevé ou le solde de chacun et dépose avec upsert_positions. 3) Vérifie la dérive du budget : compare get_budget à mes dépenses réelles du mois (je peux coller un relevé) et propose les ajustements avec update_budget. 4) Termine par get_overview : patrimoine net, score de santé et bonnes pratiques, présentés comme des indicateurs pédagogiques, et rappelle-moi les propositions à valider." },
].map(({ objectif, ...p }: any) => ({ ...p, texte: objectif + "\n\n" + CONDUITE }));

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

const num = (v: unknown) => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? 0 : Number(v));
const pos = (v: unknown) => Math.max(0, num(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const sum = <T>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STALE_DAYS = 4;

function today(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

class UserError extends Error {}
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

function dbMessage(table: string, error: any): string {
  const code = error?.code ?? "";
  if (code === "42501") return `Accès refusé à ${table}.`;
  if (code === "23514") return `Valeur refusée par la base pour ${table} (contrainte non respectée) : ${error.message}`;
  if (code === "23503") return `Référence inconnue pour ${table} : ${error.message}`;
  if (code === "22P02") return `Format invalide pour ${table} : ${error.message}`;
  return `Erreur base de données (${table}) : ${error?.message ?? "inconnue"}`;
}
function must<T>(table: string, res: { data: T; error: any }): T {
  if (res.error) throw new UserError(dbMessage(table, res.error));
  return res.data;
}
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Différences champ par champ (deux niveaux de profondeur) entre deux objets. */
function diff(before: any, after: any, prefix = "", depth = 2): { champ: string; avant: unknown; apres: unknown }[] {
  const out: { champ: string; avant: unknown; apres: unknown }[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    const a = before?.[k], b = after?.[k];
    if (same(a, b)) continue;
    const isObj = (v: unknown) => v && typeof v === "object" && !Array.isArray(v);
    if (depth > 1 && (isObj(a) || isObj(b))) out.push(...diff(a ?? {}, b ?? {}, prefix + k + ".", depth - 1));
    else out.push({ champ: prefix + k, avant: a ?? null, apres: b ?? null });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Valorisation (mêmes règles que web/src/calc.js : val, counted, part) */
/* ------------------------------------------------------------------ */

const POS_SELECT = "*, instrument:instruments(name, symbol, currency, price, price_date, ter, zone, devise, annote_source, annote_le)";

function effectivePrice(p: any): number | null {
  if (p.price_override != null) return Number(p.price_override);
  if (p.instrument?.price != null) return Number(p.instrument.price);
  return null;
}
function val(p: any): number {
  const price = effectivePrice(p);
  if (p.mode === "market" && p.qty != null && price != null) return Number(p.qty) * price;
  return num(p.value);
}
const counted = (p: any) => p.status !== "à recevoir" && p.status !== "clôturé";
const inScope = (owner: string, scope: string) => scope === "foyer" || owner === scope;
function partBien(scope: string, partP1: unknown): number {
  const s = Math.min(100, Math.max(0, partP1 == null ? 100 : num(partP1))) / 100;
  return scope === "foyer" ? 1 : scope === "p1" ? s : 1 - s;
}
function partCredit(scope: string, owner: string): number {
  if (scope === "foyer") return 1;
  if (owner === "commun") return 0.5;
  return owner === scope ? 1 : 0;
}
/** Taux brut → net : 0,75 cadre, 0,78 non-cadre. */
function salaireNetMensuel(p: any): number {
  if (!p) return 0;
  const v = pos(p.salaire), rate = p.statut === "cadre" ? 0.75 : 0.78;
  switch (p.salaireUnite) {
    case "na": return v / 12;
    case "bm": return v * rate;
    case "ba": return (v * rate) / 12;
    default: return v;
  }
}
function isStale(p: any, ref: string): boolean {
  if (p.mode !== "market" || !counted(p) || p.price_override != null) return false;
  const d = p.instrument?.price_date;
  return p.instrument?.price == null || !d || daysBetween(String(d).slice(0, 10), ref) > STALE_DAYS;
}
function viewPosition(p: any) {
  const price = effectivePrice(p);
  return clean({
    id: p.id, nom: p.name, isin: p.isin, enveloppe: p.envelope, titulaire: p.owner, poche: p.bloc, mode: p.mode, statut: p.status,
    quantite: p.mode === "market" ? p.qty : undefined, pru: p.mode === "market" ? p.pru : undefined,
    cours: p.mode === "market" ? price : undefined,
    cours_source: p.mode === "market" ? (p.price_override != null ? "manuel" : price != null ? "automatique" : "en attente") : undefined,
    cours_date: p.mode === "market" && p.price_override == null ? p.instrument?.price_date : undefined,
    instrument: p.instrument?.name ?? undefined,
    valeur: r2(val(p)),
    valeur_date: p.mode === "manual" ? p.value_date : undefined,
    quantite_estimee: p.qty_estimated || undefined,
    note: p.note || undefined,
    frais_courants_pct: p.instrument?.ter != null ? Number(p.instrument.ter) : undefined,
    zone: p.instrument?.zone ?? undefined,
    devise_exposition: p.instrument?.devise ?? undefined,
    annotation_source: p.instrument?.annote_source ?? undefined,
    annotation_date: p.instrument?.annote_le ?? undefined,
  });
}

/* ------------------------------------------------------------------ */
/* Plan : budget, objectifs, score de santé (port de web/src/plan.js)  */
/* Mêmes formules et mêmes seuils que plan.js ; test/sante.test.mjs     */
/* vérifie que les barèmes du score sont identiques des deux côtés.     */
/* ------------------------------------------------------------------ */

type Donnees = { profil: any; biens: any[]; credits: any[]; positions: any[]; config: any; lignes: any[] };

const EPS = 1e-9;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const scopeKeys = (scope: string) => (scope === "foyer" ? ["p1", "p2"] : [scope]);
/** Repère de patrimoine net, en années de revenus, par tranche d'âge (identique à plan.js). */
const REPERES_AGE: Record<string, number> = { u30: 0.5, a30: 1, a40: 3, a50: 6, a60: 8, a70: 10 };

/** Bilan d'un périmètre (mêmes règles que Calc.patrimoine, Calc.revenusFoyer et Calc.mensualites). */
function bilan(d: Donnees, scope: string) {
  const P = d.profil?.personnes ?? {}, A = d.profil?.autres ?? {};
  const mine = d.positions.filter((p) => inScope(p.owner, scope));
  const financier = sum(mine.filter(counted), val);
  const aRecevoir = sum(mine.filter((p) => p.status === "à recevoir"), val);
  const immobilier = sum(d.biens, (b) => pos(b.valeur) * partBien(scope, b.part_p1));
  const keys = scopeKeys(scope);
  const usage = sum(keys, (k) => pos(A[k]?.usage)), entreprise = sum(keys, (k) => pos(A[k]?.entreprise));
  const dettes = sum(d.biens, (b) => pos(b.crd) * partBien(scope, b.part_p1)) + sum(d.credits, (c) => pos(c.crd) * partCredit(scope, c.owner));
  const mensualites = sum(d.biens, (b) => pos(b.mensualite) * partBien(scope, b.part_p1)) + sum(d.credits, (c) => pos(c.mensualite) * partCredit(scope, c.owner));
  const salaires = sum(keys, (k) => salaireNetMensuel(P[k]));
  const autresRevenus = sum(keys, (k) => pos(P[k]?.autresRevenus));
  const loyers = sum(d.biens, (b) => pos(b.loyer) * partBien(scope, b.part_p1));
  const brut = financier + immobilier + usage + entreprise;
  return { financier, aRecevoir, immobilier, usage, entreprise, dettes, mensualites, salaires, autresRevenus, loyers,
    revenus: salaires + autresRevenus + loyers, brut, net: brut - dettes };
}

/** Montant mensuel d'une ligne de budget (fréquence « an » ramenée au mois). */
function mensuel(l: any): number {
  const m = pos(l?.montant);
  return l?.frequence === "an" ? m / 12 : m;
}
/* Part d'une ligne de budget dans le périmètre : sans titulaire = commun (moitié pour p1 / p2). */
const partLigne = (l: any, scope: string) => partCredit(scope, l?.owner === "p1" || l?.owner === "p2" ? l.owner : "commun");

/** Totaux mensuels du budget (port de Plan.budgetTotaux) : revenus (profil + lignes), dépenses (lignes + mensualités), épargne, reste. */
function budgetTotaux(d: Donnees, scope: string) {
  const L = (Array.isArray(d.lignes) ? d.lignes : []).filter(Boolean);
  const de = (type: string) => L.filter((l) => l.type === type);
  const m = (l: any) => mensuel(l) * partLigne(l, scope);
  const b = bilan(d, scope);
  const revenusProfil = b.revenus;
  const revenusLignes = sum(de("revenu"), m);
  const depensesLignes = sum(de("depense"), m);
  const mensualites = b.mensualites;
  const epargne = sum(de("epargne"), m);
  const revenus = revenusProfil + revenusLignes;
  const depenses = depensesLignes + mensualites;
  const reste = revenus - depenses - epargne;
  const parCategorie: Record<string, number> = {};
  de("depense").forEach((l) => {
    const c = l.categorie || "Autres";
    parCategorie[c] = (parCategorie[c] || 0) + m(l);
  });
  if (mensualites > 0) parCategorie["Crédits"] = (parCategorie["Crédits"] || 0) + mensualites;
  return {
    revenusProfil, revenusLignes, revenus, depensesLignes, mensualites, depenses, epargne, reste,
    tauxEpargne: revenus > 0 ? (epargne + Math.max(0, reste)) / revenus : null,
    parCategorie,
  };
}
type Totaux = ReturnType<typeof budgetTotaux>;
const viewTotaux = (t: Totaux) => ({
  revenus_profil: r2(t.revenusProfil), revenus_lignes: r2(t.revenusLignes), revenus: r2(t.revenus),
  depenses_lignes: r2(t.depensesLignes), mensualites_credits: r2(t.mensualites), depenses: r2(t.depenses),
  epargne: r2(t.epargne), reste: r2(t.reste),
  taux_epargne: t.tauxEpargne == null ? null : Math.round(t.tauxEpargne * 10000) / 10000,
  par_categorie: Object.fromEntries(Object.entries(t.parCategorie).map(([k, v]) => [k, r2(v)])),
});

/* ---------- dates (AAAA-MM-JJ, sans fuseau) ---------- */
function ymd(s: string) {
  const p = String(s).slice(0, 10).split("-").map(Number);
  return { y: p[0], m: (p[1] || 1) - 1, d: p[2] || 1 };
}
const dernierJour = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const isoUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const tauxMensuel = (tauxAnnuel: unknown) => Math.pow(1 + num(tauxAnnuel) / 100, 1 / 12) - 1;

/** Versement constant de fin de mois pour passer de « deja » à « cible » en « mois » mois (formule d'annuité). */
function effortMensuel(cible: number, deja: number, mois: number, tauxAnnuel: unknown): number {
  const c = num(cible), d = num(deja), k = Math.floor(num(mois));
  if (k <= 0) return c > d ? Infinity : 0;
  const r = tauxMensuel(tauxAnnuel);
  if (Math.abs(r) < EPS) return Math.max(0, (c - d) / k);
  const f = Math.pow(1 + r, k);
  return Math.max(0, (c - d * f) * r / (f - 1));
}
/** Nombre de mois entiers entre deux dates (jamais négatif ; fin de mois = mois complet). */
function moisEntre(a0: string, b0: string): number {
  const a = ymd(a0), b = ymd(b0);
  let k = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d && b.d < dernierJour(b.y, b.m)) k -= 1;
  return Math.max(0, k);
}
/** Fin du mois où la cible est atteinte au rythme donné ; date de départ si déjà atteinte ; null au-delà de 60 ans. */
function dateAtteinte(cible: number, deja: number, versement: number, tauxAnnuel: unknown, depuis: string): string | null {
  const c = num(cible), v = num(versement), r = tauxMensuel(tauxAnnuel), t = ymd(depuis);
  let x = num(deja);
  if (x >= c - EPS) return isoUTC(t.y, t.m, t.d);
  for (let k = 1; k <= 720; k++) {
    x = x * (1 + r) + v;
    if (x >= c - 1e-6) return isoUTC(t.y, t.m + k, dernierJour(t.y, t.m + k));
  }
  return null;
}
const dateCible = (o: any): string | null => o.date_cible || o.dateCible || null;
const prioriteDe = (o: any) => (o.priorite ?? Infinity) as number;

/** Répartit l'argent des poches entre objectifs, en cascade par priorité (port de Plan.affecterDeja). */
function affecterDeja(objectifs: any[], positions: any[], scope = "foyer"): Record<string, number> {
  const reste = positions.filter((p) => inScope(p.owner, scope) && counted(p)).map((p) => ({ p, v: val(p) }));
  const ordre = objectifs.slice().sort((a, b) =>
    (prioriteDe(a) - prioriteDe(b)) || String(dateCible(a) || "9999").localeCompare(String(dateCible(b) || "9999")));
  const out: Record<string, number> = {};
  ordre.forEach((o) => {
    if (o.source !== "poches") { out[o.id] = pos(o.deja); return; }
    const poches = Array.isArray(o.poches) ? o.poches : [], env = Array.isArray(o.enveloppes) ? o.enveloppes : [];
    let besoin = pos(o.cible), pris = 0;
    reste.forEach((r) => {
      if (besoin <= 0 || r.v <= 0 || !(poches.includes(r.p.bloc) || env.includes(r.p.envelope))) return;
      const t = Math.min(r.v, besoin); r.v -= t; besoin -= t; pris += t;
    });
    out[o.id] = Math.round(pris * 100) / 100;
  });
  return out;
}

/** Répartit l'épargne mensuelle entre objectifs : priorité, puis échéance ; surplus au dernier objectif en cours (port de Plan.repartirEpargne). */
function repartirEpargne(objectifs: any[], deja: Record<string, number>, epargneMensuelle: number, ref: string): Record<string, number> {
  const cle = (o: any) => (dateCible(o) ? String(dateCible(o)).slice(0, 10) : "9999-12-31");
  const liste = objectifs.map((o, i) => {
    const dj = deja[o.id] ?? 0;
    const effort = dj >= pos(o.cible) || !dateCible(o) ? 0 : effortMensuel(pos(o.cible), dj, moisEntre(ref, dateCible(o)!), o.rendement);
    return { o, i, effort };
  }).sort((a, b) => (num(prioriteDe(a.o)) - num(prioriteDe(b.o))) || (cle(a.o) < cle(b.o) ? -1 : cle(a.o) > cle(b.o) ? 1 : 0) || a.i - b.i);
  const out: Record<string, number> = {};
  let reste = pos(epargneMensuelle);
  liste.forEach((x) => { const m = Math.min(x.effort, reste); out[x.o.id] = m; reste -= m; });
  if (reste > 0 && liste.length) {
    const enCours = liste.filter((x) => x.effort > 0);
    const l = enCours.length ? enCours : liste;
    out[l[l.length - 1].o.id] += reste;
  }
  return out;
}

/** Situation d'un objectif (port de Plan.statutObjectif) : progression, effort requis, date d'atteinte, statut. */
function statutObjectif(o: any, deja: number, versementAlloue: number, ref: string) {
  const cible = pos(o.cible), date = dateCible(o);
  const mois = date ? moisEntre(ref, date) : null;
  const effort = date ? effortMensuel(cible, deja, mois!, o.rendement) : 0;
  const atteinte = dateAtteinte(cible, deja, versementAlloue, o.rendement, ref);
  let statut: string;
  if (deja >= cible) statut = "atteint";
  else if (date && (date < ref || !isFinite(effort))) statut = "hors_portee";
  else if (!date) statut = atteinte ? "dans_les_temps" : "hors_portee";
  else if (effort <= 0 || versementAlloue >= 1.1 * effort - EPS) statut = "avance";
  else if (versementAlloue >= 0.95 * effort - EPS) statut = "dans_les_temps";
  else statut = "retard";
  return { progression: cible > 0 ? Math.min(1, deja / cible) : 1, mois, effort, atteinte, statut };
}
const STATUTS: Record<string, string> = { atteint: "atteint", avance: "en avance", dans_les_temps: "dans les temps", retard: "en retard", hors_portee: "hors de portée" };

/* ---------- score de santé (port de Plan.score : mêmes barèmes, mêmes textes) ---------- */
function interp(x: number, pts: number[][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}
function fr(x: number, dec = 1): string {
  const s = Math.abs(x).toFixed(dec).replace(/\.0+$/, "").replace(".", ",");
  return (x < 0 ? "\u2212" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
}
const pctFr = (x: number) => fr(x * 100, 0) + " %";

type Item = { cle: string; titre: string; cible: string; valeur: number | null; points?: number; aCompleter: boolean; texte: string; piste: string };

function itemMatelas(d: Donnees, scope: string, totaux: Totaux): Item {
  const epargne = sum(d.positions.filter((p) => inScope(p.owner, scope) && counted(p) && p.bloc === "Épargne"), val);
  const c = d.config?.cushion;
  const m = c && typeof c === "object" && c.mode === "months" ? { mode: "months", depenses: pos(c.depenses) } : null;
  const depenses = totaux.depensesLignes > 0 ? totaux.depenses : m && m.mode === "months" && m.depenses > 0 ? m.depenses : 0;
  const base = { cle: "matelas", titre: "Matelas de précaution", cible: "3 à 6 mois de dépenses" };
  if (depenses <= 0) return { ...base, valeur: null, aCompleter: true,
    texte: "Dépenses mensuelles inconnues.", piste: "Renseignez vos dépenses dans le budget pour mesurer votre réserve." };
  const mois = epargne / depenses;
  const points = mois < 1 ? 0 : mois < 3 ? interp(mois, [[1, 5], [3, 15]]) : mois <= 6 ? 20 : interp(mois, [[6, 20], [12, 15]]);
  const piste = mois < 3 ? "Visez 3 à 6 mois de dépenses sur une épargne disponible à tout moment, pour absorber un imprévu sans vendre ni emprunter."
    : mois <= 6 ? "Votre réserve couvre les imprévus courants : rien à changer de ce côté."
    : mois <= 12 ? "Au-delà de 6 mois, une partie de cette réserve pourrait être affectée à l'un de vos objectifs."
    : "Plus d'un an de dépenses dort sur des supports peu rémunérés : regardez si une partie peut servir vos objectifs.";
  return { ...base, valeur: mois, points, aCompleter: false, texte: fr(mois) + " mois de dépenses de côté.", piste };
}

function itemEpargne(totaux: Totaux): Item {
  const base = { cle: "epargne", titre: "Taux d'épargne", cible: "15 % des revenus ou plus" };
  if (!(totaux.revenus > 0) || (totaux.depensesLignes <= 0 && totaux.epargne <= 0)) return { ...base, valeur: null, aCompleter: true,
    texte: "Budget incomplet.", piste: "Renseignez vos revenus et vos dépenses dans le budget pour calculer votre taux d'épargne." };
  const t = totaux.tauxEpargne as number;
  const points = interp(t * 100, [[0, 0], [5, 6], [10, 12], [15, 16], [20, 20]]);
  const piste = t >= 0.15 ? "Vous êtes au-dessus du repère de 15 % : de quoi alimenter vos objectifs régulièrement."
    : "Le repère courant est de 15 % des revenus. Les postes les plus lourds du budget sont le premier endroit où regarder.";
  return { ...base, valeur: t, points, aCompleter: false, texte: "Vous mettez de côté " + pctFr(t) + " de vos revenus.", piste };
}

function itemEndettement(totaux: Totaux): Item {
  const base = { cle: "endettement", titre: "Taux d'endettement", cible: "35 % des revenus au plus" };
  if (!(totaux.revenus > 0)) return { ...base, valeur: null, aCompleter: true,
    texte: "Revenus inconnus.", piste: "Renseignez vos revenus dans le Profil ou le budget pour calculer votre taux d'endettement." };
  const t = totaux.mensualites / totaux.revenus;
  const points = interp(t * 100, [[25, 20], [35, 12], [45, 0]]);
  const texte = totaux.mensualites > 0 ? "Vos crédits représentent " + pctFr(t) + " de vos revenus." : "Aucune mensualité de crédit en cours.";
  const piste = t <= 0.35 ? "Vous restez sous le plafond de 35 % appliqué par les banques (norme HCSF)."
    : "Au-delà de 35 %, les banques prêtent difficilement (norme HCSF). Un remboursement anticipé ou une renégociation peuvent alléger la charge.";
  return { ...base, valeur: t, points, aCompleter: false, texte, piste };
}

function itemConcentration(d: Donnees, scope: string): Item {
  const base = { cle: "concentration", titre: "Diversification", cible: "aucune ligne au-delà de 20 %, au moins 3 poches" };
  const L = d.positions.filter((p) => inScope(p.owner, scope) && counted(p) && val(p) > 0);
  const F = sum(L, val);
  if (F <= 0) return { ...base, valeur: null, aCompleter: true,
    texte: "Aucun placement enregistré.", piste: "Ajoutez vos placements dans Bilan › Placements pour mesurer leur diversification." };
  const max = Math.max(...L.map(val)) / F;
  const nb = new Set(L.map((p) => p.bloc || "_autre")).size;
  const points = Math.max(0, interp(max * 100, [[10, 20], [20, 14], [40, 0]]) - (nb < 3 ? 5 : 0));
  const texte = "La plus grosse ligne pèse " + pctFr(max) + " du financier, réparti sur " + nb + (nb > 1 ? " poches." : " poche.");
  const piste = max <= 0.2 && nb >= 3 ? "Votre financier est bien réparti : aucune ligne ne domine."
    : "Repère : aucune ligne au-delà de 20 % du financier et au moins 3 poches, pour qu'un seul support ne pèse pas sur l'ensemble.";
  return { ...base, valeur: max, points, aCompleter: false, texte, piste };
}

function itemPatrimoine(d: Donnees, scope: string, totaux: Totaux): Item {
  const age = d.profil?.foyer?.age;
  const repere = REPERES_AGE[age];
  const base = { cle: "patrimoine", titre: "Patrimoine net", cible: repere ? fr(repere) + " année" + (repere > 1 ? "s" : "") + " de revenus" : "selon l'âge" };
  if (!repere) return { ...base, valeur: null, aCompleter: true,
    texte: "Âge non renseigné.", piste: "Indiquez votre tranche d'âge dans le Profil pour comparer votre patrimoine au repère." };
  if (!(totaux.revenus > 0)) return { ...base, valeur: null, aCompleter: true,
    texte: "Revenus inconnus.", piste: "Renseignez vos revenus dans le Profil pour situer votre patrimoine." };
  const net = bilan(d, scope).net;
  const annees = net / (totaux.revenus * 12);
  const points = clamp(annees / repere, 0, 1) * 20;
  const texte = "Patrimoine net : " + fr(Math.max(annees, 0)) + " année" + (annees >= 2 ? "s" : "") + " de revenus (repère à votre âge : " + fr(repere) + ").";
  const piste = annees >= repere ? "Vous êtes au niveau du repère de votre tranche d'âge."
    : "Le patrimoine se construit surtout par l'épargne régulière et le remboursement des crédits ; vos objectifs du Plan en donnent le rythme.";
  return { ...base, valeur: annees, points, aCompleter: false, texte, piste };
}

/** Score de santé sur 100 : cinq critères sur 20 ; les critères à compléter sont exclus et le total ramené sur 100. */
function scoreSante(d: Donnees, scope: string) {
  const totaux = budgetTotaux(d, scope);
  const items = [
    itemMatelas(d, scope, totaux),
    itemEpargne(totaux),
    itemEndettement(totaux),
    itemConcentration(d, scope),
    itemPatrimoine(d, scope, totaux),
  ].map((i) => ({ ...i, points: i.aCompleter ? 0 : Math.round(i.points ?? 0), sur: 20 }));
  const complets = items.filter((i) => !i.aCompleter);
  const total = complets.length ? Math.round(sum(complets, (i) => i.points) / (20 * complets.length) * 100) : 0;
  return {
    total, complet: complets.length === items.length, criteres_calcules: complets.length,
    items: items.map((i) => ({ cle: i.cle, titre: i.titre, points: i.points, sur: i.sur, a_completer: i.aCompleter,
      valeur: i.valeur == null ? null : Math.round(i.valeur * 1000) / 1000, cible: i.cible, texte: i.texte, piste: i.piste })),
    mention: "Indicateur pédagogique, pas un conseil en investissement.",
  };
}

/* ------------------------------------------------------------------ */
/* Diagnostic : profil de risque et risque réel du portefeuille        */
/* Port de web/src/risque.js (PROFILS, allocationReelle, ecarts,       */
/* risquePortefeuille, texte de synthese), web/src/marche.js (CLASSES : */
/* volatilité et pire baisse, corrélations, classeRisque) et           */
/* web/src/calc.js (classe d'une poche, liquidité d'une enveloppe).     */
/* Mêmes constantes et mêmes formules ; test/mcp.test.mjs vérifie la    */
/* parité des tables.                                                   */
/* ------------------------------------------------------------------ */

const sansAccent = (s: unknown) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Poche (libellé libre) → classe d'actifs (table de calc.js), surchargeable par profiles.classes. */
const CLASSES_POCHE: Record<string, string> = {
  monde: "actions", europe: "actions", asie: "actions", "nasdaq 2x": "actions", nasdaq: "actions", "convictions tech": "actions", convictions: "actions",
  actions: "actions", "etats-unis": "actions", usa: "actions", emergents: "actions", "small caps": "actions",
  obligations: "obligations", oblig: "obligations",
  scpi: "immobilier", immobilier: "immobilier", sci: "immobilier", opci: "immobilier",
  epargne: "monetaire", livrets: "monetaire", monetaire: "monetaire", cash: "monetaire", liquidites: "monetaire",
  protection: "fonds_euros", "fonds euros": "fonds_euros", "fonds euro": "fonds_euros",
  or: "or", "metaux precieux": "or", crypto: "crypto", cryptos: "crypto",
};
type Surcharge = Record<string, string> | null | undefined;
const surchargee = (bloc: unknown, s: Surcharge) => !!s && typeof s === "object" && Object.prototype.hasOwnProperty.call(s, String(bloc));
function classePoche(bloc: unknown, s: Surcharge): string {
  if (surchargee(bloc, s)) return (s as Record<string, string>)[String(bloc)];
  return CLASSES_POCHE[sansAccent(bloc)] || "autres";
}
/** Enveloppe → délai de disponibilité (calc.js : immediate, jours, semaines, bloque). */
function liquidite(envelope: unknown): string {
  const e = sansAccent(envelope);
  if (/\bper\b|perco|pee|retraite|scpi|immobilier/.test(e)) return "bloque";
  if (/livret|ldds|lep|compte|cash|especes|courant/.test(e)) return "immediate";
  if (/\bav\b|assurance|vie|capitalisation/.test(e)) return "semaines";
  return "jours";
}

/** Statistiques par classe (marche.js) : volatilité annuelle et pire baisse historique, en %. */
const CLASSES_RISQUE: Record<string, { label: string; volatilite: number; pireBaisse: number }> = {
  actions: { label: "Actions (monde développé)", volatilite: 15, pireBaisse: -55 },
  small_caps: { label: "Actions de petites entreprises (small caps)", volatilite: 20, pireBaisse: -60 },
  emergents: { label: "Actions des pays émergents", volatilite: 20, pireBaisse: -60 },
  levier: { label: "Produits à effet de levier (ETF ×2 quotidien)", volatilite: 45, pireBaisse: -85 },
  obligations: { label: "Obligations (zone euro)", volatilite: 5, pireBaisse: -17 },
  immobilier: { label: "Immobilier (SCPI, pierre)", volatilite: 6, pireBaisse: -20 },
  monetaire: { label: "Monétaire et livrets", volatilite: 0.5, pireBaisse: 0 },
  fonds_euros: { label: "Fonds euros", volatilite: 0.5, pireBaisse: 0 },
  or: { label: "Or", volatilite: 15, pireBaisse: -45 },
  crypto: { label: "Cryptoactifs", volatilite: 70, pireBaisse: -80 },
  autres: { label: "Autres (non classé)", volatilite: 12, pireBaisse: -35 },
};
/** Corrélations simplifiées (marche.js), symétriques ; monétaire et fonds euros : 0 avec tout. */
const PAIRES: Record<string, number> = {
  "actions|small_caps": 0.9, "actions|emergents": 0.85, "actions|levier": 0.9,
  "small_caps|emergents": 0.8, "small_caps|levier": 0.85, "emergents|levier": 0.8,
  "actions|obligations": 0.1, "small_caps|obligations": 0.1, "emergents|obligations": 0.1, "levier|obligations": 0.1,
  "actions|or": 0.1, "small_caps|or": 0.1, "emergents|or": 0.1, "levier|or": 0.1,
  "actions|crypto": 0.4, "small_caps|crypto": 0.4, "emergents|crypto": 0.4, "levier|crypto": 0.4,
  "actions|immobilier": 0.5, "small_caps|immobilier": 0.5, "emergents|immobilier": 0.5, "levier|immobilier": 0.5,
  "actions|autres": 0.5, "small_caps|autres": 0.5, "emergents|autres": 0.5, "levier|autres": 0.5,
  "obligations|immobilier": 0.3, "obligations|or": 0.2, "obligations|crypto": 0, "obligations|autres": 0.3,
  "immobilier|or": 0.1, "immobilier|crypto": 0.2, "immobilier|autres": 0.3,
  "or|crypto": 0.1, "or|autres": 0.1, "crypto|autres": 0.2,
};
function correlation(a: string, b: string): number {
  if (a === b) return 1;
  const v = PAIRES[a + "|" + b];
  if (v != null) return v;
  const w = PAIRES[b + "|" + a];
  return w != null ? w : 0;
}
const LEVIER = /(^|[^a-z0-9])([23] ?[x×]|[x×] ?[23])([^a-z0-9]|$)|levier|leverag/;
const SMALL = /small ?caps?|petites? cap|russell 2000/;
const EMERG = /emergent|emerging|\bem\b|msci em\b/;
/** Classe de risque d'une ligne (Marche.classeRisque) : levier d'après le nom (prioritaire) ou la poche non surchargée,
    sinon la classe de la poche, affinée en small caps / émergents pour les actions. */
function classeRisque(p: any, s: Surcharge): string {
  const bloc = p.bloc, nom = sansAccent(p.name), poche = sansAccent(bloc);
  if (LEVIER.test(nom)) return "levier";
  const sur = surchargee(bloc, s);
  if (!sur && LEVIER.test(poche)) return "levier";
  const base = classePoche(bloc, s);
  if (sur && CLASSES_RISQUE[base] && base !== "actions") return base;
  if (base === "actions") {
    const txt = poche + " " + nom;
    if (SMALL.test(txt)) return "small_caps";
    if (EMERG.test(txt)) return "emergents";
  }
  return CLASSES_RISQUE[base] ? base : "autres";
}

/** Profils (risque.js) : allocation cible indicative en % (bornes incluses) et perte maximale tolérée sur un an. */
const PROFILS = [
  { id: "prudent", label: "Prudent", perteMax: 5,
    description: "Vous privilégiez la sécurité : l'essentiel reste sur des supports sans risque de perte, une petite part cherche un peu de rendement.",
    cibles: { actions: [10, 20], obligations: [20, 30], securise: [50, 70], immobilier: [0, 10], speculatif: [0, 0] } },
  { id: "modere", label: "Modéré", perteMax: 12,
    description: "Vous acceptez de petites variations pour un rendement un peu meilleur, avec une base sécurisée importante.",
    cibles: { actions: [25, 40], obligations: [20, 30], securise: [30, 45], immobilier: [5, 15], speculatif: [0, 2] } },
  { id: "equilibre", label: "Équilibré", perteMax: 20,
    description: "Vous cherchez un compromis : environ la moitié en actions pour la croissance, le reste pour amortir les baisses.",
    cibles: { actions: [45, 60], obligations: [15, 25], securise: [15, 30], immobilier: [5, 15], speculatif: [0, 5] } },
  { id: "dynamique", label: "Dynamique", perteMax: 30,
    description: "Vous visez la croissance à long terme et acceptez des baisses marquées, le temps qu'elles soient rattrapées.",
    cibles: { actions: [60, 80], obligations: [5, 15], securise: [5, 15], immobilier: [5, 15], speculatif: [0, 7] } },
  { id: "offensif", label: "Offensif", perteMax: 40,
    description: "Vous recherchez le rendement maximal sur un horizon long et supportez de fortes baisses sans vendre.",
    cibles: { actions: [75, 95], obligations: [0, 10], securise: [0, 10], immobilier: [0, 10], speculatif: [0, 10] } },
] as { id: string; label: string; perteMax: number; description: string; cibles: Record<string, number[]> }[];
const rangProfil = (id: string) => PROFILS.findIndex((p) => p.id === id);
/** Profil déclaré : identifiant, libellé ou objet { id } (même tolérance que Pratiques.idProfil / ficheProfil). */
function ficheProfil(risque: any) {
  const v = risque && (risque.profil && typeof risque.profil === "object" ? risque.profil.id || risque.profil.cle : risque.profil);
  if (!v) return null;
  return PROFILS.find((p) => p.id === String(v)) || PROFILS.find((p) => sansAccent(p.id) === sansAccent(v) || sansAccent(p.label) === sansAccent(v)) || null;
}
const GROUPES = ["actions", "obligations", "securise", "immobilier", "speculatif"];
const GROUPES_LABELS: Record<string, string> = { actions: "Actions", obligations: "Obligations", securise: "Fonds euros et monétaire", immobilier: "Immobilier",
  speculatif: "Spéculatif (crypto, levier)", diversifiants: "Or et autres" };
const GROUPE_DE: Record<string, string> = { actions: "actions", small_caps: "actions", emergents: "actions", obligations: "obligations", monetaire: "securise",
  fonds_euros: "securise", immobilier: "immobilier", crypto: "speculatif", levier: "speculatif", or: "diversifiants", autres: "diversifiants" };

/** Montants par classe de risque, lignes comptées du périmètre (financier seul : sans résidence ni biens physiques). */
function montantsParClasse(positions: any[], scope: string, s: Surcharge): Record<string, number> {
  const out: Record<string, number> = {};
  positions.filter((p) => inScope(p.owner, scope) && counted(p)).forEach((p) => {
    const k = classeRisque(p, s);
    out[k] = (out[k] || 0) + val(p);
  });
  return out;
}
function allocationReelle(positions: any[], scope: string, s: Surcharge) {
  const parClasse = montantsParClasse(positions, scope, s);
  const montants: Record<string, number> = { actions: 0, obligations: 0, securise: 0, immobilier: 0, speculatif: 0, diversifiants: 0 };
  Object.keys(parClasse).forEach((k) => { montants[GROUPE_DE[k] || "diversifiants"] += parClasse[k]; });
  const total = sum(Object.keys(montants), (k) => montants[k]);
  const pct: Record<string, number> = {};
  Object.keys(montants).forEach((k) => { pct[k] = total > 0 ? montants[k] * 100 / total : 0; });
  return { total, montants, pct, parClasse };
}
/** σ = √(wᵀΣw), Σᵢⱼ = ρᵢⱼ σᵢ σⱼ ; baisse plausible = max(−100, min(−2,33 σ, ½ Σ wᵢ pire baisseᵢ)) ;
    profil équivalent = le moins risqué dont la perte tolérée couvre cette baisse, sinon Offensif. */
function risquePortefeuille(positions: any[], scope: string, s: Surcharge) {
  const parClasse = montantsParClasse(positions, scope, s);
  const cles = Object.keys(parClasse).filter((k) => parClasse[k] > 0);
  const total = sum(cles, (k) => parClasse[k]);
  if (!(total > 0)) return { volatilite: 0, baissePlausible: 0, pireBaisseHistorique: 0, profilEquivalent: null as string | null, contributions: [] as any[] };
  const w = cles.map((k) => parClasse[k] / total);
  const stat = (k: string) => CLASSES_RISQUE[k] || CLASSES_RISQUE.autres;
  const cov = (a: string, b: string) => correlation(a, b) * stat(a).volatilite * stat(b).volatilite;
  const sw = cles.map((a) => cles.reduce((acc, b, j) => acc + w[j] * cov(a, b), 0));
  const variance = cles.reduce((acc, _a, i) => acc + w[i] * sw[i], 0);
  const volatilite = Math.sqrt(Math.max(0, variance));
  const pireBaisseHistorique = cles.reduce((acc, k, i) => acc + w[i] * stat(k).pireBaisse, 0);
  const baissePlausible = Math.max(-100, Math.min(-2.33 * volatilite, 0.5 * pireBaisseHistorique));
  const perte = -baissePlausible;
  const eq = PROFILS.find((p) => p.perteMax + EPS >= perte);
  const contributions = cles.map((k, i) => ({ classe: k, poids: parClasse[k] * 100 / total, contributionPct: variance > 0 ? w[i] * sw[i] / variance * 100 : 0 }))
    .sort((a, b) => b.contributionPct - a.contributionPct || b.poids - a.poids);
  return { volatilite, baissePlausible, pireBaisseHistorique, profilEquivalent: eq ? eq.id : "offensif", contributions };
}
/** Écart par groupe : 0 dans la fourchette, réel − min en dessous, réel − max au-dessus (points de %). */
function ecarts(profilId: string, pct: Record<string, number>) {
  const p = PROFILS.find((x) => x.id === profilId);
  if (!p) return [];
  return GROUPES.map((g) => {
    const reel = num(pct[g]), [min, max] = p.cibles[g];
    const statut = reel < min - EPS ? "sous" : reel > max + EPS ? "au-dessus" : "dans";
    return { groupe: g, label: GROUPES_LABELS[g], reel, min, max, statut, ecartPts: statut === "sous" ? reel - min : statut === "au-dessus" ? reel - max : 0 };
  });
}
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Synthèse du profil de risque (Risque.synthese, sans le recalcul du questionnaire : le profil enregistré fait foi). */
function syntheseRisque(risque: any, positions: any[], scope: string, s: Surcharge) {
  const declare = ficheProfil(risque);
  const allocation = allocationReelle(positions, scope, s);
  const rp = risquePortefeuille(positions, scope, s);
  const equivalent = PROFILS.find((p) => p.id === rp.profilEquivalent) || null;
  const ecartNiveaux = declare && equivalent ? rangProfil(equivalent.id) - rangProfil(declare.id) : null;
  let texte: string;
  if (!equivalent) texte = "Aucun placement à analyser pour le moment.";
  else if (!declare) texte = "Votre portefeuille se comporte comme un profil " + equivalent.label + ". Répondez au questionnaire pour le comparer à votre profil.";
  else if (ecartNiveaux === 0) texte = "Votre portefeuille se comporte comme un profil " + equivalent.label + ", conforme à votre profil.";
  else texte = "Votre portefeuille se comporte comme un profil " + equivalent.label + ", alors que votre profil est " + declare.label + " : il prend " +
    ((ecartNiveaux as number) > 0 ? "plus de risque que vous ne le souhaitez." : "moins de risque que votre profil ne le permet.");
  return { declare, allocation, risque: rp, equivalent, ecartNiveaux, texte, ecarts: declare ? ecarts(declare.id, allocation.pct) : [] };
}

/* ------------------------------------------------------------------ */
/* Bonnes pratiques notées (port de web/src/pratiques.js)              */
/* Quatre familles (Sécurité 30, Effort 25, Allocation 30, Efficacité   */
/* 15), quatorze critères sur 20 ; mêmes règles, barèmes et textes.     */
/* Omis par rapport à l'interface : le champ « lien » (navigation de    */
/* l'application). Le risque est calculé sur le financier seul, comme   */
/* dans pratiques.js.                                                   */
/* ------------------------------------------------------------------ */

const FAMILLES = [
  { cle: "securite", titre: "Sécurité", poids: 30 },
  { cle: "effort", titre: "Effort", poids: 25 },
  { cle: "allocation", titre: "Allocation", poids: 30 },
  { cle: "efficacite", titre: "Efficacité", poids: 15 },
];
const PLAFOND_SPECULATIF_DEFAUT = 0.05;
const PLAFOND_PEA_DEFAUT = 150000;
const HORIZON_COURT = 24; // mois
/* Barèmes (points sur 20) : nommés pour ne pas être confondus avec ceux du score de santé (test de parité plan.js / MCP). */
const BAREME_ADEQUATION = [[0, 20], [40, 0]];
const BAREME_GEOGRAPHIE = [[0, 8], [0.5, 20]];
const BAREME_SPECULATIF_NUL = [[0, 20], [0.01, 0]];
const BAREME_FRAIS = [[0.3, 20], [1, 10], [2, 0]];
const BAREME_DORMANT = [[12, 20], [24, 10], [36, 5]];

/* Formats de pratiques.js (zéros finaux retirés, milliers séparés par une espace). */
function frP(x: number, dec = 1): string {
  const s = Math.abs(x).toFixed(dec).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(".", ",");
  return (x < 0 ? "\u2212" : "") + s.replace(/^(\d+)/, (m) => m.replace(/\B(?=(\d{3})+(?!\d))/g, " "));
}
const pctP = (x: number, dec = 0) => frP(x * 100, dec) + " %";
const eurP = (x: number) => frP(Math.round(x), 0) + " €";
const isoJour = (d: string) => String(d).slice(0, 10);
const plusAns = (date: string, ans: number) => { const s = isoJour(date).split("-").map(Number); return String(s[0] + ans).padStart(4, "0") + "-" + String(s[1] || 1).padStart(2, "0") + "-" + String(s[2] || 1).padStart(2, "0"); };
const frDate = (d: string) => isoJour(d).split("-").reverse().join("/");
const connu = (v: unknown) => v !== null && v !== undefined && v !== "" && isFinite(Number(v));

type Critere = { cle: string; famille: string; titre: string; points: number | null; sur: number; valeur: number | null; cible: string; texte: string; piste: string;
  regle: string; source: string; aCompleter: boolean; informatif?: boolean; details?: any[] };
type Base = { titre: string; cible: string; regle: string; source: string };
const critere = (famille: string, cle: string, b: Base, champs: Partial<Critere>): Critere =>
  ({ cle, famille, titre: b.titre, points: 0, sur: 20, valeur: null, cible: b.cible, texte: "", piste: "", regle: b.regle, source: b.source, aCompleter: false, ...champs });
const aCompleter = (famille: string, cle: string, b: Base, texte: string, piste: string) => critere(famille, cle, b, { aCompleter: true, texte, piste });

const DE_PLAN: Record<string, { famille: string; regle: string; source: string }> = {
  matelas: { famille: "securite", regle: "Matelas = épargne disponible ÷ dépenses mensuelles ; repère 3 à 6 mois", source: "Repère usuel des conseillers en gestion de patrimoine" },
  epargne: { famille: "effort", regle: "Taux d'épargne = (épargne prévue + reste du mois) ÷ revenus ; repère 15 % ou plus", source: "Repère usuel des conseillers en gestion de patrimoine" },
  endettement: { famille: "effort", regle: "Endettement = mensualités de crédit ÷ revenus ; plafond 35 %", source: "HCSF, décision D-HCSF-2021-7" },
  concentration: { famille: "allocation", regle: "Poids de la plus grosse ligne dans le financier ; repère 20 % au plus et au moins 3 poches",
    source: "Principe de diversification ; repère usuel des conseillers en gestion de patrimoine" },
};
const BP: Record<string, Base> = {
  protection: { titre: "Protection de la famille", cible: "prévoyance et assurance emprunteur en place",
    regle: "Avec un crédit ou des enfants à charge : prévoyance (décès, invalidité) et assurance emprunteur souscrites",
    source: "Repère usuel des conseillers en gestion de patrimoine ; assurance emprunteur demandée par les banques pour un crédit immobilier" },
  liquidite_objectifs: { titre: "Argent disponible pour les projets proches", cible: "100 % du besoin des objectifs à moins de 2 ans",
    regle: "Argent disponible sous quelques jours ÷ montant restant à réunir pour les objectifs à moins de 2 ans ; repère 100 %",
    source: "Repère usuel des conseillers : l'argent nécessaire à moins de 2 ans reste disponible et peu risqué" },
  apport: { titre: "Apport pour le projet immobilier", cible: "l'apport visé (10 % du prix + frais de notaire)",
    regle: "Apport réuni ÷ apport visé ; repère : 10 % du prix + frais de notaire (≈ 8 % dans l'ancien)",
    source: "Pratique des banques ; frais d'acquisition dans l'ancien de 7 à 8 % (Notaires de France)" },
  adequation: { titre: "Adéquation au profil de risque", cible: "chaque classe dans la fourchette de votre profil",
    regle: "Somme des écarts hors fourchette, par classe d'actifs, entre votre allocation et celle de votre profil ; repère 0 point",
    source: "Questionnaire de profil inspiré de l'adéquation MiFID II ; allocations indicatives de Boussole" },
  geographie: { titre: "Diversification géographique", cible: "au moins la moitié des actions sur le monde entier",
    regle: "Part des actions investies sur le monde entier (indices Monde, ACWI) ; repère 50 % ou plus",
    source: "Principe de diversification ; biais domestique (French et Poterba, 1991)" },
  speculatif: { titre: "Part spéculative", cible: "sous le plafond de votre profil",
    regle: "(Crypto + produits à levier) ÷ financier ; repère : sous le plafond de votre profil (5 % par défaut)",
    source: "Plafonds indicatifs par profil de Boussole ; mises en garde de l'AMF sur les crypto-actifs et les produits à effet de levier" },
  devises: { titre: "Exposition hors euro", cible: "information, sans note",
    regle: "Part du financier exposée à une autre devise que l'euro (une zone hors Europe compte hors euro) ; information",
    source: "Risque de change : information, pas un défaut" },
  frais: { titre: "Frais des fonds", cible: "0,3 % par an ou moins",
    regle: "Frais courants (TER) moyens, pondérés par les montants, des lignes cotées ; repère 0,3 % ou moins",
    source: "Documents d'informations clés des fonds ; ETF indiciels ≈ 0,1 à 0,3 %, fonds gérés ≈ 1,5 à 2 %" },
  enveloppes: { titre: "Choix des enveloppes", cible: "aucun point d'attention",
    regle: "PEA avant compte-titres pour les actions européennes · assurance-vie de plus de 8 ans pour l'abattement · PER surtout à partir de 30 % d'imposition",
    source: "Code général des impôts : art. 163 quinquies D (PEA), art. 125-0 A et 990 I (assurance-vie), art. 163 quatervicies (PER)" },
  dormant: { titre: "Argent dormant", cible: "12 mois de dépenses au plus sur livrets",
    regle: "Livrets et monétaire au-delà de 12 mois de dépenses, hors objectifs à moins de 2 ans ; repère 12 mois au plus",
    source: "Repère usuel des conseillers en gestion de patrimoine" },
};
const terDe = (p: any) => p.instrument?.ter ?? null;
const zoneDe = (p: any) => p.instrument?.zone ?? null;
const deviseDe = (p: any) => p.instrument?.devise ?? null;

type ContexteBP = { d: Donnees; scope: string; objectifs: any[]; risque: any; classes: Surcharge; ref: string };

function objectifsCourts(objectifs: any[], deja: Record<string, number>, ref: string) {
  return objectifs.filter((o) => o && dateCible(o) && moisEntre(ref, dateCible(o)!) <= HORIZON_COURT)
    .map((o) => ({ o, cible: pos(o.cible), deja: pos(deja[o.id]) }));
}

function bpProtection(c: ContexteBP): Critere | null {
  const pr = c.d.profil || {}, f = pr.foyer || {}, b = bilan(c.d, c.scope);
  const credit = b.dettes > 0 || b.mensualites > 0;
  const enfants = num(f.enfants) > 0 || num(f.enfants14) > 0;
  if (!credit && !enfants) return null;
  const attendus = credit ? ["prevoyance", "emprunteur"] : ["prevoyance"];
  const decl = pr.protection && pr.protection[c.scope] && typeof pr.protection[c.scope] === "object" ? pr.protection[c.scope] : pr.protection;
  const motif = credit && enfants ? "un crédit et des enfants" : credit ? "un crédit en cours" : "des enfants à charge";
  if (!decl || attendus.some((k) => typeof decl[k] !== "boolean"))
    return aCompleter("securite", "protection", BP.protection, "Protection non renseignée, alors que vous avez " + motif + ".",
      "Indiquez dans le Profil si une prévoyance" + (credit ? " et une assurance emprunteur couvrent" : " couvre") + " le foyer.");
  const okN = attendus.filter((k) => decl[k]).length;
  const libelle: Record<string, string> = { prevoyance: "prévoyance", emprunteur: "assurance emprunteur" };
  const manque = attendus.filter((k) => !decl[k]).map((k) => libelle[k]);
  return critere("securite", "protection", BP.protection, { points: okN === attendus.length ? 20 : okN > 0 ? 8 : 0, valeur: okN / attendus.length,
    texte: manque.length ? "Manque : " + manque.join(" et ") + " (vous avez " + motif + ")." : "Protection en place pour " + motif + ".",
    piste: manque.length ? "Un décès ou une invalidité ne doit pas mettre le foyer en difficulté : vérifiez d'abord les garanties de votre employeur, puis comparez les contrats."
      : "Relisez les garanties à chaque changement de situation (naissance, nouveau crédit)." });
}

function bpLiquidite(c: ContexteBP, deja: Record<string, number>): Critere | null {
  const courts = objectifsCourts(c.objectifs, deja, c.ref);
  if (!courts.length) return null;
  const besoin = sum(courts, (x) => Math.max(0, x.cible - x.deja));
  const dispo = sum(c.d.positions.filter((p) => inScope(p.owner, c.scope) && counted(p) && ["immediate", "jours"].includes(liquidite(p.envelope))), val);
  if (besoin <= 0) return critere("securite", "liquidite_objectifs", BP.liquidite_objectifs, { points: 20,
    texte: "Vos objectifs à moins de 2 ans sont déjà financés.", piste: "Gardez cet argent sur des supports disponibles jusqu'à l'échéance." });
  const ratio = dispo / besoin;
  return critere("securite", "liquidite_objectifs", BP.liquidite_objectifs, { points: Math.round(Math.min(1, ratio) * 20), valeur: ratio,
    texte: eurP(dispo) + " disponibles sous quelques jours pour " + eurP(besoin) + " encore à réunir d'ici 2 ans.",
    piste: ratio >= 1 ? "L'argent de vos projets proches est accessible sans attendre ni vendre au mauvais moment."
      : "L'argent nécessaire à moins de 2 ans gagne à être disponible et peu risqué (livrets, compte courant) : une baisse des marchés juste avant l'échéance n'aurait pas le temps de se rattraper." });
}

function bpApport(c: ContexteBP, deja: Record<string, number>): Critere | null {
  const L = c.objectifs.filter((o) => o && o.type === "apport");
  if (!L.length) return null;
  const cible = sum(L, (o) => (pos(o.cible) > 0 ? pos(o.cible) : 0.18 * pos(o.prix)));
  const reuni = sum(L, (o) => pos(deja[o.id]));
  if (cible <= 0) return aCompleter("effort", "apport", BP.apport, "Montant de l'apport non renseigné.", "Indiquez l'apport visé dans l'objectif Apport du Plan.");
  const ratio = reuni / cible;
  return critere("effort", "apport", BP.apport, { points: Math.round(Math.min(1, ratio) * 20), valeur: ratio,
    texte: eurP(reuni) + " réunis sur " + eurP(cible) + " d'apport visé (" + pctP(ratio) + ").",
    piste: ratio >= 1 ? "Votre apport est réuni : les banques regarderont aussi votre endettement après l'achat."
      : "Les banques attendent en général au moins 10 % du prix plus les frais de notaire (≈ 8 % dans l'ancien) ; le Plan indique l'effort mensuel pour y arriver." });
}

function bpAdequation(c: ContexteBP, financier: number): Critere {
  const fiche = ficheProfil(c.risque);
  if (!fiche) return aCompleter("allocation", "adequation", BP.adequation, "Profil de risque non renseigné.",
    "Répondez au questionnaire (une dizaine de questions) pour comparer votre allocation à celle de votre profil.");
  if (financier <= 0) return aCompleter("allocation", "adequation", BP.adequation, "Aucun placement enregistré.",
    "Ajoutez vos placements dans Bilan › Placements pour les comparer à votre profil.");
  const hors = sum(ecarts(fiche.id, allocationReelle(c.d.positions, c.scope, c.classes).pct), (e) => Math.abs(e.ecartPts));
  return critere("allocation", "adequation", BP.adequation, { points: Math.round(interp(hors, BAREME_ADEQUATION)), valeur: Math.round(hors * 10) / 10,
    texte: hors <= 0 ? "Votre allocation est dans les fourchettes du profil " + fiche.label + "." : frP(hors) + " points hors des fourchettes du profil " + fiche.label + ".",
    piste: hors <= 0 ? "Votre répartition correspond au risque que vous avez dit accepter."
      : "Le détail par classe est dans Diagnostic › Profil de risque : rapprochez chaque classe de sa fourchette, de préférence avec vos versements à venir." });
}

const RE_MONDE = /monde|world|acwi|all.?country|global|international/;
const libelleGeo = (p: any) => sansAccent(zoneDe(p) || (p.bloc || "") + " " + (p.name || ""));
function bpGeographie(vivantes: any[], classes: Surcharge): Critere | null {
  const actions = vivantes.filter((p) => classePoche(p.bloc, classes) === "actions" && val(p) > 0);
  const total = sum(actions, val);
  if (total <= 0) return null;
  const part = sum(actions.filter((p) => RE_MONDE.test(libelleGeo(p))), val) / total;
  return critere("allocation", "geographie", BP.geographie, { points: Math.round(part >= 0.5 ? 20 : interp(part, BAREME_GEOGRAPHIE)), valeur: part,
    texte: pctP(part) + " de vos actions couvrent le monde entier ; le reste vise une région, un pays ou des titres en direct.",
    piste: part >= 0.5 ? "Un socle « monde » répartit le risque sur des milliers d'entreprises et plusieurs économies ; vos paris régionaux s'y ajoutent."
      : "Miser sur une région n'est pas une erreur, mais le risque est plus concentré. Le biais domestique (surpondérer son pays ou sa région) est fréquent : un socle « monde » diversifie davantage." });
}

function bpSpeculatif(c: ContexteBP, vivantes: any[], financier: number): Critere {
  if (financier <= 0) return aCompleter("allocation", "speculatif", BP.speculatif, "Aucun placement enregistré.",
    "Ajoutez vos placements dans Bilan › Placements pour mesurer leur part spéculative.");
  const part = sum(vivantes.filter((p) => ["crypto", "levier"].includes(classeRisque(p, c.classes))), val) / financier;
  const fiche = ficheProfil(c.risque);
  const s = fiche?.cibles.speculatif;
  const borne = Array.isArray(s) && connu(s[1]) ? (s[1] >= 1 ? s[1] / 100 : s[1]) : null;
  const plafond = borne == null ? PLAFOND_SPECULATIF_DEFAUT : borne;
  const de = borne == null ? "plafond par défaut de " + pctP(plafond) + (fiche ? "" : ", profil de risque non renseigné")
    : "plafond du profil " + fiche!.label + " : " + pctP(plafond);
  const baremeSpeculatif = plafond > 0 ? [[plafond, 20], [2 * plafond, 0]] : BAREME_SPECULATIF_NUL;
  return critere("allocation", "speculatif", BP.speculatif, { points: Math.round(interp(part, baremeSpeculatif)), valeur: part, cible: pctP(plafond) + " au plus",
    texte: "Crypto et produits à levier : " + pctP(part, 1) + " du financier (" + de + ").",
    piste: part <= plafond ? "Cette part reste dans ce que votre profil peut encaisser : elle pourrait perdre l'essentiel de sa valeur sans compromettre vos projets."
      : "Ces supports peuvent perdre 80 % ou plus en quelques mois : au-delà du plafond, une telle baisse pèserait sur l'ensemble de votre patrimoine." });
}

const RE_EURO = /france|zone euro|eurozone|^eur$|^euro$/;
function bpDevises(vivantes: any[]): Critere | null {
  const exposition = (p: any) => {
    const dv = deviseDe(p);
    if (dv) return String(dv).toUpperCase() === "EUR" ? 0 : 1;
    const zone = zoneDe(p);
    if (!zone) return null;
    const z = sansAccent(zone);
    return RE_EURO.test(z) ? 0 : /europe/.test(z) ? null : 1;
  };
  const connues = vivantes.map((p) => ({ e: exposition(p), v: val(p) })).filter((x) => x.e != null && x.v > 0);
  const total = sum(connues, (x) => x.v);
  if (total <= 0) return null;
  const part = sum(connues, (x) => x.v * (x.e as number)) / total;
  const couverture = total / Math.max(total, sum(vivantes, val));
  return critere("allocation", "devises", BP.devises, { informatif: true, points: null, sur: 0, valeur: part,
    texte: pctP(part) + " exposés à une autre devise que l'euro" + (couverture < 0.999 ? " (sur les " + pctP(couverture) + " du financier dont la devise est connue)." : "."),
    piste: "Ce n'est pas un défaut : une exposition hors euro diversifie, mais les variations de change s'ajoutent à celles des marchés." });
}

function bpFrais(vivantes: any[]): Critere | null {
  const cotees = vivantes.filter((p) => p.mode === "market" && val(p) > 0);
  const total = sum(cotees, val);
  if (total <= 0) return null;
  const avec = cotees.filter((p) => connu(terDe(p)));
  const couvert = sum(avec, val);
  if (couvert / total < 0.5) return aCompleter("efficacite", "frais", BP.frais, "Frais inconnus : votre assistant peut les renseigner.",
    "Demandez à votre assistant de compléter les frais courants (TER) de vos fonds via le connecteur.");
  const ter = sum(avec, (p) => val(p) * Number(terDe(p))) / couvert;
  return critere("efficacite", "frais", BP.frais, { points: Math.round(interp(ter, BAREME_FRAIS)), valeur: ter,
    texte: "Frais moyens de " + frP(ter, 2) + " % par an" + (couvert < total ? " (sur " + pctP(couvert / total) + " des lignes cotées)." : "."),
    piste: ter <= 0.3 ? "Vos frais sont bas : sur 20 ans, chaque 0,1 % économisé compte."
      : "1 % de frais par an coûte environ 18 % du capital sur 20 ans : regardez quelles lignes pèsent le plus ; des fonds indiciels équivalents existent souvent." });
}

const RE_CTO = /\bcto\b|compte[- ]?titres?/, RE_PEA = /\bpea\b/, RE_PER = /\bper\b|\bperin\b|\bperco\b/, RE_AV = /assurance.?vie|\bav\b|capitalisation/;
const RE_EUROPE = /europe|france|\bcac\b|stoxx|zone euro/;
const ISIN_EEE = ["FR", "NL", "DE", "BE", "IT", "ES", "PT", "AT", "FI", "DK", "SE", "NO", "GR"];
const estEuropeenne = (p: any, classes: Surcharge) => classePoche(p.bloc, classes) === "actions" &&
  (RE_EUROPE.test(libelleGeo(p)) || ISIN_EEE.includes(String(p.isin || "").slice(0, 2).toUpperCase()));
function datesAV(env: string, profil: any, config: any): { ouverture?: string; huitAns?: string } | null {
  const o = profil && profil.av_ouverture;
  if (o && typeof o === "object" && o[env]) return { ouverture: o[env] };
  if (typeof o === "string" && o) return { ouverture: o };
  const titre = (m: any) => sansAccent(m.title || m.titre);
  const ms = (config && Array.isArray(config.milestones) ? config.milestones : []).find((m: any) => m && m.date && RE_AV.test(titre(m)) && /8 ans/.test(titre(m)));
  return ms ? { huitAns: ms.date } : null;
}
function bpEnveloppes(c: ContexteBP, vivantes: any[], deja: Record<string, number>): Critere | null {
  const classes = c.classes, details: { cle: string; statut: string; texte: string }[] = [], env = (p: any) => sansAccent(p.envelope);
  const alerts = c.d.config && c.d.config.alerts;
  const cap = alerts && connu(alerts.peaVersementsCap) ? Number(alerts.peaVersementsCap) : PLAFOND_PEA_DEFAUT;
  const parTitulaire: Record<string, any[]> = {};
  vivantes.filter((p) => RE_CTO.test(env(p)) && estEuropeenne(p, classes)).forEach((p) => { (parTitulaire[p.owner] = parTitulaire[p.owner] || []).push(p); });
  Object.keys(parTitulaire).forEach((owner) => {
    const cto = parTitulaire[owner], peas: Record<string, number> = {};
    vivantes.filter((p) => p.owner === owner && RE_PEA.test(env(p))).forEach((p) => { peas[p.envelope] = (peas[p.envelope] || 0) + val(p); });
    const libre = Object.keys(peas).find((k) => peas[k] < cap);
    if (libre) details.push({ cle: "pea", statut: "probleme",
      texte: eurP(sum(cto, val)) + " d'actions européennes (" + cto.map((p) => p.name).join(", ") + ") sont en compte-titres alors que le " + libre +
        " a encore de la place : dans un PEA de plus de 5 ans, les gains ne supportent que les prélèvements sociaux." });
    else details.push({ cle: "pea", statut: "ok", texte: Object.keys(peas).length
      ? "Actions européennes en compte-titres, mais le PEA du même titulaire a atteint son plafond : rien à changer."
      : "Actions européennes en compte-titres, sans PEA au nom du même titulaire." });
  });
  [...new Set(vivantes.filter((p) => RE_AV.test(env(p))).map((p) => p.envelope))].forEach((nom: string) => {
    const dt = datesAV(nom, c.d.profil, c.d.config);
    if (!dt) { details.push({ cle: "av", statut: "neutre", texte: nom + " : date d'ouverture inconnue (l'abattement sur les gains s'applique après 8 ans)." }); return; }
    const huit = dt.huitAns || plusAns(dt.ouverture!, 8);
    if (isoJour(huit) <= isoJour(c.ref)) { details.push({ cle: "av", statut: "ok", texte: nom + " a plus de 8 ans : abattement annuel sur les gains retirés." }); return; }
    const blocs = new Set(vivantes.filter((p) => p.envelope === nom).map((p) => p.bloc));
    const avant = c.objectifs.find((o) => o && o.source === "poches" && dateCible(o) && isoJour(dateCible(o)!) < isoJour(huit) && pos(deja[o.id]) > 0 &&
      ((o.enveloppes || []).includes(nom) || (o.poches || []).some((b: string) => blocs.has(b))));
    if (avant) details.push({ cle: "av", statut: "probleme",
      texte: nom + " aura 8 ans le " + frDate(huit) + ", après l'échéance de « " + (avant.nom || "votre objectif") + " » qu'elle finance : un retrait avant 8 ans ne profite pas de l'abattement." });
    else details.push({ cle: "av", statut: "note", texte: nom + " aura 8 ans le " + frDate(huit) + " : d'ici là, les gains retirés ne profitent pas de l'abattement annuel." });
  });
  if (vivantes.some((p) => RE_PER.test(env(p)))) {
    const tmi = c.d.profil?.foyer?.tmi;
    if (!connu(tmi)) details.push({ cle: "per", statut: "neutre", texte: "Tranche d'imposition inconnue : le PER est surtout intéressant à partir de 30 %." });
    else if (Number(tmi) < 30) details.push({ cle: "per", statut: "probleme",
      texte: "Tranche à " + frP(Number(tmi), 0) + " % : le PER est surtout intéressant à partir de 30 %, car la déduction à l'entrée vaut peu face à l'impôt à la sortie." });
    else details.push({ cle: "per", statut: "ok", texte: "Tranche à " + frP(Number(tmi), 0) + " % : les versements sur le PER réduisent nettement l'impôt." });
  }
  if (!details.length) return null;
  const pb = details.filter((x) => x.statut === "probleme");
  return critere("efficacite", "enveloppes", BP.enveloppes, { points: Math.max(0, 20 - 6 * pb.length), valeur: pb.length, details,
    texte: pb.length ? pb.length + " point" + (pb.length > 1 ? "s" : "") + " d'attention sur le choix des enveloppes." : "Vos enveloppes sont utilisées dans le bon ordre.",
    piste: pb.length ? pb.map((x) => x.texte).join(" ") : "Rien à changer : chaque enveloppe joue son rôle fiscal." });
}

function bpDormant(c: ContexteBP, vivantes: any[], depenses: number, deja: Record<string, number>): Critere {
  if (!(depenses > 0)) return aCompleter("efficacite", "dormant", BP.dormant, "Dépenses mensuelles inconnues.",
    "Renseignez vos dépenses dans le budget pour mesurer l'argent qui dort.");
  const livrets = sum(vivantes.filter((p) => classePoche(p.bloc, c.classes) === "monetaire"), val);
  const reserve = sum(objectifsCourts(c.objectifs, deja, c.ref).filter((x) => x.o.type !== "matelas"), (x) => x.cible);
  const mois = Math.max(0, livrets - reserve) / depenses;
  return critere("efficacite", "dormant", BP.dormant, { points: Math.round(mois <= 12 ? 20 : interp(mois, BAREME_DORMANT)), valeur: mois,
    texte: frP(mois) + " mois de dépenses sur livrets et monétaire" + (reserve > 0 ? ", hors " + eurP(reserve) + " réservés aux projets à moins de 2 ans." : "."),
    piste: mois <= 12 ? "Votre argent disponible correspond à vos besoins : rien ne dort inutilement."
      : "Au-delà d'un an de dépenses, l'argent des livrets perd souvent face à l'inflation : une partie pourrait servir un objectif de long terme, sur un support adapté à votre profil." });
}

const sansIndefini = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
/** Bonnes pratiques (Pratiques.evaluer) : critères, totaux par famille (somme ÷ (20 × critères notés) × 100) et total pondéré. */
function bonnesPratiques(c: ContexteBP) {
  const { d, scope } = c;
  const totaux = budgetTotaux(d, scope);
  const cu = d.config?.cushion;
  const depenses = totaux.depensesLignes > 0 ? totaux.depenses : cu && typeof cu === "object" && cu.mode === "months" && pos(cu.depenses) > 0 ? pos(cu.depenses) : 0;
  const deja = affecterDeja(c.objectifs, d.positions, scope);
  const vivantes = d.positions.filter((p) => inScope(p.owner, scope) && counted(p));
  const financier = sum(vivantes, val);
  const plan = (i: Item): Critere => ({ cle: i.cle, titre: i.titre, cible: i.cible, valeur: i.valeur, texte: i.texte, piste: i.piste, aCompleter: i.aCompleter,
    points: i.aCompleter ? 0 : Math.round(i.points ?? 0), sur: 20, ...DE_PLAN[i.cle] });
  const criteres = [
    plan(itemMatelas(d, scope, totaux)), bpProtection(c), bpLiquidite(c, deja),
    plan(itemEpargne(totaux)), plan(itemEndettement(totaux)), bpApport(c, deja),
    bpAdequation(c, financier), plan(itemConcentration(d, scope)), bpGeographie(vivantes, c.classes), bpSpeculatif(c, vivantes, financier), bpDevises(vivantes),
    bpFrais(vivantes), bpEnveloppes(c, vivantes, deja), bpDormant(c, vivantes, depenses, deja),
  ].filter(Boolean) as Critere[];
  const familles = FAMILLES.map((f) => {
    const cs = criteres.filter((x) => x.famille === f.cle);
    const notes = cs.filter((x) => !x.aCompleter && !x.informatif);
    return { cle: f.cle, titre: f.titre, poids: f.poids, criteres: cs.map((x) => x.cle),
      total: notes.length ? Math.round(sum(notes, (x) => num(x.points)) / (20 * notes.length) * 100) : null };
  });
  const notees = familles.filter((f) => f.total != null);
  const poids = sum(notees, (f) => f.poids);
  const comptes = criteres.filter((x) => !x.informatif);
  return {
    total: poids > 0 ? Math.round(sum(notees, (f) => (f.total as number) * f.poids) / poids) : 0,
    complet: comptes.length > 0 && comptes.every((x) => !x.aCompleter),
    familles,
    criteres: criteres.map((x) => sansIndefini({ cle: x.cle, famille: x.famille, titre: x.titre, points: x.points, sur: x.sur, a_completer: x.aCompleter, informatif: x.informatif || undefined,
      valeur: x.valeur == null ? null : Math.round(x.valeur * 1000) / 1000, cible: x.cible, texte: x.texte, piste: x.piste, regle: x.regle, source: x.source, details: x.details })),
    calcul: "Critère sur 20 ; famille = somme des points ÷ (20 × critères notés) × 100 ; total = moyenne des familles notées pondérée 30 / 25 / 30 / 15 (Sécurité, Effort, Allocation, Efficacité). Critères à compléter et informatifs exclus des totaux ; critères sans objet omis.",
    mention: "Indicateur pédagogique, pas un conseil en investissement.",
  };
}

/** Vue d'un profil de risque pour le connecteur (montants arrondis, % à une décimale). */
function vueRisque(risque: any, d: Donnees, scope: string, classes: Surcharge, detail: boolean) {
  const sy = syntheseRisque(risque, d.positions, scope, classes);
  const decl = sy.declare;
  const base: any = {
    questionnaire_rempli: !!decl,
    profil: decl ? { id: decl.id, libelle: decl.label, perte_max_toleree_pct: decl.perteMax, description: decl.description } : null,
    score: risque && connu(risque.score) ? Number(risque.score) : null,
    date: risque?.date ?? null,
    profil_equivalent_portefeuille: sy.equivalent ? { id: sy.equivalent.id, libelle: sy.equivalent.label } : null,
    ecart_niveaux: sy.ecartNiveaux,
    comparaison: sy.texte,
  };
  if (!decl) base.message = "Profil de risque non renseigné : l'utilisateur peut répondre au questionnaire dans Diagnostic › Profil de risque.";
  if (!detail) return base;
  const a = sy.allocation, rp = sy.risque;
  return {
    ...base,
    reponses: risque?.reponses ?? null,
    perimetre: scope,
    allocation_reelle: {
      base: "Placements financiers comptés du périmètre (hors résidence et immobilier physique), valeur en euros.",
      total: r2(a.total),
      groupes: Object.keys(a.montants).map((g) => ({ groupe: g, libelle: GROUPES_LABELS[g], montant: r2(a.montants[g]), pct: r1(a.pct[g]) })),
      par_classe: Object.entries(a.parClasse).map(([k, v]) => ({ classe: k, libelle: (CLASSES_RISQUE[k] || CLASSES_RISQUE.autres).label, montant: r2(v as number) })),
    },
    cibles_et_ecarts: sy.ecarts.map((e) => ({ groupe: e.groupe, libelle: e.label, reel_pct: r1(e.reel), cible_min_pct: e.min, cible_max_pct: e.max, statut: e.statut, ecart_pts: r1(e.ecartPts) })),
    risque_portefeuille: {
      volatilite_annuelle_pct: r1(rp.volatilite),
      baisse_plausible_un_an_pct: r1(rp.baissePlausible),
      pire_baisse_historique_ponderee_pct: r1(rp.pireBaisseHistorique),
      contributions: rp.contributions.map((x: any) => ({ classe: x.classe, poids_pct: r1(x.poids), contribution_risque_pct: r1(x.contributionPct) })),
      methode: "σ = √(wᵀΣw) avec volatilités et corrélations simplifiées par classe ; baisse plausible = la plus grave de −2,33 σ et de la moitié de la pire baisse historique pondérée ; profil équivalent = le moins risqué dont la perte tolérée couvre cette baisse.",
    },
    surcharges_poche_classe: classes && typeof classes === "object" ? classes : {},
    mention: "Indicateur pédagogique, pas un conseil en investissement.",
  };
}

/* ------------------------------------------------------------------ */
/* État du bilan (port de web/src/bilan-etat.js, à l'identique)        */
/* Mêmes sections, mêmes questions, même ordre, même pourcentage ;      */
/* test/mcp.test.mjs compare les deux sur la démo. Fonctions pures.     */
/* ------------------------------------------------------------------ */

const BilanEtat = (() => {
  const has = (v: unknown) => v !== undefined && v !== null && v !== "";
  const num = (v: unknown) => (isFinite(+(v as number)) ? +(v as number) : 0);
  const jours = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const FRAICHEUR_JOURS = 90;
  /* Identifiants des questions du profil de risque (identiques à web/src/risque.js). */
  const RISQUE_IDS = ["horizon", "objectif", "reaction", "perte_max", "connaissances", "experience", "revenus", "matelas", "part_investie", "age"];
  const RISQUE_LIBELLES: Record<string, string> = {
    horizon: "Dans combien de temps aurez-vous besoin de la majeure partie de cet argent ?",
    objectif: "Que cherchez-vous d'abord : préserver, compléter vos revenus, faire croître ?",
    reaction: "Si votre portefeuille perdait 20 % en 3 mois, que feriez-vous ?",
    perte_max: "Quelle baisse temporaire sur un an pourriez-vous supporter sans vendre ?",
    connaissances: "Quels placements connaissez-vous bien (livrets, fonds euros, ETF, actions, obligations, crypto) ?",
    experience: "Depuis combien d'années investissez-vous en bourse ?",
    revenus: "Vos revenus sont-ils stables (fonctionnaire, CDI, indépendant, variables) ?",
    matelas: "Avez-vous au moins 3 mois de dépenses disponibles hors placements ?",
    part_investie: "Quelle part de votre épargne acceptez-vous d'exposer aux marchés ?",
    age: "Quelle est votre tranche d'âge ?",
  };

  type Q = { champ: string; question: string; pourquoi: string };
  type Section = { cle: string; titre: string; total: number; faits?: number; manquants: Q[]; statut?: string; pct?: number };
  const q = (champ: string, question: string, pourquoi: string): Q => ({ champ, question, pourquoi });
  const nomDe = (pr: any, k: string) => (pr && pr.personnes && pr.personnes[k] && String(pr.personnes[k].nom || "").trim()) || (k === "p1" ? "vous" : "votre conjoint(e)");

  function sections(S: any, today: string): Section[] {
    const pr = S.profil || null, f = (pr && pr.foyer) || {}, ps = (pr && pr.personnes) || {};
    const deux = num(f.adultes) >= 2;
    const out: Section[] = [];

    // 1. Foyer
    const foyer: Q[] = [];
    if (!has(f.adultes)) foyer.push(q("foyer.adultes", "Combien d'adultes composent votre foyer ?", "Le niveau de vie et l'impôt dépendent de la taille du foyer."));
    if (!has(f.enfants)) foyer.push(q("foyer.enfants", "Avez-vous des enfants à charge ?", "Ils comptent dans l'impôt, le budget et la protection à prévoir."));
    if (!has(f.age)) foyer.push(q("foyer.age", "Quelle est la tranche d'âge de la personne qui gagne le plus ?", "L'horizon de placement et les repères de patrimoine dépendent de l'âge."));
    if (!has(f.tmi)) foyer.push(q("foyer.tmi", "Quelle est votre tranche marginale d'imposition (0, 11, 30, 41 ou 45 %) ?", "Elle détermine l'intérêt du PER et la fiscalité de vos placements."));
    out.push({ cle: "foyer", titre: "Foyer", total: 4, manquants: foyer });

    // 2. Revenus
    const rev: Q[] = [];
    ["p1"].concat(deux ? ["p2"] : []).forEach((k) => {
      const p = ps[k] || {};
      if (!(num(p.salaire) > 0)) rev.push(q("personnes." + k + ".salaire", "Quel est le salaire de " + nomDe(pr, k) + " (net ou brut, par mois ou par an) ?", "C'est la base du taux d'épargne, de l'endettement et de la capacité d'emprunt."));
      if (!has(p.statut)) rev.push(q("personnes." + k + ".statut", nomDe(pr, k) + " est-il cadre ou non-cadre ?", "Utile pour convertir un salaire brut en net."));
    });
    out.push({ cle: "revenus", titre: "Revenus", total: deux ? 4 : 2, manquants: rev });

    // 3. Budget
    const lignes: any[] = (S.budget && Array.isArray(S.budget.lignes)) ? S.budget.lignes : [];
    const bud: Q[] = [];
    if (!lignes.some((l) => l.type === "depense")) bud.push(q("budget.depenses", "Quelles sont vos principales dépenses mensuelles (logement, courses, transport, abonnements…) ? Un relevé bancaire collé suffit.", "Sans dépenses, impossible de mesurer votre matelas en mois et votre taux d'épargne."));
    if (!lignes.some((l) => l.type === "epargne")) bud.push(q("budget.epargne", "Combien mettez-vous de côté chaque mois, et où ?", "L'épargne régulière alimente vos objectifs et vos projections."));
    out.push({ cle: "budget", titre: "Budget", total: 2, manquants: bud });

    // 4. Épargne et placements
    const pos: any[] = (S.positions || []).filter((p: any) => p.status !== "clôturé");
    const plac: Q[] = [];
    if (!pos.length) plac.push(q("positions", "Quels sont vos comptes et placements (livrets, PEA, assurance-vie, PER, compte-titres, crypto) et leurs montants ?", "C'est le cœur du bilan : répartition, risque et diversification en découlent."));
    else {
      const vieux = pos.filter((p) => {
        const d = p.mode === "market" ? p.priceDate : p.valueDate;
        return p.status !== "à recevoir" && (!d || jours(d, today) > FRAICHEUR_JOURS);
      });
      const envs = [...new Set(vieux.map((p) => p.envelope || p.name))];
      if (envs.length) plac.push(q("positions.fraicheur", "Pouvez-vous me donner le solde à jour de : " + envs.join(", ") + " ?", "Ces montants datent de plus de " + FRAICHEUR_JOURS + " jours."));
    }
    // Deux étapes : avoir déclaré ses placements, puis des montants à jour.
    out.push({ cle: "placements", titre: "Épargne et placements", total: 2, faits: !pos.length ? 0 : plac.length ? 1 : 2, manquants: plac });

    // 5. Immobilier et crédits
    const immo: Q[] = [];
    const biens: any[] = (pr && Array.isArray(pr.biens)) ? pr.biens : [];
    if (!biens.length && !(pr && pr.biensRenseignes)) immo.push(q("biens", "Êtes-vous propriétaire d'un ou plusieurs biens immobiliers ? Avez-vous des crédits en cours (immobilier, auto, conso) ?", "Patrimoine net, endettement et capacité d'emprunt en dépendent. « Aucun » est une réponse valable."));
    out.push({ cle: "immobilier", titre: "Immobilier et crédits", total: 1, manquants: immo });

    // 6. Protection
    const prot = (pr && pr.protection) || {};
    const credits = (pr && Array.isArray(pr.credits) ? pr.credits : []).length + biens.filter((b) => num(b.crd) > 0).length;
    const protM: Q[] = [];
    if (!has(prot.prevoyance)) protM.push(q("protection.prevoyance", "Avez-vous une prévoyance (décès, invalidité) au-delà de celle de votre employeur ?", "Protéger les revenus du foyer passe avant l'investissement."));
    if (credits > 0 && !has(prot.emprunteur)) protM.push(q("protection.emprunteur", "Vos crédits sont-ils couverts par une assurance emprunteur, et à quelle quotité ?", "Elle protège le foyer si un emprunteur ne peut plus rembourser."));
    out.push({ cle: "protection", titre: "Protection", total: credits > 0 ? 2 : 1, manquants: protM });

    // 7. Objectifs
    const objs: any[] = (S.objectifs || []);
    const objM: Q[] = [];
    if (!objs.length) objM.push(q("objectifs", "Quels sont vos projets et leur échéance (achat immobilier, matelas, études, retraite…) ?", "Les projections et les recommandations se calent sur vos objectifs."));
    else if (!objs.some((o) => o.dateCible || o.date_cible)) objM.push(q("objectifs.date", "Pour quand visez-vous vos objectifs ?", "Sans date, impossible de calculer l'effort mensuel."));
    out.push({ cle: "objectifs", titre: "Objectifs", total: 1, manquants: objM });

    // 8. Profil de risque
    const rep = (S.risque && S.risque.reponses) || {};
    const risqueM = RISQUE_IDS.filter((id) => !has(rep[id]) || (Array.isArray(rep[id]) && !rep[id].length))
      .map((id) => q("risque." + id, RISQUE_LIBELLES[id], "Le profil de risque fixe l'allocation cible et la baisse que vous pouvez traverser."));
    out.push({ cle: "risque", titre: "Profil de risque", total: RISQUE_IDS.length, manquants: risqueM });

    return out;
  }

  /** État complet : pourcentage (moyenne des sections), statut par section, 3 prochaines questions, propositions en attente. */
  function etat(S: any, today?: string) {
    const t = today || new Date().toISOString().slice(0, 10);
    const secs = sections(S || {}, t).map((s) => {
      const faits = s.faits != null ? s.faits : Math.max(0, s.total - s.manquants.length);
      return Object.assign(s, { faits, statut: s.manquants.length === 0 ? "complet" : faits === 0 ? "vide" : "partiel", pct: s.total ? faits / s.total : 1 });
    });
    const pourcentage = Math.round(secs.reduce((a, s) => a + (s.pct as number), 0) / secs.length * 100);
    const prochaines = secs.flatMap((s) => s.manquants.map((m) => Object.assign({ section: s.cle }, m))).slice(0, 3);
    const propositionsEnAttente = ((S && S.propositions) || []).filter((p: any) => p.statut === "en_attente").length;
    return { pourcentage, sections: secs, prochaines, propositionsEnAttente };
  }

  return { etat, RISQUE_IDS, RISQUE_LIBELLES, FRAICHEUR_JOURS };
})();

/** Données lues en base (lignes SQL) → S à la forme de web/src/store-supabase.js, pour BilanEtat.etat. */
function etatDepuisLignes(r: { profil: any; biens: any[]; credits: any[]; positions: any[]; budget: any; objectifs: any[]; propositions: any[] }) {
  const p = r.profil;
  const profil = p ? {
    foyer: p.foyer || {}, personnes: p.personnes || {}, autres: p.autres || {}, protection: p.protection || {},
    biens: r.biens || [], credits: r.credits || [],
    ...(p.foyer && p.foyer.biensRenseignes ? { biensRenseignes: true } : {}),
  } : null;
  const positions = (r.positions || []).map((x) => {
    const ins = x.instrument || null, insDate = (ins && ins.price_date) || null;
    const useOv = x.price_override != null && (!insDate || !x.value_date || x.value_date >= insDate);
    return { name: x.name, envelope: x.envelope, mode: x.mode, status: x.status, priceDate: useOv ? x.value_date : insDate, valueDate: x.value_date || null };
  });
  return {
    profil, positions,
    budget: r.budget ? { lignes: Array.isArray(r.budget.lignes) ? r.budget.lignes : [] } : null,
    objectifs: (r.objectifs || []).map((o) => ({ dateCible: o.date_cible || o.dateCible || null })),
    risque: (p && p.risque) || null,
    propositions: r.propositions || [],
  };
}

/* Questions du profil de risque : identifiants, type et valeurs permises (identiques à web/src/risque.js QUESTIONS ;
   test/mcp.test.mjs vérifie la parité). Sert à valider set_risk_answers. */
const QUESTIONS_RISQUE: { id: string; type: "choix" | "multi" | "nombre"; valeurs: string[] }[] = [
  { id: "horizon", type: "choix", valeurs: ["lt2", "2-5", "5-8", "8-15", "gt15"] },
  { id: "objectif", type: "choix", valeurs: ["preserver", "revenus", "croissance", "maximiser"] },
  { id: "reaction", type: "choix", valeurs: ["vendre_tout", "vendre_partie", "rien", "renforcer"] },
  { id: "perte_max", type: "choix", valeurs: ["p5", "p10", "p20", "p35", "plus"] },
  { id: "connaissances", type: "multi", valeurs: ["livrets", "fonds_euros", "etf", "actions", "obligations", "crypto", "levier", "aucun"] },
  { id: "experience", type: "nombre", valeurs: ["0", "1", "3", "5", "10"] },
  { id: "revenus", type: "choix", valeurs: ["fonctionnaire", "cdi", "independant", "variables", "sans"] },
  { id: "matelas", type: "choix", valeurs: ["oui", "non"] },
  { id: "part_investie", type: "choix", valeurs: ["lt10", "10-25", "25-50", "50-75", "gt75"] },
  { id: "age", type: "choix", valeurs: ["u30", "a30", "a40", "a50", "a60", "a70"] },
];

/* ------------------------------------------------------------------ */
/* Schémas d'entrée                                                    */
/* ------------------------------------------------------------------ */

const money = z.number().min(0, { error: "Montant négatif interdit." });
const uuid = z.string().regex(UUID_RE, { error: "Identifiant invalide (UUID attendu)." });
const isoDate = z.string().regex(DATE_RE, { error: "Date au format AAAA-MM-JJ attendue." });
const pct = z.number().min(0).max(100);
const TMI = [0, 11, 30, 41, 45] as const;

/* Champs communs à tous les outils d'écriture : rien n'est écrit, une proposition est déposée avec sa source. */
const SOURCE_REQUISE = "Source obligatoire : d'où vient ce chiffre (relevé collé, déclaration de l'utilisateur, document…).";
const DEPOT = {
  source: z.string({ error: SOURCE_REQUISE }).trim().min(1, { error: SOURCE_REQUISE }).max(500, { error: "Source : 500 caractères au plus." })
    .describe("D'où vient ce chiffre : relevé collé, déclaration de l'utilisateur, document… Obligatoire, affiché à l'utilisateur (ex. « Relevé PEA du 30/09 collé par l'utilisateur », « Dit par l'utilisateur »)."),
  justification: z.string().trim().max(1000, { error: "Justification : 1000 caractères au plus." }).optional()
    .describe("Pourquoi ce changement, en une ou deux phrases simples (affiché à l'utilisateur à côté de l'avant / après)."),
  lot: uuid.optional().describe("Identifiant de lot (UUID) renvoyé par un dépôt précédent : réutilisez-le pour regrouper toutes les propositions d'un même entretien. Absent : nouveau lot."),
};

const FoyerPatch = z.strictObject({
  adultes: z.number().int().min(1, { error: "Le foyer compte 1 à 3 adultes." }).max(3, { error: "Le foyer compte 1 à 3 adultes." }).nullable().optional(),
  enfants: z.number().int().min(0).max(20).nullable().optional(),
  enfants14: z.number().int().min(0).max(20).nullable().optional().describe("Dont enfants de 14 ans ou plus."),
  union: z.enum(["joint", "sep"]).nullable().optional().describe("joint = marié ou pacsé, sep = union libre ou seul."),
  age: z.enum(["u30", "a30", "a40", "a50", "a60", "a70"]).nullable().optional().describe("Tranche d'âge de p1 : u30 (<30), a30 (30-39), a40, a50, a60, a70 (70+)."),
  tmi: z.literal(TMI, { error: "Tranche marginale d'imposition invalide : valeurs possibles 0, 11, 30, 41 ou 45." }).nullable().optional()
    .describe("Tranche marginale d'imposition en % (0, 11, 30, 41 ou 45)."),
  biensRenseignes: z.boolean().nullable().optional().describe("true : l'utilisateur a confirmé n'avoir aucun bien immobilier ni crédit (« aucun » est une réponse)."),
});
const PersonnePatch = z.strictObject({
  nom: z.string().trim().min(1).max(40).optional().describe("Prénom."),
  salaire: money.nullable().optional(),
  salaireUnite: z.enum(["nm", "na", "bm", "ba"], { error: "Unité de salaire invalide : nm (net mensuel), na (net annuel), bm (brut mensuel) ou ba (brut annuel)." })
    .nullable().optional().describe("nm = net mensuel, na = net annuel, bm = brut mensuel, ba = brut annuel."),
  statut: z.enum(["cadre", "nc"], { error: "Statut invalide : cadre ou nc (non-cadre)." }).nullable().optional(),
  csp: z.string().max(60).nullable().optional(),
  essai: z.boolean().nullable().optional().describe("En période d'essai."),
  autresRevenus: money.nullable().optional().describe("Autres revenus nets mensuels (hors loyers des biens)."),
});
const AutresPatch = z.strictObject({
  usage: money.nullable().optional().describe("Biens d'usage (véhicule, mobilier…), en euros."),
  entreprise: money.nullable().optional().describe("Parts d'entreprise, en euros."),
});

const BienRow = z.strictObject({
  id: uuid.optional().describe("Absent : création. Présent : modification de ce bien."),
  nom: z.string().trim().min(1).max(60).optional(),
  usage: z.enum(["rp", "locatif", "secondaire"]).optional().describe("rp = résidence principale."),
  valeur: money.optional(),
  part_p1: pct.optional().describe("Quote-part de p1 en % (le reste revient à p2)."),
  crd: money.optional().describe("Capital restant dû du prêt associé."),
  mensualite: money.optional(),
  loyer: money.optional().describe("Loyer mensuel perçu."),
});
const CreditRow = z.strictObject({
  id: uuid.optional().describe("Absent : création. Présent : modification de ce crédit."),
  nom: z.string().trim().min(1).max(60).optional(),
  owner: z.enum(["p1", "p2", "commun"]).optional(),
  crd: money.optional().describe("Capital restant dû."),
  mensualite: money.optional(),
});
const PositionRow = z.strictObject({
  id: uuid.optional().describe("Absent : création. Présent : modification de cette ligne."),
  name: z.string().trim().min(1).max(120).optional(),
  isin: z.string().nullable().optional().describe("ISIN (12 caractères) pour un titre coté."),
  envelope: z.string().max(60).optional().describe("Enveloppe : PEA, CTO, Assurance-vie, Livrets, PER…"),
  owner: z.enum(["p1", "p2"]).optional(),
  bloc: z.string().max(60).optional().describe("Poche d'allocation (ex. Monde, Épargne, Immobilier papier)."),
  mode: z.enum(["market", "manual"]).optional().describe("market = titre coté (quantité × cours), manual = valeur saisie."),
  qty: money.nullable().optional().describe("Quantité (titres cotés)."),
  pru: money.nullable().optional().describe("Prix de revient unitaire."),
  value: money.nullable().optional().describe("Valeur en euros (lignes manuelles : livret, fonds euros, SCPI…)."),
  price_override: money.nullable().optional().describe("Cours manuel, prioritaire sur le cours automatique (null pour revenir au cours automatique)."),
  status: z.enum(["actif", "à recevoir", "clôturé"]).optional(),
  note: z.string().max(300).nullable().optional(),
});

const RuleSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("max_line_pct"), pct: pct.describe("Poids maximal d'une ligne en %.") }),
  z.looseObject({ type: z.literal("max_bloc_pct"), bloc: z.string().min(1), pct }),
  z.looseObject({ type: z.literal("price_floor"), position_id: uuid, price: z.number().positive() }),
  z.looseObject({ type: z.literal("envelope_cap"), envelope: z.string().min(1), cap: money }),
  z.looseObject({ type: z.literal("stale_prices"), days: z.number().int().min(1).max(60) }),
], { error: "Type de règle inconnu : max_line_pct, max_bloc_pct, price_floor, envelope_cap ou stale_prices." });
const TargetsPatch = z.strictObject({
  p1: z.record(z.string(), pct.nullable()).optional().describe("Cible en % par poche pour p1 (null retire la poche)."),
  p2: z.record(z.string(), pct.nullable()).optional(),
  tolerancePts: z.number().min(0).max(50).optional().describe("Écart toléré, en points."),
});
const TodoItem = z.looseObject({ text: z.string().min(1).max(200), amount: z.union([z.string(), z.number()]).optional(), done: z.boolean().optional() });
const MilestoneItem = z.looseObject({ title: z.string().min(1).max(80), date: isoDate, text: z.string().max(300).optional(), warnDays: z.number().int().min(0).optional() });
const HypothesisItem = z.looseObject({ text: z.string().min(1).max(300), done: z.boolean().optional() });

const BudgetLigne = z.strictObject({
  id: z.string().trim().min(1).max(64).optional().describe("Identifiant de la ligne (get_budget). Absent : la ligne est retrouvée par son libellé, sinon créée."),
  type: z.enum(["revenu", "depense", "epargne"], { error: "Type de ligne invalide : revenu, depense ou epargne." }).optional(),
  categorie: z.string().trim().max(60).optional().describe("Catégorie de dépense (Logement, Alimentation, Transport…)."),
  libelle: z.string().trim().min(1).max(80).optional(),
  montant: money.optional().describe("Montant en euros, ≥ 0, par mois ou par an selon frequence."),
  frequence: z.enum(["mois", "an"], { error: "Fréquence invalide : mois ou an." }).optional().describe("mois (défaut) ou an."),
  owner: z.enum(["p1", "p2", "commun"], { error: "Titulaire invalide : p1, p2 ou commun." }).nullable().optional()
    .describe("p1, p2 ou commun (défaut : commun, partagé à parts égales)."),
});
const ObjectifRow = z.strictObject({
  id: uuid.optional().describe("Absent : création. Présent : modification de cet objectif (seuls les champs fournis changent)."),
  nom: z.string().trim().min(1).max(80).optional(),
  type: z.enum(["apport", "matelas", "retraite", "projet"], { error: "Type d'objectif invalide : apport, matelas, retraite ou projet." }).optional(),
  cible: money.optional().describe("Montant visé en euros."),
  dateCible: isoDate.nullable().optional().describe("Échéance AAAA-MM-JJ (null : sans échéance)."),
  deja: money.optional().describe("Montant déjà mis de côté (source saisi)."),
  source: z.enum(["saisi", "poches"], { error: "Source invalide : saisi ou poches." }).optional()
    .describe("saisi = montant deja saisi ; poches = somme des poches / enveloppes rattachées, réparties en cascade par priorité."),
  poches: z.array(z.string().trim().min(1).max(60)).max(30).optional().describe("Poches de placements rattachées (ex. Épargne, Monde)."),
  enveloppes: z.array(z.string().trim().min(1).max(60)).max(30).optional().describe("Enveloppes rattachées (ex. PEA, Livrets)."),
  rendement: z.number().min(-50, { error: "Rendement entre -50 et 50 % par an." }).max(50, { error: "Rendement entre -50 et 50 % par an." }).optional()
    .describe("Rendement annuel attendu en %."),
  priorite: z.number().int({ error: "Priorité : nombre entier attendu." }).min(-1000).max(1000).optional().describe("1 = servi en premier."),
});

/* ------------------------------------------------------------------ */
/* Serveur MCP (un par requête, lié au client de l'utilisateur)        */
/* ------------------------------------------------------------------ */

type Ctx = { db: any; user: { id: string; email?: string } };

function wrap<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      if (e instanceof UserError) return fail(e.message);
      console.error("mcp tool error", e);
      return fail("Erreur inattendue : " + (e instanceof Error ? e.message : String(e)));
    }
  };
}

async function loadPeople(db: any) {
  const pr = must("profiles", await db.from("profiles").select("personnes").maybeSingle()) as any;
  const P = pr?.personnes ?? {};
  const people: Record<string, string> = { p1: P.p1?.nom ?? "p1" };
  if (P.p2) people.p2 = P.p2.nom ?? "p2";
  return people;
}

export function buildServer({ db, user }: Ctx): McpServer {
  const server = new McpServer({ name: "boussole", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  // Erreurs de validation des paramètres : message français lisible (isError: true) au lieu du JSON brut du SDK.
  (server as any).validateToolInput = async (tool: any, args: unknown, name: string) => {
    if (!tool.inputSchema) return undefined;
    const res = await tool.inputSchema.safeParseAsync(args ?? {});
    if (res.success) return res.data;
    const lines = res.error.issues.map((i: any) => `- ${i.path.length ? i.path.join(".") : "paramètres"} : ${i.message}`);
    throw new UserError(`Paramètres invalides pour ${name} :\n${lines.join("\n")}`);
  };
  const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  /* ---------- get_overview ---------- */
  server.registerTool("get_overview", {
    title: "Vue d'ensemble",
    description: "Synthèse du patrimoine : financier, immobilier, dettes et patrimoine net (foyer, p1, p2), revenus mensuels nets, mensualités, dernière photo, lignes sans cours récent, dernière mise à jour nocturne et alertes ; totaux mensuels du budget ; score de santé financière sur 100 (cinq critères sur 20, détail pour le foyer, total par personne) ; profil_risque (profil déclaré, profil équivalent du portefeuille) ; bonnes_pratiques du foyer (total sur 100, quatre familles, critères avec points, texte, piste, règle et source).",
    inputSchema: z.strictObject({}),
    annotations: RO,
  }, wrap(async () => {
    const [pr, bi, cr, po, sn, st, cf, bu, ob] = await Promise.all([
      db.from("profiles").select("*").maybeSingle(),
      db.from("biens").select("*"),
      db.from("credits").select("*"),
      db.from("positions").select(POS_SELECT),
      db.from("snapshots").select("date, total, p1, p2").order("date", { ascending: false }).limit(1),
      db.from("status").select("*").maybeSingle(),
      db.from("config").select("cushion, milestones").maybeSingle(),
      db.from("budgets").select("lignes").maybeSingle(),
      db.from("objectifs").select("*").order("priorite").order("created_at"),
    ]);
    const profil = must("profiles", pr) as any ?? {};
    const objectifs = (must("objectifs", ob) as any[]) ?? [];
    const biens = (must("biens", bi) as any[]) ?? [];
    const credits = (must("credits", cr) as any[]) ?? [];
    const positions = (must("positions", po) as any[]) ?? [];
    const snap = ((must("snapshots", sn) as any[]) ?? [])[0] ?? null;
    const status = must("status", st) as any;
    const config = must("config", cf) as any;
    const budget = must("budgets", bu) as any;
    const P = profil.personnes ?? {};
    const people = ["p1", ...(P.p2 ? ["p2"] : [])];
    const ref = today();
    const donnees: Donnees = { profil, biens, credits, positions, config, lignes: Array.isArray(budget?.lignes) ? budget.lignes : [] };

    const scopeView = (scope: string) => {
      const b = bilan(donnees, scope);
      return {
        patrimoine_financier: r2(b.financier), a_recevoir: r2(b.aRecevoir), immobilier: r2(b.immobilier),
        biens_usage: r2(b.usage), entreprise: r2(b.entreprise), dettes: r2(b.dettes),
        patrimoine_brut: r2(b.brut), patrimoine_net: r2(b.net),
        revenus_mensuels_nets: { salaires: r2(b.salaires), autres_revenus: r2(b.autresRevenus), loyers: r2(b.loyers), total: r2(b.revenus) },
        mensualites: r2(b.mensualites),
        score_sante: scoreSante(donnees, scope).total,
      };
    };
    const parPoche: Record<string, number> = {};
    positions.filter(counted).forEach((p) => { parPoche[p.bloc || "Sans poche"] = r2((parPoche[p.bloc || "Sans poche"] ?? 0) + val(p)); });
    const stale = positions.filter((p) => isStale(p, ref));
    const result: any = {
      date: ref,
      personnes: Object.fromEntries(people.map((k) => [k, P[k]?.nom ?? k])),
      foyer: scopeView("foyer"),
    };
    for (const k of people) result[k] = scopeView(k);
    Object.assign(result, {
      par_poche_foyer: parPoche,
      positions: { total: positions.length, actives: positions.filter(counted).length },
      positions_sans_cours_recent: { nombre: stale.length, seuil_jours: STALE_DAYS, lignes: stale.slice(0, 15).map((p) => ({ id: p.id, nom: p.name, isin: p.isin, cours_date: p.instrument?.price_date ?? null })) },
      derniere_photo: snap ? { date: snap.date, total: snap.total != null ? r2(Number(snap.total)) : null } : null,
      derniere_mise_a_jour_nocturne: status?.last_run ?? null,
      resume_nocturne: status?.summary ?? null,
      alertes: status?.alerts ?? [],
      budget: donnees.lignes.length ? { nombre_lignes: donnees.lignes.length, totaux_mensuels_foyer: viewTotaux(budgetTotaux(donnees, "foyer")) } : null,
      sante: scoreSante(donnees, "foyer"),
      profil_risque: vueRisque(profil.risque ?? null, donnees, "foyer", profil.classes, false),
      bonnes_pratiques: bonnesPratiques({ d: donnees, scope: "foyer", objectifs, risque: profil.risque ?? null, classes: profil.classes, ref }),
    });
    return result;
  }));

  /* ---------- get_profile ---------- */
  server.registerTool("get_profile", {
    title: "Profil du foyer",
    description: "Profil du foyer (foyer, personnes p1/p2 avec prénoms et revenus, autres actifs, réglages) avec la liste des biens immobiliers et des crédits.",
    inputSchema: z.strictObject({}),
    annotations: RO,
  }, wrap(async () => {
    const [pr, bi, cr] = await Promise.all([
      db.from("profiles").select("foyer, personnes, autres, settings, onboarding_done, updated_at").maybeSingle(),
      db.from("biens").select("id, nom, usage, valeur, part_p1, crd, mensualite, loyer").order("created_at"),
      db.from("credits").select("id, nom, owner, crd, mensualite").order("created_at"),
    ]);
    return { profil: must("profiles", pr) ?? null, biens: must("biens", bi) ?? [], credits: must("credits", cr) ?? [] };
  }));

  /* ---------- dépôt de propositions (aucune écriture directe dans les tables du bilan) ---------- */
  type Prop = { cible: string; operation: "creer" | "modifier" | "supprimer"; ref?: string | null; avant?: any; apres?: any };
  const VALIDER = "à valider dans Boussole › Profil et données › Propositions";
  /** Insère les propositions d'un appel d'outil dans un même lot (ou dans `lot` fourni) ; ignore les doublons exacts déjà en attente. */
  async function deposer(items: Prop[], d: { source: string; justification?: string; lot?: string }, extra: Record<string, unknown> = {}) {
    const avertissements: string[] = Array.isArray(extra.avertissements) ? [...(extra.avertissements as string[])] : [];
    const { avertissements: _a, ...reste } = extra;
    if (!items.length) return { message: "Aucun changement : les valeurs fournies sont déjà enregistrées.", propositions: [], avertissements, ...reste };
    const attente = (must("propositions", await db.from("propositions").select("id, cible, operation, ref, apres").eq("statut", "en_attente")) as any[]) ?? [];
    const unique = (c: string) => ["profil", "risque", "protection"].includes(c);
    const nouveaux = items.filter((it) => {
      const doublon = attente.find((p) => p.cible === it.cible && p.operation === it.operation && (p.ref ?? null) === (it.ref ?? null) && same(p.apres, it.apres ?? null));
      if (doublon) { avertissements.push(`Déjà proposé et en attente (${it.cible}${it.ref ? " " + it.ref : ""}) : non redéposé.`); return false; }
      const voisin = attente.find((p) => p.cible === it.cible && (it.ref ? p.ref === it.ref : unique(it.cible)));
      if (voisin) avertissements.push(`Une autre proposition sur ${it.cible}${it.ref ? " " + it.ref : ""} attend déjà la validation de l'utilisateur (list_propositions).`);
      return true;
    });
    if (!nouveaux.length) return { message: "Aucune nouvelle proposition : tout est déjà en attente de validation.", propositions: [], avertissements, ...reste };
    const lot = d.lot ?? crypto.randomUUID();
    const rows = nouveaux.map((it) => ({ lot, cible: it.cible, operation: it.operation, ref: it.ref ?? null, avant: it.avant ?? null, apres: it.apres ?? null,
      source: d.source, justification: d.justification ?? null }));
    const data = (must("propositions", await db.from("propositions").insert(rows).select("id, cible, operation, ref, avant, apres")) as any[]) ?? [];
    const n = data.length;
    return { message: `${n} proposition${n > 1 ? "s" : ""} déposée${n > 1 ? "s" : ""}, ${VALIDER}. Rien n'est appliqué tant que l'utilisateur ne l'a pas validé.`,
      lot, propositions: data, avertissements, ...reste };
  }
  const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
  /** Égalité tolérante (12 = "12", numeric renvoyé en texte). */
  const pareil = (a: unknown, b: unknown) => same(a, b) ||
    (a != null && b != null && typeof a !== "object" && typeof b !== "object" && a !== "" && b !== "" && !isNaN(Number(a)) && !isNaN(Number(b)) && Number(a) === Number(b));
  /** Correctif réduit aux valeurs qui changent (récursif sur les objets), avec les valeurs actuelles correspondantes ; null si rien ne change. */
  function correctif(cur: any, patch: any): { avant: any; apres: any } | null {
    const avant: any = {}, apres: any = {};
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (v === undefined) continue;
      const c = cur?.[k];
      if (isObj(v)) { const sub = correctif(isObj(c) ? c : {}, v); if (sub) { avant[k] = isObj(c) ? sub.avant : (c ?? null); apres[k] = sub.apres; } continue; }
      if (v === null ? c == null : pareil(c, v)) continue;
      avant[k] = c ?? null; apres[k] = v;
    }
    return Object.keys(apres).length ? { avant, apres } : null;
  }
  /** Écart entre deux versions complètes d'une ligne (clé disparue = null). */
  function ecart(a: any, b: any, ignorer: string[] = []): { avant: any; apres: any } | null {
    const avant: any = {}, apres: any = {};
    for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      if (ignorer.includes(k) || pareil(a?.[k] ?? null, b?.[k] ?? null)) continue;
      avant[k] = a?.[k] ?? null; apres[k] = b?.[k] ?? null;
    }
    return Object.keys(apres).length ? { avant, apres } : null;
  }
  const sansMeta = (r: any) => { const { user_id: _u, created_at: _c, updated_at: _m, ...rest } = r ?? {}; return rest; };
  const PROPOSE = "Rien n'est écrit directement : dépose une proposition (avant / après, source) que l'utilisateur valide dans Boussole.";

  /* ---------- update_profile ---------- */
  server.registerTool("update_profile", {
    title: "Proposer une modification du profil",
    description: "Propose une modification du profil par fusion : seuls les champs fournis changent ; null efface un champ ; personnes.p2 = null retire la seconde personne ; foyer.biensRenseignes = true enregistre « aucun bien ni crédit ». " + PROPOSE,
    inputSchema: z.strictObject({
      foyer: FoyerPatch.optional(),
      personnes: z.strictObject({ p1: PersonnePatch.optional(), p2: PersonnePatch.nullable().optional() }).optional(),
      autres: z.strictObject({ p1: AutresPatch.optional(), p2: AutresPatch.optional() }).optional().describe("Autres actifs par personne."),
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (args: any) => {
    if (!args.foyer && !args.personnes && !args.autres) throw new UserError("Rien à modifier : fournissez foyer, personnes ou autres.");
    const cur = must("profiles", await db.from("profiles").select("foyer, personnes, autres").maybeSingle()) as any;
    const before = { foyer: cur?.foyer ?? {}, personnes: cur?.personnes ?? { p1: { nom: "Moi" } }, autres: cur?.autres ?? {} };
    if (args.personnes?.p2) {
      const p2 = { ...(before.personnes.p2 ?? {}), ...args.personnes.p2 };
      if (!p2.nom) throw new UserError("Indiquez le prénom de la seconde personne (personnes.p2.nom).");
    }
    const patch = clean({ foyer: args.foyer, personnes: args.personnes, autres: args.autres });
    const ch = correctif(before, patch);
    return deposer(ch ? [{ cible: "profil", operation: "modifier", avant: ch.avant, apres: ch.apres }] : [], args);
  }));

  /* ---------- biens / crédits ---------- */
  async function proposerLignes(table: "biens" | "credits", cible: "bien" | "credit", rows: any[], label: string, check: (row: any, nom: string) => string[], d: any) {
    if (!rows.length) throw new UserError("Aucune ligne fournie.");
    const ids = rows.filter((r) => r.id).map((r) => r.id);
    const existing = ids.length ? (must(table, await db.from(table).select("*").in("id", ids)) as any[]) : [];
    const byId = new Map(existing.map((r) => [r.id, r]));
    const errors: string[] = [], warnings: string[] = [];
    rows.forEach((r, i) => {
      const L = `Ligne ${i + 1}`;
      if (r.id && !byId.has(r.id)) errors.push(`${L} : ${label} ${r.id} introuvable.`);
      if (!r.id && !r.nom) errors.push(`${L} : nom requis pour créer un ${label}.`);
      const merged = { ...(byId.get(r.id) ?? {}), ...r };
      warnings.push(...check(merged, merged.nom || L));
    });
    if (errors.length) throw new UserError("Aucune proposition déposée.\n" + errors.join("\n"));
    const items: Prop[] = [];
    for (const r of rows) {
      const { id, ...patch } = r;
      if (!id) { items.push({ cible, operation: "creer", apres: patch }); continue; }
      const ch = correctif(byId.get(id), patch);
      if (ch) items.push({ cible, operation: "modifier", ref: id, avant: ch.avant, apres: ch.apres });
    }
    return deposer(items, d, { avertissements: warnings });
  }

  server.registerTool("upsert_biens", {
    title: "Proposer des biens immobiliers",
    description: "Propose la création (sans id) ou la modification (avec id, seuls les champs fournis changent) de biens immobiliers. Montants en euros, ≥ 0 ; part_p1 entre 0 et 100. " + PROPOSE,
    inputSchema: z.strictObject({ rows: z.array(BienRow).min(1).max(50), ...DEPOT }),
    annotations: RW,
  }, wrap(async (a: any) => proposerLignes("biens", "bien", a.rows, "bien", (b, nom) =>
    pos(b.crd) > pos(b.valeur) && pos(b.valeur) > 0 ? [`${nom} : le capital restant dû dépasse la valeur du bien.`] : [], a)));

  server.registerTool("upsert_credits", {
    title: "Proposer des crédits",
    description: "Propose la création (sans id) ou la modification (avec id) de crédits hors immobilier : nom, titulaire (p1, p2 ou commun), capital restant dû, mensualité. " + PROPOSE,
    inputSchema: z.strictObject({ rows: z.array(CreditRow).min(1).max(50), ...DEPOT }),
    annotations: RW,
  }, wrap(async (a: any) => proposerLignes("credits", "credit", a.rows, "crédit", () => [], a)));

  for (const [name, table, cible, label] of [["delete_bien", "biens", "bien", "Bien"], ["delete_credit", "credits", "credit", "Crédit"]] as const) {
    server.registerTool(name, {
      title: `Proposer la suppression d'un ${label.toLowerCase()}`,
      description: `Propose la suppression d'un ${label.toLowerCase()} par son id (appliquée seulement après validation par l'utilisateur dans Boussole).`,
      inputSchema: z.strictObject({ id: uuid, ...DEPOT }),
      annotations: RW,
    }, wrap(async (a: any) => {
      const row = must(table, await db.from(table).select("*").eq("id", a.id).maybeSingle()) as any;
      if (!row) throw new UserError(`${label} ${a.id} introuvable.`);
      return deposer([{ cible, operation: "supprimer", ref: a.id, avant: sansMeta(row) }], a);
    }));
  }

  /* ---------- positions ---------- */
  server.registerTool("list_positions", {
    title: "Lister les placements",
    description: "Liste des lignes de placement avec instrument, cours (et sa date) et valeur calculée (quantité × cours pour les titres cotés, valeur saisie sinon).",
    inputSchema: z.strictObject({ inclure_cloturees: z.boolean().optional().describe("Inclure les lignes clôturées (défaut : non).") }),
    annotations: RO,
  }, wrap(async ({ inclure_cloturees }: any) => {
    const rows = (must("positions", await db.from("positions").select(POS_SELECT).order("envelope").order("name")) as any[]) ?? [];
    const list = rows.filter((p) => inclure_cloturees || p.status !== "clôturé");
    return { personnes: await loadPeople(db), nombre: list.length, total_compte: r2(sum(list.filter(counted), val)), positions: list.map(viewPosition) };
  }));

  server.registerTool("upsert_positions", {
    title: "Proposer des placements",
    description: "Propose la création (sans id) ou la modification (avec id, seuls les champs fournis changent) de lignes de placement. Titre coté : mode market, ISIN et quantité (le cours est mis à jour chaque nuit). Livret, fonds euros, SCPI : mode manual et valeur. Pour un achat ou une vente sur une ligne existante, préférer record_transaction. " + PROPOSE,
    inputSchema: z.strictObject({ rows: z.array(PositionRow).min(1).max(100), ...DEPOT }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const rows = a.rows;
    const people = await loadPeople(db);
    const ids = rows.filter((r: any) => r.id).map((r: any) => r.id);
    const existing = ids.length ? (must("positions", await db.from("positions").select("*").in("id", ids)) as any[]) : [];
    const byId = new Map(existing.map((r) => [r.id, r]));
    const errors: string[] = [], warnings: string[] = [];
    const prepared = rows.map((r: any, i: number) => {
      const L = `Ligne ${i + 1}${r.name ? " (" + r.name + ")" : ""}`;
      const row: any = { ...r };
      if (row.isin != null) {
        row.isin = String(row.isin).trim().toUpperCase().replace(/\s/g, "") || null;
        if (row.isin && !ISIN_RE.test(row.isin)) errors.push(`${L} : ISIN « ${row.isin} » invalide (2 lettres, 9 caractères, 1 chiffre).`);
      }
      const old = row.id ? byId.get(row.id) : null;
      if (row.id && !old) errors.push(`${L} : ligne ${row.id} introuvable.`);
      if (!row.id) {
        if (!row.name) errors.push(`${L} : nom requis pour créer une ligne.`);
        if (!row.mode) row.mode = row.isin && row.qty != null ? "market" : "manual";
        if (row.mode === "manual" && row.value == null) errors.push(`${L} : indiquez la valeur (ligne manuelle) ou un ISIN et une quantité (titre coté).`);
        if (row.value != null) row.value_date = today();
      } else if (old && row.value != null && Number(row.value) !== Number(old.value)) row.value_date = today();
      const m = { ...(old ?? {}), ...row };
      if (m.mode === "market" && (!m.isin || m.qty == null)) errors.push(`${L} : une ligne cotée (market) exige un ISIN et une quantité.`);
      if (m.owner === "p2" && !people.p2) warnings.push(`${L} : titulaire p2 alors que le profil ne compte qu'une personne.`);
      if (m.status === "clôturé" && m.mode === "market" && Number(m.qty) > 0) warnings.push(`${L} : ligne clôturée avec une quantité non nulle.`);
      return row;
    });
    if (errors.length) throw new UserError("Aucune proposition déposée.\n" + errors.join("\n"));

    // Instruments inconnus : demandés (sans prix) à la validation ; la fonction nocturne les cotera.
    const isins = [...new Set(prepared.map((r: any) => r.isin).filter(Boolean))] as string[];
    if (isins.length) {
      const known = new Set(((must("instruments", await db.from("instruments").select("isin").in("isin", isins)) as any[]) ?? []).map((x) => x.isin));
      const nouveaux = isins.filter((x) => !known.has(x));
      if (nouveaux.length) warnings.push(`Nouveaux instruments (${nouveaux.join(", ")}) : cours récupéré lors de la mise à jour nocturne qui suit la validation.`);
    }
    const items: Prop[] = [];
    for (const r of prepared) {
      const { id, ...patch } = r;
      if (!id) { items.push({ cible: "position", operation: "creer", apres: patch }); continue; }
      const ch = correctif(byId.get(id), patch);
      if (ch && Object.keys(ch.apres).some((k) => k !== "value_date")) items.push({ cible: "position", operation: "modifier", ref: id, avant: ch.avant, apres: ch.apres });
    }
    return deposer(items, a, { avertissements: warnings });
  }));

  /* ---------- record_transaction (mêmes règles que le formulaire de web/src/pilotage.js) ---------- */
  server.registerTool("record_transaction", {
    title: "Proposer un mouvement",
    description: "Propose un mouvement sur une ligne et la mise à jour de la ligne qui en découle : achat/vente (titre coté : quantité et prix ; ligne manuelle : montant), versement/retrait (montant ; converti en parts au cours pour un titre coté), solde (nouvelle quantité ou nouvelle valeur). Le PRU est pondéré à l'achat ; une vente qui ramène la quantité à 0 clôture la ligne. Le mouvement est enregistré quand l'utilisateur valide la proposition. " + PROPOSE,
    inputSchema: z.strictObject({
      position_id: uuid,
      type: z.enum(["achat", "vente", "versement", "retrait", "solde"]),
      qty: money.optional().describe("Quantité (titres cotés)."),
      price: z.number().positive().optional().describe("Prix unitaire en euros."),
      amount: money.optional().describe("Montant en euros (ligne manuelle, versement, retrait, nouveau solde)."),
      date: isoDate.optional().describe("Date du mouvement (défaut : aujourd'hui)."),
      note: z.string().max(200).optional(),
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const p = must("positions", await db.from("positions").select(POS_SELECT).eq("id", a.position_id).maybeSingle()) as any;
    if (!p) throw new UserError(`Ligne ${a.position_id} introuvable.`);
    const type = a.type, date = a.date ?? today();
    let qty: number | null = a.qty ?? null, price: number | null = a.price ?? null, amt: number | null = a.amount ?? null;
    const curPrice = effectivePrice(p);
    const upd: any = {};
    const no = (m: string) => { throw new UserError(m); };
    if (type === "achat" || type === "vente") {
      if (p.mode !== "market") {
        if (amt == null && qty != null && price != null) amt = qty * price;
        if (amt == null) no("Indiquez un montant pour une ligne à valeur manuelle.");
        upd.value = num(p.value) + (type === "achat" ? amt! : -amt!);
        if (upd.value < -1e-9) no("Montant de la vente supérieur à la valeur de la ligne.");
        upd.value_date = date;
      } else {
        if (qty == null && amt != null && price) qty = amt / price;
        if (qty == null || price == null) no("Indiquez la quantité et le prix unitaire.");
        const q0 = num(p.qty);
        if (type === "achat") { const q1 = q0 + qty!; upd.qty = q1; upd.pru = p.pru ? (Number(p.pru) * q0 + qty! * price!) / q1 : price; }
        else {
          if (qty! > q0 + 1e-9) no("Quantité vendue supérieure à la quantité détenue.");
          upd.qty = q0 - qty!;
          if (upd.qty < 1e-9) { upd.qty = 0; upd.status = "clôturé"; }
        }
        amt = qty! * price!;
      }
    } else if (type === "versement" || type === "retrait") {
      if (amt == null) no("Indiquez un montant.");
      if (p.mode === "market") {
        const px = price || curPrice;
        if (!px) no("Indiquez le prix unitaire pour convertir le montant en parts.");
        qty = amt! / px!; price = px;
        const q0 = num(p.qty), q1 = type === "versement" ? q0 + qty : q0 - qty;
        if (q1 < -1e-9) no("Retrait supérieur à la position.");
        upd.qty = Math.max(0, q1);
        if (type === "versement") upd.pru = p.pru ? (Number(p.pru) * q0 + amt!) / q1 : px;
      } else {
        upd.value = num(p.value) + (type === "versement" ? amt! : -amt!);
        if (upd.value < -1e-9) no("Retrait supérieur à la valeur de la ligne.");
        upd.value_date = date;
      }
    } else {
      if (p.mode === "market") { if (qty == null) no("Indiquez la nouvelle quantité."); upd.qty = qty; upd.qty_estimated = false; }
      else { if (amt == null) no("Indiquez le nouveau solde."); upd.value = amt; upd.value_date = date; }
    }
    if (upd.pru != null) upd.pru = Math.round(upd.pru * 1e6) / 1e6;
    if (upd.qty != null) upd.qty = Math.round(upd.qty * 1e8) / 1e8;

    const avant = Object.fromEntries(Object.keys(upd).map((k) => [k, p[k] ?? null]));
    const transaction = { date, type, qty: qty ?? null, price: price ?? null, amount: amt != null ? r2(amt) : null, note: a.note ?? null, source: "mcp" };
    const extra: any = { ligne: { id: p.id, nom: p.name }, valeur_ligne_apres_validation: r2(val({ ...p, ...upd })) };
    if (p.mode === "market" && curPrice == null) extra.avertissements = ["Cours non encore disponible : la ligne sera valorisée après la prochaine mise à jour nocturne."];
    return deposer([{ cible: "position", operation: "modifier", ref: p.id, avant, apres: { ...upd, transaction } }], a, extra);
  }));

  /* ---------- config ---------- */
  const CONFIG_FIELDS = "targets, rules, cushion, recurring, todo, milestones, hypotheses, updated_at";
  server.registerTool("get_config", {
    title: "Réglages",
    description: "Réglages de pilotage : cibles d'allocation par poche (targets), règles d'alerte (rules), matelas de sécurité (cushion), versements programmés (recurring), ordres à passer (todo), échéances (milestones), hypothèses.",
    inputSchema: z.strictObject({}),
    annotations: RO,
  }, wrap(async () => ({ config: must("config", await db.from("config").select(CONFIG_FIELDS).maybeSingle()) ?? null })));

  /* Réglages : écriture directe limitée aux préférences sans montant du bilan (cibles d'allocation en %, règles d'alerte,
     ordres à passer, échéances, hypothèses). Le matelas (montants) et les versements programmés (qui modifient les lignes
     chaque nuit) ne sont pas modifiables par le connecteur : l'utilisateur les règle dans Boussole. */
  server.registerTool("update_config", {
    title: "Modifier les réglages",
    description: "Modifie directement des réglages sans montant du bilan, par fusion. targets : seuls les champs fournis changent. rules, todo, milestones, hypotheses : la liste fournie remplace la liste existante (relire get_config et renvoyer la liste complète). Règles possibles : {type:'max_line_pct', pct}, {type:'max_bloc_pct', bloc, pct}, {type:'price_floor', position_id, price}, {type:'envelope_cap', envelope, cap}, {type:'stale_prices', days}. Le matelas de sécurité et les versements programmés se règlent dans Boussole (non modifiables ici). Demander confirmation à l'utilisateur avant.",
    inputSchema: z.strictObject({
      targets: TargetsPatch.optional(),
      rules: z.array(RuleSchema).max(50).optional(),
      todo: z.array(TodoItem).max(100).optional(),
      milestones: z.array(MilestoneItem).max(50).optional(),
      hypotheses: z.array(HypothesisItem).max(50).optional(),
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const keys = ["targets", "rules", "todo", "milestones", "hypotheses"].filter((k) => a[k] !== undefined);
    if (!keys.length) throw new UserError("Rien à modifier.");
    const cur = must("config", await db.from("config").select(CONFIG_FIELDS).maybeSingle()) as any;
    const before: any = { targets: cur?.targets ?? { tolerancePts: 3 }, rules: cur?.rules ?? [], todo: cur?.todo ?? [], milestones: cur?.milestones ?? [], hypotheses: cur?.hypotheses ?? [] };
    const patch: any = {};
    if (a.targets) {
      const t = structuredClone(before.targets);
      for (const k of ["p1", "p2"]) if (a.targets[k]) t[k] = clean({ ...(t[k] ?? {}), ...a.targets[k] });
      if (a.targets.tolerancePts != null) t.tolerancePts = a.targets.tolerancePts;
      patch.targets = t;
    }
    for (const k of ["rules", "todo", "milestones", "hypotheses"]) if (a[k] !== undefined) patch[k] = a[k];
    // Les règles doivent viser des lignes existantes.
    const refs = (a.rules ?? []).filter((r: any) => r.type === "price_floor").map((r: any) => r.position_id);
    if (refs.length) {
      const found = new Set(((must("positions", await db.from("positions").select("id").in("id", [...new Set(refs)])) as any[]) ?? []).map((x) => x.id));
      const missing = refs.filter((id: string) => !found.has(id));
      if (missing.length) throw new UserError("Aucune écriture effectuée : ligne(s) introuvable(s) " + [...new Set(missing)].join(", ") + ".");
    }
    const changes = keys.filter((k) => !same(before[k], patch[k] ?? before[k]));
    if (!changes.length) return { modifications: [], message: "Aucun changement." };
    if (cur) must("config", await db.from("config").update(patch).eq("user_id", user.id).select("user_id").single());
    else must("config", await db.from("config").insert(patch).select("user_id").single());
    return { modifications: changes.map((k) => ({ champ: k, avant: before[k], apres: patch[k] })) };
  }));

  /* ---------- budget (table budgets, une ligne par utilisateur) ---------- */
  async function loadPlan(withObjectifs: boolean) {
    const [pr, bi, cr, po, cf, bu, ob] = await Promise.all([
      db.from("profiles").select("foyer, personnes, autres").maybeSingle(),
      db.from("biens").select("*"),
      db.from("credits").select("*"),
      db.from("positions").select(POS_SELECT),
      db.from("config").select("cushion").maybeSingle(),
      db.from("budgets").select("lignes, updated_at").maybeSingle(),
      withObjectifs ? db.from("objectifs").select("*").order("priorite").order("created_at") : Promise.resolve({ data: [], error: null }),
    ]);
    const budget = must("budgets", bu) as any;
    const d: Donnees = {
      profil: (must("profiles", pr) as any) ?? {}, biens: (must("biens", bi) as any[]) ?? [], credits: (must("credits", cr) as any[]) ?? [],
      positions: (must("positions", po) as any[]) ?? [], config: must("config", cf) as any,
      lignes: Array.isArray(budget?.lignes) ? budget.lignes : [],
    };
    return { d, budget, objectifs: (must("objectifs", ob) as any[]) ?? [] };
  }
  const peopleOf = (d: Donnees) => ["p1", ...(d.profil?.personnes?.p2 ? ["p2"] : [])];
  const totauxParScope = (d: Donnees) => Object.fromEntries(["foyer", ...peopleOf(d)].map((k) => [k, viewTotaux(budgetTotaux(d, k))]));

  server.registerTool("get_budget", {
    title: "Budget mensuel",
    description: "Lignes du budget (revenus, dépenses par catégorie, épargne ; montant par mois ou par an ; titulaire p1, p2 ou commun) et totaux mensuels par périmètre (foyer, p1, p2). Les revenus incluent les salaires, autres revenus et loyers du profil ; les dépenses incluent les mensualités de crédit du profil. taux_epargne = (épargne + reste positif) / revenus.",
    inputSchema: z.strictObject({}),
    annotations: RO,
  }, wrap(async () => {
    const { d, budget } = await loadPlan(false);
    return { personnes: await loadPeople(db), lignes: d.lignes, mis_a_jour: budget?.updated_at ?? null, totaux: totauxParScope(d) };
  }));

  server.registerTool("update_budget", {
    title: "Proposer des changements de budget",
    description: "Propose des changements du budget mensuel. mode fusionner (défaut) : chaque ligne fournie est rapprochée d'une ligne existante par id, sinon par libellé (sans tenir compte de la casse) ; seuls les champs fournis changent ; les lignes non rapprochées sont ajoutées (type, libelle et montant requis) ; les autres lignes restent. mode remplacer : la liste fournie devient le budget complet (relire get_budget avant). Ne pas y mettre le salaire ni les mensualités de crédit : ils viennent déjà du profil. Une proposition par ligne ajoutée, modifiée ou retirée. " + PROPOSE,
    inputSchema: z.strictObject({
      lignes: z.array(BudgetLigne).max(200),
      mode: z.enum(["remplacer", "fusionner"], { error: "Mode invalide : remplacer ou fusionner." }).optional().describe("fusionner (défaut) ou remplacer."),
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const { lignes, mode = "fusionner" } = a;
    if (mode === "fusionner" && !lignes.length) throw new UserError("Rien à modifier : fournissez au moins une ligne.");
    const { d } = await loadPlan(false);
    const before: any[] = d.lignes.map((l) => ({ ...l }));
    const errors: string[] = [];
    const complete = (l: any, L: string) => {
      const miss = ["type", "libelle", "montant"].filter((k) => l[k] == null || l[k] === "");
      if (miss.length) errors.push(`${L} : ${miss.join(", ")} requis pour une nouvelle ligne.`);
      const o: any = { id: l.id ?? crypto.randomUUID(), type: l.type, categorie: l.categorie ?? "", libelle: l.libelle ?? "", montant: l.montant, frequence: l.frequence ?? "mois" };
      if (l.owner) o.owner = l.owner;
      return o;
    };
    let after: any[];
    if (mode === "remplacer") {
      after = lignes.map((l: any, i: number) => complete(l, `Ligne ${i + 1}${l.libelle ? " (" + l.libelle + ")" : ""}`));
    } else {
      after = before.map((l) => ({ ...l }));
      const key = (x: unknown) => String(x ?? "").trim().toLowerCase();
      lignes.forEach((l: any, i: number) => {
        const L = `Ligne ${i + 1}${l.libelle ? " (" + l.libelle + ")" : ""}`;
        let k = l.id ? after.findIndex((x) => String(x.id) === l.id) : -1;
        const parId = k >= 0;
        if (k < 0 && l.libelle) k = after.findIndex((x) => key(x.libelle) === key(l.libelle));
        if (k < 0) { after.push(complete(l, L)); return; }
        const { id: _id, owner, ...patch } = l;
        if (!parId) delete patch.libelle; // rapprochée par libellé : on garde l'écriture existante
        const cur = { ...after[k], ...clean(patch) };
        if (owner === null) delete cur.owner;
        else if (owner !== undefined) cur.owner = owner;
        after[k] = cur;
      });
    }
    const ids = after.map((l) => String(l.id));
    if (new Set(ids).size !== ids.length) errors.push("Deux lignes portent le même identifiant.");
    if (errors.length) throw new UserError("Aucune proposition déposée.\n" + errors.join("\n"));

    const byId = (list: any[]) => new Map(list.map((l) => [String(l.id), l]));
    const B = byId(before), A2 = byId(after);
    const items: Prop[] = [];
    after.filter((l) => !B.has(String(l.id))).forEach((l) => items.push({ cible: "budget", operation: "creer", apres: l }));
    after.filter((l) => B.has(String(l.id))).forEach((l) => {
      const ch = ecart(B.get(String(l.id)), l, ["id"]);
      if (ch) items.push({ cible: "budget", operation: "modifier", ref: String(l.id), avant: { libelle: B.get(String(l.id)).libelle, ...ch.avant }, apres: ch.apres });
    });
    before.filter((l) => !A2.has(String(l.id))).forEach((l) => items.push({ cible: "budget", operation: "supprimer", ref: String(l.id), avant: l }));
    const resume = (list: any[]) => {
      const t = budgetTotaux({ ...d, lignes: list }, "foyer");
      return { nombre_lignes: list.length, revenus: r2(t.revenus), depenses: r2(t.depenses), epargne: r2(t.epargne), reste: r2(t.reste),
        taux_epargne: t.tauxEpargne == null ? null : Math.round(t.tauxEpargne * 10000) / 10000 };
    };
    return deposer(items, a, { mode, budget_actuel: resume(before), budget_si_tout_est_valide: resume(after) });
  }));

  /* ---------- objectifs ---------- */
  const viewObjectif = (o: any) => {
    const { user_id: _u, created_at: _c, ...rest } = o;
    return { ...rest, cible: num(o.cible), deja: num(o.deja), rendement: num(o.rendement) };
  };

  server.registerTool("list_objectifs", {
    title: "Lister les objectifs",
    description: "Objectifs datés (apport, matelas, retraite, projet) avec, pour chacun : montant déjà réuni (saisi, ou poches / enveloppes rattachées réparties en cascade par priorité : une même ligne ne finance jamais deux objectifs), effort mensuel requis d'ici l'échéance (versement constant, rendement attendu), mois restants, versement alloué (épargne mensuelle du budget répartie par priorité puis échéance), date d'atteinte à ce rythme et statut (atteint, avance, dans_les_temps, retard, hors_portee).",
    inputSchema: z.strictObject({}),
    annotations: RO,
  }, wrap(async () => {
    const { d, objectifs } = await loadPlan(true);
    const ref = today();
    const deja = affecterDeja(objectifs, d.positions, "foyer");
    const t = budgetTotaux(d, "foyer");
    const epargneMensuelle = Math.max(0, t.epargne + Math.max(0, t.reste));
    const alloue = repartirEpargne(objectifs, deja, epargneMensuelle, ref);
    return {
      date: ref,
      epargne_mensuelle_repartie: r2(epargneMensuelle),
      note: "Épargne répartie = lignes d'épargne du budget + reste positif (foyer). Montants « poches » répartis en cascade par priorité.",
      objectifs: objectifs.map((o) => {
        const dj = deja[o.id] ?? 0, v = alloue[o.id] ?? 0, st = statutObjectif(o, dj, v, ref);
        return {
          ...viewObjectif(o), deja_saisi: num(o.deja), deja: r2(dj), progression: Math.round(st.progression * 1000) / 1000,
          mois_restants: st.mois, effort_mensuel: isFinite(st.effort) ? r2(st.effort) : null,
          versement_alloue: r2(v), date_atteinte: st.atteinte, statut: st.statut, statut_libelle: STATUTS[st.statut],
        };
      }),
    };
  }));

  const OBJ_COLS: Record<string, string> = { nom: "nom", type: "type", cible: "cible", dateCible: "date_cible", deja: "deja", source: "source", poches: "poches", enveloppes: "enveloppes", rendement: "rendement", priorite: "priorite" };
  server.registerTool("upsert_objectifs", {
    title: "Proposer des objectifs",
    description: "Propose la création (sans id : nom et cible requis) ou la modification (avec id : seuls les champs fournis changent) d'objectifs datés. Toutes les lignes sont validées avant tout dépôt. type : apport, matelas, retraite ou projet ; source : saisi (montant deja) ou poches (poches / enveloppes de Bilan › Placements rattachées) ; rendement en % par an (-50 à 50) ; priorite entière (1 = servi en premier). Le champ source de chaque ligne (saisi | poches) décrit l'objectif ; le paramètre source de l'appel indique d'où vient l'information. " + PROPOSE,
    inputSchema: z.strictObject({ rows: z.array(ObjectifRow).min(1).max(30), ...DEPOT }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const rows = a.rows;
    const ids = rows.filter((r: any) => r.id).map((r: any) => r.id);
    const existing = ids.length ? (must("objectifs", await db.from("objectifs").select("*").in("id", ids)) as any[]) : [];
    const byId = new Map(existing.map((r) => [r.id, r]));
    const errors: string[] = [], warnings: string[] = [];
    rows.forEach((r: any, i: number) => {
      const L = `Ligne ${i + 1}${r.nom ? " (" + r.nom + ")" : ""}`;
      if (r.id && !byId.has(r.id)) errors.push(`${L} : objectif ${r.id} introuvable.`);
      if (!r.id && (!r.nom || r.cible == null)) errors.push(`${L} : nom et cible requis pour créer un objectif.`);
      if (r.dateCible && isNaN(Date.parse(r.dateCible + "T00:00:00Z"))) errors.push(`${L} : date cible « ${r.dateCible} » invalide.`);
      const m = { ...(byId.get(r.id) ?? {}), ...r };
      if (m.source === "poches" && !(m.poches?.length || m.enveloppes?.length)) warnings.push(`${L} : source poches sans poche ni enveloppe rattachée (montant déjà réuni = 0).`);
      if (m.dateCible && m.dateCible < today()) warnings.push(`${L} : échéance déjà passée.`);
    });
    if (errors.length) throw new UserError("Aucune proposition déposée.\n" + errors.join("\n"));
    const toRow = (r: any) => Object.fromEntries(Object.entries(r).filter(([k]) => k in OBJ_COLS).map(([k, v]) => [OBJ_COLS[k], v]));
    const items: Prop[] = [];
    for (const r of rows) {
      if (!r.id) { items.push({ cible: "objectif", operation: "creer", apres: toRow(r) }); continue; }
      const ch = correctif(byId.get(r.id), toRow(r));
      if (ch) items.push({ cible: "objectif", operation: "modifier", ref: r.id, avant: { nom: byId.get(r.id).nom, ...ch.avant }, apres: ch.apres });
    }
    return deposer(items, a, { avertissements: warnings });
  }));

  server.registerTool("delete_objectif", {
    title: "Proposer la suppression d'un objectif",
    description: "Propose la suppression d'un objectif par son id (appliquée seulement après validation par l'utilisateur dans Boussole).",
    inputSchema: z.strictObject({ id: uuid, ...DEPOT }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const row = must("objectifs", await db.from("objectifs").select("*").eq("id", a.id).maybeSingle()) as any;
    if (!row) throw new UserError(`Objectif ${a.id} introuvable.`);
    return deposer([{ cible: "objectif", operation: "supprimer", ref: a.id, avant: viewObjectif(row) }], a);
  }));

  /* ---------- Diagnostic : profil de risque ---------- */
  server.registerTool("get_risk_profile", {
    title: "Profil de risque",
    description: "Profil de risque déclaré par l'utilisateur (questionnaire de l'application : Prudent, Modéré, Équilibré, Dynamique ou Offensif, perte maximale tolérée, date et réponses), allocation réelle des placements par classe comparée aux fourchettes cibles du profil (écarts en points), risque réel du portefeuille (volatilité annuelle, baisse plausible sur un an, contribution de chaque classe) et profil équivalent. Indicateur pédagogique, pas un conseil en investissement.",
    inputSchema: z.strictObject({
      perimetre: z.enum(["foyer", "p1", "p2"], { error: "Périmètre invalide : foyer, p1 ou p2." }).optional().describe("foyer (défaut), p1 ou p2 : placements pris en compte."),
    }),
    annotations: RO,
  }, wrap(async ({ perimetre = "foyer" }: any) => {
    const [pr, po] = await Promise.all([
      db.from("profiles").select("risque, classes, personnes").maybeSingle(),
      db.from("positions").select(POS_SELECT),
    ]);
    const profil = (must("profiles", pr) as any) ?? {};
    const positions = (must("positions", po) as any[]) ?? [];
    if (perimetre === "p2" && !profil.personnes?.p2) throw new UserError("Le foyer ne compte qu'une personne : utilisez foyer ou p1.");
    const d: Donnees = { profil, biens: [], credits: [], positions, config: null, lignes: [] };
    return vueRisque(profil.risque ?? null, d, perimetre, profil.classes, true);
  }));

  /* ---------- Diagnostic : annotation des fonds (RPC annoter_instrument) ---------- */
  server.registerTool("annotate_instrument", {
    title: "Annoter un fonds",
    description: "Renseigne les frais (TER), la zone géographique et la devise d'un fonds détenu, avec la source consultée. Seuls les instruments présents dans les lignes de l'utilisateur peuvent être annotés ; la source (URL du document d'informations clés ou de la page de l'émetteur) est obligatoire ; les champs non fournis restent inchangés. L'annotation est partagée par tous les détenteurs de cet ISIN.",
    inputSchema: z.strictObject({
      isin: z.string().trim().min(1).max(20).describe("ISIN du fonds (12 caractères), tel qu'il figure dans list_positions."),
      ter: z.number({ error: "TER : nombre attendu, en % par an." }).min(0, { error: "TER entre 0 et 10 % par an." }).max(10, { error: "TER entre 0 et 10 % par an." }).optional()
        .describe("Frais courants (TER / frais courants du DIC) en % par an : 0.2 pour 0,20 %."),
      zone: z.string().trim().min(1).max(60, { error: "Zone : 60 caractères au plus." }).optional().describe("Zone géographique couverte : Monde, États-Unis, Europe, Zone euro, France, Émergents…"),
      devise: z.string().trim().regex(/^[A-Za-z]{3}$/, { error: "Devise : code ISO à 3 lettres (EUR, USD…)." }).optional()
        .describe("Devise d'exposition principale du fonds (code ISO : EUR, USD…), pas la devise de cotation."),
      source: z.string({ error: "Source obligatoire : URL ou référence du document consulté." }).trim().min(1, { error: "Source obligatoire : URL ou référence du document consulté." })
        .max(300, { error: "Source : 300 caractères au plus." }).describe("Obligatoire : URL ou référence précise du document consulté (DIC / KID, page de l'émetteur)."),
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const isin = String(a.isin).toUpperCase().replace(/\s/g, "");
    if (!ISIN_RE.test(isin) && !isin.startsWith("X-")) throw new UserError(`ISIN « ${isin} » invalide (2 lettres, 9 caractères, 1 chiffre).`);
    if (a.ter == null && a.zone == null && a.devise == null) throw new UserError("Rien à annoter : fournissez au moins ter, zone ou devise.");
    const lignes = (must("positions", await db.from("positions").select("id, name, status").eq("isin", isin)) as any[]) ?? [];
    if (!lignes.length) throw new UserError(`Aucune de vos lignes ne porte l'ISIN ${isin} : seuls les fonds détenus peuvent être annotés (voir list_positions).`);
    const ANN = "isin, name, ter, zone, devise, annote_source, annote_le";
    const avant = must("instruments", await db.from("instruments").select(ANN).eq("isin", isin).maybeSingle()) as any;
    const res = await db.rpc("annoter_instrument", { p_isin: isin, p_ter: a.ter ?? null, p_zone: a.zone ?? null, p_devise: a.devise ? a.devise.toUpperCase() : null, p_source: a.source });
    if (res.error) throw new UserError(`Annotation refusée : ${res.error.message ?? "erreur inconnue"}.`);
    const apres = res.data as any;
    const vue = (r: any) => r ? { frais_courants_pct: r.ter != null ? Number(r.ter) : null, zone: r.zone ?? null, devise_exposition: r.devise ?? null, source: r.annote_source ?? null, date: r.annote_le ?? null } : null;
    return {
      isin, instrument: apres?.name ?? avant?.name ?? null,
      lignes_concernees: lignes.map((l) => l.name),
      modifications: diff(vue(avant), vue(apres), "", 1).filter((m) => m.champ !== "date"),
      annotation: vue(apres),
    };
  }));

  /* ---------- Entretien guidé : état du bilan, propositions, profil de risque, protection ---------- */
  server.registerTool("etat_du_bilan", {
    title: "État du bilan",
    description: "Ce qui est renseigné et ce qui manque, section par section dans l'ordre d'un entretien (foyer, revenus, budget, épargne et placements, immobilier et crédits, protection, objectifs, profil de risque) : pourcentage d'avancement, statut de chaque section (complet, partiel, vide), questions manquantes avec leur « pourquoi », les 3 prochaines questions à poser et le nombre de propositions en attente de validation. À appeler au début de tout entretien : ne jamais reposer une question déjà répondue.",
    inputSchema: z.strictObject({}),
    annotations: RO,
  }, wrap(async () => {
    const [pr, bi, cr, po, bu, ob, pp] = await Promise.all([
      db.from("profiles").select("foyer, personnes, autres, protection, risque").maybeSingle(),
      db.from("biens").select("id, nom, valeur, crd").order("created_at"),
      db.from("credits").select("id, nom, crd").order("created_at"),
      db.from("positions").select(POS_SELECT),
      db.from("budgets").select("lignes").maybeSingle(),
      db.from("objectifs").select("id, nom, date_cible"),
      db.from("propositions").select("id, cible, operation, ref, statut").eq("statut", "en_attente").limit(200),
    ]);
    const S = etatDepuisLignes({
      profil: must("profiles", pr), biens: (must("biens", bi) as any[]) ?? [], credits: (must("credits", cr) as any[]) ?? [],
      positions: (must("positions", po) as any[]) ?? [], budget: must("budgets", bu), objectifs: (must("objectifs", ob) as any[]) ?? [],
      propositions: (must("propositions", pp) as any[]) ?? [],
    });
    const e = BilanEtat.etat(S, today());
    return {
      date: today(),
      pourcentage: e.pourcentage,
      sections: e.sections.map((s) => ({ cle: s.cle, titre: s.titre, statut: s.statut, faits: s.faits, total: s.total, manquants: s.manquants })),
      prochaines_questions: e.prochaines,
      propositions_en_attente: e.propositionsEnAttente,
      consigne: "Pose ces questions une à une, dans l'ordre, avec leur pourquoi ; ne repose pas ce qui est complet. Les propositions en attente (list_propositions) ne sont pas encore comptées : rappelle à l'utilisateur de les valider dans Boussole › Profil et données › Propositions.",
    };
  }));

  server.registerTool("list_propositions", {
    title: "Propositions déposées",
    description: "Propositions déposées par Claude (avant / après, source, justification, lot) : par défaut celles en attente de validation par l'utilisateur, pour éviter les doublons. statut = acceptee, refusee ou toutes pour l'historique (200 au plus, les plus récentes d'abord).",
    inputSchema: z.strictObject({
      statut: z.enum(["en_attente", "acceptee", "refusee", "toutes"], { error: "Statut invalide : en_attente, acceptee, refusee ou toutes." }).optional().describe("en_attente (défaut), acceptee, refusee ou toutes."),
    }),
    annotations: RO,
  }, wrap(async ({ statut = "en_attente" }: any) => {
    let req = db.from("propositions").select("id, lot, cible, operation, ref, avant, apres, source, justification, statut, cree_le, decide_le")
      .order("cree_le", { ascending: false }).limit(200);
    if (statut !== "toutes") req = req.eq("statut", statut);
    const list = (must("propositions", await req) as any[]) ?? [];
    return { statut, nombre: list.length, propositions: list,
      rappel: list.length && statut === "en_attente" ? "Ces changements attendent la validation de l'utilisateur dans Boussole › Profil et données › Propositions." : undefined };
  }));

  const RisqueReponses = z.strictObject(Object.fromEntries(QUESTIONS_RISQUE.map((q) => {
    const vals = q.valeurs as [string, ...string[]];
    const err = { error: `${q.id} : valeurs possibles ${q.valeurs.join(", ")}.` };
    const t: any = q.type === "multi" ? z.array(z.enum(vals, err)).min(1, { error: `${q.id} : au moins une valeur.` })
      : q.type === "nombre" ? z.number({ error: `${q.id} : nombre d'années (0 ou plus).` }).int({ error: `${q.id} : nombre entier d'années.` }).min(0).max(80)
      : z.enum(vals, err);
    const aide = q.type === "nombre" ? " Nombre d'années (0 si jamais)." : " Valeurs : " + q.valeurs.join(", ") + (q.type === "multi" ? " (plusieurs possibles ; aucun seul)." : ".");
    return [q.id, t.optional().describe(BilanEtat.RISQUE_LIBELLES[q.id] + aide)];
  })));

  server.registerTool("set_risk_answers", {
    title: "Proposer des réponses au profil de risque",
    description: "Propose les réponses de l'utilisateur au questionnaire de profil de risque (10 questions : horizon, objectif, reaction, perte_max, connaissances, experience, revenus, matelas, part_investie, age), validées contre les valeurs permises ; seules les réponses fournies changent. N'enregistre que ce que l'utilisateur a choisi lui-même, jamais une réponse déduite. Le profil (Prudent … Offensif) est calculé par l'application après validation. " + PROPOSE,
    inputSchema: z.strictObject({ reponses: RisqueReponses, ...DEPOT }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const rep = clean(a.reponses ?? {});
    if (!Object.keys(rep).length) throw new UserError("Aucune réponse fournie.");
    const avert: string[] = [];
    if (Array.isArray(rep.connaissances) && rep.connaissances.includes("aucun") && rep.connaissances.length > 1) avert.push("connaissances : « aucun » coché avec d'autres réponses ; l'application retiendra les réponses précises.");
    const cur = must("profiles", await db.from("profiles").select("risque").maybeSingle()) as any;
    const actuelles = isObj(cur?.risque?.reponses) ? cur.risque.reponses : {};
    const ch = correctif(actuelles, rep);
    return deposer(ch ? [{ cible: "risque", operation: isObj(cur?.risque) ? "modifier" : "creer", avant: ch.avant, apres: ch.apres }] : [], a, { avertissements: avert });
  }));

  server.registerTool("set_protection", {
    title: "Proposer la protection du foyer",
    description: "Propose la déclaration de protection du foyer : prevoyance (prévoyance décès / invalidité au-delà de celle de l'employeur) et emprunteur (crédits couverts par une assurance emprunteur), en booléens ; seuls les champs fournis changent. " + PROPOSE,
    inputSchema: z.strictObject({
      prevoyance: z.boolean({ error: "prevoyance : true ou false." }).optional().describe("true si une prévoyance (décès, invalidité) protège les revenus du foyer au-delà de celle de l'employeur."),
      emprunteur: z.boolean({ error: "emprunteur : true ou false." }).optional().describe("true si les crédits en cours sont couverts par une assurance emprunteur."),
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const patch = clean({ prevoyance: a.prevoyance, emprunteur: a.emprunteur });
    if (!Object.keys(patch).length) throw new UserError("Rien à proposer : fournissez prevoyance et/ou emprunteur.");
    const cur = must("profiles", await db.from("profiles").select("protection").maybeSingle()) as any;
    const actuelle = isObj(cur?.protection) ? cur.protection : {};
    const ch = correctif(actuelle, patch);
    return deposer(ch ? [{ cible: "protection", operation: Object.keys(actuelle).length ? "modifier" : "creer", avant: ch.avant, apres: ch.apres }] : [], a);
  }));

  /* ---------- Prompts : parcours d'entretien lançables depuis Claude ---------- */
  for (const p of PARCOURS) {
    server.registerPrompt(p.nom, { title: p.titre, description: p.description }, () => ({
      description: p.description,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: p.texte } }],
    }));
  }

  return server;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

export const app = new Hono().basePath("/mcp");

app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["authorization", "content-type", "mcp-session-id", "mcp-protocol-version", "last-event-id", "apikey", "x-client-info"],
  exposeHeaders: ["mcp-session-id", "www-authenticate"],
  maxAge: 86400,
}));

// Métadonnées de ressource protégée (RFC 9728), sans authentification.
const protectedResource = (c: any) => c.json(PROTECTED_RESOURCE, 200, { "Cache-Control": "public, max-age=3600" });
app.get("/.well-known/oauth-protected-resource", protectedResource);
app.get("/.well-known/oauth-protected-resource/functions/v1/mcp", protectedResource);

const unauthorized = (c: any, description?: string) =>
  c.json({ error: "unauthorized", ...(description ? { error_description: description } : {}) }, 401, {
    "WWW-Authenticate": description ? `${WWW_AUTHENTICATE}, error="invalid_token"` : WWW_AUTHENTICATE,
  });

async function handleMcp(c: any) {
  const authorization = c.req.header("authorization") ?? "";
  const m = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!m) return unauthorized(c);
  const token = m[1];
  const db = deps.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // Le jeton est passé explicitement : sans session stockée, getUser() sans argument échouerait.
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return unauthorized(c, "Jeton invalide ou expiré.");

  // Mode sans état : pas de flux SSE autonome (GET) ni de session à fermer (DELETE).
  if (c.req.method !== "POST") {
    return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Méthode non autorisée : utilisez POST." }, id: null }, 405, { Allow: "POST" });
  }
  const server = buildServer({ db, user: { id: data.user.id, email: data.user.email } });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    // La réponse JSON est déjà construite : on libère le serveur de cette requête.
    queueMicrotask(() => { server.close().catch(() => {}); });
  }
}
app.all("/", handleMcp);
app.all("*", handleMcp);

Deno.serve(app.fetch);
