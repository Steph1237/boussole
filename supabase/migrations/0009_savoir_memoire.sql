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

-- array_to_string est stable (pas immuable) : une colonne générée exige des fonctions immuables, d'où cet enrobage.
create or replace function public.mots_cles_texte(p text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_to_string(p, ' '), '');
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
    setweight(to_tsvector('french', resume || ' ' || public.mots_cles_texte(mots_cles)), 'B') ||
    setweight(to_tsvector('french', contenu), 'C')) stored
);
create index savoir_fiches_recherche on public.savoir_fiches using gin (recherche);
create index savoir_fiches_maj on public.savoir_fiches (mis_a_jour_le desc);

alter table public.savoir_fiches enable row level security;
revoke all on table public.savoir_fiches from anon, authenticated;
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
revoke all on table public.reperes from anon, authenticated;
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
