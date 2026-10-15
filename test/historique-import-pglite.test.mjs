// HIS2 : le `apres` produit par HistoriqueImport.versApres est accepté tel quel par la base (migration 0034, historique_appliquer) et produit les
// effets attendus : contrat de la proposition vérifié de bout en bout sur PGlite. Cas de test/fixtures/his2-cas.json (B1 en catégories larges,
// P1, P-cloturee, P2, A1, D1) ; les identifiants de lignes viennent de la base. Aucune donnée réelle.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { baseComplete } from "./helpers/pglite.mjs";
import { cas, resoudre, HistoriqueImport as H, largeDe } from "./helpers/his2.mjs";
import { isinFictif } from "./helpers/isin-fictif.mjs";

const A = "11111111-1111-1111-1111-111111111111";
const paris = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
let db, ctxBase;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];

/** Dépose puis valide une proposition d'import (chemin réel de l'app, aal2). */
async function valider(apres, source = "Export déposé dans la conversation le 16/10/2026") {
  const ref = randomUUID();
  const p = (await un(`insert into public.propositions (cible, operation, ref, apres, source) values ('historique', 'creer', $1, $2::jsonb, $3) returning id`, [ref, JSON.stringify(apres), source])).id;
  const n = (await un(`select public.appliquer_propositions($1::uuid[], '{}'::jsonb) n`, [[p]])).n;
  return { ref, n };
}
async function ligne(nom, { isin = null, envelope, qty = null, value = null }) {
  await db.exec(`reset role`);
  if (isin) await db.exec(`insert into public.instruments (isin, name) values ('${isin}', 'Instrument fictif') on conflict (isin) do nothing`);
  const id = (await un(`insert into public.positions (user_id, name, envelope, owner, bloc, mode, isin, qty, value) values ('${A}', $1, $2, 'p1', 'Monde', $3, $4, $5, $6) returning id`,
    [nom, envelope, isin ? "market" : "manual", isin, qty, value])).id;
  await db.exec(`set test.uid = '${A}'; set role authenticated;`);
  return id;
}
/** positions du bilan, lues en base, sous la forme du store. */
async function positions() {
  return (await q(`select id, name, isin, envelope, owner, mode, qty, value, status from public.positions where user_id = '${A}'`)).map(p => ({ ...p, qty: p.qty == null ? null : +p.qty }));
}
const transactions = async () => (await q(`select id, position_id as "positionId", to_char(date, 'YYYY-MM-DD') as date, type, qty, price, amount, frais, enveloppe, source, doublon_de as "doublonDe", cle_import as "cleImport", import_id as "importId" from public.transactions where user_id = '${A}'`))
  .map(t => ({ ...t, qty: t.qty == null ? null : +t.qty, price: t.price == null ? null : +t.price, amount: t.amount == null ? null : +t.amount, frais: t.frais == null ? null : +t.frais }));
const ctx = async (extra = {}) => ({ today: paris(), positions: await positions(), transactions: await transactions(), taxonomie: "large", reperes: [], ...extra });

before(async () => {
  db = await baseComplete();
  await db.exec(`
    insert into auth.users (id) values ('${A}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
    insert into auth.mfa_factors (user_id, status, created_at) values ('${A}', 'verified', now() - interval '1 day');
    reset role; set test.uid = '${A}'; set test.aal = 'aal2'; set test.client_id = ''; set test.session_id = ''; set role authenticated;`);
});

/** Relevés de la fixture en catégories larges (avant BUD1 : sous-catégorie vide), additionnées par catégorie large. */
function entreeLarge(id) {
  const e = JSON.parse(JSON.stringify(resoudre(cas(id).entree)));
  e.mois.forEach(m => {
    const par = new Map();
    m.sous_categories.forEach(l => { const g = largeDe(l.cle), x = par.get(g) || { cle: g, entrees: 0, sorties: 0, nombre: 0 }; x.entrees += l.entrees; x.sorties += l.sorties; x.nombre += l.nombre; par.set(g, x); });
    m.sous_categories = [...par.values()];
  });
  return e;
}

test("relevés : B1 en catégories larges, puis B1-remp qui remplace février (compte retrouvé par sa clé)", async () => {
  const c = ctxBase = await ctx();
  const v1 = H.verifier("releves", entreeLarge("B1"), c);
  assert.deepEqual(v1.bloquants, []);
  const apres1 = H.versApres("releves", v1.contenu, { empreinte: v1.empreinte, resume: v1.resume, avertissements: v1.avertissements, today: c.today });
  assert.ok(Buffer.byteLength(JSON.stringify(apres1)) < 100000);
  const r1 = await valider(apres1);
  assert.equal(r1.n >= 1, true);
  const hist = await un(`select r.* from public.historique_imports r where r.id = $1`, [r1.ref]);
  assert.equal(hist.type, "releves");
  assert.equal(hist.empreinte, v1.empreinte);
  assert.equal((await un(`select count(*)::int n from public.historique_releves`)).n, 2);
  assert.equal(+(await un(`select sum(sorties) s from public.historique_banque_mois where mois = '2024-01-01'`)).s, 2800);
  // la même empreinte est refusée par la base comme par le module
  const c2 = { ...c, imports: [{ id: r1.ref, empreinte: v1.empreinte, importe_le: paris() }] };
  assert.match(H.verifier("releves", entreeLarge("B1"), c2).bloquants[0].message, /déjà importé/);
  await assert.rejects(valider(apres1), /déjà été importé/);
  // second import : février remplacé, mars ajouté (compte désigné par son identifiant)
  const compte = await un(`select * from public.historique_comptes`);
  const rels = await q(`select compte_id, to_char(mois, 'YYYY-MM') as mois, complet, solde_debut, solde_fin, total_entrees, total_sorties, import_id from public.historique_releves`);
  const e2 = entreeLarge("B1-remp");
  e2.compte = { id: compte.id };
  const v2 = H.verifier("releves", e2, { ...c, comptes: [compte], releves: rels });
  assert.deepEqual(v2.bloquants, []);
  assert.deepEqual(v2.remplaces.map(m => m.mois), ["2024-02"]);
  const r2 = await valider(H.versApres("releves", v2.contenu, { empreinte: v2.empreinte, resume: v2.resume, avertissements: v2.avertissements, today: c.today }));
  assert.ok(r2.n >= 1);
  assert.equal((await un(`select count(*)::int n from public.historique_releves`)).n, 3);
  assert.equal(+(await un(`select total_sorties s from public.historique_releves where mois = '2024-02-01'`)).s, 2940);
});

test("ordres : P1 (ligne du bilan) puis P-cloturee (ligne clôturée créée par l'import) acceptés par la base ; le réimport est reconnu par les clés", async () => {
  const etf = await ligne("ETF Monde A", { isin: isinFictif(1), envelope: "PEA Exemple", qty: 15 });
  const c = await ctx();
  const v = H.verifier("ordres", resoudre(cas("P1").entree), c);
  assert.deepEqual(v.bloquants, []);
  assert.equal(v.contenu.mouvements[0].position_id, etf);
  const apres = H.versApres("ordres", v.contenu, { empreinte: v.empreinte, resume: v.resume, avertissements: v.avertissements, doublons: v.doublons, today: c.today });
  const r = await valider(apres);
  assert.ok(r.n >= 1);
  assert.equal((await un(`select count(*)::int n from public.transactions where import_id = $1`, [r.ref])).n, 3);
  // P-cloturee : l'ISIN n'est pas au bilan, quantité nette nulle → ligne clôturée à créer
  const c2 = await ctx();
  const v2 = H.verifier("ordres", resoudre(cas("P-cloturee").entree), c2);
  assert.deepEqual(v2.bloquants, []);
  assert.equal(v2.contenu.lignes_a_creer.length, 1);
  const r2 = await valider(H.versApres("ordres", v2.contenu, { empreinte: v2.empreinte, resume: v2.resume, avertissements: v2.avertissements, today: c2.today }));
  assert.ok(r2.n >= 1);
  const cl = await un(`select status, qty from public.positions where isin = $1`, [isinFictif(3)]);
  assert.equal(cl.status, "clôturé");
  // réimport de P-cloturee : la ligne existe, les clés naturelles sont les mêmes → tout est ignoré
  const c3 = await ctx();
  const v3 = H.verifier("ordres", { ...resoudre(cas("P-cloturee").entree), source: "Deuxième dépôt du même fichier" }, c3);
  assert.equal(v3.contenu.lignes_a_creer.length, 0);
  assert.deepEqual([v3.nouveaux, v3.ignores], [0, 2]);
});

test("versements : espèces sans ligne d'espèces (mouvements d'enveloppe) et assurance-vie avec relevés de valeur, acceptés par la base", async () => {
  const c = await ctx();
  const v = H.verifier("versements", resoudre(cas("P2-enveloppe").entree), c);
  assert.deepEqual(v.bloquants, []);
  const r = await valider(H.versApres("versements", v.contenu, { empreinte: v.empreinte, resume: v.resume, avertissements: v.avertissements, today: c.today }));
  assert.ok(r.n >= 1);
  const tx = await q(`select type, position_id, enveloppe, amount from public.transactions where import_id = $1 order by date`, [r.ref]);
  assert.deepEqual(tx.map(t => [t.type, t.position_id, t.enveloppe, +t.amount]), [["versement", null, "PEA Exemple", 1000], ["versement", null, "PEA Exemple", 1000]]);
  // assurance-vie : la ligne du contrat est celle du bilan
  const av = await ligne("Assurance-vie Exemple – fonds en euros", { envelope: "Assurance-vie Exemple", value: 6300 });
  const e = JSON.parse(JSON.stringify(resoudre(cas("A1").entree)));
  e.contrat.position_id = av;
  const c2 = await ctx();
  const v2 = H.verifier("versements", e, c2);
  assert.deepEqual(v2.bloquants, []);
  const r2 = await valider(H.versApres("versements", v2.contenu, { empreinte: v2.empreinte, resume: v2.resume, avertissements: v2.avertissements, today: c2.today }));
  const t2 = await q(`select type, amount, position_id from public.transactions where import_id = $1 order by date, type`, [r2.ref]);
  assert.equal(t2.length, 4, "2 versements et 2 relevés de valeur");
  assert.ok(t2.every(t => t.position_id === av));
});

test("doublons : un versement programmé de la nuit remplacé par l'ordre réel (doublon_de posé), puis retiré par retirer_import", async () => {
  await db.exec(`reset role; insert into public.status (user_id) values ('${A}') on conflict do nothing; set test.uid = '${A}'; set test.aal = 'aal2'; set role authenticated;`);
  const etf2 = await ligne("ETF Monde B", { isin: isinFictif(2), envelope: "PEA Exemple", qty: 5.02512563 });
  const nuit = (await un(`insert into public.transactions (user_id, position_id, date, type, qty, price, amount, source) values ('${A}', $1, '2026-09-05', 'programme', 5.02512563, 99.5, 500, 'nightly') returning id`, [etf2])).id;
  const e = JSON.parse(JSON.stringify(resoudre(cas("D1").entree)));
  e.ordres[0].isin = isinFictif(2);
  const c = await ctx();
  const v = H.verifier("ordres", e, c);
  assert.deepEqual(v.bloquants, []);
  assert.deepEqual(v.doublons.map(d => d.transaction_id), [nuit]);
  const r = await valider(H.versApres("ordres", v.contenu, { empreinte: v.empreinte, resume: v.resume, avertissements: v.avertissements, doublons: v.doublons, today: c.today }));
  assert.equal((await un(`select doublon_de is not null d from public.transactions where id = $1`, [nuit])).d, true);
  await db.query(`select public.retirer_import($1)`, [r.ref]);
  assert.equal((await un(`select doublon_de is null d from public.transactions where id = $1`, [nuit])).d, true, "la transaction de la nuit revient");
});

test("gros relevés : 60 mois et beaucoup d'avertissements tiennent dans le résumé de 4 000 octets (avertissements rognés), découpés en morceaux acceptés un à un", async () => {
  const lignes = (n) => H.CATEGORIES_LARGES.filter(k => k !== "virement_interne" && k !== "revenus").slice(0, n).map(k => ({ cle: k, entrees: 0, sorties: 300, nombre: 3 }));
  const mois = Array.from({ length: 60 }, (_, i) => {
    const a = 2021 + Math.floor((i + 9) / 12), m = (i + 9) % 12 + 1, sorties = 300 * 10;
    // soldes qui ne se suivent pas : un avertissement de continuité par mois
    return { mois: a + "-" + String(m).padStart(2, "0"), complet: true, controle: { total_entrees: 3000, total_sorties: sorties, solde_debut: 1000 * i, solde_fin: 1000 * i + 3000 - sorties },
      sous_categories: [{ cle: "revenus", entrees: 3000, sorties: 0, nombre: 1 }, ...lignes(10)] };
  });
  const c = await ctx();
  const v = H.verifier("releves", { compte: { libelle: "Compte long Exemple", etablissement: "autre", etablissement_libre: "Banque Exemple", type: "courant", titulaire: "p1" },
    fichier: { format: "csv", periode: { du: "2021-10-01", au: "2026-09-30" } }, mois, accord_utilisateur: true, source: "Export CSV déposé dans la conversation" }, c);
  assert.deepEqual(v.bloquants, []);
  assert.ok(v.avertissements.length >= 40, "beaucoup d'avertissements de continuité : " + v.avertissements.length);
  const parts = H.decouper("releves", v.contenu, 20000);
  assert.ok(parts.length >= 5);
  for (const [k, part] of parts.entries()) {
    const resume = H.resume("releves", part, { avertissements: k === 0 ? v.avertissements : [], remplaces: [] });
    const apres = H.versApres("releves", part, { resume, avertissements: k === 0 ? v.avertissements : [], today: c.today });
    const r = await valider(apres);
    assert.ok(r.n >= 1, "morceau " + k);
    const imp = await un(`select octet_length(resume::text) n, jsonb_array_length(coalesce(resume->'avertissements', '[]'::jsonb)) a from public.historique_imports where id = $1`, [r.ref]);
    assert.ok(imp.n <= 4000, "résumé de " + imp.n + " octets");
  }
  assert.equal((await un(`select count(*)::int n from public.historique_releves h join public.historique_comptes c on c.id = h.compte_id where c.libelle = 'Compte long Exemple'`)).n, 60);
});
