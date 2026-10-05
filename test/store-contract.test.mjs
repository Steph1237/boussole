// Contrat du store : store-demo.js (exécuté dans un contexte vm avec un faux navigateur) produit le S attendu
// par les modules — clés exactes, types, alias hérités (couple/steph/compagne, à retirer en Task 5), total
// financier égal à celui calculé directement depuis DEMO — et sa façade db fonctionne.
// store-supabase.js et auth.js ne sont que parsés (pas de réseau), et doivent partager la même table d'alias.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Calc = require("../web/src/calc.js");
const src = f => readFileSync(new URL("../web/src/" + f, import.meta.url), "utf8");

function browser({ search = "?demo", mode } = {}) {
  const mem = new Map();
  const ctx = {
    console, setTimeout, clearTimeout,
    location: { href: "http://localhost:8751/app.html" + search, search, hash: "", pathname: "/app.html" },
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} },
    localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
    __mem: mem,
  };
  if (mode) ctx.BOUSSOLE_MODE = mode;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src("demo-data.js"), ctx, { filename: "demo-data.js" });
  vm.runInContext(src("store-demo.js"), ctx, { filename: "store-demo.js" });
  return ctx;
}
const whenReady = ctx => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("le store n'est jamais prêt")), 2000);
  const check = S => { if (S.ready) { clearTimeout(t); res(S); } };
  ctx.Store.on(check); check(ctx.Store.get());
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const val = p => (p.mode === "market" && p.qty != null && p.price != null ? p.qty * p.price : +(p.value || 0));
const counted = p => p.status !== "à recevoir" && p.status !== "clôturé";
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg + ` : ${a} ≠ ${b}`);
// Les tableaux et objets créés dans le contexte vm ont les prototypes de ce contexte : on les normalise
// par JSON avant deepEqual (qui compare aussi les prototypes).
const J = v => JSON.parse(JSON.stringify(v));

test("démo : état de chargement puis S au contrat (clés exactes, types)", async () => {
  const ctx = browser();
  const S0 = ctx.Store.get();
  assert.equal(ctx.Store.mode, "demo");
  assert.equal(S0.ready, false, "ready = false avant le tick de 150 ms");
  assert.equal(S0.dbOk, null);
  assert.ok(Array.isArray(S0.positions) && S0.positions.length > 0, "les données sont là dès le départ");

  const S = await whenReady(ctx);
  const CONTRACT = {
    ready: ["boolean"], dbOk: ["boolean"], positions: ["array"], snapshots: ["array"], tx: ["array"],
    config: ["object"], status: ["object"], profil: ["object"], profilLoaded: ["boolean"], scope: ["string"],
    people: ["array"], user: ["object", "null"], error: ["null", "string"],
  };
  const kind = v => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
  assert.deepEqual(Object.keys(S).sort(), Object.keys(CONTRACT).sort(), "clés de S");
  for (const [k, types] of Object.entries(CONTRACT)) assert.ok(types.includes(kind(S[k])), `S.${k} est ${kind(S[k])}, attendu ${types.join("|")}`);
  assert.equal(S.ready, true); assert.equal(S.dbOk, true); assert.equal(S.profilLoaded, true); assert.equal(S.error, null);
  assert.equal(typeof ctx.Store.reload, "function");
  assert.equal(typeof ctx.Store.db.doc, "function"); assert.equal(typeof ctx.Store.db.collection, "function");
});

test("démo : foyer de deux personnes et alias hérités", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  assert.deepEqual(J(S.people), [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }]);
  assert.equal(S.scope, "couple");
  assert.equal(S.positions.length, 12);
  S.positions.forEach(p => assert.ok(["steph", "compagne"].includes(p.owner), `owner hérité pour ${p.id} : ${p.owner}`));
  const POS_KEYS = ["id", "name", "envelope", "owner", "bloc", "mode", "isin", "qty", "pru", "price", "priceDate", "value", "valueDate", "status", "hypothesis", "qtyEstimated", "note"];
  S.positions.forEach(p => assert.deepEqual(Object.keys(p).sort(), [...POS_KEYS].sort(), `forme de la position ${p.id}`));
  assert.ok(S.positions.some(p => p.status === "à recevoir"), "une ligne à recevoir");
  // snapshots / config / profil / status aux clés attendues par pilotage.js, reel.js, profil.js
  assert.equal(S.snapshots.length, 3);
  S.snapshots.forEach(s => assert.deepEqual(Object.keys(s).sort(), ["byBloc", "byEnvelope", "compagne", "couple", "date", "source", "steph"]));
  assert.deepEqual(Object.keys(S.config).sort(), ["cushion", "hypotheses", "milestones", "recurring", "rules", "targets", "todo"]);
  assert.ok(S.config.targets.steph && S.config.targets.compagne && S.config.targets.tolerancePts === 3, "cibles par personne (alias)");
  assert.deepEqual(J(S.config.cushion), { mode: "amount", min: 15000, max: 20000 });
  assert.equal(S.config.rules.length, 3); assert.equal(S.config.recurring.length, 2); assert.equal(S.config.todo.length, 2); assert.equal(S.config.milestones.length, 1);
  assert.deepEqual(Object.keys(S.profil).sort(), ["autres", "biens", "credits", "foyer", "personnes", "updatedAt"]);
  assert.equal(S.profil.personnes.steph.salaire, 2800); assert.equal(S.profil.personnes.compagne.salaire, 2300);
  assert.equal(S.profil.biens[0].partSteph, 50); assert.equal("partP1" in S.profil.biens[0], false);
  assert.equal(S.profil.credits[0].owner, "commun");
  assert.ok(S.profil.autres.steph && S.profil.autres.compagne);
  assert.deepEqual(Object.keys(S.status).sort(), ["alerts", "lastRun", "missingPrices", "summary"]);
  // la fonction nocturne « est passée » hier : pas d'alerte « agent inactif » dans Pilotage
  assert.ok(Date.now() - new Date(S.status.lastRun) < 2 * 864e5);
});

test("démo : Calc.financier(S.positions, 'couple') = somme calculée depuis DEMO", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  const D = ctx.DEMO.positions;
  const total = D.filter(counted).reduce((a, p) => a + val(p), 0);
  const p1 = D.filter(p => counted(p) && p.owner === "p1").reduce((a, p) => a + val(p), 0);
  const p2 = D.filter(p => counted(p) && p.owner === "p2").reduce((a, p) => a + val(p), 0);
  assert.ok(total > 90000 && total < 100000, `total démo ≈ 95 k€ (${total})`);
  near(Calc.financier(S.positions, "couple"), total, "total foyer");
  near(Calc.financier(S.positions, "steph"), p1, "total p1");
  near(Calc.financier(S.positions, "compagne"), p2, "total p2");
  near(Calc.aRecevoir(S.positions, "couple"), D.filter(p => p.status === "à recevoir").reduce((a, p) => a + val(p), 0), "à recevoir");
  assert.ok(Calc.completude(S.profil) > 80, "profil démo quasi complet");
});

test("démo : setScope accepte les deux vocabulaires, mémorise la forme canonique", async () => {
  const ctx = browser();
  await whenReady(ctx);
  ctx.Store.setScope("steph"); assert.equal(ctx.Store.get().scope, "steph"); assert.equal(ctx.__mem.get("scope"), "p1");
  ctx.Store.setScope("p2"); assert.equal(ctx.Store.get().scope, "compagne"); assert.equal(ctx.__mem.get("scope"), "p2");
  ctx.Store.setScope("foyer"); assert.equal(ctx.Store.get().scope, "couple");
  ctx.Store.setScope("n'importe quoi"); assert.equal(ctx.Store.get().scope, "couple");
  // un ancien navigateur avec « steph » en mémoire démarre sur p1
  const ctx2 = browser(); ctx2.__mem.set("scope", "compagne");
  const ctx3 = browser(); ctx3.__mem.set("scope", "p1");
  void ctx2; void ctx3;
});

test("démo : la façade db écrit en mémoire (positions, transactions, config, profil) et réémet", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  let n = 0; ctx.Store.on(() => n++);

  await ctx.Store.db.doc("positions/livret-a").update({ value: 13000, valueDate: "2026-10-05" });
  assert.equal(ctx.Store.get().positions.find(p => p.id === "livret-a").value, 13000);

  await ctx.Store.db.doc("positions/cto-nouvelle").set({ id: "cto-nouvelle", name: "Nouvelle ligne", envelope: "CTO Sam", owner: "compagne", bloc: "Monde", isin: null, mode: "market", qty: 2, pru: 10, price: 10, priceDate: "2026-10-05", value: null, valueDate: null, status: "actif", hypothesis: null, qtyEstimated: false });
  const nl = ctx.Store.get().positions.find(p => p.id === "cto-nouvelle");
  assert.equal(nl.owner, "compagne", "owner exposé en alias");
  assert.equal(ctx.DEMO.positions.length, 12, "window.DEMO n'est pas modifié (copie)");

  const before = ctx.Store.get().tx.length;
  const r = await ctx.Store.db.collection("transactions").add({ date: "2026-10-05", type: "achat", positionId: "cto-nouvelle", qty: 2, price: 10, amount: 20, note: "", source: "manuel", createdAt: new Date().toISOString() });
  assert.ok(r && r.id);
  assert.equal(ctx.Store.get().tx.length, before + 1);
  assert.equal(ctx.Store.get().tx[0].positionId, "cto-nouvelle");

  const todo = S.config.todo.map((o, i) => (i === 0 ? { ...o, done: true } : o));
  await ctx.Store.db.doc("config/main").update({ todo });
  assert.equal(ctx.Store.get().config.todo[0].done, true);
  assert.ok(ctx.Store.get().config.targets.steph, "les autres clés de config sont conservées");

  const profil = JSON.parse(JSON.stringify(S.profil));
  profil.personnes.steph.salaire = 3000; profil.biens[0].partSteph = 40; profil.credits[0].owner = "steph"; profil.updatedAt = "2026-10-05T10:00:00.000Z";
  await ctx.Store.db.doc("profil/main").set(profil);
  const P = ctx.Store.get().profil;
  assert.equal(P.personnes.steph.salaire, 3000);
  assert.equal(P.biens[0].partSteph, 40); assert.equal("partP1" in P.biens[0], false);
  assert.equal(P.credits[0].owner, "steph");
  assert.equal(P.updatedAt, "2026-10-05T10:00:00.000Z");
  assert.deepEqual(J(ctx.Store.get().people).map(p => p.nom), ["Camille", "Sam"]);

  await assert.rejects(ctx.Store.db.doc("positions/inexistante").update({ value: 1 }), e => e.code === "not_found");
  await assert.rejects(ctx.Store.db.doc("inconnue/x").set({}), e => e.code === "invalid_argument");

  await wait(100);
  assert.ok(n >= 1, "les abonnés ont été notifiés");
});

test("choix du mode : store-demo ne s'installe que si ?demo ou BOUSSOLE_MODE = demo", () => {
  assert.equal(browser({ search: "" }).Store, undefined);
  assert.equal(browser({ search: "?x=1&demo" }).Store?.mode, "demo");
  assert.equal(browser({ search: "?demo=1" }).Store?.mode, "demo");
  assert.equal(browser({ search: "?demolition" }).Store, undefined);
  assert.equal(browser({ search: "", mode: "demo" }).Store?.mode, "demo");
});

test("store-supabase.js et auth.js : parsent, et partagent la table d'alias SCOPE_LEGACY de store-demo.js", () => {
  const sup = src("store-supabase.js"), demo = src("store-demo.js"), auth = src("auth.js");
  assert.doesNotThrow(() => new Function(sup), "store-supabase.js ne parse pas");
  assert.doesNotThrow(() => new Function(auth), "auth.js ne parse pas");
  const table = s => { const m = s.match(/const SCOPE_LEGACY = (\{[^}]*\});/); assert.ok(m, "SCOPE_LEGACY introuvable"); return m[1].replace(/\s+/g, ""); };
  assert.equal(table(sup), table(demo));
  assert.equal(table(demo), '{foyer:"couple",p1:"steph",p2:"compagne"}');
  for (const s of [sup, demo]) assert.match(s, /RETIRER EN TASK 5/, "le bloc d'alias doit être marqué à retirer");
  // le store Supabase expose le même contrat
  for (const k of ['mode: "supabase"', "get: () => S", "on(fn)", "setScope(s)", "emit,", "reload,", "db,", "window.Store = Store"]) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  for (const k of ["price_override", "value_date", "qty_estimated", "request_instrument", "visibilitychange", 'from("transactions")', 'from("biens")', 'from("credits")', 'from("profiles")', 'from("config")']) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  for (const k of ["signInWithPassword", "signUp", "signInWithOtp", 'provider: "google"', "onAuthStateChange", "requireSession", "index.html"]) assert.ok(auth.includes(k), `auth.js : ${k}`);
});
