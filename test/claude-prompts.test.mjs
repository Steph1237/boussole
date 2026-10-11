// Phrases « Compléter avec Claude » (web/src/claude-prompts.js) : une phrase par section, au tutoiement, qui active l'agent
// Boussole et ses formulaires interactifs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const P = createRequire(import.meta.url)("../web/src/claude-prompts.js");

test("phrase : chaque section active l'agent Boussole et les formulaires interactifs", () => {
  for (const s of Object.keys(P.SECTIONS)) {
    const t = P.phrase(s);
    assert.match(t, /^Boussole : /);
    assert.match(t, /demarrer_session/);
    assert.match(t, /formulaires interactifs Boussole/);
  }
});

test("phrase : section inconnue → bilan ; contexte facultatif, borné", () => {
  assert.equal(P.phrase("inconnue"), P.phrase("bilan"));
  assert.match(P.phrase("placements", "la ligne PEA Monde"), /Concerne : la ligne PEA Monde\./);
  assert.ok(P.phrase("placements", "x".repeat(500)).length < 400);
});

test("phrase : tutoiement (aucun vous / votre)", () => {
  for (const s of Object.keys(P.SECTIONS)) assert.doesNotMatch(P.phrase(s), /\b(vous|votre|vos)\b/i);
});
