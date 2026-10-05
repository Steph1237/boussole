import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { instrumentKey, guessSymbol, mapInstruments, mapPositions, mapTransactions, mapSnapshots, mapConfig, mapProfile } from "../scripts/lib/migrate-map.mjs";
const require = createRequire(import.meta.url);
const Calc = require("../web/src/calc.js");

const P = [
  { id: "pea-lqq", owner: "steph", mode: "market", isin: "FR0010342592", ticker: "LQQ", envelope: "PEA", bloc: "Nasdaq 2x", qty: 100, pru: 3, price: 10.5, priceDate: "2026-10-02", status: "actif", name: "LQQ" },
  { id: "av-gold", owner: "steph", mode: "market", isin: "FR0013416716", envelope: "AV", bloc: "Protection", qty: 2, price: 100, priceDate: "2026-10-01", status: "actif", name: "Or" },
  { id: "c-gold", owner: "compagne", mode: "market", isin: "FR0013416716", envelope: "AV2", bloc: "Protection", qty: 3, price: 101, priceDate: "2026-10-02", status: "actif", name: "Or" },
  { id: "crypto-btc", owner: "steph", mode: "market", isin: null, ticker: "BTC", envelope: "Crypto (Binance)", bloc: "Crypto", qty: 0.01, price: 60000, priceDate: "2026-10-02", status: "actif", name: "Bitcoin" },
  { id: "livret-a", owner: "steph", mode: "manual", value: 15000, valueDate: "2026-09-28", envelope: "Livrets", bloc: "Épargne", status: "actif", name: "Livret A" },
  { id: "indem", owner: "steph", mode: "manual", value: 25000, envelope: "Livrets", bloc: "Épargne", status: "à recevoir", name: "Indemnité", hypothesis: "minimum" },
];
let n = 0; const uuid = () => "00000000-0000-0000-0000-" + String(++n).padStart(12, "0");

test("clé d'instrument : ISIN, sinon X-TICKER-EUR pour une ligne cotée", () => {
  assert.equal(instrumentKey(P[0]), "FR0010342592");
  assert.equal(instrumentKey(P[3]), "X-BTC-EUR");
  assert.equal(instrumentKey(P[4]), null);
  assert.equal(guessSymbol(P[0]), "LQQ.PA");
  assert.equal(guessSymbol(P[3]), "BTC-EUR");
});

test("instruments : dédoublonnés par ISIN, cours le plus récent conservé", () => {
  const I = mapInstruments(P, { FR0013416716: "GOLD.PA" });
  assert.equal(I.length, 3);
  const gold = I.find(i => i.isin === "FR0013416716");
  assert.equal(gold.price, 101);
  assert.equal(gold.symbol, "GOLD.PA");
});

test("positions : propriétaires p1/p2, identifiants remappés, valeur totale inchangée", () => {
  n = 0;
  const { rows, ids } = mapPositions(P, "u1", uuid);
  assert.equal(rows.length, 6);
  assert.equal(rows[2].owner, "p2");
  assert.equal(rows[3].isin, "X-BTC-EUR");
  assert.equal(rows[4].value, 15000);
  assert.equal(rows[4].qty, null);
  assert.equal(ids["pea-lqq"], rows[0].id);
  // Revalorisation avec le cours de chaque instrument, comme la base le fera : même total que la source.
  const I = Object.fromEntries(mapInstruments(P).map(i => [i.isin, i.price]));
  const back = rows.map(r => ({ owner: r.owner, mode: r.mode, qty: r.qty, value: r.value, status: r.status, price: r.isin ? I[r.isin] : null }));
  const src = P.map(p => Object.assign({}, p, { owner: p.owner === "steph" ? "p1" : "p2", price: p.isin || p.ticker ? I[instrumentKey(p)] : null }));
  assert.equal(Calc.financier(back, "foyer"), Calc.financier(src, "foyer"));
});

test("transactions, photos, config et profil", () => {
  n = 0;
  const { ids } = mapPositions(P, "u1", uuid);
  const T = mapTransactions([{ positionId: "livret-a", date: "2026-09-10", type: "programme", amount: 100, label: "Livret" }, { positionId: "inconnue", date: "2026-09-10", type: "x" }], ids, "u1");
  assert.equal(T.length, 1);
  assert.equal(T[0].position_id, ids["livret-a"]);
  const S = mapSnapshots([{ date: "2026-10-02", couple: 10, steph: 6, compagne: 4, byBloc: { steph: { A: 6 }, compagne: { B: 4 } }, byEnvelope: { PEA: 6 }, source: "agent" }], "u1");
  assert.deepEqual([S[0].total, S[0].p1, S[0].p2], [10, 6, 4]);
  assert.deepEqual(S[0].by_bloc, { p1: { A: 6 }, p2: { B: 4 } });
  const C = mapConfig({ alerts: { stopNasdaq: 8.5, maxNasdaqPct: 12, maxCryptoPct: 5, livretCap: 22950 }, cushion: { min: 35000, max: 40000 },
    targets: { steph: { Monde: 20 }, compagne: { SCPI: 50 }, tolerancePts: 3 }, recurring: [{ id: "r", positionId: "livret-a", amount: 1000, day: 5 }] }, P, ids, "u1");
  assert.deepEqual(C.targets, { p1: { Monde: 20 }, p2: { SCPI: 50 }, tolerancePts: 3 });
  assert.deepEqual(C.cushion, { mode: "amount", min: 35000, max: 40000 });
  assert.equal(C.recurring[0].positionId, ids["livret-a"]);
  const floor = C.rules.find(r => r.type === "price_floor");
  assert.equal(floor.position_id, ids["pea-lqq"]);
  assert.equal(floor.price, 8.5);
  assert.ok(C.rules.some(r => r.type === "envelope_cap" && r.cap === 22950));
  assert.equal(C.rules.length, 5);
  const Pr = mapProfile(null, "u1");
  assert.equal(Pr.personnes.p1.nom, "Stéph");
  assert.equal(Pr.foyer.adultes, 2);
});
