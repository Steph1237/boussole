// Agent › Journal (web/src/journal-view.*) : historique des décisions du foyer (avis, décisions, scénarios, revues,
// hypothèses, événements), filtres, liste groupée par mois, panneau de détail (comparaison « au moment / aujourd'hui »,
// historique, actions), consentement de l'agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/journal-view.js", "utf8");
const css = readFileSync("web/src/journal-view.css", "utf8");
const html = readFileSync("web/src/journal-view.html", "utf8");
const JV = require("../web/src/journal-view.js");
const UI = require("../web/src/ui.js");
const Calc = require("../web/src/calc.js");
const Pratiques = require("../web/src/pratiques.js");
const Risque = require("../web/src/risque.js");
const DEMO = require("../web/src/demo-data.js");

const DEPS = { Calc, Pratiques, Risque };
const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ");
const J = v => JSON.parse(JSON.stringify(v));
const demoS = () => Object.assign(J(DEMO), { ready: true, dbOk: true, scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], error: null });

const ETAT = {
  date: "2026-06-15", patrimoine_net: 400000, financier: 150000, dettes: 120000,
  bonnes_pratiques: { total: 61, provisoire: false },
  profil_declare: { id: "prudent", libelle: "Prudent" }, profil_equivalent: { id: "modere", libelle: "Modéré" },
  allocation_pct: { actions: 40 }, reperes: { livret_a_taux: { valeur: 2.4, date_effet: "2025-08-01" }, pfu_taux: { valeur: 30, date_effet: "2018-01-01" } },
};
const E = (id, o) => Object.assign({
  id, type: "decision", titre: "Entrée " + id, synthese: "Synthèse " + id, raisonnement: null, options: [], statut: "actif",
  dateDecision: null, revueLe: null, liens: {}, etat: ETAT, source: "Claude", historique: [],
  creeLe: "2026-10-01T10:00:00.000Z", majLe: "2026-10-01T10:00:00.000Z",
}, o);

/* ------------------------------------------------------------------ structure ------------------------------------------------------------------ */
test("journal-view.js : se compile et s'enregistre sous « journal-view »", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "journal-view.js" }));
  assert.match(js, /App\.register\("journal-view", api\)/);
  assert.match(js, /__pending/);
});

test("journal-view.js : aucune requête DOM globale hors racine du module", () => {
  const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
  assert.deepEqual(bad, []);
  assert.match(js, /const \$ = id => root\.querySelector\("#" \+ id\)/);
});

test("journal-view.html : identifiants utilisés par le script, en-tête, consentement, état vide", () => {
  const ids = [...js.matchAll(/\$\("(jv[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 8);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
  assert.ok(html.includes("Journal des décisions"));
  assert.ok(html.includes("Ce que l'agent peut enregistrer"));
  assert.match(html, /id="jvMsg"[^>]*role="status"/);
  assert.match(html, /id="jvConsentErr"[^>]*role="alert"/);
  assert.match(html, /id="jvVide"/);
  assert.ok(js.includes(`"Faisons le point sur ma situation et enregistre nos décisions dans mon journal Boussole", "Faire le point avec Claude"`));
});

test("journal-view.css : scopé sous #view-journal-view (contenu du panneau sous .ui-panneau .jv-…), sombre et mobile", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(sels.length > 20);
  const bad = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !/^#view-journal-view\b/.test(x) && !/^\.ui-panneau \.jv-/.test(x));
  assert.deepEqual(bad, []);
  assert.match(css, /@media \(max-width:\s*\d+px\)/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b(?![-\w])/, "couleurs par variables du thème (clair et sombre)");
});

test("journal-view.js : actions par Store.journal (confirmer, modifier, supprimer, consentement) ; confirmation avant suppression", () => {
  assert.match(js, /window\.Store && window\.Store\.journal/);
  assert.match(js, /\.confirmer\(\[/);
  assert.match(js, /\.modifier\(/);
  assert.match(js, /\.supprimer\(\[/);
  assert.match(js, /\.consentement\(/);
  const iConfirm = js.indexOf("confirm(q)"), iSuppr = js.indexOf("api.supprimer([");
  assert.ok(iConfirm > 0 && iConfirm < iSuppr, "confirm() avant supprimer()");
  assert.match(js, /function headline\(\)/);
  assert.match(js, /UI\.?|U\(\)\.demanderAClaude|u\.demanderAClaude/);
});

/* ------------------------------------------------------------------ filtrer ------------------------------------------------------------------ */
test("filtrer : par type et par statut (« actif » = En cours), « tout » ou vide = sans filtre, ordre conservé", () => {
  const j = [E("a", { type: "avis", statut: "a_relire" }), E("b", { type: "decision", statut: "actif" }), E("c", { type: "decision", statut: "a_relire" }),
    E("d", { type: "scenario", statut: "realise" }), E("e", { type: "decision", statut: "archive" })];
  assert.deepEqual(JV.filtrer(j, "tout", "tout").map(e => e.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(JV.filtrer(j, null, null).map(e => e.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(JV.filtrer(j, "decision", "tout").map(e => e.id), ["b", "c", "e"]);
  assert.deepEqual(JV.filtrer(j, "tout", "a_relire").map(e => e.id), ["a", "c"]);
  assert.deepEqual(JV.filtrer(j, "decision", "a_relire").map(e => e.id), ["c"]);
  assert.deepEqual(JV.filtrer(j, "tout", "actif").map(e => e.id), ["b"]);
  assert.deepEqual(JV.filtrer(j, "tout", "en_cours").map(e => e.id), ["b"]);
  assert.deepEqual(JV.filtrer(j, "hypothese", "tout"), []);
  assert.deepEqual(JV.filtrer(null, "tout", "tout"), []);
  assert.deepEqual(JV.filtrer([null, E("x")], "tout", "tout").map(e => e.id), ["x"]);
});

/* ------------------------------------------------------------------ grouperParMois ------------------------------------------------------------------ */
test("grouperParMois : mois les plus récents d'abord, date de décision sinon date d'écriture, titres « Octobre 2026 »", () => {
  const j = [
    E("a", { creeLe: "2026-10-09T08:00:00.000Z" }),
    E("b", { dateDecision: "2026-09-12", creeLe: "2026-10-05T08:00:00.000Z" }),
    E("c", { creeLe: "2026-10-02T08:00:00.000Z" }),
    E("d", { dateDecision: "2025-12-24", creeLe: "2026-01-03T08:00:00.000Z" }),
    E("e", { dateDecision: "2026-09-30", creeLe: "2026-09-30T08:00:00.000Z" }),
  ];
  const g = JV.grouperParMois(j);
  assert.deepEqual(g.map(x => x.cle), ["2026-10", "2026-09", "2025-12"]);
  assert.deepEqual(g.map(x => x.titre), ["Octobre 2026", "Septembre 2026", "Décembre 2025"]);
  assert.deepEqual(g[0].entrees.map(e => e.id), ["a", "c"]);
  assert.deepEqual(g[1].entrees.map(e => e.id), ["e", "b"], "plus récente d'abord dans le mois");
  assert.deepEqual(JV.grouperParMois([]), []);
  assert.deepEqual(JV.grouperParMois(null), []);
});

test("grouperParMois : entrée sans date lisible regroupée à la fin (« Sans date »)", () => {
  const g = JV.grouperParMois([E("x", { creeLe: null }), E("y", { creeLe: "2026-03-04T12:00:00.000Z" })]);
  assert.deepEqual(g.map(x => x.titre), ["Mars 2026", "Sans date"]);
  assert.deepEqual(g[1].entrees.map(e => e.id), ["x"]);
});

/* ------------------------------------------------------------------ comparaison ------------------------------------------------------------------ */
test("comparaison : patrimoine net, bonnes pratiques, profils et repères, au moment et aujourd'hui (démo)", () => {
  const S = demoS();
  const c = JV.comparaison(ETAT, S, DEPS);
  assert.equal(c.disponible, true);
  assert.equal(c.date, "2026-06-15");
  const L = Object.fromEntries(c.lignes.map(l => [l.cle, l]));
  assert.ok(L.net && L.pratiques && L.profil && L.livret_a_taux && L.pfu_taux);
  assert.equal(sp(L.net.moment), "400 000 €");
  const net = Calc.patrimoine(S.positions, S.profil, "foyer").net;
  assert.equal(sp(L.net.aujourdhui), sp(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(net)) + " €"));
  assert.match(sp(L.net.ecart), /^[+−]\d/);
  assert.equal(L.pratiques.moment, "61 / 100");
  assert.match(L.pratiques.aujourdhui, /^\d+ \/ 100( \(provisoire\))?$/);
  assert.equal(L.profil.moment, "Prudent");
  const idp = S.risque && S.risque.profil ? (typeof S.risque.profil === "object" ? S.risque.profil.id : S.risque.profil) : null;
  const decl = Risque.PROFILS.find(p => p.id === idp);
  assert.equal(L.profil.aujourdhui, decl ? decl.label : "non renseigné");
  assert.equal(L.livret_a_taux.label, "Taux du Livret A");
  assert.equal(sp(L.livret_a_taux.moment), "2,4 %");
  assert.equal(sp(L.livret_a_taux.aujourdhui), "1,7 %");
  assert.equal(L.livret_a_taux.change, true);
  assert.equal(sp(L.pfu_taux.moment), "30 %");
  assert.equal(sp(L.pfu_taux.aujourdhui), "31,4 %");
});

test("comparaison : état indisponible ou absent → disponible false, valeurs « au moment » nulles, aujourd'hui calculé", () => {
  const S = demoS();
  for (const etat of [{ date: "2026-06-15", indisponible: true }, {}, null, undefined]) {
    const c = JV.comparaison(etat, S, DEPS);
    assert.equal(c.disponible, false);
    const net = c.lignes.find(l => l.cle === "net");
    assert.equal(net.moment, null);
    assert.ok(net.aujourdhui);
    assert.equal(net.ecart, null);
  }
});

test("comparaison : valeurs absentes gérées (pas de profil, pas de note, pas de repère, pas de dépendances)", () => {
  const vide = { ready: true, positions: [], profil: null, risque: null, classes: {}, savoir: { reperes: [] }, objectifs: [], config: {}, budget: null };
  const c = JV.comparaison({ date: "2026-06-15", patrimoine_net: 0, bonnes_pratiques: { total: null, provisoire: true }, profil_declare: null, profil_equivalent: null, reperes: {} }, vide, DEPS);
  const L = Object.fromEntries(c.lignes.map(l => [l.cle, l]));
  assert.equal(L.profil.moment, "non renseigné");
  assert.equal(L.profil.aujourdhui, "non renseigné");
  assert.equal(L.pratiques.moment, "—");
  assert.ok(!L.livret_a_taux, "aucun repère ni au moment ni aujourd'hui : pas de ligne");
  const sans = JV.comparaison(ETAT, vide, { Calc: null, Pratiques: null, Risque: null });
  const N = Object.fromEntries(sans.lignes.map(l => [l.cle, l]));
  assert.equal(N.net.aujourdhui, null);
  assert.equal(N.net.ecart, null);
  assert.equal(N.pratiques.aujourdhui, null);
  assert.equal(N.livret_a_taux.aujourdhui, null);
  assert.equal(N.livret_a_taux.change, false);
});

test("comparaison : bonnes pratiques provisoires signalées, écart du patrimoine signé", () => {
  const S = { ready: true, positions: [], profil: null, risque: { profil: "equilibre" }, classes: {}, savoir: { reperes: [] }, objectifs: [] };
  const faux = { Calc: { patrimoine: () => ({ net: 410000 }) }, Pratiques: { evaluer: () => ({ total: 55, provisoire: true }) }, Risque };
  const c = JV.comparaison(Object.assign({}, ETAT, { bonnes_pratiques: { total: 61, provisoire: true } }), S, faux);
  const L = Object.fromEntries(c.lignes.map(l => [l.cle, l]));
  assert.equal(L.pratiques.moment, "61 / 100 (provisoire)");
  assert.equal(L.pratiques.aujourdhui, "55 / 100 (provisoire)");
  assert.equal(sp(L.pratiques.ecart), "−6 pts");
  assert.equal(sp(L.net.ecart), "+10 000 €");
  assert.equal(L.profil.aujourdhui, "Équilibré");
  assert.equal(L.profil.change, true);
  const pareil = JV.comparaison(ETAT, S, { Calc: { patrimoine: () => ({ net: 400000.2 }) }, Pratiques: { evaluer: () => ({ total: 61 }) }, Risque });
  const P = Object.fromEntries(pareil.lignes.map(l => [l.cle, l]));
  assert.equal(P.net.ecart, null, "pas d'écart affiché quand rien n'a bougé");
  assert.equal(P.net.change, false);
  assert.equal(P.pratiques.ecart, null);
});

/* ------------------------------------------------------------------ libelleHistorique ------------------------------------------------------------------ */
test("libelleHistorique : { le, champ, avant, apres } → libellés français (statut, type, dates, textes)", () => {
  const h = (champ, avant, apres) => JV.libelleHistorique({ le: "2026-10-08T09:00:00.000Z", champ, avant, apres });
  const s = h("statut", "actif", "realise");
  assert.equal(sp(s.date), "8 oct. 2026");
  assert.equal(s.texte, "Statut : En cours → Réalisé");
  assert.equal(h("type", "avis", "decision").texte, "Type : Avis → Décision");
  assert.equal(sp(h("revue_le", null, "2027-01-15").texte), "Date de revue : aucune → 15 janv. 2027");
  assert.equal(sp(h("date_decision", "2026-09-12", null).texte), "Date de décision : 12 sept. 2026 → aucune");
  assert.equal(h("titre", "Ancien titre", "Nouveau titre").texte, "Titre : « Ancien titre » → « Nouveau titre »");
  assert.equal(h("synthese", "", "Texte").texte, "Synthèse : vide → « Texte »");
  assert.equal(h("options", [], [{ titre: "A" }]).texte, "Options modifiées");
  assert.equal(h("liens", {}, { objectifs: ["x"] }).texte, "Liens modifiés");
  assert.match(h("titre", "x".repeat(200), "y").texte, /…/);
});

test("libelleHistorique : forme { le, champ: 'raisonnement', ajout } → note ajoutée ; entrée invalide sans erreur", () => {
  const n = JV.libelleHistorique({ le: "2026-10-09T09:00:00.000Z", champ: "raisonnement", ajout: "\n\n— Note du 2026-10-09 (Claude) : taux du Livret A baissé." });
  assert.equal(sp(n.date), "9 oct. 2026");
  assert.equal(n.texte, "Note ajoutée au raisonnement : « — Note du 2026-10-09 (Claude) : taux du Livret A baissé. »");
  assert.equal(JV.libelleHistorique({ champ: "raisonnement", avant: "a", apres: "b" }).texte, "Raisonnement réécrit");
  assert.equal(JV.libelleHistorique(null).texte, "Modification");
  assert.equal(JV.libelleHistorique({ le: "n'importe quoi", champ: "inconnu" }).date, "");
  assert.equal(JV.libelleHistorique({ champ: "inconnu" }).texte, "Champ « inconnu » modifié");
});

/* ------------------------------------------------------------------ markdown sûr ------------------------------------------------------------------ */
test("rendreMarkdown : échappe tout le HTML, titres, listes, gras, liens https seulement", () => {
  const h = JV.rendreMarkdown("## Pourquoi\n\nTexte **important** <img src=x onerror=alert(1)>\n\n- un\n- deux\n\n1. a\n2. b\n\n[source](https://www.service-public.fr) [mal](javascript:alert(1))");
  assert.ok(h.includes("<h3>Pourquoi</h3>"));
  assert.ok(h.includes("<strong>important</strong>"));
  assert.ok(h.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!/<img/.test(h));
  assert.ok(h.includes("<ul><li>un</li><li>deux</li></ul>"));
  assert.ok(h.includes("<ol><li>a</li><li>b</li></ol>"));
  assert.ok(h.includes('<a href="https://www.service-public.fr" target="_blank" rel="noopener noreferrer">source'));
  assert.ok(!h.includes('href="javascript'));
  assert.equal(JV.rendreMarkdown(null), "");
  assert.equal(JV.rendreMarkdown('"><script>x</script>'), "<p>&quot;&gt;&lt;script&gt;x&lt;/script&gt;</p>");
});

/* ------------------------------------------------------------------ rendus HTML ------------------------------------------------------------------ */
test("listeHtml : en-têtes de mois, cartes UI.carte (type, date, statut), « à relire » en évidence, 5 puis « Voir plus », tout échappé", () => {
  const j = [E("r1", { statut: "a_relire", type: "avis", titre: "<b>Avis</b> & co", synthese: "<script>x</script>", creeLe: "2026-10-09T08:00:00.000Z" })]
    .concat([1, 2, 3, 4, 5, 6].map(i => E("d" + i, { creeLe: "2026-10-0" + i + "T08:00:00.000Z" })));
  const h = JV.listeHtml(JV.grouperParMois(j), UI);
  assert.ok(h.includes("Octobre 2026"));
  assert.equal((h.match(/data-ui-carte=/g) || []).length, 7);
  assert.ok(h.includes('data-ui-carte="r1"'));
  assert.ok(h.includes("&lt;b&gt;Avis&lt;/b&gt; &amp; co"));
  assert.ok(h.includes("&lt;script&gt;x&lt;/script&gt;"));
  assert.ok(!/<script>/.test(h));
  assert.match(h, /class="jv-it is-relire"/);
  assert.ok(h.includes("À relire"));
  assert.ok(h.includes("En cours"));
  assert.match(h, /data-ui-voirplus/);
  assert.match(h, /Voir plus \(2\)/);
});

test("detailHtml : synthèse, raisonnement rendu, options (retenue en évidence), comparaison, liens résolus, historique, actions selon le statut", () => {
  const S = demoS();
  const obj = S.objectifs[0], pos = S.positions[0];
  const e = E("x1", {
    titre: "Garder le PEA <script>", synthese: "On garde **le** PEA <img>", raisonnement: "## Contexte\n\nPEA ouvert en 2019.",
    options: [{ titre: "Garder", retenue: true, pourquoi: "Fiscalité après 5 ans" }, { titre: "Clôturer <x>", retenue: false, pourquoi: "" }],
    statut: "actif", dateDecision: "2026-09-12", revueLe: "2027-03-01",
    liens: { objectifs: [obj.id], positions: [pos.id], biens: ["inconnu"] },
    historique: [{ le: "2026-10-01T09:00:00.000Z", champ: "statut", avant: "a_relire", apres: "actif" }, { le: "2026-10-02T09:00:00.000Z", champ: "raisonnement", ajout: "\n\n— Note" }],
  });
  const h = JV.detailHtml(e, S, UI, { deps: DEPS });
  assert.ok(h.includes("On garde **le** PEA &lt;img&gt;"), "synthèse échappée, sans markdown");
  assert.ok(h.includes("<h3>Contexte</h3>"));
  assert.match(h, /jv-opt is-retenue/);
  assert.ok(h.includes("Clôturer &lt;x&gt;"));
  assert.ok(h.includes("Au moment"));
  assert.ok(h.includes("Aujourd'hui") || h.includes("Aujourd&#39;hui"));
  assert.ok(h.includes(UI.esc(obj.nom)));
  assert.ok(h.includes('href="#patrimoine/budget"'));
  assert.ok(h.includes('href="#patrimoine/placements"'));
  assert.ok(h.includes("élément supprimé"));
  assert.match(h, /<details class="ui-acc"/);
  assert.ok(h.includes("Statut : À relire → En cours"));
  for (const a of ["realise", "abandonner", "corriger", "archiver", "supprimer"]) assert.ok(h.includes('data-jv-act="' + a + '"'), a);
  assert.ok(!h.includes('data-jv-act="confirmer"'));
  assert.ok(!/<script>|<img/.test(h));
});

test("actionsPour : selon le statut (confirmer seulement à relire, supprimer toujours)", () => {
  assert.deepEqual(JV.actionsPour("a_relire"), ["confirmer", "corriger", "supprimer"]);
  assert.deepEqual(JV.actionsPour("actif"), ["realise", "abandonner", "corriger", "archiver", "supprimer"]);
  assert.deepEqual(JV.actionsPour("realise"), ["archiver", "corriger", "supprimer"]);
  assert.deepEqual(JV.actionsPour("abandonne"), ["archiver", "corriger", "supprimer"]);
  assert.deepEqual(JV.actionsPour("archive"), ["corriger", "supprimer"]);
  assert.deepEqual(JV.actionsPour("inconnu"), ["corriger", "supprimer"]);
});

test("detailHtml : état indisponible expliqué, formulaire de correction (titre, synthèse, statut, revue)", () => {
  const S = demoS();
  const e = E("x2", { statut: "a_relire", etat: { date: "2026-10-01", indisponible: true } });
  const h = JV.detailHtml(e, S, UI, { deps: DEPS });
  assert.match(sp(h), /n'a pas pu être figé|n&#39;a pas pu être figé/);
  assert.ok(h.includes('data-jv-act="confirmer"'));
  const f = JV.detailHtml(e, S, UI, { deps: DEPS, edition: { titre: "T <x>", synthese: "S", statut: "a_relire", revueLe: "" } });
  assert.match(f, /<input[^>]+id="jv-f-titre"[^>]+maxlength="120"/);
  assert.match(f, /<textarea[^>]+id="jv-f-synthese"[^>]+maxlength="600"/);
  assert.match(f, /<select[^>]+id="jv-f-statut"/);
  assert.match(f, /<input[^>]+type="date"[^>]+id="jv-f-revue"/);
  assert.ok(f.includes('value="T &lt;x&gt;"'));
  assert.ok(f.includes('data-jv-act="enregistrer"'));
  assert.ok(f.includes('data-jv-act="annuler"'));
  assert.ok(f.includes('<option value="a_relire" selected>'));
  const g = JV.detailHtml(E("x3"), S, UI, { deps: DEPS, edition: { titre: "T", synthese: "S", statut: "actif", revueLe: "" } });
  assert.ok(!g.includes('value="a_relire"'), "pas de retour à « à relire » pour une entrée confirmée");
});

test("questionClaude : cite le titre de l'entrée ; patchCorrection ne garde que les champs changés et valide les longueurs", () => {
  const e = E("q", { titre: "Garder le PEA", type: "decision", statut: "actif", revueLe: "2027-01-01" });
  assert.match(JV.questionClaude(e), /« Garder le PEA »/);
  assert.match(JV.questionClaude(e), /journal Boussole/);
  assert.deepEqual(JV.patchCorrection(e, { titre: "Garder le PEA", synthese: "Synthèse q", statut: "actif", revueLe: "2027-01-01" }), { patch: {} });
  assert.deepEqual(JV.patchCorrection(e, { titre: "  Nouveau titre ", synthese: "Synthèse q", statut: "realise", revueLe: "" }),
    { patch: { titre: "Nouveau titre", statut: "realise", revueLe: null } });
  assert.match(JV.patchCorrection(e, { titre: "ab", synthese: "x", statut: "actif", revueLe: "" }).erreur, /3 à 120/);
  assert.match(JV.patchCorrection(e, { titre: "Titre ok", synthese: "  ", statut: "actif", revueLe: "" }).erreur, /synthèse/i);
  assert.match(JV.patchCorrection(e, { titre: "Titre ok", synthese: "x".repeat(601), statut: "actif", revueLe: "" }).erreur, /600/);
  assert.match(JV.patchCorrection(e, { titre: "Titre ok", synthese: "x", statut: "bidon", revueLe: "" }).erreur, /statut/i);
  assert.match(JV.patchCorrection(e, { titre: "Titre ok", synthese: "x", statut: "a_relire", revueLe: "" }).erreur, /statut/i, "une entrée confirmée ne revient pas à relire");
  assert.deepEqual(JV.patchCorrection(E("r", { statut: "a_relire" }), { titre: "Entrée r", synthese: "Synthèse r", statut: "a_relire", revueLe: "" }), { patch: {} });
});

test("consentement : trois modes, chacun expliqué par une phrase", () => {
  assert.deepEqual(JV.CONSENTEMENTS.map(c => c.id), ["demander", "prevenir", "jamais"]);
  assert.deepEqual(JV.CONSENTEMENTS.map(c => c.label), ["Me demander", "Enregistrer et me prévenir", "Jamais"]);
  JV.CONSENTEMENTS.forEach(c => assert.ok(c.texte.length > 30));
});

test("nARelire et statutParDefaut : « À relire » par défaut s'il y en a, sinon « Tout »", () => {
  assert.equal(JV.nARelire([E("a", { statut: "a_relire" }), E("b"), E("c", { statut: "a_relire" })]), 2);
  assert.equal(JV.nARelire(null), 0);
  assert.equal(JV.statutParDefaut([E("a", { statut: "a_relire" })]), "a_relire");
  assert.equal(JV.statutParDefaut([E("b")]), "tout");
  assert.equal(JV.statutParDefaut([]), "tout");
});
