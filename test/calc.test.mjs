import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Calc = require("../web/src/calc.js");

const P = [
  { id: "lqq", owner: "p1", bloc: "Nasdaq 2x", mode: "market", qty: 100, price: 10, status: "actif" },
  { id: "livret", owner: "p1", bloc: "Épargne", mode: "manual", value: 45000, status: "actif" },
  { id: "indem", owner: "p1", bloc: "Épargne", mode: "manual", value: 25000, status: "à recevoir" },
  { id: "old", owner: "p1", bloc: "Monde", mode: "market", qty: 0, price: 50, status: "clôturé" },
  { id: "scpi", owner: "p2", bloc: "SCPI", mode: "manual", value: 30000, status: "actif" },
];
const CONFIG = { cushion: { min: 35000, max: 40000 } };
const PROFIL = {
  foyer: { adultes: 2, enfants: 0, enfants14: 0, union: "joint", age: "a30", tmi: 30 },
  personnes: {
    p1: { salaire: 4000, salaireUnite: "nm", statut: "cadre", autresRevenus: 100 },
    p2: { salaire: 39000, salaireUnite: "ba", statut: "nc", autresRevenus: 0 },
  },
  biens: [{ id: "b1", nom: "Studio Lyon", usage: "locatif", valeur: 200000, part_p1: 60, crd: 100000, mensualite: 800, loyer: 700 }],
  credits: [
    { id: "c1", nom: "Auto", owner: "commun", crd: 10000, mensualite: 300 },
    { id: "c2", nom: "Conso", owner: "p1", crd: 2000, mensualite: 100 },
  ],
  autres: { p1: { usage: 15000, entreprise: 0 }, p2: { usage: 5000, entreprise: 1000 } },
};

test("financier exclut à recevoir et clôturé, filtre le périmètre", () => {
  assert.equal(Calc.financier(P, "foyer"), 1000 + 45000 + 30000);
  assert.equal(Calc.financier(P, "p1"), 46000);
  assert.equal(Calc.financier(P, "p2"), 30000);
});

test("part : quote-part selon le périmètre", () => {
  assert.equal(Calc.part("foyer", 60), 1);
  assert.equal(Calc.part("p1", 60), 0.6);
  assert.ok(Math.abs(Calc.part("p2", 60) - 0.4) < 1e-9);
});

test("immobilier et dettes par quote-part, crédit commun réparti 50/50", () => {
  assert.equal(Calc.immobilier(PROFIL, "foyer"), 200000);
  assert.equal(Calc.immobilier(PROFIL, "p1"), 120000);
  assert.equal(Calc.dettes(PROFIL, "foyer"), 100000 + 10000 + 2000);
  assert.equal(Calc.dettes(PROFIL, "p1"), 60000 + 5000 + 2000);
  assert.equal(Calc.dettes(PROFIL, "p2"), 40000 + 5000);
});

test("patrimoine net = financier + immo + autres − dettes", () => {
  const r = Calc.patrimoine(P, PROFIL, "foyer");
  assert.equal(r.financier, 76000);
  assert.equal(r.immobilier, 200000);
  assert.equal(r.usage, 20000);
  assert.equal(r.entreprise, 1000);
  assert.equal(r.dettes, 112000);
  assert.equal(r.brut, 297000);
  assert.equal(r.net, 185000);
});

test("profil vide : patrimoine = financier, rien ne casse", () => {
  const r = Calc.patrimoine(P, null, "p1");
  assert.equal(r.net, 46000);
  assert.equal(r.immobilier, 0);
});

test("salaire net mensuel : conversions brut/net cadre et non-cadre", () => {
  assert.equal(Calc.salaireNetMensuel({ salaire: 4000, salaireUnite: "nm" }), 4000);
  assert.equal(Calc.salaireNetMensuel({ salaire: 48000, salaireUnite: "na" }), 4000);
  assert.equal(Calc.salaireNetMensuel({ salaire: 4000, salaireUnite: "bm", statut: "cadre" }), 3000);
  assert.equal(Calc.salaireNetMensuel({ salaire: 39000, salaireUnite: "ba", statut: "nc" }), 2535);
  assert.equal(Calc.salaireNetMensuel(null), 0);
});

test("revenus du foyer : salaires + autres revenus + loyers × quote-part", () => {
  assert.equal(Calc.revenusFoyer(PROFIL, "foyer"), 4000 + 100 + 2535 + 700);
  assert.equal(Calc.revenusFoyer(PROFIL, "p1"), 4000 + 100 + 420);
});

test("mensualités en cours", () => {
  assert.equal(Calc.mensualites(PROFIL, "foyer"), 800 + 300 + 100);
  assert.equal(Calc.mensualites(PROFIL, "p2"), 320 + 150);
});

test("apport disponible : épargne au-delà du matelas, curseur placements, option à recevoir", () => {
  const a = Calc.apportDisponible(P, CONFIG, "p1");
  assert.equal(a.libre, 10000);
  assert.equal(a.placements, 0);
  assert.equal(a.total, 10000);
  const b = Calc.apportDisponible(P, CONFIG, "p1", { partPlacements: 50, inclureARecevoir: true });
  assert.equal(b.placements, 500);
  assert.equal(b.aRecevoir, 25000);
  assert.equal(b.total, 35500);
  const c = Calc.apportDisponible(P, CONFIG, "p2", { partPlacements: 10 });
  assert.equal(c.matelas, 0);
  assert.equal(c.total, 3000);
});

test("apport : jamais négatif si épargne sous le matelas", () => {
  const a = Calc.apportDisponible([{ owner: "p1", bloc: "Épargne", mode: "manual", value: 1000, status: "actif" }], CONFIG, "p1");
  assert.equal(a.libre, 0);
  assert.equal(a.total, 0);
});

test("complétude du profil et champs manquants", () => {
  assert.equal(Calc.completude(null), 0);
  assert.equal(Calc.completude(PROFIL), 100);
  const partial = { foyer: { adultes: 2, age: "a30" }, personnes: { p1: { salaire: 3000 } } };
  const c = Calc.completude(partial);
  assert.ok(c > 0 && c < 100);
  assert.ok(Calc.manquants(partial).includes("Salaire de la personne 2"));
  const named = { foyer: { adultes: 2 }, personnes: { p1: { nom: "Camille" }, p2: { nom: "Alex" } } };
  assert.ok(Calc.manquants(named).includes("Salaire de Camille"));
  assert.ok(Calc.manquants(named).includes("Statut d'Alex"));
  assert.ok(Calc.manquants({ foyer: { adultes: 1 }, personnes: { p1: { nom: "Moi" } } }).includes("Salaire de la personne 1"));
});

test("validation : quote-part et montants", () => {
  const errs = Calc.valider({ biens: [{ nom: "X", valeur: 100, part_p1: 120, crd: 200 }], credits: [{ nom: "Y", crd: -5 }] });
  assert.ok(errs.erreurs.length >= 2);
  assert.ok(errs.avertissements.some(w => /dépasse/.test(w)));
  assert.deepEqual(Calc.valider(PROFIL).erreurs, []);
});

test("matelas : montant (min/max) ou mois (mois × dépenses)", () => {
  assert.equal(Calc.matelas(null), null);
  assert.deepEqual(Calc.matelas({ cushion: { mode: "amount", min: 15000, max: 20000 } }), { mode: "amount", min: 15000, max: 20000 });
  assert.deepEqual(Calc.matelas({ cushion: { min: 35000, max: 40000 } }), { mode: "amount", min: 35000, max: 40000 });
  const m = Calc.matelas({ cushion: { mode: "months", months: 6, depenses: 2500 } });
  assert.equal(m.min, 15000); assert.equal(m.max, null);
  const a = Calc.apportDisponible(P, { cushion: { mode: "months", months: 4, depenses: 10000 } }, "p1");
  assert.equal(a.matelas, 40000); assert.equal(a.libre, 5000);
});
