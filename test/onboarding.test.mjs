import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const O = require("../web/src/onboarding.js");
const SRC = readFileSync(new URL("../web/src/onboarding.js", import.meta.url), "utf8");

test("le module se charge et expose open et buildPatch", () => {
  assert.equal(typeof O.open, "function");
  assert.equal(typeof O.buildPatch, "function");
});

test("les trois étapes et les commandes attendues", () => {
  for (const t of ["Votre foyer", "Vos revenus", "Votre patrimoine"]) assert.ok(SRC.includes(t), t);
  for (const t of ["Étape ", " sur ", "Retour", "Passer", "Importer un fichier CSV", "Remplir avec mon assistant", "Plus tard"]) assert.ok(SRC.includes(t), t);
  assert.match(SRC, /Assistant\.parse|a\.parse\(st\.reponse, "positions"\)/);
  assert.match(SRC, /prompt\("positions"\)/);
  assert.doesNotMatch(SRC, /\.from\(|\.rpc\(|Store\.db/, "aucun accès à la base dans l'onboarding");
});

const state = (over) => Object.assign({
  base: null,
  foyer: { adultes: 2, enfants: 1, union: "sep", age: "a30", tmi: "30" },
  personnes: {
    p1: { nom: " Camille ", salaire: "3 200", salaireUnite: "nm", statut: "cadre" },
    p2: { nom: "Sam", salaire: "45 000,50", salaireUnite: "ba", statut: "nc" },
  },
}, over);

test("buildPatch : nombres parsés, deux adultes", () => {
  const p = O.buildPatch(state());
  assert.deepEqual(p.foyer, { adultes: 2, enfants: 1, union: "sep", age: "a30", tmi: 30 });
  assert.deepEqual(p.personnes.p1, { nom: "Camille", salaire: 3200, salaireUnite: "nm", statut: "cadre" });
  assert.deepEqual(p.personnes.p2, { nom: "Sam", salaire: 45000.5, salaireUnite: "ba", statut: "nc" });
});

test("buildPatch : p2 supprimé quand un seul adulte", () => {
  const p = O.buildPatch(state({ foyer: { adultes: 1, enfants: 0, union: "joint", age: "", tmi: "" } }));
  assert.deepEqual(Object.keys(p.personnes), ["p1"]);
  assert.equal(p.foyer.adultes, 1);
  assert.equal(p.foyer.union, undefined, "pas d'union pour un adulte seul");
  assert.equal(p.foyer.age, null);
  assert.equal(p.foyer.tmi, null);
});

test("buildPatch : valeurs vides ou illisibles → null, noms par défaut, champs existants conservés", () => {
  const base = { foyer: { enfants14: 2, adultes: 2 }, personnes: { p1: { nom: "Moi", csp: "cadre", autresRevenus: 100 }, p2: { nom: "X", essai: true } } };
  const p = O.buildPatch({
    base,
    foyer: { adultes: 3, enfants: 1, union: "joint", age: "zz", tmi: "12" },
    personnes: { p1: { nom: "", salaire: "", salaireUnite: "??", statut: "" }, p2: { nom: "", salaire: "beaucoup", salaireUnite: "na", statut: "cadre" } },
  });
  assert.equal(p.foyer.adultes, 3);
  assert.equal(p.foyer.enfants14, 1, "enfants14 borné au nombre d'enfants");
  assert.equal(p.foyer.age, null);
  assert.equal(p.foyer.tmi, null, "12 % n'est pas une tranche");
  assert.deepEqual(p.personnes.p1, { nom: "Moi", csp: "cadre", autresRevenus: 100, salaire: null, salaireUnite: "nm", statut: null });
  assert.deepEqual(p.personnes.p2, { nom: "Conjoint", essai: true, salaire: null, salaireUnite: "na", statut: "cadre" });
});

test("buildPatch : profil hérité steph / compagne relu en p1 / p2", () => {
  const p = O.buildPatch({ base: { personnes: { steph: { nom: "Stéph", csp: "cadre" } } }, foyer: { adultes: 1 }, personnes: { p1: { salaire: "2500" } } });
  assert.deepEqual(p.personnes.p1, { nom: "Stéph", csp: "cadre", salaire: 2500, salaireUnite: "nm", statut: null });
});
