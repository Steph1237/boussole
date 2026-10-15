// `npm run preprod:test` : lance toute la suite, tests d'intégration compris, contre la pile locale (SEC5, spec § 3.7).
// Sans pile démarrée, les tests d'intégration restent sautés (comportement par défaut de `npm test`).
import { spawnSync } from "node:child_process";
import { garde, RACINE } from "./garde.mjs";
import { preparerEnv } from "./env.mjs";

garde();
const v = preparerEnv();
const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2).length ? process.argv.slice(2) : ["test/*.test.mjs"]], {
  cwd: RACINE,
  stdio: "inherit",
  env: { ...process.env, BOUSSOLE_SUPABASE_URL: v.url, BOUSSOLE_SUPABASE_KEY: v.publiable, SUPABASE_SERVICE_KEY: v.service },
});
process.exit(r.status ?? 1);
