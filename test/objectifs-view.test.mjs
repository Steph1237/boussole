// Patrimoine › Objectifs (module objectifs-view, web/src/objectifs-view.*) : « Vais-je atteindre mes projets ? », en lecture seule.
// Verdict en tête, une carte par objectif (échéance, progression, statut, effort mensuel requis) → panneau (détail, rendement et
// repère Livret A, poches rattachées, projection de l'objectif, « Corriger avec Claude »), « Compléter avec Claude » en tête,
// projection du patrimoine financier en accordéon (paramètre « scénario » local, jamais enregistré). Aucune écriture, tutoiement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/objectifs-view.js", "utf8");
const css = readFileSync("web/src/objectifs-view.css", "utf8");
const html = readFileSync("web/src/objectifs-view.html", "utf8");
const OV = require("../web/src/objectifs-view.js");
const UI = require("../web/src/ui.js");
const Plan = require("../web/src/plan.js");
const Calc = require("../web/src/calc.js");
const Reperes = require("../web/src/reperes.js");
const ClaudePrompts = require("../web/src/claude-prompts.js");
const DEMO = require("../web/src/demo-data.js");

const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ").replace(/&#39;/g, "'");
const P = (s, c) => sp(ClaudePrompts.phrase(s, c));
const DEPS = { Plan, Calc };
const PEOPLE = [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }];
const TODAY = "2026-10-11";
const demoS = () => Object.assign(J(DEMO), { ready: true, dbOk: true, scope: "foyer", people: PEOPLE, error: null });
const questions = h => [...String(h).matchAll(/href="https:\/\/claude\.ai\/new\?q=([^"]*)"/g)].map(m => sp(decodeURIComponent(m[1].replace(/&amp;/g, "&"))));
/* Tutoiement : aucun « vous / votre / vos » ; les textes venant du moteur (plan.js) sont listés en exception (aucun affiché ici). */
const EXCEPTIONS_MOTEUR = [];
const VOUVOIEMENT = /\b(vous|votre|vos)\b/i;
const sansExceptions = t => EXCEPTIONS_MOTEUR.reduce((a, e) => a.split(e).join(""), String(t));
/* Sept objectifs (plus de 5 : « Voir plus ») à partir de la démo. */
const septObjectifs = () => {
  const S = demoS();
  for (let i = 4; i <= 7; i++) S.objectifs.push({ id: "obj-p" + i, nom: "Projet " + i, type: "projet", cible: 3000 * i, dateCible: (2027 + i) + "-06-30", source: "saisi", deja: 100 * i, rendement: 2, priorite: i });
  return S;
};

/* ------------------------------------------------------------------ structure ------------------------------------------------------------------ */
test("objectifs-view.js : se compile, s'enregistre sous « objectifs-view », exporte ses fonctions pures", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "objectifs-view.js" }));
  assert.match(js, /App\.register\("objectifs-view", api\)/);
  assert.match(js, /__pending/);
  for (const f of ["trier", "analyser", "resumeObjectifs", "carteHtml", "detailHtml", "serieObjectif", "livretA", "versementReel", "projectionSvg", "projectionTableHtml", "hypothesesHtml", "boutonClaude"])
    assert.equal(typeof OV[f], "function", f);
  for (const f of ["formHtml", "modele", "validerObjectif", "ligneObjectif", "deplacer"]) assert.equal(OV[f], undefined, f + " : plus de saisie dans l'app");
});

test("objectifs-view.js : calculs de plan.js (cascade des poches, statut, répartition de l'épargne, projection) ; aucune écriture au store", () => {
  assert.match(js, /\.affecterDeja\(/);
  assert.match(js, /statutObjectif\([^)]*deja:/);
  assert.match(js, /repartirEpargne\(/);
  assert.match(js, /\.projection\(/);
  assert.doesNotMatch(js, /Store\.db|\.db\b/, "aucun accès à Store.db");
  assert.doesNotMatch(js, /\.upsert\(|\.delete\(|\.set\(\s*\{|collection\(|doc\("objectifs/, "aucune écriture");
  assert.doesNotMatch(js, /doc\("budget\/main"\)/);
});

test("objectifs-view : lecture seule — plus de formulaire, de modèles, de priorité monter / descendre ni de suppression", () => {
  for (const src of [js, html]) {
    assert.doesNotMatch(src, /<form|<textarea|<select|<dialog|type="checkbox"|type="date"/);
    assert.doesNotMatch(src, /Ajouter un objectif|data-ov-modele|data-ov-act|ovAjouter|ov-bascule|Monter|Descendre|Supprimer|Modifier/);
  }
  // seul champ restant : le versement de la projection, paramètre d'exploration du simulateur
  assert.deepEqual([...html.matchAll(/<input[^>]*id="([^"]+)"/g)].map(m => m[1]), ["ovVers"]);
  assert.equal((js.match(/<input/g) || []).length, 0);
  assert.match(js, /ClaudePrompts/);
  assert.match(js, /"Compléter avec Claude"/);
  assert.match(js, /"Corriger avec Claude"/);
});

test("objectifs-view.js : le repère Livret A est lu dans les repères (aucun taux codé en dur)", () => {
  assert.doesNotMatch(js, /Livret A 2,4/);
  assert.match(js, /\.trouver\([^)]*"livret_a_taux"\)/);
  assert.match(js, /\.format\(/);
  assert.match(js, /dateEffet/);
  assert.match(js, /taux réglementé en vigueur/);
});

test("objectifs-view.js : aucune requête DOM globale hors racine du module", () => {
  const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
  assert.deepEqual(bad, []);
});

test("objectifs-view.css : scopé sous #view-objectifs-view (panneau sous .ui-panneau .ov-…), mobile, couleurs du thème, styles de saisie retirés", () => {
  const c0 = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const badMedia = [...c0.matchAll(/@media/g)].filter(m => !/(^|\})\s*$/.test(c0.slice(0, m.index)));
  assert.deepEqual(badMedia.map(m => m.index), []);
  const c = c0.replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(sels.length > 20);
  const bad = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !/^#view-objectifs-view\b/.test(x) && !/^\.ui-panneau \.ov-/.test(x));
  assert.deepEqual(bad, []);
  assert.match(css, /@media \(max-width:\s*\d+px\)/);
  assert.doesNotMatch(css.replace(/rgba\([^)]*\)/g, ""), /#[0-9a-fA-F]{3,6}\b(?![-\w])/);
  assert.doesNotMatch(css, /ov-bascule|ov-form|ov-modele|ov-confirm|ov-chk/);
});

test("objectifs-view.html : identifiants utilisés par le script, question, « Compléter avec Claude », projection en accordéon fermé", () => {
  const ids = [...js.matchAll(/\$\("(ov[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 8);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
  assert.match(html, /<h2 id="ovTitre">Objectifs<\/h2>/);
  assert.match(html, /<details class="ui-acc ov-proj" id="ovProjAcc">/);
  assert.match(html, /Projection du patrimoine financier/);
  assert.doesNotMatch(html, /id="ovCompleter"|id="ovClaude"/, "plus de boutons Claude empilés : celui de l'en-tête couvre la page");
});

test("objectifs-view : tutoiement — aucun « vous / votre / vos » dans les textes du module (hors textes du moteur listés)", () => {
  assert.doesNotMatch(sansExceptions(js), VOUVOIEMENT);
  assert.doesNotMatch(sansExceptions(html), VOUVOIEMENT);
});

/* ------------------------------------------------------------------ fonctions pures ------------------------------------------------------------------ */
test("trier : priorité croissante, puis échéance la plus proche, sans priorité à la fin", () => {
  const xs = [{ id: "a", priorite: 2 }, { id: "b", dateCible: "2027-01-01" }, { id: "c", priorite: 1 }, { id: "d", dateCible: "2026-12-01" }];
  assert.deepEqual(OV.trier(xs).map(o => o.id), ["c", "a", "d", "b"]);
  assert.deepEqual(OV.trier(null), []);
});

test("analyser : cascade des poches (Plan.affecterDeja), épargne répartie par priorité, statut de chaque objectif (démo)", () => {
  const S = demoS();
  const a = OV.analyser(S, DEPS, TODAY);
  assert.deepEqual(a.liste.map(x => x.o.id), ["obj-matelas", "obj-apport", "obj-retraite"]);
  const deja = Plan.affecterDeja(OV.trier(S.objectifs), S.positions, "foyer");
  a.liste.forEach(x => assert.equal(x.st.deja, deja[x.o.id], x.o.id));
  const t = Plan.budgetTotaux(S.budget.lignes, S.profil, "foyer");
  assert.equal(a.capacite, Plan.capaciteEpargne(t));
  const alloue = a.liste.reduce((s, x) => s + x.st.versementAlloue, 0);
  assert.ok(Math.abs(alloue - a.capacite) < 0.01, "toute la capacité d'épargne est répartie");
  for (const x of a.liste) assert.ok(["atteint", "avance", "dans_les_temps", "retard", "hors_portee"].includes(x.st.statut));
  const ap = a.liste.find(x => x.o.id === "obj-apport");
  assert.ok(ap.brut >= ap.st.deja, "brut : tout ce que contiennent les poches, avant la cascade");
  assert.deepEqual(a.liste.map(x => x.rang), [1, 2, 3]);
  assert.deepEqual(OV.analyser(Object.assign(demoS(), { objectifs: [] }), DEPS, TODAY).liste, []);
});

test("resumeObjectifs : verdict en une phrase (tutoiement), compte par statut, ton", () => {
  const st = s => ({ o: { id: s }, st: { statut: s } });
  const ok = OV.resumeObjectifs([st("avance"), st("dans_les_temps"), st("atteint")]);
  assert.equal(ok.n, 3); assert.equal(ok.ton, "bon");
  assert.match(ok.verdict, /Tes 3 objectifs sont en bonne voie/);
  const ko = OV.resumeObjectifs([st("avance"), st("retard"), st("hors_portee")]);
  assert.equal(ko.ton, "critique");
  assert.match(ko.verdict, /2 objectifs sur 3 demandent ton attention/);
  assert.match(ko.detail, /1 en avance · 1 en retard · 1 hors de portée/);
  const un = OV.resumeObjectifs([st("retard")]);
  assert.equal(un.ton, "attention");
  assert.match(un.verdict, /Ton objectif est en retard/);
  assert.match(OV.resumeObjectifs([st("avance")]).verdict, /Ton objectif est en bonne voie/);
  assert.match(OV.resumeObjectifs([]).verdict, /Aucun objectif/);
});

test("carteHtml : bouton-carte (nom, échéance, progression, statut, effort requis), tout échappé", () => {
  const a = OV.analyser(demoS(), DEPS, TODAY);
  const x = a.liste[0];
  const h = sp(OV.carteHtml(x, a.liste.length));
  assert.match(h, /^<button type="button" class="ui-carte ov-carte st-[a-z]+" data-ui-carte="obj-matelas" aria-haspopup="dialog">/);
  assert.match(h, /Matelas de précaution/);
  assert.match(h, /juin 2027/);
  assert.match(h, /21 100 €/);
  assert.match(h, /class="ov-barre" aria-hidden="true"><i style="width:\d+(\.\d)?%"><\/i>/);
  assert.match(h, /\d+ % de la cible/);
  assert.match(h, /ui-badge/);
  assert.match(h, /Effort requis/);
  assert.match(h, /Priorité 1/);
  const evil = Object.assign({}, x, { o: Object.assign({}, x.o, { nom: "<img src=x onerror=alert(1)>", id: 'a"b' }) });
  const e = OV.carteHtml(evil, 3);
  assert.doesNotMatch(e, /<img src=x/);
  assert.match(e, /data-ui-carte="a&quot;b"/);
});

test("detailHtml : détail chiffré, rendement et repère Livret A, poches et cascade, projection, « Corriger avec Claude », aucune action d'écriture", () => {
  const S = demoS();
  const a = OV.analyser(S, DEPS, TODAY);
  const ap = a.liste.find(x => x.o.id === "obj-apport");
  const ctx = { positions: S.positions, scope: "foyer", Calc, Plan, today: TODAY, n: 3, duScope: "du foyer", livretA: OV.livretA(S, Reperes), U: UI };
  const h = sp(OV.detailHtml(ap, ctx));
  assert.match(h, /Cible/); assert.match(h, /60 000 €/);
  assert.match(h, /Déjà de côté/);
  assert.match(h, /Effort requis/);
  assert.match(h, /Ton épargne actuelle en couvre/);
  assert.match(h, /Rendement attendu/); assert.match(h, /2,4 %\/an/);
  assert.match(h, /repère : Livret A 1,7 % depuis le 01\/08\/2026/);
  assert.match(h, /role="progressbar"/);
  assert.match(h, /Poches rattachées/);
  assert.match(h, /Épargne/);
  assert.match(h, /servent d'abord un objectif prioritaire/);
  assert.match(h, /Projection de l'objectif/);
  assert.match(h, /<svg[^>]*role="img"/);
  assert.doesNotMatch(h, /data-ov-act|<form|<input|Supprimer|Monter|Descendre/);
  assert.match(h, />Corriger avec Claude</);
  assert.deepEqual(questions(h), [P("objectifs", "l'objectif « Apport maison » (60 000 € d'ici juin 2029, priorité 2 sur 3)")]);
  assert.match(h, /Agent › Propositions/);
  const saisi = { o: { id: "s", nom: "Voyage <Japon>", type: "projet", cible: 5000, dateCible: "2027-08-31", source: "saisi", deja: 1000, rendement: 0, priorite: 4 },
    st: Plan.statutObjectif({ cible: 5000, dateCible: "2027-08-31", rendement: 0 }, { deja: 1000, versementAlloue: 0, today: TODAY }), brut: 1000, rang: 4 };
  const hs = sp(OV.detailHtml(saisi, ctx));
  assert.match(hs, /Montant saisi/);
  assert.match(hs, /passe par Claude/);
  assert.doesNotMatch(hs, /<Japon>/);
  assert.match(hs, /Aucune épargne n'y est affectée/);
  const sansPoche = sp(OV.detailHtml(Object.assign({}, ap, { o: Object.assign({}, ap.o, { poches: [], enveloppes: [] }) }), ctx));
  assert.match(sansPoche, /demande à Claude d'en rattacher une/);
  const sansRepere = sp(OV.detailHtml(ap, Object.assign({}, ctx, { livretA: null })));
  assert.match(sansRepere, /Livret A taux réglementé en vigueur/);
});

test("serieObjectif : part du déjà, suit le rythme actuel et l'effort requis jusqu'à l'échéance", () => {
  const o = { cible: 12000, dateCible: "2028-10-31", rendement: 2 };
  const st = Plan.statutObjectif(o, { deja: 2000, versementAlloue: 200, today: TODAY });
  const s = OV.serieObjectif(o, st, TODAY, Plan);
  assert.equal(s.points[0].mois, 0);
  assert.equal(s.points[0].actuel, 2000);
  assert.equal(s.points[s.points.length - 1].mois, st.mois);
  for (let i = 1; i < s.points.length; i++) assert.ok(s.points[i].actuel >= s.points[i - 1].actuel);
  assert.ok(Math.abs(s.points[s.points.length - 1].requis - 12000) < 1, "avec l'effort requis, la cible est atteinte à l'échéance");
  assert.ok(s.points.length <= 26);
  const sansDate = OV.serieObjectif({ cible: 1000, rendement: 0 }, Plan.statutObjectif({ cible: 1000, rendement: 0 }, { deja: 0, versementAlloue: 100, today: TODAY }), TODAY, Plan);
  assert.equal(sansDate.points.every(p => p.requis == null), true);
  assert.ok(sansDate.mois >= 10);
});

test("livretA : taux et date d'effet lus dans les repères ; sans repère, formule générique", () => {
  const S = demoS();
  assert.equal(sp(OV.livretA(S, Reperes)), "1,7 % depuis le 01/08/2026");
  assert.equal(OV.livretA(Object.assign({}, S, { savoir: null }), Reperes), "taux réglementé en vigueur");
  assert.equal(OV.livretA(S, null), "taux réglementé en vigueur");
});

test("versementReel : épargne du budget, sinon versements programmés du périmètre, sinon rien", () => {
  const S = demoS();
  const t = Plan.budgetTotaux(S.budget.lignes, S.profil, "foyer");
  assert.deepEqual(OV.versementReel(S, t, "foyer"), { v: 650, src: "d'après l'épargne prévue au budget" });
  const S2 = Object.assign(demoS(), { budget: { lignes: [] }, config: Object.assign(J(DEMO.config), { recurring: [{ positionId: S.positions[0].id, amount: 120 }] }) });
  const r = OV.versementReel(S2, Plan.budgetTotaux([], S2.profil, "foyer"), "foyer");
  assert.equal(r.v, 120);
  assert.match(r.src, /tes versements programmés/);
  assert.equal(OV.versementReel(Object.assign(demoS(), { budget: { lignes: [] }, config: {} }), Plan.budgetTotaux([], null, "foyer"), "foyer"), null);
});

test("projection : courbe (role=img, scénario central), tableau des scénarios, hypothèses par poche", () => {
  const S = demoS();
  const res = Plan.projection({ positions: S.positions, scope: "foyer", versementMensuel: 650, annees: 10 });
  const svg = sp(OV.projectionSvg(res, 10, 2026, 640));
  assert.match(svg, /<svg viewBox="0 0 640 280" role="img" aria-label="Projection sur 10 ans : [^"]+ dans le scénario central/);
  const tab = sp(OV.projectionTableHtml(res, 650, 10, 2026));
  assert.match(tab, /Pessimiste/); assert.match(tab, /Central/); assert.match(tab, /Optimiste/); assert.match(tab, /Dans 10 ans \(2036\)/);
  const hyp = sp(OV.hypothesesHtml(res, Plan.RENDEMENTS));
  assert.match(hyp, /Épargne/);
  assert.match(hyp, /<th>Poche<\/th>/);
});

test("tutoiement des rendus : verdicts, cartes, panneaux", () => {
  const S = septObjectifs();
  const a = OV.analyser(S, DEPS, TODAY);
  const ctx = { positions: S.positions, scope: "p1", Calc, Plan, today: TODAY, n: a.liste.length, duScope: "de Camille", livretA: "x", U: UI };
  const rendus = a.liste.flatMap(x => [OV.carteHtml(x, a.liste.length), OV.detailHtml(x, ctx)]);
  const st = s => ({ o: { id: s }, st: { statut: s } });
  for (const l of [[st("avance")], [st("retard")], [st("avance"), st("atteint")], [st("retard"), st("hors_portee")], []]) rendus.push(OV.resumeObjectifs(l).verdict);
  for (const h of rendus) assert.doesNotMatch(sansExceptions(sp(h).replace(/href="[^"]*"/g, "")), VOUVOIEMENT);
});

/* ------------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------------ */
const uiJs = readFileSync("web/src/ui.js", "utf8");
const planJs = readFileSync("web/src/plan.js", "utf8");
const calcJs = readFileSync("web/src/calc.js", "utf8");
const reperesJs = readFileSync("web/src/reperes.js", "utf8");
const promptsJs = readFileSync("web/src/claude-prompts.js", "utf8");
function vueDom(S0) {
  const dom = miniDom(), { doc } = dom;
  let S = J(S0);
  const acces = [];
  const modules = {};
  const c = { document: doc, console, setTimeout, clearTimeout, CSS: { escape: s => String(s).replace(/["\\]/g, "\\$&") } };
  c.window = c; c.self = c;
  c.App = { register: (n, api) => { modules[n] = api; }, refreshHeadlines() {}, parametres: () => ({}) };
  // Tout accès au store (db, écritures) est consigné : la vue ne doit jamais y toucher.
  c.Store = new Proxy({ get: () => S }, { get: (o, k) => { if (k !== "get") acces.push(String(k)); return o[k]; } });
  vm.createContext(c);
  vm.runInContext(readFileSync("web/src/format.js", "utf8"), c, { filename: "format.js" });
  vm.runInContext(calcJs, c, { filename: "calc.js" });
  vm.runInContext(planJs, c, { filename: "plan.js" });
  vm.runInContext(reperesJs, c, { filename: "reperes.js" });
  vm.runInContext(uiJs, c, { filename: "ui.js" });
  vm.runInContext(promptsJs, c, { filename: "claude-prompts.js" });
  vm.runInContext(js, c, { filename: "objectifs-view.js" });
  // Compteur d'analyses : Plan.affecterDeja est appelé une fois par analyse.
  const compte = { analyses: 0, projections: 0 };
  const aff = c.Plan.affecterDeja, proj = c.Plan.projection;
  c.Plan.affecterDeja = (...xs) => { compte.analyses++; return aff(...xs); };
  c.Plan.projection = (...xs) => { compte.projections++; return proj(...xs); };
  const root = doc.body.appendChild(doc.createElement("section"));
  root.setAttribute("id", "view-objectifs-view");
  root.innerHTML = html;
  const api = modules["objectifs-view"];
  api.mount(root);
  api.update(S, true);
  return { c, dom, doc, root, api, S: () => S, acces, compte };
}
const dlgDe = doc => doc.body.querySelector('[role="dialog"]');
const saisir = (dom, el, v) => { el.value = v; el.dispatchEvent(new dom.Ev("input")); };
const carte = (root, id) => root.querySelector('[data-ui-carte="' + id + '"]');
const ouvrirProj = v => { const acc = v.root.querySelector("#ovProjAcc"); acc.setAttribute("open", ""); acc.dispatchEvent(new v.dom.Ev("toggle")); };

test("vue (DOM) : verdict, une carte par objectif dans l'ordre des priorités, panneau de lecture, Échap rend le focus", () => {
  const v = vueDom(demoS());
  assert.match(sp(v.root.querySelector("#ovVerdict").textContent), /objectif/);
  const cartes = v.root.querySelector("#ovCartes").querySelectorAll("[data-ui-carte]");
  assert.deepEqual(cartes.map(x => x.getAttribute("data-ui-carte")), ["obj-matelas", "obj-apport", "obj-retraite"]);
  assert.equal(v.root.querySelectorAll(".ui-claude").filter(b => b.closest(".ov-tete")).length, 0, "pas de bouton Claude empilé sous le titre");
  const c0 = carte(v.root, "obj-apport");
  c0.focus(); c0.click();
  const dlg = dlgDe(v.doc);
  assert.equal(dlg.hidden, false);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Apport maison");
  assert.match(sp(dlg.textContent), /Poches rattachées/);
  assert.match(sp(dlg.textContent), /Livret A 1,7 %/);
  assert.equal(dlg.querySelector("[data-ov-act]"), null);
  assert.equal(dlg.querySelectorAll("form, input, textarea, select").length, 0);
  const corriger = dlg.querySelectorAll("a.ui-claude").find(a => /Corriger avec Claude/.test(a.textContent));
  assert.ok(corriger);
  assert.match(decodeURIComponent(corriger.getAttribute("href")), /l'objectif « Apport maison »/);
  assert.match(dlg.querySelector(".ui-panneau-pied").innerHTML, /claude\.ai\/new\?q=/);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true);
  assert.equal(v.doc.activeElement, carte(v.root, "obj-apport"));
  assert.deepEqual(v.acces, [], "aucun accès au store");
});

test("vue (DOM) : objectif retiré par le store → panneau fermé ; modifié → panneau rafraîchi", () => {
  const v = vueDom(demoS());
  carte(v.root, "obj-retraite").click();
  const dlg = dlgDe(v.doc);
  const S2 = J(v.S()); S2.objectifs.find(o => o.id === "obj-retraite").nom = "Retraite anticipée";
  v.api.update(S2, true);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Retraite anticipée");
  const S3 = J(S2); S3.objectifs = S3.objectifs.filter(o => o.id !== "obj-retraite");
  v.api.update(S3, true);
  assert.equal(dlg.hidden, true);
  assert.equal(carte(v.root, "obj-retraite"), null);
});

test("vue (DOM) : analyser() une fois par émission du store (cartes, projection, panneau, titre de navigation)", () => {
  const v = vueDom(demoS());
  carte(v.root, "obj-apport").click();
  ouvrirProj(v);
  v.compte.analyses = 0;
  v.api.update(J(v.S()), true);
  v.api.headline();
  assert.equal(v.compte.analyses, 1, "une seule analyse pour le rendu, la projection, le panneau et le titre");
  // un réglage du simulateur ne relance pas l'analyse
  v.root.querySelector("#ovHorizon").querySelectorAll('[role="radio"]')[2].click();
  assert.equal(v.compte.analyses, 1);
  v.api.update(J(v.S()), true);
  assert.equal(v.compte.analyses, 2);
});

test("vue (DOM) : projection en accordéon — dessinée à l'ouverture, horizon en bascule, versement « scénario » local jamais enregistré", () => {
  const v = vueDom(demoS());
  assert.equal(v.root.querySelector("#ovChart").innerHTML, "", "rien n'est dessiné tant que l'accordéon est fermé");
  ouvrirProj(v);
  assert.match(v.root.querySelector("#ovChart").innerHTML, /<svg/);
  assert.match(sp(v.root.querySelector("#ovProjTable").textContent), /Dans 10 ans/);
  const h = v.root.querySelector("#ovHorizon").querySelectorAll('[role="radio"]');
  assert.deepEqual(h.map(x => x.textContent), ["5 ans", "10 ans", "20 ans", "30 ans"]);
  h[2].click();
  assert.match(sp(v.root.querySelector("#ovProjTable").textContent), /Dans 20 ans/);
  const vers = v.root.querySelector("#ovVers");
  assert.equal(vers.value, "650");
  saisir(v.dom, vers, "1000");
  assert.match(v.root.querySelector("#ovVersTag").innerHTML, /scénario/);
  assert.match(sp(v.root.querySelector("#ovVersSrc").textContent), /simulation locale, non enregistrée · réel : 650 €\/mois/);
  v.root.querySelector("[data-ov-vreset]").click();
  assert.equal(v.root.querySelector("#ovVers").value, "650");
  assert.match(v.root.querySelector("#ovVersTag").innerHTML, /prévu/);
  assert.deepEqual(v.acces, [], "le simulateur n'écrit rien");
});

test("vue (DOM) : SVG de projection redessiné seulement si ses données changent", () => {
  const v = vueDom(demoS());
  ouvrirProj(v);
  const svg0 = v.root.querySelector("#ovChart").children[0], table0 = v.root.querySelector("#ovProjTable").children[0];
  assert.ok(svg0);
  v.api.update(J(v.S()), true);
  v.api.update(J(v.S()), true);
  assert.equal(v.root.querySelector("#ovChart").children[0], svg0, "même SVG : pas de redessin");
  assert.equal(v.root.querySelector("#ovProjTable").children[0], table0);
  // un objectif renommé ne change pas la projection du patrimoine
  const S2 = J(v.S()); S2.objectifs[0].nom = "Matelas";
  v.api.update(S2, true);
  assert.equal(v.root.querySelector("#ovChart").children[0], svg0);
  // le versement change : redessin
  saisir(v.dom, v.root.querySelector("#ovVers"), "2000");
  assert.notEqual(v.root.querySelector("#ovChart").children[0], svg0);
});

test("vue (DOM) : anti-redessin des cartes avec plus de 5 objectifs ; « Voir plus » déplié le reste", () => {
  const v = vueDom(septObjectifs());
  const zone = v.root.querySelector("#ovCartes");
  const btn = zone.querySelector("[data-ui-voirplus]");
  assert.ok(btn, "7 objectifs : « Voir plus »");
  assert.match(btn.textContent, /Voir plus d'objectifs \(2\)/);
  const c0 = zone.children[0];
  v.api.update(J(v.S()), true);
  v.api.update(J(v.S()), true);
  assert.equal(zone.children[0], c0, "deux rendus identiques : DOM non réécrit");
  btn.click();
  assert.equal(zone.querySelector(".ui-voirplus-reste").hidden, false);
  // nouvelle émission avec des données changées (premier objectif) : le bloc reste déplié
  const S2 = J(v.S()); S2.objectifs[0].cible = 25000;
  v.api.update(S2, true);
  assert.equal(zone.querySelector(".ui-voirplus-reste").hidden, false, "toujours déplié");
  assert.equal(zone.querySelector("[data-ui-voirplus]").getAttribute("aria-expanded"), "true");
  assert.ok(carte(v.root, "obj-p7"));
  const c1 = zone.children[0];
  v.api.update(J(S2), true);
  assert.equal(zone.children[0], c1);
});

test("vue (DOM) : aucun objectif → état vide orienté vers Claude ; tutoiement de tout le texte affiché", () => {
  const v = vueDom(Object.assign(demoS(), { objectifs: [] }));
  const t = sp(v.root.querySelector("#ovCartes").textContent);
  assert.match(t, /Aucun objectif pour l'instant/);
  assert.match(t, /Compléter avec Claude/);
  assert.deepEqual(questions(v.root.querySelector("#ovCartes").innerHTML), [P("objectifs")]);
  assert.equal(v.root.querySelector("[data-ov-modele]"), null);
  assert.equal(v.api.headline(), "Objectifs à fixer");
  assert.doesNotMatch(sansExceptions(v.root.textContent), VOUVOIEMENT);
  const w = vueDom(septObjectifs());
  ouvrirProj(w);
  assert.doesNotMatch(sansExceptions(w.root.textContent), VOUVOIEMENT);
  for (const id of ["obj-matelas", "obj-apport", "obj-p5"]) {
    carte(w.root, id).click();
    assert.doesNotMatch(sansExceptions(dlgDe(w.doc).textContent), VOUVOIEMENT, id);
  }
  assert.deepEqual(w.acces, []);
});

test("detailHtml : une enveloppe rattachée mène à sa fiche de Patrimoine › Comptes (adresse d'App.ouvrir) ; une poche reste du texte", () => {
  const S = demoS();
  const a = OV.analyser(S, DEPS, TODAY);
  const ap = a.liste.find(x => x.o.id === "obj-apport");
  const x = Object.assign({}, ap, { o: Object.assign({}, ap.o, { enveloppes: ["PEA Camille", "Livrets <Sam>"] }) });
  const ctx = { positions: S.positions, scope: "foyer", Calc, Plan, today: TODAY, n: 3, duScope: "du foyer", U: UI };
  const h = OV.detailHtml(x, ctx);
  const CV = require("../web/src/comptes-view.js");
  const r = CV.lien({ enveloppe: "PEA Camille", titulaire: "p1" });
  assert.ok(h.includes('<a href="#' + r.replace(/&/g, "&amp;") + '" data-goto="' + r.replace(/&/g, "&amp;") + '">PEA Camille</a>'), "titulaire unique de l'enveloppe");
  assert.match(h, /data-goto="patrimoine\/comptes\?enveloppe=Livrets%20%3CSam%3E">Livrets &lt;Sam&gt;<\/a>/, "échappé, encodé ; titulaire inconnu → sans titulaire");
  assert.doesNotMatch(h, /data-goto="[^"]*bloc|>Épargne<\/a>/, "les poches ne sont pas des fiches");
});
