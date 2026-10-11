// Base PostgreSQL en mémoire (PGlite, WebAssembly) avec des bouchons minimaux de l'environnement Supabase : rôles anon et
// authenticated, schéma auth (users, uid() lu dans le réglage test.uid), tables personnelles réduites aux colonnes que lisent
// les migrations (export_all). Sert à appliquer les migrations du dépôt et à les exercer sans projet Supabase.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

export const BOUCHONS = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
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
