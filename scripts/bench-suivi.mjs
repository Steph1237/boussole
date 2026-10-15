// Mesure du moteur de suivi (SUIVI) : 200 lignes, politique + système + déclencheurs, puis vue complète. Cible : moins de 10 ms (politique, système, déclencheurs).
// Usage : node scripts/bench-suivi.mjs (temps CPU, meilleur de 25 passes après préchauffage ; code de sortie 1 au-delà de 10 ms)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const req = createRequire(import.meta.url);
const Suivi = req("../web/src/suivi.js");
const reperes = JSON.parse(readFileSync(new URL("../test/fixtures/suivi-cas.json", import.meta.url), "utf8")).reperes;
const positions = [], instruments = [];
for (let i = 0; i < 200; i++) {
  const isin = "XX" + String(100000000 + i);
  positions.push({ id: "p" + i, name: "Ligne " + i, envelope: ["PEA Exemple", "Compte-titres Exemple", "Assurance vie Exemple"][i % 3], owner: "p1", bloc: ["Monde", "Europe", "Actions", "Obligations", "Small caps"][i % 5], status: "actif", mode: "market", qty: 10 + i, price: 100, pru: 80, isin });
  instruments.push({ isin, devise: i % 7 ? "EUR" : "USD", ter: 0.1 + (i % 9) * 0.2 });
}
const data = { positions, instruments, config: { enveloppes_infos: { "PEA Exemple": { type: "pea", date_ouverture: "2019-03-10", versements_cumules: 92000 }, "Compte-titres Exemple": { type: "compte_titres" }, "Assurance vie Exemple": { type: "assurance_vie", date_ouverture: "2012-01-10" } }, frais_enveloppes: {}, suivi: { mois_revue_coeur: 10 } },
  profil: { foyer: { adultes: 1 } }, objectifs: [], risque: { profil: "equilibre" }, routines: { passages: [] }, reperes };
const cpu = f => { const c0 = process.cpuUsage(); f(); const c = process.cpuUsage(c0); return (c.user + c.system) / 1000; };
const passe = () => { Suivi.politique(data, "2026-10-15"); Suivi.systeme(data, "2026-10-15"); Suivi.declencheurs(data, "2026-10-15"); };
for (let k = 0; k < 5; k++) passe();
const meilleur = Math.min(...Array.from({ length: 25 }, () => cpu(passe)));
const vue = Math.min(...Array.from({ length: 10 }, () => cpu(() => Suivi.vue(data, "2026-10-15"))));
console.log("politique + système + déclencheurs : " + meilleur.toFixed(1) + " ms (cible < 10 ms) ; vue complète : " + vue.toFixed(1) + " ms");
process.exit(meilleur < 10 ? 0 : 1);
