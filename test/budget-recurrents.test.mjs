// BUD1 tâche 9b : le récurrent (engagements, abonnements, habitudes), les variations et les dépenses inhabituelles, spec § 6.5, D15 et D18.
// Les 19 appels des cas R1 à R8 de test/fixtures/budget-cas.json (section `recurrents`, attendus écrits à la main puis recalculés par un script indépendant) sont
// comparés à l'octet près à Budget.recurrents, Budget.variations et Budget.inhabituel : aucune valeur attendue n'est modifiée.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Budget = require("../web/src/budget.js");
const F = JSON.parse(readFileSync(new URL("./fixtures/budget-cas.json", import.meta.url), "utf8"));
const J = v => JSON.parse(JSON.stringify(v));
const CAS = F.recurrents.cas;

/** data du moteur à partir de l'entrée d'un cas : today, comptes, partage et lignes de banque_marchands_mois. */
const dataDe = c => ({ aujourdhui: c.entree.today, comptes: c.entree.comptes, partage: c.entree.partage, marchands: c.entree.lignes });
const appeler = (c, a) => Budget[a.fonction](dataDe(c), a.options);

test("la fixture porte bien 8 cas et 19 appels", () => {
  assert.equal(CAS.length, 8);
  assert.equal(CAS.reduce((n, c) => n + c.appels.length, 0), 19);
});

for (const c of CAS) c.appels.forEach((a, i) => {
  test(`${c.id} appel ${i + 1} : ${a.fonction} ${JSON.stringify(a.options)}`, () => {
    assert.deepEqual(J(appeler(c, a)), a.attendu);
  });
});

test("Perso(p1) + Perso(p2) = Tout (synthèse, reste à prélever, coût annuel des abonnements) à 1 centime près (R1)", () => {
  const c = CAS[0], tout = Budget.recurrents(dataDe(c), { vue: "tout", mois: "2026-10" }).synthese;
  const p1 = Budget.recurrents(dataDe(c), { vue: "perso", personne: "p1", mois: "2026-10" }).synthese, p2 = Budget.recurrents(dataDe(c), { vue: "perso", personne: "p2", mois: "2026-10" }).synthese;
  for (const k of ["engagements", "abonnements", "habitudes", "ponctuel", "total", "reste_a_prelever", "cout_annuel_abonnements"]) assert.ok(Math.abs(p1[k] + p2[k] - tout[k]) <= 0.011, `${k} : ${p1[k]} + ${p2[k]} ≠ ${tout[k]}`);
});

test("le mois demandé : un mois passé a la synthèse de ce mois et ni reste à prélever ni attendus", () => {
  const c = CAS[0], s = Budget.recurrents(dataDe(c), { vue: "tout", mois: "2026-09" }).synthese;
  assert.equal(s.mois, "2026-09"); assert.equal(s.en_cours, false);
  assert.deepEqual([s.reste_a_prelever, s.attendus, s.prochain_prelevement], [null, null, null]);
  assert.ok(s.total > 0);
  const defaut = Budget.recurrents(dataDe(c), { vue: "tout" }).synthese;
  assert.deepEqual([defaut.mois, defaut.en_cours], ["2026-10", true]);
});

test("un compte qui n'est pas du budget (livret) ne compte nulle part : ni récurrent, ni couverture, ni synthèse", () => {
  const c = CAS[4], r = Budget.recurrents(dataDe(c), { vue: "tout", mois: "2026-10" });
  assert.ok(!r.recurrents.some(x => x.compte_id === "l1"));
  const seul = { ...dataDe(c), marchands: dataDe(c).marchands.filter(l => l.compte_id === "l1") };
  assert.deepEqual(Budget.recurrents(seul, { vue: "tout" }), { disponible: false, raison: "moins_de_3_mois", mois_couverts: 0 });
});

test("lignes plus anciennes que m0 − 12 ignorées ; clé vide : jamais un récurrent, comptée en ponctuel dans la synthèse", () => {
  const c = CAS[2], d = dataDe(c);
  const vieux = { mois: "2024-01-01", compte_id: "c1", cle_marchand: "exki", sous_categorie: "restaurants", entrees: 0, sorties: 999, nombre: 9, montant_min: 111, montant_max: 111, dernier_jour: 3 };
  const vide = { mois: "2026-10-01", compte_id: "c1", cle_marchand: "", sous_categorie: "shopping", entrees: 0, sorties: 33, nombre: 3, montant_min: 11, montant_max: 11, dernier_jour: 9 };
  const base = Budget.recurrents(d, { vue: "tout", mois: "2026-10" });
  const avec = Budget.recurrents({ ...d, marchands: [vieux, vide, ...d.marchands] }, { vue: "tout", mois: "2026-10" });
  assert.deepEqual(avec.recurrents, base.recurrents, "ni le très ancien, ni la clé vide ne changent la liste");
  assert.equal(avec.mois_couverts, base.mois_couverts);
  assert.equal(avec.synthese.ponctuel, 33);
  assert.equal(avec.synthese.total, 33);
});

test("variations : N0 = 0 met tout l'écart en effet volume ; N1 = 0 donne un effet prix nul ; la somme des effets vaut l'écart", () => {
  const ligne = (mois, cle, s, n) => ({ mois: mois + "-01", compte_id: "c1", cle_marchand: cle, sous_categorie: "loisirs", entrees: 0, sorties: s, nombre: n, montant_min: s / n, montant_max: s / n, dernier_jour: 10 });
  const base = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map(m => ligne(m, "yoga", 30, 1));
  const d = x => ({ aujourdhui: "2026-10-16", comptes: [{ id: "c1", type: "courant", titulaire: "p1" }], partage: { mode: "egal", p1: 0.5 }, marchands: x });
  const nouveau = Budget.variations(d([...base, ligne("2026-09", "cinema", 40, 2)]), { vue: "tout", mois: "2026-09", niveau: "sous_categorie", sous_categorie: "loisirs" });
  assert.equal(nouveau.ecart, 10); assert.equal(nouveau.reference.periode_courte, false);
  const zero = Budget.variations(d([ligne("2026-03", "yoga", 30, 1), ligne("2026-04", "yoga", 30, 1), ligne("2026-05", "yoga", 30, 1), ligne("2026-09", "cinema", 40, 2)]),
    { vue: "tout", mois: "2026-09", niveau: "sous_categorie", sous_categorie: "loisirs" });
  assert.equal(zero.reference.n, 6, "mois couverts : mars à août, absence = 0");
  assert.deepEqual([zero.reference.nombre, zero.reference.montant], [0.5, 15], "médiane paire de six valeurs (0, 0, 0, 1, 1, 1 → 0,5) ; montant : médiane (0, 0, 0, 30, 30, 30) = 15");
  const sans = Budget.variations(d(base), { vue: "tout", mois: "2026-09", niveau: "cle", compte_id: "c1", cle_marchand: "yoga" });
  assert.deepEqual([sans.mois_analyse.nombre, sans.mois_analyse.panier, sans.effet_prix, sans.effet_volume, sans.ecart], [0, null, 0, -30, -30]);
  const n0 = Budget.variations(d([...base.slice(0, 2), ligne("2026-09", "yoga", 30, 1), ligne("2026-05", "x", 1, 1), ligne("2026-06", "x", 1, 1)]), { vue: "tout", mois: "2026-09", niveau: "cle", compte_id: "c1", cle_marchand: "cinema" });
  assert.deepEqual([n0.ecart, n0.effet_volume, n0.effet_prix, n0.reference.nombre], [0, 0, 0, 0], "clé absente partout : tout à zéro");
});

test("période courte : 3 à 5 mois de référence, moins de 3 indisponible, avec le nombre de mois couverts", () => {
  const ligne = (mois, s) => ({ mois: mois + "-01", compte_id: "c1", cle_marchand: "cine", sous_categorie: "sorties", entrees: 0, sorties: s, nombre: 1, montant_min: s, montant_max: s, dernier_jour: 10 });
  const d = x => ({ aujourdhui: "2026-10-16", comptes: [{ id: "c1", type: "courant", titulaire: "p1" }], partage: { mode: "egal", p1: 0.5 }, marchands: x });
  const o = { vue: "tout", mois: "2026-09", niveau: "sous_categorie", sous_categorie: "sorties" };
  const v = Budget.variations(d([ligne("2026-05", 10), ligne("2026-06", 10), ligne("2026-07", 10), ligne("2026-08", 10), ligne("2026-09", 50)]), o);
  assert.deepEqual([v.reference.n, v.reference.periode_courte, v.reference.du, v.reference.au, v.ecart], [4, true, "2026-05", "2026-08", 40]);
  assert.deepEqual(Budget.variations(d([ligne("2026-07", 10), ligne("2026-08", 10), ligne("2026-09", 50)]), o), { disponible: false, raison: "moins_de_3_mois", mois_couverts: 2 });
});

test("data absente ou sans date : indisponible, jamais d'exception", () => {
  for (const f of ["recurrents", "variations", "inhabituel"]) {
    assert.equal(Budget[f](null, { vue: "tout", mois: "2026-09" }).disponible, false);
    assert.equal(Budget[f]({}, { vue: "tout", mois: "2026-09" }).disponible, false);
    assert.equal(Budget[f]({ aujourdhui: "2026-10-16", marchands: [] }, { vue: "tout", mois: "2026-09" }).disponible, false);
  }
});

/* ---------- pistes liées (§ 6.5, « Pistes ») ---------- */
const pistesDe = (c, extra = {}, opts) => Budget.pistes({ ...dataDe(c), reference: { revenus: 3000, essentiels: {}, envies: {} }, preferences: {}, operations: [], ...extra }, opts);
test("pistes : une hausse de prix d'abonnement donne une piste facile, au montant de la hausse, sans nom de fournisseur recommandé (R4)", () => {
  const p = pistesDe(CAS[3]).filter(x => x.cle.startsWith("hausse_prix_"));
  assert.deepEqual(p.map(x => x.cle).sort(), ["hausse_prix_c1_apple music", "hausse_prix_c1_dropbox"]);
  for (const x of p) {
    assert.equal(x.poste, "abonnements"); assert.equal(x.difficulte, "facile");
    assert.deepEqual(x.economie_mensuelle, { min: 1, max: 1, retenue: 1 }, "une ligne précise : montant exact, pas de fourchette");
    assert.doesNotMatch(JSON.stringify(x), /tu devrais|il faut que tu/i);
  }
  assert.match(p.find(x => x.cle.endsWith("dropbox")).pourquoi, /10 € à 11 € depuis septembre 2026/);
});
test("pistes : une habitude en hausse de plus de 15 % donne une piste moyenne en fourchette (0,5 à 1,5 fois la retenue) ; une protégée n'en donne aucune (R1)", () => {
  const p = pistesDe(CAS[0]).filter(x => x.cle.startsWith("habitude_en_hausse_"));
  assert.deepEqual(p.map(x => x.cle).sort(), ["habitude_en_hausse_c1_boulangerie", "habitude_en_hausse_c1_deliveroo", "habitude_en_hausse_k1_carrefour market", "habitude_en_hausse_k1_pizzeria"]);
  const d = p.find(x => x.cle.endsWith("deliveroo"));
  assert.equal(d.difficulte, "moyen");
  assert.deepEqual(d.economie_mensuelle, { min: 10, max: 30, retenue: 20 }, "120 − 100 = 20 € par mois ; fourchette 10 à 30");
  const sans = pistesDe(CAS[0], { preferences: { protegees: ["restaurants"] } }).filter(x => x.cle.startsWith("habitude_en_hausse_"));
  assert.ok(!sans.some(x => x.poste === "restaurants") && sans.length === 2, "restaurants protégé : plus aucune piste dessus");
});
test("pistes : un abonnement arrêté d'un côté mais prélevé sur un autre compte donne une piste facile ; sans autre compte, rien", () => {
  const l = (mois, compte, s, j) => ({ mois: mois + "-01", compte_id: compte, cle_marchand: "canal plus", sous_categorie: "abonnements", entrees: 0, sorties: s, nombre: 1, montant_min: s, montant_max: s, dernier_jour: j });
  const mois = ["2026-04", "2026-05", "2026-06", "2026-07"], autres = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const comptes = [{ id: "c1", type: "courant", titulaire: "p1" }, { id: "c2", type: "courant", titulaire: "p2" }];
  const data = { aujourdhui: "2026-10-16", comptes, partage: { mode: "egal", p1: 0.5 }, reference: { revenus: 3000, essentiels: {}, envies: {} }, preferences: {}, operations: [],
    marchands: [...mois.map(m => l(m, "c1", 25, 10)), ...autres.map(m => l(m, "c2", 25, 12))] };
  const p = Budget.pistes(data).filter(x => x.cle.startsWith("abonnement_arrete_ailleurs_"));
  assert.equal(p.length, 1); assert.equal(p[0].economie_mensuelle.retenue, 25);
  const seul = Budget.pistes({ ...data, marchands: data.marchands.filter(x => x.compte_id === "c1") }).filter(x => x.cle.startsWith("abonnement_arrete_ailleurs_"));
  assert.equal(seul.length, 0);
});
