// HIS2 : Calc.moisBancaires (série fusionnée Powens / import, spec § 6.1) et Calc.budgetReel sur cette série, cas de test/fixtures/his2-cas.json.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parFonction, cas, historiqueDeFixture } from "./helpers/his2.mjs";

const require = createRequire(import.meta.url);
const Calc = require("../web/src/calc.js");
const near = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} ≠ ${b}`);

for (const c of parFonction("moisBancaires")) {
  test("moisBancaires " + c.id + " : " + c.nom, () => {
    const serie = Calc.moisBancaires(c.entree.banque, historiqueDeFixture(c.entree.historique), c.today);
    assert.equal(serie.length, c.attendu.mois.length, "liste exhaustive des (compte, mois) : " + JSON.stringify(serie.map(e => [e.compte, e.mois, e.source])));
    c.attendu.mois.forEach((att, i) => {
      const e = serie[i];
      assert.deepEqual([e.compte, e.mois, e.source], [att.compte, att.mois, att.source], "ligne " + i);
      assert.deepEqual(e.ecarte || [], att.ecarte || [], "écarté de la ligne " + i);
    });
  });
}

for (const c of parFonction("budgetReel")) {
  test("budgetReel " + c.id + " : " + c.nom, () => {
    const r = Calc.budgetReel(c.entree.banque, c.today, undefined, historiqueDeFixture(c.entree.historique));
    assert.ok(r, "un budget est rendu");
    for (const [k, v] of Object.entries(c.attendu)) {
      if (typeof v === "number") near(r[k], v, c.id + " " + k, k.startsWith("taux") ? 1e-5 : 0.01);
      else assert.equal(r[k], v, c.id + " " + k);
    }
  });
}

test("budgetReel sans relevés importés : comportement inchangé (historique absent, vide ou sans relevé)", () => {
  const c = cas("B-powens-seul");
  const sans = Calc.budgetReel(c.entree.banque, c.today);
  assert.deepEqual(Calc.budgetReel(c.entree.banque, c.today, undefined, null), sans);
  assert.deepEqual(Calc.budgetReel(c.entree.banque, c.today, undefined, { comptes: [], releves: [], banqueMois: [] }), sans);
  assert.equal(Calc.budgetReel({ actif: false, mois: [] }, c.today, undefined, { comptes: [], releves: [], banqueMois: [] }), null, "interrupteur éteint, aucun relevé");
});

test("budgetReel : des relevés importés comptent même quand la banque connectée est éteinte ou absente", () => {
  const c = cas("B1/budget"), h = historiqueDeFixture(c.entree.historique);
  assert.equal(Calc.budgetReel(null, c.today, undefined, h).revenus, 3000);
  assert.equal(Calc.budgetReel({ actif: false, mois: [] }, c.today, undefined, h).depenses, 1860);
});

test("moisBancaires : un mois futur importé est ignoré, les entrées sont triées par mois puis par compte", () => {
  const h = historiqueDeFixture(cas("B1/budget").entree.historique);
  const futur = { ...h, releves: [...h.releves, { ...h.releves[0], mois: "2027-01" }] };
  const serie = Calc.moisBancaires({ comptes: [], mois: [] }, futur, "2026-10-16");
  assert.deepEqual(serie.map(e => e.mois), ["2024-01", "2024-02"]);
  assert.deepEqual(Calc.moisBancaires(null, null, "2026-10-16"), []);
});
