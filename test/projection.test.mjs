// PROJ : moteur de projection (web/src/projection.js) en mode déterministe — cas D, C, G et E de test/fixtures/projection-cas.json, ordre des opérations
// d'un mois, pureté, compartiments, capacité de base, garde-fous, existant et épargne future, honnêteté (aucune valeur de secours), textes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { FIXTURE, cas, entreeDe, reperesComplets } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const P = req("../web/src/projection.js");
const Marche = req("../web/src/marche.js");
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b + " (tolérance " + tol + ")");
const det = (c, extra) => {
  const M = P.preparer(entreeDe(c), { ...c.options, ...(extra || {}) });
  return { M, r: P.simuler(M, { volatilite: 0 }) };
};
const valeurs = (r, euros) => r.deterministe_detail[euros || "courants"];

/* ---------------------------------------------------------------- D : déterministe */
test("D-1 : flux sans rendement, versements en fin de mois", () => {
  const c = cas("D-1"), { r } = det(c);
  proche(valeurs(r).financier[12], c.attendu.mois_12.financier, 0.005);
});
test("D-2 : capitalisation géométrique, versements en fin de mois, allocation cible", () => {
  const c = cas("D-2"), { r } = det(c);
  proche(valeurs(r).financier[12], c.attendu.mois_12.financier, 0.005);
});
test("D-3 : euros constants (déflateur de l'inflation du repère)", () => {
  const c = cas("D-3"), { r } = det(c), a = c.attendu.mois_120;
  proche(valeurs(r).financier[120], a.financier_courants, 0.005);
  proche(valeurs(r, "constants").financier[120], a.financier_constants, 0.005);
  assert.equal(r.euros, "constants");
});
test("D-4 : rendement réel, 5 % nominal et 2 % d'inflation sur 10 ans", () => {
  const c = cas("D-4"), { r } = det(c), a = c.attendu.mois_120;
  proche(valeurs(r).financier[120], a.financier_courants, 0.005);
  proche(valeurs(r, "constants").financier[120], a.financier_constants, 0.005);
  /* la vue servie suit l'option euros */
  proche(r.vues.financier.p50[120], a.financier_constants, 0.005);
  const M = P.preparer(entreeDe(c), { ...c.options, euros: "courants" });
  proche(P.simuler(M, { volatilite: 0 }).vues.financier.p50[120], a.financier_courants, 0.005);
});
test("D-5 : frais du fonds et de l'enveloppe, un an de frais f retire la fraction f", () => {
  const c = cas("D-5"), { r } = det(c);
  proche(valeurs(r).financier[12], c.attendu.mois_12.financier, 0.005);
});
test("D-7 : fin de crédit, mensualité libérée et réaffectée à 100 %", () => {
  const c = cas("D-7"), { r } = det(c);
  assert.deepEqual(r.capacite_par_periode.map(s => [s.debut_t, s.fin_t, Math.round(s.montant_mensuel * 100) / 100]), c.attendu.capacite.map(s => [s.debut_t, s.fin_t, s.montant]));
  assert.match(r.capacite_par_periode[1].raison, /fin du prêt auto Exemple : \+300 €\/mois/);
  assert.equal(r.capacite_source, "prevu");
});
test("D-8 : naissance, coût par unité de consommation (0,3 puis 0,5) de la naissance à 20 ans, jalon chiffré", () => {
  const c = cas("D-8"), { M, r } = det(c), a = c.attendu;
  for (let t = 1; t <= M.N; t++) {
    const d = M.dates[t];
    const ligne = a.cout_mensuel.find(x => d >= x.du && (!x.au || d <= x.au)), attendu = ligne ? ligne.montant : 0;
    proche(-M.reelDelta[t], attendu, 0.005, d);
  }
  const j = r.jalons.find(x => x.type === "naissance");
  assert.equal(j.effet.texte, a.jalon_effet_texte);
  assert.match(j.quotient_familial, /non modélisé.*1 807 €/);
});
test("D-9 : levier ×2 quotidien, perte due à la volatilité et coût de financement, frais déduits", () => {
  const c = cas("D-9"), { r } = det(c);
  proche(valeurs(r).financier[12], c.attendu.mois_12.financier, 0.01);
  const sans = P.preparer(entreeDe({ ...c, data: { ...c.data, instruments: [] } }), c.options);
  proche(P.simuler(sans, { volatilite: 0 }).deterministe_detail.courants.financier[12], c.attendu.mois_12.sans_frais, 0.01);
  /* à 15 % de volatilité : environ 9,07 % par an avec frais, 9,73 % sans */
  const o15 = { ...c.options, hypotheses_classes: { actions: { rendement: 7, volatilite: 15 } } };
  const r15 = P.simuler(P.preparer(entreeDe(c), o15), { volatilite: 0 }).deterministe_detail.courants.financier[12];
  proche((r15 / 10000 - 1) * 100, c.attendu.annuel_sigma15_avec_frais_pct, 0.01);
  const r15s = P.simuler(P.preparer(entreeDe({ ...c, data: { ...c.data, instruments: [] } }), o15), { volatilite: 0 }).deterministe_detail.courants.financier[12];
  proche((r15s / 10000 - 1) * 100, c.attendu.annuel_sigma15_sans_frais_pct, 0.01);
});
test("D-10 : crèche (PSU), 0,0619 % × ressources × 200 h, du mois 11 au mois 46", () => {
  const c = cas("D-10"), { M, r } = det(c), a = c.attendu;
  for (let t = 1; t <= 60; t++) proche(-M.reelDelta[t], t >= a.mois.premier && t <= a.mois.dernier ? a.cout_mensuel : 0, 0.005, "mois " + t);
  assert.equal(r.jalons.find(x => x.type === "creche").effet.texte, a.jalon_effet_texte);
});
test("D-6 : amortissement mensuel (échéance, intérêts, capital restant dû, euros constants)", () => {
  const c = cas("D-6"), a = c.attendu, o = c.options;
  const tab = P.amortissement(o);
  assert.equal(tab.length, 300);
  proche(tab[0].echeance, a.echeance, 0.005); proche(tab[0].interets, a.interets_m1, 0.005);
  proche(tab[11].crd, a.crd_m12, 0.005); proche(tab.slice(0, 12).reduce((s, x) => s + x.interets, 0), a.interets_12, 0.005);
  proche(tab[299].crd, a.crd_m300, 1e-6); proche(tab.reduce((s, x) => s + x.interets, 0), a.interets_total, 0.01);
  proche(tab[119].echeance * Math.pow(1.02, -10), a.echeance_m120_constants, 0.005);
  assert.equal(tab[0].date, "2026-11-14"); assert.equal(tab[299].date, "2051-10-14");
  const assure = P.amortissement({ ...o, assurance_pct: 0.3 });
  proche(assure[0].assurance, 200000 * 0.003 / 12, 1e-9);
});
test("D-11 : crise de 2008 rejouée au mois 1, aucun rebond forcé", () => {
  const c = cas("D-11"), M = P.preparer(entreeDe(c), c.options), a = c.attendu;
  const r = P.crise(M, { cle: c.options.crise.cle, debut: c.options.crise.debut_t });
  assert.equal(r.fenetre_mois, a.fenetre_mois);
  proche(r.valeurs.financier[17], a.mois_17.financier, 0.005); proche(r.valeurs.financier[29], a.mois_29.financier, 0.005);
  proche(r.log_rendement_mensuel_fenetre, a.log_rendement_mensuel_fenetre, 1e-8);
  assert.ok(r.avertissements.some(m => /remontés plus vite/.test(m)));
});

/* ---------------------------------------------------------------- C : cas composés */
for (const id of ["C-1", "C-2", "C-3", "C-4", "C-5", "C-6"]) {
  test(id + " : foyer fictif sur 10 ans (financier, disponible, net à chaque anniversaire ; capacité par période)", () => {
    const c = cas(id), { M, r } = det(c), v = valeurs(r);
    for (const a of c.attendu.annuel) {
      const t = a.annee * 12;
      proche(v.financier[t], a.financier, 0.02, "financier an " + a.annee);
      proche(v.disponible[t], a.disponible, 0.02, "disponible an " + a.annee);
      proche(v.net[t], a.net, 0.02, "net an " + a.annee);
      assert.equal(r.mois[t], a.date);
    }
    assert.deepEqual(r.capacite_par_periode.map(s => [s.debut_t, s.fin_t, Math.round(s.montant_mensuel * 100) / 100]), c.attendu.capacite.map(s => [s.debut_t, s.fin_t, s.montant]));
    if (c.attendu.achat) {
      const a = c.attendu.achat, x = r.achats[0];
      assert.equal(x.t, a.t); assert.equal(x.date, a.date); proche(x.frais_acquisition, a.frais_acquisition, 0.01); proche(x.emprunt, a.emprunt, 0.01);
      proche(x.mensualite, a.mensualite, 0.01); proche(x.echeance_hors_assurance, a.echeance_hors_assurance, 0.01); proche(x.assurance_mensuelle, a.assurance_mensuelle, 0.01);
      assert.equal(x.premiere_echeance_t, a.premiere_echeance_t);
      proche(x.impots, a.impots, 0.01);
      for (const s of a.apport_sources) { const y = x.apport_sources.find(z => z.enveloppe === s.enveloppe); assert.ok(y, s.enveloppe); proche(y.brut, s.brut, 0.01); proche(y.impots, s.impots, 0.01); }
    }
    assert.ok(r.capacite_par_periode.every(s => s.raison));
  });
}
/* ---------------------------------------------------------------- L : part d'assurance d'un crédit existant (§ 6.4) */
for (const id of ["L-1", "L-2", "L-3"]) {
  test(id + " : la part d'assurance de la mensualité n'amortit pas le capital (durée restante, capital restant dû, mention)", () => {
    const c = cas(id), a = c.attendu, { M, r } = det(c), k = M.credits[0];
    assert.equal(k.assurance_methode, a.methode);
    proche(k.assurance_mensuelle, a.assurance_mensuelle, 0.0001); proche(k.mensualite_hors_assurance, a.mensualite_hors_assurance, 0.0001);
    if (a.capital_initial != null) proche(k.capital_initial, a.capital_initial, 0.01); else assert.equal(k.capital_initial, null);
    assert.equal(k.n, a.n, "durée restante");
    for (const [t, crd] of Object.entries(a.crd)) proche(M.detteExist[+t], crd, 0.01, "capital restant dû au mois " + t);
    assert.equal(M.mensExist[1], a.mensualite_decaissee, "la mensualité décaissée reste la mensualité entière (assurance comprise)");
    assert.equal(M.mensExist[M.N], k.n >= M.N ? a.mensualite_decaissee : 0, "mensualité entière jusqu'à la fin du crédit, puis plus rien (assurance comprise)");
    assert.deepEqual(k.mentions, a.mentions);
    for (const m of a.mentions) assert.ok(r.avertissements.includes(k.nom + " : " + m), m);
    assert.equal(r.avertissements.filter(m => /assurance du crédit/.test(m)).length, a.mentions.length);
  });
}
test("L-1 bis : assurance à 0 % déclarée → aucune séparation et aucune mention ; assurance incohérente (≥ mensualité) → aucune séparation, dite ", () => {
  const c = cas("L-1"), d0 = entreeDe(c);
  const avec = (a, sansDuree) => { const d = JSON.parse(JSON.stringify(d0)); const i = d.config.prets_infos["credit:c-auto"]; i.assurance_taux_pct = a; if (sansDuree) delete i.duree_mois; return P.preparer(d, c.options); };
  const zero = avec(0).credits[0];
  assert.equal(zero.assurance_methode, "aucune"); assert.equal(zero.assurance_mensuelle, 0); assert.equal(zero.mensualite_hors_assurance, 600); assert.deepEqual(zero.mentions, []);
  const fou = avec(10, true).credits[0]; /* 10 % du capital restant dû : 833 € par mois pour 600 € de mensualité */
  assert.equal(fou.assurance_methode, "inconnue"); assert.equal(fou.mensualite_hors_assurance, 600); assert.ok(fou.mentions.some(m => /non séparable/.test(m)));
  const M = avec(0.3), k = M.credits[0];
  assert.equal(M.mens0, 600, "mensualité du jour = mensualité entière du foyer");
  assert.ok(M.detteExist[12] > avec(0).detteExist[12], "avec l'assurance séparée, le capital se rembourse moins vite qu'avec la mensualité entière");
  assert.ok(k.n > zero.n);
});
test("C-7 : nouvel emploi, premier enfant, congé parental, crèche — capacité constatée sur 6 mois contre 1 900 € prévus", () => {
  const c = cas("C-7"), { M, r } = det(c), a = c.attendu, v = valeurs(r);
  const cb = r.capacite_base;
  assert.equal(r.capacite_source, a.base_utilisee);
  proche(cb.constatee, a.capacite_constatee.montant, 0.005); proche(cb.prevue, a.capacite_prevue, 0.005);
  assert.equal(cb.signale, a.ecart_signale);
  assert.equal(cb.periode, a.capacite_constatee.periode); assert.equal(cb.constatee_detail.mois, a.capacite_constatee.mois);
  proche(cb.constatee_detail.revenus, a.capacite_constatee.revenus, 0.005); proche(cb.constatee_detail.depenses, a.capacite_constatee.depenses, 0.005);
  assert.deepEqual(r.capacite_par_periode.map(s => [s.debut_t, s.fin_t, Math.round(s.montant_mensuel * 100) / 100, s.debut]), a.capacite_par_periode.map(s => [s.debut_t, s.fin_t, s.montant, s.debut]));
  r.capacite_par_periode.forEach((s, k) => assert.equal(s.raison, a.capacite_par_periode[k].raison, "raison de la période " + (k + 1)));
  for (const [t, x] of Object.entries(a.releves)) { assert.equal(r.mois[t], x.date); proche(v.disponible[t], x.disponible, 0.01, "disponible " + t); proche(v.financier[t], x.financier, 0.01, "financier " + t); }
  const premier = r.deterministe_detail.retraits_detail.find(x => x.sources.some(s => s.type === "pea"));
  assert.equal(premier.t, a.premier_retrait_pea.t);
  for (const s of a.premier_retrait_pea.sources) proche(premier.sources.find(y => y.enveloppe === s.enveloppe).brut, s.brut, 0.01, s.enveloppe);
  const sans = JSON.parse(JSON.stringify(entreeDe(c))); sans.foyer.evenements = [];
  proche(P.simuler(P.preparer(sans, c.options), { volatilite: 0 }).deterministe_detail.courants.financier[24], a.sans_evenements_mois_24.financier, 0.01);
  assert.deepEqual(r.evenements_pris_en_compte, a.evenements_pris_en_compte);
  const texte = type => r.jalons.find(j => j.type === type).effet.texte;
  assert.equal(texte("changement_emploi"), a.jalons_effet.emploi); assert.equal(texte("naissance"), a.jalons_effet.naissance);
  assert.equal(texte("conge_parental"), a.jalons_effet.conge); assert.equal(texte("creche"), a.jalons_effet.creche);
  assert.equal(r.jalons.find(j => j.type === "naissance").quotient_familial, a.jalons_effet.quotient_familial);
  assert.ok(r.garde_fous.some(g => g.cle === "ecart_capacite"));
  assert.equal(r.question_evenements, null);
});

/* ---------------------------------------------------------------- G : garde-fous, E : existant et épargne future */
test("G-1 : capacité constatée nulle contre 1 500 € prévus — base constatée, garde-fou, décomposition", () => {
  const c = cas("G-1"), { r } = det(c), a = c.attendu;
  assert.equal(r.capacite_source, a.base_utilisee);
  proche(r.capacite_base.constatee, a.capacite_constatee, 1e-9); proche(r.capacite_base.prevue, a.capacite_prevue, 1e-9);
  assert.deepEqual(r.garde_fous.map(g => g.cle), a.garde_fous);
  proche(valeurs(r).financier[60], a.mois_60.financier, 0.01); proche(r.existant.p50[60], a.mois_60.existant, 0.01);
  const dec = r.decomposition.find(x => x.t === 60);
  for (const k of ["depart", "versements", "marches", "frais", "impots"]) proche(dec[k], a.decomposition_mois_60[k], 0.01, k);
  assert.match(r.garde_fous[0].texte, /0 € par mois.*octobre 2025 à septembre 2026.*1 500 €/);
});
test("G-2 : base « prévu » forcée — 269 816 € à 5 ans, alerte, ratio sous la borne", () => {
  const c = cas("G-2"), { r } = det(c), a = c.attendu;
  assert.equal(r.capacite_source, a.base_utilisee);
  assert.deepEqual(r.garde_fous.map(g => g.cle), a.garde_fous);
  proche(valeurs(r).financier[60], a.mois_60.financier, 0.01); proche(r.existant.p50[60], a.mois_60.existant, 0.01);
  const dec = r.decomposition.find(x => x.t === 60);
  for (const k of ["depart", "versements", "marches", "frais", "impots"]) proche(dec[k], a.decomposition_mois_60[k], 0.01, k);
  proche(valeurs(r).financier[60] / (125000 + 90000), a.ratio_croissance_5_ans, 0.001);
  assert.match(r.garde_fous[0].texte, /1 500 € d'épargne par mois.*0 € par mois/);
  assert.ok(r.avertissements.some(m => /plafond de versements du PEA/.test(m)), "le plafond du PEA dépassé est dit");
});
test("G-3 : rendement implicite de la médiane au-dessus du rendement attendu du profil", () => {
  const c = cas("G-3"), { r } = det(c), a = c.attendu;
  assert.deepEqual(r.garde_fous.map(g => g.cle), a.garde_fous);
  const g = r.garde_fous.find(x => x.cle === "rendement_implicite");
  proche(g.valeurs.implicite, a.rendement_implicite_existant_pct, 0.1); proche(g.valeurs.attendu, a.rendement_attendu_pct, 0.1);
  assert.equal(g.niveau, "alerte");
});
test("G-4 : borne de croissance à 5 ans — 100 % crypto à 10 %", () => {
  const c = cas("G-4"), { r } = det(c), a = c.attendu;
  proche(valeurs(r).financier[60], a.mois_60.financier, 0.01);
  assert.deepEqual(r.garde_fous.map(g => g.cle), a.garde_fous);
  proche(r.garde_fous[0].valeurs.ratio, a.ratio_croissance_5_ans, 1e-4); proche(r.garde_fous[0].valeurs.borne, a.borne, 1e-4);
  assert.match(r.garde_fous[0].texte, /8 % par an/);
});
test("G : aucun garde-fou quand la projection est plausible et sans hypothèse modifiée", () => {
  const c = cas("D-2"), { r } = det(c);
  assert.deepEqual(r.garde_fous, []);
});
test("E-1 : existant et épargne future séparés, versements et croissance des versements", () => {
  const c = cas("E-1"), { r } = det(c), a = c.attendu;
  proche(r.existant.p50[120], a.mois_120.existant, 0.01); proche(r.epargne_future.p50[120], a.mois_120.epargne_future, 0.01);
  proche(valeurs(r).financier[120], a.mois_120.total, 0.01);
  proche(r.epargne_future.versements_cumules[120], a.versements_cumules, 0.01); proche(r.epargne_future.croissance[120], a.croissance_des_versements, 0.01);
  assert.equal(r.existant.p50[7], null, "la couche existant n'est triée qu'aux années");
  assert.ok(r.phrase.includes("médiane"));
  assert.match(r.decomposition_phrase, /ton patrimoine actuel.*ton épargne future/);
});

/* ---------------------------------------------------------------- structure, ordre des opérations, pureté, honnêteté */
test("préparer est pur : l'entrée n'est pas modifiée (copie profonde comparée), deux appels donnent le même résultat", () => {
  const c = cas("C-7"), d = entreeDe(c), avant = JSON.stringify(d);
  const M = P.preparer(d, c.options), r1 = P.simuler(M, { volatilite: 0 });
  assert.equal(JSON.stringify(d), avant);
  const r2 = P.simuler(P.preparer(d, c.options), { volatilite: 0 });
  assert.deepEqual(r1.vues, r2.vues);
});
test("ordre des opérations d'un mois : rendement, frais, versement en fin de mois, puis événement daté", () => {
  const c = cas("D-1"), d = entreeDe(c);
  d.positions = [{ id: "ct", name: "Fonds Exemple", envelope: "Compte-titres Exemple", owner: "p1", bloc: "Monde", mode: "manual", value: 10000, status: "actif", qty: 100, pru: 100 }];
  d.config.enveloppes_infos = { "Compte-titres Exemple": { type: "compte_titres", titulaire: "p1" } };
  d.config.frais_enveloppes = { "Compte-titres Exemple": { garde_pct: 1.2 } };
  d.config.projection.reste_capacite = "cible"; d.config.targets = { actions: 100 };
  d.foyer.evenements = [{ id: "e", type: "retrait", personne: "foyer", libelle: "Voyage", date: "2026-11-01", params: { montant: 2000 }, source: "cas fictif" }];
  const M = P.preparer(d, { ...c.options, hypotheses_classes: { actions: { rendement: 6, volatilite: 0 } }, horizon_ans: 1, capacite_mensuelle: 500 });
  const r = P.simuler(M, { volatilite: 0 });
  /* mois 1 : (10 000 × g × fee) puis +500 versé (aucun rendement ni frais sur ce versement), puis retrait de 2 000 net (impôt compris) */
  const g = Math.pow(1.06, 1 / 12), fee = Math.pow(1 - 0.012, 1 / 12), avantRetrait = 10000 * g * fee + 500;
  const v1 = r.deterministe_detail.courants.financier[1];
  assert.ok(v1 < avantRetrait - 1999 && v1 > avantRetrait - 2300, "retrait de 2 000 € net après versement : " + v1 + " vs " + avantRetrait);
});
test("compartiments : enveloppe × titulaire × classe, type, frais pondérés, base fiscale et mention « prix de revient à compléter »", () => {
  const c = cas("R-1"), M = P.preparer(entreeDe(c), { horizon_ans: 1 });
  const parNom = Object.fromEntries(M.comps.map(x => [x.enveloppe, x]));
  assert.equal(parNom["Compte-titres Exemple"].type, "compte_titres"); assert.equal(parNom["Compte-titres Exemple"].base0, 18000);
  assert.equal(parNom["Assurance vie Exemple"].base0, 40000); assert.equal(parNom["PEA Exemple"].base0, 30000);
  assert.equal(parNom["Compte courant Exemple"].classe, "courant"); assert.equal(parNom["Compte courant Exemple"].dispo, true);
  const d = entreeDe(c); d.positions[1] = { ...d.positions[1], qty: undefined, pru: undefined };
  const M2 = P.preparer(d, { horizon_ans: 1 }), r = P.simuler(M2, { volatilite: 0 });
  assert.ok(r.a_completer.some(x => /Prix de revient/.test(x.titre)));
  assert.ok(r.couverture < 1);
});
test("compte courant à 0 %, livrets au taux réglementé jusqu'à leur date de fin puis rendement central du monétaire", () => {
  const c = cas("C-7"), M = P.preparer(entreeDe(c), { ...c.options });
  const cc = M.comps.find(x => x.type === "courant"), la = M.comps.find(x => x.type === "livret_a");
  assert.equal(cc.a, 0);
  const t1 = M.dates.findIndex(d => d > "2027-01-31");
  assert.ok(Math.abs(la.aSerie[t1 - 1] - Math.log(1.017) / 12) < 1e-12 && Math.abs(la.aSerie[t1] - Math.log(1.015) / 12) < 1e-12, "1,7 % jusqu'au 31/01/2027 puis 1,5 %");
});
test("rendement central lu dans les repères rendement_central_* ; repli sur Marche avec mention ; hypothèses_classes remplace", () => {
  const c = cas("D-2"), d = entreeDe(c);
  const sans = JSON.parse(JSON.stringify(d)); sans.reperes = sans.reperes.filter(r => r.cle !== "rendement_central_actions");
  const M = P.preparer(sans, { horizon_ans: 1, capacite_mensuelle: 0 });
  assert.ok(Math.abs(M.comps[0].a - Math.log(1.07) / 12) < 1e-12, "repli sur le rendement historique de Marche");
  const r = P.simuler(M, { volatilite: 0 });
  assert.ok(r.avertissements.some(m => m.includes("rendement_central_actions")));
  const central = P.preparer(d, { horizon_ans: 1, capacite_mensuelle: 0 });
  assert.ok(Math.abs(central.comps[0].a - Math.log(1.06) / 12) < 1e-12, "rendement central 6 % (sous l'historique de 7 %)");
  const cl = P.simuler(central, { volatilite: 0 }).hypotheses_classes.find(x => x.classe === "actions");
  assert.equal(cl.sous_historique, true); assert.equal(cl.rendement_historique, 7);
});
test("capacité de base : constatée sur 12 mois, sinon 6, sinon 3 avec mention ; base forcée ; sans comptes la prévue, dite comme telle", () => {
  const c = cas("G-1"), d = entreeDe(c);
  assert.equal(P.capaciteDeBase(d).source, "reel");
  assert.equal(P.capaciteDeBase(d).constatee_detail.mois, 12);
  const court = JSON.parse(JSON.stringify(d)); court.banque.mois = court.banque.mois.filter(m => m.mois >= "2026-06-01");
  const cc = P.capaciteDeBase(court);
  assert.equal(cc.constatee_detail.mois, 4 > 3 ? 3 : 4); assert.equal(cc.constatee_detail.courte, true);
  assert.ok(cc.mentions.some(m => /période courte/.test(m)));
  assert.equal(P.capaciteDeBase(d, { base_capacite: "prevu" }).retenue, 1500);
  assert.equal(P.capaciteDeBase(d, { capacite_mensuelle: 250 }).retenue, 250);
  assert.equal(P.capaciteDeBase(d, { capacite_mensuelle: 250 }).source, "montant");
  const sans = JSON.parse(JSON.stringify(d)); sans.banque = null;
  const s = P.capaciteDeBase(sans);
  assert.equal(s.source, "prevu"); assert.equal(s.constatee, null);
  const p1 = P.capaciteDeBase(d, { perimetre: "p1" });
  assert.equal(p1.source, "prevu"); assert.ok(p1.mentions.some(m => /n'existe que pour le foyer/.test(m)));
  assert.equal(P.capaciteDeBase(d).signale, true);
  const accord = JSON.parse(JSON.stringify(d)); accord.budget.lignes[1].montant = 4000; // dépenses 5 000 : prévue 0 € comme la constatée
  assert.equal(P.capaciteDeBase(accord).prevue, 0);
  assert.equal(P.capaciteDeBase(accord).signale, false, "prévue et constatée égales : rien à signaler");
});
test("sans événement : la sortie pose la question ; avec : « Événements pris en compte »", () => {
  const c = cas("D-1"), { r } = det(c);
  assert.deepEqual(r.evenements_pris_en_compte, []);
  assert.match(r.question_evenements, /Aucun événement renseigné — as-tu des changements prévus/);
});
test("périmètre d'une personne : sa part des crédits communs et la capacité prévue", () => {
  const c = cas("C-1"), d = entreeDe(c);
  const M = P.preparer(d, { ...c.options, perimetre: "p1" });
  assert.equal(M.capacite_base.source, "prevu");
  assert.ok(M.comps.every(x => x.titulaire !== "p2"));
});
test("variante : événements propres, événements retirés, mêmes comptes ; hypothèse de variante", () => {
  const c = cas("C-2"), d = entreeDe(c);
  d.foyer.variantes = [{ id: "v-sans", nom: "Sans enfant", description: "", retire: ["e-naiss"], hypotheses: {} }, { id: "v-plus", nom: "Plus d'épargne", description: "", retire: [], hypotheses: { epargne_delta_mensuel: 100 } }];
  const base = P.simuler(P.preparer(d, c.options), { volatilite: 0 }), sans = P.simuler(P.preparer(d, { ...c.options, variante: "v-sans" }), { volatilite: 0 }), plus = P.simuler(P.preparer(d, { ...c.options, variante: "v-plus" }), { volatilite: 0 });
  assert.ok(sans.deterministe_detail.courants.financier[120] > base.deterministe_detail.courants.financier[120] + 60000);
  proche(plus.deterministe_detail.courants.financier[120] - base.deterministe_detail.courants.financier[120], 12000, 0.01, "+100 € par mois pendant 120 mois, reste disponible à 0 %");
});
test("événement invalide ignoré avec avertissement ; types réservés refusés", () => {
  const c = cas("D-8"), d = entreeDe(c);
  d.foyer.evenements.push({ id: "x", type: "chomage", personne: "p1", libelle: "Chômage", date: "2027-01-01", params: {}, source: "s" });
  const r = P.simuler(P.preparer(d, c.options), { volatilite: 0 });
  assert.ok(r.avertissements.some(m => /ignoré.*pas encore pris en compte/.test(m)));
  assert.equal(r.evenements_pris_en_compte.length, 1);
});
test("aucune valeur de secours : repères des unités de consommation manquants → coût de l'enfant non estimé et dit", () => {
  const c = cas("D-8"), d = entreeDe(c);
  d.reperes = d.reperes.filter(r => r.cle !== "uc_enfant_moins_14");
  const r = P.simuler(P.preparer(d, c.options), { volatilite: 0 });
  assert.ok(r.avertissements.some(m => /coût de l'enfant non estimé/.test(m)));
  assert.equal(r.capacite_par_periode.length, 1);
});
test("assistante maternelle : coût obligatoire, aide de la Caf déduite seulement si fournie, sinon mention", () => {
  const c = cas("D-10"), d = entreeDe(c);
  d.foyer.evenements = [{ id: "g", type: "creche", personne: "foyer", libelle: "Garde Enfant 1", date: "2027-03-01", fin: "2029-09-01", params: { enfant: "Enfant 1", mode: "assistante_maternelle", cout_mensuel: 1200 }, source: "cas fictif" }];
  let M = P.preparer(d, c.options);
  proche(-M.reelDelta[6], 1200, 1e-9);
  assert.ok(M.avertissements.some(m => /aide de la Caf non déduite/.test(m)));
  d.foyer.evenements[0].params.cmg_mensuel = 400;
  M = P.preparer(d, c.options);
  proche(-M.reelDelta[6], 800, 1e-9);
  assert.ok(!M.avertissements.some(m => /aide de la Caf non déduite/.test(m)));
});
test("fin de crédit : règle de réaffectation modifiable par un événement fin_credit (50 % → moitié de la mensualité)", () => {
  const c = cas("C-5"), { r } = det(c);
  const s = r.capacite_par_periode.find(x => x.debut_t === 25);
  assert.match(s.raison, /moitié réaffectée/);
});
test("textes au tutoiement, sans « conseiller » ni produit nommé", () => {
  const c = cas("C-7"), { r } = det(c);
  const txt = JSON.stringify([r.phrase, r.decomposition_phrase, r.capacite_par_periode.map(x => x.raison), r.garde_fous.map(g => g.texte), r.avertissements, r.jalons.map(j => j.effet.texte), r.a_completer]);
  assert.doesNotMatch(txt, /conseiller|\bvous\b|\bvotre\b|\bvos\b/i);
});
test("HYPOTHESES : chaque repère lu par le moteur existe dans une migration (sinon la règle est indisponible, jamais remplacée)", () => {
  const cles = new Set(reperesComplets().map(r => r.cle));
  const manquants = P.HYPOTHESES.reperes.filter(k => !cles.has(k) && !P.HYPOTHESES.manquants_assumes.includes(k));
  assert.deepEqual(manquants, []);
});

/* ---- revue Opus, correctif 2 : le garde-fou de croissance compare la même vue (financière), jamais le net avec la résidence ---- */
test("G-4 bis : un foyer qui possède un logement de 400 k€ en vue nette ne déclenche pas de fausse alerte de croissance", () => {
  const c = cas("D-2"), d = entreeDe(c);
  const bien = { id: "bien-rp", nom: "Logement Exemple", usage: "rp", valeur: 400000, part_p1: 50, crd: 0, mensualite: 0, loyer: 0 };
  d.profil.biens = [bien]; d.biens = [bien];
  const opts = { horizon_ans: 5, vue: "net", euros: "constants", capacite_mensuelle: 500, hypotheses_classes: { actions: { rendement: 3, volatilite: 10 } } };
  for (const extra of [{}, { net_impots: true }, { vue: "financier" }]) {
    const M = P.preparer(JSON.parse(JSON.stringify(d)), { ...opts, ...extra });
    const r = P.simuler(M, { chemins: 300 });
    assert.ok(!r.garde_fous.some(g => g.cle === "croissance_5_ans"), JSON.stringify(extra) + " : " + JSON.stringify(r.garde_fous));
  }
  /* l'hypothèse vraiment trop forte déclenche toujours l'alerte, quelle que soit la vue affichée */
  const fort = { ...opts, hypotheses_classes: { actions: { rendement: 15, volatilite: 10 } } };
  for (const vue of ["net", "financier"]) {
    const r = P.simuler(P.preparer(JSON.parse(JSON.stringify(d)), { ...fort, vue }), { chemins: 300 });
    assert.ok(r.garde_fous.some(g => g.cle === "croissance_5_ans" || g.cle === "rendement_implicite"), vue);
  }
});

/* ---- revue Opus, correctif 4 : le coût d'un enfant se calcule sur les dépenses du foyer, jamais sur la part d'une personne (moitié comptée deux fois) ---- */
test("naissance : la vue d'une personne porte la moitié exacte du coût du foyer (−300 € quand le foyer paie −600 €)", () => {
  const c = cas("D-8"), d = entreeDe(c);
  const foyer = P.preparer(JSON.parse(JSON.stringify(d)), { ...c.options, perimetre: "foyer" }), p1 = P.preparer(JSON.parse(JSON.stringify(d)), { ...c.options, perimetre: "p1" });
  let compte = 0;
  for (let t = 1; t <= foyer.N; t++) {
    if (Math.abs(foyer.reelDelta[t]) < 1e-9) continue;
    compte++;
    proche(p1.reelDelta[t], foyer.reelDelta[t] / 2, 0.005, "mois " + t);
  }
  assert.ok(compte > 12, "des mois avec un coût d'enfant");
  const p2 = P.preparer(JSON.parse(JSON.stringify(d)), { ...c.options, perimetre: "p2" });
  const t1 = [...Array(foyer.N).keys()].map(i => i + 1).find(t => Math.abs(foyer.reelDelta[t]) > 1e-9);
  proche(p1.reelDelta[t1] + p2.reelDelta[t1], foyer.reelDelta[t1], 0.005, "les deux moitiés font le tout");
});

/* ---- revue Opus, correctifs 5 et 13 : distribution des SCPI détenues en direct (spec § 5.3) ---- */
function scpiCas(extra, reperesMoins) {
  const c = cas("D-2"), d = entreeDe(c);
  d.positions = [{ id: "scpi", name: "SCPI Exemple", envelope: "SCPI Exemple", owner: "p1", bloc: "Immobilier", mode: "manual", value: 100000, valueDate: "2026-09-30", status: "actif", qty: 1, pru: 100000 }];
  d.config.targets = {}; d.config.projection.tmi_pct = 30;
  if (reperesMoins) d.reperes = d.reperes.filter(r => !reperesMoins.includes(r.cle));
  return { d, opts: { volatilite: 0, euros: "courants", vue: "financier", horizon_ans: 1, capacite_mensuelle: 0, hypotheses_classes: { immobilier: { rendement: 5, volatilite: 0 } }, ...(extra || {}) } };
}
test("SCPI en direct : la distribution (4,91 %) est versée chaque mois au compte courant après impôt au barème (30 %) et prélèvements sociaux (17,2 %), le reste du rendement reste dans la part", () => {
  const { d, opts } = scpiCas();
  const r = P.simuler(P.preparer(d, opts), { volatilite: 0 });
  const a = Math.log(1.05) / 12, taux = 0.0491 / 12, net = 1 - 0.30 - 0.172;
  let v = 100000, cash = 0;
  for (let m = 1; m <= 12; m++) { v *= Math.exp(a); const dist = v * taux; v -= dist; cash += dist * net; }
  const M = P.preparer(d, opts), detail = P.simuler(M, { volatilite: 0 }).deterministe_detail, det = detail.courants;
  proche(det.financier[12], v + cash, 0.01, "valeur de la part + distributions nettes au disponible");
  const iScpi = M.comps.findIndex(c => c.type === "scpi_direct"), iC = M.comps.findIndex(c => c.type === "courant");
  proche(detail.valeurs_par_compartiment[12 * M.B + iScpi], v, 0.01, "la part");
  proche(detail.valeurs_par_compartiment[12 * M.B + iC], cash, 0.01, "distributions nettes versées au disponible");
  assert.ok(det.financier[12] < 105000 - 100, "l'impôt sur les loyers est payé : moins que le rendement brut de 5 %");
  /* la couche « patrimoine actuel sans nouveau versement » reçoit aussi les distributions */
  proche(r.existant.p50[12], v + cash, 0.01);
});
test("SCPI en direct : taux marginal inconnu → 30 % supposés et dits ; repère de distribution ou de prélèvements fonciers manquant → rien n'est distribué, dit", () => {
  const sans = scpiCas(); delete sans.d.config.projection.tmi_pct; delete sans.d.profil.foyer.tmi;
  const r = P.simuler(P.preparer(sans.d, sans.opts), { volatilite: 0 });
  assert.ok(r.avertissements.some(m => /30 %.*SCPI|SCPI.*30 %/.test(m)), JSON.stringify(r.avertissements));
  const { d, opts } = scpiCas({}, ["scpi_taux_distribution"]);
  const r2 = P.simuler(P.preparer(d, opts), { volatilite: 0 });
  proche(r2.deterministe_detail.courants.financier[12], 105000, 0.01, "toute la performance reste dans la part");
  assert.ok(r2.avertissements.some(m => /scpi_taux_distribution/.test(m)));
  const s3 = scpiCas({}, ["ps_taux_foncier"]);
  const r3 = P.simuler(P.preparer(s3.d, s3.opts), { volatilite: 0 });
  proche(r3.deterministe_detail.courants.financier[12], 105000, 0.01);
  assert.ok(r3.avertissements.some(m => /ps_taux_foncier/.test(m)));
});
test("fonds immobilier coté (ISIN, cours) dans un compte-titres : jamais traité comme une SCPI en direct (pas de distribution, impôt du compte-titres)", () => {
  const { d, opts } = scpiCas();
  d.positions = [{ id: "etf", name: "ETF Immobilier coté Exemple", isin: "FR0000000001", envelope: "Compte-titres Exemple", owner: "p1", bloc: "Immobilier", mode: "market", qty: 100, price: 1000, pru: 900, status: "actif" }];
  d.config.enveloppes_infos = { "Compte-titres Exemple": { type: "compte_titres", titulaire: "p1", source: "cas fictif", le: "2026-10-14" } };
  const M = P.preparer(d, opts);
  assert.ok(M.comps.every(c => c.type !== "scpi_direct"), M.comps.map(c => c.type).join());
  const r = P.simuler(M, { volatilite: 0 });
  proche(r.deterministe_detail.courants.financier[12], 105000, 0.01, "capitalisation sans distribution");
  /* une SCPI détenue dans un compte-titres sans ISIN, nommée comme telle, reste une SCPI directe */
  d.positions = [{ id: "s2", name: "SCPI Exemple 2", envelope: "Compte-titres Exemple", owner: "p1", bloc: "Immobilier", mode: "manual", value: 100000, status: "actif", qty: 1, pru: 100000 }];
  assert.ok(P.preparer(d, opts).comps.some(c => c.type === "scpi_direct"));
});

/* ---- revue Opus, correctif 11 : statut d'un objectif — date passée = hors de portée (jamais « hors horizon »), échéance au-delà de l'horizon = hors horizon ---- */
test("objectifs : échéance passée et non atteint → hors_portee ; au-delà de l'horizon → hors_horizon (probabilité nulle) ; atteint prime", () => {
  const c = cas("D-2"), d = entreeDe(c);
  d.objectifs = [
    { id: "passe", nom: "Passé", type: "projet", cible: 50000, dateCible: "2026-01-01", deja: 0, source: "saisi", poches: [], enveloppes: [], rendement: 0, priorite: 1 },
    { id: "loin", nom: "Loin", type: "retraite", cible: 500000, dateCible: "2046-01-01", deja: 0, source: "saisi", poches: [], enveloppes: [], rendement: 0, priorite: 2 },
    { id: "fait", nom: "Fait", type: "projet", cible: 1000, dateCible: "2026-01-01", deja: 5000, source: "saisi", poches: [], enveloppes: [], rendement: 0, priorite: 3 },
  ];
  const r = P.simuler(P.preparer(d, { ...c.options, horizon_ans: 5 }), { volatilite: 0 });
  const st = Object.fromEntries(r.objectifs.map(o => [o.id, o]));
  assert.equal(st.passe.statut, "hors_portee");
  assert.equal(st.loin.statut, "hors_horizon"); assert.equal(st.loin.probabilite, null); assert.equal(st.loin.mot, null);
  assert.equal(st.fait.statut, "atteint");
});
