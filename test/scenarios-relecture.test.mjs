// SCN1 tâche 8 : relecture des calculs financiers (Opus). Chaque test fixe un point corrigé à la relecture : ce qui est dit quand une donnée manque
// (frais comptés à 0, date d'ouverture inconnue, abattement de l'assurance-vie compté en entier, sortie du PER en une fois), enveloppes déjà détenues
// (un seul PEA par personne, ancienneté d'un contrat), matelas (LEP sans imposition commune, livrets dont le type n'est pas connu, transferts réels),
// sens des phrases, repères lus par un calcul, hypothèse de variante (TMI de l'économie du PER), comparaison après impôts du moteur, et la cohérence
// du socle « à la marge » avec le moteur complet sur la démo et sur plusieurs foyers de la fixture (spec § 6.3). Données fictives uniquement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cas, dataDe, entreeCatalogue, fraisDeCas, reperesDesCas } from "./helpers/scenarios-cas.mjs";
const req = createRequire(import.meta.url);
const S = req("../web/src/scenarios.js"), P_ = req("../web/src/projection.js"), E_ = req("../web/src/projection-evenements.js"), Dn = req("../web/src/projection-donnees.js");
const DEMO = req("../web/src/demo-data.js");
const J = x => JSON.parse(JSON.stringify(x));
const proche = (a, b, tol, msg) => assert.ok(a != null && Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b + " (tolérance " + tol + ")");
const opt = (r, id) => r.options.find(o => o.id === id);
const TODAY = "2026-10-15";

function jouerCas(id, { reponses, patch, opts } = {}) {
  const c = cas(id), { data, reglages } = dataDe(c);
  if (patch) patch(data);
  const o = { ...(c.options || {}), frais: fraisDeCas(c), ...(opts || {}) };
  if (reglages.plafond_per_annuel_suppose !== undefined && o.plafondPerAnnuel === undefined) o.plafondPerAnnuel = reglages.plafond_per_annuel_suppose;
  if ((c.scenario === "prochain_euro" || c.scenario === "per_interet") && !o.allocation) o.allocation = { actions: 100 };
  const entree = entreeCatalogue(c.scenario);
  return { r: S.jouer(entree, data, reponses || c.reponses || {}, c.today, o), data, entree, c };
}
/** Foyer de démonstration (forme de l'app) avec les repères des scénarios (0039, pas encore dans la démo). */
function demo() {
  const d = Dn.depuisEtat(J({ positions: DEMO.positions, config: DEMO.config, profil: DEMO.profil, budget: DEMO.budget, banque: DEMO.banque, objectifs: DEMO.objectifs, foyer: DEMO.foyer,
    savoir: DEMO.savoir, indices: DEMO.indices, classes: DEMO.classes }), TODAY);
  const m = new Map(d.reperes.map(r => [r.cle, r]));
  for (const r of reperesDesCas()) if (!m.has(r.cle)) m.set(r.cle, r);
  d.reperes = [...m.values()];
  return d;
}

/* ---------------------------------------------------------------- frais : ce qui est compté à 0 est dit, sans fausse symétrie */
test("frais : seuls les frais du scénario sont cités, en clair ; un côté connu et l'autre à 0 est dit comme un avantage", () => {
  const { r } = jouerCas("PEA-1");                                      // frais du PEA donnés (0 %), compte-titres inconnu
  const a = r.avertissements.find(x => /^Frais non renseignés/.test(x));
  assert.ok(a, "avertissement des frais");
  assert.match(a, /frais du compte-titres/); assert.doesNotMatch(a, /PER|_pct|fonds euros/);
  assert.match(a, /avantage ces enveloppes/);
  const tout = jouerCas("PEA-1", { opts: { frais: {} }, reponses: { ...cas("PEA-1").reponses, frais_pea_pct: undefined } }).r;
  assert.match(tout.avertissements.find(x => /^Frais non renseignés/.test(x)), /pour toutes les options, la comparaison est alors seulement fiscale/);
  const mat = jouerCas("MAT-1", { opts: { frais: {} } }).r;               // le surplus placé : frais des fonds et du compte-titres à 0, dits
  assert.ok(mat.avertissements.some(x => /^Frais non renseignés \(frais des fonds, frais du compte-titres\)/.test(x)), mat.avertissements.join(" | "));
});
test("cartes : l'enjeu d'une carte porte ses avertissements (frais à 0, PER non compté faute de date de retraite)", () => {
  const { data } = dataDe(cas("EUR-1"));
  const l = S.lister([entreeCatalogue("prochain_euro")], data, [], TODAY, { chemins: 100 });
  const c = l.cartes[0];
  assert.equal(c.enjeu_statut, "ok");
  assert.ok(c.avertissements.some(x => /^Frais non renseignés/.test(x)));
  assert.ok(c.avertissements.some(x => /PER n'est pas compté.*date de départ à la retraite/.test(x)), c.avertissements.join(" | "));
});

/* ---------------------------------------------------------------- repères lus par un calcul : absents → indisponible, jamais NaN */
test("repère du délai d'ouverture absent : le prochain euro, le PER et le matelas sont indisponibles (aucun NaN)", () => {
  for (const id of ["EUR-1", "PER-1", "MAT-1"]) {
    const { r } = jouerCas(id, { patch: d => { d.reperes = d.reperes.filter(x => x.cle !== "scn_delai_ouverture_mois"); } });
    assert.equal(r.statut, "indisponible", id);
    assert.ok(r.reperes_manquants.includes("scn_delai_ouverture_mois"), id);
    assert.doesNotMatch(JSON.stringify(r), /NaN/);
  }
  const ok = jouerCas("EUR-1").r;
  assert.ok(ok.hypotheses.some(h => h.cle === "scn_delai_ouverture_mois" && h.statut === "convention"), "le délai supposé est une hypothèse dite");
});

/* ---------------------------------------------------------------- enveloppes déjà détenues */
const avecPea = (d, infos) => {
  d.positions.push({ id: "pea1", name: "Fonds actions monde", envelope: "PEA Exemple", owner: "p1", bloc: "Actions", mode: "manual", value: 3000, valueDate: "2026-09-30", status: "actif" });
  d.config.enveloppes_infos["PEA Exemple"] = { type: "pea", titulaire: "p1", ...infos };
};
const avecAv = (d, infos) => {
  d.positions.push({ id: "av1", name: "Fonds actions monde", envelope: "Assurance vie Exemple", owner: "p2", bloc: "Actions", mode: "manual", value: 5000, valueDate: "2026-09-30", status: "actif" });
  d.config.enveloppes_infos["Assurance vie Exemple"] = { type: "assurance_vie", titulaire: "p2", ...infos };
};
test("prochain euro : un PEA déjà détenu sert tel quel (un seul PEA par personne) : sa date de 5 ans, son plafond restant, la variante à sa date", () => {
  const rep = { ...cas("EUR-1").reponses, horizon_ans: 3 };
  const neuf = jouerCas("EUR-1", { reponses: rep }).r;
  assert.equal(opt(neuf, "pea+av").exclue, "horizon_moins_5_ans", "un PEA neuf n'a pas 5 ans dans 3 ans");
  const { r } = jouerCas("EUR-1", { reponses: rep, patch: d => avecPea(d, { date_ouverture: "2020-03-02", versements_cumules: 20000 }) });
  const pea = opt(r, "pea+av");
  assert.equal(pea.exclue, null, "un PEA ouvert en 2020 a plus de 5 ans dans 3 ans");
  assert.equal(pea.libelle, "Ton PEA");
  assert.ok(pea.net.p50 > opt(r, "cto").net.p50, "après 5 ans, le PEA déjà ouvert fait mieux que le compte-titres");
  assert.equal(pea.retenable, true);
  assert.deepEqual([pea.enveloppe_scenario.ouverture, pea.enveloppe_scenario.titulaire, pea.enveloppe_scenario.plafond_versements], ["2020-03-02", "p1", 130000]);
  assert.equal(E_.validerVariante(S.varianteRetenue(entreeCatalogue("prochain_euro"), r, "pea+av")), null);
  assert.ok(r.ce_qui_changerait.some(l => /avant le 03\/03\/2025 \(les 5 ans de ton PEA\)/.test(l.phrase)));
  /* plafond déjà atteint : tout va au compte-titres (débordement), dit ; l'option reste retenable (le moteur rejoue le débordement) */
  const plein = jouerCas("EUR-1", { reponses: rep, patch: d => avecPea(d, { date_ouverture: "2020-03-02", versements_cumules: 150000 }) }).r;
  proche(opt(plein, "pea+av").net.p50, opt(plein, "cto").net.p50, 0.01, "PEA plein : même résultat que le compte-titres");
  assert.ok(plein.avertissements.some(x => /plafond de versements/.test(x)));
  assert.equal(opt(plein, "pea+av").retenable, true);
  /* date d'ouverture inconnue : écarté, avec la raison ; versements inconnus : plafond supposé entier, dit */
  const sansDate = jouerCas("EUR-1", { patch: d => avecPea(d, {}) }).r;
  assert.equal(opt(sansDate, "pea+av").exclue, "date_ouverture_pea_manquante");
  assert.ok(sansDate.avertissements.some(x => /versements déjà faits sur ton PEA ne sont pas connus/.test(x)));
});
test("prochain euro : une assurance-vie déjà détenue garde son ancienneté et ses primes ; date inconnue : règle d'avant 8 ans, dite, et option non retenable", () => {
  const rep = { ...cas("EUR-1").reponses, horizon_ans: 5 };
  const neuve = jouerCas("EUR-1", { reponses: rep }).r;
  const { r } = jouerCas("EUR-1", { reponses: rep, patch: d => avecAv(d, { date_ouverture: "2012-05-10", versements_cumules: 4000 }) });
  assert.equal(opt(r, "av").libelle, "Ton assurance-vie");
  assert.ok(opt(r, "av").net.p50 > opt(neuve, "av").net.p50 + 100, "un contrat de plus de 8 ans paie moins d'impôt qu'un contrat neuf");
  assert.deepEqual([opt(r, "av").enveloppe_scenario.ouverture, opt(r, "av").enveloppe_scenario.titulaire], ["2012-05-10", "p2"]);
  assert.ok(r.avertissements.some(x => /abattement annuel de l'assurance-vie \(9 200 € pour un couple imposé ensemble\)/.test(x)));
  const sansDate = jouerCas("EUR-1", { reponses: rep, patch: d => avecAv(d, {}) }).r;
  assert.ok(sansDate.avertissements.some(x => /^Ton assurance-vie : date d'ouverture à compléter : fiscalité d'avant 8 ans appliquée\.$/.test(x)), sansDate.avertissements.join(" | "));
  assert.equal(opt(sansDate, "av").retenable, false); assert.match(opt(sansDate, "av").raison_non_retenable, /date d'ouverture de ton assurance-vie/);
});
test("ouvrir un PEA : la référence « ton assurance-vie » sans date d'ouverture est dite ; déjà un PEA : dit ; phrase juste quand le PEA ne fait pas mieux après 5 ans", () => {
  const rep = { ...cas("PEA-1").reponses, destination_actuelle: "assurance_vie" };
  const { r } = jouerCas("PEA-1", { reponses: rep });
  assert.ok(r.avertissements.some(x => /^Ton assurance-vie : date d'ouverture à compléter/.test(x)), r.avertissements.join(" | "));
  const deja = jouerCas("PEA-1", { patch: d => { avecPea(d, { date_ouverture: "2020-03-02" }); d.positions.push({ id: "pea2", name: "Fonds actions monde", envelope: "PEA Sam", owner: "p2", bloc: "Actions", mode: "manual", value: 1000, valueDate: "2026-09-30", status: "actif" }); d.config.enveloppes_infos["PEA Sam"] = { type: "pea", titulaire: "p2" }; } }).r;
  assert.ok(deja.avertissements.some(x => /déjà un PEA, et on ne peut en avoir qu'un/.test(x)));
  /* frais du PEA bien au-dessus du seuil : sur 8 ans, il fait moins bien, et la phrase ne parle pas d'« avant 5 ans » */
  const cher = jouerCas("PEA-1", { reponses: { ...cas("PEA-1").reponses, frais_pea_pct: 1.5 } }).r;
  assert.ok(cher.reponse.ecart.p50 < 0);
  assert.doesNotMatch(cher.reponse.phrase, /avant 5 ans/); assert.match(cher.reponse.phrase, /ne ferait pas mieux .* de moins/);
  assert.equal(cher.reponse.option_en_tete, "R");
});

/* ---------------------------------------------------------------- PER : ce qui est dit, et le sens du seuil t* */
test("PER : sortie en capital en une fois, avance de trésorerie et économie à la TMI sont dites ; le seuil t* se lit dans le bon sens", () => {
  const p1 = jouerCas("PER-1").r;
  for (const motif of [/sortie en capital est calculée en une fois, à ta tranche de 30 %/, /tu avances environ 86 € par mois/, /comptée à ta tranche de 30 % sur tout le versement/])
    assert.ok(p1.avertissements.some(x => motif.test(x)), String(motif));
  assert.match(p1.ce_qui_changerait.find(l => l.hypothese === "tmi_retraite").phrase, /reste devant l'assurance-vie tant que .* sous 39,1 %/);
  const p2 = jouerCas("PER-2").r;                                      // l'assurance-vie fait mieux : le PER ne passerait devant que sous t*
  assert.equal(p2.reponse.option_en_tete, "av");
  assert.match(p2.ce_qui_changerait.find(l => l.hypothese === "tmi_retraite").phrase, /ne passerait devant l'assurance-vie que si .* sous 9,5 %/);
  const e5 = jouerCas("EUR-5").r, l5 = e5.ce_qui_changerait.find(l => l.hypothese === "tmi_retraite");
  if (l5) assert.doesNotMatch(l5.phrase, /reste devant/, "EUR-5 : le PER est dernier, il ne « reste » pas devant");
  const ns = jouerCas("EUR-4", { reponses: { ...cas("EUR-4").reponses, tmi_retraite_pct: "ne_sait_pas" } }).r;
  assert.doesNotMatch(JSON.stringify(ns.ce_qui_changerait), /ne_sait_pas %/);
});
test("variante du PER : la TMI de l'économie d'impôt est celle du scénario (per.tmi_actuelle_pct), validée et rejouée par le moteur", () => {
  const { r, entree, data } = jouerCas("PER-1");
  const v = S.varianteRetenue(entree, r, "per"), es = v.hypotheses.enveloppe_scenario;
  assert.equal(es.per.tmi_actuelle_pct, 30);
  const ES = x => ({ nom: "v", hypotheses: { enveloppe_scenario: { ...es, per: { ...es.per, ...x } } } });
  assert.equal(E_.validerVariante(ES({ tmi_actuelle_pct: 11 })), null);
  assert.match(E_.validerVariante(ES({ tmi_actuelle_pct: 12 })), /per.tmi_actuelle_pct » : 0, 11, 30, 41 ou 45/);
  assert.match(E_.validerVariante(ES({ magie: 1 })), /enveloppe_scenario.per » : objet/);
  assert.match(E_.validerVariante({ nom: "v", hypotheses: { enveloppe_scenario: { ...es, mensuel: { ...es.mensuel, x: 1 } } } }), /enveloppe_scenario.mensuel »/);
  assert.match(E_.validerVariante({ nom: "v", hypotheses: { enveloppe_scenario: { ...es, transferts: [{ de: "livret_a", montant: 5, x: 1 }] } } }), /enveloppe_scenario.transferts »/);
  /* le réglage du foyer dit 11 % ; la variante retenue à 30 % rejoue une économie à 30 % (septembre 2028 : 12 × 285,71 € × 30 %) */
  const d = J(data); d.config.projection.tmi_pct = 11;
  d.foyer = { evenements: [], variantes: [{ id: "a1b2c3d4-0000-4000-8000-0000000000b1", retire: [], ...v }] };
  const M = P_.preparer(d, { horizon_ans: 3, variante: "a1b2c3d4-0000-4000-8000-0000000000b1" }), t = M.dates.findIndex(x => x.slice(0, 7) === "2028-09");
  proche(M.nomDelta[t], 12 * 285.71 * 0.3, 0.01, "économie de 2027 rejouée à 30 %");
});

/* ---------------------------------------------------------------- matelas */
test("matelas : des livrets dont le type n'est pas connu n'entrent pas dans le gain du rangement (jamais un taux supposé nul) ; c'est dit", () => {
  const { r } = jouerCas("MAT-3", { patch: d => { d.config.enveloppes_infos["Livret A Exemple"] = { titulaire: "p1" }; d.positions.find(p => p.id === "la").envelope = "Livrets Camille"; } });
  assert.equal(r.statut, "ok");
  assert.equal(r.detail.gain_ordre_annuel, 0, "aucun gain inventé sur un argent dont le taux est inconnu");
  assert.ok(r.avertissements.some(x => /Le taux de « Livrets Camille » n'est pas connu/.test(x)), r.avertissements.join(" | "));
  /* la démo (« Livrets Camille », « Livrets Sam », PEL) : plus de 300 €/an de rangement supposé avant la relecture ; 0 désormais */
  const dm = S.jouer(entreeCatalogue("matelas"), demo(), {}, TODAY, {});
  assert.equal(dm.detail.gain_ordre_annuel, 0);
  assert.equal(opt(dm, "placement").retenable, false); assert.match(opt(dm, "placement").raison_non_retenable, /Livret A ou d'un LDDS/);
  assert.doesNotMatch(dm.reponse.phrase, /LEP/, "pas de LEP dans la phrase quand il n'est pas dans le rangement");
});
test("matelas : le surplus retenu est pris là où il est (courant au-delà de la réserve, LDDS, puis Livret A), jamais sur un livret absent", () => {
  const { r } = jouerCas("MAT-7");
  const tr = opt(r, "placement").enveloppe_scenario.transferts;
  assert.deepEqual(tr, [{ de: "ldds", montant: 6000 }], "MAT-7 : 6 000 € de surplus, pris sur le LDDS (rempli en dernier par la cible)");
  assert.deepEqual(opt(jouerCas("MAT-1").r, "placement").enveloppe_scenario.transferts, [{ de: "livret_a", montant: 10000 }]);
});
test("matelas : LEP — sans imposition commune un seul LEP est compté ; les parts répondues l'emportent sur l'avis ; un avis trop ancien n'est pas lu", () => {
  const solo = jouerCas("MAT-6", { patch: d => { d.profil.foyer.union = "concubinage"; } }).r;
  assert.deepEqual(solo.detail.ordre.filter(s => s.vers === "lep").map(s => s.titulaire), ["p1"]);
  assert.ok(solo.avertissements.some(x => /Sans imposition commune.*un seul LEP est compté, celui de Camille/.test(x)));
  const joint = jouerCas("MAT-6").r;
  assert.deepEqual(joint.detail.ordre.filter(s => s.vers === "lep").map(s => s.titulaire), ["p1", "p2"]);
  const parts = jouerCas("MAT-4a", { patch: d => { d.config.avis_impot.parts = 1; } }).r;   // avis : 1 part ; réponse : 2 parts (35 326 €)
  assert.equal(parts.detail.lep.parts, 2); assert.equal(parts.detail.lep.eligible, true);
  const vieux = jouerCas("MAT-1", { patch: d => { d.config.avis_impot.annee_revenus = 2022; } }).r;
  assert.equal(vieux.detail.lep.eligible, null);
  assert.ok(vieux.avertissements.some(x => /revenus de 2022 : pour un LEP, c'est celui des revenus de 2025 \(ou 2024\)/.test(x)));
});

/* ---------------------------------------------------------------- moteur : comparaison après impôts (opt-in) */
test("Projection.comparer : net_impots: true compare après les impôts de sortie ; sans l'option, l'écart reste brut (aucune sortie existante ne change)", () => {
  const { r, entree, data } = jouerCas("AV-1");
  const va = J(S.varianteRetenue(entree, r, "A")); delete va.hypotheses.enveloppe_scenario.initial;
  const vb = J(va); vb.hypotheses.enveloppe_scenario.ouverture = vb.hypotheses.enveloppe_scenario.debut;
  const d = J(data); d.foyer = { evenements: [], variantes: [{ id: "a1b2c3d4-0000-4000-8000-0000000000c1", retire: [], ...va }, { id: "a1b2c3d4-0000-4000-8000-0000000000c2", retire: [], ...vb }] };
  const prep = id => P_.preparer(J(d), { horizon_ans: 9, euros: "constants", vue: "net", variante: id });
  const brut = P_.comparer(prep("a1b2c3d4-0000-4000-8000-0000000000c2"), prep("a1b2c3d4-0000-4000-8000-0000000000c1"), { chemins: 300 });
  const net = P_.comparer(prep("a1b2c3d4-0000-4000-8000-0000000000c2"), prep("a1b2c3d4-0000-4000-8000-0000000000c1"), { chemins: 300, net_impots: true });
  assert.equal(brut.horizon.mediane_des_ecarts, 0, "même enveloppe, autre date d'ouverture : aucun écart brut");
  assert.equal(brut.net_impots, undefined);
  assert.ok(net.horizon.mediane_des_ecarts > 100 && net.net_impots === true, "après impôts, l'ancienneté du contrat se voit : " + net.horizon.mediane_des_ecarts);
});

/* ---------------------------------------------------------------- cohérence du socle et du moteur complet (spec § 6.3) */
const ID_A = "a1b2c3d4-0000-4000-8000-0000000000d1", ID_B = "a1b2c3d4-0000-4000-8000-0000000000d2";
/** Écart du moteur complet entre deux variantes (A − B) au mois T, en euros d'aujourd'hui, après impôts : déterministe, ou chemin par chemin (Projection.comparer). */
function ecartMoteur(data, va, vb, T, chemins) {
  const d = J(data); d.foyer = { evenements: liste(d.foyer && d.foyer.evenements), variantes: [{ id: ID_A, retire: [], ...va }, { id: ID_B, retire: [], ...vb }] };
  const o = id => ({ horizon_ans: Math.ceil(T / 12), euros: "constants", vue: "net", net_impots: true, variante: id });
  if (!chemins) { const net = id => P_.simuler(P_.preparer(J(d), o(id)), { volatilite: 0 }).vues.net.p50[T]; return net(ID_A) - net(ID_B); }
  const MB = P_.preparer(J(d), o(ID_B)), MA = P_.preparer(J(d), o(ID_A)), c = P_.comparer(MB, MA, { chemins, net_impots: true });
  return c.ecarts.p50[c.mois.indexOf(MB.dates[T])];
}
const liste = v => (Array.isArray(v) ? v : []);
const es = (v, patch, sans) => { const x = J(v); Object.assign(x.hypotheses.enveloppe_scenario, patch || {}); (sans || []).forEach(k => delete x.hypotheses.enveloppe_scenario[k]); return x; };
/** Variantes A (contrat ouvert maintenant, sans le petit versement, rendu à part par le socle) et B (ouvert au début des versements) du n° 12. */
const variantesAv = (entree, r) => { const va = es(S.varianteRetenue(entree, r, "A"), null, ["initial"]); return [va, es(va, { ouverture: va.hypotheses.enveloppe_scenario.debut })]; };

test("cohérence socle / moteur à 1 % : assurance-vie maintenant (AV-1 seul, AV-3 couple), assurance-vie contre compte-titres (EUR-1)", () => {
  for (const id of ["AV-1", "AV-3"]) {
    const { r, entree, data } = jouerCas(id), [va, vb] = variantesAv(entree, r);
    proche(ecartMoteur(data, va, vb, r.detail.T) / r.reponse.ecart.p50, 1, 0.01, id);
  }
  const { r, entree, data } = jouerCas("EUR-1"), socle = r.reponse.ecart.p50 && S.jouer(entree, data, cas("EUR-1").reponses, TODAY, { frais: fraisDeCas(cas("EUR-1")), allocation: { actions: 100 }, volatilite: 0 });
  const va = S.varianteRetenue(entree, r, "av"), vb = es(va, { type: "compte_titres", frais_enveloppe_pct: 0 });
  const e = Object.getOwnPropertyDescriptor(socle, "_calcul").value.sim.ecart("av", "cto");
  proche(ecartMoteur(data, va, vb, 120) / e.p50, 1, 0.01, "EUR-1 AV − CTO");
});
test("cohérence socle / moteur : PER-1 (écart expliqué : la dernière économie d'impôt arrive après la date de sortie)", () => {
  const { r, entree, data } = jouerCas("PER-1"), va = S.varianteRetenue(entree, r, "per");
  const vb = { nom: "AV", description: "", hypotheses: { enveloppe_scenario: { scenario: "per_interet", type: "assurance_vie", titulaire: "p1", ouverture: va.hypotheses.enveloppe_scenario.ouverture,
    allocation: { actions: 100 }, ter_pct: 0.2, frais_enveloppe_pct: 0.6, mensuel: { montant: 200, depuis: "capacite" } } } };
  const T = r.detail.T, moteur = ecartMoteur(data, va, vb, T);
  /* le socle compte l'effort net (l'économie est acquise) ; le moteur la verse en septembre de l'année suivante : celle des versements de 2046 (janvier à octobre)
     tombe en septembre 2047, après la sortie (octobre 2046). Ajoutée, en euros d'aujourd'hui, l'écart retrouve celui du socle à 1 % près. */
  const derniere = 10 * 285.71 * 0.3 / Math.pow(1.02, T / 12);
  assert.ok(moteur < r.reponse.ecart.p50, "sans la dernière économie, le moteur est en dessous");
  proche((moteur + derniere) / r.reponse.ecart.p50, 1, 0.01, "PER-1 avec la dernière économie");
});
test("cohérence socle / moteur : MAT-1 (écart expliqué : le moteur déplace le surplus à la fin du premier mois, le socle aujourd'hui)", () => {
  const { r, entree, data } = jouerCas("MAT-1"), va = S.varianteRetenue(entree, r, "placement");
  const moteur = ecartMoteur(data, va, { nom: "rien", description: "", hypotheses: {} }, 60);
  /* même calcul par le socle, flux au calendrier du moteur : 10 000 € sur le livret au mois 0, transférés en fin de mois 1 vers le compte-titres */
  const plan = { T: 60, couple: true, options: {
    placement: [{ type: "livret_a", ouverture_t: 0, poches: [{ classe: "monetaire", part: 1, frais_pct: 0 }], flux: [{ de: 0, a: 0, montant: 10000 }, { de: 1, a: 1, montant: -10000 }] },
      { type: "compte_titres", ouverture_t: 0, poches: [{ classe: "actions", part: 1, frais_pct: 0.2 }], flux: [{ de: 1, a: 1, montant: 10000 }] }],
    livret: [{ type: "livret_a", ouverture_t: 0, poches: [{ classe: "monetaire", part: 1, frais_pct: 0 }], flux: [{ de: 0, a: 0, montant: 10000 }] }] } };
  const sim = S.simulerEnveloppes({ ...data, today: TODAY }, plan, { volatilite: 0 }), e = sim.ecart("placement", "livret");
  proche(moteur / e.p50, 1, 0.01, "MAT-1 au calendrier du moteur");
  proche(moteur / r.reponse.ecart.p50, 1, 0.025, "MAT-1 : un mois de décalage, moins de 2,5 %");
});
test("cohérence socle / moteur sur la démo (cascade active : crédits, objectifs, événements) : à 1 % ; l'abattement partagé avec un autre contrat explique le reste", () => {
  const d = demo();
  const av = entreeCatalogue("av_maintenant"), repAv = { versement_initial: 100, versement_mensuel: 200, debut_date: "2029-11-15", retrait_ans: 9, part_fonds_euros_pct: 0, frais_contrat_pct: 0.6 };
  const det = S.jouer(av, d, repAv, TODAY, { frais: { ter_pct: 0.2 }, volatilite: 0 }), [va, vb] = variantesAv(av, det);
  proche(ecartMoteur(d, va, vb, det.detail.T) / det.reponse.ecart.p50, 1, 0.01, "démo, n° 12, déterministe");
  /* sans l'assurance-vie de Sam : l'abattement de 9 200 € n'est partagé avec aucun autre contrat — Monte-Carlo chemin par chemin, et n° 2 (assurance-vie contre compte-titres) */
  const d2 = J(d); d2.positions = d2.positions.filter(p => p.envelope !== "Assurance vie Sam"); delete d2.config.enveloppes_infos["Assurance vie Sam"];
  const mc = S.jouer(av, d2, repAv, TODAY, { frais: { ter_pct: 0.2 }, chemins: 400 }), [wa, wb] = variantesAv(av, mc);
  proche(ecartMoteur(d2, wa, wb, mc.detail.T, 400) / mc.reponse.ecart.p50, 1, 0.01, "démo sans autre contrat, n° 12, Monte-Carlo");
  const pe = entreeCatalogue("prochain_euro"), repE = { versement_mensuel: 300, versement_initial: 0, horizon_ans: 10, retrait_avant: true };
  const fr = { ter_pct: 0.2, assurance_vie_pct: 0.6, compte_titres_pct: 0, pea_pct: 0, fonds_euros_pct: 0.6 };
  for (const chemins of [0, 400]) {
    const r = S.jouer(pe, d2, repE, TODAY, { frais: fr, allocation: { actions: 100 }, ...(chemins ? { chemins } : { volatilite: 0 }) });
    const e = Object.getOwnPropertyDescriptor(r, "_calcul").value.sim.ecart("av", "cto"), ua = S.varianteRetenue(pe, r, "av"), ub = es(ua, { type: "compte_titres", frais_enveloppe_pct: 0 });
    proche(ecartMoteur(d2, ua, ub, 120, chemins) / e.p50, 1, 0.01, "démo sans autre contrat, n° 2, " + (chemins ? "Monte-Carlo" : "déterministe"));
  }
  /* avec le contrat de Sam (plus de 8 ans, des gains) : « si tu retirais tout », le moteur partage l'abattement entre les contrats, le socle le compte en entier
     pour cet argent (hypothèse dite dans les avertissements) : le moteur est plus bas, jamais plus haut */
  const r = S.jouer(pe, d, repE, TODAY, { frais: fr, allocation: { actions: 100 }, volatilite: 0 });
  const e = Object.getOwnPropertyDescriptor(r, "_calcul").value.sim.ecart("av", "cto");
  const ua = S.varianteRetenue(pe, r, "av"), ub = es(ua, { type: "compte_titres", frais_enveloppe_pct: 0 });
  assert.ok(ecartMoteur(d, ua, ub, 120) < e.p50);
  assert.ok(r.avertissements.some(x => /abattement annuel de l'assurance-vie .* il vaut pour l'ensemble de tes contrats/.test(x)));
});
