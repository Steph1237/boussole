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

test("revue du cœur : mois courant dû, sinon le prochain mois de la liste ; semestrielle sur deux mois", () => {
  const d = donneesDe(cas("PO-2"));
  const r = Suivi.prochaineRevueCoeur(d, TODAY);
  assert.deepEqual([r.mois, r.annee, r.due], [3, 2027, false], "mars et septembre : septembre 2026 est passé sans revue enregistrée à cette date ? non : revue du cœur faite le 2026-03-05");
});

test("performance : 200 lignes, politique + système + déclencheurs en moins de 10 ms (meilleur de 15 passes)", () => {
  const positions = [], instruments = [];
  for (let i = 0; i < 200; i++) {
    const isin = "XX" + String(100000000 + i);
    positions.push({ id: "p" + i, name: "Ligne " + i, envelope: ["PEA Exemple", "Compte-titres Exemple", "Assurance vie Exemple"][i % 3], owner: "p1", bloc: ["Monde", "Europe", "Actions", "Obligations", "Small caps"][i % 5], status: "actif", mode: "market", qty: 10 + i, price: 100, pru: 80, isin });
    instruments.push({ isin, devise: i % 7 ? "EUR" : "USD", ter: 0.1 + (i % 9) * 0.2 });
  }
  const data = { positions, instruments, config: { enveloppes_infos: { "PEA Exemple": { type: "pea", date_ouverture: "2019-03-10", versements_cumules: 92000 }, "Compte-titres Exemple": { type: "compte_titres" },
    "Assurance vie Exemple": { type: "assurance_vie", date_ouverture: "2012-01-10" } }, frais_enveloppes: {}, suivi: { mois_revue_coeur: 10 } }, profil: { foyer: { adultes: 1 } }, objectifs: [], risque: { profil: "equilibre" }, routines: { passages: [] }, reperes: FIXTURE.reperes };
  let mieux = Infinity;
  for (let k = 0; k < 15; k++) {
    const t = process.hrtime.bigint();
    Suivi.politique(data, TODAY); Suivi.systeme(data, TODAY); Suivi.declencheurs(data, TODAY);
    mieux = Math.min(mieux, Number(process.hrtime.bigint() - t) / 1e6);
  }
  assert.ok(mieux < 10, "meilleur temps : " + mieux.toFixed(1) + " ms");
  const v0 = process.hrtime.bigint(); const vue = Suivi.vue(data, TODAY); const dv = Number(process.hrtime.bigint() - v0) / 1e6;
  assert.equal(vue.lignes.length, 200);
  assert.ok(dv < 120, "vue complète : " + dv.toFixed(1) + " ms");
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
