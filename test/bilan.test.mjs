// Patrimoine › Immobilier et crédits (module bilan, web/src/bilan.*) : contrôles statiques, fonctions pures sur la démo et sur des
// cas construits, puis la vue dans un mini-DOM (cartes → panneau en lecture, liens Claude, états vide et chargement). Lecture seule :
// la saisie passe par Claude (« Compléter avec Claude », « Corriger avec Claude »), textes au tutoiement.
// Les calculs de BilanCalc (composition, évolution…) sont testés dans test/bilan-calc.test.mjs et test/aujourdhui.test.mjs ; le
// recoupement de la composition avec Calc.patrimoine sur la démo est gardé ici.
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
const BilanCalc = require("../web/src/bilan-calc.js");
const Calc = require("../web/src/calc.js");
const Plan = require("../web/src/plan.js");
const Reperes = require("../web/src/reperes.js");
const ClaudePrompts = require("../web/src/claude-prompts.js");
const UI = require("../web/src/ui.js");
const DEMO = require("../web/src/demo-data.js");
const DEPS = { Calc, Plan, Reperes, ClaudePrompts };
const clone = o => JSON.parse(JSON.stringify(o));
const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ").replace(/&#39;/g, "'");
const PIEGE = '<img src=x onerror="alert(1)">';
const sansCommentaires = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** Phrases des liens Claude d'un HTML, décodées depuis leur href. */
const phrasesClaude = h => [...String(h).matchAll(/href="https:\/\/claude\.ai\/new\?q=([^"]*)"/g)].map(m => decodeURIComponent(m[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&")));

/* ------------------------------------------------------------ statique ------------------------------------------------------------ */
test("bilan.js : se compile, s'enregistre sous « bilan », exporte ses fonctions pures", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "bilan.js" }));
  assert.match(js, /App\.register\("bilan", api\)/);
  assert.match(js, /__pending/);
  assert.match(js, /const api = \{ mount, update, show, headline \}/);
  for (const f of ["analyser", "plafondHcsf", "situerTaux", "verdict", "tuilesHtml", "carteBienHtml", "carteCreditHtml", "detailBienHtml", "detailCreditHtml", "phraseClaude", "contexteElement", "videHtml", "headlineDe"])
    assert.equal(typeof B[f], "function", f);
});

test("bilan : l'ancienne vue d'ensemble a disparu (carte Claude, composition, flux, allocation, évolution, à traiter)", () => {
  for (const id of ["blClaude", "blComp", "blFlux", "blAlloc", "blChart", "blEvoPer", "blTodo", "blSante", "blMatelas"]) assert.doesNotMatch(html + js, new RegExp('"' + id), id);
  for (const f of ["BilanEtat", "BilanCalc", "Rules.evaluate", "window.Actions", "sessionStorage", "localStorage"]) assert.ok(!js.includes(f), f);
  assert.match(html, /Qu'est-ce que je possède en immobilier et que dois-je \?/);
  assert.match(html, /<details class="ui-acc bl-how">/, "méthode en accordéon fermé");
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
});

test("bilan : lecture seule — plus d'« Ajouter un bien / un crédit » ni de « Modifier dans Compte › Données », aucun formulaire ni écriture", () => {
  for (const [nom, src] of [["bilan.js", js], ["bilan.html", html]]) {
    assert.doesNotMatch(src, /<form|type="submit"|<input|<select|<textarea/, nom + " : formulaire");
    assert.doesNotMatch(src, /Store\.|\.doc\(|\.collection\(|\.addMany\(|Import\.open/, nom + " : écriture au store");
    assert.doesNotMatch(src, /Ajouter un bien|Ajouter un crédit|Ajouter à la main|Modifier dans Compte|compte\/donnees/, nom + " : ancienne saisie");
  }
  assert.equal(B.lienModifier, undefined);
  const { resolve, SPACES } = require("../web/src/app.js");
  const known = new Set(SPACES.flatMap(s => s.subs.map(x => s.space + "/" + x.id)));
  const routes = new Set([...(js + html).matchAll(/data-goto="([a-z]+\/[a-z-]+)"/g)].map(m => m[1]));
  assert.ok(routes.has("pilotage/rang"));
  for (const r of routes) { const x = resolve(r); assert.ok(x && known.has(x.space + "/" + x.sub), r); }
});

test("bilan : « Compléter avec Claude » en tête des sections biens et crédits (section immobilier), plafond HCSF lu dans les repères", () => {
  assert.match(html, /id="blBiensClaude"/);
  assert.match(html, /id="blCreditsClaude"/);
  assert.match(js, /\$\("blBiensClaude"\)\.innerHTML = u\.demanderAClaude\(phraseClaude\("immobilier", "mes biens immobiliers"\), "Compléter avec Claude"\)/);
  assert.match(js, /\$\("blCreditsClaude"\)\.innerHTML = u\.demanderAClaude\(phraseClaude\("immobilier", "mes crédits/);
  assert.match(js, /R\.trouver\(reperes, "hcsf_taux_effort"\)/);
  assert.match(js, /plafondHcsf\(s\.savoir && s\.savoir\.reperes, dep\(deps, "Reperes"\)\)/);
  assert.equal(B.phraseClaude("immobilier", "le bien « X »", DEPS), ClaudePrompts.phrase("immobilier", "le bien « X »"));
});

test("bilan : tutoiement — aucun « vous / votre / vos » dans le module", () => {
  for (const [nom, src] of [["bilan.js", js], ["bilan.html", html]]) {
    const m = src.match(/\b(vous|votre|vos)\b/gi);
    assert.equal(m, null, nom + " : " + (m || []).join(", "));
  }
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

/* ------------------------------------------------------------ recoupement démo ------------------------------------------------------------ */
test("démo : patrimoine net de la composition (BilanCalc) = Calc.patrimoine, sur chaque périmètre", () => {
  for (const scope of ["foyer", "p1", "p2"]) {
    const c = BilanCalc.composition(DEMO.positions, DEMO.profil, scope), p = Calc.patrimoine(DEMO.positions, DEMO.profil, scope);
    assert.ok(Math.abs(c.net - p.net) < 1e-6, scope);
    assert.ok(Math.abs(c.actifs[0].total - p.financier) < 1e-6, scope);
    const a = B.analyser({ scope, profil: clone(DEMO.profil), budget: clone(DEMO.budget) }, DEPS);
    assert.ok(Math.abs(a.dettes - c.dettes.total) < 1e-6, "reste à rembourser de la page = dettes de la composition : " + scope);
  }
  const f = BilanCalc.composition(DEMO.positions, DEMO.profil, "foyer");
  assert.ok(Math.abs(f.actifs[0].total - 102589.9) < 0.01 /* 94 989,90 + PEL Camille 6 800 + espèces du PEA de Sam 800 (lignes ajoutées pour le calendrier DAT1) */);
  assert.equal(f.dettes.total, 156500);
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
  assert.deepEqual(a.credits.map(c => [c.key, c.kind, c.crd, c.mensualite]), [["pret:bien-rp", "pret", 150000, 820], ["credit:" + DEMO.profil.credits[0].id, "credit", 6500, 210]]); // identifiant du crédit auto de la démo : en forme d'UUID (clé prets_infos du calendrier)
  assert.equal(a.credits[1].titulaire, "Commun");
  assert.equal(a.vide, false); assert.equal(a.renseigne, true); assert.equal(a.deuxAdultes, true);
  assert.equal(a.duScope, "du foyer");
  assert.equal(a.plafond, 0.35, "sans repère : 35 %");
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

test("analyser : sans profil, sans revenus, identifiants absents, valeurs négatives ramenées à 0, crédit sans titulaire", () => {
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
  const sansTit = B.analyser({ scope: "foyer", profil: { credits: [{ nom: "Auto", crd: 1000, mensualite: 100 }] } }, DEPS).credits[0];
  assert.equal(sansTit.owner, "inconnu");
  assert.equal(sansTit.titulaire, "Titulaire non renseigné");
  const carte = sp(B.carteCreditHtml(sansTit));
  assert.match(carte, /<span class="ui-carte-titre">Crédit<\/span><span class="ui-badge attention">Titulaire non renseigné<\/span>/);
  assert.doesNotMatch(carte, /Commun/);
  const det = sp(B.detailCreditHtml(sansTit, { scope: "foyer" }));
  assert.match(det, /<dt>Titulaire<\/dt><dd>Non renseigné<\/dd>/);
  assert.match(det, /ne compte que dans la vue du foyer/);
  assert.equal(B.contexteElement(sansTit), "le crédit « Auto » (titulaire non renseigné)");
});

test("plafondHcsf et situerTaux : repère du savoir (35 % en secours) ; jamais « 35 % » avec « au-delà du plafond »", () => {
  assert.equal(B.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: 33 }], Reperes), 0.33);
  assert.equal(B.plafondHcsf([], Reperes), 0.35);
  assert.equal(B.plafondHcsf([{ cle: "hcsf_taux_effort", valeur: "abc" }], Reperes), 0.35);
  assert.equal(B.plafondHcsf(DEMO.savoir.reperes, Reperes), 0.35, "démo : repère à 35");
  assert.equal(B.plafondHcsf(null, null), 0.35);
  const T = t => { const x = B.situerTaux(t, 0.35); return [sp(x.texte), x.etat, x.ton]; };
  assert.deepEqual(T(0.30), ["30 %", "sous", "bon"]);
  assert.deepEqual(T(0.346), ["34,6 %", "sous", "bon"]);
  assert.deepEqual(T(0.3496), ["35,0 %", "au", "attention"]);
  assert.deepEqual(T(0.352), ["35,2 %", "au-dela", "critique"]);
  assert.deepEqual(T(0.36), ["36 %", "au-dela", "critique"]);
  assert.deepEqual(B.situerTaux(null, 0.35), { texte: "—", etat: null, ton: "" });
  for (let t = 0.33; t <= 0.37; t += 0.0003) {
    const v = sp(B.verdict({ vide: false, immobilier: 1, dettes: 1, mensualites: 100, taux: t, plafond: 0.35, duScope: "du foyer" }).phrase);
    if (/pèsent 35 % /.test(v) || /pèsent 35,0 % /.test(v)) assert.doesNotMatch(v, /au-delà/, v);
    const shown = +/pèsent ([\d,]+) %/.exec(v)[1].replace(",", ".");
    assert.equal(/au-delà/.test(v), shown > 35, v);
  }
});

test("verdict : une phrase au tutoiement (immobilier, reste dû, poids des mensualités), tons, plafond des repères, vide orienté agent", () => {
  const v = B.verdict(B.analyser(S0(), DEPS));
  assert.equal(v.ton, "bon");
  assert.match(sp(v.phrase), /^Immobilier et crédits du foyer : 240 000 € d'immobilier, 156 500 € restant à rembourser\. Tes mensualités pèsent \d+ % de tes revenus, sous le plafond de 35 % des banques\.$/);
  const pr = clone(DEMO.profil); pr.biens[0].mensualite = 3000;
  assert.equal(B.verdict(B.analyser(S0({ profil: pr }), DEPS)).ton, "critique");
  const a = B.analyser(S0({ savoir: { reperes: [{ cle: "hcsf_taux_effort", valeur: 20 }] } }), DEPS);
  assert.equal(a.plafond, 0.2);
  assert.match(sp(B.verdict(a).phrase), /au-delà du plafond de 20 % des banques\.$/, "plafond lu dans les repères");
  assert.match(B.verdict(B.analyser({ scope: "foyer", profil: null }, DEPS)).phrase, /dis à Claude si tu es propriétaire ou si tu as des crédits/);
  assert.match(B.verdict(B.analyser({ scope: "foyer", profil: { biens: [], credits: [] } }, DEPS)).phrase, /^Aucun bien immobilier ni crédit enregistré du foyer\.$/);
  assert.match(B.verdict(B.analyser({ scope: "foyer", profil: { biens: [], credits: [{ nom: "Auto", crd: 1000, mensualite: 100 }] } }, DEPS)).phrase, /Complète tes revenus avec Claude/);
});

test("tuilesHtml : immobilier, reste à rembourser, mensualités, taux (mensualités ÷ revenus du foyer) ; mots d'état sans compteur ; Rang et loyers à 70 %", () => {
  const h = sp(B.tuilesHtml(B.analyser(S0(), DEPS), UI, DEPS));
  for (const id of ["immobilier", "dettes", "mensualites", "taux"]) assert.match(h, new RegExp('data-bl-tuile="' + id + '"'));
  assert.match(h, /240 000 €/); assert.match(h, /156 500 €/); assert.match(h, /1 030 €\/mois/);
  assert.match(h, /Taux d'endettement<span class="bl-tuile-def">mensualités ÷ revenus du foyer<\/span>/);
  assert.match(h, /href="#pilotage\/rang" data-goto="pilotage\/rang">Ta capacité d'emprunt<\/a> \(la banque y compte les loyers à 70 %\)/);
  assert.match(h, /plafond des banques : 35 %/);
  assert.match(h, /bl-tuile bon/);
  assert.doesNotMatch(h, /\d+ (crédit|bien)s?\b(?! immobilier)/, "pas de compteur « 2 crédits » / « 1 bien »");
  assert.match(h, /en cours de remboursement/);
  assert.match(h, /sans loyer perçu/);
  assert.match(sp(B.tuilesHtml(B.analyser(S0({ scope: "p1" }), DEPS), UI, DEPS)), /mensualités ÷ revenus de Camille/);
  const sans = B.tuilesHtml(B.analyser({ scope: "foyer", profil: { biens: [], credits: [{ nom: "Auto", crd: 1000, mensualite: 100 }] } }, DEPS), UI, DEPS);
  assert.match(sans, /revenus à renseigner · <a href="https:\/\/claude\.ai\/new\?q=[^"]+"[^>]*>Compléter avec Claude/);
  assert.deepEqual(phrasesClaude(sans), [ClaudePrompts.phrase("revenus", "")]);
  const vide = sp(B.tuilesHtml(B.analyser({ scope: "foyer", profil: { biens: [], credits: [] } }, DEPS)));
  assert.match(vide, /aucun bien/); assert.match(vide, /aucun crédit/);
});

test("cartes et panneaux : texte échappé, prêt rattaché au bien, répartition au foyer, part dans le périmètre (tutoiement)", () => {
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
  assert.match(db, /vérifie les deux montants avec Claude/);
  const p1 = B.analyser(Object.assign({}, S, { scope: "p1" }), DEPS);
  assert.match(sp(B.detailBienHtml(p1.biens[0], { scope: "p1" })), /<dt>Ta part<\/dt><dd>70 % de 200 000 €<\/dd>/);
  const pret = sp(B.detailCreditHtml(a.credits[0], { scope: "foyer" }));
  assert.match(pret, /<dt>Type<\/dt><dd>Prêt immobilier<\/dd><dt>Bien financé<\/dt>/);
  assert.match(B.carteCreditHtml(a.credits[1]), /Crédit · &lt;img/);
  assert.match(B.questionBien(a.biens[0]), /^Dans Boussole, mon bien « /);
  assert.doesNotMatch(B.questionBien(a.biens[0]) + B.questionCredit(a.credits[0]) + B.questionPage(a), /[\u00a0\u202f]/, "questions en espaces simples");
  assert.equal(B.contexteElement(a.credits[0]), "le prêt immobilier du bien « " + PIEGE + " »");
  assert.equal(B.contexteElement(a.biens[0]), "le bien « " + PIEGE + " » (locatif)");
});

test("videHtml et headlineDe : « Dis à Claude… » puis « Compléter avec Claude » ; chiffre clé = immobilier, sinon reste dû", () => {
  const v = B.videHtml(B.analyser({ scope: "foyer", profil: null }, DEPS), UI, DEPS);
  assert.match(v, /Dis à Claude si tu es propriétaire ou si tu as des crédits/);
  assert.match(v, />Compléter avec Claude</);
  assert.deepEqual(phrasesClaude(v), [ClaudePrompts.phrase("immobilier", "")]);
  assert.doesNotMatch(v, /Ajouter à la main|compte\/donnees/);
  assert.match(sp(B.videHtml(B.analyser({ scope: "foyer", profil: { biens: [], credits: [] } }, DEPS), UI, DEPS)), /Tu n'as déclaré ni bien immobilier ni crédit\./);
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
  for (const f of ["calc.js", "plan.js", "reperes.js", "ui.js", "claude-prompts.js"]) vm.runInContext(readFileSync("web/src/" + f, "utf8"), ctx, { filename: f });
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
  positions: clone(DEMO.positions), profil: clone(DEMO.profil), budget: clone(DEMO.budget), savoir: clone(DEMO.savoir) }, o);

test("vue (DOM) : verdict, tuiles, cartes, « Compléter avec Claude » ; carte → panneau en lecture (Corriger avec Claude, Demander à Claude), Échap rend le focus", () => {
  const v = vueBilan(demoSnap());
  assert.equal(v.$("blEtat").hidden, true);
  assert.equal(v.$("blCorps").hidden, false);
  assert.match(sp(v.$("blVerdict").textContent), /^Immobilier et crédits du foyer : 240 000 €/);
  assert.match(v.$("blDemander").innerHTML, /claude\.ai\/new\?q=/);
  assert.equal(v.$("blTuiles").querySelectorAll("[data-bl-tuile]").length, 4);
  assert.equal(v.$("blBiens").querySelectorAll("[data-ui-carte]").length, 1);
  assert.equal(v.$("blCredits").querySelectorAll("[data-ui-carte]").length, 2);
  assert.equal(v.$("blVide").hidden, true);
  assert.deepEqual(phrasesClaude(v.$("blBiensClaude").innerHTML), [ClaudePrompts.phrase("immobilier", "mes biens immobiliers")]);
  assert.match(v.$("blCreditsClaude").innerHTML, />Compléter avec Claude</);
  assert.equal(sp(v.$("blPlafond").textContent), "35 %");
  const carte = v.$("blBiens").querySelector('[data-ui-carte="bien:bien-rp"]');
  carte.focus(); carte.click();
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  assert.equal(dlg.hidden, false);
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Appartement (résidence principale)");
  assert.match(sp(dlg.querySelector(".ui-panneau-corps").textContent), /Reste à rembourser150 000 €/);
  const pied = dlg.querySelector(".ui-panneau-pied");
  assert.equal(pied.querySelector(".ui-panneau-lien"), null, "plus de lien « Modifier dans Compte › Données »");
  assert.deepEqual(phrasesClaude(pied.innerHTML)[0], ClaudePrompts.phrase("immobilier", "le bien « Appartement (résidence principale) » (résidence principale)"));
  assert.match(pied.innerHTML, />Corriger avec Claude</);
  assert.match(pied.innerHTML, /Demander à Claude/);
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true);
  assert.equal(v.doc.activeElement, carte, "focus rendu à la carte");
  const credit = v.$("blCredits").querySelector('[data-ui-carte="credit:' + DEMO.profil.credits[0].id + '"]');
  credit.click();
  assert.equal(phrasesClaude(v.doc.body.querySelector(".ui-panneau-pied").innerHTML)[0], ClaudePrompts.phrase("immobilier", "le crédit « Prêt auto »"));
  assert.equal(sp(v.api.headline()), "240 k€");
});

test("vue (DOM) : panneau ouvert, contenu rafraîchi quand le store émet, fermé si le bien disparaît ; périmètre suivi", () => {
  const v = vueBilan(demoSnap());
  v.$("blBiens").querySelector("[data-ui-carte]").click();
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  const pr0 = clone(DEMO.profil); pr0.biens[0].valeur = 260000;
  v.api.update(demoSnap({ profil: pr0 }), true);
  assert.equal(dlg.hidden, false);
  assert.match(sp(dlg.querySelector(".ui-panneau-corps").textContent), /260 000 €/, "contenu mis à jour");
  const pr = clone(DEMO.profil); pr.biens = [];
  v.api.update(demoSnap({ profil: pr }), true);
  assert.equal(dlg.hidden, true);
  assert.match(v.$("blBiens").innerHTML, /Aucun bien immobilier du foyer\./);
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
  assert.match(v.$("blVide").textContent, /Dis à Claude si tu es propriétaire/);
  assert.equal(v.$("blBiensSec").hidden, true);
  assert.equal(v.api.headline(), "–");
  v.api.update(demoSnap({ dbOk: false, profil: null }), true);
  assert.match(v.$("blEtat").textContent, /Données indisponibles pour le moment : recharge la page ou reconnecte-toi\./);
});

/* ------------------------------------------------------------ « Ta capacité demain » (emplacement du graphe maître) ------------------------------------------------------------ */
test("bilan : « Ta capacité demain » n'est plus un « bientôt » — l'emplacement reçoit le graphe, avec la mention fixe sous lui, en lecture seule", () => {
  assert.doesNotMatch(html, /bientôt/i);
  const slot = html.match(/<div class="ic-demain" data-slot="capacite-demain">[\s\S]*?<\/p>\s*<\/div>/);
  assert.ok(slot, "emplacement conservé");
  assert.match(slot[0], /id="icGraphe"/, "hôte du graphe maître"); assert.match(slot[0], /id="icDemainIndispo"[^>]*hidden/, "état indisponible masqué par défaut");
  assert.match(slot[0], /id="icDemainMention"[^>]*>Estimation selon les règles du HCSF, chaque banque décide\. Ce n'est pas une offre de prêt\.<\/p>/);
  assert.doesNotMatch(slot[0], /<(form|input|select|textarea|button)\b/, "aucun contrôle de saisie dans l'emplacement");
  // la vue branche la carte et lui passe l'état à chaque rendu (le graphe suit le périmètre et se recalcule avec le store)
  assert.match(js, /ImmoCapacite\.rendre\(S\)/); assert.match(js, /ImmoCapacite\.monter\(\$\("blCapacite"\), \{ UI: u \}\)/);
  assert.doesNotMatch(slot[0] + sansCommentaires(js), /\b(vous|votre|vos)\b/i);
});
