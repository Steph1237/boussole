// Suite de la relecture CP4 (docs/superpowers/specs/2026-10-12-cp4-sante-design.md § 2 et § 6) exercée sur un vrai PostgreSQL (PGlite,
// en mémoire) : migrations 0001 → 0026 appliquées sur les bouchons Supabase (test/helpers/pglite.mjs, baseComplete), données de départ,
// puis 0027. Couvre instruments.ter_par (annotateur du TER tiré d'un DIC, écrit par annoter_instrument), frais_a_chercher (TER « dic »
// de plus de 365 jours retenus, valeur actuelle renvoyée), et frais_enveloppes.le jamais dans le futur (appliquer_propositions, repartie
// de 0026). Aucun réseau ni secret réel.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { baseComplete, comme } from "./helpers/pglite.mjs";

const SQL = readFileSync(new URL("../supabase/migrations/0027_frais_suite.sql", import.meta.url), "utf8");
const SQL_0026 = readFileSync(new URL("../supabase/migrations/0026_frais.sql", import.meta.url), "utf8");
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const superu = () => db.exec(`reset role; set test.uid = '';`);
const service = () => db.exec(`reset role; set test.uid = ''; set role service_role;`);
const I = { neuf: "IE00B4L5Y983", dicAncien: "LU0908500753", dicRecent: "LU1681043599", yahooAncien: "IE00BK5BQT80", action: "FR0000120271" };

before(async () => {
  db = await baseComplete("0026_frais.sql");
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
    insert into public.instruments (isin, symbol, name, currency, ter, ter_source, ter_le) values
      ('${I.neuf}', 'IWDA.AS', 'iShares Core MSCI World UCITS ETF', 'EUR', null, null, null),
      ('${I.dicAncien}', 'MEUD.PA', 'Amundi Stoxx Europe 600', 'EUR', 0.07, 'dic', current_date - 400),
      ('${I.dicRecent}', 'CW8D.PA', 'Amundi MSCI World', 'EUR', 0.12, 'dic', current_date - 30),
      ('${I.yahooAncien}', 'VWCE.DE', 'Vanguard FTSE All-World', 'EUR', 0.22, 'yahoo', current_date - 200),
      ('${I.action}', 'TTE.PA', 'TotalEnergies', 'EUR', null, null, null);
    insert into public.positions (user_id, name, envelope, mode, isin, qty, status) values
      ('${A}', 'World', 'PEA', 'market', '${I.neuf}', 1, 'actif'), ('${A}', 'Europe', 'PEA', 'market', '${I.dicAncien}', 1, 'actif'),
      ('${A}', 'World D', 'CTO', 'market', '${I.dicRecent}', 1, 'actif'), ('${B}', 'All-World', 'CTO', 'market', '${I.yahooAncien}', 1, 'actif'),
      ('${B}', 'Total', 'CTO', 'market', '${I.action}', 1, 'actif');`);
  await db.exec(SQL.replace(/^create extension[^;]*;/gim, ""));
});
after(async () => { await db.close(); });

test("migration 0027 : en-tête (non appliquée, apply_migration name = frais_suite, 0026 inchangée), tutoiement, aucun secret", () => {
  assert.match(SQL, /^-- Boussole : frais des supports, suite de la relecture CP4/);
  assert.match(SQL, /Non appliquée : à appliquer avec apply_migration \(name = "frais_suite"\)/);
  assert.match(SQL, /après 0026 \(déjà en\n-- production, inchangée\)/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(SQL, /sb_secret_|eyJhbGci/);
});

test("PGlite : instruments.ter_par (uuid, null) ; annoter_instrument l'écrit avec un TER, pas avec une zone seule ; rejouable", async () => {
  await superu();
  const col = await un(`select data_type t, is_nullable n from information_schema.columns where table_schema = 'public' and table_name = 'instruments' and column_name = 'ter_par'`);
  assert.deepEqual([col?.t, col?.n], ["uuid", "YES"]);
  await comme(db, A);
  const r = await un(`select (public.annoter_instrument('${I.neuf}', 0.2, null, null, 'DIC iShares du 2026-02-14')).ter_par p`);
  assert.equal(r.p, A, "la ligne renvoyée porte l'annotateur");
  await superu();
  assert.deepEqual(await un(`select ter::float8 ter, ter_source, ter_par from public.instruments where isin = '${I.neuf}'`), { ter: 0.2, ter_source: "dic", ter_par: A });
  await comme(db, A);
  await q(`select public.annoter_instrument('${I.neuf}', null, 'Monde', null, 'Site de l''émetteur')`);
  await superu();
  assert.equal((await un(`select ter_par from public.instruments where isin = '${I.neuf}'`)).ter_par, A, "zone seule : annotateur du TER inchangé");
  assert.equal((await un(`select ter_par from public.instruments where isin = '${I.dicAncien}'`)).ter_par, null, "TER annoté avant 0027 : annotateur inconnu");
  await db.exec(SQL.replace(/^create extension[^;]*;/gim, ""));
  await db.exec(`update public.instruments set ter = null, ter_source = null, ter_le = null, ter_par = null where isin = '${I.neuf}'`);
});

test("PGlite : frais_a_chercher — TER « dic » de plus de 365 jours retenu, récent écarté ; ter, ter_source, ter_le renvoyés ; service_role seul", async () => {
  await service();
  const L = await q(`select isin, symbol, ter::float8 ter, ter_source, ter_le::text ter_le from public.frais_a_chercher(10)`);
  const isins = L.map(r => r.isin);
  assert.ok(isins.includes(I.dicAncien), "DIC de plus d'un an : à comparer à Yahoo");
  assert.ok(!isins.includes(I.dicRecent), "DIC récent : écarté");
  assert.ok(isins.includes(I.neuf) && isins.includes(I.yahooAncien) && isins.includes(I.action));
  const d = L.find(r => r.isin === I.dicAncien);
  assert.deepEqual([d.symbol, d.ter, d.ter_source], ["MEUD.PA", 0.07, "dic"]);
  assert.match(d.ter_le, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(L[0]).sort(), ["isin", "symbol", "ter", "ter_le", "ter_source"]);
  await comme(db, A);
  await assert.rejects(db.query(`select * from public.frais_a_chercher(10)`), /permission denied/);
  await superu();
});

/* ---------- appliquer_propositions : frais_enveloppes.le ---------- */
const proposer = async apres => (await q(`insert into public.propositions (cible, operation, apres, source) values ('config', 'modifier', $1, 'Conditions générales du contrat') returning id`,
  [JSON.stringify(apres)]))[0].id;
const appliquer = async (ids, mods) => (await q("select public.appliquer_propositions($1::uuid[], $2::jsonb) n", [ids, JSON.stringify(mods ?? {})]))[0].n;

test("PGlite : frais_enveloppes.le dans le futur refusé (même corrigé à la validation) ; aujourd'hui et passé acceptés", async () => {
  await comme(db, A);
  const today = (await un(`select (now() at time zone 'Europe/Paris')::date::text d`)).d;
  const demain = (await un(`select ((now() at time zone 'Europe/Paris')::date + 1)::text d`)).d;
  const futur = await proposer({ frais_enveloppes: { "Assurance-vie": { gestion_uc_pct: 0.5, source: "CG", le: demain } } });
  await assert.rejects(appliquer([futur]), e => /^Proposition non appliquée \(réglages, modifier\) : frais_enveloppes « Assurance-vie » : date \(le\) dans le futur/.test(e.message));
  assert.equal((await un("select statut from public.propositions where id = $1", [futur])).statut, "en_attente");
  const ok = await proposer({ frais_enveloppes: { "Assurance-vie": { gestion_uc_pct: 0.5, source: "CG", le: "2026-01-15" } } });
  await assert.rejects(appliquer([ok], { [ok]: { frais_enveloppes: { "Assurance-vie": { gestion_uc_pct: 0.5, source: "CG", le: demain } } } }), /dans le futur/, "corrigé à la validation : contrôlé aussi");
  assert.equal(await appliquer([ok]), 1);
  const auj = await proposer({ frais_enveloppes: { "PER": { gestion_uc_pct: 0.7, source: "Notice", le: today } } });
  assert.equal(await appliquer([auj]), 1);
  assert.deepEqual((await un(`select frais_enveloppes f from public.config where user_id = $1`, [A])).f,
    { "Assurance-vie": { gestion_uc_pct: 0.5, source: "CG", le: "2026-01-15" }, PER: { gestion_uc_pct: 0.7, source: "Notice", le: today } });
});

test("0027 repart exactement de 0026 : annoter_instrument (ter_par en plus) et appliquer_propositions (contrôle de la date en plus)", async () => {
  const corps = (sql, nom) => {
    const i = sql.indexOf("create or replace function public." + nom + "(");
    assert.ok(i >= 0, nom);
    return sql.slice(i, sql.indexOf("\n$$;", i)).split("\n");
  };
  for (const [nom, ajout] of [["annoter_instrument", ["         ter_par       = case when p_ter is not null then auth.uid() else i.ter_par end"]],
    ["appliquer_propositions", ["              if v_le > (now() at time zone 'Europe/Paris')::date then",
      "                raise exception 'frais_enveloppes « % » : date (le) dans le futur (la date du document consulté est attendue)', v_env;", "              end if;"]]]) {
    const avant = corps(SQL_0026, nom), apres = corps(SQL, nom);
    const retirees = avant.filter(l => !apres.includes(l)), ajoutees = apres.filter(l => !avant.includes(l));
    if (nom === "annoter_instrument") {
      assert.deepEqual(retirees.map(l => l.trim()), ["ter_le        = case when p_ter is not null then (now() at time zone 'Europe/Paris')::date else i.ter_le end"], nom + " : virgule ajoutée seulement");
      assert.deepEqual(ajoutees.map(l => l.trim()), ["ter_le        = case when p_ter is not null then (now() at time zone 'Europe/Paris')::date else i.ter_le end,", ...ajout.map(l => l.trim())]);
    } else {
      assert.deepEqual(retirees, [], nom + " : aucune ligne de 0026 retirée");
      assert.deepEqual(ajoutees.filter(l => l.trim() !== "end if;").map(l => l.trim()), ajout.filter(l => l.trim() !== "end if;").map(l => l.trim()));
    }
    let j = 0;
    for (const l of avant.filter(l => apres.includes(l))) { j = apres.indexOf(l, j); assert.ok(j >= 0, nom + " : ordre " + l); j++; }
  }
  // aucune autre migration après 0027 ne redéfinit ces fonctions (hors 0029, qui repart de 0027 pour appliquer_propositions : calendrier-pglite, 0031 qui repart de 0029 : projection-pglite, 0032 qui repart de 0031 : suivi-pglite, 0034 qui repart de 0032 : historique-pglite, et 0035 qui repart de 0034 : budget-pglite)
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const apres = readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f) && f > "0027_frais_suite.sql")
    .filter(f => /function\s+public\.(appliquer_propositions|annoter_instrument|frais_a_chercher)\s*\(/.test(readFileSync(new URL(f, dir), "utf8")));
  assert.deepEqual(apres, ["0029_calendrier.sql", "0031_projection.sql", "0032_suivi.sql", "0034_historique.sql", "0035_budget.sql"]);
  await superu();
  const f = await un(`select p.prosecdef s, p.proconfig c, has_function_privilege('anon', p.oid, 'execute') anon,
    has_function_privilege('authenticated', p.oid, 'execute') auth from pg_proc p where p.oid = 'public.appliquer_propositions(uuid[], jsonb)'::regprocedure`);
  assert.deepEqual([f.s, f.c, f.anon, f.auth], [false, ["search_path=\"\""], false, true]);
});
