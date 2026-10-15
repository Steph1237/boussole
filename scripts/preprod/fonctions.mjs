// Démarre `supabase functions serve` (fonctions mcp, nightly, powens) en arrière-plan pour un script, et l'arrête ensuite.
// verify_jwt est réglé par fonction dans preprod/config.toml : mcp, nightly et powens font leur propre contrôle (jeton OAuth, jeton du Vault).
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RACINE, assertLocal } from "./garde.mjs";

const SCRIPT_CLI = resolve(fileURLToPath(new URL("./cli.mjs", import.meta.url)));

/** Vrai si le connecteur local répond (métadonnées de ressource protégée). */
export async function fonctionsPretes(url) {
  assertLocal(url);
  try { return (await fetch(`${url}/functions/v1/mcp/.well-known/oauth-protected-resource`, { signal: AbortSignal.timeout(8000) })).ok; } catch { return false; }
}

/** Renvoie { arreter() } ; si les fonctions tournent déjà (npm run preprod:fonctions ailleurs), ne lance rien. */
export async function demarrerFonctions(url, { racine = RACINE, delaiS = 120 } = {}) {
  if (await fonctionsPretes(url)) return { arreter: async () => {}, lancees: false };
  const enfant = spawn(process.execPath, [SCRIPT_CLI, "functions", "serve", "--env-file", join(racine, ".preprod/fonctions.env")], {
    cwd: racine, stdio: ["ignore", "ignore", "ignore"], detached: false,
  });
  for (let i = 0; i < delaiS / 2; i++) {
    if (await fonctionsPretes(url)) return { arreter: async () => { enfant.kill("SIGINT"); await new Promise(r => setTimeout(r, 1500)); }, lancees: true };
    await new Promise(r => setTimeout(r, 2000));
  }
  enfant.kill("SIGINT");
  throw new Error("les fonctions locales ne répondent pas (supabase functions serve)");
}
