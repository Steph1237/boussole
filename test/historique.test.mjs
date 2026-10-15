// Historique (web/src/historique.js) : reconstitution du passé du patrimoine net (cours × quantités, soldes bancaires remontés par les
// opérations, autres lignes constantes), fusion avec les photos observées (l'observé gagne), cône de projection. Données fictives.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const H = require("../web/src/historique.js");
const Plan = require("../web/src/plan.js");

const T = "2026-10-14";
const plus = (s, k) => new Date(Date.parse(s + "T12:00:00Z") + k * 864e5).toISOString().slice(0, 10);
const ETF = (o) => Object.assign({ id: "etf", name: "ETF Monde fictif", envelope: "PEA", owner: "p1", bloc: "Monde", mode: "market", isin: "FR0000000001", qty: 10, price: 120, status: "actif" }, o);
const LIV = (o) => Object.assign({ id: "liv", name: "Livret fictif", envelope: "Livrets", owner: "p1", bloc: "Épargne", mode: "manual", value: 1000, status: "actif" }, o);
/* Cours en escalier : 100 jusqu'à T-6, 110 de T-5 à T-3, 120 de T-2 à T-1 (jours calendaires, un cours par jour). */
const serie = () => { const out = []; for (let k = -10; k <= -1; k++) out.push({ date: plus(T, k), cloture: k <= -6 ? 100 : k <= -3 ? 110 : 120 }); return out; };
const val = (r, d) => { const p = r.points.find(x => x.date === d); return p ? p.financier : undefined; };

describe("reconstituer : lignes cotées (cours × quantités)", () => {
  test("sans transaction : quantité actuelle × cours du jour, signalée « à composition actuelle »", () => {
    const r = H.reconstituer({ today: T, positions: [ETF()], cours: { FR0000000001: serie() } });
    assert.equal(val(r, plus(T, -8)), 1000);
    assert.equal(val(r, plus(T, -4)), 1100);
    assert.equal(val(r, plus(T, -1)), 1200);
    assert.deepEqual(r.drapeaux.compositionActuelle, ["ETF Monde fictif"]);
    assert.deepEqual(r.drapeaux.viaTransactions, []);
    assert.equal(r.debut, plus(T, -10), "pas avant le premier cours");
    assert.equal(r.points[r.points.length - 1].date, plus(T, -1), "jusqu'à la veille : le jour même est observé");
    assert.ok(!r.points.some(p => p.date >= T));
  });
  test("achats remontés : avant un achat de 4 parts, 4 parts de moins ; une vente rend les parts", () => {
    const tx = [{ positionId: "etf", date: plus(T, -4), type: "achat", qty: 4 }, { positionId: "etf", date: plus(T, -2), type: "vente", qty: 1 }];
    const r = H.reconstituer({ today: T, positions: [ETF()], cours: { FR0000000001: serie() }, tx });
    assert.equal(val(r, plus(T, -5)), (10 - 4 + 1) * 110, "avant l'achat (la vente a eu lieu après) : 7 parts");
    assert.equal(val(r, plus(T, -4)), (10 + 1) * 110, "le jour de l'achat, les 4 parts sont là, la vente pas encore");
    assert.equal(val(r, plus(T, -3)), 11 * 110);
    assert.equal(val(r, plus(T, -2)), 10 * 120, "après la vente : quantité actuelle");
    assert.deepEqual(r.drapeaux.viaTransactions, ["ETF Monde fictif"]);
    assert.deepEqual(r.drapeaux.compositionActuelle, []);
  });
  test("types inconnus (solde, autre) et transactions d'une autre ligne ou sans quantité : ignorés ; jamais de quantité négative", () => {
    const tx = [{ positionId: "etf", date: plus(T, -4), type: "solde", amount: 5000 }, { positionId: "autre", date: plus(T, -4), type: "achat", qty: 50 },
      { positionId: "etf", date: plus(T, -3), type: "achat", qty: null }, { positionId: "etf", date: plus(T, -7), type: "programme", qty: 30 }];
    const r = H.reconstituer({ today: T, positions: [ETF()], cours: { FR0000000001: serie() }, tx });
    assert.equal(val(r, plus(T, -4)), 10 * 110);
    assert.equal(val(r, plus(T, -8)), 0, "30 parts achetées plus tard que n'en détient la ligne : plancher à zéro");
  });
  test("le symbole sert de clé quand la ligne n'a pas d'ISIN ; sans cours pour la ligne : valeur constante", () => {
    const r = H.reconstituer({ today: T, positions: [ETF({ isin: null, symbol: "AAA.PA" }), ETF({ id: "e2", name: "Sans cours", isin: "FR0000000002", qty: 2, price: 50 })],
      cours: { "AAA.PA": serie() } });
    assert.equal(val(r, plus(T, -8)), 10 * 100 + 2 * 50);
    assert.deepEqual(r.drapeaux.sansCours, ["Sans cours"]);
    assert.equal(r.drapeaux.constantes.montant, 100);
  });
  test("avant son premier cours, une ligne reste à la valeur de son premier cours (jamais zéro) et est signalée", () => {
    const court = serie().filter(c => c.date >= plus(T, -5));
    const r = H.reconstituer({ today: T, positions: [ETF(), ETF({ id: "e2", name: "Récent", isin: "FR0000000002", qty: 1, price: 999 })],
      cours: { FR0000000001: serie(), FR0000000002: court.map(c => ({ date: c.date, cloture: 200 })) } });
    assert.equal(val(r, plus(T, -9)), 10 * 100 + 1 * 200);
    assert.deepEqual(r.drapeaux.courteHistoire, ["Récent"]);
  });
});

describe("reconstituer : comptes bancaires remontés par les opérations", () => {
  const comptes = [{ id: 7, positionId: "liv", type: "livret", ignore: false }, { id: 8, positionId: null, type: "courant" }];
  const operations = [{ compteId: 7, date: plus(T, -2), montant: 200 }, { compteId: 7, date: plus(T, -1), montant: -50 }, { compteId: 8, date: plus(T, -1), montant: 999 }];
  test("solde(j) = solde actuel − opérations postérieures à j ; avant la fenêtre lue, le solde est tenu constant", () => {
    const r = H.reconstituer({ today: T, positions: [LIV()], comptes, operations, operationsDepuis: plus(T, -3) });
    assert.equal(val(r, plus(T, -1)), 1000);
    assert.equal(val(r, plus(T, -2)), 1050);
    assert.equal(val(r, plus(T, -3)), 850, "veille de la première opération lue : solde reconstitué");
    assert.equal(val(r, plus(T, -4)), 850, "avant la fenêtre : tenu constant");
    assert.equal(r.debut, plus(T, -4), "la fenêtre bancaire borne le début quand il n'y a pas de cours");
    assert.deepEqual(r.drapeaux.bancaires, ["Livret fictif"]);
    assert.equal(r.drapeaux.constantes.montant, 0);
  });
  test("un compte ignoré, de crédit ou sans opération laisse la ligne constante", () => {
    for (const c of [{ id: 7, positionId: "liv", type: "livret", ignore: true }, { id: 7, positionId: "liv", type: "credit" }]) {
      const r = H.reconstituer({ today: T, positions: [LIV(), ETF()], cours: { FR0000000001: serie() }, comptes: [c], operations, operationsDepuis: plus(T, -3) });
      assert.equal(val(r, plus(T, -2)), 1000 + 1200);
      assert.deepEqual(r.drapeaux.bancaires, []);
      assert.deepEqual(r.drapeaux.constantes.noms, ["Livret fictif"]);
    }
  });
  test("cotées et bancaires ensemble : les lignes s'additionnent, les autres sont constantes", () => {
    const autre = LIV({ id: "av", name: "Contrat fictif", value: 5000 });
    const r = H.reconstituer({ today: T, positions: [ETF(), LIV(), autre], cours: { FR0000000001: serie() }, comptes, operations, operationsDepuis: plus(T, -3) });
    assert.equal(val(r, plus(T, -4)), 1100 + 850 + 5000);
    assert.deepEqual(r.drapeaux.constantes.noms, ["Contrat fictif"]);
    assert.equal(r.drapeaux.constantes.montant, 5000);
  });
});

describe("reconstituer : périmètre, plancher de date, net, cas vides", () => {
  test("périmètre (p1 / p2 / foyer), lignes à recevoir ou clôturées exclues, immobilier et dettes ajoutés via horsFin", () => {
    const P = [ETF(), ETF({ id: "e2", owner: "p2", isin: "FR0000000002", qty: 1 }), ETF({ id: "e3", status: "à recevoir", isin: "FR0000000003" })];
    const cours = { FR0000000001: serie(), FR0000000002: serie(), FR0000000003: serie() };
    assert.equal(val(H.reconstituer({ today: T, positions: P, cours, scope: "p1" }), plus(T, -4)), 1100);
    assert.equal(val(H.reconstituer({ today: T, positions: P, cours, scope: "foyer" }), plus(T, -4)), 1210);
    const r = H.reconstituer({ today: T, positions: P, cours, scope: "foyer", horsFin: 200000 - 150000 });
    assert.equal(r.points.find(p => p.date === plus(T, -4)).net, 1210 + 50000);
  });
  test("depuis borne le début ; jamais plus de 5 ans par défaut", () => {
    const r = H.reconstituer({ today: T, positions: [ETF()], cours: { FR0000000001: serie() }, depuis: plus(T, -5) });
    assert.equal(r.debut, plus(T, -5));
    assert.equal(r.points.length, 5);
    const longue = []; for (let k = -3000; k <= -1; k++) longue.push({ date: plus(T, k), cloture: 100 });
    const l = H.reconstituer({ today: T, positions: [ETF()], cours: { FR0000000001: longue } });
    assert.equal(l.debut, plus(T, -1826), "5 ans (1 826 jours) au plus");
  });
  test("rien à reconstituer : aucun point et une raison en clair ; entrées absurdes sans exception", () => {
    const r = H.reconstituer({ today: T, positions: [LIV()] });
    assert.deepEqual(r.points, []);
    assert.match(r.raison, /Aucun historique/);
    assert.deepEqual(H.reconstituer({ today: T, positions: [] }).points, []);
    assert.doesNotThrow(() => H.reconstituer({}));
    assert.doesNotThrow(() => H.reconstituer({ today: T, positions: [ETF()], cours: { FR0000000001: [null, { date: "x", cloture: 1 }, { date: plus(T, -2), cloture: -3 }] }, tx: [null, {}], comptes: [null], operations: [null] }));
  });
});

describe("fusionner : l'observé gagne, reconstitué seulement avant la première photo, recalage", () => {
  const rec = (d0, d1, f) => { const out = []; for (let d = d0; d <= d1; d = plus(d, 1)) out.push({ date: d, net: f(d) }); return out; };
  const D = k => plus(T, k);
  test("un point reconstitué à la date d'une photo disparaît ; ceux d'après aussi ; tout est trié et nommé par sa nature", () => {
    const obs = [{ date: D(-3), net: 5000 }, { date: D(-1), net: 5200 }, { date: T, net: 5300, live: true }];
    const f = H.fusionner(obs, rec(D(-8), D(-1), () => 4000), { recaler: false });
    assert.deepEqual(f.points.map(p => p.date), [D(-8), D(-7), D(-6), D(-5), D(-4), D(-3), D(-1), T]);
    assert.deepEqual(f.points.map(p => p.nature), ["reconstitue", "reconstitue", "reconstitue", "reconstitue", "reconstitue", "observe", "observe", "observe"]);
    assert.equal(f.points.find(p => p.date === D(-3)).net, 5000, "la photo l'emporte sur le reconstitué du même jour");
    assert.equal(f.premiereObservee, D(-3));
    assert.equal(f.decalage, 0);
  });
  test("recalage : le reconstitué est décalé pour rejoindre la première photo (écart signalé), l'observé n'est jamais touché", () => {
    const obs = [{ date: D(-3), net: 5000 }, { date: T, net: 5300, live: true }];
    const f = H.fusionner(obs, rec(D(-8), D(-1), () => 4000));
    assert.equal(f.decalage, 1000);
    assert.deepEqual(f.points.filter(p => p.nature === "reconstitue").map(p => p.net), [5000, 5000, 5000, 5000, 5000]);
    assert.equal(f.points.find(p => p.date === D(-3)).net, 5000);
    assert.equal(f.points[f.points.length - 1].net, 5300);
  });
  test("recalage sur le dernier reconstitué antérieur quand la première photo est le point du jour", () => {
    const f = H.fusionner([{ date: T, net: 9000, live: true }], rec(D(-3), D(-1), d => (d === D(-1) ? 8800 : 8000)));
    assert.equal(f.decalage, 200);
    assert.deepEqual(f.points.map(p => p.net), [8200, 8200, 9000, 9000]);
  });
  test("sans photo : reconstitué seul (rien à recaler) ; sans reconstitué : observé seul ; sans rien : vide", () => {
    assert.equal(H.fusionner([], rec(D(-2), D(-1), () => 1)).points.length, 2);
    assert.equal(H.fusionner([], rec(D(-2), D(-1), () => 1)).decalage, 0);
    assert.deepEqual(H.fusionner([{ date: T, net: 3, live: true }], []).points.map(p => p.nature), ["observe"]);
    assert.deepEqual(H.fusionner([], []).points, []);
    assert.doesNotThrow(() => H.fusionner(null, undefined));
  });
});

describe("projeter : supprimé (un seul moteur : Projection)", () => {
  test("Historique n'expose plus de cône de projection", () => assert.equal(H.projeter, undefined));
  test("plusMois : fin de mois, le 31 janvier + 1 mois = 28 (ou 29) février, jamais un débordement", () => {
    assert.equal(H.plusMois("2027-01-31", 1), "2027-02-28");
    assert.equal(H.plusMois("2027-01-31", 2), "2027-03-31");
    assert.equal(H.plusMois("2027-01-31", 12), "2028-01-31");
  });
});

describe("outils de dates", () => {
  test("plusJours / plusMois / jourDe", () => {
    assert.equal(H.plusJours("2026-03-01", -1), "2026-02-28");
    assert.equal(H.plusMois("2026-01-31", 1), "2026-02-28");
    assert.equal(H.plusMois("2024-01-31", 1), "2024-02-29");
    assert.equal(H.plusMois("2026-11-15", 3), "2027-02-15");
  });
});
