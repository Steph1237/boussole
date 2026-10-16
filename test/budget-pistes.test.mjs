// BUD1, tâche 9 : détections déterministes (récurrents, doublons possibles, frais sur 12 mois, petits achats, énergie, fragilité) et pistes d'économie
// (Budget.detections, Budget.pistes, spec § 6.4 et § 8.2). Jeu de données fictif construit pour ce fichier, chaque attendu est calculé à la main dans le
// commentaire du cas. Les conventions (10 %, 25 %, 50 %, 5 €, 15 €, 8 achats) viennent des repères de la fixture. Valeurs fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const F = JSON.parse(readFileSync(new URL("./fixtures/budget-cas.json", import.meta.url), "utf8"));
const Budget = require("../web/src/budget.js");
const J = v => JSON.parse(JSON.stringify(v));

const AUJ = "2026-10-15";   // mois complets : de 2025-09 (13 mois avant) à 2026-09
const mois = (a, b) => { const out = []; for (let t = a * 12 + 8; ; t++) { const m = String(Math.floor(t / 12)) + "-" + String(t % 12 + 1).padStart(2, "0"); out.push(m); if (m >= b) break; } return out; };
const ligne = (m, cle, sous, sorties, extra = {}) => ({ mois: m + "-01", compte_id: 10, cle_marchand: cle, sous_categorie: sous, entrees: 0, sorties, nombre: 1, ...extra });
/** Même montant chaque mois de la liste. */
const serie = (cle, sous, montant, ms, extra) => ms.map(m => ligne(m, cle, sous, montant, extra));
const M12 = mois(2025, "2026-09").slice(-12);       // 2025-10 … 2026-09
const REF = F.cible.find(c => c.id === "T1").reference;

/** Jeu de données : abonnements vidéo (2) et musique (2), assurances (2), frais bancaires, énergie saisonnière, deux dépenses annuelles. */
function marchands() {
  const energie = [60, 90, 120, 150, 160, 130, 100, 80, 60, 50, 45, 55];     // 2025-10 … 2026-09 : total 1 100
  return [
    ...serie("netflix", "abonnements", 13.49, ["2026-06", "2026-07", "2026-08", "2026-09"]),            // 4 mois sur 4
    ...serie("disney plus", "abonnements", 9.99, ["2026-07", "2026-08", "2026-09"]),                    // 3 mois sur 4 (juin absent)
    ...serie("spotify", "abonnements", 10.99, ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]),
    ...serie("deezer", "abonnements", 10.99, ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]),  // 5 mois sur 6 (avril absent)
    ...serie("prlv maif", "assurances", 40, M12.slice(-6)), ...serie("prlv macif", "assurances", 55, M12.slice(-6)),
    ...serie("cotisation carte visa", "frais_bancaires", 20, M12),                                      // 12 × 20 = 240
    ...M12.map((m, i) => ligne(m, "edf clients particuliers", "energie", energie[i])),
    ligne("2025-10", "taxe fonciere", "impots", 1200),                                                  // annuelle, jamais revue en arrière : probable
    ligne("2025-09", "taxe habitation exemple", "impots", 300), ligne("2026-09", "taxe habitation exemple", "impots", 300), // revenue 12 mois plus tard : confirmée
    ligne("2026-09", "restaurant du coin", "restaurants", 45),                                           // une fois seulement, 45 € : ni mensuel ni annuel (sous le seuil)
    ligne("2026-08", "virement vers livret", "epargne_precaution", 500),                                 // épargne : jamais un récurrent
  ];
}
function operations() {
  const ops = [];
  for (let i = 0; i < 30; i++) ops.push({ date: "2026-0" + (7 + (i % 3)) + "-" + String(2 + i % 20).padStart(2, "0"), montant: -4, libelle: "CB BOULANGERIE", compte_id: 10, sous_categorie: "restaurants", type_powens: "card" });
  for (let i = 0; i < 6; i++) ops.push({ date: "2026-09-" + String(3 + i).padStart(2, "0"), montant: -10, libelle: "CB QUINCAILLERIE", compte_id: 10, sous_categorie: "shopping" });
  ops.push({ date: "2026-09-10", montant: -20, libelle: "CB TRAITEUR", compte_id: 10, sous_categorie: "restaurants", type_powens: "card" },      // 20 € : pas un petit achat
    { date: "2026-09-11", montant: 4, libelle: "CB REMBOURSEMENT", compte_id: 10, sous_categorie: "restaurants", type_powens: "card" },             // entrée
    { date: "2026-09-12", montant: -4, libelle: "PRLV ABONNEMENT", compte_id: 10, sous_categorie: "restaurants", type_powens: "order" },            // pas une carte
    { date: "2026-09-13", montant: -4, libelle: "CB EPICERIE", compte_id: 10, sous_categorie: "courses", type_powens: "card" });                    // pas dans les trois sous-catégories
  return ops;
}
const data = (extra = {}) => ({ aujourdhui: AUJ, reference: REF, marchands: marchands(), operations: operations(), comptes: [{ id: 10, type: "courant", solde: 1200 }], mois: [], preferences: { protegees: ["sport"] }, reperes: F.reperes, ...extra });
const cles = l => l.map(x => x.cle);

test("récurrents : mensuel (3 mois sur 4 ou 5 sur 6, montant à ±10 %), annuel probable ou confirmé ; épargne et achats uniques jamais", () => {
  const r = Budget.detections(data()).recurrents, par = k => r.find(x => x.cle_marchand === k);
  assert.deepEqual(r.map(x => x.cle_marchand), ["cotisation carte visa", "deezer", "disney plus", "netflix", "prlv macif", "prlv maif", "spotify", "taxe fonciere", "taxe habitation exemple"],
    "l'énergie varie trop, le restaurant n'est ni mensuel ni annuel, l'épargne est exclue");
  assert.deepEqual([par("netflix").rythme, par("netflix").montant_mensuel, par("netflix").famille, par("netflix").mois_presents.length], ["mensuel", 13.49, "video", 4]);
  assert.deepEqual([par("disney plus").rythme, par("disney plus").mois_presents], ["mensuel", ["2026-07", "2026-08", "2026-09"]], "3 mois sur 4");
  assert.deepEqual([par("deezer").rythme, par("deezer").mois_presents.length], ["mensuel", 4], "5 mois sur 6 : les 4 derniers (3 sur 4) suffisent déjà");
  assert.equal(par("cotisation carte visa").mois_presents.length, 4, "les 4 derniers mois suffisent");
  assert.deepEqual([par("taxe fonciere").rythme, par("taxe fonciere").montant, par("taxe fonciere").montant_mensuel, par("taxe fonciere").confirme], ["annuel", 1200, 100, false], "annuelle probable : jamais revue 12 mois avant");
  assert.deepEqual([par("taxe habitation exemple").rythme, par("taxe habitation exemple").confirme], ["annuel", true], "revenue 12 mois plus tôt : confirmée");
  // montant instable (±10 %) : pas mensuel
  const instable = [...serie("gym", "sport", 30, ["2026-06", "2026-07"]), ligne("2026-08", "gym", "sport", 34), ligne("2026-09", "gym", "sport", 30)];
  assert.equal(Budget.detections(data({ marchands: instable })).recurrents.length, 0, "34 € contre 30 € : +13 %");
  const stable = [...serie("gym", "sport", 30, ["2026-06", "2026-07"]), ligne("2026-08", "gym", "sport", 32), ligne("2026-09", "gym", "sport", 30)];
  assert.equal(Budget.detections(data({ marchands: stable })).recurrents.length, 1, "+6,7 % : stable");
  // deux mois seulement : non ; trois mois non consécutifs sur 4 : oui (juin absent)
  assert.equal(Budget.detections(data({ marchands: serie("x", "loisirs", 10, ["2026-08", "2026-09"]) })).recurrents.length, 0);
  assert.equal(Budget.detections(data({ marchands: serie("x", "loisirs", 10, ["2026-07", "2026-08", "2026-09"]) })).recurrents.length, 1);
  // le mois en cours ne compte pas
  assert.equal(Budget.detections(data({ marchands: serie("x", "loisirs", 10, ["2026-08", "2026-09", "2026-10"]) })).recurrents.length, 0);
  // comptes choisis : seules leurs lignes comptent
  assert.equal(Budget.detections(data(), { comptes: ["99"] }).recurrents.length, 0);
});

test("doublons possibles : assurances sans mot de payeur en commun, abonnements d'une même famille (vidéo, musique) — famille affichée, jamais la marque", () => {
  const d = Budget.detections(data()).doublons;
  assert.deepEqual(J(d), [
    { type: "assurances", famille: null, cles_marchand: ["prlv macif", "prlv maif"], montant_mensuel_min: 40 },
    { type: "abonnements", famille: "video", cles_marchand: ["disney plus", "netflix"], montant_mensuel_min: 9.99 },
    { type: "abonnements", famille: "musique", cles_marchand: ["deezer", "spotify"], montant_mensuel_min: 10.99 },
  ]);
  // deux contrats du même assureur (mot de payeur commun) : pas un doublon
  const memeAssureur = [...serie("prlv maif habitation", "assurances", 40, M12.slice(-4)), ...serie("prlv maif auto", "assurances", 55, M12.slice(-4))];
  assert.deepEqual(Budget.detections(data({ marchands: memeAssureur })).doublons, []);
  // un seul abonnement vidéo : pas de doublon ; sport ou presse : jamais
  assert.deepEqual(Budget.detections(data({ marchands: serie("netflix", "abonnements", 13.49, M12.slice(-4)) })).doublons, []);
  assert.deepEqual(Budget.detections(data({ marchands: [...serie("basic fit", "abonnements", 30, M12.slice(-4)), ...serie("fitness park", "abonnements", 25, M12.slice(-4))] })).doublons, []);
});

test("frais bancaires sur 12 mois : total, nombre de commissions, mois concernés", () => {
  const f = Budget.detections(data()).frais;
  assert.deepEqual(J(f), { total_12_mois: 240, commissions: 12, mois: 12 });
  // les frais plus anciens que 12 mois n'y sont pas
  assert.equal(Budget.detections(data({ marchands: [ligne("2025-09", "agios", "frais_bancaires", 50)] })).frais.total_12_mois, 0);
  assert.deepEqual(J(Budget.detections(data({ marchands: [] })).frais), { total_12_mois: 0, commissions: 0, mois: 0 });
});

test("petits achats : opérations de carte de moins de 15 € en restaurants, achats ou loisirs, plus de 8 par mois en moyenne", () => {
  const p = Budget.detections(data()).petits_achats;
  // 30 × 4 € (restaurants) + 6 × 10 € (achats, libellé CB) = 36 opérations, 180 €, sur 3 mois
  assert.deepEqual(J(p), { nombre: 36, par_mois: 12, total_mensuel: 60, seuil: 15, recurrent: true });
  // 8 par mois pile : pas au-delà
  const huit = Array.from({ length: 24 }, (_, i) => ({ date: "2026-09-01", montant: -5, libelle: "CB CAFE", compte_id: 10, sous_categorie: "restaurants", type_powens: "card" }));
  assert.equal(Budget.detections(data({ operations: huit })).petits_achats.recurrent, false);
  assert.equal(Budget.detections(data({ operations: [...huit, huit[0]] })).petits_achats.recurrent, true);
  // restaurants protégé : ces achats ne comptent pas
  const sans = Budget.detections(data({ preferences: { protegees: ["restaurants"] } })).petits_achats;
  assert.deepEqual([sans.nombre, sans.recurrent], [6, false]);
  // période plus longue lue dans data.mois_detail
  assert.equal(Budget.detections(data({ mois_detail: 6 })).petits_achats.par_mois, 6);
});

test("énergie : total sur 12 mois, mois par mois, mois le plus et le moins cher ; aucune comparaison de fournisseur", () => {
  const e = Budget.detections(data()).energie;
  assert.equal(e.total_12_mois, 1100);
  assert.equal(e.plus_cher, "2026-02"); assert.equal(e.moins_cher, "2026-08");
  assert.deepEqual(Object.keys(e.par_mois).length, 12); assert.equal(e.par_mois["2026-01"], 150);
  assert.doesNotMatch(JSON.stringify(e), /fournisseur|offre|moins cher que/i);
  const vide = Budget.detections(data({ marchands: [] })).energie;
  assert.deepEqual([vide.total_12_mois, vide.plus_cher, vide.moins_cher], [0, null, null]);
});

test("fragilité : solde négatif plus de 5 jours dans 2 des 3 derniers mois, agios récurrents, crédit renouvelable, capacité négative 3 mois de suite", () => {
  // solde de fin de journée reconstitué à rebours depuis le solde actuel (+200 €), sur la fenêtre de détail de 90 jours (depuis le 17/07)
  const comptes = [{ id: 10, type: "courant", solde: 200 }];
  const ops = [{ date: "2026-08-05", montant: -1000, compte_id: 10 }, { date: "2026-08-26", montant: 1100, compte_id: 10 },
    { date: "2026-09-05", montant: -1000, compte_id: 10 }, { date: "2026-09-26", montant: 1100, compte_id: 10 }];
  // septembre : +200 depuis le 26/09 ; −900 du 05/09 au 25/09 (21 jours) ; +100 avant. Août : +100 du 26/08, −1 000 du 05/08 au 25/08 (21 jours) ; 0 avant (pas négatif)
  let f = Budget.fragilite(data({ comptes, operations: ops }));
  assert.deepEqual(J(f.jours_negatifs), { "2026-07": 0, "2026-08": 21, "2026-09": 21 });
  assert.equal(f.decouvert, true); assert.equal(f.fragile, true);
  // un seul mois au-delà de 5 jours : pas de signal
  f = Budget.fragilite(data({ comptes, operations: [{ date: "2026-09-05", montant: -1000, compte_id: 10 }, { date: "2026-09-26", montant: 1100, compte_id: 10 }] }));
  assert.deepEqual(J(f.jours_negatifs), { "2026-07": 0, "2026-08": 0, "2026-09": 21 }); assert.equal(f.decouvert, false);
  // exactement 5 jours (22/08 au 26/08) : pas plus de 5
  f = Budget.fragilite(data({ comptes, operations: [{ date: "2026-08-22", montant: -500, compte_id: 10 }, { date: "2026-08-27", montant: 600, compte_id: 10 }] }));
  assert.equal(f.jours_negatifs["2026-08"], 5); assert.equal(f.decouvert, false);
  // sans mouvement connu, un solde négatif dure toute la fenêtre : juillet (du 17 au 31 : 15 jours), août et septembre
  f = Budget.fragilite(data({ comptes: [{ id: 10, type: "courant", solde: -50 }], operations: [] }));
  assert.deepEqual(J(f.jours_negatifs), { "2026-07": 15, "2026-08": 31, "2026-09": 30 }); assert.equal(f.decouvert, true);
  // solde positif, aucun mouvement, ou compte hors sélection : rien
  assert.equal(Budget.fragilite(data()).fragile, false);
  assert.equal(Budget.fragilite(data({ comptes, operations: ops }), { comptes: ["99"] }).decouvert, false);
  assert.equal(Budget.fragilite({ comptes }).fragile, false, "sans date du jour : rien");
  // agios : deux mois sur les trois derniers
  assert.equal(Budget.fragilite(data({ marchands: [ligne("2026-08", "agios", "frais_bancaires", 6), ligne("2026-09", "agios", "frais_bancaires", 7)] })).agios, true);
  assert.equal(Budget.fragilite(data({ marchands: [ligne("2026-09", "agios", "frais_bancaires", 7)] })).agios, false);
  assert.equal(Budget.fragilite(data({ marchands: [ligne("2026-08", "commission intervention", "frais_bancaires", 8), ligne("2026-09", "commission intervention", "frais_bancaires", 8)] })).agios, true);
  assert.equal(Budget.fragilite(data({ marchands: [ligne("2026-08", "cotisation carte", "frais_bancaires", 6), ligne("2026-09", "cotisation carte", "frais_bancaires", 7)] })).agios, false, "une cotisation n'est pas un agio");
  // crédit renouvelable (type Powens revolvingcredit)
  assert.equal(Budget.fragilite(data({ comptes: [{ id: 11, type: "credit", pret: { type: "revolvingcredit" } }] })).renouvelable, true);
  assert.equal(Budget.fragilite(data({ comptes: [{ id: 11, type: "credit", pret: { type: "mortgage" } }] })).renouvelable, false);
  // capacité négative trois mois de suite
  const caps = (...c) => c.map((x, i) => ({ mois: "2026-0" + (7 + i), capacite: x }));
  assert.equal(Budget.fragilite(data({ mois: caps(-50, -10, -1) })).capacite_negative, true);
  assert.equal(Budget.fragilite(data({ mois: caps(-50, 0, -1) })).capacite_negative, false, "un mois à zéro");
  assert.equal(Budget.fragilite(data({ mois: [{ mois: "2026-07", capacite: -5 }, { mois: "2026-08", capacite: -5 }, { mois: "2026-10", capacite: -5 }] })).capacite_negative, false, "mois non consécutifs");
  assert.equal(Budget.fragilite(data({ mois: caps(-50, -10) })).capacite_negative, false);
});

test("pistes : liste complète du jeu de données, triée par difficulté puis par économie (T1 pour la référence)", () => {
  const p = Budget.pistes(data({ preferences: { protegees: ["sport"], abonnements_inutilises: ["netflix"] } }));
  assert.deepEqual(p.map(x => [x.cle, x.difficulte, x.economie_mensuelle.retenue]), [
    ["frais_bancaires", "facile", 15],                  // 240 ÷ 12 − 5 € laissés
    ["abonnement_inutilise", "facile", 13],             // netflix 13,49 → 13
    ["doublon_abonnements_musique", "facile", 11],      // le plus petit des deux : 10,99 → 11
    ["doublon_abonnements_video", "facile", 10],        // 9,99 → 10
    ["envies_modulables", "moyen", 128],                // 10 % de 1 275 (envies 1 450 − sport 90 − abonnements 85) = 127,5
    ["assurances_en_double", "moyen", 40],
    ["petits_achats", "moyen", 30],                     // la moitié de 60 €/mois
    ["contrats_assurances", "moyen", 14], ["contrats_energie", "moyen", 11], ["contrats_telecom", "moyen", 6],
    ["envies_modulables_fort", "vrai_changement", 319], // 25 % de 1 275 = 318,75
  ]);
  const par = k => p.find(x => x.cle === k);
  assert.deepEqual(J(par("frais_bancaires").economie_mensuelle), { min: 15, max: 15, retenue: 15 }, "ligne précise : fourchette égale au montant");
  assert.deepEqual(J(par("contrats_assurances").economie_mensuelle), { min: 7, max: 21, retenue: 14 }, "pourcentage de convention : de la moitié à une fois et demie");
  assert.deepEqual(J(par("abonnement_inutilise").donnees), { cles_marchand: ["netflix"], montant_annuel: 156, nombre: 1 });
  assert.deepEqual(J(par("frais_bancaires").donnees), { cles_marchand: [], montant_annuel: 240, nombre: 12 });
  assert.deepEqual(par("assurances_en_double").donnees.cles_marchand, ["prlv macif", "prlv maif"]);
  assert.equal(par("envies_modulables").poste, "envies"); assert.equal(par("contrats_energie").poste, "energie");
  // chaque piste : titre, pourquoi, question, source ; difficulté connue ; au tutoiement ; aucune marque, aucun fournisseur recommandé
  for (const x of p) {
    for (const k of ["cle", "poste", "titre", "pourquoi", "question", "source"]) assert.ok(typeof x[k] === "string" && x[k].length > 0, x.cle + "." + k);
    assert.ok(["facile", "moyen", "vrai_changement"].includes(x.difficulte));
    assert.ok(x.economie_mensuelle.min <= x.economie_mensuelle.retenue && x.economie_mensuelle.retenue <= x.economie_mensuelle.max, x.cle);
    const affiche = [x.titre, x.pourquoi, x.question].join(" ");
    assert.doesNotMatch(affiche, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu, x.cle);
    assert.doesNotMatch(affiche, /netflix|disney|spotify|deezer|maif|macif|edf|visa/i, x.cle + " : jamais une marque à l'affichage");
    assert.doesNotMatch(affiche, /meilleur|recommand|conseill|moins cher|passe chez|change de/i, x.cle);
    assert.doesNotMatch(affiche, /trop dépens|gaspill|excessi|craquer|tu devrais|mauvaise habitude/i, x.cle);
  }
  // pas de piste sur le logement ni la voiture (jamais chiffrés par Boussole)
  assert.ok(!p.some(x => ["loyer", "credit_logement", "transport"].includes(x.poste)));
});

test("pistes : aucune sur une sous-catégorie protégée (ni sur ses pistes de contrats, de frais, d'abonnements, ni dans la base des envies modulables)", () => {
  const sans = Budget.pistes(data({ preferences: { protegees: ["abonnements", "frais_bancaires", "energie", "restaurants"], abonnements_inutilises: ["netflix"] } }));
  const k = cles(sans);
  for (const absent of ["frais_bancaires", "abonnement_inutilise", "doublon_abonnements_video", "doublon_abonnements_musique", "contrats_energie", "petits_achats"]) assert.ok(!k.includes(absent), absent);
  assert.ok(k.includes("contrats_assurances") && k.includes("contrats_telecom") && k.includes("assurances_en_double"));
  // envies modulables : 1 450 − sport 0 (non protégé ici) − abonnements 85 − restaurants 380 = 985 → 10 % = 98,5 → 99 ; 25 % = 246,25 → 246
  const m = Object.fromEntries(sans.map(x => [x.cle, x.economie_mensuelle.retenue]));
  assert.equal(m.envies_modulables, 99); assert.equal(m.envies_modulables_fort, 246);
  assert.ok(!sans.some(x => x.poste === "abonnements" || x.poste === "frais_bancaires" || x.poste === "energie"));
});

test("pistes : l'abonnement dit inutilisé doit être un récurrent d'abonnements ; plusieurs abonnements s'additionnent ; annuel ramené au mois", () => {
  const p = prefs => Budget.pistes(data({ preferences: prefs })).find(x => x.cle === "abonnement_inutilise");
  assert.equal(p({ abonnements_inutilises: ["inconnu"] }), undefined);
  assert.equal(p({ abonnements_inutilises: ["restaurant du coin"] }), undefined, "pas un récurrent");
  const deux = p({ abonnements_inutilises: ["netflix", "spotify"] });
  assert.equal(deux.economie_mensuelle.retenue, 24, "13,49 + 10,99 = 24,48"); assert.deepEqual(deux.donnees.cles_marchand, ["netflix", "spotify"]);
  assert.match(deux.titre, /Des abonnements/);
});

test("conventions lues dans les repères : 20 % au lieu de 10 % pour les contrats, cotisation laissée de 10 € au lieu de 5 €, seuil de petit achat de 6 €", () => {
  const reperes = [...F.reperes.filter(r => !["budget_piste_contrats_pct", "budget_piste_frais_cotisation_laissee", "budget_piste_petit_achat_seuil"].includes(r.cle)),
    { cle: "budget_piste_contrats_pct", valeur: 20 }, { cle: "budget_piste_frais_cotisation_laissee", valeur: 10 }, { cle: "budget_piste_petit_achat_seuil", valeur: 6 }];
  const m = Object.fromEntries(Budget.pistes(data({ reperes })).map(x => [x.cle, x.economie_mensuelle.retenue]));
  assert.equal(m.contrats_assurances, 28); assert.equal(m.contrats_energie, 22); assert.equal(m.contrats_telecom, 12);
  assert.equal(m.frais_bancaires, 10, "240 ÷ 12 − 10");
  assert.equal(m.petits_achats, 20, "seuil de 6 € : les 30 achats de 4 € seuls (10 par mois), 120 ÷ 3 = 40 par mois, la moitié");
});

test("pistes : sans données ni référence, aucune piste inventée ; entrées intactes ; déterminisme", () => {
  assert.deepEqual(Budget.pistes({ aujourdhui: AUJ }), []);
  assert.deepEqual(Budget.pistes({ aujourdhui: AUJ, reference: { revenus: 3000, essentiels: { loyer: 1000, courses: 400 }, envies: { sport: 100 } }, preferences: { protegees: ["sport"] } }), [],
    "logement et voiture ne sont jamais chiffrés, le sport est protégé");
  assert.deepEqual(Budget.pistes({}), [], "sans date du jour : rien");
  const d = data(), avant = J(d);
  assert.deepEqual(J(Budget.pistes(d)), J(Budget.pistes(d)));
  assert.deepEqual(J(d), avant);
});
