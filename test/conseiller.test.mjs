// Règle d'or 9 (docs/boussole-roadmap.md) : Boussole ne se présente jamais comme « conseiller » (le conseil en investissement est réglementé,
// CIF/ORIAS). On dit « Copilote patrimonial », « expertises », « professionnel du patrimoine », « ta banque »…
// Ce test balaie les textes de l'app (web/src, pages annexes de web/) et du connecteur (supabase/functions/mcp) : html, js, css, ts.
// Les commentaires du code ne sont pas des textes affichés : ils sont retirés avant la recherche (ils peuvent expliquer la règle).
//
// Exceptions, explicites (toute autre occurrence fait échouer le test) : le texte des expertises de démo (web/src/demo-data.js) est la
// copie de la migration 0017, déjà appliquée ; il dit ce que Boussole n'est PAS (« pas un conseiller en investissement ») et renvoie vers
// un professionnel réglementé. Sa reformulation (« pas un professionnel du conseil réglementé ») est prévue avec la vague UX4 (tâche 4.2),
// en même temps qu'une nouvelle migration pour que la base et la démo restent identiques. De même, la mention légale (web/legal/mentions.html)
// dit ce que Boussole n'est pas, comme l'impose le cadre réglementaire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dans = (dir, re) => readdirSync(dir).filter(f => re.test(f)).map(f => dir + "/" + f);
const FICHIERS = [...dans("web/src", /\.(html|js|css)$/), ...dans("web", /\.(html|js|css)$/), ...dans("web/oauth", /\.(html|js|css)$/), ...dans("web/legal", /\.(html|js|css)$/),
  ...dans("supabase/functions/mcp", /\.(ts|js)$/)];

const EXCEPTIONS = {
  "web/legal/mentions.html": ["n'est pas un conseiller financier, ni un conseiller en investissements financiers"],
  "web/src/demo-data.js": ["pas un conseiller en investissement", "conseiller en investissements financiers inscrit à l'ORIAS", "conseiller réglementé"],
};
/* « conseiller », « conseillère », leurs pluriels et le verbe ; « conseil financier » ; (« conseil en investissement » seul reste permis dans un avertissement). */
const INTERDIT = /conseill(?:er|ers|ère|ères|ez)(?![\p{L}])|conseil(?:s)? financier/giu;

const sansCommentaires = s => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
function texte(f) {
  let s = sansCommentaires(readFileSync(f, "utf8"));
  for (const t of EXCEPTIONS[f] || []) s = s.split(t).join("");
  return s;
}
const contexte = (s, i) => s.slice(Math.max(0, i - 50), i + 50).replace(/\s+/g, " ");

test("conseiller : la liste des fichiers couvre l'app, les pages annexes et le connecteur", () => {
  for (const f of ["web/src/risque-view.js", "web/src/claude-guide.html", "web/src/toise.html", "web/src/demo-data.js", "web/src/shell.html", "web/src/ui.css",
    "web/index.html", "web/oauth/consent.html", "web/legal/mentions.html", "supabase/functions/mcp/index.ts", "supabase/functions/mcp/formulaire.ts"])
    assert.ok(FICHIERS.includes(f), f);
  assert.ok(FICHIERS.length > 80, "assez de fichiers : " + FICHIERS.length);
});

test("conseiller : aucun « conseiller » ni « conseil financier » dans les textes de l'app et du connecteur (hors exceptions explicites)", () => {
  const fautes = [];
  for (const f of FICHIERS) { const s = texte(f); for (const m of s.matchAll(INTERDIT)) fautes.push(f + " : …" + contexte(s, m.index) + "…"); }
  assert.deepEqual(fautes, []);
});

test("conseiller : les trois remplacements de l'audit (risque-view.js, claude-guide.html, toise.html) portent leur nouvelle formulation", () => {
  assert.match(readFileSync("web/src/risque-view.js", "utf8"), /inspiré du questionnaire d'adéquation réglementaire \(MiFID II\)/);
  assert.match(readFileSync("web/src/claude-guide.html", "utf8"), /Claude te pose les questions qui manquent, une par une, dans des formulaires interactifs/);
  assert.match(readFileSync("web/src/toise.html", "utf8"), /Les points que regarde ta banque avant d'accepter un prêt\./);
});

test("conseiller : chaque exception est encore utilisée (sinon la retirer de la liste)", () => {
  for (const [f, textes] of Object.entries(EXCEPTIONS)) for (const t of textes) assert.ok(readFileSync(f, "utf8").includes(t), f + " : exception inutilisée « " + t + " »");
});

test("conseiller : le détecteur repère bien le mot (le test ne passe pas à vide), commentaires exceptés", () => {
  assert.deepEqual([..."comme un conseiller, les conseillères et le conseil financier ; conseillez".matchAll(INTERDIT)].map(m => m[0]), ["conseiller", "conseillères", "conseil financier", "conseillez"]);
  assert.deepEqual([..."un conseil en investissement, conseillé".matchAll(INTERDIT)], [], "« conseil » seul et le participe passé restent permis");
  assert.equal(sansCommentaires("a // pas conseiller\nb /* conseiller */ c <!-- conseiller -->d").includes("conseiller"), false);
});
