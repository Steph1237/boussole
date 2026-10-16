// HIS2, tâche 10 : SerieNet lit les transactions importées (depuis le début des imports), les soldes de fin de mois des relevés importés, les enveloppes
// « depuis l'ouverture » et, au-delà de la fenêtre de 5 ans, les photos reconstituées stockées par la nuit. Données fictives.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SN = require("../web/src/serie-net.js");
const H = require("../web/src/historique.js");
const Calc = require("../web/src/calc.js");

const AUJ = "2026-10-16";
const ETF = { id: "etf", name: "ETF Monde A", envelope: "PEA Exemple", owner: "p1", bloc: "Monde", mode: "market", isin: "FR9990000013", qty: 10, price: 120, status: "actif" };
const CC = { id: "cc", name: "Compte courant Exemple", envelope: "Comptes", owner: "p1", bloc: "Courant", mode: "manual", value: 2500, status: "actif" };
const attendre = () => new Promise(r => setTimeout(r, 5));

function etat(extra = {}) {
  return { ready: true, dbOk: true, scope: "foyer", positions: [ETF, CC], profil: null, snapshots: [], tx: [], banque: { actif: false, comptes: [] },
    relevesBancaires: { lu: true, mfaRequise: false, comptes: [], releves: [], banqueMois: [] }, historiqueImports: [], photosReconstituees: [], ...extra };
}
const deps = (S, appels = []) => ({ Store: {
  cours: async (isins, depuis) => { appels.push(["cours", isins, depuis]); return { FR9990000013: [{ date: "2025-01-02", cloture: 100 }, { date: "2025-06-30", cloture: 110 }] }; },
  transactions: async depuis => { appels.push(["transactions", depuis]); return S.tx; },
} });

test("charger : sans import, les transactions sont lues depuis le début de la période (comportement inchangé)", async () => {
  SN.reinitialiser();
  const S = etat(), appels = [];
  await SN.charger(S, AUJ, { id: "1a" }, deps(S, appels));
  const tx = appels.find(a => a[0] === "transactions");
  assert.equal(tx[1], SN.hist.depuis, "même début que les cours");
});
test("charger : avec des imports, les transactions remontent au début du plus ancien import (20 ans au plus) ; un import de plus relance la lecture", async () => {
  SN.reinitialiser();
  const S = etat({ historiqueImports: [{ id: "i1", periodeDu: "2019-05-01", periodeAu: "2024-12-31", resume: {} }] }), appels = [];
  await SN.charger(S, AUJ, { id: "1a" }, deps(S, appels));
  assert.equal(appels.find(a => a[0] === "transactions")[1], "2019-05-01");
  assert.equal(appels.find(a => a[0] === "cours")[2], SN.hist.depuis, "les cours restent bornés à la période");
  const n = appels.length;
  await SN.charger(S, AUJ, { id: "1a" }, deps(S, appels));
  assert.equal(appels.length, n, "rien de nouveau : pas de relecture");
  S.historiqueImports = [...S.historiqueImports, { id: "i2", periodeDu: "2021-01-01", periodeAu: "2022-01-01", resume: {} }];
  await SN.charger(S, AUJ, { id: "1a" }, deps(S, appels));
  assert.ok(appels.length > n, "un import de plus : relecture");
  SN.reinitialiser();
  const vieux = etat({ historiqueImports: [{ id: "i0", periodeDu: "1995-01-01", periodeAu: "2000-01-01", resume: {} }] }), a2 = [];
  await SN.charger(vieux, AUJ, { id: "1a" }, deps(vieux, a2));
  assert.equal(a2.find(a => a[0] === "transactions")[1], H.plusJours(AUJ, -7305), "20 ans au plus");
});
test("reconstitution : les soldes de fin de mois des relevés importés et les enveloppes « depuis l'ouverture » entrent dans le passé", async () => {
  SN.reinitialiser();
  const tx = [{ id: "t1", positionId: "etf", date: "2025-03-10", type: "achat", qty: 10, price: 100, amount: 1000, importId: "i1", source: "import" }];
  const S = etat({ tx, historiqueImports: [{ id: "i1", periodeDu: "2025-03-01", periodeAu: "2025-03-31", enveloppe: "PEA Exemple", resume: { depuis_ouverture: true } }],
    relevesBancaires: { lu: true, mfaRequise: false, comptes: [{ id: "h1", positionId: "cc", banqueCompteId: null }], releves: [
      { compteId: "h1", mois: "2025-03-01", complet: true, soldeDebut: 2000, soldeFin: 2200, importId: "i2" }], banqueMois: [] } });
  await SN.charger(S, AUJ, { id: "tout" }, deps(S));
  const r = SN.reconstitution(S, AUJ, deps(S));
  assert.ok(r && r.points.length);
  const v = d => r.points.find(p => p.date === d).financier;
  assert.equal(v("2025-03-31"), 10 * 100 + 2200, "ETF acheté le 10/03 (depuis l'ouverture) + solde importé de fin mars");
  assert.equal(v("2025-03-09"), 2000 + Math.round((2200 - 2000) * 9 / 31 * 100) / 100, "avant l achat : zéro titre (depuis l ouverture), compte interpolé");
});
test("reconstitution : les photos stockées prolongent le passé au-delà de la fenêtre calculée, net refait avec les biens d'aujourd'hui", async () => {
  SN.reinitialiser();
  const photos = [{ date: "2015-12-31", financier: 5000, net: 99999, qualite: "estime", partEstimee: 0.5 }, { date: "2016-01-31", financier: 5200, net: 99999 }, { date: "2025-02-28", financier: 7000, net: 99999 }];
  const S = etat({ photosReconstituees: photos });
  await SN.charger(S, AUJ, { id: "tout" }, deps(S));
  const r = SN.reconstitution(S, AUJ, deps(S));
  assert.equal(r.points[0].date, "2015-12-31");
  assert.deepEqual([r.points[0].qualite, r.points[0].part_estimee], ["estime", 0.5], "la qualité de la photo stockée suit");
  assert.equal(r.points[0].net, 5000, "net = financier + biens hors placements d'aujourd'hui (aucun ici), pas le net stocké");
  assert.equal(r.points.filter(p => p.date === "2025-02-28").length, 1, "une photo qui chevauche la fenêtre calculée est écartée : un seul point ce jour-là");
  assert.notEqual(r.points.find(p => p.date === "2025-02-28").financier, 7000, "et c'est le calcul à la volée qui fait foi");
  const jour = r.points.filter(p => p.nature !== "photo");
  assert.ok(jour.every(p => p.qualite && p.part_estimee != null), "chaque jour calculé à la volée porte sa qualité");
  assert.ok(jour.length > 100, "le passé calculé à la volée est conservé");
  const f = H.fusionner([{ date: AUJ, net: 3000, live: true }], r.points);
  assert.equal(f.points[0].nature, "reconstitue");
});
test("reconstitution : seulement des photos stockées (rien à calculer à la volée) → le passé vient d'elles", async () => {
  SN.reinitialiser();
  const S = etat({ positions: [CC], photosReconstituees: [{ date: "2014-12-31", financier: 4000, net: 0 }] });
  await SN.charger(S, AUJ, { id: "tout" }, deps(S));
  const r = SN.reconstitution(S, AUJ, deps(S));
  assert.deepEqual(r.points.map(p => [p.date, p.net]), [["2014-12-31", 4000]]);
});
test("soldesMois / depuisOuverture : formes camelCase du store et snake_case de la base", () => {
  const camel = H.soldesMois([{ id: "h1", positionId: "cc" }, { id: "h2", banqueCompteId: 9 }, { id: "h3" }],
    [{ compteId: "h1", mois: "2025-03-01", soldeDebut: 1, soldeFin: 2, importId: "x" }, { compteId: "h2", mois: "2025-04-01", soldeFin: 5 }, { compteId: "h3", mois: "2025-04-01", soldeFin: 5 }, { compteId: "h1", mois: "x", soldeFin: 1 }],
    [{ id: 9, positionId: "livret" }]);
  assert.deepEqual(camel, [{ positionId: "cc", mois: "2025-03", solde_debut: 1, solde_fin: 2, import_id: "x" }, { positionId: "livret", mois: "2025-04", solde_debut: null, solde_fin: 5, import_id: null }]);
  const snake = H.soldesMois([{ id: "h1", position_id: "cc" }], [{ compte_id: "h1", mois: "2025-03-01", solde_debut: 1, solde_fin: 2, import_id: "x" }], []);
  assert.deepEqual(snake, [{ positionId: "cc", mois: "2025-03", solde_debut: 1, solde_fin: 2, import_id: "x" }]);
  const P = [{ id: "av", envelope: "Assurance-vie Exemple" }];
  assert.deepEqual(H.depuisOuverture([{ id: "i1", enveloppe: "PEA Exemple", resume: { depuis_ouverture: true } }, { id: "i2", enveloppe: "Autre", resume: { depuis_ouverture: false } },
    { id: "i3", enveloppe: null, resume: { depuis_ouverture: true } }], [{ import_id: "i3", position_id: "av" }, { importId: "i3", positionId: null, enveloppe: "Enveloppe libre" }], P),
  { "PEA Exemple": true, "Assurance-vie Exemple": true, "Enveloppe libre": true });
  assert.deepEqual(H.depuisOuverture(null, null, null), {});
});
void Calc; void attendre;
