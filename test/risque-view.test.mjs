// Diagnostic › Profil de risque (web/src/risque-view.*) : questionnaire en cartes, résultat, allocation cible vs réelle,
// risque réel et rattachement des poches. Contrôles statiques + fonctions pures (module.exports).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const read = rel => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");
const js = read("web/src/risque-view.js"), html = read("web/src/risque-view.html"), css = read("web/src/risque-view.css");
const V = require("../web/src/risque-view.js");
const Risque = require("../web/src/risque.js");
const Calc = require("../web/src/calc.js");
const Plan = require("../web/src/plan.js");
const Q = id => Risque.QUESTIONS.find(q => q.id === id);

test("risque-view.js : se compile, s'enregistre sous « risque-view » et sans requête DOM globale", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "risque-view.js" }));
  assert.match(js, /App\.register\("risque-view",api\)/);
  assert.match(js, /__pending/);
  assert.ok(!js.split("\n").some(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l) && !/dialog\[open\]/.test(l)));
});

test("risque-view.js : calcule avec Risque.evaluer et Risque.synthese, écrit risque et classes par la façade", () => {
  assert.match(js, /R\(\)\.evaluer\(rep,/);
  assert.match(js, /R\(\)\.synthese\(rq\.reponses\|\|\{\},ctx\(/);
  assert.match(js, /Store\.db\.doc\("profil\/main"\)\.update\(\{risque\}\)/);
  assert.match(js, /Store\.db\.doc\("profil\/main"\)\.update\(\{classes:c\}\)/);
  assert.match(js, /const risque=\{reponses:rep,profil:ev\.profil,score:ev\.score,date:/, "forme { reponses, profil, score, date }");
  assert.match(js, /const BROUILLON="risque-brouillon"/);
  assert.match(js, /Marche|M_\.classeRisque/);
  assert.match(js, /comparaison\.texte/);
});

test("risque-view : textes clés (intro, Claude, clavier, garde-fous, mauvaise année, rattachement)", () => {
  for (const t of ["questions, 3 minutes. Ce profil sert à comparer votre portefeuille à ce que vous pouvez supporter.", "Commencer", "Le faire avec Claude",
    'data-goto="profil/claude"', "Pourquoi cette question", "Pré-rempli d'après votre", "Voir mon profil", "Retour", "Plafonné à ",
    "Dans une mauvaise année (1 sur 100), votre portefeuille pourrait perdre environ", "Compter mon immobilier", "Refaire le questionnaire",
    "Le revoir avec Claude", "Protection", "fonds euros et or", "Échap"])
    assert.ok(js.includes(t) || html.includes(t), `« ${t} » absent`);
  assert.ok(html.includes("Corriger le classement de vos poches"));
  assert.ok(html.includes("Indicateur pédagogique, pas un conseil en investissement"));
  assert.match(js, /function headline\(\)\{ const id=S\.risque&&S\.risque\.profil; return id\?labelProfil\(id\):"À définir"; \}/);
  assert.match(js, /e\.key==="Escape"/);
  assert.match(js, /e\.key==="Enter"/);
  assert.match(js, /\/\^\[1-9\]\$\/\.test\(e\.key\)/);
});

test("risque-view.css : chaque @media commence après une règle fermée", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [...c.matchAll(/@media/g)].filter(m => !/(^|\})\s*$/.test(c.slice(0, m.index)));
  assert.equal(bad.length, 0);
});

test("risque-view.css : CSS entièrement scopé sous #view-risque-view (y compris dans les @media)", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^{}]+)\{/g)].map(m => m[2].trim()).filter(Boolean);
  const unscoped = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith("#view-risque-view"));
  assert.deepEqual(unscoped, []);
});

test("prerempli : matelas en mois de dépenses (poche Épargne ÷ dépenses du budget) et tranche d'âge du profil", () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const D = global.window.DEMO;
  const p = V.prerempli({ positions: D.positions, profil: D.profil, config: D.config, budget: D.budget, scope: "foyer" }, { Calc, Plan });
  const t = Plan.budgetTotaux(D.budget.lignes, D.profil, "foyer");
  assert.ok(Math.abs(p.matelasMois - Calc.poche(D.positions, "foyer", "Épargne") / t.depenses) < 1e-9);
  assert.equal(p.age, D.profil.foyer.age);
  assert.equal(V.valeurPreremplie(Q("matelas"), p), p.matelasMois >= 3 ? "oui" : "non");
  assert.equal(V.valeurPreremplie(Q("age"), p), D.profil.foyer.age);
  assert.equal(V.valeurPreremplie(Q("horizon"), p), undefined);
  const vide = V.prerempli({ positions: [], profil: null, budget: null, config: null }, { Calc, Plan });
  assert.deepEqual(vide, { matelasMois: null, age: null });
  assert.equal(V.valeurPreremplie(Q("matelas"), { matelasMois: 2.9 }), "non");
  assert.equal(V.valeurPreremplie(Q("matelas"), { matelasMois: 3 }), "oui");
  assert.equal(V.valeurPreremplie(Q("age"), { age: "zz" }), undefined, "tranche inconnue : pas de prérempli");
});

test("valide, basculer, effectives : réponses par type de question", () => {
  assert.equal(V.valide(Q("horizon"), "gt15"), true);
  assert.equal(V.valide(Q("horizon"), "x"), false);
  assert.equal(V.valide(Q("experience"), 0), true);
  assert.equal(V.valide(Q("experience"), -1), false);
  assert.equal(V.valide(Q("connaissances"), []), false);
  assert.equal(V.valide(Q("connaissances"), ["etf"]), true);
  const c = Q("connaissances");
  assert.deepEqual(V.basculer(c, ["etf"], "actions"), ["etf", "actions"]);
  assert.deepEqual(V.basculer(c, ["etf", "actions"], "etf"), ["actions"]);
  assert.deepEqual(V.basculer(c, ["etf", "actions"], "aucun"), ["aucun"], "« Aucun » efface les autres cases");
  assert.deepEqual(V.basculer(c, ["aucun"], "crypto"), ["crypto"], "une case précise efface « Aucun »");
  const e = V.effectives(Risque.QUESTIONS, { horizon: "8-15", matelas: "non" }, { matelasMois: 5, age: "a40" });
  assert.deepEqual(e, { horizon: "8-15", matelas: "non", age: "a40" }, "la réponse explicite l'emporte sur le prérempli");
});

test("effectives + Risque.evaluer : un questionnaire complet donne un profil et un score", () => {
  const rep = V.effectives(Risque.QUESTIONS, { horizon: "8-15", objectif: "croissance", reaction: "rien", perte_max: "p20", connaissances: ["etf", "actions"],
    experience: 5, revenus: "cdi", part_investie: "50-75" }, { matelasMois: 4, age: "a30" });
  const ev = Risque.evaluer(rep, {});
  assert.equal(ev.complet, true);
  assert.equal(ev.profil, "equilibre");
  assert.ok(ev.score >= 0 && ev.score <= 100);
});

test("geometrie : bande cible et barre réelle bornées à 0-100 %", () => {
  assert.deepEqual(V.geometrie(45, 60, 43.7), { bandeGauche: 45, bandeLargeur: 15, reel: 43.7 });
  assert.deepEqual(V.geometrie(0, 0, 2.7), { bandeGauche: 0, bandeLargeur: 0, reel: 2.7 });
  assert.deepEqual(V.geometrie(75, 95, 140), { bandeGauche: 75, bandeLargeur: 20, reel: 100 });
  assert.deepEqual(V.geometrie(60, 40, -3), { bandeGauche: 40, bandeLargeur: 20, reel: 0 }, "bornes inversées et réel négatif");
});

test("fpct : pourcentages à la française", () => {
  assert.equal(V.fpct(43.707), "43,7 %");
  assert.equal(V.fpct(-18.27, 0), "−18 %");
  assert.equal(V.fpct(20), "20 %");
  assert.equal(V.fpct(-0.01, 0), "0 %");
  assert.equal(V.fpct(null), "—");
});
