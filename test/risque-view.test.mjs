// Pilotage › Risque (web/src/risque-view.*) : questionnaire en cartes, résultat, allocation cible vs réelle,
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
  assert.ok(!js.split("\n").some(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l)));
  assert.doesNotMatch(js, /document\.addEventListener\("keydown"/, "clavier du questionnaire branché sur le panneau, pas sur tout le document");
});

test("risque-view.js : calcule avec Risque.evaluer et Risque.synthese, écrit risque et classes par la façade", () => {
  assert.match(js, /R\(\)\.evaluer\(rep,\{\}\)/);
  assert.match(js, /R\(\)\.synthese\(rq\?rq\.reponses\|\|\{\}:\{\},ctx\(avecImmo\)\)/);
  assert.match(js, /R\(\)\.ecarts\(decl\.id,sa\.allocation\)/, "écarts rapportés au profil enregistré");
  assert.match(js, /Store\.db\.doc\("profil\/main"\)\.update\(\{risque\}\)/);
  assert.match(js, /Store\.db\.doc\("profil\/main"\)\.update\(\{classes:c\}\)/);
  assert.match(js, /const risque=\{reponses:rep,profil:ev\.profil,score:ev\.score,date:/, "forme { reponses, profil, score, date }");
  assert.match(js, /const BROUILLON="risque-brouillon"/);
  assert.match(js, /M_\.classeRisque/);
  assert.match(js, /verdict\(\{declare:decl,equivalent:eq,ecarts:decl\?sa\.ecarts:\[\]\},R\(\)\.PROFILS\)/, "comparaison rapportée au profil enregistré");
});

test("risque-view : textes clés (question, intro, Claude, étapes, résumé, garde-fous, mauvaise année, rattachement)", () => {
  for (const t of ["Mon portefeuille correspond-il à mon profil ?", "questions, 3 minutes. Ce profil sert à comparer votre portefeuille à ce que vous pouvez supporter.",
    "Commencer le questionnaire", "Le faire avec Claude", 'data-goto="agent/connexion"', "Pourquoi cette question", "Pré-rempli d'après votre",
    "Précédent", "Vérifiez vos réponses", "Profil obtenu", "Plafonné à ", "Dans une mauvaise année (1 sur 100), votre portefeuille pourrait perdre environ",
    "Compter mon immobilier", "Refaire le questionnaire", "Le revoir avec Claude", "Protection", "fonds euros et or", "Échap", "D'où vient le risque",
    "Comment c'est calculé", "Allocation par classe", "Perte plausible sur un an", "Comportement du portefeuille", "Profil déclaré"])
    assert.ok(js.includes(t) || html.includes(t), `« ${t} » absent`);
  assert.ok(html.includes("Corriger le classement de vos poches"));
  assert.match(html, /<details class="ui-acc rv-classes" id="rvClasses">/, "classement des poches en accordéon fermé");
  assert.ok(html.includes("Indicateur pédagogique, pas un conseil en investissement"));
  assert.match(js, /function headline\(\)\{ const id=S\.risque&&S\.risque\.profil; return id\?labelProfil\(id\):"À définir"; \}/);
  assert.match(js, /e\.key==="Enter"/);
  assert.match(js, /\/\^\[1-9\]\$\/\.test\(e\.key\)/);
  assert.match(js, /e\.key==="ArrowDown"\|\|e\.key==="ArrowUp"/);
});

test("risque-view.css : chaque @media commence après une règle fermée", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [...c.matchAll(/@media/g)].filter(m => !/(^|\})\s*$/.test(c.slice(0, m.index)));
  assert.equal(bad.length, 0);
});

test("risque-view.css : CSS entièrement scopé sous #view-risque-view ou .ui-panneau .rv-… (y compris dans les @media)", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^{}]+)\{/g)].map(m => m[2].trim()).filter(Boolean);
  const tous = sels.flatMap(s => s.split(",").map(x => x.trim()));
  const unscoped = tous.filter(x => !x.startsWith("#view-risque-view") && !/^\.ui-panneau (\.rv-|#rvNombre)/.test(x));
  assert.deepEqual(unscoped, []);
  assert.ok(tous.some(x => x.startsWith(".ui-panneau .rv-quiz")), "questionnaire stylé dans le panneau");
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

/* ------------------------------------------------------------ nouvelles fonctions pures ------------------------------------------------------------ */
const P = id => Risque.PROFILS.find(p => p.id === id);

test("ecartNiveaux, horsFourchette, verdict : une phrase qui répond à la question", () => {
  assert.equal(V.ecartNiveaux(Risque.PROFILS, "equilibre", "dynamique"), 1);
  assert.equal(V.ecartNiveaux(Risque.PROFILS, "equilibre", "prudent"), -2);
  assert.equal(V.ecartNiveaux(Risque.PROFILS, "equilibre", "equilibre"), 0);
  assert.equal(V.ecartNiveaux(Risque.PROFILS, null, "equilibre"), null);
  const ec = [{ statut: "dans" }, { statut: "sous" }, { statut: "au-dessus" }, { statut: "dans" }, { statut: "dans" }];
  assert.equal(V.horsFourchette(ec), 2);
  assert.equal(V.horsFourchette(null), 0);
  const ok = V.verdict({ declare: P("equilibre"), equivalent: P("equilibre"), ecarts: ec }, Risque.PROFILS);
  assert.equal(ok.ton, "ok");
  assert.equal(ok.phrase, "Oui : votre portefeuille se comporte comme un profil Équilibré, conforme à votre profil.");
  assert.equal(ok.allocation, "2 classes sur 5 hors de la fourchette du profil Équilibré.");
  const plus = V.verdict({ declare: P("modere"), equivalent: P("dynamique"), ecarts: [{ statut: "dans" }] }, Risque.PROFILS);
  assert.equal(plus.ton, "crit");
  assert.equal(plus.ecart, 2);
  assert.match(plus.phrase, /^Non : .*profil Dynamique, alors que votre profil est Modéré ; il prend plus de risque que vous ne le souhaitez\.$/);
  assert.equal(plus.allocation, "Chaque classe est dans la fourchette du profil Modéré.");
  const moins = V.verdict({ declare: P("dynamique"), equivalent: P("prudent"), ecarts: [] }, Risque.PROFILS);
  assert.equal(moins.ton, "warn");
  assert.match(moins.phrase, /^Pas tout à fait : .*moins de risque que votre profil ne le permet\.$/);
  assert.match(V.verdict({ declare: null, equivalent: P("prudent") }, Risque.PROFILS).phrase, /pas encore défini/);
  assert.match(V.verdict({ declare: P("prudent"), equivalent: null }, Risque.PROFILS).phrase, /^Aucun placement à comparer à votre profil Prudent/);
});

test("etape, premiereEtape : questions une à une puis résumé avant enregistrement", () => {
  const L = Risque.QUESTIONS, n = L.length;
  const e0 = V.etape(L, 0);
  assert.deepEqual([e0.type, e0.numero, e0.total, e0.premier, e0.suivant.action, e0.suivant.label], ["question", 1, n, true, "suivant", "Suivant"]);
  assert.equal(e0.question, L[0]);
  const der = V.etape(L, n - 1);
  assert.deepEqual([der.premier, der.suivant.label], [false, "Voir le résumé"]);
  const r = V.etape(L, n);
  assert.deepEqual([r.type, r.question, r.suivant.action, r.suivant.label], ["resume", null, "enregistrer", "Enregistrer mon profil"]);
  assert.equal(V.etape(L, 99).type, "resume", "borné au résumé");
  assert.equal(V.etape(L, -3).index, 0, "borné à la première question");
  assert.equal(V.premiereEtape(L, {}, {}), 0);
  assert.equal(V.premiereEtape(L, { horizon: "8-15", objectif: "croissance" }, {}), 2);
  const complet = { horizon: "8-15", objectif: "croissance", reaction: "rien", perte_max: "p20", connaissances: ["etf"], experience: 5, revenus: "cdi", part_investie: "50-75" };
  assert.equal(V.premiereEtape(L, complet, { matelasMois: 4, age: "a30" }), n, "tout répondu (prérempli compris) : résumé");
  assert.equal(V.premiereEtape(L, complet, {}), L.findIndex(q => q.id === "matelas"), "sans prérempli : la question du matelas");
});

test("libelleReponse, resume : réponses lisibles, prérempli signalé, manque repéré", () => {
  assert.equal(V.libelleReponse(Q("horizon"), "8-15"), "8 à 15 ans");
  assert.equal(V.libelleReponse(Q("connaissances"), ["etf", "actions"]), "ETF (fonds indiciels cotés), Actions");
  assert.equal(V.libelleReponse(Q("experience"), 5), "5 ans (5 à 9 ans)");
  assert.equal(V.libelleReponse(Q("experience"), 0), "0 an (jamais ou moins d'un an)");
  assert.equal(V.libelleReponse(Q("horizon"), "zz"), "");
  const rs = V.resume(Risque.QUESTIONS, { horizon: "gt15" }, { matelasMois: 5 });
  assert.equal(rs.length, Risque.QUESTIONS.length);
  assert.deepEqual(rs[0], { id: "horizon", theme: "Horizon", texte: Q("horizon").texte, reponse: "Plus de 15 ans", prerempli: false, manque: false });
  const m = rs.find(x => x.id === "matelas");
  assert.deepEqual([m.reponse, m.prerempli, m.manque], ["Oui", true, false]);
  assert.equal(rs.find(x => x.id === "objectif").manque, true);
});

test("questionClaude : question préremplie selon le verdict", () => {
  assert.match(V.questionClaude({ declare: null }), /définir mon profil de risque/);
  assert.match(V.questionClaude({ declare: P("modere"), equivalent: P("dynamique"), profils: Risque.PROFILS }), /Dynamique alors que mon profil est Modéré/);
  assert.match(V.questionClaude({ declare: P("modere"), equivalent: P("modere"), profils: Risque.PROFILS }), /conforme à mon profil Modéré/);
});

/* ------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------ */
import { miniDom } from "./helpers/mini-dom.mjs";
const attendre = () => new Promise(r => setTimeout(r, 0));
function vueRisque(S0, o = {}) {
  const dom = miniDom(), { doc } = dom;
  const modules = {}, ecrits = [], stock = new Map();
  let S = JSON.parse(JSON.stringify(S0));
  const ctx = { document: doc, console: o.echec ? Object.assign({}, console, { error() {} }) : console, setTimeout, clearTimeout, Intl, CSS: { escape: s => String(s).replace(/["\\]/g, "\\$&") },
    localStorage: { getItem: k => (stock.has(k) ? stock.get(k) : null), setItem: (k, v) => stock.set(k, String(v)), removeItem: k => stock.delete(k) } };
  ctx.window = ctx; ctx.self = ctx;
  ctx.App = { register: (n, api) => { modules[n] = api; } };
  ctx.Store = { db: { doc: () => ({ update: async patch => { if (o.echec) throw new Error("réseau coupé"); ecrits.push(patch); Object.assign(S, patch); } }) } };
  vm.createContext(ctx);
  for (const f of ["calc.js", "plan.js", "marche.js", "risque.js", "ui.js"]) vm.runInContext(read("web/src/" + f), ctx, { filename: f });
  vm.runInContext(js, ctx, { filename: "risque-view.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = html;
  const api = modules["risque-view"];
  api.mount(root);
  api.update(S, true);
  return { ctx, dom, doc, root, api, ecrits, stock, S: () => S };
}
const demoS = () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const D = JSON.parse(JSON.stringify(global.window.DEMO));
  return { scope: "foyer", people: D.people || [], positions: D.positions, config: D.config, profil: D.profil, budget: D.budget, risque: null, classes: {} };
};

test("vue (DOM) : sans profil, invitation ; questionnaire complet au clavier dans le panneau, résumé, enregistrement, verdict focalisé", async () => {
  const v = vueRisque(demoS());
  const dlg = () => v.doc.body.querySelector('[role="dialog"]');
  const corps = () => v.doc.body.querySelector(".ui-panneau-corps");
  assert.match(v.root.querySelector("#rvVerdict").textContent, /pas encore défini/);
  assert.equal(v.api.headline(), "À définir");
  const start = v.root.querySelector('[data-rv="start"]');
  start.focus(); start.click();
  assert.equal(dlg().hidden, false, "questionnaire dans le panneau");
  assert.equal(v.doc.activeElement.getAttribute("id"), "rvQ", "focus sur la question");
  assert.match(corps().textContent, /Question 1 sur 10/);
  assert.equal(corps().querySelector('[data-rv="precedent"]').hasAttribute("disabled"), true);
  // Q1 horizon : touche 4 (8 à 15 ans), puis Entrée
  v.dom.touche(v.doc.activeElement, "4");
  assert.equal(corps().querySelector('[data-opt="8-15"]').getAttribute("aria-checked"), "true");
  v.dom.touche(v.doc.activeElement, "Enter");
  assert.match(corps().textContent, /Question 2 sur 10/);
  // Précédent revient à la question 1, réponse gardée
  corps().querySelector('[data-rv="precedent"]').click();
  assert.match(corps().textContent, /Question 1 sur 10/);
  assert.equal(corps().querySelector('[data-opt="8-15"]').getAttribute("aria-checked"), "true");
  v.dom.touche(v.doc.activeElement, "Enter");
  // Q2 objectif : flèche bas depuis l'option choisie (radio)
  v.dom.touche(v.doc.activeElement, "3");
  const o3 = corps().querySelector('[data-opt="croissance"]');
  assert.equal(o3.getAttribute("aria-checked"), "true");
  assert.equal(o3.getAttribute("tabindex"), "0", "radio : seule l'option choisie est tabulable");
  o3.focus();
  v.dom.touche(o3, "ArrowUp");
  assert.equal(corps().querySelector('[data-opt="revenus"]').getAttribute("aria-checked"), "true");
  assert.equal(v.doc.activeElement.getAttribute("data-opt"), "revenus", "le focus suit la flèche");
  v.dom.touche(corps().querySelector("#rvQ"), "Enter");
  // Q3 réaction, Q4 perte max
  corps().querySelector("#rvQ").focus(); v.dom.touche(v.doc.activeElement, "3"); v.dom.touche(v.doc.activeElement, "Enter");
  v.dom.touche(v.doc.activeElement, "3"); v.dom.touche(v.doc.activeElement, "Enter");
  // Q5 connaissances (multi) : 3 et 4
  assert.match(corps().textContent, /Question 5 sur 10/);
  v.dom.touche(v.doc.activeElement, "3"); v.dom.touche(v.doc.activeElement, "4");
  assert.equal(corps().querySelector('[data-opt="etf"]').getAttribute("aria-pressed"), "true");
  assert.equal(corps().querySelector('[data-opt="actions"]').getAttribute("aria-pressed"), "true");
  v.dom.touche(v.doc.activeElement, "Enter");
  // Q6 expérience (nombre) : focus dans le champ, + puis Entrée
  assert.equal(v.doc.activeElement.getAttribute("id"), "rvNombre");
  corps().querySelector('[data-rv="plus"]').click();
  corps().querySelector('[data-rv="plus"]').click();
  assert.equal(corps().querySelector("#rvNombre").value, "2");
  v.dom.touche(corps().querySelector("#rvNombre"), "Enter");
  // Q7 revenus ; Q8 matelas (pré-rempli) ; Q9 part investie ; Q10 âge (pré-rempli)
  v.dom.touche(v.doc.activeElement, "2"); v.dom.touche(v.doc.activeElement, "Enter");
  assert.match(corps().textContent, /Pré-rempli d'après votre bilan/);
  v.dom.touche(v.doc.activeElement, "Enter");
  v.dom.touche(v.doc.activeElement, "4"); v.dom.touche(v.doc.activeElement, "Enter");
  assert.match(corps().textContent, /Question 10 sur 10/);
  assert.match(corps().querySelector('[data-rv="suivant"]').textContent, /Voir le résumé/);
  v.dom.touche(v.doc.activeElement, "Enter");
  // Résumé
  assert.match(corps().textContent, /Vérifiez vos réponses/);
  assert.match(corps().textContent, /Profil obtenu/);
  assert.match(corps().textContent, /8 à 15 ans/);
  assert.equal(corps().querySelectorAll('[data-rv="aller"]').length, 10);
  assert.equal(v.ecrits.length, 0, "rien n'est enregistré avant la confirmation");
  // Modifier une réponse depuis le résumé, puis revenir
  corps().querySelector('[data-rv="aller"]').click();
  assert.match(corps().textContent, /Question 1 sur 10/);
  for (let i = 0; i < 10; i++) v.dom.touche(corps().querySelector("#rvQ") || v.doc.activeElement, "Enter");
  assert.match(corps().textContent, /Vérifiez vos réponses/);
  corps().querySelector('[data-rv="enregistrer"]').click();
  await attendre(); await attendre();
  assert.equal(v.ecrits.length, 1);
  const r = v.ecrits[0].risque;
  assert.equal(Object.keys(r).sort().join(), "date,profil,reponses,score");
  assert.equal(r.reponses.horizon, "8-15");
  assert.equal(JSON.stringify(r.reponses.connaissances), JSON.stringify(["etf", "actions"]));
  assert.equal(r.reponses.experience, 2);
  const attendu = Risque.evaluer(r.reponses, {});
  assert.equal(r.profil, attendu.profil);
  assert.equal(r.score, attendu.score);
  assert.equal(dlg().hidden, true, "panneau fermé après l'enregistrement");
  assert.equal(v.doc.activeElement.getAttribute("id"), "rvVerdict", "focus sur le verdict");
  assert.equal(v.stock.has("risque-brouillon"), false, "brouillon effacé");
  // Le store émet le profil enregistré : page de résultat
  v.api.update(v.S(), true);
  assert.match(v.root.querySelector("#rvVerdict").textContent, /portefeuille se comporte comme un profil/);
  assert.ok(v.root.querySelector('[data-ui-carte="declare"]'));
  assert.ok(v.root.querySelector('[data-ui-carte="perte"]'));
  assert.ok(v.root.querySelector(".rv-alloc"), "barres d'allocation");
  assert.notEqual(v.api.headline(), "À définir");
});

test("vue (DOM) : Échap ferme le questionnaire sans perdre les réponses ; Reprendre repart de la première question sans réponse", () => {
  const v = vueRisque(demoS());
  const corps = () => v.doc.body.querySelector(".ui-panneau-corps");
  const start = v.root.querySelector('[data-rv="start"]');
  start.focus(); start.click();
  v.dom.touche(v.doc.activeElement, "5"); v.dom.touche(v.doc.activeElement, "Enter");
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.body.querySelector('[role="dialog"]').hidden, true);
  assert.equal(v.doc.activeElement, start, "focus rendu au bouton");
  assert.match(v.stock.get("risque-brouillon"), /"horizon":"gt15"/);
  v.api.update(v.S(), true); // le store émet : la page affiche « Reprendre »
  const rep = v.root.querySelector('[data-rv="start"]');
  assert.match(rep.textContent, /Reprendre le questionnaire \(\d+ \/ 10\)/);
  rep.click();
  assert.match(corps().textContent, /Question 2 sur 10/);
});

test("vue (DOM) : profil enregistré — cartes → panneaux (profil, risque réel), Refaire depuis le panneau, échappement ; échec d'écriture signalé", async () => {
  const rq = { reponses: { horizon: "8-15", objectif: "croissance", reaction: "rien", perte_max: "p20", connaissances: ["etf", "actions"], experience: 5, revenus: "cdi", matelas: "oui", part_investie: "50-75", age: "a30" } };
  const ev = Risque.evaluer(rq.reponses, {});
  const S0 = Object.assign(demoS(), { risque: Object.assign(rq, { profil: ev.profil, score: ev.score, date: "2026-10-01" }) });
  S0.positions[0].bloc = "<img src=x onerror=alert(1)>";
  const v = vueRisque(S0, { echec: true });
  assert.doesNotMatch(v.root.querySelector("#rvClassesBody").innerHTML, /<img/);
  assert.match(v.root.querySelector("#rvClassesBody").innerHTML, /&lt;img/);
  const c = v.root.querySelector('[data-ui-carte="declare"]');
  c.focus(); c.click();
  const corps = () => v.doc.body.querySelector(".ui-panneau-corps");
  assert.match(v.doc.body.querySelector(".ui-panneau-titre").textContent, /^Profil /);
  assert.match(corps().innerHTML, /Vos réponses/);
  assert.match(corps().textContent, /1er octobre 2026|1 octobre 2026/);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.activeElement, c);
  const p = v.root.querySelector('[data-ui-carte="perte"]');
  p.click();
  assert.match(v.doc.body.querySelector(".ui-panneau-titre").textContent, /Risque réel du portefeuille/);
  assert.match(corps().textContent, /Dans une mauvaise année/);
  v.dom.touche(v.doc.activeElement, "Escape");
  // Refaire depuis le panneau du profil : questionnaire prérempli avec les réponses enregistrées
  v.root.querySelector('[data-ui-carte="declare"]').click();
  corps().querySelector('[data-rv="refaire"]').click();
  assert.match(corps().textContent, /Question 1 sur 10/);
  assert.equal(corps().querySelector('[data-opt="8-15"]').getAttribute("aria-checked"), "true");
  for (let i = 0; i < 10; i++) v.dom.touche(corps().querySelector("#rvQ") || v.doc.activeElement, "Enter");
  assert.match(corps().textContent, /Vérifiez vos réponses/);
  corps().querySelector('[data-rv="enregistrer"]').click();
  await attendre(); await attendre();
  assert.match(corps().textContent, /Enregistrement impossible : réseau coupé\. Vos réponses sont gardées/);
  assert.equal(v.doc.body.querySelector('[role="dialog"]').hidden, false, "le panneau reste ouvert");
});
