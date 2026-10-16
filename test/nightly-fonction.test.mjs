// Fonction nocturne supabase/functions/nightly (index.ts + cours.ts + binance.ts + frais.ts) exécutée dans un contexte vm (types retirés),
// avec une base en mémoire (client Supabase factice, clé de service simulée) et un `fetch` factice (Yahoo, Euronext, Binance).
// Couvre : clôtures du jour dans cours, rattrapage de 5 ans (Yahoo avec conversion par série de taux, repli Euronext), paquets,
// Binance (conditions d'activation, mise à jour, création, clôture, filtre user_id, erreurs traduites qui n'arrêtent pas la
// nuit, aucun secret dans les journaux ni la réponse), frais des fonds (Yahoo quoteSummary avec session et crumb, au plus 10 ISIN,
// budget de temps, jamais d'écrasement d'un TER non Yahoo, échecs en avertissements). Aucun appel réseau, aucun secret réel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import * as nodeModule from "node:module";
import vm from "node:vm";
import { modulesPhotos } from "./helpers/nightly-photos.mjs";

const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const lire = f => readFileSync(new URL("../supabase/functions/nightly/" + f, import.meta.url), "utf8");

/* ---------- valeurs factices ---------- */
const U = "11111111-1111-4111-8111-111111111111";
const AUTRE = "22222222-2222-4222-8222-222222222222";
const JETON_NUIT = "jeton-nuit-factice";
const CLE = "cle-binance-factice-KKKK", SECRET = "secret-binance-factice-SSSS";
const ENV_BASE = { SUPABASE_URL: "https://projet-factice.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "cle-service-factice" };
const MAINTENANT = new Date("2026-10-12T20:30:00Z");

/* ---------- chargement ---------- */
function chargerModule(source, contexte) {
  const noms = [...source.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" })
    .replace(/^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export (const|function|async function|class)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, contexte);
}
function charger(journaux) {
  const console_ = { log: (...a) => journaux.push(a.join(" ")), error: (...a) => journaux.push(a.join(" ")), warn: (...a) => journaux.push(a.join(" ")) };
  const G = { RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console: console_, isFinite, Infinity, NaN,
    TextEncoder, TextDecoder, Intl, crypto: globalThis.crypto, Error, TypeError, Boolean, parseInt, parseFloat, encodeURIComponent,
    decodeURIComponent, URL, URLSearchParams, Request, Response, Headers, AbortSignal, setTimeout, Uint8Array };
  const C = chargerModule(lire("cours.ts"), { ...G });
  const B = chargerModule(lire("binance.ts"), { ...G });
  const F = chargerModule(lire("frais.ts"), { ...G });
  const servis = [];
  const Deno = { env: { get: () => undefined }, serve: f => servis.push(f) };
  const client = B.client;
  const I = chargerModule(lire("index.ts"), { ...G, ...C, ...B, ...F, ...modulesPhotos(G), clientBinance: client, Deno, createClient: () => { throw new Error("client réel interdit en test"); } });
  return { I, handler: servis[0] };
}

/* ---------- base en mémoire ---------- */
const CLES = { instruments: ["isin"], positions: ["id"], cours: ["isin", "date"], fonctionnalites: ["user_id", "cle"] };
function fausseBase(init, rpc) {
  const tables = structuredClone(init);
  const journal = [];
  const lignes = t => (tables[t] ??= []);
  function from(table) {
    const q = { op: "select", filtres: [], val: null, opts: {} };
    const un = (r, [k, op, v]) => op === "eq" ? String(r[k]) === String(v) : op === "in" ? v.map(String).includes(String(r[k]))
      : op === "is" ? (v === "null" ? r[k] == null : String(r[k]) === v) : op === "or" ? v.some(f => un(r, f)) : true;
    const ok = r => q.filtres.every(f => un(r, f));
    const exec = () => {
      journal.push({ table, op: q.op, filtres: q.filtres, val: q.val });
      let data = null;
      if (q.op === "select") data = lignes(table).filter(ok).map(r => ({ ...r }));
      else if (q.op === "insert") {
        const rows = [].concat(q.val).map(r => ({ id: r.id ?? `nouvelle-${lignes(table).length + 1}`, created_at: MAINTENANT.toISOString(), ...r }));
        if (table === "positions") for (const r of rows) if (r.isin && !lignes("instruments").some(i => i.isin === r.isin)) return { data: null, error: { message: "clé étrangère isin" } };
        lignes(table).push(...rows); data = rows;
      } else if (q.op === "upsert") {
        const champs = q.opts.onConflict ? q.opts.onConflict.split(",").map(s => s.trim()) : CLES[table];
        const cle = r => champs.map(k => String(r[k])).join("|");
        const vus = new Set();
        const index = new Map(lignes(table).map((x, i) => [cle(x), i]));
        for (const r of [].concat(q.val)) {
          if (vus.has(cle(r))) return { data: null, error: { message: "ON CONFLICT DO UPDATE command cannot affect row a second time" } };
          vus.add(cle(r));
          if (table === "cours" && !(r.cloture > 0)) return { data: null, error: { message: "cours_cloture" } };
          const i = index.get(cle(r));
          if (i === undefined) { index.set(cle(r), lignes(table).length); lignes(table).push({ ...r }); }
          else if (!q.opts.ignoreDuplicates) lignes(table)[i] = { ...lignes(table)[i], ...r };
        }
      } else if (q.op === "update") { data = []; for (const r of lignes(table)) if (ok(r)) { Object.assign(r, q.val); data.push(r); } }
      return { data, error: null };
    };
    const b = {
      select: () => b, order: () => b,
      // HIS2 (photos.ts) : filtres et pages que ces tests n'exercent pas (tables vides) ; test/nightly-historique.test.mjs a sa propre base
      not: () => b, is: () => b, neq: () => b, lt: () => b, gte: () => b, limit: () => b, range: () => b, maybeSingle: () => b, delete: () => { q.op = "select"; return b; },
      eq: (k, v) => { q.filtres.push([k, "eq", v]); return b; }, in: (k, v) => { q.filtres.push([k, "in", v]); return b; },
      or: expr => { q.filtres.push(["", "or", expr.split(",").map(x => { const [k, op, ...v] = x.split("."); return [k, op, v.join(".")]; })]); return b; },
      insert: v => { q.op = "insert"; q.val = v; return b; }, upsert: (v, o = {}) => { q.op = "upsert"; q.val = v; q.opts = o; return b; },
      update: v => { q.op = "update"; q.val = v; return b; },
      then: (res, rej) => Promise.resolve().then(exec).then(res, rej),
    };
    return b;
  }
  return {
    tables, journal, from,
    rpc: async (nom, args) => { journal.push({ rpc: nom, args }); return rpc[nom] ? rpc[nom](args, tables) : { data: null, error: { message: `rpc ${nom} inconnue` } }; },
  };
}

/* ---------- réseau simulé ---------- */
const jours = (fin, n) => Array.from({ length: n }, (_, i) => { const d = new Date(fin + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - (n - 1 - i)); return d.toISOString().slice(0, 10); });
const chart = (currency, dates, prix, price = null) => ({ chart: { result: [{
  meta: { currency, regularMarketPrice: price ?? prix(dates.length - 1), regularMarketTime: Date.parse(dates[dates.length - 1] + "T15:30:00Z") / 1000 },
  timestamp: dates.map(d => Date.parse(d + "T07:00:00Z") / 1000),
  indicators: { quote: [{ close: dates.map((_, i) => prix(i)) }] },
}] } });
const rep = (c, s = 200) => new Response(typeof c === "string" ? c : JSON.stringify(c), { status: s, headers: { "Content-Type": "application/json" } });

// frais : symbole → réponse quoteSummary (objet) ou code HTTP (nombre) ; symbole absent → 404 « Not Found ». quoteSummary exige
// le cookie de session (fc.yahoo.com) et le crumb (v1/test/getcrumb) : sans eux, 401 « Invalid Crumb », comme Yahoo.
const COOKIE = "A3=cookie-factice", CRUMB = "crumb-factice";
function reseau({ binance = {}, yahoo = {}, frais = {} } = {}) {
  const appels = [];
  const f = async (url, init = {}) => {
    const u = new URL(String(url));
    appels.push({ url: String(url), hote: u.hostname, chemin: u.pathname, query: Object.fromEntries(u.searchParams), entetes: new Headers(init.headers || {}) });
    const cookie = new Headers(init.headers || {}).get("Cookie") || "";
    if (u.hostname === "fc.yahoo.com") return new Response("", { status: 404, headers: { "Set-Cookie": `${COOKIE}; Path=/; Domain=.yahoo.com` } });
    if (u.hostname === "query2.finance.yahoo.com" && u.pathname === "/v1/test/getcrumb") {
      return cookie.includes(COOKIE) ? new Response(CRUMB, { status: 200 }) : new Response("", { status: 401 });
    }
    if (u.hostname === "query2.finance.yahoo.com" && u.pathname.startsWith("/v10/finance/quoteSummary/")) {
      if (u.searchParams.get("crumb") !== CRUMB || !cookie.includes(COOKIE)) {
        return rep({ finance: { result: null, error: { code: "Unauthorized", description: "Invalid Crumb" } } }, 401);
      }
      const sym = decodeURIComponent(u.pathname.split("/").pop());
      if (frais[sym] === undefined) return rep({ quoteSummary: { result: null, error: { code: "Not Found", description: `Quote not found for symbol: ${sym}` } } }, 404);
      return typeof frais[sym] === "number" ? rep({}, frais[sym]) : rep(frais[sym]);
    }
    if (u.hostname === "query1.finance.yahoo.com") {
      const sym = decodeURIComponent(u.pathname.split("/").pop()), range = u.searchParams.get("range");
      const k = `${sym}|${range}`;
      if (yahoo[k] === undefined) return rep({ chart: { result: null, error: { description: "No data found" } } }, 404);
      return rep(yahoo[k]);
    }
    if (u.hostname === "live.euronext.com") {
      if (u.pathname.endsWith("/instrumentSearch/searchJSON")) return rep([{ isin: u.searchParams.get("q"), mic: "XPAR" }]);
      const n = Math.round((Date.parse(u.searchParams.get("enddate")) - Date.parse(u.searchParams.get("startdate"))) / 86400000);
      const ds = jours(u.searchParams.get("enddate"), Math.min(n, 1300)).reverse();
      return new Response("﻿\"Historical Data\"\nX\nDate;Open;High;Low;Last;Close;\"Number of Shares\"\n" +
        ds.map((d, i) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)};1;1;1;${60 - i * 0.01};${60 - i * 0.01};1`).join("\n"), { status: 200 });
    }
    if (u.hostname === "api.binance.com") {
      if (binance.panne) return rep({ code: binance.panne.code, msg: `refus ${CLE}` }, binance.panne.status);
      if (u.pathname === "/api/v3/time") return rep({ serverTime: MAINTENANT.getTime() });
      const brut = u.search.slice(1), i = brut.lastIndexOf("&signature=");
      if (i < 0 || createHmac("sha256", SECRET).update(brut.slice(0, i)).digest("hex") !== brut.slice(i + 11)) return rep({ code: -1022 }, 400);
      if (new Headers(init.headers || {}).get("X-MBX-APIKEY") !== CLE) return rep({ code: -2015 }, 401);
      if (u.pathname === "/api/v3/account") return rep({ balances: binance.soldes ?? [] });
      if (u.pathname.endsWith("/flexible/position")) return rep({ rows: binance.flexible ?? [], total: (binance.flexible ?? []).length });
      if (u.pathname.endsWith("/locked/position")) return rep({ rows: binance.verrouille ?? [], total: (binance.verrouille ?? []).length });
    }
    throw new Error("hôte inattendu " + u.hostname);
  };
  return { appels, fetch: f };
}

/* ---------- jeu de données ---------- */
const D5 = jours("2026-10-12", 5);
const D5Y = jours("2026-10-12", 1300);
const YAHOO = {
  "CW8.PA|5d": chart("EUR", D5, i => 500 + i),
  "AAPL|5d": chart("USD", D5, i => 200 + i),
  "USDEUR=X|5d": chart("USD", D5, () => 0.9, 0.9),
  "BTC-EUR|5d": chart("EUR", D5, i => 50000 + i),
  "ETH-EUR|5d": chart("EUR", D5, () => 2000),
  "SHIB-EUR|5d": chart("EUR", D5, () => 0.00001),
  "AAPL|5y": chart("USD", D5Y, i => 100 + i * 0.1),
  "USDEUR=X|5y": chart("USD", D5Y, i => (i < 650 ? 0.8 : 0.9)),
  "BTC-EUR|5y": chart("EUR", D5Y, i => 20000 + i),
};
function donnees({ binanceActifs = [U] } = {}) {
  return {
    instruments: [
      { isin: "FR0010315770", symbol: "CW8.PA", currency: "EUR", price: 490 },
      { isin: "FR0000120271", symbol: null, currency: "EUR", price: 55 },
      { isin: "US0378331005", symbol: "AAPL", currency: "USD", price: 180 },
      { isin: "X-BTC-EUR", symbol: "BTC-EUR", currency: "EUR", price: 49000 },
      { isin: "X-ADA", symbol: "ADA-EUR", currency: "EUR", price: 0.3 },
      { isin: "X-SANS", symbol: null, currency: "EUR", price: 1 },
    ],
    positions: [
      { id: "u-btc", user_id: U, name: "Bitcoin", envelope: "crypto (binance)", owner: "p1", bloc: "Crypto", mode: "market", isin: "X-BTC-EUR", qty: 0.01, status: "actif", source_auto: null, created_at: "2026-01-01" },
      { id: "u-ada", user_id: U, name: "Cardano", envelope: "Crypto (Binance)", owner: "p1", bloc: "Crypto", mode: "market", isin: "X-ADA", qty: 100, status: "actif", source_auto: "binance", created_at: "2026-01-02" },
      { id: "u-pea", user_id: U, name: "World", envelope: "PEA", owner: "p1", bloc: "Actions", mode: "market", isin: "FR0010315770", qty: 10, status: "actif", source_auto: null },
      { id: "a-btc", user_id: AUTRE, name: "Bitcoin", envelope: "Crypto (Binance)", owner: "p1", bloc: "Crypto", mode: "market", isin: "X-BTC-EUR", qty: 3, status: "actif", source_auto: "binance" },
      { id: "a-ada", user_id: AUTRE, name: "Cardano", envelope: "Crypto (Binance)", owner: "p1", bloc: "Crypto", mode: "market", isin: "X-ADA", qty: 7, status: "actif", source_auto: "binance" },
    ],
    cours: [],
    fonctionnalites: [
      ...binanceActifs.map(u => ({ user_id: u, cle: "binance", active: true })),
      { user_id: AUTRE, cle: "banque", active: true },
      ...(binanceActifs.includes(AUTRE) ? [] : [{ user_id: AUTRE, cle: "binance", active: false }]),
    ],
  };
}
const SOLDES = {
  soldes: [{ asset: "BTC", free: "0.4", locked: "0.05" }, { asset: "ETH", free: "0.5", locked: "0" }, { asset: "SHIB", free: "1000", locked: "0" },
    { asset: "LDBTC", free: "0.05", locked: "0" }],
  flexible: [], verrouille: [],
};

// horloge : temps écoulé simulé (ms) ; avance(appel, t) → nouveau temps (appelé à chaque requête réseau) ;
// delais : durées demandées pour les signaux d'abandon ; chrono : requêtes réseau et RPC dans l'ordre.
function monter({ env = { BINANCE_API_KEY: CLE, BINANCE_API_SECRET: SECRET }, init = donnees(), net = reseau({ binance: SOLDES, yahoo: YAHOO }), aRattraper,
  aFrais = [], avance = null, signal = null, rpcs = {}, casse = null } = {}) {
  const journaux = [];
  const chrono = [], delais = [], signaux = [];
  let t = 0;
  const { I, handler } = charger(journaux);
  const rpc = {
    check_nightly_token: async ({ p }) => ({ data: p === JETON_NUIT, error: null }),
    cours_a_rattraper: async ({ p_limite }) => ({ data: (aRattraper ?? [
      { isin: "FR0000120271", symbol: null, currency: "EUR", nb_cours: 0 },
      { isin: "US0378331005", symbol: "AAPL", currency: "USD", nb_cours: 5 },
      { isin: "X-SANS", symbol: null, currency: "EUR", nb_cours: 0 },
    ]).slice(0, p_limite), error: null }),
    frais_a_chercher: async ({ p_limite }) => ({ data: aFrais.slice(0, p_limite), error: null }),
    take_snapshots: async () => ({ data: 2, error: null }),
    apply_recurring: async () => ({ data: 0, error: null }),
    finish_nightly: async () => ({ data: null, error: null }),
    ...rpcs,
  };
  const db = fausseBase(init, rpc);
  const rpcBrut = db.rpc, fromBrut = db.from;
  db.rpc = async (nom, args) => { chrono.push(`rpc:${nom}`); return rpcBrut(nom, args); };
  db.from = table => { if (casse && casse(table)) throw new Error(`panne inattendue ${table}`); return fromBrut(table); };
  const ENV = { ...ENV_BASE, ...env };
  I.deps.createClient = () => db;
  I.deps.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    chrono.push(`net:${u.hostname}${u.pathname}${u.searchParams.get("range") ? "|" + u.searchParams.get("range") : ""}${u.searchParams.get("startdate") ? "|" + u.searchParams.get("startdate") : ""}`);
    signaux.push(init.signal);
    if (avance) t = avance(String(url), t) ?? t;
    return net.fetch(url, init);
  };
  I.deps.env = k => ENV[k];
  I.deps.maintenant = () => MAINTENANT;
  I.deps.horloge = () => t;
  I.deps.signal = ms => { delais.push(ms); return signal ? signal(ms) : new AbortController().signal; };
  I.deps.attendre = async () => {};
  const appeler = (jeton = JETON_NUIT) => handler(new Request("https://projet-factice.supabase.co/functions/v1/nightly", { method: "POST", headers: { Authorization: `Bearer ${jeton}` } }));
  return { db, net, journaux, appeler, chrono, delais, signaux };
}
const nomsRpc = m => m.db.journal.filter(j => j.rpc).map(j => j.rpc);
const sansSecret = (m, textes) => {
  for (const t of textes) for (const s of [CLE, SECRET, "signature="]) assert.ok(!t.includes(s), `secret « ${s} » trouvé dans : ${t.slice(0, 200)}`);
};

/* ================================================================== */
test("nuit : authentification inchangée (méthode, jeton)", { skip: SANS_STRIP }, async () => {
  const m = monter();
  assert.equal((await m.appeler("mauvais")).status, 401);
  assert.equal(m.net.appels.length, 0);
});

test("nuit complète : clôtures du jour dans cours, Binance appliqué, rattrapage 5 ans par paquets, aucun secret", { skip: SANS_STRIP }, async () => {
  const m = monter();
  const r = await m.appeler();
  assert.equal(r.status, 200);
  const corps = await r.json();
  const { tables, journal } = m.db;
  const ins = Object.fromEntries(tables.instruments.map(i => [i.isin, i]));
  const cours = isin => tables.cours.filter(c => c.isin === isin).sort((a, b) => a.date < b.date ? -1 : 1);

  // 1. cours du jour (instruments) et clôtures récentes (cours)
  assert.equal(ins.FR0010315770.price, 504);
  assert.equal(ins.FR0010315770.price_date, "2026-10-12");
  assert.equal(ins.US0378331005.price, 183.6, "204 USD × 0,9");
  assert.equal(ins.FR0000120271.source, "euronext");
  assert.equal(ins.FR0000120271.price, 60);
  assert.deepEqual(cours("FR0010315770").map(c => [c.date, c.cloture, c.source]), D5.map((d, i) => [d, 500 + i, "yahoo"]));
  assert.deepEqual(cours("X-BTC-EUR").map(c => c.cloture), [50000, 50001, 50002, 50003, 50004]);
  assert.equal(corps.cours_enregistres, 5 + 14 + 5 + 5, "CW8, Euronext (14 jours), AAPL, BTC");
  assert.ok(corps.errors.some(e => e.isin === "X-ADA" && /HTTP 404/.test(e.error)), "cours ADA introuvable signalé");

  // 2. Binance : BTC (0,45 + LDBTC 0,05) sur la ligne migrée X-BTC-EUR, ETH créée (1 000 €), SHIB ignoré (0,01 €), ADA clôturée
  const pos = Object.fromEntries(tables.positions.map(p => [p.id, p]));
  assert.equal(pos["u-btc"].qty, 0.5);
  assert.equal(pos["u-btc"].source_auto, "binance");
  assert.equal(pos["u-btc"].source_auto_le, MAINTENANT.toISOString());
  assert.equal(pos["u-ada"].status, "clôturé");
  const eth = tables.positions.find(p => p.isin === "X-ETH");
  assert.deepEqual({ ...eth, id: undefined, created_at: undefined }, { id: undefined, created_at: undefined, user_id: U, name: "Ether", envelope: "crypto (binance)",
    owner: "p1", bloc: "Crypto", mode: "market", isin: "X-ETH", qty: 0.5, status: "actif", source_auto: "binance", source_auto_le: MAINTENANT.toISOString() });
  assert.deepEqual({ isin: ins["X-ETH"].isin, symbol: ins["X-ETH"].symbol, price: ins["X-ETH"].price, currency: ins["X-ETH"].currency },
    { isin: "X-ETH", symbol: "ETH-EUR", price: 2000, currency: "EUR" });
  assert.ok(!tables.positions.some(p => /SHIB/.test(p.isin ?? "")), "petit solde ignoré");
  assert.deepEqual(corps.binance, { etat: "ok", mises_a_jour: 1, creees: 1, cloturees: 1, ignorees: 1, sans_cours: 0 });
  assert.equal(pos["a-btc"].qty, 3, "autre utilisateur intact");
  assert.equal(pos["a-ada"].status, "actif", "autre utilisateur intact");
  assert.equal(pos["u-pea"].qty, 10);
  for (const j of journal.filter(j => j.table === "positions")) {
    if (j.op === "insert") assert.equal(j.val.user_id, U);
    else assert.ok(j.filtres.some(([k, op, v]) => k === "user_id" && op === "eq" && v === U), `positions ${j.op} sans filtre user_id`);
  }

  // 3. rattrapage : Euronext 5 ans (sans symbole), Yahoo 5y converti avec la série USD→EUR, X-SANS en échec ; paquets de 500
  assert.deepEqual(corps.rattrapages, { tentes: 3, reussis: 2, lignes: 2600 });
  assert.equal(cours("FR0000120271").length, 1300);
  const aapl = cours("US0378331005");
  assert.equal(aapl.length, 1300);
  assert.equal(aapl[0].cloture, 80, "100 USD × 0,8 (taux de l'époque)");
  assert.equal(aapl[1299].cloture, 206.91, "229,9 USD × 0,9");
  const yahoo5y = m.net.appels.filter(a => a.hote === "query1.finance.yahoo.com" && a.query.range === "5y").map(a => a.chemin.split("/").pop());
  assert.deepEqual(yahoo5y.sort(), ["AAPL", "USDEUR%3DX"].sort());
  assert.ok(m.net.appels.some(a => a.hote === "live.euronext.com" && a.query.startdate === "2021-10-11" && a.query.enddate === "2026-10-12"), "Euronext sur 5 ans");
  const tailles = journal.filter(j => j.table === "cours" && j.op === "upsert").map(j => j.val.length);
  assert.ok(tailles.every(n => n <= 500), "paquets de 500 au plus");
  assert.deepEqual(tailles.slice(-3), [500, 500, 300]);
  for (const isin of ["FR0000120271", "US0378331005", "X-SANS"]) assert.equal(ins[isin].cours_rattrapage_le, MAINTENANT.toISOString(), isin);
  assert.ok(corps.errors.some(e => e.isin === "X-SANS" && /rattrapage : yahoo: sans symbole/.test(e.error)));

  // 4. suite de la nuit et aucun secret
  const rpcs = journal.filter(j => j.rpc).map(j => j.rpc);
  assert.deepEqual(rpcs, ["check_nightly_token", "take_snapshots", "apply_recurring", "take_snapshots", "cours_a_rattraper", "frais_a_chercher", "finish_nightly"]);
  assert.equal(journal.find(j => j.rpc === "cours_a_rattraper").args.p_limite, 10);
  const binance = m.net.appels.filter(a => a.hote === "api.binance.com");
  assert.deepEqual(binance.map(a => a.chemin), ["/api/v3/time", "/api/v3/account", "/sapi/v1/simple-earn/flexible/position", "/sapi/v1/simple-earn/locked/position"]);
  assert.ok(binance.slice(1).every(a => a.entetes.get("X-MBX-APIKEY") === CLE && a.query.recvWindow === "10000" && /^[0-9a-f]{64}$/.test(a.query.signature)));
  assert.ok(m.net.appels.filter(a => a.hote !== "api.binance.com").every(a => !a.entetes.has("X-MBX-APIKEY")), "la clé ne part que chez Binance");
  const finale = journal.find(j => j.rpc === "finish_nightly").args;
  sansSecret(m, [...m.journaux, JSON.stringify(corps), JSON.stringify(finale)]);
});

test("Binance en erreur (clé refusée) : message traduit, lignes intactes, le reste de la nuit continue, aucun secret", { skip: SANS_STRIP }, async () => {
  const m = monter({ net: reseau({ binance: { panne: { status: 401, code: -2015 } }, yahoo: YAHOO }) });
  const corps = await (await m.appeler()).json();
  assert.equal(corps.ok, true);
  assert.equal(corps.binance.etat, "erreur");
  assert.ok(corps.errors.some(e => /^binance : Binance refuse la clé API/.test(e.error)));
  const pos = Object.fromEntries(m.db.tables.positions.map(p => [p.id, p]));
  assert.equal(pos["u-btc"].qty, 0.01);
  assert.equal(pos["u-ada"].status, "actif");
  assert.equal(corps.rattrapages.tentes, 3, "rattrapage effectué malgré l'erreur Binance");
  assert.deepEqual(nomsRpc(m).slice(-5), ["apply_recurring", "take_snapshots", "cours_a_rattraper", "frais_a_chercher", "finish_nightly"]);
  sansSecret(m, [...m.journaux, JSON.stringify(corps)]);
});

test("Binance : sans secrets, sans utilisateur actif ou avec deux utilisateurs actifs → aucun appel Binance", { skip: SANS_STRIP }, async () => {
  const sansSecrets = monter({ env: {} });
  let corps = await (await sansSecrets.appeler()).json();
  assert.deepEqual(corps.binance, { etat: "non configuré" });
  assert.equal(sansSecrets.net.appels.filter(a => a.hote === "api.binance.com").length, 0);
  const unSeul = monter({ env: { BINANCE_API_KEY: CLE } });
  assert.deepEqual((await (await unSeul.appeler()).json()).binance, { etat: "non configuré" });
  const inactif = monter({ init: donnees({ binanceActifs: [] }) });
  corps = await (await inactif.appeler()).json();
  assert.deepEqual(corps.binance, { etat: "inactif" });
  assert.equal(inactif.net.appels.filter(a => a.hote === "api.binance.com").length, 0);
  const deux = monter({ init: donnees({ binanceActifs: [U, AUTRE] }) });
  corps = await (await deux.appeler()).json();
  assert.deepEqual(corps.binance, { etat: "suspendu" });
  assert.ok(corps.errors.some(e => /plusieurs utilisateurs/.test(e.error)));
  assert.equal(deux.net.appels.filter(a => a.hote === "api.binance.com").length, 0);
  assert.equal(Object.fromEntries(deux.db.tables.positions.map(p => [p.id, p]))["u-ada"].status, "actif");
});

test("Binance : portefeuille vide → aucune clôture (prudence), avertissement ; Earn compté ; LD converti", { skip: SANS_STRIP }, async () => {
  const vide = monter({ net: reseau({ binance: { soldes: [] }, yahoo: YAHOO }) });
  const corps = await (await vide.appeler()).json();
  assert.equal(corps.binance.cloturees, 0);
  assert.ok(corps.avertissements.some(a => /portefeuille vide/.test(a)), "avertissement, pas une erreur");
  assert.ok(!corps.errors.some(e => /portefeuille vide/.test(e.error)));
  assert.equal(vide.db.tables.positions.find(p => p.id === "u-ada").status, "actif");
  const earn = monter({ net: reseau({ binance: { soldes: [{ asset: "LDBTC", free: "0.2", locked: "0" }], flexible: [{ asset: "BTC", totalAmount: "0.2" }],
    verrouille: [{ asset: "BTC", amount: "0.3" }, { asset: "ADA", amount: "50" }] }, yahoo: YAHOO }) });
  const c2 = await (await earn.appeler()).json();
  const pos = Object.fromEntries(earn.db.tables.positions.map(p => [p.id, p]));
  assert.equal(pos["u-btc"].qty, 0.5, "0,2 flexible (LDBTC non recompté) + 0,3 verrouillé");
  assert.equal(pos["u-ada"].qty, 50);
  assert.equal(pos["u-ada"].status, "actif");
  assert.equal(c2.binance.cloturees, 0);
});

test("rattrapage : au plus 10 ISIN par nuit, Yahoo range=5y&interval=1d sur le symbole résolu", { skip: SANS_STRIP }, async () => {
  const liste = Array.from({ length: 12 }, (_, i) => ({ isin: `X-T${i}`, symbol: "BTC-EUR", currency: "EUR", nb_cours: 0 }));
  const m = monter({ env: {}, aRattraper: liste });
  const corps = await (await m.appeler()).json();
  assert.equal(corps.rattrapages.tentes, 10);
  const appels = m.net.appels.filter(a => a.query.range === "5y");
  assert.equal(appels.length, 10);
  assert.ok(appels.every(a => a.chemin.endsWith("/v8/finance/chart/BTC-EUR") && a.query.interval === "1d"));
  assert.equal(m.db.tables.cours.filter(c => c.isin === "X-T0").length, 1300);
  assert.equal(m.db.tables.cours.find(c => c.isin === "X-T0" && c.date === D5Y[0]).cloture, 20000);
});

/* ================== ordre, délais, budget de temps, avertissements ================== */
// Phase d'une entrée du chrono : cours du jour, Binance (y compris les cours des actifs à créer), rattrapage (5 ans), RPC.
const RATTRAPAGE_DEBUT = "2021-10-11";
function phases(chrono) {
  const out = [];
  for (const c of chrono) {
    let p;
    if (c === "rpc:check_nightly_token") continue;
    if (c.startsWith("rpc:")) p = c;
    else if (c.includes("api.binance.com") || /\/(ETH|SHIB)-EUR\|5d$/.test(c)) p = "binance";
    else if (c.includes("|5y") || c.includes(`|${RATTRAPAGE_DEBUT}`)) p = "rattrapage";
    else p = "cours";
    if (out[out.length - 1] !== p) out.push(p);
  }
  return out;
}

test("ordre : cours du jour → photo → versements → photo → Binance → rattrapage → frais des fonds → finish_nightly", { skip: SANS_STRIP }, async () => {
  const m = monter();
  const corps = await (await m.appeler()).json();
  assert.equal(corps.binance.etat, "ok");
  assert.equal(corps.rattrapages.tentes, 3);
  assert.deepEqual(phases(m.chrono), ["cours", "rpc:take_snapshots", "rpc:apply_recurring", "rpc:take_snapshots", "binance",
    "rpc:cours_a_rattraper", "rattrapage", "rpc:frais_a_chercher", "rpc:finish_nightly"]);
});

test("finish_nightly toujours exécuté : Binance lève une erreur inattendue", { skip: SANS_STRIP }, async () => {
  const m = monter({ casse: t => t === "fonctionnalites" });
  const r = await m.appeler();
  assert.equal(r.status, 200);
  const corps = await r.json();
  assert.equal(corps.binance.etat, "erreur");
  assert.ok(corps.errors.some(e => /^binance : erreur inattendue/.test(e.error)));
  assert.equal(corps.rattrapages.tentes, 3, "le rattrapage suit");
  assert.deepEqual(nomsRpc(m).slice(1), ["take_snapshots", "apply_recurring", "take_snapshots", "cours_a_rattraper", "frais_a_chercher", "finish_nightly"]);
});

test("finish_nightly toujours exécuté : le rattrapage lève (RPC en panne, upsert qui lève)", { skip: SANS_STRIP }, async () => {
  const m = monter({ rpcs: { cours_a_rattraper: async () => { throw new Error("connexion perdue"); } } });
  const corps = await (await m.appeler()).json();
  assert.ok(corps.errors.some(e => /rattrapage/.test(e.error) && /connexion perdue/.test(e.error)));
  assert.equal(nomsRpc(m).at(-1), "finish_nightly");
  const fin = m.db.journal.find(j => j.rpc === "finish_nightly").args;
  assert.ok(fin.p_errors.some(e => /connexion perdue/.test(e.error)), "l'erreur figure dans job_runs");

  // l'écriture des cours rattrapés lève : finish_nightly quand même
  let upserts = 0;
  const m2 = monter({ env: {}, casse: t => t === "cours" && ++upserts > 1 });
  const c2 = await (await m2.appeler()).json();
  assert.equal(nomsRpc(m2).at(-1), "finish_nightly");
  assert.ok(c2.errors.length > 0);
});

test("finish_nightly toujours exécuté : la photo lève", { skip: SANS_STRIP }, async () => {
  const m = monter({ rpcs: { take_snapshots: async () => { throw new Error("photo impossible"); } } });
  const corps = await (await m.appeler()).json();
  assert.ok(corps.errors.some(e => /take_snapshots/.test(e.error) && /photo impossible/.test(e.error)));
  assert.ok(nomsRpc(m).includes("apply_recurring"), "les versements passent malgré la photo en échec");
  assert.equal(nomsRpc(m).at(-1), "finish_nightly");
});

test("délais : chaque appel Yahoo, Euronext et Binance porte un signal de 10 s au plus ; un appel bloqué est coupé, la nuit continue", { skip: SANS_STRIP }, async () => {
  const base = reseau({ binance: SOLDES, yahoo: YAHOO });
  const bloque = init => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)));
  let premier429 = true;
  const net = { appels: base.appels, fetch: async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/CW8.PA") || u.pathname === "/api/v3/account") return bloque(init); // Yahoo et Binance muets
    if (u.pathname.endsWith("/AAPL") && u.searchParams.get("range") === "5d" && premier429) { premier429 = false; return rep({}, 429); }
    if (u.hostname === "fc.yahoo.com") return new Response("", { status: 404 });
    return base.fetch(url, init);
  } };
  // Minuterie « tenue » (pas AbortSignal.timeout, dont la minuterie ne retient pas la boucle d'événements sous Node 22 : le test
  // serait annulé avant la fin de l'appel bloqué).
  const signal = ms => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException("délai", "TimeoutError")), Math.min(ms, 20)); return c.signal; };
  const m = monter({ net, signal });
  const corps = await (await m.appeler()).json();
  assert.ok(m.signaux.length > 10);
  assert.ok(m.signaux.every(s => s instanceof AbortSignal), "un signal sur chaque appel");
  assert.ok(m.delais.length >= m.signaux.length && m.delais.every(ms => ms > 0 && ms <= 10_000), JSON.stringify(m.delais));
  assert.ok(m.delais.includes(10_000));
  assert.ok(m.chrono.some(c => c.includes("fc.yahoo.com")), "session Yahoo ouverte sous délai");
  const ins = Object.fromEntries(m.db.tables.instruments.map(i => [i.isin, i]));
  assert.equal(ins.FR0010315770.source, "euronext", "Yahoo coupé → repli Euronext");
  assert.equal(corps.binance.etat, "erreur");
  assert.ok(corps.errors.some(e => /binance : Binance est injoignable/.test(e.error)));
  assert.equal(nomsRpc(m).at(-1), "finish_nightly");
});

test("budget : la boucle des cours du jour s'arrête vers 70 s, les cours restants sont reportés", { skip: SANS_STRIP }, async () => {
  const m = monter({ avance: (url, t) => (url.includes("/CW8.PA?") ? 75_000 : t) });
  const corps = await (await m.appeler()).json();
  const ins = Object.fromEntries(m.db.tables.instruments.map(i => [i.isin, i]));
  assert.equal(ins.FR0010315770.price, 504, "cours commencé avant la limite : appliqué");
  assert.equal(ins.FR0000120271.price, 55, "cours reporté");
  for (const isin of ["FR0000120271", "US0378331005", "X-BTC-EUR", "X-ADA"])
    assert.ok(corps.errors.some(e => e.isin === isin && /temps dépassé/.test(e.error)), isin);
  const avantPhoto = m.chrono.slice(0, m.chrono.indexOf("rpc:take_snapshots"));
  assert.deepEqual(avantPhoto.filter(c => c.startsWith("net:")), ["net:query1.finance.yahoo.com/v8/finance/chart/CW8.PA|5d"]);
  assert.deepEqual(nomsRpc(m).slice(1, 4), ["take_snapshots", "apply_recurring", "take_snapshots"]);
  assert.equal(corps.binance.etat, "ok", "75 s : Binance a encore le temps");
  assert.equal(nomsRpc(m).at(-1), "finish_nightly");
});

test("budget : Binance reporté et noté quand le temps restant ne suffit pas", { skip: SANS_STRIP }, async () => {
  const m = monter({ avance: (url, t) => (url.includes("/CW8.PA?") ? 95_000 : t) });
  const corps = await (await m.appeler()).json();
  assert.equal(corps.binance.etat, "reporté");
  assert.equal(m.net.appels.filter(a => a.hote === "api.binance.com").length, 0);
  assert.ok(corps.avertissements.some(a => /binance/i.test(a) && /report/.test(a)));
  assert.ok(!corps.errors.some(e => /binance/i.test(e.error)), "report noté en avertissement, pas en erreur");
  assert.equal(m.db.tables.positions.find(p => p.id === "u-ada").status, "actif");
  assert.deepEqual(nomsRpc(m).slice(1, 4), ["take_snapshots", "apply_recurring", "take_snapshots"]);
  assert.equal(nomsRpc(m).at(-1), "finish_nightly");
});

test("budget : rattrapage arrêté vers 110 s (aucun nouveau au-delà), appels plafonnés, reste reporté", { skip: SANS_STRIP }, async () => {
  const aRattraper = [
    { isin: "US0378331005", symbol: "AAPL", currency: "USD", nb_cours: 5 },
    { isin: "FR0000120271", symbol: null, currency: "EUR", nb_cours: 0 },
  ];
  const m = monter({ env: {}, aRattraper, avance: (url, t) => (url.includes("/AAPL?range=5y") ? 113_000 : t) });
  const corps = await (await m.appeler()).json();
  assert.deepEqual(corps.rattrapages, { tentes: 1, reussis: 1, lignes: 1300 });
  assert.ok(!m.chrono.some(c => c.includes(`|${RATTRAPAGE_DEBUT}`)), "aucun rattrapage commencé après 110 s");
  const ins = Object.fromEntries(m.db.tables.instruments.map(i => [i.isin, i]));
  assert.equal(ins.FR0000120271.cours_rattrapage_le, undefined, "non tenté : reste à rattraper");
  assert.ok(corps.avertissements.some(a => /rattrapage/.test(a) && /1 ISIN/.test(a)));
  assert.ok(!corps.errors.some(e => /rattrapage/.test(e.error)));
  // la série de taux USD→EUR est demandée à 113 s : délai ramené à ce qui reste avant la limite des appels (120 s)
  assert.equal(m.delais.at(-1), 7_000);
  assert.equal(nomsRpc(m).at(-1), "finish_nightly");
});

test("avertissements Binance non bloquants : séparés des erreurs, job_runs.ok reste vrai", { skip: SANS_STRIP }, async () => {
  const init = donnees();
  init.instruments = init.instruments.filter(i => ["FR0010315770", "X-BTC-EUR", "X-ADA"].includes(i.isin));
  init.instruments.find(i => i.isin === "X-ADA").symbol = null; // pas de cours à chercher
  init.positions.push({ id: "u-btc2", user_id: U, name: "Bitcoin bis", envelope: "Crypto (Binance)", owner: "p1", bloc: "Crypto", mode: "market",
    isin: "X-BTC", qty: 0.2, status: "actif", source_auto: null, created_at: "2026-02-01" });
  const net = reseau({ binance: { soldes: [{ asset: "BTC", free: "0.5", locked: "0" }, { asset: "ADA", free: "10", locked: "0" }] }, yahoo: YAHOO });
  const m = monter({ init, net, aRattraper: [] });
  const corps = await (await m.appeler()).json();
  assert.deepEqual(corps.errors, []);
  assert.ok(corps.avertissements.some(a => /plusieurs lignes BTC/.test(a)));
  assert.equal(corps.ok, true);
  const fin = m.db.journal.find(j => j.rpc === "finish_nightly").args;
  assert.equal(fin.p_errors.length, 0, "job_runs.ok = (aucune erreur)");
});

/* ================== frais des fonds (CP4 § 2) ================== */
const QS = (raw, fmt) => ({ quoteSummary: { result: [{ fundProfile: { feesExpensesInvestment: { annualReportExpenseRatio: fmt ? { raw, fmt } : { raw } } },
  defaultKeyStatistics: { annualReportExpenseRatio: {} } }], error: null } });
const FRAIS = { "CW8.PA": QS(0.0038, "0.38%"), "IWDA.AS": QS(0.002, "0.20%"), "MEUD.PA": QS(0.0007, "0.07%") }; // PSP5.PA : introuvable
function donneesFrais() {
  return {
    instruments: [
      { isin: "FR0010315770", symbol: "CW8.PA", currency: "EUR", price: 490, ter: null, ter_source: null },
      { isin: "IE00B4L5Y983", symbol: "IWDA.AS", currency: "EUR", price: 100, ter: null, ter_source: null },
      { isin: "LU0908500753", symbol: "MEUD.PA", currency: "EUR", price: 250, ter: 0.2, ter_source: "yahoo", ter_le: "2026-01-01", ter_essai_le: "2026-01-01T20:31:00Z" },
      { isin: "FR0011871128", symbol: "PSP5.PA", currency: "EUR", price: 40, ter: null, ter_source: null },
      { isin: "LU1681043599", symbol: "CW8D.PA", currency: "EUR", price: 400, ter: 0.12, ter_source: "dic", ter_le: "2026-10-12" },
    ],
    positions: [], cours: [], fonctionnalites: [],
  };
}
const A_FRAIS = [{ isin: "FR0010315770", symbol: "CW8.PA" }, { isin: "IE00B4L5Y983", symbol: "IWDA.AS" }, { isin: "LU0908500753", symbol: "MEUD.PA" },
  { isin: "FR0011871128", symbol: "PSP5.PA" }];
const montageFrais = (o = {}) => monter({ env: {}, init: donneesFrais(), net: reseau({ yahoo: YAHOO, frais: FRAIS }), aRattraper: [], aFrais: A_FRAIS, ...o });
const quoteSummary = m => m.net.appels.filter(a => a.chemin.startsWith("/v10/finance/quoteSummary/"));
const instr = m => Object.fromEntries(m.db.tables.instruments.map(i => [i.isin, i]));

test("frais des fonds : quoteSummary (session et crumb), TER écrit en % par an, ter_source yahoo, ter_le, ter_essai_le", { skip: SANS_STRIP }, async () => {
  const m = montageFrais();
  const corps = await (await m.appeler()).json();
  assert.deepEqual(corps.frais, { tentes: 4, trouves: 3 });
  const ins = instr(m);
  const essai = MAINTENANT.toISOString();
  assert.deepEqual([ins.FR0010315770.ter, ins.FR0010315770.ter_source, ins.FR0010315770.ter_le, ins.FR0010315770.ter_essai_le], [0.38, "yahoo", "2026-10-12", essai]);
  assert.deepEqual([ins.IE00B4L5Y983.ter, ins.IE00B4L5Y983.ter_source, ins.IE00B4L5Y983.ter_le], [0.2, "yahoo", "2026-10-12"]);
  assert.deepEqual([ins.LU0908500753.ter, ins.LU0908500753.ter_le, ins.LU0908500753.ter_essai_le], [0.07, "2026-10-12", essai], "TER Yahoo ancien rafraîchi");
  assert.deepEqual([ins.FR0011871128.ter, ins.FR0011871128.ter_source, ins.FR0011871128.ter_le, ins.FR0011871128.ter_essai_le], [null, null, undefined, essai],
    "introuvable : essai noté (nouvel essai dans 30 jours), rien d'autre");
  assert.deepEqual([ins.LU1681043599.ter, ins.LU1681043599.ter_source, ins.LU1681043599.ter_essai_le], [0.12, "dic", undefined], "hors liste : intact");

  // appels : query2 quoteSummary, modules fundProfile et defaultKeyStatistics ; session ouverte une fois, crumb et cookie ensuite
  const qs = quoteSummary(m);
  assert.ok(qs.every(a => a.hote === "query2.finance.yahoo.com" && a.query.modules === "fundProfile,defaultKeyStatistics"));
  const avecCrumb = qs.filter(a => a.query.crumb === CRUMB);
  assert.deepEqual(avecCrumb.map(a => a.chemin.split("/").pop()), ["CW8.PA", "IWDA.AS", "MEUD.PA", "PSP5.PA"]);
  assert.ok(avecCrumb.every(a => a.entetes.get("Cookie") === COOKIE));
  assert.equal(m.net.appels.filter(a => a.hote === "fc.yahoo.com").length, 1, "une seule session");
  assert.equal(m.net.appels.filter(a => a.chemin === "/v1/test/getcrumb").length, 1);

  // échec : avertissement (non bloquant), jamais une erreur de la nuit
  assert.ok(corps.avertissements.some(a => /frais/.test(a) && /FR0011871128/.test(a)), JSON.stringify(corps.avertissements));
  assert.ok(!corps.errors.some(e => /frais/.test(e.error)), JSON.stringify(corps.errors));
  assert.equal(corps.ok, true);
  const fin = m.db.journal.find(j => j.rpc === "finish_nightly").args;
  assert.ok(!fin.p_errors.some(e => /frais/.test(e.error)));
  // ordre : après le rattrapage, avant finish_nightly ; p_limite = 10
  assert.deepEqual(nomsRpc(m).slice(-3), ["cours_a_rattraper", "frais_a_chercher", "finish_nightly"]);
  assert.equal(m.db.journal.find(j => j.rpc === "frais_a_chercher").args.p_limite, 10);
  const premierFrais = m.chrono.findIndex(c => c.includes("quoteSummary"));
  assert.ok(premierFrais > m.chrono.indexOf("rpc:frais_a_chercher") && premierFrais < m.chrono.indexOf("rpc:finish_nightly"));
});

test("frais des fonds : un TER d'une autre source (DIC renseigné par Claude) n'est jamais écrasé", { skip: SANS_STRIP }, async () => {
  // l'instrument a été annoté depuis la sélection (course) : l'écriture filtre ter nul ou ter_source = yahoo
  const m = montageFrais({ aFrais: [{ isin: "LU1681043599", symbol: "CW8D.PA" }], net: reseau({ yahoo: YAHOO, frais: { "CW8D.PA": QS(0.0045, "0.45%") } }) });
  const corps = await (await m.appeler()).json();
  const ins = instr(m).LU1681043599;
  assert.deepEqual([ins.ter, ins.ter_source, ins.ter_le], [0.12, "dic", "2026-10-12"]);
  assert.equal(ins.ter_essai_le, MAINTENANT.toISOString(), "essai noté quand même");
  assert.deepEqual(corps.frais, { tentes: 1, trouves: 1 });
  const ecriture = m.db.journal.find(j => j.table === "instruments" && j.op === "update" && j.val && "ter" in j.val);
  assert.ok(ecriture.filtres.some(([, op, v]) => op === "or" && JSON.stringify(v) === JSON.stringify([["ter", "is", "null"], ["ter_source", "eq", "yahoo"]])),
    JSON.stringify(ecriture.filtres));
});

test("frais des fonds : un TER de DIC de plus de 365 jours est remplacé par Yahoo si l'écart dépasse 50 % ; sinon le DIC est gardé", { skip: SANS_STRIP }, async () => {
  const init = donneesFrais();
  init.instruments.push(
    { isin: "IE00B3RBWM25", symbol: "EIMI.L", currency: "EUR", price: 30, ter: 0.12, ter_source: "dic", ter_le: "2025-09-01", ter_par: "u-annot" },
    { isin: "IE00BK5BQT80", symbol: "VWCE.DE", currency: "EUR", price: 120, ter: 0.2, ter_source: "dic", ter_le: "2025-09-01", ter_par: "u-annot" });
  const aFrais = [{ isin: "IE00B3RBWM25", symbol: "EIMI.L", ter: 0.12, ter_source: "dic", ter_le: "2025-09-01" },
    { isin: "IE00BK5BQT80", symbol: "VWCE.DE", ter: 0.2, ter_source: "dic", ter_le: "2025-09-01" }];
  const m = montageFrais({ init, aFrais, net: reseau({ yahoo: YAHOO, frais: { "EIMI.L": QS(0.0025, "0.25%"), "VWCE.DE": QS(0.0022, "0.22%") } }) });
  const corps = await (await m.appeler()).json();
  const ins = instr(m);
  assert.deepEqual([ins.IE00B3RBWM25.ter, ins.IE00B3RBWM25.ter_source, ins.IE00B3RBWM25.ter_le, ins.IE00B3RBWM25.ter_par], [0.25, "yahoo", "2026-10-12", null],
    "DIC de 406 jours, écart de 108 % : remplacé par Yahoo (annotateur effacé)");
  assert.deepEqual([ins.IE00BK5BQT80.ter, ins.IE00BK5BQT80.ter_source, ins.IE00BK5BQT80.ter_le, ins.IE00BK5BQT80.ter_par], [0.2, "dic", "2025-09-01", "u-annot"], "écart de 10 % : DIC gardé");
  assert.equal(ins.IE00BK5BQT80.ter_essai_le, MAINTENANT.toISOString(), "essai noté");
  const ecriture = m.db.journal.find(j => j.table === "instruments" && j.op === "update" && j.val && "ter" in j.val);
  assert.deepEqual(JSON.parse(JSON.stringify(ecriture.filtres.filter(([k]) => ["isin", "ter_source", "ter_le"].includes(k)))), [["isin", "eq", "IE00B3RBWM25"], ["ter_source", "eq", "dic"], ["ter_le", "eq", "2025-09-01"]],
    "remplacement gardé contre une annotation faite entre-temps");
  assert.ok(corps.avertissements.some(a => /IE00BK5BQT80/.test(a) && /DIC gardé/.test(a)), JSON.stringify(corps.avertissements));
  assert.ok(!corps.errors.some(e => /frais/.test(e.error)));
});

test("frais des fonds : au plus 10 ISIN par nuit ; ISIN de test X-… et sans symbole ignorés", { skip: SANS_STRIP }, async () => {
  const liste = [{ isin: "X-BTC", symbol: "BTC-EUR" }, { isin: "FR0000000001", symbol: null },
    ...Array.from({ length: 12 }, (_, i) => ({ isin: `IE00000000${String(i).padStart(2, "0")}`, symbol: `F${i}.PA` }))];
  const frais = Object.fromEntries(liste.map(x => [x.symbol, QS(0.001, "0.10%")]));
  const init = donneesFrais();
  init.instruments.push(...liste.map(x => ({ isin: x.isin, symbol: null, currency: "USD", price: 1 })));
  const m = montageFrais({ init, net: reseau({ yahoo: YAHOO, frais }), rpcs: { frais_a_chercher: async () => ({ data: liste, error: null }) } });
  const corps = await (await m.appeler()).json();
  assert.equal(corps.frais.tentes, 10);
  const syms = [...new Set(quoteSummary(m).map(a => a.chemin.split("/").pop()))];
  assert.equal(syms.length, 10);
  assert.ok(!syms.includes("BTC-EUR"));
  assert.equal(instr(m)["X-BTC"].ter_essai_le, undefined);
});

test("frais des fonds : budget — rien après ~120 s, appels plafonnés à 125 s, reste reporté (avertissement)", { skip: SANS_STRIP }, async () => {
  // rattrapage terminé à 121 s : étape reportée, sans appel ni RPC
  const tard = montageFrais({ aRattraper: [{ isin: "US0378331005", symbol: "AAPL", currency: "USD", nb_cours: 0 }],
    avance: (url, t) => (url.includes("/AAPL?range=5y") ? 121_000 : t) });
  const c1 = await (await tard.appeler()).json();
  assert.equal(quoteSummary(tard).length, 0);
  assert.ok(!nomsRpc(tard).includes("frais_a_chercher"));
  assert.ok(c1.avertissements.some(a => /frais des fonds/.test(a) && /report/.test(a)));
  assert.deepEqual(c1.frais, { tentes: 0, trouves: 0 });
  assert.equal(nomsRpc(tard).at(-1), "finish_nightly");

  // 117 s au premier appel, 121 s au deuxième ISIN : délais ramenés à ce qui reste avant 125 s, puis arrêt
  const m = montageFrais({ avance: (url, t) => (url.includes("quoteSummary/CW8.PA") && !url.includes("crumb") ? 117_000 : url.includes("quoteSummary/IWDA.AS") ? 121_000 : t) });
  const corps = await (await m.appeler()).json();
  assert.equal(corps.frais.tentes, 2);
  assert.ok(m.delais.every(ms => ms > 0 && ms <= 10_000));
  assert.ok(m.delais.includes(8_000), JSON.stringify(m.delais));
  assert.ok(m.delais.includes(4_000), JSON.stringify(m.delais));
  assert.ok(!quoteSummary(m).some(a => /MEUD|PSP5/.test(a.chemin)), "aucun nouvel ISIN après 120 s");
  assert.ok(corps.avertissements.some(a => /frais des fonds/.test(a) && /2 ISIN/.test(a)), JSON.stringify(corps.avertissements));
  assert.equal(instr(m).LU0908500753.ter_essai_le, "2026-01-01T20:31:00Z", "non tenté : inchangé");
  assert.ok(!corps.errors.some(e => /frais/.test(e.error)));
  assert.equal(nomsRpc(m).at(-1), "finish_nightly");
});

test("frais des fonds : appel bloqué coupé (signal injecté), HTTP 500, RPC en panne → avertissements, la nuit continue", { skip: SANS_STRIP }, async () => {
  const base = reseau({ yahoo: YAHOO, frais: { ...FRAIS, "MEUD.PA": 500 } });
  const net = { appels: base.appels, fetch: async (url, init = {}) => {
    if (String(url).includes("quoteSummary/CW8.PA") && String(url).includes("crumb=")) {
      return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)));
    }
    return base.fetch(url, init);
  } };
  // minuterie tenue (pas AbortSignal.timeout : sous Node 22, sa minuterie ne retient pas la boucle d'événements)
  const signal = ms => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException("délai", "TimeoutError")), Math.min(ms, 20)); return c.signal; };
  const m = montageFrais({ net, signal });
  const corps = await (await m.appeler()).json();
  const ins = instr(m);
  assert.equal(ins.FR0010315770.ter, null);
  assert.equal(ins.FR0010315770.ter_essai_le, MAINTENANT.toISOString(), "échec : essai noté");
  assert.equal(ins.IE00B4L5Y983.ter, 0.2, "l'ISIN suivant passe");
  assert.equal(ins.LU0908500753.ter, 0.2, "HTTP 500 : TER Yahoo existant gardé");
  assert.equal(ins.LU0908500753.ter_essai_le, MAINTENANT.toISOString());
  assert.ok(corps.avertissements.some(a => /FR0010315770/.test(a) && /délai dépassé/.test(a)), JSON.stringify(corps.avertissements));
  assert.ok(corps.avertissements.some(a => /LU0908500753/.test(a) && /HTTP 500/.test(a)));
  assert.deepEqual(corps.frais, { tentes: 4, trouves: 1 });
  assert.ok(!corps.errors.some(e => /frais/.test(e.error)));
  assert.equal(nomsRpc(m).at(-1), "finish_nightly");

  const panne = montageFrais({ rpcs: { frais_a_chercher: async () => ({ data: null, error: { message: "relation absente" } }) } });
  const c2 = await (await panne.appeler()).json();
  assert.ok(c2.avertissements.some(a => /frais des fonds/.test(a) && /relation absente/.test(a)));
  assert.ok(!c2.errors.some(e => /frais/.test(e.error)));
  const leve = montageFrais({ rpcs: { frais_a_chercher: async () => { throw new Error("connexion perdue"); } } });
  const c3 = await (await leve.appeler()).json();
  assert.ok(c3.avertissements.some(a => /frais des fonds/.test(a) && /connexion perdue/.test(a)));
  assert.equal(nomsRpc(leve).at(-1), "finish_nightly");
  assert.equal(c3.ok, true);
});
