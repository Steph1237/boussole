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

test("santé : structure — en-tête, familles en onglets, méthode en accordéon fermé, Claude", () => {
  assert.match(js, /"Bonnes pratiques "\+scopeDe\(\)/);
  assert.ok(html.includes(">Bonnes pratiques<"));
  for (const id of ["santeTitle", "santeEntete", "santeVerdict", "santeFamSec", "santeFamilles"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<details class="ui-acc st-how">\s*<summary class="ui-acc-titre"><span>Comment cette note est calculée<\/span>/, "méthode en accordéon fermé");
  assert.doesNotMatch(html, /<details[^>]*\sopen/, "rien n'est déplié d'office");
  assert.doesNotMatch(html, /santeACompleter/, "plus de bloc « À compléter » en bas de page : les cartes grises sont dans leur famille");
  assert.match(js, /demanderAClaude\(questionPage\(r\)\)/);
  assert.match(js, /u\.brancher\(root,\{surCarte:/, "cartes et lignes « Ce qui te coûte le plus » → panneau");
  assert.match(js, /u\.panneau\.ouvrir\(/);
});

test("santé : lecture seule — aucune écriture au store, « Compléter avec Claude » ciblés", () => {
  assert.doesNotMatch(sansCommentaires(js), /Store\.|\.db\.|\.update\(\{|\.insert\(|\.upsert\(/, "aucune écriture au store");
  assert.doesNotMatch(js + html, /<form|<input|<select|<textarea/, "aucun formulaire de saisie");
  assert.match(js, /"Compléter avec Claude"/);
  assert.match(js, /ClaudePrompts/);
});

test("santé : textes affichés au tutoiement (hors textes de pratiques.js)", () => {
  assert.doesNotMatch(textesHtml(html), VOUVOIEMENT, "sante.html");
  const bad = chainesJs(js).filter(t => VOUVOIEMENT.test(t));
  assert.deepEqual(bad, [], "sante.js");
});

test("santé : chiffre clé « 90/100 », mention permanente, poids rappelés une seule fois (pas dans la méthode)", () => {
  assert.match(js, /function headline\(\)\{ return last&&last\.familles\.some\(f=>f\.total!=null\)\?last\.total\+"\/100":"–"; \}/);
  assert.ok(html.includes("Indicateur pédagogique, pas un conseil en investissement."));
  assert.doesNotMatch(html, /Sécurité 30 %/, "les poids sont rappelés une seule fois, au-dessus des onglets");
  for (const t of ["Chaque critère vaut 20 points", "60 %", "provisoire", "à compléter", "bon", "à surveiller", "à travailler"])
    assert.ok(html.includes(t), `sante.html : « ${t} » absent`);
  // Poids affichés = poids de pratiques.js.
  const P = require("../web/src/pratiques.js");
  assert.deepEqual(P.FAMILLES.map(f => f.titre + " " + f.poids + " %"), ["Sécurité 30 %", "Effort 25 %", "Allocation 30 %", "Efficacité 15 %"]);
});

/* ------------------------------------------------------------ fonctions pures ------------------------------------------------------------ */
const SV = require("../web/src/sante.js");
const UIm = require("../web/src/ui.js");
const CP = require("../web/src/claude-prompts.js");
const P = require("../web/src/pratiques.js");
const ZONES_MATELAS = [{ jusqua: 1, statut: "travailler" }, { jusqua: 3, statut: "surveiller" }, { jusqua: 6, statut: "bon" }, { jusqua: null, statut: "surveiller" }];
/* Critère au nouveau contrat (spec cp4 § 3), avec les anciens champs gardés. */
const N = (cle, o = {}) => Object.assign({
  cle, famille: "securite", libelle: "Critère " + cle, titre: "Critère " + cle, statut: "bon", points: 18, max: 20, sur: 20,
  mesure: { valeur: 4.2, unite: "mois", texte: "4,2 mois de dépenses" },
  repere: { texte: "3 à 6 mois de dépenses", zones: ZONES_MATELAS },
  pourquoi: "Ton matelas couvre plus de 3 mois de dépenses.",
  calcul: ["Épargne disponible : 12 600 €", "Dépenses réelles : 3 000 € par mois", "12 600 ÷ 3 000 = 4,2 mois"],
  donnees: [{ libelle: "Livret A", valeur: "12 600 €", lien: { ligne: "l1" } }],
  ameliorer: [{ action: "Porte ton matelas à 6 mois (≈ +5 400 €)", gain_points: 2 }],
  manque: [], source_donnees: "réel, juillet à septembre", confiance: "complete",
  texte: "Ancien texte", cible: "Ancienne cible", regle: "Règle " + cle, source: "Source " + cle, lien: "patrimoine/budget", aCompleter: false,
}, o);
/* Critère « à compléter » au nouveau contrat : pas de note. */
const A = (cle, o = {}) => N(cle, Object.assign({ statut: "a_completer", points: null, aCompleter: true, mesure: null, repere: { texte: "Repère " + cle, zones: [] },
  pourquoi: "", calcul: [], donnees: [], ameliorer: [], manque: ["Tes dépenses mensuelles"], confiance: "absente" }, o));
/* Ancien contrat (pratiques.js avant CP4) : la vue reste lisible. */
const C = (cle, o = {}) => Object.assign({ cle, famille: "securite", titre: "Critère " + cle, points: 20, sur: 20, texte: "Texte " + cle, cible: "Repère " + cle,
  piste: "Piste " + cle, regle: "Règle " + cle, source: "Source " + cle, aCompleter: false, lien: "patrimoine/placements" }, o);
const R = (criteres, o = {}) => Object.assign(P.agreger(criteres), { criteres }, o);
/* Jeu d'en-tête : pertes = (20 − points) ÷ (20 × critères notés de la famille) × 100 × poids ÷ poids notés. */
const jeuEntete = () => R([
  N("matelas", { points: 14, statut: "surveiller", libelle: "Matelas de précaution", ameliorer: [{ action: "Porte ton matelas à 6 mois", gain_points: 6 }] }),
  N("epargne", { famille: "effort", points: 8, statut: "travailler", libelle: "Taux d'épargne", ameliorer: [{ action: "Épargne 200 € de plus par mois", gain_points: 8 }] }),
  N("adequation", { famille: "allocation", points: 20 }),
  N("frais", { famille: "efficacite", points: 10, statut: "surveiller", ameliorer: [], piste: "Compare les frais de tes fonds" }),
  A("protection"),
]);

test("normaliser : nouveau contrat lu tel quel, ancien contrat en repli (statut, pourquoi, repère, manque)", () => {
  const n = SV.normaliser(N("matelas", { statut: "surveiller", points: 14 }));
  assert.equal(n.nom, "Critère matelas");
  assert.equal(n.statut, "surveiller");
  assert.equal(n.points, 14);
  assert.equal(n.max, 20);
  assert.deepEqual(n.mesure, { valeur: 4.2, unite: "mois", texte: "4,2 mois de dépenses" });
  assert.equal(n.repere.texte, "3 à 6 mois de dépenses");
  assert.equal(n.repere.zones.length, 4);
  assert.equal(n.pourquoi, "Ton matelas couvre plus de 3 mois de dépenses.");
  assert.deepEqual(n.ameliorer, [{ action: "Porte ton matelas à 6 mois (≈ +5 400 €)", gain_points: 2 }]);
  assert.equal(SV.normaliser(n), n, "idempotent");
  const o = SV.normaliser(C("frais", { points: 12 }));
  assert.equal(o.nom, "Critère frais");
  assert.equal(o.statut, "surveiller");
  assert.equal(o.pourquoi, "Texte frais");
  assert.equal(o.repere.texte, "Repère frais");
  assert.deepEqual(o.repere.zones, []);
  assert.equal(o.mesure.texte, "");
  assert.equal(SV.normaliser(C("a", { points: 16 })).statut, "bon");
  assert.equal(SV.normaliser(C("a", { points: 10 })).statut, "surveiller");
  assert.equal(SV.normaliser(C("a", { points: 9 })).statut, "travailler");
  const ac = SV.normaliser(C("a", { aCompleter: true, points: 0, texte: "Dépenses inconnues." }));
  assert.equal(ac.statut, "a_completer");
  assert.equal(ac.points, null, "jamais de note sans données");
  assert.deepEqual(ac.manque, ["Dépenses inconnues."]);
  const info = SV.normaliser(C("devises", { informatif: true, points: null, sur: 0, valeur: 0.342 }));
  assert.equal(info.statut, "info");
  assert.equal(info.points, null);
  assert.equal(info.mesure.texte, "34 %");
  assert.equal(SV.normaliser(A("x")).points, null);
  assert.equal(SV.normaliser(N("x", { statut: "a_completer", points: 0 })).points, null, "statut à compléter : points ignorés");
  assert.equal(SV.normaliser(null).statut, "a_completer");
  assert.deepEqual(SV.normaliser(N("x", { ameliorer: ["Texte seul", { action: "" }, null] })).ameliorer, [{ action: "Texte seul", gain_points: null }]);
});

test("état en mots, en plus de la couleur : bon, à surveiller, à travailler, à compléter", () => {
  assert.deepEqual(["bon", "surveiller", "travailler", "a_completer"].map(s => SV.ETATS[s].mot), ["bon", "à surveiller", "à travailler", "à compléter"]);
  assert.deepEqual(["bon", "surveiller", "travailler", "a_completer"].map(s => SV.ETATS[s].ton), ["good", "warn", "crit", "na"]);
});

test("jaugeSvg : zones rouge / orange / vert d'après repere.zones, position de l'utilisateur, texte équivalent", () => {
  const n = N("matelas");
  const g = SV.jaugeSvg(n);
  assert.match(g, /^<span class="st-jauge" role="img" aria-label="[^"]+">/);
  assert.match(g, /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
  const zones = [...g.matchAll(/class="st-z (\w+)( on)?"/g)].map(m => m[1] + (m[2] ? "*" : ""));
  assert.deepEqual(zones, ["travailler", "surveiller", "bon*", "surveiller"], "zones dans l'ordre, celle de l'utilisateur marquée");
  assert.match(g, /class="st-j-pos"/);
  assert.equal(g.match(/aria-label="([^"]+)"/)[1], "Ta position : 4,2 mois de dépenses, zone verte (bon). Repère : 3 à 6 mois de dépenses.");
  const geo = SV.geometrieJauge(SV.normaliser(n));
  assert.equal(geo.lo, 0);
  assert.ok(geo.hi > 6, "zone ouverte : l'échelle dépasse la dernière borne");
  assert.equal(geo.actif, "bon");
  assert.ok(Math.abs(geo.pos - 4.2 / geo.hi) < 1e-9, "position proportionnelle");
  // Zones données dans le désordre, zone ouverte en tête (endettement : bas = bien) ; au-delà, zone rouge.
  const e = SV.geometrieJauge(SV.normaliser(N("endettement", { mesure: { valeur: 41, unite: "%", texte: "41 % des revenus" },
    repere: { texte: "35 % au plus", zones: [{ jusqua: null, statut: "travailler" }, { jusqua: 25, statut: "bon" }, { jusqua: 35, statut: "surveiller" }] } })));
  assert.deepEqual(e.segs.map(s => s.statut), ["bon", "surveiller", "travailler"]);
  assert.equal(e.actif, "travailler");
  // Valeur au-delà d'une dernière borne fermée : l'échelle s'étend jusqu'à elle.
  const f = SV.geometrieJauge(SV.normaliser(N("x", { mesure: { valeur: 3, texte: "3 %" }, repere: { texte: "r", zones: [{ jusqua: 0.4, statut: "bon" }, { jusqua: 1.2, statut: "surveiller" }, { jusqua: 1.8, statut: "travailler" }] } })));
  assert.ok(f.hi >= 3 && f.pos <= 1 && f.pos > 0.9);
  assert.equal(f.actif, "travailler");
  // Sans zones (ancien contrat) : jauge de la note /20, rouge sous 10, orange sous 16, vert au-delà.
  const o = SV.jaugeSvg(C("frais", { points: 12 }));
  assert.equal(o.match(/aria-label="([^"]+)"/)[1], "Note : 12 sur 20, zone orange (à surveiller). Repère : Repère frais.");
  assert.deepEqual([...o.matchAll(/class="st-z (\w+)/g)].map(m => m[1]), ["travailler", "surveiller", "bon"]);
  // Décorative (carte : la mesure et l'état sont déjà écrits) ; aucune jauge sans données.
  assert.match(SV.jaugeSvg(n, { decoratif: true }), /^<span class="st-jauge" aria-hidden="true">/);
  assert.equal(SV.jaugeSvg(A("x")), "");
  // Position inconnue : zones sans repère de position.
  const sans = SV.jaugeSvg(N("x", { mesure: { valeur: null, texte: "" } }));
  assert.doesNotMatch(sans, /st-j-pos/);
  assert.match(sans, /aria-label="Position inconnue\. Repère : 3 à 6 mois de dépenses\."/);
  // Échappement.
  assert.doesNotMatch(SV.jaugeSvg(N("x", { mesure: { valeur: 2, texte: "<b>2</b>" }, repere: { texte: "\"r\"", zones: ZONES_MATELAS } })), /<b>|"r"/);
});

test("carteHtml : nom, jauge, mesure en clair, note /20, pourquoi, état en mots ; « à compléter » grise avec le manque et Claude", () => {
  const h = SV.carteHtml(N("matelas", { statut: "surveiller", points: 14 }), UIm);
  assert.match(h, /^<div class="st-carte warn" data-st-critere="matelas">/);
  assert.match(h, /<button type="button" class="st-carte-btn" data-ui-carte="matelas" data-st-carte="matelas" aria-haspopup="dialog">/);
  assert.match(h, /<span class="st-carte-nom">Critère matelas<\/span>/);
  assert.match(h, /<span class="ui-badge attention st-etat">à surveiller<\/span>/);
  assert.match(h, /<span class="st-mesure">4,2 mois de dépenses<\/span>/);
  assert.match(h, /14<span class="st-sur">\/20<\/span>/);
  assert.match(h, /<span class="st-carte-pourquoi">Ton matelas couvre plus de 3 mois de dépenses\.<\/span>/);
  assert.match(h, /class="st-jauge" aria-hidden="true"/);
  assert.doesNotMatch(h, /poids|de la note globale/, "le poids n'est plus répété sur chaque carte");
  const a = SV.carteHtml(A("matelas", { lien: "patrimoine/budget", libelle: "Matelas" }), UIm);
  assert.match(a, /^<div class="st-carte na" data-st-critere="matelas">/);
  assert.match(a, /ui-badge neutre st-etat">à compléter</);
  assert.match(a, /Il manque<\/span> Tes dépenses mensuelles/);
  assert.doesNotMatch(a, /st-jauge|\/20/, "ni note ni jauge sans données");
  assert.match(a, /<\/button><div class="st-carte-actions"><a class="ui-claude"[^>]*>.*Compléter avec Claude/, "lien hors du bouton");
  assert.ok(a.includes(UIm.esc(UIm.urlClaude(CP.phrase("budget", "le critère « Matelas » de mes bonnes pratiques")))));
  const o = SV.carteHtml(C("frais", { points: 8 }), UIm);
  assert.match(o, /st-carte crit/);
  assert.match(o, /à travailler/);
  assert.match(o, /Texte frais/);
  assert.match(o, /8<span class="st-sur">\/20/);
  const i = SV.carteHtml(C("devises", { informatif: true, points: null, sur: 0, valeur: 0.34 }), UIm);
  assert.match(i, /information/);
  assert.match(i, /34 %/);
  assert.doesNotMatch(i, /st-sur/);
  const x = SV.carteHtml(N("x\"<", { libelle: "<img src=x onerror=1>", pourquoi: "a & <b>", mesure: { valeur: 1, texte: "<i>" } }), UIm);
  assert.doesNotMatch(x, /<img|<b>|<i>|x"</);
  assert.match(x, /data-ui-carte="x&quot;&lt;"/);
});

test("couverture : « calculée sur N critères sur M », informatifs exclus, couverture fournie prioritaire", () => {
  const r = R([N("a"), A("b"), A("c"), C("d", { informatif: true, points: null, sur: 0 })]);
  assert.deepEqual(SV.couvertureDe(r), { notes: 1, total: 3, part: 1 / 3, texte: "calculée sur 1 critère sur 3" });
  assert.equal(SV.couvertureDe({ criteres: [N("a"), N("b")], couverture: { notes: 7, total: 11 } }).texte, "calculée sur 7 critères sur 11");
  assert.equal(SV.couvertureDe({ criteres: [N("a")], couverture: 0.8 }).texte, "calculée sur 1 critère sur 1", "ancienne couverture (part du poids) ignorée");
  assert.equal(SV.couvertureDe(R([A("a")])).texte, "pas encore calculée : il manque des données");
  assert.equal(SV.couvertureDe(null).total, 0);
});

test("verdict : une phrase selon la note (80 / 60), provisoire sous 60 % de couverture, sans note, indisponible", () => {
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
  assert.equal(faible.phrase, "Pas encore : ta situation est à consolider, avec deux points à travailler.");
  assert.equal(SV.verdict(R([C("a"), C("b", { famille: "effort" }), C("c", { famille: "allocation" })])).phrase, "Oui, ta situation est solide.");
  const prov = SV.verdict(R([C("a"), C("b", { famille: "effort" }), C("x", { aCompleter: true, points: 0 }), C("y", { aCompleter: true, points: 0 })]));
  assert.equal(prov.provisoire, true, "2 critères sur 4 : sous 60 %");
  assert.equal(prov.label, "Provisoire");
  assert.equal(prov.note, "100");
  assert.equal(prov.phrase, "Note provisoire, calculée sur une partie de tes critères : complète les données manquantes pour une note fiable.");
  assert.equal(SV.verdict(R([C("a"), C("b"), C("c"), C("x", { aCompleter: true, points: 0 })])).provisoire, false, "3 sur 4 : 75 %");
  const rien = SV.verdict(R([C("x", { aCompleter: true, points: 0 }), C("y", { aCompleter: true, points: 0 })]));
  assert.equal(rien.note, "—");
  assert.match(rien.phrase, /^Pas encore de note/);
  assert.deepEqual(SV.verdict(null), { note: "—", label: "", phrase: "Le score n'est pas disponible dans cette vue.", ton: "", provisoire: false });
});

test("coutsPrincipaux : points perdus = (20 − points) × poids, rapportés sur 100 ; Pratiques.coutsPrincipaux prioritaire", () => {
  const r = jeuEntete();
  const c = SV.coutsPrincipaux(r, null);
  assert.deepEqual(c.map(x => [x.cle, x.points]), [["epargne", 15], ["matelas", 9], ["frais", 7.5]]);
  assert.equal(c[0].nom, "Taux d'épargne");
  assert.equal(c[0].action, "Épargne 200 € de plus par mois");
  assert.equal(c[2].action, "Compare les frais de tes fonds", "repli sur la piste");
  assert.equal(Math.round(100 - c.reduce((a, x) => a + x.points, 0)), r.total, "les pertes expliquent la note");
  const P2 = { coutsPrincipaux: () => [{ cle: "frais", points_perdus: 3, action: "Passe à un fonds indiciel" }, { cle: "matelas", pointsPerdus: 2 }, { cle: "adequation", points_perdus: 0 }] };
  assert.deepEqual(SV.coutsPrincipaux(r, P2).map(x => [x.cle, x.nom, x.points, x.action]),
    [["frais", "Critère frais", 3, "Passe à un fonds indiciel"], ["matelas", "Matelas de précaution", 2, "Porte ton matelas à 6 mois"]]);
  assert.deepEqual(SV.coutsPrincipaux(r, { coutsPrincipaux: () => { throw new Error("x"); } }).map(x => x.cle), ["epargne", "matelas", "frais"], "erreur : repli local");
  assert.deepEqual(SV.coutsPrincipaux(null), []);
});

test("enteteHtml : anneau accessible, synthèse, couverture, provisoire, date, « Ce qui te coûte le plus » cliquable", () => {
  const r = jeuEntete();
  const h = SV.enteteHtml(r, UIm, { date: new Date("2026-10-12T09:00:00"), P: null });
  assert.match(h, new RegExp(`<div class="st-anneau" role="img" aria-label="Note globale : ${r.total} sur 100, correct">`));
  assert.match(h, /<svg class="st-anneau-svg"[^>]*aria-hidden="true"/);
  assert.match(h, /id="santeVerdict" tabindex="-1"/);
  assert.match(h, /Calculée sur 4 critères sur 5/);
  assert.doesNotMatch(h, /provisoire/i, "80 % de couverture");
  assert.match(h, /données du 12 octobre 2026/);
  assert.match(h, /claude\.ai\/new\?q=/);
  assert.match(h, /<h3 class="st-h3" id="santeCoutsT">Ce qui te coûte le plus<\/h3>/);
  assert.deepEqual([...h.matchAll(/data-st-cout="([^"]+)"/g)].map(m => m[1]), ["epargne", "matelas", "frais"]);
  assert.match(h, /<button type="button" class="st-cout" data-ui-carte="epargne" data-st-cout="epargne" aria-haspopup="dialog">/);
  assert.match(h, /<span class="st-cout-nom">Taux d&#39;épargne<\/span>/);
  assert.match(h, /15 points de ta note globale/);
  assert.match(h, /7,5 points de ta note globale/);
  assert.doesNotMatch(h, /pts en jeu/);
  assert.match(h, /Épargne 200 € de plus par mois/);
  const p = SV.enteteHtml(R([N("a"), A("b"), A("c")]), UIm, { date: new Date("2026-10-12T09:00:00"), P: null });
  assert.match(p, /Calculée sur 1 critère sur 3/);
  assert.match(p, /<span class="ui-badge attention">provisoire<\/span>/);
  assert.match(p, /aria-label="Note globale : 90 sur 100, provisoire"/);
  const vert = SV.enteteHtml(R([N("a", { points: 20 })]), UIm, { P: null });
  assert.match(vert, /Rien ne te coûte de points/);
  const v = SV.enteteHtml(R([A("a")]), UIm, { P: null });
  assert.match(v, /aria-label="Note globale : pas encore calculée"/);
  assert.doesNotMatch(v, /data-st-cout|st-couts/);
  const x = SV.enteteHtml(R([N("a<", { points: 4, libelle: "<script>x</script>", ameliorer: [{ action: "<b>a</b>", gain_points: 2 }] })]), UIm, { P: null });
  assert.doesNotMatch(x, /<script>|<b>a/);
  assert.ok(SV.enteteHtml(null, UIm, {}).includes("Le score n&#39;est pas disponible"));
});

test("ongletsHtml : familles en onglets ARIA (note, couverture, critères), poids rappelés une seule fois", () => {
  const r = R([N("matelas", { points: 14, statut: "surveiller" }), A("protection"), N("liquidite", { points: 14, statut: "surveiller" }),
    N("epargne", { famille: "effort" }), N("frais", { famille: "efficacite", points: 6, statut: "travailler" })]);
  const h = SV.ongletsHtml(r, "effort", UIm);
  assert.match(h, /<div class="st-onglets" role="tablist" aria-label="Familles de critères">/);
  const tabs = [...h.matchAll(/<button type="button" role="tab"[^>]*>/g)].map(m => m[0]);
  assert.equal(tabs.length, 4);
  assert.match(tabs[1], /id="st-tab-effort" aria-controls="st-pan-effort" aria-selected="true" tabindex="0"/);
  assert.match(tabs[0], /aria-selected="false" tabindex="-1"/);
  const pans = [...h.matchAll(/<div role="tabpanel"[^>]*>/g)].map(m => m[0]);
  assert.equal(pans.length, 4);
  assert.match(pans[1], /class="st-fam" id="st-pan-effort" aria-labelledby="st-tab-effort" tabindex="0" data-st-fam="effort">$/);
  assert.match(pans[0], /hidden/);
  assert.match(h, /<span class="st-onglet-nom">Sécurité<\/span><span class="st-onglet-note num warn">70<span class="ui-sr"> sur 100<\/span><\/span>/);
  assert.match(h, /<span class="st-onglet-nom">Allocation<\/span><span class="st-onglet-note num na">—/);
  assert.match(h, /calculée sur 2 critères sur 3/);
  assert.equal((h.match(/note globale/g) || []).length, 1, "poids rappelés une seule fois");
  assert.match(h, /Poids de chaque famille dans la note globale : Sécurité 30\u00a0% · Effort 25\u00a0% · Allocation 30\u00a0% · Efficacité 15\u00a0%\./, "espaces insécables avant %");
  const sec = h.slice(h.indexOf('id="st-pan-securite"'), h.indexOf('id="st-pan-effort"'));
  assert.ok(sec.indexOf('data-st-critere="liquidite"') < sec.indexOf('data-st-critere="protection"'), "cartes à compléter après les critères notés");
  assert.match(h, /id="st-pan-allocation"[^>]*>[\s\S]*?Aucun critère pour le moment/);
  assert.match(SV.ongletsHtml(r, "zzz", UIm), /id="st-tab-securite" aria-controls="st-pan-securite" aria-selected="true"/, "famille inconnue : la première");
  assert.equal(SV.ongletsHtml(null, "x", UIm), "");
});

test("expertiseDe : l'expertise adaptée au critère (fournie par le critère si elle est connue)", () => {
  const ex = cle => SV.expertiseDe({ cle });
  for (const k of ["matelas", "epargne", "dormant", "liquidite_objectifs"]) assert.equal(ex(k), "budget-epargne", k);
  for (const k of ["endettement", "apport"]) assert.equal(ex(k), "immobilier-credit", k);
  for (const k of ["adequation", "concentration", "geographie", "speculatif", "devises"]) assert.equal(ex(k), "allocation-risque", k);
  assert.equal(ex("frais"), "etf-fonds");
  assert.equal(ex("enveloppes"), "fiscalite-enveloppes");
  assert.equal(SV.expertiseDe({ cle: "inconnu", famille: "efficacite" }), "etf-fonds");
  assert.equal(SV.expertiseDe({ cle: "x", expertise: "immobilier-credit" }), "immobilier-credit");
  assert.equal(SV.expertiseDe({ cle: "x", famille: "securite", expertise: "<script>" }), "budget-epargne", "slug inconnu ignoré");
});

test("panneauHtml : situation, pourquoi, calcul, données (liens vers les fiches), progresser, manque, Claude avec l'expertise", () => {
  const App = require("../web/src/app.js");
  const c = N("matelas", { statut: "surveiller", points: 14, manque: ["Le solde de ton compte joint"], confiance: "partielle",
    donnees: [{ libelle: "Livret A", valeur: "12 600 €", lien: { ligne: "l1" } }, { libelle: "Budget", valeur: "3 000 €", lien: "patrimoine/budget" }, { libelle: "Autre", valeur: 5, lien: "javascript:alert(1)" }] });
  const h = SV.panneauHtml(c, UIm);
  const titres = [...h.matchAll(/<h3 class="st-p-h">([^<]+)<\/h3>/g)].map(m => m[1]);
  assert.deepEqual(titres, ["Ta situation", "Pourquoi cette note", "Le calcul", "Données utilisées", "Pour progresser", "Ce qui manque", "Demander à Claude"]);
  assert.match(h, /<span class="st-p-mesure">4,2 mois de dépenses<\/span>/);
  assert.match(h, /14<span class="st-sur">\/20<\/span>/);
  assert.match(h, /<span class="ui-badge attention">à surveiller<\/span>/);
  assert.match(h, /<span class="st-jauge" role="img"/);
  assert.match(h, /Source : réel, juillet à septembre/);
  assert.match(h, /données partielles/);
  assert.match(h, /<p class="st-p-pourquoi">Ton matelas couvre plus de 3 mois de dépenses\.<\/p>/);
  assert.match(h, /Repère<\/b> 3 à 6 mois de dépenses/);
  assert.match(h, /<ol class="st-p-calcul"><li>Épargne disponible : 12 600 €<\/li><li>Dépenses réelles : 3 000 € par mois<\/li><li>12 600 ÷ 3 000 = 4,2 mois<\/li><\/ol>/);
  assert.ok(h.includes('href="#' + UIm.esc(App.lienCompte({ ligne: "l1" })) + '"'), "lien vers la fiche de Patrimoine › Comptes");
  assert.match(h, /href="#patrimoine\/budget"/);
  assert.doesNotMatch(h, /javascript:/, "lien non sûr ignoré");
  assert.match(h, /<span class="st-d-val num">5 €<\/span>/, "nombre formaté, en euros par défaut");
  assert.match(h, /Porte ton matelas à 6 mois \(≈ \+5 400 €\)<\/span><span class="st-gain num">\+2 pts<\/span>/);
  assert.match(h, /<li>Le solde de ton compte joint<\/li>/);
  const q = SV.questionClaude(SV.normaliser(c));
  assert.ok(q.startsWith(CP.phrase("expertise", "budget-epargne")), "expertise adaptée");
  assert.match(q, /« Critère matelas » est à 14\/20/);
  assert.ok(h.includes(UIm.esc(UIm.urlClaude(q))));
  assert.match(h, /expertise « Budget et épargne »/);
  // Données : unités, notes ; tableau par classe (adéquation) avant les étapes du calcul.
  const t = SV.panneauHtml(N("adequation", { famille: "allocation", donnees: [{ libelle: "Actions", valeur: 62.5, unite: "%" }, { libelle: "Héritage", valeur: 25000, note: "à recevoir, non compté" },
    { libelle: "Frais", valeur: 1234.5, unite: "€ par an" }, { libelle: "Protection", valeur: "oui" }],
    tableau: [{ groupe: "actions", libelle: "Actions", pct: 62, min: 40, max: 60, ecart: 2 }, { groupe: "oblig", libelle: "<b>Obligations</b>", pct: 20, min: 15, max: 30, ecart: 0 }] }), UIm);
  assert.match(t, /<span class="st-d-val num">62,5\u00a0%<\/span>/);
  assert.match(t, /Héritage<span class="st-d-note">à recevoir, non compté<\/span><\/span><span class="st-d-val num">25\u00a0000 €<\/span>/);
  assert.match(t, /1\u00a0235 € par an/);
  assert.match(t, /<span class="st-d-val num">oui<\/span>/);
  assert.match(t, /<table class="st-p-tab"><caption class="ui-sr">/);
  assert.match(t, /<th scope="row">Actions<\/th><td class="num">62\u00a0%<\/td><td class="num">40 à 60\u00a0%<\/td><td class="num hors">\+2 pts<\/td>/);
  assert.match(t, /dans la fourchette/);
  assert.doesNotMatch(t, /<b>Obligations/);
  assert.ok(t.indexOf("st-p-tab") < t.indexOf("st-p-calcul"), "tableau avant les étapes");
  // À compléter avec une mesure partielle (frais connus sur une partie des placements) : mesure affichée, sans jauge ni note.
  const fp = SV.panneauHtml(A("frais", { famille: "efficacite", mesure: { valeur: 0.6, unite: "% par an", texte: "coût partiel : 320 € par an" } }), UIm);
  assert.match(fp, /<span class="st-p-mesure">coût partiel : 320 € par an<\/span>/);
  assert.doesNotMatch(fp, /st-jauge/);
  // Ancien contrat : règle dans le calcul, piste pour progresser, points d'attention dans le pourquoi.
  const o = SV.panneauHtml(C("enveloppes", { points: 8, details: [{ statut: "probleme", texte: "PEA d'abord" }] }), UIm);
  assert.deepEqual([...o.matchAll(/<h3 class="st-p-h">([^<]+)<\/h3>/g)].map(m => m[1]), ["Ta situation", "Pourquoi cette note", "Le calcul", "Pour progresser", "Demander à Claude"]);
  assert.match(o, /<li class="probleme">PEA d&#39;abord<\/li>/);
  assert.match(o, /Règle enveloppes/);
  assert.match(o, /Piste enveloppes/);
  assert.match(o, /Source enveloppes/);
  assert.match(o, /Fiscalité et enveloppes/);
  // À compléter : pas de note, ce qui manque, « Compléter avec Claude » ciblé.
  const a = SV.panneauHtml(A("matelas", { lien: "patrimoine/budget", libelle: "Matelas" }), UIm);
  assert.deepEqual([...a.matchAll(/<h3 class="st-p-h">([^<]+)<\/h3>/g)].map(m => m[1]), ["Ta situation", "Pourquoi cette note", "Le calcul", "Ce qui manque", "Demander à Claude"]);
  assert.match(a, /Pas encore de note : il manque des données\./);
  assert.match(a, /<li>Tes dépenses mensuelles<\/li>/);
  assert.match(a, /Compléter avec Claude/);
  assert.ok(a.includes(UIm.esc(UIm.urlClaude(CP.phrase("budget", "le critère « Matelas » de mes bonnes pratiques")))));
  assert.doesNotMatch(a, /st-jauge|\/20/);
  // Échappement de tout texte venu des données.
  const x = SV.panneauHtml(N("x", { libelle: "<script>", pourquoi: "<b>p</b>", calcul: ["<i>c</i>"], donnees: [{ libelle: "<u>l</u>", valeur: "<s>v</s>" }],
    ameliorer: [{ action: "<em>a</em>", gain_points: "<x>" }], manque: ["<q>m</q>"], source_donnees: "<sd>", repere: { texte: "<r>", zones: ZONES_MATELAS } }), UIm);
  assert.doesNotMatch(x, /<script>|<b>p|<i>c|<u>l|<s>v|<em>a|<x>|<q>m|<sd>|<r>/);
});

test("lienPanneau : où agir seulement si utile", () => {
  assert.deepEqual(SV.lienPanneau(C("matelas", { aCompleter: true, lien: "patrimoine/budget" })), { label: "Voir le budget", href: "#patrimoine/budget" });
  assert.deepEqual(SV.lienPanneau(C("frais", { points: 8 })), { label: "Où agir : Patrimoine › Placements", href: "#patrimoine/placements" });
  assert.equal(SV.lienPanneau(C("frais", { points: 16 })), null, "critère au vert : pas de lien");
  assert.equal(SV.lienPanneau(C("devises", { informatif: true, points: null })), null);
  assert.equal(SV.lienPanneau(N("x", { lien: null, statut: "travailler", points: 2 })), null);
  assert.match(SV.questionPage(R([C("a")])), /est de 100\/100/);
  assert.match(SV.questionPage(null), /compléter mon bilan/);
  assert.equal(SV.phraseCompleter("protection", "x"), CP.phrase("protection", "x"));
});

test("liens profonds : #pilotage/sante?famille=<clé>&critere=<clé>, gardés dans l'URL", () => {
  assert.equal(SV.hashSante("effort", "epargne"), "#pilotage/sante?famille=effort&critere=epargne");
  assert.equal(SV.hashSante("effort"), "#pilotage/sante?famille=effort");
  assert.equal(SV.hashSante(null, null), "#pilotage/sante");
  assert.equal(SV.hashSante("a b", "x&y"), "#pilotage/sante?famille=a%20b&critere=x%26y");
  const App = require("../web/src/app.js");
  assert.ok(App.PARAMS_DANS_URL.includes("pilotage/sante"));
  assert.equal(App.hashCanonique({ space: "pilotage", sub: "sante" }, "famille=effort&critere=epargne"), "#pilotage/sante?famille=effort&critere=epargne");
  const h = App.resolveHash("#pilotage/sante?famille=effort&critere=epargne");
  assert.equal(h.legacy, false);
  assert.equal(h.query, "famille=effort&critere=epargne");
  const res = R([N("matelas"), N("epargne", { famille: "effort" })]);
  assert.deepEqual(SV.cibleLien(res, { critere: "epargne" }), { famille: "effort", critere: "epargne" });
  assert.deepEqual(SV.cibleLien(res, { famille: "securite", critere: "epargne" }), { famille: "effort", critere: "epargne" }, "la famille du critère prime");
  assert.deepEqual(SV.cibleLien(res, { famille: "allocation" }), { famille: "allocation", critere: null });
  assert.deepEqual(SV.cibleLien(res, { famille: "zzz", critere: "inconnu" }), { famille: null, critere: null });
  assert.deepEqual(SV.cibleLien(null, { famille: "effort" }), { famille: "effort", critere: null });
});

test("bonnes pratiques sur la démo : 4 familles, critères lisibles par la vue, liens vers des routes connues", () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const App = require("../web/src/app.js");
  const D = global.window.DEMO;
  const known = new Set(App.SPACES.flatMap(sp => sp.subs.map(s => sp.space + "/" + s.id)));
  for (const scope of ["foyer", "p1", "p2"]) {
    const r = P.evaluer({ positions: D.positions, profil: D.profil, config: D.config, budget: D.budget, objectifs: D.objectifs, scope, risque: D.risque, classes: D.classes, today: new Date("2026-10-09T12:00:00") });
    assert.equal(r.familles.length, 4);
    assert.ok(r.total >= 0 && r.total <= 100);
    for (const c of r.criteres) {
      const n = SV.normaliser(c);
      assert.ok(n.nom && SV.ETATS[n.statut], scope + " " + c.cle);
      if (n.statut === "a_completer") assert.equal(n.points, null);
      if (c.lien) { const x = App.resolve(c.lien); assert.ok(x && known.has(x.space + "/" + x.sub), "route inconnue : " + c.lien); }
      assert.ok(["budget", "objectifs", "revenus", "protection", "risque", "placements"].includes(SV.sectionDe(c)), c.cle);
      assert.ok(SV.carteHtml(c, UIm).length > 50 && SV.panneauHtml(c, UIm).includes("Ta situation"));
    }
    assert.ok(SV.verdict(r).phrase.length > 10);
    assert.ok(SV.ongletsHtml(r, "securite", UIm).includes('role="tablist"'));
  }
});

/* ------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------ */
const attendre = () => new Promise(r => setTimeout(r, 0));
function vueSante(S0, o = {}) {
  const dom = miniDom(), { doc } = dom;
  const modules = {}, urls = [];
  let params = o.params || null;
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, CSS: { escape: s => String(s).replace(/["\\]/g, "\\$&") } };
  ctx.window = ctx; ctx.self = ctx;
  ctx.location = { hash: o.hash || "#pilotage/sante" };
  ctx.history = { state: null, replaceState: (s, t, h) => { urls.push(h); ctx.location.hash = h; } };
  ctx.App = { register: (n, api) => { modules[n] = api; }, parametres: () => { const p = params || {}; params = null; return p; } };
  vm.createContext(ctx);
  for (const f of ["calc.js", "plan.js", "marche.js", "risque.js", "pratiques.js", "ui.js", "claude-prompts.js"]) vm.runInContext(read("web/src/" + f), ctx, { filename: f });
  vm.runInContext(js, ctx, { filename: "sante.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = html;
  const api = modules.sante;
  api.mount(root);
  if (!o.sansDonnees) api.update(S0, true);
  return { ctx, dom, doc, root, api, urls, lien: p => { params = p; } };
}
const demoS = () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const D = JSON.parse(JSON.stringify(global.window.DEMO));
  return { scope: "foyer", people: D.people || [], positions: D.positions, config: D.config, profil: D.profil, budget: D.budget, objectifs: D.objectifs, risque: D.risque, classes: D.classes };
};

test("vue (DOM) : en-tête, onglets (Sécurité ouvert), carte → panneau dans l'ordre, Échap rend le focus", async () => {
  const v = vueSante(demoS());
  const $ = id => v.root.querySelector("#" + id);
  assert.match($("santeTitle").textContent, /^Bonnes pratiques du foyer$/);
  assert.match($("santeEntete").innerHTML, /class="st-anneau" role="img" aria-label="Note globale : \d+ sur 100/);
  assert.match($("santeEntete").innerHTML, /claude\.ai\/new\?q=/);
  assert.ok($("santeVerdict").textContent.length > 10);
  const tabs = v.root.querySelectorAll('[role="tab"]'), pans = v.root.querySelectorAll('[role="tabpanel"]');
  assert.equal(tabs.length, 4);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.deepEqual(pans.map(p => p.hidden), [false, true, true, true]);
  const carte = pans[0].querySelector("[data-st-carte]");
  carte.focus(); carte.click();
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  assert.equal(dlg.hidden, false, "panneau ouvert");
  const t = dlg.querySelector(".ui-panneau-corps").textContent;
  assert.ok(t.indexOf("Ta situation") < t.indexOf("Pourquoi cette note") && t.indexOf("Pourquoi cette note") < t.indexOf("Demander à Claude"));
  assert.equal(v.urls[v.urls.length - 1], "#pilotage/sante?famille=securite&critere=" + carte.getAttribute("data-st-carte"), "URL du critère ouvert");
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true);
  assert.equal(v.doc.activeElement, carte, "focus rendu à la carte");
  assert.equal(v.urls[v.urls.length - 1], "#pilotage/sante?famille=securite");
  assert.match(v.api.headline(), /^\d+\/100$/);
  await attendre();
});

test("vue (DOM) : onglets au clic et au clavier (←/→, Début/Fin), URL mise à jour, pas de réécriture inutile", () => {
  const v = vueSante(demoS());
  const tabs = () => v.root.querySelectorAll('[role="tab"]'), pans = () => v.root.querySelectorAll('[role="tabpanel"]');
  tabs()[2].click();
  assert.equal(tabs()[2].getAttribute("aria-selected"), "true");
  assert.equal(tabs()[2].getAttribute("tabindex"), "0");
  assert.equal(tabs()[0].getAttribute("tabindex"), "-1");
  assert.deepEqual(pans().map(p => p.hidden), [true, true, false, true]);
  assert.equal(v.urls[v.urls.length - 1], "#pilotage/sante?famille=allocation");
  tabs()[2].focus();
  v.dom.touche(tabs()[2], "ArrowRight");
  assert.equal(v.doc.activeElement, tabs()[3]);
  assert.equal(tabs()[3].getAttribute("aria-selected"), "true");
  v.dom.touche(tabs()[3], "ArrowRight");
  assert.equal(v.doc.activeElement, tabs()[0], "retour au début");
  v.dom.touche(tabs()[0], "End");
  assert.equal(v.doc.activeElement, tabs()[3]);
  v.dom.touche(tabs()[3], "Home");
  assert.equal(v.doc.activeElement, tabs()[0]);
  assert.deepEqual(pans().map(p => p.hidden), [false, true, true, true]);
  // Le store réémet le même état : rien n'est réécrit (focus gardé sur l'onglet).
  const avant = tabs()[0];
  v.api.update(demoS(), true);
  assert.equal(tabs()[0], avant, "DOM conservé");
  assert.equal(v.doc.activeElement, avant);
  // Hors de Santé (URL d'une autre vue) : l'URL n'est pas touchée.
  v.ctx.location.hash = "#patrimoine/budget";
  const n = v.urls.length;
  tabs()[1].click();
  assert.equal(v.urls.length, n);
});

test("vue (DOM) : lien profond ?famille=&critere= → onglet et panneau ; « Ce qui te coûte le plus » ouvre le critère", () => {
  const v = vueSante(demoS());
  v.lien({ famille: "securite", critere: "epargne" });
  v.api.show();
  const tabs = v.root.querySelectorAll('[role="tab"]');
  assert.equal(v.root.querySelector("#st-tab-effort").getAttribute("aria-selected"), "true", "famille du critère");
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  assert.equal(dlg.hidden, false);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, v.root.querySelector('[data-st-critere="epargne"]').querySelector(".st-carte-nom").textContent);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.activeElement, v.root.querySelector('[data-st-carte="epargne"]'), "focus sur la carte du critère");
  assert.equal(tabs.length, 4);
  // Famille seule.
  v.lien({ famille: "efficacite" });
  v.api.show();
  assert.equal(v.root.querySelector("#st-tab-efficacite").getAttribute("aria-selected"), "true");
  assert.equal(dlg.hidden, true);
  // Lien profond arrivé avant les données : appliqué au premier rendu.
  const w = vueSante(demoS(), { params: { critere: "frais" }, sansDonnees: true });
  w.api.show();
  assert.equal(w.doc.body.querySelector('[role="dialog"]'), null, "rien à ouvrir sans données");
  w.api.update(demoS(), true);
  assert.equal(w.doc.body.querySelector('[role="dialog"]').hidden, false);
  assert.equal(w.root.querySelector("#st-tab-efficacite").getAttribute("aria-selected"), "true");
  // Ligne « Ce qui te coûte le plus ».
  const x = vueSante(demoS());
  const cout = x.root.querySelector("[data-st-cout]");
  if (cout) {
    cout.focus(); cout.click();
    assert.equal(x.doc.body.querySelector('[role="dialog"]').hidden, false);
    x.dom.touche(x.doc.activeElement, "Escape");
    assert.equal(x.doc.activeElement, cout);
  }
});

test("vue (DOM) : sans budget ni profil, cartes « à compléter » grises dans leur famille ; rafraîchi par le store, le focus revient à la carte du même critère", () => {
  const S0 = Object.assign(demoS(), { budget: null, profil: null, risque: null, config: null });
  const v = vueSante(S0);
  const na = v.root.querySelectorAll(".st-carte.na");
  assert.ok(na.length > 0, "cartes grises");
  assert.match(na[0].textContent, /Compléter avec Claude/);
  const c0 = na[0].querySelector("[data-st-carte]");
  const cle = c0.getAttribute("data-st-carte");
  c0.focus(); c0.click();
  assert.match(v.doc.body.querySelector(".ui-panneau-corps").innerHTML, /Compléter avec Claude/, "critère à compléter : Compléter avec Claude");
  v.api.update(Object.assign(demoS(), { budget: null, profil: null, risque: null, config: null, positions: demoS().positions.slice(1) }), true);
  v.dom.touche(v.doc.activeElement, "Escape");
  const c1 = v.root.querySelector('[data-st-carte="' + cle + '"]');
  assert.ok(c1);
  assert.equal(v.doc.activeElement, c1);
});

test("vue (DOM) : panneau ouvert rafraîchi par le store sans voler le focus ni rouvrir le panneau", () => {
  const v = vueSante(demoS());
  v.root.querySelector("#st-tab-allocation").click();
  const carte = v.root.querySelector('[data-st-carte="geographie"]');
  carte.focus(); carte.click();
  const corps = v.doc.body.querySelector(".ui-panneau-corps"), titre = v.doc.body.querySelector(".ui-panneau-titre");
  const lien = corps.querySelector(".ui-claude");
  lien.focus();
  const avant = corps.innerHTML, focusTitre = titre.focusCount;
  const S1 = demoS(); S1.positions = S1.positions.map((p, i) => i === 0 ? Object.assign({}, p, { qty: (p.qty || 1) * 1.1, valeur: (p.valeur || 0) * 1.1 }) : p);
  v.api.update(S1, true);
  assert.equal(v.doc.body.querySelector('[role="dialog"]').hidden, false);
  assert.notEqual(corps.innerHTML, avant, "corps réécrit");
  assert.equal(titre.focusCount, focusTitre, "le focus n'est pas remis sur le titre");
  assert.ok(corps.contains(v.doc.activeElement), "focus gardé dans le corps");
  assert.ok(v.doc.activeElement.classList.contains("ui-claude"), "même élément");
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.activeElement, v.root.querySelector('[data-st-carte="geographie"]'));
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
    // contrat cp4 : statut, provisoire, points perdus et barème rejoué identiques des deux côtés
    "points >= 16 ? \"bon\" : points >= 10 ? \"surveiller\" : \"travailler\"", "couverture < SEUIL_PROVISOIRE", "SEUIL_PROVISOIRE = 0.6",
    "(20 * complets.length) * 100)", "Math.max(0, Math.round(f(x)) - (points || 0))",
    "versementAlloue >= 1.1 * effort - EPS", "versementAlloue >= 0.95 * effort - EPS", // statut des objectifs
    "Math.max(0, (c - d * f) * r / (f - 1))",                          // effort mensuel (annuité)
    "Math.pow(1 + n(tauxAnnuel) / 100, 1 / 12) - 1",
  ];
  const norm = s => compact(s).replace(/\(i\)=>/g, "i=>").replace(/num\(/g, "n(").replace(/asnumber/g, "");
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

test("dateDonnees : date des données (dernière photo, dernière synchronisation bancaire), pas l'heure du calcul", () => {
  assert.equal(typeof SV.dateDonnees, "function");
  const S = { snapshots: [{ date: "2026-10-09" }, { date: "2026-10-11" }, { date: "2026-10-10" }],
    banque: { connexions: [{ derniereSynchro: "2026-10-12T05:31:00Z" }, { derniereSynchro: null }, { derniereSynchro: "2026-10-01T05:31:00Z" }] } };
  assert.equal(SV.dateDonnees(S), "2026-10-12");
  assert.equal(SV.dateDonnees({ snapshots: [{ date: "2026-10-11" }], banque: { connexions: [] } }), "2026-10-11");
  assert.equal(SV.dateDonnees({ snapshots: [], banque: null }), null);
  assert.equal(SV.dateDonnees(null), null);
  assert.equal(SV.dateDonnees({ snapshots: [{ date: "pas une date" }] }), null);
  const h = SV.enteteHtml(R([N("a"), N("b"), A("c")]), UIm, { date: "2026-10-11", P: null });
  assert.match(h, /données du 11 octobre 2026/);
  const js = readFileSync(new URL("../web/src/sante.js", import.meta.url), "utf8");
  assert.match(js, /dateDonnees\(snap\)/, "la vue passe la date des données à l'en-tête");
});
