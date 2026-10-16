// HIS2, tâche 12 : la nuit (supabase/functions/nightly : index.ts + photos.ts + historique.gen.js) exécutée dans un contexte vm avec une base en mémoire qui rejoue
// les règles de la migration 0034 (déclencheur photos_reconstituees_garde : aucune photo à la date de la première photo observée ni après, 240 photos au plus)
// et un `fetch` simulé (Yahoo). Couvre : copie générée du moteur (à jour, même sortie que l'app), photos reconstituées (valeurs de la fixture, idempotence, import retiré,
// première photo observée, 240 mois, autre utilisateur, temps), cours anciens prioritaires (plage max, bornes, 10 ISIN) et rétention des propositions (30 jours).
// Aucune donnée réelle, aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import vm from "node:vm";
import { genererHistoriqueNuit, SORTIE_HISTORIQUE_NUIT } from "../scripts/gen-catalogue.mjs";
import { modulesPhotos, SOURCE_GEN_NUIT } from "./helpers/nightly-photos.mjs";
import { parFonction, cas } from "./helpers/his2.mjs";
import { entreeReconstituer, mouvementsDe } from "./helpers/his2-reconstitution.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const App = require("../web/src/historique.js");
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const lire = f => readFileSync(new URL("../supabase/functions/nightly/" + f, import.meta.url), "utf8");

const U = "11111111-1111-4111-8111-111111111111", AUTRE = "22222222-2222-4222-8222-222222222222";
const JETON = "jeton-nuit-factice", MAINTENANT = new Date("2026-10-16T20:30:00Z"), AUJ = "2026-10-16";
const ENV = { SUPABASE_URL: "https://projet-factice.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "cle-service-factice" };
const ISIN = "FR9990000013";

/* ---------- chargement ---------- */
function chargerModule(source, contexte) {
  const noms = [...source.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?\s*$/gm, "").replace(/^export (const|function|async function|class)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, contexte);
}
const GLOBALES = { RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, isFinite, Infinity, NaN, TextEncoder, TextDecoder, Intl, crypto: globalThis.crypto, Error, TypeError,
  Boolean, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL, URLSearchParams, Request, Response, Headers, AbortSignal, setTimeout, Uint8Array };
function charger(journaux) {
  const G = { ...GLOBALES, console: { log: (...a) => journaux.push(a.join(" ")), error: (...a) => journaux.push(a.join(" ")), warn: (...a) => journaux.push(a.join(" ")) } };
  const C = chargerModule(lire("cours.ts"), { ...G }), B = chargerModule(lire("binance.ts"), { ...G }), F = chargerModule(lire("frais.ts"), { ...G });
  const servis = [];
  const I = chargerModule(lire("index.ts"), { ...G, ...C, ...B, ...F, ...modulesPhotos(G), clientBinance: B.client, Deno: { env: { get: () => undefined }, serve: f => servis.push(f) },
    createClient: () => { throw new Error("client réel interdit en test"); } });
  return { I, handler: servis[0] };
}

/* ---------- base en mémoire qui rejoue les règles de la migration 0034 ---------- */
const CLES = { cours: ["isin", "date"], photos_reconstituees: ["user_id", "mois"], status: ["user_id"], instruments: ["isin"] };
const chemin = (ligne, col) => { // « apres->>type », « apres->resume », « colonne »
  const [base, ...reste] = col.split(/->>?/);
  let v = ligne[base];
  const texte = col.includes("->>");
  for (const k of reste) v = v == null ? null : v[k];
  return texte && v != null && typeof v === "object" ? JSON.stringify(v) : v ?? null;
};
function baseMemoire(init, rpc, { panne = () => false } = {}) {
  const tables = structuredClone(init);
  const journal = [];
  const lignes = t => (tables[t] ??= []);
  function declencheurPhotos(r, op) {
    const premiere = lignes("snapshots").filter(s => s.user_id === r.user_id).map(s => s.date).sort()[0];
    if (premiere && r.date >= premiere) return { message: `photo reconstituée refusée : le mois ${String(r.mois).slice(0, 7)} n'est pas antérieur à la première photo observée (${premiere})` };
    if (op === "insert" && lignes("photos_reconstituees").filter(p => p.user_id === r.user_id && p.mois !== r.mois).length >= 240) return { message: "Limite atteinte : 240 photos reconstituées au plus (20 ans)." };
    return null;
  }
  function from(table) {
    if (panne(table)) throw new Error(`panne inattendue ${table}`);
    const q = { op: "select", filtres: [], cols: "*", ordre: [], limite: null, plage: null, un: false, val: null, opts: {} };
    const ok = r => q.filtres.every(f => f(r));
    const b = {
      select: (c = "*") => { q.cols = c; return b; },
      eq: (k, v) => { q.filtres.push(r => chemin(r, k) === v || String(chemin(r, k)) === String(v)); return b; },
      neq: (k, v) => { q.filtres.push(r => chemin(r, k) !== v); return b; },
      in: (k, v) => { q.filtres.push(r => v.map(String).includes(String(chemin(r, k)))); return b; },
      is: (k, v) => { q.filtres.push(r => (v === null ? chemin(r, k) == null : chemin(r, k) === v)); return b; },
      not: (k, op, v) => { q.filtres.push(r => !(op === "is" && v === null ? chemin(r, k) == null : false)); return b; },
      lt: (k, v) => { q.filtres.push(r => chemin(r, k) != null && String(chemin(r, k)) < String(v)); return b; },
      gte: (k, v) => { q.filtres.push(r => chemin(r, k) != null && String(chemin(r, k)) >= String(v)); return b; },
      order: (k, o = {}) => { q.ordre.push([k, o.ascending !== false]); return b; },
      limit: n => { q.limite = n; return b; }, range: (a, z) => { q.plage = [a, z]; return b; }, maybeSingle: () => { q.un = true; return b; },
      insert: v => { q.op = "insert"; q.val = v; return b; }, upsert: (v, o = {}) => { q.op = "upsert"; q.val = v; q.opts = o; return b; },
      update: v => { q.op = "update"; q.val = v; return b; }, delete: () => { q.op = "delete"; return b; },
      then: (res, rej) => Promise.resolve().then(exec).then(res, rej),
    };
    function exec() {
      journal.push({ table, op: q.op, nb: [].concat(q.val ?? []).length });
      if (q.op === "select") {
        let d = lignes(table).filter(ok);
        for (const [k, asc] of [...q.ordre].reverse()) d = d.slice().sort((x, y) => { const a = chemin(x, k), c = chemin(y, k); return (a < c ? -1 : a > c ? 1 : 0) * (asc ? 1 : -1); });
        if (q.plage) d = d.slice(q.plage[0], q.plage[1] + 1);
        if (q.limite != null) d = d.slice(0, q.limite);
        const cols = q.cols === "*" ? null : q.cols.split(",").map(c => c.trim());
        d = d.map(r => (cols ? Object.fromEntries(cols.map(c => { const m = c.match(/^(\w+):(.+)$/); return m ? [m[1], chemin(r, m[2])] : [c.includes("->") ? c.split(/->>?/).pop() : c, chemin(r, c)]; })) : { ...r }));
        return { data: q.un ? d[0] ?? null : d, error: null };
      }
      if (q.op === "insert" || q.op === "upsert") {
        const champs = q.opts.onConflict ? q.opts.onConflict.split(",").map(s => s.trim()) : CLES[table] ?? ["id"];
        const cle = r => champs.map(k => String(r[k])).join("|");
        const vus = new Set();
        for (const r of [].concat(q.val)) {
          if (vus.has(cle(r))) return { data: null, error: { message: "ON CONFLICT DO UPDATE command cannot affect row a second time" } };
          vus.add(cle(r));
          const i = lignes(table).findIndex(x => cle(x) === cle(r));
          if (table === "photos_reconstituees") { const e = declencheurPhotos(r, i < 0 ? "insert" : "update"); if (e) return { data: null, error: e }; }
          if (table === "cours" && !(r.cloture > 0)) return { data: null, error: { message: "cours_cloture" } };
          if (i < 0) lignes(table).push({ ...r }); else lignes(table)[i] = { ...lignes(table)[i], ...r };
        }
        return { data: null, error: null };
      }
      if (q.op === "update") {
        for (const r of lignes(table)) if (ok(r)) {
          if (table === "photos_reconstituees") return { data: null, error: { message: "photos_reconstituees : lecture seule pour authenticated, écrite par le service" } };
          Object.assign(r, q.val);
        }
        return { data: null, error: null };
      }
      if (q.op === "delete") { tables[table] = lignes(table).filter(r => !ok(r)); return { data: null, error: null }; }
      return { data: null, error: null };
    }
    return b;
  }
  return { tables, journal, from, rpc: async (nom, args) => { journal.push({ rpc: nom }); return rpc[nom] ? rpc[nom](args, tables) : { data: null, error: { message: `rpc ${nom} inconnue` } }; } };
}

/* ---------- réseau simulé (Yahoo) ---------- */
const rep = (c, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "Content-Type": "application/json" } });
const jourPlus = (d, k) => new Date(Date.parse(d + "T00:00:00Z") + k * 864e5).toISOString().slice(0, 10);
const jours = (debut, n, pas = 1) => Array.from({ length: n }, (_, i) => jourPlus(debut, i * pas));
const chart = (dates, prix, price = null) => ({ chart: { result: [{ meta: { currency: "EUR", regularMarketPrice: price ?? prix(dates.length - 1), regularMarketTime: Date.parse(dates[dates.length - 1] + "T15:30:00Z") / 1000 },
  timestamp: dates.map(d => Date.parse(d + "T07:00:00Z") / 1000), indicators: { quote: [{ close: dates.map((_, i) => prix(i)) }] } }] } });
function reseau(yahoo = {}) {
  const appels = [];
  return { appels, fetch: async url => {
    const u = new URL(String(url));
    appels.push({ hote: u.hostname, chemin: u.pathname, range: u.searchParams.get("range") });
    if (u.hostname === "fc.yahoo.com") return new Response("", { status: 404, headers: { "Set-Cookie": "A3=c; Path=/" } });
    if (u.hostname === "query1.finance.yahoo.com") {
      const k = `${decodeURIComponent(u.pathname.split("/").pop())}|${u.searchParams.get("range")}`;
      return yahoo[k] === undefined ? rep({ chart: { result: null, error: { description: "No data found" } } }, 404) : rep(yahoo[k]);
    }
    throw new Error("hôte inattendu " + u.hostname);
  } };
}

/* ---------- jeu de données : P1 (ordres du PEA) ---------- */
const COURS_P1 = [["2024-01-08", 95.4], ["2024-01-31", 96], ["2024-02-08", 98.2], ["2024-02-29", 100], ["2024-03-15", 104.1], ["2024-03-28", 105]];
const POS_ETF = { id: "pos-etf", user_id: U, name: "ETF Monde A", envelope: "PEA Exemple", owner: "p1", bloc: "Monde", mode: "market", isin: ISIN, qty: 15, value: null, price_override: null, status: "actif" };
const tx = (id, date, type, qty, price, amount, frais, extra = {}) => ({ id, user_id: U, position_id: "pos-etf", date, type, qty, price, amount, frais, enveloppe: null, import_id: "imp-1", doublon_de: null, source: "import", ...extra });
const ORDRES = [tx("t1", "2024-01-08", "achat", 10, 95, 950, 1), tx("t2", "2024-02-08", "achat", 10, 98, 980, 1), tx("t3", "2024-03-15", "vente", 5, 104, 520, 1)];
function donnees(extra = {}) {
  return {
    instruments: [{ isin: ISIN, symbol: "ETFA.PA", currency: "EUR", price: 106, cours_rattrapage_le: null }],
    positions: [POS_ETF],
    cours: COURS_P1.map(([date, cloture]) => ({ isin: ISIN, date, cloture, source: "yahoo" })),
    transactions: ORDRES.map(t => ({ ...t })),
    historique_imports: [{ id: "imp-1", user_id: U, type: "ordres", enveloppe: "PEA Exemple", resume: { depuis_ouverture: true } }],
    historique_comptes: [], historique_releves: [], banque_comptes: [],
    snapshots: [{ user_id: U, date: "2026-10-14", total: 1590 }],
    status: [{ user_id: U, historique_a_recalculer: "2026-10-15T10:00:00+00:00" }],
    photos_reconstituees: [], propositions: [], profiles: [], biens: [], credits: [],
    ...extra,
  };
}
const YAHOO_JOUR = { "ETFA.PA|5d": chart(jours("2026-10-12", 5), () => 106, 106) };

function monter({ init = donnees(), yahoo = YAHOO_JOUR, aRattraper = [], avance = null, panne } = {}) {
  const journaux = [], net = reseau(yahoo), chrono = [];
  let t = 0;
  const { I, handler } = charger(journaux);
  const rpc = { check_nightly_token: async ({ p }) => ({ data: p === JETON, error: null }), cours_a_rattraper: async ({ p_limite }) => ({ data: aRattraper.slice(0, p_limite), error: null }),
    frais_a_chercher: async () => ({ data: [], error: null }), take_snapshots: async () => ({ data: 1, error: null }), apply_recurring: async () => ({ data: 0, error: null }),
    finish_nightly: async () => ({ data: null, error: null }) };
  const db = baseMemoire(init, rpc, { panne });
  I.deps.createClient = () => db;
  I.deps.fetch = async (url, init2 = {}) => { const u = new URL(String(url)); chrono.push(`${decodeURIComponent(u.pathname.split("/").pop())}|${u.searchParams.get("range")}`); if (avance) t = avance(String(url), t) ?? t; return net.fetch(url, init2); };
  I.deps.env = k => ENV[k];
  I.deps.maintenant = () => MAINTENANT;
  I.deps.horloge = () => t;
  I.deps.signal = () => new AbortController().signal;
  I.deps.attendre = async () => {};
  const appeler = async () => { const r = await handler(new Request("https://projet-factice.supabase.co/functions/v1/nightly", { method: "POST", headers: { Authorization: `Bearer ${JETON}` } })); return { status: r.status, corps: await r.json() }; };
  return { db, net, journaux, appeler, chrono, avancer: v => { t = v; } };
}
const plat = x => JSON.parse(JSON.stringify(x)); // les objets écrits par le code de la nuit viennent d'un autre contexte vm
const photosDe = (m, uid = U) => m.db.tables.photos_reconstituees.filter(p => p.user_id === uid).sort((a, b) => (a.mois < b.mois ? -1 : 1));
const sansErreurPhotos = corps => assert.deepEqual(corps.errors.filter(e => /photos|rattrapage des cours anciens|propositions/.test(e.error ?? "")), [], "aucune erreur de photos");

/* ================================================================== copie générée du moteur */
test("historique.gen.js (nuit) est à jour (npm run gen)", () => {
  assert.equal(SOURCE_GEN_NUIT(), genererHistoriqueNuit(), "supabase/functions/nightly/historique.gen.js périmé : lancer npm run gen");
  assert.equal(SORTIE_HISTORIQUE_NUIT, "supabase/functions/nightly/historique.gen.js");
});
test("parité : la copie de la nuit et le moteur de l'app donnent les mêmes sorties sur tous les cas de reconstitution de la fixture", () => {
  const src = SOURCE_GEN_NUIT(), noms = [...src.matchAll(/^export const (\w+) = /gm)].map(m => m[1]);
  const Gen = vm.runInThisContext(`(function(){ ${src.replace(/^export const (\w+) = /gm, "const $1 = ")}\n;return { ${noms.join(", ")} }; })()`);
  assert.deepEqual(Object.keys(Gen.Historique).sort(), Object.keys(App).sort(), "mêmes exports");
  let n = 0;
  for (const c of parFonction("reconstituer")) {
    const e = entreeReconstituer(c), a = App.reconstituer({ ...e, detailLignes: true }), g = Gen.Historique.reconstituer({ ...e, detailLignes: true });
    assert.deepEqual(JSON.parse(JSON.stringify(g)), JSON.parse(JSON.stringify(a)), c.id);
    n++;
  }
  assert.ok(n >= 8);
  for (const c of parFonction("qualite")) assert.deepEqual(JSON.parse(JSON.stringify(Gen.Historique.qualite(c.entree.contributions))), App.qualite(c.entree.contributions), c.id);
});

/* ================================================================== photos reconstituées */
test("nuit : les photos reconstituées d'un import validé sont écrites (valeurs de P1), la demande repasse à nul, un second passage ne change rien", { skip: SANS_STRIP }, async () => {
  const m = monter();
  const r = await m.appeler();
  assert.equal(r.status, 200);
  sansErreurPhotos(r.corps);
  const ph = photosDe(m);
  assert.equal(ph.length, 33, "de janvier 2024 à septembre 2026 : jamais le mois de la première photo observée (14/10/2026)");
  assert.deepEqual(ph.slice(0, 3).map(p => [p.mois, p.date, p.financier]), [["2024-01-01", "2024-01-31", 960], ["2024-02-01", "2024-02-29", 2000], ["2024-03-01", "2024-03-31", 1575]]);
  const j = ph[0];
  assert.deepEqual(plat({ total: j.total, p1: j.p1, p2: j.p2, net: j.net, by_bloc: j.by_bloc, by_envelope: j.by_envelope, qualite: j.qualite, part_estimee: j.part_estimee, sources: j.sources, methode: j.methode }),
    { total: 960, p1: 960, p2: 0, net: 960, by_bloc: { p1: { Monde: 960 }, p2: {} }, by_envelope: { "PEA Exemple": 960 }, qualite: "complet", part_estimee: 0, sources: [{ type: "ordres", import_id: "imp-1", part: 1 }], methode: "historique@2" });
  assert.ok(ph.every(p => p.user_id === U && p.calcule_le === MAINTENANT.toISOString()));
  assert.equal(m.db.tables.status.find(s => s.user_id === U).historique_a_recalculer, null, "demande satisfaite");
  assert.deepEqual([r.corps.photos.utilisateurs, r.corps.photos.mois], [1, 33]);
  // idempotence : sans nouvelle demande, rien n'est recalculé ; avec une nouvelle demande, mêmes lignes
  const avant = JSON.stringify(ph);
  const m2 = monter({ init: m.db.tables });
  const r2 = await m2.appeler();
  assert.equal(r2.corps.photos.utilisateurs, 0, "aucune demande : rien à faire");
  assert.equal(JSON.stringify(photosDe(m2)), avant);
  m2.db.tables.status.find(s => s.user_id === U).historique_a_recalculer = "2026-10-16T01:00:00+00:00";
  const m3 = monter({ init: m2.db.tables });
  const r3 = await m3.appeler();
  assert.equal(r3.corps.photos.utilisateurs, 1);
  assert.deepEqual(plat(photosDe(m3).map(p => ({ ...p, calcule_le: "" }))), JSON.parse(avant).map(p => ({ ...p, calcule_le: "" })), "mêmes photos après un second calcul");
});
test("nuit : aucune photo à la date de la première photo observée ni après (même une ancienne photo laissée en base)", { skip: SANS_STRIP }, async () => {
  const init = donnees({ snapshots: [{ user_id: U, date: "2024-03-15", total: 1590 }],
    photos_reconstituees: [{ user_id: U, mois: "2024-03-01", date: "2024-03-31", total: 1, p1: 1, p2: 0, financier: 1, net: 1, by_bloc: {}, by_envelope: {}, qualite: "estime", part_estimee: 1, sources: [], methode: "historique@2", calcule_le: "2026-01-01T00:00:00Z" },
      { user_id: U, mois: "2024-04-01", date: "2024-04-30", total: 1, p1: 1, p2: 0, financier: 1, net: 1, by_bloc: {}, by_envelope: {}, qualite: "estime", part_estimee: 1, sources: [], methode: "historique@2", calcule_le: "2026-01-01T00:00:00Z" }] });
  const m = monter({ init });
  const r = await m.appeler();
  sansErreurPhotos(r.corps);
  assert.deepEqual(photosDe(m).map(p => [p.date, p.financier]), [["2024-01-31", 960], ["2024-02-29", 2000]], "février est le dernier mois avant le 15/03 ; les photos de mars et avril sont supprimées");
  assert.ok(photosDe(m).every(p => p.date < "2024-03-15"));
});
test("nuit : sans photo observée, les photos vont jusqu'à la veille", { skip: SANS_STRIP }, async () => {
  const m = monter({ init: donnees({ snapshots: [] }) });
  const r = await m.appeler();
  sansErreurPhotos(r.corps);
  const ph = photosDe(m);
  assert.equal(ph[ph.length - 1].date, "2026-09-30", "dernier mois complet avant aujourd'hui");
});
test("nuit : un import retiré — ses photos disparaissent ; un import qui reste — les photos sont recalculées sans l'autre", { skip: SANS_STRIP }, async () => {
  const deux = donnees({
    transactions: [...ORDRES.map(t => ({ ...t })), tx("t4", "2024-02-20", "achat", 3, 101, 303, 0, { import_id: "imp-2" })],
    historique_imports: [{ id: "imp-1", user_id: U, type: "ordres", enveloppe: "PEA Exemple", resume: { depuis_ouverture: true } }, { id: "imp-2", user_id: U, type: "ordres", enveloppe: "PEA Exemple", resume: {} }],
    positions: [{ ...POS_ETF, qty: 18 }] });
  const m = monter({ init: deux });
  sansErreurPhotos((await m.appeler()).corps);
  assert.equal(photosDe(m).find(p => p.date === "2024-03-31").financier, 18 * 105 - 0, "18 parts fin mars avec les deux imports (10 + 10 + 3 − 5)");
  // l'utilisateur retire imp-2 (retirer_import : l'import et ses mouvements disparaissent, la demande est posée) ; la quantité d'aujourd'hui est corrigée à 15
  const t = m.db.tables;
  t.transactions = t.transactions.filter(x => x.import_id !== "imp-2"); t.historique_imports = t.historique_imports.filter(i => i.id !== "imp-2");
  t.positions = [{ ...POS_ETF, qty: 15 }]; t.status.find(s => s.user_id === U).historique_a_recalculer = "2026-10-16T02:00:00+00:00";
  const m2 = monter({ init: t });
  sansErreurPhotos((await m2.appeler()).corps);
  assert.equal(photosDe(m2).find(p => p.date === "2024-03-31").financier, 1575, "recalculé sans l'import retiré");
  // l'utilisateur retire le dernier import : plus rien à reconstituer, les photos sont supprimées
  const t2 = m2.db.tables;
  t2.transactions = []; t2.historique_imports = []; t2.status.find(s => s.user_id === U).historique_a_recalculer = "2026-10-16T03:00:00+00:00";
  const m3 = monter({ init: t2 });
  const r3 = await m3.appeler();
  sansErreurPhotos(r3.corps);
  assert.equal(photosDe(m3).length, 0);
  assert.equal(r3.corps.photos.supprimees, 33);
  assert.equal(m3.db.tables.status.find(s => s.user_id === U).historique_a_recalculer, null);
});
test("nuit : une demande arrivée pendant le calcul n'est pas effacée ; un autre utilisateur n'est jamais touché", { skip: SANS_STRIP }, async () => {
  const autrePhoto = { user_id: AUTRE, mois: "2023-01-01", date: "2023-01-31", total: 5, p1: 5, p2: 0, financier: 5, net: 5, by_bloc: {}, by_envelope: {}, qualite: "estime", part_estimee: 1, sources: [], methode: "historique@2", calcule_le: "2026-01-01T00:00:00Z" };
  const init = donnees({ photos_reconstituees: [autrePhoto], status: [{ user_id: U, historique_a_recalculer: "2026-10-15T10:00:00+00:00" }, { user_id: AUTRE, historique_a_recalculer: null }],
    positions: [POS_ETF, { ...POS_ETF, id: "a-etf", user_id: AUTRE, qty: 99 }], transactions: [...ORDRES.map(t => ({ ...t })), { ...ORDRES[0], id: "a-t1", user_id: AUTRE, position_id: "a-etf", import_id: "imp-a" }] });
  const m = monter({ init });
  // la demande est modifiée pendant le calcul (un import validé entre-temps) : on la détecte à la lecture des transactions
  const de = m.db.from;
  m.db.from = t => { if (t === "historique_releves") m.db.tables.status.find(s => s.user_id === U).historique_a_recalculer = "2026-10-16T05:00:00+00:00"; return de(t); };
  const r = await m.appeler();
  sansErreurPhotos(r.corps);
  assert.equal(m.db.tables.status.find(s => s.user_id === U).historique_a_recalculer, "2026-10-16T05:00:00+00:00", "la nouvelle demande reste posée");
  assert.deepEqual(m.db.tables.photos_reconstituees.filter(p => p.user_id === AUTRE), [autrePhoto], "l'autre utilisateur n'a rien reçu");
  assert.ok(m.db.journal.every(j => !(j.table === "photos_reconstituees" && j.op === "delete" && j.nb === 0)));
});
test("nuit : 240 photos au plus (20 ans), les plus récentes", { skip: SANS_STRIP }, async () => {
  // des mouvements et des cours depuis 25 ans
  const debut = "2001-10-10";
  const cours = [...Array(300)].map((_, i) => { const d = new Date(Date.UTC(2001, 9 + i, 1)); return { isin: ISIN, date: d.toISOString().slice(0, 10), cloture: 50 + (i % 10), source: "yahoo" }; }).filter(c => c.date < "2026-10-01");
  const init = donnees({ cours, transactions: [tx("t1", debut, "achat", 15, 50, 750, 0)], snapshots: [] });
  const m = monter({ init });
  const r = await m.appeler();
  sansErreurPhotos(r.corps);
  const ph = photosDe(m);
  assert.equal(ph.length, 240);
  assert.equal(ph[ph.length - 1].date, "2026-09-30");
  assert.equal(ph[0].date, "2006-10-31", "les 240 derniers mois");
  // rejouée avec 240 photos déjà là : le déclencheur n'est pas franchi (les mois obsolètes sont retirés d'abord)
  m.db.tables.status.find(s => s.user_id === U).historique_a_recalculer = "2026-10-16T06:00:00+00:00";
  const m2 = monter({ init: m.db.tables });
  sansErreurPhotos((await m2.appeler()).corps);
  assert.equal(photosDe(m2).length, 240);
});
test("nuit : photos d'une version plus ancienne du moteur → recalculées sans demande ; la demande d'un autre utilisateur sans import supprime ses restes", { skip: SANS_STRIP }, async () => {
  const vieille = { user_id: U, mois: "2024-01-01", date: "2024-01-31", total: 1, p1: 1, p2: 0, financier: 1, net: 1, by_bloc: {}, by_envelope: {}, qualite: "estime", part_estimee: 1, sources: [], methode: "historique@1", calcule_le: "2026-01-01T00:00:00Z" };
  const m = monter({ init: donnees({ photos_reconstituees: [vieille], status: [{ user_id: U, historique_a_recalculer: null }] }) });
  sansErreurPhotos((await m.appeler()).corps);
  assert.equal(photosDe(m)[0].financier, 960);
  assert.equal(photosDe(m)[0].methode, "historique@2");
});
test("nuit : budget de temps — aucun utilisateur après 100 s, la demande reste posée (reprise la nuit suivante)", { skip: SANS_STRIP }, async () => {
  const m = monter({ avance: (url, t) => 101_000 });
  m.avancer(0);
  const r = await m.appeler();
  assert.equal(photosDe(m).length, 0);
  assert.ok(r.corps.avertissements.some(a => /photos reconstituées : temps écoulé/.test(a)), JSON.stringify(r.corps.avertissements));
  assert.equal(m.db.tables.status.find(s => s.user_id === U).historique_a_recalculer, "2026-10-15T10:00:00+00:00");
  assert.equal(r.corps.photos.reportes, 1);
});
test("nuit : une erreur de lecture est notée (job_runs.errors), la demande reste posée, la nuit continue", { skip: SANS_STRIP }, async () => {
  const m = monter({ panne: t => t === "historique_releves" });
  const r = await m.appeler();
  assert.ok(r.corps.errors.some(e => /photos reconstituées : panne inattendue historique_releves/.test(e.error)), JSON.stringify(r.corps.errors));
  assert.equal(m.db.tables.status.find(s => s.user_id === U).historique_a_recalculer, "2026-10-15T10:00:00+00:00");
  assert.equal(photosDe(m).length, 0);
  assert.equal(r.status, 200);
});
test("nuit : tables de l'historique absentes (migration 0034 pas appliquée) → avertissement, la nuit n'est pas fautive", { skip: SANS_STRIP }, async () => {
  const m = monter({ panne: t => t === "status" });
  const de = m.db.from;
  m.db.from = t => (t === "status" ? { select: () => ({ not: () => ({ limit: async () => ({ data: null, error: { message: 'column status.historique_a_recalculer does not exist' } }) }) }) } : de(t));
  const r = await m.appeler();
  assert.deepEqual(r.corps.errors.filter(e => /photos/.test(e.error ?? "")), []);
  assert.ok(r.corps.avertissements.some(a => /migration 0034/.test(a)), JSON.stringify(r.corps.avertissements));
});
test("nuit : le patrimoine net d'une photo ajoute les biens hors placements d'aujourd'hui (convention de HIS1)", { skip: SANS_STRIP }, async () => {
  const m = monter({ init: donnees({ biens: [{ user_id: U, valeur: 200000, part_p1: 50, crd: 150000 }], credits: [{ user_id: U, owner: "p1", crd: 1000 }], profiles: [{ user_id: U, autres: { p1: { usage: 5000, entreprise: 0 } } }] }) });
  sansErreurPhotos((await m.appeler()).corps);
  const p = photosDe(m)[0];
  assert.equal(p.financier, 960);
  assert.equal(p.net, 960 + 200000 + 5000 - 150000 - 1000);
});
test("nuit : relevés bancaires importés — le solde de fin de mois d'un compte rattaché entre dans la photo (compte rattaché à une ligne, ou à un compte Powens)", { skip: SANS_STRIP }, async () => {
  const cc = { id: "pos-cc", user_id: U, name: "Compte courant Exemple", envelope: "Comptes", owner: "p1", bloc: "Courant", mode: "manual", isin: null, qty: null, value: 2500, price_override: null, status: "actif" };
  const init = donnees({ positions: [POS_ETF, cc], historique_comptes: [{ id: "h1", user_id: U, position_id: null, banque_compte_id: 9 }], banque_comptes: [{ id: 9, user_id: U, position_id: "pos-cc" }],
    historique_releves: [{ user_id: U, compte_id: "h1", mois: "2024-01-01", solde_debut: 2000, solde_fin: 2200, import_id: "imp-b" }, { user_id: U, compte_id: "h1", mois: "2024-02-01", solde_debut: 2200, solde_fin: 2280, import_id: "imp-b" }] });
  const m = monter({ init });
  sansErreurPhotos((await m.appeler()).corps);
  const ph = photosDe(m);
  assert.equal(ph.find(p => p.date === "2023-12-31").financier, 2000, "solde de début de janvier");
  assert.equal(ph.find(p => p.date === "2024-01-31").financier, 960 + 2200);
  assert.equal(ph.find(p => p.date === "2024-02-29").financier, 2000 + 2280);
  assert.equal(ph.find(p => p.date === "2024-01-31").by_envelope.Comptes, 2200);
  assert.ok(ph.find(p => p.date === "2024-01-31").sources.some(s => s.type === "releves" && s.import_id === "imp-b"));
});

/* ================================================================== cours anciens prioritaires */
const TX_ANCIEN = tx("t0", "2017-03-01", "achat", 15, 50, 750, 0);
const coursDepuis = (debut, n, pas = 7) => jours(debut, n, pas).map((date, i) => ({ isin: ISIN, date, cloture: 40 + (i % 5), source: "yahoo" }));
const CHART_MAX = chart(jours("2016-01-04", 520, 7).filter(d => d < "2026-10-01"), i => 30 + (i % 8));
function ancien(over = {}) {
  return donnees({ transactions: [TX_ANCIEN], cours: coursDepuis("2021-10-20", 250), snapshots: [], status: [{ user_id: U, historique_a_recalculer: null }], ...over });
}
test("cours anciens : un mouvement importé plus ancien que les cours → plage max, cours enregistrés, essai marqué, photos recalculées la même nuit", { skip: SANS_STRIP }, async () => {
  const m = monter({ init: ancien(), yahoo: { ...YAHOO_JOUR, "ETFA.PA|max": CHART_MAX, "ETFA.PA|5y": chart(jours("2021-10-20", 100, 7), () => 41) } });
  const r = await m.appeler();
  sansErreurPhotos(r.corps);
  assert.ok(m.chrono.includes("ETFA.PA|max"), "plage max demandée : " + m.chrono.join(", "));
  assert.ok(!m.chrono.includes("ETFA.PA|5y"), "pas de rattrapage sur 5 ans en plus");
  assert.deepEqual([r.corps.rattrapages.tentes, r.corps.rattrapages.reussis], [1, 1]);
  assert.ok(m.db.tables.cours.some(c => c.isin === ISIN && c.date < "2021-10-15"), "cours antérieurs aux 5 ans enregistrés");
  assert.equal(m.db.tables.instruments[0].cours_rattrapage_le, MAINTENANT.toISOString());
  assert.equal(r.corps.photos.cours_anciens, 1);
  const ph = photosDe(m);
  assert.equal(ph[0].date, "2017-03-31", "photos depuis le mois du premier mouvement, grâce aux cours anciens");
  assert.equal(m.db.tables.status.find(s => s.user_id === U).historique_a_recalculer, null, "la demande posée par le rattrapage est satisfaite dans la nuit");
  assert.equal(m.db.tables.status.length, 1);
});
test("cours anciens : bornes — rien à faire si les cours couvrent le premier mouvement, s'il remonte à moins de 7 jours près, si l'essai date de moins de 7 jours, ou si la plage max a déjà eu lieu", { skip: SANS_STRIP }, async () => {
  const essai = async init => { const m = monter({ init, yahoo: { ...YAHOO_JOUR, "ETFA.PA|max": CHART_MAX } }); const r = await m.appeler(); return { m, r, max: m.chrono.includes("ETFA.PA|max") }; };
  assert.equal((await essai(ancien({ transactions: [tx("t0", "2022-01-05", "achat", 15, 50, 750, 0)] }))).max, false, "les cours (dès 20/10/2021) couvrent déjà ce mouvement");
  assert.equal((await essai(ancien({ transactions: [tx("t0", "2021-10-15", "achat", 15, 50, 750, 0)] }))).max, false, "5 jours d'écart : toléré");
  assert.equal((await essai(ancien({ instruments: [{ isin: ISIN, symbol: "ETFA.PA", currency: "EUR", price: 106, cours_rattrapage_le: "2026-10-12T20:30:00.000Z" }] }))).max, false, "essai de moins de 7 jours");
  assert.equal((await essai(ancien({ instruments: [{ isin: ISIN, symbol: "ETFA.PA", currency: "EUR", price: 106, cours_rattrapage_le: "2026-10-01T20:30:00.000Z" }] }))).max, true, "essai de plus de 7 jours : nouvel essai");
  assert.equal((await essai(ancien({ cours: coursDepuis("2012-01-02", 400) }))).max, false, "les cours remontent déjà à 2012 : la plage max a eu lieu, le fournisseur n'a pas plus");
  const jeune = await essai(ancien({ cours: coursDepuis("2025-03-03", 100), instruments: [{ isin: ISIN, symbol: "ETFA.PA", currency: "EUR", price: 106, cours_rattrapage_le: "2026-09-01T00:00:00.000Z" }] }));
  assert.equal(jeune.max, false, "instrument récent déjà rattrapé : son historique est complet");
  const sansImport = await essai(ancien({ transactions: [{ ...TX_ANCIEN, import_id: null, source: "manuel" }], historique_imports: [] }));
  assert.equal(sansImport.max, false, "une saisie n'est pas un mouvement importé");
  const doublon = await essai(ancien({ transactions: [{ ...TX_ANCIEN, doublon_de: "autre" }] }));
  assert.equal(doublon.max, false, "un mouvement remplacé par un doublon ne compte pas");
});
test("cours anciens : un mouvement à moins de 5 ans des premiers cours reste sur la plage 5y ; la plage max n'est prise qu'au-delà", { skip: SANS_STRIP }, async () => {
  const m = monter({ init: ancien({ transactions: [tx("t0", "2022-01-05", "achat", 15, 50, 750, 0)], cours: coursDepuis("2023-02-01", 100) }), yahoo: { ...YAHOO_JOUR, "ETFA.PA|5y": chart(jours("2021-10-20", 200, 7), () => 41) } });
  await m.appeler();
  assert.ok(m.chrono.includes("ETFA.PA|5y") && !m.chrono.includes("ETFA.PA|max"), m.chrono.join(", "));
});
test("cours anciens : passent avant la RPC, 10 ISIN au plus par nuit, sans doublon avec la RPC", { skip: SANS_STRIP }, async () => {
  const isins = Array.from({ length: 12 }, (_, i) => "FR99900002" + String(i).padStart(2, "0"));
  const instruments = [{ isin: ISIN, symbol: "ETFA.PA", currency: "EUR", price: 106, cours_rattrapage_le: null }, ...isins.map((isin, i) => ({ isin, symbol: "A" + i + ".PA", currency: "EUR", price: 10, cours_rattrapage_le: null }))];
  const positions = [POS_ETF, ...isins.map((isin, i) => ({ ...POS_ETF, id: "p" + i, isin, name: "Ligne " + i }))];
  const transactions = [TX_ANCIEN, ...isins.map((isin, i) => tx("tx" + i, jourPlus("2016-01-01", i * 30), "achat", 1, 10, 10, 0, { position_id: "p" + i }))];
  const cours = [...coursDepuis("2021-10-20", 50), ...isins.flatMap(isin => coursDepuis("2021-10-20", 5).map(c => ({ ...c, isin })))];
  const yahoo = { ...YAHOO_JOUR, "ETFA.PA|max": CHART_MAX };
  isins.forEach((isin, i) => { yahoo["A" + i + ".PA|max"] = chart(jours("2015-01-05", 50, 30), () => 10); yahoo["A" + i + ".PA|5d"] = chart(jours("2026-10-12", 5), () => 10, 10); });
  const m = monter({ init: donnees({ instruments, positions, transactions, cours, snapshots: [], status: [] }), yahoo, aRattraper: [{ isin: ISIN, symbol: "ETFA.PA", currency: "EUR", nb_cours: 0 }, { isin: "FR9990000999", symbol: "ZZ.PA", currency: "EUR", nb_cours: 0 }] });
  const r = await m.appeler();
  assert.equal(r.corps.rattrapages.tentes, 10, "10 ISIN au plus");
  const max = m.chrono.filter(c => /\|max$/.test(c));
  assert.equal(max.length, 10);
  assert.deepEqual(max, isins.slice(0, 10).map((_, i) => "A" + i + ".PA|max"), "les dix mouvements les plus anciens d'abord, par ancienneté");
  assert.ok(!m.chrono.some(c => /^ETFA\.PA\|5y$|^ZZ\.PA/.test(c)), "la liste de la RPC attend la nuit suivante : les dix places sont prises par les cours anciens");
});
test("cours anciens : hors ligne, aucun appel externe (préproduction)", { skip: SANS_STRIP }, async () => {
  const m = monter({ init: ancien() });
  const I = null; void I;
  const env = ENV; env.BOUSSOLE_HORS_LIGNE = "1";
  try { await m.appeler(); } finally { delete env.BOUSSOLE_HORS_LIGNE; }
  assert.deepEqual(m.chrono.filter(c => /\|max$/.test(c)), []);
});

/* ================================================================== rétention des propositions (D7) */
const prop = (id, statut, decide, over = {}) => ({ id, user_id: U, cible: "historique", operation: "creer", ref: id, statut, decide_le: decide, source: "x", justification: null,
  apres: { type: "ordres", empreinte: "e".repeat(64), fichier: { nom: "avis.pdf" }, enveloppe: "PEA Exemple", donnees: { mouvements: [{ date: "2024-01-08", isin: ISIN }] }, lignes_a_creer: [], doublons: [], resume: { texte: "Ordres : 3 mouvements", mouvements: 3 }, avertissements: [] }, ...over });
test("rétention : 30 jours après leur décision, une proposition d'historique est réduite à { type, empreinte, resume } ; les autres ne sont pas touchées", { skip: SANS_STRIP }, async () => {
  const props = [prop("a1", "acceptee", "2026-09-10T10:00:00Z"), prop("r1", "refusee", "2026-09-01T10:00:00Z"), prop("recent", "acceptee", "2026-10-10T10:00:00Z"), prop("attente", "en_attente", null),
    prop("autre", "acceptee", "2026-08-01T10:00:00Z", { cible: "position", apres: { name: "x", donnees: { a: 1 } } }), prop("retrait", "acceptee", "2026-08-01T10:00:00Z", { operation: "supprimer", apres: null })];
  const m = monter({ init: donnees({ propositions: props, status: [] }) });
  const r = await m.appeler();
  sansErreurPhotos(r.corps);
  const p = id => m.db.tables.propositions.find(x => x.id === id);
  assert.deepEqual(plat(p("a1").apres), { type: "ordres", empreinte: "e".repeat(64), resume: { texte: "Ordres : 3 mouvements", mouvements: 3 } });
  assert.deepEqual(plat(p("r1").apres), { type: "ordres", empreinte: "e".repeat(64), resume: { texte: "Ordres : 3 mouvements", mouvements: 3 } });
  assert.ok(p("recent").apres.donnees, "décidée il y a 6 jours : intacte");
  assert.ok(p("attente").apres.donnees, "en attente : intacte");
  assert.ok(p("autre").apres.donnees, "autre cible : intacte");
  assert.equal(p("retrait").apres, null);
  assert.equal(r.corps.retention_propositions, 2);
  assert.equal(p("a1").statut, "acceptee");
  assert.equal(p("a1").decide_le, "2026-09-10T10:00:00Z");
  // idempotence : une seconde nuit ne retouche rien
  const m2 = monter({ init: m.db.tables });
  assert.equal((await m2.appeler()).corps.retention_propositions, 0);
  assert.deepEqual(plat(p("a1").apres.resume), plat(m2.db.tables.propositions.find(x => x.id === "a1").apres.resume));
});
test("rétention : 20 propositions au plus par nuit, le reste suit", { skip: SANS_STRIP }, async () => {
  const props = Array.from({ length: 25 }, (_, i) => prop("p" + i, "acceptee", "2026-08-01T10:00:00Z"));
  const m = monter({ init: donnees({ propositions: props, status: [] }) });
  assert.equal((await m.appeler()).corps.retention_propositions, 20);
  const m2 = monter({ init: m.db.tables });
  assert.equal((await m2.appeler()).corps.retention_propositions, 5);
  assert.ok(m2.db.tables.propositions.every(p => !p.apres.donnees));
});
