// FIX5 — un indicateur, une définition : le même chiffre sur chaque écran (et dans le connecteur quand l'indicateur y est exposé).
// Audit UX mobile (docs/boussole-ux-mobile.md, constat 3) : variation du patrimoine net (Aujourd'hui ≠ Comptes, qui clignotait),
// capacité d'épargne (31 % puis 48 % sur Budget), complétude (100 % avec « Protection non renseignée », 75 % dans Agent › Connexion),
// crédits (1 listé au lieu de 2). Constat 7 : tutoiement (« l'utilisateur » dans Propositions) et mot « conseiller » (test à part :
// test/conseiller.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const A = require("../web/src/aujourdhui.js");
const CV = require("../web/src/comptes-view.js");
const SN = require("../web/src/serie-net.js");
const PV = require("../web/src/plan-view.js");
const PF = require("../web/src/profil.js");
const PP = require("../web/src/propositions.js");
const Calc = require("../web/src/calc.js");
const BilanCalc = require("../web/src/bilan-calc.js");
const BilanEtat = require("../web/src/bilan-etat.js");
const Bilan = require("../web/src/bilan.js");
const Periodes = require("../web/src/periodes.js");
const Historique = require("../web/src/historique.js");
const Rules = require("../web/src/rules.js");
const Plan = require("../web/src/plan.js");
const Pratiques = require("../web/src/pratiques.js");
const Risque = require("../web/src/risque.js");
const UI = require("../web/src/ui.js");
const DEMO = require("../web/src/demo-data.js");

const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ");
const jourLocal = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
const demoS = () => Object.assign(J(DEMO), { ready: true, dbOk: true, scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], error: null });
const DEPS = { Rules, Plan, Pratiques, Calc, BilanCalc, Risque, Periodes };
const TODAY = jourLocal();
/* Passé reconstitué synthétique : 400 jours avant la première photo, net à 150 000 € puis recalé sur la photo (Historique.fusionner). */
function reconstitue(S) {
  const prem = A.premiereDate(S.snapshots), rec = { points: [], decalage: 0 };
  for (let d = Historique.plusJours(prem, -400); d <= Historique.plusJours(TODAY, -1); d = Historique.plusJours(d, 1)) rec.points.push({ date: d, net: 150000 });
  return rec;
}
/* « +9 646 € · +5,2 % » (Fmt.fmtDelta) lu dans un HTML : [montant, pourcentage]. */
const lu = h => { const m = sp(h.replace(/<[^>]+>/g, " ")).match(/([+−]\d[\d ]* €)\s*(?:\(|·\s*)([+−][\d,]+ %)/); return m ? [m[1], m[2]] : null; };

/* ====================================================== 1. variation du patrimoine net ====================================================== */

test("variation du patrimoine net : Aujourd'hui, Patrimoine › Comptes et SerieNet donnent le même montant et le même % pour chaque période, avec ou sans passé reconstitué", () => {
  const S = demoS();
  for (const rec of [undefined, reconstitue(S)]) for (const id of ["1m", "3m", "1a", "tout"]) {
    const periode = { id, granularite: "mois" }, deps = Object.assign({}, DEPS, rec ? { reconstitue: rec } : {});
    SN.definirPeriode(periode);
    const aj = A.indicateurs(S, TODAY, periode, deps).net, cv = CV.entete(S, TODAY, deps).variation, sn = SN.variation(S, TODAY, periode, deps);
    const nom = id + (rec ? " reconstitué" : " observé");
    assert.ok(cv && sn && aj.variation != null, "variation disponible : " + nom);
    assert.equal(cv.montant, aj.variation, "montant : " + nom);
    assert.equal(cv.pct, aj.variationPct, "pourcentage : " + nom);
    assert.equal(sn.montant, aj.variation);
    assert.ok(sp(A.cartes(A.indicateurs(S, TODAY, periode, deps), UI, periode)).replace(/&#39;/g, "'").includes(cv.texte), "la même période est écrite à côté du chiffre : " + nom);
  }
  SN.reinitialiser();
});

test("variation du patrimoine net : la période par défaut est la même (1 an) ; les deux écrans écrivent la même période et le même chiffre", () => {
  SN.reinitialiser();
  assert.deepEqual(J(SN.periode()), { id: "1a" });
  const S = demoS(), rec = reconstitue(S), deps = Object.assign({}, DEPS, { reconstitue: rec });
  const carte = A.cartes(A.indicateurs(S, TODAY, SN.periode(), deps), UI, SN.periode());
  const entete = CV.enteteHtml(CV.entete(S, TODAY, deps));
  assert.deepEqual(lu(carte), lu(entete), "même « +x € (+y %) » sur Aujourd'hui et Comptes");
  assert.ok(lu(carte), "chiffre trouvé");
  assert.match(sp(carte), /sur 1 an/); assert.match(sp(entete), /sur 1 an/);
  assert.doesNotMatch(sp(entete), /depuis le \d/, "plus de « depuis le 31 août » : la période est celle d'Aujourd'hui");
  // changer la période d'Aujourd'hui change aussi Comptes (période partagée)
  SN.definirPeriode({ id: "3m" });
  assert.match(sp(CV.enteteHtml(CV.entete(S, TODAY, deps))), /sur 3 mois/);
  SN.reinitialiser();
});

test("variation du patrimoine net : tant que le passé est lu, aucun chiffre provisoire (squelette) sur Aujourd'hui comme sur Comptes ; le chiffre définitif ne change plus ensuite", () => {
  const S = demoS(), rec = reconstitue(S);
  const attente = Object.assign({}, DEPS, { reconstitue: rec, enAttente: true });
  const ind = A.indicateurs(S, TODAY, { id: "1a" }, attente);
  assert.equal(ind.net.enAttente, true);
  const carte = sp(A.cartes(ind, UI, { id: "1a" }));
  assert.match(carte, /ui-skel/); assert.equal(lu(carte), null, "pas de chiffre provisoire");
  assert.match(carte, /variation en cours de calcul/, "dit aux lecteurs d'écran que ça calcule");
  const entete = sp(CV.enteteHtml(CV.entete(S, TODAY, attente)));
  assert.match(entete, /ui-skel/); assert.equal(lu(entete), null);
  const fini = Object.assign({}, attente, { enAttente: false });
  assert.ok(lu(A.cartes(A.indicateurs(S, TODAY, { id: "1a" }, fini), UI, { id: "1a" })));
  assert.deepEqual(lu(A.cartes(A.indicateurs(S, TODAY, { id: "1a" }, fini), UI, { id: "1a" })), lu(CV.enteteHtml(CV.entete(S, TODAY, fini))));
});

/* Les deux vues dans un même navigateur simulé, une seule lecture de l'historique des cours partagée. */
function deuxVues() {
  const src = f => readFileSync("web/src/" + f, "utf8");
  const dom = miniDom(), { doc } = dom, reg = {}, ls = new Map();
  let liberer; const attente = new Promise(r => { liberer = r; });
  const appels = [];
  const serie = () => { const out = []; for (let k = 1500; k >= 1; k--) out.push({ date: Historique.plusJours(TODAY, -k), cloture: 100 + (1500 - k) * 0.02 }); return out; };
  const store = { cours: async (isins, depuis) => { appels.push([isins, depuis]); await attente; return Object.fromEntries(isins.map(i => [i, serie().filter(c => c.date >= depuis)])); },
    transactions: async () => [], banque: { operations: async () => [] } };
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, Date, Math, JSON, URLSearchParams, encodeURIComponent, decodeURIComponent, Store: store, scrollY: 0, scrollTo() {},
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
    App: { register: (n, a) => { reg[n] = a; }, parametres: () => ({}) } };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ["format.js", "calc.js", "serie-net.js", "rules.js", "plan.js", "historique.js", "bilan-calc.js", "periodes.js", "graphe-patrimoine.js", "marche.js", "risque.js", "pratiques.js", "ui.js",
    "claude-prompts.js", "routine-etat.js", "banque-etat.js", "reperes.js", "objectifs-view.js"]) vm.runInContext(src(f), ctx, { filename: f });
  vm.runInContext(src("aujourdhui.js"), ctx, { filename: "aujourdhui.js" });
  vm.runInContext(src("comptes-view.js"), ctx, { filename: "comptes-view.js" });
  const montes = {};
  for (const [nom, id] of [["aujourdhui", "view-aujourdhui"], ["comptes-view", "view-comptes-view"]]) {
    const root = doc.createElement("section"); root.setAttribute("id", id); doc.body.appendChild(root); root.innerHTML = src(nom + ".html");
    reg[nom].mount(root); montes[nom] = root;
  }
  return { reg, montes, liberer, appels, ls };
}
const attend = (ms = 60) => new Promise(r => setTimeout(r, ms));

test("vues : au chargement, ni Aujourd'hui ni Comptes n'affichent de chiffre provisoire ; une fois le passé lu, les deux affichent le même, une seule lecture des cours", async () => {
  const v = deuxVues(), S = demoS();
  const S2 = Object.assign(S, { banque: Object.assign({}, S.banque, { actif: true, mfaRequise: false }) });
  v.reg.aujourdhui.update(S2, true);
  v.reg["comptes-view"].update(S2, false);
  v.reg["comptes-view"].show();
  await attend();
  const cartes = () => v.montes.aujourdhui.querySelector("#ajCartes").innerHTML, tete = () => v.montes["comptes-view"].querySelector("#cvTete").innerHTML;
  assert.equal(lu(cartes()), null, "Aujourd'hui : pas de variation avant la fin de la lecture");
  assert.equal(lu(tete()), null, "Comptes : idem");
  assert.match(cartes(), /ui-skel/); assert.match(tete(), /ui-skel/);
  v.liberer();
  await attend();
  const a = lu(cartes()), c = lu(tete());
  assert.ok(a, "Aujourd'hui : variation affichée une fois le passé lu");
  assert.deepEqual(c, a, "Comptes : le même chiffre qu'Aujourd'hui");
  assert.match(sp(tete()), /sur 1 an/);
  assert.equal(v.appels.length, 1, "la lecture des cours est partagée entre les deux vues");
  // un nouveau rendu ne change plus le chiffre (plus de clignotement)
  v.reg.aujourdhui.update(J(S2), true);
  v.reg["comptes-view"].update(J(S2), true);
  await attend();
  assert.deepEqual(lu(cartes()), a); assert.deepEqual(lu(tete()), a);
  SN.reinitialiser();
});

/* ====================================================== 2. capacité d'épargne ====================================================== */

test("capacité d'épargne : sur l'écran Budget, la mesure du budget et celle des comptes ne portent jamais le même nom avec deux nombres différents", () => {
  const S = demoS(), L = S.budget.lignes;
  const totaux = Plan.budgetTotaux(L, S.profil, "foyer"), prevue = Math.round(totaux.tauxEpargne * 100);
  const texte = h => sp(h.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'"));
  const cartes = texte(PV.cartesHtml(PV.resume(totaux, "mois", true), UI, { duScope: "du foyer" }));
  const br = { n: 3, du: "2026-07-01", au: "2026-09-01", revenus: 5000, depenses: 800, epargne: 750, tauxEpargne: 0.15, capacite: 4200, tauxCapacite: 0.84, parCompte: true };
  const reelle = texte(PV.tauxReelHtml(br));
  const tout = cartes + " " + reelle;
  const mesures = [...tout.matchAll(/(Capacité d'épargne(?: prévue au budget| réelle, (?:\d+ derniers mois|dernier mois))?)\s*(-?\d+) %/g)].map(m => [m[1].trim().replace(/\s+/g, " "), +m[2]]);
  const parNom = new Map();
  for (const [nom, v] of mesures) { assert.ok(!parNom.has(nom) || parNom.get(nom) === v, "« " + nom + " » a deux valeurs"); parNom.set(nom, v); }
  assert.deepEqual([...parNom.keys()].sort(), ["Capacité d'épargne prévue au budget", "Capacité d'épargne réelle, 3 derniers mois"], "deux mesures, deux noms");
  assert.equal(parNom.get("Capacité d'épargne prévue au budget"), prevue);
  assert.equal(parNom.get("Capacité d'épargne réelle, 3 derniers mois"), 84);
  assert.ok(prevue !== 84, "le cas de l'audit : deux nombres différents (31 % et 48 % sur la démo réelle)");
  assert.doesNotMatch(tout, /Capacité d'épargne\s+\d/, "jamais « Capacité d'épargne 31 % » sans qualificatif");
});

test("capacité d'épargne : le calcul réel est celui des comptes (Calc.budgetReel) et du connecteur (même formule), la mesure prévue celle du budget (Plan.budgetTotaux)", () => {
  const src = readFileSync("web/src/plan-view.js", "utf8");
  assert.match(src, /LIBELLE_PREVUE = "Capacité d'épargne prévue au budget"/);
  assert.match(src, /libelleReelle = n => "Capacité d'épargne réelle, "/);
  assert.match(src, /tauxEpargne/, "la carte lit Plan.budgetTotaux");
  assert.match(readFileSync("web/src/calc.js", "utf8"), /tauxCapacite: revenus > 0 \? \(revenus - depenses\) \/ revenus : null/, "réel : (revenus − dépenses) ÷ revenus, comme banque.ts");
  assert.match(readFileSync("supabase/functions/mcp/banque.ts", "utf8"), /capacit/i);
});

/* ====================================================== 3. complétude ====================================================== */

test("complétude : Compte › Données, Agent › Connexion et le connecteur utilisent BilanEtat.etat ; la protection non renseignée baisse le pourcentage", () => {
  const S = demoS();
  const e = BilanEtat.etat(S), c = PF.completude(S);
  assert.equal(c.pourcentage, e.pourcentage, "même pourcentage que le bilan (Agent › Connexion)");
  assert.equal(PF.resumeProtection(S.profil), "non renseignée", "cas de l'audit : protection non renseignée");
  assert.ok(c.pourcentage < 100, "…donc pas 100 %");
  assert.ok(c.incompletes.includes("Protection"), "la section Protection est citée parmi ce qui reste à compléter");
  // protection renseignée → le pourcentage monte, la section disparaît de la liste
  const protege = Object.assign({}, S, { profil: Object.assign({}, S.profil, { protection: { prevoyance: true, emprunteur: true } }) });
  assert.ok(PF.completude(protege).pourcentage > c.pourcentage);
  assert.ok(!PF.completude(protege).incompletes.includes("Protection"));
  // la vue Agent › Connexion lit la même fonction
  assert.match(readFileSync("web/src/claude-guide.js", "utf8"), /window\.BilanEtat\.etat\(S\)/);
  // plus de seconde fonction de complétude dans le calcul du profil
  assert.equal(Calc.completude, undefined); assert.equal(Calc.manquants, undefined);
  // le connecteur : etat_du_bilan est le port de la même fonction (parité testée par test/mcp.test.mjs « parité MCP / bilan-etat.js »)
  assert.match(readFileSync("supabase/functions/mcp/index.ts", "utf8"), /port de web\/src\/bilan-etat\.js/);
});

test("complétude : l'en-tête de Compte › Données (DOM) affiche le pourcentage du bilan et cite la protection", () => {
  const src = f => readFileSync("web/src/" + f, "utf8");
  const dom = miniDom(), { doc } = dom, reg = {};
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, Date, Math, JSON, App: { register: (n, a) => { reg[n] = a; }, parametres: () => ({}) }, Store: {} };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ["calc.js", "bilan-etat.js", "ui.js", "claude-prompts.js", "profil.js"]) vm.runInContext(src(f), ctx, { filename: f });
  const root = doc.createElement("section"); doc.body.appendChild(root); root.innerHTML = src("profil.html");
  reg.profil.mount(root);
  const S = Object.assign(demoS(), { profilLoaded: true });
  reg.profil.update(S, true);
  const pct = BilanEtat.etat(S).pourcentage;
  assert.equal(root.querySelector("#pfPct").textContent, pct + " %");
  assert.match(root.querySelector("#pfMissing").textContent, /^À compléter : .*protection/);
  assert.equal(reg.profil.headline(), pct + " % rempli");
  assert.match(root.querySelector("#pfResProtection").textContent, /non renseignée/);
});

/* ====================================================== 4. crédits ====================================================== */

test("crédits : Compte › Données, Patrimoine › Immobilier et crédits et la protection du bilan comptent les mêmes crédits (prêts des biens compris)", () => {
  const S = demoS(), pr = S.profil;
  const L = Calc.creditsEnCours(pr);
  assert.equal(L.length, 2, "démo : le prêt immobilier de l'appartement et le prêt auto");
  const a = Bilan.analyser(S, { Calc, Plan });
  assert.equal(a.nbCredits, L.length, "Immobilier et crédits : même nombre");
  assert.equal(a.dettes, L.reduce((x, c) => x + c.crd, 0), "même reste dû");
  assert.equal(a.mensualites, L.reduce((x, c) => x + c.mensualite, 0), "mêmes mensualités (1 030 €)");
  const r = sp(PF.resumeCredits(pr));
  assert.match(r, /^2 crédits, dont 1 prêt immobilier, 156 500 € restants, 1 030 €\/mois$/, "cas de l'audit : plus « 1 crédit, 6 500 € »");
  assert.equal(PF.aCredit(pr), true);
  // la protection du bilan demande l'assurance emprunteur dès qu'il y a un crédit (prêt immobilier compris)
  const sansAuto = Object.assign({}, S, { profil: Object.assign({}, pr, { credits: [], protection: { prevoyance: true } }) });
  assert.ok(BilanEtat.etat(sansAuto).sections.find(s => s.cle === "protection").manquants.some(q => q.champ === "protection.emprunteur"), "un prêt immobilier seul compte comme crédit");
  // la liste de la section Crédits montre les deux
  const html = sp(PF.sectionHtml("credits", pr, Calc));
  assert.match(html, /Prêt immobilier · Appartement/); assert.match(html, /Prêt auto/);
  // sans prêt immobilier : un seul crédit, partout
  const seul = Object.assign({}, pr, { biens: pr.biens.map(b => Object.assign({}, b, { crd: 0, mensualite: 0 })) });
  assert.equal(Calc.creditsEnCours(seul).length, 1);
  assert.equal(Bilan.analyser(Object.assign({}, S, { profil: seul }), { Calc, Plan }).nbCredits, 1);
  assert.match(sp(PF.resumeCredits(seul)), /^1 crédit, 6 500 € restants, 210 €\/mois$/);
});

/* ====================================================== 5. tutoiement des propositions ====================================================== */

test("Propositions : les sources et justifications se lisent au tutoiement (jamais « l'utilisateur »), pour les données déjà en base comme pour les nouveaux dépôts", () => {
  const attendu = [
    ["Déclaration de l'utilisateur pendant l'entretien", "Ce que tu as dit à Claude pendant l'entretien"],
    ["Dit par l'utilisateur", "Ce que tu as dit à Claude"],
    ["Relevé PEA du 30/09 (collé par l'utilisateur)", "Relevé PEA du 30/09 (que tu as collé)"],
    ["Relevé … du … déposé par l'utilisateur", "Relevé … du … que tu as déposé"],
    ["Réponses de l'utilisateur pendant l'entretien", "Tes réponses pendant l'entretien"],
    ["Saisi par l'utilisateur dans le formulaire interactif", "Saisi par toi dans le formulaire interactif"],
    ["Avis d'imposition 2026", "Avis d'imposition 2026"],
  ];
  for (const [avant, apres] of attendu) assert.equal(PP.tutoyer(avant), apres, avant);
  assert.equal(PP.tutoyer(null), ""); assert.equal(PP.tutoyer(undefined), "");
  // la démo (propositions et sources affichées) n'emploie plus la 3e personne
  for (const p of DEMO.propositions) assert.doesNotMatch(p.source + " " + p.justification, /utilisateur/i, p.id);
  assert.doesNotMatch(JSON.stringify(DEMO.config.enveloppes_infos), /utilisateur/i);
  // la vue passe source et justification par tutoyer ; les phrases de décrire() aussi
  const vue = readFileSync("web/src/propositions.js", "utf8");
  assert.match(vue, /esc\(tutoyer\(p\.source\)/); assert.match(vue, /esc\(tutoyer\(p\.justification\)\)/);
  const d = PP.decrire({ cible: "config", operation: "modifier", avant: {}, apres: { frais_enveloppes: { "Assurance-vie": { gestion_uc_pct: 0.6, source: "Dit par l'utilisateur" } } } }, {});
  assert.match(d, /source : Ce que tu as dit à Claude/); assert.doesNotMatch(d, /utilisateur/i);
  // le connecteur demande des sources à la 2e personne
  const mcp = ["index.ts", "formulaire.ts", "reglages.ts"].map(f => readFileSync("supabase/functions/mcp/" + f, "utf8")).join("\n");
  assert.match(mcp, /Ce que tu as dit à Claude/); assert.match(mcp, /Saisi par toi dans le formulaire interactif/);
  assert.doesNotMatch(mcp, /« Dit par l'utilisateur »|« Relevé PEA du 30\/09 collé par l'utilisateur »|déclaré par l'utilisateur pendant|déposé par l'utilisateur ». |déclaration de l'utilisateur/);
});

/* ====================================================== 6. versement de la projection ====================================================== */

const OV = require("../web/src/objectifs-view.js");
const MOIS_R = (m, categorie, entrees, sorties, extra) => ({ mois: m, categorie, entrees, sorties, nombre: 1, ...extra });
const COMPTES_R = [{ id: 1, nom: "Compte joint", type: "courant", ignore: false, doublonDe: null, actif: true }];
/* Banque connectée : 3 mois complets (juillet à septembre 2026), `epargne` € versés chaque mois, vus d'un jour d'octobre 2026. */
const banqueAvec = epargne => ({ actif: true, lu: true, connexions: [], comptes: COMPTES_R,
  mois: ["2026-07-01", "2026-08-01", "2026-09-01"].flatMap(m => [MOIS_R(m, "revenus", 5000, 0, { compteId: 1 }), MOIS_R(m, "epargne", 0, epargne, { compteId: 1 })]) });
const AUJ = "2026-10-12";
const avecBudget = (epargne, banque) => { const S = demoS(); S.budget = { lignes: [{ id: "e", type: "epargne", categorie: "Épargne", libelle: "Épargne", montant: epargne, frequence: "mois" }] }; S.banque = banque; return S; };
const totauxDe = S => Plan.budgetTotaux(S.budget.lignes, S.profil, "foyer");
const vp = (S, scope = "foyer") => OV.versementProjection(S, totauxDe(S), scope, AUJ, { Calc });

test("versement de la projection : le réel de la banque remplace le prévu s'il en diffère de plus de 30 %, avec la source dite et le prévu rappelé", () => {
  const S = avecBudget(1700, banqueAvec(500));
  const r = vp(S);
  assert.equal(r.origine, "reel"); assert.equal(r.v, 500);
  assert.equal(sp(r.libelle), "500 €/mois réellement épargnés sur 3 mois (budget : 1 700 €/mois prévus au budget)");
  assert.equal(r.prevu.v, 1700); assert.equal(r.reel.n, 3);
  // écart de 30 % ou moins : le budget reste
  const p = vp(avecBudget(1700, banqueAvec(1500)));
  assert.equal(p.origine, "prevu"); assert.equal(sp(p.libelle), "1 700 €/mois prévus au budget"); assert.equal(p.v, 1700);
  assert.equal(vp(avecBudget(1700, banqueAvec(1190))).origine, "prevu", "−30 % pile : encore le budget");
  assert.equal(vp(avecBudget(1700, banqueAvec(1100))).origine, "reel", "−35 % : le réel");
  // sans banque connectée, ou pour une personne : le prévu
  assert.equal(vp(avecBudget(1700, { actif: false, lu: true, connexions: [], comptes: [], mois: [] })).origine, "prevu");
  assert.equal(vp(avecBudget(1700, banqueAvec(500)), "p1").origine, "prevu", "les comptes ne sont pas répartis par personne");
  // budget sans épargne mais banque : le réel seul
  const sansBudget = demoS(); sansBudget.budget = { lignes: [] }; sansBudget.config = {}; sansBudget.banque = banqueAvec(400);
  const seul = OV.versementProjection(sansBudget, Plan.budgetTotaux([], sansBudget.profil, "foyer"), "foyer", AUJ, { Calc });
  assert.equal(seul.origine, "reel"); assert.equal(sp(seul.libelle), "400 €/mois réellement épargnés sur 3 mois");
  assert.equal(OV.versementProjection(Object.assign(demoS(), { budget: { lignes: [] }, config: {}, banque: undefined }), Plan.budgetTotaux([], null, "foyer"), "foyer", AUJ, { Calc }), null);
});

test("versement de la projection : le cône d'Aujourd'hui et la projection d'Objectifs prennent la même valeur et le même texte (une seule fonction)", () => {
  const S = avecBudget(1700, banqueAvec(500));
  const r = vp(S);
  const e = A.evolution(S, AUJ, { id: "1a" }, 5, Object.assign({}, DEPS, { Plan }));
  assert.equal(e.futur.versement, r.v, "même versement qu'Objectifs");
  assert.equal(e.futur.versementSource, r.src, "même source");
  assert.equal(e.futur.versementInfo.libelle, r.libelle);
  const view = readFileSync("web/src/objectifs-view.js", "utf8"), aj = readFileSync("web/src/aujourdhui.js", "utf8");
  assert.match(view, /versementProjection\(S, t, scope\(\), isoToday\(\), null\)/); assert.match(aj, /OV\.versementProjection\(/);
  assert.doesNotMatch(aj, /OV\.versementReel\(/); assert.doesNotMatch(view, /real = versementReel\(/);
  // Placements (pilotage) n'a pas de cône : aucun autre appelant du moteur de projection dans l'app
  assert.deepEqual(readFileSync("web/src/pilotage.js", "utf8").match(/projection\(/g), null);
});

test("projection : la décomposition « dont X de tes versements et Y des marchés » est exacte et dite en euros courants, avant frais et impôts", () => {
  const ph = OV.projectionPhrases(100000, 190000, 1000, 5, { libelle: "1 000 €/mois prévus au budget" });
  assert.equal(ph.versements, 60000); assert.equal(ph.marches, 30000); assert.equal(ph.gain, 90000);
  assert.equal(ph.versements + ph.marches, ph.gain, "la somme retombe sur le gain");
  assert.equal(sp(ph.total), "Dans 5 ans : 190 000 € (central), soit +90 000 € par rapport à aujourd'hui, dont 60 000 € de tes versements et 30 000 € des marchés (euros courants, avant frais et impôts).");
  assert.equal(sp(ph.versement), "Versement pris en compte : 1 000 €/mois prévus au budget.");
  assert.match(sp(OV.projectionPhrases(100000, 100000, 0, 1, null).total), /dont 0 € des marchés/);
  assert.match(sp(OV.projectionPhrases(100000, 90000, 0, 1, null).total), /soit −10 000 €.*dont −10 000 € des marchés/);
  assert.equal(OV.projectionPhrases(1, 2, 0, 1, null).versement, "Aucun versement mensuel pris en compte.");
});

test("projection (vues) : sous le cône d'Aujourd'hui, le versement et sa source puis la décomposition ; mêmes phrases que sur Objectifs", async () => {
  const v = deuxVues(), S = demoS();
  v.reg.aujourdhui.update(S, true);
  v.liberer();
  await attend();
  const note = v.montes.aujourdhui.querySelector("#ajProjNote");
  assert.equal(note.hidden, false);
  const t = sp(note.textContent);
  assert.match(t, /^Dans 5 ans : [\d ]+ € \(central\), soit \+[\d ]+ € par rapport à aujourd'hui, dont [\d ]+ € de tes versements et [\d ]+ € des marchés \(euros courants, avant frais et impôts\)\. Versement pris en compte : [\d ]+ €\/mois prévus au budget\.$/);
  const chiffres = x => (x.match(/\d[\d ]*/g) || []).map(n => +n.replace(/ /g, ""));
  const m = t.match(/dont ([\d ]+) € de tes versements et ([\d ]+) € des marchés/);
  const g = t.match(/soit \+([\d ]+) €/);
  assert.equal(chiffres(m[1])[0] + chiffres(m[2])[0], chiffres(g[1])[0], "versements + marchés = gain");
  SN.reinitialiser();
});
