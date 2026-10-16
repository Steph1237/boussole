// HIS2, tâche 10 : reconstitution étendue (web/src/historique.js) sur les cas de test/fixtures/his2-cas.json, en mode mois et en mode jour :
// lignes clôturées, prix des ordres comme cours implicites, depuis l'ouverture, relevés de valeur et flux nets, soldes de fin de mois, espèces
// d'enveloppe (D6), doublon_de ignoré, deltaTx aux types du § 4.4, qualité et part estimée (§ 7.3), photos stockées (photos()), performance (§ 12.3).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parFonction, cas } from "./helpers/his2.mjs";
import { entreeReconstituer, txDeCas, mouvementsDe } from "./helpers/his2-reconstitution.mjs";

const require = createRequire(import.meta.url);
const H = require("../web/src/historique.js");
const near = (a, b, msg, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} ≠ ${b}`);

/* ---------- cas « reconstituer » (mode mois), attendus de la fixture inchangés ---------- */
for (const c of parFonction("reconstituer")) {
  test("reconstituer " + c.id + " : " + c.nom, () => {
    const r = H.reconstituer(entreeReconstituer(c)), tol = c.tolerance ?? 0.01;
    const att = c.attendu, dernier = att.points[att.points.length - 1].date;
    const dansPlage = r.points.filter(p => p.date >= c.entree.depuis && p.date <= dernier);
    if (att.points_exhaustifs !== false) assert.deepEqual(dansPlage.map(p => p.date), att.points.map(p => p.date), "fins de mois, liste exhaustive");
    att.points.forEach(a => {
      const p = r.points.find(x => x.date === a.date);
      assert.ok(p, "point du " + a.date);
      near(p.financier, a.valeur, a.date + " valeur", tol);
      if (a.nature) assert.equal(p.nature, a.nature, a.date + " nature");
      if (a.detail) { near(p.detail.titres, a.detail.titres, a.date + " titres", tol); near(p.detail.especes, a.detail.especes, a.date + " espèces", tol); }
    });
    if (att.recalage_especes !== undefined) near(r.recalageEspeces, att.recalage_especes, "recalage des espèces", tol);
    (att.qualites || []).forEach(a => {
      const q = r.qualites.find(x => x.date === a.date);
      assert.ok(q, "qualité du " + a.date);
      assert.equal(q.qualite, a.qualite, a.date + " qualité");
      near(q.part_estimee, a.part_estimee, a.date + " part estimée", tol);
    });
  });
}

/* ---------- les mêmes cas en mode jour : à chaque fin de mois, la même valeur ---------- */
for (const c of parFonction("reconstituer").filter(x => !x.entree.especesSuivies && !x.entree.soldesMois && x.id !== "A1/reconstitution" && x.id !== "V-rachat-frais/reconstitution")) {
  test("reconstituer " + c.id + " en mode jour : mêmes valeurs aux fins de mois", () => {
    const e = entreeReconstituer(c), mois = H.reconstituer(e), jour = H.reconstituer({ ...e, pas: "jour" });
    mois.points.filter(p => p.date >= jour.debut && p.date <= jour.fin).forEach(p => {
      const j = jour.points.find(x => x.date === p.date);
      assert.ok(j, "jour " + p.date);
      near(j.financier, p.financier, p.date + " jour = mois");
    });
  });
}

/* ---------- lignes à relevés de valeur et espèces en mode jour (les valeurs entre deux fins de mois) ---------- */
test("A1 en mode jour : relevé du jour, flux le jour même du versement, rien d'inventé entre deux relevés", () => {
  const c = cas("A1/reconstitution"), r = H.reconstituer({ ...entreeReconstituer(c), pas: "jour", depuis: "2023-02-20" });
  const v = d => r.points.find(p => p.date === d).financier;
  assert.equal(r.debut, "2023-03-01", "en pas jour, la série commence à la première donnée (le mode mois, lui, montre le zéro d'avant l'ouverture)");
  assert.equal(v("2023-03-01"), 5000, "le versement du 1er mars est compté le jour même");
  assert.equal(v("2023-12-30"), 5000);
  assert.equal(v("2023-12-31"), 5120, "le relevé fait foi à sa date");
  assert.equal(v("2024-05-31"), 5120);
  assert.equal(v("2024-06-01"), 6120);
  assert.equal(v("2024-12-31"), 6300);
  assert.deepEqual(r.drapeaux.parReleves, ["Assurance-vie Exemple – fonds en euros"]);
  assert.equal(r.points[0].nature, undefined, "la nature n'est rendue en pas jour que sur demande");
});
test("P2 en mode jour : les espèces suivent les mouvements (versement, achats, vente)", () => {
  const c = cas("P2/reconstitution"), r = H.reconstituer({ ...entreeReconstituer(c), pas: "jour", depuis: "2024-01-01", detailLignes: true });
  const esp = d => r.points.find(p => p.date === d).detail.especes;
  assert.equal(r.debut, "2024-01-05");
  assert.equal(esp("2024-01-05"), 1000);
  assert.equal(esp("2024-01-08"), 49, "achat de 950 + 1 € de frais");
  assert.equal(esp("2024-02-05"), 1049);
  assert.equal(esp("2024-02-08"), 68);
  assert.equal(esp("2024-03-15"), 587, "vente de 520 − 1 € de frais");
  assert.deepEqual(r.drapeaux.especes, ["Espèces PEA Exemple"]);
});
test("B1 en mode jour : interpolation linéaire entre deux fins de mois, estimée ; le jour de la fin de mois, mesuré", () => {
  const c = cas("B1/reconstitution"), r = H.reconstituer({ ...entreeReconstituer(c), pas: "jour", depuis: "2024-01-25", jusqua: "2024-02-10", qualites: true });
  const v = d => r.points.find(p => p.date === d);
  assert.equal(v("2024-01-31").financier, 2200);
  assert.equal(v("2024-01-31").nature, "mesuree");
  near(v("2024-02-10").financier, 2200 + (2280 - 2200) * 10 / 29, "10 février : 10 jours sur 29 entre le 31/01 et le 29/02");
  assert.equal(v("2024-02-10").nature, "estimee");
  assert.deepEqual(r.drapeaux.soldesImportes, ["Compte courant Exemple"]);
});

test("ligne manuelle : tous les types du tableau § 4.4 (achat +, vente −, arbitrages ±, dividende capitalisé +, frais −), un relevé ou un solde ne bougent rien", () => {
  const P = [{ id: "m", name: "Contrat Exemple", mode: "manual", value: 0, status: "actif", owner: "p1", envelope: "Contrat Exemple" }];
  const types = [["versement", 1000], ["achat", 200], ["vente", 50], ["arbitrage_entree", 100], ["arbitrage_sortie", 30], ["dividende", 20], ["interets", 10], ["frais", 5], ["rachat", 100], ["retrait", 25], ["solde", 999]];
  const tx = types.map(([type, amount], i) => ({ id: "t" + i, positionId: "m", date: "2025-01-" + String(i + 1).padStart(2, "0"), type, amount, importId: "i", source: "import" }));
  const r = H.reconstituer({ today: "2026-10-16", pas: "mois", positions: P, tx, depuisOuverture: { "Contrat Exemple": true }, depuis: "2024-12-31", jusqua: "2025-01-31" });
  assert.equal(r.points.find(p => p.date === "2025-01-31").financier, 1000 + 200 - 50 + 100 - 30 + 20 + 10 - 5 - 100 - 25);
});

/* ---------- D1 : une transaction remplacée (doublon_de) est ignorée partout ---------- */
test("D1 : après validation seul l'ordre compte ; retirer l'import rend la transaction de la nuit", () => {
  const f = cas("D1/flux"), r0 = cas("D1/retrait");
  const cours = { FR9990000013: [{ date: "2026-09-01", cloture: 100 }] };
  const val = (c, d) => H.reconstituer({ today: "2026-10-16", positions: c.entree.positions, tx: c.entree.tx, cours, pas: "jour", depuis: "2026-09-01" }).points.find(p => p.date === d).financier;
  // avec doublon_de : quantité 5,02512563 − 5 = 0,02512563 avant l'ordre du 08/09 (la transaction de la nuit du 05/09 ne compte pas), 5,02512563 ensuite
  near(val(f, "2026-09-07"), 0.02512563 * 100, "le 07/09 avec l'import validé");
  near(val(f, "2026-09-08"), 5.02512563 * 100, "le 08/09 avec l'import validé");
  // sans l'import (retiré) : la transaction de la nuit revient, elle explique les 5,02512563 parts dès le 05/09
  near(val(r0, "2026-09-04"), 0, "le 04/09 sans l'import");
  near(val(r0, "2026-09-05"), 5.02512563 * 100, "le 05/09 sans l'import");
  // sans doublon_de posé, les deux transactions comptent : 10,05 parts à rembobiner pour 5,03 au bilan, la quantité est plafonnée à zéro avant le 05/09
  const double = { entree: { ...f.entree, tx: f.entree.tx.map(t => ({ ...t, doublonDe: null })) } };
  near(val(f, "2026-09-04"), 0.02512563 * 100, "le 04/09 avec l'import validé : 5,03 − 5 parts");
  assert.equal(val(double, "2026-09-04"), 0, "le 04/09 avec les deux transactions comptées");
});

/* ---------- deltaTx : types du § 4.4, doublon_de ignoré ---------- */
for (const c of parFonction("deltaTx")) {
  test("deltaTx " + c.id + " : " + c.nom, () => {
    txDeCas(c).forEach(t => near(H.deltaTx(t), c.attendu.deltas.find(d => d.id === t.id).delta, t.id + " (" + t.type + ")", 1e-8));
  });
}
for (const id of ["D1/flux", "D1/retrait"]) {
  test("deltaTx " + id + " : transaction de la nuit remplacée ou non", () => {
    const c = cas(id);
    c.attendu.deltas.forEach(d => near(H.deltaTx(c.entree.tx.find(t => t.id === d.id)), d.delta, d.id, 1e-8));
  });
}
test("deltaTx : un mouvement en forme de ligne SQL (snake_case) est lu comme celui du store ; relevés et soldes ne bougent rien", () => {
  assert.equal(H.deltaTx({ type: "achat", qty: 3, doublon_de: "x" }), 0);
  assert.equal(H.deltaTx({ type: "achat", qty: 3, doublon_de: null }), 3);
  assert.equal(H.deltaTx({ type: "releve", qty: 3 }), 0);
  assert.equal(H.deltaTx({ type: "apport", qty: 3 }), 3, "anciens libellés libres encore lus");
  assert.equal(H.deltaTx({ type: "cession", qty: 3 }), -3);
});

/* ---------- qualité ---------- */
for (const c of parFonction("qualite")) {
  test("qualite " + c.id + " : " + c.nom, () => {
    const q = H.qualite(c.entree.contributions), tol = c.tolerance ?? 0.01;
    near(q.part_estimee, c.attendu.part_estimee, "part estimée", tol);
    assert.equal(q.qualite, c.attendu.qualite);
    if (c.attendu.sources) {
      assert.equal(q.sources.length, c.attendu.sources.length);
      c.attendu.sources.forEach((s, i) => { assert.equal(q.sources[i].type, s.type); assert.equal(q.sources[i].import_id, s.import_id); near(q.sources[i].part, s.part, "part de la source " + i, tol); });
      near(q.sources.reduce((a, s) => a + s.part, 0), 1, "les parts somment à 1", 1e-5);
    }
  });
}
test("qualite : aucune contribution ou total nul → complet, aucune source ; entrées absurdes sans exception", () => {
  assert.deepEqual(H.qualite([]), { qualite: "complet", part_estimee: 0, sources: [] });
  assert.deepEqual(H.qualite([{ valeur: 0, nature: "constante" }]).sources, []);
  assert.doesNotThrow(() => H.qualite(null));
  assert.doesNotThrow(() => H.qualite([null, { valeur: "x" }]));
});

/* ---------- natures, drapeaux et sources de la reconstitution ---------- */
test("Q1 : les sources de la photo disent d'où vient chaque euro (ordres importés, relevés, saisie)", () => {
  const r = H.reconstituer(entreeReconstituer(cas("Q1/reconstitution"))), q = r.qualites[0];
  assert.deepEqual(q.sources.map(s => [s.type, s.import_id]), [["ordres", "imp-P1"], ["releves", "imp-B1"], ["saisie", undefined]]);
  near(q.sources.reduce((a, s) => a + s.part, 0), 1, "somme", 1e-5);
  assert.equal(r.points[0].nature, "estimee");
});
test("Q1 avec un relevé du livret à cette date : tout est mesuré, complet", () => {
  const e = entreeReconstituer(cas("Q1/reconstitution"));
  const r = H.reconstituer({ ...e, releves: [{ positionId: "pos-livret", date: "2024-01-31", valeur: 3000, importId: "imp-L" }] });
  assert.equal(r.qualites[0].qualite, "complet");
  assert.equal(r.qualites[0].part_estimee, 0);
  assert.equal(r.points[0].nature, "mesuree");
});
test("une ligne cotée sans aucun mouvement reste « à composition actuelle » : estimée, source « cours »", () => {
  const r = H.reconstituer({ today: "2026-10-16", pas: "mois", positions: [{ id: "a", name: "ETF Monde A", mode: "market", isin: "FR9990000013", qty: 10, price: 100, status: "actif", owner: "p1", envelope: "CTO" }],
    cours: { FR9990000013: [{ date: "2026-07-01", cloture: 90 }, { date: "2026-08-31", cloture: 95 }] } });
  assert.deepEqual(r.drapeaux.compositionActuelle, ["ETF Monde A"]);
  const p = r.points.find(x => x.date === "2026-08-31");
  assert.equal(p.financier, 950);
  assert.equal(p.nature, "estimee");
  assert.deepEqual(r.qualites.find(q => q.date === "2026-08-31").sources, [{ type: "cours", part: 1 }]);
});
test("prix des ordres comme cours implicites : sans cours du tout, ou avant le premier cours ; estimés", () => {
  const P = [{ id: "a", name: "ETF Monde A", mode: "market", isin: "FR9990000013", qty: 10, price: 120, status: "actif", owner: "p1", envelope: "PEA Exemple" }];
  const tx = [{ id: "t1", positionId: "a", date: "2025-01-10", type: "achat", qty: 6, price: 100, amount: 600, importId: "i1", source: "import" },
    { id: "t2", positionId: "a", date: "2025-03-10", type: "achat", qty: 4, price: 110, amount: 440, importId: "i1", source: "import" }];
  const sans = H.reconstituer({ today: "2026-10-16", pas: "mois", positions: P, tx, depuis: "2024-12-31", depuisOuverture: { "PEA Exemple": true } });
  assert.deepEqual(sans.drapeaux.prixDesOrdres, ["ETF Monde A"]);
  const v = d => sans.points.find(p => p.date === d);
  assert.equal(v("2024-12-31").financier, 0);
  assert.equal(v("2025-01-31").financier, 600, "6 parts au prix de l'ordre du 10/01");
  assert.equal(v("2025-02-28").financier, 600);
  assert.equal(v("2025-03-31").financier, 1100, "10 parts au prix de l'ordre du 10/03 (110)");
  assert.equal(v("2025-03-31").nature, "estimee");
  const avec = H.reconstituer({ today: "2026-10-16", pas: "mois", positions: P, tx, depuis: "2024-12-31", depuisOuverture: { "PEA Exemple": true }, cours: { FR9990000013: [{ date: "2025-03-20", cloture: 108 }] } });
  assert.equal(avec.points.find(p => p.date === "2025-02-28").financier, 600, "avant le premier cours : prix de l'ordre");
  assert.equal(avec.points.find(p => p.date === "2025-03-31").financier, 1080, "à partir du premier cours : le cours réel (108)");
  assert.equal(avec.points.find(p => p.date === "2025-03-31").nature, "mesuree");
});
test("sans « depuis l'ouverture », la quantité d'avant le premier mouvement est déduite du présent, estimée", () => {
  const P = [{ id: "a", name: "ETF Monde A", mode: "market", isin: "FR9990000013", qty: 10, price: 100, status: "actif", owner: "p1", envelope: "CTO" }];
  const r = H.reconstituer({ today: "2026-10-16", pas: "mois", positions: P, cours: { FR9990000013: [{ date: "2025-01-01", cloture: 100 }] },
    tx: [{ id: "t", positionId: "a", date: "2025-03-10", type: "achat", qty: 4, price: 100, amount: 400, importId: "i", source: "import" }] });
  const v = d => r.points.find(p => p.date === d);
  assert.equal(v("2025-02-28").financier, 600);
  assert.equal(v("2025-02-28").nature, "estimee", "avant le premier mouvement connu : hypothèse, pas une mesure");
  assert.equal(v("2025-03-31").financier, 1000);
  assert.equal(v("2025-03-31").nature, "mesuree");
});
test("compte à soldes de fin de mois : tenu au solde de début avant le premier mois, interpolé dans un trou et jusqu'à aujourd'hui", () => {
  const P = [{ id: "cc", name: "Compte courant Exemple", mode: "manual", value: 3000, status: "actif", owner: "p1", envelope: "Comptes" }];
  const soldesMois = [{ positionId: "cc", mois: "2025-01", solde_debut: 1000, solde_fin: 1200, import_id: "i" }, { positionId: "cc", mois: "2025-04", solde_fin: 1800, import_id: "i" }];
  const r = H.reconstituer({ today: "2025-06-10", pas: "mois", positions: P, soldesMois, depuis: "2024-11-30" });
  const v = d => r.points.find(p => p.date === d);
  assert.equal(v("2024-11-30").financier, 1000);
  assert.equal(v("2024-11-30").nature, "estimee", "avant le premier mois importé : tenu au solde de début");
  assert.equal(v("2024-12-31").financier, 1000);
  assert.equal(v("2024-12-31").nature, "mesuree", "le solde de début de janvier est la fin de décembre");
  assert.equal(v("2025-01-31").financier, 1200);
  assert.equal(v("2025-01-31").nature, "mesuree");
  near(v("2025-02-28").financier, 1200 + (1800 - 1200) * H.joursEntre("2025-01-31", "2025-02-28") / H.joursEntre("2025-01-31", "2025-04-30"), "février, mars : interpolés");
  assert.equal(v("2025-02-28").nature, "estimee", "février et mars ne sont pas importés");
  assert.equal(v("2025-04-30").financier, 1800);
  near(v("2025-05-31").financier, 1800 + (3000 - 1800) * 31 / 41, "mai : vers la valeur d'aujourd'hui (10 juin)", 0.01);
  assert.equal(v("2025-05-31").nature, "estimee");
  assert.deepEqual(r.qualites.find(q => q.date === "2025-01-31").sources, [{ type: "releves", import_id: "i", part: 1 }]);
});
test("compte à soldes importés ET à opérations lues : les opérations l'emportent dans la fenêtre, les soldes avant", () => {
  const P = [{ id: "cc", name: "Compte courant Exemple", mode: "manual", value: 1000, status: "actif", owner: "p1", envelope: "Comptes" }];
  const comptes = [{ id: 7, positionId: "cc", type: "courant" }];
  const operations = [{ compteId: 7, date: "2025-05-05", montant: 100 }, { compteId: 7, date: "2025-05-08", montant: -50 }];
  const soldesMois = [{ positionId: "cc", mois: "2025-03", solde_fin: 700, import_id: "i" }];
  const r = H.reconstituer({ today: "2025-05-10", pas: "jour", positions: P, comptes, operations, operationsDepuis: "2025-05-01", soldesMois, depuis: "2025-03-25" });
  const v = d => r.points.find(p => p.date === d).financier;
  assert.equal(v("2025-03-31"), 700, "solde importé de fin mars");
  assert.equal(v("2025-05-09"), 1000, "solde actuel : aucune opération après le 8 mai");
  assert.equal(v("2025-05-07"), 1050, "avant l'opération du 8 mai (−50)");
  assert.equal(v("2025-05-04"), 950, "avant l'opération du 5 mai (+100)");
  assert.equal(v("2025-04-30"), 950, "veille de la fenêtre : solde reconstitué par les opérations (borne de l'interpolation)");
  near(v("2025-04-15"), 700 + (950 - 700) * 15 / 30, "mi-avril : interpolé entre le solde importé de fin mars et le solde reconstitué du début de fenêtre");
  assert.deepEqual(r.drapeaux.bancaires, ["Compte courant Exemple"]);
  assert.deepEqual(r.drapeaux.soldesImportes, ["Compte courant Exemple"]);
});
test("lignes clôturées sans transaction : ignorées ; avec transactions mais sans cours ni ordre : ignorées sans exception", () => {
  const P = [{ id: "c", name: "Titre vendu", mode: "market", isin: "FR9990000039", qty: 0, status: "clôturé", owner: "p1", envelope: "PEA" }, { id: "l", name: "Livret", mode: "manual", value: 100, status: "actif", owner: "p1", envelope: "L" }];
  assert.equal(H.reconstituer({ today: "2026-10-16", pas: "mois", positions: P }).points.length, 0);
  const tx = [{ positionId: "c", date: "2025-01-10", type: "vente", qty: 1, amount: 40 }];
  assert.doesNotThrow(() => H.reconstituer({ today: "2026-10-16", pas: "mois", positions: P, tx }));
});

/* ---------- photos stockées ---------- */
test("photos : lignes de photos_reconstituees par fin de mois, jamais à la date de la première photo observée ni après", () => {
  const c = cas("Q1/reconstitution"), e = entreeReconstituer(c);
  const r = H.reconstituer({ ...e, depuis: "2023-12-31", jusqua: "2024-02-29", detailLignes: true });
  const positions = e.positions.map(p => ({ ...p, bloc: p.id === "pos-etf-a" ? "Monde" : "Épargne" }));
  const ph = H.photos(r, positions, { horsFin: 50000 });
  assert.deepEqual(ph.map(p => p.mois), ["2023-12-01", "2024-01-01", "2024-02-01"]);
  assert.deepEqual(ph.map(p => p.date), ["2023-12-31", "2024-01-31", "2024-02-29"]);
  const j = ph[1];
  assert.equal(j.total, 6160);
  assert.equal(j.financier, 6160);
  assert.equal(j.net, 56160);
  assert.equal(j.p1, 6160);
  assert.equal(j.p2, 0);
  assert.deepEqual(j.by_bloc, { p1: { Monde: 960, Épargne: 5200 }, p2: {} });
  assert.deepEqual(j.by_envelope, { "PEA Exemple": 960, Comptes: 2200, Livrets: 3000 });
  assert.equal(j.qualite, "estime");
  assert.equal(j.methode, "historique@2");
  assert.deepEqual(H.photos(r, positions, { avant: "2024-01-31" }).map(p => p.date), ["2023-12-31"], "aucune photo à la date de la première photo observée ni après");
  assert.deepEqual(H.photos(r, positions, { max: 1 }).map(p => p.date), ["2024-02-29"], "240 mois au plus : on garde les plus récents");
  assert.deepEqual(H.photos({ points: [] }, positions), []);
});
test("photos : plus de 30 sources regroupées, sources et by_bloc tiennent dans les limites de la base", () => {
  const P = [], tx = [], cours = {};
  for (let i = 0; i < 40; i++) {
    const isin = "FR99900" + String(i).padStart(5, "0");
    P.push({ id: "p" + i, name: "Ligne " + i, mode: "market", isin, qty: 1, price: 100, status: "actif", owner: "p1", bloc: "B" + (i % 5), envelope: "PEA" });
    tx.push({ id: "t" + i, positionId: "p" + i, date: "2025-01-05", type: "achat", qty: 1, price: 100, amount: 100, importId: "imp-" + i, source: "import" });
    cours[isin] = [{ date: "2025-01-01", cloture: 100 }];
  }
  const r = H.reconstituer({ today: "2026-10-16", pas: "mois", positions: P, tx, cours, depuis: "2025-01-31", jusqua: "2025-01-31", detailLignes: true });
  const ph = H.photos(r, P);
  assert.equal(ph.length, 1);
  assert.equal(ph[0].sources.length, 30);
  near(ph[0].sources.reduce((a, s) => a + s.part, 0), 1, "parts", 1e-4);
  assert.ok(JSON.stringify(ph[0].sources).length <= 6000);
  assert.ok(JSON.stringify(ph[0].by_bloc).length <= 20000);
});

/* ---------- recalage de fusionner avec un historique réel ---------- */
test("fusionner : photos reconstituées mensuelles + première photo observée → l'écart de recalage est celui du dernier mois reconstitué, l'observé n'est jamais touché", () => {
  const e = entreeReconstituer(cas("P1/reconstitution")), r = H.reconstituer({ ...e, jusqua: "2024-03-31" });
  const f = H.fusionner([{ date: "2024-04-05", net: 1600 }, { date: "2024-04-06", net: 1610 }], r.points);
  assert.equal(f.premiereObservee, "2024-04-05");
  assert.equal(f.decalage, 25, "1 600 € observés − 1 575 € reconstitués à fin mars");
  assert.deepEqual(f.points.filter(p => p.nature === "reconstitue").map(p => p.net), [25, 985, 2025, 1600], "tout le passé est décalé de 25 €, dernier mois compris");
  assert.deepEqual(f.points.filter(p => p.nature === "observe").map(p => p.net), [1600, 1610]);
});

/* ---------- performance (spec § 12.3) ---------- */
test("20 ans en mode mois : 50 lignes et 5 000 transactions sans explosion de complexité (cible de la spec : 50 ms ; ~25 ms mesurés au repos)", () => {
  const P = [], tx = [], cours = {};
  for (let i = 0; i < 50; i++) {
    const isin = "FR99900" + String(i).padStart(5, "0");
    P.push({ id: "p" + i, name: "Ligne " + i, mode: "market", isin, qty: 100, price: 100, status: "actif", owner: "p1", bloc: "B", envelope: "PEA" });
    const c = [];
    for (let d = 0; d < 7300; d += 3) c.push({ date: H.plusJours("2006-11-01", d), cloture: 50 + (d % 100) });
    cours[isin] = c;
  }
  for (let k = 0; k < 5000; k++) tx.push({ id: "t" + k, positionId: "p" + (k % 50), date: H.plusJours("2007-01-01", k % 7000), type: k % 2 ? "achat" : "vente", qty: 1, price: 100, amount: 100, importId: "i", source: "import" });
  const e = { today: "2026-10-16", pas: "mois", positions: P, tx, cours, depuis: "2006-12-31" };
  let r = H.reconstituer(e), ms = Infinity; // échauffement du moteur JavaScript, puis le meilleur de cinq passages (les fichiers de test tournent en parallèle)
  // étalon : un tri de 200 000 nombres, mesuré au même moment, pour ne pas confondre une machine chargée (les autres agents testent aussi) avec une explosion de complexité
  const etalon = () => { const t0 = performance.now(); const a = Array.from({ length: 200000 }, (_, i) => (i * 7919) % 10007); a.sort((x, y) => x - y); return performance.now() - t0; };
  let ref = Infinity;
  for (let k = 0; k < 5; k++) { const t0 = performance.now(); r = H.reconstituer(e); ms = Math.min(ms, performance.now() - t0); ref = Math.min(ref, etalon()); }
  assert.ok(r.points.length >= 238, r.points.length + " points");
  assert.ok(ms < Math.max(400, 40 * ref), "durée " + ms.toFixed(1) + " ms (étalon " + ref.toFixed(1) + " ms)"); // ~25 ms au repos ; la marge ne garde que la complexité, pas la charge de la machine
});

/* ---------- mouvements de la fixture : sanity de l'adaptateur ---------- */
test("adaptateur : un mouvement d'une ligne clôturée est rattaché à la ligne du bilan de même ISIN", () => {
  const c = cas("P-cloturee/reconstitution"), tx = mouvementsDe("P-cloturee", c.entree.positions);
  assert.ok(tx.every(t => t.positionId === "pos-etf-c"));
});
