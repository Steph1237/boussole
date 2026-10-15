// Copie générée du moteur (supabase/functions/mcp/projection-moteur.gen.js) évaluée pour les tests qui exécutent des morceaux d'index.ts dans un contexte vm
// (index.ts importe `Plan` de cette copie : effortMensuel, dateAtteinte, repartirEpargne et statutObjectif ne sont plus recopiés dans le connecteur).
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../../supabase/functions/mcp/projection-moteur.gen.js", import.meta.url), "utf8");
export function chargerMoteurGen() {
  const js = src.replace(/^export const (\w+) = /gm, "const $1 = ");
  const noms = [...src.matchAll(/^export const (\w+) = /gm)].map(m => m[1]);
  return vm.runInThisContext(`(function(){ ${js}\n;return { ${noms.join(", ")} }; })()`);
}
export const MoteurGen = chargerMoteurGen();
export const PlanGen = MoteurGen.Plan;
