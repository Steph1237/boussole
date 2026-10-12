-- Boussole : cours historiques et Binance en lecture seule (CP1, docs/superpowers/specs/2026-10-12-cp1-comptes-performance-design.md
-- § 4 et § 7).
-- Non appliquée : à appliquer avec apply_migration (name = "cours_binance") sur le projet oapcewpqsbbjdlcdeizi, AVANT le
-- déploiement de la fonction nightly qui écrit dans cours et appelle cours_a_rattraper.
--   cours                 : clôtures quotidiennes en EUR par instrument (isin, date, cloture, source : yahoo | euronext | fixe),
--                           clé primaire (isin, date), environ 5 ans par ISIN détenu. Données publiques de marché : lecture pour
--                           authenticated (tous les ISIN), aucune écriture client ; écrite par la fonction nightly (service_role).
--                           Même contrôle d'ISIN que instruments (0001) ; clé étrangère vers instruments, en cascade.
--   instruments           : + cours_rattrapage_le (dernière tentative de rattrapage de l'historique par nightly ; écrite par le
--                           service seulement, authenticated n'a aucune écriture sur instruments depuis 0001).
--   cours_a_rattraper(n)  : ISIN détenus (lignes non clôturées, tous utilisateurs) qui ont moins de 30 cours et une source
--                           possible (symbole Yahoo, ou vrai ISIN en EUR pour le repli Euronext), jamais tentés ou tentés il y a
--                           plus de 7 jours ; jamais tentés d'abord, puis les moins fournis. Ne renvoie ni utilisateur ni
--                           quantité. Security definer, search_path vide, service_role seulement.
--   fonctionnalites       : la contrainte fonctionnalites_cle accepte 'banque' et 'binance' (pilote Binance, activé par le
--                           service ; la fonction nightly n'agit que si un seul utilisateur l'a activé).
--   positions             : la contrainte positions_source_auto accepte 'powens' et 'binance'.
--   apply_recurring()     : repart de 0003_nightly.sql (seule définition) ; un versement programmé vers une ligne synchronisée
--                           (source_auto non nul : powens ou binance) est ignoré (quantité tenue par la synchronisation, sinon
--                           compté deux fois) : ni ligne, ni transaction, ni alerte, lastApplied inchangé (reprise si la ligne
--                           n'est plus synchronisée). Le reste est identique.
--   Tests : test/cours-pglite.test.mjs (PGlite, baseComplete).

-- ---------------------------------------------------------------------------
-- Cours historiques
-- ---------------------------------------------------------------------------
create table public.cours (
  isin    text not null references public.instruments(isin) on delete cascade
          constraint cours_isin check (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$' or isin like 'X-%'),
  date    date not null,
  cloture numeric not null constraint cours_cloture check (cloture > 0),
  source  text constraint cours_source check (source is null or char_length(source) between 1 and 30),
  primary key (isin, date)
);

alter table public.cours enable row level security;
create policy "cours: lecture connectés" on public.cours for select to authenticated using (true);
revoke all on table public.cours from public, anon, authenticated;
grant select on table public.cours to authenticated;
grant select, insert, update, delete on table public.cours to service_role;

alter table public.instruments add column if not exists cours_rattrapage_le timestamptz;

-- ---------------------------------------------------------------------------
-- ISIN dont l'historique est à rattraper (fonction nightly, au plus p_limite par nuit)
-- ---------------------------------------------------------------------------
create or replace function public.cours_a_rattraper(p_limite int default 10)
returns table (isin text, symbol text, currency text, nb_cours int)
language sql
stable
security definer
set search_path = ''
as $$
  select i.isin, nullif(btrim(i.symbol), '') as symbol, upper(coalesce(i.currency, 'EUR')) as currency,
         (select count(*)::int from public.cours c where c.isin = i.isin) as nb_cours
    from public.instruments i
   where exists (select 1 from public.positions p where p.isin = i.isin and p.status <> 'clôturé')
     and (nullif(btrim(i.symbol), '') is not null
          or (i.isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$' and upper(coalesce(i.currency, 'EUR')) = 'EUR'))
     and (i.cours_rattrapage_le is null or i.cours_rattrapage_le < now() - interval '7 days')
     and (select count(*) from public.cours c where c.isin = i.isin) < 30
   order by i.cours_rattrapage_le asc nulls first, nb_cours asc, i.isin
   limit greatest(coalesce(p_limite, 10), 0);
$$;
revoke all on function public.cours_a_rattraper(int) from public, anon, authenticated;
grant execute on function public.cours_a_rattraper(int) to service_role;

-- ---------------------------------------------------------------------------
-- Binance : interrupteur et lignes alimentées
-- ---------------------------------------------------------------------------
alter table public.fonctionnalites drop constraint fonctionnalites_cle;
alter table public.fonctionnalites add constraint fonctionnalites_cle check (cle in ('banque', 'binance'));

alter table public.positions drop constraint positions_source_auto;
alter table public.positions add constraint positions_source_auto check (source_auto in ('powens', 'binance'));

-- ---------------------------------------------------------------------------
-- apply_recurring : repart exactement de 0003_nightly.sql (seule définition jusqu'ici) ; un versement programmé vers une ligne
-- synchronisée (positions.source_auto non nul) est ignoré, sans écriture et sans toucher lastApplied.
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
        select p.id, p.mode, p.status, p.source_auto, coalesce(p.price_override, i.price) as price
          into pos
        from public.positions p
        left join public.instruments i on i.isin = p.isin
        where p.user_id = c.user_id and p.id::text = (e.elem->>'positionId');

        -- 0023 : ligne synchronisée (source_auto powens ou binance) : sa quantité est tenue par la synchronisation, appliquer le
        -- versement en plus le compterait deux fois. Rien n'est écrit pour ce versement ce mois-ci (ni ligne, ni transaction, ni
        -- alerte) et lastApplied reste inchangé : il reprend si la ligne n'est plus synchronisée.
        if found and pos.source_auto is not null then
          continue;
        end if;

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
revoke all on function public.apply_recurring(date, uuid) from public, anon, authenticated;
grant execute on function public.apply_recurring(date, uuid) to service_role;
