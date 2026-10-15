// Enveloppe du CLI Supabase (SEC5) : aucune commande vers un projet distant n'est possible.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifierArgs } from "../scripts/preprod/cli.mjs";

describe("verifierArgs", () => {
  for (const ok of [["start", "-x", "logflare,vector"], ["stop"], ["status", "-o", "env"], ["db", "reset", "--local"], ["db", "query", "--local", "select 1"],
    ["db", "advisors", "--local"], ["functions", "serve", "--no-verify-jwt", "--env-file", ".preprod/fonctions.env"], ["test", "db"]]) {
    it(`accepte ${ok.join(" ")}`, () => assert.deepEqual(verifierArgs(ok), ok));
  }
  for (const ko of [["link", "--project-ref", "x"], ["login"], ["db", "push"], ["db", "pull"], ["db", "dump"], ["config", "push"], ["functions", "deploy", "mcp"],
    ["secrets", "set", "A=b"], ["projects", "list"], ["db", "reset", "--linked"], ["db", "query", "--linked", "select 1"], ["db", "advisors", "--linked"],
    ["db", "reset", "--db-url", "postgresql://x"], ["status", "--project-ref", "oapcewpqsbbjdlcdeizi"], ["start", "--workdir", "../Finance"],
    ["functions", "serve", "--token", "x"], ["gen", "types"], ["migration", "up", "--linked"], ["branches", "list"], ["start", "--profile", "autre"]]) {
    it(`refuse ${ko.join(" ")}`, () => assert.throws(() => verifierArgs(ko), /préproduction/));
  }
  it("refuse une ligne vide", () => assert.throws(() => verifierArgs([]), /manquante/));
  it("refuse l'option collée par =", () => assert.throws(() => verifierArgs(["db", "reset", "--db-url=postgresql://x"]), /interdite/));
});
