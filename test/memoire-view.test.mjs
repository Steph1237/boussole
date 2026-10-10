// Profil et données › Mémoire de l'agent (web/src/memoire-view.*) : ce que l'assistant retient de l'utilisateur,
// groupé par catégorie, avec épingler, modifier, supprimer et tout effacer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/memoire-view.js", "utf8");
const css = readFileSync("web/src/memoire-view.css", "utf8");
const html = readFileSync("web/src/memoire-view.html", "utf8");
const H = require("../web/src/memoire-view.js");
const sp = s => String(s).replace(/[  ]/g, " ");

const M = (id, categorie, o) => Object.assign({ id, categorie, contenu: "Souvenir " + id, echeance: null, epingle: false, source: "Claude", creeLe: "2026-10-01T20:15:00.000Z", majLe: "2026-10-01T20:15:00.000Z" }, o);

test("memoire-view.js : se compile et s'enregistre sous « memoire-view »", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "memoire-view.js" }));
  assert.match(js, /App\.register\("memoire-view", api\)/);
  assert.match(js, /__pending/);
});

test("memoire-view.js : aucune requête DOM globale hors racine du module", () => {
  const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
  assert.deepEqual(bad, []);
  assert.match(js, /const \$ = id => root\.querySelector\("#" \+ id\)/);
});

test("memoire-view.html : identifiants utilisés par le script, en-tête rassurant, état vide avec lien vers Avec Claude", () => {
  const ids = [...js.matchAll(/\$\("(mv[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 5);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
  assert.ok(html.includes("Ce que l'agent retient de vous"));
  assert.ok(html.includes("Ils ne contiennent jamais d'identifiants bancaires ni de mots de passe."));
  assert.ok(html.includes("stockés dans votre compte Boussole"));
  assert.ok(html.includes("L'agent n'a encore rien retenu"));
  assert.ok(html.includes("Commencez par votre bilan avec Claude."));
  assert.match(html, /data-goto="profil\/claude"/);
  assert.match(html, /id="mvMsg"[^>]*role="status"/);
});

test("etatVide : chargement, erreur (lecture impossible) ou vide ; l'état vide n'est pas montré quand la lecture a échoué", () => {
  assert.equal(H.etatVide(null, 0), "chargement");
  assert.equal(H.etatVide({ ready: false, error: null }, 0), "chargement");
  assert.equal(H.etatVide({ ready: true, error: null }, 0), "vide");
  assert.equal(H.etatVide({ ready: true, error: "erreur" }, 0), "erreur");
  assert.equal(H.etatVide({ ready: true, error: "erreur" }, 2), null);
  assert.match(js, /\$\("mvEmpty"\)\.hidden = ev !== "vide"/);
  assert.match(js, /\$\("mvErr"\)\.hidden = ev !== "erreur"/);
  assert.match(html, /<p class="mv-err" id="mvErr" hidden>Lecture impossible pour le moment\./);
  assert.match(css, /#view-memoire-view \.mv-err\{/);
});

test("memoire-view.css : entièrement scopé sous #view-memoire-view", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(sels.length > 15);
  const bad = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !/^#view-memoire-view\b/.test(x));
  assert.deepEqual(bad, []);
});

test("memoire-view.js : agit par Store.memoire.modifier, .supprimer et .toutEffacer ; confirmation avant tout effacer", () => {
  assert.match(js, /window\.Store && window\.Store\.memoire/);
  assert.match(js, /\.modifier\(/);
  assert.match(js, /\.supprimer\(\[/);
  assert.match(js, /\.toutEffacer\(\)/);
  assert.ok(js.includes(`"Effacer les " + n + " souvenirs de l'agent ? Cette action est définitive."`));
  assert.match(js, /if \(!confirm\(q\)\) return;/);
  const iConfirm = js.indexOf("confirm("), iClear = js.indexOf("api.toutEffacer()");
  assert.ok(iConfirm > 0 && iConfirm < iClear, "confirm() avant toutEffacer()");
  assert.match(js, /maxlength="500"/);
  assert.match(js, /function headline\(\)/);
});

test("grouper : « à reprendre » d'abord, ordre des catégories, épinglés en tête de groupe, groupes vides absents", () => {
  const mem = [
    M("c1", "contexte"), M("p1", "preference"), M("c2", "contexte", { epingle: true }),
    M("a1", "a_suivre", { echeance: "2026-12-01" }), M("e1", "explique"), M("a2", "a_suivre", { echeance: "2026-10-05" }),
  ];
  const g = H.grouper(mem, "2026-10-10");
  assert.deepEqual(g.map(x => x.cle), ["a_suivre", "contexte", "preference", "explique"]);
  assert.deepEqual(g.map(x => x.titre), ["À reprendre", "Contexte", "Préférences", "Déjà expliqué"]);
  assert.deepEqual(g[1].items.map(m => m.id), ["c2", "c1"]);
  assert.deepEqual(g[0].items.map(m => m.id), ["a2", "a1"], "échéance la plus proche d'abord");
  assert.deepEqual(H.grouper([], "2026-10-10"), []);
  assert.deepEqual(H.grouper(null, "2026-10-10"), []);
});

test("grouper : ordre complet des six catégories", () => {
  const cats = ["explique", "preference", "contexte", "decision", "projet", "a_suivre"];
  const g = H.grouper(cats.map((c, i) => M("m" + i, c)), "2026-10-10");
  assert.deepEqual(g.map(x => x.cle), ["a_suivre", "projet", "decision", "contexte", "preference", "explique"]);
  assert.deepEqual(g.map(x => x.titre), ["À reprendre", "Projets", "Décisions", "Contexte", "Préférences", "Déjà expliqué"]);
});

test("grouper : épinglé avant non épinglé même parmi les « à reprendre »", () => {
  const g = H.grouper([M("a1", "a_suivre", { echeance: "2026-10-01" }), M("a2", "a_suivre", { echeance: "2026-11-01", epingle: true })], "2026-10-10");
  assert.deepEqual(g[0].items.map(m => m.id), ["a2", "a1"]);
});

test("echu : vrai pour une échéance passée ou du jour, faux sans échéance ou à venir", () => {
  assert.equal(H.echu(M("a", "a_suivre", { echeance: "2026-10-05" }), "2026-10-10"), true);
  assert.equal(H.echu(M("a", "a_suivre", { echeance: "2026-10-10" }), "2026-10-10"), true);
  assert.equal(H.echu(M("a", "a_suivre", { echeance: "2026-10-11" }), "2026-10-10"), false);
  assert.equal(H.echu(M("a", "a_suivre"), "2026-10-10"), false);
  assert.equal(H.echu(null, "2026-10-10"), false);
});

test("meta : « retenu par Claude le … », échéance et libellé « à reprendre » si échue", () => {
  const m1 = H.meta(M("c", "contexte", { creeLe: "2026-10-10T08:00:00.000Z", majLe: "2026-10-10T08:00:00.000Z" }), "2026-10-12");
  assert.equal(sp(m1.texte), "retenu par Claude le 10 oct. 2026");
  assert.equal(m1.echu, false);
  assert.equal(m1.echeance, "");
  const m2 = H.meta(M("a", "a_suivre", { echeance: "2026-10-05" }), "2026-10-10");
  assert.equal(m2.echu, true);
  assert.match(sp(m2.echeance), /^à reprendre/);
  assert.match(sp(m2.echeance), /5 oct\. 2026/);
  const m3 = H.meta(M("a", "a_suivre", { echeance: "2026-11-20" }), "2026-10-10");
  assert.equal(m3.echu, false);
  assert.match(sp(m3.echeance), /20 nov\. 2026/);
  const m4 = H.meta(M("s", "contexte", { source: "" }), "2026-10-10");
  assert.match(sp(m4.texte), /^retenu par l'agent le /);
  const m5 = H.meta(M("s", "contexte", { majLe: "2026-10-08T09:00:00.000Z" }), "2026-10-10");
  assert.match(sp(m5.texte), /modifié le 8 oct\. 2026/);
});
