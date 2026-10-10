// Profil et données › Propositions (web/src/propositions.*) : revue des changements proposés par Claude,
// bandeau global et pastille de navigation (app.js, shell.html), description en français de chaque proposition.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/propositions.js", "utf8");
const css = readFileSync("web/src/propositions.css", "utf8");
const html = readFileSync("web/src/propositions.html", "utf8");
const app = readFileSync("web/src/app.js", "utf8");
const shell = readFileSync("web/src/shell.html", "utf8");
const H = require("../web/src/propositions.js");
const sp = s => String(s).replace(/[  ]/g, " ");
const d = (p, ctx) => sp(H.decrire(p, ctx));

test("propositions.js : se compile et s'enregistre sous « propositions »", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "propositions.js" }));
  assert.match(js, /App\.register\("propositions", api\)/);
  assert.match(js, /__pending/);
});

test("propositions.js : valide par Store.propositions.appliquer (avec les valeurs modifiées) et refuse par .refuser", () => {
  assert.match(js, /window\.Store && window\.Store\.propositions/);
  assert.match(js, /api\.appliquer\(ids, m\)/);
  assert.match(js, /api\.refuser\(ids\)/);
  assert.match(js, /out\[id\] = r\.apres/, "modifications { [id]: apresModifie }");
  assert.match(js, /function headline\(\) \{ const n = enAttente\(\)\.length; return n \? String\(n\) : ""; \}/);
});

test("propositions.js : aucune requête DOM globale hors racine du module", () => {
  const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
  assert.deepEqual(bad, []);
});

test("propositions.html : identifiants utilisés par le script, phrase d'en-tête et lien vers Avec Claude", () => {
  const ids = [...js.matchAll(/\$\("(pp[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length > 5);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
  assert.ok(html.includes("Claude a proposé ces changements. Rien n'est enregistré tant que vous ne les validez pas."));
  assert.match(html, /data-goto="profil\/claude"/);
});

test("propositions.css : entièrement scopé (vue, bandeau #propBanner, pastille de la barre latérale)", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(sels.length > 20);
  const bad = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !/^(#view-propositions|#propBanner|#sideNav \[data-prop-count\]|#sideNav \.nav-item)/.test(x));
  assert.deepEqual(bad, []);
});

test("coque : bandeau #propBanner à côté de #demoBanner, lien vers profil/propositions", () => {
  assert.match(shell, /id="demoBanner"[\s\S]{0,600}id="propBanner"[^>]*hidden/);
  assert.match(shell, /id="propBanner"[\s\S]*?data-goto="profil\/propositions"/);
});

test("app.js : pastille Profil et données et bandeau pilotés par headline() du module propositions", () => {
  assert.match(app, /sp\.space === "profil" \? '<span class="pill-count" data-prop-count hidden><\/span>'/);
  assert.match(app, /countOf\("profil", "propositions"\)/);
  assert.match(app, /\$\("propBanner"\)/);
  assert.match(app, /b\.hidden = !anyProp \|\| \(route\.space === "profil" && route\.sub === "propositions"\)/);
  assert.match(app, /countOf\("recos", "actions"\)/, "pastille Recommandations conservée");
});

/* ---------- description en français ---------- */
const CTX = {
  people: [{ id: "p1", nom: "Claire" }, { id: "p2", nom: "Alex" }],
  positions: [{ id: "pos-1", name: "Amundi MSCI World", envelope: "PEA", qty: 120 }],
  profil: { biens: [{ id: "bien-rp", nom: "Appartement", valeur: 240000, crd: 150000 }], credits: [{ id: "credit-auto", nom: "Prêt auto", crd: 6500, mensualite: 210 }] },
  objectifs: [{ id: "o1", nom: "Apport immobilier", cible: 40000 }],
  budget: { lignes: [{ id: "l1", type: "depense", libelle: "Courses", montant: 450, frequence: "mois" }] },
};

test("decrire : protection (oui / non renseignée)", () => {
  assert.equal(d({ cible: "protection", operation: "modifier", avant: { prevoyance: null }, apres: { prevoyance: true } }, CTX), "Assurance prévoyance : non renseignée → oui");
});

test("decrire : position (parts, nom de la ligne retrouvé par ref)", () => {
  assert.equal(d({ cible: "position", operation: "modifier", ref: "pos-1", avant: { qty: 120 }, apres: { qty: 135 } }, CTX), "PEA · Amundi MSCI World : 120 parts → 135 parts");
  assert.equal(d({ cible: "position", operation: "creer", apres: { name: "Livret A", envelope: "Livret A", value: 12000 } }, CTX), "Nouveau placement : Livret A · Livret A, valeur 12 000 €");
});

test("decrire : budget (nouvelle dépense, montant par mois / par an)", () => {
  assert.equal(d({ cible: "budget", operation: "creer", apres: { type: "depense", categorie: "Transport", libelle: "Assurance auto", montant: 45, frequence: "mois" } }, CTX), "Nouvelle dépense : Assurance auto 45 €/mois");
  assert.equal(d({ cible: "budget", operation: "creer", apres: { type: "epargne", libelle: "PEA", montant: 1200, frequence: "an" } }, CTX), "Nouvelle épargne : PEA 1 200 €/an");
  assert.equal(d({ cible: "budget", operation: "modifier", ref: "l1", avant: { montant: 450 }, apres: { montant: 500 } }, CTX), "Courses : montant 450 €/mois → 500 €/mois");
});

test("decrire : bien, crédit et objectif (libellés humains, euros)", () => {
  assert.equal(d({ cible: "bien", operation: "modifier", ref: "bien-rp", avant: { crd: 150000 }, apres: { crd: 145000 } }, CTX), "Appartement : reste à rembourser 150 000 € → 145 000 €");
  assert.equal(d({ cible: "credit", operation: "supprimer", ref: "credit-auto", avant: { nom: "Prêt auto" } }, CTX), "Supprimer le crédit : Prêt auto");
  assert.equal(d({ cible: "objectif", operation: "creer", apres: { nom: "Études", cible: 20000, dateCible: "2034-09-01" } }, CTX), "Nouvel objectif : Études, montant visé 20 000 €, date visée 1 sept. 2034");
  assert.equal(d({ cible: "credit", operation: "modifier", ref: "credit-auto", avant: { crd: 6500, mensualite: 210 }, apres: { crd: 6290, mensualite: 210 } }, CTX), "Prêt auto : reste à rembourser 6 500 € → 6 290 €");
});

test("decrire : profil (champs imbriqués, nom de la personne)", () => {
  assert.equal(d({ cible: "profil", operation: "modifier", avant: { foyer: { tmi: 11 } }, apres: { foyer: { tmi: 30 } } }, CTX), "Tranche marginale d'imposition : 11 % → 30 %");
  assert.equal(d({ cible: "profil", operation: "modifier", avant: {}, apres: { personnes: { p2: { salaire: 3200 } } } }, CTX), "Salaire d'Alex : non renseigné → 3 200 €");
});

test("decrire : profil de risque (thème et libellé de l'option si le questionnaire est fourni)", () => {
  const questions = [{ id: "horizon", options: [{ v: "8-15", label: "8 à 15 ans" }] }];
  assert.equal(d({ cible: "risque", operation: "modifier", avant: { reponses: {} }, apres: { reponses: { horizon: "8-15" } } }, { ...CTX, questions }), "Horizon de placement : non renseigné → 8 à 15 ans");
});

test("changements : seulement les champs modifiés ; appliquerSaisies : valeurs typées, erreurs en français", () => {
  const p = { cible: "position", operation: "modifier", ref: "pos-1", avant: { qty: 120, value: 1000 }, apres: { qty: 135, value: 1000 } };
  assert.deepEqual(H.changements(p, CTX).map(c => c.path), ["qty"]);
  assert.deepEqual(H.appliquerSaisies(p, { qty: "140,5" }, CTX).apres, { qty: 140.5, value: 1000 });
  assert.match(H.appliquerSaisies(p, { qty: "beaucoup" }, CTX).erreur, /n'est pas un nombre/);
  const prot = { cible: "protection", operation: "modifier", avant: {}, apres: { prevoyance: true } };
  assert.deepEqual(H.appliquerSaisies(prot, { prevoyance: "non" }, CTX).apres, { prevoyance: false });
  const prof = { cible: "profil", operation: "modifier", avant: {}, apres: { foyer: { tmi: 30 } } };
  assert.deepEqual(H.appliquerSaisies(prof, { "foyer.tmi": "41" }, CTX).apres, { foyer: { tmi: 41 } });
});

test("profil de risque recalculé après validation de réponses proposées par Claude", () => {
  const js = readFileSync("web/src/propositions.js", "utf8");
  assert.match(js, /cible === "risque"/);
  assert.match(js, /window\.Risque/);
  assert.match(js, /\.evaluer\(rq\.reponses/);
  assert.match(js, /update\(\{ risque:/);
});
