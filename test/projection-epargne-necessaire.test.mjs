// BUD1, tâche 11 : calcul inverse du moteur de projection (Projection.epargneNecessaire, spec § 10.1), dates à 8 chances sur 10 (§ 10.2) et budget prévu = cible
// validée (§ 8.5, Dn.capaciteDeBase). Chaque résultat est recoupé par des simulations indépendantes de la même variante (simuler avec les mêmes tirages) :
// le moteur inverse n'est jamais sa propre référence. Valeurs fictives (cas MC-9 : un compte-titres de 100 000 €, 1 000 €/mois, actions à 6 %).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { FIXTURE, cas, entreeDe } from "./helpers/projection-cas.mjs";
import { genererMoteur, SORTIE_MOTEUR } from "../scripts/gen-catalogue.mjs";

const req = createRequire(import.meta.url);
const P = req("../web/src/projection.js");
const Plan = req("../web/src/plan.js");
const Dn = req("../web/src/projection-donnees.js");
const Budget = req("../web/src/budget.js");
const D = req("../web/src/demo-data.js");
const J = v => JSON.parse(JSON.stringify(v));
const F = JSON.parse(readFileSync(new URL("./fixtures/budget-cas.json", import.meta.url), "utf8"));

/** Entrée du cas MC-9 sans inflation, avec des objectifs sur la poche « Monde » (le compte-titres). */
function entree(objectifs) {
  const c = cas("MC-9"), d = J(entreeDe(c));
  d.reperes = d.reperes.map(r => (r.cle === "inflation_hypothese" ? { ...r, valeur: 0 } : r));
  d.objectifs = objectifs.map((o, i) => ({ id: "o" + (i + 1), nom: "Objectif " + (i + 1), type: "autre", source: "poches", poches: ["Monde"], deja: 0, rendement: 6, priorite: i + 1, ...o }));
  const { chemins, graine, ...opts } = c.options;   // le nombre de chemins et la graine sont ceux du calcul inverse (500, graine du moteur)
  return { d, opts: { ...opts, horizon_ans: 10 } };
}
/** Probabilités de tous les objectifs pour une épargne mensuelle en plus, par une simulation indépendante (variante transitoire + simuler, mêmes tirages). */
function probas(d, opts, delta, chemins = 500) {
  const e = J(d);
  e.foyer = { ...(e.foyer || {}), variantes: [...((e.foyer && e.foyer.variantes) || []), { id: "_verif", nom: "Vérification", retire: [], hypotheses: { epargne_delta_mensuel: delta } }] };
  const r = P.simuler(P.preparer(e, { ...opts, variante: "_verif" }), { chemins, graine: 20261014 });
  return Object.fromEntries(r.objectifs.map(o => [o.id, o.probabilite]));
}
const OBJ = (cible, dateCible = "2032-06-30", extra = {}) => ({ cible, dateCible, ...extra });

test("recherche positive : le d rendu est sur la grille de 25 €, passe 8 chances sur 10 et d − 25 ne passe pas (simulations indépendantes, mêmes tirages)", () => {
  const { d, opts } = entree([OBJ(260000)]);
  const r = P.epargneNecessaire(d, opts), x = r.par_objectif[0];
  assert.equal(r.chemins, 500); assert.equal(r.graine, 20261014); assert.equal(r.version_modele, P.versionModele);
  assert.ok(x.probabilite_a_0 < 0.8, "à 0 : " + x.probabilite_a_0);
  assert.equal(x.atteignable, true); assert.ok(x.d > 0 && x.d % 25 === 0, "d = " + x.d);
  assert.ok(x.precision <= 25, "précision " + x.precision);
  assert.ok(probas(d, opts, x.d).o1 >= 0.8, "à d : 8 chances sur 10");
  assert.ok(probas(d, opts, x.d - 25).o1 < 0.8, "à d − 25 : en dessous");
  assert.equal(x.probabilite_a_d, probas(d, opts, x.d).o1);
  assert.equal(x.probabilite_a_0, probas(d, opts, 0).o1, "probabilité à 0 = celle de la simulation sans variante");
  assert.equal(x.monotone, true); assert.equal(r.monotone, true);
  assert.deepEqual(r.ensemble, { d: x.d, atteignable: true });
  assert.ok(r.simulations <= 16 && r.simulations >= 3, "simulations : " + r.simulations);
  assert.equal(r.capacite_retenue, 1000);
});

test("objectif déjà à 8 chances sur 10 : d négatif (ce qu'il pourrait épargner de moins), jamais au-delà de la capacité retenue", () => {
  const { d, opts } = entree([OBJ(160000)]);
  const r = P.epargneNecessaire(d, opts), x = r.par_objectif[0];
  assert.ok(x.probabilite_a_0 >= 0.8);
  assert.ok(x.d < 0 && x.d % 25 === 0 && x.d >= -1000, "d = " + x.d);
  assert.ok(probas(d, opts, x.d).o1 >= 0.8, "toujours 8 chances sur 10 en épargnant " + -x.d + " € de moins");
  assert.ok(probas(d, opts, x.d - 25).o1 < 0.8 || x.d === -1000, "un cran de moins ne passe plus (ou on est à la capacité retenue)");
  // un objectif facile : on pourrait ne plus rien épargner (d = −capacité)
  const facile = P.epargneNecessaire(...Object.values(entree([OBJ(100500)])));
  assert.equal(facile.par_objectif[0].d, -1000); assert.equal(facile.par_objectif[0].precision, 0);
});

test("objectif inatteignable : 10 000 €/mois ne suffisent pas → atteignable faux, d nul, ensemble non atteignable", () => {
  const { d, opts } = entree([OBJ(50000000)]);
  const r = P.epargneNecessaire(d, opts), x = r.par_objectif[0];
  assert.deepEqual([x.atteignable, x.d, x.precision], [false, null, null]);
  assert.ok(x.probabilite_a_d < 0.8);
  assert.deepEqual(r.ensemble, { d: null, atteignable: false });
  assert.ok(r.simulations <= 16);
});

test("exclus : objectif déjà atteint, date passée, hors horizon ; d* = le plus grand des d de plusieurs objectifs, sur des simulations partagées", () => {
  const { d, opts } = entree([OBJ(260000), OBJ(200000, "2031-06-30", { priorite: 2 }), OBJ(50000, "2030-01-01", { deja: 80000, source: "saisi", poches: [] }), OBJ(150000, "2026-01-01"), OBJ(300000, "2040-06-30")]);
  const r = P.epargneNecessaire(d, opts);
  assert.deepEqual(r.par_objectif.map(x => x.id).sort(), ["o1", "o2"]);
  const raisons = Object.fromEntries(r.exclus.map(x => [x.id, x.raison]));
  assert.equal(raisons.o3, "atteint"); assert.equal(raisons.o4, "hors_portee"); assert.equal(raisons.o5, "hors_horizon");
  const ds = r.par_objectif.map(x => x.d);
  assert.equal(r.ensemble.d, Math.max(...ds)); assert.equal(r.ensemble.atteignable, true);
  // à d*, les deux objectifs passent (ils croissent avec d sur les mêmes tirages)
  const p = probas(d, opts, r.ensemble.d);
  assert.ok(p.o1 >= 0.8 && p.o2 >= 0.8, JSON.stringify(p));
  // simulations partagées : bien moins que la somme de deux recherches séparées
  const seul1 = P.epargneNecessaire(...Object.values(entree([OBJ(260000)])));
  const seul2 = P.epargneNecessaire(...Object.values(entree([OBJ(200000, "2031-06-30")])));
  assert.ok(r.simulations < seul1.simulations + seul2.simulations, `${r.simulations} < ${seul1.simulations} + ${seul2.simulations}`);
  assert.ok(r.simulations <= 16);
});

test("monotonie vérifiée sur la grille parcourue : probabilités non décroissantes avec l'épargne en plus, mêmes tirages", () => {
  const { d, opts } = entree([OBJ(260000)]);
  let prec = -1;
  for (const delta of [-500, -100, 0, 100, 250, 500, 1000, 2000]) {
    const p = probas(d, opts, delta).o1;
    assert.ok(p >= prec - 1e-12, `d = ${delta} : ${p} < ${prec}`);
    prec = p;
  }
});

test("déterministe, entrée intacte, variante de base respectée (le d s'ajoute à son epargne_delta_mensuel)", () => {
  const { d, opts } = entree([OBJ(260000)]);
  const avant = J(d), a = P.epargneNecessaire(d, opts), b = P.epargneNecessaire(d, opts);
  assert.deepEqual(J(a), J(b)); assert.deepEqual(J(d), avant);
  // variante de base +200 €/mois : le d nécessaire baisse d'autant (à 25 € près)
  const e = J(d); e.foyer = { evenements: [], variantes: [{ id: "base", nom: "Plus 200", retire: [], hypotheses: { epargne_delta_mensuel: 200 } }] };
  const v = P.epargneNecessaire(e, { ...opts, variante: "base" });
  assert.ok(Math.abs((v.par_objectif[0].d + 200) - a.par_objectif[0].d) <= 25, `${v.par_objectif[0].d} + 200 ≈ ${a.par_objectif[0].d}`);
  assert.equal(e.foyer.variantes.length, 1, "la variante transitoire n'est jamais ajoutée à l'entrée");
  // relecture (tâche 12) : un événement propre à la variante de base (variante_id) compte dans le calcul inverse, comme s'il était dans la situation actuelle
  const retrait = { id: "e0000000-0000-4000-8000-000000000001", type: "retrait", personne: "foyer", libelle: "Retrait exemple", date: "2028-06-01", fin: null, params: { montant: 40000, libelle: "Retrait exemple" }, source: "cas de test" };
  const avec = J(d); avec.foyer = { evenements: [{ ...retrait, variante_id: "vr" }], variantes: [{ id: "vr", nom: "Avec un retrait", retire: [], hypotheses: {} }] };
  const sans = J(d); sans.foyer = { evenements: [{ ...retrait, variante_id: null }], variantes: [] };
  const rv = P.epargneNecessaire(avec, { ...opts, variante: "vr" }), rs = P.epargneNecessaire(sans, opts);
  assert.ok(rs.par_objectif[0].d > a.par_objectif[0].d, "le retrait demande plus d'épargne");
  assert.deepEqual(J(rv.par_objectif), J(rs.par_objectif), "variante avec son événement = situation actuelle avec le même événement");
  assert.equal(avec.foyer.evenements[0].variante_id, "vr", "entrée intacte");
  // chemins et graine demandés
  const r = P.epargneNecessaire(d, { ...opts, chemins: 200, graine: 7 });
  assert.deepEqual([r.chemins, r.graine], [200, 7]);
  // sans objectif : rien à calculer
  const vide = P.epargneNecessaire(entree([]).d, opts);
  assert.deepEqual([vide.par_objectif, vide.ensemble.atteignable, vide.ensemble.d, vide.simulations], [[], null, null, 1]);
});

test("durée : sous 8 secondes sur la démo (500 chemins, 16 simulations au plus)", () => {
  const data = P.depuisEtat(J({ positions: D.positions, config: D.config, profil: D.profil, budget: D.budget, banque: D.banque, objectifs: D.objectifs, foyer: D.foyer, savoir: D.savoir, indices: D.indices, classes: D.classes }), "2026-10-14");
  // temps de calcul du processus (et non de l'horloge) : la suite entière tourne en parallèle et l'horloge murale dépend de la charge de la machine
  const c0 = process.cpuUsage(), r = P.epargneNecessaire(data, { horizon_ans: 10 }), c1 = process.cpuUsage(c0), ms = (c1.user + c1.system) / 1000;
  assert.ok(ms < 8000, ms + " ms de calcul");
  assert.ok(r.simulations <= 16);
  assert.ok(r.par_objectif.length >= 1 && r.exclus.length >= 1);
  assert.ok(r.par_objectif.every(x => x.id && typeof x.atteignable === "boolean"));
});

/* ---------------------------------------------------------------- dates à 8 chances sur 10 (§ 10.2) */
test("date à 8 chances sur 10 : mode déterministe — le mois de Plan.dateAtteinte ; Monte-Carlo — pas avant la déterministe ; absente sans l'option", () => {
  const { d, opts } = entree([OBJ(160000)]);
  const M = P.preparer(d, opts);
  const det = P.simuler(M, { volatilite: 0, dates_atteinte: true }).objectifs[0];
  const plan = Plan.dateAtteinte(160000, 100000, 1000, 6, d.today);
  assert.equal(det.date_8_sur_10.slice(0, 7), plan.slice(0, 7), "même mois que Plan.dateAtteinte : " + det.date_8_sur_10 + " et " + plan);
  const mc = P.simuler(M, { chemins: 500, dates_atteinte: true }).objectifs[0];
  assert.ok(mc.date_8_sur_10 >= det.date_8_sur_10.slice(0, 7), mc.date_8_sur_10 + " ≥ " + det.date_8_sur_10);
  assert.ok(mc.date_8_sur_10 < "2032-07", "avant l'échéance : l'objectif est « avancé »");
  assert.ok(!("date_8_sur_10" in P.simuler(M, { chemins: 500 }).objectifs[0]), "pas d'option, pas de champ");
  // le compteur ne change pas la probabilité à l'échéance
  assert.equal(mc.probabilite, P.simuler(M, { chemins: 500 }).objectifs[0].probabilite);
  assert.equal(JSON.stringify(P.simuler(M, { chemins: 500, dates_atteinte: true }).vues), JSON.stringify(P.simuler(M, { chemins: 500 }).vues), "les vues sont identiques");
  // jamais atteint avant l'horizon : null ; déjà atteint : null
  const loin = P.simuler(P.preparer(entree([OBJ(900000, "2036-06-30")]).d, opts), { chemins: 500, dates_atteinte: true }).objectifs[0];
  assert.equal(loin.date_8_sur_10, null);
  const atteint = P.simuler(P.preparer(entree([OBJ(50000)]).d, opts), { chemins: 500, dates_atteinte: true }).objectifs[0];
  assert.equal(atteint.statut, "atteint"); assert.equal(atteint.date_8_sur_10, null);
  // avec plus d'épargne, la date arrive plus tôt
  const e = J(d); e.foyer = { evenements: [], variantes: [{ id: "plus", nom: "Plus", retire: [], hypotheses: { epargne_delta_mensuel: 500 } }] };
  const plus = P.simuler(P.preparer(e, { ...opts, variante: "plus" }), { chemins: 500, dates_atteinte: true }).objectifs[0];
  assert.ok(plus.date_8_sur_10 < mc.date_8_sur_10, plus.date_8_sur_10 + " < " + mc.date_8_sur_10);
});

/* ---------------------------------------------------------------- budget prévu = cible (§ 8.5) */
const cible = (valide_du, epargne, propose_le) => ({ perimetre: "foyer", valide_du, propose_le, cible: { valide_du, revenus_ref: 5000, blocs: { essentiels: 2500, envies: 5000 - 2500 - epargne, epargne } } });
test("capaciteDeBase : la capacité prévue est l'épargne de la cible du foyer en vigueur ce mois-ci, sinon celle des lignes du budget ; la constatée reste retenue par défaut", () => {
  const { d } = entree([]);
  d.budget = { lignes: [{ id: "r", type: "revenu", categorie: "Salaires", libelle: "Salaires", montant: 5000, frequence: "mois" }, { id: "d", type: "depense", categorie: "Logement", libelle: "Loyer", montant: 3800, frequence: "mois" }] };
  d.profil.credits = []; d.credits = [];
  const sans = Dn.capaciteDeBase(d, { perimetre: "foyer" });
  assert.equal(sans.prevue_source, "budget"); assert.equal(sans.prevue, Plan.capaciteEpargne(Plan.budgetTotaux(d.budget.lignes, d.profil, "foyer"))); assert.equal(sans.prevue_libelle, "ton budget");
  d.config = { ...d.config, budget_cible: { perimetres: { foyer: cible("2026-11", 1500).cible }, historique: [cible("2026-06", 900, "2026-05-20"), cible("2026-11", 1500, "2026-10-20")] } };
  d.today = "2026-10-14";
  const octobre = Dn.capaciteDeBase(d, { perimetre: "foyer", base_capacite: "prevu" });
  assert.deepEqual([octobre.prevue, octobre.prevue_source, octobre.retenue, octobre.source], [900, "cible", 900, "prevu"], "la cible de novembre ne s'applique pas encore");
  assert.equal(octobre.prevue_libelle, "ta cible de budget, validée le 20/05");
  d.today = "2026-11-02";
  const novembre = Dn.capaciteDeBase(d, { perimetre: "foyer", base_capacite: "prevu" });
  assert.deepEqual([novembre.prevue, novembre.retenue, novembre.prevue_source], [1500, 1500, "cible"]);
  // les valeurs de la fixture de Budget.cibleEnVigueur : même règle (parité des deux implémentations)
  const ce = F.score.cible_en_vigueur;
  const hist = ce.historique.map(h => ({ ...h, cible: { ...h.cible, revenus_ref: 4000 } }));
  for (const [mois, attendu] of Object.entries(ce.attendu)) {
    const app = Budget.cibleEnVigueur({ budget_cible: { historique: hist } }, "foyer", mois), moteur = Dn.cibleEnVigueur({ historique: hist }, "foyer", mois + "-15");
    assert.equal(moteur ? moteur.valide_du : null, app ? app.valide_du : null, mois);
    assert.equal(moteur ? moteur.valide_du : null, attendu, mois);
  }
  // une personne : sa cible, jamais celle du foyer ; sans cible en vigueur, le budget déclaré
  assert.equal(Dn.capaciteDeBase(d, { perimetre: "p1", base_capacite: "prevu" }).prevue_source, "budget");
  // pas de cible valable (épargne illisible) : le budget déclaré
  d.config = { ...d.config, budget_cible: { perimetres: { foyer: { valide_du: "2026-01", blocs: { epargne: "beaucoup" } } } } };
  assert.equal(Dn.capaciteDeBase(d, { perimetre: "foyer" }).prevue_source, "budget");
  d.config = { ...d.config, budget_cible: null };
  assert.equal(Dn.capaciteDeBase(d, { perimetre: "foyer" }).prevue_source, "budget");
});

test("capacité prévue par la cible : la projection le dit dans sa raison de départ et dans l'écart avec la constatée", () => {
  const { d, opts } = entree([]);
  d.budget = { lignes: [] }; d.config = { ...d.config, projection: { ...(d.config.projection || {}), base_capacite: "prevu" }, budget_cible: { historique: [cible("2026-10", 700, "2026-09-20")] } };
  d.today = "2026-10-14";
  const r = P.simuler(P.preparer(d, { ...opts, capacite_mensuelle: undefined, base_capacite: "prevu" }), { volatilite: 0 });
  assert.equal(r.capacite_base.retenue, 700);
  assert.match(r.capacite_par_periode[0].raison, /capacité prévue par ta cible de budget, validée le 20\/09/);
});

/* ---------------------------------------------------------------- copie générée et worker */
test("copie générée du moteur : à jour, mêmes résultats (épargne nécessaire, dates à 8 chances sur 10)", () => {
  const src = readFileSync(new URL("../" + SORTIE_MOTEUR, import.meta.url), "utf8");
  assert.equal(src, genererMoteur(), "projection-moteur.gen.js périmé : lancer npm run gen");
  const js = src.replace(/^export const (\w+) = /gm, "const $1 = "), noms = [...src.matchAll(/^export const (\w+) = /gm)].map(m => m[1]);
  const G = vm.runInThisContext(`(function(){ ${js}\n;return { ${noms.join(", ")} }; })()`).Projection;
  const { d, opts } = entree([OBJ(260000), OBJ(200000, "2031-06-30")]);
  assert.deepEqual(J(G.epargneNecessaire(J(d), opts)), J(P.epargneNecessaire(d, opts)));
  assert.deepEqual(J(G.simuler(G.preparer(J(d), opts), { chemins: 200, dates_atteinte: true }).objectifs), J(P.simuler(P.preparer(d, opts), { chemins: 200, dates_atteinte: true }).objectifs));
});

test("worker : le message epargne_necessaire répond une fois, avec le résultat du moteur ; les autres messages sont inchangés", () => {
  const W = req("../web/src/projection-worker.js");
  const { d, opts } = entree([OBJ(260000)]);
  const sorties = [];
  W.traiter({ type: "epargne_necessaire", data: J(d), options: opts }, m => sorties.push(m));
  assert.equal(sorties.length, 1); assert.equal(sorties[0].type, "epargne_necessaire");
  assert.deepEqual(J(sorties[0].resultat), J(P.epargneNecessaire(d, opts)));
  const classiques = [];
  W.traiter({ data: J(d), options: { ...opts, horizon_ans: 2 }, etapes: [100, 200] }, m => classiques.push(m));
  assert.deepEqual(classiques.map(m => m.etape), [0, 1]);
  const erreurs = [];
  W.traiter({ type: "epargne_necessaire", data: null, options: {} }, m => erreurs.push(m));
  assert.ok(erreurs.length === 1 && (erreurs[0].erreur || erreurs[0].type === "epargne_necessaire"));
});
