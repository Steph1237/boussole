// Formats uniques (web/src/format.js, UX1) : montants, k€ / M€, pourcentages, dates, variations, graduations rondes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const F = require("../web/src/format.js");
const { fmtEUR, fmtPct, fmtDate, fmtDelta, fmtNombre, fmtAxe, graduations, classeMontant } = F;
const f = " ", n = " ", m = "−"; // espace fine insécable (milliers), espace insécable (avant l'unité), vrai signe moins

test("fmtEUR : milliers en espace fine insécable, « € » après une espace insécable, signe « − » typographique, zéro sans signe", () => {
  assert.equal(fmtEUR(193490), `193${f}490${n}€`);
  assert.equal(fmtEUR(-156500), `${m}156${f}500${n}€`);
  assert.equal(fmtEUR(0), `0${n}€`);
  assert.equal(fmtEUR(-0.2), `0${n}€`, "−0,2 € arrondi à 0 : pas de signe");
  assert.equal(fmtEUR(512), `512${n}€`);
  assert.equal(fmtEUR(1234.5, { decimales: 2 }), `1${f}234,50${n}€`);
  assert.equal(fmtEUR(9646, { signe: true }), `+9${f}646${n}€`);
  assert.equal(fmtEUR(-9646, { signe: true }), `${m}9${f}646${n}€`);
  assert.equal(fmtEUR(0, { signe: true }), `0${n}€`);
  assert.equal(fmtEUR(1234567), `1${f}234${f}567${n}€`);
  assert.ok(!/-/.test(fmtEUR(-5)), "jamais le tiret court");
});

test("fmtEUR : valeur absente ou non finie → « — »", () => {
  for (const v of [null, undefined, "", NaN, Infinity, "abc", true]) assert.equal(fmtEUR(v), "—", String(v));
  assert.equal(fmtEUR("42"), `42${n}€`, "nombre en chaîne accepté");
});

test("fmtEUR : dette = reste dû écrit avec « − » (la couleur reste à l'encre, décidée par classeMontant)", () => {
  assert.equal(fmtEUR(156500, { dette: true }), `${m}156${f}500${n}€`);
  assert.equal(fmtEUR(-156500, { dette: true }), `${m}156${f}500${n}€`);
  assert.equal(classeMontant(156500, { dette: true }), "neutre");
  assert.equal(classeMontant(-156500, { dette: true }), "neutre");
  assert.equal(classeMontant(9646), "pos");
  assert.equal(classeMontant(-9646), "neg");
  assert.equal(classeMontant(0), "neutre");
  assert.equal(classeMontant(NaN), "neutre");
});

test("fmtEUR compact « kpi » (mini-cartes) : au millier dès 100 000 €, en M€ dès 1 M€", () => {
  const k = v => fmtEUR(v, { compact: "kpi" });
  assert.equal(k(193490), `193${n}k€`);
  assert.equal(k(193500), `194${n}k€`, "arrondi à l'entier le plus proche");
  assert.equal(k(100000), `100${n}k€`);
  assert.equal(k(99999), `99${f}999${n}€`, "sous 100 000 € : l'euro entier");
  assert.equal(k(1234567), `1,2${n}M€`);
  assert.equal(k(12345678), `12${n}M€`);
  assert.equal(k(-193490), `${m}193${n}k€`);
  assert.equal(fmtEUR(193490, { compact: "kpi", signe: true }), `+193${n}k€`);
  assert.equal(fmtEUR(193490, { compact: true }), k(193490), "compact: true = « kpi »");
});

test("fmtEUR compact « graphe » : en k€ dès 10 000 €, une décimale seulement si utile", () => {
  const g = v => fmtEUR(v, { compact: "graphe" });
  assert.equal(g(24500), `24,5${n}k€`);
  assert.equal(g(24000), `24${n}k€`, "pas de « 24,0 »");
  assert.equal(g(10000), `10${n}k€`);
  assert.equal(g(9999), `9${f}999${n}€`);
  assert.equal(g(150000), `150${n}k€`, "au-delà de 100 k€ : entier");
  assert.equal(g(-24500), `${m}24,5${n}k€`);
  assert.equal(g(2500000), `2,5${n}M€`);
});

test("fmtPct : une décimale sous 10 %, sinon entier ; signe optionnel ; proportion acceptée", () => {
  assert.equal(fmtPct(5.23), `5,2${n}%`);
  assert.equal(fmtPct(14.6), `15${n}%`);
  assert.equal(fmtPct(9.96), `10${n}%`, "9,96 → 10 % et non « 10,0 % »");
  assert.equal(fmtPct(-3.456), `${m}3,5${n}%`);
  assert.equal(fmtPct(5.2, { signe: true }), `+5,2${n}%`);
  assert.equal(fmtPct(0), `0${n}%`);
  assert.equal(fmtPct(0.04), `0${n}%`, "0,04 % : arrondi à 0, sans signe");
  assert.equal(fmtPct(0.04, { signe: true }), `0${n}%`);
  assert.equal(fmtPct(0.052, { ratio: true }), `5,2${n}%`);
  assert.equal(fmtPct(12.345, { decimales: 2 }), `12,35${n}%`);
  assert.equal(fmtPct(null), "—");
  assert.equal(fmtPct(NaN), "—");
});

test("fmtDate : « 14 oct. 2026 », court « 14 oct. » dans les listes, mois abrégés fixes, dates sans fuseau", () => {
  assert.equal(fmtDate("2026-10-14"), "14 oct. 2026");
  assert.equal(fmtDate("2026-10-14", { court: true }), "14 oct.");
  assert.equal(fmtDate("2026-07-01"), "1 juil. 2026");
  assert.equal(fmtDate("2026-09-30", { court: true }), "30 sept.");
  assert.equal(fmtDate("2026-01-05", { court: true }), "5 janv.");
  assert.equal(fmtDate("2026-12-25"), "25 déc. 2026");
  assert.equal(fmtDate("2026-02-03", { court: true }), "3 févr.");
  assert.equal(fmtDate("2026-08-15", { court: true }), "15 août");
  assert.equal(fmtDate(""), "—");
  assert.equal(fmtDate(null), "—");
  assert.equal(fmtDate("pas une date"), "—");
  assert.equal(fmtDate(new Date("2026-10-14T10:00:00Z")), "14 oct. 2026");
});

test("fmtDate : relatif seulement sous 7 jours (« hier, 22 h 31 »), heure de Paris", () => {
  const maintenant = "2026-10-14T10:00:00Z"; // 12 h à Paris (CEST)
  assert.equal(fmtDate("2026-10-13T20:31:00Z", { maintenant }), "hier, 22 h 31");
  assert.equal(fmtDate("2026-10-14T06:05:00Z", { maintenant }), "aujourd'hui, 8 h 05");
  assert.equal(fmtDate("2026-10-11T12:00:00Z", { maintenant }), "il y a 3 j");
  assert.equal(fmtDate("2026-10-07T12:00:00Z", { maintenant }), "7 oct. 2026", "7 jours ou plus : la date");
  assert.equal(fmtDate("2026-10-13", { maintenant }), "hier", "date sans heure : pas d'heure inventée");
  assert.equal(fmtDate("2026-10-20", { maintenant }), "20 oct. 2026", "une date future n'est jamais relative");
  assert.equal(fmtDate("2026-10-13T20:31:00Z", { maintenant, court: true }), "hier, 22 h 31");
  assert.equal(fmtDate("2026-09-01", { maintenant, court: true }), "1 sept.");
});

test("fmtDelta : flèche, signe et période toujours présents (« ▲ +9 646 € · +5,2 % sur 1 an »)", () => {
  const d = fmtDelta({ montant: 9646, pct: 5.2 });
  assert.equal(d.texte, `▲ +9${f}646${n}€ · +5,2${n}% sur 1 an`);
  assert.equal(d.sens, "hausse");
  assert.equal(d.ton, "pos");
  assert.equal(d.lu, "En hausse de 9 646 euros, 5,2 pour cent, sur 1 an");
  const b = fmtDelta({ montant: -2000, pct: -1.5, periode: "sur 3 mois" });
  assert.equal(b.texte, `▼ ${m}2${f}000${n}€ · ${m}1,5${n}% sur 3 mois`);
  assert.equal(b.ton, "neg");
  assert.equal(b.sens, "baisse");
  assert.equal(fmtDelta({ montant: 120 }).texte, `▲ +120${n}€ sur 1 an`);
  assert.equal(fmtDelta({ pct: -4.2 }).texte, `▼ ${m}4,2${n}% sur 1 an`);
  const s = fmtDelta({ montant: 0, pct: 0 });
  assert.equal(s.texte, "– stable sur 1 an");
  assert.equal(s.sens, "stable");
  assert.equal(s.ton, "neutre");
  assert.equal(fmtDelta({ montant: 0.3 }).sens, "stable", "arrondi à 0 € : stable");
  assert.match(fmtDelta({}).texte, /sur 1 an$/, "période par défaut unique");
  for (const x of [d, b, s]) assert.match(x.texte, /sur (1 an|3 mois)$/, "toujours avec la période");
});

test("fmtNombre : milliers en espace fine, décimales à la demande", () => {
  assert.equal(fmtNombre(1234567), `1${f}234${f}567`);
  assert.equal(fmtNombre(-42), `${m}42`);
  assert.equal(fmtNombre(3.14159, { decimales: 2 }), "3,14");
  assert.equal(fmtNombre(null), "—");
});

/* ------------------------------------------------ graduations rondes ------------------------------------------------ */

const PAS_RONDS = [1, 2, 2.5, 5];
const estRond = pas => { const e = Math.floor(Math.log10(pas) + 1e-9); return PAS_RONDS.some(b => Math.abs(pas / Math.pow(10, e) - b) < 1e-9); };

test("graduations : exemples du brief (« 89 / 91 / 94 / 96 k€ » deviennent 85 / 90 / 95 / 100 k€)", () => {
  assert.deepEqual(graduations(89000, 96000, 4), [85000, 90000, 95000, 100000]);
  assert.deepEqual(graduations(0, 96000, 4), [0, 50000, 100000]);
  assert.deepEqual(graduations(24100, 25600, 4), [24000, 25000, 26000]);
  assert.deepEqual(graduations(24100, 25600, 5), [24000, 24500, 25000, 25500, 26000]);
  assert.deepEqual(graduations(0, 100, 5), [0, 25, 50, 75, 100]);
  assert.deepEqual(graduations(-50, 150, 5), [-50, 0, 50, 100, 150]);
  assert.equal(graduations(5, 5, 3).length >= 2, true, "plage nulle : tout de même des graduations");
  assert.deepEqual(graduations(NaN, 3), []);
});

test("graduations : au plus n valeurs, pas de 1, 2, 2,5 ou 5 × 10ⁿ, régulières et couvrant la plage (200 plages)", () => {
  let graine = 7;
  const alea = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 200; i++) {
    const base = Math.pow(10, Math.floor(alea() * 7) - 1), lo = (alea() - 0.3) * base * 40, hi = lo + (0.05 + alea() * 30) * base;
    const n = 3 + Math.floor(alea() * 4);
    const g = graduations(lo, hi, n);
    assert.ok(g.length >= 2 && g.length <= n, `${lo}..${hi} n=${n} → ${g.length} valeurs`);
    assert.ok(g[0] <= lo + 1e-6 && g[g.length - 1] >= hi - 1e-6, `couverture ${lo}..${hi} : ${g}`);
    const pas = g[1] - g[0];
    assert.ok(estRond(pas), `pas ${pas} (${lo}..${hi}) non rond`);
    for (let j = 2; j < g.length; j++) assert.ok(Math.abs(g[j] - g[j - 1] - pas) < pas * 1e-6, "pas régulier");
  }
});

test("fmtAxe : unité et décimales communes à tous les libellés (jamais « 24,1 / 24,9 / 25,6 »)", () => {
  assert.deepEqual(fmtAxe([24000, 24500, 25000]), [`24,0${n}k€`, `24,5${n}k€`, `25,0${n}k€`]);
  assert.deepEqual(fmtAxe([0, 50000, 100000]), [`0${n}k€`, `50${n}k€`, `100${n}k€`]);
  assert.deepEqual(fmtAxe([0, 250, 500, 750]), [`0${n}€`, `250${n}€`, `500${n}€`, `750${n}€`]);
  assert.deepEqual(fmtAxe([0, 1000000, 2000000]), [`0${n}M€`, `1${n}M€`, `2${n}M€`]);
  assert.deepEqual(fmtAxe([-50000, 0, 50000]), [`${m}50${n}k€`, `0${n}k€`, `50${n}k€`]);
  assert.deepEqual(fmtAxe([]), []);
});

test("format.js : UMD (module Node et global Fmt), sans tiret court ni espace insécable ordinaire dans les sorties", () => {
  const src = readFileSync("web/src/format.js", "utf8");
  assert.match(src, /root\.Fmt = api/);
  for (const v of [fmtEUR(-1234), fmtPct(-1.2), fmtDelta({ montant: -5, pct: -1 }).texte, fmtNombre(-1234567)]) {
    assert.ok(!/-/.test(v) && !/\d \d/.test(v), v);
  }
});
