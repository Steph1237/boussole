// HIS2, tâche 9 : les mois importés se voient là où ils comptent (Patrimoine › Budget, projection, courbe, bonnes pratiques) — mêmes chiffres que Calc.budgetReel sur la série fusionnée.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cas, historiqueDeFixture } from "./helpers/his2.mjs";

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const Calc = require("../web/src/calc.js");
globalThis.Calc = Calc;
const PV = require("../web/src/plan-view.js");
const GM = require("../web/src/graphe-modele.js");
const Pratiques = require("../web/src/pratiques.js");
const Proj = require("../web/src/projection-donnees.js");
const src = f => readFileSync(new URL("../web/src/" + f, import.meta.url), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const c1 = cas("B1/budget"), h1 = historiqueDeFixture(c1.entree.historique);
const cP = cas("B1-powens/budget"), hP = historiqueDeFixture(cP.entree.historique);

test("Calc.budgetReel : moisImportes compte les mois retenus qui viennent des relevés importés (absent sans relevés)", () => {
  assert.equal(Calc.budgetReel(c1.entree.banque, "2026-10-16", undefined, h1).moisImportes, 2);
  assert.equal(Calc.budgetReel(cP.entree.banque, "2026-10-16", undefined, hP).moisImportes, 1, "février vient de la banque connectée");
  assert.equal("moisImportes" in Calc.budgetReel(cP.entree.banque, "2026-10-16"), false);
});

test("Patrimoine › Budget : budgetReelDe lit la série fusionnée, même sans banque connectée ; la note dit d'où viennent les mois importés", () => {
  const r = PV.budgetReelDe({ scope: "foyer", banque: { actif: false, comptes: [], mois: [] }, relevesBancaires: h1 }, "2026-10-16");
  assert.equal(r.revenus, 3000);
  assert.equal(r.depenses, 1860);
  assert.equal(PV.budgetReelDe({ scope: "foyer", banque: null, relevesBancaires: h1 }, "2026-10-16").moisImportes, 2);
  assert.equal(PV.budgetReelDe({ scope: "p2", banque: null, relevesBancaires: h1 }, "2026-10-16"), null, "les comptes ne sont pas répartis par personne");
  assert.equal(PV.budgetReelDe({ scope: "foyer", banque: { actif: false }, relevesBancaires: { comptes: [], releves: [], banqueMois: [] } }, "2026-10-16"), null);
  const html = PV.tauxReelHtml(r);
  assert.match(html.replace(/[  ]/g, " "), /Dont 2 mois tirés de relevés que tu as déposés dans la conversation\./);
  assert.doesNotMatch(PV.tauxReelHtml(Calc.budgetReel(cP.entree.banque, "2026-10-16")), /Dont/);
});

test("courbe : l'épargne constatée mois par mois lit aussi les relevés importés", () => {
  const S = { scope: "foyer", banque: null, relevesBancaires: { comptes: h1.comptes, releves: h1.releves.map(r => ({ ...r, mois: "2026-08" + r.mois.slice(7) })), banqueMois: h1.banqueMois.map(l => ({ ...l, mois: "2026-08" + l.mois.slice(7) })) } };
  // les relevés de B1 sont de 2024 : on les rejoue sur août 2026 pour qu'ils tombent dans les 12 derniers mois
  const rel = [{ ...h1.releves[0], mois: "2026-08" }, { ...h1.releves[1], mois: "2026-09" }];
  const lig = h1.banqueMois.map(l => ({ ...l, mois: l.mois === "2024-01" ? "2026-08" : "2026-09" }));
  const ep = GM.epargnePasseDe({ scope: "foyer", banque: null, relevesBancaires: { comptes: h1.comptes, releves: rel, banqueMois: lig } }, "2026-10-16", { Calc });
  assert.deepEqual(J(ep), [{ debut: "2026-08-01", montant: 1200 }, { debut: "2026-09-01", montant: 1080 }]);
  assert.deepEqual(GM.epargnePasseDe({ scope: "foyer", banque: null, relevesBancaires: null }, "2026-10-16", { Calc }), []);
  void S;
});

test("projection : la capacité constatée vient des relevés importés quand il n'y a pas de banque connectée (même chiffre que le connecteur)", () => {
  const entree = Proj.depuisEtat({ positions: [], config: {}, profil: { foyer: { adultes: 1 }, personnes: {}, credits: [], biens: [] }, budget: { lignes: [] }, banque: null, relevesBancaires: h1, objectifs: [], foyer: {}, savoir: { reperes: [] }, indices: [], classes: {}, snapshots: [], tx: [] }, "2026-10-16");
  assert.deepEqual(J(entree.relevesBancaires), J(h1));
  assert.equal("historique" in entree && entree.historique != null && entree.historique.releves !== undefined, false, "la clé historique reste celle du rétro-contrôle");
});

test("les écrans qui évaluent les bonnes pratiques transmettent relevesBancaires comme banque", () => {
  for (const [f, motif] of [["sante.js", /relevesBancaires:S\.relevesBancaires\|\|null/], ["actions.js", /relevesBancaires:S\.relevesBancaires/], ["journal-view.js", /relevesBancaires: s\.relevesBancaires \|\| null/], ["aujourdhui.js", /relevesBancaires: s\.relevesBancaires \|\| null/], ["graphe-modele.js", /C\.budgetReel\(S\.banque \|\| null, .*, 1, rb\)/], ["plan-view.js", /C\.budgetReel\(b && b\.actif \? b : null, today, undefined, h\)/]])
    assert.match(src(f), motif, f);
  assert.ok(Pratiques.evaluer, "Pratiques chargé");
});
