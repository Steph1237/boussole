// Copies générées du module de catégories du budget (supabase/functions/{powens,mcp}/budget-categories.gen.js) évaluées comme le font les autres
// tests du connecteur : retire les `export`, exécute le module dans un contexte vm et renvoie ses exports { BudgetCategories }.
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const SORTIE_POWENS = "supabase/functions/powens/budget-categories.gen.js";
export const SORTIE_MCP = "supabase/functions/mcp/budget-categories.gen.js";
export const lireGen = rel => readFileSync(new URL("../../" + rel, import.meta.url), "utf8");
export function chargerBudgetGen(src) {
  const js = src.replace(/^export const (\w+) = /gm, "const $1 = ");
  const noms = [...src.matchAll(/^export const (\w+) = /gm)].map(m => m[1]);
  return vm.runInThisContext(`(function(){ ${js}\n;return { ${noms.join(", ")} }; })()`);
}
/** Copie de la fonction powens, telle que categories.ts la reçoit (import retiré par les tests qui l'exécutent dans un contexte vm). */
export const BudgetCategoriesPowens = chargerBudgetGen(lireGen(SORTIE_POWENS)).BudgetCategories;
