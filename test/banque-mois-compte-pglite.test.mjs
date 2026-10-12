// Totaux mensuels par compte et trace des virements internes (migration 0025_banque_mois_compte.sql, correctifs CP1) exercés sur
// PGlite : toutes les migrations du dépôt appliquées sur les bouchons Supabase (test/helpers/pglite.mjs, baseComplete). Couvre :
// les colonnes ajoutées (banque_operations.categorie_powens, contrepartie_id, type_powens ; banque_mois.compte_id), la nouvelle
// clé primaire, banque_recalculer_mois reprise de 0024 au seul compte près (insert, select, group by), le garde-fou de 90 jours
// de 0021 (les mois anciens restent), le recalcul fait par la migration elle-même sur des données existantes et les droits.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseComplete } from "./helpers/pglite.mjs";

const lire = f => readFileSync(new URL("../supabase/migrations/" + f, import.meta.url), "utf8");
const SQL = lire("0025_banque_mois_compte.sql");
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
const AUJ = `(now() at time zone 'Europe/Paris')::date`;
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const num = v => (v == null ? null : Number(v));
const service = () => db.exec(`reset role; set test.uid = ''; set role service_role;`);
const superu = () => db.exec(`reset role; set test.uid = '';`);
const mois = async (u, filtre = "true") => (await q(`select to_char(mois, 'YYYY-MM-DD') m, compte_id, categorie, entrees, sorties, nombre
    from public.banque_mois where user_id = $1 and ${filtre} order by mois, compte_id, categorie`, [u]))
  .map(r => [r.m, Number(r.compte_id), r.categorie, num(r.entrees), num(r.sorties), r.nombre]);

before(async () => {
  db = await baseComplete();
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}');
    insert into public.banque_connexions (id, user_id, etablissement) values (1, '${A}', 'Banque Test'), (2, '${A}', 'Autre Banque'), (3, '${B}', 'Banque B');
    insert into public.banque_comptes (id, user_id, connexion_id, nom, type, debit_differe) values
      (10, '${A}', 1, 'Compte courant', 'courant', false), (11, '${A}', 1, 'Livret A', 'livret', false), (12, '${A}', 1, 'Carte', 'courant', true),
      (20, '${A}', 2, 'Compte joint', 'courant', false), (30, '${B}', 3, 'Courant B', 'courant', false);`);
});
after(async () => { await db.close(); });

/** Corps d'une définition de banque_recalculer_mois (du create au $$; final), espaces réduits. */
const corps = s => {
  const i = s.indexOf("create or replace function public.banque_recalculer_mois");
  return s.slice(i, s.indexOf("$$;", i) + 3).replace(/\s+/g, " ");
};

test("migration 0025 : en-tête (non appliquée), fonction de 0024 reprise à l'identique au compte près, droits, tutoiement", () => {
  assert.match(SQL, /^-- Boussole : banque, totaux mensuels par compte/);
  assert.match(SQL, /Non appliquée : à appliquer sur le projet oapcewpqsbbjdlcdeizi avec apply_migration \(name = "banque_mois_compte"\)/);
  const c = corps(SQL);
  const parCompte = [
    ["insert into public.banque_mois (user_id, mois, compte_id, categorie, entrees, sorties, nombre)", "insert into public.banque_mois (user_id, mois, categorie, entrees, sorties, nombre)"],
    [" date_trunc('month', o.date)::date, o.compte_id,", " date_trunc('month', o.date)::date,"],
    [" group by 2, 3, 4;", " group by 2, 3;"],
  ];
  let sans = c;
  for (const [avec, avant] of parCompte) { assert.ok(sans.includes(avec), "par compte : " + avec); sans = sans.replace(avec, avant); }
  assert.equal(sans, corps(lire("0024_banque_virements.sql")), "reprise exacte de 0024, au compte près");
  assert.match(SQL, /revoke all on function public\.banque_recalculer_mois\(uuid, date\) from public, anon, authenticated;/);
  assert.match(SQL, /grant execute on function public\.banque_recalculer_mois\(uuid, date\) to service_role;/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
});

test("PGlite : colonnes ajoutées, clé primaire (user_id, mois, compte_id, categorie), compte_id 0 par défaut", async () => {
  const cols = async t => (await q(`select column_name c, data_type t, is_nullable n, column_default d from information_schema.columns
    where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t]));
  const op = Object.fromEntries((await cols("banque_operations")).map(r => [r.c, r]));
  assert.deepEqual([op.categorie_powens.t, op.categorie_powens.n], ["text", "YES"]);
  assert.deepEqual([op.contrepartie_id.t, op.contrepartie_id.n], ["bigint", "YES"]);
  assert.deepEqual([op.type_powens.t, op.type_powens.n], ["text", "YES"]);
  const m = Object.fromEntries((await cols("banque_mois")).map(r => [r.c, r]));
  assert.deepEqual([m.compte_id.t, m.compte_id.n, m.compte_id.d], ["bigint", "NO", "0"]);
  const pk = (await un(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.banque_mois'::regclass and contype = 'p'`)).d;
  assert.equal(pk, "PRIMARY KEY (user_id, mois, compte_id, categorie)");
});

test("PGlite : banque_recalculer_mois par compte — mêmes règles que 0024 (virements internes exclus, carte différée exclue), comptes séparés", async () => {
  await superu();
  await db.exec(`insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle, categorie, categorie_powens, contrepartie_id, type_powens) values
    (1, '${A}', 10, ${AUJ}, 3000, 'VIR SALAIRE', 'revenus', 'revenus', null, 'transfer'),
    (2, '${A}', 10, ${AUJ}, -400, 'VIR LIVRET', 'epargne', 'divers', 3, 'transfer'),
    (3, '${A}', 11, ${AUJ}, 400, 'VIR DU COURANT', 'virement_interne', 'epargne', 2, 'transfer'),
    (4, '${A}', 10, ${AUJ}, -60, 'CARTE MARCHE', 'alimentation', 'alimentation', null, 'card'),
    (5, '${A}', 20, ${AUJ}, -40, 'MARCHE', 'alimentation', 'alimentation', null, 'card'),
    (6, '${A}', 20, ${AUJ}, 100, 'RETOUR LIVRET', 'epargne', 'divers', null, null),
    (7, '${A}', 12, ${AUJ}, -25, 'CB RESTO', 'loisirs', 'loisirs', null, 'deferred_card'),
    (8, '${A}', 11, ${AUJ}, 2, 'INTERETS', 'divers', 'divers', null, null)`);
  await service();
  await q(`select public.banque_recalculer_mois($1, ${AUJ})`, [A]);
  await superu();
  const m0 = (await un(`select to_char(date_trunc('month', ${AUJ}), 'YYYY-MM-DD') m`)).m;
  assert.deepEqual(await mois(A, `mois = '${m0}'`), [
    [m0, 10, "alimentation", 0, 60, 1], [m0, 10, "epargne", 0, 400, 1], [m0, 10, "revenus", 3000, 0, 1],
    [m0, 11, "divers", 2, 0, 1],
    [m0, 20, "alimentation", 0, 40, 1], [m0, 20, "epargne", 100, 0, 1],
  ], "un total par (compte, catégorie) ; virement interne et carte à débit différé exclus");
  // idempotent
  await service();
  await q(`select public.banque_recalculer_mois($1, ${AUJ})`, [A]);
  await superu();
  assert.equal((await mois(A, `mois = '${m0}'`)).length, 6);
});

test("PGlite : garde-fou de 0021 — un mois de plus de 90 jours n'est ni effacé ni recalculé (les mois anciens restent) ; une ligne récente sans compte est remplacée", async () => {
  await superu();
  const vieux = (await un(`select to_char(date_trunc('month', ${AUJ} - 200), 'YYYY-MM-DD') m`)).m;
  const m0 = (await un(`select to_char(date_trunc('month', ${AUJ}), 'YYYY-MM-DD') m`)).m;
  await db.exec(`insert into public.banque_mois (user_id, mois, categorie, entrees, sorties, nombre) values
    ('${A}', '${vieux}', 'logement', 0, 900, 1), ('${A}', '${m0}', 'loisirs', 0, 999, 9)`);
  assert.deepEqual(await mois(A, `mois = '${vieux}'`), [[vieux, 0, "logement", 0, 900, 1]], "compte_id 0 par défaut (ligne d'avant 0025)");
  await service();
  await q(`select public.banque_recalculer_mois($1, ${AUJ} - 400)`, [A]);
  await superu();
  assert.deepEqual(await mois(A, `mois = '${vieux}'`), [[vieux, 0, "logement", 0, 900, 1]], "mois ancien : gardé tel quel");
  assert.ok(!(await mois(A, `mois = '${m0}'`)).some(r => r[1] === 0), "ligne récente sans compte : remplacée par les totaux par compte");
  // autre utilisateur intact
  assert.deepEqual(await mois(B), []);
});

test("PGlite : la migration recalcule tout de suite les mois couverts par le détail (lignes par compte), garde les anciens", async () => {
  const d = await baseComplete("0024_banque_virements.sql");
  try {
    await d.exec(`insert into auth.users (id) values ('${A}');
      insert into public.banque_connexions (id, user_id) values (1, '${A}');
      insert into public.banque_comptes (id, user_id, connexion_id, type) values (10, '${A}', 1, 'courant'), (11, '${A}', 1, 'livret');
      insert into public.banque_operations (id, user_id, compte_id, date, montant, categorie) values
        (1, '${A}', 10, ${AUJ}, -50, 'alimentation'), (2, '${A}', 11, ${AUJ}, -30, 'alimentation');
      insert into public.banque_mois (user_id, mois, categorie, entrees, sorties, nombre) values
        ('${A}', date_trunc('month', ${AUJ})::date, 'alimentation', 0, 80, 2), ('${A}', date_trunc('month', ${AUJ} - 200)::date, 'logement', 0, 900, 1);`);
    await d.exec(SQL);
    const l = (await d.query(`select (mois = date_trunc('month', ${AUJ})::date) recent, compte_id, categorie, sorties from public.banque_mois order by mois desc, compte_id`)).rows
      .map(r => [r.recent, Number(r.compte_id), r.categorie, Number(r.sorties)]);
    assert.deepEqual(l, [[true, 10, "alimentation", 50], [true, 11, "alimentation", 30], [false, 0, "logement", 900]]);
  } finally { await d.close(); }
});

test("PGlite : droits — banque_mois et colonnes ajoutées lisibles par le propriétaire seulement, jamais écrites ; recalcul réservé à service_role", async () => {
  await db.exec(`reset role; set test.uid = '${A}'; set role authenticated;`);
  const l = await q(`select compte_id from public.banque_mois`);
  assert.ok(l.length > 0);
  const o = await q(`select categorie_powens, contrepartie_id, type_powens from public.banque_operations where id = 2`);
  assert.deepEqual(o.map(r => [r.categorie_powens, Number(r.contrepartie_id), r.type_powens]), [["divers", 3, "transfer"]]);
  await assert.rejects(db.query(`insert into public.banque_mois (user_id, mois, compte_id, categorie) values ('${A}', date_trunc('month', ${AUJ})::date, 10, 'x')`), /permission/);
  await assert.rejects(db.query(`update public.banque_operations set contrepartie_id = null`), /permission/);
  await assert.rejects(db.query(`select public.banque_recalculer_mois($1, ${AUJ})`, [A]), /permission/);
  await db.exec(`reset role; set test.uid = '${B}'; set role authenticated;`);
  assert.deepEqual(await q(`select * from public.banque_mois where user_id = '${A}'`), [], "RLS : rien de A pour B");
  await db.exec(`reset role;`);
});
