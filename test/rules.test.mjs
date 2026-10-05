import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Rules = require("../web/src/rules.js");

const TODAY = "2026-10-05";
// Foyer : p1 = 60 000 €, p2 = 40 000 €, total 100 000 € (la ligne « à recevoir » n'est pas comptée).
const P = [
  { id: "etf", name: "ETF Monde", envelope: "PEA A", owner: "p1", bloc: "Monde", mode: "market", qty: 300, price: 100, priceDate: "2026-10-04", status: "actif" },   // 30 000
  { id: "lqq", name: "Nasdaq 2x", envelope: "PEA A", owner: "p1", bloc: "Nasdaq", mode: "market", qty: 100, price: 100, priceDate: "2026-09-20", status: "actif" }, // 10 000
  { id: "livret", name: "Livret A", envelope: "Livrets A", owner: "p1", bloc: "Épargne", mode: "manual", value: 20000, status: "actif" },                           // 20 000
  { id: "fonds", name: "Fonds euros", envelope: "AV B", owner: "p2", bloc: "Obligations", mode: "manual", value: 35000, status: "actif" },                         // 35 000
  { id: "btc", name: "Bitcoin", envelope: "Crypto", owner: "p2", bloc: "Crypto", mode: "market", qty: 0.1, price: 50000, priceDate: null, status: "actif" },        //  5 000
  { id: "prime", name: "Prime", envelope: "À recevoir", owner: "p1", bloc: "Épargne", mode: "manual", value: 9000, status: "à recevoir" },
];
const people = [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }];
const ctx = (over = {}) => Object.assign({ positions: P, config: {}, scope: "foyer", people, today: TODAY }, over);
const only = (alerts, rule) => alerts.filter(a => a.rule === rule);

test("max_line_pct : une alerte par ligne au-dessus du plafond, pondérée sur le périmètre", () => {
  const r = { type: "max_line_pct", pct: 30 };
  const foyer = Rules.evaluate([r], ctx());
  assert.deepEqual(foyer.map(a => a.title), ["Ligne trop lourde : Fonds euros"]); // 35 % ; l'ETF est à 30 % pile
  assert.equal(foyer[0].level, "warn"); assert.equal(foyer[0].rule, r);
  assert.match(foyer[0].text, /du foyer/);
  const p1 = Rules.evaluate([r], ctx({ scope: "p1" })); // ETF 50 %, livret 33 %
  assert.deepEqual(p1.map(a => a.title), ["Ligne trop lourde : ETF Monde", "Ligne trop lourde : Livret A"]);
  assert.match(p1[0].text, /de Camille/);
});

test("max_bloc_pct : poche au-dessus du plafond", () => {
  const r = { type: "max_bloc_pct", bloc: "Crypto", pct: 4 };
  assert.equal(Rules.evaluate([r], ctx()).length, 1); // 5 %
  assert.equal(Rules.evaluate([r], ctx({ scope: "p2" }))[0].level, "warn"); // 12,5 %
  assert.equal(Rules.evaluate([r], ctx({ scope: "p1" })).length, 0);
  assert.equal(Rules.evaluate([{ ...r, pct: 6 }], ctx()).length, 0);
});

test("min_bloc_pct : poche sous le plancher (info)", () => {
  const r = { type: "min_bloc_pct", bloc: "Monde", pct: 40 };
  const a = Rules.evaluate([r], ctx()); // 30 %
  assert.equal(a.length, 1); assert.equal(a[0].level, "info");
  assert.equal(Rules.evaluate([r], ctx({ scope: "p1" })).length, 0); // 50 %
});

test("price_floor : urgent sous le seuil, à traiter à moins de 10 %, rien au-delà", () => {
  const crit = Rules.evaluate([{ type: "price_floor", position_id: "lqq", price: 100 }], ctx());
  assert.equal(crit.length, 1); assert.equal(crit[0].level, "crit");
  assert.match(crit[0].text, /seuil atteint : vérifiez votre ordre stop/i);
  const warn = Rules.evaluate([{ type: "price_floor", position_id: "lqq", price: 95 }], ctx());
  assert.equal(warn[0].level, "warn");
  assert.equal(Rules.evaluate([{ type: "price_floor", position_id: "lqq", price: 80 }], ctx()).length, 0);
  assert.equal(Rules.evaluate([{ type: "price_floor", position_id: "inconnue", price: 80 }], ctx()).length, 0);
  assert.equal(Rules.evaluate([{ type: "price_floor", position_id: "lqq", price: 100 }], ctx({ scope: "p2" })).length, 0, "hors périmètre");
});

test("envelope_cap : enveloppe au plafond", () => {
  const a = Rules.evaluate([{ type: "envelope_cap", envelope: "Livrets A", cap: 20000 }], ctx());
  assert.equal(a.length, 1); assert.equal(a[0].level, "warn");
  assert.match(a[0].text, /dirigez les prochains versements ailleurs/);
  assert.equal(Rules.evaluate([{ type: "envelope_cap", envelope: "Livrets A", cap: 22950 }], ctx()).length, 0);
});

test("stale_prices : lignes cotées sans cours récent ou sans cours", () => {
  const a = Rules.evaluate([{ type: "stale_prices", days: 4 }], ctx());
  assert.equal(a.length, 1); assert.equal(a[0].level, "info");
  assert.match(a[0].text, /^2 lignes/); assert.match(a[0].text, /Nasdaq 2x/); assert.match(a[0].text, /Bitcoin/);
  assert.equal(Rules.evaluate([{ type: "stale_prices", days: 30 }], ctx({ scope: "p1" })).length, 0);
});

test("règles inconnues ou incomplètes : ignorées", () => {
  assert.deepEqual(Rules.evaluate([{ type: "nope" }, null, { type: "max_bloc_pct" }], ctx()), []);
  assert.deepEqual(Rules.evaluate(undefined, ctx()), []);
});

test("matelas en mois : cible = mois × dépenses mensuelles", () => {
  // Épargne du foyer comptée : 20 000 € (la prime à recevoir est exclue).
  const below = Rules.builtins(ctx({ config: { cushion: { mode: "months", months: 6, depenses: 4000 } } }));
  assert.deepEqual(below.map(a => a.title), ["Matelas sous la cible"]);
  assert.match(below[0].text, /24 000 €|24 000 €/);
  assert.deepEqual(Rules.builtins(ctx({ config: { cushion: { mode: "months", months: 5, depenses: 4000 } } })), []);
  const amount = Rules.builtins(ctx({ config: { cushion: { mode: "amount", min: 10000, max: 15000 } } }));
  assert.deepEqual(amount.map(a => a.title), ["Matelas au-dessus de la cible"]);
});

test("sans règle : seulement les contrôles intégrés (cibles, matelas, nuit, échéances, status)", () => {
  const config = {
    targets: { p1: { Monde: 50, Nasdaq: 10, "Épargne": 40 }, p2: { Obligations: 70, Crypto: 30 }, tolerancePts: 3 },
    cushion: { mode: "amount", min: 25000, max: 30000 },
    milestones: [{ title: "Fin de période d'essai", date: "2026-10-25", warnDays: 30 }, { title: "Lointain", date: "2027-06-01", warnDays: 30 }],
    rules: [],
  };
  const status = { lastRun: "2026-09-30T20:30:00Z", alerts: [{ level: "warn", title: "Cours manquant", text: "X" }] };
  const A = Rules.all(ctx({ config, status }));
  assert.ok(A.every(a => a.rule === null), "aucune alerte issue d'une règle");
  const titles = A.map(a => a.title);
  // p1 : Monde 50 %, Nasdaq 16,7 % (+6,7 → warn), Épargne 33,3 % (−6,7 → warn) ; p2 : Obligations 87,5 % / Crypto 12,5 %.
  assert.ok(titles.includes("Poche Nasdaq au-dessus de la cible (Camille)"));
  assert.ok(titles.includes("Poche Épargne en dessous de la cible (Camille)"));
  assert.ok(titles.includes("Poche Obligations au-dessus de la cible (Sam)"));
  assert.ok(!titles.some(t => /Monde/.test(t)));
  assert.ok(titles.includes("Matelas sous la cible"));
  assert.ok(titles.includes("Mise à jour nocturne en retard"));
  assert.ok(titles.includes("Cours manquant"));
  assert.ok(titles.includes("Fin de période d'essai"));
  assert.ok(!titles.includes("Lointain"));
  // périmètre d'une personne : ses cibles seulement, sans suffixe
  const p2 = Rules.builtins(ctx({ config, scope: "p2" })).map(a => a.title);
  assert.ok(p2.includes("Poche Obligations au-dessus de la cible"));
  assert.ok(!p2.some(t => /Camille/.test(t)));
  // et rien du tout sans configuration
  assert.deepEqual(Rules.all(ctx({ config: {} })), []);
});

test("describe et normalize : règles en français, saisie validée", () => {
  assert.equal(Rules.describe({ type: "max_line_pct", pct: 15 }), "Aucune ligne au-dessus de 15 % du patrimoine");
  assert.equal(Rules.describe({ type: "max_bloc_pct", bloc: "Crypto", pct: 2.5 }), "Poche Crypto au plus à 2,5 % du patrimoine");
  assert.match(Rules.describe({ type: "price_floor", position_id: "lqq", price: 90 }, ctx()), /Nasdaq 2x/);
  assert.deepEqual(Rules.normalize({ type: "max_bloc_pct", bloc: " Crypto ", pct: "5" }), { rule: { type: "max_bloc_pct", bloc: "Crypto", pct: 5 } });
  assert.ok(Rules.normalize({ type: "max_line_pct", pct: 120 }).error);
  assert.ok(Rules.normalize({ type: "envelope_cap", envelope: "", cap: 100 }).error);
  assert.ok(Rules.normalize({ type: "x" }).error);
  assert.deepEqual(Object.keys(Rules.TYPES).sort(), ["envelope_cap", "max_bloc_pct", "max_line_pct", "min_bloc_pct", "price_floor", "stale_prices"]);
});
