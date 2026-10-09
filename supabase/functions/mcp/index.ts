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
  "Boussole est l'outil de suivi de patrimoine de l'utilisateur : placements (positions), immobilier (biens), crédits, profil du foyer (revenus, statut, tranche d'imposition) et réglages (cibles d'allocation, règles d'alerte, matelas de sécurité, versements programmés).",
  "Tous les montants sont en euros. Les dates sont au format AAAA-MM-JJ.",
  "p1 et p2 désignent les personnes du foyer dont les prénoms figurent dans le profil (get_profile, champ personnes) ; « foyer » est leur ensemble. Utilise leurs prénoms quand tu parles à l'utilisateur.",
  "Commence par get_overview ou get_profile pour connaître la situation avant de proposer une modification.",
  "Avant d'écraser une valeur existante (salaire, valeur d'un bien, quantité d'une ligne, réglage…), montre l'ancienne et la nouvelle valeur et demande confirmation à l'utilisateur.",
  "N'invente jamais un chiffre : si une information manque, demande-la. Pour un titre coté, l'ISIN et la quantité suffisent : le cours est mis à jour chaque nuit.",
  "Chaque écriture renvoie ce qui a changé ; rends-en compte à l'utilisateur.",
  "Budget mensuel (get_budget, update_budget) : lignes de revenus, dépenses par catégorie et épargne, par mois ou par an. Le salaire et les mensualités de crédit viennent du profil : ne les ajoute pas au budget. update_budget fusionne par défaut (rapprochement par id ou par libellé).",
  "Objectifs datés (list_objectifs, upsert_objectifs, delete_objectif) : apport, matelas, retraite ou projet, avec cible, échéance, montant déjà réuni (saisi ou poches rattachées), rendement attendu et priorité ; list_objectifs calcule l'effort mensuel requis et le statut.",
  "get_overview inclut un score de santé financière sur 100 (matelas, taux d'épargne, endettement, diversification, patrimoine net selon l'âge) : c'est un indicateur pédagogique, pas un conseil en investissement ; présente-le comme tel.",
].join("\n");

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

const POS_SELECT = "*, instrument:instruments(name, symbol, currency, price, price_date)";

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
    texte: "Aucun placement enregistré.", piste: "Ajoutez vos placements dans le Pilotage pour mesurer leur diversification." };
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
/* Schémas d'entrée                                                    */
/* ------------------------------------------------------------------ */

const money = z.number().min(0, { error: "Montant négatif interdit." });
const uuid = z.string().regex(UUID_RE, { error: "Identifiant invalide (UUID attendu)." });
const isoDate = z.string().regex(DATE_RE, { error: "Date au format AAAA-MM-JJ attendue." });
const pct = z.number().min(0).max(100);
const TMI = [0, 11, 30, 41, 45] as const;

const FoyerPatch = z.strictObject({
  adultes: z.number().int().min(1, { error: "Le foyer compte 1 à 3 adultes." }).max(3, { error: "Le foyer compte 1 à 3 adultes." }).nullable().optional(),
  enfants: z.number().int().min(0).max(20).nullable().optional(),
  enfants14: z.number().int().min(0).max(20).nullable().optional().describe("Dont enfants de 14 ans ou plus."),
  union: z.enum(["joint", "sep"]).nullable().optional().describe("joint = marié ou pacsé, sep = union libre ou seul."),
  age: z.enum(["u30", "a30", "a40", "a50", "a60", "a70"]).nullable().optional().describe("Tranche d'âge de p1 : u30 (<30), a30 (30-39), a40, a50, a60, a70 (70+)."),
  tmi: z.literal(TMI, { error: "Tranche marginale d'imposition invalide : valeurs possibles 0, 11, 30, 41 ou 45." }).nullable().optional()
    .describe("Tranche marginale d'imposition en % (0, 11, 30, 41 ou 45)."),
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
const CushionPatch = z.strictObject({
  mode: z.enum(["amount", "months"]).optional().describe("amount = montant fixe, months = nombre de mois de dépenses."),
  min: money.optional(), max: money.optional(),
  months: z.number().min(0).max(36).optional(), depenses: money.optional().describe("Dépenses mensuelles du foyer."),
});
const RecurringItem = z.looseObject({
  label: z.string().min(1).max(80),
  positionId: uuid.describe("Ligne alimentée."),
  day: z.number().int().min(1).max(28),
  amount: money,
  start: isoDate.optional(),
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
  poches: z.array(z.string().trim().min(1).max(60)).max(30).optional().describe("Poches du Pilotage rattachées (ex. Épargne, Monde)."),
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
  const DEL = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

  /* ---------- get_overview ---------- */
  server.registerTool("get_overview", {
    title: "Vue d'ensemble",
    description: "Synthèse du patrimoine : financier, immobilier, dettes et patrimoine net (foyer, p1, p2), revenus mensuels nets, mensualités, dernière photo, lignes sans cours récent, dernière mise à jour nocturne et alertes ; totaux mensuels du budget et score de santé financière sur 100 (cinq critères sur 20, détail pour le foyer, total par personne).",
    inputSchema: z.strictObject({}),
    annotations: RO,
  }, wrap(async () => {
    const [pr, bi, cr, po, sn, st, cf, bu] = await Promise.all([
      db.from("profiles").select("*").maybeSingle(),
      db.from("biens").select("*"),
      db.from("credits").select("*"),
      db.from("positions").select(POS_SELECT),
      db.from("snapshots").select("date, total, p1, p2").order("date", { ascending: false }).limit(1),
      db.from("status").select("*").maybeSingle(),
      db.from("config").select("cushion").maybeSingle(),
      db.from("budgets").select("lignes").maybeSingle(),
    ]);
    const profil = must("profiles", pr) as any ?? {};
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

  /* ---------- update_profile ---------- */
  server.registerTool("update_profile", {
    title: "Modifier le profil",
    description: "Modifie le profil par fusion : seuls les champs fournis changent ; null efface un champ. personnes.p2 = null retire la seconde personne. Demander confirmation à l'utilisateur avant d'écraser une valeur existante.",
    inputSchema: z.strictObject({
      foyer: FoyerPatch.optional(),
      personnes: z.strictObject({ p1: PersonnePatch.optional(), p2: PersonnePatch.nullable().optional() }).optional(),
      autres: z.strictObject({ p1: AutresPatch.optional(), p2: AutresPatch.optional() }).optional().describe("Autres actifs par personne."),
    }),
    annotations: RW,
  }, wrap(async (args: any) => {
    if (!args.foyer && !args.personnes && !args.autres) throw new UserError("Rien à modifier : fournissez foyer, personnes ou autres.");
    const cur = must("profiles", await db.from("profiles").select("foyer, personnes, autres").maybeSingle()) as any;
    const before = { foyer: cur?.foyer ?? {}, personnes: cur?.personnes ?? { p1: { nom: "Moi" } }, autres: cur?.autres ?? {} };
    const after = structuredClone(before);
    if (args.foyer) after.foyer = clean({ ...after.foyer, ...args.foyer });
    if (args.personnes) {
      for (const k of ["p1", "p2"]) {
        if (!(k in args.personnes)) continue;
        if (args.personnes[k] === null) { delete after.personnes[k]; continue; }
        after.personnes[k] = clean({ ...(after.personnes[k] ?? {}), ...args.personnes[k] });
      }
      if (!after.personnes.p1?.nom) after.personnes.p1 = { nom: "Moi", ...(after.personnes.p1 ?? {}) };
      if (after.personnes.p2 && !after.personnes.p2.nom) throw new UserError("Indiquez le prénom de la seconde personne (personnes.p2.nom).");
    }
    if (args.autres) {
      for (const k of ["p1", "p2"]) if (args.autres[k]) after.autres[k] = clean({ ...(after.autres[k] ?? {}), ...args.autres[k] });
    }
    const changes = diff(before, after, "", 3);
    if (!changes.length) return { modifications: [], message: "Aucun changement : les valeurs fournies sont déjà enregistrées." };
    if (cur) must("profiles", await db.from("profiles").update(after).eq("user_id", user.id).select("user_id").single());
    else must("profiles", await db.from("profiles").insert(after).select("user_id").single());
    return { modifications: changes };
  }));

  /* ---------- biens / crédits ---------- */
  async function upsertRows(table: "biens" | "credits", rows: any[], label: string, check: (row: any, nom: string) => string[]) {
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
    if (errors.length) throw new UserError("Aucune écriture effectuée.\n" + errors.join("\n"));
    const crees: any[] = [], modifies: any[] = [];
    for (const r of rows.filter((x) => x.id)) {
      const { id, ...patch } = r;
      const old = byId.get(id);
      const changes = diff(old, { ...old, ...patch }, "", 1);
      if (!changes.length) { modifies.push({ id, nom: old.nom, modifications: [] }); continue; }
      must(table, await db.from(table).update(patch).eq("id", id).select("id").single());
      modifies.push({ id, nom: patch.nom ?? old.nom, modifications: changes });
    }
    const inserts = rows.filter((x) => !x.id);
    if (inserts.length) {
      const data = must(table, await db.from(table).insert(inserts).select("*")) as any[];
      data.forEach((d) => { const { user_id: _u, created_at: _c, ...rest } = d; crees.push(rest); });
    }
    return { crees, modifies, avertissements: warnings };
  }

  server.registerTool("upsert_biens", {
    title: "Ajouter ou modifier des biens immobiliers",
    description: "Crée (sans id) ou modifie (avec id, seuls les champs fournis changent) des biens immobiliers. Montants en euros, ≥ 0 ; part_p1 entre 0 et 100.",
    inputSchema: z.strictObject({ rows: z.array(BienRow).min(1).max(50) }),
    annotations: RW,
  }, wrap(async ({ rows }: any) => upsertRows("biens", rows, "bien", (b, nom) =>
    pos(b.crd) > pos(b.valeur) && pos(b.valeur) > 0 ? [`${nom} : le capital restant dû dépasse la valeur du bien.`] : [])));

  server.registerTool("upsert_credits", {
    title: "Ajouter ou modifier des crédits",
    description: "Crée (sans id) ou modifie (avec id) des crédits hors immobilier : nom, titulaire (p1, p2 ou commun), capital restant dû, mensualité.",
    inputSchema: z.strictObject({ rows: z.array(CreditRow).min(1).max(50) }),
    annotations: RW,
  }, wrap(async ({ rows }: any) => upsertRows("credits", rows, "crédit", () => [])));

  for (const [name, table, label] of [["delete_bien", "biens", "Bien"], ["delete_credit", "credits", "Crédit"]] as const) {
    server.registerTool(name, {
      title: `Supprimer un ${label.toLowerCase()}`,
      description: `Supprime définitivement un ${label.toLowerCase()} par son id. Demander confirmation à l'utilisateur avant.`,
      inputSchema: z.strictObject({ id: uuid }),
      annotations: DEL,
    }, wrap(async ({ id }: any) => {
      const data = must(table, await db.from(table).delete().eq("id", id).select("*")) as any[];
      if (!data?.length) throw new UserError(`${label} ${id} introuvable.`);
      const { user_id: _u, ...rest } = data[0];
      return { supprime: rest };
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
    title: "Ajouter ou modifier des placements",
    description: "Crée (sans id) ou modifie (avec id, seuls les champs fournis changent) des lignes de placement. Titre coté : mode market, ISIN et quantité (le cours est mis à jour chaque nuit). Livret, fonds euros, SCPI : mode manual et valeur. Pour enregistrer un achat ou une vente sur une ligne existante, préférer record_transaction.",
    inputSchema: z.strictObject({ rows: z.array(PositionRow).min(1).max(100) }),
    annotations: RW,
  }, wrap(async ({ rows }: any) => {
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
    if (errors.length) throw new UserError("Aucune écriture effectuée.\n" + errors.join("\n"));

    // Instruments : demander ceux qui n'existent pas encore (sans prix ; la fonction nocturne les cotera).
    const isins = [...new Set(prepared.map((r: any) => r.isin).filter(Boolean))] as string[];
    const instruments_demandes: string[] = [];
    if (isins.length) {
      const known = new Set(((must("instruments", await db.from("instruments").select("isin").in("isin", isins)) as any[]) ?? []).map((x) => x.isin));
      for (const isin of isins.filter((x) => !known.has(x))) {
        const name = prepared.find((r: any) => r.isin === isin)?.name ?? null;
        must("request_instrument", await db.rpc("request_instrument", { p_isin: isin, p_name: name, p_symbol: null }));
        instruments_demandes.push(isin);
      }
    }

    const crees: any[] = [], modifies: any[] = [];
    for (const r of prepared.filter((x: any) => x.id)) {
      const { id, ...patch } = r;
      const old = byId.get(id);
      const changes = diff(old, { ...old, ...patch }, "", 1).filter((c) => c.champ !== "value_date");
      if (!changes.length) { modifies.push({ id, nom: old.name, modifications: [] }); continue; }
      must("positions", await db.from("positions").update(patch).eq("id", id).select("id").single());
      modifies.push({ id, nom: patch.name ?? old.name, modifications: changes });
    }
    const inserts = prepared.filter((x: any) => !x.id);
    if (inserts.length) {
      const data = (must("positions", await db.from("positions").insert(inserts).select(POS_SELECT)) as any[]) ?? [];
      crees.push(...data.map(viewPosition));
    }
    if (instruments_demandes.length) warnings.push(`Nouveaux instruments (${instruments_demandes.join(", ")}) : cours récupéré lors de la prochaine mise à jour nocturne.`);
    return { crees, modifies, instruments_demandes, avertissements: warnings };
  }));

  /* ---------- record_transaction (mêmes règles que le formulaire de web/src/pilotage.js) ---------- */
  server.registerTool("record_transaction", {
    title: "Enregistrer un mouvement",
    description: "Enregistre un mouvement sur une ligne et met la ligne à jour : achat/vente (titre coté : quantité et prix ; ligne manuelle : montant), versement/retrait (montant ; converti en parts au cours pour un titre coté), solde (nouvelle quantité ou nouvelle valeur). Le PRU est pondéré à l'achat ; une vente qui ramène la quantité à 0 clôture la ligne.",
    inputSchema: z.strictObject({
      position_id: uuid,
      type: z.enum(["achat", "vente", "versement", "retrait", "solde"]),
      qty: money.optional().describe("Quantité (titres cotés)."),
      price: z.number().positive().optional().describe("Prix unitaire en euros."),
      amount: money.optional().describe("Montant en euros (ligne manuelle, versement, retrait, nouveau solde)."),
      date: isoDate.optional().describe("Date du mouvement (défaut : aujourd'hui)."),
      note: z.string().max(200).optional(),
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

    const before = Object.fromEntries(Object.keys(upd).map((k) => [k, p[k] ?? null]));
    must("positions", await db.from("positions").update(upd).eq("id", p.id).select("id").single());
    const tx = { position_id: p.id, date, type, qty: qty ?? null, price: price ?? null, amount: amt != null ? r2(amt) : null, note: a.note ?? null, source: "mcp" };
    const ins = await db.from("transactions").insert(tx).select("id, date, type, qty, price, amount, note, source").single();
    if (ins.error) {
      await db.from("positions").update(before).eq("id", p.id); // annule la mise à jour de la ligne
      throw new UserError(dbMessage("transactions", ins.error) + " La ligne n'a pas été modifiée.");
    }
    const after = { ...p, ...upd };
    const out: any = { transaction: ins.data, ligne: { id: p.id, nom: p.name, modifications: diff(before, upd, "", 1) }, valeur_ligne: r2(val(after)) };
    if (p.mode === "market" && curPrice == null) out.avertissement = "Cours non encore disponible : la ligne sera valorisée après la prochaine mise à jour nocturne.";
    return out;
  }));

  /* ---------- config ---------- */
  const CONFIG_FIELDS = "targets, rules, cushion, recurring, todo, milestones, hypotheses, updated_at";
  server.registerTool("get_config", {
    title: "Réglages",
    description: "Réglages de pilotage : cibles d'allocation par poche (targets), règles d'alerte (rules), matelas de sécurité (cushion), versements programmés (recurring), ordres à passer (todo), échéances (milestones), hypothèses.",
    inputSchema: z.strictObject({}),
    annotations: RO,
  }, wrap(async () => ({ config: must("config", await db.from("config").select(CONFIG_FIELDS).maybeSingle()) ?? null })));

  server.registerTool("update_config", {
    title: "Modifier les réglages",
    description: "Modifie les réglages par fusion. targets et cushion : seuls les champs fournis changent. rules, recurring, todo, milestones, hypotheses : la liste fournie remplace la liste existante (relire get_config et renvoyer la liste complète). Règles possibles : {type:'max_line_pct', pct}, {type:'max_bloc_pct', bloc, pct}, {type:'price_floor', position_id, price}, {type:'envelope_cap', envelope, cap}, {type:'stale_prices', days}.",
    inputSchema: z.strictObject({
      targets: TargetsPatch.optional(),
      rules: z.array(RuleSchema).max(50).optional(),
      cushion: CushionPatch.optional(),
      recurring: z.array(RecurringItem).max(50).optional(),
      todo: z.array(TodoItem).max(100).optional(),
      milestones: z.array(MilestoneItem).max(50).optional(),
      hypotheses: z.array(HypothesisItem).max(50).optional(),
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const keys = ["targets", "rules", "cushion", "recurring", "todo", "milestones", "hypotheses"].filter((k) => a[k] !== undefined);
    if (!keys.length) throw new UserError("Rien à modifier.");
    const cur = must("config", await db.from("config").select(CONFIG_FIELDS).maybeSingle()) as any;
    const before: any = { targets: cur?.targets ?? { tolerancePts: 3 }, rules: cur?.rules ?? [], cushion: cur?.cushion ?? { mode: "amount", min: 0, max: 0 },
      recurring: cur?.recurring ?? [], todo: cur?.todo ?? [], milestones: cur?.milestones ?? [], hypotheses: cur?.hypotheses ?? [] };
    const patch: any = {};
    if (a.targets) {
      const t = structuredClone(before.targets);
      for (const k of ["p1", "p2"]) if (a.targets[k]) t[k] = clean({ ...(t[k] ?? {}), ...a.targets[k] });
      if (a.targets.tolerancePts != null) t.tolerancePts = a.targets.tolerancePts;
      patch.targets = t;
    }
    if (a.cushion) {
      const c = { ...before.cushion, ...a.cushion };
      if (c.mode === "months" && (c.months == null || c.depenses == null)) throw new UserError("Matelas en mois : indiquez months et depenses.");
      if (c.mode !== "months" && c.min == null) throw new UserError("Matelas en montant : indiquez min.");
      if (c.max != null && c.min != null && c.max < c.min) throw new UserError("Matelas : max doit être supérieur ou égal à min.");
      patch.cushion = c;
    }
    for (const k of ["rules", "recurring", "todo", "milestones", "hypotheses"]) if (a[k] !== undefined) patch[k] = a[k];
    // Les règles et versements doivent viser des lignes existantes.
    const refs = [...(a.rules ?? []).filter((r: any) => r.type === "price_floor").map((r: any) => r.position_id), ...(a.recurring ?? []).map((r: any) => r.positionId)];
    if (refs.length) {
      const found = new Set(((must("positions", await db.from("positions").select("id").in("id", [...new Set(refs)])) as any[]) ?? []).map((x) => x.id));
      const missing = refs.filter((id) => !found.has(id));
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
    title: "Modifier le budget",
    description: "Modifie le budget mensuel. mode fusionner (défaut) : chaque ligne fournie est rapprochée d'une ligne existante par id, sinon par libellé (sans tenir compte de la casse) ; seuls les champs fournis changent ; les lignes non rapprochées sont ajoutées (type, libelle et montant requis) ; les autres lignes restent. mode remplacer : la liste fournie devient le budget complet (relire get_budget avant). Ne pas y mettre le salaire ni les mensualités de crédit : ils viennent déjà du profil. Demander confirmation à l'utilisateur avant d'écraser un montant.",
    inputSchema: z.strictObject({
      lignes: z.array(BudgetLigne).max(200),
      mode: z.enum(["remplacer", "fusionner"], { error: "Mode invalide : remplacer ou fusionner." }).optional().describe("fusionner (défaut) ou remplacer."),
    }),
    annotations: RW,
  }, wrap(async ({ lignes, mode = "fusionner" }: any) => {
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
    if (errors.length) throw new UserError("Aucune écriture effectuée.\n" + errors.join("\n"));

    const byId = (list: any[]) => new Map(list.map((l) => [String(l.id), l]));
    const B = byId(before), A2 = byId(after);
    const ajoutees = after.filter((l) => !B.has(String(l.id)));
    const supprimees = before.filter((l) => !A2.has(String(l.id)));
    const modifiees = after.filter((l) => B.has(String(l.id)))
      .map((l) => ({ id: l.id, libelle: l.libelle, modifications: diff(B.get(String(l.id)), l, "", 1) }))
      .filter((x) => x.modifications.length);
    const resume = (list: any[]) => {
      const t = budgetTotaux({ ...d, lignes: list }, "foyer");
      return { nombre_lignes: list.length, revenus: r2(t.revenus), depenses: r2(t.depenses), epargne: r2(t.epargne), reste: r2(t.reste),
        taux_epargne: t.tauxEpargne == null ? null : Math.round(t.tauxEpargne * 10000) / 10000 };
    };
    if (!ajoutees.length && !supprimees.length && !modifiees.length) return { mode, modifications: [], message: "Aucun changement : le budget est déjà à jour.", avant: resume(before) };
    must("budgets", await db.from("budgets").upsert({ user_id: user.id, lignes: after }, { onConflict: "user_id" }).select("user_id").single());
    return { mode, avant: resume(before), apres: resume(after), ajoutees, modifiees, supprimees };
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
    title: "Ajouter ou modifier des objectifs",
    description: "Crée (sans id : nom et cible requis) ou modifie (avec id : seuls les champs fournis changent) des objectifs datés. Toutes les lignes sont validées avant toute écriture. type : apport, matelas, retraite ou projet ; source : saisi (montant deja) ou poches (poches / enveloppes du Pilotage rattachées) ; rendement en % par an (-50 à 50) ; priorite entière (1 = servi en premier).",
    inputSchema: z.strictObject({ rows: z.array(ObjectifRow).min(1).max(30) }),
    annotations: RW,
  }, wrap(async ({ rows }: any) => {
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
    if (errors.length) throw new UserError("Aucune écriture effectuée.\n" + errors.join("\n"));
    const toRow = (r: any) => Object.fromEntries(Object.entries(r).filter(([k]) => k in OBJ_COLS).map(([k, v]) => [OBJ_COLS[k], v]));
    const crees: any[] = [], modifies: any[] = [];
    for (const r of rows.filter((x: any) => x.id)) {
      const old = byId.get(r.id), patch = toRow(r);
      const changes = diff(Object.fromEntries(Object.keys(patch).map((k) => [k, old[k] ?? null])), patch, "", 1)
        .filter((c) => !(typeof c.avant === "string" && typeof c.apres === "number" && Number(c.avant) === c.apres));
      if (!changes.length) { modifies.push({ id: r.id, nom: old.nom, modifications: [] }); continue; }
      must("objectifs", await db.from("objectifs").update(patch).eq("id", r.id).select("id").single());
      modifies.push({ id: r.id, nom: r.nom ?? old.nom, modifications: changes });
    }
    const inserts = rows.filter((x: any) => !x.id).map(toRow);
    if (inserts.length) {
      const data = (must("objectifs", await db.from("objectifs").insert(inserts).select("*")) as any[]) ?? [];
      crees.push(...data.map(viewObjectif));
    }
    return { crees, modifies, avertissements: warnings };
  }));

  server.registerTool("delete_objectif", {
    title: "Supprimer un objectif",
    description: "Supprime définitivement un objectif par son id. Demander confirmation à l'utilisateur avant.",
    inputSchema: z.strictObject({ id: uuid }),
    annotations: DEL,
  }, wrap(async ({ id }: any) => {
    const data = must("objectifs", await db.from("objectifs").delete().eq("id", id).select("*")) as any[];
    if (!data?.length) throw new UserError(`Objectif ${id} introuvable.`);
    return { supprime: viewObjectif(data[0]) };
  }));

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
