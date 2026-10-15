// Sert dist-preprod/ sur http://localhost:8780 (adresse de redirection autorisée par preprod/config.toml), à l'écoute du bouclage seulement.
//   npm run preprod:app   (construit d'abord : node build.mjs --config=preprod)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, normalize, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RACINE } from "./garde.mjs";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml" };

export function demarrerServeur({ dossier = join(RACINE, "dist-preprod"), port = 8780 } = {}) {
  const racine = resolve(dossier);
  const s = createServer((req, res) => {
    let chemin = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (chemin.endsWith("/")) chemin += "index.html";
    const fichier = join(racine, chemin);
    if (!fichier.startsWith(racine) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("introuvable"); }
    res.writeHead(200, { "Content-Type": TYPES[extname(fichier)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(fichier));
  });
  return new Promise(ok => s.listen(port, "127.0.0.1", () => ok(s)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(join(RACINE, "dist-preprod/app.html"))) { console.error("dist-preprod/ absent : lance node build.mjs --config=preprod"); process.exit(1); }
  demarrerServeur().then(() => console.log("Boussole (préproduction) : http://localhost:8780/app.html — Ctrl-C pour arrêter"));
}
