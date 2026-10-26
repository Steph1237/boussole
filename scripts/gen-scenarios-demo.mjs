// Génère web/src/scenarios-catalogue.gen.js (global ScenariosCatalogue, module CommonJS sous Node) depuis les cas de référence des scénarios
// (test/fixtures/scenarios-cas.json, qui fait foi, spec SCN1 § 13.1) :
//   - catalogue : les entrées publiées (statut « publie ») de FIXTURE.catalogue, dans leur ordre, sans les identifiants des cas d'évaluation ni
//     les consignes du connecteur à Claude (ouverture, garde_fous), inutiles à l'app ;
//   - reperes : les repères des scénarios au format de l'app (forme de Reperes.depuisLignes), assemblés comme pour les tests par
//     reperesDesCas() (migrations 0010, 0029 et 0032, repères de la projection, puis ceux de la fixture des scénarios, qui l'emportent) ;
//   - reperes_scenarios : les clés que lisent les scénarios (fixture et repères exigés par chaque calcul), seules ajoutées à la démo.
// Le catalogue embarqué sert de repli quand la table publique `scenarios` n'existe pas encore (migration 0038 à venir) et à la démo ;
// la démo ajoute les repères qui lui manquent (store-demo.js), sans écraser les siens. La fixture est relue à chaque génération : une entrée
// ajoutée au catalogue de la fixture apparaît après `npm run gen`. test/scenarios-view.test.mjs échoue si le fichier n'est plus à jour.
// Usage : npm run gen (node scripts/gen-scenarios-demo.mjs).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reperesDesCas } from "../test/helpers/scenarios-cas.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const racine = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
export const SOURCE = "test/fixtures/scenarios-cas.json";
export const CIBLE = "web/src/scenarios-catalogue.gen.js";

/** Contenu du fichier généré (chaîne), d'après la fixture lue à l'instant. */
export function generer() {
  const fixture = JSON.parse(readFileSync(racine(SOURCE), "utf8"));
  const catalogue = (fixture.catalogue || []).filter(e => e && e.statut === "publie").map(e => {
    const o = Object.assign({}, e);
    /* evals (cas du banc), ouverture et garde_fous (consignes du connecteur à Claude) ne servent pas à l'app : non embarqués */
    for (const k of ["evals", "ouverture", "garde_fous"]) delete o[k];
    return o;
  });
  const reperes = reperesDesCas().sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
  /* Repères que lisent les scénarios : ceux de la fixture (§ 8.2 et § 8.4) et ceux que chaque calcul exige (Scenarios.jouer sans repère les nomme tous :
     reperes_manquants) ; la démo n'ajoute que ceux-là à ses propres repères. */
  const Sc = require("../web/src/scenarios.js");
  const requis = new Set((fixture.reperes || []).map(r => r.cle));
  catalogue.forEach(e => {
    (e.reperes || []).forEach(k => requis.add(k));
    try { (Sc.jouer(e, { positions: [], reperes: [] }, {}, "2026-01-01", { chemins: 1 }).reperes_manquants || []).forEach(k => requis.add(k)); } catch (err) { /* calcul inconnu : seulement les repères déclarés */ }
  });
  const reperes_scenarios = [...requis].filter(k => reperes.some(r => r.cle === k)).sort();
  const json = JSON.stringify({ catalogue, reperes, reperes_scenarios }, null, 1);
  return "/* @genere:scenarios-catalogue (scripts/gen-scenarios-demo.mjs, npm run gen ; ne pas modifier à la main).\n" +
    "   Catalogue des scénarios publiés et repères qu'ils lisent, repris de " + SOURCE + " (et des migrations des repères) : repli de l'app quand la\n" +
    "   table publique scenarios n'existe pas encore, et données de la démo. " + catalogue.length + " scénarios, " + reperes.length + " repères (dont " + reperes_scenarios.length + " lus par les scénarios). */\n" +
    "(function (root) {\n" +
    "  const ScenariosCatalogue = " + json.replace(/\n/g, "\n  ") + ";\n" +
    "  if (typeof module === \"object\" && module.exports) module.exports = ScenariosCatalogue;\n" +
    "  else root.ScenariosCatalogue = ScenariosCatalogue;\n" +
    "})(typeof self !== \"undefined\" ? self : this);\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(racine(CIBLE), generer());
  console.log("écrit : " + CIBLE + " (catalogue des scénarios et repères)");
}
