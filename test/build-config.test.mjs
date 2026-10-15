// build.mjs --config=preprod (SEC5) : le front de préproduction a sa propre config.js ; la production reste celle de web/config.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const racine = process.cwd();
const build = (...args) => spawnSync(process.execPath, ["build.mjs", ...args], { cwd: racine, encoding: "utf8" });
const CONFIG_LOCALE = 'window.BOUSSOLE = { supabaseUrl: "http://127.0.0.1:54521", supabaseKey: "cle-locale", base: "./", mcpUrl: "http://127.0.0.1:54521/functions/v1/mcp", claude: { clientId: "" }, emails: false };\n';

function dossier() { return mkdtempSync(join(tmpdir(), "boussole-build-config-")); }

test("build sans option : dist/config.js reste celui de production (web/config.js)", () => {
  const d = dossier();
  try {
    const r = build("--out=" + join(d, "site"));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(d, "site/config.js"), "utf8"), readFileSync(join(racine, "web/config.js"), "utf8"));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("build --config=preprod : config.js locale, rien de la production dans la sortie", () => {
  const d = dossier();
  try {
    writeFileSync(join(d, "web-config.js"), CONFIG_LOCALE);
    const r = build("--config=preprod", "--config-file=" + join(d, "web-config.js"), "--out=" + join(d, "site"));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(d, "site/config.js"), "utf8"), CONFIG_LOCALE);
    assert.ok(existsSync(join(d, "site/app.html")) && existsSync(join(d, "site/oauth/consent.html")), "page de consentement incluse");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("build --config=preprod sans --out : écrit dans dist-preprod/ (ignoré par git)", () => {
  const d = dossier();
  try {
    writeFileSync(join(d, "web-config.js"), CONFIG_LOCALE);
    const r = build("--config=preprod", "--config-file=" + join(d, "web-config.js"));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^dist-preprod\//);
    assert.equal(readFileSync(join(racine, "dist-preprod/config.js"), "utf8"), CONFIG_LOCALE);
    assert.match(execFileSync("git", ["check-ignore", "dist-preprod/config.js"], { cwd: racine, encoding: "utf8" }), /dist-preprod/);
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(join(racine, "dist-preprod"), { recursive: true, force: true }); }
});

test("build --config=preprod : refuse une configuration qui nomme la production", () => {
  const d = dossier();
  try {
    writeFileSync(join(d, "web-config.js"), readFileSync(join(racine, "web/config.js"), "utf8"));
    const r = build("--config=preprod", "--config-file=" + join(d, "web-config.js"), "--out=" + join(d, "site"));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /production/);
    assert.ok(!existsSync(join(d, "site")), "rien n'est écrit");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("build --config=preprod : fichier de configuration absent → message clair", () => {
  const r = build("--config=preprod", "--config-file=/nexiste/pas.js", "--out=" + join(tmpdir(), "boussole-build-absent"));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /introuvable/);
});

test("build --config=autre : refusé", () => {
  const r = build("--config=staging");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /preprod/);
});
