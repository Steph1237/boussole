// Coque (web/src/shell.html, app.js, theme.css) : registre des 4 destinations + Compte, table de correspondance
// des anciennes routes (LEGACY, LEGACY_HASHES), place de chaque module dans la coque, fragments et points de rupture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SPACES, LEGACY, LEGACY_HASHES, DEFAULT_ROUTE, SCOPED, resolve, resolveHash, routeOfModule } = require("../web/src/app.js");
const shell = readFileSync("web/src/shell.html", "utf8");
const app = readFileSync("web/src/app.js", "utf8");
const theme = readFileSync("web/src/theme.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const build = readFileSync("build.mjs", "utf8");

const routes = SPACES.flatMap(sp => sp.subs.map(s => sp.space + "/" + s.id));
const sections = [...shell.matchAll(/<section\b([^>]*)>/g)].map(m => {
  const a = n => (m[1].match(new RegExp(`\\b${n}="([^"]*)"`)) || [])[1];
  return { id: a("id"), cls: a("class") || "", space: a("data-space"), sub: a("data-sub"), hidden: /\shidden\b/.test(m[1]) };
});
const views = sections.filter(s => /\bview\b/.test(s.cls));
const key = r => r.space + "/" + r.sub;

test("registre : 4 destinations primaires dans l'ordre, puis Compte hors barre", () => {
  assert.deepEqual(SPACES.map(s => s.space), ["aujourdhui", "patrimoine", "pilotage", "agent", "compte"]);
  assert.deepEqual(SPACES.filter(s => s.primary).map(s => s.label), ["Aujourd'hui", "Patrimoine", "Pilotage", "Agent"]);
  const compte = SPACES.find(s => s.space === "compte");
  assert.equal(compte.primary, false);
  assert.equal(compte.label, "Compte");
  assert.equal(new Set(routes).size, routes.length);
  for (const sp of SPACES) {
    assert.ok(sp.label && sp.short && sp.icon && sp.desc, sp.space + " : libellé, libellé court, icône, description");
    assert.ok(sp.subs.length >= 1, sp.space);
    for (const s of sp.subs) assert.ok(s.label && "module" in s, sp.space + "/" + s.id);
  }
  assert.equal(DEFAULT_ROUTE, "aujourdhui/vue");
  assert.ok(routes.includes(DEFAULT_ROUTE));
});

test("registre : sous-vues et modules de chaque destination selon le plan", () => {
  const subs = space => SPACES.find(s => s.space === space).subs.map(s => [s.id, s.module]);
  assert.deepEqual(subs("aujourdhui"), [["vue", "aujourdhui"]]);
  assert.deepEqual(subs("patrimoine"), [["placements", "pilotage"], ["immobilier", "bilan"], ["budget", "plan"], ["objectifs", "objectifs-view"]]);
  assert.deepEqual(subs("pilotage"), [["sante", "sante"], ["risque", "risque-view"], ["rang", "toise"], ["projections", null], ["scenarios", "simu"]]);
  assert.deepEqual(subs("agent"), [["journal", "journal-view"], ["propositions", "propositions"], ["memoire", "memoire-view"], ["fiches", "fiches-view"], ["connexion", "claude-guide"]]);
  assert.deepEqual(subs("compte"), [["donnees", "profil"], ["regles", "regles"]]);
  const lab = (space, id) => SPACES.find(s => s.space === space).subs.find(s => s.id === id).label;
  assert.equal(lab("patrimoine", "immobilier"), "Immobilier et crédits");
  assert.equal(lab("patrimoine", "budget"), "Budget");
  assert.equal(lab("patrimoine", "objectifs"), "Objectifs");
  assert.equal(lab("pilotage", "scenarios"), "Scénarios");
  assert.equal(lab("agent", "journal"), "Journal");
  assert.equal(lab("agent", "memoire"), "Mémoire");
  assert.equal(lab("agent", "connexion"), "Connexion");
  assert.equal(lab("compte", "donnees"), "Données");
  assert.equal(lab("compte", "regles"), "Règles");
  assert.equal(routeOfModule("actions"), null, "Actions n'a plus de sous-vue (boîte de réception d'Aujourd'hui)");
  const mods = SPACES.flatMap(sp => sp.subs.map(s => s.module)).filter(Boolean);
  assert.equal(new Set(mods).size, mods.length, "un module n'occupe qu'une sous-vue");
});

test("correspondance : chaque ancienne route de la spec mène à la nouvelle", () => {
  const spec = {
    "bilan/vue": "aujourdhui/vue", "recos/actions": "aujourdhui/vue",
    "bilan/placements": "patrimoine/placements", "avenir/plan": "patrimoine/budget",
    "diagnostic/sante": "pilotage/sante", "diagnostic/risque": "pilotage/risque", "diagnostic/rang": "pilotage/rang",
    "avenir/projections": "pilotage/projections",
    "decisions/acheter": "pilotage/scenarios", "decisions/autres": "pilotage/scenarios",
    "profil/propositions": "agent/propositions", "profil/memoire": "agent/memoire", "profil/claude": "agent/connexion",
    "recos/fiches": "agent/fiches",
    "profil/donnees": "compte/donnees", "profil/regles": "compte/regles",
  };
  for (const [old, neu] of Object.entries(spec)) {
    assert.equal(LEGACY[old], neu, "LEGACY " + old);
    assert.equal(key(resolve(old)), neu, "resolve " + old);
    const h = resolveHash("#" + old);
    assert.equal(key(h), neu, "resolveHash #" + old);
    assert.equal(h.legacy, true, "#" + old + " est réécrit");
  }
  // anciens espaces seuls et sous-vues inconnues d'un ancien espace
  assert.equal(key(resolve("bilan")), "aujourdhui/vue");
  assert.equal(key(resolve("recos")), "aujourdhui/vue");
  assert.equal(key(resolve("diagnostic")), "pilotage/sante");
  assert.equal(key(resolve("decisions")), "pilotage/scenarios");
  assert.equal(key(resolve("avenir")), "patrimoine/budget");
  assert.equal(key(resolve("profil")), "compte/donnees");
  assert.equal(key(resolve("profil/inconnu")), "compte/donnees");
  for (const [k, r] of Object.entries(LEGACY)) assert.ok(routes.includes(r), k + " → " + r + " (route existante)");
});

test("correspondance : anciens onglets (App.go, data-goto-tab) et anciens hash de la première version", () => {
  for (const [t, r] of [["toise", "pilotage/rang"], ["simu", "pilotage/scenarios"], ["plan", "patrimoine/budget"], ["profil", "compte/donnees"]]) {
    assert.equal(key(resolve(t)), r, "App.go(" + t + ")");
    assert.equal(key(resolveHash("#" + t)), r, "#" + t);
  }
  const spec = {
    "#pilotage": "patrimoine/placements",
    "#position": "pilotage/rang", "#foyer": "pilotage/rang", "#salaire": "pilotage/rang", "#patrimoine": "pilotage/rang", "#emprunt": "pilotage/rang",
    "#acheter": "pilotage/scenarios", "#simulateur": "pilotage/scenarios", "#theorie": "pilotage/scenarios", "#explication": "pilotage/scenarios",
    "#plan": "patrimoine/budget", "#budget": "patrimoine/budget", "#objectifs": "patrimoine/objectifs",
    "#profil": "compte/donnees",
  };
  for (const [h, r] of Object.entries(spec)) {
    const x = resolveHash(h);
    assert.equal(key(x), r, h);
    assert.equal(x.legacy, true, h);
  }
  for (const [h, r] of Object.entries(LEGACY_HASHES)) assert.ok(routes.includes(r), h + " → " + r);
  // « pilotage » et « patrimoine » seuls (App.go) désignent les nouvelles destinations ; seul le hash nu garde l'ancien sens.
  assert.deepEqual(resolve("pilotage"), { space: "pilotage", sub: "sante" });
  assert.deepEqual(resolve("patrimoine"), { space: "patrimoine", sub: "placements" });
});

test("routage : forme canonique, sous-vue par défaut, route inconnue → Aujourd'hui", () => {
  assert.deepEqual(resolveHash("#pilotage/projections"), { space: "pilotage", sub: "projections", legacy: false });
  assert.deepEqual(resolveHash("#agent/journal"), { space: "agent", sub: "journal", legacy: false });
  assert.deepEqual(resolve("patrimoine", null, { patrimoine: "budget" }), { space: "patrimoine", sub: "budget" });
  assert.deepEqual(resolve("patrimoine", "budget"), { space: "patrimoine", sub: "budget" });
  assert.deepEqual(resolve("pilotage", "rang"), { space: "pilotage", sub: "rang" });
  assert.deepEqual(resolve("pilotage/inconnu"), { space: "pilotage", sub: "sante" });
  assert.deepEqual(resolve("compte"), { space: "compte", sub: "donnees" });
  assert.equal(resolve("nulle-part"), null, "App.go / data-goto inconnus : ignorés (sous-onglets internes de la Toise)");
  assert.equal(resolve("rev"), null);
  assert.deepEqual(resolveHash("#nulle-part"), { space: "aujourdhui", sub: "vue", legacy: true });
  assert.deepEqual(resolveHash("#connexion"), { space: "aujourdhui", sub: "vue", legacy: true });
  assert.equal(resolveHash(""), null);
  assert.equal(resolveHash("#"), null);
  assert.equal(resolveHash("#aujourdhui").legacy, true, "« #aujourdhui » est réécrit en « #aujourdhui/vue »");
  assert.deepEqual(resolveHash("#aujourdhui/vue"), { space: "aujourdhui", sub: "vue", legacy: false });
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
  assert.match(shell, /id="view-aujourdhui" data-space="aujourdhui" data-sub="vue"/);
  assert.doesNotMatch(shell, /id="view-actions"/, "plus de sous-vue Actions");
});

test("coque : états « bientôt » orientés vers l'agent (Projections) ; le Journal a sa vue", () => {
  assert.doesNotMatch(shell, /id="sub-agent-journal"/, "plus de carte « bientôt » pour le Journal");
  for (const [space, sub] of [["pilotage", "projections"]]) {
    const m = shell.match(new RegExp(`<section class="view placeholder" id="sub-${space}-${sub}"[^>]*>([\\s\\S]*?)</section>`));
    assert.ok(m, space + "/" + sub);
    assert.match(m[1], /Bientôt ici : /);
    assert.match(m[1], /Demandez-le à Claude en attendant\./);
    assert.match(m[1], /href="https:\/\/claude\.ai\/new\?q=[^"]+" target="_blank" rel="noopener noreferrer"/);
  }
});

test("coque : chaque fragment <!--@x--> existe dans web/src et est assemblé par build.mjs", () => {
  const markers = [...shell.matchAll(/<!--@([\w-]+)-->/g)].map(m => m[1]).filter(m => m !== "scripts");
  assert.deepEqual(markers.sort(), ["aujourdhui", "bilan", "claude-guide", "fiches-view", "journal-view", "memoire-view", "objectifs-view", "pilotage", "plan-view", "profil", "propositions", "regles", "risque-view", "sante", "simu", "toise"]);
  const mods = JSON.parse(build.match(/const MODULES = (\[[^\]]*\])/)[1]);
  assert.equal(mods[0], "aujourdhui", "aujourdhui en tête de MODULES");
  assert.ok(mods.includes("actions"), "le module Actions reste chargé (window.Actions)");
  for (const m of markers) {
    assert.ok(existsSync(`web/src/${m}.html`), `web/src/${m}.html absent`);
    assert.ok(mods.includes(m), `${m} absent de MODULES (build.mjs)`);
  }
  for (const [m, space, sub] of [["fiches-view", "agent", "fiches"], ["memoire-view", "agent", "memoire"], ["journal-view", "agent", "journal"], ["objectifs-view", "patrimoine", "objectifs"]])
    assert.match(shell, new RegExp(`<section class="view" id="view-${m}" data-space="${space}" data-sub="${sub}" role="tabpanel" aria-labelledby="subtab-${space}-${sub}" hidden>\\s*<!--@${m}-->\\s*</section>`), m);
  assert.match(shell, /<section class="view" id="view-aujourdhui" data-space="aujourdhui" data-sub="vue" hidden>\s*<!--@aujourdhui-->\s*<\/section>/);
  const scripts = build.match(/const SCRIPTS = \[([^\]]*)\]/)[1];
  assert.ok(scripts.indexOf('"reperes"') >= 0 && scripts.indexOf('"reperes"') < scripts.indexOf('"plan"'), "reperes chargé avant plan");
  assert.ok(scripts.indexOf('"sensible"') >= 0 && scripts.indexOf('"sensible"') < scripts.indexOf('"store-demo"'), "sensible (filtre partagé) chargé avant les stores");
  assert.match(scripts, /"periodes", "ui",/, "ui juste après periodes");
  assert.match(build, /read\(join\(SRC, "theme\.css"\)\), read\(join\(SRC, "ui\.css"\)\),/, "ui.css juste après theme.css");
  assert.match(build, /const read = p => \(existsSync\(p\) \? readFileSync\(p, "utf8"\) : ""\)/, "un fichier absent est ignoré");
  assert.match(shell, /<!--@scripts-->/);
  assert.match(shell, /\/\*@css\*\//);
});

test("coque : éléments communs présents (navigation, Compte, périmètre, veille, compte, bandeaux)", () => {
  for (const id of ["sideNav", "sideCompte", "bottomBar", "subTabs", "spaceTitle", "spaceDesc", "scopeSeg", "veilleLine", "accountLink", "accountLinkM", "accountLinkC", "profileBtn", "demoBanner", "sideDemo", "dbBanner", "fresh"])
    assert.match(shell, new RegExp(`id="${id}"`), id);
  assert.match(shell, /id="subTabs" role="tablist"/);
  assert.match(shell, /id="profileBtn" data-goto="compte\/donnees" aria-label="Compte et réglages" title="Compte et réglages"/);
  assert.match(shell, /id="accountLinkM" href="compte\.html" aria-label="Sécurité du compte" title="Sécurité du compte"/, "engrenage distinct de l'avatar");
  assert.match(shell, /class="brand" href="#aujourdhui\/vue" data-goto="aujourdhui\/vue"/);
  assert.doesNotMatch(shell, /href="#(bilan|recos|profil|diagnostic|avenir|decisions)\//, "plus de lien vers une ancienne route dans la coque");
  assert.doesNotMatch(shell, /app-tabs/);
  assert.match(shell, /<header class="page-head">[\s\S]*id="scopeSeg"[\s\S]*<\/header>/, "périmètre dans l'en-tête de page");
  assert.equal((shell.match(/scope-seg/g) || []).length, 1, "un seul sélecteur de périmètre");
});

test("coque : plus de bandeau global #propBanner ; pastilles Aujourd'hui et Agent (propositions + journal à relire)", () => {
  assert.match(app, /countOf\("agent", "journal"\)/);
  assert.doesNotMatch(shell, /propBanner/);
  assert.doesNotMatch(app, /propBanner/);
  assert.match(app, /countOf\("aujourdhui", "vue"\)/);
  assert.match(app, /countOf\("agent", "propositions"\)/);
  assert.match(app, /data-today-count/);
  assert.match(app, /data-prop-count/);
  assert.doesNotMatch(app, /countOf\("recos"/);
});

test("app.js : barre basse = destinations primaires seulement ; Compte en pied de rail ; périmètre selon la destination", () => {
  assert.match(app, /\$\("bottomBar"\)\.innerHTML = prim\.map/);
  assert.match(app, /\$\("sideNav"\)\.innerHTML = prim\.map/);
  assert.match(app, /\$\("sideCompte"\)\.innerHTML = rest\.map/);
  assert.deepEqual(SCOPED, ["aujourdhui", "patrimoine", "pilotage"]);
});

test("theme.css : point de rupture à 900 px et barre basse à 4 entrées avec zone de sécurité", () => {
  assert.match(theme, /@media\s*\(min-width:\s*900px\)/);
  const bbar = theme.match(/\.bbar\{[^}]*\}/);
  assert.ok(bbar, ".bbar absent");
  assert.match(bbar[0], /position:fixed/);
  assert.match(bbar[0], /grid-template-columns:repeat\(4,/);
  assert.match(bbar[0], /padding:[^;]*calc\(8px \+ env\(safe-area-inset-bottom[^)]*\)\)/);
  assert.match(theme, /\.side\{[^}]*position:sticky[^}]*top:var\(--top\)/);
  assert.doesNotMatch(theme, /\.app-tabs/);
  assert.doesNotMatch(theme, /propBanner/);
});

/* ------------------------------------------------ revue finale CK1 ------------------------------------------------ */

test("routage : sous-vue par défaut = première sous-vue branchée sur un module (Agent → Journal depuis CK2)", () => {
  const { defSub } = require("../web/src/app.js");
  for (const sp of SPACES) assert.equal(defSub(sp), sp.subs.find(s => s.module).id, sp.space);
  assert.deepEqual(resolve("agent"), { space: "agent", sub: "journal" });
  assert.deepEqual(resolve("agent/inconnu"), { space: "agent", sub: "journal" });
  assert.deepEqual(resolveHash("#agent"), { space: "agent", sub: "journal", legacy: true });
  assert.deepEqual(resolve("agent", null, { agent: "propositions" }), { space: "agent", sub: "propositions" }, "dernière sous-vue visitée prioritaire");
  assert.deepEqual(resolve("profil/propositions"), { space: "agent", sub: "propositions" }, "les liens vers les propositions y mènent toujours");
  assert.deepEqual(resolveHash("#agent/journal"), { space: "agent", sub: "journal", legacy: false }, "le Journal reste accessible");
  assert.match(app, /const hrefOf = space => "#" \+ space \+ "\/" \+ \(lastSubs\[space\] \|\| defSub\(spaceOf\(space\)\)\)/, "liens de navigation : même défaut");
  assert.doesNotMatch(app, /subs\[0\]\.id/, "plus de subs[0] comme défaut");
});

test("focus après navigation : titre de page (tabindex -1, preventScroll) si la destination change ou si le focus est perdu ; pas au chargement", () => {
  const { focusApres } = require("../web/src/app.js");
  const r = (space, sub) => ({ space, sub });
  assert.equal(focusApres(r("aujourdhui", "vue"), r("agent", "propositions"), false), true, "destination changée");
  assert.equal(focusApres(r("agent", "propositions"), r("agent", "memoire"), false), false, "sous-onglet : le focus reste sur l'onglet");
  assert.equal(focusApres(r("agent", "propositions"), r("agent", "memoire"), true), true, "focus perdu (lien d'une vue ou du panneau masqués)");
  assert.match(shell, /<h1 id="spaceTitle" tabindex="-1">/);
  assert.match(app, /h\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /a\.closest\("\[hidden\]"\)/, "élément actif dans un bloc masqué = focus perdu");
  assert.match(app, /navigate\(route, \{ focus: false \}\);/, "chargement initial : pas de vol de focus");
  assert.match(app, /\.ui-panneau a\[href\^="#"\]/, "lien interne du panneau vers la vue courante : focus sur le titre");
  assert.match(app, /function onHash\(\) \{[\s\S]{0,400}UI\.panneau\.fermer\(\{ focus: false \}\)[\s\S]{0,200}resolveHash/, "retour arrière : panneau fermé avant la navigation");
});

test("accessibilité : role=\"tabpanel\" seulement pour les destinations à plusieurs sous-vues ; pastilles lues via .ui-sr", () => {
  for (const sp of SPACES) for (const s of sp.subs) {
    const tag = shell.match(new RegExp(`<section\\b[^>]*data-space="${sp.space}" data-sub="${s.id}"[^>]*>`))[0];
    if (sp.subs.length < 2) {
      assert.doesNotMatch(tag, /role="tabpanel"/, sp.space + " : pas d'onglets, pas de tabpanel");
      assert.doesNotMatch(tag, /aria-labelledby="subtab-/, sp.space + " : pas d'onglet qui le nomme");
    } else assert.match(tag, /role="tabpanel" aria-labelledby="subtab-/, sp.space + "/" + s.id);
  }
  const refresh = app.slice(app.indexOf("function refreshHeadlines()"), app.indexOf("const frDate"));
  assert.doesNotMatch(refresh, /setAttribute\("aria-label"/, "pas d'aria-label sur un <span>");
  assert.match(refresh, /s\.className = "ui-sr"/);
});

test("coque : « Veille » mène à Agent › Connexion ; libellés distincts de l'avatar et de l'engrenage", () => {
  assert.match(shell, /id="veilleLine" href="#agent\/connexion" data-goto="agent\/connexion"/);
  assert.match(app, /labelM = anon \? "Sécuriser mon compte" : "Sécurité du compte"/);
  const guide = readFileSync("web/src/claude-guide.html", "utf8");
  assert.doesNotMatch(guide, /Compte › Données<\/a> <span class="muted">[^<]*placements/, "les placements ne sont plus dans Compte › Données");
  assert.match(guide, /href="#patrimoine\/placements" data-goto="patrimoine\/placements">Patrimoine › Placements<\/a>/);
});

test("pastille Agent : propositions en attente + entrées du journal à relire, légende lue par les lecteurs d'écran", () => {
  const { legendeAgent } = require("../web/src/app.js");
  assert.equal(legendeAgent(2, 0), " propositions de Claude à examiner");
  assert.equal(legendeAgent(1, NaN), " proposition de Claude à examiner");
  assert.equal(legendeAgent(0, 1), " entrée du journal à relire");
  assert.equal(legendeAgent(NaN, 3), " entrées du journal à relire");
  assert.equal(legendeAgent(2, 1), " éléments à traiter : 2 propositions de Claude à examiner, 1 entrée du journal à relire");
  assert.equal(legendeAgent(1, 1), " éléments à traiter : 1 proposition de Claude à examiner, 1 entrée du journal à relire");
  const refresh = app.slice(app.indexOf("function refreshHeadlines()"), app.indexOf("const frDate"));
  assert.match(refresh, /legendeAgent\(/);
  assert.match(refresh, /statut === "a_relire"/, "repli : compte lu dans le store si le module Journal n'a pas de headline");
});

test("lien profond : #agent/journal?entree=<id> garde la route (quelle que soit la dernière sous-vue), paramètres retenus pour la vue", () => {
  const { separerParametres } = require("../web/src/app.js");
  assert.deepEqual(separerParametres("agent/journal?entree=abc"), ["agent/journal", "entree=abc"]);
  assert.deepEqual(separerParametres("agent/journal"), ["agent/journal", ""]);
  assert.deepEqual(resolveHash("#agent/journal?entree=abc", { agent: "memoire" }), { space: "agent", sub: "journal", legacy: true, query: "entree=abc" },
    "route conservée ; URL réécrite sans paramètres (legacy)");
  assert.deepEqual(resolve("agent/journal?entree=abc", null, { agent: "memoire" }), { space: "agent", sub: "journal" }, "App.go / data-goto");
  assert.deepEqual(resolveHash("#agent/journal"), { space: "agent", sub: "journal", legacy: false }, "sans paramètre : forme inchangée");
  // coque : paramètres retenus (démarrage, hash, App.go), lus une fois par la vue active, oubliés ailleurs ; show() rappelé sur la même vue
  assert.match(app, /if \(fromHash\) \{ route = \{ space: fromHash\.space, sub: fromHash\.sub \}; retenirLien\(route, fromHash\.query\); \}/);
  assert.match(app, /if \(!sub\) retenirLien\(r, separerParametres\(target\)\[1\]\);/);
  assert.match(app, /retenirLien\(r, r\.query\);\s*\n[^\n]*\n\s*if \(key\(r\) !== key\(route\) \|\| r\.query\) navigate/);
  assert.match(app, /parametres\(\) \{\s*if \(!lien \|\| lien\.cle !== key\(route\)\) return \{\};\s*const p = lien\.params; lien = null; return p;/);
  assert.match(app, /if \(lien && lien\.cle !== key\(r\)\) lien = null;/);
  // pastille Agent : à défaut du module, S.journalARelire
  assert.match(app, /Number\.isFinite\(S\.journalARelire\) \? S\.journalARelire/);
});

test("theme.css : les règles de la barre latérale visent .app>.side (pas les cartes .side du simulateur)", () => {
  const css = readFileSync("web/src/theme.css", "utf8");
  assert.doesNotMatch(css, /(^|[}\s])\.side\s*\{/m, "aucune règle nue .side { … }");
  assert.match(css, /\.app>\.side\{display:flex/);
});
