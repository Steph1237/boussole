// Copie générée du moteur de suivi (supabase/functions/mcp/suivi.gen.js) évaluée comme le font les autres tests du connecteur : retire les
// `export`, exécute le module dans un contexte vm et renvoie ses exports { Suivi, Risque, Pratiques, Calc, Marche }.
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const SOURCE_SUIVI_GEN = readFileSync(new URL("../../supabase/functions/mcp/suivi.gen.js", import.meta.url), "utf8");
export function chargerSuiviGen(src = SOURCE_SUIVI_GEN) {
  const js = src.replace(/^export const (\w+) = /gm, "const $1 = ");
  const noms = [...src.matchAll(/^export const (\w+) = /gm)].map(m => m[1]);
  return vm.runInThisContext(`(function(){ ${js}\n;return { ${noms.join(", ")} }; })()`);
}
export const SuiviGen = chargerSuiviGen().Suivi;
