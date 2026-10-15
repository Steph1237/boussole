// SEC5 : le connecteur lit BOUSSOLE_ENV / BOUSSOLE_PUBLIC_URL / BOUSSOLE_PUBLISHABLE_KEY (config-env.ts) sans changer la production.
// Même méthode que test/nightly-fonction.test.mjs : types retirés (stripTypeScriptTypes) puis exécution dans un contexte vm.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as nodeModule from "node:module";
import vm from "node:vm";

const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const dir = new URL("../supabase/functions/mcp/", import.meta.url);
const lire = f => readFileSync(new URL(f, dir), "utf8");

function charger() {
  const source = lire("config-env.ts");
  const noms = [...source.matchAll(/^export (?:const|function) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^export (const|function)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, { RegExp, Object, JSON });
}
const env = obj => k => obj[k];
// Valeurs de production telles que servies aujourd'hui (relevées avant SEC5).
const PROD = "https://oapcewpqsbbjdlcdeizi.supabase.co";
const PRODUCTION_PRM = '{"resource":"https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/mcp","authorization_servers":["https://oapcewpqsbbjdlcdeizi.supabase.co/auth/v1"],"bearer_methods_supported":["header"],"resource_name":"Boussole"}';

describe("config-env.ts : production inchangée sans variable", { skip: SANS_STRIP }, () => {
  const { configPublique } = charger();
  const c = configPublique(env({}));
  it("ressource protégée identique octet pour octet", () => assert.equal(JSON.stringify(c.protectedResource), PRODUCTION_PRM));
  it("WWW-Authenticate et métadonnées identiques", () => {
    assert.equal(c.resource, `${PROD}/functions/v1/mcp`);
    assert.equal(c.resourceMetadataUrl, `${PROD}/functions/v1/mcp/.well-known/oauth-protected-resource`);
    assert.equal(c.wwwAuthenticate, `Bearer resource_metadata="${PROD}/functions/v1/mcp/.well-known/oauth-protected-resource"`);
  });
  it("URL du projet et clé publiable de production par défaut", () => {
    assert.equal(c.supabaseUrl, PROD);
    assert.equal(c.publishableKey, "sb_publishable_o5IJJ2Cf6xf6sPCEWHLZag_b9HefoZ_");
  });
  it("jamais en échec fermé en production", () => { assert.equal(c.preprod, false); assert.equal(c.preprodInvalide, false); });
  it("SUPABASE_URL fourni par le runtime (production hébergée) reste pris tel quel", () => {
    assert.equal(configPublique(env({ SUPABASE_URL: PROD })).supabaseUrl, PROD);
    assert.equal(configPublique(env({ SUPABASE_URL: PROD })).preprodInvalide, false);
  });
  it("BOUSSOLE_ENV autre que preprod : aucun effet, même avec supabase.co", () => {
    assert.equal(configPublique(env({ BOUSSOLE_ENV: "prod", SUPABASE_URL: PROD })).preprodInvalide, false);
    assert.equal(configPublique(env({ BOUSSOLE_ENV: "" })).preprod, false);
  });
});

describe("config-env.ts : préproduction locale", { skip: SANS_STRIP }, () => {
  const { configPublique } = charger();
  const local = configPublique(env({ BOUSSOLE_ENV: "preprod", BOUSSOLE_PUBLIC_URL: "http://127.0.0.1:54521", SUPABASE_URL: "http://kong:8000", BOUSSOLE_PUBLISHABLE_KEY: "cle-locale" }));
  it("les métadonnées pointent vers la pile locale", () => {
    assert.equal(local.resource, "http://127.0.0.1:54521/functions/v1/mcp");
    assert.equal(JSON.stringify(local.protectedResource.authorization_servers), JSON.stringify(["http://127.0.0.1:54521/auth/v1"]));
    assert.equal(local.wwwAuthenticate, 'Bearer resource_metadata="http://127.0.0.1:54521/functions/v1/mcp/.well-known/oauth-protected-resource"');
    assert.equal(local.supabaseUrl, "http://kong:8000");
    assert.equal(local.publishableKey, "cle-locale");
    assert.ok(!JSON.stringify(local).includes("oapcewpqsbbjdlcdeizi"));
  });
  it("configuration valide : pas d'échec fermé", () => { assert.equal(local.preprod, true); assert.equal(local.preprodInvalide, false); });
  it("barre finale de l'URL publique retirée", () => assert.equal(configPublique(env({ BOUSSOLE_PUBLIC_URL: "http://127.0.0.1:54521/" })).resource, "http://127.0.0.1:54521/functions/v1/mcp"));
  it("échec fermé : URL publique supabase.co", () => assert.equal(configPublique(env({ BOUSSOLE_ENV: "preprod", BOUSSOLE_PUBLIC_URL: PROD, SUPABASE_URL: "http://kong:8000" })).preprodInvalide, true));
  it("échec fermé : SUPABASE_URL supabase.co", () => assert.equal(configPublique(env({ BOUSSOLE_ENV: "preprod", BOUSSOLE_PUBLIC_URL: "http://127.0.0.1:54521", SUPABASE_URL: "https://autre.supabase.co" })).preprodInvalide, true));
  it("échec fermé : SUPABASE_URL absent (la valeur par défaut est la production)", () => assert.equal(configPublique(env({ BOUSSOLE_ENV: "preprod", BOUSSOLE_PUBLIC_URL: "http://127.0.0.1:54521" })).preprodInvalide, true));
  it("échec fermé : URL publique absente (la valeur par défaut est la production)", () => assert.equal(configPublique(env({ BOUSSOLE_ENV: "preprod", SUPABASE_URL: "http://kong:8000" })).preprodInvalide, true));
  it("échec fermé insensible à la casse", () => assert.equal(configPublique(env({ BOUSSOLE_ENV: "preprod", BOUSSOLE_PUBLIC_URL: "https://X.SUPABASE.CO", SUPABASE_URL: "http://kong:8000" })).preprodInvalide, true));
});

describe("index.ts : câblage", () => {
  const index = lire("index.ts");
  const code = index.replace(/^\s*\/\/.*$/gm, "");
  it("lit la configuration par configPublique et applique l'échec fermé avant le CORS", () => {
    assert.match(code, /import \{ configPublique \} from "\.\/config-env\.ts"/);
    const i = code.indexOf("CFG.preprodInvalide"), j = code.indexOf('app.use("*", cors(');
    assert.ok(i > 0 && j > i, "le contrôle précède le CORS : toute requête, préflight compris, répond 500");
    assert.match(code.slice(i - 80, i + 220), /c\.json\([^)]*,\s*500\)/);
  });
  it("seul config-env.ts connaît l'URL de production du connecteur", () => {
    for (const f of readdirSync(dir).filter(f => f.endsWith(".ts") && f !== "config-env.ts")) assert.ok(!lire(f).includes("oapcewpqsbbjdlcdeizi"), f);
  });
});
