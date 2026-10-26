// SCN n° 20 « Investir dans un bien locatif ou en SCPI ? » (web/src/scenarios.js, calcul locatifScpi ; spec docs/superpowers/specs/2026-10-26-scn-locatif-scpi-design.md).
// Cas déterministes recalculés par un script indépendant (scripts/verif/locatif-scpi-verif.py) dans la fixture (LOC-*), propriétés Monte-Carlo, statuts,
// régimes fiscaux, effort égal, garde-fous de texte, parité avec la copie du connecteur. Foyer fictif « Camille et Sam ».
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { FIXTURE, cas, dataDe, entreeCatalogue } from "./helpers/scenarios-cas.mjs";
import { MoteurGen } from "./helpers/moteur-gen.mjs";
const req = createRequire(import.meta.url);
const S = req("../web/src/scenarios.js");
const TODAY = "2026-10-15";
const E = () => entreeCatalogue("locatif_scpi");
const BASE = { prix: 200000, neuf: false, travaux: 0, mobilier: 5000, apport: 30000, duree_credit_ans: 20, taux_credit_pct: 3.27, loyer_mensuel: 900, vacance_mois: 1,
  charges_annuelles: 1850, gestion_pct: 0, regime: "lmnp_reel", horizon_ans: 20, tmi: 30, scpi_frais_souscription_pct: 10, scpi_taux_distribution_pct: 4.91,
  scpi_prix_part_pct: -0.41, scpi_reinvestir: true, frais_av_pct: 0.6, scpi_credit: false };
const donnees = (patch) => { const { data } = dataDe({ today: TODAY, ...(patch || {}) }); return data; };
const jouer = (rep, opts, data) => S.jouer(E(), data || donnees(), { ...BASE, ...(rep || {}) }, TODAY, opts || { volatilite: 0 });
const opt = (r, id) => r.options.find(o => o.id === id);
const proche = (a, b, tol, msg) => assert.ok(a != null && Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b + " (tolérance " + tol + ")");

test("catalogue : entrée n° 20, thème immobilier, questions et repères connus, garde-fous sans produit ni « conseiller »", () => {
  const e = E();
  assert.equal(e.numero, 20); assert.equal(e.theme, "immobilier"); assert.equal(e.calcul, "locatifScpi"); assert.ok(S.CALCULS.locatifScpi);
  const cles = new Set(FIXTURE.reperes.map(r => r.cle).concat(dataDe({ today: TODAY }).data.reperes.map(r => r.cle)));
  for (const k of e.reperes) assert.ok(cles.has(k), "repère inconnu : " + k);
  assert.ok(e.questions.length <= 20 && e.questions.every(q => q.libelle && q.aide));
  assert.ok(!/conseil/i.test(JSON.stringify(e)));
  assert.ok(e.garde_fous.length >= 100 && e.garde_fous.length <= 1500);
  for (const r of FIXTURE.reperes.filter(r => /^(micro_|deficit_|scn_lmnp|scn_locatif|scn_immo|scn_scpi)/.test(r.cle))) {
    assert.ok(r.sourceTitre && r.sourceUrl && r.verifieLe, r.cle);
    assert.ok(["V", "CONV"].includes(r.statut), r.cle);
    if (r.statut === "V") assert.match(r.sourceUrl, /^https:\/\/www\.impots\.gouv\.fr\//, r.cle);
  }
});

test("à compléter : sans le bien (prix, apport, loyer, charges), aucun chiffre ; enjeu « à calculer » sur la carte", () => {
  const r = S.jouer(E(), donnees(), {}, TODAY, { volatilite: 0 });
  assert.equal(r.statut, "a_completer");
  assert.deepEqual(r.manquants.map(m => m.champ).sort(), ["apport", "charges_annuelles", "loyer_mensuel", "prix"]);
  assert.equal(r.reponse, undefined);
  const ej = S.enjeu(E(), donnees(), TODAY, { volatilite: 0 });
  assert.equal(ej.statut, "a_completer"); assert.equal(ej.p50, null);
});

test("indisponible : un repère fiscal absent rend le scénario indisponible, jamais une valeur de remplacement", () => {
  const d = donnees(); d.reperes = d.reperes.filter(x => x.cle !== "micro_bic_plafond");
  const r = jouer({}, undefined, d);
  assert.equal(r.statut, "indisponible"); assert.ok(r.reperes_manquants.includes("micro_bic_plafond"));
});

test("réponses invalides : régime inconnu, prix hors bornes, texte libre", () => {
  assert.throws(() => jouer({ regime: "sci_is" }), /choix inconnu/);
  assert.throws(() => jouer({ prix: 5 }), /hors des bornes/);
  assert.throws(() => jouer({ loyer_mensuel: "900 €" }), /doit être un nombre/);
});

test("déterministe : bandes réduites à un point, trois options, effort égal (même budget versé), réponse cohérente avec le classement", () => {
  const r = jouer();
  assert.equal(r.statut, "ok");
  assert.deepEqual(r.options.map(o => o.id), ["L", "S", "AV"]);
  for (const o of r.options) { assert.equal(o.net.p10, o.net.p50); assert.equal(o.net.p90, o.net.p50); }
  assert.ok(r.options.every(o => o.verse === r.options[0].verse), "même effort pour toutes les options");
  const tri = r.options.slice().sort((a, b) => b.net.p50 - a.net.p50);
  assert.equal(r.reponse.option_en_tete, tri[0].id); assert.equal(r.reponse.reference, tri[1].id);
  proche(r.reponse.ecart.p50, tri[0].net.p50 - tri[1].net.p50, 0.02, "écart = tête − deuxième");
  proche(r.reponse.ecart_annuel.p50, r.reponse.ecart.p50 / 20, 0.02, "écart annuel");
  assert.match(r.reponse.phrase, /^Sur 20 ans, à effort égal, /); assert.match(r.reponse.phrase, /en euros d'aujourd'hui\.$/);
  assert.equal(r.detail.patrimoine.points.length, 20); assert.ok(r.detail.tri.L != null && r.detail.tri.S != null);
  assert.equal(r.courbe.abscisse, "date_sortie"); assert.equal(r.courbe.points.length, 20);
  assert.ok(r.ce_qui_changerait.length >= 2 && r.ce_qui_changerait.length <= 4);
  assert.ok(r.ce_qui_changerait.every(l => l.phrase && l.seuil));
  assert.ok(r.options.every(o => o.retenable === false && /événement de vie/.test(o.raison_non_retenable)));
  assert.match(r.rappel, /n'est pas une promesse/);
});

test("crédit : capital, échéance et frais d'emprunt (garantie sur le capital, dossier financé)", () => {
  const r = jouer(), c = r.detail.credit;
  const besoin = 200000 * 1.08 + 5000 - 30000;
  proche(c.capital, (besoin + 1000) / 0.99, 0.01, "capital");
  const i = 0.0327 / 12, n = 240, ech = c.capital * i / (1 - Math.pow(1 + i, -n));
  proche(c.mensualite, ech + c.capital * 0.003 / 12, 0.01, "mensualité avec assurance");
  proche(c.frais_emprunt, 1000 + c.capital * 0.01, 0.01, "frais d'emprunt");
  proche(r.detail.cout_total, 200000 * 1.08 + 5000, 0.01);
});

test("régimes : micro-foncier (30 %), micro-BIC (50 %), location nue au réel (déficit imputé sur le revenu global, plafonné), meublé au réel sans déficit d'amortissement", () => {
  const mf = jouer({ regime: "nu_micro" }).detail.locatif_annees[0];
  proche(mf.base_imposable, mf.loyers * 0.7, 0.01); proche(mf.impot, mf.loyers * 0.7 * (0.30 + 0.172), 0.01);
  const mb = jouer({ regime: "lmnp_micro" }).detail.locatif_annees[0];
  proche(mb.base_imposable, mb.loyers * 0.5, 0.01); proche(mb.impot, mb.loyers * 0.5 * (0.30 + 0.186), 0.01);
  const nr = jouer({ regime: "nu_reel", travaux: 30000, mobilier: 0 }).detail.locatif_annees[0];
  assert.ok(nr.impute_revenu_global > 0 && nr.impute_revenu_global <= 10700);
  proche(nr.impot, -nr.impute_revenu_global * 0.30, 0.01, "économie au TMI, sans prélèvements sociaux");
  const lr = jouer({ regime: "lmnp_reel" }).detail.locatif_annees;
  assert.ok(lr.every(a => a.base_imposable >= 0 && a.impot >= 0), "l'amortissement ne crée jamais de déficit");
  assert.ok(lr.some(a => a.amortissements_deduits > 0));
});

test("micro au-delà du plafond : le calcul passe au réel et le dit", () => {
  const r = jouer({ regime: "nu_micro", loyer_mensuel: 1500, prix: 400000, apport: 80000 });
  assert.equal(r.detail.regime, "nu_reel");
  assert.ok(r.avertissements.some(t => /micro-foncier n'est pas possible/.test(t)));
});

test("apport total : aucun crédit, aucune option à crédit même demandée", () => {
  const r = jouer({ apport: 260000, regime: "lmnp_micro", scpi_credit: true });
  assert.equal(r.detail.credit.capital, 0); assert.equal(r.detail.apport_utilise, 200000 * 1.08 + 5000);
  assert.ok(!opt(r, "SC"));
});

test("SCPI à crédit : option ajoutée sur demande, même budget versé pour toutes les options", () => {
  const r = jouer({ scpi_credit: true });
  assert.ok(opt(r, "SC")); assert.equal(opt(r, "SC").libelle, "SCPI à crédit");
  assert.ok(r.options.every(o => o.verse === r.options[0].verse));
});

test("textes : tutoiement, aucun « conseil », aucun nom de produit, avertissements dits (réintégration des amortissements, SCPI, frais)", () => {
  const r = jouer({ frais_av_pct: null }), tout = JSON.stringify({ p: r.reponse.phrase, c: r.ce_qui_changerait, a: r.avertissements });
  assert.ok(!/\bvous\b|\bvotre\b|conseil/i.test(tout));
  assert.ok(r.avertissements.some(t => /amortissements du bâti et des travaux/.test(t)));
  assert.ok(r.avertissements.some(t => /revenus étrangers/.test(t)));
  const r2 = jouer({ frais_av_pct: undefined });
  assert.ok(Array.isArray(r2.avertissements));
});

test("Monte-Carlo : bande ordonnée, probabilité dans [0, 1], mêmes tirages d'un appel à l'autre", () => {
  const o = { chemins: 300, graine: 7 }, a = jouer({}, o), b = jouer({}, o);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  for (const x of a.options) assert.ok(x.net.p10 <= x.net.p50 && x.net.p50 <= x.net.p90);
  assert.ok(a.reponse.probabilite_mieux >= 0 && a.reponse.probabilite_mieux <= 1);
  assert.ok(a.reponse.ecart.p10 <= a.reponse.ecart.p50 && a.reponse.ecart.p50 <= a.reponse.ecart.p90);
});

test("propriétés : un bien qui se revalorise plus favorise le locatif ; une distribution plus forte favorise les SCPI ; plus de vacance réduit l'avance du locatif à effort égal", () => {
  const o = { chemins: 200, graine: 3 };
  const bas = jouer({}, { ...o, hypotheses_classes: { immobilier_physique: { rendement: 1 } } }), haut = jouer({}, { ...o, hypotheses_classes: { immobilier_physique: { rendement: 4 } } });
  assert.ok(opt(haut, "L").net.p50 > opt(bas, "L").net.p50);
  assert.equal(opt(haut, "S").net.p50, opt(bas, "S").net.p50, "la revalorisation du bien ne touche pas les SCPI");
  assert.ok(opt(jouer({ scpi_taux_distribution_pct: 6 }, o), "S").net.p50 > opt(jouer({ scpi_taux_distribution_pct: 4 }, o), "S").net.p50);
  /* plus de vacance : plus d'effort, que les SCPI reçoivent aussi (effort égal) ; l'écart locatif − SCPI se réduit */
  const ecartLS = r => opt(r, "L").net.p50 - opt(r, "S").net.p50;
  assert.ok(ecartLS(jouer({ vacance_mois: 3 }, o)) < ecartLS(jouer({ vacance_mois: 0 }, o)));
});

test("pertinence : capacité d'épargne ou surplus de précaution, 18 ans ou plus ; sinon non pertinent", () => {
  const p = S.pertinence(E(), donnees(), TODAY);
  assert.equal(p.pertinent, true); assert.ok(p.raisons.length >= 1);
  const d = donnees(); d.config.projection.capacite_mensuelle = 0; d.positions = d.positions.filter(x => x.id !== "la");
  assert.equal(S.pertinence(E(), d, TODAY).pertinent, false);
});

test("préremplissage : taux du marché sur 20 ans, distribution publiée, prix de part = rendement central − distribution, vacance et frais par convention", () => {
  const pr = S.preremplir(E(), donnees(), TODAY);
  assert.equal(pr.taux_credit_pct, 3.27); assert.equal(pr.scpi_taux_distribution_pct, 4.91); assert.equal(pr.scpi_prix_part_pct, -0.41);
  assert.equal(pr.vacance_mois, 1); assert.equal(pr.scpi_frais_souscription_pct, 10); assert.equal(pr.regime, "lmnp_reel"); assert.equal(pr.duree_credit_ans, 20);
  assert.equal(pr.tmi, 30); assert.equal(pr.scpi_reinvestir, true); assert.equal(pr.scpi_credit, false);
  assert.equal(pr.prix, undefined); assert.equal(pr.loyer_mensuel, undefined);
});

/* ---------------------------------------------------------------- cas chiffrés indépendants (LOC-*) */
for (const c of FIXTURE.cas.filter(x => x.scenario === "locatif_scpi" && x.famille === "deterministe")) {
  test(c.id + " : " + c.nom, () => {
    const { data } = dataDe(c), r = S.jouer(entreeCatalogue("locatif_scpi"), data, c.reponses, c.today, { volatilite: 0 }), a = c.attendu, tol = c.tolerance;
    assert.equal(r.statut, "ok");
    proche(r.detail.credit.capital, a.capital, tol, "capital");
    proche(r.detail.verse_p50, a.verse, tol, "budget versé");
    for (const y of a.annees || []) {
      const x = r.detail.locatif_annees.find(z => z.annee === y.annee);
      for (const k of ["loyers", "impot", "cash_flow", "base_imposable", "impute_revenu_global"]) if (y[k] != null) proche(x[k], y[k], tol, "année " + y.annee + " " + k);
    }
    for (const [id, v] of Object.entries(a.net_courants)) proche(opt(r, id).net_courants_p50, v, tol, "net courant " + id);
    for (const [id, v] of Object.entries(a.net_auj)) proche(opt(r, id).net.p50, v, tol, "net d'aujourd'hui " + id);
    assert.equal(r.reponse.option_en_tete, a.option_en_tete);
  });
}

test("copie générée (projection-moteur.gen.js) : le scénario n° 20 donne exactement les mêmes résultats que l'app", () => {
  const G = MoteurGen.Scenarios, d = donnees();
  for (const o of [{ volatilite: 0 }, { chemins: 150, graine: 9 }]) {
    const a = S.jouer(E(), d, BASE, TODAY, o), b = G.jouer(E(), JSON.parse(JSON.stringify(d)), BASE, TODAY, o);
    assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)));
  }
});
