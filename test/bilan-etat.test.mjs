import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../web/src/bilan-etat.js");

const VIDE = { positions: [], profil: null, budget: null, objectifs: [], risque: null, propositions: [] };
const TODAY = "2026-10-10";
const COMPLET = {
  profil: {
    foyer: { adultes: 2, enfants: 1, age: "a30", tmi: 30 },
    personnes: { p1: { nom: "Camille", salaire: 2800, salaireUnite: "nm", statut: "cadre" }, p2: { nom: "Sam", salaire: 2300, salaireUnite: "nm", statut: "nc" } },
    biens: [{ nom: "RP", valeur: 240000 }], credits: [], protection: { prevoyance: true, emprunteur: true },
    biensRenseignes: true,
  },
  budget: { lignes: [{ type: "depense", categorie: "Logement", libelle: "Charges", montant: 180 }, { type: "epargne", libelle: "Livret", montant: 200 }] },
  positions: [{ owner: "p1", bloc: "Monde", envelope: "PEA", mode: "market", qty: 10, price: 100, priceDate: "2026-10-09", status: "actif" }],
  objectifs: [{ id: "o1", nom: "Matelas", type: "matelas", cible: 20000, dateCible: "2027-06-30" }],
  risque: { reponses: { horizon: "h15", objectif: "croissance", reaction: "rien", perte_max: "p20", connaissances: ["etf"], experience: 3, revenus: "cdi", matelas: "oui", part_investie: "p50", age: "a30" }, profil: "dynamique" },
  propositions: [],
};

test("bilan vide : 0 %, toutes les sections vides, on commence par le foyer", () => {
  const e = E.etat(VIDE, TODAY);
  assert.equal(e.pourcentage, 0);
  assert.deepEqual(e.sections.map(s => s.cle), ["foyer", "revenus", "budget", "placements", "immobilier", "protection", "objectifs", "risque"]);
  assert.ok(e.sections.every(s => s.statut === "vide"));
  assert.equal(e.prochaines.length, 3);
  assert.equal(e.prochaines[0].section, "foyer");
  assert.ok(e.prochaines.every(q => q.question && q.pourquoi));
});

test("bilan complet : 100 %, aucune question", () => {
  const e = E.etat(COMPLET, TODAY);
  assert.equal(e.pourcentage, 100);
  assert.ok(e.sections.every(s => s.statut === "complet"), JSON.stringify(e.sections.filter(s => s.statut !== "complet")));
  assert.deepEqual(e.prochaines, []);
});

test("partiel : un champ manquant dans le foyer, la question porte sur lui", () => {
  const S = structuredClone(COMPLET); delete S.profil.foyer.tmi;
  const e = E.etat(S, TODAY);
  const f = e.sections.find(s => s.cle === "foyer");
  assert.equal(f.statut, "partiel");
  assert.deepEqual(f.manquants.map(m => m.champ), ["foyer.tmi"]);
  assert.match(e.prochaines[0].question, /imposition/i);
  assert.ok(e.pourcentage > 80 && e.pourcentage < 100);
});

test("revenus : la personne 2 n'est attendue que pour un foyer de deux adultes", () => {
  const S = structuredClone(COMPLET); S.profil.foyer.adultes = 1; delete S.profil.personnes.p2;
  assert.equal(E.etat(S, TODAY).sections.find(s => s.cle === "revenus").statut, "complet");
  const T = structuredClone(COMPLET); delete T.profil.personnes.p2.salaire;
  const r = E.etat(T, TODAY).sections.find(s => s.cle === "revenus");
  assert.equal(r.statut, "partiel");
  assert.match(r.manquants[0].question, /Sam/);
});

test("placements : cours ou valeurs de plus de 90 jours signalés comme à mettre à jour", () => {
  const S = structuredClone(COMPLET);
  S.positions.push({ owner: "p1", bloc: "Épargne", envelope: "Livrets", mode: "manual", value: 5000, valueDate: "2026-05-01", status: "actif" });
  const p = E.etat(S, TODAY).sections.find(s => s.cle === "placements");
  assert.equal(p.statut, "partiel");
  assert.match(p.manquants[0].question, /Livrets/);
});

test("immobilier : « aucun bien » est une réponse valable", () => {
  const S = structuredClone(COMPLET); S.profil.biens = []; S.profil.biensRenseignes = true;
  assert.equal(E.etat(S, TODAY).sections.find(s => s.cle === "immobilier").statut, "complet");
  const T = structuredClone(COMPLET); T.profil.biens = []; delete T.profil.biensRenseignes;
  assert.equal(E.etat(T, TODAY).sections.find(s => s.cle === "immobilier").statut, "vide");
});

test("protection : seulement l'assurance emprunteur s'il y a un crédit", () => {
  const S = structuredClone(COMPLET); S.profil.protection = { prevoyance: true };
  assert.equal(E.etat(S, TODAY).sections.find(s => s.cle === "protection").statut, "complet", "pas de crédit → emprunteur non requis");
  S.profil.credits = [{ nom: "Auto", crd: 5000 }];
  assert.equal(E.etat(S, TODAY).sections.find(s => s.cle === "protection").statut, "partiel");
});

test("risque : réponses partielles comptées, questions manquantes listées", () => {
  const S = structuredClone(COMPLET); S.risque = { reponses: { horizon: "h15", reaction: "rien" } };
  const r = E.etat(S, TODAY).sections.find(s => s.cle === "risque");
  assert.equal(r.statut, "partiel");
  assert.equal(r.manquants.length, 8);
});

test("propositions en attente comptées", () => {
  const S = structuredClone(COMPLET); S.propositions = [{ statut: "en_attente" }, { statut: "acceptee" }, { statut: "en_attente" }];
  assert.equal(E.etat(S, TODAY).propositionsEnAttente, 2);
});
