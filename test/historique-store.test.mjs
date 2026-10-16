// HIS2, tâche 8 : stores (démo et Supabase), cible « historique » de À valider, retrait d'un import (seule écriture ajoutée à l'app, D5).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { sansCommentairesJs } from "./helpers/his2.mjs";

const require = createRequire(import.meta.url);
const src = f => readFileSync(new URL("../web/src/" + f, import.meta.url), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const Calc = require("../web/src/calc.js");
const P = (() => { globalThis.window = globalThis; return require("../web/src/propositions.js"); })();

function demo() {
  const ctx = { console, setTimeout, clearTimeout, location: { href: "http://x/app.html?demo", search: "?demo", hash: "", pathname: "/app.html" },
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ["demo-data.js", "sensible.js", "routine-etat.js", "banque-etat.js", "store-demo.js"]) vm.runInContext(src(f), ctx, { filename: f });
  return ctx;
}
const pret = ctx => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("store jamais prêt")), 2000); const ok = S => { if (S.ready) { clearTimeout(t); res(S); } }; ctx.Store.on(ok); ok(ctx.Store.get()); });

test("démo : un ancien compte courant importé (14 mois, un manquant), un PEA importé, deux propositions d'historique décidées — rien de réel", async () => {
  const ctx = demo(), S = await pret(ctx);
  const R = J(S.relevesBancaires);
  assert.equal(R.comptes.length, 1);
  assert.equal(R.releves.length, 14);
  assert.equal(R.comptes[0].libelle, "Ancien compte de Sam");
  const mois = R.releves.map(r => r.mois.slice(0, 7)), premier = mois[0], dernier = mois[mois.length - 1];
  const tous = []; for (let m = premier; m <= dernier; m = (a => Math.floor((a[0] * 12 + a[1]) / 12) + "-" + String((a[0] * 12 + a[1]) % 12 + 1).padStart(2, "0"))(m.split("-").map(Number))) tous.push(m);
  assert.equal(tous.length - mois.length, 1, "un mois manquant");
  R.releves.forEach(r => assert.ok(Math.abs(r.soldeFin - (r.soldeDebut + r.totalEntrees - r.totalSorties)) < 0.011 && r.complet));
  assert.deepEqual(J(S.historiqueImports.map(i => i.type)), ["releves", "ordres"]);
  assert.deepEqual(J(S.photosReconstituees), []);
  const imp = S.tx.filter(t => t.importId === "imp-demo-ordres");
  assert.equal(imp.length, 3);
  imp.forEach(t => { assert.equal(t.source, "import"); assert.match(t.cleImport, /^[0-9a-f]{32}$/); assert.ok(S.positions.some(p => p.id === t.positionId)); });
  const pea = S.positions.find(p => p.id === "pea-etf-monde");
  assert.ok(Math.abs(pea.qty - (imp.reduce((a, t) => a + t.qty, 0) + S.tx.filter(t => t.positionId === "pea-etf-monde" && t.importId == null && t.type !== "solde").reduce((a, t) => a + t.qty, 0))) < 1e-9, "les ordres importés expliquent la quantité");
  assert.ok(!/\d{6,}/.test(JSON.stringify(S.historiqueImports).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "")), "aucun numéro");
  // les mois importés sont antérieurs aux 12 mois du budget réel : aucun chiffre existant ne bouge
  const auj = new Date().toISOString().slice(0, 10);
  for (const nb of [12, 3]) { const avec = J(Calc.budgetReel(S.banque, auj, nb, R)); assert.equal(avec.moisImportes, 0); delete avec.moisImportes; assert.deepEqual(avec, J(Calc.budgetReel(S.banque, auj, nb))); }
  const serie = Calc.moisBancaires(S.banque, R, auj).filter(e => e.source === "import");
  assert.equal(serie.length, 14);
  assert.ok(serie.every(e => e.categories.length === 6));
});

test("démo : Store.historique.retirer retire l'import, ses mouvements et son compte sans plus aucun mois ; import inconnu : erreur", async () => {
  const ctx = demo(), S0 = await pret(ctx);
  const n0 = S0.tx.length;
  assert.deepEqual(J(await ctx.Store.historique.retirer("imp-inconnu")), { erreur: "Import introuvable." });
  assert.deepEqual(J(await ctx.Store.historique.retirer("imp-demo-ordres")), { ok: true });
  let S = ctx.Store.get();
  assert.equal(S.tx.length, n0 - 3);
  assert.deepEqual(J(S.historiqueImports.map(i => i.id)), ["imp-demo-releves"]);
  assert.equal(S.relevesBancaires.releves.length, 14, "les relevés restent");
  await ctx.Store.historique.retirer("imp-demo-releves");
  S = ctx.Store.get();
  assert.deepEqual(J([S.relevesBancaires.comptes, S.relevesBancaires.releves, S.relevesBancaires.banqueMois, S.historiqueImports]), [[], [], [], []]);
});

test("store-supabase.js : tables de l'historique lues sous aal2 seulement, pages de 1 000, migration absente sans bruit ; retrait par la RPC retirer_import après contrôle de l'identifiant", () => {
  const s = src("store-supabase.js");
  for (const t of ["historique_comptes", "historique_releves", "historique_banque_mois", "historique_imports", "photos_reconstituees"]) assert.ok(s.includes('from("' + t + '")'), t);
  assert.match(s, /if \(!\(await sessionAal2\(\)\)\) \{\s*C\.relevesBancaires = Object\.assign\(RELEVES_VIDES\(\), \{ lu: true, mfaRequise: true \}\)/);
  assert.match(s, /pagesHI\(a => sb\.from\("historique_releves"\)[^\n]*\.range\(a, a \+ 999\)\)/);
  assert.match(s, /echec\.every\(r => HI_ABSENTE\(r\.reason\)\)\) return;/);
  assert.match(s, /sb\.rpc\("retirer_import", \{ p_id: id \}\)/);
  assert.match(s, /if \(!UUID\.test\(id\)\) return \{ erreur: "Import introuvable\." \};/);
  for (const k of ["importId: r.import_id", "cleImport: r.cle_import", "doublonDe: r.doublon_de", "estime: r.estime === true", "frais: num(r.frais)"]) assert.ok(s.includes(k), k);
  assert.doesNotMatch(sansCommentairesJs(s), /from\("historique_\w+"\)\.(insert|update|upsert|delete)\(/, "aucune écriture directe sur les tables de l'historique");
});

test("À valider : cible historique — une phrase par import, détail replié par mois ou par ligne, avertissements, jamais modifiable", () => {
  assert.ok(P.CIBLES.historique && P.ORDRE_CIBLES.includes("historique"));
  const texte = "Relevés de Compte courant Exemple : 2 mois, de janv. 2024 à févr. 2024 ; entrées 6 040 €, sorties 5 760 € ; 1 avertissement.";
  const releves = { cible: "historique", operation: "creer", ref: "i1", avant: null, source: "Export CSV", apres: { type: "releves", resume: { texte }, avertissements: [{ cle: "trous", message: "Un mois manque : mars 2024." }],
    donnees: { mois: [{ mois: "2024-02", complet: true, controle: { total_entrees: 3040, total_sorties: 2960 } }, { mois: "2024-01", complet: false, controle: { total_entrees: 3000, total_sorties: 2800 } }] } } };
  assert.equal(P.decrire(releves, {}), texte.replace(/\.$/, "").replace(/\.$/, ""));
  assert.deepEqual(P.changements(releves, {}), [], "pas de champ modifiable");
  const d = P.detailHistorique(releves, {});
  assert.deepEqual(d.lignes.map(l => l.libelle), ["janvier 2024", "février 2024"], "un mois par ligne, dans l'ordre");
  assert.match(d.lignes[0].valeur, /mois entamé/);
  assert.deepEqual(d.avertissements, [{ cle: "trous", message: "Un mois manque : mars 2024." }]);
  const ordres = { cible: "historique", operation: "creer", apres: { type: "ordres", enveloppe: "PEA Exemple", lignes_a_creer: [{ isin: "FR9990000039", name: "ETF Europe C", envelope: "PEA Exemple", owner: "p1" }],
    donnees: { mouvements: [{ date: "2024-01-08", type: "achat", position_id: "p-a" }, { date: "2024-03-15", type: "vente", position_id: "p-a" }, { date: "2024-02-12", type: "achat", isin: "FR9990000039" }] } } };
  const dl = P.detailHistorique(ordres, { positions: [{ id: "p-a", name: "ETF Monde A" }] });
  assert.deepEqual(dl.lignes.map(l => l.libelle), ["ETF Monde A", "ETF Europe C (ligne clôturée créée par l'import)"]);
  assert.match(dl.lignes[0].valeur, /1 achats?, 1 ventes?, du 08\/01\/2024 au 15\/03\/2024/);
  assert.equal(P.decrire(ordres, {}), "Ordres de PEA Exemple : 3 mouvements");
  const retrait = { cible: "historique", operation: "supprimer", ref: "i1", avant: { type: "releves", importe_le: "2026-10-12T08:00:00Z", resume: "Relevés de Compte courant Exemple : 2 mois." }, apres: null };
  assert.equal(P.decrire(retrait, {}), "Retirer l'import : Relevés de Compte courant Exemple : 2 mois (importé le 12/10/2026)");
  // après la réduction de la nuit (30 jours), seul reste { type, empreinte, resume }
  assert.equal(P.decrire({ cible: "historique", operation: "creer", apres: { type: "releves", empreinte: "a".repeat(64), resume: { texte } } }, {}), texte.replace(/\.$/, ""));
  // au tutoiement, sans produit conseillé
  assert.doesNotMatch(P.decrire(retrait, {}), /vous|votre|conseiller/i);
});

test("À valider : la ligne d'un import (rendu exécuté) montre la phrase, les avertissements en ambre et le détail replié, sans bouton Modifier", () => {
  const els = {}, el = id => (els[id] = els[id] || { id, innerHTML: "", textContent: "", hidden: false, disabled: false, className: "" });
  let api = null;
  const racine = { querySelector: s => (s[0] === "#" ? el(s.slice(1)) : null), addEventListener() {} };
  const ctx = { console, document: {}, CSS: { escape: x => x }, Intl, Date, JSON, Math, Map, Set, window: null };
  ctx.window = ctx; ctx.App = { register: (_, a) => { api = a; } }; ctx.Store = { propositions: { appliquer() {}, refuser() {} } };
  vm.createContext(ctx);
  vm.runInContext(src("propositions.js"), ctx, { filename: "propositions.js" });
  api.mount(racine);
  const p = { id: "p1", lot: "l1", cible: "historique", operation: "creer", ref: "i1", avant: null, source: "Export CSV déposé dans la conversation", justification: null, statut: "en_attente", creeLe: "2026-10-16T08:00:00Z", decideLe: null,
    apres: { type: "releves", resume: { texte: "Relevés de Compte courant Exemple : 1 mois, de janv. 2024 à janv. 2024 ; entrées 3 000 €, sorties 2 800 € ; 1 avertissement." }, avertissements: [{ cle: "trous", message: "Un mois manque : mars 2024." }],
      donnees: { mois: [{ mois: "2024-01", complet: true, controle: { total_entrees: 3000, total_sorties: 2800 } }] } } };
  api.update({ ready: true, propositions: [p], people: [], positions: [] }, true);
  const html = els.ppLots.innerHTML;
  assert.match(html, /Relevés de Compte courant Exemple : 1 mois/);
  assert.match(html, /class="pp-warn"[^>]*>.*Un mois manque : mars 2024\./);
  assert.match(html, /<details class="pp-why pp-histo"><summary>Détail \(1 ligne\)<\/summary>.*janvier 2024.*entrées 3.000 €/);
  assert.match(html, /Historique<\/span>/, "groupe « Historique »");
  assert.doesNotMatch(html, /data-edit=/, "un import se valide ou se refuse tel quel");
  assert.equal(api.headline(), "1");
});
