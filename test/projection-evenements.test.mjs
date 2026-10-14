// PROJ : événements de vie (web/src/projection-evenements.js et effets dans projection.js) — validation et messages communs à la base,
// au store démo et à decrire_foyer (cas V-1 à V-15 de test/fixtures/projection-cas.json), types réservés, variantes, valeurs par défaut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { FIXTURE, cas, reperesComplets } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const E = req("../web/src/projection-evenements.js");

for (const c of FIXTURE.cas.filter(x => x.famille === "validation")) {
  test(c.id + " : " + c.nom, () => {
    const attendu = c.attendu;
    const message = E.validerEvenement(c.options.evenement, { ...c.data, today: "2026-10-14" });
    assert.equal(message, attendu);
  });
}

test("types : dix types de la V1, sept réservés refusés avec le même message", () => {
  assert.equal(E.TYPES_V1.length, 10);
  for (const t of E.TYPES_RESERVES) {
    assert.equal(E.validerEvenement({ type: t, personne: "foyer", libelle: "x", date: "2027-01-01", params: {}, source: "s" }, { today: "2026-10-14" }),
      "Ce type d'événement n'est pas encore pris en compte par la projection.");
  }
  assert.match(E.validerEvenement({ type: "inconnu", personne: "foyer", libelle: "x", date: "2027-01-01", params: {}, source: "s" }, { today: "2026-10-14" }), /Type d'événement inconnu/);
});
test("validation : date dans 40 ans au plus, libellé, source, paramètres en objet", () => {
  const base = { type: "retrait", personne: "foyer", libelle: "Voiture", date: "2027-01-01", params: { montant: 1234 }, source: "cas fictif" };
  const ctx = { today: "2026-10-14" };
  assert.equal(E.validerEvenement(base, ctx), null);
  assert.match(E.validerEvenement({ ...base, date: "2066-10-15" }, ctx), /comprise entre le 1er janvier 1950/);
  assert.equal(E.validerEvenement({ ...base, date: "2066-10-14" }, ctx), null);
  assert.match(E.validerEvenement({ ...base, date: "2027-02-30" }, ctx), /comprise entre/);
  assert.match(E.validerEvenement({ ...base, libelle: "" }, ctx), /libellé/);
  assert.match(E.validerEvenement({ ...base, libelle: "x".repeat(61) }, ctx), /libellé/);
  assert.match(E.validerEvenement({ ...base, source: "" }, ctx), /source/);
  assert.match(E.validerEvenement({ ...base, params: [] }, ctx), /objet/);
  assert.equal(E.validerEvenement({ ...base, params: { montant: -1 } }, ctx), "Les montants doivent être positifs ou nuls.");
  assert.match(E.validerEvenement({ ...base, params: {} }, ctx), /montant du retrait/);
});
test("validation : chaque type valide accepte ses paramètres de base", () => {
  const ctx = { today: "2026-10-14", credits: [{ id: "c1" }], biens: [{ id: "b1" }] };
  const e = (type, params, extra) => ({ type, personne: "foyer", libelle: "Libellé", date: "2027-06-01", params, source: "cas fictif", ...extra });
  assert.equal(E.validerEvenement(e("creche", { enfant: "Enfant 1", mode: "assistante_maternelle", cout_mensuel: 900 }), ctx), null);
  assert.equal(E.validerEvenement(e("creche", { enfant: "Enfant 1", mode: "montant", cout_mensuel: 400 }), ctx), null);
  assert.equal(E.validerEvenement(e("scolarite_privee", { enfant: "Enfant 1", niveau: "lycee", frais_annuels: 5000 }), ctx), null);
  assert.equal(E.validerEvenement(e("achat_immobilier", { prix: 250000, apport: 40000, pret: { duree_ans: 20 }, charges_mensuelles: 200 }), ctx), null);
  assert.equal(E.validerEvenement(e("achat_immobilier", { prix: 250000, apport: "max", usage: "locatif", pret: { duree_ans: 20, taux_pct: 3.4 }, charges_mensuelles: 0 }), ctx), null);
  assert.equal(E.validerEvenement(e("fin_credit", { credit: "credit:c1", part_reaffectee_epargne_pct: 40 }), ctx), null);
  assert.equal(E.validerEvenement(e("fin_credit", { credit: "bien:b1" }), ctx), null);
  assert.equal(E.validerEvenement(e("crise", { cle: "covid_2020" }), ctx), null);
  assert.equal(E.validerEvenement(e("changement_emploi", { personne: "p1", salaire_net_mensuel: 0 }, { personne: "p1" }), ctx), null);
  assert.equal(E.validerEvenement(e("conge_parental", { personne: "p2", activite: "mi_temps" }, { personne: "p2", fin: "2027-12-01" }), ctx), null);
  assert.match(E.validerEvenement(e("conge_parental", { personne: "p2", activite: "arret" }, { personne: "p2" }), ctx), /date de fin du congé/);
  assert.match(E.validerEvenement(e("naissance", { enfant: "x".repeat(41) }), ctx), /libellé court/);
  assert.match(E.validerEvenement(e("naissance", { enfant: "Enfant 2", cout_mode: "montant" }), ctx), /coût mensuel de l'enfant/);
  assert.match(E.validerEvenement(e("hausse_revenu", { personne: "foyer", delta_mensuel: 100 }, { personne: "foyer" }), ctx), /p1 ou p2/);
  assert.match(E.validerEvenement(e("achat_immobilier", { prix: 250000, apport: 40000, pret: { duree_ans: 41 }, charges_mensuelles: 200 }), ctx), /durée du prêt/);
});
test("variantes : nom, description, retire, hypothèses connues, bornes", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(E.validerVariante({ nom: "2e enfant", description: "", retire: [id], hypotheses: { epargne_delta_mensuel: 200, reste_capacite: "cible" } }), null);
  assert.match(E.validerVariante({ nom: "" }), /nom de la variante/);
  assert.match(E.validerVariante({ nom: "x".repeat(41) }), /nom de la variante/);
  assert.match(E.validerVariante({ nom: "v", description: "x".repeat(301) }), /300 caractères/);
  assert.match(E.validerVariante({ nom: "v", retire: ["pas-un-uuid"] }), /identifiants/);
  assert.match(E.validerVariante({ nom: "v", hypotheses: { inconnue: 1 } }), /Hypothèse inconnue/);
  assert.match(E.validerVariante({ nom: "v", hypotheses: { reste_capacite: "x" } }), /cible/);
  assert.match(E.validerVariante({ nom: "v", hypotheses: { part_reaffectee_epargne_pct: 120 } }), /0 et 100/);
  assert.equal(E.validerVariante({ nom: "v", hypotheses: { hypotheses_classes: { actions: { rendement: 12 } } } }), null);
  assert.match(E.validerVariante({ nom: "v", hypotheses: { hypotheses_classes: { bitcoin: { rendement: 12 } } } }), /Classe inconnue/);
});
test("valeurs par défaut sourcées d'un événement : repère, source, jamais de valeur de secours", () => {
  const reperes = reperesComplets();
  const d = E.defautsDe({ type: "naissance", params: { enfant: "Enfant 2" } }, reperes);
  assert.deepEqual(d.map(x => x.cle), ["cout_mode", "fin_age"]);
  const fin = d.find(x => x.cle === "fin_age");
  assert.equal(fin.valeur, 20);
  assert.match(fin.source, /convention|HCFEA|Insee|Boussole/i);
  const sans = E.defautsDe({ type: "naissance", params: { enfant: "Enfant 2" } }, reperes.filter(r => r.cle !== "enfant_fin_charge_age"));
  assert.equal(sans.find(x => x.cle === "fin_age").manquant, true);
  assert.equal(E.defautsDe({ type: "naissance", params: { enfant: "E", fin_age: 18, cout_mode: "uc" } }, reperes).length, 0);
});
