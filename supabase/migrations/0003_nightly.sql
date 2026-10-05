-- Boussole : fonction nocturne (Task 7)
-- Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "nightly").
--
-- Contenu :
--   * jeton d'appel de la fonction `nightly`, stocké dans Supabase Vault (aucun secret d'Edge
--     Function n'est nécessaire : la fonction vérifie le jeton via check_nightly_token()) ;
--   * take_snapshots(), apply_recurring(), finish_nightly() : security definer, exécutables
--     par le rôle service uniquement ;
--   * planification pg_cron → pg_net → Edge Function `nightly`.
--
-- Dates : la « date du jour » par défaut est celle de Paris ((now() at time zone 'Europe/Paris')::date),
-- pas current_date (UTC), pour que la photo et les versements portent la date vue par l'utilisateur.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Jeton d'appel (Vault)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'nightly_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'nightly_token',
      'Jeton d''appel de la fonction nocturne'
    );
  end if;
end;
$$;

create or replace function public.check_nightly_token(p text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p, '') <> ''
     and exists (
       select 1 from vault.decrypted_secrets s
       where s.name = 'nightly_token' and s.decrypted_secret = p
     );
$$;

-- ---------------------------------------------------------------------------
-- Photos du jour
-- Valeur d'une ligne : miroir exact de Calc.val() + Calc.counted() (web/src/calc.js) :
--   market avec qty et cours (price_override sinon instruments.price) → qty × cours ;
--   sinon value (0 si nulle) ; lignes « à recevoir » et « clôturé » exclues.
-- p_user : restreint à un utilisateur (tests) ; null = tous les utilisateurs ayant ≥ 1 position.
-- ---------------------------------------------------------------------------

create or replace function public.take_snapshots(
  p_date date default (now() at time zone 'Europe/Paris')::date,
  p_user uuid default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  with v as (
    select p.user_id, p.owner, p.bloc, p.envelope,
           case
             when p.mode = 'market' and p.qty is not null and coalesce(p.price_override, i.price) is not null
               then p.qty * coalesce(p.price_override, i.price)
             else coalesce(p.value, 0)
           end as amount
    from public.positions p
    left join public.instruments i on i.isin = p.isin
    where p.status not in ('à recevoir', 'clôturé')
      and (p_user is null or p.user_id = p_user)
  ),
  u as (
    select distinct p.user_id from public.positions p
    where p_user is null or p.user_id = p_user
  ),
  tot as (
    select u.user_id,
           coalesce(sum(v.amount), 0)                                 as total,
           coalesce(sum(v.amount) filter (where v.owner = 'p1'), 0)  as p1,
           coalesce(sum(v.amount) filter (where v.owner = 'p2'), 0)  as p2
    from u left join v on v.user_id = u.user_id
    group by u.user_id
  ),
  bb as (
    select x.user_id, x.owner, jsonb_object_agg(x.bloc, x.s) as j
    from (select v.user_id, v.owner, v.bloc, sum(v.amount) as s from v group by 1, 2, 3) x
    group by 1, 2
  ),
  be as (
    select x.user_id, jsonb_object_agg(x.envelope, x.s) as j
    from (select v.user_id, v.envelope, sum(v.amount) as s from v group by 1, 2) x
    group by 1
  ),
  ins as (
    insert into public.snapshots (user_id, date, total, p1, p2, by_bloc, by_envelope, source)
    select t.user_id, p_date, t.total, t.p1, t.p2,
           jsonb_build_object(
             'p1', coalesce((select bb.j from bb where bb.user_id = t.user_id and bb.owner = 'p1'), '{}'::jsonb),
             'p2', coalesce((select bb.j from bb where bb.user_id = t.user_id and bb.owner = 'p2'), '{}'::jsonb)
           ),
           coalesce((select be.j from be where be.user_id = t.user_id), '{}'::jsonb),
           'nightly'
    from tot t
    on conflict (user_id, date) do update
      set total       = excluded.total,
          p1          = excluded.p1,
          p2          = excluded.p2,
          by_bloc     = excluded.by_bloc,
          by_envelope = excluded.by_envelope,
          source      = excluded.source
    returning 1
  )
  select count(*) into n from ins;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Versements programmés (config.recurring)
-- Élément : {id, label, positionId, amount, day, start, lastApplied, hypothesis?}
-- Appliqué si day = jour de p_date (ou day > dernier jour du mois et p_date = dernier jour),
-- start ≤ p_date (ou absent), lastApplied ≠ 'YYYY-MM' de p_date. Idempotent dans le mois.
-- Effet : market → qty += amount / cours ; manual → value += amount, value_date = p_date ;
-- transaction type 'programme', source 'nightly' ; lastApplied := 'YYYY-MM'.
-- Cas ignorés (position absente ou clôturée, cours manquant, montant invalide) : alerte dans
-- status.alerts (kind = 'recurring', une seule par versement et par jour), lastApplied inchangé.
-- ---------------------------------------------------------------------------

create or replace function public.apply_recurring(
  p_date date default (now() at time zone 'Europe/Paris')::date,
  p_user uuid default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c         record;
  e         record;
  pos       record;
  v_month   text := to_char(p_date, 'YYYY-MM');
  v_dom     int  := extract(day from p_date)::int;
  v_last    int  := extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::int;
  v_day     int;
  v_amount  numeric;
  v_start   date;
  v_price   numeric;
  v_qty     numeric;
  v_label   text;
  v_problem text;
  v_rec     jsonb;
  v_changed boolean;
  n         int := 0;
begin
  for c in
    select k.user_id, k.recurring
    from public.config k
    where jsonb_typeof(k.recurring) = 'array'
      and jsonb_array_length(k.recurring) > 0
      and (p_user is null or k.user_id = p_user)
    for update
  loop
    v_rec := c.recurring;
    v_changed := false;

    for e in select r.elem, r.idx from jsonb_array_elements(c.recurring) with ordinality as r(elem, idx) loop
      continue when jsonb_typeof(e.elem) <> 'object';

      -- Jour, début, mois déjà appliqué.
      begin
        v_day := nullif(e.elem->>'day', '')::int;
        v_start := nullif(e.elem->>'start', '')::date;
      exception when others then
        continue;
      end;
      continue when v_day is null;
      continue when not (v_day = v_dom or (v_day > v_last and v_dom = v_last));
      continue when v_start is not null and v_start > p_date;
      continue when (e.elem->>'lastApplied') is not distinct from v_month;

      v_label := coalesce(nullif(e.elem->>'label', ''), 'Versement programmé');
      v_problem := null;

      begin
        v_amount := nullif(e.elem->>'amount', '')::numeric;
      exception when others then
        v_amount := null;
      end;

      if v_amount is null or v_amount <= 0 then
        v_problem := 'montant invalide';
      else
        select p.id, p.mode, p.status, coalesce(p.price_override, i.price) as price
          into pos
        from public.positions p
        left join public.instruments i on i.isin = p.isin
        where p.user_id = c.user_id and p.id::text = (e.elem->>'positionId');

        if not found then
          v_problem := 'ligne introuvable';
        elsif pos.status = 'clôturé' then
          v_problem := 'ligne clôturée';
        elsif pos.mode = 'market' and (pos.price is null or pos.price <= 0) then
          v_problem := 'cours manquant';
        end if;
      end if;

      if v_problem is not null then
        insert into public.status as s (user_id, alerts)
        values (c.user_id, jsonb_build_array(jsonb_build_object(
          'kind', 'recurring', 'key', 'recurring:' || coalesce(e.elem->>'id', e.idx::text) || ':' || p_date,
          'date', p_date, 'level', 'warn', 'title', 'Versement non appliqué',
          'text', v_label || ' : ' || v_problem || '.')))
        on conflict (user_id) do update
          set alerts = coalesce(s.alerts, '[]'::jsonb) || excluded.alerts
          where not coalesce(s.alerts, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('key', excluded.alerts->0->>'key'));
        continue;
      end if;

      if pos.mode = 'market' then
        v_price := pos.price;
        v_qty := v_amount / v_price;
        update public.positions set qty = coalesce(qty, 0) + v_qty where id = pos.id;
      else
        v_price := null;
        v_qty := null;
        update public.positions set value = coalesce(value, 0) + v_amount, value_date = p_date where id = pos.id;
      end if;

      insert into public.transactions (user_id, position_id, date, type, qty, price, amount, source, note)
      values (c.user_id, pos.id, p_date, 'programme', v_qty, v_price, v_amount, 'nightly', v_label);

      v_rec := jsonb_set(v_rec, array[(e.idx - 1)::text, 'lastApplied'], to_jsonb(v_month), true);
      v_changed := true;
      n := n + 1;
    end loop;

    if v_changed then
      update public.config set recurring = v_rec where user_id = c.user_id;
    end if;
  end loop;

  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fin de passage : status par utilisateur + job_runs
-- missing_prices : lignes cotées non clôturées sans cours (ni price_override) ou dont le cours
-- date de plus de 4 jours. Les alertes 'recurring' de plus de 7 jours sont retirées.
-- ---------------------------------------------------------------------------

create or replace function public.finish_nightly(p_started timestamptz, p_instruments int, p_errors jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_users int;
  v_errors jsonb := coalesce(p_errors, '[]'::jsonb);
begin
  with u as (
    select a.id as user_id from auth.users a
  ),
  mp as (
    select p.user_id, count(*)::int as n
    from public.positions p
    left join public.instruments i on i.isin = p.isin
    where p.mode = 'market'
      and p.status <> 'clôturé'
      and p.price_override is null
      and (i.price is null or i.price_date is null or i.price_date < v_today - 4)
    group by p.user_id
  ),
  sn as (
    select distinct on (s.user_id) s.user_id, s.total, s.date
    from public.snapshots s
    where s.date <= v_today
    order by s.user_id, s.date desc
  ),
  r0 as (
    select u.user_id,
           coalesce(mp.n, 0) as missing,
           case
             when sn.total is null then 'Aucune position suivie pour le moment.'
             else 'Patrimoine financier ' ||
                  replace(to_char(round(sn.total), 'FM999,999,999,990'), ',', ' ') || ' € au ' ||
                  to_char(sn.date, 'DD/MM/YYYY')
           end ||
           case coalesce(mp.n, 0)
             when 0 then ' · tous les cours sont à jour.'
             when 1 then ' · 1 cours manquant ou ancien.'
             else ' · ' || mp.n || ' cours manquants ou anciens.'
           end as summary
    from u
    left join mp on mp.user_id = u.user_id
    left join sn on sn.user_id = u.user_id
  ),
  up as (
    insert into public.status as s (user_id, last_run, summary, missing_prices, alerts)
    select r.user_id, now(), r.summary, r.missing, '[]'::jsonb from r0 r
    on conflict (user_id) do update
      set last_run       = excluded.last_run,
          summary        = excluded.summary,
          missing_prices = excluded.missing_prices,
          alerts         = (
            select coalesce(jsonb_agg(a), '[]'::jsonb)
            from jsonb_array_elements(coalesce(s.alerts, '[]'::jsonb)) a
            where coalesce(a->>'kind', '') <> 'recurring'
               or (a->>'date') >= (v_today - 7)::text
          )
    returning 1
  )
  select count(*) into v_users from up;

  insert into public.job_runs (started_at, finished_at, ok, users, instruments, errors)
  values (coalesce(p_started, now()), now(), jsonb_array_length(v_errors) = 0, v_users, p_instruments, v_errors);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilèges : rôle service uniquement
-- ---------------------------------------------------------------------------

revoke all on function public.check_nightly_token(text) from public, anon, authenticated;
revoke all on function public.take_snapshots(date, uuid) from public, anon, authenticated;
revoke all on function public.apply_recurring(date, uuid) from public, anon, authenticated;
revoke all on function public.finish_nightly(timestamptz, int, jsonb) from public, anon, authenticated;

grant execute on function public.check_nightly_token(text) to service_role;
grant execute on function public.take_snapshots(date, uuid) to service_role;
grant execute on function public.apply_recurring(date, uuid) to service_role;
grant execute on function public.finish_nightly(timestamptz, int, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Planification : tous les jours à 20:30 UTC
--   = 22:30 Europe/Paris en heure d'été (UTC+2), 21:30 en heure d'hiver (UTC+1).
-- pg_cron raisonne en UTC ; le jeton est lu dans Vault au moment de l'appel.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from cron.job where jobname = 'boussole-nightly') then
    perform cron.unschedule('boussole-nightly');
  end if;
end;
$$;

select cron.schedule(
  'boussole-nightly',
  '30 20 * * *',
  $cron$
  select net.http_post(
    url := 'https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/nightly',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'nightly_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $cron$
);
