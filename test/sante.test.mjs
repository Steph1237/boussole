// Score de santé financière : vue Pilotage › Santé (web/src/sante.*) et port TypeScript du score
// dans le connecteur MCP (supabase/functions/mcp/index.ts). Contrôles statiques + calcul sur la démo.
// Patrimoine › Placements (pilotage) ne porte plus ni la carte santé ni les alertes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const path = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
const read = rel => readFileSync(path(rel), "utf8");
const sansCommentaires = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const compact = s => s.replace(/\s+/g, "");

const js = read("web/src/sante.js"), html = read("web/src/sante.html"), css = read("web/src/sante.css");
const pilotageJs = sansCommentaires(read("web/src/pilotage.js")), pilotageHtml = read("web/src/pilotage.html");
const planJs = sansCommentaires(read("web/src/plan.js")), mcp = sansCommentaires(read("supabase/functions/mcp/index.ts"));

const scopedSelectors = (src, prefix) => {
  const c = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s));
  return sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith(prefix));
};
/* Variante stricte pour la santé : chaque « @media … { » est remplacé par « } », pour contrôler aussi la première règle de chaque
   @media (comme test/risque-view.test.mjs). */
const selecteursHorsPortee = (src, prefix) => {
  const c = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !/^(from|to|\d+%)$/.test(s));
  return sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith(prefix));
};
/* Textes affichés au tutoiement : plus de « vous / votre / vos » (ni d'impératif en -ez) hors textes des moteurs. */
const VOUVOIEMENT = /\b(vous|votre|vos|Vous|Votre|Vos)\b|\b(complétez|indiquez|ouvrez|répondez|renseignez|laissez|survolez|cochez)\b/i;
const textesHtml = h => h.replace(/<[^>]+>/g, " ");
const chainesJs = src => [...sansCommentaires(src).matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map(m => m[1] ?? m[2] ?? m[3]);

test("santé : la vue calcule les bonnes pratiques avec Pratiques.evaluer, dans le périmètre courant, et s'enregistre", () => {
  assert.match(js, /window\.Pratiques\.evaluer\(\{positions:S\.positions,profil:S\.profil,config:S\.config,budget:S\.budget,objectifs:S\.objectifs,scope:S\.scope,risque:S\.risque,classes:S\.classes,banque:S\.banque\|\|null,today:/);
  assert.match(js, /if\(!window\.Pratiques\|\|typeof window\.Pratiques\.evaluer!=="function"\) return null;/, "sans pratiques.js : pas de note, pas d'erreur");
  for (const k of ["scope", "profil", "budget", "objectifs", "risque", "classes", "banque"]) assert.match(js, new RegExp(k + ":snap\\." + k));
  assert.match(js, /last=calcule\(\)/, "recalculé à chaque mise à jour du store");
  assert.match(js, /App\.register\("sante",api\)/);
  assert.doesNotMatch(js, /Plan\.score/, "le score historique n'est plus affiché ici");
  assert.doesNotThrow(() => new vm.Script(js, { filename: "sante.js" }));
});

test("santé : structure — question, verdict, familles en accordéons, critères à compléter, méthode en accordéon, Claude", () => {
  assert.match(js, /"Bonnes pratiques "\+scopeDe\(\)/);
  assert.ok(html.includes(">Bonnes pratiques<"));
  assert.ok(html.includes("Ma situation est-elle saine ?"));
  for (const id of ["santeTotal", "santeBadge", "santeVerdict", "santeJauge", "santeClaude", "santeFamilles", "santeACompleter", "santeACList"])
    assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<details class="ui-acc st-how">\s*<summary class="ui-acc-titre"><span>Comment cette note est calculée<\/span>/, "méthode en accordéon fermé");
  assert.doesNotMatch(html, /<details[^>]*\sopen/, "rien n'est déplié d'office");
  assert.match(js, /u\.demanderAClaude\(questionPage\(r\)\)/);
  assert.match(js, /u\.brancher\(root,\{surCarte:/, "cartes → panneau");
  assert.match(js, /u\.panneau\.ouvrir\(/);
});

test("santé : lecture seule — aucune écriture au store, « Compléter avec Claude » ciblés, plus de lienDe", () => {
  assert.doesNotMatch(sansCommentaires(js), /Store\.|\.db\.|\.update\(\{|\.insert\(|\.upsert\(/, "aucune écriture au store");
  assert.doesNotMatch(js + html, /<form|<input|<select|<textarea/, "aucun formulaire de saisie");
  assert.doesNotMatch(js, /lienDe|CRITERES_OBJECTIFS/, "lienDe retiré (pratiques.js renvoie déjà patrimoine/objectifs)");
  assert.match(js, /"Compléter avec Claude"/);
  assert.match(js, /ClaudePrompts/);
});

test("santé : textes affichés au tutoiement (hors textes de pratiques.js)", () => {
  assert.doesNotMatch(textesHtml(html), VOUVOIEMENT, "sante.html");
  const bad = chainesJs(js).filter(t => VOUVOIEMENT.test(t));
  assert.deepEqual(bad, [], "sante.js");
});

test("santé : chiffre clé « 90/100 », mention permanente et explication du calcul", () => {
  assert.match(js, /function headline\(\)\{ return last&&last\.familles\.some\(f=>f\.total!=null\)\?last\.total\+"\/100":"–"; \}/);
  assert.ok(html.includes("Indicateur pédagogique, pas un conseil en investissement."));
  assert.ok(html.includes("Sécurité 30 %, Effort 25 %, Allocation 30 %, Efficacité 15 %"));
  // Paliers de l'explication = barèmes de plan.js (repris par pratiques.js pour matelas, épargne, endettement, concentration).
  for (const b of ["[[1, 5], [3, 15]]", "[[6, 20], [12, 15]]", "[[0, 0], [5, 6], [10, 12], [15, 16], [20, 20]]", "[[25, 20], [35, 12], [45, 0]]", "[[10, 20], [20, 14], [40, 0]]"])
    assert.ok(compact(planJs).includes(compact(b)), `plan.js : barème ${b} absent`);
  for (const t of ["de 1 à 3 mois : de 5 à 15 points", "de 3 à 6 mois : 20 points", "jusqu'à 15 points à 12 mois",
    "0 % : 0 point ; 5 % : 6 ; 10 % : 12 ; 15 % : 16 ; 20 % ou plus : 20", "25 % ou moins : 20 points ; 35 %", "45 % ou plus : 0",
    "10 % ou moins : 20 points ; 20 % : 14 ; 40 % ou plus : 0", "Moins de 3 poches différentes : 5 points de moins", "Au-dessus de 80", "à partir de 16 points"])
    assert.ok(html.includes(t), `sante.html : « ${t} » absent`);
  // Poids de l'explication = poids de pratiques.js.
  const P = require("../web/src/pratiques.js");
  assert.deepEqual(P.FAMILLES.map(f => f.titre + " " + f.poids + " %"), ["Sécurité 30 %", "Effort 25 %", "Allocation 30 %", "Efficacité 15 %"]);
});

/* ------------------------------------------------------------ fonctions pures ------------------------------------------------------------ */
const SV = require("../web/src/sante.js");
const UIm = require("../web/src/ui.js");
const C = (cle, o = {}) => Object.assign({ cle, famille: "securite", titre: "Critère " + cle, points: 20, sur: 20, texte: "Texte " + cle, cible: "Repère " + cle,
  piste: "Piste " + cle, regle: "Règle " + cle, source: "Source " + cle, aCompleter: false, lien: "patrimoine/placements" }, o);
const R = (criteres, o = {}) => {
  const P = require("../web/src/pratiques.js");
  return Object.assign(P.agreger(criteres), { criteres }, o);
};

test("verdict : une phrase selon la note (80 / 60), provisoire, sans note, indisponible", () => {
  const solide = SV.verdict(R([C("a"), C("b", { famille: "effort" }), C("c", { famille: "allocation" }), C("d", { famille: "efficacite", points: 12 })]));
  assert.equal(solide.label, "Solide");
  assert.equal(solide.ton, "good");
  assert.equal(solide.phrase, "Oui, ta situation est solide, avec un point à travailler.");
  const correct = SV.verdict(R([C("a", { points: 12 }), C("b", { famille: "effort", points: 14 }), C("c", { famille: "allocation", points: 14 }), C("d", { famille: "efficacite" })]));
  assert.equal(correct.label, "Correct");
  assert.equal(correct.ton, "warn");
  assert.equal(correct.phrase, "Dans l'ensemble, oui : ta situation est correcte, avec trois points à travailler.");
  const faible = SV.verdict(R([C("a", { points: 4 }), C("b", { famille: "effort", points: 8 }), C("c", { famille: "allocation", points: 20 })]));
  assert.equal(faible.label, "À consolider");
  assert.equal(faible.ton, "crit");
  assert.match(faible.phrase, /^Pas encore : ta situation est à consolider, avec deux points à travailler\.$/);
  const parfait = SV.verdict(R([C("a"), C("b", { famille: "effort" }), C("c", { famille: "allocation" })]));
  assert.equal(parfait.phrase, "Oui, ta situation est solide.");
  // Provisoire : moins de la moitié du poids noté (Effort seul, 25 %)
  const prov = SV.verdict(R([C("b", { famille: "effort" }), C("x", { aCompleter: true, points: 0 })]));
  assert.equal(prov.provisoire, true);
  assert.equal(prov.label, "Provisoire");
  assert.equal(prov.note, "100");
  assert.equal(prov.phrase, "Note provisoire : 1 famille sur 4 notée ; complète ton bilan pour une note fiable.");
  assert.equal(prov.partiel, "Les critères à compléter ne comptent pas encore dans la note : ils sont regroupés en bas de page.");
  const rien = SV.verdict(R([C("x", { aCompleter: true, points: 0 }), C("y", { aCompleter: true, points: 0 })]));
  assert.equal(rien.note, "—");
  assert.match(rien.phrase, /^Pas encore de note/);
  assert.equal(rien.partiel, "Les critères à compléter sont regroupés en bas de page.");
  assert.doesNotMatch(rien.partiel + prov.partiel, /\d/, "règle 9 : pas de compteur hors navigation");
  assert.deepEqual(SV.verdict(null), { note: "—", label: "", phrase: "Le score n'est pas disponible dans cette vue.", ton: "", provisoire: false, partiel: "" });
});

test("niveau, valeurCarte, resumeFamille : jauge 16 / 10, information sans note", () => {
  assert.equal(SV.niveau(C("a", { points: 16 })), "good");
  assert.equal(SV.niveau(C("a", { points: 10 })), "warn");
  assert.equal(SV.niveau(C("a", { points: 9 })), "crit");
  assert.equal(SV.niveau(C("a", { aCompleter: true })), "na");
  assert.equal(SV.niveau(C("a", { informatif: true, points: null, sur: 0 })), "info");
  assert.equal(SV.valeurCarte(C("a", { points: 12 })), "12/20");
  assert.equal(SV.valeurCarte(C("a", { aCompleter: true })), "À compléter");
  assert.equal(SV.valeurCarte(C("a", { informatif: true, valeur: 0.342 })), "34 %");
  const f = { cle: "securite", titre: "Sécurité", poids: 30, total: 70, criteres: [C("a"), C("b", { points: 8 }), C("c", { aCompleter: true }), C("d", { informatif: true })] };
  assert.deepEqual(SV.resumeFamille(f), { note: "70", ton: "warn", notes: 2, aTravailler: 1, aCompleter: 1, sous: "des points à travailler · des données à compléter" });
  assert.equal(SV.resumeFamille({ total: null, criteres: [] }).sous, "aucun critère pour le moment");
  assert.equal(SV.resumeFamille({ total: 100, criteres: [C("a")] }).sous, "tout est au vert");
  assert.equal(SV.resumeFamille({ total: null, criteres: [C("c", { aCompleter: true })] }).sous, "des données à compléter");
});

test("groupesACompleter : critères à compléter regroupés par section de Claude (lien du critère tel quel), dans l'ordre", () => {
  const cs = [C("matelas", { aCompleter: true, lien: "patrimoine/budget" }), C("ok"), C("apport", { aCompleter: true, lien: "patrimoine/objectifs" }),
    C("dormant", { aCompleter: true, lien: "patrimoine/budget" }), C("liquidite_objectifs", { aCompleter: true, lien: "patrimoine/objectifs" }),
    C("protection", { aCompleter: true, lien: "compte/donnees" }), C("endettement", { aCompleter: true, lien: "compte/donnees" }),
    C("adequation", { aCompleter: true, lien: "pilotage/risque" }), C("frais", { aCompleter: true, lien: "patrimoine/placements" }), C("sans", { aCompleter: true, lien: null })];
  const g = SV.groupesACompleter(cs);
  assert.deepEqual(g.map(x => [x.section, x.titre, x.route, x.action, x.criteres.map(c => c.cle)]), [
    ["budget", "Ton budget", "patrimoine/budget", "Voir le budget", ["matelas", "dormant"]],
    ["objectifs", "Tes objectifs", "patrimoine/objectifs", "Voir les objectifs", ["apport", "liquidite_objectifs"]],
    ["protection", "Ta protection", "compte/donnees", "Voir tes données", ["protection"]],
    ["revenus", "Tes revenus", "compte/donnees", "Voir tes données", ["endettement"]],
    ["risque", "Ton profil de risque", "pilotage/risque", "Voir le profil de risque", ["adequation"]],
    ["placements", "Tes placements", "patrimoine/placements", "Voir les placements", ["frais"]],
    ["bilan", "Ton bilan", null, "", ["sans"]],
  ]);
  assert.deepEqual(SV.groupesACompleter([C("a")]), []);
  assert.equal(SV.lienDe, undefined, "lienDe retiré : le lien du critère est utilisé tel quel");
  assert.equal(SV.sectionDe(C("protection", { lien: "compte/donnees" })), "protection");
  assert.equal(SV.sectionDe(C("speculatif", { lien: "patrimoine/placements" })), "placements");
});

test("lienPanneau et questions pour Claude : où agir seulement si utile, question citant le critère", () => {
  assert.deepEqual(SV.lienPanneau(C("matelas", { aCompleter: true, lien: "patrimoine/budget" })), { label: "Voir le budget", href: "#patrimoine/budget" });
  assert.deepEqual(SV.lienPanneau(C("frais", { points: 8 })), { label: "Où agir : Patrimoine › Placements", href: "#patrimoine/placements" });
  assert.equal(SV.lienPanneau(C("frais", { points: 16 })), null, "critère au vert : pas de lien");
  assert.equal(SV.lienPanneau(C("devises", { informatif: true, points: null })), null);
  assert.match(SV.questionCritere(C("frais", { titre: "Frais des fonds", points: 8, texte: "Frais moyens de 1,2 %." })), /« Frais des fonds » est à 8\/20 : Frais moyens de 1,2 %\./);
  assert.match(SV.questionCritere(C("x", { aCompleter: true })), /est à compléter/);
  assert.match(SV.questionPage(R([C("a")])), /est de 100\/100/);
  assert.match(SV.questionPage(null), /compléter mon bilan/);
  // Pied du panneau : « Compléter avec Claude » ciblé (section du critère) pour un critère à compléter, « Demander à Claude » sinon.
  const P = require("../web/src/claude-prompts.js");
  const pc = SV.piedCritere(C("matelas", { aCompleter: true, lien: "patrimoine/budget", titre: "Matelas" }), UIm);
  assert.match(pc, />Compléter avec Claude</);
  assert.ok(pc.includes(UIm.esc(UIm.urlClaude(P.phrase("budget", "le critère « Matelas » de mes bonnes pratiques")))));
  assert.match(SV.piedCritere(C("frais", { points: 8 }), UIm), />Demander à Claude</);
  assert.equal(SV.phraseCompleter("protection", "x"), P.phrase("protection", "x"));
});

test("rendus : échappement du critère, règle et source en accordéon fermé, familles fermées par défaut", () => {
  const x = C("x<b>", { titre: "<img src=x onerror=alert(1)>", texte: "a & <b>", regle: "<script>r</script>", source: "\"s\"", piste: "<i>p</i>", points: 8 });
  const d = SV.detailCritereHtml(x, UIm);
  assert.doesNotMatch(d, /<script>|<img|<i>p|& <b>|x<b>/);
  assert.match(d, /&lt;script&gt;r&lt;\/script&gt;/);
  assert.match(d, /<details class="ui-acc"><summary class="ui-acc-titre"><span>Règle et source<\/span>/);
  assert.match(d, /<dt>Ta situation<\/dt><dd>a &amp; &lt;b&gt;<\/dd>/);
  assert.match(d, /Piste<\/b> &lt;i&gt;p&lt;\/i&gt;/);
  const r = R([x, C("b", { famille: "effort" })]);
  const f = SV.famillesHtml(r, UIm, new Set(["effort"]));
  assert.equal((f.match(/<details class="ui-acc st-fam/g) || []).length, 4);
  assert.match(f, /data-st-fam="effort" open>/);
  assert.match(f, /data-st-fam="securite">/, "fermée");
  assert.match(f, /poids 30 % de la note globale/);
  assert.doesNotMatch(f, /<img|<b>/);
  assert.match(f, /data-ui-carte="x&lt;b&gt;"/);
  const ac = SV.aCompleterHtml([C("matelas", { aCompleter: true, lien: "patrimoine/budget", titre: "<u>m</u>" })], UIm);
  assert.match(ac, /data-goto="patrimoine\/budget">Voir le budget<\/a>/);
  assert.match(ac, /class="ui-claude"[^>]*>.*Compléter avec Claude/);
  assert.match(ac, /Ton budget <span class="st-grp-etat">à compléter<\/span>/);
  assert.doesNotMatch(ac, /Débloque|<u>/, "plus de compteur « Débloque N critères »");
});

test("bonnes pratiques sur la démo : 4 familles, critères au contrat, liens vers des routes connues", () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const P = require("../web/src/pratiques.js"), App = require("../web/src/app.js");
  const D = global.window.DEMO;
  const known = new Set(App.SPACES.flatMap(sp => sp.subs.map(s => sp.space + "/" + s.id)));
  for (const scope of ["foyer", "p1", "p2"]) {
    const r = P.evaluer({ positions: D.positions, profil: D.profil, config: D.config, budget: D.budget, objectifs: D.objectifs, scope, risque: D.risque, classes: D.classes, today: new Date("2026-10-09T12:00:00") });
    assert.equal(r.familles.length, 4);
    assert.ok(r.total >= 0 && r.total <= 100);
    for (const c of r.criteres) {
      assert.ok(c.titre && c.regle && c.source && c.cible, scope + " " + c.cle);
      // Route canonique ou ancienne route de la table de correspondance : doit mener à une sous-vue existante.
      if (c.lien) { const x = App.resolve(c.lien); assert.ok(x && known.has(x.space + "/" + x.sub), "route inconnue : " + c.lien); }
      // Critères d'objectifs : pratiques.js renvoie déjà Patrimoine › Objectifs (d'où le retrait de lienDe dans la vue).
      if (["liquidite_objectifs", "apport"].includes(c.cle)) assert.equal(c.lien, "patrimoine/objectifs", c.cle);
      assert.ok(["budget", "objectifs", "revenus", "protection", "risque", "placements"].includes(SV.sectionDe(c)), c.cle);
    }
    assert.ok(SV.verdict(r).phrase.length > 10);
  }
});

/* ------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------ */
const attendre = () => new Promise(r => setTimeout(r, 0));
function vueSante(S0) {
  const dom = miniDom(), { doc } = dom;
  const modules = {};
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, CSS: { escape: s => String(s).replace(/["\\]/g, "\\$&") } };
  ctx.window = ctx; ctx.self = ctx;
  ctx.App = { register: (n, api) => { modules[n] = api; } };
  vm.createContext(ctx);
  for (const f of ["calc.js", "plan.js", "marche.js", "risque.js", "pratiques.js", "ui.js", "claude-prompts.js"]) vm.runInContext(read("web/src/" + f), ctx, { filename: f });
  vm.runInContext(js, ctx, { filename: "sante.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = html;
  const api = modules.sante;
  api.mount(root);
  api.update(S0, true);
  return { ctx, dom, doc, root, api };
}
const demoS = () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const D = JSON.parse(JSON.stringify(global.window.DEMO));
  return { scope: "foyer", people: D.people || [], positions: D.positions, config: D.config, profil: D.profil, budget: D.budget, objectifs: D.objectifs, risque: D.risque, classes: D.classes };
};

test("vue (DOM) : verdict en tête, 4 familles fermées, carte → panneau (règle, source, Claude), Échap rend le focus", async () => {
  const v = vueSante(demoS());
  const $ = id => v.root.querySelector("#" + id);
  assert.match($("santeTitle").textContent, /^Bonnes pratiques du foyer$/);
  assert.match($("santeTotal").textContent, /^\d+$/);
  assert.ok($("santeVerdict").textContent.length > 10);
  assert.match($("santeClaude").innerHTML, /claude\.ai\/new\?q=/);
  const fams = v.root.querySelectorAll("[data-st-fam]");
  assert.equal(fams.length, 4);
  assert.ok(fams.every(d => !d.hasAttribute("open")), "familles fermées par défaut");
  const carte = v.root.querySelector("[data-ui-carte]");
  carte.focus(); carte.click();
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  assert.equal(dlg.hidden, false, "panneau ouvert");
  assert.match(dlg.querySelector(".ui-panneau-corps").textContent, /Ta situation/);
  assert.match(dlg.querySelector(".ui-panneau-corps").innerHTML, /Règle et source/);
  assert.match(dlg.querySelector(".ui-panneau-pied").innerHTML, /Demander à Claude/);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true);
  assert.equal(v.doc.activeElement, carte, "focus rendu à la carte");
  assert.equal(v.api.headline(), $("santeTotal").textContent + "/100");
  await attendre();
});

test("vue (DOM) : sans budget ni profil, critères à compléter regroupés en fin avec l'action ; rafraîchi par le store, le focus revient à la carte du même critère", () => {
  const S0 = Object.assign(demoS(), { budget: null, profil: null, risque: null, config: null });
  const v = vueSante(S0);
  const ac = v.root.querySelector("#santeACompleter");
  assert.equal(ac.hidden, false, "bloc « À compléter » visible");
  const liste = v.root.querySelector("#santeACList");
  assert.match(liste.innerHTML, /data-goto="patrimoine\/budget"/);
  assert.doesNotMatch(liste.innerHTML, /Débloque/);
  assert.match(liste.innerHTML, /Compléter avec Claude/);
  const c0 = ac.querySelector("[data-ui-carte]");
  const cle = c0.getAttribute("data-ui-carte");
  c0.focus(); c0.click();
  assert.match(v.doc.body.querySelector(".ui-panneau-pied").innerHTML, /Compléter avec Claude/, "critère à compléter : Compléter avec Claude");
  // le store émet un état différent pendant l'ouverture : la page est redessinée
  v.api.update(Object.assign(demoS(), { budget: null, profil: null, risque: null, config: null, positions: demoS().positions.slice(1) }), true);
  v.dom.touche(v.doc.activeElement, "Escape");
  const c1 = v.root.querySelector('[data-ui-carte="' + cle + '"]');
  assert.ok(c1);
  assert.equal(v.doc.activeElement, c1);
});

test("vue (DOM) : panneau ouvert rafraîchi par le store sans voler le focus ni rouvrir le panneau", () => {
  const v = vueSante(demoS());
  const carte = v.root.querySelector('[data-ui-carte="geographie"]');
  const cle = carte.getAttribute("data-ui-carte");
  carte.focus(); carte.click();
  const corps = v.doc.body.querySelector(".ui-panneau-corps"), titre = v.doc.body.querySelector(".ui-panneau-titre");
  const sum = corps.querySelector("summary");
  sum.setAttribute("x", "1"); corps.querySelector("details").setAttribute("open", "");
  sum.focus();
  const avant = corps.innerHTML, focusTitre = titre.focusCount;
  // le store émet un état différent (première position revalorisée) : le texte du critère change, le panneau reste ouvert
  const S1 = demoS(); S1.positions = S1.positions.map((p, i) => i === 0 ? Object.assign({}, p, { qty: (p.qty || 1) * 1.1, valeur: (p.valeur || 0) * 1.1 }) : p);
  v.api.update(S1, true);
  assert.equal(v.doc.body.querySelector('[role="dialog"]').hidden, false);
  assert.notEqual(corps.innerHTML, avant, "corps réécrit");
  assert.equal(titre.focusCount, focusTitre, "le focus n'est pas remis sur le titre");
  assert.equal(v.doc.activeElement.localName, "summary", "focus rendu au même élément du corps");
  assert.ok(corps.contains(v.doc.activeElement));
  assert.ok(corps.querySelector("details").hasAttribute("open"), "accordéon ouvert gardé");
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.activeElement, v.root.querySelector('[data-ui-carte="' + cle + '"]'));
});

test("santé : CSS entièrement scopé sous #view-sante (et .ui-panneau .st-… pour le panneau), première règle des @media comprise", () => {
  assert.deepEqual(selecteursHorsPortee(css, "#view-sante").filter(x => !x.startsWith(".ui-panneau .st-")), []);
  assert.ok(selecteursHorsPortee(css, "#view-sante").length > 0, "styles du panneau présents");
});

test("pilotage (Bilan › Placements) : plus de carte santé, d'alertes ni de règles", () => {
  assert.doesNotMatch(pilotageJs, /Plan\.score/);
  assert.doesNotMatch(pilotageJs, /Rules\.evaluate/);
  assert.doesNotMatch(pilotageJs, /Rules\.builtins/);
  assert.doesNotMatch(pilotageHtml, /id="sante"|id="alerts"|id="ruleForm"|id="cushForm"/);
  assert.match(pilotageJs, /function headline\(\) \{ return S && \(S\.positions \|\| \[\]\)\.length \? eur\(totaux\(S\)\.total\) : "–"; \}/, "le chiffre clé reste le total financier");
});

// Placements refait en CK3 : sélecteur commun UI.periode (période + granularité, dates libres incluses) ; détail dans test/pilotage.test.mjs.
test("pilotage : courbe d'évolution filtrée par période et par pas (periodes.js), choix mémorisés", () => {
  assert.match(pilotageJs, /const Pe = dep\(deps, "Periodes"\)/);
  assert.match(pilotageJs, /Pe\.agreger\(pts, b, g, x => x\.v\)/);
  assert.match(pilotageJs, /Pe\.resume\(ag, pts, b, x => x\.v\)/);
  assert.match(pilotageJs, /Pe\.bornes\(/);
  assert.match(pilotageJs, /Pe\.auto\(b\)/);
  assert.match(pilotageJs, /EVO_KEY = "pilotage-evo"/);
  assert.match(pilotageJs, /serie\[serie\.length - 1\]\.live = true/, "la valeur en direct reste le dernier point");
  assert.match(pilotageJs, /sur la période/);
  assert.match(pilotageJs, /u\.periode\(\$\("plPeriode"\)/, "sélecteur commun : 1 m · 3 m · 1 an · Tout · Personnalisée (Du / Au) et granularité");
  assert.match(pilotageHtml, /id="plPeriode"/);
});

test("pilotage : CSS entièrement scopé sous #view-pilotage (et .ui-panneau .pl-… pour le panneau)", () => {
  assert.deepEqual(scopedSelectors(read("web/src/pilotage.css"), "#view-pilotage").filter(x => !x.startsWith(".ui-panneau .pl-")), []);
});

test("parité plan.js / MCP : mêmes barèmes d'interpolation, dans le même ordre", () => {
  const baremes = src => [...src.matchAll(/interp\([^,]+,\s*(\[\[[^\n]*?\]\])\)/g)].map(m => compact(m[1]));
  const a = baremes(planJs), b = baremes(mcp);
  assert.equal(a.length, 5, "plan.js : 5 barèmes attendus (matelas ×2, épargne, endettement, concentration)");
  assert.deepEqual(b, a);
});

test("parité plan.js / MCP : seuils et repères identiques", () => {
  const SEUILS = [
    "mois < 1 ? 0", "mois <= 6 ? 20", "mois <= 12 ?",                 // matelas : 1, 3, 6, 12 mois
    "t >= 0.15 ?",                                                     // épargne : 0 / 5 / 10 / 15 / 20 %
    "t <= 0.35 ?",                                                     // endettement : 25 / 35 / 45 %
    "nb < 3 ? 5 : 0", "max <= 0.2 && nb >= 3",                         // concentration : 10 / 20 / 40 %, 3 poches
    "{ u30: 0.5, a30: 1, a40: 3, a50: 6, a60: 8, a70: 10 }",           // patrimoine : repères par âge
    "clamp(annees / repere, 0, 1) * 20",
    "Math.round(sum(complets, (i) => i.points) / (20 * complets.length) * 100)",
    "versementAlloue >= 1.1 * effort - EPS", "versementAlloue >= 0.95 * effort - EPS", // statut des objectifs
    "Math.max(0, (c - d * f) * r / (f - 1))",                          // effort mensuel (annuité)
    "Math.pow(1 + n(tauxAnnuel) / 100, 1 / 12) - 1",
  ];
  const norm = s => compact(s).replace(/\(i\)=>/g, "i=>").replace(/num\(/g, "n(");
  for (const s of SEUILS) {
    assert.ok(norm(planJs).includes(norm(s)), `plan.js : « ${s} » absent`);
    assert.ok(norm(mcp).includes(norm(s)), `index.ts : « ${s} » absent`);
  }
});

test("score sur la démo : complet, cinq critères sur 20, total cohérent", () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const Plan = require("../web/src/plan.js");
  const D = global.window.DEMO;
  for (const scope of ["foyer", "p1", "p2"]) {
    const r = Plan.score({ positions: D.positions, profil: D.profil, config: D.config, budget: D.budget, scope, today: new Date("2026-10-09T12:00:00") });
    assert.equal(r.items.length, 5);
    assert.ok(r.items.every(i => i.sur === 20 && i.points >= 0 && i.points <= 20 && i.titre && i.texte && i.piste));
    assert.ok(r.total >= 0 && r.total <= 100);
    if (scope === "foyer") { assert.equal(r.complet, true); assert.ok(r.total >= 80, `démo foyer : ${r.total}`); }
  }
});
