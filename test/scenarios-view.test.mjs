// Pilotage › Scénarios (web/src/scenarios-view.*, SCN1 spec § 10 et § 13.7, sauf « Mes variantes ») : bibliothèque « Et si… ? » (« Pour toi », thèmes,
// cartes), détail (ordre des blocs, barres d'intervalle et phrase équivalente, tableau, graphiques, formulaire « Ajuster les hypothèses » et recalcul),
// états (calcul, à compléter, indisponible), mises en page (page, panneau, maître-détail, trois zones), liens profonds (?scenario=, ?outil=acheter-louer),
// catalogue embarqué (scripts/gen-scenarios-demo.mjs), stores (démo, Supabase avec repli), lecture seule et lexique. Données fictives (Camille et Sam).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { etatDemo, monter, attendre, HTML } from "./helpers/scenarios-vue.mjs";
import { generer } from "../scripts/gen-scenarios-demo.mjs";
import { FIXTURE } from "./helpers/scenarios-cas.mjs";

const require = createRequire(import.meta.url);
const SV = require("../web/src/scenarios-view.js");
const Sc = require("../web/src/scenarios.js");
const PD = require("../web/src/projection-donnees.js");
const CAT = require("../web/src/scenarios-catalogue.gen.js");
const W = require("../web/src/scenarios-worker.js");
const js = readFileSync("web/src/scenarios-view.js", "utf8"), css = readFileSync("web/src/scenarios-view.css", "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const TODAY = "2026-10-26";
const entree = cle => J(CAT.catalogue.find(e => e.cle === cle));
const donneesDemo = () => { const S = etatDemo(); const d = PD.depuisEtat(S, TODAY); d.risque = S.risque; delete d.historique; return d; };
/** Descendant (le mini-DOM ne gère pas les combinateurs) : premier élément de `sel` sous un élément de `parent`. */
const sous = (el, parent, sel) => { for (const p of el.querySelectorAll(parent)) { const x = p.querySelector(sel); if (x) return x; } return null; };
const blocs = el => el.querySelectorAll("[data-scn-bloc]").map(b => b.getAttribute("data-scn-bloc"));

/* ------------------------------------------------------------------ catalogue embarqué ------------------------------------------------------------------ */
test("catalogue embarqué : à jour de la fixture (npm run gen), entrées publiées, repères des scénarios ; branché dans npm run gen", () => {
  assert.equal(readFileSync("web/src/scenarios-catalogue.gen.js", "utf8"), generer(), "web/src/scenarios-catalogue.gen.js n'est plus à jour : lance npm run gen");
  assert.deepEqual(CAT.catalogue.map(e => e.cle), FIXTURE.catalogue.filter(e => e.statut === "publie").map(e => e.cle), "toutes les entrées publiées, dans l'ordre de la fixture");
  for (const e of CAT.catalogue) for (const k of ["evals", "ouverture", "garde_fous"]) assert.ok(!(k in e), e.cle + " : " + k + " non embarqué");
  for (const r of FIXTURE.reperes) assert.ok(CAT.reperes.some(x => x.cle === r.cle && x.valeur === r.valeur), r.cle);
  assert.ok(CAT.reperes_scenarios.length >= FIXTURE.reperes.length && CAT.reperes_scenarios.every(k => CAT.reperes.some(r => r.cle === k)));
  for (const r of CAT.reperes) assert.deepEqual(Object.keys(r).sort(), ["cle", "dateEffet", "dateFin", "libelle", "sourceTitre", "sourceUrl", "unite", "valeur", "verifieLe"]);
  assert.match(JSON.parse(readFileSync("package.json", "utf8")).scripts.gen, /node scripts\/gen-scenarios-demo\.mjs/);
});

/* ------------------------------------------------------------------ fonctions pures ------------------------------------------------------------------ */
test("disposition : page < 900, panneau 900 à 1 439, maître-détail 1 440 à 1 679, trois zones ≥ 1 680 (les cinq largeurs du § 13.7)", () => {
  assert.deepEqual([390, 768, 1024, 1440, 1680].map(SV.disposition), ["page", "page", "panneau", "maitre", "trois"]);
  assert.equal(SV.disposition(899), "page"); assert.equal(SV.disposition(1439), "panneau"); assert.equal(SV.disposition(1679), "maitre");
});

test("liens profonds : ?scenario=<cle> → détail ; ?outil=acheter-louer → l'outil ; le reste → la liste", () => {
  assert.deepEqual(SV.vueDe({ scenario: "ouvrir_pea" }), { vue: "detail", cle: "ouvrir_pea" });
  assert.deepEqual(SV.vueDe({ outil: "acheter-louer" }), { vue: "outil", cle: null });
  assert.deepEqual(SV.vueDe({}), { vue: "liste", cle: null });
  assert.deepEqual(SV.vueDe({ scenario: "<script>" }), { vue: "liste", cle: null }, "clé non conforme ignorée");
  assert.equal(SV.lienScenario("matelas"), "#pilotage/scenarios?scenario=matelas");
  assert.equal(SV.LIEN_OUTIL, "#pilotage/scenarios?outil=acheter-louer");
});

test("carte : enjeu « ≈ X €/an » et sa bande ; « calcul… » ; « Enjeu à calculer » ; indisponible ; jamais un faux chiffre", () => {
  const base = { cle: "x", theme: "epargne", question: "Q ?", pertinent: true, pourquoi: ["Parce que."], manquants: [], etat: "a_explorer" };
  assert.deepEqual(J(SV.enjeuCarte(Object.assign({}, base, { enjeu_statut: "ok", enjeu: { p10: 38, p50: 104, p90: 213 } }))), { etat: "ok", principal: "≈ 100 €/an", bande: "de 40 à 210 €/an, 8 chances sur 10" });
  assert.equal(SV.enjeuCarte(Object.assign({}, base, { enjeu_statut: "calcul" })).principal, "calcul…");
  assert.equal(SV.enjeuCarte(Object.assign({}, base, { enjeu_statut: "a_completer" })).principal, "Enjeu à calculer");
  assert.equal(SV.enjeuCarte(Object.assign({}, base, { enjeu_statut: "indisponible" })).principal, "Chiffres pas encore disponibles : un repère manque.");
  for (const st of ["calcul", "a_completer", "indisponible"]) assert.doesNotMatch(SV.carteHtml(Object.assign({}, base, { enjeu_statut: st })), /\d\s?€/, st + " : aucun montant");
  const h = SV.carteHtml(Object.assign({}, base, { enjeu_statut: "a_completer", manquants_questions: ["Un", "Deux", "Trois", "Quatre"], reperes_a_reverifier: ["k"] }), "epargne");
  assert.match(h, /^<a class="ui-carte scn-carte" href="#pilotage\/scenarios\?scenario=x" data-scn-cle="x" data-scn-zone="epargne">/, "carte entière : un lien");
  assert.match(h, /<h3 class="scn-carte-q">Q \?<\/h3>/);
  assert.match(h, /<span class="scn-carte-pourquoi">Parce que\.<\/span>/);
  assert.equal((h.match(/ui-puce completer/g) || []).length, 2, "2 questions manquantes au plus");
  assert.match(h, /\+ 2<\/span>/);
  assert.match(h, /Chiffres à revérifier/);
  assert.match(SV.etatHtml({ etat: "joue", joue_le: "2026-10-12T19:30:00Z" }), /Joué le 12\/10/);
  assert.match(SV.etatHtml({ etat: "retenu" }), /ui-badge bon[^>]*>Retenu/);
  assert.match(SV.etatHtml({ etat: "ecarte" }), /Écarté/);
  assert.match(SV.etatHtml({ etat: "a_explorer" }), /À explorer/);
});

test("libellés des choix : dictionnaire, nombres, repli sur la valeur brute joliment formatée", () => {
  const q = id => ({ id, type: "choix" });
  assert.equal(SV.libelleChoix(q("regime"), "lmnp_reel"), "Meublé (LMNP) au réel");
  assert.equal(SV.libelleChoix(q("regime"), "nu_micro"), "Location nue, micro-foncier");
  assert.equal(SV.libelleChoix(q("destination_actuelle"), "compte_titres"), "Compte-titres");
  assert.equal(SV.libelleChoix(q("debut"), "plus_tard"), "Plus tard");
  assert.equal(SV.libelleChoix(q("tmi_pct"), 30), "30 %");
  assert.equal(SV.libelleChoix(q("parts_fiscales"), 2.5), "2,5 parts");
  assert.equal(SV.libelleChoix(q("x"), "nouvelle_option_inconnue"), "Nouvelle option inconnue");
  for (const e of CAT.catalogue) for (const qq of e.questions.filter(x => x.type === "choix")) for (const o of qq.options) assert.doesNotMatch(SV.libelleChoix(qq, o), /_/, e.cle + " " + qq.id + " " + o);
});

test("saisie : nombres à virgule, entiers, oui / non, choix, dates ; préremplissage non compté comme réponse ; bornes contrôlées par Scenarios.reponsesValides", () => {
  const e = entree("ouvrir_pea");
  const pre = { versement_initial: 0, versement_mensuel: 980, debut: "maintenant", horizon_ans: 1, destination_actuelle: "compte_titres" };
  const ok = SV.lireSaisie(e, { versement_initial: "0", versement_mensuel: "300,5", horizon_ans: "8", debut: "1", debut_date: "2027-03-01", frais_pea_pct: "", destination_actuelle: "0" }, pre);
  assert.equal(ok.erreurs, null);
  assert.deepEqual(J(ok.reponses), { versement_mensuel: 300.5, horizon_ans: 8, debut: "plus_tard", debut_date: "2027-03-01" }, "les valeurs égales au préremplissage restent « Boussole »");
  const ko = SV.lireSaisie(e, { versement_mensuel: "abc", horizon_ans: "99", versement_initial: "-5" }, pre);
  assert.equal(ko.erreurs.versement_mensuel, "Entre un nombre.");
  assert.match(ko.erreurs.horizon_ans, /^Entre 1 et 40\.$/);
  assert.match(sp(ko.erreurs.versement_initial), /^Entre 0 € et 150 000 €\.$/);
  assert.match(ko.erreurs._resume, /3 réponses sont à corriger\. Le calcul n'a pas été refait\./);
  assert.ok(!("horizon_ans" in ko.reponses));
  const loc = SV.lireSaisie(entree("locatif_scpi"), { neuf: "oui", scpi_reinvestir: "non", regime: "2", tmi: "3" }, {});
  assert.deepEqual(J(loc.reponses), { neuf: true, regime: "nu_reel", tmi: 41, scpi_reinvestir: false });
});

test("formulaire : toutes les questions du catalogue (libellé, aide, bornes, facultatif), sans <form> ; questions manquantes en premier et mises en avant", () => {
  const e = entree("locatif_scpi");
  const h = SV.formulaireHtml(e, { prerempli: { regime: "lmnp_reel", tmi: 30 }, manquants: ["prix", "apport"] });
  assert.doesNotMatch(h, /<form\b|type="submit"/);
  for (const q of e.questions) assert.ok(h.includes('data-scn-q="' + q.id + '"'), q.id);
  const ids = [...h.matchAll(/data-scn-champ="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids.slice(0, 2), ["prix", "apport"], "manquantes d'abord");
  assert.match(SV.formulaireHtml(e, { manquants: ["prix"], ouvert: true }), /<details class="ui-acc scn-bloc scn-ajuster" data-scn-bloc="ajuster" open>/, "ouvert quand demandé (detailHtml l'ouvre s'il manque des réponses)");
  assert.match(h, /Réponds à ces questions pour calculer/);
  assert.match(h, /<option value="0" selected>Meublé \(LMNP\) au réel<\/option>/);
  assert.match(sp(h), /Entre 20 000 € et 3 000 000 €\./);
  assert.match(h, /<label class="scn-champ-l" for="scn-q-locatif_scpi-prix">Prix du bien \(hors frais de notaire\)/);
  assert.match(h, /aria-describedby="scn-q-locatif_scpi-prix-aide scn-q-locatif_scpi-prix-err"/);
  assert.match(h, /Travaux à l&#39;achat<span class="ui-sr"> \(en euros\)<\/span> <span class="scn-facultatif">facultatif<\/span>/);
  assert.match(h, /<button type="button" class="ui-btn" data-scn-recalculer>Recalculer<\/button>/);
  assert.match(SV.formulaireHtml(e, { manquants: [] }), /<summary class="ui-acc-titre"><span>Ajuster les hypothèses<\/span>/);
});

/* ------------------------------------------------------------------ détail (pur) ------------------------------------------------------------------ */
const D = donneesDemo();
const RES_PEA = Sc.jouer(entree("ouvrir_pea"), D, { horizon_ans: 8, versement_mensuel: 300 }, TODAY, { chemins: 500 });
const RES_AV = Sc.jouer(entree("av_maintenant"), D, { versement_initial: 500, versement_mensuel: 100, debut_date: "2028-01-01", retrait_ans: 9 }, TODAY, { chemins: 300 });
const RES_PEA_TARD = Sc.jouer(entree("ouvrir_pea"), D, { horizon_ans: 10, versement_mensuel: 300, debut: "plus_tard", debut_date: "2029-01-01" }, TODAY, { chemins: 300 });
const RES_LOC = Sc.jouer(entree("locatif_scpi"), D, { prix: 200000, apport: 40000, loyer_mensuel: 800, charges_annuelles: 2000, horizon_ans: 15 }, TODAY, { chemins: 200 });

test("détail : blocs dans l'ordre du § 10.3 (réponse, comparaison, ce qui changerait, hypothèses, données, ajuster, Claude, pied)", () => {
  assert.equal(RES_PEA.statut, "ok");
  const dom = monter(etatDemo()).doc, el = dom.createElement("div");
  el.innerHTML = SV.detailHtml(entree("ouvrir_pea"), { etat: "pret", resultat: RES_PEA, final: true });
  assert.deepEqual(blocs(el), ["reponse", "comparaison", "changerait", "hypotheses", "donnees", "ajuster", "claude", "pied"]);
  const t = sp(el.textContent);
  assert.match(t, /un PEA te laisserait environ [\d ]+ € de plus qu'un compte-titres, en euros d'aujourd'hui/);
  assert.match(t, /\+[\d ]+ €en euros d'aujourd'hui, pour « PEA ouvert dans 1 mois »/, "écart P50 en grand");
  assert.ok(el.querySelector(".scn-ecart-v"), "écart en grand (chiffre héros)");
  assert.match(t, /Entre \+?[\d −]+ € et \+[\d ]+ €, 8 chances sur 10/, "bande sous l'écart");
  assert.match(t, /À partir de [a-zé]+ 20\d\d/, "date de bascule");
  assert.match(t, /Calculé aujourd'hui avec tes données · calcul scn-1\.0\.0 · 500 tirages/);
  assert.match(t, /Un calcul sur tes données, pas une recommandation de produit\. Une projection n'est pas une promesse\. Boussole n'exécute rien : c'est toi qui décides et qui fais\./);
  // hypothèses repliées par défaut (mobile, panneau), ouvertes en grand écran
  assert.ok(!el.querySelector('[data-scn-bloc="hypotheses"]').hasAttribute("open"));
  el.innerHTML = SV.detailHtml(entree("ouvrir_pea"), { etat: "pret", resultat: RES_PEA, final: true, hypoOuvertes: true });
  assert.ok(el.querySelector('[data-scn-bloc="hypotheses"]').hasAttribute("open"));
  el.innerHTML = SV.detailHtml(entree("ouvrir_pea"), { etat: "pret", resultat: RES_PEA, final: true, hypoSeparees: true });
  assert.ok(!blocs(el).includes("hypotheses"), "≥ 1 680 px : les hypothèses vont dans leur colonne");
});

test("comparaison : barres d'intervalle P10–P90 avec point P50 et valeur, référence, role=img et phrase équivalente ; option exclue grisée avec sa raison ; tableau", () => {
  const h = SV.intervallesHtml(RES_PEA);
  assert.match(h, /^<div class="scn-iv" role="img" aria-label="Comparaison, patrimoine net à la sortie en euros d&#39;aujourd&#39;hui, 8 chances sur 10 entre les deux bornes : PEA ouvert dans 1 mois : environ/);
  assert.equal((h.match(/class="scn-iv-point"/g) || []).length, 2);
  assert.equal((h.match(/class="scn-iv-ref" /g) || []).length, 2, "ligne verticale de la référence sur chaque rangée");
  assert.match(h, /scn-iv-ligne tete/); assert.match(h, /scn-iv-ligne ref/);
  const r = J(RES_PEA);
  r.options.push({ id: "X", libelle: "Option écartée", net: null, exclue: "raison", contraintes: ["Elle ne s'applique pas à ta situation."] });
  const h2 = SV.intervallesHtml(r);
  assert.match(h2, /<li class="scn-iv-ligne exclue"><span class="scn-iv-nom">Option écartée<\/span><span class="scn-iv-raison">Elle ne s&#39;applique pas à ta situation\.<\/span><\/li>/);
  assert.match(h2, /Option écartée, écartée : Elle ne s&#39;applique pas à ta situation\."/, "phrase équivalente : l'option écartée et sa raison");
  const t = SV.tableauHtml(RES_PEA);
  assert.match(t, /<th scope="col">P10<\/th><th scope="col">Médiane<\/th><th scope="col">P90<\/th><th scope="col">Versé<\/th><th scope="col">Impôts \(médiane\)<\/th><th scope="col">Frais \(médiane\)<\/th><\/tr>/);
  assert.doesNotMatch(t, /Rendement annuel/, "pas de TRI sans detail.tri");
});

test("courbe « gain selon la date de retrait » (n° 1, n° 12) : médiane, bande P10–P90, repère des 5 ou 8 ans, phrase équivalente", () => {
  assert.equal(SV.courbeSvg(RES_PEA, 600), null, "PEA versé maintenant : pas de courbe dans le résultat");
  const c = SV.courbeSvg(RES_PEA_TARD, 600);
  assert.ok(c, "PEA ouvert maintenant, versé plus tard : la courbe");
  assert.match(c.svg, /class="scn-g-bande"/); assert.match(c.svg, /class="scn-g-mediane"/);
  assert.match(c.svg, /class="scn-g-repere"/); assert.match(c.svg, />5 ans<\/text>/);
  const a = SV.courbeSvg(RES_AV, 600);
  assert.ok(a); assert.match(a.svg, />8 ans<\/text>/);
  assert.match(sp(c.phrase), /^Gain selon la date de retrait, en euros d'aujourd'hui : au plus haut, environ/);
  assert.equal(SV.courbeSvg({ courbe: { points: [] } }, 600), null);
});

test("6ᵉ scénario générique (locatif ou SCPI) : patrimoine par année (une médiane par option, bande de l'option en tête, légende) ; TRI dans le tableau", () => {
  assert.equal(RES_LOC.statut, "ok");
  const p = SV.patrimoineSvg(RES_LOC, 640);
  assert.ok(p, "detail.patrimoine dessiné");
  assert.equal((p.svg.match(/class="scn-g-ligne c\d"/g) || []).length, RES_LOC.options.length);
  assert.match(p.svg, /class="scn-g-bande-tete"/);
  for (const o of RES_LOC.options) assert.ok(p.legende.includes(o.libelle), o.libelle);
  assert.match(p.legende, /\(bande : 8 chances sur 10\)/);
  assert.match(sp(p.phrase), /^Patrimoine net selon l'année de sortie, en euros d'aujourd'hui, médiane par option/);
  const t = SV.tableauHtml(RES_LOC);
  assert.match(t, /<th scope="col">Rendement annuel médian<\/th>/);
  const fin = Object.values(RES_LOC.detail.tri).find(v => typeof v === "number");
  assert.ok(sp(t).includes(sp(require("../web/src/format.js").fmtPct(fin))), "TRI affiché");
  const dom = monter(etatDemo()).doc, el = dom.createElement("div");
  el.innerHTML = SV.detailHtml(entree("locatif_scpi"), { etat: "pret", resultat: RES_LOC, final: true });
  assert.ok(el.querySelector('[data-scn-graphe="patrimoine"]'));
  assert.equal(SV.patrimoineSvg(RES_PEA, 600), null, "sans detail.patrimoine : pas de graphique");
});

test("détail : « à compléter » met le formulaire en avant (questions manquantes d'abord) ; « indisponible » le dit sans chiffre", () => {
  const e = entree("locatif_scpi"), r = Sc.jouer(e, D, {}, TODAY, { chemins: 100 });
  assert.equal(r.statut, "a_completer");
  const dom = monter(etatDemo()).doc, el = dom.createElement("div");
  el.innerHTML = SV.detailHtml(e, { etat: "pret", resultat: r, prerempli: Sc.preremplir(e, D, TODAY) });
  assert.deepEqual(blocs(el).slice(0, 2), ["reponse", "ajuster"], "la réponse dit ce qui manque, le formulaire suit, ouvert");
  assert.ok(el.querySelector('[data-scn-bloc="ajuster"]').hasAttribute("open"));
  assert.deepEqual(el.querySelectorAll("[data-scn-champ]").slice(0, 4).map(x => x.getAttribute("data-scn-champ")), ["prix", "apport", "loyer_mensuel", "charges_annuelles"]);
  assert.match(sp(el.textContent), /Il manque quelques réponses pour calculer : Prix du bien/);
  const sans = J(D); sans.reperes = sans.reperes.filter(x => x.cle !== "pea_duree_ans");
  const ri = Sc.jouer(entree("ouvrir_pea"), sans, {}, TODAY, { chemins: 100 });
  assert.equal(ri.statut, "indisponible");
  el.innerHTML = SV.detailHtml(entree("ouvrir_pea"), { etat: "pret", resultat: ri });
  const t = sp(el.textContent);
  assert.match(t, /Chiffres pas encore disponibles : un repère manque\./);
  assert.doesNotMatch(el.querySelector('[data-scn-bloc="reponse"]').textContent.replace(/pea_duree_ans/g, ""), /\d\s?€/, "aucun montant");
  assert.ok(!blocs(el).includes("comparaison"));
});

/* ------------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------------ */
test("vue (DOM, 390 px) : en-tête, squelettes puis « Pour toi » (3 au plus, triés par enjeu) et thèmes dans l'ordre ; Immobilier porte l'outil acheter / louer", async () => {
  const v = monter(etatDemo(), { largeur: 390 });
  const L = v.root.querySelector("#scnListe");
  assert.match(sp(L.textContent), /^Et si… \?\s?Les questions que tout le monde se pose, calculées sur ta situation\. Rien n'est fait à ta place\./);
  assert.match(sp(L.textContent), /Calcul des enjeux sur ta situation…/, "pendant le calcul : squelettes, sans chiffre");
  assert.ok(L.querySelector(".ui-squelette"));
  assert.ok(L.querySelectorAll(".scn-carte-enjeu.calcul").length > 0, "enjeux « calcul… »");
  await attendre();
  const pt = L.querySelector(".scn-cartes-pourtoi");
  const cles = pt ? pt.querySelectorAll("[data-scn-cle]").map(a => a.getAttribute("data-scn-cle")) : [];
  const L2 = Sc.lister(CAT.catalogue, D, J(etatDemo().scenarios.joues), TODAY, {});
  assert.deepEqual(cles, L2.pour_toi, "« pour toi » = Scenarios.lister(...).pour_toi");
  assert.ok(cles.length >= 1 && cles.length <= 3);
  const themes = L.querySelectorAll("[data-scn-theme]").map(d => d.getAttribute("data-scn-theme"));
  assert.deepEqual(themes, Sc.THEMES.filter(t => CAT.catalogue.some(e => e.theme === t) || t === "immobilier"), "ordre de Scenarios.THEMES, un thème vide n'apparaît pas");
  assert.ok(!themes.includes("banque") && !themes.includes("famille"));
  assert.deepEqual(L.querySelectorAll(".scn-theme-t").map(x => x.textContent), themes.map(t => SV.THEMES[t]));
  const immo = L.querySelector('[data-scn-theme="immobilier"]');
  assert.ok(immo.querySelector('[data-scn-cle="locatif_scpi"]'), "le 6ᵉ scénario apparaît tout seul (catalogue)");
  const outil = immo.querySelector("[data-scn-outil-lien]");
  assert.equal(outil.getAttribute("href"), "#pilotage/scenarios?outil=acheter-louer");
  assert.match(sp(outil.textContent), /Acheter ou louer : le simulateur simple.*calcul simplifié, sans tirages/);
  assert.match(sp(L.textContent), /D'autres questions arrivent : frais de ta banque, acheter ou louer, rembourser ou placer…$/);
  assert.equal(L.querySelectorAll(".scn-carte-enjeu.calcul").length, 0, "calcul terminé : plus de « calcul… »");
  // états des parties jouées de la démo
  const etat = cle => sp(sous(sous(L, "[data-scn-theme]", '[data-scn-cle="' + cle + '"]'), "span", ".scn-etat").textContent);
  assert.equal(etat("matelas"), "Retenu"); assert.equal(etat("av_maintenant"), "Écarté"); assert.equal(etat("ouvrir_pea"), "À explorer");
  // sous 600 px, les thèmes sont des accordéons repliés ; au-delà, dépliés
  assert.ok(L.querySelectorAll("[data-scn-theme]").every(d => !d.hasAttribute("open")));
  v.largeur(768);
  assert.ok(v.root.querySelectorAll("[data-scn-theme]").every(d => d.hasAttribute("open")));
  // cartes : cible de 44 px (CSS) et focus visible
  assert.match(css, /#view-scenarios-view \.scn-carte\{[^}]*min-height:var\(--hit\)/);
  assert.match(css, /#view-scenarios-view \.scn-carte:focus-visible\{outline:2px solid var\(--focus\)/);
});

test("vue (DOM) : ?scenario= ouvre le détail en page sous 900 px (retour en haut à gauche, liste masquée), 500 puis 2 000 tirages ; ?outil= ouvre le simulateur", async () => {
  const v = monter(etatDemo(), { largeur: 390 });
  await attendre();
  v.lien({ scenario: "ouvrir_pea" });
  assert.equal(v.root.querySelector("#scnListe").hidden, true, "page dédiée : la liste laisse la place");
  const Dt = v.root.querySelector("#scnDetail");
  assert.equal(Dt.hidden, false);
  assert.match(sp(Dt.textContent), /Calcul en cours sur ta situation…/);
  await attendre(4);
  await attendre(30);
  const tete = Dt.querySelector(".scn-detail-tete");
  assert.equal(tete.querySelector("[data-scn-retour]").getAttribute("href"), "#pilotage/scenarios", "retour en haut à gauche");
  assert.equal(tete.querySelector("h2").textContent, "Faut-il que j'ouvre un PEA, même petit ?");
  assert.match(sp(Dt.textContent), /2 000 tirages/, "calcul final à 2 000 chemins");
  assert.ok(sous(Dt, ".scn-collant", "[data-scn-vers-claude]"), "« Explorer avec Claude » collé en bas sur la page dédiée");
  assert.deepEqual(blocs(Dt), ["reponse", "comparaison", "changerait", "hypotheses", "donnees", "ajuster", "claude", "pied"]);
  assert.equal(Dt.querySelector('[data-scn-graphe="courbe"]'), null, "PEA versé maintenant : pas de courbe");
  // « Voir les chiffres »
  const b = Dt.querySelector("[data-scn-chiffres]");
  assert.equal(Dt.querySelector(".scn-chiffres").hidden, true);
  b.click();
  assert.equal(Dt.querySelector(".scn-chiffres").hidden, false); assert.equal(b.getAttribute("aria-expanded"), "true");
  // l'outil acheter / louer
  v.lien({ outil: "acheter-louer" });
  assert.equal(v.root.querySelector("#scnBiblio").hidden, true);
  assert.equal(v.root.querySelector("[data-scn-outil]").hidden, false);
  assert.equal(v.root.querySelector("[data-scn-outil-retour]").getAttribute("href"), "#pilotage/scenarios");
  v.lien({});
  assert.equal(v.root.querySelector("#scnBiblio").hidden, false);
  assert.equal(v.root.querySelector("[data-scn-outil]").hidden, true);
  assert.equal(v.root.querySelector("#scnListe").hidden, false);
});

test("vue (DOM) : formulaire — erreurs près des champs sans recalcul, puis « Recalculer » relance Scenarios.jouer avec les réponses (calcul local, rien n'est écrit)", async () => {
  const v = monter(etatDemo(), { largeur: 390 });
  await attendre();
  v.lien({ scenario: "locatif_scpi" });
  await attendre(30);
  const Dt = v.root.querySelector("#scnDetail");
  assert.match(sp(Dt.textContent), /Il manque quelques réponses pour calculer/);
  const champ = id => Dt.querySelector('[data-scn-q="' + id + '"]');
  const saisir = (id, val) => { const el = champ(id); el.value = val; v.dom.changer(el); };
  saisir("prix", "abc");
  Dt.querySelector("[data-scn-recalculer]").click();
  assert.equal(champ("prix").getAttribute("aria-invalid"), "true");
  const err = sous(Dt, '[data-scn-champ="prix"]', ".scn-champ-err");
  assert.equal(err.hidden, false); assert.equal(err.textContent, "Entre un nombre.");
  assert.equal(v.doc.activeElement, champ("prix"), "focus sur le premier champ à corriger");
  assert.match(Dt.querySelector("[data-scn-form-err]").textContent, /Une réponse est à corriger/);
  assert.equal(champ("prix").value, "abc", "la saisie est gardée");
  saisir("prix", "200 000"); saisir("apport", "40000"); saisir("loyer_mensuel", "800"); saisir("charges_annuelles", "2000"); saisir("horizon_ans", "15");
  Dt.querySelector("[data-scn-recalculer]").click();
  await attendre(40);
  const t = sp(Dt.textContent);
  assert.match(t, /La réponse/); assert.doesNotMatch(t, /Il manque/);
  assert.ok(sous(Dt, '[data-scn-graphe="patrimoine"]', "svg"), "patrimoine par année dessiné");
  assert.match(t, /Rendement annuel médian/);
  assert.match(sp(Dt.querySelector('[data-scn-bloc="donnees"]').textContent), /Prix du bien \(hors frais de notaire\)\s?200 000 €\s?ta réponse, 26\/10/, "tes données : la réponse, son origine");
  assert.ok(Dt.querySelector("[data-scn-reinit]"), "« Revenir à tes données »");
  Dt.querySelector("[data-scn-reinit]").click();
  await attendre(10);
  assert.match(sp(Dt.textContent), /Il manque quelques réponses pour calculer/);
});

test("vue (DOM, 1 024 px) : le détail s'ouvre en panneau latéral (560 px) ; Échap ferme et rend le focus à la carte ; retour à la liste", async () => {
  const v = monter(etatDemo(), { largeur: 1024 });
  await attendre();
  const carte = sous(v.root, '[data-scn-theme="epargne"]', '[data-scn-cle="matelas"]');
  carte.focus(); carte.click();
  v.lien({ scenario: "matelas" });
  const dlg = v.doc.body.querySelector('[role="dialog"]');
  assert.ok(dlg && !dlg.hidden, "panneau ouvert");
  assert.ok(dlg.classList.contains("scn-panneau"));
  assert.equal(dlg.querySelector(".ui-panneau-titre").textContent, "Combien garder de côté, et où ?");
  assert.equal(v.root.querySelector("#scnDetail").hidden, true, "pas de détail en ligne");
  assert.equal(v.root.querySelector("#scnListe").hidden, false, "la liste reste visible derrière le voile");
  await attendre(30);
  assert.deepEqual(blocs(dlg.querySelector(".ui-panneau-corps")), ["reponse", "comparaison", "changerait", "hypotheses", "donnees", "ajuster", "claude", "pied"]);
  assert.match(sp(dlg.textContent), /Tu as joué ce scénario le \d\d\/\d\d\/\d{4} \(calcul scn-1\.0\.0\) : retenu\./, "partie jouée montrée à côté");
  v.dom.touche(v.doc.activeElement, "Escape");
  assert.equal(dlg.hidden, true, "Échap ferme le panneau");
  assert.equal(v.doc.activeElement.getAttribute("data-scn-cle"), "matelas", "focus rendu à la carte");
  assert.equal(v.doc.activeElement.getAttribute("data-scn-zone"), "epargne", "la carte d'origine (pas celle de « Pour toi »)");
  assert.deepEqual(v.aller, ["pilotage/scenarios"], "retour à la liste (une entrée d'historique)");
  assert.match(css, /\.ui-panneau\.scn-panneau\{width:min\(560px,100vw\)\}/);
});

test("vue (DOM, 1 440 et 1 680 px) : maître-détail en ligne (hypothèses ouvertes, carte affichée signalée) ; trois zones avec la colonne des hypothèses", async () => {
  const v = monter(etatDemo(), { largeur: 1440 });
  await attendre();
  const Dt = v.root.querySelector("#scnDetail");
  assert.equal(Dt.hidden, false); assert.match(sp(Dt.textContent), /Choisis une question à gauche/);
  v.lien({ scenario: "ouvrir_pea" });
  await attendre(30);
  assert.equal(v.doc.body.querySelector('[role="dialog"]'), null, "aucun panneau");
  assert.equal(v.root.querySelector("#scnListe").hidden, false, "liste et détail côte à côte");
  assert.ok(Dt.querySelector('[data-scn-bloc="hypotheses"]').hasAttribute("open"), "hypothèses ouvertes sur grand écran");
  assert.equal(Dt.querySelector("[data-scn-retour]"), null);
  assert.ok(v.root.querySelectorAll('[data-scn-cle="ouvrir_pea"]').every(a => a.getAttribute("aria-current") === "true"));
  assert.equal(v.root.querySelector(".scn").getAttribute("data-disposition"), "maitre");
  v.largeur(1680);
  await attendre(4);
  const H = v.root.querySelector("#scnHypoCol");
  assert.equal(H.hidden, false);
  assert.ok(H.querySelector('[data-scn-bloc="hypotheses"]'));
  assert.ok(!blocs(Dt).includes("hypotheses"), "les hypothèses passent dans leur colonne");
  assert.deepEqual(blocs(Dt), ["reponse", "comparaison", "changerait", "donnees", "ajuster", "claude", "pied"]);
  // grille du § 10.4
  assert.match(css, /@media \(min-width:1440px\)\{[\s\S]*?#view-scenarios-view \.scn-liste\{grid-column:span 5\}[\s\S]*?#view-scenarios-view \.scn-detail\{grid-column:span 7;/);
  assert.match(css, /@media \(min-width:1680px\)\{[\s\S]*?\.scn-liste\{grid-column:span 4\}[\s\S]*?\.scn-detail\{grid-column:span 5\}[\s\S]*?\.scn-hypo-col\{grid-column:span 3;/);
});

test("vue (DOM) : « Explorer avec Claude » — texte prêt à copier, bouton Copier avec repli par sélection", async () => {
  const v = monter(etatDemo(), { largeur: 1440 });
  await attendre();
  v.lien({ scenario: "matelas" });
  await attendre(30);
  const Dt = v.root.querySelector("#scnDetail"), ta = Dt.querySelector("[data-scn-texte]");
  assert.match(ta.textContent, /^Boussole : joue avec moi le scénario « Combien garder de côté, et où \? » de Boussole \(jouer_scenario\)/);
  assert.ok(ta.hasAttribute("readonly"));
  Dt.querySelector("[data-scn-copier]").click();
  await attendre(2);
  assert.match(Dt.querySelector("[data-scn-copie-msg]").textContent, /sélectionné/, "sans presse-papiers : texte sélectionné, consigne dite");
  let copie = null;
  v.ctx.navigator.clipboard = { writeText: async t => { copie = t; } };
  Dt.querySelector("[data-scn-copier]").click();
  await attendre(2);
  assert.equal(copie, ta.textContent);
  assert.match(Dt.querySelector("[data-scn-copie-msg]").textContent, /Texte copié/);
});

test("vue (DOM) : un repère manquant en production → carte et détail « Chiffres pas encore disponibles », sans chiffre ni plantage", async () => {
  const S = etatDemo(); S.savoir.reperes = S.savoir.reperes.filter(r => r.cle !== "scn_matelas_mois_stable" && r.cle !== "scn_matelas_mois_fragile");
  const v = monter(S, { largeur: 1440 });
  await attendre();
  const c = sous(v.root, '[data-scn-theme="epargne"]', '[data-scn-cle="matelas"]');
  assert.match(sp(c.textContent), /Chiffres pas encore disponibles : un repère manque\./);
  v.lien({ scenario: "matelas" });
  await attendre(20);
  assert.match(sp(v.root.querySelector("#scnDetail").textContent), /Chiffres pas encore disponibles : un repère manque\.\s?Boussole ne donne aucun chiffre plutôt qu'une valeur de remplacement/);
});

test("vue (DOM) : scénario inconnu ; données indisponibles ; chargement (ready faux) sans chiffre", async () => {
  const v = monter(etatDemo(), { largeur: 390 });
  v.lien({ scenario: "inconnu" });
  assert.match(sp(v.root.querySelector("#scnDetail").textContent), /Ce scénario n'est plus dans le catalogue\./);
  const w = monter(etatDemo({ dbOk: false }), { largeur: 390 });
  assert.match(sp(w.root.querySelector("#scnListe").textContent), /Les données ne sont pas disponibles pour le moment/);
  const x = monter(etatDemo({ ready: false }), { largeur: 390 });
  assert.ok(sous(x.root, "#scnListe", ".ui-squelette"));
  assert.doesNotMatch(x.root.querySelector("#scnListe").textContent, /€/);
});

/* ------------------------------------------------------------------ calcul hors du fil principal ------------------------------------------------------------------ */
test("worker : cartes (Scenarios.lister à 500 chemins, questions manquantes) ; jouer par étapes 500 puis 2 000, arrêt à la première étape non calculable", () => {
  const msgs = [];
  W.traiter({ type: "cartes", catalogue: CAT.catalogue, data: D, joues: [], today: TODAY, opts: {} }, m => msgs.push(m));
  assert.equal(msgs.length, 1); assert.equal(msgs[0].type, "cartes");
  const loc = msgs[0].resultat.cartes.find(c => c.cle === "locatif_scpi");
  assert.equal(loc.enjeu_statut, "a_completer");
  assert.deepEqual(loc.manquants_questions.slice(0, 2), ["Prix du bien (hors frais de notaire)", "Apport"]);
  const etapes = [];
  W.traiter({ type: "jouer", entree: entree("ouvrir_pea"), data: D, reponses: { horizon_ans: 8 }, today: TODAY, etapes: [100, 200] }, m => etapes.push([m.etape, m.chemins, m.dernier, m.resultat.chemins]));
  assert.deepEqual(etapes, [[0, 100, false, 100], [1, 200, true, 200]]);
  const ac = [];
  W.traiter({ type: "jouer", entree: entree("locatif_scpi"), data: D, reponses: {}, today: TODAY, etapes: [100, 200] }, m => ac.push(m));
  assert.equal(ac.length, 1); assert.equal(ac[0].dernier, true); assert.equal(ac[0].resultat.statut, "a_completer");
  const er = [];
  W.traiter({ type: "jouer", entree: entree("ouvrir_pea"), data: D, reponses: { inconnue: 1 }, today: TODAY }, m => er.push(m));
  assert.match(er[0].erreur, /réponses invalides/);
  const src = readFileSync("web/src/scenarios-worker.js", "utf8");
  const imp = /importScripts\(([^)]*)\)/.exec(src)[1].match(/"([^"]+)"/g).map(x => x.slice(1, -1));
  assert.deepEqual(imp.slice(-2), ["projection-immo.js", "scenarios.js"], "scénarios chargés après le moteur");
  assert.match(js, /new W\("app\/scenarios-worker\.js"\)/);
  assert.ok(existsSync("web/src/scenarios-worker.js"));
  assert.match(readFileSync("build.mjs", "utf8"), /"scenarios", "scenarios-worker"/, "copié dans dist/app (worker et repli sur le fil principal)");
});

/* ------------------------------------------------------------------ stores ------------------------------------------------------------------ */
const srcW = f => readFileSync("web/src/" + f, "utf8");
function demo(search = "?demo") {
  const ctx = { console, setTimeout, clearTimeout, location: { href: "http://x/app.html" + search, search, hash: "", pathname: "/app.html" },
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ["demo-data.js", "scenarios-catalogue.gen.js", "sensible.js", "routine-etat.js", "banque-etat.js", "store-demo.js"]) vm.runInContext(srcW(f), ctx, { filename: f });
  return ctx;
}
const pret = ctx => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("store jamais prêt")), 2000); const ok = S => { if (S.ready) { clearTimeout(t); res(S); } }; ctx.Store.on(ok); ok(ctx.Store.get()); });

test("démo : catalogue des scénarios et 2 parties jouées (une retenue, une écartée) ; repères des scénarios ajoutés sans écraser ceux de la démo", async () => {
  const ctx = demo(), S = await pret(ctx), D0 = require("../web/src/demo-data.js");
  assert.deepEqual(J(S.scenarios.catalogue.map(e => e.cle)), CAT.catalogue.map(e => e.cle));
  assert.deepEqual(J(ctx.Store.scenarios.catalogue()), J(S.scenarios.catalogue));
  assert.equal(S.scenarios.source, "demo");
  assert.deepEqual(J(S.scenarios.joues.map(j => [j.scenario_cle, j.etat])).sort(), [["av_maintenant", "ecarte"], ["matelas", "retenu"]]);
  for (const j of S.scenarios.joues) assert.ok(CAT.catalogue.some(e => e.cle === j.scenario_cle) && /^\d{4}-\d{2}-\d{2}T/.test(j.joue_le) && j.resultat.reponse.phrase);
  const cles = S.savoir.reperes.map(r => r.cle);
  assert.equal(new Set(cles).size, cles.length, "aucun doublon");
  for (const k of CAT.reperes_scenarios) assert.ok(cles.includes(k), k);
  for (const r of D0.savoir.reperes) assert.deepEqual(J(S.savoir.reperes.find(x => x.cle === r.cle)), J(r), r.cle + " : valeur de la démo gardée");
  const vide = demo("?demo=vide"), Sv = await pret(vide);
  assert.deepEqual(J(Sv.scenarios.joues), [], "démo vide : aucune partie jouée");
  assert.ok(Sv.scenarios.catalogue.length > 0, "le catalogue n'est pas une donnée du foyer");
});

function supa(reponses, aal = "aal2") {
  const appels = [];
  const requete = table => {
    const f = { table };
    const b = { select: () => b, eq: () => b, order: () => b, limit: () => b, gte: () => b, in: () => b, range: () => b, maybeSingle: () => b,
      then: (ok, ko) => { appels.push(table); const r = reponses[table]; return Promise.resolve(typeof r === "function" ? r(f) : r || { data: [], error: null }).then(ok, ko); } };
    return b;
  };
  const avert = [];
  const ctx = { console: { log() {}, error() {}, warn: (...a) => avert.push(a.join(" ")) }, setTimeout, clearTimeout,
    location: { href: "https://x/app.html", search: "", hash: "", pathname: "/app.html" }, document: { readyState: "complete", visibilityState: "visible", addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, BOUSSOLE: { supabaseUrl: "https://x.supabase.co", supabaseKey: "k" } };
  const client = { from: requete, rpc: () => Promise.resolve({ data: null, error: null }), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } };
  ctx.supabase = { createClient: () => client };
  ctx.Auth = { client, session: async () => ({ user: { id: "u1", email: null } }), mfa: { niveau: async () => ({ current: aal, next: aal }) } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ["scenarios-catalogue.gen.js", "sensible.js", "routine-etat.js", "banque-etat.js", "store-supabase.js"]) vm.runInContext(srcW(f), ctx, { filename: f });
  return { ctx, appels, avert };
}
const ABSENTE = { data: null, error: { code: "42P01", message: 'relation "public.scenarios" does not exist' } };

test("store-supabase (faux client) : tables scenarios et scenarios_joues absentes → catalogue embarqué, aucune partie, sans erreur ni avertissement", async () => {
  const { ctx, appels, avert } = supa({ scenarios: ABSENTE, scenarios_joues: ABSENTE });
  const S = await pret(ctx);
  assert.equal(S.dbOk, true); assert.equal(S.error, null, "aucune erreur affichée");
  assert.deepEqual(J(S.scenarios.catalogue.map(e => e.cle)), CAT.catalogue.map(e => e.cle));
  assert.deepEqual(J(S.scenarios.joues), []);
  assert.equal(S.scenarios.source, "embarque");
  assert.ok(appels.includes("scenarios"));
  assert.ok(!appels.includes("scenarios_joues"), "sans catalogue en base, la table des parties n'est pas lue");
  assert.deepEqual(avert.filter(a => /scénarios|parties/.test(a)), [], "table absente : sans bruit");
});

test("store-supabase (faux client) : catalogue publié lu en base, parties jouées sous aal2 seulement ; lecture en échec → embarqué", async () => {
  const ligne = Object.assign({}, CAT.catalogue[0], { id: "11111111-1111-1111-1111-111111111111", statut: "publie", mis_a_jour_le: "2026-10-20", publie_le: "2026-10-20" });
  const joue = { id: "j1", scenario_cle: ligne.cle, scenario_version: 1, version_calcul: "scn-1.0.0", version_modele: "proj-1.4.0", etat: "joue", reponses: {}, resultat: { reponse: { phrase: "x" } },
    enjeu_annuel_p50: "110.5", graine: 1, chemins: 2000, variante_id: null, plan_fige_id: null, source: "Claude", joue_le: "2026-10-12T10:00:00Z", decide_le: null };
  const a = supa({ scenarios: { data: [ligne], error: null }, scenarios_joues: { data: [joue], error: null } });
  const S = await pret(a.ctx);
  assert.equal(S.scenarios.source, "base");
  assert.deepEqual(J(S.scenarios.catalogue.map(e => e.cle)), [ligne.cle]);
  assert.deepEqual(J(S.scenarios.catalogue[0].questions), J(ligne.questions));
  assert.equal(S.scenarios.joues[0].enjeu_annuel_p50, 110.5);
  const b = supa({ scenarios: { data: [ligne], error: null }, scenarios_joues: { data: [joue], error: null } }, "aal1");
  const Sb = await pret(b.ctx);
  assert.deepEqual(J(Sb.scenarios.joues), []); assert.equal(Sb.scenarios.mfaRequise, true);
  const c = supa({ scenarios: { data: null, error: { code: "500", message: "panne" } } });
  const Sc2 = await pret(c.ctx);
  assert.equal(Sc2.scenarios.source, "embarque"); assert.ok(Sc2.scenarios.catalogue.length > 1);
  const s = srcW("store-supabase.js");
  assert.match(s, /sb\.from\("scenarios"\)\.select\(SCN_COLONNES\)\.eq\("statut", "publie"\)/);
  assert.doesNotMatch(s, /from\("scenarios(_joues)?"\)\.(insert|update|upsert|delete)\(/, "aucune écriture");
});

/* ------------------------------------------------------------------ structure, lecture seule, lexique ------------------------------------------------------------------ */
test("scenarios-view.js : se compile, s'enregistre sous « scenarios-view », aucune requête DOM globale ; HTML et CSS scopés, jetons seulement", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "scenarios-view.js" }));
  assert.match(js, /App\.register\("scenarios-view", api\)/);
  assert.deepEqual(js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l)), []);
  for (const id of ["scnBiblio", "scnListe", "scnDetail", "scnHypoCol"]) assert.ok(HTML.includes('id="' + id + '"'), id);
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean).flatMap(s => s.split(",").map(x => x.trim()));
  assert.ok(sels.length > 100);
  assert.deepEqual(sels.filter(x => !/^#view-scenarios-view\b/.test(x) && !/^\.ui-panneau(\.scn-panneau)?( (section)?\.scn-|$)/.test(x)), []);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-fA-F]{3,8}\b(?![-\w])|rgb\(|hsl\(/, "couleurs par jetons du thème (clair et sombre)");
  assert.match(css, /@media \(max-width:599\.98px\)/);
});

test("lecture seule : aucun <form>, aucun envoi, aucune écriture au store ; la vue ne lit que Store.get() par l'App", () => {
  const s = (js + readFileSync("web/src/scenarios-view.html", "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(s, /<form\b|type="submit"|requestSubmit|addEventListener\(\s*["']submit/);
  assert.doesNotMatch(s, /\bStore\s*\.|\.db\s*\.|sb\.from|\.rpc\(/);
});

test("lexique : tutoiement, jamais « conseiller » ni « conseil », aucun nom de produit ni d'établissement, aucune morale", () => {
  const textes = [js, readFileSync("web/src/scenarios-view.html", "utf8"), readFileSync("web/src/scenarios-worker.js", "utf8")].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(textes, /\b(vous|votre|vos)\b/i);
  assert.doesNotMatch(textes, /conseil/i);
  assert.doesNotMatch(textes, /tu devrais|il faut absolument|le meilleur|la meilleure/i);
  assert.doesNotMatch(textes, /\b(Boursorama|BoursoBank|Fortuneo|Linxea|Yomoni|Amundi|BNP|Crédit Agricole|Société Générale|Trade Republic|Corum|Primonial)\b/i);
  const P = require("../web/src/claude-prompts.js");
  assert.equal(P.phrase("scenario", "Faut-il que j'ouvre un PEA, même petit ?"),
    "Boussole : joue avec moi le scénario « Faut-il que j'ouvre un PEA, même petit ? » de Boussole (jouer_scenario), sur mes données, et explique-moi ce qui changerait la réponse. Commence par demarrer_session, puis utilise les formulaires interactifs Boussole plutôt que des questions en texte.");
});
