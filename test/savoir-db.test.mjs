// Savoir commun et mémoire de l'agent (migration 0009) : contrôles statiques du SQL, puis intégration RLS
// avec SUPABASE_SERVICE_KEY (sinon ignorés).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasServiceKey, SKIP_REASON, adminClient, userClient, createTestUser, deleteTestUser } from "./helpers/supabase.mjs";

const sql = readFileSync("supabase/migrations/0009_savoir_memoire.sql", "utf8");

test("0009 : tables, RLS activée, lecture publique limitée aux fiches publiées", () => {
  for (const t of ["savoir_fiches", "reperes", "memoire_agent"]) {
    assert.match(sql, new RegExp(`create table public\\.${t}`));
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
  }
  assert.match(sql, /on public\.savoir_fiches for select to anon, authenticated using \(statut = 'publie'\)/);
  assert.match(sql, /on public\.reperes for select to anon, authenticated using \(true\)/);
  assert.doesNotMatch(sql, /on public\.(savoir_fiches|reperes) for (insert|update|delete|all)/, "aucune écriture publique");
  assert.match(sql, /revoke all on table public\.memoire_agent from anon/);
});

test("0009 : colonne générée de recherche — uniquement des fonctions immuables", () => {
  // array_to_string est stable (pas immuable) : une colonne générée doit passer par un enrobage immuable.
  assert.match(sql, /function public\.mots_cles_texte\(p text\[\]\)[\s\S]*?immutable[\s\S]*?set search_path = ''/);
  assert.match(sql, /public\.mots_cles_texte\(mots_cles\)/);
  assert.doesNotMatch(sql, /generated always as[\s\S]*?array_to_string\(mots_cles/, "array_to_string direct interdit dans la colonne générée");
  assert.match(sql, /to_tsvector\('french', /);
});

test("0009 : mémoire — propriétaire seul, limite 200, filtre sensible, export", () => {
  for (const op of ["select", "insert", "update", "delete"]) assert.match(sql, new RegExp(`"memoire_agent: ${op}" on public\\.memoire_agent for ${op} to authenticated`));
  assert.match(sql, /memoire_limite/);
  assert.match(sql, />= 200/);
  assert.match(sql, /constraint memoire_agent_contenu_sensible check \(not public\.contenu_sensible\(contenu\)\)/, "contrainte nommée (le front reconnaît « contenu_sensible » dans le message)");
  assert.match(sql, /'memoire_agent',/);
  assert.match(sql, /function public\.marquer_savoir_vu\(p_client_id text\)/);
  assert.match(sql, /function public\.chercher_savoir\(p_question text default null, p_theme text default null, p_limite int default 5\)/);
  for (const f of ["contenu_sensible", "chercher_savoir", "marquer_savoir_vu", "memoire_limite"]) assert.match(sql, new RegExp(`${f}[\\s\\S]*?set search_path = ''`));
  // droits : tout retiré à anon ET authenticated avant le grant explicite
  assert.match(sql, /revoke all on table public\.memoire_agent from anon, authenticated;\s*\ngrant select, insert, update, delete on table public\.memoire_agent to authenticated;/);
  // limite : verrou consultatif par utilisateur avant le comptage (deux insertions simultanées ne dépassent pas 200)
  const lim = sql.slice(sql.indexOf("function public.memoire_limite()"), sql.indexOf("create trigger memoire_limite"));
  const iLock = lim.indexOf("perform pg_advisory_xact_lock(hashtext(new.user_id::text));"), iCount = lim.indexOf("select count(*) from public.memoire_agent");
  assert.ok(iLock >= 0 && iCount > iLock, "pg_advisory_xact_lock avant le comptage");
});

test("0009 : contenu_sensible — IBAN avec ≥ 12 chiffres, carte en groupes de 4, mots interdits ; immuable", () => {
  const f = sql.slice(sql.indexOf("function public.contenu_sensible(p text)"), sql.indexOf("$$;", sql.indexOf("function public.contenu_sensible(p text)")));
  assert.match(f, /immutable[\s\S]*set search_path = ''/);
  assert.ok(f.includes("regexp_matches(p, '[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]){11,30}', 'g') m"), "motif IBAN, toutes les correspondances");
  assert.ok(f.includes("where length(regexp_replace(m[1], '[^0-9]', '', 'g')) >= 12"), "au moins 12 chiffres dans la correspondance");
  assert.ok(f.includes("p ~ '(?<![0-9])[0-9]{4} ?[0-9]{4} ?[0-9]{4} ?[0-9]{1,7}(?![0-9])'"), "motif carte (groupes de 4, espaces seulement)");
  assert.ok(f.includes("p ~* '(mot de passe|password|code secret|code pin|identifiant de connexion)'"), "mots interdits");
  assert.doesNotMatch(f, /\(\[0-9\]\[ -\]\?\)\{12,18\}/, "ancien motif carte (suite de chiffres) retiré");
});

const integ = { skip: !hasServiceKey && SKIP_REASON };

test("intégration : visiteur anonyme lit fiches publiées et repères, n'écrit rien", integ, async () => {
  const admin = adminClient(), anon = userClient();
  const slug = "test-archive-" + Date.now();
  await admin.from("savoir_fiches").insert({ slug, theme: "epargne", titre: "Archivée", resume: "r", contenu: "c", sources: [{ titre: "s", url: "https://www.service-public.fr", consulte_le: "2026-10-10" }], statut: "archive", mis_a_jour_le: "2026-10-10" });
  try {
    const { data: vis } = await anon.from("savoir_fiches").select("slug").eq("slug", slug);
    assert.deepEqual(vis, [], "fiche archivée invisible");
    const { error: w } = await anon.from("reperes").insert({ cle: "pirate", libelle: "x", valeur: 1, unite: "%", date_effet: "2026-01-01", source_titre: "x", source_url: "https://x", verifie_le: "2026-01-01" });
    assert.ok(w, "écriture anonyme refusée");
    const { error: r } = await anon.from("reperes").select("cle").limit(1);
    assert.equal(r, null);
  } finally { await admin.from("savoir_fiches").delete().eq("slug", slug); }
});

test("intégration : mémoire privée, filtre sensible, limite, marquer_savoir_vu, export", integ, async () => {
  const a = await createTestUser("mem-a"), b = await createTestUser("mem-b");
  try {
    const ins = await a.client.from("memoire_agent").insert({ categorie: "contexte", contenu: "Prépare un achat de RP pour 2028", source: "Claude" }).select("id").single();
    assert.equal(ins.error, null);
    const { data: vuB } = await b.client.from("memoire_agent").select("id");
    assert.deepEqual(vuB, [], "b ne voit pas la mémoire de a");
    for (const bad of ["Mon IBAN est FR76 3000 6000 0112 3456 7890 189", "carte 4970 1012 3456 7890", "Mon mot de passe est chat"]) {
      const { error } = await a.client.from("memoire_agent").insert({ categorie: "contexte", contenu: bad });
      assert.ok(error, "refusé : " + bad);
    }
    // ISIN, années et montants en milliers acceptés (puis effacés pour garder le compte à 1)
    const okTextes = ["ETF IE00B4L5Y983 MSCI World", "ISIN FR0010315770 ETF", "Objectifs 2025-2026-2027-2028", "100 000 200 000 300 000"];
    const oks = await a.client.from("memoire_agent").insert(okTextes.map(contenu => ({ categorie: "explique", contenu }))).select("id");
    assert.equal(oks.error, null, "ISIN et chiffres courants acceptés");
    assert.equal((await a.client.from("memoire_agent").delete().in("id", oks.data.map(r => r.id))).error, null);
    const rows = Array.from({ length: 199 }, (_, i) => ({ categorie: "explique", contenu: "Notion " + i }));
    assert.equal((await a.client.from("memoire_agent").insert(rows)).error, null);
    const trop = await a.client.from("memoire_agent").insert({ categorie: "explique", contenu: "201e" });
    assert.match(String(trop.error?.message), /200 souvenirs/);
    const v1 = await a.client.rpc("marquer_savoir_vu", { p_client_id: "test" });
    assert.equal(v1.error, null); assert.equal(v1.data, null);
    const v2 = await a.client.rpc("marquer_savoir_vu", { p_client_id: "test" });
    assert.ok(v2.data, "deuxième appel : date précédente");
    const ex = await a.client.rpc("export_all");
    assert.equal(ex.data.memoire_agent.length, 200);
    const s = await a.client.rpc("chercher_savoir", { p_question: "livret", p_theme: null, p_limite: 3 });
    assert.equal(s.error, null);
  } finally { await deleteTestUser(a.id); await deleteTestUser(b.id); }
});
