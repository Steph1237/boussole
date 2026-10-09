// Bilan › Vue d'ensemble (web/src/bilan.*) : vérifications statiques du module, puis les calculs de la vue sur la démo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/bilan.js", "utf8");
const css = readFileSync("web/src/bilan.css", "utf8");
const html = readFileSync("web/src/bilan.html", "utf8");

test("bilan.js : le fichier se compile", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "bilan.js" }));
});

test("bilan.js : s'enregistre auprès de l'App sous le nom « bilan »", () => {
  assert.match(js, /App\.register\(["']bilan["']/);
  assert.match(js, /__pending/);
  assert.match(js, /\{ mount, update, show, headline \}/);
});

test("bilan.js : s'appuie sur BilanCalc, Plan.score et Rules.evaluate", () => {
  for (const f of ["composition", "allocation", "flux", "evolution"]) assert.match(js, new RegExp("BilanCalc\\." + f + "\\("), "BilanCalc." + f);
  assert.match(js, /Plan\.budgetTotaux\(/);
  assert.match(js, /Plan\.capaciteEpargne\(/);
  assert.match(js, /Plan\.score\(/);
  assert.match(js, /Rules\.evaluate\(/);
  assert.match(js, /Rules\.builtins\(/);
});

test("bilan.js : « À traiter » reprend la liste du module Actions, avec repli direct", () => {
  assert.match(js, /window\.Actions/);
  assert.match(js, /\.construire\(ctx, window\.Rules, window\.Plan\)/);
  assert.match(js, /\.items\(\)/);
  assert.match(js, /top = A\.slice\(0, 3\)/);
});

test("bilan.js : graphique Évolution filtré par Periodes (bornes, agrégation, résumé), choix mémorisés", () => {
  assert.match(js, /Periodes\.bornes\(/);
  assert.match(js, /Periodes\.agreger\(/);
  assert.match(js, /Periodes\.resume\(/);
  assert.match(js, /window\.Periodes/);
  assert.match(js, /"bilan-evo"/);
  assert.match(html, /id="blEvoPer"/);
  assert.match(html, /type="date" id="blEvoDu"/);
  assert.match(html, /data-vue="variations"/);
});

test("bilan.js : liens vers les sous-vues concernées", () => {
  const routes = new Set([...(js + html).matchAll(/(?:data-goto="|link\(")([a-z]+\/[a-z]+)"/g)].map(m => m[1]));
  for (const r of ["avenir/plan", "diagnostic/sante", "diagnostic/risque", "profil/donnees", "recos/actions"]) assert.ok(routes.has(r), r);
  const { resolve } = require("../web/src/app.js");
  for (const r of routes) assert.deepEqual(resolve(r), { space: r.split("/")[0], sub: r.split("/")[1] }, r + " est une route connue");
});

test("bilan.js : aucune requête DOM globale hors racine du module", () => {
  const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
  assert.deepEqual(bad, [], "utiliser root.querySelector* au lieu de document.*");
});

test("bilan.html : les identifiants utilisés par le script existent", () => {
  const ids = [...js.matchAll(/\$\("([A-Za-z0-9_-]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length > 15, "identifiants introuvables");
  const missing = [...new Set(ids)].filter(id => !html.includes('id="' + id + '"'));
  assert.deepEqual(missing, []);
  const sel = [...js.matchAll(/querySelectorAll?\("#([A-Za-z0-9_-]+)/g)].map(m => m[1]).filter(id => !html.includes('id="' + id + '"'));
  assert.deepEqual(sel, []);
});

test("bilan.css : chaque @media commence après une règle fermée", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [...c.matchAll(/@media/g)].filter(m => !/(^|\})\s*$/.test(c.slice(0, m.index)));
  assert.deepEqual(bad.map(m => m.index), []);
});

test("bilan.css : CSS entièrement scopé sous #view-bilan (y compris dans les @media)", () => {
  // Les blocs @media sont « aplatis » : leurs règles sont contrôlées comme celles du niveau supérieur.
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !/^(from|to|\d+%)$/.test(s));
  assert.ok(sels.length > 30, "sélecteurs introuvables");
  const unscoped = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith("#view-bilan"));
  assert.deepEqual(unscoped, []);
});

/* ---------- calculs de la vue sur les données de démonstration ---------- */
const Calc = require("../web/src/calc.js");
const Plan = require("../web/src/plan.js");
const B = require("../web/src/bilan-calc.js");
const DEMO = require("../web/src/demo-data.js");

test("démo : patrimoine net de la vue = Calc.patrimoine, sur chaque périmètre", () => {
  for (const scope of ["foyer", "p1", "p2"]) {
    const c = B.composition(DEMO.positions, DEMO.profil, scope), p = Calc.patrimoine(DEMO.positions, DEMO.profil, scope);
    assert.ok(Math.abs(c.net - p.net) < 1e-6, scope);
    assert.ok(Math.abs(c.actifs[0].total - p.financier) < 1e-6, scope);
  }
  const f = B.composition(DEMO.positions, DEMO.profil, "foyer");
  assert.ok(Math.abs(f.actifs[0].total - 94989.9) < 0.01);
  assert.equal(f.dettes.total, 156500);
});

test("démo : épargne du mois et taux, flux sans déficit", () => {
  const t = Plan.budgetTotaux(DEMO.budget.lignes, DEMO.profil, "foyer");
  assert.equal(Math.round(t.tauxEpargne * 100), 31);
  assert.ok(Math.abs(Plan.capaciteEpargne(t) - (t.revenus - t.depenses)) < 1e-6);
  const f = B.flux(t);
  assert.equal(f.vide, false);
  assert.equal(f.deficit, false);
  assert.ok(f.sorties.some(s => s.type === "epargne") && f.sorties.some(s => s.type === "reste"));
  const mois = Calc.poche(DEMO.positions, "foyer", "Épargne") / t.depenses;
  assert.ok(mois > 6 && mois < 9, "matelas de la démo : environ 7,8 mois");
});

test("démo : budget vide → pas d'épargne exploitable (la vue affiche « À renseigner »)", () => {
  const t = Plan.budgetTotaux([], DEMO.profil, "foyer");
  assert.ok(t.revenus > 0 && t.depensesLignes === 0 && t.epargne === 0);
});

test("démo : allocation par liquidité avec l'immobilier physique dans « Bloqué »", () => {
  const l = B.allocation(DEMO.positions, DEMO.profil, "foyer", "liquidite");
  assert.equal(l[0].cle, "bloque");
  assert.ok(l.find(x => x.cle === "bloque").montant >= 240000);
  const sans = B.allocation(DEMO.positions, DEMO.profil, "foyer", "liquidite", { financierSeul: true });
  assert.ok(Math.abs(sans.reduce((a, x) => a + x.montant, 0) - 94989.9) < 0.01);
});

test("démo : évolution sur au moins trois points, dont le point du jour", () => {
  const e = B.evolution(DEMO.snapshots, DEMO.positions, DEMO.profil, "foyer", new Date().toISOString().slice(0, 10));
  assert.ok(e.length >= 3);
  assert.equal(e[e.length - 1].live, true);
  assert.ok(e.every(p => p.net > p.financier), "net estimé au-dessus du financier (immobilier net de dettes positif)");
});

test("démo : les 3 premières entrées « À traiter » = tête de la liste Actions (même tri)", () => {
  const Actions = require("../web/src/actions.js"), Rules = require("../web/src/rules.js");
  const ctx = { positions: DEMO.positions, config: DEMO.config, scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }],
    today: new Date().toISOString().slice(0, 10), status: DEMO.status, profil: DEMO.profil, budget: DEMO.budget };
  const items = Actions.construire(ctx, Rules, Plan);
  assert.ok(items.length >= 3);
  const rang = { crit: 0, warn: 1, info: 2, piste: 3 };
  for (let i = 1; i < items.length; i++) assert.ok(rang[items[i - 1].level] <= rang[items[i].level], "tri par gravité");
});
