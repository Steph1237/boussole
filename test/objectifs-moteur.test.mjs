// Connecteur (index.ts) : effortMensuel, dateAtteinte, moisEntre, repartirEpargne et statutObjectif appellent le moteur de l'app (Plan, copie générée
// supabase/functions/mcp/projection-moteur.gen.js) au lieu de le recopier. Parité exacte avec l'ancien port (test/fixtures/objectifs-port-origine.ts.txt, gelé) et avec
// le moteur de l'app, sur des objectifs variés : les sorties des outils (list_objectifs, revue mensuelle, expertises) ne changent pas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import vm from "node:vm";
import { PlanGen } from "./helpers/moteur-gen.mjs";

const require = createRequire(import.meta.url);
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const lire = rel => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const PlanApp = require("../web/src/plan.js");

const num = v => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? 0 : Number(v));
const pos = v => Math.max(0, num(v));
const base = { num, pos, EPS: 1e-9, prioriteDe: o => o.priorite ?? Infinity, Math, Date, String, Number, isFinite, Infinity, Object };

/** Fonctions de l'ancien port (copie gelée), exécutées telles quelles. */
function ancien() {
  const js = strip(readFileSync(new URL("./fixtures/objectifs-port-origine.ts.txt", import.meta.url), "utf8"), { mode: "strip" });
  return vm.runInNewContext(js + "\n;({ effortMensuel, moisEntre, dateAtteinte, repartirEpargne, statutObjectif })", { ...base });
}
/** Fonctions actuelles d'index.ts : les deux morceaux du fichier qui contiennent les wrappers du moteur. */
function actuel() {
  const src = lire("supabase/functions/mcp/index.ts");
  const a = src.indexOf("/* ---------- dates et calculs d'objectifs"), b = src.indexOf("const dateCible = (o: any)");
  const c = src.indexOf("/** Répartit l'épargne mensuelle entre objectifs"), d = src.indexOf("const STATUTS: Record<string, string>");
  assert.ok(a > 0 && b > a && c > b && d > c, "morceaux d'index.ts introuvables");
  const js = strip(src.slice(a, b) + 'const dateCible = (o: any): string | null => o.date_cible || o.dateCible || null;\n' + src.slice(c, d), { mode: "strip" });
  return vm.runInNewContext(js + "\n;({ effortMensuel, moisEntre, dateAtteinte, repartirEpargne, statutObjectif })", { ...base, Plan: PlanGen });
}

/** Objectifs fictifs variés : avec et sans date, rendement nul ou non, déjà atteints, dates passées, mêmes priorités, dates fin de mois. */
function objectifs() {
  const L = [];
  const dates = ["2026-10-14", "2026-11-13", "2027-02-28", "2027-10-14", "2029-01-31", "2031-06-30", "2026-01-01", null];
  const rend = [0, 2.4, 5, undefined, null];
  const cibles = [0, 1000, 12000, 80000];
  let k = 0;
  for (const dt of dates) for (const r of rend) for (const c of cibles) {
    L.push({ id: "o" + k, nom: "Objectif " + k, cible: c, date_cible: dt, rendement: r, priorite: k % 3 === 0 ? undefined : k % 3 });
    k++;
  }
  return L;
}

test("effortMensuel, moisEntre, dateAtteinte : mêmes valeurs que l'ancien port et que le moteur de l'app", { skip: SANS_STRIP }, () => {
  const A = ancien(), N = actuel();
  const refs = ["2026-10-14", "2026-10-31", "2026-02-28", "2024-02-29"];
  for (const ref of refs) for (const o of objectifs()) {
    const dj = [0, 500, o.cible, o.cible + 1][o.cible % 4];
    if (o.date_cible) {
      assert.equal(N.moisEntre(ref, o.date_cible), A.moisEntre(ref, o.date_cible));
      assert.equal(N.moisEntre(ref, o.date_cible), PlanApp.moisEntre(ref, o.date_cible));
      const m = A.moisEntre(ref, o.date_cible);
      assert.equal(N.effortMensuel(o.cible, dj, m, o.rendement), A.effortMensuel(o.cible, dj, m, o.rendement));
      assert.equal(N.effortMensuel(o.cible, dj, m, o.rendement), PlanApp.effortMensuel(o.cible, dj, m, o.rendement));
    }
    for (const v of [0, 150, 2000]) {
      assert.equal(N.dateAtteinte(o.cible, dj, v, o.rendement, ref), A.dateAtteinte(o.cible, dj, v, o.rendement, ref), `${o.id} ${ref} v=${v}`);
      assert.equal(N.dateAtteinte(o.cible, dj, v, o.rendement, ref), PlanApp.dateAtteinte(o.cible, dj, v, o.rendement, ref));
    }
  }
  assert.equal(N.effortMensuel(1000, 0, 0, 3), Infinity); assert.equal(N.effortMensuel(1000, 2000, 12, 3), 0);
});

test("repartirEpargne et statutObjectif : mêmes sorties que l'ancien port (priorités, échéances, surplus, objectifs atteints, sans date) et que le moteur de l'app", { skip: SANS_STRIP }, () => {
  const A = ancien(), N = actuel();
  const obj = objectifs();
  const deja = Object.fromEntries(obj.map((o, i) => [o.id, [0, 100, o.cible, o.cible / 2, 25000][i % 5]]));
  let nb = 0;
  for (const ref of ["2026-10-14", "2027-03-31"]) for (const epargne of [0, 50, 400, 1800, 25000]) {
    for (const sous of [obj, obj.slice(0, 7), obj.slice(40, 50), [], [obj[3]]]) {
      const a = A.repartirEpargne(sous, deja, epargne, ref), n = N.repartirEpargne(sous, deja, epargne, ref);
      assert.deepEqual(J(n), J(a), `${ref} ${epargne} ${sous.length}`);
      /* le moteur de l'app, appelé comme objectifs-view.js (montants déjà réunis imposés) */
      const app = PlanApp.repartirEpargne(sous.map(o => ({ ...o, source: "saisi", deja: deja[o.id] || 0 })), epargne, { today: ref });
      assert.deepEqual(J(n), J(app));
      nb++;
      for (const o of sous) {
        const v = n[o.id] ?? 0, sa = A.statutObjectif(o, deja[o.id] ?? 0, v, ref), sn = N.statutObjectif(o, deja[o.id] ?? 0, v, ref);
        assert.deepEqual(J(sn), J(sa), `statut ${o.id} ${ref}`);
        assert.deepEqual(Object.keys(sn), ["progression", "mois", "effort", "atteinte", "statut"], "forme des sorties inchangée");
      }
    }
  }
  assert.ok(nb >= 50);
  /* statuts couverts par le jeu de données */
  const vus = new Set();
  for (const o of obj) for (const v of [0, 100, 5000]) vus.add(N.statutObjectif(o, deja[o.id], v, "2026-10-14").statut);
  assert.deepEqual([...vus].sort(), ["atteint", "avance", "dans_les_temps", "hors_portee", "retard"]);
});

test("index.ts : aucune copie du calcul d'objectif ; le moteur est importé de la copie générée", () => {
  const src = lire("supabase/functions/mcp/index.ts");
  assert.match(src, /import \{ Plan \} from "\.\/projection-moteur\.gen\.js";/);
  assert.doesNotMatch(src, /function (effortMensuel|dateAtteinte|moisEntre|ymd)\(|const (tauxMensuel|dernierJour|isoUTC) =/, "plus de copie des formules");
  for (const f of ["effortMensuel", "moisEntre", "dateAtteinte", "repartirEpargne", "statutObjectif"]) assert.match(src, new RegExp("Plan\\." + f + "\\("), "Plan." + f);
  assert.doesNotMatch(src, /Math\.pow\(1 \+ r, k\)|1\.1 \* effort/, "formules d'annuité et seuils de statut absents d'index.ts");
});
