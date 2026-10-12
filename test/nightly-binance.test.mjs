// Binance en lecture seule (CP1 § 7) : fonctions pures et client de supabase/functions/nightly/binance.ts, exécutées dans un
// contexte vm (types retirés). Signature vérifiée sur l'exemple officiel de la documentation Binance et recoupée avec
// node:crypto ; agrégation ; plan d'application aux lignes ; client avec un fetch factice. Aucun appel réseau, aucun secret réel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import * as nodeModule from "node:module";
import vm from "node:vm";

const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const J = v => JSON.parse(JSON.stringify(v));
const GLOBAUX = { RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console, isFinite, Infinity, NaN,
  TextEncoder, TextDecoder, Intl, crypto: globalThis.crypto, Error, TypeError, Boolean, parseInt, parseFloat, encodeURIComponent,
  decodeURIComponent, URL, URLSearchParams, Request, Response, Headers, AbortSignal, setTimeout, Uint8Array };
function charger() {
  const source = readFileSync(new URL("../supabase/functions/nightly/binance.ts", import.meta.url), "utf8");
  const noms = [...source.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function|class|type)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, { ...GLOBAUX });
}

// Exemple officiel (https://developers.binance.com/docs/binance-spot-api-docs/rest-api/request-security, consulté le 2026-10-12).
const DOC_SECRET = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
const DOC_CHARGE = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
const DOC_SIGNATURE = "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71";

test("signature : exemple officiel Binance et calcul croisé avec node:crypto", { skip: SANS_STRIP }, async () => {
  const B = charger();
  assert.equal(await B.signer(DOC_SECRET, DOC_CHARGE), DOC_SIGNATURE);
  assert.equal(createHmac("sha256", DOC_SECRET).update(DOC_CHARGE).digest("hex"), DOC_SIGNATURE, "node:crypto");
  for (const [s, c] of [["secret-factice", "omitZeroBalances=true&recvWindow=10000&timestamp=1760256000000"], ["é", "a=1&b=é"]])
    assert.equal(await B.signer(s, c), createHmac("sha256", s).update(c).digest("hex"), c);
});

test("erreurs traduites : clé, signature, horloge, limite, panne ; jamais de corps", { skip: SANS_STRIP }, () => {
  const B = charger();
  assert.match(B.traduireErreur(401, -2015), /refuse la clé API/);
  assert.match(B.traduireErreur(400, -2014), /refuse la clé API/);
  assert.match(B.traduireErreur(400, -1022), /signature/);
  assert.match(B.traduireErreur(400, -1021), /horodatage/);
  assert.match(B.traduireErreur(429, null), /limite les appels/);
  assert.match(B.traduireErreur(418, null), /limite les appels/);
  assert.match(B.traduireErreur(503, null), /indisponible \(HTTP 503\)/);
  assert.equal(B.traduireErreur(400, -1100), "Binance a répondu HTTP 400 (code -1100).");
});

test("agrégation : libre + bloqué + Earn flexible + Earn verrouillé, quantités nulles ignorées, LD<ACTIF> converti sans double compte", { skip: SANS_STRIP }, () => {
  const B = charger();
  const r = B.agreger({
    compte: [
      { asset: "BTC", free: "0.01000000", locked: "0.00500000" },
      { asset: "ETH", free: "0.00000000", locked: "0.00000000" },
      { asset: "LDBNB", free: "2.00000000", locked: "0" },     // pas de position flexible BNB lue : converti
      { asset: "LDUSDT", free: "50", locked: "0" },            // position flexible USDT lue : déjà comptée
      { asset: "LDO", free: "12.5", locked: "0" },             // vrai jeton Lido DAO
      { asset: "eur", free: "100.5", locked: "0" },
    ],
    flexible: [{ asset: "USDT", totalAmount: "50.00000000" }, { asset: "BTC", totalAmount: "0.002" }, { asset: "SOL", totalAmount: "0" }],
    verrouille: [{ asset: "SOL", amount: "3" }, { asset: "BTC", amount: "0.0001" }, { asset: "DOT", amount: "0.00000000" }],
  });
  assert.deepEqual(J(r), { BNB: 2, BTC: 0.0171, EUR: 100.5, LDO: 12.5, SOL: 3, USDT: 50 });
  assert.deepEqual(J(B.agreger({ compte: [], flexible: [], verrouille: [] })), {});
  assert.deepEqual(J(B.agreger({ compte: [{ asset: "LDETH", free: "1", locked: "0" }], flexible: [{ asset: "ETH", totalAmount: "1" }], verrouille: [] })), { ETH: 1 });
  assert.deepEqual(J(B.agreger({ compte: [{ asset: "BTC", free: "0.1", locked: "0.2" }], flexible: [], verrouille: [] })), { BTC: 0.3 }, "arrondi à 8 décimales");
});

test("ISIN crypto : X-<ACTIF> et X-<ACTIF>-EUR reconnus ; enveloppe comparée sans casse ni espaces", { skip: SANS_STRIP }, () => {
  const B = charger();
  assert.equal(B.actifDeIsin("X-BTC"), "BTC");
  assert.equal(B.actifDeIsin("X-BTC-EUR"), "BTC");
  assert.equal(B.actifDeIsin("x-eth"), "ETH");
  assert.equal(B.actifDeIsin("X-EUR"), "EUR");
  assert.equal(B.actifDeIsin("FR0010315770"), null);
  assert.equal(B.actifDeIsin(null), null);
  assert.equal(B.actifDeIsin("X-NIGHTLY-123"), null);
  assert.ok(B.memeEnveloppe("crypto  (binance)", "Crypto (Binance)"));
  assert.ok(B.memeEnveloppe("CRYPTO(BINANCE)", "Crypto (Binance)"));
  assert.ok(!B.memeEnveloppe("Crypto", "Crypto (Binance)"));
});

test("plan : mise à jour, réouverture, création au-delà de 10 €, petits soldes, sans cours, clôture des lignes Binance disparues", { skip: SANS_STRIP }, () => {
  const B = charger();
  const L = (id, isin, extra = {}) => ({ id, envelope: "Crypto (Binance)", isin, qty: 1, status: "actif", source_auto: null, created_at: "2026-01-0" + id.length, ...extra });
  const lignes = [
    L("btc", "X-BTC-EUR"),                                                     // ligne migrée (format X-…-EUR), saisie à la main
    L("eth", "X-ETH", { source_auto: "binance" }),
    L("sol", "X-SOL", { status: "clôturé", source_auto: "binance" }),           // rouverte
    L("ada", "X-ADA", { source_auto: "binance" }),                              // disparue → clôturée
    L("dot", "X-DOT"),                                                          // disparue mais saisie à la main → intacte
    L("autre", "X-XRP", { envelope: "Crypto (Kraken)", source_auto: "binance" }), // autre enveloppe : jamais touchée
    L("pea", "FR0010315770", { envelope: "PEA" }),
  ];
  const plan = B.planBinance({
    actifs: { BTC: 0.02, ETH: 1.5, SOL: 4, BNB: 0.5, SHIB: 1000, PEPE: 3, XRP: 10 },
    lignes, cours: { BNB: 500, SHIB: 0.000008, XRP: 0.5 },
  });
  assert.deepEqual(J(plan.maj), [
    { id: "btc", actif: "BTC", qty: 0.02, reactiver: false },
    { id: "eth", actif: "ETH", qty: 1.5, reactiver: false },
    { id: "sol", actif: "SOL", qty: 4, reactiver: true },
  ]);
  assert.deepEqual(J(plan.creer), [{ actif: "BNB", qty: 0.5, valeur: 250 }]);
  assert.deepEqual(J(plan.petits), [{ actif: "SHIB", qty: 1000, valeur: 0.01 }, { actif: "XRP", qty: 10, valeur: 5 }]);
  assert.deepEqual(J(plan.sansCours), [{ actif: "PEPE", qty: 3 }]);
  assert.deepEqual(J(plan.cloturer), [{ id: "ada", actif: "ADA" }]);
  assert.deepEqual(J(plan.avertissements), []);
});

test("plan : ligne active préférée à la clôturée, ligne Binance préférée à la manuelle, doublons signalés ; portefeuille vide → aucune clôture", { skip: SANS_STRIP }, () => {
  const B = charger();
  const lignes = [
    { id: "a", envelope: "Crypto (Binance)", isin: "X-BTC", status: "clôturé", source_auto: "binance", created_at: "2026-01-01" },
    { id: "b", envelope: "Crypto (Binance)", isin: "X-BTC", status: "actif", source_auto: null, created_at: "2026-01-02" },
    { id: "c", envelope: "crypto (binance)", isin: "X-BTC-EUR", status: "actif", source_auto: "binance", created_at: "2026-01-03" },
  ];
  const plan = B.planBinance({ actifs: { BTC: 1 }, lignes, cours: {} });
  assert.deepEqual(J(plan.maj), [{ id: "c", actif: "BTC", qty: 1, reactiver: false }]);
  assert.equal(plan.avertissements.length, 1);
  assert.match(plan.avertissements[0], /plusieurs lignes BTC/);
  assert.deepEqual(J(plan.cloturer), [], "la ligne b (manuelle) n'est pas clôturée");
  const vide = B.planBinance({ actifs: {}, lignes, cours: {} });
  assert.deepEqual(J(vide.cloturer), []);
  assert.match(vide.avertissements[0], /portefeuille vide/);
  const cinq = B.planBinance({ actifs: { ETH: 0.002 }, lignes: [], cours: { ETH: 5000 } });
  assert.deepEqual(J(cinq.petits), [{ actif: "ETH", qty: 0.002, valeur: 10 }], "10 € pile : pas de création (au-delà de 10 € seulement)");
});

/* ---------- client avec fetch factice ---------- */
const CLE = "cle-api-factice-AAAA", SECRET = "secret-api-factice-ZZZZ";
function binanceSimule({ pannes = {}, flexibles = [], verrouilles = [], heure = 1760256000500, reseau = false } = {}) {
  const appels = [];
  const rep = (c, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "Content-Type": "application/json" } });
  const f = async (url, init = {}) => {
    const u = new URL(String(url));
    appels.push({ url: String(url), chemin: u.pathname, query: Object.fromEntries(u.searchParams), cle: new Headers(init.headers || {}).get("X-MBX-APIKEY") });
    if (reseau) throw new TypeError(`error sending request for url (${url})`);
    if (u.origin !== "https://api.binance.com") throw new Error("hôte inattendu");
    if (pannes[u.pathname]) return rep(pannes[u.pathname].corps, pannes[u.pathname].status);
    if (u.pathname === "/api/v3/time") return rep({ serverTime: heure });
    // signature vérifiée comme le ferait Binance
    const brut = u.search.slice(1);
    const i = brut.lastIndexOf("&signature=");
    if (i < 0 || createHmac("sha256", SECRET).update(brut.slice(0, i)).digest("hex") !== brut.slice(i + 11)) return rep({ code: -1022, msg: "Signature invalid" }, 400);
    if (new Headers(init.headers || {}).get("X-MBX-APIKEY") !== CLE) return rep({ code: -2015, msg: "Invalid API-key" }, 401);
    if (u.pathname === "/api/v3/account") return rep({ balances: [{ asset: "BTC", free: "0.5", locked: "0" }] });
    const page = Number(u.searchParams.get("current")), size = Number(u.searchParams.get("size"));
    const liste = u.pathname.endsWith("/flexible/position") ? flexibles : u.pathname.endsWith("/locked/position") ? verrouilles : null;
    if (!liste) return rep({ code: -1, msg: "?" }, 404);
    return rep({ rows: liste.slice((page - 1) * size, page * size), total: liste.length });
  };
  return { appels, fetch: f };
}

test("client : appels signés (X-MBX-APIKEY, recvWindow=10000, horodatage serveur), Earn paginé par 100", { skip: SANS_STRIP }, async () => {
  const B = charger();
  const flexibles = Array.from({ length: 150 }, (_, i) => ({ asset: "A" + i, totalAmount: "1" }));
  const sim = binanceSimule({ flexibles, verrouilles: [{ asset: "SOL", amount: "2" }] });
  const lu = await B.client(CLE, SECRET, sim.fetch, () => 1760256000000).lire();
  assert.equal(lu.compte.length, 1);
  assert.equal(lu.flexible.length, 150, "deux pages");
  assert.equal(lu.verrouille.length, 1);
  const chemins = sim.appels.map(a => a.chemin + (a.query.current ? "#" + a.query.current : ""));
  assert.deepEqual(chemins, ["/api/v3/time", "/api/v3/account", "/sapi/v1/simple-earn/flexible/position#1", "/sapi/v1/simple-earn/flexible/position#2",
    "/sapi/v1/simple-earn/locked/position#1"]);
  for (const a of sim.appels.slice(1)) {
    assert.equal(a.cle, CLE);
    assert.equal(a.query.recvWindow, "10000");
    assert.equal(a.query.timestamp, "1760256000500", "heure du serveur Binance");
    assert.match(a.query.signature, /^[0-9a-f]{64}$/);
    assert.ok(!a.url.includes(SECRET), "le secret ne circule jamais");
  }
  assert.equal(sim.appels[1].query.omitZeroBalances, "true");
  assert.equal(sim.appels[0].cle, null, "/api/v3/time sans clé");
  assert.equal(sim.appels[2].query.size, "100");
});

test("client : erreurs traduites sans secret ni URL ; heure serveur indisponible tolérée ; réseau coupé", { skip: SANS_STRIP }, async () => {
  const B = charger();
  const verifier = async (sim, motif) => {
    await assert.rejects(B.client(CLE, SECRET, sim.fetch).lire(), e => {
      assert.equal(e.name, "BinanceErreur");
      assert.match(e.message, motif);
      for (const s of [CLE, SECRET, "signature", "api.binance.com"]) assert.ok(!e.message.includes(s), s);
      return true;
    });
  };
  await verifier(binanceSimule({ pannes: { "/api/v3/account": { status: 401, corps: { code: -2015, msg: `Invalid API-key ${CLE}` } } } }), /refuse la clé API/);
  await verifier(binanceSimule({ pannes: { "/sapi/v1/simple-earn/locked/position": { status: 429, corps: { code: -1003, msg: "Too many" } } } }), /limite les appels/);
  await verifier(binanceSimule({ pannes: { "/api/v3/account": { status: 502, corps: {} } } }), /indisponible/);
  await verifier(binanceSimule({ reseau: true }), /injoignable/);
  const mauvaisSecret = binanceSimule();
  await assert.rejects(B.client(CLE, "autre-secret", mauvaisSecret.fetch).lire(), /signature/);
  const sansHeure = binanceSimule({ pannes: { "/api/v3/time": { status: 500, corps: {} } } });
  const lu = await B.client(CLE, SECRET, sansHeure.fetch, () => 1760256000000).lire();
  assert.equal(lu.compte.length, 1);
  assert.equal(sansHeure.appels[1].query.timestamp, "1760256000000", "horloge locale à défaut");
});
