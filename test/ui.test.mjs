// Bibliothèque de composants (web/src/ui.js + ui.css) : carte, panneau, onglets, bascule, accordéon, voir plus,
// sélecteur de période, « Demander à Claude ». Fonctions de rendu testées en pur ; comportements testés dans un mini-DOM factice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/ui.js", "utf8");
const css = readFileSync("web/src/ui.css", "utf8");
const periodesJs = readFileSync("web/src/periodes.js", "utf8");
const UI = require("../web/src/ui.js");

const XSS = `<img src=x onerror="alert(1)">'&`;
const simple = o => JSON.parse(JSON.stringify(o)); // objets venus du contexte vm → objets ordinaires
const sansBalise = html => !/<img/i.test(html) && !html.includes('onerror="');

/* ============================================================ mini-DOM factice ============================================================
   Juste ce qu'utilise ui.js : analyse d'un HTML bien formé, sélecteurs simples (balise, #id, .classe, [attr], [attr="v"], [attr^="v"],
   listes séparées par des virgules), closest, événements qui remontent jusqu'au document, focus et activeElement, inert, hidden. */
function miniDom() {
  const VIDES = new Set(["input", "br", "img", "hr", "meta", "link", "path", "circle", "rect", "line", "polyline"]);
  const decode = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const ecoute = (cible, type, f, cap) => { (cible.ls[type] ||= []).push({ f, cap: !!(cap && (cap === true || cap.capture)) }); };
  const retire = (cible, type, f, cap) => {
    const c = !!(cap && (cap === true || cap.capture));
    cible.ls[type] = (cible.ls[type] || []).filter(x => !(x.f === f && x.cap === c));
  };
  class Ev {
    constructor(type, init) { Object.assign(this, { type, defaultPrevented: false, arret: false }, init || {}); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.arret = true; }
  }
  function correspond(el, sel) {
    return sel.split(",").some(s => {
      const m = /^([a-zA-Z][\w-]*)?((?:#[\w-]+|\.[\w-]+|\[[^\]]+\])*)$/.exec(s.trim());
      if (!m) throw new Error("sélecteur non géré par le mini-DOM : " + s);
      if (m[1] && el.localName !== m[1].toLowerCase()) return false;
      return (m[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || []).every(p => {
        if (p[0] === "#") return el.getAttribute("id") === p.slice(1);
        if (p[0] === ".") return el.classList.contains(p.slice(1));
        const a = /^\[([\w-]+)(?:(\^?=)"?([^"]*)"?)?\]$/.exec(p);
        if (!el.hasAttribute(a[1])) return false;
        if (!a[2]) return true;
        const v = el.getAttribute(a[1]);
        return a[2] === "=" ? v === a[3] : v.startsWith(a[3]);
      });
    });
  }
  class El {
    constructor(tag) { this.localName = tag.toLowerCase(); this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.childNodes = []; this.parentNode = null; this.ls = {}; this.inert = false; this.focusCount = 0; }
    get nodeType() { return 1; }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
    setAttribute(n, v) { this.attrs.set(n, String(v)); }
    removeAttribute(n) { this.attrs.delete(n); }
    hasAttribute(n) { return this.attrs.has(n); }
    get id() { return this.getAttribute("id") || ""; }
    set id(v) { this.setAttribute("id", v); }
    get className() { return this.getAttribute("class") || ""; }
    set className(v) { this.setAttribute("class", v); }
    get classList() {
      const el = this, lire = () => el.className.split(/\s+/).filter(Boolean);
      return {
        contains: c => lire().includes(c),
        add: (...cs) => el.className = [...new Set(lire().concat(cs))].join(" "),
        remove: (...cs) => el.className = lire().filter(x => !cs.includes(x)).join(" "),
        toggle: (c, f) => { const on = f == null ? !lire().includes(c) : f; on ? el.classList.add(c) : el.classList.remove(c); return on; },
      };
    }
    get hidden() { return this.hasAttribute("hidden"); }
    set hidden(v) { v ? this.setAttribute("hidden", "") : this.removeAttribute("hidden"); }
    get type() { return this.getAttribute("type") || ""; }
    get value() { return this._value != null ? this._value : this.getAttribute("value") || ""; }
    set value(v) { this._value = String(v); }
    get textContent() { return this.childNodes.map(n => (n.nodeType === 3 ? n.text : n.textContent)).join(""); }
    set textContent(v) { this.childNodes.forEach(n => n.parentNode = null); this.childNodes = [{ nodeType: 3, text: String(v), parentNode: this }]; }
    get innerHTML() { return this._html || ""; }
    set innerHTML(html) { this.childNodes.forEach(n => n.parentNode = null); this.childNodes = []; this._html = String(html); analyser(String(html), this); }
    appendChild(n) { if (n.parentNode) n.parentNode.childNodes = n.parentNode.childNodes.filter(x => x !== n); n.parentNode = this; this.childNodes.push(n); return n; }
    remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter(x => x !== this); this.parentNode = null; }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    descendants() { return this.children.flatMap(c => [c].concat(c.descendants())); }
    querySelectorAll(sel) { return this.descendants().filter(e => correspond(e, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    matches(sel) { return correspond(this, sel); }
    closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (correspond(x, sel)) return x; return null; }
    addEventListener(t, f, c) { ecoute(this, t, f, c); }
    removeEventListener(t, f, c) { retire(this, t, f, c); }
    dispatchEvent(e) {
      e.target = this;
      const chemin = []; for (let x = this; x; x = x.parentNode) chemin.push(x);
      if (this.isConnected()) chemin.push(doc);
      for (const n of chemin.slice().reverse()) for (const l of (n.ls[e.type] || []).filter(l => l.cap)) { e.currentTarget = n; l.f.call(n, e); }
      for (const n of chemin) { for (const l of (n.ls[e.type] || []).filter(l => !l.cap)) { e.currentTarget = n; l.f.call(n, e); } if (e.arret) break; }
      return !e.defaultPrevented;
    }
    isConnected() { for (let x = this; x; x = x.parentNode) if (x === doc.body) return true; return false; }
    focus() {
      for (let x = this; x; x = x.parentNode) if (x.inert) return; // un élément inerte ne prend pas le focus
      doc.activeElement = this; this.focusCount++;
      this.dispatchEvent(new Ev("focusin"));
    }
    click() { this.dispatchEvent(new Ev("click")); }
  }
  function analyser(html, parent) {
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:="[^"]*"|='[^']*')?)*)\s*(\/?)>|([^<]+)/g;
    let cur = parent, m;
    while ((m = re.exec(html))) {
      if (m[5] != null) { cur.childNodes.push({ nodeType: 3, text: decode(m[5]), parentNode: cur }); continue; }
      if (!m[2]) continue;
      const tag = m[2].toLowerCase();
      if (m[1]) { let n = cur; while (n && n !== parent && n.localName !== tag) n = n.parentNode; if (n && n !== parent) cur = n.parentNode; continue; }
      const el = new El(tag);
      for (const a of m[3].matchAll(/([^\s=\/]+)(?:="([^"]*)"|='([^']*)')?/g)) el.attrs.set(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? ""));
      cur.appendChild(el);
      if (!m[4] && !VIDES.has(tag)) cur = el;
    }
  }
  const doc = {
    ls: {}, activeElement: null,
    createElement: t => new El(t),
    addEventListener(t, f, c) { ecoute(doc, t, f, c); },
    removeEventListener(t, f, c) { retire(doc, t, f, c); },
  };
  doc.documentElement = new El("html");
  doc.body = doc.documentElement.appendChild(new El("body"));
  doc.activeElement = doc.body;
  const touche = (el, key, extra) => { const e = new Ev("keydown", Object.assign({ key }, extra)); el.dispatchEvent(e); return e; };
  const changer = el => el.dispatchEvent(new Ev("change"));
  return { doc, Ev, touche, changer };
}

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
  for (const f of ["esc", "carte", "onglets", "bascule", "accordeon", "voirPlus", "brancher", "periode", "demanderAClaude", "urlClaude"])
    assert.equal(typeof G[f], "function", "UI." + f);
  for (const f of ["ouvrir", "fermer", "ouvert"]) assert.equal(typeof G.panneau[f], "function", "UI.panneau." + f);
  assert.equal(typeof UI.carte, "function");
  assert.equal(typeof UI.htmlOnglets, "function");
  assert.equal(typeof UI.htmlBascule, "function");
  assert.equal(typeof UI.cibleClavier, "function");
});

test("ui.js : l'API est documentée en tête de fichier (signature et exemple par composant)", () => {
  const tete = js.slice(0, js.indexOf("(function"));
  for (const nom of ["UI.esc", "UI.carte", "UI.panneau.ouvrir", "UI.panneau.fermer", "UI.panneau.ouvert", "UI.onglets", "UI.bascule",
    "UI.accordeon", "UI.voirPlus", "UI.brancher", "UI.periode", "UI.demanderAClaude", "UI.urlClaude"])
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
  assert.match(h, /<div class="ui-voirplus-liste ui-voirplus-reste" id="(ui-reste-\d+)" hidden>/);
  const id = /id="(ui-reste-\d+)"/.exec(h)[1];
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
  const mobile = css.slice(css.indexOf("@media (max-width:899.98px)"));
  assert.match(mobile, /\.ui-voirplus-btn\{min-height:40px/, "« Voir plus » d'au moins 40 px de haut sur mobile");
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
  for (const v of ["--surface", "--ink", "--muted", "--line", "--accent", "--good", "--crit", "--radius", "--f-num"]) assert.ok(css.includes("var(" + v), v);
  assert.match(css, /@media \(min-width:900px\)/);
  assert.match(css, /@media \(max-width:899\.98px\)/);
  assert.match(css, /max-height:85vh/);
  assert.match(css, /width:min\(420px/);
  assert.match(css, /\.ui-sr\{/);
});
