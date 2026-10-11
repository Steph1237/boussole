// Compte › Données (web/src/profil.*) : sections en accordéons avec résumé dans le titre, lien profond ?section=…,
// mêmes écritures qu'avant (db.doc("profil/main").set), protection saisie et conservée.
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
const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const eur = v => nf.format(v) + " €";
const attendre = () => new Promise(r => setTimeout(r, 0));

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

test("données : s'enregistre, écrit le profil complet par db.doc(\"profil/main\").set (une seule écriture), assistant conservé", () => {
  assert.match(js, /App\.register\("profil", api\)/);
  assert.equal((sansCommentaires(js).match(/db\.doc\("profil\/main"\)\.set\(data\)/g) || []).length, 1);
  assert.doesNotMatch(sansCommentaires(js), /\.update\(/, "aucune autre écriture");
  assert.match(js, /A\.prompt\("profil"\)/);
  assert.match(js, /A\.merge\(forCalc\(\), r\.data\)/);
  assert.match(js, /return S\.profil \? window\.Calc\.completude\(S\.profil\) \+ " % rempli" : "À remplir";/, "chiffre clé inchangé");
  assert.doesNotThrow(() => new vm.Script(js, { filename: "profil.js" }));
});

test("données : six sections en accordéons fermés, résumé dans chaque titre, « Remplir avec mon assistant »", () => {
  const secs = [...html.matchAll(/<details class="ui-acc pf-sec" id="pf-sec-(\w+)" data-pf-sec="(\w+)">/g)].map(m => m[1]);
  assert.deepEqual(secs, ["foyer", "revenus", "biens", "credits", "protection", "autres"]);
  assert.deepEqual(P.SECTIONS.map(s => s.id), secs);
  assert.doesNotMatch(html, /<details[^>]*\sopen/, "rien n'est déplié d'office");
  for (const id of ["pfResFoyer", "pfResRevenus", "pfResBiens", "pfResCredits", "pfResProtection", "pfResAutres",
    "pfFoyer", "pfPeople", "pfBiens", "pfCredits", "pfProtection", "pfAutres", "pfAssistBtn", "pfSubmit", "pfCancel", "pfMsgs", "pfPct", "pfRecap", "pfClaude"])
    assert.match(html, new RegExp(`id="${id}"`), id);
  for (const t of [">Foyer<", ">Revenus<", ">Biens immobiliers<", ">Crédits<", ">Protection<", ">Autres biens<", "Remplir avec mon assistant"])
    assert.ok(html.includes(t), t);
  assert.match(html, /data-pf-add="biens"/);
  assert.match(html, /data-pf-add="credits"/);
});

test("résumés : foyer, revenus, biens, crédits, protection, autres (démo et cas limites)", () => {
  const pr = demo().profil;
  assert.equal(P.resumeFoyer(pr), "2 adultes, 1 enfant, TMI 30 %");
  assert.equal(P.resumeFoyer({ foyer: { adultes: 1, enfants: 0, tmi: null } }), "1 adulte, sans enfant, TMI à renseigner");
  assert.equal(P.resumeFoyer({ foyer: { adultes: 3, enfants: 4, tmi: 0 } }), "3 adultes ou plus, 4 enfants ou plus, TMI 0 %");
  assert.equal(P.resumeFoyer(null), "taille du foyer à renseigner, sans enfant, TMI à renseigner");

  assert.equal(P.resumeRevenus(pr, Calc), eur(Calc.revenusFoyer(pr, "foyer")) + "/mois nets");
  assert.equal(P.resumeRevenus(P.normalize(null), Calc), "salaires à renseigner");
  assert.equal(P.resumeRevenus({ foyer: { adultes: 1 }, personnes: {} }, Calc), "salaire à renseigner");
  const sansSam = JSON.parse(JSON.stringify(pr)); sansSam.personnes.p2.salaire = null;
  assert.match(P.resumeRevenus(sansSam, Calc), /\/mois nets · salaire de Sam à renseigner$/);

  assert.equal(P.resumeBiens(pr), "1 bien, " + eur(240000));
  assert.equal(P.resumeBiens({ biens: [] }), "aucun");
  assert.equal(P.resumeBiens({ biens: [{ valeur: 100000 }, { valeur: "50000" }] }), "2 biens, " + eur(150000));

  assert.equal(P.resumeCredits(pr), "1 crédit, " + eur(6500) + " restants, " + eur(210) + "/mois");
  assert.equal(P.resumeCredits({ credits: [] }), "aucun");
  assert.equal(P.resumeCredits({ credits: [], biens: [{ crd: 1000 }] }), "aucun en dehors des prêts immobiliers");

  assert.equal(P.resumeProtection(pr), "non renseignée", "démo : protection non déclarée");
  assert.equal(P.resumeProtection({ protection: { prevoyance: true, emprunteur: false }, credits: [] }), "prévoyance en place, sans assurance emprunteur");
  assert.equal(P.resumeProtection({ protection: { prevoyance: false }, credits: [{ crd: 10 }] }), "sans prévoyance, assurance emprunteur à renseigner");
  assert.equal(P.resumeProtection({ protection: { prevoyance: true } }), "prévoyance en place", "sans crédit, l'assurance emprunteur n'est pas réclamée");
  assert.equal(P.resumeProtection({ protection: { emprunteur: true } }), "prévoyance à renseigner, assurance emprunteur en place");

  assert.equal(P.resumeAutres(pr), eur(15000));
  assert.equal(P.resumeAutres({ foyer: { adultes: 1 }, autres: { p1: { usage: 0 }, p2: { usage: 9000 } } }), "aucun", "une seule personne : p2 ignorée");
  assert.deepEqual(Object.keys(P.resumes(pr, Calc)), ["foyer", "revenus", "biens", "credits", "protection", "autres"]);
});

test("lien profond : section demandée (alias compris), inconnue ou absente ignorée ; valeurs des boutons segmentés", () => {
  assert.equal(P.sectionDemandee({ section: "biens" }), "biens");
  assert.equal(P.sectionDemandee({ section: "Credits" }), "credits");
  assert.equal(P.sectionDemandee({ section: "immobilier" }), "biens");
  assert.equal(P.sectionDemandee({ section: "nimporte" }), null);
  assert.equal(P.sectionDemandee({}), null);
  assert.equal(P.sectionDemandee(null), null);
  assert.equal(P.valeurSeg("true"), true);
  assert.equal(P.valeurSeg("false"), false);
  assert.equal(P.valeurSeg("30"), 30);
  assert.equal(P.valeurSeg("joint"), "joint");
});

test("normalize : la protection et les autres champs du profil sont conservés ; profil vide par défaut", () => {
  const d = P.normalize({ foyer: { adultes: 1, biensRenseignes: true }, protection: { prevoyance: true, p1: { emprunteur: false } }, biens: [{ id: "b" }] });
  assert.deepEqual(d.protection, { prevoyance: true, p1: { emprunteur: false } });
  assert.equal(d.foyer.biensRenseignes, true);
  assert.equal(d.__saved, true);
  const v = P.normalize(null);
  assert.deepEqual(v.protection, {});
  assert.equal(v.__saved, undefined);
  assert.deepEqual(P.normalize({ protection: [1] }).protection, {}, "forme invalide ignorée");
});

test("données : CSS entièrement scopé sous #view-profil", () => {
  assert.deepEqual(scopedSelectors(css, "#view-profil"), []);
});

/* ------------------------------------------------------------ vue dans un mini-DOM ------------------------------------------------------------ */
function vue(S0, o = {}) {
  const dom = miniDom(), { doc } = dom;
  let params = o.parametres || {};
  const modules = {}, ecritures = [];
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, JSON, Math, Date };
  ctx.window = ctx; ctx.self = ctx;
  ctx.App = { register: (n, api) => { modules[n] = api; }, parametres: () => { const p = params; params = {}; return p; } };
  ctx.Store = { db: { doc: chemin => ({ set: async d => { ecritures.push({ chemin, d: JSON.parse(JSON.stringify(d)) }); } }) } };
  vm.createContext(ctx);
  for (const f of ["calc.js", "ui.js"]) vm.runInContext(read("web/src/" + f), ctx, { filename: f });
  vm.runInContext(js, ctx, { filename: "profil.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = html;
  const api = modules.profil;
  api.mount(root);
  api.update(S0, true);
  return { dom, doc, root, api, ecritures, lien: p => { params = p; }, $: id => root.querySelector("#" + id) };
}
const etat = profil => ({ ready: true, dbOk: true, profilLoaded: true, profil, positions: demo().positions, scope: "foyer" });

test("vue (DOM) : résumés dans les titres, tout est fermé ; le lien profond ouvre la section et lui donne le focus", async () => {
  const v = vue(etat(demo().profil));
  assert.equal(v.$("pfResFoyer").textContent, "2 adultes, 1 enfant, TMI 30 %");
  assert.equal(v.$("pfResBiens").textContent, "1 bien, " + eur(240000));
  assert.equal(v.$("pfResProtection").textContent, "non renseignée");
  assert.ok(v.root.querySelectorAll("details[data-pf-sec]").every(d => !d.hasAttribute("open")));
  assert.match(v.$("pfClaude").innerHTML, /claude\.ai\/new\?q=/);
  assert.equal(v.$("pfAssistBtn").hidden, true, "sans Assistant ni <dialog> : le bouton est masqué, sans erreur");

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
});

test("vue (DOM) : protection saisie par oui / non (booléens), résumé tenu à jour, enregistrée avec le reste du profil", async () => {
  const v = vue(etat(demo().profil));
  const bouton = (path, val) => v.root.querySelectorAll('[data-seg="' + path + '"]').find(b => b.getAttribute("data-v") === val);
  bouton("protection.prevoyance", "true").click();
  assert.equal(v.doc.activeElement.getAttribute("data-seg"), "protection.prevoyance", "le focus reste sur le bouton choisi");
  assert.equal(v.$("pfResProtection").textContent, "prévoyance en place, assurance emprunteur à renseigner");
  bouton("protection.emprunteur", "false").click();
  assert.equal(v.$("pfResProtection").textContent, "prévoyance en place, sans assurance emprunteur");
  assert.equal(bouton("protection.emprunteur", "false").getAttribute("aria-pressed"), "true");
  assert.equal(v.$("pfCancel").hidden, false, "modifications non enregistrées");
  v.$("pfSubmit").click();
  await attendre();
  assert.equal(v.ecritures.length, 1);
  assert.equal(v.ecritures[0].chemin, "profil/main");
  assert.deepEqual(v.ecritures[0].d.protection, { prevoyance: true, emprunteur: false });
  assert.equal(v.ecritures[0].d.biens.length, 1, "biens et crédits écrits comme avant");
  assert.equal(v.ecritures[0].d.__saved, undefined);
});

test("vue (DOM) : ajout et retrait d'un crédit mettent le résumé à jour ; textes saisis échappés", () => {
  const pr = demo().profil;
  pr.personnes.p1.nom = "<img src=x onerror=alert(1)>";
  const v = vue(etat(pr));
  assert.doesNotMatch(v.$("pfPeople").innerHTML, /<img/);
  assert.match(v.$("pfPeople").innerHTML, /&lt;img/);
  v.root.querySelector('[data-pf-add="credits"]').click();
  assert.match(v.$("pfResCredits").textContent, /^2 crédits, /);
  v.root.querySelectorAll('[data-pf-del="credits"]')[1].click();
  v.root.querySelectorAll('[data-pf-del="credits"]')[0].click();
  assert.equal(v.$("pfResCredits").textContent, "aucun en dehors des prêts immobiliers");
  assert.equal(v.doc.activeElement, v.root.querySelector('[data-pf-add="credits"]'), "focus sur « Ajouter un crédit » après un retrait");
});
