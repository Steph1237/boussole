// Pilotage › Scénarios (web/src/simu.*) : simulateur « Acheter ou louer ». Le moteur est protégé par test/port.test.mjs ;
// ici : le bloc « Repris de tes données » suit le sélecteur de périmètre (foyer, p1, p2), « Compléter avec Claude » remplace
// le renvoi vers une saisie dans Compte › Données, tutoiement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const read = rel => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");
const js = read("web/src/simu.js"), html = read("web/src/simu.html"), css = read("web/src/simu.css");
const n = x => String(x).replace(/[  ]/g, " ");

global.window = global.window || {};
const Calc = require("../web/src/calc.js");
window.Calc = Calc;
require("../web/src/reel.js");
require("../web/src/demo-data.js");
const Reel = window.Reel;
const ClaudePrompts = require("../web/src/claude-prompts.js");
const Simu = require("../web/src/simu.js");
const D = () => JSON.parse(JSON.stringify(window.DEMO));
const snap = (scope, over) => { const d = D(); return Object.assign({ ready: true, profilLoaded: true, scope, profil: d.profil, positions: d.positions, config: d.config, budget: d.budget,
  people: [{ id: "p1", nom: d.profil.personnes.p1.nom }, { id: "p2", nom: d.profil.personnes.p2.nom }] }, over || {}); };

test("simu.js : se compile, s'enregistre sous « simu » dans le navigateur, expose ses fonctions pures sous Node", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "simu.js" }));
  assert.match(js, /App\.register\("simu", api\)/);
  for (const f of ["scopeDe", "nomsDe", "perimetre", "valeursReelles", "repriseHtml", "phraseClaude"]) assert.equal(typeof Simu[f], "function", f);
  assert.deepEqual(Simu.REAL, ["apport", "rev", "credits", "tmi", "essai"]);
});

test("périmètre (démo) : foyer = revenus, crédits, apport et TMI du foyer ; p1 / p2 = ceux de la personne ; TMI du foyer signalée", () => {
  const d = D(), pr = d.profil, sansLoyers = { ...pr, biens: (pr.biens || []).map(b => ({ ...b, loyer: 0 })) };
  const loyers = sc => (pr.biens || []).reduce((a, b) => a + Math.max(0, +b.loyer || 0) * Calc.part(sc, b.part_p1), 0);
  const vus = {};
  for (const sc of ["foyer", "p1", "p2"]) {
    const R = Simu.valeursReelles(snap(sc), Reel);
    assert.equal(R.scope, sc);
    assert.equal(R.vals.rev, Math.round(Calc.revenusFoyer(sansLoyers, sc) + 0.7 * loyers(sc)), sc + " : revenus");
    assert.equal(R.vals.credits, Math.round(Calc.mensualites(pr, sc)), sc + " : crédits");
    assert.equal(R.vals.apport, Math.round(Calc.apportDisponible(d.positions, d.config, sc, Reel.prefs()).total), sc + " : apport");
    assert.equal(R.vals.tmi, String(pr.foyer.tmi), sc + " : TMI (imposition commune)");
    vus[sc] = R;
  }
  assert.equal(vus.foyer.vals.rev, vus.p1.vals.rev + vus.p2.vals.rev, "revenus du foyer = somme des personnes (démo sans loyers)");
  assert.notEqual(vus.p1.vals.rev, vus.p2.vals.rev);
  assert.ok(vus.p1.vals.credits < vus.foyer.vals.credits, "part des crédits de la personne");
  assert.equal(vus.p1.vals.essai, false); assert.equal(vus.p2.vals.essai, true, "période d'essai de la personne");
  assert.equal(vus.foyer.vals.essai, true, "foyer : l'une des deux personnes en essai");
  // mention du périmètre dans le bloc « Repris de tes données »
  const h = sc => n(Simu.repriseHtml(snap(sc), vus[sc], ""));
  assert.match(h("foyer"), /<span class="fp-t">Repris de tes données pour le foyer<\/span>/);
  assert.match(h("p1"), /Repris de tes données pour Camille/);
  assert.match(h("p2"), /Repris de tes données pour Sam/);
  assert.match(h("foyer"), new RegExp("Revenus <b>" + n(vus.foyer.vals.rev.toLocaleString("fr-FR")) + " €/mois</b>"));
  assert.match(h("p2"), new RegExp("Revenus <b>" + n(vus.p2.vals.rev.toLocaleString("fr-FR")) + " €/mois</b>"));
  assert.match(h("foyer"), /<span>TMI <b>30 %<\/b><\/span>/);
  assert.match(h("p1"), /<span>TMI du foyer <b>30 %<\/b><\/span>/);
  assert.match(n(Simu.repriseHtml(snap("p1"), vus.p1, "Périmètre changé : valeurs reprises de tes données pour Camille.")), /class="muted fp-msg">Périmètre changé : valeurs reprises de tes données pour Camille\.</);
});

test("périmètre : prénoms absents (« toi », « la personne 2 »), périmètre inconnu = foyer, sans profil ni store", () => {
  assert.deepEqual(Simu.perimetre("p1", {}), { id: "p1", individuel: true, pour: "pour toi" });
  assert.deepEqual(Simu.perimetre("p2", { p2: "conjoint(e)" }), { id: "p2", individuel: true, pour: "pour la personne 2" });
  assert.deepEqual(Simu.perimetre("autre", { p1: "Léa" }), { id: "foyer", individuel: false, pour: "pour le foyer" });
  assert.equal(Simu.scopeDe({ scope: "x" }), "foyer");
  assert.deepEqual(Simu.nomsDe({ people: [{ id: "p1", nom: "Léa" }], profil: { personnes: { p2: { nom: "Max" } } } }), { p1: "Léa", p2: "Max" });
  assert.equal(Simu.valeursReelles(null, Reel), null);
  assert.equal(Simu.valeursReelles(snap("foyer", { dbOk: false }), Reel), null);
  assert.equal(Simu.valeursReelles(snap("foyer"), null), null);
  const vide = snap("foyer", { profil: null });
  const t = n(Simu.repriseHtml(vide, Simu.valeursReelles(vide, Reel), ""));
  assert.match(t, /Ton profil n'est pas encore rempli : revenus, crédits et TMI utilisent des valeurs d'exemple\./);
  assert.match(n(Simu.repriseHtml({ profil: null }, Simu.valeursReelles(vide, Reel), "")), /Chargement de tes données…/);
});

test("« Compléter avec Claude » remplace « Modifier dans Compte › Données » ; les paramètres du simulateur restent", () => {
  assert.doesNotMatch(html, /Modifier dans Compte › Données|data-goto-tab="compte\/donnees"/);
  assert.match(html, /<span class="fp-claude" data-fp="claude"><\/span>/);
  assert.match(js, /UI\.demanderAClaude\(phraseClaude\(window\.ClaudePrompts\),"Compléter avec Claude"\)/);
  assert.equal(Simu.phraseClaude(ClaudePrompts), ClaudePrompts.phrase("bilan", "mes revenus, mes crédits, mon épargne et ma tranche d'imposition, utilisés par Pilotage › Scénarios"));
  assert.match(Simu.phraseClaude(null), /^Boussole : aide-moi à compléter mon bilan \(.*\)\. Commence par demarrer_session/);
  // paramètres d'exploration (non enregistrés dans le store) toujours présents
  for (const id of ["zone", "surfaceR", "prix", "loyer", "data-fp=\"part\"", "data-fp=\"rec\""]) assert.ok(html.includes(id), id);
  assert.doesNotMatch(js, /Store\.(set|save|update|ecrire)/, "aucune écriture au store");
});

test("tutoiement : aucun « vous / votre / vos » ni impératif au vouvoiement dans le simulateur", () => {
  const VOUS = /(^|[^\p{L}])(vous|votre|vos|vôtres?)(?![\p{L}])/iu;
  for (const [f, t] of [["simu.js", js], ["simu.html", html], ["simu.css", css]]) {
    assert.doesNotMatch(t, VOUS, f);
    assert.doesNotMatch(t, /\b(Indiquez|Renseignez|Complétez|Modifiez|Ajoutez|Choisissez|Répondez|Cliquez)\b/, f);
  }
});

test("liens de sources externes : https, ouverts dans un nouvel onglet avec rel=\"noopener noreferrer\"", () => {
  const liens = html.match(/<a\s[^>]*>/g) || [];
  assert.ok(liens.length >= 25, "liens de sources introuvables");
  for (const a of liens) {
    assert.match(a, /href="https:\/\//, "lien externe en https : " + a);
    assert.match(a, /target="_blank"/, a);
    assert.match(a, /rel="noopener noreferrer"/, a);
  }
  assert.doesNotMatch(html, /href="http:\/\//, "aucun lien http en clair");
});
