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
    "Ta revue mensuelle s'activera à la fin de ton entretien avec Claude.", "Revue mensuelle active",
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
  assert.match(js, /target="_blank" rel="noopener"/);
});

test("accueil : une seule phrase, affichée à copier (étape 3) et envoyée par « Ouvrir Claude »", () => {
  assert.equal(A.PHRASE, A.PROMPT_CLAUDE);
  assert.doesNotMatch(js, /Lance l'onboarding Boussole/, "plus de seconde phrase en dur");
  assert.match(js, /champ\(id \+ "-phrase", "Phrase", PROMPT_CLAUDE\)/, "phrase affichée = constante");
  assert.match(js, /lienClaude\(PROMPT_CLAUDE\)/, "phrase envoyée = même constante");
});

/* Accueil exécuté dans un contexte vm avec un document minimal (pas de DOM disponible sous Node).
   origine : nom de l'élément qui a le focus à l'ouverture (null = <body>) ; titre : présence de #spaceTitle. */
function accueilVm({ mode, origine = null, titre = true, retiree = false, snap = {} } = {}) {
  const stock = new Map(), focus = [], ecoute = [];
  /* Zone du voyant de la revue (#acN-revue) : compte les réécritures de son contenu. */
  const revue = { ecritures: 0, _h: "", dataset: {}, classes: new Set(), get innerHTML() { return this._h; }, set innerHTML(v) { this.ecritures++; this._h = String(v); },
    classList: { toggle(c, f) { f ? revue.classes.add(c) : revue.classes.delete(c); } } };
  const el = nom => ({ nom, isConnected: true, closest: () => null, focus() { focus.push(nom); } });
  const bidon = { textContent: "", innerHTML: "", disabled: false, dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, addEventListener() {}, focus() {}, querySelector: () => bidon, querySelectorAll: () => [] };
  const dlg = { open: false, className: "", innerHTML: "", isConnected: true,
    setAttribute() {}, addEventListener(t, f) { (this.l = this.l || {})[t] = f; }, querySelector: s => (/-revue$/.test(s) ? revue : bidon), querySelectorAll: () => [],
    showModal() { this.open = true; }, close() { this.open = false; }, remove() { this.isConnected = false; } };
  const body = Object.assign(el("body"), { appendChild() {} });
  const elOrigine = origine ? el(origine) : body, elTitre = el("titre");
  if (retiree) elOrigine.isConnected = false;
  const document = { body, activeElement: elOrigine, createElement: () => dlg, getElementById: id => (id === "spaceTitle" && titre ? elTitre : null) };
  const ctx = { document, console, encodeURIComponent, Date, Math, parseInt, setTimeout,
    localStorage: { getItem: k => (stock.has(k) ? stock.get(k) : null), setItem: (k, v) => stock.set(k, String(v)), removeItem: k => stock.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {} },
    Store: { mode, get: () => snap, on(f) { ecoute.push(f); }, markOnboarded: async () => {} }, BOUSSOLE: {} };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync("web/src/routine-etat.js", "utf8"), ctx, { filename: "routine-etat.js" }); // chargé avant accueil.js (build.mjs)
  vm.runInContext(js, ctx, { filename: "accueil.js" });
  const clic = act => dlg.l.click({ target: { closest: () => ({ dataset: { act }, disabled: false }) }, preventDefault() {} });
  const emettre = S => ecoute.forEach(f => f(S));
  return { A: ctx.Accueil, stock, focus, dlg, clic, revue, emettre };
}

test("accueil : l'étape mémorisée a une clé distincte en démo (accueil-etape-v2-demo) et ne se mélange pas au compte réel", () => {
  const demo = accueilVm({ mode: "demo" });
  demo.A.open({ etape: 3 });
  assert.equal(demo.stock.get("accueil-etape-v2-demo"), "3");
  assert.equal(demo.stock.has("accueil-etape-v2"), false, "la démo n'écrit pas la clé du compte réel");
  const reel = accueilVm({ mode: "supabase" });
  reel.A.open({ etape: 2 });
  assert.equal(reel.stock.get("accueil-etape-v2"), "2");
  assert.equal(reel.stock.has("accueil-etape-v2-demo"), false);
  const croise = accueilVm({ mode: "demo" });
  croise.stock.set("accueil-etape-v2", "4");
  croise.A.open({});
  assert.equal(croise.stock.get("accueil-etape-v2-demo"), "1", "démo : repart de l'étape 1 malgré l'étape 4 du compte réel");
  const reprise = accueilVm({ mode: "supabase" });
  reprise.stock.set("accueil-etape-v2-demo", "4");
  reprise.A.open({});
  assert.equal(reprise.stock.get("accueil-etape-v2"), "1");
});

test("accueil : à la fermeture, le focus revient à l'élément d'origine (« Revoir l'accueil »), sinon au titre de la page, jamais à <body>", async () => {
  // « Reprendre plus tard » ouvert depuis « Revoir l'accueil » : retour au bouton
  const a = accueilVm({ origine: "revoir" });
  a.A.open({ etape: 1 });
  a.clic("fermer");
  assert.equal(a.dlg.isConnected, false);
  assert.deepEqual(a.focus, ["revoir"]);
  // première connexion (focus sur <body>) puis « Terminer » : repli sur le titre de la page
  const b = accueilVm({ origine: null });
  b.A.open({ etape: 4, onDone() {} });
  b.clic("suivant");
  await new Promise(r => setTimeout(r, 10));
  assert.equal(b.dlg.isConnected, false);
  assert.deepEqual(b.focus, ["titre"]);
  // origine retirée de la page : repli sur le titre
  const c = accueilVm({ origine: "revoir", retiree: true });
  c.A.open({ etape: 1 });
  c.clic("fermer");
  assert.deepEqual(c.focus, ["titre"]);
  // ni origine ni titre : rien ne plante, rien n'est focalisé
  const d = accueilVm({ origine: null, titre: false });
  d.A.open({ etape: 1 });
  assert.doesNotThrow(() => d.clic("fermer"));
  assert.deepEqual(d.focus, []);
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

test("accueil : voyant de la revue mensuelle à l'étape 4 (Store.get().routines), état par RoutineEtat.etat", () => {
  const AUJ = "2026-10-11";
  const r = o => ({ type: "revue_mensuelle", jour: 1, active: true, dernierPassage: "2026-10-01T07:00:00Z", prochainPassage: "2026-11-01", questions: [], ...o });
  assert.deepEqual(A.voyantRoutine([r()], AUJ), { actif: true, code: "a_jour", texte: "Revue mensuelle active — prochaine le 01/11" });
  assert.deepEqual(A.voyantRoutine([r({ prochainPassage: null })], AUJ), { actif: true, code: "a_jour", texte: "Revue mensuelle active" });
  for (const v of [undefined, [], [{ type: "autre", active: true }]])
    assert.equal(A.voyantRoutine(v, AUJ).texte, "Ta revue mensuelle s'activera à la fin de ton entretien avec Claude.");
  assert.equal(A.voyantRoutine([r({ active: false })], AUJ).actif, false);
  assert.match(A.voyantRoutine([r({ active: false })], AUJ).texte, /en pause/);
  assert.equal(A.voyantRoutine([r({ active: false, prochainPassage: "2026-09-01", dernierPassage: null })], AUJ).code, "pause", "en pause : jamais « en retard »");
  // en retard (même règle qu'Aujourd'hui et le connecteur)
  assert.deepEqual(A.voyantRoutine([r({ prochainPassage: "2026-10-01", dernierPassage: "2026-09-01T07:00:00Z" })], AUJ),
    { actif: true, code: "retard", texte: "Revue mensuelle en retard de 10 jours" });
  assert.equal(A.voyantRoutine([r({ prochainPassage: "2026-10-10", dernierPassage: null })], AUJ).texte, "Revue mensuelle en retard de 1 jour");
  assert.equal(A.voyantRoutine([r({ prochainPassage: "2026-10-11", dernierPassage: null })], AUJ).texte, "Revue mensuelle due aujourd'hui");
  for (const x of [r({ active: false }), r({ prochainPassage: "2026-10-01", dernierPassage: null })]) assert.doesNotMatch(A.voyantRoutine([x], AUJ).texte, /\b(vous|votre|vos)\b/i);
  // rendu de l'étape 4 : le voyant lit le store
  const actif = accueilVm({ mode: "demo", snap: { routines: [r({ prochainPassage: "2099-11-01" })] } });
  actif.A.open({ etape: 4 });
  assert.match(actif.dlg.innerHTML, /Revue mensuelle active — prochaine le 01\/11/);
  const sans = accueilVm({ mode: "demo", snap: {} });
  sans.A.open({ etape: 4 });
  assert.match(sans.dlg.innerHTML, /Ta revue mensuelle s'activera à la fin de ton entretien avec Claude\./);
  assert.match(js, /revueHtml\(S && S\.routines\)/, "mis à jour à chaque instantané du store (suivi)");
});

test("accueil : la zone annoncée du voyant (role=status) n'est réécrite que si son état change (signature actif|texte, pas innerHTML)", () => {
  const r = o => ({ type: "revue_mensuelle", jour: 1, active: true, dernierPassage: null, prochainPassage: "2099-11-01", questions: [], ...o });
  const v = accueilVm({ mode: "demo", snap: { routines: [r()] } });
  v.A.open({ etape: 4 });
  assert.match(v.dlg.innerHTML, /id="ac\d+-revue" data-sig="true\|Revue mensuelle active — prochaine le 01\/11" role="status"/, "signature posée dès le premier rendu");
  const n = v.revue.ecritures;
  for (let i = 0; i < 3; i++) v.emettre({ routines: [r()] }); // publications du store sans changement de la revue
  assert.equal(v.revue.ecritures, n, "aucune réécriture (pas de réannonce)");
  v.emettre({ routines: [r({ active: false })] });
  assert.equal(v.revue.ecritures, n + 1);
  assert.match(v.revue.innerHTML, /en pause/);
  assert.equal(v.revue.dataset.sig, "false|Revue mensuelle en pause : tu peux la réactiver dans Agent › Connexion.");
  v.emettre({ routines: [r({ prochainPassage: "2020-01-01" })] });
  assert.match(v.revue.innerHTML, /Revue mensuelle en retard de \d+ jours/);
  assert.ok(v.revue.classes.has("retard") && !v.revue.classes.has("on"), "voyant « en retard »");
  const m = v.revue.ecritures;
  v.emettre({ routines: [r({ prochainPassage: "2020-01-01" })] });
  assert.equal(v.revue.ecritures, m);
});
