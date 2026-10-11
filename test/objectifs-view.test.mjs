// Patrimoine › Objectifs (module objectifs-view, web/src/objectifs-view.*) : « Vais-je atteindre mes projets ? ».
// Verdict en tête, une carte par objectif (échéance, progression, statut, effort mensuel requis) → panneau (détail, poches
// rattachées, projection de l'objectif, modifier, supprimer, priorité), « Ajouter un objectif » (modèles), projection du
// patrimoine financier en accordéon.
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
const DEMO = require("../web/src/demo-data.js");

const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ").replace(/&#39;/g, "'");
const DEPS = { Plan, Calc };
const PEOPLE = [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }];
const TODAY = "2026-10-11";
const demoS = () => Object.assign(J(DEMO), { ready: true, dbOk: true, scope: "foyer", people: PEOPLE, error: null });

/* ------------------------------------------------------------------ structure ------------------------------------------------------------------ */
test("objectifs-view.js : se compile, s'enregistre sous « objectifs-view », exporte ses fonctions pures", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "objectifs-view.js" }));
  assert.match(js, /App\.register\("objectifs-view", api\)/);
  assert.match(js, /__pending/);
  for (const f of ["trier", "analyser", "resumeObjectifs", "carteHtml", "detailHtml", "formHtml", "serieObjectif", "modele", "validerObjectif", "ligneObjectif", "deplacer", "livretA", "versementReel", "projectionSvg", "projectionTableHtml", "hypothesesHtml"])
    assert.equal(typeof OV[f], "function", f);
});

test("objectifs-view.js : calculs de plan.js (cascade des poches, statut, répartition de l'épargne, projection) ; écritures objectifs seulement", () => {
  assert.match(js, /\.affecterDeja\(/);
  assert.match(js, /statutObjectif\([^)]*deja:/);
  assert.match(js, /repartirEpargne\(/);
  assert.match(js, /\.projection\(/);
  assert.match(js, /collection\("objectifs"\)\.upsert\(/);
  assert.match(js, /doc\("objectifs\/" \+ id\)\.delete\(/);
  assert.doesNotMatch(js, /doc\("budget\/main"\)/);
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

test("objectifs-view.css : scopé sous #view-objectifs-view (panneau sous .ui-panneau .ov-…), mobile, couleurs du thème", () => {
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
});

test("objectifs-view.html : identifiants utilisés par le script, question, projection en accordéon fermé", () => {
  const ids = [...js.matchAll(/\$\("(ov[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 8);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
  assert.match(html, /Vais-je atteindre mes projets/);
  assert.match(html, /<details class="ui-acc ov-proj" id="ovProjAcc">/);
  assert.match(html, /Projection du patrimoine financier/);
  assert.match(html, /id="ovAjouter"[^>]*>Ajouter un objectif</);
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

test("resumeObjectifs : verdict en une phrase, compte par statut, ton", () => {
  const st = s => ({ o: { id: s }, st: { statut: s } });
  const ok = OV.resumeObjectifs([st("avance"), st("dans_les_temps"), st("atteint")]);
  assert.equal(ok.n, 3); assert.equal(ok.ton, "bon");
  assert.match(ok.verdict, /3 objectifs sont en bonne voie/);
  const ko = OV.resumeObjectifs([st("avance"), st("retard"), st("hors_portee")]);
  assert.equal(ko.ton, "critique");
  assert.match(ko.verdict, /2 objectifs sur 3 demandent votre attention/);
  assert.match(ko.detail, /1 en avance · 1 en retard · 1 hors de portée/);
  const un = OV.resumeObjectifs([st("retard")]);
  assert.equal(un.ton, "attention");
  assert.match(un.verdict, /Votre objectif est en retard/);
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

test("detailHtml : détail chiffré, poches rattachées avec leur valeur, cascade expliquée, projection de l'objectif, actions", () => {
  const S = demoS();
  const a = OV.analyser(S, DEPS, TODAY);
  const ap = a.liste.find(x => x.o.id === "obj-apport");
  const ctx = { positions: S.positions, scope: "foyer", Calc, Plan, today: TODAY, n: 3, dbOk: true, duScope: "du foyer" };
  const h = sp(OV.detailHtml(ap, ctx));
  assert.match(h, /Cible/); assert.match(h, /60 000 €/);
  assert.match(h, /Déjà de côté/);
  assert.match(h, /Effort requis/);
  assert.match(h, /Votre épargne actuelle en couvre/);
  assert.match(h, /role="progressbar"/);
  assert.match(h, /Poches rattachées/);
  assert.match(h, /Épargne/);
  assert.match(h, /servent d'abord un objectif prioritaire/);
  assert.match(h, /Projection de l'objectif/);
  assert.match(h, /<svg[^>]*role="img"/);
  for (const act of ["modifier", "supprimer", "monter", "descendre"]) assert.match(h, new RegExp('data-ov-act="' + act + '"'));
  const first = sp(OV.detailHtml(a.liste[0], Object.assign({}, ctx, { rang: 1 })));
  assert.match(first, /data-ov-act="monter" disabled/);
  const conf = sp(OV.detailHtml(ap, Object.assign({}, ctx, { confirmer: true })));
  assert.match(conf, /data-ov-act="supprimer-oui"/);
  const saisi = { o: { id: "s", nom: "Voyage <Japon>", type: "projet", cible: 5000, dateCible: "2027-08-31", source: "saisi", deja: 1000, rendement: 0, priorite: 4 },
    st: Plan.statutObjectif({ cible: 5000, dateCible: "2027-08-31", rendement: 0 }, { deja: 1000, versementAlloue: 0, today: TODAY }), brut: 1000, rang: 4 };
  const hs = sp(OV.detailHtml(saisi, ctx));
  assert.match(hs, /Montant saisi/);
  assert.doesNotMatch(hs, /<Japon>/);
  assert.match(hs, /Aucune épargne n'y est affectée/);
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

test("modele : matelas = 6 mois de dépenses (arrondi à 100 €) sur la poche Épargne, retraite selon l'âge, rendements par défaut", () => {
  const t = Plan.budgetTotaux(DEMO.budget.lignes, DEMO.profil, "foyer");
  const m = OV.modele("matelas", { totaux: t, blocs: ["Épargne", "Monde"], age: "a30", today: TODAY });
  assert.equal(m.nom, "Matelas de précaution");
  assert.equal(m.cible, Math.round(6 * t.depenses / 100) * 100);
  assert.equal(m.source, "poches"); assert.deepEqual(m.poches, ["Épargne"]);
  assert.equal(m.dateCible, "2027-10-31");
  assert.equal(m.rendement, 2.4);
  const r = OV.modele("retraite", { totaux: t, blocs: ["Monde", "Europe", "Crypto"], age: "a30", today: TODAY });
  assert.deepEqual(r.poches, ["Monde", "Europe"]);
  assert.equal(r.dateCible.slice(0, 4), String(2026 + 29));
  assert.equal(r.rendement, 5);
  const p = OV.modele("projet", { totaux: t, blocs: [], today: TODAY });
  assert.equal(p.source, "saisi"); assert.equal(p.cible, 10000); assert.equal(p.rendement, 3);
  assert.equal(OV.modele("apport", { totaux: t, blocs: [], today: TODAY }).source, "saisi");
});

test("validerObjectif : nom, cible, date future, poches ou montant, rendement borné", () => {
  const ok = { nom: "Voyage", cible: 3000, dateCible: "2027-06-30", source: "saisi", deja: 0, rendement: 2 };
  assert.equal(OV.validerObjectif(ok, TODAY), null);
  assert.match(OV.validerObjectif(Object.assign({}, ok, { nom: " " }), TODAY), /Donnez un nom/);
  assert.match(OV.validerObjectif(Object.assign({}, ok, { cible: 0 }), TODAY), /montant cible/);
  assert.match(OV.validerObjectif(Object.assign({}, ok, { dateCible: "2026-01-01" }), TODAY), /dans le futur/);
  assert.match(OV.validerObjectif(Object.assign({}, ok, { source: "poches", poches: [], enveloppes: [] }), TODAY), /Cochez au moins une poche/);
  assert.match(OV.validerObjectif(Object.assign({}, ok, { deja: "" }), TODAY), /déjà de côté/);
  assert.match(OV.validerObjectif(Object.assign({}, ok, { rendement: 80 }), TODAY), /entre -50 et 50/);
  assert.equal(OV.validerObjectif(Object.assign({}, ok, { dateCible: "" }), TODAY), null, "sans échéance : accepté");
});

test("ligneObjectif : ligne enregistrée (nouvel objectif en dernière priorité, poches ou montant) ; deplacer : priorités échangées", () => {
  const objs = [{ id: "a", priorite: 1 }, { id: "b", priorite: 2 }, { id: "c", priorite: 5 }];
  const n = OV.ligneObjectif({ nom: " Voyage ", type: "projet", cible: "3000", dateCible: "", source: "saisi", deja: "200", rendement: "2", poches: ["X"] }, null, objs);
  assert.deepEqual(n, { nom: "Voyage", type: "projet", cible: 3000, dateCible: null, source: "saisi", poches: [], enveloppes: [], deja: 200, rendement: 2, priorite: 6 });
  const e = OV.ligneObjectif({ nom: "Apport", type: "apport", cible: 1, dateCible: "2030-01-31", source: "poches", poches: ["Épargne"], enveloppes: [], deja: 99, rendement: 2.4 }, "b", objs);
  assert.equal(e.id, "b"); assert.equal(e.deja, 0); assert.deepEqual(e.poches, ["Épargne"]); assert.equal(e.priorite, undefined);
  assert.deepEqual(OV.deplacer(objs, "b", -1), [{ id: "b", priorite: 1 }, { id: "a", priorite: 2 }, { id: "c", priorite: 3 }]);
  assert.deepEqual(OV.deplacer(objs, "c", -1), [{ id: "c", priorite: 2 }, { id: "b", priorite: 3 }]);
  assert.deepEqual(OV.deplacer(objs, "a", -1), []);
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
  assert.match(r.src, /versements programmés/);
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

test("formHtml : champs échappés, bascules type et source, poches cochées avec leur valeur, repère Livret A", () => {
  const ed = { nom: 'Voyage "<x>"', type: "projet", cible: 3000, dateCible: "2027-06-30", source: "poches", poches: ["Épargne"], enveloppes: [], deja: 0, rendement: 3 };
  const h = sp(OV.formHtml(ed, { blocs: [["Épargne", 12000], ["Monde", 30000]], enveloppes: [["PEA Camille", 25000]], livretA: "1,7 % depuis le 01/08/2026", nouvelle: true, erreur: "Oups <b>" }));
  assert.match(h, /value="Voyage &quot;&lt;x&gt;&quot;"/);
  assert.match(h, /data-ov-bascule="type"/);
  assert.match(h, /data-ov-bascule="source"/);
  assert.match(h, /<input type="checkbox" data-ov-liste="poches" value="Épargne" checked>/);
  assert.match(h, /<input type="checkbox" data-ov-liste="poches" value="Monde">/);
  assert.match(h, /12 000 €/);
  assert.match(h, /Livret A 1,7 % depuis le 01\/08\/2026/);
  assert.match(h, /role="alert"[^>]*>Oups &lt;b&gt;</);
  assert.match(h, /Ajouter l'objectif/);
  const saisi = sp(OV.formHtml(Object.assign({}, ed, { source: "saisi", deja: 500 }), { blocs: [], enveloppes: [], livretA: "x", nouvelle: false }));
  assert.match(saisi, /id="ovf-deja"[^>]*value="500"/);
  assert.doesNotMatch(saisi, /data-ov-liste/);
  assert.match(saisi, /Enregistrer l'objectif/);
});

/* ------------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------------ */
const uiJs = readFileSync("web/src/ui.js", "utf8");
const planJs = readFileSync("web/src/plan.js", "utf8");
const calcJs = readFileSync("web/src/calc.js", "utf8");
const reperesJs = readFileSync("web/src/reperes.js", "utf8");
const attendre = () => new Promise(r => setTimeout(r, 0));
function vueDom(S0, o = {}) {
  const dom = miniDom(), { doc } = dom;
  let S = J(S0);
  const ecrits = [];
  const modules = {};
  const emettre = () => modules["objectifs-view"].update(S, true);
  const c = { document: doc, console, setTimeout, clearTimeout, CSS: { escape: s => String(s).replace(/["\\]/g, "\\$&") } };
  c.window = c; c.self = c;
  c.App = { register: (n, api) => { modules[n] = api; }, refreshHeadlines() {}, parametres: () => ({}) };
  c.Store = { get: () => S, db: {
    collection: name => ({ upsert: async row => {
      if (o.echec) throw Object.assign(new Error("panne"), { code: "unavailable" });
      ecrits.push({ op: "upsert", name, row: J(row) });
      S = J(S);
      let cur = row.id && S.objectifs.find(x => x.id === row.id);
      if (cur) Object.assign(cur, row); else { cur = Object.assign({ id: "obj-n" + ecrits.length }, row); S.objectifs.push(cur); }
      emettre();
      return { id: cur.id };
    } }),
    doc: path => ({ delete: async () => { ecrits.push({ op: "delete", path }); S = J(S); S.objectifs = S.objectifs.filter(x => "objectifs/" + x.id !== path); emettre(); return {}; } }),
  } };
  vm.createContext(c);
  vm.runInContext(calcJs, c, { filename: "calc.js" });
  vm.runInContext(planJs, c, { filename: "plan.js" });
  vm.runInContext(reperesJs, c, { filename: "reperes.js" });
  vm.runInContext(uiJs, c, { filename: "ui.js" });
  vm.runInContext(js, c, { filename: "objectifs-view.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.setAttribute("id", "view-objectifs-view");
  root.innerHTML = html;
  const api = modules["objectifs-view"];
  api.mount(root);
  api.update(S, true);
  return { c, dom, doc, root, api, S: () => S, ecrits };
}
const dlgDe = doc => doc.body.querySelector('[role="dialog"]');
const saisir = (dom, el, v) => { el.value = v; el.dispatchEvent(new dom.Ev("input")); };
const carte = (root, id) => root.querySelector('[data-ui-carte="' + id + '"]');

test("vue (DOM) : verdict, une carte par objectif dans l'ordre des priorités, panneau de détail, Échap rend le focus", () => {
  const v = vueDom(demoS());
  assert.match(sp(v.root.querySelector("#ovVerdict").textContent), /objectif/);
  const cartes = v.root.querySelector("#ovCartes").querySelectorAll("[data-ui-carte]");
  assert.deepEqual(cartes.map(x => x.getAttribute("data-ui-carte")), ["obj-matelas", "obj-apport", "obj-retraite"]);
  const c0 = carte(v.root, "obj-apport");
  c0.focus(); c0.click();
  const dlg = dlgDe(v.doc);
  assert.equal(dlg.hidden, false);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Apport maison");
  assert.match(sp(dlg.textContent), /Poches rattachées/);
  assert.match(dlg.querySelector(".ui-panneau-pied").innerHTML, /claude\.ai\/new\?q=/);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true);
  assert.equal(v.doc.activeElement, carte(v.root, "obj-apport"));
});

test("vue (DOM) : Modifier → formulaire dans le panneau, enregistré par upsert ; priorité ; suppression confirmée", async () => {
  const v = vueDom(demoS());
  carte(v.root, "obj-retraite").click();
  const dlg = dlgDe(v.doc);
  dlg.querySelector('[data-ov-act="modifier"]').click();
  const nom = dlg.querySelector("#ovf-nom");
  assert.equal(nom.value, "Retraite");
  saisir(v.dom, nom, "Retraite anticipée");
  dlg.querySelector('[data-ov-act="enregistrer"]').click();
  await attendre(); await attendre();
  assert.equal(v.ecrits.length, 1);
  assert.equal(v.ecrits[0].row.id, "obj-retraite");
  assert.equal(v.ecrits[0].row.nom, "Retraite anticipée");
  assert.deepEqual(v.ecrits[0].row.poches, ["Monde", "Europe", "Asie"]);
  assert.match(dlg.querySelector("[data-ov-msg]").textContent, /enregistré/);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Retraite anticipée");
  // priorité : monter
  dlg.querySelector('[data-ov-act="monter"]').click();
  await attendre(); await attendre(); await attendre();
  const ups = v.ecrits.slice(1).map(e => [e.row.id, e.row.priorite]);
  assert.deepEqual(ups, [["obj-retraite", 2], ["obj-apport", 3]]);
  assert.deepEqual(v.root.querySelector("#ovCartes").querySelectorAll("[data-ui-carte]").map(x => x.getAttribute("data-ui-carte")), ["obj-matelas", "obj-retraite", "obj-apport"]);
  // suppression
  dlg.querySelector('[data-ov-act="supprimer"]').click();
  assert.equal(v.ecrits.filter(e => e.op === "delete").length, 0);
  dlg.querySelector('[data-ov-act="supprimer-oui"]').click();
  await attendre(); await attendre();
  assert.deepEqual(v.ecrits.filter(e => e.op === "delete").map(e => e.path), ["objectifs/obj-retraite"]);
  assert.equal(dlg.hidden, true);
  assert.match(v.root.querySelector("#ovMsg").textContent, /supprimé/);
  assert.equal(carte(v.root, "obj-retraite"), null);
});

test("vue (DOM) : Ajouter un objectif → modèle → formulaire (source « Montant saisi ») → nouvel objectif en dernière priorité", async () => {
  const v = vueDom(demoS());
  v.root.querySelector("#ovAjouter").click();
  const dlg = dlgDe(v.doc);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Ajouter un objectif");
  dlg.querySelector('[data-ov-modele="projet"]').click();
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Nouvel objectif");
  saisir(v.dom, dlg.querySelector("#ovf-nom"), "Voyage au Japon");
  saisir(v.dom, dlg.querySelector("#ovf-cible"), "6000");
  saisir(v.dom, dlg.querySelector("#ovf-deja"), "500");
  dlg.querySelector('[data-ov-act="enregistrer"]').click();
  await attendre(); await attendre();
  assert.equal(v.ecrits.length, 1);
  const row = v.ecrits[0].row;
  assert.equal(row.nom, "Voyage au Japon"); assert.equal(row.cible, 6000); assert.equal(row.deja, 500); assert.equal(row.source, "saisi");
  assert.equal(row.priorite, 4);
  assert.ok(carte(v.root, "obj-n1"), "nouvelle carte");
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Voyage au Japon");
});

test("vue (DOM) : formulaire invalide → erreur dans le panneau ; bascule de source → poches à cocher", async () => {
  const v = vueDom(demoS());
  v.root.querySelector("#ovAjouter").click();
  const dlg = dlgDe(v.doc);
  dlg.querySelector('[data-ov-modele="projet"]').click();
  dlg.querySelector('[data-ov-act="enregistrer"]').click();
  await attendre();
  assert.equal(v.ecrits.length, 0);
  assert.match(dlg.querySelector('[role="alert"]').textContent, /Donnez un nom/);
  const src = dlg.querySelector('[data-ov-bascule="source"]').querySelectorAll('[role="radio"]');
  src[1].click();
  const cases = dlg.querySelectorAll("[data-ov-liste]");
  assert.ok(cases.length >= 3, "poches et enveloppes à cocher");
  assert.equal(dlg.querySelector("#ovf-deja"), null);
});

test("vue (DOM) : projection en accordéon — dessinée à l'ouverture, horizon en bascule, versement « scénario » local", () => {
  const v = vueDom(demoS());
  const acc = v.root.querySelector("#ovProjAcc");
  assert.equal(v.root.querySelector("#ovChart").innerHTML, "", "rien n'est dessiné tant que l'accordéon est fermé");
  acc.setAttribute("open", "");
  acc.dispatchEvent(new v.dom.Ev("toggle"));
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
  assert.match(sp(v.root.querySelector("#ovVersSrc").textContent), /réel : 650 €\/mois/);
});

test("vue (DOM) : aucun objectif → état vide orienté (modèles, Claude) ; lecture seule → boutons désactivés", () => {
  const v = vueDom(Object.assign(demoS(), { objectifs: [] }));
  const t = sp(v.root.querySelector("#ovCartes").textContent);
  assert.match(t, /Aucun objectif pour l'instant/);
  assert.ok(v.root.querySelector("#ovCartes").querySelector('[data-ov-modele="matelas"]'));
  assert.match(v.root.querySelector("#ovCartes").innerHTML, /claude\.ai\/new/);
  const ro = vueDom(Object.assign(demoS(), { dbOk: false }));
  carte(ro.root, "obj-matelas").click();
  assert.ok(dlgDe(ro.doc).querySelector('[data-ov-act="modifier"]').hasAttribute("disabled"));
});
