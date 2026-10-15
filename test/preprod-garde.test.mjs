// Garde « jamais la production » (SEC5, spec § 3.8) : chaque refus est couvert.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { assertLocal, assertCleLocale, assertPasDeLien, assertChemin, REF_PRODUCTION } from "../scripts/preprod/garde.mjs";

const jwt = (charge) => `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify(charge)).toString("base64url")}.signature`;
const PROD = "https://oapcewpqsbbjdlcdeizi.supabase.co";

describe("assertLocal", () => {
  for (const ok of ["http://127.0.0.1:54321", "http://localhost:8780", "http://kong:8000", "http://127.0.0.1:54321/functions/v1/mcp", "http://[::1]:54321"]) {
    it(`accepte ${ok}`, () => assert.doesNotThrow(() => assertLocal(ok)));
  }
  for (const ko of [PROD, `${PROD}/functions/v1/mcp`, "https://autre.supabase.co", "https://127.0.0.1:54321", "http://exemple.com", "http://localhost.evil.com", "http://127.0.0.1.evil.com", "http://kong:9999", "http://oapcewpqsbbjdlcdeizi.localhost", "", "pas une url", undefined, null]) {
    it(`refuse ${JSON.stringify(ko)}`, () => assert.throws(() => assertLocal(ko), /garde|préproduction|local/i));
  }
  it("renvoie l'URL acceptée", () => assert.equal(assertLocal("http://127.0.0.1:54321"), "http://127.0.0.1:54321"));
});

describe("assertCleLocale", () => {
  it("accepte une clé JWT émise par la pile locale", () => assert.doesNotThrow(() => assertCleLocale(jwt({ iss: "supabase-demo", role: "service_role", exp: 1983812996 }))));
  it("refuse un ref de production, quel que soit l'émetteur", () => {
    assert.throws(() => assertCleLocale(jwt({ iss: "supabase", ref: REF_PRODUCTION, role: "service_role" })), /production/i);
    assert.throws(() => assertCleLocale(jwt({ iss: "supabase-demo", ref: REF_PRODUCTION, role: "anon" })), /production/i);
  });
  it("refuse tout ref (une clé locale n'en porte pas) et un émetteur inconnu", () => {
    assert.throws(() => assertCleLocale(jwt({ iss: "supabase", ref: "abcdefghijklmnopqrst", role: "service_role" })));
    assert.throws(() => assertCleLocale(jwt({ iss: "https://x.supabase.co/auth/v1", role: "service_role" })));
    assert.throws(() => assertCleLocale(jwt({ role: "service_role" })));
  });
  it("refuse la clé publiable de production", () => assert.throws(() => assertCleLocale("sb_publishable_o5IJJ2Cf6xf6sPCEWHLZag_b9HefoZ_"), /production/i));
  it("refuse une chaîne vide ou illisible", () => {
    assert.throws(() => assertCleLocale(""));
    assert.throws(() => assertCleLocale(undefined));
    assert.throws(() => assertCleLocale("pas-une-cle"));
    assert.throws(() => assertCleLocale("a.b.c"));
  });
  it("accepte les clés sb_ de la pile locale du CLI (début des clés par défaut)", () => {
    assert.doesNotThrow(() => assertCleLocale("sb_publishable_" + "ACJWlzQHlZjBrEgu" + "HvfOxg_3BJgxAaH"));
    assert.doesNotThrow(() => assertCleLocale("sb_secret_" + "N7UND0UgjKTVK" + "-Uodkm0Hg_xSvEMPvz"));
  });
  it("refuse une clé sb_ qui n'est pas celle de la pile locale", () => {
    assert.throws(() => assertCleLocale("sb_secret_inconnue"));
    assert.throws(() => assertCleLocale("sb_secret_" + "Zq81Lm2Xv9TrBw4NcKd7Ye_AbCdEfGhIjKl"), /pile locale/);
    assert.throws(() => assertCleLocale("sb_publishable_" + "Zq81Lm2Xv9TrBw4NcKd7Ye_AbCdEfGhIjKl"), /pile locale/);
  });
});

describe("assertPasDeLien", () => {
  const racine = () => mkdtempSync(join(tmpdir(), "garde-"));
  it("accepte un dépôt sans lien", () => assert.doesNotThrow(() => assertPasDeLien(racine())));
  it("refuse supabase/.temp/project-ref", () => {
    const r = racine(); mkdirSync(join(r, "supabase/.temp"), { recursive: true }); writeFileSync(join(r, "supabase/.temp/project-ref"), REF_PRODUCTION);
    assert.throws(() => assertPasDeLien(r), /lié/i);
  });
  it("refuse .preprod/supabase/.temp/project-ref", () => {
    const r = racine(); mkdirSync(join(r, ".preprod/supabase/.temp"), { recursive: true }); writeFileSync(join(r, ".preprod/supabase/.temp/project-ref"), "x");
    assert.throws(() => assertPasDeLien(r), /lié/i);
  });
});

describe("assertChemin", () => {
  const racine = mkdtempSync(join(tmpdir(), "garde-chemin-"));
  it("accepte le dépôt et .preprod/", () => {
    assert.doesNotThrow(() => assertChemin(join(racine, "banc/foyers/x.json"), racine));
    assert.doesNotThrow(() => assertChemin(join(racine, ".preprod/comptes.json"), racine));
  });
  it("refuse un chemin hors du dépôt", () => {
    assert.throws(() => assertChemin("/etc/passwd", racine));
    assert.throws(() => assertChemin(join(racine, "../autre/x"), racine));
  });
  it("refuse nommément ~/Finance/sources", () => {
    assert.throws(() => assertChemin(join(homedir(), "Finance/sources/releve.csv"), racine), /sources/);
    assert.throws(() => assertChemin(join(racine, "Finance/sources/x"), racine), /sources/);
  });
  it("refuse un lien symbolique-évitement par ..", () => assert.throws(() => assertChemin(join(racine, "banc/../../x"), racine)));
});

describe("dépôt sans secret", () => {
  const racineDepot = new URL("..", import.meta.url).pathname;
  const fichiers = execFileSync("git", ["ls-files"], { cwd: racineDepot, encoding: "utf8" }).split("\n").filter(Boolean)
    .filter(f => !/\.(png|jpg|ico|woff2?|gz)$/.test(f) && f !== "package-lock.json");
  const motifs = [
    ["clé API Anthropic", /sk-ant-[A-Za-z0-9_-]{10,}/],
    ["clé secrète Supabase", /sb_secret_[A-Za-z0-9_-]{10,}/],
    ["JWT service_role", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\./],
  ];
  it("aucun secret dans les fichiers suivis", () => {
    const fautes = [];
    for (const f of fichiers) {
      let src; try { src = readFileSync(join(racineDepot, f), "utf8"); } catch { continue; }
      for (const [nom, re] of motifs) if (re.test(src)) fautes.push(`${f} : ${nom}`);
    }
    assert.deepEqual(fautes, []);
  });
});
