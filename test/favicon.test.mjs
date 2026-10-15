// Icône d'onglet : chaque page servie en porte une (data: URI), sinon le navigateur réclame /favicon.ico, qui n'existe pas (404 dans la console).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("pages sources et gabarit de la coque : une icône de type data: URI", () => {
  for (const f of ["web/index.html", "web/compte.html", "web/oauth/consent.html", "web/legal/confidentialite.html", "web/legal/mentions.html"])
    assert.match(readFileSync(f, "utf8"), /<link rel="icon" href="data:image\/svg\+xml,/, f);
  assert.match(readFileSync("build.mjs", "utf8"), /const HEAD = [^\n]*\+ ICONE/, "la coque (app.html) reçoit l'icône par l'en-tête commun");
});
