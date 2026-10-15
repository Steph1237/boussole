// Patrimoine › Objectifs (module objectifs-view, web/src/objectifs-view.*) : « Vais-je atteindre mes projets ? », en lecture seule.
// Verdict en tête, une carte par objectif (échéance, progression, statut + probabilité du moteur, effort mensuel requis) → panneau (détail,
// phrase de probabilité, rendement et repère Livret A, poches rattachées, graphe maître de l'objectif, « Corriger avec Claude »),
// « Compléter avec Claude » en tête, bandeau « cibles en euros d'aujourd'hui », projection du patrimoine financier en accordéon = le graphe
// maître (GrapheModele.brancher, préréglage « objectifs »). Source de l'épargne dite une fois (spec PROJ § 13.2). Aucune écriture, tutoiement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
  for (const f of ["trier", "analyser", "resumeObjectifs", "carteHtml", "detailHtml", "livretA", "probabilites", "probaInfo", "probaHtml", "probaPhrase", "capaciteDe", "noteRepartition",
    "bandeauVu", "bandeauFerme", "boutonClaude"])
    assert.equal(typeof OV[f], "function", f);
  for (const f of ["serieObjectif", "projectionSvg", "projectionTableHtml", "hypothesesHtml"]) assert.equal(OV[f], undefined, f + " : remplacé par le graphe maître");
  for (const f of ["formHtml", "modele", "validerObjectif", "ligneObjectif", "deplacer"]) assert.equal(OV[f], undefined, f + " : plus de saisie dans l'app");
});

test("objectifs-view.js : calculs de plan.js (cascade des poches, statut, répartition de l'épargne) et moteur de projection via le graphe ; aucune écriture au store", () => {
  assert.match(js, /\.affecterDeja\(/);
  assert.match(js, /statutObjectif\([^)]*deja:/);
  assert.match(js, /repartirEpargne\(/);
  assert.doesNotMatch(js, /\.projection\(|RENDEMENTS/, "plus de Plan.projection ni de RENDEMENTS");
  assert.match(js, /GrapheModele|GM\(\)/);
  assert.match(js, /\.brancher\(/);
  assert.match(js, /preset: "objectifs"/);
  assert.match(js, /objectifId/);
  assert.doesNotMatch(js, /Store\.db|\.db\b/, "aucun accès à Store.db");
  assert.doesNotMatch(js, /\.upsert\(|\.delete\(|\.set\(\s*\{|collection\(|doc\("objectifs/, "aucune écriture");
  assert.doesNotMatch(js, /doc\("budget\/main"\)/);
});

test("objectifs-view : lecture seule — plus de formulaire, de modèles, de priorité monter / descendre ni de suppression", () => {
  for (const src of [js, html]) {
    assert.doesNotMatch(src, /<form|<textarea|<select|<dialog|type="checkbox"|type="date"/);
    assert.doesNotMatch(src, /Ajouter un objectif|data-ov-modele|data-ov-act|ovAjouter|ov-bascule|Monter|Descendre|Supprimer|Modifier/);
  }
  // plus aucun champ : le simulateur de versement local est retiré (spec PROJ § 13.2)
  assert.equal((html.match(/<input/g) || []).length, 0);
  assert.equal((js.match(/<input/g) || []).length, 0);
  assert.doesNotMatch(html, /ovVers|Versement mensuel|ovHorizon|ov-tag|scénario/);
  assert.doesNotMatch(js, /ovVers|versOverride|ovHorizon|ov-tag|data-ov-vreset|scénario ↺|u\.bascule/);
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

test("objectifs-view.html : identifiants utilisés par le script, question, « Compléter avec Claude », projection en accordéon fermé, bandeau, ligne de source", () => {
  const ids = [...js.matchAll(/\$\("(ov[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 8);
  for (const id of ["ovBandeau", "ovCapSrc", "ovGraphe"]) assert.ok(html.includes('id="' + id + '"'), id);
  assert.match(html, /id="ovBandeau"[^>]*hidden/, "le bandeau est caché tant que le script ne l'a pas décidé");
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
  const ctx = { positions: S.positions, scope: "foyer", Calc, Plan, n: 3, duScope: "du foyer", livretA: OV.livretA(S, Reperes), U: UI };
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
  assert.match(h, /<div class="ov-graphe" data-ov-graphe><\/div>/, "conteneur du graphe maître (monté par la vue)");
  assert.doesNotMatch(h.split("Projection de l'objectif")[1], /<svg|serie/, "plus de mini-courbe");
  assert.match(h, /Ce graphe montre le patrimoine financier du foyer avec cet objectif marqué/);
  assert.match(h, /Ce n'est pas la trajectoire des seules poches de l'objectif/);
  assert.match(h, /data-ov-proba/);
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

test("livretA : taux et date d'effet lus dans les repères ; sans repère, formule générique", () => {
  const S = demoS();
  assert.equal(sp(OV.livretA(S, Reperes)), "1,7 % depuis le 01/08/2026");
  assert.equal(OV.livretA(Object.assign({}, S, { savoir: null }), Reperes), "taux réglementé en vigueur");
  assert.equal(OV.livretA(S, null), "taux réglementé en vigueur");
});

test("tutoiement des rendus : verdicts, cartes, panneaux", () => {
  const S = septObjectifs();
  const a = OV.analyser(S, DEPS, TODAY);
  const ctx = { positions: S.positions, scope: "p1", Calc, Plan, n: a.liste.length, duScope: "de Camille", livretA: "x", U: UI };
  const rendus = a.liste.flatMap(x => [OV.carteHtml(x, a.liste.length), OV.detailHtml(x, ctx)]);
  const st = s => ({ o: { id: s }, st: { statut: s } });
  for (const l of [[st("avance")], [st("retard")], [st("avance"), st("atteint")], [st("retard"), st("hors_portee")], []]) rendus.push(OV.resumeObjectifs(l).verdict);
  for (const h of rendus) assert.doesNotMatch(sansExceptions(sp(h).replace(/href="[^"]*"/g, "")), VOUVOIEMENT);
});

/* ------------------------------------------------------------------ probabilité du moteur, source de l'épargne, bandeau (fonctions pures) ------------------------------------------------------------------ */
/* Données du graphe telles que GrapheModele.construire les produit (extrait utile : objectifs du moteur, capacité retenue et sa source). */
const objMoteur = (id, probabilite, statut, extra) => Object.assign({ id, nom: id, cible: 10000, date: "2029-06-30", probabilite, mot: null, statut: statut || "dans_les_temps", valeur_deterministe: 9000 }, extra);
const CAP_BUDGET = Plan.capaciteEpargne(Plan.budgetTotaux(demoS().budget.lignes, demoS().profil, "foyer"));
const donneesMoteur = (objs, extra) => Object.assign({ etat: "pret", progressif: false, today: TODAY, objectifs: objs,
  capacite: { base: { retenue: 300, source: "reel", periode: "avril à septembre 2026" } }, capacite_source: "reel", capacite_periode: "avril à septembre 2026" }, extra || {});

test("probabilites : mot du moteur (≥ 80 % probable, 50 à 80 % incertain, < 50 % peu probable), chances sur 10, ton ; {} tant que le moteur n'a pas répondu", () => {
  const d = donneesMoteur([objMoteur("a", 0.83), objMoteur("b", 0.8), objMoteur("c", 0.62), objMoteur("d", 0.5), objMoteur("e", 0.31), objMoteur("f", 0.04)]);
  const p = OV.probabilites(d);
  assert.deepEqual(["a", "b", "c", "d", "e", "f"].map(k => p[k].mot), ["probable", "probable", "incertain", "incertain", "peu probable", "peu probable"]);
  assert.deepEqual(["a", "c", "e"].map(k => p[k].ton), ["bon", "surveiller", "travailler"]);
  assert.equal(p.a.chances, "8 chances sur 10");
  assert.equal(p.f.chances, "moins de 1 chance sur 10");
  assert.deepEqual(OV.probabilites(null), {});
  assert.deepEqual(OV.probabilites(donneesMoteur([objMoteur("a", 0.9)], { etat: "calcul" })), {}, "aucun chiffre provisoire tant que le calcul est en cours");
  assert.deepEqual(OV.probabilites(donneesMoteur([objMoteur("a", 0.9)], { etat: "erreur" })), {});
});

test("probabilites : hors_horizon = pas de verdict ni probabilité ; échéance passée sans probabilité = rien à dire", () => {
  const p = OV.probabilites(donneesMoteur([objMoteur("h", null, "hors_horizon", { date: "2055-01-31" }), objMoteur("x", 0.9, "hors_horizon"), objMoteur("passe", null, "hors_portee")]));
  assert.equal(p.h.horsHorizon, true); assert.equal(p.h.verdict, "aucun"); assert.equal(p.h.probabilite, null); assert.equal(p.h.mot, null);
  assert.equal(p.x.probabilite, null, "même si une probabilité traîne, hors_horizon n'en affiche aucune");
  assert.equal(p.passe.horsHorizon, false); assert.equal(p.passe.verdict, "aucun");
  assert.match(OV.probaHtml(p.h), /Pas de verdict : échéance au-delà de la projection \(25 ans\)/);
  assert.doesNotMatch(OV.probaHtml(p.h), /chances|probable|ui-puce/);
  assert.equal(OV.probaHtml(p.passe), "", "pas de probabilité : rien");
  assert.equal(OV.probaHtml(null), "");
});

test("probaHtml : puce avec le mot ET la couleur, chances sur 10 à côté ; tout échappé", () => {
  const p = OV.probabilites(donneesMoteur([objMoteur("a", 0.83), objMoteur("c", 0.62), objMoteur("e", 0.31)]));
  const h = k => sp(OV.probaHtml(p[k]));
  assert.match(h("a"), /ui-puce bon"><span class="ui-puce-point" aria-hidden="true"><\/span>probable<\/span>.*8 chances sur 10 d'y arriver/);
  assert.match(h("c"), /ui-puce surveiller"[^>]*>.*incertain.*6 chances sur 10 d'y arriver/);
  assert.match(h("e"), /ui-puce travailler"[^>]*>.*peu probable.*3 chances sur 10 d'y arriver/);
});

test("probaInfo : rien pour un objectif déjà atteint (la somme est réunie), l'info du moteur sinon", () => {
  const p = OV.probabilites(donneesMoteur([objMoteur("obj-apport", 0.9)]));
  const a = OV.analyser(demoS(), DEPS, TODAY);
  const x = a.liste.find(y => y.o.id === "obj-apport");
  assert.equal(OV.probaInfo(p, x).mot, "probable");
  assert.equal(OV.probaInfo(p, Object.assign({}, x, { st: Object.assign({}, x.st, { statut: "atteint" }) })), null);
  assert.equal(OV.probaInfo({}, x), null);
  assert.equal(OV.probaInfo(null, x), null);
});

test("carteHtml : statut conservé et probabilité à côté (mot + couleur) ; sans réponse du moteur, aucune probabilité ; hors_horizon = « pas de verdict »", () => {
  const a = OV.analyser(demoS(), DEPS, TODAY), x = a.liste[1];
  const sans = sp(OV.carteHtml(x, 3));
  assert.doesNotMatch(sans, /ov-proba|chances|probable|ui-puce/, "tant que le moteur n'a pas répondu : rien");
  assert.match(sans, /ui-badge (bon|info|attention|critique)">(atteint|en avance|dans les temps|en retard|hors de portée)</);
  const p = OV.probabilites(donneesMoteur([objMoteur(x.o.id, 0.62), objMoteur("loin", null, "hors_horizon")]));
  const avec = sp(OV.carteHtml(x, 3, OV.probaInfo(p, x)));
  assert.match(avec, /ui-badge (bon|info|attention|critique)">(atteint|en avance|dans les temps|en retard|hors de portée)</, "le statut existant reste");
  assert.match(avec, /class="ov-proba"><span class="ui-puce surveiller">.*incertain.*6 chances sur 10 d'y arriver/);
  const loin = sp(OV.carteHtml(x, 3, p.loin));
  assert.match(loin, /ui-badge">pas de verdict</);
  assert.doesNotMatch(loin, /en avance|dans les temps|en retard|hors de portée|chances sur 10|ui-puce/);
  assert.match(loin, /Pas de verdict : échéance au-delà de la projection/);
});

test("resumeObjectifs : un objectif sans verdict (hors_horizon) ne compte ni en bien ni en mal, il est dit à part", () => {
  const st = (s, h) => ({ o: { id: s }, st: { statut: s }, proba: h ? { horsHorizon: true } : null });
  const r = OV.resumeObjectifs([st("avance"), st("retard", true), st("dans_les_temps")]);
  assert.equal(r.ton, "bon"); assert.equal(r.sans, 1); assert.equal(r.n, 3);
  assert.match(r.verdict, /Tes 2 objectifs sont en bonne voie/);
  assert.match(r.detail, /1 en avance · 1 dans les temps · 1 sans verdict/);
  const tout = OV.resumeObjectifs([st("avance", true)]);
  assert.equal(tout.ton, "neutre"); assert.match(tout.verdict, /au-delà de l'horizon de la projection : pas de verdict/);
});

test("probaPhrase : chances sur 10 + mot, hors horizon, atteint, calcul en cours, erreur ; cible en euros d'aujourd'hui", () => {
  const a = OV.analyser(demoS(), DEPS, TODAY), x = a.liste.find(y => y.o.id === "obj-apport");
  const p = OV.probabilites(donneesMoteur([objMoteur("obj-apport", 0.83), objMoteur("loin", null, "hors_horizon")]));
  assert.equal(sp(OV.probaPhrase(x, p["obj-apport"], "pret")), "8 chances sur 10 d'atteindre la cible à l'échéance (juin 2029) : probable. Cible lue en euros d'aujourd'hui.");
  assert.match(sp(OV.probaPhrase(x, p.loin, "pret")), /au-delà de l'horizon de la projection \(25 ans\) : pas de verdict, aucune probabilité calculée/);
  assert.match(OV.probaPhrase(Object.assign({}, x, { st: { statut: "atteint" } }), null, "pret"), /La somme est déjà réunie/);
  assert.match(OV.probaPhrase(x, null, "calcul"), /en cours de calcul/);
  assert.match(OV.probaPhrase(x, null, "erreur"), /n'est pas disponible/);
  assert.match(OV.probaPhrase(x, null, "pret"), /Pas de probabilité calculée/);
});

test("capaciteDe / analyser : l'épargne retenue par le moteur remplace celle du budget pour répartir par priorité (statuts, note et projection parlent de la même épargne)", () => {
  assert.equal(OV.capaciteDe(donneesMoteur([])), 300);
  assert.equal(OV.capaciteDe(donneesMoteur([], { capacite_source: null, capacite: null })), 0, "pas de capacité connue : la projection suppose 0 €");
  assert.equal(OV.capaciteDe(null), null);
  assert.equal(OV.capaciteDe(donneesMoteur([], { etat: "calcul" })), null);
  const S = demoS();
  const budget = OV.analyser(S, DEPS, TODAY), moteur = OV.analyser(S, DEPS, TODAY, { capacite: 100 });
  assert.equal(budget.capacite, CAP_BUDGET);
  assert.equal(moteur.capacite, 100);
  assert.ok(Math.abs(moteur.liste.reduce((t, x) => t + x.st.versementAlloue, 0) - 100) < 0.01, "les 100 € du moteur sont répartis");
  assert.equal(OV.analyser(S, DEPS, TODAY, { capacite: -50 }).capacite, 0);
});

test("noteRepartition : même source que la ligne de la projection (capaciteSourceTxt), jamais deux sources ; budget seulement sans moteur", () => {
  const GP = require("../web/src/graphe-patrimoine.js");
  const reel = donneesMoteur([]), prevu = donneesMoteur([], { capacite_source: "prevu", capacite: { base: { retenue: 650, source: "prevu" } } });
  const aucune = donneesMoteur([], { capacite_source: null, capacite: null });
  for (const d of [reel, prevu]) {
    const ligne = sp(GP.capaciteSourceTxt(d)), note = sp(OV.noteRepartition(d, 650, false));
    assert.match(note, /^Épargne mensuelle répartie par priorité : /);
    assert.equal(note.split(" — ")[1], ligne.split(" — ")[1], "même source, mot pour mot");
  }
  assert.equal(sp(OV.noteRepartition(reel, 650, false)), "Épargne mensuelle répartie par priorité : 300 € — ta capacité d'épargne constatée (avril à septembre 2026, comptes courants).");
  assert.match(sp(OV.noteRepartition(prevu, 650, false)), /650 € — ta capacité d'épargne prévue au budget \(pas encore de comptes connectés\)\.$/);
  assert.match(sp(OV.noteRepartition(aucune, 650, false)), /^Pas encore de capacité d'épargne connue : la projection suppose 0 € par mois\./);
  assert.equal(OV.noteRepartition(null, 650, true), "", "calcul en cours : aucun chiffre provisoire");
  assert.match(sp(OV.noteRepartition(null, 650, false)), /650 €\/mois — ta capacité d'épargne prévue au budget\.$/, "moteur absent ou en erreur : le budget, dit comme tel");
  for (const t of [reel, prevu, aucune].map(d => OV.noteRepartition(d, 650, false))) assert.doesNotMatch(t, /réel|scénario|et reste positif/);
});

test("bandeau : mémorisé dans le stockage local, accès protégé (stockage indisponible : montré, non mémorisé)", () => {
  const mem = {}, ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  assert.equal(OV.bandeauVu(ls), false);
  assert.equal(OV.bandeauFerme(ls), true);
  assert.equal(OV.bandeauVu(ls), true);
  const casse = { getItem() { throw new Error("bloqué"); }, setItem() { throw new Error("bloqué"); } };
  assert.equal(OV.bandeauVu(casse), false);
  assert.equal(OV.bandeauFerme(casse), false);
  assert.equal(OV.bandeauVu(null), false);
});

test("aucun appel à Plan.projection ni à Plan.RENDEMENTS dans web/src (hors plan.js et historique.js, que le contrôleur reprend)", () => {
  const exclus = new Set(["plan.js", "historique.js"]);
  const fautifs = readdirSync("web/src").filter(f => /\.(js|html)$/.test(f) && !exclus.has(f) && !/\.gen\.js$/.test(f)).filter(f => {
    const t = readFileSync("web/src/" + f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
    return /\bPlan\.(projection|RENDEMENTS)\b|\.RENDEMENTS\b|\bP\(\)\.projection\b/.test(t);
  });
  assert.deepEqual(fautifs, []);
});

/* ------------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------------ */
const uiJs = readFileSync("web/src/ui.js", "utf8");
const planJs = readFileSync("web/src/plan.js", "utf8");
const calcJs = readFileSync("web/src/calc.js", "utf8");
const reperesJs = readFileSync("web/src/reperes.js", "utf8");
const promptsJs = readFileSync("web/src/claude-prompts.js", "utf8");
const formatJs = readFileSync("web/src/format.js", "utf8"), grapheJs = readFileSync("web/src/graphe-patrimoine.js", "utf8");
/* GrapheModele de remplacement : consigne les calculs demandés (réponse déclenchée par le test : calculs[i].fin(donnees)) et les graphes montés. */
function modeleFactice(c) {
  const t = { calculs: [], liaisons: [] };
  c.GrapheModele = {
    reglagesParDefaut: p => Object.assign({ vue: "net" }, p),
    signature: (S, r, jour) => JSON.stringify([S.scope, S.objectifs, S.budget && S.budget.lignes, r.vue, jour]),
    calculer: (S, r, o) => { const e = { S, r, o }; t.calculs.push(e); return new Promise(res => { e.fin = d => { o.rappel(d, { etape: "complet" }); res(d); }; }); },
    brancher: (el, opt) => {
      const l = { el, opt, actualisations: 0, detruit: false, actualiser() { this.actualisations++; }, detruire() { this.detruit = true; }, reglages: () => ({}) };
      el.innerHTML = '<div class="gp-factice"></div>'; t.liaisons.push(l); return l;
    },
  };
  return t;
}
function vueDom(S0, o) {
  const dom = miniDom(), { doc } = dom;
  let S = J(S0);
  const acces = [];
  const modules = {};
  const c = { document: doc, console, setTimeout, clearTimeout, CSS: { escape: s => String(s).replace(/["\\]/g, "\\$&") } };
  c.window = c; c.self = c;
  c.App = { register: (n, api) => { modules[n] = api; }, refreshHeadlines() {}, parametres: () => ({}) };
  // Tout accès au store (db, écritures) est consigné : la vue ne doit jamais y toucher.
  c.Store = new Proxy({ get: () => S }, { get: (o, k) => { if (k !== "get") acces.push(String(k)); return o[k]; } });
  const mem = {};
  c.localStorage = (o && o.stockage) || { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  vm.createContext(c);
  vm.runInContext(formatJs, c, { filename: "format.js" });
  vm.runInContext(calcJs, c, { filename: "calc.js" });
  vm.runInContext(planJs, c, { filename: "plan.js" });
  vm.runInContext(reperesJs, c, { filename: "reperes.js" });
  vm.runInContext(uiJs, c, { filename: "ui.js" });
  vm.runInContext(promptsJs, c, { filename: "claude-prompts.js" });
  vm.runInContext(grapheJs, c, { filename: "graphe-patrimoine.js" });
  const modele = (o && o.sansModele) ? null : modeleFactice(c);
  vm.runInContext(js, c, { filename: "objectifs-view.js" });
  // Compteur d'analyses : Plan.affecterDeja est appelé une fois par analyse ; Plan.projection ne doit plus jamais être appelé.
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
  return { c, dom, doc, root, api, S: () => S, acces, compte, modele, ls: c.localStorage, mem };
}
const dlgDe = doc => doc.body.querySelector('[role="dialog"]');
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

/* Réponse complète du moteur pour la démo : une probabilité par objectif, la source de l'épargne. */
const reponse = (v, probas, extra) => {
  const objs = ["obj-matelas", "obj-apport", "obj-retraite"].map((id, i) => objMoteur(id, probas[i], probas[i] === "h" ? "hors_horizon" : "dans_les_temps"));
  objs.forEach(o => { if (o.probabilite === "h") o.probabilite = null; });
  const e = v.modele.calculs[v.modele.calculs.length - 1];
  e.fin(donneesMoteur(objs, extra));
  return e;
};

test("vue (DOM) : analyser() une fois par émission du store (cartes, panneau, titre de navigation) ; la réponse du moteur en refait une", () => {
  const v = vueDom(demoS());
  carte(v.root, "obj-apport").click();
  v.compte.analyses = 0;
  v.api.update(J(v.S()), true);
  v.api.headline();
  assert.equal(v.compte.analyses, 1, "une seule analyse pour le rendu, le panneau et le titre");
  v.api.update(J(v.S()), true);
  assert.equal(v.compte.analyses, 2);
  assert.equal(v.compte.projections, 0, "Plan.projection n'est jamais appelé");
});

test("vue (DOM) : l'accordéon monte le graphe maître (préréglage objectifs, vue financier) à la première ouverture, pas avant ; plus de champ versement ni de « réel »", () => {
  const v = vueDom(demoS());
  assert.equal(v.modele.liaisons.length, 0, "fermé : rien n'est monté (pas de largeur à mesurer)");
  assert.equal(v.root.querySelector("#ovGraphe").innerHTML, "");
  ouvrirProj(v);
  assert.equal(v.modele.liaisons.length, 1);
  const l = v.modele.liaisons[0];
  assert.equal(l.el, v.root.querySelector("#ovGraphe"));
  assert.equal(l.opt.preset, "objectifs");
  assert.equal(l.opt.objectifId, undefined, "accordéon : tous les objectifs");
  assert.equal(typeof l.opt.today, "function"); assert.match(l.opt.today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(l.opt.perimetre(), "du foyer");
  assert.equal(l.opt.deps.UI, v.c.UI);
  assert.ok(l.actualisations >= 1, "le graphe reçoit l'état du store");
  assert.equal(v.root.querySelectorAll("input").length, 0);
  assert.equal(v.root.querySelector("#ovVers"), null);
  assert.equal(v.root.querySelector("#ovHorizon"), null);
  assert.doesNotMatch(sp(v.root.textContent), /Versement mensuel|scénario|simulation locale|\bréel\b|Hypothèses de rendement|Pessimiste/i);
  assert.equal(v.compte.projections, 0);
  assert.deepEqual(v.acces, [], "le graphe n'écrit rien");
});

test("vue (DOM) : le graphe de l'accordéon suit les émissions du store (actualiser) sans être remonté", () => {
  const v = vueDom(demoS());
  ouvrirProj(v);
  const l = v.modele.liaisons[0], n = l.actualisations;
  v.api.update(J(v.S()), true);
  assert.equal(v.modele.liaisons.length, 1, "monté une seule fois");
  assert.equal(l.actualisations, n + 1);
  v.root.querySelector("#ovProjAcc").removeAttribute("open");
  v.api.update(J(v.S()), true);
  assert.equal(l.actualisations, n + 1, "accordéon refermé : pas de travail inutile");
});

test("vue (DOM) : ligne de source de l'épargne — une seule source, celle du moteur ; la note de répartition dit la même", () => {
  const v = vueDom(demoS());
  const src = v.root.querySelector("#ovCapSrc"), note = v.root.querySelector("#ovNote");
  assert.equal(src.hidden, true, "rien avant la réponse du moteur");
  assert.doesNotMatch(sp(note.textContent), /€|Épargne mensuelle/, "calcul en cours : pas de chiffre provisoire");
  reponse(v, [0.9, 0.62, 0.3]);
  assert.equal(src.hidden, false);
  assert.equal(sp(src.textContent), "Épargne mensuelle projetée : 300 € — ta capacité d'épargne constatée (avril à septembre 2026, comptes courants).");
  assert.ok(sp(note.textContent).split(" — ")[1].startsWith(sp(src.textContent).split(" — ")[1]), "même source, mot pour mot");
  assert.match(sp(note.textContent), /^Épargne mensuelle répartie par priorité : 300 €/);
  const tout = sp(v.root.textContent);
  assert.equal((tout.match(/ta capacité d'épargne/g) || []).length, 2, "la source est dite par la ligne et la note, jamais en deux versions");
  assert.doesNotMatch(tout, /prévue au budget|\bréel\b|et reste positif/);
});

test("vue (DOM) : sans compte connecté, la source est le budget dit comme tel ; sans capacité connue, la projection suppose 0 € ; moteur en erreur : le budget, sans ligne de projection", () => {
  const v = vueDom(demoS());
  v.modele.calculs[0].fin(donneesMoteur([], { capacite_source: "prevu", capacite: { base: { retenue: 650, source: "prevu" } } }));
  assert.match(sp(v.root.querySelector("#ovCapSrc").textContent), /650 € — ta capacité d'épargne prévue au budget \(pas encore de comptes connectés\)\./);
  const w = vueDom(demoS());
  w.modele.calculs[0].fin(donneesMoteur([], { capacite_source: null, capacite: null }));
  assert.match(sp(w.root.querySelector("#ovCapSrc").textContent), /^Pas encore de capacité d'épargne connue : la projection suppose 0 € par mois\./);
  assert.match(sp(w.root.querySelector("#ovNote").textContent), /^Pas encore de capacité d'épargne connue/);
  const e = vueDom(demoS());
  e.modele.calculs[0].fin({ etat: "erreur", erreur: "boum" });
  assert.equal(e.root.querySelector("#ovCapSrc").hidden, true);
  assert.match(sp(e.root.querySelector("#ovNote").textContent), /1 578 €\/mois — ta capacité d'épargne prévue au budget\./);
  const sans = vueDom(demoS(), { sansModele: true });
  assert.match(sp(sans.root.querySelector("#ovNote").textContent), /1 578 €\/mois — ta capacité d'épargne prévue au budget\./, "moteur absent : le budget");
  assert.equal(sans.root.querySelectorAll("[data-ui-carte]").length, 3, "les cartes restent là sans le moteur");
});

test("vue (DOM) : le calcul du moteur est demandé une fois par entrée (vue financier, périmètre, jour), pas à chaque émission identique", () => {
  const v = vueDom(demoS());
  assert.equal(v.modele.calculs.length, 1);
  assert.equal(v.modele.calculs[0].r.vue, "financier");
  assert.equal(v.modele.calculs[0].o.perimetre, "du foyer");
  v.api.update(J(v.S()), true);
  v.api.update(J(v.S()), true);
  assert.equal(v.modele.calculs.length, 1, "même entrée : le moteur n'est pas relancé");
  const S2 = J(v.S()); S2.objectifs[0].cible = 25000;
  v.api.update(S2, true);
  assert.equal(v.modele.calculs.length, 2, "entrée changée : nouveau calcul");
  v.modele.calculs[0].fin(donneesMoteur([objMoteur("obj-matelas", 0.1)]));
  assert.doesNotMatch(sp(v.root.querySelector("#ovCartes").textContent), /chances sur 10/, "réponse périmée ignorée");
});

test("vue (DOM) : cartes — statuts existants, probabilité du moteur (mot + chances) à côté quand il a répondu, rien avant", () => {
  const v = vueDom(demoS());
  const zone = v.root.querySelector("#ovCartes");
  assert.doesNotMatch(sp(zone.textContent), /chances sur 10|probable|incertain|ov-proba/);
  assert.equal(zone.querySelectorAll(".ov-proba").length, 0);
  const badges = () => zone.querySelectorAll(".ui-badge").map(b => b.textContent);
  const avant = badges();
  assert.equal(avant.length, 3);
  reponse(v, [0.9, 0.62, 0.3], { capacite: { base: { retenue: CAP_BUDGET, source: "reel", periode: "avril à septembre 2026" } } });
  const cs = ["obj-matelas", "obj-apport", "obj-retraite"].map(id => sp(carte(v.root, id).textContent));
  assert.doesNotMatch(cs[0], /chances|probable/, "objectif déjà atteint (la somme est réunie) : pas de probabilité à côté");
  assert.match(cs[1], /incertain.*6 chances sur 10 d'y arriver/);
  assert.match(cs[2], /peu probable.*3 chances sur 10 d'y arriver/);
  assert.deepEqual(zone.querySelectorAll(".ui-puce").map(p => p.className), ["ui-puce surveiller", "ui-puce travailler"], "la couleur dit la même chose que le mot");
  assert.deepEqual(badges(), avant, "les statuts existants restent (même épargne que celle du budget)");
  assert.deepEqual(v.acces, []);
});

test("vue (DOM) : l'épargne retenue par le moteur répartit l'épargne entre les objectifs : les statuts parlent de la même épargne que la projection", () => {
  const v = vueDom(demoS());
  const zone = v.root.querySelector("#ovCartes");
  const avant = zone.querySelectorAll(".ui-badge").map(b => b.textContent);
  reponse(v, [0.9, 0.62, 0.3], { capacite: { base: { retenue: 0, source: "reel", periode: "avril à septembre 2026" } } });
  const apres = zone.querySelectorAll(".ui-badge").map(b => b.textContent);
  const connus = ["atteint", "en avance", "dans les temps", "en retard", "hors de portée"];
  apres.forEach(t => assert.ok(connus.includes(t), t));
  assert.notDeepEqual(apres, avant, "sans épargne retenue, l'apport n'est plus dans les temps");
});

test("vue (DOM) : objectif hors_horizon = « pas de verdict », aucune probabilité affichée, ni sur la carte ni dans le panneau", () => {
  const v = vueDom(demoS());
  reponse(v, [0.9, "h", 0.3]);
  const c = sp(carte(v.root, "obj-apport").textContent);
  assert.match(c, /pas de verdict/);
  assert.match(c, /Pas de verdict : échéance au-delà de la projection \(25 ans\)/);
  assert.doesNotMatch(c, /chances|probable|incertain|en avance|dans les temps|en retard|hors de portée/);
  assert.match(sp(v.root.querySelector("#ovVerdict").textContent), /sans verdict|objectif/);
  carte(v.root, "obj-apport").click();
  const d = sp(dlgDe(v.doc).textContent);
  assert.match(d, /au-delà de l'horizon de la projection \(25 ans\) : pas de verdict, aucune probabilité calculée/);
  assert.doesNotMatch(d, /chances sur 10/);
});

test("vue (DOM) : panneau d'un objectif — graphe maître (préréglage objectifs + objectifId) dans le contenu, phrase de probabilité, phrase honnête, détruit à la fermeture", () => {
  const v = vueDom(demoS());
  carte(v.root, "obj-apport").click();
  const dlg = dlgDe(v.doc);
  assert.equal(v.modele.liaisons.length, 1);
  const l = v.modele.liaisons[0];
  assert.equal(l.opt.preset, "objectifs"); assert.equal(l.opt.objectifId, "obj-apport");
  assert.ok(dlg.querySelector(".ui-panneau-corps").contains(l.el), "monté dans le contenu du panneau");
  assert.equal(l.el.getAttribute("data-ov-graphe"), "");
  assert.equal(l.detruit, false);
  assert.doesNotMatch(dlg.querySelectorAll(".ov-sec").map(x => x.innerHTML).join(""), /<svg/, "plus de mini-courbe « serieSvg »");
  const phrase = () => sp(dlg.querySelector("[data-ov-proba]").textContent);
  assert.match(phrase(), /en cours de calcul/, "pas de chiffre provisoire");
  assert.match(sp(dlg.textContent), /Ce graphe montre le patrimoine financier du foyer avec cet objectif marqué à son échéance/);
  assert.match(sp(dlg.textContent), /Ce n'est pas la trajectoire des seules poches de l'objectif/);
  // la réponse du moteur se pose sur place : même contenu, même graphe (pas de remontage)
  const el0 = dlg.querySelector("[data-ov-graphe]");
  reponse(v, [0.9, 0.83, 0.3], { capacite: { base: { retenue: CAP_BUDGET, source: "reel", periode: "avril à septembre 2026" } } });
  assert.equal(phrase(), "8 chances sur 10 d'atteindre la cible à l'échéance (juin 2029) : probable. Cible lue en euros d'aujourd'hui.");
  assert.equal(dlg.querySelector("[data-ov-proba]").getAttribute("data-ton"), "bon");
  assert.equal(dlg.querySelector("[data-ov-graphe]"), el0);
  assert.equal(v.modele.liaisons.length, 1, "le graphe n'est pas remonté");
  assert.equal(l.detruit, false);
  assert.ok(l.actualisations >= 2);
  assert.match(sp(dlg.textContent), /Effort requis/, "les lignes de détail restent");
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true);
  assert.equal(l.detruit, true, "graphe détruit à la fermeture");
});

test("vue (DOM) : une feuille du graphe (réglages…) ouverte dans le panneau n'efface pas l'objectif : on y revient à sa fermeture ; navigation : le panneau reste fermé", () => {
  const v = vueDom(demoS());
  carte(v.root, "obj-apport").click();
  const dlg = dlgDe(v.doc), l0 = v.modele.liaisons[0];
  assert.notEqual(l0.opt.deps.UI, v.c.UI, "le graphe reçoit une UI dont le panneau garde l'objectif");
  l0.opt.deps.UI.panneau.ouvrir({ titre: "Réglages du graphique", contenu: "<p>réglages</p>" });
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Réglages du graphique");
  v.api.update(J(v.S()), true); // une émission du store pendant la feuille ne reprend pas le panneau
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Réglages du graphique");
  v.c.UI.panneau.fermer();
  assert.equal(dlg.hidden, false);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Apport maison", "retour à l'objectif");
  assert.equal(l0.detruit, true);
  const l1 = v.modele.liaisons[v.modele.liaisons.length - 1];
  assert.equal(l1.opt.objectifId, "obj-apport"); assert.equal(l1.detruit, false);
  assert.ok(dlg.querySelector(".ui-panneau-corps").contains(l1.el));
  // fermeture par navigation (focus: false) : rien ne se rouvre, graphe détruit
  l1.opt.deps.UI.panneau.ouvrir({ titre: "Lecture", contenu: "<p>x</p>" });
  v.c.UI.panneau.fermer({ focus: false });
  assert.equal(dlg.hidden, true);
  assert.equal(l1.detruit, true);
  // une vraie fermeture de l'objectif (Échap) détruit son graphe
  carte(v.root, "obj-apport").click();
  const l2 = v.modele.liaisons[v.modele.liaisons.length - 1];
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true); assert.equal(l2.detruit, true);
});

test("objectifs-view.css : le panneau n'offre pas le « plein écran » du graphe (il passerait derrière la feuille)", () => {
  assert.match(css, /\.ui-panneau \.ov-graphe \[data-act="plein"\]/);
});

test("vue (DOM) : panneau rafraîchi (objectif modifié) → ancien graphe détruit, nouveau monté dans le nouveau contenu", () => {
  const v = vueDom(demoS());
  carte(v.root, "obj-retraite").click();
  const l0 = v.modele.liaisons[0];
  const S2 = J(v.S()); S2.objectifs.find(o => o.id === "obj-retraite").nom = "Retraite anticipée";
  v.api.update(S2, true);
  assert.equal(l0.detruit, true);
  assert.equal(v.modele.liaisons.length, 2);
  assert.equal(v.modele.liaisons[1].opt.objectifId, "obj-retraite");
  assert.equal(v.modele.liaisons[1].detruit, false);
  assert.ok(dlgDe(v.doc).querySelector(".ui-panneau-corps").contains(v.modele.liaisons[1].el));
});

test("vue (DOM) : bandeau unique « cibles en euros d'aujourd'hui » — montré, fermable, mémorisé, tutoiement ; absent sans objectif", () => {
  const v = vueDom(demoS());
  const b = v.root.querySelector("#ovBandeau");
  assert.equal(b.hidden, false);
  assert.equal(v.root.querySelectorAll("[role=\"note\"]").length, 1, "un seul bandeau");
  const t = sp(b.textContent);
  assert.match(t, /tes cibles sont maintenant lues en euros d'aujourd'hui/);
  assert.match(t, /dis-le à Claude/);
  assert.doesNotMatch(t, VOUVOIEMENT);
  b.querySelector("[data-ov-bandeau-x]").click();
  assert.equal(b.hidden, true);
  assert.equal(v.mem["boussole.objectifs.cibles-euros-aujourdhui"], "1", "fermeture mémorisée");
  v.api.update(J(v.S()), true);
  assert.equal(b.hidden, true, "reste fermé après un nouveau rendu");
  // nouvelle visite : lu dans le stockage
  const w = vueDom(demoS(), { stockage: v.ls });
  assert.equal(w.root.querySelector("#ovBandeau").hidden, true);
  // sans objectif : pas de bandeau
  assert.equal(vueDom(Object.assign(demoS(), { objectifs: [] })).root.querySelector("#ovBandeau").hidden, true);
  // stockage indisponible : le bandeau se ferme quand même pour la session
  const casse = { getItem() { throw new Error("bloqué"); }, setItem() { throw new Error("bloqué"); } };
  const x = vueDom(demoS(), { stockage: casse });
  assert.equal(x.root.querySelector("#ovBandeau").hidden, false);
  x.root.querySelector("[data-ov-bandeau-x]").click();
  assert.equal(x.root.querySelector("#ovBandeau").hidden, true);
  x.api.update(J(x.S()), true);
  assert.equal(x.root.querySelector("#ovBandeau").hidden, true);
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
  w.modele.calculs[0].fin(donneesMoteur([objMoteur("obj-matelas", 0.9), objMoteur("obj-apport", null, "hors_horizon"), objMoteur("obj-p5", 0.4)]));
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
  const ctx = { positions: S.positions, scope: "foyer", Calc, Plan, n: 3, duScope: "du foyer", U: UI };
  const h = OV.detailHtml(x, ctx);
  const CV = require("../web/src/comptes-view.js");
  const r = CV.lien({ enveloppe: "PEA Camille", titulaire: "p1" });
  assert.ok(h.includes('<a href="#' + r.replace(/&/g, "&amp;") + '" data-goto="' + r.replace(/&/g, "&amp;") + '">PEA Camille</a>'), "titulaire unique de l'enveloppe");
  assert.match(h, /data-goto="patrimoine\/comptes\?enveloppe=Livrets%20%3CSam%3E">Livrets &lt;Sam&gt;<\/a>/, "échappé, encodé ; titulaire inconnu → sans titulaire");
  assert.doesNotMatch(h, /data-goto="[^"]*bloc|>Épargne<\/a>/, "les poches ne sont pas des fiches");
});
