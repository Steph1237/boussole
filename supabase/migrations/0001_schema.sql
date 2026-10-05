-- Boussole : schéma, RLS, fonctions SQL (Task 2)
-- Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "schema").

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables partagées
-- ---------------------------------------------------------------------------

create table public.instruments (
  isin         text primary key
               check (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$' or isin like 'X-%'),
  symbol       text,
  name         text,
  currency     text not null default 'EUR',
  price        numeric,
  price_date   date,
  source       text,
  requested_by uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.job_runs (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  users       int,
  instruments int,
  errors      jsonb not null default '[]'
);

-- ---------------------------------------------------------------------------
-- Tables privées (user_id = auth.uid())
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  foyer           jsonb not null default '{}',
  personnes       jsonb not null default '{"p1":{"nom":"Moi"}}',
  autres          jsonb not null default '{}',
  settings        jsonb not null default '{}',
  onboarding_done boolean not null default false,
  updated_at      timestamptz not null default now()
);

create table public.biens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom        text not null default '',
  usage      text not null default 'rp' check (usage in ('rp','locatif','secondaire')),
  valeur     numeric not null default 0 check (valeur >= 0),
  part_p1    numeric not null default 100 check (part_p1 between 0 and 100),
  crd        numeric not null default 0 check (crd >= 0),
  mensualite numeric not null default 0 check (mensualite >= 0),
  loyer      numeric not null default 0 check (loyer >= 0),
  created_at timestamptz not null default now()
);

create table public.credits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom        text not null default '',
  owner      text not null default 'commun' check (owner in ('p1','p2','commun')),
  crd        numeric not null default 0 check (crd >= 0),
  mensualite numeric not null default 0 check (mensualite >= 0),
  created_at timestamptz not null default now()
);

create table public.positions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null,
  envelope       text not null default '',
  owner          text not null default 'p1' check (owner in ('p1','p2')),
  bloc           text not null default '',
  mode           text not null default 'manual' check (mode in ('market','manual')),
  isin           text references public.instruments(isin),
  qty            numeric,
  pru            numeric,
  price_override numeric,
  value          numeric,
  value_date     date,
  status         text not null default 'actif' check (status in ('actif','à recevoir','clôturé')),
  hypothesis     text,
  qty_estimated  boolean not null default false,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  position_id uuid references public.positions(id) on delete cascade,
  date        date not null default current_date,
  type        text not null,
  qty         numeric,
  price       numeric,
  amount      numeric,
  note        text,
  source      text not null default 'manuel',
  created_at  timestamptz not null default now()
);

create table public.snapshots (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  total       numeric,
  p1          numeric,
  p2          numeric,
  by_bloc     jsonb not null default '{}',
  by_envelope jsonb not null default '{}',
  source      text not null default 'nightly',
  primary key (user_id, date)
);

create table public.config (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  targets    jsonb not null default '{"tolerancePts":3}',
  rules      jsonb not null default '[]',
  cushion    jsonb not null default '{"mode":"amount","min":0,"max":0}',
  recurring  jsonb not null default '[]',
  todo       jsonb not null default '[]',
  milestones jsonb not null default '[]',
  hypotheses jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create table public.status (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  last_run       timestamptz,
  summary        text,
  alerts         jsonb not null default '[]',
  missing_prices int not null default 0
);

-- ---------------------------------------------------------------------------
-- Index
-- (profiles, snapshots, config, status : user_id est déjà en tête de la clé primaire)
-- ---------------------------------------------------------------------------

create index biens_user_id_idx         on public.biens (user_id);
create index credits_user_id_idx       on public.credits (user_id);
create index positions_user_id_idx     on public.positions (user_id);
create index positions_isin_idx        on public.positions (isin);
create index transactions_user_id_idx  on public.transactions (user_id);
create index transactions_user_date_idx on public.transactions (user_id, date desc);
create index transactions_position_idx on public.transactions (position_id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at    before update on public.profiles    for each row execute function public.set_updated_at();
create trigger positions_set_updated_at   before update on public.positions   for each row execute function public.set_updated_at();
create trigger config_set_updated_at      before update on public.config      for each row execute function public.set_updated_at();
create trigger instruments_set_updated_at before update on public.instruments for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Création du profil et de la config à l'inscription
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.config   (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.instruments  enable row level security;
alter table public.job_runs     enable row level security;
alter table public.profiles     enable row level security;
alter table public.biens        enable row level security;
alter table public.credits      enable row level security;
alter table public.positions    enable row level security;
alter table public.transactions enable row level security;
alter table public.snapshots    enable row level security;
alter table public.config       enable row level security;
alter table public.status       enable row level security;

-- instruments : lecture seule pour les connectés ; écriture via request_instrument / rôle service.
create policy "instruments: lecture connectés" on public.instruments
  for select to authenticated using (true);

-- job_runs : aucune politique (rôle service uniquement).

-- Tables privées : une politique par commande.
create policy "profiles: select" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles: insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles: update" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "profiles: delete" on public.profiles for delete to authenticated using ((select auth.uid()) = user_id);

create policy "biens: select" on public.biens for select to authenticated using ((select auth.uid()) = user_id);
create policy "biens: insert" on public.biens for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "biens: update" on public.biens for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "biens: delete" on public.biens for delete to authenticated using ((select auth.uid()) = user_id);

create policy "credits: select" on public.credits for select to authenticated using ((select auth.uid()) = user_id);
create policy "credits: insert" on public.credits for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "credits: update" on public.credits for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "credits: delete" on public.credits for delete to authenticated using ((select auth.uid()) = user_id);

create policy "positions: select" on public.positions for select to authenticated using ((select auth.uid()) = user_id);
create policy "positions: insert" on public.positions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "positions: update" on public.positions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "positions: delete" on public.positions for delete to authenticated using ((select auth.uid()) = user_id);

create policy "transactions: select" on public.transactions for select to authenticated using ((select auth.uid()) = user_id);
create policy "transactions: insert" on public.transactions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "transactions: update" on public.transactions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "transactions: delete" on public.transactions for delete to authenticated using ((select auth.uid()) = user_id);

create policy "snapshots: select" on public.snapshots for select to authenticated using ((select auth.uid()) = user_id);
create policy "snapshots: insert" on public.snapshots for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "snapshots: update" on public.snapshots for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "snapshots: delete" on public.snapshots for delete to authenticated using ((select auth.uid()) = user_id);

create policy "config: select" on public.config for select to authenticated using ((select auth.uid()) = user_id);
create policy "config: insert" on public.config for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "config: update" on public.config for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "config: delete" on public.config for delete to authenticated using ((select auth.uid()) = user_id);

create policy "status: select" on public.status for select to authenticated using ((select auth.uid()) = user_id);
create policy "status: insert" on public.status for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "status: update" on public.status for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "status: delete" on public.status for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Demande d'un instrument (insère sans prix si absent, renvoie la ligne).
create or replace function public.request_instrument(p_isin text, p_name text default null, p_symbol text default null)
returns public.instruments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_isin text := upper(trim(p_isin));
  r public.instruments;
begin
  if v_isin is null or v_isin = '' then
    raise exception 'isin requis';
  end if;
  insert into public.instruments (isin, name, symbol, requested_by)
  values (v_isin, nullif(trim(p_name), ''), nullif(trim(p_symbol), ''), auth.uid())
  on conflict (isin) do nothing;
  select * into r from public.instruments where isin = v_isin;
  return r;
end;
$$;

-- Export de toutes les données de l'utilisateur courant (security invoker : RLS s'applique).
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
    'status',       (select coalesce(jsonb_agg(to_jsonb(st)), '[]') from public.status st where st.user_id = auth.uid())
  );
$$;

-- Suppression du compte courant (cascade sur toutes les tables privées).
create or replace function public.delete_me()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'non authentifié';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilèges (RLS reste l'autorité ; on retire ce qui n'a pas lieu d'être)
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- job_runs : service uniquement.
revoke all on table public.job_runs from anon, authenticated;
revoke all on sequence public.job_runs_id_seq from anon, authenticated;

-- instruments : lecture seule pour les connectés (écriture via request_instrument / service).
revoke insert, update, delete, truncate, references, trigger on table public.instruments from authenticated;

-- Fonctions.
revoke all on function public.request_instrument(text, text, text) from public, anon;
grant execute on function public.request_instrument(text, text, text) to authenticated;

revoke all on function public.export_all() from public, anon;
grant execute on function public.export_all() to authenticated;

revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
