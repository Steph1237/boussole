// Patrimoine › Placements (web/src/pilotage.*) : en-tête (total, variation sur 1 an), graphe maître (préréglage placements), regroupements
// (enveloppe, poche, titulaire, disponibilité), panneau d'une ligne (détail en lecture, liens Claude), accordéons de suivi
// (allocation, ordres, versements, hypothèses, journal des mouvements). Lecture seule : aucune écriture au store, la saisie passe
// par Claude (« Compléter avec Claude », « Corriger avec Claude »), textes au tutoiement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/pilotage.js", "utf8");
const css = readFileSync("web/src/pilotage.css", "utf8");
const html = readFileSync("web/src/pilotage.html", "utf8");
const PL = require("../web/src/pilotage.js");
const UI = require("../web/src/ui.js");
const Calc = require("../web/src/calc.js");
const Periodes = require("../web/src/periodes.js");
const ClaudePrompts = require("../web/src/claude-prompts.js");
const DEMO = require("../web/src/demo-data.js");

const DEPS = { Calc, Periodes, ClaudePrompts };
const TODAY = "2026-10-11";
const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ");
const demoS = o => Object.assign(J(DEMO), { ready: true, dbOk: true, scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], error: null }, o);
const POS = (id, o) => Object.assign({ id, name: "Ligne " + id, envelope: "PEA", owner: "p1", bloc: "Monde", mode: "market", isin: null, qty: 10, pru: 100, price: 110,
  priceDate: "2026-10-10", value: null, valueDate: null, status: "actif", hypothesis: null, qtyEstimated: false, note: null }, o);
const XSS = '<img src=x onerror="alert(1)">';
const sansCommentaires = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** Phrase d'un lien Claude, décodée depuis son href. */
const phrasesClaude = h => [...String(h).matchAll(/href="https:\/\/claude\.ai\/new\?q=([^"]*)"/g)].map(m => decodeURIComponent(m[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&")));

/* ------------------------------------------------------------------ structure ------------------------------------------------------------------ */
test("pilotage.js : se compile, s'enregistre sous « pilotage », aucune requête DOM globale hors racine", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "pilotage.js" }));
  assert.match(js, /App\.register\("pilotage", api\)/);
  assert.match(js, /__pending/);
  assert.deepEqual(js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l)), []);
  assert.match(js, /const \$ = id => root\.querySelector\("#" \+ id\)/);
});

test("pilotage.js : la partie pure ne touche ni au DOM ni à window.UI (UI reçu en paramètre)", () => {
  const pur = sansCommentaires(js.slice(0, js.indexOf('if (typeof document === "undefined") return;')));
  assert.doesNotMatch(pur, /document\./);
  assert.doesNotMatch(pur, /window\.UI|\bUI\.(carte|panneau|periode|brancher|voirPlus|bascule|accordeon|demanderAClaude)\(/);
});

test("pilotage (Patrimoine › Placements) : plus de carte santé, d'alertes ni de règles ; chiffre clé = total financier", () => {
  const code = sansCommentaires(js);
  assert.doesNotMatch(code, /Plan\.score/);
  assert.doesNotMatch(code, /Rules\.evaluate/);
  assert.doesNotMatch(code, /Rules\.builtins/);
  assert.doesNotMatch(html, /id="sante"|id="alerts"|id="ruleForm"|id="cushForm"/);
  assert.match(code, /function headline\(\) \{ return S && \(S\.positions \|\| \[\]\)\.length \? eur\(totaux\(S\)\.total\) : "–"; \}/);
});

test("pilotage.html : identifiants utilisés par le script, en-tête, bascule, état vide, suivi", () => {
  const ids = [...js.matchAll(/\$\("(pl[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 12);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
  for (const id of ["plTotal", "plSous", "plGraphe", "plGrapheBloc", "plMode", "plGroupes", "plSuivi", "plVide", "plChargement", "plVideClaude"])
    assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.doesNotMatch(html, /plPeriode|plCourbe|plCourbeNote/, "plus de sélecteur de période ni de courbe du passé seul : le graphe maître a sa propre commande de temps");
  assert.doesNotMatch(html, /plCompleter|plMvtClaude|plClaude"/, "plus de bouton Claude empilé : le bouton de l'en-tête couvre les demandes de la page");
  assert.doesNotMatch(html, /<select|<table/, "plus de formulaire ni de tableau affichés d'un coup");
});

test("pilotage.css : scopé sous #view-pilotage (contenu du panneau sous .ui-panneau .pl-…), thème et mobile", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(sels.length > 40);
  const bad = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !/^#view-pilotage\b/.test(x) && !/^\.ui-panneau \.pl-/.test(x));
  assert.deepEqual(bad, []);
  assert.match(css, /@media \(max-width:\s*\d+px\)/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b(?![-\w])/, "couleurs par variables du thème (clair et sombre)");
  assert.doesNotMatch(css, /\.pl-form\b|\.pl-in\b|\.pl-check\b/, "plus de styles de formulaire");
});

test("pilotage : lecture seule — aucun formulaire, aucune écriture au store, aucun import", () => {
  for (const [nom, src] of [["pilotage.js", js], ["pilotage.html", html]]) {
    assert.doesNotMatch(src, /<form|type="submit"|<input|<select|<textarea|<datalist/, nom + " : formulaire");
    assert.doesNotMatch(src, /Store\.|\.doc\(|\.collection\(|\.addMany\(|Import\.open|window\.Import/, nom + " : écriture au store ou import");
    assert.doesNotMatch(src, /Modifier à la main|Ajouter à la main|data-pl-ajouter|data-pl-todo|data-pl-hyp=|data-pl-act/, nom + " : ancienne saisie");
  }
  for (const f of ["mouvement", "champsMouvement", "nouvelleLigne", "modificationLigne", "formMouvementHtml", "formLigneHtml"]) assert.equal(PL[f], undefined, f);
});

test("pilotage : un seul « Compléter avec Claude » (état vide), les autres demandes sont dans le bouton Claude de l'en-tête ; branché sur ClaudePrompts", () => {
  assert.doesNotMatch(js, /"Enregistrer un mouvement avec Claude"\)\s*;?\s*\n\s*\$\("plVideClaude"\)/);
  assert.doesNotMatch(js, /\$\("plCompleter"\)|\$\("plMvtClaude"\)|\$\("plClaude"\)/);
  assert.match(js, /\$\("plVideClaude"\)\.innerHTML = u\.demanderAClaude\(phraseClaude\("placements"\), "Compléter avec Claude"\)/);
  assert.equal(PL.phraseClaude("placements", "la ligne « X »", DEPS), ClaudePrompts.phrase("placements", "la ligne « X »"));
  assert.match(PL.phraseClaude("placements", "", { ClaudePrompts: null }), /^Boussole : /, "repli sans ClaudePrompts");
});

test("pilotage : tutoiement — aucun « vous / votre / vos » dans le module", () => {
  for (const [nom, src] of [["pilotage.js", js], ["pilotage.html", html]]) {
    const m = src.match(/\b(vous|votre|vos)\b/gi);
    assert.equal(m, null, nom + " : " + (m || []).join(", "));
  }
});

test("pilotage.js : la tête de page monte le graphe maître (préréglage placements), lit le passé reconstitué comme Aujourd'hui, plus de sélecteur de période", () => {
  const code = sansCommentaires(js);
  assert.match(code, /Mo\.brancher\(el, \{ preset: "placements", deps: \{ UI: u \}/);
  assert.match(code, /today: \(\) => jour\(\), perimetre: \(\) => scopeLabel\(\)/);
  assert.match(code, /liaison\.actualiser\(S\)/, "recalcul seulement si l'entrée a changé (GrapheModele)");
  assert.match(code, /sn\.charger\(S, jour\(\), \{ id: "tout" \}, null\)/, "SerieNet.charger sur « tout » (cours, transactions, banque)");
  assert.match(code, /sn\.abonner\(histPrete\)/, "la fin de la lecture relance le graphe");
  assert.doesNotMatch(code, /u\.periode\(|plPeriode|plCourbe|courbeSvg|ctlPeriode|granChoisie|granEnCours|EVO_KEY|pilotage-evo|surPeriode|ResizeObserver/);
  assert.doesNotMatch(code, /Periodes\.|Pe\.granularit|GRANULARITES/);
  assert.equal(PL.courbeSvg, undefined);
  assert.equal(PL.evolution, undefined);
  assert.equal(PL.periodeTxt, undefined);
  assert.doesNotMatch(code, /localStorage\.setItem\((?!CLE_MODE)/, "seul le regroupement des lignes est mémorisé : les réglages du graphe restent locaux");
});

/* ------------------------------------------------------------------ grouper ------------------------------------------------------------------ */
test("grouper : par enveloppe (démo) — montants = Calc, parts à 100 %, tri décroissant, « à recevoir » non compté", () => {
  const S = demoS();
  const gs = PL.grouper(S.positions, "enveloppe", S, DEPS);
  const total = Calc.financier(S.positions, "foyer");
  assert.ok(gs.length >= 6);
  assert.ok(Math.abs(gs.reduce((a, g) => a + g.montant, 0) - total) < 1e-6);
  assert.ok(Math.abs(gs.reduce((a, g) => a + g.part, 0) - 100) < 1e-6);
  for (let i = 1; i < gs.length; i++) assert.ok(gs[i - 1].montant >= gs[i].montant, "tri décroissant");
  const pea = gs.find(g => g.cle === "PEA Camille");
  assert.equal(pea.label, "PEA Camille");
  assert.deepEqual(pea.lignes.map(p => p.envelope), pea.lignes.map(() => "PEA Camille"));
  assert.ok(pea.plusValue > 0, "plus-value latente des lignes cotées avec PRU");
  const rec = gs.find(g => g.cle === "À recevoir");
  assert.equal(rec.montant, 0);
  assert.ok(rec.aRecevoir > 0);
  assert.equal(gs.reduce((a, g) => a + g.nb, 0), S.positions.filter(p => p.status !== "clôturé").length);
});

test("grouper : par poche, par titulaire (prénoms), par disponibilité (ordre immédiat → bloqué, libellés de Calc)", () => {
  const S = demoS();
  const poches = PL.grouper(S.positions, "poche", S, DEPS);
  assert.ok(poches.some(g => g.cle === "Monde") && poches.some(g => g.cle === "Épargne"));
  assert.ok(poches.every(g => g.cible === null), "pas de cible pour le foyer");
  const tit = PL.grouper(S.positions, "titulaire", S, DEPS);
  assert.deepEqual(tit.map(g => g.label).sort(), ["Camille", "Sam"]);
  const dispo = PL.grouper(S.positions, "disponibilite", S, DEPS);
  const ordre = ["immediate", "jours", "semaines", "bloque"];
  assert.deepEqual(dispo.map(g => g.cle), ordre.filter(k => dispo.some(g => g.cle === k)));
  for (const g of dispo) assert.equal(g.label, Calc.LIQUIDITE_LABELS[g.cle]);
  const per = dispo.find(g => g.cle === "bloque");
  assert.ok(per && per.lignes.some(p => /PER/.test(p.envelope)), "le PER est bloqué");
  const parLiq = Calc.parLiquidite(S.positions, "foyer");
  for (const g of dispo) assert.ok(Math.abs(g.montant - (parLiq[g.cle] || 0)) < 1e-6, "mêmes montants que Calc.parLiquidite : " + g.cle);
  assert.deepEqual(PL.grouper(S.positions, "inconnu", S, DEPS).map(g => g.cle), PL.grouper(S.positions, "enveloppe", S, DEPS).map(g => g.cle), "mode inconnu → enveloppe");
});

test("grouper : périmètre d'une personne, cibles de poche, lignes clôturées écartées, « à recevoir » en fin de groupe", () => {
  const S = demoS({ scope: "p1" });
  const gs = PL.grouper(S.positions, "poche", S, DEPS);
  assert.ok(gs.every(g => g.lignes.every(p => p.owner === "p1")));
  const monde = gs.find(g => g.cle === "Monde");
  assert.equal(monde.cible, S.config.targets.p1.Monde);
  const ps = [POS("a", { qty: 1, price: 10 }), POS("b", { qty: 5, price: 10 }), POS("c", { status: "à recevoir", mode: "manual", value: 999 }), POS("d", { status: "clôturé" })];
  const g = PL.grouper(ps, "enveloppe", { scope: "foyer", people: [] }, DEPS)[0];
  assert.deepEqual(g.lignes.map(p => p.id), ["b", "a", "c"]);
  assert.equal(g.montant, 60);
  assert.equal(g.aRecevoir, 999);
  assert.deepEqual(PL.grouper([], "poche", {}, DEPS), []);
  assert.deepEqual(PL.grouper(null, "poche", null, DEPS), []);
});

test("totaux et matelas : total compté, lignes, plus-values latentes, sommes à recevoir, cible du matelas", () => {
  const S = demoS();
  const t = PL.totaux(S, DEPS);
  assert.ok(Math.abs(t.total - Calc.financier(S.positions, "foyer")) < 1e-6);
  assert.equal(t.nb, S.positions.filter(Calc.counted).length);
  assert.ok(t.aRecevoir.length >= 1 && t.aRecevoir[0].montant > 0);
  const lat = S.positions.filter(p => Calc.counted(p) && p.mode === "market" && p.pru && p.qty && p.price).reduce((a, p) => a + p.qty * (p.price - p.pru), 0);
  assert.ok(Math.abs(t.plusValue - lat) < 1e-6);
  const m = PL.matelas(S, DEPS);
  assert.ok(Math.abs(m.montant - Calc.poche(S.positions, "foyer", "Épargne")) < 1e-6);
  assert.equal(sp(m.cible), "cible 15 000 € à 20 000 €");
  assert.equal(sp(PL.matelas(demoS({ scope: "p2" }), DEPS).cible), "cible du foyer 15 000 € à 20 000 €");
  assert.equal(PL.matelas({ positions: [], config: {} }, DEPS).cible, "pas de cible définie");
});

/* ------------------------------------------------------------------ variation ------------------------------------------------------------------ */
const SNAPS = [{ date: "2025-09-30", foyer: 100000, p1: 60000, p2: 40000 }, { date: "2026-03-31", foyer: 110000, p1: 66000, p2: 44000 },
  { date: "2026-09-30", foyer: 118000, p1: 70000, p2: 48000, source: "relevés" }];

test("variation : photos + valeur en direct, sur 1 an ; part de la dernière valeur avant la période", () => {
  const S = { scope: "foyer", positions: [POS("a", { qty: 1000, price: 120 })], snapshots: SNAPS };
  const ev = PL.variation(S, TODAY, DEPS);
  assert.equal(ev.resume.variation, 120000 - 100000, "début = dernière photo avant la période");
  assert.ok(Math.abs(ev.resume.variationPct - 20) < 1e-9);
  assert.deepEqual(ev.bornes, Periodes.bornes("1a", TODAY, SNAPS[0].date));
  assert.equal(ev.historique, true);
  assert.equal(ev.reconstitue, true);
  const p2 = PL.variation(Object.assign({}, S, { scope: "p2" }), TODAY, DEPS);
  assert.equal(p2.resume.variation, 0 - 40000, "aucune ligne de Sam dans S.positions : la valeur en direct est 0");
});

test("variation : sans photo, sans Periodes ; pure (aucun accès au DOM)", () => {
  const S = { scope: "foyer", positions: [POS("a", { qty: 1000, price: 120 })], snapshots: SNAPS };
  const vide = PL.variation({ scope: "foyer", positions: [], snapshots: [] }, TODAY, DEPS);
  assert.equal(vide.historique, false);
  assert.equal(vide.reconstitue, false);
  const brut = PL.variation(S, TODAY, { Calc, Periodes: null });
  assert.equal(brut.resume, null);
  assert.equal(brut.historique, true);
  const fn = js.slice(js.indexOf("  function variation("), js.indexOf("  /* =============================================================== détail d'une ligne"));
  assert.doesNotMatch(fn, /document|window|localStorage|querySelector|\$\(/);
});

/* ------------------------------------------------------------------ détail d'une ligne ------------------------------------------------------------------ */
test("etatDonnee : à recevoir, manuel daté, cours à récupérer, cours récent ou ancien, quantité estimée, hypothèse", () => {
  assert.deepEqual(PL.etatDonnee(POS("a", { status: "à recevoir" }), TODAY).map(c => c.texte), ["à recevoir"]);
  assert.match(sp(PL.etatDonnee(POS("a", { mode: "manual", valueDate: "2026-09-01" }), TODAY)[0].texte), /^manuel · 1 sept\. 2026$/);
  assert.deepEqual(PL.etatDonnee(POS("a", { priceDate: null }), TODAY)[0], { texte: "cours à récupérer", ton: "attention" });
  assert.equal(PL.etatDonnee(POS("a", { priceDate: "2026-10-09" }), TODAY)[0].ton, "bon");
  assert.equal(PL.etatDonnee(POS("a", { priceDate: "2026-09-01" }), TODAY)[0].ton, "attention");
  assert.deepEqual(PL.etatDonnee(POS("a", { qtyEstimated: true, hypothesis: "?" }), TODAY).slice(1).map(c => c.texte), ["qté estimée", "hypothèse"]);
  assert.deepEqual(PL.etatDonnee(null, TODAY), []);
});

test("detailLigne : cours et date, quantité, PRU, plus-value latente, poids, frais / zone / devise avec source, statut, contexte pour Claude", () => {
  const S = demoS();
  const p = S.positions.find(x => x.id === "pea-etf-europe");
  const d = PL.detailLigne(p, S, TODAY, DEPS);
  const F = Object.fromEntries(d.faits);
  assert.equal(d.titre, "ETF Stoxx Europe 600");
  assert.equal(d.meta, "PEA Camille · Europe · Camille");
  // Le cours de démo est daté de la veille du jour réel (demo-data.js) : la date attendue suit p.priceDate.
  const jourCours = Number(String(p.priceDate).slice(8, 10));
  assert.match(sp(F["Cours"]), new RegExp("^248,30 € · " + jourCours + " [a-zéû]+\\.? \\d{4}$"));
  assert.equal(F["Quantité"], "36");
  assert.equal(sp(F["Prix de revient unitaire (PRU)"]), "215,10 €");
  assert.match(sp(F["Plus-value latente"]), /^\+1 1\d\d € \(\+15 %\)$/);
  assert.equal(sp(F["Frais courants"]), "0,07 % par an");
  assert.equal(F["Zone"], "Europe");
  assert.match(d.source, /frais courants 0,07 %, relevé le \d{1,2} [a-zéû]+\.? \d{4}$/);
  const total = Calc.financier(S.positions, "foyer");
  assert.ok(Math.abs(d.poids - Calc.val(p) / total * 100) < 1e-9);
  assert.equal(F["Statut"], "Actif");
  assert.equal(d.contexte, "la ligne « ETF Stoxx Europe 600 » (PEA Camille)");
});

test("detailLigne : ligne manuelle, ligne à recevoir (non comptée), sans annotation", () => {
  const S = { scope: "foyer", people: [{ id: "p1", nom: "Camille" }], positions: [POS("m", { mode: "manual", value: 5000, valueDate: "2026-09-15", note: "Livret de Noël" }), POS("r", { mode: "manual", value: 800, status: "à recevoir" })] };
  const d = PL.detailLigne(S.positions[0], S, TODAY, DEPS);
  const F = Object.fromEntries(d.faits);
  assert.equal(sp(F["Valeur"]), "5 000 €");
  assert.match(F["Plus-value latente"], /non suivie/);
  assert.equal(F["Frais, zone, devise"], "non renseignés");
  assert.equal(d.note, "Livret de Noël");
  assert.equal(d.meta, "PEA · Monde", "pas de titulaire avec une seule personne");
  const r = PL.detailLigne(S.positions[1], S, TODAY, DEPS);
  assert.equal(Object.fromEntries(r.faits)["Poids dans les placements"], "non compté");
  assert.equal(r.poids, null);
});

test("detailHtml : lecture seule et échappé ; « Corriger avec Claude » et « Enregistrer un mouvement avec Claude » portent la ligne", () => {
  const p = POS("x", { name: XSS, envelope: XSS, note: XSS, hypothesis: XSS, annoteSource: XSS });
  const h = PL.detailHtml(PL.detailLigne(p, { scope: "foyer", positions: [p] }, TODAY, DEPS), UI, { deps: DEPS });
  assert.doesNotMatch(h, /<img/);
  assert.doesNotMatch(h, /<form|<input|<button|data-pl-act|data-pl-zone|data-pl-msg/);
  assert.match(h, />Corriger avec Claude</);
  assert.match(h, />Enregistrer un mouvement avec Claude</);
  const [corriger, mvt] = phrasesClaude(h);
  assert.equal(corriger, ClaudePrompts.phrase("placements", "la ligne « " + XSS + " » (" + XSS + ")"));
  assert.equal(mvt, ClaudePrompts.phrase("mouvement", "la ligne « " + XSS + " » (" + XSS + ")"));
  assert.match(h, /Hypothèse à confirmer :/);
});

/* ------------------------------------------------------------------ suivi ------------------------------------------------------------------ */
test("hypotheses, versements, ordres, journalMouvements : contenu et ordre (démo)", () => {
  const S = demoS();
  S.positions[2].hypothesis = "Quantité lue sur un relevé ancien";
  S.config.recurring[1].hypothesis = "Montant à vérifier";
  const H = PL.hypotheses(S, DEPS);
  const attendues = S.positions.filter(p => p.hypothesis).map(p => "pos:" + p.id).concat(["rec:1", "cfg:0"]);
  assert.deepEqual(H.map(h => h.kind + ":" + h.id), attendues);
  assert.match(H.find(h => h.kind === "rec").text, /^Épargne Livret A : Montant à vérifier$/);
  S.config.recurring[1].hypothesis = null;
  const vs = PL.versements(S, TODAY, DEPS);
  assert.deepEqual(vs.map(v => [v.label, v.enveloppe, v.etat, v.montant]), [["Versement PEA Camille", "PEA Camille", "actif", 300], ["Épargne Livret A", vs[1].enveloppe, "actif", 200]]);
  assert.equal(PL.versements(S, "2026-01-01", DEPS)[0].etat, "prevu");
  assert.deepEqual(PL.ordres(S).map(o => o.fait), [false, false]);
  const jm = PL.journalMouvements({ positions: [POS("a")], tx: [{ date: "2026-09-01", type: "achat", positionId: "a", qty: 2, price: 10 }, { date: "2026-10-01", type: "programme", positionId: "zz", amount: 300, source: "agent" }] }, 50, DEPS);
  assert.deepEqual(jm.map(x => [x.type, x.ligne, x.agent]), [["Versement programmé", "zz", true], ["Achat", "Ligne a", false]]);
  assert.equal(PL.journalMouvements({ tx: Array.from({ length: 80 }, (_, i) => ({ date: "2026-01-01", type: "achat", positionId: "a", createdAt: String(i) })) }, undefined, DEPS).length, 50);
});

test("périmètre : hypothèses, versements et journal des mouvements suivent S.scope (Calc.inScope)", () => {
  const S = demoS({ scope: "p2" });
  const camille = S.positions.find(p => p.owner === "p1"), sam = S.positions.find(p => p.owner === "p2");
  camille.hypothesis = "à Camille"; sam.hypothesis = "à Sam";
  S.config.recurring[0].hypothesis = "versement de Camille";
  S.config.hypotheses.push({ text: "Hypothèse de Sam", owner: "p2", done: false });
  S.tx.push({ date: TODAY, type: "achat", positionId: sam.id, qty: 1, price: 10, amount: 10 });
  const H = PL.hypotheses(S, DEPS).map(h => h.text);
  assert.ok(H.some(t => /à Sam/.test(t)) && !H.some(t => /à Camille|versement de Camille/.test(t)), "lignes et versements de Sam seulement");
  assert.ok(H.includes("Hypothèse de Sam"));
  assert.ok(!H.some(t => /compte courant commun/.test(t)), "hypothèse du foyer (sans titulaire) : vue Foyer seulement");
  assert.ok(PL.hypotheses(demoS(), DEPS).some(h => /compte courant commun/.test(h.text)));
  assert.deepEqual(PL.versements(S, TODAY, DEPS), [], "les versements programmés de la démo sont sur des lignes de Camille");
  const jm = PL.journalMouvements(S, 50, DEPS);
  const nomsSam = S.positions.filter(p => p.owner === "p2").map(p => p.name);
  assert.equal(jm[0].ligne, sam.name);
  assert.ok(jm.every(x => nomsSam.includes(x.ligne)), "journal limité aux lignes de Sam");
  assert.equal(PL.journalMouvements(demoS({ scope: "p1" }), 50, DEPS).length, DEMO.tx.filter(x => (DEMO.positions.find(p => p.id === x.positionId) || {}).owner === "p1").length);
  assert.equal(PL.journalMouvements(demoS(), 50, DEPS).length, DEMO.tx.length, "foyer : tout");
});

test("titresSuivi : un mot d'état par accordéon, sans compteur", () => {
  const S = demoS();
  const T = PL.titresSuivi(S, TODAY, DEPS);
  assert.deepEqual(Object.keys(T), ["alloc", "ordres", "versements", "hyp", "journal"]);
  assert.equal(T.ordres, "Ordres à passer · en attente");
  assert.equal(T.hyp, "Hypothèses à confirmer · à vérifier");
  assert.equal(sp(T.versements), "Versements programmés · 500 € par mois");
  assert.equal(T.journal, "Journal des mouvements");
  for (const t of Object.values(T)) assert.doesNotMatch(t, /\d+ (ordre|hypothèse|mouvement|ligne)/, t);
  S.config.todo.forEach(o => { o.done = true; }); S.config.hypotheses = []; S.tx = []; S.positions.forEach(p => { p.hypothesis = null; });
  const T2 = PL.titresSuivi(S, TODAY, DEPS);
  assert.equal(T2.ordres, "Ordres à passer · tous passés");
  assert.equal(T2.hyp, "Hypothèses à confirmer · toutes confirmées");
  assert.equal(T2.journal, "Journal des mouvements · vide");
  assert.equal(PL.titresSuivi({ config: {} }, TODAY, DEPS).ordres, "Ordres à passer · aucun");
});

test("allocation : parts par poche, cibles et écarts de la personne (tolérance), aucune cible pour le foyer", () => {
  const a = PL.allocation(demoS({ scope: "p1" }), DEPS);
  assert.equal(a.cibles, true);
  assert.equal(a.tolerance, 3);
  assert.ok(Math.abs(a.lignes.reduce((s, l) => s + l.pct, 0) - 100) < 1e-6);
  const monde = a.lignes.find(l => l.poche === "Monde");
  assert.equal(monde.cible, 45);
  assert.ok(Math.abs(monde.ecart - (monde.pct - 45)) < 1e-9);
  assert.ok(["bon", "attention", "critique"].includes(monde.ton));
  const f = PL.allocation(demoS(), DEPS);
  assert.equal(f.cibles, false);
  assert.ok(f.lignes.every(l => l.cible === null));
});

test("rendus du suivi : échappés, en lecture (pas de case ni de bouton), liens Claude, 5 puis « Voir plus », états vides", () => {
  const S = { scope: "foyer", positions: [POS("a", { name: XSS, hypothesis: XSS })],
    config: { todo: Array.from({ length: 7 }, (_, i) => ({ text: i ? "Ordre " + i : XSS, amount: XSS, done: i === 0 })), recurring: Array.from({ length: 6 }, (_, i) => ({ label: "V" + i, positionId: "a", amount: 10, day: 1, start: "2026-01-01" })), hypotheses: [] },
    tx: Array.from({ length: 7 }, (_, i) => ({ date: "2026-10-0" + (i + 1), type: "achat", positionId: "a", qty: 1, price: 10, note: XSS })) };
  const o = PL.ordresHtml(S, UI, DEPS), h = PL.hypothesesHtml(S, UI, DEPS), j = PL.journalHtml(S, UI, DEPS), v = PL.versementsHtml(S, TODAY, UI, DEPS), al = PL.allocationHtml(S, DEPS);
  for (const x of [o, h, j, v, al]) {
    assert.doesNotMatch(x, /<img/);
    assert.doesNotMatch(x, /<input|<button(?![^>]*data-ui-voirplus)|<form/, "lecture seule");
  }
  assert.match(o, /class="pl-li-t pl-fait"/);
  assert.match(o, /<span class="pl-chip bon">passé<\/span>/);
  assert.match(o, /<span class="pl-chip attention">à passer<\/span>/);
  assert.match(o, /Voir plus d(&#39;|')ordres \(2\)/);
  assert.match(o, />Signaler un ordre passé à Claude</);
  assert.match(h, />Confirmer avec Claude</);
  assert.equal(phrasesClaude(h)[0], ClaudePrompts.phrase("placements", "l'hypothèse « " + XSS + " : " + XSS + " » à confirmer ou corriger"));
  assert.match(j, /Voir plus de mouvements \(2\)/);
  assert.match(j, />Enregistrer un mouvement avec Claude</);
  assert.match(v, /Voir plus de versements \(1\)/);
  assert.match(v, />Régler avec Claude</, "versements programmés : réglés avec Claude (proposition regler_versements)");
  assert.equal(phrasesClaude(v)[0], ClaudePrompts.phrase("versements", ""));
  assert.match(v, /sans saisie de ta part/);
  assert.match(v, /règle-les avec Claude : il dépose une proposition que tu valides dans Agent › À valider/);
  assert.match(al, /href="#pilotage\/risque"/);
  assert.match(PL.ordresHtml({ config: {} }, UI, DEPS), /Aucun ordre en attente\. Les ordres décidés avec Claude/);
  assert.match(PL.hypothesesHtml({ config: {}, positions: [] }, UI, DEPS), /Toutes les hypothèses sont confirmées/);
  assert.match(PL.journalHtml({ tx: [] }, UI, DEPS), /Aucun mouvement enregistré/);
  assert.match(PL.versementsHtml({ config: {} }, TODAY, UI, DEPS), /Aucun versement programmé\. Règle-les avec Claude.*>Régler avec Claude</);
  assert.match(PL.allocationHtml(demoS(), DEPS), /choisis un prénom en haut de page/);
});

test("groupesHtml : cartes dépliables (aria-expanded / aria-controls), lignes en boutons, 5 puis « Voir plus », échappement", () => {
  const ps = Array.from({ length: 7 }, (_, i) => POS("l" + i, { name: i === 0 ? XSS : "L" + i, envelope: i < 6 ? XSS : "CTO" }));
  const S = { scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], positions: ps };
  const gs = PL.grouper(ps, "enveloppe", S, DEPS);
  const h = PL.groupesHtml(gs, "enveloppe", S, UI, { ouverts: new Set([XSS]), today: TODAY, deps: DEPS });
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /class="pl-g-btn" data-pl-groupe-btn="[^"]+" aria-expanded="true" aria-controls="pl-g-0"/);
  assert.doesNotMatch(h, /Voir plus de groupes/, "2 groupes : pas de « Voir plus »");
  assert.match(h, /aria-expanded="false" aria-controls="pl-g-1"/);
  assert.match(h, /id="pl-g-1" hidden/);
  assert.match(h, /data-pl-ligne="l1" aria-haspopup="dialog"/);
  assert.match(h, /Voir plus de lignes \(1\)/);
  assert.match(h, /Camille/, "titulaire affiché pour le foyer");
  assert.match(sp(h), /6 lignes · 86 %/);
  const neuf = Array.from({ length: 9 }, (_, i) => POS("g" + i, { envelope: "E" + i, qty: 10 - i }));
  const h9 = PL.groupesHtml(PL.grouper(neuf, "enveloppe", { scope: "foyer" }, DEPS), "enveloppe", { scope: "foyer" }, UI, { today: TODAY, deps: DEPS });
  assert.match(h9, /data-pl-vp="groupes:enveloppe"/);
  assert.match(h9, /Voir plus de groupes \(4\)/, "5 groupes puis « Voir plus »");
  assert.equal(new Set([...h9.matchAll(/aria-controls="(pl-g-\d+)"/g)].map(m => m[1])).size, 9, "identifiants uniques, y compris dans le reste");
  const att = PL.groupesHtml(PL.grouper([POS("r", { envelope: "À recevoir", mode: "manual", value: 2500, status: "à recevoir" })], "enveloppe", { scope: "foyer" }, DEPS), "enveloppe", { scope: "foyer" }, UI, { deps: DEPS });
  assert.match(sp(att), /à recevoir, non compté/);
  assert.match(sp(att), /class="pl-g-val">2 500 €/, "somme attendue plutôt que 0 €");
});

/* ------------------------------------------------------------------ vue (mini-DOM) ------------------------------------------------------------------ */
const uiJs = readFileSync("web/src/ui.js", "utf8");
/** Monte Placements (calc, periodes, ui, claude-prompts, pilotage) dans le mini-DOM. Le store n'expose aucune écriture : la vue est
    en lecture seule. stockage = contenu initial du localStorage simulé (clé → valeur). */
function vueDom(S0, stockage, fakes) {
  const dom = miniDom(), { doc } = dom;
  let S = J(S0);
  const modules = {}, store = new Map(Object.entries(stockage || {}));
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, Date, Math, JSON };
  ctx.window = ctx; ctx.self = ctx;
  ctx.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } };
  ctx.App = { register: (n, api) => { modules[n] = api; } };
  ctx.Store = { get: () => S };
  vm.createContext(ctx);
  for (const f of ["format.js", "calc.js", "periodes.js"]) vm.runInContext(readFileSync("web/src/" + f, "utf8"), ctx, { filename: f });
  vm.runInContext(uiJs, ctx, { filename: "ui.js" });
  vm.runInContext(readFileSync("web/src/claude-prompts.js", "utf8"), ctx, { filename: "claude-prompts.js" });
  vm.runInContext(readFileSync("web/src/comptes-view.js", "utf8"), ctx, { filename: "comptes-view.js" }); // window.ComptesView (adresses des fiches)
  Object.assign(ctx, fakes || {}); // GrapheModele / SerieNet factices (le vrai composant a ses propres tests)
  vm.runInContext(js, ctx, { filename: "pilotage.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.setAttribute("id", "view-pilotage");
  root.innerHTML = html;
  const api = modules.pilotage;
  api.mount(root);
  api.update(S, true);
  const rafraichir = () => api.update(S, true);
  rafraichir.avec = S1 => { S = J(S1); api.update(S, true); };
  const dlg = () => doc.body.querySelector('[role="dialog"]');
  return { ctx, dom, doc, root, api, rafraichir, dlg, store, S: () => S };
}
const $ = (root, id) => root.querySelector("#" + id);

test("vue (DOM) : en-tête (total, lignes, Compléter avec Claude), bascule de regroupement à 4 options, groupes repliés, suivi en accordéons fermés", () => {
  const { root, api } = vueDom(demoS());
  const total = Calc.financier(DEMO.positions, "foyer");
  assert.equal(sp($(root, "plTotal").textContent), sp(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(total)) + " €"));
  assert.equal(api.headline(), $(root, "plTotal").textContent);
  assert.match($(root, "plTitre").textContent, /^Placements du foyer$/);
  assert.match($(root, "plSous").textContent, /\d+ lignes/);
  assert.equal(root.querySelectorAll(".ui-claude").filter(b => b.closest(".pl-tete")).length, 0, "pas de bouton Claude empilé sous le total (celui de l'en-tête de la coque les couvre)");
  const radios = $(root, "plMode").querySelectorAll('[role="radio"]');
  assert.deepEqual(radios.map(r => r.textContent), ["Enveloppe", "Poche", "Titulaire", "Disponibilité"]);
  assert.ok(root.querySelectorAll("[data-pl-groupe-btn]").length >= 6);
  assert.ok(root.querySelectorAll("[data-pl-groupe-btn]").every(b => b.getAttribute("aria-expanded") === "false"));
  assert.ok(root.querySelectorAll(".pl-g-corps").every(c => c.hidden));
  const accs = $(root, "plSuivi").querySelectorAll("[data-pl-acc]").map(x => x.getAttribute("data-pl-acc"));
  assert.deepEqual(accs, ["alloc", "ordres", "versements", "hyp", "journal"]);
  assert.ok($(root, "plSuivi").querySelectorAll("details").every(d => !d.hasAttribute("open")));
  assert.deepEqual($(root, "plSuivi").querySelectorAll(".ui-acc-titre").map(s => sp(s.textContent)).slice(1, 3), ["Ordres à passer · en attente", "Versements programmés · 500 € par mois"]);
  assert.equal($(root, "plVide").hidden, true);
  assert.equal($(root, "plChargement").hidden, true);
  assert.equal(root.querySelectorAll("input").length, 0, "aucun champ de saisie");
  assert.equal($(root, "plPeriode"), null, "plus de sélecteur de période ni de granularité");
  assert.equal($(root, "plGrapheBloc").hidden, false);
});

test("vue (DOM) : bascule « Par disponibilité » (note limitée au financier) puis dépliage d'un groupe ; l'état déplié survit à une mise à jour du store", () => {
  const { root, dom, rafraichir } = vueDom(demoS());
  const radio = $(root, "plMode").querySelectorAll('[role="radio"]')[3];
  radio.click();
  assert.equal(radio.getAttribute("aria-checked"), "true");
  assert.match($(root, "plModeNote").textContent, /Délai pour récupérer l'argent placé/);
  assert.match($(root, "plModeNote").textContent, /Vue limitée aux placements financiers/);
  assert.doesNotMatch($(root, "plModeNote").textContent, /PER, immobilier/);
  const noms = root.querySelectorAll(".pl-g-nom").map(x => x.textContent);
  assert.deepEqual(noms, Object.values(Calc.LIQUIDITE_LABELS).filter(l => noms.includes(l)));
  const b = root.querySelector("[data-pl-groupe-btn]");
  b.click();
  assert.equal(b.getAttribute("aria-expanded"), "true");
  assert.equal(root.querySelector("#" + b.getAttribute("aria-controls")).hidden, false);
  rafraichir();
  const b2 = root.querySelector('[data-pl-groupe-btn="' + b.getAttribute("data-pl-groupe-btn") + '"]');
  assert.equal(b2.getAttribute("aria-expanded"), "true", "toujours déplié");
  dom.touche($(root, "plMode").querySelector('[aria-checked="true"]'), "Home");
  assert.equal($(root, "plMode").querySelectorAll('[role="radio"]')[0].getAttribute("aria-checked"), "true", "bascule au clavier");
});

test("vue (DOM) : « Voir plus de groupes » déplié le reste quand les données changent (réécriture), focus conservé", () => {
  const { root, doc, rafraichir } = vueDom(demoS());
  const vp = () => $(root, "plGroupes").querySelector("[data-ui-voirplus]");
  assert.match(vp().textContent, /^Voir plus de groupes \(\d\)$/);
  vp().focus(); vp().click();
  assert.equal(vp().getAttribute("aria-expanded"), "true");
  const avant = $(root, "plGroupes").innerHTML;
  const S2 = demoS(); S2.positions[0].qty += 1; // données des lignes changées → les groupes sont réécrits
  vp().focus();
  rafraichir.avec(S2);
  assert.notEqual($(root, "plGroupes").innerHTML, avant);
  assert.equal(vp().getAttribute("aria-expanded"), "true", "toujours déplié");
  assert.equal(doc.activeElement, vp(), "focus rendu au même bouton");
});

test("vue (DOM) : journal des mouvements dans un « Voir plus » qui reste déplié quand un mouvement arrive (identifiant stable)", () => {
  const S0 = demoS();
  S0.tx = Array.from({ length: 8 }, (_, i) => ({ id: "t" + i, date: "2026-09-0" + (i + 1), type: "achat", positionId: "pea-etf-monde", qty: 1, price: 100, amount: 100, createdAt: "x" }));
  const { root, rafraichir } = vueDom(S0);
  const journal = () => $(root, "plSuivi").querySelector('[data-pl-acc="journal"]');
  journal().querySelector("details").setAttribute("open", "");
  const vp = () => journal().querySelector("[data-ui-voirplus]");
  assert.match(vp().textContent, /^Voir plus de mouvements \(3\)$/);
  vp().click();
  assert.equal(vp().getAttribute("aria-expanded"), "true");
  const S1 = J(S0); S1.tx.push({ id: "t9", date: "2026-10-10", type: "vente", positionId: "pea-etf-monde", qty: 1, price: 105, amount: 105, createdAt: "y" });
  rafraichir.avec(S1);
  assert.match(journal().textContent, /Vente/, "le journal a été réécrit avec le nouveau mouvement en tête");
  assert.ok(journal().querySelector("details").hasAttribute("open"), "accordéon toujours ouvert");
  assert.equal(vp().getAttribute("aria-expanded"), "true", "toujours déplié");
  assert.equal(journal().querySelector(".ui-voirplus-reste").hidden, false);
  assert.equal(vp().textContent, "Voir moins");
  vp().click();
  rafraichir.avec(S0);
  assert.equal(vp().getAttribute("aria-expanded"), "false", "replié reste replié");
});

test("vue (DOM) : une ligne ouvre le panneau en lecture (détail, Corriger avec Claude, Demander à Claude) ; Échap rend le focus à la ligne", () => {
  const { root, doc, dom, dlg } = vueDom(demoS());
  root.querySelector('[data-pl-groupe-btn="PEA Camille"]').click();
  const l = root.querySelector('[data-pl-ligne="pea-etf-europe"]');
  l.focus(); l.click();
  assert.equal(dlg().hidden, false);
  assert.equal(dlg().querySelector(".ui-panneau-titre").textContent, "ETF Stoxx Europe 600");
  assert.match(sp(dlg().querySelector(".pl-det").textContent), /Frais courants0,07 % par an/);
  assert.equal(dlg().querySelectorAll("form, input, select, textarea").length, 0);
  const corps = dlg().querySelector(".ui-panneau-corps").innerHTML;
  assert.deepEqual(phrasesClaude(corps), [ClaudePrompts.phrase("placements", "la ligne « ETF Stoxx Europe 600 » (PEA Camille)"), ClaudePrompts.phrase("mouvement", "la ligne « ETF Stoxx Europe 600 » (PEA Camille)")]);
  assert.match(dlg().querySelector(".ui-panneau-pied").innerHTML, /Demander à Claude/);
  dom.touche(doc.activeElement, "Escape");
  assert.equal(dlg().hidden, true);
  assert.equal(doc.activeElement, l);
});

test("vue (DOM) : panneau d'une ligne rafraîchi quand le store émet, fermé proprement si la ligne disparaît (focus au titre)", () => {
  const { root, doc, dlg, rafraichir } = vueDom(demoS());
  root.querySelector('[data-pl-groupe-btn="PEA Camille"]').click();
  root.querySelector('[data-pl-ligne="pea-air-liquide"]').click();
  assert.equal(dlg().hidden, false);
  const S1 = demoS(); S1.positions.find(p => p.id === "pea-air-liquide").qty = 25;
  rafraichir.avec(S1);
  assert.equal(dlg().hidden, false, "toujours ouvert");
  assert.match(dlg().querySelector(".pl-det").textContent, /Quantité25/, "contenu mis à jour");
  const S2 = J(S1); S2.positions = S2.positions.filter(p => p.id !== "pea-air-liquide");
  rafraichir.avec(S2);
  assert.equal(dlg().hidden, true, "ligne disparue : panneau fermé");
  assert.equal(doc.activeElement, $(root, "plTitre"), "focus posé sur le titre de la page");
  // Ligne d'une autre personne quand le périmètre change.
  root.querySelector('[data-pl-groupe-btn="PEA Camille"]').click();
  root.querySelector('[data-pl-ligne="pea-etf-europe"]').click();
  assert.equal(dlg().hidden, false);
  rafraichir.avec(Object.assign(J(S2), { scope: "p2" }));
  assert.equal(dlg().hidden, true, "ligne hors du périmètre : panneau fermé");
});

/** GrapheModele / SerieNet factices : enregistrent les appels de la tête de page. */
function faux() {
  const j = { brancher: [], actualiser: 0, lectures: [], abonnes: [] };
  const GrapheModele = { brancher: (el, o) => { j.brancher.push({ el, o }); return { actualiser: snap => { j.actualiser++; j.dernier = snap; }, detruire() {} }; } };
  const SerieNet = { charger: (S, t, per, d) => { j.lectures.push({ t, per, d }); }, abonner: fn => { j.abonnes.push(fn); return () => {}; } };
  return { j, GrapheModele, SerieNet };
}

test("vue (DOM) : le graphe maître est monté une fois dans la tête (préréglage placements), actualisé à chaque émission du store, le passé lu sur « tout »", () => {
  const f = faux(), v = vueDom(demoS(), null, { GrapheModele: f.GrapheModele, SerieNet: f.SerieNet });
  assert.equal(f.j.brancher.length, 1, "monté une seule fois");
  const { el, o } = f.j.brancher[0];
  assert.equal(el, $(v.root, "plGraphe"));
  assert.equal(o.preset, "placements");
  assert.equal(o.deps.UI, v.ctx.UI, "UI passé en dépendance");
  assert.equal(o.today(), PL.jour());
  assert.equal(o.perimetre(), "du foyer");
  assert.equal(typeof o.enAttente, "function", "squelette tant que le passé est lu"); assert.equal(o.enAttente({}), false, "sans état de lecture : jamais bloqué");
  assert.equal(f.j.actualiser, 1);
  assert.deepEqual(J(f.j.lectures[0].per), { id: "tout" });
  assert.equal(f.j.abonnes.length, 1, "abonnement à la fin de la lecture du passé");
  v.rafraichir();
  assert.equal(f.j.brancher.length, 1, "pas de second montage");
  assert.equal(f.j.actualiser, 2, "actualiser appelé à chaque émission (il ne recalcule que si l'entrée a changé)");
  v.rafraichir.avec(demoS({ scope: "p2" }));
  assert.equal(f.j.brancher.length, 1);
  assert.equal(f.j.dernier.scope, "p2");
  // La fin d'une lecture du passé relance le graphe.
  const n = f.j.actualiser; f.j.abonnes[0]();
  assert.equal(f.j.actualiser, n + 1);
  // Plus de sélecteur de période, aucune écriture du réglage de période.
  assert.equal(v.root.querySelector(".ui-periode"), null);
  assert.equal(v.store.has("pilotage-evo"), false);
});

test("vue (DOM) : pas de graphe sans placement ni pendant le chargement ; la page ne casse pas sans le composant", () => {
  const f = faux();
  const vide = vueDom(demoS({ positions: [], tx: [] }), null, { GrapheModele: f.GrapheModele, SerieNet: f.SerieNet });
  assert.equal($(vide.root, "plGrapheBloc").hidden, true);
  assert.equal(f.j.brancher.length, 0);
  const g = faux(), c = vueDom(demoS({ ready: false, positions: [] }), null, { GrapheModele: g.GrapheModele, SerieNet: g.SerieNet });
  assert.equal($(c.root, "plGrapheBloc").hidden, true);
  assert.equal(g.j.brancher.length, 0);
  const sans = vueDom(demoS()); // ni GrapheModele ni SerieNet
  assert.equal(sp($(sans.root, "plTotal").textContent).includes("€"), true);
  assert.equal($(sans.root, "plGraphe").children.length, 0);
});

test("vue (DOM) : la variation sous le total se lit sur 1 an, sans sélecteur", () => {
  const S = demoS({ snapshots: SNAPS, positions: [POS("a", { qty: 1000, price: 120 })] });
  const { root } = vueDom(S);
  assert.equal($(root, "plTotal").textContent.replace(/\s/g, " "), "120 000 €".replace(/\s/g, " "));
  assert.match(sp($(root, "plSous").textContent), /\+20\s?000 € · \+20 % sur 1 an · 1 ligne$/);
  assert.match($(root, "plSous").innerHTML, /En hausse/);
  assert.doesNotMatch($(root, "plSous").textContent, /1 mois|3 mois|depuis le début/);
});

test("vue (DOM) : l'accordéon ouvert le reste après une mise à jour du store ; ordres et hypothèses en lecture", () => {
  const S0 = demoS();
  const { root, rafraichir } = vueDom(S0);
  const acc = $(root, "plSuivi").querySelector('[data-pl-acc="ordres"]').querySelector("details");
  acc.setAttribute("open", "");
  assert.equal($(root, "plSuivi").querySelectorAll('input[type="checkbox"]').length, 0);
  const S1 = demoS(); S1.config.todo[1].done = true;
  rafraichir.avec(S1);
  const acc2 = $(root, "plSuivi").querySelector('[data-pl-acc="ordres"]');
  assert.ok(acc2.querySelector("details").hasAttribute("open"), "toujours ouvert");
  assert.ok(acc2.querySelectorAll(".pl-chip.bon").some(c => c.textContent === "passé"));
  assert.match($(root, "plSuivi").querySelector('[data-pl-acc="hyp"]').textContent, /Confirmer avec Claude/);
});

test("vue (DOM) : état vide orienté (Compléter avec Claude), chargement, périmètre d'une personne", () => {
  const v = vueDom(demoS({ positions: [], tx: [] }));
  assert.equal($(v.root, "plVide").hidden, false);
  assert.match($(v.root, "plVideClaude").innerHTML, />Compléter avec Claude</);
  assert.match($(v.root, "plVide").textContent, /Dis à Claude ce que tu détiens/);
  assert.equal($(v.root, "plGroupesBloc").hidden, true);
  assert.equal($(v.root, "plSuivi").hidden, true);
  assert.equal(v.api.headline(), "–");
  const c = vueDom(demoS({ ready: false, positions: [] }));
  assert.equal($(c.root, "plChargement").hidden, false);
  assert.equal($(c.root, "plVide").hidden, true);
  const p = vueDom(demoS({ scope: "p2" }));
  assert.equal($(p.root, "plTitre").textContent, "Placements de Sam");
  assert.ok(p.root.querySelectorAll("[data-pl-ligne]").every(b => DEMO.positions.find(x => x.id === b.getAttribute("data-pl-ligne")).owner === "p2"));
});

/* ------------------------------------------------ CP1 : fiches de Patrimoine › Comptes ------------------------------------------------ */

test("fiches : groupe « Par enveloppe » → « Ouvrir la fiche du compte » ; panneau d'une ligne → « Voir la fiche de la ligne » (liens, clavier et lecteur d'écran)", () => {
  assert.equal(PL.lienFiche({ ligne: "a b" }), "patrimoine/comptes?ligne=a%20b");
  const S = demoS();
  const gs = PL.grouper(S.positions, "enveloppe", S, DEPS);
  const h = PL.groupesHtml(gs, "enveloppe", S, UI, { today: TODAY, deps: DEPS });
  assert.match(h, /<p class="pl-g-fiche"><a href="#patrimoine\/comptes\?enveloppe=PEA%20Camille&amp;titulaire=p1" data-goto="patrimoine\/comptes\?enveloppe=PEA%20Camille&amp;titulaire=p1">Ouvrir la fiche du compte<span class="ui-sr"> PEA Camille<\/span><\/a><\/p>/);
  assert.doesNotMatch(PL.groupesHtml(PL.grouper(S.positions, "poche", S, DEPS), "poche", S, UI, { today: TODAY, deps: DEPS }), /pl-g-fiche/, "pas de fiche pour une poche");
  const mixte = [POS("a", { envelope: "PEA " + XSS, owner: "p1" }), POS("b", { envelope: "PEA " + XSS, owner: "p2" })];
  const hm = PL.groupesHtml(PL.grouper(mixte, "enveloppe", { scope: "foyer" }, DEPS), "enveloppe", { scope: "foyer" }, UI, { today: TODAY, deps: DEPS });
  assert.match(hm, /href="#patrimoine\/comptes\?enveloppe=PEA%20%3Cimg[^"&]*"/, "deux titulaires : sans titulaire ; nom encodé");
  assert.doesNotMatch(hm, /<img/);
  // panneau d'une ligne (vue montée)
  const { root, dlg } = vueDom(demoS());
  root.querySelector('[data-pl-groupe-btn="PEA Camille"]').click();
  assert.ok(root.querySelectorAll("a[data-goto]").some(x => x.getAttribute("data-goto") === "patrimoine/comptes?enveloppe=PEA%20Camille&titulaire=p1" && x.closest(".pl-g-fiche")), "lien du groupe déplié");
  root.querySelector('[data-pl-ligne="pea-etf-europe"]').click();
  const a = dlg().querySelector(".ui-panneau-lien");
  assert.ok(a, "lien en pied du panneau");
  assert.equal(a.getAttribute("href"), "#patrimoine/comptes?ligne=pea-etf-europe");
  assert.match(a.textContent, /Voir la fiche de la ligne/);
});
