// Aide de test Supabase (SEC5) : les tests d'intégration ne visent que la pile locale ; la production est refusée sauf BOUSSOLE_PROD=1.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resoudreCible, SKIP_REASON } from "./helpers/supabase.mjs";

const jwt = c => `x.${Buffer.from(JSON.stringify(c)).toString("base64url")}.y`;
const SERVICE_LOCALE = jwt({ iss: "supabase-demo", role: "service_role" });
const PUBLIABLE_LOCALE = "sb_publishable_" + "ACJWlzQHlZjBrEgu" + "HvfOxg_3BJgxAaH";
const LOCAL = { BOUSSOLE_SUPABASE_URL: "http://127.0.0.1:54521", BOUSSOLE_SUPABASE_KEY: PUBLIABLE_LOCALE, SUPABASE_SERVICE_KEY: SERVICE_LOCALE };
const SERVICE_PROD = jwt({ iss: "supabase", ref: "oapcewpqsbbjdlcdeizi", role: "service_role" });

describe("resoudreCible", () => {
  it("sans cible locale : inactive, avec une raison claire", () => {
    const c = resoudreCible({});
    assert.equal(c.actif, false);
    assert.match(c.raison, /préproduction locale non active/);
    assert.match(c.raison, /npm run preprod:test/);
  });
  it("une clé de service seule (sans URL) est ignorée, jamais utilisée contre la production", () => {
    const c = resoudreCible({ SUPABASE_SERVICE_KEY: SERVICE_PROD });
    assert.equal(c.actif, false);
    assert.equal(c.url, "");
    assert.match(c.raison, /ignorée/);
  });
  it("URL locale et clés locales : active, vise la pile locale", () => {
    const c = resoudreCible(LOCAL);
    assert.equal(c.actif, true);
    assert.equal(c.url, "http://127.0.0.1:54521");
    assert.equal(c.serviceKey, SERVICE_LOCALE);
  });
  it("clé de service de production avec l'URL de production : erreur (sans BOUSSOLE_PROD)", () => {
    assert.throws(() => resoudreCible({ BOUSSOLE_SUPABASE_URL: "https://oapcewpqsbbjdlcdeizi.supabase.co", BOUSSOLE_SUPABASE_KEY: PUBLIABLE_LOCALE, SUPABASE_SERVICE_KEY: SERVICE_PROD }), /garde/);
  });
  it("URL locale mais clé de service de production : erreur", () => {
    assert.throws(() => resoudreCible({ ...LOCAL, SUPABASE_SERVICE_KEY: SERVICE_PROD }), /production/);
  });
  it("URL de production seule : erreur", () => {
    assert.throws(() => resoudreCible({ BOUSSOLE_SUPABASE_URL: "https://oapcewpqsbbjdlcdeizi.supabase.co" }), /garde/);
  });
  it("URL locale, clé manquante : inactive et dit laquelle", () => {
    const c = resoudreCible({ BOUSSOLE_SUPABASE_URL: "http://127.0.0.1:54521", SUPABASE_SERVICE_KEY: SERVICE_LOCALE });
    assert.equal(c.actif, false);
    assert.match(c.raison, /BOUSSOLE_SUPABASE_KEY/);
  });
  it("BOUSSOLE_PROD=1 : la production est permise, URL lue dans web/config.js", () => {
    const c = resoudreCible({ BOUSSOLE_PROD: "1", SUPABASE_SERVICE_KEY: SERVICE_PROD });
    assert.equal(c.actif, true);
    assert.match(c.url, /^https:\/\/oapcewpqsbbjdlcdeizi\.supabase\.co$/);
  });
  it("BOUSSOLE_PROD autre que 1 : sans effet", () => {
    assert.throws(() => resoudreCible({ BOUSSOLE_PROD: "oui", BOUSSOLE_SUPABASE_URL: "https://oapcewpqsbbjdlcdeizi.supabase.co", BOUSSOLE_SUPABASE_KEY: PUBLIABLE_LOCALE, SUPABASE_SERVICE_KEY: SERVICE_PROD }), /garde/);
  });
});

describe("à l'import", () => {
  const importer = env => execFileSync(process.execPath, ["--input-type=module", "-e", 'import("./test/helpers/supabase.mjs").then(m => console.log(JSON.stringify({ actif: m.hasServiceKey, url: m.url })))'],
    { cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  it("sans environnement : tests sautés (hasServiceKey faux)", () => assert.deepEqual(JSON.parse(importer({})), { actif: false, url: "" }));
  it("environnement de production : l'import lève", () => {
    assert.throws(() => importer({ BOUSSOLE_SUPABASE_URL: "https://oapcewpqsbbjdlcdeizi.supabase.co", BOUSSOLE_SUPABASE_KEY: PUBLIABLE_LOCALE, SUPABASE_SERVICE_KEY: SERVICE_PROD }), /garde préproduction/);
  });
  it("SKIP_REASON exporté et lisible", () => assert.ok(SKIP_REASON.length > 40));
});
