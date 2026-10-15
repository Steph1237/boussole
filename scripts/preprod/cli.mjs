// Enveloppe du CLI Supabase pour la préproduction (SEC5, spec § 3.2) : toujours `--workdir .preprod`, jamais lié, jamais connecté.
// `verifierArgs` est pure (testée) : elle refuse les sous-commandes et options qui pourraient atteindre un projet distant.
//   node scripts/preprod/cli.mjs <sous-commande du CLI> [options]     ex. : node scripts/preprod/cli.mjs db reset --local
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPasDeLien, RACINE } from "./garde.mjs";

const SUPABASE = process.env.BOUSSOLE_SUPABASE_CLI || "/opt/homebrew/bin/supabase";

// Sous-commandes qui parlent à un projet distant ou à un compte : jamais depuis la préproduction.
const INTERDITES = [
  ["link"], ["unlink"], ["login"], ["logout"], ["projects"], ["orgs"], ["branches"], ["secrets"], ["db", "push"], ["db", "pull"], ["db", "dump"],
  ["config", "push"], ["functions", "deploy"], ["functions", "delete"], ["migration", "repair"], ["migration", "up"], ["gen", "types"],
  ["domains"], ["vanity-subdomains"], ["ssl-enforcement"], ["network-bans"], ["network-restrictions"], ["sso"], ["postgres-config"], ["snippets"],
];
const OPTIONS_INTERDITES = ["--linked", "--project-ref", "--project-id-remote", "--db-url", "--db-password", "--token", "--access-token"];

/** Lève une Error si la ligne de commande peut atteindre autre chose que la pile locale. Renvoie les arguments. */
export function verifierArgs(args) {
  if (!Array.isArray(args) || !args.length) throw new Error("préproduction : sous-commande Supabase manquante.");
  const mots = args.filter(a => !a.startsWith("-"));
  for (const interdite of INTERDITES) {
    if (interdite.every((m, i) => mots[i] === m)) throw new Error(`préproduction : « supabase ${interdite.join(" ")} » est interdite (elle vise un projet distant).`);
  }
  for (const a of args) {
    const nom = a.split("=")[0];
    if (OPTIONS_INTERDITES.includes(nom)) throw new Error(`préproduction : l'option ${nom} est interdite.`);
    if (nom === "--workdir") throw new Error("préproduction : --workdir est imposé (.preprod).");
  }
  const profil = args.indexOf("--profile");
  if (profil !== -1) throw new Error("préproduction : --profile est interdit.");
  return args;
}

/** Exécute le CLI sur .preprod. `options.capturer` renvoie la sortie au lieu de l'afficher. */
export function supabase(args, { racine = RACINE, capturer = false, env = {} } = {}) {
  verifierArgs(args);
  assertPasDeLien(racine);
  const r = spawnSync(SUPABASE, [...args, "--workdir", join(racine, ".preprod")], {
    cwd: racine,
    encoding: "utf8",
    stdio: capturer ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, DO_NOT_TRACK: "1", SUPABASE_TELEMETRY_DISABLED: "1", ...env },
  });
  if (r.error) throw r.error;
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { code } = supabase(process.argv.slice(2));
    process.exit(code);
  } catch (e) { console.error(e.message); process.exit(2); }
}
