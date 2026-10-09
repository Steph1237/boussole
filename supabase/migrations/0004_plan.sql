-- Boussole : budget mensuel et objectifs datés (chantier 2, T1)
-- Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "plan").

-- ---------------------------------------------------------------------------
-- Tables privées (user_id = auth.uid())
-- ---------------------------------------------------------------------------

-- Une ligne par utilisateur : lignes = [{id, type: revenu|depense|epargne, categorie, libelle, montant, frequence: mois|an}]
create table public.budgets (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  lignes     jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create table public.objectifs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom        text not null default '',
  type       text not null default 'projet' check (type in ('apport','matelas','retraite','projet')),
  cible      numeric not null default 0 check (cible >= 0),
  date_cible date,
  deja       numeric not null default 0 check (deja >= 0),
  source     text not null default 'saisi' check (source in ('saisi','poches')),
  poches     text[] not null default '{}',
  enveloppes text[] not null default '{}',
  rendement  numeric not null default 2 check (rendement between -50 and 50),
  priorite   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- budgets : user_id est déjà la clé primaire.
create index objectifs_user_id_idx on public.objectifs (user_id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create trigger budgets_set_updated_at   before update on public.budgets   for each row execute function public.set_updated_at();
create trigger objectifs_set_updated_at before update on public.objectifs for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS : une politique par commande
-- ---------------------------------------------------------------------------

alter table public.budgets   enable row level security;
alter table public.objectifs enable row level security;

create policy "budgets: select" on public.budgets for select to authenticated using ((select auth.uid()) = user_id);
create policy "budgets: insert" on public.budgets for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "budgets: update" on public.budgets for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "budgets: delete" on public.budgets for delete to authenticated using ((select auth.uid()) = user_id);

create policy "objectifs: select" on public.objectifs for select to authenticated using ((select auth.uid()) = user_id);
create policy "objectifs: insert" on public.objectifs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "objectifs: update" on public.objectifs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "objectifs: delete" on public.objectifs for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Privilèges (RLS reste l'autorité)
-- ---------------------------------------------------------------------------

revoke all on table public.budgets   from anon;
revoke all on table public.objectifs from anon;
grant select, insert, update, delete on table public.budgets   to authenticated;
grant select, insert, update, delete on table public.objectifs to authenticated;

-- ---------------------------------------------------------------------------
-- export_all() : mêmes clés qu'avant + budget (ligne ou null) et objectifs (tableau)
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
    'objectifs',    (select coalesce(jsonb_agg(to_jsonb(o) order by o.priorite, o.created_at), '[]') from public.objectifs o where o.user_id = auth.uid())
  );
$$;

revoke all on function public.export_all() from public, anon;
grant execute on function public.export_all() to authenticated;
