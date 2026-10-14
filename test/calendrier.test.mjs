// DAT1 : moteur du calendrier patrimonial (web/src/calendrier.js), purement calculé. Cas de référence relus par Opus
// (test/fixtures/calendrier-cas.json, données fictives), fonctions de date, statuts aux bornes, horizon, pureté, textes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { FIXTURE, entreeDe, reduit, attenduDe } from "./helpers/calendrier-cas.mjs";
const req = createRequire(import.meta.url);
const C = req("../web/src/calendrier.js");
const Calc = req("../web/src/calc.js");
const esp = s => String(s).replace(/[\s  ]/g, " ");
const cas = nom => FIXTURE.cas.find(c => c.nom.startsWith(nom));
const sortie = (c, today) => C.calendrier(entreeDe(c), today || c.today);

for (const c of FIXTURE.cas) {
  test("cas de référence : " + c.nom, () => assert.deepEqual(reduit(sortie(c)), attenduDe(c)));
}

test("fixture : 47 cas au moins, données fictives, aucun nom réel", () => {
  assert.ok(FIXTURE.cas.length >= 47);
  const brut = readFileSync(new URL("./fixtures/calendrier-cas.json", import.meta.url), "utf8");
  assert.doesNotMatch(brut, /boursorama|linxea|spirica|credit agricole|bnp|societe generale/i);
});

/* ---------------------------------------------------------------- dates */
test("ajouterAns / ajouterMois : même quantième, ou dernier jour du mois (art. 641 CPC)", () => {
  assert.equal(C.ajouterAns("2024-02-29", 5), "2029-02-28");
  assert.equal(C.ajouterAns("2024-02-29", 4), "2028-02-29");
  assert.equal(C.ajouterAns("2021-06-15", 5), "2026-06-15");
  assert.equal(C.ajouterMois("2026-01-31", 1), "2026-02-28");
  assert.equal(C.ajouterMois("2026-11-30", 3), "2027-02-28");
  assert.equal(C.ajouterMois("2026-12-15", 1), "2027-01-15");
  assert.equal(C.ajouterMois("2022-04-15", 84), "2029-04-15");
});
test("lendemain : fin de mois, fin d'année, 29 février", () => {
  assert.equal(C.lendemain("2026-06-15"), "2026-06-16");
  assert.equal(C.lendemain("2026-12-31"), "2027-01-01");
  assert.equal(C.lendemain("2028-02-28"), "2028-02-29");
  assert.equal(C.lendemain("2029-02-28"), "2029-03-01");
});
test("joursEntre : signé, sans dérive d'heure d'été", () => {
  assert.equal(C.joursEntre("2026-03-28", "2026-03-30"), 2); // passage à l'heure d'été (29 mars 2026)
  assert.equal(C.joursEntre("2026-10-24", "2026-10-26"), 2); // retour à l'heure d'hiver
  assert.equal(C.joursEntre("2026-10-14", "2026-10-13"), -1);
  assert.equal(C.joursEntre("2026-10-14", "2026-10-14"), 0);
  assert.equal(C.joursEntre("2026-01-01", "2027-01-01"), 365);
});
test("estDate : dates réelles seulement", () => {
  assert.equal(C.estDate("2026-02-28"), true);
  assert.equal(C.estDate("2026-02-30"), false);
  assert.equal(C.estDate("2028-02-29"), true);
  assert.equal(C.estDate("2026-13-01"), false);
  assert.equal(C.estDate("26-01-01"), false);
  assert.equal(C.estDate(null), false);
});
test("texteDelai : jours, mois, années, aujourd'hui, passé", () => {
  assert.equal(C.texteDelai(0), "aujourd'hui");
  assert.equal(C.texteDelai(1), "dans 1 jour");
  assert.equal(C.texteDelai(12), "dans 12 jours");
  assert.equal(C.texteDelai(92), "dans 3 mois");
  assert.equal(C.texteDelai(488), "dans 1 an et 4 mois");
  assert.equal(C.texteDelai(365), "dans 1 an");
  assert.equal(C.texteDelai(1100), "dans 3 ans");
  assert.equal(C.texteDelai(-92), "il y a 3 mois");
  assert.equal(C.texteDelai(-5), "il y a 5 jours");
});

/* ---------------------------------------------------------------- statuts aux bornes */
const peaOuvert = (ouverture, today, reperes) => C.calendrier({
  positions: [{ id: "a", name: "Ligne", envelope: "PEA Exemple", owner: "p1", status: "actif" }],
  config: { enveloppes_infos: { "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture: ouverture, source: "relevé (exemple)", le: "2026-01-01" } } },
  profil: { personnes: { p1: { nom: "Alex" } } }, reperes: reperes || FIXTURE.reperes }, today);
test("statut aux bornes : 0 jour proche, 92 proche, 93 futur, -1 passé", () => {
  // jalon pea_5_ans = ouverture + 5 ans + 1 jour ; ouverture 2021-06-15 → 2026-06-16
  const j = t => peaOuvert("2021-06-15", t).jalons[0];
  assert.deepEqual([j("2026-06-16").statut, j("2026-06-16").jours], ["proche", 0]);
  assert.deepEqual([j("2026-03-16").statut, j("2026-03-16").jours], ["proche", 92]);
  assert.deepEqual([j("2026-03-15").statut, j("2026-03-15").jours], ["futur", 93]);
  assert.deepEqual([j("2026-06-17").statut, j("2026-06-17").jours], ["passe", -1]);
  assert.equal(C.PROCHE_JOURS, 92);
});
test("jalon passé : effet au passé, délai en mots, calcul lisible", () => {
  const j = peaOuvert("2021-06-15", "2026-10-14").jalons[0];
  assert.equal(j.statut, "passe");
  assert.match(j.effet, /^Les 5 ans sont révolus/);
  assert.equal(j.delai, "il y a 4 mois");
  assert.equal(j.calcul, "premier versement le 15/06/2021 + 5 ans → 15/06/2026, révolus le 16/06/2026");
  assert.equal(j.titre, "PEA Exemple : 5 ans révolus");
  assert.equal(j.id, "pea_5_ans:PEA Exemple:2026-06-16");
  assert.deepEqual(j.donnee, { champ: "date_ouverture", source: "relevé (exemple)", le: "2026-01-01" });
  assert.equal(j.source.url, "https://www.service-public.gouv.fr/particuliers/vosdroits/F22449");
  assert.deepEqual(j.source.reperes, ["pea_duree_ans"]);
});
test("jalon futur : effet au présent", () => {
  const j = peaOuvert("2024-02-29", "2026-10-14").jalons[0];
  assert.match(j.effet, /^Un retrait partiel ne clôture plus le plan/);
  assert.equal(j.calcul, "premier versement le 29/02/2024 + 5 ans → 28/02/2029, révolus le 01/03/2029");
});

/* ---------------------------------------------------------------- exceptions de date (spec § 3.2) */
test("anniversaires d'âge au jour même, dates limites au dernier jour, livrets au lendemain de la fin", () => {
  const dates = nom => Object.fromEntries(sortie(cas(nom)).jalons.map(j => [j.cle, j.date]));
  assert.equal(dates("Assurance-vie ouverte le 2018-03-01").av_70_ans, "2030-05-20"); // jour de l'anniversaire
  assert.equal(dates("PER, titulaire né").per_70_ans, "2027-11-02");
  assert.equal(dates("PEL ouvert le 2014-09-01").pel_12_ans, "2026-09-01"); // jour du 12ᵉ anniversaire
  assert.equal(dates("PEL ouvert le 2014-09-01").pel_10_ans, "2024-09-02"); // les durées : lendemain
  assert.equal(dates("Moins-value de 2017 : dernier").mv_expire, "2027-12-31"); // dernier jour
  assert.equal(dates("Crédit avec date de signature").pret_fin, "2029-04-15"); // dernière échéance, sans lendemain
  assert.equal(dates("Livret A détenu, repère livret_a_taux avec").taux_reglementes, "2027-02-01"); // lendemain de la fin de période
});

/* ---------------------------------------------------------------- horizon et récurrence */
test("horizon : rien au-delà de horizonAns, réglable", () => {
  const c = cas("Horizon de 40 ans");
  assert.equal(sortie(c).jalons.some(j => j.cle === "av_70_ans"), false);
  const long = C.calendrier(entreeDe(c), c.today, { horizonAns: 50 });
  assert.equal(long.jalons.find(j => j.cle === "av_70_ans").date, "2070-01-01");
  const court = C.calendrier(entreeDe(c), c.today, { horizonAns: 2 });
  assert.equal(court.jalons.length, 0);
});
test("jalons récurrents (31 décembre, livrets) : seulement la prochaine occurrence", () => {
  const s = sortie(cas("Assurance-vie ouverte le 2018-03-01"));
  assert.equal(s.jalons.filter(j => j.cle === "av_abattement_annee").length, 1);
  assert.equal(s.jalons.find(j => j.cle === "av_abattement_annee").date, "2026-12-31");
  const l = sortie(cas("Livret A et LEP détenus"));
  assert.equal(l.jalons.filter(j => j.cle === "taux_reglementes").length, 1);
});
test("livrets : deux fins de période différentes donnent deux jalons, avec leur taux", () => {
  const c = cas("Livret A et LEP détenus");
  const e = entreeDe(c);
  e.reperes = e.reperes.map(r => (r.cle === "lep_taux" ? { ...r, dateFin: "2027-06-30" } : r));
  const s = C.calendrier(e, c.today);
  assert.deepEqual(s.jalons.map(j => j.date), ["2027-02-01", "2027-07-01"]);
  assert.match(esp(s.jalons[0].effet), /Livret A : 1,7 %/);
  assert.doesNotMatch(s.jalons[0].effet, /LEP/);
  assert.match(esp(s.jalons[1].effet), /LEP : 2,5 %/);
});
test("livrets : le type se lit aussi dans le nom des lignes quand l'enveloppe a un nom générique", () => {
  const s = C.calendrier({ positions: [
    { id: "a", name: "Livret A", envelope: "Livrets Camille", owner: "p1", status: "actif" },
    { id: "b", name: "LDDS", envelope: "Livrets Camille", owner: "p1", status: "actif" }], reperes: FIXTURE.reperes }, "2026-10-14");
  assert.equal(s.jalons.length, 1);
  assert.match(esp(s.jalons[0].effet), /Livret A et LDDS : 1,7 %/);
});

/* ---------------------------------------------------------------- pureté */
test("pureté : l'entrée n'est pas modifiée, deux appels donnent la même sortie", () => {
  for (const c of FIXTURE.cas) {
    const e = entreeDe(c), copie = JSON.parse(JSON.stringify(e));
    const a = C.calendrier(e, c.today), b = C.calendrier(e, c.today);
    assert.deepEqual(e, copie, c.nom);
    assert.deepEqual(a, b, c.nom);
  }
});
test("entrées vides ou invalides : sortie vide sans lever", () => {
  for (const d of [undefined, null, {}, { positions: null, config: null, reperes: null }]) {
    const s = C.calendrier(d, "2026-10-14");
    assert.deepEqual([s.jalons, s.a_completer, s.seuils, s.regles_indisponibles, s.prochains, s.dans_3_mois], [[], [], [], [], [], []]);
  }
  assert.deepEqual(C.calendrier({}, "pas une date").jalons, []);
});

/* ---------------------------------------------------------------- tri, prochains, dans_3_mois */
test("tri par date puis clé puis enveloppe ; prochains = 3 premiers non passés ; dans_3_mois = proches", () => {
  const c = cas("Assurance-vie ouverte le 2018-03-01");
  const s = sortie(c);
  assert.deepEqual(s.jalons.map(j => j.cle), ["av_8_ans", "av_abattement_annee", "av_70_ans"]);
  assert.deepEqual(s.prochains.map(j => j.cle), ["av_abattement_annee", "av_70_ans"]);
  assert.deepEqual(s.dans_3_mois.map(j => j.cle), ["av_abattement_annee"]);
  const pel = sortie(cas("PEL ouvert le 2014-09-01"));
  assert.equal(pel.prochains.length, 1);
  const trois = sortie(cas("Avis d'impôt"));
  assert.equal(trois.prochains.length, 3);
});
test("même date : tri par clé puis par enveloppe", () => {
  const e = { positions: [
    { id: "a", name: "L", envelope: "PEA B", owner: "p1", status: "actif" }, { id: "b", name: "L", envelope: "PEA A", owner: "p1", status: "actif" }],
    config: { enveloppes_infos: {
      "PEA B": { type: "pea", titulaire: "p1", date_ouverture: "2024-01-10", source: "s", le: "2026-01-01" },
      "PEA A": { type: "pea", titulaire: "p1", date_ouverture: "2024-01-10", source: "s", le: "2026-01-01" } } }, reperes: FIXTURE.reperes };
  assert.deepEqual(C.calendrier(e, "2026-10-14").jalons.map(j => j.enveloppe), ["PEA A", "PEA B"]);
});

/* ---------------------------------------------------------------- repères */
test("un repère absent rend la règle indisponible, jamais une valeur par défaut", () => {
  const c = cas("Repère pea_duree_ans absent");
  const s = sortie(c);
  assert.deepEqual(s.regles_indisponibles, [{ cle: "pea_5_ans", reperes_manquants: ["pea_duree_ans"] }]);
  assert.equal(s.jalons.length, 0);
  assert.equal(s.a_completer.length, 0, "on ne demande pas une donnée dont la règle est indisponible");
  const sans = C.calendrier(entreeDe(c), c.today).seuils;
  assert.deepEqual(sans, []);
});
test("sans aucun repère : aucune date, une règle indisponible par règle concernée", () => {
  const c = cas("Assurance-vie ouverte le 2018-03-01");
  const e = entreeDe(c);
  e.reperes = [];
  const s = C.calendrier(e, c.today);
  assert.deepEqual(s.jalons, []);
  assert.deepEqual(s.regles_indisponibles.map(r => r.cle), ["av_70_ans", "av_8_ans"]);
});
test("repère à revérifier (plus de 180 jours) : utilisé, mais le jalon le signale", () => {
  const e = entreeDe(cas("PEA ouvert le 2021-06-15"));
  e.reperes = e.reperes.map(r => (r.cle === "pea_duree_ans" ? { ...r, verifieLe: "2026-01-01" } : r));
  const j = C.calendrier(e, "2026-10-14").jalons[0];
  assert.equal(j.avertissements.length, 1);
  assert.match(j.avertissements[0], /vérifié le 01\/01\/2026, à revérifier/);
  assert.deepEqual(sortie(cas("PEA ouvert le 2021-06-15")).jalons[0].avertissements, []);
});
test("repère dont la période est terminée : signalé", () => {
  const e = entreeDe(cas("Livret A détenu, repère livret_a_taux avec"));
  const j = C.calendrier(e, "2027-03-01").jalons[0];
  assert.equal(j.statut, "passe");
  assert.ok(j.avertissements.some(a => /dispositif terminé le 31\/01\/2027/.test(a)));
});
test("plafonds épargne retraite : la durée de report suit l'année du plafond (3 ans jusqu'à 2025, 5 ans ensuite)", () => {
  const s = sortie(cas("Avis d'impôt"));
  assert.deepEqual(s.jalons.filter(j => j.cle === "per_plafond_expire").map(j => j.date), ["2026-12-31", "2027-12-31", "2028-12-31", "2031-12-31"]);
  assert.match(esp(s.jalons[0].effet), /1 234 €/);
  assert.match(s.jalons[0].titre, /2023/);
});
test("plafond épargne retraite déjà éteint : aucun jalon", () => {
  const c = cas("Avis d'impôt");
  const e = entreeDe(c);
  e.config.avis_impot.plafonds_per.p1 = [{ annee: 2021, montant: 500 }];
  assert.deepEqual(C.calendrier(e, c.today).jalons.filter(j => j.cle === "per_plafond_expire"), []);
});

/* ---------------------------------------------------------------- enveloppes et clés */
test("typeDeduit : mêmes motifs que pratiques.js et powens/synchro.ts", () => {
  const t = C.typeDeduit;
  assert.equal(t("PEA Exemple"), "pea");
  assert.equal(t("PEA-PME Alex"), "pea_pme");
  assert.equal(t("Assurance vie Sam"), "assurance_vie");
  assert.equal(t("AV"), "assurance_vie");
  assert.equal(t("Contrat de capitalisation"), "capitalisation");
  assert.equal(t("PER individuel"), "per");
  assert.equal(t("PEL"), "pel");
  assert.equal(t("PEE Exemple"), "pee");
  assert.equal(t("CTO Sam"), "compte_titres");
  assert.equal(t("Compte-titres"), "compte_titres");
  assert.equal(t("Livret A"), "livret_a");
  assert.equal(t("LDDS"), "ldds");
  assert.equal(t("LEP"), "lep");
  assert.equal(t("Coffre Exemple"), null);
  assert.equal(t("Livrets Camille"), null);
  assert.equal(t(""), null);
  assert.equal(t(undefined), null);
});
test("cleEnveloppe : le nom, ou nom|p1 / nom|p2 quand les deux titulaires ont ce nom", () => {
  const pos = [{ envelope: "PEA", owner: "p1" }, { envelope: "PEA", owner: "p2" }, { envelope: "CTO", owner: "p1" }];
  assert.equal(C.cleEnveloppe("PEA", "p2", pos), "PEA|p2");
  assert.equal(C.cleEnveloppe("PEA", "p1", pos), "PEA|p1");
  assert.equal(C.cleEnveloppe("CTO", "p1", pos), "CTO");
  assert.equal(C.cleEnveloppe("pea", "p1", [{ envelope: "PEA", owner: "p1" }], { PEA: { titulaire: "p1" } }), "PEA", "une clé de enveloppes_infos l'emporte (casse et accents ignorés)");
});
test("une enveloppe de enveloppes_infos sans ligne est une enveloppe du calendrier ; un type inconnu n'en produit aucun", () => {
  const s = C.calendrier({ config: { enveloppes_infos: { "PEL Exemple": { type: "pel", titulaire: "p1", date_ouverture: "2016-05-10", source: "s", le: "2026-01-01" } } }, reperes: FIXTURE.reperes }, "2026-10-14");
  assert.ok(s.jalons.length >= 4);
  const x = C.calendrier({ positions: [{ id: "a", name: "Truc", envelope: "Coffre", owner: "p1", status: "actif" }], reperes: FIXTURE.reperes }, "2026-10-14");
  assert.deepEqual([x.jalons, x.a_completer, x.seuils], [[], [], []]);
});
test("PEL approché : les bornes de génération ne se devinent pas quand l'année les chevauche", () => {
  const e = { config: { enveloppes_infos: { PEL: { type: "pel", titulaire: "p1", date_ouverture_approx: "2011", source: "s", le: "2026-01-01" } } }, reperes: FIXTURE.reperes };
  const cles = C.calendrier(e, "2026-10-14").jalons.map(j => j.cle);
  assert.ok(cles.includes("pel_2_ans") && cles.includes("pel_4_ans"));
  assert.ok(!cles.includes("pel_10_ans") && !cles.includes("pel_15_ans"), "avant ou après le 01/03/2011 : indécidable");
});
test("naissance invalide ou au format année seule : traitée comme absente (à compléter)", () => {
  const e = entreeDe(cas("Assurance-vie ouverte le 2018-03-01"));
  e.profil.personnes.p1.naissance = "1960";
  assert.deepEqual(C.calendrier(e, "2026-10-14").a_completer.map(a => a.champ), ["naissance"]);
  e.profil.personnes.p1.naissance = "1960-02-30";
  assert.deepEqual(C.calendrier(e, "2026-10-14").a_completer.map(a => a.champ), ["naissance"]);
});
test("a_completer : titre, pourquoi et document (où trouver la donnée)", () => {
  const a = sortie(cas("PEA sans date d'ouverture")).a_completer[0];
  assert.equal(a.titre, "Date d'ouverture de « PEA Exemple »");
  assert.match(a.pourquoi, /5 ans du PEA/);
  assert.match(a.document, /relevé annuel du PEA/);
  assert.equal(a.type, "pea");
  const n = sortie(cas("Assurance-vie, naissance absente")).a_completer[0];
  assert.equal(n.titre, "Date de naissance de Alex");
  const p = sortie(cas("Crédit sans information de prêt")).a_completer[0];
  assert.match(p.titre, /Date de fin du prêt « Crédit Exemple »/);
  assert.match(p.document, /offre de prêt/);
  const f = sortie(cas("PER, titulaire né")).a_completer[0];
  assert.deepEqual([f.enveloppe, f.champ], ["foyer", "avis_impot"]);
  assert.match(f.document, /avis d'impôt/);
});
test("PEE : un versement au plus tôt est signalé, un versement du relevé ne l'est pas", () => {
  const j = sortie(cas("PEE, trois versements")).jalons;
  assert.match(esp(j[0].effet), /^1 000 € sont|^1 000 € deviennent/);
  assert.doesNotMatch(j[0].effet, /règlement du plan/);
  assert.match(esp(j[1].effet), /^800 € deviennent disponibles sans motif, au plus tôt à cette date/);
  assert.match(j[1].calcul, /20\/04\/2023 \+ 5 ans → au plus tôt le 21\/04\/2028/);
});
test("PEL : l'effet de la 10e année dépend de la génération du plan", () => {
  const apres = sortie(cas("PEL ouvert le 2014-09-01")).jalons.find(j => j.cle === "pel_10_ans");
  assert.match(apres.effet, /pendant 5 ans au plus/);
  const avant = sortie(cas("PEL ouvert le 2009-05-10")).jalons.find(j => j.cle === "pel_10_ans");
  assert.match(avant.effet, /sans limite de durée/);
});
test("donations : le texte suit le lien et la nature", () => {
  const j = sortie(cas("Donations")).jalons;
  assert.match(esp(j[0].effet), /La donation du 01\/07\/2015 à Enfant 1 n'est plus rappelée : l'abattement de 100 000 €/);
  assert.match(esp(j[1].effet), /Le don familial de sommes d'argent \(31 865 €\)/);
});
test("donations : une autre donation des mêmes donateur et bénéficiaire encore rappelée à la date du jalon change le texte (l'abattement se reconstitue de son montant)", () => {
  const j = sortie(cas("Donations 2012 et 2020")).jalons;
  assert.equal(esp(j[0].effet), "La donation du 10/04/2012 n'est plus rappelée : l'abattement se reconstitue de son montant (50 000 €).");
  assert.doesNotMatch(j[0].effet, /de nouveau entier/);
  assert.match(esp(j[1].effet), /de nouveau entier/, "la dernière donation : plus rien à rappeler, l'abattement est entier");
  // autre bénéficiaire ou autre donateur : pas de chevauchement
  const e = entreeDe(cas("Donations 2012 et 2020"));
  e.config.donations[1].beneficiaire = "Enfant 2";
  assert.match(esp(C.calendrier(e, "2026-10-14").jalons[0].effet), /de nouveau entier/);
  e.config.donations[1].beneficiaire = "enfant 1"; e.config.donations[1].donateur = "p2";
  assert.match(esp(C.calendrier(e, "2026-10-14").jalons[0].effet), /de nouveau entier/);
  // le chevauchement s'arrête au rappel : une donation faite plus de 15 ans après ne compte pas
  e.config.donations[1].donateur = "p1"; e.config.donations[1].date = "2028-01-01";
  assert.match(esp(C.calendrier(e, "2026-10-14").jalons[0].effet), /de nouveau entier/);
  // un don familial d'argent (abattement propre) ne chevauche pas l'abattement des donations
  e.config.donations[1].date = "2020-09-15"; e.config.donations[1].nature = "don_argent_790g";
  assert.match(esp(C.calendrier(e, "2026-10-14").jalons[0].effet), /de nouveau entier/);
  // montant d'une grosse donation : plafonné à l'abattement
  e.config.donations[1].nature = "donation"; e.config.donations[0].montant = 250000;
  assert.match(esp(C.calendrier(e, "2026-10-14").jalons[0].effet), /se reconstitue de son montant \(100 000 €\)/);
});
test("don familial d'argent : le texte nomme le donateur (le donateur à défaut de nom)", () => {
  const e = entreeDe(cas("Donations : 15 ans"));
  const don = o => o.jalons.find(x => x.enveloppe === "donation:don-2").effet;
  assert.match(esp(don(C.calendrier(e, "2026-10-14"))), /est de nouveau possible entre Charlie et Enfant 1,/);
  delete e.profil.personnes.p2;
  assert.match(esp(don(C.calendrier(e, "2026-10-14"))), /entre le donateur et Enfant 1,/);
  assert.doesNotMatch(don(C.calendrier(e, "2026-10-14")), /\btoi\b/);
});
test("textes du titulaire : son nom (ou « le titulaire »), jamais « tu / tes / ton » pour le PEA, le PER et l'assurance-vie", () => {
  const per = entreeDe(cas("PER, titulaire né"));
  const txt = (e, cle) => esp(C.calendrier(e, "2026-10-14").jalons.find(j => j.cle === cle).effet);
  assert.equal(txt(per, "per_70_ans"), "À partir de cette date, Alex ne peut plus déduire de son revenu imposable ses versements sur un PER.");
  delete per.profil.personnes.p1.nom;
  assert.match(txt(per, "per_70_ans"), /^À partir de cette date, le titulaire ne peut plus déduire/);
  const pea = entreeDe(cas("PEA ouvert le 2021-06-15"));
  assert.match(txt(pea, "pea_5_ans"), /plan et Alex peut continuer à verser/);
  const av = txt(entreeDe(cas("Assurance-vie ouverte le 2018-03-01")), "av_8_ans");
  assert.match(av, /tant que les versements nets \(tous contrats confondus\) restent sous 150 000 € ; au-dessus, ce taux ne s'applique qu'au prorata/);
  assert.doesNotMatch(av, /\btes\b|\btu\b/);
});
test("PEL : l'effet des 2 ans dit qu'un retrait clôture le PEL à tout moment", () => {
  const j = sortie(cas("PEL ouvert le 2014-09-01")).jalons.find(x => x.cle === "pel_2_ans");
  const futur = C.REGLES.find(r => r.cle === "pel_2_ans").effet;
  assert.equal(futur, "Un retrait, à tout moment, clôture le PEL. Avant cette date, ses intérêts sont alors recalculés au taux du CEL et tu perds le droit au prêt.");
  assert.match(j.effet, /clôturer le PEL ne fait plus recalculer/);
});
test("PEL connu à l'année à cheval sur une borne de génération : date d'ouverture exacte « à compléter » (la génération du plan en dépend)", () => {
  const a = sortie(cas("PEL connu à l'année (2011)")).a_completer;
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].enveloppe, a[0].champ], ["PEL Exemple", "date_ouverture"]);
  assert.match(a[0].pourquoi, /la génération du plan en dépend/);
  assert.match(a[0].pourquoi, /à l'année près/);
  const e = entreeDe(cas("PEL connu à l'année (2011)"));
  const pel = o => C.calendrier(e, "2026-10-14").a_completer.map(x => x.champ);
  e.config.enveloppes_infos["PEL Exemple"].date_ouverture_approx = "2011-02";
  assert.deepEqual(pel(), [], "février 2011 : avant la borne, rien à compléter");
  e.config.enveloppes_infos["PEL Exemple"].date_ouverture_approx = "2011-03";
  assert.deepEqual(pel(), [], "un mois ne chevauche jamais une borne au 1er du mois");
  e.config.enveloppes_infos["PEL Exemple"].date_ouverture_approx = "1992";
  assert.deepEqual(pel(), ["date_ouverture"], "1992 chevauche le 01/04/1992");
  e.config.enveloppes_infos["PEL Exemple"].date_ouverture_approx = "2015";
  assert.deepEqual(pel(), [], "2015 : aucune borne");
  e.config.enveloppes_infos["PEL Exemple"].date_ouverture_approx = "2011";
  e.config.enveloppes_infos["PEL Exemple"].date_cloture = "2020-01-01";
  assert.deepEqual(pel(), [], "enveloppe close : rien à compléter");
});
test("naissance à compléter : une seule demande par titulaire, même avec une assurance-vie et un PER", () => {
  const s = sortie(cas("Assurance-vie et PER du même titulaire"));
  assert.deepEqual(s.a_completer.filter(a => a.champ === "naissance").map(a => a.id), ["naissance:p1"]);
  const e = entreeDe(cas("Assurance-vie et PER du même titulaire"));
  e.config.enveloppes_infos["PER Exemple"].titulaire = "p2";
  e.profil.personnes.p2 = { nom: "Charlie" };
  assert.deepEqual(C.calendrier(e, "2026-10-14").a_completer.filter(a => a.champ === "naissance").map(a => a.id).sort(), ["naissance:p1", "naissance:p2"]);
});
test("clé sans suffixe prise par l'autre titulaire : cleEnveloppe donne nom|titulaire, p2 n'écrase jamais p1", () => {
  const infos = { PEA: { type: "pea", titulaire: "p1" } };
  const pos = [{ envelope: "PEA", owner: "p2" }];
  assert.equal(C.cleEnveloppe("PEA", "p2", pos, infos), "PEA|p2");
  assert.equal(C.cleEnveloppe("pea", "p1", pos, infos), "PEA", "p1 retrouve sa clé");
  assert.equal(C.cleEnveloppe("PEA", "p2", pos, { PEA: { type: "pea" } }), "PEA", "clé sans titulaire : partagée, inchangée");
  assert.equal(C.cleEnveloppe("PEA", "p2", pos, { PEA: { type: "pea", titulaire: "p2" } }), "PEA");
  assert.equal(C.cleEnveloppe("PEA", null, pos, infos), "PEA", "titulaire inconnu : inchangé");
});
test("moins-values : même échéance regroupée, sommes en euros", () => {
  const c = cas("Moins-value de 2017 : dernier");
  const e = entreeDe(c);
  e.config.enveloppes_infos["CTO Exemple"].moins_values = [{ annee: 2017, montant: 1000 }, { annee: 2017, montant: 234 }];
  const j = C.calendrier(e, c.today).jalons;
  assert.equal(j.length, 1);
  assert.match(esp(j[0].effet), /moins-value de 2017 \(1 234 €\)/);
});
test("moins-value d'un compte clos : l'échéance reste (elle porte sur le contribuable, pas sur le compte)", () => {
  const c = cas("Moins-value de 2017 : dernier");
  const e = entreeDe(c);
  e.config.enveloppes_infos["CTO Exemple"].date_cloture = "2025-01-10";
  assert.deepEqual(C.calendrier(e, c.today).jalons.map(j => j.cle), ["mv_expire"]);
});
test("prêt sans mensualité : effet sans montant", () => {
  const c = cas("Bien avec date de fin du prêt");
  const e = entreeDe(c);
  e.biens[0].mensualite = 0;
  assert.equal(C.calendrier(e, c.today).jalons[0].effet, "Dernière échéance du prêt.");
  assert.match(esp(sortie(c).jalons[0].effet), /mensualité \(900 €\)/);
});
test("crédit sans identifiant ou sans capital restant dû : rien à compléter", () => {
  const c = cas("Crédit sans information de prêt");
  const e = entreeDe(c);
  e.credits[0].crd = 0;
  assert.deepEqual(C.calendrier(e, c.today).a_completer, []);
  delete e.credits[0].id;
  e.credits[0].crd = 100;
  assert.deepEqual(C.calendrier(e, c.today).a_completer, []);
});
test("crédits et biens : lus aussi dans data.profil quand data.credits / data.biens manquent", () => {
  const c = cas("Crédit sans information de prêt");
  const e = entreeDe(c);
  e.profil.credits = e.credits;
  delete e.credits;
  assert.equal(C.calendrier(e, c.today).a_completer.length, 1);
});

/* ---------------------------------------------------------------- catalogue REGLES */
test("REGLES : cle, types, reperes, fiche, titre, effet ; repères non vides sauf pret_fin", () => {
  assert.ok(C.REGLES.length >= 17);
  const cles = new Set();
  for (const r of C.REGLES) {
    assert.ok(!cles.has(r.cle), "clé en double " + r.cle);
    cles.add(r.cle);
    assert.ok(Array.isArray(r.types), r.cle);
    assert.ok(Array.isArray(r.reperes), r.cle);
    if (r.cle !== "pret_fin") assert.ok(r.reperes.length > 0, r.cle + " sans repère");
    assert.ok(r.fiche === null || /^[a-z0-9-]+$/.test(r.fiche), r.cle);
    assert.ok(r.titre && r.effet && r.effetPasse, r.cle);
  }
  for (const k of ["pea_5_ans", "av_8_ans", "av_70_ans", "pel_2_ans", "pel_4_ans", "pel_10_ans", "pel_12_ans", "pel_15_ans", "pee_disponible", "per_70_ans",
    "per_plafond_expire", "per_fin_annee", "av_abattement_annee", "donation_15_ans", "mv_expire", "taux_reglementes", "pret_fin"]) assert.ok(cles.has(k), k);
});
test("REGLES : tutoiement, aucun « conseiller », aucun produit ni établissement nommé", () => {
  const texte = JSON.stringify(C.REGLES) + JSON.stringify(C.DOCUMENTS) + readFileSync(new URL("../web/src/calendrier.js", import.meta.url), "utf8");
  const trouve = re => (texte.match(re) || [])[0];
  assert.equal(trouve(/(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu), undefined, "vouvoiement");
  assert.equal(trouve(/conseill?er|conseillère/i), undefined);
  assert.equal(trouve(/boursorama|linxea|spirica|fortuneo|trade republic|credit agricole|bnp|axa|generali|yomoni|bforbank|amundi|ishares|vanguard/i), undefined);
});
test("tous les textes produits : aucun gabarit {…} non résolu, tutoiement, jamais « conseiller »", () => {
  for (const c of FIXTURE.cas) {
    const s = sortie(c);
    const textes = [...s.jalons.flatMap(j => [j.titre, j.effet, j.calcul, ...j.avertissements]), ...s.a_completer.flatMap(a => [a.titre, a.pourquoi, a.document || ""]), ...s.seuils.map(x => x.titre)];
    for (const t of textes) {
      assert.doesNotMatch(t, /\{[a-z_0-9]+\}/, c.nom + " : " + t);
      assert.doesNotMatch(t, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu, t);
      assert.doesNotMatch(t, /conseill/i, t);
      assert.ok(t.length > 0, c.nom);
    }
  }
});
test("chaque jalon : source (titre, url https, vérifié le), confiance et statut valides, jours cohérents", () => {
  for (const c of FIXTURE.cas) for (const j of sortie(c).jalons) {
    assert.ok(["sure", "approchee", "calculee"].includes(j.confiance), j.id);
    assert.ok(["passe", "proche", "futur"].includes(j.statut), j.id);
    assert.equal(j.jours, C.joursEntre(c.today, j.date), j.id);
    assert.equal(j.statut, j.jours < 0 ? "passe" : j.jours <= 92 ? "proche" : "futur", j.id);
    if (j.cle !== "pret_fin") { assert.match(j.source.url, /^https:\/\//, j.id); assert.ok(j.source.titre && j.source.verifie_le, j.id); assert.ok(j.source.reperes.length, j.id); }
    assert.ok(j.id.startsWith(j.cle + ":" + j.enveloppe + ":" + j.date), j.id);
  }
});

/* ---------------------------------------------------------------- Calc */
test("Calc.calendrier === Calendrier.calendrier sous Node", () => {
  assert.equal(Calc.calendrier, C.calendrier);
});
test("depuisEtat : entrée du moteur construite depuis l'état du store (positions, config, profil, crédits, biens, repères)", () => {
  const S = { positions: [{ id: "a" }], config: { donations: [] }, profil: { credits: [{ id: "c" }], biens: [{ id: "b" }], personnes: {} }, savoir: { reperes: [{ cle: "x" }] } };
  assert.deepEqual(C.depuisEtat(S), { positions: [{ id: "a" }], config: { donations: [] }, profil: S.profil, credits: [{ id: "c" }], biens: [{ id: "b" }], reperes: [{ cle: "x" }] });
  assert.deepEqual(C.depuisEtat(null), { positions: [], config: {}, profil: {}, credits: [], biens: [], reperes: [] });
});
