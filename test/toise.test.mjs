// Pilotage › Rang (web/src/toise.*) : « Où je me situe parmi les Français ? ». Verdict et rangs en cartes, détail en onglets
// (UI.onglets), hypothèses dans un panneau, méthode en accordéon. Le moteur (ENGINE-START … ENGINE-END) ne change pas :
// test/port.test.mjs vérifie qu'il est recopié à l'identique ; ici, les résultats de derive() sont figés sur l'ancienne page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const read = rel => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");
const js = read("web/src/toise.js"), html = read("web/src/toise.html"), css = read("web/src/toise.css");
const T = require("../web/src/toise.js");
const Reperes = require("../web/src/reperes.js");
// Le code de crédit lit les repères datés (taux du jour, taux d'usure, frais) : mêmes taux qu'avant la migration (15 ans 3,14 %, 20 ans 3,27 %, 25 ans 3,35 %).
import { reperesComplets } from "./helpers/projection-cas.mjs";
T.chargerCredit(reperesComplets());
// Espaces fines insécables des montants (Intl fr-FR) ramenées à des espaces simples pour comparer.
const n = x => String(x).replace(/[\u202f\u00a0]/g, " ");
const etat = over => { Object.assign(T._etat, JSON.parse(JSON.stringify(T.DEFAULTS)), over || {}); return T.derive(); };

test("toise.js : se compile, s'enregistre sous « toise », sans requête DOM globale ni capture des [data-goto]", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "toise.js" }));
  assert.match(js, /App\.register\("toise",api\)/);
  assert.ok(!js.split("\n").some(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l)));
  assert.doesNotMatch(js, /\[data-goto\]/, "plus de capture des liens data-goto : la navigation de l'App les traite");
  assert.doesNotMatch(html, /data-goto=/, "les sous-onglets internes ne passent plus par data-goto");
  assert.match(js, /\.onglets\(/, "onglets UI.onglets");
  assert.match(js, /hcsf_taux_effort/, "plafond HCSF lu dans les repères");
});

test("toise.html : question, verdict, cartes, onglets, quatre volets, méthode en accordéon fermé, hypothèses hors page", () => {
  assert.ok(html.includes("Ta place parmi les Français"));
  for (const id of ["tsVerdict", "tsCartes", "tsOnglets", "tsHypBtn", "tsHypHolder", "tsHyp", "toise-p-rev", "toise-p-sal", "toise-p-pat", "toise-p-loan"])
    assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.ok(html.includes("Modifier mes hypothèses"));
  assert.doesNotMatch(html, /role="tablist"/, "la barre d'onglets est rendue par UI.onglets");
  assert.match(html, /<div id="tsHypHolder" hidden>/, "les saisies ne s'affichent que dans le panneau");
  for (const s of ["rev", "sal", "pat", "loan"]) assert.match(html, new RegExp('data-ts-sec="' + s + '"'), "section d'hypothèses " + s);
  assert.match(html, /<details class="ui-acc ts-methode"/, "méthode et sources en accordéon");
  assert.doesNotMatch(html.replace(/<details class="opt"[^>]*>/g, ""), /<details[^>]*\sopen/, "accordéons fermés par défaut");
  for (const s of ["rev", "sal", "pat", "loan"]) assert.match(html, new RegExp('id="toise-p-' + s + '" role="tabpanel" tabindex="0"'), "panneau d'onglet focalisable " + s);
  for (const t of ["Les classes sociales", "Tableau des seuils", "Courbe complète", "Marge d'erreur", "Détail du calcul", "Ton dossier vu par la banque",
    "Le plan de financement", "Au fil des années", "Selon la durée et le taux obtenu", "Règles et hypothèses", "Réinitialiser mes saisies"])
    assert.ok(html.includes(t), t);
});

test("derive() : résultats identiques à l'ancienne page (rangs, capacité, endettement)", () => {
  const ATTENDU = [
    [{}, "Top 25 %", "Top 28 %", "Top 39 %", 346456, 0, 0.35, 75.200868, 61.466103],
    [{ lmode: "price" }, "Top 25 %", "Top 28 %", "Top 39 %", 318182, 0, 0.321437, 75.200868, 61.466103],
    [{ ad: 1, kids: 2, inc: 2100, sal: 2100, own: 20000, debt: 0, patDetail: false, age: "u30" }, "13 % plus modestes", "42 % moins payés", "23 % moins dotés", 146722, 0, 0.35, 13.209544, 22.974869],
    [{ inc: 15000, sal: 12000, patDetail: true, immo: 900000, fin: 400000, pro: 0, res: 30000, debt: 100000, credits: 400, lmode: "price", price: 600000, year: "2024" }, "≈ Top 1,4 %", "Top 1 %", "Top 4 %", 622222, 0, 0.236196, 98.634649, 95.578743],
    [{ inc: 0, sal: 0, own: 0, debt: 0 }, "–", "–", "–", 0, 0, null, null, null],
    [{ bien: "neuf", zone: "A", inc: 3500, kids: 2, teens: 1, apport: 10000 }, "20 % plus modestes", "Top 28 %", "Top 39 %", 114429, 116461, 0.35, 19.795339, 61.466103],
  ];
  for (const [c, rev, sal, pat, C, ptz, dti, pF, pPN] of ATTENDU) {
    const D = etat(c);
    assert.equal(T.foyerTab(D), rev, JSON.stringify(c));
    assert.equal(D.aS ? T.tabValue(D.aS, "moins payés") : "–", sal);
    assert.equal(D.aPN ? T.tabValue(D.aPN, "moins dotés") : "–", pat);
    assert.equal(Math.round(D.L.C), C);
    assert.equal(Math.round(D.L.ptz.amt), ptz);
    assert.equal(isFinite(D.L.dti) ? +D.L.dti.toFixed(6) : null, dti);
    assert.equal(D.aF ? +D.aF.p.toFixed(6) : null, pF);
    assert.equal(D.aPN ? +D.aPN.p.toFixed(6) : null, pPN);
  }
});

test("plafondHcsf : repère hcsf_taux_effort (en %) borné à [20, 60], sinon null (information seulement)", () => {
  assert.equal(T.plafondHcsf([], Reperes), null);
  assert.equal(T.plafondHcsf(null, null), null);
  assert.equal(T.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: 35, unite: "%" }], Reperes), 0.35);
  assert.equal(T.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: 36, unite: "%" }], Reperes), 0.36);
  assert.equal(T.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: 20 }], Reperes), 0.2);
  assert.equal(T.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: 60 }], Reperes), 0.6);
  assert.equal(T.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: "abc" }], Reperes), null);
  assert.equal(T.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: 0.35 }], Reperes), null, "une fraction est rejetée");
  assert.equal(T.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: 19.9 }], Reperes), null);
  assert.equal(T.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: 250 }], Reperes), null, "valeur aberrante ignorée");
});

test("texteHcsf : plafond du moteur (35 %, dérogation 40 %), repère en information, avertissement s'il diffère", () => {
  const t = T.texteHcsf(0.35, 0.1);
  assert.match(t.plafond, /^Plafond d'endettement \(norme HCSF\) : 35 % des revenus, assurance comprise ; dérogation possible jusqu'à 40 %\. Tes crédits en cours en représentent 10 %\.$/);
  assert.equal(t.repere, "Repère du savoir commun « Taux d'effort maximal HCSF » : 35 %.");
  assert.equal(t.avertissement, "");
  const d = T.texteHcsf(0.36, 0);
  assert.match(d.avertissement, /Ce repère \(36 %\) diffère du plafond du simulateur \(35 %\) : les calculs restent faits à 35 %\./);
  const sans = T.texteHcsf(null, 0);
  assert.equal(sans.repere, "");
  assert.equal(sans.avertissement, "");
  assert.match(T.texteHcsf(0.335, null).repere, /33,5 %/);
});

test("perimetre : libellés du foyer et des vues individuelles (p1 tutoyé, p2 nommé)", () => {
  const f = T.perimetre("foyer", { p1: "Camille", p2: "Sam" });
  assert.deepEqual([f.id, f.pour, f.titreDe, f.salDe, f.rev], ["foyer", "pour le foyer", " du foyer", " de Camille", "Revenus du foyer"]);
  const p1 = T.perimetre("p1", { p1: "Camille", p2: "Sam" });
  assert.deepEqual([p1.id, p1.individuel, p1.pour, p1.titreDe, p1.sal, p1.pat, p1.rev, p1.passe], ["p1", true, "pour Camille", " de Camille", "Ton salaire", "Ton patrimoine", "Tes revenus", "tu passes"]);
  const p2 = T.perimetre("p2", { p1: "Camille", p2: "Anne" });
  assert.deepEqual([p2.pour, p2.titreDe, p2.sal, p2.passe], ["pour Anne", " d'Anne", "Le salaire d'Anne", "Anne passe"]);
  assert.equal(T.perimetre("p1", { p1: "Moi" }).pour, "pour toi", "nom par défaut");
  assert.equal(T.perimetre("p1", { p1: "Moi" }).titreDe, " (toi)");
  assert.equal(T.perimetre("p2", {}).pour, "pour la personne 2");
  assert.equal(T.perimetre("x").id, "foyer");
});

test("verdict : une phrase sur le niveau de vie et le patrimoine, pour le périmètre, orientée quand une donnée manque", () => {
  let v = T.verdict(etat());
  assert.equal(v.phrase, "Pour le foyer, le niveau de vie se situe dans le top 25 % des Français ; le patrimoine net, dans le top 39 % des ménages.");
  v = T.verdict(etat(), T.perimetre("p1", { p1: "Camille" }));
  assert.match(v.phrase, /^Pour Camille, le niveau de vie se situe dans le top 25 %/);
  v = T.verdict(etat({ ad: 1, kids: 2, inc: 2100, own: 20000, debt: 0, patDetail: false }));
  assert.match(v.phrase, /^Pour le foyer, le niveau de vie se situe parmi les 13 % les plus modestes des Français ; le patrimoine net, parmi les \d+ % les moins dotés des ménages\.$/);
  v = T.verdict(etat({ inc: 0 }));
  assert.match(v.phrase, /^Pour le foyer, le patrimoine net se situe dans le top 39 % des ménages\. Renseigne les revenus/);
  v = T.verdict(etat({ own: 0, debt: 0 }));
  assert.equal(v.phrase, "Pour le foyer, le niveau de vie se situe dans le top 25 % des Français.");
  v = T.verdict(etat({ inc: 0, own: 0, debt: 0 }));
  assert.match(v.phrase, /^Renseigne les revenus et le patrimoine du foyer/);
  v = T.verdict(etat({ inc: 15000, year: "2024" }));
  assert.match(v.phrase, /top 1,4 % des Français \(estimation\)/, "haut de l'échelle estimé signalé");
});

test("cartes : niveau de vie, salaire, patrimoine, emprunt ; badge et textes selon les seuils du moteur (35 %, 40 %) ; titres avec le périmètre", () => {
  let D = etat(), c = T.cartes(D, { lmode: "cap" });
  assert.deepEqual(c.map(x => x.id), ["rev", "sal", "pat", "loan"]);
  assert.deepEqual(c.map(x => x.titre), ["Niveau de vie du foyer", "Salaire", "Patrimoine net du foyer", "Capacité d'emprunt du foyer"]);
  assert.deepEqual(T.cartes(D, { lmode: "cap", perimetre: T.perimetre("foyer", { p1: "Camille" }) }).map(x => x.titre)[1], "Salaire de Camille");
  assert.deepEqual(T.cartes(D, { lmode: "cap", perimetre: T.perimetre("p2", { p2: "Sam" }) }).map(x => x.titre),
    ["Niveau de vie de Sam", "Salaire de Sam", "Patrimoine net de Sam", "Capacité d'emprunt de Sam"]);
  assert.equal(c[0].valeur, "Top 25 %");
  assert.equal(c[0].sous, "Classes moyennes supérieures");
  assert.equal(c[1].valeur, "Top 28 %");
  assert.equal(c[1].sous, "parmi les salariés du privé");
  assert.equal(c[2].valeur, "Top 39 %");
  assert.equal(c[2].sous, "Patrimoine intermédiaire");
  assert.equal(n(c[3].valeur), "≈ 346 k€");
  assert.equal(c[3].sous, "sur 25 ans · endettement actuel 0 %, plafond HCSF 35 %");
  assert.equal(c[3].badge, null);
  // le repère du savoir commun ne change ni le badge ni le texte : seuls les seuils du moteur comptent
  assert.deepEqual(T.cartes(D, { lmode: "cap", plafond: 0.2 })[3], c[3]);
  D = etat({ credits: 2000 }); c = T.cartes(D, { lmode: "cap" });
  assert.equal(c[3].valeur, "0 €");
  assert.deepEqual(c[3].badge, { texte: "Au plafond", ton: "critique" });
  D = etat({ lmode: "price" }); c = T.cartes(D, { lmode: "price" });
  assert.equal(c[3].titre, "Endettement du foyer");
  assert.equal(c[3].valeur, "32 %");
  assert.equal(n(c[3].sous), "pour un logement à 320 000 € · plafond HCSF 35 %");
  assert.deepEqual(c[3].badge, { texte: "Finançable", ton: "bon" });
  D = etat({ lmode: "price", price: 380000 });
  assert.ok(D.L.dti > 0.35 && D.L.dti <= 0.40);
  assert.deepEqual(T.cartes(D, { lmode: "price" })[3].badge, { texte: "Dérogation nécessaire", ton: "attention" });
  D = etat({ lmode: "price", price: 420000 });
  assert.ok(D.L.dti > 0.40);
  assert.deepEqual(T.cartes(D, { lmode: "price" })[3].badge, { texte: "Hors des normes", ton: "critique" });
  D = etat({ inc: 0, sal: 0, own: 0, debt: 0 }); c = T.cartes(D, { lmode: "cap" });
  assert.deepEqual(c.map(x => x.valeur), ["–", "–", "–", "–"]);
  assert.equal(c[0].sous, "Renseigne les revenus");
  assert.equal(c[3].sous, "Renseigne les revenus");
});

test("resumeHypotheses : une ligne courte et un résumé par section", () => {
  const r = T.resumeHypotheses(T.DEFAULTS);
  assert.equal(n(r.court), "Couple sans enfant, 5 000 € net / mois, 30 à 39 ans");
  assert.equal(n(T.resumeHypotheses(Object.assign({}, T.DEFAULTS, { ad: 1 }), T.perimetre("p1", { p1: "Camille" })).court), "Camille, personne seule, 5 000 € net / mois, 30 à 39 ans");
  assert.equal(n(r.sections.rev), "Couple sans enfant · 5 000 € net / mois");
  assert.equal(n(r.sections.sal), "3 000 € net / mois");
  assert.equal(n(r.sections.pat), "425 000 € possédés · 180 000 € dus");
  assert.equal(n(r.sections.loan), "Apport 30 000 € · 25 ans · ancien");
  const r2 = T.resumeHypotheses(Object.assign({}, T.DEFAULTS, { ad: 1, kids: 1, incUnit: "ba", inc: 60000, salUnit: "bm", statut: "cadre", year: "2024", patDetail: true, immo: 100000, fin: 5000, pro: 0, res: 0, credits: 300, lmode: "price", price: 250000 }));
  assert.equal(n(r2.court), "Parent seul, 1 enfant, 60 000 € brut / an, 30 à 39 ans, montants de 2024");
  assert.equal(n(r2.sections.sal), "3 000 € brut / mois, cadre");
  assert.equal(n(r2.sections.pat), "105 000 € possédés · 180 000 € dus");
  assert.equal(n(r2.sections.loan), "Logement à 250 000 € · apport 30 000 € · 25 ans · ancien · crédits 300 € / mois");
});

test("panneauHtml : rang, phrase, classe, marge, palier, actions ; tout est échappé", () => {
  const h = T.panneauHtml("rev", { big: "Top <b>", sent: "Phrase <script>", cls: { n: "Classe & co" }, a: { p: 60, lo: 58, hi: 62 }, next: "Encore \"x\"" });
  assert.ok(!h.includes("<script>") && h.includes("&lt;script&gt;"));
  assert.ok(h.includes("Top &lt;b&gt;") && h.includes("Classe &amp; co") && h.includes("Encore &quot;x&quot;"));
  assert.match(h, /Marge d&#39;erreur : rang 58 à 62 sur 100/, "apostrophe échappée elle aussi");
  assert.match(h, /data-ts-act="voir" data-ts-id="rev"/);
  assert.match(h, /data-ts-act="hyp" data-ts-id="rev"/);
  const vide = T.panneauHtml("sal", { eye: "Votre salaire", sent: "Indiquez votre salaire pour voir votre position." });
  assert.match(vide, /Indiquez votre salaire/);
  assert.doesNotMatch(vide, /Marge d/);
  const loan = T.panneauHtml("loan", { big: "≈ 346 000 €", sent: "C'est ce que…", kpis: [["Mensualité", "1 750 €", "assurance comprise"]], status: { texte: "Finançable", cls: "ok" }, plafond: "Plafond <35 %>" });
  assert.match(loan, /Mensualité/);
  assert.match(loan, /Finançable/);
  assert.ok(loan.includes("Plafond &lt;35 %&gt;"));
});

test("questions à Claude : page et carte, sans montant", () => {
  const D = etat();
  const q = T.questionPage(D);
  assert.match(q, /top 25 % des Français/);
  assert.match(q, /le niveau de vie de mon foyer/);
  assert.match(T.questionPage(D, T.perimetre("p2", { p2: "Sam" })), /le niveau de vie de Sam/);
  assert.doesNotMatch(q, /€/);
  const qc = T.questionCarte("pat", D);
  assert.match(qc, /patrimoine net/);
  assert.doesNotMatch(qc, /€/);
  assert.match(T.questionCarte("loan", D), /capacité d'emprunt|endettement/);
});

test("toise.css : chaque @media commence après une règle fermée", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [...c.matchAll(/@media/g)].filter(m => !/(^|\})\s*$/.test(c.slice(0, m.index)));
  assert.equal(bad.length, 0);
});

/* ------------------------------------------------------------ lecture seule, tutoiement ------------------------------------------------------------ */
const sansCommentaires = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const horsMoteur = src => src.replace(/\/\*ENGINE-START\*\/[\s\S]*?\/\*ENGINE-END\*\//, "");
const VOUVOIEMENT = /\b(vous|votre|vos|Vous|Votre|Vos|vôtre)\b|\b(indiquez|complétez|laissez|survolez|cochez|renseignez|ouvrez)\b/i;
const chainesJs = src => [...sansCommentaires(src).matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map(m => m[1] ?? m[2] ?? m[3]);

test("toise : simulateur, aucune écriture au store ; « Compléter avec Claude » pour les vraies données", () => {
  const code = sansCommentaires(js);
  assert.doesNotMatch(code, /Store\.|\.db\.|\.update\(\{|\.insert\(|\.upsert\(/, "aucune écriture au store");
  assert.match(code, /'Compléter avec Claude'/);
  assert.match(code, /ClaudePrompts/);
  assert.doesNotMatch(html, /data-goto-tab="compte\/donnees"/, "plus de renvoi vers une saisie dans Compte › Données");
});

test("toise : textes affichés au tutoiement, hors bloc moteur (ENGINE-START … ENGINE-END)", () => {
  assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), VOUVOIEMENT, "toise.html");
  assert.deepEqual(chainesJs(horsMoteur(js)).filter(t => VOUVOIEMENT.test(t)), [], "toise.js hors moteur");
  // Le bloc moteur, recopié à l'identique, ne contient pas non plus de vouvoiement (rien à y signaler).
  const moteur = js.match(/\/\*ENGINE-START\*\/([\s\S]*?)\/\*ENGINE-END\*\//)[1];
  assert.deepEqual(chainesJs(moteur).filter(t => VOUVOIEMENT.test(t)), []);
});

/* ------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------ */
import { miniDom } from "./helpers/mini-dom.mjs";
/* Compléments du mini-DOM partagé pour la Toise (dataset, style, append, open, sélecteurs descendants…), posés sur le prototype
   des éléments de CE mini-DOM uniquement. */
function domToise() {
  const dom = miniDom(), { doc } = dom;
  const proto = Object.getPrototypeOf(doc.createElement("div"));
  const correspondSimple = proto.matches;
  const camel = k => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const kebab = k => "data-" + k.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
  Object.defineProperties(proto, {
    dataset: { get() { const el = this; return new Proxy({}, {
      get: (_, k) => typeof k === "string" ? el.getAttribute(kebab(k)) ?? undefined : undefined,
      set: (_, k, v) => { el.setAttribute(kebab(k), v); return true; },
      deleteProperty: (_, k) => { el.removeAttribute(kebab(k)); return true; },
      has: (_, k) => el.hasAttribute(kebab(k)),
      ownKeys: () => [...el.attrs.keys()].filter(a => a.startsWith("data-")).map(a => camel(a.slice(5))),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) }); } },
    style: { get() { return this._style || (this._style = { setProperty(k, v) { this[k] = v; } }); } },
    open: { get() { return this.hasAttribute("open"); }, set(v) { if (v) this.setAttribute("open", ""); else this.removeAttribute("open"); } },
    options: { get() { return this.querySelectorAll("option"); } },
    firstChild: { get() { return this.childNodes[0] || null; } },
    type: { get() { return this.getAttribute("type") || ""; }, set(v) { this.setAttribute("type", v); } },
  });
  proto.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0 });
  proto.append = function (...ns) { ns.forEach(n => this.appendChild(n)); };
  proto.prepend = function (n) { this.appendChild(n); this.childNodes = [n].concat(this.childNodes.filter(x => x !== n)); };
  proto.select = function () {};
  /* Sélecteurs composés : descendant (espace) et enfant (>), de droite à gauche. */
  const complexe = (el, sel) => {
    const t = sel.trim().replace(/\s*>\s*/g, " > ").split(/\s+/);
    const m = (e, i) => {
      if (!e || e.nodeType !== 1 || !correspondSimple.call(e, t[i])) return false;
      if (i === 0) return true;
      if (t[i - 1] === ">") return m(e.parentNode, i - 2);
      for (let p = e.parentNode; p && p.nodeType === 1; p = p.parentNode) if (m(p, i - 1)) return true;
      return false;
    };
    return m(el, t.length - 1);
  };
  proto.querySelectorAll = function (sel) { const parts = sel.split(","); return this.descendants().filter(e => parts.some(p => complexe(e, p))); };
  proto.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  doc.createElementNS = (ns, t) => doc.createElement(t);
  return dom;
}
function vueToise(snap, o = {}) {
  const dom = domToise(), { doc } = dom;
  const modules = {}, stock = new Map();
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, CSS: { escape: s => String(s).replace(/["\\]/g, "\\$&") },
    localStorage: { getItem: k => (stock.has(k) ? stock.get(k) : null), setItem: (k, v) => stock.set(k, String(v)), removeItem: k => stock.delete(k) },
    location: { hash: o.hash || "" }, scrollTo() {}, scrollY: 0 };
  ctx.window = ctx; ctx.self = ctx;
  ctx.App = { register: (nm, api) => { modules[nm] = api; } };
  vm.createContext(ctx);
  for (const f of ["calc.js", "reperes.js", "projection-outils.js", "projection-credit.js", "ui.js", "claude-prompts.js"].concat(o.reel ? ["reel.js"] : [])) vm.runInContext(read("web/src/" + f), ctx, { filename: f });
  ctx.module = { exports: {} }; // fonctions pures et état de la Toise (module.exports), la vue restant montée
  vm.runInContext(js, ctx, { filename: "toise.js" });
  ctx.module.exports.chargerCredit(reperesComplets());
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = html;
  const api = modules.toise;
  api.mount(root);
  api.update(snap || {}, true);
  const $ = id => root.querySelector("#" + id) || doc.body.querySelector("#" + id);
  return { ctx, dom, doc, root, api, $, T: ctx.module.exports, stock };
}

test("vue (DOM) : « Modifier mes hypothèses » déplace les saisies dans le panneau, Échap les remet en place et rend le focus", () => {
  const v = vueToise();
  const btn = v.$("tsHypBtn"), hyp = v.$("tsHyp");
  assert.equal(hyp.parentNode, v.$("tsHypHolder"));
  btn.focus(); btn.click();
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  assert.equal(dlg.hidden, false);
  assert.equal(hyp.parentNode, dlg.querySelector(".ui-panneau-corps"), "saisies dans le panneau");
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Mes hypothèses pour le foyer");
  assert.match(dlg.querySelector(".ui-panneau-pied").textContent, /Compléter avec Claude/);
  assert.ok(hyp.querySelector('[data-ts-sec="rev"]').open, "section de l'onglet actif ouverte");
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true);
  assert.equal(hyp.parentNode, v.$("tsHypHolder"), "saisies revenues dans leur conteneur masqué");
  assert.equal(v.doc.activeElement, btn, "focus rendu au bouton");
});

test("vue (DOM) : textes du panneau « Mes hypothèses » à jour quel que soit l'onglet actif (emprunt, salaire, Affiner en mots)", () => {
  const v = vueToise();
  assert.equal(v.T._etat.tab, "rev");
  const D = v.T.derive();
  assert.equal(n(v.$("loan-inc").textContent), n(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(D.h.incM / 100) * 100) + " € / mois"));
  assert.match(v.$("rate-help").textContent, /sur 25 ans/);
  assert.match(v.$("rfr-help").textContent, /^Vide : estimé à/);
  assert.equal(v.$("type-field").hidden, true, "ancien : pas de type de logement neuf");
  assert.equal(v.$("trav-field").hidden, false);
  v.$("tsHypBtn").click();
  // depuis l'onglet Niveau de vie : logement neuf, 15 ans, salaire en brut mensuel, taux saisi
  v.$("tsHyp").querySelector('[data-seg="bien"]').querySelector('[data-v="neuf"]').click();
  v.$("tsHyp").querySelector('[data-seg="duree"]').querySelector('[data-v="15"]').click();
  assert.equal(v.T._etat.tab, "rev", "toujours sur l'onglet Niveau de vie");
  assert.equal(v.$("type-field").hidden, false);
  assert.equal(v.$("trav-field").hidden, true);
  assert.match(v.$("rate-help").textContent, /sur 15 ans/);
  const su = v.$("sal-unit"); su.value = "bm"; v.dom.changer(su);
  assert.match(v.$("sal-help").textContent, /^Brut mensuel : environ/);
  const taux = v.$("rateC"); taux.value = "3,5"; taux.dispatchEvent(new v.dom.Ev("input"));
  assert.equal(v.$("opt-loan-n").textContent, "· modifié");
  for (const k of ["rev", "sal", "pat", "loan"]) assert.doesNotMatch(v.$("opt-" + k + "-n").textContent, /\d/, "pas de compteur (règle 9)");
  // célibataire dont le salaire diffère des revenus du foyer : rappel affiché, même hors de l'onglet Salaire
  Object.assign(v.T._etat, { ad: 1, kids: 0, k3: 0, inc: 5000, sal: 2000, salUnit: "nm", aid: 0 });
  v.api.update({}, true);
  assert.equal(v.$("sal-hint").hidden, false);
  assert.match(v.$("sal-hint-t").textContent, /une personne seule avec/);
});

test("vue (DOM) : onglets (UI.onglets) au clavier, panneaux d'onglet focalisables", () => {
  const v = vueToise();
  const tabs = v.$("tsOnglets").querySelectorAll('[role="tab"]');
  assert.equal(tabs.length, 4);
  for (const id of ["rev", "sal", "pat", "loan"]) assert.equal(v.$("toise-p-" + id).getAttribute("tabindex"), "0");
  assert.equal(tabs[0].getAttribute("aria-controls"), "toise-p-rev");
  tabs[0].focus();
  v.dom.touche(tabs[0], "ArrowRight");
  assert.equal(v.T._etat.tab, "sal");
  assert.equal(v.$("toise-p-sal").hidden, false);
  assert.equal(v.$("toise-p-rev").hidden, true);
  assert.equal(v.doc.activeElement, tabs[1]);
  v.dom.touche(tabs[1], "End");
  assert.equal(v.T._etat.tab, "loan");
  assert.match(v.$("l-sent").textContent, /\S/, "onglet Emprunt rendu");
});

test("vue (DOM) : panneau d'une carte rafraîchi sans voler le focus ; fermeture rend le focus à la carte, sinon au verdict", () => {
  const v = vueToise();
  const carte = v.root.querySelector('[data-ui-carte="rev"]');
  carte.focus(); carte.click();
  const dlg = v.doc.body.querySelector('[role="dialog"]'), corps = dlg.querySelector(".ui-panneau-corps"), titre = dlg.querySelector(".ui-panneau-titre");
  assert.equal(titre.textContent, "Niveau de vie du foyer");
  const voir = corps.querySelector('[data-ts-act="hyp"]');
  voir.focus();
  const avant = corps.innerHTML, nTitre = titre.focusCount, href = dlg.querySelector(".ui-panneau-pied").querySelector(".ui-claude").getAttribute("href");
  v.T._etat.inc = 9000; // le store émet (ou une saisie change) : les chiffres du panneau changent
  v.api.update({}, true);
  assert.notEqual(corps.innerHTML, avant, "corps réécrit");
  assert.equal(titre.focusCount, nTitre, "le focus n'est pas remis sur le titre");
  assert.equal(v.doc.activeElement.getAttribute("data-ts-act"), "hyp", "focus rendu au même bouton");
  assert.ok(corps.contains(v.doc.activeElement));
  assert.notEqual(dlg.querySelector(".ui-panneau-pied").querySelector(".ui-claude").getAttribute("href"), href, "question à Claude mise à jour");
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.activeElement, v.root.querySelector('[data-ui-carte="rev"]'), "focus rendu à la carte");
  // la carte disparaît pendant l'ouverture : repli sur le verdict
  v.root.querySelector('[data-ui-carte="pat"]').click();
  v.$("tsCartes").innerHTML = "";
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.activeElement, v.$("tsVerdict"));
});

test("vue (DOM) : plafond HCSF — carte et panneau selon le moteur (35 %), repère en information avec avertissement s'il diffère", () => {
  const v = vueToise({ savoir: { reperes: [{ cle: "hcsf_taux_effort", valeur: 36, unite: "%" }] } });
  assert.match(v.$("tsCartes").textContent, /plafond HCSF 35 %/);
  v.root.querySelector('[data-ui-carte="loan"]').click();
  const corps = v.doc.body.querySelector(".ui-panneau-corps");
  assert.match(corps.textContent, /Plafond d'endettement \(norme HCSF\) : 35 % des revenus/);
  assert.match(corps.textContent, /Repère du savoir commun « Taux d'effort maximal HCSF » : 36 %/);
  assert.ok(corps.querySelector(".ts-p-avert"), "avertissement");
  v.dom.touche(v.doc.activeElement, "Escape");
  const w = vueToise({ savoir: { reperes: [{ cle: "hcsf_taux_effort", valeur: 35, unite: "%" }] } });
  w.root.querySelector('[data-ui-carte="loan"]').click();
  const c2 = w.doc.body.querySelector(".ui-panneau-corps");
  assert.match(c2.textContent, /: 35 %\./);
  assert.equal(c2.querySelector(".ts-p-avert"), null, "pas d'écart, pas d'avertissement");
});

test("vue (DOM) : périmètre — préremplissage réel du foyer, de p1 et de p2 sur la démo ; scénario effacé au changement, message discret", () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const D = JSON.parse(JSON.stringify(global.window.DEMO));
  const Calc = require("../web/src/calc.js");
  const people = [{ id: "p1", nom: D.profil.personnes.p1.nom }, { id: "p2", nom: D.profil.personnes.p2.nom }];
  const snap = scope => ({ ready: true, scope, people, profil: D.profil, profilLoaded: true, positions: D.positions, config: D.config, budget: D.budget });
  const v = vueToise(snap("foyer"), { reel: true });
  const st = v.T._etat, ps = D.profil.personnes;
  const net = k => Calc.salaireNetMensuel(ps[k]) + (+ps[k].autresRevenus || 0);
  // foyer : adultes et enfants du foyer, revenus cumulés, patrimoine et crédits du foyer
  assert.equal(st.ad, D.profil.foyer.adultes);
  assert.equal(st.kids, D.profil.foyer.enfants);
  assert.equal(st.inc, Math.round(net("p1") + net("p2")));
  assert.equal(st.debt, Math.round(Calc.patrimoine(D.positions, D.profil, "foyer").dettes));
  assert.equal(st.credits, Math.round(Calc.mensualites(D.profil, "foyer")));
  assert.match(v.$("tsVerdict").textContent, /^Pour le foyer, /);
  assert.equal(v.$("tsMsg").textContent, "");
  // une saisie « scénario » sur les revenus
  const inc = v.$("inc"); inc.value = "9999"; inc.dispatchEvent(new v.dom.Ev("input"));
  assert.equal(st.inc, 9999);
  v.api.update(snap("foyer"), true);
  assert.equal(st.inc, 9999, "le scénario reste prioritaire tant que le périmètre ne change pas");
  // p1 : vue individuelle, 1 adulte, son seul revenu, sa part du patrimoine et des crédits
  v.api.update(snap("p1"), true);
  assert.equal(st.ad, 1);
  assert.equal(st.kids, 0);
  assert.equal(st.inc, Math.round(net("p1")), "repart du réel du nouveau périmètre");
  assert.equal(st.sal, ps.p1.salaire);
  assert.equal(st.debt, Math.round(Calc.patrimoine(D.positions, D.profil, "p1").dettes));
  assert.equal(st.credits, Math.round(Calc.mensualites(D.profil, "p1")));
  assert.match(v.$("tsMsg").textContent, new RegExp("Périmètre changé : hypothèses reprises de tes données pour " + ps.p1.nom));
  assert.match(v.$("tsVerdict").textContent, new RegExp("^Pour " + ps.p1.nom + ", "));
  assert.match(v.$("tsPour").textContent, new RegExp("Calculé pour : " + ps.p1.nom + ", personne seule"));
  assert.equal(v.root.querySelector('[data-ui-carte="rev"]').querySelector(".ui-carte-titre").textContent, "Niveau de vie de " + ps.p1.nom);
  assert.equal(v.$("inc-l").textContent, "Tes revenus");
  assert.equal(v.$("sal-l").textContent, "Ton salaire");
  // p2 : idem pour le conjoint, nommé
  v.api.update(snap("p2"), true);
  assert.equal(st.ad, 1);
  assert.equal(st.inc, Math.round(net("p2")));
  assert.equal(st.sal, ps.p2.salaire);
  assert.equal(v.$("sal-l").textContent, "Le salaire de " + ps.p2.nom);
  assert.match(v.$("tsVerdict").textContent, new RegExp("^Pour " + ps.p2.nom + ", "));
  // retour au foyer : revenus cumulés, 2 adultes
  v.api.update(snap("foyer"), true);
  assert.equal(st.ad, D.profil.foyer.adultes);
  assert.equal(st.inc, Math.round(net("p1") + net("p2")));
  // une saisie efface le message
  const s2 = v.$("sal"); s2.value = "3100"; s2.dispatchEvent(new v.dom.Ev("input"));
  assert.equal(v.$("tsMsg").textContent, "");
});

test("bandeau « valeurs d'exemple » : visible dès que revenus ou foyer réels manquent (même avec une ligne de profil), masqué sinon", () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const D = JSON.parse(JSON.stringify(global.window.DEMO));
  const base = profil => ({ ready: true, scope: "foyer", people: [], profil, profilLoaded: true, positions: [], config: D.config, budget: D.budget });
  // nouveau compte réel : ligne de profil créée par handle_new_user, sans rien dedans
  const vide = { foyer: {}, personnes: {}, biens: [], credits: [] };
  const v = vueToise(base(vide), { reel: true });
  assert.equal(v.$("toise-fp").hidden, false, "profil vide mais présent : bandeau affiché");
  assert.match(v.$("tsFpClaude").textContent, /Complète tes données avec Claude/);
  assert.match(v.$("tsFpClaude").innerHTML, /aide-moi%20%C3%A0%20compl%C3%A9ter%20mes%20revenus|compl%C3%A9ter%20mes%20revenus/, "phrase « revenus » de ClaudePrompts");
  // revenus renseignés, foyer manquant : toujours des valeurs d'exemple pour le foyer
  const sansFoyer = JSON.parse(JSON.stringify(D.profil)); sansFoyer.foyer = {};
  v.api.update(base(sansFoyer), true);
  assert.equal(v.$("toise-fp").hidden, false, "foyer absent : bandeau affiché");
  // profil complet (démo) : pas de bandeau
  v.api.update(base(D.profil), true);
  assert.equal(v.$("toise-fp").hidden, true, "revenus et foyer réels : bandeau masqué");
  // profil absent (null) : bandeau affiché, comme avant
  v.api.update(base(null), true);
  assert.equal(v.$("toise-fp").hidden, false);
  // base indisponible : jamais de bandeau
  v.api.update(Object.assign(base(null), { dbOk: false }), true);
  assert.equal(v.$("toise-fp").hidden, true);
});
