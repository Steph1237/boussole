// Filtre de contenu sensible de la mémoire de l'agent (web/src/sensible.js) : module pur partagé par les stores,
// mêmes motifs que la contrainte SQL public.contenu_sensible (0009) et que SENSIBLE dans le connecteur (memoire.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/sensible.js", "utf8");
const S = require("../web/src/sensible.js");

const REFUSES = ["FR76 3000 6000 0112 3456 7890 189", "Mon IBAN est FR76 3000 6000 0112 3456 7890 189", "FR7630006000011234567890189",
  "carte 4970 1012 3456 7890", "Carte 4970101234567890", "Mon mot de passe est chat", "PASSWORD: x", "le code PIN est 1234", "identifiant de connexion : steph"];
const ACCEPTES = ["ETF IE00B4L5Y983 MSCI World", "ISIN FR0010315770 ETF", "IE00B4L5Y983 et FR0010315770", "PEA chez la banque X : IE00B4L5Y983, FR0010315770",
  "Objectifs 2025-2026-2027-2028", "100 000 200 000 300 000", "Achat de RP à 350 000 € en 2028, tel 06 12 34 56 78", "Achat prévu à 350 000 € en 2028",
  "Camille préfère des explications courtes", "", "Livret A à 1,7 % depuis le 1er août 2026"];

test("sensible.js : se compile, UMD (module.exports et global Sensible), exports attendus", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "sensible.js" }));
  assert.match(js, /root\.Sensible = api/);
  assert.deepEqual(Object.keys(S).sort(), ["IBAN_CHIFFRES_MIN", "SENSIBLE", "estSensible"]);
  assert.equal(S.SENSIBLE.length, 3);
  assert.equal(S.IBAN_CHIFFRES_MIN, 12);
  assert.equal(typeof S.estSensible, "function");
  // chargé comme script navigateur : expose window.Sensible
  const ctx = { self: undefined }; ctx.self = ctx;
  vm.runInNewContext(js, ctx);
  assert.equal(typeof ctx.Sensible.estSensible, "function");
});

test("sensible.js : motifs (IBAN avec ≥ 12 chiffres, carte en groupes de 4, mots interdits)", () => {
  assert.equal(S.SENSIBLE[0], "[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]){11,30}");
  assert.equal(S.SENSIBLE[1], "(?<![0-9])[0-9]{4} ?[0-9]{4} ?[0-9]{4} ?[0-9]{1,7}(?![0-9])");
  assert.equal(S.SENSIBLE[2], "mot de passe|password|code secret|code pin|identifiant de connexion");
});

test("estSensible : refuse IBAN, carte et mots interdits", () => {
  for (const t of REFUSES) assert.equal(S.estSensible(t), true, "refusé : " + t);
});

test("estSensible : accepte ISIN, années, montants en milliers, téléphone", () => {
  for (const t of ACCEPTES) assert.equal(S.estSensible(t), false, "accepté : " + t);
  assert.equal(S.estSensible(null), false);
  assert.equal(S.estSensible(undefined), false);
});

test("estSensible : l'IBAN n'est refusé que si la correspondance porte au moins 12 chiffres (ISIN suivi d'un libellé en majuscules)", () => {
  // Sans le seuil, « IE00B4L5Y983 MSCI » satisferait le motif (11 caractères après la clé).
  assert.match("ETF IE00B4L5Y983 MSCI World", new RegExp(S.SENSIBLE[0]));
  assert.equal(S.estSensible("ETF IE00B4L5Y983 MSCI World"), false);
  assert.equal(S.estSensible("GB29 NWBK 6016 1331 9268 19"), true);
});
