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

test("phrase : contexte long coupé au dernier espace avec « … », jamais en plein mot (revue M2)", () => {
  const mots = "Le compte courant commun est compté comme épargne de précaution et il faudra vérifier cela avec les relevés bancaires du mois prochain";
  const t = P.phrase("placements", "l'hypothèse « " + mots + " » à confirmer");
  const ctx = t.slice(t.indexOf("Concerne : ") + 11, t.indexOf(" Commence par"));
  assert.ok(ctx.endsWith("…"), ctx);
  assert.ok(ctx.length <= 121, "120 caractères au plus, plus « … »");
  const coupe = ctx.slice(0, -1);
  assert.ok(("l'hypothèse « " + mots + " » à confirmer").startsWith(coupe + " "), "coupé juste avant un espace : " + coupe);
  assert.doesNotMatch(coupe, /[\s,;:]$/, "pas d'espace ni de ponctuation avant « … »");
  // court : inchangé, avec un point final ; espaces multiples ramenés à un
  assert.match(P.phrase("placements", "  la ligne\n PEA   Monde "), /Concerne : la ligne PEA Monde\. Commence/);
  // un seul mot trop long : coupé à la limite, avec « … »
  const long = P.phrase("placements", "x".repeat(300));
  assert.match(long, /Concerne : x{119}… Commence/);
});

test("phrase : sections réglages cohérentes avec le connecteur (matelas, versements programmés)", () => {
  assert.match(P.phrase("regles"), /mes règles d'alerte et la cible de mon matelas de précaution\./);
  assert.match(P.phrase("versements"), /aide-moi à régler mes versements programmés/);
});

test("phrase : tutoiement (aucun vous / votre)", () => {
  for (const s of Object.keys(P.SECTIONS)) assert.doesNotMatch(P.phrase(s), /\b(vous|votre|vos)\b/i);
});
