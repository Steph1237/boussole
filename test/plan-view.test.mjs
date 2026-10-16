// Patrimoine › Budget (module plan, web/src/plan-view.*) : « Où va mon argent chaque mois ? », en lecture seule.
// En-tête (revenus, dépenses, épargne, reste ; bascule Par mois · Par an), barre des catégories et sa légende, une carte par
// catégorie qui se déplie en lignes, panneau d'une ligne (lecture) ; toute la saisie passe par « Compléter avec Claude » /
// « Corriger avec Claude » (spec 2026-10-11-saisie-par-agent). Aucun formulaire, aucune écriture, tutoiement.
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
const ClaudePrompts = require("../web/src/claude-prompts.js");
const DEMO = require("../web/src/demo-data.js");

const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ").replace(/&#39;/g, "'");
const DEPS = { Plan, Calc };
const PEOPLE = [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }];
const demoS = () => Object.assign(J(DEMO), { ready: true, dbOk: true, scope: "foyer", people: PEOPLE, error: null });
const ctx = (o = {}) => Object.assign({ profil: DEMO.profil, scope: "foyer", people: PEOPLE }, DEPS, o);
const P = (s, c) => sp(ClaudePrompts.phrase(s, c));
const proche = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, a + " ≈ " + b);
/* Questions des liens « … avec Claude » (href décodé). */
const questions = h => [...String(h).matchAll(/href="https:\/\/claude\.ai\/new\?q=([^"]*)"/g)].map(m => sp(decodeURIComponent(m[1].replace(/&amp;/g, "&"))));
/* Tutoiement : aucun « vous / votre / vos » ; les textes venant du moteur (plan.js) sont listés en exception (aucun affiché ici). */
const EXCEPTIONS_MOTEUR = [];
const VOUVOIEMENT = /\b(vous|votre|vos)\b/i;
const sansExceptions = t => EXCEPTIONS_MOTEUR.reduce((a, e) => a.split(e).join(""), String(t));

/* ------------------------------------------------------------------ structure ------------------------------------------------------------------ */
test("plan-view.js : se compile, s'enregistre sous « plan », exporte ses fonctions pures", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "plan-view.js" }));
  assert.match(js, /App\.register\("plan", api\)/);
  assert.match(js, /__pending/);
  for (const f of ["lignesProfil", "regrouper", "resume", "barre", "segments", "cartesHtml", "barreHtml", "groupesHtml", "ligneDetailHtml", "resumeDetailHtml", "boutonClaude"])
    assert.equal(typeof PV[f], "function", f);
  for (const f of ["validerLigne", "lignesAEnregistrer", "ligneFormHtml"]) assert.equal(PV[f], undefined, f + " : plus de saisie dans l'app");
});

test("plan-view : lecture seule — aucun appel d'écriture au store, aucun formulaire, plus d'assistant copier-coller ni de brouillon", () => {
  assert.doesNotMatch(js, /Store\s*&&\s*window\.Store\.db|Store\.db|\.db\b/, "aucun accès à Store.db");
  assert.doesNotMatch(js, /\.(set|upsert|delete|update)\(\s*\{|\.delete\(\)/, "aucune écriture");
  assert.doesNotMatch(js, /Assistant|\.prompt\("budget"\)|\.parse\(/, "plus de dialogue « Remplir avec mon assistant »");
  assert.doesNotMatch(js, /collection\("objectifs"\)|\.projection\(|affecterDeja|statutObjectif/, "objectifs et projection restent dans objectifs-view");
  for (const src of [js, html]) {
    assert.doesNotMatch(src, /<form|<input|<textarea|<select|<dialog|datalist/);
    assert.doesNotMatch(src, /Ajouter une ligne|Ajouter à la main|Remplir avec mon assistant|Enregistrer le budget|Modifier à la main|data-pv-ajout|data-pv-act|pv-bascule/);
  }
  assert.match(js, /ClaudePrompts/);
  assert.match(js, /"Compléter avec Claude"/);
  assert.match(js, /"Corriger avec Claude"/);
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
  assert.doesNotMatch(css, /pv-bascule|pv-form|pv-dialog|pv-save/, "styles de saisie retirés");
});

test("plan-view.html : identifiants utilisés par le script, question de la page, emplacements « … avec Claude »", () => {
  const ids = [...js.matchAll(/\$\("(pv[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 8);
  const missing = [...new Set(ids)].filter(id => !html.includes('id="' + id + '"'));
  assert.deepEqual(missing, []);
  assert.match(html, /id="pvTitre"/);
  assert.doesNotMatch(html, /id="pvCompleter"|id="pvClaude"/, "plus de boutons Claude empilés : celui de l'en-tête couvre la page");
});

test("plan-view : tutoiement — aucun « vous / votre / vos » dans les textes du module (hors textes du moteur listés)", () => {
  assert.doesNotMatch(sansExceptions(js), VOUVOIEMENT);
  assert.doesNotMatch(sansExceptions(html), VOUVOIEMENT);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), VOUVOIEMENT);
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

test("resume : montants par mois ou par an (×12), capacité d'épargne et son repère ; sans ligne : reste et taux inconnus", () => {
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
  // correctif : sans ligne de budget, les seuls revenus de Compte › Données donneraient un taux trompeur
  assert.equal(PV.resume(t, "mois", false).taux, null);
  assert.equal(PV.resume(t, "mois", false).ton, null);
  assert.ok(Plan.budgetTotaux([], DEMO.profil, "foyer").tauxEpargne > 0.5, "le moteur, lui, compte tout le reste comme épargne : la vue doit filtrer");
  assert.equal(vide.taux, null);
});

test("barre et segments : dépenses par catégorie triées ; 8 couleurs distinctes au plus, le reste regroupé à motif", () => {
  const t = Plan.budgetTotaux(DEMO.budget.lignes, DEMO.profil, "foyer");
  const b = PV.barre(t);
  assert.equal(b[0].categorie, "Crédits");
  for (let i = 1; i < b.length; i++) assert.ok(b[i - 1].mensuel >= b[i].mensuel);
  proche(b.reduce((s, x) => s + x.part, 0), 1);
  assert.deepEqual(PV.barre(Plan.budgetTotaux([], null, "foyer")), []);
  assert.equal(b.length, 10, "la démo a 10 catégories de dépenses");
  const segs = PV.segments(b);
  assert.equal(segs.length, 8);
  const couleurs = segs.map(s => s.couleur);
  assert.equal(new Set(couleurs).size, couleurs.length, "aucune couleur répétée");
  for (let i = 1; i < segs.length; i++) assert.notEqual(segs[i].couleur, segs[i - 1].couleur, "voisines distinctes");
  const autres = segs[segs.length - 1];
  assert.equal(autres.categorie, "Autres catégories"); assert.equal(autres.motif, true);
  assert.deepEqual(autres.detail, b.slice(7).map(c => c.categorie));
  proche(segs.reduce((s, x) => s + x.mensuel, 0), b.reduce((s, x) => s + x.mensuel, 0));
  const peu = PV.segments(b.slice(0, 4));
  assert.equal(peu.length, 4); assert.ok(peu.every(s => !s.motif));
  // nombreuses catégories : toujours aucune couleur répétée
  const beaucoup = PV.segments(Array.from({ length: 20 }, (_, i) => ({ categorie: "C" + i, mensuel: 20 - i, part: 0.05 })));
  assert.equal(new Set(beaucoup.map(s => s.couleur)).size, beaucoup.length);
});

test("cartesHtml : quatre cartes, capacité d'épargne en badge, reste négatif signalé ; sans ligne : « remplis ton budget avec Claude »", () => {
  const t = Plan.budgetTotaux(DEMO.budget.lignes, DEMO.profil, "foyer");
  const h = sp(PV.cartesHtml(PV.resume(t, "mois", true), UI, { duScope: "du foyer" }));
  assert.deepEqual([...h.matchAll(/data-ui-carte="([^"]+)"/g)].map(m => m[1]), ["revenu", "depense", "epargne", "reste"]);
  assert.match(h, /Revenus du foyer/);
  assert.match(h, /5 100 €/);
  assert.match(h, /dont 1 030 € de crédits/);
  assert.match(h, /Capacité d'épargne prévue au budget 31 %/, "la mesure du budget est dite « prévue »");
  assert.doesNotMatch(h, /Capacité d'épargne 31 %/, "jamais le nom nu : la capacité réelle (comptes) est un autre nombre");
  assert.match(h, /au-dessus du repère/);
  const an = sp(PV.cartesHtml(PV.resume(t, "an", true), UI, { duScope: "du foyer" }));
  assert.match(an, /61 200 €/);
  assert.match(an, /par an/);
  const neg = sp(PV.cartesHtml(PV.resume(Object.assign({}, t, { reste: -80 }), "mois", true), UI, { duScope: "du foyer" }));
  assert.match(neg, /dépense plus qu'il ne reçoit/);
  assert.match(neg, /ui-badge critique/);
  const vide = sp(PV.cartesHtml(PV.resume(t, "mois", false), UI, { duScope: "du foyer" }));
  assert.match(vide, /remplis ton budget avec Claude pour le calculer/);
  assert.doesNotMatch(vide, /Capacité d'épargne \d|au-dessus du repère/);
});

test("barreHtml : barre lisible (role=img avec toutes les catégories), légende en 5 puis « Voir plus », pas de couleur codée en dur", () => {
  const t = Plan.budgetTotaux(DEMO.budget.lignes, DEMO.profil, "foyer");
  const b = PV.barre(t);
  const h = sp(PV.barreHtml(b, "mois", UI));
  assert.match(h, /role="img" aria-label="Crédits \d+ %/);
  for (const c of b) assert.ok(h.includes(c.categorie + " "), c.categorie + " dans le libellé lu");
  assert.match(h, /var\(--s1\)/);
  assert.match(h, /class="pv-motif"/);
  assert.match(h, /<div class="pv-leg">/);
  const leg = h.slice(h.indexOf('<div class="pv-leg">'));
  assert.equal((leg.match(/<li>/g) || []).length, 8);
  assert.match(leg, /data-ui-voirplus[^>]*>Voir plus de catégories \(3\)</);
  assert.match(leg, /Autres catégories/);
  assert.equal(PV.barreHtml(b, "mois", UI), PV.barreHtml(b, "mois", UI), "rendu stable (id du « Voir plus » stable)");
  assert.match(PV.barreHtml([], "mois", UI), /Aucune dépense dans ton budget/);
});

test("groupesHtml : cartes dépliables (montant, part lue aussi sur mobile), lignes cliquables, 5 puis « Voir plus », « Compléter avec Claude », tout échappé", () => {
  const lignes = J(DEMO.budget.lignes).concat([{ id: "evil", type: "depense", categorie: "<b>X</b>", libelle: "<img src=x onerror=alert(1)>", montant: 5, frequence: "mois" }]);
  const { groupes, totaux } = PV.regrouper(lignes, ctx());
  const h = sp(PV.groupesHtml(groupes, { mode: "mois", ouverts: new Set(["depense:Logement"]), totaux, U: UI }));
  assert.doesNotMatch(h, /<img src=x|<b>X<\/b>/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h, /<details class="ui-acc pv-cat" data-pv-cat="depense:Logement" open>/);
  assert.match(h, /<details class="ui-acc pv-cat" data-pv-cat="depense:Alimentation">/);
  assert.match(h, /data-pv-ligne="bl-copro"/);
  assert.match(h, /Taxe foncière[\s\S]*?1 100 €\/an/);
  assert.match(h, /data-ui-voirplus/, "plus de 5 catégories de dépenses : « Voir plus »");
  assert.match(h, /Repris de Compte › Données/);
  assert.match(h, /href="#compte\/donnees"/);
  assert.match(h, /<span class="pv-cat-part" aria-hidden="true">\d+ %<\/span><span class="ui-sr">, soit \d+ % des dépenses<\/span>/);
  assert.match(h, /<h3[^>]*>Revenus<\/h3>/);
  assert.match(h, /<h3[^>]*>Dépenses<\/h3>/);
  assert.match(h, /<h3[^>]*>Épargne<\/h3>/);
  const qs = questions(h);
  assert.ok(qs.includes(P("budget", "la catégorie « Logement » (dépenses)")), "« Compléter avec Claude » de la catégorie Logement");
  assert.ok(qs.includes(P("revenus", "mes salaires et loyers")), "« Corriger avec Claude » des revenus repris");
  assert.ok(qs.includes(P("immobilier", "mes prêts et crédits")), "« Corriger avec Claude » des crédits repris");
  assert.match(h, />Compléter avec Claude</);
  assert.match(h, />Corriger avec Claude</);
  const an = sp(PV.groupesHtml(groupes, { mode: "an", ouverts: new Set(), totaux, U: UI }));
  assert.match(an, /data-pv-cat="depense:Logement">/);
  assert.match(an, /9 000 €\/an/, "Alimentation 750 €/mois → 9 000 €/an");
  assert.equal(PV.groupesHtml(groupes, { mode: "mois", ouverts: new Set(), totaux, U: UI }), PV.groupesHtml(groupes, { mode: "mois", ouverts: new Set(), totaux, U: UI }), "rendu stable");
  const vide = sp(PV.groupesHtml({ revenu: [], depense: [], epargne: [] }, { mode: "mois", U: UI }));
  assert.match(vide, /Aucune dépense dans ton budget/);
  assert.ok(questions(vide).includes(P("budget", "les dépenses du budget")));
});

test("groupesHtml : totaux de section = Plan.budgetTotaux (comme les cartes), même avec un seul adulte et des données p2 restantes", () => {
  const seul = [{ id: "p1", nom: "Camille" }];
  assert.ok(Calc.salaireNetMensuel(DEMO.profil.personnes.p2) > 0, "la démo garde un salaire pour p2");
  const { groupes, totaux } = PV.regrouper(DEMO.budget.lignes, ctx({ people: seul }));
  const h = sp(PV.groupesHtml(groupes, { mode: "mois", ouverts: new Set(), totaux, U: UI }));
  const totalSection = type => sp(h.match(new RegExp('id="pv-sec-' + type + '">[^<]*</h3><span class="pv-num pv-sec-t">([^<]*)<'))[1]);
  const eur = v => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v)).replace(/[\u00a0\u202f]/g, " ") + " €/mois";
  assert.equal(totalSection("revenu"), eur(totaux.revenus));
  assert.equal(totalSection("depense"), eur(totaux.depenses));
  assert.equal(totalSection("epargne"), eur(totaux.epargne));
  const cartes = sp(PV.cartesHtml(PV.resume(totaux, "mois", true), UI, { duScope: "du foyer" }));
  assert.ok(cartes.includes(eur(totaux.revenus).replace("/mois", "")), "même montant que la carte Revenus");
  proche(groupes.revenu.reduce((a, g) => a + g.mensuel, 0), totaux.revenus, 0.5);
  // même avec un total fourni absent : repli sur la somme des groupes
  assert.match(sp(PV.groupesHtml(groupes, { mode: "mois", U: UI })), /pv-sec-t/);
});

test("ligneDetailHtml : détail (montant, équivalent, part), « Corriger avec Claude » sur la ligne, aucune action d'écriture, échappé", () => {
  const l = { id: "t", type: "depense", categorie: "Logement", libelle: "Taxe <foncière>", montant: 1200, frequence: "an", owner: "commun" };
  const d = sp(PV.ligneDetailHtml(l, { scope: "p1", people: PEOPLE, Calc, Plan, U: UI }));
  assert.match(d, /1 200 €\/an/);
  assert.match(d, /100 €\/mois/);
  assert.match(d, /Commun/);
  assert.match(d, /50 %/);
  assert.match(d, /Taxe &lt;foncière&gt;|Taxe%20%3Cfonci/);
  assert.doesNotMatch(d, /<foncière>/);
  assert.doesNotMatch(d, /data-pv-act|<form|<input|Supprimer|Modifier à la main/);
  assert.match(d, />Corriger avec Claude</);
  assert.deepEqual(questions(d), [P("budget", "la ligne « Taxe <foncière> » (Logement, 1 200 €/an)")], "phrase contextualisée par la ligne");
  assert.match(d, /passe par Claude/);
});

test("resumeDetailHtml : détail d'une carte (dépenses en 5 puis « Voir plus », taux expliqué, « Compléter avec Claude »)", () => {
  const { groupes, totaux } = PV.regrouper(DEMO.budget.lignes, ctx());
  const r = PV.resume(totaux, "mois", true);
  const ep = sp(PV.resumeDetailHtml("epargne", groupes, r, UI));
  assert.match(ep, /Épargne/); assert.match(ep, /650 €\/mois/); assert.match(ep, /repère 15 %/);
  assert.match(ep, />Compléter avec Claude</);
  const dep = sp(PV.resumeDetailHtml("depense", groupes, r, UI));
  assert.match(dep, /Crédits/); assert.match(dep, /Alimentation/);
  assert.equal((dep.match(/class="pv-det-i"/g) || []).length, groupes.depense.length);
  assert.match(dep, /data-ui-voirplus[^>]*>Voir plus de catégories \(\d+\)</);
  assert.match(dep, /tes prêts et crédits/);
  const re = sp(PV.resumeDetailHtml("reste", groupes, r, UI));
  assert.match(re, /revenus − dépenses − épargne/);
  const rev = sp(PV.resumeDetailHtml("revenu", groupes, r, UI));
  assert.ok(questions(rev).includes(P("revenus", "")));
  const sansLigne = sp(PV.resumeDetailHtml("epargne", groupes, PV.resume(totaux, "mois", false), UI));
  assert.match(sansLigne, /remplis ton budget avec Claude pour le calculer/);
});

test("tutoiement des rendus : cartes, barre, sections, panneaux, dans tous les états", () => {
  const { groupes, totaux } = PV.regrouper(DEMO.budget.lignes, ctx({ scope: "p1" }));
  const rendus = [
    PV.cartesHtml(PV.resume(totaux, "mois", true), UI, {}), PV.cartesHtml(PV.resume(Object.assign({}, totaux, { reste: -1, revenusProfil: 0 }), "an", false), UI, {}),
    PV.barreHtml(PV.barre(totaux), "an", UI), PV.barreHtml([], "mois", UI),
    PV.groupesHtml(groupes, { mode: "mois", totaux, U: UI }), PV.groupesHtml({ revenu: [], depense: [], epargne: [] }, { U: UI }),
    ...["revenu", "depense", "epargne", "reste"].map(k => PV.resumeDetailHtml(k, groupes, PV.resume(totaux, "mois", true), UI)),
    ...["revenu", "depense", "epargne", "reste"].map(k => PV.resumeDetailHtml(k, {}, PV.resume(totaux, "mois", false), UI)),
    PV.ligneDetailHtml(DEMO.budget.lignes[0], { scope: "p1", people: PEOPLE, Calc, Plan, U: UI }),
  ];
  for (const h of rendus) assert.doesNotMatch(sansExceptions(decodeURIComponent(sp(h).replace(/%(?![0-9A-F]{2})/g, "%25"))), VOUVOIEMENT);
});

/* ------------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------------ */
const uiJs = readFileSync("web/src/ui.js", "utf8");
const planJs = readFileSync("web/src/plan.js", "utf8");
const calcJs = readFileSync("web/src/calc.js", "utf8");
const banqueJs = readFileSync("web/src/banque-etat.js", "utf8");
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
  vm.runInContext(banqueJs, c, { filename: "banque-etat.js" });
  vm.runInContext(planJs, c, { filename: "plan.js" });
  vm.runInContext(uiJs, c, { filename: "ui.js" });
  vm.runInContext(promptsJs, c, { filename: "claude-prompts.js" });
  vm.runInContext(js, c, { filename: "plan-view.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.setAttribute("id", "view-plan");
  root.innerHTML = html;
  const api = modules.plan;
  api.mount(root);
  api.update(S, true);
  return { c, dom, doc, root, api, S: () => S, setS: v => { S = v; }, acces };
}
const dlgDe = doc => doc.body.querySelector('[role="dialog"]');
const sansSaisie = el => el.querySelectorAll("form, input, textarea, select, dialog").length === 0;

test("vue (DOM) : en-tête, bascule Par mois · Par an, « Compléter avec Claude » en tête, catégories dépliées conservées au redessin", () => {
  const v = vueDom(demoS());
  const cartes = v.root.querySelector("#pvCartes").querySelectorAll("[data-ui-carte]");
  assert.equal(cartes.length, 4);
  assert.match(sp(cartes[0].textContent), /5 100 €/);
  const radios = v.root.querySelector("#pvMode").querySelectorAll('[role="radio"]');
  assert.deepEqual(radios.map(r => r.textContent), ["Par mois", "Par an"]);
  assert.match(v.root.querySelector("#pvTitre").textContent, /^Budget du foyer$/);
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
  assert.ok(sansSaisie(v.root), "aucun formulaire dans la page");
  assert.deepEqual(v.acces, [], "aucun accès au store");
});

test("vue (DOM) : une ligne ouvre son panneau en lecture (« Corriger avec Claude ») ; Échap rend le focus à la ligne ; aucune écriture", () => {
  const v = vueDom(demoS());
  const b = v.root.querySelector('[data-pv-ligne="bl-courses"]');
  b.focus(); b.click();
  const dlg = dlgDe(v.doc);
  assert.equal(dlg.hidden, false);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Courses et marché");
  assert.ok(sansSaisie(dlg), "panneau sans formulaire");
  assert.equal(dlg.querySelector("[data-pv-act]"), null);
  const corriger = dlg.querySelectorAll("a.ui-claude").find(a => /Corriger avec Claude/.test(a.textContent));
  assert.ok(corriger, "« Corriger avec Claude » dans le panneau");
  assert.match(decodeURIComponent(corriger.getAttribute("href")), /la ligne « Courses et marché » \(Alimentation/);
  assert.match(dlg.querySelector(".ui-panneau-pied").innerHTML, /claude\.ai\/new\?q=/);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true);
  assert.equal(v.doc.activeElement, v.root.querySelector('[data-pv-ligne="bl-courses"]'));
  assert.deepEqual(v.acces, []);
});

test("vue (DOM) : carte Dépenses → panneau avec 5 catégories puis « Voir plus » qui se déplie ; mise à jour du store reflétée", () => {
  const v = vueDom(demoS());
  v.root.querySelector('[data-ui-carte="depense"]').click();
  const dlg = dlgDe(v.doc);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Dépenses");
  const btn = dlg.querySelector("[data-ui-voirplus]");
  assert.ok(btn, "« Voir plus » dans le panneau");
  const reste = dlg.querySelector(".ui-voirplus-reste");
  assert.equal(reste.hidden, true);
  btn.click();
  assert.equal(reste.hidden, false);
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  // le store émet un changement : le panneau se met à jour et le « Voir plus » reste déplié
  const S2 = J(v.S()); S2.budget.lignes.find(l => l.id === "bl-courses").montant = 900;
  v.api.update(S2, true);
  assert.match(sp(dlg.textContent), /Alimentation/);
  assert.equal(dlg.querySelector(".ui-voirplus-reste").hidden, false, "déplié conservé au rafraîchissement du panneau");
  assert.deepEqual(v.acces, []);
});

test("vue (DOM) : anti-redessin — deux rendus identiques ne réécrivent pas le DOM (plus de 5 catégories) ; « Voir plus » déplié le reste", () => {
  const v = vueDom(demoS());
  const zones = ["#pvCartes", "#pvBar", "#pvBudget"];
  const avant = zones.map(z => v.root.querySelector(z).children[0]);
  assert.ok(v.root.querySelector("#pvBudget").querySelector("[data-ui-voirplus]"), "la démo a plus de 5 catégories de dépenses");
  v.api.update(J(v.S()), true);
  v.api.update(J(v.S()), true);
  zones.forEach((z, i) => assert.equal(v.root.querySelector(z).children[0], avant[i], z + " non réécrit"));
  // déplier les catégories et la légende, puis une émission qui change les montants
  const voir = v.root.querySelector("#pvBudget").querySelector("[data-ui-voirplus]");
  voir.click();
  const leg = v.root.querySelector("#pvBar").querySelector("[data-ui-voirplus]");
  leg.click();
  const S2 = J(v.S()); S2.budget.lignes.find(l => l.id === "bl-courses").montant = 760;
  v.api.update(S2, true);
  assert.equal(v.root.querySelector("#pvBudget").querySelectorAll(".ui-voirplus-reste")[0].hidden, false, "catégories toujours dépliées");
  assert.equal(v.root.querySelector("#pvBar").querySelector(".ui-voirplus-reste").hidden, false, "légende toujours dépliée");
  assert.equal(v.root.querySelector("#pvBudget").querySelector("[data-ui-voirplus]").getAttribute("aria-expanded"), "true");
  // et un rendu identique après le dépli ne réécrit pas non plus
  const b0 = v.root.querySelector("#pvBudget").children[0];
  v.api.update(J(S2), true);
  v.api.update(J(S2), true);
  assert.equal(v.root.querySelector("#pvBudget").children[0], b0);
});

test("vue (DOM) : budget vide → état qui oriente vers Claude (déjà connu affiché, taux non calculé) ; carte de l'en-tête → panneau", () => {
  const v = vueDom(Object.assign(demoS(), { budget: { lignes: [] } }));
  const t = sp(v.root.querySelector("#pvBudget").textContent);
  assert.match(t, /Ton budget est vide/);
  assert.match(t, /Déjà connu grâce à Compte › Données/);
  assert.match(t, /Compléter avec Claude/);
  assert.deepEqual(questions(v.root.querySelector("#pvBudget").innerHTML), [P("budget")]);
  assert.match(sp(v.root.querySelector("#pvCartes").textContent), /remplis ton budget avec Claude pour le calculer/);
  assert.equal(v.root.querySelector("#pvBarBloc").hidden, true);
  v.root.querySelector('[data-ui-carte="revenu"]').click();
  const dlg = dlgDe(v.doc);
  assert.equal(dlg.hidden, false);
  assert.match(sp(dlg.textContent), /Salaire net de Camille/);
  assert.equal(v.api.headline(), "Budget à remplir");
  assert.ok(sansSaisie(v.root) && sansSaisie(dlg));
  assert.deepEqual(v.acces, []);
});

test("vue (DOM) : tutoiement de tout le texte affiché (page et panneaux)", () => {
  for (const S0 of [demoS(), Object.assign(demoS(), { budget: { lignes: [] } }), Object.assign(demoS(), { scope: "p2" })]) {
    const v = vueDom(S0);
    assert.doesNotMatch(sansExceptions(v.root.textContent), VOUVOIEMENT);
    for (const id of ["revenu", "depense", "epargne", "reste"]) {
      v.root.querySelector('[data-ui-carte="' + id + '"]').click();
      assert.doesNotMatch(sansExceptions(dlgDe(v.doc).textContent), VOUVOIEMENT, id);
    }
  }
});

test("coque : Patrimoine › Budget (#view-plan) et Patrimoine › Objectifs (#view-objectifs-view), avec leurs fragments", () => {
  assert.match(shell, /<section class="view" id="view-plan" data-space="patrimoine" data-sub="budget"[^>]*hidden>\s*<!--@plan-view-->/);
  assert.match(shell, /<section class="view" id="view-objectifs-view" data-space="patrimoine" data-sub="objectifs" role="tabpanel" aria-labelledby="subtab-patrimoine-objectifs" hidden>\s*<!--@objectifs-view-->/);
});

test("app.js : « plan » sur patrimoine/budget, « objectifs-view » sur patrimoine/objectifs ; anciennes routes et ancres", () => {
  const { SPACES, LEGACY, resolve, resolveHash } = require("../web/src/app.js");
  const patrimoine = SPACES.find(s => s.space === "patrimoine");
  assert.deepEqual(patrimoine.subs.map(s => [s.id, s.label, s.module]), [
    ["placements", "Placements", "pilotage"], ["comptes", "Comptes", "comptes-view"], ["immobilier", "Immobilier et crédits", "bilan"],
    ["budget", "Budget", "plan"], ["objectifs", "Objectifs", "objectifs-view"]]);
  assert.equal(LEGACY.plan, "patrimoine/budget");
  assert.equal(LEGACY["avenir/plan"], "patrimoine/budget");
  assert.deepEqual(resolve("plan"), { space: "patrimoine", sub: "budget" });
  for (const h of ["#plan", "#budget", "#avenir/plan"]) assert.deepEqual(resolveHash(h), { space: "patrimoine", sub: "budget", legacy: true }, h);
  assert.deepEqual(resolveHash("#objectifs"), { space: "patrimoine", sub: "objectifs", legacy: true });
  assert.deepEqual(resolveHash("#patrimoine/objectifs"), { space: "patrimoine", sub: "objectifs", legacy: false });
  assert.deepEqual(resolveHash("#patrimoine/budget"), { space: "patrimoine", sub: "budget", legacy: false });
});

test("build.mjs : modules plan-view et objectifs-view assemblés, moteur plan, repères et phrases Claude chargés avant", () => {
  const mods = JSON.parse(build.match(/const MODULES = (\[[^\]]*\])/)[1]);
  assert.ok(mods.includes("plan-view"));
  assert.ok(mods.includes("objectifs-view"));
  assert.match(build, /const SCRIPTS = \[[^\]]*"reperes"[^\]]*"plan"[^\]]*\.\.\.MODULES/);
  assert.match(build, /const SCRIPTS = \[[^\]]*"claude-prompts"[^\]]*\.\.\.MODULES/);
});

/* ------------------------------------------------------------------ budget réel (spec cp1 § 5) ------------------------------------------------------------------ */
const AUJ_R = "2026-10-12";
const MOIS_R = (m, categorie, entrees, sorties, extra) => ({ mois: m, categorie, entrees, sorties, nombre: 1, ...extra });
const COMPTES_R = [{ id: 1, nom: "Compte joint", type: "courant", ignore: false, doublonDe: null, actif: true },
  { id: 2, nom: "Livret A", type: "livret", ignore: false, doublonDe: null, actif: true },
  { id: 3, nom: "Ancien compte", type: "courant", ignore: true, doublonDe: null, actif: true },
  { id: 4, nom: "Compte joint (doublon)", type: "courant", ignore: false, doublonDe: 1, actif: true }];
const banqueR = mois => ({ actif: true, lu: true, connexions: [], comptes: COMPTES_R, mois });

test("budget réel : colonne « réel » sur les comptes courants seulement (mois agrégés par compte), sinon totaux tels quels", () => {
  const parCompte = banqueR([MOIS_R("2026-09-01", "loisirs", 0, 90, { compteId: 1 }), MOIS_R("2026-09-01", "loisirs", 0, 500, { compteId: 2 }),
    MOIS_R("2026-09-01", "loisirs", 0, 70, { compteId: 3 }), MOIS_R("2026-09-01", "loisirs", 0, 90, { compteId: 4 })]);
  assert.equal(PV.reelDe({ scope: "foyer", banque: parCompte }, AUJ_R).parCategorie.loisirs, 90, "livret, compte ignoré et doublon exclus");
  const totaux = banqueR([MOIS_R("2026-09-01", "loisirs", 0, 90), MOIS_R("2026-09-01", "alimentation", 0, 400)]);
  assert.deepEqual(J(PV.reelDe({ scope: "foyer", banque: totaux }, AUJ_R).parCategorie), { loisirs: 90, alimentation: 400 }, "sans détail par compte : inchangé");
  assert.equal(PV.reelDe({ scope: "p1", banque: parCompte }, AUJ_R), null);
});

test("budget réel : capacité d'épargne puis épargne versée (3 mois complets), chacune avec sa formule, et mention des virements internes exclus", () => {
  const b = banqueR([
    MOIS_R("2026-07-01", "revenus", 5000, 0), MOIS_R("2026-07-01", "epargne", 0, 500), MOIS_R("2026-08-01", "revenus", 5000, 0), MOIS_R("2026-08-01", "epargne", 0, 1000),
    MOIS_R("2026-09-01", "revenus", 5000, 0), MOIS_R("2026-09-01", "epargne", 0, 1500), MOIS_R("2026-09-01", "virement_interne", 2000, 2000),
    MOIS_R("2026-09-01", "alimentation", 0, 700)]);
  const br = PV.budgetReelDe({ scope: "foyer", banque: b }, AUJ_R);
  assert.equal(br.tauxEpargne, 0.2, "épargne versée ÷ revenus");
  assert.ok(Math.abs(br.tauxCapacite - (5000 - 700 / 3) / 5000) < 1e-9, "capacité d'épargne = (revenus − dépenses) ÷ revenus");
  assert.equal(PV.budgetReelDe({ scope: "p2", banque: b }, AUJ_R), null, "les comptes ne sont pas répartis par personne");
  assert.equal(PV.budgetReelDe({ scope: "foyer", banque: Object.assign({}, b, { actif: false }) }, AUJ_R), null);
  const h = sp(PV.tauxReelHtml(br));
  assert.match(texteDeR(h), /^Capacité d'épargne réelle, 3 derniers mois 95 % \(revenus − dépenses\) ÷ revenus\. Épargne versée 20 % versements d'épargne et d'investissement ÷ revenus\. /, "Capacité d'abord, chaque taux avec sa formule");
  assert.ok(h.indexOf("Capacité d'épargne") < h.indexOf("Épargne versée"));
  assert.doesNotMatch(texteDeR(h), /[Tt]aux d'épargne/, "un seul vocabulaire");
  assert.equal(br.parCompte, false, "totaux par utilisateur (sans compte)");
  assert.match(texteDeR(h), /moyenne de juillet à septembre 2026, sur tous tes comptes connectés \(le détail par compte n'est pas encore disponible\)\. Virements entre tes comptes exclus\./,
    "libellé honnête sans détail par compte");
  const hc = sp(PV.tauxReelHtml(Object.assign({}, br, { parCompte: true })));
  assert.match(texteDeR(hc), /moyenne de juillet à septembre 2026, sur tes comptes courants\. Virements entre tes comptes exclus\./, "détail par compte : comptes courants");
  assert.equal(PV.tauxReelHtml(null), "");
  assert.equal(PV.tauxReelHtml(Object.assign({}, br, { tauxEpargne: null, tauxCapacite: null })), "", "revenus inconnus : pas de taux");
  const neg = texteDeR(PV.tauxReelHtml(Object.assign({}, br, { tauxCapacite: -0.1, capacite: -500, tauxEpargne: 0 })));
  assert.match(neg, /^Capacité d'épargne réelle, 3 derniers mois [-−]10 % .*Épargne versée 0 % /, "dépenses > revenus : capacité négative, rien de versé");
  const lignes = [{ id: "e", type: "epargne", categorie: "Épargne", libelle: "Livret", montant: 200, frequence: "mois" }];
  const { groupes, totaux } = PV.regrouper(lignes, { profil: null, scope: "foyer", people: PEOPLE, Plan, Calc });
  const g = sp(PV.groupesHtml(groupes, { mode: "mois", totaux, U: UI, budgetReel: br }));
  const epargne = g.slice(g.indexOf('id="pv-sec-epargne"'));
  assert.match(epargne, /pv-reel-taux/, "lignes « Capacité d'épargne » et « Épargne versée » dans la section Épargne");
  assert.doesNotMatch(g.slice(0, g.indexOf('id="pv-sec-epargne"')), /pv-reel-taux/);
  assert.match(sp(PV.groupesHtml(groupes, { mode: "an", totaux, U: UI, budgetReel: br })), /Épargne versée<\/span> <b class="pv-num">20 %/, "taux identique par an");
  assert.doesNotMatch(sp(PV.groupesHtml(groupes, { mode: "mois", totaux, U: UI })), /pv-reel-taux/, "sans banque : rendu inchangé");
});

test("vue (DOM) : banque connectée → colonne réel, capacité d'épargne et épargne versée, note « virements entre tes comptes exclus »", () => {
  const d = new Date(), iso = k => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth() - k, 1)); return x.toISOString().slice(0, 10); };
  const mois = [1, 2, 3].flatMap(k => [MOIS_R(iso(k), "revenus", 5000, 0, { compteId: 1 }), MOIS_R(iso(k), "epargne", 0, 750, { compteId: 1 }),
    MOIS_R(iso(k), "alimentation", 0, 800, { compteId: 1 }), MOIS_R(iso(k), "alimentation", 0, 300, { compteId: 2 })]);
  const v = vueDom(Object.assign(demoS(), { banque: banqueR(mois) }));
  assert.match(sp(v.root.querySelector("#pvBudgetNote").textContent), /« Réel » : moyenne d[e'][^,]+, d'après tes comptes connectés\. Virements entre tes comptes exclus\./);
  assert.match(sp(v.root.querySelector('[data-pv-cat="depense:Alimentation"]').textContent), /réel 800 €\/mois/, "comptes courants seulement");
  assert.match(sp(v.root.querySelector("#pvBudget").textContent), /Capacité d'épargne réelle, 3 derniers mois 84 %[\s\S]*Épargne versée 15 %/);
  const sans = vueDom(Object.assign(demoS(), { banque: { actif: false, lu: true, connexions: [], comptes: [], mois: [] }, relevesBancaires: { lu: true, comptes: [], releves: [], banqueMois: [] } })); // ni banque ni relevé importé (la démo en porte)
  assert.doesNotMatch(sp(sans.root.querySelector("#pvBudgetNote").textContent), /Virements/);
  assert.equal(sans.root.querySelector(".pv-reel-taux"), null);
});
const texteDeR = h => String(h).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
