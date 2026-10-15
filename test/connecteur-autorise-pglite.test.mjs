// SEC2 bis : autorisation du connecteur liée à un second facteur (migration 0033_connecteurs_autorises.sql), exercée sur un vrai
// PostgreSQL (PGlite) : toutes les migrations appliquées sur les bouchons Supabase (test/helpers/pglite.mjs). Constat de la préproduction
// (SEC5 § 3.12) : un jeton OAuth est toujours aal1. 0033 ajoute une autorisation par (utilisateur, client OAuth), créée seulement par une
// session aal2 (page de consentement, juste après le code) et liée à UNE session OAuth : celle née de l'échange du code de cette demande.
// auth.jwt() est simulé : test.aal, test.client_id et test.session_id ; auth.sessions et auth.oauth_authorizations sont des bouchons
// fidèles aux colonnes de GoTrue v2.190 (une demande disparaît à l'échange de son code). Valeurs fictives uniquement.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { baseComplete, BOUCHONS_SUPABASE } from "./helpers/pglite.mjs";

const DIR = new URL("../supabase/migrations/", import.meta.url);
const FICHIER = readdirSync(DIR).find(f => /^0033_.*\.sql$/.test(f));
const SQL = FICHIER ? readFileSync(new URL(FICHIER, DIR), "utf8") : "";
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", C = "33333333-3333-3333-3333-333333333333";
const CLAUDE = "aaaaaaaa-0000-4000-8000-000000000001", AUTRE = "aaaaaaaa-0000-4000-8000-000000000002", DYNAMIQUE = "aaaaaaaa-0000-4000-8000-000000000003";
const AUJ = `(now() at time zone 'Europe/Paris')::date`;
const BANQUE = ["banque_connexions", "banque_comptes", "banque_placements", "banque_operations", "banque_mois"];
let db, n = 0;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const refuse = async (s, motif, m) => {
  await assert.rejects(db.query(s), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
};

/** Superutilisateur (bouchons, préparation, vérifications). */
const superu = () => db.exec(`reset role; set test.uid = ''; set test.aal = 'aal2'; set test.client_id = ''; set test.session_id = ''; set test.totp_le = '';`);
/** Jeton simulé : session de navigateur (sans client) ou jeton OAuth (client + session). */
async function jeton(uid, aal, { client = "", session = "", totpLe = "" } = {}) {
  await db.exec(`reset role; set test.uid = '${uid}'; set test.aal = '${aal}'; set test.client_id = '${client}'; set test.session_id = '${session}'; set test.totp_le = '${totpLe}'; set role authenticated;`);
}
/** Demande d'autorisation OAuth en attente (créée par GoTrue à /oauth/authorize, rattachée à l'utilisateur par getAuthorizationDetails). */
async function demande(uid, client = CLAUDE, { status = "pending", expire = "now() + interval '10 minutes'" } = {}) {
  await superu();
  const id = `auth-${++n}-${Math.random().toString(36).slice(2, 8)}`;
  await db.exec(`insert into auth.oauth_authorizations (authorization_id, client_id, user_id, status, expires_at) values ('${id}', '${client}', ${uid ? `'${uid}'` : "null"}, '${status}', ${expire})`);
  return id;
}
/** Échange du code : GoTrue supprime la demande et ouvre une session OAuth (aal1) pour le client. Renvoie l'identifiant de session. */
async function echanger(authorizationId, uid, client = CLAUDE, { cree = "now()" } = {}) {
  await superu();
  if (authorizationId) await db.exec(`delete from auth.oauth_authorizations where authorization_id = '${authorizationId}'`);
  return (await un(`insert into auth.sessions (user_id, oauth_client_id, aal, created_at) values ('${uid}', '${client}', 'aal1', ${cree}) returning id::text id`)).id;
}
/** Parcours légitime complet : code saisi (aal2), autorisation, approbation, échange, premier appel du connecteur (liaison). */
async function parcoursLegitime(uid, client = CLAUDE) {
  const id = await demande(uid, client);
  await jeton(uid, "aal2");
  const g = (await un(`select public.autoriser_connecteur($1) g`, [id])).g;
  const s = await echanger(id, uid, client);
  await jeton(uid, "aal1", { client, session: s });
  const etat = (await un(`select public.lier_connecteur() e`)).e;
  return { g, s, etat };
}
const nb = async t => (await q(`select user_id from public.${t}`)).length;
async function nettoyer() {
  await superu();
  await db.exec(`delete from public.connecteurs_autorises; delete from auth.sessions; delete from auth.oauth_authorizations;
    insert into auth.mfa_factors (user_id, status, created_at) select '${A}', 'verified', now() - interval '1 day' where not exists (select 1 from auth.mfa_factors where user_id = '${A}' and status = 'verified');`);
}

before(async () => {
  db = await baseComplete();
  await db.exec(`
    insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
    -- A et B : facteur vérifié ; C : aucun facteur
    insert into auth.mfa_factors (user_id, status, created_at) values ('${A}', 'verified', now() - interval '1 day'), ('${B}', 'verified', now() - interval '1 day');
    -- clients déclarés par l'administrateur (manual) ; un client inscrit tout seul (dynamic) ne reçoit jamais d'autorisation
    insert into auth.oauth_clients (id, client_name, registration_type) values ('${CLAUDE}', 'Claude', 'manual'), ('${AUTRE}', 'Autre client', 'manual'),
      ('${DYNAMIQUE}', 'Claude', 'dynamic');
    insert into public.positions (user_id, name, value) values ('${A}', 'Livret A', 8000), ('${B}', 'Livret B', 10), ('${C}', 'Livret C', 20);
    insert into public.snapshots (user_id, date, total) values ('${A}', ${AUJ}, 12345), ('${B}', ${AUJ}, 1);
    insert into public.fonctionnalites (user_id, cle, active) values ('${A}', 'banque', true), ('${B}', 'banque', true);
    insert into public.banque_connexions (id, user_id, etablissement) values (1, '${A}', 'Banque A'), (1, '${B}', 'Banque B');
    insert into public.banque_comptes (id, user_id, connexion_id, nom, type, solde) values (10, '${A}', 1, 'Compte A', 'courant', 100), (10, '${B}', 1, 'Compte B', 'courant', 200);
    insert into public.banque_placements (id, user_id, compte_id, libelle, valeur) values (100, '${A}', 10, 'Fonds A', 1000);
    insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle, categorie) values (1000, '${A}', 10, ${AUJ}, -50, 'CARTE SUPERMARCHE', 'alimentation');
    insert into public.banque_mois (user_id, mois, categorie, entrees, sorties, nombre) values ('${A}', date_trunc('month', ${AUJ})::date, 'alimentation', 0, 50, 1);`);
});
after(async () => { await db.close(); });

/* ------------------------------------------------------------------------------------------------ structure */
test("0033 : fichier, en-tête (non appliquée, ordre), tutoiement, sans secret, aucune politique de 0028 retirée sans être remplacée", () => {
  assert.ok(FICHIER, "migration 0033 présente");
  assert.match(SQL, /^-- Boussole : /);
  assert.match(SQL, /apply_migration \(name = "connecteurs_autorises"\)/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(SQL, /sb_secret_|eyJhbGci/);
  assert.doesNotMatch(SQL, /\bdrop\s+policy\b/i, "les politiques sont modifiées (alter policy), jamais retirées");
  assert.match(SQL, /Repli interdit/, "l'en-tête rappelle pourquoi le passe-droit client_id sans autorisation reste interdit");
});

test("table connecteurs_autorises : RLS, lecture par son propriétaire seulement (colonnes listées), aucune écriture directe par authenticated, rien pour anon", async () => {
  await superu();
  const t = await un(`select relrowsecurity r from pg_class where oid = 'public.connecteurs_autorises'::regclass`);
  assert.equal(t.r, true);
  for (const p of ["insert", "update", "delete"]) {
    assert.equal((await un(`select has_table_privilege('authenticated', 'public.connecteurs_autorises', '${p}') v`)).v, false, "authenticated " + p);
    assert.equal((await un(`select has_any_column_privilege('authenticated', 'public.connecteurs_autorises', '${p === "delete" ? "update" : p}') v`)).v, false, "authenticated " + p + " (colonnes)");
  }
  assert.equal((await un(`select has_any_column_privilege('anon', 'public.connecteurs_autorises', 'select') v`)).v, false, "anon");
  for (const c of ["id", "user_id", "client_id", "client_nom", "accorde_le", "expire_le", "lie_le", "dernier_usage", "revoque_le"])
    assert.equal((await un(`select has_column_privilege('authenticated', 'public.connecteurs_autorises', '${c}', 'select') v`)).v, true, c);
  for (const c of ["session_id", "autorisation_id"])
    assert.equal((await un(`select has_column_privilege('authenticated', 'public.connecteurs_autorises', '${c}', 'select') v`)).v, false, c + " : non exposé");
  const cols = (await q(`select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'connecteurs_autorises'`)).map(r => r.column_name);
  for (const c of ["user_id", "client_id", "accorde_le", "expire_le", "revoque_le", "accorde_aal", "session_id", "dernier_usage"]) assert.ok(cols.includes(c), c);
  await refuse(`insert into public.connecteurs_autorises (user_id, client_id, client_nom, autorisation_id, autorisation_expire_le, accorde_aal, expire_le)
    values ('${A}', 'x', 'x', 'x', now(), 'aal1', now() + interval '1 day')`, /accorde_aal|check/i, "accorde_aal ≠ aal2 refusé même pour le superutilisateur");
  await jeton(A, "aal2");
  await refuse(`insert into public.connecteurs_autorises (user_id, client_id, autorisation_id, autorisation_expire_le, accorde_aal, expire_le)
    values ('${A}', '${CLAUDE}', 'x', now(), 'aal2', now() + interval '90 days')`, /permission denied/, "insertion directe en aal2");
  await superu();
});

test("fonctions : security definer, search_path vide ; autoriser / lier / revoquer / connecteur_autorise exécutables par authenticated, jamais par anon ni public", async () => {
  await superu();
  for (const [nom, vol] of [["autoriser_connecteur", "v"], ["lier_connecteur", "v"], ["revoquer_connecteur", "v"], ["connecteur_autorise", "s"]]) {
    const f = await un(`select p.prosecdef, p.provolatile, pg_get_functiondef(p.oid) def, has_function_privilege('authenticated', p.oid, 'execute') ea,
        has_function_privilege('anon', p.oid, 'execute') en, has_function_privilege('public', p.oid, 'execute') ep
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [nom]);
    assert.ok(f, nom + " présente");
    assert.equal(f.prosecdef, true, nom + " : security definer");
    assert.equal(f.provolatile, vol, nom + " : volatilité");
    assert.match(f.def, /set search_path to ''/i, nom);
    assert.equal(f.ea, true, nom); assert.equal(f.en, false, nom + " : anon"); assert.equal(f.ep, false, nom + " : public");
    assert.doesNotMatch(f.def, /banque_/, nom + " : ne lit aucune table bancaire");
  }
});

/* ------------------------------------------------------------------------------------------------ création : seulement en aal2 */
test("autoriser_connecteur : refusé à une session aal1 (mot de passe seul), sans revendication aal, à un jeton OAuth, à un compte sans facteur", async () => {
  await nettoyer();
  const id = await demande(A);
  for (const aal of ["aal1", "aucun"]) {
    await jeton(A, aal);
    await refuse(`select public.autoriser_connecteur('${id}')`, /double authentification/i, "session " + aal);
  }
  // un jeton OAuth (toujours aal1) ne peut pas s'autoriser lui-même ; même un jeton OAuth qui se dirait aal2 est refusé
  const s = await echanger(null, A);
  for (const aal of ["aal1", "aal2"]) {
    await jeton(A, aal, { client: CLAUDE, session: s });
    await refuse(`select public.autoriser_connecteur('${id}')`, /connecteur|double authentification/i, "jeton OAuth " + aal);
  }
  const idC = await demande(C);
  await jeton(C, "aal1");
  await refuse(`select public.autoriser_connecteur('${idC}')`, /double authentification/i, "compte sans facteur");
  await superu();
  assert.equal((await un(`select count(*)::int n from public.connecteurs_autorises`)).n, 0, "aucune autorisation créée");
});

test("autoriser_connecteur : la demande doit exister, appartenir à l'appelant, être en attente ou approuvée et non expirée ; client lu dans GoTrue", async () => {
  await nettoyer();
  const deB = await demande(B), expiree = await demande(A, CLAUDE, { expire: "now() - interval '1 minute'" }), sansUtilisateur = await demande(null);
  await jeton(A, "aal2");
  await refuse(`select public.autoriser_connecteur('${deB}')`, /introuvable/i, "demande d'un autre utilisateur");
  await refuse(`select public.autoriser_connecteur('${expiree}')`, /introuvable|expir/i, "demande expirée");
  await refuse(`select public.autoriser_connecteur('${sansUtilisateur}')`, /introuvable/i, "demande sans utilisateur");
  await refuse(`select public.autoriser_connecteur('inexistante')`, /introuvable/i, "demande inconnue");
  await refuse(`select public.autoriser_connecteur(null)`, /introuvable/i, "null");
  const refusee = await demande(A, CLAUDE, { status: "denied" });
  await jeton(A, "aal2");
  await refuse(`select public.autoriser_connecteur('${refusee}')`, /introuvable/i, "demande refusée");
  // succès : client et nom lus dans auth.oauth_clients, 90 jours, liaison à venir
  const ok = await demande(A, CLAUDE, { status: "approved" });
  await jeton(A, "aal2");
  const g = (await un(`select public.autoriser_connecteur($1) g`, [ok])).g;
  assert.equal(g.client_id, CLAUDE); assert.equal(g.client_nom, "Claude"); assert.equal(g.duree_jours, 90);
  const jours = (new Date(g.expire_le) - new Date(g.accorde_le)) / 864e5;
  assert.ok(Math.abs(jours - 90) < 0.01, "90 jours : " + jours);
  await superu();
  const r = await un(`select user_id, accorde_aal, session_id, revoque_le, autorisation_id from public.connecteurs_autorises`);
  assert.deepEqual([r.user_id, r.accorde_aal, r.session_id, r.revoque_le, r.autorisation_id], [A, "aal2", null, null, ok]);
});

/* ------------------------------------------------------------------------------------------------ lecture par le connecteur */
test("parcours légitime : code (aal2) → autorisation → échange → le jeton OAuth aal1 de CETTE session lit les données de A, banque comprise", async () => {
  await nettoyer();
  const { s, etat } = await parcoursLegitime(A);
  assert.equal(etat, "autorise");
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  assert.equal((await un(`select public.connecteur_autorise() v`)).v, true);
  assert.equal(await nb("positions"), 1); assert.equal(await nb("snapshots"), 1);
  for (const t of BANQUE) {
    const rows = await q(`select user_id from public.${t}`);
    assert.ok(rows.length >= 1 && rows.every(r => r.user_id === A), t + " : lisible par le connecteur autorisé, seulement les lignes de A");
  }
  assert.equal((await un(`select value::int v from public.positions`)).v, 8000);
  // écritures du connecteur sur les données non bancaires (propositions, mémoire…) : permises
  await db.exec(`insert into public.propositions (user_id, cible, operation, apres, source) values ('${A}', 'profil', 'modifier', '{"salaire": 1}', 'connecteur')`);
  assert.equal(await nb("propositions"), 1);
  await db.exec(`select public.noter_connexion('${CLAUDE}', 'Claude')`);
  // jamais d'écriture bancaire par le connecteur : le rattachement d'un compte exige une vraie session aal2
  await refuse(`update public.banque_comptes set ignore = true where id = 10`, /row-level security/, "update banque_comptes par le connecteur");
  await superu();
  assert.equal((await un(`select ignore from public.banque_comptes where user_id = '${A}'`)).ignore, false, "intact");
  assert.ok((await un(`select dernier_usage from public.connecteurs_autorises where user_id = '${A}'`)).dernier_usage, "dernier usage noté à la liaison");
  await db.exec(`delete from public.propositions where source = 'connecteur'`);
});

test("sans autorisation : un jeton OAuth aal1 d'un compte à facteur ne lit rien (approveAuthorization seul ne suffit pas)", async () => {
  await nettoyer();
  // l'attaquant n'a que le mot de passe : il approuve lui-même la demande (aal1) et échange le code
  const id = await demande(A);
  const s = await echanger(id, A);
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "absente");
  assert.equal((await un(`select public.connecteur_autorise() v`)).v, false);
  for (const t of ["positions", "snapshots", "fonctionnalites", "connexions_assistant", ...BANQUE]) assert.equal(await nb(t), 0, t);
  await refuse(`insert into public.propositions (user_id, cible, operation, apres, source) values ('${A}', 'profil', 'modifier', '{}', 'x')`, /row-level security/, "écriture");
});

test("autorisation créée mais code pas encore échangé : rien n'est lié (la demande existe encore), rien n'est lisible", async () => {
  await nettoyer();
  const id = await demande(A);
  await jeton(A, "aal2");
  await db.query(`select public.autoriser_connecteur($1)`, [id]);
  // une session OAuth de l'attaquant (autre demande, approuvée en aal1) se présente AVANT l'échange légitime
  const attaquant = await echanger(await demande(A), A);
  await jeton(A, "aal1", { client: CLAUDE, session: attaquant });
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "en_attente");
  assert.equal(await nb("positions"), 0);
  // l'échange légitime arrive : deux sessions OAuth depuis l'autorisation → ambigu, aucune n'est liée (l'utilisateur reconnecte)
  const legitime = await echanger(id, A);
  for (const s of [legitime, attaquant]) {
    await jeton(A, "aal1", { client: CLAUDE, session: s });
    assert.equal((await un(`select public.lier_connecteur() e`)).e, "ambigu", "session " + (s === legitime ? "légitime" : "de l'attaquant"));
    assert.equal(await nb("positions"), 0);
  }
  await superu();
  assert.equal((await un(`select session_id from public.connecteurs_autorises`)).session_id, null, "jamais liée");
});

test("autorisation liée : une autre session OAuth du même client (mot de passe volé, approbation en aal1) ne lit rien", async () => {
  await nettoyer();
  const { s } = await parcoursLegitime(A);
  const intrus = await echanger(await demande(A), A);
  await jeton(A, "aal1", { client: CLAUDE, session: intrus });
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "autre_session");
  assert.equal((await un(`select public.connecteur_autorise() v`)).v, false);
  for (const t of ["positions", ...BANQUE]) assert.equal(await nb(t), 0, t);
  // la session légitime continue
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  assert.equal(await nb("positions"), 1);
});

test("client_id : l'autorisation vaut pour un seul client ; un autre client (même session forgée) ne lit rien", async () => {
  await nettoyer();
  const { s } = await parcoursLegitime(A, CLAUDE);
  await jeton(A, "aal1", { client: AUTRE, session: s });
  assert.equal((await un(`select public.connecteur_autorise() v`)).v, false);
  assert.equal(await nb("positions"), 0);
  const autre = await echanger(await demande(A, AUTRE), A, AUTRE);
  await jeton(A, "aal1", { client: AUTRE, session: autre });
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "absente");
  assert.equal(await nb("positions"), 0);
});

test("autre utilisateur : l'autorisation de A ne sert pas à B (même client, même session) et ne montre jamais les lignes de B", async () => {
  await nettoyer();
  const { s } = await parcoursLegitime(A);
  await jeton(B, "aal1", { client: CLAUDE, session: s });
  assert.equal((await un(`select public.connecteur_autorise() v`)).v, false);
  assert.equal(await nb("positions"), 0);
  assert.notEqual((await un(`select public.lier_connecteur() e`)).e, "autorise");
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  assert.ok((await q(`select user_id from public.positions`)).every(r => r.user_id === A));
  assert.ok((await q(`select user_id from public.banque_comptes`)).every(r => r.user_id === A));
  // B a sa propre autorisation : chacun ne voit que ses lignes
  const b = await parcoursLegitime(B);
  assert.equal(b.etat, "autorise");
  await jeton(B, "aal1", { client: CLAUDE, session: b.s });
  assert.deepEqual((await q(`select name from public.positions`)).map(r => r.name), ["Livret B"]);
});

test("liaison : session OAuth antérieure à l'autorisation, ou première utilisation plus de 15 minutes après → refusée", async () => {
  await nettoyer();
  const ancienne = await echanger(null, A, CLAUDE, { cree: "now() - interval '1 hour'" });
  const id = await demande(A);
  await jeton(A, "aal2");
  await db.query(`select public.autoriser_connecteur($1)`, [id]);
  await superu(); await db.exec(`delete from auth.oauth_authorizations where authorization_id = '${id}'`);
  await jeton(A, "aal1", { client: CLAUDE, session: ancienne });
  assert.notEqual((await un(`select public.lier_connecteur() e`)).e, "autorise", "une session d'avant le code ne se lie pas");
  // délai de liaison dépassé
  await nettoyer();
  const id2 = await demande(A);
  await jeton(A, "aal2");
  await db.query(`select public.autoriser_connecteur($1)`, [id2]);
  const s = await echanger(id2, A);
  await superu();
  await db.exec(`update public.connecteurs_autorises set accorde_le = now() - interval '16 minutes', autorisation_expire_le = now() + interval '1 minute'`);
  await db.exec(`update auth.sessions set created_at = now() - interval '15 minutes' where id = '${s}'`);
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "hors_delai");
  assert.equal(await nb("positions"), 0);
});

/* ------------------------------------------------------------------------------------------------ expiration, révocation, session fermée */
test("expiration : passé 90 jours, plus rien n'est lisible ; lier_connecteur dit « expiree »", async () => {
  await nettoyer();
  const { s } = await parcoursLegitime(A);
  await superu();
  await db.exec(`update public.connecteurs_autorises set accorde_le = now() - interval '91 days', expire_le = now() - interval '1 second'`);
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "expiree");
  for (const t of ["positions", ...BANQUE]) assert.equal(await nb(t), 0, t);
});

test("révocation : revoquer_connecteur coupe l'accès tout de suite ; B ne peut pas révoquer l'autorisation de A ; une nouvelle autorisation remplace l'ancienne", async () => {
  await nettoyer();
  const { s } = await parcoursLegitime(A);
  await jeton(B, "aal2");
  assert.equal((await un(`select public.revoquer_connecteur('${CLAUDE}') n`)).n, 0, "B ne révoque rien chez A");
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  assert.equal(await nb("positions"), 1, "toujours autorisé");
  await jeton(A, "aal2");
  assert.equal((await un(`select public.revoquer_connecteur('${CLAUDE}') n`)).n, 1);
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "revoquee");
  for (const t of ["positions", ...BANQUE]) assert.equal(await nb(t), 0, t);
  // nouvelle autorisation pour le même client : l'ancienne session ne la récupère pas, la nouvelle oui ; une seule active
  const neuf = await parcoursLegitime(A);
  assert.equal(neuf.etat, "autorise");
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  assert.equal(await nb("positions"), 0, "ancienne session");
  await superu();
  assert.equal((await un(`select count(*)::int n from public.connecteurs_autorises where revoque_le is null`)).n, 1);
  // ré-autoriser sans révoquer d'abord : l'ancienne est révoquée par autoriser_connecteur
  const encore = await parcoursLegitime(A);
  assert.equal(encore.etat, "autorise");
  await superu();
  assert.equal((await un(`select count(*)::int n from public.connecteurs_autorises where revoque_le is null`)).n, 1);
  await jeton(A, "aal1", { client: CLAUDE, session: neuf.s });
  assert.equal(await nb("positions"), 0, "l'autorisation précédente ne vaut plus");
});

test("session OAuth fermée (déconnexion, révocation chez Supabase) ou facteur retiré : plus rien de lisible, même avec un jeton encore valide", async () => {
  await nettoyer();
  const { s } = await parcoursLegitime(A);
  await superu(); await db.exec(`delete from auth.sessions where id = '${s}'`);
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  assert.equal((await un(`select public.connecteur_autorise() v`)).v, false);
  assert.notEqual((await un(`select public.lier_connecteur() e`)).e, "autorise");
  assert.equal(await nb("positions"), 0);
  // facteur retiré par le support (appareil perdu) : l'autorisation ne vaut plus pour la banque
  await nettoyer();
  const b = await parcoursLegitime(A);
  await superu(); await db.exec(`delete from auth.mfa_factors where user_id = '${A}'`);
  await jeton(A, "aal1", { client: CLAUDE, session: b.s });
  assert.equal((await un(`select public.connecteur_autorise() v`)).v, false);
  for (const t of BANQUE) assert.equal(await nb(t), 0, t + " : fermée sans facteur, comme dans l'app");
  assert.equal(await nb("positions"), 1, "sans facteur, les données non bancaires suivent la règle de 0028 (lisibles en aal1)");
  await nettoyer();
});

/* ------------------------------------------------------------------------------------------------ liste dans Compte */
test("Compte › Connexion : A (aal2) liste ses autorisations ; pas celles de B ; ni en aal1, ni depuis le connecteur lui-même", async () => {
  await nettoyer();
  const a = await parcoursLegitime(A); await parcoursLegitime(B);
  await jeton(A, "aal2");
  const l = await q(`select id, client_id, client_nom, accorde_le, expire_le, lie_le, dernier_usage, revoque_le from public.connecteurs_autorises`);
  assert.equal(l.length, 1); assert.equal(l[0].client_nom, "Claude"); assert.ok(l[0].lie_le);
  await refuse(`select session_id from public.connecteurs_autorises`, /permission denied/, "session_id non exposé");
  await jeton(A, "aal1");
  assert.equal((await q(`select id from public.connecteurs_autorises`)).length, 0, "aal1 : rien");
  await jeton(A, "aal1", { client: CLAUDE, session: a.s });
  assert.equal((await q(`select id from public.connecteurs_autorises`)).length, 0, "le connecteur ne lit pas ses autorisations");
  await refuse(`update public.connecteurs_autorises set expire_le = now() + interval '10 years'`, /permission denied/, "prolonger soi-même");
  await refuse(`delete from public.connecteurs_autorises`, /permission denied/, "supprimer directement");
  await nettoyer();
});

test("sans facteur (C) : aucune autorisation possible, et les données restent lisibles en aal1 comme avant (0028 inchangée pour lui)", async () => {
  await nettoyer();
  const s = await echanger(await demande(C), C);
  await jeton(C, "aal1", { client: CLAUDE, session: s });
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "sans_facteur");
  assert.equal(await nb("positions"), 1);
  for (const t of BANQUE) assert.equal(await nb(t), 0, t);
});

test("jeton de session ordinaire (sans client_id) : lier_connecteur répond « sans_client » ; aal2 garde tout, aal1 rien (0028)", async () => {
  await nettoyer();
  await jeton(A, "aal1");
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "sans_client");
  assert.equal(await nb("positions"), 0);
  await jeton(A, "aal2");
  assert.equal(await nb("positions"), 1);
  for (const t of BANQUE) assert.ok(await nb(t) >= 1, t);
  await db.exec(`update public.banque_comptes set ignore = false where id = 10`);
});

/* ------------------------------------------------------------------------------------------------ politiques */
test("politiques : chaque « aal2 si facteur » accepte aussi le connecteur autorisé (sauf connecteurs_autorises) ; banque : lecture oui, écriture jamais", async () => {
  await superu();
  const r = await q(`select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and permissive = 'RESTRICTIVE' order by 1, 2`);
  const facteur = r.filter(p => /: aal2 si facteur$/.test(p.policyname));
  assert.ok(facteur.length >= 20, facteur.length + " politiques « aal2 si facteur »");
  for (const p of facteur) {
    for (const e of [p.qual, p.with_check]) {
      assert.match(e, /aal2/, p.policyname); assert.match(e, /mfa_exigee/, p.policyname);
      if (p.tablename === "connecteurs_autorises") assert.doesNotMatch(e, /connecteur_autorise\(\)/, p.policyname);
      else assert.match(e, /connecteur_autorise\(\)/, p.policyname);
    }
  }
  for (const t of BANQUE) {
    const tout = r.find(p => p.tablename === t && p.policyname === `${t}: aal2`);
    assert.ok(tout && tout.cmd === "ALL", t);
    assert.match(tout.qual, /connecteur_autorise\(\)/, t + " : lecture par le connecteur autorisé");
    assert.doesNotMatch(tout.qual, /mfa_exigee/, t + " : jamais « sans facteur »");
    assert.doesNotMatch(tout.with_check, /connecteur_autorise/, t + " : écriture en aal2 seulement");
    assert.match(tout.with_check, /client_id/, t + " : jamais par un jeton OAuth, même aal2");
    const sup = r.find(p => p.tablename === t && p.cmd === "DELETE");
    assert.ok(sup && /aal2/.test(sup.qual) && /client_id/.test(sup.qual) && !/connecteur_autorise/.test(sup.qual), t + " : suppression en aal2 seulement, hors jeton OAuth");
  }
});

test("auth_rls_initplan : aucune politique de public n'appelle auth.jwt() ni auth.uid() hors d'un (select …)", async () => {
  await superu();
  const r = await q(`select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') e from pg_policies where schemaname = 'public'`);
  for (const p of r) {
    const e = p.e.toLowerCase();
    for (const m of e.matchAll(/auth\.(jwt|uid)\(\)/g)) {
      const avant = e.slice(Math.max(0, m.index - 7), m.index);
      assert.equal(avant, "select ", `${p.tablename} / ${p.policyname} : auth.${m[1]}() réévalué à chaque ligne`);
    }
  }
});

/* ------------------------------------------------------------------------------------------------ droits de service_role (0033 § 5) */
test("service_role : droits explicites sur toutes les tables, séquences et fonctions de public, sans exposition automatique ; anon et authenticated inchangés", async () => {
  // base où Supabase ne donne RIEN à service_role par défaut (CLI sans auto_expose_new_tables, à partir du 2026-10-30)
  const sans = BOUCHONS_SUPABASE.replace(/to anon, authenticated, service_role;/g, "to anon, authenticated;");
  assert.notEqual(sans, BOUCHONS_SUPABASE);
  const avant = await baseComplete("0032_~", { bouchons: sans });
  const droits = async (b, role) => (await b.query(`
    select 'table:' || c.relname || ':' || p obj, has_table_privilege('${role}', c.oid, p) ok from pg_class c join pg_namespace n on n.oid = c.relnamespace,
      unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
    union all select 'colonne:' || c.relname || '.' || a.attname || ':' || p, has_column_privilege('${role}', c.oid, a.attnum, p) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped,
      unnest(array['select', 'insert', 'update']) p where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
    union all select 'sequence:' || c.relname || ':' || p, has_sequence_privilege('${role}', c.oid, p) from pg_class c join pg_namespace n on n.oid = c.relnamespace,
      unnest(array['usage', 'select', 'update']) p where n.nspname = 'public' and c.relkind = 'S'
    union all select 'fonction:' || p.oid::regprocedure::text, has_function_privilege('${role}', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'`)).rows.reduce((o, r) => (o[r.obj] = r.ok, o), {});
  const avantAnon = await droits(avant, "anon"), avantAuth = await droits(avant, "authenticated"), avantService = await droits(avant, "service_role");
  assert.ok(Object.values(avantService).some(v => v === false), "sans 0033, service_role n'a pas tout (le cas que 0033 corrige)");
  const acl = async () => (await avant.query(`select defaclobjtype t, defaclacl::text acl from pg_default_acl order by 1, 2`)).rows
    .map(r => r.t + ":" + r.acl.replace(/[{}]/g, "").split(",").filter(x => /^(anon|authenticated)=/.test(x)).sort().join(","));
  const aclAvant = await acl();
  await avant.exec(SQL.replace(/^create extension[^;]*;/gim, ""));
  assert.deepEqual(await acl(), aclAvant, "privilèges par défaut de anon et authenticated inchangés");
  const apresAnon = await droits(avant, "anon"), apresAuth = await droits(avant, "authenticated"), apresService = await droits(avant, "service_role");
  const manque = Object.entries(apresService).filter(([k, v]) => !v && !k.startsWith("colonne:")).map(([k]) => k);
  assert.deepEqual(manque, [], "service_role : tout est accordé explicitement");
  for (const [nom, av, ap] of [["anon", avantAnon, apresAnon], ["authenticated", avantAuth, apresAuth]]) {
    const elargi = Object.entries(ap).filter(([k, v]) => v && av[k] === false).map(([k]) => k);
    assert.deepEqual(elargi, [], nom + " : aucun droit ajouté sur un objet existant");
    const nouveaux = Object.entries(ap).filter(([k, v]) => v && !(k in av)).map(([k]) => k).filter(k => !/connecteurs_autorises\.(id|user_id|client_id|client_nom|accorde_le|expire_le|lie_le|dernier_usage|revoque_le):select$|connecteurs_autorises:select$/.test(k)
      && !(nom === "authenticated" && /^fonction:(autoriser_connecteur|lier_connecteur|revoquer_connecteur|connecteur_autorise)\(/.test(k)));
    assert.deepEqual(nouveaux, [], nom + " : objets neufs, droits limités à ce que 0033 décrit");
  }
  // une table créée après 0033 (migration future, sans exposition automatique) est accessible au service
  await avant.exec(`create table public.table_future (id int); create function public.fonction_future() returns int language sql as $$ select 1 $$;`);
  const f = (await avant.query(`select has_table_privilege('service_role', 'public.table_future', 'insert') s,
    has_function_privilege('service_role', 'public.fonction_future()', 'execute') fs`)).rows[0];
  assert.equal(f.s, true, "privilèges par défaut pour service_role"); assert.equal(f.fs, true);
  await avant.close();
});

/* ------------------------------------------------------------------------------------------------ revue de sécurité (2026-10-15) */
test("client inscrit dynamiquement (hameçonnage du consentement) ou client supprimé : aucune autorisation, même en aal2 avec un code frais", async () => {
  await nettoyer();
  const dyn = await demande(A, DYNAMIQUE);
  await jeton(A, "aal2");
  await refuse(`select public.autoriser_connecteur('${dyn}')`, /n'est pas autorisé|déclaré/i, "client dynamique");
  await superu();
  assert.equal((await un(`select count(*)::int n from public.connecteurs_autorises`)).n, 0);
  await db.exec(`update auth.oauth_clients set deleted_at = now() where id = '${AUTRE}'`);
  const sup = await demande(A, AUTRE);
  await jeton(A, "aal2");
  await refuse(`select public.autoriser_connecteur('${sup}')`, /n'est pas autorisé|déclaré/i, "client supprimé");
  await superu(); await db.exec(`update auth.oauth_clients set deleted_at = null where id = '${AUTRE}'`);
  // code d'erreur distinct (la page de consentement l'explique)
  const dyn2 = await demande(A, DYNAMIQUE);
  await jeton(A, "aal2");
  await assert.rejects(db.query(`select public.autoriser_connecteur('${dyn2}')`), e => e.code === "BOU01");
  await superu();
});

test("code frais exigé : une session aal2 dont le code date de plus de 10 minutes ne crée rien ; 9 minutes passent", async () => {
  await nettoyer();
  const id = await demande(A);
  const il = s => String(Math.floor(Date.now() / 1000) - s);
  await jeton(A, "aal2", { totpLe: il(11 * 60) });
  await assert.rejects(db.query(`select public.autoriser_connecteur('${id}')`), e => { assert.equal(e.code, "BOU02"); assert.match(e.message, /code/i); return true; });
  await jeton(A, "aal2", { totpLe: il(9 * 60) });
  const g = (await un(`select public.autoriser_connecteur($1) g`, [id])).g;
  assert.equal(g.client_id, CLAUDE);
  await superu();
});

test("facteur retiré puis réinscrit : l'autorisation ne revit pas (facteur plus récent que l'autorisation) ; lier_connecteur la révoque", async () => {
  await nettoyer();
  const { s } = await parcoursLegitime(A);
  await superu();
  await db.exec(`delete from auth.mfa_factors where user_id = '${A}'; insert into auth.mfa_factors (user_id, status, created_at) values ('${A}', 'verified', now() + interval '1 second')`);
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  assert.equal((await un(`select public.connecteur_autorise() v`)).v, false);
  for (const t of ["positions", ...BANQUE]) assert.equal(await nb(t), 0, t);
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "revoquee");
  await superu();
  assert.ok((await un(`select revoque_le from public.connecteurs_autorises`)).revoque_le, "révoquée en base");
  // tous les facteurs retirés : lier_connecteur révoque aussi
  await nettoyer();
  const b = await parcoursLegitime(A);
  await superu(); await db.exec(`delete from auth.mfa_factors where user_id = '${A}'`);
  await jeton(A, "aal1", { client: CLAUDE, session: b.s });
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "sans_facteur");
  await superu();
  assert.equal((await un(`select count(*)::int n from public.connecteurs_autorises where revoque_le is null`)).n, 0, "plus aucune autorisation active");
  await nettoyer();
});

test("banque : un jeton OAuth n'écrit jamais, même s'il se disait aal2 un jour (with check aal2 ET sans client_id)", async () => {
  await nettoyer();
  const { s } = await parcoursLegitime(A);
  await jeton(A, "aal2", { client: CLAUDE, session: s });
  await refuse(`update public.banque_comptes set ignore = true where id = 10`, /row-level security/, "jeton OAuth aal2 hypothétique");
  await jeton(A, "aal2");
  assert.equal((await db.query(`update public.banque_comptes set ignore = false where id = 10 returning id`)).rows.length, 1, "l'app (aal2) écrit toujours");
});

test("delete_me : refusé à tout jeton OAuth (même autorisé) et en aal1 pour un compte à facteur ; aal2 ou compte sans facteur : possible", async () => {
  await nettoyer();
  const E = "55555555-5555-5555-5555-555555555555";
  await superu();
  await db.exec(`insert into auth.users (id) values ('${E}'); insert into auth.mfa_factors (user_id, status) values ('${E}', 'verified')`);
  const { s } = await parcoursLegitime(A);
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  await assert.rejects(db.query(`select public.delete_me()`), e => e.code === "42501", "connecteur autorisé");
  await jeton(A, "aal2", { client: CLAUDE, session: s });
  await assert.rejects(db.query(`select public.delete_me()`), e => e.code === "42501", "jeton OAuth aal2 hypothétique");
  await jeton(E, "aal1");
  await assert.rejects(db.query(`select public.delete_me()`), e => { assert.equal(e.code, "42501"); assert.match(e.message, /double authentification/i); return true; }, "mot de passe seul, compte à facteur");
  await superu();
  assert.equal((await q(`select 1 from auth.users where id in ('${A}', '${E}')`)).length, 2, "rien de supprimé");
  await jeton(E, "aal2");
  await db.query(`select public.delete_me()`);
  await superu();
  assert.equal((await q(`select 1 from auth.users where id = '${E}'`)).length, 0, "aal2 : supprimé");
});

test("export_all : refusé à tout jeton OAuth ; en session, il exporte aussi connecteurs_autorises (colonnes visibles seulement)", async () => {
  await nettoyer();
  const { s } = await parcoursLegitime(A);
  await jeton(A, "aal1", { client: CLAUDE, session: s });
  await assert.rejects(db.query(`select public.export_all()`), e => e.code === "42501", "connecteur autorisé");
  await jeton(A, "aal2");
  const x = (await un(`select public.export_all() j`)).j;
  assert.equal(x.connecteurs_autorises.length, 1);
  assert.deepEqual(Object.keys(x.connecteurs_autorises[0]).sort(), ["accorde_le", "client_id", "client_nom", "dernier_usage", "expire_le", "id", "lie_le", "revoque_le"]);
  for (const k of ["positions", "banque_comptes", "plans_figes", "connexions_assistant"]) assert.ok(k in x, k + " toujours exporté");
  await jeton(C, "aal1");
  assert.ok((await un(`select public.export_all() j`)).j.positions.length >= 1, "compte sans facteur : comme avant");
  await superu();
});
