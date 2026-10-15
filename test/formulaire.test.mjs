// Formulaires dynamiques du connecteur MCP (docs/superpowers/specs/2026-10-11-saisie-par-agent.md § 1) :
// catalogue généré (scripts/gen-catalogue.mjs → catalogue.gen.ts, formulaire-logique.gen.ts), logique du formulaire
// (formulaire-logique.js), outils formulaire / soumettre_formulaire, ressource ui://boussole/formulaire, prompt completer_profil
// (formulaire.ts), page (formulaire-ui.ts) jouée contre un faux hôte MCP Apps, tutoiement des textes du connecteur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import vm from "node:vm";
import { miniDom } from "./helpers/mini-dom.mjs";
import { generer, exigerTutoiement, sansPrerempli, SORTIE_CATALOGUE, SORTIE_LOGIQUE, EXPERIENCE_MAX } from "../scripts/gen-catalogue.mjs";
import { PlanGen } from "./helpers/moteur-gen.mjs";

const require = createRequire(import.meta.url);
const path = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
const read = rel => readFileSync(path(rel), "utf8");
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const J = v => JSON.parse(JSON.stringify(v));
const TODAY = "2026-10-10";
const MCP = "supabase/functions/mcp/";
const Risque = require("../web/src/risque.js");
const Logique = require("../" + MCP + "formulaire-logique.js");
const DEMO = require("../web/src/demo-data.js");

/** Module TypeScript du connecteur exécuté dans un contexte vm (types retirés, imports remplacés par `globaux`). */
function charger(rel, globaux = {}) {
  const source = read(MCP + rel);
  const noms = [...source.matchAll(/^export (?:const|function|async function) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, { RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console, isFinite, ...globaux });
}
const fauxZ = () => { const f = new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : f), apply: () => f }); return f; };
const charges = SANS_STRIP ? null : (() => {
  const C = charger("catalogue.gen.ts");
  const G = charger("formulaire-logique.gen.ts");
  const UI = charger("formulaire-ui.ts", { LOGIQUE_FORMULAIRE: G.LOGIQUE_FORMULAIRE });
  let n = 0;
  const F = charger("formulaire.ts", { CATALOGUE: C.CATALOGUE, BAREME_RISQUE: C.BAREME_RISQUE, HTML_FORMULAIRE: UI.HTML_FORMULAIRE, z: fauxZ(),
    crypto: { randomUUID: () => "00000000-0000-4000-8000-00000000000" + (++n % 10) } });
  return { C, G, UI, F };
})();

/* Port du connecteur (index.ts, de « Utilitaires » à « Schémas d'entrée ») pour entreesAides, comme test/mcp.test.mjs. */
function portMcp() {
  const src = read(MCP + "index.ts");
  const debut = src.indexOf("/* Utilitaires"), fin = src.indexOf("/* Schémas d'entrée");
  const bloc = src.slice(src.lastIndexOf("/*", debut - 1), src.lastIndexOf("/*", fin - 1));
  const js = strip(bloc, { mode: "strip" }) + "\n;({ entreesAides, allocationReelle, risquePortefeuille, PROFILS });";
  return vm.runInNewContext(js, { Intl, Date, Math, JSON, Number, String, Object, Array, Set, Map, isFinite, isNaN, Infinity, Error, structuredClone, console, Plan: PlanGen });
}
function enLignes(D, extra = {}) {
  const positions = D.positions.map(p => ({ id: p.id, name: p.name, envelope: p.envelope, owner: p.owner, bloc: p.bloc, mode: p.mode, isin: p.isin, qty: p.qty, pru: p.pru,
    value: p.value, value_date: p.valueDate, status: p.status, price_override: null,
    instrument: p.mode === "market" || p.ter != null ? { price: p.price, price_date: p.priceDate, ter: p.ter, zone: p.zone, devise: p.devise } : null }));
  const { biens, credits, ...profil } = D.profil;
  return { d: { profil: { ...profil, ...extra.profil }, biens, credits, positions, config: D.config, lignes: D.budget.lignes },
    objectifs: D.objectifs.map(({ dateCible, ...o }) => ({ ...o, date_cible: dateCible })) };
}

/* ====================================================== catalogue généré ====================================================== */
test("catalogue : fichiers générés à jour (npm run gen)", () => {
  const f = generer();
  assert.deepEqual(Object.keys(f).sort(), [SORTIE_CATALOGUE, SORTIE_LOGIQUE].sort());
  for (const [rel, txt] of Object.entries(f)) assert.equal(read(rel), txt, `${rel} n'est plus à jour : lancer npm run gen`);
  assert.match(read("package.json"), /"gen": "node scripts\/gen-catalogue\.mjs( && [^"]*)?"/);
  assert.ok(read(SORTIE_LOGIQUE).includes(JSON.stringify(read(MCP + "formulaire-logique.js"))), "logique injectée telle quelle");
});

test("catalogue : textes de l'app repris tels quels, au tutoiement (échec si un vouvoiement subsiste), préremplissage retiré", () => {
  assert.equal(exigerTutoiement("Quel est ton âge ?"), "Quel est ton âge ?", "texte au tutoiement : inchangé");
  for (const t of ["Vous mangez quoi ?", "Quel est votre âge ?", "Tes placements et vos crédits"]) assert.throws(() => exigerTutoiement(t), /vouvoiement/, t);
  assert.equal(sansPrerempli("Sans lui, un imprévu peut obliger à vendre. Prérempli depuis ton patrimoine."), "Sans lui, un imprévu peut obliger à vendre.");
  assert.equal(sansPrerempli("Prérempli depuis ton profil."), undefined);
});

test("catalogue : champs couverts (foyer, revenus, autres actifs, protection, 10 questions de risque), forme et cibles", { skip: SANS_STRIP }, () => {
  const { CATALOGUE } = charges.C;
  const champs = CATALOGUE.map(c => c.champ);
  for (const c of ["foyer.adultes", "foyer.enfants", "foyer.age", "foyer.tmi", "protection.prevoyance", "protection.emprunteur",
    ...["p1", "p2"].flatMap(k => ["nom", "salaire", "salaireUnite", "statut", "autresRevenus"].map(x => `personnes.${k}.${x}`)),
    ...["p1", "p2"].flatMap(k => [`autres.${k}.usage`, `autres.${k}.entreprise`]),
    ...Risque.QUESTIONS.map(q => "risque." + q.id)]) assert.ok(champs.includes(c), c);
  assert.equal(new Set(champs).size, champs.length, "champs uniques");
  const TYPES = ["choix", "multi", "curseur", "montant", "date", "booleen", "texte_court"];
  for (const c of CATALOGUE) {
    assert.ok(TYPES.includes(c.type), c.champ); assert.ok(["profil", "risque", "protection"].includes(c.cible), c.champ);
    assert.ok(c.theme && c.libelle && c.chemin, c.champ);
    if (["choix", "multi"].includes(c.type)) assert.ok(c.valeurs.length >= 2 && c.valeurs.every(o => o.v !== undefined && o.label), c.champ);
  }
  // valeurs de risque : codes et libellés des options de l'app, inchangés ; exclusivité reprise
  for (const q of Risque.QUESTIONS) {
    const c = CATALOGUE.find(x => x.champ === "risque." + q.id);
    if (q.type === "nombre") { assert.equal(c.type, "curseur"); assert.equal(c.max, EXPERIENCE_MAX); assert.equal(c.unite, "ans"); assert.deepEqual(J(c.reperes), q.options.map(o => ({ min: o.min, label: o.label }))); continue; }
    assert.deepEqual(J(c.valeurs), q.options.map(o => (o.exclusif ? { v: o.v, label: o.label, exclusif: true } : { v: o.v, label: o.label })), q.id);
    assert.equal(c.libelle, q.texte, q.id + " : texte de l'app repris tel quel");
  }
  assert.deepEqual(J(CATALOGUE.find(c => c.champ === "risque.connaissances").valeurs.filter(o => o.exclusif).map(o => o.v)), ["aucun"]);
  assert.ok(!CATALOGUE.some(c => /Prérempli/.test(c.aide || "")), "aucune aide « Prérempli » (pas de préremplissage déduit)");
  // barème du profil estimé = risque.js
  assert.deepEqual(J(charges.C.BAREME_RISQUE.map(q => [q.id, q.poids, q.type, q.options.map(o => [o.v, o.points, o.perte ?? null, o.min ?? null])])),
    Risque.QUESTIONS.map(q => [q.id, q.poids, q.type, q.options.map(o => [o.v, o.points, o.perte ?? null, o.min ?? null])]));
});

test("catalogue : codes du profil identiques à l'app (profil.js) et aux schémas d'update_profile (index.ts)", { skip: SANS_STRIP }, () => {
  const { CATALOGUE } = charges.C, V = c => J(CATALOGUE.find(x => x.champ === c).valeurs.map(o => o.v));
  const profilJs = read("web/src/profil.js"), index = read(MCP + "index.ts");
  assert.deepEqual(V("foyer.tmi"), [0, 11, 30, 41, 45]); assert.ok(index.includes("const TMI = [0, 11, 30, 41, 45] as const;"));
  assert.match(profilJs, /const TMI = \[\[0, "0 %"\], \[11, "11 %"\], \[30, "30 %"\], \[41, "41 %"\], \[45, "45 %"\]\];/);
  assert.deepEqual(V("foyer.age"), ["u30", "a30", "a40", "a50", "a60", "a70"]); assert.ok(index.includes('age: z.enum(["u30", "a30", "a40", "a50", "a60", "a70"])'));
  assert.deepEqual(V("foyer.adultes"), [1, 2, 3]); assert.match(index, /adultes: z\.number\(\)\.int\(\)\.min\(1[^\n]*\.max\(3/);
  assert.deepEqual(V("foyer.enfants"), [0, 1, 2, 3, 4]);
  const units = J(CATALOGUE.find(x => x.champ === "personnes.p1.salaireUnite").valeurs.map(o => [o.v, o.label]));
  assert.ok(profilJs.includes("const UNITS = " + JSON.stringify(units).replace(/","/g, '", "').replace(/\],\[/g, "], [") + ";"), "UNITS de profil.js");
  assert.ok(index.includes('z.enum(["nm", "na", "bm", "ba"]'));
  assert.deepEqual(V("personnes.p2.statut"), ["cadre", "nc"]); assert.ok(index.includes('statut: z.enum(["cadre", "nc"]'));
  assert.equal(CATALOGUE.find(x => x.champ === "personnes.p1.nom").max, 40); assert.match(index, /nom: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(40\)/);
  for (const k of ["prevoyance", "emprunteur"]) { const c = CATALOGUE.find(x => x.champ === "protection." + k); assert.equal(c.type, "booleen"); assert.equal(c.cible, "protection"); assert.equal(c.chemin, k); }
});

/* ====================================================== logique (formulaire-logique.js) ====================================================== */
const Q = (champ, extra = {}) => ({ ...J(charges.C.CATALOGUE.find(c => c.champ === champ)), ...extra });

test("logique : « aucun » exclusif dans un choix multiple", { skip: SANS_STRIP }, () => {
  const q = Q("risque.connaissances");
  let v = Logique.basculerMulti(q, [], "actions");
  v = Logique.basculerMulti(q, v, "etf"); assert.deepEqual(v, ["actions", "etf"]);
  v = Logique.basculerMulti(q, v, "aucun"); assert.deepEqual(v, ["aucun"], "l'exclusive remplace tout");
  v = Logique.basculerMulti(q, v, "crypto"); assert.deepEqual(v, ["crypto"], "une autre option retire l'exclusive");
  v = Logique.basculerMulti(q, v, "crypto"); assert.deepEqual(v, [], "décocher");
  assert.deepEqual(Logique.basculerMulti(q, ["actions"], "inconnu"), ["actions"], "valeur hors catalogue ignorée");
  assert.match(Logique.valider(q, ["aucun", "etf"]), /« Aucun de ces placements » ne se combine pas/);
  assert.equal(Logique.valider(q, ["aucun"]), null);
  assert.match(Logique.valider(q, ["etf", "bitcoin"]), /proposées/);
});

test("logique : bornes et pas du curseur, affichage « 3 ans »", { skip: SANS_STRIP }, () => {
  const q = Q("risque.experience");
  assert.equal(Logique.borner(q, 120), 80); assert.equal(Logique.borner(q, -4), 0); assert.equal(Logique.borner(q, 2.6), 3); assert.equal(Logique.borner(q, "x"), 0);
  assert.equal(Logique.formaterCurseur(q, 3), "3 ans"); assert.equal(Logique.formaterCurseur(q, 1), "1 an"); assert.equal(Logique.formaterCurseur(q, 0), "0 an");
  assert.equal(Logique.repereCurseur(q, 6), "5 à 9 ans"); assert.equal(Logique.repereCurseur(q, 0), "Jamais ou moins d'un an");
  assert.equal(Logique.valider(q, 80), null); assert.equal(Logique.valider(q, 0), null);
  assert.match(Logique.valider(q, 81), /entre 0 an et 80 ans/); assert.match(Logique.valider(q, -1), /entre/); assert.match(Logique.valider(q, 2.5), /pas de 1/);
});

test("logique : montants, dates, oui/non, texte court ; stepper (erreur en ligne, passer, précédente, réponses)", { skip: SANS_STRIP }, () => {
  assert.equal(Logique.lireMontant("2 500,50"), 2500.5); assert.equal(Logique.lireMontant("2500.5 €"), 2500.5); assert.ok(isNaN(Logique.lireMontant("deux mille")));
  const m = Q("personnes.p1.salaire");
  assert.equal(Logique.valider(m, "3 200"), null); assert.match(Logique.valider(m, "-5"), /positif/); assert.match(Logique.valider(m, "abc"), /chiffres/);
  assert.equal(Logique.valider({ champ: "x", type: "date" }, "2026-02-28"), null); assert.match(Logique.valider({ champ: "x", type: "date" }, "2026-02-31"), /date valide/);
  assert.equal(Logique.valider(Q("protection.prevoyance"), "false"), null); assert.match(Logique.valider(Q("protection.prevoyance"), "peut-être"), /oui ou par non/);
  assert.match(Logique.valider(Q("personnes.p1.nom"), "x".repeat(41)), /40 caractères/);

  const f = { questions: [Q("risque.horizon", { valeur_actuelle: "8-15" }), Q("risque.connaissances", { valeur_actuelle: ["inconnu"] }), Q("risque.experience"), Q("personnes.p1.salaire")] };
  const e = Logique.creer(f);
  assert.deepEqual(J(e.reponses), { "risque.horizon": "8-15" }, "seules les valeurs actuelles valides sont préremplies");
  assert.equal(Logique.progression(e).texte, "Question 1 sur 4");
  Logique.suivante(e); assert.equal(e.index, 1, "question préremplie valide : on avance");
  Logique.suivante(e); assert.equal(e.index, 1, "sans réponse : on reste"); assert.match(e.erreur, /Choisis une réponse, ou passe la question/);
  Logique.repondre(e, ["etf"]); assert.equal(e.erreur, null);
  Logique.suivante(e); assert.equal(e.index, 2);
  Logique.passer(e); assert.equal(e.index, 3); assert.equal(e.passees["risque.experience"], true);
  Logique.repondre(e, "abc"); assert.equal(Logique.envoyable(e).ok, false); assert.match(e.erreur, /chiffres/);
  Logique.repondre(e, "3 100,5");
  const r = Logique.envoyable(e);
  assert.equal(r.ok, true); assert.deepEqual(J(r.reponses), { "risque.horizon": "8-15", "risque.connaissances": ["etf"], "personnes.p1.salaire": 3100.5 });
  Logique.precedente(e); assert.equal(e.index, 2);
  assert.deepEqual(J(Logique.resume(e).map(x => x.valeur)), ["8 à 15 ans", "ETF (fonds indiciels cotés)", "3 100,5 €"]);
  const vide = Logique.creer({ questions: [Q("risque.horizon")] });
  Logique.passer(vide); assert.equal(Logique.envoyable(vide).ok, false); assert.match(vide.erreur, /au moins une question/);
});

test("parité logique (page) / formulaire.ts (serveur) : mêmes valeurs acceptées et refusées, mêmes normalisations", { skip: SANS_STRIP }, () => {
  const { F } = charges;
  const cas = [
    ["risque.horizon", ["lt2", "gt15", "x", 3, null]], ["foyer.tmi", [30, "30", 25, "0", 45]], ["foyer.adultes", [1, "2", 4, 0]],
    ["risque.connaissances", [["etf"], ["aucun"], ["aucun", "etf"], [], ["etf", "etf"], ["zzz"], "actions"]],
    ["risque.experience", [0, 80, 81, -1, 2.5, "7", "x"]], ["personnes.p1.salaire", [0, 2500.5, -1, "abc", "1200"]],
    ["protection.emprunteur", [true, false, "true", "oui", 1]], ["personnes.p2.nom", ["Sam", "  Léa  ", "", "x".repeat(41)]],
    ["personnes.p1.salaireUnite", ["nm", "ba", "brut"]],
  ];
  for (const [champ, valeurs] of cas) for (const v of valeurs) {
    const q = Q(champ), page = Logique.valider(q, v), serveur = F.validerValeur(F.definition(champ), v);
    assert.equal(page === null, !serveur.erreur, `${champ} = ${JSON.stringify(v)} : page ${page} / serveur ${serveur.erreur}`);
    if (page === null) assert.deepEqual(J(serveur.valeur), J(Logique.normaliser(q, v)), `${champ} = ${JSON.stringify(v)} : normalisation`);
  }
});

/* ====================================================== outils (formulaire.ts) ====================================================== */
class UserErrorT extends Error {}
function serveurFormulaire({ profil = {}, depots = {}, risque = null, positions, objectifs } = {}) {
  const outils = {}, ressources = {}, prompts = {}, appels = { deposer: [], profil: [], risque: [], protection: [] };
  const base = enLignes(DEMO, { profil });
  const donnees = { ...base.d, ...(positions ? { positions } : {}) };
  const M = portMcp();
  const h = {
    db: null, UserError: UserErrorT, RO: { readOnlyHint: true }, RW: { readOnlyHint: false }, today: () => TODAY,
    must: (t, r) => r.data,
    calcul: { charger: async () => ({ donnees, objectifs: objectifs ?? base.objectifs, risque: risque ?? donnees.profil.risque ?? null, classes: undefined }), entreesAides: M.entreesAides, PROFILS: M.PROFILS },
    depots: {
      profil: async p => { appels.profil.push(J(p)); return [{ cible: "profil", operation: "modifier", apres: p }]; },
      risque: async r => { appels.risque.push(J(r)); return [{ cible: "risque", operation: "modifier", apres: r }]; },
      protection: async p => { appels.protection.push(J(p)); return [{ cible: "protection", operation: "creer", apres: p }]; },
      deposer: async (items, d) => { appels.deposer.push({ items: J(items), d: J(d) }); return { message: items.length + " propositions déposées", lot: d.lot ?? "lot-neuf", propositions: items, avertissements: [] }; },
      ...depots,
    },
  };
  charges.F.registerFormulaire({
    registerTool: (n, def, fn) => { outils[n] = { def, fn }; },
    registerResource: (n, uri, meta, fn) => { ressources[uri] = { n, meta, fn }; },
    registerPrompt: (n, def, fn) => { prompts[n] = { def, fn }; },
  }, h);
  return { outils, ressources, prompts, appels, M, donnees };
}

test("formulaire : enregistrement — outil visible (resourceUri), soumission réservée à la page, ressource MCP Apps, prompt", { skip: SANS_STRIP }, async () => {
  const { outils, ressources, prompts } = serveurFormulaire();
  assert.deepEqual(Object.keys(outils).sort(), ["formulaire", "soumettre_formulaire"]);
  assert.deepEqual(J(outils.formulaire.def._meta), { ui: { resourceUri: "ui://boussole/formulaire", visibility: ["model", "app"] }, "ui/resourceUri": "ui://boussole/formulaire" });
  assert.equal(outils.formulaire.def.annotations.readOnlyHint, true);
  assert.deepEqual(J(outils.soumettre_formulaire.def._meta.ui.visibility), ["app"], "invisible du modèle");
  assert.match(outils.formulaire.def.description, /dès que tu dois poser plusieurs questions/);
  assert.match(outils.formulaire.def.description, /risque\.horizon/, "la description liste les champs du catalogue");
  const r = ressources["ui://boussole/formulaire"];
  assert.equal(r.meta.mimeType, "text/html;profile=mcp-app");
  assert.equal(r.meta._meta.ui.prefersBorder, true);
  const lu = await r.fn();
  assert.equal(lu.contents[0].mimeType, "text/html;profile=mcp-app"); assert.equal(lu.contents[0].uri, "ui://boussole/formulaire");
  assert.match(lu.contents[0].text, /^<!doctype html>/);
  assert.deepEqual(J(lu.contents[0]._meta.ui.csp), { connectDomains: [], resourceDomains: [] }, "aucune origine externe demandée");
  assert.ok(prompts.completer_profil);
});

test("formulaire : champ hors catalogue refusé (avec les champs proches), doublon et nombre de questions", { skip: SANS_STRIP }, async () => {
  const { outils } = serveurFormulaire();
  let r = await outils.formulaire.fn({ titre: "Test", questions: [{ champ: "risque.horizon" }, { champ: "foyer.tmii" }] });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /champ hors catalogue/); assert.match(r.content[0].text, /« foyer\.tmii » inconnu ; champs proches : foyer\.tmi/);
  r = await outils.formulaire.fn({ titre: "Test", questions: [{ champ: "budget.depenses" }] });
  assert.equal(r.isError, true, "les entités multiples ne sont pas au catalogue");
  r = await outils.formulaire.fn({ titre: "Test", questions: [{ champ: "foyer.tmi" }, { champ: "foyer.tmi" }] });
  assert.match(r.content[0].text, /Champ en double : foyer\.tmi/);
  r = await outils.formulaire.fn({ titre: "Test", questions: Array.from({ length: 21 }, () => ({ champ: "foyer.tmi" })) });
  assert.match(r.content[0].text, /1 à 20/);
  r = await outils.formulaire.fn({ titre: "Test", questions: [] });
  assert.equal(r.isError, true);
});

test("formulaire : questions complétées par le catalogue, libellé du LLM gardé, {nom}, aides calculées arrondies, repli texte", { skip: SANS_STRIP }, async () => {
  const { outils, M, donnees } = serveurFormulaire();
  const r = await outils.formulaire.fn({ titre: "Ton profil de risque", intro: "Dix questions.", questions: [
    { champ: "risque.perte_max", libelle: "Jusqu'où peux-tu voir baisser tes placements ?" }, { champ: "risque.reaction" }, { champ: "risque.part_investie" },
    { champ: "risque.horizon" }, { champ: "risque.matelas" }, { champ: "risque.experience" }, { champ: "personnes.p2.salaire" }, { champ: "risque.connaissances", aide: "Coche ce que tu sais expliquer." }] });
  assert.ok(!r.isError, r.content[0].text);
  const f = r.structuredContent;
  assert.match(f.formulaire_id, /^[0-9a-f-]{36}$/); assert.equal(f.titre, "Ton profil de risque"); assert.equal(f.mention, "Indicateur pédagogique, pas un conseil en investissement.");
  const q = c => f.questions.find(x => x.champ === c);
  assert.equal(q("risque.perte_max").libelle, "Jusqu'où peux-tu voir baisser tes placements ?", "libellé du LLM gardé");
  assert.equal(q("risque.perte_max").type, "choix"); assert.deepEqual(J(q("risque.perte_max").valeurs.map(o => o.v)), ["p5", "p10", "p20", "p35", "plus"], "valeurs du catalogue");
  assert.equal(q("risque.reaction").libelle, "Tes placements perdent 20 % en trois mois. Que fais-tu ?", "libellé du catalogue sinon");
  assert.equal(q("risque.connaissances").aide, "Coche ce que tu sais expliquer.");
  assert.equal(q("personnes.p2.salaire").libelle, "Quel est le salaire de Sam ?", "{nom} → prénom");
  assert.equal(q("risque.experience").max, 80); assert.ok(!("cible" in q("risque.experience")) && !("chemin" in q("risque.experience")));
  // aides calculées sur les vraies données (démo), arrondies
  const a = M.allocationReelle(donnees.positions, "foyer"), rp = M.risquePortefeuille(donnees.positions, "foyer");
  assert.ok(q("risque.perte_max").aide_donnees.includes("environ " + Math.round(-rp.baissePlausible) + " % sur un an"), q("risque.perte_max").aide_donnees);
  assert.ok(q("risque.perte_max").aide_donnees.includes("environ " + Math.round(-rp.pireBaisseHistorique) + " %"));
  assert.ok(q("risque.part_investie").aide_donnees.includes("environ " + Math.round(100 - a.pct.securise) + " %"));
  assert.match(q("risque.reaction").aide_donnees, /environ \d{1,3}( \d{3})* €\), une baisse de 20 % représenterait environ \d{1,3}( \d{3})* €/);
  for (const m of q("risque.reaction").aide_donnees.match(/\d{1,3}(?: \d{3})+ €|\d+ €/g)) assert.ok(Number(m.replace(/\D/g, "")) % 100 === 0, "montant arrondi : " + m);
  assert.match(q("risque.matelas").aide_donnees, /^« Hors placements » : l'épargne que tu ne comptes pas investir/);
  assert.match(q("risque.horizon").aide_donnees, /^Repère : ton objectif « Apport maison » \(60 000 €, échéance juin 2029\) représente l'essentiel de ton épargne actuelle ; son échéance est dans environ 3 ans\.$/,
    "démo : l'apport (60 000 €) dépasse la moitié de l'encours financier");
  for (const x of f.questions) if (x.aide_donnees) assert.doesNotMatch(x.aide_donnees, /devrais|conseill|recommand|il faut|choisis/i, "les aides informent sans recommander");
  // repli texte : questions numérotées, valeurs permises, aides
  const t = r.content[0].text;
  assert.match(t, /^Formulaire « Ton profil de risque »/); assert.match(t, /\n1\. \[Perte maximale\] Jusqu'où peux-tu voir/); assert.match(t, /p5 = 5 % ; p10 = 10 %/);
  assert.match(t, /aucun = Aucun de ces placements \(seule\)/); assert.match(t, /Nombre de 0 à 80 ans, par pas de 1/); assert.match(t, /set_risk_answers/);
  assert.match(t, /Indicateur pédagogique, pas un conseil en investissement\.$/);
});

test("formulaire : aide « horizon » sur un objectif d'achat qui mobilise la majorité de l'épargne", { skip: SANS_STRIP }, async () => {
  const objectifs = [{ id: "o1", nom: "Apport maison", type: "apport", cible: 1e7, date_cible: "2029-06-30" }, { id: "o2", nom: "Retraite", type: "retraite", cible: 1e8, date_cible: "2040-01-01" }];
  const { outils } = serveurFormulaire({ objectifs });
  const r = await outils.formulaire.fn({ titre: "T", questions: [{ champ: "risque.horizon" }] });
  assert.equal(r.structuredContent.questions[0].aide_donnees, "Repère : ton objectif « Apport maison » (10 000 000 €, échéance juin 2029) représente l'essentiel de ton épargne actuelle ; son échéance est dans environ 3 ans.");
  const F = charges.F;
  assert.equal(F.arrondiEuros(12345), 12300); assert.equal(F.arrondiEuros(123456), 123000);
  const aides = F.aidesCalculees({ financier: 0, baissePlausible: 0, pireBaisse: 0, partExposee: null, objectif: null, monetaire: 0, depenses: 0 });
  assert.deepEqual(Object.keys(aides), ["risque.matelas"], "sans placements : seule la définition du matelas");
  assert.match(F.aidesCalculees({ financier: 1000, baissePlausible: -1, pireBaisse: -2, partExposee: 0, objectif: null, monetaire: 12340, depenses: 3000 })["risque.matelas"], /environ 12 300 € sur livrets et monétaire, soit environ 4 mois de dépenses\./);
});

test("formulaire : préremplissage uniquement depuis les valeurs déjà validées du même champ, jamais déduit", { skip: SANS_STRIP }, async () => {
  const profil = { foyer: { ...DEMO.profil.foyer, tmi: 25, age: "a40" }, protection: { prevoyance: true, emprunteur: "oui" },
    risque: { reponses: { horizon: "8-15", connaissances: ["etf", "inconnu"], experience: 99 } } };
  const { outils } = serveurFormulaire({ profil });
  const r = await outils.formulaire.fn({ titre: "T", questions: ["foyer.tmi", "foyer.age", "foyer.adultes", "protection.prevoyance", "protection.emprunteur",
    "risque.horizon", "risque.connaissances", "risque.experience", "risque.matelas", "risque.age", "personnes.p1.salaire"].map(champ => ({ champ })) });
  const v = Object.fromEntries(r.structuredContent.questions.map(q => [q.champ, q.valeur_actuelle]));
  assert.deepEqual(v, {
    "foyer.tmi": undefined, "foyer.age": "a40", "foyer.adultes": 2, "protection.prevoyance": true, "protection.emprunteur": undefined,
    "risque.horizon": "8-15", "risque.connaissances": undefined, "risque.experience": undefined,
    "risque.matelas": undefined, "risque.age": undefined, "personnes.p1.salaire": 2800,
  }, "valeurs invalides ignorées ; matelas et âge du questionnaire jamais déduits du patrimoine ni de foyer.age");
});

test("soumettre_formulaire : champ ou valeur hors catalogue refusés, rien n'est déposé", { skip: SANS_STRIP }, async () => {
  for (const reponses of [{ "foyer.tmi": 25 }, { "risque.horizon": "jamais" }, { "budget.loyer": 800 }, { "risque.connaissances": ["aucun", "etf"] },
    { "risque.experience": 81 }, { "risque.experience": -1 }, { "risque.experience": 2.5 }, { "personnes.p1.salaire": -10 }, { "protection.prevoyance": "oui" }, {}]) {
    const { outils, appels } = serveurFormulaire();
    const r = await outils.soumettre_formulaire.fn({ reponses });
    assert.equal(r.isError, true, JSON.stringify(reponses));
    assert.equal(appels.deposer.length + appels.profil.length + appels.risque.length + appels.protection.length, 0, "aucun dépôt : " + JSON.stringify(reponses));
  }
  const { outils } = serveurFormulaire();
  const r = await outils.soumettre_formulaire.fn({ reponses: { "risque.connaissances": ["aucun", "etf"], "foyer.tmi": 30, "x.y": 1 } });
  assert.match(r.content[0].text, /« Aucun de ces placements » \(aucun\) ne se combine pas/); assert.match(r.content[0].text, /« x\.y » : champ hors catalogue/);
});

test("soumettre_formulaire : regroupement par cible, un seul lot (formulaire_id), source exacte, profil estimé", { skip: SANS_STRIP }, async () => {
  const { outils, appels } = serveurFormulaire({ risque: { reponses: { objectif: "croissance", revenus: "cdi" } } });
  const id = "11111111-2222-4333-8444-555555555555";
  const r = await outils.soumettre_formulaire.fn({ formulaire_id: id, reponses: {
    "foyer.tmi": "30", "foyer.adultes": 2, "personnes.p1.salaire": "3200", "personnes.p1.salaireUnite": "nm", "autres.p2.usage": 8000,
    "protection.prevoyance": false, "risque.horizon": "8-15", "risque.connaissances": ["etf", "actions"], "risque.experience": 6, "risque.perte_max": "p20" } });
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(appels.profil, [{ foyer: { tmi: 30, adultes: 2 }, personnes: { p1: { salaire: 3200, salaireUnite: "nm" } }, autres: { p2: { usage: 8000 } } }]);
  assert.deepEqual(appels.risque, [{ horizon: "8-15", connaissances: ["etf", "actions"], experience: 6, perte_max: "p20" }]);
  assert.deepEqual(appels.protection, [{ prevoyance: false }]);
  assert.equal(appels.deposer.length, 1, "un seul dépôt");
  assert.deepEqual(appels.deposer[0].d, { source: "Saisi par toi dans le formulaire interactif", lot: id });
  assert.deepEqual(appels.deposer[0].items.map(i => i.cible), ["profil", "risque", "protection"]);
  const s = r.structuredContent;
  assert.equal(s.lot, id); assert.equal(s.nombre, 3);
  assert.ok(s.resume.some(x => x.champ === "risque.connaissances" && x.valeur === "ETF (fonds indiciels cotés), Actions"));
  assert.match(s.rappel, /Boussole › Agent › À valider/);
  // profil estimé : réponses validées (objectif, revenus) + réponses du formulaire, comme Risque.evaluer
  const web = Risque.evaluer({ objectif: "croissance", revenus: "cdi", horizon: "8-15", connaissances: ["etf", "actions"], experience: 6, perte_max: "p20" }, {});
  assert.equal(s.profil_estime.score, web.score); assert.equal(s.profil_estime.profil.id, web.profil);
  assert.ok(s.profil_estime.profil_equivalent_portefeuille, "comparaison au portefeuille réel");
  assert.match(s.profil_estime.comparaison, /^Ton portefeuille se comporte comme un profil /);
  assert.match(s.pour_le_modele, /Profil de risque estimé : /); assert.match(s.pour_le_modele, /signale tout écart avec le risque réel du portefeuille/);
  assert.equal(r.content[0].text, s.pour_le_modele);
  // sans réponse de risque : pas de profil estimé ; sans formulaire_id : nouveau lot
  const b = serveurFormulaire();
  const r2 = await b.outils.soumettre_formulaire.fn({ formulaire_id: "pas-un-uuid", reponses: { "foyer.enfants": 1 } });
  assert.equal(r2.structuredContent.profil_estime, undefined); assert.deepEqual(b.appels.deposer[0].d, { source: "Saisi par toi dans le formulaire interactif" });
});

test("profil estimé : port fidèle de Risque.evaluer (scores, profils, garde-fous, textes tutoyés) sur plusieurs jeux de réponses", { skip: SANS_STRIP }, () => {
  const { F } = charges;
  const jeux = [
    {}, { horizon: "gt15" },
    { horizon: "gt15", objectif: "maximiser", reaction: "renforcer", perte_max: "plus", connaissances: ["etf", "actions", "levier"], experience: 12, revenus: "fonctionnaire", matelas: "oui", part_investie: "gt75", age: "u30" },
    { horizon: "lt2", objectif: "maximiser", reaction: "renforcer", perte_max: "plus", connaissances: ["etf"], experience: 10, revenus: "cdi", matelas: "oui", part_investie: "gt75", age: "a30" },
    { horizon: "8-15", objectif: "croissance", reaction: "rien", perte_max: "p10", connaissances: ["aucun"], experience: 0, revenus: "variables", matelas: "non", part_investie: "25-50", age: "a50" },
    { horizon: "5-8", reaction: "vendre_partie", perte_max: "p35", connaissances: ["aucun", "crypto"], experience: "3", matelas: "non" },
    { connaissances: ["livrets", "fonds_euros"], experience: 4, perte_max: "p5", age: "a70", part_investie: "lt10" },
    { horizon: "inconnu", experience: -2, connaissances: [], revenus: "sans" },
  ];
  for (const rep of jeux) {
    const web = Risque.evaluer(rep, {}), mcp = F.evaluerRisque(rep, Risque.PROFILS);
    const L = JSON.stringify(rep);
    for (const k of ["score", "profil", "profilAvantGardeFous", "complet"]) assert.equal(mcp[k], web[k], L + " : " + k);
    assert.deepEqual(J(mcp.manquantes), web.manquantes, L);
    assert.deepEqual(J(mcp.details), J(web.details), L + " : détails");
    assert.deepEqual(J(mcp.gardeFous.map(g => [g.cle, g.plafond, g.texte])), web.gardeFous.map(g => [g.cle, g.plafond, g.texte]), L + " : garde-fous");
  }
  assert.ok(jeux.some(rep => Risque.evaluer(rep, {}).gardeFous.length >= 2), "jeux avec plusieurs garde-fous couverts");
});

test("prompt completer_profil : une section par argument, formulaire pour le catalogue, import agrégé sans identifiants sinon", { skip: SANS_STRIP }, async () => {
  const { prompts } = serveurFormulaire();
  const p = prompts.completer_profil;
  assert.match(p.def.description, /foyer, revenus, protection, risque, budget, placements, immobilier, objectifs/);
  assert.deepEqual(J(charges.F.SECTIONS), ["foyer", "revenus", "protection", "risque", "budget", "placements", "immobilier", "objectifs"]);
  for (const section of charges.F.SECTIONS) {
    const t = p.fn({ section }).messages[0].content.text;
    assert.match(t, /^Boussole : aide-moi à compléter /); assert.match(t, /demarrer_session/); assert.match(t, /Boussole › Agent › À valider/);
    assert.doesNotMatch(t, /(^|[^\p{L}])(vous|votre|vos)(?![\p{L}])/iu, section + " : tutoiement");
  }
  const risque = p.fn({ section: "risque" }).messages[0].content.text;
  assert.match(risque, /outil formulaire/); assert.match(risque, /risque\.horizon, risque\.objectif/); assert.match(risque, /Ne réponds jamais à ma place/);
  const budget = p.fn({ section: "budget" }).messages[0].content.text;
  for (const m of [/totaux mensuels par catégorie .*, jamais les lignes brutes/, /IBAN/, /update_budget/, /que tu as déposé/]) assert.match(budget, m);
  assert.match(p.fn({ section: "placements" }).messages[0].content.text, /soldes, les positions .* opérations sur titres/);
  assert.throws(() => p.fn({ section: "voiture" }), /section/);
});

test("index.ts : formulaires branchés sur les mêmes fonctions de dépôt, directive dans INSTRUCTIONS et les conduites, import de fichiers", () => {
  const src = read(MCP + "index.ts");
  assert.match(src, /import \{ registerFormulaire \} from "\.\/formulaire\.ts";/);
  assert.match(src, /registerFormulaire\(server, \{ db, must, UserError, RO, RW, today,\s*calcul: \{ charger: chargerDonnees, entreesAides, PROFILS \},\s*depots: \{ profil: propositionProfil, risque: propositionRisque, protection: propositionProtection, deposer \} \}\);/);
  for (const [outil, fn] of [["update_profile", "propositionProfil"], ["set_risk_answers", "propositionRisque"], ["set_protection", "propositionProtection"]]) {
    const i = src.indexOf(`registerTool("${outil}"`), sec = src.slice(i, src.indexOf("registerTool(", i + 20) > 0 ? src.indexOf("registerTool(", i + 20) : src.indexOf("registerPrompt", i));
    assert.ok(sec.includes(`deposer(await ${fn}(`), `${outil} passe par ${fn}`);
  }
  const directive = "Dès que tu dois poser plusieurs questions (formulaire, questionnaire, données manquantes), utilise l'outil formulaire plutôt que des questions en texte. Ne réponds jamais à la place de l'utilisateur. Les aides informent, elles ne recommandent pas. Après l'envoi, résume ce qui a été proposé ; pour le profil de risque, résume le profil estimé et signale tout écart avec le risque réel du portefeuille.";
  const bloc = nom => src.slice(src.indexOf(nom), src.indexOf("].join", src.indexOf(nom)));
  assert.ok(bloc("const INSTRUCTIONS").toLowerCase().includes(directive.toLowerCase()), "INSTRUCTIONS");
  assert.ok(bloc("const CONDUITE_COPILOTE").includes(directive), "CONDUITE_COPILOTE");
  assert.match(bloc("const CONDUITE_ONBOARDING"), /utilise l'outil formulaire/); assert.match(bloc("const CONDUITE_ONBOARDING"), /Tutoiement, phrases courtes/);
  assert.match(bloc("const CONDUITE = ["), /utilise l'outil formulaire plutôt que des questions en texte/);
  for (const b of [bloc("const INSTRUCTIONS"), bloc("const CONDUITE_COPILOTE")]) {
    for (const m of [/agrège/, /jamais les lignes brutes/, /soldes, positions, opérations sur titres/, /retire tout identifiant \(IBAN/, /« Relevé … du … déposé par toi »/, /confirmer ou compléter ce qui est ambigu/]) assert.match(b, m);
  }
  assert.match(bloc('nom: "profil_de_risque"'), /outil formulaire \(champs risque\.\*\)/);
});

/* ====================================================== page (formulaire-ui.ts) ====================================================== */
test("page : un seul document autonome, sans URL externe ni <script src>, logique injectée telle quelle, mention", { skip: SANS_STRIP }, () => {
  const html = charges.UI.HTML_FORMULAIRE;
  assert.match(html, /^<!doctype html>\n<html lang="fr">/); assert.equal((html.match(/<html/g) || []).length, 1);
  assert.doesNotMatch(html, /<script[^>]*\ssrc=/i, "aucun script externe");
  assert.doesNotMatch(html, /https?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,}\//i, "aucune URL externe");
  assert.doesNotMatch(html, /<link\b|@import|url\(|<iframe|<img/i, "aucune ressource chargée");
  assert.ok(html.includes(read(MCP + "formulaire-logique.js")), "formulaire-logique.js injecté tel quel");
  assert.ok(html.includes("Indicateur pédagogique, pas un conseil en investissement."));
  for (const k of ["ui/initialize", "ui/notifications/initialized", "ui/notifications/tool-result", "tools/call", "soumettre_formulaire", "ui/update-model-context", "ui/notifications/size-changed", '"2026-01-26"'])
    assert.ok(html.includes(k), k);
  assert.match(html, /:root\[data-theme="dark"\]/); assert.match(html, /var\(--color-background-primary, #ffffff\)/, "variables de l'hôte avec valeurs de secours");
  assert.match(html, /@media \(max-width: 420px\)/);
  assert.doesNotMatch(charges.UI.SCRIPT_VUE, /innerHTML/, "aucun texte inséré en HTML");
});

/** Page jouée dans un mini-DOM avec un faux hôte MCP Apps (postMessage JSON-RPC). */
function pageAvecHote() {
  const { doc, Ev } = miniDom();
  const proto = Object.getPrototypeOf(doc.body);
  Object.defineProperty(proto, "style", { configurable: true, get() { return this._style || (this._style = { setProperty(k, v) { this[k] = v; } }); } });
  doc.getElementById = id => doc.documentElement.querySelector("#" + id);
  doc.body.innerHTML = charges.UI.CORPS;
  doc.body.scrollHeight = 480; doc.documentElement.clientWidth = 380;
  const recus = [], ecouteurs = [];
  const hote = { postMessage: m => recus.push(structuredClone(m)) };
  const win = { document: doc, parent: hote, console, Promise, JSON, Math, Object, Array, String, Number, Error, setTimeout,
    addEventListener: (t, f) => { if (t === "message") ecouteurs.push(f); } };
  win.window = win; win.self = win;
  vm.runInNewContext(read(MCP + "formulaire-logique.js") + "\n" + charges.UI.SCRIPT_VUE, win);
  const envoyer = (data, source = hote) => ecouteurs.forEach(f => f({ source, data: structuredClone(data) }));
  return { doc, Ev, recus, envoyer, win, $: id => doc.getElementById(id) };
}
const attendre = () => new Promise(r => setImmediate(r));
const opts = $ => $("fbCtrl").querySelectorAll(".fb-opt");
const coches = $ => opts($).filter(b => b.getAttribute("aria-checked") === "true").map(b => b.textContent);

test("page : protocole MCP Apps simulé — initialize → initialized → tool-result → rendu → réponses → tools/call → update-model-context", { skip: SANS_STRIP }, async () => {
  const srv = serveurFormulaire({ profil: { risque: { reponses: { horizon: "8-15" } } } });
  const res = await srv.outils.formulaire.fn({ titre: "Ton profil de risque", intro: "Quatre questions.", questions: [
    { champ: "risque.horizon" }, { champ: "risque.connaissances" }, { champ: "risque.experience" }, { champ: "protection.prevoyance" }] });
  const P = pageAvecHote(), { $, recus } = P;
  // 1. handshake
  assert.equal(recus.length, 1);
  assert.deepEqual(recus[0], { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { appInfo: { name: "Boussole — formulaire", version: "1.0.0" }, appCapabilities: { availableDisplayModes: ["inline"] }, protocolVersion: "2026-01-26" } });
  P.envoyer({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2026-01-26", hostInfo: { name: "faux", version: "1" }, hostCapabilities: { serverTools: {} },
    hostContext: { theme: "dark", styles: { variables: { "--color-text-primary": "#fafafa", "--font-sans": "Test Sans" } } } } });
  await attendre();
  assert.equal(P.doc.documentElement.getAttribute("data-theme"), "dark", "hostContext.theme appliqué");
  assert.equal(P.doc.documentElement.style["--color-text-primary"], "#fafafa", "variables de l'hôte appliquées");
  assert.deepEqual(recus[1], { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
  assert.ok(recus.some(m => m.method === "ui/notifications/size-changed" && m.params.height === 480 && m.params.width === 380), "taille signalée");
  // 2. arguments puis résultat de l'outil formulaire
  P.envoyer({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { titre: "Ton profil de risque" } } });
  assert.equal($("fbForm").hidden, true, "rien n'est rendu avant le résultat");
  P.envoyer({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: res.content, structuredContent: res.structuredContent } });
  assert.equal($("fbForm").hidden, false); assert.equal($("fbChargement").hidden, true);
  assert.equal($("fbTitre").textContent, "Ton profil de risque"); assert.equal($("fbIntro").textContent, "Quatre questions.");
  assert.equal($("fbCompteur").textContent, "Question 1 sur 4"); assert.equal($("fbBarre").style.width, "25%");
  assert.equal($("fbLib").textContent, "Dans combien de temps auras-tu besoin de la majeure partie de cet argent ?");
  assert.deepEqual(coches($), ["8 à 15 ans"], "valeur validée préremplie");
  assert.match($("fbQuestion").textContent, /Déjà renseigné dans Boussole : 8 à 15 ans/);
  assert.equal($("fbPrec").disabled, true); assert.equal($("fbSuiv").textContent, "Suivante");
  opts($).find(b => b.textContent === "Plus de 15 ans").click();
  assert.deepEqual(coches($), ["Plus de 15 ans"]);
  $("fbSuiv").click();
  // 3. choix multiple : erreur en ligne sans bloquer, exclusivité
  assert.equal($("fbCompteur").textContent, "Question 2 sur 4");
  $("fbSuiv").click();
  assert.equal($("fbErreur").hidden, false); assert.match($("fbErreur").textContent, /Choisis une réponse/); assert.equal($("fbCompteur").textContent, "Question 2 sur 4");
  assert.notEqual($("fbSuiv").disabled, true, "le bouton n'est jamais bloqué");
  const clic = label => opts($).find(b => b.textContent === label).click();
  clic("Actions"); clic("ETF (fonds indiciels cotés)");
  assert.equal($("fbErreur").hidden, true);
  assert.deepEqual(coches($), ["ETF (fonds indiciels cotés)", "Actions"]);
  clic("Aucun de ces placements"); assert.deepEqual(coches($), ["Aucun de ces placements"], "« aucun » exclusif");
  clic("Actions"); assert.deepEqual(coches($), ["Actions"]);
  $("fbSuiv").click();
  // 4. curseur
  assert.equal($("fbValeur").textContent, "Déplace le curseur");
  const r = $("fbCtrl").querySelector(".fb-curseur");
  assert.equal(r.getAttribute("min"), "0"); assert.equal(r.getAttribute("max"), "80"); assert.equal(r.getAttribute("step"), "1");
  r.value = "6"; r.dispatchEvent(new P.Ev("input"));
  assert.equal($("fbValeur").textContent, "6 ans"); assert.match($("fbCtrl").textContent, /5 à 9 ans/);
  $("fbPrec").click(); assert.equal($("fbCompteur").textContent, "Question 2 sur 4"); assert.deepEqual(coches($), ["Actions"], "réponses conservées");
  $("fbSuiv").click(); assert.equal($("fbValeur").textContent, "6 ans", "valeur du curseur conservée");
  $("fbSuiv").click();
  // 5. oui / non puis envoi
  assert.equal($("fbSuiv").textContent, "Envoyer mes réponses");
  clic("Non");
  const avant = recus.length;
  $("fbSuiv").click();
  await attendre();
  const appel = recus.slice(avant).find(m => m.method === "tools/call");
  assert.ok(appel, "tools/call envoyé");
  assert.deepEqual(appel.params, { name: "soumettre_formulaire", arguments: { formulaire_id: res.structuredContent.formulaire_id,
    reponses: { "risque.horizon": "gt15", "risque.connaissances": ["actions"], "risque.experience": 6, "protection.prevoyance": false } } });
  assert.equal($("fbSuiv").textContent, "Envoi en cours…");
  // 6. le faux hôte relaie au vrai outil soumettre_formulaire
  const sortie = await srv.outils.soumettre_formulaire.fn(appel.params.arguments);
  assert.ok(!sortie.isError, sortie.content[0].text);
  assert.equal(srv.appels.deposer.length, 1);
  P.envoyer({ jsonrpc: "2.0", id: appel.id, result: sortie });
  await attendre();
  assert.equal($("fbFin").hidden, false); assert.equal($("fbForm").hidden, true);
  assert.match($("fbFin").textContent, /Réponses envoyées/); assert.match($("fbFin").textContent, /Profil estimé : /); assert.match($("fbFin").textContent, /Boussole › Agent › À valider/);
  const ctx = recus.find(m => m.method === "ui/update-model-context");
  assert.ok(ctx, "résumé envoyé au modèle");
  assert.deepEqual(ctx.params, { content: [{ type: "text", text: sortie.structuredContent.pour_le_modele }] });
  P.envoyer({ jsonrpc: "2.0", id: ctx.id, result: {} });
  await attendre();
});

test("page : refus du serveur affiché en ligne (réponses conservées), échec de l'hôte, résultat d'erreur de l'outil", { skip: SANS_STRIP }, async () => {
  const srv = serveurFormulaire();
  const res = await srv.outils.formulaire.fn({ titre: "T", questions: [{ champ: "foyer.tmi" }] });
  const P = pageAvecHote(), { $, recus } = P;
  P.envoyer({ jsonrpc: "2.0", id: 1, result: { hostContext: { theme: "light" } } });
  await attendre();
  assert.equal(P.doc.documentElement.getAttribute("data-theme"), "light");
  P.envoyer({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: res });
  assert.deepEqual(coches($), ["30 %"], "TMI validée préremplie");
  $("fbSuiv").click(); await attendre();
  let appel = recus.filter(m => m.method === "tools/call").pop();
  P.envoyer({ jsonrpc: "2.0", id: appel.id, result: { content: [{ type: "text", text: "Aucune proposition déposée : réponses refusées." }], isError: true } });
  await attendre();
  assert.equal($("fbForm").hidden, false); assert.match($("fbErreur").textContent, /réponses refusées/); assert.deepEqual(coches($), ["30 %"]);
  $("fbSuiv").click(); await attendre();
  appel = recus.filter(m => m.method === "tools/call").pop();
  P.envoyer({ jsonrpc: "2.0", id: appel.id, error: { code: -32000, message: "refusé par l'hôte" } });
  await attendre();
  assert.match($("fbErreur").textContent, /L'envoi a échoué \(refusé par l'hôte\)\. Tes réponses sont conservées/);
  const Q2 = pageAvecHote();
  Q2.envoyer({ jsonrpc: "2.0", id: 1, result: {} }); await attendre();
  Q2.envoyer({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [{ type: "text", text: "Aucun formulaire affiché : champ hors catalogue." }], isError: true } });
  assert.equal(Q2.$("fbChargement").textContent, "Aucun formulaire affiché : champ hors catalogue.");
  // messages d'une autre source que l'hôte : ignorés
  const Q3 = pageAvecHote();
  Q3.envoyer({ jsonrpc: "2.0", id: 1, result: {} }, { postMessage() {} }); await attendre();
  assert.equal(Q3.recus.length, 1, "pas d'initialized sur une réponse venue d'ailleurs");
  Q3.envoyer({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: res }, { postMessage() {} });
  assert.equal(Q3.$("fbForm").hidden, true);
});

/* ====================================================== tutoiement ====================================================== */
test("tutoiement : aucun « vous » / « votre » / « vos » dans les textes du connecteur, ni dans les textes de l'app recopiés pour la parité", () => {
  const VOUS = /(^|[^\p{L}])(vous|votre|vos|vôtres?)(?![\p{L}])/iu;
  // Liste d'exceptions motivées (littéral entier) : « Entre vous deux », libellé de la sous-catégorie transfert_foyer de la copie du module de catégories du budget
  // (budget-categories.gen.js, BUD1) : il désigne les deux personnes du foyer entre elles, pas un vouvoiement ; texte de la taxonomie de la fixture. Les moteurs de l'app
  // (plan, pratiques, risque, bilan-etat) sont au tutoiement.
  const EXCEPTIONS = ["Entre vous deux"];
  const fichiers = readdirSync(path(MCP)).filter(f => /\.(ts|js)$/.test(f));
  assert.ok(fichiers.includes("formulaire.ts") && fichiers.includes("catalogue.gen.ts") && fichiers.includes("index.ts"));
  const litterauxDe = code => [...code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    .matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|'((?:[^'\\\n]|\\.)*)'/g)].map(m => m[1] ?? m[2] ?? m[3]);
  for (const f of fichiers) for (const l of litterauxDe(read(MCP + f)))
    assert.ok(!VOUS.test(l) || EXCEPTIONS.includes(l), `${f} : vouvoiement : « ${l.slice(0, 120)} »`);
  // Les moteurs de l'app dont le connecteur recopie les textes (tests de parité) sont eux aussi au tutoiement.
  for (const m of ["plan", "pratiques", "risque", "bilan-etat", "rules", "reel"]) for (const l of litterauxDe(read(`web/src/${m}.js`)))
    assert.ok(!VOUS.test(l), `web/src/${m}.js : vouvoiement : « ${l.slice(0, 120)} »`);
  assert.ok(read(MCP + "index.ts").includes('texte = "Ton portefeuille se comporte comme un profil "'));
});
