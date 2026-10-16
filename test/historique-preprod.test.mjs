// HIS2, tâche 9 : fumée en préproduction locale (SEC5) avec un foyer fictif : un import de relevés déposé en proposition par le propriétaire, validé en aal2 par
// appliquer_propositions, relu par l'app (tables du régime bancaire) ; le budget réel sur 12 mois vient alors de Calc.moisBancaires ; un jeton aal1 ne lit rien ;
// retirer_import efface tout. Sans pile locale (BOUSSOLE_SUPABASE_URL…), le test est sauté ; lance `npm run preprod:test`. Données fictives uniquement.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { hasServiceKey, SKIP_REASON, createTestUserAal2, deleteTestUser } from "./helpers/supabase.mjs";
import { HistoriqueImport as H } from "./helpers/his2.mjs";

const require = createRequire(import.meta.url);
const Calc = require("../web/src/calc.js");
const SKIP = !hasServiceKey;

/** Douze mois complets d'un compte courant fictif, jusqu'au mois dernier (catégories larges : avant BUD1). */
function douzeMois(auj) {
  const [a, m] = auj.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const t = a * 12 + (m - 1) - 12 + i, mois = Math.floor(t / 12) + "-" + String(t % 12 + 1).padStart(2, "0");
    return { mois, complet: true, controle: { total_entrees: 3000, total_sorties: 2600 }, sous_categories: [
      { cle: "revenus", entrees: 3000, sorties: 0, nombre: 1 }, { cle: "logement", entrees: 0, sorties: 1200, nombre: 1 },
      { cle: "alimentation", entrees: 0, sorties: 600, nombre: 12 }, { cle: "epargne", entrees: 0, sorties: 500, nombre: 1 }, { cle: "loisirs", entrees: 0, sorties: 300, nombre: 5 }] };
  });
}

describe("HIS2 en préproduction locale : import validé en aal2 → budget réel sur 12 mois", { skip: SKIP ? SKIP_REASON : false }, () => {
  let u;
  before(async () => { u = await createTestUserAal2("his2"); });
  after(async () => { if (u) await deleteTestUser(u.id); });

  it("dépôt, validation en aal2, lecture, budget réel sur 12 mois, aal1 fermé, retrait", async () => {
    const auj = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    const v = H.verifier("releves", { compte: { libelle: "Compte courant Exemple", etablissement: "boursobank", type: "courant", titulaire: "p1" },
      fichier: { format: "csv", periode: { du: "2025-01-01", au: auj } }, mois: douzeMois(auj), accord_utilisateur: true, source: "Export CSV déposé dans la conversation" }, { today: auj, taxonomie: "large" });
    assert.deepEqual(v.bloquants, []);
    const apres = H.versApres("releves", v.contenu, { empreinte: v.empreinte, resume: v.resume, avertissements: v.avertissements, today: auj });
    const ref = randomUUID();
    const ins = await u.client.from("propositions").insert({ cible: "historique", operation: "creer", ref, apres, source: "Export CSV déposé dans la conversation" }).select("id").single();
    assert.equal(ins.error, null, ins.error && ins.error.message);
    const ok = await u.client.rpc("appliquer_propositions", { p_ids: [ins.data.id], p_modifications: {} });
    assert.equal(ok.error, null, ok.error && ok.error.message);
    assert.equal(ok.data, 1);

    const [comptes, releves, lignes] = await Promise.all([
      u.client.from("historique_comptes").select("id, libelle, etablissement, type, titulaire, banque_compte_id, position_id, cle"),
      u.client.from("historique_releves").select("compte_id, mois, complet, solde_debut, solde_fin, total_entrees, total_sorties, nombre, import_id"),
      u.client.from("historique_banque_mois").select("compte_id, mois, categorie, sous_categorie, entrees, sorties, nombre"),
    ]);
    for (const r of [comptes, releves, lignes]) assert.equal(r.error, null, r.error && r.error.message);
    assert.equal(releves.data.length, 12);
    const historique = { comptes: comptes.data, releves: releves.data, banqueMois: lignes.data };
    const r = Calc.budgetReel(null, auj, 12, historique);
    assert.equal(r.n, 12, "12 mois complets");
    assert.equal(r.revenus, 3000);
    assert.equal(r.depenses, 2100);
    assert.equal(r.epargne, 500);
    assert.equal(r.moisImportes, 12);
    assert.equal(Calc.moisBancaires(null, historique, auj).filter(e => e.source === "import").length, 12);

    // le même contenu ne se valide pas deux fois
    const encore = await u.client.from("propositions").insert({ cible: "historique", operation: "creer", ref: randomUUID(), apres, source: "Deuxième dépôt" }).select("id").single();
    const refus = await u.client.rpc("appliquer_propositions", { p_ids: [encore.data.id], p_modifications: {} });
    assert.match(String(refus.error && refus.error.message), /déjà été importé|déjà importé|Something went wrong/);

    // session aal1 : les tables du régime bancaire restent fermées
    const aal1 = await u.nouvelleSessionAal1();
    const ferme = await aal1.from("historique_releves").select("mois");
    assert.deepEqual(ferme.data ?? [], [], "aucune ligne lisible en aal1");
    const retraitAal1 = await aal1.rpc("retirer_import", { p_id: releves.data[0].import_id });
    assert.notEqual(retraitAal1.error, null, "retirer_import exige aal2");

    // retrait par le propriétaire (aal2) : tout ce que l'import a apporté disparaît
    const retire = await u.client.rpc("retirer_import", { p_id: releves.data[0].import_id });
    assert.equal(retire.error, null, retire.error && retire.error.message);
    const apres2 = await u.client.from("historique_releves").select("mois");
    assert.deepEqual(apres2.data, []);
  });
});
