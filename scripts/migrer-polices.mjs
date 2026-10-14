// Migration mécanique des tailles de police des feuilles web/src/*.css vers les jetons --t-* (UX1, brief § 2.2 / tâche 1.2).
// Usage : node scripts/migrer-polices.mjs [--ecrire] ; sans option, affiche le décompte par jeton (aucun fichier modifié).
// Table de correspondance (px → jeton) : sous 12 px → caption (12 px est le minimum absolu) ; 12,5 → small ; 13 et 13,5 → small ;
// 14 à 15 → body ; 16 et 16,5 → h3 ; 17 à 20 → h2 ; 21 à 23 → kpi ; 24 et 28 → h1 ; 26 et 27 → kpi ; 30 et plus → hero.
// Un clamp(min, vw, max) prend la correspondance de son maximum : les jetons grandissent déjà à partir de 900 px.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const TABLE = px => px < 12.5 ? "caption" : px < 14 ? "small" : px < 16 ? "body" : px < 17 ? "h3" : px < 21 ? "h2" : px < 24 ? "kpi" :
  px < 26 ? "h1" : px < 28 ? "kpi" : px < 30 ? "h1" : "hero";
const jeton = px => `var(--t-${TABLE(px)})`;
const NB = "(\\d+(?:\\.\\d+)?)px";
const CLAMP = new RegExp(`clamp\\(\\s*${NB}\\s*,[^,()]*,\\s*${NB}\\s*\\)`, "g");

export function migrer(css) {
  const compte = {};
  const note = t => { compte[t] = (compte[t] || 0) + 1; return t; };
  // 1. clamp() → jeton de son maximum (dans font-size ou font)
  css = css.replace(/(font-size:|font:[^;{}]*?)clamp\(\s*[^;{}]*?\)(?=[\s/;}!]|$)/g, (m, pre) => {
    const c = m.slice(pre.length), r = new RegExp(CLAMP.source).exec(c);
    return r ? pre + note(jeton(+r[2])) : m;
  });
  // 2. font-size:Npx
  css = css.replace(new RegExp(`(font-size:\\s*)${NB}`, "g"), (m, pre, n) => pre + note(jeton(+n)));
  // 3. raccourci font: … Npx[/interligne] …
  css = css.replace(/font:([^;{}]*)/g, (m, corps) => {
    if (/var\(--t-/.test(corps)) return m;
    return "font:" + corps.replace(new RegExp(`(^|\\s)${NB}(?=[\\s/]|$)`), (mm, sp, n) => sp + note(jeton(+n)));
  });
  return { css, compte };
}

if (process.argv[1] && process.argv[1].endsWith("migrer-polices.mjs")) {
  const ecrire = process.argv.includes("--ecrire");
  const total = {};
  for (const f of readdirSync("web/src").filter(f => f.endsWith(".css") && f !== "theme.css")) {
    const p = "web/src/" + f, src = readFileSync(p, "utf8"), { css, compte } = migrer(src);
    for (const [k, v] of Object.entries(compte)) total[k] = (total[k] || 0) + v;
    if (ecrire && css !== src) writeFileSync(p, css);
  }
  console.log(total);
}
