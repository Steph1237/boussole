// PROJ, tâche 9 : connecteur MCP de projection (supabase/functions/mcp/projection.ts) et copie générée du moteur
// (supabase/functions/mcp/projection-moteur.gen.js, scripts/gen-catalogue.mjs).
// - la copie est à jour (npm run gen) et donne exactement les sorties du moteur de l'app (cas de référence, démo) ;
// - les outils decrire_foyer, lire_foyer, projeter, comparer_variantes, capacite_emprunt : annotations, validations, propositions, résumés ;
// - demarrer_session.projection, list_objectifs.probabilite, conduite (INSTRUCTIONS et Copilote), tutoiement.
// Le module est exécuté dans un contexte vm (types retirés, zod simulé, base factice), sur le modèle de test/calendrier-mcp.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import vm from "node:vm";
import { genererMoteur, SORTIE_MOTEUR, MODULES_MOTEUR } from "../scripts/gen-catalogue.mjs";
import { FIXTURE, entreeDe } from "./helpers/projection-cas.mjs";

const require = createRequire(import.meta.url);
const path = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
const lire = rel => readFileSync(path(rel), "utf8");
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const J = v => JSON.parse(JSON.stringify(v));
const TODAY = "2026-10-14";
const App = require("../web/src/projection.js");
const AppEv = require("../web/src/projection-evenements.js");
const D = require("../web/src/demo-data.js");

/* ---------------------------------------------------------------- copie générée du moteur */
const srcGen = lire(SORTIE_MOTEUR);
function chargerGen() {
  const js = srcGen.replace(/^export const (\w+) = /gm, "const $1 = ");
  const noms = [...srcGen.matchAll(/^export const (\w+) = /gm)].map(m => m[1]);
  return vm.runInThisContext(`(function(){ ${js}\n;return { ${noms.join(", ")} }; })()`);
}
const Gen = chargerGen();

test("la copie du moteur est à jour (npm run gen) et ne contient aucun import", () => {
  assert.equal(srcGen, genererMoteur(), "projection-moteur.gen.js périmé : lancer npm run gen");
  assert.doesNotMatch(srcGen, /^import /m);
  assert.deepEqual(Object.keys(Gen).sort(), ["Calc", "Calendrier", "Evenements", "Marche", "Plan", "Projection", "Reperes", "Scenarios"]);
  for (const m of MODULES_MOTEUR) assert.ok(srcGen.includes("web/src/" + m + ".js"), m);
});
test("la copie recopie les sources de l'app telles quelles (aucune modification)", () => {
  for (const m of MODULES_MOTEUR) {
    const src = lire("web/src/" + m + ".js").replace(/\r\n/g, "\n").replace(/\s+$/, "");
    assert.ok(srcGen.includes("\n" + src + "\n});"), "source de " + m + " modifiée dans la copie");
  }
});
test("la copie donne exactement les sorties du moteur de l'app : cas déterministes de référence", () => {
  let n = 0;
  for (const c of FIXTURE.cas.filter(x => /^(D|C|G|E)-/.test(x.id) && x.data)) {
    const data = entreeDe(c), opts = { ...c.options };
    let a, b;
    try { a = App.simuler(App.preparer(data, opts), { volatilite: 0 }); } catch (e) { continue; }
    b = Gen.Projection.simuler(Gen.Projection.preparer(J(data), opts), { volatilite: 0 });
    assert.deepEqual(J(b), J(a), c.id);
    n++;
  }
  assert.ok(n >= 20, "au moins 20 cas rejoués (" + n + ")");
});
test("la copie donne exactement les sorties du moteur de l'app : Monte-Carlo, comparaison, capacité d'emprunt, plan figé", () => {
  const data = App.depuisEtat(J({ positions: D.positions, config: D.config, profil: D.profil, budget: D.budget, banque: D.banque, objectifs: D.objectifs, foyer: D.foyer, savoir: D.savoir, indices: D.indices, classes: D.classes }), TODAY);
  const opt = { horizon_ans: 10, perimetre: "foyer", vue: "net", euros: "constants" };
  const sim = P => P.simuler(P.preparer(J(data), opt), { chemins: 400 });
  assert.deepEqual(J(sim(Gen.Projection)), J(sim(App)));
  const idV = D.foyer.variantes[0].id;
  const cmp = P => P.comparer(P.preparer(J(data), opt), P.preparer(J(data), { ...opt, variante: idV }), { chemins: 300 });
  assert.deepEqual(J(cmp(Gen.Projection)), J(cmp(App)));
  assert.deepEqual(J(Gen.Projection.capaciteEmprunt(J(data), { perimetre: "foyer" })), J(App.capaciteEmprunt(J(data), { perimetre: "foyer" })));
  assert.equal(Gen.Projection.versionModele, App.versionModele);
});

/* ---------------------------------------------------------------- module du connecteur, exécuté dans un contexte vm */
class UserErrorT extends Error {}
const fauxZ = () => { const f = new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : f), apply: () => f }); return f; };
function chargerModule(source, globaux = {}) {
  const noms = [...source.matchAll(/^export (?:const|function|async function) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`,
    { z: fauxZ(), RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console, isFinite, isNaN, Infinity, Intl, Error, TextEncoder, crypto: globalThis.crypto, ...globaux });
}
const srcProjection = lire("supabase/functions/mcp/projection.ts");
const PM = SANS_STRIP ? null : chargerModule(srcProjection, { Projection: Gen.Projection, Evenements: Gen.Evenements, Marche: Gen.Marche, Reperes: Gen.Reperes });

const must = (t, r) => { if (r.error) throw new UserErrorT(`Erreur base de données (${t}) : ${r.error.message}`); return r.data; };
const snake = { connexionId: "connexion_id", soldeLe: "solde_le", positionId: "position_id", creditId: "credit_id", doublonDe: "doublon_de", rattacheAuto: "rattache_auto", creeAuto: "cree_auto", compteId: "compte_id" };
const enSnake = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [snake[k] || k, v]));
const positionEnLigne = p => {
  const { price, priceDate, ter, zone, devise, qtyEstimated, valueDate, ...r } = p;
  const ins = price != null || ter != null || zone != null || devise != null ? { price, price_date: priceDate, ter, zone, devise } : null;
  return { ...r, qty_estimated: !!qtyEstimated, value_date: valueDate, price_override: null, instrument: ins };
};
const objectifEnLigne = ({ dateCible, ...o }) => ({ ...o, date_cible: dateCible });
const repereEnLigne = r => ({ cle: r.cle, libelle: r.libelle, valeur: r.valeur, unite: r.unite, date_effet: r.dateEffet, date_fin: r.dateFin ?? null, source_titre: r.sourceTitre, source_url: r.sourceUrl, verifie_le: r.verifieLe, mode: r.mode });

/** Base factice : tables de la démo en lignes SQL ; `surcharge` remplace une table. */
function faux(surcharge = {}, { erreurs = {} } = {}) {
  const tables = {
    positions: D.positions.map(positionEnLigne), config: J(D.config), profiles: { foyer: D.profil.foyer, personnes: D.profil.personnes, autres: D.profil.autres, protection: D.profil.protection, classes: D.classes },
    biens: J(D.profil.biens), credits: J(D.profil.credits), budgets: { lignes: J(D.budget.lignes) }, objectifs: D.objectifs.map(objectifEnLigne),
    foyer_evenements: J(D.foyer.evenements), foyer_variantes: J(D.foyer.variantes), reperes: D.savoir.reperes.map(repereEnLigne), indices_mensuels: J(D.indices), plans_figes: [],
    ...surcharge,
  };
  const appels = [];
  const un = new Set(["config", "profiles", "budgets"]);
  const from = table => {
    const r = { table, ops: [] }; appels.push(r);
    const p = new Proxy({}, { get: (_, k) => (k === "then" ? (ok, ko) => {
      const e = erreurs[table];
      return Promise.resolve(e ? { data: null, error: e } : { data: tables[table] === undefined ? null : tables[table], error: null }).then(ok, ko);
    } : (...a) => { r.ops.push([k, ...a]); return p; }) });
    return p;
  };
  return { appels, tables, from };
}
const banqueDemo = () => ({ comptes: D.banque.comptes.map(enSnake), mois: D.banque.mois.map(enSnake) });
const depots = [];
const deposer = async (items, d, extra = {}) => {
  depots.push({ items: J(items), d, extra: J(extra) });
  return { message: items.length ? "déposé" : "Aucun changement", lot: "lot-1", propositions: items.map((it, i) => ({ id: "p" + i, cible: it.cible, operation: it.operation, ref: it.ref ?? null, avant: it.avant ?? null, apres: it.apres ?? null })), ...extra };
};
const SRC = { source: "Ce que tu as dit à Claude (exemple)" };
const DEPOT = new Proxy({}, { get: () => fauxZ() });
function outils(db, extra = {}) {
  const T = {};
  const h = { db, UserError: UserErrorT, RO: { readOnlyHint: true }, RW: { readOnlyHint: false }, must, DEPOT, deposer, today: () => TODAY, banque: async () => banqueDemo(),
    wrap: fn => async a => { try { return { ok: await fn(a ?? {}) }; } catch (e) { if (e instanceof UserErrorT) return { erreur: e.message }; throw e; } }, ...extra };
  PM.registerProjection({ registerTool: (nom, def, handler) => { T[nom] = { def, handler }; } }, h);
  return T;
}
const ok = async p => { const r = await p; assert.equal(r.erreur, undefined, "erreur inattendue : " + r.erreur); return r.ok; };
const echec = async p => { const r = await p; assert.notEqual(r.erreur, undefined, "erreur attendue"); return r.erreur; };
const T0 = SANS_STRIP ? null : outils(faux());
const ID_VAR = D.foyer.variantes[0].id;
const ID_EV = D.foyer.evenements[0].id;
const taille = o => JSON.stringify(o).length;

/** Entrée du moteur de l'app pour la démo (banque du store démo). */
const entreeApp = () => App.depuisEtat(J({ positions: D.positions, config: D.config, profil: D.profil, budget: D.budget, banque: D.banque, objectifs: D.objectifs, foyer: D.foyer, savoir: D.savoir, indices: D.indices, classes: D.classes }), TODAY);

/* ---------------------------------------------------------------- outils : liste, annotations, schémas */
test("outils : decrire_foyer, figer_projection, lire_foyer, projeter, comparer_variantes, capacite_emprunt enregistrés ; projeter reste en lecture seule", { skip: SANS_STRIP }, () => {
  assert.deepEqual(Object.keys(T0).sort(), ["capacite_emprunt", "comparer_variantes", "decrire_foyer", "figer_projection", "lire_foyer", "projeter"]);
  assert.equal(T0.decrire_foyer.def.annotations.readOnlyHint, false);
  assert.equal(T0.figer_projection.def.annotations.readOnlyHint, false, "figer_projection dépose une proposition");
  for (const n of ["lire_foyer", "comparer_variantes", "capacite_emprunt", "projeter"]) assert.equal(T0[n].def.annotations.readOnlyHint, true, n);
});
test("schémas : horizon, périmètre, vue, euros, variante, crise, figer ; DEPOT dans les outils qui proposent", () => {
  const src = srcProjection;
  assert.match(src, /refine\(\(x: number\) => HORIZONS\.includes\(x\)/);
  assert.match(src, /z\.enum\(\["foyer", "p1", "p2"\]/);
  assert.match(src, /z\.enum\(\["net", "financier", "disponible"\]/);
  assert.match(src, /z\.enum\(\["constants", "courants"\]/);
  assert.match(src, /z\.enum\(\["revue_mensuelle", "objectif", "manuel"\]/);
  assert.match(src, /\.\.\.DEPOT/, "decrire_foyer reprend le dépôt (source obligatoire)");
  assert.match(src, /limit|max\(10/);
});

/* ---------------------------------------------------------------- lecture des données (lignes SQL → formes de l'app) */
test("lecture : les lignes SQL de la démo redonnent la même projection que le store (chaque chiffre du résumé)", { skip: SANS_STRIP }, async () => {
  const db = faux();
  const data = await PM.lireDonneesProjection(db, must, TODAY, async () => banqueDemo());
  const opts = { horizon_ans: 10, perimetre: "foyer", vue: "net", euros: "constants" };
  const a = App.simuler(App.preparer(entreeApp(), opts), {});
  const b = Gen.Projection.simuler(Gen.Projection.preparer(data, opts), {});
  assert.deepEqual(J(PM.resumeProjection(b)), J(PM.resumeProjection(a)));
  assert.equal(b.phrase, a.phrase);
  assert.deepEqual(J(b.vues.net.p50), J(a.vues.net.p50));
  assert.deepEqual(J(b.capacite_base), J(a.capacite_base));
  assert.deepEqual(data.foyer.evenements.map(e => e.id), D.foyer.evenements.map(e => e.id));
  assert.ok(data.reperes.length >= 68 && data.indices.length >= 60);
});
test("lecture : tables de projection pas encore créées (migration non appliquée) → listes vides, pas d'échec ; autre erreur → échec", { skip: SANS_STRIP }, async () => {
  const absent = { code: "42P01", message: 'relation "public.foyer_evenements" does not exist' };
  const db = faux({}, { erreurs: { foyer_evenements: absent, foyer_variantes: absent, indices_mensuels: absent } });
  const data = await PM.lireDonneesProjection(db, must, TODAY);
  assert.deepEqual(J(data.foyer), { evenements: [], variantes: [] });
  assert.deepEqual(J(data.indices), []);
  await assert.rejects(PM.lireDonneesProjection(faux({}, { erreurs: { positions: { code: "XX000", message: "boum" } } }), must, TODAY), /boum/);
});
test("lecture : banque absente ou en échec → budget prévu (banque null), jamais d'échec", { skip: SANS_STRIP }, async () => {
  assert.equal((await PM.lireDonneesProjection(faux(), must, TODAY)).banque, null);
  assert.equal((await PM.lireDonneesProjection(faux(), must, TODAY, async () => { throw new Error("réseau"); })).banque, null);
  const d = await PM.lireDonneesProjection(faux(), must, TODAY, async () => banqueDemo());
  assert.equal(d.banque.actif, true);
  assert.ok(d.banque.comptes.length > 0);
});

/* ---------------------------------------------------------------- lire_foyer */
test("lire_foyer : événements, variantes, réglages, plans figés, catalogue des types, types réservés, limites, conduite", { skip: SANS_STRIP }, async () => {
  const r = await ok(T0.lire_foyer.handler({}));
  assert.equal(r.evenements.length, D.foyer.evenements.length);
  assert.equal(r.evenements[0].id, ID_EV);
  assert.equal(r.variantes[0].nom, "2ᵉ enfant");
  assert.equal(r.reglages.tmi_pct, 30);
  assert.deepEqual(J(r.plans_figes), []);
  assert.equal(r.question, null);
  const types = r.types.map(t => t.type);
  for (const t of ["naissance", "creche", "achat_immobilier", "changement_emploi", "conge_parental", "fin_credit", "hausse_revenu", "retrait", "crise", "scolarite_privee"]) assert.ok(types.includes(t), t);
  assert.ok(r.types.find(t => t.type === "naissance").defauts.some(d => d.repere === "enfant_fin_charge_age"));
  assert.ok(r.types_reserves.includes("demenagement") && r.types_reserves.includes("chomage"));
  assert.deepEqual(J(r.limites), { evenements: 100, variantes: 10, par_appel: 10, plans_figes: 60 });
  assert.equal(r.conduite.length, 8);
});
test("lire_foyer : aucun événement → la question posée une fois (règle 7) ; tables absentes → vide sans échec", { skip: SANS_STRIP }, async () => {
  const r = await ok(outils(faux({ foyer_evenements: [], foyer_variantes: [] })).lire_foyer.handler({}));
  assert.deepEqual(r.evenements, []);
  assert.match(r.question, /Tu as des changements prévus|as-tu des changements prévus/);
  assert.match(r.question, /Un enfant, un changement d'emploi, un déménagement, un achat \?/);
  const absent = { code: "42P01", message: "does not exist" };
  const r2 = await ok(outils(faux({}, { erreurs: { foyer_evenements: absent, foyer_variantes: absent, plans_figes: absent } })).lire_foyer.handler({}));
  assert.deepEqual(J([r2.evenements, r2.variantes, r2.plans_figes]), [[], [], []]);
});

/* ---------------------------------------------------------------- decrire_foyer */
const naissance = (extra = {}) => ({ type: "naissance", personne: "foyer", libelle: "Enfant 2", date: "2027-03-01", params: { enfant: "Enfant 2" }, ...extra });
test("decrire_foyer : une naissance → une proposition evenement/creer, source reprise, valeurs par défaut sourcées renvoyées", { skip: SANS_STRIP }, async () => {
  depots.length = 0;
  const r = await ok(T0.decrire_foyer.handler({ evenements: [naissance()], ...SRC, justification: "Naissance prévue" }));
  assert.equal(depots.length, 1);
  const [it] = depots[0].items;
  assert.equal(it.cible, "evenement"); assert.equal(it.operation, "creer");
  assert.deepEqual(it.apres, { type: "naissance", personne: "foyer", libelle: "Enfant 2", date: "2027-03-01", params: { enfant: "Enfant 2" }, source: SRC.source });
  assert.equal(depots[0].d.source, SRC.source);
  const dv = r.valeurs_par_defaut.find(x => x.type === "naissance");
  assert.equal(dv.evenement, "Enfant 2");
  const fin = dv.valeurs.find(v => v.cle === "fin_age");
  assert.equal(fin.repere, "enfant_fin_charge_age"); assert.equal(typeof fin.valeur, "number"); assert.ok(fin.source, "la source du repère est dite");
  assert.ok(dv.valeurs.some(v => v.cle === "cout_mode" && /hypothèse de Boussole/.test(v.source)));
  assert.match(r.propose[0], /^Ajouter : Naissance « Enfant 2 » le 01\/03\/2027/);
  assert.match(r.rappel, /valid/);
});
test("decrire_foyer : changement_emploi et conge_parental acceptés (paramètres de l'événement conservés)", { skip: SANS_STRIP }, async () => {
  depots.length = 0;
  await ok(T0.decrire_foyer.handler({ evenements: [
    { type: "changement_emploi", personne: "p1", libelle: "Nouvel emploi d'Alex", date: "2027-01-15", params: { personne: "p1", salaire_net_mensuel: 3100, revenu_reference_mensuel: 2600 } },
    { type: "conge_parental", personne: "p2", libelle: "Congé parental de Sam", date: "2027-04-01", fin: "2027-10-01", params: { personne: "p2", activite: "arret", enfant: "Enfant 2", rang_enfant: 2 } },
  ], ...SRC }));
  assert.deepEqual(depots[0].items.map(i => i.apres.type), ["changement_emploi", "conge_parental"]);
  assert.equal(depots[0].items[1].apres.fin, "2027-10-01");
  assert.equal(depots[0].items[0].apres.params.salaire_net_mensuel, 3100);
});
test("decrire_foyer : types réservés refusés (déménagement…), type inconnu, validations avec les messages du moteur", { skip: SANS_STRIP }, async () => {
  const M = AppEv.MESSAGES;
  for (const t of AppEv.TYPES_RESERVES) {
    const e = await echec(T0.decrire_foyer.handler({ evenements: [naissance({ type: t })], ...SRC }));
    assert.ok(e.includes(M.type_reserve), t + " : " + e);
  }
  assert.ok((await echec(T0.decrire_foyer.handler({ evenements: [naissance({ type: "voyage" })], ...SRC }))).includes("Type d'événement inconnu"));
  assert.ok((await echec(T0.decrire_foyer.handler({ evenements: [naissance({ personne: "p3" })], ...SRC }))).includes(M.personne));
  assert.ok((await echec(T0.decrire_foyer.handler({ evenements: [naissance({ libelle: "" })], ...SRC }))).includes(M.libelle));
  assert.ok((await echec(T0.decrire_foyer.handler({ evenements: [naissance({ date: "2099-01-01" })], ...SRC }))).includes(M.date));
  assert.ok((await echec(T0.decrire_foyer.handler({ evenements: [naissance({ date: "2027-02-30" })], ...SRC }))).includes(M.date));
  assert.ok((await echec(T0.decrire_foyer.handler({ evenements: [naissance({ fin: "2026-01-01" })], ...SRC }))).includes(M.fin));
  assert.ok((await echec(T0.decrire_foyer.handler({ evenements: [naissance({ params: {} })], ...SRC }))).includes(M.enfant));
  assert.ok((await echec(T0.decrire_foyer.handler({ evenements: [{ type: "achat_immobilier", personne: "foyer", libelle: "Achat", date: "2028-05-01", params: { usage: "rp" } }], ...SRC }))).includes("Indique le prix du bien"));
  assert.ok((await echec(T0.decrire_foyer.handler({ evenements: [naissance({ source: "" })], source: "" }))).includes(M.source));
  const e = await echec(T0.decrire_foyer.handler({ evenements: [naissance({ type: "demenagement" }), naissance({ libelle: "" })], ...SRC }));
  assert.match(e, /Événement 1 \(Enfant 2\) : .*\n- Événement 2 : /s, "toutes les erreurs sont listées");
  assert.match(e, /^Aucune proposition déposée/);
});
test("decrire_foyer : fin_credit contrôlé contre les crédits de l'utilisateur", { skip: SANS_STRIP }, async () => {
  const credit = D.profil.credits[0];
  const ev = (credit_id) => ({ type: "fin_credit", personne: "foyer", libelle: "Fin du prêt auto", date: "2027-09-01", params: { credit: credit_id } });
  depots.length = 0;
  await ok(T0.decrire_foyer.handler({ evenements: [ev("credit:" + credit.id)], ...SRC }));
  assert.equal(depots[0].items[0].apres.type, "fin_credit");
  await echec(T0.decrire_foyer.handler({ evenements: [ev("credit:6f1c2a9e-0000-4000-8000-0000000000ff")], ...SRC }));
});
test("decrire_foyer : modification (seuls les champs qui changent), aucun changement → aucune proposition, suppression", { skip: SANS_STRIP }, async () => {
  depots.length = 0;
  await ok(T0.decrire_foyer.handler({ evenements: [{ id: ID_EV, date: "2025-04-20" }], ...SRC }));
  assert.deepEqual(depots[0].items[0], { cible: "evenement", operation: "modifier", ref: ID_EV, avant: { date: D.foyer.evenements[0].date }, apres: { date: "2025-04-20" } });
  depots.length = 0;
  const r = await ok(T0.decrire_foyer.handler({ evenements: [{ id: ID_EV, date: D.foyer.evenements[0].date, libelle: "Enfant 1" }], ...SRC }));
  assert.deepEqual(depots[0].items, [], "rien ne change : aucun élément déposé");
  assert.match(r.message, /Aucun changement/);
  depots.length = 0;
  await ok(T0.decrire_foyer.handler({ evenements: [{ id: ID_EV, supprimer: true }], ...SRC }));
  assert.equal(depots[0].items[0].operation, "supprimer"); assert.equal(depots[0].items[0].ref, ID_EV);
  assert.match(await echec(T0.decrire_foyer.handler({ evenements: [{ id: "6f1c2a9e-0000-4000-8000-0000000000ff", date: "2025-04-20" }], ...SRC })), /introuvable/);
  assert.match(await echec(T0.decrire_foyer.handler({ evenements: [{ id: "pas-un-uuid" }], ...SRC })), /id invalide/);
  assert.match(await echec(T0.decrire_foyer.handler({ evenements: [{ supprimer: true }], ...SRC })), /supprimer demande l'id/);
});
test("decrire_foyer : limites (10 par appel, 100 événements, 10 variantes) et appel vide", { skip: SANS_STRIP }, async () => {
  const onze = Array.from({ length: 11 }, (_, i) => naissance({ libelle: "Enfant " + (i + 3) }));
  assert.match(await echec(T0.decrire_foyer.handler({ evenements: onze, ...SRC })), /10 événements au plus par appel/);
  const cent = Array.from({ length: 100 }, (_, i) => ({ ...D.foyer.evenements[0], id: "e0000000-0000-4000-8000-" + String(1000 + i).padStart(12, "0") }));
  assert.match(await echec(outils(faux({ foyer_evenements: cent })).decrire_foyer.handler({ evenements: [naissance()], ...SRC })), /100 événements au plus/);
  const dix = Array.from({ length: 10 }, (_, i) => ({ id: "a1b2c3d4-0000-4000-8000-" + String(i).padStart(12, "0"), nom: "V" + i, description: "", retire: [], hypotheses: {} }));
  assert.match(await echec(outils(faux({ foyer_variantes: dix })).decrire_foyer.handler({ variantes: [{ nom: "Onzième" }], ...SRC })), /10 variantes au plus/);
  assert.match(await echec(T0.decrire_foyer.handler({ ...SRC })), /Rien à proposer/);
});
test("decrire_foyer : variantes (création, modification, suppression, événements retirés, hypothèses)", { skip: SANS_STRIP }, async () => {
  depots.length = 0;
  await ok(T0.decrire_foyer.handler({ variantes: [{ nom: "Achat en 2028", description: "Sans le locatif", retire: [D.foyer.evenements[2].id], hypotheses: { epargne_delta_mensuel: 200 } }], ...SRC }));
  assert.deepEqual(depots[0].items[0], { cible: "variante", operation: "creer", apres: { nom: "Achat en 2028", description: "Sans le locatif", retire: [D.foyer.evenements[2].id], hypotheses: { epargne_delta_mensuel: 200 } } });
  depots.length = 0;
  await ok(T0.decrire_foyer.handler({ variantes: [{ id: ID_VAR, nom: "Deuxième enfant" }], ...SRC }));
  assert.deepEqual(depots[0].items[0], { cible: "variante", operation: "modifier", ref: ID_VAR, avant: { nom: "2ᵉ enfant" }, apres: { nom: "Deuxième enfant" } });
  depots.length = 0;
  await ok(T0.decrire_foyer.handler({ variantes: [{ id: ID_VAR, supprimer: true }], ...SRC }));
  assert.equal(depots[0].items[0].operation, "supprimer");
  assert.match(await echec(T0.decrire_foyer.handler({ variantes: [{ nom: "" }], ...SRC })), /Le nom de la variante doit faire de 1 à 40 caractères/);
  assert.match(await echec(T0.decrire_foyer.handler({ variantes: [{ nom: "V", hypotheses: { magie: 1 } }], ...SRC })), /Hypothèse inconnue : « magie »/);
  assert.match(await echec(T0.decrire_foyer.handler({ variantes: [{ nom: "V", retire: ["6f1c2a9e-0000-4000-8000-0000000000ff"] }], ...SRC })), /introuvable/);
  assert.match(await echec(T0.decrire_foyer.handler({ evenements: [naissance({ variante_id: "6f1c2a9e-0000-4000-8000-0000000000ff" })], ...SRC })), /variante .* introuvable/);
  depots.length = 0;
  await ok(T0.decrire_foyer.handler({ evenements: [naissance({ variante_id: ID_VAR, libelle: "Enfant 3" })], ...SRC }));
  assert.equal(depots[0].items[0].apres.variante_id, ID_VAR);
});
test("decrire_foyer : réglages de projection → proposition config { projection } réduite à ce qui change ; valeurs refusées avec les messages de la base", { skip: SANS_STRIP }, async () => {
  depots.length = 0;
  await ok(T0.decrire_foyer.handler({ reglages: { tmi_pct: 41, reequilibrage: "annuel", reste_capacite: "disponible" }, ...SRC }));
  assert.deepEqual(depots[0].items[0], { cible: "config", operation: "modifier", avant: { projection: { tmi_pct: 30, reequilibrage: null } }, apres: { projection: { tmi_pct: 41, reequilibrage: "annuel" } } });
  depots.length = 0;
  await ok(T0.decrire_foyer.handler({ reglages: { tmi_pct: 30 }, ...SRC }));
  assert.deepEqual(depots[0].items, []);
  const M = AppEv.fusionnerReglagesProjection;
  for (const [reglages, attendu] of [[{ tmi_pct: 33 }, M({}, { tmi_pct: 33 }).erreur], [{ base_capacite: "x" }, M({}, { base_capacite: "x" }).erreur], [{ magie: 1 }, M({}, { magie: 1 }).erreur], [{}, M({}, {}).erreur]]) {
    const e = await echec(T0.decrire_foyer.handler({ reglages, ...SRC }));
    assert.ok(e.includes(attendu), JSON.stringify(reglages) + " : " + e);
  }
  depots.length = 0;
  await ok(T0.decrire_foyer.handler({ reglages: { capacite_mensuelle: 800, source: "Ce que tu as dit à Claude" }, ...SRC }));
  assert.equal(depots[0].items[0].apres.projection.capacite_mensuelle, 800);
  assert.ok(depots[0].items[0].apres.projection.le, "la date de la source est posée");
});

test("decrire_foyer : prix d'achat d'un bien (reglages.biens) → proposition config { projection: { biens } } ; bien inconnu refusé", { skip: SANS_STRIP }, async () => {
  depots.length = 0;
  const bien = { prix_achat: 205000, date_achat: "2016-03-01", source: "Acte d'achat (exemple)" };
  await ok(T0.decrire_foyer.handler({ reglages: { biens: { "bien:bien-rp": bien } }, ...SRC }));
  assert.deepEqual(depots[0].items[0].apres.projection.biens["bien:bien-rp"], { ...bien, le: TODAY });
  assert.match(await echec(T0.decrire_foyer.handler({ reglages: { biens: { "bien:inconnu": bien } }, ...SRC })), /introuvable/);
});

/* ---------------------------------------------------------------- projeter */
test("projeter : résumé du moteur de l'app (phrase, bande, couches, capacité, garde-fous, événements, objectifs, hypothèses sourcées), jamais les chemins", { skip: SANS_STRIP }, async () => {
  const r = await ok(T0.projeter.handler({}));
  const a = App.simuler(App.preparer(entreeApp(), { horizon_ans: 10, perimetre: "foyer", vue: "net", euros: "constants" }), {});
  assert.equal(r.version_modele, App.versionModele);
  assert.equal(r.graine, App.GRAINE); assert.equal(r.chemins, 2000);
  assert.equal(r.phrase, a.phrase);
  assert.equal(r.serie_annuelle.length, 11);
  assert.deepEqual(J(r.serie_annuelle.map(x => x.p50)), Array.from({ length: 11 }, (_, i) => Math.round(a.vues.net.p50[12 * i])));
  assert.deepEqual(J(r.serie_annuelle[10]), { annee: 10, date: a.mois[120], p10: Math.round(a.vues.net.p10[120]), p25: Math.round(a.vues.net.p25[120]), p50: Math.round(a.vues.net.p50[120]), p75: Math.round(a.vues.net.p75[120]), p90: Math.round(a.vues.net.p90[120]) });
  assert.equal(r.couches_a_l_horizon.existant.p50, Math.round(a.existant.p50[120]));
  assert.equal(r.couches_a_l_horizon.epargne_future.p50, Math.round(a.epargne_future.p50[120]));
  assert.deepEqual(J(r.capacite_base), J(a.capacite_base));
  assert.deepEqual(J(r.capacite_par_periode), J(a.capacite_par_periode));
  assert.deepEqual(J(r.decomposition), J(a.decomposition));
  assert.deepEqual(J(r.garde_fous), J(a.garde_fous));
  assert.deepEqual(J(r.evenements_pris_en_compte), a.evenements_pris_en_compte);
  assert.ok(r.evenements_pris_en_compte.length >= 1);
  assert.equal(r.question_evenements, null);
  assert.deepEqual(J(r.objectifs.map(o => o.id)), a.objectifs.map(o => o.id));
  assert.ok(r.hypotheses.length > 10 && r.hypotheses.every(h => h.cle && h.statut && "verifie_le" in h));
  assert.ok(r.jalons.length > 0 && r.jalons.every(j => j.date && j.titre));
  assert.equal(r.conduite.length, 8);
  /* jamais les chemins ni les séries mensuelles */
  for (const k of ["vues", "chemins_retenus", "deterministe_detail", "mois", "existant", "epargne_future", "retraits"]) assert.ok(!(k in r), k + " ne doit pas être renvoyé");
  assert.ok(taille(r) < 60000, "résumé borné : " + taille(r) + " octets");
});
/** Photos nocturnes (lignes SQL snapshots, deux par mois) et versements (lignes transactions) sur `mois` mois. */
function historiqueSql(mois) {
  const snaps = [], tx = [], rend = [0.012, -0.008, 0.02, 0.005, -0.015, 0.01, 0.007, 0.018, -0.004, 0.011, 0.003, 0.009];
  let monde = 40000, obl = 10000;
  for (let k = 0; k <= mois; k++) {
    const fin = require("../web/src/projection-outils.js").ajouterMois("2023-09-30", k);
    for (const date of [fin.slice(0, 8) + "15", fin]) snaps.push({ date, total: monde + obl, by_bloc: { p1: { Monde: Math.round(monde * 0.6), Obligations: Math.round(obl) }, p2: { Monde: Math.round(monde) - Math.round(monde * 0.6) } } }); // forme de production (take_snapshots) : par personne
    if (k > 0) tx.push({ date: fin, type: "versement", amount: 300 });
    monde = monde * (1 + rend[k % 12]) + 300; obl = obl * 1.003;
  }
  return { snaps, tx };
}
test("projeter : le rendement des placements (attendu net de frais, médiane simulée et bande P10 à P90, année par année, nominal et réel) est celui du moteur de l'app, arrondi", { skip: SANS_STRIP }, async () => {
  const r = await ok(T0.projeter.handler({}));
  const a = App.simuler(App.preparer(entreeApp(), { horizon_ans: 10, perimetre: "foyer", vue: "net", euros: "constants" }), {}).rendement, d2 = x => Math.round(x * 100) / 100;
  assert.equal(r.rendement.disponible, a.disponible); assert.equal(r.rendement.methode, "twr_net_de_frais"); assert.equal(r.rendement.avant_impots, true);
  assert.match(r.rendement.perimetre, /comptes courants exclus/);
  assert.deepEqual(J(r.rendement.attendu), { nominal_pct: d2(a.attendu.nominal_pct), reel_pct: d2(a.attendu.reel_pct), frais_moyens_pct: d2(a.attendu.frais_pct) });
  assert.deepEqual(J(r.rendement.horizon), { annees: 10, nominal: { p10: d2(a.horizon.nominal.p10), p50: d2(a.horizon.nominal.p50), p90: d2(a.horizon.nominal.p90) }, reel: { p10: d2(a.horizon.reel.p10), p50: d2(a.horizon.reel.p50), p90: d2(a.horizon.reel.p90) } });
  assert.equal(r.rendement.par_annee.length, 10); assert.equal(r.rendement.par_annee[0].annee, 1);
  assert.equal(r.rendement.par_annee[0].nominal.p50, d2(a.par_annee.nominal.p50[0])); assert.equal(r.rendement.par_annee[9].reel.p90, d2(a.par_annee.reel.p90[9]));
  assert.deepEqual(J(r.rendement.annualise_a_l_anniversaire.map(x => x.annees)), [1, 3, 5, 10]);
  assert.equal(r.rendement.annualise_a_l_anniversaire[3].nominal.p50, d2(a.annualise.nominal.p50[120]), "à l'anniversaire de l'horizon, c'est le rendement annualisé de l'horizon");
  assert.ok(r.rendement.hypotheses_de_classe.actions.rendement_pct > 0 && r.rendement.hypotheses_de_classe.courant.rendement_pct === 0);
  assert.match(r.rendement.a_dire, /net de frais, avant impôts, sur les placements/);
  assert.match(JSON.stringify(r.rendement), /^(?!.*mois)/s, "jamais les séries mensuelles");
});

test("projeter : rétro-contrôle (retro) du moteur quand 24 dates de départ au moins existent dans les photos ; null avec la raison sinon ; lecture impossible sans faire échouer l'outil", { skip: SANS_STRIP }, async () => {
  const { snaps, tx } = historiqueSql(36);
  const T = outils(faux({ snapshots: snaps, transactions: tx }));
  const r = await ok(T.projeter.handler({}));
  const entree = entreeApp(); entree.historique = App.historiquePourRetro(snaps, tx);
  const a = App.simuler(App.preparer(entree, { horizon_ans: 10, perimetre: "foyer", vue: "net", euros: "constants" }), {});
  assert.equal(r.retro_raison, null);
  assert.equal(r.retro.n, 25); assert.equal(a.retro.n, 25);
  assert.equal(r.retro.p10_p90.dans, a.retro.dans_p10_p90); assert.equal(r.retro.p25_p75.dans, a.retro.dans_p25_p75);
  assert.equal(r.retro.p10_p90.taux, Math.round(a.retro.taux_p10_p90 * 100) / 100); assert.equal(r.retro.p10_p90.attendu, 0.8); assert.equal(r.retro.p25_p75.attendu, 0.5);
  assert.equal(r.retro.phrase, a.retro.phrase); assert.equal(r.retro.horizon_mois, 12);
  assert.ok(r.retro.limites.length >= 2);
  assert.equal(r.retro.premiere_date, "2023-09-30"); assert.equal(r.retro.derniere_date, "2025-09-30");
  const court = await ok(outils(faux({ snapshots: historiqueSql(10).snaps, transactions: [] })).projeter.handler({}));
  assert.equal(court.retro, null); assert.match(court.retro_raison, /^0 date de départ avec une valeur réelle 12 mois plus tard sur 24 nécessaires : pas encore assez d'historique/);
  const aucune = await ok(T0.projeter.handler({}));
  assert.equal(aucune.retro, null); assert.match(aucune.retro_raison, /Aucune photo du patrimoine/);
  const casse = await ok(outils(faux({}, { erreurs: { snapshots: { code: "XX000", message: "boom" } } })).projeter.handler({}));
  assert.equal(casse.retro, null); assert.match(casse.retro_raison, /pas pu être lu/);
  assert.ok(casse.phrase, "la projection reste donnée");
});
test("projeter : options (horizon, périmètre, vue, euros courants, net d'impôts, variante) = moteur de l'app", { skip: SANS_STRIP }, async () => {
  const a = { horizon_ans: 5, perimetre: "p1", vue: "financier", euros: "courants", net_impots: true, variante: ID_VAR };
  const r = await ok(T0.projeter.handler(a));
  const s = App.simuler(App.preparer(entreeApp(), a), {});
  assert.equal(r.phrase, s.phrase);
  assert.equal(r.horizon_ans, 5); assert.equal(r.vue, "financier"); assert.equal(r.euros, "courants"); assert.equal(r.net_impots, true);
  assert.equal(r.serie_annuelle.length, 6);
  assert.equal(r.serie_annuelle[5].p50, Math.round(s.vues.financier.p50[60]));
  assert.ok(r.evenements_pris_en_compte.some(x => /Enfant 2/.test(x)), "la variante ajoute ses événements : " + r.evenements_pris_en_compte);
});
test("projeter : variante inconnue refusée ; sans événement, la question est posée ; données à compléter dites", { skip: SANS_STRIP }, async () => {
  assert.match(await echec(T0.projeter.handler({ variante: "6f1c2a9e-0000-4000-8000-0000000000ff" })), /variante : .* introuvable/);
  const sans = outils(faux({ foyer_evenements: [], foyer_variantes: [] }));
  const r = await ok(sans.projeter.handler({}));
  assert.deepEqual(J(r.evenements_pris_en_compte), []);
  assert.match(r.question_evenements, /Aucun événement renseigné/);
});
test("projeter : repère manquant → l'incertitude est dite, aucune valeur de secours (hcsf, inflation)", { skip: SANS_STRIP }, async () => {
  const sansInflation = outils(faux({ reperes: D.savoir.reperes.filter(r => r.cle !== "inflation_hypothese").map(repereEnLigne) }));
  const r = await ok(sansInflation.projeter.handler({}));
  assert.ok(r.avertissements.some(x => /inflation_hypothese/.test(x)), JSON.stringify(r.avertissements));
});
test("projeter : crise rejouée (valeurs annuelles avec et sans la crise)", { skip: SANS_STRIP }, async () => {
  const cle = Object.keys(Gen.Marche.CRISES)[0];
  const r = await ok(T0.projeter.handler({ crise: { cle, debut: "2027-10-14" } }));
  assert.equal(r.crise.cle, cle);
  assert.equal(r.crise.annees.length, 11);
  assert.ok(r.crise.annees.every(x => x.avec_la_crise != null && x.sans_la_crise != null));
  assert.ok(r.crise.ecart_final < 0, "une crise d'actions diminue le patrimoine final : " + r.crise.ecart_final);
  assert.equal(r.crise.annees[0].avec_la_crise, r.crise.annees[0].sans_la_crise);
});
test("figer_projection → une proposition plan_fige (source obligatoire), conforme à la base, sans renvoyer le plan", { skip: SANS_STRIP }, async () => {
  depots.length = 0;
  assert.match(await echec(T0.figer_projection.handler({})), /source : obligatoire pour figer/);
  assert.equal(depots.length, 0);
  const r = await ok(T0.figer_projection.handler({ raison: "revue_mensuelle", ...SRC, justification: "Revue d'octobre" }));
  assert.equal(depots.length, 1);
  const [it] = depots[0].items;
  assert.equal(it.cible, "plan_fige"); assert.equal(it.operation, "creer");
  assert.deepEqual(Object.keys(it.apres).sort(), ["horizon_mois", "parametres", "raison", "serie"], "seules les clés acceptées par appliquer_propositions");
  assert.equal(it.apres.raison, "revue_mensuelle"); assert.equal(it.apres.horizon_mois, 120);
  assert.ok(it.apres.parametres.version_modele === App.versionModele && it.apres.parametres.graine === App.GRAINE);
  assert.ok(new TextEncoder().encode(JSON.stringify(it.apres.parametres)).length <= 100000);
  assert.ok(new TextEncoder().encode(JSON.stringify(it.apres.serie)).length <= 250000);
  assert.ok(new TextEncoder().encode(JSON.stringify(it.apres)).length <= 400000);
  assert.equal(it.apres.serie.p50.length, 121);
  assert.ok(r.propositions.length === 1 && !("apres" in r.propositions[0]), "le plan n'est pas renvoyé dans la réponse");
  assert.ok(taille(r) < 60000);
  const sans = await ok(T0.projeter.handler({}));
  assert.ok(!("plan_fige" in sans)); assert.equal(depots.length, 1, "projeter ne dépose jamais rien");
  assert.equal(depots[0].d.source, SRC.source);
});
test("figer_projection avec un foyer très chargé (1 200 lignes, 100 événements à paramètres énormes) : le plan déposé tient sous les limites de la base (octets de jsonb::text)", { skip: SANS_STRIP }, async () => {
  const modele = D.positions[0];
  const positions = Array.from({ length: 1200 }, (_, i) => positionEnLigne({ ...modele, id: "p-" + i, name: "Fonds numéro " + i + " (libellé long pour grossir)", envelope: "PEA Camille", bloc: "Monde" }));
  const evenements = Array.from({ length: 100 }, (_, i) => ({ id: "e0000000-0000-4000-8000-" + String(i).padStart(12, "0"), variante_id: null, type: "retrait", personne: "foyer", libelle: "Retrait " + i, date: "2028-06-01", fin: null,
    params: { montant: 10 + i, libelle: "Retrait " + i, inconnu: "x".repeat(15000) }, source: "s" }));
  depots.length = 0;
  await ok(outils(faux({ positions, foyer_evenements: evenements })).figer_projection.handler({ horizon_ans: 25, ...SRC }));
  const [it] = depots[0].items, O2 = Gen.Projection.octetsJsonb;
  assert.ok(O2(it.apres.parametres) <= 100000, "paramètres " + O2(it.apres.parametres));
  assert.ok(O2(it.apres.serie) <= 250000, "série " + O2(it.apres.serie));
  assert.ok(O2(it.apres) <= 400000, "total " + O2(it.apres));
  assert.ok(it.apres.parametres.reductions.length > 0, "réductions dites");
  assert.doesNotMatch(srcProjection, /réduis l'horizon/, "plus de message trompeur");
});
test("figer_projection → limite de 60 plans figés", { skip: SANS_STRIP }, async () => {
  const soixante = Array.from({ length: 60 }, (_, i) => ({ id: "p" + i }));
  assert.match(await echec(outils(faux({ plans_figes: soixante })).figer_projection.handler({ ...SRC })), /60 plans figés au plus/);
});

test("projeter : lecture seule, sans option d'écriture ; dates de la crise contrôlées (date réelle, pas dans le passé, dans l'horizon)", { skip: SANS_STRIP }, async () => {
  const sec = srcProjection.slice(srcProjection.indexOf('server.registerTool("projeter"'), srcProjection.indexOf('server.registerTool("figer_projection"'));
  assert.doesNotMatch(sec, /figer:|\.\.\.DEPOT|deposer\(|source: optionnel/, "projeter n'écrit rien");
  assert.match(sec, /annotations: RO/);
  const cle = Object.keys(Gen.Marche.CRISES)[0];
  assert.match(srcProjection, /DateReelle = \(champ: string, plancher\?: string\)/);
  assert.match(srcProjection, /dateReelle\(x\)/);
  assert.equal(PM.dateReelle("2027-02-30"), false); assert.equal(PM.dateReelle("2028-02-29"), true); assert.equal(PM.dateReelle("2027-13-01"), false); assert.equal(PM.dateReelle(20270101), false);
  for (const debut of ["2032-01-01", "2026-09-01"]) {
    const e = await echec(T0.projeter.handler({ horizon_ans: 5, crise: { cle, debut } }));
    assert.match(e, /^crise\.debut : date de début de la crise absente ou hors de l'horizon : choisis une date entre le 14\/10\/2026 et le 14\/10\/2031\./, debut);
  }
  assert.ok((await ok(T0.projeter.handler({ horizon_ans: 5, crise: { cle, debut: "2028-03-01" } }))).crise.annees.length === 6);
});
test("capacite_emprunt : date hors horizon ou sans dans_le_temps refusée", { skip: SANS_STRIP }, async () => {
  assert.match(await echec(T0.capacite_emprunt.handler({ dans_le_temps: true, horizon_ans: 5, date: "2040-01-01" })), /^date : date de l'achat envisagé absente ou hors de l'horizon/);
  assert.match(await echec(T0.capacite_emprunt.handler({ date: "2028-01-01" })), /dans_le_temps: true/);
  assert.ok((await ok(T0.capacite_emprunt.handler({ dans_le_temps: true, horizon_ans: 5, date: "2028-06-01" }))).dans_le_temps.point);
});
test("tableAbsente : une colonne manquante (42703) n'est jamais prise pour une table absente", { skip: SANS_STRIP }, async () => {
  const colonne = { code: "42703", message: 'column "mode" does not exist' };
  await assert.rejects(PM.lireDonneesProjection(faux({}, { erreurs: { foyer_evenements: colonne } }), must, TODAY), /mode/);
  const absent = { code: "42P01", message: 'relation "x" does not exist' };
  assert.deepEqual(J((await PM.lireDonneesProjection(faux({}, { erreurs: { foyer_evenements: absent } }), must, TODAY)).foyer.evenements), []);
  assert.deepEqual(J((await PM.lireDonneesProjection(faux({}, { erreurs: { foyer_variantes: { code: "PGRST205", message: "Could not find the table in the schema cache" } } }), must, TODAY)).foyer.variantes), []);
});

/* ---------------------------------------------------------------- comparer_variantes */
test("comparer_variantes : écart par année, probabilité de faire mieux et phrase = comparaison du moteur de l'app", { skip: SANS_STRIP }, async () => {
  const r = await ok(T0.comparer_variantes.handler({ variante: ID_VAR }));
  const opt = { horizon_ans: 10, perimetre: "foyer", vue: "net", euros: "constants", net_impots: false };
  const c = App.comparer(App.preparer(entreeApp(), opt), App.preparer(entreeApp(), { ...opt, variante: ID_VAR }), {});
  assert.equal(r.a, "situation actuelle"); assert.equal(r.b, "2ᵉ enfant");
  assert.equal(r.a_l_horizon.mediane_des_ecarts, Math.round(c.horizon.mediane_des_ecarts));
  assert.equal(r.a_l_horizon.probabilite_mieux, Math.round(c.horizon.probabilite_mieux * 100) / 100);
  assert.equal(r.ecarts_par_annee.length, c.mois.length);
  assert.equal(r.ecarts_par_annee[r.ecarts_par_annee.length - 1].p50, Math.round(c.ecarts.p50[c.mois.length - 1]));
  assert.match(r.phrase, /« 2ᵉ enfant » fait (moins bien|mieux) que « situation actuelle » de .* en médiane \(de .* à .*\), et fait mieux dans (?:\d+|plus de 9|moins de 1) cas sur 10\./);
  assert.doesNotMatch(r.phrase, /-\d/, "signe moins typographique");
  assert.ok(r.evenements_b.some(x => /Enfant 2/.test(x)) && !r.evenements_a.some(x => /Enfant 2/.test(x)));
  assert.equal(r.version_modele, App.versionModele);
  assert.ok(taille(r) < 20000);
});
test("comparer_variantes : variante inconnue ou identique à la référence refusée ; deux variantes comparées entre elles", { skip: SANS_STRIP }, async () => {
  assert.match(await echec(T0.comparer_variantes.handler({ variante: "6f1c2a9e-0000-4000-8000-0000000000ff" })), /introuvable/);
  assert.match(await echec(T0.comparer_variantes.handler({ variante: ID_VAR, reference: ID_VAR })), /même variante/);
  const deux = outils(faux({ foyer_variantes: [...J(D.foyer.variantes), { id: "a1b2c3d4-0000-4000-8000-0000000000e2", nom: "Épargne en plus", description: "", retire: [], hypotheses: { epargne_delta_mensuel: 300 } }] }));
  const r = await ok(deux.comparer_variantes.handler({ variante: "a1b2c3d4-0000-4000-8000-0000000000e2", reference: ID_VAR, horizon_ans: 5 }));
  assert.equal(r.a, "2ᵉ enfant"); assert.equal(r.b, "Épargne en plus");
  assert.equal(r.ecarts_par_annee.length, 5);
});

/* ---------------------------------------------------------------- capacite_emprunt */
test("capacite_emprunt : identique à Projection.capaciteEmprunt de l'app (mensualité max, apport, budget d'achat, taux sourcé, mention)", { skip: SANS_STRIP }, async () => {
  const r = await ok(T0.capacite_emprunt.handler({ duree_ans: 20, primo: true }));
  const a = App.capaciteEmprunt(entreeApp(), { perimetre: "foyer", duree_ans: 20, primo: true });
  for (const k of ["mensualite_max", "montant_empruntable", "budget_achat", "reste_a_vivre", "taux", "apport", "sensibilite", "mention", "avertissements", "manquants", "revenus_retenus", "charges"]) assert.deepEqual(J(r[k]), J(a[k]), k);
  assert.match(r.mention, /HCSF/); assert.match(r.mention, /chaque banque décide/);
  assert.ok(r.taux.source && r.taux.date_effet, "taux sourcé et daté");
  assert.equal(r.version_modele, App.versionModele);
  assert.ok(!("dans_le_temps" in r));
  assert.equal(r.conduite.length, 3);
});
test("capacite_emprunt : périmètre, taux imposé ; dans_le_temps ajoute la capacité année par année", { skip: SANS_STRIP }, async () => {
  const r = await ok(T0.capacite_emprunt.handler({ perimetre: "p1", taux_pct: 4, dans_le_temps: true, horizon_ans: 5 }));
  const a = App.capaciteEmprunt(entreeApp(), { perimetre: "p1", taux_pct: 4 });
  assert.equal(r.perimetre, "p1"); assert.equal(r.mensualite_max, a.mensualite_max);
  const t = r.dans_le_temps;
  assert.equal(t.points.length, 6);
  assert.deepEqual(Object.keys(t.points[0].apport), ["p10", "p50", "p90"]);
  assert.match(t.phrase, /budget d'achat médian/);
  const M = App.preparer(entreeApp(), { horizon_ans: 5, perimetre: "p1", vue: "financier", euros: "constants" });
  const ref = App.capaciteDansLeTemps(M, App.simuler(M, {}), {});
  assert.equal(t.points[3].mensualite_max, Math.round(ref.mensualite_max[3]));
  assert.ok(taille(r) < 30000);
});
test("capacite_emprunt : repère HCSF manquant → indisponible avec les repères manquants, aucune durée supposée", { skip: SANS_STRIP }, async () => {
  const sans = outils(faux({ reperes: D.savoir.reperes.filter(x => x.cle !== "hcsf_duree_max").map(repereEnLigne) }));
  const r = await ok(sans.capacite_emprunt.handler({}));
  assert.equal(r.indisponible, true);
  assert.ok(r.manquants.includes("hcsf_duree_max"));
  assert.ok(r.avertissements.some(x => /hcsf_duree_max/.test(x)));
  assert.ok(!("montant_empruntable" in r), "aucun chiffre sans la durée");
});

/* ---------------------------------------------------------------- demarrer_session, list_objectifs */
test("projectionDeSession : événements à venir, question s'il n'y en a aucun, variantes, plans figés ; null sans lever en cas d'échec", { skip: SANS_STRIP }, async () => {
  const r = await PM.projectionDeSession(faux({ plans_figes: [{ id: "pf1", cree_le: "2026-10-01T10:00:00Z", raison: "manuel" }] }), must, TODAY);
  assert.equal(r.evenements.nombre, 3);
  assert.deepEqual(J(r.evenements.a_venir.map(e => e.libelle)), ["Nouvel emploi de Sam", "Achat locatif"], "à venir seulement, sans les événements de variante");
  assert.equal(r.evenements.question, null);
  assert.equal(r.variantes, 1);
  assert.deepEqual(J(r.plans_figes), { nombre: 1, dernier: { id: "pf1", cree_le: "2026-10-01T10:00:00Z", raison: "manuel" } });
  assert.equal(r.version_modele, App.versionModele);
  const vide = await PM.projectionDeSession(faux({ foyer_evenements: [], foyer_variantes: [] }), must, TODAY);
  assert.match(vide.evenements.question, /changements prévus/);
  const avertis = []; const w = console.warn; console.warn = (...a) => avertis.push(a.join(" "));
  try {
    assert.equal(await PM.projectionDeSession(faux({}, { erreurs: { foyer_evenements: { code: "42P01", message: "does not exist" } } }), must, TODAY), null);
  } finally { console.warn = w; }
  assert.equal(avertis.length, 1);
});
test("probabilitesObjectifs : probabilité et mot par objectif daté (moteur de l'app) ; null sans lever en cas d'échec", { skip: SANS_STRIP }, async () => {
  const m = await PM.probabilitesObjectifs(faux(), must, TODAY, async () => banqueDemo());
  assert.ok(m instanceof Map && m.size >= 1);
  const dates = D.objectifs.filter(o => o.dateCible > TODAY);
  const mois = Math.max(...dates.map(o => (+o.dateCible.slice(0, 4) - 2026) * 12 + (+o.dateCible.slice(5, 7) - 10)));
  const horizon = [5, 10, 15, 20, 25].find(h => h * 12 >= mois);
  const s = App.simuler(App.preparer(entreeApp(), { horizon_ans: horizon, perimetre: "foyer", vue: "financier", euros: "constants" }), {});
  for (const o of s.objectifs) assert.equal(m.get(o.id).probabilite, o.probabilite == null ? null : Math.round(o.probabilite * 100) / 100, o.id);
  const w = console.warn; console.warn = () => {};
  try { assert.equal(await PM.probabilitesObjectifs(faux({}, { erreurs: { positions: { code: "XX000", message: "boum" } } }), must, TODAY), null); }
  finally { console.warn = w; }
});

/* ---------------------------------------------------------------- index.ts, conduite, tutoiement */
const srcIndex = lire("supabase/functions/mcp/index.ts");
const bloc = (src, debut, fin) => src.slice(src.indexOf(debut), src.indexOf(fin, src.indexOf(debut)));
test("index.ts : projection.ts enregistré avec les utilitaires du serveur, demarrer_session.projection et list_objectifs.probabilite", () => {
  assert.match(srcIndex, /import \{ registerProjection, projectionDeSession, probabilitesObjectifs, lireDonneesProjection \} from "\.\/projection\.ts";/);
  assert.match(srcIndex, /registerProjection\(server, \{ db, wrap, must, UserError, RO, RW, DEPOT, deposer, today, banque: lireBanqueCalcul \}\);/);
  assert.match(srcIndex, /const projectionLue = projectionDeSession\(db, must, today\(\)\);/);
  assert.match(srcIndex, /projection = await projectionLue/);
  assert.match(bloc(srcIndex, "doublons_probables,\n      calendrier,", "};"), /projection,/);
  assert.match(srcIndex, /Lister les objectifs[\s\S]*?probabilite et probabilite_mot/);
  assert.match(srcIndex, /probabilitesObjectifs\(db, must, ref, lireBanqueCalcul\)/);
  assert.match(srcIndex, /probabilite: probas\?\.get\(o\.id\)\?\.probabilite \?\? null/);
  assert.doesNotMatch(srcProjection, /from "\.\/index\.ts"/, "pas d'import circulaire vers index.ts");
});
test("index.ts : la banque du calcul est lue sur 13 mois depuis le jour de Paris (12 mois complets pour la capacité observée)", () => {
  const b = bloc(srcIndex, "async function lireBanqueCalcul()", "async function lireConfigCalcul");
  assert.match(b, /today\(\)\.split\("-"\)\.map\(Number\)/);
  assert.match(b, /\(ma - 1\) - 12/);
  assert.doesNotMatch(b, /new Date\(\)|getUTCMonth/, "ni l'horloge UTC ni le fuseau local");
});
test("conduite : les 8 règles du § 7.3 sont dans les INSTRUCTIONS, la conduite du Copilote renvoie vers projeter et la question des événements", { skip: SANS_STRIP }, () => {
  const instr = bloc(srcIndex, "const INSTRUCTIONS = [", "/* Parcours d'entretien");
  assert.equal(PM.CONDUITE_PROJECTION.length, 8);
  for (const regle of PM.CONDUITE_PROJECTION) assert.ok(instr.includes(regle), "règle absente des INSTRUCTIONS : " + regle.slice(0, 60));
  for (const k of ["decrire_foyer", "lire_foyer", "projeter", "comparer_variantes", "capacite_emprunt", "demarrer_session.projection", "Ne calcule jamais toi-même une projection"]) assert.ok(instr.includes(k), k);
  const copilote = bloc(srcIndex, "const CONDUITE_COPILOTE = [", "const PROMPT_ONBOARDING");
  assert.match(copilote, /"20\. Projection/);
  assert.match(copilote, /Tu as des changements prévus \? Un enfant, un changement d'emploi, un déménagement, un achat \?/);
  assert.match(copilote, /ecart_capacite/);
  const r7 = PM.CONDUITE_PROJECTION[6], r8 = PM.CONDUITE_PROJECTION[7];
  assert.match(r7, /^7\. Avant de montrer une projection, regarde les événements enregistrés/);
  assert.match(r8, /^8\. Quand la capacité d'épargne prévue et la constatée diffèrent \(garde-fou ecart_capacite\), demande pourquoi/);
});
test("tutoiement, aucun « conseiller », aucun produit ni établissement nommé (projection.ts, conduites, descriptions des outils)", { skip: SANS_STRIP }, () => {
  const sans = srcProjection.replace(/^\s*\/\/.*$/gm, "");
  assert.equal((sans.match(/(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu) || [])[0], undefined);
  assert.equal((sans.match(/conseill?er|conseillère/i) || [])[0], undefined);
  assert.equal((sans.match(/boursorama|linxea|spirica|fortuneo|credit agricole|crédit agricole|bnp|axa|generali|amundi|ishares|vanguard|lyxor|etoro|trade republic/i) || [])[0], undefined);
  for (const t of PM.CONDUITE_PROJECTION.concat(PM.CONDUITE_IMMO)) assert.doesNotMatch(t, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  for (const [nom, o] of Object.entries(T0)) {
    assert.ok(o.def.title && o.def.description.length > 80, nom);
    assert.doesNotMatch(o.def.description, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])|conseill/i, nom);
  }
});

test("probabilitesObjectifs : une échéance au-delà de 25 ans ne fixe pas l'horizon (probabilité nulle pour elle, horizon choisi sur les autres) ; lectures en parallèle dans list_objectifs", { skip: SANS_STRIP }, async () => {
  const loin = { ...objectifEnLigne(D.objectifs[0]), id: "obj-loin", nom: "Très loin", date_cible: "2070-01-01", cible: 1000000, deja: 0 };
  const proche = { ...objectifEnLigne(D.objectifs[0]), id: "obj-proche", nom: "Proche", date_cible: "2028-03-01", cible: 30000 };
  const m = await PM.probabilitesObjectifs(faux({ objectifs: [proche, loin] }), must, TODAY, async () => banqueDemo());
  assert.equal(m.get("obj-loin").probabilite, null, "hors horizon");
  const data = entreeApp(); data.objectifs = [{ ...D.objectifs[0], id: "obj-proche", dateCible: "2028-03-01", cible: 30000 }];
  const s = App.simuler(App.preparer(data, { horizon_ans: 5, perimetre: "foyer", vue: "financier", euros: "constants" }), {});
  assert.equal(m.get("obj-proche").probabilite, Math.round(s.objectifs[0].probabilite * 100) / 100, "horizon de 5 ans (et non 25) : mêmes tirages que l'app");
  assert.match(srcIndex, /Promise\.all\(\[loadPlan\(true\), probabilitesObjectifs\(db, must, ref, lireBanqueCalcul\)\]\)/);
});

test("comparer_variantes : la phrase ne dit jamais « 10 cas sur 10 » ni « 0 cas sur 10 »", { skip: SANS_STRIP }, () => {
  const comp = p => ({ version_modele: "t", graine: 1, chemins: 10, vue: "net", euros: "constants", mois: ["2036-10"],
    ecarts: { p10: [1000], p50: [5000], p90: [9000] }, probabilite_mieux: [p], chaque_chemin_superieur_ou_egal: [false],
    horizon: { mediane_des_ecarts: 5000, p10: 1000, p90: 9000, probabilite_mieux: p } });
  assert.match(PM.resumeComparaison(comp(1), "A", "B").phrase, /fait mieux dans plus de 9 cas sur 10\./);
  assert.match(PM.resumeComparaison(comp(0.97), "A", "B").phrase, /plus de 9 cas sur 10/);
  assert.match(PM.resumeComparaison(comp(0.02), "A", "B").phrase, /fait mieux dans moins de 1 cas sur 10\./);
  assert.match(PM.resumeComparaison(comp(0.7), "A", "B").phrase, /fait mieux dans 7 cas sur 10\./);
});
