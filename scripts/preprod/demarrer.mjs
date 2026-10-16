// Démarrage de la préproduction locale (SEC5). Enchaîne : garde → préparer → supabase start → env → graine → exposition.
//   node scripts/preprod/demarrer.mjs            npm run preprod:start
//   node scripts/preprod/demarrer.mjs --reset    npm run preprod:reset   (db reset --local à la place du démarrage, puis graine)
//   node scripts/preprod/demarrer.mjs --sync     npm run preprod:sync    (recopie migrations et fonctions dans .preprod/)
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { garde, RACINE } from "./garde.mjs";
import { preparer } from "./preparer.mjs";
import { supabase } from "./cli.mjs";
import { preparerEnv } from "./env.mjs";
import { aplatir } from "./toml.mjs";
import { verifierExposition } from "./exposition.mjs";

// Services exclus (noms de conteneurs du CLI 2.107.0) pour tenir dans les 4 Go de colima, partagés avec d'autres piles locales :
// analytics, vecteur, imgproxy, mails (aucun e-mail n'est envoyé), et realtime / storage-api, que Boussole n'utilise pas.
// Studio et postgres-meta (≈ 300 Mo) ne démarrent que sur demande : PREPROD_STUDIO=1 npm run preprod:start.
export const EXCLUS_DE_BASE = ["logflare", "vector", "imgproxy", "mailpit", "realtime", "storage-api", "edge-runtime"];
export const EXCLUS_STUDIO = ["studio", "postgres-meta"];
export const exclus = (env = process.env) => [...EXCLUS_DE_BASE, ...(env.PREPROD_STUDIO === "1" ? [] : EXCLUS_STUDIO)].join(",");

export function portsDePreproduction(racine = RACINE) {
  const cfg = aplatir(readFileSync(join(racine, "preprod/config.toml"), "utf8"));
  return Object.entries(cfg).filter(([k]) => /(^|\.)(port|shadow_port)$/.test(k)).map(([, v]) => Number(v)).filter(Boolean);
}

function dockerPret() {
  const r = spawnSync("docker", ["info"], { encoding: "utf8" });
  return r.status === 0;
}

async function main() {
  const [mode] = process.argv.slice(2).filter(a => a.startsWith("--"));
  garde();
  if (mode === "--sync") { preparer(); console.log("migrations et fonctions recopiées dans .preprod/"); return; }
  if (!dockerPret()) { console.error("Docker ne répond pas : lance `colima start` (2 processeurs, 4 Go) puis relance."); process.exit(1); }
  preparer();
  if (mode === "--reset") {
    const r = supabase(["db", "reset", "--local"]);
    if (r.code !== 0) process.exit(r.code);
  } else {
    const r = supabase(["start", "-x", exclus()]);
    if (r.code !== 0) process.exit(r.code);
  }
  preparerEnv();
  if (existsSync(join(RACINE, "scripts/preprod/graine.mjs"))) {
    const { graine } = await import("./graine.mjs");
    await graine();
  }
  const alerte = verifierExposition(portsDePreproduction());
  if (alerte) console.error("\n" + alerte);
  console.log("\nPréproduction locale prête. Variables de test :  eval \"$(node scripts/preprod/env.mjs --export)\"");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
