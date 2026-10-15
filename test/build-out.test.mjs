// build.mjs --out=<dossier> : un chemin absolu s'écrit là où il est demandé (pas sous le dépôt) ; un chemin relatif reste relatif au dépôt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const racine = process.cwd();
const construire = out => execFileSync(process.execPath, ["build.mjs", "--out=" + out], { cwd: racine, encoding: "utf8" });

test("build --out : un chemin absolu écrit à cet endroit, rien sous le dépôt", () => {
  const dossier = mkdtempSync(join(tmpdir(), "boussole-build-"));
  const sortie = join(dossier, "site");
  try {
    construire(sortie);
    assert.ok(existsSync(join(sortie, "app.html")), "app.html dans le dossier demandé");
    assert.ok(existsSync(join(sortie, "index.html")));
    assert.ok(!existsSync(join(racine, sortie)), "pas de copie sous le dépôt : " + join(racine, sortie));
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test("build --out : un chemin relatif reste relatif au dépôt", () => {
  const rel = "dist-test-out-relatif";
  try {
    construire(rel);
    assert.ok(existsSync(join(racine, rel, "app.html")));
  } finally { rmSync(join(racine, rel), { recursive: true, force: true }); }
});
