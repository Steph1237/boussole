// Compte › Données (web/src/profil.*) : profil du foyer en LECTURE SEULE (spec 2026-10-11-saisie-par-agent). Sections en accordéons
// avec résumé dans le titre, contenu en lecture (« non renseigné » sinon), « Compléter avec Claude » par section, lien profond
// ?section=… ; aucun formulaire, aucune écriture au store ; protection lue sous ses deux formes (foyer et par personne) ; tutoiement.
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
const js = read("web/src/profil.js"), html = read("web/src/profil.html"), css = read("web/src/profil.css");
const P = require("../web/src/profil.js");
const Calc = require("../web/src/calc.js");
const UI = require("../web/src/ui.js");
const ClaudePrompts = require("../web/src/claude-prompts.js");
const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const eur = v => nf.format(v) + " €";
const sp = s => String(s).replace(/[  ]/g, " ").replace(/&#39;/g, "'");
const attendre = () => new Promise(r => setTimeout(r, 0));
/* Tutoiement : aucun « vous / votre / vos » ; les textes venant des moteurs (calc.js : manquants) sont listés en exception. */
const EXCEPTIONS_MOTEUR = [];
const VOUVOIEMENT = /\b(vous|votre|vos)\b/i;
const sansExceptions = t => EXCEPTIONS_MOTEUR.reduce((a, e) => a.split(e).join(""), String(t));
/* Questions des liens « … avec Claude » (href décodé). */
const questions = h => [...String(h).matchAll(/href="https:\/\/claude\.ai\/new\?q=([^"]*)"/g)].map(m => sp(decodeURIComponent(m[1].replace(/&amp;/g, "&"))));

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

test("données : s'enregistre, chiffre clé inchangé, se compile", () => {
  assert.match(js, /App\.register\("profil", api\)/);
  assert.match(js, /return S\.profil \? completude\(S\)\.pourcentage \+ " % rempli" : "À remplir";/, "chiffre clé : la complétude du bilan (BilanEtat)");
  assert.doesNotThrow(() => new vm.Script(js, { filename: "profil.js" }));
});

test("données : lecture seule — aucun formulaire, aucun brouillon, aucune écriture au store, plus de dialogue « Remplir avec mon assistant »", () => {
  const code = sansCommentaires(js);
  assert.doesNotMatch(code, /Store|\.db\b|db\.doc|\.set\(|\.update\(|\.upsert\(|\.delete\(/, "aucun accès en écriture au store");
  assert.doesNotMatch(code, /Assistant|\.prompt\(|\.parse\(|\.merge\(|showModal|clipboard/, "plus de remplissage par copier-coller");
  assert.doesNotMatch(code, /\bdraft\b|brouillon|normalize|valeurSeg|\bsave\(/i, "plus de brouillon ni d'enregistrement");
  for (const src of [js, html]) {
    assert.doesNotMatch(src, /<form|<input|<textarea|<select|<dialog|contenteditable/);
    assert.doesNotMatch(src, /Remplir avec mon assistant|Enregistrer le profil|Annuler les modifications|Ajouter un bien|Ajouter un crédit|data-pf-add|data-pf-del|data-seg/);
  }
  for (const id of ["pfAssistBtn", "pfSubmit", "pfCancel", "pfMsgs", "pfSave", "pfAssist"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`), id + " retiré");
  assert.doesNotMatch(css, /pf-save|pf-dialog|pf-row|\.money|pf-field/, "styles de saisie retirés");
  assert.equal(P.normalize, undefined);
  assert.equal(P.valeurSeg, undefined);
  assert.match(js, /ClaudePrompts/);
  assert.match(js, /"Compléter avec Claude"/);
});

test("données : six sections en accordéons fermés, résumé dans chaque titre, contenu en lecture et « Compléter avec Claude » par section", () => {
  const secs = [...html.matchAll(/<details class="ui-acc pf-sec" id="pf-sec-(\w+)" data-pf-sec="(\w+)">/g)].map(m => m[1]);
  assert.deepEqual(secs, ["foyer", "revenus", "biens", "credits", "protection", "autres"]);
  assert.deepEqual(P.SECTIONS.map(s => s.id), secs);
  assert.doesNotMatch(html, /<details[^>]*\sopen/, "rien n'est déplié d'office");
  for (const k of ["Foyer", "Revenus", "Biens", "Credits", "Protection", "Autres"])
    for (const p of ["pfRes", "pfLu", "pfClaude"]) assert.match(html, new RegExp(`id="${p}${k}"`), p + k);
  for (const id of ["pfPct", "pfBar", "pfMissing", "pfRecap"]) assert.match(html, new RegExp(`id="${id}"`), id);
  for (const t of [">Foyer<", ">Revenus<", ">Biens immobiliers<", ">Crédits<", ">Protection<", ">Autres biens<"]) assert.ok(html.includes(t), t);
  assert.match(html, /formulaires interactifs/, "la page explique que la saisie se fait avec Claude");
  assert.match(html, /data-goto="agent\/propositions"/);
});

test("« Compléter avec Claude » : phrase de l'agent par section (ClaudePrompts.phrase), bilan pour l'en-tête", () => {
  assert.equal(P.phraseSection("foyer"), ClaudePrompts.phrase("foyer"));
  assert.equal(P.phraseSection("revenus"), ClaudePrompts.phrase("revenus"));
  assert.equal(P.phraseSection("protection"), ClaudePrompts.phrase("protection"));
  assert.equal(P.phraseSection("biens"), ClaudePrompts.phrase("immobilier", "mes biens immobiliers et leurs prêts"));
  assert.match(P.phraseSection("credits"), /^Boussole : aide-moi à renseigner mes biens immobiliers et mes crédits\. Concerne : mes crédits \(prêts immobiliers, auto, consommation, travaux\)/);
  assert.match(P.phraseSection("autres"), /Concerne : mes autres biens \(voiture, meubles, parts d'entreprise\)\./);
  assert.equal(P.phraseSection(null), ClaudePrompts.phrase("bilan"));
  for (const s of P.SECTIONS) {
    const h = P.claudeHtml(s.id, UI);
    assert.match(h, /class="ui-claude"/);
    assert.match(h, /<span>Compléter avec Claude<\/span>/);
    assert.deepEqual(questions(h), [sp(P.phraseSection(s.id))]);
  }
  assert.equal(P.claudeHtml("foyer", null), "", "sans UI : rien");
});

test("résumés : foyer, revenus, biens, crédits, protection, autres (démo et cas limites)", () => {
  const pr = demo().profil;
  assert.equal(P.resumeFoyer(pr), "2 adultes, 1 enfant, TMI 30 %");
  assert.equal(P.resumeFoyer({ foyer: { adultes: 1, enfants: 0, tmi: null } }), "1 adulte, sans enfant, TMI à renseigner");
  assert.equal(P.resumeFoyer({ foyer: { adultes: 3, enfants: 4, tmi: 0 } }), "3 adultes ou plus, 4 enfants ou plus, TMI 0 %");
  assert.equal(P.resumeFoyer(null), "taille du foyer à renseigner, sans enfant, TMI à renseigner");

  assert.equal(P.resumeRevenus(pr, Calc), eur(Calc.revenusFoyer(pr, "foyer")) + "/mois nets");
  assert.equal(P.resumeRevenus(null, Calc), "salaire à renseigner");
  assert.equal(P.resumeRevenus({ foyer: { adultes: 2 }, personnes: {} }, Calc), "salaires à renseigner");
  const sansSam = JSON.parse(JSON.stringify(pr)); sansSam.personnes.p2.salaire = null;
  assert.match(P.resumeRevenus(sansSam, Calc), /\/mois nets · salaire de Sam à renseigner$/);

  assert.equal(P.resumeBiens(pr), "1 bien, " + eur(240000));
  assert.equal(P.resumeBiens({ biens: [] }), "aucun");
  assert.equal(P.resumeBiens({ biens: [{ valeur: 100000 }, { valeur: "50000" }] }), "2 biens, " + eur(150000));

  assert.equal(P.resumeCredits(pr), "2 crédits, dont 1 prêt immobilier, " + eur(156500) + " restants, " + eur(1030) + "/mois", "tous les crédits en cours, prêt immobilier compris (comme Patrimoine › Immobilier et crédits)");
  assert.equal(P.resumeCredits({ credits: [{ nom: "Auto", crd: 6500, mensualite: 210 }] }), "1 crédit, " + eur(6500) + " restants, " + eur(210) + "/mois");
  assert.equal(P.resumeCredits({ credits: [] }), "aucun");
  assert.equal(P.resumeCredits({ credits: [], biens: [{ crd: 1000 }] }), "1 crédit, dont 1 prêt immobilier, " + eur(1000) + " restants, " + eur(0) + "/mois");

  assert.equal(P.resumeAutres(pr), eur(15000));
  assert.equal(P.resumeAutres({ foyer: { adultes: 1 }, autres: { p1: { usage: 0 }, p2: { usage: 9000 } } }), "aucun", "une seule personne : p2 ignorée");
  assert.deepEqual(Object.keys(P.resumes(pr, Calc)), ["foyer", "revenus", "biens", "credits", "protection", "autres"]);
});

test("protection (forme du foyer) : prévoyance et assurance emprunteur, emprunteur cité seulement avec un crédit", () => {
  const pr = demo().profil;
  assert.equal(P.resumeProtection(pr), "non renseignée", "démo : protection non déclarée");
  assert.equal(P.resumeProtection({ protection: { prevoyance: true, emprunteur: false }, credits: [] }), "prévoyance en place, sans assurance emprunteur");
  assert.equal(P.resumeProtection({ protection: { prevoyance: false }, credits: [{ crd: 10 }] }), "sans prévoyance, assurance emprunteur à renseigner");
  assert.equal(P.resumeProtection({ protection: { prevoyance: true } }), "prévoyance en place", "sans crédit, l'assurance emprunteur n'est pas réclamée");
  assert.equal(P.resumeProtection({ protection: { emprunteur: true } }), "prévoyance à renseigner, assurance emprunteur en place");
  assert.equal(P.resumeProtection({ protection: [1] }), "non renseignée", "forme invalide ignorée");
  assert.deepEqual(P.protectionLue({ protection: { prevoyance: true, emprunteur: "oui" } }), { forme: "foyer", decl: { prevoyance: true, emprunteur: null } });
});

test("protection (forme par personne, comme pratiques.js) : résumé correct, personne par personne", () => {
  const base = { foyer: { adultes: 2 }, personnes: { p1: { nom: "Camille" }, p2: { nom: "Sam" } }, credits: [{ crd: 5000, mensualite: 100 }] };
  const pr = o => Object.assign({}, base, { protection: o });
  assert.equal(P.resumeProtection(pr({ p1: { prevoyance: true, emprunteur: true }, p2: { prevoyance: false, emprunteur: true } })),
    "Camille : prévoyance en place, assurance emprunteur en place · Sam : sans prévoyance, assurance emprunteur en place");
  assert.equal(P.resumeProtection(pr({ p1: { prevoyance: true, emprunteur: true }, p2: { prevoyance: true, emprunteur: true } })),
    "prévoyance en place, assurance emprunteur en place", "même situation : une seule phrase");
  assert.equal(P.resumeProtection(pr({ p1: { prevoyance: true } })), "Camille : prévoyance en place, assurance emprunteur à renseigner · Sam : non renseignée");
  assert.notEqual(P.resumeProtection(pr({ p1: { prevoyance: true }, p2: { prevoyance: true } })), "non renseignée", "plus jamais « non renseignée » quand chaque personne a déclaré");
  // un seul adulte : seule p1 compte, sans préfixe
  assert.equal(P.resumeProtection({ foyer: { adultes: 1 }, protection: { p1: { prevoyance: false }, p2: { prevoyance: true } } }), "sans prévoyance");
  // une clé du foyer sert de valeur par défaut à chaque personne
  assert.deepEqual(P.protectionLue(pr({ prevoyance: true, p1: { emprunteur: false } })),
    { forme: "personnes", parPersonne: { p1: { prevoyance: true, emprunteur: false }, p2: { prevoyance: true, emprunteur: null } } });
  // contenu en lecture : un bloc par personne
  const h = sp(P.sectionHtml("protection", pr({ p1: { prevoyance: true, emprunteur: false }, p2: { prevoyance: false } }), Calc));
  assert.match(h, /<h3 class="pf-bloc-t">Camille<\/h3>/);
  assert.match(h, /<h3 class="pf-bloc-t">Sam<\/h3>/);
  assert.equal((h.match(/<dd>oui<\/dd>/g) || []).length, 1);
  assert.equal((h.match(/<dd>non<\/dd>/g) || []).length, 2);
  assert.equal((h.match(/class="pf-nr">non renseigné/g) || []).length, 1, "emprunteur de Sam non déclaré");
});

test("lien profond : section demandée (alias compris), inconnue ou absente ignorée", () => {
  assert.equal(P.sectionDemandee({ section: "biens" }), "biens");
  assert.equal(P.sectionDemandee({ section: "Credits" }), "credits");
  assert.equal(P.sectionDemandee({ section: "immobilier" }), "biens");
  assert.equal(P.sectionDemandee({ section: "prevoyance" }), "protection");
  assert.equal(P.sectionDemandee({ section: "nimporte" }), null);
  assert.equal(P.sectionDemandee({}), null);
  assert.equal(P.sectionDemandee(null), null);
});

test("contenu en lecture : valeurs renseignées de la démo, « non renseigné » sinon, échappement", () => {
  const pr = demo().profil;
  const f = sp(P.sectionHtml("foyer", pr, Calc));
  for (const [l, v] of [["Adultes", "2"], ["Enfants", "1"], ["Dont 14 ans ou plus", "0"], ["Le couple est", "marié ou pacsé"],
    ["Âge de la personne qui gagne le plus", "30 à 39 ans"], ["Tranche marginale d'imposition", "30 %"]])
    assert.ok(f.includes("<dt>" + l + "</dt><dd>" + v + "</dd>"), l + " : " + v);
  const r = sp(P.sectionHtml("revenus", pr, Calc));
  assert.match(r, /Camille<\/h3>/);
  assert.ok(r.includes("<dt>Salaire</dt><dd>" + sp(eur(2800)) + " net / mois</dd>"));
  assert.ok(r.includes("<dt>Statut</dt><dd>non-cadre</dd>"));
  assert.ok(r.includes("<dt>Catégorie professionnelle</dt><dd>Profession intermédiaire</dd>"));
  assert.ok(r.includes("<dt>En période d'essai</dt><dd>oui</dd>"));
  assert.ok(r.includes("<dt>Autres revenus imposables</dt><dd>aucun</dd>"));
  const b = sp(P.sectionHtml("biens", pr, Calc));
  assert.match(b, /Appartement \(résidence principale\)<\/h3>/);
  assert.ok(b.includes("<dt>Part de Camille</dt><dd>50 %</dd>"));
  assert.ok(b.includes("<dt>Reste à rembourser</dt><dd>" + sp(eur(150000)) + "</dd>"));
  assert.ok(b.includes("<dt>Mensualité</dt><dd>" + sp(eur(820)) + "/mois</dd>"));
  const c = sp(P.sectionHtml("credits", pr, Calc));
  assert.ok(c.includes("<dt>Titulaire</dt><dd>Commun</dd>"));
  const a = sp(P.sectionHtml("autres", pr, Calc));
  assert.ok(a.includes("<dt>Voiture, meubles…</dt><dd>" + sp(eur(9000)) + "</dd>"));
  assert.ok(a.includes("<dt>Parts d'entreprise</dt><dd>aucun</dd>"));
  // rien de renseigné
  const v = P.sectionHtml("foyer", null, Calc);
  assert.equal((v.match(/class="pf-nr">non renseigné</g) || []).length, 4, "adultes, enfants, âge, TMI");
  assert.match(P.sectionHtml("biens", null, Calc), /Aucun bien immobilier renseigné\./);
  assert.match(P.sectionHtml("biens", { biens: [] }, Calc), /Aucun bien immobilier\./);
  assert.match(P.sectionHtml("credits", { credits: [] }, Calc), /Aucun crédit\./);
  const cr = sp(P.sectionHtml("credits", demo().profil, Calc));
  assert.match(cr, /Prêt immobilier · Appartement \(résidence principale\)/, "le prêt du bien est listé avec les autres crédits");
  assert.match(cr, /Prêt auto/);
  assert.match(P.sectionHtml("revenus", null, Calc), /<dt>Salaire<\/dt><dd class="pf-nr">non renseigné<\/dd>/);
  // échappement
  const piege = JSON.parse(JSON.stringify(pr));
  piege.personnes.p1.nom = "<img src=x onerror=alert(1)>"; piege.biens[0].nom = "<b>x</b>"; piege.credits[0].nom = '"><script>';
  for (const id of ["revenus", "biens", "credits", "autres"]) {
    const h = P.sectionHtml(id, piege, Calc);
    assert.doesNotMatch(h, /<img|<b>x|<script/, id);
  }
});

test("données : tutoiement — aucun « vous / votre / vos » dans les textes du module et ses rendus", () => {
  assert.doesNotMatch(sansExceptions(js), VOUVOIEMENT);
  assert.doesNotMatch(sansExceptions(html), VOUVOIEMENT);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), VOUVOIEMENT);
  const pr = demo().profil;
  for (const s of P.SECTIONS) for (const x of [pr, null]) {
    assert.doesNotMatch(P.sectionHtml(s.id, x, Calc), VOUVOIEMENT, s.id);
    assert.doesNotMatch(P.phraseSection(s.id), VOUVOIEMENT, s.id);
  }
});

test("données : CSS entièrement scopé sous #view-profil", () => {
  assert.deepEqual(scopedSelectors(css, "#view-profil"), []);
});

/* ------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------ */
function vue(S0, o = {}) {
  const dom = miniDom(), { doc } = dom;
  let params = o.parametres || {};
  const modules = {}, ecritures = [];
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, JSON, Math, Date, encodeURIComponent };
  ctx.window = ctx; ctx.self = ctx;
  ctx.App = { register: (n, api) => { modules[n] = api; }, parametres: () => { const p = params; params = {}; return p; } };
  // Espion : toute écriture au store serait enregistrée ici (il ne doit y en avoir aucune).
  const espion = chemin => ({ set: async d => { ecritures.push({ chemin, d }); }, update: async d => { ecritures.push({ chemin, d }); }, delete: async () => { ecritures.push({ chemin }); } });
  ctx.Store = { db: { doc: espion, collection: espion } };
  vm.createContext(ctx);
  for (const f of ["calc.js", "bilan-etat.js", "ui.js", "claude-prompts.js"]) vm.runInContext(read("web/src/" + f), ctx, { filename: f });
  vm.runInContext(js, ctx, { filename: "profil.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = html;
  const api = modules.profil;
  api.mount(root);
  api.update(S0, true);
  return { dom, doc, root, api, ecritures, lien: p => { params = p; }, $: id => root.querySelector("#" + id) };
}
const etat = profil => ({ ready: true, dbOk: true, profilLoaded: true, profil, positions: demo().positions, scope: "foyer" });

test("vue (DOM) : résumés dans les titres, contenu en lecture, « Compléter avec Claude » partout, aucune écriture au store", async () => {
  const v = vue(etat(demo().profil));
  assert.equal(v.$("pfResFoyer").textContent, "2 adultes, 1 enfant, TMI 30 %");
  assert.equal(v.$("pfResBiens").textContent, "1 bien, " + eur(240000));
  assert.equal(v.$("pfResProtection").textContent, "non renseignée");
  assert.ok(v.root.querySelectorAll("details[data-pf-sec]").every(d => !d.hasAttribute("open")));
  assert.match(sp(v.$("pfLuFoyer").innerHTML), /<dt>Tranche marginale d'imposition<\/dt><dd>30 %<\/dd>/);
  assert.match(v.$("pfPct").textContent, /^\d+ %$/);
  assert.match(sp(v.$("pfRecap").textContent), /suivis dans tes placements/);
  assert.equal(v.root.querySelector("#pfClaude"), null, "plus de bouton Claude dans l'en-tête de la page : celui de la coque le porte");
  for (const k of ["Foyer", "Revenus", "Biens", "Credits", "Protection", "Autres"])
    assert.match(v.$("pfClaude" + k).innerHTML, /Compléter avec Claude/, k);
  assert.equal(v.root.querySelectorAll("input,select,textarea,form,dialog").length, 0, "aucun champ de saisie");
  // clics partout : rien n'est écrit
  for (const b of v.root.querySelectorAll("summary,a,button")) b.click();
  await attendre();
  assert.deepEqual(v.ecritures, []);
  assert.doesNotMatch(sp(v.root.textContent), VOUVOIEMENT);
});

test("vue (DOM) : le lien profond ouvre la section et lui donne le focus ; section inconnue ignorée ; profil absent → « non renseigné »", async () => {
  const v = vue(etat(demo().profil));
  v.lien({ section: "biens" });
  v.api.show();
  await attendre();
  const biens = v.$("pf-sec-biens");
  assert.ok(biens.hasAttribute("open"), "section Biens ouverte");
  assert.equal(v.doc.activeElement, biens.querySelector("summary"), "focus sur le titre de la section");
  assert.ok(!v.$("pf-sec-foyer").hasAttribute("open"));
  v.lien({ section: "inconnue" });
  v.api.show();
  await attendre();
  assert.ok(!v.$("pf-sec-foyer").hasAttribute("open"), "section inconnue : rien ne s'ouvre");

  const w = vue(etat(null));
  assert.equal(w.api.headline(), "À remplir");
  assert.equal(w.$("pfPct").textContent, require("../web/src/bilan-etat.js").etat(etat(null), undefined).pourcentage + " %", "même complétude que le bilan, profil absent compris");
  assert.equal(w.$("pfResFoyer").textContent, "taille du foyer à renseigner, sans enfant, TMI à renseigner");
  assert.match(w.$("pfLuFoyer").innerHTML, /non renseigné/);
  assert.match(w.$("pfMissing").textContent, /^À compléter : /);
});

test("vue (DOM) : une émission du store met à jour le résumé et le contenu ; rien n'est réécrit quand rien n'a changé", () => {
  const pr = demo().profil;
  const v = vue(etat(pr));
  const lu = v.$("pfLuProtection"); let ecr = 0, h = lu.innerHTML;
  Object.defineProperty(lu, "innerHTML", { get: () => h, set: x => { h = x; ecr++; } });
  v.api.update(etat(JSON.parse(JSON.stringify(pr))), true);
  assert.equal(ecr, 0, "même profil : contenu non réécrit");
  const pr2 = JSON.parse(JSON.stringify(pr)); pr2.protection = { p1: { prevoyance: true, emprunteur: true }, p2: { prevoyance: false, emprunteur: true } };
  v.api.update(etat(pr2), true);
  assert.equal(ecr, 1);
  assert.equal(v.$("pfResProtection").textContent, "Camille : prévoyance en place, assurance emprunteur en place · Sam : sans prévoyance, assurance emprunteur en place");
});
