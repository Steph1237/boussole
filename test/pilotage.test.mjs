// Patrimoine › Placements (web/src/pilotage.*) : en-tête (total, variation sur la période, courbe), regroupements
// (enveloppe, poche, titulaire, disponibilité), panneau d'une ligne (détail, mouvement, « Modifier à la main »),
// accordéons de suivi (allocation, ordres, versements, hypothèses, journal des mouvements).
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
const DEMO = require("../web/src/demo-data.js");

const DEPS = { Calc, Periodes };
const TODAY = "2026-10-11";
const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[  ]/g, " ");
const demoS = o => Object.assign(J(DEMO), { ready: true, dbOk: true, scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], error: null }, o);
const POS = (id, o) => Object.assign({ id, name: "Ligne " + id, envelope: "PEA", owner: "p1", bloc: "Monde", mode: "market", isin: null, qty: 10, pru: 100, price: 110,
  priceDate: "2026-10-10", value: null, valueDate: null, status: "actif", hypothesis: null, qtyEstimated: false, note: null }, o);
const XSS = '<img src=x onerror="alert(1)">';
const sansCommentaires = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

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
  for (const id of ["plTotal", "plSous", "plPeriode", "plCourbe", "plMode", "plGroupes", "plSuivi", "plVide", "plChargement", "plMouvement"]) assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.match(html, /data-pl-ajouter/);
  assert.match(html, /Enregistrer un mouvement/);
  assert.match(html, /Ajouter à la main/);
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
});

test("pilotage.js : écritures par Store.db (positions, transactions, import, config todo / recurring / hypotheses), jamais les règles", () => {
  assert.match(js, /\.doc\("positions\/" \+ p\.id\)\.update\(r\.upd\)/);
  assert.match(js, /\.doc\("positions\/" \+ r\.id\)\.set\(r\.doc\)/);
  assert.match(js, /\.collection\("transactions"\)\.add\(/);
  assert.match(js, /window\.Store\.db\.collection\("positions"\)\.addMany\(rows\)/);
  assert.match(js, /Import\.open\(\{ people:/);
  for (const k of ["todo", "recurring", "hypotheses"]) assert.match(js, new RegExp('doc\\("config/main"\\)\\.update\\(\\{ ' + k));
  assert.doesNotMatch(js, /config\/main"\)\.update\(\{ ?(rules|cushion)/);
});

test("pilotage.js : courbe filtrée par période et granularité (UI.periode + Periodes), choix mémorisés", () => {
  assert.match(js, /u\.periode\(\$\("plPeriode"\)/);
  assert.match(js, /Pe\.agreger\(pts, b, g, x => x\.v\)/);
  assert.match(js, /Pe\.resume\(ag, pts, b, x => x\.v\)/);
  assert.match(js, /Pe\.bornes\(/);
  assert.match(js, /Pe\.auto\(b\)/);
  assert.match(js, /EVO_KEY = "pilotage-evo"/);
  assert.match(js, /localStorage\.setItem\(EVO_KEY/);
  assert.match(js, /localStorage\.setItem\(CLE_MODE/);
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

/* ------------------------------------------------------------------ évolution ------------------------------------------------------------------ */
const SNAPS = [{ date: "2025-09-30", foyer: 100000, p1: 60000, p2: 40000 }, { date: "2026-03-31", foyer: 110000, p1: 66000, p2: 44000 },
  { date: "2026-09-30", foyer: 118000, p1: 70000, p2: 48000, source: "relevés" }];

test("evolution : photos + valeur en direct en dernier point, agrégées sur la période ; variation depuis la dernière valeur avant la période", () => {
  const S = { scope: "foyer", positions: [POS("a", { qty: 1000, price: 120 })], snapshots: SNAPS };
  const ev = PL.evolution(S, TODAY, { periode: "1a", granularite: "mois" }, DEPS);
  assert.equal(ev.granularite, "mois");
  assert.equal(ev.serie[ev.serie.length - 1].live, true);
  assert.equal(ev.serie[ev.serie.length - 1].valeur, 120000);
  assert.ok(ev.serie.slice(0, -1).every(p => !p.live));
  assert.equal(ev.resume.variation, 120000 - 100000, "début = dernière photo avant la période");
  assert.equal(ev.historique, true);
  assert.equal(ev.reconstitue, true);
  const p2 = PL.evolution(Object.assign({}, S, { scope: "p2" }), TODAY, { periode: "tout" }, DEPS);
  assert.deepEqual(p2.serie.filter(p => !p.live).map(p => p.valeur), [40000, 44000, 48000]);
  assert.equal(p2.serie[p2.serie.length - 1].valeur, 0, "aucune ligne de Sam dans S.positions");
});

test("evolution : période personnalisée, période inconnue → 1 an, granularité automatique, sans photo, sans Periodes", () => {
  const S = { scope: "foyer", positions: [POS("a", { qty: 1000, price: 120 })], snapshots: SNAPS };
  const perso = PL.evolution(S, TODAY, { periode: "perso", du: "2026-01-01", au: "2026-06-30" }, DEPS);
  assert.deepEqual(perso.bornes, { du: "2026-01-01", au: "2026-06-30" });
  assert.equal(perso.serie.length, 1);
  assert.deepEqual(PL.evolution(S, TODAY, { periode: "6m" }, DEPS).bornes, Periodes.bornes("1a", TODAY));
  assert.equal(PL.evolution(S, TODAY, { periode: "1a" }, DEPS).granularite, Periodes.auto(Periodes.bornes("1a", TODAY)));
  const vide = PL.evolution({ scope: "foyer", positions: [], snapshots: [] }, TODAY, { periode: "1a" }, DEPS);
  assert.equal(vide.historique, false);
  assert.equal(vide.serie.length, 1);
  const brut = PL.evolution(S, TODAY, {}, { Calc, Periodes: null });
  assert.equal(brut.resume, null);
  assert.equal(brut.serie.length, 4);
});

test("courbeSvg : état vide orienté, SVG accessible et échappé, tiret pour la valeur en direct", () => {
  assert.match(PL.courbeSvg({ serie: [], historique: false }), /Pas encore d'historique/);
  assert.match(PL.courbeSvg({ serie: [{ date: TODAY, valeur: 1, label: "x" }], historique: true }), /élargissez la période/);
  const ev = { serie: [{ date: "2026-08-01", valeur: 1000, label: XSS }, { date: "2026-09-01", valeur: 1100, label: "sept." }, { date: TODAY, valeur: 1200, label: "oct.", live: true }],
    resume: { variation: 200 }, historique: true };
  const svg = PL.courbeSvg(ev, { largeur: 600, scopeLabel: "du foyer" });
  assert.match(svg, /^<svg class="pl-svg"[^>]*role="img"[^>]*aria-label="Évolution des placements du foyer/);
  assert.match(svg, /class="pl-direct"/);
  assert.doesNotMatch(svg, /<img/);
  assert.match(svg, /\(en direct\)/);
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

test("detailLigne : cours et date, quantité, PRU, plus-value latente, poids, frais / zone / devise avec source, statut", () => {
  const S = demoS();
  const p = S.positions.find(x => x.id === "pea-etf-europe");
  const d = PL.detailLigne(p, S, TODAY, DEPS);
  const F = Object.fromEntries(d.faits);
  assert.equal(d.titre, "ETF Stoxx Europe 600");
  assert.equal(d.meta, "PEA Camille · Europe · Camille");
  assert.match(sp(F["Cours"]), /^248,30 € · 10 oct\. 2026$/);
  assert.equal(F["Quantité"], "36");
  assert.equal(sp(F["Prix de revient unitaire (PRU)"]), "215,10 €");
  assert.match(sp(F["Plus-value latente"]), /^\+1 1\d\d € \(\+15,4 %\)$/);
  assert.equal(sp(F["Frais courants"]), "0,07 % par an");
  assert.equal(F["Zone"], "Europe");
  assert.match(d.source, /frais courants 0,07 %, relevé le 2 oct\. 2026$/);
  const total = Calc.financier(S.positions, "foyer");
  assert.ok(Math.abs(d.poids - Calc.val(p) / total * 100) < 1e-9);
  assert.equal(F["Statut"], "Actif");
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

test("detailHtml : tout est échappé ; actions Mouvement et « Modifier à la main », zone de formulaire, message", () => {
  const p = POS("x", { name: XSS, envelope: XSS, note: XSS, hypothesis: XSS, annoteSource: XSS });
  const h = PL.detailHtml(PL.detailLigne(p, { scope: "foyer", positions: [p] }, TODAY, DEPS), { message: XSS });
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /data-pl-act="mouvement"/);
  assert.match(h, /data-pl-act="modifier"[^>]*aria-expanded="false"/);
  assert.match(h, /data-pl-zone/);
  assert.match(h, /data-pl-msg role="status"/);
});

/* ------------------------------------------------------------------ mouvements ------------------------------------------------------------------ */
test("mouvement : achat coté (PRU moyen, cours daté), vente (quantité, clôture à zéro), refus au-delà de la quantité", () => {
  const p = POS("a", { qty: 10, pru: 100, price: 110, priceDate: "2026-10-01" });
  const a = PL.mouvement(p, { type: "achat", qty: "10", price: "130", date: "2026-10-05", note: " DCA " }, TODAY);
  assert.deepEqual(a.upd, { qty: 20, pru: 115, price: 130, priceDate: "2026-10-05" });
  assert.deepEqual(a.tx, { date: "2026-10-05", type: "achat", positionId: "a", qty: 10, price: 130, amount: 1300, note: "DCA", source: "manuel" });
  assert.equal(PL.mouvement(p, { type: "achat", amt: "1300", price: "130" }, TODAY).upd.qty, 20, "montant ÷ prix");
  assert.equal(PL.mouvement(p, { type: "achat", qty: "1", price: "1", date: "2026-09-01" }, TODAY).upd.price, undefined, "un cours plus ancien n'écrase pas le cours");
  assert.deepEqual(PL.mouvement(p, { type: "vente", qty: "10", price: "120" }, TODAY).upd.status, "clôturé");
  assert.equal(PL.mouvement(p, { type: "vente", qty: "11", price: "120" }, TODAY).erreur, "Quantité vendue supérieure à la quantité détenue.");
  assert.equal(PL.mouvement(p, { type: "achat", qty: "1" }, TODAY).erreur, "Indiquez la quantité et le prix unitaire.");
});

test("mouvement : versement / retrait (parts au dernier cours, valeur manuelle), nouveau solde, erreurs", () => {
  const c = POS("c", { qty: 10, pru: 100, price: 100 });
  const v = PL.mouvement(c, { type: "versement", amt: "500" }, TODAY);
  assert.equal(v.upd.qty, 15);
  assert.equal(v.upd.pru, 100);
  assert.equal(v.tx.price, 100);
  assert.equal(PL.mouvement(c, { type: "retrait", amt: "2000" }, TODAY).erreur, "Retrait supérieur à la position.");
  assert.equal(PL.mouvement(POS("z", { price: null }), { type: "versement", amt: "10" }, TODAY).erreur, "Indiquez le prix unitaire pour convertir le montant en parts.");
  const m = POS("m", { mode: "manual", value: 1000, qty: null, price: null });
  assert.deepEqual(PL.mouvement(m, { type: "retrait", amt: "250", date: "2026-10-02" }, TODAY).upd, { value: 750, valueDate: "2026-10-02" });
  assert.deepEqual(PL.mouvement(m, { type: "achat", qty: "2", price: "50" }, TODAY).upd.value, 1100);
  assert.equal(PL.mouvement(m, { type: "achat" }, TODAY).erreur, "Indiquez un montant pour une ligne à valeur manuelle.");
  assert.deepEqual(PL.mouvement(m, { type: "solde", amt: "1234,5" }, TODAY).upd, { value: 1234.5, valueDate: TODAY });
  assert.deepEqual(PL.mouvement(c, { type: "solde", qty: "12" }, TODAY).upd, { qty: 12, qtyEstimated: false });
  assert.equal(PL.mouvement(c, { type: "solde" }, TODAY).erreur, "Indiquez la nouvelle quantité.");
  assert.equal(PL.mouvement(null, { type: "achat" }, TODAY).erreur, "Choisissez une ligne.");
  assert.equal(PL.mouvement(c, { type: "?" }, TODAY).erreur, "Choisissez le type de mouvement.");
});

test("champsMouvement : champs utiles selon le type et le mode de la ligne", () => {
  assert.deepEqual(PL.champsMouvement("achat", "market"), ["qty", "price", "amt"]);
  assert.deepEqual(PL.champsMouvement("vente", "manual"), ["amt"]);
  assert.deepEqual(PL.champsMouvement("versement", "market"), ["amt", "price"]);
  assert.deepEqual(PL.champsMouvement("retrait", "manual"), ["amt"]);
  assert.deepEqual(PL.champsMouvement("solde", "market"), ["qty", "price"]);
  assert.deepEqual(PL.champsMouvement("solde", "manual"), ["amt"]);
  assert.deepEqual(PL.champsMouvement("?", "market"), []);
  assert.deepEqual(PL.TYPES_MVT.map(t => t.id), ["achat", "vente", "versement", "retrait", "solde"]);
});

/* ------------------------------------------------------------------ lignes ------------------------------------------------------------------ */
test("nouvelleLigne : identifiant lisible, ligne cotée ou manuelle, transaction de création, validations", () => {
  const r = PL.nouvelleLigne({ name: "Amundi PEA Japon", envelope: "PEA Camille", owner: "p1", bloc: "Asie", isin: " fr0013411980 ", mode: "market", qty: "4", price: "25" }, TODAY);
  assert.equal(r.id, "pea-camill-amundi-pea-japon");
  assert.equal(r.doc.isin, "FR0013411980");
  assert.equal(r.doc.priceDate, TODAY);
  assert.equal(r.doc.value, null);
  assert.equal(r.tx.amount, 100);
  assert.equal(r.tx.type, "creation");
  const m = PL.nouvelleLigne({ name: "Livret", envelope: "Livrets", bloc: "Épargne", mode: "manual", value: "3000", owner: "p2" }, TODAY);
  assert.equal(m.doc.owner, "p2");
  assert.equal(m.doc.qty, null);
  assert.equal(m.doc.valueDate, TODAY);
  assert.equal(PL.nouvelleLigne({ envelope: "x", bloc: "y" }, TODAY).erreur, "Indiquez le nom de la ligne.");
  assert.equal(PL.nouvelleLigne({ name: "a", bloc: "y" }, TODAY).erreur, "Indiquez l'enveloppe (compte ou contrat).");
  assert.equal(PL.nouvelleLigne({ name: "a", envelope: "x" }, TODAY).erreur, "Indiquez la poche.");
  assert.match(PL.nouvelleLigne({ name: "a", envelope: "x", bloc: "y", qty: "-1" }, TODAY).erreur, /négatifs/);
});

test("modificationLigne : seuls les champs changés ; quantité → qtyEstimated faux ; valeur → valueDate du jour ; validations", () => {
  const p = POS("a", { qtyEstimated: true });
  const base = { name: p.name, envelope: p.envelope, bloc: p.bloc, owner: p.owner, mode: p.mode, status: p.status, isin: "", qty: "10", pru: "100", note: "" };
  assert.deepEqual(PL.modificationLigne(p, base, TODAY).upd, {});
  assert.deepEqual(PL.modificationLigne(p, Object.assign({}, base, { qty: "12", note: " à surveiller ", status: "à recevoir" }), TODAY).upd,
    { status: "à recevoir", note: "à surveiller", qty: 12, qtyEstimated: false });
  assert.deepEqual(PL.modificationLigne(p, Object.assign({}, base, { mode: "manual", value: "900" }), TODAY).upd, { mode: "manual", value: 900, valueDate: TODAY });
  assert.deepEqual(PL.modificationLigne(p, Object.assign({}, base, { isin: "ie00b4l5y983", owner: "p2" }), TODAY).upd, { owner: "p2", isin: "IE00B4L5Y983" });
  assert.equal(PL.modificationLigne(p, Object.assign({}, base, { name: " " }), TODAY).erreur, "Indiquez le nom de la ligne.");
  assert.equal(PL.modificationLigne(p, Object.assign({}, base, { qty: "" }), TODAY).erreur, "Indiquez la quantité détenue.");
  assert.equal(PL.modificationLigne(p, Object.assign({}, base, { mode: "manual" }), TODAY).erreur, "Indiquez la valeur de la ligne.");
  assert.match(PL.modificationLigne(p, Object.assign({}, base, { pru: "-3" }), TODAY).erreur, /négatifs/);
  assert.equal(PL.modificationLigne(null, base, TODAY).erreur, "Ligne introuvable.");
  assert.deepEqual(PL.STATUTS.map(s => s.id), ["actif", "à recevoir", "clôturé"]);
});

test("formulaires : échappés, champs du mouvement et de la ligne, suggestions d'enveloppes et de poches", () => {
  const S = demoS();
  S.positions[0].name = XSS; S.positions[0].envelope = XSS;
  const fm = PL.formMouvementHtml(S, S.positions[1].id, TODAY);
  assert.doesNotMatch(fm, /<img/);
  for (const f of ["ligne", "qty", "price", "amt", "date", "note"]) assert.match(fm, new RegExp('data-pl-f="' + f + '"'), f);
  assert.match(fm, new RegExp('value="' + S.positions[1].id + '" selected'));
  assert.match(fm, /data-pl-type/);
  const fe = PL.formLigneHtml(S.positions[0], S);
  assert.doesNotMatch(fe, /<img/);
  assert.match(fe, /data-pl-form="modifier"/);
  assert.match(fe, /data-pl-statut/);
  assert.match(fe, /data-pl-owner/, "deux personnes : bascule du titulaire");
  assert.match(fe, /data-pl-f="pru"/);
  const fn = PL.formLigneHtml(null, Object.assign({}, S, { people: [{ id: "p1", nom: "Camille" }] }));
  assert.match(fn, /data-pl-form="nouvelle"/);
  assert.doesNotMatch(fn, /data-pl-owner|data-pl-statut/);
  assert.match(fn, /<datalist id="plNEnv">.*<option value="Assurance vie Sam"><\/option><option value="Banque">/);
  assert.match(fn, /<datalist id="plNBloc"><option value="Convictions">/);
});

/* ------------------------------------------------------------------ suivi ------------------------------------------------------------------ */
test("hypotheses, versements, journalMouvements : contenu et ordre (démo)", () => {
  const S = demoS();
  S.positions[2].hypothesis = "Quantité lue sur un relevé ancien";
  S.config.recurring[1].hypothesis = "Montant à vérifier";
  const H = PL.hypotheses(S);
  const attendues = S.positions.filter(p => p.hypothesis).map(p => "pos:" + p.id).concat(["rec:1", "cfg:0"]);
  assert.deepEqual(H.map(h => h.kind + ":" + h.id), attendues);
  assert.match(H.find(h => h.kind === "rec").text, /^Épargne Livret A : Montant à vérifier$/);
  S.config.recurring[1].hypothesis = null;
  const vs = PL.versements(S, TODAY);
  assert.deepEqual(vs.map(v => [v.label, v.enveloppe, v.etat, v.montant]), [["Versement PEA Camille", "PEA Camille", "actif", 300], ["Épargne Livret A", vs[1].enveloppe, "actif", 200]]);
  assert.equal(PL.versements(S, "2026-01-01")[0].etat, "prevu");
  const jm = PL.journalMouvements({ positions: [POS("a")], tx: [{ date: "2026-09-01", type: "achat", positionId: "a", qty: 2, price: 10 }, { date: "2026-10-01", type: "programme", positionId: "zz", amount: 300, source: "agent" }] });
  assert.deepEqual(jm.map(x => [x.type, x.ligne, x.agent]), [["Versement programmé", "zz", true], ["Achat", "Ligne a", false]]);
  assert.equal(PL.journalMouvements({ tx: Array.from({ length: 80 }, (_, i) => ({ date: "2026-01-01", type: "achat", positionId: "a", createdAt: String(i) })) }).length, 50);
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

test("rendus du suivi : échappés, cases d'ordres, boutons Confirmer, 5 mouvements puis « Voir plus », états vides", () => {
  const S = { scope: "foyer", positions: [POS("a", { name: XSS, hypothesis: XSS })], config: { todo: [{ text: XSS, amount: XSS, done: true }], recurring: [], hypotheses: [] },
    tx: Array.from({ length: 7 }, (_, i) => ({ date: "2026-10-0" + (i + 1), type: "achat", positionId: "a", qty: 1, price: 10, note: XSS })) };
  const o = PL.ordresHtml(S), h = PL.hypothesesHtml(S), j = PL.journalHtml(S, UI), v = PL.versementsHtml(S, TODAY), al = PL.allocationHtml(S, DEPS);
  for (const x of [o, h, j, v, al]) assert.doesNotMatch(x, /<img/);
  assert.match(o, /<input type="checkbox" data-pl-todo="0" checked>/);
  assert.match(o, /class="pl-fait"/);
  assert.match(h, /data-pl-hyp="pos:a"/);
  assert.match(j, /Voir plus de mouvements \(2\)/);
  assert.match(v, /Aucun versement programmé/);
  assert.match(al, /href="#pilotage\/risque"/);
  assert.match(PL.ordresHtml({ config: {} }), /Aucun ordre en attente/);
  assert.match(PL.hypothesesHtml({ config: {}, positions: [] }), /Toutes les hypothèses sont confirmées/);
  assert.match(PL.journalHtml({ tx: [] }, UI), /Aucun mouvement enregistré/);
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
  assert.match(sp(h), /6 lignes · 85,7 %/);
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
const attendre = () => new Promise(r => setTimeout(r, 0));
/** Monte Placements (calc, periodes, ui, pilotage) dans le mini-DOM, avec un Store.db en mémoire qui journalise les écritures. */
function vueDom(S0) {
  const dom = miniDom(), { doc } = dom;
  let S = J(S0);
  const ecrits = [], modules = {};
  const ctx = { document: doc, console, setTimeout, clearTimeout, Intl, Date, Math, JSON };
  ctx.window = ctx; ctx.self = ctx;
  ctx.App = { register: (n, api) => { modules[n] = api; } };
  const db = {
    doc: path => ({
      update: async patch => { ecrits.push(["update", path, J(patch)]); const [col, id] = path.split("/"); S = J(S);
        if (col === "positions") Object.assign(S.positions.find(p => p.id === id), patch); else Object.assign(S.config, patch); },
      set: async d => { ecrits.push(["set", path, J(d)]); S = J(S); S.positions.push(J(d)); },
    }),
    collection: name => ({ add: async d => { ecrits.push(["add", name, J(d)]); S = J(S); S.tx.unshift(J(d)); }, addMany: async rows => { ecrits.push(["addMany", name, rows]); } }),
  };
  ctx.Store = { get: () => S, db };
  vm.createContext(ctx);
  for (const f of ["calc.js", "periodes.js"]) vm.runInContext(readFileSync("web/src/" + f, "utf8"), ctx, { filename: f });
  vm.runInContext(uiJs, ctx, { filename: "ui.js" });
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
  return { ctx, dom, doc, root, api, ecrits, rafraichir, dlg, S: () => S };
}
const $ = (root, id) => root.querySelector("#" + id);

test("vue (DOM) : en-tête (total, lignes), bascule de regroupement à 4 options, groupes repliés, suivi en accordéons fermés", () => {
  const { root, api } = vueDom(demoS());
  const total = Calc.financier(DEMO.positions, "foyer");
  assert.equal(sp($(root, "plTotal").textContent), sp(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(total)) + " €"));
  assert.equal(api.headline(), $(root, "plTotal").textContent);
  assert.match($(root, "plTitre").textContent, /^Placements du foyer$/);
  assert.match($(root, "plSous").textContent, /\d+ lignes/);
  const radios = $(root, "plMode").querySelectorAll('[role="radio"]');
  assert.deepEqual(radios.map(r => r.textContent), ["Par enveloppe", "Par poche", "Par titulaire", "Par disponibilité"]);
  assert.ok(root.querySelectorAll("[data-pl-groupe-btn]").length >= 6);
  assert.ok(root.querySelectorAll("[data-pl-groupe-btn]").every(b => b.getAttribute("aria-expanded") === "false"));
  assert.ok(root.querySelectorAll(".pl-g-corps").every(c => c.hidden));
  const accs = $(root, "plSuivi").querySelectorAll("[data-pl-acc]").map(x => x.getAttribute("data-pl-acc"));
  assert.deepEqual(accs, ["alloc", "ordres", "versements", "hyp", "journal"]);
  assert.ok($(root, "plSuivi").querySelectorAll("details").every(d => !d.hasAttribute("open")));
  assert.equal($(root, "plVide").hidden, true);
  assert.equal($(root, "plChargement").hidden, true);
  assert.match($(root, "plClaude").innerHTML, /claude\.ai\/new\?q=/);
});

test("vue (DOM) : bascule « Par disponibilité » puis dépliage d'un groupe ; l'état déplié survit à une mise à jour du store", () => {
  const { root, dom, rafraichir } = vueDom(demoS());
  const radio = $(root, "plMode").querySelectorAll('[role="radio"]')[3];
  radio.click();
  assert.equal(radio.getAttribute("aria-checked"), "true");
  assert.match($(root, "plModeNote").textContent, /Délai pour récupérer l'argent/);
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

test("vue (DOM) : « Voir plus de groupes » déplié le reste quand les données changent (réécriture), focus conservé", async () => {
  const { root, doc, ecrits, rafraichir } = vueDom(demoS());
  const vp = () => $(root, "plGroupes").querySelector("[data-ui-voirplus]");
  assert.match(vp().textContent, /^Voir plus de groupes \(\d\)$/);
  vp().focus(); vp().click();
  assert.equal(vp().getAttribute("aria-expanded"), "true");
  const avant = $(root, "plGroupes").innerHTML;
  $(root, "plSuivi").querySelector('[data-pl-hyp="cfg:0"]').click(); // écrit config/main ; la démo change (signature des groupes inchangée)
  await attendre();
  assert.equal(ecrits.length, 1);
  const S2 = demoS(); S2.positions[0].qty += 1; // données des lignes changées → les groupes sont réécrits
  vp().focus();
  rafraichir.avec(S2);
  assert.notEqual($(root, "plGroupes").innerHTML, avant);
  assert.equal(vp().getAttribute("aria-expanded"), "true", "toujours déplié");
  assert.equal(doc.activeElement, vp(), "focus rendu au même bouton");
});

test("vue (DOM) : une ligne ouvre le panneau (détail, Demander à Claude) ; Échap rend le focus à la ligne", () => {
  const { root, doc, dom, dlg } = vueDom(demoS());
  root.querySelector('[data-pl-groupe-btn="PEA Camille"]').click();
  const l = root.querySelector('[data-pl-ligne="pea-etf-europe"]');
  l.focus(); l.click();
  assert.equal(dlg().hidden, false);
  assert.equal(dlg().querySelector(".ui-panneau-titre").textContent, "ETF Stoxx Europe 600");
  assert.match(sp(dlg().querySelector(".pl-det").textContent), /Frais courants0,07 % par an/);
  assert.match(dlg().querySelector(".ui-panneau-pied").innerHTML, /Demander à Claude/);
  dom.touche(doc.activeElement, "Escape");
  assert.equal(dlg().hidden, true);
  assert.equal(doc.activeElement, l);
});

test("vue (DOM) : « Modifier à la main » dans le panneau → patch de la ligne écrit par Store.db, message de confirmation", async () => {
  const { root, dlg, ecrits } = vueDom(demoS());
  root.querySelector('[data-pl-groupe-btn="PEA Camille"]').click();
  root.querySelector('[data-pl-ligne="pea-air-liquide"]').click();
  dlg().querySelector('[data-pl-act="modifier"]').click();
  const form = dlg().querySelector('[data-pl-form="modifier"]');
  assert.ok(form, "formulaire de la ligne dans le panneau");
  assert.equal(dlg().querySelector('[data-pl-f="name"]').value, "Air Liquide");
  dlg().querySelector('[data-pl-f="qty"]').value = "25";
  dlg().querySelector('[data-pl-f="note"]').value = "Renforcé en octobre";
  dlg().querySelector('[data-pl-statut]').querySelectorAll('[role="radio"]')[0].click();
  form.dispatchEvent(new (miniDom().Ev)("submit"));
  await attendre(); await attendre();
  assert.deepEqual(ecrits, [["update", "positions/pea-air-liquide", { note: "Renforcé en octobre", qty: 25, qtyEstimated: false }]]);
  assert.match(dlg().querySelector("[data-pl-msg]").textContent, /Modifications enregistrées/);
  assert.match(dlg().querySelector(".pl-det").textContent, /Quantité25/);
});

test("vue (DOM) : « Modifier à la main » refuse une saisie invalide sans rien écrire", async () => {
  const { root, dlg, ecrits } = vueDom(demoS());
  root.querySelector('[data-pl-groupe-btn="PEA Camille"]').click();
  root.querySelector('[data-pl-ligne="pea-air-liquide"]').click();
  dlg().querySelector('[data-pl-act="modifier"]').click();
  dlg().querySelector('[data-pl-f="name"]').value = "";
  dlg().querySelector('[data-pl-form="modifier"]').dispatchEvent(new (miniDom().Ev)("submit"));
  await attendre();
  assert.deepEqual(ecrits, []);
  assert.equal(dlg().querySelector('[data-pl-form="modifier"]').querySelector("[data-pl-msg]").textContent, "Indiquez le nom de la ligne.");
});

test("vue (DOM) : « Enregistrer un mouvement » (en-tête puis depuis une ligne) → position mise à jour et transaction ajoutée", async () => {
  const { root, dlg, ecrits, ctx } = vueDom(demoS());
  $(root, "plMouvement").click();
  assert.equal(dlg().querySelector(".ui-panneau-titre").textContent, "Enregistrer un mouvement");
  const sel = dlg().querySelector('[data-pl-f="ligne"]');
  sel.value = "pea-etf-monde";
  sel.dispatchEvent(new (miniDom().Ev)("change"));
  assert.equal(dlg().querySelector('[data-pl-champ="amt"]').hidden, false);
  dlg().querySelector('[data-pl-f="qty"]').value = "10";
  dlg().querySelector('[data-pl-f="price"]').value = "100";
  dlg().querySelector('[data-pl-f="date"]').value = "2026-10-11";
  dlg().querySelector('[data-pl-form="mouvement"]').dispatchEvent(new (miniDom().Ev)("submit"));
  await attendre(); await attendre();
  const p = DEMO.positions.find(x => x.id === "pea-etf-monde");
  assert.equal(ecrits[0][0], "update");
  assert.equal(ecrits[0][1], "positions/pea-etf-monde");
  assert.equal(ecrits[0][2].qty, p.qty + 10);
  assert.equal(ecrits[1][0], "add");
  assert.equal(ecrits[1][1], "transactions");
  assert.equal(ecrits[1][2].type, "achat");
  assert.equal(ecrits[1][2].amount, 1000);
  assert.ok(ecrits[1][2].createdAt);
  assert.match(dlg().querySelector("[data-pl-msg]").textContent, /Mouvement enregistré/);
  assert.equal(dlg().querySelector('[data-pl-f="qty"]').value, "", "champs vidés");
  // Depuis le panneau d'une ligne manuelle : type « Nouveau solde », seul le montant est proposé.
  ctx.UI.panneau.fermer();
  root.querySelector('[data-pl-groupe-btn="Livrets Camille"]').click();
  root.querySelector("[data-pl-groupe=\"Livrets Camille\"]").querySelector("[data-pl-ligne]").click();
  dlg().querySelector('[data-pl-act="mouvement"]').click();
  dlg().querySelector("[data-pl-type]").querySelectorAll('[role="radio"]')[4].click();
  assert.equal(dlg().querySelector('[data-pl-champ="qty"]').hidden, true);
  assert.equal(dlg().querySelector('[data-pl-champ="amt"]').querySelector("span").textContent, "Nouveau solde (€)");
});

test("vue (DOM) : « Ajouter à la main » → nouvelle ligne (set + transaction de création)", async () => {
  const { root, dlg, ecrits } = vueDom(demoS());
  root.querySelector("[data-pl-ajouter]").click();
  assert.equal(dlg().querySelector(".ui-panneau-titre").textContent, "Ajouter à la main");
  const f = k => dlg().querySelector('[data-pl-f="' + k + '"]');
  f("name").value = "ETF Japon"; f("envelope").value = "PEA Camille"; f("bloc").value = "Asie"; f("qty").value = "3"; f("price").value = "20";
  dlg().querySelector('[data-pl-form="nouvelle"]').dispatchEvent(new (miniDom().Ev)("submit"));
  await attendre(); await attendre();
  assert.equal(ecrits[0][0], "set");
  assert.equal(ecrits[0][1], "positions/pea-camill-etf-japon");
  assert.equal(ecrits[0][2].owner, "p1");
  assert.equal(ecrits[1][2].type, "creation");
  assert.match(dlg().querySelector("[data-pl-msg]").textContent, /Ligne « ETF Japon » créée/);
});

test("vue (DOM) : ordres cochés et hypothèses confirmées écrivent config/main ; l'accordéon ouvert le reste après mise à jour", async () => {
  const S0 = demoS();
  const { root, ecrits, rafraichir, ctx } = vueDom(S0);
  const acc = $(root, "plSuivi").querySelector('[data-pl-acc="ordres"]').querySelector("details");
  acc.setAttribute("open", "");
  const cb = $(root, "plSuivi").querySelector('[data-pl-todo="1"]');
  cb.checked = true;
  cb.dispatchEvent(new (miniDom().Ev)("change"));
  await attendre();
  assert.equal(ecrits[0][1], "config/main");
  assert.deepEqual(ecrits[0][2].todo.map(o => o.done), [false, true]);
  rafraichir();
  assert.ok($(root, "plSuivi").querySelector('[data-pl-acc="ordres"]').querySelector("details").hasAttribute("open"), "toujours ouvert");
  $(root, "plSuivi").querySelector('[data-pl-hyp="cfg:0"]').click();
  await attendre();
  assert.deepEqual(ecrits[1], ["update", "config/main", { hypotheses: [Object.assign({}, S0.config.hypotheses[0], { done: true })] }]);
});

test("vue (DOM) : état vide orienté (Claude + Ajouter à la main), chargement, périmètre d'une personne", () => {
  const v = vueDom(demoS({ positions: [], tx: [] }));
  assert.equal($(v.root, "plVide").hidden, false);
  assert.match($(v.root, "plVideClaude").innerHTML, /Lancez votre bilan avec Claude/);
  assert.equal($(v.root, "plGroupesBloc").hidden, true);
  assert.equal($(v.root, "plSuivi").hidden, true);
  assert.equal($(v.root, "plMouvement").hidden, true);
  assert.equal(v.api.headline(), "–");
  const c = vueDom(demoS({ ready: false, positions: [] }));
  assert.equal($(c.root, "plChargement").hidden, false);
  assert.equal($(c.root, "plVide").hidden, true);
  const p = vueDom(demoS({ scope: "p2" }));
  assert.equal($(p.root, "plTitre").textContent, "Placements de Sam");
  assert.ok(p.root.querySelectorAll("[data-pl-ligne]").every(b => DEMO.positions.find(x => x.id === b.getAttribute("data-pl-ligne")).owner === "p2"));
});
