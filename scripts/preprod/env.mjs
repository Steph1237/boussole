// Variables de la pile locale (SEC5, spec § 3.6/3.7). Lit `supabase status -o env`, contrôle par la garde que tout est local,
// écrit .preprod/fonctions.env (variables des fonctions) et .preprod/web-config.js (config du front), et imprime les
// variables de test à exporter :   eval "$(node scripts/preprod/env.mjs --export)"
// La clé de service locale n'est JAMAIS écrite dans un fichier : elle n'est imprimée que pour un `eval` (publique par construction,
// mais le dépôt n'en garde aucune trace).
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocal, assertCleLocale, assertChemin, RACINE } from "./garde.mjs";
import { supabase } from "./cli.mjs";

/** Analyse la sortie `supabase status -o env` (lignes CLE="valeur") ; ignore le bruit (messages du CLI). */
export function parserStatus(texte) {
  const out = {};
  for (const l of String(texte).split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Contrôle et normalise : { url, publiable, anon, service, dbUrl }. Lève si quoi que ce soit n'est pas local. */
export function variablesLocales(status) {
  const url = assertLocal(status.API_URL);
  const publiable = assertCleLocale(status.PUBLISHABLE_KEY || status.ANON_KEY);
  const anon = status.ANON_KEY ? assertCleLocale(status.ANON_KEY) : null;
  const service = assertCleLocale(status.SERVICE_ROLE_KEY);
  const dbUrl = status.DB_URL || "";
  if (dbUrl && !/@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl)) throw new Error("garde préproduction : la base n'est pas locale.");
  return { url, publiable, anon, service, dbUrl };
}

export function contenuFonctionsEnv({ url, publiable }) {
  return [
    "# Généré par scripts/preprod/env.mjs : ne pas versionner.",
    "BOUSSOLE_ENV=preprod",
    `BOUSSOLE_PUBLIC_URL=${url}`,
    `BOUSSOLE_PUBLISHABLE_KEY=${publiable}`,
    "BOUSSOLE_HORS_LIGNE=1",
    "",
  ].join("\n");
}

export function contenuWebConfig({ url, publiable }) {
  const cfg = { supabaseUrl: url, supabaseKey: publiable, base: "./", mcpUrl: `${url}/functions/v1/mcp`, claude: { clientId: "" }, emails: false };
  return `// Généré par scripts/preprod/env.mjs (préproduction locale) : ne pas versionner.\nwindow.BOUSSOLE = ${JSON.stringify(cfg, null, 2)};\n`;
}

/** Lecture + contrôle + écriture des deux fichiers. Renvoie les variables locales. */
export function preparerEnv({ racine = RACINE, statusTexte } = {}) {
  const texte = statusTexte ?? (() => {
    const r = supabase(["status", "-o", "env"], { racine, capturer: true });
    if (r.code !== 0) throw new Error("la pile locale ne répond pas (npm run preprod:start d'abord) : " + r.err.split("\n").filter(l => l && !/new version|recommend/i.test(l)).slice(-2).join(" "));
    return r.out;
  })();
  const v = variablesLocales(parserStatus(texte));
  const dossier = assertChemin(join(racine, ".preprod"), racine);
  mkdirSync(dossier, { recursive: true });
  for (const [nom, contenu] of [["fonctions.env", contenuFonctionsEnv(v)], ["web-config.js", contenuWebConfig(v)]]) {
    writeFileSync(join(dossier, nom), contenu, { mode: 0o600 });
    chmodSync(join(dossier, nom), 0o600);
  }
  return v;
}

/** Lignes `export …` pour un eval dans le terminal (tests d'intégration, banc). */
export function lignesExport(v) {
  return [`export BOUSSOLE_SUPABASE_URL='${v.url}'`, `export BOUSSOLE_SUPABASE_KEY='${v.publiable}'`, `export SUPABASE_SERVICE_KEY='${v.service}'`].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const v = preparerEnv();
    if (process.argv.includes("--export")) console.log(lignesExport(v));
    else console.error(`.preprod/fonctions.env et .preprod/web-config.js écrits (${v.url})`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
