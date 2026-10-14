// PROJ / IMMO1 : capacité d'emprunt aujourd'hui (web/src/projection-immo.js) — cas I-1 à I-4 de test/fixtures/projection-cas.json, revenus retenus,
// périmètres, apport mobilisable net d'impôts, sensibilité, taux et usure datés, durée HCSF avec différé, absence de valeur de secours,
// et non-régression du code de crédit déplacé de la Toise (mêmes montants qu'avant, à taux égaux).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cas, entreeDe, reperesComplets } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const Immo = req("../web/src/projection-immo.js");
const Credit = req("../web/src/projection-credit.js");
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b);
const calcul = (id, extra) => { const c = cas(id); return Immo.capaciteEmprunt(entreeDe(c), { ...c.options, ...extra }); };

test("I-1 : revenus 5 000 €, crédits 300 €, 35 %, 3,35 %, 25 ans, assurance 0,15 %", () => {
  const r = calcul("I-1"), a = cas("I-1").attendu;
  proche(r.revenus_retenus.total, a.revenus_retenus, 0.01);
  proche(r.charges, a.charges, 0.01);
  proche(r.mensualite_max, a.mensualite_max, 0.01);
  proche(r.montant_empruntable, a.montant_empruntable, 0.01);
  proche(r.echeance, a.echeance, 0.01);
  proche(r.assurance_mensuelle, a.assurance_mensuelle, 0.01);
  assert.match(r.mention, new RegExp(a.mention, "i"));
  assert.match(r.mention, /pas une offre de prêt/);
});
test("I-2 : budget d'achat avec 50 000 € d'apport — ancien, primo-accédant, neuf", () => {
  const r = calcul("I-2"), a = cas("I-2").attendu.budget_achat;
  proche(r.budget_achat_par_type.ancien, a.ancien, 0.01);
  proche(r.budget_achat_par_type.primo, a.primo, 0.01);
  proche(r.budget_achat_par_type.neuf, a.neuf, 0.01);
  proche(r.budget_achat, a.ancien, 0.01, "ancien par défaut");
  proche(calcul("I-2", { primo: true }).budget_achat, a.primo, 0.01);
  proche(calcul("I-2", { neuf: true }).budget_achat, a.neuf, 0.01);
});
test("I-3 : sensibilité 20 et 25 ans × taux −1 / 0 / +1 point", () => {
  const r = calcul("I-3"), a = cas("I-3").attendu;
  assert.equal(r.sensibilite.length, 6);
  for (const s of r.sensibilite) {
    const k = s.duree_ans + "_" + s.taux_pct.toFixed(2);
    proche(s.montant_empruntable, a.sensibilite_montant[k], 0.01, "montant " + k);
    proche(s.budget_achat, a.sensibilite_budget_ancien[k], 0.01, "budget " + k);
  }
});
test("I-4 : loyers perçus pondérés à 70 % (convention, dite)", () => {
  const r = calcul("I-4"), a = cas("I-4").attendu;
  proche(r.revenus_retenus.total, a.revenus_retenus, 0.01);
  assert.ok(r.revenus_retenus.detail.some(x => /convention/.test(x.libelle) && x.montant === 700));
});

const donnees = (extra) => {
  const d = JSON.parse(JSON.stringify(entreeDe(cas("I-1"))));
  return Object.assign(d, extra || {});
};
test("revenus retenus : primes moyennées sur 3 ans si le profil les porte, sinon non comptées avec la mention", () => {
  const sans = Immo.capaciteEmprunt(donnees(), { taux_pct: 3.35, apport: 0 });
  assert.ok(sans.avertissements.some(m => /primes et variable.*non comptés/.test(m)));
  const d = donnees();
  d.profil.personnes.p1.primes_annuelles = [3000, 6000, 9000];
  const avec = Immo.capaciteEmprunt(d, { taux_pct: 3.35, apport: 0 });
  proche(avec.revenus_retenus.total - sans.revenus_retenus.total, 500, 1e-9);
  assert.ok(avec.revenus_retenus.detail.some(x => /Primes.*moyenne de 3 ans/.test(x.libelle)));
});
test("périmètre : foyer, personne 1 et personne 2 (crédits partagés comme dans l'app)", () => {
  const d = donnees();
  d.profil.personnes.p2.salaire = 2000;
  d.credits[0].owner = "commun"; d.profil.credits[0].owner = "commun";
  const foyer = Immo.capaciteEmprunt(d, { taux_pct: 3.35, apport: 0 });
  const p1 = Immo.capaciteEmprunt(d, { perimetre: "p1", taux_pct: 3.35, apport: 0 });
  const p2 = Immo.capaciteEmprunt(d, { perimetre: "p2", taux_pct: 3.35, apport: 0 });
  proche(foyer.revenus_retenus.total, 7000, 1e-9);
  proche(p1.revenus_retenus.total, 5000, 1e-9); proche(p2.revenus_retenus.total, 2000, 1e-9);
  proche(p1.charges, 150, 1e-9); proche(p2.charges, 150, 1e-9);
  proche(foyer.mensualite_max, 0.35 * 7000 - 300, 1e-9);
  proche(p2.mensualite_max, 0.35 * 2000 - 150, 1e-9);
});
test("apport mobilisable : net d'impôts, matelas exclu, PEA de moins de 5 ans exclu, PER à part", () => {
  const d = donnees();
  d.positions = [
    { id: "cc", name: "Compte courant", envelope: "Compte courant Exemple", owner: "commun", bloc: "Comptes courants", mode: "manual", value: 30000, status: "actif" },
    { id: "ct", name: "Fonds Exemple", envelope: "Compte-titres Exemple", owner: "p1", bloc: "Monde", mode: "manual", value: 20000, status: "actif", qty: 200, pru: 90 },
    { id: "pea", name: "ETF Exemple", envelope: "PEA Exemple", owner: "p1", bloc: "Monde", mode: "manual", value: 40000, status: "actif" },
    { id: "per", name: "PER Exemple", envelope: "PER Exemple", owner: "p1", bloc: "Monde", mode: "manual", value: 20000, status: "actif" },
  ];
  d.config = { cushion: { mode: "amount", min: 10000 }, enveloppes_infos: { "Compte courant Exemple": { type: "courant" }, "Compte-titres Exemple": { type: "compte_titres", titulaire: "p1" },
    "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture: "2023-09-01", versements_cumules: 30000 }, "PER Exemple": { type: "per", titulaire: "p1", date_ouverture: "2021-01-05", versements_cumules: 15000 } },
    projection: { tmi_pct: 30, assurance_pct: 0.15 } };
  const rp = Immo.capaciteEmprunt(d, { taux_pct: 3.35 });
  // 20 000 (disponible au-dessus du matelas) + 19 372 (compte-titres net) + PER net 13 930
  proche(rp.apport.sans_per, 20000 + 19372, 0.01);
  proche(rp.apport.per, 13930, 0.01);
  proche(rp.apport.total, 20000 + 19372 + 13930, 0.01);
  assert.equal(rp.apport.detail.some(x => /PEA/.test(x.enveloppe)), false, "PEA de moins de 5 ans exclu");
  assert.ok(rp.avertissements.some(m => /PEA.*moins de 5 ans/.test(m)));
  assert.equal(rp.apport.matelas_exclu, 10000);
  const loc = Immo.capaciteEmprunt(d, { taux_pct: 3.35, usage: "locatif" });
  assert.equal(loc.apport.per, 0, "le PER n'est mobilisable que pour la résidence principale");
  proche(loc.apport.total, 39372, 0.01);
  assert.ok(rp.apport.impots > 0);
});
test("reste à vivre comparé aux dépenses hors logement, sans seuil inventé", () => {
  const d = donnees();
  d.budget = { lignes: [{ id: "a", type: "depense", categorie: "Logement", libelle: "Loyer", montant: 1000 }, { id: "b", type: "depense", categorie: "Vie courante", libelle: "Courses", montant: 2400 }] };
  const r = Immo.capaciteEmprunt(d, { taux_pct: 3.35, apport: 0 });
  proche(r.reste_a_vivre, 5000 - 300 - r.mensualite_nouvelle, 1e-6);
  proche(r.mensualite_nouvelle, 1450, 1e-6);
  proche(r.depenses_hors_logement, 2400, 1e-9);
  assert.equal(Immo.capaciteEmprunt(donnees(), { taux_pct: 3.35, apport: 0 }).depenses_hors_logement, null);
});
test("taux du jour : repère daté et sourcé ; « à actualiser » après sa date de fin ; durée la plus proche", () => {
  const d = donnees(); d.today = "2026-10-14";
  const r = Immo.capaciteEmprunt(d, { duree_ans: 20, apport: 0 });
  assert.equal(r.taux.valeur, 3.27);
  assert.equal(r.taux.a_actualiser, false);
  assert.equal(r.taux.date_effet, "2026-08-01");
  assert.match(r.taux.source, /Crédit Logement|Observatoire/);
  const apres = Immo.capaciteEmprunt({ ...d, today: "2026-11-15" }, { duree_ans: 20, apport: 0 });
  assert.equal(apres.taux.a_actualiser, true);
  assert.ok(apres.avertissements.some(m => /taux à actualiser/.test(m)));
  assert.ok(r.sources.some(s => s.cle === "taux_credit_immo_20" && /^https:/.test(s.url) && s.verifie_le));
});
test("TAEG estimé contre le taux d'usure par tranche de durée (4,09 / 4,68 / 5,40 % au 1er octobre 2026)", () => {
  assert.equal(Immo.trancheUsure(9), "moins_10"); assert.equal(Immo.trancheUsure(10), "10_20"); assert.equal(Immo.trancheUsure(19), "10_20");
  assert.equal(Immo.trancheUsure(20), "20_plus"); assert.equal(Immo.trancheUsure(25), "20_plus");
  const r = calcul("I-1");
  assert.equal(r.usure.valeur, 5.4); assert.equal(r.usure.tranche, "20_plus"); assert.equal(r.usure.depasse, false);
  assert.ok(r.taeg_estime > r.taux.valeur && r.taeg_estime < 4);
  const quinze = calcul("I-1", { duree_ans: 15 });
  assert.equal(quinze.usure.valeur, 4.68);
  const cher = calcul("I-1", { taux_pct: 6 });
  assert.equal(cher.usure.depasse, true);
  assert.ok(cher.avertissements.some(m => /dépasse le taux d'usure/.test(m)));
});
test("durée HCSF : 25 ans, 27 ans seulement avec différé dans les cas prévus (seuil de 10 % de travaux)", () => {
  const r27 = calcul("I-1", { duree_ans: 27, type_projet: "vefa" });
  assert.equal(r27.duree_ans, 27); assert.equal(r27.duree_amortissement_ans, 25); assert.equal(r27.differe_ans, 2);
  proche(r27.montant_empruntable, calcul("I-1").montant_empruntable, 1e-6, "l'amortissement reste limité à 25 ans");
  const ancien = calcul("I-1", { duree_ans: 27 });
  assert.equal(ancien.duree_ans, 25); assert.ok(ancien.avertissements.some(m => /ramenée à 25 ans/.test(m)));
  assert.equal(calcul("I-1", { duree_ans: 27, type_projet: "ancien_travaux", travaux_pct: 9 }).duree_ans, 25);
  assert.equal(calcul("I-1", { duree_ans: 27, type_projet: "ancien_travaux", travaux_pct: 10 }).duree_ans, 27);
  assert.equal(calcul("I-1", { duree_ans: 28, type_projet: "vefa" }).duree_ans, 25);
});
test("aucune valeur de secours : un repère manquant rend le calcul indisponible et le dit", () => {
  for (const cle of ["hcsf_taux_effort", "taux_credit_immo_25", "frais_acquisition_ancien_pct", "garantie_pct", "assurance_emprunteur_defaut_pct"]) {
    const d = entreeDe(cas("I-1")); d.reperes = d.reperes.filter(r => r.cle !== cle);
    d.config.projection.assurance_pct = cle === "assurance_emprunteur_defaut_pct" ? undefined : 0.15;
    const r = Immo.capaciteEmprunt(d, { duree_ans: 25, apport: 0 });
    assert.equal(r.indisponible, true, cle);
    assert.ok(r.avertissements.some(m => m.includes("repère manquant")), cle);
    assert.equal(r.montant_empruntable, undefined);
  }
  const d = entreeDe(cas("I-4")); d.reperes = d.reperes.filter(r => r.cle !== "revenus_locatifs_ponderation");
  const r = Immo.capaciteEmprunt(d, { duree_ans: 25, taux_pct: 3.35, apport: 0 });
  assert.equal(r.revenus_retenus.total, 4000, "loyers non comptés plutôt que pondérés à une valeur inventée");
});
test("pureté : la donnée d'entrée n'est pas modifiée", () => {
  const d = entreeDe(cas("I-1")), avant = JSON.stringify(d);
  Immo.capaciteEmprunt(d, { duree_ans: 25 });
  assert.equal(JSON.stringify(d), avant);
});
test("textes au tutoiement, sans « conseiller » ni produit nommé", () => {
  const r = calcul("I-1", { duree_ans: 27 }), txt = JSON.stringify([r.mention, r.avertissements, r.revenus_retenus.detail]);
  assert.doesNotMatch(txt, /conseiller|\bvous\b|\bvotre\b|\bvos\b/i);
});

/* ------------------------------------------------------------ non-régression du code de crédit déplacé de la Toise */
const LOAN = { dti: 0.35, rentShare: 0.7, guarantee: 0.01, dossier: 1000, notaryAncien: 0.08, notaryPrimo: 0.075, notaryNeuf: 0.025, usure: { 15: 4.57, 20: 5.29, 25: 5.29 } };
test("planPret : mêmes montants que Rang avant la migration (instantané pris avant la modification, taux égaux)", () => {
  // instantané calculé avec l'ancien loanPlan de web/src/toise.js (LOAN d'avant : taux 3,35 %, 25 ans, assurance 0,15 %, frais d'avant)
  const o = { incM: 5000, rentM: 0, creditsM: 300, apport: 50000, years: 25, ratePct: 3.35, insPct: 0.15, bien: "ancien", primo: false, ptz: null, price: null };
  const p = Credit.planPret(o, LOAN);
  proche(p.C, 287063.34837878286, 1e-6); proche(p.price, 308511.7730509213, 1e-6); proche(p.Mmax, 1450, 1e-9);
  proche(p.mens + p.insM, 1450, 1e-6); assert.equal(p.usure, 5.29);
  const avecPrix = Credit.planPret({ ...o, price: 300000 }, LOAN);
  proche(avecPrix.C, (300000 * 1.08 + 1000 - 50000) / 0.99, 1e-6);
  const ptz = Credit.planPret({ ...o, price: null, primo: true, bien: "neuf", ptz: { zone: "B1", type: "coll", travaux: false, rfr: 30000, persons: 2 } }, LOAN, v => Math.round(v) + " €");
  assert.equal(ptz.ptz.ok, true); assert.ok(ptz.ptz.amt > 0);
  assert.equal(Credit.ptz({ primo: false }).ok, false);
  assert.match(Credit.ptz({ primo: true, bien: "neuf", zone: "A", persons: 1, rfr: 100000, cost: 300000, mainLoan: 200000, years: 25 }, v => v + " €").why, /au-dessus du plafond/);
});
test("constantesPret : taux du jour, usure et frais lus dans les repères datés ; null quand le repère manque", () => {
  const c = Credit.constantesPret(reperesComplets());
  assert.deepEqual(c.rates, { 15: 3.14, 20: 3.27, 25: 3.35 });
  assert.deepEqual(c.usure, { 15: 4.68, 20: 5.4, 25: 5.4 });
  assert.equal(c.notaryAncien, 0.08); assert.equal(c.guarantee, 0.01); assert.equal(c.dossier, 1000); assert.equal(c.rentShare, 0.7);
  const vide = Credit.constantesPret([]);
  assert.equal(vide.rates[25], null); assert.equal(vide.guarantee, null);
});
