// PROJ : exécution progressive (500 puis 2 000 chemins), Web Worker simulé sous Node, cache par empreinte, plafond de temps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { cas, entreeDe } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const P = req("../web/src/projection.js");
const W = req("../web/src/projection-worker.js");

/** Worker simulé : même code que le vrai (traiter), messages asynchrones, données clonées comme le ferait postMessage. */
class FauxWorker {
  constructor(url) { this.url = url; this.messages = []; this.termine = false; FauxWorker.crees.push(this); }
  postMessage(msg) {
    const copie = structuredClone(msg);
    setTimeout(() => W.traiter(copie, m => { if (!this.termine) setTimeout(() => this.onmessage({ data: structuredClone(m) }), 0); }), 0);
  }
  terminate() { this.termine = true; }
}
FauxWorker.crees = [];
const c = cas("MC-1"), d = () => entreeDe(c);
const opt = { ...c.options, graine: 20261014 };

test("exécution progressive : aperçu à 500 chemins puis résultat complet à 2 000, sur le fil principal", async () => {
  P.viderCache();
  const vus = [];
  const r = await P.executer(d(), { ...opt, worker: false }, (res, info) => vus.push([info.etape, res.chemins]));
  assert.deepEqual(vus, [["apercu", 500], ["complet", 2000]]);
  assert.equal(r.chemins, 2000);
});
test("MC-6 : l'aperçu à 500 chemins est calculé avec la même graine que le résultat à 2 000 (premiers chemins communs)", async () => {
  P.viderCache();
  const apercus = [];
  await P.executer(d(), { ...opt, worker: false }, (res, info) => { if (info.etape === "apercu") apercus.push(res); });
  const direct = P.simuler(P.preparer(d(), opt), { chemins: 500, graine: 20261014 });
  assert.deepEqual(apercus[0].vues.financier.p50, direct.vues.financier.p50);
});
test("même résultat avec et sans worker (worker simulé sous Node)", async () => {
  P.viderCache();
  const sans = await P.executer(d(), { ...opt, worker: false });
  P.viderCache();
  const etapes = [];
  const avec = await P.executer(d(), { ...opt, WorkerClass: FauxWorker, urlWorker: "app/projection-worker.js" }, (r, i) => etapes.push(i.etape));
  assert.deepEqual(etapes, ["apercu", "complet"]);
  assert.equal(FauxWorker.crees.at(-1).url, "app/projection-worker.js"); assert.equal(FauxWorker.crees.at(-1).termine, true, "worker libéré à la fin");
  assert.deepEqual(avec.vues, sans.vues); assert.deepEqual(avec.objectifs, sans.objectifs); assert.equal(avec.graine, sans.graine);
});
test("erreur du worker : la promesse est rejetée avec le message", async () => {
  P.viderCache();
  await assert.rejects(P.executer(null, { ...opt, WorkerClass: FauxWorker }), /./);
});
test("cache : même empreinte → même objet, sans recalcul ; version du modèle changée → recalcul", async () => {
  P.viderCache();
  const a = await P.executer(d(), { ...opt, worker: false });
  let appels = 0;
  const b = await P.executer(d(), { ...opt, worker: false }, (r, i) => { appels++; assert.equal(i.cache, true); });
  assert.equal(a, b); assert.equal(appels, 1);
  const autre = await P.executer(d(), { ...opt, horizon_ans: 5, worker: false });
  assert.notEqual(autre, a);
  assert.notEqual(P.empreinte(d(), opt), P.empreinte(d(), { ...opt, graine: 1 }));
  assert.equal(P.empreinte(d(), { ...opt, worker: false }), P.empreinte(d(), opt), "les réglages d'exécution ne changent pas l'empreinte");
  assert.match(P.empreinte(d(), opt), new RegExp("^" + P.versionModele));
  const cle = P.empreinte(d(), opt);
  assert.ok(cle.startsWith(P.versionModele + ":"), "la version du modèle est dans l'empreinte : un changement de calcul invalide le cache");
});
test("mode déterministe : une seule étape", async () => {
  P.viderCache();
  const etapes = [];
  await P.executer(d(), { ...opt, volatilite: 0, worker: false }, (r, i) => etapes.push(i.etape));
  assert.deepEqual(etapes, ["complet"]);
});
test("le worker charge les modules purs par importScripts, dans l'ordre des dépendances", () => {
  const src = readFileSync(new URL("../web/src/projection-worker.js", import.meta.url), "utf8");
  const m = /importScripts\(([^)]*)\)/.exec(src)[1].match(/"([^"]+)"/g).map(x => x.slice(1, -1));
  const ordre = ["calc.js", "marche.js", "projection-outils.js", "projection-fiscalite.js", "projection-evenements.js", "projection-credit.js", "projection-donnees.js", "projection.js", "projection-immo.js"];
  const pos = ordre.map(f => m.indexOf(f));
  assert.ok(pos.every(x => x >= 0), "tous les modules sont chargés");
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, "ordre des dépendances respecté");
});
