// Pilotage › Risque (web/src/risque-view.*) : lecture seule — verdict, profil validé, allocation cible vs réelle, risque réel et
// rattachement des poches ; le questionnaire se fait dans Claude (« Faire mon profil de risque avec Claude »). Contrôles statiques,
// fonctions pures (module.exports) et vue dans un mini-DOM.
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
  assert.doesNotMatch(js, /addEventListener\("keydown"/, "plus de questionnaire au clavier dans l'app");
});

const sansCommentaires = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const VOUVOIEMENT = /\b(vous|votre|vos|Vous|Votre|Vos)\b|\b(complétez|indiquez|ouvrez|répondez|renseignez|corrigez|vérifiez|choisissez|cochez)\b/i;
const chainesJs = src => [...sansCommentaires(src).matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map(m => m[1] ?? m[2] ?? m[3]);

test("risque-view.js : calcule avec Risque.synthese, en lecture seule (aucune écriture au store, plus de questionnaire)", () => {
  assert.match(js, /R\(\)\.synthese\(rq\?rq\.reponses\|\|\{\}:\{\},ctx\(avecImmo\)\)/);
  assert.match(js, /R\(\)\.ecarts\(decl\.id,sa\.allocation\)/, "écarts rapportés au profil enregistré");
  assert.match(js, /M_\.classeRisque/);
  assert.match(js, /verdict\(\{declare:decl,equivalent:eq,ecarts:decl\?sa\.ecarts:\[\]\},R\(\)\.PROFILS\)/, "comparaison rapportée au profil enregistré");
  const code = sansCommentaires(js);
  assert.doesNotMatch(code, /Store\.|\.db\.|\.update\(\{|\.insert\(|\.upsert\(/, "aucune écriture au store");
  assert.doesNotMatch(code, /localStorage|risque-brouillon|enregistrer|etapeHtml|data-opt|<select|<input|<form/, "questionnaire, brouillon et sélecteurs de classe retirés");
  assert.doesNotMatch(html, /<select|<input|<form/);
});

test("risque-view : textes clés et liens Claude (faire, revoir, corriger), au tutoiement", () => {
  for (const t of ["Mon portefeuille correspond-il à mon profil ?", "Faire mon profil de risque avec Claude", "Le revoir avec Claude", "Corriger avec Claude",
    "Agent › À valider", "Plafonné à ", "Dans une mauvaise année (1 sur 100), ton portefeuille pourrait perdre environ", "Compter mon immobilier",
    "Protection", "fonds euros et or", "D'où vient le risque", "Comment c'est calculé", "Allocation par classe", "Perte plausible sur un an",
    "Comportement du portefeuille", "Profil déclaré", "Tes réponses validées"])
    assert.ok(js.includes(t) || html.includes(t), `« ${t} » absent`);
  assert.match(js, /phraseRisque\("risque"\)/, "section risque de ClaudePrompts");
  assert.ok(html.includes("Le classement de tes poches"));
  assert.match(html, /<details class="ui-acc rv-classes" id="rvClasses">/, "classement des poches en accordéon fermé");
  assert.ok(html.includes("Indicateur pédagogique, pas un conseil en investissement"));
  assert.match(js, /function headline\(\)\{ const id=S\.risque&&S\.risque\.profil; return id\?labelProfil\(id\):"À définir"; \}/);
  assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), VOUVOIEMENT, "risque-view.html");
  assert.deepEqual(chainesJs(js).filter(t => VOUVOIEMENT.test(t)), [], "risque-view.js (hors textes de risque.js : questions, descriptions des profils, garde-fous)");
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
  assert.ok(tous.some(x => x.startsWith(".ui-panneau .rv-gauge") || x.startsWith(".ui-panneau .rv-g")), "panneau du profil stylé");
  assert.ok(!tous.some(x => /rv-quiz|rv-opt|rvNombre/.test(x)), "styles du questionnaire retirés");
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

test("valide : réponses par type de question", () => {
  assert.equal(V.valide(Q("horizon"), "gt15"), true);
  assert.equal(V.valide(Q("horizon"), "x"), false);
  assert.equal(V.valide(Q("experience"), 0), true);
  assert.equal(V.valide(Q("experience"), -1), false);
  assert.equal(V.valide(Q("connaissances"), []), false);
  assert.equal(V.valide(Q("connaissances"), ["etf"]), true);
  assert.equal(V.basculer, undefined, "questionnaire retiré de l'app");
  assert.equal(V.etape, undefined);
});

test("phraseRisque : phrases ClaudePrompts (risque, placements)", () => {
  const P = require("../web/src/claude-prompts.js");
  assert.equal(V.phraseRisque("risque"), P.phrase("risque"));
  assert.equal(V.phraseRisque("risque", "revoir mon profil Équilibré"), P.phrase("risque", "revoir mon profil Équilibré"));
  assert.match(V.phraseRisque("placements", "x"), /placements/);
});

test("geometrie : bande cible et barre réelle bornées à 0-100 %", () => {
  assert.deepEqual(V.geometrie(45, 60, 43.7), { bandeGauche: 45, bandeLargeur: 15, reel: 43.7 });
  assert.deepEqual(V.geometrie(0, 0, 2.7), { bandeGauche: 0, bandeLargeur: 0, reel: 2.7 });
  assert.deepEqual(V.geometrie(75, 95, 140), { bandeGauche: 75, bandeLargeur: 20, reel: 100 });
  assert.deepEqual(V.geometrie(60, 40, -3), { bandeGauche: 40, bandeLargeur: 20, reel: 0 }, "bornes inversées et réel négatif");
});

test("fpct : pourcentages à la française", () => {
  assert.equal(V.fpct(43.707), "43,7\u00a0%");
  assert.equal(V.fpct(-18.27, 0), "−18\u00a0%");
  assert.equal(V.fpct(20), "20\u00a0%");
  assert.equal(V.fpct(-0.01, 0), "0\u00a0%");
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
  assert.equal(ok.phrase, "Oui : ton portefeuille se comporte comme un profil Équilibré, conforme à ton profil.");
  assert.equal(ok.allocation, "2 classes sur 5 hors de la fourchette du profil Équilibré.");
  const plus = V.verdict({ declare: P("modere"), equivalent: P("dynamique"), ecarts: [{ statut: "dans" }] }, Risque.PROFILS);
  assert.equal(plus.ton, "crit");
  assert.equal(plus.ecart, 2);
  assert.match(plus.phrase, /^Non : .*profil Dynamique, alors que ton profil est Modéré ; il prend plus de risque que tu ne le souhaites\.$/);
  assert.equal(plus.allocation, "Chaque classe est dans la fourchette du profil Modéré.");
  const moins = V.verdict({ declare: P("dynamique"), equivalent: P("prudent"), ecarts: [] }, Risque.PROFILS);
  assert.equal(moins.ton, "warn");
  assert.match(moins.phrase, /^Pas tout à fait : .*moins de risque que ton profil ne le permet\.$/);
  assert.match(V.verdict({ declare: null, equivalent: P("prudent") }, Risque.PROFILS).phrase, /pas encore défini/);
  assert.match(V.verdict({ declare: P("prudent"), equivalent: null }, Risque.PROFILS).phrase, /^Aucun placement à comparer à ton profil Prudent/);
});

test("libelleReponse, resume : réponses validées lisibles, prérempli signalé, manque repéré", () => {
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
  for (const f of ["format.js", "calc.js", "plan.js", "marche.js", "risque.js", "ui.js", "claude-prompts.js"]) vm.runInContext(read("web/src/" + f), ctx, { filename: f });
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

const profilEnregistre = () => {
  const rq = { reponses: { horizon: "8-15", objectif: "croissance", reaction: "rien", perte_max: "p20", connaissances: ["etf", "actions"], experience: 5, revenus: "cdi", matelas: "oui", part_investie: "50-75", age: "a30" } };
  const ev = Risque.evaluer(rq.reponses, {});
  return Object.assign(rq, { profil: ev.profil, score: ev.score, date: "2026-10-01" });
};

test("vue (DOM) : sans profil, « Faire mon profil de risque avec Claude » (section risque), aucun questionnaire ni écriture", () => {
  const v = vueRisque(demoS());
  const P = require("../web/src/claude-prompts.js");
  assert.match(v.root.querySelector("#rvVerdict").textContent, /pas encore défini/);
  assert.equal(v.api.headline(), "À définir");
  const lien = v.root.querySelector(".rv-hero").querySelector(".ui-claude");
  assert.ok(lien, "lien vers Claude");
  assert.match(lien.textContent, /Faire mon profil de risque avec Claude/);
  assert.equal(lien.getAttribute("href"), "https://claude.ai/new?q=" + encodeURIComponent(P.phrase("risque")));
  assert.equal(v.root.querySelector("[data-rv]"), null, "plus de bouton de questionnaire");
  assert.equal(v.root.querySelector("select"), null);
  assert.equal(v.ecrits.length, 0);
  assert.equal(v.stock.size, 0, "plus de brouillon");
});

test("vue (DOM) : profil enregistré — cartes → panneaux (profil validé en lecture, risque réel), « Le revoir avec Claude », échappement, focus", () => {
  const S0 = Object.assign(demoS(), { risque: profilEnregistre() });
  S0.positions[0].bloc = "<img src=x onerror=alert(1)>";
  const v = vueRisque(S0);
  assert.match(v.root.querySelector("#rvVerdict").textContent, /portefeuille se comporte comme un profil/);
  const hero = v.root.querySelector(".rv-hero");
  assert.equal(hero.querySelector(".ui-claude"), null, "aucun bouton Claude dans la réponse : l'en-tête de la page porte la demande");
  assert.match(hero.querySelector(".ui-puce").textContent, /ton profil$/, "écart en chip avec libellé");
  assert.equal(v.root.querySelector("#rvMain").querySelectorAll(".ui-claude").length, 0, "aucun bouton Claude dans le contenu de la page quand le profil existe");
  assert.ok(v.root.querySelector(".rv-alloc"), "barres d'allocation");
  assert.notEqual(v.api.headline(), "À définir");
  const classes = v.root.querySelector("#rvClassesBody");
  assert.doesNotMatch(classes.innerHTML, /<img/);
  assert.match(classes.innerHTML, /&lt;img/);
  assert.match(classes.textContent, /Corriger avec Claude/);
  assert.equal(classes.querySelector("select"), null, "classement en lecture seule");
  const c = v.root.querySelector('[data-ui-carte="declare"]');
  c.focus(); c.click();
  const corps = () => v.doc.body.querySelector(".ui-panneau-corps");
  assert.match(v.doc.body.querySelector(".ui-panneau-titre").textContent, /^Profil /);
  assert.match(corps().innerHTML, /Tes réponses validées/);
  assert.match(corps().textContent, /8 à 15 ans/);
  assert.match(corps().textContent, /1er octobre 2026|1 octobre 2026|1 oct\. 2026/);
  assert.match(corps().textContent, /Le revoir avec Claude/);
  assert.equal(corps().querySelector("button[data-rv]"), null, "plus de « Refaire le questionnaire »");
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.activeElement, c);
  const p = v.root.querySelector('[data-ui-carte="perte"]');
  p.focus(); p.click();
  assert.match(v.doc.body.querySelector(".ui-panneau-titre").textContent, /Risque réel du portefeuille/);
  assert.match(corps().textContent, /Dans une mauvaise année/);
  // la carte d'origine disparaît pendant l'ouverture : le focus revient au verdict
  v.root.querySelector(".rv-cartes").innerHTML = "";
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.activeElement.getAttribute("id"), "rvVerdict");
  assert.equal(v.ecrits.length, 0, "aucune écriture");
});

test("vue (DOM) : accordéons « D'où vient le risque » et « Comment c'est calculé » gardés ouverts à travers les réécritures ; contributions en 5 puis Voir plus", () => {
  const S0 = Object.assign(demoS(), { risque: profilEnregistre() });
  const v = vueRisque(S0);
  const acc = k => v.root.querySelector('[data-rv-acc="' + k + '"]');
  for (const k of ["contributions", "methode"]) {
    assert.equal(acc(k).hasAttribute("open"), false, k + " fermé par défaut");
    acc(k).setAttribute("open", "");
    acc(k).dispatchEvent(new v.dom.Ev("toggle"));
  }
  const avant = acc("contributions");
  v.api.update(v.S(), true); // même état : rien n'est réécrit
  assert.equal(acc("contributions"), avant, "pas de réécriture inutile");
  // le périmètre change : la page est réécrite, les accordéons restent ouverts
  v.api.update(Object.assign({}, v.S(), { scope: "p1" }), true);
  assert.notEqual(acc("contributions"), avant, "page réécrite");
  assert.ok(acc("contributions").hasAttribute("open"));
  assert.ok(acc("methode").hasAttribute("open"));
  // refermer : l'état fermé est retenu lui aussi
  acc("methode").removeAttribute("open"); acc("methode").dispatchEvent(new v.dom.Ev("toggle"));
  v.api.update(Object.assign({}, v.S(), { scope: "foyer" }), true);
  assert.equal(acc("methode").hasAttribute("open"), false);
  // « Voir plus » après 5 classes, si plus de 5 contributions
  const lignes = acc("contributions").querySelectorAll(".rv-crow");
  const btn = acc("contributions").querySelector("[data-ui-voirplus]");
  if (lignes.length > 5) {
    assert.ok(btn, "bouton Voir plus");
    assert.equal(acc("contributions").querySelector(".ui-voirplus-liste").querySelectorAll(".rv-crow").length, 5);
    btn.click();
    assert.equal(btn.getAttribute("aria-expanded"), "true");
  } else assert.equal(btn, null);
});

test("vue (DOM) : plus de 5 contributions → 5 puis Voir plus (le reste caché)", () => {
  const S0 = Object.assign(demoS(), { risque: profilEnregistre() });
  // portefeuille varié : une ligne par classe
  const base = S0.positions[0];
  const blocs = ["Actions monde", "Small caps", "Émergents", "Obligations", "Fonds euros", "Monétaire", "SCPI", "Or", "Crypto"];
  S0.positions = blocs.map((b, i) => Object.assign({}, base, { id: "x" + i, bloc: b, nom: b, valeur: 10000 + i * 1000, qty: 1, prix: 10000 + i * 1000 }));
  const v = vueRisque(S0);
  const bloc = v.root.querySelector('[data-rv-acc="contributions"]');
  const n = bloc.querySelectorAll(".rv-crow").length;
  assert.ok(n > 5, "portefeuille de test : plus de 5 classes");
  assert.equal(bloc.querySelector(".ui-voirplus-liste").querySelectorAll(".rv-crow").length, 5, "5 d'abord");
  const reste = bloc.querySelector(".ui-voirplus-reste");
  assert.ok(reste && reste.hidden, "au-delà de 5 : bloc caché");
  assert.equal(bloc.querySelector("[data-ui-voirplus]").textContent, "Voir plus (" + (n - 5) + ")");
});

test("vue (DOM) : classement des poches — chaque ligne mène à sa fiche de Patrimoine › Comptes (même adresse qu'App.ouvrir)", () => {
  const v = vueRisque(Object.assign(demoS(), { risque: profilEnregistre() }));
  const classes = v.root.querySelector("#rvClassesBody");
  const liens = [...classes.querySelectorAll("a[data-goto]")].filter(a => /^patrimoine\/comptes\?ligne=/.test(a.getAttribute("data-goto")));
  assert.ok(liens.length >= 5, "lignes en lien");
  const a = liens.find(x => x.textContent === "ETF MSCI World");
  assert.ok(a);
  assert.equal(a.getAttribute("href"), "#patrimoine/comptes?ligne=pea-etf-monde");
  assert.equal(a.getAttribute("data-goto"), "patrimoine/comptes?ligne=pea-etf-monde");
  const CV = require("../web/src/comptes-view.js");
  assert.equal(a.getAttribute("data-goto"), CV.lien({ ligne: "pea-etf-monde" }));
});
