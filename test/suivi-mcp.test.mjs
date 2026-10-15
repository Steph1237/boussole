// SUIVI, connecteur MCP (supabase/functions/mcp/suivi.ts) et copie générée du moteur (supabase/functions/mcp/suivi.gen.js, scripts/gen-catalogue.mjs).
// - la copie est à jour (npm run gen), sans import, et donne EXACTEMENT les mêmes sorties que le moteur de l'app sur les 90 cas de référence ;
// - les outils suivi_lignes, ligne, ca_vaut_le_cout (lecture) et definir_suivi (propositions), l'ajout à demarrer_session et à demarrer_routine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { genererSuivi, SORTIE_SUIVI, MODULES_SUIVI } from "../scripts/gen-catalogue.mjs";
import { SOURCE_SUIVI_GEN, chargerSuiviGen } from "./helpers/suivi-gen.mjs";
import { CAS, ecartsDuCas, executer, donneesDe } from "./helpers/suivi-cas.mjs";

const require = createRequire(import.meta.url);
const App = require("../web/src/suivi.js");
const Gen = chargerSuiviGen().Suivi;
const J = v => JSON.parse(JSON.stringify(v));

test("la copie du moteur de suivi est à jour (npm run gen) et ne contient aucun import", () => {
  assert.equal(SOURCE_SUIVI_GEN, genererSuivi(), SORTIE_SUIVI + " périmé : lancer npm run gen");
  assert.doesNotMatch(SOURCE_SUIVI_GEN, /^import /m);
  assert.deepEqual(Object.keys(chargerSuiviGen()).sort(), ["Calc", "Marche", "Pratiques", "Risque", "Suivi"]);
  assert.ok(MODULES_SUIVI.includes("suivi") && MODULES_SUIVI.includes("risque") && MODULES_SUIVI.includes("pratiques"));
});

test("parité : la copie du connecteur passe les 90 cas de référence", () => {
  for (const c of CAS) { const e = ecartsDuCas(Gen, c); assert.deepEqual(e, [], c.id + " : " + e.join("\n")); }
});

test("parité : mêmes sorties, octet pour octet, que le moteur de l'app (déclencheurs, vue, ligne, ma semaine, effet sur le risque)", () => {
  for (const c of CAS) assert.deepEqual(J(executer(Gen, c)), J(executer(App, c)), c.id);
  const d = donneesDe(CAS.find(c => c.id === "SE-3"));
  assert.deepEqual(J(Gen.vue(d, "2026-10-15")), J(App.vue(d, "2026-10-15")));
  assert.deepEqual(J(Gen.ligne(d, "fam", "2026-10-15")), J(App.ligne(d, "fam", "2026-10-15")));
  assert.deepEqual(J(Gen.maSemaine(d, [], "2026-10-15")), J(App.maSemaine(d, [], "2026-10-15")));
});

/* ====================================================== outils du connecteur (suivi.ts) ====================================================== */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as nodeModule from "node:module";
import vm from "node:vm";
import { MoteurGen } from "./helpers/moteur-gen.mjs";
import { entreeDe, cas as casProjection } from "./helpers/projection-cas.mjs";

const path = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
const lire = rel => readFileSync(path(rel), "utf8");
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const TODAY = "2026-10-15";
const cas = id => CAS.find(c => c.id === id);

class UserErrorT extends Error {}
const fauxZ = () => { const f = new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : f), apply: () => f }); return f; };
function chargerModule(source, globaux = {}) {
  const noms = [...source.matchAll(/^export (?:const|function|async function) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`,
    { z: fauxZ(), RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console, isFinite, Infinity, TextEncoder, Intl, ...globaux });
}
/** Base factice : `reponse(requete)` fournit { data, error } pour chaque requête (table, ops) ou RPC. */
function fauxDb(reponse = () => ({ data: null, error: null })) {
  const appels = [];
  const from = table => {
    const r = { table, ops: [] }; appels.push(r);
    const p = new Proxy({}, { get: (_, k) => (k === "then" ? (ok, ko) => Promise.resolve(reponse(r)).then(ok, ko) : (...a) => { r.ops.push([k, ...a]); return p; }) });
    return p;
  };
  return { appels, from, rpc: async (nom, args) => { const r = { rpc: nom, args, ops: [] }; appels.push(r); return reponse(r); } };
}
const must = (t, r) => { if (r.error) throw new UserErrorT(`Erreur base de données (${t}) : ${r.error.message}`); return r.data; };
const DEPOT = { source: { optionnel: true }, justification: {}, lot: {} };
function serveur(register, db, extra = {}) {
  const outils = {};
  const deposes = [];
  const h = {
    db, UserError: UserErrorT, RO: { readOnlyHint: true }, RW: { readOnlyHint: false }, DEPOT, aal: "aal2", today: () => TODAY, must,
    wrap: fn => async a => { try { return { ok: await fn(a) }; } catch (e) { if (e instanceof UserErrorT) return { erreur: e.message }; throw e; } },
    deposer: async (items, d, extra2 = {}) => { deposes.push({ items, d }); return { message: items.length ? items.length + " proposition(s) déposée(s)" : "Aucun changement", propositions: items, ...extra2 }; },
    ...extra,
  };
  register({ registerTool: (nom, def, handler) => { outils[nom] = { def, handler }; } }, h);
  outils.deposes = deposes;
  return outils;
}
const SUIVI_TS = lire("supabase/functions/mcp/suivi.ts");
const chargerSuivi = () => chargerModule(SUIVI_TS, { Suivi: Gen, Projection: MoteurGen.Projection });
/** Base des lectures de suivi : rôles, profil de risque, routine (mémoire de revue), revues passées. */
function dbSuivi({ roles = [], risque = { profil: "equilibre" }, routine = null, revues = [], plans = [], propositions = [], config = {} } = {}) {
  return fauxDb(r => {
    if (r.table === "positions") return { data: roles, error: null };
    if (r.table === "profiles") return { data: { risque }, error: null };
    if (r.table === "routines") return { data: routine, error: null };
    if (r.table === "journal") return { data: revues, error: null };
    if (r.table === "plans_figes") return { data: plans, error: null };
    if (r.table === "propositions") return { data: propositions, error: null };
    if (r.table === "config") return { data: config, error: null };
    return { data: [], error: null };
  });
}
const donneesCas = id => { const d = donneesSuivi(cas(id)); return d; };
function donneesSuivi(c) { const d = J(c.data); const { reperes } = d; d.reperes = reperes || J(FIXTURE_REPERES); d.positions = d.positions.map(p => ({ ...p })); d.instruments = []; d.positions.forEach(p => { const i = (c.data.instruments || []).find(x => x.isin === p.isin); if (i) { p.ter = i.ter; p.devise = i.devise; } }); return d; }
import { FIXTURE as FIXTURE_SUIVI } from "./helpers/suivi-cas.mjs";
const FIXTURE_REPERES = FIXTURE_SUIVI.reperes;
const lireDonnees = id => async () => donneesCas(id);

test("suivi.ts : 4 outils, annotations (lecture seule pour trois, écriture par proposition pour definir_suivi)", { skip: SANS_STRIP }, () => {
  const S = chargerSuivi();
  const T = serveur(S.registerSuivi, dbSuivi(), { lireDonnees: lireDonnees("SY-1") });
  assert.deepEqual(Object.keys(T).filter(k => k !== "deposes").sort(), ["ca_vaut_le_cout", "definir_suivi", "ligne", "suivi_lignes"]);
  for (const n of ["suivi_lignes", "ligne", "ca_vaut_le_cout"]) assert.equal(T[n].def.annotations.readOnlyHint, true, n + " en lecture seule");
  assert.equal(T.definir_suivi.def.annotations.readOnlyHint, false);
  assert.equal(S.CONDUITE_SUIVI.length, 8, "les 8 règles de la conduite (§ 12.3)");
  assert.match(S.CONDUITE_SUIVI.join("\n"), /ca_vaut_le_cout/);
  assert.match(S.CONDUITE_SUIVI.join("\n"), /ne rien faire est la meilleure option ici/);
});

test("suivi_lignes : rôles, système, météo, déclencheurs avec leur verdict, politique, conduite ; aucun nom de ligne dans un titre", { skip: SANS_STRIP }, async () => {
  const S = chargerSuivi(), c = cas("DE-9");
  const T = serveur(S.registerSuivi, dbSuivi(), { lireDonnees: lireDonnees("DE-9") });
  const r = (await T.suivi_lignes.handler({})).ok;
  assert.equal(r.date, TODAY);
  assert.equal(r.systeme.plafond_depasse, true);
  assert.equal(r.systeme.plafond_satellite_pct, 15);
  assert.ok(r.lignes.length >= 2 && r.lignes.every(l => l.role && l.meteo && l.meteo_libelle && Array.isArray(l.constats)));
  assert.ok(r.roles_a_confirmer.length >= 1, "les rôles proposés sont à confirmer");
  const plafond = r.declencheurs.find(d => d.cle === "satellite_plafond"), conc = r.declencheurs.find(d => d.cle === "concentration");
  assert.equal(plafond.ca_vaut_le_cout.verdict, "a_peser");
  assert.equal(conc.ca_vaut_le_cout.cout_unique, 202.5);
  for (const d of r.declencheurs) { assert.doesNotMatch(d.titre, /Société Exemple/); assert.doesNotMatch(d.phrase || "", /Société Exemple/); }
  assert.match(r.conduite.join("\n"), /Juge toujours au regard des objectifs/);
  assert.equal(r.politique.source, "config", "la fixture DE-9 fixe le mois de revue du cœur");
  assert.ok(c.data.positions.every(p => !("role" in p)), "la fixture ne porte aucun rôle validé");
});

test("suivi_lignes : les rôles validés (positions.role) et la mémoire de revue (routines.etat_suivi) sont lus ; le périmètre p1 filtre", { skip: SANS_STRIP }, async () => {
  const S = chargerSuivi();
  const d = donneesCas("DE-4");
  const T = serveur(S.registerSuivi, dbSuivi({ roles: [{ id: "fam", role: "satellite", role_source: "valide" }], routine: { dernier_passage: "2026-03-05T06:00:00+00:00",
    etat_suivi: { le: "2026-03-05", revue_coeur_faite_le: "2026-03-05", declencheurs: [{ cle: "frais_eleves", cible: "actions|Assurance vie Exemple", mesure: 1.6 }], constats: {}, meteo: { fam: "eclaircies" } } },
    revues: [{ cree_le: "2026-03-05T06:10:00+00:00" }, { cree_le: "2026-04-02T06:10:00+00:00" }] }), { lireDonnees: async () => d });
  const r = (await T.suivi_lignes.handler({})).ok;
  assert.equal(r.lignes[0].role, "satellite");
  assert.equal(r.lignes[0].role_source, "valide");
  assert.equal(r.lignes[0].role_a_confirmer, false);
  assert.equal(r.roles_a_confirmer.length, 0);
  const frais = r.declencheurs.find(x => x.cle === "frais_eleves");
  assert.equal(frais.visible, true, "ligne du satellite : revue chaque mois");
  const p2 = (await T.suivi_lignes.handler({ perimetre: "p2" })).ok;
  assert.equal(p2.lignes.length, 0, "aucune ligne pour p2");
});

test("ligne : constats complets, prochaine revue, leviers de la classe dans son enveloppe avec le verdict ; ligne inconnue refusée", { skip: SANS_STRIP }, async () => {
  const S = chargerSuivi();
  const T = serveur(S.registerSuivi, dbSuivi(), { lireDonnees: lireDonnees("DE-1") });
  const r = (await T.ligne.handler({ position_id: "fam" })).ok;
  assert.equal(r.position_id, "fam");
  assert.ok(r.constats.every(k => "calcul" in k && "repere" in k && "donnees" in k && !("points" in k)));
  const frais = r.leviers.find(x => x.cle === "frais_eleves");
  assert.equal(frais.ca_vaut_le_cout.verdict, "vaut_le_cout");
  assert.match(frais.titre, /Actions.*Assurance vie Exemple/);
  assert.doesNotMatch(frais.titre, /Fonds Actions Monde A/);
  assert.match(frais.phrase, /Classe Actions dans « Assurance vie Exemple »/);
  const inconnue = await T.ligne.handler({ position_id: "inexistante" });
  assert.match(inconnue.erreur, /Ligne introuvable/);
});

test("ca_vaut_le_cout : verdict, point mort, alternative par les versements avec la capacité, et « à compléter » sans prix de revient", { skip: SANS_STRIP }, async () => {
  const S = chargerSuivi();
  const T = serveur(S.registerSuivi, dbSuivi(), { lireDonnees: lireDonnees("VC-3") });
  const r = (await T.ca_vaut_le_cout.handler({ levier: "frais_classe", position_id: "fct" })).ok;
  assert.equal(r.verdict, "ne_rien_faire");
  assert.equal(r.gain_annuel, 95);
  assert.equal(r.cout_unique, 2106.2);
  assert.match(r.phrase, /ne rien changer à cette classe est l'option la moins coûteuse/);
  assert.equal(r.alternative.levier, "versements_orientes");
  assert.match(r.conduite.join("\n"), /ca_vaut_le_cout/);
  const T2 = serveur(S.registerSuivi, dbSuivi(), { lireDonnees: lireDonnees("VC-21") });
  const sans = (await T2.ca_vaut_le_cout.handler({ levier: "frais_classe", position_id: "fct" })).ok;
  assert.equal(sans.verdict, null);
  assert.match(sans.manque.join(" "), /prix de revient/);
  const T3 = serveur(S.registerSuivi, dbSuivi(), { lireDonnees: lireDonnees("VC-14") });
  const orient = (await T3.ca_vaut_le_cout.handler({ levier: "versements_orientes", classe: "actions", capacite_mensuelle: 1700 })).ok;
  assert.equal(orient.mois_pour_combler, 7);
  assert.equal(orient.capacite_mensuelle, 1700);
  const inconnue = await T.ca_vaut_le_cout.handler({ levier: "frais_classe", position_id: "xx" });
  assert.match(inconnue.erreur, /Ligne introuvable/);
});

test("ca_vaut_le_cout : un levier de risque renvoie l'effet sur la probabilité des objectifs (mêmes tirages), en fréquences, sans euros ajoutés", { skip: SANS_STRIP }, async () => {
  const S = chargerSuivi();
  const d = entreeDe(casProjection("D-1"));
  d.positions = [{ id: "pea", name: "Fonds Actions Monde A", envelope: "PEA Exemple", owner: "p1", bloc: "Monde", mode: "manual", value: 100000, status: "actif" }];
  d.config.enveloppes_infos = { "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture: "2019-03-10", source: "exemple", le: "2026-10-01" } };
  d.objectifs = [{ id: "o-apport", nom: "Apport 2029", type: "apport", cible: 90000, dateCible: "2029-06-30", poches: ["Monde"], enveloppes: [], source: "poches" }];
  d.reperes = [...d.reperes, ...FIXTURE_REPERES.filter(r => !d.reperes.some(x => x.cle === r.cle))];
  d.instruments = [];
  const T = serveur(S.registerSuivi, dbSuivi(), { lireDonnees: async () => d });
  const r = (await T.ca_vaut_le_cout.handler({ levier: "securiser_objectif", position_id: "pea", objectif: "o-apport", montant: 80000 })).ok;
  assert.ok(r.verdict, "un verdict : " + JSON.stringify(r.manque));
  assert.ok(r.effet_sur_le_risque, "effet sur le risque");
  assert.ok(r.effet_sur_le_risque.objectifs[0].apres > r.effet_sur_le_risque.objectifs[0].avant);
  assert.doesNotMatch(JSON.stringify(r.effet_sur_le_risque), /€/);
});

test("definir_suivi : rôles et politique déposés en propositions (position et config.suivi), jamais écrits ; aucun dépôt si rien ne change", { skip: SANS_STRIP }, async () => {
  const S = chargerSuivi();
  const db = fauxDb(r => {
    if (r.table === "positions") return { data: [{ id: "aaaaaaaa-0000-4000-8000-000000000001", role: "coeur", role_source: "propose" }, { id: "aaaaaaaa-0000-4000-8000-000000000002", role: null, role_source: null }], error: null };
    if (r.table === "config") return { data: { suivi: { revue_coeur: "annuelle", plafond_satellite_pct: 15, source: "ancienne", le: "2026-01-01" } }, error: null };
    return { data: [], error: null };
  });
  const T = serveur(S.registerSuivi, db, { lireDonnees: lireDonnees("SY-1") });
  const A = "aaaaaaaa-0000-4000-8000-000000000001", B = "aaaaaaaa-0000-4000-8000-000000000002";
  const r = (await T.definir_suivi.handler({ roles: [{ position_id: A, role: "satellite" }, { position_id: B, role: "coeur" }], politique: { plafond_satellite_pct: 12, semaine: { jour: "mardi" } }, source: "Ce que tu as dit à Claude" })).ok;
  const items = T.deposes[0].items;
  assert.equal(items.length, 3);
  assert.deepEqual(J(items[0]), { cible: "position", operation: "modifier", ref: A, avant: { role: "coeur", role_source: "propose" }, apres: { role: "satellite", role_source: "valide" } });
  assert.deepEqual(J(items[1].apres), { role: "coeur", role_source: "valide" });
  assert.equal(items[2].cible, "config");
  assert.deepEqual(J(items[2].apres.suivi), { revue_coeur: "annuelle", plafond_satellite_pct: 12, semaine: { actif: true, jour: "mardi" }, source: "Ce que tu as dit à Claude", le: TODAY });
  assert.equal(items[2].avant.suivi.plafond_satellite_pct, 15);
  assert.ok(r.conduite.length === 8);
  // rien ne change : aucune proposition
  const T2 = serveur(S.registerSuivi, db, { lireDonnees: lireDonnees("SY-1") });
  await T2.definir_suivi.handler({ roles: [{ position_id: A, role: "coeur" }], source: "x" });
  assert.equal(T2.deposes[0].items.length, 1, "coeur/propose → coeur/valide est un changement (la validation)");
  const T3 = serveur(S.registerSuivi, db, { lireDonnees: lireDonnees("SY-1") });
  await T3.definir_suivi.handler({ politique: { plafond_satellite_pct: 15 }, source: "x" });
  assert.equal(T3.deposes[0].items.length, 0, "politique identique : rien à proposer");
});

test("definir_suivi : bornes de la politique (mêmes que la migration), ligne inconnue, ligne en double, rien à proposer", { skip: SANS_STRIP }, async () => {
  const S = chargerSuivi();
  for (const [p, motif] of [[{ plafond_satellite_pct: 31 }, /plafond_satellite_pct/], [{ plafond_satellite_pct: -1 }, /plafond_satellite_pct/], [{ seuil_ecart_pts: 2 }, /seuil_ecart_pts/], [{ seuil_ecart_pts: 11 }, /seuil_ecart_pts/],
    [{ seuil_baisse_satellite_pct: 9 }, /seuil_baisse/], [{ seuil_baisse_satellite_pct: 51 }, /seuil_baisse/], [{ mois_revue_coeur: 13 }, /mois_revue_coeur/], [{ mois_revue_coeur: 0 }, /mois_revue_coeur/],
    [{ mois_revue_coeur: 2.5 }, /mois_revue_coeur/], [{ revue_coeur: "mensuelle" }, /revue_coeur/], [{ semaine: { jour: "demain" } }, /semaine/]]) {
    const v = S.politiqueValide(p);
    assert.ok(v.erreurs.length && motif.test(v.erreurs.join(" ")), JSON.stringify(p));
  }
  for (const p of [{ plafond_satellite_pct: 0 }, { plafond_satellite_pct: 30 }, { seuil_ecart_pts: 3 }, { seuil_ecart_pts: 10 }, { seuil_baisse_satellite_pct: 10 }, { seuil_baisse_satellite_pct: 50 }, { mois_revue_coeur: 1 }, { mois_revue_coeur: 12 }, { revue_coeur: "semestrielle" }])
    assert.equal(S.politiqueValide(p).erreurs.length, 0, JSON.stringify(p));
  const db = fauxDb(r => (r.table === "positions" ? { data: [{ id: "aaaaaaaa-0000-4000-8000-000000000001" }], error: null } : { data: {}, error: null }));
  const T = serveur(S.registerSuivi, db, { lireDonnees: lireDonnees("SY-1") });
  assert.match((await T.definir_suivi.handler({ source: "x" })).erreur, /Rien à proposer/);
  assert.match((await T.definir_suivi.handler({ roles: [{ position_id: "aaaaaaaa-0000-4000-8000-0000000000ff", role: "coeur" }], source: "x" })).erreur, /Ligne introuvable/);
  assert.match((await T.definir_suivi.handler({ roles: [{ position_id: "aaaaaaaa-0000-4000-8000-000000000001", role: "coeur" }, { position_id: "aaaaaaaa-0000-4000-8000-000000000001", role: "satellite" }], source: "x" })).erreur, /en double/);
  assert.match((await T.definir_suivi.handler({ politique: { plafond_satellite_pct: 50 }, source: "x" })).erreur, /plafond_satellite_pct/);
  assert.equal(T.deposes.length, 0, "aucun dépôt sur erreur");
});

test("demarrer_session : suivi léger (semaine, revue du cœur, rôles à confirmer), null sans lever si la lecture échoue", { skip: SANS_STRIP }, async () => {
  const S = chargerSuivi();
  const r = await S.suiviDeSession(dbSuivi(), must, TODAY, lireDonnees("DE-1"));
  assert.deepEqual(Object.keys(r).sort(), ["plafond_depasse", "revue_coeur", "roles_a_confirmer", "semaine"]);
  assert.equal(r.roles_a_confirmer, 1);
  assert.ok(r.semaine.a_faire >= 2, "frais de la classe (vaut le coût) et écarts à la cible : " + r.semaine.a_faire);
  assert.equal(r.revue_coeur.frequence, "annuelle");
  const ko = await S.suiviDeSession(dbSuivi(), must, TODAY, async () => { throw new Error("panne"); });
  assert.equal(ko, null);
});

test("demarrer_routine : déclencheurs du mois selon la politique ; état de revue calculé côté serveur (jamais fourni par l'agent)", { skip: SANS_STRIP }, async () => {
  const S = chargerSuivi();
  const rev = await S.suiviDeRevue(dbSuivi(), must, TODAY, lireDonnees("DE-9"));
  assert.ok(rev.declencheurs_du_mois.length >= 2 && rev.declencheurs_du_mois.every(d => d.visible));
  assert.ok(rev.roles_a_confirmer.length >= 2);
  assert.ok(rev.roles_a_confirmer.every(l => l.position_id && l.raison));
  assert.equal(rev.revue_coeur.frequence, "annuelle");
  const etat = await S.etatSuiviDeCloture(dbSuivi(), must, TODAY, lireDonnees("DE-1"), true);
  assert.equal(etat.le, TODAY);
  assert.equal(etat.revue_coeur_faite_le, TODAY);
  assert.ok(etat.declencheurs.some(d => d.cle === "frais_eleves" && d.cible === "actions|Assurance vie Exemple"));
  assert.equal(etat.meteo.fam, "a_regarder");
  assert.ok(JSON.stringify(etat).length < 20000);
  assert.equal((await S.etatSuiviDeCloture(dbSuivi(), must, TODAY, lireDonnees("DE-1"), false)).revue_coeur_faite_le, null);
});
