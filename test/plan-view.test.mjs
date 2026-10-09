// Onglet Plan (web/src/plan-view.*) : vérifications statiques du branchement dans la coque, le build et l'App.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const js = readFileSync("web/src/plan-view.js", "utf8");
const css = readFileSync("web/src/plan-view.css", "utf8");
const html = readFileSync("web/src/plan-view.html", "utf8");
const shell = readFileSync("web/src/shell.html", "utf8");
const app = readFileSync("web/src/app.js", "utf8");
const build = readFileSync("build.mjs", "utf8");

test("plan-view.js : le fichier se compile", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "plan-view.js" }));
});

test("plan-view.js : s'enregistre auprès de l'App sous le nom « plan »", () => {
  assert.match(js, /App\.register\(["']plan["']/);
  assert.match(js, /__pending/);
});

test("plan-view.js : utilise la cascade Plan.affecterDeja pour le « déjà » des objectifs", () => {
  assert.match(js, /\.affecterDeja\(/);
  assert.match(js, /statutObjectif\([^)]*deja:/);
  assert.match(js, /repartirEpargne\(/);
});

test("plan-view.js : écrit par la façade Store.db (budget/main, objectifs)", () => {
  assert.match(js, /doc\("budget\/main"\)\.set\(/);
  assert.match(js, /collection\("objectifs"\)\.upsert\(/);
  assert.match(js, /doc\("objectifs\/" \+ id\)\.delete\(/);
  assert.match(js, /Assistant|\.prompt\("budget"\)/);
  assert.match(js, /\.parse\(.*"budget"\)/);
});

test("plan-view.js : aucune requête DOM globale hors racine du module", () => {
  const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
  assert.deepEqual(bad, [], "utiliser root.querySelector* au lieu de document.*");
});

test("plan-view.css : chaque @media commence après une règle fermée", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [...c.matchAll(/@media/g)].filter(m => !/(^|\})\s*$/.test(c.slice(0, m.index)));
  assert.deepEqual(bad.map(m => m.index), []);
});

test("plan-view.css : CSS entièrement scopé sous #view-plan (y compris dans les @media)", () => {
  // Les blocs @media sont « aplatis » : leurs règles sont contrôlées comme celles du niveau supérieur.
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !/^(from|to|\d+%)$/.test(s));
  assert.ok(sels.length > 20, "sélecteurs introuvables");
  const unscoped = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith("#view-plan"));
  assert.deepEqual(unscoped, []);
});

test("plan-view.html : les identifiants utilisés par le script existent", () => {
  const ids = [...js.matchAll(/\$\("(pv[A-Za-z]+)"\)/g)].map(m => m[1]);
  const missing = [...new Set(ids)].filter(id => !html.includes('id="' + id + '"') && !js.includes('id="' + id + '"'));
  assert.deepEqual(missing, []);
});

test("coque : la vue Plan est entre Acheter ou placer et Profil, avec son fragment", () => {
  assert.match(shell, /<section class="view" id="view-plan" role="tabpanel" aria-labelledby="tab-plan" hidden>\s*<!--@plan-view-->/);
  const i = k => shell.indexOf('id="view-' + k + '"');
  assert.ok(i("simu") < i("plan") && i("plan") < i("profil"));
});

test("app.js : « plan » dans ORDER avant « profil », libellé et ancres", () => {
  const order = JSON.parse(app.match(/const ORDER = (\[[^\]]*\])/)[1]);
  assert.ok(order.includes("plan"));
  assert.equal(order.indexOf("plan"), order.indexOf("simu") + 1);
  assert.ok(order.indexOf("plan") < order.indexOf("profil"));
  assert.match(app, /plan: "Plan"/);
  for (const h of ["#plan", "#budget", "#objectifs"]) assert.match(app, new RegExp(`"${h}": "plan"`));
});

test("build.mjs : module plan-view assemblé, moteur plan chargé avant", () => {
  const mods = JSON.parse(build.match(/const MODULES = (\[[^\]]*\])/)[1]);
  assert.ok(mods.includes("plan-view"));
  assert.match(build, /const SCRIPTS = \[[^\]]*"plan"[^\]]*\.\.\.MODULES/);
});
