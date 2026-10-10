// Accueil (web/src/accueil.{js,css}) : assistant de bienvenue en 5 étapes, ouvert par app.js à la première connexion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/accueil.js", "utf8");
const css = readFileSync("web/src/accueil.css", "utf8");
const app = readFileSync("web/src/app.js", "utf8");
const build = readFileSync("build.mjs", "utf8");
const A = require("../web/src/accueil.js");

test("accueil.js : se compile et expose Accueil.open (et le bloc de connexion réutilisable)", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "accueil.js" }));
  assert.match(js, /root\.Accueil = api/);
  assert.equal(typeof A.open, "function");
  assert.equal(typeof A.connexion, "function");
  assert.equal(typeof A.reporte, "function");
});

test("accueil : 5 étapes, dans l'ordre, et leurs contenus clés", () => {
  assert.deepEqual(A.ETAPES, ["Bienvenue", "Votre assistant", "Connecter Claude", "Lancer l'entretien", "Suivre et valider"]);
  assert.match(js, /\[e1, e2, e3, e4, e5\]\[etape - 1\]/);
  for (const t of ["Bienvenue dans Boussole", "pas du conseil en investissement réglementé", "Vos données ne sont visibles que par vous",
    "Votre assistant propose, vous validez", "Environ 15 minutes, reprenez quand vous voulez",
    "Vos réponses transitent par l\\'assistant que vous choisissez, selon ses propres conditions d\\'utilisation.",
    "Recommandé · disponible", "Bientôt", "Je n\\'utilise pas d\\'assistant",
    "<kbd>Paramètres</kbd> → <kbd>Connecteurs</kbd> → <kbd>Ajouter</kbd> → <kbd>Ajouter un connecteur personnalisé</kbd>",
    "Se connecter maintenant", "Utiliser votre propre client OAuth", "Laissez le secret vide.", "Pièges fréquents",
    "Ne mettez pas votre e-mail comme identifiant", "Se reconnecter", "<kbd>/mcp</kbd>",
    "En attente de la connexion de Claude…", "Claude est connecté", "J'ai terminé", "Sécurisez d\\'abord votre compte", "compte.html#securiser",
    "Je préfère commencer plus tard", "Examiner les propositions", "Vous pourrez relancer Claude à tout moment depuis Profil et données › Avec Claude.",
    "Reprendre plus tard"]) {
    assert.ok(js.includes(t), "texte manquant : " + t);
  }
});

test("accueil : URL du connecteur et identifiant client lus dans BOUSSOLE (rien en dur)", () => {
  assert.match(js, /B\.mcpUrl/);
  assert.match(js, /B\.claude && B\.claude\.clientId/);
  assert.doesNotMatch(js, /supabase\.co/);
  assert.doesNotMatch(js, /functions\/v1\/mcp/);
  assert.doesNotMatch(js, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.match(js, /"claude mcp add boussole -t http " \+ c\.url/);
  assert.match(js, /data-copie=/);
  assert.match(js, /navigator\.clipboard\.writeText/);
});

test("accueil : voyant branché sur Store.surveillerConnexions(true/false) et S.connexions, repli manuel", () => {
  assert.match(js, /St\.surveillerConnexions\(on\)/);
  assert.match(js, /surveiller\(etape === 3 && !anon\)/, "true sur l'étape 3, false ailleurs");
  assert.match(js, /surveiller\(false\)/, "false à la fermeture");
  assert.match(js, /typeof St\.surveillerConnexions === "function"/);
  assert.match(js, /aria-live="polite"/);
  const t0 = Date.parse("2026-10-10T10:00:00Z");
  assert.equal(A.estConnecte(undefined, t0, false), null);
  assert.equal(A.estConnecte([], t0, false), null);
  const vieux = { clientId: "x", clientNom: "Claude", dernierLe: "2026-10-09T10:00:00Z" };
  const neuf = { clientId: "x", clientNom: "Claude", dernierLe: "2026-10-10T10:00:05Z" };
  assert.equal(A.estConnecte([vieux], t0, false), null, "connexion antérieure à l'ouverture : pas encore");
  assert.equal(A.estConnecte([vieux, neuf], t0, false), neuf);
  assert.equal(A.estConnecte([vieux], t0, true), vieux, "déjà connecté à l'ouverture");
});

test("accueil : ChatGPT désactivé, « Je n'utilise pas d'assistant » ouvre les formulaires, lien claude.ai encodé", () => {
  assert.match(js, /<button type="button" class="ac-card" disabled aria-disabled="true" data-assistant="chatgpt">/);
  assert.match(js, /On\.open\(Object\.assign\(\{ profil: S1\.profil \}, o\.formulaires \|\| \{\}\)\)/);
  assert.match(js, /root\.Onboarding/);
  assert.match(js, /"https:\/\/claude\.ai\/new\?q=" \+ encodeURIComponent\(prompt\)/);
  const u = new URL(A.lienClaude(A.PROMPT_CLAUDE));
  assert.equal(u.origin + u.pathname, "https://claude.ai/new");
  assert.equal(u.searchParams.get("q"), "Utilise le connecteur Boussole : lance l'onboarding avec l'outil demarrer_onboarding.");
  assert.equal(A.PHRASE, "Lance l'onboarding Boussole");
  assert.match(js, /target="_blank" rel="noopener"/);
});

test("accueil : fin (markOnboarded, onDone), revue des propositions, étape mémorisée, Échap", () => {
  assert.match(js, /St\.markOnboarded\(\)/);
  assert.match(js, /o\.onDone\(\)/);
  assert.match(js, /App\.go\("profil\/propositions"\)/);
  assert.match(js, /BilanEtat\.etat\(S\)/);
  assert.match(js, /"accueil-etape"/);
  assert.match(js, /addEventListener\("cancel"/);
  assert.match(js, /h\.focus\(\)/, "focus sur le titre de l'étape");
});

test("app.js : Accueil.open au lieu des premiers pas quand l'onboarding n'est pas fait, ?accueil force l'ouverture", () => {
  assert.match(app, /if \(demo \|\| !S\.dbOk \|\| S\.onboardingDone\) return;/);
  assert.match(app, /Accueil\.open\(\{ formulaires: formulaires\(\) \}\)/);
  assert.match(app, /new URLSearchParams\(location\.search\)\.has\("accueil"\)/);
  assert.match(app, /if \(forceAccueil && window\.Accueil\)/);
  assert.match(app, /App\.accueil = /);
  assert.match(app, /Store\.markOnboarded\(\)/);
});

test("build.mjs : accueil après onboarding, sa feuille de style incluse", () => {
  assert.match(build, /"onboarding", "accueil", \.\.\.MODULES/);
  assert.match(build, /read\(join\(SRC, "accueil\.css"\)\)/);
});

test("accueil.css : entièrement scopé sous .accueil (fenêtre dialog.accueil ou bloc réutilisé)", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}").replace(/@keyframes[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !/^(from|to|\d+%)$/.test(s));
  assert.ok(sels.length > 30, "sélecteurs introuvables");
  const hors = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !/^(dialog)?\.accueil(\b|::|\s|$)/.test(x));
  assert.deepEqual(hors, []);
  assert.match(css, /@media \(max-width:640px\)\{\s*dialog\.accueil\{width:100vw;height:100dvh/, "plein écran sur téléphone");
});
