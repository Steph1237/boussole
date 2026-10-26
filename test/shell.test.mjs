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
  assert.deepEqual(subs("patrimoine"), [["placements", "pilotage"], ["comptes", "comptes-view"], ["immobilier", "bilan"], ["budget", "plan"], ["objectifs", "objectifs-view"]]);
  assert.deepEqual(subs("pilotage"), [["sante", "sante"], ["risque", "risque-view"], ["rang", "toise"], ["scenarios", "scenarios-view"]]);
  assert.deepEqual(SPACES.find(s => s.space === "pilotage").subs.find(s => s.id === "scenarios").extras, ["simu"], "SCN1 : le simulateur acheter / louer est un outil de Scénarios (D8)");
  assert.deepEqual(subs("agent"), [["propositions", "propositions"], ["journal", "journal-view"], ["memoire", "memoire-view"], ["savoir", "savoir-view"]], "Agent : 4 sous-vues (UX3)");
  assert.deepEqual(subs("compte"), [["donnees", "profil"], ["regles", "regles"], ["connexion", "claude-guide"]], "Connexion est dans Compte (UX3)");
  const lab = (space, id) => SPACES.find(s => s.space === space).subs.find(s => s.id === id).label;
  assert.equal(lab("patrimoine", "comptes"), "Comptes", "Comptes en premier (spec CP1 § 2)");
  assert.equal(lab("patrimoine", "immobilier"), "Immobilier et crédits");
  assert.equal(lab("patrimoine", "budget"), "Budget");
  assert.equal(lab("patrimoine", "objectifs"), "Objectifs");
  assert.equal(lab("pilotage", "scenarios"), "Scénarios");
  assert.equal(lab("agent", "journal"), "Journal");
  assert.equal(lab("agent", "memoire"), "Mémoire");
  assert.equal(lab("agent", "propositions"), "À valider");
  assert.equal(lab("agent", "savoir"), "Savoir");
  assert.equal(lab("compte", "connexion"), "Connexion");
  assert.deepEqual(SPACES.find(s => s.space === "agent").subs.find(s => s.id === "savoir").extras, ["fiches-view", "expertises-view"], "Fiches et Expertises : deux volets de Savoir");
  assert.deepEqual([routeOfModule("fiches-view"), routeOfModule("expertises-view")], [{ space: "agent", sub: "savoir" }, { space: "agent", sub: "savoir" }]);
  assert.equal(routeOfModule("claude-guide").space, "compte");
  assert.equal(lab("compte", "donnees"), "Données");
  assert.equal(lab("compte", "regles"), "Règles");
  assert.equal(routeOfModule("actions"), null, "Actions n'a plus de sous-vue (boîte de réception d'Aujourd'hui)");
  const mods = SPACES.flatMap(sp => sp.subs.flatMap(s => [s.module].concat(s.extras || []))).filter(Boolean);
  assert.equal(new Set(mods).size, mods.length, "un module n'occupe qu'une sous-vue");
});

test("correspondance : chaque ancienne route de la spec mène à la nouvelle", () => {
  const spec = {
    "bilan/vue": "aujourdhui/vue", "recos/actions": "aujourdhui/vue",
    "bilan/placements": "patrimoine/placements", "avenir/plan": "patrimoine/budget",
    "diagnostic/sante": "pilotage/sante", "diagnostic/risque": "pilotage/risque", "diagnostic/rang": "pilotage/rang",
    "avenir/projections": "aujourdhui/vue", // UX5 : l'onglet Projections est retiré (la courbe maîtresse fait la projection)
    "pilotage/projections": "aujourdhui/vue",
    "decisions/acheter": "pilotage/scenarios", "decisions/autres": "pilotage/scenarios",
    "profil/propositions": "agent/propositions", "profil/memoire": "agent/memoire", "profil/claude": "compte/connexion",
    "recos/fiches": "agent/savoir",
    // UX3 : Connexion passe d'Agent à Compte ; Fiches et Expertises deviennent les volets d'Agent › Savoir
    "agent/connexion": "compte/connexion", "agent/fiches": "agent/savoir", "agent/expertises": "agent/savoir",
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
  // anciens liens profonds : le paramètre est gardé pour la vue (l'URL est réécrite sans lui)
  const e = resolveHash("#agent/expertises?expertise=etf-fonds");
  assert.deepEqual([key(e), e.legacy, e.query], ["agent/savoir", true, "expertise=etf-fonds"], "#agent/expertises?expertise=… → Savoir, expertise retenue");
  const c = resolveHash("#agent/connexion");
  assert.deepEqual([key(c), c.legacy], ["compte/connexion", true]);
  assert.equal(key(resolve("agent/connexion")), "compte/connexion", "App.go(\"agent/connexion\") et les liens data-goto");
  assert.equal(key(resolve("agent/fiches")), "agent/savoir");
  assert.equal(key(resolve("fiches")), "agent/savoir");
  assert.equal(key(resolveHash("#agent/savoir")), "agent/savoir");
  assert.equal(resolveHash("#agent/savoir").legacy, false, "route canonique");
});

test("correspondance : anciens onglets (App.go, data-goto-tab) et anciens hash de la première version", () => {
  for (const [t, r] of [["toise", "pilotage/rang"], ["simu", "pilotage/scenarios"], ["plan", "patrimoine/budget"], ["profil", "compte/donnees"]]) {
    assert.equal(key(resolve(t)), r, "App.go(" + t + ")");
    assert.equal(key(resolveHash("#" + t)), r, "#" + t);
  }
  const spec = {
    "#pilotage": "patrimoine/placements",
    "#position": "pilotage/rang", "#foyer": "pilotage/rang", "#salaire": "pilotage/rang", "#patrimoine": "patrimoine/placements", "#emprunt": "pilotage/rang",
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
  // « pilotage » et « patrimoine » seuls (App.go) désignent les nouvelles destinations ; « #pilotage » nu garde son ancien sens (Placements),
  // « #patrimoine » nu mène à Placements, première sous-vue de Patrimoine (il ouvrait la Toise dans la toute première version).
  assert.deepEqual(resolve("pilotage"), { space: "pilotage", sub: "sante" });
  assert.deepEqual(resolve("patrimoine"), { space: "patrimoine", sub: "placements" }, "Placements, première sous-vue de Patrimoine");
  assert.deepEqual(resolveHash("#patrimoine"), { space: "patrimoine", sub: "placements", legacy: true }, "#patrimoine nu → Placements, réécrit en #patrimoine/placements");
  assert.deepEqual(resolveHash("#patrimoine/comptes"), { space: "patrimoine", sub: "comptes", legacy: false }, "les liens profonds vers Comptes marchent toujours");
});

test("routage : forme canonique, sous-vue par défaut, route inconnue → Aujourd'hui", () => {
  assert.deepEqual(resolveHash("#pilotage/projections"), { space: "aujourdhui", sub: "vue", legacy: true }, "UX5 : Projections n'existe plus, le marque-page mène à Aujourd'hui");
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

test("coque : plus de carte « bientôt » (l'onglet Projections est retiré en UX5), le Journal a sa vue", () => {
  assert.doesNotMatch(shell, /id="sub-agent-journal"/, "plus de carte « bientôt » pour le Journal");
  assert.doesNotMatch(shell, /id="sub-pilotage-projections"|class="view placeholder"|soon/, "plus de section « Projections » ni de carte « Bientôt »");
  assert.deepEqual(SPACES.find(s => s.space === "pilotage").subs.map(x => x.id), ["sante", "risque", "rang", "scenarios"], "Pilotage : 4 onglets, tous visibles à 390 px");
});

test("coque : chaque fragment <!--@x--> existe dans web/src et est assemblé par build.mjs", () => {
  const markers = [...shell.matchAll(/<!--@([\w-]+)-->/g)].map(m => m[1]).filter(m => m !== "scripts");
  assert.deepEqual(markers.sort(), ["aujourdhui", "bilan", "claude-guide", "comptes-view", "expertises-view", "fiches-view", "journal-view", "memoire-view", "objectifs-view", "pilotage", "plan-view", "profil", "propositions", "regles", "risque-view", "sante", "scenarios-view", "simu", "toise"]);
  const mods = JSON.parse(build.match(/const MODULES = (\[[^\]]*\])/)[1]);
  assert.equal(mods[0], "aujourdhui", "aujourdhui en tête de MODULES");
  assert.ok(mods.includes("actions"), "le module Actions reste chargé (window.Actions)");
  for (const m of markers) {
    assert.ok(existsSync(`web/src/${m}.html`), `web/src/${m}.html absent`);
    assert.ok(mods.includes(m), `${m} absent de MODULES (build.mjs)`);
  }
  for (const [m, space, sub] of [["comptes-view", "patrimoine", "comptes"], ["memoire-view", "agent", "memoire"], ["journal-view", "agent", "journal"], ["objectifs-view", "patrimoine", "objectifs"]])
    assert.match(shell, new RegExp(`<section class="view" id="view-${m}" data-space="${space}" data-sub="${sub}" role="tabpanel" aria-labelledby="subtab-${space}-${sub}" hidden>\\s*<!--@${m}-->\\s*</section>`), m);
  // Savoir : une section, deux volets (fiches et expertises) qui gardent leurs identifiants
  assert.match(shell, /<section class="view" id="view-savoir-view" data-space="agent" data-sub="savoir" role="tabpanel" aria-labelledby="subtab-agent-savoir" hidden>[\s\S]*?id="view-fiches-view">\s*<!--@fiches-view-->[\s\S]*?id="view-expertises-view" hidden>\s*<!--@expertises-view-->/);
  assert.match(shell, /<section class="view" id="view-claude-guide" data-space="compte" data-sub="connexion" role="tabpanel" aria-labelledby="subtab-compte-connexion" hidden>\s*<!--@claude-guide-->/);
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

test("coque : éléments communs présents (navigation, Compte, périmètre, Claude, fraîcheur, veille, compte, bandeaux)", () => {
  for (const id of ["sideNav", "sideCompte", "bottomBar", "subTabs", "tabsWrap", "spaceTitle", "spaceDesc", "scopeBtn", "claudeBtn", "freshBtn", "veilleLine", "accountLink", "accountLinkC", "profileBtn", "demoBanner", "demoBannerClose", "sideDemo", "dbBanner", "fresh"])
    assert.match(shell, new RegExp(`id="${id}"`), id);
  assert.match(shell, /id="subTabs" role="tablist"/);
  assert.match(shell, /id="profileBtn" data-goto="compte\/donnees" aria-label="Compte et réglages" title="Compte et réglages"/);
  assert.doesNotMatch(shell, /accountLinkM/, "plus d'engrenage dans l'en-tête mobile : « Mon compte » vit dans Compte (accountLinkC) et dans le rail");
  assert.match(shell, /class="brand" href="#aujourdhui\/vue" data-goto="aujourdhui\/vue"/);
  assert.equal((shell.match(/class="brand"/g) || []).length, 1, "le logo n'est que dans la barre latérale (plus dans l'en-tête mobile)");
  assert.doesNotMatch(shell, /href="#(bilan|recos|profil|diagnostic|avenir|decisions)\//, "plus de lien vers une ancienne route dans la coque");
  assert.doesNotMatch(shell, /app-tabs/);
  assert.match(shell, /<header class="page-head">[\s\S]*id="scopeBtn"[\s\S]*id="claudeBtn"[\s\S]*<\/header>/, "périmètre et Claude dans l'en-tête de page");
  assert.doesNotMatch(shell, /scope-seg|mhead/, "plus de segment de périmètre ni d'en-tête mobile séparé");
  assert.equal((shell.match(/id="claudeBtn"/g) || []).length, 1, "un seul bouton Claude");
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
  assert.match(bbar[0], /min-height:var\(--bbar-h\)/, "hauteur = barre de 56 px + zone de sécurité");
  assert.match(bbar[0], /padding:[^;]*var\(--bottom\)/, "zone de sécurité en bas");
  assert.match(theme, /--bbar-h:calc\(var\(--nav-h\) \+ 4px \+ var\(--bottom\)\)/);
  assert.match(theme, /--bottom:env\(safe-area-inset-bottom,0px\)/);
  assert.match(theme, /\.side\{[^}]*position:sticky[^}]*top:var\(--top\)/);
  assert.doesNotMatch(theme, /\.app-tabs/);
  assert.doesNotMatch(theme, /propBanner/);
});

/* ------------------------------------------------ revue finale CK1 ------------------------------------------------ */

test("routage : sous-vue par défaut = première sous-vue branchée sur un module (Agent → À valider depuis UX3)", () => {
  const { defSub } = require("../web/src/app.js");
  for (const sp of SPACES) assert.equal(defSub(sp), sp.subs.find(s => s.module).id, sp.space);
  assert.deepEqual(resolve("agent"), { space: "agent", sub: "propositions" });
  assert.deepEqual(resolve("agent/inconnu"), { space: "agent", sub: "propositions" });
  assert.deepEqual(resolveHash("#agent"), { space: "agent", sub: "propositions", legacy: true });
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
  assert.match(app, /function onHash\(e\) \{[\s\S]{0,600}UI\.panneau\.fermer\(\{ focus: false \}\)[\s\S]{0,200}resolveHash/, "retour arrière : panneau fermé avant la navigation");
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

test("coque : « Veille » mène à Compte › Connexion ; libellés distincts de l'avatar et de l'engrenage", () => {
  assert.match(shell, /id="veilleLine" href="#compte\/connexion" data-goto="compte\/connexion"/);
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
  assert.match(app, /if \(!sub\) retenirLien\(r, q\);/, "paramètres de la cible (ou ceux d'un ancien lien du simulateur, LEGACY_PARAMS)");
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

/* Hash changé à la main (#agent/expertises?expertise=…) dans un onglet ouvert : le navigateur émet popstate PUIS hashchange pour la même
   navigation. La coque traite le premier (la vue rouvre le panneau du lien profond) et ignore le second, qui sinon refermerait le panneau. */
test("lien profond : popstate puis hashchange de la même navigation → traité une fois, le panneau ouvert par la vue reste ouvert", async () => {
  const { doublonNavigation } = require("../web/src/app.js");
  const vm = await import("node:vm");
  const { miniDom } = await import("./helpers/mini-dom.mjs");
  const URL0 = "https://x/app.html#agent/expertises?expertise=etf-fonds";
  /* Modèle de la coque : écouteur posé au démarrage (avant ceux du panneau) ; ferme le panneau, réécrit l'URL sans paramètres
     (replaceState) et, s'il y a un lien profond, navigue : show() de la vue rouvre le panneau. */
  function monter(garde, arreter = true) {
    const dom = miniDom();
    const ls = {};
    const ctx = { document: dom.doc, console };
    ctx.window = ctx; ctx.self = ctx;
    // comme un navigateur : liste figée au début de l'envoi ; un écouteur ajouté pendant l'envoi n'est pas appelé, un écouteur retiré
    // ne l'est plus (même s'il est ajouté de nouveau : c'est une autre inscription) ; stopImmediatePropagation arrête les suivants
    ctx.addEventListener = (t, f) => { (ls[t] ||= []).push({ f }); };
    ctx.removeEventListener = (t, f) => { ls[t] = (ls[t] || []).filter(x => { if (x.f !== f) return true; x.retire = true; return false; }); };
    const envoyer = e => {
      let stop = false; e.stopImmediatePropagation = () => { stop = true; };
      for (const x of (ls[e.type] || []).slice()) { if (stop) break; if (!x.retire) x.f(e); }
    };
    vm.createContext(ctx);
    vm.runInContext(readFileSync("web/src/ui.js", "utf8"), ctx, { filename: "ui.js" });
    const U = ctx.UI;
    let href = "https://x/app.html#agent/expertises", traitees = 0;
    ctx.addEventListener("hashchange", onHash); ctx.addEventListener("popstate", onHash);
    function onHash(e) {
      if (garde(e, href)) { if (arreter) e.stopImmediatePropagation(); return; }
      traitees++;
      if (U.panneau.ouvert()) U.panneau.fermer({ focus: false });
      const lien = href.includes("?");
      href = href.split("?")[0]; // replaceState : forme canonique, paramètres retenus pour la vue
      if (lien) U.panneau.ouvrir({ titre: "ETF et fonds", contenu: "<p>x</p>" });
    }
    U.panneau.ouvrir({ titre: "Allocation et risque", contenu: "" }); // un autre panneau était ouvert
    // le hash est changé à la main : popstate puis hashchange (newURL = URL atteinte, avec ses paramètres)
    const naviguer = url => { href = url; envoyer({ type: "popstate" }); envoyer({ type: "hashchange", newURL: url }); };
    return { U, naviguer, envoyer, n: () => traitees };
  }
  const a = monter(doublonNavigation());
  a.naviguer(URL0);
  assert.equal(a.U.panneau.ouvert(), true, "le panneau du lien profond reste ouvert");
  assert.equal(a.n(), 1, "navigation traitée une fois");
  a.naviguer(URL0.replace("etf-fonds", "actions"));
  assert.equal(a.U.panneau.ouvert(), true, "deuxième lien profond tapé à la main : idem");
  assert.equal(a.n(), 2);
  a.envoyer({ type: "hashchange", newURL: "https://x/app.html#agent/journal" });
  assert.equal(a.n(), 3, "un hashchange seul (sans popstate) est traité");
  // témoins : sans la garde, la coque referme le panneau ; sans stopImmediatePropagation, l'écouteur du panneau le referme
  const b = monter(() => false);
  b.naviguer(URL0);
  assert.equal(b.U.panneau.ouvert(), false, "témoin : le bogue se reproduit sans la garde");
  const c = monter(doublonNavigation(), false);
  c.naviguer(URL0);
  assert.equal(c.U.panneau.ouvert(), false, "témoin : l'écouteur du panneau doit aussi être arrêté");
  // garde pure
  const g = doublonNavigation();
  assert.equal(g({ type: "popstate" }, URL0), false);
  assert.equal(g({ type: "hashchange", newURL: URL0 + "x" }, URL0), false, "autre URL : traité");
  assert.equal(g({ type: "hashchange", newURL: URL0 }, URL0), false, "plus de popstate en attente : traité");
  assert.equal(g({ type: "popstate" }, URL0), false);
  assert.equal(g({ type: "hashchange", newURL: URL0 }, URL0), true, "même navigation : ignoré");
  assert.equal(g({ type: "hashchange", newURL: URL0 }, URL0), false, "une seule fois");
  assert.equal(g(undefined, URL0), false);
  // la coque : garde avant tout (URL lue avant le replaceState), écouteurs posés au démarrage
  assert.match(app, /function onHash\(e\) \{\s*(\/\*[\s\S]*?\*\/\s*)?if \(doublon\(e, location\.href\)\) \{ e\.stopImmediatePropagation\(\); return; \}/);
  assert.ok(app.indexOf("doublon(e, location.href)") < app.indexOf("if (r.legacy) history.replaceState"), "URL retenue avant le replaceState");
  assert.match(app, /window\.addEventListener\("hashchange", onHash\);\s*window\.addEventListener\("popstate", onHash\);/);
});

/* ------------------------------------------------ CP1 : Patrimoine › Comptes ------------------------------------------------ */

test("Comptes : première sous-vue de Patrimoine ; ses liens profonds gardent leurs paramètres dans l'URL (fiches en pleine page)", () => {
  const { PARAMS_DANS_URL, hashCanonique } = require("../web/src/app.js");
  assert.deepEqual(PARAMS_DANS_URL, ["patrimoine/comptes", "pilotage/sante", "pilotage/scenarios"], "fiches de Comptes ; onglet et critère de Santé (CP4) ; scénario ou outil de Scénarios (SCN1)");
  assert.deepEqual(resolveHash("#pilotage/sante?famille=effort&critere=epargne"), { space: "pilotage", sub: "sante", legacy: false, query: "famille=effort&critere=epargne" });
  assert.deepEqual(resolveHash("#patrimoine/comptes?ligne=pea-etf-monde"), { space: "patrimoine", sub: "comptes", legacy: false, query: "ligne=pea-etf-monde" },
    "forme canonique : l'URL n'est pas réécrite (recharger, précédent / suivant, partager le lien)");
  assert.deepEqual(resolveHash("#patrimoine/comptes?enveloppe=PEA%20Camille&titulaire=p1").query, "enveloppe=PEA%20Camille&titulaire=p1");
  assert.equal(resolveHash("#patrimoine/comptes").legacy, false);
  assert.equal(resolveHash("#patrimoine").legacy, true, "#patrimoine nu : forme ancienne, réécrite en #patrimoine/placements");
  assert.deepEqual(resolveHash("#agent/journal?entree=abc"), { space: "agent", sub: "journal", legacy: true, query: "entree=abc" }, "ailleurs, URL réécrite sans paramètres");
  assert.equal(hashCanonique({ space: "patrimoine", sub: "comptes" }, "ligne=x"), "#patrimoine/comptes?ligne=x");
  assert.equal(hashCanonique({ space: "agent", sub: "journal" }, "entree=x"), "#agent/journal");
  assert.equal(hashCanonique({ space: "patrimoine", sub: "comptes" }, ""), "#patrimoine/comptes");
  // la coque : App.go garde la requête, chaque fiche est une entrée d'historique, le retour à la liste rappelle show(), le démarrage garde le lien
  assert.match(app, /const \[t0, q0\] = separerParametres\(String\(target\)\.replace\(\/\^#\/, ""\)\), q = sub \? "" : q0 \|\| LEGACY_PARAMS\[t0\] \|\| "";\s*if \(!sub\) retenirLien\(r, q\);\s*navigate\(r, \{ push: true, scroll: true, query: q \}\);/);
  assert.match(app, /if \(o\.push && \(changed \|\| PARAMS_DANS_URL\.includes\(key\(r\)\)\) && location\.hash !== h\) history\.pushState\(null, "", h\);/);
  assert.match(app, /else if \(PARAMS_DANS_URL\.includes\(key\(r\)\)\) navigate\(\{ space: r\.space, sub: r\.sub \}, \{\}\);/);
  assert.match(app, /const canon = hashCanonique\(route, fromHash && key\(fromHash\) === key\(route\) \? fromHash\.query : ""\);/);
});

test("App.ouvrir / App.lienCompte : { enveloppe, titulaire } | { ligne } | { courant } → patrimoine/comptes?…", () => {
  const { lienCompte } = require("../web/src/app.js");
  assert.equal(lienCompte({ enveloppe: "PEA Camille", titulaire: "p1" }), "patrimoine/comptes?enveloppe=PEA%20Camille&titulaire=p1");
  assert.equal(lienCompte({ enveloppe: "Assurance vie & co" }), "patrimoine/comptes?enveloppe=Assurance%20vie%20%26%20co");
  assert.equal(lienCompte({ enveloppe: "PEA", titulaire: "p3" }), "patrimoine/comptes?enveloppe=PEA", "titulaire inconnu : ignoré");
  assert.equal(lienCompte({ ligne: "pea-etf-monde" }), "patrimoine/comptes?ligne=pea-etf-monde");
  assert.equal(lienCompte({ courant: "compte-commun" }), "patrimoine/comptes?courant=compte-commun");
  assert.equal(lienCompte({}), "patrimoine/comptes");
  assert.equal(lienCompte(null), "patrimoine/comptes");
  for (const c of [{ ligne: "a b" }, { courant: "x/y" }, { enveloppe: "PEA Camille", titulaire: "p2" }]) {
    const [route, query] = lienCompte(c).split("?");
    assert.deepEqual(resolve(route), { space: "patrimoine", sub: "comptes" });
    assert.equal(resolveHash("#" + route + "?" + query).legacy, false);
  }
  assert.match(app, /ouvrir\(cible\) \{ App\.go\(lienCompte\(cible\)\); \},/);
});

/* ------------------------------------------------ SCN1 : Pilotage › Scénarios (bibliothèque) et l'outil acheter / louer ------------------------------------------------ */

test("Scénarios : la section porte scenarios-view ; liens profonds ?scenario= et ?outil=acheter-louer gardés dans l'URL ; anciennes routes et ancres du simulateur → l'outil (D8)", () => {
  const { LEGACY_PARAMS, hashCanonique } = require("../web/src/app.js");
  assert.deepEqual(resolveHash("#pilotage/scenarios?scenario=ouvrir_pea"), { space: "pilotage", sub: "scenarios", legacy: false, query: "scenario=ouvrir_pea" });
  assert.deepEqual(resolveHash("#pilotage/scenarios?outil=acheter-louer"), { space: "pilotage", sub: "scenarios", legacy: false, query: "outil=acheter-louer" });
  assert.equal(hashCanonique({ space: "pilotage", sub: "scenarios" }, "scenario=matelas"), "#pilotage/scenarios?scenario=matelas");
  for (const h of ["#acheter", "#simulateur", "#theorie", "#explication", "#simu", "#decisions/acheter"]) {
    const r = resolveHash(h);
    assert.deepEqual([key(r), r.legacy, r.query], ["pilotage/scenarios", true, "outil=acheter-louer"], h + " ouvre l'outil acheter / louer");
    assert.equal(hashCanonique(r, r.query), "#pilotage/scenarios?outil=acheter-louer", h + " : URL réécrite avec l'outil");
  }
  for (const h of ["#decisions", "#decisions/autres", "#pilotage/scenarios"]) assert.equal(resolveHash(h).query, undefined, h + " : la bibliothèque");
  assert.equal(LEGACY_PARAMS.simu, "outil=acheter-louer", "App.go(\"simu\") ouvre l'outil");
  assert.match(app, /if \(r\.legacy\) history\.replaceState\(null, "", hashCanonique\(r, r\.query\)\);/);
  // la coque : section scenarios-view, le simulateur dans un conteneur caché tant que l'outil n'est pas ouvert, lien de retour vers la bibliothèque
  assert.match(shell, /<section class="view" id="view-scenarios-view" data-space="pilotage" data-sub="scenarios" role="tabpanel" aria-labelledby="subtab-pilotage-scenarios" hidden>\s*<!--@scenarios-view-->\s*<div class="scn-outil" data-scn-outil hidden>[\s\S]*?data-scn-outil-retour[\s\S]*?<div id="view-simu">\s*<!--@simu-->\s*<\/div>/);
  assert.doesNotMatch(shell, /<section class="view" id="view-simu"/, "le simulateur n'est plus une sous-vue");
  const scripts = build.match(/const SCRIPTS = \[([^\]]*)\]/)[1];
  for (const s of ["scenarios-catalogue.gen", "scenarios", "scenarios-worker"]) assert.ok(scripts.includes('"' + s + '"'), s);
  assert.ok(scripts.indexOf('"scenarios-catalogue.gen"') < scripts.indexOf('"store-demo"'), "catalogue embarqué chargé avant les stores");
  assert.ok(scripts.indexOf('"projection"') < scripts.indexOf('"scenarios"'), "moteur avant les scénarios");
});
