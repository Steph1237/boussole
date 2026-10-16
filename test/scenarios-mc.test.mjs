// SCN1 tâche 5 : le socle simulerEnveloppes (web/src/scenarios.js, spec § 6.2) — mêmes tirages que le moteur PROJ, flux en fin de mois, frais mensuels,
// livrets au taux du repère, débordement au plafond, impôts de sortie par ProjectionFiscalite aux dates de 5 et 8 ans, euros d'aujourd'hui, écart chemin par chemin,
// date de bascule, mode déterministe égal aux cas chiffrés à la main de test/fixtures/scenarios-cas.json, monotonie, graine reproductible, temps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { FIXTURE, cas, dataDe } from "./helpers/scenarios-cas.mjs";
const req = createRequire(import.meta.url);
const S = req("../web/src/scenarios.js");
const Proj = req("../web/src/projection.js");
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b + " (tolérance " + tol + ")");
const DET = { volatilite: 0 };
const sim = (id, extra) => { const c = cas(id), { data } = dataDe(c); return S.simulerEnveloppes(data, c.plan, { ...DET, ...(extra || {}) }); };
const v1 = a => a[0];

/* ---------------------------------------------------------------- mode déterministe = cas de la fixture */
test("PEA-1 : plan déterministe, valeurs au centime, écart, enjeu et date de bascule", () => {
  const c = cas("PEA-1"), a = c.attendu, r = sim("PEA-1"), A = r.options.A, R = r.options.R;
  proche(v1(A.brut), a.V_A, 0.01); proche(A.base, a.versements, 0.01); proche(v1(A.brut) - A.base, a.gain_A, 0.01);
  proche(v1(A.impots), a.impots_A, 0.01); proche(v1(R.impots), a.impots_R, 0.01);
  proche(v1(A.courants), a.net_A, 0.01); proche(v1(R.courants), a.net_R, 0.01);
  const e = r.ecart("A", "R");
  proche(e.courants[0], a.ecart, 0.01); proche(e.p50, a.ecart_auj, 0.01); proche(e.p50 / 8, a.enjeu_annuel, 0.01);
  assert.deepEqual([e.p10, e.p50, e.p90].map(x => Math.round(x * 100) / 100), [a.bande.p10, a.bande.p50, a.bande.p90], "P10 = P50 = P90 en déterministe");
  assert.equal(r.bascule("A", "R").date, a.date_bascule);
});
for (const id of ["PEA-2", "PEA-4", "PEA-5a", "PEA-5b", "PEA-5c", "PEA-6"]) {
  test(id + " : plan déterministe (valeurs, impôts, écart)", () => {
    const c = cas(id), a = c.attendu, r = sim(id), A = r.options.A, R = r.options.R;
    if (a.V_A != null) proche(v1(A.brut), a.V_A, 0.01, "V_A");
    if (a.V_R != null) proche(v1(R.brut), a.V_R, 0.01, "V_R");
    if (a.versements != null) proche(A.base, a.versements, 0.01, "versements");
    if (a.gain_A != null) proche(v1(A.brut) - A.base, a.gain_A, 0.01, "gain_A");
    proche(v1(A.courants), a.net_A, 0.01, "net_A"); proche(v1(R.courants), a.net_R, 0.01, "net_R");
    const e = r.ecart("A", "R");
    proche(e.courants[0], a.ecart, 0.01, "écart"); proche(e.p50, a.ecart_auj, 0.01, "écart d'aujourd'hui");
    if (a.enjeu_annuel != null) proche(e.p50 / (c.plan.T / 12), a.enjeu_annuel, 0.01, "enjeu");
    if (a.date_bascule !== undefined) assert.equal(r.bascule("A", "R") && r.bascule("A", "R").date, a.date_bascule);
  });
}
test("PEA-6 : plafond atteint au mois 5, le débordement va en compte-titres (répartition des flux)", () => {
  const c = cas("PEA-6"), a = c.attendu;
  const flux = [{ de: 1, a: 1, montant: 146000 }, { de: 2, a: 120, montant: 1000 }];
  const rep = S.repartirPlafond(flux, c.plan.plafond_pea);
  assert.equal(rep.plafond_atteint_t, a.dernier_mois_pea);
  assert.equal(rep.verse_dedans, a.versements_pea);
  assert.deepEqual(rep.dedans, c.plan.options.A[0].flux);
  assert.deepEqual(rep.debordement, c.plan.options.A[1].flux);
  assert.equal(rep.debordement[0].de, a.premier_mois_debordement);
  const r = sim("PEA-6"), pea = r.parOption.A[0];
  proche(pea.E[pea.E.length - 1], a.V_pea, 0.01, "V du PEA");
});
test("PEA-6 : un versement qui franchit le plafond est coupé en deux dans le même mois", () => {
  const rep = S.repartirPlafond([{ de: 1, a: 1, montant: 100 }, { de: 2, a: 3, montant: 60 }], 150);
  assert.deepEqual(rep.dedans, [{ de: 1, a: 1, montant: 100 }, { de: 2, a: 2, montant: 50 }]);
  assert.deepEqual(rep.debordement, [{ de: 2, a: 2, montant: 10 }, { de: 3, a: 3, montant: 60 }]);
  assert.equal(rep.plafond_atteint_t, 2);
});
test("PEA-3 : prendre date, gain de l'antériorité, petit versement à part, courbe selon la date de retrait et fenêtre", () => {
  const c = cas("PEA-3"), a = c.attendu, r = sim("PEA-3", { horizon_max: 97 }), A = r.options.A_prime;
  proche(v1(A.brut), a.V, 0.01); proche(A.base, a.versements, 0.01); proche(v1(A.impots), a.impots_A_prime, 0.01); proche(v1(r.options.C.impots), a.impots_C, 0.01);
  const e = r.ecart("A_prime", "C");
  proche(e.courants[0], a.gain_anteriorite, 0.01); proche(e.p50, a.gain_anteriorite_auj, 0.01);
  proche(v1(r.v_min.brut), a.v_min_brut, 0.01); proche(v1(r.v_min.net), a.v_min_net, 0.01); proche(v1(r.v_min.frais), a.v_min_frais, 0.01);
  for (const p of a.courbe) proche(r.ecart("A_prime", "C", p.t).courants[0], p.gain, 0.01, "courbe au mois " + p.t + " (" + p.date + ")");
  let premier = null, dernier = null;
  for (let t = 1; t <= 97; t++) if (r.ecart("A_prime", "C", t).courants[0] > 1e-6) { premier = premier || r.date(t); dernier = r.date(t); }
  assert.deepEqual({ du: premier, au: dernier }, a.fenetre);
});
for (const id of ["EUR-1", "EUR-2", "EUR-3", "EUR-4", "EUR-5"]) {
  test(id + " : plans des options (net, net d'aujourd'hui, versements, impôts) et option en tête", () => {
    const c = cas(id), a = c.attendu, r = sim(id), T = c.plan.T;
    for (const [oid, o] of Object.entries(a.options)) {
      const x = r.options[oid];
      proche(v1(x.courants), o.net, 0.01, oid + " net"); proche(v1(x.net), o.net_auj, 0.01, oid + " net d'aujourd'hui");
      proche(x.base, o.versements, 0.01, oid + " versements"); proche(v1(x.impots), o.impots, 0.01, oid + " impôts");
    }
    const classement = Object.keys(a.options).sort((p, q) => v1(r.options[q].net) - v1(r.options[p].net));
    assert.deepEqual(classement, a.classement);
    const ref = c.plan.reference, tete = classement[0];
    const e = tete === ref ? { courants: [0], p50: 0 } : r.ecart(tete, ref);
    proche(e.courants[0], a.ecart_tete_moins_reference, 0.01); proche(e.p50 / (T / 12), a.enjeu_annuel, 0.01);
  });
}
for (const id of ["AV-1", "AV-2", "AV-3", "AV-4b", "AV-4", "AV-5"]) {
  test(id + " : assurance-vie ouverte maintenant ou plus tard (impôts, antériorité, petit versement)", () => {
    const c = cas(id), a = c.attendu, r = sim(id), A = r.options.A, B = r.options.B;
    proche(v1(A.brut), a.V, 0.01, "V"); proche(A.base, a.versements, 0.01, "versements"); proche(v1(A.brut) - A.base, a.gain, 0.01, "gain");
    proche(v1(A.impots) - v1(A.ps), a.impot_A, 0.01, "impôt sur le revenu A"); proche(v1(B.impots) - v1(B.ps), a.impot_B, 0.01, "impôt sur le revenu B"); proche(v1(A.ps), a.prelevements, 0.01, "prélèvements");
    const e = r.ecart("A", "B");
    proche(e.courants[0], a.gain_anteriorite, 0.01); proche(e.p50, a.gain_anteriorite_auj, 0.01); proche(e.p50 / (c.plan.T / 12), a.enjeu_annuel, 0.01);
    proche(v1(r.v_min.brut), a.v_min_brut, 0.01, "petit versement"); proche(v1(r.v_min.frais), a.v_min_frais, 0.01, "frais du petit versement");
  });
}

/* ---------------------------------------------------------------- propriétés du socle */
const planSimple = (frais, poches, extra) => ({ T: 60, couple: true, options: { A: [Object.assign({ type: "compte_titres", ouverture_t: 0, poches: poches || [{ classe: "actions", part: 1, frais_pct: frais }], flux: [{ de: 1, a: 60, montant: 300 }] }, extra || {})] } });
const data0 = () => dataDe(cas("PEA-1")).data;

test("mêmes tirages que le moteur PROJ : un seul compartiment, centiles du moteur et du socle identiques à 1e-9 près", () => {
  const d = JSON.parse(JSON.stringify(data0()));
  d.positions = [{ id: "ct", name: "Fonds actions monde", envelope: "Compte-titres Exemple", owner: "p1", bloc: "Actions", mode: "manual", value: 10000, valueDate: "2026-09-30", status: "actif" },
    { id: "cc", name: "Compte courant", envelope: "Compte courant Exemple", owner: "commun", bloc: "Comptes courants", mode: "manual", value: 0, valueDate: "2026-09-30", status: "actif" }];
  d.config.enveloppes_infos = { "Compte-titres Exemple": { type: "compte_titres", titulaire: "p1" }, "Compte courant Exemple": { type: "courant", titulaire: "commun" } };
  d.config.projection = { base_capacite: "montant", capacite_mensuelle: 0, reste_capacite: "disponible", salaire_croissance_reelle_pct: 0 };
  d.budget = { lignes: [] }; d.profil.personnes.p1.salaire = 0; d.profil.personnes.p2.salaire = 0; d.config.targets = {};
  const M = Proj.preparer(d, { horizon_ans: 5, euros: "courants", vue: "net" });
  const R = Proj.simuler(M, { chemins: 500, graine: 20261014 });
  const plan = { T: 60, couple: true, options: { A: [{ type: "compte_titres", ouverture_t: 0, poches: [{ classe: "actions", part: 1, frais_pct: 0 }], flux: [{ de: 0, a: 0, montant: 10000 }] }] } };
  const s = S.simulerEnveloppes(d, plan, { chemins: 500, graine: 20261014 });
  const brut = Float64Array.from(s.options.A.brut).sort(), centile = p => brut[Math.min(brut.length, Math.max(1, Math.ceil(p * brut.length - 1e-9))) - 1];
  const vue = R.vues.net;
  proche(centile(0.5), vue.p50[60], 1e-9, "P50"); proche(centile(0.1), vue.p10[60], 1e-9, "P10"); proche(centile(0.9), vue.p90[60], 1e-9, "P90");
});
test("flux en fin de mois et frais mensuels : (1 − f)^(1/12) par mois, fonds euros à volatilité nulle (P10 = P50 = P90)", () => {
  const d = data0();
  const s = S.simulerEnveloppes(d, planSimple(0, [{ classe: "fonds_euros", part: 1, frais_pct: 0.6 }]), { chemins: 300 });
  const b = S.bande(s.options.A.brut);
  assert.equal(b.p10, b.p90);
  const q = Math.pow(1.025 * (1 - 0.006), 1 / 12);
  proche(b.p50, 300 * (Math.pow(q, 60) - 1) / (q - 1), 1e-6);
});
test("livret : taux du repère jusqu'à sa date de fin, puis rendement central du monétaire (règle du moteur)", () => {
  const d = data0();
  const plan = { T: 60, couple: true, options: { L: [{ type: "livret_a", ouverture_t: 0, poches: [{ classe: "monetaire", part: 1, frais_pct: 0 }], flux: [{ de: 0, a: 0, montant: 10000 }] }] } };
  const s = S.simulerEnveloppes(d, plan, DET);
  proche(s.options.L.brut[0], cas("MAT-1").attendu.surplus_livret, 0.01);
  proche(s.options.L.brut[0], 10000 * Math.pow(1.017, 3 / 12) * Math.pow(1.015, 57 / 12), 1e-6);
  const dExp = { ...d, today: "2027-01-15" }, sExp = S.simulerEnveloppes(dExp, plan, DET);
  proche(sExp.options.L.brut[0], cas("MAT-EXP").attendu.surplus_livret, 0.01);
});
test("écart chemin par chemin : PEA ≥ compte-titres sur chaque chemin à frais égaux, et l'écart est une fonction croissante du gain", () => {
  const d = data0(), c = cas("PEA-1");
  const s = S.simulerEnveloppes(d, c.plan, { chemins: 400 }), e = s.ecart("A", "R");
  for (let i = 0; i < s.P; i++) assert.ok(e.delta[i] >= -1e-9, "chemin " + i);
  assert.ok(e.probabilite_mieux > 0.5 && e.probabilite_mieux < 1);
  const gains = Array.from(s.options.A.brut, (v, i) => v - s.options.A.base);
  const ordre = gains.map((g, i) => i).sort((x, y) => gains[x] - gains[y]);
  for (let k = 1; k < ordre.length; k++) assert.ok(e.delta[ordre[k]] >= e.delta[ordre[k - 1]] - 1e-9);
});
test("monotonie : plus de frais, un net plus bas sur chaque chemin", () => {
  const d = data0();
  const a = S.simulerEnveloppes(d, planSimple(0.2), { chemins: 300 }), b = S.simulerEnveloppes(d, planSimple(0.8), { chemins: 300 });
  for (let i = 0; i < 300; i++) assert.ok(b.options.A.net[i] < a.options.A.net[i]);
});
test("graine fixée : résultats reproductibles ; une autre graine change les tirages", () => {
  const d = data0(), p = planSimple(0.2);
  const a = S.simulerEnveloppes(d, p, { chemins: 200, graine: 7 }), b = S.simulerEnveloppes(d, p, { chemins: 200, graine: 7 }), c = S.simulerEnveloppes(d, p, { chemins: 200, graine: 8 });
  assert.deepEqual(Array.from(a.options.A.net), Array.from(b.options.A.net));
  assert.notDeepEqual(Array.from(a.options.A.net), Array.from(c.options.A.net));
  assert.equal(S.simulerEnveloppes(d, p, { chemins: 10 }).graine, Proj.GRAINE);
});
test("repère manquant : le socle rend « indisponible » avec la liste, jamais une valeur de secours", () => {
  const c = cas("PEA-1"), { data } = dataDe(c);
  data.reperes = data.reperes.filter(r => r.cle !== "ps_taux_general");
  const r = S.simulerEnveloppes(data, c.plan, DET);
  assert.equal(r.indisponible, true);
  assert.deepEqual(r.reperes_manquants, ["ps_taux_general"]);
});
test("temps : 2 000 chemins sur 10 ans, quatre options, sous 2 s (meilleur de 3)", () => {
  const c = cas("EUR-1"), { data } = dataDe(c);
  let meilleur = Infinity;
  for (let k = 0; k < 3; k++) { const t0 = performance.now(); S.simulerEnveloppes(data, c.plan, { chemins: 2000 }); meilleur = Math.min(meilleur, performance.now() - t0); }
  assert.ok(meilleur < 2000, "meilleur temps " + Math.round(meilleur) + " ms");
});

/* ---------------------------------------------------------------- Monte-Carlo de contrôle (2 000 chemins, graine 20261014) */
const MC = id => cas(id).valeurs;
const bande2 = a => { const b = S.bande(a); return { p10: Math.round(b.p10 * 100) / 100, p50: Math.round(b.p50 * 100) / 100, p90: Math.round(b.p90 * 100) / 100 }; };
const egalBande = (reel, attendu, tol, msg) => { for (const k of ["p10", "p50", "p90"]) proche(reel[k], attendu[k], tol, msg + " " + k); };
test("MC-PEA : bandes du net, de l'écart, de l'enjeu et du gain, probabilité de faire mieux ; invariants exacts", () => {
  const c = cas("MC-PEA"), v = c.valeurs, base = cas("PEA-1"), { data } = dataDe(base);
  const s = S.simulerEnveloppes(data, base.plan, { chemins: 2000, graine: 20261014 }), e = s.ecart("A", "R");
  egalBande(bande2(s.options.A.net), v.net_pea_auj, c.tolerance, "net PEA"); egalBande(bande2(s.options.R.net), v.net_cto_auj, c.tolerance, "net compte-titres");
  egalBande({ p10: e.p10, p50: e.p50, p90: e.p90 }, v.ecart_auj, c.tolerance, "écart");
  egalBande({ p10: e.p10 / 8, p50: e.p50 / 8, p90: e.p90 / 8 }, v.enjeu, c.tolerance, "enjeu");
  proche(Math.round(e.probabilite_mieux * 1000) / 1000, v.probabilite_mieux, 1e-9);
  egalBande(bande2(s.options.A.brut), v.V, c.tolerance, "V");
  /* invariant : Q_p(Δ) = 12,8 % × max(0, Q_p(V) − B) / 1,02^8 */
  const bV = S.bande(s.options.A.brut);
  for (const k of ["p10", "p50", "p90"]) proche(e[k], 0.128 * Math.max(0, bV[k] - s.options.A.base) / Math.pow(1.02, 8), 1e-6, "invariant " + k);
});
test("MC-EUR : bandes du net de chaque option, PER moins PEA, probabilité et enjeu", () => {
  const c = cas("MC-EUR"), v = c.valeurs, base = cas("EUR-4"), { data } = dataDe(base);
  const s = S.simulerEnveloppes(data, base.plan, { chemins: 2000, graine: 20261014 });
  for (const [mc, oid] of [["av", "av"], ["pea", "pea+av"], ["per", "per"], ["cto", "cto"]]) egalBande(bande2(s.options[oid].net), v.net_auj[mc], c.tolerance, "net " + mc);
  const e = s.ecart("per", "pea+av"), enjeu = s.ecart("per", "cto");
  egalBande({ p10: e.p10, p50: e.p50, p90: e.p90 }, v.per_moins_pea_auj, c.tolerance, "PER − PEA");
  proche(e.probabilite_mieux, v.probabilite_per_mieux_que_pea, 1e-9);
  egalBande({ p10: enjeu.p10 / 20, p50: enjeu.p50 / 20, p90: enjeu.p90 / 20 }, v.enjeu, c.tolerance, "enjeu");
});
test("MC-AV : gain de l'antériorité, enjeu, gain du contrat, petit versement et probabilité", () => {
  const c = cas("MC-AV"), v = c.valeurs, base = cas("AV-1"), { data } = dataDe(base);
  const s = S.simulerEnveloppes(data, base.plan, { chemins: 2000, graine: 20261014 }), e = s.ecart("A", "B");
  egalBande({ p10: e.p10, p50: e.p50, p90: e.p90 }, v.gain_auj, c.tolerance, "gain");
  egalBande({ p10: e.p10 / 9, p50: e.p50 / 9, p90: e.p90 / 9 }, v.enjeu, c.tolerance, "enjeu");
  egalBande(bande2(Array.from(s.options.A.brut, x => Math.max(0, x - s.options.A.base))), v.G, c.tolerance, "G");
  egalBande(bande2(s.v_min.brut), v.vmin_brut, c.tolerance, "petit versement");
  proche(Math.round(e.probabilite_mieux * 1000) / 1000, v.probabilite_mieux, 1e-9);
});
