// Aujourd'hui (web/src/aujourdhui.*) : page d'accueil du cockpit. Indicateurs en cartes, boîte de réception unique
// (propositions de Claude, alertes, points à reprendre, échéances, cours), frise du patrimoine net. Tutoiement ; « Faire le point
// avec Claude » = revue du mois (ClaudePrompts) ; granularité de la frise automatique sauf choix de l'utilisateur (seul enregistré).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/aujourdhui.js", "utf8");
const css = readFileSync("web/src/aujourdhui.css", "utf8");
const html = readFileSync("web/src/aujourdhui.html", "utf8");
const A = require("../web/src/aujourdhui.js");
const Calc = require("../web/src/calc.js");
const BilanCalc = require("../web/src/bilan-calc.js");
const Rules = require("../web/src/rules.js");
const Plan = require("../web/src/plan.js");
const Pratiques = require("../web/src/pratiques.js");
const Risque = require("../web/src/risque.js");
const Periodes = require("../web/src/periodes.js");
const DEMO = require("../web/src/demo-data.js");
const ClaudePrompts = require("../web/src/claude-prompts.js");
const RoutineEtat = require("../web/src/routine-etat.js");
const HAS_UI = existsSync("web/src/ui.js");
const UI = HAS_UI ? require("../web/src/ui.js") : null;

const G = require("../web/src/graphe-patrimoine.js");
const Historique = require("../web/src/historique.js");
const ObjectifsView = require("../web/src/objectifs-view.js");
const DEPS = { Rules, Plan, Pratiques, Calc, BilanCalc, Risque, Periodes };
const TODAY = "2026-10-10";
const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[  ]/g, " ");
// Jour de Paris, comme l'app (jour() des vues) : la CI tourne en UTC et échouait entre minuit et 2 h à Paris.
const jourLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
/* État minimal : aucune donnée, prêt. */
const vide = o => Object.assign({ ready: true, dbOk: true, positions: [], snapshots: [], tx: [], config: {}, status: null, profil: null, budget: null, objectifs: [],
  risque: null, classes: {}, propositions: [], connexions: [], memoire: [], scope: "foyer", people: [{ id: "p1", nom: "Camille" }], error: null }, o);
/* État de démo tel que store-demo.js l'expose (scope foyer, deux personnes). */
const demoS = () => Object.assign(J(DEMO), { ready: true, dbOk: true, scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], error: null });
const P = (id, lot, cible, o) => Object.assign({ id, lot, cible, operation: "modifier", ref: null, avant: null, apres: {}, source: "Claude", justification: "", statut: "en_attente",
  creeLe: "2026-10-09T10:00:00.000Z", decideLe: null }, o);
const M = (id, categorie, o) => Object.assign({ id, categorie, contenu: "Souvenir " + id, echeance: null, epingle: false, source: "Claude", creeLe: "2026-10-01T20:15:00.000Z" }, o);
/* Faux Rules : renvoie les alertes données (règles de l'utilisateur, puis contrôles intégrés). */
const fauxRules = (regles, integres) => ({ evaluate: () => regles.map(a => Object.assign({}, a)), builtins: () => integres.map(a => Object.assign({ rule: null }, a)) });

/* ------------------------------------------------------------------ module ------------------------------------------------------------------ */

test("aujourdhui.js : se compile, s'enregistre sous « aujourdhui » (motif __pending), API de module complète", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "aujourdhui.js" }));
  assert.match(js, /App\.register\("aujourdhui", api\)/);
  assert.match(js, /__pending/);
  assert.match(js, /const api = \{ mount, update, show, headline \}/);
});

test("aujourdhui.js : aucune requête DOM globale hors racine du module ; $ scopé", () => {
  const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
  assert.deepEqual(bad, []);
  assert.match(js, /const \$ = id => root\.querySelector\("#" \+ id\)/);
});

test("aujourdhui.js : les fonctions pures ne dépendent ni de UI ni du DOM (chargées sans window)", () => {
  for (const f of ["boite", "urlClaude", "indicateurs", "frise", "objectifs", "evolution", "echeances", "cartes", "detail", "boiteHtml"]) assert.equal(typeof A[f], "function", f);
  assert.equal(A.friseSvg, undefined, "l'ancienne frise est remplacée par le graphe maître (graphe-patrimoine.js)");
  const pur = js.slice(0, js.indexOf("if (typeof document === \"undefined\") return;"));
  assert.ok(pur.length > 1000, "partie pure repérée");
  assert.doesNotMatch(pur, /window\.UI|\bUI\.(carte|panneau|periode|brancher|voirPlus|demanderAClaude)\(/, "la partie pure reçoit UI en paramètre si besoin");
  assert.doesNotMatch(pur, /document\./);
});

test("aujourdhui.html : identifiants utilisés par le script, titres des trois blocs", () => {
  const ids = [...js.matchAll(/\$\("(aj[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 5);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
  assert.match(html, /À traiter/);
  assert.match(html, /Évolution et projection du patrimoine net/);
  assert.match(html, /aria-live="polite"/);
});

test("aujourdhui.css : entièrement scopé sous #view-aujourdhui (le panneau, hors de la vue, sous .ui-panneau .aj-…)", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(sels.length > 15);
  const bad = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !/^#view-aujourdhui\b/.test(x) && !/^\.ui-panneau \.aj-/.test(x));
  assert.deepEqual(bad, []);
});

test("aujourdhui.js : liens externes en https:// seulement, nouvel onglet, rel noopener noreferrer", () => {
  assert.match(js, /target="_blank" rel="noopener noreferrer"/);
  assert.match(js, /\^https:\\\/\\\//, "contrôle du schéma https:// avant d'écrire un lien");
});

/* ------------------------------------------------------------------ urlClaude ------------------------------------------------------------------ */

test("urlClaude : https://claude.ai/new?q=<question encodée>", () => {
  const q = "Fais le point & dis-moi « où j'en suis » ? 100 %";
  assert.equal(A.urlClaude(q), "https://claude.ai/new?q=" + encodeURIComponent(q));
  assert.equal(A.urlClaude(""), "https://claude.ai/new?q=");
  assert.doesNotMatch(A.urlClaude('<a href="x">'), /[<>"\s]/);
});

test("urlClaude : identique au lien de UI.demanderAClaude", { skip: !HAS_UI && "web/src/ui.js pas encore là" }, () => {
  const q = "Reprenons ce point : « vérifier la SCPI » & le PEA ?";
  const h = UI.demanderAClaude(q);
  const href = h.match(/href="([^"]+)"/)[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  assert.equal(href, A.urlClaude(q));
});

/* ------------------------------------------------------------------ boite ------------------------------------------------------------------ */

test("boite : vide sans rien à traiter (et avant que le store soit prêt)", () => {
  assert.deepEqual(A.boite(vide(), TODAY, { Rules }), []);
  assert.deepEqual(A.boite(vide({ ready: false, propositions: [P("a", "l1", "budget")] }), TODAY, { Rules }), []);
  assert.deepEqual(A.boite(null, TODAY, { Rules }), []);
});

test("boite : propositions en attente regroupées par lot, cibles en contexte, urgence 1, vers Agent › Propositions", () => {
  const S = vide({ propositions: [
    P("a", "l1", "position", { creeLe: "2026-10-09T10:00:00.000Z" }), P("b", "l1", "budget"), P("c", "l1", "position"),
    P("d", "l2", "risque", { creeLe: "2026-10-08T09:00:00.000Z" }), P("e", "l1", "bien", { statut: "acceptee" }), P("f", "l3", "credit", { statut: "refusee" }),
  ] });
  const b = A.boite(S, TODAY, { Rules: fauxRules([], []) });
  assert.equal(b.length, 2);
  assert.ok(b.every(x => x.type === "proposition" && x.urgence === 1));
  const l1 = b.find(x => /3 changements/.test(x.titre)), l2 = b.find(x => /1 changement\b/.test(x.titre));
  assert.ok(l1 && l2, b.map(x => x.titre).join(" | "));
  assert.equal(l1.titre, "Claude propose 3 changements");
  assert.match(l1.contexte, /placements/i);
  assert.match(l1.contexte, /budget/i);
  assert.doesNotMatch(l1.contexte, /biens/i, "une proposition déjà acceptée ne compte plus");
  assert.match(l2.contexte, /profil de risque/i);
  assert.deepEqual(J(l1.action), { label: "Examiner", route: "agent/propositions" });
  assert.equal(b[0], l2, "le lot le plus ancien d'abord à urgence égale");
});

test("boite : alertes des règles, urgence selon la gravité, vers la page concernée ; échéances et mise à jour nocturne dédoublonnées", () => {
  const R = fauxRules(
    [{ level: "crit", title: "Seuil de cours touché : Air Liquide", text: "Seuil atteint.", rule: { type: "price_floor" } },
      { level: "info", title: "Cours anciens", text: "1 ligne…", rule: { type: "stale_prices" } }],
    [{ level: "warn", title: "Poche Monde au-dessus de la cible", text: "52 % contre 45 %.", kind: "cible" },
      { level: "info", title: "Matelas sous la cible", text: "10 000 € contre 15 000 €.", kind: "matelas" },
      { level: "info", title: "Fin de période d'essai", text: "Le 20 oct. 2026 (dans 10 jours). ", kind: "jalon" },
      { level: "warn", title: "Mise à jour nocturne en retard", text: "Dernier passage le 01 oct. 2026.", kind: "nocturne" }]);
  const b = A.boite(vide(), TODAY, { Rules: R });
  assert.deepEqual(b.map(x => [x.type, x.urgence, x.titre]), [
    ["alerte", 1, "Seuil de cours touché : Air Liquide"],
    ["alerte", 2, "Poche Monde au-dessus de la cible"],
    ["alerte", 3, "Cours anciens"],
    ["alerte", 3, "Matelas sous la cible"],
  ]);
  assert.equal(b[0].action.route, "patrimoine/placements");
  assert.equal(b[3].action.route, "patrimoine/budget");
  assert.equal(b[0].contexte, "Seuil atteint.");
});

test("boite : points « à suivre » échus de la mémoire → « Reprendre avec Claude » (lien claude.ai), urgence 2", () => {
  const S = vide({ memoire: [
    M("a", "a_suivre", { echeance: "2026-10-05", contenu: "Vérifier la SCPI <b>& le PEA</b>" }),
    M("b", "a_suivre", { echeance: TODAY }),
    M("c", "a_suivre", { echeance: "2026-10-11" }),
    M("d", "a_suivre"),
    M("e", "projet", { echeance: "2026-10-01" }),
  ] });
  const b = A.boite(S, TODAY, { Rules: fauxRules([], []) });
  assert.deepEqual(b.map(x => x.type), ["a_suivre", "a_suivre"]);
  assert.ok(b.every(x => x.urgence === 2));
  assert.equal(b[0].titre, "À reprendre : Vérifier la SCPI <b>& le PEA</b>", "texte brut : l'échappement se fait au rendu");
  assert.equal(b[0].action.label, "Reprendre avec Claude");
  assert.ok(b[0].action.url.startsWith("https://claude.ai/new?q="));
  assert.match(decodeURIComponent(b[0].action.url.split("?q=")[1]), /Vérifier la SCPI <b>& le PEA<\/b>/);
  assert.equal(b[0].action.route, undefined);
  assert.match(sp(b[0].contexte), /5 oct\. 2026/);
});

test("boite : échéances à 30 jours au plus (config et objectifs datés), urgence 2 à 7 jours, 3 au-delà", () => {
  const S = vide({
    config: { milestones: [
      { title: "Taxe foncière", date: "2026-10-15", text: "Prévoir 1 100 €." },
      { title: "Fin de l'essai", date: "2026-10-30" },
      { title: "Trop loin", date: "2026-11-20" },
      { title: "Passée", date: "2026-10-01" },
      { title: "Sans date" },
    ] },
    objectifs: [
      { id: "o1", nom: "Voyage", type: "projet", cible: 3000, dateCible: "2026-10-17" },
      { id: "o2", nom: "Apport", type: "apport", cible: 60000, dateCible: "2029-06-30" },
      { id: "o3", nom: "Sans date", type: "projet", cible: 1000, dateCible: null },
    ],
  });
  const b = A.boite(S, TODAY, { Rules: fauxRules([], []) });
  assert.deepEqual(b.map(x => [x.type, x.urgence, x.titre]), [
    ["echeance", 2, "Taxe foncière"],
    ["echeance", 2, "Objectif « Voyage »"],
    ["echeance", 3, "Fin de l'essai"],
  ]);
  assert.match(sp(b[0].contexte), /dans 5 jours/);
  assert.match(b[0].contexte, /Prévoir 1 100 €\./);
  assert.match(sp(b[1].contexte), /dans 7 jours/);
  assert.deepEqual(b[0].action, { label: "Voir les objectifs", route: "patrimoine/objectifs" }, "échéances → Patrimoine › Objectifs");
  const lim = A.boite(vide({ config: { milestones: [{ title: "Pile 30", date: "2026-11-09" }, { title: "31", date: "2026-11-10" }, { title: "Pile 7", date: "2026-10-17" }, { title: "Jour J", date: TODAY }] } }), TODAY, { Rules: fauxRules([], []) });
  assert.deepEqual(lim.map(x => [x.titre, x.urgence]), [["Jour J", 2], ["Pile 7", 2], ["Pile 30", 3]]);
  assert.match(lim[0].contexte, /aujourd'hui/);
});

test("boite : cours manquants et mise à jour nocturne en retard, urgence 3", () => {
  const pos = [
    { id: "a", name: "ETF Monde", mode: "market", owner: "p1", status: "actif", qty: 10, price: null, priceDate: null },
    { id: "b", name: "ETF Europe", mode: "market", owner: "p1", status: "actif", qty: 10, price: 100, priceDate: "2026-10-09" },
    { id: "c", name: "Clôturé", mode: "market", owner: "p1", status: "clôturé", qty: 1, price: null },
  ];
  const b = A.boite(vide({ positions: pos, status: { lastRun: "2026-10-05T20:30:00.000Z", missingPrices: 0 } }), TODAY, { Rules: fauxRules([], []) });
  assert.deepEqual(b.map(x => [x.type, x.urgence]), [["cours", 3], ["cours", 3]]);
  assert.ok(b.some(x => x.titre === "1 cours manquant" && /ETF Monde/.test(x.contexte)), b.map(x => x.titre).join(" | "));
  assert.ok(b.some(x => /Mise à jour nocturne en retard/.test(x.titre) && /5 oct\. 2026/.test(sp(x.contexte))));
  assert.ok(b.every(x => x.action.route === "patrimoine/placements"));
  const ok = A.boite(vide({ positions: pos.slice(1), status: { lastRun: "2026-10-09T20:30:00.000Z", missingPrices: 0 } }), TODAY, { Rules: fauxRules([], []) });
  assert.deepEqual(ok, []);
  const m = A.boite(vide({ status: { lastRun: "2026-10-09T20:30:00.000Z", missingPrices: 3 } }), TODAY, { Rules: fauxRules([], []) });
  assert.deepEqual(m.map(x => x.titre), ["3 cours manquants"]);
});

test("boite : tri par urgence puis date, tous types mêlés", () => {
  const S = vide({
    propositions: [P("a", "l1", "budget", { creeLe: "2026-10-09T08:00:00.000Z" })],
    memoire: [M("m", "a_suivre", { echeance: "2026-10-02" })],
    config: { milestones: [{ title: "Bientôt", date: "2026-10-12" }, { title: "Plus tard", date: "2026-11-01" }] },
    status: { lastRun: "2026-10-01T20:00:00.000Z", missingPrices: 0 },
  });
  const R = fauxRules([{ level: "crit", title: "Urgent", text: "x", rule: {} }, { level: "warn", title: "Attention", text: "y", rule: {} }], []);
  const b = A.boite(S, TODAY, { Rules: R });
  assert.deepEqual(b.map(x => x.urgence), [...b.map(x => x.urgence)].sort((x, y) => x - y));
  assert.deepEqual(b.map(x => x.titre).slice(0, 2), ["Claude propose 1 changement", "Urgent"], "à urgence égale, la date la plus ancienne d'abord");
  const u2 = b.filter(x => x.urgence === 2).map(x => x.type);
  assert.deepEqual(u2, ["a_suivre", "alerte", "echeance"], "date croissante : rappel échu, alerte du jour, échéance à venir");
  for (const x of b) {
    assert.ok([1, 2, 3].includes(x.urgence));
    assert.ok(typeof x.titre === "string" && x.titre && typeof x.contexte === "string");
    assert.ok(x.action && x.action.label && (x.action.route || x.action.url));
  }
});

test("boite : sur la démo, la revue du mois prête, un lot de 5 propositions, le point SCPI à reprendre, les alertes des règles, les banques", () => {
  const S = demoS();
  const b = A.boite(S, jourLocal(), DEPS);
  const t = b.map(x => x.titre);
  // Urgence 1 : la revue (prête depuis le 1er du mois, donc la plus ancienne, sauf le 1er où elle passe après), les propositions,
  // puis l'avis à relire.
  const u1 = b.filter(x => x.urgence === 1 && x.type !== "banque").map(x => x.titre);
  assert.deepEqual(u1.filter(x => x !== "Ta revue du mois est prête : 2 questions"), ["Claude propose 5 changements", "1 entrée du journal à relire"], t.join(" | "));
  // Banques connectées (BQ1) : Néo Courtage demande une authentification forte (urgence 1), un compte à rattacher (urgence 2).
  assert.deepEqual(b.filter(x => x.type === "banque").map(x => [x.urgence, x.titre]), [[1, "Ta banque Néo Courtage demande une reconnexion"], [2, "1 compte à rattacher"]]);
  assert.ok(u1.includes("Ta revue du mois est prête : 2 questions"), t.join(" | "));
  assert.equal(b.filter(x => x.type === "proposition").length, 1);
  assert.equal(b.filter(x => x.type === "routine").length, 1);
  assert.ok(b.some(x => x.type === "a_suivre" && /SCPI/.test(x.titre)), t.join(" | "));
  assert.ok(b.some(x => x.type === "alerte" && /Seuil de cours touché|proche de son seuil/.test(x.titre)), t.join(" | "));
  assert.ok(!b.some(x => x.type === "echeance"), "l'échéance de la démo est à 40 jours");
  assert.ok(!b.some(x => x.type === "cours"));
  const n = Rules.evaluate(S.config.rules, { positions: S.positions, config: S.config, scope: "foyer", people: S.people, today: jourLocal(), status: S.status }).length;
  assert.ok(b.filter(x => x.type === "alerte").length >= n);
});

/* ------------------------------------------------------------------ journal (CK2) ------------------------------------------------------------------ */

const E = (id, type, statut, o) => Object.assign({ id, type, titre: "Entrée " + id, synthese: "Synthèse " + id, raisonnement: null, options: [], statut, dateDecision: null, revueLe: null,
  liens: {}, etat: { date: "2026-09-01", patrimoine_net: 1 }, source: "Claude", historique: [], creeLe: "2026-10-08T10:00:00.000Z", majLe: "2026-10-08T10:00:00.000Z" }, o);

test("boite : entrées du journal à relire → un élément « N entrées du journal à relire », urgence 1, vers Agent › Journal", () => {
  const S = vide({ journal: [
    E("a", "avis", "a_relire", { titre: "Avis <b>LDDS</b>", creeLe: "2026-10-09T08:00:00.000Z" }),
    E("b", "decision", "a_relire", { titre: "Décision PEA", creeLe: "2026-10-07T08:00:00.000Z" }),
    E("c", "decision", "actif"), E("d", "hypothese", "archive"),
  ] });
  const b = A.boite(S, TODAY, { Rules: fauxRules([], []) });
  assert.equal(b.length, 1);
  const x = b[0];
  assert.equal(x.type, "journal"); assert.equal(x.urgence, 1);
  assert.equal(x.titre, "2 entrées du journal à relire");
  assert.deepEqual(J(x.action), { label: "Relire", route: "agent/journal" });
  assert.match(x.contexte, /Avis <b>LDDS<\/b>/, "texte brut : l'échappement se fait au rendu");
  assert.match(x.contexte, /Décision PEA/);
  assert.equal(x.date, "2026-10-09");
  const un = A.boite(vide({ journal: [E("a", "avis", "a_relire")] }), TODAY, { Rules: fauxRules([], []) });
  assert.equal(un[0].titre, "1 entrée du journal à relire");
  assert.deepEqual(J(un[0].action), { label: "Relire", route: "agent/journal?entree=a" }, "une seule entrée : lien profond qui l'ouvre");
  // nombre exact du store (S.journalARelire), au-delà des entrées lues ; plusieurs : la liste (filtre « À relire »)
  const exact = A.boite(vide({ journal: [E("a", "avis", "a_relire")], journalARelire: 7 }), TODAY, { Rules: fauxRules([], []) });
  assert.equal(exact[0].titre, "7 entrées du journal à relire");
  assert.deepEqual(J(exact[0].action), { label: "Relire", route: "agent/journal" });
  const horsLecture = A.boite(vide({ journal: [], journalARelire: 1 }), TODAY, { Rules: fauxRules([], []) });
  assert.equal(horsLecture[0].titre, "1 entrée du journal à relire");
  assert.equal(horsLecture[0].contexte, "Confirme ou corrige ce que l'agent a noté.");
  assert.equal(horsLecture[0].action.route, "agent/journal", "entrée non lue : la liste");
  assert.deepEqual(A.boite(vide({ journal: [E("a", "avis", "a_relire")], journalARelire: 0 }), TODAY, { Rules: fauxRules([], []) }), [], "compte exact à 0 : rien");
  assert.deepEqual(A.boite(vide({ journal: [E("c", "decision", "actif")] }), TODAY, { Rules: fauxRules([], []) }), [], "rien à relire");
  assert.deepEqual(A.boite(vide({ journal: undefined }), TODAY, { Rules: fauxRules([], []) }), [], "journal absent (store ancien) : rien ne casse");
  // à urgence et date égales, les propositions passent avant le journal
  const m = A.boite(vide({ propositions: [P("p", "l1", "budget", { creeLe: "2026-10-09T09:00:00.000Z" })], journal: [E("a", "avis", "a_relire", { creeLe: "2026-10-09T08:00:00.000Z" })] }), TODAY, { Rules: fauxRules([], []) });
  assert.deepEqual(m.map(y => y.type), ["proposition", "journal"]);
  const h = A.boiteHtml(b, UI || { voirPlus: (l, n, r) => l.map(r).join("") });
  assert.match(h, /data-type="journal"/);
  assert.match(h, /href="#agent\/journal" data-goto="agent\/journal"/);
  assert.doesNotMatch(h, /<b>LDDS/);
});

/* ------------------------------------------------------------------ revue mensuelle (RT1) ------------------------------------------------------------------ */

const Q = (question, o) => Object.assign({ question, pourquoi: null, champ: null }, o);
const RT = o => Object.assign({ type: "revue_mensuelle", jour: 1, active: true, consentementJournal: true, dernierPassage: "2026-10-01T06:12:00.000Z",
  dernierClient: "Claude", prochainPassage: "2026-11-01", questions: [], synthese: null }, o);
const sansRegles = { Rules: fauxRules([], []) };
const routine = (S, today) => A.boite(S, today || TODAY, sansRegles).filter(x => x.type === "routine");

test("boite : revue prête → « Ta revue du mois est prête : N questions », urgence 1, première question en contexte, « Répondre avec Claude »", () => {
  const qs = [Q("As-tu fait un versement <b>exceptionnel</b> ce mois-ci ?", { pourquoi: "Le PEA n'a pas bougé.", champ: "mouvement" }), Q("Ton salaire a-t-il changé ?")];
  const b = routine(vide({ routines: [RT({ questions: qs })] }));
  assert.equal(b.length, 1);
  const x = b[0];
  assert.equal(x.urgence, 1);
  assert.equal(x.titre, "Ta revue du mois est prête : 2 questions");
  assert.equal(x.contexte, "As-tu fait un versement <b>exceptionnel</b> ce mois-ci ?", "texte brut : l'échappement se fait au rendu");
  assert.equal(x.date, "2026-10-01", "prête depuis le passage de Claude");
  assert.equal(x.action.label, "Répondre avec Claude");
  // URL préremplie : le nombre de questions seulement (leur texte vient d'une exécution planifiée de l'agent ; demarrer_routine les fournit)
  assert.equal(x.action.url, A.urlClaude(ClaudePrompts.phrase("routine", "2 questions en attente")));
  assert.equal(x.action.url, A.urlClaude(RoutineEtat.phraseRoutine(qs)), "même phrase qu'Agent › Connexion");
  const q = decodeURIComponent(x.action.url.split("?q=")[1]);
  assert.match(q, /questions de ma revue mensuelle \(demarrer_routine, puis le formulaire, puis questions_routine\)\. Concerne : 2 questions en attente\./);
  assert.doesNotMatch(q, /versement|salaire/i, "aucun texte de question dans l'URL");
  assert.equal(routine(vide({ routines: [RT({ questions: [Q("Une seule question ?")] })] }))[0].titre, "Ta revue du mois est prête : 1 question");
  // questions vides ignorées ; aucune question → rien (ni prête ni en retard)
  assert.deepEqual(routine(vide({ routines: [RT({ questions: [Q("  "), null] })] })), []);
});

test("boite : revue en retard (prioritaire sur « prête ») → urgence 2, « Lancer ma revue avec Claude » (phrase revue) ; « due aujourd'hui » à 0 jour", () => {
  const S = vide({ routines: [RT({ prochainPassage: "2026-10-01", dernierPassage: "2026-09-01T06:00:00.000Z" })] });
  const b = routine(S);
  assert.equal(b.length, 1);
  assert.equal(b[0].urgence, 2);
  assert.equal(b[0].titre, "Revue mensuelle en retard de 9 jours");
  assert.equal(b[0].date, "2026-10-01");
  assert.match(b[0].contexte, /^Prévue le 1 oct\. 2026 : Claude fait le point du mois et prépare les questions à te poser\.$/);
  assert.deepEqual(J(b[0].action), { label: "Lancer ma revue avec Claude", url: A.urlClaude(ClaudePrompts.phrase("revue")) });
  assert.equal(routine(S, "2026-10-02")[0].titre, "Revue mensuelle en retard de 1 jour");
  assert.equal(routine(S, "2026-10-01")[0].titre, "Revue mensuelle due aujourd'hui");
  assert.deepEqual(routine(S, "2026-09-30"), [], "pas encore due");
  // jamais passée : en retard aussi
  assert.equal(routine(vide({ routines: [RT({ prochainPassage: "2026-10-05", dernierPassage: null })] }))[0].titre, "Revue mensuelle en retard de 5 jours");
  // en retard avec des questions du mois précédent : un seul élément, le retard
  const r = routine(vide({ routines: [RT({ prochainPassage: "2026-10-01", dernierPassage: "2026-09-01T06:00:00.000Z", questions: [Q("Ancienne question ?")] })] }));
  assert.equal(r.length, 1);
  assert.equal(r[0].titre, "Revue mensuelle en retard de 9 jours");
  assert.match(r[0].contexte, /1 question du mois précédent attend encore ta réponse\.$/);
  const r2 = routine(vide({ routines: [RT({ prochainPassage: "2026-10-01", dernierPassage: null, questions: [Q("Une ?"), Q("Deux ?")] })] }));
  assert.match(r2[0].contexte, /2 questions du mois précédent attendent encore ta réponse\.$/);
  // passée le jour prévu ou après : plus en retard
  assert.deepEqual(routine(vide({ routines: [RT({ prochainPassage: "2026-10-01", dernierPassage: "2026-10-01T09:00:00.000Z" })] })), []);
});

test("boite : date du passage lue à Paris (dernier_passage::date) — passage le 1er à 0 h 30 heure de Paris = 31 au soir en UTC", () => {
  const S = vide({ routines: [RT({ prochainPassage: "2026-11-01", dernierPassage: "2026-10-31T23:30:00.000Z", questions: [Q("Question ?")] })] });
  const b = routine(S, "2026-11-05");
  assert.equal(b.length, 1);
  assert.equal(b[0].titre, "Ta revue du mois est prête : 1 question", "passée le 1er novembre à Paris : pas en retard");
  assert.equal(b[0].date, "2026-11-01");
  assert.equal(A.etatRevue(S, "2026-11-05").code, "prete");
});

test("boite : revue en pause → rien, même en retard ou avec des questions", () => {
  assert.deepEqual(routine(vide({ routines: [RT({ active: false, prochainPassage: "2026-09-01", dernierPassage: null, questions: [Q("Question ?")] })] })), []);
  assert.equal(A.etatRevue(vide({ routines: [RT({ active: false })] }), TODAY).code, "pause");
});

test("boite : aucune revue → « Active ta revue mensuelle » (urgence 3, Agent › Connexion), seulement si la base est là et la table lue", () => {
  const b = routine(vide({ routines: [], routinesLues: true }));
  assert.equal(b.length, 1);
  assert.equal(b[0].urgence, 3);
  assert.equal(b[0].titre, "Active ta revue mensuelle");
  assert.deepEqual(J(b[0].action), { label: "Voir comment", route: "agent/connexion" });
  assert.match(b[0].contexte, /Claude fait le point sur ton patrimoine/);
  assert.deepEqual(routine(vide({ routines: [], routinesLues: false })), [], "table pas encore lue (migration absente, lecture en échec)");
  assert.deepEqual(routine(vide({ routines: [] })), [], "store ancien, sans routinesLues");
  assert.deepEqual(routine(vide({ routines: undefined, routinesLues: true })), [{ ...b[0] }].map(J), "routines absent, table lue : à activer");
  assert.deepEqual(routine(vide({ dbOk: false, routines: [], routinesLues: true })), [], "sans base : rien");
  // une autre routine (extension future) ne compte pas comme la revue mensuelle
  assert.equal(routine(vide({ routines: [RT({ type: "veille_hebdo" })], routinesLues: true }))[0].titre, "Active ta revue mensuelle");
});

test("boite : revue ni prête ni en retard → rien ; état « a_jour »", () => {
  const S = vide({ routines: [RT()], routinesLues: true });
  assert.deepEqual(routine(S), []);
  assert.equal(A.etatRevue(S, TODAY).code, "a_jour");
  assert.equal(A.etatRevue(null, TODAY).code, "inconnu");
  // une seule règle : celle de RoutineEtat (routine-etat.js), avec S.routinesLues et S.dbOk
  for (const T of [vide({ routines: [RT({ prochainPassage: "2026-10-01", dernierPassage: null })] }), vide({ routines: [], routinesLues: true }), vide({ routines: [] })])
    assert.deepEqual(J(A.etatRevue(T, TODAY)), J(RoutineEtat.etat(T.routines, TODAY, { lues: T.routinesLues === true, dbOk: T.dbOk === true })));
});

test("boite : la revue est évaluée au jour de Paris (deps.aujRevue = RoutineEtat.aujParis()), le reste au jour local", () => {
  const S = vide({ routines: [RT({ prochainPassage: "2026-10-11", dernierPassage: null })] });
  assert.deepEqual(routine(S, "2026-10-10"), [], "jour local : pas encore due");
  const b = A.boite(S, "2026-10-10", { Rules: fauxRules([], []), aujRevue: "2026-10-11" }).filter(x => x.type === "routine");
  assert.equal(b[0].titre, "Revue mensuelle due aujourd'hui", "minuit passé à Paris : due");
  assert.match(js, /items = boite\(S, jour\(\), \{ aujRevue: RE\(\)\.aujParis\(\) \}\)/, "la vue passe la date de Paris");
});

test("boiteHtml : élément « routine » (pictogramme, libellé pour lecteur d'écran, lien Claude en nouvel onglet), texte échappé ; tutoiement", () => {
  const items = A.boite(vide({ routines: [RT({ questions: [Q("Versement <b>PEA</b> ?")] })] }), TODAY, sansRegles)
    .concat(A.boite(vide({ routines: [RT({ prochainPassage: "2026-10-01", dernierPassage: null })] }), TODAY, sansRegles))
    .concat(A.boite(vide({ routines: [], routinesLues: true }), TODAY, sansRegles));
  assert.deepEqual(items.map(x => x.type), ["routine", "routine", "routine"]);
  const h = A.boiteHtml(items, UI || { voirPlus: (l, n, r) => l.map(r).join("") });
  assert.equal((h.match(/data-type="routine"/g) || []).length, 3);
  assert.match(h, /<span class="ui-sr">Revue mensuelle, urgent : <\/span>Ta revue du mois est prête : 1 question/);
  assert.match(h, /Revue mensuelle, à traiter : <\/span>Revue mensuelle en retard de 9 jours/);
  assert.match(h, /Revue mensuelle, à surveiller : <\/span>Active ta revue mensuelle/);
  assert.match(h, /href="https:\/\/claude\.ai\/new\?q=[^"]+" target="_blank" rel="noopener noreferrer">Répondre avec Claude/);
  assert.match(h, />Lancer ma revue avec Claude</);
  assert.match(h, /href="#agent\/connexion" data-goto="agent\/connexion">Voir comment</);
  assert.match(h, /Versement &lt;b&gt;PEA&lt;\/b&gt; \?/);
  assert.doesNotMatch(h, /<b>PEA/);
  assert.match(h, /<svg class="aj-ico"[^>]*><path d="M20 12a8 8/, "pictogramme de la revue");
  for (const x of items) assert.doesNotMatch(x.titre + " " + x.contexte + " " + x.action.label, VOUVOIEMENT);
  assert.match(css, /\.aj-it\[data-type="routine"\] \.aj-pic/);
});

test("reperesJournal : décisions non abandonnées et datées, triées par date", () => {
  const j = [
    E("a", "decision", "actif", { dateDecision: "2026-08-10" }),
    E("b", "decision", "abandonne", { dateDecision: "2026-08-20" }),
    E("c", "decision", "realise", { dateDecision: "2026-07-01" }),
    E("d", "avis", "actif", { dateDecision: "2026-08-15" }),
    E("e", "decision", "actif", { dateDecision: null }),
    E("f", "decision", "a_relire", { dateDecision: "2026-09-01" }),
    E("g", "decision", "archive", { dateDecision: "pas une date" }),
  ];
  assert.deepEqual(J(A.reperesJournal(j)).map(r => [r.id, r.date]), [["c", "2026-07-01"], ["a", "2026-08-10"], ["f", "2026-09-01"]]);
  const r = A.reperesJournal(j)[0];
  for (const k of ["id", "date", "titre", "synthese", "statut"]) assert.ok(k in r, k);
  assert.deepEqual(A.reperesJournal(null), []);
});

test("graphe : repères verticaux des décisions dans la période, titre au survol, focalisables ; hors période ignorés", () => {
  const S = Object.assign(demoS(), { journal: [] }), t = jourLocal();
  const f = A.frise(S, t, { id: "1a", granularite: "mois" }, DEPS);
  assert.deepEqual(J(f.reperes), [], "aucune décision : aucun repère");
  const x0 = f.points[0].date, x1 = f.points[f.points.length - 1].date;
  const milieu = new Date((Date.parse(x0) + Date.parse(x1)) / 2).toISOString().slice(0, 10);
  const avec = Object.assign({}, f, { reperes: [
    { id: "dec-1", date: milieu, titre: "PEA <script>", synthese: "s", statut: "actif" },
    { id: "dec-2", date: "1990-01-01", titre: "Trop ancienne", synthese: "s", statut: "actif" },
  ] });
  const svg = G.construire(avec, null, { scopeLabel: "du foyer", today: t }).svg;
  assert.equal((svg.match(/data-journal="/g) || []).length, 1, "seul le repère dans la période est dessiné");
  assert.match(svg, /data-journal="dec-1"[^>]*tabindex="0"[^>]*role="button"[^>]*aria-label="[^"]*PEA &lt;script&gt;/);
  assert.match(svg, /<title>[^<]*PEA &lt;script&gt;[^<]*<\/title>/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /^<svg[^>]*role="group"/, "graphique avec éléments interactifs : role group");
  assert.match(G.construire(f, null, { today: t }).svg, /^<svg[^>]*role="img"/, "sans repère : image");
  // la démo a une décision en cours dans l'année écoulée
  const fd = A.frise(demoS(), t, { id: "1a", granularite: "mois" }, DEPS);
  assert.equal(fd.reperes.length, 1);
  assert.match(G.construire(fd, null, { today: t }).svg, /data-journal="/);
});

test("repereDetail : panneau d'une décision (synthèse, date, statut) et lien vers Agent › Journal, texte échappé", () => {
  const d = A.repereDetail({ id: "x", date: "2026-08-10", titre: "Titre", synthese: PIEGE_J, statut: "actif" });
  assert.equal(d.titre, "Titre");
  assert.deepEqual(J(d.lien), { label: "Ouvrir dans le journal", href: "#agent/journal?entree=x" }, "lien profond : ouvre l'entrée");
  assert.equal(A.repereDetail({ id: "a b/é", titre: "T" }).lien.href, "#agent/journal?entree=a%20b%2F%C3%A9", "identifiant encodé");
  assert.doesNotMatch(d.contenu, /<img/);
  assert.match(d.contenu, /&lt;img/);
  assert.match(sp(d.contenu), /10 août 2026/);
  assert.match(d.contenu, /En cours/);
});
const PIEGE_J = '<img src=x onerror="alert(1)">';

/* ------------------------------------------------------------------ indicateurs ------------------------------------------------------------------ */

test("echeances : dates à venir triées (jalons, objectifs, points à suivre)", () => {
  const S = vide({
    config: { milestones: [{ title: "J", date: "2026-11-01" }, { title: "Passé", date: "2026-10-01" }] },
    objectifs: [{ id: "o", nom: "Voyage", cible: 1000, dateCible: "2026-10-20" }],
    memoire: [M("m", "a_suivre", { echeance: "2026-12-01" }), M("x", "a_suivre", { echeance: "2026-10-01" })],
  });
  const e = A.echeances(S, TODAY);
  assert.deepEqual(e.map(x => [x.source, x.jours]), [["objectif", 10], ["jalon", 22], ["a_suivre", 52]]);
});

test("indicateurs : patrimoine net et variation sur la période, bonnes pratiques, objectifs, prochaine échéance (démo)", () => {
  const S = demoS(), t = jourLocal();
  const ind = A.indicateurs(S, t, { id: "1a", granularite: "mois" }, DEPS);
  const net = Calc.patrimoine(S.positions, S.profil, "foyer").net;
  assert.ok(Math.abs(ind.net.valeur - net) < 1e-6);
  assert.equal(typeof ind.net.variation, "number");
  assert.ok(ind.net.variation > 0, "le patrimoine de la démo progresse sur les photos");
  const pr = Pratiques.evaluer({ positions: S.positions, profil: S.profil, config: S.config, budget: S.budget, objectifs: S.objectifs, scope: "foyer", risque: S.risque, classes: S.classes, banque: S.banque, today: new Date() });
  assert.equal(ind.pratiques.total, pr.total, "même note qu'avec la banque (budget réel des comptes courants)");
  assert.equal(ind.pratiques.provisoire, pr.provisoire);
  assert.equal(ind.allocation.profil, null, "profil de risque de la démo jamais rempli");
  assert.equal(ind.objectifs.n, 3, "les trois objectifs de la démo");
  assert.equal(ind.echeance.prochaine.source, "jalon");
  assert.equal(ind.echeance.prochaine.titre, "Fin de la période d'essai de Sam");
});

test("indicateurs : écart d'allocation = somme des points hors fourchette du profil", () => {
  const S = Object.assign(demoS(), { risque: { profil: "prudent", reponses: {}, score: 10, date: TODAY } });
  const ind = A.indicateurs(S, TODAY, { id: "1a", granularite: "mois" }, DEPS);
  const ec = Risque.ecarts("prudent", Risque.allocationReelle(S.positions, "foyer", { surcharge: S.classes }));
  const pts = ec.reduce((a, e) => a + Math.abs(e.ecartPts), 0);
  assert.ok(pts > 0);
  assert.ok(Math.abs(ind.allocation.points - pts) < 1e-9);
  assert.equal(ind.allocation.profil, "Prudent");
  assert.ok(ind.allocation.hors.length > 0 && ind.allocation.hors.every(e => e.statut !== "dans"));
});

test("indicateurs : sans données, rien ne casse (valeurs nulles, pas d'échéance)", () => {
  const ind = A.indicateurs(vide(), TODAY, { id: "1a", granularite: "mois" }, DEPS);
  assert.equal(ind.net.vide, true);
  assert.equal(ind.echeance.prochaine, null);
  assert.equal(ind.allocation.profil, null);
});

test("frise : courbe du patrimoine net agrégée par Periodes (1 an au mois sur la démo)", () => {
  const S = demoS(), t = jourLocal();
  const f = A.frise(S, t, { id: "1a", granularite: "mois" }, DEPS);
  assert.equal(f.granularite, "mois");
  assert.equal(f.points.length, 4, "trois photos de fin de mois + le point du jour");
  assert.ok(f.points.every(p => p.cle && isFinite(p.valeur)));
  const svg = G.construire(f, null, { scopeLabel: "du foyer", today: t }).svg;
  assert.match(svg, /^<svg[^>]*role="(img|group)"[^>]*aria-label="[^"]+"/, "group quand des repères du journal sont dessinés");
  assert.match(svg, /<path /);
  const perso = A.frise(S, t, { id: "perso", du: "2000-01-01", au: t, granularite: "annee" }, DEPS);
  assert.equal(perso.granularite, "annee");
  assert.equal(G.construire(A.frise(vide(), TODAY, { id: "1a", granularite: "mois" }, DEPS), null, {}).svg, "", "un seul point : pas de courbe");
  assert.match(js, /Pas encore d'historique : Boussole prend chaque nuit une photo/, "message d'état vide de la vue");
});

/* ------------------------------------------------------------------ rendu ------------------------------------------------------------------ */

const PIEGE = '<img src=x onerror="alert(1)">';

test("rendu : 4 cartes (net, bonnes pratiques, objectifs, échéance), boîte de réception (5 puis « Voir plus »), état vide orienté agent, échappement", { skip: !HAS_UI && "web/src/ui.js pas encore là" }, () => {
  const S = demoS(), t = jourLocal();
  const ind = A.indicateurs(S, t, { id: "1a", granularite: "mois" }, DEPS);
  const c = A.cartes(ind, UI, { id: "1a", granularite: "mois" });
  assert.equal((c.match(/data-ui-carte="/g) || []).length, 4);
  for (const id of ["net", "pratiques", "objectifs", "echeance"]) assert.match(c, new RegExp('data-ui-carte="' + id + '"'));
  assert.doesNotMatch(c, /data-ui-carte="allocation"|Écart au profil de risque/, "l'écart au profil de risque a quitté le bandeau");
  assert.equal((c.match(/<button type="button" class="aj-k /g) || []).length, 4, "de vrais boutons");
  const b = A.boite(S, t, DEPS);
  assert.ok(b.length > 5, "la démo a plus de 5 éléments à traiter");
  const h = A.boiteHtml(b, UI);
  assert.match(h, /data-ui-voirplus/);
  assert.match(h, /Voir plus/);
  assert.match(h, /href="#agent\/propositions" data-goto="agent\/propositions"/);
  assert.match(h, /href="https:\/\/claude\.ai\/new\?q=[^"]+" target="_blank" rel="noopener noreferrer"/);
  const v = A.boiteHtml([], UI);
  assert.match(v, /Rien à traiter\./);
  assert.match(v, /Faire le point avec Claude/);
  assert.match(v, /claude\.ai\/new\?q=/);
  // échappement : titre, contexte, libellé, route ; une url qui n'est pas en https:// n'est pas rendue
  const piege = [{ type: "alerte", urgence: 1, date: TODAY, titre: PIEGE, contexte: PIEGE, action: { label: PIEGE, route: 'x" onclick="y' } },
    { type: "a_suivre", urgence: 2, date: TODAY, titre: "t", contexte: "c", action: { label: "Reprendre", url: "javascript:alert(1)" } }];
  const hp = A.boiteHtml(piege, UI);
  assert.doesNotMatch(hp, /<img/);
  assert.doesNotMatch(hp, /onclick="y/);
  assert.doesNotMatch(hp, /javascript:/);
  const cp = A.cartes({ net: { vide: false, valeur: 1, variation: 0 }, pratiques: { total: null }, objectifs: A.objectifs({}, TODAY, DEPS), echeance: { prochaine: { titre: PIEGE, date: TODAY, jours: 0, source: "jalon" }, liste: [] } }, UI, { id: "1a" });
  assert.doesNotMatch(cp, /<img/);
});

test("detail : 2 à 4 lignes et un lien vers la page complète pour chaque carte, texte échappé", () => {
  const S = demoS(), t = jourLocal();
  const ind = A.indicateurs(S, t, { id: "1a", granularite: "mois" }, DEPS);
  const routes = { net: "patrimoine/comptes", pratiques: "pilotage/sante", objectifs: "patrimoine/objectifs", echeance: "patrimoine/objectifs" };
  for (const [id, r] of Object.entries(routes)) {
    const d = A.detail(id, ind, { id: "1a", granularite: "mois" });
    assert.ok(d.titre, id);
    const n = ((id === "net" || id === "objectifs" ? d.contenu.split('<details')[0] : d.contenu).match(/<li/g) || []).length;
    assert.ok(n >= 2 && n <= (id === "net" ? 6 : 4), id + " : " + n + " lignes");
    assert.equal(d.lien.href, "#" + r, id + " → " + r);
    assert.ok(d.lien.label);
    assert.ok(d.question && d.question.length > 20, id + " : question pour « Demander à Claude »");
  }
  const ip = A.indicateurs(vide({ config: { milestones: [{ title: PIEGE, date: "2026-10-12", text: PIEGE }] } }), TODAY, { id: "1a" }, DEPS);
  assert.doesNotMatch(A.detail("echeance", ip, { id: "1a" }).contenu, /<img/);
  const e = A.detail("echeance", A.indicateurs(vide(), TODAY, { id: "1a" }, DEPS), { id: "1a" });
  assert.deepEqual(e.lien, { label: "Voir les objectifs", href: "#patrimoine/objectifs" });
  assert.match(e.contenu, /dans Objectifs/);
  assert.doesNotMatch(js, /Budget et objectifs|budget et objectifs/);
});

test("detail (Patrimoine net) : « Ce que je possède, ce que je dois » — mêmes calculs que l'ancienne carte du Bilan (BilanCalc.composition)", () => {
  const nb = x => String(x).replace(/[\u00a0\u202f]/g, " ");
  const S = demoS(), t = jourLocal();
  const ind = A.indicateurs(S, t, { id: "1a", granularite: "mois" }, DEPS);
  const comp = BilanCalc.composition(S.positions, S.profil, "foyer"), pat = Calc.patrimoine(S.positions, S.profil, "foyer");
  assert.deepEqual(J(ind.net.composition), J(comp));
  assert.equal(ind.net.usage, pat.usage); assert.equal(ind.net.entreprise, pat.entreprise);
  const d = A.detail("net", ind, { id: "1a", granularite: "mois" });
  const c = nb(d.contenu).replace(/&#39;/g, "'");
  assert.match(c, /Ce que je possède, ce que je dois/);
  const resume = c.split("<details")[0];
  const lignes = [...resume.matchAll(/<li><span class="aj-det-l">([^<]+)<\/span><span class="aj-det-v">([^<]+)<\/span><\/li>/g)].map(m => [m[1], m[2]]);
  const e = v => nb(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.abs(Math.round(v)))) + " €";
  assert.deepEqual(lignes, [["Placements financiers", e(pat.financier)], ["Immobilier", e(pat.immobilier)], ["Biens d'usage (voiture, meubles…)", e(pat.usage)],
    ["Dettes", "−" + e(pat.dettes)], ["Patrimoine net", e(pat.net)]], "parts d'entreprise absentes de la démo : pas de ligne");
  // détail ligne par ligne en accordéon fermé : enveloppes, biens, autres biens, dettes
  assert.match(c, /<details class="ui-acc"><summary class="ui-acc-titre"><span>Le détail, ligne par ligne<\/span>/);
  for (const l of comp.actifs[0].lignes.concat(comp.actifs[1].lignes, comp.dettes.lignes)) assert.ok(c.includes(nb(l.label)), l.label);
  assert.ok(c.includes("Voiture, meubles…"));
  // parts d'entreprise et échappement des noms
  const S2 = vide({ profil: { foyer: { adultes: 1 }, biens: [{ nom: PIEGE, valeur: 1000, part_p1: 100, crd: 0 }], credits: [], autres: { p1: { usage: 0, entreprise: 5000 } } } });
  const d2 = A.detail("net", A.indicateurs(S2, TODAY, { id: "1a" }, DEPS), { id: "1a" });
  assert.match(nb(d2.contenu), /Parts d(&#39;|')entreprise<\/span><span class="aj-det-v">5 000 €/);
  assert.doesNotMatch(d2.contenu, /<img/);
  assert.doesNotMatch(d2.contenu.split("<details")[0], /Biens d/, "pas de biens d'usage : pas de ligne");
});

/* --------------------------------------------------------- module complet en vm (démo) --------------------------------------------------------- */

function faux() {
  const els = new Map();
  const el = id => {
    if (!els.has(id)) els.set(id, { id, innerHTML: "", textContent: "", hidden: false, dataset: {}, attrs: {},
      setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener() {},
      querySelector: () => null, querySelectorAll: () => [], closest: () => null, focus() {} });
    return els.get(id);
  };
  const root = Object.assign(el("view-aujourdhui"), { querySelector: s => (/^#[\w-]+$/.test(s) ? el(s.slice(1)) : null) });
  return { root, els };
}

test("module : monté et rendu en vm sur l'état de démo, headline = nombre d'éléments de la boîte", () => {
  const src = f => readFileSync("web/src/" + f, "utf8");
  const reg = {};
  const store = new Map();
  const ctx = { console, Intl, Date, Math, JSON, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { readyState: "complete", addEventListener() {}, activeElement: null, body: {} },
    App: { register: (n, api) => { reg[n] = api; }, refreshHeadlines() {} },
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ["calc.js", "serie-net.js", "rules.js", "plan.js", "bilan-calc.js", "periodes.js", "marche.js", "risque.js", "pratiques.js", "claude-prompts.js", "routine-etat.js", "banque-etat.js", "reperes.js", "historique.js", "graphe-patrimoine.js", "objectifs-view.js"]) vm.runInContext(src(f), ctx, { filename: f });
  if (HAS_UI) vm.runInContext(src("ui.js"), ctx, { filename: "ui.js" });
  else ctx.UI = { esc: s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    carte: o => '<button type="button" class="ui-carte" data-ui-carte="' + o.id + '">' + ctx.UI.esc(o.titre) + "</button>",
    voirPlus: (l, n, r) => l.slice(0, n).map(r).join("") + (l.length > n ? '<button type="button" data-ui-voirplus>Voir plus (' + (l.length - n) + ")</button>" : ""),
    demanderAClaude: (q, lib) => '<a class="ui-claude" href="https://claude.ai/new?q=' + encodeURIComponent(q) + '" target="_blank" rel="noopener noreferrer">' + (lib || "Demander à Claude") + "</a>",
    periode() {}, brancher() {}, panneau: { ouvrir() { return {}; }, fermer() {}, ouvert: () => false } };
  // UI.periode / UI.brancher touchent le DOM : remplacés par des fonctions neutres dans ce faux navigateur.
  ctx.UI = Object.assign({}, ctx.UI, { periode() {}, brancher() {} });
  vm.runInContext(js, ctx, { filename: "aujourdhui.js" });
  const api = reg.aujourdhui;
  assert.ok(api, "module enregistré");
  const { root, els } = faux();
  api.mount(root);
  const S = demoS();
  api.update(S, true);
  const b = A.boite(S, jourLocal(), DEPS);
  assert.equal(api.headline(), String(b.length));
  assert.equal((els.get("ajCartes").innerHTML.match(/data-ui-carte="/g) || []).length, 4);
  assert.match(els.get("ajBoite").innerHTML, /Claude propose 5 changements/);
  assert.match(els.get("ajFrise").innerHTML, /<svg/);
  assert.match(els.get("ajFrise").innerHTML, /data-journal="/, "repère de la décision de la démo sur la frise");
  assert.match(els.get("ajBoite").innerHTML, /entrée du journal à relire/);
  api.update(vide(), false);
  api.show();
  assert.equal(api.headline(), "");
  assert.match(els.get("ajBoite").innerHTML, /Rien à traiter\./);
});

/* ------------------------------------------------ revue finale CK1 ------------------------------------------------ */

test("delai : jours jusqu'à 60, puis mois jusqu'à 24 mois, puis années ; forme courte « j » pour les cartes", () => {
  assert.equal(A.delai(0), "aujourd'hui");
  assert.equal(A.delai(1), "demain");
  assert.equal(A.delai(2), "dans 2 jours");
  assert.equal(A.delai(60), "dans 60 jours");
  assert.equal(A.delai(45, true), "dans 45 j");
  assert.equal(A.delai(61), "dans 2 mois");
  assert.equal(A.delai(200), "dans 7 mois");
  assert.equal(A.delai(730), "dans 24 mois");
  assert.equal(A.delai(760), "dans 2 ans");
  assert.equal(A.delai(3650), "dans 10 ans");
  assert.equal(A.delai(-3), "aujourd'hui", "jamais négatif");
  // dans les cartes et le panneau des échéances
  const S = vide({ objectifs: [{ id: "o", nom: "Retraite", cible: 1, dateCible: "2046-10-10" }] });
  const ind = A.indicateurs(S, TODAY, { id: "1a" }, DEPS);
  assert.match(A.cartes(ind, UI, { id: "1a" }), /data-aj-count="20" data-aj-fmt="int">20<\/span><span class="aj-k-unit"> ans<\/span>/, "compte à rebours : 20 ans");
  assert.deepEqual(A.compteARebours(0), { mot: "Aujourd'hui" }); assert.deepEqual(A.compteARebours(1), { mot: "Demain" });
  assert.deepEqual(A.compteARebours(12), { n: 12, unite: "jours" }); assert.deepEqual(A.compteARebours(200), { n: 7, unite: "mois" }); assert.deepEqual(A.compteARebours(-4), { mot: "Aujourd'hui" });
  assert.match(A.detail("echeance", ind, { id: "1a" }).contenu, /dans 20 ans/);
});

test("premiereDate : date de la première photo (pour la période « Tout »)", () => {
  assert.equal(A.premiereDate([{ date: "2026-03-01" }, { date: "2025-11-15T20:00:00Z" }, { date: "x" }, null]), "2025-11-15");
  assert.equal(A.premiereDate([]), undefined);
  assert.equal(A.premiereDate(null), undefined);
  assert.match(js, /premiere: S \? premiereDate\(S\.snapshots\) : undefined/, "passée à UI.periode au montage");
  assert.match(js, /ctlPeriode\.premiere\(/, "mise à jour quand les photos arrivent");
});

test("boite : contrôles intégrés reconnus par leur kind (rules.js), pas par leur texte", () => {
  const config = { milestones: [{ title: "Fin de période d'essai", date: "2026-10-20", warnDays: 30 }], cushion: { mode: "amount", min: 999999 } };
  const S = vide({ config, status: { lastRun: "2026-10-01T20:00:00Z", alerts: [{ level: "warn", title: "Signal de la nuit", text: "x" }] } });
  const b = A.boite(S, TODAY, DEPS);
  const alertes = b.filter(x => x.type === "alerte").map(x => x.titre);
  assert.deepEqual(alertes.sort(), ["Matelas sous la cible", "Signal de la nuit"], "jalon et nuit en retard : déjà présents sous une autre forme");
  assert.ok(b.some(x => x.type === "echeance" && x.titre === "Fin de période d'essai"));
  assert.ok(b.some(x => x.type === "cours" && x.titre === "Mise à jour nocturne en retard"));
  assert.equal(b.find(x => x.titre === "Matelas sous la cible").action.route, "patrimoine/budget");
  // un texte qui ressemble à un jalon n'est plus filtré s'il n'en est pas un
  const R = fauxRules([], [{ level: "info", title: "Signal", text: "Le marché bouge (dans 3 jours)", kind: "agent" }]);
  assert.equal(A.boite(vide(), TODAY, { Rules: R }).filter(x => x.type === "alerte").length, 1);
  assert.doesNotMatch(js, /dans \\d\+ jours\?/, "plus de reconnaissance par expression régulière");
});

test("boiteHtml : éléments de la boîte en <ul>/<li>", { skip: !HAS_UI && "web/src/ui.js pas encore là" }, () => {
  const b = A.boite(demoS(), jourLocal(), DEPS);
  const h = A.boiteHtml(b, UI);
  assert.match(h, /<ul class="ui-voirplus-liste"><li class="aj-it /);
  assert.match(h, /<ul class="ui-voirplus-liste ui-voirplus-reste"[^>]*hidden><li class="aj-it /);
  assert.equal((h.match(/<li class="aj-it /g) || []).length, b.length);
  assert.doesNotMatch(h, /<div class="aj-it /);
});

test("aujourdhui.html : nombre d'éléments réservé aux lecteurs d'écran (règle 9)", () => {
  assert.match(html, /<span class="ui-sr" id="ajBoiteN" role="status" aria-live="polite"><\/span>/);
});

test("module : indicateurs calculés seulement quand la vue est visible ; DOM non réécrit quand rien n'a changé ; headline ne dépend que de la boîte", () => {
  const src = f => readFileSync("web/src/" + f, "utf8");
  const reg = {};
  const ctx = { console, Intl, Date, Math, JSON, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: "complete", addEventListener() {}, activeElement: null, body: {} },
    App: { register: (n, api) => { reg[n] = api; }, refreshHeadlines() {} } };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ["calc.js", "serie-net.js", "rules.js", "plan.js", "bilan-calc.js", "periodes.js", "marche.js", "risque.js", "pratiques.js", "claude-prompts.js", "routine-etat.js", "banque-etat.js", "reperes.js", "historique.js", "graphe-patrimoine.js", "objectifs-view.js"]) vm.runInContext(src(f), ctx, { filename: f });
  if (HAS_UI) vm.runInContext(src("ui.js"), ctx, { filename: "ui.js" });
  const premieres = [];
  ctx.UI = Object.assign({}, ctx.UI, { brancher() {}, periode: () => ({ valeur: () => null, premiere: d => premieres.push(d) }) });
  let evaluations = 0;
  const ev = ctx.Pratiques.evaluer;
  ctx.Pratiques.evaluer = (...a) => { evaluations++; return ev(...a); };
  vm.runInContext(js, ctx, { filename: "aujourdhui.js" });
  const api = reg.aujourdhui;
  const { root, els } = faux();
  api.mount(root);
  const S = demoS();
  api.update(S, false);
  assert.equal(evaluations, 0, "vue cachée : pas d'indicateurs");
  assert.equal(api.headline(), String(A.boite(S, jourLocal(), DEPS).length), "pastille à jour même vue cachée");
  assert.equal(premieres.pop(), A.premiereDate(S.snapshots), "première photo transmise au sélecteur de période");
  api.show();
  assert.equal(evaluations, 1, "calculés à l'affichage");
  api.show();
  assert.equal(evaluations, 1, "pas recalculés sans changement");
  // compte des écritures dans le DOM
  const ecritures = {};
  for (const id of ["ajCartes", "ajBoite", "ajFrise"]) {
    const el = els.get(id); let v = el.innerHTML; ecritures[id] = 0;
    Object.defineProperty(el, "innerHTML", { get: () => v, set: x => { v = x; ecritures[id]++; } });
  }
  api.update(S, true);
  api.update(J(S), true);
  assert.deepEqual(ecritures, { ajCartes: 0, ajBoite: 0, ajFrise: 0 }, "même contenu : rien n'est réécrit (focus et « Voir plus » préservés)");
  api.update(Object.assign(J(S), { propositions: [] }), true);
  assert.equal(ecritures.ajBoite, 1, "la boîte change : réécrite");
  assert.match(js, /function headline\(\) \{ return items\.length \? String\(items\.length\) : ""; \}/);
  // journal : l'avis confirmé sort de la boîte ; une décision renommée redessine la frise (signatures)
  const S2 = Object.assign(J(S), { propositions: [] });
  S2.journal.forEach(e => { if (e.statut === "a_relire") e.statut = "actif"; }); S2.journalARelire = 0;
  api.update(S2, true);
  assert.equal(ecritures.ajBoite, 2, "journal relu : boîte réécrite");
  assert.equal(ecritures.ajFrise, 0, "frise inchangée");
  const S3 = J(S2); S3.journal.find(e => e.type === "decision").titre = "Décision renommée";
  api.update(S3, true);
  assert.equal(ecritures.ajFrise, 1, "repère renommé : frise redessinée");
  assert.equal(ecritures.ajBoite, 2);
});

/* ------------------------------------------------ saisie par l'agent : tutoiement, revue, granularité ------------------------------------------------ */

/* Tutoiement : aucun « vous / votre / vos », textes des moteurs (rules.js, pratiques.js…) repris dans la boîte compris : plus aucune exception. */
const EXCEPTIONS_MOTEUR = [];
const VOUVOIEMENT = /\b(vous|votre|vos)\b/i;
const sansExceptions = t => EXCEPTIONS_MOTEUR.reduce((a, e) => a.split(e).join(""), String(t));
const questions = h => [...String(h).matchAll(/href="https:\/\/claude\.ai\/new\?q=([^"]*)"/g)].map(m => decodeURIComponent(m[1].replace(/&amp;/g, "&")));

test("tutoiement : aucun « vous / votre / vos » ni impératif au vouvoiement dans les textes du module et ses rendus", () => {
  assert.doesNotMatch(sansExceptions(js), VOUVOIEMENT);
  assert.doesNotMatch(sansExceptions(html), VOUVOIEMENT);
  assert.doesNotMatch(js, /Lancez|Répondez|Complétez|Confirmez|faites le point|élargissez|choisissez/);
  const S = demoS(), t = jourLocal(), per = { id: "1a" };
  const ind = A.indicateurs(S, t, per, DEPS);
  const vides = A.indicateurs(vide(), TODAY, per, DEPS);
  const evo = A.evolution(S, t, per, 5, DEPS);
  const rendus = [A.cartes(ind, UI, per), A.cartes(vides, UI, per), A.boiteHtml(A.boite(S, t, DEPS), UI), A.boiteHtml([], UI),
    G.construire(evo.passe, evo.futur, { today: t }).svg, G.legendeHtml(evo.passe, evo.futur), G.tableauHtml(evo.passe, evo.futur), G.calculHtml({ fut: evo.futur, rendements: evo.futur.rendements, parBloc: evo.futur.parBloc, versementSource: evo.futur.versementSource, deformee: true })]
    .concat(["net", "pratiques", "objectifs", "echeance"].flatMap(id => [A.detail(id, ind, per), A.detail(id, vides, per)].map(d => d.contenu + d.lien.label)));
  for (const r of rendus) assert.doesNotMatch(sansExceptions(r).replace(/&#39;/g, "'"), VOUVOIEMENT);
  assert.equal(A.boite(vide({ propositions: [P("p", "l", "budget")] }), TODAY, { Rules: fauxRules([], []) })[0].contexte, "Budget : rien n'est enregistré sans ton accord.");
  assert.match(A.cartes(vides, UI, per), /Lance ton bilan avec Claude/);
});

test("« Faire le point avec Claude » : revue du mois de l'agent (ClaudePrompts.phrase(\"revue\"))", () => {
  assert.equal(A.phraseRevue(), ClaudePrompts.phrase("revue"));
  const v = A.boiteHtml([], UI);
  assert.match(v, /<span>Faire le point avec Claude<\/span>/);
  assert.deepEqual(questions(v), [ClaudePrompts.phrase("revue")]);
  assert.match(v, /fais le point avec Claude/);
  // sans objectif : la carte oriente vers Claude (plus de formulaire dans l'app)
  const d = A.detail("objectifs", A.indicateurs(vide(), TODAY, { id: "1a" }, DEPS), { id: "1a" });
  assert.match(d.contenu, /Claude t&#39;aide à les définir/);
  assert.deepEqual(J(d.lien), { label: "Voir les objectifs", href: "#patrimoine/objectifs" });
});

test("boîte : « Voir plus » à clé fixe — même identifiant quand la liste change (le bloc déplié le reste)", () => {
  const S = demoS(), t = jourLocal();
  const b = A.boite(S, t, DEPS);
  const id = h => (h.match(/id="(ui-reste-[^"]+)"/) || [])[1];
  const h1 = A.boiteHtml(b, UI), h2 = A.boiteHtml(b.slice(1).concat(b.slice(0, 1)), UI);
  assert.ok(id(h1));
  assert.equal(id(h1), id(h2), "identifiant indépendant du contenu");
  assert.equal(A.boiteHtml(b, UI), h1, "deux rendus identiques : même HTML (signature fiable)");
});

test("période : la granularité n'est relue et enregistrée que si l'utilisateur l'a choisie (sinon automatique)", () => {
  assert.deepEqual(A.lirePeriode(null), { periode: { id: "1a" }, gChoisie: false });
  assert.deepEqual(A.lirePeriode("pas du json"), { periode: { id: "1a" }, gChoisie: false });
  assert.deepEqual(A.lirePeriode(JSON.stringify({ id: "3m", granularite: "mois" })), { periode: { id: "3m" }, gChoisie: false }, "ancienne valeur enregistrée d'office : automatique");
  assert.deepEqual(A.lirePeriode({ id: "tout", granularite: "trimestre", gChoisie: true }), { periode: { id: "tout", granularite: "trimestre" }, gChoisie: true });
  assert.deepEqual(A.lirePeriode({ id: "perso", du: "2026-01-01", au: "2026-03-31", gChoisie: true }), { periode: { id: "perso", du: "2026-01-01", au: "2026-03-31" }, gChoisie: false });
  assert.deepEqual(A.periodeAEnregistrer({ id: "1a", granularite: "semaine" }, false), { id: "1a" });
  assert.deepEqual(A.periodeAEnregistrer({ id: "1a", granularite: "mois" }, true), { id: "1a", granularite: "mois", gChoisie: true });
  assert.deepEqual(A.periodeAEnregistrer({ id: "perso", du: "2026-01-01", au: "2026-02-01", granularite: "jour" }, false), { id: "perso", du: "2026-01-01", au: "2026-02-01" });
});

/* Module complet dans un mini-DOM, avec le vrai UI.periode et un stockage local espion. */
function vueDom(stock) {
  const src = f => readFileSync("web/src/" + f, "utf8");
  const dom = miniDom(), { doc } = dom, reg = {}, ls = new Map(Object.entries(stock || {}));
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, Date, Math, JSON, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
    App: { register: (n, a) => { reg[n] = a; } } };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ["calc.js", "serie-net.js", "rules.js", "plan.js", "bilan-calc.js", "periodes.js", "marche.js", "risque.js", "pratiques.js", "ui.js", "claude-prompts.js", "routine-etat.js", "banque-etat.js", "reperes.js", "historique.js", "graphe-patrimoine.js", "objectifs-view.js"])
    vm.runInContext(src(f), ctx, { filename: f });
  vm.runInContext(js, ctx, { filename: "aujourdhui.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = html;
  reg.aujourdhui.mount(root);
  reg.aujourdhui.update(demoS(), true);
  const radios = sel => root.querySelector("#ajPeriode").querySelector(sel).querySelectorAll('[role="radio"]');
  const radio = (sel, id) => radios(sel).find(r => r.getAttribute("data-ui-id") === id);
  const coche = sel => (radios(sel).find(r => r.getAttribute("aria-checked") === "true") || {}).getAttribute?.("data-ui-id");
  const lu = () => JSON.parse(ls.get("aujourdhui-periode") || "null");
  return { dom, doc, root, api: reg.aujourdhui, ls, radio, coche, lu };
}

test("vue (DOM) : granularité automatique selon la période tant que l'utilisateur ne la choisit pas ; choisie : passée à UI.periode et enregistrée", () => {
  const Pe = Periodes, t = jourLocal();
  const auto = id => Pe.auto(Pe.bornes(id, t, A.premiereDate(DEMO.snapshots)));
  let v = vueDom();
  assert.equal(v.coche(".ui-periode-g"), auto("1a"), "défaut : 1 an, granularité automatique (plus de « mois » imposé)");
  v.radio(".ui-periode-p", "3m").click();
  assert.equal(v.coche(".ui-periode-g"), auto("3m"), "la granularité suit la période");
  assert.deepEqual(v.lu(), { id: "3m" }, "granularité non enregistrée sans choix de l'utilisateur");
  // une touche sans effet sur la bascule de granularité (Tab) ne compte pas comme un choix
  v.dom.touche(v.radio(".ui-periode-g", v.coche(".ui-periode-g")), "Tab");
  v.radio(".ui-periode-p", "1a").click();
  assert.deepEqual(v.lu(), { id: "1a" });
  assert.equal(v.coche(".ui-periode-g"), auto("1a"));
  // choix de l'utilisateur (clic) : enregistré, et ne suit plus la période
  v.radio(".ui-periode-g", "trimestre").click();
  assert.deepEqual(v.lu(), { id: "1a", granularite: "trimestre", gChoisie: true });
  v.radio(".ui-periode-p", "1m").click();
  assert.equal(v.coche(".ui-periode-g"), "trimestre", "choisie : ne suit plus la période");
  assert.deepEqual(v.lu(), { id: "1m", granularite: "trimestre", gChoisie: true });
  // au prochain montage, la granularité choisie est passée à UI.periode
  v = vueDom({ "aujourdhui-periode": JSON.stringify(v.lu()) });
  assert.equal(v.coche(".ui-periode-p"), "1m");
  assert.equal(v.coche(".ui-periode-g"), "trimestre");
  // ancienne valeur (granularité enregistrée d'office) : automatique
  v = vueDom({ "aujourdhui-periode": JSON.stringify({ id: "3m", granularite: "annee" }) });
  assert.equal(v.coche(".ui-periode-g"), auto("3m"));
  // choix au clavier (flèche) : compte comme un choix
  const g0 = v.coche(".ui-periode-g");
  v.dom.touche(v.radio(".ui-periode-g", g0), "ArrowRight");
  assert.notEqual(v.coche(".ui-periode-g"), g0);
  assert.deepEqual(v.lu(), { id: "3m", granularite: v.coche(".ui-periode-g"), gChoisie: true });
  assert.doesNotMatch(sansExceptions(v.root.textContent), VOUVOIEMENT);
});

test("graphe : libellés de période longs (semaines) sans chevauchement — largeur estimée d'après le texte", () => {
  const pts = [["2025-10-13", "sem. du 13 oct."], ["2026-03-02", "sem. du 2 mars"], ["2026-09-28", "sem. du 28 sept."], ["2026-10-05", "sem. du 5 oct."]]
    .map(([date, label], i) => ({ date, label, valeur: 1000 + i }));
  const h = G.construire({ points: pts.map(p => Object.assign(p, { nature: "observe" })), resume: {}, reperes: [], historique: true }, null, { largeur: 720 }).svg;
  const libelles = [...h.matchAll(/<text class="aj-ax"[^>]*text-anchor="(?:start|middle|end)">([^<]+)<\/text>/g)].map(m => m[1]).filter(t => /^sem\./.test(t));
  assert.deepEqual(libelles, ["sem. du 13 oct.", "sem. du 2 mars", "sem. du 5 oct."], "l'avant-dernier, trop proche du dernier, est omis");
});

/* ------------------------------------------------ CP1 : argent qui dort, fiches de Patrimoine › Comptes ------------------------------------------------ */

test("boite : « Argent qui dort » (Calc.argentQuiDort) → urgence 3, vers Patrimoine › Comptes ; fonction absente, en échec ou sans dépassement → rien", () => {
  const S = vide();
  const avec = r => Object.assign({}, DEPS, { Calc: Object.assign({}, Calc, { argentQuiDort: (s, t) => (typeof r === "function" ? r(s, t) : r) }) });
  let vu = null;
  const b = A.boite(S, TODAY, avec((s, t) => { vu = [s, t]; return { montant: 2140.4, mois: 3, solde: 7400, seuil: 5260, depenses: 3506, source: "reel" }; }));
  assert.equal(vu[0], S); assert.equal(vu[1], TODAY, "appelée avec S et le jour");
  const x = b.find(i => i.type === "argent");
  assert.ok(x);
  assert.equal(x.urgence, 3);
  assert.equal(x.titre, "Argent qui dort sur tes comptes courants");
  assert.equal(x.contexte.replace(/[\u00a0\u202f]/g, " "), "2 140 € au-delà de 1,5 mois de dépenses depuis 3 mois (solde 7 400 €, seuil 5 260 €) : cet argent ne te rapporte rien.");
  assert.deepEqual(x.action, { label: "Voir mes comptes", route: "patrimoine/comptes" });
  for (const r of [null, false, {}, { montant: 0 }, { montant: "x" }, () => { throw new Error("panne"); }]) assert.equal(A.boite(S, TODAY, avec(r)).filter(i => i.type === "argent").length, 0, JSON.stringify(r));
  const sans = Object.assign({}, DEPS, { Calc: Object.assign({}, Calc, { argentQuiDort: undefined }) });
  assert.equal(A.boite(S, TODAY, sans).filter(i => i.type === "argent").length, 0, "fonction absente : rien, sans erreur");
  if (HAS_UI) {
    const h = A.boiteHtml([x], UI);
    assert.match(h, /data-type="argent"/); assert.match(h, /<span class="ui-sr">Argent qui dort, à surveiller : <\/span>/);
    assert.match(h, /<a class="aj-act" href="#patrimoine\/comptes" data-goto="patrimoine\/comptes">Voir mes comptes<\/a>/);
  }
});

test("Patrimoine net → Patrimoine › Comptes : chaque enveloppe du détail ouvre sa fiche ; « Voir le détail par compte » sous la frise", () => {
  const ind = A.indicateurs(demoS(), jourLocal(), { id: "1a" }, DEPS);
  const d = A.detail("net", ind, { id: "1a" });
  assert.deepEqual(d.lien, { label: "Voir mes comptes", href: "#patrimoine/comptes" });
  assert.match(d.contenu, /<a class="aj-det-l aj-det-fiche" href="#patrimoine\/comptes\?enveloppe=PEA%20Camille" data-goto="patrimoine\/comptes\?enveloppe=PEA%20Camille">PEA Camille<\/a>/);
  assert.doesNotMatch(d.contenu, /aj-det-fiche[^>]*>Appartement/, "les biens n'ont pas de fiche");
  const S2 = demoS(); S2.positions[0].envelope = PIEGE;
  assert.doesNotMatch(A.detail("net", A.indicateurs(S2, jourLocal(), { id: "1a" }, DEPS), { id: "1a" }).contenu, /<img/);
  assert.match(html, /<a class="aj-comptes" href="#patrimoine\/comptes" data-goto="patrimoine\/comptes">Voir le détail par compte<\/a>/);
});

/* ---------- doublons probables (cas type : ligne « PEA DUPONT » qui recopie le total du PEA) ---------- */
test("boite : doublon probable (Calc.doublonsProbables) → élément urgent vers la fiche de l'enveloppe ; rien pour une ligne d'espèces de 60 €", () => {
  const titres = [7200, 6100, 5500, 5100, 4500, 4200, 3800, 3500, 3000, 2700, 2300, 1900, 1650].map((v, i) =>
    ({ id: "t" + i, name: "Titre " + i, envelope: "PEA", owner: "p1", bloc: "Monde", mode: "market", isin: "FR000000000" + i, qty: 1, price: v, status: "actif" }));
  const esp = { id: "esp", name: "Espèces PEA", envelope: "PEA", owner: "p1", bloc: "Liquidités", mode: "manual", isin: null, value: 60, status: "actif" };
  const dupont = { id: "dupont", name: "PEA DUPONT", envelope: "PEA", owner: "p1", bloc: "Monde", mode: "manual", isin: null, value: 51230.5, status: "actif" };
  const S = Object.assign(demoS(), { positions: [...titres, esp, dupont] });
  const d = A.boite(S, jourLocal(), DEPS).filter(x => x.type === "doublon");
  assert.equal(d.length, 1);
  assert.equal(d[0].urgence, 1);
  assert.match(d[0].titre, /PEA DUPONT/);
  assert.match(d[0].contexte, /compté deux fois/);
  assert.equal(d[0].action.route, "patrimoine/comptes?enveloppe=PEA&titulaire=p1");
  assert.deepEqual(A.boite(Object.assign(demoS(), { positions: [...titres, esp] }), jourLocal(), DEPS).filter(x => x.type === "doublon"), []);
  assert.deepEqual(A.boite(demoS(), jourLocal(), DEPS).filter(x => x.type === "doublon"), [], "démo : aucun doublon");
});

/* ------------------------------------------------ bandeau redessiné : objectifs, risque, passé reconstitué ------------------------------------------------ */

const OBJ = (id, o) => Object.assign({ id, nom: "Objectif " + id, type: "projet", cible: 1000, dateCible: "2030-01-31", deja: 0, source: "saisi", poches: [], enveloppes: [], rendement: 2, priorite: 1 }, o);

test("objectifs : jauge = Σ poids × min(avancement, 1) / Σ poids, poids = N − rang + 1 ; 3 premiers par priorité, statuts en mots", () => {
  const S = vide({ objectifs: [OBJ("c", { priorite: 3, deja: 50 }), OBJ("a", { priorite: 1, deja: 800 }), OBJ("b", { priorite: 2, deja: 400 }), OBJ("d", { priorite: 4, deja: 0 })] });
  const o = A.objectifs(S, TODAY, DEPS);
  assert.equal(o.n, 4);
  assert.deepEqual(o.liste.map(x => [x.id, x.rang, x.poids]), [["a", 1, 4], ["b", 2, 3], ["c", 3, 2], ["d", 4, 1]], "ordre des priorités ; l'objectif prioritaire pèse N");
  assert.deepEqual(o.top.map(x => x.id), ["a", "b", "c"], "rappel : les 3 premiers");
  const attendu = (4 * 0.8 + 3 * 0.4 + 2 * 0.05 + 1 * 0) / 10;
  assert.ok(Math.abs(o.jauge - attendu) < 1e-9, o.jauge + " ≠ " + attendu);
  assert.equal(o.pct, Math.round(attendu * 100));
  assert.ok(o.liste.every(x => x.mot && ["bon", "info", "attention", "critique"].includes(x.ton)), "statut en toutes lettres, avec son ton");
  assert.ok(o.liste.every(x => x.enRetard === (x.statut === "retard" || x.statut === "hors_portee")));
  assert.equal(o.retard, o.liste.filter(x => x.enRetard).length);
  assert.equal(o.ton, o.liste.some(x => x.statut === "hors_portee") ? "critique" : o.retard ? "attention" : "bon");
  assert.equal(o.somme, o.liste.reduce((a, x) => a + x.poids * x.progression, 0));
  assert.equal(o.poidsTotal, 10);
});

test("objectifs : l'avancement est plafonné à 100 % ; un objectif atteint compte pour 1 ; sans objectif ou sans moteur : pas de jauge", () => {
  const o = A.objectifs(vide({ objectifs: [OBJ("a", { deja: 5000 }), OBJ("b", { priorite: 2, deja: 0 })] }), TODAY, DEPS);
  assert.equal(o.liste[0].progression, 1);
  assert.equal(o.liste[0].statut, "atteint");
  assert.ok(Math.abs(o.jauge - (2 * 1 + 1 * 0) / 3) < 1e-9, "plafonné à 1 (pas 5)");
  const v = A.objectifs(vide(), TODAY, DEPS);
  assert.deepEqual([v.vide, v.jauge, v.pct, v.n, v.top.length], [true, null, null, 0, 0]);
  assert.equal(A.objectifs(vide({ objectifs: [OBJ("a")] }), TODAY, { Plan: null }).vide, true, "sans moteur Plan : état vide, sans erreur");
  assert.doesNotThrow(() => A.objectifs(null, TODAY, null));
  // poches : l'argent d'une poche sert l'objectif prioritaire d'abord (cascade du moteur Plan)
  const S = vide({ positions: [{ id: "p", name: "Livret", owner: "p1", bloc: "Épargne", envelope: "Livrets", mode: "manual", value: 1500, status: "actif" }],
    objectifs: [OBJ("a", { source: "poches", poches: ["Épargne"], cible: 1000, deja: 0 }), OBJ("b", { source: "poches", poches: ["Épargne"], cible: 1000, priorite: 2, deja: 0 })] });
  const p = A.objectifs(S, TODAY, DEPS);
  assert.deepEqual(p.liste.map(x => Math.round(x.progression * 100)), [100, 50]);
});

test("calendrier : un rendu (indicateurs) ne lance le moteur qu'une fois ; un appel isolé ou un état modifié entre deux rendus recalcule (aucun cache durable)", () => {
  const Cal = require("../web/src/calendrier.js");
  let n = 0;
  const deps = { ...DEPS, Calendrier: { ...Cal, calendrier: (...a) => { n++; return Cal.calendrier(...a); } } };
  const S = demoS();
  const i1 = A.indicateurs(S, TODAY, { id: "1a" }, deps);
  assert.equal(n, 1, "indicateurs lit le calendrier pour les échéances et la carte : un seul calcul");
  assert.ok(i1.calendrier.disponible && i1.calendrier.jalons.length > 0);
  A.echeances(S, TODAY, deps); A.echeances(S, TODAY, deps);
  assert.equal(n, 3, "appels isolés : rien n'est mémorisé");
  // état modifié en place entre deux rendus : le second rendu le voit
  const avant = i1.calendrier.jalons.length;
  S.config.enveloppes_infos["PEL Camille"].date_cloture = "2017-01-01";
  const i2 = A.indicateurs(S, TODAY, { id: "1a" }, deps);
  assert.equal(n, 4);
  assert.ok(i2.calendrier.jalons.length < avant, "le PEL clos plus tôt n'a plus de jalons à venir");
  A.indicateurs(S, "2026-10-11", { id: "1a" }, deps);
  assert.equal(n, 5, "un autre jour : recalcul");
  // la boîte de réception partage aussi le calcul avec le reste du rendu
  n = 0;
  A.boite(S, TODAY, deps);
  assert.ok(n <= 1, "boîte : au plus un calcul");
});
test("jour() sans argument : date de Paris (RoutineEtat.aujParis), pas celle du fuseau du navigateur", () => {
  const ancienTZ = process.env.TZ;
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-14T20:30:00Z") }); // Paris : 14/10 22:30 ; Pacific/Kiritimati : 15/10 10:30
  try {
    process.env.TZ = "Pacific/Kiritimati";
    assert.equal(new Date().getDate(), 15, "le fuseau du test est bien en avance sur Paris");
    assert.equal(A.jour(), "2026-10-14");
    assert.equal(A.jour(), RoutineEtat.aujParis());
    assert.equal(A.jour("2026-01-02"), "2026-01-02", "une date seule est rendue telle quelle");
    const CV2 = require("../web/src/comptes-view.js");
    assert.equal(CV2.jour(), "2026-10-14");
  } finally {
    mock.timers.reset();
    if (ancienTZ === undefined) delete process.env.TZ; else process.env.TZ = ancienTZ;
  }
});
test("cartes : objectifs (jauge, 3 rappels avec statut en mots, échéance, barre), bonnes pratiques (anneau), échéance (compte à rebours) ; texte équivalent aux jauges", { skip: !HAS_UI && "ui.js" }, () => {
  const S = demoS(), t = jourLocal(), ind = A.indicateurs(S, t, { id: "1a" }, DEPS);
  const c = A.cartes(ind, UI, { id: "1a" });
  const carte = id => c.split("<button ").find(x => x.includes('data-ui-carte="' + id + '"'));
  const ob = carte("objectifs");
  assert.match(ob, /aria-label="Objectifs : 57 % d(?:'|&#39;)avancement pondéré, 1 objectif en retard\./);
  assert.equal((ob.match(/class="aj-ob /g) || []).length, 3, "les 3 premiers objectifs");
  assert.match(ob, /Matelas de précaution/);
  assert.match(ob, /<span class="ui-badge [a-z]+">(atteint|en avance|dans les temps|en retard|hors de portée)<\/span>/, "statut en toutes lettres");
  assert.match(ob, /aj-ob-barre" aria-hidden="true"><i style="width:/);
  assert.match(ob, /juin 2027/);
  assert.match(ob, /<svg class="aj-ring[^"]*" viewBox="0 0 80 80" aria-hidden="true"/, "jauge décorative : le texte est dans la carte");
  assert.match(ob, /data-aj-off="/);
  const pr = carte("pratiques");
  assert.match(pr, /aria-label="Bonnes pratiques : \d+ sur 100, (solide|correct|à consolider)/);
  assert.match(pr, /critères? à compléter/);
  assert.match(carte("echeance"), /aria-label="Prochaine échéance : dans 40 jours|aria-label="Prochaine échéance : dans \d+ jours/);
  const net = carte("net");
  assert.match(net, /class="aj-k-val" data-aj-count="\d+" data-aj-fmt="eur"/);
  assert.match(net, /<svg class="aj-spark"/, "mini-courbe");
  assert.match(net, /class="ui-tendance pos"><span class="ui-tendance-fleche" aria-hidden="true">▲<\/span><span class="ui-sr">En hausse : /);
  // sans données : états vides orientés vers Claude, aucun compte, jauge vide
  const vides = A.cartes(A.indicateurs(vide(), TODAY, { id: "1a" }, DEPS), UI, { id: "1a" });
  assert.match(vides, /Fixe ton premier objectif avec Claude/);
  assert.match(vides, /Aucune date à venir/);
  assert.doesNotMatch(vides, /aj-obs|aj-spark/);
});

test("detail (Objectifs) : les lignes des 3 premiers, jauge, et le calcul objectif par objectif dans un accordéon « Calcul »", () => {
  const S = vide({ objectifs: [OBJ("a", { nom: "Apport", deja: 800 }), OBJ("b", { nom: "Voyage", priorite: 2, deja: 400 })] });
  const d = A.detail("objectifs", A.indicateurs(S, TODAY, { id: "1a" }, DEPS), { id: "1a" }), c = sp(d.contenu);
  assert.equal(d.titre, "Objectifs");
  assert.match(c, /Jauge d(&#39;|')atteinte<\/span><span class="aj-det-v">67 %/);
  assert.match(c, /<details class="ui-acc"><summary class="ui-acc-titre"><span>Calcul<\/span>/);
  assert.match(c, /Σ \(poids × avancement\) ÷ Σ poids/);
  assert.match(c, /Apport \(rang 1\)<\/span><span class="aj-det-v">poids 2 × 80 % = 1,6/);
  assert.match(c, /Voyage \(rang 2\)<\/span><span class="aj-det-v">poids 1 × 40 % = 0,4/);
  assert.match(c, /\(1,6 \+ 0,4\) ÷ 3 = 67 %/);
  assert.deepEqual(J(d.lien), { label: "Voir les objectifs", href: "#patrimoine/objectifs" });
  assert.ok(d.question.length > 20);
});

test("boite : écart au profil de risque → élément « À traiter » (urgence 3, vers Pilotage › Risque) seulement si le profil est renseigné et qu'une classe est hors fourchette", () => {
  const S = Object.assign(demoS(), { risque: { profil: "prudent", reponses: {}, score: 10, date: TODAY } });
  const x = A.boite(S, jourLocal(), DEPS).find(i => i.type === "risque");
  assert.ok(x, "élément présent");
  assert.equal(x.urgence, 3);
  assert.match(x.titre, /^Allocation hors des fourchettes de ton profil Prudent$/);
  assert.match(x.contexte, /classes? d'actifs sort(?:ent)? de la fourchette/);
  assert.deepEqual(J(x.action), { label: "Voir le profil de risque", route: "pilotage/risque" });
  assert.equal(A.boite(demoS(), jourLocal(), DEPS).filter(i => i.type === "risque").length, 0, "profil jamais rempli : rien");
  assert.equal(A.boite(Object.assign(vide(), { risque: { profil: "prudent" } }), TODAY, DEPS).filter(i => i.type === "risque").length, 0, "aucun placement : rien");
  if (HAS_UI) assert.match(A.boiteHtml([x], UI), /data-type="risque"[\s\S]*Profil de risque, à surveiller/);
});

test("frise : le passé reconstitué (deps.reconstitue) est fusionné avant la première photo, l'observé gagne, la courbe garde la nature de chaque point", () => {
  const S = demoS(), t = jourLocal(), prem = A.premiereDate(S.snapshots);
  const rec = { points: [], decalage: 0 };
  for (let d = Historique.plusJours(prem, -200); d <= Historique.plusJours(t, -1); d = Historique.plusJours(d, 1)) rec.points.push({ date: d, net: 150000 });
  const f = A.frise(S, t, { id: "tout", granularite: "mois" }, Object.assign({}, DEPS, { reconstitue: rec }));
  assert.equal(f.reconstitue, true);
  assert.equal(f.premiere, Historique.plusJours(prem, -200));
  const natures = f.points.map(p => p.nature);
  assert.ok(natures.includes("reconstitue") && natures.includes("observe"));
  assert.equal(natures.indexOf("observe") > natures.lastIndexOf("reconstitue"), true, "le reconstitué précède toujours l'observé");
  assert.ok(f.points.filter(p => p.nature === "observe").every(p => p.date >= prem), "aucune date reconstituée après la première photo");
  assert.equal(f.points[f.points.length - 1].nature, "observe", "le point du jour est observé");
  assert.ok(f.horsFin > 0 && isFinite(f.horsFin), "immobilier, autres biens et dettes d'aujourd'hui");
  const sans = A.frise(S, t, { id: "tout", granularite: "mois" }, DEPS);
  assert.equal(sans.reconstitue, false);
  assert.ok(sans.points.every(p => p.nature === "observe"));
  const ind = A.indicateurs(S, t, { id: "tout", granularite: "mois" }, Object.assign({}, DEPS, { reconstitue: rec }));
  assert.equal(ind.net.reconstitue, true, "la carte dit que le début est reconstitué");
  assert.match(A.cartes(ind, UI, { id: "tout" }), /début reconstitué/);
});

test("evolution : passé + cône de projection (Plan, versement des Objectifs) quand la période va jusqu'à aujourd'hui ; pas de futur pour une période terminée", () => {
  const S = demoS(), t = jourLocal();
  const e = A.evolution(S, t, { id: "1a", granularite: "mois" }, 10, DEPS);
  assert.ok(e.futur && e.futur.points.length === 121 && e.futur.annees === 10);
  assert.equal(e.futur.points[0].date, t);
  assert.equal(e.futur.points[0].central, Math.round(e.futur.points[0].central), "valeurs entières du moteur");
  const net = e.passe.points[e.passe.points.length - 1].valeur;
  assert.ok(Math.abs(e.futur.points[0].central - net) <= 1, "le cône part du patrimoine net d'aujourd'hui");
  assert.ok(e.futur.points.every(p => p.pessimiste <= p.central && p.central <= p.optimiste));
  const budget = S.budget && S.budget.lignes ? Plan.budgetTotaux(S.budget.lignes, S.profil, "foyer").epargne : 0;
  const reel = ObjectifsView.versementProjection(S, Plan.budgetTotaux((S.budget && S.budget.lignes) || [], S.profil, "foyer"), "foyer", t, DEPS);
  assert.equal(e.futur.versement, reel ? reel.v : 0, "même versement que la projection de Patrimoine › Objectifs (" + budget + ")");
  assert.equal(e.futur.versementSource, reel ? reel.src : null);
  const passee = A.evolution(S, t, { id: "perso", du: "2026-01-01", au: "2026-06-30" }, 10, DEPS);
  assert.equal(passee.futur, null, "période terminée avant aujourd'hui : pas de projection");
  assert.equal(A.evolution(vide(), TODAY, { id: "1a" }, 5, DEPS).futur.points.length, 61, "sans donnée : cône de versements nuls, sans erreur");
  const un = A.evolution(S, t, { id: "1a" }, 1, DEPS); assert.equal(un.futur.points.length, 13);
});

/* Module complet, Store espion : lecture à la demande des cours, transactions et opérations bancaires, puis passé reconstitué dessiné en pointillés. */
function vueAvecStore(store, stock) {
  const src = f => readFileSync("web/src/" + f, "utf8");
  const dom = miniDom(), { doc } = dom, reg = {}, ls = new Map(Object.entries(stock || {}));
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, Date, Math, JSON, encodeURIComponent, decodeURIComponent, Store: store,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
    App: { register: (n, a) => { reg[n] = a; } } };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ["calc.js", "serie-net.js", "rules.js", "plan.js", "historique.js", "bilan-calc.js", "periodes.js", "graphe-patrimoine.js", "marche.js", "risque.js", "pratiques.js", "ui.js", "claude-prompts.js", "routine-etat.js", "banque-etat.js", "reperes.js", "objectifs-view.js"])
    vm.runInContext(src(f), ctx, { filename: f });
  vm.runInContext(js, ctx, { filename: "aujourdhui.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = html;
  reg.aujourdhui.mount(root);
  return { root, api: reg.aujourdhui, ls, dom };
}
const attend = (ms = 40) => new Promise(r => setTimeout(r, ms));

test("vue : la reconstitution lit les cours (ISIN cotés), les transactions et les opérations des comptes rattachés, puis dessine le passé en pointillés ; page « Tout » relit plus loin", async () => {
  const S = demoS(), t = jourLocal();
  const appels = { cours: [], tx: [], ops: [] };
  const serie = () => { const out = []; for (let k = 1200; k >= 1; k--) out.push({ date: Historique.plusJours(t, -k), cloture: 100 + (1200 - k) * 0.02 }); return out; };
  const store = { cours: async (isins, depuis) => { appels.cours.push([isins, depuis]); return Object.fromEntries(isins.map(i => [i, serie().filter(c => c.date >= depuis)])); },
    transactions: async depuis => { appels.tx.push(depuis); return []; },
    banque: { operations: async (ids, depuis) => { appels.ops.push([ids, depuis]); return []; } } };
  const S2 = Object.assign(S, { banque: Object.assign({}, S.banque, { actif: true, mfaRequise: false }) });
  const v = vueAvecStore(store);
  v.api.update(S2, true);
  await attend();
  const isins = [...new Set(S2.positions.filter(p => p.mode === "market" && p.isin && p.status !== "à recevoir" && p.status !== "clôturé").map(p => p.isin))].sort();
  assert.equal(appels.cours.length, 1, "une seule lecture des cours");
  assert.deepEqual(J(appels.cours[0][0]), isins, "tous les ISIN cotés comptés, une fois chacun");
  assert.equal(appels.cours[0][1], Historique.plusJours(Periodes.bornes("1a", t).du, -10), "depuis le début de la période (1 an) moins une marge");
  assert.equal(appels.tx.length, 1);
  assert.equal(appels.tx[0], appels.cours[0][1]);
  assert.equal(appels.ops.length, 1, "opérations des comptes bancaires rattachés à une ligne");
  assert.equal(appels.ops[0][1], Historique.plusJours(t, -90), "90 jours d'opérations");
  assert.ok(appels.ops[0][0].length >= 1 && J(appels.ops[0][0]).every(id => S2.banque.comptes.find(c => c.id === id && c.positionId != null && !c.ignore && c.type !== "credit")));
  const svg = v.root.querySelector("#ajFrise").innerHTML;
  assert.match(svg, /class="aj-ligne-rec"/, "passé reconstitué : pointillés");
  assert.match(svg, /class="aj-ligne"/, "observé : trait plein");
  assert.match(svg, /class="aj-proj"/, "projection centrale");
  assert.match(v.root.querySelector("#ajLegende").innerHTML, /Reconstitué/);
  assert.match(v.root.querySelector("#ajEtat").textContent, /Avant ta première photo \(.*\), le passé est reconstitué/);
  assert.match(v.root.querySelector("#ajCartes").innerHTML, /début reconstitué/);
  assert.match(v.root.querySelector("#ajTable").innerHTML, /<th scope="row">[^<]*<\/th><td class="n">[^<]*<\/td><td class="n">—<\/td><td class="n">—<\/td><td>reconstitué<\/td>/, "équivalent accessible : le tableau dit la nature de chaque point");
  v.api.update(J(S2), true);
  await attend();
  assert.equal(appels.cours.length, 1, "même période et mêmes lignes : pas de nouvelle lecture");
  // période plus longue (« Tout » : 5 ans) : relue plus loin
  v.root.querySelector("#ajPeriode").querySelector(".ui-periode-p").querySelectorAll('[role="radio"]').find(r => r.getAttribute("data-ui-id") === "tout").click();
  await attend();
  assert.equal(appels.cours.length, 2, "« Tout » remonte plus loin : nouvelle lecture");
  assert.equal(appels.cours[1][1], Historique.plusJours(t, -Historique.JOURS_MAX));
});

test("vue : lectures en échec ou absentes — la page se dessine quand même (observé + projection), l'état le dit ; mode sans Store.transactions", async () => {
  const S = demoS();
  const v = vueAvecStore({ cours: async () => { throw new Error("réseau"); }, transactions: async () => { throw new Error("réseau"); } });
  v.api.update(S, true);
  await attend();
  const svg = v.root.querySelector("#ajFrise").innerHTML;
  assert.match(svg, /class="aj-ligne"/);
  assert.match(svg, /class="aj-proj"/);
  assert.doesNotMatch(svg, /aj-ligne-rec/, "rien n'est reconstitué sans cours");
  assert.match(v.root.querySelector("#ajEtat").textContent, /Les cours n'ont pas pu être lus/);
  const sans = vueAvecStore({});
  sans.api.update(S, true);
  await attend();
  assert.match(sans.root.querySelector("#ajFrise").innerHTML, /class="aj-proj"/);
});

test("vue : l'horizon (1 · 5 · 10 · 20 ans) est une bascule accessible, mémorisée ; le futur suit l'horizon, le passé suit la période", async () => {
  const v = vueAvecStore({});
  v.api.update(demoS(), true);
  const radios = () => v.root.querySelector("#ajHorizon").querySelectorAll('[role="radio"]');
  assert.deepEqual(radios().map(r => r.getAttribute("data-ui-id")), ["1", "5", "10", "20"]);
  assert.deepEqual(radios().map(r => r.getAttribute("aria-label")), ["1 an", "5 ans", "10 ans", "20 ans"]);
  assert.equal(radios().find(r => r.getAttribute("aria-checked") === "true").getAttribute("data-ui-id"), "5", "défaut : 5 ans");
  assert.equal(v.root.querySelector("#ajHorizon").querySelector('[role="radiogroup"]').getAttribute("aria-label"), "Horizon de la projection");
  const an0 = new Date().getFullYear();
  assert.match(v.root.querySelector("#ajFrise").innerHTML, new RegExp(">" + (an0 + 5) + "</text>"));
  radios().find(r => r.getAttribute("data-ui-id") === "20").click();
  assert.match(v.root.querySelector("#ajFrise").innerHTML, new RegExp(">" + (an0 + 20) + "</text>"));
  assert.equal(v.ls.get("aujourdhui-horizon"), "20");
  const reprise = vueAvecStore({}, { "aujourdhui-horizon": "10" });
  reprise.api.update(demoS(), true);
  assert.equal(reprise.root.querySelector("#ajHorizon").querySelectorAll('[role="radio"]').find(r => r.getAttribute("aria-checked") === "true").getAttribute("data-ui-id"), "10");
  const ignore = vueAvecStore({}, { "aujourdhui-horizon": "7" });
  ignore.api.update(demoS(), true);
  assert.equal(ignore.root.querySelector("#ajHorizon").querySelectorAll('[role="radio"]').find(r => r.getAttribute("aria-checked") === "true").getAttribute("data-ui-id"), "5", "valeur enregistrée inconnue : défaut");
  assert.equal(v.root.querySelector("#ajHorizonZone").hidden, false);
  assert.equal(v.root.querySelector("#ajPromesse").hidden, false, "« Projection, pas une promesse » visible avec la projection");
  // sans projection (période terminée avant aujourd'hui) : horizon et mention masqués
  v.root.querySelector("#ajPeriode").querySelector(".ui-periode-p").querySelectorAll('[role="radio"]').find(r => r.getAttribute("data-ui-id") === "perso").click();
});

test("vue : animation des cartes à la première apparition seulement, jamais avec prefers-reduced-motion", () => {
  const src = f => readFileSync("web/src/" + f, "utf8");
  const essai = reduit => {
    const reg = {}, frames = [], ecrits = [];
    const ctx = { console, Intl, Date, Math, JSON, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, performance: { now: () => 0 },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { readyState: "complete", addEventListener() {}, activeElement: null, body: {} },
      App: { register: (n, api) => { reg[n] = api; }, refreshHeadlines() {} }, requestAnimationFrame: f => { frames.push(f); },
      matchMedia: q => ({ matches: reduit && /reduced-motion/.test(q) }) };
    ctx.window = ctx; ctx.self = ctx;
    vm.createContext(ctx);
    for (const f of ["calc.js", "serie-net.js", "rules.js", "plan.js", "historique.js", "bilan-calc.js", "periodes.js", "graphe-patrimoine.js", "marche.js", "risque.js", "pratiques.js", "claude-prompts.js", "routine-etat.js", "banque-etat.js", "reperes.js", "objectifs-view.js"]) vm.runInContext(src(f), ctx, { filename: f });
    ctx.UI = Object.assign({}, UI, { periode() {}, brancher() {}, bascule() {} });
    vm.runInContext(js, ctx, { filename: "aujourdhui.js" });
    const { root, els } = faux();
    const arc = { style: {}, getAttribute: k => (k === "data-aj-off" ? "44.86" : null), getBoundingClientRect() { return {}; } };
    const nombre = { textContent: "193 490 €", getAttribute: k => ({ "data-aj-count": "193490", "data-aj-fmt": "eur" }[k]) };
    Object.defineProperty(arc.style, "strokeDashoffset", { get() { return this._v; }, set(v) { this._v = v; ecrits.push(v); } });
    els.set("ajCartes", Object.assign(root.querySelector("#ajCartes"), { querySelectorAll: s => (/data-aj-off/.test(s) ? [arc] : /data-aj-count/.test(s) ? [nombre] : []) }));
    reg.aujourdhui.mount(root);
    reg.aujourdhui.update(Object.assign(demoS(), { ready: true }), true);
    frames.splice(0).forEach(f => f(10));
    const apres1 = { ecrits: ecrits.slice(), texte: nombre.textContent };
    frames.splice(0).forEach(f => f(2000));
    reg.aujourdhui.update(Object.assign(demoS(), { ready: true, objectifs: [] }), true); // nouveau rendu des cartes : plus d'animation
    const avant = frames.length;
    return { apres1, final: { ecrits, texte: nombre.textContent }, avant, frames: frames.length };
  };
  const normal = essai(false);
  assert.ok(normal.apres1.ecrits.length >= 1 && normal.apres1.ecrits[0] !== "44.86", "jauge : départ vide (dasharray complet), puis remplissage");
  assert.equal(normal.final.ecrits[normal.final.ecrits.length - 1], "44.86", "arrivée à la valeur de la jauge");
  assert.notEqual(normal.apres1.texte, "193 490 €", "chiffre compté depuis 0");
  assert.equal(normal.final.texte, "193 490 €", "valeur finale exacte");
  assert.equal(normal.frames, 0, "pas de nouvelle animation au rendu suivant");
  const calme = essai(true);
  assert.deepEqual(calme.final.ecrits, [], "reduced motion : aucune animation de jauge");
  assert.equal(calme.final.texte, "193 490 €", "reduced motion : chiffre affiché tel quel");
  assert.match(js, /prefers-reduced-motion: reduce/);
});

test("aujourdhui.css : bandeau 4 colonnes / 2 / 1, survol et focus des cartes, couleurs par variables (clair et sombre), mouvement réduit respecté", () => {
  assert.match(css, /\.aj-kpis\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:1239\.98px\)\{[^}]*\.aj-kpis\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /@media \(max-width:599\.98px\)\{[^}]*\.aj-kpis\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.aj-k:hover\{/); assert.match(css, /\.aj-k:focus-visible\{outline:2px solid var\(--accent\)/);
  assert.match(css, /\.aj-ring-arc\{[^}]*transition:stroke-dashoffset/);
  const decl = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(decl, /(?:color|fill|stroke|background|border[a-z-]*)\s*:\s*[^;}]*#[0-9a-fA-F]{3,8}\b/, "aucune couleur en dur : uniquement les variables du thème");
  assert.match(readFileSync("web/src/theme.css", "utf8"), /prefers-reduced-motion:reduce\)\{\*\{transition:none!important;animation:none!important\}\}/, "règle globale de mouvement réduit");
});

test("build : historique et graphe-patrimoine sont chargés avant Aujourd'hui (calc, plan d'abord)", () => {
  const b = readFileSync("build.mjs", "utf8");
  const scripts = b.match(/const SCRIPTS = \[([^\]]*)\]/)[1];
  const i = n => scripts.indexOf('"' + n + '"');
  assert.ok(i("calc") < i("plan") && i("plan") < i("historique"), "historique après calc et plan");
  assert.ok(i("graphe-patrimoine") > -1 && i("graphe-patrimoine") < scripts.indexOf("...MODULES"), "graphe maître chargé avant les modules de vue");
  assert.ok(i("reperes") > -1, "repères (sources de la projection) chargés");
});
