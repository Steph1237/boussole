// Cours historiques et Binance (CP1, docs/superpowers/specs/2026-10-12-cp1-comptes-performance-design.md § 4, § 7 et § 8) exercés
// sur un vrai PostgreSQL (PGlite, en mémoire) : toutes les migrations 0001 → 0023 appliquées sur les bouchons Supabase
// (test/helpers/pglite.mjs, baseComplete). Couvre la table cours (structure, contrôles, droits : lecture pour authenticated,
// aucune écriture client, écriture par service_role), la colonne instruments.cours_rattrapage_le, la fonction cours_a_rattraper
// (réservée à service_role), la clé de fonctionnalité « binance » et la valeur « binance » de positions.source_auto.
// Aucun réseau ni secret réel.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseComplete, comme } from "./helpers/pglite.mjs";

const SQL = readFileSync(new URL("../supabase/migrations/0023_cours_binance.sql", import.meta.url), "utf8");
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
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
    insert into public.instruments (isin, symbol, currency) values
      ('FR0010315770', 'CW8.PA', 'EUR'), ('IE00B4L5Y983', 'IWDA.AS', 'EUR'), ('X-BTC', 'BTC-EUR', 'EUR'), ('X-ETH-EUR', 'ETH-EUR', 'EUR'),
      ('US0378331005', 'AAPL', 'USD'), ('FR0000120271', null, 'EUR'), ('LU0000000000', null, 'EUR'), ('X-SANS', null, 'EUR'),
      ('US5949181045', null, 'USD');
    insert into public.positions (user_id, name, envelope, mode, isin, qty, status) values
      ('${A}', 'World', 'PEA', 'market', 'FR0010315770', 10, 'actif'),
      ('${A}', 'Bitcoin', 'Crypto (Binance)', 'market', 'X-BTC', 0.1, 'actif'),
      ('${B}', 'MSCI World', 'CTO', 'market', 'IE00B4L5Y983', 3, 'actif'),
      ('${B}', 'Ether', 'Crypto (Binance)', 'market', 'X-ETH-EUR', 1, 'actif'),
      ('${B}', 'Apple', 'CTO', 'market', 'US0378331005', 2, 'clôturé'),
      ('${B}', 'Total', 'CTO', 'market', 'FR0000120271', 2, 'actif'),
      ('${B}', 'Sans symbole', 'Crypto', 'market', 'X-SANS', 2, 'actif'),
      ('${B}', 'Microsoft', 'CTO', 'market', 'US5949181045', 2, 'actif');`);
});
after(async () => { await db.close(); });

test("migration 0023 : en-tête (non appliquée, apply_migration name = cours_binance), tutoiement, aucun secret", () => {
  assert.match(SQL, /^-- Boussole : cours historiques et Binance/);
  assert.match(SQL, /à appliquer avec apply_migration \(name = "cours_binance"\)/);
  assert.match(SQL, /Non appliquée/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(SQL, /sb_secret_|eyJhbGci|BINANCE_API_SECRET\s*=|BINANCE_API_KEY\s*=/);
});

test("PGlite : table cours — colonnes, clé primaire, clé étrangère vers instruments (cascade), contrôles", async () => {
  await superu();
  const cols = (await q(`select column_name c, data_type t, is_nullable n from information_schema.columns
    where table_schema = 'public' and table_name = 'cours' order by ordinal_position`)).map(r => `${r.c}:${r.t}:${r.n}`);
  assert.deepEqual(cols, ["isin:text:NO", "date:date:NO", "cloture:numeric:NO", "source:text:YES"]);
  const def = async (t, type) => (await q(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and contype = $2`, [t, type])).map(r => r.d);
  assert.deepEqual(await def("public.cours", "p"), ["PRIMARY KEY (isin, date)"]);
  assert.ok((await def("public.cours", "f")).includes("FOREIGN KEY (isin) REFERENCES instruments(isin) ON DELETE CASCADE"));
  await q(`insert into public.cours (isin, date, cloture, source) values ('FR0010315770', '2026-10-09', 512.3, 'yahoo')`);
  await q(`insert into public.cours (isin, date, cloture) values ('X-BTC', '2026-10-09', 52000)`);
  await refuse(`insert into public.cours (isin, date, cloture) values ('FR0010315770', '2026-10-09', 1)`, [], /duplicate key|cours_pkey/, "doublon (isin, date)");
  await refuse(`insert into public.cours (isin, date, cloture) values ('FR0010315770', '2026-10-08', 0)`, [], /cours_cloture/, "clôture nulle");
  await refuse(`insert into public.cours (isin, date, cloture) values ('FR0010315770', '2026-10-08', -3)`, [], /cours_cloture/, "clôture négative");
  await refuse(`insert into public.cours (isin, date, cloture) values ('FR0010315770', '2026-10-08', null)`, [], /null value/, "clôture absente");
  await refuse(`insert into public.cours (isin, date, cloture) values ('FR0010315770', null, 1)`, [], /null value/, "date absente");
  await refuse(`insert into public.cours (isin, date, cloture) values ('fr0010315770', '2026-10-08', 1)`, [], /cours_isin/, "ISIN en minuscules");
  await refuse(`insert into public.cours (isin, date, cloture) values ('BTC', '2026-10-08', 1)`, [], /cours_isin/, "ni ISIN ni X-");
  await refuse(`insert into public.cours (isin, date, cloture) values ('X-INCONNU', '2026-10-08', 1)`, [], /foreign key/, "instrument absent");
  // cascade : un instrument supprimé emporte ses cours
  await db.exec(`insert into public.instruments (isin) values ('X-TEMP'); insert into public.cours (isin, date, cloture) values ('X-TEMP', '2026-10-01', 1);`);
  await q(`delete from public.instruments where isin = 'X-TEMP'`);
  assert.equal((await un(`select count(*)::int n from public.cours where isin = 'X-TEMP'`)).n, 0);
  const rls = await un(`select relrowsecurity r from pg_class where oid = 'public.cours'::regclass`);
  assert.equal(rls.r, true, "RLS activée");
  const col = await un(`select data_type t from information_schema.columns where table_schema = 'public' and table_name = 'instruments' and column_name = 'cours_rattrapage_le'`);
  assert.equal(col?.t, "timestamp with time zone", "instruments.cours_rattrapage_le");
});

test("PGlite : cours — lecture pour authenticated (tous les ISIN), aucune écriture client ; anon sans accès ; service_role écrit", async () => {
  await comme(db, B);
  const rows = await q(`select isin, cloture from public.cours order by isin`);
  assert.deepEqual(rows.map(r => r.isin), ["FR0010315770", "X-BTC"], "données publiques de marché : B lit aussi les cours des ISIN de A");
  for (const [s, m] of [
    [`insert into public.cours (isin, date, cloture) values ('X-BTC', '2026-10-10', 1)`, "insertion"],
    [`update public.cours set cloture = 1`, "modification"],
    [`delete from public.cours`, "suppression"],
    [`insert into public.cours (isin, date, cloture) values ('X-BTC', '2026-10-09', 1) on conflict (isin, date) do update set cloture = 1`, "upsert"],
  ]) await refuse(s, [], /permission denied/, "authenticated : " + m);
  await db.exec(`reset role; set test.uid = ''; set role anon;`);
  await refuse(`select * from public.cours`, [], /permission denied/, "anon : lecture");
  await service();
  await q(`insert into public.cours (isin, date, cloture, source) values ('X-BTC', '2026-10-10', 53000, 'yahoo')
    on conflict (isin, date) do update set cloture = excluded.cloture, source = excluded.source`);
  await q(`insert into public.cours (isin, date, cloture, source) values ('X-BTC', '2026-10-10', 53100, 'yahoo')
    on conflict (isin, date) do update set cloture = excluded.cloture, source = excluded.source`);
  assert.equal(Number((await un(`select cloture from public.cours where isin = 'X-BTC' and date = '2026-10-10'`)).cloture), 53100, "upsert du service");
  await q(`update public.instruments set cours_rattrapage_le = now() where isin = 'LU0000000000'`);
  await q(`update public.instruments set cours_rattrapage_le = null where isin = 'LU0000000000'`);
  await comme(db, A);
  await refuse(`update public.instruments set cours_rattrapage_le = now()`, [], /permission denied/, "authenticated : instruments.cours_rattrapage_le");
});

test("PGlite : cours_a_rattraper — ISIN détenus (lignes non clôturées) avec moins de 30 cours, jamais tentés ou tentés il y a plus de 7 jours", async () => {
  await service();
  // FR0010315770 : 30 cours → complet ; X-BTC : 2 cours ; IE00B4L5Y983 / X-ETH-EUR / FR0000120271 : aucun ; US0378331005 : ligne
  // clôturée ; X-SANS (ni symbole ni vrai ISIN) et US5949181045 (sans symbole, hors EUR : pas de repli Euronext) : introuvables
  await q(`insert into public.cours (isin, date, cloture, source)
    select 'FR0010315770', d::date, 500, 'yahoo' from generate_series('2026-08-01'::date, '2026-08-29'::date, interval '1 day') d
    on conflict do nothing`);
  assert.equal((await un(`select count(*)::int n from public.cours where isin = 'FR0010315770'`)).n, 30);
  let r = await q(`select * from public.cours_a_rattraper(10)`);
  assert.deepEqual(r.map(x => x.isin).sort(), ["FR0000120271", "IE00B4L5Y983", "X-BTC", "X-ETH-EUR"]);
  const btc = r.find(x => x.isin === "X-BTC");
  assert.deepEqual({ ...btc }, { isin: "X-BTC", symbol: "BTC-EUR", currency: "EUR", nb_cours: 2 });
  assert.equal(r[r.length - 1].isin, "X-BTC", "les ISIN sans aucun cours d'abord");
  assert.equal((await q(`select * from public.cours_a_rattraper(2)`)).length, 2, "limite respectée");
  // tentative récente : écarté 7 jours ; tentative ancienne : de nouveau proposé
  await q(`update public.instruments set cours_rattrapage_le = now() - interval '1 day' where isin = 'IE00B4L5Y983'`);
  await q(`update public.instruments set cours_rattrapage_le = now() - interval '8 days' where isin = 'X-ETH-EUR'`);
  r = await q(`select * from public.cours_a_rattraper(10)`);
  assert.deepEqual(r.map(x => x.isin).sort(), ["FR0000120271", "X-BTC", "X-ETH-EUR"]);
  assert.equal(r.findIndex(x => x.isin === "X-ETH-EUR") > r.findIndex(x => x.isin === "FR0000120271"), true, "jamais tentés avant les tentatives anciennes");
  // droits : service_role seulement
  for (const role of ["authenticated", "anon"]) {
    await db.exec(`reset role; set test.uid = '${A}'; set role ${role};`);
    await refuse(`select * from public.cours_a_rattraper(10)`, [], /permission denied/, role);
  }
  await superu();
  const p = await un(`select prosecdef s, proconfig c from pg_proc where proname = 'cours_a_rattraper'`);
  assert.equal(p.s, true, "security definer");
  assert.deepEqual(p.c, ['search_path=""'], "search_path vide");
});

test("PGlite : fonctionnalites accepte « binance » (et toujours « banque ») ; positions.source_auto accepte « binance » (et « powens »)", async () => {
  await superu();
  await q(`insert into public.fonctionnalites (user_id, cle, active) values ('${A}', 'banque', true), ('${A}', 'binance', true)`);
  await refuse(`insert into public.fonctionnalites (user_id, cle) values ('${B}', 'bourse')`, [], /fonctionnalites_cle/, "clé inconnue");
  const pos = await un(`select id from public.positions where user_id = '${A}' and isin = 'X-BTC'`);
  await q(`update public.positions set source_auto = 'binance', source_auto_le = now() where id = $1`, [pos.id]);
  await q(`update public.positions set source_auto = 'powens' where id = $1`, [pos.id]);
  await q(`update public.positions set source_auto = null where id = $1`, [pos.id]);
  await refuse(`update public.positions set source_auto = 'manuel' where id = $1`, [pos.id], /positions_source_auto/, "source_auto hors liste");
  // l'utilisateur lit son interrupteur, ne l'active pas lui-même
  await comme(db, A);
  assert.deepEqual((await q(`select cle from public.fonctionnalites order by cle`)).map(r => r.cle), ["banque", "binance"]);
  await refuse(`insert into public.fonctionnalites (cle, active) values ('binance', true)`, [], /permission denied/, "authenticated : activation");
  await comme(db, B);
  assert.equal((await q(`select * from public.fonctionnalites`)).length, 0, "B ne voit pas l'interrupteur de A");
  await superu();
  const d = await un(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'positions_source_auto'`);
  assert.match(d.d, /powens/); assert.match(d.d, /binance/);
});

test("PGlite : apply_recurring — versement vers une ligne synchronisée ignoré (rien d'écrit, lastApplied inchangé) ; ligne manuelle appliquée comme avant", async () => {
  await superu();
  const J0 = "2026-10-15";
  await q(`update public.instruments set price = 50000, price_date = $1 where isin = 'X-BTC'`, [J0]);
  await q(`update public.instruments set price = 500, price_date = $1 where isin = 'FR0010315770'`, [J0]);
  const sync = await un(`insert into public.positions (user_id, name, envelope, mode, isin, qty, status, source_auto, source_auto_le)
    values ('${A}', 'Bitcoin synchronisé', 'Crypto (Binance)', 'market', 'X-BTC', 0.5, 'actif', 'binance', now()) returning id`);
  const powens = await un(`insert into public.positions (user_id, name, envelope, mode, value, status, source_auto)
    values ('${A}', 'Livret synchronisé', 'Livrets', 'manual', 1000, 'actif', 'powens') returning id`);
  const manu = await un(`select id from public.positions where user_id = '${A}' and isin = 'FR0010315770'`);
  const rec = [
    { id: "r-sync", label: "BTC mensuel", positionId: sync.id, amount: 100, day: 15 },
    { id: "r-powens", label: "Livret mensuel", positionId: powens.id, amount: 50, day: 15 },
    { id: "r-manu", label: "PEA mensuel", positionId: manu.id, amount: 1000, day: 15 },
  ];
  await q(`insert into public.config (user_id, recurring) values ('${A}', $1::jsonb)
    on conflict (user_id) do update set recurring = excluded.recurring`, [JSON.stringify(rec)]);
  await service();
  assert.equal((await un(`select public.apply_recurring($1::date, '${A}') n`, [J0])).n, 1, "seul le versement vers la ligne manuelle est appliqué");
  await superu();
  assert.equal(Number((await un(`select qty from public.positions where id = $1`, [sync.id])).qty), 0.5, "ligne Binance intacte");
  assert.equal(Number((await un(`select value from public.positions where id = $1`, [powens.id])).value), 1000, "ligne Powens intacte");
  assert.equal(Number((await un(`select qty from public.positions where id = $1`, [manu.id])).qty), 12, "10 + 1000 / 500");
  const tx = await q(`select position_id, amount from public.transactions where user_id = '${A}' and type = 'programme'`);
  assert.deepEqual(tx.map(t => [t.position_id, Number(t.amount)]), [[manu.id, 1000]]);
  const cfg = (await un(`select recurring from public.config where user_id = '${A}'`)).recurring;
  assert.deepEqual(cfg.map(r => [r.id, r.lastApplied ?? null]), [["r-sync", null], ["r-powens", null], ["r-manu", "2026-10"]]);
  const alertes = (await un(`select alerts from public.status where user_id = '${A}'`))?.alerts ?? [];
  assert.equal(alertes.filter(a => a.kind === "recurring").length, 0, "aucune alerte pour un versement ignoré");
  // la ligne n'est plus synchronisée : le versement reprend
  await q(`update public.positions set source_auto = null where id = $1`, [sync.id]);
  await service();
  assert.equal((await un(`select public.apply_recurring($1::date, '${A}') n`, [J0])).n, 1, "reprise sur la ligne désynchronisée");
  await superu();
  assert.equal(Number((await un(`select qty from public.positions where id = $1`, [sync.id])).qty), 0.502);
  for (const role of ["authenticated", "anon"]) {
    await db.exec(`reset role; set test.uid = '${A}'; set role ${role};`);
    await refuse(`select public.apply_recurring()`, [], /permission denied/, role);
  }
  await superu();
});
