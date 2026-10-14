// PROJ : rétro-contrôle (couverture des bandes par la valeur réelle, cas BT-1 et BT-2), rejeu depuis des dates passées sur un historique fictif de 36 mois,
// plans figés (CK5) : figerPlan et comparerPlanReel sur des données fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cas, entreeDe, reperesComplets } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const P = req("../web/src/projection.js");
const Hist = req("../web/src/historique.js");
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b);
const R = reperesComplets();

test("BT-1 : couverture sur 10 dates — bornes incluses, non affichable sous 24 dates", () => {
  const c = cas("BT-1"), a = c.attendu, k = P.couverture(c.options.origines, { reperes: R });
  assert.equal(k.n, a.n); assert.equal(k.dans_p10_p90, a.dans_p10_p90); assert.equal(k.taux_p10_p90, a.taux_p10_p90);
  assert.equal(k.dans_p25_p75, a.dans_p25_p75); assert.equal(k.taux_p25_p75, a.taux_p25_p75);
  assert.equal(k.sous_p10, a.sous_p10); assert.equal(k.au_dessus_p90, a.au_dessus_p90); assert.equal(k.affichable, a.affichable); assert.equal(k.attendu_p10_p90, a.attendu_p10_p90);
  assert.match(P.phraseRetro(k), /Pas encore assez d'historique pour vérifier la projection/);
});
test("BT-2 : couverture sur 30 dates, affichable ; phrase de « Comment c'est calculé »", () => {
  const c = cas("BT-2"), a = c.attendu, k = P.couverture(c.options.origines, { reperes: R });
  assert.equal(k.n, a.n); assert.equal(k.dans_p10_p90, a.dans_p10_p90); assert.equal(k.taux_p10_p90, a.taux_p10_p90); assert.equal(k.au_dessus_p90, a.au_dessus_p90); assert.equal(k.affichable, true);
  const t = P.phraseRetro(k);
  assert.match(t, /Rejouée depuis 30 dates passées.*8 fois sur 10 \(attendu : 8 sur 10\).*indicatif/);
  assert.doesNotMatch(t, /trop étroites/);
  const mauvais = P.couverture(c.options.origines.map(o => ({ ...o, realise: 200 })), { reperes: R });
  assert.match(P.phraseRetro(mauvais), /bandes ont été trop étroites/);
  assert.equal(P.couverture([], { reperes: R }).taux_p10_p90, null);
  assert.equal(P.couverture(c.options.origines, { reperes: R.filter(r => r.cle !== "retro_min_origines") }).affichable, false, "repère manquant : jamais affichable");
});
test("retroControle : rejeu depuis chaque photo passée avec les flux observés, sur un historique fictif de 36 mois", () => {
  const points = [];
  let monde = 40000, obl = 10000;
  const d0 = "2023-09-30";
  const rendements = [0.012, -0.008, 0.02, 0.005, -0.015, 0.01, 0.007, 0.018, -0.004, 0.011, 0.003, 0.009];
  for (let k = 0; k <= 36; k++) {
    const date = P.__noop ? null : req("../web/src/projection-outils.js").ajouterMois(d0, k);
    points.push({ date, net: monde + obl, nature: "observe", byBloc: { Monde: Math.round(monde), Obligations: Math.round(obl) } });
    monde = monde * (1 + rendements[k % 12]) + 300; obl = obl * 1.003;
  }
  const fusion = Hist.fusionner(points, []);
  const flux = points.slice(1).map(p => ({ date: p.date, montant: 300 }));
  const d = entreeDe(cas("D-2"));
  const r = P.retroControle(d, fusion, { flux, chemins: 300, horizon_mois: 12 });
  assert.equal(r.origines.length, 25, "36 photos mensuelles : 25 origines avec une valeur réelle 12 mois plus tard");
  assert.ok(r.origines.every(o => o.p10 < o.p50 && o.p50 < o.p90 && o.realise > 0 && o.fin > o.date));
  assert.equal(r.couverture.n, 25); assert.equal(r.couverture.affichable, true);
  assert.ok(r.couverture.taux_p10_p90 >= 0.5, "taux " + r.couverture.taux_p10_p90);
  assert.match(r.phrase, /Rejouée depuis 25 dates passées/);
  const court = P.retroControle(d, { points: points.slice(0, 20) }, { flux, chemins: 100 });
  assert.equal(court.couverture.affichable, false); assert.match(court.phrase, /Pas encore assez d'historique/);
  assert.equal(JSON.stringify(P.retroControle(d, fusion, { flux, chemins: 100 })), JSON.stringify(P.retroControle(d, fusion, { flux, chemins: 100 })), "reproductible");
});

/* ---------------------------------------------------------------- plans figés */
function planDeDemo() {
  const c = cas("C-4"), d = entreeDe(c), options = { horizon_ans: 5, vue: "net", euros: "courants" };
  const M = P.preparer(d, options), s = P.simuler(M, { chemins: 400 });
  return { s, d, ligne: P.figerPlan({ data: d, options }, s, "revue_mensuelle") };
}
test("figerPlan : une ligne plans_figes avec de quoi rejouer (graine, version, hypothèses, événements, positions) et la série mensuelle P10 à P90", () => {
  const { s, ligne } = planDeDemo();
  assert.equal(ligne.raison, "revue_mensuelle"); assert.equal(ligne.horizon_mois, 60);
  const p = ligne.parametres;
  assert.equal(p.graine, 20261014); assert.equal(p.chemins, 400); assert.equal(p.version_modele, P.versionModele); assert.equal(p.today, "2026-10-14");
  assert.ok(p.hypotheses.reperes.some(r => r.cle === "inflation_hypothese" && r.verifie_le));
  assert.equal(p.evenements.length, 3); assert.equal(p.positions.length, 2); assert.equal(p.credits.length, 1);
  assert.ok(p.capacite.base && p.capacite.par_periode.length >= 3);
  assert.equal(ligne.serie.mois.length, 61); assert.equal(ligne.serie.p50.length, 61);
  assert.ok(ligne.serie.p10[60] < ligne.serie.p50[60] && ligne.serie.p50[60] < ligne.serie.p90[60]);
  assert.equal(ligne.serie.existant_p50.length, 61); assert.equal(ligne.serie.versements_cumules.length, 61);
  assert.ok(ligne.taille_octets < 100000 + 250000);
  assert.equal(P.figerPlan({ data: {}, options: {} }, s, "n'importe quoi").raison, "manuel");
});
test("figerPlan : rejouer avec les paramètres figés redonne la même série (graine, version, entrée)", () => {
  const { d, ligne, s } = planDeDemo();
  const rejoue = P.simuler(P.preparer(d, { horizon_ans: 5, vue: "net", euros: "courants" }), { chemins: ligne.parametres.chemins, graine: ligne.parametres.graine });
  assert.deepEqual(rejoue.vues.net.p50.slice(0, 61).map(x => Math.round(x * 100) / 100), ligne.serie.p50);
});
test("figerPlan : la série reste sous la limite de taille de la base (sinon un point par trimestre)", () => {
  const { s, d } = planDeDemo();
  const gros = JSON.parse(JSON.stringify(s));
  const N = 1200; gros.mois = Array.from({ length: N + 1 }, (_, i) => "2026-10-14"); ["p10", "p25", "p50", "p75", "p90"].forEach(k => { gros.vues.net[k] = Array.from({ length: N + 1 }, (_, i) => 123456.789 * (i + 1)); });
  gros.existant = { p50: Array.from({ length: N + 1 }, () => 100000.123) }; gros.epargne_future = { versements_cumules: Array.from({ length: N + 1 }, () => 5000.5) };
  const l = P.figerPlan({ data: d, options: { horizon_ans: 25 } }, gros, "manuel");
  assert.ok(JSON.stringify(l.serie).length <= P.PLAN_MAX_OCTETS);
});
test("comparerPlanReel : par mois, médiane et bande du plan contre la valeur réelle, écart en € et en %", () => {
  const { ligne } = planDeDemo();
  const reel = ligne.serie.mois.slice(0, 7).map((date, i) => ({ date: date.slice(0, 7) + "-28", valeur: ligne.serie.p50[i] * (i === 6 ? 0.8 : 1) }));
  const cmp = P.comparerPlanReel({ ...ligne, cree_le: "2026-10-14T20:00:00Z" }, reel);
  assert.equal(cmp.n, 7); assert.equal(cmp.cree_le, "2026-10-14T20:00:00Z"); assert.equal(cmp.version_modele, P.versionModele);
  const l1 = cmp.lignes[1];
  proche(l1.ecart, l1.reel - l1.plan_p50, 1e-9); proche(l1.ecart_pct, (l1.reel / l1.plan_p50 - 1) * 100, 1e-9); proche(l1.ecart_pct, 0, 1e-9);
  assert.equal(l1.dans_la_bande_p10_p90, true);
  const dernier = cmp.lignes[6];
  proche(dernier.ecart_pct, -20, 1e-6);
  assert.equal(dernier.dans_la_bande_p10_p90, false);
  assert.equal(cmp.dernier, dernier);
  assert.equal(P.comparerPlanReel(ligne, []).n, 0);
  assert.equal(P.comparerPlanReel(ligne, [{ date: "1999-01-31", valeur: 1 }, { date: "n'importe quoi", valeur: 2 }]).n, 0);
});
