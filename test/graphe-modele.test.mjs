// Données du graphe maître (web/src/graphe-modele.js) : passé (observé, reconstitué, euros d'aujourd'hui), recalage sur le patrimoine net affiché (biens d'usage), jalons dédoublonnés
// et durées, probabilités des objectifs, exécution progressive du moteur (500 → N chemins), couches (variante, crise, 100 avenirs, plan figé), capacité dans le temps (IMMO1),
// effet d'un événement, liaison écran ↔ composant (signature : pas de recalcul inutile). Cas de référence C-4 du moteur, données fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cas, entreeDe } from "./helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const GM = req("../web/src/graphe-modele.js"), P = req("../web/src/projection.js"), Calc = req("../web/src/calc.js");
const AUJ = "2026-10-14";

/** État du store depuis le cas C-4 du moteur : positions, profil, budget, foyer (événements), repères ; trois photos nocturnes et un plan figé. */
function etat(opts) {
  const d = entreeDe(cas("C-4")), o = opts || {};
  const fin = Calc.financier(d.positions, "foyer");
  const snaps = [{ date: "2026-07-31", foyer: fin * 0.95 }, { date: "2026-08-31", foyer: fin * 0.97 }, { date: "2026-09-30", foyer: fin * 0.99 }];
  const S = { today: AUJ, scope: "foyer", positions: d.positions, config: d.config, profil: d.profil, budget: d.budget, banque: d.banque, objectifs: d.objectifs, foyer: d.foyer, savoir: { reperes: d.reperes },
    indices: o.indices === undefined ? indices() : o.indices, classes: {}, snapshots: o.sansPhoto ? [] : snaps, plansFiges: [{ id: "plan-1", cree_le: "2026-08-14T20:00:00.000Z", raison: "revue_mensuelle", horizon_mois: 120 }], tx: [] };
  return S;
}
function indices() {
  const out = []; for (let k = 0; k < 60; k++) { const d = new Date(Date.UTC(2021, 9 + k, 1)); out.push({ serie: "ipc_insee", mois: d.toISOString().slice(0, 10), valeur: 100 * Math.pow(1.0017, k) }); } return out;
}
const sync = chemins => (data, options, rappel) => { const M = P.preparer(data, options); const r = P.simuler(M, { chemins: options.chemins || chemins || 200 }); rappel && rappel(r, { etape: "complet", chemins: r.chemins }); return Promise.resolve(r); };

test("réglages par défaut et options du moteur : horizon 25 ans (une seule exécution pour toutes les fenêtres), vue, euros, impôts, variante ; locaux", () => {
  const r = GM.reglagesParDefaut({ vue: "financier" });
  assert.equal(r.vue, "financier"); assert.equal(r.euros, "constants"); assert.equal(r.avenirs, false); assert.equal(r.net_impots, false); assert.equal(r.existant, null); assert.equal(r.plan, null);
  const o = GM.optionsMoteur(r, { scope: "p2" });
  assert.deepEqual(o, { horizon_ans: 25, perimetre: "p2", vue: "financier", euros: "constants", net_impots: false, variante: null });
  assert.equal(GM.optionsMoteur(GM.reglagesParDefaut({ euros: "courants", variante: "v" }), {}).euros, "courants");
  assert.notEqual(GM.cleCalcul(GM.reglagesParDefaut(), {}), GM.cleCalcul(GM.reglagesParDefaut({ vue: "financier" }), {}));
  assert.notEqual(GM.cleCalcul(GM.reglagesParDefaut(), {}), GM.cleCalcul(GM.reglagesParDefaut({ duree: 20 }), {}), "la durée du prêt change le calcul de capacité");
});

test("passé : photos observées + reconstitué avant la première photo ; vue financier / net ; « disponible » sans historique ; euros d'aujourd'hui avec l'indice des prix", () => {
  const S = etat();
  const rec = { points: [{ date: "2026-06-30", financier: 80000, net: 150000 }, { date: "2026-07-15", financier: 82000, net: 152000 }], debut: "2026-06-30", drapeaux: { viaTransactions: [], compositionActuelle: [], bancaires: [], constantes: { noms: [], montant: 0 }, courteHistoire: [] } };
  const net = GM.passeDe(S, AUJ, { vue: "net", euros: "courants", reconstitue: rec, indices: [] });
  assert.equal(net.points[0].nature, "reconstitue"); assert.equal(net.points.at(-1).nature, "observe"); assert.equal(net.points.at(-1).date, AUJ);
  assert.ok(net.decalage !== undefined && net.euros_constants === false);
  const fin = GM.passeDe(S, AUJ, { vue: "financier", euros: "courants", reconstitue: null });
  assert.equal(fin.points.at(-1).valeur, Calc.financier(S.positions, "foyer"), "la dernière valeur financière est celle d'aujourd'hui");
  assert.equal(fin.points.length, 4);
  const dispo = GM.passeDe(S, AUJ, { vue: "disponible", euros: "courants" });
  assert.equal(dispo.points.length, 0); assert.match(dispo.note, /pas d'historique/);
  const cst = GM.passeDe(S, AUJ, { vue: "financier", euros: "constants", reconstitue: null });
  assert.equal(cst.euros_constants, true);
  assert.equal(cst.points.at(-1).valeur, fin.points.at(-1).valeur, "aujourd'hui : facteur 1");
  assert.ok(cst.points[0].valeur > fin.points[0].valeur, "un euro d'il y a trois mois vaut un peu plus aujourd'hui : valeur relevée");
  const sans = GM.passeDe(etat({ indices: [] }), AUJ, { vue: "financier", euros: "constants", reconstitue: null });
  assert.equal(sans.euros_constants, false); assert.match(sans.note, /euros courants/, "indice absent : on le dit, jamais de facteur inventé");
  assert.equal(GM.passeDe(etat({ sansPhoto: true }), AUJ, { vue: "financier", euros: "courants", reconstitue: null }).points.length, 1, "sans photo : le seul point du jour");
});

test("recalage : le moteur compte lui-même les biens d'usage ; le décalage n'est qu'un contrôle de cohérence (au-delà de 1 €), 0 hors vue « net »", () => {
  const res = { today: AUJ, vues: { net: { p50: [100000] }, financier: { p50: [60000] } } };
  const passe = { points: [{ date: AUJ, valeur: 115000, nature: "observe" }] };
  assert.equal(GM.ajustementAutresBiens(res, passe, "net"), 15000); assert.equal(GM.ajustementAutresBiens(res, passe, "financier"), 0);
  assert.equal(GM.ajustementAutresBiens({ today: AUJ, vues: { net: { p50: [114999.6] } } }, passe, "net"), 0, "écart de moins de 1 € : aucun recalage");
  assert.equal(GM.ajustementAutresBiens(res, { points: [] }, "net"), 0); assert.equal(GM.ajustementAutresBiens(res, { points: [{ date: "2026-10-13", valeur: 1 }] }, "net"), 0, "dernier point d'un autre jour : pas de recalage");
});

test("jalons : la dernière échéance du prêt du calendrier et la fin du même crédit n'en font qu'un ; les durées (fin d'un événement, prêt immobilier) sont ajoutées", () => {
  const res = { jalons: [
    { id: "credit:auto", date: "2029-07-15", type: "fin_credit", source: "credit", titre: "Fin du prêt auto" },
    { id: "cal:pret_fin:Prêt auto:2029-05-15", date: "2029-05-15", type: "pret_fin", source: "calendrier", titre: "Prêt auto : dernière échéance" },
    { id: "cal:pea_5_ans:x:2027-02-16", date: "2027-02-16", type: "pea_5_ans", source: "calendrier", titre: "PEA : 5 ans" },
    { id: "ev:c", date: "2027-01-01", type: "creche", source: "evenement", evenement_id: "c", titre: "Crèche" },
    { id: "ev:a", date: "2029-08-15", type: "achat_immobilier", source: "evenement", evenement_id: "a", titre: "Achat" }] };
  const S = { foyer: { evenements: [{ id: "c", fin: "2030-08-31", params: {} }, { id: "a", type: "achat_immobilier", params: { pret: { duree_ans: 20 } } }] } };
  const j = GM.jalonsDe(res, S);
  assert.deepEqual(j.map(x => x.id), ["credit:auto", "cal:pea_5_ans:x:2027-02-16", "ev:c", "ev:a"]);
  assert.equal(j.find(x => x.id === "ev:c").fin, "2030-08-31"); assert.equal(j.find(x => x.id === "ev:a").fin, "2049-08-15");
  const loin = { jalons: [{ id: "credit:x", date: "2029-07-15", type: "fin_credit", source: "credit" }, { id: "cal:pret_fin:y", date: "2031-01-01", type: "pret_fin", source: "calendrier" }] };
  assert.equal(GM.jalonsDe(loin, {}).length, 2, "un autre prêt, loin de là : conservé");
});

test("objectifs : probabilité et mot du moteur, ce qui est déjà de côté (store) ; statut « hors horizon » sans verdict", () => {
  const res = { objectifs: [{ id: "o1", nom: "Matelas", cible: 20000, date: "2027-06-30", probabilite: 0.9, mot: "probable", statut: "avance" }, { id: "o2", nom: "Retraite", cible: 4e5, date: "2058-01-01", probabilite: null, mot: null, statut: "hors_horizon" }] };
  const o = GM.objectifsDe(res, { objectifs: [{ id: "o1", deja: 12000, type: "matelas" }] });
  assert.equal(o[0].deja, 12000); assert.equal(o[0].probabilite, 0.9); assert.equal(o[1].probabilite, null); assert.equal(o[1].statut, "hors_horizon"); assert.equal(o[1].deja, null);
});

test("calculer : le passé d'abord, puis le moteur ; la médiane part de la dernière valeur observée ; le même résultat pour la même entrée (graine fixe)", async () => {
  const S = etat(), etapes = [];
  const d = await GM.calculer(S, GM.reglagesParDefaut({ vue: "financier" }), { today: AUJ, executer: sync(200), reconstitue: null, rappel: (x, i) => etapes.push([x.etat, i.etape]) });
  assert.equal(d.etat, "pret"); assert.equal(d.vue, "financier"); assert.equal(d.futur.mois.length, 301, "25 ans, un point par mois (le mois 0 est aujourd'hui)");
  assert.ok(etapes.length >= 1 && etapes.at(-1)[1] === "complet");
  assert.equal(d.futur.p50[0], d.passe.points.at(-1).valeur, "continuité à « Aujourd'hui » dès les données");
  assert.ok(d.futur.p10[120] <= d.futur.p50[120] && d.futur.p50[120] <= d.futur.p90[120]);
  assert.ok(d.jalons.length >= 1 && Array.isArray(d.objectifs)); assert.ok(d.capacite && d.capacite.par_periode.length >= 1);
  assert.equal(d.version_modele, P.versionModele); assert.equal(d.graine, P.GRAINE); assert.equal(d.crises.length > 3, true); assert.ok(d.variantes.length >= 0);
  const d2 = await GM.calculer(S, GM.reglagesParDefaut({ vue: "financier" }), { today: AUJ, executer: sync(200), reconstitue: null });
  assert.deepEqual(d2.futur.p50, d.futur.p50);
  const net = await GM.calculer(S, GM.reglagesParDefaut({ vue: "net" }), { today: AUJ, executer: sync(200), reconstitue: null });
  assert.equal(net.futur.p50[0], net.passe.points.at(-1).valeur, "net : recalé sur le patrimoine net affiché");
  assert.equal(net.ajust, 0, "pas de biens d'usage : aucun écart");
  const S2 = etat(); S2.profil = JSON.parse(JSON.stringify(S2.profil)); S2.profil.autres = { p1: { usage: 15000, entreprise: 3000 } };
  const avec = await GM.calculer(S2, GM.reglagesParDefaut({ vue: "net" }), { today: AUJ, executer: sync(200), reconstitue: null });
  assert.equal(avec.ajust, 0, "le moteur compte lui-même les biens d'usage : la courbe n'est plus décalée");
  assert.ok(Math.abs(avec.futur.p50[0] - avec.passe.points.at(-1).valeur) <= 1, "elle part du patrimoine net affiché");
  assert.ok(avec.avertissements.some(a => /biens d'usage et d'entreprise/.test(a)), "dit dans les avertissements du moteur");
  assert.ok(!avec.avertissements.some(a => /Contrôle de cohérence/.test(a)));
});

test("calculer : exécution progressive réelle (Projection.executer, 500 puis N chemins) ; l'aperçu est marqué « progressif », le complet non ; couches optionnelles à la fin", async () => {
  const S = etat(), pas = [];
  const d = await GM.calculer(S, GM.reglagesParDefaut({ vue: "financier", avenirs: true, crise: { on: true, cle: "gfc_2008", debut: "2028-01-01" } }), { today: AUJ, reconstitue: null, chemins: 600, rappel: (x, i) => pas.push({ progressif: x.progressif, chemins: x.chemins, etape: i.etape, couches: !!i.couches }) });
  assert.equal(pas[0].etape, "apercu"); assert.equal(pas[0].progressif, true); assert.equal(pas[0].chemins, 500);
  assert.equal(pas.at(-1).progressif, false); assert.equal(pas.at(-1).couches, true); assert.equal(d.chemins, 600);
  assert.equal(d.futur.avenirs.length, 100); assert.equal(d.futur.avenirs[0].length, 301); assert.equal(d.futur.avenirs[0][0], d.futur.p50[0]);
  assert.ok(d.futur.crise && d.futur.crise.valeurs.length === 301 && /2007|financière/i.test(d.futur.crise.label), "crise rejouée, un seul chemin");
  assert.ok(d.futur.crise.valeurs[60] < d.futur.p50[60] * 1.2);
});

test("calculer : variante comparée à la situation actuelle (second tracé + écart attendu) ; plan figé chargé et comparé au réel ; moteur absent ou en échec : état honnête, jamais de graphique vide", async () => {
  const S = etat(), v = (S.foyer.variantes || [])[0];
  if (v) {
    const d = await GM.calculer(S, GM.reglagesParDefaut({ vue: "financier", variante: v.id }), { today: AUJ, executer: sync(200), reconstitue: null });
    assert.ok(d.futur.variante && d.futur.variante.nom === v.nom && d.futur.variante.p50.length === 301, "variante");
  }
  const mois = Array.from({ length: 121 }, (_, k) => new Date(Date.UTC(2026, 7 + k, 14)).toISOString().slice(0, 10));
  const detail = { id: "plan-1", cree_le: "2026-08-14T20:00:00.000Z", raison: "revue_mensuelle", serie: { vue: "net", euros: "courants", mois, p10: mois.map((_, k) => 90000 + k * 500), p25: mois.map((_, k) => 95000 + k * 600), p50: mois.map((_, k) => 100000 + k * 700), p75: mois.map((_, k) => 105000 + k * 800), p90: mois.map((_, k) => 110000 + k * 900) }, parametres: {} };
  const d = await GM.calculer(S, GM.reglagesParDefaut({ vue: "net", euros: "courants", plan: "plan-1" }), { today: AUJ, executer: sync(200), reconstitue: null, chargerPlan: async id => (id === "plan-1" ? detail : null) });
  assert.equal(d.plan.id, "plan-1"); assert.equal(d.plan.serie.mois.length, 121); assert.equal(d.plan.vue, "net");
  assert.ok(d.plan.comparaison && d.plan.comparaison.n >= 1, "comparaison au réel (Projection.comparerPlanReel)");
  const ech = await GM.calculer(S, GM.reglagesParDefaut(), { today: AUJ, executer: () => Promise.reject(new Error("worker interrompu")), reconstitue: null });
  assert.equal(ech.etat, "erreur"); assert.equal(ech.erreur, "worker interrompu"); assert.equal(ech.futur, undefined);
  const sans = await GM.calculer(S, GM.reglagesParDefaut(), { today: AUJ, deps: { Projection: null }, executer: sync(100), reconstitue: null });
  assert.ok(sans.etat === "pret" || sans.etat === "erreur");
});

test("plan figé : valeurs décalées comme la courbe (biens d'usage), série en euros courants ; aucune cascade de causes (elle n'existe pas) ; plan sans série : null", () => {
  const detail = { id: "p", cree_le: "2026-08-14T20:00:00.000Z", raison: "manuel", serie: { mois: ["2026-08-14", "2026-09-14"], p10: [1, 2], p25: [2, 3], p50: [3, 4], p75: [4, 5], p90: [5, 6], vue: "net", euros: "courants" } };
  const p = GM.planDe(detail, { points: [{ date: AUJ, valeur: 10, nature: "observe" }] }, 100);
  assert.deepEqual(p.serie.p50, [103, 104]); assert.equal(p.euros, "courants"); assert.equal(Object.keys(p).includes("cascade"), false); assert.equal(Object.keys(p).includes("attribution"), false);
  assert.equal(GM.planDe({ id: "x" }, null, 0), null); assert.equal(GM.planDe(null, null, 0), null);
});

test("capacité dans le temps (IMMO1) : budget d'achat P10–P90 par année, montant empruntable, bande de taux, jalons, phrase de titre ; durée 20 / 25 ans ; indisponible = raison honnête", () => {
  const S = etat();
  const d = GM.calculerCapacite(S, GM.reglagesParDefaut({ vue: "financier", duree: 25 }), { today: AUJ, chemins: 300 });
  assert.equal(d.mode, "capacite");
  if (d.etat === "pret") {
    const c = d.capacite_demain;
    assert.equal(c.mois.length, 21); assert.equal(c.budget_achat.p10.length, 21); assert.ok(c.budget_achat.p10[5] <= c.budget_achat.p50[5] && c.budget_achat.p50[5] <= c.budget_achat.p90[5]);
    assert.ok(c.budget_achat_par_taux.bas[3] >= c.budget_achat_par_taux.haut[3], "un taux plus bas : un budget plus haut");
    assert.match(c.phrase, /^En \d{4}, budget d'achat médian/); assert.equal(c.serie_mensuelle.mois.length, 241); assert.match(d.mention, /HCSF/);
    assert.equal(d.passe, null);
    const vingt = GM.calculerCapacite(S, GM.reglagesParDefaut({ vue: "financier", duree: 20 }), { today: AUJ, chemins: 300 });
    assert.equal(vingt.capacite_demain.duree_ans, 20); assert.notDeepEqual(vingt.capacite_demain.budget_achat.p50, c.budget_achat.p50);
  } else assert.ok(d.raison || d.erreur, "sinon une raison : " + JSON.stringify(d).slice(0, 200));
  const sansRep = etat(); sansRep.savoir.reperes = [];
  const v = GM.calculerCapacite(sansRep, GM.reglagesParDefaut({ vue: "financier" }), { today: AUJ, chemins: 100 });
  assert.equal(v.etat, "vide"); assert.match(v.raison, /repère manquant/); assert.equal(v.capacite_demain, undefined, "jamais un chiffre sans repère");
});

test("chargement : tant que le passé est lu (enAttente), rien n'est dessiné (squelette) mais le moteur est préchauffé ; le passé arrivé, un seul dessin, avec son passé, sans second calcul", async () => {
  const S = etat(), vus = [], monte = [], exec = [];
  let attente = true;
  const faux = { PRESETS: { aujourdhui: { vue: "net" } }, monter: (el, o) => { monte.push(o); return { mettreAJour: (d, i) => vus.push([d.etat, i && i.etape]), reglagesAppliques() {}, detruire() {} }; } };
  const executer = (data, options, rappel) => { exec.push(options.vue); return sync(150)(data, options, rappel); };
  const l = GM.brancher({}, { preset: "aujourdhui", deps: { GraphePatrimoine: faux }, today: () => AUJ, enAttente: () => attente, moteurDeps: { Projection: Object.assign({}, P, { executer }) } });
  l.actualiser(S); await new Promise(r => setTimeout(r, 50));
  assert.equal(vus.length, 0, "aucun dessin tant que le passé n'est pas là : pas de saut au chargement");
  assert.equal(exec.length, 1, "le moteur est préchauffé pendant la lecture du passé");
  l.actualiser(S); await new Promise(r => setTimeout(r, 30)); assert.equal(exec.length, 1, "préchauffé une seule fois");
  attente = false; l.actualiser(S); await new Promise(r => setTimeout(r, 50));
  assert.ok(vus.length >= 1 && vus.at(-1)[0] === "pret", "le passé est là : le graphe se dessine");
  const n = vus.length; l.actualiser(S); await new Promise(r => setTimeout(r, 30)); assert.equal(vus.length, n, "aucun redessin inutile");
  /* délai maximum : si le passé ne vient jamais, on dessine quand même */
  const vus2 = [];
  const faux2 = { PRESETS: { aujourdhui: { vue: "net" } }, monter: () => ({ mettreAJour: d => vus2.push(d.etat), reglagesAppliques() {}, detruire() {} }) };
  const l2 = GM.brancher({}, { preset: "aujourdhui", deps: { GraphePatrimoine: faux2 }, today: () => AUJ, enAttente: () => true, delaiAttente: 20, moteurDeps: { Projection: Object.assign({}, P, { executer: sync(150) }) } });
  l2.actualiser(S); await new Promise(r => setTimeout(r, 120));
  assert.ok(vus2.includes("pret"), "au bout du délai : le graphe se dessine avec ce qui est lu");
});

test("effet d'un événement sur la médiane à l'horizon : deux modèles, mêmes tirages ; null pour ce qui n'est pas un événement du foyer", () => {
  const S = etat(), ev = S.foyer.evenements[0];
  const e = GM.effetSurMediane(S, ev.id, GM.reglagesParDefaut({ vue: "financier" }), { today: AUJ, chemins: 200, horizon_ans: 5 });
  assert.ok(e && Number.isFinite(e.montant) && e.mois === 60 && e.probabilite_mieux >= 0 && e.probabilite_mieux <= 1);
  assert.equal(GM.effetSurMediane(S, "inconnu", GM.reglagesParDefaut(), { today: AUJ }), null); assert.equal(GM.effetSurMediane(S, null, GM.reglagesParDefaut(), {}), null);
});

test("liaison écran ↔ composant : un seul montage, un recalcul seulement si ce qui compte a changé (signature), réglages locaux relancent le calcul, destruction propre", async () => {
  const S = etat(), vus = [], monte = [];
  const faux = { PRESETS: { aujourdhui: { vue: "net" } }, monter: (el, o) => { monte.push(o); return { mettreAJour: (d, i) => vus.push([d.etat, i && i.etape]), reglagesAppliques() {}, detruire() { vus.push("detruit"); } }; } };
  const l = GM.brancher({}, { preset: "aujourdhui", deps: { GraphePatrimoine: faux }, today: () => AUJ, perimetre: () => "du foyer", moteurDeps: { Projection: Object.assign({}, P, { executer: sync(150) }) } });
  assert.ok(l); assert.equal(monte.length, 1); assert.equal(monte[0].preset, "aujourdhui"); assert.equal(monte[0].reglages.vue, "net");
  l.actualiser(S); await new Promise(r => setTimeout(r, 50));
  const n1 = vus.length; assert.ok(n1 >= 1 && vus.at(-1)[0] === "pret");
  l.actualiser(S); await new Promise(r => setTimeout(r, 50)); assert.equal(vus.length, n1, "même état : aucun recalcul");
  const S2 = Object.assign({}, S, { scope: "p1" }); l.actualiser(S2); await new Promise(r => setTimeout(r, 80)); assert.ok(vus.length > n1, "autre périmètre : recalcul");
  const n2 = vus.length; await monte[0].surReglages(GM.reglagesParDefaut({ vue: "financier" })); assert.ok(vus.length > n2, "réglage de calcul : le composant relance");
  assert.equal(l.reglages().vue, "financier");
  l.detruire(); assert.equal(vus.at(-1), "detruit");
  assert.equal(GM.brancher(null, {}), null); assert.equal(GM.brancher({}, { deps: { GraphePatrimoine: {} } }), null, "sans composant : rien");
});

test("graphe-modele.js : tutoiement, aucune écriture (lecture seule), aucun accès réseau ; fonctions pures sans DOM", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("web/src/graphe-modele.js", "utf8");
  assert.doesNotMatch(src, /\b(vous|votre|vos)\b/i); assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ""), /localStorage|\.insert\(|\.upsert\(|\.update\(|\.delete\(|fetch\(|document\./);
});

test("liaison : surRendement reçoit le bloc rendement ({ projet, reel }) à chaque dessin du graphe, jamais un calcul périmé ; sans fonction, rien ne change", async () => {
  const S = etat(), recus = [], vus = [];
  const faux = { PRESETS: { placements: { vue: "financier" } }, monter: () => ({ mettreAJour: d => vus.push(d.etat), reglagesAppliques() {}, detruire() {} }) };
  const l = GM.brancher({}, { preset: "placements", deps: { GraphePatrimoine: faux }, today: () => AUJ, surRendement: (r, info) => recus.push([r, info && info.etape]), moteurDeps: { Projection: Object.assign({}, P, { executer: sync(150) }) } });
  l.actualiser(S); await new Promise(r => setTimeout(r, 80));
  assert.ok(recus.length >= 1, "appelé au dessin");
  const [r, etape] = recus.at(-1);
  assert.equal(etape, "complet");
  assert.ok(r && r.projet && r.reel && Array.isArray(r.reel.periodes) && r.reel.periodes.length === 4, "bloc rendement du modèle");
  assert.equal(recus.length, vus.length, "un appel par dessin");
  const sans = GM.brancher({}, { preset: "placements", deps: { GraphePatrimoine: faux }, today: () => AUJ, moteurDeps: { Projection: Object.assign({}, P, { executer: sync(100) }) } });
  assert.doesNotThrow(() => sans.actualiser(S));
  await new Promise(r => setTimeout(r, 60));
});
