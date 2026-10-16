// `npm run preprod:test` : les tests qui ont besoin de la pile locale (SEC5, spec § 3.7), l'un après l'autre : isolation RLS, journal, savoir,
// nuit (SQL), comptes fictifs (aal1 / aal2) et les contrôles « en ligne » du connecteur (les fonctions sont servies avec .preprod/fonctions.env
// si elles ne tournent pas déjà : npm run preprod:fonctions). La voie rapide et complète reste `npm test` (PGlite, sans Docker) ; en CI les deux tournent. Les deux suites ne se lancent pas
// ensemble sur une machine à 2 processeurs : les ~80 fichiers CPU de PGlite affament la pile et font expirer GoTrue.
//   node scripts/preprod/tester.mjs            fichiers d'intégration seulement
//   node scripts/preprod/tester.mjs --tout     toute la suite avec la pile (CI à plus de processeurs)
//   node scripts/preprod/tester.mjs <fichiers> ces fichiers
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { garde, RACINE } from "./garde.mjs";
import { preparerEnv } from "./env.mjs";
import { demarrerFonctions } from "./fonctions.mjs";

/** Fichiers de test qui visent la pile locale (via test/helpers/supabase.mjs) ou ses fonctions (contrôles « en ligne » de mcp.test.mjs). */
export function fichiersIntegration(racine = RACINE) {
  const dir = join(racine, "test");
  return readdirSync(dir).filter(f => f.endsWith(".test.mjs")).sort()
    .filter(f => /helpers\/supabase\.mjs/.test(readFileSync(join(dir, f), "utf8")) || f === "mcp.test.mjs")
    .map(f => `test/${f}`);
}

async function main() {
  garde();
  const v = preparerEnv();
  const args = process.argv.slice(2);
  const fichiers = args.includes("--tout") ? ["test/*.test.mjs"] : args.length ? args : fichiersIntegration();
  // Les contrôles « en ligne » (mcp.test.mjs) ont besoin des fonctions locales, servies avec .preprod/fonctions.env si elles ne tournent pas déjà.
  const aBesoin = fichiers.some(f => /(^|\/)(mcp\.test\.mjs|\*\.test\.mjs)$/.test(f));
  const fonctions = aBesoin ? await demarrerFonctions(v.url) : { arreter: async () => {} };
  const enLigne = aBesoin ? { BOUSSOLE_LIVE: "1" } : {};
  const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...fichiers], {
    cwd: RACINE,
    stdio: "inherit",
    env: { ...process.env, ...enLigne, BOUSSOLE_SUPABASE_URL: v.url, BOUSSOLE_SUPABASE_KEY: v.publiable, SUPABASE_SERVICE_KEY: v.service },
  });
  await fonctions.arreter();
  process.exit(r.status ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
