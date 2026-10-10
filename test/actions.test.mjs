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

test("actions : s'enregistre et combine Rules.evaluate, Rules.builtins et les bonnes pratiques (repli Plan.score)", () => {
  assert.match(js, /App\.register\("actions",api\)/);
  assert.match(js, /Pr\.evaluer\(\{positions:ctx\.positions,profil:ctx\.profil,config:ctx\.config,budget:ctx\.budget,objectifs:ctx\.objectifs\|\|\[\],scope:ctx\.scope,/);
  assert.match(js, /risque:ctx\.risque\|\|null,classes:ctx\.classes\|\|\{\}/);
  assert.match(js, /if\(!faites&&Plan&&typeof Plan\.score==="function"\)/, "Plan.score seulement sans pratiques.js");
  assert.match(js, /window\.Rules,window\.Plan,window\.Pratiques\)/);
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

test("pistesPratiques : critères notés sous 20, liés à leur critère, sans « à compléter » ni informatif", () => {
  const P = A.pistesPratiques({ criteres: [
    { cle: "matelas", famille: "securite", titre: "Matelas de précaution", points: 20, sur: 20, texte: "t", piste: "p", lien: "avenir/plan" },
    { cle: "adequation", famille: "allocation", titre: "Adéquation au profil de risque", points: 9, sur: 20, texte: "8 points hors.", piste: "Rapprochez.", lien: "diagnostic/risque" },
    { cle: "frais", famille: "efficacite", titre: "Frais des fonds", points: 0, sur: 20, aCompleter: true, texte: "?", piste: "?", lien: "recos/actions" },
    { cle: "devises", famille: "allocation", titre: "Exposition hors euro", points: null, sur: 0, informatif: true, texte: "i", piste: "i", lien: "bilan/placements" },
    { cle: "geographie", famille: "allocation", titre: "Diversification géographique", points: 14, sur: 20, texte: "30 %.", piste: "Un socle monde.", lien: "bilan/placements" },
  ] });
  assert.deepEqual(P.map(p => p.cle), ["adequation", "geographie"]);
  assert.deepEqual([P[0].level, P[0].title, P[0].text, P[0].ordre, P[0].lien.route, P[0].lien.label],
    ["piste", "Adéquation au profil de risque : 9/20", "8 points hors. Rapprochez.", 9, "diagnostic/risque", "Voir le profil de risque"]);
  assert.equal(P[1].lien.route, "bilan/placements");
  assert.equal(A.lienRoute(null).route, "diagnostic/sante", "sans lien : vers les bonnes pratiques");
  assert.equal(A.lienRoute("avenir/plan").label, "Ouvrir le budget");
});

test("construire avec Pratiques : pistes des bonnes pratiques (pas de Plan.score), triées, liens des critères", () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const Rules = require("../web/src/rules.js"), Plan = require("../web/src/plan.js"), Pratiques = require("../web/src/pratiques.js");
  const D = global.window.DEMO;
  for (const scope of ["foyer", "p1", "p2"]) {
    const ctx = { positions: D.positions, config: D.config, scope, people: D.people, today: new Date().toISOString().slice(0, 10), status: D.status, profil: D.profil,
      budget: D.budget, objectifs: D.objectifs, risque: { reponses: {}, profil: "dynamique", score: 70, date: "2026-10-10" }, classes: {} };
    const L = A.construire(ctx, Rules, Plan, Pratiques);
    const res = Pratiques.evaluer({ ...ctx, today: new Date() });
    const attendues = res.criteres.filter(c => !c.aCompleter && !c.informatif && c.points < c.sur);
    const pistes = L.filter(i => i.level === "piste");
    assert.deepEqual(pistes.map(p => p.cle).sort(), attendues.map(c => c.cle).sort(), scope + " : une piste par critère sous 20");
    assert.deepEqual(pistes.map(p => p.ordre), [...pistes.map(p => p.ordre)].sort((a, b) => a - b), scope + " : les plus faibles d'abord");
    for (const p of pistes) assert.equal(p.lien.route, attendues.find(c => c.cle === p.cle).lien || "diagnostic/sante");
    assert.ok(!pistes.some(p => p.cle === "patrimoine"), "le critère patrimoine du score historique n'est plus une piste");
  }
  // Pratiques en erreur : repli sur Plan.score.
  const casse = { evaluer() { throw new Error("x"); } };
  const L = A.construire({ positions: D.positions, config: D.config, scope: "foyer", profil: D.profil, budget: D.budget }, null, Plan, casse);
  assert.ok(L.length && L.every(i => i.level === "piste"));
});
