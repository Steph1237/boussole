// Journal des décisions (migration 0013, spec 2026-10-10-cockpit.md § CK2) : contrôles statiques du SQL, puis intégration RLS
// avec SUPABASE_SERVICE_KEY (sinon ignorés).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasServiceKey, SKIP_REASON, createTestUser, deleteTestUser } from "./helpers/supabase.mjs";

const sql = readFileSync("supabase/migrations/0013_journal.sql", "utf8");
const bloc = (debut, fin) => {
  const i = sql.indexOf(debut);
  assert.ok(i >= 0, "introuvable : " + debut);
  return sql.slice(i, sql.indexOf(fin, i));
};

test("0013 : table journal privée — RLS propriétaire, droits retirés puis accordés, index", () => {
  assert.match(sql, /create table public\.journal \(/);
  assert.match(sql, /alter table public\.journal enable row level security/);
  for (const op of ["select", "insert", "update", "delete"]) assert.match(sql, new RegExp(`"journal: ${op}" on public\\.journal for ${op} to authenticated`));
  assert.match(sql, /"journal: update" on public\.journal for update to authenticated using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.doesNotMatch(sql, /on public\.journal for \w+ to anon/, "rien pour anon");
  assert.match(sql, /revoke all on table public\.journal from anon, authenticated;\s*\ngrant select, insert, update, delete on table public\.journal to authenticated;/);
  assert.match(sql, /create index journal_user on public\.journal \(user_id, cree_le desc\)/);
  assert.match(sql, /user_id\s+uuid not null default auth\.uid\(\) references auth\.users\(id\) on delete cascade/);
});

test("0013 : colonnes — types, statuts, longueurs, formes jsonb", () => {
  const t = bloc("create table public.journal (", "\n);");
  assert.match(t, /type\s+text not null check \(type in \('avis','decision','scenario','revue','hypothese','evenement'\)\)/);
  assert.match(t, /statut\s+text not null default 'a_relire' check \(statut in \('a_relire','actif','realise','abandonne','archive'\)\)/);
  assert.match(t, /titre\s+text not null check \(char_length\(btrim\(titre\)\) between 3 and 120\)/);
  assert.match(t, /synthese\s+text not null check \(char_length\(btrim\(synthese\)\) between 1 and 600\)/);
  assert.match(t, /raisonnement\s+text check \(raisonnement is null or char_length\(raisonnement\) <= 8000\)/);
  assert.match(t, /options\s+jsonb not null default '\[\]'::jsonb check \(jsonb_typeof\(options\) = 'array' and jsonb_array_length\(options\) <= 6/);
  assert.match(t, /liens\s+jsonb not null default '\{\}'::jsonb check \(jsonb_typeof\(liens\) = 'object'/);
  assert.match(t, /etat\s+jsonb not null default '\{\}'::jsonb check \(jsonb_typeof\(etat\) = 'object'/);
  assert.match(t, /historique\s+jsonb not null default '\[\]'::jsonb check \(jsonb_typeof\(historique\) = 'array'\)/);
  assert.match(t, /source\s+text check \(source is null or char_length\(source\) <= 100\)/);
  for (const c of ["date_decision date", "revue_le      date", "cree_le       timestamptz not null default now()", "maj_le        timestamptz not null default now()"]) assert.ok(t.includes(c), c);
  // Contrainte nommée : le front reconnaît « contenu_sensible » dans le message d'erreur (comme memoire_agent).
  assert.match(t, /constraint journal_contenu_sensible check \(not \(public\.contenu_sensible\(titre\) or public\.contenu_sensible\(synthese\) or public\.contenu_sensible\(raisonnement\)\)\)/);
});

test("0013 : limite 2 000 avec verrou consultatif avant le comptage", () => {
  const f = bloc("function public.journal_limite()", "create trigger journal_limite");
  assert.match(f, /set search_path = ''/);
  const iLock = f.indexOf("perform pg_advisory_xact_lock(hashtext(new.user_id::text));"), iCount = f.indexOf("select count(*) from public.journal");
  assert.ok(iLock >= 0 && iCount > iLock, "pg_advisory_xact_lock avant le comptage");
  assert.match(f, />= 2000/);
  assert.match(f, /errcode = '54000'/);
  assert.match(f, /new\.historique := '\[\]'::jsonb/, "historique vide à la création");
  assert.match(sql, /create trigger journal_limite before insert on public\.journal for each row execute function public\.journal_limite\(\)/);
});

test("0013 : historique — hors « à relire », 9 champs, notes en ajout seul, 200 au plus, non falsifiable ; état figé ; maj_le", () => {
  const f = bloc("function public.journal_historique()", "create trigger journal_historique");
  assert.match(f, /set search_path = ''/);
  assert.match(f, /new\.etat := old\.etat;/, "état figé immuable");
  assert.match(f, /new\.historique := old\.historique;/, "on repart toujours de l'ancien historique");
  assert.match(f, /new\.maj_le := now\(\);/);
  assert.match(f, /old\.statut <> 'a_relire'/);
  // rien ne se réécrit en silence : tous les champs éditables sont suivis
  assert.ok(f.includes("array['type','titre','synthese','raisonnement','statut','date_decision','revue_le','options','liens']"), "9 champs suivis");
  assert.match(f, /v_apres -> v_champ is distinct from v_avant -> v_champ/);
  assert.ok(f.includes("jsonb_build_object('le', now(), 'champ', v_champ, 'avant', v_avant -> v_champ, 'apres', v_apres -> v_champ)"), "entrée { le, champ, avant, apres }");
  // note ajoutée au raisonnement : seul le suffixe est conservé ; ancien raisonnement nul géré
  assert.match(f, /v_ancien text := coalesce\(old\.raisonnement, ''\)/);
  assert.match(f, /starts_with\(new\.raisonnement, v_ancien\)/);
  assert.ok(f.includes("jsonb_build_object('le', now(), 'champ', 'raisonnement', 'ajout', substr(new.raisonnement, char_length(v_ancien) + 1))"), "entrée { le, champ, ajout }");
  // plafond : 200 dernières entrées, documenté
  assert.match(f, /if v_n > 200 then[\s\S]*?with ordinality as h\(e, i\)[\s\S]*?where h\.i > v_n - 200;/);
  assert.match(sql, /garde les 200 dernières entrées/);
  assert.match(sql, /create trigger journal_historique before update on public\.journal for each row execute function public\.journal_historique\(\)/);
});

test("0013 : consentement dans profiles (3 valeurs, « demander » par défaut)", () => {
  assert.match(sql, /alter table public\.profiles add column if not exists journal_consentement text not null default 'demander'\s+constraint profiles_journal_consentement check \(journal_consentement in \('demander','prevenir','jamais'\)\)/);
});

test("0013 : export_all = définition de 0009 + journal", () => {
  const avant = readFileSync("supabase/migrations/0009_savoir_memoire.sql", "utf8");
  const exp = s => s.slice(s.lastIndexOf("create or replace function public.export_all()"));
  const e9 = exp(avant), e13 = exp(sql);
  assert.match(e13, /'journal',\s+\(select coalesce\(jsonb_agg\(to_jsonb\(j\) order by j\.cree_le\), '\[\]'\) from public\.journal j where j\.user_id = auth\.uid\(\)\)/);
  // Toutes les clés précédentes conservées, à l'identique.
  const cles = [...e9.matchAll(/^\s+'(\w+)',\s+(.+?),?$/gm)];
  assert.ok(cles.length >= 14, "clés de 0009 lues");
  for (const [, cle, expr] of cles) assert.ok(e13.includes(`'${cle}',`) && e13.includes(expr.replace(/,$/, "")), "clé conservée : " + cle);
  assert.match(e13, /revoke all on function public\.export_all\(\) from public, anon;\s*\ngrant execute on function public\.export_all\(\) to authenticated;/);
});

test("0013 : fonctions en search_path vide, noms qualifiés", () => {
  for (const f of ["journal_limite", "journal_historique"]) {
    const b = bloc(`function public.${f}()`, "$$;");
    assert.match(b, /set search_path = ''/);
    assert.doesNotMatch(b.replace(/public\.\w+/g, ""), /\bfrom (journal|profiles)\b/, "noms qualifiés");
  }
});

const integ = { skip: !hasServiceKey && SKIP_REASON };

test("intégration : journal privé, sensible refusé, historique, état figé, limite, export, consentement", integ, async () => {
  const a = await createTestUser("jrn-a"), b = await createTestUser("jrn-b");
  try {
    const base = { type: "decision", titre: "Garder le PEA", synthese: "On garde le PEA et on verse 300 €/mois.", source: "Claude", etat: { patrimoine_net: 120000 } };
    const ins = await a.client.from("journal").insert({ ...base, historique: [{ faux: true }] }).select("*").single();
    assert.equal(ins.error, null);
    const e = ins.data;
    assert.equal(e.statut, "a_relire");
    assert.deepEqual(e.historique, [], "historique forcé à vide à la création");
    assert.deepEqual((await b.client.from("journal").select("id")).data, [], "b ne voit pas le journal de a");
    const iban = await a.client.from("journal").insert({ ...base, raisonnement: "Virement depuis FR76 3000 6000 0112 3456 7890 189" });
    assert.match(String(iban.error?.message), /journal_contenu_sensible/);
    // à relire : aucune trace
    let r = await a.client.from("journal").update({ titre: "Garder le PEA (corrigé)" }).eq("id", e.id).select("historique").single();
    assert.deepEqual(r.data.historique, []);
    r = await a.client.from("journal").update({ statut: "actif" }).eq("id", e.id).select("historique").single();
    assert.deepEqual(r.data.historique, [], "première confirmation non historisée");
    r = await a.client.from("journal").update({ synthese: "On garde le PEA, 400 €/mois.", etat: { pirate: 1 }, historique: [] }).eq("id", e.id).select("historique, etat").single();
    assert.equal(r.data.historique.length, 1);
    assert.equal(r.data.historique[0].champ, "synthese");
    assert.deepEqual(r.data.etat, { patrimoine_net: 120000 }, "état figé");
    r = await a.client.from("journal").update({ raisonnement: "\n\n— Note du 2026-10-10 (Claude) : versé." }).eq("id", e.id).select("historique").single();
    assert.deepEqual(Object.keys(r.data.historique[1]).sort(), ["ajout", "champ", "le"], "note ajoutée : suffixe seul");
    // b ne peut rien modifier chez a
    const pirate = await b.client.from("journal").update({ titre: "Piraté" }).eq("id", e.id).select("id");
    assert.deepEqual(pirate.data, []);
    // limite
    const rows = Array.from({ length: 1999 }, (_, i) => ({ type: "avis", titre: "Avis " + i, synthese: "s" }));
    assert.equal((await a.client.from("journal").insert(rows)).error, null);
    const trop = await a.client.from("journal").insert({ type: "avis", titre: "De trop", synthese: "s" });
    assert.match(String(trop.error?.message), /2 000 entrées/);
    const ex = await a.client.rpc("export_all");
    assert.equal(ex.data.journal.length, 2000);
    // consentement
    const p = await a.client.from("profiles").select("journal_consentement").single();
    assert.equal(p.data.journal_consentement, "demander");
    assert.equal((await a.client.from("profiles").update({ journal_consentement: "jamais" }).eq("user_id", a.id)).error, null);
    assert.ok((await a.client.from("profiles").update({ journal_consentement: "toujours" }).eq("user_id", a.id)).error, "valeur inconnue refusée");
  } finally { await deleteTestUser(a.id); await deleteTestUser(b.id); }
});

