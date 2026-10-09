// Onglet Plan (web/src/plan-view.*) : vérifications statiques du branchement dans la coque, le build et l'App.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const js = readFileSync("web/src/plan-view.js", "utf8");
const css = readFileSync("web/src/plan-view.css", "utf8");
const html = readFileSync("web/src/plan-view.html", "utf8");
const shell = readFileSync("web/src/shell.html", "utf8");
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

test("coque : la vue Plan est dans Avenir › Budget et objectifs, avec son fragment", () => {
  assert.match(shell, /<section class="view" id="view-plan" data-space="avenir" data-sub="plan"[^>]*hidden>\s*<!--@plan-view-->/);
});

test("app.js : « plan » branché sur avenir/plan, anciens onglet et ancres redirigés", () => {
  const { SPACES, LEGACY_TABS, LEGACY_HASHES } = require("../web/src/app.js");
  const avenir = SPACES.find(s => s.space === "avenir");
  assert.equal(avenir.subs.find(x => x.id === "plan").module, "plan");
  assert.equal(LEGACY_TABS.plan, "avenir/plan");
  for (const h of ["#plan", "#budget", "#objectifs"]) assert.equal(LEGACY_HASHES[h], "avenir/plan");
});

test("build.mjs : module plan-view assemblé, moteur plan chargé avant", () => {
  const mods = JSON.parse(build.match(/const MODULES = (\[[^\]]*\])/)[1]);
  assert.ok(mods.includes("plan-view"));
  assert.match(build, /const SCRIPTS = \[[^\]]*"plan"[^\]]*\.\.\.MODULES/);
});
