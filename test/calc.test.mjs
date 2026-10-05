import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Calc = require("../web/src/calc.js");

const P = [
  { id: "lqq", owner: "steph", bloc: "Nasdaq 2x", mode: "market", qty: 100, price: 10, status: "actif" },
  { id: "livret", owner: "steph", bloc: "Épargne", mode: "manual", value: 45000, status: "actif" },
  { id: "indem", owner: "steph", bloc: "Épargne", mode: "manual", value: 25000, status: "à recevoir" },
  { id: "old", owner: "steph", bloc: "Monde", mode: "market", qty: 0, price: 50, status: "clôturé" },
  { id: "scpi", owner: "compagne", bloc: "SCPI", mode: "manual", value: 30000, status: "actif" },
];
const CONFIG = { cushion: { min: 35000, max: 40000 } };
const PROFIL = {
  foyer: { adultes: 2, enfants: 0, enfants14: 0, union: "joint", age: "a30", tmi: 30 },
  personnes: {
    steph: { salaire: 4000, salaireUnite: "nm", statut: "cadre", autresRevenus: 100 },
    compagne: { salaire: 39000, salaireUnite: "ba", statut: "nc", autresRevenus: 0 },
  },
  biens: [{ id: "b1", nom: "Studio Lyon", usage: "locatif", valeur: 200000, partSteph: 60, crd: 100000, mensualite: 800, loyer: 700 }],
  credits: [
    { id: "c1", nom: "Auto", owner: "commun", crd: 10000, mensualite: 300 },
    { id: "c2", nom: "Conso", owner: "steph", crd: 2000, mensualite: 100 },
  ],
  autres: { steph: { usage: 15000, entreprise: 0 }, compagne: { usage: 5000, entreprise: 1000 } },
};

test("financier exclut à recevoir et clôturé, filtre le périmètre", () => {
  assert.equal(Calc.financier(P, "couple"), 1000 + 45000 + 30000);
  assert.equal(Calc.financier(P, "steph"), 46000);
  assert.equal(Calc.financier(P, "compagne"), 30000);
});

test("part : quote-part selon le périmètre", () => {
  assert.equal(Calc.part("couple", 60), 1);
  assert.equal(Calc.part("steph", 60), 0.6);
  assert.ok(Math.abs(Calc.part("compagne", 60) - 0.4) < 1e-9);
});

test("immobilier et dettes par quote-part, crédit commun réparti 50/50", () => {
  assert.equal(Calc.immobilier(PROFIL, "couple"), 200000);
  assert.equal(Calc.immobilier(PROFIL, "steph"), 120000);
  assert.equal(Calc.dettes(PROFIL, "couple"), 100000 + 10000 + 2000);
  assert.equal(Calc.dettes(PROFIL, "steph"), 60000 + 5000 + 2000);
  assert.equal(Calc.dettes(PROFIL, "compagne"), 40000 + 5000);
});

test("patrimoine net = financier + immo + autres − dettes", () => {
  const r = Calc.patrimoine(P, PROFIL, "couple");
  assert.equal(r.financier, 76000);
  assert.equal(r.immobilier, 200000);
  assert.equal(r.usage, 20000);
  assert.equal(r.entreprise, 1000);
  assert.equal(r.dettes, 112000);
  assert.equal(r.brut, 297000);
  assert.equal(r.net, 185000);
});

test("profil vide : patrimoine = financier, rien ne casse", () => {
  const r = Calc.patrimoine(P, null, "steph");
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
  assert.equal(Calc.revenusFoyer(PROFIL, "couple"), 4000 + 100 + 2535 + 700);
  assert.equal(Calc.revenusFoyer(PROFIL, "steph"), 4000 + 100 + 420);
});

test("mensualités en cours", () => {
  assert.equal(Calc.mensualites(PROFIL, "couple"), 800 + 300 + 100);
  assert.equal(Calc.mensualites(PROFIL, "compagne"), 320 + 150);
});

test("apport disponible : épargne au-delà du matelas, curseur placements, option à recevoir", () => {
  const a = Calc.apportDisponible(P, CONFIG, "steph");
  assert.equal(a.libre, 10000);
  assert.equal(a.placements, 0);
  assert.equal(a.total, 10000);
  const b = Calc.apportDisponible(P, CONFIG, "steph", { partPlacements: 50, inclureARecevoir: true });
  assert.equal(b.placements, 500);
  assert.equal(b.aRecevoir, 25000);
  assert.equal(b.total, 35500);
  const c = Calc.apportDisponible(P, CONFIG, "compagne", { partPlacements: 10 });
  assert.equal(c.matelas, 0);
  assert.equal(c.total, 3000);
});

test("apport : jamais négatif si épargne sous le matelas", () => {
  const a = Calc.apportDisponible([{ owner: "steph", bloc: "Épargne", mode: "manual", value: 1000, status: "actif" }], CONFIG, "steph");
  assert.equal(a.libre, 0);
  assert.equal(a.total, 0);
});

test("complétude du profil et champs manquants", () => {
  assert.equal(Calc.completude(null), 0);
  assert.equal(Calc.completude(PROFIL), 100);
  const partial = { foyer: { adultes: 2, age: "a30" }, personnes: { steph: { salaire: 3000 } } };
  const c = Calc.completude(partial);
  assert.ok(c > 0 && c < 100);
  assert.ok(Calc.manquants(partial).includes("Salaire de la compagne"));
});

test("validation : quote-part et montants", () => {
  const errs = Calc.valider({ biens: [{ nom: "X", valeur: 100, partSteph: 120, crd: 200 }], credits: [{ nom: "Y", crd: -5 }] });
  assert.ok(errs.erreurs.length >= 2);
  assert.ok(errs.avertissements.some(w => /dépasse/.test(w)));
  assert.deepEqual(Calc.valider(PROFIL).erreurs, []);
});
