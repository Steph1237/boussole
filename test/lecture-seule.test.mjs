// Lecture seule (spec docs/superpowers/specs/2026-10-11-saisie-par-agent.md § 2) : toute la saisie passe par l'assistant de
// l'utilisateur ; l'app ne garde que le contrôle. Ce test parcourt tous les modules de vue assemblés par build.mjs (MODULES),
// plus la coque (shell.html, app.js) et l'accueil, et vérifie :
//   - aucun formulaire (<form) ni bouton d'envoi (type="submit"), sauf dans les simulateurs (toise, simu) dont les paramètres
//     d'exploration restent locaux et ne sont jamais enregistrés ;
//   - aucune écriture au store hors liste blanche : propositions (appliquer, refuser), journal (confirmer, modifier, supprimer,
//     consentement), mémoire (modifier, supprimer, toutEffacer), règles (bascule actif : config/main ← { rules }), profil de
//     risque recalculé après application de propositions (profil/main ← { risque }), compte (markOnboarded), routines (bascule
//     active / en pause de la revue mensuelle dans Agent › Connexion : Store.routines.pause, spec RT1 — même nature que la bascule
//     des règles : un contrôle, pas une saisie), banque (BQ1, Agent › Connexion : connecter ou reconnecter une banque par la page
//     Powens, déconnecter, rattacher un compte à une ligne, une enveloppe ou un crédit — seules colonnes que 0021 laisse écrire) ;
//   - aucune requête directe à la base (sb.from, .rpc) ni façade d'écriture retirée (collection, addMany, upsert, set, delete).
// Les simulateurs ne sont pas dispensés de la règle d'écriture : ils n'écrivent rien non plus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const build = readFileSync("build.mjs", "utf8");
const MODULES = JSON.parse(build.match(/const MODULES = (\[[^\]]*\])/)[1]);
const SIMULATEURS = ["toise", "simu"];
const fichiers = [...MODULES, "accueil", "app", "shell"].flatMap(m => ["js", "html"].map(e => `web/src/${m}.${e}`)).filter(f => existsSync(f));
const sansCommentaires = s => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");

/* Écritures autorisées : chemin de la façade db → clés acceptées ; méthodes des API dédiées. */
const DB_AUTORISE = { "config/main": ["rules"], "profil/main": ["risque"] };
const API_AUTORISEE = {
  propositions: ["appliquer", "refuser"],
  journal: ["confirmer", "modifier", "supprimer", "consentement"],
  memoire: ["modifier", "supprimer", "toutEffacer"],
  routines: ["pause"], // bascule active / en pause de la revue mensuelle (claude-guide.js)
  savoir: ["fiche"], // lecture
  expertises: ["detail"], // lecture (méthode d'une expertise, Agent › Expertises)
  banque: ["connecter", "deconnecter", "rattacher"], // banques connectées (claude-guide.js) : contrôle, pas saisie
};
const STORE_AUTORISE = ["get", "on", "emit", "reload", "mode", "setScope", "surveillerConnexions", "markOnboarded", "db", ...Object.keys(API_AUTORISEE)];

test("lecture seule : la liste des modules est bien lue dans build.mjs", () => {
  assert.ok(MODULES.length >= 15, "MODULES introuvable dans build.mjs");
  for (const m of ["aujourdhui", "profil", "regles", "propositions", "journal-view", "memoire-view", "toise", "simu"]) assert.ok(MODULES.includes(m), m);
  assert.ok(fichiers.length > MODULES.length, "fichiers des modules introuvables");
});

test("lecture seule : aucun formulaire ni bouton d'envoi dans les vues (sauf simulateurs, paramètres locaux)", () => {
  for (const f of fichiers) {
    const nom = f.split("/").pop().replace(/\.(js|html)$/, "");
    if (SIMULATEURS.includes(nom)) continue;
    const s = sansCommentaires(readFileSync(f, "utf8"));
    assert.doesNotMatch(s, /<form\b/i, f + " : <form");
    assert.doesNotMatch(s, /type\s*=\s*\\?["']?submit/i, f + ' : type="submit"');
    assert.doesNotMatch(s, /\.requestSubmit\(|addEventListener\(\s*["']submit["']/, f + " : envoi de formulaire");
  }
});

test("lecture seule : aucune écriture au store hors liste blanche (simulateurs compris)", () => {
  for (const f of fichiers) {
    const s = sansCommentaires(readFileSync(f, "utf8"));
    // Façade db : seulement doc("config/main").update({ rules }) et doc("profil/main").update({ risque }).
    for (const m of s.matchAll(/\.db\s*\.\s*(\w+)\s*\(/g)) assert.equal(m[1], "doc", `${f} : db.${m[1]}() (seul db.doc() reste)`);
    for (const m of s.matchAll(/\.doc\(\s*["'`]([^"'`]+)["'`]\s*\)\s*\.\s*(\w+)\s*\(\s*(\{[^}]*\}|[^)]*)/g)) {
      const [, chemin, methode, arg] = m;
      assert.equal(methode, "update", `${f} : doc("${chemin}").${methode}()`);
      assert.ok(DB_AUTORISE[chemin], `${f} : écriture sur « ${chemin} » (hors liste blanche)`);
      const cles = arg.trim().startsWith("{") ? [...arg.matchAll(/(?:^\{|,)\s*(\w+)\s*(?::|,|\}|$)/g)].map(x => x[1]) : [];
      assert.ok(cles.length && cles.every(k => DB_AUTORISE[chemin].includes(k)), `${f} : doc("${chemin}").update(${arg.trim()}) : clés ${cles.join(", ") || "inconnues"} hors liste blanche`);
    }
    assert.doesNotMatch(s, /\.(collection|addMany|upsert|insert)\s*\(/, f + " : façade d'écriture retirée (collection, addMany, upsert, insert)");
    assert.doesNotMatch(s, /\bdoc\([^)]*\)\s*\.\s*(set|delete)\s*\(/, f + " : doc().set / doc().delete retirés");
    assert.doesNotMatch(s, /\bsb\.from\(|\.from\(\s*["'](positions|profiles|config|budgets|objectifs|biens|credits|transactions)["']\)|\.rpc\(/, f + " : requête directe à la base");
    // API du store : seules les entrées connues, et pour les API dédiées seulement les méthodes de contrôle.
    for (const m of s.matchAll(/\bStore\s*\.\s*(\w+)/g)) assert.ok(STORE_AUTORISE.includes(m[1]), `${f} : Store.${m[1]} inconnu`);
    for (const m of s.matchAll(/\bStore\s*\.\s*(propositions|journal|memoire|savoir|expertises|routines|banque)\s*\.\s*(\w+)/g))
      assert.ok(API_AUTORISEE[m[1]].includes(m[2]), `${f} : Store.${m[1]}.${m[2]} hors liste blanche`);
  }
});

test("lecture seule : les vues de contrôle appellent bien les API dédiées (le test ne passe pas à vide)", () => {
  const lire = f => sansCommentaires(readFileSync("web/src/" + f, "utf8"));
  assert.match(lire("regles.js"), /\.db\.doc\("config\/main"\)\.update\(\{rules\}\)/, "règles : bascule actif");
  assert.match(lire("propositions.js"), /Store\.db\.doc\("profil\/main"\)\.update\(\{ risque:/, "propositions : profil de risque recalculé");
  assert.match(lire("propositions.js"), /window\.Store\.propositions/);
  assert.match(lire("journal-view.js"), /window\.Store\.journal/);
  assert.match(lire("memoire-view.js"), /window\.Store\.memoire/);
  assert.match(lire("expertises-view.js"), /window\.Store\.expertises\.detail\(slug\)/, "expertises : lecture du détail seulement");
  assert.match(lire("accueil.js"), /St\.markOnboarded\(\)/);
  assert.match(lire("claude-guide.js"), /window\.Store\.routines\.pause\(type, active\)/, "Agent › Connexion : bascule de la revue mensuelle");
  assert.match(lire("claude-guide.js"), /window\.Store\.banque\.connecter\(/, "Agent › Connexion : connecter une banque");
  assert.match(lire("claude-guide.js"), /window\.Store\.banque\.deconnecter\(cx\.id\)/, "Agent › Connexion : déconnecter une banque");
  assert.match(lire("claude-guide.js"), /window\.Store\.banque\.rattacher\(cpt\.id, cible\)/, "Agent › Connexion : rattacher un compte");
});
