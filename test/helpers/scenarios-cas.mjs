// Cas de référence des scénarios (test/fixtures/scenarios-cas.json) : chargement, repères complets, données d'un cas.
// Les repères d'un cas = migrations 0010, 0029 et 0032, repères de la projection (projection-cas.json), puis ceux de scenarios-cas.json (qui l'emportent),
// moins `reperes_retirer`. Données fictives uniquement.
import { readFileSync } from "node:fs";
import { reperesDeMigration, FIXTURE as FIXTURE_PROJ } from "./projection-cas.mjs";

export const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/scenarios-cas.json", import.meta.url), "utf8"));
export const cas = id => FIXTURE.cas.find(c => c.id === id);
export const entreeCatalogue = cle => JSON.parse(JSON.stringify(FIXTURE.catalogue.find(e => e.cle === cle)));

let cache = null;
const versRepere = r => ({ cle: r.cle, libelle: r.libelle, valeur: r.valeur, unite: r.unite, dateEffet: r.dateEffet, dateFin: r.dateFin, sourceTitre: r.sourceTitre, sourceUrl: r.sourceUrl, verifieLe: r.verifieLe });
export function reperesDesCas() {
  if (!cache) {
    const m = new Map([...reperesDeMigration("0010_savoir_reperes.sql"), ...reperesDeMigration("0029_calendrier.sql"), ...reperesDeMigration("0032_suivi.sql")]);
    for (const r of FIXTURE_PROJ.reperes) m.set(r.cle, versRepere(r));
    for (const r of FIXTURE.reperes) m.set(r.cle, versRepere(r));
    cache = [...m.values()];
  }
  return JSON.parse(JSON.stringify(cache));
}

/** Réglages de test d'un cas (clés de data_patch qui ne sont pas des champs de l'app). */
const REGLAGES = ["plafond_per_annuel_suppose", "revenu_net_imposable", "parts"];

function poser(obj, chemin, valeur) {
  /* clé à points ; « config.enveloppes_infos.<nom> » : tout ce qui suit est le nom de l'enveloppe ; positions.<id>.<champ> : ligne existante */
  let cles;
  const pre = "config.enveloppes_infos.";
  if (chemin.startsWith(pre)) cles = ["config", "enveloppes_infos", chemin.slice(pre.length)];
  else cles = chemin.split(".");
  let cur = obj;
  for (let i = 0; i < cles.length - 1; i++) {
    const k = cles[i];
    if (Array.isArray(cur)) cur = cur.find(x => x && x.id === k);
    else { if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {}; cur = cur[k]; }
  }
  const dernier = cles[cles.length - 1];
  if (Array.isArray(cur)) { const x = cur.find(y => y && y.id === dernier); Object.assign(x, valeur); return; }
  if (valeur === null) delete cur[dernier]; else cur[dernier] = valeur;
}

/** Données (forme de l'app) d'un cas : foyer_base + data_patch + today + repères ; { data, reglages }. */
export function dataDe(c) {
  const racine = c.plan_de && !c.data_patch ? c : c;
  const d = JSON.parse(JSON.stringify(FIXTURE.foyer_base)), reglages = {};
  for (const [k, v] of Object.entries(racine.data_patch || {})) {
    if (REGLAGES.includes(k)) reglages[k] = v;
    else if (k === "today") d.today = v;
    else if (k.endsWith("+")) { const cible = k.slice(0, -1); (d[cible] = d[cible] || []).push(...JSON.parse(JSON.stringify(v))); }
    else poser(d, k, JSON.parse(JSON.stringify(v)));
  }
  d.today = c.today || d.today;
  let reperes = reperesDesCas();
  const retirer = c.reperes_retirer || [];
  if (retirer.length) reperes = reperes.filter(r => !retirer.includes(r.cle));
  d.reperes = reperes;
  return { data: d, reglages };
}

/** Frais fictifs donnés par la fixture pour les cas qui n'en portent pas dans leurs réponses (TER, contrat, PER). */
export function fraisDeCas(c) {
  const f = { ter_pct: c.ter_pct != null ? c.ter_pct : 0.2 };
  if (c.scenario === "prochain_euro" || c.scenario === "per_interet") Object.assign(f, { assurance_vie_pct: 0.6, fonds_euros_pct: 0.6, per_pct: 0.7, pea_pct: 0, compte_titres_pct: 0 });
  if (c.scenario === "matelas") Object.assign(f, { ter_pct: 0.2 });
  return f;
}
