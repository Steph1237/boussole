// Parité de configuration (SEC5, spec § 3.3/3.9) : preprod/config.toml ne diffère de supabase/config.toml (production)
// que par les clés listées ici. Analyse TOML minimale : sections [a.b] et lignes « clé = valeur » sur une ligne.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aplatir } from "../scripts/preprod/toml.mjs";

const lire = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

// Les seules clés qui diffèrent, avec la raison. Toute autre différence fait échouer le test.
export const DIFFERENCES_PERMISES = {
  "project_id": "conteneurs et volumes distincts",
  "auth.site_url": "redirections locales",
  "auth.additional_redirect_urls": "aucune redirection vers le site public",
  "auth.oauth_server.authorization_url_path": "page de consentement servie depuis dist-preprod/",
  "auth.rate_limit.token_refresh": "le banc crée et connecte un compte par cas",
  "auth.rate_limit.sign_in_sign_ups": "idem",
  "auth.rate_limit.token_verifications": "idem",
  // Ports : le CLI donne 54321-54329 à tous les projets ; d'autres piles locales de la machine les occupent déjà.
  "api.port": "collision avec d'autres piles locales (545xx)",
  "db.port": "idem",
  "db.shadow_port": "idem",
  "db.pooler.port": "idem",
  "studio.port": "idem",
  "inbucket.port": "idem",
  "analytics.port": "idem",
  "edge_runtime.inspector_port": "idem",
};

// Clés présentes seulement en préproduction (la production les laisse en commentaire).
export const CLES_AJOUTEES = {
  "api.auto_expose_new_tables": "les migrations comptent sur l'exposition automatique de la production (service_role sans GRANT explicite)",
};

describe("parité preprod/config.toml ↔ supabase/config.toml", () => {
  const prod = aplatir(lire("supabase/config.toml"));
  const pre = aplatir(lire("preprod/config.toml"));

  it("mêmes clés dans les deux fichiers, aux clés ajoutées près", () => {
    assert.deepEqual(Object.keys(pre).filter(k => !(k in CLES_AJOUTEES)).sort(), Object.keys(prod).sort());
    for (const k of Object.keys(CLES_AJOUTEES)) assert.ok(k in pre && !(k in prod), k);
  });

  it("seules les différences permises diffèrent", () => {
    const diff = Object.keys(prod).filter(k => prod[k] !== pre[k]);
    const inattendues = diff.filter(k => !(k in DIFFERENCES_PERMISES));
    assert.deepEqual(inattendues, [], `différences non listées : ${inattendues.map(k => `${k} (${prod[k]} → ${pre[k]})`).join(", ")}`);
    // Et chaque différence permise diffère bel et bien (pas de liste périmée).
    const inutiles = Object.keys(DIFFERENCES_PERMISES).filter(k => !diff.includes(k));
    assert.deepEqual(inutiles, [], "différences listées mais absentes");
  });

  it("préproduction : valeurs locales", () => {
    assert.equal(pre["project_id"], '"boussole-preprod"');
    assert.equal(pre["auth.site_url"], '"http://localhost:8780"');
    assert.equal(pre["auth.additional_redirect_urls"], '["http://localhost:8780/**"]');
    assert.equal(pre["auth.oauth_server.authorization_url_path"], '"/oauth/consent.html"');
    for (const k of ["token_refresh", "sign_in_sign_ups", "token_verifications"]) assert.equal(pre[`auth.rate_limit.${k}`], "1000");
  });

  it("ports de préproduction dans 545xx, distincts de ceux de la production (54321-54329)", () => {
    const ports = Object.keys(pre).filter(k => /(^|\.)(port|shadow_port|inspector_port)$/.test(k));
    assert.ok(ports.length >= 8);
    for (const k of ports) {
      assert.match(pre[k], k === "edge_runtime.inspector_port" ? /^8183$/ : /^545\d\d$/, k);
      assert.notEqual(pre[k], prod[k], k);
    }
  });

  it("le TOTP est activé des deux côtés (D7 : SEC2 est en ligne, un config push ne doit pas le couper)", () => {
    for (const cfg of [prod, pre]) {
      assert.equal(cfg["auth.mfa.totp.enroll_enabled"], "true");
      assert.equal(cfg["auth.mfa.totp.verify_enabled"], "true");
    }
  });

  it("aucune mention de la production dans la config de préproduction", () => {
    assert.ok(!/oapcewpqsbbjdlcdeizi|supabase\.co|steph1237/.test(lire("preprod/config.toml").split("\n").filter(l => !l.trim().startsWith("#")).join("\n")));
  });

  it("exposition automatique des nouvelles tables, comme la production", () => {
    assert.equal(pre["api.auto_expose_new_tables"], "true");
  });

  it("la graine est branchée", () => {
    assert.equal(pre["db.seed.sql_paths"], '["./seed.sql"]');
    assert.equal(pre["db.seed.enabled"], "true");
    assert.equal(pre["db.major_version"], "17");
  });
});

import { mkdtempSync, mkdirSync as mk, writeFileSync as wf, readdirSync, existsSync, readFileSync as rf, lstatSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparer } from "../scripts/preprod/preparer.mjs";

describe("preparer.mjs", () => {
  const depot = () => {
    const r = mkdtempSync(join(tmpdir(), "preparer-"));
    for (const d of ["preprod", "supabase/migrations", "supabase/functions/mcp"]) mk(join(r, d), { recursive: true });
    wf(join(r, "preprod/config.toml"), "project_id = \"x\"\n"); wf(join(r, "preprod/seed.sql"), "select 1;\n");
    wf(join(r, "supabase/migrations/0001_a.sql"), "select 2;\n"); wf(join(r, "supabase/functions/mcp/index.ts"), "// f\n");
    return r;
  };
  it("assemble config, graine, migrations et fonctions (copie)", () => {
    const r = depot();
    const w = preparer({ racine: r, lien: false });
    assert.equal(w, join(r, ".preprod"));
    assert.equal(rf(join(w, "supabase/config.toml"), "utf8"), "project_id = \"x\"\n");
    assert.equal(rf(join(w, "supabase/seed.sql"), "utf8"), "select 1;\n");
    assert.deepEqual(readdirSync(join(w, "supabase/migrations")), ["0001_a.sql"]);
    assert.ok(existsSync(join(w, "supabase/functions/mcp/index.ts")));
  });
  it("par défaut, functions/ est un lien vers le dépôt ; recréer .preprod/supabase ne touche pas à la cible", () => {
    const r = depot();
    const w = preparer({ racine: r });
    assert.equal(lstatSync(join(w, "supabase/functions")).isSymbolicLink(), true);
    assert.equal(readlinkSync(join(w, "supabase/functions")), join(r, "supabase/functions"));
    assert.ok(existsSync(join(w, "supabase/functions/mcp/index.ts")));
    preparer({ racine: r }); preparer({ racine: r, lien: false });
    assert.ok(existsSync(join(r, "supabase/functions/mcp/index.ts")), "la cible du lien est intacte");
    assert.equal(lstatSync(join(w, "supabase/functions")).isSymbolicLink(), false);
  });
  it("idempotent, et conserve les autres fichiers de .preprod/", () => {
    const r = depot();
    const w = preparer({ racine: r });
    wf(join(w, "comptes.json"), "{}"); wf(join(w, "supabase/intrus.txt"), "x");
    preparer({ racine: r });
    assert.ok(existsSync(join(w, "comptes.json")));
    assert.ok(!existsSync(join(w, "supabase/intrus.txt")));
  });
  it("refuse un dépôt lié à un projet", () => {
    const r = depot();
    mk(join(r, "supabase/.temp"), { recursive: true }); wf(join(r, "supabase/.temp/project-ref"), "oapcewpqsbbjdlcdeizi");
    assert.throws(() => preparer({ racine: r }), /lié/);
  });
  it("ne copie jamais supabase/.temp (lien éventuel) vers .preprod", () => {
    const r = depot();
    mk(join(r, "supabase/migrations/.temp"), { recursive: true });
    const w = preparer({ racine: r });
    assert.ok(!existsSync(join(w, "supabase/.temp/project-ref")));
  });
});
