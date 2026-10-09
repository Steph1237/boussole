// Connecteur MCP (supabase/functions/mcp) et page de consentement OAuth.
//
// Contrôles statiques, sans réseau : routes, en-têtes, outils exposés, absence de clé de service.
// Contrôle en ligne (fonction déployée) seulement avec BOUSSOLE_LIVE=1 :
//   BOUSSOLE_LIVE=1 node --test test/mcp.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
const src = readFileSync(path("supabase/functions/mcp/index.ts"), "utf8");
const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""); // sans commentaires

const BASE = "https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/mcp";
const PRM_URL = `${BASE}/.well-known/oauth-protected-resource`;
const TOOLS = [
  "get_overview", "get_profile", "update_profile", "upsert_biens", "upsert_credits", "delete_bien", "delete_credit",
  "list_positions", "upsert_positions", "record_transaction", "get_config", "update_config",
  "get_budget", "update_budget", "list_objectifs", "upsert_objectifs", "delete_objectif",
];

test("mcp : route des métadonnées de ressource protégée (et variante suffixée)", () => {
  assert.match(code, /basePath\(\s*["']\/mcp["']\s*\)/);
  assert.match(code, /\.get\(\s*["']\/\.well-known\/oauth-protected-resource["']/);
  assert.match(code, /\.get\(\s*["']\/\.well-known\/oauth-protected-resource\/functions\/v1\/mcp["']/);
  assert.ok(code.includes('authorization_servers: ["https://oapcewpqsbbjdlcdeizi.supabase.co/auth/v1"]'));
  assert.ok(code.includes('bearer_methods_supported: ["header"]'));
});

test("mcp : 401 avec WWW-Authenticate pointant vers les métadonnées", () => {
  assert.ok(code.includes("Bearer resource_metadata="), "en-tête WWW-Authenticate absent");
  assert.ok(code.includes("/.well-known/oauth-protected-resource`"), "resource_metadata doit viser la route .well-known");
  assert.match(code, /"WWW-Authenticate"/);
  assert.match(code, /401/);
  assert.match(code, /error:\s*"unauthorized"/);
});

test("mcp : jeton vérifié par le serveur avec un client porteur du JWT (RLS)", () => {
  assert.match(code, /auth\.getUser\(token\)/, "getUser doit recevoir le jeton explicitement");
  assert.match(code, /global:\s*\{\s*headers:\s*\{\s*Authorization:/);
  assert.match(code, /persistSession:\s*false/);
  assert.match(code, /WebStandardStreamableHTTPServerTransport\(\{\s*sessionIdGenerator:\s*undefined/, "transport sans état");
});

test("mcp : tous les outils de la spec sont enregistrés, sans suppression de compte ni export", () => {
  for (const t of TOOLS) assert.match(code, new RegExp(`["']${t}["']`), `outil ${t} absent`);
  assert.doesNotMatch(code, /delete_me|export_all|delete_account|auth\.admin/);
});

test("mcp : budget et objectifs écrivent dans leurs tables, get_overview expose le score de santé", () => {
  assert.match(code, /from\("budgets"\)\.upsert\(\{\s*user_id:\s*user\.id,\s*lignes/, "update_budget : upsert de budgets sur l'utilisateur du jeton");
  assert.match(code, /onConflict:\s*"user_id"/);
  for (const t of ["objectifs"]) assert.match(code, new RegExp(`from\\("${t}"\\)\\.(insert|update|delete)`));
  assert.match(code, /z\.enum\(\["remplacer",\s*"fusionner"\]/, "update_budget : modes remplacer / fusionner");
  assert.match(code, /z\.enum\(\["revenu",\s*"depense",\s*"epargne"\]/);
  assert.match(code, /z\.enum\(\["apport",\s*"matelas",\s*"retraite",\s*"projet"\]/);
  assert.match(code, /min\(-50[^)]*\)\.max\(50/, "rendement borné à -50..50");
  assert.match(code, /sante:\s*scoreSante\(donnees,\s*"foyer"\)/, "get_overview : score de santé");
  assert.match(code, /function affecterDeja\(/);
  assert.match(code, /function effortMensuel\(/);
  assert.match(src, /pas un conseil en investissement/);
});

test("mcp : aucune clé de service", () => {
  assert.doesNotMatch(src, /SERVICE_ROLE|service_role|sb_secret_/i);
});

test("mcp : verify_jwt désactivé assumé (vérification faite par le serveur) et documenté", () => {
  assert.match(src, /verify_jwt\s*=\s*false/, "le commentaire d'en-tête doit expliquer verify_jwt = false");
});

test("mcp : deno.json épingle les dépendances npm", () => {
  const deno = JSON.parse(readFileSync(path("supabase/functions/mcp/deno.json"), "utf8"));
  const specs = Object.values(deno.imports);
  assert.ok(specs.length >= 5);
  for (const s of specs) assert.match(s, /^npm:(@[^/]+\/)?[^@/]+@\d+\.\d+\.\d+/, `version non épinglée : ${s}`);
  for (const imp of src.matchAll(/from\s+"([^"]+)"/g)) assert.ok(imp[1] in deno.imports, `import non mappé : ${imp[1]}`);
});

test("consentement : page autonome, scripts et appels OAuth attendus", () => {
  const html = readFileSync(path("web/oauth/consent.html"), "utf8");
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.includes('src="../config.js"'));
  assert.ok(html.includes('src="../app/consent.js"'));
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+\/dist\/umd\/supabase\.js" integrity="sha384-/);
  assert.match(html, /prefers-color-scheme:\s*dark/);
  const js = readFileSync(path("web/src/consent.js"), "utf8");
  for (const fn of ["getAuthorizationDetails", "approveAuthorization", "denyAuthorization", "signInWithPassword", "signInWithOtp"]) assert.ok(js.includes(fn), fn);
  assert.ok(js.includes("authorization_id"));
  assert.ok(js.includes("redirect_url"));
  assert.ok(existsSync(path("web/src/consent.js")));
});

const live = process.env.BOUSSOLE_LIVE === "1";
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "boussole-test", version: "1" } } };

test("en ligne : métadonnées de ressource protégée", { skip: !live && "BOUSSOLE_LIVE absent : test en ligne non exécuté" }, async () => {
  const res = await fetch(PRM_URL);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.resource, BASE);
  assert.deepEqual(body.authorization_servers, ["https://oapcewpqsbbjdlcdeizi.supabase.co/auth/v1"]);
});

test("en ligne : POST sans jeton → 401 + WWW-Authenticate ; jeton invalide → 401", { skip: !live && "BOUSSOLE_LIVE absent : test en ligne non exécuté" }, async () => {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  let res = await fetch(BASE, { method: "POST", headers, body: JSON.stringify(INIT) });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("www-authenticate"), `Bearer resource_metadata="${PRM_URL}"`);
  assert.equal((await res.json()).error, "unauthorized");
  res = await fetch(BASE, { method: "POST", headers: { ...headers, Authorization: "Bearer jeton.invalide.x" }, body: JSON.stringify(INIT) });
  assert.equal(res.status, 401);
  assert.ok(res.headers.get("www-authenticate").startsWith(`Bearer resource_metadata="${PRM_URL}"`));
});
