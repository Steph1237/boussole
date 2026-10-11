// Journal des décisions exercé sur un vrai PostgreSQL (PGlite, en mémoire) : migrations 0009 → 0014 appliquées sur les bouchons
// Supabase (test/helpers/pglite.mjs), puis historique, provenance et état figés, contenu sensible (options comprises), limite
// de 2 000 entrées et consentement par défaut. Aucun réseau ni secret : exécuté en CI (npm ci && npm test).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { baseAvec, comme } from "./helpers/pglite.mjs";

const MIGRATIONS = ["0009_savoir_memoire.sql", "0010_savoir_reperes.sql", "0011_savoir_fiches.sql", "0012_savoir_libelles.sql", "0013_journal.sql", "0014_journal_durcissement.sql"];
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
const refuse = async (s, p, motif, m) => {
  await assert.rejects(db.query(s, p), e => { assert.match(e.message, motif, m); return true; }, m + " : accepté");
};
const ETAT = { date: "2026-10-10", patrimoine_net: 120000, bonnes_pratiques: { total: 7, provisoire: false } };
/** Nouvelle entrée de A (rôle authenticated), renvoyée en entier. */
const nouvelle = async (o = {}) => (await q(`insert into public.journal (type, titre, synthese, raisonnement, options, etat, source)
  values ($1, $2, $3, $4, $5, $6, $7) returning *`, [o.type ?? "decision", o.titre ?? "Garder le PEA", o.synthese ?? "On garde le PEA et on verse 300 €/mois.",
  o.raisonnement ?? "## Pourquoi\nFrais bas.", JSON.stringify(o.options ?? [{ titre: "Garder", retenue: true, pourquoi: "frais" }]), JSON.stringify(ETAT), o.source ?? "Claude"]))[0];
const maj = async (id, set, p = []) => (await q(`update public.journal set ${set} where id = '${id}' returning *`, p))[0];

before(async () => {
  db = await baseAvec(MIGRATIONS);
  await db.exec(`insert into auth.users values ('${A}'), ('${B}'); insert into public.profiles (user_id) values ('${A}');
    grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
    grant select, update on public.profiles to authenticated;
    alter table public.profiles enable row level security;
    create policy "profiles: select" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
    create policy "profiles: update" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);`);
  await comme(db, A);
});

test("PGlite : consentement par défaut « demander », valeur inconnue refusée", async () => {
  assert.equal((await q("select journal_consentement c from public.profiles"))[0].c, "demander");
  await refuse(`update public.profiles set journal_consentement = 'toujours'`, [], /profiles_journal_consentement/, "consentement inconnu");
});

test("PGlite : historique — à relire non historisé, puis { le, champ, avant, apres } et note en ajout seul", async () => {
  const e = await nouvelle();
  assert.equal(e.statut, "a_relire"); assert.deepEqual(e.historique, []);
  let r = await maj(e.id, `titre = 'Garder le PEA (corrigé)'`);
  assert.deepEqual(r.historique, [], "à relire : non historisé");
  r = await maj(e.id, `statut = 'actif'`);
  assert.deepEqual(r.historique, [], "première confirmation : non historisée");
  const note = "\n\n— Note du 2026-10-10 (Claude) : versement relevé.";
  r = await maj(e.id, `synthese = 'On garde le PEA, 400 €/mois.', raisonnement = raisonnement || $1, revue_le = '2027-01-01'`, [note]);
  assert.deepEqual(r.historique.map(h => h.champ), ["synthese", "raisonnement", "revue_le"], "ordre des champs du déclencheur");
  assert.equal(r.historique[0].avant, "On garde le PEA et on verse 300 €/mois."); assert.equal(r.historique[0].apres, "On garde le PEA, 400 €/mois.");
  assert.equal(r.historique[1].ajout, note); assert.ok(!("avant" in r.historique[1]));
  assert.equal(r.historique[2].avant, null); assert.equal(r.historique[2].apres, "2027-01-01");
  assert.ok(r.historique.every(h => typeof h.le === "string"));
  r = await maj(e.id, `historique = '[]'::jsonb`);
  assert.equal(r.historique.length, 3, "historique effacé par l'utilisateur : ignoré");
});

test("PGlite : provenance (source), état figé et date de création immuables", async () => {
  const e = await nouvelle({ source: "Claude" });
  const r = await maj(e.id, `source = 'Boussole', etat = '{"pirate": 1}'::jsonb, cree_le = '2000-01-01', statut = 'actif'`);
  assert.equal(r.source, "Claude", "source figée (0014)");
  assert.deepEqual(r.etat, ETAT, "état figé");
  assert.equal(new Date(r.cree_le).getTime(), new Date(e.cree_le).getTime(), "cree_le figée");
  assert.ok(new Date(r.maj_le) >= new Date(e.maj_le), "maj_le tenu à jour");
});

test("PGlite : plafond de l'historique — les 20 premières entrées et les 180 dernières", async () => {
  const e = await nouvelle();
  await maj(e.id, `statut = 'actif'`);
  for (let k = 1; k <= 230; k++) await maj(e.id, `titre = $1`, ["Titre " + k]);
  const h = (await q(`select historique from public.journal where id = $1`, [e.id]))[0].historique;
  assert.equal(h.length, 200);
  assert.equal(h[0].avant, "Garder le PEA"); assert.equal(h[0].apres, "Titre 1", "la toute première correction reste");
  assert.equal(h[19].apres, "Titre 20", "les 20 premières");
  assert.equal(h[20].apres, "Titre 51", "puis les 180 dernières (230 − 180 + 1)");
  assert.equal(h[199].apres, "Titre 230");
});

test("PGlite : contenu sensible refusé dans les options (titre, pourquoi), comme ailleurs ; ISIN et textes voisins acceptés", async () => {
  const sql = `insert into public.journal (type, titre, synthese, options) values ('scenario', 'Comparer', 'Deux options.', $1::jsonb) returning id`;
  await refuse(sql, [JSON.stringify([{ titre: "Virer depuis FR76 3000 6000 0112 3456 7890 189", retenue: true }])], /journal_contenu_sensible/, "IBAN dans un titre d'option");
  await refuse(sql, [JSON.stringify([{ titre: "Garder", pourquoi: "carte 4970 1012 3456 7890" }])], /journal_contenu_sensible/, "carte dans un pourquoi");
  await refuse(sql, [JSON.stringify([{ titre: "Garder" }, { titre: "Autre", pourquoi: "mon mot de passe est soleil" }])], /journal_contenu_sensible/, "mot de passe dans la 2e option");
  // une entrée existante ne peut pas recevoir d'options sensibles
  const e = await nouvelle();
  await refuse(`update public.journal set options = $1::jsonb where id = '${e.id}'`, [JSON.stringify([{ titre: "IBAN FR76 3000 6000 0112 3456 7890 189" }])], /journal_contenu_sensible/, "à la modification aussi");
  // pas de faux positif : ISIN, années, montants, booléens et clés JSON ; deux textes voisins ne forment pas un numéro de carte
  const ok = [
    [{ titre: "ETF IE00B4L5Y983 MSCI World", retenue: true, pourquoi: "ISIN FR0010315770 ETF, frais 0,2 %" }],
    [{ titre: "Objectifs 2025-2026-2027-2028", pourquoi: "100 000 200 000 300 000" }],
    [{ titre: "Versement 1234", pourquoi: "5678 9012 3456" }],
    [{ titre: "Garder", retenue: false }, { titre: "Clôturer" }],
  ];
  for (const o of ok) assert.ok((await q(sql, [JSON.stringify(o)]))[0].id, "accepté : " + JSON.stringify(o));
  // la fonction elle-même : textes des options, un par ligne, sans sérialisation JSON
  const [t] = await q(`select public.options_texte($1::jsonb) t, public.options_texte('{}'::jsonb) v, public.options_texte('[1, "x", null]'::jsonb) s`,
    [JSON.stringify([{ titre: "A", retenue: true, pourquoi: "b" }, { titre: "C" }])]);
  assert.equal(t.t, "A\nb\nC"); assert.equal(t.v, ""); assert.equal(t.s, "");
  const [f] = await q(`select provolatile v, proconfig c from pg_proc where proname = 'options_texte'`);
  assert.equal(f.v, "i", "immuable"); assert.deepEqual(f.c, ['search_path=""']);
});

test("PGlite : limite de 2 000 entrées par utilisateur (remplissage direct, puis la 2 000e passe et la 2 001e est refusée)", async () => {
  const [{ n }] = await q("select count(*)::int n from public.journal");
  // Remplissage sans le déclencheur (sinon 2 000 comptages : trop lent pour la CI), puis déclencheur rétabli.
  await db.exec(`reset role; alter table public.journal disable trigger journal_limite;
    insert into public.journal (user_id, type, titre, synthese) select '${A}', 'avis', 'Avis ' || g, 's' from generate_series(1, ${1999 - n}) g;
    alter table public.journal enable trigger journal_limite;`);
  await comme(db, A);
  await q(`insert into public.journal (type, titre, synthese) values ('avis', 'La 2 000e', 's')`);
  await refuse(`insert into public.journal (type, titre, synthese) values ('avis', 'De trop', 's')`, [], /Journal plein : 2 000 entrées au plus/, "2 001e");
  await comme(db, B);
  await q(`insert into public.journal (type, titre, synthese) values ('avis', 'Chez B', 's')`);
  assert.equal((await q("select count(*)::int n from public.journal"))[0].n, 1, "limite par utilisateur ; RLS : B ne voit que son entrée");
  await comme(db, A);
});
