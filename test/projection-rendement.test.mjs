// Rendement de la projection (web/src/projection.js, résultat.rendement) : rendement annualisé pondéré par le temps (TWR), net de frais et avant impôts, du portefeuille de placements
// (comptes courants exclus), par chemin puis en centiles P10 à P90 : sur tout l'horizon, à chaque mois (cumulé et annualisé) et année par année, en nominal et en euros d'aujourd'hui (réel) ;
// et rendement attendu de l'allocation actuelle (moyenne pondérée des hypothèses de classe, nette de frais). Cas déterministes calculés à la main, Monte-Carlo à graine fixe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cas, entreeDe } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const P = req("../web/src/projection.js");

const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b + " (tolérance " + tol + ")");
const copie = x => JSON.parse(JSON.stringify(x));
const reperes = (data, remplace) => { remplace.forEach(([cle, valeur]) => { data.reperes = data.reperes.map(r => (r.cle === cle ? { ...r, valeur } : r)); }); return data; };
/** MC-8 (100 000 € en actions, compte-titres, sans frais ni flux) avec inflation et hypothèses réglables. */
function entree(extra) {
  const c = cas("MC-8"), x = extra || {};
  const data = reperes(entreeDe(c), [["inflation_hypothese", x.inflation == null ? 2 : x.inflation]]);
  if (x.data) x.data(data);
  return { data, options: { ...c.options, ...(x.options || {}) } };
}
const sim = (e, o) => { const M = P.preparer(e.data, e.options); return P.simuler(M, o || { volatilite: 0 }); };
const deux = e => { /* 60 000 € en actions et 40 000 € en obligations, mêmes enveloppe et frais nuls */
  e.data.positions[0].value = 60000; e.data.positions[0].qty = 600;
  e.data.positions.push({ id: "ob", name: "Fonds obligations", envelope: "Compte-titres Exemple", owner: "p1", bloc: "Obligations", mode: "manual", value: 40000, valueDate: "2026-09-30", status: "actif", qty: 400, pru: 100 });
  return e;
};

/* ================================================================== déterministe : égal à l'hypothèse, nette de frais */
test("RD-1 : 100 % actions à 7 %, sans frais ni flux — TWR annualisé de 7,000 % sur l'horizon et chaque année ; réel avec 2 % d'inflation = 1,07 / 1,02 − 1", () => {
  const e = entree({ options: { hypotheses_classes: { actions: { rendement: 7, volatilite: 15 } } } }), r = sim(e).rendement;
  assert.equal(r.horizon.ans, 10);
  for (const k of ["p10", "p25", "p50", "p75", "p90"]) {
    proche(r.horizon.nominal[k], 7, 1e-9, "horizon nominal " + k);
    proche(r.horizon.reel[k], (1.07 / 1.02 - 1) * 100, 1e-9, "horizon réel " + k);
  }
  assert.equal(r.par_annee.annees.length, 10);
  r.par_annee.nominal.p50.forEach((v, i) => proche(v, 7, 1e-9, "année " + (i + 1)));
  r.par_annee.reel.p50.forEach((v, i) => proche(v, (1.07 / 1.02 - 1) * 100, 1e-9, "année réelle " + (i + 1)));
  /* volatilité nulle : P10 = P90 */
  proche(r.horizon.nominal.p10, r.horizon.nominal.p90, 1e-12);
});
test("RD-2 : le rendement attendu de l'allocation actuelle vaut l'hypothèse nette de frais (7 % et 0,5 % de frais : 1,07 × 0,995 − 1 = 6,465 %) — et le TWR déterministe aussi", () => {
  const e = entree({ options: { hypotheses_classes: { actions: { rendement: 7, volatilite: 15 } } }, data: d => { d.positions[0].ter = 0.5; } }), r = sim(e).rendement;
  proche(r.attendu.nominal_pct, 6.465, 1e-9); proche(r.attendu.reel_pct, (1.06465 / 1.02 - 1) * 100, 1e-9);
  proche(r.horizon.nominal.p50, 6.465, 1e-9, "TWR net de frais"); proche(r.par_annee.nominal.p50[0], 6.465, 1e-9);
  proche(r.attendu.frais_pct, 0.5, 1e-12);
});
test("RD-3 : deux classes (60 % actions à 7 %, 40 % obligations à 3 %), sans flux — année 1 = 0,6 × 7 + 0,4 × 3 = 5,4 % ; sur T ans, (0,6 × 1,07^T + 0,4 × 1,03^T)^(1/T) − 1 ; attendu = 5,4 %", () => {
  const e = deux(entree({ inflation: 0, options: { horizon_ans: 5, hypotheses_classes: { actions: { rendement: 7, volatilite: 15 }, obligations: { rendement: 3, volatilite: 6 } } } })), r = sim(e).rendement;
  proche(r.attendu.nominal_pct, 5.4, 1e-9); proche(r.par_annee.nominal.p50[0], 5.4, 1e-9, "année 1");
  /* année 2 : les poids ont dérivé (0,6 × 1,07 = 0,642 ; 0,4 × 1,03 = 0,412) → (0,642 × 7 + 0,412 × 3) / 1,054 */
  proche(r.par_annee.nominal.p50[1], (0.642 * 7 + 0.412 * 3) / 1.054, 1e-9, "année 2");
  const T = 5, ann = (Math.pow(0.6 * Math.pow(1.07, T) + 0.4 * Math.pow(1.03, T), 1 / T) - 1) * 100;
  proche(r.horizon.nominal.p50, ann, 1e-9, "annualisé sur 5 ans");
  /* à chaque mois, le cumulé et l'annualisé disent la même chose */
  const t = 30; proche((Math.pow(1 + r.cumule.nominal.p50[t] / 100, 12 / t) - 1) * 100, r.annualise.nominal.p50[t], 1e-9);
  assert.equal(r.annualise.nominal.p50[0], null); assert.equal(r.cumule.nominal.p50[0], 0);
});
test("RD-4 : les comptes courants sont hors du portefeuille mesuré (50 000 € sur un compte courant à 0 % ne diluent ni le rendement mesuré ni l'attendu)", () => {
  const e = entree({ options: { hypotheses_classes: { actions: { rendement: 7, volatilite: 15 } } }, data: d => {
    d.positions.push({ id: "cc", name: "Compte courant", envelope: "Compte courant", owner: "p1", bloc: "Comptes courants", mode: "manual", value: 50000, valueDate: "2026-09-30", status: "actif" });
  } }), r = sim(e).rendement;
  proche(r.horizon.nominal.p50, 7, 1e-9); proche(r.attendu.nominal_pct, 7, 1e-9);
});
test("RD-5 : les versements ne font pas le rendement — 1 000 € par mois placés en actions, le TWR reste 7,000 % (le capital grossit, pas le taux)", () => {
  const e = entree({ options: { capacite_mensuelle: 1000, reste_capacite: "cible", hypotheses_classes: { actions: { rendement: 7, volatilite: 15 } } } }), res = sim(e), r = res.rendement;
  assert.ok(res.vues.financier.p50[120] > 250000, "le capital a bien grossi grâce aux versements : " + res.vues.financier.p50[120]);
  proche(r.horizon.nominal.p50, 7, 1e-9); r.par_annee.nominal.p50.forEach(v => proche(v, 7, 1e-9));
});
test("RD-6 : portefeuille vide de placements (rien que du courant) — rendement indisponible, jamais un 0 % inventé", () => {
  const e = entree({ data: d => { d.positions = [{ id: "cc", name: "Compte courant", envelope: "Compte courant", owner: "p1", bloc: "Comptes courants", mode: "manual", value: 5000, valueDate: "2026-09-30", status: "actif" }]; } });
  const r = sim(e).rendement;
  assert.equal(r.disponible, false); assert.equal(r.attendu.nominal_pct, null); assert.equal(r.horizon.nominal.p50, null);
  assert.match(r.raison, /placement/);
});
test("RD-7 : les hypothèses de chaque classe (rendement central et volatilité) sont rendues pour comparer le réel au modèle ; le compte courant à 0 %", () => {
  const r = sim(entree()).rendement;
  assert.equal(r.classes.courant.rendement, 0); assert.equal(r.classes.courant.volatilite, 0);
  assert.equal(r.classes.actions.rendement, 6, "repère rendement_central_actions");
  assert.ok(r.classes.obligations.volatilite > 0 && r.classes.fonds_euros.volatilite === 0);
  assert.ok(!("levier" in r.classes), "pas de levier sans ligne à levier");
});

/* ================================================================== Monte-Carlo à graine fixe */
const mc = (extra, opts) => { const c = cas("MC-1"), x = extra || {}; const data = reperes(entreeDe(c), [["inflation_hypothese", x.inflation == null ? 2 : x.inflation]]); return P.simuler(P.preparer(data, { ...c.options, ...(x.options || {}) }), opts || { chemins: 2000, graine: 20261014 }); };
test("RD-8 : 100 000 € en actions (7 %, 15 %), 2 000 chemins, graine fixe — rendement annualisé sur 10 ans : P50 ≈ 7 %, P10 ≈ 0,69 %, P90 ≈ 13,71 % (exp(10 ln 1,07 ± 1,2816 × 0,15 √10) → ^(1/10))", () => {
  const r = mc().rendement, h = r.horizon.nominal;
  proche(h.p50, 7, 0.35, "P50"); proche(h.p10, 0.6893, 0.6, "P10"); proche(h.p90, 13.7062, 0.6, "P90");
  assert.ok(h.p10 < h.p25 && h.p25 < h.p50 && h.p50 < h.p75 && h.p75 < h.p90, "ordonnés");
  const re = r.horizon.reel;
  proche(re.p50, (1.07 / 1.02 - 1) * 100, 0.35, "P50 réel"); proche((1 + h.p50 / 100) / (1 + re.p50 / 100), 1.02, 1e-9, "réel = nominal / inflation, à chaque centile");
  proche((1 + h.p10 / 100) / (1 + re.p10 / 100), 1.02, 1e-9);
});
test("RD-9 : année par année, la bande est large et la même chaque année (année 1 : exp(ln 1,07 ± 1,2816 × 0,15) − 1 = −11,71 % à +29,68 %) ; elle se resserre quand l'horizon s'allonge", () => {
  const r = mc().rendement, a1 = r.par_annee;
  proche(a1.nominal.p10[0], -11.7127, 1.8, "année 1, P10"); proche(a1.nominal.p90[0], 29.6789, 2.5, "année 1, P90");
  const a = r.annualise.nominal;
  assert.ok(a.p90[12] - a.p10[12] > a.p90[60] - a.p10[60] && a.p90[60] - a.p10[60] > a.p90[120] - a.p10[120], "la fourchette annualisée se resserre avec la durée");
  proche(a.p90[120], r.horizon.nominal.p90, 1e-12, "l'horizon est le dernier mois annualisé");
});
test("RD-10 : valeurs figées à la graine 20261014 (non-régression, 2 000 chemins) et reproductibilité à l'octet près ; une autre graine donne d'autres centiles", () => {
  const a = mc(), b = mc();
  assert.equal(JSON.stringify(a.rendement), JSON.stringify(b.rendement));
  const h = a.rendement.horizon.nominal, arr = x => Math.round(x * 1e4) / 1e4;
  assert.deepEqual({ p10: arr(h.p10), p50: arr(h.p50), p90: arr(h.p90) }, { p10: 0.5167, p50: 7.0666, p90: 13.7416 }, "rendement annualisé sur 10 ans, graine 20261014 (théorie : 0,69 / 7,00 / 13,71)");
  assert.notEqual(JSON.stringify(mc({}, { chemins: 2000, graine: 1 }).rendement.horizon), JSON.stringify(a.rendement.horizon));
  assert.equal(a.chemins, 2000);
});
test("RD-11 : le rendement mesuré est indépendant de l'euro affiché (constants ou courants) et du périmètre de la vue (financier ou net) : c'est celui des placements", () => {
  const f = mc({ options: { vue: "financier", euros: "courants" } }).rendement, n = mc({ options: { vue: "net", euros: "constants" } }).rendement;
  assert.equal(JSON.stringify(f.horizon), JSON.stringify(n.horizon));
});

/* ================================================================== le résultat et l'existant */
test("RD-12 : le résultat porte la méthode, l'unité et ce qui est exclu (net de frais, avant impôts, placements hors comptes courants)", () => {
  const r = sim(entree()).rendement;
  assert.equal(r.methode, "twr_net_de_frais"); assert.equal(r.unite, "pct_par_an"); assert.equal(r.avant_impots, true);
  assert.match(r.perimetre, /placements/); assert.match(r.perimetre, /comptes courants/);
  assert.equal(r.inflation_pct, 2);
  assert.equal(r.mois.length, 121);
});
test("RD-13 : la garde-fou « rendement implicite » est inchangée (même fonction, mêmes seuils) et rendementAttendu reste exporté", () => {
  assert.equal(typeof P.rendementAttendu, "function");
  const M = P.preparer(entree().data, entree().options);
  proche(P.rendementAttendu(M.comps), 6, 1e-9, "100 % actions à 6 % (repère rendement_central_actions), courant à 0 pesant 0");
});

/* ================================================================== outils */
test("RD-14 : la sélection des rangs donne exactement les valeurs du tri (tableaux aléatoires, valeurs égales, rangs aux extrémités)", () => {
  let seed = 12345; const alea = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let k = 0; k < 300; k++) {
    const m = 3 + Math.floor(alea() * 400), x = Float64Array.from({ length: m }, () => Math.round(alea() * (k % 3 === 0 ? 8 : 1e6))), rs = [0, Math.floor(m * 0.1), Math.floor(m * 0.25), Math.floor(m * 0.5), Math.floor(m * 0.9), m - 1]
      .filter((v, i, l) => l.indexOf(v) === i).sort((a, b) => a - b);
    const out = new Float64Array(rs.length), y = Float64Array.from(x), z = Float64Array.from(x).sort();
    P._selectionnerRangs(y, rs, out);
    rs.forEach((r, i) => assert.equal(out[i], z[r], "rang " + r + " sur " + m));
  }
});
test("RD-15 : un plan figé range ce que le modèle attendait du rendement (hypothèses de classe, attendu net de frais, médiane annualisée et bande), de quoi comparer plus tard le réel à l'attendu", () => {
  const e = entree({ options: { hypotheses_classes: { actions: { rendement: 7, volatilite: 15 } } } }), M = P.preparer(e.data, e.options), s = P.simuler(M, { chemins: 300 });
  const ligne = P.figerPlan({ data: e.data, options: e.options }, s, "manuel"), rd = ligne.parametres.rendement;
  proche(rd.attendu_nominal_pct, 7, 1e-4); proche(rd.attendu_reel_pct, (1.07 / 1.02 - 1) * 100, 1e-4); assert.equal(rd.classes.actions.rendement, 7); assert.equal(rd.classes.actions.volatilite, 15);
  assert.equal(rd.horizon_ans, 10); assert.ok(rd.horizon_nominal.p10 < rd.horizon_nominal.p50 && rd.horizon_nominal.p50 < rd.horizon_nominal.p90);
  assert.ok(ligne.taille_octets < P.PLAN_MAX_OCTETS + P.PLAN_PARAMETRES_MAX_OCTETS, "toujours sous les limites de la base");
});
test("RD-16 : la version du modèle est incrémentée (proj-1.3.0, enveloppe_scenario de SCN1) puisque le résultat porte un nouveau calcul", () => {
  assert.equal(P.versionModele, "proj-1.3.0");
});
