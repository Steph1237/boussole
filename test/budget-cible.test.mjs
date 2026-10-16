// BUD1, tâche 10 : cible proposée (Budget.proposerCible, spec § 8.3), plancher de reste à vivre et repère Insee (T4, T5). Cas T1 à T5 de
// test/fixtures/budget-cas.json, calculés à la main ; l'épargne nécessaire est fournie par un bouchon (le moteur de projection réel entre en tâche 13).
// Les attendus viennent de la fixture, jamais du code. Valeurs fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const F = JSON.parse(readFileSync(new URL("./fixtures/budget-cas.json", import.meta.url), "utf8"));
const Budget = require("../web/src/budget.js");
const J = v => JSON.parse(JSON.stringify(v));
const cas = id => F.cible.find(c => c.id === id);
const entree = (c, extra = {}) => ({ reference: c.reference, capacite_constatee: c.capacite_constatee, epargne_necessaire: c.epargne_necessaire ?? null, matelas_mensuel: c.matelas_mensuel ?? 0,
  pistes: c.pistes, protegees: c.protegees, plancher: c.plancher, ...extra });
const somme = o => Object.values(o).reduce((t, x) => t + x, 0);

test("T1 · les trois options : tenable 680 (14,2 %), équilibrée 839 (17,5 %), ambitieuse 1 030 (21,5 %)", () => {
  const c = cas("T1"), r = Budget.proposerCible({}, entree(c));
  for (const k of ["tenable", "equilibree", "ambitieuse"]) assert.deepEqual([r.options[k].montant, r.options[k].taux], [c.attendu[k].montant, c.attendu[k].taux], k + " : " + c.calcul);
  assert.equal(r.capacite_taux, c.attendu.capacite_taux);
  assert.deepEqual(Object.values(r.options).map(o => o.effort), ["léger", "moyen", "soutenu"]);
  // sans objectif chiffré : l'équilibrée est retenue
  assert.equal(r.retenue, 839); assert.equal(r.niveau, "equilibree"); assert.equal(r.atteignable_8_sur_10, null); assert.deepEqual(r.leviers, []);
  assert.equal(r.controles.somme, true);
  assert.equal(somme(r.blocs), 4800, "somme exacte des blocs");
});

test("T2 · nécessaire 900 : retenue 900 (18,75 %), faciles 30 + contrats 31 + envies 189, sous-catégories au plus fort reste, contrôles tenus", () => {
  const c = cas("T2"), a = c.attendu, r = Budget.proposerCible({}, entree(c));
  assert.equal(r.retenue, a.retenue); assert.equal(r.taux, a.taux); assert.equal(r.niveau, a.niveau);
  assert.deepEqual(J(r.couverture), a.couverture);
  assert.deepEqual(J(r.blocs), a.blocs, c.calcul);
  assert.deepEqual(J(r.sous_categories), a.sous_categories);
  assert.deepEqual(J(r.controles), a.controles);
  assert.equal(r.atteignable_8_sur_10, true); assert.deepEqual(r.leviers, []); assert.equal(r.limite_par_plancher, false); assert.equal(r.orientation, false);
  // la cible est à la forme de config.budget_cible (sommes exactes, clés connues, protégées gardées)
  assert.equal(r.cible.revenus_ref, 4800); assert.deepEqual(J(r.cible.blocs), a.blocs); assert.deepEqual(r.cible.protegees, ["sport"]); assert.equal(r.cible.niveau, "necessaire");
  assert.equal(r.cible.taux_epargne, 18.75);
  assert.equal(somme(r.cible.blocs), r.cible.revenus_ref);
  assert.equal(somme(r.cible.sous_categories), r.cible.blocs.essentiels + r.cible.blocs.envies, "somme des sous-catégories de dépenses = essentiels + envies");
  assert.equal(r.sous_categories.sport, 90, "sport protégé : sa référence");
  assert.equal(r.cible.source.length > 0, true);
});

test("T3 · nécessaire 1 200 au-delà de l'ambitieuse : retenue 1 030, non atteignable à 8 chances sur 10 par l'épargne seule, leviers listés", () => {
  const c = cas("T3"), a = c.attendu, r = Budget.proposerCible({}, entree(c));
  assert.equal(r.retenue, a.retenue); assert.equal(r.niveau, a.niveau); assert.equal(r.atteignable_8_sur_10, false);
  assert.deepEqual(r.leviers, a.leviers);
  assert.deepEqual(J(r.blocs), a.blocs, c.calcul);
  for (const [k, v] of Object.entries(a.sous_categories_envies)) assert.equal(r.sous_categories[k], v, k);
  assert.equal(r.controles.somme, true); assert.equal(r.controles.protegees, true);
});

test("T4 · plancher de reste à vivre : S* = ⌊800 − 651,69⌋ = 148, répartition au plus fort reste dans l'ordre de la taxonomie, orientation", () => {
  const c = cas("T4"), a = c.attendu, r = Budget.proposerCible({}, entree(c));
  assert.deepEqual([r.options.tenable.montant, r.options.equilibree.montant, r.options.ambitieuse.montant], [a.tenable, a.equilibree, a.ambitieuse]);
  assert.equal(r.retenue, a.retenue, c.calcul);
  assert.equal(r.limite_par_plancher, a.limite_par_plancher); assert.equal(r.orientation, a.orientation);
  assert.deepEqual(J(r.blocs), a.blocs);
  assert.deepEqual(J(r.sous_categories), a.sous_categories);
  assert.equal(r.atteignable_8_sur_10, a.atteignable_8_sur_10);
  assert.ok(800 - (r.blocs.essentiels + r.blocs.envies) >= 0 && r.blocs.essentiels + r.blocs.envies >= c.plancher.valeur, "Ess* + Env* ≥ plancher");
  assert.equal(r.controles.plancher, true); assert.equal(r.niveau, "personnalisee");
  // sans plancher fourni, la retenue de 153 n'est pas bornée
  const sans = Budget.proposerCible({}, entree(c, { plancher: undefined }));
  assert.equal(sans.retenue, 153); assert.equal(sans.limite_par_plancher, false);
});

test("T5 · repère Insee du logement : 1 410 ÷ 3 970 = 35,5 %, contre 29,0 % des locataires, « au-dessus du repère », jamais une contrainte", () => {
  const c = cas("T5"), a = c.attendu;
  const r = Budget.comparerInsee(c.reference, F.reperes, { logement: "locataire" });
  assert.deepEqual([r.logement, r.consommation, r.part, r.repere, r.repere_valeur, r.lecture], [a.logement, a.consommation, a.part, a.repere, a.repere_valeur, a.lecture], c.calcul);
  assert.match(r.texte, /^Ton logement pèse 35,5 % de ta consommation, contre 29 % en moyenne pour les locataires \(Insee, enquête 2017\) : au-dessus de ce repère\. C'est un point de comparaison, jamais une contrainte\.$/);
  assert.deepEqual(r.fourchette, [27.4, 29.3], "fourchette des quintiles présents dans les repères");
  // propriétaire ou ménage : autre repère ; repère absent : rien
  assert.equal(Budget.comparerInsee(c.reference, F.reperes, { logement: "proprietaire" }).repere, "insee_bdf2017_logement_proprietaires");
  assert.equal(Budget.comparerInsee(c.reference, F.reperes, { menage: "couple_sans_enfant" }).repere, "insee_bdf2017_logement_couple_sans_enfant");
  assert.equal(Budget.comparerInsee(c.reference, [], { logement: "locataire" }), null);
  assert.equal(Budget.comparerInsee({ revenus: 0, essentiels: {}, envies: {} }, F.reperes, { logement: "locataire" }), null);
  // sous le repère
  assert.equal(Budget.comparerInsee({ revenus: 4000, essentiels: { loyer: 400, courses: 800 }, envies: { restaurants: 400 } }, F.reperes, { logement: "locataire" }).lecture, "sous_le_repere");
  assert.equal(Budget.comparerInsee({ revenus: 4000, essentiels: { loyer: 480, courses: 800 }, envies: { restaurants: 400 } }, F.reperes, { logement: "locataire" }).lecture, "dans_le_repere");
});

test("plancherResteAVivre : composition du foyer → repère RSA forfaitaire (seul, couple, 1 ou 2 enfants, personne supplémentaire à partir du 3e)", () => {
  const p = (adultes, enfants) => J(Budget.plancherResteAVivre({ adultes, enfants }, F.reperes));
  assert.deepEqual(p(1, 0), { repere: "rsa_forfaitaire_seul", valeur: 651.69, personnes_en_plus: 0 });
  assert.deepEqual(p(2, 0), { repere: "rsa_forfaitaire_couple", valeur: 977.54, personnes_en_plus: 0 });
  assert.equal(p(1, 1).repere, "rsa_forfaitaire_seul_1_enfant"); assert.equal(p(1, 2).valeur, 1173.05);
  assert.equal(p(2, 1).repere, "rsa_forfaitaire_couple_1_enfant"); assert.equal(p(2, 2).valeur, 1368.55);
  assert.deepEqual(p(2, 4), { repere: "rsa_forfaitaire_couple_2_enfants", valeur: 1889.91, personnes_en_plus: 2 }, "1 368,55 + 2 × 260,68");
  assert.equal(p(1, 3).valeur, 1433.73);
  assert.deepEqual(J(Budget.plancherResteAVivre({}, F.reperes)), { repere: "rsa_forfaitaire_seul", valeur: 651.69, personnes_en_plus: 0 }, "foyer inconnu : une personne");
  assert.equal(Budget.plancherResteAVivre({ adultes: 1, enfants: 0 }, []), null, "repère manquant : pas de plancher inventé");
  assert.equal(Budget.plancherResteAVivre({ adultes: 2, enfants: 3 }, F.reperes.filter(r => r.cle !== "rsa_forfaitaire_personne_supplementaire")), null);
});

test("plus fort reste : somme exacte, à reste égal l'ordre de la taxonomie, références nulles ou vides", () => {
  const refs = new Map([["restaurants", 100], ["shopping", 100]]);
  assert.deepEqual(J([...Budget.repartir(155, refs)]), [["restaurants", 78], ["shopping", 77]]);
  assert.deepEqual(J([...Budget.repartir(155, new Map([["shopping", 100], ["restaurants", 100]]))]), [["restaurants", 78], ["shopping", 77]], "l'ordre d'entrée ne compte pas");
  assert.deepEqual([...Budget.repartir(10, new Map())], []);
  assert.deepEqual(J([...Budget.repartir(10, new Map([["loisirs", 0]]))]), [["loisirs", 0]]);
  for (const total of [0, 1, 2, 3, 999, 1000]) assert.equal(somme(Object.fromEntries(Budget.repartir(total, new Map([["restaurants", 13], ["sorties", 7], ["voyages", 29]])))), total, "total " + total);
});

test("niveau choisi : tenable, équilibrée ou ambitieuse imposés ; la nécessaire ne dépasse jamais l'ambitieuse ; choix de pistes", () => {
  const c = cas("T2");
  for (const [niveau, montant] of [["tenable", 680], ["equilibree", 839], ["ambitieuse", 1030]]) {
    const r = Budget.proposerCible({}, entree(c, { niveau }));
    assert.equal(r.retenue, montant, niveau); assert.equal(r.niveau, niveau); assert.equal(somme(r.blocs), 4800); assert.equal(r.controles.somme, true, niveau);
  }
  assert.equal(Budget.proposerCible({}, entree(cas("T3"), { niveau: "necessaire" })).retenue, 1030);
  // sans épargne nécessaire, « necessaire » n'existe pas : l'équilibrée
  assert.equal(Budget.proposerCible({}, entree(c, { niveau: "necessaire", epargne_necessaire: null })).niveau, "equilibree");
  // matelas à reconstituer : ajouté à la nécessaire
  const m = Budget.proposerCible({}, entree(c, { epargne_necessaire: 700, matelas_mensuel: 100 }));
  assert.equal(m.necessaire, 800); assert.equal(m.retenue, 800);
  // nécessaire sous le tenable : le tenable (jamais moins que ce qu'on épargne déjà plus les pistes faciles)
  assert.equal(Budget.proposerCible({}, entree(c, { epargne_necessaire: 100 })).retenue, 680);
  // pistes acceptées : seules celles-là comptent
  const choix = Budget.proposerCible({}, entree(c, { choix_pistes: ["frais_bancaires"], niveau: "ambitieuse" }));
  assert.equal(choix.options.tenable.montant, 665); assert.equal(choix.retenue, 665);
  assert.equal(choix.sous_categories.frais_bancaires, 5); assert.equal(choix.sous_categories.abonnements, 85, "l'abonnement n'a pas été accepté");
});

test("protégées : aucune réduction, même demandée ; sans références ni pistes, la cible reste cohérente", () => {
  const c = cas("T2");
  const r = Budget.proposerCible({}, entree(c, { protegees: ["sport", "restaurants"], pistes: [...c.pistes, { cle: "x", poste: "restaurants", difficulte: "facile", economie_mensuelle: { retenue: 50 } }] }));
  assert.equal(r.sous_categories.sport, 90); assert.equal(r.sous_categories.restaurants, 380, "restaurants protégé : sa référence, la piste qui le vise est ignorée");
  assert.equal(r.controles.protegees, true);
  const vide = Budget.proposerCible({}, { reference: { revenus: 3000, essentiels: { loyer: 1000 }, envies: { restaurants: 500 } }, capacite_constatee: 1500, pistes: [] });
  assert.equal(vide.retenue, 1500); assert.equal(vide.controles.somme, true); assert.deepEqual(J(vide.blocs), { essentiels: 1000, envies: 500, epargne: 1500 });
  // épargne cible plus basse que la capacité constatée : la marge revient aux envies, la somme reste exacte
  const bas = Budget.proposerCible({}, { reference: { revenus: 3000, essentiels: { loyer: 1000 }, envies: { restaurants: 500 } }, capacite_constatee: 1500, pistes: [], epargne_necessaire: 1000, niveau: "tenable" });
  assert.equal(bas.retenue, 1500, "le tenable est la capacité constatée : jamais moins");
});

test("objectifs : l'effet sur chaque objectif vient d'un évaluateur injecté (le moteur de projection), jamais calculé ici", () => {
  const c = cas("T2"), appels = [];
  const r = Budget.proposerCible({}, entree(c, { evaluer: s => { appels.push(s); return [{ id: "apport", probabilite_avant: 0.5, probabilite_apres: 0.8 }]; } }));
  assert.deepEqual(appels, [900]);
  assert.deepEqual(J(r.cible.objectifs), [{ id: "apport", probabilite_avant: 0.5, probabilite_apres: 0.8 }]);
  assert.equal(Budget.proposerCible({}, entree(c)).cible.objectifs, undefined);
});

test("déterminisme et entrées intactes", () => {
  const c = cas("T2"), e = entree(c), avant = J(e);
  const a = Budget.proposerCible({}, e), b = Budget.proposerCible({}, e);
  assert.deepEqual(J(a), J(b)); assert.deepEqual(J(e), avant);
});

test("relecture (tâche 12) : capacité négative ou revenus nuls → montants_positifs faux (la base refuserait la cible) ; T1 à T5 et le cas vide restent positifs", () => {
  for (const id of ["T1", "T2", "T3", "T4"]) assert.equal(Budget.proposerCible({}, entree(cas(id))).montants_positifs, true, id);
  // dépenses de référence au-dessus des revenus : la capacité constatée est négative, l'épargne tenable aussi
  const neg = Budget.proposerCible({}, { reference: { revenus: 2000, essentiels: { loyer: 1500, courses: 700 }, envies: { restaurants: 300 } }, capacite_constatee: -500, pistes: [] });
  assert.ok(neg.retenue < 0, "le tenable est la capacité constatée : " + neg.retenue);
  assert.equal(neg.montants_positifs, false, "épargne négative : rien à proposer tel quel");
  assert.equal(neg.controles.somme, true, "la somme reste exacte : le contrôle de somme ne suffit pas");
  // revenus nuls avec un plancher : l'épargne est ramenée à 0, les envies deviennent négatives
  const zero = Budget.proposerCible({}, { reference: { revenus: 0, essentiels: { loyer: 500 }, envies: { restaurants: 100 } }, capacite_constatee: -600, pistes: [],
    plancher: { repere: "rsa_forfaitaire_seul", valeur: 651.69 } });
  assert.equal(zero.retenue, 0); assert.equal(zero.limite_par_plancher, true);
  assert.equal(zero.montants_positifs, false, "envies négatives");
});
