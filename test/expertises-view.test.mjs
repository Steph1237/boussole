// Agent › Savoir › Expertises (web/src/expertises-view.*) : les méthodes d'analyse que le Copilote patrimonial consulte à la demande
// (spec docs/superpowers/specs/2026-10-11-ex1-copilote-expertises.md § 3), en lecture seule : cartes (nom, quand consulter,
// version), panneau de détail (périmètre, marchés, méthode en markdown sûr, points de contrôle, garde-fous, forme de la réponse,
// historique des versions en accordéon, « Demander à Claude » avec ClaudePrompts.phrase("expertise", nom)), lien profond
// #agent/expertises?expertise=<slug>.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";
import { generer, lireExpertises, COMPLETES } from "../scripts/gen-expertises-demo.mjs";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/expertises-view.js", "utf8");
const css = readFileSync("web/src/expertises-view.css", "utf8");
const html = readFileSync("web/src/expertises-view.html", "utf8");
const uiJs = readFileSync("web/src/ui.js", "utf8");
const promptsJs = readFileSync("web/src/claude-prompts.js", "utf8");
const XV = require("../web/src/expertises-view.js");
const UI = require("../web/src/ui.js");
const P = require("../web/src/claude-prompts.js");
const DEMO = require("../web/src/demo-data.js");
const J = v => JSON.parse(JSON.stringify(v));
const sansCommentaires = s => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
/** Phrase « Demander à Claude » d'un HTML, décodée depuis son href. */
const phraseDe = h => { const m = /href="https:\/\/claude\.ai\/new\?q=([^"]+)"/.exec(h); return m ? decodeURIComponent(m[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&")) : null; };

const RESUME = { slug: "essai", nom: "Essai <b>", quandConsulter: "Quand on teste <script>alert(1)</script>.", perimetre: "Périmètre <i>de test</i>.",
  version: 3, misAJourLe: "2026-10-11", marches: ["fr", "us"], angles: ["frais"] };
const DETAIL = Object.assign({}, RESUME, {
  methode: "## Objectif\nTu aides l'utilisateur <img src=x onerror=alert(1)>.\n\n## Étapes\n1. **Cadrer** la question (fiche `frais-et-ter`).\n2. Voir [la source](https://www.amf-france.org/x) et [piège](javascript:alert(1)).",
  controles: ["Frais connus <u>", "Exposition réelle"], garde_fous: "## Posture\n- Aucun produit recommandé.", format: "1. **En bref**\n2. Sources",
  themesSavoir: ["marches"], reperes: ["pfu_taux"],
  changelog: [{ version: 1, le: "2026-09-01", resume: "Première version." }],
  versions: [{ version: 3, le: "2026-10-11", resume: "Frais <mis à jour>." }, { version: 2, le: "2026-10-01", resume: "Garde-fous." }, { version: 1, le: "2026-09-01", resume: "Première version." }],
});

/* ------------------------------------------------------------------ structure ------------------------------------------------------------------ */
test("expertises-view.js : se compile et s'enregistre sous « expertises-view »", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "expertises-view.js" }));
  assert.match(js, /App\.register\("expertises-view", api\)/);
  assert.match(js, /__pending/);
});

test("expertises-view.js : aucune requête DOM globale hors racine du module", () => {
  const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
  assert.deepEqual(bad, []);
  assert.match(js, /const \$ = id => root\.querySelector\("#" \+ id\)/);
});

test("expertises-view.html : identifiants utilisés par le script, introduction en deux phrases, légende pédagogique", () => {
  const ids = [...js.matchAll(/\$\("(xv[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 5);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
  assert.match(html, /<h2[^>]*id="xvTitre"[^>]*>Les expertises de Claude<\/h2>/);
  const intro = /<p class="xv-intro">([\s\S]*?)<\/p>/.exec(html);
  assert.ok(intro, "introduction");
  assert.equal(intro[1].split(/(?<=[.!?])\s+/).filter(Boolean).length, 2, "deux phrases : ce que sont les expertises, Claude les consulte pour toi");
  assert.match(intro[1], /Claude les consulte pour toi/);
  assert.ok(html.includes("Contenu pédagogique, pas un conseil en investissement."));
});

test("expertises-view.css : contenu de la vue scopé sous #view-expertises-view, contenu du panneau sous .ui-panneau .xv-…", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(sels.length > 10);
  const bad = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith("#view-expertises-view") && !x.startsWith(".ui-panneau .xv-"));
  assert.deepEqual(bad, []);
  assert.match(css, /@media \(max-width:\s*\d+px\)/, "règles mobiles");
});

test("expertises-view : lecture seule (aucune écriture, seule lecture Store.expertises.detail) et rien d'autre que des liens", () => {
  const s = sansCommentaires(js + html);
  assert.doesNotMatch(s, /<form\b|type="submit"|<input|<textarea/);
  for (const m of s.matchAll(/\bStore\s*\.\s*(\w+)(?:\s*\.\s*(\w+))?/g)) assert.ok(m[1] === "expertises" && (!m[2] || m[2] === "detail") || m[1] === "mode", "Store." + m[1] + (m[2] ? "." + m[2] : ""));
  assert.match(js, /\.expertises\.detail\(slug\)/);
});

test("expertises-view : tutoiement et vocabulaire (« Claude », plus de « Copilote » dans l\'interface, jamais « conseiller »)", () => {
  const s = sansCommentaires(js + html);
  assert.doesNotMatch(s, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(s, /conseiller/i);
  assert.doesNotMatch(sansCommentaires(js).replace(/\/\*[\s\S]*?\*\//g, "") + html, /Copilote/, "le mot Copilote ne s'affiche plus");
});

/* ------------------------------------------------------------------ fonctions pures ------------------------------------------------------------------ */
test("esc : échappe & < > \" ' ; null → chaîne vide", () => {
  assert.equal(XV.esc('<a href="x">&\'</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  assert.equal(XV.esc(null), "");
  assert.equal(XV.esc(undefined), "");
});

test("rendreMarkdown : HTML échappé d'abord ; titres (## → h4, ### → h5), listes, gras, code, liens https seulement", () => {
  const h = XV.rendreMarkdown(DETAIL.methode);
  assert.ok(h.includes("<h4>Objectif</h4>") && h.includes("<h4>Étapes</h4>"));
  assert.ok(h.includes("&lt;img src=x onerror=alert(1)&gt;"), "HTML d'origine échappé");
  assert.doesNotMatch(h, /<img|<script/);
  assert.match(h, /<ol><li><strong>Cadrer<\/strong> la question \(fiche <code>frais-et-ter<\/code>\)\.<\/li>/);
  assert.match(h, /<a href="https:\/\/www\.amf-france\.org\/x" target="_blank" rel="noopener noreferrer">la source/);
  assert.doesNotMatch(h, /href="javascript/);
  assert.equal(XV.rendreMarkdown("### Sous-titre"), "<h5>Sous-titre</h5>");
  assert.equal(XV.rendreMarkdown("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(XV.rendreMarkdown("Texte\n1. Un"), "<p>Texte</p><ol><li>Un</li></ol>", "liste collée à un paragraphe");
  assert.equal(XV.rendreMarkdown(null), "");
  assert.equal(XV.rendreMarkdown("`<b>`"), "<p><code>&lt;b&gt;</code></p>");
  for (const t of [DETAIL.methode, "1. a\n   - b\n2. c", '[x](https://a.fr" onclick="y)']) assert.equal(XV.rendreMarkdown(t), UI.markdown(t, { niveau: 4 }), "délégué à UI.markdown");
  assert.equal(XV.rendreMarkdown("1. a\n   - b\n2. c"), "<ol><li>a<ul><li>b</li></ul></li><li>c</li></ol>");
  assert.match(js, /\.markdown\(md, \{ niveau: 4 \}\)/);
  assert.doesNotMatch(js, /function enLigne|const gras =/, "pas de copie du rendu");
});

test("rendreMarkdown : méthode réelle de « Actions et marchés » (0017) — sous-liste des marchés dans l'étape 5, étapes 6 à 8 dans la même liste", () => {
  const x = lireExpertises(readFileSync("supabase/migrations/0017_expertises_contenu.sql", "utf8")).find(e => e.slug === "actions");
  const h = XV.rendreMarkdown(x.methode);
  assert.match(h, /<li><strong>Par marché<\/strong>, applique le bloc concerné :<ul><li><strong>France \(fr\)<\/strong>/);
  assert.match(h, /<\/ul><\/li><li><strong>Enveloppe\.<\/strong>/);
  assert.equal((h.match(/<ol>/g) || []).length, 1);
});

test("cartesHtml : une carte UI.carte par expertise (nom, quand consulter, version), tout échappé ; liste vide → rien", () => {
  const h = XV.cartesHtml([RESUME, Object.assign({}, RESUME, { slug: "autre", nom: "Autre", version: 1, quandConsulter: "x".repeat(400) })], UI);
  assert.match(h, /^<ul class="xv-cartes">/);
  assert.equal((h.match(/<li\b/g) || []).length, 2);
  assert.ok(h.includes('data-ui-carte="essai"') && h.includes('data-ui-carte="autre"'));
  assert.ok(h.includes("Essai &lt;b&gt;"));
  assert.ok(h.includes("Quand on teste &lt;script&gt;"));
  assert.ok(h.includes("Version 3") && h.includes("Version 1"));
  assert.doesNotMatch(h, /<script|<b>/);
  assert.ok(!h.includes("x".repeat(200)), "quand consulter abrégé sur la carte");
  assert.match(h, /x…/);
  assert.equal(XV.cartesHtml([], UI), "");
  assert.equal(XV.cartesHtml(null, UI), "");
  // nom accessible : commence par le nom de l'expertise (la version, affichée en tête de carte, vient après)
  const noms = [...h.matchAll(/aria-label="([^"]*)"/g)].map(m => m[1]);
  assert.equal(noms.length, 2);
  assert.ok(noms[0].startsWith("Essai &lt;b&gt;, version 3. Quand on teste &lt;script&gt;"), noms[0]);
  assert.ok(noms[1].startsWith("Autre, version 1. x"), noms[1]);
});

test("panneauHtml (détail complet) : périmètre, marchés, méthode rendue, contrôles, garde-fous, forme, historique en accordéon, tout échappé", () => {
  const h = XV.panneauHtml(RESUME, DETAIL, { U: UI, etat: "pret", reperes: DEMO.savoir.reperes });
  assert.ok(h.includes("Version 3"));
  assert.ok(h.includes("Périmètre &lt;i&gt;de test&lt;/i&gt;."));
  assert.ok(h.includes("France") && h.includes("États-Unis"), "marchés en clair");
  assert.ok(h.includes("<h4>Objectif</h4>"), "méthode rendue");
  assert.ok(h.includes("<li>Frais connus &lt;u&gt;</li>"), "contrôles en liste, échappés");
  assert.ok(h.includes("Aucun produit recommandé."), "garde-fous");
  assert.ok(h.includes("<span>Forme de la réponse</span>"), "forme en accordéon");
  assert.ok(h.includes("<span>Historique des versions</span>"), "historique en accordéon");
  assert.ok(h.indexOf("Frais &lt;mis à jour&gt;.") < h.indexOf("Garde-fous."), "versions les plus récentes d'abord");
  assert.ok(h.includes("Prélèvement forfaitaire unique"), "repère nommé par son libellé quand il est connu");
  assert.ok(XV.panneauHtml(RESUME, Object.assign({}, DETAIL, { reperes: ["lep_taux", "inconnu_x"] }), { U: UI, etat: "pret", reperes: [] }).includes("Taux du LEP, inconnu_x"), "libellé de repli, clé en dernier recours");
  assert.ok(h.includes("Marchés"), "thèmes du savoir en clair");
  assert.doesNotMatch(h, /<script|<img|<u>|<i>|<b>/);
  for (const t of ["Périmètre", "Méthode", "Points de contrôle", "Garde-fous"]) assert.ok(h.includes(">" + t + "<"), t);
  assert.ok(h.indexOf(">Périmètre<") < h.indexOf(">Méthode<") && h.indexOf(">Méthode<") < h.indexOf(">Points de contrôle<") && h.indexOf(">Points de contrôle<") < h.indexOf(">Garde-fous<"));
  assert.doesNotMatch(h, /Chargement/);
});

test("panneauHtml : chargement, détail indisponible, détail court (démo), historique repris du journal des versions", () => {
  const c = XV.panneauHtml(RESUME, null, { U: UI, etat: "chargement" });
  assert.match(c, /Chargement de la méthode/);
  assert.ok(c.includes("Périmètre &lt;i&gt;de test&lt;/i&gt;."), "le résumé s'affiche pendant le chargement");
  assert.doesNotMatch(c, /aria-busy/, "pas d'aria-busy sur un paragraphe");
  const i = XV.panneauHtml(RESUME, null, { U: UI, etat: "indisponible" });
  assert.match(i, /Cette expertise n'est plus publiée ou n'a pas pu être lue, réessaie plus tard\./);
  assert.match(i, /réessaie plus tard/);
  const court = Object.assign({}, RESUME, { methode: null, garde_fous: null, format: null, controles: ["Un point"], changelog: [{ version: 1, le: "2026-10-11", resume: "Première version." }], versions: [] });
  const d = XV.panneauHtml(RESUME, court, { U: UI, etat: "pret", demo: true, completes: ["Allocation et risque", "ETF et fonds"] });
  assert.match(d, /[Dd]émo/);
  assert.ok(d.includes("seules deux expertises sont présentées en entier (Allocation et risque, ETF et fonds)"), "la démo indique les expertises présentées en entier");
  assert.ok(XV.panneauHtml(RESUME, court, { U: UI, etat: "pret", demo: true, completes: ["A <x>"] }).includes("seule l&#39;expertise A &lt;x&gt; est présentée en entier"));
  assert.ok(XV.panneauHtml(RESUME, court, { U: UI, etat: "pret", demo: true, completes: ["A", "B", "C"] }).includes("seules trois expertises sont présentées en entier (A, B, C)"));
  assert.match(XV.panneauHtml(RESUME, court, { U: UI, etat: "pret", demo: true }), /Démo : seules certaines expertises sont présentées en entier\./, "liste inconnue");
  assert.ok(d.includes("<li>Un point</li>"));
  assert.doesNotMatch(d, />Méthode</);
  assert.ok(d.includes("Première version."), "historique tiré du journal des versions quand l'historique est vide");
  const hors = XV.panneauHtml(RESUME, court, { U: UI, etat: "pret", demo: false });
  assert.match(hors, /n&#39;est pas disponible/);
  assert.doesNotMatch(hors, /[Dd]émo/);
});

test("gen-expertises-demo : colonnes lues dans l'en-tête de l'insert (ordre libre), '' dans les chaînes SQL, nombre de valeurs vérifié", () => {
  const sql = "insert into public.expertises (nom, slug, version,\n  statut, controles, changelog) values\n" +
    "  -- commentaire, avec 'apostrophe'\n" +
    "  ($f$L'essai$f$, 'l''essai', 2, 'publie', array['a''b', 'c, d']::text[], $j$[{\"version\":1}]$j$::jsonb),\n" +
    "  ($f$Autre$f$, '', 1, 'brouillon', array[]::text[], $j$[]$j$::jsonb)\n" +
    "on conflict (slug) do update set nom = excluded.nom;";
  assert.deepEqual(J(lireExpertises(sql)), [
    { nom: "L'essai", slug: "l'essai", version: 2, statut: "publie", controles: ["a'b", "c, d"], changelog: [{ version: 1 }] },
    { nom: "Autre", slug: "", version: 1, statut: "brouillon", controles: [], changelog: [] },
  ]);
  assert.throws(() => lireExpertises(sql.replace("'publie', ", "")), /6 colonnes, 5 valeurs/);
  assert.throws(() => lireExpertises("insert into public.expertises values ('a') on conflict (slug)"), /colonnes/);
});

test("completesDemo : expertises présentées en entier dans la démo, dérivées des données générées (= COMPLETES du générateur)", () => {
  assert.deepEqual(J(XV.completesDemo(DEMO)), COMPLETES.map(slug => DEMO.expertises.find(e => e.slug === slug).nom));
  assert.deepEqual(J(XV.completesDemo(DEMO)), ["Allocation et risque", "ETF et fonds"]);
  assert.deepEqual(J(XV.completesDemo(null)), []);
  assert.doesNotMatch(js, /Allocation et risque, ETF et fonds/, "plus de liste codée en dur");
});

test("versionsDe : historique (versions) sinon journal des versions (changelog), plus récente d'abord", () => {
  assert.deepEqual(J(XV.versionsDe(DETAIL)).map(v => v.version), [3, 2, 1]);
  assert.deepEqual(J(XV.versionsDe({ versions: [], changelog: [{ version: 1, le: "a", resume: "r1" }, { version: 2, le: "b", resume: "r2" }] })), [{ version: 2, le: "b", resume: "r2" }, { version: 1, le: "a", resume: "r1" }]);
  assert.deepEqual(J(XV.versionsDe(null)), []);
});

test("questionClaude : ClaudePrompts.phrase(\"expertise\", nom), et le bouton du panneau l'utilise", () => {
  assert.equal(XV.questionClaude("Allocation et risque", P), P.phrase("expertise", "Allocation et risque"));
  assert.match(XV.questionClaude("Allocation et risque", P), /^Boussole : consulte l'expertise Allocation et risque sur ma situation\./);
  const h = XV.panneauHtml(RESUME, DETAIL, { U: UI, etat: "pret", Prompts: P });
  assert.equal(phraseDe(XV.piedHtml(RESUME, UI, P)), P.phrase("expertise", "Essai <b>"));
  assert.doesNotMatch(h, /claude\.ai/, "le bouton est en pied de panneau, pas dans le corps");
});

test("etatVide : chargement, erreur, vide, ou rien si la liste a des expertises", () => {
  assert.equal(XV.etatVide({ ready: false }, 0), "chargement");
  assert.equal(XV.etatVide({ ready: true, error: "x" }, 0), "erreur");
  assert.equal(XV.etatVide({ ready: true, error: null }, 0), "vide");
  assert.equal(XV.etatVide({ ready: true }, 3), null);
});

test("démo : les 8 expertises publiées, détail complet pour allocation-risque et etf-fonds (repris de 0017), détail court pour les autres", () => {
  const M17 = readFileSync("supabase/migrations/0017_expertises_contenu.sql", "utf8");
  assert.deepEqual(DEMO.expertises.map(e => e.slug).sort(), ["actions", "allocation-risque", "budget-epargne", "crypto", "etf-fonds", "fiscalite-enveloppes", "immobilier-credit", "taux-obligations"]);
  for (const e of DEMO.expertises) {
    assert.ok(M17.includes("('" + e.slug + "', $f$" + e.nom + "$f$"), e.slug + " : nom repris de 0017");
    assert.ok(M17.includes("$f$" + e.quandConsulter + "$f$"), e.slug + " : quand consulter repris de 0017");
    assert.ok(M17.includes("$f$" + e.perimetre + "$f$"), e.slug + " : périmètre repris de 0017");
    assert.ok(e.controles.length >= 3);
    const complet = ["allocation-risque", "etf-fonds"].includes(e.slug);
    assert.equal(!!e.methode, complet, e.slug + " : méthode");
    assert.equal(!!e.garde_fous, complet, e.slug + " : garde-fous");
    if (complet) for (const k of ["methode", "garde_fous", "format"]) assert.ok(M17.includes("$f$" + e[k] + "$f$"), e.slug + " : " + k + " repris tel quel de 0017");
  }
});

test("démo : bloc expertises de demo-data.js à jour avec 0017 (npm run gen), évaluations jamais reprises", () => {
  assert.equal(readFileSync("web/src/demo-data.js", "utf8"), generer(), "bloc @genere:expertises périmé : lancer npm run gen");
  assert.match(readFileSync("package.json", "utf8"), /"gen": "[^"]*node scripts\/gen-expertises-demo\.mjs/);
  const xs = lireExpertises(readFileSync("supabase/migrations/0017_expertises_contenu.sql", "utf8"));
  assert.equal(xs.length, 8);
  for (const x of xs) {
    assert.ok(x.evals.length >= 10 && x.controles.length >= 3 && x.methode.length > 200, x.slug + " : lu en entier");
    const d = DEMO.expertises.find(e => e.slug === x.slug);
    assert.deepEqual(d.controles, x.controles, x.slug + " : points de contrôle");
    assert.ok(!("evals" in d), x.slug + " : pas de cas d'évaluation dans la démo");
  }
  assert.deepEqual(COMPLETES, ["allocation-risque", "etf-fonds"]);
});

/* ------------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------------ */
const attendre = () => new Promise(r => setTimeout(r, 0));
function vueDom(S0, o = {}) {
  const dom = miniDom(), { doc } = dom;
  let params = o.parametres || {};
  const modules = {}, appels = [];
  const ctx = { document: doc, console, setTimeout, clearTimeout, CSS: { escape: s => String(s).replace(/["\\]/g, "\\$&") }, DEMO: J(DEMO) };
  ctx.window = ctx; ctx.self = ctx;
  ctx.App = { register: (n, api) => { modules[n] = api; }, refreshHeadlines() {}, parametres: () => { const p = params; params = {}; return p; } };
  ctx.Store = { mode: o.mode || "demo", get: () => S0, expertises: { detail: async slug => { appels.push(slug); if (o.echec) throw new Error("réseau"); if (o.absente) return null; return J(DEMO.expertises.find(e => e.slug === slug) || null); } } };
  vm.createContext(ctx);
  vm.runInContext(uiJs, ctx, { filename: "ui.js" });
  vm.runInContext(promptsJs, ctx, { filename: "claude-prompts.js" });
  vm.runInContext(js, ctx, { filename: "expertises-view.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = html;
  const api = modules["expertises-view"];
  api.mount(root);
  api.update(S0, true);
  return { ctx, dom, doc, root, api, appels, lien: p => { params = p; } };
}
const resumes = () => DEMO.expertises.map(e => ({ slug: e.slug, nom: e.nom, quandConsulter: e.quandConsulter, perimetre: e.perimetre, version: e.version, misAJourLe: e.misAJourLe, marches: e.marches, angles: e.angles }));
const SV = () => ({ ready: true, error: null, expertises: resumes(), savoir: J(DEMO.savoir) });

test("vue (DOM) : 8 cartes ; une carte ouvre le panneau, la méthode est lue par Store.expertises.detail ; Échap rend le focus à la carte", async () => {
  const v = vueDom(SV());
  const cartes = v.root.querySelectorAll("[data-ui-carte]");
  assert.equal(cartes.length, 8);
  const c = v.root.querySelector('[data-ui-carte="etf-fonds"]');
  c.focus(); c.click();
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  assert.equal(dlg.hidden, false, "panneau ouvert");
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "ETF et fonds");
  assert.match(dlg.textContent, /Chargement de la méthode/);
  await attendre(); await attendre();
  assert.deepEqual(v.appels, ["etf-fonds"]);
  assert.doesNotMatch(dlg.textContent, /Chargement de la méthode/);
  assert.match(dlg.textContent, /Points de contrôle/);
  assert.match(dlg.textContent, /Garde-fous/);
  assert.equal(phraseDe(dlg.querySelector(".ui-panneau-pied").innerHTML), P.phrase("expertise", "ETF et fonds"));
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true);
  assert.equal(v.doc.activeElement, c, "focus rendu à la carte");
});

test("vue (DOM) : lecture du détail en échec → message dans le panneau ; liste vide et erreur de lecture signalées", async () => {
  const v = vueDom(SV(), { echec: true });
  v.root.querySelector('[data-ui-carte="crypto"]').click();
  await attendre(); await attendre();
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  assert.match(dlg.textContent, /n'a pas pu être lue, réessaie plus tard/);
  const w = vueDom({ ready: true, error: null, expertises: [] });
  assert.equal(w.root.querySelector("#xvVide").hidden, false);
  assert.equal(w.root.querySelector("#xvErr").hidden, true);
  const x = vueDom({ ready: true, error: "réseau", expertises: [] });
  assert.equal(x.root.querySelector("#xvErr").hidden, false);
  assert.equal(x.root.querySelector("#xvVide").hidden, true);
});

test("vue (DOM) : lien profond ?expertise=<slug> ouvre l'expertise au show() ; slug inconnu signalé", async () => {
  const v = vueDom(SV());
  v.lien({ expertise: "allocation-risque" });
  v.api.show();
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  assert.equal(dlg.hidden, false);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Allocation et risque");
  await attendre(); await attendre();
  v.dom.touche(v.doc.activeElement, "Escape");
  v.lien({ expertise: "inconnue" });
  v.api.show();
  assert.equal(dlg.hidden, true);
  assert.match(v.root.querySelector("#xvMsg").textContent, /introuvable|n'existe plus/);
});

test("vue (DOM) : détail null pour une expertise listée → « n'est plus publiée ou n'a pas pu être lue » ; démo : note dérivée des données", async () => {
  const v = vueDom(SV(), { absente: true });
  v.root.querySelector('[data-ui-carte="crypto"]').click();
  await attendre(); await attendre();
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  assert.match(dlg.textContent, /Cette expertise n'est plus publiée ou n'a pas pu être lue, réessaie plus tard\./);
  const w = vueDom(SV());
  w.root.querySelector('[data-ui-carte="crypto"]').click();
  await attendre(); await attendre();
  assert.match(w.doc.body.querySelector('[role="dialog"]').textContent, /seules deux expertises sont présentées en entier \(Allocation et risque, ETF et fonds\)/);
});

test("vue (DOM) : quand le détail arrive, seul le contenu est remplacé — le focus n'est pas repris par le titre, le défilement est gardé", async () => {
  const v = vueDom(SV());
  v.root.querySelector('[data-ui-carte="etf-fonds"]').click();
  const dlg = v.doc.body.querySelector('[role="dialog"]'), titre = dlg.querySelector(".ui-panneau-titre");
  const corps = dlg.querySelector(".ui-panneau-corps");
  const fermer = dlg.querySelector(".ui-panneau-fermer");
  fermer.focus(); // l'utilisateur a déjà bougé dans le panneau
  const f0 = titre.focusCount;
  corps.scrollTop = 40;
  await attendre(); await attendre();
  assert.match(dlg.textContent, /Points de contrôle/, "détail affiché");
  assert.equal(titre.focusCount, f0, "pas de nouveau focus sur le titre");
  assert.equal(v.doc.activeElement, fermer, "le focus reste où il était");
  assert.equal(corps.scrollTop, 40, "défilement conservé");
  assert.doesNotMatch(js, /aria-busy/);
});

test("vue (DOM) : lien profond — S.error : pas de « introuvable » ; lien en attente oublié quand la vue est masquée", async () => {
  const x = vueDom({ ready: true, error: "réseau", expertises: [] });
  x.lien({ expertise: "etf-fonds" });
  x.api.show();
  assert.equal(x.root.querySelector("#xvMsg").hidden, true, "pas de message trompeur : la lecture a échoué");
  assert.doesNotMatch(x.root.querySelector("#xvMsg").textContent, /introuvable/);
  // liste pas encore chargée : le lien attend ; la vue est quittée (mise à jour masquée) : il est oublié
  const v = vueDom({ ready: false, expertises: [] });
  v.lien({ expertise: "etf-fonds" });
  v.api.show();
  const dlg = () => v.doc.body.querySelector('[role="dialog"]');
  assert.equal(dlg(), null, "rien d'ouvert avant le chargement");
  v.api.update(SV(), false);
  v.api.update(SV(), true);
  v.api.show();
  assert.ok(!dlg() || dlg().hidden, "le lien d'une vue quittée ne s'ouvre pas plus tard");
  // contrôle : même chose sans quitter la vue → ouvert au chargement
  const w = vueDom({ ready: false, expertises: [] });
  w.lien({ expertise: "etf-fonds" });
  w.api.show();
  w.api.update(SV(), true);
  assert.equal(w.doc.body.querySelector('[role="dialog"]').hidden, false);
});
