// Coque (web/src/shell.html, app.js, theme.css) : registre des espaces, table de routage (anciens hash
// et anciens onglets), place de chaque module dans la coque, fragments et points de rupture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SPACES, LEGACY_TABS, LEGACY_HASHES, DEFAULT_ROUTE, resolve, resolveHash, routeOfModule } = require("../web/src/app.js");
const shell = readFileSync("web/src/shell.html", "utf8");
const theme = readFileSync("web/src/theme.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const build = readFileSync("build.mjs", "utf8");

const routes = SPACES.flatMap(sp => sp.subs.map(s => sp.space + "/" + s.id));
const sections = [...shell.matchAll(/<section\b([^>]*)>/g)].map(m => {
  const a = n => (m[1].match(new RegExp(`\\b${n}="([^"]*)"`)) || [])[1];
  return { id: a("id"), cls: a("class") || "", space: a("data-space"), sub: a("data-sub"), hidden: /\shidden\b/.test(m[1]) };
});
const views = sections.filter(s => /\bview\b/.test(s.cls));

test("registre : 5 espaces principaux + Profil, identifiants uniques, chaque espace a au moins une sous-vue", () => {
  assert.deepEqual(SPACES.map(s => s.space), ["bilan", "diagnostic", "decisions", "avenir", "recos", "profil"]);
  assert.equal(SPACES.filter(s => s.primary).length, 5);
  assert.equal(new Set(routes).size, routes.length);
  for (const sp of SPACES) {
    assert.ok(sp.label && sp.short && sp.icon && sp.desc, sp.space + " : libellé, libellé court, icône, description");
    assert.ok(sp.subs.length >= 1, sp.space);
    for (const s of sp.subs) assert.ok(s.label && "module" in s, sp.space + "/" + s.id);
  }
  assert.ok(routes.includes(DEFAULT_ROUTE));
});

test("registre : modules existants placés selon la spec", () => {
  assert.deepEqual(routeOfModule("pilotage"), { space: "bilan", sub: "placements" });
  assert.deepEqual(routeOfModule("toise"), { space: "diagnostic", sub: "rang" });
  assert.deepEqual(routeOfModule("simu"), { space: "decisions", sub: "acheter" });
  assert.deepEqual(routeOfModule("plan"), { space: "avenir", sub: "plan" });
  assert.deepEqual(routeOfModule("profil"), { space: "profil", sub: "donnees" });
  const mods = SPACES.flatMap(sp => sp.subs.map(s => s.module)).filter(Boolean);
  assert.equal(new Set(mods).size, mods.length, "un module n'occupe qu'une sous-vue");
});

test("routage : chaque ancien hash de la spec mène à une sous-vue existante", () => {
  const spec = {
    "#pilotage": "bilan/placements",
    "#position": "diagnostic/rang", "#foyer": "diagnostic/rang", "#salaire": "diagnostic/rang", "#patrimoine": "diagnostic/rang", "#emprunt": "diagnostic/rang",
    "#acheter": "decisions/acheter", "#simulateur": "decisions/acheter",
    "#plan": "avenir/plan", "#budget": "avenir/plan", "#objectifs": "avenir/plan",
    "#profil": "profil/donnees",
  };
  for (const [h, r] of Object.entries(spec)) assert.equal(LEGACY_HASHES[h], r, h);
  for (const [h, r] of Object.entries(LEGACY_HASHES)) {
    assert.ok(routes.includes(r), h + " → " + r);
    const x = resolveHash(h);
    assert.equal(x.space + "/" + x.sub, r);
    assert.equal(x.legacy, true);
  }
});

test("routage : anciens onglets (App.go, data-goto-tab) redirigés", () => {
  assert.deepEqual(Object.keys(LEGACY_TABS).sort(), ["pilotage", "plan", "profil", "simu", "toise"]);
  for (const [t, r] of Object.entries(LEGACY_TABS)) {
    assert.ok(routes.includes(r), t);
    const x = resolve(t);
    assert.equal(x.space + "/" + x.sub, r);
  }
});

test("routage : forme canonique, sous-vue par défaut, valeurs inconnues", () => {
  assert.deepEqual(resolveHash("#avenir/projections"), { space: "avenir", sub: "projections", legacy: false });
  assert.deepEqual(resolve("bilan"), { space: "bilan", sub: "vue" });
  assert.deepEqual(resolve("bilan", null, { bilan: "placements" }), { space: "bilan", sub: "placements" });
  assert.deepEqual(resolve("bilan", "placements"), { space: "bilan", sub: "placements" });
  assert.deepEqual(resolve("diagnostic/inconnu"), { space: "diagnostic", sub: "sante" });
  assert.equal(resolve("nulle-part"), null);
  assert.equal(resolveHash("#connexion"), null);
  assert.equal(resolveHash(""), null);
  assert.equal(resolveHash("#bilan").legacy, true, "« #bilan » est réécrit en « #bilan/vue »");
});

test("coque : chaque module du registre a son conteneur #view-<module>", () => {
  for (const sp of SPACES) for (const s of sp.subs) {
    if (!s.module) continue;
    const v = views.find(x => x.id === "view-" + s.module);
    assert.ok(v, `<section id="view-${s.module}"> absent`);
    assert.equal(v.space, sp.space, s.module);
    assert.equal(v.sub, s.id, s.module);
  }
});

test("coque : chaque sous-vue a exactement une section, masquée au départ ; aucune section orpheline", () => {
  for (const r of routes) {
    const [space, sub] = r.split("/");
    const found = views.filter(v => v.space === space && v.sub === sub);
    assert.equal(found.length, 1, r);
    assert.ok(found[0].hidden, r + " : hidden");
    assert.ok(found[0].id, r + " : id");
    const s = SPACES.find(x => x.space === space).subs.find(x => x.id === sub);
    if (!s.module) assert.match(found[0].cls, /\bplaceholder\b/, r + " : carte « Bientôt »");
  }
  for (const v of views) assert.ok(routes.includes(v.space + "/" + v.sub), "section hors registre : " + v.id);
  assert.match(shell, /id="view-bilan"/, "la vue d'ensemble du Bilan est un module");
});

test("coque : chaque fragment <!--@x--> existe dans web/src et est assemblé par build.mjs", () => {
  const markers = [...shell.matchAll(/<!--@([\w-]+)-->/g)].map(m => m[1]).filter(m => m !== "scripts");
  assert.deepEqual(markers.sort(), ["actions", "bilan", "pilotage", "plan-view", "profil", "regles", "sante", "simu", "toise"]);
  const mods = JSON.parse(build.match(/const MODULES = (\[[^\]]*\])/)[1]);
  for (const m of markers) {
    assert.ok(existsSync(`web/src/${m}.html`), `web/src/${m}.html absent`);
    assert.ok(mods.includes(m), `${m} absent de MODULES (build.mjs)`);
  }
  assert.match(shell, /<!--@scripts-->/);
  assert.match(shell, /\/\*@css\*\//);
});

test("coque : éléments communs présents (navigation, périmètre, veille, compte, bandeaux)", () => {
  for (const id of ["sideNav", "bottomBar", "subTabs", "spaceTitle", "spaceDesc", "scopeSeg", "veilleLine", "accountLink", "accountLinkM", "profileBtn", "demoBanner", "sideDemo", "dbBanner", "fresh"])
    assert.match(shell, new RegExp(`id="${id}"`), id);
  assert.match(shell, /id="subTabs" role="tablist"/);
  assert.match(shell, /data-goto="profil\/donnees"/);
  assert.doesNotMatch(shell, /app-tabs/);
});

test("theme.css : point de rupture à 900 px et barre basse avec zone de sécurité", () => {
  assert.match(theme, /@media\s*\(min-width:\s*900px\)/);
  const bbar = theme.match(/\.bbar\{[^}]*\}/);
  assert.ok(bbar, ".bbar absent");
  assert.match(bbar[0], /position:fixed/);
  assert.match(bbar[0], /padding:[^;]*calc\(8px \+ env\(safe-area-inset-bottom[^)]*\)\)/);
  assert.match(theme, /\.side\{[^}]*position:sticky[^}]*top:var\(--top\)/);
  assert.doesNotMatch(theme, /\.app-tabs/);
});
