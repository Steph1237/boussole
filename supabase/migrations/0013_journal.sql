-- Boussole : journal des décisions (CK2, docs/superpowers/specs/2026-10-10-cockpit.md § CK2 en détail).
-- Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "journal").
--   journal : avis, décisions, scénarios, revues, hypothèses, événements écrits par l'agent (avec l'accord de l'utilisateur)
--             ou par Boussole ; état du patrimoine figé au moment de l'écriture ; privé (RLS), 2 000 entrées au plus.
--             Une entrée naît « à relire » ; dès qu'elle a été confirmée, toute modification des champs suivis est historisée
--             (rien ne se réécrit en silence).
--   profiles.journal_consentement : ce que l'agent peut enregistrer (demander · prevenir · jamais).

-- ---------------------------------------------------------------------------
-- Table privée (user_id = auth.uid())
-- ---------------------------------------------------------------------------
create table public.journal (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type          text not null check (type in ('avis','decision','scenario','revue','hypothese','evenement')),
  titre         text not null check (char_length(btrim(titre)) between 3 and 120),
  synthese      text not null check (char_length(btrim(synthese)) between 1 and 600),
  raisonnement  text check (raisonnement is null or char_length(raisonnement) <= 8000),
  -- [{ titre, retenue, pourquoi }], 6 au plus
  options       jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 6 and octet_length(options::text) <= 10000),
  statut        text not null default 'a_relire' check (statut in ('a_relire','actif','realise','abandonne','archive')),
  date_decision date,
  revue_le      date,
  -- { objectifs: [uuid], positions: [uuid], biens: [uuid], credits: [uuid] }
  liens         jsonb not null default '{}'::jsonb check (jsonb_typeof(liens) = 'object' and octet_length(liens::text) <= 10000),
  -- état du patrimoine figé à l'écriture (calculé par le connecteur) ; immuable ensuite (déclencheur journal_historique)
  etat          jsonb not null default '{}'::jsonb check (jsonb_typeof(etat) = 'object' and octet_length(etat::text) <= 20000),
  source        text check (source is null or char_length(source) <= 100),
  -- [{ le, champ, avant, apres }], tenu par le déclencheur seul
  historique    jsonb not null default '[]'::jsonb check (jsonb_typeof(historique) = 'array'),
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz not null default now(),
  -- Contrainte nommée : le message d'erreur (« violates check constraint "journal_contenu_sensible" ») permet au front et au
  -- connecteur de traduire ce seul refus en « information sensible » (même fonction que memoire_agent, 0009).
  constraint journal_contenu_sensible check (not (public.contenu_sensible(titre) or public.contenu_sensible(synthese) or public.contenu_sensible(raisonnement)))
);
create index journal_user on public.journal (user_id, cree_le desc);

alter table public.journal enable row level security;
create policy "journal: select" on public.journal for select to authenticated using ((select auth.uid()) = user_id);
create policy "journal: insert" on public.journal for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "journal: update" on public.journal for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "journal: delete" on public.journal for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.journal from anon, authenticated;
grant select, insert, update, delete on table public.journal to authenticated;

-- ---------------------------------------------------------------------------
-- 2 000 entrées au plus par utilisateur ; historique vide à la création (non falsifiable).
-- ---------------------------------------------------------------------------
create or replace function public.journal_limite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Verrou par utilisateur le temps de la transaction : deux insertions simultanées ne peuvent pas dépasser la limite.
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  if (select count(*) from public.journal j where j.user_id = new.user_id) >= 2000 then
    raise exception 'Journal plein : 2 000 entrées au plus. Supprimez-en dans Boussole › Agent › Journal.' using errcode = '54000';
  end if;
  new.historique := '[]'::jsonb;
  return new;
end;
$$;
create trigger journal_limite before insert on public.journal for each row execute function public.journal_limite();

-- ---------------------------------------------------------------------------
-- Historique (rien ne se réécrit en silence) : une fois l'entrée confirmée (statut ≠ a_relire, ou historique déjà
-- commencé — un retour à « à relire » est lui-même tracé et ne rouvre pas une fenêtre de réécriture silencieuse), toute
-- modification de type, titre, synthese, raisonnement, statut, date_decision, revue_le, options ou liens ajoute une entrée :
--   { le, champ, avant, apres } ;
--   raisonnement prolongé (la nouvelle valeur commence par l'ancienne, cas d'une note ajoutée) : { le, champ, ajout } avec
--   le seul suffixe, pour ne pas recopier tout le raisonnement à chaque note.
-- Le passage a_relire → actif (première confirmation) n'est pas historisé. L'historique repart toujours de l'ancien (une
-- écriture directe est ignorée) et garde les 200 dernières entrées (les plus anciennes sont retirées). L'état figé et la
-- date de création ne changent pas ; maj_le est tenu à jour.
-- ---------------------------------------------------------------------------
create or replace function public.journal_historique()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_avant jsonb := to_jsonb(old);
  v_apres jsonb := to_jsonb(new);
  v_champ text;
  v_ancien text := coalesce(old.raisonnement, '');
  v_n int;
begin
  new.etat := old.etat;
  new.cree_le := old.cree_le;
  new.historique := old.historique;
  new.maj_le := now();
  if old.statut <> 'a_relire' or jsonb_array_length(old.historique) > 0 then
    foreach v_champ in array array['type','titre','synthese','raisonnement','statut','date_decision','revue_le','options','liens'] loop
      if v_apres -> v_champ is distinct from v_avant -> v_champ then
        if v_champ = 'raisonnement' and new.raisonnement is not null and starts_with(new.raisonnement, v_ancien) then
          new.historique := new.historique || jsonb_build_array(jsonb_build_object('le', now(), 'champ', 'raisonnement', 'ajout', substr(new.raisonnement, char_length(v_ancien) + 1)));
        else
          new.historique := new.historique || jsonb_build_array(jsonb_build_object('le', now(), 'champ', v_champ, 'avant', v_avant -> v_champ, 'apres', v_apres -> v_champ));
        end if;
      end if;
    end loop;
    -- Plafond : 200 dernières entrées.
    v_n := jsonb_array_length(new.historique);
    if v_n > 200 then
      select jsonb_agg(h.e order by h.i) into new.historique
        from jsonb_array_elements(new.historique) with ordinality as h(e, i)
       where h.i > v_n - 200;
    end if;
  end if;
  return new;
end;
$$;
create trigger journal_historique before update on public.journal for each row execute function public.journal_historique();

-- ---------------------------------------------------------------------------
-- Consentement (RLS existante sur profiles : l'utilisateur modifie sa ligne, 0001)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists journal_consentement text not null default 'demander'
  constraint profiles_journal_consentement check (journal_consentement in ('demander','prevenir','jamais'));

-- ---------------------------------------------------------------------------
-- export_all() : + journal (repart de 0009_savoir_memoire.sql)
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
    'memoire_agent', (select coalesce(jsonb_agg(to_jsonb(m) order by m.cree_le), '[]') from public.memoire_agent m where m.user_id = auth.uid()),
    'journal',      (select coalesce(jsonb_agg(to_jsonb(j) order by j.cree_le), '[]') from public.journal j where j.user_id = auth.uid())
  );
$$;
revoke all on function public.export_all() from public, anon;
grant execute on function public.export_all() to authenticated;
