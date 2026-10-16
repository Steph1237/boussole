// HIS2, tâche 13 : Rendement.pointsEtFlux lit les photos reconstituées (avant la première photo observée, avec leur qualité) en plus des relevés de la nuit ;
// une photo « estime » rend les périodes qui la contiennent « approchées ». Cas P1 / P2 de test/fixtures/his2-cas.json. Données fictives.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cas } from "./helpers/his2.mjs";
import { mouvementsDe } from "./helpers/his2-reconstitution.mjs";

const req = createRequire(import.meta.url);
const R = req("../web/src/rendement.js");
const AUJ = "2026-10-16";
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b);
const photo = (date, financier, qualite = "complet", bloc = "Monde") => ({ date, mois: date.slice(0, 8) + "01", financier, total: financier, p1: financier, p2: 0, byBloc: { p1: { [bloc]: financier }, p2: {} }, qualite, partEstimee: qualite === "estime" ? 0.5 : 0 });
const etat = (id, extra = {}) => { const c = cas(id); return { scope: "foyer", positions: c.entree.positions, snapshots: [], tx: mouvementsDe(id.split("/")[0], c.entree.positions), classes: {}, ...extra }; };

test("P1 : les photos reconstituées sont les points de valeur ; TWR de la fixture (+9,15 %) avec les flux de l'import, hors comptes courants", () => {
  const S = etat("P1/flux", { photosReconstituees: [photo("2023-12-31", 0), photo("2024-01-31", 960), photo("2024-02-29", 2000), photo("2024-03-31", 1575)] });
  const pf = R.pointsEtFlux(S, "foyer", AUJ);
  assert.deepEqual(pf.points.slice(0, 4).map(p => [p.date, p.valeur]), [["2023-12-31", 0], ["2024-01-31", 960], ["2024-02-29", 2000], ["2024-03-31", 1575]]);
  assert.ok(pf.points.slice(0, 4).every(p => !p.estime), "photos complètes : points mesurés");
  assert.deepEqual(pf.flux.map(f => f.montant), [951, 981, -519]);
  const t = R.twr(pf.points.slice(0, 4), pf.flux);
  proche(t.cumule, cas("P1/twr").attendu.cumule, 1e-6, "P1 cumulé");
  assert.ok(pf.notes.some(n => /passé reconstitué à partir de tes imports \(4 photos mensuelles\)/.test(n)), JSON.stringify(pf.notes));
  assert.equal(pf.allocations.length, 4, "les poches des photos servent à l'allocation de départ");
});
test("l'observé gagne : une photo reconstituée à la date de la première photo observée ou après est ignorée", () => {
  const S = etat("P1/flux", { snapshots: [{ date: "2024-02-29", foyer: 2010, p1: 2010, p2: 0, byBloc: { p1: { Monde: 2010 }, p2: {} } }],
    photosReconstituees: [photo("2024-01-31", 960), photo("2024-02-29", 2000), photo("2024-03-31", 1575)] });
  const pf = R.pointsEtFlux(S, "foyer", AUJ);
  assert.deepEqual(pf.points.slice(0, 2).map(p => [p.date, p.valeur]), [["2024-01-31", 960], ["2024-02-29", 2010]]);
  assert.equal(pf.points.filter(p => p.date === "2024-03-31").length, 0);
});
test("périmètre d'une personne : p1 lit p1 de la photo, p2 ne voit rien", () => {
  const S = etat("P1/flux", { photosReconstituees: [photo("2024-01-31", 960), photo("2024-02-29", 2000)] });
  assert.deepEqual(R.pointsEtFlux(S, "p1", AUJ).points.slice(0, 2).map(p => p.valeur), [960, 2000]);
  assert.equal(R.pointsEtFlux(S, "p2", AUJ).points.filter(p => p.date < "2026").map(p => p.valeur).reduce((a, b) => a + b, 0), 0);
});
test("comptes courants retirés des photos comme des relevés de la nuit", () => {
  const ph = { ...photo("2024-01-31", 3160), byBloc: { p1: { Monde: 960, "Comptes courants": 2200 }, p2: {} } };
  const pf = R.pointsEtFlux(etat("P1/flux", { photosReconstituees: [ph] }), "foyer", AUJ);
  assert.equal(pf.points[0].valeur, 960);
});
test("une photo « estime » rend le point estimé et la période qui le contient « approchée » ; complet ou partiel : statut inchangé", () => {
  const dates = ["2023-12-31", "2024-01-31", "2024-02-29", "2024-03-31"], vals = [0, 960, 2000, 1575];
  const mk = q => etat("P1/flux", { photosReconstituees: dates.map((d, i) => photo(d, vals[i], d === "2024-02-29" ? q : "complet")) });
  const mesure = S => { const pf = R.pointsEtFlux(S, "foyer", AUJ); return R.mesurer({ points: pf.points, flux: pf.flux, debut: "2023-12-31", fin: "2024-03-31", versementsConnus: pf.versementsConnus }); };
  const ok = mesure(mk("complet")), partiel = mesure(mk("partiel")), estime = mesure(mk("estime"));
  assert.equal(ok.statut, "ok");
  assert.equal(partiel.statut, "ok");
  assert.equal(estime.statut, "approche");
  assert.ok(estime.notes.some(n => /reconstituée surtout à partir d'estimations/.test(n)));
  proche(estime.twr_periode_pct, ok.twr_periode_pct, 1e-9, "le chiffre ne change pas, seul le statut");
  // la période qui ne contient pas le point estimé reste « ok »
  const pf = R.pointsEtFlux(mk("estime"), "foyer", AUJ);
  assert.equal(R.mesurer({ points: pf.points, flux: pf.flux, debut: "2024-03-31", fin: "2024-03-31", versementsConnus: true }).statut, "insuffisant");
});
test("doublon_de et espèces non suivies : les flux de l'import sont ceux du tableau § 4.4 (D1 : seul l'ordre compte)", () => {
  const c = cas("D1/flux"), S = { scope: "foyer", positions: c.entree.positions, snapshots: [], tx: c.entree.tx, classes: {}, photosReconstituees: [photo("2026-08-31", 100)] };
  const pf = R.pointsEtFlux(S, "foyer", AUJ);
  assert.deepEqual(pf.flux, [{ date: "2026-09-08", montant: 500 }]);
});
test("les transactions lues par SerieNet depuis le début des imports complètent celles du store (dernières 60), sans doublon", () => {
  const c = cas("P1/flux");
  const S = etat("P1/flux", { tx: mouvementsDe("P1", c.entree.positions).slice(2) }); // le store n'a gardé que la plus récente
  assert.deepEqual(R.pointsEtFlux(S, "foyer", AUJ).flux.map(f => f.montant), [-519]);
  const SN = { hist: { tx: mouvementsDe("P1", c.entree.positions) } };
  globalThis.SerieNet = SN;
  try { assert.deepEqual(R.pointsEtFlux(S, "foyer", AUJ).flux.map(f => f.montant), [951, 981, -519]); } finally { delete globalThis.SerieNet; }
});
test("sans photo reconstituée ni SerieNet : comportement inchangé (aucune note, aucun point estimé)", () => {
  const pf = R.pointsEtFlux(etat("P1/flux"), "foyer", AUJ);
  assert.deepEqual(pf.notes, []);
  assert.ok(pf.points.every(p => !p.estime && !p.reconstitue));
});
