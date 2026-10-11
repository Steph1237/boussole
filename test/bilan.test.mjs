// Patrimoine › Immobilier et crédits (module bilan, web/src/bilan.*) : contrôles statiques, fonctions pures sur la démo et sur des
// cas construits, puis la vue dans un mini-DOM (cartes → panneau, liens vers Compte › Données, états vide et chargement).
// Les calculs de BilanCalc (composition, évolution…) sont testés dans test/bilan-calc.test.mjs et test/aujourdhui.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/bilan.js", "utf8");
const css = readFileSync("web/src/bilan.css", "utf8");
const html = readFileSync("web/src/bilan.html", "utf8");
const B = require("../web/src/bilan.js");
const Calc = require("../web/src/calc.js");
const Plan = require("../web/src/plan.js");
const UI = require("../web/src/ui.js");
const DEMO = require("../web/src/demo-data.js");
const DEPS = { Calc, Plan };
const clone = o => JSON.parse(JSON.stringify(o));
const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ").replace(/&#39;/g, "'");
const PIEGE = '<img src=x onerror="alert(1)">';

/* ------------------------------------------------------------ statique ------------------------------------------------------------ */
test("bilan.js : se compile, s'enregistre sous « bilan », exporte ses fonctions pures", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "bilan.js" }));
  assert.match(js, /App\.register\("bilan", api\)/);
  assert.match(js, /__pending/);
  assert.match(js, /const api = \{ mount, update, show, headline \}/);
  for (const f of ["analyser", "verdict", "tuilesHtml", "carteBienHtml", "carteCreditHtml", "detailBienHtml", "detailCreditHtml", "lienModifier", "videHtml", "headlineDe"])
    assert.equal(typeof B[f], "function", f);
});

test("bilan : l'ancienne vue d'ensemble a disparu (carte Claude, composition, flux, allocation, évolution, à traiter)", () => {
  for (const id of ["blClaude", "blComp", "blFlux", "blAlloc", "blChart", "blEvoPer", "blTodo", "blSante", "blMatelas"]) assert.doesNotMatch(html + js, new RegExp('"' + id), id);
  for (const f of ["BilanEtat", "BilanCalc", "Rules.evaluate", "window.Actions", "sessionStorage", "localStorage"]) assert.ok(!js.includes(f), f);
  assert.match(html, /Qu'est-ce que je possède en immobilier et que dois-je \?/);
  assert.match(html, /<details class="ui-acc bl-how">/, "méthode en accordéon fermé");
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
});

test("bilan : « Ajouter » mène à Compte › Données, section dépliée ; toutes les routes sont connues", () => {
  assert.match(html, /href="#compte\/donnees\?section=biens" data-goto="compte\/donnees\?section=biens">Ajouter un bien</);
  assert.match(html, /href="#compte\/donnees\?section=credits" data-goto="compte\/donnees\?section=credits">Ajouter un crédit</);
  const { resolve, SPACES } = require("../web/src/app.js");
  const known = new Set(SPACES.flatMap(s => s.subs.map(x => s.space + "/" + x.id)));
  const routes = new Set([...(js + html).matchAll(/data-goto="([a-z]+\/[a-z-]+)(?:\?section=[a-z]+)?"/g)].map(m => m[1]));
  for (const r of ["compte/donnees", "pilotage/rang"]) assert.ok(routes.has(r), r);
  for (const r of routes) { const x = resolve(r); assert.ok(x && known.has(x.space + "/" + x.sub), r); }
  assert.deepEqual(B.lienModifier("bien"), { label: "Modifier dans Compte › Données", href: "#compte/donnees?section=biens" });
  assert.equal(B.lienModifier("pret").href, "#compte/donnees?section=biens", "le prêt se saisit avec son bien");
  assert.equal(B.lienModifier("credit").href, "#compte/donnees?section=credits");
});

test("bilan.js : aucune requête DOM globale hors racine du module ; identifiants présents dans le HTML", () => {
  assert.deepEqual(js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l)), []);
  const ids = [...new Set([...js.matchAll(/\$\("([A-Za-z0-9_-]+)"\)/g)].map(m => m[1]))];
  assert.ok(ids.length >= 6);
  assert.deepEqual(ids.filter(id => !html.includes('id="' + id + '"')), []);
  for (const [, id] of js.matchAll(/ecrire(?:Cartes)?\("([A-Za-z]+)"/g)) assert.ok(html.includes('id="' + id + '"'), id);
});

test("bilan.css : entièrement scopé sous #view-bilan (et .ui-panneau .bl-… pour le panneau), @media après une règle fermée", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.deepEqual([...c.matchAll(/@media/g)].filter(m => !/(^|\})\s*$/.test(c.slice(0, m.index))).map(m => m.index), []);
  const plat = c.replace(/@media[^{]*\{/g, "}");
  const sels = [...plat.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean).flatMap(s => s.split(",").map(x => x.trim()));
  assert.ok(sels.length > 30);
  assert.deepEqual(sels.filter(x => !x.startsWith("#view-bilan") && !x.startsWith(".ui-panneau .bl-")), []);
  assert.ok(sels.some(x => x.startsWith(".ui-panneau .bl-")), "styles du panneau présents");
});

/* ------------------------------------------------------------ fonctions pures ------------------------------------------------------------ */
const S0 = (o = {}) => Object.assign({ scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], profil: clone(DEMO.profil), budget: clone(DEMO.budget) }, o);

test("analyser (démo, foyer) : totaux de Calc, un bien, prêt du bien puis prêt auto, taux = mensualités ÷ revenus de Plan.budgetTotaux", () => {
  const a = B.analyser(S0(), DEPS);
  assert.equal(a.immobilier, Calc.immobilier(DEMO.profil, "foyer"));
  assert.equal(a.dettes, Calc.dettes(DEMO.profil, "foyer"));
  assert.equal(a.mensualites, Calc.mensualites(DEMO.profil, "foyer"));
  assert.equal(a.immobilier, 240000); assert.equal(a.dettes, 156500); assert.equal(a.mensualites, 1030);
  const t = Plan.budgetTotaux(DEMO.budget.lignes, DEMO.profil, "foyer");
  assert.ok(Math.abs(a.taux - t.mensualites / t.revenus) < 1e-12, "même taux que le critère « endettement » de Pilotage › Santé");
  assert.equal(a.biens.length, 1);
  assert.deepEqual([a.biens[0].key, a.biens[0].usageLabel, a.biens[0].valeur, a.biens[0].crd, a.biens[0].net, a.biens[0].poids], ["bien:bien-rp", "Résidence principale", 240000, 150000, 90000, 1]);
  assert.deepEqual(a.credits.map(c => [c.key, c.kind, c.crd, c.mensualite]), [["pret:bien-rp", "pret", 150000, 820], ["credit:credit-auto", "credit", 6500, 210]]);
  assert.equal(a.credits[1].titulaire, "Commun");
  assert.equal(a.vide, false); assert.equal(a.renseigne, true); assert.equal(a.deuxAdultes, true);
  assert.equal(a.duScope, "du foyer");
});

test("analyser : périmètre — quote-part du bien et de son prêt, crédit commun pour moitié, bien d'une autre personne écarté", () => {
  const p1 = B.analyser(S0({ scope: "p1" }), DEPS);
  assert.equal(p1.biens[0].valeur, 120000);
  assert.equal(p1.credits[0].crd, 75000);
  assert.equal(p1.credits[1].crd, 3250);
  assert.equal(p1.dettes, Calc.dettes(DEMO.profil, "p1"));
  assert.equal(p1.duScope, "de Camille");
  const pr = clone(DEMO.profil);
  pr.biens[0].part_p1 = 100;
  pr.credits[0].owner = "p1";
  const p2 = B.analyser(S0({ scope: "p2", profil: pr }), DEPS);
  assert.equal(p2.biens.length, 0, "bien à 100 % pour Camille : rien pour Sam");
  assert.equal(p2.credits.length, 0);
  assert.equal(p2.vide, true);
  assert.equal(p2.renseigne, true);
});

test("analyser : sans profil, sans revenus, identifiants absents, valeurs négatives ramenées à 0", () => {
  const rien = B.analyser({ scope: "foyer", profil: null }, DEPS);
  assert.equal(rien.vide, true); assert.equal(rien.renseigne, false); assert.equal(rien.taux, null);
  const pr = { foyer: { adultes: 1 }, biens: [{ nom: "Studio", usage: "locatif", valeur: 100000, part_p1: 100, crd: -5, mensualite: 400, loyer: 550 }], credits: [{ nom: "Conso", owner: "p1", crd: 2000, mensualite: 90 }] };
  const a = B.analyser({ scope: "foyer", profil: pr }, DEPS);
  assert.equal(a.taux, a.mensualites / a.revenus, "loyers comptés dans les revenus");
  assert.equal(a.biens[0].key, "bien:i0");
  assert.equal(a.biens[0].crd, 0);
  assert.equal(a.credits[0].key, "pret:i0", "mensualité sans reste dû : le prêt apparaît quand même");
  assert.equal(a.credits[1].titulaire, "Personne 1");
  assert.equal(a.loyers, 550);
  const sansRev = B.analyser({ scope: "foyer", profil: { biens: [], credits: [{ nom: "Auto", owner: "commun", crd: 1000, mensualite: 100 }] } }, DEPS);
  assert.equal(sansRev.taux, null);
});

test("verdict : une phrase (immobilier, reste dû, poids des mensualités), tons bon / critique, vide orienté agent", () => {
  const v = B.verdict(B.analyser(S0(), DEPS));
  assert.equal(v.ton, "bon");
  assert.match(sp(v.phrase), /^Immobilier et crédits du foyer : 240 000 € d'immobilier, 156 500 € restant à rembourser\. Vos mensualités pèsent \d+ % de vos revenus, sous le plafond de 35 % des banques\.$/);
  const pr = clone(DEMO.profil); pr.biens[0].mensualite = 3000;
  assert.equal(B.verdict(B.analyser(S0({ profil: pr }), DEPS)).ton, "critique");
  assert.match(B.verdict(B.analyser({ scope: "foyer", profil: null }, DEPS)).phrase, /dites à Claude si vous êtes propriétaire ou si vous avez des crédits/);
  assert.match(B.verdict(B.analyser({ scope: "foyer", profil: { biens: [], credits: [] } }, DEPS)).phrase, /^Aucun bien immobilier ni crédit enregistré du foyer\.$/);
  assert.match(B.verdict(B.analyser({ scope: "foyer", profil: { biens: [], credits: [{ nom: "Auto", crd: 1000, mensualite: 100 }] } }, DEPS)).phrase, /Renseignez vos revenus/);
});

test("tuilesHtml : immobilier, reste à rembourser, mensualités, taux d'endettement avec lien vers Pilotage › Rang (ou vers les revenus)", () => {
  const h = sp(B.tuilesHtml(B.analyser(S0(), DEPS)));
  for (const id of ["immobilier", "dettes", "mensualites", "taux"]) assert.match(h, new RegExp('data-bl-tuile="' + id + '"'));
  assert.match(h, /240 000 €/); assert.match(h, /156 500 €/); assert.match(h, /1 030 €\/mois/);
  assert.match(h, /href="#pilotage\/rang" data-goto="pilotage\/rang">Ma capacité d'emprunt</);
  assert.match(h, /bl-tuile bon/);
  const sans = B.tuilesHtml(B.analyser({ scope: "foyer", profil: { biens: [], credits: [{ nom: "Auto", crd: 1000, mensualite: 100 }] } }, DEPS));
  assert.match(sans, /data-goto="compte\/donnees\?section=revenus"/);
});

test("cartes et panneaux : texte échappé, prêt rattaché au bien, répartition au foyer, part dans le périmètre", () => {
  const pr = { foyer: { adultes: 2 }, biens: [{ id: PIEGE, nom: PIEGE, usage: "locatif", valeur: 200000, part_p1: 70, crd: 250000, mensualite: 900, loyer: 1000 }],
    credits: [{ id: "c<1>", nom: PIEGE, owner: "p2", crd: 3000, mensualite: 100 }] };
  const S = { scope: "foyer", profil: pr, people: [{ id: "p1", nom: "<b>A</b>" }, { id: "p2", nom: PIEGE }] };
  const a = B.analyser(S, DEPS);
  const tout = a.biens.map(B.carteBienHtml).concat(a.credits.map(B.carteCreditHtml)).join("") +
    B.detailBienHtml(a.biens[0], { scope: "foyer", nomP1: "<b>A</b>", nomP2: PIEGE, deuxAdultes: true }) + a.credits.map(c => B.detailCreditHtml(c, { scope: "foyer" })).join("");
  assert.doesNotMatch(tout, /<img|<b>/);
  assert.match(tout, /data-ui-carte="bien:&lt;img/);
  const cb = sp(B.carteBienHtml(a.biens[0]));
  assert.match(cb, /<span class="ui-carte-titre">Locatif<\/span><span class="ui-badge attention">À vérifier<\/span>/, "reste dû au-delà de la valeur");
  assert.match(cb, /100 % de l'immobilier/); assert.match(cb, /loyer 1 000 €\/mois/);
  const db = sp(B.detailBienHtml(a.biens[0], { scope: "foyer", nomP1: "Camille", nomP2: "Sam", deuxAdultes: true }));
  assert.match(db, /<dt>Répartition<\/dt><dd>Camille 70 % · Sam 30 %<\/dd>/);
  assert.match(db, /<dt>Loyer moins mensualité<\/dt><dd>\+100 €\/mois<\/dd>/);
  assert.match(db, /bl-d-alerte/);
  const p1 = B.analyser(Object.assign({}, S, { scope: "p1" }), DEPS);
  assert.match(sp(B.detailBienHtml(p1.biens[0], { scope: "p1" })), /<dt>Votre part<\/dt><dd>70 % de 200 000 €<\/dd>/);
  const pret = sp(B.detailCreditHtml(a.credits[0], { scope: "foyer" }));
  assert.match(pret, /<dt>Type<\/dt><dd>Prêt immobilier<\/dd><dt>Bien financé<\/dt>/);
  assert.match(B.carteCreditHtml(a.credits[1]), /Crédit · &lt;img/);
  assert.match(B.questionBien(a.biens[0]), /^Dans Boussole, mon bien « /);
  assert.doesNotMatch(B.questionBien(a.biens[0]) + B.questionCredit(a.credits[0]) + B.questionPage(a), /[\u00a0\u202f]/, "questions en espaces simples");
});

test("videHtml et headlineDe : « Dites à Claude… » puis « Ajouter à la main » ; chiffre clé = immobilier, sinon reste dû", () => {
  const v = B.videHtml(B.analyser({ scope: "foyer", profil: null }, DEPS), UI);
  assert.match(v, /Dites à Claude si vous êtes propriétaire ou si vous avez des crédits/);
  assert.match(v, /claude\.ai\/new\?q=/);
  assert.match(v, />Le dire à Claude</);
  assert.match(v, /href="#compte\/donnees\?section=biens" data-goto="compte\/donnees\?section=biens">Ajouter à la main</);
  assert.match(sp(B.videHtml(B.analyser({ scope: "foyer", profil: { biens: [], credits: [] } }, DEPS), UI)), /Vous n'avez déclaré ni bien immobilier ni crédit\./);
  assert.equal(sp(B.headlineDe(B.analyser(S0(), DEPS))), "240 k€");
  assert.equal(sp(B.headlineDe(B.analyser({ scope: "foyer", profil: { credits: [{ nom: "Auto", crd: 6500, mensualite: 100 }] } }, DEPS))), "7 k€ dus");
  assert.equal(B.headlineDe(B.analyser({ scope: "foyer", profil: null }, DEPS)), "–");
});

/* ------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------ */
function vueBilan(snap) {
  const dom = miniDom(), { doc } = dom;
  const modules = {};
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, CSS: { escape: s => String(s).replace(/["\\]/g, "\\$&") } };
  ctx.window = ctx; ctx.self = ctx;
  ctx.App = { register: (n, api) => { modules[n] = api; } };
  vm.createContext(ctx);
  for (const f of ["calc.js", "plan.js", "ui.js"]) vm.runInContext(readFileSync("web/src/" + f, "utf8"), ctx, { filename: f });
  vm.runInContext(js, ctx, { filename: "bilan.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.setAttribute("id", "view-bilan");
  root.innerHTML = html;
  const api = modules.bilan;
  api.mount(root);
  api.update(snap, true);
  return { dom, doc, root, api, $: id => root.querySelector("#" + id) };
}
const demoSnap = (o = {}) => Object.assign({ ready: true, dbOk: true, scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }],
  positions: clone(DEMO.positions), profil: clone(DEMO.profil), budget: clone(DEMO.budget) }, o);

test("vue (DOM) : verdict, tuiles, cartes des biens et des crédits ; carte → panneau (Modifier → Compte › Données, Claude), Échap rend le focus", () => {
  const v = vueBilan(demoSnap());
  assert.equal(v.$("blEtat").hidden, true);
  assert.equal(v.$("blCorps").hidden, false);
  assert.match(sp(v.$("blVerdict").textContent), /^Immobilier et crédits du foyer : 240 000 €/);
  assert.match(v.$("blDemander").innerHTML, /claude\.ai\/new\?q=/);
  assert.equal(v.$("blTuiles").querySelectorAll("[data-bl-tuile]").length, 4);
  assert.equal(v.$("blBiens").querySelectorAll("[data-ui-carte]").length, 1);
  assert.equal(v.$("blCredits").querySelectorAll("[data-ui-carte]").length, 2);
  assert.equal(v.$("blVide").hidden, true);
  const carte = v.$("blBiens").querySelector('[data-ui-carte="bien:bien-rp"]');
  carte.focus(); carte.click();
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  assert.equal(dlg.hidden, false);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Appartement (résidence principale)");
  assert.match(sp(dlg.querySelector(".ui-panneau-corps").textContent), /Reste à rembourser150 000 €/);
  const pied = dlg.querySelector(".ui-panneau-pied");
  assert.equal(pied.querySelector(".ui-panneau-lien").getAttribute("href"), "#compte/donnees?section=biens");
  assert.match(pied.innerHTML, /Demander à Claude/);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true);
  assert.equal(v.doc.activeElement, carte, "focus rendu à la carte");
  const credit = v.$("blCredits").querySelector('[data-ui-carte="credit:credit-auto"]');
  credit.click();
  assert.equal(v.doc.body.querySelector(".ui-panneau-lien").getAttribute("href"), "#compte/donnees?section=credits");
  assert.equal(sp(v.api.headline()), "240 k€");
});

test("vue (DOM) : panneau ouvert et bien supprimé par le store → panneau fermé ; périmètre suivi", () => {
  const v = vueBilan(demoSnap());
  v.$("blBiens").querySelector("[data-ui-carte]").click();
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  const pr = clone(DEMO.profil); pr.biens = [];
  v.api.update(demoSnap({ profil: pr }), true);
  assert.equal(dlg.hidden, true);
  assert.match(v.$("blBiens").innerHTML, /Aucun bien immobilier du foyer/);
  v.api.update(demoSnap({ scope: "p1" }), true);
  assert.match(sp(v.$("blVerdict").textContent), /de Camille : 120 000 €/);
});

test("vue (DOM) : chargement, puis état vide orienté agent ; données indisponibles", () => {
  const v = vueBilan(demoSnap({ ready: false }));
  assert.equal(v.$("blEtat").hidden, false);
  assert.match(v.$("blEtat").textContent, /Chargement/);
  assert.equal(v.$("blCorps").hidden, true);
  v.api.update(demoSnap({ profil: null }), true);
  assert.equal(v.$("blEtat").hidden, true);
  assert.equal(v.$("blVide").hidden, false);
  assert.match(v.$("blVide").textContent, /Dites à Claude si vous êtes propriétaire/);
  assert.equal(v.$("blBiensSec").hidden, true);
  assert.equal(v.api.headline(), "–");
  v.api.update(demoSnap({ dbOk: false, profil: null }), true);
  assert.match(v.$("blEtat").textContent, /Données indisponibles/);
});
