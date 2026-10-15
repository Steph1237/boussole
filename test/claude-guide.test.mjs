// Compte › Connecter Claude (web/src/claude-guide.*) ; la carte « Faire mon bilan avec Claude » de l'ancien Bilan est couverte par l'accueil et cette page.
// Saisie par l'agent (spec 2026-10-11) : plus de « Je préfère remplir moi-même » ; la page explique la saisie avec Claude (formulaires
// interactifs, fichiers déposés dans la conversation) et la veille ; tutoiement.
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

test("claude-guide : connecteur (adresse, Claude Code), compte anonyme, démo, liens vers les pages", () => {
  assert.match(js, /"\/functions\/v1\/mcp"/);
  assert.match(js, /Accueil\.connexion\(\$\("cgConnexion"\)\)/, "bloc de connexion partagé avec l'accueil (étapes, identifiant client, Claude Code)");
  assert.match(js, /App\.accueil\(\{ etape: 1 \}\)/, "« Revoir l'accueil »");
  assert.match(html, /data-accueil>Revoir l'accueil</);
  assert.match(js, /Auth\.isAnonymous\(s\)/);
  assert.match(js, /Store\.mode === "demo"/);
  assert.match(html, /href="compte\.html#securiser"/);
  assert.match(html, /id="cgConnexion"/);
  for (const r of ["compte/donnees", "patrimoine/budget", "patrimoine/objectifs", "pilotage/risque", "agent/propositions"]) assert.match(html, new RegExp('data-goto="' + r + '"'));
  assert.match(html, /data-goto="patrimoine\/budget">Patrimoine › Budget<\/a>/);
  assert.match(html, /data-goto="patrimoine\/objectifs">Patrimoine › Objectifs<\/a>/);
  assert.doesNotMatch(html, /Budget et objectifs/);
  const ids = [...js.matchAll(/\$\("(cg[A-Za-z0-9]+)"\)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
});

test("claude-guide.js : aucune requête DOM globale hors racine du module", () => {
  assert.deepEqual(js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l)), []);
});

test("claude-guide.css : entièrement scopé sous #view-claude-guide", () => {
  assert.deepEqual(unscoped(css, "#view-claude-guide"), []);
});

test("Faire mon bilan avec Claude : plus dans Patrimoine › Immobilier et crédits, couvert par l'accueil et Compte › Connecter Claude (BilanEtat)", () => {
  assert.doesNotMatch(bilanHtml, /id="blClaude"|Faire mon bilan avec Claude/);
  assert.doesNotMatch(bilanJs, /BilanEtat/);
  assert.match(readFileSync("web/src/accueil.js", "utf8"), /BilanEtat\.etat\(S\)/);
  assert.match(js, /window\.BilanEtat\.etat\(S\)/);

  assert.deepEqual(unscoped(bilanCss, "#view-bilan").filter(x => !x.startsWith(".ui-panneau .bl-")), []);
});

test("claude-guide : plus de saisie dans l'app — la saisie se fait avec Claude (formulaires interactifs, fichiers déposés), Boussole affiche et fait valider", () => {
  const texte = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.doesNotMatch(html, /Je préfère remplir moi-même|remplir moi-même|à la main/);
  assert.doesNotMatch(html, /lignes, mouvements et versements programmés|revenus, dépenses, épargne<\/span>/, "plus de liste de formulaires à remplir");
  assert.match(texte, /La saisie se fait avec Claude/);
  assert.match(texte, /formulaires interactifs/);
  assert.match(texte, /fichiers que tu y déposes/);
  assert.match(texte, /Boussole affiche/);
  assert.match(texte, /valider chaque changement/);
  assert.match(html, /data-goto="agent\/propositions"/);
  for (const p of G.PARCOURS) assert.doesNotMatch(p.prompt, /coller|une question à la fois/, p.id + " : formulaires interactifs plutôt que questions en texte");
  assert.ok(G.PARCOURS.some(p => /formulaires? interactifs? Boussole/.test(p.prompt)));
});

test("claude-guide : la veille est expliquée ; la ligne « Veille » de la barre latérale mène ici", () => {
  const texte = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(html, /id="cgVeille"/);
  assert.match(texte, /La veille/);
  assert.match(texte, /ligne « Veille » de la barre latérale/);
  assert.match(texte, /8 jours/);
  assert.match(readFileSync("web/src/shell.html", "utf8"), /id="veilleLine" href="#compte\/connexion" data-goto="compte\/connexion"/);
});

test("claude-guide : tutoiement — aucun « vous / votre / vos » ni impératif au vouvoiement", () => {
  const VOUVOIEMENT = /\b(vous|votre|vos)\b/i;
  for (const [n, src] of [["claude-guide.js", js], ["claude-guide.html", html]]) {
    const t = src.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(t, VOUVOIEMENT, n);
    assert.doesNotMatch(t, /\b(Faites|Sécurisez|ajoutez|Revenez|copiez|collez|Copiez|Collez)\b/, n);
  }
  for (const p of G.PARCOURS) assert.doesNotMatch(p.desc + p.prompt, VOUVOIEMENT, p.id);
});

/* ---------- Ta revue mensuelle (routine RT1) : routinesHtml(S, auj, U), pur ---------- */
const P = require("../web/src/claude-prompts.js");
const RE = require("../web/src/routine-etat.js");
import { miniDom } from "./helpers/mini-dom.mjs";
const PROMPT_TACHE = "Boussole : fais ma revue mensuelle. Appelle demarrer_routine avec le type revue_mensuelle et suis la conduite qu'il renvoie.";
const AUJ = "2026-10-11";
const routine = o => ({ type: "revue_mensuelle", jour: 1, active: true, consentementJournal: true, dernierPassage: "2026-10-01T07:30:00Z",
  dernierClient: "Claude", prochainPassage: "2026-11-01", questions: [], synthese: "", ...o });
const texteDe = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const UFaux = { demanderAClaude: (q, l) => '<a class="ui-claude" href="' + G.lienClaude(q) + '">' + l + "</a>" };

test("routines : section « Ta revue mensuelle » après « En trois étapes », rendue par routinesHtml", () => {
  assert.match(html, /<section class="panel cg-routines" id="cgRoutines" aria-labelledby="cgRtTitle">/);
  assert.match(html, /<h2 id="cgRtTitle">Ta revue mensuelle<\/h2>/);
  assert.ok(html.indexOf('id="cgStepsTitle"') < html.indexOf('id="cgRoutines"') && html.indexOf('id="cgRoutines"') < html.indexOf('id="cgAltTitle"'));
  assert.equal(typeof G.routinesHtml, "function");
  assert.match(js, /routinesHtml\(S, RE\(\)\.aujParis\(\), window\.UI \|\| null, \{ erreur: erreurRt \}\)/, "jour de Paris, comme le serveur");
});

test("routines : état « Active » à jour — dernière revue, prochaine, bascule cochée", () => {
  const h = G.routinesHtml({ routines: [routine()] }, AUJ, UFaux), t = texteDe(h);
  assert.match(h, /cg-rt-voyant on/);
  assert.match(t, /Active/);
  assert.match(t, /Dernière revue le 01\/10 \(par Claude\)/);
  assert.match(t, /Prochaine le 01\/11/);
  assert.doesNotMatch(t, /En retard|Due aujourd'hui|Jamais passée/);
  // nom accessible = texte visible : ni aria-label redondant, ni texte masqué aux lecteurs d'écran
  assert.match(h, /role="switch" aria-checked="true" data-cg-routine="revue_mensuelle"><span class="cg-rt-piste" aria-hidden="true">.*<\/span><span class="cg-rt-switch-t">Revue mensuelle active<\/span><\/button>/);
  assert.doesNotMatch(h, /aria-label="Revue mensuelle active"|cg-rt-switch-t" aria-hidden/);
  assert.doesNotMatch(h, /Lancer ma revue avec Claude/);
  const E = RE.etat([routine()], AUJ);
  assert.equal(E.code, "a_jour"); assert.equal(E.retard, null);
});

test("routines : état « En retard » — prochain passage dépassé sans passage depuis (règle du plan), « Due aujourd'hui » à 0 jour", () => {
  const r = routine({ dernierPassage: "2026-09-01T07:00:00Z", prochainPassage: "2026-10-01" });
  const h = G.routinesHtml({ routines: [r] }, AUJ, UFaux), t = texteDe(h);
  assert.match(h, /cg-rt-voyant retard/);
  assert.match(t, /Dernière revue le 01\/09 \(par Claude\)/);
  assert.match(t, /En retard de 10 jours/);
  assert.doesNotMatch(t, /Prochaine le/);
  assert.match(h, /Lancer ma revue avec Claude/);
  assert.equal(RE.etat([r], AUJ).retard, 10);
  assert.match(texteDe(G.routinesHtml({ routines: [r] }, "2026-10-02", UFaux)), /En retard de 1 jour(?!s)/);
  assert.match(texteDe(G.routinesHtml({ routines: [r] }, "2026-10-01", UFaux)), /Due aujourd'hui/);
  // jamais passée et due
  const j = RE.etat([routine({ dernierPassage: null, dernierClient: null, prochainPassage: "2026-10-05" })], AUJ);
  assert.equal(j.code, "retard"); assert.equal(j.retard, 6);
  assert.match(texteDe(G.routinesHtml({ routines: [routine({ dernierPassage: null, prochainPassage: "2026-10-05" })] }, AUJ)), /Jamais passée/);
  // passée le jour même du prochain passage : pas en retard
  assert.equal(RE.etat([routine({ dernierPassage: "2026-10-01T09:00:00Z", prochainPassage: "2026-10-01" })], AUJ).code, "a_jour");
  // dernier passage tard le soir à Paris (UTC de la veille) : compté au jour de Paris
  assert.equal(RE.etat([routine({ dernierPassage: "2026-09-30T22:30:00Z", prochainPassage: "2026-10-01" })], AUJ).code, "a_jour");
  assert.doesNotMatch(texteDe(G.routinesHtml({ routines: [routine({ dernierPassage: "2026-09-30T22:30:00Z", prochainPassage: "2026-10-01" })] }, AUJ)), /En retard/);
});

test("routines : état « En pause » — bascule décochée, pas de retard réclamé", () => {
  const r = routine({ active: false, dernierPassage: "2026-09-01T07:00:00Z", prochainPassage: "2026-10-01" });
  const h = G.routinesHtml({ routines: [r] }, AUJ, UFaux), t = texteDe(h);
  assert.match(h, /cg-rt-voyant off/);
  assert.match(t, /En pause/);
  assert.match(h, /role="switch" aria-checked="false"/);
  assert.doesNotMatch(t, /En retard|Prochaine le|Lancer ma revue/);
  assert.match(t, /Réactive-la avec la bascule/);
  assert.equal(RE.etat([r], AUJ).code, "pause");
});

test("routines : état « Pas encore activée » — phrase et bouton qui ouvre Claude avec « Active ma revue mensuelle Boussole »", () => {
  const LU = { ready: true, dbOk: true, routinesLues: true };
  const h = G.routinesHtml({ ...LU, routines: [] }, AUJ, UFaux), t = texteDe(h);
  assert.match(t, /Pas encore activée/);
  assert.match(t, /Elle s'active à la fin de ton premier entretien avec Claude, ou demande-lui : « Active ma revue mensuelle Boussole »\./);
  assert.ok(h.includes(G.lienClaude("Active ma revue mensuelle Boussole")));
  assert.doesNotMatch(h, /role="switch"/, "rien à basculer sans routine");
  // sans bibliothèque UI : lien de repli, nouvel onglet
  const h2 = G.routinesHtml({ ...LU, routines: [] }, AUJ);
  assert.match(h2, /href="https:\/\/claude\.ai\/new\?q=Active%20ma%20revue%20mensuelle%20Boussole" target="_blank" rel="noopener"/);
  // routines pas encore lues (store sans le contrat, ou pas chargé) : ni « pas activée » ni bascule
  const h3 = G.routinesHtml({ ready: false, routines: [], routinesLues: false }, AUJ, UFaux);
  assert.match(texteDe(h3), /Lecture de ta routine…/);
  assert.doesNotMatch(h3, /Pas encore activée|role="switch"/);
  const h4 = G.routinesHtml({ ready: true, routines: [], routinesLues: false }, AUJ, UFaux);
  assert.match(texteDe(h4), /indisponible pour le moment/, "table absente : [] n'est pas « pas activée »");
  assert.doesNotMatch(h4, /Pas encore activée|role="switch"/);
  assert.match(texteDe(G.routinesHtml({ ready: true, dbOk: true, routines: [], routinesLues: true }, AUJ, UFaux)), /Pas encore activée/);
  assert.match(texteDe(G.routinesHtml({ ready: true, dbOk: false, routines: [], routinesLues: true }, AUJ, UFaux)), /indisponible/, "sans base : pas « à activer » (même règle qu'Aujourd'hui)");
  assert.match(texteDe(G.routinesHtml({ ready: true }, AUJ, UFaux)), /indisponible/, "store sans le contrat routines");
  assert.match(texteDe(G.routinesHtml({ ready: true, routines: [] }, AUJ, UFaux)), /indisponible/, "store ancien, sans routinesLues");
});

test("routines : questions en attente (nombre, liste, « Répondre avec Claude »)", () => {
  const qs = [{ question: "As-tu fait un versement sur ton PEA ce mois-ci ?", pourquoi: "Le solde a bougé.", champ: "mouvement" },
    { question: "Ton salaire a-t-il changé ?", pourquoi: "" }];
  const h = G.routinesHtml({ routines: [routine({ questions: qs })] }, AUJ, UFaux), t = texteDe(h);
  assert.match(t, /2 questions en attente de ta réponse/);
  assert.match(t, /As-tu fait un versement sur ton PEA ce mois-ci \? Le solde a bougé\./);
  assert.match(h, /Répondre avec Claude/);
  const url = h.match(/href="([^"]+)">Répondre avec Claude/)[1];
  const q = new URL(url.replace(/&amp;/g, "&")).searchParams.get("q");
  // URL préremplie : le nombre de questions seulement, jamais leur texte (écrit par une exécution planifiée de l'agent)
  assert.equal(q, P.phrase("routine", "2 questions en attente"));
  assert.equal(q, RE.phraseRoutine(qs), "même phrase que la boîte d'Aujourd'hui (RoutineEtat.phraseRoutine)");
  assert.doesNotMatch(q, /versement|salaire/i);
  const AJ = require("../web/src/aujourdhui.js");
  const it = AJ.boite({ ready: true, dbOk: true, routinesLues: true, routines: [routine({ questions: qs })] }, AUJ, { Rules: null }).find(x => x.type === "routine");
  assert.equal(new URL(it.action.url).searchParams.get("q"), q, "Aujourd'hui et Connexion : même phrase");
  assert.match(texteDe(G.routinesHtml({ routines: [routine({ questions: [qs[1]] })] }, AUJ, UFaux)), /1 question en attente/);
  assert.doesNotMatch(texteDe(G.routinesHtml({ routines: [routine()] }, AUJ, UFaux)), /en attente/);
});

test("routines : prompt de la tâche planifiée (exact, = ClaudePrompts.PROMPT_TACHE ou repli identique), Copier, 4 étapes", () => {
  assert.equal(G.PROMPT_TACHE_REPLI, PROMPT_TACHE);
  if (P.PROMPT_TACHE) assert.equal(P.PROMPT_TACHE.revue_mensuelle, PROMPT_TACHE);
  for (const S of [{}, { routines: [] }, { routines: [routine()] }, { routines: [routine({ active: false })] }]) {
    const h = G.routinesHtml(S, AUJ, UFaux);
    assert.ok(h.includes('<pre id="cgRtPrompt">Boussole : fais ma revue mensuelle. Appelle demarrer_routine avec le type revue_mensuelle et suis la conduite qu&#39;il renvoie.</pre>'));
    assert.match(h, /data-cg-copier-tache>.*Copier<span class="cg-sr"> le prompt de la tâche planifiée<\/span><\/button>/, "nom accessible explicite");
    for (const e of G.ETAPES_TACHE) assert.ok(h.includes(e.replace(/'/g, "&#39;")), e);
  }
  assert.deepEqual(G.ETAPES_TACHE, [
    "Dans Claude, ouvre les tâches planifiées et crée une nouvelle tâche.",
    "Colle le prompt de ta revue tel quel, sans le modifier.",
    "Choisis la fréquence « Chaque mois » et le jour de ta revue.",
    "Vérifie que le connecteur Boussole est activé pour cette tâche, puis enregistre-la.",
  ]);
  assert.match(texteDe(G.routinesHtml({ routines: [routine()] }, AUJ)), /Fréquence : chaque mois, le 1er\./);
  assert.match(texteDe(G.routinesHtml({ routines: [routine({ jour: 15 })] }, AUJ)), /Fréquence : chaque mois, le 15\./);
  assert.match(js, /navigator\.clipboard\.writeText/);
  assert.match(js, /flash\(b, ok\)/, "retour « Copié » sur le bouton");
  assert.match(js, /data-cg-copier-tache/);
});

test("routines : échappement de tout texte venu des données (questions, pourquoi, client, erreur)", () => {
  const r = routine({ dernierClient: '<img src=x onerror="alert(1)">', questions: [{ question: "<script>alert(1)</script>", pourquoi: '"><b>x</b>' }] });
  const h = G.routinesHtml({ routines: [r] }, AUJ, UFaux, { erreur: "<i>oups</i>" });
  assert.doesNotMatch(h, /<script>|<img |<i>oups|"><b>x/);
  assert.match(h, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(h, /\(par &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;\)/);
  assert.match(h, /<p class="cg-rt-err" role="alert">&lt;i&gt;oups&lt;\/i&gt;<\/p>/, "erreur de la bascule affichée en ligne");
});

test("routines : seule écriture = Store.routines.pause(type, enPause), erreur affichée en ligne", () => {
  assert.match(js, /window\.Store\.routines\.pause\(type, active\)/, "active → enPause = true ; en pause → false");
  assert.match(js, /res && res\.ok/);
  assert.match(css, /\.cg-rt-switch\[aria-checked="true"\]/);
});

test("routines (CSS) : cible tactile de 44 px sur écran tactile ; pas de règle sans effet sur le voyant « attente »", () => {
  assert.match(css, /@media \(pointer:coarse\)\{[^}]*\.cg-rt-switch\{[^}]*min-height:44px/);
  assert.doesNotMatch(css, /\.cg-rt-voyant\.attente\{[^}]*font-weight:400/, "le <b> intérieur l'emportait : règle sans effet");
  assert.match(css, /\.cg-rt-voyant\.attente b\{font-weight:400\}/);
});

/* Bascule en vm (mini-DOM) : le vrai module monté sur claude-guide.html, Store.routines.pause espionné. */
function guideVm(reponses) {
  const dom = miniDom(), { doc } = dom, reg = {}, appels = [], timers = [];
  const ctx = { document: doc, console, Intl, Date, Math, JSON, encodeURIComponent, navigator: {},
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {},
    App: { register: (n, a) => { reg[n] = a; } },
    Store: { mode: "demo", routines: { pause: async (type, enPause) => {
      appels.push([type, enPause]);
      await new Promise(r => setImmediate(r));
      const x = reponses.shift();
      if (x instanceof Error) throw x;
      return x;
    } } } };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ["claude-prompts.js", "routine-etat.js"]) vm.runInContext(readFileSync("web/src/" + f, "utf8"), ctx, { filename: f });
  vm.runInContext(js, ctx, { filename: "claude-guide.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = html;
  const api = reg["claude-guide"];
  api.mount(root);
  api.update({ ready: true, dbOk: true, routinesLues: true, propositions: [], routines: [routine({ prochainPassage: "2099-01-01" })] }, true);
  const bascule = () => root.querySelector("[data-cg-routine]");
  const fin = async () => { for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r)); }; // l'appel se résout au premier tour
  return { doc, root, api, appels, timers, bascule, fin, alerte: () => root.querySelector(".cg-rt-err"), msg: () => root.querySelector("#cgRtMsg").textContent };
}

test("bascule (vm) : succès — aria-busy pendant l'appel, un seul appel, bouton réactivé, focus rendu, message effacé après 5 s", async () => {
  const v = guideVm([{ ok: true }]);
  const b = v.bascule();
  assert.equal(b.getAttribute("aria-checked"), "true");
  b.click(); b.click(); // double clic pendant l'appel : ignoré
  assert.equal(b.getAttribute("aria-busy"), "true", "occupé pendant l'appel");
  assert.equal(b.disabled, true);
  await v.fin();
  assert.deepEqual(v.appels, [["revue_mensuelle", true]], "un seul appel ; active → en pause");
  const b2 = v.bascule();
  assert.equal(b2.getAttribute("aria-checked"), "false");
  assert.ok(!b2.disabled && !b2.hasAttribute("disabled"), "bouton actif");
  assert.equal(b2.getAttribute("aria-busy"), null);
  assert.ok(!b.disabled && b.getAttribute("aria-busy") === null, "réactivé juste après l'appel");
  assert.equal(v.doc.activeElement, b2, "focus rendu à la bascule");
  assert.equal(v.msg(), "Revue mensuelle mise en pause.");
  assert.equal(v.alerte(), null);
  const t = v.timers.find(x => x.ms === 5000);
  assert.ok(t, "effacement programmé à 5 s");
  t.f();
  assert.equal(v.msg(), "");
});

test("bascule (vm) : erreur rédigée pour l'utilisateur affichée telle quelle ; même erreur deux fois réannoncée ; exception → « Réessaie. »", async () => {
  const MSG = "Routine introuvable : demande à Claude de l'activer.";
  const v = guideVm([{ erreur: MSG }, { erreur: MSG }, new Error("fetch failed")]);
  v.bascule().click();
  await v.fin();
  const a1 = v.alerte();
  assert.ok(a1, "erreur affichée en ligne");
  assert.equal(a1.getAttribute("role"), "alert");
  assert.equal(a1.textContent, MSG, "telle quelle, sans « Réessaie. »");
  assert.equal(v.bascule().getAttribute("aria-checked"), "true", "état inchangé");
  assert.ok(!v.bascule().disabled);
  assert.equal(v.doc.activeElement, v.bascule(), "focus rendu à la bascule");
  // même erreur une deuxième fois : la zone d'alerte est reposée (nouvel élément), donc réannoncée
  v.bascule().click();
  await v.fin();
  const a2 = v.alerte();
  assert.equal(a2.textContent, MSG);
  assert.notEqual(a2, a1, "zone d'alerte reposée");
  assert.equal(v.doc.activeElement, v.bascule());
  // exception (erreur technique) : message générique, sans détail technique
  v.bascule().click();
  await v.fin();
  assert.equal(v.alerte().textContent, "Changement impossible pour le moment. Réessaie.");
  assert.doesNotMatch(v.alerte().textContent, /fetch/);
  assert.ok(!v.bascule().disabled);
  assert.equal(v.doc.activeElement, v.bascule());
  assert.deepEqual(v.appels.map(x => x[1]), [true, true, true]);
});

test("routines : tutoiement dans tous les états", () => {
  const VOUVOIEMENT = /\b(vous|votre|vos)\b/i;
  const etats = [{}, { routines: [], routinesLues: true, dbOk: true }, { routines: [routine({ questions: [{ question: "Q ?" }] })] }, { routines: [routine({ active: false })] },
    { routines: [routine({ prochainPassage: "2026-10-01", dernierPassage: null })] }];
  for (const S of etats) assert.doesNotMatch(texteDe(G.routinesHtml(S, AUJ)), VOUVOIEMENT);
  for (const e of G.ETAPES_TACHE) assert.doesNotMatch(e, VOUVOIEMENT);
});

test("routines : les 4 étapes affichées sont mot pour mot ETAPES_TACHE du connecteur (supabase/functions/mcp/routines.ts)", () => {
  const ts = readFileSync("supabase/functions/mcp/routines.ts", "utf8");
  const bloc = ts.match(/export const ETAPES_TACHE = \[([\s\S]*?)\];/);
  assert.ok(bloc, "ETAPES_TACHE introuvable dans routines.ts");
  const connecteur = [...bloc[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse('"' + m[1] + '"'));
  assert.deepEqual(G.ETAPES_TACHE, connecteur, "mêmes étapes, même ordre");
  for (const e of G.ETAPES_TACHE) assert.ok(ts.includes(JSON.stringify(e)), "étape absente de routines.ts : " + e);
  const h = G.routinesHtml({ routines: [routine()], routinesLues: true }, AUJ);
  for (const e of connecteur) assert.ok(h.includes("<li>" + e.replace(/'/g, "&#39;") + "</li>"), "étape non affichée : " + e);
});
