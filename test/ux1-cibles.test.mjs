// Cibles tactiles (UX1, brief P5) : toute cible de la coque et des composants communs fait au moins 44 px (zone cliquable, même si
// le visuel est plus petit). Pas de navigateur dans la suite : on lit les feuilles. Un élément passe s'il a une hauteur (et une largeur,
// pour un bouton d'icône) de 44 px ou plus, ou si son visuel est plus petit et qu'une zone ::after à inset négatif complète jusqu'à 44 px.
// Les liens au fil d'un texte sont exclus (exception WCAG 2.5.8) ; mesure complémentaire dans un vrai navigateur : voir le compte rendu UX1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lire, pour } from "./helpers/css.mjs";
import { jetons } from "./helpers/contraste.mjs";

const THEME = lire("web/src/theme.css"), UI = lire("web/src/ui.css");
const { independants: tok } = jetons();
const MIN = 44;

/** Valeur CSS en px : « 44px », var(--hit), var(--btn-h), var(--nav-h), 56px… ; NaN si non calculable. */
function px(v) {
  if (v == null) return NaN;
  const m = String(v).trim().match(/^var\((--[\w-]+)\)$/);
  if (m) return px(tok[m[1]]);
  const n = String(v).trim().match(/^(-?[\d.]+)px$/);
  return n ? +n[1] : NaN;
}
/** Marge de la zone cliquable ajoutée par `sel::after{inset:…}` : [haut+bas, gauche+droite] en px (0 si absente). */
function extension(css, sel) {
  const d = pour(css, sel + "::after");
  if (!d.inset || d.position !== "absolute") return [0, 0];
  const p = d.inset.split(/\s+/).map(px);
  const [h, v = h] = p; // inset: <vertical> <horizontal>
  return [Math.max(0, -h) * 2, Math.max(0, -v) * 2];
}
function mesure(css, sel) {
  const d = pour(css, sel);
  const [eh, ev] = extension(css, sel);
  const h = Math.max(px(d["min-height"]) || 0, px(d.height) || 0), l = Math.max(px(d["min-width"]) || 0, px(d.width) || 0);
  return { h: h + eh, l: l + ev, hVisuel: h, lVisuel: l, d };
}

/* [feuille, sélecteur, largeur à vérifier aussi ?] */
const HAUTEUR = [
  // coque
  [THEME, ".fresh-btn", true], [THEME, ".icon-btn", true], [THEME, ".scope-btn", false], [THEME, ".subtabs button", false], [THEME, ".bb-item", false],
  [THEME, ".nav-item", false], [THEME, ".banner-x", true], [THEME, ".banner.demo a", false], [THEME, ".banner.demo .banner-x", false], [THEME, ".linkish", false],
  [THEME, ".veille", false], [THEME, ".page-link", false], [THEME, ".seg button", true],
  // composants
  [UI, ".ui-carte", false], [UI, ".ui-ligne", false], [UI, ".ui-item", false], [UI, ".ui-item-action", false], [UI, ".ui-btn", true],
  [UI, ".ui-onglet", true], [UI, ".ui-bascule-option", true], [UI, ".ui-acc-titre", false], [UI, ".ui-voirplus-btn", false], [UI, ".ui-claude", false],
  [UI, ".ui-panneau-fermer", true], [UI, ".ui-panneau-lien", false], [UI, ".ui-date", false], [UI, ".ui-periode-g .ui-bascule-option", false],
];

for (const [css, sel, largeur] of HAUTEUR) {
  test(`cible ≥ 44 px : ${sel}`, () => {
    const m = mesure(css, sel);
    assert.ok(m.h >= MIN, `${sel} : hauteur ${m.h} px (visuel ${m.hVisuel} px)`);
    if (largeur) assert.ok(m.l >= MIN, `${sel} : largeur ${m.l} px (visuel ${m.lVisuel} px)`);
  });
}

test("cibles : les éléments de 56 px et plus gardent leur hauteur de coque (barre basse 56 px, en-tête 56 px, ligne 56 / 64 px)", () => {
  assert.equal(px(pour(THEME, ".bb-item")["min-height"]), 56);
  assert.equal(px(tok["--header-h"]), 56);
  assert.equal(px(tok["--nav-h"]), 56);
  assert.equal(px(pour(THEME, ".page-head").height) || NaN, NaN, "la hauteur de l'en-tête est calculée avec la zone de sécurité (calc)");
  assert.match(pour(THEME, ".page-head").height, /calc\(var\(--header-h\) \+ var\(--top\)\)/);
  assert.equal(px(pour(UI, ".ui-ligne")["min-height"]), 56);
  assert.equal(px(pour(UI, ".ui-ligne.avec-sous")["min-height"]), 64);
  assert.equal(px(pour(UI, ".ui-carte.compacte")["min-height"]), 104, "carte KPI compacte : 104 px de haut");
});

test("cibles : les visuels plus petits que 44 px (chips de 36 px, segments, zone de période de 32 px) sont complétés par une zone ::after", () => {
  for (const [css, sel, visuel] of [[UI, ".ui-onglet", 36], [UI, ".ui-bascule-option", 36], [THEME, ".seg button", 36], [UI, ".ui-periode-g .ui-bascule-option", 32]]) {
    const m = mesure(css, sel);
    assert.equal(m.hVisuel, visuel, sel + " : visuel");
    assert.ok(m.h >= MIN && m.hVisuel < MIN, sel + " : zone cliquable de " + m.h + " px autour d'un visuel de " + m.hVisuel + " px");
  }
  // ces zones ne doivent pas déborder sur le voisin : seulement vertical + 1 à 2 px de côté
  for (const [css, sel] of [[UI, ".ui-onglet"], [UI, ".ui-bascule-option"], [THEME, ".seg button"]]) assert.ok(extension(css, sel)[1] <= 4, sel + " : débord latéral limité");
});

test("cibles : les chips visuelles des sous-vues (36 px) sont dans un bouton de 44 px", () => {
  assert.equal(px(pour(THEME, ".subtabs button")["min-height"]), 44);
  assert.equal(px(pour(THEME, ".subtabs button>span").height), 36);
});

test("cibles : boutons de 44 px sur mobile et de 40 px sur ordinateur (jeton --btn-h), zone de 44 px conservée", () => {
  assert.equal(tok["--btn-h"], "44px");
  assert.match(THEME, /@media \(min-width:900px\)\{:root\{[^}]*--btn-h:40px/);
  assert.match(pour(UI, ".ui-btn")["min-height"], /var\(--btn-h\)/);
  assert.equal(px(pour(UI, ".ui-btn")["min-width"]), 44, "largeur minimale de 44 px même à 40 px de haut");
});
