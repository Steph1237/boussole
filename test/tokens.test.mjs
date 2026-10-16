// Jetons de design (web/src/theme.css, UX1) : contraste AA de chaque paire texte/fond en clair et en sombre,
// blocs sombres identiques, échelle typographique, espacements, rayons, élévation, mouvement, alias des anciens noms.
import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME, bloc, declarations, jetons, table, tableAttr, couleur, composer, contraste } from "./helpers/contraste.mjs";

const THEMES = ["clair", "sombre"];
const AA = 4.5, GRAPHIQUE = 3;

/** Paires [texte, fond] réellement employées pour du texte courant (≥ 4,5:1). Un fond translucide est composé sur --surface puis --bg. */
const TEXTE = [
  ["--ink", "--bg"], ["--ink", "--surface"], ["--ink", "--surface-2"], ["--ink", "--sunk"],
  ["--muted", "--bg"], ["--muted", "--surface"], ["--muted", "--surface-2"], ["--muted", "--sunk"],
  ["--brand", "--bg"], ["--brand", "--surface"], ["--brand", "--surface-2"], ["--brand", "--sunk"], ["--brand-ink", "--brand"],
  ["--brand", "--brand-soft"],
  ["--pos", "--bg"], ["--pos", "--surface"], ["--pos", "--surface-2"], ["--pos", "--sunk"],
  ["--neg", "--bg"], ["--neg", "--surface"], ["--neg", "--surface-2"], ["--neg", "--sunk"],
  ["--st-good", "--st-good-bg"], ["--st-watch", "--st-watch-bg"], ["--st-work", "--st-work-bg"], ["--st-todo", "--st-todo-bg"],
  ["--sel-ink", "--sel-bg"], ["--me-ink", "--me"],
  // UX5 : jetons de texte des teintes de série, bouton plein de marque
  ["--s2-ink", "--s2-soft"], ["--s2-ink", "--surface"], ["--s2-ink", "--bg"], ["--me-ink-txt", "--sunk"], ["--me-ink-txt", "--surface"], ["--me-ink-txt", "--bg"], ["--brand-fill-ink", "--brand-fill"],
  // anciens noms (alias) : encore employés par les feuilles des modules
  // statuts d'un objectif sur le graphe (mot d'une cible écrit sur le tracé, sur la surface ou le fond d'app)
  ["--ms-ok", "--bg"], ["--ms-ok", "--surface"], ["--ms-track", "--bg"], ["--ms-track", "--surface"], ["--ms-late", "--bg"], ["--ms-late", "--surface"], ["--ms-off", "--bg"], ["--ms-off", "--surface"], ["--ms-idle", "--bg"], ["--ms-idle", "--surface"],
  ["--accent", "--surface"], ["--accent", "--accent-soft"], ["--good", "--surface"], ["--good", "--good-soft"],
  ["--warn", "--surface"], ["--warn", "--warn-soft"], ["--crit", "--surface"], ["--crit", "--crit-soft"],
];
/** Éléments graphiques (courbes, jalons, anneaux, séries) : ≥ 3:1 contre la surface (WCAG 1.4.11). */
const GRAPHIQUES = ["--dv-observed", "--dv-recon", "--dv-median", "--ms-goal", "--ms-credit", "--ms-life", "--ms-ok", "--ms-track", "--ms-late", "--ms-off", "--ms-idle", "--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s8", "--focus", "--brand", "--brand-fill", "--st-good", "--st-watch", "--st-work", "--line-field"];

const resolu = (t, nom, fond) => {
  const c = couleur("var(" + nom + ")", t);
  return c[3] < 1 ? composer(c, fond) : c;
};

for (const th of THEMES) {
  test(`contraste AA (${th}) : chaque paire texte/fond employée atteint 4,5:1`, () => {
    const t = table(th);
    const echecs = [];
    for (const [fg, bg] of TEXTE) {
      const surface = couleur("var(--surface)", t), base = couleur("var(--bg)", t);
      // fond translucide : mesuré sur la surface ET sur le fond d'app, le plus faible compte
      const fonds = couleur("var(" + bg + ")", t)[3] < 1 ? [composer(couleur("var(" + bg + ")", t), surface), composer(couleur("var(" + bg + ")", t), base)] : [couleur("var(" + bg + ")", t)];
      for (const f of fonds) {
        const r = contraste(resolu(t, fg, f), f);
        if (r < AA) echecs.push(`${fg} sur ${bg} = ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(echecs, []);
  });

  test(`contraste non textuel (${th}) : courbes, jalons, séries et focus ≥ 3:1 contre la surface et le fond`, () => {
    const t = table(th), echecs = [];
    for (const nom of GRAPHIQUES) for (const fond of ["--surface", "--bg"]) {
      const f = couleur("var(" + fond + ")", t), r = contraste(resolu(t, nom, f), f);
      if (r < GRAPHIQUE) echecs.push(`${nom} sur ${fond} = ${r.toFixed(2)}`);
    }
    assert.deepEqual(echecs, []);
  });
}

test("contraste : le focus reste visible sur toutes les surfaces (≥ 3:1)", () => {
  for (const th of THEMES) {
    const t = table(th);
    for (const fond of ["--bg", "--surface", "--surface-2", "--sunk"]) {
      const r = contraste(couleur("var(--focus)", t), couleur("var(" + fond + ")", t));
      assert.ok(r >= GRAPHIQUE, `${th} : focus sur ${fond} = ${r.toFixed(2)}`);
    }
  }
});

test("thème sombre : le bloc prefers-color-scheme et le bloc [data-theme=\"dark\"] sont identiques ; chaque jeton redéfini existe en clair", () => {
  const { clair, media, attr } = jetons();
  assert.deepEqual(media, attr, "les deux blocs sombres diffèrent");
  for (const k of Object.keys(attr)) assert.ok(k in clair, k + " absent du thème clair");
  assert.match(THEME, /\[data-theme="dark"\]\{\s*color-scheme:dark/);
  assert.match(THEME, /:not\(\[data-theme="light"\]\)\)?\{\s*color-scheme:dark/);
  // aucune couleur de rôle ne reste figée au clair : les rôles qui changent de valeur en sombre sont tous redéfinis
  for (const k of ["--bg", "--surface", "--sunk", "--ink", "--muted", "--line", "--brand", "--brand-ink", "--pos", "--neg", "--st-good", "--st-good-bg", "--st-watch", "--st-watch-bg", "--st-work", "--st-work-bg", "--st-todo", "--st-todo-bg", "--focus", "--ms-goal", "--ms-credit", "--ms-life", "--ms-off", "--fan-in", "--line-field", "--brand-fill", "--brand-fill-ink", "--s2-ink", "--me-ink-txt"])
    assert.ok(k in attr, k + " non redéfini en sombre");
});

test("rôles : la marque est un pétrole (#16585E clair, #62C7BE sombre), séparée du vert positif ; les 4 statuts existent", () => {
  const { clair, attr } = jetons();
  assert.equal(clair["--brand"].toUpperCase(), "#16585E");
  assert.equal(attr["--brand"].toUpperCase(), "#62C7BE");
  assert.equal(clair["--pos"].toUpperCase(), "#1E7A3C");
  const teinte = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
  for (const [a, b] of [[clair["--brand"], clair["--pos"]], [attr["--brand"], attr["--pos"]]])
    assert.ok(Math.abs(teinte(a) - teinte(b)) >= 30, "marque et positif trop proches en teinte");
  for (const s of ["good", "watch", "work", "todo"]) { assert.ok("--st-" + s in clair); assert.ok("--st-" + s + "-bg" in clair); }
  assert.doesNotMatch(THEME, /#1F6F5C|#5FBF9F/i, "l'ancien vert de marque a disparu");
  assert.equal(clair["--s1"], "var(--brand)", "la 1re série suit la marque");
});

test("anciens noms (--accent, --good, --warn, --crit et leurs fonds) : alias des rôles, jamais des valeurs figées", () => {
  const { independants: i } = jetons();
  assert.deepEqual([i["--accent"], i["--good"], i["--warn"], i["--crit"]], ["var(--brand)", "var(--pos)", "var(--st-watch)", "var(--neg)"]);
  assert.deepEqual([i["--accent-soft"], i["--good-soft"], i["--warn-soft"], i["--crit-soft"]], ["var(--brand-soft)", "var(--st-good-bg)", "var(--st-watch-bg)", "var(--st-work-bg)"]);
});

test("échelle typographique : 8 rôles, aucune taille sous 12 px, interlignes, tailles du brief (mobile puis ordinateur)", () => {
  const { independants: i } = jetons();
  const attendu = { hero: [36, 40], h1: [24, 30], h2: [18, 24], kpi: [22, 26], h3: [16, 22], body: [15, 22], small: [13, 18], caption: [12, 16] };
  for (const [k, [t, lh]] of Object.entries(attendu)) {
    assert.equal(i["--t-" + k], t + "px", "--t-" + k);
    assert.equal(i["--lh-" + k], lh + "px", "--lh-" + k);
  }
  assert.deepEqual(Object.keys(i).filter(k => /^--t-/.test(k)).sort(), Object.keys(attendu).map(k => "--t-" + k).sort());
  const bureau = declarations(bloc(THEME, "@media (min-width:900px){:root{"));
  assert.deepEqual([bureau["--t-hero"], bureau["--t-h1"], bureau["--t-h2"], bureau["--t-kpi"]], ["44px", "28px", "20px", "26px"]);
  for (const v of [...Object.values(attendu).map(a => a[0]), 44, 28, 20, 26]) assert.ok(v >= 12 && Number.isInteger(v), "pas de demi-pixel, 12 px minimum : " + v);
});

test("espacements (base 4), rayons, cibles tactiles et coque", () => {
  const { independants: i } = jetons();
  const px = v => parseFloat(v);
  for (const [k, v] of Object.entries(i).filter(([k]) => /^--sp-\d+$/.test(k))) assert.equal(px(v) % 4, 0, k + " multiple de 4");
  assert.deepEqual(["1", "2", "3", "4", "5", "6", "8", "10", "12"].map(n => px(i["--sp-" + n])), [4, 8, 12, 16, 20, 24, 32, 40, 48]);
  assert.deepEqual([i["--r-chip"], i["--r-ctl"], i["--r-card"], i["--r-sheet"]], ["999px", "10px", "14px", "20px"]);
  assert.equal(i["--hit"], "44px");
  assert.equal(i["--btn-h"], "44px");
  assert.equal(i["--header-h"], "56px");
  assert.equal(i["--nav-h"], "56px");
  const bureau = declarations(bloc(THEME, "@media (min-width:900px){:root{"));
  assert.equal(bureau["--btn-h"], "40px", "boutons de 40 px sur ordinateur");
  assert.equal(bureau["--hit"], undefined, "la zone cliquable de 44 px ne change pas");
});

test("élévation : e0 à plat, e1 à e3 en clair ; en sombre, pas d'ombre portée sur les cartes (palier de surface, bordure, filet de lumière intérieur)", () => {
  const { clair, attr } = jetons();
  assert.equal(clair["--e0"], "none");
  assert.match(clair["--e1"], /0 1px 2px rgb\(16 24 32 \/ \.06\)/);
  assert.match(clair["--e2"], /0 -4px 16px rgb\(16 24 32 \/ \.08\)/);
  assert.match(clair["--e3"], /0 -8px 32px rgb\(16 24 32 \/ \.18\)/);
  assert.match(attr["--e1"], /^inset 0 1px 0 rgb\(255 255 255 \/ \.05\)$/, "UX5 : filet de lumière en haut de la carte, aucune ombre portée");
  assert.equal(clair["--veil"], "rgb(10 14 18 / .4)");
  assert.notEqual(attr["--surface-2"], attr["--surface"], "sombre : un palier de surface de plus");
});

test("mouvement : 150 / 220 / 180 / 120 ms, durées à 0 sous prefers-reduced-motion (sauf le fondu d'opacité)", () => {
  const { independants: i } = jetons();
  assert.deepEqual([i["--dur-state"], i["--dur-open"], i["--dur-close"], i["--dur-fade"]], ["150ms", "220ms", "180ms", "120ms"]);
  assert.equal(i["--ease-sheet"], "cubic-bezier(.2,.8,.2,1)");
  const reduit = declarations(bloc(THEME, "@media (prefers-reduced-motion:reduce){:root{"));
  assert.deepEqual([reduit["--dur-state"], reduit["--dur-open"], reduit["--dur-close"]], ["0ms", "0ms", "0ms"]);
  assert.equal(reduit["--dur-fade"], undefined, "le fondu d'opacité est conservé");
  assert.match(THEME, /@media \(prefers-reduced-motion:reduce\)\{\*\{transition:none!important;animation:none!important\}\}/, "règle globale de mouvement réduit");
  assert.match(THEME, /@media \(prefers-reduced-motion:reduce\)\{\.ui-voile,\.ui-panneau\{animation:ui-fondu var\(--dur-fade\) linear!important\}\}/, "le fondu d'opacité du voile et du panneau reste");
});

test("chiffres : Public Sans (plus de mono), chiffres tabulaires, mono réservé au code", () => {
  const { independants: i } = jetons();
  assert.equal(i["--f-num"], "var(--f-body)");
  assert.match(i["--f-mono"], /IBM Plex Mono/);
  assert.match(THEME, /\*,\*::before,\*::after\{font-variant-numeric:var\(--nums\)!important\}/, "UX5 : la propriété raccourcie font: ne remet plus les chiffres à normal");
  assert.equal(i["--nums"], "var(--nums-tab)");
  assert.match(THEME, /code,kbd,samp,pre\{[^}]*font-family:var\(--f-mono\)/);
});

test("jetons de données (graphe maître) : passé observé en encre, reconstitué en muted, médiane en marque, éventail P25-P75 et P10-P90", () => {
  const { clair, attr } = jetons();
  assert.deepEqual([clair["--dv-observed"], clair["--dv-recon"], clair["--dv-median"], clair["--dv-grid"]], ["var(--ink)", "var(--muted)", "var(--brand)", "var(--line)"]);
  assert.match(clair["--fan-in"], /rgb\(22 88 94 \/ \.22\)/);
  assert.match(clair["--fan-out"], /\.10\)/);
  assert.match(attr["--fan-in"], /rgb\(98 199 190 \/ \.26\)/);
  assert.deepEqual([clair["--ms-goal"], clair["--ms-credit"], clair["--ms-life"]].map(s => s.toUpperCase()), ["#9C5C00", "#3D5A99", "#6B4FA0"]);
  assert.deepEqual([attr["--ms-goal"], attr["--ms-credit"], attr["--ms-life"]].map(s => s.toUpperCase()), ["#F0B44C", "#8EA8E8", "#B79BE6"]);
});

test("UX5 G7 : le contour d'un champ atteint 3:1 (WCAG 1.4.11) sur la surface et le fond, en clair et en sombre ; --line reste décoratif", () => {
  for (const th of THEMES) {
    const t = table(th);
    for (const fond of ["--surface", "--bg"]) {
      const r = contraste(couleur("var(--line-field)", t), couleur("var(" + fond + ")", t));
      assert.ok(r >= 3, `${th} : --line-field sur ${fond} = ${r.toFixed(2)}`);
    }
  }
  assert.match(THEME, /select,textarea,\.inp:not\(:focus-within\),\.money:not\(:focus-within\)\{border-color:var\(--line-field\)!important\}/);
  assert.match(THEME, /:where\(input,select,textarea\):focus-visible,\.inp:focus-within,\.money:focus-within\{outline:2px solid var\(--focus\)/);
});

test("UX5 G8 : sombre plus profond (carte détachée du fond), bouton plein de marque un cran plus sourd que --brand, jetons de texte des séries", () => {
  const { clair, attr } = jetons();
  assert.equal(attr["--bg"].toUpperCase(), "#0B1014");
  assert.equal(attr["--line"].toUpperCase(), "#33404A");
  const t = table("sombre");
  assert.ok(contraste(couleur("var(--line)", t), couleur("var(--bg)", t)) >= 1.6, "bordure de carte sur le fond");
  assert.equal(clair["--brand-fill"].toUpperCase(), "#16585E", "clair : identique à --brand");
  assert.notEqual(attr["--brand-fill"], attr["--brand"], "sombre : le bouton plein n'est plus l'élément le plus lumineux");
  assert.equal(clair["--s2-ink"].toUpperCase(), "#3D5A99");
  assert.equal(clair["--me-ink-txt"].toUpperCase(), "#B23B0B");
});
