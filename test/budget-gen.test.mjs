// BUD1 : copie générée du moteur du budget (supabase/functions/mcp/budget.gen.js, npm run gen) — à jour, et mêmes résultats que le module de l'app
// (note du mois S1 à S15, cible en vigueur, cible proposée T1 à T4, pistes). Le connecteur et l'app font les mêmes calculs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { genererBudget, SORTIE_BUDGET_MOTEUR } from "../scripts/gen-catalogue.mjs";
import { chargerBudgetGen, lireGen } from "./helpers/budget-gen.mjs";

const require = createRequire(import.meta.url);
const F = JSON.parse(readFileSync(new URL("./fixtures/budget-cas.json", import.meta.url), "utf8"));
const B = require("../web/src/budget.js");
const J = v => JSON.parse(JSON.stringify(v));
const G = chargerBudgetGen(lireGen(SORTIE_BUDGET_MOTEUR));

test("copie générée du moteur du budget : à jour (npm run gen), sans import, exports Budget et BudgetCategories", () => {
  assert.equal(lireGen(SORTIE_BUDGET_MOTEUR), genererBudget(), "mcp/budget.gen.js périmé : lancer npm run gen");
  assert.doesNotMatch(genererBudget(), /^import /m);
  assert.deepEqual(Object.keys(G).sort(), ["Budget", "BudgetCategories"]);
  assert.deepEqual(Object.keys(G.Budget).sort(), Object.keys(B).sort());
  const src = readFileSync(new URL("../web/src/budget.js", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, "");
  assert.ok(genererBudget().includes("\n" + src + "\n});"), "source recopiée telle quelle");
});

test("copie générée du moteur du budget : mêmes résultats que l'app (notes, cible en vigueur, cible proposée, pistes)", () => {
  const moisDe = r => ({ revenus: r.revenus, blocs: { essentiels: r.essentiels, envies: r.envies, epargne: 0 }, a_classer: r.a_classer, lisse: r.annuelles ? { annuelles: r.annuelles } : undefined, couverture: r.mois_complet === false ? { mois_complet: false } : {} });
  for (const c of F.score.cas) { const { note, ...cible } = c.cible || {}; assert.deepEqual(J(G.Budget.score(moisDe(c.reel), c.cible ? cible : null)), J(B.score(moisDe(c.reel), c.cible ? cible : null)), c.id); }
  const config = { budget_cible: { historique: F.score.cible_en_vigueur.historique } };
  for (const m of Object.keys(F.score.cible_en_vigueur.attendu)) assert.deepEqual(J(G.Budget.cibleEnVigueur(config, "foyer", m)), J(B.cibleEnVigueur(config, "foyer", m)), m);
  for (const c of F.cible.filter(x => x.pistes)) {
    const e = { reference: c.reference, capacite_constatee: c.capacite_constatee, epargne_necessaire: c.epargne_necessaire ?? null, matelas_mensuel: c.matelas_mensuel ?? 0, pistes: c.pistes, protegees: c.protegees, plancher: c.plancher };
    assert.deepEqual(J(G.Budget.proposerCible({}, e)), J(B.proposerCible({}, e)), c.id);
  }
  const data = { aujourdhui: "2026-10-15", reference: F.cible[0].reference, marchands: [{ mois: "2026-09-01", compte_id: 10, cle_marchand: "cotisation carte visa", sous_categorie: "frais_bancaires", entrees: 0, sorties: 240, nombre: 12 }],
    operations: [], comptes: [], preferences: { protegees: ["sport"] }, reperes: F.reperes };
  assert.deepEqual(J(G.Budget.pistes(data)), J(B.pistes(data)));
  assert.deepEqual(J(G.Budget.comparerInsee(F.cible[4].reference, F.reperes, { logement: "locataire" })), J(B.comparerInsee(F.cible[4].reference, F.reperes, { logement: "locataire" })));
});

test("copie générée du moteur du budget : mêmes mois, séries, références et données que l'app (D2, D7, lissage), Calc et Periodes comprises", () => {
  const D2 = F.double_compte.find(c => c.id === "D2");
  const ligne = (m, compte, sous, entrees, sorties) => ({ mois: m + "-01", compte_id: compte, categorie: G.BudgetCategories.largeDe(sous), sous_categorie: sous, entrees, sorties, nombre: 1 });
  const rows = [];
  for (const m of ["2026-07", "2026-08", "2026-09"]) D2.lignes.forEach(l => rows.push(ligne(m, l.compte, l.sous_categorie, l.entrees, l.sorties)));
  rows.push(ligne("2026-08", "c1", "assurances", 0, 600));
  const S = { banque: { actif: true, comptes: D2.comptes.map(c => ({ id: c.id, nom: c.libelle, type: c.type, titulaire: c.titulaire })), mois: rows,
    marchands: [{ mois: "2026-08-01", compte_id: "c1", cle_marchand: "maif", sous_categorie: "assurances", entrees: 0, sorties: 600, nombre: 1 }] }, config: { partage: D2.partage } };
  const da = B.donnees(S, { aujourdhui: "2026-10-16" }), dg = G.Budget.donnees(S, { aujourdhui: "2026-10-16" });
  assert.deepEqual(J(dg), J(da));
  for (const o of [{ vue: "tout" }, { vue: "commun" }, { vue: "perso", personne: "p1" }, { vue: "perso", personne: "p2" }]) {
    assert.deepEqual(J(G.Budget.mois(dg, { ...o, mois: "2026-08" })), J(B.mois(da, { ...o, mois: "2026-08" })), JSON.stringify(o));
    assert.deepEqual(J(G.Budget.serie(dg, { ...o, du: "2026-07", au: "2026-09", granularite: "trimestre" })), J(B.serie(da, { ...o, du: "2026-07", au: "2026-09", granularite: "trimestre" })));
    assert.deepEqual(J(G.Budget.reference(dg, o)), J(B.reference(da, o)));
  }
});
