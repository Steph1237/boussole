// Virements internes exclus des totaux mensuels (migration 0024_banque_virements.sql, CP1 § 5) exercés sur PGlite : toutes les
// migrations du dépôt appliquées sur les bouchons Supabase (test/helpers/pglite.mjs, baseComplete). Couvre : la fonction de 0021
// reprise à l'identique (au seul filtre près), l'exclusion des opérations « virement_interne » (ni entrées, ni sorties, ni
// nombre), l'épargne toujours comptée, la catégorie libre de banque_operations et les droits (service_role seulement).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseComplete } from "./helpers/pglite.mjs";

const lire = f => readFileSync(new URL("../supabase/migrations/" + f, import.meta.url), "utf8");
const SQL = lire("0024_banque_virements.sql");
const A = "11111111-1111-1111-1111-111111111111";
const AUJ = `(now() at time zone 'Europe/Paris')::date`;
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
const num = v => (v == null ? null : Number(v));

before(async () => {
  db = await baseComplete();
  await db.exec(`insert into auth.users (id) values ('${A}');
    insert into public.banque_connexions (id, user_id, etablissement) values (1, '${A}', 'Banque Test'), (2, '${A}', 'Autre Banque');
    insert into public.banque_comptes (id, user_id, connexion_id, nom, type) values
      (10, '${A}', 1, 'Compte courant', 'courant'), (11, '${A}', 1, 'Livret A', 'livret'), (20, '${A}', 2, 'Compte joint', 'courant');`);
});
after(async () => { await db.close(); });

/** Corps d'une définition de banque_recalculer_mois (du create au $$; final), espaces réduits. */
const corps = s => {
  const i = s.indexOf("create or replace function public.banque_recalculer_mois");
  return s.slice(i, s.indexOf("$$;", i) + 3).replace(/\s+/g, " ");
};

test("migration 0024 : en-tête (non appliquée), fonction de 0021 reprise à l'identique plus l'exclusion, droits, tutoiement", () => {
  assert.match(SQL, /^-- Boussole : banque, virements internes/);
  assert.match(SQL, /Non appliquée : à appliquer sur le projet oapcewpqsbbjdlcdeizi avec apply_migration \(name = "banque_virements"\)/);
  const exclusion = " and coalesce(btrim(o.categorie), '') <> 'virement_interne'";
  assert.ok(corps(SQL).includes(exclusion), "exclusion présente");
  assert.equal(corps(SQL).replace(exclusion, ""), corps(lire("0021_banque.sql")), "reprise à l'identique de 0021, au filtre près");
  assert.match(SQL, /revoke all on function public\.banque_recalculer_mois\(uuid, date\) from public, anon, authenticated;/);
  assert.match(SQL, /grant execute on function public\.banque_recalculer_mois\(uuid, date\) to service_role;/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
});

test("PGlite : banque_recalculer_mois — « virement_interne » ni en entrées ni en sorties ; « epargne » comptée ; catégorie libre", async () => {
  await db.exec(`insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle, categorie) values
    (1, '${A}', 10, ${AUJ}, 3000, 'VIR SALAIRE', 'revenus'),
    (2, '${A}', 10, ${AUJ}, -250, 'VIR VERS JOINT', 'virement_interne'),
    (3, '${A}', 20, ${AUJ}, 250, 'VIR DE PERSO', 'virement_interne'),
    (4, '${A}', 10, ${AUJ}, -400, 'VIR LIVRET', 'epargne'),
    (5, '${A}', 11, ${AUJ}, 400, 'VIR DU COURANT', ' virement_interne '),
    (6, '${A}', 10, ${AUJ}, -60, 'CARTE MARCHE', 'alimentation')`);
  await db.exec(`reset role; set test.uid = ''; set role service_role;`);
  await q(`select public.banque_recalculer_mois($1, ${AUJ})`, [A]);
  await db.exec(`reset role;`);
  const lignes = (await q(`select categorie, entrees, sorties, nombre from public.banque_mois where user_id = $1 and mois = date_trunc('month', ${AUJ})::date order by categorie`, [A]))
    .map(r => [r.categorie, num(r.entrees), num(r.sorties), r.nombre]);
  assert.deepEqual(lignes, [["alimentation", 0, 60, 1], ["epargne", 0, 400, 1], ["revenus", 3000, 0, 1]]);
  // droits : jamais pour authenticated
  await db.exec(`set test.uid = '${A}'; set role authenticated;`);
  await assert.rejects(db.query(`select public.banque_recalculer_mois($1, ${AUJ})`, [A]), /permission/);
  await db.exec(`reset role;`);
});
