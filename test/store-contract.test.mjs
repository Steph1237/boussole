// Contrat du store : store-demo.js (exécuté dans un contexte vm avec un faux navigateur) produit le S attendu
// par les modules — clés exactes, types, vocabulaire canonique (foyer / p1 / p2), total financier égal à celui
// calculé directement depuis DEMO — et sa façade db fonctionne.
// store-supabase.js et auth.js ne sont que parsés (pas de réseau) ; plus aucun alias hérité (couple/steph/compagne).
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Calc = require("../web/src/calc.js");
const src = f => readFileSync(new URL("../web/src/" + f, import.meta.url), "utf8");

function browser({ search = "?demo", mode, prep } = {}) {
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
  if (prep) prep(ctx.DEMO);
  vm.runInContext(src("sensible.js"), ctx, { filename: "sensible.js" }); // filtre partagé (window.Sensible), chargé avant les stores comme dans build.mjs
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
    config: ["object"], status: ["object"], profil: ["object"], profilLoaded: ["boolean"], budget: ["object", "null"], objectifs: ["array"], risque: ["object", "null"], classes: ["object"], propositions: ["array"], connexions: ["array"], memoire: ["array"], savoir: ["object"], onboardingDone: ["boolean"], scope: ["string"],
    people: ["array"], user: ["object", "null"], error: ["null", "string"],
  };
  const kind = v => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
  assert.deepEqual(Object.keys(S).sort(), Object.keys(CONTRACT).sort(), "clés de S");
  for (const [k, types] of Object.entries(CONTRACT)) assert.ok(types.includes(kind(S[k])), `S.${k} est ${kind(S[k])}, attendu ${types.join("|")}`);
  assert.equal(S.ready, true); assert.equal(S.dbOk, true); assert.equal(S.profilLoaded, true); assert.equal(S.error, null);
  assert.equal(typeof ctx.Store.reload, "function");
  assert.equal(typeof ctx.Store.db.doc, "function"); assert.equal(typeof ctx.Store.db.collection, "function");
});

test("démo : foyer de deux personnes, formes canoniques", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  assert.deepEqual(J(S.people), [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }]);
  assert.equal(S.scope, "foyer");
  assert.equal(S.positions.length, 12);
  S.positions.forEach(p => assert.ok(["p1", "p2"].includes(p.owner), `owner canonique pour ${p.id} : ${p.owner}`));
  const POS_KEYS = ["id", "name", "envelope", "owner", "bloc", "mode", "isin", "qty", "pru", "price", "priceDate", "value", "valueDate", "status", "hypothesis", "qtyEstimated", "note",
    "ter", "zone", "devise", "annoteSource", "annoteLe"];
  S.positions.forEach(p => assert.deepEqual(Object.keys(p).sort(), [...POS_KEYS].sort(), `forme de la position ${p.id}`));
  assert.ok(S.positions.some(p => p.status === "à recevoir"), "une ligne à recevoir");
  // snapshots / config / profil / status aux clés attendues par pilotage.js, reel.js, profil.js
  assert.equal(S.snapshots.length, 3);
  S.snapshots.forEach(s => assert.deepEqual(Object.keys(s).sort(), ["byBloc", "byEnvelope", "date", "foyer", "p1", "p2", "source"]));
  S.snapshots.forEach(s => near(s.p1 + s.p2, s.foyer, "photo : p1 + p2 = foyer"));
  assert.deepEqual(Object.keys(S.config).sort(), ["cushion", "hypotheses", "milestones", "recurring", "rules", "targets", "todo"]);
  assert.deepEqual(Object.keys(S.config.targets).sort(), ["p1", "p2", "tolerancePts"], "cibles par personne");
  assert.equal(S.config.targets.tolerancePts, 3);
  assert.deepEqual(J(S.config.cushion), { mode: "amount", min: 15000, max: 20000 });
  assert.deepEqual(J(S.config.rules.map(r => r.type).sort()), ["envelope_cap", "max_bloc_pct", "max_line_pct", "min_bloc_pct", "price_floor", "stale_prices"], "une règle de chaque type");
  assert.equal(S.config.recurring.length, 2); assert.equal(S.config.todo.length, 2); assert.equal(S.config.milestones.length, 1);
  assert.deepEqual(Object.keys(S.profil).sort(), ["autres", "biens", "credits", "foyer", "personnes", "protection", "updatedAt"]);
  assert.deepEqual(J(S.profil.protection), {}, "protection non déclarée dans la démo");
  assert.equal(S.risque, null, "démo : questionnaire de risque jamais rempli");
  assert.deepEqual(J(S.classes), {}, "démo : aucune surcharge poche → classe");
  // annotations d'instruments : trois lignes cotées sur cinq ont un TER sourcé, moins de la moitié des montants cotés
  const cotees = S.positions.filter(p => p.mode === "market" && counted(p));
  const avecTer = cotees.filter(p => p.ter != null);
  assert.equal(avecTer.length, 3);
  avecTer.forEach(p => { assert.ok(p.ter >= 0 && p.ter <= 10); assert.ok(p.annoteSource && p.annoteSource.length <= 300, `source du TER de ${p.id}`); assert.ok(p.annoteLe); });
  const part = avecTer.reduce((a, p) => a + val(p), 0) / cotees.reduce((a, p) => a + val(p), 0);
  assert.ok(part > 0.3 && part < 0.5, `couverture des TER : ${part}`);
  S.positions.filter(p => p.ter == null).forEach(p => { assert.equal(p.annoteSource, null); assert.equal(p.zone, null); assert.equal(p.devise, null); });
  assert.deepEqual(Object.keys(S.profil.personnes).sort(), ["p1", "p2"]);
  assert.equal(S.profil.personnes.p1.salaire, 2800); assert.equal(S.profil.personnes.p2.salaire, 2300);
  assert.equal(S.profil.biens[0].part_p1, 50); assert.equal("partSteph" in S.profil.biens[0], false);
  assert.ok(["p1", "p2", "commun"].includes(S.profil.credits[0].owner));
  assert.deepEqual(Object.keys(S.profil.autres).sort(), ["p1", "p2"]);
  assert.deepEqual(Object.keys(S.status).sort(), ["alerts", "lastRun", "missingPrices", "summary"]);
  // la fonction nocturne « est passée » hier : pas d'alerte « agent inactif » dans Pilotage
  assert.ok(Date.now() - new Date(S.status.lastRun) < 2 * 864e5);
});

test("démo : Calc.financier(S.positions, 'foyer') = somme calculée depuis DEMO", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  const D = ctx.DEMO.positions;
  const total = D.filter(counted).reduce((a, p) => a + val(p), 0);
  const p1 = D.filter(p => counted(p) && p.owner === "p1").reduce((a, p) => a + val(p), 0);
  const p2 = D.filter(p => counted(p) && p.owner === "p2").reduce((a, p) => a + val(p), 0);
  assert.ok(total > 90000 && total < 100000, `total démo ≈ 95 k€ (${total})`);
  near(total, 94989.9, "total démo inchangé");
  near(Calc.financier(S.positions, "foyer"), total, "total foyer");
  near(Calc.financier(S.positions, "p1"), p1, "total p1");
  near(Calc.financier(S.positions, "p2"), p2, "total p2");
  near(Calc.aRecevoir(S.positions, "foyer"), D.filter(p => p.status === "à recevoir").reduce((a, p) => a + val(p), 0), "à recevoir");
  assert.ok(Calc.completude(S.profil) > 80, "profil démo quasi complet");
});

test("démo : setScope n'accepte que foyer / p1 / p2 et le mémorise", async () => {
  const ctx = browser();
  await whenReady(ctx);
  ctx.Store.setScope("p1"); assert.equal(ctx.Store.get().scope, "p1"); assert.equal(ctx.__mem.get("scope"), "p1");
  ctx.Store.setScope("p2"); assert.equal(ctx.Store.get().scope, "p2"); assert.equal(ctx.__mem.get("scope"), "p2");
  ctx.Store.setScope("foyer"); assert.equal(ctx.Store.get().scope, "foyer");
  ctx.Store.setScope("steph"); assert.equal(ctx.Store.get().scope, "foyer", "l'ancien vocabulaire est refusé");
  ctx.Store.setScope("n'importe quoi"); assert.equal(ctx.Store.get().scope, "foyer");
  // un foyer d'une seule personne : pas de p2, le périmètre retombe sur le foyer
  ctx.Store.setScope("p2");
  const profil = JSON.parse(JSON.stringify(ctx.Store.get().profil)); profil.foyer.adultes = 1;
  await ctx.Store.db.doc("profil/main").set(profil);
  assert.deepEqual(J(ctx.Store.get().people), [{ id: "p1", nom: "Camille" }]);
  assert.equal(ctx.Store.get().scope, "foyer");
});

test("démo : la façade db écrit en mémoire (positions, transactions, config, profil) et réémet", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  let n = 0; ctx.Store.on(() => n++);

  await ctx.Store.db.doc("positions/livret-a").update({ value: 13000, valueDate: "2026-10-05" });
  assert.equal(ctx.Store.get().positions.find(p => p.id === "livret-a").value, 13000);

  await ctx.Store.db.doc("positions/cto-nouvelle").set({ id: "cto-nouvelle", name: "Nouvelle ligne", envelope: "CTO Sam", owner: "p2", bloc: "Monde", isin: null, mode: "market", qty: 2, pru: 10, price: 10, priceDate: "2026-10-05", value: null, valueDate: null, status: "actif", hypothesis: null, qtyEstimated: false });
  const nl = ctx.Store.get().positions.find(p => p.id === "cto-nouvelle");
  assert.equal(nl.owner, "p2", "owner canonique");
  assert.equal(ctx.DEMO.positions.length, 12, "window.DEMO n'est pas modifié (copie)");

  const before = ctx.Store.get().tx.length;
  const r = await ctx.Store.db.collection("transactions").add({ date: "2026-10-05", type: "achat", positionId: "cto-nouvelle", qty: 2, price: 10, amount: 20, note: "", source: "manuel", createdAt: new Date().toISOString() });
  assert.ok(r && r.id);
  assert.equal(ctx.Store.get().tx.length, before + 1);
  assert.equal(ctx.Store.get().tx[0].positionId, "cto-nouvelle");

  const todo = S.config.todo.map((o, i) => (i === 0 ? { ...o, done: true } : o));
  await ctx.Store.db.doc("config/main").update({ todo });
  assert.equal(ctx.Store.get().config.todo[0].done, true);
  assert.ok(ctx.Store.get().config.targets.p1, "les autres clés de config sont conservées");
  const n0 = ctx.Store.get().config.rules.length;
  await ctx.Store.db.doc("config/main").update({ rules: [...ctx.Store.get().config.rules, { type: "stale_prices", days: 10 }] });
  assert.equal(ctx.Store.get().config.rules.length, n0 + 1);
  await ctx.Store.db.doc("config/main").update({ cushion: { mode: "months", months: 6, depenses: 3000 } });
  assert.deepEqual(J(ctx.Store.get().config.cushion), { mode: "months", months: 6, depenses: 3000 });

  const profil = JSON.parse(JSON.stringify(S.profil));
  profil.personnes.p1.salaire = 3000; profil.personnes.p1.nom = "Camille-Anne"; profil.biens[0].part_p1 = 40; profil.credits[0].owner = "p1"; profil.updatedAt = "2026-10-05T10:00:00.000Z";
  await ctx.Store.db.doc("profil/main").set(profil);
  const P = ctx.Store.get().profil;
  assert.equal(P.personnes.p1.salaire, 3000);
  assert.equal(P.biens[0].part_p1, 40);
  assert.equal(P.credits[0].owner, "p1");
  assert.equal(P.updatedAt, "2026-10-05T10:00:00.000Z");
  assert.deepEqual(J(ctx.Store.get().people).map(p => p.nom), ["Camille-Anne", "Sam"], "le renommage se répercute sur people");

  await assert.rejects(ctx.Store.db.doc("positions/inexistante").update({ value: 1 }), e => e.code === "not_found");
  await assert.rejects(ctx.Store.db.doc("inconnue/x").set({}), e => e.code === "invalid_argument");

  await wait(100);
  assert.ok(n >= 1, "les abonnés ont été notifiés");
});

const OBJ_KEYS = ["cible", "dateCible", "deja", "enveloppes", "id", "nom", "poches", "priorite", "rendement", "source", "type"];

test("démo : budget et objectifs d'exemple, au contrat et cohérents avec le foyer", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  assert.deepEqual(Object.keys(S.budget), ["lignes"]);
  assert.ok(S.budget.lignes.length >= 12, "une douzaine de lignes");
  S.budget.lignes.forEach(l => {
    assert.ok(["revenu", "depense", "epargne"].includes(l.type), `type de ligne ${l.id}`);
    assert.ok(["mois", "an"].includes(l.frequence), `fréquence de ${l.id}`);
    assert.equal(typeof l.montant, "number"); assert.ok(l.montant >= 0);
    assert.ok(l.id && l.libelle && l.categorie, `ligne ${l.id} complète`);
  });
  assert.equal(S.budget.lignes.filter(l => l.type === "revenu").length, 0, "les salaires viennent du profil");
  assert.equal(S.budget.lignes.filter(l => l.frequence === "an").length, 1, "une ligne annuelle (taxe foncière)");
  const mensuel = l => (l.frequence === "an" ? l.montant / 12 : l.montant);
  const depenses = S.budget.lignes.filter(l => l.type === "depense").reduce((a, l) => a + mensuel(l), 0)
    + S.profil.biens.reduce((a, b) => a + b.mensualite, 0) + S.profil.credits.reduce((a, c) => a + c.mensualite, 0);
  assert.equal(S.budget.lignes.filter(l => l.type === "epargne").reduce((a, l) => a + l.montant, 0), 650);

  assert.equal(S.objectifs.length, 3);
  S.objectifs.forEach(o => {
    assert.deepEqual(Object.keys(o).sort(), OBJ_KEYS, `forme de l'objectif ${o.id}`);
    for (const k of ["cible", "deja", "rendement", "priorite"]) assert.equal(typeof o[k], "number", `${o.id}.${k} est un nombre`);
    assert.match(o.dateCible, /^\d{4}-\d{2}-\d{2}$/);
  });
  assert.deepEqual(J(S.objectifs.map(o => o.type)), ["matelas", "apport", "retraite"], "triés par priorité");
  const matelas = S.objectifs.find(o => o.type === "matelas");
  assert.equal(matelas.cible, Math.round((6 * depenses) / 100) * 100, "matelas = 6 mois de dépenses");
  assert.deepEqual(J(S.objectifs.find(o => o.type === "retraite").poches), ["Monde", "Europe", "Asie"]);
});

test("démo : façade budget et objectifs (set, upsert création / mise à jour, delete, refus)", async () => {
  const ctx = browser();
  await whenReady(ctx);
  const db = ctx.Store.db;

  await db.doc("budget/main").set({ lignes: [{ type: "depense", categorie: "Logement", libelle: "Loyer garage", montant: "90" }, { id: "x", type: "epargne", categorie: "Épargne", libelle: "PEL", montant: 45, frequence: "an", owner: "p2" }] });
  const B = ctx.Store.get().budget;
  assert.equal(B.lignes.length, 2);
  assert.equal(B.lignes[0].montant, 90, "montant converti en nombre");
  assert.equal(B.lignes[0].frequence, "mois", "fréquence par défaut");
  assert.ok(B.lignes[0].id, "identifiant attribué");
  assert.equal(B.lignes[1].owner, "p2");
  await assert.rejects(db.doc("budget/main").set({ lignes: [{ type: "salaire", montant: 1 }] }), e => e.code === "invalid_argument" && /type/.test(e.message));
  await assert.rejects(db.doc("budget/main").set({ lignes: [{ type: "depense", montant: -5 }] }), e => e.code === "invalid_argument");
  await assert.rejects(db.doc("budget/main").set({ lignes: "non" }), e => e.code === "invalid_argument");
  assert.equal(ctx.Store.get().budget.lignes.length, 2, "un refus ne modifie rien");

  const r = await db.collection("objectifs").upsert({ nom: "Voyage au Japon", type: "projet", cible: "8000", dateCible: "2028-04-01", deja: 500, source: "saisi", rendement: 2, priorite: 4 });
  assert.ok(r && r.id, "création : identifiant renvoyé");
  let O = ctx.Store.get().objectifs;
  assert.equal(O.length, 4);
  const nv = O.find(o => o.id === r.id);
  assert.deepEqual(Object.keys(nv).sort(), OBJ_KEYS);
  assert.equal(nv.cible, 8000); assert.equal(nv.dateCible, "2028-04-01"); assert.deepEqual(J(nv.poches), []);

  const r2 = await db.collection("objectifs").upsert({ id: "obj-apport", cible: 65000, deja: 1000, source: "saisi" });
  assert.equal(r2.id, "obj-apport", "mise à jour : même identifiant");
  O = ctx.Store.get().objectifs;
  assert.equal(O.length, 4, "pas de doublon");
  const ap = O.find(o => o.id === "obj-apport");
  assert.equal(ap.cible, 65000); assert.equal(ap.deja, 1000); assert.equal(ap.nom, "Apport maison", "les autres champs sont conservés");

  const r3 = await db.collection("objectifs").upsert({ id: "inconnu", nom: "Id inconnu", type: "projet" });
  assert.notEqual(r3.id, "inconnu", "un id inconnu crée un nouvel objectif");
  assert.equal(ctx.Store.get().objectifs.length, 5);

  await assert.rejects(db.collection("objectifs").upsert({ nom: "X", type: "vacances" }), e => e.code === "invalid_argument" && /type/.test(e.message));
  await assert.rejects(db.collection("objectifs").upsert({ id: "obj-apport", type: "nimporte" }), e => e.code === "invalid_argument");
  await assert.rejects(db.collection("objectifs").upsert({ nom: "X", cible: -1 }), e => e.code === "invalid_argument");
  await assert.rejects(db.collection("objectifs").upsert({ nom: "X", rendement: 80 }), e => e.code === "invalid_argument");
  await assert.rejects(db.collection("objectifs").upsert({ nom: "X", dateCible: "31/12/2030" }), e => e.code === "invalid_argument");
  await assert.rejects(db.collection("objectifs").upsert({ nom: "X", source: "banque" }), e => e.code === "invalid_argument");
  assert.equal(ctx.Store.get().objectifs.find(o => o.id === "obj-apport").type, "apport", "un refus ne modifie rien");
  assert.equal(ctx.Store.get().objectifs.length, 5);

  await db.doc("objectifs/" + r.id).delete();
  assert.ok(!ctx.Store.get().objectifs.some(o => o.id === r.id));
  assert.equal(ctx.Store.get().objectifs.length, 4);
  await assert.rejects(db.doc("objectifs/" + r.id).delete(), e => e.code === "not_found");
  await assert.rejects(db.doc("positions/livret-a").delete(), e => e.code === "invalid_argument");
  await assert.rejects(db.collection("positions").upsert({}), e => e.code === "invalid_argument");
  assert.equal(ctx.DEMO.objectifs.length, 3, "window.DEMO n'est pas modifié (copie)");
});

test("démo : façade Diagnostic (risque, classes, protection) sans toucher au reste du profil", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  const db = ctx.Store.db;
  const biens = J(S.profil.biens), personnes = J(S.profil.personnes);

  const risque = { reponses: { horizon: "8-15", reaction: "rien" }, profil: "equilibre", score: 55, date: "2026-10-10" };
  await db.doc("profil/main").update({ risque });
  assert.deepEqual(J(ctx.Store.get().risque), risque);
  assert.equal("risque" in ctx.Store.get().profil, false, "risque est exposé dans S.risque, pas dans le profil");

  await db.doc("profil/main").update({ classes: { Obligations: "fonds_euros", Convictions: "actions" } });
  assert.deepEqual(J(ctx.Store.get().classes), { Obligations: "fonds_euros", Convictions: "actions" });
  assert.deepEqual(J(ctx.Store.get().risque), risque, "le profil de risque est conservé");

  await db.doc("profil/main").update({ protection: { prevoyance: true, emprunteur: false } });
  const P = ctx.Store.get().profil;
  assert.deepEqual(J(P.protection), { prevoyance: true, emprunteur: false });
  assert.deepEqual(J(P.biens), biens, "biens intacts");
  assert.deepEqual(J(P.personnes), personnes, "personnes intactes");
  assert.equal("classes" in P, false);

  await db.doc("profil/main").update({ risque: null });
  assert.equal(ctx.Store.get().risque, null, "null efface le profil de risque");
  assert.deepEqual(J(ctx.Store.get().classes), { Obligations: "fonds_euros", Convictions: "actions" });

  await assert.rejects(db.doc("profil/main").update({ risque: "dynamique" }), e => e.code === "invalid_argument");
  await assert.rejects(db.doc("profil/main").update({ classes: { Obligations: 3 } }), e => e.code === "invalid_argument");
  await assert.rejects(db.doc("profil/main").update({ protection: [true] }), e => e.code === "invalid_argument");
  assert.deepEqual(J(ctx.Store.get().profil.protection), { prevoyance: true, emprunteur: false }, "un refus ne modifie rien");
  assert.equal(ctx.DEMO.risque, null, "window.DEMO n'est pas modifié (copie)");
});

const PROP_KEYS = ["apres", "avant", "cible", "creeLe", "decideLe", "id", "justification", "lot", "operation", "ref", "source", "statut"];

test("démo : propositions de Claude au contrat (un lot, cinq changements en attente, plusieurs cibles)", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  assert.equal(S.propositions.length, 5);
  S.propositions.forEach(p => {
    assert.deepEqual(Object.keys(p).sort(), PROP_KEYS, `forme de la proposition ${p.id}`);
    assert.equal(p.lot, "demo-lot-1"); assert.equal(p.statut, "en_attente"); assert.equal(p.decideLe, null);
    assert.ok(["profil", "budget", "position", "bien", "credit", "objectif", "risque", "protection"].includes(p.cible), p.cible);
    assert.ok(["creer", "modifier", "supprimer"].includes(p.operation), p.operation);
    assert.ok(p.source && p.source.length <= 500, "source obligatoire");
    assert.ok(!isNaN(Date.parse(p.creeLe)));
  });
  assert.deepEqual(J(S.propositions.map(p => p.cible)).sort(), ["bien", "budget", "position", "protection", "risque"]);
  assert.ok(S.propositions.some(p => /Relevé PEA du 30\/09/.test(p.source)));
  const pos = S.propositions.find(p => p.cible === "position");
  assert.equal(pos.operation, "modifier"); assert.ok(S.positions.some(x => x.id === pos.ref), "la position visée existe");
  assert.equal(pos.avant.qty, S.positions.find(x => x.id === pos.ref).qty, "avant = valeur actuelle");
  const bien = S.propositions.find(p => p.cible === "bien");
  assert.equal(bien.avant.crd, S.profil.biens.find(b => b.id === bien.ref).crd);
  const Risque = require("../web/src/risque.js");
  const rq = S.propositions.find(p => p.cible === "risque");
  for (const [k, v] of Object.entries(rq.apres)) assert.ok(Risque.QUESTIONS.find(q => q.id === k).options.some(o => o.v === v), `réponse valide ${k}=${v}`);
  assert.equal(typeof ctx.Store.propositions.appliquer, "function");
  assert.equal(typeof ctx.Store.propositions.refuser, "function");
});

test("démo : appliquer (avec une valeur modifiée) et refuser changent le statut et les données visées", async () => {
  const ctx = browser();
  await whenReady(ctx);
  const P = ctx.Store.propositions;
  let n = 0; ctx.Store.on(() => n++);
  const r = await P.appliquer(["prop-demo-protection", "prop-demo-pea", "prop-demo-sport"], { "prop-demo-pea": { qty: 125 } });
  assert.deepEqual(J(r), { appliquees: 3 });
  const S = ctx.Store.get();
  assert.equal(S.profil.protection.prevoyance, true);
  assert.equal(S.profil.protection.emprunteur, true);
  assert.equal(S.positions.find(p => p.id === "pea-etf-monde").qty, 125, "la valeur modifiée par l'utilisateur l'emporte");
  const sport = S.budget.lignes.find(l => l.libelle === "Salle de sport");
  assert.ok(sport && sport.id && sport.montant === 39 && sport.frequence === "mois", "ligne de budget ajoutée");
  const st = id => S.propositions.find(p => p.id === id);
  for (const id of ["prop-demo-protection", "prop-demo-pea", "prop-demo-sport"]) { assert.equal(st(id).statut, "acceptee"); assert.ok(st(id).decideLe); }
  assert.deepEqual(J(st("prop-demo-pea").apres), { qty: 125 }, "apres garde la valeur appliquée");
  assert.equal(st("prop-demo-rp").statut, "en_attente");
  // déjà décidée : rien ne se passe
  assert.deepEqual(J(await P.appliquer(["prop-demo-protection"])), { appliquees: 0 });

  assert.deepEqual(J(await P.refuser(["prop-demo-rp", "inconnue"])), { refusees: 1 });
  const S2 = ctx.Store.get();
  assert.equal(S2.propositions.find(p => p.id === "prop-demo-rp").statut, "refusee");
  assert.equal(S2.profil.biens.find(b => b.id === "bien-rp").crd, 150000, "refuser ne touche pas aux données");

  await P.appliquer(["prop-demo-risque"]);
  assert.deepEqual(J(ctx.Store.get().risque), { reponses: { horizon: "8-15", reaction: "rien" } });
  await wait(100);
  assert.ok(n >= 1, "les abonnés ont été notifiés");
  assert.equal(ctx.DEMO.propositions[0].statut, "en_attente", "window.DEMO n'est pas modifié (copie)");
});

test("démo : propositions — tout ou rien, refus en français", async () => {
  const ctx = browser();
  const S0 = await whenReady(ctx);
  const P = ctx.Store.propositions;
  // une modification invalide annule toute la décision
  await assert.rejects(P.appliquer(["prop-demo-protection", "prop-demo-sport"], { "prop-demo-sport": { type: "salaire", montant: 10 } }),
    e => e.code === "invalid_argument" && /Proposition non appliquée \(ligne de budget, creer\)/.test(e.message) && /type/.test(e.message));
  const S = ctx.Store.get();
  assert.deepEqual(J(S.profil.protection), {}, "rien n'est appliqué");
  assert.ok(S.propositions.every(p => p.statut === "en_attente"));
  assert.equal(S.budget.lignes.length, S0.budget.lignes.length);
  await assert.rejects(P.appliquer(["prop-demo-pea"], [1]), e => e.code === "invalid_argument");
});

test("démo : propositions sur les autres cibles (profil, crédit, bien, objectif, placement avec mouvement)", async () => {
  const add = (id, cible, operation, ref, apres) => ({ id, lot: "l2", cible, operation, ref, avant: null, apres, source: "test", justification: null,
    statut: "en_attente", creeLe: "2026-10-10T10:00:0" + id.slice(-1) + ".000Z", decideLe: null });
  const ctx = browser({ prep: D => D.propositions.push(
    add("x1", "profil", "modifier", null, { foyer: { tmi: 41 }, personnes: { p2: { salaire: 2500 } } }),
    add("x2", "credit", "supprimer", "credit-auto", null),
    add("x3", "bien", "creer", null, { nom: "Studio", usage: "locatif", valeur: 120000, loyer: 550 }),
    add("x4", "objectif", "modifier", "obj-apport", { date_cible: "2030-06-30", cible: 70000 }),
    add("x5", "position", "creer", null, { name: "Livret jeune", envelope: "Livrets", owner: "p1", bloc: "Épargne", mode: "manual", value: 1600, value_date: "2026-09-30",
      transaction: { date: "2026-09-30", type: "solde", amount: 1600 } }),
    add("x6", "bien", "modifier", "inconnu", { crd: 1 })) });
  await whenReady(ctx);
  const r = await ctx.Store.propositions.appliquer(["x1", "x2", "x3", "x4", "x5"]);
  assert.deepEqual(J(r), { appliquees: 5 });
  const S = ctx.Store.get();
  assert.equal(S.profil.foyer.tmi, 41); assert.equal(S.profil.foyer.adultes, 2, "fusion : le reste du foyer est conservé");
  assert.equal(S.profil.personnes.p2.salaire, 2500); assert.equal(S.profil.personnes.p2.nom, "Sam");
  assert.equal(S.profil.credits.length, 0);
  assert.ok(S.profil.biens.some(b => b.nom === "Studio" && b.usage === "locatif" && b.loyer === 550 && b.id));
  const ap = S.objectifs.find(o => o.id === "obj-apport");
  assert.equal(ap.dateCible, "2030-06-30"); assert.equal(ap.cible, 70000);
  const lj = S.positions.find(p => p.name === "Livret jeune");
  assert.ok(lj && lj.value === 1600 && lj.valueDate === "2026-09-30" && lj.status === "actif");
  assert.equal(S.tx[0].positionId, lj.id); assert.equal(S.tx[0].type, "solde"); assert.equal(S.tx[0].source, "mcp");
  await assert.rejects(ctx.Store.propositions.appliquer(["x6"]), e => e.code === "invalid_argument" && /introuvable/.test(e.message));
  assert.equal(ctx.Store.get().propositions.find(p => p.id === "x6").statut, "en_attente");
});

const CONN_KEYS = ["appels", "clientId", "clientNom", "dernierLe", "premierLe"];
const CLAUDE_ID = "30351516-1e76-4884-8fb2-ae856799a723";

test("démo : connexions vides, surveillerConnexions(true) simule Claude après 4 s, false annule", async () => {
  const on = browser(), off = browser();
  const [S1, S2] = await Promise.all([whenReady(on), whenReady(off)]);
  assert.deepEqual(J(S1.connexions), [], "aucun assistant connecté au départ");
  assert.equal(typeof on.Store.surveillerConnexions, "function");
  const t0 = Date.now();
  const connecte = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("Claude n'est jamais connecté")), 6000);
    on.Store.on(S => { if (S.connexions.length) { clearTimeout(t); res(S); } });
  });
  on.Store.surveillerConnexions(true);
  on.Store.surveillerConnexions(true); // idempotent : une seule simulation
  off.Store.surveillerConnexions(true);
  await wait(100);
  assert.equal(on.Store.get().connexions.length, 0, "pas de connexion immédiate");
  off.Store.surveillerConnexions(false);
  const S = await connecte;
  assert.ok(Date.now() - t0 >= 3900, "connexion simulée environ 4 s plus tard");
  assert.equal(S.connexions.length, 1);
  const c = S.connexions[0];
  assert.deepEqual(Object.keys(c).sort(), CONN_KEYS, "forme d'une connexion");
  assert.equal(c.clientId, CLAUDE_ID); assert.equal(c.clientNom, "Claude"); assert.equal(c.appels, 1);
  assert.ok(!isNaN(Date.parse(c.premierLe)) && c.premierLe === c.dernierLe);
  await wait(250);
  assert.equal(off.Store.get().connexions.length, 0, "surveillerConnexions(false) annule la simulation");
  on.Store.surveillerConnexions(true); await wait(50);
  assert.equal(on.Store.get().connexions.length, 1, "déjà connecté : pas de doublon");
  assert.deepEqual(J(on.DEMO.connexions), [], "window.DEMO n'est pas modifié (copie)");
});

const MEM_KEYS = ["categorie", "contenu", "creeLe", "echeance", "epingle", "id", "majLe", "source"];
const FICHE_KEYS = ["misAJourLe", "motsCles", "resume", "slug", "sources", "theme", "titre", "version"];
const REPERE_KEYS = ["cle", "dateEffet", "libelle", "mode", "sourceTitre", "sourceUrl", "unite", "valeur", "verifieLe"];
const CATEGORIES = ["contexte", "preference", "projet", "decision", "explique", "a_suivre"];

test("démo : mémoire de l'agent et savoir commun au contrat (6 souvenirs, 4 fiches sans contenu, 4 repères d'exemple)", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(S.memoire.length, 6);
  S.memoire.forEach(m => {
    assert.deepEqual(Object.keys(m).sort(), MEM_KEYS, `forme du souvenir ${m.id}`);
    assert.ok(CATEGORIES.includes(m.categorie), m.categorie);
    assert.ok(m.contenu.length >= 1 && m.contenu.length <= 500);
    assert.equal(typeof m.epingle, "boolean");
    assert.ok(m.echeance === null || m.categorie === "a_suivre", "échéance seulement pour « à suivre »");
    assert.ok(!isNaN(Date.parse(m.creeLe)) && !isNaN(Date.parse(m.majLe)));
  });
  assert.ok(S.memoire.some(m => m.categorie === "a_suivre" && m.echeance && m.echeance <= today), "un « à suivre » échu");
  assert.ok(S.memoire.some(m => m.epingle), "un souvenir épinglé");
  assert.ok(new Set(S.memoire.map(m => m.categorie)).size >= 4, "plusieurs catégories");

  assert.deepEqual(Object.keys(S.savoir).sort(), ["fiches", "reperes"]);
  assert.equal(S.savoir.fiches.length, 4);
  S.savoir.fiches.forEach(f => {
    assert.deepEqual(Object.keys(f).sort(), FICHE_KEYS, `forme de la fiche ${f.slug} (sans contenu)`);
    assert.match(f.slug, /^[a-z0-9-]{3,80}$/);
    assert.ok(["epargne", "enveloppes", "fiscalite", "immobilier", "retraite", "protection", "marches", "comportement", "credit"].includes(f.theme), f.theme);
    assert.ok(f.sources.length >= 1 && f.sources.every(s => /^https:\/\//.test(s.url) && s.titre), "sources https");
    assert.ok(f.resume.length <= 400 && f.titre.length <= 120);
  });
  assert.deepEqual(J(S.savoir.reperes.map(r => r.cle)).sort(), ["hcsf_taux_effort", "livret_a_taux", "pea_plafond", "pfu_taux"]);
  S.savoir.reperes.forEach(r => {
    assert.deepEqual(Object.keys(r).sort(), REPERE_KEYS, `forme du repère ${r.cle}`);
    assert.equal(typeof r.valeur, "number");
    assert.ok(["%", "€", "ans"].includes(r.unite));
    assert.match(r.sourceTitre, /exemple/i, "valeur d'exemple signalée");
    assert.match(r.sourceUrl, /^https:\/\//);
  });
  // les fiches d'exemple ont un contenu markdown (100 à 200 mots)
  ctx.DEMO.savoir.fiches.forEach(f => {
    const mots = f.contenu.split(/\s+/).filter(Boolean).length;
    assert.ok(mots >= 100 && mots <= 220, `${f.slug} : ${mots} mots`);
  });
  for (const k of ["modifier", "supprimer", "toutEffacer"]) assert.equal(typeof ctx.Store.memoire[k], "function", "Store.memoire." + k);
  assert.equal(typeof ctx.Store.savoir.fiche, "function");
});

test("démo : Store.memoire (modifier, supprimer, toutEffacer) et Store.savoir.fiche en mémoire", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  const M = ctx.Store.memoire;
  const [a, b] = S.memoire;
  assert.deepEqual(J(await M.modifier(a.id, { contenu: "  Texte corrigé  ", epingle: true, categorie: "projet" })), { ok: true });
  let m = ctx.Store.get().memoire.find(x => x.id === a.id);
  assert.equal(m.contenu, "Texte corrigé"); assert.equal(m.epingle, true); assert.equal(m.categorie, a.categorie, "la catégorie n'est pas modifiable");
  const refus = await M.modifier(a.id, { contenu: "x".repeat(501) });
  assert.ok(refus.erreur && /500/.test(refus.erreur), "contenu trop long refusé");
  assert.ok((await M.modifier(a.id, { contenu: "   " })).erreur, "contenu vide refusé");
  assert.ok(/sensible/.test((await M.modifier(a.id, { contenu: "Mon mot de passe est chat" })).erreur || ""), "contenu sensible refusé");
  assert.ok(/sensible/.test((await M.modifier(a.id, { contenu: "IBAN FR76 3000 6000 0112 3456 7890 189" })).erreur || ""), "IBAN refusé");
  assert.deepEqual(J(await M.modifier(a.id, { contenu: "ETF IE00B4L5Y983 MSCI World" })), { ok: true }, "ISIN accepté");
  assert.deepEqual(J(await M.modifier(a.id, { contenu: "Texte corrigé" })), { ok: true });
  assert.ok((await M.modifier("inconnu", { epingle: true })).erreur, "souvenir inconnu");
  assert.equal(ctx.Store.get().memoire.find(x => x.id === a.id).contenu, "Texte corrigé", "un refus ne modifie rien");

  assert.deepEqual(J(await M.supprimer([b.id])), { ok: true });
  assert.equal(ctx.Store.get().memoire.length, 5);
  assert.ok(!ctx.Store.get().memoire.some(x => x.id === b.id));
  assert.deepEqual(J(await M.toutEffacer()), { ok: true });
  assert.deepEqual(J(ctx.Store.get().memoire), []);
  assert.equal(ctx.DEMO.memoire.length, 6, "window.DEMO n'est pas modifié (copie)");

  const slug = S.savoir.fiches[0].slug;
  const f = await ctx.Store.savoir.fiche(slug);
  assert.deepEqual(Object.keys(f).sort(), [...FICHE_KEYS, "contenu"].sort());
  assert.ok(f.contenu.length > 200);
  assert.equal(await ctx.Store.savoir.fiche("inconnue"), null);
  assert.equal("contenu" in ctx.Store.get().savoir.fiches[0], false, "S reste sans contenu");
});

test("store-supabase.js : mémoire de l'agent et savoir commun (lecture au démarrage, API)", () => {
  const sup = src("store-supabase.js"), demo = src("store-demo.js");
  for (const s of [sup, demo]) {
    assert.match(s, /S = \{[^\n]*memoire, savoir,/, "en-tête : S documente memoire et savoir");
    assert.match(s, /memoire: \[\], savoir: \{ fiches: \[\], reperes: \[\] \}/, "état initial");
    for (const k of ["memoire: clone(C.memoire)", "savoir: clone(C.savoir)", "memoire,", "savoir,", "Store.memoire", "Store.savoir"]) assert.ok(s.includes(k), k);
  }
  for (const k of ['from("memoire_agent").select("id, categorie, contenu, echeance, epingle, source, cree_le, maj_le")',
    'from("savoir_fiches").select("slug, theme, titre, resume, mots_cles, sources, version, mis_a_jour_le")',
    'from("reperes").select(', "Reperes.depuisLignes", "memView", "ficheView",
    'from("memoire_agent").update(', 'from("memoire_agent").delete().in("id", ', 'from("memoire_agent").delete().eq("user_id", uid)',
    'select("slug, theme, titre, resume, contenu, mots_cles, sources, version, mis_a_jour_le").eq("slug", slug).maybeSingle()']) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  // filtre sensible : module partagé web/src/sensible.js, plus de copie locale des motifs dans les stores
  for (const [nom, s] of [["store-supabase.js", sup], ["store-demo.js", demo]]) {
    assert.ok(s.includes("window.Sensible.estSensible(t)"), `${nom} : window.Sensible.estSensible`);
    assert.doesNotMatch(s, /const SENSIBLE = \[/, `${nom} : plus de copie locale des motifs`);
    assert.doesNotMatch(s, /\[A-Z\]\{2\}\[0-9\]\{2\}/, `${nom} : motif IBAN retiré`);
  }
  // modifier : la ligne mise à jour est renvoyée (.select("id")) ; aucune ligne → « Souvenir introuvable. »
  assert.ok(sup.includes('from("memoire_agent").update(row).eq("id", id).select("id")'), "update … select(id)");
  assert.match(sup, /if \(!Array\.isArray\(rows\) \|\| !rows\.length\) return \{ erreur: "Souvenir introuvable\." \};/);
  // echec : seule la contrainte contenu_sensible (23514 + nom de la contrainte) devient le message « information sensible »
  assert.match(sup, /x\.code === "23514" && \/contenu_sensible\/\.test\(String\(x\.message \|\| ""\)\) \? MSG_SENSIBLE : x\.message \|\| String\(e\)/);
  // les trois lectures rejoignent le Promise.allSettled de loadAll (une table absente ne casse rien)
  const load = sup.slice(sup.indexOf("async function loadAll()"), sup.indexOf("let reloadTimer"));
  for (const t of ["memoire_agent", "savoir_fiches", "reperes"]) assert.ok(load.includes(`from("${t}")`), `loadAll lit ${t}`);
  assert.ok(load.includes("if (memoire !== undefined)") && load.includes("if (fiches !== undefined)") && load.includes("if (reperes !== undefined)"));
  // la liste chargée au démarrage ne contient pas le contenu des fiches
  assert.doesNotMatch(load, /savoir_fiches"\)\.select\("[^"]*contenu/);
  assert.match(demo, /D\.memoire/); assert.match(demo, /D\.savoir/);
});

test("choix du mode : store-demo ne s'installe que si ?demo ou BOUSSOLE_MODE = demo", () => {
  assert.equal(browser({ search: "" }).Store, undefined);
  assert.equal(browser({ search: "?x=1&demo" }).Store?.mode, "demo");
  assert.equal(browser({ search: "?demo=1" }).Store?.mode, "demo");
  assert.equal(browser({ search: "?demolition" }).Store, undefined);
  assert.equal(browser({ search: "", mode: "demo" }).Store?.mode, "demo");
});

test("store-supabase.js et auth.js : parsent, sans alias hérités, au vocabulaire canonique", () => {
  const sup = src("store-supabase.js"), demo = src("store-demo.js"), auth = src("auth.js");
  assert.doesNotThrow(() => new Function(sup), "store-supabase.js ne parse pas");
  assert.doesNotThrow(() => new Function(auth), "auth.js ne parse pas");
  for (const s of [sup, demo]) {
    assert.doesNotMatch(s, /SCOPE_LEGACY|legacy\.|RETIRER EN TASK 5/, "plus de bloc d'alias");
    assert.doesNotMatch(s, /"couple"|"steph"|"compagne"|partSteph|partP1/, "plus d'ancien vocabulaire");
  }
  for (const k of ["foyer: num(r.total)", "part_p1: num(b.part_p1)", 'setScope(c)']) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  // le store Supabase expose le même contrat
  for (const k of ['mode: "supabase"', "get: () => S", "on(fn)", "setScope(s)", "emit,", "reload,", "db,", "window.Store = Store"]) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  for (const k of ["ter, zone, devise, annote_source, annote_le", "ins.annote_source", "prof.risque", "prof.classes", "protection: p.protection || {}",
    'const DIAG = ["risque", "classes", "protection"]', "updateProfil(patch, uid)", "risque: clone(C.risque)", "classes: clone(C.classes) || {}"]) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  assert.ok(demo.includes('const DIAG = ["risque", "classes", "protection"]'), "store-demo.js : mêmes colonnes du Diagnostic");
  for (const k of ['from("propositions")', 'order("cree_le", { ascending: false }).limit(200)', 'rpc("appliquer_propositions", { p_ids, p_modifications: mods })',
    'rpc("refuser_propositions", { p_ids })', "propositions: clone(C.propositions)", "propositions,"]) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  for (const k of ['from("connexions_assistant").select(CONN_SELECT).order("premier_le")', 'const CONN_SELECT = "client_id, client_nom, premier_le, dernier_le, appels"',
    "connexions: clone(C.connexions)", "const CONN_INTERVALLE = 5000", "setInterval(lireConnexions, CONN_INTERVALLE)", "clearInterval(connTimer)",
    "if (JSON.stringify(next) !== JSON.stringify(C.connexions)) { C.connexions = next; publish(); }", "surveillerConnexions,"]) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  // la surveillance ne relit que la table des connexions, et ne démarre qu'à la demande
  const lire = sup.slice(sup.indexOf("async function lireConnexions()"), sup.indexOf("function surveillerConnexions("));
  assert.deepEqual([...lire.matchAll(/from\("(\w+)"\)/g)].map(m => m[1]), ["connexions_assistant"], "lecture légère : une seule table");
  assert.doesNotMatch(lire, /loadAll|reload\(/, "pas de rechargement complet");
  assert.equal((sup.match(/setInterval\(/g) || []).length, 1, "un seul minuteur, celui de surveillerConnexions");
  assert.doesNotMatch(sup.slice(sup.indexOf("async function boot()")), /surveillerConnexions\(true\)|setInterval/, "aucune surveillance au démarrage");
  for (const k of ["price_override", "value_date", "qty_estimated", "request_instrument", "visibilitychange", 'from("transactions")', 'from("biens")', 'from("credits")', 'from("profiles")', 'from("config")', 'from("budgets")', 'from("objectifs")', "date_cible", "upsert(row)", "delete()"]) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  for (const k of ["signInWithPassword", "signUp", "signInWithOtp", 'provider: "google"', "onAuthStateChange", "requireSession", "index.html"]) assert.ok(auth.includes(k), `auth.js : ${k}`);
});
