// SEC5 : ni la CI ni les scripts de préproduction n'ont de voie vers la production (secrets, commandes distantes, URL).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const racine = new URL("..", import.meta.url).pathname;
const lire = f => readFileSync(join(racine, f), "utf8");
const sansCommentairesYaml = s => s.split("\n").filter(l => !l.trim().startsWith("#")).join("\n");
const sansCommentairesJs = s => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const INTERDIT = /supabase\s+(link|login|db push|db pull|db dump|config push|functions deploy|secrets|projects)|--linked|--db-url|--project-ref|SUPABASE_ACCESS_TOKEN/;

describe("workflows GitHub", () => {
  const workflows = readdirSync(join(racine, ".github/workflows")).filter(f => f.endsWith(".yml"));
  for (const f of workflows) {
    it(`${f} : aucun secret Supabase ni commande distante`, () => {
      const t = sansCommentairesYaml(lire(`.github/workflows/${f}`));
      assert.ok(!/SUPABASE_SERVICE_KEY/.test(t), "clé de service dans le workflow");
      assert.ok(!/secrets\.(SUPABASE|ANTHROPIC)/i.test(t), "secret Supabase ou Anthropic lu");
      assert.ok(!INTERDIT.test(t), "commande Supabase distante");
      assert.ok(!/oapcewpqsbbjdlcdeizi|supabase\.co/.test(t), "URL de production");
    });
  }
  it("pages.yml : npm test sans variable d'environnement de clé", () => {
    const t = lire(".github/workflows/pages.yml");
    assert.match(t, /- run: npm test\n/);
    assert.ok(!/npm test\s*\n\s+env:/.test(t));
  });
  it("preprod.yml : CLI Supabase épinglé à 2.107.0, pile locale, aucun déclencheur pull_request_target", () => {
    const t = lire(".github/workflows/preprod.yml");
    assert.match(t, /supabase\/setup-cli@v1[\s\S]{0,40}version: 2\.107\.0/);
    assert.match(t, /npm run preprod:start/);
    assert.match(t, /npm run preprod:test/);
    assert.ok(!/pull_request_target/.test(t));
    assert.match(t, /permissions:\s*\n\s+contents: read/);
  });
});

describe("scripts et commandes npm", () => {
  it("aucun script de préproduction n'appelle une commande distante (hors la liste de refus de cli.mjs)", () => {
    for (const f of readdirSync(join(racine, "scripts/preprod")).filter(f => f.endsWith(".mjs") && f !== "cli.mjs")) {
      assert.ok(!INTERDIT.test(sansCommentairesJs(lire(`scripts/preprod/${f}`))), f);
    }
    assert.ok(!INTERDIT.test(lire("package.json")), "package.json");
  });
  it("seuls cli.mjs lance le CLI Supabase, et seulement avec --workdir", () => {
    for (const f of readdirSync(join(racine, "scripts/preprod")).filter(f => f.endsWith(".mjs"))) {
      const t = sansCommentairesJs(lire(`scripts/preprod/${f}`));
      if (f !== "cli.mjs") assert.ok(!/spawn(Sync)?\(\s*["']?(\/opt\/homebrew\/bin\/)?supabase/.test(t), `${f} lance le CLI hors de l'enveloppe`);
    }
    assert.match(lire("scripts/preprod/cli.mjs"), /"--workdir", join\(racine, "\.preprod"\)/);
  });
  it("les scripts npm de préproduction passent tous par scripts/preprod/", () => {
    const sc = JSON.parse(lire("package.json")).scripts;
    for (const [nom, cmd] of Object.entries(sc).filter(([n]) => n.startsWith("preprod:"))) assert.match(cmd, /scripts\/preprod\/|build\.mjs --config=preprod/, nom);
    for (const n of ["preprod:start", "preprod:stop", "preprod:seed", "preprod:test", "preprod:reset", "preprod:sync"]) assert.ok(n in sc, n);
  });
  it("les tests et la fumée ne contiennent aucune URL de production exécutable", () => {
    for (const f of ["test/helpers/supabase.mjs", "scripts/preprod/fumee.mjs", "scripts/preprod/connecteur-mfa.mjs", "scripts/preprod/graine.mjs", "scripts/preprod/env.mjs"]) {
      const t = sansCommentairesJs(lire(f));
      assert.ok(!/https?:\/\/[a-z0-9]+\.supabase\.co/.test(t), `${f} : URL supabase.co`);
    }
  });
  it(".gitignore : .preprod/, dist-preprod/, résultats du banc", () => {
    const g = lire(".gitignore");
    for (const l of [".preprod/", "dist-preprod/", "banc/resultats/", "banc/porte.json"]) assert.ok(g.split("\n").includes(l), l);
  });
});
