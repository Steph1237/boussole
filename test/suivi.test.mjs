// SUIVI (GOV1 + SCO2), moteur pur web/src/suivi.js : les cas de référence de test/fixtures/suivi-cas.json (tâche 0, la fixture fait foi),
// plus les règles de présentation, la performance, l'effet sur le risque et les cas que la fixture ne couvre pas.
// EX (croisement, phase 4) et SE (Ta semaine, phase 6) sont aussi évalués : le moteur pur les porte déjà, sans fournisseur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CAS, FIXTURE, FONCTIONS_PHASES_1_2, ecartsDuCas, donneesDe } from "./helpers/suivi-cas.mjs";

const require = createRequire(import.meta.url);
const Suivi = require("../web/src/suivi.js");

test("fixture : 90 cas, tous évalués (EX et SE sont du moteur de la suite, déjà livrés ici)", () => {
  assert.equal(CAS.length, 90);
  assert.equal(CAS.filter(c => FONCTIONS_PHASES_1_2.has(c.fonction)).length, 90);
  assert.equal(new Set(CAS.map(c => c.id)).size, 90);
});

for (const c of CAS.filter(c => FONCTIONS_PHASES_1_2.has(c.fonction))) {
  test(c.id + " · " + c.nom, () => {
    const ecarts = ecartsDuCas(Suivi, c);
    assert.deepEqual(ecarts, [], c.id + " : " + ecarts.join("\n"));
  });
}

/* ------------------------------------------------------------------ au-delà de la fixture */
const TODAY = "2026-10-15";
const cas = id => CAS.find(c => c.id === id);
const J = v => JSON.parse(JSON.stringify(v));
const noms = data => [...new Set(data.positions.map(p => p.name).filter(n => n && n.length > 4))];

test("décisions de Stéph : P3, un Nasdaq ×2 est du satellite ; un S&P 500 reste au cœur ; levier toujours satellite", () => {
  const roles = id => { const c = cas(id), d = donneesDe(c); return Suivi.roleParDefaut(d.ligne, d.instrument, d.objectifs, c.today); };
  assert.deepEqual(roles("RO-7"), { role: "satellite", raison: "levier" });
  assert.deepEqual(roles("RO-12"), { role: "coeur", raison: "par_defaut" });
  // un levier à l'étranger, hors liste : le levier prime sur « pays unique », « thématique » et « cœur »
  const d = donneesDe(cas("RO-12"));
  assert.equal(Suivi.roleParDefaut(d.ligne, Object.assign({}, d.instrument, { levier: 2 }), [], TODAY).raison, "levier");
});

test("le rôle validé l'emporte sur le rôle proposé ; la source du rôle est lue", () => {
  const c = cas("SY-1"), d = donneesDe(c);
  assert.equal(Suivi.roleEffectif(d, "soc", TODAY), "satellite");
  d.positions.find(p => p.id === "soc").role = "coeur"; d.positions.find(p => p.id === "soc").role_source = "valide";
  assert.equal(Suivi.roleEffectif(d, "soc", TODAY), "coeur");
  const v = Suivi.vue(d, TODAY);
  assert.equal(v.lignes.find(l => l.id === "soc").role_source, "valide");
  assert.equal(v.lignes.find(l => l.id === "soc").a_confirmer, false);
  assert.ok(v.lignes.find(l => l.id === "etf").a_confirmer, "un rôle proposé reste à confirmer");
  assert.ok(v.roles_a_confirmer.includes("etf"));
});

test("présentation (§ 9.1) : aucun titre de déclencheur ni de levier ne contient le nom d'une ligne", () => {
  let vus = 0;
  for (const c of CAS.filter(c => ["declencheurs", "vautLeCout"].includes(c.fonction))) {
    const d = donneesDe(c);
    const interdits = noms(d).map(n => n.toLowerCase());
    const titres = c.fonction === "declencheurs" ? Suivi.declencheurs(d, c.today).flatMap(x => [x.titre, x.cout && x.cout.titre]) : [Suivi.vautLeCout(c.entree, d, Object.assign({ today: c.today }, c.options || {})).titre];
    for (const t of titres.filter(Boolean)) { vus++; for (const n of interdits) assert.ok(!t.toLowerCase().includes(n), c.id + " : « " + t + " » contient « " + n + " »"); }
  }
  assert.ok(vus > 20, "assez de titres vérifiés : " + vus);
});

test("présentation : les phrases du verdict nomment la classe et l'enveloppe, jamais un instrument, et ne disent pas de garder ou de vendre", () => {
  const c = cas("VC-3"), d = donneesDe(c);
  const r = Suivi.vautLeCout(c.entree, d, { today: c.today });
  const t = Suivi.phraseVerdict(r, "2026-10-14");
  assert.match(t, /Classe Actions dans « Compte-titres Exemple »/);
  assert.match(t, /regardée le 14 oct\./);
  assert.match(t, /la changer coûterait 2 106 € pour 95 € par an/);
  assert.match(t, /ne rien changer à cette classe est l'option la moins coûteuse/);
  assert.doesNotMatch(t, /Fonds Actions Monde B|garde|conserve|vends|achète|renforce|allège/i);
  assert.match(Suivi.phraseVerdict({ verdict: null, manque: ["Le prix de revient"] }), /Il manque une donnée/);
});

test("les textes de la météo et des habitudes n'emploient pas le vocabulaire de récompense ni d'ordre sur un produit", () => {
  const INTERDIT = /\b(bonus|gagne|gagné|série|record|jackpot|trade|trading|confetti|badge|classement)\b|achète|vends\b|renforce|allège|conseiller|Copilote/i;
  const textes = [];
  for (const c of CAS) {
    const d = donneesDe(c);
    if (c.fonction === "habitudes") Suivi.habitudes(d, c.today).forEach(h => textes.push(h.texte));
    if (c.fonction === "declencheurs") Suivi.declencheurs(d, c.today).forEach(x => textes.push(x.titre, x.pourquoi, ...(x.cout ? x.cout.calcul.concat(x.cout.hypotheses) : [])));
    if (c.fonction === "meteo") Suivi.constats(d, c.entree.position_id, c.today).forEach(k => textes.push(k.pourquoi, ...k.calcul, k.repere && k.repere.texte, k.mesure && k.mesure.texte));
  }
  assert.ok(textes.filter(Boolean).length > 100);
  for (const t of textes.filter(Boolean)) assert.doesNotMatch(t, INTERDIT, "texte à revoir : " + t);
});

test("la météo n'a jamais de note chiffrée : ni points ni score dans les constats ni dans la météo", () => {
  const d = donneesDe(cas("CM-9")), cs = Suivi.constats(d, "lev", TODAY), m = Suivi.meteo(cs, "satellite");
  assert.ok(cs.length >= 5);
  for (const k of cs) { assert.equal("points" in k, false); assert.ok(["bon", "a_surveiller", "a_travailler", "a_completer"].includes(k.statut)); }
  assert.deepEqual(Object.keys(m).filter(k => /score|note|points/i.test(k)), []);
});

test("vue : politique, système, lignes (rôle, météo, mot), déclencheurs, habitudes ; le cœur gèle sa météo entre deux revues", () => {
  const d = donneesDe(cas("CM-14"));
  d.routines.derniere_revue = { le: "2026-03-05", declencheurs: [], constats: {}, meteo: { etf: "clair" } };
  d.routines.revue_coeur_faite_le = "2026-03-05"; d.config.suivi = { mois_revue_coeur: 3, source: "x", le: "2026-01-01" };
  const v = Suivi.vue(d, TODAY);
  const etf = v.lignes.find(l => l.id === "etf");
  assert.equal(etf.meteo, "clair", "météo figée à la revue de mars");
  assert.equal(etf.gelee_jusquau, "2027-03-01");
  assert.equal(etf.constats.find(k => k.cle === "cout").statut, "a_travailler", "les constats restent des faits calculés en direct");
  assert.equal(etf.meteo_libelle, "Au clair");
  assert.match(etf.revue.texte, /mars/);
  const marche = Suivi.vue(Object.assign(J(d), { routines: { passages: [], revue_coeur_faite_le: null, derniere_revue: null } }), TODAY);
  assert.equal(marche.lignes.find(l => l.id === "etf").meteo, "a_regarder", "sans mémoire de revue, pas de gel");
  for (const k of ["politique", "systeme", "lignes", "declencheurs", "habitudes", "prochaine_revue_coeur"]) assert.ok(k in v, k);
});

test("ligne : rôle, constats, prochaine revue et leviers de sa classe dans son enveloppe avec « ça vaut le coût ? »", () => {
  const d = donneesDe(cas("DE-1")), l = Suivi.ligne(d, "fam", TODAY);
  assert.equal(l.id, "fam");
  const frais = l.leviers.filter(x => x.cle === "frais_eleves");
  assert.equal(frais.length, 1);
  assert.equal(frais[0].verdict, "vaut_le_cout");
  assert.match(frais[0].titre, /Actions/);
  assert.match(frais[0].titre, /Assurance vie Exemple/);
  assert.equal(frais[0].cout.gain_annuel, 312);
  assert.equal(Suivi.ligne(d, "inconnue", TODAY), null);
});

test("ligne : les leviers qui ont le même but sont fusionnés (plafond satellite du portefeuille et poids de la ligne), avec les données les mieux connues", () => {
  const d = donneesDe(cas("CM-9"));
  d.positions = [
    { id: "liv", name: "Livret A", envelope: "Livret A Exemple", owner: "p1", bloc: "Livrets", status: "actif", mode: "manual", value: 10000 },
    { id: "etf", name: "ETF Monde A", envelope: "PEA Exemple", owner: "p1", bloc: "Monde", status: "actif", mode: "market", qty: 600, price: 100, pru: 80, isin: "XX0000000025" },
    { id: "lev", name: "ETF Nasdaq 2x A", envelope: "PEA Exemple", owner: "p1", bloc: "Nasdaq 2x", status: "actif", mode: "market", qty: 168, price: 100, pru: 90, isin: "XX0000000033" },
    { id: "btc", name: "Bitcoin", envelope: "Crypto Exemple", owner: "p1", bloc: "Crypto", status: "actif", mode: "market", qty: 0.5, price: 40000, isin: "X-BTC" },
  ];
  d.config.enveloppes_infos["Crypto Exemple"] = { type: "crypto", titulaire: "p1", source: "exemple", le: "2026-02-12" };
  // avant fusion : deux déclencheurs de même levier, l'un sans verdict (prix de revient de la crypto manquant), l'autre chiffré
  const brut = Suivi.declencheurs(d, TODAY, { capacite_mensuelle: 1700 }).filter(x => x.levier === "reduire_satellite");
  assert.deepEqual(brut.filter(x => x.cle === "satellite_plafond" || x.position_ids.includes("lev")).map(x => x.cle).sort(), ["concentration", "satellite_plafond"]);
  assert.equal(brut.find(x => x.cle === "satellite_plafond").verdict, null);
  const l = Suivi.ligne(d, "lev", TODAY, { capacite_mensuelle: 1700 });
  const sat = l.leviers.filter(x => x.levier === "reduire_satellite");
  assert.equal(sat.length, 1, "un seul levier « revenir sous le plafond satellite »");
  assert.equal(sat[0].cle, "concentration", "celui de la ligne, dont le coût est connu");
  assert.equal(sat[0].verdict, "a_peser");
  assert.equal(sat[0].cout.cout_unique, 179.4);
  assert.ok(sat[0].cout.montant > 0, "le montant concerné est exposé");
  assert.equal(sat[0].fusionnes.length, 1);
  assert.equal(sat[0].fusionnes[0].cle, "satellite_plafond");
  assert.equal(sat[0].fusionnes[0].seuil, 15);
  assert.match(sat[0].fusionnes[0].manque[0], /prix de revient des lignes vendues dans « Crypto Exemple »/, "ce qui manque pour chiffrer l'ensemble n'est pas perdu");
  // fusionnerLeviers : un levier seul reste intact ; sans levier, chaque déclencheur reste séparé ; le verdict connu passe avant la portée
  const a = { cle: "a", levier: "x", position_ids: ["1"], cout: { verdict: null, cout_unique: null } }, b = { cle: "b", levier: "x", position_ids: ["1", "2", "3"], cout: { verdict: "a_peser", cout_unique: 10 } };
  assert.deepEqual(Suivi.fusionnerLeviers([a, b]).map(x => x.cle), ["b"]);
  assert.deepEqual(Suivi.fusionnerLeviers([a, { cle: "c", levier: null }, { cle: "d", levier: null }]).map(x => x.cle), ["a", "c", "d"]);
  assert.equal(Suivi.fusionnerLeviers([a])[0].fusionnes, undefined);
});

test("constats : les repères chiffrés (poids, coût, volatilité, chevauchement) sont exposés pour la jauge", () => {
  const d = donneesDe(cas("CM-9")), cs = Suivi.constats(d, "lev", TODAY);
  assert.equal(cs.find(c => c.cle === "classe_risque").repere.surveiller, 20);
  assert.equal(cs.find(c => c.cle === "cout").repere.bas, 0.3);
  const soc = Suivi.constats(donneesDe(cas("CM-8")), "soc", TODAY).find(c => c.cle === "poids");
  assert.equal(soc.repere.max, 5);
  assert.equal(soc.repere.unite, "%");
});

test("revue du cœur : mars et septembre ; septembre 2026 est passé sans revue enregistrée après mars : la revue est en retard, jamais effacée par le calendrier", () => {
  const d = donneesDe(cas("PO-2"));
  d.routines.revue_coeur_faite_le = "2026-03-05"; // la revue de mars a été faite, pas celle de septembre
  const r = Suivi.prochaineRevueCoeur(d, TODAY);
  assert.deepEqual([r.mois, r.annee, r.due, r.en_retard], [9, 2026, true, true]);
  const l = Suivi.vue(d, TODAY).lignes.find(x => x.id === "etf");
  assert.match(l.revue.texte, /La revue de ton cœur de septembre n'a pas été faite : elle est à faire\./);
  const h = Suivi.habitudes(d, TODAY).find(x => x.cle === "revue_coeur");
  assert.deepEqual([h.palier, h.prochain_palier, h.en_retard], [null, "faite", true]);
  assert.match(h.texte, /n'a pas été faite/);
  d.routines.revue_coeur_faite_le = "2026-09-20"; // faite en septembre : plus de retard, prochaine en mars 2027
  const r2 = Suivi.prochaineRevueCoeur(d, TODAY);
  assert.deepEqual([r2.mois, r2.annee, r2.due, r2.en_retard], [3, 2027, false, false]);
  assert.equal(Suivi.habitudes(d, TODAY).find(x => x.cle === "revue_coeur").palier, "faite");
});

test("revue du cœur en retard : les déclencheurs du cœur redeviennent visibles ; la clôture ne compte la revue faite que si elle était due (côté moteur)", () => {
  const d = donneesDe(cas("DE-2")); // frais élevés d'une ligne du cœur, hors de son mois de revue, sans mémoire : « hors_revue »
  d.config.suivi.mois_revue_coeur = 3;
  d.routines.revue_coeur_faite_le = "2025-03-02"; // revue de mars 2026 manquée
  const decl = Suivi.declencheurs(d, TODAY).find(x => x.cle === "frais_eleves");
  assert.deepEqual([decl.visible, decl.raison_visibilite], [true, "revue_du_mois"]);
  const e = Suivi.etatSuivi(d, TODAY, { coeur_revu: true });
  assert.equal(e.revue_coeur_faite_le, TODAY, "due (en retard) : comptée faite");
  const d2 = donneesDe(cas("DE-2")); d2.config.suivi.mois_revue_coeur = 3; d2.routines.revue_coeur_faite_le = "2026-03-05"; // à jour : prochaine en mars 2027
  const e2 = Suivi.etatSuivi(d2, TODAY, { coeur_revu: true });
  assert.equal(e2.revue_coeur_faite_le, "2026-03-05", "pas due : la date n'avance pas, même si l'agent le demande");
});

test("mois de revue du cœur : retenu à la première clôture (etat_suivi.mois_revue_coeur), jamais recalculé depuis les passages ; config.suivi le remplace", () => {
  // première clôture le 2027-09-10 : aucune revue avant, aucun mois choisi
  const d0 = donneesDe(cas("PO-5")); d0.routines = { passages: [], revue_coeur_faite_le: null, derniere_revue: null };
  const e = Suivi.etatSuivi(d0, "2027-09-10", { coeur_revu: true });
  assert.equal(e.mois_revue_coeur, 9);
  assert.equal(e.revue_coeur_faite_le, "2027-09-10");
  // le 2027-10-12 : même avec un journal qui ne garde plus que des revues récentes (limite de 24, ou de 6 revues d'un mois tout autre), le mois reste septembre
  const d1 = donneesDe(cas("PO-5")); d1.routines = Suivi.routinesDe(e, ["2027-10-02", "2027-09-10", "2027-07-05"]);
  const p = Suivi.politique(d1, "2027-10-12");
  assert.deepEqual(p.mois_revue_coeur, [9]);
  const r = Suivi.prochaineRevueCoeur(d1, "2027-10-12");
  assert.deepEqual([r.mois, r.annee, r.due, r.en_retard], [9, 2028, false, false]);
  // la plus ancienne revue du journal ne gouverne plus rien dès qu'un mois est retenu
  const d2 = donneesDe(cas("PO-5")); d2.routines = Suivi.routinesDe(e, ["2026-02-02", "2027-09-10"]);
  assert.deepEqual(Suivi.politique(d2, "2027-10-12").mois_revue_coeur, [9]);
  // choix avec Claude : il l'emporte sur le mois retenu
  d2.config.suivi = { mois_revue_coeur: 4, source: "x", le: "2027-01-01" };
  assert.deepEqual(Suivi.politique(d2, "2027-10-12").mois_revue_coeur, [4]);
  // le mois retenu est reporté de clôture en clôture
  const e2 = Suivi.etatSuivi(Object.assign(donneesDe(cas("PO-5")), { routines: Suivi.routinesDe(e, ["2027-10-02"]) }), "2027-10-12", {});
  assert.equal(e2.mois_revue_coeur, 9);
});

test("config.suivi hors des bornes de 0032 : ignorée par le moteur (défaut), jamais appliquée", () => {
  const d = donneesDe(cas("PO-3"));
  d.config.suivi = { plafond_satellite_pct: 80, seuil_ecart_pts: 1, seuil_baisse_satellite_pct: 99, mois_revue_coeur: 13, revue_coeur: "annuelle", source: "x", le: "2026-01-01" };
  const p = Suivi.politique(d, TODAY);
  assert.equal(p.plafond_satellite_pct, 20); // plafond du profil Dynamique de PO-3 : la valeur hors bornes (80) est ignorée
  assert.equal(p.seuils.seuil_ecart_pts, 5); assert.equal(p.seuils.seuil_baisse_satellite_pct, 25);
  assert.notDeepEqual(p.mois_revue_coeur, [13]);
});

test("rôle : le store de l'app écrit roleSource, le connecteur role_source ; un rôle « proposé » reste à confirmer dans les deux formes", () => {
  const d = donneesDe(cas("SY-1"));
  const l = d.positions.find(p => p.id === "etf");
  l.role = "coeur"; l.roleSource = "propose";
  assert.equal(Suivi.vue(d, TODAY).lignes.find(x => x.id === "etf").a_confirmer, true);
  delete l.roleSource; l.role_source = "propose";
  assert.equal(Suivi.vue(d, TODAY).lignes.find(x => x.id === "etf").a_confirmer, true);
  l.role_source = "valide";
  assert.equal(Suivi.vue(d, TODAY).lignes.find(x => x.id === "etf").a_confirmer, false);
  l.role = "satellite"; l.roleSource = "valide"; delete l.role_source;
  assert.equal(Suivi.vue(d, TODAY).lignes.find(x => x.id === "etf").a_confirmer, false);
});

test("assurance-vie : la fiscalité d'un rachat se calcule par contrat (primes versées du contrat contre sa valeur), sinon l'hypothèse est écrite", () => {
  const c = cas("VC-12"), d = donneesDe(c);
  // contrat de deux lignes (20 000 + 30 000), primes versées 25 000 : on sort la première ligne (40 % de la valeur du contrat)
  d.positions.push({ id: "uc2", name: "Fonds Actions Europe D", envelope: "Assurance vie Ancienne", owner: "p1", bloc: "Europe", status: "actif", mode: "market", qty: 300, price: 100, pru: 40, isin: "XX0000000140" });
  d.instruments.push({ isin: "XX0000000140", devise: "EUR", ter: 0.9, ter_source: "dic", ter_le: "2026-09-30" });
  d.config.enveloppes_infos["Assurance vie Ancienne"].versements_cumules = 25000;
  const r = Suivi.vautLeCout(c.entree, d, { today: c.today });
  // base du contrat 25 000 × 20 000/50 000 = 10 000 ; gain 10 000 ; abattement 4 600 ; 5 400 × 7,5 % = 405 ; PS 17,2 % × 10 000 = 1 720 → 2 125
  assert.equal(r.cout_detail.impot, 2125);
  assert.match(r.hypotheses.join(" | "), /base fiscale du contrat « Assurance vie Ancienne » : primes versées 25 000 €, rachat de 40 % de la valeur du contrat/);
  // sans primes versées renseignées : base estimée par les lignes, avec l'hypothèse écrite
  delete d.config.enveloppes_infos["Assurance vie Ancienne"].versements_cumules;
  const r2 = Suivi.vautLeCout(c.entree, d, { today: c.today });
  assert.match(r2.hypotheses.join(" | "), /la base légale est celle du contrat \(primes versées\)/);
  assert.equal(r2.cout_detail.impot, 1137, "base ligne par ligne (cas VC-12) : 14 000 € de prix de revient");
});

test("frais de transaction : « frais d'arbitrage » dans un contrat, « courtage et écart » sur un compte d'ordres, « frais de transaction » sinon", () => {
  assert.equal(Suivi.vautLeCout(cas("VC-1").entree, donneesDe(cas("VC-1")), { today: TODAY }).transaction_libelle, "frais d'arbitrage");
  assert.equal(Suivi.vautLeCout(cas("VC-3").entree, donneesDe(cas("VC-3")), { today: TODAY }).transaction_libelle, "courtage et écart");
  assert.equal(Suivi.vautLeCout(cas("VC-11").entree, donneesDe(cas("VC-11")), { today: TODAY }).transaction_libelle, "courtage et écart");
});

test("société détenue par transparence au-delà de 10 % du financier investi : levier reduire_satellite avec son verdict (§ 4.3)", () => {
  const d = donneesDe(cas("CM-18"));
  d.expositions = d.expositions.map(e => (e.isin === "XX0000000074" && e.cle === "XX00000C0001" ? { ...e, poids_pct: 40 } : e)); // 300 × 100 × 40 % = 12 000 sur un investi de 90 000
  const x = Suivi.declencheurs(d, TODAY).filter(t => t.cle === "concentration");
  assert.equal(x.length, 1);
  assert.equal(x[0].levier, "reduire_satellite");
  assert.ok(x[0].verdict, "un verdict : " + JSON.stringify(x[0].cout && x[0].cout.manque));
  assert.doesNotMatch(x[0].titre, /Société C1|ETF S&P/);
});

test("« Ta semaine » : la carte « Tes lignes » ne porte que des faits ; un changement de météo n'est jamais nommé, seulement compté", () => {
  const d = donneesDe(cas("SE-3"));
  d.routines.derniere_revue = { le: "2026-03-05", declencheurs: [], constats: {}, meteo: { eu: "a_regarder", us: "clair", fam: "clair" } };
  const r = Suivi.maSemaine(d, [], TODAY), carte = r.cartes.find(x => x.type === "tes_lignes");
  assert.ok(carte);
  assert.doesNotMatch(JSON.stringify(carte), /"avant"|"apres"|"id":"(eu|us|fam)"|ETF|Fonds Actions/);
  assert.match(carte.texte, /la météo de \d+ lignes? a changé depuis ta dernière revue : le détail est sur leur fiche/);
});

test("raison du rôle : une action « en direct » déduite du nom seul le dit (un fonds sans frais renseignés peut être pris pour une action)", () => {
  const d = donneesDe(cas("RO-6")), l = Suivi.vue({ positions: [d.ligne], instruments: [], config: { enveloppes_infos: {}, frais_enveloppes: {}, suivi: {} }, profil: {}, objectifs: [], risque: { profil: "equilibre" }, routines: {}, reperes: donneesDe(cas("SY-1")).reperes }, TODAY).lignes[0];
  assert.equal(l.role, "satellite");
  assert.match(l.raison_role_texte, /action en direct \(déduite du nom et de l'ISIN : si c'est un fonds, dis-le à Claude\)/);
});

test("performance : 200 lignes, politique + système + déclencheurs, temps de calcul borné largement (cible de 10 ms : scripts/bench-suivi.mjs)", () => {
  const positions = [], instruments = [];
  for (let i = 0; i < 200; i++) {
    const isin = "XX" + String(100000000 + i);
    positions.push({ id: "p" + i, name: "Ligne " + i, envelope: ["PEA Exemple", "Compte-titres Exemple", "Assurance vie Exemple"][i % 3], owner: "p1", bloc: ["Monde", "Europe", "Actions", "Obligations", "Small caps"][i % 5], status: "actif", mode: "market", qty: 10 + i, price: 100, pru: 80, isin });
    instruments.push({ isin, devise: i % 7 ? "EUR" : "USD", ter: 0.1 + (i % 9) * 0.2 });
  }
  const data = { positions, instruments, config: { enveloppes_infos: { "PEA Exemple": { type: "pea", date_ouverture: "2019-03-10", versements_cumules: 92000 }, "Compte-titres Exemple": { type: "compte_titres" },
    "Assurance vie Exemple": { type: "assurance_vie", date_ouverture: "2012-01-10" } }, frais_enveloppes: {}, suivi: { mois_revue_coeur: 10 } }, profil: { foyer: { adultes: 1 } }, objectifs: [], risque: { profil: "equilibre" }, routines: { passages: [] }, reperes: FIXTURE.reperes };
  /* temps de calcul (CPU du processus) après préchauffage : meilleur de 25 passes, plafond large (25 ms) pour que l'intégration continue ne bascule jamais sur une
     machine chargée ; la cible de 10 ms se mesure avec scripts/bench-suivi.mjs */
  const passe = () => { Suivi.politique(data, TODAY); Suivi.systeme(data, TODAY); Suivi.declencheurs(data, TODAY); };
  for (let k = 0; k < 5; k++) passe();
  let mieux = Infinity;
  for (let k = 0; k < 25; k++) {
    const c0 = process.cpuUsage();
    passe();
    const c1 = process.cpuUsage(c0);
    mieux = Math.min(mieux, (c1.user + c1.system) / 1000);
  }
  assert.ok(mieux < 25, "meilleur temps de calcul : " + mieux.toFixed(1) + " ms");
  const c0v = process.cpuUsage(); const vue = Suivi.vue(data, TODAY); const c1v = process.cpuUsage(c0v); const dv = (c1v.user + c1v.system) / 1000;
  assert.equal(vue.lignes.length, 200);
  assert.ok(dv < 250, "vue complète : " + dv.toFixed(1) + " ms");
});

test("Ta semaine : 4 cartes une semaine calme, jamais plus de 7 ; un avis d'analyste n'y figure jamais", () => {
  const c = cas("SE-3"), d = donneesDe(c);
  const r = Suivi.maSemaine(d, c.entree.evenements.concat([{ id: "societe:changement_reco:XX:2026-10-14", famille: "societe", type: "changement_reco", date: "2026-10-14", statut: "passe", portee: { isin: ["XX0000000157"] } }]), TODAY);
  assert.ok(r.cartes.length >= 4 && r.cartes.length <= 7);
  assert.doesNotMatch(JSON.stringify(r), /analyste|consensus|objectif de cours|changement_reco/i);
});

test("exposition : un événement de société détenue par un fonds n'est montré qu'au-delà de 1 % de l'investi, avec sa raison chiffrée", () => {
  const c = cas("EX-3"), d = donneesDe(c);
  const x = Suivi.exposition(d, c.entree.evenement, TODAY);
  assert.equal(x.concerne, true);
  assert.match(x.texte, /1,1 %|1,05 %|1 %/);
});

/* ------------------------------------------------------------------ effet sur le risque (PROJ, graine fixe) */
test("effet sur le risque : mêmes tirages avant et après, en fréquences, jamais en euros", async t => {
  const P = require("../web/src/projection.js");
  const { entreeDe, cas: casProj } = await import("./helpers/projection-cas.mjs");
  const d = entreeDe(casProj("D-1"));
  d.positions = [{ id: "pea", name: "Fonds Actions Monde A", envelope: "PEA Exemple", owner: "p1", bloc: "Monde", mode: "manual", value: 100000, status: "actif" }];
  d.config.enveloppes_infos = { "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture: "2019-03-10", source: "exemple", le: "2026-10-01" } };
  d.objectifs = [{ id: "o-apport", nom: "Apport 2029", type: "apport", cible: 90000, dateCible: "2029-06-30", poches: ["Monde"], enveloppes: [], source: "poches" }];
  const opt = { chemins: 1000, graine: 20261014, projection: { horizon_ans: 3, capacite_mensuelle: 0, vue: "financier", euros: "courants" } };
  const r = Suivi.effetRisque(P, d, { levier: "securiser_objectif", position_ids: ["pea"], montant: 80000 }, opt);
  assert.equal(r.objectifs.length, 1);
  assert.ok(r.objectifs[0].apres > r.objectifs[0].avant, "sécuriser l'apport augmente la chance de l'atteindre");
  assert.match(r.objectifs[0].texte, /chances? sur 10 .* d'atteindre « Apport 2029 »/);
  assert.doesNotMatch(JSON.stringify(r), /€/, "aucun euro ajouté à ce calcul");
  const r2 = Suivi.effetRisque(P, d, { levier: "securiser_objectif", position_ids: ["pea"], montant: 80000 }, opt);
  assert.deepEqual(r2, r, "graine fixe : même résultat");
  assert.equal(Suivi.effetRisque(null, d, { levier: "reequilibrer", position_ids: ["pea"] }, opt), null);
  assert.equal(Suivi.effetRisque(P, d, { levier: "reequilibrer", position_ids: ["inconnu"] }, opt), null);
});
