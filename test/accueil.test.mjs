// Accueil (web/src/accueil.{js,css}) : assistant de bienvenue en 4 étapes, sans formulaire, ouvert par app.js à la première connexion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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

test("accueil : 4 étapes (plus de choix « sans assistant »), dans l'ordre, et leurs contenus clés au tutoiement", () => {
  assert.deepEqual(A.ETAPES, ["Bienvenue", "Connecter Claude", "Lancer l'entretien", "Suivre et valider"]);
  assert.match(js, /\[e1, e2, e3, e4\]\[etape - 1\]/);
  for (const t of ["Bienvenue dans Boussole", "pas du conseil en investissement réglementé", "Tes données ne sont visibles que par toi",
    "Tu valides", "Ton assistant propose, tu valides.", "Environ 15 minutes, reprends quand tu veux.",
    "Tes réponses transitent par ton assistant, selon ses propres conditions d\\'utilisation.",
    "Boussole fonctionne avec ton assistant", "Disponible", "Bientôt", "ChatGPT",
    "<kbd>Paramètres</kbd> → <kbd>Connecteurs</kbd> → <kbd>Ajouter</kbd> → <kbd>Ajouter un connecteur personnalisé</kbd>",
    "Se connecter maintenant", "Utiliser votre propre client OAuth", "Laisse le secret vide.", "Pièges fréquents",
    "Ne mets pas ton e-mail comme identifiant", "vérifie ton compte", "authentifie-toi", "Se reconnecter", "<kbd>/mcp</kbd>",
    "En attente de la connexion de Claude…", "Claude est connecté", "J'ai terminé", "Sécurise d\\'abord ton compte", "compte.html#securiser",
    "formulaires interactifs", "Je préfère commencer plus tard", "Examiner les propositions",
    "Claude te proposera d'activer ta revue mensuelle ; elle s'affichera ici.",
    "Tu pourras relancer Claude à tout moment depuis Agent › Connexion.", "Reprendre plus tard"]) {
    assert.ok(js.includes(t), "texte manquant : " + t);
  }
});

test("accueil : aucun formulaire ni parcours sans assistant (Boussole fonctionne avec un assistant)", () => {
  for (const motif of [/Je n\\?'utilise pas d\\?'assistant/, /root\.Onboarding|Onboarding\.open|sansAssistant|data-act="sans"/, /o\.formulaires/, /<form|<input|<select|<textarea|type="submit"/])
    assert.doesNotMatch(js, motif);
  assert.doesNotMatch(app, /Onboarding|formulaires\(\)|Store\.db\.|addMany/, "app.js : plus de premiers pas en formulaires");
  // ChatGPT annoncé « bientôt », non cliquable ; Claude disponible.
  assert.match(js, /assistant\("bulle", "ChatGPT", "Bientôt", [^)]*, false\)/);
  assert.match(js, /assistant\("claude", "Claude", "Disponible", [^)]*, true\)/);
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
  assert.match(js, /surveiller\(etape === CONNEXION && !anon\)/, "true sur l'étape de connexion, false ailleurs");
  assert.match(js, /CONNEXION = 2/);
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

test("accueil : phrase d'onboarding et lien claude.ai encodé", () => {
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
  assert.match(js, /App\.go\("agent\/propositions"\)/);
  assert.match(js, /BilanEtat\.etat\(S\)/);
  assert.match(js, /"accueil-etape-v2"/);
  assert.match(js, /ecrire\(CLE_ANCIENNE, null\)/, "l'ancienne clé (5 étapes) est effacée");
  assert.match(js, /addEventListener\("cancel"/);
  assert.match(js, /h\.focus\(\)/, "focus sur le titre de l'étape");
});

test("app.js : Accueil.open quand l'onboarding n'est pas fait, ?accueil force l'ouverture", () => {
  assert.match(app, /if \(demo \|\| !S\.dbOk \|\| S\.onboardingDone\) return;/);
  assert.match(app, /if \(!Accueil\.reporte\(\)\) Accueil\.open\(\{\}\)/);
  assert.match(app, /new URLSearchParams\(location\.search\)\.has\("accueil"\)/);
  assert.match(app, /if \(forceAccueil\) \{ onboardingShown = true; Accueil\.open\(\{ etape: 1 \}\)/);
  assert.match(app, /App\.accueil = /);
  assert.match(js, /St\.markOnboarded\(\)/, "seule écriture de l'accueil : onboarding terminé");
});

test("build.mjs : accueil chargé, sa feuille de style incluse, onboarding / import / assistant retirés", () => {
  assert.match(build, /"pratiques", "accueil", \.\.\.MODULES/);
  assert.match(build, /read\(join\(SRC, "accueil\.css"\)\)/);
  assert.doesNotMatch(build, /"onboarding"|"import"|"assistant"|onboarding\.css|import\.css/);
  for (const f of ["onboarding.js", "onboarding.css", "import.js", "import.css", "assistant.js"]) assert.ok(!existsSync("web/src/" + f), f + " supprimé");
});

test("accueil.css : entièrement scopé sous .accueil (fenêtre dialog.accueil ou bloc réutilisé)", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}").replace(/@keyframes[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !/^(from|to|\d+%)$/.test(s));
  assert.ok(sels.length > 30, "sélecteurs introuvables");
  const hors = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !/^(dialog)?\.accueil(\b|::|\s|$)/.test(x));
  assert.deepEqual(hors, []);
  assert.match(css, /@media \(max-width:640px\)\{\s*dialog\.accueil\{width:100vw;height:100dvh/, "plein écran sur téléphone");
});
