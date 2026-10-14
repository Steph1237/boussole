// Jetons de theme.css → couleurs résolues (clair et sombre) et rapports de contraste WCAG 2.x.
// Sert test/tokens.test.mjs ; aucune dépendance.
import { readFileSync } from "node:fs";

export const THEME = readFileSync(new URL("../../web/src/theme.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Corps (entre accolades) du n-ième (0 par défaut) bloc dont l'en-tête commence par `entete`, accolades imbriquées gérées. */
export function bloc(css, entete, n = 0) {
  let i = -1;
  for (let k = 0; k <= n; k++) { i = css.indexOf(entete, i + 1); if (i < 0) throw new Error("bloc introuvable : " + entete); }
  // l'accolade ouvrante du bloc visé est la DERNIÈRE de l'en-tête (« @media (…){:root{ » → celle de :root)
  let j = i + entete.lastIndexOf("{"), prof = 0, k = j;
  for (; k < css.length; k++) { if (css[k] === "{") prof++; else if (css[k] === "}" && --prof === 0) break; }
  return css.slice(j + 1, k);
}

/** « --a:1; --b:var(--a); » → { "--a": "1", "--b": "var(--a)" } (déclarations de premier niveau uniquement). */
export function declarations(corps) {
  const out = {};
  let prof = 0, cur = "";
  const flush = () => { const m = cur.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]*?)\s*$/); if (m) out[m[1]] = m[2]; cur = ""; };
  for (const c of corps) {
    if (c === "(") prof++; else if (c === ")") prof--;
    if (c === ";" && prof === 0) flush(); else cur += c;
  }
  flush();
  return out;
}

/** Les jetons de couleur d'un thème : base claire, + surcharges sombres (média ou attribut). */
export function jetons() {
  const clair = declarations(bloc(THEME, ":root{", 0));
  const media = declarations(bloc(THEME, ":root:not([data-theme=\"light\"]){"));
  const attr = declarations(bloc(THEME, ":root[data-theme=\"dark\"]"));
  const independants = declarations(bloc(THEME, ":root{", 1));
  return { clair, media, attr, independants };
}

const HEX = /^#([0-9a-f]{6})$/i;
const RGB = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/i;

/** Valeur CSS (hex, rgb(r g b / a)) → [r, g, b, a] ; `var(--x)` résolu dans la table donnée. */
export function couleur(valeur, table, profondeur = 0) {
  if (profondeur > 8) throw new Error("alias circulaire : " + valeur);
  const v = String(valeur).trim();
  const alias = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (alias) { if (!(alias[1] in table)) throw new Error("jeton inconnu : " + alias[1]); return couleur(table[alias[1]], table, profondeur + 1); }
  let m = v.match(HEX);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = v.match(RGB);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
  throw new Error("couleur non reconnue : " + v);
}

/** Superpose `dessus` (alpha possible) sur `dessous` opaque. */
export function composer(dessus, dessous) {
  const a = dessus[3];
  return [0, 1, 2].map(i => dessus[i] * a + dessous[i] * (1 - a)).concat(1);
}

const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
export const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function contraste(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Table résolue d'un thème ("clair" | "sombre"). */
export function table(theme) {
  const { clair, media, attr, independants } = jetons();
  const t = Object.assign({}, independants, clair);
  if (theme === "sombre") Object.assign(t, media);
  return t;
}
export const tableAttr = () => { const { clair, attr, independants } = jetons(); return Object.assign({}, independants, clair, attr); };
