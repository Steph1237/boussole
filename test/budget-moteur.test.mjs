// BUD1 tâche 7 : le moteur du mois (Budget.donnees, mois, serie, reference). Cas chiffrés à la main : test/fixtures/budget-cas.json (double_compte D1 à D9) ;
// fusion Powens / relevés importés : cas de HIS2 (test/fixtures/his2-cas.json) lus par Calc.moisBancaires.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cas as casHis2, historiqueDeFixture } from "./helpers/his2.mjs";

const require = createRequire(import.meta.url);
const Budget = require("../web/src/budget.js");
const BC = require("../web/src/budget-categories.js");
const Calc = require("../web/src/calc.js");
const F = JSON.parse(readFileSync(new URL("./fixtures/budget-cas.json", import.meta.url), "utf8"));
const DC = Object.fromEntries(F.double_compte.map(c => [c.id, c]));
const AUJ = "2026-10-16";
const near = (a, b, msg, tol = 0.011) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} ≠ ${b}`);

/* ---------- construction d'un store à partir des cas de la fixture ---------- */
const ligne = (m, compte, sous, entrees, sorties, nombre = 1) => ({ mois: m + "-01", compte_id: compte, categorie: BC.largeDe(sous), sous_categorie: sous, entrees, sorties, nombre });
// Un compte à débit différé est, côté Powens, un courant marqué debit_differe ; la fixture le note « carte ».
const compteStore = c => ({ id: c.id, nom: c.libelle || c.id, type: c.type === "carte" ? "courant" : c.type, titulaire: c.titulaire, debit_differe: c.debit_differe === true, actif: true, ignore: false, doublonDe: null });
const storeDe = (c, extra = {}) => ({
  banque: { actif: true, comptes: c.comptes.map(compteStore), mois: (c.lignes || []).map(l => ligne(c.mois, l.compte, l.sous_categorie, l.entrees, l.sorties)) },
  config: { partage: c.partage || { mode: "egal", p1: 0.5 } },
  relevesBancaires: { lu: true, comptes: [], releves: [], banqueMois: [] }, ...extra,
});
const voir = (S, opts, auj = AUJ) => Budget.mois(Budget.donnees(S, { aujourdhui: auj }), opts);
const cmp = (M, att, msg) => {
  for (const [k, v] of Object.entries(att)) {
    if (k === "par_sous_categorie") for (const [s, x] of Object.entries(v)) near(M.par_sous_categorie[s] ? M.par_sous_categorie[s].net : 0, x, msg + " " + s);
    else if (k === "hors_budget") for (const [s, x] of Object.entries(v)) near(M.hors_budget[s], x, msg + " hors budget " + s);
    else if (typeof v === "number") near(M[k] !== undefined ? M[k] : M.blocs[k], v, msg + " " + k);
  }
};

test("D1 courant vers livret : capacité 1 000, versée 300, restée 700 ; le livret n'est pas un compte du budget", () => {
  const c = DC.D1, M = voir(storeDe(c), { vue: "tout", mois: c.mois });
  cmp(M, c.attendu.tout, "D1");
  assert.deepEqual(M.sources.map(s => [s.compte, s.origine, s.titulaire]), [["c1", "banque", "p1"]]);
  assert.equal(M.couverture.comptes_observes, 1);
  assert.equal(M.mois_complet, true);
  assert.equal(M.en_cours, false);
});

test("D2 perso vers commun, partage selon les apports : Tout, Commun, Perso p1 et p2", () => {
  const c = DC.D2, S = storeDe(c), a = c.attendu;
  cmp(voir(S, { vue: "tout", mois: c.mois }), { ...a.tout }, "D2 tout");
  const co = voir(S, { vue: "commun", mois: c.mois });
  cmp(co, a.commun, "D2 commun");
  for (const p of ["p1", "p2"]) {
    const att = a["perso_" + p], M = voir(S, { vue: "perso", personne: p, mois: c.mois });
    cmp(M, att, "D2 perso " + p);
    assert.equal(M.personne, p);
  }
});

test("D2 invariant : Perso(p1) + Perso(p2) = Tout, sous-catégorie par sous-catégorie et pour la capacité, pour plusieurs parts", () => {
  const c = DC.D2;
  for (const p1 of [0.6, 0.5, 0.37, 0.83]) {
    const S = storeDe({ ...c, partage: { mode: "fixe", p1 } });
    const T = voir(S, { vue: "tout", mois: c.mois }), A = voir(S, { vue: "perso", personne: "p1", mois: c.mois }), B = voir(S, { vue: "perso", personne: "p2", mois: c.mois });
    near(A.capacite + B.capacite, T.capacite, "capacité p1 " + p1);
    near(A.revenus + B.revenus, T.revenus, "revenus p1 " + p1);
    near(A.depenses + B.depenses, T.depenses, "dépenses p1 " + p1);
    for (const s of Object.keys(T.par_sous_categorie)) near((A.par_sous_categorie[s] ? A.par_sous_categorie[s].net : 0) + (B.par_sous_categorie[s] ? B.par_sous_categorie[s].net : 0), T.par_sous_categorie[s].net, s + " p1 " + p1);
  }
});

test("D3 commun non observé : l'apport devient commun_non_detaille (Essentiels) avec la mention commun_non_connecte, dans Tout et dans Perso", () => {
  const c = DC.D3, S = storeDe(c), a = c.attendu.tout;
  const M = voir(S, { vue: "tout", mois: c.mois });
  cmp(M, a, "D3");
  assert.ok(M.mentions.includes(a.mention), "mention");
  assert.equal(M.hors_budget.apport_commun, 0, "converti, plus hors budget");
  const P = voir(S, { vue: "perso", personne: "p1", mois: c.mois });
  near(P.par_sous_categorie.commun_non_detaille.net, 1200, "perso p1");
  near(P.capacite, 1000, "perso p1 capacité");
});

test("D3 bis commun observé un autre mois : le mois où il manque convertit l'apport, le mois où il est vu non", () => {
  const S = {
    banque: { actif: true, comptes: [compteStore({ id: "c1", type: "courant", titulaire: "p1" }), compteStore({ id: "cc", type: "courant", titulaire: "commun" })],
      mois: [ligne("2026-08", "c1", "salaires", 3000, 0), ligne("2026-08", "c1", "apport_commun", 0, 1200), ligne("2026-08", "cc", "apport_commun", 1200, 0), ligne("2026-08", "cc", "loyer", 0, 1100),
        ligne("2026-09", "c1", "salaires", 3000, 0), ligne("2026-09", "c1", "apport_commun", 0, 1200)] },
    config: {},
  };
  const aout = voir(S, { vue: "tout", mois: "2026-08" }), sept = voir(S, { vue: "tout", mois: "2026-09" });
  assert.equal(aout.par_sous_categorie.commun_non_detaille, undefined);
  near(aout.blocs.essentiels, 1100, "août : le loyer du commun");
  near(aout.hors_budget.apport_commun, 1200, "août : apport hors budget");
  near(sept.par_sous_categorie.commun_non_detaille.net, 1200, "septembre : apport converti");
  assert.deepEqual(sept.couverture.comptes_absents, ["cc"], "le commun est signalé absent en septembre");
});

test("apports reçus sur le commun depuis un compte non observé : revenus du foyer (Tout), du commun (Commun), pas de la personne", () => {
  const S = {
    banque: { actif: true, comptes: [compteStore({ id: "c1", type: "courant", titulaire: "p1" }), compteStore({ id: "cc", type: "courant", titulaire: "commun" })],
      mois: [ligne("2026-09", "c1", "salaires", 3000, 0), ligne("2026-09", "c1", "apport_commun", 0, 1000), ligne("2026-09", "cc", "apport_commun", 1800, 0), ligne("2026-09", "cc", "loyer", 0, 1800)] },
    config: {},
  };
  const T = voir(S, { vue: "tout", mois: "2026-09" }), C = voir(S, { vue: "commun", mois: "2026-09" }), P = voir(S, { vue: "perso", personne: "p1", mois: "2026-09" });
  near(T.revenus, 3800, "Tout : 3 000 + 800 d'apports vus");
  assert.ok(T.mentions.includes("apports_externes"));
  near(T.capacite, 3800 - 1800, "Tout capacité");
  near(C.revenus, 1800, "Commun : tous les apports reçus");
  near(P.revenus, 3000, "Perso : ses revenus seulement");
  near(P.depenses, 900, "Perso : moitié du loyer");
});

test("D4 carte à débit différé, relevé identifié : les opérations comptent à leur mois, le relevé est hors budget ; non identifié : relevé compté à classer", () => {
  const c = DC.D4, comptes = c.comptes;
  const ident = { banque: { actif: true, comptes: comptes.map(compteStore), mois: [ligne("2026-09", "k1", "courses", 0, 150), ligne("2026-09", "k1", "restaurants", 0, 60), ligne("2026-09", "k1", "shopping", 0, 90),
    ligne("2026-10", "c1", "releve_carte", 0, 300)] }, config: {} };
  const sept = voir(ident, { vue: "tout", mois: "2026-09" }), oct = voir(ident, { vue: "tout", mois: "2026-10" });
  cmp(sept, { par_sous_categorie: c.attendu.identifie["2026-09"] }, "D4 identifié septembre");
  cmp(oct, { depenses: c.attendu.identifie["2026-10"].depenses, hors_budget: c.attendu.identifie["2026-10"].hors_budget }, "D4 identifié octobre");
  assert.ok(!oct.mentions.includes("detail_carte_indisponible"));
  const non = { banque: { actif: true, comptes: comptes.map(compteStore), mois: [ligne("2026-10", "c1", "a_classer", 0, 300)] }, config: {} };
  const sept2 = voir(non, { vue: "tout", mois: "2026-09" }), oct2 = voir(non, { vue: "tout", mois: "2026-10" });
  assert.equal(sept2.depenses, 0);
  near(oct2.a_classer, c.attendu.non_identifie["2026-10"].a_classer, "D4 non identifié");
  assert.ok(oct2.mentions.includes(c.attendu.non_identifie["2026-10"].mention), "mention du détail de carte indisponible");
});

test("D5 remboursement d'un ami : sorties 380, entrées 40, net 340 dans la sous-catégorie", () => {
  const c = DC.D5, S = { banque: { actif: true, comptes: [compteStore({ id: "c1", type: "courant", titulaire: "p1" })], mois: [ligne(c.mois, "c1", "restaurants", 40, 380, 2)] }, config: {} };
  const M = voir(S, { vue: "tout", mois: c.mois }), r = M.par_sous_categorie.restaurants, a = c.attendu.restaurants;
  assert.deepEqual([r.sorties, r.entrees, r.net], [a.sorties, a.entrees, a.net]);
  assert.equal(M.blocs.envies, 340);
});

test("D6 épargne reprise : 500 venus du livret ne sont pas un revenu ; capacité −400, versée −500, restée 100, puisé 400", () => {
  const c = DC.D6, M = voir(storeDe(c), { vue: "tout", mois: c.mois });
  cmp(M, c.attendu.tout, "D6");
  assert.equal(M.revenus, 3000);
});

test("D8 virement entre vous deux : exclu de Tout, ajuste les revenus de Perso (−200 pour qui verse, +200 pour qui reçoit)", () => {
  const c = DC.D8, S = storeDe(c), a = c.attendu;
  cmp(voir(S, { vue: "tout", mois: c.mois }), { revenus: a.tout.revenus, depenses: a.tout.depenses, capacite: a.tout.capacite }, "D8 tout");
  cmp(voir(S, { vue: "perso", personne: "p1", mois: c.mois }), a.perso_p1, "D8 p1");
  cmp(voir(S, { vue: "perso", personne: "p2", mois: c.mois }), a.perso_p2, "D8 p2");
  assert.equal(voir(S, { vue: "tout", mois: c.mois }).hors_budget.transfert_foyer, 200);
});

/* ---------- D7 : import puis synchronisation du même compte (HIS2 fait référence) ---------- */
const storeD7 = () => {
  const c = DC.D7;
  const banqueMois = Object.entries(c.banque_mois).flatMap(([m, ls]) => ls.map(l => ligne(m, l.compte, l.sous_categorie, l.entrees, l.sorties)));
  const releves = Object.keys(c.importe).map(m => ({ compte_id: "hc1", mois: m, complet: true, total_entrees: 2000, total_sorties: 500, import_id: "imp-1" }));
  const lignes = Object.entries(c.importe).flatMap(([m, ls]) => ls.map(l => ({ compte_id: "hc1", mois: m, categorie: BC.largeDe(l.sous_categorie), sous_categorie: l.sous_categorie, entrees: l.entrees, sorties: l.sorties, nombre: 1 })));
  return { banque: { actif: true, comptes: c.comptes.map(compteStore), mois: banqueMois }, config: {},
    relevesBancaires: { lu: true, comptes: [{ id: "hc1", libelle: "Ancien courant", etablissement: "banque-x", type: "courant", titulaire: "p1", banqueCompteId: c.import_rattache_a }], releves, banqueMois: lignes } };
};
test("D7 import puis synchronisation : août et septembre viennent de l'import (septembre écarte le premier mois Powens), octobre de la banque, jamais les deux", () => {
  const S = storeD7(), a = DC.D7.attendu;
  for (const m of Object.keys(a)) {
    const M = voir(S, { vue: "tout", mois: m }), att = a[m];
    near(M.par_sous_categorie.courses.net, att.courses, "D7 " + m + " courses");
    near(M.revenus, att.revenus, "D7 " + m + " revenus");
    assert.deepEqual(M.sources.map(s => s.origine), [att.source === "import" ? "import" : "banque"], "D7 " + m + " source");
    assert.equal(M.couverture.ecartes.some(x => x.raison === "premier_mois"), att.ecarte === "premier_mois", "D7 " + m + " écarté");
  }
  assert.equal(voir(S, { vue: "tout", mois: "2026-10" }).en_cours, true);
});

test("fusion Powens et import : un mois d'un compte rattaché en partie importé est signalé (une source importée et une autre non)", () => {
  const S = storeD7();
  S.banque.comptes.push(compteStore({ id: "c9", type: "courant", titulaire: "p2" }));
  S.banque.mois.push(ligne("2026-09", "c9", "salaires", 1000, 0));
  const M = voir(S, { vue: "tout", mois: "2026-09" });
  assert.equal(M.couverture.en_partie_importe, true);
  assert.equal(voir(S, { vue: "tout", mois: "2026-08" }).couverture.en_partie_importe, false);
});

test("HIS2 B-carte : la carte importée compte quand le courant porte un relevé de carte (hors budget) ; mêmes chiffres que Calc.budgetReel", () => {
  const c = casHis2("B-carte"), S = { banque: c.entree.banque, relevesBancaires: historiqueDeFixture(c.entree.historique), config: {} };
  const M = voir(S, { vue: "tout", mois: "2026-08" }, c.today), r = Calc.budgetReel(c.entree.banque, c.today, undefined, S.relevesBancaires);
  near(M.revenus, r.revenus, "revenus"); near(M.depenses, r.depenses, "dépenses"); near(M.capacite, r.capacite, "capacité");
  assert.equal(M.hors_budget.releve_carte, 600);
  near(M.par_sous_categorie.courses.net, 400, "courses de la carte");
  assert.equal(M.couverture.comptes_observes, 2);
});

test("HIS2 B-carte-sans-releve : relevé non identifié, la carte est écartée et le relevé reste compté sur le courant (détail perdu)", () => {
  const c = casHis2("B-carte-sans-releve/budget"), S = { banque: c.entree.banque, relevesBancaires: historiqueDeFixture(c.entree.historique), config: {} };
  const mois = Calc.moisBancaires(c.entree.banque, S.relevesBancaires, c.today).map(e => e.mois);
  const m = mois.find(Boolean), M = voir(S, { vue: "tout", mois: m }, c.today), r = Calc.budgetReel(c.entree.banque, c.today, undefined, S.relevesBancaires);
  near(M.depenses, r.depenses, "dépenses"); near(M.revenus, r.revenus, "revenus");
  assert.equal(M.par_sous_categorie.courses, undefined, "pas de détail de la carte");
  assert.ok(M.couverture.ecartes.some(x => x.raison === "carte_comptee_sur_courant"));
});

test("un mois importé complet: false n'entre jamais au budget : ni Tout, ni la référence ; la couverture le dit et la note n'existe pas", () => {
  const S = storeD7();
  S.relevesBancaires.releves[0].complet = false;         // août incomplet
  const aout = voir(S, { vue: "tout", mois: "2026-08" });
  assert.equal(aout.revenus, 0); assert.equal(aout.depenses, 0);
  assert.equal(aout.couverture.import_incomplet, true);
  assert.equal(Budget.score(aout, { revenus_ref: 2000, blocs: { essentiels: 500, envies: 0, epargne: 1500 } }).raison_absence, "import_incomplet");
  const data = Budget.donnees(S, { aujourdhui: AUJ });
  assert.deepEqual(data.incomplets, [{ compte: "c1", mois: "2026-08" }]);
});

test("D9 non-régression : Calc.budgetReel et BanqueEtat.reelMoyen sont inchangés par les lignes BUD1 (sous-catégories, apport_commun, relevé de carte) sur la démo", () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const BanqueEtat = require("../web/src/banque-etat.js");
  const demo = global.window.DEMO, auj = new Date().toISOString().slice(0, 10);
  const avantCalc = Calc.budgetReel(demo.banque, auj), avantEtat = BanqueEtat.reelMoyen(demo.banque.mois, auj);
  assert.ok(avantCalc && avantEtat, "la démo a un budget réel");
  const mois = demo.banque.mois.map(r => ({ ...r, sous_categorie: BC.parDefautDe(r.categorie) }));
  const dernier = [...new Set(mois.map(r => r.mois))].sort().slice(-2)[0];
  mois.push({ mois: dernier, compteId: 1001, categorie: "virement_interne", sous_categorie: "apport_commun", entrees: 900, sorties: 1200, nombre: 2 },
    { mois: dernier, compteId: 1001, categorie: "virement_interne", sous_categorie: "releve_carte", entrees: 0, sorties: 300, nombre: 1 });
  const banque = { ...demo.banque, mois };
  assert.deepEqual(Calc.budgetReel(banque, auj), avantCalc, "Calc.budgetReel");
  assert.deepEqual(BanqueEtat.reelMoyen(banque.mois, auj), avantEtat, "BanqueEtat.reelMoyen");
});

test("Perso sans compte de la personne : état vide (aucun compte de p connecté ni importé), zéros", () => {
  const c = DC.D1, M = voir(storeDe(c), { vue: "perso", personne: "p2", mois: c.mois });
  assert.equal(M.vide, "aucun_compte_personne");
  assert.equal(M.revenus, 0); assert.equal(M.depenses, 0); assert.equal(M.couverture.comptes_observes, 0);
});

test("mois en cours : calculé, jamais noté ; mois futur : vide ; couverture : comptes observés et absents", () => {
  const S = { banque: { actif: true, comptes: [compteStore({ id: "c1", type: "courant", titulaire: "p1" }), compteStore({ id: "c2", type: "courant", titulaire: "p2" })],
    mois: [ligne("2026-10", "c1", "salaires", 2000, 0), ligne("2026-10", "c1", "courses", 0, 120), ligne("2026-09", "c1", "salaires", 2000, 0), ligne("2026-09", "c2", "courses", 0, 50)] }, config: {} };
  const oct = voir(S, { vue: "tout", mois: "2026-10" });
  assert.equal(oct.en_cours, true); assert.equal(oct.mois_complet, false); assert.equal(oct.couverture.mois_complet, false);
  assert.deepEqual(oct.couverture.comptes_absents, ["c2"]); assert.equal(oct.couverture.comptes_observes, 1);
  assert.equal(Budget.score(oct, { revenus_ref: 2000, blocs: { essentiels: 1000, envies: 500, epargne: 500 } }).raison_absence, "mois_en_cours");
  const futur = voir(S, { vue: "tout", mois: "2026-11" });
  assert.equal(futur.couverture.comptes_observes, 0); assert.equal(futur.mois_complet, false);
});

test("mois sans détail (sous-catégorie vide d'un import d'avant BUD1) : compte dans les totaux par catégorie large, mais ni détail ni note", () => {
  const S = { banque: { actif: false, comptes: [], mois: [] }, config: {},
    relevesBancaires: { lu: true, comptes: [{ id: "hc1", libelle: "Ancien", etablissement: "n26", type: "courant", titulaire: "p1", banqueCompteId: null }],
      releves: [{ compte_id: "hc1", mois: "2026-05", complet: true, total_entrees: 2300, total_sorties: 900 }],
      banqueMois: [{ compte_id: "hc1", mois: "2026-05", categorie: "revenus", sous_categorie: "", entrees: 2300, sorties: 0, nombre: 1 },
        { compte_id: "hc1", mois: "2026-05", categorie: "logement", sous_categorie: "", entrees: 0, sorties: 780, nombre: 1 }, { compte_id: "hc1", mois: "2026-05", categorie: "loisirs", sous_categorie: "", entrees: 0, sorties: 120, nombre: 1 }] } };
  const M = voir(S, { vue: "tout", mois: "2026-05" });
  assert.equal(M.revenus, 2300); near(M.depenses, 900, "dépenses");
  assert.equal(M.couverture.sans_detail, true);
  assert.equal(Budget.score(M, { revenus_ref: 2300, blocs: { essentiels: 1000, envies: 300, epargne: 1000 } }).raison_absence, "sans_detail");
  assert.equal(Budget.reference(Budget.donnees(S, { aujourdhui: AUJ }), { vue: "tout" }), null, "un mois sans détail n'entre pas dans la référence");
});

/* ---------- lissage des dépenses annuelles (§ 6.3) ---------- */
test("dépense annuelle : le réel reste au mois du paiement, la note lit 1/12 de son dernier montant chaque mois, avec ou sans règle `annuelle`", () => {
  const rows = [];
  for (let k = 0; k < 8; k++) { const m = "2026-0" + (k + 2); rows.push(ligne(m, "c1", "salaires", 3000, 0), ligne(m, "c1", "loyer", 0, 1000), ligne(m, "c1", "courses", 0, 400)); }
  rows.push(ligne("2026-03", "c1", "assurances", 0, 600));
  rows.push(ligne("2026-05", "c1", "sport", 0, 100));
  const marchands = [{ mois: "2026-03-01", compte_id: "c1", cle_marchand: "maif", sous_categorie: "assurances", entrees: 0, sorties: 600, nombre: 1, montant_min: 600, montant_max: 600, dernier_jour: 12 },
    { mois: "2026-05-01", compte_id: "c1", cle_marchand: "club de judo", sous_categorie: "sport", entrees: 0, sorties: 100, nombre: 1, montant_min: 100, montant_max: 100, dernier_jour: 3 }];
  const S = { banque: { actif: true, comptes: [compteStore({ id: "c1", type: "courant", titulaire: "p1" })], mois: rows, marchands }, config: {} };
  const sans = Budget.donnees(S, { aujourdhui: AUJ });
  const mars = Budget.mois(sans, { vue: "tout", mois: "2026-03" });
  assert.equal(mars.blocs.essentiels, 2000, "le réel : 1 000 + 400 + 600");
  assert.deepEqual(mars.lisse.annuelles.map(a => [a.sous_categorie, a.montant_mois, a.provision]), [["assurances", 600, 50]]);
  near(mars.lisse.essentiels_lisses, 1450, "1 000 + 400 + 50");
  const avril = Budget.mois(sans, { vue: "tout", mois: "2026-04" });
  assert.deepEqual(avril.lisse.annuelles.map(a => [a.montant_mois, a.provision]), [[0, 50]]);
  near(avril.lisse.essentiels_lisses, 1450, "avril : 1 400 + 50 de provision");
  assert.equal(Budget.mois(sans, { vue: "tout", mois: "2026-02" }).lisse.annuelles.length, 0, "avant le premier paiement connu, rien");
  assert.equal(Budget.mois(sans, { vue: "tout", mois: "2026-05" }).lisse.annuelles.filter(a => a.sous_categorie === "sport").length, 0, "100 € : sous le seuil, pas annuel sans règle");
  const regle = { id: "r7", motif: "club de judo", sous_categorie: "sport", sens: null, compte_id: null, montant_min: null, montant_max: null, annuelle: true, active: true, cree_le: "2026-01-01" };
  const avec = Budget.donnees({ ...S, regles: [regle] }, { aujourdhui: AUJ });
  const mai = Budget.mois(avec, { vue: "tout", mois: "2026-05" });
  assert.deepEqual(mai.lisse.annuelles.filter(a => a.sous_categorie === "sport").map(a => [a.regle_id, a.montant_mois, a.provision.toFixed(4)]), [["r7", 100, "8.3333"]]);
  near(mai.lisse.envies_lisses, 100 - 100 + 100 / 12, "envies lissées de mai");
  // la note lit le lissé : une fois le paiement de 600 lissé, un mois de mars tenu à sa cible reste tenu
  const cible = { revenus_ref: 3000, blocs: { essentiels: 1500, envies: 100, epargne: 1400 } };
  assert.ok(Budget.score(mars, cible).termes.essentiels.ecart < 1);
  assert.equal(Budget.score(mars, cible).repere, "depense_annuelle_lissee");
});

test("dépense annuelle confirmée : deux paiements à 11 à 13 mois d'écart ; Perso lisse sa part du commun", () => {
  const marchands = [
    { mois: "2025-10-01", compte_id: "cc", cle_marchand: "taxe fonciere", sous_categorie: "impots", entrees: 0, sorties: 900, nombre: 1, montant_min: 900, montant_max: 900, dernier_jour: 15 },
    { mois: "2026-10-01", compte_id: "cc", cle_marchand: "taxe fonciere", sous_categorie: "impots", entrees: 0, sorties: 960, nombre: 1, montant_min: 960, montant_max: 960, dernier_jour: 8 }];
  const S = { banque: { actif: true, comptes: [compteStore({ id: "c1", type: "courant", titulaire: "p1" }), compteStore({ id: "cc", type: "courant", titulaire: "commun" })],
    mois: [ligne("2026-10", "cc", "impots", 0, 960), ligne("2026-10", "c1", "salaires", 3000, 0)], marchands }, config: { partage: { mode: "fixe", p1: 0.25 } } };
  const data = Budget.donnees(S, { aujourdhui: AUJ });
  assert.equal(Budget.depensesAnnuelles(data, { vue: "tout" })[0].confirmee, true);
  const P = Budget.mois(data, { vue: "perso", personne: "p1", mois: "2026-10" });
  assert.deepEqual(P.lisse.annuelles.map(a => [a.montant_mois, a.provision]), [[240, 20]], "25 % de 960 ; provision 25 % de 960 / 12");
});

/* ---------- référence (§ 6.2) ---------- */
const moisSuite = (debut, n) => Array.from({ length: n }, (_, i) => { const t = +debut.slice(0, 4) * 12 + (+debut.slice(5) - 1) + i; return Math.floor(t / 12) + "-" + String(t % 12 + 1).padStart(2, "0"); });
const storeRef = (debut, courses, revenus = [], extra = []) => {
  const ms = moisSuite(debut, courses.length), rows = [];
  ms.forEach((m, i) => { rows.push(ligne(m, "c1", "salaires", revenus[i] ?? 3000, 0), ligne(m, "c1", "courses", 0, courses[i]), ligne(m, "c1", "loyer", 0, 1000)); });
  return { banque: { actif: true, comptes: [compteStore({ id: "c1", type: "courant", titulaire: "p1" })], mois: [...rows, ...extra] }, config: {} };
};
test("référence : médiane de 12 mois complets (valeur extrême sans effet), revenus médians, bornes du, au et n", () => {
  const courses = [400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 900], revenus = Array(12).fill(3000); revenus[3] = 1000;
  const ref = Budget.reference(Budget.donnees(storeRef("2025-10", courses, revenus), { aujourdhui: AUJ }), { vue: "tout" });
  assert.equal(ref.n, 12); assert.equal(ref.periode_courte, false);
  assert.equal(ref.du, "2025-10"); assert.equal(ref.au, "2026-09");
  assert.equal(ref.essentiels.courses, 455, "(450 + 460) / 2");
  assert.equal(ref.essentiels.loyer, 1000);
  assert.equal(ref.revenus, 3000);
  assert.equal(ref.par_sous_categorie.courses, 455);
  assert.equal(ref.totaux.essentiels, 1455);
});
test("référence : 6 mois au moins sinon période courte (3 à 5), moins de 3 : aucune ; mois_ref borne la fenêtre", () => {
  const d = (debut, c) => Budget.donnees(storeRef(debut, c), { aujourdhui: AUJ });
  const r7 = Budget.reference(d("2026-03", [300, 310, 320, 330, 340, 350, 360]), { vue: "tout" });
  assert.deepEqual([r7.n, r7.periode_courte, r7.essentiels.courses], [7, false, 330]);
  const r4 = Budget.reference(d("2026-06", [300, 320, 340, 360]), { vue: "tout" });
  assert.deepEqual([r4.n, r4.periode_courte, r4.essentiels.courses], [4, true, 330]);
  assert.equal(Budget.reference(d("2026-08", [300, 320]), { vue: "tout" }), null);
  const r12 = Budget.reference(d("2025-10", [100, 100, 100, 100, 100, 100, 200, 200, 200, 200, 200, 200]), { vue: "tout", mois_ref: 6 });
  assert.deepEqual([r12.n, r12.du, r12.essentiels.courses], [6, "2026-04", 200], "les 6 derniers mois seulement");
});
test("référence : les pistes et la cible lisent la forme rendue (smoke), et donnees(S) la fournit sur le foyer", () => {
  const data = Budget.donnees(storeRef("2025-10", Array(12).fill(500), [], [ligne("2026-05", "c1", "abonnements", 0, 12)]), { aujourdhui: AUJ });
  assert.equal(data.reference.essentiels.courses, 500);
  assert.ok(Array.isArray(data.mois) && data.mois.length === 6 && data.mois.every(x => x.capacite === 1500 || x.mois === "2026-05"), "capacités des 6 derniers mois");
  assert.ok(Array.isArray(Budget.pistes(data)));
  const prop = Budget.proposerCible(data, { reference: data.reference, pistes: [] });
  assert.equal(prop.cible.revenus_ref, 3000);
});
test("référence par vue : Perso lit sa part du commun, Commun lit le commun seul", () => {
  const rows = [];
  moisSuite("2026-02", 8).forEach(m => rows.push(ligne(m, "c1", "salaires", 3000, 0), ligne(m, "c1", "restaurants", 0, 200), ligne(m, "cc", "loyer", 0, 1200), ligne(m, "cc", "apport_commun", 1200, 0), ligne(m, "c1", "apport_commun", 0, 1200)));
  const S = { banque: { actif: true, comptes: [compteStore({ id: "c1", type: "courant", titulaire: "p1" }), compteStore({ id: "cc", type: "courant", titulaire: "commun" })], mois: rows }, config: { partage: { mode: "egal", p1: 0.5 } } };
  const data = Budget.donnees(S, { aujourdhui: AUJ });
  const p = Budget.reference(data, { vue: "perso", personne: "p1" }), c = Budget.reference(data, { vue: "commun" }), t = Budget.reference(data, { vue: "tout" });
  assert.deepEqual([p.essentiels.loyer, p.envies.restaurants, p.revenus], [600, 200, 3000]);
  assert.deepEqual([c.essentiels.loyer, c.revenus, c.envies.restaurants], [1200, 1200, undefined]);
  assert.deepEqual([t.essentiels.loyer, t.envies.restaurants], [1200, 200]);
});

/* ---------- séries et granularités ---------- */
test("série par mois, par trimestre et par année : sommes des mois, couverture, mois en cours non complet", () => {
  const S = storeRef("2026-01", [400, 400, 400, 500, 500, 500, 600, 600, 600, 700]);   // janvier à octobre 2026
  const data = Budget.donnees(S, { aujourdhui: AUJ });
  const mois = Budget.serie(data, { vue: "tout", du: "2026-01", au: "2026-09", granularite: "mois" });
  assert.equal(mois.length, 9);
  assert.equal(mois[0].mois, "2026-01"); assert.equal(mois[8].mois, "2026-09");
  const tri = Budget.serie(data, { vue: "tout", du: "2026-01", au: "2026-10", granularite: "trimestre" });
  assert.deepEqual(tri.map(x => x.mois), ["2026-T1", "2026-T2", "2026-T3", "2026-T4"]);
  assert.deepEqual(tri.map(x => x.revenus), [9000, 9000, 9000, 3000]);
  assert.deepEqual(tri.map(x => x.par_sous_categorie.courses.net), [1200, 1500, 1800, 700]);
  assert.deepEqual(tri.map(x => x.mois_complet), [true, true, true, false]);
  assert.equal(tri[0].granularite, "trimestre"); assert.deepEqual(tri[0].mois_inclus, ["2026-01", "2026-02", "2026-03"]);
  const an = Budget.serie(data, { vue: "tout", du: "2026-01-01", au: "2026-10-31", granularite: "annee" });
  assert.equal(an.length, 1); assert.equal(an[0].mois, "2026");
  near(an[0].capacite, 30000 - 10000 - (1200 + 1500 + 1800 + 700), "capacité de l'année");
  assert.equal(an[0].blocs.essentiels, 1200 + 1500 + 1800 + 700 + 10000);
  assert.equal(an[0].puise, 0);
});

test("Perso + Perso = Tout sur une série de plusieurs mois et trimestres (parts quelconques)", () => {
  const rows = [];
  moisSuite("2026-01", 9).forEach((m, i) => rows.push(ligne(m, "c1", "salaires", 3000, 0), ligne(m, "c2", "salaires", 2200 + i, 0), ligne(m, "c1", "courses", 0, 250 + i), ligne(m, "c2", "restaurants", 0, 130),
    ligne(m, "cc", "loyer", 0, 1111), ligne(m, "cc", "courses", 0, 307 + i), ligne(m, "c1", "apport_commun", 0, 900), ligne(m, "c2", "apport_commun", 0, 518 + i), ligne(m, "cc", "apport_commun", 1418 + i, 0),
    ligne(m, "c1", "transfert_foyer", 0, 40), ligne(m, "c2", "transfert_foyer", 40, 0)));
  const S = { banque: { actif: true, comptes: [compteStore({ id: "c1", type: "courant", titulaire: "p1" }), compteStore({ id: "c2", type: "courant", titulaire: "p2" }), compteStore({ id: "cc", type: "joint", titulaire: "commun" })], mois: rows },
    config: { partage: { mode: "apports", p1: 0.63 } } };
  const data = Budget.donnees(S, { aujourdhui: AUJ });
  for (const g of ["mois", "trimestre"]) {
    const o = { du: "2026-01", au: "2026-09", granularite: g }, T = Budget.serie(data, { ...o, vue: "tout" }), A = Budget.serie(data, { ...o, vue: "perso", personne: "p1" }), B = Budget.serie(data, { ...o, vue: "perso", personne: "p2" });
    T.forEach((t, i) => {
      near(A[i].capacite + B[i].capacite, t.capacite, g + " capacité " + t.mois); near(A[i].revenus + B[i].revenus, t.revenus, g + " revenus " + t.mois);
      for (const s of Object.keys(t.par_sous_categorie)) near((A[i].par_sous_categorie[s] ? A[i].par_sous_categorie[s].net : 0) + (B[i].par_sous_categorie[s] ? B[i].par_sous_categorie[s].net : 0), t.par_sous_categorie[s].net, g + " " + t.mois + " " + s);
    });
  }
});

test("donnees : comptes ignorés, en double, inactifs et livrets écartés ; banque éteinte : seuls les relevés importés comptent", () => {
  const comptes = [compteStore({ id: "c1", type: "courant", titulaire: "p1" }), { ...compteStore({ id: "c2", type: "courant", titulaire: "p1" }), ignore: true },
    { ...compteStore({ id: "c3", type: "courant", titulaire: "p1" }), doublonDe: "c1" }, { ...compteStore({ id: "c4", type: "courant", titulaire: "p1" }), actif: false }, compteStore({ id: "l1", type: "livret", titulaire: "p1" })];
  const mois = ["c1", "c2", "c3", "c4", "l1"].map(id => ligne("2026-09", id, "courses", 0, 100));
  const data = Budget.donnees({ banque: { actif: true, comptes, mois }, config: {} }, { aujourdhui: AUJ });
  assert.deepEqual(data.comptes.map(c => c.id), ["c1"]);
  assert.equal(Budget.mois(data, { vue: "tout", mois: "2026-09" }).depenses, 100);
  const off = Budget.donnees({ banque: { actif: false, comptes, mois }, config: {} }, { aujourdhui: AUJ });
  assert.equal(off.comptes.length, 0);
  assert.equal(Budget.donnees(null, { aujourdhui: AUJ }).comptes.length, 0);
});

test("préférences : les espèces comptent dans le bloc choisi (envies par défaut, essentiels sur demande)", () => {
  const S = storeRef("2026-09", [100]); S.banque.mois.push(ligne("2026-09", "c1", "especes", 0, 60));
  assert.equal(voir(S, { vue: "tout", mois: "2026-09" }).blocs.envies, 60);
  S.config.budget_preferences = { especes_bloc: "essentiels" };
  const M = voir(S, { vue: "tout", mois: "2026-09" });
  assert.equal(M.blocs.envies, 0); assert.equal(M.blocs.essentiels, 1160);
});
