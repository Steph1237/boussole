-- Boussole : connexions des assistants (onboarding, docs/superpowers/specs/2026-10-10-onboarding-assistant.md, « Détection de connexion »).
-- Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "connexions").
--
-- Le connecteur MCP note chaque appel authentifié (client OAuth, ou "session" pour un jeton de session ordinaire) par la RPC
-- noter_connexion, au plus une écriture toutes les 5 minutes par client. Le board lit la table (S.connexions) pour afficher
-- le voyant « Claude est connecté » pendant l'onboarding.
--   client_id  : claim client_id du jeton OAuth (ex. 30351516-1e76-4884-8fb2-ae856799a723 pour Claude), "session" sinon.
--   client_nom : nom lisible (« Claude », « Assistant »…), fourni par le connecteur.
--   premier_le : première connexion ; dernier_le : dernière écriture (précision 5 minutes).
--   appels     : nombre d'écritures (une par fenêtre de 5 minutes d'activité au plus), pas le nombre exact d'appels d'outils.

-- ---------------------------------------------------------------------------
-- Table privée (user_id = auth.uid())
-- ---------------------------------------------------------------------------

create table public.connexions_assistant (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id  text not null check (char_length(client_id) between 1 and 200),
  client_nom text check (client_nom is null or char_length(client_nom) <= 100),
  premier_le timestamptz not null default now(),
  dernier_le timestamptz not null default now(),
  appels     int not null default 1 check (appels >= 0),
  primary key (user_id, client_id)
);

alter table public.connexions_assistant enable row level security;

create policy "connexions_assistant: select" on public.connexions_assistant for select to authenticated using ((select auth.uid()) = user_id);
create policy "connexions_assistant: insert" on public.connexions_assistant for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "connexions_assistant: update" on public.connexions_assistant for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "connexions_assistant: delete" on public.connexions_assistant for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.connexions_assistant from anon;
grant select, insert, update, delete on table public.connexions_assistant to authenticated;

-- ---------------------------------------------------------------------------
-- noter_connexion(client_id, client_nom) : security invoker (RLS s'applique), une seule instruction.
-- Première connexion : insertion. Ensuite : mise à jour seulement si la dernière écriture a plus de 5 minutes
-- (sinon rien n'est écrit : au plus une écriture toutes les 5 minutes par client).
-- ---------------------------------------------------------------------------

create or replace function public.noter_connexion(p_client_id text, p_client_nom text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  text := coalesce(left(nullif(btrim(p_client_id), ''), 200), 'session');
  v_nom text := left(nullif(btrim(p_client_nom), ''), 100);
begin
  if v_uid is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  insert into public.connexions_assistant as c (user_id, client_id, client_nom)
  values (v_uid, v_id, v_nom)
  on conflict (user_id, client_id) do update
     set dernier_le = now(), appels = c.appels + 1, client_nom = coalesce(excluded.client_nom, c.client_nom)
   where c.dernier_le < now() - interval '5 minutes';
end;
$$;

revoke all on function public.noter_connexion(text, text) from public, anon;
grant execute on function public.noter_connexion(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- export_all() : mêmes clés qu'avant + connexions_assistant (droit d'accès : l'export couvre toutes les données personnelles)
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
    'connexions_assistant', (select coalesce(jsonb_agg(to_jsonb(ca) order by ca.premier_le), '[]') from public.connexions_assistant ca where ca.user_id = auth.uid())
  );
$$;

revoke all on function public.export_all() from public, anon;
grant execute on function public.export_all() to authenticated;
