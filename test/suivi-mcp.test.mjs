// SUIVI, connecteur MCP (supabase/functions/mcp/suivi.ts) et copie générée du moteur (supabase/functions/mcp/suivi.gen.js, scripts/gen-catalogue.mjs).
// - la copie est à jour (npm run gen), sans import, et donne EXACTEMENT les mêmes sorties que le moteur de l'app sur les 90 cas de référence ;
// - les outils suivi_lignes, ligne, ca_vaut_le_cout (lecture) et definir_suivi (propositions), l'ajout à demarrer_session et à demarrer_routine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { genererSuivi, SORTIE_SUIVI, MODULES_SUIVI } from "../scripts/gen-catalogue.mjs";
import { SOURCE_SUIVI_GEN, chargerSuiviGen } from "./helpers/suivi-gen.mjs";
import { CAS, ecartsDuCas, executer, donneesDe } from "./helpers/suivi-cas.mjs";

const require = createRequire(import.meta.url);
const App = require("../web/src/suivi.js");
const Gen = chargerSuiviGen().Suivi;
const J = v => JSON.parse(JSON.stringify(v));

test("la copie du moteur de suivi est à jour (npm run gen) et ne contient aucun import", () => {
  assert.equal(SOURCE_SUIVI_GEN, genererSuivi(), SORTIE_SUIVI + " périmé : lancer npm run gen");
  assert.doesNotMatch(SOURCE_SUIVI_GEN, /^import /m);
  assert.deepEqual(Object.keys(chargerSuiviGen()).sort(), ["Calc", "Marche", "Pratiques", "Risque", "Suivi"]);
  assert.ok(MODULES_SUIVI.includes("suivi") && MODULES_SUIVI.includes("risque") && MODULES_SUIVI.includes("pratiques"));
});

test("parité : la copie du connecteur passe les 90 cas de référence", () => {
  for (const c of CAS) { const e = ecartsDuCas(Gen, c); assert.deepEqual(e, [], c.id + " : " + e.join("\n")); }
});

test("parité : mêmes sorties, octet pour octet, que le moteur de l'app (déclencheurs, vue, ligne, ma semaine, effet sur le risque)", () => {
  for (const c of CAS) assert.deepEqual(J(executer(Gen, c)), J(executer(App, c)), c.id);
  const d = donneesDe(CAS.find(c => c.id === "SE-3"));
  assert.deepEqual(J(Gen.vue(d, "2026-10-15")), J(App.vue(d, "2026-10-15")));
  assert.deepEqual(J(Gen.ligne(d, "fam", "2026-10-15")), J(App.ligne(d, "fam", "2026-10-15")));
  assert.deepEqual(J(Gen.maSemaine(d, [], "2026-10-15")), J(App.maSemaine(d, [], "2026-10-15")));
});
