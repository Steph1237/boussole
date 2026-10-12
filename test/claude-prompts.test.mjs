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

test("PROMPT_TACHE.revue_mensuelle : texte exact de la tâche planifiée (contrat RT1), non modifiable", () => {
  assert.equal(P.PROMPT_TACHE.revue_mensuelle,
    "Boussole : fais ma revue mensuelle. Appelle demarrer_routine avec le type revue_mensuelle et suis la conduite qu'il renvoie.");
  assert.deepEqual(Object.keys(P.PROMPT_TACHE), ["revue_mensuelle"]);
  assert.ok(Object.isFrozen(P.PROMPT_TACHE));
  assert.doesNotMatch(P.PROMPT_TACHE.revue_mensuelle, /\b(vous|votre|vos)\b/i);
});

test("phrase(\"routine\") : répondre aux questions de la revue mensuelle (demarrer_routine, formulaire, questions_routine), avec les questions en contexte", () => {
  const t = P.phrase("routine");
  assert.match(t, /^Boussole : réponds avec moi aux questions de ma revue mensuelle \(demarrer_routine, puis le formulaire, puis questions_routine\)\./);
  assert.match(t, /formulaires interactifs Boussole/);
  assert.match(P.phrase("routine", "As-tu fait un versement ce mois-ci ?"), /Concerne : As-tu fait un versement ce mois-ci \? Commence/, "une question garde son « ? », sans point ajouté");
});

test("phrase(\"revue\") : la revue du mois passe par demarrer_routine (type revue_mensuelle)", () => {
  assert.equal(P.SECTIONS.revue, "faisons ma revue du mois (demarrer_routine, type revue_mensuelle).");
  assert.match(P.phrase("revue"), /^Boussole : faisons ma revue du mois \(demarrer_routine, type revue_mensuelle\)\. Commence par demarrer_session/);
});

test("phrase(\"expertise\", nom) : active l'expertise nommée sur la situation de l'utilisateur (EX1)", () => {
  assert.equal(P.phrase("expertise", "Allocation et risque"),
    "Boussole : consulte l'expertise Allocation et risque sur ma situation. Commence par demarrer_session, puis utilise les formulaires interactifs Boussole plutôt que des questions en texte.");
  assert.doesNotMatch(P.phrase("expertise", "ETF et fonds"), /Concerne :/, "le nom fait partie de la demande, pas d'un contexte ajouté");
  assert.match(P.phrase("expertise", "  ETF\n et   fonds "), /consulte l'expertise ETF et fonds sur ma situation\./, "espaces ramenés à un");
  assert.match(P.phrase("expertise"), /^Boussole : consulte l'expertise adaptée à ma question sur ma situation\./, "sans nom : l'expertise adaptée");
  assert.ok(P.phrase("expertise", "x".repeat(500)).length < 400, "nom borné");
  assert.doesNotMatch(P.phrase("expertise", "Crypto-actifs"), /\b(vous|votre|vos)\b|conseiller/i);
});
