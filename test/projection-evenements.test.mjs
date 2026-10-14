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

/* ---------------------------------------------------------------- effets des événements dans le moteur (web/src/projection.js) */
import { entreeDe } from "./helpers/projection-cas.mjs";
const P = req("../web/src/projection.js");
const gros = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, (m || "") + " : " + a + " ≠ " + b);
const base = () => { const d = entreeDe(cas("D-8")); d.foyer.evenements = []; return d; };
const ev = (type, params, extra) => ({ id: "e-" + type + Math.random().toString(36).slice(2, 6), type, personne: "foyer", libelle: "Libellé " + type, date: "2027-06-01", params, source: "cas fictif", ...extra });
const modele = (d, evenements, opt) => { d.foyer.evenements = evenements; return P.preparer(d, { horizon_ans: 10, volatilite: 0, vue: "financier", ...(opt || {}) }); };

test("hausse de revenu : la moitié du gain est épargnée par défaut, une baisse est entière, +10 % du salaire", () => {
  let M = modele(base(), [ev("hausse_revenu", { personne: "p1", delta_mensuel: 400 }, { personne: "p1", date: "2027-06-01" })]);
  gros(M.reelDelta[10], 200, 1e-9); gros(M.reelDelta[7], 0, 1e-9);
  M = modele(base(), [ev("hausse_revenu", { personne: "p1", delta_mensuel: -400 }, { personne: "p1" })]);
  gros(M.reelDelta[12], -400, 1e-9);
  M = modele(base(), [ev("hausse_revenu", { personne: "p1", delta_pct: 10, part_epargnee_pct: 100 }, { personne: "p1" })]);
  gros(M.reelDelta[12], 300, 1e-9, "10 % de 3 000 €, tout épargné");
});
test("changement d'emploi : par rapport au revenu de référence, retour au revenu de référence avec une date de fin", () => {
  const d = base();
  const M = modele(d, [ev("changement_emploi", { personne: "p2", salaire_net_mensuel: 0, revenu_reference_mensuel: 2000 }, { personne: "p2", date: "2027-01-01", fin: "2027-07-01" })]);
  gros(M.reelDelta[3], -2000, 1e-9, "période sans revenu : baisse entière"); gros(M.reelDelta[12], 0, 1e-9, "retour au revenu de référence");
  assert.ok(M.avertissements.every(m => !/revenu de référence supposé/.test(m)));
  const sans = modele(base(), [ev("changement_emploi", { personne: "p2", salaire_net_mensuel: 3000 }, { personne: "p2", date: "2027-01-01" })]);
  gros(sans.reelDelta[5], 500, 1e-9, "salaire du profil (2 000 €) comme référence : +1 000 € dont la moitié épargnée");
  assert.ok(sans.avertissements.some(m => /revenu de référence supposé/.test(m)));
});
test("congé parental : quotité, PreParE six mois, mention à partir du 2ᵉ enfant", () => {
  const e = (extra, params) => ev("conge_parental", { personne: "p1", activite: "mi_temps", enfant: "Enfant 1", ...params }, { personne: "p1", date: "2027-02-01", fin: "2028-02-01", ...extra });
  let M = modele(base(), [e()]);
  gros(M.reelDelta[5], -1500 + 297.17, 0.005, "mi-temps : 50 % de 3 000 € perdus, PreParE de 297,17 €");
  gros(M.reelDelta[12], -1500, 0.005, "au-delà de six mois, plus de PreParE");
  M = modele(base(), [e({}, { activite: "temps_partiel" })]);
  gros(M.reelDelta[5], -600 + 171.42, 0.005, "80 % de quotité par défaut");
  M = modele(base(), [e({}, { activite: "arret", rang_enfant: 2 })]);
  assert.ok(M.avertissements.some(m => /2ᵉ enfant.*6 mois comptés/.test(m)));
  M = modele(base(), [e({}, { activite: "arret", quotite_pct: 20 })]);
  gros(M.reelDelta[5], -2400 + 459.7, 0.005, "quotité fournie");
});
test("école privée : frais annuels / 12 du début à la fin ; retrait ponctuel et achat consignés pour la décomposition", () => {
  const M = modele(base(), [ev("scolarite_privee", { enfant: "Enfant 1", niveau: "college", frais_annuels: 6000 }, { date: "2027-09-01", fin: "2028-07-01" })]);
  gros(M.reelDelta[12], -500, 1e-9); gros(M.reelDelta[3], 0, 1e-9); gros(M.reelDelta[40], 0, 1e-9);
  assert.match(M.jalons.find(j => j.type === "scolarite_privee").effet.texte, /−500 €\/mois, 6 000 € par an/);
});
test("naissance : enfant déjà né (seuls les changements comptent), coût en montant, âge de fin personnalisé", () => {
  const d = base(); d.profil.foyer.enfants = 1; d.profil.foyer.enfants14 = 0;
  /* enfant de 13 ans à 14 ans dans 6 mois : +0,2 UC (0,5 − 0,3) × dépenses par UC (3 000 / 1,8 UC) */
  const M = modele(d, [ev("naissance", { enfant: "Enfant 1", cout_mode: "uc" }, { date: "2013-04-01" })]);
  const UC = 1 + 0.5 + 0.3, parUC = 3000 / UC;
  gros(M.reelDelta[1], 0, 1e-9, "déjà dans les dépenses"); gros(M.reelDelta[8], -0.2 * parUC, 1e-6);
  const m2 = modele(base(), [ev("naissance", { enfant: "Enfant 2", cout_mode: "montant", cout_mensuel: 450, fin_age: 3 }, { date: "2027-02-01" })]);
  gros(m2.reelDelta[5], -450, 1e-9); gros(m2.reelDelta[40], 0, 1e-9, "fin à 3 ans");
});
test("achat immobilier : apport « max » (tout le mobilisable au-dessus du matelas), crédit, mensualité, jalon chiffré, bien au patrimoine net", () => {
  const d = entreeDe(cas("C-4"));
  d.foyer.evenements = d.foyer.evenements.filter(e => e.type === "achat_immobilier");
  d.foyer.evenements[0].params.apport = "max";
  const M = P.preparer(d, { horizon_ans: 10, vue: "net" }), r = P.simuler(M, { volatilite: 0 });
  const a = r.achats[0];
  assert.ok(a.apport > 60000, "apport maximal " + a.apport);
  gros(a.emprunt, 324000 - a.apport, 1e-6); assert.ok(a.apport_sources.length >= 2);
  assert.match(r.jalons.find(j => j.type === "achat_immobilier").effet.texte, /^apport −\d+ k€ pris sur .+, mensualité −/);
  gros(r.deterministe_detail.courants.disponible[27], 10000, 1e-6, "le matelas de 10 000 € est préservé");
  assert.ok(r.deterministe_detail.courants.net[60] > r.deterministe_detail.courants.financier[60] + 50000, "le bien (net de sa dette) est dans le patrimoine net");
});
test("achat locatif : loyer perçu en revenu, charges en dépenses, pas de loyer remplacé ; taux du jour du repère dit", () => {
  const d = base();
  d.config.enveloppes_infos = { "Compte courant Exemple": { type: "courant" } };
  d.positions = [{ id: "cc", name: "Compte courant", envelope: "Compte courant Exemple", owner: "commun", bloc: "Comptes courants", mode: "manual", value: 100000, status: "actif" }];
  const M = modele(d, [ev("achat_immobilier", { prix: 150000, usage: "locatif", apport: 50000, pret: { duree_ans: 20 }, charges_mensuelles: 120, loyer_percu: 700 })]);
  const r = P.simuler(M, { volatilite: 0 }), a = r.achats[0];
  gros(a.taux_pct, 3.27, 1e-9); gros(a.frais_acquisition, 12000, 1e-9);
  assert.ok(r.avertissements.some(m => /taux du jour du repère \(3,27 %\) pris pour 20 ans/.test(m)));
  const mens = a.mensualite;
  gros(M.reelDelta[10] + 0, 700 - 120, 1e-9); gros(M.nomDelta[10], -mens, 1e-9);
});
test("retrait ponctuel : pris en net dans l'ordre du § 6.3 ; manquer d'argent quand rien ne couvre", () => {
  const d = base();
  d.positions = [{ id: "cc", name: "Compte courant", envelope: "Compte courant Exemple", owner: "commun", bloc: "Comptes courants", mode: "manual", value: 5000, status: "actif" }];
  d.config.enveloppes_infos = { "Compte courant Exemple": { type: "courant" } };
  const M = modele(d, [ev("retrait", { montant: 20000, libelle: "Voiture" }, { date: "2027-02-01" })], { capacite_mensuelle: 0 });
  const r = P.simuler(M, { chemins: 100 });
  gros(r.manquer_argent.probabilite, 1, 1e-9); assert.equal(r.manquer_argent.date_p10, "2027-02-14");
  assert.ok(r.deterministe_detail.courants.disponible[4] < 0 || r.deterministe_detail.courants.financier[4] < 0, "découvert visible, pas masqué");
});
test("objectifs : probabilité d'atteinte, statut, jalon ; cascade programmés → matelas → objectifs → reste", () => {
  const d = entreeDe(cas("G-1"));
  d.objectifs = [{ id: "o1", nom: "Apport", type: "apport", cible: 200000, dateCible: "2031-10-14", deja: 0, source: "poches", poches: ["Monde"], enveloppes: [], priorite: 1 }];
  const M = P.preparer(d, { horizon_ans: 6, vue: "financier", capacite_mensuelle: 1000, reste_capacite: "cible" });
  const r = P.simuler(M, { chemins: 400 });
  const o = r.objectifs[0];
  assert.ok(o.probabilite > 0 && o.probabilite < 1, "probabilité " + o.probabilite); assert.ok(["probable", "incertain", "peu probable"].includes(o.mot));
  assert.ok(r.jalons.some(j => j.type === "objectif" && /chances sur 10/.test(j.effet.texte)));
  /* l'effort mensuel nécessaire est versé en priorité dans la poche de l'objectif */
  assert.ok(M.objs[0].effort > 0 && M.objs[0].effort < 1000);
  const facile = JSON.parse(JSON.stringify(d)); facile.objectifs[0].cible = 100000;
  assert.equal(P.simuler(P.preparer(facile, { horizon_ans: 6, vue: "financier", capacite_mensuelle: 1000, reste_capacite: "cible" }), { chemins: 200 }).objectifs[0].mot, "probable");
});
test("versements programmés : virements automatiques vers leur ligne, l'écart est pris sur le disponible", () => {
  const d = entreeDe(cas("D-2"));
  d.config.recurring = [{ id: "r1", label: "Versement", positionId: "ct", amount: 800, day: 5, start: "2026-01-01" }];
  d.positions.push({ id: "cc", name: "Compte courant", envelope: "Compte courant Exemple", owner: "commun", bloc: "Comptes courants", mode: "manual", value: 3000, status: "actif" });
  d.config.enveloppes_infos["Compte courant Exemple"] = { type: "courant" };
  const r = P.simuler(P.preparer(d, { horizon_ans: 1, capacite_mensuelle: 500, vue: "financier", hypotheses_classes: { actions: { rendement: 0, volatilite: 0 } } }), { volatilite: 0 });
  gros(r.deterministe_detail.courants.disponible[10], 0, 1e-6, "800 € programmés pour 500 € de capacité : 300 € pris sur le disponible chaque mois, 3 000 € épuisés au mois 10");
  gros(r.deterministe_detail.courants.financier[12], 10000 + 3000 + 500 * 12, 1e-6, "ensuite le compte-titres couvre l'écart : le patrimoine ne change pas");
});
test("rééquilibrage annuel : en janvier, les compartiments d'une enveloppe reviennent à la cible, sans impôt", () => {
  const d = entreeDe(cas("D-2"));
  d.positions = [{ id: "a", name: "ETF Monde", envelope: "Assurance vie Exemple", owner: "p1", bloc: "Monde", mode: "manual", value: 8000, status: "actif" }, { id: "b", name: "Obligations", envelope: "Assurance vie Exemple", owner: "p1", bloc: "Obligations", mode: "manual", value: 2000, status: "actif" }];
  d.config.enveloppes_infos = { "Assurance vie Exemple": { type: "assurance_vie", titulaire: "p1", date_ouverture: "2015-01-01", versements_cumules: 8000 } };
  d.config.targets = { actions: 50, obligations: 50 };
  const sans = P.simuler(P.preparer(d, { horizon_ans: 2, capacite_mensuelle: 0, vue: "financier", reequilibrage: "aucun" }), { volatilite: 0 });
  const avec = P.simuler(P.preparer(d, { horizon_ans: 2, capacite_mensuelle: 0, vue: "financier", reequilibrage: "annuel" }), { volatilite: 0 });
  assert.notEqual(sans.deterministe_detail.courants.financier[24], avec.deterministe_detail.courants.financier[24]);
  const t = avec.mois.findIndex(m => m.slice(5, 7) === "01");
  const v = avec.deterministe_detail.valeurs_par_compartiment, B = avec.deterministe_detail.compartiments.length;
  gros(v[t * B] , v[t * B + 1], 1e-6, "50 / 50 en janvier");
});
test("SCPI en direct bloquée, levier : classe et multiple lus dans le nom, sous-jacent Nasdaq si la poche l'indique", () => {
  const d = base();
  d.positions = [{ id: "l", name: "ETF Levier 3x Exemple", envelope: "Compte-titres Exemple", owner: "p1", bloc: "Nasdaq", mode: "manual", value: 1000, status: "actif", qty: 10, pru: 100 },
    { id: "s", name: "SCPI Exemple", envelope: "Compte-titres Exemple", owner: "p1", bloc: "SCPI", mode: "manual", value: 5000, status: "actif", qty: 10, pru: 450 }];
  d.config.enveloppes_infos = { "Compte-titres Exemple": { type: "compte_titres", titulaire: "p1" } };
  const M = P.preparer(d, { horizon_ans: 1 });
  const lev = M.comps.find(c => c.levier), scpi = M.comps.find(c => c.type === "scpi_direct");
  assert.deepEqual(lev.levier, { multiple: 3, sous_jacent: "actions_nasdaq100" });
  assert.ok(scpi && scpi.dispo === false);
});
