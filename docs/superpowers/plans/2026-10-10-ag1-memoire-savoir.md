# AG1 : mémoire privée et savoir commun — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** l'agent expert de Boussole se souvient de chaque utilisateur (mémoire privée, visible et effaçable) et s'appuie sur un savoir commun sourcé (fiches + repères chiffrés), via le connecteur MCP v6 et deux nouvelles pages de l'app.

**Architecture:** trois tables Supabase (`savoir_fiches`, `reperes` en lecture publique ; `memoire_agent` privée, RLS) + RPC `chercher_savoir` et `marquer_savoir_vu` ; le connecteur gagne `savoir.ts` et `memoire.ts` (outils `demarrer_session`, `consulter_savoir`, `reperes`, `memoriser`, `se_souvenir`, `oublier`) ; l'app gagne un module pur `reperes.js`, deux vues (`memoire-view`, `fiches-view`) et le contrat de store `S.memoire` / `S.savoir`.

**Tech Stack:** Postgres (Supabase, RLS, tsvector `french`), Deno Edge Function (Hono, @modelcontextprotocol/sdk 1.25.3, zod 4), JS vanilla UMD/IIFE, `node --test`.

Spec : `docs/superpowers/specs/2026-10-10-ag1-memoire-savoir.md`. Dépôt : `/Users/stephane/boussole`. Tests : `npm test` (ne pas lancer `node --test test/` : utiliser le glob). Conventions : français partout (commentaires, messages, textes UI), apostrophes typographiques dans l'UI (’ non requis : le code existant utilise `'`), pas de `"type":"module"` dans package.json.

## Fichiers

| Fichier | Rôle | Tâche |
|---|---|---|
| `supabase/migrations/0009_savoir_memoire.sql` | tables, RLS, RPC, filtre sensible, export | 1 |
| `test/savoir-db.test.mjs` | contrôles statiques SQL + intégration (clé de service) | 1 |
| `supabase/migrations/0010_savoir_contenu.sql` | repères vérifiés + ~19 fiches | 2 |
| `test/savoir-contenu.test.mjs` | qualité du contenu (sources, slugs, thèmes, repères) | 2 |
| `web/src/reperes.js` + `test/reperes.test.mjs` | module pur des repères | 3 |
| `supabase/functions/mcp/savoir.ts`, `memoire.ts`, `index.ts` | connecteur v6 | 4 |
| `test/mcp.test.mjs` | tests connecteur | 4 |
| `web/src/store-supabase.js`, `store-demo.js`, `demo-data.js`, `app.js`, `shell.html`, `build.mjs`, `test/store-contract.test.mjs`, `test/shell.test.mjs` | contrat de store + câblage des deux vues | 5 |
| `web/src/memoire-view.{html,css,js}` + `test/memoire-view.test.mjs` | Profil › Mémoire de l'agent | 6 |
| `web/src/fiches-view.{html,css,js}` + `test/fiches-view.test.mjs` | Recommandations › Fiches | 7 |
| `web/src/plan-view.js` + `test/plan-view.test.mjs` | repère Livret A lu dans S.savoir | 8 |

Tâches parallélisables : 1, 2, 3 ensemble ; puis 4, 5 ; puis 6, 7, 8 (fichiers disjoints). Déploiement (tâche 9) fait par le contrôleur.

---

### Task 1 : migration 0009 (tables, RLS, RPC)

**Files:** Create `supabase/migrations/0009_savoir_memoire.sql`, `test/savoir-db.test.mjs`.

- [ ] **Step 1 : test statique et d'intégration (échoue : fichier absent)**

`test/savoir-db.test.mjs` :
```js
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

test("0009 : mémoire — propriétaire seul, limite 200, filtre sensible, export", () => {
  for (const op of ["select", "insert", "update", "delete"]) assert.match(sql, new RegExp(`"memoire_agent: ${op}" on public\\.memoire_agent for ${op} to authenticated`));
  assert.match(sql, /memoire_limite/);
  assert.match(sql, />= 200/);
  assert.match(sql, /check \(not public\.contenu_sensible\(contenu\)\)/);
  assert.match(sql, /'memoire_agent',/);
  assert.match(sql, /function public\.marquer_savoir_vu\(p_client_id text\)/);
  assert.match(sql, /function public\.chercher_savoir\(p_question text default null, p_theme text default null, p_limite int default 5\)/);
  for (const f of ["contenu_sensible", "chercher_savoir", "marquer_savoir_vu", "memoire_limite"]) assert.match(sql, new RegExp(`${f}[\\s\\S]*?set search_path = ''`));
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
```

- [ ] **Step 2 :** `node --test test/savoir-db.test.mjs` → FAIL (ENOENT).

- [ ] **Step 3 : écrire la migration**

`supabase/migrations/0009_savoir_memoire.sql` :
```sql
-- Boussole : savoir commun de l'agent (fiches, repères) et mémoire privée (AG1, docs/superpowers/specs/2026-10-10-ag1-memoire-savoir.md).
-- Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "savoir_memoire").
--   savoir_fiches : fiches pédagogiques sourcées, lisibles par tous si publiées ; écrites par migration (AG1) puis par l'éditeur (AG2).
--   reperes       : chiffres de référence (taux, plafonds, normes) avec source et date de vérification ; lisibles par tous.
--   memoire_agent : ce que l'agent retient de chaque utilisateur ; privée (RLS), 200 souvenirs au plus, contenu sensible refusé.

-- ---------------------------------------------------------------------------
-- Filtre de contenu sensible (même règle que supabase/functions/mcp/memoire.ts, SENSIBLE)
-- ---------------------------------------------------------------------------
create or replace function public.contenu_sensible(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
       p ~ '[A-Z]{2}[0-9]{2}( ?[A-Z0-9]){11,30}'
    or p ~ '([0-9][ -]?){12,18}[0-9]'
    or p ~* '(mot de passe|password|code secret|code pin|identifiant de connexion)', false);
$$;

-- ---------------------------------------------------------------------------
-- Fiches
-- ---------------------------------------------------------------------------
create table public.savoir_fiches (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  theme         text not null check (theme in ('epargne','enveloppes','fiscalite','immobilier','retraite','protection','marches','comportement','credit')),
  titre         text not null check (char_length(titre) between 3 and 120),
  resume        text not null check (char_length(resume) between 1 and 400),
  contenu       text not null check (char_length(contenu) between 1 and 12000),
  mots_cles     text[] not null default '{}',
  sources       jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) >= 1),
  version       int not null default 1 check (version >= 1),
  statut        text not null default 'publie' check (statut in ('publie','archive')),
  mis_a_jour_le date not null default current_date,
  cree_le       timestamptz not null default now(),
  recherche     tsvector generated always as (
    setweight(to_tsvector('french', titre), 'A') ||
    setweight(to_tsvector('french', resume || ' ' || array_to_string(mots_cles, ' ')), 'B') ||
    setweight(to_tsvector('french', contenu), 'C')) stored
);
create index savoir_fiches_recherche on public.savoir_fiches using gin (recherche);
create index savoir_fiches_maj on public.savoir_fiches (mis_a_jour_le desc);

alter table public.savoir_fiches enable row level security;
create policy "savoir_fiches: lecture" on public.savoir_fiches for select to anon, authenticated using (statut = 'publie');
grant select on table public.savoir_fiches to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Repères
-- ---------------------------------------------------------------------------
create table public.reperes (
  cle          text primary key check (cle ~ '^[a-z0-9_]{2,60}$'),
  libelle      text not null check (char_length(libelle) between 2 and 120),
  valeur       numeric not null,
  unite        text not null check (unite in ('%','€','ans')),
  date_effet   date not null,
  source_titre text not null,
  source_url   text not null check (source_url ~ '^https://'),
  verifie_le   date not null,
  mode         text not null default 'manuel' check (mode in ('auto','manuel'))
);
alter table public.reperes enable row level security;
create policy "reperes: lecture" on public.reperes for select to anon, authenticated using (true);
grant select on table public.reperes to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recherche dans le savoir (security invoker : RLS → fiches publiées seulement)
-- ---------------------------------------------------------------------------
create or replace function public.chercher_savoir(p_question text default null, p_theme text default null, p_limite int default 5)
returns table (slug text, theme text, titre text, resume text, mis_a_jour_le date, sources jsonb, rang real)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.slug, f.theme, f.titre, f.resume, f.mis_a_jour_le, f.sources,
         case when nullif(btrim(p_question), '') is null then 0::real
              else ts_rank_cd(f.recherche, websearch_to_tsquery('french', p_question)) end as rang
    from public.savoir_fiches f
   where (p_theme is null or f.theme = p_theme)
     and (nullif(btrim(p_question), '') is null or f.recherche @@ websearch_to_tsquery('french', p_question))
   order by rang desc, f.mis_a_jour_le desc
   limit least(greatest(coalesce(p_limite, 5), 1), 10);
$$;
revoke all on function public.chercher_savoir(text, text, int) from public;
grant execute on function public.chercher_savoir(text, text, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mémoire de l'agent (privée)
-- ---------------------------------------------------------------------------
create table public.memoire_agent (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  categorie text not null check (categorie in ('contexte','preference','projet','decision','explique','a_suivre')),
  contenu   text not null check (char_length(btrim(contenu)) between 1 and 500) check (not public.contenu_sensible(contenu)),
  echeance  date check (echeance is null or categorie = 'a_suivre'),
  epingle   boolean not null default false,
  source    text check (source is null or char_length(source) <= 100),
  cree_le   timestamptz not null default now(),
  maj_le    timestamptz not null default now()
);
create index memoire_agent_user on public.memoire_agent (user_id, cree_le desc);

alter table public.memoire_agent enable row level security;
create policy "memoire_agent: select" on public.memoire_agent for select to authenticated using ((select auth.uid()) = user_id);
create policy "memoire_agent: insert" on public.memoire_agent for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "memoire_agent: update" on public.memoire_agent for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "memoire_agent: delete" on public.memoire_agent for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.memoire_agent from anon;
grant select, insert, update, delete on table public.memoire_agent to authenticated;

-- 200 souvenirs au plus par utilisateur ; maj_le tenu à jour.
create or replace function public.memoire_limite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.memoire_agent m where m.user_id = new.user_id) >= 200 then
      raise exception 'Mémoire pleine : 200 souvenirs au plus. Supprimez-en dans Boussole › Profil et données › Mémoire de l''agent.' using errcode = '54000';
    end if;
  else
    new.maj_le := now();
  end if;
  return new;
end;
$$;
create trigger memoire_limite before insert or update on public.memoire_agent for each row execute function public.memoire_limite();

-- ---------------------------------------------------------------------------
-- Nouveautés vues : date de la session précédente, par client (demarrer_session)
-- ---------------------------------------------------------------------------
alter table public.connexions_assistant add column savoir_vu_le timestamptz;

create or replace function public.marquer_savoir_vu(p_client_id text)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  text := coalesce(left(nullif(btrim(p_client_id), ''), 200), 'session');
  v_avant timestamptz;
begin
  if v_uid is null then raise exception 'non authentifié' using errcode = '42501'; end if;
  select c.savoir_vu_le into v_avant from public.connexions_assistant c where c.user_id = v_uid and c.client_id = v_id for update;
  insert into public.connexions_assistant as c (user_id, client_id, savoir_vu_le) values (v_uid, v_id, now())
  on conflict (user_id, client_id) do update set savoir_vu_le = now();
  return v_avant;
end;
$$;
revoke all on function public.marquer_savoir_vu(text) from public, anon;
grant execute on function public.marquer_savoir_vu(text) to authenticated;

-- ---------------------------------------------------------------------------
-- export_all() : + memoire_agent
-- ---------------------------------------------------------------------------
create or replace function public.export_all()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at',  now(),
    'profile',      (select to_jsonb(p) from public.profiles p where p.user_id = auth.uid()),
    'biens',        (select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at), '[]') from public.biens b where b.user_id = auth.uid()),
    'credits',      (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]') from public.credits c where c.user_id = auth.uid()),
    'positions',    (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from public.positions x where x.user_id = auth.uid()),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.date, t.created_at), '[]') from public.transactions t where t.user_id = auth.uid()),
    'snapshots',    (select coalesce(jsonb_agg(to_jsonb(s) order by s.date), '[]') from public.snapshots s where s.user_id = auth.uid()),
    'config',       (select coalesce(jsonb_agg(to_jsonb(k)), '[]') from public.config k where k.user_id = auth.uid()),
    'status',       (select coalesce(jsonb_agg(to_jsonb(st)), '[]') from public.status st where st.user_id = auth.uid()),
    'budget',       (select to_jsonb(bu) from public.budgets bu where bu.user_id = auth.uid()),
    'objectifs',    (select coalesce(jsonb_agg(to_jsonb(o) order by o.priorite, o.created_at), '[]') from public.objectifs o where o.user_id = auth.uid()),
    'propositions', (select coalesce(jsonb_agg(to_jsonb(pr) order by pr.cree_le), '[]') from public.propositions pr where pr.user_id = auth.uid()),
    'connexions_assistant', (select coalesce(jsonb_agg(to_jsonb(ca) order by ca.premier_le), '[]') from public.connexions_assistant ca where ca.user_id = auth.uid()),
    'memoire_agent', (select coalesce(jsonb_agg(to_jsonb(m) order by m.cree_le), '[]') from public.memoire_agent m where m.user_id = auth.uid())
  );
$$;
revoke all on function public.export_all() from public, anon;
grant execute on function public.export_all() to authenticated;
```
Note : le test statique cherche `memoire_limite[\s\S]*?set search_path = ''` (présent dans la fonction du déclencheur).

- [ ] **Step 4 :** `node --test test/savoir-db.test.mjs` → statiques PASS, intégration SKIP.
- [ ] **Step 5 :** commit `Migration 0009 : savoir commun (fiches, repères, recherche) et mémoire privée de l'agent`.

---

### Task 2 : contenu initial vérifié (repères + fiches)

**Files:** Create `supabase/migrations/0010_savoir_contenu.sql`, `test/savoir-contenu.test.mjs`.

Règles éditoriales (impératives) :
- **Chaque chiffre est vérifié en ligne aujourd'hui (2026-10-10)** sur une source officielle (service-public.fr, impots.gouv.fr, economie.gouv.fr, banque-france.fr, amf-france.org, hcsf / economie.gouv.fr, urssaf.fr, legifrance.gouv.fr). Noter la date d'effet réelle. Ne jamais reprendre une valeur de mémoire. Si une valeur ne peut pas être confirmée, ne pas créer le repère et le signaler dans le rapport.
- Fiches **reformulées** (aucune phrase copiée), 250 à 700 mots, markdown simple (titres `##`, listes `-`, gras `**`, liens `[texte](https://…)`), ton pédagogique, vouvoiement, aucune recommandation de produit ni de fournisseur, se terminent par « Indicateur pédagogique, pas un conseil en investissement. » n'est PAS requis (l'UI l'affiche) ; un chiffre réglementaire cité nomme le repère (« voir le repère Taux du Livret A ») ou porte sa date.
- 1 à 3 sources par fiche : `{"titre": "...", "url": "https://...", "consulte_le": "2026-10-10"}`.

Repères à créer (clé → libellé, unité) : `livret_a_taux` (Taux du Livret A, %), `livret_a_plafond` (Plafond du Livret A, €), `ldds_plafond` (Plafond du LDDS, €), `lep_taux` (Taux du LEP, %), `lep_plafond` (Plafond du LEP, €), `pea_plafond` (Plafond de versements du PEA, €), `pfu_taux` (Prélèvement forfaitaire unique, % global prélèvements sociaux inclus), `av_abattement_seul` (Abattement annuel assurance-vie après 8 ans, personne seule, €), `av_abattement_couple` (idem couple, €), `hcsf_taux_effort` (Taux d'effort maximal HCSF, %), `hcsf_duree_max` (Durée maximale de crédit immobilier HCSF, ans), `pass` (Plafond annuel de la Sécurité sociale, €). Valeurs en nombres (3 pour 3 %).

Fiches (slug → thème) : `epargne-de-precaution` epargne · `livrets-reglementes` epargne · `ordre-de-priorite-epargne` epargne · `pea` enveloppes · `assurance-vie` enveloppes · `per` retraite · `compte-titres-fiscalite` fiscalite · `transmission-bases` fiscalite · `allocation-profil-de-risque` marches · `diversification` marches · `frais-et-ter` marches · `investissement-programme` marches · `crises-et-recuperation` marches · `crypto-actifs` marches · `taux-endettement` credit · `assurance-emprunteur` credit · `acheter-ou-louer` immobilier · `prevoyance` protection · `biais-comportementaux` comportement.

- [ ] **Step 1 : test (échoue)**

`test/savoir-contenu.test.mjs` :
```js
// Contenu initial du savoir commun (migration 0010) : repères et fiches complets, sourcés, sans texte de remplissage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/0010_savoir_contenu.sql", "utf8");
const REPERES = ["livret_a_taux", "livret_a_plafond", "ldds_plafond", "lep_taux", "lep_plafond", "pea_plafond", "pfu_taux", "av_abattement_seul", "av_abattement_couple", "hcsf_taux_effort", "hcsf_duree_max", "pass"];
const FICHES = ["epargne-de-precaution", "livrets-reglementes", "ordre-de-priorite-epargne", "pea", "assurance-vie", "per", "compte-titres-fiscalite", "transmission-bases", "allocation-profil-de-risque", "diversification", "frais-et-ter", "investissement-programme", "crises-et-recuperation", "crypto-actifs", "taux-endettement", "assurance-emprunteur", "acheter-ou-louer", "prevoyance", "biais-comportementaux"];
const OFFICIELS = /^https:\/\/(www\.)?(service-public\.fr|impots\.gouv\.fr|economie\.gouv\.fr|banque-france\.fr|amf-france\.org|legifrance\.gouv\.fr|urssaf\.fr|entreprendre\.service-public\.fr|abc-economie\.banque-france\.fr|hcsf\.fr|info-retraite\.fr|cnil\.fr|insee\.fr|acpr\.banque-france\.fr)/;

test("0010 : tous les repères, sources officielles https, idempotent", () => {
  for (const k of REPERES) assert.match(sql, new RegExp(`'${k}'`), "repère manquant : " + k);
  assert.match(sql, /insert into public\.reperes[\s\S]*on conflict \(cle\) do update/);
  const urls = [...sql.matchAll(/'(https:\/\/[^']+)'/g)].map(m => m[1]);
  assert.ok(urls.length >= REPERES.length);
});

test("0010 : toutes les fiches, chacune avec au moins une source officielle", () => {
  assert.match(sql, /insert into public\.savoir_fiches[\s\S]*on conflict \(slug\) do update/);
  for (const s of FICHES) {
    const i = sql.indexOf(`'${s}'`);
    assert.ok(i >= 0, "fiche manquante : " + s);
    const bloc = sql.slice(i, sql.indexOf("'::jsonb", i) + 8);
    const urls = [...bloc.matchAll(/"url":\s*"([^"]+)"/g)].map(m => m[1]);
    assert.ok(urls.length >= 1 && urls.some(u => OFFICIELS.test(u)), "source officielle manquante : " + s);
  }
});

test("0010 : pas de texte de remplissage ni de recommandation de produit", () => {
  assert.doesNotMatch(sql, /TODO|TBD|lorem|XXX|à compléter/i);
  assert.doesNotMatch(sql, /\b(achetez|souscrivez chez|nous recommandons)\b/i);
});
```

- [ ] **Step 2 :** lancer → FAIL (ENOENT).
- [ ] **Step 3 :** rechercher et vérifier chaque valeur (WebSearch / WebFetch), puis écrire la migration au format :
```sql
-- Boussole : contenu initial du savoir commun (AG1). Valeurs vérifiées le 2026-10-10 sur les sources citées.
-- Appliqué avec apply_migration (name = "savoir_contenu"). Idempotent (on conflict … do update).
insert into public.reperes (cle, libelle, valeur, unite, date_effet, source_titre, source_url, verifie_le) values
  ('livret_a_taux', 'Taux du Livret A', <valeur vérifiée>, '%', '<date d''effet>', 'Banque de France — taux des livrets réglementés', 'https://…', '2026-10-10'),
  …
on conflict (cle) do update set libelle = excluded.libelle, valeur = excluded.valeur, unite = excluded.unite, date_effet = excluded.date_effet,
  source_titre = excluded.source_titre, source_url = excluded.source_url, verifie_le = excluded.verifie_le;

insert into public.savoir_fiches (slug, theme, titre, resume, contenu, mots_cles, sources, mis_a_jour_le) values
  ('epargne-de-precaution', 'epargne', 'L''épargne de précaution', '<résumé ≤ 400>', $f$<contenu markdown>$f$, array['matelas','urgence','livret'],
   '[{"titre": "…", "url": "https://…", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),
  …
on conflict (slug) do update set theme = excluded.theme, titre = excluded.titre, resume = excluded.resume, contenu = excluded.contenu,
  mots_cles = excluded.mots_cles, sources = excluded.sources, mis_a_jour_le = excluded.mis_a_jour_le, version = public.savoir_fiches.version + 1;
```
(Les `<…>` ci-dessus sont les seuls emplacements à remplir par la recherche ; le contenu `$f$…$f$` évite d'échapper les apostrophes.)
- [ ] **Step 4 :** test PASS ; rapport : tableau des repères (valeur, date d'effet, source) et toute valeur non confirmée.
- [ ] **Step 5 :** commit `Contenu initial du savoir : repères vérifiés et 19 fiches sourcées`.

---

### Task 3 : module pur `reperes.js`

**Files:** Create `web/src/reperes.js`, `test/reperes.test.mjs`.

- [ ] **Step 1 : test**
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const R = createRequire(import.meta.url)("../web/src/reperes.js");
const L = [
  { cle: "livret_a_taux", libelle: "Taux du Livret A", valeur: 1.7, unite: "%", dateEffet: "2025-08-01", sourceTitre: "Banque de France", sourceUrl: "https://www.banque-france.fr", verifieLe: "2026-10-10" },
  { cle: "pea_plafond", libelle: "Plafond PEA", valeur: 150000, unite: "€", dateEffet: "2014-01-01", sourceTitre: "service-public", sourceUrl: "https://www.service-public.fr", verifieLe: "2026-01-01" },
];
test("valeur : trouvée, ou défaut si absente / liste vide", () => {
  assert.equal(R.valeur(L, "livret_a_taux", 2.4), 1.7);
  assert.equal(R.valeur(L, "inconnu", 3), 3);
  assert.equal(R.valeur(null, "livret_a_taux", 2.4), 2.4);
});
test("aVerifier : vérifié il y a plus de 180 jours", () => {
  assert.equal(R.aVerifier(L[0], "2026-10-10"), false);
  assert.equal(R.aVerifier(L[1], "2026-10-10"), true);
  assert.equal(R.A_VERIFIER_JOURS, 180);
});
test("format : unité française", () => {
  assert.equal(R.format(L[0]).replace(/ | /g, " "), "1,7 %");
  assert.equal(R.format(L[1]).replace(/ | /g, " "), "150 000 €");
  assert.equal(R.format({ valeur: 25, unite: "ans" }), "25 ans");
});
test("depuisLignes : lignes SQL → vue camelCase", () => {
  const v = R.depuisLignes([{ cle: "x", libelle: "X", valeur: "2.5", unite: "%", date_effet: "2026-01-01", source_titre: "s", source_url: "https://s", verifie_le: "2026-02-01", mode: "manuel" }]);
  assert.deepEqual(v[0], { cle: "x", libelle: "X", valeur: 2.5, unite: "%", dateEffet: "2026-01-01", sourceTitre: "s", sourceUrl: "https://s", verifieLe: "2026-02-01", mode: "manuel" });
});
```
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 :**
```js
/* Repères chiffrés du savoir commun (table reperes) : lecture avec valeur de secours, ancienneté, format français.
   Pur, sans DOM. S.savoir.reperes = [{ cle, libelle, valeur, unite, dateEffet, sourceTitre, sourceUrl, verifieLe, mode }]. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Reperes = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const A_VERIFIER_JOURS = 180;
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const trouver = (liste, cle) => (Array.isArray(liste) ? liste.find(r => r && r.cle === cle) : null) || null;
  /** Valeur du repère `cle`, ou `defaut` s'il est absent (table injoignable, démo sans repère). */
  function valeur(liste, cle, defaut) { const r = trouver(liste, cle); return r && isFinite(+r.valeur) ? +r.valeur : defaut; }
  /** Vrai si la dernière vérification date de plus de 180 jours. */
  function aVerifier(r, today) {
    if (!r || !r.verifieLe) return true;
    return (Date.parse(today || new Date().toISOString().slice(0, 10)) - Date.parse(r.verifieLe)) / 864e5 > A_VERIFIER_JOURS;
  }
  function format(r) { return r ? nf.format(+r.valeur) + " " + r.unite : ""; }
  function depuisLignes(rows) {
    return (rows || []).map(x => ({ cle: x.cle, libelle: x.libelle, valeur: +x.valeur, unite: x.unite, dateEffet: x.date_effet,
      sourceTitre: x.source_titre, sourceUrl: x.source_url, verifieLe: x.verifie_le, mode: x.mode }));
  }
  return { valeur, aVerifier, format, depuisLignes, trouver, A_VERIFIER_JOURS };
});
```
Note : `format` du nombre utilise l'espace fine insécable de `Intl` pour les milliers ; le test normalise.
- [ ] **Step 4 :** PASS. **Step 5 :** commit `Module pur des repères (valeur de secours, ancienneté, format)`.

---

### Task 4 : connecteur v6 (`savoir.ts`, `memoire.ts`)

**Files:** Create `supabase/functions/mcp/savoir.ts`, `supabase/functions/mcp/memoire.ts` ; Modify `supabase/functions/mcp/index.ts`, `test/mcp.test.mjs`.

Contexte : `index.ts` construit un serveur par requête (`buildServer({ db, user })`), avec `wrap`, `ok`, `fail`, `UserError`, `must`, `RO`, `RW`, `lireEtat()` (renvoie `{ vue, enAttente, donnees }`), `clientDuJeton(token)`. Les nouveaux fichiers reçoivent ce dont ils ont besoin par paramètre (pas d'import circulaire).

- [ ] **Step 1 : tests (échouent)** — dans `test/mcp.test.mjs` :
  - ajouter à `TOOLS` : `"demarrer_session", "consulter_savoir", "reperes", "memoriser", "se_souvenir", "oublier"` ;
  - lire aussi `savoir.ts` et `memoire.ts` : `const srcAll = [src, readFileSync(path("supabase/functions/mcp/savoir.ts"),"utf8"), readFileSync(path("supabase/functions/mcp/memoire.ts"),"utf8")].join("\n")` et faire chercher les outils (`outil(nom)`) et les tests « tous les outils enregistrés » dans le code sans commentaires de `srcAll` ;
  - test d'imports deno.json : ignorer les imports relatifs (`if (imp[1].startsWith("./")) continue;`) et vérifier `import { registerSavoir } from "./savoir.ts"` et `import { registerMemoire, SENSIBLE } from "./memoire.ts"` dans index.ts ;
  - test « aucune écriture directe » : autoriser `memoire_agent` (insert/update/delete) et les RPC `marquer_savoir_vu`, `chercher_savoir` ;
  - nouveaux tests :
```js
test("AG1 : demarrer_session — conduite experte, mémoire, nouveautés par marquer_savoir_vu, lecture", () => {
  const o = outil("demarrer_session");
  assert.match(o, /marquer_savoir_vu/);
  assert.match(o, /CONDUITE_EXPERT/);
  assert.match(o, /a_suivre_echus/);
  assert.match(o, /onboarding_conseille/);
  const instr = code.slice(code.indexOf("const INSTRUCTIONS"), code.indexOf("].join", code.indexOf("const INSTRUCTIONS")));
  assert.match(instr, /demarrer_session/);
});
test("AG1 : conduite experte — reperes avant tout chiffre, consulter_savoir, mémoire effaçable, jamais d'identifiants", () => {
  const c = srcAll.slice(srcAll.indexOf("CONDUITE_EXPERT = ["), srcAll.indexOf("].join", srcAll.indexOf("CONDUITE_EXPERT = [")));
  for (const m of [/reperes/, /consulter_savoir/, /memoriser/, /Mémoire de l'agent/, /IBAN/, /mot(s)? de passe/, /pas un conseil en investissement/]) assert.match(c, m);
});
test("AG1 : filtre sensible identique au SQL (IBAN, carte, mots interdits) et ISIN accepté", () => {
  const m = srcAll.match(/export const SENSIBLE = \[([\s\S]*?)\];/);
  assert.ok(m, "SENSIBLE exporté");
  const sql = readFileSync(path("supabase/migrations/0009_savoir_memoire.sql"), "utf8");
  for (const motif of ["[A-Z]{2}[0-9]{2}( ?[A-Z0-9]){11,30}", "([0-9][ -]?){12,18}[0-9]", "mot de passe|password|code secret|code pin|identifiant de connexion"]) {
    assert.ok(sql.includes(motif) && m[1].includes(motif), "motif partagé : " + motif);
  }
  const res = [new RegExp("[A-Z]{2}[0-9]{2}( ?[A-Z0-9]){11,30}"), new RegExp("([0-9][ -]?){12,18}[0-9]"), new RegExp("mot de passe|password|code secret|code pin|identifiant de connexion", "i")];
  const sensible = t => res.some(r => r.test(t));
  assert.equal(sensible("FR76 3000 6000 0112 3456 7890 189"), true);
  assert.equal(sensible("IE00B4L5Y983 et FR0010315770"), false);
  assert.equal(sensible("Achat prévu à 350 000 € en 2028"), false);
});
test("AG1 : consulter_savoir et reperes en lecture seule, memoriser / oublier écrivent dans memoire_agent", () => {
  assert.match(outil("consulter_savoir"), /chercher_savoir/);
  assert.match(outil("consulter_savoir"), /RO/);
  assert.match(outil("reperes"), /from\("reperes"\)/);
  assert.match(outil("memoriser"), /from\("memoire_agent"\)\.insert/);
  assert.match(outil("oublier"), /from\("memoire_agent"\)\.delete/);
});
```
- [ ] **Step 2 :** `node --test test/mcp.test.mjs` → FAIL.
- [ ] **Step 3 : `memoire.ts`**
```ts
// Mémoire de l'agent (AG1) : ce que l'agent retient de l'utilisateur, privé (table memoire_agent, RLS), visible et
// effaçable dans Boussole › Profil et données › Mémoire de l'agent. Écriture directe : ne touche pas au bilan.
import { z } from "zod";

/* Mêmes motifs que public.contenu_sensible (supabase/migrations/0009_savoir_memoire.sql). */
export const SENSIBLE = [
  "[A-Z]{2}[0-9]{2}( ?[A-Z0-9]){11,30}",
  "([0-9][ -]?){12,18}[0-9]",
  "mot de passe|password|code secret|code pin|identifiant de connexion",
];
const RE = SENSIBLE.map((m, i) => new RegExp(m, i === 2 ? "i" : ""));
export const estSensible = (t: string) => RE.some((r) => r.test(t));

export const CATEGORIES = ["contexte", "preference", "projet", "decision", "explique", "a_suivre"] as const;
const COLS = "id, categorie, contenu, echeance, epingle, source, cree_le, maj_le";

export async function lireMemoire(db: any, must: any, categorie?: string) {
  let req = db.from("memoire_agent").select(COLS).order("epingle", { ascending: false }).order("cree_le", { ascending: false }).limit(200);
  if (categorie) req = req.eq("categorie", categorie);
  return (must("memoire_agent", await req) as any[]) ?? [];
}

export function registerMemoire(server: any, h: { db: any; wrap: any; must: any; UserError: any; RO: any; RW: any; source: string }) {
  const { db, wrap, must, UserError, RO, RW, source } = h;
  const Cat = z.enum(CATEGORIES, { error: "Catégorie invalide : " + CATEGORIES.join(", ") + "." });

  server.registerTool("memoriser", {
    title: "Retenir",
    description: "Retient une information durable sur l'utilisateur pour les prochaines conversations : contexte (situation de vie), preference (façon d'échanger, sujets sensibles), projet, decision (prise par l'utilisateur), explique (notion déjà expliquée), a_suivre (point à reprendre, avec echeance AAAA-MM-JJ). Une phrase courte et factuelle. Ne pas retenir ce qui est déjà dans le bilan. Jamais d'identifiants, IBAN, numéros de compte ou de carte, mots de passe (refusés). Demander l'accord avant une information sensible (santé, famille, emploi). L'utilisateur voit et efface sa mémoire dans Boussole › Profil et données › Mémoire de l'agent.",
    inputSchema: z.strictObject({
      categorie: Cat,
      contenu: z.string().trim().min(1).max(500, { error: "500 caractères au plus." }),
      echeance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Date AAAA-MM-JJ." }).optional().describe("Seulement pour a_suivre."),
      epingle: z.boolean().optional().describe("true pour un souvenir à toujours garder en tête."),
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    if (estSensible(a.contenu)) throw new UserError("Refusé : ce texte ressemble à un identifiant, un IBAN, un numéro de carte ou un mot de passe. Boussole ne retient jamais ces informations.");
    if (a.echeance && a.categorie !== "a_suivre") throw new UserError("echeance : réservée à la catégorie a_suivre.");
    const row = must("memoire_agent", await db.from("memoire_agent").insert({ categorie: a.categorie, contenu: a.contenu, echeance: a.echeance ?? null, epingle: !!a.epingle, source }).select(COLS).single());
    return { retenu: row, rappel: "Visible et effaçable dans Boussole › Profil et données › Mémoire de l'agent." };
  }));

  server.registerTool("se_souvenir", {
    title: "Ce que je sais de l'utilisateur",
    description: "Souvenirs de l'agent sur l'utilisateur (épinglés d'abord, puis les plus récents), éventuellement filtrés par catégorie.",
    inputSchema: z.strictObject({ categorie: Cat.optional() }),
    annotations: RO,
  }, wrap(async ({ categorie }: any) => { const l = await lireMemoire(db, must, categorie); return { nombre: l.length, souvenirs: l }; }));

  server.registerTool("oublier", {
    title: "Oublier",
    description: "Efface un ou plusieurs souvenirs (identifiants renvoyés par se_souvenir), à la demande de l'utilisateur ou quand une information est périmée.",
    inputSchema: z.strictObject({ id: z.uuid().optional(), ids: z.array(z.uuid()).min(1).max(200).optional() }),
    annotations: { ...RW, destructiveHint: true },
  }, wrap(async (a: any) => {
    const ids = [...(a.ids ?? []), ...(a.id ? [a.id] : [])];
    if (!ids.length) throw new UserError("Fournissez id ou ids.");
    const del = must("memoire_agent", await db.from("memoire_agent").delete().in("id", ids).select("id")) as any[];
    return { oublies: (del ?? []).length };
  }));
}
```
- [ ] **Step 4 : `savoir.ts`**
```ts
// Savoir commun (AG1) : fiches pédagogiques sourcées (savoir_fiches) et repères chiffrés (reperes), en lecture.
// L'agent consulte avant d'expliquer ou de citer un chiffre réglementaire, et cite fiche ou repère avec sa date.
import { z } from "zod";

export const THEMES = ["epargne", "enveloppes", "fiscalite", "immobilier", "retraite", "protection", "marches", "comportement", "credit"] as const;
export const A_VERIFIER_JOURS = 180;

export async function lireReperes(db: any, must: any, cles?: string[], today = new Date().toISOString().slice(0, 10)) {
  let req = db.from("reperes").select("cle, libelle, valeur, unite, date_effet, source_titre, source_url, verifie_le").order("cle");
  if (cles?.length) req = req.in("cle", cles);
  const rows = (must("reperes", await req) as any[]) ?? [];
  return rows.map((r) => ({ ...r, valeur: +r.valeur, a_verifier: (Date.parse(today) - Date.parse(r.verifie_le)) / 864e5 > A_VERIFIER_JOURS }));
}

/** Fiches mises à jour après `depuis` (ISO), 10 au plus ; rien si `depuis` est null (première session). */
export async function nouveautes(db: any, must: any, depuis: string | null) {
  if (!depuis) return [];
  const rows = must("savoir_fiches", await db.from("savoir_fiches").select("slug, theme, titre, resume, mis_a_jour_le")
    .gt("mis_a_jour_le", depuis.slice(0, 10)).order("mis_a_jour_le", { ascending: false }).limit(10)) as any[];
  return rows ?? [];
}

export function registerSavoir(server: any, h: { db: any; wrap: any; must: any; UserError: any; RO: any }) {
  const { db, wrap, must, UserError, RO } = h;
  server.registerTool("consulter_savoir", {
    title: "Consulter le savoir Boussole",
    description: "Fiches pédagogiques sourcées et datées de Boussole (épargne, enveloppes, fiscalité, immobilier, retraite, protection, marchés, comportement, crédit). Avec question et/ou theme : 5 fiches pertinentes (slug, titre, résumé, date, sources). Avec slug : la fiche complète. À consulter avant toute explication de fond ; citer la fiche (titre, date) ; si rien n'est trouvé, le dire sans inventer.",
    inputSchema: z.strictObject({
      question: z.string().trim().min(2).max(200).optional(),
      theme: z.enum(THEMES, { error: "Thème : " + THEMES.join(", ") + "." }).optional(),
      slug: z.string().regex(/^[a-z0-9-]{3,80}$/).optional(),
    }),
    annotations: RO,
  }, wrap(async (a: any) => {
    if (a.slug) {
      const f = must("savoir_fiches", await db.from("savoir_fiches").select("slug, theme, titre, resume, contenu, sources, version, mis_a_jour_le").eq("slug", a.slug).maybeSingle());
      if (!f) throw new UserError(`Fiche introuvable : ${a.slug}. Cherchez avec question ou theme.`);
      return { fiche: f };
    }
    if (!a.question && !a.theme) throw new UserError("Fournissez question, theme ou slug.");
    const res = (must("chercher_savoir", await db.rpc("chercher_savoir", { p_question: a.question ?? null, p_theme: a.theme ?? null, p_limite: 5 })) as any[]) ?? [];
    return { nombre: res.length, fiches: res, consigne: res.length ? "Ouvrez la fiche utile avec slug, puis citez-la (titre, date)." : "Aucune fiche ne correspond : dites-le à l'utilisateur et n'inventez rien." };
  }));

  server.registerTool("reperes", {
    title: "Repères chiffrés",
    description: "Chiffres de référence à jour (taux et plafonds des livrets, plafond PEA, prélèvement forfaitaire unique, abattements de l'assurance-vie, normes HCSF, PASS…) avec unité, date d'effet, source et date de vérification ; a_verifier = vérifié il y a plus de 180 jours (le signaler). À appeler avant de citer tout chiffre réglementaire.",
    inputSchema: z.strictObject({ cles: z.array(z.string().regex(/^[a-z0-9_]{2,60}$/)).max(30).optional() }),
    annotations: RO,
  }, wrap(async ({ cles }: any) => ({ reperes: await lireReperes(db, must, cles) })));
}
```
- [ ] **Step 5 : `index.ts`**
  1. Imports après `zod` : `import { registerSavoir, nouveautes } from "./savoir.ts";` et `import { registerMemoire, lireMemoire, SENSIBLE } from "./memoire.ts";` (SENSIBLE réexporté : `export { SENSIBLE };`).
  2. `type Ctx = { db: any; user: { id: string; email?: string }; client?: { id: string; nom: string } };` ; dans `handleMcp` : `buildServer({ db, user: {...}, client: clientDuJeton(token) })`.
  3. INSTRUCTIONS : insérer en 2e ligne « Au début de chaque conversation, appelle demarrer_session : il renvoie ta conduite d'agent expert, ce que tu sais déjà de l'utilisateur (mémoire), les points à reprendre, l'état du bilan et les nouveautés du savoir Boussole. Avant de citer un taux, un plafond ou un barème, appelle reperes ; avant d'expliquer une notion de fond, consulter_savoir ; cite la fiche ou le repère et sa date. » ; ajouter une ligne « Mémoire (memoriser, se_souvenir, oublier) : retiens ce qui est durable… jamais d'identifiants ; l'utilisateur la voit et l'efface dans Boussole › Profil et données › Mémoire de l'agent. »
  4. Après CONDUITE_ONBOARDING, définir :
```ts
const CONDUITE_EXPERT = [
  "Tu es l'agent expert de Boussole : un conseiller en gestion de patrimoine pédagogue, chaleureux et précis, qui parle français simple.",
  "1. Tu as appelé demarrer_session : salue l'utilisateur en tenant compte de sa mémoire (prénom, contexte, projets) et reprends d'abord les points « à suivre » échus.",
  "2. Si des nouveautés du savoir concernent sa situation, signale-les en une phrase chacune (titre et date de la fiche).",
  "3. Avant de citer un taux, un plafond ou un barème : appelle reperes, cite la valeur avec sa date d'effet ; si a_verifier est vrai, dis que la valeur doit être revérifiée.",
  "4. Avant d'expliquer une notion de fond : consulter_savoir, puis cite la fiche (titre, date). Sans fiche, dis-le et reste prudent ; n'invente jamais.",
  "5. Mémoire : avec memoriser, retiens ce qui est durable et utile pour la suite (contexte de vie, préférences, projets, décisions prises, notions déjà expliquées, points à suivre avec échéance) ; une phrase courte par souvenir ; ne recopie pas ce qui est déjà dans le bilan ; demande l'accord avant une information sensible (santé, famille, emploi).",
  "6. Ne retiens et ne demande jamais d'identifiants bancaires, IBAN, numéros de compte ou de carte, ni mots de passe.",
  "7. Rappelle, la première fois, que l'utilisateur voit et efface sa mémoire dans Boussole › Profil et données › Mémoire de l'agent.",
  "8. Pour modifier le bilan, dépose des propositions (source obligatoire) : rien n'est appliqué avant validation dans Boussole › Profil et données › Propositions.",
  "9. Reste pédagogique : classes d'actifs et comportements, jamais de produit à acheter ni d'établissement ; ce n'est pas un conseil en investissement.",
].join("\n");
```
  5. Dans `buildServer`, après `RW` : `const h = { db, wrap, must, UserError, RO, RW, source: client?.nom ?? "Assistant" }; registerSavoir(server, h); registerMemoire(server, h);`
  6. Outil `demarrer_session` (après `demarrer_onboarding`) :
```ts
  server.registerTool("demarrer_session", {
    title: "Démarrer la session",
    description: "À appeler au début de chaque conversation : conduite de l'agent expert, mémoire de l'utilisateur (épinglés puis récents), points à suivre échus, état du bilan, propositions en attente et nouveautés du savoir Boussole depuis la session précédente.",
    inputSchema: z.strictObject({}),
    annotations: RO,
  }, wrap(async () => {
    const [{ vue }, memoire, vu] = await Promise.all([
      lireEtat(),
      lireMemoire(db, must),
      db.rpc("marquer_savoir_vu", { p_client_id: client?.id ?? "session" }),
    ]);
    if (vu.error) console.warn("marquer_savoir_vu :", vu.error.message);
    const auj = today();
    return {
      conduite: CONDUITE_EXPERT,
      memoire: memoire.slice(0, 30),
      memoire_total: memoire.length,
      a_suivre_echus: memoire.filter((m: any) => m.categorie === "a_suivre" && m.echeance && m.echeance <= auj),
      bilan: { pourcentage: vue.pourcentage, prochaines_questions: vue.prochaines_questions },
      propositions_en_attente: vue.propositions_en_attente,
      nouveautes_savoir: await nouveautes(db, must, vu.error ? null : vu.data),
      onboarding_conseille: vue.pourcentage < 50,
    };
  }));
```
  (Les épinglés viennent en tête via `lireMemoire` ; la mémoire est déjà triée.) `client` est destructuré dans la signature : `export function buildServer({ db, user, client }: Ctx)`.
  7. `demarrer_onboarding` : ajouter `memoire: (await lireMemoire(db, must)).slice(0, 30)` à sa réponse et, à CONDUITE_ONBOARDING, la ligne « Retiens avec memoriser ce qui est durable (contexte, projets, notions expliquées) ; jamais d'identifiants. »
  8. Version du serveur : `"1.1.0"`.
- [ ] **Step 6 :** `npm test` → tout PASS (les tests de parité restent verts).
- [ ] **Step 7 :** commit `Connecteur v6 : demarrer_session, savoir (consulter_savoir, reperes) et mémoire (memoriser, se_souvenir, oublier)`.

---

### Task 5 : contrat de store et câblage des vues

**Files:** Modify `web/src/store-supabase.js`, `web/src/store-demo.js`, `web/src/demo-data.js`, `web/src/app.js`, `web/src/shell.html`, `build.mjs`, `test/store-contract.test.mjs`, `test/shell.test.mjs`.

- [ ] **Step 1 : tests** — dans `test/store-contract.test.mjs`, ajouter (en suivant le style du fichier, qui lit les deux sources) des assertions :
  - les deux stores documentent et exposent `memoire` et `savoir` dans S (`C = { … memoire: [], savoir: { fiches: [], reperes: [] } … }`) et l'API `Store.memoire = { modifier, supprimer, toutEffacer }`, `Store.savoir = { fiche }` ;
  - store-supabase lit `memoire_agent` (`select("id, categorie, contenu, echeance, epingle, source, cree_le, maj_le")`), `savoir_fiches` (sans `contenu` : `select("slug, theme, titre, resume, mots_cles, sources, version, mis_a_jour_le")`) et `reperes` dans `loadAll`, et `fiche(slug)` lit `contenu` à la demande ;
  - le store démo charge `DEMO.memoire`, `DEMO.savoir` ; `demo-data.js` en définit 6 souvenirs (dont un `a_suivre` échu et un épinglé) et 4 fiches (avec `contenu`) + 4 repères (`livret_a_taux`, `pea_plafond`, `hcsf_taux_effort`, `pfu_taux`, valeurs marquées « exemple » dans `sourceTitre`).
  - `test/shell.test.mjs` : SPACES contient `{ id: "fiches", label: "Fiches", module: "fiches-view" }` dans `recos` et `{ id: "memoire", label: "Mémoire de l'agent", module: "memoire-view" }` dans `profil` (après `claude`) ; shell.html a `<section class="view" id="view-fiches-view" data-space="recos" data-sub="fiches" …><!--@fiches-view--></section>` et l'équivalent `view-memoire-view` ; build.mjs a `"reperes"` dans SCRIPTS avant `"plan"` et les deux modules dans MODULES.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : implémentation**
  - store-supabase : vue camelCase `memView = r => ({ id: r.id, categorie: r.categorie, contenu: r.contenu, echeance: r.echeance, epingle: !!r.epingle, source: r.source, creeLe: r.cree_le, majLe: r.maj_le })` ; fiches : `{ slug, theme, titre, resume, motsCles: r.mots_cles || [], sources: r.sources || [], version, misAJourLe: r.mis_a_jour_le }` ; repères : `Reperes.depuisLignes` si `window.Reperes`, sinon map identique. Les trois lectures rejoignent le `Promise.allSettled` de `loadAll` (une table absente ne casse rien : valeur `undefined` ignorée, comme `connexions`). API :
```js
  const memoire = {
    async modifier(id, patch) { // patch : { contenu?, epingle?, echeance? }
      try { await write(async () => q(sb.from("memoire_agent").update(patch).eq("id", id))); return { ok: true }; }
      catch (e) { return { erreur: e.message || String(e) }; }
    },
    async supprimer(ids) {
      try { await write(async () => q(sb.from("memoire_agent").delete().in("id", ids))); return { ok: true }; }
      catch (e) { return { erreur: e.message || String(e) }; }
    },
    async toutEffacer() {
      try { await write(async () => q(sb.from("memoire_agent").delete().eq("user_id", C.user.id))); return { ok: true }; }
      catch (e) { return { erreur: e.message || String(e) }; }
    },
  };
  const savoir = {
    async fiche(slug) {
      const r = await q(sb.from("savoir_fiches").select("slug, theme, titre, resume, contenu, mots_cles, sources, version, mis_a_jour_le").eq("slug", slug).maybeSingle());
      return r ? Object.assign(ficheView(r), { contenu: r.contenu }) : null;
    },
  };
```
  (Adapter aux helpers réels du fichier : `write` recharge et publie ; vérifier sa signature avant de l'utiliser et suivre le modèle de `propositions`.) Le message d'erreur de la limite (« Mémoire pleine… ») est remonté tel quel.
  - store-demo : mêmes clés, opérations en mémoire (`C.memoire = C.memoire.filter(...)` puis `publish()`), `fiche(slug)` renvoie la fiche démo avec contenu.
  - app.js SPACES : `recos.subs` += `{ id: "fiches", label: "Fiches", module: "fiches-view" }` ; `profil.subs` après `claude` += `{ id: "memoire", label: "Mémoire de l'agent", module: "memoire-view" }`.
  - shell.html : deux `<section>` sur le modèle exact de `view-propositions` (attributs `role="tabpanel"`, `aria-labelledby="subtab-recos-fiches"` / `"subtab-profil-memoire"`, `hidden`).
  - build.mjs : SCRIPTS `"reperes"` avant `"plan"` ; MODULES += `"fiches-view"`, `"memoire-view"`.
  - Créer des fichiers minimaux `web/src/memoire-view.{html,js,css}` et `web/src/fiches-view.{html,js,css}` **seulement s'ils n'existent pas** (les tâches 6 et 7 les remplissent) : html `<div class="memoire-view"></div>`, js qui s'enregistre (`App.register("memoire-view", { mount(){}, update(){} })` via le motif `__pending` des autres modules), css vide.
- [ ] **Step 4 :** `npm test` PASS ; `node build.mjs` sans erreur.
- [ ] **Step 5 :** commit `Stores : mémoire de l'agent et savoir commun (fiches, repères) ; câblage des vues Mémoire et Fiches`.

---

### Task 6 : vue Profil › Mémoire de l'agent

**Files:** `web/src/memoire-view.{html,css,js}`, Create `test/memoire-view.test.mjs`.

Modèle à suivre : `web/src/propositions.{html,css,js}` et `test/propositions-ui.test.mjs` (enregistrement `App.register("memoire-view", api)` + `__pending`, `$ = id => root.querySelector("#" + id)` scopé, CSS entièrement scopé sous `#view-memoire-view`, fonctions pures exportées par `module.exports` pour les tests, `esc` pour tout texte).

Comportement :
- En-tête (html) : « Ce que l'agent retient de vous » + paragraphe : « Votre assistant retient ici ce qui l'aide à mieux vous accompagner d'une conversation à l'autre : votre contexte, vos préférences, vos projets, vos décisions, ce qu'il vous a déjà expliqué et les points à reprendre. Ces souvenirs sont privés, stockés dans votre compte Boussole, et vous pouvez les modifier ou les effacer à tout moment. Ils ne contiennent jamais d'identifiants bancaires ni de mots de passe. »
- Groupes dans l'ordre `a_suivre` (« À reprendre »), `projet` (« Projets »), `decision` (« Décisions »), `contexte` (« Contexte »), `preference` (« Préférences »), `explique` (« Déjà expliqué ») ; épinglés d'abord dans chaque groupe ; groupes vides masqués.
- Chaque souvenir : texte, méta (« retenu par Claude le 10 oct. 2026 » ; échéance pour `a_suivre`, classe `echu` + libellé « à reprendre » si échéance ≤ aujourd'hui), boutons « Épingler »/« Désépingler », « Modifier » (textarea inline, 500 caractères max, Enregistrer / Annuler), « Supprimer ».
- Barre : nombre (« 12 souvenirs sur 200 »), bouton « Tout effacer » avec `confirm("Effacer les N souvenirs de l'agent ? Cette action est définitive.")`.
- Erreur : message `role="status"` avec le texte d'erreur du store.
- Vide : panneau « L'agent n'a encore rien retenu » + explication (« Pendant vos conversations, votre assistant retient ce qui est utile pour la suite. Commencez par votre bilan avec Claude. ») + lien `data-goto="profil/claude"`.
- `headline()` : nombre de « à suivre » échus ou "".
- Fonctions pures exportées : `grouper(memoire, today)` → `[{ cle, titre, items }]` ; `echu(m, today)` ; `meta(m, today)`.

- [ ] **Step 1 : tests** (`test/memoire-view.test.mjs`) : compile et s'enregistre ; aucun `document.querySelector/getElementById` ; ids `$("mv…")` présents dans le html ; CSS scopé `#view-memoire-view` ; `grouper` ordonne `a_suivre` en premier, épinglés en tête de groupe, groupes vides absents ; `echu` vrai pour échéance passée, faux sans échéance ; utilise `Store.memoire.modifier`, `.supprimer`, `.toutEffacer` ; confirmation avant « Tout effacer » ; texte d'en-tête mentionne « jamais d'identifiants bancaires ni de mots de passe ».
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** PASS. **Step 5 :** commit `Vue Mémoire de l'agent : souvenirs groupés, épingler, modifier, supprimer, tout effacer`.

---

### Task 7 : vue Recommandations › Fiches

**Files:** `web/src/fiches-view.{html,css,js}`, Create `test/fiches-view.test.mjs`.

Même modèle que la tâche 6 (scopé `#view-fiches-view`).

Comportement :
- En-tête : « Ce que sait l'agent » + « Les fiches et les chiffres sur lesquels s'appuie l'agent de Boussole, avec leurs sources et leur date. Elles sont relues avant publication et mises à jour avec l'actualité. » + légende « Indicateur pédagogique, pas un conseil en investissement. »
- Encart « Chiffres de référence » : tableau des repères (libellé, `Reperes.format`, « depuis le <dateEffet> », lien source `target="_blank" rel="noopener"`, badge « à vérifier » si `Reperes.aVerifier`).
- Recherche (`input type="search"`, filtrage local insensible à la casse et aux accents sur titre, résumé, mots-clés) + puces de thème (« Tous » + thèmes présents, libellés : epargne « Épargne », enveloppes « Enveloppes », fiscalite « Fiscalité », immobilier « Immobilier », retraite « Retraite », protection « Protection », marches « Marchés », comportement « Comportement », credit « Crédit »).
- Cartes : titre, résumé, thème, « mise à jour le … ». Clic → `Store.savoir.fiche(slug)` puis affichage dans un panneau détail (bouton « Retour aux fiches ») : titre, contenu rendu par `rendreMarkdown`, sources (liens), version et date.
- `rendreMarkdown(md)` pure et sûre : échappe tout HTML d'abord, puis gère `## titre`/`### titre` → `<h3>`/`<h4>`, listes `- ` → `<ul><li>`, `**gras**` → `<strong>`, `[texte](https://…)` → `<a href target=_blank rel=noopener>` (seulement `https://`), paragraphes séparés par ligne vide. Aucun autre balisage.
- Vide (aucune fiche) : « Le savoir de l'agent arrive bientôt. »
- Fonctions pures exportées : `rendreMarkdown`, `filtrer(fiches, texte, theme)`, `normaliser(s)` (minuscules sans accents).

- [ ] **Step 1 : tests** : compile, s'enregistre, scopé, ids présents ; `rendreMarkdown("<script>x</script>")` ne contient pas `<script` ; lien `javascript:` non converti ; `## T` → `<h3>T</h3>` ; liste ; gras ; `filtrer` trouve « Epargne » pour « épargne » et filtre par thème ; utilise `Reperes.aVerifier` et `Store.savoir.fiche` ; légende pédagogique présente.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** PASS. **Step 5 :** commit `Vue Fiches : savoir de l'agent consultable (recherche, thèmes, repères sourcés, rendu sûr)`.

---

### Task 8 : repère Livret A dans l'Avenir

**Files:** Modify `web/src/plan-view.js:383`, `test/plan-view.test.mjs`.

- [ ] **Step 1 : test** : `plan-view.js` n'écrit plus « Livret A 2,4 % » en dur ; il appelle `Reperes.valeur(` avec `"livret_a_taux"` et une valeur de secours, et affiche la date d'effet si le repère existe.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 :** remplacer la ligne par un texte calculé :
```js
const rl = window.Reperes && S.savoir ? Reperes.trouver(S.savoir.reperes, "livret_a_taux") : null;
const livret = rl ? Reperes.format(rl) + " depuis le " + new Date(rl.dateEffet).toLocaleDateString("fr-FR") : "taux réglementé en vigueur";
// … '<span class="small muted">repère : Livret A ' + esc(livret) + ', fonds euros ~2,5 %, actions mondiales ~6 % sur longue période</span></div>'
```
(Adapter à la variable d'état et à la fonction d'échappement disponibles à cet endroit du fichier.)
- [ ] **Step 4 :** PASS. **Step 5 :** commit `Avenir : taux du Livret A lu dans les repères`.

---

### Task 9 : déploiement et vérification (contrôleur)

- [ ] `apply_migration` `savoir_memoire` (0009) puis `savoir_contenu` (0010) sur oapcewpqsbbjdlcdeizi ; `get_advisors` (security) : aucune nouvelle alerte.
- [ ] Contrôle SQL : `select count(*) from savoir_fiches` = 19 ; `select * from chercher_savoir('livret', null, 3)` renvoie des fiches ; `select public.contenu_sensible('FR76 3000 6000 0112 3456 7890 189'), public.contenu_sensible('IE00B4L5Y983')` → true, false.
- [ ] `deploy_edge_function` mcp (index.ts, savoir.ts, memoire.ts, deno.json), verify_jwt false.
- [ ] `npm test` complet, `node build.mjs`, vérification navigateur (démo `?demo`) : Profil › Mémoire de l'agent, Recommandations › Fiches (recherche, ouverture, repères), Avenir (ligne Livret A), mobile 375 px, sombre ; console sans erreur.
- [ ] Push (Pages) ; vérification en ligne de la page.
- [ ] Via le connecteur Boussole (après reconnexion) : `demarrer_session`, `reperes`, `consulter_savoir`, `memoriser` (souvenir de test) puis `oublier`.
