// Chargeur de foyer fictif (SEC5, spec § 3.5) : banc/foyers/<slug>.json → lignes des tables personnelles d'un compte.
//   resoudreFoyer(slug, { uid, aujourdhui, variante })  fonction pure : { tables, instruments } (testée sur PGlite)
//   chargerFoyer(client, uid, slug, options)           écrit les lignes par un client (PGlite en test, supabase-js + clé de service locale en réel)
// Le format du foyer suit les colonnes SQL ; trois conventions le rendent stable d'un passage à l'autre :
//   - dates relatives : "J-30" (il y a 30 jours), "J+10", "M-56" (il y a 56 mois, même quantième), "M+8", "FM-1" (fin du mois dernier) ;
//   - références : "{bien:rp}", "{credit:auto}", "{position:pea-monde}", "{variante:x}" → UUID stable (dérivé de l'uid) ;
//   - variante : surcharges JSON fusionnées dans le foyer avant le chargement (objets fusionnés, tableaux remplacés).
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { RACINE } from "./garde.mjs";

const require = createRequire(import.meta.url);
const Risque = require(join(RACINE, "web/src/risque.js"));
const Calc = require(join(RACINE, "web/src/calc.js"));

// ---------------------------------------------------------------------------------------------------------------------------
// Couverture : toutes les tables du schéma public qui ont une colonne user_id sont traitées ou ignorées pour une raison écrite.
// Le test test/preprod-chargeur.test.mjs échoue si un nouveau module en ajoute une que ni l'une ni l'autre liste ne cite.
// ---------------------------------------------------------------------------------------------------------------------------
export const TRAITEES = [
  "profiles", "config", "biens", "credits", "positions", "budgets", "objectifs", "snapshots", "status", "foyer_variantes", "foyer_evenements",
  "memoire_agent", "journal", "routines", "fonctionnalites", "banque_connexions", "banque_comptes", "banque_operations", "banque_mois",
];
export const IGNOREES = {
  transactions: "historique d'opérations non reconstitué : les foyers fictifs n'en ont pas (les photos mensuelles suffisent aux courbes)",
  propositions: "créées par les cas du banc eux-mêmes (le Copilote les dépose) ; un foyer neuf n'en a pas",
  plans_figes: "figés par la revue mensuelle, que les cas jouent eux-mêmes",
  connexions_assistant: "écrite par le connecteur à chaque appel (noter_connexion) ; le voyant « Claude est connecté » se déclenche seul",
  banque_placements: "positions détaillées d'un compte-titres synchronisé : non utilisées par les cas",
};

// ---------------------------------------------------------------------------------------------------------------------------
// Dates relatives, références, fusion de variante
// ---------------------------------------------------------------------------------------------------------------------------
const iso = d => d.toISOString().slice(0, 10);
const dateUTC = s => { const [a, m, j] = s.split("-").map(Number); return new Date(Date.UTC(a, m - 1, j)); };
const finDeMois = (a, m) => new Date(Date.UTC(a, m + 1, 0)); // m : 0-11, mois suivant jour 0

export function resoudreDate(jeton, aujourdhui) {
  const t = dateUTC(aujourdhui);
  let m;
  if ((m = /^J([+-])(\d+)$/.exec(jeton))) { t.setUTCDate(t.getUTCDate() + (m[1] === "-" ? -1 : 1) * Number(m[2])); return iso(t); }
  if ((m = /^M([+-])(\d+)$/.exec(jeton))) {
    const k = (m[1] === "-" ? -1 : 1) * Number(m[2]);
    const jour = t.getUTCDate();
    const cible = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + k, 1));
    const dernier = finDeMois(cible.getUTCFullYear(), cible.getUTCMonth()).getUTCDate();
    cible.setUTCDate(Math.min(jour, dernier));
    return iso(cible);
  }
  if ((m = /^FM([+-])(\d+)$/.exec(jeton))) {
    const k = (m[1] === "-" ? -1 : 1) * Number(m[2]);
    const c = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + k, 1));
    return iso(finDeMois(c.getUTCFullYear(), c.getUTCMonth()));
  }
  return null;
}

/** UUID stable (forme v5) dérivé de l'uid du compte, du genre et de la clé : deux comptes ne partagent jamais un identifiant. */
export function uuidStable(uid, genre, cle) {
  const h = createHash("sha1").update(`${uid}|${genre}|${cle}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Entier stable (≤ 4,3·10¹³) dérivé de l'uid, pour les identifiants numériques de la banque (ceux de Powens en production). */
export function baseNumerique(uid) { return parseInt(createHash("sha1").update(String(uid)).digest("hex").slice(0, 8), 16) * 10_000; }

const RE_REF = /\{(bien|credit|position|variante|evenement):([A-Za-z0-9_-]+)\}/g;

function parcourir(valeur, f) {
  if (typeof valeur === "string") return f(valeur);
  if (Array.isArray(valeur)) return valeur.map(v => parcourir(v, f));
  if (valeur && typeof valeur === "object") return Object.fromEntries(Object.entries(valeur).map(([k, v]) => [f(k), parcourir(v, f)]));
  return valeur;
}

export function fusionner(base, surcharge) {
  if (Array.isArray(surcharge) || surcharge === null || typeof surcharge !== "object") return surcharge;
  const out = { ...(base && typeof base === "object" && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(surcharge)) out[k] = k in out && v && typeof v === "object" && !Array.isArray(v) ? fusionner(out[k], v) : v;
  return out;
}

export function lireFoyer(slug, { racine = RACINE } = {}) {
  const chemin = join(racine, "banc/foyers", `${slug}.json`);
  if (!existsSync(chemin)) throw new Error(`foyer inconnu : ${slug}`);
  const f = JSON.parse(readFileSync(chemin, "utf8"));
  return f.copie_de ? fusionner(lireFoyer(f.copie_de, { racine }), (({ copie_de, ...reste }) => reste)(f)) : f;
}

export function lireCours({ racine = RACINE } = {}) { return JSON.parse(readFileSync(join(racine, "banc/foyers/cours.json"), "utf8")); }

// ---------------------------------------------------------------------------------------------------------------------------
// Générateurs déterministes
// ---------------------------------------------------------------------------------------------------------------------------
function splitmix32(a) {
  return () => { a |= 0; a = (a + 0x9e3779b9) | 0; let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad); t ^= t >>> 15; t = Math.imul(t, 0x735a2d97); t ^= t >>> 15; return (t >>> 0) / 4294967296; };
}
const arrondi2 = x => Math.round(x * 100) / 100;

/** Valeur d'une position pour le patrimoine : même règle que Calc.val (qty × cours si cotée, sinon la valeur saisie). */
function valeurPosition(p, prixInstrument) {
  const prix = p.price_override ?? prixInstrument;
  return Calc.val({ mode: p.mode, qty: p.qty ?? null, price: prix ?? null, value: p.value });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Résolution : foyer → lignes
// ---------------------------------------------------------------------------------------------------------------------------
const sans = (o, ...cles) => { const r = { ...o }; for (const c of cles) delete r[c]; return r; };
const horodatage = (aujourdhui, joursAvant, heure = "10:00") => { const d = dateUTC(aujourdhui); d.setUTCDate(d.getUTCDate() - (joursAvant || 0)); return `${iso(d)}T${heure}:00.000Z`; };

export function resoudreFoyer(slug, { uid, aujourdhui = iso(new Date()), variante = null, racine = RACINE } = {}) {
  if (!uid) throw new Error("resoudreFoyer : uid requis");
  let foyer = lireFoyer(slug, { racine });
  if (variante) foyer = fusionner(foyer, variante);
  const cours = lireCours({ racine });
  const id = (genre, cle) => uuidStable(uid, genre, cle);

  // 1. dates relatives puis références
  foyer = parcourir(foyer, s => { const d = resoudreDate(s, aujourdhui); return d ?? s; });
  foyer = parcourir(foyer, s => s.replace(RE_REF, (_, genre, cle) => id(genre, cle)));

  const T = {}; // table → lignes
  const ajouter = (t, rows) => { if (rows.length) T[t] = (T[t] || []).concat(rows); };
  const p = foyer.profil || {};

  // instruments : ceux des positions cotées du foyer (table partagée, mise à jour par le chargeur)
  const isinsUtilises = new Set((foyer.positions || []).filter(x => x.isin).map(x => x.isin));
  const instruments = [];
  for (const isin of isinsUtilises) {
    const c = cours.instruments[isin];
    if (!c) throw new Error(`foyer ${slug} : l'instrument ${isin} n'a pas de cours dans banc/foyers/cours.json`);
    instruments.push({ isin, symbol: c.symbole, name: c.nom, currency: c.devise, devise: c.devise, price: c.prix, price_date: resoudreDate(cours.date, aujourdhui) ?? aujourdhui,
      source: "preprod", ter: c.ter, zone: c.zone, annote_source: "Données fictives du banc (préproduction)", annote_le: horodatage(aujourdhui, 9) });
  }
  const prixDe = Object.fromEntries(instruments.map(i => [i.isin, i.price]));

  // profiles
  const risque = foyer.risque_reponses ? (() => {
    const ev = Risque.evaluer(foyer.risque_reponses, {});
    return { reponses: foyer.risque_reponses, profil: ev.profil, score: ev.score, date: aujourdhui };
  })() : null;
  ajouter("profiles", [{ user_id: uid, foyer: p.foyer ?? {}, personnes: p.personnes ?? {}, autres: p.autres ?? {}, protection: p.protection ?? {},
    classes: p.classes ?? {}, risque, journal_consentement: p.journal_consentement ?? "demander", onboarding_done: p.onboarding_done ?? true }]);

  // biens, crédits, positions
  ajouter("biens", (foyer.biens || []).map(b => ({ id: id("bien", b.ref), user_id: uid, ...sans(b, "ref") })));
  ajouter("credits", (foyer.credits || []).map(c => ({ id: id("credit", c.cle), user_id: uid, ...sans(c, "cle") })));
  ajouter("positions", (foyer.positions || []).map(x => ({ id: id("position", x.ref), user_id: uid, status: "actif", ...sans(x, "ref") })));

  // budget, objectifs
  if (foyer.budget && foyer.budget.length) ajouter("budgets", [{ user_id: uid, lignes: foyer.budget }]);
  ajouter("objectifs", (foyer.objectifs || []).map(o => ({ id: id("objectif", o.nom), user_id: uid, ...o })));

  // config
  const c = foyer.config ? { ...foyer.config } : null;
  if (c) {
    if (c.recurring) c.recurring = c.recurring.map(r => { const { positionRef, ...reste } = r; return { ...reste, positionId: id("position", positionRef) }; });
    ajouter("config", [{ user_id: uid, ...c }]);
  }

  // événements de vie
  ajouter("foyer_variantes", (foyer.variantes || []).map(v => ({ id: id("variante", v.ref), user_id: uid, ...sans(v, "ref") })));
  ajouter("foyer_evenements", (foyer.evenements || []).map(e => ({ id: id("evenement", e.ref), user_id: uid, variante_id: e.variante ? id("variante", e.variante) : null,
    source: "Ce que tu as dit à Claude (exemple)", fin: null, ...sans(e, "ref", "variante") })));

  // photos mensuelles : le patrimoine d'aujourd'hui remonté de `mois` mois, pente et bruit déterministes
  if (foyer.historique && foyer.positions?.length) {
    const h = foyer.historique, alea = splitmix32(h.graine ?? 1);
    const comptees = foyer.positions.filter(x => (x.status ?? "actif") === "actif");
    const poids = comptees.map(x => valeurPosition(x, prixDe[x.isin]));
    const total = poids.reduce((a, b) => a + b, 0);
    const rows = [];
    for (let k = 1; k <= h.mois; k++) {
      const facteur = Math.max(0.05, Math.pow(1 + h.pente_pct / 100, -k) * (1 + (alea() - 0.5) * 0.012));
      const parBloc = {}, parEnv = {}, parOwner = { p1: 0, p2: 0 };
      comptees.forEach((x, i) => { const v = poids[i] * facteur; parBloc[x.bloc] = (parBloc[x.bloc] || 0) + v; parEnv[x.envelope] = (parEnv[x.envelope] || 0) + v; parOwner[x.owner] = (parOwner[x.owner] || 0) + v; });
      const arr = o => Object.fromEntries(Object.entries(o).map(([a, b]) => [a, arrondi2(b)]));
      rows.push({ user_id: uid, date: resoudreDate(`FM-${k}`, aujourdhui), total: arrondi2(total * facteur), p1: arrondi2(parOwner.p1), p2: arrondi2(parOwner.p2),
        by_bloc: arr(parBloc), by_envelope: arr(parEnv), source: "nightly" });
    }
    ajouter("snapshots", rows);
  }
  ajouter("status", [{ user_id: uid, last_run: horodatage(aujourdhui, 1, "20:31"), summary: "Cours figés (préproduction) : photo du jour enregistrée, données fictives.", alerts: [], missing_prices: 0 }]);

  // mémoire, journal, routines
  ajouter("memoire_agent", (foyer.memoire || []).map((m, i) => ({ id: id("memoire", String(i)), user_id: uid, categorie: m.categorie, contenu: m.contenu, echeance: m.echeance ?? null,
    epingle: m.epingle ?? false, source: m.source ?? "Claude", cree_le: horodatage(aujourdhui, m.il_y_a_jours), maj_le: horodatage(aujourdhui, m.il_y_a_jours) })));
  ajouter("journal", (foyer.journal || []).map((j, i) => ({ id: id("journal", String(i)), user_id: uid, type: j.type, titre: j.titre, synthese: j.synthese, raisonnement: j.raisonnement ?? null,
    options: j.options ?? [], statut: j.statut ?? "a_relire", date_decision: j.date_decision ?? null, revue_le: j.revue_le ?? null, source: j.source ?? "Claude",
    cree_le: horodatage(aujourdhui, j.il_y_a_jours), maj_le: horodatage(aujourdhui, j.il_y_a_jours) })));
  ajouter("routines", (foyer.routines || []).map(r => ({ user_id: uid, type: r.type, jour: r.jour, active: r.active ?? true, consentement_journal: r.consentement_journal ?? false,
    dernier_passage: r.dernier_passage_il_y_a_jours != null ? horodatage(aujourdhui, r.dernier_passage_il_y_a_jours) : null, prochain_passage: r.prochain_passage ?? null,
    questions: r.questions ?? [], synthese: r.synthese ?? null })));

  // fonctionnalités et banque
  ajouter("fonctionnalites", Object.entries(foyer.fonctionnalites || {}).map(([cle, active]) => ({ user_id: uid, cle, active })));
  if (foyer.banque) {
    const base = baseNumerique(uid);
    const idConnexion = {}, idCompte = {};
    ajouter("banque_connexions", (foyer.banque.connexions || []).map((x, i) => { idConnexion[x.ref] = base + 1 + i; return { id: base + 1 + i, user_id: uid, ...sans(x, "ref", "id") }; }));
    ajouter("banque_comptes", (foyer.banque.comptes || []).map((k, i) => {
      idCompte[k.ref] = base + 100 + i;
      return { id: base + 100 + i, user_id: uid, connexion_id: idConnexion[k.connexion], position_id: k.position ? id("position", k.position) : null, ...sans(k, "ref", "id", "connexion", "position") };
    }));
    const spec = foyer.banque.operations;
    if (spec) {
      const compte = idCompte[spec.compte];
      const debut = resoudreDate(`J-${spec.jours}`, aujourdhui);
      const ops = [];
      const mensuelle = (def) => {
        for (let k = 0; k <= Math.ceil(spec.jours / 28) + 1; k++) {
          const mois = dateUTC(resoudreDate(`M-${k}`, aujourdhui)); // même quantième, mois k en arrière
          const j = Math.min(def.jour, finDeMois(mois.getUTCFullYear(), mois.getUTCMonth()).getUTCDate());
          const d = iso(new Date(Date.UTC(mois.getUTCFullYear(), mois.getUTCMonth(), j)));
          if (d >= debut && d <= aujourdhui) ops.push({ date: d, montant: def.montant, libelle: def.libelle, categorie: def.categorie ?? null });
        }
      };
      if (spec.salaire) mensuelle({ ...spec.salaire, categorie: "Revenus" });
      (spec.recurrentes || []).forEach(mensuelle);
      (spec.ponctuelles || []).forEach(o => ops.push({ date: resoudreDate(`J-${o.il_y_a_jours}`, aujourdhui), montant: o.montant, libelle: o.libelle, categorie: o.categorie ?? null }));
      ops.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.libelle < b.libelle ? -1 : 1));
      ajouter("banque_operations", ops.map((o, i) => ({ id: base + 1000 + i, user_id: uid, compte_id: compte, ...o })));
      // agrégats mensuels (banque_mois) par compte, mois et catégorie
      const agg = new Map();
      for (const o of ops) {
        const mois = o.date.slice(0, 7) + "-01", cat = o.categorie ?? "Autres", cle = `${mois}|${cat}`;
        const a = agg.get(cle) || { user_id: uid, compte_id: compte, mois, categorie: cat, entrees: 0, sorties: 0, nombre: 0 };
        if (o.montant >= 0) a.entrees = arrondi2(a.entrees + o.montant); else a.sorties = arrondi2(a.sorties - o.montant);
        a.nombre += 1; agg.set(cle, a);
      }
      ajouter("banque_mois", [...agg.values()]);
    }
  }
  return { foyer, tables: T, instruments, aujourdhui };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Totaux (comparés avant / après chargement par les tests) : mêmes règles que l'app (Calc.val, Calc.counted)
// ---------------------------------------------------------------------------------------------------------------------------
export function totaux({ positions = [], biens = [], credits = [], budgets = [], instruments = [] }) {
  const prix = Object.fromEntries(instruments.map(i => [i.isin, Number(i.price)]));
  const nombre = v => (v == null ? 0 : Number(v));
  const financier = positions.filter(x => Calc.counted({ status: x.status ?? "actif" }))
    .reduce((a, x) => a + valeurPosition({ ...x, qty: x.qty == null ? null : Number(x.qty), value: nombre(x.value), price_override: x.price_override == null ? null : Number(x.price_override) }, prix[x.isin]), 0);
  const lignes = (budgets[0] && budgets[0].lignes) || [];
  const mensuel = l => (l.frequence === "an" ? nombre(l.montant) / 12 : nombre(l.montant));
  return {
    financier: arrondi2(financier),
    immobilier: arrondi2(biens.reduce((a, b) => a + nombre(b.valeur), 0)),
    dettes: arrondi2(biens.reduce((a, b) => a + nombre(b.crd), 0) + credits.reduce((a, c) => a + nombre(c.crd), 0)),
    mensualites: arrondi2(biens.reduce((a, b) => a + nombre(b.mensualite), 0) + credits.reduce((a, c) => a + nombre(c.mensualite), 0)),
    depensesMensuelles: arrondi2(lignes.filter(l => l.type === "depense").reduce((a, l) => a + mensuel(l), 0)),
    epargneMensuelle: arrondi2(lignes.filter(l => l.type === "epargne").reduce((a, l) => a + mensuel(l), 0)),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Écriture : un client { upsert, insert, supprimer, lire }
// ---------------------------------------------------------------------------------------------------------------------------
const CONFLITS = {
  profiles: "user_id", config: "user_id", budgets: "user_id", status: "user_id", routines: "user_id,type", fonctionnalites: "user_id,cle",
  snapshots: "user_id,date", banque_mois: "user_id,compte_id,mois,categorie",
};
// Ordre d'écriture (clés étrangères) ; l'inverse sert à purger.
const ORDRE = ["profiles", "config", "biens", "credits", "positions", "budgets", "objectifs", "foyer_variantes", "foyer_evenements", "snapshots", "status", "fonctionnalites",
  "banque_connexions", "banque_comptes", "banque_operations", "banque_mois", "memoire_agent", "journal", "routines"];

/** Regroupe les lignes par jeu de colonnes identique : une colonne absente garde sa valeur par défaut au lieu de passer à NULL. */
function groupes(rows) {
  const m = new Map();
  for (const r of rows) { const k = Object.keys(r).sort().join(","); (m.get(k) || m.set(k, []).get(k)).push(r); }
  return [...m.values()];
}

export async function chargerFoyer(client, uid, slug, options = {}) {
  const r = resoudreFoyer(slug, { uid, ...options });
  if (r.instruments.length) await client.upsert("instruments", r.instruments, "isin");
  for (const t of ORDRE) {
    if (!r.tables[t]) continue;
    for (const g of groupes(r.tables[t])) {
      if (CONFLITS[t]) await client.upsert(t, g, CONFLITS[t]);
      else await client.insert(t, g);
    }
  }
  return r;
}

/** Efface les lignes d'un compte (hors table partagée instruments), dans l'ordre inverse des clés étrangères. */
export async function purgerFoyer(client, uid) {
  for (const t of [...ORDRE].reverse()) if (t !== "profiles" && t !== "config") await client.supprimer(t, uid);
}

// --- clients ---------------------------------------------------------------------------------------------------------------
const q = id => `"${String(id).replace(/"/g, '""')}"`;

/** Client PGlite (tests) : INSERT … SELECT jsonb_populate_recordset, types gérés par PostgreSQL. */
export function clientPglite(db) {
  const colonnes = rows => Object.keys(rows[0]);
  return {
    async insert(table, rows) {
      const cols = colonnes(rows);
      await db.query(`insert into public.${q(table)} (${cols.map(q).join(",")}) select ${cols.map(q).join(",")} from jsonb_populate_recordset(null::public.${q(table)}, $1::jsonb)`, [JSON.stringify(rows)]);
    },
    async upsert(table, rows, conflit) {
      const cols = colonnes(rows), cles = conflit.split(",");
      const maj = cols.filter(c => !cles.includes(c)).map(c => `${q(c)} = excluded.${q(c)}`);
      await db.query(`insert into public.${q(table)} (${cols.map(q).join(",")}) select ${cols.map(q).join(",")} from jsonb_populate_recordset(null::public.${q(table)}, $1::jsonb)
        on conflict (${cles.map(q).join(",")}) ${maj.length ? `do update set ${maj.join(", ")}` : "do nothing"}`, [JSON.stringify(rows)]);
    },
    async supprimer(table, uid) { await db.query(`delete from public.${q(table)} where user_id = $1`, [uid]); },
    async lire(table, uid) { return (await db.query(`select * from public.${q(table)} ${uid ? "where user_id = $1" : ""}`, uid ? [uid] : [])).rows; },
  };
}

/** Client supabase-js (clé de service locale, garde à l'appelant) : écritures PostgREST, colonnes absentes → valeur par défaut. */
export function clientSupabase(sb) {
  const verifier = ({ error }, t) => { if (error) throw new Error(`${t} : ${error.message}`); };
  return {
    async insert(table, rows) { verifier(await sb.from(table).insert(rows, { defaultToNull: false }), table); },
    async upsert(table, rows, conflit) { verifier(await sb.from(table).upsert(rows, { onConflict: conflit, defaultToNull: false }), table); },
    async supprimer(table, uid) { verifier(await sb.from(table).delete().eq("user_id", uid), table); },
    async lire(table, uid) { let r = sb.from(table).select("*"); if (uid) r = r.eq("user_id", uid); const { data, error } = await r; verifier({ error }, table); return data; },
  };
}
