// Cours historiques (CP1 § 4) : fonctions pures de supabase/functions/nightly/cours.ts (types retirés, contexte vm) : séries
// Yahoo chart et CSV Euronext, conversion en EUR, lignes de la table cours, paquets. Aucun réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import vm from "node:vm";

const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const J = v => JSON.parse(JSON.stringify(v));
function charger() {
  const source = readFileSync(new URL("../supabase/functions/nightly/cours.ts", import.meta.url), "utf8");
  const noms = [...source.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function|class)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, { Date, Math, JSON, Number, String, Object, Array, Map, Set, Intl, Error, isFinite, parseFloat, RegExp });
}
const ts = d => Date.parse(d) / 1000;

test("série Yahoo : dates de Paris, valeurs nulles écartées, une clôture par jour, devise et dernier cours", { skip: SANS_STRIP }, () => {
  const C = charger();
  const data = { chart: { result: [{
    meta: { currency: "USD", regularMarketPrice: 231.5, regularMarketTime: ts("2026-10-09T20:00:00Z") },
    timestamp: [ts("2026-10-07T13:30:00Z"), ts("2026-10-08T13:30:00Z"), ts("2026-10-08T23:30:00Z"), ts("2026-10-09T22:30:00Z"), ts("2026-10-10T13:30:00Z")],
    indicators: { quote: [{ close: [228.1, null, 0, 230, 231.5] }] },
  }] } };
  const s = C.serieYahoo(data);
  assert.equal(s.currency, "USD");
  assert.equal(s.price, 231.5);
  assert.equal(s.time, ts("2026-10-09T20:00:00Z"));
  // 2026-10-09T22:30Z = 2026-10-10 00:30 à Paris : même jour que le point suivant, le dernier l'emporte
  assert.deepEqual(J(s.points), [{ date: "2026-10-07", close: 228.1 }, { date: "2026-10-10", close: 231.5 }]);
  assert.throws(() => C.serieYahoo({ chart: { result: null, error: { description: "No data found, symbol may be delisted" } } }), /delisted/);
  assert.throws(() => C.serieYahoo({}), /réponse vide/);
  assert.equal(C.serieYahoo({ chart: { result: [{ meta: {} }] } }).currency, "EUR");
});

test("CSV Euronext : BOM, en-tête, colonne Close (à défaut Last), dates JJ/MM/AAAA, tri croissant", { skip: SANS_STRIP }, () => {
  const C = charger();
  const csv = '﻿"Historical Data"\n"From 2026-09-25 to 2026-10-09"\nFR0010342592\nDate;Open;High;Low;Last;Close;"Number of Shares";"Number of Trades";Turnover;vwap\n'
    + "09/10/2026;10.766;10.812;10.65;10.682;10.682;469092;711;5030484;10.7239\n08/10/2026;10.5;10.6;10.4;10.55;;1;1;1;1\n07/10/2026;1;1;1;0;0;1;1;1;1\r\n";
  assert.deepEqual(J(C.serieEuronext(csv)), [{ date: "2026-10-08", close: 10.55 }, { date: "2026-10-09", close: 10.682 }]);
  assert.throws(() => C.serieEuronext("pas un csv"), /CSV inattendu/);
});

test("conversion : pence → livres, taux unique, série de taux (dernier taux connu à la date)", { skip: SANS_STRIP }, () => {
  const C = charger();
  assert.deepEqual(J(C.devise("GBp")), { cur: "GBP", facteur: 0.01 });
  assert.deepEqual(J(C.devise("GBX")), { cur: "GBP", facteur: 0.01 });
  assert.deepEqual(J(C.devise("usd")), { cur: "USD", facteur: 1 });
  assert.deepEqual(J(C.devise("")), { cur: "EUR", facteur: 1 });
  assert.deepEqual(J(C.convertir([{ date: "2026-10-01", close: 10 }], 0.5)), [{ date: "2026-10-01", close: 5 }]);
  const taux = [{ date: "2026-10-02", close: 0.9 }, { date: "2026-10-05", close: 0.8 }];
  const pts = [{ date: "2026-10-01", close: 100 }, { date: "2026-10-03", close: 100 }, { date: "2026-10-05", close: 100 }, { date: "2026-10-06", close: 100 }];
  assert.deepEqual(J(C.convertirAvecSerie(pts, taux, 0.7)).map(p => p.close), [90, 90, 80, 80], "avant la série : premier taux");
  assert.deepEqual(J(C.convertirAvecSerie(pts.slice(0, 1), [], 0.7)).map(p => p.close), [70], "sans série : taux du jour");
});

test("lignes cours et paquets ; dates", { skip: SANS_STRIP }, () => {
  const C = charger();
  assert.deepEqual(J(C.lignesCours("X-BTC", [{ date: "2026-10-01", close: 52000.1234567 }, { date: "2026-10-02", close: 0 }, { date: "x", close: 1 }], "yahoo")),
    [{ isin: "X-BTC", date: "2026-10-01", cloture: 52000.123457, source: "yahoo" }]);
  assert.deepEqual(J(C.paquets([1, 2, 3, 4, 5], 2)), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(J(C.paquets([], 2)), []);
  assert.equal(C.decalerDate("2026-10-12", -14), "2026-09-28");
  assert.equal(C.decalerDate("2024-03-01", -1), "2024-02-29");
  assert.equal(C.parisDate(ts("2026-10-11T22:30:00Z")), "2026-10-12");
  assert.equal(C.parisDate(null, new Date("2026-10-12T08:00:00Z")), "2026-10-12");
});
