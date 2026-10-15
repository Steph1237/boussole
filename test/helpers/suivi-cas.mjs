// Exécution des cas de référence de test/fixtures/suivi-cas.json (tâche 0 de SUIVI) contre un moteur Suivi :
// utilisé par test/suivi.test.mjs (moteur de l'app) et test/suivi-mcp.test.mjs (copie générée du connecteur, parité).
// Conventions de comparaison : voir `conventions.comparaison` de la fixture. Seuls les champs de `attendu` sont comparés ;
// les nombres le sont à `tolerance` près (0,01 par défaut) ; `declencheurs` est une liste exhaustive restreinte aux clés de `comparer`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/suivi-cas.json", import.meta.url)), "utf8"));
export const CAS = FIXTURE.cas;
/** Familles évaluées par le moteur de la phase 1 et 2 ; EX (croisement, phase 4) et SE (Ta semaine, phase 6) viennent plus tard. */
export const FONCTIONS_PHASES_1_2 = new Set(["roleParDefaut", "politique", "systeme", "declencheurs", "vautLeCout", "meteo", "habitudes", "exposition", "maSemaine"]);
export const J = v => JSON.parse(JSON.stringify(v));

/** Données d'un cas : copie, avec les repères de la fixture sauf `reperes_retirer`. */
export function donneesDe(c) {
  const data = J(c.data);
  if (!data.reperes) {
    const retirer = new Set(c.reperes_retirer || []);
    data.reperes = J(FIXTURE.reperes).filter(r => !retirer.has(r.cle));
  }
  return data;
}

/** Exécute un cas : renvoie la sortie du moteur, ramenée à la forme de `attendu`. */
export function executer(Suivi, c) {
  const data = donneesDe(c), today = c.today;
  switch (c.fonction) {
    case "roleParDefaut": return Suivi.roleParDefaut(data.ligne, data.instrument, data.objectifs, today, { reperes: FIXTURE.reperes });
    case "politique": return Suivi.politique(data, today);
    case "systeme": return Suivi.systeme(data, today);
    case "declencheurs": {
      const tous = Suivi.declencheurs(data, today, c.options || {});
      const cles = c.comparer || null;
      return { declencheurs: cles ? tous.filter(d => cles.includes(d.cle)) : tous };
    }
    case "vautLeCout": return Suivi.vautLeCout(c.entree, data, Object.assign({ today }, c.options || {}));
    case "meteo": {
      const constats = Suivi.constats(data, c.entree.position_id, today);
      const role = Suivi.roleEffectif(data, c.entree.position_id, today);
      const m = Suivi.meteo(constats, role, c.entree.revue || null, today);
      const map = {}, mesures = {};
      constats.forEach(k => { map[k.cle] = k.statut; mesures[k.cle] = k.mesure && k.mesure.valeur; });
      return Object.assign({}, m, { constats: map, mesures });
    }
    case "habitudes": return { habitudes: Suivi.habitudes(data, today) };
    case "exposition": return Suivi.exposition(data, c.entree.evenement, today);
    case "maSemaine": {
      const r = Suivi.maSemaine(data, c.entree.evenements, today);
      const a = r.cartes.find(x => x.type === "a_faire");
      return { nb_cartes: r.cartes.length, types: r.cartes.map(x => x.type), a_faire_texte: a ? a.texte : null };
    }
    default: throw new Error("fonction non gérée : " + c.fonction);
  }
}

const estNombre = v => typeof v === "number";
function textes(actuel, cles) { return JSON.stringify(cles.map(k => actuel == null ? null : actuel[k])).toLowerCase(); }

/** Compare `actuel` à `attendu` (seulement les champs de `attendu`) ; renvoie la liste des écarts (vide si conforme). */
export function comparer(actuel, attendu, tol, chemin = "") {
  const ecarts = [];
  const e = (msg) => ecarts.push(chemin + " : " + msg);
  if (attendu === null) { if (actuel !== null && actuel !== undefined) e("attendu null, obtenu " + JSON.stringify(actuel)); return ecarts; }
  if (estNombre(attendu)) {
    if (!estNombre(actuel) || Math.abs(actuel - attendu) > tol) e("attendu " + attendu + ", obtenu " + JSON.stringify(actuel));
    return ecarts;
  }
  if (typeof attendu === "string" || typeof attendu === "boolean") {
    if (actuel !== attendu) e("attendu " + JSON.stringify(attendu) + ", obtenu " + JSON.stringify(actuel));
    return ecarts;
  }
  if (Array.isArray(attendu)) {
    if (!Array.isArray(actuel)) { e("attendu un tableau, obtenu " + JSON.stringify(actuel)); return ecarts; }
    if (actuel.length !== attendu.length) { e("longueur " + attendu.length + " attendue, " + actuel.length + " obtenue : " + JSON.stringify(actuel).slice(0, 400)); return ecarts; }
    attendu.forEach((x, i) => ecarts.push(...comparer(actuel[i], x, tol, chemin + "[" + i + "]")));
    return ecarts;
  }
  if (typeof attendu === "object") {
    if (actuel === null || typeof actuel !== "object") { e("attendu un objet, obtenu " + JSON.stringify(actuel)); return ecarts; }
    for (const [k, v] of Object.entries(attendu)) {
      if (k.endsWith("_contient")) {
        const base = k.slice(0, -"_contient".length), t = textes(actuel, [base]);
        for (const s of v) if (!t.includes(String(s).toLowerCase())) e(base + " devrait contenir « " + s + " » : " + t.slice(0, 300));
      } else ecarts.push(...comparer(actuel[k], v, tol, chemin + "." + k));
    }
    return ecarts;
  }
  return ecarts;
}

/** Compare la sortie d'un cas `declencheurs` : liste exhaustive (ordre indifférent), appariée par (cle, cible/position), champs de l'attendu seulement. */
function comparerDeclencheurs(sortie, c, tol) {
  const att = c.attendu.declencheurs, ecarts = [];
  const liste = sortie.declencheurs;
  if (liste.length !== att.length) return ["declencheurs : " + att.length + " attendu(s), " + liste.length + " obtenu(s) : " + JSON.stringify(liste.map(d => d.cle + ":" + d.visible + ":" + d.raison_visibilite))];
  const reste = liste.slice();
  for (const a of att) {
    const i = reste.findIndex(d => comparer(d, a, tol).length === 0);
    if (i < 0) {
      const proche = reste.find(d => d.cle === a.cle) || reste[0];
      ecarts.push("declencheur " + a.cle + " : " + comparer(proche, a, tol).join(" ; "));
    } else reste.splice(i, 1);
  }
  for (const [k, sens] of [["titre_contient", true], ["titre_exclut", false]]) {
    for (const s of c.attendu[k] || []) for (const d of liste) {
      if (String(d.titre).toLowerCase().includes(String(s).toLowerCase()) !== sens) ecarts.push("titre « " + d.titre + " » " + (sens ? "devrait contenir" : "ne devrait pas contenir") + " « " + s + " »");
    }
  }
  return ecarts;
}

/** Écarts d'un cas (liste vide = conforme). */
export function ecartsDuCas(Suivi, c) {
  const sortie = executer(Suivi, c), tol = c.tolerance == null ? 0.01 : c.tolerance;
  if (c.fonction === "declencheurs") return comparerDeclencheurs(sortie, c, tol);
  if (c.fonction === "habitudes") {
    const ecarts = [];
    for (const a of c.attendu.habitudes) {
      const h = sortie.habitudes.find(x => x.cle === a.cle);
      if (!h) ecarts.push("habitude " + a.cle + " absente");
      else ecarts.push(...comparer(h, a, tol, "habitude " + a.cle));
    }
    return ecarts;
  }
  if (c.fonction === "meteo") {
    const { constats, mesures, ...reste } = c.attendu, ecarts = comparer(sortie, reste, tol);
    const obtenus = Object.keys(sortie.constats).sort(), voulus = Object.keys(constats).sort();
    if (JSON.stringify(obtenus) !== JSON.stringify(voulus)) ecarts.push("constats applicables : attendu " + voulus + ", obtenu " + obtenus);
    for (const k of voulus) if (sortie.constats[k] !== constats[k]) ecarts.push("constat " + k + " : attendu " + constats[k] + ", obtenu " + sortie.constats[k]);
    for (const [k, v] of Object.entries(mesures || {})) if (!(Math.abs(sortie.mesures[k] - v) <= tol)) ecarts.push("mesure " + k + " : attendu " + v + ", obtenu " + sortie.mesures[k]);
    return ecarts;
  }
  return comparer(sortie, c.attendu, tol);
}
