// Aujourd'hui × rendement : le panneau de la carte « Patrimoine net » donne le rendement réel sur 1 an (« ton rendement » pondéré par l'argent, « rendement de tes placements » pondéré par le temps)
// et, quand le graphe a calculé la projection, ce que le modèle en attendait ; jamais un chiffre sans historique. Données fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const A = require("../web/src/aujourdhui.js");
const Calc = require("../web/src/calc.js"), BilanCalc = require("../web/src/bilan-calc.js"), Rules = require("../web/src/rules.js"), Plan = require("../web/src/plan.js"), Pratiques = require("../web/src/pratiques.js"),
  Risque = require("../web/src/risque.js"), Periodes = require("../web/src/periodes.js"), R = require("../web/src/rendement.js");
const DEPS = { Rules, Plan, Pratiques, Calc, BilanCalc, Risque, Periodes };
const TODAY = "2026-10-14";
const sp = s => String(s).replace(/[  ]/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const iso = t => new Date(t).toISOString().slice(0, 10);
const jourMoins = k => iso(Date.UTC(2026, 9, 14) - k * 864e5);

/** Foyer fictif : 10 000 € de placements (ETF + livret) et un compte courant ; relevés quotidiens à +0,02 % par jour ; un versement de 100 € le 5 de chaque mois. */
function etat(jours, o) {
  const opt = o || {}, positions = [
    { id: "etf", name: "ETF Monde", envelope: "PEA", owner: "p1", bloc: "Monde", mode: "manual", value: 8000, status: "actif" },
    { id: "liv", name: "Livret A", envelope: "Livret A", owner: "p1", bloc: "Épargne", mode: "manual", value: 2000, status: "actif" },
    { id: "cc", name: "Compte courant", envelope: "Compte courant", owner: "p1", bloc: "Comptes courants", mode: "manual", value: 3000, status: "actif" },
  ];
  const snaps = [], tx = [];
  /* on remonte le temps depuis la valeur d'aujourd'hui (10 000 €) : la veille vaut (aujourd'hui − versement du jour) / 1,0002, versement compris dans le relevé du jour */
  let v = 10000;
  for (let k = 1; k <= jours; k++) {
    const dprec = jourMoins(k - 1), verse = dprec.slice(8, 10) === "05" && !opt.sansTx ? 100 : 0;
    v = (v - verse) / 1.0002;
    if (verse) tx.push({ id: "t" + k, date: dprec, type: "versement", positionId: "etf", amount: 100 });
    snaps.unshift({ date: jourMoins(k), foyer: v + 3000, p1: v + 3000, p2: 0, byBloc: { p1: { Monde: v * 0.8, "Épargne": v * 0.2, "Comptes courants": 3000 } } });
  }
  return { ready: true, dbOk: true, positions, snapshots: snaps, tx, config: {}, profil: { foyer: { adultes: 1 }, biens: [], credits: [] }, budget: null, objectifs: [], risque: null, classes: {}, scope: "foyer",
    people: [{ id: "p1", nom: "Camille" }], error: null };
}

test("indicateurs : le rendement réel des placements est calculé depuis les relevés et les transactions (périodes), sans les comptes courants", () => {
  const ind = A.indicateurs(etat(400), TODAY, { id: "1a" }, DEPS), rd = ind.net.rendement;
  assert.ok(rd, "bloc rendement"); assert.deepEqual(rd.periodes.map(p => p.id), ["1m", "3m", "1a", "debut"]);
  const un = rd.periodes.find(p => p.id === "1a");
  assert.equal(un.statut, "ok"); assert.equal(un.jours, 365);
  /* les relevés des placements gagnent 0,02 % par jour sans les versements dans la formule ; mais les versements sont ajoutés au relevé : le TWR en tient compte */
  assert.ok(un.twr_annuel_pct > 0, "positif : " + un.twr_annuel_pct);
});
test("indicateurs : sans relevé, pas de rendement (null) ; avec peu de relevés, « pas assez d'historique » par période", () => {
  assert.equal(A.indicateurs(etat(0), TODAY, { id: "1a" }, DEPS).net.rendement, null);
  const court = A.indicateurs(etat(15), TODAY, { id: "1a" }, DEPS).net.rendement;
  court.periodes.forEach(p => assert.equal(p.statut, "insuffisant", p.id));
});
test("détail (Patrimoine net) : « Rendement sur 1 an » — ton rendement et le rendement de tes placements, annualisés, avec net de frais / avant impôts ; avant l'accordéon du détail ligne par ligne", () => {
  const ind = A.indicateurs(etat(400), TODAY, { id: "1a" }, DEPS), d = A.detail("net", ind, { id: "1a" }), c = sp(d.contenu);
  const un = ind.net.rendement.periodes.find(p => p.id === "1a");
  assert.match(c, /Rendement sur 1 an/);
  assert.ok(c.includes("Ton rendement"), "Ton rendement"); assert.ok(c.includes("Rendement de tes placements"), "Rendement de tes placements");
  const pc = v => R.pct(v).replace(/ /g, " ");
  assert.ok(sp(c).includes(pc(un.xirr_annuel_pct) + "/an"), "XIRR annualisé " + pc(un.xirr_annuel_pct));
  assert.ok(sp(c).includes(pc(un.twr_annuel_pct) + "/an"), "TWR annualisé " + pc(un.twr_annuel_pct));
  assert.match(c, /net de frais, avant impôts/i); assert.match(c, /comptes courants/);
  assert.ok(c.indexOf("Rendement sur 1 an") < c.indexOf("<details"), "avant le détail ligne par ligne");
  /* les lignes de la composition restent intactes (mêmes balises que l'existant) */
  const resume = c.split("<details")[0];
  assert.match(resume, /<li><span class="aj-det-l">Patrimoine net<\/span>/);
});
test("détail : avec ce que le modèle en attendait (calculé par le graphe), la ligne « Attendu » et la phrase réel contre attendu, avec leur source", () => {
  const ind = A.indicateurs(etat(400), TODAY, { id: "1a" }, DEPS);
  const periodes = ind.net.rendement.periodes.map(p => (p.id === "1a" ? Object.assign({}, p, {
    attendu: { statut: "ok", attendu_pct: 4.9, p10_pct: -3, p50_pct: 5, p90_pct: 12, annualise: true },
    comparaison: R.comparer({ valeur_pct: p.twr_annuel_pct, annualise: true }, { statut: "ok", attendu_pct: 4.9, p10_pct: -3, p50_pct: 5, p90_pct: 12 }),
    source: { type: "hypotheses_actuelles", texte: "hypothèses d'aujourd'hui appliquées à ton allocation du 14 oct. 2025 (approximation)" } }) : p));
  const c = sp(A.detail("net", ind, { id: "1a" }, { rendement: { periodes } }).contenu);
  assert.match(c, /Attendu par le modèle/); assert.match(c, /4,9 %\/an/); assert.match(c, /fourchette 8 sur 10 : −3 % à \+12 %/);
  assert.match(c, /Réel [\d,]+ %\/an contre 4,9 % attendu/); assert.match(c, /hypothèses d'aujourd'hui appliquées à ton allocation du 14 oct\. 2025 \(approximation\)/i);
  /* sans le calcul du graphe : pas de ligne « Attendu » (jamais un chiffre inventé) */
  assert.doesNotMatch(sp(A.detail("net", ind, { id: "1a" }).contenu), /Attendu par le modèle/);
});
test("détail : historique trop court pour 1 an — la plus longue période mesurable est donnée (depuis le premier relevé), et dite ; trop peu de relevés : « pas assez d'historique »", () => {
  const cinq = sp(A.detail("net", A.indicateurs(etat(150), TODAY, { id: "1a" }, DEPS), { id: "1a" }).contenu);
  assert.match(cinq, /Rendement depuis ton premier relevé \(5 mois\)/); assert.match(cinq, /Ton rendement/); assert.doesNotMatch(cinq, /Rendement sur 1 an/);
  assert.match(cinq, /pas assez d'historique pour 1 an/i);
  const rien = sp(A.detail("net", A.indicateurs(etat(15), TODAY, { id: "1a" }, DEPS), { id: "1a" }).contenu);
  assert.match(rien, /Rendement : pas assez d'historique/);
  const debut = sp(A.detail("net", A.indicateurs(etat(50), TODAY, { id: "1a" }, DEPS), { id: "1a" }).contenu);
  assert.match(debut, /Rendement depuis ton premier relevé \(50 jours\)/); assert.match(debut, /\(depuis ton premier relevé\)/);
  const vide = sp(A.detail("net", A.indicateurs(etat(0), TODAY, { id: "1a" }, DEPS), { id: "1a" }).contenu);
  assert.doesNotMatch(vide, /Rendement/);
});
test("détail : versements inconnus (aucune transaction) — le rendement est approché, dit ; jamais de « conseil »", () => {
  const c = sp(A.detail("net", A.indicateurs(etat(400, { sansTx: true }), TODAY, { id: "1a" }, DEPS), { id: "1a" }).contenu);
  assert.match(c, /approché/); assert.match(c, /versements inconnus/i);
  assert.doesNotMatch(c, /conseill/i);
});
