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

/* ---------------------------------------------------------------- rétro-contrôle branché sur le résultat (champ retro) */
const Dn = req("../web/src/projection-donnees.js");
const Outils = req("../web/src/projection-outils.js");
/** Photos nocturnes fictives (deux par mois : le 15 et la fin du mois) sur `mois` mois, et versements mensuels de 300 €. */
function photosFictives(mois) {
  const snaps = [], tx = [], rend = [0.012, -0.008, 0.02, 0.005, -0.015, 0.01, 0.007, 0.018, -0.004, 0.011, 0.003, 0.009];
  let monde = 40000, obl = 10000;
  for (let k = 0; k <= mois; k++) {
    const fin = Outils.ajouterMois("2023-09-30", k), quinze = fin.slice(0, 8) + "15";
    for (const date of [quinze, fin]) snaps.push({ date, foyer: monde + obl, p1: 0, p2: 0, byBloc: { Monde: Math.round(monde), Obligations: Math.round(obl) }, byEnvelope: {}, source: "nightly" });
    if (k > 0) tx.push({ id: "t" + k, positionId: "p", date: fin, type: "versement", qty: null, price: null, amount: 300 });
    monde = monde * (1 + rend[k % 12]) + 300; obl = obl * 1.003;
  }
  return { snaps, tx };
}
const entreeRetro = (mois, extra) => { const d = entreeDe(cas("D-2")), { snaps, tx } = photosFictives(mois); d.historique = Dn.historiquePourRetro(snaps, tx); return Object.assign(d, extra || {}); };
const simRetro = (d, opts) => P.simuler(P.preparer(d, { horizon_ans: 3, ...(opts || {}) }), { chemins: 500 });

test("historiquePourRetro : une photo par mois (la dernière), formes de l'app et SQL, versements et retraits seuls comme flux", () => {
  const h = Dn.historiquePourRetro([
    { date: "2026-01-15", foyer: 100, byBloc: { A: 60, B: 40 } }, { date: "2026-01-31", foyer: 110, byBloc: { A: 66, B: 44 } },
    { date: "2026-02-28", total: 120, by_bloc: { A: 70, B: 50 } }, { date: "2026-03-31", foyer: 1, byBloc: {} }, { date: "pas une date", byBloc: { A: 1 } }, null,
  ], [
    { date: "2026-02-03", type: "versement", amount: 300 }, { date: "2026-02-05", type: "programme", amount: 100 }, { date: "2026-02-10", type: "retrait", amount: 50 },
    { date: "2026-02-11", type: "achat", amount: 999 }, { date: "2026-02-12", type: "vente", amount: 999 }, { date: "2026-02-13", type: "versement", amount: null }, { date: "2026-02-14", type: "versement", amount: 0 },
  ]);
  assert.deepEqual(h.points, [{ date: "2026-01-31", byBloc: { A: 66, B: 44 }, net: 110 }, { date: "2026-02-28", byBloc: { A: 70, B: 50 }, net: 120 }]);
  assert.deepEqual(h.flux, [{ date: "2026-02-03", montant: 300 }, { date: "2026-02-05", montant: 100 }, { date: "2026-02-10", montant: -50 }]);
  assert.deepEqual(Dn.historiquePourRetro(null, undefined), { points: [], flux: [] });
});
test("retroControle : des photos rapprochées ne font qu'une date de départ par mois (même résultat avec deux photos par mois qu'avec une)", () => {
  const { snaps, tx } = photosFictives(36), d = entreeDe(cas("D-2"));
  const brut = s => ({ points: s.map(x => ({ date: x.date, net: x.foyer, byBloc: x.byBloc })) });
  const flux = tx.map(t => ({ date: t.date, montant: t.amount }));
  const deux = P.retroControle(d, brut(snaps), { flux, chemins: 100 });
  const une = P.retroControle(d, brut(snaps.filter(x => x.date.slice(8) !== "15")), { flux, chemins: 100 });
  assert.equal(deux.origines.length, 25); assert.deepEqual(deux.origines, une.origines);
  assert.ok(deux.origines.every(o => /-(28|29|30|31)$/.test(o.date)), "fins de mois");
});
test("retro dans le résultat : au moins 24 dates de départ → couverture P10–P90 et P25–P75, phrase et limites ; reproductible, indépendant du scénario", () => {
  const d = entreeRetro(36), r = simRetro(d);
  assert.equal(r.retro_raison, null);
  assert.equal(r.retro.n, 25); assert.equal(r.retro.horizon_mois, 12); assert.equal(r.retro.affichable, true); assert.equal(r.retro.minimum, 24);
  assert.equal(r.retro.premiere_date, "2023-09-30"); assert.equal(r.retro.derniere_date, "2025-09-30");
  for (const k of ["taux_p10_p90", "taux_p25_p75"]) assert.ok(r.retro[k] >= 0 && r.retro[k] <= 1, k);
  assert.equal(r.retro.attendu_p10_p90, 0.8); assert.equal(r.retro.attendu_p25_p75, 0.5);
  assert.equal(r.retro.dans_p10_p90 + r.retro.sous_p10 + r.retro.au_dessus_p90, 25, "tout est dans la bande, dessous ou dessus");
  assert.match(r.retro.phrase, /^Rejouée depuis 25 dates passées, la projection à 1 an a encadré la valeur réelle (?:\d+|plus de 9|moins d'une) fois sur 10 \(attendu : 8 sur 10\)/);
  assert.ok(r.retro.limites.length >= 2 && r.retro.limites.every(l => typeof l === "string"));
  /* identique à l'appel direct de retroControle (mêmes tirages, mêmes flux) et à un second calcul */
  const direct = P.retroControle(d, d.historique, { horizon_mois: 12, chemins: 2000, flux: d.historique.flux, min: 24 });
  assert.equal(r.retro.dans_p10_p90, direct.couverture.dans_p10_p90); assert.equal(r.retro.dans_p25_p75, direct.couverture.dans_p25_p75);
  assert.deepEqual(simRetro(d).retro, r.retro);
  /* ne dépend ni des événements, ni de l'horizon : un autre scénario rend le même rétro-contrôle */
  const autre = simRetro(entreeRetro(36, { foyer: { evenements: [], variantes: [] } }), { horizon_ans: 5 });
  assert.deepEqual(autre.retro, r.retro);
});
test("retro dans le résultat : sous 24 dates, sans photo, hors foyer ou sans repère → null avec la raison, jamais un chiffre", () => {
  const court = simRetro(entreeRetro(30)); // 31 photos mensuelles : 19 dates avec une valeur 12 mois plus tard
  assert.equal(court.retro, null); assert.match(court.retro_raison, /^19 dates de départ avec une valeur réelle 12 mois plus tard sur 24 nécessaires : pas encore assez d'historique pour vérifier la projection\.$/);
  const sans = simRetro(entreeDe(cas("D-2")));
  assert.equal(sans.retro, null); assert.match(sans.retro_raison, /Aucune photo du patrimoine avec sa composition/);
  const p1 = simRetro(entreeRetro(36), { perimetre: "p1" });
  assert.equal(p1.retro, null); assert.match(p1.retro_raison, /foyer entier/);
  const sansRepere = entreeRetro(36); sansRepere.reperes = sansRepere.reperes.filter(r => r.cle !== "retro_min_origines");
  const m = simRetro(sansRepere);
  assert.equal(m.retro, null); assert.match(m.retro_raison, /retro_min_origines/);
  const off = P.simuler(P.preparer(entreeRetro(36), { horizon_ans: 3 }), { chemins: 100, retro: false });
  assert.equal(off.retro, null); assert.match(off.retro_raison, /non demandé/);
});
test("depuisEtat : l'historique du rétro-contrôle vient des photos et des transactions de l'état du store", () => {
  const { snaps, tx } = photosFictives(6), d = Dn.depuisEtat({ snapshots: snaps, tx }, "2026-10-14");
  assert.equal(d.historique.points.length, 7); assert.equal(d.historique.flux.length, 6);
  assert.deepEqual(Dn.depuisEtat({}, "2026-10-14").historique, { points: [], flux: [] });
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
test("figerPlan : les paramètres restent sous la limite de 100 000 octets de la base, même avec des centaines de lignes (positions réduites à id et valeur)", () => {
  const { s, d } = planDeDemo();
  const beaucoup = JSON.parse(JSON.stringify(d));
  beaucoup.positions = Array.from({ length: 900 }, (_, i) => ({ id: "6f1c2a9e-0000-4000-8000-" + String(i).padStart(12, "0"), envelope: "Enveloppe numéro " + i, owner: "p1", bloc: "Poche " + i, value: 1000 + i, qty: 1, price: 1000 + i, pru: 900, isin: "FR0000000000", status: "actif" }));
  const l = P.figerPlan({ data: beaucoup, options: { horizon_ans: 5 } }, s, "manuel");
  assert.ok(new TextEncoder().encode(JSON.stringify(l.parametres)).length <= 100000, "paramètres : " + JSON.stringify(l.parametres).length);
  assert.deepEqual(Object.keys(l.parametres.positions[0]).sort(), ["id", "value"]);
  const court = P.figerPlan({ data: d, options: { horizon_ans: 5 } }, s, "manuel");
  assert.ok(Object.keys(court.parametres.positions[0]).length > 2, "peu de lignes : le détail des positions est gardé");
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

/* ---- revue Opus, correctif 7 : taille d'un plan figé mesurée comme la base (octet_length(jsonb::text)), réduction automatique ---- */
import { PGlite } from "@electric-sql/pglite";
test("octetsJsonb : même mesure que octet_length(jsonb::text) de PostgreSQL (espaces après : et ,, accents, vides, nombres)", async () => {
  const O = req("../web/src/projection-outils.js");
  const db = new PGlite();
  const echantillons = [{}, [], { a: 1 }, { a: 1, b: [1, 2.5, -3], c: { d: "é à ç « » ✓", e: null, f: true, g: false } }, [[], {}, [{ x: [] }]], "guillemet \" et antislash \\ et accent é", { "clé accentuée": "valeur", n: 1234567.89, z: 0, neg: -0.5 },
    { tableau: Array.from({ length: 50 }, (_, i) => ({ id: "id-" + i, value: i * 100.25, ok: i % 2 === 0 })) }, { s: "tab\t et retour\n" }];
  for (const v of echantillons) {
    const r = await db.query("select octet_length($1::jsonb::text) as n", [JSON.stringify(v)]);
    assert.equal(O.octetsJsonb(v), r.rows[0].n, JSON.stringify(v).slice(0, 80));
  }
  await db.close();
});
function gros() {
  const { s, d } = planDeDemo();
  const g = JSON.parse(JSON.stringify(d));
  g.positions = Array.from({ length: 1500 }, (_, i) => ({ id: "6f1c2a9e-0000-4000-8000-" + String(i).padStart(12, "0"), name: "Fonds numéro " + i + " (libellé très long pour grossir)", envelope: "Enveloppe numéro " + i, owner: "p1", bloc: "Poche " + i, value: 1000.123456 + i, qty: 1.5, price: 1000.5 + i, pru: 900, isin: "FR0000000000", status: "actif" }));
  g.foyer.evenements = Array.from({ length: 100 }, (_, i) => ({ id: "e0000000-0000-4000-8000-" + String(i).padStart(12, "0"), type: "retrait", personne: "foyer", libelle: "Retrait " + i, date: "2027-06-01", params: { montant: 1000 + i, libelle: "Retrait " + i, inconnu: "x".repeat(15000), autre: { a: "y".repeat(3000) } }, source: "s" }));
  g.foyer.variantes = Array.from({ length: 10 }, (_, i) => ({ id: "a1b2c3d4-0000-4000-8000-" + String(i).padStart(12, "0"), nom: "Variante " + i, description: "d".repeat(300), retire: [], hypotheses: { epargne_delta_mensuel: 10 * i } }));
  g.config.projection = { ...(g.config.projection || {}), biens: Object.fromEntries(Array.from({ length: 50 }, (_, i) => ["bien:b" + i, { prix_achat: 100000 + i, date_achat: "2015-01-01", source: "Acte " + "z".repeat(250), le: "2026-10-01" }])) };
  g.credits = Array.from({ length: 200 }, (_, i) => ({ id: "c" + i, crd: 1000 + i, mensualite: 50, owner: "commun" }));
  const gros = JSON.parse(JSON.stringify(s));
  const N = 300; gros.mois = Array.from({ length: N + 1 }, (_, i) => P.ajouterMois ? "2026-10-14" : "2026-10-14");
  ["p10", "p25", "p50", "p75", "p90"].forEach(k => { gros.vues.net[k] = Array.from({ length: N + 1 }, (_, i) => 123456.789012 + i * 1.123456); });
  gros.existant = { p50: Array.from({ length: N + 1 }, () => 100000.123456) }; gros.epargne_future = { versements_cumules: Array.from({ length: N + 1 }, () => 5000.5678) };
  gros.hypotheses = Array.from({ length: 80 }, (_, i) => ({ cle: "repere_" + i, valeur: i + 0.5, verifie_le: "2026-10-01", date_effet: "2026-01-01", date_fin: null }));
  gros.capacite_par_periode = Array.from({ length: 300 }, (_, i) => ({ debut_t: i, fin_t: i + 1, montant_mensuel: 100 + i, source: "s", raison: "r".repeat(200) }));
  return { d: g, s: gros };
}
test("figerPlan : un foyer très chargé (1 500 lignes, 100 événements à paramètres énormes, 50 biens, horizon 25 ans) reste sous les limites de la base, mesurées en octets de jsonb::text", () => {
  const O = req("../web/src/projection-outils.js"), { d, s } = gros();
  const l = P.figerPlan({ data: d, options: { horizon_ans: 25 } }, s, "manuel");
  const par = O.octetsJsonb(l.parametres), ser = O.octetsJsonb(l.serie), tot = O.octetsJsonb({ raison: l.raison, horizon_mois: l.horizon_mois, parametres: l.parametres, serie: l.serie });
  assert.ok(par <= 100000, "paramètres : " + par);
  assert.ok(ser <= 250000, "série : " + ser);
  assert.ok(tot <= 400000, "total : " + tot);
  assert.ok(l.parametres.graine != null && l.parametres.version_modele && l.parametres.today, "de quoi rejouer : graine, version, date");
  assert.ok(Array.isArray(l.parametres.reductions) && l.parametres.reductions.length > 0, "les réductions sont dites : " + JSON.stringify(l.parametres.reductions));
  assert.equal(l.serie.p50.length, 301, "300 mois de série tiennent sans espacement");
  assert.equal(l.serie.p50[l.serie.p50.length - 1] > 0, true);
});
test("figerPlan : paramètres des événements limités aux clés connues de leur type (jamais un objet libre), détail gardé quand la taille le permet", () => {
  const { s, d } = planDeDemo();
  d.foyer.evenements[0].params = { ...d.foyer.evenements[0].params, inconnu: "x".repeat(5000) };
  const l = P.figerPlan({ data: d, options: { horizon_ans: 5 } }, s, "manuel");
  const ev = l.parametres.evenements[0];
  assert.equal("inconnu" in ev.params, false, JSON.stringify(ev.params).slice(0, 100));
  assert.ok(Object.keys(ev.params).length > 0);
  assert.equal(l.parametres.reductions, undefined, "rien n'est réduit quand tout tient");
});

test("phrase du rétro-contrôle : jamais « 10 fois sur 10 » ni « 0 fois sur 10 »", () => {
  const base = { affichable: true, n: 30, taux_p10_p90: 1 };
  assert.match(P.phraseRetro(base), /plus de 9 fois sur 10 \(attendu : 8 sur 10\)/);
  assert.doesNotMatch(P.phraseRetro(base), /10 fois sur 10/);
  assert.match(P.phraseRetro({ ...base, taux_p10_p90: 0.97 }), /plus de 9 fois sur 10/);
  assert.match(P.phraseRetro({ ...base, taux_p10_p90: 0.02 }), /moins d'une fois sur 10/);
  assert.match(P.phraseRetro({ ...base, taux_p10_p90: 0.8 }), /8 fois sur 10/);
});
