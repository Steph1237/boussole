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
    config: ["object"], status: ["object"], profil: ["object"], profilLoaded: ["boolean"], budget: ["object", "null"], objectifs: ["array"], risque: ["object", "null"], classes: ["object"], propositions: ["array"], onboardingDone: ["boolean"], scope: ["string"],
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
  for (const k of ["price_override", "value_date", "qty_estimated", "request_instrument", "visibilitychange", 'from("transactions")', 'from("biens")', 'from("credits")', 'from("profiles")', 'from("config")', 'from("budgets")', 'from("objectifs")', "date_cible", "upsert(row)", "delete()"]) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  for (const k of ["signInWithPassword", "signUp", "signInWithOtp", 'provider: "google"', "onAuthStateChange", "requireSession", "index.html"]) assert.ok(auth.includes(k), `auth.js : ${k}`);
});
