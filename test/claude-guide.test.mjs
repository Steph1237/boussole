// Agent › Connexion (web/src/claude-guide.*) ; la carte « Faire mon bilan avec Claude » de l'ancien Bilan est couverte par l'accueil et cette page.
// Saisie par l'agent (spec 2026-10-11) : plus de « Je préfère remplir moi-même » ; la page explique la saisie avec Claude (formulaires
// interactifs, fichiers déposés dans la conversation) et la veille ; tutoiement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/claude-guide.js", "utf8");
const css = readFileSync("web/src/claude-guide.css", "utf8");
const html = readFileSync("web/src/claude-guide.html", "utf8");
const bilanJs = readFileSync("web/src/bilan.js", "utf8");
const bilanHtml = readFileSync("web/src/bilan.html", "utf8");
const bilanCss = readFileSync("web/src/bilan.css", "utf8");
const G = require("../web/src/claude-guide.js");

const unscoped = (src, prefix) => {
  const c = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !/^(from|to|\d+%)$/.test(s));
  assert.ok(sels.length > 10, "sélecteurs introuvables");
  return sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith(prefix));
};

test("claude-guide.js : se compile, s'enregistre et s'appuie sur BilanEtat.etat", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "claude-guide.js" }));
  assert.match(js, /App\.register\("claude-guide", api\)/);
  assert.match(js, /window\.BilanEtat\.etat\(S\)/);
  assert.match(js, /function headline\(\) \{ const E = etat\(\); return E \? E\.pourcentage \+ " %" : ""; \}/);
});

test("claude-guide.js : parcours ouverts sur claude.ai/new?q= (encodé, nouvel onglet) et demande copiable", () => {
  assert.match(js, /"https:\/\/claude\.ai\/new\?q=" \+ encodeURIComponent\(prompt\)/);
  assert.match(js, /target="_blank" rel="noopener"/);
  assert.match(js, /navigator\.clipboard\.writeText/);
  assert.match(js, /execCommand\("copy"\)/, "repli : sélection puis copie");
  assert.deepEqual(G.PARCOURS.map(p => p.titre), ["Bilan complet", "Profil de risque", "Budget", "Placements", "Revue du mois"]);
  for (const p of G.PARCOURS) {
    assert.match(p.prompt, /connecteur Boussole/);
    assert.match(p.prompt, /etat_du_bilan/);
    const u = new URL(G.lienClaude(p.prompt));
    assert.equal(u.origin + u.pathname, "https://claude.ai/new");
    assert.equal(u.searchParams.get("q"), p.prompt);
  }
});

test("claude-guide : connecteur (adresse, Claude Code), compte anonyme, démo, liens vers les pages", () => {
  assert.match(js, /"\/functions\/v1\/mcp"/);
  assert.match(js, /Accueil\.connexion\(\$\("cgConnexion"\)\)/, "bloc de connexion partagé avec l'accueil (étapes, identifiant client, Claude Code)");
  assert.match(js, /App\.accueil\(\{ etape: 1 \}\)/, "« Revoir l'accueil »");
  assert.match(html, /data-accueil>Revoir l'accueil</);
  assert.match(js, /Auth\.isAnonymous\(s\)/);
  assert.match(js, /Store\.mode === "demo"/);
  assert.match(html, /href="compte\.html#securiser"/);
  assert.match(html, /id="cgConnexion"/);
  for (const r of ["compte/donnees", "patrimoine/budget", "patrimoine/objectifs", "pilotage/risque", "agent/propositions"]) assert.match(html, new RegExp('data-goto="' + r + '"'));
  assert.match(html, /data-goto="patrimoine\/budget">Patrimoine › Budget<\/a>/);
  assert.match(html, /data-goto="patrimoine\/objectifs">Patrimoine › Objectifs<\/a>/);
  assert.doesNotMatch(html, /Budget et objectifs/);
  const ids = [...js.matchAll(/\$\("(cg[A-Za-z0-9]+)"\)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
});

test("claude-guide.js : aucune requête DOM globale hors racine du module", () => {
  assert.deepEqual(js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l)), []);
});

test("claude-guide.css : entièrement scopé sous #view-claude-guide", () => {
  assert.deepEqual(unscoped(css, "#view-claude-guide"), []);
});

test("Faire mon bilan avec Claude : plus dans Patrimoine › Immobilier et crédits, couvert par l'accueil et Agent › Connexion (BilanEtat)", () => {
  assert.doesNotMatch(bilanHtml, /id="blClaude"|Faire mon bilan avec Claude/);
  assert.doesNotMatch(bilanJs, /BilanEtat/);
  assert.match(readFileSync("web/src/accueil.js", "utf8"), /BilanEtat\.etat\(S\)/);
  assert.match(js, /window\.BilanEtat\.etat\(S\)/);

  assert.deepEqual(unscoped(bilanCss, "#view-bilan").filter(x => !x.startsWith(".ui-panneau .bl-")), []);
});

test("claude-guide : plus de saisie dans l'app — la saisie se fait avec Claude (formulaires interactifs, fichiers déposés), Boussole affiche et fait valider", () => {
  const texte = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.doesNotMatch(html, /Je préfère remplir moi-même|remplir moi-même|à la main/);
  assert.doesNotMatch(html, /lignes, mouvements et versements programmés|revenus, dépenses, épargne<\/span>/, "plus de liste de formulaires à remplir");
  assert.match(texte, /La saisie se fait avec Claude/);
  assert.match(texte, /formulaires interactifs/);
  assert.match(texte, /fichiers que tu y déposes/);
  assert.match(texte, /Boussole affiche/);
  assert.match(texte, /valider chaque changement/);
  assert.match(html, /data-goto="agent\/propositions"/);
  for (const p of G.PARCOURS) assert.doesNotMatch(p.prompt, /coller|une question à la fois/, p.id + " : formulaires interactifs plutôt que questions en texte");
  assert.ok(G.PARCOURS.some(p => /formulaires? interactifs? Boussole/.test(p.prompt)));
});

test("claude-guide : la veille est expliquée ; la ligne « Veille » de la barre latérale mène ici", () => {
  const texte = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(html, /id="cgVeille"/);
  assert.match(texte, /La veille/);
  assert.match(texte, /ligne « Veille » de la barre latérale/);
  assert.match(texte, /8 jours/);
  assert.match(readFileSync("web/src/shell.html", "utf8"), /id="veilleLine" href="#agent\/connexion" data-goto="agent\/connexion"/);
});

test("claude-guide : tutoiement — aucun « vous / votre / vos » ni impératif au vouvoiement", () => {
  const VOUVOIEMENT = /\b(vous|votre|vos)\b/i;
  for (const [n, src] of [["claude-guide.js", js], ["claude-guide.html", html]]) {
    const t = src.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(t, VOUVOIEMENT, n);
    assert.doesNotMatch(t, /\b(Faites|Sécurisez|ajoutez|Revenez|copiez|collez|Copiez|Collez)\b/, n);
  }
  for (const p of G.PARCOURS) assert.doesNotMatch(p.desc + p.prompt, VOUVOIEMENT, p.id);
});
