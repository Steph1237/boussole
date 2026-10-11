// Routines (RT1, revue mensuelle) exercées sur un vrai PostgreSQL (PGlite, en mémoire) : migrations 0009 → 0016 puis 0020
// appliquées sur les bouchons Supabase (test/helpers/pglite.mjs). Couvre la RLS, routine_date, activer_routine, les
// déclencheurs (pause → activité, changement de jour), cloturer_routine (passage, idempotence sur la journée, validation des
// questions, contenu sensible, création si absente) et export_all. Aucun réseau ni secret : exécuté en CI (npm ci && npm test).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseAvec, comme } from "./helpers/pglite.mjs";

// 0015 et 0016 : public.jsonb_textes (0016), utilisée par la contrainte routines_contenu_sensible.
const MIGRATIONS = ["0009_savoir_memoire.sql", "0010_savoir_reperes.sql", "0011_savoir_fiches.sql", "0012_savoir_libelles.sql",
  "0013_journal.sql", "0014_journal_durcissement.sql", "0015_savoir_libelles_objectifs.sql", "0016_expertises.sql", "0020_routines.sql"];
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
const AUJ = `(now() at time zone 'Europe/Paris')::date`;
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const refuse = async (s, p, motif, m) => {
  await assert.rejects(db.query(s, p), e => { assert.match(e.message, motif, m); return true; }, m + " : accepté");
};
/** Date SQL (objet Date à minuit UTC renvoyé par PGlite, ou texte) → « AAAA-MM-JJ ». */
const jour = d => d == null ? null : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
const attendu = async (j, ecart) => jour((await un(`select public.routine_date($1, ${AUJ}, $2) d`, [j, ecart])).d);
const cloturer = (questions, o = {}) => un(`select * from public.cloturer_routine($1, $2, $3, $4::jsonb)`,
  [o.type ?? "revue_mensuelle", o.client ?? "Claude", o.synthese ?? "Patrimoine stable. Deux soldes à confirmer.", JSON.stringify(questions)]);
const Q = (question, extra = {}) => ({ question, ...extra });

before(async () => {
  db = await baseAvec(MIGRATIONS);
  await db.exec(`insert into auth.users values ('${A}'), ('${B}');
    grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
    -- tables bouchons lues par export_all (en production, leurs droits viennent de 0001)
    grant select on public.profiles, public.biens, public.credits, public.positions, public.transactions, public.snapshots, public.config,
      public.status, public.budgets, public.objectifs, public.propositions, public.connexions_assistant to authenticated;`);
  await comme(db, A);
});

test("migration 0020 : en-tête, tutoiement des messages (ni vous, ni votre, ni vos)", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0020_routines.sql", import.meta.url), "utf8");
  assert.match(sql, /^-- Boussole : routines/);
  assert.match(sql, /Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration \(name = "routines"\)/);
  assert.doesNotMatch(sql, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
});

test("PGlite : routine_date — premier jour J d'un mois au plus tôt à depuis + écart", async () => {
  const cas = [
    [1, "2026-10-11", 7, "2026-11-01"], [15, "2026-10-01", 7, "2026-10-15"], [28, "2026-12-25", 7, "2027-01-28"],
    // 28 décembre : le jour même (écart nul), puis passage d'année
    [28, "2026-12-28", 0, "2026-12-28"], [1, "2026-12-28", 7, "2027-02-01"], [28, "2026-12-21", 7, "2026-12-28"],
    [1, "2026-12-28", 10, "2027-02-01"], [5, "2026-12-28", 7, "2027-01-05"],
    // borne exacte : depuis + écart tombe sur le jour J
    [8, "2026-10-01", 7, "2026-10-08"], [1, "2026-10-25", 7, "2026-11-01"], [1, "2026-10-26", 7, "2026-12-01"],
  ];
  for (const [j, depuis, ecart, att] of cas)
    assert.equal(jour((await un(`select public.routine_date($1, $2::date, $3) d`, [j, depuis, ecart])).d), att, `(${j}, ${depuis}, ${ecart})`);
  await refuse(`select public.routine_date(31, '2026-10-01', 7)`, [], /entre 1 et 28/, "jour 31");
  await refuse(`select public.routine_date(0, '2026-10-01', 7)`, [], /entre 1 et 28/, "jour 0");
  assert.equal((await un(`select public.routine_date(null, '2026-10-01', 7) d`)).d, null, "null → null");
  const [f] = await q(`select provolatile v, proconfig c from pg_proc where proname = 'routine_date'`);
  assert.equal(f.v, "i", "immuable"); assert.deepEqual(f.c, ['search_path=""']);
});

test("PGlite : fonctions — search_path vide, security invoker, exécution réservée à authenticated", async () => {
  for (const n of ["activer_routine", "cloturer_routine", "routine_date", "routines_init", "routines_maj"]) {
    const [f] = await q(`select prosecdef s, proconfig c from pg_proc where proname = $1`, [n]);
    assert.ok(f, n); assert.equal(f.s, false, n + " : security invoker"); assert.deepEqual(f.c, ['search_path=""'], n);
  }
  await db.exec(`reset role; set test.uid = ''; set role anon;`);
  await refuse(`select public.activer_routine('revue_mensuelle')`, [], /permission denied/, "anon : activer_routine");
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'x', 'y', '[]'::jsonb)`, [], /permission denied/, "anon : cloturer_routine");
  await refuse(`select * from public.routines`, [], /permission denied/, "anon : table");
  await db.exec(`reset role; set test.uid = ''; set role authenticated;`);
  await refuse(`select public.activer_routine('revue_mensuelle')`, [], /non authentifié/, "sans utilisateur");
  await comme(db, A);
});

test("PGlite : activer_routine — défauts, jour 31 refusé, type inconnu refusé, réactivation qui recalcule", async () => {
  const r = await un(`select * from public.activer_routine('revue_mensuelle')`);
  assert.equal(r.user_id, A); assert.equal(r.type, "revue_mensuelle");
  assert.equal(r.jour, 1); assert.equal(r.active, true); assert.equal(r.consentement_journal, true);
  assert.deepEqual(r.questions, []); assert.equal(r.dernier_passage, null); assert.equal(r.synthese, null);
  assert.equal(jour(r.prochain_passage), await attendu(1, 7), "prochain passage : routine_date(1, auj, 7)");
  assert.ok(r.cree_le && r.maj_le);

  await refuse(`select public.activer_routine('revue_mensuelle', 31)`, [], /Jour invalide : choisis un jour entre 1 et 28/, "jour 31");
  await refuse(`select public.activer_routine('revue_mensuelle', 0)`, [], /entre 1 et 28/, "jour 0");
  await refuse(`select public.activer_routine('veille_quotidienne')`, [], /Type de routine inconnu/, "type inconnu");
  await refuse(`update public.routines set jour = 29`, [], /routines_jour/, "contrainte du jour");
  await refuse(`insert into public.routines (type) values ('autre')`, [], /routines_type/, "contrainte du type");

  // valeurs non nulles : remplacent ; nulles : gardent
  let s = await un(`select * from public.activer_routine('revue_mensuelle', 15, false)`);
  assert.equal(s.jour, 15); assert.equal(s.consentement_journal, false);
  assert.equal(jour(s.prochain_passage), await attendu(15, 7), "changement de jour : recalcul");
  s = await un(`select * from public.activer_routine('revue_mensuelle')`);
  assert.equal(s.jour, 15, "jour gardé"); assert.equal(s.consentement_journal, false, "consentement gardé");

  // réactivation après une pause : recalcul depuis aujourd'hui
  await q(`update public.routines set active = false, prochain_passage = '2020-01-01' where type = 'revue_mensuelle'`);
  s = await un(`select * from public.activer_routine('revue_mensuelle', null, true)`);
  assert.equal(s.active, true); assert.equal(s.consentement_journal, true);
  assert.equal(jour(s.prochain_passage), await attendu(15, 7), "réactivation : recalcul");
  assert.equal((await un(`select count(*)::int n from public.routines`)).n, 1, "upsert : une seule ligne");
});

test("PGlite : déclencheurs — pause → activité et changement de jour recalculent ; le reste garde la date", async () => {
  await q(`select public.activer_routine('revue_mensuelle', 1)`);
  await q(`update public.routines set prochain_passage = '2020-01-01'`);
  let r = await un(`select * from public.routines`);
  assert.equal(jour(r.prochain_passage), "2020-01-01", "écriture directe sans changement de jour ni d'activité : gardée");
  const avant = new Date(r.maj_le);

  r = (await q(`update public.routines set active = false, cree_le = '2000-01-01' returning *`))[0];
  assert.equal(r.active, false); assert.equal(jour(r.prochain_passage), "2020-01-01", "mise en pause : date gardée");
  assert.notEqual(jour(r.cree_le), "2000-01-01", "cree_le figée");
  assert.ok(new Date(r.maj_le) >= avant, "maj_le tenu à jour");

  r = (await q(`update public.routines set active = true returning *`))[0];
  assert.equal(jour(r.prochain_passage), await attendu(1, 7), "pause → activité : recalcul");

  await q(`update public.routines set prochain_passage = '2020-01-01'`);
  r = (await q(`update public.routines set consentement_journal = false returning *`))[0];
  assert.equal(jour(r.prochain_passage), "2020-01-01", "autre champ : date gardée");
  r = (await q(`update public.routines set jour = 20 returning *`))[0];
  assert.equal(jour(r.prochain_passage), await attendu(20, 7), "changement de jour : recalcul");
  r = (await q(`update public.routines set active = true, jour = 20 returning *`))[0];
  assert.equal(jour(r.prochain_passage), await attendu(20, 7), "active déjà vraie, même jour : inchangé");
});

test("PGlite : déclencheur d'insertion — prochain passage calculé s'il est absent, gardé s'il est donné", async () => {
  await comme(db, B);
  let r = (await q(`insert into public.routines (type, jour) values ('revue_mensuelle', 10) returning *`))[0];
  assert.equal(r.user_id, B); assert.equal(jour(r.prochain_passage), await attendu(10, 7));
  await q(`delete from public.routines`);
  r = (await q(`insert into public.routines (type, prochain_passage) values ('revue_mensuelle', '2030-05-01') returning *`))[0];
  assert.equal(jour(r.prochain_passage), "2030-05-01");
  await q(`delete from public.routines`);
  await comme(db, A);
});

test("PGlite : cloturer_routine — passage, synthèse et questions, prochain passage à auj + 10, idempotent sur la journée", async () => {
  await q(`select public.activer_routine('revue_mensuelle', 1)`);
  const qs = [Q("As-tu reçu ton salaire habituel ce mois-ci ?", { pourquoi: "Pour confirmer le budget.", champ: "personnes.p1.salaireUnite" }),
    Q("Le solde du livret A est-il toujours de 12 000 € ?", { pourquoi: "Solde de plus de 30 jours.", inconnu: "retiré" })];
  const r = await cloturer(qs, { client: "  Claude  " });
  assert.ok(r.dernier_passage, "dernier passage posé");
  assert.ok(Math.abs(new Date(r.dernier_passage) - Date.now()) < 60_000, "dernier passage : maintenant");
  assert.equal(r.dernier_client, "Claude", "client nettoyé");
  assert.equal(r.synthese, "Patrimoine stable. Deux soldes à confirmer.");
  assert.deepEqual(r.questions, [
    { question: "As-tu reçu ton salaire habituel ce mois-ci ?", pourquoi: "Pour confirmer le budget.", champ: "personnes.p1.salaireUnite" },
    { question: "Le solde du livret A est-il toujours de 12 000 € ?", pourquoi: "Solde de plus de 30 jours." },
  ], "questions normalisées (clés inconnues retirées)");
  assert.equal(jour(r.prochain_passage), await attendu(1, 10), "routine_date(jour, auj, 10)");
  assert.equal(r.active, true);

  const r2 = await cloturer([], { client: "x".repeat(150), synthese: "Rien de neuf." });
  assert.equal(jour(r2.prochain_passage), jour(r.prochain_passage), "second appel le même jour : même date");
  assert.equal(r2.dernier_client.length, 100, "client coupé à 100 caractères");
  assert.deepEqual(r2.questions, [], "questions remplacées");
  assert.equal(r2.synthese, "Rien de neuf.");
  // une routine en pause ne se clôture pas : refus clair, ligne inchangée
  await q(`update public.routines set active = false`);
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', 'Pendant la pause.', '[]'::jsonb)`, [],
    /Revue mensuelle en pause : réactive-la avant de la clôturer\./, "routine en pause");
  const r3 = await un(`select * from public.routines`);
  assert.equal(r3.active, false, "toujours en pause"); assert.equal(r3.synthese, "Rien de neuf.", "synthèse inchangée");
  await q(`update public.routines set active = true`);
  // questions nulles : tableau vide ; client vide : null
  const r4 = await un(`select * from public.cloturer_routine('revue_mensuelle', '  ', 'Ok.', null)`);
  assert.deepEqual(r4.questions, []); assert.equal(r4.dernier_client, null);
});

test("PGlite : cloturer_routine — validations (11 questions, question vide, formes, longueurs, synthèse, type)", async () => {
  const onze = Array.from({ length: 11 }, (_, i) => Q("Question " + (i + 1) + " ?"));
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', 'Ok.', $1::jsonb)`, [JSON.stringify(onze)], /Trop de questions : 10 au plus \(11 reçues\)/, "11 questions");
  const dix = await cloturer(onze.slice(0, 10));
  assert.equal(dix.questions.length, 10, "10 questions acceptées");
  const cas = [
    [[Q("")], /Question 1 : texte vide ou trop long \(1 à 300 caractères\)/, "question vide"],
    [[Q("   ")], /Question 1 : texte vide/, "question blanche"],
    [[Q("Ok ?"), {}], /Question 2 : texte vide/, "question absente"],
    [[Q("x".repeat(301))], /1 à 300 caractères/, "question de 301 caractères"],
    [[Q("Ok ?", { pourquoi: "p".repeat(301) })], /Question 1 : « pourquoi » invalide \(texte de 300 caractères au plus\)/, "pourquoi trop long"],
    [[Q("Ok ?", { pourquoi: 3 })], /Question 1 : « pourquoi » invalide/, "pourquoi non texte"],
    [[Q("Ok ?", { champ: "a".repeat(61) })], /Question 1 : champ invalide/, "champ trop long"],
    [[Q("Ok ?", { champ: "foyer adultes" })], /Question 1 : champ invalide/, "champ avec espace"],
    [["Ok ?"], /Question 1 : objet \{ question, pourquoi\?, champ\? \} attendu/, "élément non objet"],
    [{ question: "Ok ?" }, /Questions invalides : un tableau/, "objet au lieu d'un tableau"],
  ];
  for (const [v, motif, m] of cas)
    await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', 'Ok.', $1::jsonb)`, [JSON.stringify(v)], motif, m);
  const gros = Array.from({ length: 10 }, () => Q("é".repeat(300), { pourquoi: "è".repeat(300), champ: "c".repeat(60) }));
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', 'Ok.', $1::jsonb)`, [JSON.stringify(gros)], /Questions trop longues : 10 000 octets au plus/, "taille");
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', '  ', '[]'::jsonb)`, [], /Synthèse vide ou trop longue/, "synthèse vide");
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', null, '[]'::jsonb)`, [], /Synthèse vide/, "synthèse nulle");
  for (const blanc of ["\n", " \n\t \r\n ", "\t\t"])
    await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', $1, '[]'::jsonb)`, [blanc], /Synthèse vide ou trop longue : 1 à 4 000 caractères/, "synthèse blanche " + JSON.stringify(blanc));
  const net = await un(`select * from public.cloturer_routine('revue_mensuelle', 'Claude', $1, '[]'::jsonb)`, ["\n  Synthèse.\n\t"]);
  assert.equal(net.synthese, "Synthèse.", "blancs et sauts de ligne retirés autour");
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', $1, '[]'::jsonb)`, ["s".repeat(4001)], /Synthèse vide ou trop longue : 1 à 4 000 caractères/, "synthèse trop longue");
  await refuse(`select public.cloturer_routine('autre', 'Claude', 'Ok.', '[]'::jsonb)`, [], /Type de routine inconnu/, "type inconnu");
  // la contrainte de table garde le tableau et sa taille (écriture directe, chemin de questions_routine côté connecteur)
  await refuse(`update public.routines set questions = '{}'::jsonb`, [], /routines_questions/, "objet");
  await refuse(`update public.routines set questions = $1::jsonb`, [JSON.stringify(onze)], /routines_questions/, "11 éléments");
  await refuse(`update public.routines set synthese = $1`, ["s".repeat(4001)], /routines_synthese/, "synthèse de 4 001");
});

test("PGlite : contenu sensible refusé (synthèse, questions) par routines_contenu_sensible ; ISIN accepté", async () => {
  const sql = `select public.cloturer_routine('revue_mensuelle', 'Claude', $1, $2::jsonb)`;
  await refuse(sql, ["Virement depuis FR76 3000 6000 0112 3456 7890 189 reçu.", "[]"], /routines_contenu_sensible/, "IBAN dans la synthèse");
  await refuse(sql, ["Ok.", JSON.stringify([Q("Quel est ton mot de passe bancaire ?")])], /routines_contenu_sensible/, "mot de passe dans une question");
  await refuse(sql, ["Ok.", JSON.stringify([Q("Confirme la carte ?", { pourquoi: "carte 4970 1012 3456 7890" })])], /routines_contenu_sensible/, "carte dans un pourquoi");
  await refuse(`update public.routines set synthese = 'IBAN FR76 3000 6000 0112 3456 7890 189'`, [], /routines_contenu_sensible/, "écriture directe");
  await refuse(`update public.routines set questions = $1::jsonb`, [JSON.stringify([Q("Ok ?", { pourquoi: "Ton code PIN ?" })])], /routines_contenu_sensible/, "écriture directe des questions");
  // contrôle des seuls textes (public.jsonb_textes, 0016), pas du JSON brut : clés et nombres ne sont pas du texte affiché
  const def = (await un(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'routines_contenu_sensible'`)).d;
  assert.match(def, /contenu_sensible\(jsonb_textes\(questions\)\)/, "questions contrôlées par jsonb_textes");
  assert.doesNotMatch(def, /questions\)::text/, "plus de contrôle sur le JSON brut");
  const r = await un(`select * from public.cloturer_routine('revue_mensuelle', 'Claude', $1, $2::jsonb)`,
    ["ETF IE00B4L5Y983 en hausse ; objectifs 2025-2026-2027-2028.", JSON.stringify([Q("As-tu acheté du FR0010315770 ?", { pourquoi: "100 000 200 000" })])]);
  assert.match(r.synthese, /IE00B4L5Y983/, "ISIN et textes voisins acceptés");
});

test("PGlite : cloturer_routine crée la routine si elle est absente (active, jour 1, sans consentement au journal)", async () => {
  await comme(db, B);
  assert.equal((await q(`select * from public.routines`)).length, 0);
  const r = await cloturer([Q("Nouveau prélèvement ce mois-ci ?")], { client: "ChatGPT" });
  assert.equal(r.user_id, B); assert.equal(r.active, true); assert.equal(r.jour, 1);
  assert.equal(r.consentement_journal, false, "création implicite : pas de consentement au journal (seul activer_routine le pose, après l'accord)");
  assert.equal(r.dernier_client, "ChatGPT"); assert.equal(r.questions.length, 1);
  assert.equal(jour(r.prochain_passage), await attendu(1, 10));
  await comme(db, A);
});

test("PGlite : RLS — B ne voit ni ne modifie la routine de A", async () => {
  await comme(db, A);
  await q(`select public.activer_routine('revue_mensuelle', 1)`);
  await comme(db, B);
  const lues = await q(`select user_id from public.routines`);
  assert.ok(lues.every(l => l.user_id === B), "B ne lit que ses lignes");
  assert.equal((await q(`update public.routines set jour = 9 where user_id = '${A}' returning *`)).length, 0, "mise à jour sans effet");
  assert.equal((await q(`delete from public.routines where user_id = '${A}' returning *`)).length, 0, "suppression sans effet");
  await refuse(`insert into public.routines (user_id, type) values ('${A}', 'revue_mensuelle')`, [], /row-level security/, "insertion pour A");
  // cloturer_routine et activer_routine de B ne touchent que la ligne de B
  await cloturer([], { client: "B" });
  await q(`select public.activer_routine('revue_mensuelle', 9)`);
  await comme(db, A);
  const a = await un(`select * from public.routines`);
  assert.equal(a.user_id, A); assert.equal(a.jour, 1); assert.notEqual(a.dernier_client, "B");
  await db.exec(`reset role;`);
  assert.equal((await un(`select count(*)::int n from public.routines`)).n, 2, "une ligne par utilisateur");
  await comme(db, A);
});

test("PGlite : export_all contient routines (triées par type), propres à l'utilisateur, et toutes les clés de 0013", async () => {
  await comme(db, A);
  const e = (await un(`select public.export_all() e`)).e;
  for (const k of ["exported_at", "profile", "biens", "credits", "positions", "transactions", "snapshots", "config", "status", "budget",
    "objectifs", "propositions", "connexions_assistant", "memoire_agent", "journal", "routines"]) assert.ok(k in e, k);
  assert.equal(Object.keys(e).length, 16, "aucune clé en plus");
  assert.ok(Array.isArray(e.routines)); assert.equal(e.routines.length, 1);
  assert.equal(e.routines[0].user_id, A); assert.equal(e.routines[0].type, "revue_mensuelle");
  const src = (await un(`select prosrc s from pg_proc where proname = 'export_all'`)).s;
  assert.match(src, /'routines',\s+\(select coalesce\(jsonb_agg\(to_jsonb\(rt\) order by rt\.type\), '\[\]'\) from public\.routines rt where rt\.user_id = auth\.uid\(\)\)/);
});
