// Mise en page large (UX3) : colonne fluide bornée à 1 680 px de contenu, gouttières à 900 / 1440 / 1680 px, grille de 12 colonnes
// à points de rupture (600, 900, 1440, 1680), mesure du texte à 72 caractères. Lecture de web/src/theme.css (pas de navigateur dans la suite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lire, pour, regles } from "./helpers/css.mjs";
import { jetons, bloc, declarations, THEME as THEME_SANS_COMMENTAIRES } from "./helpers/contraste.mjs";

const THEME = lire("web/src/theme.css");
const { independants: tok } = jetons();

test("mise en page : contenu borné à 1 680 px (hors gouttières), texte courant à 72 caractères", () => {
  assert.equal(tok["--content-max"], "1680px");
  assert.equal(tok["--measure"], "72ch");
  const main = pour(THEME, ".main");
  assert.match(main["max-width"], /calc\(var\(--content-max\) \+ 2 \* var\(--gutter\)\)/, "la colonne suit --content-max, plus les deux gouttières");
  assert.equal(main["margin-inline"], "auto", "au-delà de 1 680 px, le contenu se centre");
  assert.equal(main.width, "100%");
  assert.doesNotMatch(THEME.replace(/\/\*[\s\S]*?\*\//g, ""), /\.main\{[^}]*max-width:1180px/, "plus de plafond à 1 180 px");
  assert.match(THEME, /:where\(\.view p,\.ui-panneau p\)\{max-width:var\(--measure\)\}/);
});

test("mise en page : gouttières de 16 (mobile), 32 (≥ 900), 40 (≥ 1440) et 48 px (≥ 1680) ; écarts plus larges sur grand écran", () => {
  assert.equal(tok["--gutter"], "16px");
  const g = (entete) => declarations(bloc(THEME_SANS_COMMENTAIRES, entete));
  assert.equal(g("@media (min-width:900px){:root{")["--gutter"], "32px");
  const xl = g("@media (min-width:1440px){:root{"), xxl = g("@media (min-width:1680px){:root{");
  assert.equal(xl["--gutter"], "40px");
  assert.equal(xxl["--gutter"], "48px");
  assert.ok(parseFloat(xl["--gap-cards"]) > 16 && parseFloat(xxl["--gap-cards"]) >= parseFloat(xl["--gap-cards"]), "écarts croissants");
  // largeur de contenu à 1 920 px : écran − rail (220) − 2 gouttières de 48 ; à 2 560 px : bornée
  assert.equal(Math.min(1680, 1920 - 220 - 2 * 48), 1604);
  assert.equal(Math.min(1680, 2560 - 220 - 2 * 48), 1680);
});

test("grille de 12 colonnes : .grid-12, .grid-fit et les portées .col-sm-N / .col-N / .col-xl-N / .col-xxl-N à leurs points de rupture", () => {
  const g = pour(THEME, ".grid-12");
  assert.equal(g.display, "grid");
  assert.match(g["grid-template-columns"], /^repeat\(12,minmax\(0,1fr\)\)$/);
  assert.equal(pour(THEME, ".grid-12>*")["grid-column"], "span 12", "une seule colonne sur mobile");
  assert.match(pour(THEME, ".grid-fit")["grid-template-columns"], /repeat\(auto-fit,minmax\(min\(100%,var\(--fit,320px\)\),1fr\)\)/);
  const r = regles(THEME);
  const portee = (media, cls) => { const x = r.find(q => q.media === media && q.selectors.includes("." + cls)); return x && x.decls["grid-column"]; };
  for (const [media, prefixe] of [["(min-width:600px)", "col-sm-"], ["(min-width:900px)", "col-"], ["(min-width:1440px)", "col-xl-"], ["(min-width:1680px)", "col-xxl-"]])
    for (const n of [3, 4, 5, 6, 7, 8, 9, 12]) assert.equal(portee(media, prefixe + n), "span " + n, `.${prefixe}${n} à ${media}`);
  // ordre : un point de rupture plus large est déclaré après le plus étroit (il l'emporte)
  const ordre = ["(min-width:600px)", "(min-width:900px)", "(min-width:1440px)", "(min-width:1680px)"].map(m => r.findIndex(q => q.media === m && q.selectors.includes(".col-" + (m === "(min-width:600px)" ? "sm-" : m === "(min-width:900px)" ? "" : m === "(min-width:1440px)" ? "xl-" : "xxl-") + "6")));
  assert.deepEqual([...ordre].sort((a, b) => a - b), ordre, "points de rupture déclarés par largeur croissante");
});
