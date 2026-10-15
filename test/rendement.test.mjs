// Rendement réel (web/src/rendement.js) : « ton rendement » (XIRR, pondéré par l'argent), « rendement de tes placements » (TWR, sans l'effet des versements),
// 1 mois / 3 mois / 1 an / depuis le début, annualisé seulement à partir d'un an, net de frais par construction (valeurs de marché), honnête quand l'historique est
// court ou les versements inconnus ; rendement attendu d'une allocation sur une durée (hypothèses de classe, bande 8 chances sur 10) ; réel contre estimé.
// Attendus calculés à la main (formules dans les commentaires) ou, pour l'XIRR, par l'exemple de la documentation d'Excel (0,373362535). Données fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const R = req("../web/src/rendement.js");

const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b + " (tolérance " + tol + ")");
const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ");
const ms = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = t => new Date(t).toISOString().slice(0, 10);
const plusJ = (s, k) => iso(ms(s) + k * 864e5);
const AUJ = "2026-10-14";

/** Valeur après k jours à croissance quotidienne g (rendement quotidien constant, sans flux). */
const serieCroissance = (debut, jours, v0, g) => Array.from({ length: jours + 1 }, (_, k) => ({ date: plusJ(debut, k), valeur: v0 * Math.pow(1 + g, k) }));

/* ================================================================== XIRR */
test("XIRR : l'exemple de la documentation d'Excel (5 flux datés) donne 0,373362535", () => {
  const f = [["2008-01-01", -10000], ["2008-03-01", 2750], ["2008-10-30", 4250], ["2009-02-15", 3250], ["2009-04-01", 2750]].map(([date, montant]) => ({ date, montant }));
  proche(R.xirr(f), 0.373362535, 1e-8);
});
test("XIRR : 1 000 € le 1er janvier, 1 100 € un an (365 jours) plus tard = 10 %", () => {
  proche(R.xirr([{ date: "2025-01-01", montant: -1000 }, { date: "2026-01-01", montant: 1100 }]), 0.1, 1e-10);
});
test("XIRR : un versement en cours d'année pèse selon sa date (10 000 € au départ, 1 000 € le 1er juillet, 12 000 € à la fin) = 9,53 %", () => {
  /* −10 000 − 1 000/x^(181/365) + 12 000/x = 0, x = 1 + r : résolu à la main par encadrement (9 % → +51, 10 % → −45), puis affiné */
  const r = R.xirr([{ date: "2025-01-01", montant: -10000 }, { date: "2025-07-01", montant: -1000 }, { date: "2026-01-01", montant: 12000 }]);
  proche(r, 0.0953040647, 1e-8);
  const npv = -10000 - 1000 / Math.pow(1 + r, 181 / 365) + 12000 / (1 + r);
  proche(npv, 0, 1e-6, "valeur actuelle nette nulle");
});
test("XIRR : sans changement de signe, ou avec moins de deux flux, il n'existe pas (null), jamais un nombre inventé", () => {
  assert.equal(R.xirr([{ date: "2025-01-01", montant: -1000 }, { date: "2026-01-01", montant: -5 }]), null);
  assert.equal(R.xirr([{ date: "2025-01-01", montant: -1000 }]), null);
  assert.equal(R.xirr([]), null);
  assert.equal(R.xirr([{ date: "2025-01-01", montant: 0 }, { date: "2026-01-01", montant: 0 }]), null);
  assert.equal(R.xirr([{ date: "2025-01-01", montant: -1000 }, { date: "2025-01-01", montant: 1100 }]), null, "même jour : durée nulle");
});
test("XIRR : une perte totale vaut −100 % (null plutôt qu'un taux non défini), un gain sur quelques jours reste fini", () => {
  const perte = R.xirr([{ date: "2025-01-01", montant: -1000 }, { date: "2026-01-01", montant: 1 }]);
  proche(perte, -0.999, 1e-9);
  const court = R.xirr([{ date: "2026-01-01", montant: -1000 }, { date: "2026-01-11", montant: 1010 }]);
  proche(court, Math.pow(1.01, 365 / 10) - 1, 1e-8, "1 % en 10 jours, annualisé");
});

/* ================================================================== TWR */
test("TWR sans flux : 1 000 → 1 100 = +10 %", () => {
  const t = R.twr([{ date: "2025-01-01", valeur: 1000 }, { date: "2026-01-01", valeur: 1100 }], []);
  proche(t.cumule, 0.1, 1e-12);
});
test("TWR : le versement ne fait pas le rendement (100 000 € qui montent de 10 %, +100 000 € versés, puis −5 % : 1,10 × 0,95 − 1 = +4,5 %)", () => {
  /* le versement est daté du jour du relevé qui le contient : il est compté en fin de journée (le relevé du 31 janvier vaut 210 000 € = 110 000 + 100 000) */
  const pts = [{ date: "2026-01-01", valeur: 100000 }, { date: "2026-01-31", valeur: 210000 }, { date: "2026-03-02", valeur: 199500 }];
  const t = R.twr(pts, [{ date: "2026-01-31", montant: 100000 }]);
  proche(t.cumule, 0.045, 1e-12);
});
test("TWR : versement au milieu d'un intervalle sans relevé = Dietz modifié (1 000 → 1 210 avec +100 à mi-période : 110 / (1 000 + 0,5 × 100) = 10,476 %)", () => {
  const pts = [{ date: "2026-01-01", valeur: 1000 }, { date: "2026-01-31", valeur: 1210 }];
  const t = R.twr(pts, [{ date: "2026-01-16", montant: 100 }]);
  proche(t.cumule, 110 / 1050, 1e-12);
});
test("TWR : un retrait compte comme un versement négatif (1 000 → 600 après −500 : (600 + 500)/1 000 − 1 = +10 %)", () => {
  const t = R.twr([{ date: "2026-01-01", valeur: 1000 }, { date: "2026-01-31", valeur: 600 }], [{ date: "2026-01-31", montant: -500 }]);
  proche(t.cumule, 0.1, 1e-12);
});
test("TWR : le portefeuille part de zéro (première ligne ouverte plus tard) — la mesure commence au premier relevé positif", () => {
  const pts = [{ date: "2026-01-01", valeur: 0 }, { date: "2026-01-10", valeur: 500 }, { date: "2026-02-09", valeur: 550 }];
  const t = R.twr(pts, [{ date: "2026-01-10", montant: 500 }]);
  proche(t.cumule, 0.1, 1e-12);
});
test("TWR : moins de deux relevés, ou aucune valeur positive, c'est null", () => {
  assert.equal(R.twr([{ date: "2026-01-01", valeur: 100 }], []), null);
  assert.equal(R.twr([], []), null);
  assert.equal(R.twr([{ date: "2026-01-01", valeur: 0 }, { date: "2026-02-01", valeur: 0 }], []), null);
});

/* ================================================================== une période */
test("mesurer : le cas des 100 000 € (versement avant une baisse) — TWR +4,5 %, XIRR −0,33 % sur la période, non annualisés (60 jours)", () => {
  const pts = [{ date: "2026-01-01", valeur: 100000 }, { date: "2026-01-31", valeur: 210000 }, { date: "2026-03-02", valeur: 199500 }];
  const m = R.mesurer({ points: pts, flux: [{ date: "2026-01-31", montant: 100000 }], debut: "2026-01-01", fin: "2026-03-02" });
  assert.equal(m.jours, 60); assert.equal(m.annualise, false); assert.equal(m.statut, "ok");
  proche(m.twr_periode_pct, 4.5, 1e-9); assert.equal(m.twr_annuel_pct, null);
  /* −100 000 le 1er janvier, −100 000 le 31, +199 500 le 2 mars ; XIRR annuel −2,0101 %, soit (1 − 0,020101)^(60/365) − 1 sur la période */
  proche(m.xirr_periode_pct, -0.33324064, 1e-6); assert.equal(m.xirr_annuel_pct, null);
  assert.equal(m.valeur_debut, 100000); assert.equal(m.valeur_fin, 199500); assert.equal(m.versements_nets, 100000);
  proche(m.gain, -500, 1e-9, "199 500 − 100 000 − 100 000");
});
test("mesurer : un an pile (365 jours) à +10 % est annualisé : 10 % par an, TWR et XIRR égaux sans versement", () => {
  const m = R.mesurer({ points: [{ date: "2025-01-01", valeur: 1000 }, { date: "2026-01-01", valeur: 1100 }], flux: [{ date: "2024-06-01", montant: 50 }], debut: "2025-01-01", fin: "2026-01-01" });
  assert.equal(m.annualise, true);
  proche(m.twr_annuel_pct, 10, 1e-9); proche(m.xirr_annuel_pct, 10, 1e-8); proche(m.twr_periode_pct, 10, 1e-9);
});
test("mesurer : deux ans à +21 % = +10 % par an (1,21^(365/730) − 1)", () => {
  const m = R.mesurer({ points: [{ date: "2024-01-01", valeur: 1000 }, { date: "2025-12-31", valeur: 1210 }], flux: [{ date: "2023-01-01", montant: 1 }], debut: "2024-01-01", fin: "2025-12-31" });
  assert.equal(m.jours, 730); proche(m.twr_annuel_pct, 10, 1e-9); proche(m.twr_periode_pct, 21, 1e-9);
});

/* ================================================================== les quatre périodes */
const histoire = (jours, g = 0.0003, v0 = 10000) => serieCroissance(plusJ(AUJ, -jours), jours, v0, g);
const flux1 = [{ date: "2020-01-01", montant: 10 }]; /* un versement hors période : les versements sont connus, il n'y en a pas pendant les périodes */
test("périodes : 1 mois, 3 mois, 1 an, depuis le début sur une croissance quotidienne constante de 0,03 % (les quatre TWR se déduisent de la formule)", () => {
  const ps = R.periodes({ points: histoire(400), flux: flux1, today: AUJ });
  assert.deepEqual(ps.map(p => p.id), ["1m", "3m", "1a", "debut"]);
  assert.deepEqual(ps.map(p => p.libelle), ["1 mois", "3 mois", "1 an", "Depuis le début"]);
  const jours = Object.fromEntries(ps.map(p => [p.id, p.jours]));
  assert.deepEqual(jours, { "1m": 30, "3m": 92, "1a": 365, debut: 400 });
  const cum = d => (Math.pow(1.0003, d) - 1) * 100;
  proche(ps[0].twr_periode_pct, cum(30), 1e-9); proche(ps[1].twr_periode_pct, cum(92), 1e-9); proche(ps[2].twr_periode_pct, cum(365), 1e-9);
  assert.deepEqual(ps.map(p => p.annualise), [false, false, true, true], "annualisé seulement à partir d'un an");
  proche(ps[2].twr_annuel_pct, cum(365), 1e-9); proche(ps[3].twr_annuel_pct, (Math.pow(1.0003, 365) - 1) * 100, 1e-9, "400 jours ramenés à 365");
  assert.equal(ps[0].twr_annuel_pct, null); assert.equal(ps[1].twr_annuel_pct, null);
  ps.forEach(p => { assert.equal(p.statut, "ok", p.id); proche(p.xirr_periode_pct, p.twr_periode_pct, 1e-6, "sans versement, XIRR = TWR " + p.id); });
});
test("périodes : le début est le relevé le plus proche (dates effectives dites), l'écart toléré est borné", () => {
  /* relevés toutes les semaines : le début d'un mois (14 septembre) tombe entre deux relevés (9 et 16 septembre) */
  const pts = []; for (let k = 0; k <= 9; k++) pts.push({ date: plusJ("2026-08-12", 7 * k), valeur: 1000 + 10 * k });
  const ps = R.periodes({ points: pts, flux: flux1, today: "2026-10-14" });
  assert.ok(ps[0].debut === "2026-09-09" || ps[0].debut === "2026-09-16", "début effectif : un des deux relevés voisins : " + ps[0].debut);
  assert.equal(ps[0].fin, "2026-10-14"); assert.equal(ps[0].statut, "ok");
  assert.equal(ps[2].statut, "insuffisant", "63 jours de relevés ne font pas un an");
});
test("périodes : historique court — 20 jours de relevés : « pas assez d'historique » pour 1 mois, 3 mois, 1 an et depuis le début (jamais un chiffre)", () => {
  const ps = R.periodes({ points: histoire(20), flux: flux1, today: AUJ });
  ps.forEach(p => { assert.equal(p.statut, "insuffisant", p.id); assert.equal(p.twr_periode_pct, null); assert.equal(p.xirr_periode_pct, null); assert.match(p.raison, /pas assez d'historique/); });
  assert.match(ps[3].raison, /20 jours/, "la durée disponible est dite");
});
test("périodes : cinq mois de relevés — 1 mois et 3 mois mesurés, 1 an non, depuis le début mesuré sur la période (jours < 358, non annualisé)", () => {
  const ps = R.periodes({ points: histoire(150), flux: flux1, today: AUJ });
  assert.deepEqual(ps.map(p => p.statut), ["ok", "ok", "insuffisant", "ok"]);
  assert.equal(ps[3].jours, 150); assert.equal(ps[3].annualise, false); assert.equal(ps[3].twr_annuel_pct, null);
});
test("périodes : versements inconnus (aucune transaction suivie) — rendement approché, dit ; les chiffres restent le rendement simple de la valeur", () => {
  const ps = R.periodes({ points: histoire(400), flux: [], today: AUJ });
  ps.forEach(p => { assert.equal(p.statut, "approche", p.id); assert.ok(p.notes.some(n => /versements inconnus : rendement approché/.test(n)), p.id); assert.ok(p.twr_periode_pct > 0); });
  /* l'appelant peut dire que les versements sont connus (aucun versement) */
  const ok = R.periodes({ points: histoire(400), flux: [], today: AUJ, versementsConnus: true });
  ok.forEach(p => assert.equal(p.statut, "ok", p.id));
});
test("périodes : un mouvement brutal sans versement connu (+30 % en un jour : ligne ajoutée sans versement ?) rend la mesure approchée, et le dit", () => {
  const pts = histoire(120); pts.forEach((p, k) => { if (k >= 90) p.valeur *= 1.3; });
  const ps = R.periodes({ points: pts, flux: flux1, today: AUJ });
  assert.equal(ps[1].statut, "approche"); assert.ok(ps[1].notes.some(n => /mouvement de plus de 20 %/.test(n)));
  assert.equal(ps[0].statut, "ok", "le dernier mois est après le saut");
});
test("périodes : des relevés espacés de plus de 40 jours rendent la mesure approchée (Dietz sur un long intervalle)", () => {
  const pts = [{ date: plusJ(AUJ, -200), valeur: 1000 }, { date: plusJ(AUJ, -100), valeur: 1040 }, { date: AUJ, valeur: 1080 }];
  const ps = R.periodes({ points: pts, flux: flux1, today: AUJ });
  const p = ps.find(x => x.id === "debut");
  assert.equal(p.statut, "approche"); assert.ok(p.notes.some(n => /relevés espacés/.test(n)));
});
test("périodes : dernier relevé trop ancien (plus de 7 jours avant aujourd'hui) — pas de période en cours, « pas assez d'historique récent »", () => {
  const pts = serieCroissance(plusJ(AUJ, -400), 380, 10000, 0.0003); /* s'arrête 20 jours avant */
  const ps = R.periodes({ points: pts, flux: flux1, today: AUJ });
  ps.forEach(p => assert.equal(p.statut, "insuffisant", p.id));
});

/* ================================================================== depuis l'état du store */
const S0 = () => ({
  scope: "foyer",
  positions: [
    { id: "etf", owner: "p1", bloc: "Monde", envelope: "PEA", value: 5000, status: "actif", mode: "manual" },
    { id: "liv", owner: "p2", bloc: "Épargne", envelope: "Livret A", value: 2000, status: "actif", mode: "manual" },
    { id: "cc", owner: "p1", bloc: "Comptes courants", envelope: "Compte courant", value: 1500, status: "actif", mode: "manual" },
  ],
  snapshots: [
    { date: "2026-09-01", foyer: 8000, p1: 6000, p2: 2000, byBloc: { p1: { Monde: 4500, "Comptes courants": 1500 }, p2: { "Épargne": 2000 } } },
    { date: "2026-10-01", foyer: 8500, p1: 6300, p2: 2200, byBloc: { p1: { Monde: 4800, "Comptes courants": 1500 }, p2: { "Épargne": 2200 } } },
  ],
  tx: [
    { id: "t1", date: "2026-09-15", type: "versement", positionId: "etf", amount: 300 },
    { id: "t2", date: "2026-09-20", type: "programme", positionId: "liv", amount: 100 },
    { id: "t3", date: "2026-09-25", type: "retrait", positionId: "etf", amount: 50 },
    { id: "t4", date: "2026-09-26", type: "achat", positionId: "etf", amount: 400 },
    { id: "t5", date: "2026-09-27", type: "versement", positionId: "cc", amount: 900 },
    { id: "t6", date: "2026-09-28", type: "solde", positionId: "etf", amount: 1 },
  ],
});
test("pointsEtFlux : valeur des placements = relevé − comptes courants (byBloc imbriqué par personne ou à plat), point du jour = lignes vivantes sans courant", () => {
  const r = R.pointsEtFlux(S0(), "foyer", "2026-10-14");
  assert.deepEqual(r.points.map(p => [p.date, p.valeur]), [["2026-09-01", 6500], ["2026-10-01", 7000], ["2026-10-14", 7000]]);
  /* à plat (démo) */
  const S = S0(); S.snapshots = [{ date: "2026-09-01", foyer: 8000, byBloc: { Monde: 4500, "Épargne": 2000, "Comptes courants": 1500 } }];
  assert.deepEqual(R.pointsEtFlux(S, "foyer", "2026-10-14").points.map(p => p.valeur), [6500, 7000]);
});
test("pointsEtFlux : seuls les versements, versements programmés et retraits des placements franchissent la frontière (achat, solde, ligne courante : non)", () => {
  const r = R.pointsEtFlux(S0(), "foyer", "2026-10-14");
  assert.deepEqual(r.flux, [{ date: "2026-09-15", montant: 300 }, { date: "2026-09-20", montant: 100 }, { date: "2026-09-25", montant: -50 }]);
  assert.equal(r.versementsConnus, true);
});
test("pointsEtFlux : le périmètre d'une personne ne garde que ses relevés (p1/p2) et les transactions de ses lignes", () => {
  const r = R.pointsEtFlux(S0(), "p2", "2026-10-14");
  assert.deepEqual(r.points.map(p => p.valeur), [2000, 2200, 2000]);
  assert.deepEqual(r.flux, [{ date: "2026-09-20", montant: 100 }]);
  const p1 = R.pointsEtFlux(S0(), "p1", "2026-10-14");
  assert.deepEqual(p1.points.map(p => p.valeur), [4500, 4800, 5000]);
});
test("pointsEtFlux : sans transaction du tout, les versements sont inconnus ; sans relevés, aucun point", () => {
  const S = S0(); S.tx = [];
  assert.equal(R.pointsEtFlux(S, "foyer", "2026-10-14").versementsConnus, false);
  assert.deepEqual(R.pointsEtFlux({ positions: [], snapshots: [], tx: [] }, "foyer", "2026-10-14").points, []);
  assert.deepEqual(R.pointsEtFlux(null, "foyer", "2026-10-14").points, []);
});
test("pointsEtFlux : les poids par poche du relevé servent à décrire l'allocation de départ (courant exclu, imbriqué ou à plat)", () => {
  const r = R.pointsEtFlux(S0(), "foyer", "2026-10-14");
  assert.deepEqual(r.allocations.map(a => [a.date, a.poche]), [["2026-09-01", { Monde: 4500, "Épargne": 2000 }], ["2026-10-01", { Monde: 4800, "Épargne": 2200 }]]);
});

/* ================================================================== rendement attendu d'une allocation */
const CL = { actions: { rendement: 7, volatilite: 15 }, obligations: { rendement: 3, volatilite: 6 }, courant: { rendement: 0, volatilite: 0 } };
test("attendu : une seule classe (7 %, volatilité 15 %) sur 12 mois — attendu 7 %, 8 chances sur 10 entre −11,71 % et +29,68 % (exp(ln 1,07 ± 1,2816 × 0,15) − 1)", () => {
  const a = R.attenduPeriode({ poids: { actions: 1 }, classes: CL, mois: 12 });
  assert.equal(a.statut, "ok"); proche(a.attendu_pct, 7, 1e-9); proche(a.p50_pct, 7, 1e-9); proche(a.p10_pct, -11.7127, 1e-3); proche(a.p90_pct, 29.6789, 1e-3);
  assert.equal(a.annualise, true);
});
test("attendu : sur 36 mois la bande se resserre (annualisée) : −4,24 % à +19,56 % par an ; sur 3 mois elle s'écrit sur la période (non annualisée)", () => {
  const a = R.attenduPeriode({ poids: { actions: 1 }, classes: CL, mois: 36 });
  proche(a.p10_pct, -4.2402, 1e-3); proche(a.p90_pct, 19.5595, 1e-3); proche(a.attendu_pct, 7, 1e-9);
  const c = R.attenduPeriode({ poids: { actions: 1 }, classes: CL, mois: 3 });
  assert.equal(c.annualise, false);
  proche(c.attendu_pct, (Math.pow(1.07, 0.25) - 1) * 100, 1e-9, "attendu sur 3 mois");
  proche(c.p10_pct, (Math.exp(Math.log(1.07) / 4 - 1.2815516 * 0.15 / 2) - 1) * 100, 1e-3);
});
test("attendu : les frais se retranchent (7 % et 0,5 % de frais : 1,07 × 0,995 − 1 = 6,465 %)", () => {
  const a = R.attenduPeriode({ poids: { actions: 1 }, classes: CL, mois: 12, frais_pct: 0.5 });
  proche(a.attendu_pct, 6.465, 1e-9); proche(a.p10_pct, -12.1542, 1e-3); proche(a.p90_pct, 29.0305, 1e-3);
});
test("attendu : 60 % actions (7 %, 15 %) et 40 % obligations (3 %, 6 %), corrélation 0,1 — attendu 5,4 % (0,6 × 7 + 0,4 × 3), bande −6,67 % à +19,71 % sur 12 mois", () => {
  const a = R.attenduPeriode({ poids: { actions: 0.6, obligations: 0.4 }, classes: CL, mois: 12, correlation: (x, y) => (x === y ? 1 : 0.1) });
  proche(a.attendu_pct, 5.4, 1e-9);
  proche(a.p10_pct, -6.6697, 2e-3); proche(a.p50_pct, 5.7008, 2e-3); proche(a.p90_pct, 19.711, 2e-3);
  const b = R.attenduPeriode({ poids: { actions: 3, obligations: 2 }, classes: CL, mois: 12, correlation: (x, y) => (x === y ? 1 : 0.1) });
  proche(b.attendu_pct, 5.4, 1e-9, "les poids sont normalisés");
});
test("attendu : le compte courant (0 %, sans volatilité) pèse dans l'allocation (50 % d'actions à 7 % et 50 % de courant = 3,5 % attendu)", () => {
  const a = R.attenduPeriode({ poids: { actions: 0.5, courant: 0.5 }, classes: CL, mois: 12 });
  proche(a.attendu_pct, 3.5, 1e-9);
});
test("attendu : une classe sans hypothèse rend l'attendu indisponible, avec la raison (jamais une valeur de secours)", () => {
  const a = R.attenduPeriode({ poids: { actions: 0.5, crypto: 0.5 }, classes: CL, mois: 12 });
  assert.equal(a.statut, "indisponible"); assert.match(a.raison, /crypto/); assert.equal(a.attendu_pct, null);
  assert.equal(R.attenduPeriode({ poids: {}, classes: CL, mois: 12 }).statut, "indisponible");
  assert.equal(R.attenduPeriode({ poids: { actions: 1 }, classes: CL, mois: 0 }).statut, "indisponible");
});

/* ================================================================== réel contre attendu */
const attendu = (p10, p50, p90, att, annualise = true) => ({ statut: "ok", attendu_pct: att, p10_pct: p10, p50_pct: p50, p90_pct: p90, annualise });
test("réel contre attendu : « Réel 6,2 %/an contre 4,9 % attendu (fourchette 8 sur 10 : −3 % à +12 %) — dans la fourchette »", () => {
  const c = R.comparer({ valeur_pct: 6.2, annualise: true }, attendu(-3, 5, 12, 4.9));
  assert.equal(c.verdict, "dans");
  assert.equal(sp(c.phrase), "Réel 6,2 %/an contre 4,9 % attendu (fourchette 8 sur 10 : −3 % à +12 %) — dans la fourchette");
});
test("réel contre attendu : au-dessus et en dessous de la fourchette, sans jugement de valeur ; la bande étroite garde une décimale", () => {
  assert.equal(R.comparer({ valeur_pct: 14.1, annualise: true }, attendu(-3, 5, 12, 4.9)).verdict, "au_dessus");
  assert.match(sp(R.comparer({ valeur_pct: 14.1, annualise: true }, attendu(-3, 5, 12, 4.9)).phrase), /— au-dessus de la fourchette$/);
  const bas = R.comparer({ valeur_pct: -5.5, annualise: true }, attendu(-3, 5, 12, 4.9));
  assert.equal(bas.verdict, "en_dessous"); assert.match(sp(bas.phrase), /^Réel −5,5 %\/an contre 4,9 % attendu \(fourchette 8 sur 10 : −3 % à \+12 %\) — sous la fourchette$/);
  assert.match(sp(R.comparer({ valeur_pct: 2.1, annualise: true }, attendu(0.8, 2, 3.4, 2.0)).phrase), /fourchette 8 sur 10 : \+0,8 % à \+3,4 %/);
});
test("réel contre attendu : sur moins d'un an, « sur la période » (pas de /an), signe explicite", () => {
  const c = R.comparer({ valeur_pct: 2.1, annualise: false, libelle: "3 mois" }, attendu(-6, 1.4, 9, 1.4, false));
  assert.equal(sp(c.phrase), "Réel +2,1 % sur 3 mois contre +1,4 % attendu (fourchette 8 sur 10 : −6 % à +9 %) — dans la fourchette");
});
test("réel contre attendu : attendu indisponible ou réel absent, pas de phrase (null) mais la raison", () => {
  assert.equal(R.comparer({ valeur_pct: 2, annualise: true }, { statut: "indisponible", raison: "hypothèse manquante" }).phrase, null);
  assert.equal(R.comparer({ valeur_pct: null, annualise: true }, attendu(-3, 5, 12, 4.9)).phrase, null);
});

/* ================================================================== depuis une date (survol du graphe) */
const hyp = {
  courantes: { classes: CL, frais_pct: 0, correlation: (x, y) => (x === y ? 1 : 0.1) },
  plans: [{ id: "p-juin", cree_le: "2026-06-01T20:00:00Z", classes: { actions: { rendement: 5, volatilite: 15 } } }, { id: "p-sept", cree_le: "2026-09-01T20:00:00Z", classes: { actions: { rendement: 3, volatilite: 15 } } }],
};
const classeDePoche = poche => (poche === "Monde" ? "actions" : poche === "Obligations" ? "obligations" : null);
test("classer : les poches d'un relevé deviennent des poids par classe (somme 1), les poches sans classe sont dites", () => {
  const c = R.classer([{ date: "2026-09-01", poche: { Monde: 3000, Obligations: 1000, Divers: 0, Inconnu: 500 } }], classeDePoche);
  assert.equal(c.length, 1); proche(c[0].poids.actions, 0.75, 1e-12); proche(c[0].poids.obligations, 0.25, 1e-12);
  assert.deepEqual(c[0].inconnues, ["Inconnu"]); assert.deepEqual(R.classer([{ date: "2026-09-01", poche: {} }], classeDePoche), []);
});
function donneesReel(jours, g) {
  const pts = histoire(jours, g);
  return { points: pts, flux: flux1, versementsConnus: true, allocations: [{ date: plusJ(AUJ, -jours), poids: { actions: 1 } }] };
}
test("depuis une date : rendement réel de la date à aujourd'hui et ce que le modèle en attendait pour l'allocation de départ (hypothèses d'aujourd'hui, approximation dite)", () => {
  const dr = donneesReel(730, 0.0003);
  const d = R.depuis(dr, plusJ(AUJ, -400), AUJ, { hypotheses: hyp });
  assert.equal(d.statut, "ok"); assert.equal(d.annualise, true);
  proche(d.reel.valeur_pct, (Math.pow(1.0003, 365) - 1) * 100, 1e-6);
  proche(d.attendu.attendu_pct, 7, 1e-9);
  assert.equal(d.source.type, "hypotheses_actuelles"); assert.match(sp(d.source.texte), /hypothèses d'aujourd'hui appliquées à ton allocation du .* \(approximation\)/);
  assert.match(sp(d.comparaison.phrase), /^Réel 11,6 %\/an contre 7,0 % attendu \(fourchette 8 sur 10 : /);
  assert.equal(d.comparaison.verdict, "dans");
});
test("depuis une date : un plan figé antérieur à la date fournit les hypothèses du moment (le plus récent créé avant la date), et le dit", () => {
  const dr = donneesReel(730, 0.0003);
  const d = R.depuis(dr, plusJ(AUJ, -200), AUJ, { hypotheses: hyp }); /* 200 jours avant le 14 oct. 2026 = 27 mars 2026 : aucun plan avant */
  assert.equal(d.source.type, "hypotheses_actuelles");
  const e = R.depuis(dr, "2026-09-10", AUJ, { hypotheses: hyp });
  assert.equal(e.source.type, "plan_fige"); assert.equal(e.source.id, "p-sept");
  proche(e.attendu.attendu_pct, (Math.pow(1.03, 34 / 365.25) - 1) * 100, 1e-9, "rendement du plan de septembre (3 %/an), ramené à 34 jours");
  assert.match(sp(e.source.texte), /plan figé du 1er sept\. 2026/);
  const f = R.depuis(dr, "2026-07-01", AUJ, { hypotheses: hyp });
  assert.equal(f.source.id, "p-juin"); proche(f.attendu.attendu_pct, (Math.pow(1.05, 105 / 365.25) - 1) * 100, 1e-9, "plan de juin (5 %/an), ramené à 105 jours");
});
test("depuis une date : moins de 30 jours, ou avant le premier relevé, rien à dire (statut insuffisant, jamais un chiffre)", () => {
  const dr = donneesReel(400, 0.0003);
  assert.equal(R.depuis(dr, plusJ(AUJ, -10), AUJ, { hypotheses: hyp }).statut, "insuffisant");
  assert.equal(R.depuis(dr, plusJ(AUJ, -900), AUJ, { hypotheses: hyp }).statut, "insuffisant");
  assert.equal(R.depuis(dr, AUJ, AUJ, { hypotheses: hyp }).statut, "insuffisant");
});
test("depuis une date : sans hypothèse (moteur absent), le réel reste affiché sans attendu", () => {
  const d = R.depuis(donneesReel(400, 0.0003), plusJ(AUJ, -200), AUJ, {});
  assert.equal(d.statut, "ok"); assert.equal(d.attendu, null); assert.equal(d.comparaison, null); assert.ok(d.reel.valeur_pct > 0);
});

/* ================================================================== phrases de lecture */
test("phrases : « Ton rendement » (XIRR) et « Rendement de tes placements » (TWR), annualisés seulement à partir d'un an, sinon « sur 3 mois »", () => {
  const p = R.periodes({ points: histoire(400), flux: flux1, today: AUJ });
  assert.match(sp(R.phrasePeriode(p[1], "xirr")), /^Ton rendement : \+[\d,]+ % sur 3 mois$/);
  assert.match(sp(R.phrasePeriode(p[2], "twr")), /^Rendement de tes placements : [\d,]+ %\/an$/);
  const court = R.periodes({ points: histoire(10), flux: flux1, today: AUJ });
  assert.match(sp(R.phrasePeriode(court[0], "twr")), /pas assez d'historique/);
});
test("phrases : versements inconnus — la phrase dit « approché »", () => {
  const p = R.periodes({ points: histoire(400), flux: [], today: AUJ });
  assert.match(sp(R.phrasePeriode(p[2], "twr")), /approché/);
});
test("pas de conseil : aucun mot de recommandation dans les phrases du module", () => {
  const src = req("node:fs").readFileSync(new URL("../web/src/rendement.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
  assert.doesNotMatch(src, /conseill|recommand|il faut|tu dois|devrais/i);
});
