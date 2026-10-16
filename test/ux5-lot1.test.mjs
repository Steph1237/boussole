// UX5 lot 1 (fondations et navigation) : foyer démo vide, statut unique de la note, coque compacte en paysage, barre latérale, mouvement.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { lire, sansCommentaires } from "./helpers/css.mjs";
const req = createRequire(import.meta.url);
const src = f => readFileSync(new URL("../web/src/" + f, import.meta.url), "utf8");
const THEME = sansCommentaires(lire("web/src/theme.css"));

function navigateur(search) {
  const mem = new Map();
  const ctx = { console, setTimeout, clearTimeout, location: { href: "http://localhost/app.html" + search, search, hash: "", pathname: "/app.html" },
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} },
    localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ["demo-data.js", "calc.js", "reperes.js", "calendrier.js", "plan.js", "marche.js", "sensible.js", "routine-etat.js", "banque-etat.js", "store-demo.js"]) vm.runInContext(src(f), ctx, { filename: f });
  return ctx;
}
const J = o => JSON.parse(JSON.stringify(o));
const pret = ctx => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("store jamais prêt")), 3000);
  const check = S => { if (S.ready) { clearTimeout(t); res(S); } };
  ctx.Store.on(check); check(ctx.Store.get());
});

test("démo vide (?demo=vide) : aucun compte, ligne, objectif, budget, mémoire, journal ni proposition ; le catalogue de savoir reste", async () => {
  const S = await pret(navigateur("?demo=vide"));
  assert.deepEqual([S.positions, S.snapshots, S.tx, S.objectifs, S.propositions, S.memoire, S.journal, S.routines, S.connexions].map(x => x.length), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(S.budget, null); assert.equal(S.risque, null); assert.equal(S.profil, null); assert.equal(S.config, null);
  assert.deepEqual(J(S.banque.comptes), []); assert.deepEqual(J(S.plansFiges), []); assert.deepEqual(J(S.foyer), { evenements: [], variantes: [] });
  assert.equal(S.journalARelire, 0);
  assert.ok(S.savoir.fiches.length > 0 && S.expertises.length > 0, "savoir et expertises ne sont pas des données du foyer");
  assert.equal(S.people.length, 1, "une seule personne : toujours le foyer");
});

test("démo normale (?demo) : le foyer fictif est inchangé", async () => {
  const S = await pret(navigateur("?demo"));
  assert.ok(S.positions.length > 5 && S.objectifs.length >= 3 && S.journal.length > 0 && S.config && S.profil);
});

test("statutNote : une seule règle (≥ 80 vert, 60 à 79 ocre, < 60 rouge), la même pour Aujourd'hui et Santé", () => {
  const P = req("../web/src/pratiques.js"), Sa = req("../web/src/sante.js");
  assert.deepEqual(P.statutNote(80), { statut: "bon", ton: "good", mot: "Solide" });
  assert.deepEqual(P.statutNote(79), { statut: "surveiller", ton: "warn", mot: "Correct" });
  assert.deepEqual(P.statutNote(78), { statut: "surveiller", ton: "warn", mot: "Correct" });
  assert.deepEqual(P.statutNote(60), { statut: "surveiller", ton: "warn", mot: "Correct" });
  assert.deepEqual(P.statutNote(59), { statut: "travailler", ton: "crit", mot: "À consolider" });
  assert.deepEqual(P.statutNote(null), { statut: "completer", ton: "na", mot: "À compléter" });
  for (let t = 0; t <= 100; t++) assert.equal(Sa.resumeFamille({ total: t }).ton, P.statutNote(t).ton, "Santé et Aujourd'hui divergent à " + t);
});

test("coque en paysage de téléphone : rail gauche de 72 px, en-tête de 48 px et onglets non collants, plus de barre basse", () => {
  const m = THEME.match(/@media \(max-width:899\.98px\) and \(max-height:500px\) and \(orientation:landscape\)\{([\s\S]*?)\n\}/);
  assert.ok(m, "bloc paysage introuvable");
  const b = m[1];
  assert.match(b, /--rail-w:calc\(72px \+ env\(safe-area-inset-left,0px\)\)/);
  assert.match(b, /--bbar-h:var\(--bottom\)/, "les barres d'enregistrement collantes retombent au bas de l'écran");
  assert.match(b, /\.bbar\{top:0;right:auto;width:var\(--rail-w\)/);
  assert.match(b, /\.main\{padding-left:calc\(var\(--rail-w\) \+ var\(--gutter\)\)/);
  assert.match(b, /\.page-head\{position:static;height:calc\(48px \+ var\(--top\)\)\}/);
  assert.match(b, /\.tabs-wrap\{position:static\}/);
});

test("barre latérale : 240 px et titres de groupe à partir de 1 680 px, un seul bloc démo, libellés sans jargon", () => {
  assert.match(THEME, /@media \(min-width:1680px\)\{\s*:root\{--side-w:240px\}\s*\.nav-groupe\{display:block\}\s*\}/);
  assert.match(THEME, /\.nav-groupe\{display:none;/);
  const app = src("app.js");
  assert.match(app, /GROUPES_NAV = \{ aujourdhui: "Suivre", agent: "Claude" \}/);
  assert.match(app, /\$\("sideDemo"\)\.hidden = !demo \|\| !\$\("demoBanner"\)\.hidden/, "l'encart de la barre latérale n'apparaît que si le bandeau est masqué");
  assert.doesNotMatch(app, /jamais lancée?\b/, "plus de « jamais lancé(e) »");
  assert.match(src("shell.html"), />Veille de Claude : pas encore faite</);
});

test("mouvement : la pulsation du halo suit prefers-reduced-motion ; l'alerte de l'accueil ne clignote pas sans fin", () => {
  const gp = sansCommentaires(lire("web/src/graphe-patrimoine.css"));
  assert.match(gp, /@media \(prefers-reduced-motion:no-preference\)\{\.gp-glow\.pulse\{animation:gp-pulse/);
  assert.match(gp, /\n\.gp-glow\.pulse\{transform-box:fill-box;transform-origin:center\}/, "la règle hors garde ne porte plus d'animation");
  const ac = sansCommentaires(lire("web/src/accueil.css"));
  assert.match(ac, /animation:accueil-pulse 1\.6s ease-out 3\}/);
  assert.doesNotMatch(ac, /accueil-pulse[^}]*infinite/);
});
