// Mesure du moteur de projection : 2 000 chemins × 300 mois (25 ans) sur un foyer fictif, Node. Usage : node scripts/bench-projection.mjs
// Affiche le temps réel (ms) de la préparation, de la passe déterministe et de la simulation à 500 puis 2 000 chemins, pour trois portefeuilles.
import { createRequire } from "node:module";
import { cas, entreeDe } from "../test/helpers/projection-cas.mjs";
const req = createRequire(import.meta.url);
const P = req("../web/src/projection.js");

function foyer(variante) {
  const d = entreeDe(cas("C-4"));
  if (variante === "simple") {
    d.foyer.evenements = [];
    d.positions = [{ id: "ct", name: "Fonds Exemple", envelope: "Compte-titres Exemple", owner: "p1", bloc: "Monde", mode: "manual", value: 100000, status: "actif", qty: 1000, pru: 100 }];
    d.config.enveloppes_infos = { "Compte-titres Exemple": { type: "compte_titres", titulaire: "p1" } };
    d.config.targets = { actions: 100 }; d.config.projection.reste_capacite = "cible"; d.credits = []; d.profil.credits = [];
  }
  if (variante === "complet") {
    d.positions.push({ id: "pea", name: "ETF Exemple", envelope: "PEA Exemple", owner: "p1", bloc: "Monde", mode: "manual", value: 30000, status: "actif" },
      { id: "ob", name: "Obligations Exemple", envelope: "Compte-titres Exemple", owner: "p1", bloc: "Obligations", mode: "manual", value: 10000, status: "actif", qty: 100, pru: 90 },
      { id: "scpi", name: "SCPI Exemple", envelope: "Assurance vie Exemple", owner: "p1", bloc: "SCPI", mode: "manual", value: 8000, status: "actif" });
    d.config.enveloppes_infos["PEA Exemple"] = { type: "pea", titulaire: "p1", date_ouverture: "2015-01-05", versements_cumules: 25000 };
    d.config.enveloppes_infos["Compte-titres Exemple"] = { type: "compte_titres", titulaire: "p1" };
  }
  return d;
}
const mesure = (nom, f) => { const t0 = performance.now(); const r = f(); const ms = performance.now() - t0; return { nom, ms, r }; };
for (const v of ["simple", "foyer", "complet"]) {
  const d = foyer(v);
  const prep = mesure("préparer", () => P.preparer(d, { horizon_ans: 25, vue: v === "simple" ? "financier" : "net" }));
  const M = prep.r;
  const premier = mesure("passe déterministe + 100 chemins", () => P.simuler(M, { chemins: 100 }));
  const t500 = mesure("500 chemins", () => P.simuler(M, { chemins: 500 }));
  const mesures = [1, 2, 3].map(() => mesure("2 000 chemins", () => P.simuler(M, { chemins: 2000 })).ms);
  console.log(v.padEnd(8), "préparer " + prep.ms.toFixed(0) + " ms · 1er calcul " + premier.ms.toFixed(0) + " ms · 500 chemins " + t500.ms.toFixed(0) + " ms · 2 000 chemins × 300 mois : " + mesures.map(x => x.toFixed(0)).join(" / ") + " ms (" + M.B + " compartiments)");
}
