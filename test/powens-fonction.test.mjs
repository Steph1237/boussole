// Fonction serveur `powens` (BQ1, docs/superpowers/specs/2026-10-12-bq1-powens-design.md § 1) : supabase/functions/powens/
// index.ts (routes) et powens-api.ts (client Powens), exécutés dans un contexte vm (types retirés) avec un Hono minimal, une base
// en mémoire et un `fetch` Powens simulé. Aucun appel réseau, aucun identifiant : toutes les valeurs sont factices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash, createHmac } from "node:crypto";
import * as nodeModule from "node:module";
import vm from "node:vm";

const lire = rel => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const J = v => JSON.parse(JSON.stringify(v));
const DOSSIER = "supabase/functions/powens/";

/* ---------- valeurs factices ---------- */
const U = "11111111-1111-4111-8111-111111111111";
const AUTRE = "22222222-2222-4222-8222-222222222222";
const JWT = "jwt-utilisateur-factice";
const JWT_AUTRE = "jwt-autre-factice";
const JETON = "jeton-powens-factice-0123456789";
const SECRET_HMAC = "secret-hmac-factice";
const ENV_BASE = {
  SUPABASE_URL: "https://projet-factice.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "cle-service-factice",
  POWENS_DOMAIN: "https://boussole2-sandbox.biapi.pro/2.0/", POWENS_CLIENT_ID: "12345678", POWENS_CLIENT_SECRET: "secret-client-factice",
};
const BASE = "https://boussole2-sandbox.biapi.pro/2.0/";
const sha256 = s => createHash("sha256").update(s).digest("hex");

/* ---------- Hono minimal (routes, paramètres, basePath) ---------- */
class FauxHono {
  constructor(base = "") { this.base = base; this.routes = []; this.fetch = this.fetch.bind(this); }
  basePath(p) { return new FauxHono(p); }
  use() { return this; }
  get(p, h) { this.routes.push(["GET", p, h]); return this; }
  post(p, h) { this.routes.push(["POST", p, h]); return this; }
  all(p, h) { this.routes.push(["ALL", p, h]); return this; }
  async fetch(req) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(this.base)) return new Response("introuvable", { status: 404 });
    const chemin = url.pathname.slice(this.base.length) || "/";
    for (const [m, motif, h] of this.routes) {
      if (m !== "ALL" && m !== req.method) continue;
      const a = motif.split("/"), b = chemin.split("/");
      if (motif !== "*" && a.length !== b.length) continue;
      const params = {};
      if (motif !== "*" && !a.every((s, i) => (s.startsWith(":") ? ((params[s.slice(1)] = decodeURIComponent(b[i])), true) : s === b[i]))) continue;
      return h({ req: { raw: req, param: k => params[k], header: k => req.headers.get(k) } });
    }
    return new Response("introuvable", { status: 404 });
  }
}

/* ---------- chargement des modules ---------- */
const GLOBAUX = { RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console, isFinite, Infinity, NaN,
  TextEncoder, TextDecoder, Intl, crypto: globalThis.crypto, Error, TypeError, Boolean, parseInt, parseFloat, encodeURIComponent,
  decodeURIComponent, URL, URLSearchParams, Request, Response, Headers, btoa, atob, AbortSignal, setTimeout, Uint8Array };
function chargerModule(source, globaux = {}) {
  const noms = [...source.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function|class)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, { ...GLOBAUX, ...globaux });
}
function charger({ edgeRuntime } = {}) {
  const C = chargerModule(lire(DOSSIER + "categories.ts"));
  const A = chargerModule(lire(DOSSIER + "powens-api.ts"));
  const S = chargerModule(lire(DOSSIER + "synchro.ts"), { categorieBoussole: C.categorieBoussole });
  const servis = [];
  const Deno = { env: { get: () => undefined }, serve: f => servis.push(f) };
  const I = chargerModule(lire(DOSSIER + "index.ts"), {
    ...A, ...S, Hono: FauxHono, cors: () => async (_c, next) => next(), createClient: () => { throw new Error("client réel interdit en test"); },
    Deno, ...(edgeRuntime ? { EdgeRuntime: edgeRuntime } : {}),
  });
  return { A, S, I, servis };
}

/* ---------- base en mémoire (mêmes règles que test/powens-synchro.test.mjs) ---------- */
const CLES = {
  banque_connexions: ["user_id", "id"], banque_comptes: ["user_id", "id"], banque_placements: ["user_id", "id"],
  banque_operations: ["user_id", "id"], positions: ["id"], instruments: ["isin"], credits: ["id"], propositions: ["id"],
  fonctionnalites: ["user_id", "cle"],
};
function fausseBase(init = {}, { rpc = {}, utilisateurs = {} } = {}) {
  const tables = J(init);
  const journal = [];
  const lignes = t => (tables[t] ??= []);
  const cle = (t, r, champs) => (champs || CLES[t] || ["id"]).map(k => String(r[k])).join("|");
  function from(table) {
    const q = { table, op: "select", filtres: [], val: null, opts: {}, unique: null };
    const correspond = r => q.filtres.every(([k, op, v]) => op === "eq" ? String(r[k]) === String(v)
      : op === "in" ? v.map(String).includes(String(r[k])) : op === "lt" ? r[k] < v : op === "gte" ? r[k] >= v
      : op === "is" ? (r[k] ?? null) === v : true);
    const executer = () => {
      journal.push({ table, op: q.op, filtres: q.filtres, val: q.val });
      let data = null;
      if (q.op === "select") data = lignes(table).filter(correspond).map(r => ({ ...r }));
      else if (q.op === "insert") { const rows = [].concat(q.val).map(r => ({ id: r.id ?? crypto.randomUUID(), ...r })); lignes(table).push(...rows); data = rows; }
      else if (q.op === "upsert") {
        const champs = q.opts.onConflict ? q.opts.onConflict.split(",").map(s => s.trim()) : null;
        for (const r of [].concat(q.val)) {
          const i = lignes(table).findIndex(x => cle(table, x, champs) === cle(table, r, champs));
          if (i < 0) lignes(table).push({ ...r }); else if (!q.opts.ignoreDuplicates) lignes(table)[i] = { ...lignes(table)[i], ...r };
        }
        data = [].concat(q.val);
      } else if (q.op === "update") { data = []; for (const r of lignes(table)) if (correspond(r)) { Object.assign(r, q.val); data.push(r); } }
      else if (q.op === "delete") {
        data = lignes(table).filter(correspond);
        tables[table] = lignes(table).filter(r => !correspond(r));
        if (table === "banque_connexions") // cascade (clé étrangère (user_id, connexion_id) on delete cascade)
          for (const c of data) tables.banque_comptes = (tables.banque_comptes || []).filter(x => !(x.user_id === c.user_id && x.connexion_id === c.id));
      }
      if (q.unique) data = data[0] ?? null;
      return { data, error: null };
    };
    const b = {
      select: () => b, order: () => b, limit: () => b,
      eq: (k, v) => { q.filtres.push([k, "eq", v]); return b; }, in: (k, v) => { q.filtres.push([k, "in", v]); return b; },
      lt: (k, v) => { q.filtres.push([k, "lt", v]); return b; }, gte: (k, v) => { q.filtres.push([k, "gte", v]); return b; },
      is: (k, v) => { q.filtres.push([k, "is", v]); return b; },
      insert: v => { q.op = "insert"; q.val = v; return b; }, upsert: (v, o = {}) => { q.op = "upsert"; q.val = v; q.opts = o; return b; },
      update: v => { q.op = "update"; q.val = v; return b; }, delete: () => { q.op = "delete"; return b; },
      maybeSingle: () => { q.unique = "maybe"; return b; }, single: () => { q.unique = "single"; return b; },
      then: (ok, ko) => Promise.resolve().then(executer).then(ok, ko),
    };
    return b;
  }
  return {
    tables, journal, from,
    rpc: async (nom, args) => { journal.push({ rpc: nom, args }); const f = rpc[nom]; return f ? f(args, tables) : { data: null, error: { message: `rpc ${nom} inconnue` } }; },
    auth: { getUser: async jwt => utilisateurs[jwt] ? { data: { user: utilisateurs[jwt] }, error: null } : { data: { user: null }, error: { message: "jeton invalide" } } },
  };
}
/** Coffre (Vault + prive.powens_utilisateurs + prive.powens_a_supprimer) simulé par les RPC du contrat de la migration 0021. */
function rpcPowens(coffre, aSupprimer = []) {
  const verrous = new Set();
  return {
    powens_jeton: async ({ p_user }) => ({ data: coffre[p_user]?.jeton ?? null, error: null }),
    powens_enregistrer: async ({ p_user, p_powens_user_id, p_jeton }) => {
      if (coffre[p_user]) return { data: false, error: null };
      coffre[p_user] = { powens_user_id: p_powens_user_id, jeton: p_jeton, empreinte: sha256(p_jeton) }; return { data: true, error: null };
    },
    powens_a_supprimer_lister: async () => ({ data: aSupprimer.map(a => ({ ...a })), error: null }),
    powens_a_supprimer_fait: async ({ p_id }) => { const i = aSupprimer.findIndex(a => a.id === p_id); if (i >= 0) aSupprimer.splice(i, 1); return { data: null, error: null }; },
    banque_verrouiller: async ({ p_user, p_connexion }) => {
      const k = `${p_user}|${p_connexion}`; if (verrous.has(k)) return { data: false, error: null }; verrous.add(k); return { data: true, error: null };
    },
    banque_deverrouiller: async ({ p_user, p_connexion }) => { verrous.delete(`${p_user}|${p_connexion}`); return { data: null, error: null }; },
    powens_utilisateur_par_empreinte: async ({ p_empreinte }) =>
      ({ data: Object.entries(coffre).find(([, v]) => v.empreinte === p_empreinte)?.[0] ?? null, error: null }),
    powens_oublier: async ({ p_user }) => { delete coffre[p_user]; return { data: null, error: null }; },
    check_powens_nuit_token: async ({ p }) => ({ data: p === "jeton-nuit-factice", error: null }),
    banque_purger: async ({ p_jours }) => ({ data: p_jours === 90 ? 3 : -1, error: null }),
    banque_recalculer_mois: async () => ({ data: null, error: null }),
  };
}

/* ---------- Powens simulé ---------- */
const CONNEXION = { id: 7, id_user: 42, state: null, error_message: null, last_update: "2026-10-12 07:55:00", connector: { id: 59, name: "Banque Test" } };
const COMPTES = [
  { id: 101, id_connection: 7, name: "Compte chèque", balance: 1520.5, currency: { id: "EUR" }, type: "checking", disabled: null, deleted: null },
  { id: 102, id_connection: 7, name: "Livret A", balance: 8000, currency: { id: "EUR" }, type: "livret_a", disabled: null, deleted: null },
];
const OPERATIONS = [
  { id: 9001, id_account: 101, date: "2026-10-01", value: 3200, simplified_wording: "VIR SALAIRE", categories: [{ code: "salary", parent_code: "revenue" }], coming: false, deleted: null },
  { id: 9002, id_account: 101, date: "2026-10-03", value: -85.4, simplified_wording: "CB SUPERMARCHE", categories: [{ code: "supermarket_and_groceries", parent_code: "food_and_restaurants" }], coming: false, deleted: null },
];
function powensSimule({ etat = null, pannes = {}, jetonInit = JETON, jetons = [JETON] } = {}) {
  const appels = [];
  const rep = (corps, status = 200) => new Response(corps == null ? null : JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });
  const f = async (url, init = {}) => {
    const u = new URL(String(url));
    const methode = (init.method || "GET").toUpperCase();
    const auth = new Headers(init.headers || {}).get("Authorization");
    const chemin = u.pathname.replace(/^\/2\.0\//, "");
    appels.push({ methode, url: u.toString(), chemin, query: Object.fromEntries(u.searchParams), auth, corps: init.body ? JSON.parse(init.body) : null });
    if (u.origin !== "https://boussole2-sandbox.biapi.pro") throw new Error("hôte inattendu " + u.origin);
    const panne = pannes[`${methode} ${chemin}`];
    if (panne) return rep({ code: "bug", description: "panne simulée" }, panne);
    if (methode === "POST" && chemin === "auth/init") return rep({ auth_token: jetonInit, type: "permanent", id_user: 42 });
    if (!jetons.some(j => auth === `Bearer ${j}`)) return rep({ code: "invalidToken" }, 401);
    if (methode === "GET" && chemin === "auth/token/code") return rep({ code: "code temp/factice+1", type: "temporary", access: "standard", expires_in: 1800 });
    if (methode === "GET" && chemin === "users/me/connections/7") return rep({ ...CONNEXION, state: etat });
    if (methode === "PUT" && chemin === "users/me/connections/7") return rep({ ...CONNEXION, state: etat });
    if (methode === "GET" && chemin === "users/me/connections/7/accounts") return rep({ accounts: COMPTES, balances: {} });
    if (methode === "GET" && /^users\/me\/accounts\/\d+\/investments$/.test(chemin)) return rep({ investments: [] });
    if (methode === "GET" && chemin === "users/me/accounts/101/transactions") return rep({ transactions: OPERATIONS, first_date: "2026-10-01", _links: { next: null } });
    if (methode === "GET" && /^users\/me\/accounts\/\d+\/transactions$/.test(chemin)) return rep({ transactions: [] });
    if (methode === "DELETE" && chemin === "users/me/connections/7") return rep(null, 204);
    if (methode === "DELETE" && chemin === "users/me") return rep(null, 204);
    return rep({ code: "notFound" }, 404);
  };
  return { appels, fetch: f };
}

/* ---------- montage ---------- */
function monter({ env = {}, banque = true, coffre = {}, init = {}, powens = powensSimule(), edgeRuntime, aSupprimer = [], rpc = {}, horloge } = {}) {
  const { A, S, I } = charger({ edgeRuntime });
  const db = fausseBase({
    fonctionnalites: [{ user_id: U, cle: "banque", active: banque }, { user_id: AUTRE, cle: "banque", active: true }],
    banque_connexions: [], banque_comptes: [], banque_placements: [], banque_operations: [], positions: [], instruments: [], credits: [], propositions: [],
    ...init,
  }, { rpc: { ...rpcPowens(coffre, aSupprimer), ...rpc }, utilisateurs: { [JWT]: { id: U, email: "u@example.test" }, [JWT_AUTRE]: { id: AUTRE } } });
  const ENV = { ...ENV_BASE, ...env };
  const clients = [];
  I.deps.createClient = (...a) => { clients.push(a); return db; };
  I.deps.fetch = powens.fetch;
  I.deps.env = k => ENV[k];
  I.deps.maintenant = () => new Date("2026-10-12T08:00:00Z");
  if (horloge) I.deps.horloge = horloge;
  const appeler = (chemin, { methode = "POST", jeton, corps, entetes = {} } = {}) => I.app.fetch(new Request("https://projet-factice.supabase.co" + chemin, {
    method: methode, headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), ...(corps !== undefined ? { "Content-Type": "application/json" } : {}), ...entetes },
    body: corps === undefined ? undefined : typeof corps === "string" ? corps : JSON.stringify(corps),
  }));
  return { A, S, I, db, coffre, powens, appeler, clients, ENV, aSupprimer };
}
const corps = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

/* ================================================================== */
test("domaine : trois formes acceptées, valeurs invalides refusées", { skip: SANS_STRIP }, () => {
  const { A } = charger();
  for (const v of ["boussole2-sandbox", "boussole2-sandbox.biapi.pro", "https://boussole2-sandbox.biapi.pro/2.0/", " Boussole2-Sandbox.biapi.pro/ "])
    assert.deepEqual(J(A.domaine({ POWENS_DOMAIN: v })), { nom: "boussole2-sandbox", base: "https://boussole2-sandbox.biapi.pro/2.0/" }, v);
  assert.deepEqual(J(A.domaine("boussole2-sandbox")), { nom: "boussole2-sandbox", base: "https://boussole2-sandbox.biapi.pro/2.0/" }, "chaîne directe");
  for (const v of ["", undefined, "evil.com", "boussole2-sandbox.biapi.pro.evil.com", "a_b", "https://user@evil.com/", "x/../y"])
    assert.throws(() => A.domaine({ POWENS_DOMAIN: v }), /POWENS_DOMAIN/, String(v));
});

test("api : chemins users/me, jeton en Bearer, erreurs traduites sans jeton, pagination limitée à l'hôte Powens", { skip: SANS_STRIP }, async () => {
  const { A } = charger();
  const appels = [];
  let page = 0;
  const f = async (url, init = {}) => {
    appels.push({ url: String(url), methode: init.method || "GET", auth: new Headers(init.headers || {}).get("Authorization") });
    const u = new URL(String(url));
    if (u.pathname.endsWith("/transactions")) {
      page++;
      const next = page === 1 ? { href: "/2.0/users/me/accounts/5/transactions?min_date=2026-07-14&limit=1000&offset=1000" }
        : page === 2 ? { href: "https://evil.example/vol" } : null;
      return new Response(JSON.stringify({ transactions: [{ id: page }], _links: { next } }), { status: 200 });
    }
    if (u.pathname.endsWith("/connections/9")) return new Response(JSON.stringify({ code: "wrongpass", description: "x" }), { status: 401 });
    if (u.pathname.endsWith("/connections/8")) return new Response("{}", { status: 503 });
    return new Response(null, { status: 404 });
  };
  const api = A.api(BASE, JETON, f);
  const ops = await api.operations(5, "2026-07-14");
  assert.deepEqual(J(ops), [{ id: 1 }, { id: 2 }], "page suivante suivie, lien vers un autre hôte ignoré");
  assert.ok(appels.every(a => a.url.startsWith(BASE)), "aucune requête hors de l'hôte Powens");
  assert.ok(appels.every(a => a.auth === `Bearer ${JETON}`));
  const q = new URL(appels[0].url).searchParams;
  assert.equal(q.get("min_date"), "2026-07-14");
  assert.equal(q.get("limit"), "1000");
  assert.equal(q.get("expand"), "categories");
  await assert.rejects(api.connexion(9), e => e instanceof A.PowensErreur && e.status === 401 && /Powens refuse l'accès/.test(e.message) && !e.message.includes(JETON));
  await assert.rejects(api.connexion(8), /Powens est indisponible/);
  assert.equal(ops.tronque, undefined, "lecture complète : non tronquée");
  // Pagination sans fin : arrêt à 20 pages, troncature signalée (tronque = true), pas de 21e appel.
  let n = 0;
  const sansFin = A.api(BASE, JETON, async () => { n++; return new Response(JSON.stringify({ transactions: [{ id: n }], _links: { next: { href: `/2.0/x?page=${n + 1}` } } }), { status: 200 }); });
  const tout = await sansFin.operations(5, "2026-07-14");
  assert.equal(n, 20); assert.equal(tout.length, 20); assert.equal(tout.tronque, true);
  const api404 = A.api(BASE, JETON, async () => new Response(null, { status: 404 }));
  await api404.supprimerConnexion(3); // 404 toléré : déjà supprimée
  await api404.supprimerUtilisateur();
  const enPanne = A.api(BASE, JETON, async () => { throw new TypeError("fetch failed " + JETON); });
  await assert.rejects(enPanne.code(), e => /Powens ne répond pas/.test(e.message) && !e.message.includes(JETON));
});

/* ---------- connecter ---------- */
test("connecter : jeton Supabase obligatoire, interrupteur éteint → 403, configuration absente → 503", { skip: SANS_STRIP }, async () => {
  let m = monter();
  assert.equal((await m.appeler("/powens/connecter", { corps: {} })).status, 401);
  assert.equal((await m.appeler("/powens/connecter", { jeton: "jwt-inconnu", corps: {} })).status, 401);
  m = monter({ banque: false });
  const r = await m.appeler("/powens/connecter", { jeton: JWT, corps: {} });
  assert.equal(r.status, 403);
  assert.deepEqual(await corps(r), { erreur: "La connexion bancaire n'est pas encore ouverte pour ton compte." });
  assert.equal(m.powens.appels.length, 0);
  m = monter({ env: { POWENS_CLIENT_SECRET: undefined } });
  const r2 = await m.appeler("/powens/connecter", { jeton: JWT, corps: {} });
  assert.equal(r2.status, 503);
  assert.match((await corps(r2)).erreur, /pas encore configurée/);
  m = monter({ env: { POWENS_DOMAIN: "evil.com" } });
  assert.equal((await m.appeler("/powens/connecter", { jeton: JWT, corps: {} })).status, 503);
});

test("connecter : création de l'utilisateur Powens au premier appel, réutilisation ensuite, URL de connexion exacte", { skip: SANS_STRIP }, async () => {
  const m = monter();
  const r = await m.appeler("/powens/connecter", { jeton: JWT, corps: {} });
  assert.equal(r.status, 200);
  const { url } = await corps(r);
  assert.equal(url, "https://webview.powens.com/connect?domain=boussole2-sandbox.biapi.pro&client_id=12345678"
    + "&redirect_uri=https%3A%2F%2Foapcewpqsbbjdlcdeizi.supabase.co%2Ffunctions%2Fv1%2Fpowens%2Fretour&code=code%20temp%2Ffactice%2B1");
  assert.ok(!url.includes(JETON) && !url.includes("secret"), "ni jeton ni secret dans l'URL");
  const init = m.powens.appels.filter(a => a.chemin === "auth/init");
  assert.equal(init.length, 1);
  assert.deepEqual(init[0].corps, { client_id: "12345678", client_secret: "secret-client-factice" });
  assert.deepEqual({ powens_user_id: m.coffre[U].powens_user_id, jeton: m.coffre[U].jeton }, { powens_user_id: 42, jeton: JETON }, "powens_enregistrer");
  assert.equal(m.powens.appels.find(a => a.chemin === "auth/token/code").auth, `Bearer ${JETON}`);
  // Clé de service uniquement côté serveur.
  assert.deepEqual(m.clients[0].slice(0, 2), ["https://projet-factice.supabase.co", "cle-service-factice"]);
  // Second appel : pas de nouvel utilisateur Powens.
  const r2 = await m.appeler("/powens/connecter", { jeton: JWT });
  assert.equal(r2.status, 200);
  assert.equal(m.powens.appels.filter(a => a.chemin === "auth/init").length, 1);
});

test("connecter avec connection_id : URL de reconnexion exacte ; connexion d'un autre → 404 ; identifiant invalide → 400", { skip: SANS_STRIP }, async () => {
  const m = monter({ coffre: { [U]: { powens_user_id: 42, jeton: JETON, empreinte: sha256(JETON) } },
    init: { banque_connexions: [{ user_id: U, id: 7, etablissement: "Banque Test", etat: "SCARequired" }, { user_id: AUTRE, id: 8 }] } });
  const r = await m.appeler("/powens/connecter", { jeton: JWT, corps: { connection_id: 7 } });
  assert.equal(r.status, 200);
  assert.equal((await corps(r)).url, "https://boussole2-sandbox.biapi.pro/2.0/auth/webview/reconnect?client_id=12345678&code=code%20temp%2Ffactice%2B1"
    + "&connection_id=7&redirect_uri=https%3A%2F%2Foapcewpqsbbjdlcdeizi.supabase.co%2Ffunctions%2Fv1%2Fpowens%2Fretour");
  assert.equal(m.powens.appels.filter(a => a.chemin === "auth/init").length, 0);
  assert.equal((await m.appeler("/powens/connecter", { jeton: JWT, corps: { connection_id: 8 } })).status, 404);
  for (const v of ["7; drop", -1, 1.5, "abc"]) assert.equal((await m.appeler("/powens/connecter", { jeton: JWT, corps: { connection_id: v } })).status, 400, String(v));
  assert.equal((await m.appeler("/powens/connecter", { jeton: JWT, corps: "pas du json" })).status, 400);
});

test("connecter : erreur Powens → 502 en français, sans jeton ni secret", { skip: SANS_STRIP }, async () => {
  const m = monter({ powens: powensSimule({ pannes: { "POST auth/init": 500 } }) });
  const r = await m.appeler("/powens/connecter", { jeton: JWT, corps: {} });
  assert.equal(r.status, 502);
  const t = JSON.stringify(await corps(r));
  assert.match(t, /Powens est indisponible/);
  assert.ok(!t.includes("secret-client-factice") && !t.includes(JETON));
  assert.equal(m.coffre[U], undefined);
});

test("connecter : double clic — l'utilisateur Powens créé en trop est supprimé chez Powens, le jeton enregistré est repris", { skip: SANS_STRIP }, async () => {
  const NOUVEAU = "jeton-powens-en-trop";
  const coffre = {};
  let premiere = true;
  const m = monter({ coffre, powens: powensSimule({ jetonInit: NOUVEAU, jetons: [JETON, NOUVEAU] }), rpc: {
    // L'autre requête a enregistré son utilisateur entre notre lecture du coffre et notre enregistrement.
    powens_jeton: async ({ p_user }) => {
      if (premiere) { premiere = false; return { data: null, error: null }; }
      return { data: coffre[p_user]?.jeton ?? null, error: null };
    },
  } });
  coffre[U] = { powens_user_id: 41, jeton: JETON, empreinte: sha256(JETON) };
  const r = await m.appeler("/powens/connecter", { jeton: JWT, corps: {} });
  assert.equal(r.status, 200, JSON.stringify(await corps(r.clone())));
  assert.equal(m.coffre[U].jeton, JETON, "jeton existant gardé");
  const del = m.powens.appels.filter(a => a.methode === "DELETE" && a.chemin === "users/me");
  assert.deepEqual(del.map(a => a.auth), [`Bearer ${NOUVEAU}`], "utilisateur en trop supprimé avec son propre jeton");
  assert.equal(m.powens.appels.find(a => a.chemin === "auth/token/code").auth, `Bearer ${JETON}`, "code demandé avec le jeton enregistré");
});

test("connecter : jeton Powens invalide (401) → oubli puis nouvel utilisateur, une seule fois", { skip: SANS_STRIP }, async () => {
  const PERIME = "jeton-perime-factice";
  let m = monter({ coffre: { [U]: { powens_user_id: 40, jeton: PERIME, empreinte: sha256(PERIME) } } });
  let r = await m.appeler("/powens/connecter", { jeton: JWT, corps: {} });
  assert.equal(r.status, 200);
  assert.match((await corps(r)).url, /^https:\/\/webview\.powens\.com\/connect\?/);
  assert.ok(m.db.journal.some(e => e.rpc === "powens_oublier" && e.args.p_user === U));
  assert.equal(m.coffre[U].jeton, JETON, "nouveau jeton enregistré");
  assert.equal(m.powens.appels.filter(a => a.chemin === "auth/init").length, 1);
  // Le nouveau jeton est refusé aussi : pas de boucle.
  m = monter({ coffre: { [U]: { powens_user_id: 40, jeton: PERIME, empreinte: sha256(PERIME) } }, powens: powensSimule({ jetonInit: "autre-perime", jetons: [JETON] }) });
  r = await m.appeler("/powens/connecter", { jeton: JWT, corps: {} });
  assert.equal(r.status, 502);
  assert.equal(m.powens.appels.filter(a => a.chemin === "auth/init").length, 1);
});

/* ---------- webhook ---------- */
const signer = (methode, endpoint, date, payload, secret = SECRET_HMAC) =>
  createHmac("sha256", secret).update(`${methode}.${endpoint}.${date}.${payload}`).digest("base64");
const PAYLOAD = JSON.stringify({ id_webhook_data: 1, user: { id: 42 }, connection: { id: 7, state: null, accounts: [] } });
const coffreU = () => ({ [U]: { powens_user_id: 42, jeton: JETON, empreinte: sha256(JETON) } });

test("webhook : jeton absent ou inconnu → 401 sans rien écrire", { skip: SANS_STRIP }, async () => {
  const m = monter({ coffre: coffreU() });
  for (const jeton of [undefined, "jeton-inconnu"]) {
    const r = await m.appeler("/powens/webhook/connection_synced", { jeton, corps: PAYLOAD });
    assert.equal(r.status, 401, String(jeton));
  }
  assert.equal(m.db.journal.filter(e => e.op && e.op !== "select").length, 0);
  assert.equal(m.powens.appels.length, 0);
  const emp = m.db.journal.find(e => e.rpc === "powens_utilisateur_par_empreinte");
  assert.equal(emp.args.p_empreinte, sha256("jeton-inconnu"), "seule l'empreinte SHA-256 est transmise");
});

test("webhook : HMAC faux → 401 ; HMAC bon (chemin reçu ou chemin public /functions/v1) → 200", { skip: SANS_STRIP }, async () => {
  const m = monter({ coffre: coffreU(), env: { POWENS_WEBHOOK_SECRET: SECRET_HMAC } });
  const date = "2026-10-12T07:56:00.123456Z";
  const faux = await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: PAYLOAD,
    entetes: { "BI-Signature": signer("POST", "/powens/webhook/connection_synced", date, PAYLOAD, "autre-secret"), "BI-Signature-Date": date } });
  assert.equal(faux.status, 401);
  const sansSig = await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: PAYLOAD });
  assert.equal(sansSig.status, 401);
  const altere = await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: PAYLOAD.replace("7", "8"),
    entetes: { "BI-Signature": signer("POST", "/powens/webhook/connection_synced", date, PAYLOAD), "BI-Signature-Date": date } });
  assert.equal(altere.status, 401, "contenu modifié");
  assert.equal(m.db.tables.banque_connexions.length, 0);
  for (const endpoint of ["/powens/webhook/connection_synced", "/functions/v1/powens/webhook/connection_synced"]) {
    const bon = await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: PAYLOAD,
      entetes: { "BI-Signature": signer("POST", endpoint, date, PAYLOAD), "BI-Signature-Date": date } });
    assert.equal(bon.status, 200, endpoint);
  }
  assert.equal(m.db.tables.banque_connexions.length, 1);
  // HMAC bon mais jeton inconnu : toujours 401.
  const r = await m.appeler("/powens/webhook/connection_synced", { jeton: "jeton-inconnu", corps: PAYLOAD,
    entetes: { "BI-Signature": signer("POST", "/powens/webhook/connection_synced", date, PAYLOAD), "BI-Signature-Date": date } });
  assert.equal(r.status, 401);
});

test("webhook : signature datée de plus de 5 minutes → 401 ; sans secret HMAC hors bac à sable → 401 ; corps > 5 Mo → 413", { skip: SANS_STRIP }, async () => {
  let m = monter({ coffre: coffreU(), env: { POWENS_WEBHOOK_SECRET: SECRET_HMAC } });
  for (const date of ["2026-10-12T07:54:59Z", "2026-10-12T08:05:01Z", "pas une date"]) {
    const r = await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: PAYLOAD,
      entetes: { "BI-Signature": signer("POST", "/powens/webhook/connection_synced", date, PAYLOAD), "BI-Signature-Date": date } });
    assert.equal(r.status, 401, date);
  }
  assert.equal(m.db.tables.banque_connexions.length, 0);
  m = monter({ coffre: coffreU(), env: { POWENS_DOMAIN: "boussole2" } });
  assert.equal((await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: PAYLOAD })).status, 401, "production sans secret");
  m = monter({ coffre: coffreU(), env: { POWENS_DOMAIN: "boussole2-sandbox" } });
  assert.equal((await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: PAYLOAD })).status, 200, "bac à sable sans secret");
  m = monter({ coffre: coffreU() });
  const gros = await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: "x".repeat(5 * 1024 * 1024 + 1) });
  assert.equal(gros.status, 413, "corps lu par morceaux, coupé au-delà de 5 Mo");
  assert.equal(m.db.journal.length, 0, "rien lu ni écrit");
});

test("webhook : utilisateur dont la connexion bancaire est fermée → 200 sans rien faire", { skip: SANS_STRIP }, async () => {
  const m = monter({ coffre: coffreU(), banque: false });
  const r = await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: PAYLOAD });
  assert.equal(r.status, 200);
  assert.equal(m.powens.appels.length, 0);
  assert.ok(!m.db.journal.some(e => e.op && e.op !== "select"));
});

test("webhook CONNECTION_SYNCED : jeton bon → 200, synchronisation avec le jeton de l'utilisateur, idempotente sur deux envois", { skip: SANS_STRIP }, async () => {
  const m = monter({ coffre: coffreU() });
  const r = await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: PAYLOAD });
  assert.equal(r.status, 200);
  assert.deepEqual(await corps(r), { ok: true });
  const T = m.db.tables;
  assert.equal(T.banque_connexions[0].user_id, U);
  assert.equal(T.banque_comptes.length, 2);
  assert.equal(T.banque_operations.length, 2);
  assert.equal(T.propositions.length, 2);
  assert.ok(m.powens.appels.every(a => a.auth === `Bearer ${JETON}`));
  const avant = J(T);
  const r2 = await m.appeler("/powens/webhook", { jeton: JETON, corps: PAYLOAD });
  assert.equal(r2.status, 200, "type déduit du contenu");
  for (const t of Object.keys(avant)) assert.equal(m.db.tables[t].length, avant[t].length, t);
});

test("webhook : traitement mis en file par EdgeRuntime.waitUntil, réponse immédiate", { skip: SANS_STRIP }, async () => {
  const enFile = [];
  const m = monter({ coffre: coffreU(), edgeRuntime: { waitUntil: p => enFile.push(p) } });
  const r = await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: PAYLOAD });
  assert.equal(r.status, 200);
  assert.equal(enFile.length, 1);
  await enFile[0];
  assert.equal(m.db.tables.banque_connexions.length, 1);
});

test("webhook CONNECTION_DELETED et ACCOUNT_DISABLED ; payload sans connexion ignoré", { skip: SANS_STRIP }, async () => {
  const m = monter({ coffre: coffreU(), init: {
    banque_connexions: [{ user_id: U, id: 7 }, { user_id: AUTRE, id: 7 }],
    banque_comptes: [{ user_id: U, id: 101, connexion_id: 7, actif: true }, { user_id: U, id: 102, connexion_id: 7, actif: true }],
  } });
  const dis = await m.appeler("/powens/webhook/account_disabled", { jeton: JETON, corps: JSON.stringify({ id: 102, id_connection: 7, disabled: "2026-10-12 07:00:00", balance: 1 }) });
  assert.equal(dis.status, 200);
  assert.equal(m.db.tables.banque_comptes.find(c => c.id === 102).actif, false);
  assert.equal(m.db.tables.banque_comptes.find(c => c.id === 101).actif, true);
  const del = await m.appeler("/powens/webhook", { jeton: JETON, corps: JSON.stringify({ id: 7, id_user: 42, id_connector: 59, state: null }) });
  assert.equal(del.status, 200);
  assert.deepEqual(m.db.tables.banque_connexions.map(c => c.user_id), [AUTRE], "seule la connexion de l'utilisateur authentifié");
  assert.equal(m.powens.appels.length, 0, "aucun appel Powens pour une suppression notifiée");
  const vide = await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: JSON.stringify({ id_webhook_data: 3 }) });
  assert.equal(vide.status, 200);
  assert.equal((await m.appeler("/powens/webhook/connection_synced", { jeton: JETON, corps: "{pas du json" })).status, 400);
});

/* ---------- nuit ---------- */
test("nuit : jeton refusé → 401 ; purge d'abord ; relance (PUT background) des connexions de plus de 36 h, sans synchroniser ; utilisateurs actifs seulement", { skip: SANS_STRIP }, async () => {
  const coffre = { [U]: { powens_user_id: 42, jeton: JETON, empreinte: sha256(JETON) }, [AUTRE]: { powens_user_id: 43, jeton: JETON, empreinte: "x" } };
  const m = monter({ coffre, banque: true, init: {
    fonctionnalites: [{ user_id: U, cle: "banque", active: true }, { user_id: AUTRE, cle: "banque", active: false }],
    banque_connexions: [
      { user_id: U, id: 7, derniere_synchro: "2026-10-10T08:00:00Z" },
      { user_id: U, id: 9, derniere_synchro: "2026-10-11T20:00:00Z" },
      { user_id: AUTRE, id: 7, derniere_synchro: "2026-01-01T00:00:00Z" },
    ],
  } });
  assert.equal((await m.appeler("/powens/nuit", {})).status, 401);
  assert.equal((await m.appeler("/powens/nuit", { jeton: "mauvais" })).status, 401);
  assert.equal(m.powens.appels.length, 0);
  const r = await m.appeler("/powens/nuit", { jeton: "jeton-nuit-factice" });
  assert.equal(r.status, 200);
  const rapport = await corps(r);
  assert.equal(rapport.ok, true, JSON.stringify(rapport));
  assert.equal(rapport.relancees, 1);
  assert.equal(rapport.purgees, 3);
  assert.equal(rapport.synchronisees, undefined, "plus de synchronisation la nuit (le webhook CONNECTION_SYNCED s'en charge)");
  const put = m.powens.appels.filter(a => a.methode === "PUT");
  assert.equal(put.length, 1);
  assert.equal(put[0].chemin, "users/me/connections/7");
  assert.deepEqual(put[0].query, { psu_requested: "false", background: "true" }, "relance sans l'utilisateur (DSP2)");
  assert.ok(!m.powens.appels.some(a => a.methode === "GET"), "aucune lecture Powens");
  assert.ok(!m.db.journal.some(e => e.op && e.op !== "select"), "aucune écriture de données bancaires");
  const rpcs = m.db.journal.filter(e => e.rpc).map(e => e.rpc);
  assert.equal(rpcs[rpcs.lastIndexOf("check_powens_nuit_token") + 1], "banque_purger", "purge en premier (après le contrôle du jeton)");
  assert.ok(m.db.journal.some(e => e.rpc === "banque_purger" && e.args.p_jours === 90));
  assert.ok(!m.db.journal.some(e => e.rpc === "powens_jeton" && e.args.p_user === AUTRE), "interrupteur éteint : ignoré");
  assert.ok(!JSON.stringify(rapport).includes(JETON));
});

test("nuit : utilisateurs Powens à supprimer (compte Boussole supprimé) — DELETE users/me puis effacement ; déjà parti → effacé ; panne → gardé", { skip: SANS_STRIP }, async () => {
  const J1 = "jeton-orphelin-1", J2 = "jeton-orphelin-2", J3 = "jeton-orphelin-3";
  const aSupprimer = [{ id: 1, powens_user_id: 50, jeton: J1 }, { id: 2, powens_user_id: 51, jeton: J2 }, { id: 3, powens_user_id: 52, jeton: J3 },
    { id: 4, powens_user_id: 53, jeton: null }];
  const powens = powensSimule({ jetons: [JETON, J1, J3] });
  const f = powens.fetch;
  powens.fetch = async (url, init = {}) => {
    const a = new Headers(init.headers || {}).get("Authorization");
    if ((init.method || "GET") === "DELETE" && a === `Bearer ${J3}`) { powens.appels.push({ methode: "DELETE", auth: a }); return new Response("{}", { status: 503 }); }
    return f(url, init);
  };
  const m = monter({ aSupprimer, powens });
  const r = await m.appeler("/powens/nuit", { jeton: "jeton-nuit-factice" });
  const rapport = await corps(r);
  const del = m.powens.appels.filter(a => a.methode === "DELETE").map(a => a.auth);
  assert.deepEqual(del, [`Bearer ${J1}`, `Bearer ${J2}`, `Bearer ${J3}`]);
  assert.deepEqual(m.aSupprimer.map(a => a.id), [3], "1 supprimé, 2 déjà parti (401), 4 sans jeton : effacés ; 3 en panne : gardé");
  assert.equal(rapport.utilisateurs_supprimes, 3);
  assert.equal(rapport.ok, false);
  assert.ok(rapport.erreurs.some(e => /suppression/.test(e.erreur)));
  assert.ok(!JSON.stringify(rapport).includes("jeton-orphelin"));
});

test("nuit : arrêt à 60 % du budget de temps, la suite est reportée", { skip: SANS_STRIP }, async () => {
  let t = 0;
  const m = monter({ coffre: coffreU(), horloge: () => (t += 50_000), init: {
    banque_connexions: [{ user_id: U, id: 7, derniere_synchro: null }, { user_id: U, id: 8, derniere_synchro: null }],
  } });
  const rapport = await corps(await m.appeler("/powens/nuit", { jeton: "jeton-nuit-factice" }));
  assert.ok(rapport.relancees < 2, JSON.stringify(rapport));
  assert.ok(rapport.erreurs.some(e => /temps/.test(e.erreur)));
  assert.equal(m.I.BUDGET_NUIT_MS * 0.6, m.I.ARRET_NUIT_MS);
});

/* ---------- retour ---------- */
test("retour : redirection 302 vers l'app avec connection_id et error, valeurs filtrées", { skip: SANS_STRIP }, async () => {
  const m = monter();
  const r = await m.appeler("/powens/retour?connection_id=7&state=x", { methode: "GET" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Location"), "https://steph1237.github.io/boussole/app.html?connection_id=7");
  const e = await m.appeler("/powens/retour?error=access_denied&error_description=annul%C3%A9", { methode: "GET" });
  assert.equal(e.headers.get("Location"), "https://steph1237.github.io/boussole/app.html?error=access_denied");
  const x = await m.appeler("/powens/retour?connection_id=7%22%3E%3Cscript%3E&error=%3Cb%3E", { methode: "GET" });
  assert.equal(x.headers.get("Location"), "https://steph1237.github.io/boussole/app.html");
});

/* ---------- deconnecter / supprimer ---------- */
test("deconnecter : suppression chez Powens puis dans Boussole ; connexion inconnue → 404", { skip: SANS_STRIP }, async () => {
  const m = monter({ coffre: coffreU(), init: {
    banque_connexions: [{ user_id: U, id: 7 }],
    banque_comptes: [{ user_id: U, id: 102, connexion_id: 7, position_id: "pos-1" }],
    positions: [{ id: "pos-1", user_id: U, name: "Livret", value: 8000, source_auto: "powens", source_auto_le: "2026-10-11T00:00:00Z" }],
  } });
  assert.equal((await m.appeler("/powens/deconnecter", { corps: { connection_id: 7 } })).status, 401);
  assert.equal((await m.appeler("/powens/deconnecter", { jeton: JWT, corps: { connection_id: 99 } })).status, 404);
  assert.equal((await m.appeler("/powens/deconnecter", { jeton: JWT, corps: {} })).status, 400);
  const r = await m.appeler("/powens/deconnecter", { jeton: JWT, corps: { connection_id: 7 } });
  assert.equal(r.status, 200);
  assert.deepEqual(await corps(r), { ok: true });
  assert.ok(m.powens.appels.some(a => a.methode === "DELETE" && a.chemin === "users/me/connections/7"));
  assert.equal(m.db.tables.banque_connexions.length, 0);
  const pos = m.db.tables.positions[0];
  assert.deepEqual({ value: pos.value, source_auto: pos.source_auto }, { value: 8000, source_auto: null }, "ligne conservée, repassée en saisie manuelle");
});

test("supprimer : sans compte Powens → ok ; sinon suppression chez Powens puis oubli ; échec Powens → 502 et rien n'est oublié", { skip: SANS_STRIP }, async () => {
  let m = monter();
  let r = await m.appeler("/powens/supprimer", { jeton: JWT });
  assert.equal(r.status, 200);
  assert.deepEqual(await corps(r), { ok: true });
  assert.equal(m.powens.appels.length, 0);
  m = monter({ coffre: coffreU() });
  r = await m.appeler("/powens/supprimer", { jeton: JWT });
  assert.equal(r.status, 200);
  assert.ok(m.powens.appels.some(a => a.methode === "DELETE" && a.chemin === "users/me"));
  assert.equal(m.coffre[U], undefined, "powens_oublier");
  m = monter({ coffre: coffreU(), powens: powensSimule({ pannes: { "DELETE users/me": 500 } }) });
  r = await m.appeler("/powens/supprimer", { jeton: JWT });
  assert.equal(r.status, 502);
  assert.match((await corps(r)).erreur, /suppression chez Powens a échoué/);
  assert.ok(m.coffre[U], "jeton gardé pour réessayer");
  assert.equal((await m.appeler("/powens/supprimer", {})).status, 401);
  // 401, 403, 404 : l'utilisateur Powens est déjà parti → oubli quand même
  for (const statut of [401, 403, 404]) {
    m = monter({ coffre: coffreU(), powens: powensSimule({ pannes: { "DELETE users/me": statut } }) });
    r = await m.appeler("/powens/supprimer", { jeton: JWT });
    assert.equal(r.status, 200, String(statut));
    assert.deepEqual(await corps(r), { ok: true });
    assert.equal(m.coffre[U], undefined, `${statut} : powens_oublier`);
  }
});

/* ---------- sécurité du code ---------- */
test("egalTempsConstant : compare sans court-circuit, longueurs différentes refusées", { skip: SANS_STRIP }, () => {
  const { I } = charger();
  assert.equal(I.egalTempsConstant("abc", "abc"), true);
  assert.equal(I.egalTempsConstant("abc", "abd"), false);
  assert.equal(I.egalTempsConstant("abc", "abcd"), false);
  assert.equal(I.egalTempsConstant("", ""), false, "chaîne vide jamais acceptée");
});

test("aucun secret dans le code ; jeton jamais journalisé ; deno.json épinglé", { skip: SANS_STRIP }, () => {
  const fichiers = readdirSync(fileURLToPath(new URL("../" + DOSSIER, import.meta.url)));
  assert.deepEqual(fichiers.sort(), ["categories.ts", "deno.json", "index.ts", "powens-api.ts", "synchro.ts"]);
  for (const f of fichiers) {
    const s = lire(DOSSIER + f);
    assert.doesNotMatch(s, /sb_secret_|eyJ[A-Za-z0-9_-]{20,}|service_role_key\s*[:=]\s*["']/i, f);
    for (const l of s.split("\n").filter(l => /console\.(log|warn|error|info)/.test(l)))
      assert.doesNotMatch(l, /jeton\b|auth_token|secret|Authorization|token\b/i, `${f} : ${l.trim()}`);
  }
  const idx = lire(DOSSIER + "index.ts");
  for (const k of ["POWENS_CLIENT_SECRET", "POWENS_CLIENT_ID", "POWENS_DOMAIN", "POWENS_WEBHOOK_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]) assert.match(idx, new RegExp(`env\\("${k}"\\)`), k);
  const deno = JSON.parse(lire(DOSSIER + "deno.json"));
  for (const [k, v] of Object.entries(deno.imports)) assert.match(v, /^npm:[@\w/.-]+@\d+\.\d+\.\d+/, `${k} épinglé`);
  const mcp = JSON.parse(lire("supabase/functions/mcp/deno.json")).imports;
  for (const [k, v] of Object.entries(deno.imports)) assert.equal(v, mcp[k], `${k} : même version que mcp`);
});
