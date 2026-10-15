// Variables locales (SEC5) : analyse de `supabase status -o env`, contrôle de la garde, fichiers générés.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { parserStatus, variablesLocales, contenuFonctionsEnv, contenuWebConfig, preparerEnv, lignesExport } from "../scripts/preprod/env.mjs";

const jwt = (c) => `x.${Buffer.from(JSON.stringify(c)).toString("base64url")}.y`;
const ANON = jwt({ iss: "supabase-demo", role: "anon" });
const SERVICE = jwt({ iss: "supabase-demo", role: "service_role" });
const PUBLIABLE = "sb_publishable_" + "ACJWlzQHlZjBrEgu" + "HvfOxg_3BJgxAaH";
const STATUS = `Using workdir .preprod
Stopped services: [a b]
ANON_KEY="${ANON}"
API_URL="http://127.0.0.1:54521"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54522/postgres"
PUBLISHABLE_KEY="${PUBLIABLE}"
SERVICE_ROLE_KEY="${SERVICE}"
A new version of Supabase CLI is available`;

describe("parserStatus", () => {
  it("lit les lignes CLE=\"valeur\" et ignore le bruit", () => {
    const s = parserStatus(STATUS);
    assert.equal(s.API_URL, "http://127.0.0.1:54521");
    assert.equal(s.SERVICE_ROLE_KEY, SERVICE);
    assert.equal(Object.keys(s).length, 5);
  });
});

describe("variablesLocales", () => {
  it("accepte une pile locale", () => {
    const v = variablesLocales(parserStatus(STATUS));
    assert.equal(v.url, "http://127.0.0.1:54521");
    assert.equal(v.publiable, PUBLIABLE);
  });
  it("refuse une URL de production", () => assert.throws(() => variablesLocales({ ...parserStatus(STATUS), API_URL: "https://oapcewpqsbbjdlcdeizi.supabase.co" }), /garde/));
  it("refuse une clé de service de production", () => assert.throws(() => variablesLocales({ ...parserStatus(STATUS), SERVICE_ROLE_KEY: jwt({ iss: "supabase", ref: "oapcewpqsbbjdlcdeizi", role: "service_role" }) }), /production/));
  it("refuse une base non locale", () => assert.throws(() => variablesLocales({ ...parserStatus(STATUS), DB_URL: "postgresql://postgres:x@db.oapcewpqsbbjdlcdeizi.supabase.co:5432/postgres" }), /base/));
});

describe("fichiers générés", () => {
  const v = variablesLocales(parserStatus(STATUS));
  it("fonctions.env : variables de préproduction, hors ligne", () => {
    const e = contenuFonctionsEnv(v);
    assert.match(e, /^BOUSSOLE_ENV=preprod$/m);
    assert.match(e, /^BOUSSOLE_PUBLIC_URL=http:\/\/127\.0\.0\.1:54521$/m);
    assert.match(e, /^BOUSSOLE_HORS_LIGNE=1$/m);
    assert.ok(!e.includes(SERVICE), "pas de clé de service");
  });
  it("web-config.js : config exécutable, locale, sans client Claude", () => {
    const ctx = { window: {} };
    vm.runInNewContext(contenuWebConfig(v), ctx);
    const b = ctx.window.BOUSSOLE;
    assert.equal(b.supabaseUrl, "http://127.0.0.1:54521");
    assert.equal(b.mcpUrl, "http://127.0.0.1:54521/functions/v1/mcp");
    assert.equal(b.claude.clientId, "");
    assert.equal(b.supabaseKey, PUBLIABLE);
    assert.ok(!JSON.stringify(b).includes("oapcewpqsbbjdlcdeizi"));
  });
  it("preparerEnv écrit les fichiers (droits 600) sans la clé de service", () => {
    const r = mkdtempSync(join(tmpdir(), "env-"));
    preparerEnv({ racine: r, statusTexte: STATUS });
    for (const f of ["fonctions.env", "web-config.js"]) {
      assert.equal(statSync(join(r, ".preprod", f)).mode & 0o777, 0o600);
      assert.ok(!readFileSync(join(r, ".preprod", f), "utf8").includes(SERVICE));
    }
  });
  it("lignesExport : URL, clé publiable, clé de service", () => {
    const l = lignesExport(v);
    assert.match(l, /BOUSSOLE_SUPABASE_URL='http:\/\/127\.0\.0\.1:54521'/);
    assert.match(l, /SUPABASE_SERVICE_KEY=/);
  });
});
