// Profil et données › Avec Claude (web/src/claude-guide.*) et carte « Faire mon bilan avec Claude » du Bilan.
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

test("claude-guide : connecteur (adresse, Claude Code), compte anonyme, démo, alternative manuelle", () => {
  assert.match(js, /"\/functions\/v1\/mcp"/);
  assert.match(js, /claude mcp add boussole -t http /);
  assert.match(js, /Auth\.isAnonymous\(s\)/);
  assert.match(js, /Store\.mode === "demo"/);
  assert.match(html, /href="compte\.html#securiser"/);
  assert.match(html, /Paramètres → Connecteurs → Ajouter un connecteur personnalisé/);
  for (const r of ["profil/donnees", "avenir/plan", "diagnostic/risque", "profil/propositions"]) assert.match(html, new RegExp('data-goto="' + r + '"'));
  const ids = [...js.matchAll(/\$\("(cg[A-Za-z0-9]+)"\)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
});

test("claude-guide.js : aucune requête DOM globale hors racine du module", () => {
  assert.deepEqual(js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l)), []);
});

test("claude-guide.css : entièrement scopé sous #view-claude-guide", () => {
  assert.deepEqual(unscoped(css, "#view-claude-guide"), []);
});

test("Bilan : carte « Faire mon bilan avec Claude » tant que l'état est sous 100 %, masquable pour la session", () => {
  assert.match(bilanHtml, /id="blClaude"[\s\S]*Faire mon bilan avec Claude[\s\S]*data-goto="profil\/claude"[^>]*>Commencer</);
  assert.match(bilanJs, /window\.BilanEtat\.etat\(S\)/);
  assert.match(bilanJs, /E\.pourcentage >= 100/);
  assert.match(bilanJs, /sessionStorage\.setItem\(CLAUDE_KEY, "1"\)/);
  assert.deepEqual(unscoped(bilanCss, "#view-bilan"), []);
});
