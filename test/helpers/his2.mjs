// Fixture HIS2 (test/fixtures/his2-cas.json) : chargement, adaptation de la forme « de l'outil » aux lignes des tables et résolution des références.
import { readFileSync } from "node:fs";

export const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/his2-cas.json", import.meta.url), "utf8"));
export const CAS = FIXTURE.cas;
export const cas = id => { const c = CAS.find(x => x.id === id); if (!c) throw new Error("cas HIS2 inconnu : " + id); return c; };
export const parFonction = f => CAS.filter(c => c.fonction === f);
/** Catégorie large d'une clé de sous-catégorie (bloc categories_utilisees de la fixture ; BudgetCategories.largeDe quand le module existe). */
export const largeDe = cle => {
  const l = FIXTURE.categories_utilisees.large[cle];
  if (l) return l;
  if (FIXTURE.categories_utilisees.larges_avant_bud1.includes(cle)) return cle;
  throw new Error("clé de catégorie inconnue : " + cle);
};
const liste = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** historique de la fixture ({ comptes, releves, banqueMois: { compte_id: mois | [mois] } }) → forme des tables lues par le store et le connecteur :
    banqueMois devient la liste plate des lignes de historique_banque_mois ({ compte_id, mois, categorie, sous_categorie, entrees, sorties, nombre }),
    import_id d'un en-tête restant celui de historique.releves. */
export function historiqueDeFixture(h) {
  if (!h) return { comptes: [], releves: [], banqueMois: [] };
  const lignes = [];
  Object.entries(h.banqueMois || {}).forEach(([compte, mois]) => liste(mois).forEach(m => (m.sous_categories || []).forEach(l =>
    lignes.push({ compte_id: compte, mois: m.mois, categorie: largeDe(l.cle), sous_categorie: l.cle, entrees: l.entrees, sorties: l.sorties, nombre: l.nombre }))));
  return { comptes: h.comptes || [], releves: h.releves || [], banqueMois: lignes };
}
