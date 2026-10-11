// Compte › Règles (web/src/regles.*) : lecture seule sauf la bascule actif / inactif (spec 2026-10-11-saisie-par-agent). Une carte
// par règle (bascule, résumé, panneau en lecture), épargne de précaution en carte ; « Régler avec Claude » à la place des formulaires ;
// seule écriture : config.rules (actif) via Store.db ; tutoiement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const read = rel => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");
const sansCommentaires = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const js = read("web/src/regles.js"), html = read("web/src/regles.html"), css = read("web/src/regles.css");
const RG = require("../web/src/regles.js");
const Rules = require("../web/src/rules.js");
const Calc = require("../web/src/calc.js");
const UIm = require("../web/src/ui.js");
const ClaudePrompts = require("../web/src/claude-prompts.js");
const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const eur = v => nf.format(v) + " €";
const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ").replace(/&#39;/g, "'");
const attendre = () => new Promise(r => setTimeout(r, 0));
/* Questions des liens « … avec Claude » (href décodé). */
const questions = h => [...String(h).matchAll(/href="https:\/\/claude\.ai\/new\?q=([^"]*)"/g)].map(m => sp(decodeURIComponent(m[1].replace(/&amp;/g, "&"))));
/* Tutoiement : aucun « vous / votre / vos ». Exception : textes du moteur des règles (rules.js) affichés dans le panneau. */
const EXCEPTIONS_MOTEUR = ["vérifiez votre ordre stop"];
const VOUVOIEMENT = /\b(vous|votre|vos)\b/i;
const sansExceptions = t => EXCEPTIONS_MOTEUR.reduce((a, e) => a.split(e).join(""), String(t));

const scopedSelectors = (src, prefix) => {
  const c = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s));
  return sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith(prefix));
};
const demo = () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  return JSON.parse(JSON.stringify(global.window.DEMO));
};
const ctxDemo = D => ({ positions: D.positions, config: D.config, scope: "foyer", people: D.people || [], today: new Date().toISOString().slice(0, 10), status: D.status });

test("règles : s'enregistre ; seule écriture = config.rules pour la bascule actif / inactif, à un seul endroit", () => {
  const code = sansCommentaires(js);
  assert.match(js, /App\.register\("regles",api\)/);
  assert.match(js, /db:window\.Store\.db/);
  assert.equal((code.match(/\.update\(/g) || []).length, 1, "une seule écriture");
  assert.equal((code.match(/S\.db\.doc\("config\/main"\)\.update\(\{rules\}\)/g) || []).length, 1);
  assert.equal((code.match(/ecrireRegles\(/g) || []).length, 2, "définition + bascule, rien d'autre");
  assert.match(code, /const rules=basculerRegle\(rulesOf\(\),i\)/, "la liste écrite vient de basculerRegle (seul actif change)");
  assert.doesNotMatch(code, /\.set\(|\.delete\(|\.upsert\(|cushion\}|update\(\{cushion/, "plus d'écriture du matelas ni d'autre écriture");
  assert.doesNotMatch(code, /R\.normalize|regleDepuisSaisie|formRegleHtml|brancherFormRegle|ouvrirAjout|data-rg-suppr/, "plus de saisie de règle");
  assert.match(code, /R\.describe\(r,ctx\)/);
  assert.match(js, /function headline\(\)\{ const n=rulesOf\(\)\.length; return n\?n\+" règle"\+\(n>1\?"s":""\):"Aucune règle"; \}/);
  assert.doesNotThrow(() => new vm.Script(js, { filename: "regles.js" }));
});

test("règles : plus de formulaire ni d'« Ajouter une règle » ; « Régler avec Claude » ; intro conservée", () => {
  for (const src of [sansCommentaires(js), html]) {
    assert.doesNotMatch(src, /<form|<input|<select|<textarea|<dialog/);
    assert.doesNotMatch(src, /Ajouter une règle|Ajouter la règle|Enregistrer les modifications|Enregistrer le matelas|Supprimer la règle|rgAjouter|ruleForm|cushForm|rfType|cuMode/);
  }
  for (const f of ["formRegleHtml", "regleDepuisSaisie", "questionPage", "questionRegle", "questionMatelas"]) assert.equal(RG[f], undefined, f);
  for (const id of ["ruleList", "ruleCount", "rgMatelas", "rgClaude", "rgMsg"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.ok(html.includes("Ces règles alimentent tes alertes dans "), "phrase d'introduction (tutoiement)");
  assert.match(html, /data-goto="aujourdhui\/vue"/);
  assert.ok(html.includes("Toujours actifs, sans réglage"), "contrôles intégrés rappelés");
  assert.match(js, /"Régler avec Claude"/);
  assert.match(js, /ClaudePrompts/);
  assert.doesNotMatch(css, /rg-form|rg-btn|rg-pmsg|rg-p-suppr/, "styles de saisie retirés");
});

test("« Régler avec Claude » : phrases de la section « regles » (page, règle, matelas)", () => {
  assert.equal(RG.phraseRegles(), ClaudePrompts.phrase("regles"));
  const res = { titre: "Plafond par ligne", texte: "Aucune ligne au-dessus de 15 % du patrimoine", actif: true };
  assert.equal(RG.phraseRegle(res), ClaudePrompts.phrase("regles", "la règle « Aucune ligne au-dessus de 15 % du patrimoine »"));
  assert.match(RG.phraseRegle(Object.assign({}, res, { actif: false })), /» \(inactive\)\./);
  const m = RG.resumeMatelas({ cushion: { mode: "amount", min: 15000, max: 20000 } }, 0, Calc);
  assert.match(sp(RG.phraseMatelas(m)), /Concerne : mon épargne de précaution \(cible : 15 000 € à 20 000 €\)\./);
  assert.match(RG.phraseMatelas(RG.resumeMatelas({}, 0, Calc)), /pas encore de cible/);
  for (const q of [RG.phraseRegles(), RG.phraseRegle(res), RG.phraseMatelas(m)]) assert.match(q, /^Boussole : aide-moi à régler mes règles d'alerte/);
});

test("résumé d'une règle : type, règle en français, alertes du moment ; inactive non évaluée", () => {
  const D = demo(), ctx = ctxDemo(D);
  const r0 = RG.resumeRegle(D.config.rules[0], ctx, Rules);
  assert.equal(r0.titre, "Plafond par ligne");
  assert.equal(r0.texte, "Aucune ligne au-dessus de 15 % du patrimoine");
  assert.equal(r0.actif, true);
  assert.ok(r0.alertes.length >= 1, "la démo déclenche chaque règle");
  assert.match(r0.etat, /^\d+ alertes? en ce moment$/);
  assert.equal(r0.ton, "warn");
  const off = RG.resumeRegle(Object.assign({}, D.config.rules[0], { actif: false }), ctx, Rules);
  assert.deepEqual([off.actif, off.alertes.length, off.etat, off.ton], [false, 0, "Inactive : aucune alerte", "off"]);
  const calme = RG.resumeRegle({ type: "max_line_pct", pct: 100 }, ctx, Rules);
  assert.deepEqual([calme.etat, calme.ton], ["Rien à signaler", "ok"]);
  const floor = RG.resumeRegle(D.config.rules[3], ctx, Rules);
  assert.equal(floor.titre, "Seuil de cours (ordre stop)");
  assert.equal(RG.compteRegles([]), "");
  assert.equal(RG.compteRegles([{}, { actif: false }, {}]), "3 règles, dont 1 inactive");
  assert.equal(RG.compteRegles([{}]), "1 règle");
});

test("bascule : actif: false posé / retiré sans toucher aux autres règles", () => {
  const L = [{ type: "max_line_pct", pct: 15 }, { type: "stale_prices", days: 4 }];
  const b = RG.basculerRegle(L, 1);
  assert.deepEqual(b[1], { type: "stale_prices", days: 4, actif: false });
  assert.equal(b[0], L[0], "les autres règles ne sont pas recopiées");
  assert.deepEqual(L[1], { type: "stale_prices", days: 4 }, "liste d'origine intacte");
  assert.deepEqual(RG.basculerRegle(b, 1)[1], { type: "stale_prices", days: 4 });
  assert.equal(RG.estActive({}), true);
  assert.equal(RG.estActive({ actif: false }), false);
});

test("épargne de précaution : cible, épargne disponible et badge (mêmes seuils que le contrôle intégré)", () => {
  const D = demo();
  const e = RG.epargneDisponible(D.positions, Calc);
  assert.ok(e > 0);
  const m = RG.resumeMatelas(D.config, e, Calc);
  assert.equal(m.valeur, eur(15000) + " à " + eur(20000));
  assert.equal(m.sous, eur(Math.round(e)) + " d'épargne disponible");
  const alerte = Rules.builtins(ctxDemo(D)).find(a => a.kind === "matelas");
  assert.equal(m.badge.texte, alerte ? (/sous/.test(alerte.title) ? "Sous la cible" : "Au-dessus de la cible") : "Dans la cible", "cohérent avec Rules.builtins");
  assert.deepEqual(RG.resumeMatelas({ cushion: { mode: "amount", min: 10000, max: 12000 } }, 5000, Calc).badge, { texte: "Sous la cible", ton: "attention" });
  assert.deepEqual(RG.resumeMatelas({ cushion: { mode: "amount", min: 10000, max: 12000 } }, 15000, Calc).badge, { texte: "Au-dessus de la cible", ton: "info" });
  assert.equal(RG.resumeMatelas({ cushion: { mode: "amount", min: 10000 } }, 15000, Calc).valeur, "Au moins " + eur(10000));
  const mois = RG.resumeMatelas({ cushion: { mode: "months", months: 6, depenses: 2500 } }, 16000, Calc);
  assert.deepEqual([mois.valeur, mois.sous, mois.badge.texte], ["6 mois de dépenses", "soit " + eur(15000) + " · " + eur(16000) + " d'épargne disponible", "Dans la cible"]);
  const rien = RG.resumeMatelas({}, 0, Calc);
  assert.deepEqual([rien.regle, rien.valeur], [false, "Non réglée"]);
  assert.match(rien.sous, /^Règle une cible avec Claude/);
});

test("rendus : carte échappée, bascule role=switch nommée « Règle : <texte> » (état dans aria-checked) ; 5 puis « Voir plus » à clé fixe ; état vide ; panneaux en lecture", () => {
  const res = { titre: "Plafond <b>", texte: "Poche <script>x</script> au plus", actif: false, etat: "Inactive : aucune alerte", ton: "off", alertes: [] };
  const h = RG.carteRegleHtml(res, 3);
  assert.doesNotMatch(h, /<script>|<b>/);
  assert.match(h, /role="switch" aria-checked="false" data-rg-bascule="3" aria-label="Règle : Poche &lt;script&gt;x&lt;\/script&gt; au plus"/);
  assert.doesNotMatch(h, /aria-label="Activer/, "le nom ne présume pas de l'action : l'état est dans aria-checked");
  assert.match(RG.carteRegleHtml(Object.assign({}, res, { actif: true, texte: "T" }), 0), /aria-checked="true" data-rg-bascule="0" aria-label="Règle : T"/);
  assert.match(h, /data-rg-ouvrir="3" aria-haspopup="dialog"/);
  assert.match(h, /<\/button><button type="button" class="rg-switch"/, "deux boutons voisins, pas imbriqués");
  assert.match(h, /class="rg-regle off"/);
  const items = Array.from({ length: 7 }, (_, i) => ({ i, res: Object.assign({}, res, { actif: true }) }));
  const l = RG.listeHtml(items, UIm);
  assert.match(l, /Voir les autres règles \(2\)/);
  assert.equal((l.match(/<li class="rg-regle/g) || []).length, 7);
  const id = l.match(/id="(ui-reste-[^"]+)"/)[1];
  const autres = Array.from({ length: 9 }, (_, i) => ({ i, res: Object.assign({}, res, { actif: i % 2 === 0, texte: "Autre " + i }) }));
  assert.equal(RG.listeHtml(autres, UIm).match(/id="(ui-reste-[^"]+)"/)[1], id, "clé fixe : même identifiant quelle que soit la liste");
  assert.match(RG.listeHtml([], UIm), /Aucune règle pour l'instant/);
  assert.match(RG.listeHtml([], UIm), /règle-les avec Claude/);
  const p = RG.reglePanneauHtml(Object.assign({}, res, { actif: true, ton: "warn", alertes: [{ level: "warn", title: "T<i>", text: "x" }] }));
  assert.doesNotMatch(p, /<i>/);
  assert.doesNotMatch(p, /<form|<input|data-rg-suppr/);
  assert.match(p, /règle-la avec Claude/);
  const m = RG.matelasPanneauHtml(RG.resumeMatelas({ cushion: { mode: "amount", min: 1, max: 2 } }, 0, Calc), "");
  assert.doesNotMatch(m, /<form|<input/);
  assert.match(m, /règle-la avec Claude/);
});

test("règles : tutoiement — aucun « vous / votre / vos » dans les textes du module et ses rendus (hors textes du moteur listés)", () => {
  assert.doesNotMatch(sansExceptions(js), VOUVOIEMENT);
  assert.doesNotMatch(sansExceptions(html), VOUVOIEMENT);
  const D = demo(), ctx = ctxDemo(D);
  const items = D.config.rules.map((r, i) => ({ i, res: RG.resumeRegle(r, ctx, Rules) }));
  assert.doesNotMatch(sansExceptions(RG.listeHtml(items, UIm)), VOUVOIEMENT);
  for (const x of items) assert.doesNotMatch(sansExceptions(RG.reglePanneauHtml(x.res)), VOUVOIEMENT);
  assert.doesNotMatch(RG.listeHtml([], UIm) + RG.matelasPanneauHtml(RG.resumeMatelas({}, 0, Calc), ""), VOUVOIEMENT);
  assert.doesNotMatch(RG.resumeMatelas({}, 0, Calc).sous, /Fixez/);
});

test("règles : CSS entièrement scopé sous #view-regles (et .ui-panneau .rg-… pour le panneau)", () => {
  const hors = scopedSelectors(css, "#view-regles");
  assert.deepEqual(hors.filter(x => !x.startsWith(".ui-panneau .rg-")), []);
  assert.ok(hors.length > 0, "styles du panneau présents");
});

/* ------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------ */
function vue(S0) {
  const dom = miniDom(), { doc } = dom;
  const modules = {}, ecritures = [];
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, JSON, Math, Date, encodeURIComponent };
  ctx.window = ctx; ctx.self = ctx;
  ctx.App = { register: (n, api) => { modules[n] = api; } };
  ctx.Store = { db: { doc: chemin => ({ update: async patch => { ecritures.push({ chemin, patch: JSON.parse(JSON.stringify(patch)) }); },
    set: async d => { ecritures.push({ chemin, set: d }); }, delete: async () => { ecritures.push({ chemin, delete: true }); } }) } };
  vm.createContext(ctx);
  for (const f of ["calc.js", "rules.js", "ui.js", "claude-prompts.js"]) vm.runInContext(read("web/src/" + f), ctx, { filename: f });
  vm.runInContext(js, ctx, { filename: "regles.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = html;
  const api = modules.regles;
  api.mount(root);
  api.update(S0, true);
  const dlg = () => doc.body.querySelector('[role="dialog"]');
  const soumettre = form => form.dispatchEvent(new dom.Ev("submit"));
  return { dom, doc, root, api, ecritures, dlg, soumettre, $: id => root.querySelector("#" + id) };
}
const etat = D => ({ scope: "foyer", people: D.people || [], positions: D.positions, config: D.config, status: D.status });

test("vue (DOM) : une carte par règle (5 puis « Voir plus »), bascule → actif: false écrit, focus gardé sur la bascule", async () => {
  const D = demo(), v = vue(etat(D));
  assert.equal(v.$("ruleCount").textContent, "6 règles");
  assert.equal(v.root.querySelectorAll(".rg-regle").length, 6);
  assert.match(v.$("ruleList").innerHTML, /Voir les autres règles \(1\)/);
  assert.match(v.$("rgClaude").innerHTML, /claude\.ai\/new\?q=/);
  assert.match(v.$("rgClaude").innerHTML, /Régler avec Claude/);
  assert.deepEqual(questions(v.$("rgClaude").innerHTML), [sp(ClaudePrompts.phrase("regles"))]);
  assert.match(v.$("rgMatelas").innerHTML, /data-ui-carte="matelas"/);
  const sw = v.root.querySelector('[data-rg-bascule="0"]');
  assert.equal(sw.getAttribute("aria-checked"), "true");
  sw.focus(); sw.click();
  await attendre(); await attendre();
  assert.equal(v.ecritures.length, 1);
  assert.equal(v.ecritures[0].chemin, "config/main");
  assert.deepEqual(Object.keys(v.ecritures[0].patch), ["rules"], "seule la liste des règles est écrite");
  assert.deepEqual(v.ecritures[0].patch.rules[0], { type: "max_line_pct", pct: 15, actif: false });
  assert.deepEqual(v.ecritures[0].patch.rules.slice(1), D.config.rules.slice(1), "les autres règles inchangées");
  const sw2 = v.root.querySelector('[data-rg-bascule="0"]');
  assert.equal(sw2.getAttribute("aria-checked"), "false");
  assert.equal(v.doc.activeElement, sw2, "focus sur la bascule redessinée");
  assert.equal(v.$("ruleCount").textContent, "6 règles, dont 1 inactive");
  assert.match(v.$("rgMsg").textContent, /^Règle désactivée : Aucune ligne au-dessus de 15 %/);
  // réactivation : actif retiré, la règle redevient identique à l'origine
  sw2.click();
  await attendre(); await attendre();
  assert.deepEqual(v.ecritures[1].patch.rules, D.config.rules);
  assert.equal(v.$("ruleCount").textContent, "6 règles");
});

test("vue (DOM) : la carte ouvre un panneau en lecture (état, alertes, « Régler avec Claude ») ; Échap rend le focus ; aucune écriture", async () => {
  const D = demo(); D.config.rules[5].actif = false;
  const v = vue(etat(D));
  // la 6e règle est dans « Voir plus » : on déplie
  v.root.querySelector("[data-ui-voirplus]").click();
  const o = v.root.querySelector('[data-rg-ouvrir="5"]');
  o.focus(); o.click();
  assert.equal(v.dlg().hidden, false);
  assert.equal(v.dlg().querySelector(".ui-panneau-titre").textContent, "Cours trop anciens");
  const corps = v.dlg().querySelector(".ui-panneau-corps");
  assert.match(corps.textContent, /Inactive : elle ne déclenche aucune alerte\. Réactive-la/);
  assert.equal(corps.querySelectorAll("form,input,select,textarea,button").length, 0, "panneau en lecture");
  const pied = v.dlg().querySelector(".ui-panneau-pied");
  assert.match(pied.innerHTML, /Régler avec Claude/);
  assert.match(questions(pied.innerHTML)[0], /Concerne : la règle « Cours de plus de \d+ jours signalés.* » \(inactive\)\./);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.activeElement, o, "Échap : focus rendu à la carte");
  assert.deepEqual(v.ecritures, []);
  // « Voir plus » reste déplié après une émission du store (clé fixe)
  v.api.update(etat(Object.assign(demo(), { config: Object.assign(demo().config, { rules: D.config.rules.slice().reverse() }) })), true);
  assert.equal(v.root.querySelector("[data-ui-voirplus]").getAttribute("aria-expanded"), "true");
});

test("vue (DOM) : sans règle, état vide qui oriente vers Claude ; matelas en carte → panneau en lecture avec « Régler avec Claude »", () => {
  const D = demo(); D.config.rules = [];
  const v = vue(etat(D));
  assert.match(v.$("ruleList").textContent, /Aucune règle pour l'instant/);
  assert.equal(v.$("ruleCount").textContent, "");
  const carte = v.root.querySelector('[data-ui-carte="matelas"]');
  carte.focus(); carte.click();
  const corps = v.dlg().querySelector(".ui-panneau-corps");
  assert.equal(v.dlg().querySelector(".ui-panneau-titre").textContent, "Épargne de précaution");
  assert.equal(corps.querySelectorAll("form,input,select,textarea,button,[role=radio]").length, 0, "plus de réglage dans l'app");
  assert.match(sp(corps.textContent), new RegExp(sp(eur(15000)) + " à " + sp(eur(20000))));
  assert.match(v.dlg().querySelector(".ui-panneau-pied").innerHTML, /Régler avec Claude/);
  assert.match(questions(v.dlg().querySelector(".ui-panneau-pied").innerHTML)[0], /épargne de précaution \(cible : /);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.activeElement, carte);
  assert.deepEqual(v.ecritures, []);
  assert.doesNotMatch(sp(v.root.textContent), VOUVOIEMENT);
});
