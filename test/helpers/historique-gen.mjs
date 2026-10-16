// Copie générée du moteur de reconstitution (supabase/functions/{mcp,nightly}/historique.gen.js) évaluée dans un contexte vm : { Historique, Calc }.
import { readFileSync } from "node:fs";
import vm from "node:vm";

export function chargerHistoriqueGen(rel) {
  const src = readFileSync(new URL("../../" + rel, import.meta.url), "utf8");
  const noms = [...src.matchAll(/^export const (\w+) = /gm)].map(m => m[1]);
  return vm.runInThisContext(`(function(){ ${src.replace(/^export const (\w+) = /gm, "const $1 = ")}\n;return { ${noms.join(", ")} }; })()`);
}
