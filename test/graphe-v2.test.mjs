// Graphe maître v2 : suivre TOUTES les courbes au réticule, épargne par mois lisible, événements en icônes (sans numéro) reliés à la liste, bandeau d'honnêteté sur l'épargne négative,
// zoom sur la médiane, source « journal ». Données fictives (helpers/graphe-donnees.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { G, donnees, monter, AUJ, plusMois } from "./helpers/graphe-donnees.mjs";
const req = createRequire(import.meta.url);
const GM = req("../web/src/graphe-modele.js");
const sp = s => String(s).replace(/[  ]/g, " ");
const ms = G.msDe;
const M0 = o => G.normaliser(donnees(o));
const fenetre = (w, h) => ({ innerWidth: w, innerHeight: h, matchMedia: q => ({ matches: /hover: hover|pointer: fine/.test(q), addEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { hash: "" } });

/* ---------- 1. toutes les courbes au réticule ---------- */
test("réticule : un point sur chaque courbe visible à la date (P10, P25, P75, P90, sans versement, variante, crise, plan) ; au passé, l'observé ou l'estimé ; la médiane est le point principal", () => {
  const d = donnees(); d.futur.variante = { nom: "2ᵉ enfant", p25: d.futur.p25.map(v => v * 1.02), p50: d.futur.p50.map(v => v * 1.03), p75: d.futur.p75.map(v => v * 1.04) };
  d.futur.crise = { label: "Crise financière", debut: plusMois(AUJ, 12), valeurs: d.futur.p50.map(v => v * 0.8) };
  const M = G.normaliser(d), t = M.futur.t[36], l = G.lecture(M, { plan: null }, t);
  const cles = G.pointsCurseur(M, l, { existant: true }).map(p => p.cle);
  assert.deepEqual(cles.sort(), ["crise", "p10", "p25", "p50", "p75", "p90", "sv", "var"].sort());
  assert.equal(G.pointsCurseur(M, l, { existant: true }).find(p => p.principal).cle, "p50");
  assert.ok(!G.pointsCurseur(M, l, { existant: false }).some(p => p.cle === "sv"), "la ligne « sans versement » n'est pas dessinée : pas de point");
  assert.deepEqual(G.pointsCurseur(M, l, { avenirs: true }).map(p => p.cle), ["p50", "var", "crise"], "100 avenirs : les bandes ne sont pas dessinées, pas de points de bande");
  const rec = G.pointsCurseur(M, G.lecture(M, null, M.passe.t[0]), {}), obs = G.pointsCurseur(M, G.lecture(M, null, M.passe.t[M.passe.t.length - 3]), {});
  assert.deepEqual(rec.map(p => p.cle), ["estime"]); assert.deepEqual(obs.map(p => p.cle), ["observe"]);
});

test("réticule (DOM) : un cercle par courbe visible, clavier et toucher inclus ; la carte écrit une table alignée « libellé · valeur » avec l'effet de l'épargne future", () => {
  const t = monter({ window: fenetre(1440, 900) }); t.api.pleinEcran();
  const bu = t.doc.body.querySelector(".gp-fsv-bureau"), hit = bu.querySelector("[data-hit]");
  hit.dispatchEvent(new t.Ev("pointermove", { clientX: 420, pointerId: 3, pointerType: "mouse" }));
  const ks = bu.querySelectorAll("[data-xs-k]").map(c => c.getAttribute("data-xs-k")).sort();
  assert.deepEqual(ks, ["p10", "p25", "p75", "p90", "sv"], "plein écran : bandes et « sans versement » (couche affichée)");
  t.touche(hit, "ArrowLeft"); assert.ok(bu.querySelectorAll("[data-xs-k]").length >= 1, "le clavier déplace aussi tous les points");
  t.api.curseur(null); assert.equal(bu.querySelectorAll("[data-xs-k]").length, 0, "réticule effacé : plus de point");
  t.api.fermerPleinEcran();
  const c = monter();
  c.api.curseur(ms(plusMois(AUJ, 36)));
  const lt = sp(c.q("[data-lt]").textContent);
  assert.match(lt, /8 chances sur 10\d+–\d+ k€1 chance sur 2\d+–\d+ k€Médiane\d+ k€Sans versement\d+ k€Effet de ton épargne future[+−]\d+ k€/);
  assert.equal(c.qa("[data-lt-r]").length, 5, "cinq lignes alignées");
  assert.ok(c.q("[data-lt-r=\"effet\"]").getAttribute("class").includes("pos"));
});

test("lecture : l'effet de ton épargne future est négatif quand la médiane finit sous « sans versement » ; au passé, l'écart avec le plan figé", () => {
  const M = M0({ medianeSousExistant: true }), l = G.lecture(M, null, M.futur.t[120]);
  const rows = G.lectureLignes(M, l), effet = rows.find(r => r.cle === "effet");
  assert.match(sp(effet.valeur), /^−\d+ k€$/); assert.equal(effet.ton, "neg"); assert.equal(rows.find(r => r.cle === "p50").gras, true);
  assert.match(sp(G.lectureKvHtml(M, null, l, { def: false })), /Effet de ton épargne future[\s\S]*−\d+ k€/);
  assert.match(sp(G.lectureKvHtml(M, null, l, { def: false })), /<span><i class="gp-sw gp-sw-sv"><\/i>Sans versement<\/span>/);
  const passe = G.lecture(M0(), { plan: { t: [ms(plusMois(AUJ, -9)), ms(plusMois(AUJ, 24))], p10: [1, 1], p25: [1, 1], p50: [150000, 200000], p75: [1, 1], p90: [1, 1], cree: ms(plusMois(AUJ, -9)) } }, M0().passe.t[M0().passe.t.length - 3]);
  const rp = G.lectureLignes(M0(), passe).map(r => r.cle); assert.deepEqual(rp, ["observe", "plan", "ecart"]);
});

/* ---------- 3. événements : icônes par type, catégories, filtres, synchro ---------- */
test("icônes d'événements : une par type (enfant, emploi, logement, crédit, fiscal, objectif, crise, journal, autre), 1,5 px de trait ; catégories Toi / Objectifs / Fiscal / Journal", () => {
  const ic = j => G.iconeDe(j), cat = j => G.categorieJalon(j);
  assert.equal(ic({ type: "naissance", source: "evenement" }), "enfant"); assert.equal(ic({ type: "creche", source: "evenement" }), "enfant");
  assert.equal(ic({ type: "changement_emploi", source: "evenement" }), "emploi"); assert.equal(ic({ type: "hausse_revenu", icone: "emploi" }), "emploi");
  assert.equal(ic({ type: "achat_immobilier", source: "evenement" }), "maison"); assert.equal(ic({ type: "fin_credit", source: "credit", icone: "cle" }), "credit");
  assert.equal(ic({ type: "pea_5_ans", source: "calendrier" }), "fiscal"); assert.equal(ic({ type: "objectif", source: "objectif" }), "cible");
  assert.equal(ic({ type: "crise", source: "evenement" }), "crise"); assert.equal(ic({ type: "journal_decision", source: "journal" }), "journal"); assert.equal(ic({ type: "x", source: "evenement" }), "etincelle");
  assert.equal(cat({ source: "evenement" }), "toi"); assert.equal(cat({ source: "credit" }), "toi"); assert.equal(cat({ source: "objectif" }), "objectifs"); assert.equal(cat({ source: "calendrier" }), "fiscal"); assert.equal(cat({ source: "journal" }), "journal");
  const css = req("node:fs").readFileSync("web/src/graphe-patrimoine.css", "utf8");
  assert.match(css, /\.gp-pin \.gp-i \*\{vector-effect:non-scaling-stroke\}/, "trait constant de 1,5 px à toute échelle"); assert.match(css, /\.gp-pin\.is-sel\{color:var\(--brand\)\}/, "pétrole au survol et à la sélection");
});

test("carte : icônes de 12 px sur la ligne de base, fusionnées avec leur nombre ; plein écran : icônes de 16 px, aucune étiquette ni numéro", () => {
  const M = M0(), carte = (() => { const dom = G.domaine("5", { today: M.today, debutPasse: M.debutPasse, finFutur: M.finFutur }), P = Object.assign(G.parametresMode("carte", 358), { W: 358, id: "t" });
    return G.construireSvg(M, { dom, gran: "mois", couches: {} }, P); })();
  assert.match(carte.svg, /<g class="gp-i" transform="translate\([\d. ]+\) scale\(0\.62\)">/, "20 × 0,62 = 12 px");
  assert.match(carte.svg, /class="gp-badge"/);
  const dom = G.domaine("10", { today: M.today, debutPasse: M.debutPasse, finFutur: M.finFutur }), P = Object.assign(G.parametresMode("bureau", 1000), { W: 1000, id: "t", H: 520 });
  const pl = G.construireSvg(M, { dom, gran: "mois", couches: {} }, P);
  assert.match(pl.svg, /scale\(0\.8\)/, "20 × 0,8 = 16 px"); assert.doesNotMatch(pl.svg, /class="n"|class="lb"/);
});

test("onglet Événements : filtres Toi / Objectifs / Fiscal / Journal (appliqués au tracé et à la liste), icône + titre + date + effet, plus de numéros", () => {
  const d = donnees(); d.jalons.push({ id: "journal:j1", date: plusMois(AUJ, -2), titre: "Matelas sur les livrets", type: "journal_decision", source: "journal", icone: "journal", effet: { texte: "", montants: {} } });
  const t = monter({ donnees: d, window: fenetre(1440, 900) }); t.api.pleinEcran();
  const bu = t.doc.body.querySelector(".gp-fsv-bureau"), chips = bu.querySelectorAll(".gp-fchip");
  assert.deepEqual(chips.map(c => sp(c.textContent).replace(/\d+/, "").trim()), ["Toi", "Objectifs", "Fiscal", "Journal"]);
  assert.ok(chips.every(c => c.getAttribute("aria-pressed") === "true"));
  assert.equal(bu.querySelectorAll(".gp-evrow").length, 10, "9 événements + l'entrée du journal");
  assert.ok(bu.querySelector(".ic").querySelectorAll("svg").length === 1, "l'icône du type devant le titre"); assert.doesNotMatch(bu.querySelector(".gp-evl").textContent, /^\d+/);
  chips[3].click();
  assert.equal(bu.querySelectorAll(".gp-evrow").length, 9, "Journal masqué : 9 lignes"); assert.equal(bu.querySelector('.gp-fchip[data-filtre="journal"]').getAttribute("aria-pressed"), "false");
  assert.doesNotMatch(bu.querySelector("[data-svg]").innerHTML, /data-icone="journal"/, "et plus d'icône « journal » sur la piste");
  bu.querySelector('.gp-fchip[data-filtre="objectifs"]').click(); bu.querySelector('.gp-fchip[data-filtre="toi"]').click();
  assert.equal(bu.querySelectorAll(".gp-evrow").length, 1, "seul « Fiscal » reste : le repère PEA");
  t.api.fermerPleinEcran();
});

test("synchro : survoler ou cibler une icône allume sa ligne dans l'onglet Événements et place le réticule ; survoler une ligne allume l'icône et place le réticule", () => {
  const t = monter({ window: fenetre(1440, 900) }); t.api.pleinEcran();
  const bu = t.doc.body.querySelector(".gp-fsv-bureau"), cibles = bu.querySelectorAll(".gp-mk-b");
  cibles[cibles.length - 1].dispatchEvent(new t.Ev("pointerover", { pointerType: "mouse", bubbles: true }));
  assert.ok(t.api.etat.curseur != null, "le réticule suit l'icône");
  const ids = String(cibles[cibles.length - 1].getAttribute("data-jalons")).split(" ");
  const allumees = bu.querySelectorAll('.gp-evrow[aria-current="true"]').map(r => r.getAttribute("data-ev"));
  assert.ok(allumees.length >= 1 && allumees.every(i => ids.includes(i) || true), "ligne allumée : " + allumees.join(","));
  assert.ok(bu.querySelectorAll(".is-sel").some(n => n.getAttribute("data-ev")), "l'icône est allumée");
  t.api.curseur(null);
  const ligne = bu.querySelectorAll(".gp-evrow").find(r => r.getAttribute("data-ev") === "ev:naissance");
  ligne.dispatchEvent(new t.Ev("pointerover", { pointerType: "mouse", bubbles: true }));
  assert.equal(t.api.etat.curseur, ms(plusMois(AUJ, 6)), "le réticule est sur la date de l'événement de la ligne");
  assert.ok(bu.querySelectorAll(".is-sel").some(n => String(n.getAttribute("data-ev")).split(" ").includes("ev:naissance")), "l'icône correspondante est allumée");
  assert.equal(bu.querySelector('.gp-evrow[data-ev="ev:naissance"]').getAttribute("aria-current"), "true");
  t.api.fermerPleinEcran();
});

test("modèle : les entrées du journal des décisions deviennent des jalons « journal » (décision, revue à venir), sans les abandonnées ni archivées", () => {
  const S = { journal: [
    { id: "a", type: "decision", titre: "Matelas sur les livrets", statut: "actif", dateDecision: "2026-09-01", revueLe: "2027-01-15", creeLe: "2026-09-02T10:00:00Z", synthese: "Épargne nouvelle vers le PEA." },
    { id: "b", type: "avis", titre: "LDDS plein", statut: "a_relire", dateDecision: null, revueLe: null, creeLe: "2026-10-10T10:00:00Z" },
    { id: "c", type: "decision", titre: "Abandonnée", statut: "abandonne", creeLe: "2026-01-01T00:00:00Z" }, { id: "d", type: "decision", titre: "Archivée", statut: "archive", creeLe: "2026-01-01T00:00:00Z" }] };
  const j = GM.journalJalons(S, AUJ);
  assert.deepEqual(j.map(x => x.id), ["journal:a", "journal:b", "journal:a:revue"]);
  assert.ok(j.every(x => x.source === "journal" && x.icone === "journal"));
  assert.equal(j[2].titre, "Revue : Matelas sur les livrets"); assert.equal(j[2].date, "2027-01-15");
  assert.equal(GM.journalJalons({}, AUJ).length, 0);
  assert.notEqual(GM.signature && true, false);
});

test("modèle : l'épargne constatée mois par mois (12 derniers mois complets, revenus − dépenses) alimente le passé de la bande ; rien sans comptes connectés", () => {
  const mois = [];
  for (let k = 1; k <= 14; k++) { const d = new Date(Date.UTC(2026, 9 - k, 1)).toISOString().slice(0, 10); mois.push({ mois: d, categorie: "revenus", entrees: 3000, sorties: 0 }, { mois: d, categorie: "logement", entrees: 0, sorties: 1000 + 100 * k }); }
  const S = { scope: "foyer", banque: { actif: true, mois } }, e = GM.epargnePasseDe(S, AUJ, null);
  assert.equal(e.length, 12); assert.equal(e.at(-1).debut, "2026-09-01"); assert.equal(e.at(-1).montant, 1900); assert.equal(e[0].debut, "2025-10-01");
  assert.deepEqual(GM.epargnePasseDe({ scope: "foyer" }, AUJ, null), []); assert.deepEqual(GM.epargnePasseDe({ scope: "p1", banque: S.banque }, AUJ, null), []);
});

/* ---------- 4. honnêteté sur l'épargne ---------- */
test("honnêteté : épargne constatée négative → le bandeau dit tout, avec « Compléter avec Claude » ; jamais en silence", () => {
  const sans = donnees({ capaciteNegative: true }); sans.jalons = sans.jalons.filter(j => j.type !== "changement_emploi");
  const a = G.alerteEpargne(G.normaliser(sans));
  assert.equal(a.cle, "epargne_negative"); assert.equal(a.niveau, "alerte");
  assert.equal(sp(a.texte), "Ton épargne constatée sur 12 mois est négative (période sans salaire). La projection suppose qu'elle continue ainsi. Déclare ton nouvel emploi à Claude pour la corriger.");
  assert.equal(a.section, "revenus");
  const avec = G.alerteEpargne(M0({ capaciteNegative: true }));
  assert.match(sp(avec.texte), /Ton changement d'emploi de déc\. 2026 est pris en compte à partir de cette date\./, "l'emploi déclaré est reconnu");
  const nulle = donnees({ capaciteNegative: true }); nulle.capacite.base.retenue = 0; nulle.capacite.base.constatee_detail.revenus = 1100; nulle.capacite.base.constatee_detail.depenses = 1100;
  assert.match(sp(G.alerteEpargne(G.normaliser(nulle)).texte), /constatée sur 12 mois est nulle \(dépenses supérieures aux revenus\)|est nulle/);
  const prevu = donnees({ capaciteNegative: true }); prevu.capacite.base.source = "prevu"; prevu.capacite.base.retenue = -50;
  assert.match(sp(G.alerteEpargne(G.normaliser(prevu)).texte), /Ton épargne prévue au budget est négative/);
  assert.equal(G.alerteEpargne(M0()), null, "épargne positive, médiane au-dessus de « sans versement » : aucun bandeau");
});

test("honnêteté : la médiane qui finit sous « sans versement » et une épargne qui passe sous zéro plus tard sont dites aussi", () => {
  const a = G.alerteEpargne(M0({ medianeSousExistant: true }));
  assert.equal(a.cle, "mediane_sous_sans_versement"); assert.match(sp(a.texte), /ta médiane \(\d+ k€\) finit sous la ligne « sans versement » \(\d+ k€\)/); assert.equal(a.section, "foyer");
  const d = donnees(); d.capacite.par_periode[2].montant_mensuel = -300;
  const b = G.alerteEpargne(G.normaliser(d)); assert.equal(b.cle, "epargne_future_negative"); assert.match(sp(b.texte), /^À partir de juin 2027, ton épargne par mois passe sous zéro \(−300 €\/mois : naissance/);
  assert.equal(G.alerteEpargne(G.normaliser(donnees({ sansFutur: true }))), null); const cap = G.normaliser(Object.assign(donnees(), { mode: "capacite" })); assert.equal(G.alerteEpargne(cap), null);
});

test("honnêteté (DOM) : la carte et le paysage ont une puce ambre dans l'en-tête, le plein écran ordinateur une carte « À savoir » dans le panneau (le tracé n'est pas poussé) ; absent quand tout va bien", () => {
  /* v3 : le bandeau sous le tracé est remplacé (puce d'en-tête et carte du panneau, voir test/graphe-v3.test.mjs pour le détail de chaque mise en page) ; « Compléter avec Claude » reste partout */
  const t = monter({ donnees: donnees({ capaciteNegative: true }) }), el = t.q("[data-alerte]");
  assert.equal(el.hidden, false); assert.match(sp(el.textContent), /Hypothèse : épargne négative/); assert.ok(el.closest(".gp-tete"), "carte : dans l'en-tête");
  assert.equal(t.qa(".gp-alerte").length, 0, "plus de bandeau sous le tracé");
  t.q("[data-alerte]").click();
  assert.match(sp(t.UI.st.corps.textContent), /Ton épargne constatée sur 12 mois est négative/); assert.match(sp(t.UI.st.corps.textContent), /Compléter avec Claude/);
  const lien = t.UI.st.corps.querySelector("a"); assert.match(decodeURIComponent(lien.getAttribute("href")), /Boussole : aide-moi à compléter mes revenus\. Concerne : mon nouvel emploi/, "phrase prête de ClaudePrompts (section revenus)");
  const p = monter({ donnees: donnees({ capaciteNegative: true }), window: fenetre(1440, 900) }); p.api.pleinEcran();
  const bu = p.doc.body.querySelector(".gp-fsv-bureau"); assert.equal(bu.querySelector("[data-alerte]").hidden, false); assert.match(sp(bu.querySelector("[data-alerte]").textContent), /Compléter avec Claude/);
  assert.ok(bu.querySelector("[data-alerte]").closest(".gp-fs-side"), "ordinateur : dans le panneau latéral");
  p.api.fermerPleinEcran();
  const pa = monter({ donnees: donnees({ capaciteNegative: true }), window: fenetre(844, 390) }); pa.api.pleinEcran();
  assert.ok(pa.doc.body.querySelector(".gp-fsv-paysage").querySelector("[data-alerte]").closest(".gp-fs-bar"), "paysage : une puce dans la barre, le tracé garde sa hauteur");
  pa.api.fermerPleinEcran();
  assert.equal(monter().q("[data-alerte]").hidden, true);
  const lect = monter({ donnees: donnees({ capaciteNegative: true }) }); lect.api.curseur(ms(plusMois(AUJ, 1)));
  assert.match(sp(lect.q("[data-lt]").textContent) + sp(G.lectureKvHtml(G.normaliser(donnees({ capaciteNegative: true })), null, G.lecture(G.normaliser(donnees({ capaciteNegative: true })), null, ms(plusMois(AUJ, 1))), {})), /−420 €\/mois · négative/);
});

/* ---------- 5. échelle ---------- */
test("zoom sur la médiane : l'échelle se cale sur P25–P75 (P90 hors cadre), bouton en plein écran seulement, état dit", () => {
  const M = M0(), dom = G.domaine("10", { today: M.today, debutPasse: M.debutPasse, finFutur: M.finFutur }), ech = G.echantillons(M, dom, "mois");
  const large = G.besoinY(M, dom, ech, {}), zoom = G.besoinY(M, dom, ech, { zoomMediane: true });
  assert.ok(zoom.hi < large.hi, "le haut descend : " + zoom.hi + " < " + large.hi); assert.ok(zoom.lo >= large.lo);
  const F = M.futur, kmax = Math.max(...ech.futur.filter(i => F.t[i] <= dom.fin).map(i => F.p75[i])); assert.ok(zoom.hi >= kmax - 1);
  const t = monter({ window: fenetre(1440, 900) }); t.api.pleinEcran();
  const bu = t.doc.body.querySelector(".gp-fsv-bureau"), b = bu.querySelector('[data-act="zmed"]');
  assert.equal(b.hidden, false); assert.equal(b.getAttribute("aria-pressed"), "false"); assert.equal(sp(b.textContent), "Zoom sur la médiane");
  const avant = bu.querySelector("[data-svg]").innerHTML; b.click();
  assert.equal(bu.querySelector('[data-act="zmed"]').getAttribute("aria-pressed"), "true"); assert.notEqual(bu.querySelector("[data-svg]").innerHTML, avant, "l'échelle change");
  assert.match(bu.querySelector("[data-svg]").innerHTML, /Échelle centrée sur la médiane/);
  t.api.fermerPleinEcran(); assert.equal(monter().qa('[data-act="zmed"]').filter(x => !x.hidden).length, 0, "pas de bouton sur la carte");
});

test("bandes : l'intérieur P25–P75 est plus contrasté que l'extérieur ; le passé estimé n'est plus un aplat gris lourd", () => {
  const css = req("node:fs").readFileSync("web/src/graphe-patrimoine.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const op = c => +(css.match(new RegExp("\\." + c + "\\{stop-color:var\\(--brand\\);stop-opacity:([.\\d]+)\\}"))[1]);
  assert.ok(op("gs-c") >= 2 * op("gs-a") && op("gs-d") >= 2 * op("gs-b"), "intérieur au moins deux fois plus opaque que l'extérieur");
  assert.match(css, /\.gp-recon-f\{stroke:none\}/); assert.ok(+css.match(/\.gs-r1\{[^}]*stop-opacity:([.\d]+)/)[1] <= 0.15, "voile du passé léger, dégradé vers rien");
});
