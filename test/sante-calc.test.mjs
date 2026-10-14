// CP4 : Santé juste, expliquée et lisible (docs/superpowers/specs/2026-10-12-cp4-sante-design.md § 1, 2, 3, 5).
// Calculs purs de l'app (plan.js, pratiques.js, calc.js) sur un jeu fictif de la personne 1 (montants inventés, proportions réalistes),
// puis parité avec le bloc de calcul du connecteur (supabase/functions/mcp/index.ts) et l'angle frais de l'outil analyser.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const Calc = require("../web/src/calc.js");
const Plan = require("../web/src/plan.js");
const Pratiques = require("../web/src/pratiques.js");
const Risque = require("../web/src/risque.js");
const DEMO = require("../web/src/demo-data.js");

const TODAY = "2026-10-12";
const J = v => JSON.parse(JSON.stringify(v));
const crit = (r, cle) => r.criteres.find(c => c.cle === cle);
const proche = (a, b, m, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${m} : ${a} ≠ ${b}`);

/* ---------- jeu « p1 » : jeu fictif (montants inventés, aucun frais courant connu) ---------- */
let k = 0;
const L = (envelope, name, bloc, value, extra = {}) => ({ id: "l" + ++k, name, envelope, owner: "p1", bloc, mode: "market", isin: null, qty: 1, price: value,
  value: null, status: "actif", ter: null, zone: null, devise: null, ...extra });
const V = (envelope, name, bloc, value, extra = {}) => L(envelope, name, bloc, null, { mode: "manual", qty: null, price: null, value, ...extra });
const P1 = [
  L("PEA", "ETF Nasdaq-100 levier ×2", "Nasdaq 2x", 20480, { isin: "FR0000000101" }),
  L("PEA", "ETF S&P Eurozone", "Europe", 8240, { isin: "LU0000000102" }),
  L("PEA", "ASML", "Convictions", 5610, { isin: "NL0000000103" }),
  L("PEA", "Danone", "Convictions", 4870, { isin: "FR0000000104" }),
  L("PEA", "TotalEnergies", "Convictions", 3990, { isin: "FR0000000105" }),
  L("PEA", "ETF émergents", "Émergents", 3620, { isin: "IE0000000106" }),
  L("PEA", "Capgemini", "Convictions", 2760, { isin: "FR0000000107" }),
  L("PEA", "ETF Monde", "Monde", 2840, { isin: "IE0000000108" }),
  L("PEA", "ETF Europe", "Europe", 2590, { isin: "LU0000000109" }),
  L("PEA", "Sanofi", "Convictions", 2310, { isin: "FR0000000110" }),
  L("PEA", "ETF Stoxx 600", "Europe", 2180, { isin: "LU0000000111" }),
  L("PEA", "Orange", "Convictions", 930, { isin: "FR0000000112" }),
  L("PEA", "Michelin", "Convictions", 140, { isin: "FR0000000113" }),
  V("PEA", "Espèces PEA", "Liquidités", 80),
  V("AV Linxea p1", "ETF World", "Monde", 19350),
  V("AV Linxea p1", "SCPI Rendement", "SCPI", 11900),
  V("AV Linxea p1", "SCPI Europe", "SCPI", 12050),
  V("AV Linxea p1", "ETF émergents", "Émergents", 7880),
  V("AV Linxea p1", "Or", "Or", 690),
  V("AV Linxea p1", "Fonds euros", "Fonds euros", 420),
  L("Crypto (Binance)", "Bitcoin et cryptos", "Crypto", 2850),
  V("Livret A", "Livret A", "Épargne", 7640),
  V("LDDS", "LDDS", "Épargne", 25),
  V("À recevoir", "Indemnité", "Épargne", 18000, { status: "à recevoir" }),
  V("PER", "PER Linxea", "Monde", 520),
  V("Banque en ligne", "Compte courant", "Comptes courants", 55),
  V("CTO", "Liquidités CTO", "Liquidités", 65),
];
const ISIN = Object.fromEntries(P1.map(p => [p.name + "|" + p.envelope, p.id]));
const id = (nom, env) => ISIN[nom + "|" + env];
/* Budget réel (fictif) des comptes courants (juillet à septembre) : revenus 5 800 €/mois, dépenses 5 020, épargne versée 600. */
const BANQUE = { actif: true, comptes: [{ id: 1, type: "courant", ignore: false, doublonDe: null, actif: true }], mois: ["2026-07-01", "2026-08-01", "2026-09-01"].flatMap(mois => [
  { mois, compteId: 1, categorie: "revenus", entrees: 5800, sorties: 0 }, { mois, compteId: 1, categorie: "courses", entrees: 0, sorties: 2780 },
  { mois, compteId: 1, categorie: "logement", entrees: 0, sorties: 2240 }, { mois, compteId: 1, categorie: "epargne", entrees: 0, sorties: 600 },
  { mois, compteId: 1, categorie: "virement_interne", entrees: 1500, sorties: 1500 }]) };
/* Budget prévu, volontairement différent du réel (taux d'épargne prévu ≈ 33 %) : le réel doit primer. */
const BUDGET = { lignes: [{ id: "r", type: "revenu", categorie: "Salaire", montant: 6000 }, { id: "d", type: "depense", categorie: "Vie courante", montant: 4000 },
  { id: "e", type: "epargne", categorie: "Épargne", montant: 1500 }] };
const PROFIL = { foyer: { adultes: 1, age: "a40", tmi: 30 }, personnes: { p1: { nom: "Alex", statut: "cadre" } }, biens: [], credits: [], protection: {} };
const OBJECTIFS = [{ id: "obj-apport", nom: "Apport appartement", type: "apport", cible: 50000, dateCible: "2027-12-31", source: "poches", poches: ["Épargne"], enveloppes: [], rendement: 2, priorite: 1 }];
const CTX = { positions: P1, profil: PROFIL, config: {}, budget: BUDGET, objectifs: OBJECTIFS, scope: "foyer", risque: { profil: "dynamique" }, classes: {}, banque: BANQUE, today: TODAY };
const evalP1 = (extra = {}) => Pratiques.evaluer({ ...CTX, ...extra });

const CHAMPS = ["cle", "famille", "libelle", "statut", "points", "max", "mesure", "repere", "pourquoi", "calcul", "donnees", "ameliorer", "manque", "source_donnees", "confiance",
  // champs existants gardés (compatibilité des vues)
  "titre", "sur", "valeur", "cible", "texte", "piste", "regle", "source", "aCompleter", "lien"];

describe("contrat de critère (spec § 3)", () => {
  test("tous les critères (démo et jeu p1) portent le contrat complet, cohérent avec leur statut", () => {
    for (const r of [evalP1(), Pratiques.evaluer({ positions: DEMO.positions, profil: DEMO.profil, config: DEMO.config, budget: DEMO.budget, objectifs: DEMO.objectifs, today: TODAY })]) {
      for (const c of r.criteres) {
        for (const ch of CHAMPS) assert.ok(ch in c, c.cle + " sans " + ch);
        assert.ok(["bon", "surveiller", "travailler", "a_completer", "information"].includes(c.statut), c.cle);
        assert.ok(typeof c.pourquoi === "string" && c.pourquoi.length > 10, c.cle + " : pourquoi");
        assert.ok(Array.isArray(c.calcul) && Array.isArray(c.donnees) && Array.isArray(c.ameliorer) && Array.isArray(c.manque), c.cle);
        assert.ok(["complete", "partielle", "absente"].includes(c.confiance), c.cle);
        assert.ok(c.repere && typeof c.repere.texte === "string" && Array.isArray(c.repere.zones), c.cle + " : repère");
        if (c.statut === "a_completer") { assert.equal(c.points, null, c.cle); assert.ok(c.manque.length > 0, c.cle + " : manque"); assert.equal(c.points_perdus, null); }
        else if (c.statut !== "information") {
          assert.equal(c.max, 20); assert.ok(Number.isInteger(c.points), c.cle);
          assert.equal(c.statut, Plan.statutDe(c.points), c.cle);
          assert.ok(c.calcul.length >= 2, c.cle + " : calcul");
          assert.ok(c.calcul.some(l => /\d/.test(l)), c.cle + " : chiffres dans le calcul");
          assert.ok(c.mesure && typeof c.mesure.texte === "string", c.cle + " : mesure");
          assert.ok(c.repere.zones.length >= 1 && c.repere.zones[c.repere.zones.length - 1].jusqua === null, c.cle + " : zones");
        }
        for (const a of c.ameliorer) assert.ok(typeof a.action === "string" && (a.gain_points === null || (Number.isInteger(a.gain_points) && a.gain_points >= 0)), c.cle + " : " + a.action);
        for (const d of c.donnees) {
          assert.ok(typeof d.libelle === "string", c.cle);
          if (d.lien) assert.ok(typeof d.lien.ligne === "string" || typeof d.lien.enveloppe === "string", c.cle + " : lien");
        }
        // jamais de produit recommandé, ni « conseiller » au sens de l'app ; tutoiement
        const txt = [c.pourquoi, ...c.calcul, ...c.ameliorer.map(a => a.action)].join(" ");
        assert.doesNotMatch(txt, /\bvous\b|\bvotre\b|\bvos\b/, c.cle + " : tutoiement");
        assert.doesNotMatch(txt, /amundi|lyxor|ishares|vanguard|xtrackers/i, c.cle + " : aucun émetteur nommé dans les explications (les noms de lignes de l'utilisateur sont des données)");
      }
    }
  });

  test("statut : 16 et plus bon, 10 et plus à surveiller, en dessous à travailler, null à compléter", () => {
    assert.deepEqual([20, 16, 15, 10, 9, 0, null].map(Plan.statutDe), ["bon", "bon", "surveiller", "surveiller", "travailler", "travailler", "a_completer"]);
  });

  test("zones : cohérentes avec le barème rejoué (matelas, épargne, frais)", () => {
    const verifier = (f, zs, min, max) => {
      for (let i = 0; i <= 200; i++) {
        const x = min + (max - min) * i / 200, z = zs.find(z => z.jusqua === null || x <= z.jusqua + 1e-9);
        const borne = zs.some(z => z.jusqua != null && Math.abs(x - z.jusqua) < 0.011);
        if (!borne) assert.equal(z.statut, Plan.statutDe(Math.round(f(x))), "x = " + x);
      }
    };
    verifier(Plan.BAREMES.matelas, Plan.zones(Plan.BAREMES.matelas, 0, 15), 0, 15);
    verifier(Plan.BAREMES.epargne, Plan.zones(Plan.BAREMES.epargne, 0, 30), 0, 30);
    verifier(Pratiques.BAREME_FRAIS, Plan.zones(Pratiques.BAREME_FRAIS, 0, 2.5), 0, 2.5);
    assert.deepEqual(Plan.zones(Pratiques.BAREME_FRAIS, 0, 2.5), [{ jusqua: 0.4, statut: "bon" }, { jusqua: 1.2, statut: "surveiller" }, { jusqua: null, statut: "travailler" }]);
  });

  test("ameliorer : gain_points obtenu en rejouant le barème (matelas à 3 mois, épargne à 15 %)", () => {
    const r = evalP1(), m = crit(r, "matelas"), e = crit(r, "epargne");
    assert.match(m.ameliorer[0].action, /3 mois de dépenses \(≈ \+/);
    assert.equal(m.ameliorer[0].gain_points, Math.round(Plan.BAREMES.matelas(3)) - m.points);
    assert.equal(e.ameliorer[0].gain_points, Math.round(Plan.BAREMES.epargne(15)) - e.points);
    assert.match(e.ameliorer[0].action, /^Dégage \d[\d ]* € de plus par mois \(dépenses en moins ou revenus en plus\) pour atteindre 15 % de tes revenus\.$/);
    assert.match(crit(evalP1({ banque: null }), "epargne").ameliorer.concat([{ action: "Mets de côté 1 € de plus par mois pour atteindre 20 % de tes revenus." }])[0].action,
      /^Mets de côté \d[\d ]* € de plus par mois pour atteindre (15|20) % de tes revenus\.$/, "budget prévu : formulation inchangée");
  });
});

describe("jeu p1 : corrections de justesse (spec § 1)", () => {
  test("capacité d'épargne réelle prioritaire : capacité réelle (revenus − dépenses) ÷ revenus ≈ 13,4 %, épargne versée affichée à part", () => {
    const e = crit(evalP1(), "epargne");
    proche(e.valeur, (5800 - 5020) / 5800, "capacité réelle");
    assert.equal(e.mesure.valeur, 13.4);
    assert.equal(e.titre, "Capacité d'épargne", "un seul vocabulaire : « Capacité d'épargne » (revenus − dépenses), « Épargne versée » à part");
    assert.match(e.regle, /^Capacité d'épargne = \(revenus − dépenses\) ÷ revenus/);
    assert.equal(e.points, Math.round(Plan.BAREMES.epargne((5800 - 5020) / 5800 * 100)));
    assert.equal(e.source_donnees, "réel, juillet à septembre 2026");
    assert.match(e.texte, /^Tu dégages 13 % de tes revenus \(revenus − dépenses\), d'après tes comptes \(juillet à septembre 2026\), dont 600 € par mois versés sur ton épargne\.$/);
    assert.ok(e.calcul.includes("Capacité d'épargne : 5 800 € − 5 020 € = 780 € par mois"), e.calcul.join(" | "));
    assert.ok(e.calcul.includes("780 € ÷ 5 800 € = 13,4 %"), e.calcul.join(" | "));
    assert.ok(e.calcul.some(l => /^Dont épargne versée \(virements vers l'épargne et les placements\) : 600 € par mois ; le reste \(180 €\) reste sur tes comptes courants$/.test(l)), e.calcul.join(" | "));
    assert.deepEqual(e.donnees.map(d => [d.libelle, d.valeur]), [["Revenus moyens", 5800], ["Dépenses moyennes", 5020], ["Capacité d'épargne", 780], ["Épargne versée", 600]]);
    assert.match(e.regle, /\(revenus − dépenses\) ÷ revenus/);
    assert.ok(e.ameliorer.every(a => /^Dégage /.test(a.action)), "réel : dégager une capacité, pas seulement verser");
    const prevu = crit(evalP1({ banque: null }), "epargne");
    assert.equal(prevu.titre, "Capacité d'épargne");
    assert.equal(prevu.source_donnees, "budget prévu");
    assert.ok(prevu.valeur > 0.3, "sans banque : budget prévu");
    assert.equal(crit(evalP1({ scope: "p1" }), "epargne").source_donnees, "budget prévu", "vue d'une personne : le réel est celui du foyer");
  });

  test("projets proches : seul l'argent disponible ET peu risqué compte (pas le PEA, la crypto ni le levier)", () => {
    const c = crit(evalP1(), "liquidite_objectifs");
    const sur = 7640 + 25 + 55 + 65 + 80 + 420; // livrets, compte courant, liquidités du CTO et du PEA, fonds euros
    proche(c.valeur, sur / 50000, "ratio");
    assert.equal(c.points, Math.round(sur / 50000 * 20));
    assert.match(c.texte, /^71 695 € disponibles, dont 8 285 € sans risque de baisse, pour 50 000 € à réunir d'ici 3 ans\.$/);
    const lignes = c.donnees.map(d => d.lien && d.lien.ligne);
    assert.ok(!lignes.includes(id("ETF Nasdaq-100 levier ×2", "PEA")) && !lignes.includes(id("Bitcoin et cryptos", "Crypto (Binance)")), "pas de PEA ni de crypto");
    assert.ok(lignes.includes(id("Livret A", "Livret A")) && lignes.includes(id("Fonds euros", "AV Linxea p1")));
    assert.ok(c.ameliorer[0].gain_points === 20 - c.points);
    // obligations courtes identifiées par leur nom : comptées ; obligations longues : non
    const avec = extra => crit(evalP1({ positions: [...P1, extra] }), "liquidite_objectifs").valeur;
    proche(avec(V("CTO", "Obligations court terme 0-3 ans", "Obligations", 6000)), (sur + 6000) / 50000, "obligations courtes");
    proche(avec(V("CTO", "Obligations 10 ans", "Obligations", 6000)), sur / 50000, "obligations longues");
    proche(avec(V("PER", "Fonds euros PER", "Fonds euros", 6000)), sur / 50000, "fonds euros d'un PER : bloqué");
  });

  test("apport : poches rattachées, « à recevoir » exclu et affiché à part, détail par ligne", () => {
    const a = crit(evalP1(), "apport");
    proche(a.valeur, 7665 / 50000, "ratio");
    assert.match(a.texte, /^7 665 € réunis sur 50 000 € d'apport visé \(15 %\), \+ 18 000 € attendus \(à recevoir, non comptés\)\.$/);
    assert.deepEqual(a.donnees.map(d => [d.libelle, d.valeur, d.note || null]),
      [["Livret A", 7640, null], ["LDDS", 25, null], ["Indemnité", 18000, "à recevoir, non compté"]]);
    assert.ok(a.ameliorer.some(x => /18 000 € attendus/.test(x.action) && x.gain_points > 0));
    // à recevoir compté seulement si l'objectif le demande
    const inclus = crit(evalP1({ objectifs: [{ ...OBJECTIFS[0], inclureARecevoir: true }] }), "apport");
    proche(inclus.valeur, 25665 / 50000, "à recevoir inclus");
    // personne de l'objectif : les lignes d'une autre personne ne comptent pas
    const autre = V("Livret A Sam", "Livret A Sam", "Épargne", 20000, { owner: "p2" });
    proche(crit(evalP1({ positions: [...P1, autre] }), "apport").valeur, 27665 / 50000, "objectif du foyer : toutes les personnes");
    proche(crit(evalP1({ positions: [...P1, autre], objectifs: [{ ...OBJECTIFS[0], titulaire: "p1" }] }), "apport").valeur, 7665 / 50000, "objectif de p1");
  });

  test("adéquation détaillée par classe : %, fourchette, écart ; somme = valeur ; comptes courants exclus", () => {
    const a = crit(evalP1(), "adequation");
    const alloc = Risque.allocationReelle(P1, "foyer"), ec = Risque.ecarts("dynamique", alloc);
    assert.deepEqual(a.tableau.map(t => t.groupe), ec.map(e => e.groupe));
    a.tableau.forEach((t, i) => { proche(t.pct, Math.round(ec[i].reel * 10) / 10, t.groupe, 1e-9); assert.equal(t.min, ec[i].min); assert.equal(t.max, ec[i].max); proche(t.ecart, Math.round(ec[i].ecartPts * 10) / 10, t.groupe, 1e-9); });
    proche(a.valeur, Math.round(ec.reduce((s, e) => s + Math.abs(e.ecartPts), 0) * 10) / 10, "somme", 1e-9);
    assert.ok(a.calcul.some(l => /^Actions : [\d,]+ % pour une fourchette de 60 à 80 %/.test(l)), a.calcul.join(" | "));
    assert.ok(a.ameliorer.length > 0 && a.ameliorer.every(x => x.gain_points >= 0));
    assert.match(a.repere.texte, /40 points ou plus : 0/);
  });

  test("part spéculative : lignes listées (levier, crypto) avec leur poids, plafond rappelé", () => {
    const s = crit(evalP1(), "speculatif");
    assert.deepEqual(s.donnees.map(d => d.libelle), ["ETF Nasdaq-100 levier ×2", "Bitcoin et cryptos"]);
    const F = Calc.financier(Calc.horsCourants(P1), "foyer");
    proche(s.valeur, (20480 + 2850) / F, "part");
    assert.equal(s.donnees[0].poids_pct, Math.round(20480 / F * 1000) / 10);
    assert.ok(s.calcul.some(l => /plafond du profil Dynamique : 7 %/.test(l)));
    assert.equal(s.statut, "travailler");
  });

  test("matelas : mois de dépenses réelles, réserve de fonctionnement expliquée, livrets et comptes courants listés", () => {
    const m = crit(evalP1(), "matelas");
    proche(m.valeur, 7665 / 5020, "mois");
    assert.equal(m.source_donnees, "réel, juillet à septembre 2026");
    assert.ok(m.calcul.some(l => /réserve de fonctionnement de 1 mois de dépenses \(5 020 €\)/.test(l)), m.calcul.join(" | "));
    assert.ok(m.calcul.includes("Dépenses mensuelles (réel, juillet à septembre 2026) : 5 020 €"));
    assert.deepEqual(m.donnees.map(d => d.libelle), ["Livret A", "Compte courant", "LDDS"]);
  });

  test("frais : à compléter (aucun frais courant connu), coût partiel affiché, jamais 100/100", () => {
    const r = evalP1(), f = crit(r, "frais");
    assert.equal(f.statut, "a_completer");
    assert.equal(f.points, null);
    assert.equal(f.frais.encours, 92415);
    assert.equal(f.frais.encoursConnu, 23605); // titres en direct, espèces, crypto, liquidités
    assert.match(f.texte, /^Frais connus sur 26 % de tes placements : coût partiel de 0 € par an \(0 %\)\.$/);
    assert.equal(f.frais.fondsSansFrais.length, 10);
    assert.deepEqual(f.frais.enveloppesACompleter, ["AV Linxea p1", "PER"]);
    assert.deepEqual(f.frais.scpi.map(x => x.valeur), [12050, 11900]);
    assert.ok(f.manque.some(m => /Frais courants de 10 fonds/.test(m)) && f.manque.some(m => /« AV Linxea p1 »/.test(m)));
    assert.ok(r.total !== 100);
    assert.equal(r.familles.find(x => x.cle === "efficacite").criteres.find(c => c.cle === "frais").points_perdus, null);
  });

  test("note globale du jeu p1 : couverture, provisoire, points perdus et « ce qui te coûte le plus »", () => {
    const r = evalP1();
    assert.equal(r.criteresAttendus, r.criteres.filter(c => !c.informatif).length);
    assert.equal(r.criteresNotes, r.criteres.filter(c => c.statut !== "a_completer" && c.statut !== "information").length);
    assert.equal(r.couvertureTexte, "calculée sur " + r.criteresNotes + " critères sur " + r.criteresAttendus);
    proche(r.criteres.reduce((s, c) => s + (c.points_perdus || 0), 0), 100 - r.familles.filter(f => f.total != null).reduce((s, f) => s + f.total * f.poids, 0) /
      r.familles.filter(f => f.total != null).reduce((s, f) => s + f.poids, 0), "somme des points perdus = 100 − note non arrondie", 0.6);
    assert.equal(r.couts.length, 3);
    assert.deepEqual(r.couts.map(c => c.points_perdus), [...r.couts.map(c => c.points_perdus)].sort((a, b) => b - a));
    assert.ok(r.couts.every(c => typeof c.action === "string" && c.action.length > 10));
    assert.deepEqual(J(Plan.coutsPrincipaux(r)), J(r.couts));
  });
});

describe("frais des supports (spec § 2)", () => {
  const TER = { "ETF Nasdaq-100 levier ×2": 0.6, "ETF S&P Eurozone": 0.15, "ETF émergents": 0.25, "ETF Monde": 0.2, "ETF Europe": 0.2, "ETF Stoxx 600": 0.07, "ETF World": 0.2, "Or": 0.12, "PER Linxea": 1.8 };
  const avecTer = (ters = TER) => P1.map(p => (ters[p.name] != null ? { ...p, ter: ters[p.name] } : p));
  const FE = { "AV Linxea p1": { gestion_uc_pct: 0.5, gestion_euro_pct: 0.6, source: "conditions générales", le: "2026-10-01" }, PER: { gestion_uc_pct: 0.7, source: "DIC", le: "2026-10-01" } };

  test("barème : ≤ 0,40 → 20 ; ≤ 0,75 → 15 ; ≤ 1,20 → 10 ; ≤ 1,80 → 5 ; au-delà → 0", () => {
    assert.deepEqual([0, 0.4, 0.41, 0.75, 0.76, 1.2, 1.21, 1.8, 1.81, 3].map(Pratiques.BAREME_FRAIS), [20, 20, 15, 15, 10, 10, 5, 5, 0, 0]);
  });

  test("TER et frais d'enveloppe connus : coût total en € et en %, note sur la part connue", () => {
    const f = crit(evalP1({ positions: avecTer(), config: { frais_enveloppes: FE } }), "frais");
    const fonds = 20480 * 0.6 + 8240 * 0.15 + 3620 * 0.25 + 2840 * 0.2 + 2590 * 0.2 + 2180 * 0.07 + 19350 * 0.2 + 7880 * 0.25 + 690 * 0.12 + 520 * 1.8;
    const env = (19350 + 7880 + 690) * 0.5 + 420 * 0.6 + 520 * 0.7;
    const cout = (fonds + env) / 100;
    proche(f.frais.cout, Math.round(cout * 100) / 100, "coût", 0.011);
    proche(f.valeur, cout / 92415 * 100, "pourcentage", 1e-9);
    assert.equal(f.frais.couverture, 1);
    assert.equal(f.points, Pratiques.BAREME_FRAIS(cout / 92415 * 100));
    assert.equal(f.confiance, "complete");
    assert.match(f.texte, /^Coût estimé de 0,\d+ % par an, soit \d[\d ]* € par an\.$/);
    assert.equal(f.frais.plusCouteuses.length, 5);
    assert.equal(f.frais.plusCouteuses[0].nom, "ETF World"); // 22 156 € × (0,20 + 0,50 de gestion du contrat)
    assert.equal(f.frais.plusCouteuses[1].nom, "ETF Nasdaq-100 levier ×2");
    assert.deepEqual(f.frais.plusCouteuses.map(l => l.coutAnnuel), [...f.frais.plusCouteuses.map(l => l.coutAnnuel)].sort((a, b) => b - a));
  });

  test("lignes au-dessus de 0,50 % : repère de classe (jamais un produit nommé), projection 10 et 20 ans à 5 %", () => {
    const f = crit(evalP1({ positions: avecTer({ ...TER, "ETF World": 0.95 }), config: { frais_enveloppes: FE } }), "frais");
    const ad = f.frais.auDessusRepere;
    assert.deepEqual(ad.map(x => x.nom), ["ETF World", "PER Linxea", "ETF Nasdaq-100 levier ×2"].filter(n => ad.some(x => x.nom === n)).sort((a, b) =>
      ad.find(x => x.nom === b).surcout - ad.find(x => x.nom === a).surcout));
    const w = ad.find(x => x.nom === "ETF World");
    assert.equal(w.repere.texte, "un fonds indiciel actions (monde, Europe, États-Unis) coûte souvent 0,10 à 0,30 % par an");
    assert.equal(w.ecartPct, 0.65);
    const proj = (c, e, n) => c * (Math.pow(1.05, n) - Math.pow(1.05 - e / 100, n));
    assert.equal(f.frais.projection.rendementPct, 5);
    assert.equal(f.frais.projection.ecart.ans10, Math.round(ad.reduce((s, x) => s + proj(x.valeur, x.ecartPct, 10), 0)));
    assert.equal(f.frais.projection.ecart.ans20, Math.round(ad.reduce((s, x) => s + proj(x.valeur, x.ecartPct, 20), 0)));
    assert.ok(f.calcul.some(l => /rendement brut égal de 5 % par an \(hypothèse\)/.test(l)));
    const a = f.ameliorer[0];
    assert.match(a.action, /au-dessus du repère de leur classe coûtaient le haut de ce repère/);
    const apres = (f.frais.cout - f.frais.projection.ecart.annuel) / f.frais.encoursConnu * 100;
    assert.equal(a.gain_points, Math.max(0, Pratiques.BAREME_FRAIS(apres) - f.points));
    assert.doesNotMatch(JSON.stringify(f.frais.auDessusRepere.map(x => x.repere)), /amundi|ishares|lyxor|vanguard/i);
  });

  test("couverture < 70 % : à compléter avec coût partiel ; 70 % ou plus : noté (partielle)", () => {
    // ETF du PEA connus, contrat d'assurance-vie sans frais d'enveloppe : couverture = (23 605 + fonds du PEA) ÷ 92 415
    const peaSeul = { "ETF Nasdaq-100 levier ×2": 0.6, "ETF S&P Eurozone": 0.15, "ETF émergents": 0.25, "ETF Monde": 0.2, "ETF Europe": 0.2, "ETF Stoxx 600": 0.07 };
    const f = crit(evalP1({ positions: avecTer(peaSeul) }), "frais");
    proche(f.frais.couverture, (23605 + 39950) / 92415, "couverture", 1e-3);
    assert.equal(f.statut, "a_completer", "69 % : à compléter");
    assert.equal(f.points, null);
    assert.ok(f.frais.cout > 0);
    const g = crit(evalP1({ positions: avecTer(peaSeul), config: { frais_enveloppes: { "av linxea P1": { gestion_uc_pct: 0.5, gestion_euro_pct: 0.6, source: "x", le: "2026-10-01" } } } }), "frais");
    assert.equal(g.statut === "a_completer", false, "frais d'enveloppe reconnus malgré la casse");
    assert.equal(g.confiance, "partielle");
    assert.ok(g.ameliorer.some(a => a.gain_points === null && /Fais compléter par Claude/.test(a.action)));
  });

  test("natures : titres en direct, crypto et liquidités à 0 ; unités de compte d'un contrat = fonds ; SCPI à part", () => {
    const nat = p => Pratiques.natureFrais(p, {}, p.ter);
    const by = nom => P1.find(p => p.name === nom);
    assert.equal(nat(by("ASML")), "direct");
    assert.equal(nat(by("Bitcoin et cryptos")), "crypto");
    assert.equal(nat(by("Espèces PEA")), "liquidites");
    assert.equal(nat(by("Or")), "fonds", "unité de compte d'une assurance-vie");
    assert.equal(nat(by("Fonds euros")), "fonds_euros");
    assert.equal(nat(by("SCPI Rendement")), "scpi");
    assert.equal(nat(by("ETF S&P Eurozone")), "fonds");
    assert.equal(nat({ name: "Amundi MSCI World", envelope: "CTO", bloc: "Monde", isin: "LU1681043599" }), "fonds");
  });
});

describe("note globale (spec § 1.1 et § 3)", () => {
  const C = (famille, points, extra) => ({ famille, points, sur: 20, aCompleter: false, ameliorer: [], ...extra });
  test("critère sans données : points null, exclu des moyennes ; couverture par famille et globale ; provisoire sous 60 %", () => {
    const r = Pratiques.agreger([C("securite", 20), C("securite", null, { aCompleter: true }), C("effort", 10), C("allocation", 16), C("efficacite", null, { aCompleter: true }),
      C("efficacite", null, { aCompleter: true }), C("allocation", null, { informatif: true, sur: 0 })]);
    const s = r.familles.find(f => f.cle === "securite");
    assert.deepEqual([s.total, s.notes, s.attendus, s.couvertureTexte], [100, 1, 2, "calculée sur 1 critère sur 2"]);
    assert.equal(r.familles.find(f => f.cle === "efficacite").total, null);
    assert.deepEqual([r.criteresNotes, r.criteresAttendus], [3, 6]);
    assert.equal(r.couverture, 0.5);
    assert.equal(r.provisoire, true);
    assert.equal(r.couvertureTexte, "calculée sur 3 critères sur 6");
    assert.equal(Pratiques.agreger([C("securite", 20), C("effort", 10), C("allocation", 16), C("efficacite", null, { aCompleter: true })]).provisoire, false, "75 %");
  });
  test("points perdus = (20 − points) × poids rapporté à 100 ; gain_note de chaque action", () => {
    const a = C("effort", 10, { ameliorer: [{ action: "x", gain_points: 6 }] });
    const r = Pratiques.agreger([C("securite", 20), C("securite", 10), a, C("allocation", 20), C("efficacite", 0)]);
    // familles notées : 30 + 25 + 30 + 15 = 100 ; effort : 1 critère → (20 − 10) ÷ 20 × 25 = 12,5
    assert.equal(a.points_perdus, 12.5);
    assert.equal(a.ameliorer[0].gain_note, 7.5);
    assert.equal(r.familles[0].criteres[1].points_perdus, 7.5); // (20 − 10) ÷ (20 × 2) × 30
    assert.equal(r.familles[3].criteres[0].points_perdus, 15);
    assert.equal(r.total, 65);
    assert.deepEqual(r.couts.map(c => c.points_perdus), [15, 12.5, 7.5]);
  });
  test("coutsPrincipaux : top 3, accepte aussi Plan.score (items)", () => {
    const s = Plan.score({ positions: [{ id: "a", owner: "p1", bloc: "Monde", mode: "manual", value: 9000, status: "actif" }, { id: "b", owner: "p1", bloc: "Épargne", mode: "manual", value: 1000, status: "actif" }],
      profil: { foyer: { age: "a40" }, personnes: { p1: { salaire: 4000, salaireUnite: "nm" } } }, budget: [{ type: "depense", montant: 3000 }], scope: "foyer" });
    const c = Plan.coutsPrincipaux(s);
    assert.ok(c.length <= 3 && c.length > 0);
    assert.deepEqual(c.map(x => x.points_perdus), [...c.map(x => x.points_perdus)].sort((a, b) => b - a));
    assert.ok(s.items.every(i => i.points == null ? i.points_perdus == null : typeof i.points_perdus === "number"));
    assert.equal(s.couvertureTexte, "calculée sur " + s.calcules + " critères sur 5");
  });
});

/* ---------- relecture CP4 : nature des lignes, projection, projets proches, capacité d'épargne, mineurs ---------- */
const COMGEST = V("CTO", "Comgest Renaissance Europe C", "Europe", 50000, { isin: "FR0000295230" });
const ASML_CTO = L("CTO", "ASML", "Convictions", 10000, { isin: "NL0010273215", symbol: "ASML.AS" });
/* Cas I2 : 100 000 € à 1 % (compte-titres, frais connus) + unité de compte 40 000 € à 2 % sans frais de contrat renseignés. */
const CAS_I2 = [L("CTO", "ETF Monde", "Monde", 100000, { isin: "IE00000000A1", ter: 1 }), V("Assurance-vie Test", "Fonds actions Europe", "Europe", 40000, { isin: "LU00000000B2", ter: 2 })];
const RE_CONSEILLER = /conseill/i;

describe("relecture CP4 : frais (nature des lignes, projection, SCPI)", () => {
  test("I1 : « direct » seulement pour une action reconnue ; ligne manuelle avec ISIN = fonds ; ISIN non reconnu = fonds au TER inconnu", () => {
    const nat = p => Pratiques.natureFrais(p, {}, p.ter);
    assert.equal(nat(COMGEST), "fonds", "manuelle avec ISIN");
    assert.equal(nat({ ...COMGEST, mode: "market", qty: 10, price: 5000, value: null, symbol: "0P00000AYR.F" }), "fonds", "cotée, symbole de fonds");
    assert.equal(nat(ASML_CTO), "direct", "action : classe actions, nom sans motif de fonds, cotée, symbole d'action");
    assert.equal(nat({ ...ASML_CTO, symbol: null }), "direct", "symbole inconnu : la classe et le nom suffisent");
    assert.equal(nat(L("CTO", "Trésorerie plus", "Divers", 1000, { isin: "FR0000000999" })), "fonds", "ISIN hors classe actions");
    assert.equal(nat(L("CTO", "Lyxor CAC 40", "Europe", 1000, { isin: "FR0007052782" })), "fonds", "nom de fonds");
    assert.equal(nat(L("CTO", "Air Liquide", "Convictions", 1000, { isin: "IE0000000777" })), "fonds", "ISIN IE / LU : fonds");
    assert.equal(nat(V("PEA", "Espèces PEA", "Liquidités", 60)), "liquidites", "espèces sans ISIN hors contrat");
  });

  test("I1 : « Comgest Renaissance Europe C » 50 000 € → à compléter, plus 20/20", () => {
    const f = crit(evalP1({ positions: [ASML_CTO, COMGEST] }), "frais");
    assert.equal(f.statut, "a_completer");
    assert.equal(f.points, null);
    assert.deepEqual(f.frais.fondsSansFrais.map(x => x.nom), ["Comgest Renaissance Europe C"]);
    proche(f.frais.couverture, 10000 / 60000, "seule l'action est couverte", 1e-3);
    const avant = crit(evalP1({ positions: [ASML_CTO, { ...COMGEST, ter: 1.8 }] }), "frais");
    assert.equal(avant.points, Pratiques.BAREME_FRAIS(1.8 * 50000 / 60000), "TER connu : noté");
    assert.notEqual(avant.points, 20);
  });

  test("UC monétaire d'un contrat → fonds (frais d'enveloppe appliqués)", () => {
    const uc = V("Assurance-vie Test", "Support monétaire", "Monétaire", 10000);
    assert.equal(Pratiques.natureFrais(uc, {}, null), "fonds");
    const f = crit(evalP1({ positions: [{ ...uc, ter: 0.1 }], config: { frais_enveloppes: { "Assurance-vie Test": { gestion_uc_pct: 0.5, source: "CG", le: "2026-10-01" } } } }), "frais");
    proche(f.valeur, 0.6, "TER + gestion du contrat", 1e-9);
  });

  test("I2 : surcoût, coût « après » et projection calculés sur les seules lignes au coût total connu ; jamais négatif", () => {
    const f = crit(evalP1({ positions: CAS_I2, config: {} }), "frais");
    proche(f.frais.couverture, 100000 / 140000, "couverture 71 %", 1e-3);
    assert.equal(f.points, 10, "1 % sur la part connue");
    assert.deepEqual(f.frais.auDessusRepere.map(x => x.nom), ["ETF Monde"], "l'unité de compte sans frais de contrat n'entre pas dans le surcoût");
    assert.equal(f.frais.projection.ecart.annuel, 700);
    const a = f.ameliorer[0];
    assert.match(a.action, /ton coût passerait à 0,3 % par an \(≈ −700 € par an\)/, a.action);
    assert.equal(a.gain_points, 10);
    assert.doesNotMatch(JSON.stringify(f), /passerait à −/);
    assert.ok(f.frais.projection.ecart.ans10 > 0 && f.frais.projection.ecart.ans20 > f.frais.projection.ecart.ans10);
  });

  test("portefeuille 100 % SCPI : l'information SCPI reste visible (critère informatif, sans note)", () => {
    const r = evalP1({ positions: [V("AV Test", "SCPI Rendement", "SCPI", 20000)], config: {} });
    const f = crit(r, "frais");
    assert.ok(f, "critère présent");
    assert.equal(f.statut, "information");
    assert.equal(f.points, null);
    assert.deepEqual(f.frais.scpi.map(x => x.valeur), [20000]);
    assert.ok(f.calcul.some(l => /SCPI \(20 000 €\) à part/.test(l)), f.calcul.join(" | "));
    assert.ok(!r.familles.find(x => x.cle === "efficacite").criteres.filter(c => c.cle === "frais").some(c => c.points_perdus != null));
  });
});

describe("relecture CP4 : projets proches, capacité d'épargne, couverture, textes", () => {
  test("horizon des projets proches : 36 mois (spec : moins de 3 ans)", () => {
    const o = (date, extra = {}) => [{ id: "v", nom: "Voyage", type: "projet", cible: 10000, dateCible: date, source: "saisi", deja: 0, priorite: 2, ...extra }];
    assert.ok(crit(evalP1({ objectifs: o("2029-09-30") }), "liquidite_objectifs"), "35 mois");
    assert.equal(crit(evalP1({ objectifs: o("2029-11-30") }), "liquidite_objectifs"), undefined, "37 mois");
    assert.match(B_LIQ().cible, /moins de 3 ans/);
  });

  test("I2 bis : objectif court sans montant → à compléter ; objectif matelas exclu du besoin", () => {
    const voyage = { id: "v", nom: "Voyage", type: "projet", cible: null, dateCible: "2027-06-30", source: "saisi", priorite: 2 };
    const c = crit(evalP1({ objectifs: [...OBJECTIFS, voyage] }), "liquidite_objectifs");
    assert.equal(c.statut, "a_completer");
    assert.equal(c.points, null);
    assert.match(c.texte, /montant de « Voyage » manquant/i);
    assert.ok(c.manque.some(m => /« Voyage »/.test(m)));
    const matelas = { id: "m", nom: "Matelas", type: "matelas", cible: 20000, dateCible: "2027-01-01", source: "saisi", priorite: 0 };
    const avec = crit(evalP1({ objectifs: [...OBJECTIFS, matelas] }), "liquidite_objectifs");
    proche(avec.valeur, crit(evalP1(), "liquidite_objectifs").valeur, "le matelas n'entre pas dans le besoin");
    assert.equal(crit(evalP1({ objectifs: [matelas] }), "liquidite_objectifs"), undefined, "seul un matelas : sans objet");
  });

  test("I3 : projets proches = argent sûr MOINS le matelas visé, écrit dans le calcul", () => {
    const sur = 7640 + 25 + 55 + 65 + 80 + 420;
    const c = crit(evalP1({ config: { cushion: { mode: "amount", min: 5000, max: null } } }), "liquidite_objectifs");
    proche(c.valeur, (sur - 5000) / 50000, "matelas visé retiré");
    assert.ok(c.calcul.some(l => /matelas visé \(5 000 €\)/.test(l)), c.calcul.join(" | "));
    const tout = crit(evalP1({ config: { cushion: { mode: "months", months: 6, depenses: 5000 } } }), "liquidite_objectifs");
    assert.equal(tout.valeur, 0, "matelas visé au-delà de l'argent sûr : rien pour les projets");
    assert.ok(crit(evalP1(), "liquidite_objectifs").calcul.some(l => /aucun matelas visé/i.test(l)));
  });

  test("I4 : capacité réelle négative (dépenses > revenus) : note 0, texte honnête", () => {
    const b = { ...BANQUE, mois: BANQUE.mois.map(m => (m.categorie === "logement" ? { ...m, sorties: 4000 } : m)) };
    const e = crit(evalP1({ banque: b }), "epargne");
    assert.ok(e.valeur < 0);
    assert.equal(e.points, 0);
    assert.match(e.texte, /^Tes dépenses dépassent tes revenus de /);
  });

  test("provisoire faux quand la note globale est absente ; jauge du patrimoine dans l'unité de sa mesure (% du repère)", () => {
    const r = Pratiques.agreger([{ famille: "securite", points: null, sur: 20, aCompleter: true, ameliorer: [] }]);
    assert.equal(r.total, null);
    assert.equal(r.provisoire, false);
    const s = Plan.score({ positions: [{ id: "a", owner: "p1", bloc: "Monde", mode: "manual", value: 90000, status: "actif" }],
      profil: { foyer: { age: "a40" }, personnes: { p1: { salaire: 4000, salaireUnite: "nm" } } }, budget: [{ type: "depense", montant: 3000 }], scope: "foyer" });
    const p = s.items.find(i => i.cle === "patrimoine");
    assert.equal(p.mesure.unite, "% du repère");
    const z = p.repere.zones;
    assert.equal(z[z.length - 1].statut, "bon");
    assert.equal(z[z.length - 2].jusqua, 77.5, "bon à partir de 77,5 % du repère (16/20), dans l'unité de mesure.valeur");
  });

  test("textes : « repère courant en gestion de patrimoine », jamais « conseiller » ; plus de promesse « personne de l'objectif »", () => {
    const r = evalP1();
    for (const c of r.criteres) {
      assert.doesNotMatch(c.source || "", RE_CONSEILLER, c.cle);
      assert.doesNotMatch(c.regle || "", /personne de l'objectif/, c.cle);
    }
    assert.match(crit(r, "matelas").source, /^Repère courant en gestion de patrimoine/);
    assert.doesNotMatch(readFileSync(new URL("../web/src/pratiques.js", import.meta.url), "utf8"), RE_CONSEILLER);
  });
});
const B_LIQ = () => crit(evalP1({ objectifs: [{ id: "v", nom: "Voyage", type: "projet", cible: 10000, dateCible: "2027-06-30", source: "saisi", deja: 0, priorite: 2 }] }), "liquidite_objectifs");

/* ---------- parité app / connecteur sur le jeu p1 (bloc de calcul pur d'index.ts) ---------- */
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const path = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
const src = readFileSync(path("supabase/functions/mcp/index.ts"), "utf8");
function portMcp() {
  const debut = src.indexOf("/* Utilitaires"), fin = src.indexOf("/* Schémas d'entrée");
  const bloc = src.slice(src.lastIndexOf("/*", debut - 1), src.lastIndexOf("/*", fin - 1));
  const js = strip(bloc, { mode: "strip" }) + "\n;({ bonnesPratiques, scoreSante, fraisSupports, periodeReel, coutsPrincipaux, val, counted, inScope, horsCourants, classeRisque, classePoche, liquidite, bilan, syntheseRisque, CLASSES_RISQUE, GROUPES_LABELS });";
  return vm.runInNewContext(js, { Intl, Date, Math, JSON, Number, String, Object, Array, Set, Map, isFinite, isNaN, Infinity, Error, structuredClone, console });
}
/* Lignes SQL (instrument joint) et banque lue par chargerDonnees. */
const enSql = P => P.map(p => ({ id: p.id, name: p.name, envelope: p.envelope, owner: p.owner, bloc: p.bloc, mode: p.mode, isin: p.isin, qty: p.qty, value: p.value, status: p.status,
  price_override: null, instrument: p.mode === "market" ? { price: p.price, ter: p.ter, zone: p.zone, devise: p.devise } : (p.ter != null ? { ter: p.ter } : null) }));
const banqueSql = b => ({ comptes: b.comptes.map(({ doublonDe, ...c }) => ({ ...c, doublon_de: doublonDe })), mois: b.mois.map(({ compteId, ...m }) => ({ ...m, compte_id: compteId })) });
const objSql = O => O.map(({ dateCible, ...o }) => ({ ...o, date_cible: dateCible }));
const CHAMPS_PARITE = ["statut", "points", "max", "mesure", "repere", "pourquoi", "calcul", "donnees", "ameliorer", "manque", "source_donnees", "confiance", "points_perdus", "texte", "piste", "regle", "source", "cible"];

function comparer(web, mcp, L) {
  assert.deepEqual(J(mcp.criteres.map(c => c.cle)), web.criteres.map(c => c.cle), L + " : critères");
  web.criteres.forEach((w, i) => {
    const m = mcp.criteres[i], C = `${L} / ${w.cle}`;
    assert.equal(m.a_completer, w.aCompleter, C);
    if (w.valeur != null) proche(m.valeur, Math.round(w.valeur * 1000) / 1000, C + " : valeur", 1e-9);
    for (const ch of CHAMPS_PARITE) assert.deepEqual(J(m[ch]), J(w[ch]), C + " : " + ch);
    if (w.tableau) assert.deepEqual(J(m.tableau), J(w.tableau), C + " : tableau");
  });
  assert.equal(mcp.total, web.total, L + " : total");
  proche(mcp.couverture, Math.round(web.couverture * 1000) / 1000, L + " : couverture", 1e-9);
  assert.equal(mcp.provisoire, web.provisoire, L + " : provisoire");
  assert.equal(mcp.couverture_texte, web.couvertureTexte, L);
  assert.deepEqual([mcp.criteres_notes, mcp.criteres_attendus], [web.criteresNotes, web.criteresAttendus], L);
  assert.deepEqual(J(mcp.familles.map(f => [f.cle, f.total, f.notes, f.attendus, f.couverture_texte])), J(web.familles.map(f => [f.cle, f.total, f.notes, f.attendus, f.couvertureTexte])), L);
  assert.deepEqual(J(mcp.couts_principaux), J(web.couts), L + " : couts");
}

test("parité app / connecteur : jeu p1 (budget réel, sans frais, avec frais, profils), tous les critères et le contrat", { skip: SANS_STRIP }, () => {
  const M = portMcp();
  const TER = { "ETF Nasdaq-100 levier ×2": 0.6, "ETF S&P Eurozone": 0.15, "ETF émergents": 0.25, "ETF Monde": 0.2, "ETF World": 0.95, "Or": 0.12, "PER Linxea": 1.8 };
  const FE = { "AV Linxea p1": { gestion_uc_pct: 0.5, gestion_euro_pct: 0.6, source: "CG", le: "2026-10-01" }, PER: { gestion_uc_pct: 0.7, source: "DIC", le: "2026-10-01" } };
  const scenarios = [
    { nom: "p1 brut" },
    { nom: "p1 sans banque", banque: null },
    { nom: "p1 avec frais", positions: P1.map(p => (TER[p.name] != null ? { ...p, ter: TER[p.name] } : p)), config: { frais_enveloppes: FE } },
    { nom: "p1 profil prudent, à recevoir inclus", risque: { profil: "prudent" }, objectifs: [{ ...OBJECTIFS[0], inclureARecevoir: true }] },
    { nom: "p1 sans profil", risque: null },
  ];
  for (const sc of scenarios) for (const scope of ["foyer", "p1"]) {
    const ctx = { ...CTX, ...sc, scope };
    const web = Pratiques.evaluer(ctx);
    const banque = ctx.banque ? banqueSql(ctx.banque) : null;
    const mcp = M.bonnesPratiques({ d: { profil: ctx.profil, biens: [], credits: [], positions: enSql(ctx.positions), config: ctx.config, lignes: ctx.budget.lignes, banque },
      scope, objectifs: objSql(ctx.objectifs), risque: ctx.risque, classes: ctx.classes, ref: TODAY });
    comparer(web, mcp, `${sc.nom} / ${scope}`);
    const fw = crit(web, "frais"), fm = mcp.criteres.find(c => c.cle === "frais");
    if (fw) assert.deepEqual(J(fm.frais), J({ encours: fw.frais.encours, encours_connu: fw.frais.encoursConnu, couverture: fw.frais.couverture, cout: fw.frais.cout, pct: fw.frais.pct,
      plus_couteuses: fw.frais.plusCouteuses.map(l => ({ id: l.id, nom: l.nom, enveloppe: l.enveloppe, valeur: l.valeur, frais_pct: l.fraisPct, cout_annuel: l.coutAnnuel })),
      au_dessus_repere: fw.frais.auDessusRepere.map(x => ({ id: x.id, nom: x.nom, enveloppe: x.enveloppe, valeur: x.valeur, ter: x.ter, classe: x.classe, repere: x.repere, ecart_pct: x.ecartPct, surcout: x.surcout })),
      scpi: fw.frais.scpi, fonds_sans_frais: fw.frais.fondsSansFrais, enveloppes_a_completer: fw.frais.enveloppesACompleter,
      projection: { rendement_pct: 5, frais: fw.frais.projection.frais, ecart: fw.frais.projection.ecart } }), sc.nom + " : détail des frais");
  }
  assert.equal(M.periodeReel({ du: "2025-11-01", au: "2026-01-01" }), Calc.periodeReel({ du: "2025-11-01", au: "2026-01-01" }));
  assert.equal(Calc.periodeReel({ du: "2025-11-01", au: "2026-01-01" }), "novembre 2025 à janvier 2026");
});

test("parité app / connecteur : démo et scores clairsemés (contrat et couverture)", { skip: SANS_STRIP }, () => {
  const M = portMcp();
  const enLignes = D => ({ d: { profil: D.profil, biens: D.profil.biens || [], credits: D.profil.credits || [], positions: enSql(D.positions.map(p => ({ ...p, value: p.value }))), config: D.config, lignes: D.budget.lignes },
    objectifs: objSql(D.objectifs) });
  for (const risque of [null, { profil: "equilibre" }]) for (const scope of ["foyer", "p1", "p2"]) {
    const web = Pratiques.evaluer({ positions: DEMO.positions, profil: DEMO.profil, config: DEMO.config, budget: DEMO.budget, objectifs: DEMO.objectifs, scope, risque, today: TODAY });
    const { d, objectifs } = enLignes(DEMO);
    comparer(web, M.bonnesPratiques({ d, scope, objectifs, risque, classes: undefined, ref: TODAY }), `démo ${JSON.stringify(risque)} / ${scope}`);
    // score de santé (Plan.score) : mêmes items, contrat compris
    const ps = Plan.score({ positions: DEMO.positions, profil: DEMO.profil, config: DEMO.config, budget: DEMO.budget, scope });
    const ms = M.scoreSante(d, scope);
    assert.equal(ms.total, ps.total); assert.equal(ms.provisoire, ps.provisoire); assert.equal(ms.couverture_texte, ps.couvertureTexte);
    ps.items.forEach((w, i) => { for (const ch of ["statut", "points", "mesure", "repere", "pourquoi", "calcul", "ameliorer", "manque", "source_donnees", "confiance", "points_perdus"])
      assert.deepEqual(J(ms.items[i][ch]), J(w[ch]), `score ${scope} / ${w.cle} : ${ch}`); });
  }
});

test("parité analyser (angle frais) ↔ pratiques.js : mêmes chiffres que le critère frais", { skip: SANS_STRIP }, () => {
  const M = portMcp();
  const srcA = readFileSync(path("supabase/functions/mcp/analyser.ts"), "utf8");
  const fauxZ = () => { const f = new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : new Proxy(function () {}, { get: () => f, apply: () => f })), apply: () => f }); return f; };
  const noms = [...srcA.matchAll(/^export (?:const|function|async function) (\w+)/gm)].map(m => m[1]);
  const js = strip(srcA, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function)/gm, "$1");
  const A = vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, { z: fauxZ(), RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console, isFinite, Infinity, Intl, RangeError, Error });
  const P = P1.map(p => (p.name === "ETF World" ? { ...p, ter: 0.95 } : p.name === "ETF Monde" ? { ...p, ter: 0.2 } : p));
  const cfg = { frais_enveloppes: { "AV Linxea p1": { gestion_uc_pct: 0.5, gestion_euro_pct: 0.6, source: "CG", le: "2026-10-01" } } };
  const donnees = { profil: PROFIL, biens: [], credits: [], positions: enSql(P), config: cfg, lignes: BUDGET.lignes };
  const r = A.analyse("frais", { scope: "foyer", donnees, objectifs: [], risque: null, classes: {}, auj: TODAY, calcul: M });
  const f = crit(Pratiques.evaluer({ ...CTX, positions: P, config: cfg }), "frais");
  assert.equal(r.chiffres.encours_investi, Math.round(f.frais.encours));
  assert.equal(r.chiffres.encours_frais_connus, Math.round(f.frais.encoursConnu));
  assert.equal(r.chiffres.cout_annuel_eur, Math.round(f.frais.cout));
  assert.equal(r.chiffres.cout_pct, f.frais.pct == null ? null : Math.round(f.frais.pct * 100) / 100);
  assert.equal(r.chiffres.couverture_pct, Math.round(f.frais.couverture * 1000) / 10);
  assert.deepEqual(J(r.details.plus_cheres.map(l => l.nom)), f.frais.plusCouteuses.map(l => l.nom));
  assert.deepEqual(J(r.details.au_dessus_du_repere.map(l => l.nom)), f.frais.auDessusRepere.map(l => l.nom));
  assert.ok(r.hypotheses.some(h => /5 % par an/.test(h)), "hypothèse de rendement affichée");
});

test("parité app / connecteur : relecture CP4 (nature des lignes, projection, projets proches, matelas visé, SCPI seule, capacité réelle)", { skip: SANS_STRIP }, () => {
  const M = portMcp();
  const enSqlSym = P => enSql(P).map((r, i) => (P[i].symbol ? { ...r, instrument: { ...(r.instrument || {}), symbol: P[i].symbol } } : r));
  const voyage = { id: "v", nom: "Voyage", type: "projet", cible: null, dateCible: "2027-06-30", source: "saisi", priorite: 2 };
  const matelas = { id: "m", nom: "Matelas", type: "matelas", cible: 20000, dateCible: "2027-01-01", source: "saisi", priorite: 0 };
  const scenarios = [
    { nom: "Comgest", positions: [ASML_CTO, COMGEST, { ...COMGEST, id: "cg2", mode: "market", qty: 1, price: 2000, value: null, symbol: "0P00000AYR.F" }] },
    { nom: "I2", positions: CAS_I2, config: {} },
    { nom: "objectif sans montant", objectifs: [...OBJECTIFS, voyage] },
    { nom: "objectif matelas", objectifs: [...OBJECTIFS, matelas] },
    { nom: "matelas visé", config: { cushion: { mode: "amount", min: 5000, max: null } } },
    { nom: "SCPI seule", positions: [V("AV Test", "SCPI Rendement", "SCPI", 20000)], config: {} },
    { nom: "UC monétaire", positions: [V("Assurance-vie Test", "Support monétaire", "Monétaire", 10000, { ter: 0.1 })], config: { frais_enveloppes: { "Assurance-vie Test": { gestion_uc_pct: 0.5, source: "CG", le: "2026-10-01" } } } },
  ];
  for (const sc of scenarios) for (const scope of ["foyer", "p1"]) {
    const ctx = { ...CTX, ...sc, scope };
    const web = Pratiques.evaluer(ctx);
    const mcp = M.bonnesPratiques({ d: { profil: ctx.profil, biens: [], credits: [], positions: enSqlSym(ctx.positions), config: ctx.config, lignes: ctx.budget.lignes, banque: banqueSql(ctx.banque) },
      scope, objectifs: objSql(ctx.objectifs), risque: ctx.risque, classes: ctx.classes, ref: TODAY });
    comparer(web, mcp, `${sc.nom} / ${scope}`);
  }
  // provisoire faux sans note globale (connecteur aussi)
  const vide = M.bonnesPratiques({ d: { profil: {}, biens: [], credits: [], positions: [], config: {}, lignes: [] }, scope: "foyer", objectifs: [], risque: null, classes: {}, ref: TODAY });
  const videW = Pratiques.evaluer({ positions: [], profil: {}, config: {}, budget: [], objectifs: [], scope: "foyer", risque: null, today: TODAY });
  assert.equal(vide.total, videW.total);
  assert.equal(vide.provisoire, videW.provisoire);
  if (videW.total == null) assert.equal(vide.provisoire, false);
  // capacité réelle : même budget réel
  assert.deepEqual(J(M.bonnesPratiques({ d: { profil: PROFIL, biens: [], credits: [], positions: enSql(P1), config: {}, lignes: BUDGET.lignes, banque: banqueSql(BANQUE) }, scope: "foyer",
    objectifs: objSql(OBJECTIFS), risque: null, classes: {}, ref: TODAY }).criteres.find(c => c.cle === "epargne").donnees), J(crit(evalP1(), "epargne").donnees));
  assert.doesNotMatch(src, /conseillers en gestion|Repère usuel des conseillers/);
});
