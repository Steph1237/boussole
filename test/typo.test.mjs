// Échelle typographique (UX1, brief § 2.2) : aucune taille de police hors des jetons --t-* dans les feuilles de web/src
// (ni px, ni rem, ni clamp), sauf les exceptions listées ci-dessous avec leur raison. Les chiffres sont en Public Sans (plus de mono hors code).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { lire, sansCommentaires } from "./helpers/css.mjs";

const JETONS = ["hero", "h1", "h2", "kpi", "h3", "body", "small", "caption"];
const FEUILLES = readdirSync("web/src").filter(f => f.endsWith(".css"));

/** Exceptions documentées : taille relative à l'élément parent (sans pixel en dur), pas une taille de l'échelle. */
const EXCEPTIONS = [
  { fichier: "accueil.css", valeur: ".92em", raison: "mot en capitales dans un titre de bienvenue : proportionnel au titre qui l'entoure" },
];
const exception = (f, v) => EXCEPTIONS.some(e => e.fichier === f && e.valeur === v);

/** Tailles déclarées : [{ fichier, regle, taille }] pour `font-size:` et pour la 1re longueur du raccourci `font:`. */
function tailles(fichier, css) {
  const out = [];
  for (const m of sansCommentaires(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim(), corps = m[2];
    for (const d of corps.matchAll(/(?:^|;)\s*font-size\s*:\s*([^;]+)/g)) out.push({ fichier, sel, taille: d[1].trim().replace(/\s*!important$/, "") });
    for (const d of corps.matchAll(/(?:^|;)\s*font\s*:\s*([^;]+)/g)) {
      const v = d[1].trim();
      if (/^(inherit|initial|unset|caption|menu|status-bar)\b/.test(v)) { out.push({ fichier, sel, taille: v.split(/\s+/)[0] }); continue; }
      // style, variante, graisse, puis la taille (avec interligne éventuel) : var(--t-x), px, em…
      const t = v.match(/(?:^|\s)((?:var\(--t-[\w-]+(?:,[^)]*)?\)|[\d.]+(?:px|rem|em|%|vw)|clamp\([^)]*\)))(?:\/|\s|$)/);
      out.push({ fichier, sel, taille: t ? t[1] : "?" + v });
    }
  }
  return out;
}

const TOUT = FEUILLES.flatMap(f => tailles(f, lire("web/src/" + f)));
const jeton = t => new RegExp("^var\\(--t-(" + JETONS.join("|") + ")\\)$").test(t);

test("typo : chaque feuille de web/src déclare ses tailles de police (au moins 600 déclarations vérifiées)", () => {
  assert.ok(TOUT.length > 600, "déclarations lues : " + TOUT.length);
  assert.ok(FEUILLES.length >= 20);
});

test("typo : toute taille de police est un jeton --t-* (hero, h1, h2, kpi, h3, body, small, caption), « inherit » ou une exception listée", () => {
  const hors = TOUT.filter(x => !jeton(x.taille) && x.taille !== "inherit" && !exception(x.fichier, x.taille));
  assert.deepEqual(hors.map(x => `${x.fichier} : ${x.sel} → ${x.taille}`), []);
});

test("typo : aucun pixel, rem ni clamp() dans une taille de police (l'échelle suffit : les jetons grandissent à 900 px)", () => {
  for (const f of FEUILLES) {
    const css = sansCommentaires(lire("web/src/" + f));
    assert.doesNotMatch(css, /font-size\s*:[^;}]*(px|rem|clamp)/, f);
    assert.doesNotMatch(css, /font\s*:[^;}]*\b[\d.]+px/, f);
  }
});

test("typo : les exceptions sont des tailles relatives (em), en nombre limité et expliquées", () => {
  assert.ok(EXCEPTIONS.length <= 3);
  for (const e of EXCEPTIONS) {
    assert.match(e.valeur, /^\.\d+em$/);
    assert.ok(e.raison.length > 20, e.fichier);
    assert.ok(TOUT.some(x => x.fichier === e.fichier && x.taille === e.valeur), "exception inutilisée : " + e.fichier + " " + e.valeur);
  }
});

test("typo : les jetons de taille de la feuille de thème sont tous employés (pas de jeton mort)", () => {
  const usage = new Set(TOUT.map(x => x.taille));
  for (const j of JETONS) assert.ok(usage.has(`var(--t-${j})`), "--t-" + j + " jamais utilisé");
});

test("typo : mfa.js (style injecté) n'emploie que les jetons, avec un repli en pixels pour les pages sans theme.css", () => {
  const src = readFileSync("web/src/mfa.js", "utf8");
  const css = src.slice(src.indexOf("const CSS = ["), src.indexOf('].join("\\n")'));
  assert.doesNotMatch(css, /font-size\s*:\s*\d/);
  assert.doesNotMatch(css, /font\s*:[^;"]*(^|\s)\d+(\.\d+)?px/);
  assert.ok((css.match(/var\(--t-(hero|h1|h2|kpi|h3|body|small|caption),\d+(\.\d+)?px\)/g) || []).length >= 15);
});

test("typo : le mono (--f-mono) ne sert qu'au code ; --f-num est Public Sans ; aucune feuille de module ne redéclare IBM Plex Mono", () => {
  for (const f of FEUILLES.filter(f => f !== "theme.css")) {
    const css = sansCommentaires(lire("web/src/" + f));
    assert.doesNotMatch(css, /IBM Plex Mono/, f + " : la police mono se déclare dans theme.css seulement");
    // seule exception : la ligne à copier du connecteur (<code class="ac-val">, une URL) de l'accueil
    const mono = (css.match(/[^{}]*\{[^{}]*--f-mono[^{}]*\}/g) || []).map(r => r.trim().split("{")[0]);
    assert.deepEqual(mono, f === "accueil.css" ? [".accueil .ac-val"] : [], f + " : pas de mono dans les vues (réservé au code)");
  }
  const theme = sansCommentaires(lire("web/src/theme.css"));
  assert.match(theme, /--f-num:var\(--f-body\)/);
  assert.match(theme, /code,kbd,samp,pre\{font-family:var\(--f-mono\)/);
});

test("typo : le thème fixe la police du texte et l'échelle du corps (15 px) ; les chiffres sont tabulaires partout", () => {
  const theme = sansCommentaires(lire("web/src/theme.css"));
  assert.match(theme, /body\{[^}]*font-size:var\(--t-body\)/);
  assert.match(theme, /body\{[^}]*font-variant-numeric:tabular-nums lining-nums/);
  assert.match(theme, /\.num\{[^}]*font-variant-numeric:tabular-nums lining-nums/);
});
