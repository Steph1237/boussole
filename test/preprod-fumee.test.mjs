// Briques de la fumée (SEC5) : client MCP local, serveur de l'app, nouvel essai. Les parcours eux-mêmes demandent la pile (npm run preprod:fumee).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientMcp } from "../scripts/preprod/mcp-client.mjs";
import { demarrerServeur } from "../scripts/preprod/servir.mjs";
import { createServer } from "node:http";
import { fonctionsPretes, etatFonctions, demarrerFonctions } from "../scripts/preprod/fonctions.mjs";
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

/** Faux connecteur local : répond à la route de métadonnées avec la ressource demandée (ou un statut d'erreur). */
async function fauxConnecteur(reponse) {
  const srv = createServer((req, res) => {
    if (typeof reponse === "number") { res.statusCode = reponse; res.end("{}"); return; }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ resource: reponse(srv.address().port) }));
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  return { srv, url: `http://127.0.0.1:${srv.address().port}`, fermer: () => new Promise(r => srv.close(r)) };
}

describe("fonctions locales : env local obligatoire", () => {
  it("prêtes seulement si elles annoncent la ressource locale ; sinon « sans-env » (valeurs de production par défaut) ou « absentes »", async () => {
    const bonnes = await fauxConnecteur(port => `http://127.0.0.1:${port}/functions/v1/mcp`);
    const prod = await fauxConnecteur(() => "https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/mcp");
    const panne = await fauxConnecteur(503);
    try {
      assert.equal(await etatFonctions(bonnes.url), "pretes");
      assert.equal(await fonctionsPretes(bonnes.url), true);
      assert.equal(await etatFonctions(prod.url), "sans-env");
      assert.equal(await fonctionsPretes(prod.url), false);
      assert.equal(await etatFonctions(panne.url), "absentes");
    } finally { await Promise.all([bonnes, prod, panne].map(x => x.fermer())); }
  });
  it("demarrerFonctions : ne relance rien si elles sont prêtes ; refuse (sans rien lancer) des fonctions servies sans env local", async () => {
    const bonnes = await fauxConnecteur(port => `http://127.0.0.1:${port}/functions/v1/mcp`);
    const prod = await fauxConnecteur(() => "https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/mcp");
    try {
      assert.equal((await demarrerFonctions(bonnes.url)).lancees, false);
      await assert.rejects(() => demarrerFonctions(prod.url), /sans \.preprod\/fonctions\.env/);
    } finally { await Promise.all([bonnes, prod].map(x => x.fermer())); }
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

import { fichiersIntegration } from "../scripts/preprod/tester.mjs";
describe("npm run preprod:test", () => {
  it("lance les fichiers qui ont besoin de la pile, pas la suite PGlite", () => {
    const f = fichiersIntegration();
    for (const attendu of ["test/isolation.test.mjs", "test/journal-db.test.mjs", "test/savoir-db.test.mjs", "test/nightly.test.mjs", "test/preprod-graine.test.mjs", "test/mcp.test.mjs"]) assert.ok(f.includes(attendu), attendu);
    assert.ok(!f.includes("test/projection.test.mjs") && !f.includes("test/calendrier-pglite.test.mjs"));
    assert.ok(f.length < 15, `${f.length} fichiers`);
  });
});
