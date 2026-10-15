// Tutoiement partout (spec docs/superpowers/specs/2026-10-11-saisie-par-agent.md § Principe) : aucun « vous », « votre », « vos »
// ni verbe à la 2e personne du pluriel (« Vérifiez », « Réessayez »…) dans les textes de l'app (web/src/*.js, web/src/*.html),
// des pages annexes (web/*.html, web/oauth/*.html) et des pages légales (web/legal/*). Les commentaires du code ne sont pas
// des textes affichés : ils sont retirés avant la recherche.
//
// Exceptions, explicites et commentées (toute autre occurrence fait échouer le test) :
//   - libellés d'interfaces tierces cités tels quels : l'option « Utiliser votre propre client OAuth » du formulaire
//     « Ajouter un connecteur personnalisé » de Claude (accueil.js, bloc « Connecter Claude » réutilisé dans Compte › Connexion) ;
//   - le nom commun « rendez-vous » (ni vouvoiement ni verbe), dans le texte d'une expertise repris tel quel pour la démo (demo-data.js).
// Les exceptions prévues au départ pour les textes des moteurs (plan.js, pratiques.js, risque.js, bilan-etat.js, rules.js), le
// bloc moteur de toise.js et le simulateur (simu.*) ne sont plus nécessaires : ces fichiers sont passés au tutoiement
// (commit « Moteurs au tutoiement… ») ; ils restent donc couverts par ce test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dans = (dir, re) => readdirSync(dir).filter(f => re.test(f)).map(f => dir + "/" + f);
const FICHIERS = [...dans("web/src", /\.(js|html)$/), ...dans("web", /\.html$/), ...dans("web/oauth", /\.html$/), ...dans("web/legal", /\.html$/)];

/* Libellés tiers cités tels quels : { fichier: [texte exact autorisé, …] }. Chaque texte est retiré avant la recherche. */
const EXCEPTIONS = {
  "web/src/accueil.js": ["Utiliser votre propre client OAuth"], // option de l'interface de Claude (connecteur personnalisé)
  "web/src/demo-data.js": ["rendez-vous"], // nom commun (« un rendez-vous annuel »), texte de l'expertise allocation-risque repris de 0017
};
/* Mots en « -ez » qui ne sont pas des verbes à la 2e personne du pluriel. */
const MOTS_EN_EZ = new Set(["assez", "chez", "nez", "rez"]);

const sansCommentaires = s => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
function texte(f) {
  let s = sansCommentaires(readFileSync(f, "utf8"));
  for (const t of EXCEPTIONS[f] || []) s = s.split(t).join("");
  return s;
}
const VOUS = /(?<![\p{L}\p{N}_])(vous|votre|vos)(?![\p{L}\p{N}_])/giu;
const EZ = /(?<![\p{L}])(\p{L}{2,}ez)(?![\p{L}])/gu;
const contexte = (s, i) => s.slice(Math.max(0, i - 50), i + 50).replace(/\s+/g, " ");

test("tutoiement : la liste des fichiers couvre l'app, les pages annexes et les pages légales", () => {
  for (const f of ["web/src/app.js", "web/src/shell.html", "web/src/accueil.js", "web/src/landing.js", "web/src/account.js", "web/src/consent.js",
    "web/index.html", "web/compte.html", "web/oauth/consent.html", "web/legal/mentions.html", "web/legal/confidentialite.html"])
    assert.ok(FICHIERS.includes(f), f);
});

test("tutoiement : aucun « vous », « votre », « vos » hors exceptions explicites", () => {
  const fautes = [];
  for (const f of FICHIERS) { const s = texte(f); for (const m of s.matchAll(VOUS)) fautes.push(f + " : …" + contexte(s, m.index) + "…"); }
  assert.deepEqual(fautes, []);
});

test("tutoiement : aucun verbe à la 2e personne du pluriel (« Vérifiez », « Réessayez »…)", () => {
  const fautes = [];
  for (const f of FICHIERS) {
    const s = texte(f);
    for (const m of s.matchAll(EZ)) if (!MOTS_EN_EZ.has(m[1].toLowerCase())) fautes.push(f + " : " + m[1] + " — …" + contexte(s, m.index) + "…");
  }
  assert.deepEqual(fautes, []);
});

test("tutoiement : chaque exception est encore utilisée (sinon la retirer de la liste)", () => {
  for (const [f, textes] of Object.entries(EXCEPTIONS)) for (const t of textes) assert.ok(readFileSync(f, "utf8").includes(t), f + " : exception inutilisée « " + t + " »");
});

test("tutoiement : le détecteur repère bien le vouvoiement (le test ne passe pas à vide)", () => {
  assert.deepEqual([..."Vérifiez votre compte, puis reconnectez-vous ; vos données".matchAll(VOUS)].map(m => m[1]), ["votre", "vous", "vos"]);
  assert.deepEqual([..."Vérifiez, puis réessayez ; assez".matchAll(EZ)].map(m => m[1]), ["Vérifiez", "réessayez", "assez"]);
});
