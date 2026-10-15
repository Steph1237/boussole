// Agent et Compte (UX3) : Savoir réunit Fiches et Expertises, Connexion passe dans Compte (« Connecter Claude »), anciennes routes
// et liens profonds conservés.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const SV = require("../web/src/savoir-view.js");
const { resolve, resolveHash, SPACES } = require("../web/src/app.js");
const key = r => r.space + "/" + r.sub;
const lire = f => readFileSync(new URL("../web/src/" + f, import.meta.url), "utf8");

test("savoir : deux volets (Fiches, Expertises) ; une expertise en lien profond ouvre le volet Expertises, sinon le volet choisi, sinon Fiches", () => {
  assert.deepEqual(SV.VOLETS.map(v => v.label), ["Fiches", "Expertises"]);
  assert.equal(SV.voletDe({}, undefined), "fiches");
  assert.equal(SV.voletDe({}, "expertises"), "expertises");
  assert.equal(SV.voletDe({ expertise: "etf-fonds" }, "fiches"), "expertises");
  assert.equal(SV.voletDe(null, "inconnu"), "fiches");
});

test("Agent : quatre sous-vues (À valider, Journal, Mémoire, Savoir) ; Connexion est dans Compte", () => {
  const sp = id => SPACES.find(s => s.space === id).subs.map(s => s.label);
  assert.deepEqual(sp("agent"), ["À valider", "Journal", "Mémoire", "Savoir"]);
  assert.deepEqual(sp("compte"), ["Données", "Règles", "Connecter Claude"]);
});

test("routes : #agent/connexion, #agent/fiches et #agent/expertises mènent à leur nouvelle place ; ?expertise= est gardé pour la vue", () => {
  assert.equal(key(resolveHash("#agent/connexion")), "compte/connexion");
  assert.equal(key(resolveHash("#profil/claude")), "compte/connexion");
  assert.equal(key(resolveHash("#agent/fiches")), "agent/savoir");
  const e = resolveHash("#agent/expertises?expertise=allocation-risque");
  assert.equal(key(e), "agent/savoir");
  assert.equal(e.query, "expertise=allocation-risque");
  assert.equal(e.legacy, true);
  assert.equal(key(resolve("compte/connexion")), "compte/connexion");
});

test("aucun lien interne de l'app ne vise encore agent/connexion, agent/fiches ni agent/expertises (hors table de correspondance)", () => {
  const fichiers = ["actions.js", "aujourdhui.js", "pratiques.js", "sante.js", "propositions.html", "memoire-view.html", "shell.html", "journal-view.js", "claude-guide.js", "profil.js", "comptes-view.js", "accueil.js", "banque-etat.js", "routine-etat.js"];
  for (const f of fichiers) assert.doesNotMatch(lire(f), /agent\/(connexion|fiches|expertises)|Agent › Connexion/, f);
});
