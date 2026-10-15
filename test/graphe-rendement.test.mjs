// Graphe maître × rendement (graphe-patrimoine.js, graphe-modele.js) : puce « Rendement attendu ≈ 4,8 %/an » dans l'en-tête de la carte (net de frais, après inflation ou non selon l'euro choisi),
// lignes de lecture « Rendement annualisé (médiane) » et « 8 chances sur 10 » à une date projetée, « Rendement réel depuis cette date » et ce que le modèle en attendait à une date passée,
// définitions dans « Comment c'est calculé » (pondéré par l'argent, par le temps, net de frais, euros d'aujourd'hui), assemblage des données par le modèle. Données fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { G, donnees, monter, AUJ, plusMois } from "./helpers/graphe-donnees.mjs";
import { cas, entreeDe } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const R = req("../web/src/rendement.js"), GM = req("../web/src/graphe-modele.js"), P = req("../web/src/projection.js"), Calc = req("../web/src/calc.js");

const sp = s => String(s).replace(/[\u00a0\u202f]/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const ms = G.msDe, iso = t => new Date(t).toISOString().slice(0, 10);
const D = o => donnees(Object.assign({ rendement: true }, o || {}));
const M0 = o => G.normaliser(D(o));
const lignes = (M, t) => G.lectureLignes(M, G.lecture(M, null, t, { demi: 1 }));
const ligne = (rows, cle) => rows.find(r => r.cle === cle);
const f1 = x => (x < 0 ? "−" : "") + Math.abs(x).toFixed(1).replace(".", ",");
const Z = 1.2815516, MU = Math.log(1.069), LNI = Math.log(1.02), SIG = 0.15;
/* rendement annualisé, loi de la maquette de données (médiane 6,9 % nominal, volatilité 15 %, inflation 2 %) */
const ann = (q, ans, reel) => (Math.exp((MU - (reel ? LNI : 0)) + q * Z * SIG / Math.sqrt(ans)) - 1) * 100;
const fenetre = (w, h) => ({ innerWidth: w, innerHeight: h, matchMedia: q => ({ matches: /hover: hover|pointer: fine/.test(q), addEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { hash: "" } });

/* ================================================================== lecture à une date projetée */
test("lecture projetée (5 ans, euros d'aujourd'hui) : « Rendement annualisé (médiane) 4,8 %/an » et « Rendement, 8 chances sur 10 : −3,8 à +14,2 % » — le rendement après inflation", () => {
  const M = M0(), rows = lignes(M, ms(plusMois(AUJ, 60)));
  const r = ligne(rows, "rend"), r80 = ligne(rows, "rend80");
  assert.equal(sp(r.label), "Rendement annualisé (médiane)"); assert.equal(sp(r.valeur), f1(ann(0, 5, true)) + " %/an");
  assert.equal(sp(r.valeur), "4,8 %/an");
  assert.equal(sp(r80.label), "Rendement, 8 chances sur 10"); assert.equal(sp(r80.valeur), f1(ann(-1, 5, true)) + " à +" + f1(ann(1, 5, true)) + " %");
  assert.equal(sp(r80.valeur), "−3,8 à +14,2 %");
  const cles = rows.map(x => x.cle);
  assert.ok(cles.indexOf("rend") > cles.indexOf("p50") && cles.indexOf("rend80") === cles.indexOf("rend") + 1, "après les montants : " + cles.join(","));
});
test("lecture projetée en euros courants : le rendement nominal (6,9 %/an), pas celui après inflation", () => {
  const d = D(); d.euros = "courants";
  const M = G.normaliser(d), rows = lignes(M, ms(plusMois(AUJ, 120)));
  assert.equal(sp(ligne(rows, "rend").valeur), "6,9 %/an"); assert.equal(sp(ligne(rows, "rend80").valeur), f1(ann(-1, 10, false)) + " à " + f1(ann(1, 10, false)) + " %", "les deux bornes positives : sans signe");
});
test("lecture projetée dans la première année : pas de taux annuel (« sur 6 mois »), le rendement de la période avec son signe", () => {
  const M = M0(), rows = lignes(M, ms(plusMois(AUJ, 6)));
  const r = ligne(rows, "rend"), r80 = ligne(rows, "rend80"), cum = q => (Math.exp((MU - LNI) * 0.5 + q * Z * SIG * Math.sqrt(0.5)) - 1) * 100;
  assert.equal(sp(r.label), "Rendement médian sur 6 mois"); assert.equal(sp(r.valeur), "+" + f1(cum(0)) + " %");
  assert.equal(sp(r80.valeur), f1(cum(-1)) + " à +" + f1(cum(1)) + " %");
  assert.doesNotMatch(sp(r.valeur), /\/an/);
});
test("lecture projetée : une fourchette dont les deux bornes sont positives s'écrit sans signe (1,2 à 8,1 %)", () => {
  const d = D(); d.rendement.projet.annualise.reel.p10 = d.rendement.projet.annualise.reel.p10.map(v => (v == null ? v : 1.2)); d.rendement.projet.annualise.reel.p90 = d.rendement.projet.annualise.reel.p90.map(v => (v == null ? v : 8.1));
  const M = G.normaliser(d), r80 = ligne(lignes(M, ms(plusMois(AUJ, 36))), "rend80");
  assert.equal(sp(r80.valeur), "1,2 à 8,1 %");
});
test("sans rendement dans les données, ou à aujourd'hui : aucune ligne de rendement, et les lignes existantes sont inchangées", () => {
  const sans = G.normaliser(donnees());
  assert.deepEqual(lignes(sans, ms(plusMois(AUJ, 36))).map(r => r.cle), ["p90", "p75", "p50", "sv", "effet"]);
  const M = M0(); assert.ok(!lignes(M, ms(AUJ)).some(r => /^rend/.test(r.cle)));
  const indispo = G.normaliser(D({ rendement: { indisponible: true } }));
  assert.ok(!lignes(indispo, ms(plusMois(AUJ, 36))).some(r => /^rend/.test(r.cle)), "aucun placement : pas de ligne, jamais 0 %");
});

/* ================================================================== lecture à une date passée : réel contre attendu */
test("lecture passée (il y a 3 mois, observé) : rendement réel depuis cette date, ce que le modèle en attendait (plan figé), fourchette et verdict", () => {
  const M = M0(), t = ms(plusMois(AUJ, -3)), rows = lignes(M, t);
  const d = R.depuis(M.brut.rendement.reel.donnees, iso(t), AUJ, { hypotheses: M.brut.rendement.reel.hypotheses });
  assert.equal(d.statut, "ok");
  const reel = ligne(rows, "rend_reel"), att = ligne(rows, "rend_att"), f = ligne(rows, "rend_att80"), v = ligne(rows, "rend_verdict");
  assert.match(sp(reel.label), /^Rendement réel sur \d+ mois$/); assert.equal(sp(reel.valeur), "+" + f1(d.reel.valeur_pct) + " %");
  assert.equal(sp(att.label), "Rendement attendu"); assert.equal(sp(att.valeur), "+" + f1(d.attendu.attendu_pct) + " %");
  assert.equal(sp(f.label), "Fourchette 8 chances sur 10"); assert.match(sp(f.valeur), /^−?\d+(,\d)? à \+\d+(,\d)? %$/);
  assert.equal(sp(v.label), "Réel et attendu"); assert.equal(sp(v.valeur), "dans la fourchette");
  assert.equal(d.source.type, "plan_fige", "un plan figé existait à cette date : ses hypothèses servent");
});
test("lecture passée de plus d'un an : annualisée (« /an »), attendu des hypothèses d'aujourd'hui (aucun plan à l'époque), approximation dite dans la phrase de la feuille", () => {
  const M = M0(), t = ms(plusMois(AUJ, -14)), l = G.lecture(M, null, t, { demi: 1 });
  assert.equal(l.nature, "reconstitue", "avant les relevés de la maquette : estimé, donc aucune ligne");
  const dd = D(); dd.passe.points.forEach(p => { p.nature = "observe"; });
  const M2 = G.normaliser(dd), rows = lignes(M2, t);
  assert.match(sp(ligne(rows, "rend_reel").valeur), /^\d+,\d %\/an$/); assert.equal(sp(ligne(rows, "rend_reel").label), "Rendement réel depuis cette date");
  assert.match(sp(ligne(rows, "rend_att").valeur), /^\d+,\d %\/an$/);
  const html = sp(G.lectureHtml(M2, null, G.lecture(M2, null, t, { demi: 1 }), { def: false }));
  assert.match(html, /Réel \+?\d+,\d %\/an contre \d+,\d % attendu \(fourchette 8 sur 10 : /); assert.match(html, /hypothèses d'aujourd'hui appliquées à ton allocation du .* \(approximation\)/i);
});
test("lecture passée : un point estimé (reconstitué), moins d'un mois de recul, ou aujourd'hui — aucune ligne de rendement réel", () => {
  const M = M0();
  assert.ok(!lignes(M, M.passe.t[0]).some(r => /^rend/.test(r.cle)), "reconstitué");
  assert.ok(!lignes(M, ms(plusMois(AUJ, 0)) - 10 * 864e5).some(r => /^rend/.test(r.cle)), "10 jours");
  assert.ok(!lignes(M, ms(AUJ)).some(r => /^rend/.test(r.cle)), "aujourd'hui");
});
test("lecture passée : versements inconnus — le réel est dit « approché », jamais présenté comme exact", () => {
  const M = G.normaliser(D({ rendement: { versementsInconnus: true } })), rows = lignes(M, ms(plusMois(AUJ, -3)));
  assert.match(sp(ligne(rows, "rend_reel").valeur), /approché/);
});
test("lecture compacte du plein écran : les lignes de rendement et la source de l'attendu sont écrites ; jamais de couleur de jugement sur le verdict", () => {
  const M = M0(), t = ms(plusMois(AUJ, -3)), l = G.lecture(M, null, t, { demi: 1 });
  const html = sp(G.lectureKvHtml(M, null, l, { def: false }));
  assert.match(html, /Rendement réel sur \d+ mois/); assert.match(html, /Fourchette 8 chances sur 10/); assert.match(html, /dans la fourchette/);
  assert.match(html, /data-rend-source[^>]*>[^<]*(plan figé du|hypothèses d'aujourd'hui)/);
  assert.doesNotMatch(html, /gp-kv (neg|pos)"><span>Réel et attendu/);
  const proj = sp(G.lectureKvHtml(M, null, G.lecture(M, null, ms(plusMois(AUJ, 60)), { demi: 1 }), { def: false }));
  assert.match(proj, /Rendement annualisé \(médiane\)[\s\S]*4,8 %\/an/);
});

/* ================================================================== puce de l'en-tête */
test("puce : « Rendement attendu ≈ 4,8 %/an » en euros d'aujourd'hui (après inflation), « ≈ 6,9 %/an » en euros courants ; la bulle dit net de frais, avant impôts, nominal et réel", () => {
  const c = G.rendementChip(M0());
  assert.equal(sp(c.texte), "Rendement attendu ≈ 4,8 %/an");
  assert.match(sp(c.titre), /Net de frais, avant impôts/); assert.match(sp(c.titre), /4,8 %\/an après inflation/); assert.match(sp(c.titre), /6,9 %\/an avant inflation/);
  const d = D(); d.euros = "courants";
  const n = G.rendementChip(G.normaliser(d));
  assert.equal(sp(n.texte), "Rendement attendu ≈ 6,9 %/an"); assert.match(sp(n.titre), /6,9 %\/an avant inflation/); assert.match(sp(n.titre), /4,8 %\/an après inflation/);
});
test("puce : absente en mode capacité d'emprunt, sans rendement, sans placement (indisponible) ou sans projection", () => {
  assert.equal(G.rendementChip(G.normaliser(donnees())), null);
  assert.equal(G.rendementChip(G.normaliser(D({ rendement: { indisponible: true } }))), null);
  assert.equal(G.rendementChip(G.normaliser(D({ rendement: { sansProjet: true } }))), null);
  assert.equal(G.rendementChip(G.normaliser(Object.assign(D(), { mode: "capacite" }))), null);
});
test("carte : la puce est un bouton dans l'en-tête, avec info-bulle et libellé accessible complets ; elle ouvre la feuille « Rendement attendu » (définitions, périodes, réel contre attendu)", () => {
  const t = monter({ donnees: D() }), b = t.q("[data-rendement]");
  assert.ok(b, "puce montée"); assert.equal(b.hidden, false); assert.equal(b.getAttribute("type"), "button");
  assert.equal(sp(b.textContent).replace(/\s+/g, " ").trim(), "Rendement attendu ≈ 4,8 %/an");
  assert.match(sp(b.getAttribute("title")), /Net de frais, avant impôts/); assert.match(sp(b.getAttribute("aria-label")), /Rendement attendu/);
  assert.equal(b.getAttribute("aria-haspopup"), "dialog");
  assert.ok(b.closest(".gp-tete"), "dans l'en-tête de la carte");
  b.click();
  assert.equal(t.UI.st.titre, "Rendement attendu");
  const h = sp(t.UI.st.corps.innerHTML);
  for (const mot of ["Ton rendement", "Rendement de tes placements", "pondéré par l'argent", "pondéré par le temps", "net de frais", "avant impôts", "comptes courants", "euros d'aujourd'hui", "1 mois", "3 mois", "1 an", "Depuis le début", "attendu"]) assert.ok(h.includes(mot), "feuille : " + mot);
  assert.match(h, /Réel \+?\d+,\d %\/an contre/);
});
test("carte : puce masquée sans rendement et en mode capacité ; elle suit l'euro choisi à la mise à jour des données", () => {
  const t = monter({ donnees: donnees() });
  assert.ok(t.q("[data-rendement]")); assert.equal(t.q("[data-rendement]").hidden, true);
  t.api.mettreAJour(D()); assert.equal(t.q("[data-rendement]").hidden, false);
  const c = D(); c.euros = "courants"; t.api.mettreAJour(c);
  assert.equal(sp(t.q("[data-rendement]").textContent).trim().replace(/\s+/g, " "), "Rendement attendu ≈ 6,9 %/an");
  const capa = monter({ donnees: Object.assign(D(), { mode: "capacite" }) }); assert.equal(capa.q("[data-rendement]").hidden, true);
});
test("carte : à la lecture d'une date, la table écrit les lignes de rendement sous les montants ; en plein écran, le panneau de lecture aussi", () => {
  const c = monter({ donnees: D() });
  c.api.curseur(ms(plusMois(AUJ, 36)));
  const lt = sp(c.q("[data-lt]").textContent);
  assert.match(lt, /Effet de ton épargne future[+−]\d+ k€Rendement annualisé \(médiane\)\d+,\d %\/anRendement, 8 chances sur 10−?\d+,\d à \+\d+,\d %/);
  const p = monter({ donnees: D(), window: fenetre(1440, 900) }); p.api.pleinEcran();
  const bu = p.doc.body.querySelector(".gp-fsv-bureau");
  bu.querySelector("[data-hit]").dispatchEvent(new p.Ev("pointermove", { clientX: 420, pointerId: 3, pointerType: "mouse" }));
  assert.match(sp(bu.querySelector("[data-ro]").textContent), /Rendement annualisé \(médiane\)/);
});

/* ================================================================== « Comment c'est calculé » */
test("« Comment c'est calculé » : la section « Rendements » définit ton rendement (pondéré par l'argent), celui de tes placements (pondéré par le temps), net de frais, avant impôts, euros d'aujourd'hui, attendu et médiane", () => {
  const h = sp(G.calculHtml(M0(), {}));
  assert.match(h, /<h3 class="gp-sec-t">Rendements<\/h3>/);
  for (const mot of ["Ton rendement", "pondéré par l'argent", "Rendement de tes placements", "pondéré par le temps", "net de frais", "avant impôts", "comptes courants", "euros d'aujourd'hui", "Rendement attendu", "médiane",
    "Annualisé à partir d'un an", "valeurs de marché"]) assert.ok(h.includes(mot), mot);
  assert.match(h, /<table class="gp-rd-tab"[\s\S]*1 mois[\s\S]*3 mois[\s\S]*1 an[\s\S]*Depuis le début/);
  assert.doesNotMatch(sp(G.calculHtml(M0({ rendement: false }), {})), /Rendements/, "sans données de rendement, pas de section");
});
test("« Comment c'est calculé » : un historique trop court est dit (« pas assez d'historique »), jamais un chiffre ; versements inconnus : « approché »", () => {
  const court = sp(G.calculHtml(G.normaliser(D({ rendement: { courts: 20 } })), {}));
  assert.match(court, /pas assez d'historique/);
  const inc = sp(G.calculHtml(G.normaliser(D({ rendement: { versementsInconnus: true } })), {}));
  assert.match(inc, /versements inconnus : rendement approché/i);
});
test("« Comment c'est calculé » : sans projection mesurable (aucun placement), la section le dit et ne donne aucun taux inventé", () => {
  const h = sp(G.calculHtml(G.normaliser(D({ rendement: { indisponible: true } })), {}));
  assert.match(h, /Rendements/); assert.match(h, /Aucun placement à mesurer/);
});

/* ================================================================== le modèle assemble les données */
function etat(opts) {
  const o = opts || {}, d = entreeDe(cas("C-4")), snaps = [], tx = [], jours = o.jours == null ? 400 : o.jours;
  /* relevés quotidiens : chaque poche gagne 0,02 % par jour ; la valeur du foyer est la somme des poches (comptes courants compris, que le module retire) */
  const poches = { p1: {}, p2: {} };
  d.positions.filter(p => Calc.counted(p)).forEach(p => { if (poches[p.owner]) poches[p.owner][p.bloc] = (poches[p.owner][p.bloc] || 0) + Calc.val(p); });
  const tot = k => Object.values(poches[k]).reduce((a, v) => a + v, 0);
  for (let k = jours; k >= 1; k--) {
    const f = Math.pow(1.0002, -k), date = iso(Date.UTC(2026, 9, 14) - k * 864e5), by = { p1: {}, p2: {} };
    ["p1", "p2"].forEach(w => Object.keys(poches[w]).forEach(b => { by[w][b] = poches[w][b] * f; }));
    snaps.push({ date, foyer: (tot("p1") + tot("p2")) * f, p1: tot("p1") * f, p2: tot("p2") * f, byBloc: by });
  }
  if (!o.sansTx) tx.push({ id: "t0", date: "2025-01-02", type: "versement", positionId: d.positions[0].id, amount: 100 });
  return { today: "2026-10-14", scope: "foyer", positions: d.positions, config: d.config, profil: d.profil, budget: d.budget, banque: d.banque, objectifs: d.objectifs, foyer: d.foyer, savoir: { reperes: d.reperes },
    indices: [], classes: {}, snapshots: snaps, plansFiges: o.plans || [], tx };
}
const sync = (chemins) => (data, options, rappel) => { const M = P.preparer(data, options); const r = P.simuler(M, { chemins }); rappel && rappel(r, { etape: "complet", chemins: r.chemins }); return Promise.resolve(r); };

test("modèle : rendementDonnees assemble la projection (annualisé mois par mois, attendu) et le réel (périodes, relevés, hypothèses) ; un seul moteur", async () => {
  const S = etat(), d = await GM.calculer(S, GM.reglagesParDefaut({ vue: "financier" }), { today: "2026-10-14", executer: sync(200), reconstitue: null });
  assert.equal(d.etat, "pret"); assert.ok(d.rendement, "bloc rendement présent");
  const pj = d.rendement.projet, res = P.simuler(P.preparer(P.depuisEtat(S, "2026-10-14"), GM.optionsMoteur(GM.reglagesParDefaut({ vue: "financier" }), S)), { chemins: 200 }).rendement;
  assert.equal(pj.disponible, true); assert.equal(pj.attendu.nominal_pct, res.attendu.nominal_pct); assert.equal(pj.annualise.reel.p50.length, 301, "un point par mois, comme le futur");
  assert.deepEqual(pj.annualise.reel.p50, res.annualise.reel.p50); assert.deepEqual(pj.cumule.nominal.p90, res.cumule.nominal.p90);
  assert.deepEqual(d.rendement.reel.periodes.map(p => p.id), ["1m", "3m", "1a", "debut"]);
  const un = d.rendement.reel.periodes.find(p => p.id === "1a");
  assert.equal(un.statut, "ok"); assert.equal(un.jours, 365); assert.ok(un.twr_annuel_pct > 6 && un.twr_annuel_pct < 9, "0,02 % par jour ≈ 7,6 %/an : " + un.twr_annuel_pct);
  assert.ok(un.attendu && un.attendu.statut === "ok" && un.comparaison && un.comparaison.phrase, "réel contre attendu sur la période");
  assert.equal(un.source.type, "hypotheses_actuelles", "aucun plan figé : hypothèses d'aujourd'hui, approximation dite");
  assert.equal(d.rendement.reel.donnees.versementsConnus, true);
  assert.equal(d.rendement.reel.hypotheses.courantes.classes.actions.rendement, pj ? res.classes.actions.rendement : 0);
});
test("modèle : sans aucune transaction suivie, les versements sont inconnus et le réel est approché ; sans relevé, périodes « pas assez d'historique »", async () => {
  const S = etat({ sansTx: true }), d = await GM.calculer(S, GM.reglagesParDefaut({ vue: "financier" }), { today: "2026-10-14", executer: sync(100), reconstitue: null });
  d.rendement.reel.periodes.forEach(p => assert.equal(p.statut, "approche", p.id));
  const court = await GM.calculer(etat({ jours: 12 }), GM.reglagesParDefaut({ vue: "financier" }), { today: "2026-10-14", executer: sync(100), reconstitue: null });
  court.rendement.reel.periodes.forEach(p => assert.equal(p.statut, "insuffisant", p.id));
});
test("modèle : un plan figé antérieur à la période fournit ses hypothèses (chargées à la demande, au plus quatre), et le plan est dit", async () => {
  const plans = [{ id: "plan-1", cree_le: "2026-01-01T20:00:00.000Z", raison: "revue_mensuelle", horizon_mois: 120 }], appels = [];
  const detail = { id: "plan-1", cree_le: "2026-01-01T20:00:00.000Z", serie: { mois: ["2026-01-01"], p50: [1], p10: [1], p90: [1] }, parametres: { rendement: { classes: { actions: { rendement: 3, volatilite: 15 } } }, allocation: { classes: [] } } };
  const S = etat({ plans });
  const d = await GM.calculer(S, GM.reglagesParDefaut({ vue: "financier" }), { today: "2026-10-14", executer: sync(100), reconstitue: null, chargerPlan: id => { appels.push(id); return Promise.resolve(detail); } });
  const trois = d.rendement.reel.periodes.find(p => p.id === "3m");
  assert.equal(trois.source.type, "plan_fige"); assert.equal(trois.source.id, "plan-1"); assert.match(sp(trois.source.texte), /plan figé du 1er janv\. 2026/);
  assert.ok(appels.length >= 1 && appels.length <= 4);
  /* anciens plans (sans bloc rendement) : les hypothèses de classe de allocation.classes servent */
  const ancien = { ...detail, parametres: { allocation: { classes: [{ classe: "actions", rendement_central: 4, volatilite: 15 }] } } };
  const d2 = await GM.calculer(etat({ plans }), GM.reglagesParDefaut({ vue: "financier" }), { today: "2026-10-14", executer: sync(100), reconstitue: null, chargerPlan: () => Promise.resolve(ancien) });
  assert.equal(d2.rendement.reel.hypotheses.plans[0].classes.actions.rendement, 4);
});

/* ================================================================== texte */
test("lexique : jamais de conseil dans les textes du rendement (graphe-patrimoine.js, graphe-modele.js, rendement.js)", () => {
  for (const f of ["web/src/graphe-patrimoine.js", "web/src/graphe-modele.js", "web/src/rendement.js"]) {
    const s = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
    assert.doesNotMatch(s, /conseill(?:er|ers|ère|ères|ez)(?![\p{L}])|conseil(?:s)? financier|il faut investir|tu devrais/giu, f);
  }
});
