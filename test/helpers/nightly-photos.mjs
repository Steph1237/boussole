// HIS2 : modules de la nuit dont dépend index.ts depuis les photos reconstituées (supabase/functions/nightly/photos.ts et sa copie du moteur historique.gen.js),
// chargés dans un contexte vm comme les autres modules de la nuit (types retirés, imports remplacés par des globales).
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import vm from "node:vm";

const strip = nodeModule.stripTypeScriptTypes;
const lire = f => readFileSync(new URL("../../supabase/functions/nightly/" + f, import.meta.url), "utf8");
function charger(source, contexte) {
  const noms = [...source.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)].map(m => m[1]);
  const js = (typeof strip === "function" ? strip(source, { mode: "strip" }) : source)
    .replace(/^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export (const|function|async function|class)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, contexte);
}
/** { Historique, Calc, ...fonctions de photos.ts } à injecter dans le contexte d'index.ts. G = globales communes des tests de la nuit. */
export function modulesPhotos(G) {
  const gen = charger(lire("historique.gen.js"), { ...G });
  const photos = charger(lire("photos.ts"), { ...G, ...gen });
  return { ...photos };
}
export const SOURCE_GEN_NUIT = () => lire("historique.gen.js");
