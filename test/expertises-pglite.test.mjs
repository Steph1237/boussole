// Expertises du Copilote exercées sur un vrai PostgreSQL (PGlite, en mémoire) : migrations 0009 → 0017 appliquées sur les
// bouchons Supabase (test/helpers/pglite.mjs), puis lecture publique filtrée, aucune écriture pour anon ni authenticated,
// version incrémentée d'office, historique créé à chaque version et immuable, contenu sensible refusé, formes contrôlées et
// idempotence de 0017. Aucun réseau ni secret : exécuté en CI (npm ci && npm test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseAvec, comme } from "./helpers/pglite.mjs";

const MIGRATIONS = ["0009_savoir_memoire.sql", "0010_savoir_reperes.sql", "0011_savoir_fiches.sql", "0012_savoir_libelles.sql",
  "0013_journal.sql", "0014_journal_durcissement.sql", "0015_savoir_libelles_objectifs.sql", "0016_expertises.sql", "0017_expertises_contenu.sql"];
const M17 = readFileSync(new URL("../supabase/migrations/0017_expertises_contenu.sql", import.meta.url), "utf8");
const SLUGS = ["allocation-risque", "actions", "etf-fonds", "taux-obligations", "immobilier-credit", "fiscalite-enveloppes", "crypto", "budget-epargne"];
const A = "11111111-1111-1111-1111-111111111111";
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
const refuse = async (s, p, motif, m) => {
  await assert.rejects(db.query(s, p), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
};
const superu = () => db.exec("reset role;");
const anon = () => db.exec("reset role; set role anon;");
const EVALS = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ question: "Question de test " + i, attendu: ["Réponse attendue"], interdit: [] })));
/** Insère (superutilisateur) une expertise minimale valide ; o surcharge les colonnes. */
const inserer = (o = {}) => q(`insert into public.expertises (slug, nom, quand_consulter, perimetre, methode, controles, garde_fous, format, evals, statut)
  values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10) returning *`, [o.slug ?? "essai", o.nom ?? "Essai",
  o.quand_consulter ?? "Quand on teste la table des expertises.", o.perimetre ?? "Le périmètre d'une expertise de test.",
  o.methode ?? "Méthode de test. ".repeat(20), o.controles ?? JSON.stringify(["Un", "Deux", "Trois"]),
  o.garde_fous ?? "Garde-fous de test. ".repeat(8), o.format ?? "Format de réponse de test.", o.evals ?? EVALS, o.statut ?? "brouillon"]);

before(async () => {
  db = await baseAvec(MIGRATIONS);
  await db.exec(`insert into auth.users values ('${A}');
    grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
});
after(async () => { await db.close(); });

test("PGlite : 8 expertises v1 publiées, version 1, une copie publiée chacune dans l'historique", async () => {
  await superu();
  const r = await q("select slug, version, statut, changelog from public.expertises order by slug");
  assert.deepEqual(r.map(x => x.slug), [...SLUGS].sort());
  for (const x of r) {
    assert.equal(x.version, 1, x.slug); assert.equal(x.statut, "publie", x.slug);
    assert.deepEqual(x.changelog.map(c => [c.version, c.le]), [[1, "2026-10-11"]], x.slug);
  }
  const h = await q("select slug, version, statut, resume from public.expertises_versions order by slug");
  assert.deepEqual(h.map(x => [x.slug, x.version, x.statut]), [...SLUGS].sort().map(s => [s, 1, "publie"]));
  assert.ok(h.every(x => /Première version/.test(x.resume)), "résumé repris du journal des versions");
});

test("PGlite : lecture publique des seules expertises et versions publiées (anon et authenticated)", async () => {
  await superu();
  await inserer({ slug: "brouillon-cache" });
  await inserer({ slug: "archive-cachee", statut: "archive" });
  for (const role of ["anon", "authenticated"]) {
    if (role === "anon") await anon(); else await comme(db, A);
    const e = await q("select slug from public.expertises order by slug");
    assert.deepEqual(e.map(x => x.slug), [...SLUGS].sort(), role + " : seulement les publiées");
    const v = await q("select distinct statut from public.expertises_versions");
    assert.deepEqual(v.map(x => x.statut), ["publie"], role + " : historique publié seulement");
    assert.equal((await q("select count(*)::int n from public.expertises_versions where slug like '%cache%'"))[0].n, 0, role);
  }
  await superu();
  assert.equal((await q("select count(*)::int n from public.expertises_versions where slug = 'brouillon-cache' and statut = 'brouillon'"))[0].n, 1, "copie du brouillon gardée (non publique)");
});

test("PGlite : aucune écriture pour anon ni authenticated (expertises et historique)", async () => {
  for (const role of ["anon", "authenticated"]) {
    if (role === "anon") await anon(); else await comme(db, A);
    await refuse(`insert into public.expertises (slug, nom, quand_consulter, perimetre, methode, controles, garde_fous, format, evals)
      select 'pirate', nom, quand_consulter, perimetre, methode, controles, garde_fous, format, evals from public.expertises limit 1`, [], /permission denied/, role + " insert");
    await refuse(`update public.expertises set nom = 'Piraté' where slug = 'crypto'`, [], /permission denied/, role + " update");
    await refuse(`delete from public.expertises where slug = 'crypto'`, [], /permission denied/, role + " delete");
    await refuse(`update public.expertises_versions set nom = 'Piraté'`, [], /permission denied/, role + " update historique");
    await refuse(`delete from public.expertises_versions`, [], /permission denied/, role + " delete historique");
    await refuse(`truncate public.expertises_versions`, [], /permission denied/, role + " truncate historique");
  }
  await superu();
  assert.equal((await q("select nom from public.expertises where slug = 'crypto'"))[0].nom, "Crypto-actifs");
});

test("PGlite : contenu modifié sans changer la version → version + 1, date, journal et copie dans l'historique", async () => {
  await superu();
  const avant = (await q("select * from public.expertises where slug = 'crypto'"))[0];
  const r = (await q("update public.expertises set methode = methode || $1 where slug = 'crypto' returning *", ["\n\nAjout de test."]))[0];
  assert.equal(r.version, 2);
  assert.equal(r.cree_le.getTime(), avant.cree_le.getTime());
  assert.deepEqual(r.changelog.map(c => c.version), [1, 2], "entrée ajoutée d'office pour la version 2");
  assert.equal(r.changelog[1].resume, "Mise à jour du contenu.");
  const h = await q("select version, statut, methode from public.expertises_versions where slug = 'crypto' order by version");
  assert.deepEqual(h.map(x => x.version), [1, 2]);
  assert.equal(h[0].methode, avant.methode, "la copie v1 garde l'ancien contenu");
  assert.ok(h[1].methode.endsWith("Ajout de test."));
  // rien ne change : pas de nouvelle version ni de copie
  const r2 = (await q("update public.expertises set methode = methode where slug = 'crypto' returning version"))[0];
  assert.equal(r2.version, 2);
  assert.equal((await q("select count(*)::int n from public.expertises_versions where slug = 'crypto'"))[0].n, 2);
  // version relevée explicitement (avec une note) sans changement de contenu : copie de la nouvelle version
  const r3 = (await q(`update public.expertises set version = 5, changelog = changelog || '[{"version": 5, "le": "2026-10-12", "resume": "Relecture."}]'::jsonb
    where slug = 'crypto' returning version, changelog`))[0];
  assert.equal(r3.version, 5); assert.equal(r3.changelog.length, 3);
  assert.equal((await q("select resume from public.expertises_versions where slug = 'crypto' and version = 5"))[0].resume, "Relecture.");
  // changement de statut : copie (version, statut) ; republication de la même version : pas de doublon
  await q("update public.expertises set statut = 'archive' where slug = 'crypto'");
  await q("update public.expertises set statut = 'publie' where slug = 'crypto'");
  const v5 = await q("select statut from public.expertises_versions where slug = 'crypto' and version = 5 order by statut");
  assert.deepEqual(v5.map(x => x.statut), ["archive", "publie"]);
  assert.equal((await q("select version from public.expertises where slug = 'crypto'"))[0].version, 5, "un changement de statut ne change pas la version");
});

test("PGlite : version jamais redescendue, slug figé, journal des versions en ajout seul, contenu et version ensemble", async () => {
  await superu();
  await refuse("update public.expertises set version = 1 where slug = 'crypto'", [], /ne redescend pas/, "version qui redescend");
  await refuse("update public.expertises set slug = 'crypto-bis' where slug = 'crypto'", [], /slug d'une expertise ne change pas/, "slug");
  await refuse(`update public.expertises set changelog = '[]'::jsonb where slug = 'crypto'`, [], /ne se réécrit pas/, "journal effacé");
  await q("update public.expertises set cree_le = '2000-01-01' where slug = 'crypto'");
  assert.notEqual((await q("select cree_le from public.expertises where slug = 'crypto'"))[0].cree_le.getUTCFullYear(), 2000, "cree_le figée");
  // contenu et version relevée ensemble : la version demandée est gardée (pas de double incrément)
  const r = (await q("update public.expertises set nom = 'Crypto-actifs (relu)', version = 7 where slug = 'crypto' returning version"))[0];
  assert.equal(r.version, 7);
  assert.deepEqual((await q("select version from public.expertises_versions where slug = 'crypto' and statut = 'publie' order by version")).map(x => x.version), [1, 2, 5, 7]);
});

test("PGlite : historique immuable pour tous les rôles, superutilisateur compris ; expertise non supprimable", async () => {
  await superu();
  await refuse("update public.expertises_versions set nom = 'Réécrit' where slug = 'actions'", [], /immuable/, "update");
  await refuse("delete from public.expertises_versions where slug = 'actions'", [], /immuable/, "delete");
  await refuse("truncate public.expertises_versions", [], /immuable/, "truncate");
  await refuse(`insert into public.expertises_versions (expertise_id, slug, version, statut, nom, quand_consulter, perimetre, methode, controles,
      garde_fous, format, themes_savoir, reperes, angles, marches, evals, mis_a_jour_le)
    select id, slug, 99, 'publie', 'Faux', quand_consulter, perimetre, methode, controles, garde_fous, format, themes_savoir, reperes, angles,
      marches, evals, mis_a_jour_le from public.expertises where slug = 'actions'`, [], /par déclencheur seulement/, "copie falsifiée");
  await refuse("delete from public.expertises where slug = 'actions'", [], /immuable|violates foreign key/, "suppression d'une expertise");
  assert.equal((await q("select count(*)::int n from public.expertises_versions where slug = 'actions'"))[0].n, 1);
});

test("PGlite : contenu sensible refusé (textes, contrôles, évaluations) ; ISIN, années et montants acceptés", async () => {
  await superu();
  const nom = /expertises_contenu_sensible/;
  await refuse("update public.expertises set methode = methode || ' Virement FR76 3000 6000 0112 3456 7890 189' where slug = 'actions'", [], nom, "IBAN dans la méthode");
  await refuse("update public.expertises set garde_fous = garde_fous || ' carte 4970 1012 3456 7890' where slug = 'actions'", [], nom, "carte dans les garde-fous");
  await refuse(`update public.expertises set controles = controles || '["Demander le mot de passe du compte"]'::jsonb where slug = 'actions'`, [], nom, "mot interdit dans un contrôle");
  await refuse(`update public.expertises set evals = jsonb_set(evals, '{0,question}', '"Voici mon code secret"') where slug = 'actions'`, [], nom, "mot interdit dans une évaluation");
  await refuse("update public.expertises set quand_consulter = 'Quand on parle du password de la banque.' where slug = 'actions'", [], nom, "mot interdit dans quand_consulter");
  // pas de faux positif
  const r = (await q(`update public.expertises set methode = methode || ' Exemple de forme : IE00B4L5Y983, années 2025-2026-2027-2028, 100 000 200 000 €.'
    where slug = 'actions' returning version`))[0];
  assert.equal(r.version, 2);
  // la fonction des textes JSON : chaînes seules (ni clés, ni nombres), une par ligne (ordre des clés de jsonb)
  const [t] = await q(`select public.jsonb_textes('[{"question": "A", "attendu": ["b", "c"], "n": 1}]'::jsonb) t`);
  assert.deepEqual(t.t.split("\n").sort(), ["A", "b", "c"]);
});

test("PGlite : formes contrôlées (slug, longueurs, contrôles, évaluations, thèmes, angles, marchés, repères, journal)", async () => {
  await superu();
  const c = /violates check constraint/;
  for (const [o, m] of [
    [{ slug: "Mauvais Slug" }, "slug"], [{ slug: "ab" }, "slug trop court"], [{ quand_consulter: "court" }, "quand_consulter trop court"],
    [{ quand_consulter: "x".repeat(301) }, "quand_consulter trop long"], [{ methode: "trop court" }, "méthode trop courte"],
    [{ methode: "x".repeat(8001) }, "méthode trop longue"], [{ garde_fous: "x".repeat(3001) }, "garde-fous trop longs"],
    [{ format: "x".repeat(1501) }, "format trop long"], [{ controles: JSON.stringify(["Un", "Deux"]) }, "moins de 3 contrôles"],
    [{ controles: JSON.stringify(["Un", "", "Trois"]) }, "contrôle vide"], [{ controles: JSON.stringify({ a: 1 }) }, "contrôles non tableau"],
    [{ evals: JSON.stringify(JSON.parse(EVALS).slice(0, 9)) }, "moins de 10 évaluations"],
    [{ evals: JSON.stringify(JSON.parse(EVALS).map((e, i) => (i ? e : { ...e, attendu: [] }))) }, "évaluation sans attendu"],
    [{ evals: JSON.stringify(JSON.parse(EVALS).map((e, i) => (i ? e : { ...e, note: "x" }))) }, "clé inconnue dans une évaluation"],
    [{ evals: JSON.stringify(JSON.parse(EVALS).map((e, i) => (i ? e : { ...e, interdit: undefined }))) }, "évaluation sans interdit"],
  ]) await refuse(...[`insert into public.expertises (slug, nom, quand_consulter, perimetre, methode, controles, garde_fous, format, evals)
      values ($1, 'Essai', $2, 'Le périmètre d''une expertise de test.', $3, $4::jsonb, $5, $6, $7::jsonb)`,
    [o.slug ?? "forme", o.quand_consulter ?? "Quand on teste la table des expertises.", o.methode ?? "Méthode de test. ".repeat(20),
      o.controles ?? JSON.stringify(["Un", "Deux", "Trois"]), o.garde_fous ?? "Garde-fous de test. ".repeat(8), o.format ?? "Format de test.", o.evals ?? EVALS],
    c, m]);
  for (const [set, m] of [
    ["themes_savoir = array['jardinage']", "thème inconnu"], ["angles = array['astrologie']", "angle inconnu"],
    ["marches = array['mars']", "marché inconnu"], ["reperes = array['Pas Une Cle']", "clé de repère mal formée"],
    ["statut = 'en_ligne'", "statut inconnu"],
  ]) await refuse(`update public.expertises set ${set} where slug = 'budget-epargne'`, [], c, m);
  await refuse(`update public.expertises set changelog = changelog || '[{"version": 0, "le": "2026-10-11", "resume": "x"}]'::jsonb where slug = 'budget-epargne'`, [], c, "entrée de journal invalide");
  // fonctions : search_path vide, validateurs immuables
  const f = await q(`select proname, provolatile, proconfig from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('jsonb_textes','chaines_valides','expertise_controles_valides','expertise_eval_valide','expertise_evals_valides',
                    'expertise_changelog_entree_valide','expertise_changelog_valide','cles_reperes_valides','expertises_version',
                    'expertises_historiser','expertises_versions_immuable') order by proname`);
  assert.equal(f.length, 11);
  for (const x of f) assert.deepEqual(x.proconfig, ['search_path=""'], x.proname);
  for (const x of f.filter(x => !x.proname.startsWith("expertises_"))) assert.equal(x.provolatile, "i", x.proname + " immuable");
});

test("PGlite : 0017 idempotente — rejouée sans changement, rien ne bouge ; rejouée après une retouche, le texte revient en version + 1", async () => {
  const d = await baseAvec(MIGRATIONS);
  const etat = async () => (await d.query("select slug, version, mis_a_jour_le::text m, changelog from public.expertises order by slug")).rows;
  const nbCopies = async () => (await d.query("select count(*)::int n from public.expertises_versions")).rows[0].n;
  const avant = await etat(), copies = await nbCopies();
  await d.exec(M17);
  assert.deepEqual(await etat(), avant, "rejouée : versions, dates et journaux inchangés");
  assert.equal(await nbCopies(), copies, "rejouée : aucune copie de plus");
  const original = (await d.query("select methode from public.expertises where slug = 'etf-fonds'")).rows[0].methode;
  await d.exec("update public.expertises set methode = 'Texte retouché à la main. ' || methode where slug = 'etf-fonds'");
  await d.exec(M17);
  const r = (await d.query("select version, methode, changelog from public.expertises where slug = 'etf-fonds'")).rows[0];
  assert.equal(r.methode, original, "le texte de la migration revient");
  assert.equal(r.version, 3, "retouche (v2) puis texte de la migration (v3)");
  assert.deepEqual(r.changelog.map(c => c.version), [1, 2, 3]);
  assert.equal(await nbCopies(), copies + 2);
  await d.exec(M17);
  assert.equal((await d.query("select version from public.expertises where slug = 'etf-fonds'")).rows[0].version, 3, "rejouée encore : stable");
  await d.close();
});
