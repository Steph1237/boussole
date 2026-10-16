// Démarre `supabase functions serve` (fonctions mcp, nightly, powens) en arrière-plan pour un script, et l'arrête ensuite.
// verify_jwt est réglé par fonction dans preprod/config.toml : mcp, nightly et powens font leur propre contrôle (jeton OAuth, jeton du Vault).
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RACINE, assertLocal } from "./garde.mjs";

const SCRIPT_CLI = resolve(fileURLToPath(new URL("./cli.mjs", import.meta.url)));

/** État des fonctions locales : "absentes" (aucune réponse), "sans-env" (elles répondent mais annoncent une autre ressource que la pile
 *  locale : servies sans .preprod/fonctions.env, donc avec les valeurs de production par défaut) ou "pretes". */
export async function etatFonctions(url) {
  assertLocal(url);
  try {
    const res = await fetch(`${url}/functions/v1/mcp/.well-known/oauth-protected-resource`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return "absentes";
    const corps = await res.json().catch(() => null);
    return corps?.resource === `${url}/functions/v1/mcp` ? "pretes" : "sans-env";
  } catch { return "absentes"; }
}

/** Vrai si le connecteur local répond ET s'annonce à l'adresse locale (variables de .preprod/fonctions.env chargées). */
export async function fonctionsPretes(url) {
  return (await etatFonctions(url)) === "pretes";
}

/** Renvoie { arreter() } ; si les fonctions tournent déjà (npm run preprod:fonctions ailleurs), ne lance rien. */
export async function demarrerFonctions(url, { racine = RACINE, delaiS = 120 } = {}) {
  const etat = await etatFonctions(url);
  if (etat === "pretes") return { arreter: async () => {}, lancees: false };
  if (etat === "sans-env") throw new Error("les fonctions locales sont servies sans .preprod/fonctions.env (elles annoncent l'adresse de production) : arrête-les puis `npm run preprod:fonctions`");
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
