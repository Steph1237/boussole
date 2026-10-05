// Assemble le front statique dans dist/ :
//   dist/index.html        accueil (web/index.html)
//   dist/app.html          coque (web/src/shell.html) + CSS + fragments des modules + balises <script>
//   dist/app/*.js          modules copiés depuis web/src/
//   dist/config.js         web/config.js
//   dist/compte.html, dist/oauth/consent.html, dist/legal/*.html  copiés tels quels s'ils existent
// Tous les chemins sont relatifs : GitHub Pages sert le site sous /boussole/.
// `node build.mjs --dev` écrit dans dist-dev/ (même contenu, sortie séparée pour la prévisualisation).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const WEB = join(ROOT, "web");
const SRC = join(WEB, "src");
const DEV = process.argv.includes("--dev");
const outArg = process.argv.find(a => a.startsWith("--out="));
const OUT = join(ROOT, outArg ? outArg.slice(6) : DEV ? "dist-dev" : "dist");

const MODULES = ["pilotage", "toise", "simu", "profil"];
const SCRIPTS = ["calc", "demo-data", "store-demo", "store-supabase", "auth", "reel", "rules", "assistant", "import", "onboarding", ...MODULES, "app"];
// supabase-js v2, build UMD épinglé (window.supabase). Le paquet n'est pas publié sur cdnjs : jsdelivr sert
// le fichier du paquet npm officiel. Chargé juste après config.js, avant les adaptateurs store-* et auth.js.
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js";
const read = p => (existsSync(p) ? readFileSync(p, "utf8") : "");

// Enveloppe un fragment (title/meta/link/style en tête, le reste dans <body>) dans un document complet.
// Un fichier qui commence déjà par <!doctype est rendu tel quel.
const HEAD = '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n';
function wrap(fragment) {
  if (/^\s*<!doctype/i.test(fragment)) return fragment;
  const head = [];
  let body = fragment;
  for (const re of [/<title>[\s\S]*?<\/title>\s*/gi, /<meta\b[^>]*>\s*/gi, /<link\b[^>]*>\s*/gi, /<style\b[^>]*>[\s\S]*?<\/style>\s*/gi]) {
    body = body.replace(re, m => { head.push(m.trim()); return ""; });
  }
  return `${HEAD}${head.join("\n")}\n</head>\n<body>\n${body.trim()}\n</body>\n</html>\n`;
}

// --- app.html : coque + fragments ---
let app = read(join(SRC, "shell.html"));
const css = [read(join(SRC, "theme.css")), ...MODULES.map(m => read(join(SRC, `${m}.css`))), read(join(SRC, "import.css")), read(join(SRC, "onboarding.css"))].join("\n");
app = app.replace("/*@css*/", () => css);
for (const m of MODULES) {
  app = app.replace(`<!--@${m}-->`, () => read(join(SRC, `${m}.html`)) || `<p class="muted">Module ${m} en construction.</p>`);
}
const scripts = SCRIPTS.filter(s => existsSync(join(SRC, `${s}.js`)));
const tags = ['<script src="config.js"></script>', `<script src="${SUPABASE_CDN}"></script>`, ...scripts.map(s => `<script src="app/${s}.js"></script>`)];
app = app.replace("<!--@scripts-->", () => tags.join("\n"));
app = wrap(app);

// --- écriture ---
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "app"), { recursive: true });
writeFileSync(join(OUT, "app.html"), app);
writeFileSync(join(OUT, "index.html"), wrap(read(join(WEB, "index.html")) || "<title>Boussole</title><p>Bientôt.</p>"));
for (const s of scripts) copyFileSync(join(SRC, `${s}.js`), join(OUT, "app", `${s}.js`));
// Scripts des pages autonomes (hors app.html) : copiés sans être injectés dans l'application.
for (const s of ["consent", "landing", "account"]) if (existsSync(join(SRC, `${s}.js`))) copyFileSync(join(SRC, `${s}.js`), join(OUT, "app", `${s}.js`));
if (existsSync(join(WEB, "config.js"))) copyFileSync(join(WEB, "config.js"), join(OUT, "config.js"));

const extra = [];
const copyIf = rel => { const p = join(WEB, rel); if (existsSync(p)) { mkdirSync(dirname(join(OUT, rel)), { recursive: true }); copyFileSync(p, join(OUT, rel)); extra.push(rel); } };
copyIf("compte.html");
copyIf("oauth/consent.html");
if (existsSync(join(WEB, "legal"))) for (const f of readdirSync(join(WEB, "legal"))) if (f.endsWith(".html")) copyIf(`legal/${f}`);

const kb = n => (n / 1024).toFixed(1) + " Ko";
console.log(`${OUT.replace(ROOT + "/", "")}/ · app.html ${kb(app.length)} · scripts : ${scripts.join(", ")}${extra.length ? " · pages : " + extra.join(", ") : ""}`);
