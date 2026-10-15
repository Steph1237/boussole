// BUD1, tâche 4 : migration 0035_budget.sql exercée sur PGlite (toutes les migrations du dépôt appliquées sur les bouchons Supabase,
// test/helpers/pglite.mjs). Spec : docs/superpowers/specs/2026-10-16-bud1-budget-design.md § 4, § 8.4, § 9.4, § 13.1 et § 15.6.
// Couvre : prérequis 0034, taxonomie en base (34 clés de la fixture), titulaire commun, colonnes de banque_operations, banque_mois (clé,
// reprise), banque_recalculer_mois (sous-catégorie, apports gardés, carte différée D4, marchands), banque_marchands_mois (RLS, aal2, purge à
// 13 mois), budget_reclasser_historique (garde-fou de somme), budget_regles (contraintes, 300 règles, a_classer refusée, droits de colonne,
// RLS, politique « aal2 si facteur »), appliquer_propositions (partage, budget_cible, budget_preferences ; gardes de 0034 intactes), export_all.
// Valeurs fictives uniquement.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { baseComplete } from "./helpers/pglite.mjs";

const require = createRequire(import.meta.url);
const FIX = require("./fixtures/budget-cas.json");
const lire = f => readFileSync(new URL("../supabase/migrations/" + f, import.meta.url), "utf8");
const SQL = lire("0035_budget.sql");
const M34 = lire("0034_historique.sql");

const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", C = "33333333-3333-3333-3333-333333333333";
const AUJ = `(now() at time zone 'Europe/Paris')::date`;
const MOIS = n => `(date_trunc('month', ${AUJ}) - interval '${n} months')::date`;   // premier jour du mois d'il y a n mois (Paris)
const JOUR = (n, j) => `(${MOIS(n)} + ${j - 1})`;                                    // jour j du mois d'il y a n mois
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const num = v => (v == null ? null : Number(v));
const refuse = async (s, motif, m, p) => {
  await assert.rejects(db.query(s, p), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
};
const superu = () => db.exec(`reset role; set test.uid = ''; set test.aal = 'aal2'; set test.client_id = '';`);
const service = () => db.exec(`reset role; set test.uid = ''; set test.aal = 'aal2'; set test.client_id = ''; set role service_role;`);
async function session(uid, aal = "aal2", client = "", sessionId = "") {
  await db.exec(`reset role; set test.uid = '${uid}'; set test.aal = '${aal}'; set test.client_id = '${client}'; set test.session_id = '${sessionId}'; set role authenticated;`);
}
const CLAUDE = "aaaaaaaa-0000-4000-8000-000000000001", JETON_NON_AUTORISE = "99999999-9999-4999-8999-999999999999";
/** Parcours légitime d'un connecteur (0033) : code saisi en aal2, autorisation, échange du code, premier appel (liaison). Renvoie l'identifiant de session OAuth. */
async function autoriserConnecteur(uid) {
  await superu();
  const id = `auth-${Math.random().toString(36).slice(2, 10)}`;
  await db.exec(`insert into auth.oauth_authorizations (authorization_id, client_id, user_id, status, expires_at) values ('${id}', '${CLAUDE}', '${uid}', 'pending', now() + interval '10 minutes')`);
  await session(uid, "aal2");
  await q(`select public.autoriser_connecteur($1)`, [id]);
  await superu();
  await db.exec(`delete from auth.oauth_authorizations where authorization_id = '${id}'`);
  const sid = (await un(`insert into auth.sessions (user_id, oauth_client_id, aal, created_at) values ('${uid}', '${CLAUDE}', 'aal1', now()) returning id::text id`)).id;
  await session(uid, "aal1", CLAUDE, sid);
  assert.equal((await un(`select public.lier_connecteur() e`)).e, "autorise", "liaison du connecteur");
  return sid;
}
const moisIso = async n => (await un(`select to_char(${MOIS(n)}, 'YYYY-MM-DD') m`)).m;
/** Lignes de banque_mois d'un utilisateur : [mois, compte, catégorie, sous-catégorie, entrées, sorties, nombre]. */
const lignes = async (u, filtre = "true") => (await q(`select to_char(mois, 'YYYY-MM-DD') m, compte_id, categorie, sous_categorie, entrees, sorties, nombre
    from public.banque_mois where user_id = $1 and ${filtre} order by mois, compte_id, categorie, sous_categorie`, [u]))
  .map(r => [r.m, Number(r.compte_id), r.categorie, r.sous_categorie, num(r.entrees), num(r.sorties), r.nombre]);
const recalculer = async (u, depuis) => { await service(); await q(`select public.banque_recalculer_mois($1, ${depuis})`, [u]); await superu(); };

before(async () => {
  db = await baseComplete();
  await db.exec(`
    insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
    insert into auth.mfa_factors (user_id, status, created_at) values ('${A}', 'verified', now() - interval '1 day'), ('${B}', 'verified', now() - interval '1 day');
    insert into auth.oauth_clients (id, client_name, registration_type) values ('${CLAUDE}', 'Claude', 'manual');
    insert into public.banque_connexions (id, user_id, etablissement) values (1, '${A}', 'Banque Exemple'), (1, '${B}', 'Banque B'), (1, '${C}', 'Banque C');
    insert into public.banque_comptes (id, user_id, connexion_id, nom, type, debit_differe) values
      (10, '${A}', 1, 'Courant Exemple', 'courant', false), (11, '${A}', 1, 'Livret Exemple', 'livret', false),
      (12, '${A}', 1, 'Carte Exemple', 'courant', true), (13, '${A}', 1, 'Commun Exemple', 'courant', false),
      (10, '${B}', 1, 'Courant B', 'courant', false), (10, '${C}', 1, 'Courant C', 'courant', false);`);
});
after(async () => { await db.close(); });

// ---------------------------------------------------------------------------------------------------------------------------------
test("migration 0035 : en-tête (non appliquée, dépendance à 0034, numérotation), tutoiement, aucune espace typographique, formes de politiques de 0033", () => {
  assert.match(SQL, /^-- Boussole : budget piloté par le réel, partie base \(BUD1/);
  assert.match(SQL, /Non appliquée : à appliquer avec apply_migration \(name = "budget"\) sur le projet oapcewpqsbbjdlcdeizi, APRÈS 0034 \(historique/);
  assert.match(SQL, /Numérotation BUD1 : 0035 base \(ce fichier\), 0036 repères, 0037 expertise/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu, "tutoiement des messages");
  assert.doesNotMatch(SQL, /conseiller/i);
  assert.doesNotMatch(SQL, /[  -‏]/, "aucune espace insécable ni espace typographique (U+00A0, U+2000 à U+200F)");
  assert.doesNotMatch(SQL, /budget_historique/, "pas de table d'historique propre à BUD1 : celui de HIS2 fait référence");
  assert.doesNotMatch(SQL, /create table public\.budget_historique/);
  // formes exactes de 0033/0034
  assert.match(SQL, /create policy "banque_marchands_mois: aal2" on public\.banque_marchands_mois as restrictive for all to authenticated\s+using \(\(\(select auth\.jwt\(\)\)->>'aal'\) = 'aal2' or \(select public\.connecteur_autorise\(\)\)\)\s+with check \(\(\(select auth\.jwt\(\)\)->>'aal'\) = 'aal2' and \(\(select auth\.jwt\(\)\)->>'client_id'\) is null\);/);
  assert.match(SQL, /create policy "banque_marchands_mois: suppression aal2" on public\.banque_marchands_mois as restrictive for delete to authenticated\s+using \(\(\(select auth\.jwt\(\)\)->>'aal'\) = 'aal2' and \(\(select auth\.jwt\(\)\)->>'client_id'\) is null\);/);
  assert.match(SQL, /create policy "budget_regles: aal2 si facteur" on public\.budget_regles as restrictive for all to authenticated\s+using \(\(\(select auth\.jwt\(\)\)->>'aal'\) = 'aal2' or not \(select public\.mfa_exigee\(\)\) or \(select public\.connecteur_autorise\(\)\)\)\s+with check \(\(\(select auth\.jwt\(\)\)->>'aal'\) = 'aal2' or not \(select public\.mfa_exigee\(\)\) or \(select public\.connecteur_autorise\(\)\)\);/);
  assert.doesNotMatch(SQL, /\bdrop\s+policy\b/i, "aucune politique existante n'est retirée");
  assert.doesNotMatch(SQL.replace(/^--.*$/gm, ""), /propositions_garde|transactions_historique_garde|refuser_propositions/, "les gardes de 0034 ne sont pas touchées par 0035 (code, hors commentaires)");
});

test("prérequis : 0035 appliquée sans 0034 est refusée (fonctions de HIS2 absentes), 0034 appliquée avant elle passe", async () => {
  const sans = await baseComplete("0033_connecteurs_autorises.sql");
  try {
    await assert.rejects(sans.exec(SQL), /exige 0034 \(historique\)/, "0035 sans 0034");
    assert.equal((await sans.query(`select to_regclass('public.budget_regles') r`)).rows[0].r, null, "rien n'a été créé");
  } finally { await sans.close(); }
  const avec = await baseComplete("0034_historique.sql");
  try {
    await avec.exec(SQL);
    assert.equal((await avec.query(`select public.sous_categorie_budget_valide('logement', 'loyer') v`)).rows[0].v, true);
  } finally { await avec.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------------------
test("taxonomie en base : 34 clés de la fixture, catégorie large de chacune, paires valides, '' accepté, hors taxonomie refusée", async () => {
  const tx = FIX.taxonomie;
  assert.equal(tx.length, 34);
  assert.equal((await un(`select public.budget_version_taxonomie() v`)).v, FIX.versions.taxonomie, "VERSION_TAXONOMIE");
  for (const t of tx) {
    assert.equal((await un(`select public.budget_categorie_de($1) c`, [t.cle])).c, t.categorie, t.cle);
    assert.equal((await un(`select public.budget_sous_categorie_valide($1) v`, [t.cle])).v, true, t.cle);
    assert.equal((await un(`select public.sous_categorie_budget_valide($1, $2) v`, [t.categorie, t.cle])).v, true, t.cle + " + sa catégorie large");
    for (const autre of new Set(tx.map(x => x.categorie).filter(c => c !== t.categorie)))
      assert.equal((await un(`select public.sous_categorie_budget_valide($1, $2) v`, [autre, t.cle])).v, false, t.cle + " refusée sous " + autre);
  }
  for (const c of FIX.reprise_banque_mois.map(r => r.categorie)) assert.equal((await un(`select public.sous_categorie_budget_valide($1, '') v`, [c])).v, true, c + " + vide (ligne d'avant BUD1)");
  assert.equal((await un(`select public.sous_categorie_budget_valide('inconnue', '') v`)).v, false, "catégorie large inconnue");
  assert.equal((await un(`select public.sous_categorie_budget_valide('logement', 'inconnue') v`)).v, false, "clé hors taxonomie");
  assert.equal((await un(`select public.sous_categorie_budget_valide('logement', null) v`)).v, false, "null refusé");
  assert.equal((await un(`select public.budget_categorie_de('inconnue') c`)).c, null);
  assert.equal((await un(`select public.categorie_budget_valide('divers') v`)).v, true, "categorie_budget_valide (0034) n'est pas touchée");
  // reprise : table de la fixture
  for (const r of FIX.reprise_banque_mois) assert.equal((await un(`select public.budget_sous_categorie_defaut($1) s`, [r.categorie])).s, r.sous_categorie, r.categorie);
  assert.equal((await un(`select public.budget_sous_categorie_defaut('inconnue') s`)).s, "a_classer");
  // sous-catégories qui entrent dans un budget : ni revenus, ni hors budget
  const budgetees = (await q(`select k from unnest($1::text[]) k where public.budget_sous_categorie_budgetee(k)`, [tx.map(t => t.cle)])).map(r => r.k);
  assert.deepEqual(budgetees, tx.filter(t => !["revenus", "hors_budget"].includes(t.bloc)).map(t => t.cle));
  // les fonctions de validation ne sont pas exécutables par anon
  await db.exec(`reset role; set role anon;`);
  await refuse(`select public.budget_categorie_de('loyer')`, /permission denied/, "anon");
  await superu();
});

test("HIS2 + BUD1 : historique_banque_mois accepte une clé de la taxonomie sous sa catégorie large, refuse la mauvaise paire ; 0034 intacte pour la catégorie large seule", async () => {
  await db.exec(`insert into public.historique_comptes (id, user_id, libelle, etablissement, type, titulaire, cle) values
      ('a0000000-0000-4000-8000-0000000000a1', '${A}', 'Courant importé', 'lcl', 'courant', 'p1', 'cle-a');
    insert into public.historique_imports (id, user_id, type, empreinte, etablissement, compte_id, periode_du, periode_au, source) values
      ('a0000000-0000-4000-8000-0000000000a1', '${A}', 'releves', repeat('b', 64), 'lcl', 'a0000000-0000-4000-8000-0000000000a1', '2024-01-01', '2024-01-31', 'test');
    insert into public.historique_releves (user_id, compte_id, mois, complet, total_entrees, total_sorties, import_id) values
      ('${A}', 'a0000000-0000-4000-8000-0000000000a1', '2024-01-01', true, 0, 50, 'a0000000-0000-4000-8000-0000000000a1');`);
  const ins = (cat, sous) => db.query(`insert into public.historique_banque_mois (user_id, compte_id, mois, categorie, sous_categorie, sorties, nombre)
    values ('${A}', 'a0000000-0000-4000-8000-0000000000a1', '2024-01-01', $1, $2, 10, 1)`, [cat, sous]);
  await ins("logement", "loyer");
  await ins("logement", "");
  await refuse(`insert into public.historique_banque_mois (user_id, compte_id, mois, categorie, sous_categorie, sorties, nombre) values ('${A}', 'a0000000-0000-4000-8000-0000000000a1', '2024-01-01', 'divers', 'loyer', 10, 1)`, /sous_categorie/, "loyer sous divers");
  await refuse(`insert into public.historique_banque_mois (user_id, compte_id, mois, categorie, sous_categorie, sorties, nombre) values ('${A}', 'a0000000-0000-4000-8000-0000000000a1', '2024-01-01', 'logement', 'courses', 10, 1)`, /sous_categorie/, "courses sous logement");
  await db.exec(`delete from public.historique_imports where user_id = '${A}'; delete from public.historique_comptes where user_id = '${A}'`);
});

// ---------------------------------------------------------------------------------------------------------------------------------
test("banque_comptes.titulaire accepte commun (et refuse le reste) ; l'utilisateur le règle avec le droit de colonne existant", async () => {
  await session(A);
  assert.equal((await db.query(`update public.banque_comptes set titulaire = 'commun' where id = 13 returning titulaire`)).rows[0].titulaire, "commun");
  await refuse(`update public.banque_comptes set titulaire = 'p3' where id = 13`, /banque_comptes_titulaire/, "titulaire inconnu");
  assert.equal((await db.query(`update public.banque_comptes set titulaire = null where id = 13 returning titulaire`)).rows[0].titulaire, null);
  await superu();
  await db.exec(`update public.banque_comptes set titulaire = 'commun' where user_id = '${A}' and id = 13`);
});

test("banque_operations : sous_categorie, origine_categorie, regle_id, cle_marchand — contraintes, lecture seule pour l'utilisateur", async () => {
  await superu();
  const col = async c => (await un(`select data_type t, is_nullable n from information_schema.columns where table_schema = 'public' and table_name = 'banque_operations' and column_name = $1`, [c]));
  assert.deepEqual(await col("sous_categorie"), { t: "text", n: "YES" });
  assert.deepEqual(await col("origine_categorie"), { t: "text", n: "YES" });
  assert.deepEqual(await col("regle_id"), { t: "uuid", n: "YES" });
  assert.deepEqual(await col("cle_marchand"), { t: "text", n: "YES" });
  assert.equal((await q(`select 1 from pg_constraint where conrelid = 'public.banque_operations'::regclass and contype = 'f' and pg_get_constraintdef(oid) like '%regle_id%'`)).length, 0, "regle_id sans clé étrangère");
  const op = (id, extra) => db.query(`insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle, categorie, ${Object.keys(extra).join(", ")})
    values ($1, '${A}', 10, ${AUJ}, -5, 'CB EXEMPLE', 'divers', ${Object.keys(extra).map((_, i) => "$" + (i + 2)).join(", ")})`, [id, ...Object.values(extra)]);
  await op(9001, { sous_categorie: "courses", origine_categorie: "marchand", cle_marchand: "carrefour market" });
  await assert.rejects(op(9002, { sous_categorie: "inconnue" }), /banque_operations_sous_categorie/, "sous-catégorie hors taxonomie");
  await assert.rejects(op(9003, { origine_categorie: "devinette" }), /banque_operations_origine_categorie/, "origine inconnue");
  await assert.rejects(op(9004, { cle_marchand: "x".repeat(41) }), /banque_operations_cle_marchand/, "clé de plus de 40 caractères");
  await assert.rejects(op(9005, { cle_marchand: "mot de passe" }), /banque_operations_cle_marchand/, "clé sensible");
  for (const [i, o] of ["structure", "regle", "marchand", "powens", "motif", "revenu", "defaut"].entries()) await op(9100 + i, { origine_categorie: o });
  await op(9006, { regle_id: "11111111-aaaa-4aaa-8aaa-111111111111" });
  await session(A);
  await refuse(`update public.banque_operations set sous_categorie = 'loyer' where id = 9001`, /permission denied/, "l'utilisateur n'écrit pas la sous-catégorie");
  await refuse(`insert into public.banque_operations (id, user_id, compte_id, date, montant, sous_categorie) values (9007, '${A}', 10, ${AUJ}, -1, 'loyer')`, /permission denied/, "ni n'insère");
  assert.equal((await q(`select sous_categorie from public.banque_operations where id = 9001`))[0].sous_categorie, "courses", "mais la lit");
  await superu();
  await db.exec(`delete from public.banque_operations where user_id = '${A}'`);
});

// ---------------------------------------------------------------------------------------------------------------------------------
test("banque_mois : clé primaire à cinq colonnes, sous-catégorie '' par défaut contrôlée ; reprise idempotente des lignes existantes (table de la fixture)", async () => {
  const pk = (await un(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.banque_mois'::regclass and contype = 'p'`)).d;
  assert.equal(pk, "PRIMARY KEY (user_id, mois, compte_id, categorie, sous_categorie)");
  const c = await un(`select data_type t, is_nullable n, column_default d from information_schema.columns where table_schema = 'public' and table_name = 'banque_mois' and column_name = 'sous_categorie'`);
  assert.deepEqual([c.t, c.n, c.d], ["text", "NO", "''::text"]);
  await superu();
  await refuse(`insert into public.banque_mois (user_id, mois, categorie, sous_categorie) values ('${C}', ${MOIS(0)}, 'divers', 'inconnue')`, /banque_mois_sous_categorie/, "clé hors taxonomie");
  await db.exec(`insert into public.banque_mois (user_id, mois, categorie, sous_categorie, sorties) values ('${C}', ${MOIS(0)}, 'divers', '', 1), ('${C}', ${MOIS(0)}, 'divers', 'shopping', 2)`);
  await db.exec(`delete from public.banque_mois where user_id = '${C}'`);

  // reprise : une base à 0034 avec des lignes d'avant BUD1, puis 0035 (deux fois : idempotent), comme la mise en production
  const d = await baseComplete("0034_historique.sql");
  try {
    await d.exec(`insert into auth.users (id) values ('${A}');
      insert into public.banque_connexions (id, user_id) values (1, '${A}');`);
    const cats = FIX.reprise_banque_mois.map(r => r.categorie);
    for (const [i, cat] of cats.entries())
      await d.exec(`insert into public.banque_mois (user_id, mois, compte_id, categorie, entrees, sorties, nombre) values ('${A}', date '2026-0${1 + (i % 9)}-01', ${i % 2 ? 10 : 0}, '${cat}', ${i}, ${100 + i}, 1)`);
    const avant = (await d.query(`select count(*)::int n, sum(sorties)::int s from public.banque_mois`)).rows[0];
    await d.exec(SQL);
    const lire = async () => (await d.query(`select categorie, sous_categorie from public.banque_mois order by categorie`)).rows;
    const apres = await lire();
    assert.deepEqual(apres.map(r => [r.categorie, r.sous_categorie]).sort(), FIX.reprise_banque_mois.map(r => [r.categorie, r.sous_categorie]).sort(), "sous-catégorie par défaut de chaque catégorie large");
    assert.deepEqual((await d.query(`select count(*)::int n, sum(sorties)::int s from public.banque_mois`)).rows[0], avant, "aucune ligne perdue ni dupliquée, mêmes montants");
    await d.exec(`update public.banque_mois set sous_categorie = '' where categorie = 'loyer_inconnu'`);   // rien à reprendre : aucun effet
    await d.exec(`update public.banque_mois set sous_categorie = public.budget_sous_categorie_defaut(categorie) where sous_categorie = ''`);
    assert.deepEqual(await lire(), apres, "la mise à jour de reprise rejouée ne change rien");
  } finally { await d.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------------------
test("banque_recalculer_mois : regroupement par sous-catégorie, reprise par défaut, paire invalide ramenée à la reprise, virement interne exclu, apport/transfert/relevé gardés", async () => {
  await superu();
  const m1 = await moisIso(1);
  await db.exec(`insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle, categorie, sous_categorie, origine_categorie, cle_marchand) values
    (1, '${A}', 10, ${JOUR(1, 2)}, 3000, 'VIR SALAIRE EXEMPLE', 'revenus', 'salaires', 'revenu', 'vir salaire exemple'),
    (2, '${A}', 10, ${JOUR(1, 3)}, -60, 'CB CARREFOUR MARKET', 'alimentation', 'courses', 'marchand', 'carrefour market'),
    (3, '${A}', 10, ${JOUR(1, 4)}, -40, 'CB CARREFOUR MARKET', 'alimentation', 'courses', 'marchand', 'carrefour market'),
    (4, '${A}', 10, ${JOUR(1, 5)}, -25, 'CB BASIC FIT', 'loisirs', 'sport', 'marchand', 'basic fit'),
    (5, '${A}', 10, ${JOUR(1, 6)}, -30, 'CB RESTO EXEMPLE', 'loisirs', 'restaurants', 'powens', 'resto exemple'),
    (6, '${A}', 10, ${JOUR(1, 7)}, -20, 'CB INCONNU', 'divers', null, null, 'inconnu'),
    (7, '${A}', 10, ${JOUR(1, 8)}, -15, 'CB PAIRE FAUSSE', 'loisirs', 'loyer', 'regle', 'paire fausse'),
    (8, '${A}', 10, ${JOUR(1, 9)}, -300, 'VIR LIVRET', 'epargne', 'epargne_precaution', 'structure', 'vir livret'),
    (9, '${A}', 11, ${JOUR(1, 9)}, 300, 'VIR DU COURANT', 'virement_interne', 'virement_interne', 'structure', 'vir du courant'),
    (10, '${A}', 10, ${JOUR(1, 10)}, -1200, 'VIR COMMUN EXEMPLE', 'virement_interne', 'apport_commun', 'structure', 'vir commun exemple'),
    (11, '${A}', 13, ${JOUR(1, 10)}, 1200, 'VIR CAMILLE', 'virement_interne', 'apport_commun', 'structure', 'vir camille'),
    (12, '${A}', 10, ${JOUR(1, 11)}, -200, 'VIR SAM', 'virement_interne', 'transfert_foyer', 'regle', 'vir sam'),
    (13, '${A}', 10, ${JOUR(1, 12)}, -5, 'VIR NULL', 'virement_interne', null, null, 'vir null'),
    (14, '${A}', 10, ${JOUR(1, 13)}, 80, 'CPAM REMBOURSEMENT', 'sante', 'sante', 'motif', 'cpam remboursement')`);
  await recalculer(A, `${AUJ} - 70`);
  assert.deepEqual(await lignes(A, `mois = '${m1}'`), [
    [m1, 10, "alimentation", "courses", 0, 100, 2],
    [m1, 10, "divers", "a_classer", 0, 20, 1],            // sous-catégorie absente : reprise par défaut de « divers »
    [m1, 10, "epargne", "epargne_precaution", 0, 300, 1],
    [m1, 10, "loisirs", "loisirs", 0, 15, 1],              // paire fausse (loisirs + loyer) : ramenée à la reprise de « loisirs »
    [m1, 10, "loisirs", "restaurants", 0, 30, 1],
    [m1, 10, "loisirs", "sport", 0, 25, 1],
    [m1, 10, "revenus", "salaires", 3000, 0, 1],
    [m1, 10, "sante", "sante", 80, 0, 1],                  // remboursement en entrée
    [m1, 10, "virement_interne", "apport_commun", 0, 1200, 1],
    [m1, 10, "virement_interne", "transfert_foyer", 0, 200, 1],
    [m1, 13, "virement_interne", "apport_commun", 1200, 0, 1],
  ], "virement interne simple (livret et sans sous-catégorie) exclu ; apport et transfert gardés");
  // idempotent
  await recalculer(A, `${AUJ} - 70`);
  assert.equal((await lignes(A, `mois = '${m1}'`)).length, 11);
  // les lecteurs existants écartent les lignes gardées par leur catégorie large (virement_interne) : voir le test de non-régression ci-dessous
  // autre utilisateur intact
  assert.deepEqual(await lignes(B), []);
});

test("D4 carte à débit différé : relevé identifié → les opérations de la carte comptent à leur mois, le relevé est hors budget ; non identifié → carte écartée, relevé compté à classer", async () => {
  await superu();
  await db.exec(`delete from public.banque_operations where user_id = '${A}'; delete from public.banque_mois where user_id = '${A}'; delete from public.banque_marchands_mois where user_id = '${A}'`);
  const m1 = await moisIso(1), m0 = await moisIso(0);
  const carte = `insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle, categorie, sous_categorie, cle_marchand) values
    (1, '${A}', 12, ${JOUR(1, 3)}, -150, 'CB CARREFOUR MARKET', 'alimentation', 'courses', 'carrefour market'),
    (2, '${A}', 12, ${JOUR(1, 10)}, -60, 'CB RESTO EXEMPLE', 'loisirs', 'restaurants', 'resto exemple'),
    (3, '${A}', 12, ${JOUR(1, 20)}, -90, 'CB ACHAT EXEMPLE', 'divers', 'shopping', 'achat exemple')`;
  await db.exec(carte);
  // relevé identifié, débité le 1er du mois courant sur le courant
  await db.exec(`insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle, categorie, sous_categorie, cle_marchand)
    values (4, '${A}', 10, ${MOIS(0)}, -300, 'RELEVE CB EXEMPLE', 'virement_interne', 'releve_carte', 'releve cb exemple')`);
  await recalculer(A, `${AUJ} - 70`);
  assert.deepEqual(await lignes(A), [
    [m1, 12, "alimentation", "courses", 0, 150, 1], [m1, 12, "divers", "shopping", 0, 90, 1], [m1, 12, "loisirs", "restaurants", 0, 60, 1],
    [m0, 10, "virement_interne", "releve_carte", 0, 300, 1],
  ], "identifié : détail de la carte à son mois, relevé hors budget (gardé sous virement_interne)");
  // relevé non identifié (à classer, comme aujourd'hui)
  await db.exec(`update public.banque_operations set categorie = 'divers', sous_categorie = 'a_classer' where id = 4`);
  await recalculer(A, `${AUJ} - 70`);
  assert.deepEqual(await lignes(A), [[m0, 10, "divers", "a_classer", 0, 300, 1]], "non identifié : carte écartée, relevé compté en « à classer »");
  // relevé identifié mais débité plus de 45 jours après : ne couvre pas ces opérations
  await db.exec(`update public.banque_operations set categorie = 'virement_interne', sous_categorie = 'releve_carte', date = ${JOUR(0, 1)} + 0 where id = 4;
    update public.banque_operations set date = ${AUJ} - 80 where id = 1`);
  await recalculer(A, `${AUJ} - 100`);
  assert.ok(!(await lignes(A)).some(l => l[1] === 12 && l[3] === "courses"), "une opération de plus de 45 jours avant le relevé n'est pas couverte");
  // carte sans courant sur la connexion : comptée comme un compte ordinaire (comportement de 0021)
  await db.exec(`delete from public.banque_operations where user_id = '${A}' and compte_id = 10; delete from public.banque_comptes where user_id = '${A}' and id in (10, 13, 11)`);
  await recalculer(A, `${AUJ} - 70`);
  assert.ok((await lignes(A)).some(l => l[1] === 12), "sans courant de la connexion, la carte compte");
  // remise en place
  await db.exec(`delete from public.banque_operations where user_id = '${A}'; delete from public.banque_mois where user_id = '${A}'; delete from public.banque_marchands_mois where user_id = '${A}';
    insert into public.banque_comptes (id, user_id, connexion_id, nom, type, debit_differe) values
      (10, '${A}', 1, 'Courant Exemple', 'courant', false), (11, '${A}', 1, 'Livret Exemple', 'livret', false), (13, '${A}', 1, 'Commun Exemple', 'courant', false)`);
});

test("banque_marchands_mois : un total par (mois, compte, marchand, sous-catégorie) écrit par banque_recalculer_mois, égal aux totaux de banque_mois ; sous-catégories valides", async () => {
  await superu();
  const m1 = await moisIso(1);
  await db.exec(`insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle, categorie, sous_categorie, cle_marchand) values
    (1, '${A}', 10, ${JOUR(1, 3)}, -60, 'CB CARREFOUR MARKET', 'alimentation', 'courses', 'carrefour market'),
    (2, '${A}', 10, ${JOUR(1, 4)}, -40, 'CB CARREFOUR MARKET', 'alimentation', 'courses', 'carrefour market'),
    (3, '${A}', 10, ${JOUR(1, 5)}, 10, 'AVOIR CARREFOUR MARKET', 'alimentation', 'courses', 'carrefour market'),
    (4, '${A}', 10, ${JOUR(1, 6)}, -25, 'CB BASIC FIT', 'loisirs', 'sport', 'basic fit'),
    (5, '${A}', 10, ${JOUR(1, 7)}, -7, 'CB SANS CLE', 'divers', null, null),
    (6, '${A}', 11, ${JOUR(1, 8)}, 300, 'VIR DU COURANT', 'virement_interne', 'virement_interne', 'vir du courant')`);
  await recalculer(A, `${AUJ} - 70`);
  const mm = (await q(`select to_char(mois, 'YYYY-MM-DD') m, compte_id, cle_marchand, sous_categorie, entrees, sorties, nombre from public.banque_marchands_mois where user_id = '${A}' order by cle_marchand`))
    .map(r => [r.m, Number(r.compte_id), r.cle_marchand, r.sous_categorie, num(r.entrees), num(r.sorties), r.nombre]);
  assert.deepEqual(mm, [
    [m1, 10, "", "a_classer", 0, 7, 1],                    // clé absente : ''
    [m1, 10, "basic fit", "sport", 0, 25, 1],
    [m1, 10, "carrefour market", "courses", 10, 100, 3],
  ], "agrégats par marchand ; le virement interne simple n'y est pas");
  const egal = await q(`select m.mois, m.compte_id, m.e, m.s from (select mois, compte_id, sum(entrees) e, sum(sorties) s from public.banque_mois where user_id = '${A}' group by 1, 2) m
    join (select mois, compte_id, sum(entrees) e, sum(sorties) s from public.banque_marchands_mois where user_id = '${A}' group by 1, 2) x using (mois, compte_id) where m.e = x.e and m.s = x.s`);
  assert.equal(egal.length, 1, "mêmes sommes par (mois, compte) dans banque_mois et banque_marchands_mois");
  await refuse(`insert into public.banque_marchands_mois (user_id, mois, compte_id, sous_categorie) values ('${A}', ${MOIS(3)}, 10, 'inconnue')`, /banque_marchands_mois_sous_categorie/, "sous-catégorie hors taxonomie");
  await refuse(`insert into public.banque_marchands_mois (user_id, mois, compte_id, sous_categorie) values ('${A}', ${MOIS(3)} + 1, 10, 'courses')`, /banque_marchands_mois_mois/, "mois non rond");
  await refuse(`insert into public.banque_marchands_mois (user_id, mois, compte_id, sous_categorie, cle_marchand) values ('${A}', ${MOIS(3)}, 10, 'courses', '${"x".repeat(41)}')`, /banque_marchands_mois_cle/, "clé de plus de 40 caractères");
  await refuse(`insert into public.banque_marchands_mois (user_id, mois, compte_id, sous_categorie, entrees) values ('${A}', ${MOIS(3)}, 10, 'courses', -1)`, /banque_marchands_mois_entrees/, "montant négatif");
  await refuse(`insert into public.banque_marchands_mois (user_id, mois, compte_id, sous_categorie) values ('${A}', ${MOIS(3)}, 99, 'courses')`, /foreign key|violates/, "compte inconnu");
  // supprimer le compte supprime ses agrégats (cascade)
  await db.exec(`insert into public.banque_comptes (id, user_id, connexion_id, nom, type) values (50, '${A}', 1, 'Compte à retirer', 'courant');
    insert into public.banque_marchands_mois (user_id, mois, compte_id, sous_categorie, sorties) values ('${A}', ${MOIS(3)}, 50, 'courses', 5);
    delete from public.banque_comptes where user_id = '${A}' and id = 50`);
  assert.equal((await q(`select 1 from public.banque_marchands_mois where compte_id = 50`)).length, 0, "cascade");
  await db.exec(`delete from public.banque_operations where user_id = '${A}'; delete from public.banque_mois where user_id = '${A}'; delete from public.banque_marchands_mois where user_id = '${A}'`);
});

test("banque_marchands_mois : RLS de propriétaire, régime banque_* (aal2 ou connecteur autorisé en lecture ; jamais d'écriture par l'utilisateur ni par un jeton OAuth), lecture seule pour authenticated", async () => {
  await superu();
  await db.exec(`insert into public.banque_marchands_mois (user_id, mois, compte_id, cle_marchand, sous_categorie, sorties, nombre) values
    ('${A}', ${MOIS(2)}, 10, 'carrefour market', 'courses', 100, 2), ('${B}', ${MOIS(2)}, 10, 'carrefour market', 'courses', 7, 1)`);
  const pol = await q(`select policyname, permissive, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'banque_marchands_mois' order by policyname`);
  assert.deepEqual(pol.map(p => [p.policyname, p.permissive, p.cmd]), [
    ["banque_marchands_mois: aal2", "RESTRICTIVE", "ALL"], ["banque_marchands_mois: select", "PERMISSIVE", "SELECT"], ["banque_marchands_mois: suppression aal2", "RESTRICTIVE", "DELETE"]]);
  await session(A);
  assert.deepEqual((await q(`select user_id from public.banque_marchands_mois`)).map(r => r.user_id), [A], "A ne lit que les siens");
  await refuse(`insert into public.banque_marchands_mois (user_id, mois, compte_id, sous_categorie) values ('${A}', ${MOIS(5)}, 10, 'courses')`, /permission denied/, "pas d'écriture pour authenticated");
  await refuse(`update public.banque_marchands_mois set sorties = 1`, /permission denied/, "ni de modification");
  await refuse(`delete from public.banque_marchands_mois`, /permission denied/, "ni de suppression");
  await session(A, "aal1");
  assert.deepEqual(await q(`select 1 from public.banque_marchands_mois`), [], "aal1 : fermée");
  await session(B, "aal2");
  assert.deepEqual((await q(`select user_id from public.banque_marchands_mois`)).map(r => r.user_id), [B], "B ne lit que les siens");
  await session(C, "aal1");
  assert.deepEqual(await q(`select 1 from public.banque_marchands_mois`), [], "C (sans facteur) : fermée, comme toute table banque_*");
  await db.exec(`reset role; set role anon;`);
  await refuse(`select * from public.banque_marchands_mois`, /permission denied/, "anon");
  await db.exec(`reset role; set test.uid = ''; set test.aal = 'aucun'; set role service_role;`);
  assert.equal((await q(`select 1 from public.banque_marchands_mois`)).length, 2, "service_role lit tout sans aal2");
  await superu();
});

test("banque_purger : opérations de plus de 90 jours supprimées (nombre renvoyé), totaux par marchand de plus de 13 mois supprimés, 12 mois gardés", async () => {
  await superu();
  await db.exec(`delete from public.banque_marchands_mois;
    insert into public.banque_marchands_mois (user_id, mois, compte_id, cle_marchand, sous_categorie, sorties, nombre) values
      ('${A}', ${MOIS(14)}, 10, 'a', 'courses', 1, 1), ('${A}', ${MOIS(13)}, 10, 'b', 'courses', 1, 1), ('${A}', ${MOIS(12)}, 10, 'c', 'courses', 1, 1), ('${A}', ${MOIS(2)}, 10, 'd', 'courses', 1, 1),
      ('${B}', ${MOIS(20)}, 10, 'e', 'courses', 1, 1);
    delete from public.banque_operations where user_id = '${A}';
    insert into public.banque_operations (id, user_id, compte_id, date, montant) values (801, '${A}', 10, ${AUJ} - 100, -1), (802, '${A}', 10, ${AUJ} - 10, -1);`);
  await service();
  const n = (await un(`select public.banque_purger(90) n`)).n;
  await superu();
  assert.equal(n, 1, "une opération de plus de 90 jours supprimée");
  assert.deepEqual((await q(`select cle_marchand k from public.banque_marchands_mois order by cle_marchand`)).map(r => r.k), ["b", "c", "d"], "13 mois gardés (mois d'il y a 13 mois compris), au-delà supprimé pour tous les utilisateurs");
  await refuse(`select public.banque_purger(0)`, /au moins 1 jour/, "durée invalide");
  await db.exec(`delete from public.banque_marchands_mois; delete from public.banque_operations where user_id = '${A}'`);
});

// ---------------------------------------------------------------------------------------------------------------------------------
test("budget_reclasser_historique : reconstruit banque_mois (90 jours à 13 mois) depuis les agrégats reclassés, si la somme égale l'ancien total à 1 € près ; sinon le mois reste figé", async () => {
  await superu();
  const x = await moisIso(6), y = await moisIso(8), z = await moisIso(9), w = await moisIso(20);
  await db.exec(`delete from public.banque_mois where user_id = '${A}'; delete from public.banque_marchands_mois where user_id = '${A}';
    -- x : cohérent ; y : l'agrégat ne retombe pas sur l'ancien total ; z : aucun agrégat ; w : au-delà de 13 mois
    insert into public.banque_mois (user_id, mois, compte_id, categorie, sous_categorie, entrees, sorties, nombre) values
      ('${A}', '${x}', 10, 'divers', 'a_classer', 0, 300, 3), ('${A}', '${x}', 10, 'revenus', 'salaires', 3000, 0, 1),
      ('${A}', '${y}', 10, 'divers', 'a_classer', 0, 300, 3),
      ('${A}', '${z}', 10, 'divers', 'a_classer', 0, 50, 1),
      ('${A}', '${w}', 10, 'divers', 'a_classer', 0, 10, 1);
    insert into public.banque_marchands_mois (user_id, mois, compte_id, cle_marchand, sous_categorie, entrees, sorties, nombre) values
      ('${A}', '${x}', 10, 'netflix', 'a_classer', 0, 15, 1), ('${A}', '${x}', 10, 'xyz sarl', 'a_classer', 0, 285.50, 2), ('${A}', '${x}', 10, 'salaire exemple', 'salaires', 3000, 0, 1),
      ('${A}', '${y}', 10, 'netflix', 'a_classer', 0, 100, 1);`);
  // la fonction powens reclasse les agrégats avant l'appel : ici une règle « netflix → abonnements » et « xyz sarl → loisirs »
  await db.exec(`update public.banque_marchands_mois set sous_categorie = 'abonnements' where cle_marchand = 'netflix';
    update public.banque_marchands_mois set sous_categorie = 'loisirs' where cle_marchand = 'xyz sarl'`);
  await service();
  const r = (await un(`select public.budget_reclasser_historique($1) r`, [A])).r;
  await superu();
  const ym = d => d.slice(0, 7);
  assert.deepEqual(r, { reconstruits: [ym(x)], figes: [ym(z), ym(y)] }, "x reconstruit ; y (écart) et z (sans agrégats) figés ; w (plus de 13 mois) hors périmètre");
  assert.deepEqual(await lignes(A, `mois = '${x}'`), [
    [x, 10, "abonnements", "abonnements", 0, 15, 1], [x, 10, "loisirs", "loisirs", 0, 285.5, 2], [x, 10, "revenus", "salaires", 3000, 0, 1]], "totaux conservés, nouvelle répartition, catégorie large de la sous-catégorie");
  assert.deepEqual(await lignes(A, `mois in ('${y}', '${z}', '${w}')`), [
    [w, 10, "divers", "a_classer", 0, 10, 1], [z, 10, "divers", "a_classer", 0, 50, 1], [y, 10, "divers", "a_classer", 0, 300, 3]], "mois figés intacts");
  // idempotent : un second appel ne change rien
  await service();
  const r2 = (await un(`select public.budget_reclasser_historique($1) r`, [A])).r;
  await superu();
  assert.deepEqual(r2, r);
  assert.equal((await lignes(A, `mois = '${x}'`)).length, 3);
  // réservée à service_role
  await session(A);
  await refuse(`select public.budget_reclasser_historique('${A}')`, /permission denied/, "authenticated");
  await refuse(`select public.banque_operations_comptees('${A}', ${AUJ})`, /permission denied/, "fonction interne : authenticated");
  await superu();
  await refuse(`select public.budget_reclasser_historique(null)`, /Utilisateur obligatoire/, "utilisateur null");
  await db.exec(`delete from public.banque_mois where user_id = '${A}'; delete from public.banque_marchands_mois where user_id = '${A}'`);
});

// ---------------------------------------------------------------------------------------------------------------------------------
const regle = (o = {}) => ({ motif: "xyz sarl", sous_categorie: "loisirs", ...o });
const insererRegle = (r, uid = A) => db.query(`insert into public.budget_regles (user_id, motif, sous_categorie, sens, compte_id, montant_min, montant_max, annuelle, source)
  values ($1, $2, $3, coalesce($4, 'sortie'), $5, $6, $7, coalesce($8, false), $9)`, [uid, r.motif, r.sous_categorie, r.sens ?? null, r.compte_id ?? null, r.montant_min ?? null, r.montant_max ?? null, r.annuelle ?? null, r.source ?? null]);

test("budget_regles : défauts, contraintes du § 3.4 (cas invalides de la fixture refusés par la base, valides acceptés), a_classer et hors budget refusés", async () => {
  await superu();
  await db.exec(`delete from public.budget_regles`);
  await insererRegle(regle());
  const r = await un(`select sens, annuelle, active, cree_le is not null c, maj_le is not null m, id is not null i from public.budget_regles`);
  assert.deepEqual(r, { sens: "sortie", annuelle: false, active: true, c: true, m: true, i: true }, "défauts : sens sortie, active");
  // la fixture : chaque règle invalide refusée, chaque règle valide acceptée
  for (const c of FIX.regles_invalides) {
    if (c.refus === null) { await insererRegle(c.regle); continue; }
    await assert.rejects(insererRegle(c.regle), /budget_regles_|violates check|invalid input|constraint/, `${JSON.stringify(c.regle)} : ${c.refus}`);
  }
  assert.equal((await un(`select count(*)::int n from public.budget_regles`)).n, 1 + FIX.regles_invalides.filter(c => c.refus === null).length);
  // cas ajouté par le plan : jamais a_classer (contrainte de base)
  await refuse(`insert into public.budget_regles (user_id, motif, sous_categorie) values ('${A}', 'xyz sarl', 'a_classer')`, /budget_regles_sous_categorie/, "a_classer");
  for (const s of ["virement_interne", "releve_carte"]) await refuse(`insert into public.budget_regles (user_id, motif, sous_categorie) values ('${A}', 'xyz sarl', '${s}')`, /budget_regles_sous_categorie/, s);
  for (const s of ["apport_commun", "transfert_foyer", "loyer", "salaires", "epargne_precaution", "projets", "commun_non_detaille"]) await insererRegle(regle({ sous_categorie: s, motif: "essai " + s.replace(/_/g, " ") }));
  // motif : espaces seules, trop court après rognage, IBAN en majuscules, mot de passe
  for (const m of ["   ab   ", "  ", "IBAN FR7630006000011234567890189", "mot de passe exemple", "ref 12345678"]) await assert.rejects(insererRegle(regle({ motif: m })), /budget_regles_motif/, JSON.stringify(m));
  await insererRegle(regle({ motif: "abo 12345 mensuel" }));   // 5 chiffres : accepté
  // montants : bornes positives, minimum <= maximum
  await assert.rejects(insererRegle(regle({ montant_min: -1 })), /budget_regles_montants/);
  await assert.rejects(insererRegle(regle({ montant_max: -1 })), /budget_regles_montants/);
  await assert.rejects(insererRegle(regle({ montant_min: 50, montant_max: 40 })), /budget_regles_montants/);
  await insererRegle(regle({ motif: "vir sam", montant_min: 45, montant_max: 45, sens: "les_deux", annuelle: true, source: "accord dans la conversation" }));
  await assert.rejects(insererRegle(regle({ source: "x".repeat(201) })), /budget_regles_source/);
  await assert.rejects(insererRegle(regle({ sens: "parfois" })), /budget_regles_sens/);
  // compte : un compte de l'utilisateur (clé composite), supprimé avec lui
  await assert.rejects(insererRegle(regle({ compte_id: 99 })), /foreign key|violates/, "compte inconnu");
  await assert.rejects(insererRegle(regle({ compte_id: 10 }), B).then(() => insererRegle(regle({ compte_id: 11 }), B)), /foreign key|violates/, "le compte 11 n'est pas celui de B");
  await db.exec(`delete from public.budget_regles where user_id = '${B}'`);
  await insererRegle(regle({ motif: "sur un compte", compte_id: 10 }));
  await db.exec(`insert into public.banque_comptes (id, user_id, connexion_id, nom, type) values (60, '${A}', 1, 'Compte jetable', 'courant')`);
  await insererRegle(regle({ motif: "compte jetable", compte_id: 60 }));
  await db.exec(`delete from public.banque_comptes where user_id = '${A}' and id = 60`);
  assert.equal((await q(`select 1 from public.budget_regles where motif = 'compte jetable'`)).length, 0, "une règle propre à un compte disparaît avec lui");
  await db.exec(`delete from public.budget_regles`);
});

test("budget_regles : 300 règles au plus par utilisateur (54000), les autres utilisateurs ne comptent pas", async () => {
  await superu();
  await db.exec(`delete from public.budget_regles;
    insert into public.budget_regles (user_id, motif, sous_categorie) select '${A}', 'motif ' || chr(97 + (g / 26) % 26) || chr(97 + g % 26), 'loisirs' from generate_series(1, 300) g`);
  assert.equal((await un(`select count(*)::int n from public.budget_regles where user_id = '${A}'`)).n, 300);
  await assert.rejects(insererRegle(regle({ motif: "la trois cent unième" })), e => { assert.equal(e.code, "54000"); assert.match(e.message, /300 règles de classement au plus/); return true; });
  await insererRegle(regle({ motif: "une autre personne" }), B);
  await db.exec(`delete from public.budget_regles where user_id = '${A}' and motif like 'motif a%'`);
  await insererRegle(regle({ motif: "la place libérée" }));
  await db.exec(`delete from public.budget_regles`);
});

test("budget_regles : RLS de propriétaire, droits de colonne (l'app n'utilise que active), maj_le tenu par la base, rien pour anon", async () => {
  await superu();
  await db.exec(`delete from public.budget_regles`);
  await insererRegle(regle({ motif: "regle de a" }));
  await insererRegle(regle({ motif: "regle de b" }), B);
  const pol = await q(`select policyname, permissive, cmd from pg_policies where schemaname = 'public' and tablename = 'budget_regles' order by policyname`);
  assert.deepEqual(pol.map(p => [p.policyname, p.permissive, p.cmd]), [
    ["budget_regles: aal2 si facteur", "RESTRICTIVE", "ALL"], ["budget_regles: delete", "PERMISSIVE", "DELETE"], ["budget_regles: insert", "PERMISSIVE", "INSERT"],
    ["budget_regles: select", "PERMISSIVE", "SELECT"], ["budget_regles: update", "PERMISSIVE", "UPDATE"]]);
  await session(A);
  assert.deepEqual((await q(`select motif from public.budget_regles`)).map(r => r.motif), ["regle de a"], "lecture croisée refusée");
  assert.equal((await db.query(`update public.budget_regles set active = false where motif = 'regle de b' returning id`)).rows.length, 0, "modification croisée sans effet");
  assert.equal((await db.query(`delete from public.budget_regles where motif = 'regle de b' returning id`)).rows.length, 0, "suppression croisée sans effet");
  await refuse(`insert into public.budget_regles (user_id, motif, sous_categorie) values ('${B}', 'au nom de b', 'loisirs')`, /row-level security/, "insertion au nom d'un autre");
  const avant = (await un(`select maj_le from public.budget_regles`)).maj_le;
  await db.exec(`select pg_sleep(0.01)`);
  assert.equal((await db.query(`update public.budget_regles set active = false returning active`)).rows[0].active, false, "bascule active : la seule écriture de l'application");
  assert.ok(new Date((await un(`select maj_le from public.budget_regles`)).maj_le) > new Date(avant), "maj_le tenu par la base");
  await db.exec(`update public.budget_regles set motif = 'regle renommee', sous_categorie = 'sport', sens = 'les_deux', montant_min = 1, montant_max = 2, annuelle = true, source = 'accord'`);
  for (const [col, val] of [["user_id", `'${B}'`], ["id", "gen_random_uuid()"], ["cree_le", "now()"]])
    await refuse(`update public.budget_regles set ${col} = ${val}`, /permission denied/, col + " non modifiable");
  await refuse(`update public.budget_regles set sous_categorie = 'a_classer'`, /budget_regles_sous_categorie/, "a_classer refusée aussi en modification");
  assert.equal((await db.query(`delete from public.budget_regles returning id`)).rows.length, 1, "l'utilisateur supprime ses règles");
  await db.exec(`reset role; set role anon;`);
  await refuse(`select * from public.budget_regles`, /permission denied/, "anon");
  await superu();
  await db.exec(`delete from public.budget_regles`);
});

test("budget_regles : politique « aal2 si facteur » de 0033 — facteur vérifié : aal2 ou connecteur autorisé ; sans facteur : aal1 suffit ; un jeton OAuth non autorisé est fermé", async () => {
  await superu();
  await db.exec(`delete from public.budget_regles`);
  await insererRegle(regle({ motif: "regle de a" }));
  await insererRegle(regle({ motif: "regle de c" }), C);
  await session(A, "aal1");
  assert.deepEqual(await q(`select 1 from public.budget_regles`), [], "A (facteur vérifié) en aal1 : fermée");
  await refuse(`insert into public.budget_regles (user_id, motif, sous_categorie) values ('${A}', 'en aal1', 'loisirs')`, /row-level security/, "écriture en aal1");
  await session(A, "aal2");
  assert.equal((await q(`select 1 from public.budget_regles`)).length, 1, "A en aal2");
  await session(C, "aal1");
  assert.equal((await q(`select 1 from public.budget_regles`)).length, 1, "C (sans facteur) : aal1 suffit, comme avant 0028");
  await db.exec(`insert into public.budget_regles (user_id, motif, sous_categorie) values ('${C}', 'ecrite par c', 'sport')`);
  // jeton OAuth (connecteur) : fermé tant que l'utilisateur à facteur ne l'a pas autorisé (code à 6 chiffres), ouvert ensuite
  await superu();
  await db.exec(`delete from public.banque_marchands_mois`);
  await session(A, "aal1", CLAUDE, "bbbbbbbb-0000-4000-8000-000000000001");
  assert.deepEqual(await q(`select 1 from public.budget_regles`), [], "connecteur non autorisé : fermé");
  await refuse(`insert into public.budget_regles (user_id, motif, sous_categorie) values ('${A}', 'sans autorisation', 'sport')`, /row-level security/, "connecteur non autorisé : écriture");
  const sid = await autoriserConnecteur(A);
  assert.equal((await q(`select 1 from public.budget_regles`)).length, 1, "connecteur autorisé : lit");
  await db.exec(`insert into public.budget_regles (user_id, motif, sous_categorie, source) values ('${A}', 'ecrite par le connecteur', 'sport', 'accord dans la conversation')`);
  assert.equal((await q(`select 1 from public.budget_regles`)).length, 2, "connecteur autorisé : écrit une règle (D3, après accord)");
  // la banque reste en lecture seule pour lui, mais il lit les totaux par marchand (régime « banque_* »)
  await superu();
  await db.exec(`insert into public.banque_marchands_mois (user_id, mois, compte_id, cle_marchand, sous_categorie, sorties, nombre) values ('${A}', ${MOIS(2)}, 10, 'carrefour market', 'courses', 100, 2)`);
  await session(A, "aal1", CLAUDE, sid);
  assert.equal((await q(`select 1 from public.banque_marchands_mois`)).length, 1, "connecteur autorisé : lit banque_marchands_mois");
  await refuse(`insert into public.banque_marchands_mois (user_id, mois, compte_id, sous_categorie) values ('${A}', ${MOIS(5)}, 10, 'courses')`, /permission denied|row-level security/, "banque_marchands_mois en écriture");
  await refuse(`delete from public.banque_marchands_mois`, /permission denied|row-level security/, "banque_marchands_mois en suppression");
  // une autre session OAuth du même client n'est pas autorisée
  await session(A, "aal1", CLAUDE, "bbbbbbbb-0000-4000-8000-000000000002");
  assert.deepEqual(await q(`select 1 from public.budget_regles`), [], "autre session : fermée");
  await superu();
  await db.exec(`delete from public.connecteurs_autorises; delete from auth.sessions; delete from public.banque_marchands_mois`);
  await db.exec(`delete from public.budget_regles`);
});

// ---------------------------------------------------------------------------------------------------------------------------------
/** Dépose une proposition de réglages (cible config) et l'applique ; renvoie le nombre appliqué. */
async function proposer(uid, apres, { cree = null, aal = "aal2" } = {}) {
  await superu();
  const id = (await un(`insert into public.propositions (user_id, cible, operation, apres, source) values ($1, 'config', 'modifier', $2::jsonb, 'essai BUD1') returning id`, [uid, JSON.stringify(apres)])).id;
  if (cree) await db.exec(`update public.propositions set cree_le = ${cree} where id = '${id}'`);
  await session(uid, aal);
  return id;
}
const appliquer = async id => (await un(`select public.appliquer_propositions(array[$1::uuid]) n`, [id])).n;
const config = async uid => { await superu(); return await un(`select partage, budget_cible, budget_preferences from public.config where user_id = $1`, [uid]); };
const moisSuivant = async (n = 1) => (await un(`select to_char(date_trunc('month', ${AUJ}) + interval '${n} months', 'YYYY-MM') m`)).m;
const T2 = FIX.cible.find(c => c.id === "T2").attendu;
const cible = async (o = {}) => ({
  valide_du: await moisSuivant(1), revenus_ref: 4800, blocs: T2.blocs, sous_categories: T2.sous_categories, protegees: ["sport"], niveau: T2.niveau,
  taux_epargne: T2.taux, objectifs: [{ id: "apport", probabilite_avant: 0.6, probabilite_apres: 0.8 }], source: "analyse des 12 derniers mois", justification: "épargne nécessaire à 8 chances sur 10", version_taxonomie: FIX.versions.taxonomie, ...o });

test("config : colonnes partage (défaut égal 0,5), budget_cible (absente), budget_preferences ({}) — contraintes de forme", async () => {
  const c = await config(A);
  assert.deepEqual([c.partage, c.budget_cible, c.budget_preferences], [{ mode: "egal", p1: 0.5 }, null, {}]);
  await refuse(`update public.config set partage = '[]'::jsonb where user_id = '${A}'`, /config_partage/, "partage : objet");
  await refuse(`update public.config set budget_cible = '[]'::jsonb where user_id = '${A}'`, /config_budget_cible/, "budget_cible : objet");
  await refuse(`update public.config set budget_preferences = '1'::jsonb where user_id = '${A}'`, /config_budget_preferences/, "budget_preferences : objet");
  await refuse(`update public.config set budget_cible = jsonb_build_object('x', repeat('y', 200001)) where user_id = '${A}'`, /config_budget_cible/, "200 000 octets au plus");
});

test("appliquer_propositions : partage — valide (egal, fixe, apports), maj_le posé, remplacé en entier ; refus en français", async () => {
  let n = await appliquer(await proposer(A, { partage: { mode: "apports", p1: 0.6, source: "apports des 6 derniers mois" } }));
  assert.equal(n, 1);
  let p = (await config(A)).partage;
  assert.deepEqual([p.mode, p.p1, p.source], ["apports", 0.6, "apports des 6 derniers mois"]);
  assert.equal(p.maj_le, (await un(`select to_char(${AUJ}, 'YYYY-MM-DD') j`)).j, "maj_le : date du jour (Paris)");
  n = await appliquer(await proposer(A, { partage: { mode: "egal", source: "à parts égales" } }));
  p = (await config(A)).partage;
  assert.deepEqual([p.mode, p.p1], ["egal", 0.5], "egal : p1 = 0,5");
  n = await appliquer(await proposer(A, { partage: { mode: "fixe", p1: 0.725, source: "accord du couple" } }));
  assert.equal((await config(A)).partage.p1, 0.725);
  for (const [apres, motif] of [
    [{ partage: { mode: "apports", source: "x" } }, /partage : p1 obligatoire/],
    [{ partage: { mode: "fixe", p1: 1.2, source: "x" } }, /partage : p1 invalide/],
    [{ partage: { mode: "fixe", p1: -0.1, source: "x" } }, /partage : p1 invalide/],
    [{ partage: { mode: "egal", p1: 0.6, source: "x" } }, /mode egal implique p1 = 0,5/],
    [{ partage: { mode: "moitie", p1: 0.5, source: "x" } }, /partage : mode invalide/],
    [{ partage: { mode: "fixe", p1: 0.5 } }, /partage : source obligatoire/],
    [{ partage: { mode: "fixe", p1: 0.5, source: "   " } }, /partage : source obligatoire/],
    [{ partage: { mode: "fixe", p1: 0.5, source: "x".repeat(301) } }, /partage : source obligatoire/],
    [{ partage: { mode: "fixe", p1: 0.5, source: "x", maj_le: "2026-01-01" } }, /champ « maj_le » inconnu/],
    [{ partage: "50/50" }, /partage : objet attendu/],
    [{ partage: { mode: "fixe", p1: 0.5, source: "x" }, inconnu: 1 }, /réglage « inconnu » non modifiable par proposition \(cushion, recurring, frais_enveloppes, enveloppes_infos, prets_infos, donations, avis_impot, projection, suivi, partage, budget_cible ou budget_preferences seulement\)/],
  ]) {
    const id = await proposer(A, apres);
    await assert.rejects(appliquer(id), motif, JSON.stringify(apres).slice(0, 80));
    await superu();
    assert.equal((await un(`select statut from public.propositions where id = $1`, [id])).statut, "en_attente", "tout ou rien : la proposition reste en attente");
  }
  assert.equal((await config(A)).partage.p1, 0.725, "les refus n'ont rien changé");
  // les autres clés de la cible config continuent de passer (non-régression : cushion)
  assert.equal(await appliquer(await proposer(A, { cushion: { mode: "amount", min: 1000, max: 2000 } })), 1);
});

test("appliquer_propositions : budget_preferences — fusion champ par champ, null retire, « le » par défaut, source obligatoire ; refus en français", async () => {
  await appliquer(await proposer(A, { budget_preferences: { protegees: ["sport", "restaurants"], revenus_variables: true, annuelles: ["impots_locaux", "vacances"], especes_bloc: "essentiels", effort: "equilibre",
    abonnements_inutilises: ["netflix", "salle exemple"], source: "questionnaire budget", le: "2026-10-01" } }));
  let p = (await config(A)).budget_preferences;
  assert.deepEqual(p, { protegees: ["sport", "restaurants"], revenus_variables: true, annuelles: ["impots_locaux", "vacances"], especes_bloc: "essentiels", effort: "equilibre",
    abonnements_inutilises: ["netflix", "salle exemple"], source: "questionnaire budget", le: "2026-10-01" });
  await appliquer(await proposer(A, { budget_preferences: { effort: "trois", revenus_variables: null, source: " mise à jour " } }));
  p = (await config(A)).budget_preferences;
  assert.deepEqual([p.effort, "revenus_variables" in p, p.protegees, p.source], ["trois", false, ["sport", "restaurants"], "mise à jour"], "fusion, null retire, source rognée");
  assert.equal(p.le, (await un(`select to_char(${AUJ}, 'YYYY-MM-DD') j`)).j, "« le » : date du jour quand elle n'est pas fournie");
  for (const [apres, motif] of [
    [{ budget_preferences: { effort: "equilibre" } }, /budget_preferences : source obligatoire/],
    [{ budget_preferences: { source: "x" } }, /au moins un réglage attendu/],
    [{ budget_preferences: { effort: "intense", source: "x" } }, /effort invalide/],
    [{ budget_preferences: { especes_bloc: "loisirs", source: "x" } }, /especes_bloc invalide/],
    [{ budget_preferences: { protegees: ["inconnue"], source: "x" } }, /sous-catégorie « inconnue » inconnue ou sans budget/],
    [{ budget_preferences: { protegees: ["salaires"], source: "x" } }, /sous-catégorie « salaires » inconnue ou sans budget/],
    [{ budget_preferences: { protegees: ["a_classer"], source: "x" } }, /sous-catégorie « a_classer »/],
    [{ budget_preferences: { protegees: "sport", source: "x" } }, /protegees invalide/],
    [{ budget_preferences: { revenus_variables: "oui", source: "x" } }, /revenus_variables invalide/],
    [{ budget_preferences: { annuelles: ["Impôts Locaux"], source: "x" } }, /annuelles : clé invalide/],
    [{ budget_preferences: { abonnements_inutilises: ["mot de passe"], source: "x" } }, /abonnements_inutilises : clé de marchand invalide/],
    [{ budget_preferences: { effort: "trois", le: "2999-01-01", source: "x" } }, /date \(le\) dans le futur/],
    [{ budget_preferences: { effort: "trois", le: "demain", source: "x" } }, /date \(le\) invalide/],
    [{ budget_preferences: { gout: "x", source: "x" } }, /champ « gout » inconnu/],
    [{ budget_preferences: [] }, /budget_preferences : objet attendu/],
  ]) {
    const id = await proposer(A, apres);
    await assert.rejects(appliquer(id), motif, JSON.stringify(apres).slice(0, 90));
  }
  assert.equal((await config(A)).budget_preferences.effort, "trois", "les refus n'ont rien changé");
});

test("appliquer_propositions : budget_cible — la cible T2 de la fixture s'applique, historique tenu par la base (24 au plus), valide_du au plus tôt le mois suivant, sommes à 1 € près", async () => {
  const v1 = await moisSuivant(1);
  assert.equal(await appliquer(await proposer(A, { budget_cible: { perimetres: { foyer: await cible() } } })), 1);
  let bc = (await config(A)).budget_cible;
  assert.deepEqual(Object.keys(bc).sort(), ["historique", "perimetres"]);
  assert.deepEqual(bc.perimetres.foyer.blocs, { essentiels: 2654, envies: 1246, epargne: 900 });
  assert.equal(bc.historique.length, 1);
  assert.deepEqual([bc.historique[0].perimetre, bc.historique[0].valide_du, bc.historique[0].cible.valide_du], ["foyer", v1, v1]);
  assert.equal(bc.historique[0].propose_le, (await un(`select to_char(${AUJ}, 'YYYY-MM-DD') j`)).j);
  // une cible plus tardive s'ajoute à l'historique (la précédente reste en vigueur jusqu'à son mois)
  const v2 = await moisSuivant(2);
  await appliquer(await proposer(A, { budget_cible: { perimetres: { foyer: await cible({ valide_du: v2, blocs: { essentiels: 2654, envies: 1146, epargne: 1000 }, sous_categories: undefined, niveau: "ambitieuse" }) } } }));
  bc = (await config(A)).budget_cible;
  assert.deepEqual(bc.historique.map(h => h.valide_du), [v1, v2]);
  assert.equal(bc.perimetres.foyer.valide_du, v2, "perimetres.foyer : la cible la plus récente");
  // une cible de même mois remplace celle qui n'est pas encore en vigueur ; une cible du mois précédent la plus tardive est retirée aussi
  await appliquer(await proposer(A, { budget_cible: { perimetres: { foyer: await cible({ valide_du: v1, niveau: "equilibree" }) } } }));
  bc = (await config(A)).budget_cible;
  assert.deepEqual(bc.historique.map(h => [h.valide_du, h.cible.niveau]), [[v1, "equilibree"]], "les entrées pas encore en vigueur (égales ou postérieures) sont remplacées");
  // plafond de 24 entrées : la plus ancienne sort
  for (let i = 1; i <= 26; i++) await appliquer(await proposer(A, { budget_cible: { perimetres: { foyer: await cible({ valide_du: await moisSuivant(i) }) } } }));
  bc = (await config(A)).budget_cible;
  assert.equal(bc.historique.length, 24, "26 cibles à des mois différents : 24 entrées au plus, la plus ancienne sort");
  assert.equal(bc.historique[23].valide_du, await moisSuivant(26));
  assert.equal(bc.historique[0].valide_du, await moisSuivant(3));
  // contrôles
  const refusCible = async (apres, motif, nom, opts) => {
    const id = await proposer(A, apres, opts);
    await assert.rejects(appliquer(id), motif, nom);
    await superu();
    assert.equal((await un(`select statut from public.propositions where id = $1`, [id])).statut, "en_attente", nom + " : reste en attente");
  };
  const avant = JSON.stringify((await config(A)).budget_cible);
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ valide_du: await moisSuivant(0) }) } } }, /valide_du « [0-9-]+ » trop tôt : une cible s'applique au mois suivant/, "le mois en cours");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ valide_du: await moisSuivant(-1) }) } } }, /trop tôt/, "un mois passé");
  // proposée le mois dernier, validée ce mois-ci : valide_du = mois en cours est refusé (une cible ne répare pas la note du mois en cours)
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ valide_du: await moisSuivant(0) }) } } }, /trop tôt/, "proposée le mois dernier", { cree: `now() - interval '40 days'` });
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ revenus_ref: 4802 }) } } }, /somme des blocs \(4800 €\) doit égaler les revenus de référence \(4802 €\) à 1 € près/, "somme des blocs");
  await appliquer(await proposer(A, { budget_cible: { perimetres: { foyer: await cible({ revenus_ref: 4801 }) } } }));   // 1 € d'écart : accepté
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ sous_categories: { ...T2.sous_categories, loyer: 1400 } }) } } }, /somme des sous-catégories de dépenses \(3 [0-9]+|somme des sous-catégories de dépenses \(4000/, "somme des sous-catégories");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ sous_categories: { inconnue: 100 } }) } } }, /sous-catégorie « inconnue » inconnue ou sans budget/, "clé inconnue");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ sous_categories: { salaires: 100 } }) } } }, /sous-catégorie « salaires » inconnue ou sans budget/, "un revenu n'est pas budgété");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ blocs: { essentiels: 100001, envies: 0, epargne: 0 }, revenus_ref: 100001 }) } } }, /blocs invalides|revenus_ref invalide/, "plus de 100 000 €");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ blocs: { essentiels: -10, envies: 2910, epargne: 1900 }, sous_categories: undefined }) } } }, /blocs invalides/, "montant négatif");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ niveau: "folle" }) } } }, /niveau invalide/, "niveau");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ valide_du: "2026-13" }) } } }, /valide_du invalide/, "valide_du");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ source: undefined }) } } }, /source obligatoire/, "source");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ protegees: ["inconnue"] }) } } }, /protegees : sous-catégorie « inconnue »/, "protégée inconnue");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ objectifs: [{ id: "a", probabilite_avant: 2 }] }) } } }, /probabilite_avant invalide/, "probabilité");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible({ gout: 1 }) } } }, /champ « gout » inconnu/, "champ inconnu");
  await superu();
  await db.exec(`update public.config set budget_cible = null where user_id = '${A}'`);
  await refusCible({ budget_cible: { perimetres: { p1: await cible() } } }, /la cible du foyer est exigée/, "foyer exigé (aucune cible du foyer en vigueur)");
  await refusCible({ budget_cible: { perimetres: { foyer: await cible(), cousin: await cible() } } }, /périmètre « cousin » inconnu/, "périmètre inconnu");
  await refusCible({ budget_cible: { historique: [], perimetres: { foyer: await cible() } } }, /champ « historique » inconnu/, "l'historique est tenu par Boussole");
  await refusCible({ budget_cible: { foyer: await cible() } }, /champ « foyer » inconnu/, "forme");
  await refusCible({ budget_cible: { perimetres: {} } }, /perimetres attendu/, "périmètres vides");
  assert.notEqual(avant, undefined);
  // cible du foyer et d'une personne ensemble : les deux sont posées
  await appliquer(await proposer(A, { budget_cible: { perimetres: { foyer: await cible(), p2: await cible({ revenus_ref: 2000, blocs: { essentiels: 1200, envies: 500, epargne: 300 }, sous_categories: undefined }) } } }));
  bc = (await config(A)).budget_cible;
  assert.deepEqual(Object.keys(bc.perimetres).sort(), ["foyer", "p2"]);
  assert.deepEqual(bc.historique.map(h => h.perimetre).sort(), ["foyer", "p2"]);
});

test("appliquer_propositions : plafond de 24 entrées d'historique — les cibles entrées en vigueur s'accumulent, la plus ancienne sort", async () => {
  await superu();
  // 26 cibles déjà entrées en vigueur (valide_du passées) : la base les tient telles quelles, la 27e (mois suivant) pousse la plus ancienne dehors
  const passes = Array.from({ length: 26 }, (_, i) => {
    const d = new Date(Date.UTC(2024, i, 1));
    const m = d.toISOString().slice(0, 7);
    return { perimetre: "foyer", valide_du: m, cible: { valide_du: m, niveau: "equilibree" }, propose_le: m + "-15" };
  });
  await db.exec(`update public.config set budget_cible = '${JSON.stringify({ perimetres: { foyer: passes[25].cible }, historique: passes }).replace(/'/g, "''")}'::jsonb where user_id = '${A}'`);
  await appliquer(await proposer(A, { budget_cible: { perimetres: { foyer: await cible() } } }));
  const bc = (await config(A)).budget_cible;
  assert.equal(bc.historique.length, 24, "24 entrées au plus");
  assert.equal(bc.historique[0].valide_du, passes[3].valide_du, "la plus ancienne sort (3 sorties : 26 + 1 - 24)");
  assert.equal(bc.historique[23].valide_du, await moisSuivant(1), "la plus récente est la nouvelle");
  await db.exec(`update public.config set budget_cible = null, partage = '{"mode": "egal", "p1": 0.5}'::jsonb, budget_preferences = '{}'::jsonb where user_id = '${A}'`);
});

test("gardes de 0034 intactes : un jeton OAuth (client_id) ne valide ni ne refuse de proposition ; un connecteur dépose seulement des propositions en attente ; 500 en attente au plus", async () => {
  const id = await proposer(A, { partage: { mode: "fixe", p1: 0.4, source: "x" } });
  await session(A, "aal2", JETON_NON_AUTORISE);
  await assert.rejects(appliquer(id), e => { assert.equal(e.code, "42501"); assert.match(e.message, /Un connecteur ne peut pas valider de proposition/); return true; }, "appliquer_propositions");
  await assert.rejects(db.query(`select public.refuser_propositions(array['${id}'::uuid])`), /Un connecteur ne peut pas refuser de proposition/, "refuser_propositions");
  await assert.rejects(db.query(`update public.propositions set statut = 'acceptee', decide_le = now() where id = '${id}'`), /ne peut changer que le contenu d'une proposition en attente|ne peut pas modifier/, "propositions_garde : statut");
  await assert.rejects(db.query(`delete from public.propositions where id = '${id}'`), /ne peut pas retirer une proposition/, "propositions_garde : suppression");
  await assert.rejects(db.query(`insert into public.propositions (user_id, cible, operation, apres, source, statut, decide_le) values ('${A}', 'config', 'modifier', '{}', 'x', 'acceptee', now())`), /ne dépose que des propositions en attente/, "propositions_garde : insertion décidée");
  // un connecteur peut déposer une proposition de budget (en attente), comme avant
  await db.exec(`insert into public.propositions (user_id, cible, operation, apres, source) values ('${A}', 'config', 'modifier', '{"budget_cible": {"perimetres": {}}}', 'proposer_budget_cible')`);
  await session(A);
  assert.equal((await un(`select statut from public.propositions where id = $1`, [id])).statut, "en_attente", "rien n'a bougé");
  await superu();
  // la garde des mouvements importés (0034) est toujours là
  const trig = (await q(`select tgname from pg_trigger where tgrelid in ('public.propositions'::regclass, 'public.transactions'::regclass) and not tgisinternal order by tgname`)).map(r => r.tgname);
  assert.ok(trig.includes("propositions_garde") && trig.includes("transactions_historique_garde"), "déclencheurs de 0034 présents : " + trig);
  await db.exec(`delete from public.propositions where user_id = '${A}'`);
});

test("appliquer_propositions : redéfinition de 0034 limitée aux ajouts de BUD1 (une variable, trois clés de la liste blanche, trois blocs)", async () => {
  const corps = s => {
    const i = s.indexOf("create or replace function public.appliquer_propositions");
    return s.slice(i, s.indexOf("grant execute on function public.appliquer_propositions(uuid[], jsonb) to authenticated;", i));
  };
  let neuf = corps(SQL);
  const debut = neuf.indexOf("        -- partage (BUD1, 0035)"), fin = neuf.indexOf("      /* ---------- événements de vie du foyer (0030)");
  assert.ok(debut > 0 && fin > debut, "blocs ajoutés repérés");
  neuf = neuf.slice(0, debut) + neuf.slice(fin).replace(/^\n/, "");
  neuf = neuf.replace("  v_hist   jsonb;\n  v_bud    jsonb;\n", "  v_hist   jsonb;\n")
    .replace(", 'suivi', 'partage', 'budget_cible', 'budget_preferences') limit 1;", ", 'suivi') limit 1;")
    .replace("projection, suivi, partage, budget_cible ou budget_preferences seulement)'", "projection ou suivi seulement)'")
    .replace("v ? 'suivi' or v ? 'partage' or v ? 'budget_cible' or v ? 'budget_preferences') then", "v ? 'suivi') then")
    .replace("projection, suivi, partage, budget_cible ou budget_preferences)';", "projection ou suivi)';");
  const ancien = corps(M34);
  const norm = s => s.replace(/\s+\n/g, "\n").replace(/\n\n+/g, "\n").trim();
  assert.equal(norm(neuf).split("\n").length, norm(ancien).split("\n").length, "même nombre de lignes une fois les ajouts retirés");
  assert.equal(norm(neuf), norm(ancien), "reste identique à 0034 (garde du connecteur comprise)");
  assert.match(SQL, /Un connecteur ne peut pas valider de proposition/);
});

// ---------------------------------------------------------------------------------------------------------------------------------
test("export_all : budget_regles et banque_marchands_mois sortent pour leur propriétaire seulement ; clés de 0034 conservées ; jamais par un jeton OAuth", async () => {
  await superu();
  await db.exec(`delete from public.budget_regles; delete from public.banque_marchands_mois;
    insert into public.budget_regles (user_id, motif, sous_categorie) values ('${A}', 'regle de a', 'loisirs'), ('${B}', 'regle de b', 'sport');
    insert into public.banque_marchands_mois (user_id, mois, compte_id, cle_marchand, sous_categorie, sorties, nombre) values ('${A}', ${MOIS(2)}, 10, 'carrefour market', 'courses', 100, 2), ('${B}', ${MOIS(2)}, 10, 'autre', 'courses', 7, 1)`);
  await session(A);
  const e = (await un(`select public.export_all() j`)).j;
  assert.deepEqual(e.budget_regles.map(r => r.motif), ["regle de a"]);
  assert.deepEqual(e.banque_marchands_mois.map(r => r.cle_marchand), ["carrefour market"]);
  for (const k of ["historique_comptes", "historique_imports", "historique_releves", "historique_banque_mois", "photos_reconstituees", "banque_mois", "connecteurs_autorises"]) assert.ok(k in e, k);
  assert.ok(e.config[0].partage && "budget_preferences" in e.config[0] && "budget_cible" in e.config[0], "les nouvelles colonnes de config sortent avec la ligne");
  assert.ok(e.banque_mois.every(l => "sous_categorie" in l) || e.banque_mois.length === 0, "sous_categorie de banque_mois");
  await session(A, "aal1");
  const sans = (await un(`select public.export_all() j`)).j;
  assert.deepEqual([sans.banque_marchands_mois, sans.budget_regles], [[], []], "aal1 : fermées (facteur vérifié)");
  await session(A, "aal2", JETON_NON_AUTORISE);
  await assert.rejects(db.query(`select public.export_all()`), /Un connecteur ne peut pas exporter/, "garde de 0033 conservée");
  await superu();
  await db.exec(`delete from public.budget_regles; delete from public.banque_marchands_mois`);
});

test("non-régression des lecteurs existants : Calc.budgetReel et BanqueEtat.reelMoyen donnent les mêmes chiffres avec des lignes par sous-catégorie et les lignes gardées (apport, transfert, relevé)", () => {
  const Calc = require("../web/src/calc.js"), BanqueEtat = require("../web/src/banque-etat.js");
  const comptes = [{ id: 10, type: "courant", actif: true }, { id: 13, type: "courant", actif: true }];
  const ligne = (mois, compte_id, categorie, sous_categorie, entrees, sorties) => ({ mois, compte_id, categorie, sous_categorie, entrees, sorties, nombre: 1 });
  const avant = [
    ligne("2026-07-01", 10, "revenus", "", 3000, 0), ligne("2026-07-01", 10, "alimentation", "", 0, 500), ligne("2026-07-01", 10, "loisirs", "", 0, 200), ligne("2026-07-01", 10, "epargne", "", 0, 300),
    ligne("2026-08-01", 10, "revenus", "", 3000, 0), ligne("2026-08-01", 10, "alimentation", "", 0, 600), ligne("2026-08-01", 10, "loisirs", "", 0, 100), ligne("2026-08-01", 10, "epargne", "", 0, 300),
  ];
  const apres = [
    ligne("2026-07-01", 10, "revenus", "salaires", 3000, 0), ligne("2026-07-01", 10, "alimentation", "courses", 0, 350), ligne("2026-07-01", 10, "alimentation", "restaurants", 0, 150),
    ligne("2026-07-01", 10, "loisirs", "sport", 0, 120), ligne("2026-07-01", 10, "loisirs", "sorties", 0, 80), ligne("2026-07-01", 10, "epargne", "epargne_precaution", 0, 300),
    ligne("2026-07-01", 10, "virement_interne", "apport_commun", 0, 1200), ligne("2026-07-01", 13, "virement_interne", "apport_commun", 1200, 0), ligne("2026-07-01", 10, "virement_interne", "transfert_foyer", 0, 200),
    ligne("2026-07-01", 10, "virement_interne", "releve_carte", 0, 300),
    ligne("2026-08-01", 10, "revenus", "salaires", 3000, 0), ligne("2026-08-01", 10, "alimentation", "courses", 0, 600), ligne("2026-08-01", 10, "loisirs", "sport", 0, 100), ligne("2026-08-01", 10, "epargne", "epargne_precaution", 0, 300),
    ligne("2026-08-01", 13, "virement_interne", "apport_commun", 500, 0),
  ];
  const r = banque => Calc.budgetReel({ actif: true, comptes, mois: banque }, "2026-09-15");
  const a = r(avant), b = r(apres);
  assert.ok(a && b);
  for (const k of ["n", "du", "au", "revenus", "depenses", "epargne", "capacite", "tauxEpargne", "tauxCapacite"]) assert.equal(b[k], a[k], "Calc.budgetReel." + k);
  const m = BanqueEtat.reelMoyen(avant, "2026-09-15"), m2 = BanqueEtat.reelMoyen(apres, "2026-09-15");
  assert.deepEqual(m2, m, "BanqueEtat.reelMoyen");
});
