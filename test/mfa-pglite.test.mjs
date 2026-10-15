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
    insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
    -- A : facteur vérifié ; B : facteur non vérifié (inscription abandonnée) ; C : aucun facteur
    insert into auth.mfa_factors (user_id, status) values ('${A}', 'verified'), ('${B}', 'unverified');
    -- données personnelles hors banque_* (le salaire et l'employeur d'une proposition, comme ceux déposés par la synchronisation)
    -- profiles et config : une ligne par utilisateur, créée par le déclencheur handle_new_user
    insert into public.positions (user_id, name, value) values ('${A}', 'Livret A', 8000), ('${B}', 'Livret B', 10), ('${C}', 'Livret C', 20);
    insert into public.snapshots (user_id, date, total) values ('${A}', ${AUJ}, 12345), ('${B}', ${AUJ}, 1), ('${C}', ${AUJ}, 2);
    insert into public.credits (user_id, nom, crd) values ('${A}', 'Crédit A', 90000), ('${C}', 'Crédit C', 5000);
    insert into public.propositions (user_id, cible, operation, apres, source) values
      ('${A}', 'profil', 'modifier', '{"salaire": 3200, "employeur": "Société Fictive"}', 'synchronisation bancaire'),
      ('${C}', 'profil', 'modifier', '{"salaire": 2000}', 'synchronisation bancaire');
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
  assert.match(SQL, /public\.mfa_exigee\(\)/);
  assert.doesNotMatch(SQL, /laisser passer|client_id/i, "aucun passe-droit pour les jetons OAuth : la page de consentement n'est qu'un contrôle côté navigateur");
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
    const r = await q(`select policyname, permissive, roles::text, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = '${t}' and permissive = 'RESTRICTIVE' order by cmd`);
    // « <table>: aal2 » (0028, toutes commandes ; 0033 y ajoute la lecture par un connecteur autorisé) et « <table>: suppression aal2 » (0033)
    assert.deepEqual(r.map(p => p.policyname), [t + ": aal2", t + ": suppression aal2"], t + " : politiques restrictives");
    assert.match(r[0].with_check, /aal2/, t); assert.doesNotMatch(r[0].with_check, /connecteur_autorise|mfa_exigee/, t + " : écriture en aal2 seulement");
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

/* ---------- niveau 2 : toutes les données personnelles hors banque_* (finding I2) ---------- */

/** Tables de public qui portent une colonne user_id (donnée personnelle), banque_* à part : lues dans le catalogue, donc une table
    future est couverte par le test dès qu'elle existe. */
async function tablesPersonnelles() {
  await superu();
  const r = await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`);
  return r.map(x => x.relname);
}

test("public.mfa_exigee() : security definer, stable, search_path vide, réservée à authenticated (ni anon ni public)", async () => {
  await superu();
  const f = (await q(`select p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid) res, has_function_privilege('authenticated', p.oid, 'execute') ea,
      has_function_privilege('anon', p.oid, 'execute') en, has_function_privilege('public', p.oid, 'execute') ep, pg_get_functiondef(p.oid) def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'mfa_exigee'`))[0];
  assert.ok(f, "fonction présente");
  assert.equal(f.prosecdef, true, "security definer");
  assert.equal(f.provolatile, "s", "stable");
  assert.equal(f.res, "boolean");
  assert.ok((f.proconfig || []).some(x => /^search_path=("")?$/.test(x) || /search_path/.test(x)), "search_path fixé");
  assert.match(f.def, /set search_path to ''/i);
  assert.equal(f.ea, true); assert.equal(f.en, false, "anon n'exécute pas"); assert.equal(f.ep, false, "public n'exécute pas");
  // vraie réponse pour chaque cas
  for (const [uid, attendu] of [[A, true], [B, false], [C, false]]) {
    await session(uid, "aal1");
    assert.equal((await q(`select public.mfa_exigee() v`))[0].v, attendu, uid);
  }
  await db.exec(`reset role; set test.uid = ''; set role anon;`);
  await refuse(`select public.mfa_exigee()`, /permission denied/, "anon");
  await superu();
});

test("couverture : toute table de public avec un user_id a sa politique RESTRICTIVE (banque_* : aal2 strict ; les autres : aal2 si facteur vérifié)", async () => {
  const tables = await tablesPersonnelles();
  assert.ok(tables.length >= 20, "les tables personnelles sont bien repérées : " + tables.join(", "));
  for (const t of ["positions", "credits", "snapshots", "propositions", "budgets", "objectifs", "config", "profiles", "journal", "memoire_agent", "routines", "connexions_assistant", "fonctionnalites", "biens", "transactions", "status"])
    assert.ok(tables.includes(t), t + " repérée");
  for (const t of tables) {
    const r = await q(`select policyname, roles::text, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = $1 and permissive = 'RESTRICTIVE' and cmd = 'ALL'`, [t]);
    assert.ok(r.length >= 1, t + " : politique restrictive MFA manquante (migration 0028)");
    assert.match(r[0].roles, /authenticated/, t); assert.equal(r[0].cmd, "ALL", t);
    for (const e of [r[0].qual, r[0].with_check]) {
      assert.match(e, /aal2/, t);
      if (t.startsWith("banque_")) assert.doesNotMatch(e, /mfa_exigee/, t + " : toujours aal2, même sans facteur");
      else assert.match(e, /mfa_exigee/, t + " : aal2 seulement si un facteur est vérifié");
    }
    const rls = await q(`select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass`, [t]);
    assert.equal(rls[0].relrowsecurity, true, t + " : RLS activée");
  }
});

test("facteur vérifié + aal1 : A ne voit rien dans aucune table personnelle (positions, snapshots, propositions, crédits, profil…)", async () => {
  const tables = (await tablesPersonnelles()).filter(t => !t.startsWith("banque_"));
  await superu();
  const garnies = [];
  for (const t of tables) if ((await q(`select 1 from public.${t} where user_id = '${A}'`)).length) garnies.push(t);
  for (const t of ["positions", "snapshots", "propositions", "credits", "profiles", "config", "fonctionnalites"]) assert.ok(garnies.includes(t), t + " : donnée de test présente");
  await session(A, "aal1");
  for (const t of tables) assert.deepEqual(await q(`select user_id from public.${t}`), [], t + " : fermée en aal1");
  await session(A, "aucun");
  for (const t of garnies) assert.deepEqual(await q(`select user_id from public.${t}`), [], t + " : fermée sans revendication aal");
});

test("facteur vérifié + aal1 : aucune écriture non plus (insert, update, delete refusés ou sans effet)", async () => {
  await session(A, "aal1");
  await refuse(`insert into public.positions (user_id, name) values ('${A}', 'Pirate')`, /row-level security/, "insert positions");
  assert.equal((await db.query(`update public.positions set value = 1 where user_id = '${A}' returning id`)).rows.length, 0, "update");
  assert.equal((await db.query(`delete from public.snapshots where user_id = '${A}' returning date`)).rows.length, 0, "delete");
  await superu();
  assert.equal((await q(`select value::int v from public.positions where user_id = '${A}'`))[0].v, 8000, "intact");
});

test("facteur vérifié + aal2 : A lit ses lignes dans chaque table personnelle, et seulement les siennes", async () => {
  const tables = (await tablesPersonnelles()).filter(t => !t.startsWith("banque_"));
  await session(A, "aal2");
  let n = 0;
  for (const t of tables) {
    const rows = await q(`select user_id from public.${t}`);
    assert.ok(rows.every(r => r.user_id === A), t + " : seulement les siennes");
    n += rows.length;
  }
  assert.ok(n >= 7, "au moins une ligne dans plusieurs tables");
  assert.equal((await q(`select value::int v from public.positions`))[0].v, 8000);
  assert.equal((await q(`select (apres->>'salaire')::int s from public.propositions`))[0].s, 3200);
  assert.equal((await q(`select total::int t from public.snapshots`))[0].t, 12345);
  // écriture en aal2
  await db.exec(`update public.positions set value = 8100 where user_id = '${A}'`);
  assert.equal((await q(`select value::int v from public.positions`))[0].v, 8100);
  await db.exec(`update public.positions set value = 8000 where user_id = '${A}'`);
});

test("sans facteur (C) ou facteur non vérifié (B) : aal1 suffit pour leurs données non bancaires (rien ne change), les comptes bancaires restent fermés", async () => {
  for (const [uid, nom] of [[C, "aucun facteur"], [B, "facteur non vérifié"]]) {
    await session(uid, "aal1");
    assert.equal((await q(`select name from public.positions`)).length, 1, nom + " : positions");
    assert.equal((await q(`select total::int t from public.snapshots`)).length, 1, nom + " : snapshots");
    assert.equal((await q(`select 1 from public.profiles`)).length, 1, nom + " : profil");
    assert.equal((await q(`select 1 from public.fonctionnalites where cle = 'banque'`)).length, 1, nom + " : interrupteur lisible (carte « active la double authentification »)");
    for (const t of TABLES_BANQUE) assert.deepEqual(await q(`select 1 from public.${t}`), [], nom + " : " + t + " fermée");
    // et il peut écrire, comme avant
    await db.exec(`update public.positions set note = 'ok' where user_id = '${uid}'`);
    assert.equal((await q(`select note from public.positions`))[0].note, "ok");
  }
  await session(C, "aucun");
  assert.equal((await q(`select 1 from public.positions`)).length, 1, "revendication aal absente, sans facteur : lisible");
  assert.equal((await q(`select 1 from public.credits`)).length, 1);
});

test("une session sans facteur ne voit que ses lignes (pas celles de A), avec ou sans le niveau 2", async () => {
  await session(C, "aal1");
  assert.ok((await q(`select user_id from public.propositions`)).every(r => r.user_id === C));
  assert.ok((await q(`select user_id from public.credits`)).every(r => r.user_id === C));
});

test("export_all() : A en aal1 n'exporte rien de personnel (RLS), en aal2 tout ; C exporte ses données en aal1", async () => {
  await session(A, "aal1");
  const sans = (await q(`select public.export_all() j`))[0].j;
  for (const t of ["positions", "snapshots", "credits", "propositions"]) assert.deepEqual(sans[t], [], t + " : vide en aal1");
  await session(A, "aal2");
  const avec = (await q(`select public.export_all() j`))[0].j;
  for (const t of ["positions", "snapshots", "credits", "propositions"]) assert.ok(avec[t].length >= 1, t + " : présent en aal2");
  await session(C, "aal1");
  const c = (await q(`select public.export_all() j`))[0].j;
  assert.ok(c.positions.length >= 1 && c.snapshots.length >= 1, "sans facteur : comme avant");
});

test("delete_me() (security definer) : fermer son compte fonctionne pour un utilisateur sans facteur et la cascade passe malgré les politiques", async () => {
  await superu();
  const D = "44444444-4444-4444-4444-444444444444";
  await db.exec(`insert into auth.users (id) values ('${D}'); insert into public.positions (user_id, name) values ('${D}', 'À effacer');
    insert into public.snapshots (user_id, date, total) values ('${D}', ${AUJ}, 3);`);
  await session(D, "aal1");
  await db.exec(`select public.delete_me()`);
  await superu();
  assert.equal((await q(`select 1 from public.positions where user_id = '${D}'`)).length, 0);
  assert.equal((await q(`select 1 from public.snapshots where user_id = '${D}'`)).length, 0);
  assert.equal((await q(`select 1 from auth.users where id = '${D}'`)).length, 0);
});

test("service_role (nuit, powens) lit et écrit les tables personnelles sans aal2, même pour un utilisateur à facteur vérifié", async () => {
  await db.exec(`reset role; set test.uid = ''; set test.aal = 'aucun'; set role service_role;`);
  assert.ok((await q(`select 1 from public.positions where user_id = '${A}'`)).length >= 1);
  assert.ok((await q(`select 1 from public.snapshots where user_id = '${A}'`)).length >= 1);
  await db.exec(`insert into public.snapshots (user_id, date, total) values ('${A}', ${AUJ}::date - 1, 5)`);
  await superu();
});

test("spécification : repli « jetons OAuth » interdit explicite, runbook de support, lien M3 ; 0028 sans passe-droit client_id", () => {
  const spec = readFileSync(new URL("../docs/superpowers/specs/2026-10-14-sec2-mfa-design.md", import.meta.url), "utf8");
  assert.match(spec, /Repli interdit, à ne jamais implémenter/);
  assert.match(spec, /approveAuthorization/);
  assert.doesNotMatch(spec, /Repli possible/);
  assert.match(spec, /## Support : appareil de double authentification perdu/);
  assert.match(spec, /auth\.admin\.mfa\.deleteFactor/);
  assert.match(spec, /https:\/\/supabase\.com\/docs\/guides\/auth\/auth-mfa\/totp/);
  assert.match(spec, /muette/);
  assert.doesNotMatch(spec, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
});
