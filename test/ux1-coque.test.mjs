// Coque UX1 (web/src/shell.html, app.js, theme.css) : en-tête de 56 px collant, chip de périmètre « Foyer ▾ », un seul bouton Claude,
// point de fraîcheur et feuille des sources, barre du bas de 56 px avec un seul badge neutre, bandeau démo de 36 px, zones de sécurité.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { lire, pour, regles } from "./helpers/css.mjs";
import { jetons } from "./helpers/contraste.mjs";

const require = createRequire(import.meta.url);
const { fraicheur, demandesClaude, entreesPerimetre, DEMANDES, HEURES_VIEUX, SPACES } = require("../web/src/app.js");
const CP = require("../web/src/claude-prompts.js");
const shell = readFileSync("web/src/shell.html", "utf8");
const app = readFileSync("web/src/app.js", "utf8");
const THEME = lire("web/src/theme.css");
const { independants: tok } = jetons();

/* ------------------------------------------------ point de fraîcheur ------------------------------------------------ */

const NOW = "2026-10-14T10:00:00Z";
const store = (extra) => Object.assign({ ready: true, dbOk: true, positions: [], status: null }, extra);

test("fraicheur : vert si l'agent est passé il y a moins de 36 h, ambre au-delà, gris sans donnée", () => {
  assert.equal(HEURES_VIEUX, 36);
  const ok = fraicheur(store({ status: { lastRun: "2026-10-13T20:31:00Z" } }), NOW);
  assert.equal(ok.etat, "ok");
  assert.equal(fraicheur(store({ status: { lastRun: "2026-10-12T21:59:00Z" } }), NOW).etat, "vieux", "plus de 36 h");
  assert.equal(fraicheur(store({ status: { lastRun: "2026-10-12T22:01:00Z" } }), NOW).etat, "ok", "juste sous 36 h");
  assert.equal(fraicheur(store(), NOW).etat, "inconnu", "ni passage ni cours");
  assert.equal(fraicheur({ ready: false }, NOW).etat, "inconnu");
  assert.equal(fraicheur({ ready: true, dbOk: false }, NOW).etat, "inconnu");
  assert.match(fraicheur({ ready: true, dbOk: false }, NOW).resume, /indisponibles/);
});

test("fraicheur : sans passage de l'agent, la date du dernier cours sert de repère ; lignes de la feuille « Sources et mises à jour »", () => {
  const S = store({ positions: [{ mode: "market", priceDate: "2026-10-13" }, { mode: "market", priceDate: "2026-10-09" }, { mode: "manual", priceDate: "2020-01-01" }] });
  const f = fraicheur(S, NOW);
  assert.equal(f.etat, "ok", "cours du 13 oct. : moins de 36 h");
  assert.equal(fraicheur(S, "2026-10-20T10:00:00Z").etat, "vieux");
  const l = Object.fromEntries(f.lignes.map(x => [x.label, x.valeur]));
  assert.equal(l["Cours des placements"], "au 13 oct.");
  assert.equal(l["Mise à jour de nuit"], "jamais lancé");
  assert.equal(l["Veille"], "jamais lancée");
  const g = fraicheur(store({ status: { lastRun: "2026-10-13T20:31:00Z", veille: { lastReport: "2026-10-14T07:00:00Z" } } }), NOW);
  const m = Object.fromEntries(g.lignes.map(x => [x.label, x.valeur]));
  assert.equal(m["Mise à jour de nuit"], "hier, 22 h 31");
  assert.equal(m["Veille"], "aujourd'hui, 9 h 00");
  assert.equal(g.resume, "à jour");
  assert.match(fraicheur(store({ status: { lastRun: "2026-10-01T00:00:00Z" } }), NOW).resume, /plus de 36 h/);
});

test("fraicheur : l'état est porté par data-etat et le nom accessible (jamais la couleur seule) ; la feuille la nomme en toutes lettres", () => {
  assert.match(app, /b\.dataset\.etat = f\.etat/);
  assert.match(app, /setAttribute\("aria-label", "Sources et mises à jour : " \+ f\.resume\)/);
  assert.match(app, /"À jour" : f\.etat === "vieux" \? "À rafraîchir" : "Inconnu"/);
  assert.match(fraicheur(store({ status: { lastRun: "2026-10-13T20:31:00Z" } }), NOW).phrase, /moins de 36 h/);
  assert.match(fraicheur(store({ status: { lastRun: "2026-10-01T00:00:00Z" } }), NOW).phrase, /Plus de 36 h sans mise à jour/);
  for (const S of [store(), { ready: false }, { ready: true, dbOk: false }]) assert.ok(fraicheur(S, NOW).phrase.length > 10);
  for (const e of ["vieux", "inconnu"]) assert.match(THEME, new RegExp(`\\.fresh-btn\\[data-etat="${e}"\\] \\.fresh-dot`));
  assert.match(pour(THEME, ".fresh-dot").background, /var\(--st-good\)/, "vert = à jour");
  assert.match(pour(THEME, '.fresh-btn[data-etat="vieux"] .fresh-dot').background, /var\(--st-watch\)/, "ambre = plus de 36 h");
});

/* ------------------------------------------------ demandes à Claude ------------------------------------------------ */

test("demandesClaude : 3 demandes par destination ou sous-vue, phrases de ClaudePrompts, tutoiement, jamais « conseiller »", () => {
  for (const sp of SPACES) for (const s of sp.subs) {
    const d = demandesClaude(sp.space, s.id);
    assert.equal(d.length, 3, sp.space + "/" + s.id);
    for (const x of d) {
      assert.ok(x.label.length > 8, x.label);
      assert.ok(CP.SECTIONS[x.section], "section inconnue de ClaudePrompts : " + x.section);
      assert.ok(CP.phrase(x.section).length > 20);
      assert.doesNotMatch(x.label + CP.phrase(x.section), /conseiller/i);
    }
  }
  assert.deepEqual(demandesClaude("patrimoine", "placements").map(x => x.section), ["mouvement", "placements", "versements"], "« Enregistrer un mouvement » d'abord sur Placements");
  assert.deepEqual(demandesClaude("pilotage", "scenarios").map(x => x.section), DEMANDES.pilotage.map(x => x[1]), "repli sur la destination");
  assert.deepEqual(demandesClaude("inconnu", "x").map(x => x.section), DEMANDES.aujourdhui.map(x => x[1]), "repli sur Aujourd'hui");
  for (const sp of ["aujourdhui", "pilotage", "agent", "compte"]) assert.ok(DEMANDES[sp], sp);
});

test("bouton Claude : un seul, dans l'en-tête, ouvre la feuille « Demander à Claude » (liens claude.ai en nouvel onglet) ; plus de bouton Claude dans la coque ailleurs", () => {
  assert.equal((shell.match(/id="claudeBtn"/g) || []).length, 1);
  assert.match(app, /UI\.panneau\.ouvrir\(\{ titre: "Demander à Claude"/);
  assert.match(app, /UI\.urlClaude\(CP && CP\.phrase \? CP\.phrase\(d\.section\) : d\.label\)/);
  assert.match(app, /e\.target\.closest\("#claudeBtn"\)/);
  assert.match(shell, /aria-haspopup="dialog" aria-label="Demander à Claude"/);
  assert.match(shell, /<span data-claude-icon><\/span><span class="claude-lbl" aria-hidden="true">Claude<\/span>/, "icône étincelle ; libellé « Claude » sur ordinateur");
  assert.match(pour(THEME, ".claude-lbl").display, /none/, "mobile : icône seule");
  assert.equal(regles(THEME).find(r => r.media === "(min-width:900px)" && r.selectors.includes(".claude-lbl")).decls.display, "inline");
});

/* ------------------------------------------------ périmètre ------------------------------------------------ */

test("entreesPerimetre : Foyer puis chaque personne, avec le patrimoine net de chacune ; l'actif est repéré", () => {
  const S = { scope: "p1", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], profil: null,
    positions: [{ id: "a", owner: "p1", bloc: "Monde", mode: "manual", value: 60000, status: "actif" }, { id: "b", owner: "p2", bloc: "Monde", mode: "manual", value: 40000, status: "actif" }] };
  const e = entreesPerimetre(S);
  assert.deepEqual(e.map(x => x.id), ["foyer", "p1", "p2"]);
  assert.deepEqual(e.map(x => x.nom), ["Foyer", "Camille", "Sam"]);
  assert.deepEqual(e.map(x => x.net), [100000, 60000, 40000]);
  assert.equal(e[1].montant, "60 000 €");
  assert.deepEqual(e.map(x => x.actif), [false, true, false]);
  assert.equal(entreesPerimetre({ people: [{ id: "p1", nom: "" }, { id: "p2", nom: " " }] }).map(x => x.nom).join("|"), "Foyer|Moi|Conjoint(e)");
  assert.equal(entreesPerimetre({ scope: "foyer" })[0].actif, true);
});

test("périmètre : chip « Foyer ▾ » (global, persistant) dans l'en-tête, feuille avec les montants, masqué hors Aujourd'hui, Patrimoine et Pilotage", () => {
  assert.match(shell, /id="scopeBtn"[^>]*aria-haspopup="dialog" aria-label="Périmètre : foyer\. Changer" hidden/);
  assert.match(shell, /<span class="scope-pill-nom" id="scopeNom">Foyer<\/span>/);
  assert.match(app, /\$\("scopeBtn"\)\.hidden = !on/);
  assert.match(app, /scopeMany && SCOPED\.includes\(route\.space\)/);
  assert.match(app, /titre: "Périmètre"/);
  assert.match(app, /Store\.setScope\(sc\.dataset\.scope\); UI\.panneau\.fermer\(\)/);
  assert.match(pour(THEME, ".scope-btn")["min-height"], /var\(--hit\)/);
  assert.equal(pour(THEME, ".scope-pill").height, "32px", "visuel de 32 px dans une zone de 44 px");
  assert.match(pour(THEME, ".scope-pill")["border-radius"], /var\(--r-chip\)/);
});

/* ------------------------------------------------ en-tête, sous-vues, barre du bas ------------------------------------------------ */

test("en-tête : 56 px plus la zone de sécurité haute, collant sur mobile ; titre de la destination à gauche ; devient l'en-tête de page sur ordinateur", () => {
  const h = pour(THEME, ".page-head");
  assert.equal(h.position, "sticky");
  assert.match(h.height, /calc\(var\(--header-h\) \+ var\(--top\)\)/);
  assert.equal(tok["--header-h"], "56px");
  assert.equal(tok["--top"], "env(safe-area-inset-top,0px)");
  assert.match(h["padding"], /var\(--top\)/);
  assert.match(pour(THEME, ".page-head h1").font, /700 var\(--t-h1\)\/var\(--lh-h1\) var\(--f-display\)/);
  const bureau = regles(THEME).find(r => r.media === "(min-width:900px)" && r.selectors.includes(".page-head")).decls;
  assert.equal(bureau.position, "static");
  assert.equal(pour(THEME, ".page-desc").display, "none", "sous-titre de destination masqué sur mobile");
  assert.equal(regles(THEME).find(r => r.media === "(min-width:900px)" && r.selectors.includes(".page-desc")).decls.display, "block");
  const cache = regles(THEME).find(r => r.media === "(min-width:900px)" && r.selectors.includes(".avatar-btn"));
  assert.ok(cache && cache.decls.display === "none" && cache.selectors.includes(".bbar"), "Compte (avatar) et barre du bas seulement sur mobile");
  assert.match(shell, /class="icon-btn avatar-btn" id="profileBtn"/);
});

test("sous-vues : chips défilantes collantes sous l'en-tête, fondu de bord, actif en encre ; onglets posés dans un <span> de 36 px", () => {
  const w = pour(THEME, ".tabs-wrap");
  assert.equal(w.position, "sticky");
  assert.match(w.top, /calc\(var\(--header-h\) \+ var\(--top\)\)/);
  assert.equal(pour(THEME, ".subtabs")["overflow-x"], "auto");
  for (const f of ["end", "start", "both"]) assert.match(pour(THEME, `.subtabs[data-fade="${f}"]`)["mask-image"], /linear-gradient/, f);
  assert.equal(pour(THEME, '.subtabs button[aria-selected="true"]>span').background, "var(--ink)");
  assert.match(app, /'" data-sub="' \+ s\.id \+ '"><span>' \+ esc\(s\.label\) \+ "<\/span><\/button>"/);
  assert.match(app, /UI\.defilant\(tabs\)/);
  assert.match(app, /d\.montrerActif\(\); d\.maj\(\)/, "l'onglet actif reste visible");
  assert.match(shell, /<div class="tabs-wrap" id="tabsWrap"><div class="subtabs" id="subTabs" role="tablist"/);
});

test("barre du bas : 4 destinations, 56 px + zone de sécurité, état actif en pilule de marque, étiquettes de 12 px", () => {
  const b = pour(THEME, ".bbar");
  assert.equal(b.position, "fixed");
  assert.match(b["min-height"], /var\(--bbar-h\)/);
  assert.match(b["box-shadow"], /var\(--e2\)/);
  assert.equal(tok["--nav-h"], "56px");
  assert.match(pour(THEME, ".bb-item").font, /600 var\(--t-caption\)/);
  assert.match(pour(THEME, ".bb-ico").width + pour(THEME, ".bb-ico").height, /^56px30px$/);
  assert.equal(pour(THEME, '.bb-item[aria-current="page"] .bb-ico').background, "var(--brand-soft)");
  assert.equal(pour(THEME, '.bb-item[aria-current="page"] .bb-ico').color, "var(--brand)");
  assert.equal(SPACES.filter(s => s.primary).length, 4);
});

test("badge : un seul compteur, neutre (encre sur surface) sur Aujourd'hui ; Agent porte un point sans chiffre ; jamais de rouge", () => {
  const p = pour(THEME, ".pill-count");
  assert.equal(p.background, "var(--ink)");
  assert.equal(p.color, "var(--surface)");
  assert.doesNotMatch(JSON.stringify(p), /crit|neg|st-work/);
  assert.match(app, /data-today-count/);
  assert.match(app, /'<span class="pill-dot" data-prop-count hidden><\/span>'/, "Agent : point");
  assert.doesNotMatch(app, /<span class="pill-count" data-prop-count/, "plus de compteur sur Agent");
  assert.match(app, /el\.textContent = show && !point \? String\(n\) : ""/);
  assert.match(app, /legendeAgent\(p, j\), true\)/, "le point garde sa légende pour les lecteurs d'écran");
  assert.equal(pour(THEME, ".pill-dot").background, "var(--brand)");
});

test("bandeau démo : une ligne de 36 px sous l'en-tête, repliable pour la session ; démo masquée une fois fermée", () => {
  assert.equal(pour(THEME, ".banner.demo")["min-height"], "36px");
  assert.match(shell, /<div id="demoBanner" class="banner demo" hidden><span>Démo · foyer fictif<\/span><a href="index\.html#connexion">Créer mon compte<\/a><button type="button" class="banner-x" id="demoBannerClose"/);
  assert.ok(shell.indexOf('id="demoBanner"') > shell.indexOf('class="page-head"'), "sous l'en-tête");
  assert.match(app, /boussole\.demoBanner\.masque/);
  assert.match(app, /\$\("demoBanner"\)\.hidden = !demo \|\| demoMasque/);
});

test("zones de sécurité : en-tête (haut), barre du bas (bas) et barres collantes des modules au-dessus de la barre", () => {
  assert.match(THEME, /--bbar-h:calc\(var\(--nav-h\) \+ 4px \+ var\(--bottom\)\)/);
  assert.equal(tok["--bottom"], "env(safe-area-inset-bottom,0px)");
  assert.match(pour(THEME, ".bbar").padding, /var\(--bottom\)$/);
  assert.match(pour(THEME, ".main", null)["padding"], /calc\(var\(--bbar-h\) \+ var\(--sp-6\)\)/, "le contenu ne passe pas sous la barre");
  assert.match(THEME, /\.app #view-profil \.pf-save,\.app #view-plan \.pv-save\{bottom:var\(--bbar-h\)\}/);
  assert.match(readFileSync("build.mjs", "utf8"), /viewport-fit=cover/, "viewport-fit=cover dans le document assemblé : les zones de sécurité existent");
});

test("mobile : pas de défilement horizontal de la page (largeurs bornées, en-tête sans débord)", () => {
  assert.match(pour(THEME, ".page-head h1")["text-overflow"], /ellipsis/);
  assert.equal(pour(THEME, ".page-title")["min-width"], "0");
  assert.equal(pour(THEME, ".main")["min-width"], "0");
  assert.match(pour(THEME, ".scope-pill")["max-width"], /rem$/);
});
