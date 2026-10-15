// Propositions de réglages (0019) exercées sur un vrai PostgreSQL (PGlite, en mémoire) : toutes les migrations 0001 → 0019
// appliquées, avec des bouchons pour ce que PGlite n'a pas (schéma auth, rôles, pg_cron, pg_net, Vault, pgcrypto) ; les lignes
// « create extension » sont retirées à la lecture. Puis appliquer_propositions sur la nouvelle cible config (matelas, versements
// programmés) et la clé classes du profil : application, refus des clés et valeurs hors liste, tout ou rien, RLS.
// Aucun réseau ni secret : exécuté en CI (npm ci && npm test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { comme } from "./helpers/pglite.mjs";

const DIR = new URL("../supabase/migrations/", import.meta.url);
const BOUCHONS = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema extensions; create schema cron; create schema net; create schema vault;
create table auth.users (id uuid primary key, is_anonymous boolean default false, created_at timestamptz default now(), last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('role', 'authenticated', 'aal', 'aal2') $$; -- requis par 0028 (SEC2) ; session pleinement connectée
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, factor_type text default 'totp', status text not null); -- lue par public.mfa_exigee() (0028), vide ici
-- lues par public.connecteur_autorise() et les fonctions de 0033 (connecteurs autorisés), vides ici
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null, created_at timestamptz not null default now(), not_after timestamptz, oauth_client_id uuid);
create table auth.oauth_clients (id uuid primary key default gen_random_uuid(), client_name text, deleted_at timestamptz);
create table auth.oauth_authorizations (id uuid primary key default gen_random_uuid(), authorization_id text not null unique, client_id uuid not null, user_id uuid, status text not null default 'pending', created_at timestamptz not null default now(), expires_at timestamptz not null, approved_at timestamptz);
create function extensions.gen_random_bytes(int) returns bytea language sql as $$ select decode(md5(random()::text), 'hex') $$;
create table cron.job (jobname text);
create function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
create function cron.unschedule(text) returns boolean language sql as $$ select true $$;
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
create table vault.secrets (name text);
create view vault.decrypted_secrets as select name, ''::text as decrypted_secret from vault.secrets;
create function vault.create_secret(text, text, text) returns uuid language sql as $$ insert into vault.secrets values ($2) returning gen_random_uuid() $$;
`;
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
const PEA = "aaaaaaaa-0000-0000-0000-000000000001", LIVRET = "aaaaaaaa-0000-0000-0000-000000000002";
const CLOS = "aaaaaaaa-0000-0000-0000-000000000003", PEA_B = "bbbbbbbb-0000-0000-0000-000000000001";
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
/** Dépose (comme A) une proposition et renvoie son id. */
const proposer = async (cible, apres, o = {}) => (await q(`insert into public.propositions (cible, operation, ref, avant, apres, source)
  values ($1, $2, $3, $4, $5, $6) returning id`, [cible, o.operation ?? "modifier", o.ref ?? null, o.avant ? JSON.stringify(o.avant) : null,
  apres == null ? null : JSON.stringify(apres), o.source ?? "Dit par l'utilisateur"]))[0].id;
const appliquer = async (ids, mods) => (await q("select public.appliquer_propositions($1::uuid[], $2::jsonb) n", [ids, JSON.stringify(mods ?? {})]))[0].n;
const refuse = async (ids, motif, m, mods) => {
  await assert.rejects(appliquer(ids, mods), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
};
const config = async () => (await q("select cushion, recurring from public.config"))[0];
const statut = async id => (await q("select statut from public.propositions where id = $1", [id]))[0].statut;

before(async () => {
  db = new PGlite();
  await db.exec(BOUCHONS);
  for (const f of readdirSync(DIR).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    await db.exec(readFileSync(new URL(f, DIR), "utf8").replace(/^create extension[^;]*;/gim, ""));
  }
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}');
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    insert into public.positions (id, user_id, name, envelope, owner, bloc, mode, value) values
      ('${PEA}', '${A}', 'ETF Monde', 'PEA', 'p1', 'Monde', 'manual', 1000),
      ('${LIVRET}', '${A}', 'Livret A', 'Livrets', 'p1', 'Épargne', 'manual', 5000),
      ('${PEA_B}', '${B}', 'ETF Monde', 'PEA', 'p1', 'Monde', 'manual', 1000);
    insert into public.positions (id, user_id, name, envelope, owner, bloc, mode, value, status) values
      ('${CLOS}', '${A}', 'Ancien CTO', 'CTO', 'p1', 'Monde', 'manual', 0, 'clôturé');
    update public.config set recurring = '[{"id":"rec-pea","label":"Versement PEA","positionId":"${PEA}","amount":300,"day":5,"start":"2026-01-01","lastApplied":"2026-10","hypothesis":null}]'
     where user_id = '${A}';`);
  await comme(db, A);
});
after(async () => { await db.close(); });

test("PGlite : toutes les migrations passent ; contraintes de la cible config (sans ref, modifier seulement)", async () => {
  const id = await proposer("config", { cushion: { mode: "amount", min: 1000, max: null } });
  assert.ok(id);
  for (const op of ["creer", "supprimer"]) {
    await assert.rejects(proposer("config", op === "supprimer" ? null : { cushion: {} }, { operation: op }), /propositions_config|propositions_supprimer/, op);
  }
  await assert.rejects(proposer("reglages", { cushion: {} }), /propositions_cible_check/, "cible inconnue");
  await q("select public.refuser_propositions($1::uuid[])", [[id]]);
});

test("PGlite : matelas en mois de dépenses, puis en montant ; valeur réellement appliquée gardée dans apres", async () => {
  const id = await proposer("config", { cushion: { mode: "months", months: 6, depenses: "2500" } });
  assert.equal(await appliquer([id]), 1);
  assert.deepEqual((await config()).cushion, { mode: "months", months: 6, depenses: 2500 });
  assert.equal(await statut(id), "acceptee");
  const id2 = await proposer("config", { cushion: { mode: "amount", min: 15000, max: 20000 } });
  assert.equal(await appliquer([id2], { [id2]: { cushion: { mode: "amount", min: 12000 } } }), 1, "corrigée avant validation");
  assert.deepEqual((await config()).cushion, { mode: "amount", min: 12000, max: null });
  assert.deepEqual((await q("select apres from public.propositions where id = $1", [id2]))[0].apres, { cushion: { mode: "amount", min: 12000 } });
});

test("PGlite : matelas invalide refusé, rien d'appliqué", async () => {
  const avant = (await config()).cushion;
  const cas = [
    [{ cushion: { mode: "amount", min: 20000, max: 10000 } }, /cushion\.max invalide/, "max < min"],
    [{ cushion: { mode: "amount", min: -1 } }, /cushion\.min invalide/, "min négatif"],
    [{ cushion: { mode: "months", months: 0, depenses: 2000 } }, /cushion\.months invalide/, "0 mois"],
    [{ cushion: { mode: "months", months: 6 } }, /cushion\.depenses invalide/, "dépenses absentes"],
    [{ cushion: { mode: "months", months: 6, depenses: 2000, min: 3 } }, /champ « min » inconnu/, "champ en trop"],
    [{ cushion: { mode: "semaines", min: 3 } }, /cushion\.mode « semaines » inconnu/, "mode inconnu"],
    [{ cushion: 6 }, /cushion : objet attendu/, "pas un objet"],
    [{ rules: [] }, /réglage « rules » non modifiable/, "clé hors liste"],
    [{ cushion: { mode: "amount", min: 1 }, targets: {} }, /réglage « targets » non modifiable/, "clé hors liste avec une clé permise"],
    [{}, /cushion ou recurring attendu/, "objet vide"],
  ];
  for (const [apres, motif, m] of cas) {
    const id = await proposer("config", apres);
    await refuse([id], motif, m);
    await refuse([id], /^Proposition non appliquée \(réglages, modifier\) : /, m + " (préfixe du message)");
    assert.equal(await statut(id), "en_attente", m);
    await q("select public.refuser_propositions($1::uuid[])", [[id]]);
  }
  assert.deepEqual((await config()).cushion, avant);
});

test("PGlite : versements programmés en remplacement complet ; lastApplied tenu par la base, champs inconnus conservés", async () => {
  const id = await proposer("config", { recurring: [
    { id: "rec-pea", label: "Versement PEA", positionId: PEA, amount: "250", day: 10, start: "2026-01-01", lastApplied: "2025-01", hypothesis: "prime annuelle", note: "x" },
    { id: "rec-livret", label: "Épargne Livret A", positionId: LIVRET, amount: 200, day: 1, lastApplied: "2026-10" },
  ] });
  assert.equal(await appliquer([id]), 1);
  const r = (await config()).recurring;
  assert.deepEqual(r, [
    { id: "rec-pea", label: "Versement PEA", positionId: PEA, amount: 250, day: 10, start: "2026-01-01", lastApplied: "2026-10", hypothesis: "prime annuelle", note: "x" },
    { id: "rec-livret", label: "Épargne Livret A", positionId: LIVRET, amount: 200, day: 1 },
  ], "lastApplied de la base pour rec-pea, retiré pour le nouveau versement");
  const vide = await proposer("config", { recurring: [] });
  assert.equal(await appliquer([vide]), 1);
  assert.deepEqual((await config()).recurring, [], "liste vide : plus aucun versement");
  const re = await proposer("config", { recurring: r });
  assert.equal(await appliquer([re]), 1);
});

test("PGlite : versement invalide refusé (montant, jour, ligne, doublon, date), rien d'appliqué", async () => {
  const avant = (await config()).recurring;
  const v = o => ({ id: "rec-x", label: "Versement X", positionId: PEA, amount: 100, day: 5, ...o });
  const cas = [
    [[v({ amount: 0 })], /montant \(amount\) invalide/, "montant nul"],
    [[v({ amount: "abc" })], /montant \(amount\) invalide/, "montant non numérique"],
    [[v({ day: 29 })], /jour \(day\) invalide/, "jour 29"],
    [[v({ day: 2.5 })], /jour \(day\) invalide/, "jour décimal"],
    [[v({ day: 0 })], /jour \(day\) invalide/, "jour 0"],
    [[v({ positionId: "inconnue" })], /ligne « inconnue » introuvable ou clôturée/, "ligne inconnue"],
    [[v({ positionId: PEA_B })], /introuvable ou clôturée/, "ligne d'un autre utilisateur"],
    [[v({ positionId: CLOS })], /introuvable ou clôturée/, "ligne clôturée"],
    [[v({}), v({ label: "Autre" })], /identifiant « rec-x » en double/, "doublon d'id"],
    [[v({ id: "" })], /identifiant \(id\) manquant/, "id vide"],
    [[v({ label: " " })], /libellé \(label\) manquant/, "libellé vide"],
    [[v({ start: "2026-13-40" })], /date de début \(start\) invalide/, "date invalide"],
    [["texte"], /versement 1 : objet attendu/, "élément non objet"],
    [{ id: "rec-x" }, /recurring : liste de versements attendue/, "pas une liste"],
    [Array.from({ length: 51 }, (_, i) => v({ id: "r" + i })), /50 versements au plus/, "trop de versements"],
  ];
  for (const [recurring, motif, m] of cas) {
    const id = await proposer("config", { recurring });
    await refuse([id], motif, m);
    await q("select public.refuser_propositions($1::uuid[])", [[id]]);
  }
  assert.deepEqual((await config()).recurring, avant);
});

test("PGlite : classe d'une poche (profil.classes) : fusion, null retire, classe hors liste refusée", async () => {
  const id = await proposer("profil", { classes: { Asie: "emergents", Protection: "or" } });
  assert.equal(await appliquer([id]), 1);
  assert.deepEqual((await q("select classes from public.profiles"))[0].classes, { Asie: "emergents", Protection: "or" });
  const id2 = await proposer("profil", { classes: { Protection: null, Monde: "actions" }, foyer: { adultes: 2 } });
  assert.equal(await appliquer([id2]), 1);
  const pr = (await q("select classes, foyer from public.profiles"))[0];
  assert.deepEqual(pr.classes, { Asie: "emergents", Monde: "actions" });
  assert.equal(pr.foyer.adultes, 2, "le reste du profil s'applique comme avant");
  for (const [classes, motif, m] of [
    [{ Asie: "actions_emergentes" }, /classe « actions_emergentes » inconnue pour la poche « Asie »/, "classe hors liste"],
    [{ Asie: 3 }, /classe « 3 » inconnue/, "classe non texte"],
    [{ "": "or" }, /nom de poche invalide/, "poche vide"],
    [["or"], /classes : objet/, "pas un objet"],
  ]) {
    const x = await proposer("profil", { classes });
    await refuse([x], motif, m);
    await q("select public.refuser_propositions($1::uuid[])", [[x]]);
  }
  assert.deepEqual((await q("select classes from public.profiles"))[0].classes, { Asie: "emergents", Monde: "actions" });
});

test("PGlite : tout ou rien — une proposition invalide annule tout l'appel", async () => {
  const avant = await config();
  const ok1 = await proposer("config", { cushion: { mode: "months", months: 3, depenses: 1800 } });
  const ok2 = await proposer("profil", { classes: { Europe: "small_caps" } });
  const ko = await proposer("config", { recurring: [{ id: "r", label: "R", positionId: PEA, amount: 10, day: 31 }] });
  await refuse([ok1, ok2, ko], /jour \(day\) invalide/, "lot avec une proposition invalide");
  assert.deepEqual(await config(), avant, "matelas inchangé");
  assert.equal((await q("select classes ? 'Europe' e from public.profiles"))[0].e, false, "classe inchangée");
  for (const id of [ok1, ok2, ko]) assert.equal(await statut(id), "en_attente");
  assert.equal(await appliquer([ok1, ok2]), 2, "sans la proposition invalide, le reste passe");
  await q("select public.refuser_propositions($1::uuid[])", [[ko]]);
});

test("PGlite : RLS — B n'applique pas une proposition de A et ne touche pas à sa config", async () => {
  const id = await proposer("config", { cushion: { mode: "amount", min: 999 } });
  await comme(db, B);
  assert.equal(await appliquer([id]), 0);
  assert.equal((await q("select count(*)::int n from public.config"))[0].n, 1, "B ne voit que sa config");
  await comme(db, A);
  assert.equal(await statut(id), "en_attente");
  assert.notDeepEqual((await config()).cushion, { mode: "amount", min: 999, max: null });
});
