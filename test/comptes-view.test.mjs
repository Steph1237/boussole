// Patrimoine › Comptes (web/src/comptes-view.*, spec 2026-10-12-cp1 § 2-4) : en-tête du patrimoine net, quatre familles en blocs
// repliables, comptes groupés par établissement, cartes-liens (solde, part, plus-value latente, pastille de source), fiches en pleine
// page (enveloppe, ligne, compte courant) avec fil d'Ariane et adresse profonde, courbes SVG accessibles, cours historiques
// (Store.cours) lus à l'ouverture. Lecture seule, tutoiement, échappement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/comptes-view.js", "utf8");
const css = readFileSync("web/src/comptes-view.css", "utf8");
const html = readFileSync("web/src/comptes-view.html", "utf8");
const CV = require("../web/src/comptes-view.js");
const Calc = require("../web/src/calc.js");
const UI = require("../web/src/ui.js");
const ClaudePrompts = require("../web/src/claude-prompts.js");
const DEMO = require("../web/src/demo-data.js");

const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[  ]/g, " ");
const jourLocal = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
const TODAY = jourLocal();
const demoS = o => Object.assign(J(DEMO), { ready: true, dbOk: true, scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], error: null }, o);
const POS = (id, o) => Object.assign({ id, name: "Ligne " + id, envelope: "PEA", owner: "p1", bloc: "Monde", mode: "market", isin: null, qty: 10, pru: 100, price: 110,
  priceDate: "2026-10-10", value: null, valueDate: null, status: "actif", hypothesis: null, qtyEstimated: false, note: null, sourceAuto: null, sourceAutoLe: null }, o);
const XSS = '<img src=x onerror="alert(1)">';
const S0 = o => Object.assign({ ready: true, positions: [], snapshots: [], tx: [], profil: null, config: {}, banque: { actif: false, connexions: [], comptes: [], mois: [] },
  scope: "foyer", people: [{ id: "p1", nom: "Camille" }] }, o);

/* ------------------------------------------------ module ------------------------------------------------ */

test("comptes-view.js : se compile, s'enregistre sous « comptes-view » (motif __pending), API de module ; window.ComptesView", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "comptes-view.js" }));
  assert.match(js, /App\.register\("comptes-view", api\)/);
  assert.match(js, /__pending/);
  assert.match(js, /const api = \{ mount, update, show \}/);
  assert.match(js, /window\.ComptesView = H/, "fonctions pures partagées (App.lienCompte, Placements, Aujourd'hui)");
});

test("comptes-view.js : $ scopé à la racine, aucune requête DOM globale ; partie pure sans DOM ni window.UI", () => {
  assert.deepEqual(js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l)), []);
  assert.match(js, /const \$ = id => root\.querySelector\("#" \+ id\)/);
  const pur = js.slice(0, js.indexOf('if (typeof document === "undefined") return;'));
  assert.ok(pur.length > 5000);
  assert.doesNotMatch(pur, /window\.UI|\bUI\.(panneau|bascule|accordeon|demanderAClaude)\(/, "UI reçu en paramètre");
  assert.doesNotMatch(pur, /document\./);
});

test("comptes-view.html : identifiants utilisés par le script ; comptes-view.css entièrement scopé sous #view-comptes-view", () => {
  const ids = [...new Set([...js.matchAll(/\$\("(cv[A-Za-z]+)"\)/g)].map(m => m[1]))];
  const dyn = ["cvPeriode", "cvGraphe", "cvLignesFiche", "cvFicheTitre"]; // posés par les rendus de fiche
  assert.deepEqual(ids.filter(id => !html.includes('id="' + id + '"') && !dyn.includes(id)), []);
  for (const id of dyn) assert.match(js, new RegExp('id="' + id + '"'), id + " rendu par une fiche");
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(sels.length > 40);
  assert.deepEqual(sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !/^#view-comptes-view\b/.test(x)), []);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/, "couleurs du thème seulement (clair et sombre)");
});

/* ------------------------------------------------ familles ------------------------------------------------ */

test("famille : Calc.famille (calc.js, même règle que le connecteur) ; plus de repli local (familleLocale supprimée)", () => {
  assert.equal(CV.familleLocale, undefined);
  assert.doesNotMatch(js, /familleLocale/);
  for (const x of DEMO.positions) assert.equal(CV.famille(x, { Calc }), Calc.famille(x), x.id);
  assert.equal(CV.famille({ envelope: "Compte joint", bloc: "Épargne" }, { Calc }), "courant", "compte joint (revue CP1)");
  assert.equal(CV.famille({ envelope: "Plan d'épargne en actions", bloc: "Épargne" }, { Calc }), "investissement");
  assert.equal(CV.famille({ envelope: "x" }, { Calc: {} }), "investissement", "Calc sans famille : investissement");
  assert.equal(CV.famille({ envelope: "x" }, { Calc: { famille: () => { throw new Error("x"); } } }), "investissement");
});
test("lien / lireCible : adresses profondes des fiches, aller-retour, paramètres inconnus → la liste", () => {
  const cas = [{ enveloppe: "PEA Camille", titulaire: "p1" }, { enveloppe: "Assurance vie & co" }, { ligne: "pea-etf-monde" }, { courant: "compte commun" }];
  for (const c of cas) {
    const l = CV.lien(c);
    assert.match(l, /^patrimoine\/comptes\?/);
    const v = CV.lireCible(l.split("?")[1]);
    if (c.ligne) assert.deepEqual(J(v), { type: "ligne", id: c.ligne });
    else if (c.courant) assert.deepEqual(J(v), { type: "courant", id: c.courant });
    else assert.deepEqual(J(v), { type: "enveloppe", enveloppe: c.enveloppe, titulaire: c.titulaire || null });
  }
  assert.equal(CV.lien({ enveloppe: "PEA", titulaire: "x" }), "patrimoine/comptes?enveloppe=PEA");
  assert.equal(CV.lien({}), "patrimoine/comptes");
  assert.deepEqual(J(CV.lireCible({})), { type: "liste" });
  assert.deepEqual(J(CV.lireCible({ foo: "bar", enveloppe: "  " })), { type: "liste" });
  assert.deepEqual(J(CV.lireCible({ enveloppe: "PEA", titulaire: "p9" })), { type: "enveloppe", enveloppe: "PEA", titulaire: null });
  assert.deepEqual(J(CV.lireCible(null)), { type: "liste" });
});

/* ------------------------------------------------ établissements et sources ------------------------------------------------ */

test("etablissement : compte bancaire rattaché (ligne, puis enveloppe + titulaire) → connexion Powens ; mot-clé de l'enveloppe ; sinon « Saisi à la main »", () => {
  const S = demoS();
  const p = id => S.positions.find(x => x.id === id);
  assert.deepEqual(J(CV.etablissement(p("compte-commun"), S)), { nom: "Banque des Canuts", origine: "banque" }, "rattaché par la ligne");
  assert.deepEqual(J(CV.etablissement(p("pea-etf-monde"), S)), { nom: "Néo Courtage", origine: "banque" }, "rattaché par l'enveloppe et le titulaire");
  assert.deepEqual(J(CV.etablissement(p("ldds"), S)), { nom: "Saisi à la main", origine: "manuel" });
  assert.deepEqual(J(CV.etablissement(POS("x", { envelope: "Assurance vie Linxea Spirit" }), S)), { nom: "Linxea", origine: "mot_cle" });
  assert.deepEqual(J(CV.etablissement(POS("x", { envelope: "Crypto (Binance)" }), S)), { nom: "Binance", origine: "mot_cle" });
  assert.deepEqual(J(CV.etablissement(POS("x", { envelope: "Livret Caisse d'Epargne" }), S)), { nom: "Caisse d'Épargne", origine: "mot_cle" }, "sans accent");
  assert.equal(CV.etablissement(POS("x", { envelope: "Boursier" }), S).nom, "Saisi à la main", "mot entier seulement");
  // compte ignoré ou banque éteinte : plus de rattachement
  const ign = demoS(); ign.banque.comptes.find(c => c.positionId === "compte-commun").ignore = true;
  assert.equal(CV.etablissement(ign.positions.find(x => x.id === "compte-commun"), ign).nom, "Saisi à la main");
  const off = demoS(); off.banque.actif = false;
  assert.equal(CV.etablissement(off.positions.find(x => x.id === "pea-etf-monde"), off).nom, "Saisi à la main");
  // titulaire différent : pas de rattachement par enveloppe
  assert.equal(CV.etablissement(POS("x", { envelope: "PEA Camille", owner: "p2" }), S).nom, "Saisi à la main");
});

test("sourceDe : « Synchronisé le JJ/MM » (sourceAuto powens / binance, ou compte rattaché) ; sinon « Saisi le JJ/MM » ; sans date « Saisi à la main »", () => {
  const S = S0();
  assert.deepEqual(J(CV.sourceDe([POS("a", { sourceAuto: "binance", sourceAutoLe: "2026-10-09T02:00:00" })], S)), { texte: "Synchronisé le 09/10", ton: "bon", date: "2026-10-09", origine: "binance" });
  assert.equal(CV.sourceDe([POS("a", { sourceAuto: "powens", sourceAutoLe: "2026-10-01T12:00:00" }), POS("b", { sourceAuto: "powens", sourceAutoLe: "2026-10-05T12:00:00" })], S).texte, "Synchronisé le 05/10", "date la plus récente");
  assert.deepEqual(J(CV.sourceDe([POS("a", { mode: "manual", valueDate: "2026-09-30" }), POS("b", { mode: "manual", valueDate: "2026-08-31" })], S)), { texte: "Saisi le 30/09", ton: "neutre", date: "2026-09-30", origine: "manuel" });
  assert.equal(CV.sourceDe([POS("a")], S).texte, "Saisi à la main");
  assert.equal(CV.sourceDe([POS("a", { sourceAuto: "inconnue" })], S).origine, "manuel", "source inconnue : saisie");
  const D = demoS();
  assert.equal(CV.sourceDe(D.positions.filter(p => p.id === "ldds"), D).texte.slice(0, 8), "Saisi le");
  const sansAuto = demoS(); sansAuto.positions.forEach(p => { p.sourceAuto = null; });
  assert.match(CV.sourceDe(sansAuto.positions.filter(p => p.envelope === "PEA Camille"), sansAuto).texte, /^Synchronisé le \d{2}\/\d{2}$/, "compte rattaché : date de la connexion");
});

/* ------------------------------------------------ liste ------------------------------------------------ */

test("comptes (démo) : quatre familles dans l'ordre, comptes groupés par établissement (« Saisi à la main » en dernier), cartes au contrat", () => {
  const S = demoS(), L = CV.comptes(S, TODAY, { Calc });
  assert.deepEqual(L.familles.map(F => F.id), ["courant", "epargne", "investissement", "dettes"]);
  assert.deepEqual(L.familles.map(F => F.label), ["Comptes courants", "Épargne disponible", "Investissement", "Dettes"]);
  const financier = Calc.financier(S.positions, "foyer");
  assert.ok(Math.abs(L.financier - financier) < 1e-6, "financier compté (hors « à recevoir »)");
  const actifs = L.familles.filter(F => F.id !== "dettes");
  assert.ok(Math.abs(actifs.reduce((a, F) => a + F.total, 0) - financier) < 1e-6, "toutes les lignes comptées, une seule fois");
  assert.ok(Math.abs(actifs.reduce((a, F) => a + F.part, 0) - 100) < 1e-6);
  for (const F of L.familles) {
    const noms = F.etablissements.map(E => E.nom);
    if (noms.includes("Saisi à la main")) assert.equal(noms[noms.length - 1], "Saisi à la main", F.id);
    for (const E of F.etablissements) for (const c of E.comptes) {
      assert.deepEqual(Object.keys(c).sort(), ["cle", "cout", "doublons", "etablissement", "href", "nb", "nom", "part", "plusValue", "solde", "source", "sous", "titulaire", "type"]);
      assert.deepEqual(c.doublons, [], "démo : aucun doublon");
      assert.match(c.href, /^#patrimoine\/(comptes\?(enveloppe|courant)=|immobilier$)/);
    }
  }
  const inv = L.familles[2], pea = inv.etablissements.find(E => E.nom === "Néo Courtage").comptes[0];
  assert.equal(pea.nom, "PEA Camille");
  assert.equal(pea.href, "#patrimoine/comptes?enveloppe=PEA%20Camille&titulaire=p1");
  const lignesPea = S.positions.filter(p => p.envelope === "PEA Camille");
  const pv = lignesPea.reduce((a, p) => a + (p.qty * p.price - p.qty * p.pru), 0);
  assert.ok(Math.abs(pea.plusValue - pv) < 1e-6, "plus-value latente = Σ qty × cours − qty × PRU");
  assert.match(pea.sous, /3 lignes · Camille/);
  assert.match(pea.source.texte, /^Synchronisé le \d{2}\/\d{2}$/);
  assert.ok(Math.abs(pea.part - pea.solde / financier * 100) < 1e-9, "part du financier");
  const av = inv.etablissements.find(E => E.nom === "Saisi à la main").comptes.find(c => c.nom === "Assurance vie Sam");
  assert.equal(av.plusValue, null, "lignes saisies : pas de plus-value latente");
  assert.match(av.source.texte, /^Saisi le \d{2}\/\d{2}$/);
  // dettes : crédit synchronisé (rattaché à un compte de prêt) et prêt immobilier saisi
  const dettes = L.familles[3];
  assert.equal(dettes.total, -156500);
  const pret = dettes.etablissements.find(E => E.nom === "Banque des Canuts").comptes[0];
  assert.equal(pret.nom, "Prêt auto"); assert.equal(pret.solde, -6500); assert.equal(pret.href, "#patrimoine/immobilier");
  assert.match(pret.source.texte, /^Synchronisé le/);
  assert.equal(dettes.etablissements.find(E => E.nom === "Saisi à la main").comptes[0].nom, "Prêt · Appartement (résidence principale)");
  // le compte courant de la démo (enveloppe et poche « Comptes courants ») : une carte par ligne, vers la fiche compte courant
  const cc = CV.comptes(S, TODAY, { Calc }).familles[0];
  assert.equal(cc.nb, 1);
  const carte = cc.etablissements[0].comptes[0];
  assert.equal(carte.nom, "Compte courant commun"); assert.equal(carte.href, "#patrimoine/comptes?courant=compte-commun"); assert.equal(cc.etablissements[0].nom, "Banque des Canuts");
});

test("comptes : périmètre d'une personne (ses lignes, sa quote-part des dettes) ; lignes clôturées et à recevoir exclues", () => {
  const S = demoS({ scope: "p2" }), L = CV.comptes(S, TODAY, { Calc });
  const cartes = L.familles.flatMap(F => F.etablissements.flatMap(E => E.comptes));
  assert.ok(cartes.filter(c => c.type !== "dette").every(c => c.titulaire === "p2"));
  assert.ok(!cartes.some(c => /recevoir/i.test(c.nom)));
  assert.equal(L.familles[3].total, -(150000 * 0.5 + 6500 * 0.5), "quote-part : bien à 50 %, crédit commun à moitié");
  assert.ok(!cartes.some(c => / · (Camille|Sam)$/.test(c.sous)), "pas de prénom sur une vue personnelle");
  const clos = CV.comptes(S0({ positions: [POS("a", { status: "clôturé" }), POS("b", { status: "à recevoir", mode: "manual", value: 100 })] }), TODAY, { Calc });
  assert.equal(clos.familles.reduce((a, F) => a + F.nb, 0), 0);
});

test("entete : patrimoine net, financier, immobilier, dettes ; variation sur 1 mois = valeur du jour − dernière photo vieille d'au moins 30 jours", () => {
  const S = S0({ positions: [POS("a", { qty: 10, price: 110 })], profil: { biens: [{ id: "b", valeur: 200000, part_p1: 100, crd: 50000 }], credits: [] },
    snapshots: [{ date: "2026-08-01", foyer: 900 }, { date: "2026-09-01", foyer: 1000 }, { date: "2026-10-01", foyer: 1050 }] });
  const e = CV.entete(S, "2026-10-12", { Calc });
  assert.equal(e.financier, 1100); assert.equal(e.immobilier, 200000); assert.equal(e.dettes, 50000); assert.equal(e.net, 151100);
  assert.deepEqual(J(e.variation), { montant: 100, pct: 10, depuis: "2026-09-01" });
  assert.equal(CV.entete(S0({ positions: [POS("a")], snapshots: [{ date: "2026-10-01", foyer: 1 }] }), "2026-10-12", { Calc }).variation, null, "moins d'un mois de photos");
  const h = sp(CV.enteteHtml(e));
  assert.match(h, /151 100 €/); assert.match(h, /\+100 € \(\+10,0 %\)/); assert.match(h, /depuis le 1 sept\. 2026/);
  assert.match(h, /Dettes<\/span><span class="cv-fait-v neg">−50 000 €/);
  assert.match(sp(CV.enteteHtml(Object.assign({}, e, { variation: null }))), /après un mois de photos/);
});

test("famillesHtml : blocs repliables (bouton aria-expanded / aria-controls), établissements en h4, cartes = liens (href + data-goto, nom accessible complet), échappement", () => {
  const S = demoS();
  S.positions.find(p => p.id === "cto-asml").envelope = "CTO " + XSS;
  const L = CV.comptes(S, TODAY, { Calc });
  const h = CV.famillesHtml(L, new Set(["dettes"]));
  assert.doesNotMatch(h, /<img/); assert.match(h, /CTO &lt;img/);
  assert.equal((h.match(/<button type="button" class="cv-fam-btn"/g) || []).length, 4);
  assert.match(h, /data-cv-fam-btn="investissement" aria-expanded="true" aria-controls="cv-fam-investissement"/);
  assert.match(h, /data-cv-fam-btn="dettes" aria-expanded="false" aria-controls="cv-fam-dettes"/);
  assert.match(h, /<div class="cv-fam-corps" id="cv-fam-dettes" hidden>/, "famille repliée");
  assert.match(h, /<h4 class="cv-etab-h">Néo Courtage<\/h4>/);
  const pea = h.match(/<a class="cv-carte" href="#patrimoine\/comptes\?enveloppe=PEA%20Camille&amp;titulaire=p1" data-goto="patrimoine\/comptes\?enveloppe=PEA%20Camille&amp;titulaire=p1" data-cv-cle="[^"]+" aria-label="([^"]+)">/);
  assert.ok(pea, "carte du PEA : lien vers sa fiche");
  assert.match(sp(pea[1]), /^PEA Camille, 3 lignes · Camille, solde 25 443 €, 27 % du financier, plus-value latente \+3 527 €, Synchronisé le \d{2}\/\d{2}, ouvrir la fiche$/);
  assert.match(h, /class="cv-carte dette" href="#patrimoine\/immobilier" data-goto="patrimoine\/immobilier"/);
  assert.match(h, /<span class="cv-chip bon">Synchronisé le/);
  assert.match(h, /<span class="cv-chip neutre">Saisi le/);
  assert.doesNotMatch(h, /<button[^>]*data-goto/, "navigation : des liens, pas des boutons");
  assert.match(CV.famillesHtml(CV.comptes(S0(), TODAY, { Calc })), /Aucun compte courant suivi\./, "famille vide : phrase");
});

/* ------------------------------------------------ séries et performances ------------------------------------------------ */

test("serieEnveloppe : Σ quantité actuelle × cours historique (dernier connu, premier connu avant le début), saisies et cotées sans historique constantes, point du jour", () => {
  const lignes = [POS("a", { isin: "A", qty: 2, price: 12 }), POS("b", { isin: "B", qty: 1, price: 105 }), POS("c", { mode: "manual", value: 1000, isin: null }),
    POS("d", { isin: "D", qty: 3, price: 10, name: "Sans cours" }), POS("e", { isin: "A", qty: 5, price: 12, status: "clôturé" })];
  const cours = { A: [{ date: "2026-10-01", cloture: 10 }, { date: "2026-10-05", cloture: 11 }, { date: "2026-10-07", cloture: "11.5" }],
    B: [{ date: "2026-10-05", cloture: 100 }, { date: "2026-10-06", cloture: 101 }, { date: "2026-10-12", cloture: 999 }], Z: [{ date: "2026-10-05", cloture: 1 }] };
  const r = CV.serieEnveloppe(lignes, cours, "2026-10-04", "2026-10-12", { Calc });
  assert.equal(r.constantes, 1030, "saisie (1 000) + cotée sans historique (3 × 10)");
  assert.deepEqual(r.sansHistorique, ["Sans cours"]);
  assert.deepEqual(J(r.points), [
    { date: "2026-10-05", valeur: 1030 + 2 * 11 + 100 },
    { date: "2026-10-06", valeur: 1030 + 2 * 11 + 101 },
    { date: "2026-10-07", valeur: 1030 + 2 * 11.5 + 101 },
    { date: "2026-10-12", valeur: 1000 + 24 + 105 + 30, live: true },
  ], "dates de cotation dans la période (le jour même exclu), puis la valeur du jour ; ligne clôturée ignorée");
  const avant = CV.serieEnveloppe([POS("b", { isin: "B", qty: 1 })], { B: [{ date: "2026-10-05", cloture: 100 }, { date: "2026-10-06", cloture: 101 }] }, "2026-10-01", "2026-10-12", { Calc });
  assert.equal(avant.points[0].valeur, 100);
  assert.deepEqual(J(CV.serieEnveloppe([POS("c", { mode: "manual", value: 5 })], {}, "2026-01-01", "2026-10-12", { Calc }).points), [], "sans ligne cotée historisée : pas de courbe");
  const multi = CV.serieEnveloppe([POS("a", { isin: "A", qty: 1 }), POS("b", { isin: "B", qty: 1 })], { A: [{ date: "2026-10-01", cloture: 10 }], B: [{ date: "2026-10-03", cloture: 20 }] }, "2026-09-01", "2026-10-12", { Calc });
  assert.deepEqual(J(multi.points.slice(0, 1)), [{ date: "2026-10-03", valeur: 30 }], "pas de remplissage avant le premier cours connu d'une ligne : la courbe commence quand toutes ont un cours");
  assert.equal(multi.historiqueDepuis, "2026-10-03"); assert.equal(multi.partiel, true, "historique plus court que la période");
  assert.equal(r.partiel, false, "historique qui couvre la période (à une semaine près)");
});

test("perfDepuis : cours au début de la période (dernier connu, sinon premier de la période) → prix du jour ; null sans historique", () => {
  const cours = { A: [{ date: "2026-01-02", cloture: 50 }, { date: "2026-07-01", cloture: 80 }, { date: "2026-10-01", cloture: 95 }] };
  assert.equal(CV.perfDepuis(cours, "A", "2026-07-15", 100).toFixed(4), (100 / 80 * 100 - 100).toFixed(4));
  assert.equal(CV.perfDepuis(cours, "A", "2025-01-01", 100), 100, "avant tout cours : premier cours de la période");
  assert.equal(CV.perfDepuis(cours, "B", "2026-07-15", 100), null);
  assert.equal(CV.perfDepuis(cours, "A", "2026-07-15", null), null);
  assert.equal(CV.debutPeriode("1m", "2026-03-31"), "2026-02-28", "fin de mois ramenée");
  assert.equal(CV.debutPeriode("5a", "2026-10-12"), "2021-10-12");
  assert.equal(CV.debutPeriode("x", "2026-10-12"), "2025-10-12", "période inconnue : 1 an");
  assert.deepEqual(CV.PERIODES.map(p => p.label), ["1 M", "3 M", "1 A", "3 A", "5 A"]);
});

test("vraiePerformance : en construction (moins de 90 jours de photos, disponible le jour de la première photo + 90) ; puis Dietz modifié corrigé des versements", () => {
  const lignes = [POS("a", { envelope: "PEA" })];
  assert.deepEqual(J(CV.vraiePerformance(S0({ snapshots: [{ date: "2026-08-01", byEnvelope: { PEA: 1000 } }] }), "PEA", lignes, "2026-10-12")), { etat: "construction", dispoLe: "2026-10-30" });
  assert.deepEqual(J(CV.vraiePerformance(S0(), "PEA", lignes, "2026-10-12")), { etat: "construction", dispoLe: "2027-01-10" }, "aucune photo : 90 jours à partir d'aujourd'hui");
  // avec une ligne de liquidités : les achats et ventes restent dans l'enveloppe, seuls les versements et retraits sont des flux
  const avecCash = [POS("a", { envelope: "PEA" }), POS("cash", { envelope: "PEA", name: "Espèces PEA", bloc: "Liquidités", mode: "manual", value: 50 })];
  const S = S0({ snapshots: [{ date: "2026-01-01", byEnvelope: { PEA: 1000 } }, { date: "2026-04-11", byEnvelope: { PEA: 1600 } }],
    tx: [{ positionId: "a", type: "versement", date: "2026-02-20", amount: 500 }, { positionId: "a", type: "achat", date: "2026-02-21", amount: 500 }, { positionId: "zz", type: "versement", date: "2026-03-01", amount: 9999 }] });
  const v = CV.vraiePerformance(S, "PEA", avecCash, "2026-10-12", { Calc });
  assert.equal(v.etat, "ok");
  assert.equal(v.gain, 100, "1 600 − 1 000 − 500 versés (un achat n'est pas un versement)");
  assert.equal(v.flux, 500);
  const poids = (Date.UTC(2026, 3, 11) - Date.UTC(2026, 1, 20)) / (Date.UTC(2026, 3, 11) - Date.UTC(2026, 0, 1));
  assert.ok(Math.abs(v.pct - 100 / (1000 + 500 * poids) * 100) < 1e-9);
  assert.equal(CV.vraiePerformance(S0({ snapshots: [{ date: "2026-01-01" }, { date: "2026-05-01" }] }), "PEA", lignes, "2026-10-12").etat, "indisponible");
  // sans ligne de liquidités : création, achat et vente sont aussi des flux (l'argent ne transite par aucune ligne suivie)
  const S2 = S0({ snapshots: S.snapshots, tx: [{ positionId: "a", type: "creation", date: "2026-01-15", qty: 2, price: 100 }, { positionId: "a", type: "achat", date: "2026-02-21", amount: 500 },
    { positionId: "a", type: "vente", date: "2026-03-01", amount: 300 }] });
  const v2 = CV.vraiePerformance(S2, "PEA", lignes, "2026-10-12", { Calc });
  assert.equal(v2.flux, 200 + 500 - 300); assert.equal(v2.gain, 600 - 400);
  // enveloppe synchronisée : versements non suivis
  assert.deepEqual(J(CV.vraiePerformance(S, "PEA", [POS("a", { envelope: "PEA", sourceAuto: "powens" })], "2026-10-12", { Calc })), { etat: "non_suivi" });
  // plusieurs titulaires sous le même nom d'enveloppe : by_envelope les mélange
  const S3 = S0({ snapshots: S.snapshots, positions: [POS("a", { envelope: "PEA" }), POS("b", { envelope: "PEA", owner: "p2" })] });
  assert.deepEqual(J(CV.vraiePerformance(S3, "PEA", [S3.positions[0]], "2026-10-12", { Calc })), { etat: "titulaires" });
  const hv = sp(CV.ficheEnveloppeHtml(Object.assign(CV.ficheEnveloppe(demoS(), { enveloppe: "PEA Camille", titulaire: "p1" }, TODAY, { Calc }), {}), UI));
  assert.match(hv, /Indisponible : les versements de ce compte ne sont pas suivis/, "PEA de la démo synchronisé");
  const f = CV.ficheEnveloppe(demoS(), { enveloppe: "PEA Camille", titulaire: "p1" }, TODAY, { Calc });
  const prem = DEMO.snapshots.map(x => x.date).sort()[0];
  const dispo = new Date(Date.parse(prem + "T00:00:00Z") + 90 * 864e5).toISOString().slice(0, 10);
  assert.deepEqual(J(f.vraie), { etat: "non_suivi" }, "lignes synchronisées (Néo Courtage)");
  const fav = CV.ficheEnveloppe(demoS(), { enveloppe: "Assurance vie Sam", titulaire: "p2" }, TODAY, { Calc });
  if (TODAY < dispo) {
    assert.deepEqual(J(fav.vraie), { etat: "construction", dispoLe: dispo });
    assert.match(sp(CV.ficheEnveloppeHtml(fav, UI)), /En construction :<\/strong> disponible à partir du \d{1,2} \S+ \d{4}\./);
  }
});

test("expertiseDe : crypto, ETF et fonds, taux et fonds euros, sinon actions ; nom publié lu dans S.expertises", () => {
  const S = demoS();
  const e = id => CV.expertiseDe(S.positions.find(p => p.id === id), S, { Calc }).slug;
  assert.equal(e("crypto-btc"), "crypto"); assert.equal(e("pea-etf-monde"), "etf-fonds"); assert.equal(e("pea-etf-europe"), "etf-fonds");
  assert.equal(e("pea-air-liquide"), "actions"); assert.equal(e("cto-asml"), "actions"); assert.equal(e("av-fonds-euro"), "taux-obligations");
  assert.deepEqual(J(CV.expertiseDe(POS("x", { name: "Bitcoin", bloc: "Monde", isin: "X-BTC" }), S0(), { Calc })), { slug: "crypto", nom: "Crypto-actifs" });
  assert.equal(CV.expertiseDe(POS("x"), S0({ expertises: [{ slug: "actions", nom: "Actions (v2)" }] }), { Calc }).nom, "Actions (v2)");
});

/* ------------------------------------------------ fiches ------------------------------------------------ */

test("ficheEnveloppe (démo, PEA Camille) : lignes triées par poids vers leur fiche, plus-value et prix de revient totaux, répartition par classe, ISIN à lire", () => {
  const S = demoS(), f = CV.ficheEnveloppe(S, { enveloppe: "PEA Camille", titulaire: "p1" }, TODAY, { Calc });
  assert.equal(f.trouvee, true);
  assert.deepEqual(f.lignes.map(l => l.p.id), ["pea-etf-monde", "pea-etf-europe", "pea-air-liquide"]);
  assert.ok(f.lignes.every((l, i) => !i || f.lignes[i - 1].valeur >= l.valeur));
  assert.equal(f.lignes[0].href, "#patrimoine/comptes?ligne=pea-etf-monde");
  assert.ok(Math.abs(f.lignes.reduce((a, l) => a + l.poids, 0) - 100) < 1e-9);
  const ps = S.positions.filter(p => p.envelope === "PEA Camille");
  assert.ok(Math.abs(f.cout - ps.reduce((a, p) => a + p.qty * p.pru, 0)) < 1e-6);
  assert.ok(Math.abs(f.plusValue - ps.reduce((a, p) => a + p.qty * (p.price - p.pru), 0)) < 1e-6);
  assert.deepEqual(f.isins.sort(), ["FR0000120073", "IE00B4L5Y983", "LU0908500753"]);
  assert.deepEqual(f.repartition.map(r => r.cle), ["actions"]);
  assert.equal(f.sous, "Investissement · Camille");
  assert.equal(CV.ficheEnveloppe(S, { enveloppe: "Inconnue" }, TODAY, { Calc }).trouvee, false);
  assert.equal(CV.ficheEnveloppe(S, { enveloppe: "PEA Camille", titulaire: "p2" }, TODAY, { Calc }).trouvee, false, "titulaire respecté");
  const av = CV.ficheEnveloppe(S, { enveloppe: "Assurance vie Sam" }, TODAY, { Calc });
  assert.deepEqual(av.repartition.map(r => r.label), ["Obligations", "Immobilier"]);
  assert.deepEqual(av.isins, []);
});

test("ficheEnveloppeHtml / grapheEnveloppeHtml : fil d'Ariane, titre focalisable, courbe SVG accessible + tableau repliable, lignes-liens avec perf de la période", () => {
  const S = demoS(), f = CV.ficheEnveloppe(S, { enveloppe: "PEA Camille", titulaire: "p1" }, TODAY, { Calc });
  const h = sp(CV.ficheEnveloppeHtml(f, UI));
  assert.match(h, /<nav class="cv-ariane" aria-label="Fil d'Ariane"><ol><li><a href="#patrimoine\/comptes" data-goto="patrimoine\/comptes">Comptes<\/a><\/li><li><span aria-current="page">PEA Camille<\/span><\/li><\/ol><\/nav>/);
  assert.match(h, /<h2 class="cv-f-titre" id="cvFicheTitre" tabindex="-1">PEA Camille<\/h2>/);
  assert.match(h, /Valeur de tes lignes actuelles/); assert.match(h, /id="cvPeriode"/); assert.match(h, /id="cvGraphe"/);
  assert.match(h, /Répartition par classe/); assert.match(h, /Vraie performance/);
  assert.match(h, /Prix de revient total/); assert.match(h, /Plus-value latente<\/span><span class="cv-det-v pos">\+3 527 €/);
  assert.match(h, /href="https:\/\/claude\.ai\/new\?q=/);
  // cours encore en lecture
  assert.match(CV.grapheEnveloppeHtml(f, { charge: "chargement", periode: "1a", today: TODAY }, UI, { Calc }).graphe, /Chargement des cours/);
  // cours lus : courbe + tableau ; perf de la période sur chaque ligne
  const cours = {};
  f.isins.forEach((i, k) => { const p = S.positions.find(x => x.isin === i); cours[i] = [{ date: CV.debutPeriode("1a", TODAY), cloture: p.price / (1.1 + k / 10) }, { date: CV.debutPeriode("1m", TODAY), cloture: p.price / 1.02 }]; });
  const g = CV.grapheEnveloppeHtml(f, { cours, charge: "pret", periode: "1a", today: TODAY, largeur: 640 }, UI, { Calc });
  assert.match(g.graphe, /<svg class="cv-svg" viewBox="0 0 640 220" role="img" aria-labelledby="cvCourbeEnv-t" aria-describedby="cvCourbeEnv-d"/);
  assert.match(g.graphe, /<title id="cvCourbeEnv-t">Valeur de tes lignes actuelles, sur 1 an<\/title><desc id="cvCourbeEnv-d">De /);
  assert.match(g.graphe, /<details class="ui-acc"><summary class="ui-acc-titre"><span>Voir les données du graphique<\/span>/);
  assert.match(g.graphe, /<th scope="col">Date<\/th><th scope="col" class="cv-num">Valeur<\/th>/);
  assert.match(sp(g.graphe), /Ce n'est pas ta performance réelle/);
  assert.equal((g.lignes.match(/<a class="cv-ligne" href="#patrimoine\/comptes\?ligne=/g) || []).length, 3);
  assert.match(sp(g.lignes), /1 A : <span class="pos">\+10,0 %<\/span>/, "perf du cours sur la période");
  const vide = CV.grapheEnveloppeHtml(f, { cours: {}, charge: "pret", periode: "1a", today: TODAY }, UI, { Calc });
  assert.match(sp(vide.graphe), /Historique des cours pas encore disponible/, "table cours vide ou absente : une phrase");
  assert.match(sp(vide.lignes), /1 A : —/);
  const av = CV.ficheEnveloppe(S, { enveloppe: "Assurance vie Sam" }, TODAY, { Calc });
  assert.match(sp(CV.grapheEnveloppeHtml(av, { charge: "pret", periode: "1a", today: TODAY }, UI, { Calc }).graphe), /saisies à la main/);
  assert.match(sp(CV.ficheEnveloppeHtml(CV.ficheEnveloppe(S, { enveloppe: XSS }, TODAY, { Calc }), UI)), /introuvable/);
  assert.doesNotMatch(CV.ficheEnveloppeHtml(CV.ficheEnveloppe(S, { enveloppe: XSS }, TODAY, { Calc }), UI), /<img/);
});

test("ficheLigne / ficheLigneHtml : cours + PRU, quantité, valeur, plus-value, frais / zone / devise, mouvements, source, « Demander à Claude » vers l'expertise", () => {
  const S = demoS(), f = CV.ficheLigne(S, "pea-etf-europe", TODAY, { Calc });
  assert.equal(f.trouvee, true); assert.equal(f.isin, "LU0908500753"); assert.equal(f.expertise.slug, "etf-fonds");
  const faits = Object.fromEntries(f.faits);
  assert.equal(sp(faits["Quantité"]), "36"); assert.equal(sp(faits["Frais courants"]), "0,07 % par an"); assert.equal(faits.Zone, "Europe"); assert.equal(faits.Devise, "non renseignée");
  assert.match(faits["Source des frais, de la zone et de la devise"], /Document d'informations clés/);
  const h = sp(CV.ficheLigneHtml(f, UI));
  assert.match(h, /<ol><li><a href="#patrimoine\/comptes" data-goto="patrimoine\/comptes">Comptes<\/a><\/li><li><a href="#patrimoine\/comptes\?enveloppe=PEA%20Camille&amp;titulaire=p1" data-goto="patrimoine\/comptes\?enveloppe=PEA%20Camille&amp;titulaire=p1">PEA Camille<\/a><\/li><li><span aria-current="page">ETF Stoxx Europe 600<\/span><\/li><\/ol>/);
  const q = ClaudePrompts.phrase("expertise", "ETF et fonds");
  assert.ok(h.includes('href="https://claude.ai/new?q=' + encodeURIComponent(q).replace(/'/g, "&#39;") + '"') || h.includes(UI.urlClaude(q)), "ClaudePrompts.phrase(\"expertise\", nom)");
  assert.match(h, /Active l'expertise ETF et fonds\./);
  assert.match(h, /Mouvements connus/); assert.match(h, /Cours<\/h3>/);
  const monde = CV.ficheLigne(S, "pea-etf-monde", TODAY, { Calc });
  assert.deepEqual(monde.mouvements.map(m => m.type), ["Achat", "Versement"], "plus récents d'abord");
  // courbe du cours avec la ligne horizontale du PRU
  const cours = { IE00B4L5Y983: [{ date: CV.debutPeriode("3m", TODAY), cloture: 95 }, { date: CV.debutPeriode("1m", TODAY), cloture: 100 }] };
  const g = sp(CV.grapheLigneHtml(monde, { cours, charge: "pret", periode: "3m", today: TODAY, largeur: 400 }, UI));
  assert.match(g, /<line class="cv-ref"/); assert.match(g, /PRU 88,40 €/);
  assert.match(g, /<title id="cvCourbeLigne-t">Cours de ETF MSCI World, sur 3 mois<\/title>/);
  assert.match(g, /Sur 3 mois : <span class="pos">\+9,7 %<\/span>/);
  assert.match(sp(CV.grapheLigneHtml(monde, { cours: {}, charge: "pret", periode: "3m", today: TODAY }, UI)), /Historique du cours pas encore disponible/);
  // ligne saisie : pas de courbe ; ligne inconnue
  assert.doesNotMatch(CV.ficheLigneHtml(CV.ficheLigne(S, "livret-a", TODAY, { Calc }), UI), /id="cvGraphe"/);
  assert.equal(CV.ficheLigne(S, "inconnue", TODAY, { Calc }).trouvee, false);
  const x = demoS(); x.positions[0].name = XSS;
  assert.doesNotMatch(CV.ficheLigneHtml(CV.ficheLigne(x, x.positions[0].id, TODAY, { Calc }), UI), /<img/);
});

test("ficheCourant / ficheCourantHtml : flux du compte (banque_mois par compte), plus bas solde sur 90 jours et prélèvements récurrents d'après les opérations", () => {
  const S = demoS();
  const ops = DEMO.operationsBancaires;
  const f = CV.ficheCourant(S, "compte-commun", TODAY, { Calc }, ops);
  assert.equal(f.trouvee, true); assert.equal(f.solde, 3400); assert.equal(f.connecte, true);
  assert.deepEqual(f.compteIds, ["1001"]); assert.equal(f.portee, "compte", "démo : banque_mois détaillé par compte");
  assert.equal(f.etablissement.nom, "Banque des Canuts");
  assert.equal(f.flux.mois.length, 6);
  assert.equal(f.flux.enCours.mois.slice(0, 7), TODAY.slice(0, 7));
  assert.equal(f.flux.moyenne.n, 5, "mois complets seulement");
  // plus bas solde : reconstitué à rebours depuis le solde du compte bancaire
  assert.equal(f.operations, "ok");
  assert.ok(f.plusBas && f.plusBas.montant < 3400 && f.plusBas.montant > 0, "plus bas solde positif, sous le solde actuel");
  assert.equal(f.plusBas.complet, true);
  // prélèvements : libellés nettoyés, au moins deux mois ; jamais les paiements par carte répétés
  const libs = f.prelevements.map(x => x.libelle);
  for (const l of ["echeance pret immo", "prlv sepa credit auto", "prlv free mobile", "prlv netflix com", "prlv creche les petits loups"]) assert.ok(libs.includes(l), l);
  assert.ok(!libs.some(l => /^cb /.test(l)), "paiements par carte exclus");
  assert.ok(!libs.some(l => /salaire/.test(l)), "crédits exclus");
  const pret = f.prelevements.find(x => x.libelle === "echeance pret immo");
  assert.deepEqual([pret.montant, pret.jour], [820, 2]);
  const h = sp(CV.ficheCourantHtml(f, UI, { largeur: 600 }));
  assert.match(h, /Plus bas solde sur 90 jours<\/span><span class="cv-det-v">[\d  ]+ € le \d{1,2} \S+ \d{4}</);
  assert.match(h, /Totaux de ce compte/);
  assert.match(h, /<svg class="cv-svg"[^>]*role="img" aria-labelledby="cvBarresFlux-t" aria-describedby="cvBarresFlux-d"/);
  assert.equal((h.match(/<rect class="cv-b-ent"/g) || []).length, 6);
  assert.match(h, /<th scope="col">Mois<\/th><th scope="col" class="cv-num">Entrées<\/th><th scope="col" class="cv-num">Sorties<\/th>/);
  assert.match(h, /echeance pret immo<span class="cv-m-s">vers le 2 du mois/);
  assert.doesNotMatch(h, /Aucun prélèvement/);
  // flux du seul compte concerné : les lignes d'un autre compte sont ignorées
  const autre = demoS(); autre.banque.mois.push({ mois: TODAY.slice(0, 7) + "-01", compteId: 1003, categorie: "divers", entrees: 0, sorties: 99999, nombre: 1 });
  assert.equal(CV.ficheCourant(autre, "compte-commun", TODAY, { Calc }, ops).flux.enCours.sorties, f.flux.enCours.sorties);
  // totaux par utilisateur (avant 0025) : libellé honnête
  const agr = demoS(); agr.banque.mois.forEach(m => { m.compteId = null; });
  const fa = CV.ficheCourant(agr, "compte-commun", TODAY, { Calc }, ops);
  assert.equal(fa.portee, "tous"); assert.match(sp(CV.ficheCourantHtml(fa, UI)), /tous tes comptes connectés confondus/);
  // opérations pas encore lues, en échec, historique trop court : jamais « Aucun prélèvement » à tort
  assert.match(sp(CV.ficheCourantHtml(CV.ficheCourant(S, "compte-commun", TODAY, { Calc }), UI)), /Chargement des opérations…/);
  const ind = sp(CV.ficheCourantHtml(CV.ficheCourant(S, "compte-commun", TODAY, { Calc }, "indisponible"), UI));
  assert.match(ind, /Opérations indisponibles/); assert.doesNotMatch(ind, /Aucun prélèvement/);
  const court = ops.filter(o => o.date >= CV.debutPeriode("1m", TODAY));
  const hc = sp(CV.ficheCourantHtml(CV.ficheCourant(S, "compte-commun", TODAY, { Calc }, court), UI));
  assert.match(hc, /Pas encore assez d'opérations/); assert.doesNotMatch(hc, /Aucun prélèvement/);
  assert.match(hc, /d(&#39;|')après les opérations depuis le/, "plus bas solde sur un historique incomplet : signalé");
  const sansPrel = ops.filter(o => o.montant > 0 || /^CB /.test(o.libelle));
  assert.match(sp(CV.ficheCourantHtml(CV.ficheCourant(S, "compte-commun", TODAY, { Calc }, sansPrel), UI)), /Aucun prélèvement récurrent détecté sur les 90 derniers jours/);
  // compte non rattaché à un compte bancaire, banque éteinte
  const nr = demoS(); nr.banque.comptes.forEach(c => { if (c.positionId === "compte-commun") c.positionId = null; });
  const fnr = CV.ficheCourant(nr, "compte-commun", TODAY, { Calc });
  assert.deepEqual([fnr.connecte, fnr.portee, fnr.operations], [false, "aucun", "aucune"]);
  assert.match(sp(CV.ficheCourantHtml(fnr, UI)), /Rattache ce compte à un compte bancaire synchronisé/);
  const off = demoS(); off.banque = { actif: false, connexions: [], comptes: [], mois: [] };
  assert.match(sp(CV.ficheCourantHtml(CV.ficheCourant(off, "compte-commun", TODAY, { Calc }), UI)), /Connecte ta banque dans Agent › Connexion/);
  // libellés échappés
  const x = CV.ficheCourant(S, "compte-commun", TODAY, { Calc }, [
    { compteId: 1001, date: CV.debutPeriode("1m", TODAY), montant: -42, libelle: "PRLV <b>X</b>" }, { compteId: 1001, date: CV.debutPeriode("3m", TODAY).replace(/-\d{2}$/, "-25"), montant: -42, libelle: "PRLV <b>X</b>" }]);
  assert.doesNotMatch(CV.ficheCourantHtml(x, UI), /<b>X/);
});

test("plusBasSolde / prelevementsRecurrents : calculs purs", () => {
  const ops = [{ date: "2026-10-10", montant: -500 }, { date: "2026-10-05", montant: 1000 }, { date: "2026-10-01", montant: -200 }];
  // fin du 10 : 1 000 ; fin du 9 → du 5 : 1 500 ; fin du 4 → du 1 : 500 ; fin du 30/09 : 700
  assert.deepEqual(J(CV.plusBasSolde(1000, ops, "2026-10-12")), { montant: 500, date: "2026-10-04", depuis: "2026-09-30", complet: false });
  assert.equal(CV.plusBasSolde(1000, [], "2026-10-12"), null);
  const P = (date, montant, libelle) => ({ date, montant, libelle });
  const r = CV.prelevementsRecurrents([P("2026-08-03", -10, "PRLV A 123"), P("2026-09-03", -10.5, "PRLV A 456"), P("2026-10-03", -11, "PRLV A"),
    P("2026-09-04", -20, "PRLV B"), P("2026-09-05", -20, "PRLV B"), P("2026-08-10", -10, "PRLV C"), P("2026-09-10", -30, "PRLV C"), P("2026-08-15", 50, "VIR D"), P("2026-09-15", 50, "VIR D")], "2026-10-12");
  assert.deepEqual(J(r), [{ libelle: "prlv a", montant: 10.5, jour: 3, mois: 3 }], "B : un seul mois ; C : montants trop différents ; D : crédits");
});

test("courbeSvg / barresSvg : moins de deux points → null ; titre et description reliés ; points au survol", () => {
  assert.equal(CV.courbeSvg([{ date: "2026-10-01", valeur: 1 }], {}), null);
  assert.equal(CV.barresSvg([], {}), null);
  const s = CV.courbeSvg([{ date: "2026-09-01", valeur: 100 }, { date: "2026-10-01", valeur: 120, live: true }], { id: "x", titre: "T <b>", desc: "D" });
  assert.match(s, /aria-labelledby="x-t" aria-describedby="x-d"/); assert.match(s, /<title id="x-t">T &lt;b&gt;<\/title>/);
  assert.match(s, /<circle class="cv-pt fin"[^>]*><title>1 oct\. 2026 : 120 € \(aujourd&#39;hui\)<\/title>/);
});

/* ------------------------------------------------ vue (mini-DOM) ------------------------------------------------ */

function monter({ cours } = {}) {
  const { doc } = miniDom();
  const reg = {}, mem = new Map(), appels = [];
  let params = {};
  const ctx = { console, Intl, Date, Math, JSON, URLSearchParams, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout, document: doc,
    localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
    scrollY: 0, scrollTo() {},
    App: { register: (n, api) => { reg[n] = api; }, parametres: () => { const p = params; params = {}; return p; } },
    Store: { cours: async (isins, depuis) => { appels.push([isins.slice(), depuis]); return cours || {}; } } };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ["calc.js", "ui.js", "claude-prompts.js"]) vm.runInContext(readFileSync("web/src/" + f, "utf8"), ctx, { filename: f });
  vm.runInContext(js, ctx, { filename: "comptes-view.js" });
  const root = doc.createElement("section");
  root.setAttribute("id", "view-comptes-view");
  doc.body.appendChild(root);
  root.innerHTML = html;
  const api = reg["comptes-view"];
  api.mount(root);
  return { api, root, doc, appels, ctx, ouvrir: p => { params = p; api.show(); } };
}
const attendre = () => new Promise(r => setTimeout(r, 5));

test("vue : liste au départ (chargement, puis familles), fiche au lien profond (?ligne=), retour à la liste ; cours lus une fois à l'ouverture", async () => {
  const S = demoS();
  const isin = "IE00B4L5Y983";
  const m = monter({ cours: { [isin]: [{ date: CV.debutPeriode("1a", TODAY), cloture: 90 }, { date: CV.debutPeriode("1m", TODAY), cloture: 100 }] } });
  const $ = id => m.root.querySelector("#" + id);
  m.api.update(Object.assign({}, S, { ready: false }), true);
  assert.equal($("cvChargement").hidden, false);
  m.api.update(S, true);
  m.api.show();
  assert.equal($("cvChargement").hidden, true);
  assert.equal($("cvListeVue").hidden, false); assert.equal($("cvFiche").hidden, true);
  assert.equal(m.root.querySelectorAll(".cv-fam").length, 4);
  assert.ok(m.root.querySelectorAll("a.cv-carte").length >= 8);
  assert.match(sp($("cvTete").innerHTML), /193 490 €/, "patrimoine net de la démo");
  // famille repliée puis rouverte (mémorisé)
  const btn = m.root.querySelector('[data-cv-fam-btn="dettes"]');
  btn.click();
  assert.equal(btn.getAttribute("aria-expanded"), "false"); assert.equal(m.root.querySelector("#cv-fam-dettes").hidden, true);
  // lien profond : fiche ligne
  m.ouvrir({ ligne: "pea-etf-monde" });
  assert.equal($("cvListeVue").hidden, true); assert.equal($("cvFiche").hidden, false);
  assert.equal($("cvFicheTitre").textContent, "ETF MSCI World");
  assert.equal($("cvPeriode").querySelectorAll('[role="radio"]').length, 5, "sélecteur 1 M · 3 M · 1 A · 3 A · 5 A");
  await attendre();
  assert.deepEqual(J(m.appels.map(a => a[0])), [[isin]], "Store.cours appelé à l'ouverture, pour l'ISIN de la ligne");
  assert.match(m.appels[0][1], /^\d{4}-\d{2}-\d{2}$/);
  assert.match($("cvGraphe").innerHTML, /<svg class="cv-svg"/);
  // changement de période : le graphe suit, sans nouvelle lecture
  $("cvPeriode").querySelector('[data-ui-id="1m"]').click();
  assert.match($("cvGraphe").innerHTML, /sur 1 mois/);
  await attendre();
  assert.equal(m.appels.length, 1, "cours gardés en mémoire");
  // retour à la liste (lien sans paramètres)
  m.ouvrir({});
  assert.equal($("cvListeVue").hidden, false); assert.equal($("cvFiche").hidden, true);
  assert.equal(m.root.querySelector('[data-cv-fam-btn="dettes"]').getAttribute("aria-expanded"), "false", "famille repliée conservée");
  // fiche enveloppe : les trois ISIN sont demandés, sauf celui déjà lu
  m.ouvrir({ enveloppe: "PEA Camille", titulaire: "p1" });
  await attendre();
  assert.deepEqual(J(m.appels[1][0]).sort(), ["FR0000120073", "LU0908500753"]);
  assert.equal($("cvFicheTitre").textContent, "PEA Camille");
  assert.equal($("cvLignesFiche").querySelectorAll("a.cv-ligne").length, 3);
  // fiche compte courant et fiche introuvable
  m.ouvrir({ courant: "compte-commun" });
  assert.match($("cvFiche").innerHTML, /Entrées et sorties/);
  m.ouvrir({ ligne: "nulle-part" });
  assert.match($("cvFiche").innerHTML, /introuvable/);
});

test("vue : une fiche demandée avant la fin du chargement s'ouvre quand les données arrivent ; Store.cours absent → phrase, sans erreur", async () => {
  const m = monter();
  delete m.ctx.Store.cours;
  const $ = id => m.root.querySelector("#" + id);
  m.api.update(Object.assign(demoS(), { ready: false }), true);
  m.ouvrir({ ligne: "pea-etf-monde" });
  assert.match($("cvFiche").innerHTML, /Chargement du compte/);
  m.api.update(demoS(), true);
  assert.equal($("cvFicheTitre").textContent, "ETF MSCI World");
  await attendre();
  assert.match(sp($("cvGraphe").innerHTML), /Historique du cours pas encore disponible/);
});

test("tutoiement et lecture seule : aucun « vous » ; aucune écriture au store, seules lectures Store.cours et Store.banque.operations", () => {
  const txt = js.replace(/\/\*[\s\S]*?\*\//g, "") + html;
  assert.doesNotMatch(txt, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.deepEqual([...new Set([...js.matchAll(/\bStore\s*\.\s*(\w+)/g)].map(m => m[1]))].sort(), ["banque", "cours"]);
  assert.match(js, /st\.cours\(manquants, d0\)/); assert.match(js, /B\.operations\(ids, /, "seules lectures : cours et opérations");
  assert.doesNotMatch(js, /B\.(rattacher|connecter|deconnecter|synchroniser|gerer)\(/);
});

/* ------------------------------------------------ revue CP1 ------------------------------------------------ */

test("cartes sans enveloppe : une ligne → lien ?ligne=, plusieurs → carte sans lien (jamais de fiche « Sans enveloppe »)", () => {
  const un = CV.comptes(S0({ positions: [POS("a", { envelope: "" })] }), TODAY, { Calc });
  const c1 = un.familles.flatMap(F => F.etablissements.flatMap(E => E.comptes))[0];
  assert.equal(c1.href, "#patrimoine/comptes?ligne=a");
  const deux = CV.comptes(S0({ positions: [POS("a", { envelope: null }), POS("b", { envelope: "" })] }), TODAY, { Calc });
  const c2 = deux.familles.flatMap(F => F.etablissements.flatMap(E => E.comptes))[0];
  assert.equal(c2.href, null); assert.equal(c2.nom, "Sans enveloppe");
  const h = CV.carteHtml(c2);
  assert.doesNotMatch(h, /<a |href=|data-goto|Sans%20enveloppe/); assert.match(h, /<div class="cv-carte fixe" role="group" aria-label="Sans enveloppe, 2 lignes/);
});

test("doublon probable (cas type « PEA DUPONT ») : alerte sur la carte et en tête de la fiche enveloppe, « Demander à Claude » de la clôturer", () => {
  const titres = [7200, 6100, 5500, 5100, 4500, 4200, 3800, 3500, 3000, 2700, 2300, 1900, 1650].map((v, i) =>
    POS("t" + i, { name: "Titre " + i, envelope: "PEA", isin: "FR000000000" + i, qty: 1, price: v, pru: v }));
  const esp = POS("esp", { name: "Espèces PEA", bloc: "Liquidités", mode: "manual", isin: null, value: 60, qty: null, price: null, pru: null });
  const dupont = POS("dupont", { name: "PEA DUPONT", mode: "manual", isin: null, value: 51230.5, qty: null, price: null, pru: null });
  const S = S0({ positions: [...titres, esp, dupont] });
  const carte = CV.comptes(S, TODAY, { Calc }).familles.flatMap(F => F.etablissements.flatMap(E => E.comptes)).find(c => c.nom === "PEA");
  assert.deepEqual(J(carte.doublons), [{ ligne: "dupont", nom: "PEA DUPONT", enveloppe: "PEA" }]);
  const h = sp(CV.famillesHtml(CV.comptes(S, TODAY, { Calc }), new Set(), UI));
  assert.match(h, /<p class="cv-alerte" role="note"><span>La ligne « PEA DUPONT » semble recopier le total de ton enveloppe : ton patrimoine est peut-être compté deux fois\. Demande à Claude de la clôturer\.<\/span>/);
  assert.ok(decodeURIComponent(((h.match(/href="https:\/\/claude\.ai\/new\?q=([^"]+)"/) || [])[1] || "").replace(/&#39;/g, "'").replace(/&amp;/g, "&")).includes(ClaudePrompts.phrase("placements", "clôturer la ligne « PEA DUPONT » de mon enveloppe PEA, qui semble recopier son total")),
    "phrase ClaudePrompts vers la clôture");
  assert.match(h, /aria-label="PEA, [^"]*doublon probable/);
  const f = CV.ficheEnveloppe(S, { enveloppe: "PEA", titulaire: "p1" }, TODAY, { Calc });
  assert.equal(f.doublons.length, 1);
  const hf = sp(CV.ficheEnveloppeHtml(f, UI));
  assert.ok(hf.indexOf("cv-alerte") < hf.indexOf("cvGrapheTitre"), "alerte en tête de la fiche");
  // cas négatif : la ligne d'espèces de 60 € ne déclenche rien
  const sans = S0({ positions: [...titres, esp] });
  assert.ok(CV.comptes(sans, TODAY, { Calc }).familles.every(F => F.etablissements.every(E => E.comptes.every(c => !c.doublons.length))));
  assert.doesNotMatch(CV.ficheEnveloppeHtml(CV.ficheEnveloppe(sans, { enveloppe: "PEA", titulaire: "p1" }, TODAY, { Calc }), UI), /cv-alerte/);
});

test("graphes : historique plus court que la période et plafond signalés ; échec de lecture → « Réessayer »", () => {
  const f = CV.ficheLigne(S0({ positions: [POS("a", { isin: "A", price: 12 })] }), "a", TODAY, { Calc });
  const cours = { A: [{ date: CV.debutPeriode("1m", TODAY), cloture: 10 }, { date: CV.debutPeriode("1m", TODAY).replace(/\d{2}$/, "28"), cloture: 11 }] };
  const h = sp(CV.grapheLigneHtml(f, { cours, charge: "pret", periode: "1a", today: TODAY, plafond: ["A"] }, UI));
  assert.match(h, /Historique des cours disponible depuis le .* seulement : la courbe commence à cette date, pas au début de la période \(sur 1 an\)/);
  assert.match(h, /Historique tronqué/);
  assert.match(CV.grapheLigneHtml(f, { charge: "echec", periode: "1a", today: TODAY }, UI), /data-cv-reessayer/);
});

test("vue : cours de la période choisie d'abord, période plus longue relue ; échec non mémorisé (« Réessayer ») ; opérations lues pour la fiche compte courant", async () => {
  const S = demoS(), isin = "IE00B4L5Y983";
  let echoue = true;
  const m = monter({ cours: { [isin]: [{ date: CV.debutPeriode("1a", TODAY), cloture: 90 }, { date: CV.debutPeriode("1m", TODAY), cloture: 100 }] } });
  const appelsOps = [];
  const coursOk = m.ctx.Store.cours;
  m.ctx.Store.cours = async (isins, depuis) => { if (echoue) { m.appels.push([isins.slice(), depuis]); throw new Error("panne"); } return coursOk(isins, depuis); };
  m.ctx.Store.banque = { operations: async (ids, depuis) => { appelsOps.push([ids.slice(), depuis]); return DEMO.operationsBancaires; } };
  const $ = id => m.root.querySelector("#" + id);
  m.api.update(S, true);
  m.ouvrir({ ligne: "pea-etf-monde" });
  await attendre();
  assert.equal(m.appels[0][1], CV.debutPeriode("1a", TODAY), "période choisie (1 an par défaut)");
  assert.match($("cvGraphe").innerHTML, /data-cv-reessayer/, "échec : bouton Réessayer");
  echoue = false;
  $("cvGraphe").querySelector("[data-cv-reessayer]").click();
  await attendre();
  assert.match($("cvGraphe").innerHTML, /<svg class="cv-svg"/, "réessai réussi");
  const n = m.appels.length;
  $("cvPeriode").querySelector('[data-ui-id="1m"]').click();
  await attendre();
  assert.equal(m.appels.length, n, "période plus courte : déjà couverte");
  $("cvPeriode").querySelector('[data-ui-id="5a"]').click();
  await attendre();
  assert.equal(m.appels[m.appels.length - 1][1], CV.debutPeriode("5a", TODAY), "période plus longue : relue depuis son début");
  // fiche compte courant : opérations du compte bancaire rattaché, puis plus bas solde et prélèvements
  m.ouvrir({ courant: "compte-commun" });
  assert.match($("cvFiche").innerHTML, /Chargement des opérations…/);
  await attendre();
  assert.deepEqual(J(appelsOps.map(a => a[0])), [["1001"]]);
  assert.match(sp($("cvFiche").innerHTML), /echeance pret immo/);
  assert.doesNotMatch($("cvFiche").innerHTML, /Chargement des opérations/);
});
