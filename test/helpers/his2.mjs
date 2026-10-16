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

/* ---------- harnais des cas d'import (HistoriqueImport) ---------- */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const HistoriqueImport = require("../../web/src/historique-import.js");

/** Remplace les spécificateurs de la fixture : { "@generer": … } (listes de copies), « @empreinte:ID », « @mouvements:ID », « @cle:ID#n ». */
export function resoudre(v, type) {
  if (Array.isArray(v)) return v.flatMap(x => { const r = resoudre(x, type); return typeof x === "string" && x.startsWith("@mouvements:") ? r : [r]; });
  if (typeof v === "string") {
    let m;
    if ((m = v.match(/^@empreinte:(.+)$/))) { const c = cas(m[1]); return HistoriqueImport.verifier(c.type, resoudre(c.entree), contexteDe(c)).empreinte; }
    if ((m = v.match(/^@mouvements:(.+)$/))) return mouvementsEnTransactions(m[1]);
    if ((m = v.match(/^@cle:(.+)#(\d+)$/))) { const c = cas(m[1]); return HistoriqueImport.verifier(c.type, resoudre(c.entree), contexteDe(c)).contenu.mouvements[+m[2]].cle_import; }
    return v;
  }
  if (v && typeof v === "object") {
    if (v["@generer"]) {
      const { n, du, pas, champ, modele } = v["@generer"];
      return Array.from({ length: n }, (_, i) => {
        let val;
        if (pas === "jour") val = new Date(Date.parse(du + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10);
        else { const [a, b] = du.split("-").map(Number), t = a * 12 + (b - 1) + i; val = Math.floor(t / 12) + "-" + String(t % 12 + 1).padStart(2, "0"); }
        return { ...JSON.parse(JSON.stringify(modele)), [champ]: val };
      });
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resoudre(x)]));
  }
  return v;
}
/** Mouvements normalisés d'un cas, sous la forme d'une transaction du store (importId « imp-<id> », source « import »). */
export function mouvementsEnTransactions(id) {
  const c = cas(id), r = HistoriqueImport.verifier(c.type, resoudre(c.entree), contexteDe(c));
  return r.contenu.mouvements.map((m, i) => ({ id: "tx-" + id + "-" + i, positionId: m.position_id || null, date: m.date, type: m.type, qty: m.quantite ?? null, price: m.prix ?? null,
    amount: m.montant ?? null, frais: m.frais ?? null, enveloppe: m.position_id ? null : m.enveloppe_nom, importId: "imp-" + id, source: "import", cleImport: m.cle_import }));
}
/** Taxonomie de BUD1 simulée par la fixture (bloc categories_utilisees), tant que BudgetCategories n'est pas dans le dépôt. */
export const TAXONOMIE_FIXTURE = { largeDe: cle => FIXTURE.categories_utilisees.large[cle] || null };
export function contexteDe(c) {
  const ctx = resoudre(c.contexte || {});
  return { today: c.today, ...ctx, taxonomie: ctx.taxonomie === "large" ? "large" : TAXONOMIE_FIXTURE };
}
const plat = s => String(s).replace(/[  ]/g, " ").toLowerCase();
export const contientTous = (message, subs) => (subs || []).every(s => plat(message).includes(plat(s)));

/** Entrée d'un cas de relevés avec les sous-catégories additionnées par catégorie large (avant BUD1 : seules les 12 catégories larges sont admises). */
export function entreeLarge(id) {
  const e = JSON.parse(JSON.stringify(resoudre(cas(id).entree)));
  (e.mois || []).forEach(m => {
    const par = new Map();
    (m.sous_categories || []).forEach(l => {
      const g = FIXTURE.categories_utilisees.large[l.cle] || l.cle;
      const x = par.get(g) || { cle: g, entrees: 0, sorties: 0, nombre: 0 };
      x.entrees += l.entrees; x.sorties += l.sorties; x.nombre += l.nombre; par.set(g, x);
    });
    m.sous_categories = [...par.values()];
  });
  return e;
}

/** Source JS sans commentaires (pour les tests qui cherchent un motif dans le code, pas dans la documentation). */
export const sansCommentairesJs = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
