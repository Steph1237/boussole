import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = require("../web/src/periodes.js");

const TODAY = "2026-10-10";

test("bornes des périodes prédéfinies", () => {
  assert.deepEqual(T.bornes("1m", TODAY), { du: "2026-09-10", au: TODAY });
  assert.deepEqual(T.bornes("3m", TODAY), { du: "2026-07-10", au: TODAY });
  assert.deepEqual(T.bornes("6m", TODAY), { du: "2026-04-10", au: TODAY });
  assert.deepEqual(T.bornes("ytd", TODAY), { du: "2026-01-01", au: TODAY });
  assert.deepEqual(T.bornes("1a", TODAY), { du: "2025-10-10", au: TODAY });
  assert.deepEqual(T.bornes("3a", TODAY), { du: "2023-10-10", au: TODAY });
  assert.deepEqual(T.bornes("tout", TODAY, "2024-02-03"), { du: "2024-02-03", au: TODAY });
  assert.deepEqual(T.bornes({ du: "2026-03-01", au: "2026-05-31" }, TODAY), { du: "2026-03-01", au: "2026-05-31" });
  assert.deepEqual(T.bornes({ du: "2026-06-01", au: "2026-03-01" }, TODAY), { du: "2026-03-01", au: "2026-06-01" }, "bornes inversées remises dans l'ordre");
  assert.deepEqual(T.bornes("1m", "2026-03-31"), { du: "2026-02-28", au: "2026-03-31" }, "fin de mois courte");
});

test("granularité automatique selon la durée", () => {
  assert.equal(T.auto({ du: "2026-09-10", au: TODAY }), "jour");
  assert.equal(T.auto({ du: "2026-04-10", au: TODAY }), "semaine");
  assert.equal(T.auto({ du: "2024-10-10", au: TODAY }), "mois");
  assert.equal(T.auto({ du: "2020-01-01", au: TODAY }), "trimestre");
  assert.equal(T.auto({ du: "2010-01-01", au: TODAY }), "annee");
});

test("clé de période et libellé", () => {
  assert.equal(T.cle("2026-10-07", "semaine"), "2026-10-05", "semaine ISO : lundi");
  assert.equal(T.cle("2026-10-10", "mois"), "2026-10");
  assert.equal(T.cle("2026-10-10", "trimestre"), "2026-T4");
  assert.equal(T.cle("2026-10-10", "annee"), "2026");
  assert.equal(T.libelle("2026-10", "mois"), "oct. 2026");
  assert.equal(T.libelle("2026-T4", "trimestre"), "T4 2026");
  assert.equal(T.libelle("2026", "annee"), "2026");
});

const PTS = [
  { date: "2026-08-15", v: 100 },
  { date: "2026-08-31", v: 110 },
  { date: "2026-09-10", v: 120 },
  { date: "2026-09-30", v: 105 },
  { date: "2026-10-05", v: 130 },
];

test("agrégation d'un stock : valeur de fin de période + variation vs période précédente", () => {
  const r = T.agreger(PTS, { du: "2026-08-01", au: TODAY }, "mois", p => p.v);
  assert.deepEqual(r.map(x => [x.cle, x.date, x.valeur]), [["2026-08", "2026-08-31", 110], ["2026-09", "2026-09-30", 105], ["2026-10", "2026-10-05", 130]]);
  assert.equal(r[0].variation, null);
  assert.equal(r[1].variation, -5);
  assert.ok(Math.abs(r[1].variationPct - (-5 / 110 * 100)) < 1e-9);
  assert.equal(r[2].variation, 25);
});

test("agrégation : la période est filtrée, mais la variation du premier point utilise la valeur juste avant", () => {
  const r = T.agreger(PTS, { du: "2026-09-01", au: TODAY }, "mois", p => p.v);
  assert.equal(r.length, 2);
  assert.equal(r[0].variation, -5, "comparé à fin août, hors période");
});

test("agrégation par jour = points bruts ; points sans valeur ignorés ; tri chronologique", () => {
  const r = T.agreger([{ date: "2026-10-02", v: 2 }, { date: "2026-10-01", v: 1 }, { date: "2026-10-03", v: null }], { du: "2026-09-01", au: TODAY }, "jour", p => p.v);
  assert.deepEqual(r.map(x => x.valeur), [1, 2]);
});

test("résumé de période : début, fin, variation absolue et en %", () => {
  const s = T.resume(T.agreger(PTS, { du: "2026-08-01", au: TODAY }, "mois", p => p.v), PTS, { du: "2026-08-01", au: TODAY }, p => p.v);
  assert.equal(s.debut, 100);
  assert.equal(s.fin, 130);
  assert.equal(s.variation, 30);
  assert.equal(s.variationPct, 30);
});

test("liste des choix exposée pour l'interface", () => {
  assert.deepEqual(T.PERIODES.map(p => p.id), ["1m", "3m", "6m", "ytd", "1a", "3a", "tout", "perso"]);
  assert.deepEqual(T.GRANULARITES.map(g => g.id), ["auto", "jour", "semaine", "mois", "trimestre", "annee"]);
});
