// Compte › Règles (web/src/regles.*) : une carte par règle (bascule actif / inactif, résumé, panneau pour modifier),
// « Ajouter une règle », épargne de précaution en carte ; écritures config.rules / config.cushion via Store.db, extraites du Pilotage.
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
const pilotageHtml = read("web/src/pilotage.html"), pilotageJs = read("web/src/pilotage.js");
const RG = require("../web/src/regles.js");
const Rules = require("../web/src/rules.js");
const Calc = require("../web/src/calc.js");
const UIm = require("../web/src/ui.js");
const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const eur = v => nf.format(v) + " €";
const attendre = () => new Promise(r => setTimeout(r, 0));

const scopedSelectors = (src, prefix) => {
  const c = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s));
  return sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith(prefix));
};
const RULE_IDS = ["ruleForm", "rfType", "rfBloc", "rfPos", "rfEnv", "rfPct", "rfPrice", "rfCap", "rfDays", "rfBtn", "rfMsg"];
const CUSH_IDS = ["cushForm", "cuMode", "cuMin", "cuMax", "cuMonths", "cuDep", "cuBtn", "cuMsg"];
const demo = () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  return JSON.parse(JSON.stringify(global.window.DEMO));
};
const ctxDemo = D => ({ positions: D.positions, config: D.config, scope: "foyer", people: D.people || [], today: new Date().toISOString().slice(0, 10), status: D.status });

test("règles : s'enregistre et écrit config.rules / config.cushion via Store.db, à un seul endroit chacun", () => {
  const code = sansCommentaires(js);
  assert.match(js, /App\.register\("regles",api\)/);
  assert.match(js, /db:window\.Store\.db/);
  assert.equal((code.match(/S\.db\.doc\("config\/main"\)\.update\(\{rules\}\)/g) || []).length, 1, "ajout, modification, bascule et suppression passent par ecrireRegles");
  assert.equal((code.match(/ecrireRegles\(/g) || []).length, 4, "définition + ajout/modification + bascule + suppression");
  assert.equal((code.match(/S\.db\.doc\("config\/main"\)\.update\(\{cushion\}\)/g) || []).length, 1);
  assert.doesNotMatch(code, /\.set\(|\.delete\(/, "aucune autre écriture");
  assert.match(code, /R\.normalize\(raw\)/, "saisie validée par Rules.normalize");
  assert.match(code, /R\.describe\(r,ctx\)/);
  assert.match(js, /function headline\(\)\{ const n=rulesOf\(\)\.length; return n\?n\+" règle"\+\(n>1\?"s":""\):"Aucune règle"; \}/);
  assert.doesNotThrow(() => new vm.Script(js, { filename: "regles.js" }));
});

test("règles : formulaires dans les panneaux (plus dans la page) et plus dans le Bilan › Placements ; intro conservée", () => {
  const formRegle = RG.formRegleHtml({ type: "max_line_pct", choix: {} }, Rules);
  const res = RG.resumeMatelas({ cushion: { mode: "amount", min: 1, max: 2 } }, 0, Calc);
  const formMatelas = RG.matelasPanneauHtml({}, res, "");
  for (const id of RULE_IDS) {
    assert.match(formRegle, new RegExp(`id="${id}"`), id + " absent du formulaire de règle");
    assert.doesNotMatch(pilotageHtml, new RegExp(`id="${id}"`), id + " encore dans pilotage.html");
  }
  for (const id of CUSH_IDS) {
    assert.match(formMatelas, new RegExp(`id="${id}"`), id + " absent du formulaire du matelas");
    assert.doesNotMatch(pilotageHtml, new RegExp(`id="${id}"`), id + " encore dans pilotage.html");
  }
  for (const id of ["ruleList", "ruleCount", "rgAjouter", "rgMatelas", "rgClaude", "rgMsg"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.ok(html.includes("Ces règles alimentent vos alertes dans "), "phrase d'introduction");
  assert.match(html, /data-goto="aujourdhui\/vue"/);
  assert.ok(html.includes("Toujours actifs, sans réglage"), "contrôles intégrés rappelés");
  assert.doesNotMatch(pilotageJs, /config\/main"\)\.update\(\{(rules|cushion)\}\)/);
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

test("bascule et saisie : actif: false posé / retiré sans toucher aux autres règles ; modification qui garde l'état", () => {
  const L = [{ type: "max_line_pct", pct: 15 }, { type: "stale_prices", days: 4 }];
  const b = RG.basculerRegle(L, 1);
  assert.deepEqual(b[1], { type: "stale_prices", days: 4, actif: false });
  assert.equal(b[0], L[0], "les autres règles ne sont pas recopiées");
  assert.deepEqual(L[1], { type: "stale_prices", days: 4 }, "liste d'origine intacte");
  assert.deepEqual(RG.basculerRegle(b, 1)[1], { type: "stale_prices", days: 4 });
  assert.equal(RG.estActive({}), true);
  assert.equal(RG.estActive({ actif: false }), false);

  assert.deepEqual(RG.regleDepuisSaisie({ type: "max_line_pct", pct: "12" }, null, Rules), { rule: { type: "max_line_pct", pct: 12 } });
  assert.deepEqual(RG.regleDepuisSaisie({ type: "max_line_pct", pct: "" }, null, Rules), { error: "Indiquez un pourcentage positif." });
  assert.deepEqual(RG.regleDepuisSaisie({ type: "max_line_pct", pct: "20" }, { type: "max_line_pct", pct: 15, actif: false, note: "n" }, Rules),
    { rule: { actif: false, note: "n", type: "max_line_pct", pct: 20 } }, "état et clés propres conservés");
  assert.deepEqual(RG.regleDepuisSaisie({ type: "stale_prices", days: "3" }, { type: "max_line_pct", pct: 15 }, Rules),
    { rule: { type: "stale_prices", days: 3 } }, "changement de type : l'ancien seuil ne traîne pas");
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
});

test("rendus : carte échappée avec bascule role=switch hors du bouton d'ouverture ; 5 puis « Voir plus » ; état vide ; questions", () => {
  const res = { titre: "Plafond <b>", texte: "Poche <script>x</script> au plus", actif: false, etat: "Inactive : aucune alerte", ton: "off", alertes: [] };
  const h = RG.carteRegleHtml(res, 3);
  assert.doesNotMatch(h, /<script>|<b>/);
  assert.match(h, /role="switch" aria-checked="false" data-rg-bascule="3"/);
  assert.match(h, /data-rg-ouvrir="3" aria-haspopup="dialog"/);
  assert.match(h, /<\/button><button type="button" class="rg-switch"/, "deux boutons voisins, pas imbriqués");
  assert.match(h, /class="rg-regle off"/);
  const items = Array.from({ length: 7 }, (_, i) => ({ i, res: Object.assign({}, res, { actif: true }) }));
  const l = RG.listeHtml(items, UIm);
  assert.match(l, /Voir les autres règles \(2\)/);
  assert.equal((l.match(/<li class="rg-regle/g) || []).length, 7);
  assert.match(RG.listeHtml([], UIm), /Aucune règle pour l'instant/);
  const D = demo(), ctx = ctxDemo(D);
  assert.match(RG.questionPage(D.config.rules, ctx, Rules), /Aucune ligne au-dessus de 15 %/);
  assert.match(RG.questionPage([], ctx, Rules), /Quelles règles d'alerte/);
  assert.match(RG.questionRegle(res), /\(inactive\)/);
  const p = RG.reglePanneauHtml(Object.assign({}, res, { actif: true, ton: "warn", alertes: [{ level: "warn", title: "T<i>", text: "x" }] }), "<form></form>");
  assert.doesNotMatch(p, /<i>/);
  assert.match(p, /data-rg-suppr/);
});

test("formulaire de règle : seuls les champs du type sont visibles ; valeur courante gardée même hors des choix", () => {
  const f = RG.formRegleHtml({ type: "price_floor", regle: { type: "price_floor", position_id: "pos-x", price: 170 }, choix: { positions: [["a", "Action A"]] }, edition: true }, Rules);
  assert.match(f, /id="rfPosL">/, "ligne cotée visible");
  assert.match(f, /id="rfPriceL">/, "seuil visible");
  assert.match(f, /id="rfPctL" hidden>/);
  assert.match(f, /<option value="pos-x" selected>Ligne pos-x<\/option>/);
  assert.match(f, /<option value="price_floor" selected>/);
  assert.match(f, /value="170"/);
  assert.match(f, />Enregistrer les modifications</);
  const a = RG.formRegleHtml({ choix: {} }, Rules);
  assert.match(a, /<option value="" selected>Aucune poche<\/option>/, "liste vide : invite (Rules.normalize refusera la saisie)");
  assert.match(a, />Ajouter la règle</);
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
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, JSON, Math, Date };
  ctx.window = ctx; ctx.self = ctx;
  ctx.App = { register: (n, api) => { modules[n] = api; } };
  ctx.Store = { db: { doc: chemin => ({ update: async patch => { ecritures.push({ chemin, patch: JSON.parse(JSON.stringify(patch)) }); } }) } };
  vm.createContext(ctx);
  for (const f of ["calc.js", "rules.js", "ui.js"]) vm.runInContext(read("web/src/" + f), ctx, { filename: f });
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
  assert.match(v.$("rgMatelas").innerHTML, /data-ui-carte="matelas"/);
  const sw = v.root.querySelector('[data-rg-bascule="0"]');
  assert.equal(sw.getAttribute("aria-checked"), "true");
  sw.focus(); sw.click();
  await attendre(); await attendre();
  assert.equal(v.ecritures.length, 1);
  assert.equal(v.ecritures[0].chemin, "config/main");
  assert.deepEqual(v.ecritures[0].patch.rules[0], { type: "max_line_pct", pct: 15, actif: false });
  assert.deepEqual(v.ecritures[0].patch.rules.slice(1), D.config.rules.slice(1), "les autres règles inchangées");
  const sw2 = v.root.querySelector('[data-rg-bascule="0"]');
  assert.equal(sw2.getAttribute("aria-checked"), "false");
  assert.equal(v.doc.activeElement, sw2, "focus sur la bascule redessinée");
  assert.equal(v.$("ruleCount").textContent, "6 règles, dont 1 inactive");
  assert.match(v.$("rgMsg").textContent, /^Règle désactivée : Aucune ligne au-dessus de 15 %/);
});

test("vue (DOM) : la carte ouvre le panneau (état, alertes, formulaire) ; modification enregistrée en gardant actif: false ; Échap rend le focus", async () => {
  const D = demo(); D.config.rules[5].actif = false;
  const v = vue(etat(D));
  // la 6e règle est dans « Voir plus » : on déplie
  v.root.querySelector("[data-ui-voirplus]").click();
  const o = v.root.querySelector('[data-rg-ouvrir="5"]');
  o.focus(); o.click();
  assert.equal(v.dlg().hidden, false);
  assert.equal(v.dlg().querySelector(".ui-panneau-titre").textContent, "Cours trop anciens");
  assert.match(v.dlg().querySelector(".ui-panneau-corps").textContent, /Inactive : elle ne déclenche aucune alerte/);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(v.doc.activeElement, o, "Échap : focus rendu à la carte");
  o.click();
  const corps = v.dlg().querySelector(".ui-panneau-corps");
  corps.querySelector("#rfDays").value = "7";
  v.soumettre(corps.querySelector("#ruleForm"));
  await attendre(); await attendre();
  assert.equal(v.ecritures.length, 1);
  assert.deepEqual(v.ecritures[0].patch.rules[5], { actif: false, type: "stale_prices", days: 7 });
  assert.equal(v.dlg().hidden, true, "panneau fermé après l'enregistrement");
  assert.match(v.$("rgMsg").textContent, /^Règle modifiée : Cours de plus de 7 jours signalés/);
  assert.equal(v.doc.activeElement, v.root.querySelector('[data-rg-ouvrir="5"]'), "focus sur la carte modifiée, « Voir plus » resté déplié");
});

test("vue (DOM) : « Ajouter une règle » — erreur affichée dans le panneau, puis ajout ; suppression en deux temps", async () => {
  const D = demo(), v = vue(etat(D));
  v.$("rgAjouter").click();
  let corps = v.dlg().querySelector(".ui-panneau-corps");
  assert.equal(v.dlg().querySelector(".ui-panneau-titre").textContent, "Ajouter une règle");
  v.soumettre(corps.querySelector("#ruleForm"));
  await attendre();
  assert.equal(corps.querySelector("#rfMsg").textContent, "Indiquez un pourcentage positif.");
  assert.equal(v.ecritures.length, 0);
  const type = corps.querySelector("#rfType");
  type.value = "stale_prices"; v.dom.changer(type);
  assert.equal(corps.querySelector("#rfPctL").hidden, true);
  assert.equal(corps.querySelector("#rfDaysL").hidden, false);
  corps.querySelector("#rfDays").value = "10";
  v.soumettre(corps.querySelector("#ruleForm"));
  await attendre(); await attendre();
  assert.equal(v.ecritures.length, 1);
  assert.equal(v.ecritures[0].patch.rules.length, 7);
  assert.deepEqual(v.ecritures[0].patch.rules[6], { type: "stale_prices", days: 10 });
  assert.match(v.$("rgMsg").textContent, /^Règle ajoutée : /);
  assert.equal(v.doc.activeElement, v.root.querySelector('[data-rg-ouvrir="6"]'), "focus sur la nouvelle carte");

  v.root.querySelector('[data-rg-ouvrir="0"]').click();
  corps = v.dlg().querySelector(".ui-panneau-corps");
  const suppr = corps.querySelector("[data-rg-suppr]");
  suppr.click();
  assert.equal(v.ecritures.length, 1, "premier clic : confirmation demandée");
  assert.equal(suppr.textContent, "Confirmer la suppression");
  suppr.click();
  await attendre(); await attendre();
  assert.equal(v.ecritures.length, 2);
  assert.equal(v.ecritures[1].patch.rules.length, 6);
  assert.deepEqual(v.ecritures[1].patch.rules[0], D.config.rules[1]);
  assert.equal(v.$("rgMsg").textContent, "Règle supprimée.");
});

test("vue (DOM) : sans règle, état vide qui oriente ; matelas en carte → panneau avec bascule de mode, cible enregistrée", async () => {
  const D = demo(); D.config.rules = [];
  const v = vue(etat(D));
  assert.match(v.$("ruleList").textContent, /Aucune règle pour l'instant/);
  assert.equal(v.$("ruleCount").textContent, "");
  const carte = v.root.querySelector('[data-ui-carte="matelas"]');
  carte.focus(); carte.click();
  const corps = v.dlg().querySelector(".ui-panneau-corps");
  const radios = corps.querySelector("#cuMode").querySelectorAll('[role="radio"]');
  assert.deepEqual(radios.map(r => r.getAttribute("data-ui-id")), ["amount", "months"]);
  assert.equal(corps.querySelector("#cuMonthsL").hidden, true);
  v.dom.touche(radios[0], "ArrowRight");
  assert.equal(corps.querySelector("#cuMonthsL").hidden, false);
  assert.equal(corps.querySelector("#cuMinL").hidden, true);
  v.soumettre(corps.querySelector("#cushForm"));
  await attendre();
  assert.match(corps.querySelector("#cuMsg").textContent, /nombre de mois/);
  corps.querySelector("#cuMonths").value = "6";
  corps.querySelector("#cuDep").value = "2500";
  v.soumettre(corps.querySelector("#cushForm"));
  await attendre(); await attendre();
  assert.deepEqual(v.ecritures.at(-1).patch, { cushion: { mode: "months", months: 6, depenses: 2500 } });
  assert.equal(v.dlg().hidden, true);
  assert.equal(v.$("rgMsg").textContent, "Matelas enregistré.");
  assert.match(v.$("rgMatelas").textContent, /6 mois de dépenses/);
  assert.equal(v.doc.activeElement, v.root.querySelector('[data-ui-carte="matelas"]'));
});
