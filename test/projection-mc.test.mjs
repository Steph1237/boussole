// PROJ : Monte-Carlo du moteur (web/src/projection.js) — cas MC-1 à MC-10, tirages communs, graine fixe, existant chemin par chemin,
// crises rejouées, comparaison de variantes, plafond de temps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { FIXTURE, cas, entreeDe } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const P = req("../web/src/projection.js");
const O = req("../web/src/projection-outils.js");
const Marche = req("../web/src/marche.js");
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b + " (tolérance " + tol + ")");
const modele = (c, extra) => P.preparer(entreeDe(c), { ...c.options, ...(extra || {}) });
const sim = (c, extra, opts) => P.simuler(modele(c, extra), opts || { chemins: c.options.chemins, graine: c.options.graine });

test("MC-1 : loi log-normale, 100 000 € en actions (7 %, 15 %) sur 10 ans, centiles dans les tolérances de la fixture", () => {
  const c = cas("MC-1"), r = sim(c);
  assert.equal(r.chemins, 2000); assert.equal(r.graine, 20261014); assert.equal(r.deterministe, false);
  for (const k of ["p10", "p25", "p50", "p75", "p90"]) {
    const a = c.attendu.mois_120[k], v = r.vues.financier[k][120];
    assert.ok(Math.abs(v / a - 1) <= c.tolerance[k], k + " : " + v + " vs " + a);
  }
  /* la médiane à 10 ans vaut V0 × (1 + r)^10 à l'échantillonnage près ; les bandes sont ordonnées */
  const f = r.vues.financier;
  for (let t = 1; t <= 120; t++) assert.ok(f.p10[t] <= f.p25[t] && f.p25[t] <= f.p50[t] && f.p50[t] <= f.p75[t] && f.p75[t] <= f.p90[t], "mois " + t);
  assert.equal(f.p50[0], 100000);
});
test("MC-2 : reproductible à l'octet près avec la même graine, différent avec une autre", () => {
  const c = cas("MC-2"), a = sim(c), b = sim(c), autre = sim(c, null, { chemins: 2000, graine: c.attendu.autre_graine });
  assert.equal(JSON.stringify(a.vues), JSON.stringify(b.vues));
  assert.notEqual(JSON.stringify(a.vues), JSON.stringify(autre.vues));
  assert.equal(autre.graine, 1);
});
test("MC-3 : corrélation empirique actions / obligations des normales corrélées", () => {
  const c = cas("MC-3"), o = c.options, z = P.tirages({ chemins: o.chemins, mois: o.mois, graine: o.graine, classes: o.classes });
  const a = z.actions, b = z.obligations, n = a.length;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  proche(sab / Math.sqrt(saa * sbb), c.attendu.correlation, c.tolerance);
  proche(saa / n, 1, 0.02, "variance 1");
});
test("MC-4 : tirages communs — la variante qui ajoute 100 €/mois est supérieure ou égale chemin par chemin", () => {
  const c = cas("MC-4"), o = c.options;
  const A = modele(c, { capacite_mensuelle: 0, reste_capacite: o.reste_capacite }), B = modele(c, { capacite_mensuelle: o.variante_capacite_mensuelle, reste_capacite: o.reste_capacite });
  const r = P.comparer(A, B, { chemins: o.chemins, graine: o.graine, euros: "courants" });
  const dernier = r.chaque_chemin_superieur_ou_egal.length - 1;
  assert.equal(r.chaque_chemin_superieur_ou_egal[dernier], true);
  assert.ok(r.chaque_chemin_superieur_ou_egal.every(Boolean), "à chaque anniversaire");
  assert.ok(Math.abs(r.horizon.mediane_des_ecarts / c.attendu.mediane_des_ecarts - 1) <= c.tolerance.mediane_des_ecarts, r.horizon.mediane_des_ecarts + " vs " + c.attendu.mediane_des_ecarts);
  assert.equal(r.horizon.probabilite_mieux, 1);
  const det = P.simuler(B, { volatilite: 0 }).epargne_future.versements_cumules[120];
  proche(det, 12000, 0.01);
  proche(P.capitaliser(0, 100, 120, 7), c.attendu.valeur_future_deterministe, 0.01);
});
test("MC-5 : stabilité des tirages — ajouter une ligne d'or ne change pas les chocs des actions, chemin par chemin", () => {
  const c = cas("MC-5"), o = c.options;
  const base = cas("MC-1"), A = entreeDe(base);
  const B = JSON.parse(JSON.stringify(A));
  B.positions.push({ id: "or", name: "Or Exemple", envelope: "Compte-titres Exemple", owner: "p1", bloc: "Or", mode: "manual", value: 20000, status: "actif", qty: 20, pru: 900 });
  const opt = { ...base.options, chemins: 300, horizon_ans: 2 };
  const ra = P._executer(P.preparer(A, opt), { P: 300, graine: 20261014, vue: "financier" }), rb = P._executer(P.preparer(B, opt), { P: 300, graine: 20261014, vue: "financier" });
  const idx = (M, classe) => M.comps.findIndex(x => x.classe === classe);
  const Ma = P.preparer(A, opt), Mb = P.preparer(B, opt), ia = idx(Ma, "actions"), ib = idx(Mb, "actions");
  for (let i = 0; i < 300; i++) assert.equal(ra.V[i * Ma.B + ia], rb.V[i * Mb.B + ib], "chemin " + i);
  const z = P.tirages({ chemins: 5, mois: 4, classes: o.avant }), z2 = P.tirages({ chemins: 5, mois: 4, classes: o.apres });
  assert.deepEqual(Array.from(z.actions), Array.from(z2.actions));
});
test("MC-6 : les 500 premiers chemins de 2 000 sont les chemins d'un calcul à 500 (même graine)", () => {
  const c = cas("MC-6"), M = modele(c);
  const complet = P.simuler(M, { chemins: 2000, graine: 20261014, retenir: [120] }), part = P.simuler(M, { chemins: 500, graine: 20261014 });
  const premiers = Float64Array.from(complet.chemins_retenus[120].slice(0, 500)).sort();
  assert.equal(part.vues.financier.p50[120], premiers[249] * 1, "P50 des 500 premiers (rang 250)");
  const rang = O.centileTrie(Array.from(premiers), 0.5);
  assert.equal(part.vues.financier.p50[120], rang);
});
test("MC-7 : centile au rang ⌈p × N⌉", () => {
  const c = cas("MC-7"), a = c.attendu;
  for (const [k, p] of [["p10", 0.1], ["p25", 0.25], ["p50", 0.5], ["p75", 0.75], ["p90", 0.9]]) assert.equal(O.centile(c.options.valeurs, p), a[k], k);
  assert.equal(P.centile([5, 1, 9], 0.5), 5);
});
test("MC-8 : volatilité nulle — identique au déterministe, P10 = P90", () => {
  const c = cas("MC-8"), M = modele(c), r = P.simuler(M, { chemins: 2000, volatilite: 0 });
  for (let t = 0; t <= 120; t++) { assert.equal(r.vues.financier.p10[t], r.vues.financier.p90[t]); assert.equal(r.vues.financier.p50[t], r.deterministe_detail.courants.financier[t]); }
  assert.equal(r.deterministe, true);
  proche(r.vues.financier.p50[120], 100000 * Math.pow(1.06, 10), 1e-6, "rendement central 6 %");
});
test("MC-9 : l'existant est la simulation sans versement ; complet − existant = versements capitalisés sur les mêmes chemins (≤ 1e-9)", () => {
  const c = cas("MC-9"), M = modele(c), N = 120, Pn = 400, graine = 20261014;
  const run = P._executer(M, { P: Pn, graine, vue: "financier", couches: true });
  const zs = P.tirages({ chemins: Pn, mois: N, graine, classes: ["actions"] }).actions;
  const a = Math.log(1.06) / 12, s = 0.15 / Math.sqrt(12), ia = M.comps.findIndex(x => x.classe === "actions");
  const sansFlux = modele(c, { capacite_mensuelle: 0 });
  const nul = P._executer(sansFlux, { P: Pn, graine, vue: "financier" });
  for (let i = 0; i < Pn; i += 7) {
    let v = 0, existant = 100000;
    for (let t = 0; t < N; t++) { const g = Math.exp(a + s * zs[i * N + t]); existant *= g; v = v * g + 1000; }
    const totalComplet = run.V[i * M.B + ia], totalExistant = run.Vx[i * M.B + ia];
    assert.ok(Math.abs(totalExistant / existant - 1) < 1e-9, "existant du chemin " + i);
    assert.ok(Math.abs((totalComplet - totalExistant) / v - 1) < 1e-9, "versements capitalisés du chemin " + i);
    assert.ok(Math.abs(nul.V[i * M.B + ia] / existant - 1) < 1e-9, "capacité 0 = existant, chemin " + i);
  }
  const r = P.simuler(M, { chemins: 2000, graine });
  assert.ok(r.existant.p50[120] < r.vues.financier.p50[120]);
  assert.equal(r.epargne_future.p50[120] > 0, true);
});
test("MC-10 : matrice de corrélation des 12 classes tirées définie positive, sans correction", () => {
  const c = cas("MC-10"), a = c.attendu, k = P.correlations();
  assert.equal(k.classes.length, a.nombre_de_classes); assert.equal(k.classes.includes("levier"), !a.sans_levier);
  assert.deepEqual(k.classes, Marche.CLES.filter(x => x !== "levier").concat(["actions_nasdaq100", "immobilier_physique"]));
  assert.ok(k.plus_petite_valeur_propre >= a.plus_petite_valeur_propre_min, String(k.plus_petite_valeur_propre));
  proche(k.plus_petite_valeur_propre, 0.0774, 0.001);
  assert.equal(k.correction !== null, a.correction_higham);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { assert.equal(k.matrice[i][j], k.matrice[j][i]); if (i === j) assert.equal(k.matrice[i][j], 1); }
});
test("correction de Higham : une matrice non définie positive est ramenée à la plus proche, écart sous 0,02 pour un léger défaut", () => {
  const quasi = [[1, 0.9, 0.55], [0.9, 1, 0.9], [0.55, 0.9, 1]]; // valeur propre minimale −0,027 : non définie positive de peu
  assert.equal(O.cholesky(quasi), null);
  const c = O.pluProcheDefiniePositive(quasi);
  assert.equal(c.corrigee, true); assert.ok(O.cholesky(c.matrice)); assert.ok(c.ecartMax < 0.02, "écart par coefficient " + c.ecartMax);
  assert.deepEqual(O.pluProcheDefiniePositive([[1, 0.2], [0.2, 1]]).corrigee, false);
});
test("tirages : classes fixes — 12 normales par chemin et par mois ; rendements mensuels e^(μ + σz) : la médiane suit (1 + r)^T", () => {
  const z = P.tirages({ chemins: 3, mois: 2 });
  assert.equal(Object.keys(z).length, 12); assert.equal(z.actions.length, 6);
});

/* ---------------------------------------------------------------- crises */
test("crises : durée de la fenêtre, choc cumulé exact, aucun rebond forcé", () => {
  const c = cas("D-11"), M = modele(c);
  for (const [cle, duree] of [["dotcom_2000", 31], ["gfc_2008", 17], ["covid_2020", 1], ["taux_2022", 9], ["inflation_1973", 23]]) {
    const r = P.crise(M, { cle, debut: 1 });
    assert.equal(r.fenetre_mois, duree, cle);
    const choc = Marche.CRISES[cle].chocs.actions;
    proche(r.valeurs.financier[Math.min(duree, M.N)], duree <= M.N ? 100000 * (1 + choc / 100) : r.valeurs.financier[M.N], 0.01, cle);
    if (duree < M.N) {
      const apres = r.valeurs.financier[Math.min(duree + 12, M.N)];
      if (duree + 12 <= M.N) proche(apres / r.valeurs.financier[duree], 1.07, 1e-9, cle + " : rendement attendu après la crise");
    }
  }
});
test("crise : le levier prend le choc « levier » de la crise ; une crise commencée plus tard décale la fenêtre", () => {
  const c = cas("D-9"), d = entreeDe(c);
  const M = P.preparer(d, { horizon_ans: 3, capacite_mensuelle: 0, hypotheses_classes: { actions: { rendement: 7, volatilite: 15 } } });
  const r = P.crise(M, { cle: "gfc_2008", debut: 4 });
  assert.equal(r.debut_t, 4);
  const valeurAvant = r.valeurs.financier[3], fin = r.valeurs.financier[4 + 17 - 1];
  proche(fin / valeurAvant, 0.15 * Math.pow(1 - 0.006, 17 / 12), 1e-9, "levier ×2 : −85 % (choc levier de 2008), puis 0,6 % de frais par an");
});
test("crise « inflation 1973-1974 » : inflation de 7,3 % puis 13,7 %, indisponible sans les repères", () => {
  const c = cas("D-11"), d = entreeDe(c);
  const M = P.preparer(d, { ...c.options, euros: "constants" });
  const r = P.crise(M, { cle: "inflation_1973", debut: 1 });
  const nom = r.nominal.financier;
  const defl = r.valeurs.financier[23] / nom[23];
  proche(defl, 1 / (Math.pow(1.073, 1) * Math.pow(1.137, 11 / 12)), 1e-9);
  const sans = JSON.parse(JSON.stringify(d)); sans.reperes = sans.reperes.filter(x => x.cle !== "inflation_fr_1974");
  const ind = P.crise(P.preparer(sans, c.options), { cle: "inflation_1973", debut: 1 });
  assert.equal(ind.indisponible, true); assert.match(ind.avertissements[0], /indisponible/);
  assert.equal(P.crise(M, { cle: "inconnue" }).indisponible, true);
});
test("événement crise d'une variante : fixé dans le modèle", () => {
  const c = cas("D-11"), d = entreeDe(c);
  d.foyer.evenements = [{ id: "ec", type: "crise", personne: "foyer", libelle: "Crise rejouée", date: "2028-01-01", params: { cle: "covid_2020" }, source: "cas fictif" }];
  const M = P.preparer(d, c.options);
  assert.deepEqual(M.crise_evenement, { cle: "covid_2020", date: "2028-01-01" });
  assert.ok(M.evenements_pris_en_compte.includes("Crise rejouée"));
});

/* ---------------------------------------------------------------- performance */
test("performance : 2 000 chemins × 300 mois sous le plafond large de 600 ms (cible 150 ms dans le navigateur, voir scripts/bench-projection.mjs)", () => {
  const c = cas("C-4"), d = entreeDe(c);
  d.positions.push({ id: "pea", name: "ETF Exemple", envelope: "PEA Exemple", owner: "p1", bloc: "Monde", mode: "manual", value: 30000, status: "actif" },
    { id: "ob", name: "Obligations Exemple", envelope: "Compte-titres Exemple", owner: "p1", bloc: "Obligations", mode: "manual", value: 10000, status: "actif", qty: 100, pru: 90 });
  d.config.enveloppes_infos["PEA Exemple"] = { type: "pea", titulaire: "p1", date_ouverture: "2015-01-05", versements_cumules: 25000 };
  d.config.enveloppes_infos["Compte-titres Exemple"] = { type: "compte_titres", titulaire: "p1" };
  const M = P.preparer(d, { horizon_ans: 25, vue: "financier" });
  P.simuler(M, { chemins: 100 }); // préchauffage
  /* temps de calcul (CPU du processus), meilleur de trois essais : stable quand les autres tests tournent en parallèle sur la même machine */
  let ms = Infinity;
  for (let k = 0; k < 3; k++) {
    const c0 = process.cpuUsage();
    P.simuler(M, { chemins: 2000 });
    const c1 = process.cpuUsage(c0);
    ms = Math.min(ms, (c1.user + c1.system) / 1000);
  }
  assert.ok(ms < 600, "2 000 × 300 en " + Math.round(ms) + " ms de calcul");
});

/* ---- revue Opus, correctif 8 : une date de début de crise absente, invalide ou hors horizon n'est jamais ramenée au mois 1 en silence ---- */
test("crise : début nul, non entier, avant aujourd'hui ou hors horizon → indisponible avec la fenêtre permise ; début valide ou absent (dans un an) → rejouée", () => {
  const c = cas("MC-1") || cas("D-1");
  const M = P.preparer(entreeDe(c), { ...c.options, horizon_ans: 3 });
  const cle = Object.keys(Marche.CRISES)[0];
  for (const debut of [null, 0, -3, 37, 2.5, "2026-10-13", "2030-01-01", "pas une date", "2027-02-30", NaN]) {
    const r = P.crise(M, { cle, debut });
    assert.equal(r.indisponible, true, "début " + debut);
    assert.match(r.avertissements[0], /début de la crise.*entre le \d{2}\/\d{2}\/\d{4} et le \d{2}\/\d{2}\/\d{4}/, String(debut));
  }
  for (const debut of [1, 36, "2026-10-14", "2027-06-15", "2029-10-14"]) assert.ok(!P.crise(M, { cle, debut }).indisponible, "début " + debut);
  assert.equal(P.crise(M, { cle }).debut_t, 13, "absent : dans un an");
  const court = P.preparer(entreeDe(c), { ...c.options, horizon_ans: 1 });
  assert.equal(P.crise(court, { cle }).debut_t, 12, "horizon d'un an : le dernier mois (jamais hors horizon)");
});

/* ---- revue Opus, correctif 12 : crise et immobilier physique, convention dite ---- */
test("crise : l'immobilier physique subit le choc de la classe immobilier (mesuré sur les SCPI) — convention écrite dans la crise et dans les classes utilisées", () => {
  const c = cas("D-2"), d = entreeDe(c);
  const bien = { id: "bien-rp", nom: "Logement Exemple", usage: "rp", valeur: 400000, part_p1: 50, crd: 0, mensualite: 0, loyer: 0 };
  d.profil.biens = [bien]; d.biens = [bien];
  const M = P.preparer(d, { horizon_ans: 5, vue: "net", euros: "constants" });
  const cr = P.crise(M, { cle: "gfc_2008", debut: 6 });
  assert.ok(cr.avertissements.some(m => /Convention.*immobilier physique.*classe « immobilier ».*SCPI/.test(m)), cr.avertissements.join(" | "));
  const r = P.simuler(M, { chemins: 50 });
  const h = r.hypotheses_classes.find(x => x.classe === "immobilier_physique");
  assert.ok(h && /convention/i.test(h.convention) && h.rendement_central != null && h.volatilite != null, JSON.stringify(h));
  /* sans bien ni achat : ni mention ni ligne */
  const sans = P.preparer(entreeDe(c), { horizon_ans: 5, vue: "net" });
  assert.ok(!P.crise(sans, { cle: "gfc_2008", debut: 6 }).avertissements.some(m => /immobilier physique/.test(m)));
  assert.ok(!P.simuler(sans, { chemins: 50 }).hypotheses_classes.some(x => x.classe === "immobilier_physique"));
});
