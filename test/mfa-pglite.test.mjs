// SEC2 : double authentification obligatoire pour les données bancaires (migration 0028_mfa.sql), exercée sur un vrai PostgreSQL
// (PGlite) : toutes les migrations appliquées sur les bouchons Supabase (test/helpers/pglite.mjs). auth.jwt() est simulé : le niveau
// d'assurance (aal) de la session vient du réglage test.aal (aal1, aal2 ou « aucun » = revendication absente). auth.mfa_factors est
// simulé ci-dessous : comme GoTrue, une session ne peut atteindre aal2 que si l'utilisateur a un facteur vérifié.
// Valeurs fictives uniquement.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { baseComplete } from "./helpers/pglite.mjs";

const DIR = new URL("../supabase/migrations/", import.meta.url);
const SQL = readFileSync(new URL("0028_mfa.sql", DIR), "utf8");
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", C = "33333333-3333-3333-3333-333333333333";
const AUJ = `(now() at time zone 'Europe/Paris')::date`;
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
const refuse = async (s, motif, m) => {
  await assert.rejects(db.query(s), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
};

/* Tables de la banque : déduites des migrations (toute nouvelle table banque_* doit être couverte par 0028). */
const TABLES_BANQUE = [...new Set(readdirSync(DIR).filter(f => /^\d{4}_.*\.sql$/.test(f) && f < "0028")
  .flatMap(f => [...readFileSync(new URL(f, DIR), "utf8").matchAll(/create table public\.(banque_\w+)/g)].map(m => m[1])))].sort();

/* Session simulée : role authenticated, utilisateur uid, niveau demandé. Un niveau aal2 n'est accordé que si un facteur est vérifié. */
async function session(uid, aal) {
  await db.exec(`reset role;`);
  if (aal === "aal2") {
    const f = await q(`select count(*)::int n from auth.mfa_factors where user_id = '${uid}' and status = 'verified'`);
    assert.ok(f[0].n > 0, "bouchon : aal2 impossible sans facteur vérifié");
  }
  await db.exec(`reset role; set test.uid = '${uid}'; set test.aal = '${aal}'; set role authenticated;`);
}
const superu = () => db.exec(`reset role; set test.uid = ''; set test.aal = 'aal2';`);

before(async () => {
  db = await baseComplete();
  await db.exec(`
    create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, factor_type text default 'totp', status text not null);
    insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
    -- A : facteur vérifié ; B : facteur non vérifié (inscription abandonnée) ; C : aucun facteur
    insert into auth.mfa_factors (user_id, status) values ('${A}', 'verified'), ('${B}', 'unverified');
    insert into public.fonctionnalites (user_id, cle, active) values ('${A}', 'banque', true), ('${B}', 'banque', true), ('${C}', 'banque', true);
    insert into public.banque_connexions (id, user_id, etablissement) values (1, '${A}', 'Banque A'), (1, '${B}', 'Banque B'), (1, '${C}', 'Banque C');
    insert into public.banque_comptes (id, user_id, connexion_id, nom, type, solde) values
      (10, '${A}', 1, 'Compte A', 'courant', 100), (10, '${B}', 1, 'Compte B', 'courant', 200), (10, '${C}', 1, 'Compte C', 'courant', 300);
    insert into public.banque_placements (id, user_id, compte_id, libelle, valeur) values (100, '${A}', 10, 'Fonds A', 1000);
    insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle, categorie) values
      (1000, '${A}', 10, ${AUJ}, -50, 'CARTE SUPERMARCHE', 'alimentation'), (1000, '${C}', 10, ${AUJ}, -5, 'CARTE C', 'divers');
    insert into public.banque_mois (user_id, mois, categorie, entrees, sorties, nombre) values
      ('${A}', date_trunc('month', ${AUJ})::date, 'alimentation', 0, 50, 1), ('${C}', date_trunc('month', ${AUJ})::date, 'divers', 0, 5, 1);`);
});
after(async () => { await db.close(); });

test("migration 0028 : en-tête, tutoiement, restrictive, aal2, sans secret ; jamais appliquée par le test lui-même (déjà dans la chaîne)", () => {
  assert.match(SQL, /^-- Boussole : double authentification/);
  assert.match(SQL, /apply_migration \(name = "mfa"\)/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(SQL, /conseiller/i);
  assert.match(SQL, /as restrictive/);
  assert.match(SQL, /\(select auth\.jwt\(\)->>'aal'\) = 'aal2'/);
  assert.doesNotMatch(SQL, /\bdrop\s+policy\b/i, "aucune politique existante n'est retirée ni affaiblie");
  assert.doesNotMatch(SQL, /sb_secret_|eyJhbGci/);
});

test("les tables banque_* sont bien celles de 0021 : connexions, comptes, placements, opérations, mois", () => {
  assert.deepEqual(TABLES_BANQUE, ["banque_comptes", "banque_connexions", "banque_mois", "banque_operations", "banque_placements"]);
});

test("pg_policies : chaque table banque_* a une politique RESTRICTIVE pour authenticated exigeant aal2 ; les politiques existantes sont intactes", async () => {
  await superu();
  for (const t of TABLES_BANQUE) {
    const r = await q(`select policyname, permissive, roles::text, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = '${t}' and permissive = 'RESTRICTIVE'`);
    assert.equal(r.length, 1, t + " : une politique restrictive");
    assert.match(r[0].roles, /authenticated/, t);
    assert.equal(r[0].cmd, "ALL", t + " : toutes les commandes");
    assert.match(r[0].qual, /aal/, t); assert.match(r[0].qual, /aal2/, t);
    const perm = await q(`select policyname from pg_policies where schemaname = 'public' and tablename = '${t}' and permissive = 'PERMISSIVE'`);
    assert.ok(perm.length >= 1 && perm.some(p => /select/.test(p.policyname)), t + " : politique de propriétaire conservée");
  }
  const rls = await q(`select relname, relrowsecurity from pg_class where relname = any($1)`, [TABLES_BANQUE]);
  assert.ok(rls.every(r => r.relrowsecurity), "RLS toujours activée");
});

test("aal2 + facteur vérifié : A lit toutes ses données bancaires (et rien d'autre que les siennes)", async () => {
  await session(A, "aal2");
  for (const t of TABLES_BANQUE) {
    const rows = await q(`select user_id from public.${t}`);
    assert.ok(rows.length >= 1, t + " : A lit ses lignes");
    assert.ok(rows.every(r => r.user_id === A), t + " : seulement les siennes");
  }
});

test("aal1 (même avec un facteur vérifié) : A ne voit rien dans aucune table banque_*", async () => {
  await session(A, "aal1");
  for (const t of TABLES_BANQUE) assert.deepEqual(await q(`select user_id from public.${t}`), [], t);
});

test("revendication aal absente : traitée comme aal1 (rien de lisible)", async () => {
  await session(C, "aucun");
  for (const t of TABLES_BANQUE) assert.deepEqual(await q(`select user_id from public.${t}`), [], t);
});

test("sans facteur (C) ou facteur non vérifié (B) : aal2 inatteignable, donc rien tant qu'il n'a pas activé la double authentification", async () => {
  for (const [uid, nom] of [[B, "facteur non vérifié"], [C, "aucun facteur"]]) {
    await superu();
    await assert.rejects(session(uid, "aal2"), /aal2 impossible sans facteur vérifié/, nom);
    await session(uid, "aal1");
    for (const t of TABLES_BANQUE) assert.deepEqual(await q(`select user_id from public.${t}`), [], nom + " : " + t);
  }
  // même un jeton forgé aal2 ne contourne pas la RLS de propriétaire : la restrictive s'ajoute, elle ne remplace pas
  await superu();
  await db.exec(`set test.uid = '${C}'; set test.aal = 'aal2'; set role authenticated;`);
  const mine = await q(`select user_id from public.banque_comptes`);
  assert.ok(mine.every(r => r.user_id === C), "aal2 ne donne accès qu'à ses propres lignes");
});

test("écritures : le rattachement d'un compte (update des 5 colonnes) exige aussi aal2", async () => {
  await session(A, "aal1");
  const r = await db.query(`update public.banque_comptes set ignore = true where id = 10 returning id`);
  assert.equal(r.rows.length, 0, "aal1 : aucune ligne modifiable");
  await session(A, "aal2");
  const r2 = await db.query(`update public.banque_comptes set ignore = true where id = 10 returning id`);
  assert.equal(r2.rows.length, 1, "aal2 : modifiable");
  await db.query(`update public.banque_comptes set ignore = false where id = 10`);
  await session(A, "aal1");
  await refuse(`insert into public.banque_mois (user_id, mois, categorie) values ('${A}', date_trunc('month', ${AUJ})::date, 'x')`, /permission denied|row-level security/, "insertion");
});

test("export_all() (security invoker) : sans aal2, les sections banque_* sortent vides ; avec aal2, elles contiennent les données", async () => {
  await session(A, "aal1");
  const sans = (await q(`select public.export_all() j`))[0].j;
  for (const t of TABLES_BANQUE) assert.deepEqual(sans[t], [], t + " : vide en aal1");
  await session(A, "aal2");
  const avec = (await q(`select public.export_all() j`))[0].j;
  for (const t of TABLES_BANQUE) assert.ok(avec[t].length >= 1, t + " : présent en aal2");
});

test("aucune fonction security definer exécutable par authenticated ne lit une table banque_* (sinon elle contournerait la RLS)", async () => {
  await superu();
  const r = await q(`select p.proname, p.prosecdef, has_function_privilege('authenticated', p.oid, 'execute') as exec_auth, has_function_privilege('anon', p.oid, 'execute') as exec_anon,
      pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'prive') and p.prokind = 'f'`);
  const lisantBanque = r.filter(f => /banque_(connexions|comptes|placements|operations|mois)/.test(f.def));
  assert.ok(lisantBanque.length >= 5, "les fonctions banque sont bien repérées");
  for (const f of lisantBanque) {
    if (f.prosecdef) assert.ok(!f.exec_auth && !f.exec_anon, `${f.proname} : security definer lisant la banque, réservée à service_role`);
  }
  // les fonctions security definer qui restent exécutables par authenticated n'ont aucun lien avec la banque
  for (const f of r.filter(x => x.prosecdef && x.exec_auth)) assert.doesNotMatch(f.def, /banque_/, f.proname);
});

test("service_role (fonction powens, nuit) n'est pas concerné : il lit et écrit sans aal2", async () => {
  await db.exec(`reset role; set test.uid = ''; set test.aal = 'aucun'; set role service_role;`);
  assert.ok((await q(`select 1 from public.banque_comptes`)).length >= 3);
  await db.exec(`insert into public.banque_mois (user_id, mois, categorie, entrees, sorties, nombre) values ('${B}', date_trunc('month', ${AUJ})::date, 'divers', 0, 1, 1)`);
  await superu();
});
