import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Pratiques = require("../web/src/pratiques.js");
const Plan = require("../web/src/plan.js");
const DEMO = require("../web/src/demo-data.js");

const TODAY = "2026-10-10";
/* Sans module de risque ni de marché : résultats déterministes, que risque.js / marche.js existent ou non. */
const SANS = { Risque: null, Marche: null };
let uid = 0;
const P = (bloc, value, extra) => ({ id: "x" + ++uid, name: bloc, envelope: "Compte", owner: "p1", bloc, mode: "manual", value, status: "actif", ...extra });
const M = (bloc, value, extra) => P(bloc, null, { mode: "market", qty: 1, price: value, ...extra });
const lignes = (depense, revenu = 4000, epargne = 0) => ({ lignes: [
  { id: "r", type: "revenu", montant: revenu },
  { id: "d", type: "depense", montant: depense },
  ...(epargne ? [{ id: "e", type: "epargne", montant: epargne }] : []),
] });
const ev = (ctx, deps = SANS) => Pratiques.evaluer({
  scope: "foyer", today: TODAY, positions: [], profil: {}, config: {}, budget: { lignes: [] }, objectifs: [], risque: null, ...ctx }, deps);
const crit = (res, cle) => res.criteres.find(c => c.cle === cle);

/* Module de risque factice, conforme à l'API attendue de risque.js. */
const ecartsStub = { liste: [] };
const RisqueStub = {
  PROFILS: [
    { id: "prudent", label: "Prudent", cibles: { speculatif: [0, 0] }, perteMax: 5 },
    { id: "modere", label: "Modéré", cibles: { speculatif: [0, 2] }, perteMax: 12 },
    { id: "equilibre", label: "Équilibré", cibles: { speculatif: [0, 5] }, perteMax: 20 },
  ],
  allocationReelle: (positions, scope, opts) => { ecartsStub.opts = opts; return { pct: { actions: 50 } }; },
  ecarts: () => ecartsStub.liste,
};
const reel = nom => { try { return require("../web/src/" + nom + ".js"); } catch (e) { return null; } };
const VRAIS = { Risque: reel("risque"), Marche: reel("marche") };
const AVEC_RISQUE = { Risque: RisqueStub, Marche: null };

describe("structure", () => {
  test("4 familles pondérées 30 / 25 / 30 / 15", () => {
    assert.deepEqual(Pratiques.FAMILLES.map(f => [f.cle, f.poids]), [["securite", 30], ["effort", 25], ["allocation", 30], ["efficacite", 15]]);
  });
  test("chaque critère porte tous les champs attendus", () => {
    const r = ev({ positions: [P("Épargne", 10000), M("Monde", 5000)], budget: lignes(2000) });
    assert.ok(r.criteres.length > 0);
    r.criteres.forEach(c => {
      ["cle", "famille", "titre", "points", "sur", "valeur", "cible", "texte", "piste", "regle", "source", "aCompleter", "lien"].forEach(k =>
        assert.ok(k in c, c.cle + " sans " + k));
      assert.ok(c.regle.length > 10 && c.source.length > 5, c.cle);
    });
    assert.ok(Number.isInteger(r.total) && r.total >= 0 && r.total <= 100);
  });
});

describe("Sécurité", () => {
  test("matelas : repris de Plan.score, avec règle et source", () => {
    const ctx = { positions: [P("Épargne", 8000)], budget: lignes(2000) };
    const c = crit(ev(ctx), "matelas"), ref = Plan.score(ctx).items.find(i => i.cle === "matelas");
    assert.equal(c.famille, "securite");
    assert.equal(c.points, ref.points);
    assert.equal(c.valeur, ref.valeur);
    assert.match(c.regle, /dépenses mensuelles/);
  });
  test("protection omise sans crédit ni enfant", () => {
    assert.equal(crit(ev({ profil: { foyer: { enfants: 0 } } }), "protection"), undefined);
  });
  test("protection à compléter avec un crédit et aucune déclaration", () => {
    const c = crit(ev({ profil: { credits: [{ owner: "commun", crd: 5000, mensualite: 200 }] } }), "protection");
    assert.equal(c.aCompleter, true);
    assert.equal(c.points, 0);
    assert.equal(c.lien, "profil/donnees");
  });
  test("protection avec crédit : 20 si couvert, 8 si partiel, 0 sinon", () => {
    const pts = protection => crit(ev({ profil: { credits: [{ owner: "commun", crd: 5000, mensualite: 200 }], protection } }), "protection").points;
    assert.equal(pts({ prevoyance: true, emprunteur: true }), 20);
    assert.equal(pts({ prevoyance: true, emprunteur: false }), 8);
    assert.equal(pts({ prevoyance: false, emprunteur: true }), 8);
    assert.equal(pts({ prevoyance: false, emprunteur: false }), 0);
  });
  test("protection avec enfants seulement : seule la prévoyance est attendue", () => {
    const c = prevoyance => crit(ev({ profil: { foyer: { enfants: 2 }, protection: { prevoyance } } }), "protection");
    assert.equal(c(true).points, 20);
    assert.equal(c(true).aCompleter, false);
    assert.equal(c(false).points, 0);
  });
  test("liquidité des objectifs omise sans objectif à moins de 2 ans", () => {
    const r = ev({ positions: [P("Épargne", 1000, { envelope: "Livret A" })],
      objectifs: [{ id: "o", type: "voyage", source: "saisi", deja: 0, cible: 5000, dateCible: "2030-01-01" }] });
    assert.equal(crit(r, "liquidite_objectifs"), undefined);
  });
  test("liquidité des objectifs : immédiat + jours face au besoin restant, linéaire jusqu'à 0", () => {
    const positions = [P("Épargne", 5000, { envelope: "Livret A" }), M("Monde", 3000, { envelope: "PEA" }), P("Obligations", 10000, { envelope: "Assurance vie" })];
    const c = cible => crit(ev({ positions, objectifs: [{ id: "o", type: "voyage", source: "saisi", deja: 0, cible, dateCible: "2027-06-30" }] }), "liquidite_objectifs");
    assert.equal(c(8000).points, 20);
    assert.equal(c(16000).points, 10);   // 8 000 disponibles pour 16 000 (l'assurance-vie ne compte pas)
    assert.equal(c(16000).valeur, 0.5);
    assert.equal(crit(ev({ positions: [P("Obligations", 10000, { envelope: "Assurance vie" })],
      objectifs: [{ id: "o", source: "saisi", deja: 0, cible: 5000, dateCible: "2027-01-01" }] }), "liquidite_objectifs").points, 0);
  });
  test("liquidité des objectifs : le déjà réuni réduit le besoin (affectation en cascade)", () => {
    const positions = [P("Épargne", 2000, { envelope: "Livret A" }), P("AV", 10000, { envelope: "Assurance vie" })];
    const c = crit(ev({ positions, objectifs: [{ id: "o", source: "poches", poches: ["AV"], cible: 12000, dateCible: "2027-06-30" }] }), "liquidite_objectifs");
    assert.equal(c.points, 20); // besoin restant 2 000, disponible 2 000
  });
});

describe("Effort", () => {
  test("épargne et endettement : repris de Plan.score", () => {
    const ctx = { profil: { credits: [{ owner: "commun", crd: 9000, mensualite: 1500 }] }, budget: lignes(1500, 4000, 300) };
    const r = ev(ctx), ref = Plan.score(ctx).items;
    ["epargne", "endettement"].forEach(k => {
      const c = crit(r, k), i = ref.find(x => x.cle === k);
      assert.equal(c.famille, "effort");
      assert.equal(c.points, i.points);
      assert.equal(c.valeur, i.valeur);
    });
    assert.match(crit(r, "endettement").source, /HCSF/);
  });
  test("apport omis sans objectif Apport", () => {
    assert.equal(crit(ev({ objectifs: [{ id: "o", type: "voyage", source: "saisi", deja: 0, cible: 1000 }] }), "apport"), undefined);
  });
  test("apport : déjà réuni face à l'apport visé, linéaire de 0 à 20", () => {
    const c = deja => crit(ev({ objectifs: [{ id: "a", type: "apport", source: "saisi", deja, cible: 40000 }] }), "apport");
    assert.equal(c(40000).points, 20);
    assert.equal(c(50000).points, 20);
    assert.equal(c(20000).points, 10);
    assert.equal(c(0).points, 0);
    assert.match(c(0).regle, /10 % du prix/);
  });
  test("apport : déjà calculé par Plan.affecterDeja (le matelas passe d'abord)", () => {
    const c = crit(ev({ positions: [P("Épargne", 30000)], objectifs: [
      { id: "m", type: "matelas", source: "poches", poches: ["Épargne"], cible: 10000, priorite: 1 },
      { id: "a", type: "apport", source: "poches", poches: ["Épargne"], cible: 40000, priorite: 2 }] }), "apport");
    assert.equal(c.valeur, 0.5);
    assert.equal(c.points, 10);
  });
});

describe("Allocation", () => {
  const fin = [M("Monde", 60000), P("Épargne", 40000)];
  test("adéquation à compléter sans profil de risque", () => {
    const c = crit(ev({ positions: fin }, AVEC_RISQUE), "adequation");
    assert.equal(c.aCompleter, true);
    assert.equal(c.lien, "diagnostic/risque");
  });
  test("adéquation à compléter si le module de risque est absent", () => {
    const c = crit(ev({ positions: fin, risque: { profil: "equilibre" } }, SANS), "adequation");
    assert.equal(c.aCompleter, true);
    assert.equal(c.lien, "diagnostic/risque");
    assert.match(c.texte, /indisponible/);
  });
  test("adéquation : 0 point hors fourchette → 20, 20 → 10, 40 et plus → 0", () => {
    const pts = liste => { ecartsStub.liste = liste; return crit(ev({ positions: fin, risque: { profil: "equilibre" } }, AVEC_RISQUE), "adequation"); };
    assert.equal(pts([{ classe: "actions", reel: 50, min: 45, max: 60 }]).points, 20);
    const c = pts([{ classe: "actions", reel: 70, min: 45, max: 60 }, { classe: "obligations", reel: 5, min: 15, max: 25 }]);
    assert.equal(c.points, 10);
    assert.equal(c.valeur, 20);
    assert.equal(pts([{ classe: "actions", reel: 0.7, min: 0.45, max: 0.6 }, { classe: "obligations", reel: 0.05, min: 0.15, max: 0.25 }]).points, 10); // fractions
    assert.equal(pts([{ classe: "actions", reel: 95, min: 45, max: 60 }, { classe: "monetaire", reel: 0, min: 15, max: 30 }]).points, 0);
  });
  test("concentration : reprise de Plan.score", () => {
    const ctx = { positions: [M("Monde", 70000), P("Épargne", 30000)] };
    const c = crit(ev(ctx), "concentration"), ref = Plan.score(ctx).items.find(i => i.cle === "concentration");
    assert.equal(c.famille, "allocation");
    assert.equal(c.points, ref.points);
    assert.equal(c.valeur, ref.valeur);
  });
  test("géographie : ≥ 50 % monde → 20, 0 % → 8, linéaire entre", () => {
    const g = positions => crit(ev({ positions }), "geographie");
    assert.equal(g([M("Monde", 6000), M("Europe", 4000)]).points, 20);
    assert.equal(g([M("Monde", 2500), M("Europe", 7500)]).points, 14);
    assert.equal(g([M("Monde", 2500), M("Europe", 7500)]).valeur, 0.25);
    assert.equal(g([M("Europe", 5000), M("Convictions", 5000)]).points, 8);
    assert.match(g([M("Europe", 5000)]).texte + g([M("Europe", 5000)]).piste, /biais domestique/);
  });
  test("géographie : zone de l'instrument et nom de l'ETF priment sur la poche ; omise sans actions", () => {
    const g = positions => crit(ev({ positions }), "geographie");
    assert.equal(g([M("Convictions", 1000, { zone: "monde" })]).valeur, 1);
    assert.equal(g([M("Monde", 1000, { zone: "usa" })]).valeur, 0);
    assert.equal(g([M("Actions", 1000, { name: "iShares MSCI ACWI" })]).valeur, 1);
    assert.equal(g([P("Épargne", 1000)]), undefined);
  });
  test("spéculatif sans profil : plafond par défaut de 5 %, 2× au-delà → 0", () => {
    const s = crypto => crit(ev({ positions: [P("Crypto", crypto), P("Épargne", 100000 - crypto)] }), "speculatif");
    assert.equal(s(5000).points, 20);
    assert.equal(s(7500).points, 10);
    assert.equal(s(10000).points, 0);
    assert.match(s(5000).texte + s(5000).cible, /5 %/);
  });
  test("spéculatif : plafond du profil déclaré (Modéré 2 %, Prudent 0 %)", () => {
    const s = (profil, crypto) => crit(ev({ positions: [P("Crypto", crypto), P("Épargne", 100000 - crypto)], risque: { profil } }, AVEC_RISQUE), "speculatif");
    assert.equal(s("modere", 2000).points, 20);
    assert.equal(s("modere", 3000).points, 10);
    assert.equal(s("prudent", 0).points, 20);
    assert.equal(s("prudent", 500).points, 10);
    assert.equal(s("prudent", 1000).points, 0);
    assert.match(s("modere", 3000).texte, /Modéré/);
  });
  test("adéquation : les surcharges poche → classe sont transmises à Risque.allocationReelle", () => {
    ecartsStub.liste = [];
    ev({ positions: fin, risque: { profil: "equilibre" }, classes: { Monde: "obligations" } }, AVEC_RISQUE);
    assert.deepEqual(ecartsStub.opts.surcharge, { Monde: "obligations" });
  });
  test("spéculatif : levier détecté par Marche.classeRisque, sinon par le nom (« 2x »)", () => {
    const positions = [M("Actions US", 10000, { name: "Lev" }), P("Épargne", 90000)];
    const Marche = { classeRisque: p => (p.name === "Lev" ? "levier" : "actions") };
    assert.equal(crit(ev({ positions }, { Risque: null, Marche }), "speculatif").valeur, 0.1);
    assert.equal(crit(ev({ positions }), "speculatif").valeur, 0);
    assert.equal(crit(ev({ positions: [M("Nasdaq 2x", 10000), P("Épargne", 90000)] }), "speculatif").valeur, 0.1);
  });
  test("devises : omis sans information, informatif (hors note) sinon", () => {
    assert.equal(crit(ev({ positions: [P("Épargne", 1000)] }), "devises"), undefined);
    const c = crit(ev({ positions: [M("Monde", 2000, { devise: "USD" }), P("Épargne", 8000, { devise: "EUR" })] }), "devises");
    assert.equal(c.informatif, true);
    assert.equal(c.valeur, 0.2);
    assert.equal(c.points, null);
  });
});

describe("Efficacité", () => {
  test("frais à compléter si moins de 50 % des montants cotés ont un TER", () => {
    const c = crit(ev({ positions: [M("Monde", 1000, { ter: 0.2 }), M("Europe", 1500)] }), "frais");
    assert.equal(c.aCompleter, true);
    assert.match(c.texte, /Frais inconnus : votre assistant peut les renseigner/);
    assert.equal(c.lien, "recos/actions");
  });
  test("frais : TER pondéré, 0,3 % → 20, 1 % → 10, 2 % → 0", () => {
    const f = (...ters) => crit(ev({ positions: ters.map(t => M("Monde", 1000, { ter: t })) }), "frais");
    assert.equal(f(0.3).points, 20);
    assert.equal(f(0.1).points, 20);
    assert.equal(f(0.2, 1.8).points, 10);
    assert.equal(f(0.2, 1.8).valeur, 1);
    assert.equal(f(0.65).points, 15);
    assert.equal(f(2).points, 0);
    assert.equal(f(3).points, 0);
  });
  test("frais omis sans ligne cotée", () => {
    assert.equal(crit(ev({ positions: [P("Épargne", 1000)] }), "frais"), undefined);
  });
  test("enveloppes omises quand rien n'est à vérifier", () => {
    assert.equal(crit(ev({ positions: [P("Épargne", 1000, { envelope: "Livret A" })] }), "enveloppes"), undefined);
  });
  test("enveloppes : action européenne en compte-titres alors que le PEA du même titulaire a de la place", () => {
    const asml = M("Convictions", 5000, { name: "ASML", isin: "NL0010273215", envelope: "CTO Alex" });
    const e = (pea, config) => crit(ev({ positions: [asml, pea], config }), "enveloppes");
    assert.equal(e(M("Monde", 20000, { envelope: "PEA Alex" })).points, 14);
    assert.equal(e(M("Monde", 150000, { envelope: "PEA Alex" })).points, 20);
    assert.equal(e(M("Monde", 20000, { envelope: "PEA Alex" }), { alerts: { peaVersementsCap: 20000 } }).points, 20);
    assert.equal(e(M("Monde", 20000, { envelope: "PEA Sam", owner: "p2" })).points, 20);
    assert.ok(e(M("Monde", 20000, { envelope: "PEA Alex" })).details.some(d => d.statut === "probleme" && /PEA/.test(d.texte)));
  });
  test("enveloppes : PER avec une tranche d'imposition sous 30 %", () => {
    const e = tmi => crit(ev({ positions: [P("Monde", 5000, { envelope: "PER" })], profil: { foyer: { tmi } } }), "enveloppes");
    assert.equal(e(11).points, 14);
    assert.match(e(11).details[0].texte, /à partir de 30 %/);
    assert.equal(e(30).points, 20);
  });
  test("enveloppes : assurance-vie de moins de 8 ans (neutre, sauf argent nécessaire avant ses 8 ans)", () => {
    const av = P("Obligations", 10000, { envelope: "Assurance vie" });
    const e = (profil, extra) => crit(ev({ positions: [av], profil, ...extra }), "enveloppes");
    const jeune = e({ av_ouverture: "2022-01-01" });
    assert.equal(jeune.points, 20);
    assert.equal(jeune.details[0].statut, "note");
    assert.equal(e({}).details[0].statut, "neutre");
    assert.equal(e({ av_ouverture: { "Assurance vie": "2015-01-01" } }).details[0].statut, "ok");
    assert.equal(e({}, { config: { milestones: [{ title: "8 ans de l'assurance vie", date: "2029-01-01" }] } }).details[0].statut, "note");
    assert.equal(e({ av_ouverture: "2022-01-01" }, { objectifs: [{ id: "o", source: "poches", enveloppes: ["Assurance vie"], cible: 5000, dateCible: "2027-06-30" }] }).points, 14);
  });
  test("enveloppes : 6 points par problème, plancher à 0", () => {
    const positions = [
      M("Convictions", 5000, { isin: "FR0000120073", envelope: "CTO A" }), M("Monde", 1000, { envelope: "PEA A" }),
      M("Convictions", 5000, { isin: "FR0000120073", envelope: "CTO B", owner: "p2" }), M("Monde", 1000, { envelope: "PEA B", owner: "p2" }),
      P("Monde", 5000, { envelope: "PER" }),
      P("Obligations", 1000, { envelope: "Assurance vie" })];
    const c = crit(ev({ positions, profil: { foyer: { tmi: 11 }, av_ouverture: "2024-01-01" },
      objectifs: [{ id: "o", source: "poches", enveloppes: ["Assurance vie"], cible: 5000, dateCible: "2027-06-30" }] }), "enveloppes");
    assert.equal(c.details.filter(d => d.statut === "probleme").length, 4);
    assert.equal(c.points, 0);
  });
  test("argent dormant : ≤ 12 mois → 20, 24 → 10, ≥ 36 → 5", () => {
    const d = livrets => crit(ev({ positions: [P("Épargne", livrets)], budget: lignes(2000) }), "dormant");
    assert.equal(d(24000).points, 20);
    assert.equal(d(36000).points, 15);
    assert.equal(d(48000).points, 10);
    assert.equal(d(72000).points, 5);
    assert.equal(d(200000).points, 5);
    assert.equal(d(48000).valeur, 24);
  });
  test("argent dormant : les objectifs à moins de 2 ans (hors matelas) réservent leur part", () => {
    const d = type => crit(ev({ positions: [P("Épargne", 48000)], budget: lignes(2000),
      objectifs: [{ id: "o", type, source: "saisi", deja: 0, cible: 24000, dateCible: "2027-06-30" }] }), "dormant");
    assert.equal(d("voyage").points, 20);
    assert.equal(d("matelas").points, 10);
  });
  test("argent dormant à compléter sans dépenses connues", () => {
    const c = crit(ev({ positions: [P("Épargne", 48000)] }), "dormant");
    assert.equal(c.aCompleter, true);
    assert.equal(c.lien, "avenir/plan");
  });
});

describe("agrégation", () => {
  const C = (famille, points, extra) => ({ famille, points, sur: 20, aCompleter: false, ...extra });
  test("famille = somme ÷ (20 × critères complets) ; à compléter et informatifs exclus", () => {
    const r = Pratiques.agreger([C("securite", 20), C("securite", 10), C("securite", 0, { aCompleter: true }), C("securite", null, { informatif: true, sur: 0 })]);
    const s = r.familles.find(f => f.cle === "securite");
    assert.equal(s.total, 75);
    assert.equal(s.criteres.length, 4);
  });
  test("global = moyenne pondérée des familles notées, renormalisée", () => {
    const r = Pratiques.agreger([C("securite", 20), C("securite", 10), C("effort", 0, { aCompleter: true }), C("allocation", 20), C("efficacite", 0)]);
    assert.equal(r.familles.find(f => f.cle === "effort").total, null);
    assert.equal(r.total, 70); // (75 × 30 + 100 × 30 + 0 × 15) ÷ 75
    assert.equal(r.complet, false);
    assert.equal(r.familles.length, 4);
  });
  test("complet si aucun critère à compléter ; pas de note si rien n'est noté", () => {
    assert.equal(Pratiques.agreger([C("effort", 12)]).complet, true);
    assert.equal(Pratiques.agreger([C("effort", 12)]).total, 60);
    const vide = Pratiques.agreger([C("effort", 0, { aCompleter: true })]);
    assert.equal(vide.total, null);
    assert.equal(vide.complet, false);
  });
});

describe("données de démonstration", () => {
  const ctxDemo = scope => ({ positions: DEMO.positions, profil: DEMO.profil, config: DEMO.config, budget: DEMO.budget,
    objectifs: DEMO.objectifs, scope, risque: null, today: TODAY });
  for (const scope of ["foyer", "p1", "p2"]) {
    test("périmètre " + scope + " : 4 familles, incomplet, critères de Plan.score identiques", () => {
      const r = Pratiques.evaluer(ctxDemo(scope));
      assert.deepEqual(r.familles.map(f => f.cle), ["securite", "effort", "allocation", "efficacite"]);
      assert.equal(r.complet, false);
      assert.equal(crit(r, "adequation").aCompleter, true);
      const ref = Plan.score(ctxDemo(scope)).items;
      ["matelas", "epargne", "endettement", "concentration"].forEach(k => {
        const c = crit(r, k), i = ref.find(x => x.cle === k);
        assert.equal(c.points, i.points, k);
        assert.equal(c.valeur, i.valeur, k);
        assert.equal(c.aCompleter, i.aCompleter, k);
      });
      assert.equal(crit(r, "patrimoine"), undefined); // reste dans « Rang parmi les Français »
      assert.ok(Number.isInteger(r.total) && r.total > 0 && r.total <= 100);
    });
  }
  test("foyer sans module de risque : adéquation à compléter, spéculatif au plafond par défaut", () => {
    const r = Pratiques.evaluer(ctxDemo("foyer"), SANS);
    assert.equal(crit(r, "adequation").aCompleter, true);
    const s = crit(r, "speculatif");
    assert.equal(s.aCompleter, false);
    assert.equal(s.points, 20); // bitcoin 2,7 % < 5 %
    assert.equal(crit(r, "protection").aCompleter, true); // crédit + enfant, rien de déclaré
    assert.equal(crit(r, "apport").points, 2);           // 6 300 € réunis sur 60 000 €
    assert.equal(crit(r, "liquidite_objectifs").points, 20);
    assert.equal(crit(r, "geographie").points, 20);
    assert.equal(crit(r, "frais").aCompleter, true);
    assert.equal(crit(r, "enveloppes").points, 20);
    assert.equal(crit(r, "dormant").points, 20);
  });
  test("foyer avec les vrais modules Risque et Marche et un profil Équilibré", { skip: !VRAIS.Risque || !VRAIS.Marche }, () => {
    const r = Pratiques.evaluer({ ...ctxDemo("foyer"), risque: { profil: "equilibre" } }, VRAIS);
    const a = crit(r, "adequation"), s = crit(r, "speculatif");
    assert.equal(a.aCompleter, false);
    assert.ok(Number.isInteger(a.points) && a.points >= 0 && a.points <= 20);
    assert.equal(a.valeur, Math.round(VRAIS.Risque.ecarts("equilibre", VRAIS.Risque.allocationReelle(DEMO.positions, "foyer"))
      .reduce((t, e) => t + Math.abs(e.ecartPts), 0) * 10) / 10);
    assert.match(s.texte, /Équilibré/);
    assert.equal(s.points, 20);
  });
  test("foyer avec un profil déclaré : l'adéquation est notée", () => {
    ecartsStub.liste = [{ classe: "actions", reel: 50, min: 45, max: 60 }];
    const r = Pratiques.evaluer({ ...ctxDemo("foyer"), risque: { profil: "equilibre" } }, AVEC_RISQUE);
    assert.equal(crit(r, "adequation").aCompleter, false);
    assert.equal(crit(r, "adequation").points, 20);
  });
});
