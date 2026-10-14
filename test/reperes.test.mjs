import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const R = createRequire(import.meta.url)("../web/src/reperes.js");
const esp = s => s.replace(/[  ]/g, " ");
const L = [
  { cle: "livret_a_taux", libelle: "Taux du Livret A", valeur: 1.7, unite: "%", dateEffet: "2025-08-01", sourceTitre: "Banque de France", sourceUrl: "https://www.banque-france.fr", verifieLe: "2026-10-10" },
  { cle: "pea_plafond", libelle: "Plafond PEA", valeur: 150000, unite: "€", dateEffet: "2014-01-01", sourceTitre: "service-public", sourceUrl: "https://www.service-public.fr", verifieLe: "2026-01-01" },
];
test("valeur : trouvée, ou défaut si absente / liste vide", () => {
  assert.equal(R.valeur(L, "livret_a_taux", 2.4), 1.7);
  assert.equal(R.valeur(L, "inconnu", 3), 3);
  assert.equal(R.valeur(null, "livret_a_taux", 2.4), 2.4);
});
test("aVerifier : vérifié il y a plus de 180 jours", () => {
  assert.equal(R.aVerifier(L[0], "2026-10-10"), false);
  assert.equal(R.aVerifier(L[1], "2026-10-10"), true);
  assert.equal(R.A_VERIFIER_JOURS, 180);
});
test("format : unité française", () => {
  assert.equal(esp(R.format(L[0])), "1,7 %");
  assert.equal(esp(R.format(L[1])), "150 000 €");
  assert.equal(R.format({ valeur: 25, unite: "ans" }), "25 ans");
});
test("depuisLignes : lignes SQL → vue camelCase", () => {
  const v = R.depuisLignes([{ cle: "x", libelle: "X", valeur: "2.5", unite: "%", date_effet: "2026-01-01", source_titre: "s", source_url: "https://s", verifie_le: "2026-02-01", mode: "manuel" }]);
  assert.deepEqual(v[0], { cle: "x", libelle: "X", valeur: 2.5, unite: "%", dateEffet: "2026-01-01", dateFin: null, sourceTitre: "s", sourceUrl: "https://s", verifieLe: "2026-02-01", mode: "manuel" });
});
test("depuisLignes : date_fin → dateFin (null si absente ou nulle)", () => {
  const base = { cle: "x", libelle: "X", valeur: "1.7", unite: "%", date_effet: "2026-08-01", source_titre: "s", source_url: "https://s", verifie_le: "2026-10-14", mode: "manuel" };
  const v = R.depuisLignes([{ ...base, date_fin: "2027-01-31" }, { ...base, cle: "y", date_fin: null }, { ...base, cle: "z" }]);
  assert.deepEqual(v.map(r => [r.cle, r.dateFin]), [["x", "2027-01-31"], ["y", null], ["z", null]]);
  assert.equal(v[0].dateEffet, "2026-08-01", "les autres champs sont inchangés");
  assert.equal(R.depuisLignes(null).length, 0);
});
