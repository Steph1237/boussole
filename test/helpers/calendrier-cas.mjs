// Cas de référence du calendrier (test/fixtures/calendrier-cas.json) : mise en forme commune au moteur de l'app, au portage du
// connecteur (test/calendrier-mcp.test.mjs) et à leurs tests de parité. Données fictives uniquement.
import { readFileSync } from "node:fs";

export const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/calendrier-cas.json", import.meta.url), "utf8"));

/** Entrée du moteur pour un cas : repères de la fixture (ou ceux du cas, moins `reperes_retirer`, avec `reperes_remplacer`). */
export function entreeDe(cas) {
  const d = JSON.parse(JSON.stringify(cas.data));
  let reperes = d.reperes || JSON.parse(JSON.stringify(FIXTURE.reperes));
  if (d.reperes_retirer) reperes = reperes.filter(r => !d.reperes_retirer.includes(r.cle));
  if (d.reperes_remplacer) for (const r of d.reperes_remplacer) reperes = reperes.map(x => (x.cle === r.cle ? r : x));
  delete d.reperes_retirer;
  delete d.reperes_remplacer;
  d.reperes = reperes;
  return d;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Sortie du moteur réduite à ce que compare la fixture (conventions du fichier). */
export function reduit(sortie) {
  return {
    jalons: sortie.jalons.map(j => ({ cle: j.cle, date: j.date, statut: j.statut, confiance: j.confiance, enveloppe: j.enveloppe })),
    a_completer: sortie.a_completer.map(a => ({ enveloppe: a.enveloppe, champ: a.champ })).sort((a, b) => cmp(a.enveloppe, b.enveloppe) || cmp(a.champ, b.champ)),
    seuils: sortie.seuils.map(s => ({ cle: s.cle, enveloppe: s.enveloppe, verse: s.verse, plafond: s.plafond, reste: s.reste })).sort((a, b) => cmp(a.enveloppe, b.enveloppe) || cmp(a.cle, b.cle)),
    regles_indisponibles: sortie.regles_indisponibles.map(r => ({ cle: r.cle, reperes_manquants: [...r.reperes_manquants].sort() })).sort((a, b) => cmp(a.cle, b.cle)),
  };
}
/** Attendu de la fixture, avec les mêmes tris. */
export function attenduDe(cas) {
  const a = cas.attendu;
  return {
    jalons: a.jalons,
    a_completer: [...a.a_completer].sort((x, y) => cmp(x.enveloppe, y.enveloppe) || cmp(x.champ, y.champ)),
    seuils: [...a.seuils].sort((x, y) => cmp(x.enveloppe, y.enveloppe) || cmp(x.cle, y.cle)),
    regles_indisponibles: a.regles_indisponibles.map(r => ({ cle: r.cle, reperes_manquants: [...r.reperes_manquants].sort() })).sort((x, y) => cmp(x.cle, y.cle)),
  };
}
