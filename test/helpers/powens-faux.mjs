// Outils des tests de la fonction powens (BUD1) : charge categories.ts, powens-api.ts, synchro.ts et index.ts dans un contexte vm (types retirés), avec une
// base en mémoire (sous-ensemble du client supabase-js), un Hono minimal et des utilisateurs simulés. Mêmes règles que test/powens-synchro.test.mjs et
// test/powens-fonction.test.mjs, dont ils reprennent les doublures. Aucune donnée réelle.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as nodeModule from "node:module";
import vm from "node:vm";
import { BudgetCategoriesPowens } from "./budget-gen.mjs";

export const lire = rel => readFileSync(fileURLToPath(new URL("../../" + rel, import.meta.url)), "utf8");
const strip = nodeModule.stripTypeScriptTypes;
export const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
export const J = v => JSON.parse(JSON.stringify(v));
export const DOSSIER = "supabase/functions/powens/";

const GLOBAUX = { RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console, isFinite, Infinity, NaN,
  TextEncoder, TextDecoder, Intl, crypto: globalThis.crypto, Error, TypeError, Boolean, parseInt, parseFloat, encodeURIComponent,
  decodeURIComponent, URL, URLSearchParams, Request, Response, Headers, btoa, atob, AbortSignal, setTimeout, Uint8Array };
export function chargerModule(source, globaux = {}) {
  const noms = [...source.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function|class)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, { ...GLOBAUX, ...globaux });
}

/** Hono minimal (routes, paramètres, basePath). */
export class FauxHono {
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

/** Modules de la fonction powens : { C: categories, A: powens-api, S: synchro, I: index (routes, deps) }. */
export function charger() {
  const C = chargerModule(lire(DOSSIER + "categories.ts"), { BudgetCategories: BudgetCategoriesPowens });
  const A = chargerModule(lire(DOSSIER + "powens-api.ts"));
  const S = chargerModule(lire(DOSSIER + "synchro.ts"), { categorieBoussole: C.categorieBoussole, BudgetCategories: BudgetCategoriesPowens });
  const Deno = { env: { get: () => undefined }, serve: () => {} };
  const I = chargerModule(lire(DOSSIER + "index.ts"), {
    ...A, ...S, Hono: FauxHono, cors: () => async (_c, next) => next(), createClient: () => { throw new Error("client réel interdit en test"); }, Deno,
  });
  return { C, A, S, I };
}

const CLES = {
  banque_connexions: ["user_id", "id"], banque_comptes: ["user_id", "id"], banque_placements: ["user_id", "id"],
  banque_operations: ["user_id", "id"], positions: ["id"], instruments: ["isin"], credits: ["id"], propositions: ["id"],
  fonctionnalites: ["user_id", "cle"], budget_regles: ["id"],
  banque_marchands_mois: ["user_id", "mois", "compte_id", "cle_marchand", "sous_categorie"],
};
/** Base en mémoire : select / insert / upsert / update / delete, filtres eq, in, lt, gte, is, neq, not ; rpc simulées ; auth.getUser. */
export function fausseBase(init = {}, { rpc = {}, echec = () => null, utilisateurs = {}, facteurs = {} } = {}) {
  const tables = J(init);
  const journal = [];
  const lignes = t => (tables[t] ??= []);
  const cle = (t, r, champs) => (champs || CLES[t] || ["id"]).map(k => String(r[k])).join("|");
  function from(table) {
    const q = { table, op: "select", filtres: [], val: null, opts: {}, unique: null, limite: null };
    const correspond = r => q.filtres.every(([k, op, v]) => op === "eq" ? String(r[k]) === String(v)
      : op === "in" ? v.map(String).includes(String(r[k])) : op === "lt" ? r[k] < v : op === "gte" ? r[k] >= v
      : op === "is" ? (r[k] ?? null) === v : op === "neq" ? (r[k] ?? null) !== v : op === "not_is" ? (r[k] ?? null) !== v : true);
    const executer = () => {
      journal.push({ table, op: q.op, filtres: q.filtres, val: q.val, opts: q.opts });
      const err = echec(table, q.op, q);
      if (err) return { data: null, error: { message: err } };
      let data = null;
      if (q.op === "select") {
        data = lignes(table).filter(correspond).map(r => ({ ...r }));
        if (q.ordre) data.sort((x, y) => (x[q.ordre] > y[q.ordre] ? 1 : x[q.ordre] < y[q.ordre] ? -1 : 0));
        if (q.limite != null) data = data.slice(0, q.limite);
      } else if (q.op === "insert") {
        const rows = [].concat(q.val).map(r => ({ id: r.id ?? crypto.randomUUID(), ...r }));
        lignes(table).push(...rows); data = rows;
      } else if (q.op === "upsert") {
        const champs = q.opts.onConflict ? q.opts.onConflict.split(",").map(s => s.trim()) : null;
        data = [];
        for (const r of [].concat(q.val)) {
          const i = lignes(table).findIndex(x => cle(table, x, champs) === cle(table, r, champs));
          if (i < 0) lignes(table).push({ ...r }); else if (!q.opts.ignoreDuplicates) lignes(table)[i] = { ...lignes(table)[i], ...r };
          data.push(r);
        }
      } else if (q.op === "update") {
        data = [];
        for (const r of lignes(table)) if (correspond(r)) { Object.assign(r, q.val); data.push({ ...r }); }
      } else if (q.op === "delete") {
        data = lignes(table).filter(correspond);
        tables[table] = lignes(table).filter(r => !correspond(r));
      }
      if (q.unique) {
        if (data.length > 1) return { data: null, error: { message: "plusieurs lignes" } };
        data = data[0] ?? null;
      }
      return { data, error: null };
    };
    const b = {
      select: () => b, order: k => { q.ordre = k; return b; }, limit: n => { q.limite = n; return b; },
      eq: (k, v) => { q.filtres.push([k, "eq", v]); return b; }, in: (k, v) => { q.filtres.push([k, "in", v]); return b; },
      lt: (k, v) => { q.filtres.push([k, "lt", v]); return b; }, gte: (k, v) => { q.filtres.push([k, "gte", v]); return b; },
      is: (k, v) => { q.filtres.push([k, "is", v]); return b; }, neq: (k, v) => { q.filtres.push([k, "neq", v]); return b; },
      not: (k, op, v) => { q.filtres.push([k, "not_" + op, v]); return b; },
      insert: v => { q.op = "insert"; q.val = v; return b; }, upsert: (v, o = {}) => { q.op = "upsert"; q.val = v; q.opts = o; return b; },
      update: v => { q.op = "update"; q.val = v; return b; }, delete: () => { q.op = "delete"; return b; },
      maybeSingle: () => { q.unique = "maybe"; return b; }, single: () => { q.unique = "single"; return b; },
      then: (ok, ko) => Promise.resolve().then(executer).then(ok, ko),
    };
    return b;
  }
  return {
    tables, journal, from,
    rpc: async (nom, args) => {
      journal.push({ rpc: nom, args });
      const f = rpc[nom];
      return f ? f(args, tables) : { data: null, error: { message: `rpc ${nom} inconnue` } };
    },
    auth: {
      getUser: async jwt => utilisateurs[jwt] ? { data: { user: utilisateurs[jwt] }, error: null } : { data: { user: null }, error: { message: "jeton invalide" } },
      admin: { mfa: { listFactors: async ({ userId }) => ({ data: { factors: (facteurs[userId] || []).map(f => ({ factor_type: "totp", ...f })) }, error: null }) } },
    },
  };
}
