// Écrans de la vague 3 (UX3) : feuilles sans majuscules ni mono, cibles de 44 px, grille sur grand écran, Scénarios sans sous-onglets
// (bandes par option, lecture au toucher, axes à 12 px), case à cocher partagée. Lecture des sources (pas de navigateur dans la suite) ;
// la mesure dans un vrai navigateur est dans le compte rendu de livraison.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lire, pour, sansCommentaires, regles } from "./helpers/css.mjs";

const ECRANS = ["sante", "risque-view", "toise", "simu", "propositions", "memoire-view", "journal-view", "fiches-view", "expertises-view", "claude-guide", "profil", "regles", "savoir-view"];
const css = f => lire("web/src/" + f + ".css");

test("UX3 : aucune majuscule forcée (text-transform) ni mono dans les feuilles des écrans de la vague 3", () => {
  for (const f of ECRANS) {
    const c = sansCommentaires(css(f));
    assert.doesNotMatch(c, /text-transform\s*:\s*uppercase/, f + " : majuscules");
    assert.doesNotMatch(c, /--f-mono/, f + " : mono");
    // le mono n'est admis que pour du code (balise code des textes markdown)
    for (const r of regles(css(f))) if (/monospace/.test(JSON.stringify(r.decls))) assert.ok(r.selectors.every(x => /\bcode\b/.test(x)), f + " : mono hors code : " + r.selectors.join(", "));
  }
});

test("UX3 : les écrans ne plafonnent plus leur largeur à 880-980 px (la grille et --content-max décident)", () => {
  for (const f of ["propositions", "memoire-view", "journal-view", "fiches-view", "expertises-view", "claude-guide", "regles"])
    assert.doesNotMatch(sansCommentaires(css(f)), /\{[^}]*max-width:\s*(8[0-9]{2}|9[0-9]{2})px[^}]*\}/, f);
});

test("UX3 : cibles de 44 px sur les contrôles des écrans (liens d'action, cases, interrupteurs, résumés d'accordéon)", () => {
  const mini = (f, sel) => { const d = pour(css(f), sel); return /var\(--hit\)|44px/.test(d["min-height"] || d.height || ""); };
  for (const [f, sel] of [["propositions", "#view-propositions .pp-lnk"], ["memoire-view", "#view-memoire-view .mv-lnk"], ["propositions", "#view-propositions .pp-case"],
    ["regles", "#view-regles .rg-switch"], ["simu", "#view-simu .pb"], ["simu", "#view-simu .inp"], ["claude-guide", "#view-claude-guide .cg-btn"], ["fiches-view", "#view-fiches-view .fv-lnk"]])
    assert.ok(mini(f, sel), `${f} : ${sel}`);
  const ui = lire("web/src/ui.css");
  const caseUi = pour(ui, ".ui-case");
  assert.match(caseUi["min-height"], /var\(--hit\)/, "case à cocher : zone de 44 px");
  assert.match(pour(ui, ".ui-case>input").position, /absolute/, "le champ couvre toute la zone");
  assert.equal(pour(ui, ".ui-case-boite").width, "24px");
});

test("UX3 : grande largeur, les écrans passent sur des grilles de colonnes (≥ 1280 ou 1440 px)", () => {
  const medias = f => regles(css(f)).map(r => r.media).filter(Boolean).join(" ");
  for (const f of ["sante", "risque-view", "toise", "simu", "propositions", "journal-view", "claude-guide", "profil", "comptes-view"]) assert.match(medias(f), /min-width:\s*1[2-6]\d\d/, f + " : point de rupture large");
  assert.match(css("memoire-view"), /repeat\(auto-fit,minmax\(min\(100%,420px\),1fr\)\)/, "mémoire : cartes en colonnes automatiques");
  assert.match(css("comptes-view"), /column-count:2/, "comptes : deux colonnes sans vide");
});

test("Scénarios : plus de sous-onglets ; lecture et recherche en sections repliées ; hypothèses repliées ; bandes ; lecture au toucher ; axes à 12 px", () => {
  const html = lire("web/src/simu.html"), js = lire("web/src/simu.js");
  assert.doesNotMatch(html, /role="tab"|class="tabs"/, "plus de sous-onglets");
  assert.match(html, /<details class="acc simu-lecture" id="simu-p-ex">[\s\S]*Comment ça marche/);
  assert.match(html, /<details class="acc simu-lecture" id="simu-p-th">/);
  assert.match(html, /<details class="acc simu-hypo" id="simuHypo">\s*<summary>Tes hypothèses/);
  assert.ok(html.indexOf('id="simu-scen"') < html.indexOf('id="simuHypo"'), "le résultat vient avant les hypothèses");
  assert.ok(html.indexOf('id="verdict"') < html.indexOf('id="tiles"') && html.indexOf('id="simu-chart"') < html.indexOf('id="tiles"'), "réponse, graphe, puis les trois options");
  assert.match(js, /Bande de chaque option/);
  assert.doesNotMatch(js, /Survole pour lire\.[^"]*";\s*$/m, "pas de « survole » seul");
  assert.match(js, /Touche la courbe pour lire une valeur/);
  assert.match(js, /pointerdown/, "la valeur se lit au toucher");
  assert.doesNotMatch(js, /font-size="1[01](\.5)?"/, "graduations à 12 px au moins");
  assert.match(js, /FM\.fmtAxe\(ticks\)/, "graduations rondes et unité commune (Fmt)");
  assert.doesNotMatch(js, /IBM Plex Mono/);
});

test("Santé : l'anneau empile la note et « /100 » (plus de débordement), statuts en chips, pas de bouton Claude dans la carte", () => {
  const js = lire("web/src/sante.js"), c = sansCommentaires(css("sante"));
  assert.match(c, /\.st-anneau-val\{[^}]*flex-direction:column/);
  assert.doesNotMatch(c, /\.42em/);
  assert.match(js, /function etatHtml/);
  assert.doesNotMatch(js, /ui-badge \$\{e\.badge\} st-etat/);
});

test("Rang : « Modifier mes hypothèses » est un bouton secondaire placé sous les cartes ; l'onglet actif reste lisible", () => {
  const html = lire("web/src/toise.html"), c = css("toise");
  assert.ok(html.indexOf('id="tsCartes"') < html.indexOf('id="tsHypBtn"'), "le bouton vient après les cartes");
  assert.doesNotMatch(html, /tsClaude/);
  assert.doesNotMatch(c, /#view-toise button\{[^}]*color:inherit/, "color:inherit rendait invisible le texte de l'onglet actif");
  assert.match(pour(c, "#view-toise .ts-btn").background, /var\(--surface\)/, "bouton secondaire");
});
