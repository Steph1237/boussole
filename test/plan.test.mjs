import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Plan = require("../web/src/plan.js");

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
/* Simulation indépendante, mois par mois : capitalisation puis versement de fin de mois. */
function simule(deja, versement, mois, tauxAnnuel) {
  const r = Math.pow(1 + tauxAnnuel / 100, 1 / 12) - 1;
  let v = deja;
  for (let i = 0; i < mois; i++) v = v * (1 + r) + versement;
  return v;
}
const pos = (bloc, value, extra) => ({ owner: "p1", bloc, mode: "manual", value, status: "actif", ...extra });

describe("constantes", () => {
  test("rendements par poche (central / pessimiste / optimiste)", () => {
    assert.deepEqual(Plan.RENDEMENTS.Monde, { central: 6, pessimiste: 3, optimiste: 8.5 });
    assert.deepEqual(Plan.RENDEMENTS["Nasdaq 2x"], { central: 9, pessimiste: -2, optimiste: 16 });
    assert.deepEqual(Plan.RENDEMENTS.Crypto, { central: 5, pessimiste: -20, optimiste: 25 });
    assert.deepEqual(Plan.RENDEMENTS["Épargne"], { central: 2.4, pessimiste: 1.7, optimiste: 3 });
    assert.deepEqual(Plan.RENDEMENTS._autre, { central: 4, pessimiste: 1.5, optimiste: 6 });
    assert.equal(Object.keys(Plan.RENDEMENTS).filter(k => k !== "Convictions").length, 11);
  });
  test("repères patrimoine net / revenus annuels par tranche d'âge", () => {
    assert.deepEqual(Plan.REPERES_AGE, { u30: 0.5, a30: 1, a40: 3, a50: 6, a60: 8, a70: 10 });
  });
});

describe("mensuel", () => {
  test("annuel ramené au mois, mensuel inchangé, valeurs invalides à 0", () => {
    assert.equal(Plan.mensuel({ montant: 1200, frequence: "an" }), 100);
    assert.equal(Plan.mensuel({ montant: 50, frequence: "mois" }), 50);
    assert.equal(Plan.mensuel({ montant: 50 }), 50);
    assert.equal(Plan.mensuel({ montant: "abc" }), 0);
    assert.equal(Plan.mensuel({ montant: -20 }), 0);
  });
});

describe("budgetTotaux", () => {
  const PROFIL = {
    personnes: { p1: { salaire: 3000, salaireUnite: "nm" }, p2: { salaire: 2000, salaireUnite: "nm" } },
    biens: [],
    credits: [{ id: "c1", owner: "commun", crd: 20000, mensualite: 400 }],
  };
  const LIGNES = [
    { id: "r1", type: "revenu", categorie: "Allocations", montant: 1200, frequence: "an" },
    { id: "d1", type: "depense", categorie: "Logement", montant: 1000, frequence: "mois", owner: "commun" },
    { id: "d2", type: "depense", categorie: "Loisirs", montant: 200, frequence: "mois", owner: "p1" },
    { id: "d3", type: "depense", categorie: "Assurances", montant: 600, frequence: "an", owner: "p2" },
    { id: "e1", type: "epargne", categorie: "Livret", montant: 500, frequence: "mois", owner: "p1" },
  ];

  test("foyer : revenus profil + lignes, mensualités comptées en dépenses", () => {
    const t = Plan.budgetTotaux(LIGNES, PROFIL, "foyer");
    assert.equal(t.revenusProfil, 5000);
    assert.equal(t.revenusLignes, 100);
    assert.equal(t.revenus, 5100);
    assert.equal(t.depensesLignes, 1250);
    assert.equal(t.mensualites, 400);
    assert.equal(t.depenses, 1650);
    assert.equal(t.epargne, 500);
    assert.equal(t.reste, 2950);
    near(t.tauxEpargne, 3450 / 5100);
    assert.deepEqual(t.parCategorie, { Logement: 1000, Loisirs: 200, Assurances: 50, "Crédits": 400 });
  });

  test("périmètre p1 : ses lignes + moitié des lignes communes (sans titulaire = commun)", () => {
    const t = Plan.budgetTotaux(LIGNES, PROFIL, "p1");
    assert.equal(t.revenusProfil, 3000);
    assert.equal(t.revenusLignes, 50);
    assert.equal(t.depensesLignes, 700);
    assert.equal(t.mensualites, 200);
    assert.equal(t.epargne, 500);
    assert.equal(t.reste, 3050 - 900 - 500);
  });

  test("reste négatif : le taux ne compte que l'épargne explicite ; revenus nuls → taux null", () => {
    const t = Plan.budgetTotaux([{ type: "depense", categorie: "X", montant: 6000 }, { type: "epargne", montant: 100 }], PROFIL, "foyer");
    assert.ok(t.reste < 0);
    near(t.tauxEpargne, 100 / 5000);
    const v = Plan.budgetTotaux([], null, "foyer");
    assert.equal(v.revenus, 0);
    assert.equal(v.tauxEpargne, null);
    assert.equal(Plan.budgetTotaux(null, null, "foyer").depenses, 0);
  });
});

describe("effortMensuel et valeurFuture", () => {
  test("taux nul : linéaire", () => {
    near(Plan.effortMensuel(10000, 0, 12, 0), 833.3333333333);
    near(Plan.effortMensuel(10000, 4000, 12, 0), 500);
  });

  test("annuité : forme fermée vérifiée par simulation mois par mois", () => {
    const e = Plan.effortMensuel(60000, 20000, 36, 2.4);
    near(e, 1033.5457125486, 1e-6);
    near(simule(20000, e, 36, 2.4), 60000, 1e-6);
  });

  test("déjà atteint ou atteint par la seule capitalisation → 0 ; aucun mois restant → Infinity", () => {
    assert.equal(Plan.effortMensuel(1000, 2000, 12, 3), 0);
    assert.equal(Plan.effortMensuel(10000, 9900, 120, 6), 0);
    assert.equal(Plan.effortMensuel(1000, 0, 0, 3), Infinity);
    assert.equal(Plan.effortMensuel(1000, 1000, 0, 3), 0);
  });

  test("valeurFuture = simulation, taux nul et taux positif", () => {
    assert.equal(Plan.valeurFuture(1000, 100, 12, 0), 2200);
    near(Plan.valeurFuture(10000, 0, 120, 6), 10000 * 1.06 ** 10, 1e-6);
    near(Plan.valeurFuture(5000, 250, 48, 4), simule(5000, 250, 48, 4), 1e-6);
    near(Plan.valeurFuture(20000, Plan.effortMensuel(60000, 20000, 36, 2.4), 36, 2.4), 60000, 1e-6);
  });
});

describe("moisEntre", () => {
  test("mois entiers, arrondis par défaut, jamais négatifs", () => {
    assert.equal(Plan.moisEntre("2026-10-09", "2029-10-09"), 36);
    assert.equal(Plan.moisEntre("2026-10-09", "2026-11-08"), 0);
    assert.equal(Plan.moisEntre("2026-10-09", "2026-11-09"), 1);
    assert.equal(Plan.moisEntre("2027-01-01", "2026-10-09"), 0);
  });
  test("fin de mois : 31 janvier → 28 février compte un mois ; accepte des Date", () => {
    assert.equal(Plan.moisEntre("2026-01-31", "2026-02-28"), 1);
    assert.equal(Plan.moisEntre(new Date(2026, 9, 9), new Date(2027, 9, 9)), 12);
  });
});

describe("dateAtteinte", () => {
  test("taux nul : 12 versements de 100 pour 1 200 → fin du 12e mois", () => {
    assert.equal(Plan.dateAtteinte(1200, 0, 100, 0, "2026-10-09"), "2027-10-31");
    assert.equal(Plan.dateAtteinte(100, 0, 100, 0, "2026-10-09"), "2026-11-30");
  });
  test("déjà atteint → date de départ ; jamais en 60 ans → null", () => {
    assert.equal(Plan.dateAtteinte(1000, 1000, 0, 0, "2026-10-09"), "2026-10-09");
    assert.equal(Plan.dateAtteinte(1e9, 0, 1, 0, "2026-10-09"), null);
    assert.equal(Plan.dateAtteinte(1000, 0, 0, 5, "2026-10-09"), null);
  });
  test("cohérente avec valeurFuture et moisEntre", () => {
    const d = Plan.dateAtteinte(60000, 20000, 1000, 2.4, "2026-10-09");
    const n = Plan.moisEntre("2026-10-09", d);
    assert.ok(Plan.valeurFuture(20000, 1000, n, 2.4) >= 60000);
    assert.ok(Plan.valeurFuture(20000, 1000, n - 1, 2.4) < 60000);
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  });
  test("au rythme de l'effort requis, la cible est atteinte à la date prévue", () => {
    const e = Plan.effortMensuel(60000, 20000, 36, 2.4);
    assert.equal(Plan.dateAtteinte(60000, 20000, e + 0.01, 2.4, "2026-10-09"), "2029-10-31");
  });
});

describe("dejaObjectif", () => {
  const P = [
    pos("Épargne", 10000, { envelope: "Livrets" }),
    pos("Monde", 5000, { envelope: "PEA" }),
    pos("Europe", 3000, { envelope: "PEA" }),
    pos("Épargne", 2000, { envelope: "LDDS", owner: "p2" }),
    pos("Épargne", 7000, { envelope: "Livrets", status: "à recevoir" }),
    pos("Monde", 0, { envelope: "PEA", mode: "market", qty: 10, price: 100 }),
  ];
  test("saisi : montant de l'objectif", () => {
    assert.equal(Plan.dejaObjectif({ source: "saisi", deja: 4200 }, P, "foyer"), 4200);
    assert.equal(Plan.dejaObjectif({ deja: 300 }, P, "foyer"), 300);
  });
  test("poches : poches ou enveloppes rattachées, sans double compte, périmètre et statut respectés", () => {
    const obj = { source: "poches", poches: ["Épargne"], enveloppes: ["PEA"] };
    assert.equal(Plan.dejaObjectif(obj, P, "foyer"), 10000 + 5000 + 3000 + 2000 + 1000);
    assert.equal(Plan.dejaObjectif(obj, P, "p1"), 10000 + 5000 + 3000 + 1000);
    assert.equal(Plan.dejaObjectif({ source: "poches", poches: ["Europe"] }, P, "foyer"), 3000);
    assert.equal(Plan.dejaObjectif({ source: "poches" }, P, "foyer"), 0);
  });
});

describe("statutObjectif", () => {
  const OBJ = { id: "o1", nom: "Voyage", cible: 12000, deja: 0, source: "saisi", date_cible: "2027-10-09", rendement: 0 };
  const ctx = v => ({ positions: [], scope: "foyer", versementAlloue: v, today: "2026-10-09" });

  test("effort, mois, progression et date d'atteinte", () => {
    const s = Plan.statutObjectif({ ...OBJ, deja: 6000 }, ctx(500));
    assert.equal(s.deja, 6000);
    assert.equal(s.progression, 0.5);
    assert.equal(s.mois, 12);
    near(s.effort, 500);
    assert.equal(s.versementAlloue, 500);
    assert.equal(s.atteinte, "2027-10-31");
  });

  test("avance / dans les temps / retard selon le versement alloué", () => {
    assert.equal(Plan.statutObjectif(OBJ, ctx(1200)).statut, "avance");
    assert.equal(Plan.statutObjectif(OBJ, ctx(1100)).statut, "avance");
    assert.equal(Plan.statutObjectif(OBJ, ctx(1000)).statut, "dans_les_temps");
    assert.equal(Plan.statutObjectif(OBJ, ctx(950)).statut, "dans_les_temps");
    assert.equal(Plan.statutObjectif(OBJ, ctx(900)).statut, "retard");
    assert.equal(Plan.statutObjectif(OBJ, ctx(0)).atteinte, null);
  });

  test("atteint dès que le déjà-épargné couvre la cible ; date passée non atteinte → hors de portée", () => {
    const a = Plan.statutObjectif({ ...OBJ, deja: 15000 }, ctx(0));
    assert.equal(a.statut, "atteint");
    assert.equal(a.progression, 1);
    assert.equal(a.effort, 0);
    assert.equal(Plan.statutObjectif({ ...OBJ, date_cible: "2026-06-30" }, ctx(5000)).statut, "hors_portee");
  });

  test("forme du store : dateCible (camelCase) acceptée comme date_cible", () => {
    const { date_cible, ...o } = OBJ;
    const s = Plan.statutObjectif({ ...o, dateCible: date_cible }, ctx(1000));
    assert.equal(s.mois, 12);
    assert.equal(s.statut, "dans_les_temps");
  });

  test("déjà-épargné rattaché aux poches du Pilotage", () => {
    const s = Plan.statutObjectif({ ...OBJ, source: "poches", poches: ["Épargne"] },
      { ...ctx(500), positions: [pos("Épargne", 6000)] });
    assert.equal(s.deja, 6000);
    assert.equal(s.statut, "dans_les_temps");
  });
});

describe("repartirEpargne", () => {
  const T = { positions: [], scope: "foyer", today: "2026-10-09" };
  const O = [
    { id: "A", cible: 3600, deja: 0, date_cible: "2027-10-09", rendement: 0, priorite: 2 },  // effort 300
    { id: "B", cible: 6000, deja: 0, date_cible: "2027-10-09", rendement: 0, priorite: 1 },  // effort 500
    { id: "C", cible: 9600, deja: 0, date_cible: "2028-10-09", rendement: 0, priorite: 1 },  // effort 400
  ];
  test("priorité croissante puis date la plus proche ; le dernier prend ce qui reste", () => {
    assert.deepEqual(Plan.repartirEpargne(O, 1000, T), { B: 500, C: 400, A: 100 });
    assert.deepEqual(Plan.repartirEpargne(O, 300, T), { B: 300, C: 0, A: 0 });
  });
  test("surplus versé au dernier objectif ; épargne nulle ou négative → 0 partout", () => {
    assert.deepEqual(Plan.repartirEpargne(O, 2000, T), { B: 500, C: 400, A: 1100 });
    assert.deepEqual(Plan.repartirEpargne(O, -50, T), { B: 0, C: 0, A: 0 });
    assert.deepEqual(Plan.repartirEpargne([], 1000, T), {});
  });
  test("un objectif déjà atteint ne reçoit rien, le surplus va au dernier objectif en cours", () => {
    const r = Plan.repartirEpargne([...O, { id: "D", cible: 100, deja: 500, date_cible: "2029-01-01", priorite: 3 }], 2000, T);
    assert.deepEqual(r, { B: 500, C: 400, A: 1100, D: 0 });
  });
});

describe("projection", () => {
  const T = "2026-10-09";
  test("une poche, sans versement : intérêts composés aux trois taux", () => {
    const p = Plan.projection({ positions: [pos("Monde", 10000)], scope: "foyer", versementMensuel: 0, annees: 10, today: T });
    assert.deepEqual(p.annees, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(p.central[0], 10000);
    assert.equal(p.central[10], Math.round(10000 * 1.06 ** 10));
    assert.equal(p.pessimiste[10], Math.round(10000 * 1.03 ** 10));
    assert.equal(p.optimiste[10], Math.round(10000 * 1.085 ** 10));
  });
  test("versements mensuels capitalisés comme valeurFuture", () => {
    const p = Plan.projection({ positions: [pos("Monde", 10000)], scope: "foyer", versementMensuel: 100, annees: 5, today: T });
    assert.equal(p.central[5], Math.round(simule(10000, 100, 60, 6)));
    assert.equal(p.pessimiste[3], Math.round(simule(10000, 100, 36, 3)));
  });
  test("versement réparti au prorata des poches, chacune à son taux", () => {
    const P = [pos("Monde", 7500), pos("Épargne", 2500)];
    const p = Plan.projection({ positions: P, scope: "foyer", versementMensuel: 100, annees: 8, today: T });
    assert.equal(p.central[8], Math.round(simule(7500, 75, 96, 6) + simule(2500, 25, 96, 2.4)));
    assert.equal(p.parBloc.Monde.capital, 7500);
    near(p.parBloc.Monde.poids, 0.75);
    assert.equal(p.parBloc["Épargne"].central[8], Math.round(simule(2500, 25, 96, 2.4)));
  });
  test("sans position : tout le versement en « autre » ; périmètre et statuts respectés ; 30 ans par défaut", () => {
    const vide = Plan.projection({ positions: [], scope: "foyer", versementMensuel: 100, today: T });
    assert.equal(vide.annees.length, 31);
    assert.equal(vide.central[1], Math.round(simule(0, 100, 12, 4)));
    const P = [pos("Monde", 10000), pos("SCPI", 5000, { owner: "p2" }), pos("Crypto", 9000, { status: "à recevoir" })];
    const p1 = Plan.projection({ positions: P, scope: "p1", versementMensuel: 0, annees: 1, today: T });
    assert.equal(p1.central[0], 10000);
    assert.deepEqual(Object.keys(p1.parBloc), ["Monde"]);
  });
  test("rendements personnalisés et poche inconnue → taux « autre »", () => {
    const R = { ...Plan.RENDEMENTS, Monde: { central: 0, pessimiste: 0, optimiste: 0 } };
    const p = Plan.projection({ positions: [pos("Monde", 1000), pos("Bizarre", 1000)], scope: "foyer", versementMensuel: 0, annees: 2, rendements: R, today: T });
    assert.equal(p.central[2], Math.round(1000 + 1000 * 1.04 ** 2));
  });
});

describe("score", () => {
  const PROFIL = { foyer: { age: "a40" }, personnes: { p1: { salaire: 4000, salaireUnite: "nm" } }, biens: [], credits: [] };
  const LIGNES = [{ type: "depense", categorie: "Vie courante", montant: 2000, frequence: "mois" }];
  const dix = (blocs) => Array.from({ length: 10 }, (_, i) => pos(blocs[i % blocs.length], 1000));
  const run = (o) => Plan.score({ positions: [], profil: PROFIL, config: null, budget: LIGNES, scope: "foyer", today: "2026-10-09", ...o });
  const item = (o, cle) => run(o).items.find(i => i.cle === cle);

  test("cinq critères dans l'ordre, sur 20 chacun, avec texte et piste", () => {
    const s = run({ positions: dix(["Épargne"]) });
    assert.deepEqual(s.items.map(i => i.cle), ["matelas", "epargne", "endettement", "concentration", "patrimoine"]);
    for (const i of s.items) {
      assert.equal(i.sur, 20);
      assert.equal(typeof i.titre, "string");
      assert.ok(i.texte.length > 5 && i.piste.length > 5, i.cle);
      assert.ok(Number.isInteger(i.points) && i.points >= 0 && i.points <= 20, i.cle);
    }
  });

  test("matelas : bornes 1, 3, 6, 12 mois de dépenses", () => {
    const pts = mois => item({ positions: [pos("Épargne", mois * 2000)] }, "matelas").points;
    assert.equal(pts(0.5), 0);
    assert.equal(pts(1), 5);
    assert.equal(pts(2), 10);
    assert.equal(pts(3), 20);
    assert.equal(pts(6), 20);
    assert.equal(pts(12), 15);
    assert.equal(pts(30), 15);
    const m = item({ positions: [pos("Épargne", 8400)] }, "matelas");
    near(m.valeur, 4.2);
    assert.match(m.texte, /4,2 mois/);
  });

  test("matelas : budget sans dépense → à compléter, sauf dépenses déclarées dans le matelas en mois", () => {
    const a = item({ budget: [], positions: [pos("Épargne", 8000)] }, "matelas");
    assert.equal(a.aCompleter, true);
    assert.equal(a.points, 0);
    const b = item({ budget: [], positions: [pos("Épargne", 8000)], config: { cushion: { mode: "months", months: 4, depenses: 2000 } } }, "matelas");
    assert.equal(b.aCompleter, false);
    assert.equal(b.valeur, 4);
  });

  test("taux d'épargne : 20 % → 20, 15 % → 16, 10 % → 12, 5 % → 6, 0 → 0, interpolé", () => {
    const pts = dep => item({ budget: [{ type: "depense", categorie: "X", montant: dep }] }, "epargne").points;
    assert.equal(pts(3200), 20);
    assert.equal(pts(2000), 20);
    assert.equal(pts(3400), 16);
    assert.equal(pts(3600), 12);
    assert.equal(pts(3500), 14);
    assert.equal(pts(3800), 6);
    assert.equal(pts(4000), 0);
    assert.equal(pts(4400), 0);
    assert.equal(item({ budget: [] }, "epargne").aCompleter, true);
  });

  test("endettement : 25 % → 20, 35 % → 12, 45 % → 0, interpolé ; sans crédit → 20", () => {
    const pts = m => item({ profil: { ...PROFIL, credits: [{ owner: "p1", crd: 1e5, mensualite: m }] } }, "endettement").points;
    assert.equal(pts(0), 20);
    assert.equal(pts(1000), 20);
    assert.equal(pts(1200), 16);
    assert.equal(pts(1400), 12);
    assert.equal(pts(1800), 0);
    assert.equal(pts(2400), 0);
    assert.equal(item({ profil: { foyer: { age: "a40" } }, budget: LIGNES }, "endettement").aCompleter, true);
  });

  test("concentration : poids de la plus grosse ligne, malus de 5 sous 3 poches", () => {
    const pts = P => item({ positions: P }, "concentration").points;
    assert.equal(pts(dix(["Monde", "Europe", "Asie"])), 20);
    assert.equal(pts([pos("Monde", 2000), ...Array.from({ length: 8 }, (_, i) => pos(["Europe", "Asie", "SCPI"][i % 3], 1000))]), 14);
    assert.equal(pts([pos("Monde", 4000), ...Array.from({ length: 6 }, (_, i) => pos(["Europe", "Asie"][i % 2], 1000))]), 0);
    assert.equal(pts(dix(["Monde", "Europe"])), 15);
    assert.equal(pts([pos("Monde", 4000), pos("Europe", 6000)]), 0);
    assert.equal(item({ positions: [] }, "concentration").aCompleter, true);
  });

  test("patrimoine net / revenus annuels comparé au repère d'âge", () => {
    const pts = (net, age = "a40") => item({ positions: net ? [pos("Monde", net)] : [], profil: { ...PROFIL, foyer: { age } } }, "patrimoine").points;
    assert.equal(pts(144000), 20);
    assert.equal(pts(300000), 20);
    assert.equal(pts(72000), 10);
    assert.equal(pts(0), 0);
    assert.equal(pts(24000, "u30"), 20);
    const neg = item({ profil: { ...PROFIL, credits: [{ owner: "p1", crd: 50000, mensualite: 0 }] } }, "patrimoine");
    assert.equal(neg.points, 0);
    assert.equal(item({ profil: { ...PROFIL, foyer: {} } }, "patrimoine").aCompleter, true);
  });

  test("total sur 100 ; items à compléter exclus et total ramené sur 100", () => {
    const P = [pos("Épargne", 8000), pos("Monde", 30000), pos("Europe", 30000), pos("Asie", 30000), pos("SCPI", 30000), pos("Obligations", 22000)];
    const plein = run({ positions: P, budget: [{ type: "depense", categorie: "X", montant: 2000 }, { type: "epargne", montant: 800 }] });
    // matelas 4 mois → 20 ; épargne 50 % → 20 ; endettement 0 → 20 ; concentration max 30000/150000 = 20 % → 14 ; patrimoine 150000/48000 ≥ 3 → 20
    assert.equal(plein.complet, true);
    assert.equal(plein.total, Math.round((20 + 20 + 20 + 14 + 20) / 100 * 100));
    // sans position ni âge : matelas 0, épargne 20, endettement 20 ; concentration et patrimoine à compléter
    const partiel = run({ positions: [], profil: { ...PROFIL, foyer: {} } });
    assert.equal(partiel.complet, false);
    assert.deepEqual(partiel.items.filter(i => i.aCompleter).map(i => i.cle), ["concentration", "patrimoine"]);
    assert.equal(partiel.total, Math.round(40 / 60 * 100));
    assert.equal(run({ positions: [], profil: null, budget: [] }).total, 0);
  });

  test("budget accepté sous forme { lignes } ; périmètre p1", () => {
    const s = run({ budget: { lignes: LIGNES }, positions: [pos("Épargne", 6000), pos("Épargne", 50000, { owner: "p2" })], scope: "p1" });
    near(s.items[0].valeur, 6); // dépense commune comptée pour moitié : 6000 / 1000
  });
});

test("affecterDeja : une poche partagée sert les objectifs en cascade, par priorité", () => {
  const pos = [
    { owner: "p1", bloc: "Épargne", envelope: "Livrets", mode: "manual", value: 27400, status: "actif" },
    { owner: "p1", bloc: "Monde", envelope: "PEA", mode: "manual", value: 10000, status: "actif" },
  ];
  const obj = [
    { id: "apport", priorite: 2, cible: 60000, source: "poches", poches: ["Épargne"], enveloppes: [] },
    { id: "matelas", priorite: 1, cible: 21100, source: "poches", poches: ["Épargne"], enveloppes: [] },
    { id: "retraite", priorite: 3, cible: 400000, source: "poches", poches: ["Monde"], enveloppes: [] },
    { id: "voyage", priorite: 4, cible: 5000, source: "saisi", deja: 1200 },
  ];
  const d = Plan.affecterDeja(obj, pos, "foyer");
  assert.equal(d.matelas, 21100);
  assert.equal(d.apport, 6300);
  assert.equal(d.retraite, 10000);
  assert.equal(d.voyage, 1200);
});

test("capacité d'épargne : épargne prévue + reste positif (même règle que le taux d'épargne et le connecteur)", () => {
  assert.equal(Plan.capaciteEpargne({ epargne: 650, reste: 928 }), 1578);
  assert.equal(Plan.capaciteEpargne({ epargne: 650, reste: -200 }), 650);
  assert.equal(Plan.capaciteEpargne(null), 0);
});
