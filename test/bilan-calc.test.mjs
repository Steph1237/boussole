import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const B = require("../web/src/bilan-calc.js");

const P = [
  { owner: "p1", bloc: "Monde", envelope: "PEA", mode: "manual", value: 6000, status: "actif" },
  { owner: "p1", bloc: "Épargne", envelope: "Livrets", mode: "manual", value: 3000, status: "actif" },
  { owner: "p2", bloc: "SCPI", envelope: "AV", mode: "manual", value: 1000, status: "actif" },
  { owner: "p1", bloc: "Monde", envelope: "PER", mode: "manual", value: 500, status: "à recevoir" },
];
const PROFIL = {
  foyer: { adultes: 2 },
  personnes: { p1: { nom: "Camille" }, p2: { nom: "Sam" } },
  biens: [{ id: "b1", nom: "Appartement", usage: "rp", valeur: 200000, part_p1: 50, crd: 120000, mensualite: 800, loyer: 0 }],
  credits: [{ id: "c1", nom: "Auto", owner: "commun", crd: 8000, mensualite: 250 }],
  autres: { p1: { usage: 5000, entreprise: 0 }, p2: { usage: 3000, entreprise: 2000 } },
};

test("composition : actifs par catégorie, dettes détaillées, net cohérent avec Calc.patrimoine", () => {
  const c = B.composition(P, PROFIL, "foyer");
  assert.deepEqual(c.actifs.map(a => a.cle), ["financier", "immobilier", "autres"]);
  const fin = c.actifs[0];
  assert.equal(fin.total, 10000);
  assert.deepEqual(fin.lignes.map(l => [l.label, l.montant]), [["PEA", 6000], ["Livrets", 3000], ["AV", 1000]]);
  assert.equal(c.actifs[1].lignes[0].label, "Appartement");
  assert.equal(c.actifs[1].total, 200000);
  assert.equal(c.actifs[2].total, 10000);
  assert.deepEqual(c.dettes.lignes.map(l => [l.label, l.montant]), [["Appartement", 120000], ["Auto", 8000]]);
  assert.equal(c.brut, 220000);
  assert.equal(c.net, 92000);
});

test("composition : quote-part par personne", () => {
  const c = B.composition(P, PROFIL, "p2");
  assert.equal(c.actifs[0].total, 1000);
  assert.equal(c.actifs[1].total, 100000);
  assert.equal(c.actifs[2].total, 5000);
  assert.equal(c.dettes.total, 60000 + 4000);
  assert.equal(c.net, 1000 + 100000 + 5000 - 64000);
});

test("allocation par classe : l'immobilier physique rejoint la classe Immobilier, pourcentages sur 100", () => {
  const a = B.allocation(P, PROFIL, "foyer", "classe");
  const immo = a.find(x => x.cle === "immobilier");
  assert.equal(immo.montant, 201000);
  assert.equal(immo.label, "Immobilier");
  const tot = a.reduce((s, x) => s + x.pct, 0);
  assert.ok(Math.abs(tot - 100) < 1e-9);
  assert.equal(a[0].cle, "immobilier", "trié par montant décroissant");
});

test("allocation financière seule et par liquidité", () => {
  const f = B.allocation(P, PROFIL, "foyer", "classe", { financierSeul: true });
  assert.deepEqual(f.map(x => x.cle), ["actions", "monetaire", "immobilier"]);
  const l = B.allocation(P, PROFIL, "foyer", "liquidite");
  assert.equal(l.find(x => x.cle === "bloque").montant, 200000);
  assert.equal(l.find(x => x.cle === "immediate").label, "Disponible tout de suite");
});

test("flux : barres proportionnelles aux revenus, reste négatif signalé", () => {
  const f = B.flux({ revenus: 5000, depenses: 3000, epargne: 500, reste: 1500, parCategorie: { Logement: 1200, Crédits: 1050, Divers: 750 } });
  assert.deepEqual(f.sorties.map(s => s.label), ["Logement", "Crédits", "Divers", "Épargne", "Reste"]);
  assert.equal(f.sorties[0].pct, 24);
  assert.equal(f.deficit, false);
  const g = B.flux({ revenus: 2000, depenses: 2300, epargne: 0, reste: -300, parCategorie: { Logement: 2300 } });
  assert.equal(g.deficit, true);
  assert.equal(g.sorties.find(s => s.label === "Reste"), undefined);
  assert.equal(B.flux({ revenus: 0, depenses: 0, epargne: 0, reste: 0, parCategorie: {} }).vide, true);
});

test("évolution : financier historique + net estimé avec l'immobilier et les dettes d'aujourd'hui, point du jour", () => {
  const snaps = [{ date: "2026-09-01", foyer: 9000, p1: 8000, p2: 1000 }, { date: "2026-10-01", foyer: 9500, p1: 8400, p2: 1100 }];
  const e = B.evolution(snaps, P, PROFIL, "foyer", "2026-10-09");
  assert.deepEqual(e.map(p => p.date), ["2026-09-01", "2026-10-01", "2026-10-09"]);
  assert.equal(e[2].financier, 10000);
  assert.equal(e[2].live, true);
  assert.equal(e[0].net, 9000 + 200000 + 10000 - 128000);
  const p2 = B.evolution(snaps, P, PROFIL, "p2", "2026-10-09");
  assert.equal(p2[0].financier, 1000);
});

test("évolution : pas de doublon si une photo existe déjà aujourd'hui", () => {
  const e = B.evolution([{ date: "2026-10-09", foyer: 9900 }], P, PROFIL, "foyer", "2026-10-09");
  assert.equal(e.length, 1);
  assert.equal(e[0].financier, 10000, "la valeur en direct remplace la photo du jour");
});
