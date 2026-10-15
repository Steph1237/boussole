import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Calc = require("../web/src/calc.js");

const P = [
  { id: "lqq", owner: "p1", bloc: "Nasdaq 2x", mode: "market", qty: 100, price: 10, status: "actif" },
  { id: "livret", owner: "p1", bloc: "Épargne", mode: "manual", value: 45000, status: "actif" },
  { id: "indem", owner: "p1", bloc: "Épargne", mode: "manual", value: 25000, status: "à recevoir" },
  { id: "old", owner: "p1", bloc: "Monde", mode: "market", qty: 0, price: 50, status: "clôturé" },
  { id: "scpi", owner: "p2", bloc: "SCPI", mode: "manual", value: 30000, status: "actif" },
];
const CONFIG = { cushion: { min: 35000, max: 40000 } };
const PROFIL = {
  foyer: { adultes: 2, enfants: 0, enfants14: 0, union: "joint", age: "a30", tmi: 30 },
  personnes: {
    p1: { salaire: 4000, salaireUnite: "nm", statut: "cadre", autresRevenus: 100 },
    p2: { salaire: 39000, salaireUnite: "ba", statut: "nc", autresRevenus: 0 },
  },
  biens: [{ id: "b1", nom: "Studio Lyon", usage: "locatif", valeur: 200000, part_p1: 60, crd: 100000, mensualite: 800, loyer: 700 }],
  credits: [
    { id: "c1", nom: "Auto", owner: "commun", crd: 10000, mensualite: 300 },
    { id: "c2", nom: "Conso", owner: "p1", crd: 2000, mensualite: 100 },
  ],
  autres: { p1: { usage: 15000, entreprise: 0 }, p2: { usage: 5000, entreprise: 1000 } },
};

test("financier exclut à recevoir et clôturé, filtre le périmètre", () => {
  assert.equal(Calc.financier(P, "foyer"), 1000 + 45000 + 30000);
  assert.equal(Calc.financier(P, "p1"), 46000);
  assert.equal(Calc.financier(P, "p2"), 30000);
});

test("part : quote-part selon le périmètre", () => {
  assert.equal(Calc.part("foyer", 60), 1);
  assert.equal(Calc.part("p1", 60), 0.6);
  assert.ok(Math.abs(Calc.part("p2", 60) - 0.4) < 1e-9);
});

test("immobilier et dettes par quote-part, crédit commun réparti 50/50", () => {
  assert.equal(Calc.immobilier(PROFIL, "foyer"), 200000);
  assert.equal(Calc.immobilier(PROFIL, "p1"), 120000);
  assert.equal(Calc.dettes(PROFIL, "foyer"), 100000 + 10000 + 2000);
  assert.equal(Calc.dettes(PROFIL, "p1"), 60000 + 5000 + 2000);
  assert.equal(Calc.dettes(PROFIL, "p2"), 40000 + 5000);
});

test("patrimoine net = financier + immo + autres − dettes", () => {
  const r = Calc.patrimoine(P, PROFIL, "foyer");
  assert.equal(r.financier, 76000);
  assert.equal(r.immobilier, 200000);
  assert.equal(r.usage, 20000);
  assert.equal(r.entreprise, 1000);
  assert.equal(r.dettes, 112000);
  assert.equal(r.brut, 297000);
  assert.equal(r.net, 185000);
});

test("profil vide : patrimoine = financier, rien ne casse", () => {
  const r = Calc.patrimoine(P, null, "p1");
  assert.equal(r.net, 46000);
  assert.equal(r.immobilier, 0);
});

test("salaire net mensuel : conversions brut/net cadre et non-cadre", () => {
  assert.equal(Calc.salaireNetMensuel({ salaire: 4000, salaireUnite: "nm" }), 4000);
  assert.equal(Calc.salaireNetMensuel({ salaire: 48000, salaireUnite: "na" }), 4000);
  assert.equal(Calc.salaireNetMensuel({ salaire: 4000, salaireUnite: "bm", statut: "cadre" }), 3000);
  assert.equal(Calc.salaireNetMensuel({ salaire: 39000, salaireUnite: "ba", statut: "nc" }), 2535);
  assert.equal(Calc.salaireNetMensuel(null), 0);
});

test("revenus du foyer : salaires + autres revenus + loyers × quote-part", () => {
  assert.equal(Calc.revenusFoyer(PROFIL, "foyer"), 4000 + 100 + 2535 + 700);
  assert.equal(Calc.revenusFoyer(PROFIL, "p1"), 4000 + 100 + 420);
});

test("mensualités en cours", () => {
  assert.equal(Calc.mensualites(PROFIL, "foyer"), 800 + 300 + 100);
  assert.equal(Calc.mensualites(PROFIL, "p2"), 320 + 150);
});

test("apport disponible : épargne au-delà du matelas, curseur placements, option à recevoir", () => {
  const a = Calc.apportDisponible(P, CONFIG, "p1");
  assert.equal(a.libre, 10000);
  assert.equal(a.placements, 0);
  assert.equal(a.total, 10000);
  const b = Calc.apportDisponible(P, CONFIG, "p1", { partPlacements: 50, inclureARecevoir: true });
  assert.equal(b.placements, 500);
  assert.equal(b.aRecevoir, 25000);
  assert.equal(b.total, 35500);
  const c = Calc.apportDisponible(P, CONFIG, "p2", { partPlacements: 10 });
  assert.equal(c.matelas, 0);
  assert.equal(c.total, 3000);
});

test("apport : jamais négatif si épargne sous le matelas", () => {
  const a = Calc.apportDisponible([{ owner: "p1", bloc: "Épargne", mode: "manual", value: 1000, status: "actif" }], CONFIG, "p1");
  assert.equal(a.libre, 0);
  assert.equal(a.total, 0);
});

test("crédits en cours : prêts des biens (reste dû ou mensualité) puis crédits déclarés ; leur somme = dettes et mensualités du foyer", () => {
  const pr = { biens: [{ nom: "RP", valeur: 240000, part_p1: 50, crd: 150000, mensualite: 820 }, { nom: "Studio", valeur: 90000, part_p1: 100, crd: 0, mensualite: 0 }],
    credits: [{ nom: "Prêt auto", owner: "commun", crd: 6500, mensualite: 210 }] };
  const L = Calc.creditsEnCours(pr);
  assert.deepEqual(L.map(c => [c.kind, c.nom, c.crd, c.mensualite]), [["pret", "RP", 150000, 820], ["credit", "Prêt auto", 6500, 210]], "un bien sans prêt n'est pas un crédit");
  assert.equal(L.reduce((a, c) => a + c.crd, 0), Calc.dettes(pr, "foyer"));
  assert.equal(L.reduce((a, c) => a + c.mensualite, 0), Calc.mensualites(pr, "foyer"));
  assert.deepEqual(Calc.creditsEnCours(null), []);
  assert.equal(Calc.completude, undefined, "la complétude est celle du bilan (bilan-etat.js) : une seule fonction");
});

test("validation : quote-part et montants", () => {
  const errs = Calc.valider({ biens: [{ nom: "X", valeur: 100, part_p1: 120, crd: 200 }], credits: [{ nom: "Y", crd: -5 }] });
  assert.ok(errs.erreurs.length >= 2);
  assert.ok(errs.avertissements.some(w => /dépasse/.test(w)));
  assert.deepEqual(Calc.valider(PROFIL).erreurs, []);
});

test("matelas : montant (min/max) ou mois (mois × dépenses)", () => {
  assert.equal(Calc.matelas(null), null);
  assert.deepEqual(Calc.matelas({ cushion: { mode: "amount", min: 15000, max: 20000 } }), { mode: "amount", min: 15000, max: 20000 });
  assert.deepEqual(Calc.matelas({ cushion: { min: 35000, max: 40000 } }), { mode: "amount", min: 35000, max: 40000 });
  const m = Calc.matelas({ cushion: { mode: "months", months: 6, depenses: 2500 } });
  assert.equal(m.min, 15000); assert.equal(m.max, null);
  const a = Calc.apportDisponible(P, { cushion: { mode: "months", months: 4, depenses: 10000 } }, "p1");
  assert.equal(a.matelas, 40000); assert.equal(a.libre, 5000);
});

test("classe d'actifs : poches connues, accents et casse ignorés, inconnu → autres", () => {
  assert.equal(Calc.classe("Monde"), "actions");
  assert.equal(Calc.classe("Nasdaq 2x"), "actions");
  assert.equal(Calc.classe("convictions tech"), "actions");
  assert.equal(Calc.classe("SCPI"), "immobilier");
  assert.equal(Calc.classe("Obligations"), "obligations");
  assert.equal(Calc.classe("Épargne"), "monetaire");
  assert.equal(Calc.classe("epargne"), "monetaire");
  // bloc des comptes courants créés par la synchronisation bancaire (Powens) : monétaire, disponible tout de suite
  assert.equal(Calc.classe("Comptes courants"), "monetaire");
  assert.equal(Calc.classe("Compte courant"), "monetaire");
  assert.equal(Calc.liquidite("Comptes courants"), "immediate");
  assert.equal(Calc.classe("Protection"), "fonds_euros");
  assert.equal(Calc.classe("Or"), "or");
  assert.equal(Calc.classe("Crypto"), "crypto");
  assert.equal(Calc.classe("Vins"), "autres");
  assert.equal(Calc.classe("Monde", { Monde: "obligations" }), "obligations", "surcharge utilisateur prioritaire");
});

test("liquidité par enveloppe", () => {
  assert.equal(Calc.liquidite("Livrets"), "immediate");
  assert.equal(Calc.liquidite("Compte courant"), "immediate");
  assert.equal(Calc.liquidite("PEA"), "jours");
  assert.equal(Calc.liquidite("Crypto (Binance)"), "jours");
  assert.equal(Calc.liquidite("AV Linxea Spirit 2"), "semaines");
  assert.equal(Calc.liquidite("Assurance-vie"), "semaines");
  assert.equal(Calc.liquidite("PER"), "bloque");
  assert.equal(Calc.liquidite("Truc"), "jours");
  // « compte » non suivi de « titres » : un compte-titres se vend en quelques jours ; « PERin » sans espace reste bloqué
  assert.equal(Calc.liquidite("Compte-titres Sam"), "jours");
  assert.equal(Calc.liquidite("Compte titres"), "jours");
  assert.equal(Calc.liquidite("Comptes-titres"), "jours");
  assert.equal(Calc.liquidite("Compte joint"), "immediate");
  assert.equal(Calc.liquidite("PERin"), "bloque");
  assert.equal(Calc.liquidite("PERin Camille"), "bloque");
});

test("répartition par classe et par liquidité, périmètre respecté", () => {
  const P = [
    { owner: "p1", bloc: "Monde", envelope: "PEA", mode: "manual", value: 6000, status: "actif" },
    { owner: "p1", bloc: "Épargne", envelope: "Livrets", mode: "manual", value: 3000, status: "actif" },
    { owner: "p2", bloc: "SCPI", envelope: "AV", mode: "manual", value: 1000, status: "actif" },
    { owner: "p1", bloc: "Monde", envelope: "PER", mode: "manual", value: 500, status: "à recevoir" },
  ];
  assert.deepEqual(Calc.parClasse(P, "foyer"), { actions: 6000, monetaire: 3000, immobilier: 1000 });
  assert.deepEqual(Calc.parClasse(P, "p1"), { actions: 6000, monetaire: 3000 });
  assert.deepEqual(Calc.parLiquidite(P, "foyer"), { jours: 6000, immediate: 3000, semaines: 1000 });
});

/* ---------- CP1 : familles de comptes, budget réel, matelas avec réserve, argent qui dort ---------- */
const L = (envelope, bloc, value, extra) => ({ owner: "p1", envelope, bloc, name: bloc, mode: "manual", value, status: "actif", ...extra });
/* Libellés de référence (partagés avec le test de parité du connecteur, test/mcp.test.mjs). */
const FAMILLES_ATTENDUES = [
  ["Banque", "Comptes courants", "courant"], ["Boursorama", "Compte courant", "courant"], ["Compte courant Camille", "Épargne", "courant"],
  ["Comptes courants", "Liquidités", "courant"], ["Livret A", "Épargne", "epargne"], ["Livrets Sam", "Épargne", "epargne"], ["LDDS", "Livrets", "epargne"],
  ["LEP", "", "epargne"], ["PEL", "Épargne", "epargne"], ["Compte à terme", "Épargne", "epargne"], ["Compte épargne Revolut", "Cash", "epargne"],
  ["Banque", "Épargne", "epargne"], ["", "Monétaire", "epargne"], ["PEA Camille", "Monde", "investissement"], ["PEA-PME", "Convictions", "investissement"],
  ["CTO Sam", "Convictions", "investissement"], ["Compte-titres", "Monétaire", "investissement"], ["Assurance vie Sam", "Obligations", "investissement"],
  ["AV Linxea Spirit 2", "Épargne", "investissement"], ["PER", "Monde", "investissement"], ["PERin Camille", "Monde", "investissement"],
  ["Crypto (Binance)", "Crypto", "investissement"], ["Ledger", "Crypto", "investissement"], ["SCPI", "SCPI", "investissement"],
  ["Épargne salariale", "Monde", "investissement"], ["", "Vins", "investissement"], [null, null, "investissement"],
  // libellés longs et variantes (revue CP1, I4) : plans d'épargne → investissement, compte joint → courant
  ["Plan d'épargne en actions", "Monde", "investissement"], ["Plan d’épargne en actions Camille", "Épargne", "investissement"],
  ["Plan d'épargne retraite", "Monde", "investissement"], ["Plan épargne retraite individuel", "Épargne", "investissement"],
  ["Plan d'épargne entreprise", "Monétaire", "investissement"], ["Plan d'épargne avenir climat", "Épargne", "investissement"],
  ["PERCOL", "Monde", "investissement"], ["PERECO Sam", "Épargne", "investissement"], ["Contrat Madelin", "Épargne", "investissement"],
  ["Compte joint", "Épargne", "courant"], ["Comptes joints", "", "courant"], ["Banque des Canuts", "Compte joint", "courant"],
];

test("famille : courant (bloc ou enveloppe « comptes courants »), épargne disponible, investissement ; repli sur la classe de la poche", () => {
  for (const [envelope, bloc, f] of FAMILLES_ATTENDUES) assert.equal(Calc.famille({ envelope, bloc }), f, `${envelope} / ${bloc}`);
  assert.equal(Calc.famille(null), "investissement");
  assert.equal(Calc.famille({ envelope: "Banque", bloc: "Trésorerie" }, { "Trésorerie": "monetaire" }), "epargne", "surcharge de la classe utilisée dans le repli");
  assert.deepEqual(Object.keys(Calc.FAMILLES_LABELS), ["courant", "epargne", "investissement", "dettes"]);
});

test("répartition par classe : sans les comptes courants (le patrimoine net les garde)", () => {
  const P = [L("PEA", "Monde", 6000), L("Compte courant", "Comptes courants", 4000), L("Livret A", "Épargne", 3000)];
  assert.deepEqual(Calc.parClasse(P, "foyer"), { actions: 6000, monetaire: 3000 });
  assert.equal(Calc.financier(P, "foyer"), 13000);
  assert.equal(Calc.patrimoine(P, {}, "foyer").net, 13000);
  assert.deepEqual(Calc.parLiquidite(P, "foyer"), { jours: 6000, immediate: 7000 }, "la liquidité garde les comptes courants");
});

const AUJ = "2026-10-12";
const mois = (m, categorie, entrees, sorties, extra) => ({ mois: m, categorie, entrees, sorties, nombre: 1, ...extra });
const COMPTES = [
  { id: 1, type: "courant", ignore: false, doublonDe: null, actif: true }, { id: 2, type: "livret", ignore: false, doublonDe: null },
  { id: 3, type: "courant", ignore: true }, { id: 4, type: "courant", doublonDe: 1 }, { id: 5, type: "courant", actif: false },
];

test("comptes courants suivis : type courant, ni ignorés, ni en double, ni inactifs (formes camelCase et SQL)", () => {
  assert.deepEqual(Calc.comptesCourants({ comptes: COMPTES }).map(c => c.id), [1]);
  assert.deepEqual(Calc.comptesCourants({ comptes: [{ id: 9, type: "courant", doublon_de: 1 }, { id: 8, type: "courant", doublon_de: null }] }).map(c => c.id), [8]);
  assert.deepEqual(Calc.comptesCourants(null), []);
});

test("budget réel : 3 derniers mois complets, revenus / dépenses / épargne, virements internes exclus, taux d'épargne", () => {
  const b = { actif: true, comptes: COMPTES, mois: [
    mois("2026-06-01", "alimentation", 0, 9999),                                   // trop ancien (4e mois)
    mois("2026-07-01", "revenus", 5000, 0), mois("2026-07-01", "alimentation", 50, 1050), mois("2026-07-01", "epargne", 0, 500),
    mois("2026-08-01", "revenus", 5000, 0), mois("2026-08-01", "logement", 0, 1000), mois("2026-08-01", "epargne", 0, 1000),
    mois("2026-09-01", "revenus", 5000, 0), mois("2026-09-01", "divers", 0, 1000), mois("2026-09-01", "epargne", 100, 1600),
    mois("2026-09-01", "virement_interne", 3000, 3000), mois("2026-10-01", "alimentation", 0, 800), // mois en cours exclu
  ] };
  const r = Calc.budgetReel(b, AUJ);
  assert.deepEqual([r.n, r.du, r.au], [3, "2026-07-01", "2026-09-01"]);
  assert.equal(r.revenus, 5000); assert.equal(r.depenses, 1000); assert.equal(r.epargne, 1000);
  assert.equal(r.tauxEpargne, 0.2);
  assert.equal(Calc.budgetReel(Object.assign({}, b, { actif: false }), AUJ), null, "interrupteur éteint");
  assert.equal(Calc.budgetReel({ actif: true, mois: [mois("2026-10-01", "divers", 0, 10)] }, AUJ), null, "seulement le mois en cours");
  assert.equal(Calc.budgetReel(null, AUJ), null);
  assert.equal(Calc.budgetReel({ mois: [mois("2026-09-01", "divers", 0, 10)] }, AUJ).depenses, 10, "forme du connecteur (sans actif)");
});

test("budget réel : parCompte = vrai seulement si chaque mois retenu est détaillé par compte ; mois mixtes lus mois par mois", () => {
  const b = { actif: true, comptes: COMPTES, mois: [
    mois("2026-07-01", "divers", 0, 2000),                                                    // totaux par utilisateur (compte 0 → compteId nul)
    mois("2026-08-01", "divers", 0, 1000, { compteId: 1 }), mois("2026-08-01", "divers", 0, 400, { compteId: 2 }),
    mois("2026-09-01", "divers", 0, 999, { compteId: null }), mois("2026-09-01", "divers", 0, 500, { compteId: 1 }), // mois détaillé : la ligne agrégée est ignorée
  ] };
  const r = Calc.budgetReel(b, AUJ);
  assert.equal(r.depenses, (2000 + 1000 + 500) / 3, "juillet agrégé, août et septembre : compte courant 1 seulement");
  assert.equal(r.parCompte, false, "juillet n'est pas détaillé par compte : libellé « tous comptes connectés »");
  assert.equal(Calc.budgetReel(b, AUJ, 2).parCompte, true, "août et septembre seuls : comptes courants");
  assert.equal(Calc.budgetReel({ actif: true, mois: [mois("2026-09-01", "divers", 0, 10)] }, AUJ).parCompte, false);
  assert.deepEqual(Calc.moisCourants(b).map(m => m.sorties), [2000, 1000, 500]);
});

test("budget réel : mois agrégés par compte → comptes courants seulement ; sans compte → totaux tels quels", () => {
  const b = { actif: true, comptes: COMPTES, mois: [
    mois("2026-09-01", "divers", 0, 1000, { compteId: 1 }), mois("2026-09-01", "divers", 0, 500, { compteId: 2 }),
    mois("2026-09-01", "divers", 0, 700, { compteId: 3 }), mois("2026-09-01", "divers", 0, 300, { compte_id: 1 }),
  ] };
  assert.equal(Calc.budgetReel(b, AUJ).depenses, 1300, "compte 1 seulement (livret, ignoré exclus)");
  assert.equal(Calc.moisCourants(b).length, 2);
  const sans = { actif: true, comptes: COMPTES, mois: [mois("2026-09-01", "divers", 0, 1000), mois("2026-09-01", "loisirs", 0, 500)] };
  assert.equal(Calc.moisCourants(sans).length, 2);
  assert.equal(Calc.budgetReel(sans, AUJ).depenses, 1500);
});

test("dépenses prévues : mêmes règles que Plan.budgetTotaux (lignes + mensualités, sinon dépenses du matelas en mois)", () => {
  const Plan = require("../web/src/plan.js");
  const budget = { lignes: [{ type: "depense", montant: 1200 }, { type: "depense", montant: 2400, frequence: "an", owner: "p2" }, { type: "revenu", montant: 4000 }] };
  for (const scope of ["foyer", "p1", "p2"]) assert.equal(Calc.depensesPrevues(budget, PROFIL, null, scope), Plan.budgetTotaux(budget.lignes, PROFIL, scope).depenses, scope);
  assert.equal(Calc.depensesPrevues({ lignes: [] }, PROFIL, { cushion: { mode: "months", months: 3, depenses: 2100 } }), 2100);
  assert.equal(Calc.depensesPrevues(null, null, null), 0);
  const d = Calc.depensesMensuelles({ banque: { actif: true, mois: [mois("2026-09-01", "divers", 0, 1800)] }, budget, profil: PROFIL, scope: "foyer", auj: AUJ });
  assert.deepEqual([d.montant, d.source], [1800, "reel"]);
  assert.equal(Calc.depensesMensuelles({ banque: { actif: true, mois: [mois("2026-09-01", "divers", 0, 1800)] }, budget, profil: PROFIL, scope: "p1", auj: AUJ }).source, "prevu",
    "les comptes ne sont pas répartis par personne");
  assert.equal(Calc.depensesMensuelles({ budget: { lignes: [] }, profil: {}, scope: "foyer", auj: AUJ }), null);
});

test("matelas : épargne disponible + comptes courants au-delà d'une réserve (reserve_mois, 1 mois par défaut)", () => {
  const P = [L("Livret A", "Épargne", 9000), L("Banque", "Comptes courants", 5000), L("PEA", "Monde", 20000), L("Banque", "Comptes courants", 1000, { status: "à recevoir" })];
  const m = Calc.matelasDisponible(P, "foyer", { config: { cushion: { min: 10000 } }, depenses: 2000 });
  assert.deepEqual([m.epargne, m.courants, m.reserveMois, m.reserve, m.courantsAuDela, m.total], [9000, 5000, 1, 2000, 3000, 12000]);
  const m2 = Calc.matelasDisponible(P, "foyer", { config: { cushion: { mode: "months", months: 6, depenses: 2000, reserve_mois: 2 } }, depenses: 2000 });
  assert.deepEqual([m2.reserveMois, m2.courantsAuDela, m2.total], [2, 1000, 10000]);
  assert.equal(Calc.matelasDisponible(P, "foyer", { config: { cushion: { reserve_mois: 3 } }, depenses: 2000 }).total, 9000, "courants sous la réserve : rien en plus");
  assert.equal(Calc.reserveMois(null), 1); assert.equal(Calc.reserveMois({ cushion: { reserve_mois: 0 } }), 0); assert.equal(Calc.reserveMois({ cushion: { reserve_mois: "x" } }), 1);
  // les formes existantes de config.cushion restent lues à l'identique
  assert.deepEqual(Calc.matelas({ cushion: { mode: "amount", min: 15000, max: 20000, reserve_mois: 2 } }), { mode: "amount", min: 15000, max: 20000 });
});

test("argent qui dort : comptes courants au-delà de 1,5 mois de dépenses deux mois de suite (photos, sinon solde actuel)", () => {
  const budget = { lignes: [{ type: "depense", montant: 2000 }] };   // seuil 3 000 €
  const positions = [L("Banque", "Comptes courants", 6000), L("Livret A", "Épargne", 9000)];
  const photo = (date, banque) => ({ date, byBloc: { "Comptes courants": banque, "Épargne": 9000 }, byEnvelope: { Banque: banque + 50000, "Livret A": 9000 } });
  const S = { positions, budget, profil: {}, config: {}, snapshots: [photo("2026-08-31", 5000), photo("2026-09-15", 9000), photo("2026-09-30", 4500), photo("2026-10-11", 100)] };
  assert.deepEqual(Calc.argentQuiDort(S, AUJ), { montant: 1500, mois: 2, solde: 4500, seuil: 3000, depenses: 2000, source: "prevu" });
  assert.equal(Calc.argentQuiDort(Object.assign({}, S, { snapshots: [photo("2026-08-31", 2000), photo("2026-09-30", 4500)] }), AUJ), null, "un seul mois au-dessus");
  // à défaut de deux photos : solde actuel et fin du mois précédent
  const r = Calc.argentQuiDort(Object.assign({}, S, { snapshots: [photo("2026-09-30", 4500)] }), AUJ);
  assert.deepEqual([r.montant, r.mois, r.solde], [1500, 2, 6000]);
  assert.equal(Calc.argentQuiDort(Object.assign({}, S, { snapshots: [] }), AUJ), null, "aucune photo");
  assert.equal(Calc.argentQuiDort(Object.assign({}, S, { budget: { lignes: [] } }), AUJ), null, "dépenses inconnues");
  assert.equal(Calc.argentQuiDort(Object.assign({}, S, { positions: [L("Livret A", "Épargne", 9000)] }), AUJ), null, "pas de compte courant");
  // dépenses réelles prioritaires : 4 000 €/mois → seuil 6 000 €, plus rien ne dort
  const banque = { actif: true, mois: [mois("2026-09-01", "divers", 0, 4000)] };
  assert.equal(Calc.argentQuiDort(Object.assign({}, S, { banque }), AUJ), null);
  // trois mois de suite
  const trois = Calc.argentQuiDort(Object.assign({}, S, { snapshots: [photo("2026-07-31", 8000), ...S.snapshots] }), AUJ);
  assert.deepEqual([trois.mois, trois.montant], [3, 1500]);
});

test("argent qui dort : mesuré sur les seules lignes des comptes courants (poche, sinon enveloppe « compte courant »), pas sur toute l'enveloppe", () => {
  const budget = { lignes: [{ type: "depense", montant: 2000 }] };   // seuil 3 000 €
  // l'enveloppe « Boursorama » mêle un compte courant et un PEA : byEnvelope.Boursorama compterait le PEA
  const positions = [L("Boursorama", "Comptes courants", 2000), L("Boursorama", "Monde", 40000), L("Compte joint", "Épargne", 1500)];
  const photo = (date, cc, joint) => ({ date, byBloc: { "Comptes courants": cc, Monde: 40000, "Épargne": joint }, byEnvelope: { Boursorama: cc + 40000, "Compte joint": joint } });
  const S = { positions, budget, profil: {}, config: {}, snapshots: [photo("2026-08-31", 2000, 1500), photo("2026-09-30", 2100, 1600)] };
  const r = Calc.argentQuiDort(S, AUJ);
  assert.deepEqual([r.mois, r.solde, r.montant], [2, 3700, 500], "poche « Comptes courants » + enveloppe « Compte joint » (toute courante)");
  assert.equal(Calc.argentQuiDort(Object.assign({}, S, { snapshots: [photo("2026-08-31", 500, 1500), photo("2026-09-30", 500, 1600)] }), AUJ), null,
    "sous le seuil : le PEA de la même enveloppe n'est pas compté");
  assert.equal(Calc.argentQuiDort(Object.assign({}, S, { snapshots: [{ date: "2026-08-31", byEnvelope: { Boursorama: 50000 } }, { date: "2026-09-30", byEnvelope: { Boursorama: 50000 } }] }), AUJ), null,
    "photos sans poche ni enveloppe courante : rien de mesurable");
});

/* ---------- blocsPhoto : une seule lecture de snapshots.by_bloc (forme de production par personne, forme à plat) ---------- */
// La fonction nocturne take_snapshots (migration 0003) écrit by_bloc par personne : { p1: { poche: valeur }, p2: { … } }.
const PHOTO_NUIT = { date: "2026-09-30", foyer: 9000, p1: 6000, p2: 3000, byBloc: { p1: { Monde: 4500, "Comptes courants": 1500 }, p2: { "Épargne": 2500, Monde: 500 } } };
test("blocsPhoto : forme de production par personne → foyer = somme des personnes, p1 / p2 = la leur", () => {
  assert.deepEqual(Calc.blocsPhoto(PHOTO_NUIT, "foyer"), { Monde: 5000, "Comptes courants": 1500, "Épargne": 2500 });
  assert.deepEqual(Calc.blocsPhoto(PHOTO_NUIT, "p1"), { Monde: 4500, "Comptes courants": 1500 });
  assert.deepEqual(Calc.blocsPhoto(PHOTO_NUIT, "p2"), { "Épargne": 2500, Monde: 500 });
  assert.deepEqual(Calc.blocsPhoto(PHOTO_NUIT), Calc.blocsPhoto(PHOTO_NUIT, "foyer"), "périmètre par défaut : foyer");
  // ligne SQL brute (snake_case)
  assert.deepEqual(Calc.blocsPhoto({ date: "2026-09-30", total: 9000, by_bloc: PHOTO_NUIT.byBloc }, "foyer"), { Monde: 5000, "Comptes courants": 1500, "Épargne": 2500 });
  // une personne sans ligne : { p1: {…}, p2: {} } (cas réel d'un foyer d'une seule personne)
  assert.deepEqual(Calc.blocsPhoto({ byBloc: { p1: { Monde: 10 }, p2: {} } }, "foyer"), { Monde: 10 });
  assert.deepEqual(Calc.blocsPhoto({ byBloc: { p1: { Monde: 10 }, p2: {} } }, "p2"), {});
  // une clé « commun » éventuelle compte pour le foyer, pas pour une personne
  assert.deepEqual(Calc.blocsPhoto({ byBloc: { p1: { Monde: 10 }, commun: { Monde: 5 } } }, "foyer"), { Monde: 15 });
  assert.deepEqual(Calc.blocsPhoto({ byBloc: { p1: { Monde: 10 }, commun: { Monde: 5 } } }, "p1"), { Monde: 10 });
});
test("blocsPhoto : forme à plat (ancienne démo, lignes migrées) → foyer seulement ; absent ou illisible → null", () => {
  const plat = { date: "2026-09-30", byBloc: { Monde: 5000, "Épargne": 2500 } };
  assert.deepEqual(Calc.blocsPhoto(plat, "foyer"), { Monde: 5000, "Épargne": 2500 });
  assert.equal(Calc.blocsPhoto(plat, "p1"), null, "un relevé à plat ne se découpe pas par personne");
  assert.deepEqual(Calc.blocsPhoto({ by_bloc: { Monde: 1 } }), { Monde: 1 });
  for (const v of [null, undefined, {}, { byBloc: null }, { byBloc: {} }, { byBloc: "x" }, { byBloc: [] }]) assert.equal(Calc.blocsPhoto(v, "foyer"), null, JSON.stringify(v));
  // valeurs non numériques écartées ; la copie ne modifie pas la photo
  const sale = { byBloc: { p1: { Monde: "12", Crypto: null, Or: "abc" } } };
  assert.deepEqual(Calc.blocsPhoto(sale, "foyer"), { Monde: 12 });
  assert.deepEqual(sale, { byBloc: { p1: { Monde: "12", Crypto: null, Or: "abc" } } });
});
test("argent qui dort : photos de production (by_bloc par personne) ou à plat donnent le même résultat", () => {
  const budget = { lignes: [{ type: "depense", montant: 2000 }] };   // seuil 3 000 €
  const positions = [L("Banque", "Comptes courants", 6000), L("Livret A", "Épargne", 9000)];
  const plat = (date, banque) => ({ date, byBloc: { "Comptes courants": banque, "Épargne": 9000 } });
  // production : le compte courant est à p1, l'épargne se répartit entre p1 et p2 ; le compte courant d'une personne s'ajoute à celui de l'autre
  const nuit = (date, banque) => ({ date, byBloc: { p1: { "Comptes courants": banque - 1000, "Épargne": 4000 }, p2: { "Comptes courants": 1000, "Épargne": 5000 } } });
  const S = (photo, extra) => Object.assign({ positions, budget, profil: {}, config: {}, snapshots: [photo("2026-08-31", 5000), photo("2026-09-15", 9000), photo("2026-09-30", 4500), photo("2026-10-11", 100)] }, extra || {});
  const attendu = { montant: 1500, mois: 2, solde: 4500, seuil: 3000, depenses: 2000, source: "prevu" };
  assert.deepEqual(Calc.argentQuiDort(S(plat), AUJ), attendu);
  assert.deepEqual(Calc.argentQuiDort(S(nuit), AUJ), attendu, "forme de production : les poches courantes de p1 et p2 sont additionnées");
  // la poche n'existe que chez une personne : elle est quand même vue
  const seulP2 = d => ({ date: d, byBloc: { p1: { "Épargne": 100 }, p2: { "Comptes courants": 4500 } } });
  assert.deepEqual(Calc.argentQuiDort(S(seulP2, { snapshots: [seulP2("2026-08-31"), seulP2("2026-09-30")] }), AUJ).solde, 4500);
});

/* ---------- doublons probables (cas type : ligne « PEA DUPONT » qui recopie le total du PEA) ---------- */
/** Cas type (montants fictifs) : 13 lignes de titres + « Espèces PEA » (≈ 51 500 € en tout) et une ligne manuelle « PEA DUPONT » de 51 230,50 €. */
function peaType() {
  const titres = [7200, 6100, 5500, 5100, 4500, 4200, 3800, 3500, 3000, 2700, 2300, 1900, 1650].map((v, i) =>
    ({ id: "t" + i, name: "Titre " + i, envelope: "PEA", owner: "p1", bloc: "Monde", mode: "market", isin: "FR000000000" + i, qty: 1, price: v, status: "actif" }));
  return [...titres,
    { id: "esp", name: "Espèces PEA", envelope: "PEA", owner: "p1", bloc: "Liquidités", mode: "manual", isin: null, value: 60, status: "actif" },
    { id: "dupont", name: "PEA DUPONT", envelope: "PEA", owner: "p1", bloc: "Monde", mode: "manual", isin: null, value: 51230.5, status: "actif" }];
}
test("doublonsProbables : ligne manuelle sans ISIN à ±3 % de la somme des autres lignes actives de la même enveloppe et du même titulaire", () => {
  const P = peaType(), somme = P.filter(p => p.id !== "dupont").reduce((a, p) => a + Calc.val(p), 0);
  assert.ok(Math.abs(somme - 51500) < 100, "≈ 51 500 € hors doublon");
  assert.deepEqual(Calc.doublonsProbables(P), [{ ligne: "dupont", nom: "PEA DUPONT", enveloppe: "PEA", titulaire: "p1", valeur: 51230.5, sommeAutres: somme }]);
  // cas négatifs
  assert.deepEqual(Calc.doublonsProbables(P.filter(p => p.id !== "dupont")), [], "une ligne d'espèces de 60 € ne déclenche rien");
  assert.deepEqual(Calc.doublonsProbables(P.map(p => (p.id === "dupont" ? { ...p, value: 60000 } : p))), [], "au-delà de ±3 %");
  assert.deepEqual(Calc.doublonsProbables(P.map(p => (p.id === "dupont" ? { ...p, isin: "FR0000000999" } : p))), [], "ligne avec ISIN");
  assert.deepEqual(Calc.doublonsProbables(P.map(p => (p.id === "dupont" ? { ...p, owner: "p2" } : p))), [], "autre titulaire");
  assert.deepEqual(Calc.doublonsProbables(P.map(p => (p.id === "dupont" ? { ...p, status: "clôturé" } : p))), [], "ligne clôturée");
  assert.deepEqual(Calc.doublonsProbables([P[0], { ...P[14], value: P[0].price }]), [], "au moins deux autres lignes");
  assert.deepEqual(Calc.doublonsProbables(null), []);
});
