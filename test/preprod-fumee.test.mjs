// Briques de la fumée (SEC5) : client MCP local, serveur de l'app, nouvel essai. Les parcours eux-mêmes demandent la pile (npm run preprod:fumee).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientMcp } from "../scripts/preprod/mcp-client.mjs";
import { demarrerServeur } from "../scripts/preprod/servir.mjs";
import { fonctionsPretes } from "../scripts/preprod/fonctions.mjs";
import { reessayer } from "../scripts/preprod/charger-foyer.mjs";

describe("client MCP et fonctions", () => {
  it("refuse une URL qui n'est pas la pile locale", () => {
    assert.throws(() => clientMcp("https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/mcp", "x"), /garde/);
    assert.doesNotThrow(() => clientMcp("http://127.0.0.1:54521/functions/v1/mcp", "x"));
  });
  it("fonctionsPretes refuse une URL distante avant tout appel réseau", async () => {
    await assert.rejects(() => fonctionsPretes("https://exemple.supabase.co"), /garde/);
  });
});

describe("serveur de l'app locale", () => {
  it("sert dist-preprod, écoute le bouclage seulement, refuse la sortie du dossier", async () => {
    const d = mkdtempSync(join(tmpdir(), "servir-"));
    mkdirSync(join(d, "oauth"));
    writeFileSync(join(d, "app.html"), "<p>ok</p>"); writeFileSync(join(d, "oauth/consent.html"), "<p>consent</p>"); writeFileSync(join(tmpdir(), "secret-hors-dossier.txt"), "secret");
    const s = await demarrerServeur({ dossier: d, port: 0 });
    try {
      const { address, port } = s.address();
      assert.equal(address, "127.0.0.1");
      const base = `http://127.0.0.1:${port}`;
      assert.equal(await (await fetch(`${base}/app.html`)).text(), "<p>ok</p>");
      assert.equal((await fetch(`${base}/oauth/consent.html?authorization_id=x`)).status, 200);
      assert.equal((await fetch(`${base}/nexiste.html`)).status, 404);
      assert.equal((await fetch(`${base}/..%2Fsecret-hors-dossier.txt`)).status, 404);
      assert.equal((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status, 404);
    } finally { s.close(); }
  });
});

describe("reessayer", () => {
  it("rejoue sur un délai d'attente puis réussit", async () => {
    let n = 0;
    const r = await reessayer(async () => (++n < 3 ? { error: { message: "The upstream server is timing out" } } : { data: 1 }), { pause: 1 });
    assert.equal(n, 3); assert.deepEqual(r, { data: 1 });
  });
  it("ne rejoue pas une vraie erreur", async () => {
    let n = 0;
    const r = await reessayer(async () => { n++; return { error: { message: "violates check constraint" } }; }, { pause: 1 });
    assert.equal(n, 1); assert.match(r.error.message, /check/);
  });
  it("rend la dernière erreur après les essais", async () => {
    const r = await reessayer(async () => ({ error: { message: "timed out" } }), { essais: 2, pause: 1 });
    assert.match(r.error.message, /timed out/);
  });
});
