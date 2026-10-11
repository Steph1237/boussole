-- Boussole : routines obligatoires des agents (RT1, docs/superpowers/specs/2026-10-11-rt1-routines.md § 1).
-- Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "routines").
--   routines : contrat côté serveur des routines de l'agent (revue_mensuelle en RT1) ; privée (RLS propriétaire), une ligne
--              par utilisateur et par type. Activée par défaut à l'onboarding (activer_routine), mise en pause possible
--              (active = false, seule écriture de l'app). Boussole sait quand la revue est due (prochain_passage) et la
--              réclame, qu'une tâche planifiée existe ou non chez l'assistant.
--   questions : questions du mois en attente de l'utilisateur, [{ question (1-300), pourquoi? (≤ 300), champ? (≤ 60,
--              identifiant du catalogue des formulaires) }], 10 au plus ; validées par cloturer_routine (et par le connecteur
--              pour questions_routine) ; la contrainte de table ne garde que le tableau et sa taille.
--   routine_date(jour, depuis, ecart) : premier jour « jour » d'un mois qui tombe au plus tôt à depuis + ecart.
--   activer_routine / cloturer_routine : RPC security invoker (RLS de l'appelant) ; « aujourd'hui » = date à Paris.
--   export_all() : + routines (repart de 0013_journal.sql).
--   Prérequis : public.contenu_sensible (0009) et public.jsonb_textes (0016).

-- ---------------------------------------------------------------------------
-- Date du prochain passage (pure, immuable). Jour limité à 1-28 : existe dans tous les mois.
--   (1, 2026-10-11, 7) → 2026-11-01 ; (15, 2026-10-01, 7) → 2026-10-15 ; (28, 2026-12-25, 7) → 2027-01-28.
-- ---------------------------------------------------------------------------
create or replace function public.routine_date(p_jour int, p_depuis date, p_ecart int)
returns date
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_cible date := p_depuis + p_ecart;
  v_d     date;
begin
  if p_jour < 1 or p_jour > 28 then
    raise exception 'Jour invalide : choisis un jour entre 1 et 28.' using errcode = '22023';
  end if;
  v_d := make_date(extract(year from v_cible)::int, extract(month from v_cible)::int, p_jour);
  if v_d < v_cible then
    v_d := (v_d + interval '1 month')::date;
  end if;
  return v_d;
end;
$$;

-- ---------------------------------------------------------------------------
-- Table privée (user_id = auth.uid())
-- ---------------------------------------------------------------------------
create table public.routines (
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type                 text not null constraint routines_type check (type in ('revue_mensuelle')),
  jour                 int not null default 1 constraint routines_jour check (jour between 1 and 28),
  active               boolean not null default true,
  -- la revue est déposée au journal sans redemander (toujours « à relire ») ; sinon selon profiles.journal_consentement.
  -- Faux par défaut : seul activer_routine, appelé après l'accord de l'utilisateur, pose vrai (création implicite par
  -- cloturer_routine : faux).
  consentement_journal boolean not null default false,
  dernier_passage      timestamptz,
  dernier_client       text constraint routines_dernier_client check (dernier_client is null or char_length(dernier_client) <= 100),
  prochain_passage     date,
  questions            jsonb not null default '[]'::jsonb constraint routines_questions check (
                         case when jsonb_typeof(questions) = 'array'
                              then jsonb_array_length(questions) <= 10 and octet_length(questions::text) <= 10000
                              else false end),
  synthese             text constraint routines_synthese check (synthese is null or char_length(synthese) <= 4000),
  cree_le              timestamptz not null default now(),
  maj_le               timestamptz not null default now(),
  primary key (user_id, type),
  -- Contrainte nommée : le message d'erreur (« violates check constraint "routines_contenu_sensible" ») permet au front et au
  -- connecteur de traduire ce seul refus en « information sensible » (même fonction que memoire_agent et journal, 0009).
  -- Questions : seuls leurs textes sont contrôlés (public.jsonb_textes, 0016, un texte par ligne), pas le JSON brut.
  constraint routines_contenu_sensible check (not (public.contenu_sensible(synthese) or public.contenu_sensible(public.jsonb_textes(questions))))
);

alter table public.routines enable row level security;
create policy "routines: select" on public.routines for select to authenticated using ((select auth.uid()) = user_id);
create policy "routines: insert" on public.routines for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "routines: update" on public.routines for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "routines: delete" on public.routines for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.routines from anon, authenticated;
grant select, insert, update, delete on table public.routines to authenticated;

-- ---------------------------------------------------------------------------
-- Déclencheurs. Avant insertion : prochain passage absent → routine_date(jour, aujourd'hui, 7).
-- Avant mise à jour : maj_le tenu à jour, cree_le figée ; si le jour change, ou si la routine sort de pause, le prochain
-- passage repart d'aujourd'hui (routine_date(jour, aujourd'hui, 7)). Un jour hors 1-28 est laissé à la contrainte
-- routines_jour (message nommé).
-- ---------------------------------------------------------------------------
create or replace function public.routines_init()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.prochain_passage is null and new.jour between 1 and 28 then
    new.prochain_passage := public.routine_date(new.jour, (now() at time zone 'Europe/Paris')::date, 7);
  end if;
  return new;
end;
$$;
create trigger routines_init before insert on public.routines for each row execute function public.routines_init();

create or replace function public.routines_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.maj_le := now();
  new.cree_le := old.cree_le;
  if new.jour between 1 and 28
     and (new.jour is distinct from old.jour or (new.active and not old.active)) then
    new.prochain_passage := public.routine_date(new.jour, (now() at time zone 'Europe/Paris')::date, 7);
  end if;
  return new;
end;
$$;
create trigger routines_maj before update on public.routines for each row execute function public.routines_maj();

-- ---------------------------------------------------------------------------
-- activer_routine(type, jour?, consentement_journal?) : crée la routine (jour 1, consentement oui : posé ici explicitement,
-- l'outil n'étant appelé qu'après l'accord de l'utilisateur) ou la réactive ; un jour ou un consentement non nul remplace la
-- valeur. Renvoie la ligne.
-- ---------------------------------------------------------------------------
create or replace function public.activer_routine(p_type text, p_jour int default null, p_consentement_journal boolean default null)
returns public.routines
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_r   public.routines;
begin
  if v_uid is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('revue_mensuelle') then
    raise exception 'Type de routine inconnu : %. Type possible : revue_mensuelle.', coalesce(p_type, '(vide)') using errcode = '22023';
  end if;
  if p_jour is not null and (p_jour < 1 or p_jour > 28) then
    raise exception 'Jour invalide : choisis un jour entre 1 et 28.' using errcode = '22023';
  end if;
  insert into public.routines as r (user_id, type, jour, consentement_journal, active)
  values (v_uid, p_type, coalesce(p_jour, 1), coalesce(p_consentement_journal, true), true)
  on conflict (user_id, type) do update
    set jour = coalesce(p_jour, r.jour),
        consentement_journal = coalesce(p_consentement_journal, r.consentement_journal),
        active = true
  returning r.* into v_r;
  return v_r;
end;
$$;

-- ---------------------------------------------------------------------------
-- cloturer_routine(type, client, synthese, questions) : enregistre un passage (date, client), la synthèse (1-4 000
-- caractères, blancs et sauts de ligne retirés autour ; faite de blancs seuls : refusée) et les questions du mois (validées,
-- réduites aux clés question, pourquoi, champ) ; prochain passage = routine_date(jour, aujourd'hui, 10), donc identique pour
-- deux appels le même jour. Crée la routine si elle est absente (active, jour 1, SANS consentement au journal : il n'a pas été
-- demandé) ; refuse une routine en pause. Renvoie la ligne.
-- ---------------------------------------------------------------------------
create or replace function public.cloturer_routine(p_type text, p_client text, p_synthese text, p_questions jsonb)
returns public.routines
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_q    jsonb := coalesce(p_questions, '[]'::jsonb);
  v_norm jsonb := '[]'::jsonb;
  v_s    text := btrim(p_synthese, E' \t\r\n');
  v_e    jsonb;
  v_i    bigint;
  v_r    public.routines;
begin
  if v_uid is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('revue_mensuelle') then
    raise exception 'Type de routine inconnu : %. Type possible : revue_mensuelle.', coalesce(p_type, '(vide)') using errcode = '22023';
  end if;
  if exists (select 1 from public.routines r where r.user_id = v_uid and r.type = p_type and not r.active) then
    raise exception 'Revue mensuelle en pause : réactive-la avant de la clôturer.' using errcode = '22023';
  end if;
  if v_s is null or v_s !~ '[^[:space:]]' or char_length(v_s) > 4000 then
    raise exception 'Synthèse vide ou trop longue : 1 à 4 000 caractères.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_q) = 'null' then
    v_q := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_q) <> 'array' then
    raise exception 'Questions invalides : un tableau [{ question, pourquoi?, champ? }] est attendu.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_q) > 10 then
    raise exception 'Trop de questions : 10 au plus (% reçues).', jsonb_array_length(v_q) using errcode = '22023';
  end if;
  for v_e, v_i in select t.e, t.i from jsonb_array_elements(v_q) with ordinality as t(e, i) loop
    if jsonb_typeof(v_e) <> 'object' then
      raise exception 'Question % : objet { question, pourquoi?, champ? } attendu.', v_i using errcode = '22023';
    end if;
    if jsonb_typeof(v_e -> 'question') is distinct from 'string'
       or char_length(btrim(v_e ->> 'question')) < 1 or char_length(btrim(v_e ->> 'question')) > 300 then
      raise exception 'Question % : texte vide ou trop long (1 à 300 caractères).', v_i using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_e -> 'pourquoi'), 'null') <> 'null'
       and (jsonb_typeof(v_e -> 'pourquoi') <> 'string' or char_length(v_e ->> 'pourquoi') > 300) then
      raise exception 'Question % : « pourquoi » invalide (texte de 300 caractères au plus).', v_i using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_e -> 'champ'), 'null') <> 'null'
       and (jsonb_typeof(v_e -> 'champ') <> 'string' or (v_e ->> 'champ') !~ '^[A-Za-z0-9_.]{1,60}$') then
      raise exception 'Question % : champ invalide (identifiant du catalogue des formulaires, 60 caractères au plus).', v_i using errcode = '22023';
    end if;
    v_norm := v_norm || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'question', btrim(v_e ->> 'question'),
      'pourquoi', nullif(btrim(v_e ->> 'pourquoi'), ''),
      'champ',    v_e ->> 'champ')));
  end loop;
  if octet_length(v_norm::text) > 10000 then
    raise exception 'Questions trop longues : 10 000 octets au plus.' using errcode = '22023';
  end if;

  insert into public.routines (user_id, type, consentement_journal) values (v_uid, p_type, false) on conflict (user_id, type) do nothing;
  update public.routines r
     set dernier_passage  = now(),
         dernier_client   = left(nullif(btrim(p_client), ''), 100),
         synthese         = v_s,
         questions        = v_norm,
         prochain_passage = public.routine_date(r.jour, (now() at time zone 'Europe/Paris')::date, 10)
   where r.user_id = v_uid and r.type = p_type
  returning r.* into v_r;
  return v_r;
end;
$$;

revoke all on function public.routine_date(int, date, int) from public, anon;
grant execute on function public.routine_date(int, date, int) to authenticated;
revoke all on function public.activer_routine(text, int, boolean) from public, anon;
grant execute on function public.activer_routine(text, int, boolean) to authenticated;
revoke all on function public.cloturer_routine(text, text, text, jsonb) from public, anon;
grant execute on function public.cloturer_routine(text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- export_all() : + routines (repart de 0013_journal.sql, seule définition depuis)
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
    'journal',      (select coalesce(jsonb_agg(to_jsonb(j) order by j.cree_le), '[]') from public.journal j where j.user_id = auth.uid()),
    'routines',     (select coalesce(jsonb_agg(to_jsonb(rt) order by rt.type), '[]') from public.routines rt where rt.user_id = auth.uid())
  );
$$;
revoke all on function public.export_all() from public, anon;
grant execute on function public.export_all() to authenticated;
