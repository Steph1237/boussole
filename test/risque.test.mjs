import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Risque = require("../web/src/risque.js");

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const P = (bloc, value, name, extra) => ({ owner: "p1", bloc, name, mode: "manual", value, status: "actif", ...extra });

/* Réponses au maximum de chaque question (score 100, aucun garde-fou). */
const MAX = {
  horizon: "gt15", objectif: "maximiser", reaction: "renforcer", perte_max: "plus",
  connaissances: ["livrets", "fonds_euros", "etf", "actions", "obligations", "crypto", "levier"],
  experience: 12, revenus: "fonctionnaire", matelas: "oui", part_investie: "gt75", age: "u30",
};
const MIN = {
  horizon: "lt2", objectif: "preserver", reaction: "vendre_tout", perte_max: "p5",
  connaissances: ["aucun"], experience: 0, revenus: "sans", matelas: "non", part_investie: "lt10", age: "a70",
};
const avec = (base, delta) => ({ ...base, ...delta });

describe("questionnaire", () => {
  test("dix questions bien formées, pondérées selon la spec", () => {
    const Q = Risque.QUESTIONS;
    assert.equal(Q.length, 10);
    assert.deepEqual(Q.map(q => q.id), ["horizon", "objectif", "reaction", "perte_max", "connaissances", "experience", "revenus", "matelas", "part_investie", "age"]);
    for (const q of Q) {
      assert.ok(q.theme && q.texte && ["choix", "multi", "nombre"].includes(q.type), q.id);
      assert.ok(Array.isArray(q.options) && q.options.length >= 2, q.id + " options");
      q.options.forEach(o => assert.ok(o.v != null && o.label && Number.isFinite(o.points), q.id + " option"));
    }
    const poids = Object.fromEntries(Q.map(q => [q.id, q.poids]));
    assert.deepEqual(poids, { horizon: 3, objectif: 2, reaction: 3, perte_max: 3, connaissances: 2, experience: 1, revenus: 2, matelas: 0, part_investie: 2, age: 1 });
    assert.equal(Q.find(q => q.id === "matelas").prerempli, "matelas");
    assert.equal(Q.find(q => q.id === "age").prerempli, "age");
    assert.deepEqual(Q.find(q => q.id === "age").options.map(o => o.v), ["u30", "a30", "a40", "a50", "a60", "a70"]);
  });
});

describe("profils", () => {
  test("cinq profils, cibles et pertes maximales de la spec", () => {
    assert.deepEqual(Risque.PROFILS.map(p => p.id), ["prudent", "modere", "equilibre", "dynamique", "offensif"]);
    const p = id => Risque.PROFILS.find(x => x.id === id);
    assert.deepEqual(p("prudent").cibles, { actions: [10, 20], obligations: [20, 30], securise: [50, 70], immobilier: [0, 10], speculatif: [0, 0] });
    assert.deepEqual(p("equilibre").cibles, { actions: [45, 60], obligations: [15, 25], securise: [15, 30], immobilier: [5, 15], speculatif: [0, 5] });
    assert.deepEqual(p("offensif").cibles, { actions: [75, 95], obligations: [0, 10], securise: [0, 10], immobilier: [0, 10], speculatif: [0, 10] });
    assert.deepEqual(Risque.PROFILS.map(x => x.perteMax), [5, 12, 20, 30, 40]);
    Risque.PROFILS.forEach(x => assert.ok(x.label && x.description));
  });
  test("seuils de score : 0–20 prudent, 20–40 modéré, 40–60 équilibré, 60–80 dynamique, 80–100 offensif", () => {
    const f = Risque.profilDuScore;
    assert.equal(f(0), "prudent"); assert.equal(f(19), "prudent");
    assert.equal(f(20), "modere"); assert.equal(f(39), "modere");
    assert.equal(f(40), "equilibre"); assert.equal(f(59), "equilibre");
    assert.equal(f(60), "dynamique"); assert.equal(f(79), "dynamique");
    assert.equal(f(80), "offensif"); assert.equal(f(100), "offensif");
  });
});

describe("evaluer", () => {
  test("tout au maximum : 100, offensif, sans garde-fou", () => {
    const r = Risque.evaluer(MAX);
    assert.equal(r.score, 100); assert.equal(r.profil, "offensif"); assert.equal(r.profilAvantGardeFous, "offensif");
    assert.deepEqual(r.gardeFous, []); assert.equal(r.complet, true); assert.deepEqual(r.manquantes, []);
  });
  test("tout au minimum : 0, prudent (les garde-fous ne descendent jamais plus bas)", () => {
    const r = Risque.evaluer(MIN);
    assert.equal(r.score, 0); assert.equal(r.profil, "prudent"); assert.deepEqual(r.gardeFous, []);
  });
  test("profil intermédiaire calculé à la main : 59 → équilibré", () => {
    /* horizon 2/4×3 + objectif 2/3×2 + réaction 2/3×3 + perte 2/4×3 + connaissances (ETF 2 + actions 2)/7×2
       + expérience 4 ans → 2/4×1 + revenus 3/4×2 + part 2/4×2 + âge 3/4×1 = 11,2262 ; / 19 = 59,09 % */
    const r = Risque.evaluer({ horizon: "5-8", objectif: "croissance", reaction: "rien", perte_max: "p20", connaissances: ["etf", "actions"],
      experience: 4, revenus: "cdi", matelas: "oui", part_investie: "25-50", age: "a40" });
    assert.equal(r.score, 59); assert.equal(r.profil, "equilibre"); assert.deepEqual(r.gardeFous, []);
  });
  test("garde-fou horizon < 2 ans : plafonné à modéré, avec explication", () => {
    const r = Risque.evaluer(avec(MAX, { horizon: "lt2" }));
    assert.equal(r.score, 84); /* (19 − 3) / 19 */
    assert.equal(r.profilAvantGardeFous, "offensif"); assert.equal(r.profil, "modere");
    assert.deepEqual(r.gardeFous.map(g => g.cle), ["horizon"]);
    assert.match(r.gardeFous[0].texte, /2 ans/);
    assert.equal(r.gardeFous[0].plafond, "modere");
  });
  test("garde-fou matelas : réponse « non », ou matelas du Bilan < 3 mois quand la question est sans réponse", () => {
    const a = Risque.evaluer(avec(MAX, { matelas: "non" }));
    assert.equal(a.score, 100); assert.equal(a.profil, "modere");
    assert.deepEqual(a.gardeFous.map(g => g.cle), ["matelas"]); assert.match(a.gardeFous[0].texte, /3 mois/);
    const sans = { ...MAX }; delete sans.matelas;
    const b = Risque.evaluer(sans, { matelasMois: 2 });
    assert.equal(b.profil, "modere"); assert.equal(b.complet, true);
    assert.equal(Risque.evaluer(sans, { matelasMois: 4 }).profil, "offensif");
    /* la réponse explicite l'emporte sur le prérempli */
    assert.equal(Risque.evaluer(MAX, { matelasMois: 1 }).profil, "offensif");
  });
  test("garde-fou perte maximale : plafonné au profil le plus élevé dont la perte tolérée ne dépasse pas la perte acceptée", () => {
    const p10 = Risque.evaluer(avec(MAX, { perte_max: "p10" }));
    assert.equal(p10.profilAvantGardeFous, "offensif"); assert.equal(p10.profil, "prudent"); /* modéré tolère 12 % > 10 % */
    assert.deepEqual(p10.gardeFous.map(g => g.cle), ["perte_max"]); assert.match(p10.gardeFous[0].texte, /10 %/);
    assert.equal(Risque.evaluer(avec(MAX, { perte_max: "p20" })).profil, "equilibre");
    assert.equal(Risque.evaluer(avec(MAX, { perte_max: "p35" })).profil, "dynamique");
    assert.equal(Risque.evaluer(avec(MAX, { perte_max: "plus" })).profil, "offensif");
  });
  test("garde-fou connaissances : sans connaissance des actions (ni ETF), plafonné à équilibré", () => {
    const r = Risque.evaluer(avec(MAX, { connaissances: ["livrets", "fonds_euros"] }));
    assert.equal(r.score, 89); /* (19 − 2) / 19 */
    assert.equal(r.profil, "equilibre"); assert.deepEqual(r.gardeFous.map(g => g.cle), ["connaissances"]);
    assert.match(r.gardeFous[0].texte, /actions/);
    assert.equal(Risque.evaluer(avec(MAX, { connaissances: ["etf"] })).gardeFous.length, 0);
  });
  test("plusieurs garde-fous : le plus restrictif l'emporte, tous sont expliqués", () => {
    /* (19 − 3 − 3 × 3/4 − 2) / 19 = 61,8 → 62, dynamique avant garde-fous */
    const r = Risque.evaluer(avec(MAX, { horizon: "lt2", perte_max: "p10", connaissances: ["aucun"] }));
    assert.equal(r.score, 62); assert.equal(r.profilAvantGardeFous, "dynamique");
    assert.equal(r.profil, "prudent");
    assert.deepEqual(r.gardeFous.map(g => g.cle).sort(), ["connaissances", "horizon", "perte_max"]);
    /* un garde-fou qui n'abaisse pas le profil n'est pas listé : à 58 (équilibré), le plafond « connaissances » est sans effet */
    const s = Risque.evaluer(avec(MAX, { horizon: "lt2", perte_max: "p5", connaissances: ["aucun"] }));
    assert.equal(s.profilAvantGardeFous, "equilibre");
    assert.deepEqual(s.gardeFous.map(g => g.cle).sort(), ["horizon", "perte_max"]);
  });
  test("réponses manquantes : complet faux et liste ; âge et matelas préremplis depuis le contexte", () => {
    const vide = Risque.evaluer({});
    assert.equal(vide.complet, false); assert.equal(vide.score, null); assert.equal(vide.profil, null);
    assert.equal(vide.manquantes.length, 10);
    const pre = Risque.evaluer({}, { matelasMois: 6, age: "a40" });
    assert.deepEqual(pre.manquantes, ["horizon", "objectif", "reaction", "perte_max", "connaissances", "experience", "revenus", "part_investie"]);
    const partiel = Risque.evaluer({ horizon: "gt15", objectif: "valeur inconnue", connaissances: [] });
    assert.equal(partiel.complet, false);
    assert.ok(partiel.manquantes.includes("objectif") && partiel.manquantes.includes("connaissances"));
    assert.equal(partiel.score, 100); /* calculé sur les seules réponses valides */
  });
});

/* Petit portefeuille : 100 000 € de financier. */
const PORTEFEUILLE = [
  P("Monde", 40000, "ETF MSCI World"),
  P("Nasdaq 2x", 10000, "Amundi Nasdaq-100 Daily 2x Leveraged"),
  P("Épargne", 20000, "Livret A"),
  P("Protection", 10000, "Fonds en euros"),
  P("SCPI", 10000, "SCPI diversifiée"),
  P("Or", 5000, "Lingot"),
  P("Crypto", 5000, "Bitcoin"),
  P("Épargne", 99999, "Prime", { status: "à recevoir" }),
  P("Monde", 50000, "ETF du conjoint", { owner: "p2" }),
];

describe("allocationReelle", () => {
  test("regroupe par grandes classes et somme à 100", () => {
    const a = Risque.allocationReelle(PORTEFEUILLE, "p1");
    assert.equal(a.total, 100000);
    assert.deepEqual(a.pct, { actions: 40, obligations: 0, securise: 30, immobilier: 10, speculatif: 15, diversifiants: 5 });
    near(Object.values(a.pct).reduce((s, x) => s + x, 0), 100);
    assert.equal(a.montants.speculatif, 15000); /* Nasdaq 2x + crypto */
    assert.equal(a.parClasse.levier, 10000);
  });
  test("immobilier physique ajouté à l'immobilier, périmètre foyer", () => {
    const a = Risque.allocationReelle(PORTEFEUILLE, "foyer", { immobilierPhysique: 50000 });
    assert.equal(a.total, 200000);
    assert.equal(a.montants.immobilier, 60000); assert.equal(a.pct.immobilier, 30);
    assert.equal(a.pct.actions, 45); /* 40 000 + 50 000 du conjoint */
    near(Object.values(a.pct).reduce((s, x) => s + x, 0), 100);
  });
  test("small caps et émergents comptent dans les actions ; surcharge respectée ; portefeuille vide", () => {
    const a = Risque.allocationReelle([P("Monde", 100, "MSCI Emerging Markets"), P("Europe", 100, "MSCI Europe Small Cap"), P("Protection", 200, "Or physique")], "foyer", { surcharge: { Protection: "or" } });
    assert.deepEqual(a.pct, { actions: 50, obligations: 0, securise: 0, immobilier: 0, speculatif: 0, diversifiants: 50 });
    const v = Risque.allocationReelle([], "foyer");
    assert.equal(v.total, 0); assert.equal(v.pct.actions, 0);
  });
});

describe("risquePortefeuille", () => {
  test("100 % actions : σ = 15, baisse plausible −2,33 × 15, profil offensif", () => {
    const r = Risque.risquePortefeuille([P("Monde", 1000)], "foyer");
    near(r.volatilite, 15);
    near(r.baissePlausible, -34.95);
    near(r.pireBaisseHistorique, -55);
    assert.equal(r.profilEquivalent, "offensif"); /* 34,95 % > 30 % toléré par dynamique */
    assert.deepEqual(r.contributions.map(c => [c.classe, c.poids, c.contributionPct]), [["actions", 100, 100]]);
  });
  test("50/50 actions/monétaire, corrélation 0 : σ = √(0,25 × 15² + 0,25 × 0,5²) ≈ 7,5", () => {
    const r = Risque.risquePortefeuille([P("Monde", 500), P("Épargne", 500)], "foyer");
    near(r.volatilite, Math.sqrt(0.25 * 225 + 0.25 * 0.25));
    near(r.volatilite, 7.5, 0.01);
    near(r.pireBaisseHistorique, -27.5);
    near(r.baissePlausible, -2.33 * r.volatilite); /* 17,5 % : plus grave que le plancher 0,5 × 27,5 */
    assert.equal(r.profilEquivalent, "equilibre"); /* 17,5 % > 12 % (modéré), ≤ 20 % (équilibré) */
  });
  test("50/50 actions/obligations, corrélation 0,1 : σ = √(56,25 + 6,25 + 3,75)", () => {
    const r = Risque.risquePortefeuille([P("Monde", 500), P("Obligations", 500)], "foyer");
    near(r.volatilite, Math.sqrt(66.25));
    const somme = r.contributions.reduce((s, c) => s + c.contributionPct, 0);
    near(somme, 100, 1e-9);
    const act = r.contributions.find(c => c.classe === "actions");
    near(act.contributionPct, (0.25 * 225 + 0.25 * 15 * 5 * 0.1) / 66.25 * 100);
  });
  test("100 % monétaire : profil prudent ; 100 % levier : baisse bornée à −100 %", () => {
    const m = Risque.risquePortefeuille([P("Épargne", 1000)], "foyer");
    near(m.volatilite, 0.5); near(m.baissePlausible, -1.165); assert.equal(m.profilEquivalent, "prudent");
    const l = Risque.risquePortefeuille([P("Nasdaq 2x", 1000)], "foyer");
    assert.equal(l.baissePlausible, -100); assert.equal(l.profilEquivalent, "offensif");
  });
  test("plancher : la baisse plausible n'est jamais moins grave que la moitié de la pire baisse historique pondérée", () => {
    for (const pf of [PORTEFEUILLE, [P("Monde", 1), P("Or", 1)], [P("Obligations", 3), P("SCPI", 1)], [P("Protection", 1)]]) {
      const r = Risque.risquePortefeuille(pf, "foyer");
      assert.ok(r.baissePlausible <= 0.5 * r.pireBaisseHistorique + 1e-9);
      assert.ok(r.baissePlausible <= -2.33 * r.volatilite + 1e-9);
    }
  });
  test("immobilier physique inclus ; portefeuille vide", () => {
    const r = Risque.risquePortefeuille([P("Monde", 1000)], "foyer", { immobilierPhysique: 1000 });
    assert.deepEqual(r.contributions.map(c => [c.classe, c.poids]).sort(), [["actions", 50], ["immobilier", 50]]);
    const v = Risque.risquePortefeuille([], "foyer");
    assert.equal(v.volatilite, 0); assert.equal(v.baissePlausible, 0); assert.equal(v.profilEquivalent, null); assert.deepEqual(v.contributions, []);
  });
});

describe("ecarts", () => {
  test("statuts dans / sous / au-dessus et écart en points (signé)", () => {
    const e = Risque.ecarts("equilibre", { actions: 40, obligations: 20, securise: 31, immobilier: 5, speculatif: 6, diversifiants: 0 });
    const g = Object.fromEntries(e.map(x => [x.groupe, x]));
    assert.deepEqual(e.map(x => x.groupe), ["actions", "obligations", "securise", "immobilier", "speculatif"]);
    assert.deepEqual([g.actions.statut, g.actions.ecartPts, g.actions.min, g.actions.max, g.actions.reel], ["sous", -5, 45, 60, 40]);
    assert.deepEqual([g.obligations.statut, g.obligations.ecartPts], ["dans", 0]);
    assert.deepEqual([g.securise.statut, g.securise.ecartPts], ["au-dessus", 1]);
    assert.deepEqual([g.immobilier.statut, g.immobilier.ecartPts], ["dans", 0]); /* borne incluse */
    assert.deepEqual([g.speculatif.statut, g.speculatif.ecartPts], ["au-dessus", 1]);
  });
  test("accepte le résultat d'allocationReelle ; profil inconnu → liste vide", () => {
    const a = Risque.allocationReelle(PORTEFEUILLE, "p1");
    const e = Risque.ecarts("prudent", a);
    assert.equal(e.find(x => x.groupe === "speculatif").statut, "au-dessus");
    assert.deepEqual(Risque.ecarts("inconnu", a), []);
  });
});

describe("synthese", () => {
  test("combine profil déclaré, allocation, risque réel, écarts et comparaison", () => {
    const s = Risque.synthese(avec(MAX, { perte_max: "p35" }), { positions: [P("Monde", 1000)], scope: "foyer" });
    assert.equal(s.evaluation.profil, "dynamique");
    assert.equal(s.profil.id, "dynamique");
    assert.equal(s.allocation.pct.actions, 100);
    assert.equal(s.risque.profilEquivalent, "offensif");
    assert.equal(s.ecarts.find(x => x.groupe === "actions").statut, "au-dessus");
    assert.equal(s.comparaison.ecartNiveaux, 1);
    assert.match(s.comparaison.texte, /Offensif/); assert.match(s.comparaison.texte, /Dynamique/);
  });
  test("sans réponse : pas de profil déclaré, mais le risque réel est calculé", () => {
    const s = Risque.synthese({}, { positions: [P("Épargne", 1000)] });
    assert.equal(s.profil, null); assert.deepEqual(s.ecarts, []);
    assert.equal(s.risque.profilEquivalent, "prudent");
    assert.equal(s.comparaison.ecartNiveaux, null);
  });
});
