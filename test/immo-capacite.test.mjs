// IMMO1 : écran « Ta capacité d'emprunt aujourd'hui » (web/src/immo-capacite.*, monté dans Patrimoine › Immobilier et crédits).
// Rendu avec la démo, état indisponible (jamais un chiffre), changement de périmètre, sensibilité identique au moteur, durée avec différé,
// feuille « Comment c'est calculé », aucun « conseiller », tutoiement. Le moteur lui-même est testé dans projection-capacite.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const read = f => readFileSync("web/src/" + f, "utf8");
const js = read("immo-capacite.js"), css = read("immo-capacite.css"), html = read("bilan.html"), bilanJs = read("bilan.js");
const Immo = require("../web/src/projection-immo.js");
const Cap = require("../web/src/immo-capacite.js");
const Fmt = require("../web/src/format.js");
const UI = require("../web/src/ui.js");
const ClaudePrompts = require("../web/src/claude-prompts.js");
const DEMO = require("../web/src/demo-data.js");
const clone = o => JSON.parse(JSON.stringify(o));
const sp = s => String(s).replace(/[  ]/g, " ").replace(/&#39;/g, "'");
const texte = h => sp(String(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
const DEPS = { ProjectionImmo: Immo, UI, ClaudePrompts, Fmt, today: "2026-10-15" };
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b);

const snap = (o = {}) => Object.assign({ ready: true, dbOk: true, scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }],
  positions: clone(DEMO.positions), config: clone(DEMO.config), profil: clone(DEMO.profil), budget: clone(DEMO.budget), classes: clone(DEMO.classes),
  savoir: { fiches: [], reperes: clone(DEMO.savoir.reperes) } }, o);
const sansRepere = (S, re) => Object.assign(S, { savoir: { fiches: [], reperes: S.savoir.reperes.filter(r => !re.test(r.cle)) } });
/** Appel direct du moteur avec les mêmes données et options que l'écran. */
const moteur = (S, etat) => Immo.capaciteEmprunt(Cap.donneesMoteur(S, DEPS.today), Cap.optionsMoteur(S, etat));

/* ------------------------------------------------------------ statique ------------------------------------------------------------ */
test("immo-capacite : se compile, expose ses fonctions, est branché dans bilan, la coque et le build", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "immo-capacite.js" }));
  for (const f of ["calculer", "carteHtml", "indisponibleHtml", "sensibiliteHtml", "feuilleHtml", "optionsMoteur", "donneesMoteur", "libelleTaux", "monter", "rendre"]) assert.equal(typeof Cap[f], "function", f);
  assert.match(html, /id="blCapacite"/); assert.match(html, /Ta capacité d'emprunt aujourd'hui/);
  assert.match(html, /data-slot="capacite-demain"/); assert.doesNotMatch(html, /bientôt/, "l'emplacement « demain » n'est plus réservé : il reçoit le graphe");
  assert.match(html, /data-slot="capacite-demain"[\s\S]*id="icGraphe"[\s\S]*id="icDemainMention"/);
  assert.ok(html.indexOf('id="blCapacite"') < html.indexOf('id="blTuiles"'), "la carte est en tête de la vue");
  assert.match(bilanJs, /ImmoCapacite\.rendre\(S\)/); assert.match(bilanJs, /ImmoCapacite\.monter\(/);
  const build = read("../../build.mjs");
  assert.match(build, /"projection-immo", "immo-capacite"/); assert.match(build, /immo-capacite\.css/);
});
test("immo-capacite : ni « conseiller », ni vouvoiement, ni stockage navigateur, ni écriture au store ; aucune couleur ni taille en dur", () => {
  for (const [nom, src] of [["js", js], ["css", css]]) {
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ""), /conseill(er|ère|ez)|conseil financier/i, nom);
  }
  assert.doesNotMatch(js.replace(/\/\*[\s\S]*?\*\//g, ""), /localStorage|sessionStorage|Store\.|\bvotre\b|\bvos\b|\bvous\b/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgb\(|font-size:\s*\d|font:[^;]*\d+px/i);
});

/* ------------------------------------------------------------ démo : valeurs du moteur ------------------------------------------------------------ */
test("démo : la carte affiche exactement le résultat du moteur (budget, prêt, mensualité, apport, taux daté et sourcé)", () => {
  const S = snap(), v = Cap.calculer(S, null, DEPS), r = moteur(S);
  assert.equal(v.statut, "ok");
  const h = Cap.carteHtml(v, DEPS), t = texte(h);
  assert.match(h, new RegExp('data-ic-budget="' + r.budget_achat + '"'));
  assert.ok(t.includes(texte(Fmt.fmtEUR(Math.round(r.budget_achat / 1000) * 1000))), "budget arrondi au millier");
  assert.ok(t.includes(texte(Fmt.fmtEUR(Math.round(r.montant_empruntable / 1000) * 1000))));
  assert.ok(t.includes(texte(Fmt.fmtEUR(r.mensualite_max))));
  assert.ok(t.includes(texte(Fmt.fmtEUR(Math.round(r.apport.total / 1000) * 1000))));
  assert.match(t, /dont PER/);
  assert.match(t, /Taux du jour 3,35 %/);
  assert.match(t, /taux moyen 25 ans, Observatoire Crédit Logement, août 2026/);
  assert.match(t, /Estimation selon les règles du HCSF, chaque banque décide\. Ce n'est pas une offre de prêt\./);
  assert.match(t, /Ta capacité|Comment c'est calculé/);
  assert.equal(Cap.libelleTaux(r.taux), "taux moyen 25 ans, Observatoire Crédit Logement, août 2026");
  assert.ok(r.budget_achat > 0 && r.montant_empruntable > 0);
});
test("sensibilité : les six valeurs affichées sont celles du moteur, pour le budget comme pour le prêt", () => {
  const S = snap(), r = moteur(S);
  for (const [metrique, cle] of [["budget", "budget_achat"], ["pret", "montant_empruntable"]]) {
    const v = Cap.calculer(S, { metrique }, DEPS), h = Cap.sensibiliteHtml(v, DEPS);
    const cells = [...h.matchAll(/data-ic-sens="(\d+)\|(-?\d+)" data-valeur="([^"]+)"/g)];
    assert.equal(cells.length, 6, metrique);
    for (const [, ans, delta, val] of cells) {
      const s = r.sensibilite.find(x => x.duree_ans === +ans && x.delta_pt === +delta);
      assert.ok(s, ans + "|" + delta);
      assert.equal(+val, s[cle], metrique + " " + ans + "|" + delta);
    }
    assert.match(h, /<caption class="ui-sr">[^<]*(Budget d(&#39;|')achat|Montant emprunté)/);
    assert.equal((h.match(/class="ic-s-c centre actuel"|class="ic-s-c actuel"/g) || []).length, 1, "un seul réglage actuel");
  }
  // colonnes : taux du jour −1, 0, +1 point ; barres sur une base zéro commune (la plus grande valeur = 100 %)
  const h = Cap.sensibiliteHtml(Cap.calculer(S, null, DEPS), DEPS);
  assert.match(texte(h), /2,35 % −1 pt 3,35 % taux du jour 4,35 % \+1 pt/);
  assert.match(h, /width:100\.0%/);
  assert.match(texte(h), /\+14,8 k€/);
});
test("réglages : neuf, primo, durée 20 ans, usage locatif, différé à 27 ans suivent le moteur", () => {
  const S = snap(), base = moteur(S);
  const neuf = Cap.calculer(S, { type: "neuf" }, DEPS), prim = Cap.calculer(S, { type: "primo" }, DEPS);
  assert.equal(neuf.r.budget_achat, base.budget_achat_par_type.neuf); assert.equal(prim.r.budget_achat, base.budget_achat_par_type.primo);
  assert.ok(neuf.r.budget_achat > base.budget_achat);
  const vingt = Cap.calculer(S, { duree: 20 }, DEPS);
  assert.equal(vingt.r.taux.valeur, 3.27); assert.match(Cap.libelleTaux(vingt.r.taux), /taux moyen 20 ans/);
  const loc = Cap.calculer(S, { usage: "locatif" }, DEPS);
  assert.equal(loc.r.apport.per, 0); assert.doesNotMatch(texte(Cap.carteHtml(loc, DEPS)), /dont PER/);
  assert.ok(loc.r.apport.total < base.apport.total);
  const seul = Cap.calculer(S, { duree: 27 }, DEPS);
  assert.equal(seul.r.duree_ans, 25, "27 ans sans projet à différé retombe à 25 ans");
  const vefa = Cap.calculer(S, { duree: 27, projet: "vefa" }, DEPS), ht = texte(Cap.carteHtml(vefa, DEPS));
  assert.equal(vefa.r.duree_ans, 27); assert.equal(vefa.r.differe_ans, 2); assert.equal(vefa.r.duree_amortissement_ans, 25);
  assert.match(ht, /27 ans dont 2 ans de différé : l'amortissement reste limité à 25 ans/);
  assert.equal(Cap.optionsMoteur(S, { duree: 27, projet: "ancien_travaux" }).travaux_pct, 10);
});
test("périmètre : foyer, personne 1 et personne 2 appellent le moteur avec le même périmètre que l'en-tête", () => {
  const S = snap(), f = Cap.calculer(S, null, DEPS), p1 = Cap.calculer({ ...S, scope: "p1" }, null, DEPS), p2 = Cap.calculer({ ...S, scope: "p2" }, null, DEPS);
  assert.equal(f.r.perimetre, "foyer"); assert.equal(p1.r.perimetre, "p1"); assert.equal(p2.r.perimetre, "p2");
  assert.equal(p1.r.montant_empruntable, Immo.capaciteEmprunt(Cap.donneesMoteur(S, DEPS.today), { perimetre: "p1", duree_ans: 25, usage: "rp" }).montant_empruntable);
  assert.notEqual(f.r.montant_empruntable, p1.r.montant_empruntable);
  assert.equal(p1.perimetre.nom, "Camille"); assert.equal(p2.perimetre.nom, "Sam"); assert.equal(f.perimetre.nom, "le foyer");
  proche(p1.r.revenus_retenus.total, 2800, 1e-9); proche(p2.r.revenus_retenus.total, 2300, 1e-9);
});

/* ------------------------------------------------------------ indisponible : jamais un chiffre ------------------------------------------------------------ */
const pasDeChiffre = h => assert.doesNotMatch(texte(h).replace(/Estimation selon[^.]*\.[^.]*\./, ""), /\d/, "aucun chiffre : " + texte(h));
test("indisponible : repères manquants (taux du jour) → ce qui manque, un seul bouton « Compléter avec Claude », aucun montant", () => {
  const S = sansRepere(snap(), /^taux_credit_immo/), v = Cap.calculer(S, null, DEPS);
  assert.equal(v.statut, "indisponible");
  assert.ok(v.manques.some(m => /taux du jour/.test(m.texte)));
  const h = Cap.indisponibleHtml(v, DEPS);
  pasDeChiffre(h);
  assert.match(texte(h), /Je ne peux pas estimer ta capacité d'emprunt/);
  assert.match(texte(h), /Il manque : Le taux du jour des crédits immobiliers/);
  assert.match(texte(h), /Estimation selon les règles du HCSF, chaque banque décide\. Ce n'est pas une offre de prêt\./);
  const liens = [...h.matchAll(/href="https:\/\/claude\.ai\/new\?q=([^"]*)"/g)];
  assert.equal(liens.length, 1); assert.match(h, />Compléter avec Claude</);
  assert.match(sp(decodeURIComponent(liens[0][1].replace(/&amp;/g, "&"))), /^Boussole : aide-moi à renseigner mes biens immobiliers et mes crédits\. Concerne : ma capacité d'emprunt \(il manque : le taux du jour/);
  assert.doesNotMatch(h, /ic-hero|ic-s-table|data-ic-budget/);
});
test("indisponible : plafond HCSF absent, usure absente, durée maximale absente → aucune valeur de secours", () => {
  for (const re of [/^hcsf_taux_effort$/, /^taux_usure/, /^hcsf_duree_max$/, /^frais_acquisition/, /^assurance_emprunteur/]) {
    const v = Cap.calculer(sansRepere(snap(), re), null, DEPS);
    assert.equal(v.statut, "indisponible", String(re));
    assert.ok(v.manques.length >= 1, String(re));
    pasDeChiffre(Cap.indisponibleHtml(v, DEPS));
  }
  const dur = Cap.calculer(sansRepere(snap(), /^hcsf_duree_max$/), null, DEPS);
  assert.ok(dur.manques.some(m => /durée maximale/.test(m.texte)), "la durée maximale est nommée même si le moteur ne la liste pas dans manquants");
});
test("indisponible : pas de profil ou aucun revenu → « tes revenus » à compléter, avec la phrase « revenus » de ClaudePrompts", () => {
  const sans = Cap.calculer(snap({ profil: null }), null, DEPS);
  assert.equal(sans.statut, "indisponible"); assert.equal(sans.manques[0].nature, "profil");
  const S = snap(); S.profil.personnes.p1.salaire = 0; S.profil.personnes.p2.salaire = 0;
  const zero = Cap.calculer(S, null, DEPS);
  assert.equal(zero.statut, "indisponible"); assert.match(zero.manques[0].texte, /revenus nets/);
  const h = Cap.indisponibleHtml(zero, DEPS);
  pasDeChiffre(h);
  assert.match(decodeURIComponent(h.match(/claude\.ai\/new\?q=([^"]*)"/)[1].replace(/&amp;/g, "&")), /^Boussole : aide-moi à compléter mes revenus\. Concerne : mes revenus nets/);
  const p2 = snap({ scope: "p2" }); p2.profil.personnes.p2.salaire = 0;
  assert.match(Cap.calculer(p2, null, DEPS).manques[0].texte, /revenus nets de Sam/);
});
test("repères hors sujet (inflation, hausse des salaires) : leur absence ne rend pas la capacité indisponible", () => {
  const v = Cap.calculer(sansRepere(snap(), /^(inflation_hypothese|salaire_croissance_reelle)$/), null, DEPS);
  assert.equal(v.statut, "ok");
});
test("taux à actualiser et dépassement du taux d'usure sont signalés (puce, phrase), jamais passés sous silence", () => {
  const vieux = Cap.calculer(snap(), null, { ...DEPS, today: "2026-11-20" });
  assert.equal(vieux.statut, "ok"); assert.match(Cap.carteHtml(vieux, DEPS), /data-ic-alerte="taux"[^>]*>[\s\S]*Taux à actualiser/);
  const S = snap(); S.savoir.reperes.find(r => r.cle === "taux_usure_20_plus").valeur = 3.5;
  const u = Cap.calculer(S, null, DEPS);
  assert.equal(u.r.usure.depasse, true);
  assert.match(texte(Cap.carteHtml(u, DEPS)), /dépasse le taux d'usure/);
  assert.match(Cap.feuilleHtml(u, S, DEPS), /data-ic-f-usure="depasse"/);
});

/* ------------------------------------------------------------ feuille ------------------------------------------------------------ */
test("feuille « Comment c'est calculé » : revenus, charges, taux d'effort, assurance, TAEG et usure, reste à vivre, frais, apport par enveloppe, sources datées, mention", () => {
  const S = snap(), v = Cap.calculer(S, null, DEPS), r = v.r, h = Cap.feuilleHtml(v, S, DEPS), t = texte(h);
  for (const titre of ["Revenus retenus", "Charges et mensualité maximale", "Assurance emprunteur", "Du prêt au budget d'achat", "TAEG estimé et taux d'usure", "Reste à vivre", "Apport mobilisable, par enveloppe", "Sources", "À savoir"])
    assert.ok(t.includes(titre), titre);
  assert.match(t, /Salaire net de Camille 2 800 €\/mois/); assert.match(t, /Total retenu 5 100 €\/mois/);
  assert.match(t, /Crédits en cours \(assurance comprise\) 1 030 €\/mois/);
  assert.match(t, /35 % × 5 100 € − 1 030 € 755 €\/mois/);
  assert.match(t, /Taux annuel sur le capital 0,30 %/); assert.match(t, /Taux supposé/);
  assert.ok(t.includes("TAEG estimé " + texte(Fmt.fmtPct(r.taeg_estime, { decimales: 2 }))));
  assert.match(t, /Taux d'usure \(20 ans et plus\) 5,40 %/); assert.match(h, /data-ic-f-usure="ok"/);
  assert.match(t, /Frais de dossier 1 000 €/); assert.match(t, /Garantie du prêt \(1 %\)/); assert.match(t, /Frais d'acquisition \(8 %, ancien\)/);
  assert.ok(t.includes("= Budget d'achat " + texte(Fmt.fmtEUR(r.budget_achat))));
  // l'équation tient : prêt + apport − garantie − dossier − frais d'acquisition = budget
  const frais = r.montant_empruntable + r.apport.total - r.frais.garantie - r.frais.dossier - r.budget_achat;
  proche(frais, r.budget_achat * r.frais.acquisition_pct / 100, 1e-6);
  proche(r.revenus_retenus.total - r.charges - r.mensualite_nouvelle, r.reste_a_vivre, 1e-6);
  assert.ok(t.includes("= Il te resterait " + texte(Fmt.fmtEUR(r.reste_a_vivre))));
  // apport : une ligne par enveloppe (regroupée), impôts et net, matelas exclu, PER à part
  const lignes = [...h.matchAll(/<tr><th scope="row">([^<]*)/g)].map(m => m[1].trim());
  assert.equal(new Set(lignes).size, lignes.length, "enveloppes regroupées");
  assert.ok(lignes.some(l => /Assurance vie Sam/.test(l))); assert.match(h, /résidence principale<\/span>/);
  assert.match(t, new RegExp("Matelas de précaution exclu : " + texte(Fmt.fmtEUR(r.apport.matelas_exclu))));
  // sources : titres, liens https, dates de vérification
  assert.match(h, /href="https:\/\/lobservatoire\.creditlogement\.fr[^"]*" target="_blank" rel="noopener noreferrer"/);
  assert.match(t, /taux 25 ans \(août 2026\)/); assert.match(t, /vérifié le \d+ \S+ 2026/);
  assert.match(h, /data-ic-mention>Estimation selon les règles du HCSF, chaque banque décide\. Ce n&#39;est pas une offre de prêt\./);
  assert.doesNotMatch(t, /conseill/i);
  assert.match(sp(Cap.questionClaude(v, DEPS)), /^Dans Boussole, ma capacité d'emprunt est estimée à un budget d'achat d'environ 186 000 €/);
});
test("échappement : un nom d'enveloppe piégé est inerte dans la feuille", () => {
  const S = snap(), PIEGE = '<img src=x onerror="alert(1)">';
  S.positions[0].envelope = PIEGE;
  const v = Cap.calculer(S, null, DEPS), h = Cap.feuilleHtml(v, S, DEPS);
  assert.doesNotMatch(h, /<img src=x/);
});

/* ------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------ */
function vue(S, o = {}) {
  const dom = miniDom(), { doc } = dom, modules = {};
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, CSS: { escape: s => String(s) } };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.App = { register: (n, api) => { modules[n] = api; } };
  vm.createContext(ctx);
  const avant = ["calc.js", "plan.js", "reperes.js", "calendrier.js", "marche.js", "format.js", "ui.js", "claude-prompts.js", "routine-etat.js", "projection-outils.js", "projection-credit.js",
    "projection-fiscalite.js", "projection-evenements.js", "projection-donnees.js"];
  for (const f of avant.concat(o.projection ? ["projection.js"] : [], ["projection-immo.js"])) vm.runInContext(read(f), ctx, { filename: f });
  if (o.avant) o.avant(ctx);
  for (const f of ["immo-capacite.js", "bilan.js"]) vm.runInContext(read(f), ctx, { filename: f });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.setAttribute("id", "view-bilan"); root.innerHTML = html;
  const api = modules.bilan; api.mount(root); api.update(S, true);
  return { dom, doc, root, api, ctx, $: id => root.querySelector("#" + id) };
}
/** Faux graphe maître : enregistre les branchements (élément, options) et les appels de la liaison, sans dessiner. */
function fauxGM() {
  const gm = { liaisons: [], appels: [] };
  gm.brancher = (el, opts) => {
    const reglages = Object.assign({ duree: 25, neuf: false, primo: false }, opts.reglages), L = { el, opts, snaps: [], patchs: [], detruite: false };
    L.reglages = () => reglages;
    L.actualiser = S => { L.snaps.push(S); gm.appels.push("actualiser"); };
    L.definir = p => { Object.assign(reglages, p); L.patchs.push(p); gm.appels.push("definir"); };
    L.detruire = () => { L.detruite = true; };
    gm.liaisons.push(L); return L;
  };
  return gm;
}
test("vue (DOM) : la carte est rendue en tête de Patrimoine › Immobilier, bascules et feuille", () => {
  const v = vue(snap());
  assert.equal(v.$("blCorps").hidden, false);
  assert.equal(v.$("icPerimetre").textContent, "Calculée pour le foyer.");
  assert.ok(v.$("icCorps").querySelector(".ic-grille"), "carte du moteur");
  assert.equal(v.$("icCorps").querySelectorAll("[data-ic-sens]").length, 6);
  assert.equal(v.$("icType").querySelectorAll('[role="radio"]').length, 3);
  assert.equal(v.$("icDuree").querySelectorAll('[role="radio"]').length, 2, "20 et 25 ans seulement hors différé");
  assert.equal(v.$("icMetrique").querySelectorAll('[role="radio"]').length, 2);
  // neuf : le budget suit le moteur
  const neuf = v.$("icType").querySelector('[data-ui-id="neuf"]'); neuf.click();
  const r = Immo.capaciteEmprunt(Cap.donneesMoteur(snap(), "2026-10-15"), { perimetre: "foyer", duree_ans: 25, neuf: true, usage: "rp" });
  assert.equal(+v.$("icCorps").querySelector("[data-ic-budget]").getAttribute("data-ic-budget"), r.budget_achat);
  assert.equal(v.$("icType").querySelector('[aria-checked="true"]').getAttribute("data-ui-id"), "neuf");
  // projet à différé : l'option 27 ans apparaît ; durée 27 → différé de 2 ans
  v.$("icProjet").querySelector('[data-ui-id="vefa"]').click();
  assert.equal(v.$("icDuree").querySelectorAll('[role="radio"]').length, 3);
  v.$("icDuree").querySelector('[data-ui-id="27"]').click();
  assert.match(v.$("icCorps").textContent.replace(/\s+/g, " "), /27 ans dont 2 ans de différé/);
  v.$("icProjet").querySelector('[data-ui-id="standard"]').click();
  assert.equal(v.$("icDuree").querySelectorAll('[role="radio"]').length, 2); assert.equal(v.$("icDuree").querySelector('[aria-checked="true"]').getAttribute("data-ui-id"), "25");
  // feuille : bouton → panneau en lecture, Échap ferme
  const b = v.root.querySelector("[data-ic-feuille]"); b.focus(); b.click();
  const pan = v.doc.body.querySelector(".ui-panneau");
  assert.ok(pan, "panneau ouvert"); assert.match(pan.textContent, /Comment c'est calculé/); assert.match(pan.textContent, /Revenus retenus/);
  assert.match(pan.querySelector(".ui-panneau-pied").innerHTML, /claude\.ai\/new\?q=/);
});
test("vue (DOM) : changement de périmètre → la carte suit (Camille, puis Sam, puis le foyer)", () => {
  const v = vue(snap());
  const budget = () => +v.$("icCorps").querySelector("[data-ic-budget]").getAttribute("data-ic-budget");
  const foyer = budget();
  v.api.update(snap({ scope: "p1" }), true);
  assert.equal(v.$("icPerimetre").textContent, "Calculée pour Camille.");
  const p1 = budget(); assert.notEqual(p1, foyer);
  v.api.update(snap({ scope: "p2" }), true);
  assert.equal(v.$("icPerimetre").textContent, "Calculée pour Sam.");
  assert.notEqual(budget(), p1);
  v.api.update(snap({ scope: "foyer" }), true);
  assert.equal(budget(), foyer);
});
test("vue (DOM) : indisponible → ce qui manque et un seul bouton Claude, puis la carte revient quand les repères arrivent", () => {
  const v = vue(sansRepere(snap(), /^taux_usure/));
  assert.ok(v.$("icCorps").querySelector("[data-ic-indisponible]"));
  assert.equal(v.$("icCorps").querySelectorAll("[data-ic-manque]").length >= 1, true);
  assert.equal((v.$("icCorps").innerHTML.match(/claude\.ai\/new/g) || []).length, 1);
  assert.doesNotMatch(v.$("icCorps").textContent, /\d{2,}\s*€/);
  assert.ok(v.$("blCapacite").querySelector('[data-slot="capacite-demain"]'), "l'emplacement « demain » reste affiché");
  v.api.update(snap(), true);
  assert.ok(v.$("icCorps").querySelector(".ic-grille"));
});
test("vue (DOM) : aucun mot « conseiller » dans le HTML rendu (carte, indisponible, feuille)", () => {
  const S = snap(), tout = Cap.carteHtml(Cap.calculer(S, null, DEPS), DEPS) + Cap.indisponibleHtml(Cap.calculer(sansRepere(snap(), /^taux_credit/), null, DEPS), DEPS) + Cap.feuilleHtml(Cap.calculer(S, null, DEPS), S, DEPS);
  assert.doesNotMatch(tout, /conseill/i);
});

/* ------------------------------------------------------------ « Ta capacité demain » : le graphe maître en mode capacité ------------------------------------------------------------ */
const jsn = o => JSON.parse(JSON.stringify(o)); // objets du contexte vm : prototype différent
const vueGM = (S, o = {}) => { const gm = fauxGM(); const v = vue(S, Object.assign({ avant: ctx => { ctx.GrapheModele = gm; } }, o)); v.gm = gm; return v; };

test("demain (DOM) : le slot n'est plus « bientôt » et reçoit le graphe maître en mode capacité, branché une seule fois", () => {
  const v = vueGM(snap()), L = v.gm.liaisons;
  const slot = v.$("blCapacite").querySelector('[data-slot="capacite-demain"]');
  assert.ok(slot, "emplacement présent"); assert.doesNotMatch(slot.textContent, /bientôt/);
  assert.equal(L.length, 1);
  assert.equal(L[0].el, v.$("icGraphe"), "le graphe est monté dans l'emplacement");
  assert.equal(L[0].opts.preset, "capacite");
  assert.equal(L[0].opts.perimetre(), "du foyer");
  assert.match(L[0].opts.today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(L[0].opts.deps.UI, v.ctx.UI);
  assert.equal(L[0].snaps.length, 1); assert.equal(L[0].snaps[0].scope, "foyer");
  assert.equal(v.$("icGraphe").hidden, false);
  assert.equal(v.$("icDemainIndispo").hidden, true);
  // une émission du store (même état) ne rebranche pas : le graphe est actualisé, c'est lui qui décide de recalculer
  v.api.update(snap(), true);
  assert.equal(L.length, 1); assert.equal(L[0].snaps.length, 2);
  // rien n'est enregistré : aucune option de stockage passée au graphe
  assert.equal(L[0].opts.store, undefined);
});
test("demain (DOM) : le graphe suit le périmètre de l'en-tête (foyer, Camille, Sam)", () => {
  const v = vueGM(snap()), L = v.gm.liaisons[0];
  v.api.update(snap({ scope: "p1" }), true);
  assert.equal(L.opts.perimetre(), "de Camille"); assert.equal(L.snaps.at(-1).scope, "p1");
  v.api.update(snap({ scope: "p2" }), true);
  assert.equal(L.opts.perimetre(), "de Sam"); assert.equal(L.snaps.at(-1).scope, "p2");
  v.api.update(snap({ scope: "foyer" }), true);
  assert.equal(L.opts.perimetre(), "du foyer");
  assert.equal(v.gm.liaisons.length, 1, "un seul graphe pour tous les périmètres");
});
test("demain (DOM) : le graphe suit le type de bien et la durée de la carte (ancien, neuf, primo ; 20 / 25 ans)", () => {
  const v = vueGM(snap()), L = v.gm.liaisons[0];
  assert.deepEqual(jsn(L.reglages()), { duree: 25, neuf: false, primo: false });
  v.$("icType").querySelector('[data-ui-id="neuf"]').click();
  assert.deepEqual(jsn(L.patchs.at(-1)), { duree: 25, neuf: true, primo: false });
  v.$("icType").querySelector('[data-ui-id="primo"]').click();
  assert.deepEqual(jsn(L.patchs.at(-1)), { duree: 25, neuf: false, primo: true });
  v.$("icDuree").querySelector('[data-ui-id="20"]').click();
  assert.deepEqual(jsn(L.patchs.at(-1)), { duree: 20, neuf: false, primo: true });
  v.$("icType").querySelector('[data-ui-id="ancien"]').click();
  assert.deepEqual(jsn(L.patchs.at(-1)), { duree: 20, neuf: false, primo: false });
  // 27 ans (différé) : le graphe n'a que 20 et 25 ans, il reste à 25
  v.$("icProjet").querySelector('[data-ui-id="vefa"]').click();
  v.$("icDuree").querySelector('[data-ui-id="27"]').click();
  assert.equal(L.reglages().duree, 25);
  // un rendu sans changement de réglage ne rappelle pas definir (pas de recalcul inutile)
  const n = L.patchs.length; v.api.update(snap(), true);
  assert.equal(L.patchs.length, n);
  // l'état du store est rendu au graphe AVANT le changement de réglage (le calcul part de l'état courant)
  assert.equal(v.gm.appels.indexOf("actualiser") < v.gm.appels.indexOf("definir"), true);
});
test("demain (DOM) : carte indisponible → le graphe n'est pas monté ; état honnête « Ta capacité demain » avec ce qui manque et « Compléter avec Claude »", () => {
  const v = vueGM(sansRepere(snap(), /^taux_usure/));
  assert.equal(v.gm.liaisons.length, 0, "aucun graphe ni aucun chiffre sans capacité d'aujourd'hui");
  const slot = v.$("blCapacite").querySelector('[data-slot="capacite-demain"]'), ind = v.$("icDemainIndispo");
  assert.equal(ind.hidden, false); assert.equal(v.$("icGraphe").hidden, true);
  const t = sp(slot.textContent).replace(/\s+/g, " ");
  assert.match(t, /Ta capacité demain/); assert.match(t, /Il manque/); assert.match(t, /taux d'usure/);
  assert.doesNotMatch(t, /\d{2,}\s*€/, "aucun montant");
  assert.ok(ind.querySelectorAll("[data-ic-manque]").length >= 1);
  const liens = ind.innerHTML.match(/claude\.ai\/new\?q=[^"]*/g) || [];
  assert.equal(liens.length, 1); assert.match(decodeURIComponent(liens[0]), /Boussole/);
  assert.match(ind.innerHTML, /Compléter avec Claude/);
  // la capacité d'aujourd'hui revient → le graphe se monte ; elle repart → il est détruit
  v.api.update(snap(), true);
  assert.equal(v.gm.liaisons.length, 1); assert.equal(v.$("icDemainIndispo").hidden, true); assert.equal(v.$("icGraphe").hidden, false);
  v.api.update(sansRepere(snap(), /^taux_usure/), true);
  assert.equal(v.gm.liaisons[0].detruite, true); assert.equal(v.$("icDemainIndispo").hidden, false);
  v.api.update(snap(), true);
  assert.equal(v.gm.liaisons.length, 2, "nouveau graphe, l'ancien est détruit");
});
test("demain (DOM) : sans revenus (profil absent), l'état dit les revenus et propose Claude, sans graphe", () => {
  const S = snap(); S.profil = null;
  const v = vueGM(S);
  assert.equal(v.gm.liaisons.length, 0);
  const t = sp(v.$("icDemainIndispo").textContent).replace(/\s+/g, " ");
  assert.match(t, /revenus/); assert.match(v.$("icDemainIndispo").innerHTML, /Compléter avec Claude/);
});
test("demain : la mention fixe est sous le graphe (texte du HCSF), pas sous l'état indisponible ; tutoiement ; aucun conseil", () => {
  const v = vueGM(snap());
  assert.equal(v.$("icDemainMention").textContent.trim(), Cap.MENTION);
  assert.equal(v.$("icDemainMention").hidden, false);
  const w = vueGM(sansRepere(snap(), /^taux_usure/));
  assert.equal(w.$("icDemainMention").hidden, true, "la mention est déjà dans l'état indisponible de la carte");
  const html = Cap.demainIndisponibleHtml(Cap.calculer(sansRepere(snap(), /^taux_credit/), null, DEPS), DEPS);
  assert.doesNotMatch(texte(html), /\b(vous|votre|vos)\b/i); assert.doesNotMatch(texte(html), /conseill/i);
  assert.match(texte(html), /\b(tu|ta|tes|ton)\b/i);
});
test("demain : lecture seule — le code ne touche ni au stockage navigateur ni au store, et ne passe aucun store au graphe", () => {
  const src = js.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|Store\b|\.doc\(|\.collection\(|\.upsert\(|fetch\(/);
  assert.match(src, /preset:\s*"capacite"/);
});
test("demain : CSS mobile d'abord — l'emplacement et le graphe ne dépassent jamais la carte (min-width 0, pas de largeur fixe)", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(c, /\.ic-demain\{[^}]*min-width:0/);
  assert.match(c, /\.ic-demain-graphe\{[^}]*min-width:0/);
  for (const m of c.matchAll(/\.ic-demain[^{]*\{([^}]*)\}/g)) assert.doesNotMatch(m[1], /(^|;)\s*(min-)?width:\s*\d+px/, "pas de largeur fixe : " + m[0]);
  assert.match(c, /\.ic-demain-indispo[^{]*\{[^}]*\}/);
});

/* Données réelles de bout en bout : Projection.capaciteDansLeTemps via GrapheModele.brancher, composant remplacé par un double qui enregistre ses données. */
function vueGMReel(S) {
  const rec = { monte: 0, donnees: [], patchs: [] };
  const faux = { PRESETS: { capacite: { vue: "financier", mode: "capacite" } }, monter(el, o) {
    rec.monte++;
    let r = Object.assign({ duree: 25, neuf: false, primo: false }, o.reglages);
    const ctl = { mettreAJour: d => rec.donnees.push(d), reglages: () => r,
      reglagesAppliques(p) { rec.patchs.push(p); r = Object.assign({}, r, p); Promise.resolve(o.surReglages(r)).then(d => { if (d) ctl.mettreAJour(d); }); }, detruire() {} };
    return ctl;
  } };
  const v = vue(S, { projection: true, avant: ctx => { ctx.GraphePatrimoine = faux; vm.runInContext(read("graphe-modele.js"), ctx, { filename: "graphe-modele.js" }); } });
  v.rec = rec; return v;
}
test("demain (bout en bout, démo) : le moteur répond « pret » en mode capacité avec phrase et mention ; périmètre, type et durée recalculent", async () => {
  const v = vueGMReel(snap());
  assert.equal(v.rec.monte, 1);
  const d = v.rec.donnees.at(-1);
  assert.equal(d.mode, "capacite"); assert.equal(d.etat, "pret"); assert.equal(d.perimetre, "du foyer");
  assert.match(d.phrase, /^En \d{4}, budget d'achat médian/); assert.ok(d.capacite_demain.mois.length >= 2);
  assert.ok(d.mention && /HCSF/.test(d.mention)); assert.equal(d.capacite_demain.duree_ans, 25);
  const n = v.rec.donnees.length;
  v.api.update(snap({ scope: "p1" }), true);
  assert.equal(v.rec.donnees.length, n + 1, "périmètre changé → nouveau calcul"); assert.equal(v.rec.donnees.at(-1).perimetre, "de Camille");
  v.api.update(snap({ scope: "p1" }), true);
  assert.equal(v.rec.donnees.length, n + 1, "même état → pas de recalcul");
  v.$("icDuree").querySelector('[data-ui-id="20"]').click();
  assert.deepEqual(jsn(v.rec.patchs.at(-1)), { duree: 20, neuf: false, primo: false });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(v.rec.donnees.at(-1).capacite_demain.duree_ans, 20, "le graphe est recalculé pour 20 ans");
});
test("demain (bout en bout) : si le moteur répond « vide », la raison est portée par les données, sans aucun chiffre", () => {
  const GM = require("../web/src/graphe-modele.js"), P = require("../web/src/projection.js");
  const S = snap(); S.savoir = { fiches: [], reperes: [] };
  const d = GM.calculerCapacite(S, GM.reglagesParDefaut({ vue: "financier" }), { today: "2026-10-15", deps: { Projection: P }, perimetre: "du foyer" });
  assert.equal(d.etat, "vide"); assert.match(d.raison, /repère manquant/); assert.equal(d.capacite_demain, undefined);
});
