// Base PostgreSQL en mémoire (PGlite, WebAssembly) avec des bouchons minimaux de l'environnement Supabase : rôles anon et
// authenticated, schéma auth (users, uid() lu dans le réglage test.uid), tables personnelles réduites aux colonnes que lisent
// les migrations (export_all). Sert à appliquer les migrations du dépôt et à les exercer sans projet Supabase.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

export const BOUCHONS = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
-- auth.jwt() (SEC2, migration 0028) : niveau d'assurance aal2 par défaut, réglable par test.aal (voir BOUCHONS_SUPABASE plus bas)
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('role', 'authenticated', 'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal2')) $$;
create table public.connexions_assistant (user_id uuid not null default auth.uid(), client_id text not null, client_nom text, premier_le timestamptz default now(), dernier_le timestamptz default now(), appels int default 1, primary key (user_id, client_id));
create table public.profiles (user_id uuid); create table public.biens (user_id uuid, created_at timestamptz); create table public.credits (user_id uuid, created_at timestamptz);
create table public.positions (user_id uuid, created_at timestamptz); create table public.transactions (user_id uuid, date date, created_at timestamptz);
create table public.snapshots (user_id uuid, date date); create table public.config (user_id uuid); create table public.status (user_id uuid);
create table public.budgets (user_id uuid); create table public.objectifs (user_id uuid, priorite int, created_at timestamptz); create table public.propositions (user_id uuid, cree_le timestamptz);
`;

/** Nouvelle base : bouchons, puis les migrations demandées (noms de fichiers de supabase/migrations, dans l'ordre). */
export async function baseAvec(migrations) {
  const db = new PGlite();
  await db.exec(BOUCHONS);
  for (const f of migrations) await db.exec(readFileSync(new URL("../../supabase/migrations/" + f, import.meta.url), "utf8"));
  return db;
}

/** Rôle authenticated (pour exercer la RLS : PGlite tourne sinon en superutilisateur) avec l'utilisateur `uid`. */
export async function comme(db, uid) {
  await db.exec(`reset role; set test.uid = '${uid}'; set role authenticated;`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Chaîne complète : toutes les migrations 0001 → … appliquées dans l'ordre (lignes « create extension » retirées), sur des
// bouchons plus fidèles de l'environnement Supabase : rôles anon / authenticated / service_role ; auth.users avec les colonnes
// lues par 0005 ; privilèges par défaut du schéma public (tables, séquences et fonctions ouvertes à anon, authenticated et
// service_role, comme sur Supabase) ; extensions.gen_random_bytes et extensions.digest (pgcrypto ; SHA-256 réel, par la fonction sha256 de
// PostgreSQL) ; pg_cron (cron.job garde nom, horaire et commande des tâches planifiées) ; pg_net (net.http_post sans effet) ;
// Vault (vault.secrets en clair, vault.decrypted_secrets, vault.create_secret). Aucun réseau ni secret réel.
// ---------------------------------------------------------------------------------------------------------------------------
export const BOUCHONS_SUPABASE = `
create role anon; create role authenticated; create role service_role bypassrls;
-- privilèges par défaut de Supabase sur le schéma public (les migrations retirent ce qui n'a pas lieu d'être)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth; create schema extensions; create schema cron; create schema net; create schema vault;
create table auth.users (id uuid primary key, is_anonymous boolean default false, created_at timestamptz default now(), last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
-- auth.jwt() : revendications du jeton de la session simulée. Le niveau d'assurance (aal) vient du réglage test.aal : « aal2 » par défaut
-- (les tests des autres migrations simulent un utilisateur pleinement connecté), « aal1 » ou « aucun » (revendication absente) pour la
-- double authentification (test/mfa-pglite.test.mjs).
create function auth.jwt() returns jsonb language sql stable
  as $$ select case coalesce(nullif(current_setting('test.aal', true), ''), 'aal2')
               when 'aucun' then jsonb_build_object('role', 'authenticated')
               else jsonb_build_object('role', 'authenticated', 'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal2')) end $$;
create function extensions.gen_random_bytes(int) returns bytea language sql as $$ select decode(md5(random()::text), 'hex') $$;
create function extensions.digest(text, text) returns bytea language sql immutable strict
  as $$ select case lower($2) when 'sha256' then sha256(convert_to($1, 'UTF8')) end $$;
create table cron.job (jobid bigserial, jobname text unique, schedule text, command text);
create function cron.schedule(text, text, text) returns bigint language sql
  as $$ insert into cron.job (jobname, schedule, command) values ($1, $2, $3)
        on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(text) returns boolean language sql as $$ delete from cron.job where jobname = $1 returning true $$;
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql
  as $$ insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret) returning id $$;
`;

/** Nouvelle base : bouchons Supabase, puis toutes les migrations du dépôt (jusqu'à `jusqua` inclus, nom de fichier, si donné). */
export async function baseComplete(jusqua) {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const db = new PGlite();
  await db.exec(BOUCHONS_SUPABASE);
  for (const f of readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    if (jusqua && f > jusqua) break;
    await db.exec(readFileSync(new URL(f, dir), "utf8").replace(/^create extension[^;]*;/gim, ""));
  }
  return db;
}
