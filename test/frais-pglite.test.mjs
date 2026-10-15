// Frais des supports (CP4, docs/superpowers/specs/2026-10-12-cp4-sante-design.md § 2 et § 6) exercés sur un vrai PostgreSQL
// (PGlite, en mémoire) : migrations 0001 → 0025 appliquées sur les bouchons Supabase (test/helpers/pglite.mjs, baseComplete),
// données de départ, puis 0026. Couvre les colonnes instruments.ter_source / ter_le / ter_essai_le (TER existant en % par an
// inchangé, TER déjà annoté repris comme « dic »), annoter_instrument (un TER tiré d'un DIC passe en « dic »), la sélection de la
// fonction nocturne (frais_a_chercher, réservée à service_role) et la clé frais_enveloppes de la cible config
// d'appliquer_propositions (repartie de 0019). Aucun réseau ni secret réel.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { baseComplete, comme } from "./helpers/pglite.mjs";

const SQL = readFileSync(new URL("../supabase/migrations/0026_frais.sql", import.meta.url), "utf8");
const SQL_0019 = readFileSync(new URL("../supabase/migrations/0019_propositions_reglages.sql", import.meta.url), "utf8");
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const refuse = async (s, p, motif, m) => {
  await assert.rejects(db.query(s, p), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
};
const superu = () => db.exec(`reset role; set test.uid = '';`);
const service = () => db.exec(`reset role; set test.uid = ''; set role service_role;`);
const instrument = isin => un(`select ter::float8 ter, ter_source, ter_le::text ter_le, ter_essai_le from public.instruments where isin = $1`, [isin]);

// ISIN de la sélection (frais_a_chercher)
const F = {
  monde: "IE00B4L5Y983",      // ETF détenu, sans TER : retenu
  europe: "LU0908500753",     // TER Yahoo de plus de 180 jours : retenu (rafraîchi)
  recent: "LU1681043599",     // TER Yahoo récent : écarté
  dic: "FR0010315770",        // TER déjà annoté (DIC) avant 0026 : écarté
  essaiRecent: "IE00BK5BQT80",// essai il y a 10 jours : écarté
  essaiAncien: "IE00B3RBWM25",// essai il y a 40 jours : retenu
  uc: "FR0010135103",         // unité de compte saisie à la main (mode manual) : retenue, avant l'action
  action: "FR0000120271",     // action détenue en direct, sans TER : retenue en dernier (Yahoo n'y trouve pas de frais)
  clos: "IE00B5BMR087",       // ligne clôturée : écarté
  sansSymbole: "LU0274208692",// sans symbole Yahoo : écarté
  nonDetenu: "IE00BFY0GT14",  // personne ne le détient : écarté
};

before(async () => {
  db = await baseComplete("0025_banque_mois_compte.sql");
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
    insert into public.instruments (isin, symbol, name, currency, ter, annote_source, annote_le) values
      ('${F.monde}', 'IWDA.AS', 'iShares Core MSCI World UCITS ETF', 'EUR', null, null, null),
      ('${F.europe}', 'MEUD.PA', 'Amundi Stoxx Europe 600', 'EUR', null, null, null),
      ('${F.recent}', 'CW8D.PA', 'Amundi MSCI World', 'EUR', null, null, null),
      ('${F.dic}', 'CW8.PA', 'Amundi MSCI World', 'EUR', 0.38, 'DIC Amundi', '2026-09-01T10:00:00Z'),
      ('${F.essaiRecent}', 'VWCE.DE', 'Vanguard FTSE All-World', 'EUR', null, null, null),
      ('${F.essaiAncien}', 'EIMI.L', 'iShares Core EM IMI', 'EUR', null, null, null),
      ('${F.uc}', '0P00000FB2.F', 'Carmignac Patrimoine A', 'EUR', null, null, null),
      ('${F.action}', 'TTE.PA', 'TotalEnergies', 'EUR', null, null, null),
      ('${F.clos}', 'CSPX.AS', 'iShares Core S&P 500', 'EUR', null, null, null),
      ('${F.sansSymbole}', null, 'Fonds sans symbole', 'EUR', null, null, null),
      ('${F.nonDetenu}', 'XDWD.DE', 'Xtrackers MSCI World', 'EUR', null, null, null),
      ('X-BTC', 'BTC-EUR', 'Bitcoin', 'EUR', null, null, null);
    insert into public.positions (user_id, name, envelope, mode, isin, qty, value, status) values
      ('${A}', 'World', 'PEA', 'market', '${F.monde}', 10, null, 'actif'),
      ('${A}', 'Europe', 'PEA', 'market', '${F.europe}', 1, null, 'actif'),
      ('${A}', 'World D', 'CTO', 'market', '${F.recent}', 1, null, 'actif'),
      ('${A}', 'World C', 'PEA', 'market', '${F.dic}', 1, null, 'actif'),
      ('${B}', 'All-World', 'CTO', 'market', '${F.essaiRecent}', 1, null, 'actif'),
      ('${B}', 'Émergents', 'CTO', 'market', '${F.essaiAncien}', 1, null, 'actif'),
      ('${B}', 'Patrimoine', 'Assurance-vie', 'manual', '${F.uc}', null, 1000, 'actif'),
      ('${B}', 'Total', 'CTO', 'market', '${F.action}', 2, null, 'actif'),
      ('${B}', 'S&P 500', 'CTO', 'market', '${F.clos}', 0, null, 'clôturé'),
      ('${B}', 'Fonds', 'CTO', 'market', '${F.sansSymbole}', 1, null, 'actif'),
      ('${B}', 'Bitcoin', 'Crypto', 'market', 'X-BTC', 1, null, 'actif');`);
  await db.exec(SQL.replace(/^create extension[^;]*;/gim, ""));
  await db.exec(`update public.instruments set ter = 0.2, ter_source = 'yahoo', ter_le = current_date - 200, ter_essai_le = now() - interval '200 days' where isin = '${F.europe}';
    update public.instruments set ter = 0.12, ter_source = 'yahoo', ter_le = current_date - 20, ter_essai_le = now() - interval '20 days' where isin = '${F.recent}';
    update public.instruments set ter_essai_le = now() - interval '10 days' where isin = '${F.essaiRecent}';
    update public.instruments set ter_essai_le = now() - interval '40 days' where isin = '${F.essaiAncien}';`);
});
after(async () => { await db.close(); });

test("migration 0026 : en-tête (non appliquée, apply_migration name = frais), tutoiement, aucun secret", () => {
  assert.match(SQL, /^-- Boussole : frais des supports/);
  assert.match(SQL, /à appliquer avec apply_migration \(name = "frais"\)/);
  assert.match(SQL, /Non appliquée/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(SQL, /sb_secret_|eyJhbGci/);
});

test("PGlite : colonnes instruments ter_source / ter_le / ter_essai_le ; ter inchangé (% par an, 0 à 10) ; config.frais_enveloppes", async () => {
  await superu();
  const cols = Object.fromEntries((await q(`select column_name c, data_type t from information_schema.columns
    where table_schema = 'public' and table_name = 'instruments' and column_name like 'ter%'`)).map(r => [r.c, r.t]));
  assert.deepEqual(cols, { ter: "numeric", ter_source: "text", ter_le: "date", ter_essai_le: "timestamp with time zone" });
  const checks = (await q(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.instruments'::regclass and contype = 'c'`)).map(r => r.d).join(" | ");
  assert.match(checks, /ter >= \(?0/, "contrôle de 0006 conservé");
  assert.match(checks, /ter <= \(?10/, "contrôle de 0006 conservé");
  await refuse(`update public.instruments set ter_source = 'morningstar' where isin = '${F.monde}'`, [], /instruments_ter_source/, "source inconnue");
  await refuse(`update public.instruments set ter = 12 where isin = '${F.monde}'`, [], /check constraint/, "TER au-delà de 10 %");
  const cfg = await un(`select data_type t, is_nullable n, column_default d from information_schema.columns
    where table_schema = 'public' and table_name = 'config' and column_name = 'frais_enveloppes'`);
  assert.deepEqual([cfg?.t, cfg?.n], ["jsonb", "NO"]);
  assert.match(cfg.d, /'\{\}'::jsonb/);
  // la migration est rejouable
  await db.exec(SQL.replace(/^create extension[^;]*;/gim, ""));
});

test("PGlite : TER déjà annoté avant 0026 repris comme « dic » (date de l'annotation) ; les autres restent sans source", async () => {
  await superu();
  assert.deepEqual(await instrument(F.dic), { ter: 0.38, ter_source: "dic", ter_le: "2026-09-01", ter_essai_le: null });
  assert.deepEqual(await instrument(F.monde), { ter: null, ter_source: null, ter_le: null, ter_essai_le: null });
});

test("PGlite : annoter_instrument — un TER tiré d'un DIC passe en « dic » (même par-dessus Yahoo) ; zone seule : source du TER inchangée", async () => {
  await superu();
  await db.exec(`insert into public.instruments (isin, symbol, currency, ter, ter_source, ter_le) values ('IE00B0M62Q58', 'IQQW.DE', 'EUR', 0.5, 'yahoo', '2026-01-01');
    insert into public.positions (user_id, name, envelope, mode, isin, qty, status) values ('${A}', 'Monde dist', 'CTO', 'market', 'IE00B0M62Q58', 1, 'actif');`);
  await comme(db, A);
  await q(`select public.annoter_instrument('IE00B0M62Q58', null, 'Monde', null, 'Site de l''émetteur')`);
  let i = await instrument("IE00B0M62Q58");
  assert.deepEqual([i.ter, i.ter_source, i.ter_le], [0.5, "yahoo", "2026-01-01"], "zone seule : TER Yahoo intact");
  await q(`select public.annoter_instrument('IE00B0M62Q58', 0.5, null, null, 'DIC iShares du 2026-02-14')`);
  const today = (await un(`select (now() at time zone 'Europe/Paris')::date::text d`)).d;
  i = await instrument("IE00B0M62Q58");
  assert.deepEqual([i.ter, i.ter_source, i.ter_le], [0.5, "dic", today], "même valeur, mais désormais tirée du DIC");
  const r = await un(`select (public.annoter_instrument('${F.monde}', 0.2, null, null, 'DIC iShares')).ter_source s`);
  assert.equal(r.s, "dic", "la ligne renvoyée porte la source");
  await refuse(`select public.annoter_instrument('${F.essaiRecent}', 0.2, null, null, 'DIC')`, [], /non détenu/, "toujours réservé aux détenteurs");
  await superu();
  await db.exec(`update public.instruments set ter = null, ter_source = null, ter_le = null where isin = '${F.monde}'`);
});

test("PGlite : frais_a_chercher — fonds détenus sans TER ou TER Yahoo > 180 j, essai > 30 j ; fonds d'abord ; au plus 10 ; service_role seul", async () => {
  await service();
  const isins = (await q(`select isin, symbol from public.frais_a_chercher(10)`));
  assert.deepEqual(isins.map(r => r.isin), [F.uc, F.monde, F.europe, F.essaiAncien, F.action],
    "fonds jamais essayés (par ISIN), puis essais les plus anciens ; l'action (ni IE/LU, ni nom de fonds, ni saisie manuelle) en dernier");
  assert.equal(isins.find(r => r.isin === F.monde).symbol, "IWDA.AS");
  assert.equal((await q(`select * from public.frais_a_chercher(2)`)).length, 2);
  assert.equal((await q(`select * from public.frais_a_chercher(50)`)).length, 5, "plafond de 10, ici 5 candidats");
  assert.equal((await q(`select * from public.frais_a_chercher(0)`)).length, 0);
  // plafond de 10 par nuit, même si l'appelant en demande plus
  await superu();
  for (let k = 0; k < 12; k++) {
    const isin = `IE00000000${String(k).padStart(2, "0")}`;
    await db.exec(`insert into public.instruments (isin, symbol, currency) values ('${isin}', 'T${k}.PA', 'EUR');
      insert into public.positions (user_id, name, envelope, mode, isin, qty, status) values ('${B}', 'ETF ${k}', 'CTO', 'market', '${isin}', 1, 'actif');`);
  }
  await service();
  assert.equal((await q(`select * from public.frais_a_chercher(50)`)).length, 10);
  // droits : ni authenticated ni anon
  await comme(db, A);
  await refuse(`select * from public.frais_a_chercher(10)`, [], /permission denied/, "authenticated");
  await db.exec(`reset role; set role anon;`);
  await refuse(`select * from public.frais_a_chercher(10)`, [], /permission denied/, "anon");
  await superu();
  await db.exec(`delete from public.positions where isin like 'IE00000000%'; delete from public.instruments where isin like 'IE00000000%';`);
});

/* ---------- appliquer_propositions : frais_enveloppes ---------- */
const proposer = async apres => (await q(`insert into public.propositions (cible, operation, apres, source) values ('config', 'modifier', $1, 'Conditions générales du contrat') returning id`,
  [JSON.stringify(apres)]))[0].id;
const appliquer = async (ids, mods) => (await q("select public.appliquer_propositions($1::uuid[], $2::jsonb) n", [ids, JSON.stringify(mods ?? {})]))[0].n;
const fraisEnv = async () => (await un(`select frais_enveloppes f from public.config where user_id = $1`, [A])).f;
const statut = async id => (await un("select statut from public.propositions where id = $1", [id])).statut;

test("PGlite : frais_enveloppes appliqués (valeurs normalisées, date du jour par défaut), fusionnés par enveloppe, null retire", async () => {
  await comme(db, A);
  const today = (await un(`select (now() at time zone 'Europe/Paris')::date::text d`)).d;
  const id = await proposer({ frais_enveloppes: {
    " Assurance-vie Linxea ": { gestion_uc_pct: 0.5, gestion_euro_pct: "0.6", source: " Conditions générales 2026, art. 8 ", le: "2026-09-30" },
    "PEA Boursorama": { garde_pct: 0, source: "Grille tarifaire 2026" },
  } });
  assert.equal(await appliquer([id]), 1);
  assert.deepEqual(await fraisEnv(), {
    "Assurance-vie Linxea": { gestion_uc_pct: 0.5, gestion_euro_pct: 0.6, source: "Conditions générales 2026, art. 8", le: "2026-09-30" },
    "PEA Boursorama": { garde_pct: 0, source: "Grille tarifaire 2026", le: today },
  });
  assert.equal(await statut(id), "acceptee");
  // fusion : une enveloppe remplacée en entier, une ajoutée, une retirée ; avec un autre réglage dans la même proposition
  const id2 = await proposer({ cushion: { mode: "amount", min: 5000, max: null }, frais_enveloppes: {
    "Assurance-vie Linxea": { gestion_uc_pct: 0.6, source: "Avenant 2026" }, "PER Linxea": { gestion_uc_pct: 0.5, garde_pct: 0.1, source: "Notice PER" },
    "PEA Boursorama": null,
  } });
  assert.equal(await appliquer([id2]), 1);
  assert.deepEqual(await fraisEnv(), {
    "Assurance-vie Linxea": { gestion_uc_pct: 0.6, source: "Avenant 2026", le: today },
    "PER Linxea": { gestion_uc_pct: 0.5, garde_pct: 0.1, source: "Notice PER", le: today },
  });
  assert.deepEqual((await un(`select cushion from public.config where user_id = $1`, [A])).cushion, { mode: "amount", min: 5000, max: null });
  // B n'est pas touché
  await db.exec(`reset role; set test.uid = '';`);
  assert.deepEqual((await un(`select frais_enveloppes f from public.config where user_id = $1`, [B]))?.f ?? {}, {});
});

test("PGlite : frais_enveloppes invalides refusés (pourcentages 0 à 5, source 1 à 300, 30 enveloppes), rien d'appliqué", async () => {
  await comme(db, A);
  const avant = await fraisEnv();
  const e = o => ({ frais_enveloppes: { "Assurance-vie": { gestion_uc_pct: 0.5, source: "CG", ...o } } });
  const trente = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`Contrat ${i}`, { gestion_uc_pct: 0.5, source: "CG" }]));
  const cas = [
    [e({ gestion_uc_pct: 5.01 }), /gestion_uc_pct invalide/, "plus de 5 %"],
    [e({ gestion_euro_pct: -0.1 }), /gestion_euro_pct invalide/, "négatif"],
    [e({ garde_pct: "abc" }), /garde_pct invalide/, "non numérique"],
    [e({ garde_pct: true }), /garde_pct invalide/, "booléen"],
    [e({ source: undefined }), /source obligatoire/, "source absente"],
    [e({ source: "  " }), /source obligatoire/, "source vide"],
    [e({ source: "x".repeat(301) }), /source obligatoire/, "source trop longue"],
    [e({ le: "30/09/2026" }), /date \(le\) invalide/, "date invalide"],
    [e({ frais_entree_pct: 2 }), /champ « frais_entree_pct » inconnu/, "champ inconnu"],
    [{ frais_enveloppes: { "Assurance-vie": { source: "CG" } } }, /au moins un pourcentage/, "aucun pourcentage"],
    [{ frais_enveloppes: { "Assurance-vie": { gestion_uc_pct: null, source: "CG" } } }, /au moins un pourcentage/, "pourcentage null"],
    [{ frais_enveloppes: { "Assurance-vie": 0.5 } }, /objet ou null attendu/, "pas un objet"],
    [{ frais_enveloppes: { " ": { gestion_uc_pct: 0.5, source: "CG" } } }, /nom d'enveloppe invalide/, "nom vide"],
    [{ frais_enveloppes: { ["x".repeat(81)]: { gestion_uc_pct: 0.5, source: "CG" } } }, /nom d'enveloppe invalide/, "nom trop long"],
    [{ frais_enveloppes: [] }, /frais_enveloppes : objet/, "liste"],
    [{ frais_enveloppes: trente(31) }, /30 enveloppes au plus/, "31 enveloppes"],
    [{ frais_enveloppes: trente(29) }, /30 enveloppes au plus/, "29 nouvelles + 2 existantes"],
    [{ rules: [] }, /réglage « rules » non modifiable/, "clé hors liste (inchangé)"],
    [{}, /cushion ou recurring attendu/, "objet vide (message de 0019 conservé)"],
  ];
  for (const [apres, motif, m] of cas) {
    const id = await proposer(apres);
    await assert.rejects(appliquer([id]), err => { assert.match(err.message, motif, m + " : " + err.message); return true; }, m + " : accepté");
    await assert.rejects(appliquer([id]), err => { assert.match(err.message, /^Proposition non appliquée \(réglages, modifier\) : /, m + " (préfixe)"); return true; });
    assert.equal(await statut(id), "en_attente", m);
    await q("select public.refuser_propositions($1::uuid[])", [[id]]);
  }
  assert.deepEqual(await fraisEnv(), avant);
  // 28 nouvelles + 2 existantes = 30 : accepté ; bornes 0 et 5 acceptées
  const ok = await proposer({ frais_enveloppes: { ...trente(27), "Bornes": { gestion_uc_pct: 0, gestion_euro_pct: 5, source: "CG" } } });
  assert.equal(await appliquer([ok]), 1);
  assert.equal(Object.keys(await fraisEnv()).length, 30);
});

test("0026 repart exactement d'appliquer_propositions de 0019 : seules les lignes de la liste des clés de config changent", async () => {
  const corps = sql => {
    const i = sql.indexOf("create or replace function public.appliquer_propositions(");
    assert.ok(i >= 0);
    return sql.slice(i, sql.indexOf("\n$$;", i)).split("\n");
  };
  const avant = corps(SQL_0019), apres = corps(SQL);
  const retirees = avant.filter(l => !apres.includes(l));
  assert.deepEqual(retirees.map(l => l.trim().slice(0, 30)), [
    "select k into v_key from jsonb",
    "if v_key is not null then rais",
    "if not (v ? 'cushion' or v ? '",
  ], "lignes de 0019 modifiées : la liste blanche des clés de config, rien d'autre");
  // ordre conservé : les lignes de 0019 gardées apparaissent dans le même ordre
  let j = 0;
  for (const l of avant.filter(l => apres.includes(l))) { j = apres.indexOf(l, j); assert.ok(j >= 0, l); j++; }
  // aucune autre migration après 0019 ne redéfinit la fonction (hors 0026, 0027 qui repart exactement de 0026 : frais-suite-pglite, 0029 qui repart de 0027 : calendrier-pglite, 0031 qui repart de 0029 : projection-pglite, 0032 qui repart de 0031 : suivi-pglite, et 0034 qui repart de 0032 : historique-pglite)
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const redefinie = readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f) && f > "0019" && !f.startsWith("0019") && !f.startsWith("0026") && !f.startsWith("0027") && !f.startsWith("0029") && !f.startsWith("0031") && !f.startsWith("0032") && !f.startsWith("0034"))
    .filter(f => /function\s+public\.appliquer_propositions\s*\(/.test(readFileSync(new URL(f, dir), "utf8")));
  assert.deepEqual(redefinie, []);
  await superu();
  const f = await un(`select p.prosecdef s, p.proconfig c, has_function_privilege('anon', p.oid, 'execute') anon,
    has_function_privilege('authenticated', p.oid, 'execute') auth from pg_proc p where p.oid = 'public.appliquer_propositions(uuid[], jsonb)'::regprocedure`);
  assert.deepEqual([f.s, f.c, f.anon, f.auth], [false, ["search_path=\"\""], false, true]);
});
