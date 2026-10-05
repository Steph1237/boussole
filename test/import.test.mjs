import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const I = require("../web/src/import.js");

const HEAD = "nom;isin;enveloppe;titulaire;poche;quantite;pru;valeur;statut";

test("séparateur : point-virgule, virgule, tabulation", () => {
  assert.equal(I.detectSep(HEAD + "\nA;;;;;;;1;"), ";");
  assert.equal(I.detectSep("nom,isin,valeur\nLivret,,1"), ",");
  assert.equal(I.detectSep("nom\tvaleur\nLivret\t1"), "\t");
  // une virgule entre guillemets dans l'en-tête ne compte pas
  assert.equal(I.detectSep('"nom, libellé";valeur\nA;1'), ";");
});

test("virgules entre guillemets, guillemets doublés, retour à la ligne dans une cellule", () => {
  const csv = 'nom,isin,quantite,valeur\n"Fonds ""Prudent"", part C",,,"1 234,56"\n"Ligne\nsur deux",,,10\n';
  const r = I.parseCSV(csv);
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].name, 'Fonds "Prudent", part C');
  assert.equal(r.rows[0].value, 1234.56);
  assert.equal(r.rows[1].name, "Ligne\nsur deux");
  assert.equal(r.lignes[1].ligne, 3);
});

test("décimales françaises et normalisation identique à l'assistant", () => {
  const csv = "﻿" + HEAD + "\r\nAmundi MSCI World;fr0011869353;PEA;p2;Monde;12,5;4,80;;actif\r\nLivret A;;Livrets;;Épargne;;;12 000,50;\r\n";
  const r = I.parseCSV(csv);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.rows[0], { name: "Amundi MSCI World", isin: "FR0011869353", envelope: "PEA", owner: "p2", bloc: "Monde", mode: "market", qty: 12.5, pru: 4.8, value: null, status: "actif" });
  assert.deepEqual(r.rows[1], { name: "Livret A", isin: null, envelope: "Livrets", owner: "p1", bloc: "Épargne", mode: "manual", qty: null, pru: null, value: 12000.5, status: "actif" });
});

test("en-têtes : casse, accents, synonymes ; colonnes inconnues signalées", () => {
  const csv = "Libellé;Code ISIN;Compte;Propriétaire;Catégorie;Quantité;Prix de revient;Montant;État;Commentaire\n" +
    "ETF Monde;IE00B4L5Y983;CTO;Sam;Actions;3;80;;à recevoir;x\n";
  const r = I.parseCSV(csv, { people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }] });
  assert.deepEqual(r.erreurs, []);
  const x = r.rows[0];
  assert.equal(x.name, "ETF Monde");
  assert.equal(x.isin, "IE00B4L5Y983");
  assert.equal(x.envelope, "CTO");
  assert.equal(x.owner, "p2", "le prénom de p2 est reconnu");
  assert.equal(x.bloc, "Actions");
  assert.equal(x.qty, 3);
  assert.equal(x.pru, 80);
  assert.equal(x.status, "à recevoir");
  assert.ok(r.avertissements.some(w => /Commentaire/.test(w)));
});

test("erreurs par ligne, numérotées comme dans le fichier", () => {
  const csv = HEAD + "\n\nBon;;PEA;p1;Monde;;;100;\n;;PEA;p1;;;;5;\nMauvais ISIN;XX12;PEA;p1;;3;;;\nSans montant;;PEA;p1;;;;;\n";
  const r = I.parseCSV(csv);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.erreurs, [
    "Ligne 4 : nom manquant.",
    "Ligne 5 : ISIN « XX12 » invalide.",
    "Ligne 6 : indiquez une quantité (titre coté) ou une valeur (livret, fonds euros…).",
  ]);
  assert.deepEqual(r.lignes.map(l => [l.ligne, l.ok]), [[3, true], [4, false], [5, false], [6, false]]);
});

test("fichier vide, en-tête seul, colonnes obligatoires absentes", () => {
  assert.deepEqual(I.parseCSV("").erreurs, ["Le fichier est vide."]);
  assert.deepEqual(I.parseCSV("﻿ \n;;\n").erreurs, ["Le fichier est vide."]);
  assert.match(I.parseCSV(HEAD + "\n").erreurs[0], /Aucune ligne/);
  assert.match(I.parseCSV("isin;valeur\nFR0011869353;3\n").erreurs[0], /colonne « nom » introuvable/);
  assert.match(I.parseCSV("nom;isin\nA;FR0011869353\n").erreurs[0], /quantite.*valeur/);
});

test("le modèle téléchargeable s'importe sans erreur", () => {
  const r = I.parseCSV(I.template());
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[2].value, 8500.5);
  assert.equal(r.rows[2].owner, "p2");
});
