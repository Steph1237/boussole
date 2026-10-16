// HIS2, phase 2 : adaptation des cas « reconstituer », « qualite » et « deltaTx » de test/fixtures/his2-cas.json aux entrées de Historique.reconstituer
// (résolution des références @mouvements / @releves, rattachement des mouvements d'une ligne clôturée à la ligne du bilan qui a le même ISIN).
import { cas, resoudre, contexteDe, HistoriqueImport } from "./his2.mjs";

const liste = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Mouvements normalisés d'un cas d'import, en transactions du store ; position_id repris de la ligne du bilan de même ISIN quand le mouvement n'en a pas
    (ligne clôturée créée par l'import). */
export function mouvementsDe(id, positions) {
  const c = cas(id), r = HistoriqueImport.verifier(c.type, resoudre(c.entree), contexteDe(c));
  return r.contenu.mouvements.map((m, i) => {
    const ligne = m.position_id ? null : liste(positions).find(p => m.isin && p.isin === m.isin);
    const positionId = m.position_id || (ligne ? ligne.id : null);
    return { id: "tx-" + id + "-" + i, positionId, date: m.date, type: m.type, qty: m.quantite ?? null, price: m.prix ?? null, amount: m.montant ?? null,
      frais: m.frais ?? null, enveloppe: positionId ? null : m.enveloppe_nom, importId: "imp-" + id, source: "import", cleImport: m.cle_import };
  });
}
/** Relevés de valeur d'un cas : les mouvements de type releve portant un montant. */
export function relevesDe(id, positions) {
  return mouvementsDe(id, positions).filter(m => m.type === "releve" && m.amount != null).map(m => ({ positionId: m.positionId, date: m.date, valeur: m.amount, importId: m.importId }));
}

/** Entrée de Historique.reconstituer pour un cas de la fixture. */
export function entreeReconstituer(c) {
  const e = c.entree, positions = e.positions || [];
  const tx = liste(e.tx).flatMap(t => (typeof t === "string" && t.startsWith("@mouvements:") ? mouvementsDe(t.slice(12), positions) : [t]));
  const releves = typeof e.releves === "string" && e.releves.startsWith("@releves:") ? relevesDe(e.releves.slice(9), positions) : e.releves;
  const o = { today: c.today, positions, tx, cours: e.cours || {}, pas: e.pas || "jour" };
  for (const k of ["depuis", "jusqua", "depuisOuverture", "especesSuivies", "soldesMois"]) if (e[k] !== undefined) o[k] = e[k];
  if (releves) o.releves = releves;
  return o;
}
/** Transactions d'un cas « flux » ou « deltaTx » (références résolues). */
export function txDeCas(c) {
  const positions = c.entree.positions || [];
  return liste(c.entree.tx).flatMap(t => (typeof t === "string" && t.startsWith("@mouvements:") ? mouvementsDe(t.slice(12), positions) : [t]));
}
