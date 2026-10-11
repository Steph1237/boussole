// Patrimoine › Budget (module plan, web/src/plan-view.*) : « Où va mon argent chaque mois ? ».
// En-tête (revenus, dépenses, épargne, reste ; bascule Par mois · Par an), barre des catégories, une carte par catégorie
// qui se déplie en lignes, panneau d'une ligne (modifier, supprimer), « Ajouter une ligne », « Remplir avec mon assistant ».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);

const js = readFileSync("web/src/plan-view.js", "utf8");
const css = readFileSync("web/src/plan-view.css", "utf8");
const html = readFileSync("web/src/plan-view.html", "utf8");
const shell = readFileSync("web/src/shell.html", "utf8");
const build = readFileSync("build.mjs", "utf8");
const PV = require("../web/src/plan-view.js");
const UI = require("../web/src/ui.js");
const Plan = require("../web/src/plan.js");
const Calc = require("../web/src/calc.js");
const DEMO = require("../web/src/demo-data.js");

const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ").replace(/&#39;/g, "'");
const DEPS = { Plan, Calc };
const PEOPLE = [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }];
const demoS = () => Object.assign(J(DEMO), { ready: true, dbOk: true, scope: "foyer", people: PEOPLE, error: null });
const ctx = (o = {}) => Object.assign({ profil: DEMO.profil, scope: "foyer", people: PEOPLE }, DEPS, o);
const proche = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, a + " ≈ " + b);

/* ------------------------------------------------------------------ structure ------------------------------------------------------------------ */
test("plan-view.js : se compile, s'enregistre sous « plan », exporte ses fonctions pures", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "plan-view.js" }));
  assert.match(js, /App\.register\("plan", api\)/);
  assert.match(js, /__pending/);
  for (const f of ["lignesProfil", "regrouper", "resume", "barre", "validerLigne", "lignesAEnregistrer", "cartesHtml", "barreHtml", "groupesHtml", "ligneDetailHtml", "ligneFormHtml", "resumeDetailHtml"])
    assert.equal(typeof PV[f], "function", f);
});

test("plan-view.js : budget seul — écrit budget/main par Store.db, dialogue assistant conservé ; objectifs et projection partis", () => {
  assert.match(js, /doc\("budget\/main"\)\.set\(/);
  assert.match(js, /\.prompt\("budget"\)/);
  assert.match(js, /\.parse\(.*"budget"\)/);
  assert.doesNotMatch(js, /collection\("objectifs"\)/);
  assert.doesNotMatch(js, /\.projection\(/);
  assert.doesNotMatch(js, /affecterDeja|statutObjectif/);
});

test("plan-view.js : aucune requête DOM globale hors racine du module", () => {
  const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
  assert.deepEqual(bad, [], "utiliser root.querySelector* au lieu de document.*");
});

test("plan-view.css : scopé sous #view-plan (contenu du panneau sous .ui-panneau .pv-…), @media après une règle fermée, couleurs du thème", () => {
  const c0 = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const badMedia = [...c0.matchAll(/@media/g)].filter(m => !/(^|\})\s*$/.test(c0.slice(0, m.index)));
  assert.deepEqual(badMedia.map(m => m.index), []);
  const c = c0.replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !/^(from|to|\d+%)$/.test(s));
  assert.ok(sels.length > 20, "sélecteurs introuvables");
  const unscoped = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !/^#view-plan\b/.test(x) && !/^\.ui-panneau \.pv-/.test(x));
  assert.deepEqual(unscoped, []);
  assert.match(css, /@media \(max-width:\s*\d+px\)/);
  assert.doesNotMatch(css.replace(/rgba\([^)]*\)/g, ""), /#[0-9a-fA-F]{3,6}\b(?![-\w])/, "couleurs par variables du thème (clair et sombre)");
});

test("plan-view.html : identifiants utilisés par le script, question de la page, dialogue assistant", () => {
  const ids = [...js.matchAll(/\$\("(pv[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 10);
  const missing = [...new Set(ids)].filter(id => !html.includes('id="' + id + '"'));
  assert.deepEqual(missing, []);
  assert.match(html, /Où va mon argent/);
  assert.match(html, /<dialog class="pv-dialog" id="pvAssist"/);
  assert.match(html, /id="pvAssistBtn"[^>]*>Remplir avec mon assistant</);
  assert.match(html, /id="pvAjouter"[^>]*>Ajouter une ligne</);
  assert.match(html, /id="pvMsg"[^>]*role="status"/);
});

/* ------------------------------------------------------------------ fonctions pures ------------------------------------------------------------------ */
test("lignesProfil : salaires et loyers en revenus, prêts et crédits en dépenses, selon le périmètre", () => {
  const f = PV.lignesProfil(DEMO.profil, "foyer", PEOPLE, Calc);
  assert.deepEqual(f.rev.map(r => r[0]), ["Salaire net de Camille", "Salaire net de Sam"]);
  assert.deepEqual(f.rev.map(r => Math.round(r[1])), [2800, 2300]);
  assert.deepEqual(f.dep.map(r => [r[0], Math.round(r[1])]), [["Prêt · Appartement (résidence principale)", 820], ["Prêt auto", 210]]);
  const p1 = PV.lignesProfil(DEMO.profil, "p1", PEOPLE, Calc);
  assert.deepEqual(p1.rev.map(r => r[0]), ["Salaire net de Camille"]);
  assert.deepEqual(p1.dep.map(r => [r[0], Math.round(r[1])]), [["Prêt · Appartement (résidence principale)", 410], ["Prêt auto (moitié)", 105]]);
  assert.deepEqual(PV.lignesProfil(null, "foyer", [], Calc), { rev: [], dep: [] });
});

test("regrouper : une carte par catégorie, triées par montant ; crédits repris de Compte › Données ; parts du total", () => {
  const { groupes, totaux } = PV.regrouper(DEMO.budget.lignes, ctx());
  const dep = groupes.depense;
  assert.deepEqual(dep.map(g => g.titre).slice(0, 4), ["Crédits", "Alimentation", "Logement", "Enfants"]);
  for (let i = 1; i < dep.length; i++) assert.ok(dep[i - 1].mensuel >= dep[i].mensuel, "tri décroissant");
  const log = dep.find(g => g.titre === "Logement");
  proche(log.mensuel, 180 + 140 + 30 + 1100 / 12);
  assert.equal(log.lignes.length, 4);
  assert.equal(log.lignes[0].libelle, "Charges de copropriété", "lignes triées par montant");
  const tf = log.lignes.find(l => l.id === "bl-taxe-fonciere");
  proche(tf.mensuel, 1100 / 12); assert.equal(tf.ligne.frequence, "an");
  const cr = dep.find(g => g.titre === "Crédits");
  assert.equal(cr.lignes.length, 0);
  assert.deepEqual(cr.profil.map(r => r.libelle), ["Prêt · Appartement (résidence principale)", "Prêt auto"]);
  proche(cr.mensuel, totaux.mensualites);
  proche(dep.reduce((a, g) => a + g.mensuel, 0), totaux.depenses);
  proche(dep.reduce((a, g) => a + g.part, 0), 1);
  proche(log.part, log.mensuel / totaux.depenses);
  assert.deepEqual(groupes.revenu.map(g => g.titre), ["Revenus"]);
  assert.equal(groupes.revenu[0].profil.length, 2);
  proche(groupes.revenu[0].mensuel, totaux.revenus);
  assert.deepEqual(groupes.epargne.map(g => g.titre), ["Épargne"]);
  proche(groupes.epargne[0].mensuel, 650);
  assert.equal(groupes.epargne[0].cle, "epargne:Épargne");
});

test("regrouper : périmètre d'une personne — ligne commune pour moitié, ligne de l'autre hors de la vue ; catégorie vide → « Autres »", () => {
  const lignes = [
    { id: "a", type: "depense", categorie: "Loisirs", libelle: "Sport Sam", montant: 40, frequence: "mois", owner: "p2" },
    { id: "b", type: "depense", categorie: "Loisirs", libelle: "Cinéma", montant: 30, frequence: "mois", owner: "commun" },
    { id: "c", type: "depense", categorie: " ", libelle: "Divers", montant: 12, frequence: "mois" },
    { id: "d", type: "revenu", categorie: "", libelle: "Prime", montant: 1200, frequence: "an", owner: "p1" },
  ];
  const { groupes } = PV.regrouper(lignes, ctx({ profil: null, scope: "p1" }));
  const lo = groupes.depense.find(g => g.titre === "Loisirs");
  proche(lo.mensuel, 15);
  assert.equal(lo.lignes.find(l => l.id === "a").part, 0);
  assert.equal(lo.lignes.find(l => l.id === "b").part, 0.5);
  assert.ok(groupes.depense.find(g => g.titre === "Autres"), "catégorie vide d'une dépense → Autres");
  assert.equal(groupes.revenu[0].titre, "Revenus");
  proche(groupes.revenu[0].mensuel, 100);
  assert.deepEqual(PV.regrouper([], ctx({ profil: null })).groupes, { revenu: [], depense: [], epargne: [] });
});

test("resume : montants par mois ou par an (×12), taux d'épargne et son repère, reste inconnu sans ligne", () => {
  const t = Plan.budgetTotaux(DEMO.budget.lignes, DEMO.profil, "foyer");
  const m = PV.resume(t, "mois", true), a = PV.resume(t, "an", true);
  proche(m.revenus, 5100); proche(a.revenus, 5100 * 12);
  proche(a.depenses, m.depenses * 12); proche(a.epargne, 650 * 12); proche(a.reste, m.reste * 12);
  assert.equal(m.suffixe, "/mois"); assert.equal(a.suffixe, "/an");
  assert.equal(m.taux, a.taux, "le taux ne dépend pas du mode");
  assert.equal(m.ton, "bon"); assert.equal(m.repere, "au-dessus du repère");
  assert.equal(PV.resume(Object.assign({}, t, { tauxEpargne: 0.08 }), "mois", true).ton, "attention");
  assert.equal(PV.resume(Object.assign({}, t, { tauxEpargne: 0.02 }), "mois", true).repere, "très bas");
  const vide = PV.resume(Plan.budgetTotaux([], DEMO.profil, "foyer"), "mois", false);
  assert.equal(vide.reste, null);
  assert.equal(vide.negatif, false);
  assert.equal(PV.resume(Object.assign({}, t, { reste: -50 }), "mois", true).negatif, true);
});

test("barre : dépenses par catégorie (crédits compris), triées, parts qui somment à 1 ; vide → []", () => {
  const t = Plan.budgetTotaux(DEMO.budget.lignes, DEMO.profil, "foyer");
  const b = PV.barre(t);
  assert.equal(b[0].categorie, "Crédits");
  for (let i = 1; i < b.length; i++) assert.ok(b[i - 1].mensuel >= b[i].mensuel);
  proche(b.reduce((s, x) => s + x.part, 0), 1);
  assert.deepEqual(PV.barre(Plan.budgetTotaux([], null, "foyer")), []);
});

test("validerLigne : montant obligatoire et positif ; lignesAEnregistrer : libellé, catégorie, fréquence et titulaire normalisés", () => {
  assert.match(PV.validerLigne({ libelle: "Courses", montant: null }), /indiquez un montant/);
  assert.match(PV.validerLigne({ libelle: "Courses", montant: "" }), /indiquez un montant/);
  assert.match(PV.validerLigne({ libelle: "", montant: -3 }), /ne peut pas être négatif/);
  assert.equal(PV.validerLigne({ libelle: "Courses", montant: 0 }), null);
  const out = PV.lignesAEnregistrer([
    { id: "x", type: "depense", categorie: "  ", libelle: " ", montant: "12", frequence: "mois", owner: "p1" },
    { id: "y", type: "epargne", categorie: "", libelle: "PEA", montant: 100, frequence: "an" },
  ], false);
  assert.deepEqual(out[0], { id: "x", type: "depense", categorie: "Divers", libelle: "Divers", montant: 12, frequence: "mois" });
  assert.deepEqual(out[1], { id: "y", type: "epargne", categorie: "Épargne", libelle: "PEA", montant: 100, frequence: "an" });
  assert.equal(PV.lignesAEnregistrer([{ id: "z", type: "depense", categorie: "A", libelle: "B", montant: 1, owner: "p2" }], true)[0].owner, "p2");
  assert.equal(PV.lignesAEnregistrer([{ id: "z", type: "depense", categorie: "A", libelle: "B", montant: 1, frequence: "semaine" }], true)[0].frequence, "mois");
});

test("cartesHtml : quatre cartes (revenus, dépenses, épargne, reste), taux d'épargne en badge, reste négatif signalé", () => {
  const t = Plan.budgetTotaux(DEMO.budget.lignes, DEMO.profil, "foyer");
  const h = sp(PV.cartesHtml(PV.resume(t, "mois", true), UI, { duScope: "du foyer" }));
  assert.deepEqual([...h.matchAll(/data-ui-carte="([^"]+)"/g)].map(m => m[1]), ["revenu", "depense", "epargne", "reste"]);
  assert.match(h, /Revenus du foyer/);
  assert.match(h, /5 100 €/);
  assert.match(h, /dont 1 030 € de crédits/);
  assert.match(h, /Taux d'épargne 31 %/);
  assert.match(h, /au-dessus du repère/);
  const an = sp(PV.cartesHtml(PV.resume(t, "an", true), UI, { duScope: "du foyer" }));
  assert.match(an, /61 200 €/);
  assert.match(an, /par an/);
  const neg = sp(PV.cartesHtml(PV.resume(Object.assign({}, t, { reste: -80 }), "mois", true), UI, { duScope: "du foyer" }));
  assert.match(neg, /dépense plus qu'il ne reçoit/);
  assert.match(neg, /ui-badge critique/);
});

test("barreHtml : barre empilée lisible (role=img + légende), pas de couleur codée en dur ; vide → message", () => {
  const t = Plan.budgetTotaux(DEMO.budget.lignes, DEMO.profil, "foyer");
  const h = sp(PV.barreHtml(PV.barre(t), "mois"));
  assert.match(h, /role="img" aria-label="Crédits \d+ %/);
  assert.match(h, /var\(--s1\)/);
  assert.match(h, /<ul class="pv-leg">/);
  assert.match(PV.barreHtml([], "mois"), /Aucune dépense/);
});

test("groupesHtml : cartes dépliables (montant, part), lignes cliquables, catégories ouvertes conservées, 5 puis « Voir plus », tout échappé", () => {
  const lignes = J(DEMO.budget.lignes).concat([{ id: "evil", type: "depense", categorie: "<b>X</b>", libelle: "<img src=x onerror=alert(1)>", montant: 5, frequence: "mois" }]);
  const { groupes } = PV.regrouper(lignes, ctx());
  const h = sp(PV.groupesHtml(groupes, { mode: "mois", ouverts: new Set(["depense:Logement"]), two: true, U: UI }));
  assert.doesNotMatch(h, /<img src=x|<b>X<\/b>/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h, /<details class="ui-acc pv-cat" data-pv-cat="depense:Logement" open>/);
  assert.match(h, /<details class="ui-acc pv-cat" data-pv-cat="depense:Alimentation">/);
  assert.match(h, /data-pv-ligne="bl-copro"/);
  assert.match(h, /Taxe foncière[\s\S]*?1 100 €\/an/);
  assert.match(h, /data-ui-voirplus/, "plus de 5 catégories de dépenses : « Voir plus »");
  assert.match(h, /Repris de Compte › Données/);
  assert.match(h, /href="#compte\/donnees"/);
  assert.match(h, /data-pv-ajout="depense" data-pv-ajout-cat="Logement"/);
  assert.match(h, /<h3[^>]*>Revenus<\/h3>/);
  assert.match(h, /<h3[^>]*>Dépenses<\/h3>/);
  assert.match(h, /<h3[^>]*>Épargne<\/h3>/);
  const an = sp(PV.groupesHtml(groupes, { mode: "an", ouverts: new Set(), two: true, U: UI }));
  assert.match(an, /data-pv-cat="depense:Logement">/);
  assert.match(an, /9 000 €\/an/, "Alimentation 750 €/mois → 9 000 €/an");
});

test("ligneDetailHtml et ligneFormHtml : détail (montant, équivalent, part), actions, formulaire échappé avec ses bascules", () => {
  const l = { id: "t", type: "depense", categorie: "Logement", libelle: "Taxe <foncière>", montant: 1200, frequence: "an", owner: "commun" };
  const d = sp(PV.ligneDetailHtml(l, { scope: "p1", people: PEOPLE, Calc, Plan, dbOk: true }));
  assert.match(d, /1 200 €\/an/);
  assert.match(d, /100 €\/mois/);
  assert.match(d, /Commun/);
  assert.match(d, /50 %/);
  assert.match(d, /data-pv-act="modifier"[^>]*>Modifier à la main</);
  assert.match(d, /data-pv-act="supprimer"/);
  const conf = sp(PV.ligneDetailHtml(l, { scope: "foyer", people: PEOPLE, Calc, Plan, dbOk: true, confirmer: true }));
  assert.match(conf, /Supprimer « Taxe &lt;foncière&gt; » du budget/);
  assert.match(conf, /data-pv-act="supprimer-oui"/);
  assert.match(conf, /data-pv-act="supprimer-non"/);
  const ro = sp(PV.ligneDetailHtml(l, { scope: "foyer", people: PEOPLE, Calc, Plan, dbOk: false }));
  assert.match(ro, /data-pv-act="modifier" disabled/);
  const f = sp(PV.ligneFormHtml({ type: "depense", categorie: "Lo\"gement", libelle: "<x>", montant: 12, frequence: "mois", owner: "commun" }, { two: true, nouvelle: false, erreur: "Oups <b>" }));
  assert.match(f, /value="Lo&quot;gement"/);
  assert.match(f, /value="&lt;x&gt;"/);
  assert.match(f, /role="alert"[^>]*>Oups &lt;b&gt;</);
  assert.match(f, /data-pv-bascule="type"/);
  assert.match(f, /data-pv-bascule="frequence"/);
  assert.match(f, /data-pv-bascule="owner"/);
  assert.match(f, /<datalist id="pvf-cats">/);
  assert.match(f, /data-pv-act="enregistrer"/);
  assert.doesNotMatch(sp(PV.ligneFormHtml({ type: "revenu", montant: null, frequence: "mois" }, { two: false, nouvelle: true })), /data-pv-bascule="owner"/);
  assert.match(sp(PV.ligneFormHtml({ type: "revenu", montant: null, frequence: "mois" }, { two: false, nouvelle: true, enAttente: true })), /changements en attente/);
});

test("resumeDetailHtml : détail d'une carte de l'en-tête (catégories du type, taux d'épargne expliqué)", () => {
  const { groupes, totaux } = PV.regrouper(DEMO.budget.lignes, ctx());
  const r = PV.resume(totaux, "mois", true);
  const ep = sp(PV.resumeDetailHtml("epargne", groupes, r));
  assert.match(ep, /Épargne/); assert.match(ep, /650 €\/mois/); assert.match(ep, /repère 15 %/);
  const dep = sp(PV.resumeDetailHtml("depense", groupes, r));
  assert.match(dep, /Crédits/); assert.match(dep, /Alimentation/);
  const re = sp(PV.resumeDetailHtml("reste", groupes, r));
  assert.match(re, /revenus − dépenses − épargne/);
});

/* ------------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------------ */
const uiJs = readFileSync("web/src/ui.js", "utf8");
const planJs = readFileSync("web/src/plan.js", "utf8");
const calcJs = readFileSync("web/src/calc.js", "utf8");
const attendre = () => new Promise(r => setTimeout(r, 0));
function vueDom(S0, o = {}) {
  const dom = miniDom(), { doc } = dom;
  let S = J(S0);
  const ecrits = [];
  const modules = {};
  const c = { document: doc, console, setTimeout, clearTimeout, CSS: { escape: s => String(s).replace(/["\\]/g, "\\$&") } };
  c.window = c; c.self = c;
  c.App = { register: (n, api) => { modules[n] = api; }, refreshHeadlines() {}, parametres: () => ({}) };
  c.Store = { get: () => S, db: { doc: path => ({ set: async v => {
    if (o.echec) throw Object.assign(new Error("panne"), { code: "unavailable" });
    ecrits.push({ path, v: J(v) }); S = Object.assign(J(S), { budget: J(v) }); modules.plan.update(S, true); return {};
  } }) } };
  vm.createContext(c);
  vm.runInContext(calcJs, c, { filename: "calc.js" });
  vm.runInContext(planJs, c, { filename: "plan.js" });
  vm.runInContext(uiJs, c, { filename: "ui.js" });
  vm.runInContext(js, c, { filename: "plan-view.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.setAttribute("id", "view-plan");
  root.innerHTML = html;
  const api = modules.plan;
  api.mount(root);
  api.update(S, true);
  return { c, dom, doc, root, api, S: () => S, ecrits };
}
const dlgDe = doc => doc.body.querySelector('[role="dialog"]');
const saisir = (dom, el, v) => { el.value = v; el.dispatchEvent(new dom.Ev("input")); };

test("vue (DOM) : en-tête, bascule Par mois · Par an, catégories dépliées conservées au redessin", () => {
  const v = vueDom(demoS());
  const cartes = v.root.querySelector("#pvCartes").querySelectorAll("[data-ui-carte]");
  assert.equal(cartes.length, 4);
  assert.match(sp(cartes[0].textContent), /5 100 €/);
  const radios = v.root.querySelector("#pvMode").querySelectorAll('[role="radio"]');
  assert.deepEqual(radios.map(r => r.textContent), ["Par mois", "Par an"]);
  radios[1].click();
  assert.match(sp(v.root.querySelector("#pvCartes").querySelectorAll("[data-ui-carte]")[0].textContent), /61 200 €/);
  assert.match(sp(v.root.querySelector("#pvBudget").textContent), /9 000 €\/an/);
  // une catégorie ouverte reste ouverte quand le store émet
  const det = v.root.querySelector('[data-pv-cat="depense:Logement"]');
  det.setAttribute("open", "");
  det.dispatchEvent(new v.dom.Ev("toggle"));
  v.api.update(Object.assign(J(v.S()), { budget: { lignes: J(v.S().budget.lignes).concat([{ id: "n1", type: "depense", categorie: "Loisirs", libelle: "Piscine", montant: 20, frequence: "mois" }]) } }), true);
  assert.ok(v.root.querySelector('[data-pv-cat="depense:Logement"]').hasAttribute("open"));
  assert.ok(v.root.querySelector('[data-pv-ligne="n1"]'));
});

test("vue (DOM) : une ligne ouvre son panneau ; « Modifier à la main » → enregistrée dans budget/main ; Échap rend le focus à la ligne", async () => {
  const v = vueDom(demoS());
  const b = v.root.querySelector('[data-pv-ligne="bl-courses"]');
  b.focus(); b.click();
  const dlg = dlgDe(v.doc);
  assert.equal(dlg.hidden, false);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Courses et marché");
  dlg.querySelector('[data-pv-act="modifier"]').click();
  const mt = dlg.querySelector("#pvf-montant");
  assert.ok(mt, "formulaire affiché dans le panneau");
  saisir(v.dom, mt, "800");
  const freq = dlg.querySelector('[data-pv-bascule="frequence"]').querySelectorAll('[role="radio"]');
  freq[1].click(); // par an
  dlg.querySelector('[data-pv-act="enregistrer"]').click();
  await attendre(); await attendre();
  assert.equal(v.ecrits.length, 1);
  assert.equal(v.ecrits[0].path, "budget/main");
  const l = v.ecrits[0].v.lignes.find(x => x.id === "bl-courses");
  assert.equal(l.montant, 800); assert.equal(l.frequence, "an");
  assert.equal(v.ecrits[0].v.lignes.length, DEMO.budget.lignes.length);
  assert.match(dlg.querySelector("[data-pv-msg]").textContent, /enregistrée/);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true);
  assert.equal(v.doc.activeElement, v.root.querySelector('[data-pv-ligne="bl-courses"]'));
});

test("vue (DOM) : montant invalide refusé dans le panneau ; suppression confirmée ; ajout d'une ligne", async () => {
  const v = vueDom(demoS());
  v.root.querySelector('[data-pv-ligne="bl-abos"]').click();
  const dlg = dlgDe(v.doc);
  dlg.querySelector('[data-pv-act="modifier"]').click();
  saisir(v.dom, dlg.querySelector("#pvf-montant"), "");
  dlg.querySelector('[data-pv-act="enregistrer"]').click();
  await attendre();
  assert.equal(v.ecrits.length, 0);
  assert.match(dlg.querySelector('[role="alert"]').textContent, /indiquez un montant/);
  dlg.querySelector('[data-pv-act="annuler"]').click();
  dlg.querySelector('[data-pv-act="supprimer"]').click();
  assert.equal(v.ecrits.length, 0, "la suppression demande une confirmation");
  dlg.querySelector('[data-pv-act="supprimer-oui"]').click();
  await attendre(); await attendre();
  assert.equal(v.ecrits.length, 1);
  assert.equal(v.ecrits[0].v.lignes.some(x => x.id === "bl-abos"), false);
  assert.equal(dlg.hidden, true);
  assert.match(v.root.querySelector("#pvMsg").textContent, /supprimée/);
  // ajout
  v.root.querySelector("#pvAjouter").click();
  assert.equal(dlg.hidden, false);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Nouvelle ligne");
  const type = dlg.querySelector('[data-pv-bascule="type"]').querySelectorAll('[role="radio"]');
  assert.deepEqual(type.map(r => r.textContent), ["Dépense", "Revenu", "Épargne"]);
  type[2].click();
  saisir(v.dom, dlg.querySelector("#pvf-libelle"), "Livret jeune");
  saisir(v.dom, dlg.querySelector("#pvf-montant"), "50");
  dlg.querySelector('[data-pv-act="enregistrer"]').click();
  await attendre(); await attendre();
  assert.equal(v.ecrits.length, 2);
  const n = v.ecrits[1].v.lignes.find(x => x.libelle === "Livret jeune");
  assert.ok(n && n.id, "nouvelle ligne avec un identifiant");
  assert.equal(n.type, "epargne"); assert.equal(n.categorie, "Épargne"); assert.equal(n.montant, 50);
  assert.equal(n.owner, "commun", "deux personnes : titulaire commun par défaut");
});

test("vue (DOM) : « Ajouter une ligne ici » préremplit la catégorie ; écriture refusée → message dans le panneau, saisie conservée", async () => {
  const v = vueDom(demoS(), { echec: true });
  v.root.querySelector('[data-pv-ajout-cat="Logement"]').click();
  const dlg = dlgDe(v.doc);
  assert.equal(dlg.querySelector("#pvf-categorie").value, "Logement");
  saisir(v.dom, dlg.querySelector("#pvf-montant"), "25");
  dlg.querySelector('[data-pv-act="enregistrer"]').click();
  await attendre(); await attendre();
  assert.match(dlg.querySelector('[role="alert"]').textContent, /Enregistrement impossible/);
  assert.equal(dlg.querySelector("#pvf-montant").value, "25");
});

test("vue (DOM) : budget vide → état qui oriente (assistant, ajout à la main, déjà connu) ; carte de l'en-tête → panneau", () => {
  const v = vueDom(Object.assign(demoS(), { budget: { lignes: [] } }));
  const t = sp(v.root.querySelector("#pvBudget").textContent);
  assert.match(t, /Votre budget est vide/);
  assert.match(t, /Déjà connu grâce à Compte › Données/);
  assert.ok(v.root.querySelector("#pvBudget").querySelector("[data-pv-assist]"));
  v.root.querySelector('[data-ui-carte="revenu"]').click();
  const dlg = dlgDe(v.doc);
  assert.equal(dlg.hidden, false);
  assert.match(sp(dlg.textContent), /Salaire net de Camille/);
  assert.equal(v.api.headline(), "Budget à remplir");
});

test("coque : Patrimoine › Budget (#view-plan) et Patrimoine › Objectifs (#view-objectifs-view), avec leurs fragments", () => {
  assert.match(shell, /<section class="view" id="view-plan" data-space="patrimoine" data-sub="budget"[^>]*hidden>\s*<!--@plan-view-->/);
  assert.match(shell, /<section class="view" id="view-objectifs-view" data-space="patrimoine" data-sub="objectifs" role="tabpanel" aria-labelledby="subtab-patrimoine-objectifs" hidden>\s*<!--@objectifs-view-->/);
});

test("app.js : « plan » sur patrimoine/budget, « objectifs-view » sur patrimoine/objectifs ; anciennes routes et ancres", () => {
  const { SPACES, LEGACY, resolve, resolveHash } = require("../web/src/app.js");
  const patrimoine = SPACES.find(s => s.space === "patrimoine");
  assert.deepEqual(patrimoine.subs.map(s => [s.id, s.label, s.module]), [
    ["placements", "Placements", "pilotage"], ["immobilier", "Immobilier et crédits", "bilan"],
    ["budget", "Budget", "plan"], ["objectifs", "Objectifs", "objectifs-view"]]);
  assert.equal(LEGACY.plan, "patrimoine/budget");
  assert.equal(LEGACY["avenir/plan"], "patrimoine/budget");
  assert.deepEqual(resolve("plan"), { space: "patrimoine", sub: "budget" });
  for (const h of ["#plan", "#budget", "#avenir/plan"]) assert.deepEqual(resolveHash(h), { space: "patrimoine", sub: "budget", legacy: true }, h);
  assert.deepEqual(resolveHash("#objectifs"), { space: "patrimoine", sub: "objectifs", legacy: true });
  assert.deepEqual(resolveHash("#patrimoine/objectifs"), { space: "patrimoine", sub: "objectifs", legacy: false });
  assert.deepEqual(resolveHash("#patrimoine/budget"), { space: "patrimoine", sub: "budget", legacy: false });
});

test("build.mjs : modules plan-view et objectifs-view assemblés, moteur plan et repères chargés avant", () => {
  const mods = JSON.parse(build.match(/const MODULES = (\[[^\]]*\])/)[1]);
  assert.ok(mods.includes("plan-view"));
  assert.ok(mods.includes("objectifs-view"));
  assert.match(build, /const SCRIPTS = \[[^\]]*"reperes"[^\]]*"plan"[^\]]*\.\.\.MODULES/);
});
