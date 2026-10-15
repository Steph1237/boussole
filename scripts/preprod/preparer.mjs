// Assemble .preprod/supabase/ (SEC5, spec § 3.3) : config locale, graine, copies de supabase/migrations et supabase/functions.
// Idempotent : le dossier est recréé à chaque appel. Il n'est jamais lié à un projet distant (aucun project-ref).
//   node scripts/preprod/preparer.mjs            assemble
//   node scripts/preprod/preparer.mjs --lien     functions/ en lien symbolique au lieu d'une copie (essai de la tâche 1.4)
import { cpSync, mkdirSync, rmSync, copyFileSync, symlinkSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertChemin, assertPasDeLien, RACINE } from "./garde.mjs";

/** Renvoie le dossier --workdir à passer au CLI (`.preprod`). */
export function preparer({ racine = RACINE, lien = false } = {}) {
  assertPasDeLien(racine);
  const workdir = assertChemin(join(racine, ".preprod"), racine);
  const sup = join(workdir, "supabase");
  for (const src of ["preprod/config.toml", "preprod/seed.sql", "supabase/migrations", "supabase/functions"]) {
    if (!existsSync(join(racine, src))) throw new Error(`préparer : ${src} introuvable`);
  }
  // On conserve .preprod/ (comptes.json, fonctions.env…) ; seul supabase/ est recréé.
  rmSync(sup, { recursive: true, force: true });
  mkdirSync(sup, { recursive: true });
  copyFileSync(join(racine, "preprod/config.toml"), join(sup, "config.toml"));
  copyFileSync(join(racine, "preprod/seed.sql"), join(sup, "seed.sql"));
  cpSync(join(racine, "supabase/migrations"), join(sup, "migrations"), { recursive: true });
  if (lien) symlinkSync(join(racine, "supabase/functions"), join(sup, "functions"), "dir");
  else cpSync(join(racine, "supabase/functions"), join(sup, "functions"), { recursive: true });
  return workdir;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const w = preparer({ lien: process.argv.includes("--lien") });
  const n = readdirSync(join(w, "supabase/migrations")).filter(f => f.endsWith(".sql")).length;
  console.log(`.preprod/supabase prêt : ${n} migrations, fonctions ${process.argv.includes("--lien") ? "(lien)" : "(copie)"}, graine, config locale`);
}
