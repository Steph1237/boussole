// SEC5 : nuit hors ligne (BOUSSOLE_HORS_LIGNE=1) : aucun appel externe, cours lus dans BOUSSOLE_COURS_FIGES ; sans la variable, la nuit
// ne change pas. Même méthode que test/nightly-fonction.test.mjs (types retirés, contexte vm, base et réseau factices).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import vm from "node:vm";

const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const lire = f => readFileSync(new URL("../supabase/functions/nightly/" + f, import.meta.url), "utf8");
const JETON = "jeton-nuit-factice";
const MAINTENANT = new Date("2026-10-12T20:30:00Z");

function chargerModule(source, contexte) {
  const noms = [...source.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?\s*$/gm, "").replace(/^export (const|function|async function|class)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, contexte);
}
function charger() {
  const G = { RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console: { log() {}, error() {}, warn() {} }, isFinite, Infinity, NaN,
    TextEncoder, TextDecoder, Intl, crypto: globalThis.crypto, Error, TypeError, Boolean, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL, URLSearchParams,
    Request, Response, Headers, AbortSignal, setTimeout, Uint8Array };
  const C = chargerModule(lire("cours.ts"), { ...G });
  const B = chargerModule(lire("binance.ts"), { ...G });
  const F = chargerModule(lire("frais.ts"), { ...G });
  const servis = [];
  const I = chargerModule(lire("index.ts"), { ...G, ...C, ...B, ...F, clientBinance: B.client, Deno: { env: { get: () => undefined }, serve: f => servis.push(f) }, createClient: () => { throw new Error("client réel interdit"); } });
  return { C, I, handler: servis[0] };
}

/** Base factice minimale : instruments, cours (upsert), RPC de la nuit. */
function fausseBase(instruments) {
  const tables = { instruments: structuredClone(instruments), cours: [] };
  const rpcs = [];
  const from = table => {
    const q = { op: "select", filtres: [], val: null };
    const b = {
      select: () => b, order: () => b,
      eq: (k, v) => { q.filtres.push([k, v]); return b; },
      update: v => { q.op = "update"; q.val = v; return b; },
      upsert: v => { q.op = "upsert"; q.val = v; return b; },
      insert: v => { q.op = "insert"; q.val = v; return b; },
      then: (res, rej) => Promise.resolve().then(() => {
        const rows = tables[table] ?? (tables[table] = []);
        if (q.op === "select") return { data: rows.filter(r => q.filtres.every(([k, v]) => String(r[k]) === String(v))).map(r => ({ ...r })), error: null };
        if (q.op === "update") { for (const r of rows) if (q.filtres.every(([k, v]) => String(r[k]) === String(v))) Object.assign(r, q.val); return { data: [], error: null }; }
        rows.push(...[].concat(q.val)); return { data: null, error: null };
      }).then(res, rej),
    };
    return b;
  };
  const rpc = async (nom) => {
    rpcs.push(nom);
    if (nom === "check_nightly_token") return { data: true, error: null };
    if (nom === "cours_a_rattraper" || nom === "frais_a_chercher") return { data: [{ isin: "FR0010315770", symbol: "CW8.PA", currency: "EUR", nb_cours: 0 }], error: null };
    if (nom === "take_snapshots") return { data: 1, error: null };
    return { data: 0, error: null };
  };
  return { tables, rpcs, from, rpc };
}

const INSTRUMENTS = [
  { isin: "ZZ0000000011", symbol: "FMIA", currency: "EUR", price: 100 },
  { isin: "ZZ0000000029", symbol: "FEIA", currency: "EUR", price: 200 },
  { isin: "ZZ0000000999", symbol: "INCONNU", currency: "EUR", price: 7 },
  { isin: "X-EUR", symbol: null, currency: "EUR", price: 1 },
];

function monter(env, instruments = INSTRUMENTS) {
  const { I, handler } = charger();
  const db = fausseBase(instruments);
  const reseau = [];
  I.deps.createClient = () => db;
  I.deps.fetch = async (url) => { reseau.push(String(url)); return new Response("{}", { status: 500 }); };
  I.deps.env = k => ({ SUPABASE_URL: "http://kong:8000", SUPABASE_SERVICE_ROLE_KEY: "cle-service-locale-factice", ...env })[k];
  I.deps.maintenant = () => MAINTENANT;
  I.deps.horloge = () => 0;
  I.deps.signal = () => new AbortController().signal;
  I.deps.attendre = async () => {};
  const appeler = () => handler(new Request("http://kong:8000/functions/v1/nightly", { method: "POST", headers: { Authorization: `Bearer ${JETON}` } }));
  return { db, reseau, appeler };
}

test("coursFiges : « ISIN=prix,… » → Map, entrées invalides ignorées", { skip: SANS_STRIP }, () => {
  const { C } = charger();
  const m = C.coursFiges("ZZ0000000011=104.26, ZZ0000000029=248.3 ,X-BTC=61250,vide=,=3,mauvais=abc,neg=-1,zero=0");
  assert.deepEqual([...m], [["ZZ0000000011", 104.26], ["ZZ0000000029", 248.3], ["X-BTC", 61250]]);
  assert.equal(C.coursFiges(undefined).size, 0);
  assert.equal(C.coursFiges("").size, 0);
});

test("hors ligne : aucun appel externe, cours lus dans BOUSSOLE_COURS_FIGES, clôtures écrites", { skip: SANS_STRIP }, async () => {
  const m = monter({ BOUSSOLE_HORS_LIGNE: "1", BOUSSOLE_COURS_FIGES: "ZZ0000000011=104.26,ZZ0000000029=248.3", BINANCE_API_KEY: "k", BINANCE_API_SECRET: "s" });
  const r = await m.appeler();
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(m.reseau, [], "aucun fetch");
  assert.equal(body.hors_ligne, true);
  assert.equal(body.ok, true);
  assert.deepEqual(body.errors, []);
  assert.equal(body.instruments_updated, 3, "deux cours figés + X-EUR fixe");
  const prix = Object.fromEntries(m.db.tables.instruments.map(i => [i.isin, i.price]));
  assert.equal(prix["ZZ0000000011"], 104.26);
  assert.equal(prix["ZZ0000000029"], 248.3);
  assert.equal(prix["ZZ0000000999"], 7, "pas de cours figé : prix inchangé");
  assert.equal(prix["X-EUR"], 1);
  assert.deepEqual(m.db.tables.cours.map(c => [c.isin, c.cloture, c.source]).sort(), [["X-EUR", 1, "fixe"], ["ZZ0000000011", 104.26, "fige"], ["ZZ0000000029", 248.3, "fige"]]);
  assert.equal(m.db.tables.instruments.find(i => i.isin === "ZZ0000000011").price_date, "2026-10-12");
  assert.equal(body.binance.etat, "hors ligne");
  assert.deepEqual(body.rattrapages, { tentes: 0, reussis: 0, lignes: 0 });
  assert.deepEqual(body.frais, { tentes: 0, trouves: 0 });
  assert.ok(m.db.rpcs.includes("take_snapshots") && m.db.rpcs.includes("apply_recurring") && m.db.rpcs.includes("finish_nightly"), "photos, versements et compte rendu continuent");
  assert.ok(!m.db.rpcs.includes("cours_a_rattraper") && !m.db.rpcs.includes("frais_a_chercher"));
});

test("hors ligne sans fichier de cours : aucun appel externe, aucun cours modifié", { skip: SANS_STRIP }, async () => {
  const m = monter({ BOUSSOLE_HORS_LIGNE: "1" });
  const body = await (await m.appeler()).json();
  assert.deepEqual(m.reseau, []);
  assert.equal(body.ok, true);
  assert.deepEqual(m.db.tables.instruments.map(i => i.price), [100, 200, 7, 1].map((v, i) => (i === 3 ? 1 : v)));
});

test("hors ligne : le garde-fou d'appel refuse tout fetch, même demandé directement", { skip: SANS_STRIP }, async () => {
  const m = monter({ BOUSSOLE_HORS_LIGNE: "1", BOUSSOLE_COURS_FIGES: "ZZ0000000011=1" });
  await m.appeler();
  assert.equal(m.reseau.length, 0);
});

test("sans BOUSSOLE_HORS_LIGNE : comportement inchangé (Yahoo interrogé, pas de champ hors_ligne)", { skip: SANS_STRIP }, async () => {
  const m = monter({ BOUSSOLE_COURS_FIGES: "ZZ0000000011=104.26" });
  const body = await (await m.appeler()).json();
  assert.ok(m.reseau.some(u => u.includes("finance.yahoo.com")), "Yahoo appelé");
  assert.ok(!("hors_ligne" in body));
  assert.notEqual(m.db.tables.instruments.find(i => i.isin === "ZZ0000000011").price, 104.26, "le fichier de cours figés est ignoré hors du mode hors ligne");
});

test("BOUSSOLE_HORS_LIGNE autre que « 1 » : sans effet", { skip: SANS_STRIP }, async () => {
  for (const v of ["0", "", "true", "oui"]) {
    const m = monter({ BOUSSOLE_HORS_LIGNE: v });
    const body = await (await m.appeler()).json();
    assert.ok(!("hors_ligne" in body), v);
    assert.ok(m.reseau.length > 0, v);
  }
});
