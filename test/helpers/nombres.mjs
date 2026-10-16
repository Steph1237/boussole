// UX5 G1 : repère les éléments composés en police d'affichage (Schibsted Grotesk) dans les feuilles de web/src. Leurs chiffres doivent être
// proportionnels (--nums-prop, liste de theme.css) ; tout le reste de l'app est en Public Sans, chiffres tabulaires.
import { readdirSync } from "node:fs";
import { lire, regles } from "./css.mjs";

const TITRE = /^h[1-6]$/i;
/** Dernier compose d'un sélecteur, sans pseudo-classe ni pseudo-élément (« #view-x .a .b:hover::before » → « .b »). */
const compose = sel => sel.replace(/\s*([>+~])\s*/g, " $1 ").trim().split(/\s+/).filter(x => !/^[>+~]$/.test(x));
function cle(sel) {
  const c = compose(sel).map(x => x.replace(/::?[\w-]+(\([^)]*\))?/g, "")).filter(Boolean);
  if (!c.length) return null;
  const dernier = c[c.length - 1];
  if (TITRE.test(dernier)) return null; // les titres h1 à h6 sont déjà dans la liste
  if (/^[a-z]+$/i.test(dernier)) return c.length > 1 ? c[c.length - 2] + " " + dernier : null; // « .pf-kpi b », « .ts-p-kpis dd »
  return dernier.replace(/^#[\w-]+(?=\.)/, "");
}

/** Clés (sélecteurs courts) de toutes les règles des feuilles qui posent --f-display dans font ou font-family. */
export function clesAffichage() {
  const out = new Set();
  for (const f of readdirSync(new URL("../../web/src/", import.meta.url)).filter(f => f.endsWith(".css"))) {
    for (const r of regles(lire("web/src/" + f))) {
      const d = r.decls;
      if (!/var\(--f-display\)/.test((d.font || "") + " " + (d["font-family"] || ""))) continue;
      for (const s of r.selectors) { const k = cle(s); if (k && !k.startsWith("#")) out.add(k); }
      for (const s of r.selectors) { const k = cle(s); if (k && k.startsWith("#")) out.add(k); }
    }
  }
  return [...out].sort();
}
