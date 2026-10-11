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
  assert.ok(html.includes("Où je me situe parmi les Français ?"));
  for (const id of ["tsVerdict", "tsCartes", "tsOnglets", "tsHypBtn", "tsClaude", "tsHypHolder", "tsHyp", "toise-p-rev", "toise-p-sal", "toise-p-pat", "toise-p-loan"])
    assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.ok(html.includes("Modifier mes hypothèses"));
  assert.doesNotMatch(html, /role="tablist"/, "la barre d'onglets est rendue par UI.onglets");
  assert.match(html, /<div id="tsHypHolder" hidden>/, "les saisies ne s'affichent que dans le panneau");
  for (const s of ["rev", "sal", "pat", "loan"]) assert.match(html, new RegExp('data-ts-sec="' + s + '"'), "section d'hypothèses " + s);
  assert.match(html, /<details class="ui-acc ts-methode"/, "méthode et sources en accordéon");
  assert.doesNotMatch(html.replace(/<details class="opt"[^>]*>/g, ""), /<details[^>]*\sopen/, "accordéons fermés par défaut");
  for (const t of ["Les classes sociales", "Tableau des seuils", "Courbe complète", "Marge d'erreur", "Détail du calcul", "Votre dossier vu par la banque",
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

test("plafondHcsf : repère hcsf_taux_effort s'il est disponible, 35 % sinon", () => {
  assert.equal(T.plafondHcsf([], Reperes), 0.35);
  assert.equal(T.plafondHcsf(null, null), 0.35);
  assert.equal(T.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: 36, unite: "%" }], Reperes), 0.36);
  assert.equal(T.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: "abc" }], Reperes), 0.35);
  assert.equal(T.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: 250 }], Reperes), 0.35, "valeur aberrante ignorée");
});

test("verdict : une phrase sur le niveau de vie et le patrimoine, orientée quand une donnée manque", () => {
  let v = T.verdict(etat());
  assert.equal(v.phrase, "Votre niveau de vie vous place dans le top 25 % des Français ; votre patrimoine net, dans le top 39 % des ménages.");
  v = T.verdict(etat({ ad: 1, kids: 2, inc: 2100, own: 20000, debt: 0, patDetail: false }));
  assert.match(v.phrase, /^Votre niveau de vie vous place parmi les 13 % les plus modestes des Français ; votre patrimoine net, parmi les \d+ % les moins dotés des ménages\.$/);
  v = T.verdict(etat({ inc: 0 }));
  assert.match(v.phrase, /^Votre patrimoine net vous place dans le top 39 % des ménages\. Indiquez les revenus du foyer/);
  v = T.verdict(etat({ own: 0, debt: 0 }));
  assert.equal(v.phrase, "Votre niveau de vie vous place dans le top 25 % des Français.");
  v = T.verdict(etat({ inc: 0, own: 0, debt: 0 }));
  assert.match(v.phrase, /^Indiquez les revenus de votre foyer/);
  v = T.verdict(etat({ inc: 15000, year: "2024" }));
  assert.match(v.phrase, /top 1,4 % des Français \(estimation\)/, "haut de l'échelle estimé signalé");
});

test("cartes : niveau de vie, salaire, patrimoine, emprunt rapporté au plafond HCSF", () => {
  let D = etat(), c = T.cartes(D, { lmode: "cap", plafond: 0.35 });
  assert.deepEqual(c.map(x => x.id), ["rev", "sal", "pat", "loan"]);
  assert.deepEqual(c.map(x => x.titre), ["Niveau de vie", "Salaire", "Patrimoine net", "Capacité d'emprunt"]);
  assert.equal(c[0].valeur, "Top 25 %");
  assert.equal(c[0].sous, "Classes moyennes supérieures");
  assert.equal(c[1].valeur, "Top 28 %");
  assert.equal(c[1].sous, "parmi les salariés du privé");
  assert.equal(c[2].valeur, "Top 39 %");
  assert.equal(c[2].sous, "Patrimoine intermédiaire");
  assert.equal(n(c[3].valeur), "≈ 346 k€");
  assert.equal(c[3].sous, "sur 25 ans · endettement actuel 0 %, plafond HCSF 35 %");
  assert.equal(c[3].badge, null);
  D = etat({ credits: 2000 }); c = T.cartes(D, { lmode: "cap", plafond: 0.35 });
  assert.equal(c[3].valeur, "0 €");
  assert.deepEqual(c[3].badge, { texte: "Au plafond", ton: "critique" });
  D = etat({ lmode: "price" }); c = T.cartes(D, { lmode: "price", plafond: 0.35 });
  assert.equal(c[3].titre, "Endettement");
  assert.equal(c[3].valeur, "32 %");
  assert.equal(n(c[3].sous), "pour un logement à 320 000 € · plafond HCSF 35 %");
  assert.deepEqual(c[3].badge, { texte: "Finançable", ton: "bon" });
  assert.deepEqual(T.cartes(D, { lmode: "price", plafond: 0.30 })[3].badge, { texte: "Dérogation nécessaire", ton: "attention" });
  assert.deepEqual(T.cartes(D, { lmode: "price", plafond: 0.25 })[3].badge, { texte: "Hors des normes", ton: "critique" });
  D = etat({ inc: 0, sal: 0, own: 0, debt: 0 }); c = T.cartes(D, { lmode: "cap", plafond: 0.35 });
  assert.deepEqual(c.map(x => x.valeur), ["–", "–", "–", "–"]);
  assert.equal(c[0].sous, "Indiquez les revenus du foyer");
  assert.equal(c[3].sous, "Indiquez les revenus du foyer");
});

test("resumeHypotheses : une ligne courte et un résumé par section", () => {
  const r = T.resumeHypotheses(T.DEFAULTS);
  assert.equal(n(r.court), "Couple sans enfant, 5 000 € net / mois, 30 à 39 ans");
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
