// UX4 (brief docs/boussole-ux-mobile.md, P7 et vague 4) : un seul nom pour l'acteur dans l'interface, « Claude » ; « Agent » seulement pour
// l'onglet ; plus de « Copilote », de « ton assistant » ni de « l'agent » à l'écran. « Copilote patrimonial » reste l'auto-description du
// connecteur (conduite de demarrer_session, INSTRUCTIONS), que Claude lit mais que l'utilisateur ne voit pas.
// Exceptions explicites : le bloc généré des expertises de démo (copie de la migration 0017, qui s'adresse au « Copilote » : sa reformulation
// demande une migration) et la section « Assistants (Claude, ChatGPT…) » de la politique de confidentialité (sous-traitants tiers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dans = (d, re) => readdirSync(d).filter(f => re.test(f)).map(f => d + "/" + f);
const FICHIERS = [...dans("web/src", /\.(html|js)$/), ...dans("web", /\.(html|js)$/), ...dans("web/oauth", /\.(html|js)$/), ...dans("web/legal", /\.html$/)];
const EXEMPTES = new Set(["web/legal/confidentialite.html"]);
const sansCommentaires = s => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
function texte(f) {
  let s = readFileSync(f, "utf8");
  if (f === "web/src/demo-data.js") s = s.replace(/\/\* @genere:expertises — début[\s\S]*?\/\* @genere:expertises — fin \*\//, "");
  return sansCommentaires(s);
}
const INTERDIT = /\b(?:ton|un|cet|les|des) assistants?\b|\bl['’](?:assistant|agent)\b|\bton agent\b|\bton Claude\b|Copilote/gi;

test("lexique : ni « Copilote », ni « ton assistant », ni « l'agent » dans les textes de l'interface", () => {
  const fautes = [];
  for (const f of FICHIERS) {
    if (EXEMPTES.has(f)) continue;
    const t = texte(f);
    for (const m of t.matchAll(INTERDIT)) fautes.push(f + " : …" + t.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, " ") + "…");
  }
  assert.deepEqual(fautes, []);
});

test("lexique : « ton assistant » devient « Claude » aux endroits clés (accueil, consentement, compte, page d'accueil publique)", () => {
  assert.match(readFileSync("web/src/accueil.js", "utf8"), /Claude propose, tu valides\./);
  assert.match(readFileSync("web/index.html", "utf8"), /<h3>Claude remplit, tu valides<\/h3>/);
  const consent = readFileSync("web/oauth/consent.html", "utf8");
  assert.match(consent, /Retour à Claude…/);
  assert.match(consent, /<h1>Connecte-toi pour autoriser l'accès<\/h1>/);
  assert.match(readFileSync("web/compte.html", "utf8"), /<h2 id="h-mcp">Connexion de Claude<\/h2>/);
});

test("lexique : les demandes proposées par le connecteur parlent de Claude (pas de « l'agent Boussole » ni de « l'assistant »)", () => {
  const f = readFileSync("supabase/functions/mcp/formulaire.ts", "utf8"), e = readFileSync("supabase/functions/mcp/expertises.ts", "utf8");
  const i = readFileSync("supabase/functions/mcp/index.ts", "utf8");
  assert.doesNotMatch(f, /l'agent Boussole/);
  assert.match(f, /Compléter une section du bilan avec Claude/);
  assert.match(e, /sur ta situation : Claude appelle demarrer_session/);
  assert.match(i, /Premier entretien guidé \(ou reprise\) : Claude appelle demarrer_onboarding/);
  assert.match(i, /description: "Premier entretien guidé \(ou reprise\) avec Claude\."/);
});

test("titres : des noms courts (Budget mensuel, Immobilier et crédits), pas des questions au « je »", () => {
  assert.match(readFileSync("web/src/plan-view.html", "utf8"), /<h2 id="pvTitre">Budget mensuel<\/h2>/);
  assert.match(readFileSync("web/src/bilan.html", "utf8"), /<h2 id="blTitre"[^>]*>Immobilier et crédits<\/h2>/);
});
