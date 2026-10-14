// Mini-analyseur CSS pour les tests de feuilles (sans dépendance) : règles à plat, avec leur condition @media éventuelle.
import { readFileSync } from "node:fs";

export const lire = chemin => readFileSync(new URL("../../" + chemin, import.meta.url), "utf8");
export const sansCommentaires = css => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** « a:1;b:var(--x,2)» → { a: "1", b: "var(--x,2)" } (parenthèses et guillemets respectés). */
export function declarations(corps) {
  const out = {};
  let prof = 0, cur = "", q = null;
  const vider = () => { const m = cur.match(/^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*$/); if (m) out[m[1]] = m[2].replace(/\s*!important$/, ""); cur = ""; };
  for (const c of corps) {
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "(") prof++; else if (c === ")") prof--;
    if (c === ";" && prof === 0) vider(); else cur += c;
  }
  vider();
  return out;
}

/** Règles d'une feuille : [{ media, selectors, decls }] ; les @keyframes et @font-face sont ignorés, @media est aplati (condition conservée). */
export function regles(css) {
  const src = sansCommentaires(css), out = [];
  (function lireBloc(txt, media) {
    let i = 0;
    while (i < txt.length) {
      const o = txt.indexOf("{", i);
      if (o < 0) break;
      const entete = txt.slice(i, o).trim();
      let prof = 1, k = o + 1;
      for (; k < txt.length && prof > 0; k++) { if (txt[k] === "{") prof++; else if (txt[k] === "}") prof--; }
      const corps = txt.slice(o + 1, k - 1);
      if (/^@media/.test(entete)) lireBloc(corps, entete.replace(/^@media\s*/, "").trim());
      else if (/^@(keyframes|font-face|supports)/.test(entete)) { /* ignoré */ }
      else if (entete) out.push({ media, selectors: entete.split(",").map(x => x.trim()).filter(Boolean), decls: declarations(corps) });
      i = k;
    }
  })(src, null);
  return out;
}

/** Déclarations cumulées (dans l'ordre de la feuille) de toutes les règles de base (hors @media) visant exactement `selecteur`. */
export function pour(css, selecteur, media = null) {
  const d = {};
  for (const r of regles(css)) if (r.media === media && r.selectors.includes(selecteur)) Object.assign(d, r.decls);
  return d;
}
