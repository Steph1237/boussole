// Banque, rapprochement automatique et anti-doublons (migration 0022_banque_rapprochement.sql) exercés sur PGlite : toutes les
// migrations 0001 → 0022 appliquées sur les bouchons Supabase (test/helpers/pglite.mjs, baseComplete). Couvre les nouvelles
// colonnes, leurs droits (écrites par le service seulement), les index uniques partiels et leur message en français, la remise à
// zéro de rattache_auto / cree_auto / suggestion quand l'utilisateur modifie le rattachement, auto_retire_le, la clôture de ce que la
// synchronisation avait créé, la contrainte de forme de suggestion et le nettoyage des doublons existants avant l'index.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseComplete, comme } from "./helpers/pglite.mjs";

const SQL = readFileSync(new URL("../supabase/migrations/0022_banque_rapprochement.sql", import.meta.url), "utf8");
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
const L1 = "aaaaaaaa-0000-0000-0000-000000000001", L2 = "aaaaaaaa-0000-0000-0000-000000000002", L3 = "aaaaaaaa-0000-0000-0000-000000000003";
const LB = "bbbbbbbb-0000-0000-0000-000000000001";
const K1 = "aaaaaaaa-1111-0000-0000-000000000001", K2 = "aaaaaaaa-1111-0000-0000-000000000002";
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const refuse = async (s, p, motif, m) => {
  await assert.rejects(db.query(s, p), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
};
const service = () => db.exec(`reset role; set test.uid = ''; set role service_role;`);
const superu = () => db.exec(`reset role; set test.uid = '';`);

before(async () => {
  db = await baseComplete();
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
    insert into public.positions (id, user_id, name, envelope, owner, mode, value) values
      ('${L1}', '${A}', 'Livret A', 'Livrets', 'p1', 'manual', 15000), ('${L2}', '${A}', 'Indemnité', 'Livrets', 'p1', 'manual', 3000),
      ('${L3}', '${A}', 'Compte courant LCL', 'Comptes courants', 'p1', 'manual', 30), ('${LB}', '${B}', 'Livret B', 'Livrets', 'p1', 'manual', 1);
    update public.positions set source_auto = 'powens' where id = '${L3}';
    insert into public.credits (id, user_id, nom, crd) values ('${K1}', '${A}', 'Prêt étudiant', 3264.18), ('${K2}', '${A}', 'Prêt immo', 90000);
    insert into public.banque_connexions (id, user_id, etablissement) values (1, '${A}', 'LCL'), (2, '${A}', 'LCL'), (1, '${B}', 'Autre');
    insert into public.banque_comptes (id, user_id, connexion_id, nom, type, solde) values
      (10, '${A}', 1, 'Compte courant', 'courant', 41.2), (20, '${A}', 2, 'Compte courant', 'courant', 41.2),
      (21, '${A}', 2, 'Livret A', 'livret', 7412.5), (22, '${A}', 2, 'Prêt', 'credit', -3264.18), (23, '${A}', 2, 'Prêt 2', 'credit', -10),
      (24, '${A}', 2, 'PEA-PME', 'pea', 1500), (10, '${B}', 1, 'Compte B', 'courant', 5);`);
});
after(async () => { await db.close(); });

test("migration 0022 : en-tête, non appliquée, tutoiement (ni vous, ni votre, ni vos), aucun secret", () => {
  assert.match(SQL, /^-- Boussole : banque, rapprochement automatique et anti-doublons/);
  assert.match(SQL, /Non appliquée : à appliquer sur le projet oapcewpqsbbjdlcdeizi avec apply_migration \(name = "banque_rapprochement"\)/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(SQL, /sb_secret_|eyJhbGci/);
});

test("PGlite 0022 : colonnes ajoutées, valeurs par défaut, index uniques partiels", async () => {
  await superu();
  const cols = async t => (await q(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).map(r => r.c);
  assert.deepEqual((await cols("banque_connexions")).slice(-2), ["connecteur", "doublon_de"]);
  assert.deepEqual((await cols("banque_comptes")).filter(c => !["ouverture_le", "pret", "infos_proposees_le"].includes(c)).slice(-5), ["doublon_de", "rattache_auto", "cree_auto", "auto_retire_le", "suggestion"]); // hors colonnes de 0029
  const c = await un(`select doublon_de, rattache_auto, cree_auto, auto_retire_le, suggestion from public.banque_comptes where user_id = '${A}' and id = 10`);
  assert.deepEqual({ ...c }, { doublon_de: null, rattache_auto: null, cree_auto: false, auto_retire_le: null, suggestion: null });
  const idx = (await q(`select indexdef d from pg_indexes where tablename = 'banque_comptes'`)).map(r => r.d).join("\n");
  assert.match(idx, /UNIQUE INDEX banque_comptes_position_unique ON public\.banque_comptes USING btree \(user_id, position_id\) WHERE \(position_id IS NOT NULL\)/);
  assert.match(idx, /UNIQUE INDEX banque_comptes_credit_unique ON public\.banque_comptes USING btree \(user_id, credit_id\) WHERE \(credit_id IS NOT NULL\)/);
});

test("PGlite 0022 : authenticated garde ses 5 colonnes, rien de plus ; le service écrit les nouvelles", async () => {
  await comme(db, A);
  for (const col of ["doublon_de = 1", "rattache_auto = now()", "cree_auto = true", "auto_retire_le = null", `suggestion = '{"type":"ligne","libelle":"x"}'`])
    await refuse(`update public.banque_comptes set ${col} where id = 10`, [], /permission denied/, "authenticated : " + col);
  for (const col of ["doublon_de = 2", "connecteur = 40"]) await refuse(`update public.banque_connexions set ${col} where id = 1`, [], /permission denied/, "authenticated : connexion " + col);
  const r = await un(`update public.banque_comptes set titulaire = 'p1', enveloppe = null where id = 24 returning titulaire`);
  assert.equal(r.titulaire, "p1", "colonne de rattachement toujours modifiable");
  await q(`update public.banque_comptes set titulaire = null where id = 24`);
  await service();
  await q(`update public.banque_connexions set connecteur = 40, doublon_de = 2 where user_id = $1 and id = 1`, [A]);
  await q(`update public.banque_comptes set doublon_de = 20, suggestion = $2 where user_id = $1 and id = 10`, [A, { type: "ligne", id: L3, libelle: "Compte courant LCL", raison: "Nom" }]);
  await superu();
  const c = await un(`select doublon_de, suggestion from public.banque_comptes where user_id = '${A}' and id = 10`);
  assert.equal(Number(c.doublon_de), 20);
  assert.equal(c.suggestion.type, "ligne");
  await q(`update public.banque_comptes set doublon_de = null, suggestion = null where user_id = '${A}' and id = 10`);
});

test("PGlite 0022 : suggestion — forme contrôlée (objet, type ligne | enveloppe | credit, libellé texte, 2000 caractères au plus)", async () => {
  await service();
  for (const [v, m] of [[[1], "tableau"], [{ type: "autre", libelle: "x" }, "type inconnu"], [{ type: "ligne" }, "sans libellé"], [{ type: "credit", libelle: "x".repeat(2100) }, "trop longue"]])
    await refuse(`update public.banque_comptes set suggestion = $2 where user_id = $1 and id = 10`, [A, v], /banque_comptes_suggestion/, m);
  for (const v of [{ type: "enveloppe", enveloppe: "PEA", titulaire: "p1", libelle: "PEA", raison: "ISIN communs" }, { type: "credit", id: K1, libelle: "Prêt", raison: "" }])
    await q(`update public.banque_comptes set suggestion = $2 where user_id = $1 and id = 10`, [A, v]);
  await q(`update public.banque_comptes set suggestion = null where user_id = $1 and id = 10`, [A]);
});

test("PGlite 0022 : une ligne, un crédit → un seul compte ; refus en français qui nomme l'autre compte (app et service)", async () => {
  await comme(db, A);
  await q(`update public.banque_comptes set position_id = '${L1}' where id = 21`);
  await refuse(`update public.banque_comptes set position_id = '${L1}' where id = 20`, [], /^Cette ligne est déjà rattachée au compte Livret A \(LCL\)\.$/, "ligne prise");
  await q(`update public.banque_comptes set credit_id = '${K1}' where id = 22`);
  await refuse(`update public.banque_comptes set credit_id = '${K1}' where id = 23`, [], /^Ce crédit est déjà rattaché au compte Prêt \(LCL\)\.$/, "crédit pris");
  // le même compte peut garder (ou réécrire) son rattachement
  await q(`update public.banque_comptes set position_id = '${L1}', ignore = false where id = 21`);
  await service();
  await refuse(`update public.banque_comptes set position_id = '${L1}' where user_id = $1 and id = 20`, [A], /déjà rattachée/, "service");
  // filet de l'index si le déclencheur est contourné (écriture concurrente) : violation d'unicité
  await superu();
  await db.exec(`alter table public.banque_comptes disable trigger banque_comptes_rattachement`);
  await refuse(`update public.banque_comptes set position_id = '${L1}' where user_id = $1 and id = 20`, [A], /banque_comptes_position_unique/, "index");
  await db.exec(`alter table public.banque_comptes enable trigger banque_comptes_rattachement`);
  // un autre utilisateur peut rattacher sa propre ligne : l'unicité est par utilisateur
  await q(`update public.banque_comptes set position_id = '${LB}' where user_id = '${B}' and id = 10`);
  await comme(db, A);
  await q(`update public.banque_comptes set position_id = null where id = 21`);
  await q(`update public.banque_comptes set credit_id = null where id = 22`);
});

test("PGlite 0022 : l'utilisateur modifie un rattachement automatique → rattache_auto, cree_auto et suggestion remis à zéro, auto_retire_le posé ; le service ne touche pas à ces marques", async () => {
  await service();
  // rattachement automatique posé par la synchronisation (service) : marques conservées
  const r0 = await un(`update public.banque_comptes set credit_id = $2, rattache_auto = now(), suggestion = null where user_id = $1 and id = 22 returning rattache_auto, auto_retire_le`, [A, K1]);
  assert.ok(r0.rattache_auto, "service : rattache_auto posé");
  assert.equal(r0.auto_retire_le, null);
  // l'utilisateur change de crédit
  await comme(db, A);
  const r1 = await un(`update public.banque_comptes set credit_id = '${K2}' where id = 22 returning credit_id, rattache_auto, auto_retire_le, suggestion`);
  assert.equal(r1.credit_id, K2);
  assert.equal(r1.rattache_auto, null, "plus automatique");
  assert.ok(r1.auto_retire_le, "le rattachement automatique a été changé par l'utilisateur");
  // une écriture de l'utilisateur sans changement de rattachement ne touche à rien
  await service();
  await q(`update public.banque_comptes set suggestion = $2 where user_id = $1 and id = 20`, [A, { type: "ligne", id: L3, libelle: "Compte courant LCL", raison: "Nom" }]);
  await comme(db, A);
  const r2 = await un(`update public.banque_comptes set titulaire = null where id = 20 returning suggestion`);
  assert.equal(r2.suggestion.type, "ligne", "rattachement inchangé : suggestion gardée");
  const r3 = await un(`update public.banque_comptes set position_id = '${L2}' where id = 20 returning suggestion, auto_retire_le`);
  assert.equal(r3.suggestion, null, "rattachement choisi : suggestion caduque");
  assert.equal(r3.auto_retire_le, null, "pas de rattachement automatique avant : rien à retenir");
  await q(`update public.banque_comptes set position_id = null where id = 20`);
  await q(`update public.banque_comptes set credit_id = null where id = 22`);
});

test("PGlite 0022 : quitter une ligne créée automatiquement (ignore, autre cible) → la ligne passe en clôturé, jamais supprimée", async () => {
  await service();
  await q(`update public.banque_comptes set position_id = $2, rattache_auto = now(), cree_auto = true where user_id = $1 and id = 20`, [A, L3]);
  await comme(db, A);
  const r = await un(`update public.banque_comptes set ignore = true where id = 20 returning position_id, rattache_auto, cree_auto, ignore, auto_retire_le`);
  assert.deepEqual([r.position_id, r.rattache_auto, r.cree_auto, r.ignore], [null, null, false, true]);
  assert.ok(r.auto_retire_le);
  await superu();
  const l = await un(`select status from public.positions where id = '${L3}'`);
  assert.equal(l.status, "clôturé", "ligne créée : clôturée, gardée");
  // ligne non créée par la synchronisation (cree_auto faux) : jamais clôturée
  await q(`update public.positions set status = 'actif' where id = '${L3}'`);
  await q(`update public.banque_comptes set ignore = false where user_id = '${A}' and id = 20`);
  await service();
  await q(`update public.banque_comptes set position_id = $2, rattache_auto = now(), cree_auto = false where user_id = $1 and id = 21`, [A, L1]);
  await comme(db, A);
  await q(`update public.banque_comptes set ignore = true where id = 21`);
  await superu();
  assert.equal((await un(`select status from public.positions where id = '${L1}'`)).status, "actif", "ligne de l'utilisateur intacte");
  await q(`update public.banque_comptes set ignore = false where user_id = '${A}' and id = 21`);
  // enveloppe créée automatiquement : lignes de ses placements encore alimentées par Powens clôturées
  await q(`insert into public.positions (id, user_id, name, envelope, owner, mode, value, source_auto) values
    ('aaaaaaaa-0000-0000-0000-0000000000e1', '${A}', 'Liquidités PEA-PME', 'PEA-PME', 'p1', 'manual', 1000, 'powens')`);
  await q(`update public.banque_comptes set enveloppe = 'PEA-PME', titulaire = 'p1', rattache_auto = now(), cree_auto = true where user_id = '${A}' and id = 24`);
  await q(`insert into public.banque_placements (id, user_id, compte_id, libelle, valeur, position_id) values (900, '${A}', 24, 'Liquidités', 1000, 'aaaaaaaa-0000-0000-0000-0000000000e1')`);
  await comme(db, A);
  await q(`update public.banque_comptes set enveloppe = null, titulaire = null where id = 24`);
  await superu();
  assert.equal((await un(`select status from public.positions where id = 'aaaaaaaa-0000-0000-0000-0000000000e1'`)).status, "clôturé");
  assert.equal((await un(`select count(*)::int n from public.positions where user_id = '${A}'`)).n, 4, "rien n'est supprimé");
});

test("PGlite 0022 : doublons existants détachés avant la création des index (le compte actif de plus petit identifiant garde)", async () => {
  const d = await baseComplete("0021_banque.sql");
  await d.exec(`insert into auth.users (id) values ('${A}');
    insert into public.positions (id, user_id, name) values ('${L1}', '${A}', 'Livret A');
    insert into public.credits (id, user_id, nom) values ('${K1}', '${A}', 'Prêt');
    insert into public.banque_connexions (id, user_id) values (1, '${A}'), (2, '${A}');
    insert into public.banque_comptes (id, user_id, connexion_id, type, position_id, credit_id, actif) values
      (10, '${A}', 1, 'livret', '${L1}', null, false), (20, '${A}', 2, 'livret', '${L1}', null, true), (30, '${A}', 2, 'livret', '${L1}', null, true),
      (11, '${A}', 1, 'credit', null, '${K1}', true), (21, '${A}', 2, 'credit', null, '${K1}', true);`);
  await d.exec(SQL);
  const r = (await d.query(`select id, position_id, credit_id from public.banque_comptes order by id`)).rows.map(x => [Number(x.id), x.position_id, x.credit_id]);
  assert.deepEqual(r, [[10, null, null], [11, null, K1], [20, L1, null], [21, null, null], [30, null, null]]);
  await d.close();
});
