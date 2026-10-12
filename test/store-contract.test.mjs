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
  vm.runInContext(src("routine-etat.js"), ctx, { filename: "routine-etat.js" }); // règle de la revue mensuelle (window.RoutineEtat), avant les stores comme dans build.mjs
  vm.runInContext(src("banque-etat.js"), ctx, { filename: "banque-etat.js" }); // banques connectées (window.BanqueEtat), avant les stores comme dans build.mjs
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
    config: ["object"], status: ["object"], profil: ["object"], profilLoaded: ["boolean"], budget: ["object", "null"], objectifs: ["array"], risque: ["object", "null"], classes: ["object"], propositions: ["array"], connexions: ["array"], memoire: ["array"], savoir: ["object"], expertises: ["array"], journal: ["array"], journalARelire: ["number"], journalConsentement: ["string"], routines: ["array"], routinesLues: ["boolean"], banque: ["object"], onboardingDone: ["boolean"], scope: ["string"],
    people: ["array"], user: ["object", "null"], error: ["null", "string"],
  };
  const kind = v => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
  assert.deepEqual(Object.keys(S).sort(), Object.keys(CONTRACT).sort(), "clés de S");
  for (const [k, types] of Object.entries(CONTRACT)) assert.ok(types.includes(kind(S[k])), `S.${k} est ${kind(S[k])}, attendu ${types.join("|")}`);
  assert.equal(S.ready, true); assert.equal(S.dbOk, true); assert.equal(S.profilLoaded, true); assert.equal(S.error, null);
  assert.equal(typeof ctx.Store.reload, "function");
  assert.equal(typeof ctx.Store.db.doc, "function"); assert.equal(ctx.Store.db.collection, undefined, "lecture seule : plus de collection()");
});

test("démo : foyer de deux personnes, formes canoniques", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  assert.deepEqual(J(S.people), [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }]);
  assert.equal(S.scope, "foyer");
  assert.equal(S.positions.length, 12);
  S.positions.forEach(p => assert.ok(["p1", "p2"].includes(p.owner), `owner canonique pour ${p.id} : ${p.owner}`));
  const POS_KEYS = ["id", "name", "envelope", "owner", "bloc", "mode", "isin", "qty", "pru", "price", "priceDate", "value", "valueDate", "status", "hypothesis", "qtyEstimated", "note",
    "ter", "zone", "devise", "annoteSource", "annoteLe", "sourceAuto", "sourceAutoLe", "symbol"];
  S.positions.forEach(p => assert.deepEqual(Object.keys(p).sort(), [...POS_KEYS].sort(), `forme de la position ${p.id}`));
  assert.ok(S.positions.some(p => p.status === "à recevoir"), "une ligne à recevoir");
  // snapshots / config / profil / status aux clés attendues par pilotage.js, reel.js, profil.js
  assert.equal(S.snapshots.length, 3);
  S.snapshots.forEach(s => assert.deepEqual(Object.keys(s).sort(), ["byBloc", "byEnvelope", "date", "foyer", "p1", "p2", "source"]));
  S.snapshots.forEach(s => near(s.p1 + s.p2, s.foyer, "photo : p1 + p2 = foyer"));
  assert.deepEqual(Object.keys(S.config).sort(), ["cushion", "frais_enveloppes", "hypotheses", "milestones", "recurring", "rules", "targets", "todo"]);
  assert.deepEqual(J(S.config.frais_enveloppes), {}, "frais des contrats : objet vide par défaut (comme config.frais_enveloppes, 0026)");
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
  // un foyer d'une seule personne : pas de p2, le périmètre (même mémorisé à p2) retombe sur le foyer
  const seul = browser({ prep: D => { D.profil.foyer.adultes = 1; } });
  seul.Store.setScope("p2");
  await whenReady(seul);
  assert.deepEqual(J(seul.Store.get().people), [{ id: "p1", nom: "Camille" }]);
  assert.equal(seul.Store.get().scope, "foyer");
});

test("démo : façade db réduite aux écritures de contrôle (règles, profil de risque), le reste est refusé", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  let n = 0; ctx.Store.on(() => n++);
  const db = ctx.Store.db;
  assert.deepEqual(Object.keys(db), ["doc"], "plus de collection() (transactions, positions, objectifs)");
  assert.deepEqual(Object.keys(db.doc("config/main")), ["update"], "plus de set() ni de delete()");

  // Règles : bascule actif / inactif (regles.js), seule clé acceptée sur config/main.
  const rules = J(S.config.rules).map((r, i) => (i === 0 ? { ...r, actif: false } : r));
  await db.doc("config/main").update({ rules });
  assert.equal(ctx.Store.get().config.rules[0].actif, false);
  assert.ok(ctx.Store.get().config.targets.p1, "les autres clés de config sont conservées");
  await assert.rejects(db.doc("config/main").update({ cushion: { mode: "months", months: 6 } }), e => e.code === "invalid_argument" && /Claude/.test(e.message));
  await assert.rejects(db.doc("config/main").update({ rules, todo: [] }), e => e.code === "invalid_argument", "une clé hors liste blanche refuse tout le patch");
  await assert.rejects(db.doc("config/main").update({ rules: "non" }), e => e.code === "invalid_argument");
  assert.equal(ctx.Store.get().config.rules.length, rules.length, "un refus ne modifie rien");

  // Profil de risque recalculé après application de propositions (propositions.js) : clé risque seule.
  const biens = J(S.profil.biens), personnes = J(S.profil.personnes);
  const risque = { reponses: { horizon: "8-15", reaction: "rien" }, profil: "equilibre", score: 55, date: "2026-10-10" };
  await db.doc("profil/main").update({ risque });
  assert.deepEqual(J(ctx.Store.get().risque), risque);
  assert.equal("risque" in ctx.Store.get().profil, false, "risque est exposé dans S.risque, pas dans le profil");
  assert.deepEqual(J(ctx.Store.get().profil.biens), biens, "biens intacts");
  assert.deepEqual(J(ctx.Store.get().profil.personnes), personnes, "personnes intactes");
  await db.doc("profil/main").update({ risque: null });
  assert.equal(ctx.Store.get().risque, null, "null efface le profil de risque");
  await assert.rejects(db.doc("profil/main").update({ risque: "dynamique" }), e => e.code === "invalid_argument");
  for (const patch of [{ classes: { Obligations: "fonds_euros" } }, { protection: { prevoyance: true } }, { personnes: {} }, { foyer: { adultes: 2 } }])
    await assert.rejects(db.doc("profil/main").update(patch), e => e.code === "invalid_argument", "profil : " + Object.keys(patch)[0] + " passe par Claude");

  // Saisie retirée : positions, budget, objectifs, transactions.
  for (const path of ["positions/livret-a", "budget/main", "objectifs/obj-apport", "transactions/x", "inconnue/x"])
    await assert.rejects(db.doc(path).update({ value: 1 }), e => e.code === "invalid_argument", path);
  assert.equal(ctx.Store.get().positions.find(p => p.id === "livret-a").value, S.positions.find(p => p.id === "livret-a").value, "placements inchangés");
  assert.equal(ctx.DEMO.positions.length, 12, "window.DEMO n'est pas modifié (copie)");
  assert.equal(ctx.DEMO.risque, null, "window.DEMO n'est pas modifié (copie)");

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

test("démo : propositions de réglages (0019) — matelas, versements programmés, classe d'une poche ; tout ou rien", async () => {
  const add = (id, cible, apres) => ({ id, lot: "l3", cible, operation: "modifier", ref: null, avant: null, apres, source: "test", justification: null,
    statut: "en_attente", creeLe: "2026-10-11T10:00:0" + id.slice(-1) + ".000Z", decideLe: null });
  const ctx = browser({ prep: D => D.propositions.push(
    add("r1", "config", { cushion: { mode: "months", months: 6, depenses: 2500 } }),
    add("r2", "config", { recurring: [
      { id: "rec-pea", label: "Versement PEA Camille", positionId: "pea-etf-monde", amount: 250, day: 10, lastApplied: "2020-01", hypothesis: null },
      { id: "rec-new", label: "Livret", positionId: "livret-a", amount: 50, day: 1 } ] }),
    add("r3", "profil", { classes: { Asie: "emergents" } }),
    add("r4", "config", { recurring: [{ id: "x", label: "X", positionId: "pea-etf-monde", amount: 10, day: 31 }] }),
    add("r5", "config", { rules: [] })) });
  const S0 = await whenReady(ctx);
  const P = ctx.Store.propositions;
  // tout ou rien : un versement invalide annule le matelas et la classe
  await assert.rejects(P.appliquer(["r1", "r3", "r4"]), e => e.code === "invalid_argument" && /Proposition non appliquée \(réglages, modifier\) : versement « X » : jour \(day\) invalide/.test(e.message));
  let S = ctx.Store.get();
  assert.deepEqual(J(S.config.cushion), J(S0.config.cushion)); assert.deepEqual(J(S.classes), {});
  await assert.rejects(P.appliquer(["r5"]), e => /réglage « rules » non modifiable/.test(e.message));
  // validation : matelas corrigé avant validation, versements, classe
  assert.deepEqual(J(await P.appliquer(["r1", "r2", "r3"], { r1: { cushion: { mode: "months", months: 4, depenses: 2500 } } })), { appliquees: 3 });
  S = ctx.Store.get();
  assert.deepEqual(J(S.config.cushion), { mode: "months", months: 4, depenses: 2500 });
  const prev = S0.config.recurring.find(r => r.id === "rec-pea");
  assert.deepEqual(J(S.config.recurring), [
    { id: "rec-pea", label: "Versement PEA Camille", positionId: "pea-etf-monde", amount: 250, day: 10, hypothesis: null, lastApplied: prev.lastApplied },
    { id: "rec-new", label: "Livret", positionId: "livret-a", amount: 50, day: 1 } ], "lastApplied repris de l'existant, jamais de la proposition");
  assert.deepEqual(J(S.classes), { Asie: "emergents" });
  assert.ok(["r1", "r2", "r3"].every(id => S.propositions.find(p => p.id === id).statut === "acceptee"));
});

const CONN_KEYS =["appels", "clientId", "clientNom", "dernierLe", "premierLe"];
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

/* ------------------------------------------------ expertises du Copilote (EX1) ------------------------------------------------ */

const EXP_KEYS = ["angles", "marches", "misAJourLe", "nom", "perimetre", "quandConsulter", "slug", "version"];
const EXP_DETAIL_KEYS = [...EXP_KEYS, "changelog", "controles", "format", "garde_fous", "methode", "reperes", "themesSavoir", "versions"].sort();
const SLUGS_EXP = ["actions", "allocation-risque", "budget-epargne", "crypto", "etf-fonds", "fiscalite-enveloppes", "immobilier-credit", "taux-obligations"];

test("démo : expertises au contrat (8 publiées, sans leur détail, triées par nom)", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  assert.deepEqual(J(S.expertises.map(e => e.slug)).sort(), SLUGS_EXP);
  S.expertises.forEach(e => {
    assert.deepEqual(Object.keys(e).sort(), EXP_KEYS, `forme de l'expertise ${e.slug} (sans détail)`);
    assert.ok(e.nom.length >= 3 && e.nom.length <= 80);
    assert.ok(e.quandConsulter.length >= 20 && e.quandConsulter.length <= 300);
    assert.ok(e.perimetre.length >= 20 && e.perimetre.length <= 600);
    assert.ok(Number.isInteger(e.version) && e.version >= 1);
    assert.match(e.misAJourLe, ISO);
    assert.ok(Array.isArray(e.marches) && Array.isArray(e.angles));
  });
  const noms = J(S.expertises.map(e => e.nom));
  assert.deepEqual(noms, [...noms].sort((a, b) => a.localeCompare(b, "fr")), "triées par nom");
  assert.equal(typeof ctx.Store.expertises.detail, "function");
});

test("démo : Store.expertises.detail(slug) → détail complet (allocation-risque, etf-fonds), court pour les autres, null si inconnu", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  for (const slug of ["allocation-risque", "etf-fonds"]) {
    const d = await ctx.Store.expertises.detail(slug);
    assert.deepEqual(Object.keys(d).sort(), EXP_DETAIL_KEYS, slug);
    assert.ok(d.methode.length > 1000 && d.garde_fous.length > 500 && d.format.length > 100, slug + " : méthode, garde-fous et forme complets");
    assert.ok(d.controles.length >= 3 && d.controles.every(c => typeof c === "string"));
    assert.deepEqual(J(d.versions), [{ version: 1, le: "2026-10-11", resume: d.changelog[0].resume }], slug + " : historique des versions");
    assert.equal(d.nom, S.expertises.find(e => e.slug === slug).nom);
  }
  const c = await ctx.Store.expertises.detail("crypto");
  assert.deepEqual(Object.keys(c).sort(), EXP_DETAIL_KEYS);
  assert.equal(c.methode, null); assert.equal(c.garde_fous, null); assert.equal(c.format, null);
  assert.ok(c.controles.length >= 3, "détail court : points de contrôle");
  assert.equal(await ctx.Store.expertises.detail("inconnue"), null);
  assert.ok(!("methode" in ctx.Store.get().expertises[0]), "S reste sans détail");
  (await ctx.Store.expertises.detail("etf-fonds")).controles.push("modifié");
  assert.ok(!(await ctx.Store.expertises.detail("etf-fonds")).controles.includes("modifié"), "copie : le détail de la démo n'est pas modifiable");
});

test("store-supabase.js : expertises publiées lues dans loadAll (sans détail), détail et historique lus à l'ouverture", () => {
  const sup = src("store-supabase.js"), demo = src("store-demo.js");
  for (const s of [sup, demo]) {
    assert.match(s, /S = \{[^\n]*savoir, expertises, journal,/, "en-tête : S documente expertises");
    assert.match(s, /Contrat : window\.Store = \{[^\n]*savoir, expertises, journal,/, "en-tête : Store.expertises");
    for (const k of ["expertises: clone(C.expertises)", "expertises,"]) assert.ok(s.includes(k), k);
  }
  const load = sup.slice(sup.indexOf("async function loadAll()"), sup.indexOf("let reloadTimer"));
  assert.ok(load.includes('from("expertises").select("slug, nom, quand_consulter, perimetre, version, mis_a_jour_le, marches, angles").eq("statut", "publie").order("nom")'), "liste des expertises publiées");
  assert.doesNotMatch(load, /from\("expertises"\)\.select\("[^"]*methode/, "la liste ne contient pas le détail");
  assert.ok(load.includes("if (expertises !== undefined)"), "table absente ou lecture en échec : valeur précédente");
  assert.ok(sup.includes('from("expertises").select("slug, nom, quand_consulter, perimetre, methode, controles, garde_fous, format, themes_savoir, reperes, angles, marches, version, changelog, mis_a_jour_le").eq("slug", slug).eq("statut", "publie").maybeSingle()'), "détail");
  assert.ok(sup.includes('from("expertises_versions").select("version, resume, mis_a_jour_le").eq("slug", slug).eq("statut", "publie").order("version", { ascending: false })'), "historique des versions");
  assert.match(demo, /D\.expertises/);
});

/* store-supabase.js exécuté avec un faux client Supabase (sans session : seul Store.expertises.detail est appelé). reponses : table →
   { data, error } ou fonction(filtres) → { data, error } ; une réponse absente vaut { data: null, error: null }. */
function storeSupabase(reponses) {
  const appels = [];
  const requete = table => {
    const f = { table, eq: [], select: null, order: null, unique: false };
    const b = {
      select: c => { f.select = c; return b; },
      eq: (k, v) => { f.eq.push([k, v]); return b; },
      order: (k, o) => { f.order = [k, o]; (f.ordres = f.ordres || []).push(k); return b; },
      in: (k, v) => { f.in = [k, v]; return b; },
      gte: (k, v) => { f.gte = [k, v]; return b; },
      range: (de, a) => { f.range = [de, a]; return b; },
      maybeSingle: () => { f.unique = true; return b; },
      then: (ok, ko) => { appels.push(f); const r = reponses[table]; return Promise.resolve(typeof r === "function" ? r(f) : r || { data: null, error: null }).then(ok, ko); },
    };
    return b;
  };
  const avertissements = [];
  const ctx = {
    console: { log() {}, error() {}, warn: (...a) => avertissements.push(a.join(" ")) }, setTimeout, clearTimeout,
    location: { href: "https://x/app.html", search: "", hash: "", pathname: "/app.html" },
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    BOUSSOLE: { supabaseUrl: "https://x.supabase.co", supabaseKey: "k" },
    supabase: { createClient: () => ({ from: requete, auth: { getSession: async () => ({ data: { session: null } }) } }) },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src("sensible.js"), ctx, { filename: "sensible.js" });
  vm.runInContext(src("routine-etat.js"), ctx, { filename: "routine-etat.js" });
  vm.runInContext(src("store-supabase.js"), ctx, { filename: "store-supabase.js" });
  return { ctx, appels, avertissements };
}
const LIGNE_EXP = { slug: "etf-fonds", nom: "ETF et fonds", quand_consulter: "Q", perimetre: "P", methode: "## M", controles: ["Un", 3, null, { x: 1 }, "Deux"],
  garde_fous: "G", format: "F", themes_savoir: ["marches"], reperes: ["pfu_taux"], angles: ["frais"], marches: ["fr"], version: 2,
  changelog: [{ version: 1, le: "2026-10-01", resume: "v1" }, "pas un objet", null, { version: 2, le: "2026-10-11", resume: "v2" }], mis_a_jour_le: "2026-10-11" };

test("store-supabase.js (exécuté, faux client) : expertises.detail — historique vide → journal des versions ; contrôles non textuels filtrés", async () => {
  const { ctx, appels } = storeSupabase({ expertises: { data: LIGNE_EXP, error: null }, expertises_versions: { data: [], error: null } });
  await wait(0);
  const d = J(await ctx.Store.expertises.detail("etf-fonds"));
  assert.deepEqual(d.controles, ["Un", "Deux"], "contrôles non textuels filtrés");
  assert.deepEqual(d.changelog, [{ version: 1, le: "2026-10-01", resume: "v1" }, { version: 2, le: "2026-10-11", resume: "v2" }], "entrées non objets du journal ignorées");
  assert.deepEqual(d.versions.map(v => v.version), [2, 1], "historique vide → journal des versions, le plus récent d'abord");
  assert.equal(d.methode, "## M");
  assert.deepEqual(d.themesSavoir, ["marches"]);
  assert.equal(d.nom, "ETF et fonds");
  const [e, h] = [appels.find(a => a.table === "expertises"), appels.find(a => a.table === "expertises_versions")];
  assert.deepEqual(J(e.eq), [["slug", "etf-fonds"], ["statut", "publie"]]);
  assert.equal(e.unique, true);
  assert.deepEqual(J(h.order), ["version", { ascending: false }]);
  // historique publié présent : il prime
  const b = storeSupabase({ expertises: { data: LIGNE_EXP, error: null },
    expertises_versions: { data: [{ version: 2, resume: "copie v2", mis_a_jour_le: "2026-10-11" }], error: null } });
  await wait(0);
  assert.deepEqual(J((await b.ctx.Store.expertises.detail("etf-fonds")).versions), [{ version: 2, le: "2026-10-11", resume: "copie v2" }]);
  // historique en échec : journal des versions aussi
  const c = storeSupabase({ expertises: { data: LIGNE_EXP, error: null }, expertises_versions: { data: null, error: { code: "42P01", message: "relation absente" } } });
  await wait(0);
  assert.deepEqual(J((await c.ctx.Store.expertises.detail("etf-fonds")).versions).map(v => v.version), [2, 1]);
});

test("store-supabase.js (exécuté, faux client) : expertises.detail — échec de lecture ou expertise absente → null", async () => {
  const a = storeSupabase({ expertises: { data: null, error: { code: "500", message: "panne" } }, expertises_versions: { data: [], error: null } });
  await wait(0);
  assert.equal(await a.ctx.Store.expertises.detail("etf-fonds"), null, "échec → null");
  assert.ok(a.avertissements.some(m => /expertise impossible/.test(m)), "échec signalé en console");
  const b = storeSupabase({ expertises: { data: null, error: null }, expertises_versions: { data: [], error: null } });
  await wait(0);
  assert.equal(await b.ctx.Store.expertises.detail("inconnue"), null, "absente ou non publiée → null");
  const c = storeSupabase({ expertises: () => { throw new Error("réseau"); } });
  await wait(0);
  assert.equal(await c.ctx.Store.expertises.detail("etf-fonds"), null, "exception du client → null");
});

/* ------------------------------------------------ journal des décisions (CK2) ------------------------------------------------ */

const JOURNAL_KEYS = ["creeLe", "dateDecision", "etat", "historique", "id", "liens", "majLe", "options", "raisonnement", "revueLe", "source", "statut", "synthese", "titre", "type"];
const J_TYPES = ["avis", "decision", "scenario", "revue", "hypothese", "evenement"];
const J_STATUTS = ["a_relire", "actif", "realise", "abandonne", "archive"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

test("démo : journal au contrat (5 entrées cohérentes avec le foyer, plus récentes d'abord) et consentement « demander »", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  const today = new Date().toISOString().slice(0, 10);
  const Sensible = ctx.Sensible;
  assert.equal(S.journalConsentement, "demander");
  assert.equal(S.journal.length, 5);
  assert.equal(S.journalARelire, 1, "compte des entrées à relire (même champ que store-supabase.js)");
  S.journal.forEach(e => {
    assert.deepEqual(Object.keys(e).sort(), JOURNAL_KEYS, `forme de l'entrée ${e.id}`);
    assert.ok(J_TYPES.includes(e.type), e.type);
    assert.ok(J_STATUTS.includes(e.statut), e.statut);
    assert.ok(e.titre.trim().length >= 3 && e.titre.trim().length <= 120, `titre de ${e.id}`);
    assert.ok(e.synthese.trim().length >= 1 && e.synthese.trim().length <= 600, `synthèse de ${e.id}`);
    assert.ok(e.raisonnement === null || (typeof e.raisonnement === "string" && e.raisonnement.length <= 8000));
    for (const t of [e.titre, e.synthese, e.raisonnement]) assert.equal(Sensible.estSensible(t), false, `contenu sensible dans ${e.id}`);
    assert.ok(Array.isArray(e.options) && e.options.length <= 6);
    e.options.forEach(o => { assert.equal(typeof o.titre, "string"); assert.equal(typeof o.retenue, "boolean"); });
    assert.ok(e.liens && typeof e.liens === "object" && !Array.isArray(e.liens));
    assert.ok(e.etat && ISO.test(e.etat.date) && typeof e.etat.patrimoine_net === "number", `état figé de ${e.id}`);
    assert.ok(Array.isArray(e.historique));
    assert.ok(e.dateDecision === null || ISO.test(e.dateDecision));
    assert.ok(e.revueLe === null || ISO.test(e.revueLe));
    assert.ok(e.source && e.source.length <= 100);
    assert.ok(!isNaN(Date.parse(e.creeLe)) && !isNaN(Date.parse(e.majLe)));
  });
  const ordre = J(S.journal.map(e => e.creeLe));
  assert.deepEqual(ordre, [...ordre].sort().reverse(), "plus récentes d'abord");
  assert.deepEqual(J(S.journal.map(e => e.type)).sort(), ["avis", "decision", "evenement", "hypothese", "scenario"]);
  const dec = S.journal.find(e => e.type === "decision");
  assert.equal(dec.statut, "actif");
  assert.ok(dec.revueLe && dec.revueLe <= today, "revue due");
  assert.ok(dec.dateDecision && dec.dateDecision < today);
  assert.ok(dec.historique.length >= 1, "historique non vide");
  dec.historique.forEach(h => { assert.ok(!isNaN(Date.parse(h.le)) && h.champ); assert.ok(("avant" in h && "apres" in h) || (h.champ === "raisonnement" && typeof h.ajout === "string")); });
  const ajout = dec.historique.find(h => h.ajout);
  if (ajout) assert.ok(dec.raisonnement.endsWith(ajout.ajout), "la note ajoutée termine le raisonnement");
  const avis = S.journal.find(e => e.type === "avis");
  assert.equal(avis.statut, "a_relire");
  assert.deepEqual(J(avis.historique), [], "rien d'historisé tant que l'entrée est à relire");
  const sc = S.journal.find(e => e.type === "scenario");
  assert.equal(sc.options.length, 2);
  assert.equal(sc.options.filter(o => o.retenue).length, 1, "une option retenue");
  assert.match(sc.titre, /acheter|louer/i);
  assert.equal(S.journal.filter(e => e.statut === "a_relire").length, 1, "un seul avis à relire");
  // liens vers des objets qui existent dans la démo
  const ids = { objectifs: S.objectifs.map(o => o.id), positions: S.positions.map(p => p.id), biens: S.profil.biens.map(b => b.id), credits: S.profil.credits.map(c => c.id) };
  S.journal.forEach(e => Object.entries(e.liens).filter(([k]) => k !== "expertises").forEach(([k, v]) => v.forEach(id => assert.ok(ids[k] && ids[k].includes(id), `${e.id} : lien ${k}/${id}`))));
  // expertises consultées (EX1, liens.expertises = [{ slug, version }]) : des expertises de la démo, à leur version
  const exps = S.journal.filter(e => e.liens.expertises);
  assert.ok(exps.length >= 1, "au moins une entrée trace les expertises consultées");
  exps.forEach(e => e.liens.expertises.forEach(x => {
    const ex = S.expertises.find(y => y.slug === x.slug);
    assert.ok(ex, `${e.id} : expertise ${x.slug}`);
    assert.equal(x.version, ex.version, `${e.id} : version de ${x.slug}`);
  }));
  for (const k of ["confirmer", "modifier", "supprimer", "consentement"]) assert.equal(typeof ctx.Store.journal[k], "function", "Store.journal." + k);
});

test("démo : Store.journal (confirmer, modifier avec validation et historique, supprimer, consentement) en mémoire", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  const Jn = ctx.Store.journal;
  const avis = S.journal.find(e => e.statut === "a_relire"), dec = S.journal.find(e => e.type === "decision");
  const get = id => ctx.Store.get().journal.find(e => e.id === id);

  // modifier une entrée encore à relire : pas d'historique
  assert.deepEqual(J(await Jn.modifier(avis.id, { titre: "  Titre corrigé  " })), { ok: true });
  assert.equal(get(avis.id).titre, "Titre corrigé");
  assert.deepEqual(J(get(avis.id).historique), []);
  // confirmer : a_relire → actif, sans historique ; une entrée déjà confirmée ne change pas
  assert.deepEqual(J(await Jn.confirmer([avis.id, dec.id, "inconnue"])), { ok: true });
  assert.equal(get(avis.id).statut, "actif");
  assert.deepEqual(J(get(avis.id).historique), [], "première confirmation non historisée");
  assert.equal(get(dec.id).statut, "actif");

  // modifier une entrée confirmée : historisé { le, champ, avant, apres }
  const n0 = get(dec.id).historique.length;
  assert.deepEqual(J(await Jn.modifier(dec.id, { synthese: "Synthèse corrigée.", statut: "realise", revueLe: "2027-01-15", raisonnement: "ignoré", type: "avis" })), { ok: true });
  const d = get(dec.id);
  assert.equal(d.synthese, "Synthèse corrigée."); assert.equal(d.statut, "realise"); assert.equal(d.revueLe, "2027-01-15");
  assert.equal(d.type, "decision", "le type n'est pas modifiable"); assert.equal(d.raisonnement, dec.raisonnement, "le raisonnement n'est pas modifiable ici");
  const nv = d.historique.slice(n0);
  assert.deepEqual(J(nv.map(h => h.champ)).sort(), ["revue_le", "statut", "synthese"]);
  const hs = nv.find(h => h.champ === "statut");
  assert.equal(hs.avant, "actif"); assert.equal(hs.apres, "realise");
  assert.equal(nv.find(h => h.champ === "revue_le").avant, dec.revueLe);
  assert.ok(nv.every(h => !isNaN(Date.parse(h.le))));
  assert.notEqual(d.majLe, dec.majLe, "maj_le tenu à jour");
  assert.deepEqual(J(d.etat), J(dec.etat), "l'état figé ne change pas");
  // noms de colonnes acceptés aussi (revue_le, date_decision) ; null efface une date
  assert.deepEqual(J(await Jn.modifier(dec.id, { revue_le: null, date_decision: "2026-07-01" })), { ok: true });
  assert.equal(get(dec.id).revueLe, null); assert.equal(get(dec.id).dateDecision, "2026-07-01");

  // refus en français, rien n'est modifié
  const refus = async (patch, re) => { const r = await Jn.modifier(dec.id, patch); assert.ok(r.erreur && re.test(r.erreur), JSON.stringify(patch) + " → " + JSON.stringify(r)); };
  await refus({ titre: "ab" }, /3 à 120/);
  await refus({ titre: "x".repeat(121) }, /3 à 120/);
  await refus({ synthese: "  " }, /1 à 600/);
  await refus({ synthese: "x".repeat(601) }, /1 à 600/);
  await refus({ statut: "a_relire" }, /statut/i);
  await refus({ statut: "termine" }, /statut/i);
  await refus({ revueLe: "15/01/2027" }, /AAAA-MM-JJ/);
  await refus({ dateDecision: "2026-13-45" }, /AAAA-MM-JJ/);
  await refus({ synthese: "IBAN FR76 3000 6000 0112 3456 7890 189" }, /sensible/);
  await refus({ titre: "Mon mot de passe" }, /sensible/);
  assert.equal(get(dec.id).synthese, "Synthèse corrigée.", "un refus ne modifie rien");
  assert.ok((await Jn.modifier("inconnue", { titre: "Titre valable" })).erreur, "entrée inconnue");
  assert.deepEqual(J(await Jn.modifier(dec.id, {})), { ok: true }, "patch vide");

  // ordre de l'historique = ordre des champs du déclencheur (… statut, date_decision, revue_le) ; plafond 20 premières + 180 dernières
  const n1 = get(dec.id).historique.length;
  assert.deepEqual(J(await Jn.modifier(dec.id, { revueLe: "2027-03-01", dateDecision: "2026-07-02", statut: "archive", titre: "Titre réordonné" })), { ok: true });
  assert.deepEqual(J(get(dec.id).historique.slice(n1).map(h => h.champ)), ["titre", "statut", "date_decision", "revue_le"], "même ordre que journal_historique");
  const premieres = J(get(dec.id).historique), m = premieres.length;
  assert.ok(m > 0 && m < 20, "historique initial court (" + m + ")");
  for (let k = 0; k < 220; k++) await Jn.modifier(dec.id, { titre: "Titre n° " + k });
  const h = J(get(dec.id).historique);
  assert.equal(h.length, 200, "plafond 200");
  assert.deepEqual(h.slice(0, m), premieres, "les premières corrections restent");
  assert.equal(h[19].apres, "Titre n° " + (19 - m), "les 20 premières entrées sont gardées");
  assert.equal(h[20].apres, "Titre n° 40", "puis les 180 dernières");
  assert.equal(h[199].apres, "Titre n° 219", "la plus récente est gardée");

  // supprimer
  assert.deepEqual(J(await Jn.supprimer([avis.id])), { ok: true });
  assert.equal(ctx.Store.get().journal.length, 4);
  assert.ok(!get(avis.id));
  // consentement
  assert.deepEqual(J(await Jn.consentement("jamais")), { ok: true });
  assert.equal(ctx.Store.get().journalConsentement, "jamais");
  assert.ok((await Jn.consentement("toujours")).erreur, "mode inconnu refusé");
  assert.equal(ctx.Store.get().journalConsentement, "jamais");
  assert.equal(ctx.DEMO.journal.length, 5, "window.DEMO n'est pas modifié (copie)");
  assert.equal(ctx.DEMO.journal.find(e => e.id === avis.id).statut, "a_relire");
});

test("store-supabase.js : journal (lecture des 500 plus récentes, table absente sans casse, écritures et consentement)", () => {
  const sup = src("store-supabase.js"), demo = src("store-demo.js");
  for (const s of [sup, demo]) {
    assert.match(s, /S = \{[^\n]*journal, journalARelire, journalConsentement,/, "en-tête : S documente journal, journalARelire et journalConsentement");
    for (const k of ["journal: clone(C.journal)", "journalConsentement: C.journalConsentement", "journal,", "Store.journal"]) assert.ok(s.includes(k), k);
  }
  const load = sup.slice(sup.indexOf("async function loadAll()"), sup.indexOf("let reloadTimer"));
  assert.ok(load.includes('from("journal").select("id, type, titre, synthese, raisonnement, options, statut, date_decision, revue_le, liens, etat, source, historique, cree_le, maj_le").order("cree_le", { ascending: false }).limit(500)'), "lecture du journal");
  assert.ok(load.includes("if (journal !== undefined) C.journal = (journal || []).map(journalView)"), "table absente : valeur précédente");
  assert.match(load, /prof\.journal_consentement/);
  // Pastille « à relire » : comptage exact (head: true), repli sur les entrées lues si la requête échoue
  assert.ok(load.includes('qCompte(sb.from("journal").select("id", { count: "exact", head: true }).eq("statut", "a_relire"))'), "count exact des entrées à relire");
  assert.ok(load.includes('C.journalARelire = nARelire !== undefined ? nARelire : C.journal.filter(e => e && e.statut === "a_relire").length'), "repli sur les entrées lues");
  assert.match(sup, /const qCompte = async pr => \{ const \{ count, error \} = await pr;/);
  assert.ok(sup.includes("journalARelire: C.journalARelire"));
  for (const k of ['from("journal").update({ statut: "actif" }).in("id", liste).eq("statut", "a_relire")', 'from("journal").update(row).eq("id", id).select("id")',
    'from("journal").delete().in("id", liste)', "journal_consentement: mode", "journal_contenu_sensible", 'if (!Array.isArray(rows) || !rows.length) return { erreur: "Entrée du journal introuvable." };'])
    assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  // consentement : même écriture que les colonnes du Diagnostic (upsert sur user_id)
  assert.match(sup, /from\("profiles"\)\.upsert\(\{ user_id: uid, journal_consentement: mode \}, \{ onConflict: "user_id" \}\)/);
  assert.match(demo, /D\.journal/);
});

/* ------------------------------------------------ routines de l'agent (RT1) ------------------------------------------------ */

const ROUTINE_KEYS = ["active", "consentementJournal", "dernierClient", "dernierPassage", "jour", "prochainPassage", "questions", "synthese", "type"];

test("démo : routines au contrat (revue mensuelle active, passée le 1er du mois, prochaine le 1er du mois suivant, 2 questions, synthèse de 3 lignes)", async () => {
  const ctx = browser();
  const S0 = ctx.Store.get();
  assert.equal(S0.routinesLues, false, "pas encore lue avant le tick");
  const S = await whenReady(ctx);
  assert.equal(S.routinesLues, true);
  assert.equal(S.routines.length, 1);
  const r = S.routines[0];
  assert.deepEqual(Object.keys(r).sort(), ROUTINE_KEYS);
  assert.equal(r.type, "revue_mensuelle"); assert.equal(r.jour, 1); assert.equal(r.active, true); assert.equal(r.consentementJournal, true);
  assert.equal(r.dernierClient, "Claude");
  const d = new Date(), p = n => String(n).padStart(2, "0");
  const debut = k => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1)); return x.getUTCFullYear() + "-" + p(x.getUTCMonth() + 1) + "-01"; };
  assert.equal(r.dernierPassage.slice(0, 10), debut(0), "dernier passage le 1er du mois courant");
  assert.ok(!isNaN(Date.parse(r.dernierPassage)));
  assert.equal(r.prochainPassage, debut(1), "prochain passage le 1er du mois suivant");
  assert.equal(r.questions.length, 2);
  r.questions.forEach(q => {
    assert.deepEqual(Object.keys(q).sort(), ["champ", "pourquoi", "question"]);
    assert.ok(q.question.length >= 1 && q.question.length <= 300);
    assert.ok(q.pourquoi === null || q.pourquoi.length <= 300);
    assert.ok(q.champ === null || q.champ.length <= 60);
    for (const t of [q.question, q.pourquoi]) { assert.equal(ctx.Sensible.estSensible(t || ""), false); assert.doesNotMatch(t || "", /\b(vous|votre|vos)\b/i); }
  });
  assert.equal(r.synthese.split("\n").length, 3, "synthèse de 3 lignes");
  assert.ok(r.synthese.length <= 4000);
  assert.equal(ctx.Sensible.estSensible(r.synthese), false);
  assert.equal(typeof ctx.Store.routines.pause, "function");
  // Aujourd'hui (fonction pure, même module que la vue) : la démo affiche « Ta revue du mois est prête »
  const A = require("../web/src/aujourdhui.js");
  const b = A.boite(J(S), new Date().toISOString().slice(0, 10), { Rules: null });
  assert.ok(b.some(x => x.type === "routine" && x.titre === "Ta revue du mois est prête : 2 questions"), b.map(x => x.titre).join(" | "));
});

test("démo : Store.routines.pause en mémoire (pause, réactivation qui recalcule le prochain passage, refus en français)", async () => {
  const ctx = browser({ prep: D => { D.routines[0].prochainPassage = "2020-01-01"; } });
  await whenReady(ctx);
  const R = ctx.Store.routines, get = () => ctx.Store.get().routines[0];
  assert.deepEqual(J(await R.pause("revue_mensuelle", true)), { ok: true });
  assert.equal(get().active, false);
  assert.equal(get().prochainPassage, "2020-01-01", "la pause ne touche pas au prochain passage");
  assert.deepEqual(J(await R.pause("revue_mensuelle", true)), { ok: true }, "déjà en pause : rien ne change");
  assert.deepEqual(J(await R.pause("revue_mensuelle", false)), { ok: true });
  const r = get();
  assert.equal(r.active, true);
  // routines_maj : pause → active recalcule routine_date(jour, auj, 7) : un 1er du mois, entre 7 jours et 7 jours + un mois
  assert.match(r.prochainPassage, /^\d{4}-\d{2}-01$/);
  const ecart = (Date.parse(r.prochainPassage) - Date.parse(new Date().toISOString().slice(0, 10))) / 864e5;
  assert.ok(ecart >= 6 && ecart <= 7 + 31, "prochain passage dans 7 jours au moins : " + r.prochainPassage);
  for (const [args, re] of [[["veille", true], /inconnue/], [["revue_mensuelle", "oui"], /Pause invalide/], [["revue_mensuelle"], /Pause invalide/]]) {
    const x = await R.pause(...args);
    assert.ok(x.erreur && re.test(x.erreur), JSON.stringify(args) + " → " + JSON.stringify(x));
    assert.doesNotMatch(x.erreur, /\b(vous|votre|vos)\b/i);
  }
  const vide = browser({ prep: D => { D.routines = []; } });
  const S = await whenReady(vide);
  assert.deepEqual(J(S.routines), []);
  assert.match((await vide.Store.routines.pause("revue_mensuelle", true)).erreur, /introuvable/);
  assert.equal(ctx.DEMO.routines[0].active, true, "window.DEMO n'est pas modifié (copie)");
});

test("store-supabase.js : routines (lecture dans loadAll, table absente sans casse, routinesLues, seule écriture : la bascule active)", () => {
  const sup = src("store-supabase.js"), demo = src("store-demo.js");
  for (const s of [sup, demo]) {
    assert.match(s, /S = \{[^\n]*journalConsentement, routines, routinesLues,/, "en-tête : S documente routines et routinesLues");
    assert.match(s, /Contrat : window\.Store = \{[^\n]*journal, routines, surveillerConnexions/, "en-tête : Store.routines");
    for (const k of ["routines: clone(C.routines)", "routinesLues: C.routinesLues", "routines,", "Store.routines.pause(type, enPause)", 'const ROUTINE_TYPES = ["revue_mensuelle"]'])
      assert.ok(s.includes(k), k);
  }
  const load = sup.slice(sup.indexOf("async function loadAll()"), sup.indexOf("let reloadTimer"));
  assert.ok(load.includes('q(sb.from("routines").select(ROUTINE_SELECT).order("type"))'), "lecture des routines dans le même Promise.allSettled");
  assert.ok(sup.includes('const ROUTINE_SELECT = "type, jour, active, consentement_journal, dernier_passage, dernier_client, prochain_passage, questions, synthese"'));
  assert.ok(load.includes("if (routines !== undefined) { C.routines = (routines || []).map(routineView); C.routinesLues = true; }"), "table absente : valeur précédente");
  assert.match(sup, /routines: \[\], routinesLues: false/, "état initial");
  for (const k of ["consentementJournal: !!r.consentement_journal", "dernierPassage: r.dernier_passage ?? null", "dernierClient: r.dernier_client ?? null",
    "prochainPassage: r.prochain_passage ?? null", "synthese: r.synthese ?? null"]) assert.ok(sup.includes(k), "routineView : " + k);
  // seule écriture : update active = !enPause where type = …, ligne renvoyée (aucune ligne → introuvable)
  assert.ok(sup.includes('from("routines").update({ active: !enPause }).eq("type", type).select("type")'));
  assert.deepEqual([...sup.matchAll(/from\("routines"\)\.(\w+)\(/g)].map(m => m[1]).sort(), ["select", "update"]);
  assert.match(demo, /D\.routines/);
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
    "risque: clone(C.risque)", "classes: clone(C.classes) || {}"]) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
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
  for (const k of ["price_override", "value_date", "qty_estimated", "visibilitychange", 'from("transactions")', 'from("biens")', 'from("credits")', 'from("profiles")', 'from("config")', 'from("budgets")', 'from("objectifs")', "date_cible"]) assert.ok(sup.includes(k), `store-supabase.js : ${k}`);
  for (const k of ["signInWithPassword", "signUp", "signInWithOtp", 'provider: "google"', "onAuthStateChange", "requireSession", "index.html"]) assert.ok(auth.includes(k), `auth.js : ${k}`);
});

test("lecture seule : les deux stores n'écrivent plus que les données de contrôle (propositions, journal, mémoire, routines, règles, risque, compte)", () => {
  const sup = src("store-supabase.js"), demo = src("store-demo.js");
  for (const [nom, s] of [["store-supabase.js", sup], ["store-demo.js", demo]]) {
    assert.match(s, /Contrat : window\.Store = \{[^\n]*markOnboarded\(\), banque \}/, nom + " : en-tête du contrat à jour");
    assert.match(s, /db = \{ doc\("config\/main"\)\.update\(\{ rules \}\), doc\("profil\/main"\)\.update\(\{ risque \}\) \}/, nom + " : façade db documentée");
    assert.ok(s.includes('const LECTURE_SEULE = "Écriture non disponible dans l\'app : complète ou corrige avec Claude, puis valide sa proposition."'), nom + " : refus au tutoiement, même texte");
    assert.match(s, /seulement\(p(atch)?, \["rules"\]\)/, nom + " : config/main n'accepte que rules");
    assert.match(s, /seulement\(patch, \["risque"\]\)/, nom + " : profil/main n'accepte que risque");
    for (const retire of ["addMany(", "upsert(row)", "addTx", "setProfil", "setBudget", "upsertObjectif", "deleteObjectif", "setPosition", "updatePosition", "addPositions", "collection(name)"])
      assert.ok(!s.includes(retire), nom + " : écriture retirée encore présente : " + retire);
  }
  // Côté Supabase : plus aucune écriture sur les tables de saisie (positions, transactions, biens, crédits, budgets, objectifs).
  const ecritures = [...sup.matchAll(/from\("(\w+)"\)\.(insert|update|upsert|delete)\(/g)].map(m => m[1] + "." + m[2]);
  assert.deepEqual([...new Set(ecritures)].sort(), ["banque_comptes.update", "config.upsert", "journal.delete", "journal.update", "memoire_agent.delete", "memoire_agent.update", "profiles.update", "profiles.upsert", "routines.update"].sort());
  // banque_comptes : seules les 5 colonnes de rattachement (BanqueEtat.normRattachement, ignore compris), seule écriture permise par 0021.
  assert.ok(sup.includes('from("banque_comptes").update(row).eq("id", cpt.id).select("id")'));
  assert.match(src("banque-etat.js"), /const vide = \{ position_id: null, enveloppe: null, titulaire: null, credit_id: null, ignore: false \};/);
  assert.doesNotMatch(sup, /rpc\("request_instrument"/, "plus de demande d'instrument (ajout de placement)");
  assert.deepEqual([...sup.matchAll(/rpc\("(\w+)"/g)].map(m => m[1]).sort(), ["appliquer_propositions", "refuser_propositions"]);
});

/* ------------------------------------------------ cours historiques (CP1 § 4) ------------------------------------------------ */

test("démo : Store.cours(isins, depuis) → séries déterministes qui finissent au cours du jour, jours ouvrés, depuis la date demandée", async () => {
  const ctx = browser();
  const S = await whenReady(ctx);
  assert.equal(typeof ctx.Store.cours, "function");
  const cotees = S.positions.filter(p => p.mode === "market" && p.isin && p.price != null);
  const isins = cotees.map(p => p.isin);
  const depuis = new Date(Date.now() - 5 * 365.25 * 864e5).toISOString().slice(0, 10);
  const r = J(await ctx.Store.cours(isins.concat(["INCONNU", null]), depuis));
  assert.deepEqual(Object.keys(r).sort(), [...isins].sort(), "un ISIN inconnu ou vide est absent");
  for (const p of cotees) {
    const h = r[p.isin];
    assert.ok(h.length > 1200 && h.length <= 1305, p.isin + " : environ 5 ans de jours ouvrés (" + h.length + ")");
    assert.ok(h.every((c, i) => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.cloture > 0 && (!i || h[i - 1].date < c.date)), p.isin + " : triées, clôtures positives");
    assert.ok(h.every(c => c.date >= depuis && c.date < p.priceDate), p.isin + " : depuis la date demandée, avant le cours du jour");
    assert.ok(h.every(c => ![0, 6].includes(new Date(c.date + "T12:00:00Z").getUTCDay())), p.isin + " : jours ouvrés");
    const fin = h[h.length - 1].cloture;
    assert.ok(Math.abs(fin / p.price - 1) < 0.2, p.isin + " : la série rejoint le cours du jour (" + fin + " / " + p.price + ")");
  }
  const encore = J(await ctx.Store.cours([isins[0]], depuis));
  assert.deepEqual(encore[isins[0]], r[isins[0]], "déterministe");
  const autre = browser(); await whenReady(autre);
  assert.deepEqual(J(await autre.Store.cours([isins[0]], depuis))[isins[0]], r[isins[0]], "même série à chaque chargement");
  const mois = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10);
  const court = J(await ctx.Store.cours([isins[0]], mois))[isins[0]];
  assert.ok(court.length >= 19 && court.length <= 23 && court[0].date >= mois, "depuis 1 mois : une vingtaine de jours");
  assert.deepEqual(J(await ctx.Store.cours([], depuis)), {});
  assert.deepEqual(J(await ctx.Store.cours(undefined, depuis)), {});
  assert.match(src("store-demo.js"), /Contrat : window\.Store = \{[^\n]*cours\(isins, depuis\)/, "en-tête du contrat");
});

test("store-supabase.js (exécuté, faux client) : Store.cours — une requête par ISIN (6 en parallèle au plus), depuis, pages de 1 000 des plus récentes, plafond signalé, échec rejeté ; table absente → {}", async () => {
  const lignes = [];
  for (let i = 0; i < 1500; i++) lignes.push({ isin: "FR0000120073", date: new Date(Date.UTC(2022, 0, 3) + i * 864e5).toISOString().slice(0, 10), cloture: String(100 + i / 10) });
  lignes.push({ isin: "IE00B4L5Y983", date: "2026-10-09", cloture: 104.2 }, { isin: "IE00B4L5Y983", date: "2026-10-08", cloture: "103.9" }, { isin: "IE00B4L5Y983", date: "2026-10-07", cloture: null });
  const desc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  let enCours = 0, max = 0;
  const rep = f => { enCours++; max = Math.max(max, enCours); const isin = f.eq.find(e => e[0] === "isin")[1];
    return new Promise(r => setTimeout(() => { enCours--; r({ data: lignes.filter(l => l.isin === isin).sort(desc).slice(f.range[0], f.range[1] + 1), error: null }); }, 2)); };
  const { ctx, appels } = storeSupabase({ cours: rep });
  await wait(0);
  const res = await ctx.Store.cours(["FR0000120073", "IE00B4L5Y983", "FR0000120073", "", null], "2022-01-01"), r = J(res);
  assert.equal(r.FR0000120073.length, 1500, "deux pages lues");
  assert.deepEqual(r.FR0000120073[0], { date: "2022-01-03", cloture: 100 }, "triés du plus ancien au plus récent ; clôture numérique");
  assert.deepEqual(r.IE00B4L5Y983, [{ date: "2026-10-08", cloture: 103.9 }, { date: "2026-10-09", cloture: 104.2 }], "clôture absente ignorée");
  assert.deepEqual(J(res.plafond), [], "aucun plafond atteint");
  const lus = appels.filter(a => a.table === "cours");
  assert.equal(lus.length, 3, "FR : 2 pages, IE : 1 page ; ISIN dédoublonnés, vides retirés");
  assert.deepEqual(J(lus[0].gte), ["date", "2022-01-01"]);
  assert.equal(lus[0].select, "isin, date, cloture");
  assert.deepEqual(J(lus.filter(a => a.eq[0][1] === "FR0000120073").map(a => a.range)), [[0, 999], [1000, 1999]]);
  assert.deepEqual(J(lus[0].ordres), ["date"], "des plus récentes aux plus anciennes");
  assert.equal(max, 2, "les ISIN sont lus en parallèle");
  // 6 requêtes à la fois au plus
  enCours = 0; max = 0;
  const huit = Array.from({ length: 8 }, (_, k) => "XS000000000" + k);
  await ctx.Store.cours(huit, "2026-01-01");
  assert.equal(max, 6, "au plus 6 en parallèle");
  // plafond : 3 pages pleines → ISIN signalé (historique tronqué côté ancien)
  const long = storeSupabase({ cours: f => ({ data: Array.from({ length: f.range[1] - f.range[0] + 1 }, (_, k) => ({ isin: "LONG", date: new Date(Date.UTC(2026, 0, 1) - (f.range[0] + k) * 864e5).toISOString().slice(0, 10), cloture: 1 })), error: null }) });
  await wait(0);
  const rl = await long.ctx.Store.cours(["LONG"], "2000-01-01");
  assert.equal(rl.LONG.length, 3000); assert.deepEqual(J(rl.plafond), ["LONG"]);
  // sans ISIN : aucune requête
  const n0 = appels.filter(a => a.table === "cours").length;
  assert.deepEqual(J(await ctx.Store.cours([], "2022-01-01")), {});
  assert.equal(appels.filter(a => a.table === "cours").length, n0);
  // table absente (migration 0023 pas encore appliquée) : {} et avertissement, puis plus aucune requête
  const b = storeSupabase({ cours: { data: null, error: { code: "42P01", message: "relation \"public.cours\" does not exist" } } });
  await wait(0);
  assert.deepEqual(J(await b.ctx.Store.cours(["FR0000120073"], "2022-01-01")), {});
  assert.deepEqual(J(await b.ctx.Store.cours(["FR0000120073"], "2022-01-01")), {});
  assert.equal(b.appels.filter(a => a.table === "cours").length, 1, "table absente : on n'insiste pas");
  assert.ok(b.avertissements.some(m => /cours historiques/.test(m)));
  // autre échec (réseau) : promesse rejetée (la vue ne mémorise rien et peut réessayer), nouvelle tentative possible
  let k = 0;
  const c = storeSupabase({ cours: () => (k++ === 0 ? { data: null, error: { code: "500", message: "panne" } } : { data: [{ isin: "FR0000120073", date: "2026-10-01", cloture: 1 }], error: null }) });
  await wait(0);
  await assert.rejects(c.ctx.Store.cours(["FR0000120073"], "2022-01-01"));
  assert.equal(J(await c.ctx.Store.cours(["FR0000120073"], "2022-01-01")).FR0000120073.length, 1, "réessai possible");
  const sup = src("store-supabase.js");
  assert.match(sup, /Contrat : window\.Store = \{[^\n]*cours\(isins, depuis\)/, "en-tête du contrat");
  assert.match(sup, /sourceAuto: r\.source_auto \|\| null, sourceAutoLe: r\.source_auto_le \|\| null/, "positions : source de synchronisation");
});

test("démo : proposition frais_enveloppes (0026) — fusion par enveloppe, null retire, mêmes validations, date pas dans le futur", async () => {
  const add = (id, apres) => ({ id, lot: "l4", cible: "config", operation: "modifier", ref: null, avant: null, apres, source: "test", justification: null,
    statut: "en_attente", creeLe: "2026-10-11T10:00:0" + id.slice(-1) + ".000Z", decideLe: null });
  const futur = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const ctx = browser({ prep: D => D.propositions.push(
    add("f1", { frais_enveloppes: { " Assurance-vie Camille ": { gestion_uc_pct: 0.5, gestion_euro_pct: "0.6", source: " CG 2026 ", le: "2026-09-30" } } }),
    add("f2", { frais_enveloppes: { "PEA Camille": { garde_pct: 0, source: "Grille 2026" }, "Assurance-vie Camille": { gestion_uc_pct: 0.6, source: "Avenant" } } }),
    add("f3", { frais_enveloppes: { "PEA Camille": null } }),
    add("f4", { frais_enveloppes: { "AV": { gestion_uc_pct: 5.01, source: "CG" } } }),
    add("f5", { frais_enveloppes: { "AV": { gestion_uc_pct: 0.5 } } }),
    add("f6", { frais_enveloppes: { "AV": { gestion_uc_pct: 0.5, source: "CG", le: futur } } }),
    add("f7", { frais_enveloppes: { "AV": { source: "CG" } } }),
    add("f8", { frais_enveloppes: { "AV": { gestion_uc_pct: 0.5, source: "CG", frais_entree_pct: 2 } } })) });
  await whenReady(ctx);
  const P = ctx.Store.propositions;
  assert.deepEqual(J(await P.appliquer(["f1"])), { appliquees: 1 });
  const auj = new Date().toISOString().slice(0, 10);
  assert.deepEqual(J(ctx.Store.get().config.frais_enveloppes), { "Assurance-vie Camille": { gestion_uc_pct: 0.5, gestion_euro_pct: 0.6, source: "CG 2026", le: "2026-09-30" } });
  assert.deepEqual(J(await P.appliquer(["f2"])), { appliquees: 1 });
  const fe = ctx.Store.get().config.frais_enveloppes;
  assert.deepEqual(J(fe["Assurance-vie Camille"]), { gestion_uc_pct: 0.6, source: "Avenant", le: auj }, "une enveloppe fournie remplace l'existante en entier ; date du jour par défaut");
  assert.deepEqual(J(fe["PEA Camille"]), { garde_pct: 0, source: "Grille 2026", le: auj });
  assert.deepEqual(J(await P.appliquer(["f3"])), { appliquees: 1 });
  assert.deepEqual(Object.keys(ctx.Store.get().config.frais_enveloppes), ["Assurance-vie Camille"], "null retire l'enveloppe");
  for (const [id, motif] of [["f4", /gestion_uc_pct invalide/], ["f5", /source obligatoire/], ["f6", /date \(le\) dans le futur/], ["f7", /au moins un pourcentage/], ["f8", /champ « frais_entree_pct » inconnu/]]) {
    await assert.rejects(P.appliquer([id]), e => e.code === "invalid_argument" && /^Proposition non appliquée \(réglages, modifier\) : frais_enveloppes/.test(e.message) && motif.test(e.message), id);
    assert.equal(ctx.Store.get().propositions.find(p => p.id === id).statut, "en_attente", id);
  }
});

test("store-supabase.js (exécuté, session factice) : config.frais_enveloppes lue (cfgView, {} par défaut) et symbole de l'instrument sur les lignes", async () => {
  const run = async reponses => {
    const ctx = {
      console: { log() {}, error() {}, warn() {} }, setTimeout, clearTimeout,
      location: { href: "https://x/app.html", search: "", hash: "", pathname: "/app.html" },
      document: { readyState: "complete", visibilityState: "visible", addEventListener() {} },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      BOUSSOLE: { supabaseUrl: "https://x.supabase.co", supabaseKey: "k" },
    };
    const requete = table => {
      const b = new Proxy({}, { get: (_, k) => (k === "then" ? (ok, ko) => Promise.resolve(reponses[table] || { data: null, error: null }).then(ok, ko) : () => b) });
      return b;
    };
    ctx.supabase = { createClient: () => ({ from: requete, rpc: async () => ({ data: null, error: null }), auth: { getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u" } } } }) } }) };
    ctx.window = ctx;
    vm.createContext(ctx);
    for (const f of ["sensible.js", "routine-etat.js", "banque-etat.js", "store-supabase.js"]) vm.runInContext(src(f), ctx, { filename: f });
    await wait(30);
    return ctx.Store.get();
  };
  const FE = { "Assurance-vie Linxea": { gestion_uc_pct: 0.5, source: "CG 2026", le: "2026-09-30" } };
  let S = await run({ config: { data: { targets: {}, rules: [], cushion: null, recurring: [], todo: [], milestones: [], hypotheses: [], frais_enveloppes: FE }, error: null },
    positions: { data: [{ id: "p", name: "ASML", envelope: "CTO", owner: "p1", bloc: "Convictions", mode: "market", isin: "NL0010273215", qty: 1, status: "actif",
      instruments: { price: 600, price_date: "2026-10-11", symbol: "ASML.AS", ter: null } }], error: null } });
  assert.deepEqual(J(S.config.frais_enveloppes), FE);
  assert.equal(S.positions[0].symbol, "ASML.AS");
  S = await run({ config: { data: { targets: {}, rules: [] }, error: null } });
  assert.deepEqual(J(S.config.frais_enveloppes), {}, "colonne absente ou vide : objet vide");
});
