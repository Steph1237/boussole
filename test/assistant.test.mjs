import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const A = require("../web/src/assistant.js");

test("nombre : formats français, anglais, symboles", () => {
  assert.equal(A.num("1 234,56 €"), 1234.56);
  assert.equal(A.num("1 234,56"), 1234.56);
  assert.equal(A.num("1,234.56"), 1234.56);
  assert.equal(A.num("1.234,56"), 1234.56);
  assert.equal(A.num("42 000"), 42000);
  assert.equal(A.num("30 %"), 30);
  assert.equal(A.num(" 2500 "), 2500);
  assert.equal(A.num(1200), 1200);
  assert.equal(A.num("environ"), null);
  assert.equal(A.num(null), null);
});

test("extraction : bloc ```json au milieu de texte", () => {
  const t = "Voici votre profil :\n```json\n{\"foyer\":{\"adultes\":2}}\n```\nN'hésitez pas !";
  assert.deepEqual(A.extract(t), { foyer: { adultes: 2 } });
});

test("extraction : objet nu entouré de phrases, accolades dans des chaînes", () => {
  const t = 'Bien sûr. {"biens":[{"nom":"Studio {Lyon}","valeur":"150 000 €"}]} Bonne journée.';
  assert.deepEqual(A.extract(t), { biens: [{ nom: "Studio {Lyon}", valeur: "150 000 €" }] });
});

test("extraction : tableau de positions", () => {
  const t = "```\n[{\"nom\":\"ETF World\",\"isin\":\"FR0011869353\",\"quantite\":10}]\n```";
  assert.equal(A.extract(t).length, 1);
});

test("extraction : rien de lisible → erreur claire", () => {
  assert.throws(() => A.extract("Je n'ai pas compris votre question."), /Aucun JSON/);
  assert.throws(() => A.extract('{"foyer": {"adultes": 2,}'), /JSON illisible/);
});

test("profil : normalisation complète et valeurs françaises", () => {
  const r = A.parse(`\`\`\`json
{
  "foyer": {"adultes": "2", "enfants": 1, "enfants14": 0, "union": "pacsé", "age": 34, "tmi": "30 %"},
  "personnes": {
    "p1": {"nom": "Camille", "salaire": "3 200 €", "salaireUnite": "net/mois", "statut": "cadre", "essai": "non"},
    "p2": {"nom": "Sam", "salaire": 38000, "salaireUnite": "brut/an", "statut": "non-cadre"}
  },
  "biens": [{"nom": "Appartement", "usage": "résidence principale", "valeur": "240 000", "part_p1": "50 %", "crd": "150 000", "mensualite": "820", "loyer": 0}],
  "credits": [{"nom": "Auto", "titulaire": "commun", "crd": "8 000", "mensualite": 250}]
}
\`\`\``, "profil");
  assert.deepEqual(r.erreurs, []);
  const d = r.data;
  assert.equal(d.foyer.adultes, 2);
  assert.equal(d.foyer.union, "joint");
  assert.equal(d.foyer.age, "a30");
  assert.equal(d.foyer.tmi, 30);
  assert.equal(d.personnes.p1.salaire, 3200);
  assert.equal(d.personnes.p1.salaireUnite, "nm");
  assert.equal(d.personnes.p1.essai, false);
  assert.equal(d.personnes.p2.salaireUnite, "ba");
  assert.equal(d.personnes.p2.statut, "nc");
  assert.equal(d.biens[0].usage, "rp");
  assert.equal(d.biens[0].part_p1, 50);
  assert.equal(d.credits[0].owner, "commun");
});

test("profil : erreurs bloquantes et avertissements", () => {
  const r = A.parse('{"foyer":{"tmi":25},"biens":[{"nom":"X","valeur":100000,"part_p1":140,"crd":120000}]}', "profil");
  assert.ok(r.erreurs.some(e => /tranche/i.test(e)));
  assert.ok(r.erreurs.some(e => /quote-part/i.test(e)));
  assert.ok(r.avertissements.some(e => /dépasse/i.test(e)));
});

test("positions : normalisation, ISIN, statut, erreurs par ligne", () => {
  const r = A.parse(JSON.stringify({ positions: [
    { nom: "Amundi MSCI World", isin: "fr0011869353", enveloppe: "PEA", titulaire: "p1", poche: "Monde", quantite: "12,5", pru: "4,80 €" },
    { nom: "Livret A", enveloppe: "Livrets", titulaire: "p2", valeur: "12 000 €" },
    { nom: "", isin: "XX123", quantite: 3 },
  ] }), "positions");
  const [a, b] = r.data;
  assert.equal(r.data.length, 2);
  assert.equal(a.isin, "FR0011869353");
  assert.equal(a.mode, "market");
  assert.equal(a.qty, 12.5);
  assert.equal(a.pru, 4.8);
  assert.equal(b.mode, "manual");
  assert.equal(b.value, 12000);
  assert.equal(b.owner, "p2");
  assert.equal(r.erreurs.length, 1);
  assert.match(r.erreurs[0], /Ligne 3/);
});

test("positions : un tableau nu est accepté", () => {
  const r = A.parse('[{"nom":"BTC","enveloppe":"Crypto","poche":"Crypto","valeur":1500}]', "positions");
  assert.equal(r.data[0].value, 1500);
  assert.deepEqual(r.erreurs, []);
});

test("prompt : contient le schéma et la consigne de ne rien inventer", () => {
  for (const k of ["profil", "positions"]) {
    const p = A.prompt(k);
    assert.match(p, /```json/);
    assert.match(p, /n'invente/i);
  }
});

test("fusion : champs remplacés, biens appariés par nom, changements lisibles", () => {
  const cur = {
    foyer: { adultes: 2, enfants: 0, age: "a30", tmi: 11 },
    personnes: { p1: { nom: "Camille", salaire: 2800, salaireUnite: "nm", statut: "cadre" }, p2: { nom: "Sam", salaire: 2300 } },
    biens: [{ id: "b1", nom: "Appartement", usage: "rp", valeur: 240000, part_p1: 50, crd: 150000, mensualite: 820, loyer: 0 }],
    credits: [],
  };
  const { data } = A.parse(JSON.stringify({
    foyer: { tmi: 30, age: 34 },
    personnes: { p1: { salaire: "3 000" } },
    biens: [{ nom: "appartement", valeur: 250000 }, { nom: "Studio Lyon", usage: "locatif", valeur: 120000, part_p1: 100, loyer: 550 }],
  }), "profil");
  const r = A.merge(cur, data);
  assert.equal(r.profil.foyer.tmi, 30);
  assert.equal(r.profil.foyer.adultes, 2);
  assert.equal(r.profil.personnes.p1.salaire, 3000);
  assert.equal(r.profil.personnes.p1.statut, "cadre");
  assert.equal(r.profil.personnes.p2.salaire, 2300);
  assert.equal(r.profil.biens.length, 2);
  assert.equal(r.profil.biens[0].id, "b1");
  assert.equal(r.profil.biens[0].valeur, 250000);
  assert.equal(r.profil.biens[0].crd, 150000);
  assert.ok(r.profil.biens[1].id);
  const labels = r.changes.map(c => c.label);
  assert.ok(labels.includes("Tranche d'imposition"));
  assert.ok(r.changes.some(c => c.kind === "ajout" && /Studio Lyon/.test(c.label)));
  assert.ok(!labels.includes("Âge"), "âge inchangé (a30) : pas de changement listé");
  assert.equal(cur.foyer.tmi, 11, "l'entrée n'est pas modifiée");
});

test("fusion : réponse vide → aucun changement", () => {
  const r = A.merge({ foyer: { adultes: 1 }, personnes: {}, biens: [], credits: [] }, { foyer: {}, personnes: {} });
  assert.deepEqual(r.changes, []);
});

test("budget : lignes normalisées, fréquences, catégories et erreurs", () => {
  const r = A.parse(`Voici votre budget :
\`\`\`json
{"lignes":[
  {"type":"dépense","categorie":"Logement","libelle":"Charges de copropriété","montant":"180 €","frequence":"mois"},
  {"type":"depense","categorie":"Impôts","libelle":"Taxe foncière","montant":"1 100","frequence":"annuel"},
  {"type":"épargne","categorie":"Épargne","libelle":"Livret A","montant":300},
  {"type":"revenu","categorie":"Revenus","libelle":"Prime annuelle","montant":"3 000","frequence":"an","titulaire":"p2"},
  {"type":"depense","libelle":"Sans montant"},
  {"type":"cadeau","libelle":"X","montant":10}
]}
\`\`\``, "budget");
  assert.equal(r.data.length, 4);
  const [a, b, c, d] = r.data;
  assert.deepEqual([a.type, a.montant, a.frequence, a.categorie], ["depense", 180, "mois", "Logement"]);
  assert.equal(b.frequence, "an");
  assert.equal(c.type, "epargne");
  assert.equal(d.owner, "p2");
  assert.equal(r.erreurs.length, 2);
  assert.match(r.erreurs[0], /Ligne 5/);
  assert.match(r.erreurs[1], /type/i);
});

test("budget : prompt dédié", () => {
  const p = A.prompt("budget");
  assert.match(p, /budget/i);
  assert.match(p, /"lignes"/);
});
