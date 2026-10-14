// Bibliothèque de composants (web/src/ui.js + ui.css) : carte, panneau, onglets, bascule, accordéon, voir plus,
// sélecteur de période, « Demander à Claude ». Fonctions de rendu testées en pur ; comportements testés dans un mini-DOM factice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";
import { lireExpertises } from "../scripts/gen-expertises-demo.mjs";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/ui.js", "utf8");
const css = readFileSync("web/src/ui.css", "utf8");
const periodesJs = readFileSync("web/src/periodes.js", "utf8");
const UI = require("../web/src/ui.js");

const XSS = `<img src=x onerror="alert(1)">'&`;
const simple = o => JSON.parse(JSON.stringify(o)); // objets venus du contexte vm → objets ordinaires
const sansBalise = html => !/<img/i.test(html) && !html.includes('onerror="');

/** Charge ui.js (et éventuellement periodes.js) dans un contexte vm muni du mini-DOM ; renvoie { UI, dom, ctx }. */
function charger(avecPeriodes) {
  const dom = miniDom();
  const ctx = { document: dom.doc, console };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  if (avecPeriodes) vm.runInContext(periodesJs, ctx, { filename: "periodes.js" });
  vm.runInContext(js, ctx, { filename: "ui.js" });
  return { UI: ctx.UI, dom, ctx };
}

/* ============================================================ module ============================================================ */

test("ui.js : UMD, global UI dans le navigateur, module.exports dans Node, API complète", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "ui.js" }));
  const { UI: G } = charger(false);
  for (const f of ["esc", "carte", "onglets", "bascule", "accordeon", "voirPlus", "brancher", "periode", "demanderAClaude", "urlClaude", "markdown"])
    assert.equal(typeof G[f], "function", "UI." + f);
  for (const f of ["ouvrir", "fermer", "ouvert", "remplacer"]) assert.equal(typeof G.panneau[f], "function", "UI.panneau." + f);
  assert.equal(typeof UI.carte, "function");
  assert.equal(typeof UI.htmlOnglets, "function");
  assert.equal(typeof UI.htmlBascule, "function");
  assert.equal(typeof UI.cibleClavier, "function");
});

test("ui.js : l'API est documentée en tête de fichier (signature et exemple par composant)", () => {
  const tete = js.slice(0, js.indexOf("(function"));
  for (const nom of ["UI.esc", "UI.carte", "UI.panneau.ouvrir", "UI.panneau.fermer", "UI.panneau.ouvert", "UI.onglets", "UI.bascule",
    "UI.accordeon", "UI.voirPlus", "UI.brancher", "UI.periode", "UI.demanderAClaude", "UI.urlClaude", "UI.markdown", "UI.panneau.remplacer"])
    assert.ok(tete.includes(nom), "doc manquante : " + nom);
  assert.ok((tete.match(/Exemple/g) || []).length >= 8, "un exemple par composant");
});

test("ui.js : tout innerHTML reçoit du HTML construit par la bibliothèque (échappé) ou un contenu documenté comme déjà échappé", () => {
  const code = js.slice(js.indexOf("(function"));
  const lignes = code.split("\n").filter(l => /\.innerHTML\s*=/.test(l));
  assert.ok(lignes.length >= 3);
  const permis = /\.innerHTML\s*=\s*(html[A-Z]\w*\(|PANNEAU_HTML|contenuHtml\b|"")/;
  assert.deepEqual(lignes.filter(l => !permis.test(l)), []);
  assert.ok(!/insertAdjacentHTML|outerHTML\s*=|document\.write/.test(js));
  // le titre du panneau passe par textContent, jamais par innerHTML
  assert.match(js, /titreEl\.textContent\s*=/);
});

/* ============================================================ esc ============================================================ */

test("esc : échappe & < > \" ' et rend une chaîne vide pour null/undefined", () => {
  assert.equal(UI.esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(UI.esc(null), "");
  assert.equal(UI.esc(undefined), "");
  assert.equal(UI.esc(0), "0");
});

/* ============================================================ carte ============================================================ */

test("carte : bouton focalisable, structure, identifiant", () => {
  const h = UI.carte({ id: "net", titre: "Patrimoine net", valeur: "512 300 €", sous: "sur 1 an" });
  assert.match(h, /^<button type="button" class="ui-carte" data-ui-carte="net"/);
  assert.match(h, /aria-haspopup="dialog"/);
  assert.match(h, /<span class="ui-carte-titre">Patrimoine net<\/span>/);
  assert.match(h, /<span class="ui-carte-valeur">512 300 €<\/span>/);
  assert.match(h, /<span class="ui-carte-sous">sur 1 an<\/span>/);
  assert.match(h, /<\/button>$/);
  assert.ok(!/<(div|p|h\d)\b/.test(h), "contenu phrasé seulement dans un bouton");
  assert.match(UI.carte({ titre: "Écart" }), /<span class="ui-carte-valeur">—<\/span>/, "valeur absente → tiret");
});

test("carte : tendance ▲/▼/– avec classe pos/neg/neutre et texte lisible au lecteur d'écran", () => {
  const h = UI.carte({ id: "a", titre: "T", valeur: "1", tendance: { sens: "hausse", texte: "+3,2 %" } });
  assert.match(h, /class="ui-tendance pos"/);
  assert.match(h, /<span class="ui-tendance-fleche" aria-hidden="true">▲<\/span>/);
  assert.match(h, /<span class="ui-sr">En hausse : <\/span>\+3,2 %/);
  const b = UI.carte({ id: "a", titre: "T", valeur: "1", tendance: { sens: "baisse", texte: "-1 %" } });
  assert.match(b, /class="ui-tendance neg"/); assert.match(b, />▼</); assert.match(b, /En baisse/);
  const s = UI.carte({ id: "a", titre: "T", valeur: "1", tendance: { sens: "stable", texte: "0 %" } });
  assert.match(s, /class="ui-tendance neutre"/); assert.match(s, />–</); assert.match(s, /Stable/);
  // une dette qui baisse est une bonne nouvelle : le ton se force
  assert.match(UI.carte({ id: "d", titre: "Dette", tendance: { sens: "baisse", texte: "-2 %", ton: "pos" } }), /class="ui-tendance pos"/);
  assert.match(UI.carte({ id: "d", titre: "T", tendance: { sens: "hausse", ton: "<x>" } }), /class="ui-tendance pos"/, "ton inconnu ignoré");
  assert.ok(!UI.carte({ id: "a", titre: "T" }).includes("ui-tendance"));
});

test("carte : badge optionnel (texte ou { texte, ton })", () => {
  assert.match(UI.carte({ id: "p", titre: "T", badge: "Provisoire" }), /<span class="ui-badge neutre">Provisoire<\/span>/);
  assert.match(UI.carte({ id: "p", titre: "T", badge: { texte: "À faire", ton: "attention" } }), /<span class="ui-badge attention">À faire<\/span>/);
  assert.match(UI.carte({ id: "p", titre: "T", badge: { texte: "x", ton: "\" onclick=\"" } }), /<span class="ui-badge neutre">/);
  assert.ok(!UI.carte({ id: "p", titre: "T" }).includes("ui-badge"));
});

test("carte : chaque champ texte est échappé", () => {
  const h = UI.carte({ id: XSS, titre: XSS, valeur: XSS, sous: XSS, badge: XSS, tendance: { sens: "hausse", texte: XSS } });
  assert.ok(sansBalise(h), h);
  assert.equal((h.match(/&lt;img/g) || []).length, 6);
  assert.match(h, /data-ui-carte="&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&#39;&amp;"/);
  const h2 = UI.carte({ id: "x", titre: "T", badge: { texte: XSS, ton: "bon" } });
  assert.ok(sansBalise(h2));
});

/* ============================================================ onglets, bascule, clavier ============================================================ */

test("htmlOnglets : tablist, tab, aria-selected, tabindex itinérant, échappement", () => {
  const h = UI.htmlOnglets({ label: "Vues", onglets: [{ id: "a", label: "Alpha" }, { id: "b", label: "Bêta", controle: "panB" }], actif: "b" });
  assert.match(h, /^<div class="ui-onglets" role="tablist" aria-label="Vues">/);
  assert.equal((h.match(/role="tab"/g) || []).length, 2);
  assert.match(h, /<button type="button" class="ui-onglet" role="tab" data-ui-id="a" aria-selected="false" tabindex="-1">Alpha<\/button>/);
  assert.match(h, /data-ui-id="b" aria-selected="true" tabindex="0" aria-controls="panB">Bêta</);
  assert.match(UI.htmlOnglets({ onglets: [{ id: "a", label: "A" }, { id: "b", label: "B" }], actif: "zz" }), /data-ui-id="a" aria-selected="true"/, "actif inconnu → premier");
  const x = UI.htmlOnglets({ label: XSS, onglets: [{ id: XSS, label: XSS, controle: XSS }] });
  assert.ok(sansBalise(x)); assert.equal((x.match(/&lt;img/g) || []).length, 4);
});

test("htmlBascule : radiogroup, radio, aria-checked, nom long optionnel, échappement", () => {
  const h = UI.htmlBascule({ label: "Vue", options: [{ id: "m", label: "1 m", aria: "1 mois" }, { id: "a", label: "1 an" }], actif: "a" });
  assert.match(h, /^<div class="ui-bascule" role="radiogroup" aria-label="Vue">/);
  assert.match(h, /<button type="button" class="ui-bascule-option" role="radio" data-ui-id="m" aria-checked="false" tabindex="-1" aria-label="1 mois">1 m<\/button>/);
  assert.match(h, /data-ui-id="a" aria-checked="true" tabindex="0">1 an</);
  const x = UI.htmlBascule({ label: XSS, options: [{ id: XSS, label: XSS, aria: XSS }] });
  assert.ok(sansBalise(x)); assert.equal((x.match(/&lt;img/g) || []).length, 4);
});

test("cibleClavier : flèches avec retour au début, Début/Fin, haut/bas seulement pour les boutons radio", () => {
  const c = UI.cibleClavier;
  assert.equal(c("ArrowRight", 0, 3), 1);
  assert.equal(c("ArrowRight", 2, 3), 0);
  assert.equal(c("ArrowLeft", 0, 3), 2);
  assert.equal(c("ArrowLeft", 2, 3), 1);
  assert.equal(c("Home", 2, 3), 0);
  assert.equal(c("End", 0, 3), 2);
  assert.equal(c("ArrowDown", 0, 3), null);
  assert.equal(c("ArrowDown", 0, 3, true), 1);
  assert.equal(c("ArrowUp", 0, 3, true), 2);
  assert.equal(c("Enter", 0, 3), null);
  assert.equal(c("a", 0, 3), null);
});

test("onglets (DOM) : clic et flèches changent l'onglet, déplacent le focus, appellent surChange", () => {
  const { UI: G, dom } = charger(false);
  const racine = dom.doc.body.appendChild(dom.doc.createElement("div"));
  const vus = [];
  const ctl = G.onglets(racine, { label: "Vues", onglets: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }], actif: "a", surChange: id => vus.push(id) });
  const tabs = () => racine.querySelectorAll('[role="tab"]');
  assert.equal(tabs().length, 3);
  tabs()[1].click();
  assert.deepEqual(vus, ["b"]);
  assert.equal(tabs()[1].getAttribute("aria-selected"), "true");
  assert.equal(tabs()[0].getAttribute("aria-selected"), "false");
  assert.equal(tabs()[1].getAttribute("tabindex"), "0");
  assert.equal(tabs()[0].getAttribute("tabindex"), "-1");
  const e = dom.touche(tabs()[1], "ArrowRight");
  assert.ok(e.defaultPrevented);
  assert.equal(dom.doc.activeElement, tabs()[2]);
  assert.deepEqual(vus, ["b", "c"]);
  dom.touche(tabs()[2], "ArrowRight");
  assert.equal(dom.doc.activeElement, tabs()[0], "retour au début");
  dom.touche(tabs()[0], "End");
  assert.equal(dom.doc.activeElement, tabs()[2]);
  dom.touche(tabs()[2], "Home");
  assert.equal(dom.doc.activeElement, tabs()[0]);
  assert.equal(dom.touche(tabs()[0], "ArrowDown").defaultPrevented, false, "haut/bas laissés au défilement");
  assert.deepEqual(vus, ["b", "c", "a", "c", "a"]);
  tabs()[0].click();
  assert.equal(vus.length, 5, "pas de surChange si l'onglet ne change pas");
  ctl.choisir("b");
  assert.equal(ctl.actif(), "b");
  assert.equal(tabs()[1].getAttribute("aria-selected"), "true");
  assert.equal(vus.length, 5, "choisir() par programme reste silencieux");
  // rebrancher la même racine ne double pas les écouteurs
  const vus2 = [];
  G.onglets(racine, { onglets: [{ id: "a", label: "A" }, { id: "b", label: "B" }], actif: "a", surChange: id => vus2.push(id) });
  tabs()[1].click();
  assert.deepEqual(vus2, ["b"]); assert.equal(vus.length, 5);
});

test("bascule (DOM) : radiogroup au clavier (quatre flèches), aria-checked, surChange", () => {
  const { UI: G, dom } = charger(false);
  const racine = dom.doc.body.appendChild(dom.doc.createElement("div"));
  const vus = [];
  G.bascule(racine, { label: "Mode", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], actif: "y", surChange: id => vus.push(id) });
  const r = () => racine.querySelectorAll('[role="radio"]');
  assert.ok(racine.querySelector('[role="radiogroup"]'));
  assert.equal(r()[1].getAttribute("aria-checked"), "true");
  dom.touche(r()[1], "ArrowDown");
  assert.equal(dom.doc.activeElement, r()[0]);
  assert.equal(r()[0].getAttribute("aria-checked"), "true");
  assert.equal(r()[1].getAttribute("aria-checked"), "false");
  dom.touche(r()[0], "ArrowLeft");
  assert.equal(dom.doc.activeElement, r()[1]);
  r()[0].click();
  assert.deepEqual(vus, ["x", "y", "x"]);
});

/* ============================================================ accordéon, voir plus, brancher ============================================================ */

test("accordeon : <details> fermé par défaut, titre échappé, contenu HTML tel quel", () => {
  const h = UI.accordeon({ titre: "Méthode", contenu: "<p>Calcul</p>" });
  assert.match(h, /^<details class="ui-acc">/);
  assert.match(h, /<summary class="ui-acc-titre"><span>Méthode<\/span>/);
  assert.match(h, /<div class="ui-acc-corps"><p>Calcul<\/p><\/div><\/details>$/);
  assert.match(UI.accordeon({ titre: "T", contenu: "", ouvert: true }), /^<details class="ui-acc" open>/);
  assert.ok(sansBalise(UI.accordeon({ titre: XSS, contenu: "" })));
});

test("voirPlus : 5 premiers visibles, le reste caché, bouton « Voir plus (k) »", () => {
  const liste = [1, 2, 3, 4, 5, 6, 7];
  const h = UI.voirPlus(liste, 5, x => '<div class="it">' + x + "</div>");
  const [visibles, reste] = h.split("ui-voirplus-reste");
  assert.equal((visibles.match(/class="it"/g) || []).length, 5);
  assert.equal((reste.match(/class="it"/g) || []).length, 2);
  assert.match(h, /<div class="ui-voirplus-liste ui-voirplus-reste" id="(ui-reste-[0-9a-z]+)" hidden>/);
  const id = /id="(ui-reste-[0-9a-z]+)"/.exec(h)[1];
  assert.match(h, new RegExp('<button type="button" class="ui-voirplus-btn" data-ui-voirplus [^>]*aria-expanded="false" aria-controls="' + id + '">Voir plus \\(2\\)</button>'));
  // n par défaut = 5, rendu par défaut = texte échappé, libellé personnalisé échappé
  assert.match(UI.voirPlus(["a", "b", "c", "d", "e", "f"]), /Voir plus \(1\)/);
  assert.ok(sansBalise(UI.voirPlus([XSS, XSS], 1, null, XSS)));
  // pas de bouton quand tout tient
  const court = UI.voirPlus([1, 2, 3], 5, x => "<i>" + x + "</i>");
  assert.ok(!court.includes("data-ui-voirplus"));
  assert.ok(!court.includes("ui-voirplus-reste"));
  assert.equal((court.match(/<i>/g) || []).length, 3);
  // le rendu reçoit l'index absolu
  assert.match(UI.voirPlus(["a", "b", "c"], 1, (x, i) => "<b>" + i + "</b>"), /<b>2<\/b>/);
});

test("brancher (DOM) : « Voir plus » déplie puis replie ; clic sur une carte → surCarte(id)", () => {
  const { UI: G, dom } = charger(false);
  const racine = dom.doc.body.appendChild(dom.doc.createElement("div"));
  const cartes = [];
  racine.innerHTML = G.carte({ id: "net", titre: "Net", valeur: "1" }) + G.voirPlus([1, 2, 3, 4, 5, 6, 7], 5, x => "<p>" + x + "</p>");
  G.brancher(racine, { surCarte: (id, el) => cartes.push([id, el.getAttribute("class")]) });
  G.brancher(racine, { surCarte: (id, el) => cartes.push([id, el.getAttribute("class")]) }); // idempotent
  const btn = racine.querySelector("[data-ui-voirplus]");
  const reste = racine.querySelector(".ui-voirplus-reste");
  assert.ok(reste.hidden);
  btn.click();
  assert.equal(reste.hidden, false);
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.equal(btn.textContent, "Voir moins");
  btn.click();
  assert.equal(reste.hidden, true);
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(btn.textContent, "Voir plus (2)");
  // clic sur un enfant de la carte
  racine.querySelector(".ui-carte-valeur").click();
  assert.deepEqual(cartes, [["net", "ui-carte"]]);
});

/* ============================================================ Demander à Claude ============================================================ */

test("demanderAClaude : lien vers claude.ai/new avec la question encodée, nouvel onglet sûr", () => {
  const q = "Où en est mon PEA ? 50 % & \"plus\" #1";
  assert.equal(UI.urlClaude(q), "https://claude.ai/new?q=" + encodeURIComponent(q));
  assert.equal(UI.urlClaude(q), "https://claude.ai/new?q=O%C3%B9%20en%20est%20mon%20PEA%20%3F%2050%20%25%20%26%20%22plus%22%20%231");
  const h = UI.demanderAClaude(q);
  assert.match(h, /^<a class="ui-claude" href="https:\/\/claude\.ai\/new\?q=O%C3%B9%20en[^"]*" target="_blank" rel="noopener noreferrer">/);
  assert.match(h, /<svg[^>]*aria-hidden="true"/);
  assert.match(h, /<span>Demander à Claude<\/span>/);
  assert.match(h, /<span class="ui-sr"> \(nouvel onglet\)<\/span>/);
  assert.match(UI.demanderAClaude("x", "Faire le point avec Claude"), /<span>Faire le point avec Claude<\/span>/);
  const x = UI.demanderAClaude(XSS, XSS);
  assert.ok(sansBalise(x));
  assert.ok(!/href="[^"]*[<>"' ][^"]*"\s/.test(x.replace(/href="https:\/\/claude\.ai\/new\?q=[^"]*"/, "")), "href ne sort pas de l'attribut");
  assert.match(x, /href="https:\/\/claude\.ai\/new\?q=%3Cimg%20src%3Dx%20onerror%3D%22alert\(1\)%22%3E&#39;%26"/, "l'apostrophe, non encodée par encodeURIComponent, est échappée");
});

/* ============================================================ panneau ============================================================ */

function montage() {
  const c = charger(false);
  const { doc } = c.dom;
  const app = doc.body.appendChild(doc.createElement("div"));
  app.className = "app";
  app.innerHTML = c.UI.carte({ id: "net", titre: "Net", valeur: "1" });
  const declencheur = app.querySelector(".ui-carte");
  declencheur.focus();
  return Object.assign(c, { app, declencheur, doc });
}

test("panneau : dialogue modal unique injecté dans le body, titre lié, focus à l'intérieur, fond inerte", () => {
  const { UI: G, doc, app, declencheur } = montage();
  assert.equal(G.panneau.ouvert(), false);
  const corps = G.panneau.ouvrir({ titre: "Patrimoine <net>", contenu: '<p class="d">Détail</p>', lien: { label: "Voir la page", href: "#patrimoine/placements" } });
  const dlg = doc.body.querySelector('[role="dialog"]');
  assert.ok(dlg);
  assert.equal(dlg.getAttribute("aria-modal"), "true");
  assert.ok(dlg.classList.contains("ui-panneau"));
  const titre = doc.body.querySelector("#" + dlg.getAttribute("aria-labelledby"));
  assert.ok(titre && dlg.contains(titre));
  assert.equal(titre.textContent, "Patrimoine <net>", "titre posé en texte, pas en HTML");
  assert.equal(titre.children.length, 0);
  assert.ok(doc.body.querySelector(".ui-voile"));
  assert.equal(dlg.hidden, false);
  assert.equal(G.panneau.ouvert(), true);
  assert.ok(dlg.contains(corps) && corps.querySelector(".d"), "ouvrir renvoie l'élément de contenu");
  assert.ok(dlg.contains(doc.activeElement), "focus dans le panneau");
  assert.notEqual(doc.activeElement, declencheur);
  assert.equal(app.inert, true, "le reste de la page est inerte");
  assert.ok(doc.documentElement.classList.contains("ui-bloque"), "défilement de la page bloqué");
  const lien = dlg.querySelector(".ui-panneau-lien");
  assert.equal(lien.getAttribute("href"), "#patrimoine/placements");
  const fermer = dlg.querySelector(".ui-panneau-fermer");
  assert.equal(fermer.getAttribute("aria-label"), "Fermer");
  // une seule instance
  G.panneau.ouvrir({ titre: "Autre", contenu: "" });
  assert.equal(doc.body.querySelectorAll('[role="dialog"]').length, 1);
  assert.equal(doc.body.querySelectorAll(".ui-voile").length, 1);
  assert.equal(dlg.querySelector(".ui-panneau-lien"), null);
  assert.equal(dlg.querySelector(".ui-panneau-pied").hidden, true, "pied caché sans lien");
});

test("panneau : Échap ferme et rend le focus à l'élément d'origine", () => {
  const { UI: G, doc, app, declencheur, dom } = montage();
  G.panneau.ouvrir({ titre: "T", contenu: "<p>x</p>" });
  const dlg = doc.body.querySelector('[role="dialog"]');
  const e = dom.touche(doc.activeElement, "Escape");
  assert.ok(e.defaultPrevented);
  assert.equal(G.panneau.ouvert(), false);
  assert.equal(dlg.hidden, true);
  assert.equal(doc.body.querySelector(".ui-voile").hidden, true);
  assert.equal(doc.activeElement, declencheur, "focus rendu");
  assert.equal(app.inert, false);
  assert.ok(!doc.documentElement.classList.contains("ui-bloque"));
  // Échap une fois fermé : sans effet
  assert.equal(dom.touche(declencheur, "Escape").defaultPrevented, false);
});

test("panneau : clic sur le voile, bouton Fermer, fermer() ; surFermeture ; retour explicite", () => {
  const { UI: G, doc, declencheur, app } = montage();
  let fermetures = 0;
  G.panneau.ouvrir({ titre: "T", contenu: "", surFermeture: () => fermetures++ });
  doc.body.querySelector(".ui-voile").click();
  assert.equal(G.panneau.ouvert(), false);
  assert.equal(doc.activeElement, declencheur);
  assert.equal(fermetures, 1);
  G.panneau.ouvrir({ titre: "T", contenu: "" });
  doc.body.querySelector(".ui-panneau-fermer").click();
  assert.equal(G.panneau.ouvert(), false);
  assert.equal(doc.activeElement, declencheur);
  const autre = app.appendChild(doc.createElement("button"));
  G.panneau.ouvrir({ titre: "T", contenu: "", retour: autre });
  G.panneau.fermer();
  assert.equal(doc.activeElement, autre);
  assert.equal(fermetures, 1);
  // rouvrir pendant qu'il est ouvert garde l'élément d'origine
  declencheur.focus();
  G.panneau.ouvrir({ titre: "A", contenu: "<button id=\"dedans\">d</button>" });
  doc.body.querySelector("#dedans").focus();
  G.panneau.ouvrir({ titre: "B", contenu: "" });
  G.panneau.fermer();
  assert.equal(doc.activeElement, declencheur);
});

test("panneau : un rafraîchissement sans retour ni surFermeture garde les précédents ; surFermeture({ focus })", () => {
  const { UI: G, doc, app, declencheur } = montage();
  const autre = app.appendChild(doc.createElement("button"));
  const appels = [];
  G.panneau.ouvrir({ titre: "A", contenu: "<p>1</p>", retour: autre, surFermeture: o => appels.push(["a", simple(o)]) });
  G.panneau.ouvrir({ titre: "A", contenu: "<p>2</p>" }); // rafraîchissement du contenu
  G.panneau.fermer();
  assert.equal(doc.activeElement, autre, "retour conservé");
  assert.deepEqual(appels, [["a", { focus: true }]], "surFermeture conservé, appelé avec { focus: true }");
  // un rafraîchissement qui fournit surFermeture le remplace
  appels.length = 0;
  G.panneau.ouvrir({ titre: "B", contenu: "", retour: declencheur, surFermeture: () => appels.push("b1") });
  G.panneau.ouvrir({ titre: "B", contenu: "", surFermeture: o => appels.push(["b2", simple(o)]) });
  G.panneau.fermer({ focus: false });
  assert.deepEqual(appels, [["b2", { focus: false }]], "remplacé ; focus: false transmis");
  // un rafraîchissement qui fournit seulement retour : plus de rappel (comportement documenté)
  appels.length = 0;
  G.panneau.ouvrir({ titre: "C", contenu: "", surFermeture: () => appels.push("c") });
  G.panneau.ouvrir({ titre: "C", contenu: "", retour: autre });
  G.panneau.fermer();
  assert.deepEqual(appels, []); assert.equal(doc.activeElement, autre);
  assert.match(js, /const garder = estOuvert && !o\.retour && typeof o\.surFermeture !== "function";/);
});

test("panneau : Tab et Maj+Tab restent piégés dans le panneau", () => {
  const { UI: G, doc, dom } = montage();
  G.panneau.ouvrir({ titre: "T", contenu: '<a href="#x" id="l1">un</a><button id="b2">deux</button><button id="b3" disabled>non</button>', lien: { label: "Page", href: "#a/b" } });
  const dlg = doc.body.querySelector('[role="dialog"]');
  const fermer = dlg.querySelector(".ui-panneau-fermer");
  const dernier = dlg.querySelector(".ui-panneau-lien");
  dernier.focus();
  const e = dom.touche(dernier, "Tab");
  assert.ok(e.defaultPrevented);
  assert.equal(doc.activeElement, fermer, "Tab sur le dernier → premier");
  const e2 = dom.touche(fermer, "Tab", { shiftKey: true });
  assert.ok(e2.defaultPrevented);
  assert.equal(doc.activeElement, dernier, "Maj+Tab sur le premier → dernier");
  doc.body.querySelector("#l1").focus();
  assert.equal(dom.touche(doc.activeElement, "Tab").defaultPrevented, false, "au milieu : comportement natif");
});

test("panneau : un lien interne (#…) dans le panneau le ferme ; lien non sûr ignoré", () => {
  const { UI: G, doc } = montage();
  G.panneau.ouvrir({ titre: "T", contenu: '<a href="#pilotage/sante" id="go">Santé</a>' });
  doc.body.querySelector("#go").click();
  assert.equal(G.panneau.ouvert(), false);
  G.panneau.ouvrir({ titre: "T", contenu: "", lien: { label: "x", href: "javascript:alert(1)" } });
  assert.equal(doc.body.querySelector(".ui-panneau-lien"), null);
  assert.equal(doc.body.querySelector(".ui-panneau-pied").hidden, true);
  G.panneau.fermer();
});

test("panneau : le code rend le focus à l'élément mémorisé et écoute Échap (contrôle statique)", () => {
  assert.match(js, /retourEl\s*=\s*o\.retour\s*\|\|\s*d\.activeElement/);
  assert.match(js, /\.focus\(\)/);
  assert.match(js, /addEventListener\("keydown", surTouche/);
  assert.match(js, /e\.key === "Escape"/);
});

/* ============================================================ période ============================================================ */

test("periode (DOM) : deux groupes radio (période, granularité), défaut 1 an, libellés complets pour les lecteurs d'écran", () => {
  const { UI: G, dom } = charger(false);
  const racine = dom.doc.body.appendChild(dom.doc.createElement("div"));
  const ctl = G.periode(racine, { today: "2026-10-10" });
  const groupes = racine.querySelectorAll('[role="radiogroup"]');
  assert.equal(groupes.length, 2);
  assert.equal(groupes[0].getAttribute("aria-label"), "Période");
  assert.equal(groupes[1].getAttribute("aria-label"), "Granularité");
  const ids = g => g.querySelectorAll('[role="radio"]').map(b => b.getAttribute("data-ui-id"));
  assert.deepEqual(ids(groupes[0]), ["1m", "3m", "1a", "tout", "perso"]);
  assert.deepEqual(ids(groupes[1]), ["jour", "semaine", "mois", "trimestre", "annee"]);
  assert.equal(groupes[0].querySelector('[data-ui-id="1m"]').getAttribute("aria-label"), "1 mois");
  assert.equal(groupes[0].querySelector('[data-ui-id="perso"]').textContent, "Personnalisée");
  assert.equal(racine.querySelector(".ui-periode-dates").hidden, true);
  assert.deepEqual(simple(ctl.valeur()), { periode: "1a", granularite: "mois", du: null, au: null }, "sans Periodes : mois par défaut");
});

test("periode (DOM) : granularité par défaut via window.Periodes, suit la période tant qu'on ne l'a pas choisie", () => {
  const { UI: G, dom } = charger(true);
  const racine = dom.doc.body.appendChild(dom.doc.createElement("div"));
  const vus = [];
  const ctl = G.periode(racine, { periode: "1a", today: "2026-10-10", surChange: e => vus.push(e) });
  assert.deepEqual(simple(ctl.valeur()), { periode: "1a", granularite: "semaine", du: "2025-10-10", au: "2026-10-10" });
  const radio = (g, id) => racine.querySelectorAll('[role="radiogroup"]')[g].querySelector('[data-ui-id="' + id + '"]');
  radio(0, "1m").click();
  assert.deepEqual(simple(vus.pop()), { periode: "1m", granularite: "jour", du: "2026-09-10", au: "2026-10-10" });
  assert.equal(radio(1, "jour").getAttribute("aria-checked"), "true");
  radio(1, "mois").click();
  assert.deepEqual(simple(vus.pop()), { periode: "1m", granularite: "mois", du: "2026-09-10", au: "2026-10-10" });
  radio(0, "tout").click();
  assert.equal(vus.pop().granularite, "mois", "granularité choisie conservée");
  // granularité imposée à la création
  const r2 = dom.doc.body.appendChild(dom.doc.createElement("div"));
  assert.equal(G.periode(r2, { periode: "1a", granularite: "mois", today: "2026-10-10" }).valeur().granularite, "mois");
  // « Tout » s'appuie sur la première date connue
  const r3 = dom.doc.body.appendChild(dom.doc.createElement("div"));
  assert.equal(G.periode(r3, { periode: "tout", premiere: "2024-02-03", today: "2026-10-10" }).valeur().du, "2024-02-03");
});

test("periode (DOM) : « Personnalisée » montre deux dates étiquetées ; leur changement notifie, bornes remises dans l'ordre", () => {
  const { UI: G, dom } = charger(true);
  const racine = dom.doc.body.appendChild(dom.doc.createElement("div"));
  const vus = [];
  G.periode(racine, { periode: "3m", granularite: "mois", today: "2026-10-10", surChange: e => vus.push(e) });
  racine.querySelector('[data-ui-id="perso"]').click();
  const dates = racine.querySelector(".ui-periode-dates");
  assert.equal(dates.hidden, false);
  const [du, au] = racine.querySelectorAll('input[type="date"]');
  assert.ok(du.closest("label") && du.closest("label").textContent.includes("Du"));
  assert.ok(au.closest("label") && au.closest("label").textContent.includes("Au"));
  assert.equal(du.value, "2026-07-10", "préremplie avec la période précédente");
  assert.equal(au.value, "2026-10-10");
  assert.deepEqual(simple(vus.pop()), { periode: "perso", granularite: "mois", du: "2026-07-10", au: "2026-10-10" });
  du.value = "2026-09-30"; au.value = "2026-01-01";
  dom.changer(au);
  assert.deepEqual(simple(vus.pop()), { periode: "perso", granularite: "mois", du: "2026-01-01", au: "2026-09-30" });
  assert.equal(du.value, "2026-01-01"); assert.equal(au.value, "2026-09-30");
  racine.querySelector('[data-ui-id="1a"]').click();
  assert.equal(dates.hidden, true);
});

test("panneau : retour arrière (popstate) ou hash changé pendant l'ouverture → fermé sans reprise du focus ; écouteurs retirés à la fermeture", () => {
  const { UI: G, doc, ctx, declencheur } = montage();
  const ls = {};
  ctx.addEventListener = (t, f) => { (ls[t] ||= []).push(f); };
  ctx.removeEventListener = (t, f) => { ls[t] = (ls[t] || []).filter(x => x !== f); };
  const n = t => (ls[t] || []).length;
  assert.equal(n("hashchange") + n("popstate"), 0, "rien avant l'ouverture");
  G.panneau.ouvrir({ titre: "T", contenu: "<p>x</p>" });
  assert.equal(n("hashchange"), 1); assert.equal(n("popstate"), 1);
  G.panneau.ouvrir({ titre: "T2", contenu: "" });
  assert.equal(n("popstate"), 1, "rouvrir ne double pas les écouteurs");
  const focusAvant = declencheur.focusCount;
  ls.popstate[0]({ type: "popstate" });
  assert.equal(G.panneau.ouvert(), false, "fermé par le retour arrière");
  assert.equal(declencheur.focusCount, focusAvant, "focus non repris : la coque le pose sur la vue atteinte");
  assert.equal(n("hashchange") + n("popstate"), 0, "écouteurs retirés");
  G.panneau.ouvrir({ titre: "T", contenu: "" });
  ls.hashchange[0]({ type: "hashchange" });
  assert.equal(G.panneau.ouvert(), false, "fermé par un changement de hash");
  assert.equal(n("hashchange") + n("popstate"), 0);
  G.panneau.ouvrir({ titre: "T", contenu: "" });
  G.panneau.fermer();
  assert.equal(n("hashchange") + n("popstate"), 0, "fermeture ordinaire : écouteurs retirés aussi");
  // fermer({ focus: false }) (la coque, avant de naviguer) : pas de reprise du focus
  declencheur.focus();
  G.panneau.ouvrir({ titre: "T", contenu: "" });
  const f2 = declencheur.focusCount;
  G.panneau.fermer({ focus: false });
  assert.equal(G.panneau.ouvert(), false);
  assert.equal(declencheur.focusCount, f2);
  declencheur.focus();
  G.panneau.ouvrir({ titre: "T", contenu: "" });
  G.panneau.fermer();
  assert.equal(declencheur.focusCount, f2 + 2, "fermer() sans option rend le focus");
  assert.equal(doc.body.querySelector(".ui-panneau").hidden, true);
});

test("voirPlus : balise \"ul\" → deux listes <ul> (le rendu fournit les <li>) ; \"div\" par défaut", () => {
  const li = x => "<li>" + UI.esc(x) + "</li>";
  const h = UI.voirPlus(["a", "b", "c"], 2, li, "Voir plus", "ul");
  assert.match(h, /^<div class="ui-voirplus"><ul class="ui-voirplus-liste"><li>a<\/li><li>b<\/li><\/ul><ul class="ui-voirplus-liste ui-voirplus-reste" id="[^"]+" hidden><li>c<\/li><\/ul><button/);
  assert.match(UI.voirPlus(["a"], 2, li, "", "ol"), /^<div class="ui-voirplus"><ol class="ui-voirplus-liste"><li>a<\/li><\/ol><\/div>$/);
  assert.match(UI.voirPlus(["a"], 2), /^<div class="ui-voirplus"><div class="ui-voirplus-liste">a<\/div><\/div>$/);
  assert.match(UI.voirPlus(["a"], 2, null, "", "script"), /<div class="ui-voirplus-liste">/, "balise inconnue → div");
  assert.match(css, /\.ui-voirplus-liste\{[^}]*list-style:none/);
  assert.match(css, /\.ui-voirplus-btn\{[^}]*min-height:var\(--hit\)/, "« Voir plus » : zone de 44 px (jeton --hit)");
});

test("periode (DOM) : « Tout » sans première date puis « Personnalisée » → 1 an (pas du = au) ; premiere(date) met à jour « Tout »", () => {
  const { UI: G, dom } = charger(true);
  const racine = dom.doc.body.appendChild(dom.doc.createElement("div"));
  const vus = [];
  const ctl = G.periode(racine, { periode: "tout", today: "2026-10-10", surChange: e => vus.push(e) });
  assert.equal(typeof ctl.premiere, "function");
  assert.deepEqual(simple(ctl.valeur()), { periode: "tout", granularite: "jour", du: "2026-10-10", au: "2026-10-10" }, "sans données : du = au");
  // les photos arrivent : « Tout » part de la première, la granularité automatique suit (et la vue est prévenue)
  ctl.premiere("2024-02-03");
  assert.deepEqual(simple(ctl.valeur()), { periode: "tout", granularite: "mois", du: "2024-02-03", au: "2026-10-10" });
  assert.deepEqual(simple(vus.pop()), { periode: "tout", granularite: "mois", du: "2024-02-03", au: "2026-10-10" });
  ctl.premiere("2024-02-03");
  assert.equal(vus.length, 0, "même date : rien");
  racine.querySelector('[data-ui-id="perso"]').click();
  const [du, au] = racine.querySelectorAll('input[type="date"]');
  assert.equal(du.value, "2024-02-03", "« Personnalisée » reprend la période « Tout »"); assert.equal(au.value, "2026-10-10");
  // sans première date : repli sur 1 an
  const r2 = dom.doc.body.appendChild(dom.doc.createElement("div"));
  const vus2 = [];
  G.periode(r2, { periode: "tout", today: "2026-10-10", surChange: e => vus2.push(e) });
  r2.querySelector('[data-ui-id="perso"]').click();
  const [du2, au2] = r2.querySelectorAll('input[type="date"]');
  assert.equal(du2.value, "2025-10-10"); assert.equal(au2.value, "2026-10-10");
  assert.equal(vus2.pop().du, "2025-10-10");
  // sans window.Periodes non plus
  const { UI: G3, dom: d3 } = charger(false);
  const r3 = d3.doc.body.appendChild(d3.doc.createElement("div"));
  G3.periode(r3, { periode: "tout", today: "2024-02-29" });
  r3.querySelector('[data-ui-id="perso"]').click();
  assert.equal(r3.querySelector("[data-ui-du]").value, "2023-03-01");
  assert.equal(r3.querySelector("[data-ui-au]").value, "2024-02-29");
});

/* ============================================================ CSS ============================================================ */

test("ui.css : sélecteurs tous préfixés .ui-, couleurs issues des variables de theme.css, panneau responsive", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|[{}])\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(sels.length > 30, "assez de règles : " + sels.length);
  const bad = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith(".ui-"));
  assert.deepEqual(bad, []);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "pas de couleur en dur : variables de theme.css");
  for (const v of ["--surface", "--ink", "--muted", "--line", "--brand", "--pos", "--neg", "--r-card", "--t-body", "--hit", "--e3", "--dur-open"]) assert.ok(css.includes("var(" + v), v);
  assert.match(css, /@media \(min-width:900px\)/);
  assert.match(css, /@media \(max-width:899\.98px\)/);
  assert.match(css, /max-height:92vh/, "feuille de 92 vh");
  assert.match(css, /width:min\(480px/, "volet latéral de 480 px");
  assert.match(css, /\.ui-sr\{/);
});

test("voirPlus : id stable d'un rendu à l'autre et état déplié conservé (signatures anti-redessin)", () => {
  const UIm = require("../web/src/ui.js");
  const xs = Array.from({ length: 8 }, (_, i) => "x" + i);
  const a = UIm.voirPlus(xs, 5), b = UIm.voirPlus(xs, 5);
  assert.equal(a, b, "même contenu → même HTML");
  assert.notEqual(UIm.voirPlus(xs, 5, null, null, null, "cle-a"), UIm.voirPlus(xs, 5, null, null, null, "cle-b"), "clés différentes → ids différents");
  assert.match(a, /id="ui-reste-[0-9a-z]+" hidden/);
});

/* ============================================================ markdown ============================================================ */
/* Rendu partagé par Agent › Fiches, Journal et Expertises (UI.markdown) : échappement avant balisage, liens https seulement. */
const md = (t, o) => UI.markdown(t, o);

test("markdown : tout le HTML d'origine est échappé avant le balisage (balises, attributs, guillemets)", () => {
  const out = md("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n" + XSS);
  assert.ok(!/<script|<img/i.test(out));
  assert.ok(out.includes("&lt;script&gt;") && out.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!md('**"x" & y**').includes('"x"'), "guillemets échappés");
  assert.equal(md('"><script>x</script>'), "<p>&quot;&gt;&lt;script&gt;x&lt;/script&gt;</p>");
  assert.equal(md("`<b>`"), "<p><code>&lt;b&gt;</code></p>", "le code est échappé aussi");
  assert.equal(md("- <b>a</b>\n   - <i>b</i>"), "<ul><li>&lt;b&gt;a&lt;/b&gt;<ul><li>&lt;i&gt;b&lt;/i&gt;</li></ul></li></ul>", "listes imbriquées échappées");
  assert.equal(md(null), "");
  assert.equal(md(undefined), "");
  assert.equal(md(""), "");
});

test("markdown : seuls les liens https:// deviennent des <a>, nouvel onglet, rel=\"noopener noreferrer\", pas de sortie d'attribut", () => {
  const ok = md("Voir [service-public](https://www.service-public.fr/a?b=1&c=2).");
  assert.equal(ok, '<p>Voir <a href="https://www.service-public.fr/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">service-public<span class="ui-sr"> (nouvel onglet)</span></a>.</p>');
  for (const u of ["javascript:alert(1)", "http://exemple.fr", "data:text/html,x", "JAVASCRIPT:alert(1)", "//exemple.fr", "HTTPS://a.fr", " https://a.fr"]) {
    assert.ok(!/<a\b/i.test(md("[clic](" + u + ")")), u + " ne doit pas devenir un lien");
  }
  const inj = md('[x](https://a.fr" onclick="alert(1))');
  assert.ok(!/onclick="/.test(inj), "pas de sortie d'attribut");
  assert.ok(!/<a [^>]*href="[^"]*"[^>]*"/.test(md("[x](https://a.fr/'><img src=x>)")), "ni guillemet ni chevron dans l'URL");
  assert.equal(md("[**gras**](https://a.fr)"), '<p><a href="https://a.fr" target="_blank" rel="noopener noreferrer"><strong>gras</strong><span class="ui-sr"> (nouvel onglet)</span></a></p>', "gras dans un lien");
  assert.equal(md("`[x](https://a.fr)`"), "<p><code>[x](https://a.fr)</code></p>", "rien n'est interprété dans le code");
});

test("markdown : titres décalés selon niveau (## → h<niveau>, ### → h<niveau+1>, plafonnés à h6), défaut 3", () => {
  assert.equal(md("## T"), "<h3>T</h3>");
  assert.equal(md("### T"), "<h4>T</h4>");
  assert.equal(md("# T"), "<h3>T</h3>", "« # » au même niveau que « ## »");
  assert.equal(md("## T", { niveau: 4 }), "<h4>T</h4>");
  assert.equal(md("### T", { niveau: 4 }), "<h5>T</h5>");
  assert.equal(md("#### T", { niveau: 4 }), "<h6>T</h6>");
  assert.equal(md("### T", { niveau: 6 }), "<h6>T</h6>", "plafond h6");
  assert.equal(md("## T", { niveau: 9 }), "<h6>T</h6>");
  assert.equal(md("## T", { niveau: "x" }), "<h3>T</h3>", "niveau invalide → 3");
  assert.equal(md("## Titre\nTexte"), "<h3>Titre</h3><p>Texte</p>");
  assert.equal(md("##sans espace"), "<p>##sans espace</p>");
});

test("markdown : paragraphes, gras, code, espaces insécables typographiques ; aucun autre balisage", () => {
  assert.equal(md("Premier.\n\nSecond\nsuite."), "<p>Premier.</p><p>Second suite.</p>");
  assert.equal(md("Le **Livret A** est sûr."), "<p>Le <strong>Livret A</strong> est sûr.</p>");
  assert.equal(md("fiche `frais-et-ter`"), "<p>fiche <code>frais-et-ter</code></p>");
  assert.equal(md("En 2028. Oui"), "<p>En 2028. Oui</p>", "un nombre en début de ligne sans espace après le point n'est pas une liste");
  assert.equal(md("35 % de 150 000 €"), "<p>35 % de 150 000 €</p>");
  assert.equal(md("a\r\nb"), "<p>a b</p>");
  const tags = new Set([...md("# a\n\n## b\n\n- **c** [d](https://e.fr) `x`\n\n1. e\n\n_g_ > h *i* ~~j~~").matchAll(/<([a-z0-9]+)/g)].map(m => m[1]));
  assert.deepEqual([...tags].filter(t => !["h3", "h4", "p", "ul", "ol", "li", "strong", "code", "a", "span"].includes(t)), []);
});

test("markdown : listes à puces et numérotées, changement de type, liste collée à un paragraphe", () => {
  assert.equal(md("- un\n- deux"), "<ul><li>un</li><li>deux</li></ul>");
  assert.equal(md("1. Un\n2. Deux"), "<ol><li>Un</li><li>Deux</li></ol>");
  assert.equal(md("1. **Un** [a](https://a.fr)\n2. Deux"), '<ol><li><strong>Un</strong> <a href="https://a.fr" target="_blank" rel="noopener noreferrer">a<span class="ui-sr"> (nouvel onglet)</span></a></li><li>Deux</li></ol>');
  assert.equal(md("- a\n1. b\n- c"), "<ul><li>a</li></ul><ol><li>b</li></ol><ul><li>c</li></ul>", "changement de type de liste");
  assert.equal(md("Texte\n1. b"), "<p>Texte</p><ol><li>b</li></ol>");
  assert.equal(md("- a\nTexte"), "<ul><li>a</li></ul><p>Texte</p>", "ligne non indentée : fin de liste");
  assert.equal(md("- a\n\n- b"), "<ul><li>a</li></ul><ul><li>b</li></ul>");
});

test("markdown : listes imbriquées — une ligne « - » indentée sous un item devient une sous-liste du <li> courant, la numérotation continue", () => {
  assert.equal(md("1. a\n   - b\n2. c"), "<ol><li>a<ul><li>b</li></ul></li><li>c</li></ol>");
  assert.equal(md("1. a\n   - b\n   - c\n2. d\n3. e"), "<ol><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li><li>e</li></ol>");
  assert.equal(md("- a\n  - b\n    - c\n- d"), "<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>", "trois niveaux, retour au premier");
  assert.equal(md("- a\n  1. b\n  2. c"), "<ul><li>a<ol><li>b</li><li>c</li></ol></li></ul>", "sous-liste numérotée");
  assert.equal(md("1. a\n   - b\n   1. c"), "<ol><li>a<ul><li>b</li></ul><ol><li>c</li></ol></li></ol>", "changement de type dans la sous-liste");
  assert.equal(md("1. a\n   suite de a\n2. b"), "<ol><li>a suite de a</li><li>b</li></ol>", "ligne indentée : suite de l'item");
  assert.equal(md("1. a\n   - b\n     suite de b\n2. c"), "<ol><li>a<ul><li>b suite de b</li></ul></li><li>c</li></ol>");
  assert.equal(md("1. a\n   - b\n\n2. c"), "<ol><li>a<ul><li>b</li></ul></li></ol><ol><li>c</li></ol>", "ligne vide : fin de liste");
  assert.equal(md("  - a\n  - b"), "<ul><li>a</li><li>b</li></ul>", "liste indentée dès le début");
  assert.equal(md("\t- a\n- b"), "<ul><li>a</li><li>b</li></ul>", "tabulation : même niveau que la première ligne au plus");
});

test("markdown : méthode réelle de l'expertise « Actions et marchés » (0017) — étapes 1 à 8 dans une seule liste, marchés en sous-liste de l'étape 5", () => {
  const x = lireExpertises(readFileSync("supabase/migrations/0017_expertises_contenu.sql", "utf8")).find(e => e.slug === "actions");
  const h = md(x.methode, { niveau: 4 });
  const etapes = h.slice(h.indexOf("<h4>Étapes</h4>"), h.indexOf("<h4>Questions"));
  assert.equal((etapes.match(/<ol>/g) || []).length, 1, "une seule liste numérotée : la numérotation continue après la sous-liste");
  assert.equal((etapes.match(/<ul>/g) || []).length, 1, "une sous-liste");
  const sous = etapes.slice(etapes.indexOf("<ul>"), etapes.indexOf("</ul>"));
  assert.equal((sous.match(/<li>/g) || []).length, 5, "5 marchés");
  assert.match(sous, /^<ul><li><strong>France \(fr\)<\/strong> :/);
  assert.match(etapes, /<li><strong>Par marché<\/strong>, applique le bloc concerné :<ul><li>/, "sous-liste dans l'item 5");
  assert.match(etapes, /<\/ul><\/li><li><strong>Enveloppe\.<\/strong>/, "l'étape 6 suit dans la même liste");
  const haut = etapes.replace(/<ul>[\s\S]*?<\/ul>/, "");
  assert.equal((haut.match(/<li>/g) || []).length, 8, "8 étapes");
  assert.doesNotMatch(h, /<p>- |<p>\d+\. /, "aucun item resté en paragraphe");
});

test("carte : aria = nom accessible complet (aria-label échappé) quand l'ordre visuel ne commence pas par l'essentiel ; absent sinon", () => {
  const h = UI.carte({ id: "x", titre: "Version 2", valeur: "Actions <et> marchés", aria: "Actions <et> marchés, version 2" });
  assert.match(h, /^<button type="button" class="ui-carte" data-ui-carte="x" aria-haspopup="dialog" aria-label="Actions &lt;et&gt; marchés, version 2">/);
  assert.ok(!UI.carte({ id: "x", titre: "T", valeur: "1" }).includes("aria-label"));
  assert.ok(!UI.carte({ id: "x", titre: "T", valeur: "1", aria: "" }).includes("aria-label"));
});

test("panneau.remplacer : remplace titre, contenu et pied d'un panneau ouvert sans reprendre le focus ; rien s'il est fermé", () => {
  const { UI: G, doc, declencheur } = montage();
  assert.equal(G.panneau.remplacer({ contenu: "<p>x</p>" }), null, "fermé : rien");
  let fermetures = 0;
  const corps = G.panneau.ouvrir({ titre: "A", contenu: '<p>chargement</p><button id="b1">b</button>', pied: '<a href="#x">p</a>', surFermeture: () => fermetures++ });
  const dlg = doc.body.querySelector('[role="dialog"]'), titre = dlg.querySelector(".ui-panneau-titre");
  const f0 = titre.focusCount;
  corps.scrollTop = 120;
  const c2 = G.panneau.remplacer({ contenu: "<p>détail</p>" });
  assert.equal(c2, corps, "même élément de contenu");
  assert.equal(corps.innerHTML, "<p>détail</p>");
  assert.equal(titre.textContent, "A", "titre inchangé s'il n'est pas fourni");
  assert.match(dlg.querySelector(".ui-panneau-pied").innerHTML, /href="#x"/, "pied inchangé s'il n'est pas fourni");
  assert.equal(titre.focusCount, f0, "focus non repris : il reste sur le titre");
  assert.equal(corps.scrollTop, 120, "défilement conservé");
  G.panneau.remplacer({ titre: "B", contenu: '<button id="b2">b</button>', pied: "" });
  assert.equal(titre.textContent, "B");
  assert.equal(dlg.querySelector(".ui-panneau-pied").hidden, true, "pied vidé");
  // focus dans le contenu remplacé : il revient au titre (sinon il tomberait sur BODY)
  corps.querySelector("#b2").focus();
  G.panneau.remplacer({ contenu: "<p>z</p>" });
  assert.equal(doc.activeElement, titre, "focus perdu → titre");
  // un bouton gardé hors du contenu remplacé garde le focus
  G.panneau.remplacer({ pied: '<button id="p1">p</button>' });
  dlg.querySelector("#p1").focus();
  G.panneau.remplacer({ contenu: "<p>w</p>" });
  assert.equal(doc.activeElement.getAttribute("id"), "p1");
  G.panneau.fermer();
  assert.equal(fermetures, 1, "le rappel de fermeture d'origine est conservé");
  assert.equal(doc.activeElement, declencheur);
});
