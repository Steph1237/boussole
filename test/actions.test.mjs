// Recommandations › Actions (web/src/actions.*) : liste priorisée des alertes (règles + contrôles intégrés)
// et des pistes du score de santé. Contrôles statiques + fonctions pures (module.exports).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const read = rel => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");
const js = read("web/src/actions.js"), html = read("web/src/actions.html"), css = read("web/src/actions.css");
const A = require("../web/src/actions.js");

const scopedSelectors = (src, prefix) => {
  const c = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s));
  return sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith(prefix));
};

test("actions : s'enregistre et combine Rules.evaluate, Rules.builtins et Plan.score", () => {
  assert.match(js, /App\.register\("actions",api\)/);
  assert.match(js, /Rules\.evaluate\(cfg\.rules\|\|\[\],ctx\)\.concat\(Rules\.builtins\(ctx\)\)/);
  assert.match(js, /Plan\.score\(\{positions:ctx\.positions,profil:ctx\.profil,config:ctx\.config,budget:ctx\.budget,scope:ctx\.scope/);
  assert.match(js, /construire\(\{positions:S\.positions,config:S\.config\|\|\{\},scope:S\.scope,people:S\.people,today:today\(\),status:S\.status/, "même contexte que les anciennes alertes du Pilotage");
  assert.match(js, /window\.Actions=\{items:/, "liste exposée pour la vue d'ensemble du Bilan");
});

test("actions : headline = nombre crit + warn en chaîne d'entiers, vide à zéro", () => {
  assert.match(js, /function headline\(\)\{ const u=urgents\(items\); return u\?String\(u\):""; \}/);
  assert.equal(A.urgents([{ level: "crit" }, { level: "warn" }, { level: "info" }, { level: "piste" }]), 2);
  assert.equal(A.urgents([{ level: "info" }]), 0);
});

test("actions : filtres, bandeau de veille, liens data-goto", () => {
  for (const f of ["tout", "urgent", "surveiller", "pistes"]) assert.match(html, new RegExp(`data-ac-filtre="${f}"`));
  for (const l of ["Tout", "Urgent", "À surveiller", "Pistes"]) assert.ok(html.includes(">" + l + " <"), l);
  assert.ok(html.includes("Veille : jamais lancée — votre Claude pourra déposer ici des signaux et opportunités (bientôt)."));
  assert.match(js, /data-goto="\$\{esc\(l\.route\)\}"/);
});

test("actions : CSS entièrement scopé sous #view-actions", () => {
  assert.deepEqual(scopedSelectors(css, "#view-actions"), []);
});

test("ordonner : crit > warn > info > piste, stable, pistes les plus faibles d'abord", () => {
  const items = [
    { level: "piste", title: "p15", ordre: 15 }, { level: "info", title: "i1" }, { level: "warn", title: "w1" },
    { level: "piste", title: "p8", ordre: 8 }, { level: "crit", title: "c1" }, { level: "info", title: "i2" }, { level: "warn", title: "w2" },
  ];
  assert.deepEqual(A.ordonner(items).map(i => i.title), ["c1", "w1", "w2", "i1", "i2", "p8", "p15"]);
  assert.deepEqual(A.ordonner([]), []);
  assert.deepEqual(A.ordonner(null), []);
  assert.equal(items[0].title, "p15", "l'entrée n'est pas modifiée");
});

test("liens : règle → placements (+ réglages), matelas → budget, pistes selon le critère", () => {
  assert.deepEqual(A.lienAlerte({ rule: { type: "max_line_pct" }, title: "Ligne trop lourde : X" }).lien.route, "bilan/placements");
  assert.equal(A.lienAlerte({ rule: { type: "price_floor" }, title: "x" }).lien2.route, "profil/regles");
  assert.equal(A.lienAlerte({ rule: null, title: "Matelas sous la cible" }).lien.route, "avenir/plan");
  assert.equal(A.lienAlerte({ rule: null, title: "Poche Monde au-dessus de la cible" }).lien.route, "bilan/placements");
  assert.equal(A.lienAlerte({ rule: null, title: "Fin de période d'essai", text: "Le 25 oct. 2026 (dans 15 jours). " }).lien.route, "avenir/plan");
  assert.equal(A.lienPiste("matelas").route, "avenir/plan");
  assert.equal(A.lienPiste("epargne").route, "avenir/plan");
  assert.equal(A.lienPiste("endettement").route, "profil/donnees");
  assert.equal(A.lienPiste("patrimoine").route, "profil/donnees");
  assert.equal(A.lienPiste("concentration").route, "bilan/placements");
});

test("pistes : seulement les critères calculés et sous le maximum", () => {
  const P = A.pistes({ items: [
    { cle: "matelas", titre: "Matelas", points: 20, sur: 20, aCompleter: false, texte: "t", piste: "p" },
    { cle: "epargne", titre: "Taux d'épargne", points: 12, sur: 20, aCompleter: false, texte: "10 %.", piste: "Visez 15 %." },
    { cle: "patrimoine", titre: "Patrimoine", points: 0, sur: 20, aCompleter: true, texte: "?", piste: "?" },
  ] });
  assert.equal(P.length, 1);
  assert.deepEqual([P[0].level, P[0].title, P[0].text, P[0].ordre, P[0].lien.route], ["piste", "Taux d'épargne : 12/20", "10 %. Visez 15 %.", 12, "avenir/plan"]);
});

test("construire sur la démo : alertes des règles et pistes, triées, scope respecté", () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const Rules = require("../web/src/rules.js"), Plan = require("../web/src/plan.js");
  const D = global.window.DEMO;
  for (const scope of ["foyer", "p1", "p2"]) {
    const ctx = { positions: D.positions, config: D.config, scope, people: D.people, today: new Date().toISOString().slice(0, 10), status: D.status, profil: D.profil, budget: D.budget };
    const L = A.construire(ctx, Rules, Plan);
    const rangs = L.map(i => A.RANG[i.level]);
    assert.deepEqual(rangs, [...rangs].sort((a, b) => a - b), scope + " : trié par gravité");
    assert.ok(L.every(i => i.title && i.lien && i.lien.route), scope + " : chaque entrée a un titre et un lien");
    const attendu = Rules.evaluate(D.config.rules || [], ctx).length + Rules.builtins(ctx).length;
    assert.equal(L.filter(i => i.level !== "piste").length, attendu, scope + " : toutes les alertes reprises");
    if (scope === "foyer") assert.ok(L.some(i => i.rule), "la démo déclenche au moins une règle au foyer");
  }
  assert.deepEqual(A.construire({ positions: [], config: {} }, null, null), [], "sans rules.js ni plan.js : liste vide");
});
