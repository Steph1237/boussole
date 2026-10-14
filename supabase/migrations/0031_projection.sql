-- Boussole : moteur de projection (PROJ, docs/superpowers/specs/2026-10-14-proj-projection-design.md § 7, § 11.4, § 14 et § 15).
-- Non appliquée : à appliquer avec apply_migration (name = "projection") sur le projet oapcewpqsbbjdlcdeizi, après 0029 (calendrier) et
-- 0030 (repères de la projection, idempotente, sans table ni fonction), AVANT le déploiement de la fonction mcp (outils decrire_foyer, lire_foyer, projeter… qui lisent et écrivent ces tables et ces clés).
--
-- Trois tables personnelles (user_id = auth.uid(), on delete cascade depuis auth.users : delete_me les emporte) :
--   foyer_variantes  : variantes de la situation du foyer (nom, description, événements retirés, hypothèses) ; 10 au plus par utilisateur ;
--   foyer_evenements : événements de vie (naissance, garde, achat, retrait, hausse de revenu, fin de crédit, crise, changement d'emploi,
--     congé parental) ; variante_id nul = situation actuelle ; supprimer une variante supprime ses événements ; 100 au plus par utilisateur ;
--     les 7 types réservés (chomage, separation, invalidite, retraite, heritage, temps_partiel, demenagement) sont acceptés par la
--     contrainte de la table mais refusés par appliquer_propositions tant que le moteur ne les calcule pas ;
--   plans_figes      : plan de projection gelé à une date (revue mensuelle, objectif ou demande manuelle) : paramètres et série
--     (100 000 et 250 000 octets au plus), 60 au plus par utilisateur, jamais modifiés (aucun droit d'update), créés et supprimés
--     par proposition (cible plan_fige).
--   Écriture : par appliquer_propositions seulement (security invoker) ; les droits insert / update / delete sont accordés comme pour
--   objectifs (0004) avec les mêmes politiques de propriétaire, car la fonction s'exécute avec les droits de l'appelant.
--   La variante d'un événement doit appartenir au même utilisateur (déclencheur foyer_evenements_variante, y compris pour le service).
-- Double authentification (0028) : chaque table a sa politique RESTRICTIVE « <table>: aal2 si facteur », au modèle exact de 0028
--   (test/mfa-pglite.test.mjs énumère les tables à user_id et échoue si l'une n'en a pas).
-- indices_mensuels : contenu commun (série, mois, valeur, source), lisible par anon et authenticated, sans user_id, écrit par migration
--   ou par le service seulement. Série ipc_insee (Insee, identifiant 011814630), 60 mois.
-- config.projection : réglages de la projection du foyer (jsonb objet, défaut {}), écrits par appliquer_propositions (cible config, clé
--   projection) : base_capacite, capacite_mensuelle, reste_capacite, reequilibrage, part_reaffectee_epargne_pct, part_hausse_epargnee_pct,
--   salaire_croissance_reelle_pct, tmi_pct, per_versements_deduits, assurance_pct, biens { "bien:<uuid>": { prix_achat, date_achat,
--   source, le } }, source, le ; fusion par champ, null retire un champ.
-- Les 68 repères du § 11.4 et l'extension de reperes_unite_check (unités UC, h, dates) sont dans 0030_reperes_projection.sql.
-- propositions : nouvelles cibles evenement, variante et plan_fige (propositions_cible_check étendue ; ref obligatoire pour modifier et
--   supprimer, comme pour objectif ; plan_fige : création et suppression seulement). La taille de apres reste de 20 000 octets, sauf pour
--   plan_fige (400 000 octets : un plan embarque ses paramètres et sa série).
-- appliquer_propositions : repart exactement de 0029 (0030 ne la redéfinit pas) ; les ajouts sont :
--   - les cibles evenement et variante (creer, modifier, supprimer) et plan_fige (creer, supprimer), avec contrôle des limites ;
--   - la clé projection de la cible config ;
--   - quatre lignes de messages de la cible config, mises à jour pour citer projection (liste blanche des clés comprise).
--   La validation d'un événement et d'une variante suit les mêmes règles, dans le même ordre et avec les mêmes messages que
--   web/src/projection-evenements.js (validerEvenement, validerVariante), qui fait foi : elle est portée par deux fonctions pures,
--   foyer_valider_evenement et foyer_valider_variante, que la fonction appelle. Ces fonctions n'accèdent à aucune table ; elles sont
--   exécutables par authenticated (l'appelant est en security invoker) et par service_role, jamais par anon. La date « aujourd'hui »
--   du contrôle est current_date. Écarts connus avec le JS : l'ordre des clés d'un objet (jsonb ordonne les clés par longueur puis
--   alphabet, le JS dans l'ordre d'insertion) ne change le message que si plusieurs clés sont fautives à la fois.
--   Tout le reste est inchangé : tout ou rien, security invoker, search_path vide, mêmes droits.
--   Les contrôles sont répétés à l'identique dans le connecteur (supabase/functions/mcp) et dans la démo (store-demo.js) :
--   l'utilisateur peut corriger une proposition avant de la valider, et seule la base voit la valeur finale.
-- export_all : repart de sa dernière définition (0021) et ajoute foyer_evenements, foyer_variantes et plans_figes (tableaux).
-- Tests : test/projection-pglite.test.mjs (PGlite, baseComplete jusqu'à 0029 puis 0030 et cette migration).

-- ---------------------------------------------------------------------------
-- config.projection
-- ---------------------------------------------------------------------------
alter table public.config add column if not exists projection jsonb not null default '{}'::jsonb;
alter table public.config drop constraint if exists config_projection;
alter table public.config add constraint config_projection check (jsonb_typeof(projection) = 'object');

-- ---------------------------------------------------------------------------
-- Tables privées (user_id = auth.uid())
-- ---------------------------------------------------------------------------
create table public.foyer_variantes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom         text not null check (char_length(nom) between 1 and 40),
  description text not null default '' check (char_length(description) <= 300),
  retire      uuid[] not null default '{}',
  hypotheses  jsonb not null default '{}'::jsonb check (jsonb_typeof(hypotheses) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.foyer_evenements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  variante_id uuid references public.foyer_variantes(id) on delete cascade,   -- null : situation actuelle
  type        text not null check (type in ('naissance', 'creche', 'scolarite_privee', 'achat_immobilier', 'retrait', 'hausse_revenu',
                'fin_credit', 'crise', 'changement_emploi', 'conge_parental',
                'chomage', 'separation', 'invalidite', 'retraite', 'heritage', 'temps_partiel', 'demenagement')),
  personne    text not null default 'foyer' check (personne in ('p1', 'p2', 'foyer')),
  libelle     text not null check (char_length(libelle) between 1 and 60),
  date        date not null,
  fin         date,
  params      jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  source      text not null check (char_length(source) between 1 and 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint foyer_evenements_fin check (fin is null or fin >= date)
);

create table public.plans_figes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cree_le      timestamptz not null default now(),
  raison       text not null check (raison in ('revue_mensuelle', 'objectif', 'manuel')),
  horizon_mois int not null check (horizon_mois between 1 and 300),
  parametres   jsonb not null check (jsonb_typeof(parametres) = 'object'),
  serie        jsonb not null check (jsonb_typeof(serie) = 'object'),
  constraint plans_figes_parametres_taille check (octet_length(parametres::text) <= 100000),
  constraint plans_figes_serie_taille check (octet_length(serie::text) <= 250000)
);

create index foyer_variantes_user_id_idx  on public.foyer_variantes (user_id);
create index foyer_evenements_user_id_idx on public.foyer_evenements (user_id);
create index foyer_evenements_variante_idx on public.foyer_evenements (variante_id);
create index plans_figes_user_cree_idx    on public.plans_figes (user_id, cree_le desc);

create trigger foyer_variantes_set_updated_at  before update on public.foyer_variantes  for each row execute function public.set_updated_at();
create trigger foyer_evenements_set_updated_at before update on public.foyer_evenements for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Limites par utilisateur (100 événements, 10 variantes, 60 plans) et propriété de la variante d'un événement.
-- Déclencheurs en security invoker : ils comptent avec user_id explicite, donc aussi pour le service (BYPASSRLS).
-- Un verrou consultatif par utilisateur et par table évite que deux insertions simultanées dépassent la limite.
-- ---------------------------------------------------------------------------
create function public.foyer_limites() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_n int;
begin
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || new.user_id::text, 0));
  if tg_table_name = 'foyer_evenements' then
    select count(*) into v_n from public.foyer_evenements where user_id = new.user_id;
    if v_n >= 100 then raise exception 'Limite atteinte : 100 événements au plus. Supprime un événement avant d''en ajouter un.' using errcode = '54000'; end if;
  elsif tg_table_name = 'foyer_variantes' then
    select count(*) into v_n from public.foyer_variantes where user_id = new.user_id;
    if v_n >= 10 then raise exception 'Limite atteinte : 10 variantes au plus. Supprime une variante avant d''en ajouter une.' using errcode = '54000'; end if;
  else
    select count(*) into v_n from public.plans_figes where user_id = new.user_id;
    if v_n >= 60 then raise exception 'Limite atteinte : 60 plans figés au plus. Supprime un plan figé avant d''en ajouter un.' using errcode = '54000'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.foyer_limites() from public, anon;

create trigger foyer_evenements_limite before insert on public.foyer_evenements for each row execute function public.foyer_limites();
create trigger foyer_variantes_limite  before insert on public.foyer_variantes  for each row execute function public.foyer_limites();
create trigger plans_figes_limite      before insert on public.plans_figes      for each row execute function public.foyer_limites();

create function public.foyer_evenements_variante() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if new.variante_id is not null and not exists (
    select 1 from public.foyer_variantes v where v.id = new.variante_id and v.user_id = new.user_id) then
    raise exception 'Cette variante n''existe pas dans tes données.' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.foyer_evenements_variante() from public, anon;

create trigger foyer_evenements_variante before insert or update of variante_id, user_id on public.foyer_evenements
  for each row execute function public.foyer_evenements_variante();

-- ---------------------------------------------------------------------------
-- RLS : politiques de propriétaire par commande, puis politique RESTRICTIVE de double authentification (modèle exact de 0028)
-- ---------------------------------------------------------------------------
alter table public.foyer_variantes  enable row level security;
alter table public.foyer_evenements enable row level security;
alter table public.plans_figes      enable row level security;

create policy "foyer_variantes: select" on public.foyer_variantes for select to authenticated using ((select auth.uid()) = user_id);
create policy "foyer_variantes: insert" on public.foyer_variantes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "foyer_variantes: update" on public.foyer_variantes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "foyer_variantes: delete" on public.foyer_variantes for delete to authenticated using ((select auth.uid()) = user_id);

create policy "foyer_evenements: select" on public.foyer_evenements for select to authenticated using ((select auth.uid()) = user_id);
create policy "foyer_evenements: insert" on public.foyer_evenements for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "foyer_evenements: update" on public.foyer_evenements for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "foyer_evenements: delete" on public.foyer_evenements for delete to authenticated using ((select auth.uid()) = user_id);

create policy "plans_figes: select" on public.plans_figes for select to authenticated using ((select auth.uid()) = user_id);
create policy "plans_figes: insert" on public.plans_figes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "plans_figes: delete" on public.plans_figes for delete to authenticated using ((select auth.uid()) = user_id);

create policy "foyer_variantes: aal2 si facteur" on public.foyer_variantes as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "foyer_evenements: aal2 si facteur" on public.foyer_evenements as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "plans_figes: aal2 si facteur" on public.plans_figes as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));

-- ---------------------------------------------------------------------------
-- Privilèges (RLS reste l'autorité) ; plans_figes : jamais modifiés
-- ---------------------------------------------------------------------------
revoke all on table public.foyer_variantes, public.foyer_evenements, public.plans_figes from anon, authenticated;
grant select, insert, update, delete on table public.foyer_variantes, public.foyer_evenements to authenticated;
grant select, insert, delete on table public.plans_figes to authenticated;

-- ---------------------------------------------------------------------------
-- indices_mensuels : contenu commun (comme reperes), sans user_id
-- ---------------------------------------------------------------------------
create table public.indices_mensuels (
  serie        text    not null check (serie ~ '^[a-z0-9_]{2,60}$'),
  mois         date    not null check (mois = date_trunc('month', mois)::date),
  valeur       numeric not null check (valeur > 0),
  source_titre text    not null check (char_length(source_titre) between 2 and 300),
  source_url   text    not null check (source_url ~ '^https://'),
  verifie_le   date    not null,
  primary key (serie, mois)
);
alter table public.indices_mensuels enable row level security;
revoke all on table public.indices_mensuels from anon, authenticated;
create policy "indices_mensuels: lecture" on public.indices_mensuels for select to anon, authenticated using (true);
grant select on table public.indices_mensuels to anon, authenticated;

-- ---------------------------------------------------------------------------
-- propositions : cibles evenement, variante et plan_fige
-- ---------------------------------------------------------------------------
alter table public.propositions drop constraint if exists propositions_cible_check;
alter table public.propositions add constraint propositions_cible_check
  check (cible in ('profil', 'budget', 'position', 'bien', 'credit', 'objectif', 'risque', 'protection', 'config', 'evenement', 'variante', 'plan_fige'));
alter table public.propositions drop constraint if exists propositions_plan_fige;
alter table public.propositions add constraint propositions_plan_fige check (cible <> 'plan_fige' or operation in ('creer', 'supprimer'));
-- taille de apres : 20 000 octets, 400 000 pour un plan figé (paramètres 100 000 + série 250 000 + clés)
alter table public.propositions drop constraint if exists propositions_apres_check;
alter table public.propositions add constraint propositions_apres_check
  check (apres is null or (jsonb_typeof(apres) = 'object' and octet_length(apres::text) <= case when cible = 'plan_fige' then 400000 else 20000 end));

-- ---------------------------------------------------------------------------
-- Fonctions pures de validation (aucun accès aux tables), appelées par appliquer_propositions.
-- Elles reproduisent web/src/projection-evenements.js : mêmes règles, même ordre, mêmes messages (null = valide).
--   foyer_present(j)            : présent au sens du JS (ni absent, ni null, ni chaîne vide)
--   foyer_nombre(j)             : valeur numérique d'un nombre ou d'une chaîne numérique (« 12 », « 1e3 »), null sinon (NaN, texte)
--   foyer_date(j)               : date réelle AAAA-MM-JJ, null sinon
--   foyer_rogner(t)             : text.trim() du JS (espaces, espaces insécables, séparateurs Unicode)
--   foyer_longueur_texte(j, r)  : longueur du texte en unités UTF-16, comme String.length, après rognage si r ; null si ce n'est pas du texte
-- ---------------------------------------------------------------------------
create function public.foyer_present(j jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select j is not null and jsonb_typeof(j) <> 'null' and j <> '""'::jsonb;
$$;

create function public.foyer_nombre(j jsonb) returns numeric
language plpgsql immutable set search_path = ''
as $$
begin
  if jsonb_typeof(j) = 'number' then return (j #>> '{}')::numeric; end if;
  if jsonb_typeof(j) = 'string' and (j #>> '{}') ~ '^[[:space:]]*[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?[[:space:]]*$' then
    return (j #>> '{}')::numeric;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create function public.foyer_date(j jsonb) returns date
language plpgsql stable set search_path = ''
as $$
begin
  if jsonb_typeof(j) is distinct from 'string' or (j #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  return (j #>> '{}')::date;
exception when others then
  return null;
end;
$$;

create function public.foyer_rogner(t text) returns text
language sql immutable set search_path = ''
as $$
  select regexp_replace(t, '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g');
$$;

create function public.foyer_longueur_texte(j jsonb, rogner boolean default true) returns int
language plpgsql immutable set search_path = ''
as $$
declare
  t text;
begin
  if jsonb_typeof(j) is distinct from 'string' then return null; end if;
  t := j #>> '{}';
  if rogner then t := public.foyer_rogner(t); end if;
  return char_length(t) + char_length(regexp_replace(t, '[^\U00010000-\U0010ffff]', '', 'g'));
end;
$$;

/* Valide un événement { type, personne, libelle, date, fin?, params, source } ; p_credits et p_biens : identifiants (texte) des crédits et
   biens de l'utilisateur, pour fin_credit ; p_aujourdhui : date du jour du contrôle. → null si valide, sinon le message (français, tutoiement). */
create function public.foyer_valider_evenement(p_ev jsonb, p_credits text[] default '{}', p_biens text[] default '{}', p_aujourdhui date default current_date)
returns text
language plpgsql stable set search_path = ''
as $$
declare
  v_type text;
  v_pers text;
  v_p    jsonb;
  v_pret jsonb;
  v_max  date;
  v_d    date;
  v_f    date;
  v_mode text;
  v_n    int;
  v_x    numeric;
  v_m    text;
  v_kind text;
  v_id   text;
begin
  if jsonb_typeof(p_ev) is distinct from 'object' then return 'L''événement doit être un objet.'; end if;
  v_type := case when jsonb_typeof(p_ev->'type') = 'string' then p_ev->>'type' end;
  if v_type in ('chomage', 'separation', 'invalidite', 'retraite', 'heritage', 'temps_partiel', 'demenagement') then
    return 'Ce type d''événement n''est pas encore pris en compte par la projection.';
  end if;
  if v_type is null or v_type not in ('naissance', 'creche', 'scolarite_privee', 'achat_immobilier', 'retrait', 'hausse_revenu', 'fin_credit', 'crise', 'changement_emploi', 'conge_parental') then
    return 'Type d''événement inconnu : choisis parmi naissance, creche, scolarite_privee, achat_immobilier, retrait, hausse_revenu, fin_credit, crise, changement_emploi, conge_parental.';
  end if;
  if jsonb_typeof(p_ev->'personne') is distinct from 'string' or (p_ev->>'personne') not in ('p1', 'p2', 'foyer') then
    return 'La personne doit être p1, p2 ou foyer.';
  end if;
  v_n := public.foyer_longueur_texte(p_ev->'libelle');
  if v_n is null or v_n < 1 or v_n > 60 then return 'Le libellé doit faire de 1 à 60 caractères.'; end if;
  v_max := (p_aujourdhui + interval '40 years')::date;
  v_d := public.foyer_date(p_ev->'date');
  if v_d is null or v_d < date '1950-01-01' or v_d > v_max then
    return 'La date doit être comprise entre le 1er janvier 1950 et dans 40 ans.';
  end if;
  if public.foyer_present(p_ev->'fin') then
    v_f := public.foyer_date(p_ev->'fin');
    if v_f is null or v_f > v_max then return 'La date doit être comprise entre le 1er janvier 1950 et dans 40 ans.'; end if;
    if v_f < v_d then return 'La date de fin doit être postérieure ou égale à la date de début.'; end if;
  end if;
  v_n := public.foyer_longueur_texte(p_ev->'source');
  if v_n is null or v_n < 1 or v_n > 300 then return 'Indique la source de l''information (1 à 300 caractères).'; end if;
  v_p := case when p_ev ? 'params' then p_ev->'params' else '{}'::jsonb end;
  if jsonb_typeof(v_p) is distinct from 'object' then return 'Les paramètres de l''événement doivent former un objet.'; end if;

  /* ----- règles propres à chaque type (ENTREES[type].valider du JS) ----- */
  if v_type = 'naissance' then
    v_n := public.foyer_longueur_texte(v_p->'enfant');
    if v_n is null or v_n < 1 or v_n > 40 then return 'Donne un libellé court pour l''enfant (1 à 40 caractères), par exemple « Enfant 2 ».'; end if;
    v_mode := case when public.foyer_present(v_p->'cout_mode') then v_p->>'cout_mode' else 'uc' end;
    if v_mode not in ('uc', 'montant') then return 'Choisis le mode de coût : « uc » (échelle de l''Insee) ou « montant ».'; end if;
    if exists (select 1 from unnest(array['cout_mensuel']) k where public.foyer_present(v_p->k) and coalesce(public.foyer_nombre(v_p->k) < 0, true)) then
      return 'Les montants doivent être positifs ou nuls.';
    end if;
    if v_mode = 'montant' and not public.foyer_present(v_p->'cout_mensuel') then return 'Indique le coût mensuel de l''enfant.'; end if;
    if public.foyer_present(v_p->'fin_age') then
      v_x := public.foyer_nombre(v_p->'fin_age');
      if v_x is null or v_x < 1 or v_x > 30 then return 'L''âge de fin de charge doit être compris entre 1 et 30 ans.'; end if;
    end if;

  elsif v_type = 'creche' then
    v_n := public.foyer_longueur_texte(v_p->'enfant');
    if v_n is null or v_n < 1 or v_n > 40 then return 'Donne un libellé court pour l''enfant (1 à 40 caractères), par exemple « Enfant 2 ».'; end if;
    v_mode := case when public.foyer_present(v_p->'mode') then v_p->>'mode' else 'psu' end;
    if v_mode not in ('psu', 'assistante_maternelle', 'montant') then return 'Choisis le mode de garde : « psu » (crèche), « assistante_maternelle » ou « montant ».'; end if;
    if exists (select 1 from unnest(array['heures_mois', 'ressources_mensuelles', 'cout_mensuel', 'cmg_mensuel']) k
               where public.foyer_present(v_p->k) and coalesce(public.foyer_nombre(v_p->k) < 0, true)) then
      return 'Les montants doivent être positifs ou nuls.';
    end if;
    if v_mode = 'assistante_maternelle' and not public.foyer_present(v_p->'cout_mensuel') then
      return 'Indique le coût mensuel de l''assistante maternelle (salaire et indemnités), avant l''aide de la Caf.';
    end if;
    if v_mode = 'montant' and not public.foyer_present(v_p->'cout_mensuel') then return 'Indique le coût mensuel de la garde.'; end if;

  elsif v_type = 'scolarite_privee' then
    v_n := public.foyer_longueur_texte(v_p->'enfant');
    if v_n is null or v_n < 1 or v_n > 40 then return 'Donne un libellé court pour l''enfant (1 à 40 caractères), par exemple « Enfant 2 ».'; end if;
    if (v_p->>'niveau') is null or jsonb_typeof(v_p->'niveau') <> 'string' or (v_p->>'niveau') not in ('maternelle', 'elementaire', 'college', 'lycee', 'superieur') then
      return 'Choisis le niveau : « maternelle », « elementaire », « college », « lycee » ou « superieur ».';
    end if;
    if exists (select 1 from unnest(array['frais_annuels']) k where public.foyer_present(v_p->k) and coalesce(public.foyer_nombre(v_p->k) < 0, true)) then
      return 'Les montants doivent être positifs ou nuls.';
    end if;
    if not public.foyer_present(v_p->'frais_annuels') then return 'Indique les frais annuels de l''établissement : il n''existe pas de moyenne officielle.'; end if;

  elsif v_type = 'achat_immobilier' then
    v_pret := case when jsonb_typeof(v_p->'pret') = 'object' then v_p->'pret' else '{}'::jsonb end;
    v_x := public.foyer_nombre(v_p->'apport');
    if exists (select 1 from unnest(array['prix', 'loyer_remplace', 'charges_mensuelles', 'loyer_percu']) k
               where public.foyer_present(v_p->k) and coalesce(public.foyer_nombre(v_p->k) < 0, true))
       or coalesce(v_x < 0, false)
       or exists (select 1 from unnest(array['taux_pct', 'assurance_pct']) k
                  where public.foyer_present(v_pret->k) and coalesce(public.foyer_nombre(v_pret->k) < 0, true)) then
      return 'Les montants doivent être positifs ou nuls.';
    end if;
    if not public.foyer_present(v_p->'prix') or public.foyer_nombre(v_p->'prix') is null then return 'Indique le prix du bien.'; end if;
    if public.foyer_present(v_p->'usage') and (v_p->>'usage') not in ('rp', 'locatif', 'secondaire') then
      return 'Choisis l''usage du bien : « rp », « locatif » ou « secondaire ».';
    end if;
    if not (coalesce(v_p->'apport' = '"max"'::jsonb, false) or v_x is not null) then
      return 'Indique l''apport : un montant, ou « max » pour tout le disponible au-dessus du matelas.';
    end if;
    v_x := public.foyer_nombre(v_pret->'duree_ans');
    if v_x is null or v_x < 1 or v_x > 40 then return 'Indique la durée du prêt en années (de 1 à 40).'; end if;
    if not public.foyer_present(v_p->'charges_mensuelles') then return 'Indique les charges mensuelles du bien (taxe foncière, copropriété, entretien).'; end if;

  elsif v_type = 'retrait' then
    if exists (select 1 from unnest(array['montant']) k where public.foyer_present(v_p->k) and coalesce(public.foyer_nombre(v_p->k) < 0, true)) then
      return 'Les montants doivent être positifs ou nuls.';
    end if;
    if not public.foyer_present(v_p->'montant') then return 'Indique le montant du retrait.'; end if;

  elsif v_type = 'hausse_revenu' then
    v_pers := case when public.foyer_present(v_p->'personne') then v_p->>'personne' else p_ev->>'personne' end;
    if v_pers not in ('p1', 'p2') then return 'Indique la personne concernée : p1 ou p2.'; end if;
    if public.foyer_nombre(v_p->'delta_mensuel') is null and public.foyer_nombre(v_p->'delta_pct') is null then
      return 'Indique la variation du revenu : delta_mensuel (€ par mois, net) ou delta_pct.';
    end if;
    if public.foyer_present(v_p->'part_epargnee_pct') then
      v_x := public.foyer_nombre(v_p->'part_epargnee_pct');
      if v_x is null or v_x < 0 or v_x > 100 then return 'Les pourcentages doivent être compris entre 0 et 100.'; end if;
    end if;

  elsif v_type = 'fin_credit' then
    v_m := case when jsonb_typeof(v_p->'credit') = 'string' then v_p->>'credit' end;
    if v_m is null or v_m !~ '^(credit|bien):.+$' then return 'Ce crédit n''existe pas dans tes données.'; end if;
    v_kind := split_part(v_m, ':', 1);
    v_id := substr(v_m, length(v_kind) + 2);
    if not coalesce(v_id = any (case when v_kind = 'credit' then p_credits else p_biens end), false) then return 'Ce crédit n''existe pas dans tes données.'; end if;
    if public.foyer_present(v_p->'part_reaffectee_epargne_pct') then
      v_x := public.foyer_nombre(v_p->'part_reaffectee_epargne_pct');
      if v_x is null or v_x < 0 or v_x > 100 then return 'Les pourcentages doivent être compris entre 0 et 100.'; end if;
    end if;
    if public.foyer_present(v_p->'date_fin') and public.foyer_date(v_p->'date_fin') is null then
      return 'La date doit être comprise entre le 1er janvier 1950 et dans 40 ans.';
    end if;

  elsif v_type = 'crise' then
    if jsonb_typeof(v_p->'cle') is distinct from 'string' or (v_p->>'cle') not in ('dotcom_2000', 'gfc_2008', 'covid_2020', 'taux_2022', 'inflation_1973') then
      return 'Crise inconnue : choisis parmi dotcom_2000, gfc_2008, covid_2020, taux_2022, inflation_1973.';
    end if;

  elsif v_type = 'changement_emploi' then
    v_pers := case when public.foyer_present(v_p->'personne') then v_p->>'personne' else p_ev->>'personne' end;
    if v_pers not in ('p1', 'p2') then return 'Indique la personne concernée : p1 ou p2.'; end if;
    if exists (select 1 from unnest(array['salaire_net_mensuel', 'revenu_reference_mensuel']) k
               where public.foyer_present(v_p->k) and coalesce(public.foyer_nombre(v_p->k) < 0, true)) then
      return 'Les montants doivent être positifs ou nuls.';
    end if;
    if not public.foyer_present(v_p->'salaire_net_mensuel') then return 'Indique le salaire net mensuel du nouvel emploi (0 pour une période sans revenu).'; end if;
    if public.foyer_present(v_p->'part_epargnee_pct') then
      v_x := public.foyer_nombre(v_p->'part_epargnee_pct');
      if v_x is null or v_x < 0 or v_x > 100 then return 'Les pourcentages doivent être compris entre 0 et 100.'; end if;
    end if;

  elsif v_type = 'conge_parental' then
    v_pers := case when public.foyer_present(v_p->'personne') then v_p->>'personne' else p_ev->>'personne' end;
    if v_pers not in ('p1', 'p2') then return 'Indique la personne concernée : p1 ou p2.'; end if;
    if jsonb_typeof(v_p->'activite') is distinct from 'string' or (v_p->>'activite') not in ('arret', 'mi_temps', 'temps_partiel') then
      return 'Choisis l''activité pendant le congé : « arret », « mi_temps » (50 % au plus) ou « temps_partiel » (de 50 à 80 %).';
    end if;
    if not public.foyer_present(p_ev->'fin') then return 'Indique la date de fin du congé parental.'; end if;
    if public.foyer_present(v_p->'quotite_pct') then
      v_x := public.foyer_nombre(v_p->'quotite_pct');
      if v_x is null or v_x < 0 or v_x > 100 then return 'Les pourcentages doivent être compris entre 0 et 100.'; end if;
    end if;
    if public.foyer_present(v_p->'rang_enfant') then
      v_x := public.foyer_nombre(v_p->'rang_enfant');
      if v_x is null or v_x < 1 or v_x <> trunc(v_x) then return 'Le rang de l''enfant doit être un entier supérieur ou égal à 1.'; end if;
    end if;
  end if;
  return null;
end;
$$;

/* Valide une variante { nom, description?, retire?, hypotheses? } → null ou message (validerVariante du JS). */
create function public.foyer_valider_variante(p_v jsonb)
returns text
language plpgsql stable set search_path = ''
as $$
declare
  v_n   int;
  v_h   jsonb;
  v_k   text;
  v_x   jsonb;
  v_num numeric;
  v_r   jsonb;
begin
  if jsonb_typeof(p_v) is distinct from 'object' then return 'La variante doit être un objet.'; end if;
  v_n := public.foyer_longueur_texte(p_v->'nom');
  if v_n is null or v_n < 1 or v_n > 40 then return 'Le nom de la variante doit faire de 1 à 40 caractères.'; end if;
  if public.foyer_present(p_v->'description') then
    v_n := public.foyer_longueur_texte(p_v->'description', false);
    if v_n is null or v_n > 300 then return 'La description de la variante doit faire 300 caractères au plus.'; end if;
  end if;
  if public.foyer_present(p_v->'retire') then
    v_r := p_v->'retire';
    if jsonb_typeof(v_r) <> 'array' then return '« retire » doit être une liste d''identifiants d''événements.'; end if;
    if exists (select 1 from jsonb_array_elements(v_r) e
               where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      return '« retire » doit être une liste d''identifiants d''événements.';
    end if;
  end if;
  v_h := case when p_v ? 'hypotheses' and jsonb_typeof(p_v->'hypotheses') <> 'null' then p_v->'hypotheses' else '{}'::jsonb end;
  if jsonb_typeof(v_h) <> 'object' then return 'Les hypothèses de la variante doivent former un objet.'; end if;
  select k into v_k from jsonb_object_keys(v_h) k
   where k <> all (array['epargne_delta_mensuel', 'reste_capacite', 'reequilibrage', 'part_reaffectee_epargne_pct', 'part_hausse_epargnee_pct',
     'salaire_croissance_reelle_pct', 'hypotheses_classes']) limit 1;
  if v_k is not null then
    return 'Hypothèse inconnue : « ' || v_k || ' ». Choisis parmi epargne_delta_mensuel, reste_capacite, reequilibrage, part_reaffectee_epargne_pct, part_hausse_epargnee_pct, salaire_croissance_reelle_pct, hypotheses_classes.';
  end if;
  if public.foyer_present(v_h->'epargne_delta_mensuel') then
    v_num := public.foyer_nombre(v_h->'epargne_delta_mensuel');
    if v_num is null or abs(v_num) > 100000 then return 'La variation d''épargne mensuelle doit être comprise entre −100 000 et 100 000 €.'; end if;
  end if;
  if public.foyer_present(v_h->'reste_capacite') and (v_h->>'reste_capacite') not in ('cible', 'disponible') then
    return '« reste_capacite » vaut « cible » ou « disponible ».';
  end if;
  if public.foyer_present(v_h->'reequilibrage') and (v_h->>'reequilibrage') not in ('aucun', 'annuel') then
    return '« reequilibrage » vaut « aucun » ou « annuel ».';
  end if;
  foreach v_k in array array['part_reaffectee_epargne_pct', 'part_hausse_epargnee_pct'] loop
    if public.foyer_present(v_h->v_k) then
      v_num := public.foyer_nombre(v_h->v_k);
      if v_num is null or v_num < 0 or v_num > 100 then return 'Les pourcentages doivent être compris entre 0 et 100.'; end if;
    end if;
  end loop;
  if public.foyer_present(v_h->'salaire_croissance_reelle_pct') then
    v_num := public.foyer_nombre(v_h->'salaire_croissance_reelle_pct');
    if v_num is null or abs(v_num) > 10 then return 'La hausse réelle des salaires doit être comprise entre −10 et 10 % par an.'; end if;
  end if;
  if public.foyer_present(v_h->'hypotheses_classes') then
    if jsonb_typeof(v_h->'hypotheses_classes') <> 'object' then return '« hypotheses_classes » doit être un objet { classe: { rendement, volatilite } }.'; end if;
    for v_k, v_x in select e.key, e.value from jsonb_each(v_h->'hypotheses_classes') e loop
      if v_k <> all (array['actions', 'small_caps', 'emergents', 'obligations', 'immobilier', 'monetaire', 'fonds_euros', 'or', 'crypto', 'autres',
           'actions_nasdaq100', 'immobilier_physique']) then
        return 'Classe inconnue : « ' || v_k || ' ».';
      end if;
      if jsonb_typeof(v_x) <> 'object' then return 'Chaque classe attend { rendement?, volatilite? }.'; end if;
      if public.foyer_present(v_x->'rendement') then
        v_num := public.foyer_nombre(v_x->'rendement');
        if v_num is null or v_num < -50 or v_num > 100 then return 'Le rendement doit être compris entre −50 et 100 % par an.'; end if;
      end if;
      if public.foyer_present(v_x->'volatilite') then
        v_num := public.foyer_nombre(v_x->'volatilite');
        if v_num is null or v_num < 0 or v_num > 200 then return 'La volatilité doit être comprise entre 0 et 200 % par an.'; end if;
      end if;
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function public.foyer_present(jsonb), public.foyer_nombre(jsonb), public.foyer_date(jsonb), public.foyer_rogner(text),
  public.foyer_longueur_texte(jsonb, boolean), public.foyer_valider_evenement(jsonb, text[], text[], date), public.foyer_valider_variante(jsonb)
  from public, anon;
grant execute on function public.foyer_present(jsonb), public.foyer_nombre(jsonb), public.foyer_date(jsonb), public.foyer_rogner(text),
  public.foyer_longueur_texte(jsonb, boolean), public.foyer_valider_evenement(jsonb, text[], text[], date), public.foyer_valider_variante(jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- appliquer_propositions(ids, modifications) : 0029 + cibles evenement, variante et plan_fige + clé projection de la cible config.
-- ---------------------------------------------------------------------------

create or replace function public.appliquer_propositions(p_ids uuid[], p_modifications jsonb default '{}'::jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_mods   jsonb := coalesce(p_modifications, '{}'::jsonb);
  p        record;
  v        jsonb;
  v_obj    jsonb;
  v_key    text;
  v_val    jsonb;
  v_ligne  jsonb;
  v_lignes jsonb;
  v_idx    int;
  v_num    numeric;
  v_id     uuid;
  v_isin   text;
  v_tx     jsonb;
  v_n      int;
  v_count  int := 0;
  v_quoi   text;
  v_cfg    jsonb;
  v_rec    jsonb;
  v_ids    text[];
  v_txt    text;
  v_num2   numeric;
  v_fe     jsonb;
  v_env    text;
  v_le     date;
  v_ei     jsonb;
  v_pi     jsonb;
  v_don    jsonb;
  v_avis   jsonb;
  v_item   jsonb;
  v_row    jsonb;
  v_auj    date;
  v_dt     date;
  v_dt2    date;
  v_nom    text;
  v_sfx    text;
  v_pers   text;
  v_an     int;
  v_ev     jsonb;
  v_msg    text;
  v_cr     text[];
  v_bi     text[];
  v_vid    uuid;
  v_proj   jsonb;
begin
  if v_uid is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  if jsonb_typeof(v_mods) <> 'object' then
    raise exception 'Modifications invalides : objet { identifiant: valeur } attendu.' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  for p in
    select pr.* from public.propositions pr
    where pr.id = any(p_ids) and pr.user_id = v_uid and pr.statut = 'en_attente'
    order by pr.cree_le, pr.id
    for update
  loop
    v := case when v_mods ? p.id::text then v_mods -> p.id::text else p.apres end;
    v_quoi := case p.cible when 'profil' then 'profil' when 'budget' then 'ligne de budget' when 'position' then 'placement'
      when 'bien' then 'bien immobilier' when 'credit' then 'crédit' when 'objectif' then 'objectif'
      when 'risque' then 'profil de risque' when 'protection' then 'protection' when 'config' then 'réglages' end;
    v_quoi := coalesce(v_quoi, case p.cible when 'evenement' then 'événement' when 'variante' then 'variante' when 'plan_fige' then 'plan figé' end);
    begin
      if p.operation <> 'supprimer' and (v is null or jsonb_typeof(v) <> 'object') then
        raise exception 'valeur proposée invalide (objet attendu)';
      end if;

      case p.cible
      /* ---------- profil : fusion par clé dans foyer / personnes / autres ---------- */
      when 'profil' then
        insert into public.profiles (user_id) values (v_uid) on conflict (user_id) do nothing;
        if v ? 'foyer' then
          if jsonb_typeof(v->'foyer') <> 'object' then raise exception 'foyer : objet attendu'; end if;
          update public.profiles set foyer = jsonb_strip_nulls(coalesce(foyer, '{}'::jsonb) || (v->'foyer')) where user_id = v_uid;
        end if;
        if v ? 'personnes' then
          if jsonb_typeof(v->'personnes') <> 'object' then raise exception 'personnes : objet attendu'; end if;
          select coalesce(pf.personnes, '{}'::jsonb) into v_obj from public.profiles pf where pf.user_id = v_uid;
          for v_key, v_val in select e.key, e.value from jsonb_each(v->'personnes') e loop
            if v_key not in ('p1', 'p2') then raise exception 'personne « % » inconnue (p1 ou p2)', v_key; end if;
            if jsonb_typeof(v_val) = 'null' then
              if v_key = 'p1' then raise exception 'la première personne du foyer ne peut pas être retirée'; end if;
              v_obj := v_obj - v_key;
            elsif jsonb_typeof(v_val) = 'object' then
              -- naissance (0029) : AAAA-MM-JJ ou AAAA-MM, date réelle, pas dans le futur, pas avant 1900 (null la retire)
              if jsonb_typeof(v_val->'naissance') is not null and jsonb_typeof(v_val->'naissance') <> 'null' then
                begin
                  if jsonb_typeof(v_val->'naissance') <> 'string' or (v_val->>'naissance') !~ '^\d{4}-\d{2}(-\d{2})?$' then raise exception 'format'; end if;
                  v_dt := (case when char_length(v_val->>'naissance') = 7 then (v_val->>'naissance') || '-01' else v_val->>'naissance' end)::date;
                exception when others then
                  raise exception 'personnes.% : naissance invalide (AAAA-MM-JJ ou AAAA-MM)', v_key;
                end;
                if v_dt > (now() at time zone 'Europe/Paris')::date then raise exception 'personnes.% : naissance dans le futur', v_key; end if;
                if v_dt < date '1900-01-01' then raise exception 'personnes.% : naissance antérieure à 1900', v_key; end if;
              end if;
              v_obj := jsonb_set(v_obj, array[v_key],
                jsonb_strip_nulls(case when jsonb_typeof(v_obj->v_key) = 'object' then v_obj->v_key else '{}'::jsonb end || v_val), true);
            else
              raise exception 'personnes.% : objet ou null attendu', v_key;
            end if;
          end loop;
          update public.profiles set personnes = v_obj where user_id = v_uid;
        end if;
        if v ? 'autres' then
          if jsonb_typeof(v->'autres') <> 'object' then raise exception 'autres : objet attendu'; end if;
          select coalesce(pf.autres, '{}'::jsonb) into v_obj from public.profiles pf where pf.user_id = v_uid;
          for v_key, v_val in select e.key, e.value from jsonb_each(v->'autres') e loop
            if v_key not in ('p1', 'p2') then raise exception 'autres : personne « % » inconnue (p1 ou p2)', v_key; end if;
            if jsonb_typeof(v_val) <> 'object' then raise exception 'autres.% : objet attendu', v_key; end if;
            v_obj := jsonb_set(v_obj, array[v_key],
              jsonb_strip_nulls(case when jsonb_typeof(v_obj->v_key) = 'object' then v_obj->v_key else '{}'::jsonb end || v_val), true);
          end loop;
          update public.profiles set autres = v_obj where user_id = v_uid;
        end if;
        /* classes (0019) : surcharges poche → classe d'actifs, fusionnées ; null retire la surcharge de la poche. */
        if v ? 'classes' then
          if jsonb_typeof(v->'classes') <> 'object' then raise exception 'classes : objet { poche: classe } attendu'; end if;
          for v_key, v_val in select e.key, e.value from jsonb_each(v->'classes') e loop
            if btrim(v_key) = '' or char_length(v_key) > 60 then raise exception 'classes : nom de poche invalide (1 à 60 caractères)'; end if;
            continue when jsonb_typeof(v_val) = 'null';
            if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in
                ('actions', 'small_caps', 'emergents', 'levier', 'obligations', 'immobilier', 'monetaire', 'fonds_euros', 'or', 'crypto', 'autres') then
              raise exception 'classe « % » inconnue pour la poche « % » (actions, small_caps, emergents, levier, obligations, immobilier, monetaire, fonds_euros, or, crypto ou autres)',
                coalesce(v_val #>> '{}', ''), v_key;
            end if;
          end loop;
          update public.profiles set classes = jsonb_strip_nulls(
              case when jsonb_typeof(classes) = 'object' then classes else '{}'::jsonb end || (v->'classes'))
           where user_id = v_uid;
        end if;

      /* ---------- budget : une ligne de budgets.lignes ---------- */
      when 'budget' then
        insert into public.budgets (user_id) values (v_uid) on conflict (user_id) do nothing;
        select b.lignes into v_lignes from public.budgets b where b.user_id = v_uid for update;
        if jsonb_typeof(v_lignes) is distinct from 'array' then v_lignes := '[]'::jsonb; end if;
        v_idx := null;
        if p.operation <> 'creer' then
          select (o.i - 1)::int into v_idx from jsonb_array_elements(v_lignes) with ordinality as o(e, i) where o.e->>'id' = p.ref limit 1;
          if v_idx is null then raise exception 'ligne de budget « % » introuvable', p.ref; end if;
        end if;
        if p.operation = 'supprimer' then
          v_lignes := v_lignes - v_idx;
        else
          v_ligne := jsonb_strip_nulls(case when p.operation = 'creer' then v else (v_lignes->v_idx) || v end);
          if p.operation = 'creer' then
            v_ligne := v_ligne || jsonb_build_object('id', coalesce(nullif(btrim(v_ligne->>'id'), ''), gen_random_uuid()::text));
            if exists (select 1 from jsonb_array_elements(v_lignes) e where e->>'id' = v_ligne->>'id') then
              raise exception 'une ligne de budget porte déjà l''identifiant « % »', v_ligne->>'id';
            end if;
          else
            v_ligne := v_ligne || jsonb_build_object('id', p.ref);
          end if;
          if coalesce(v_ligne->>'type', '') not in ('revenu', 'depense', 'epargne') then
            raise exception 'type « % » inconnu (revenu, depense ou epargne)', coalesce(v_ligne->>'type', '');
          end if;
          begin
            v_num := (v_ligne->>'montant')::numeric;
          exception when others then
            v_num := null;
          end;
          if v_num is null or v_num < 0 then raise exception 'montant invalide (nombre positif attendu)'; end if;
          v_ligne := jsonb_set(v_ligne, '{montant}', to_jsonb(v_num));
          v_ligne := v_ligne || jsonb_build_object('frequence', coalesce(v_ligne->>'frequence', 'mois'),
            'categorie', coalesce(v_ligne->>'categorie', ''), 'libelle', coalesce(v_ligne->>'libelle', ''));
          if v_ligne->>'frequence' not in ('mois', 'an') then
            raise exception 'fréquence « % » inconnue (mois ou an)', v_ligne->>'frequence';
          end if;
          if v_ligne ? 'owner' and v_ligne->>'owner' not in ('p1', 'p2', 'commun') then
            raise exception 'titulaire « % » inconnu (p1, p2 ou commun)', v_ligne->>'owner';
          end if;
          if p.operation = 'creer' then v_lignes := v_lignes || jsonb_build_array(v_ligne);
          else v_lignes := jsonb_set(v_lignes, array[v_idx::text], v_ligne);
          end if;
        end if;
        update public.budgets set lignes = v_lignes where user_id = v_uid;

      /* ---------- placements (et mouvement associé) ---------- */
      when 'position' then
        if p.operation = 'supprimer' then
          delete from public.positions where id = p.ref::uuid and user_id = v_uid;
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'ligne « % » introuvable', p.ref; end if;
        else
          v_isin := upper(replace(nullif(btrim(v->>'isin'), ''), ' ', ''));
          if v_isin is not null then
            perform public.request_instrument(v_isin, v->>'name', null);
          end if;
          if p.operation = 'creer' then
            insert into public.positions (user_id, name, envelope, owner, bloc, mode, isin, qty, pru, price_override, value, value_date,
                                          status, hypothesis, qty_estimated, note)
            values (v_uid, coalesce(nullif(btrim(v->>'name'), ''), 'Sans nom'), coalesce(v->>'envelope', ''), coalesce(v->>'owner', 'p1'),
                    coalesce(v->>'bloc', ''),
                    coalesce(v->>'mode', case when v_isin is not null and v->>'qty' is not null then 'market' else 'manual' end),
                    v_isin, (v->>'qty')::numeric, (v->>'pru')::numeric, (v->>'price_override')::numeric, (v->>'value')::numeric,
                    coalesce((v->>'value_date')::date, case when v->>'value' is not null then current_date end),
                    coalesce(v->>'status', 'actif'), v->>'hypothesis', coalesce((v->>'qty_estimated')::boolean, false), v->>'note')
            returning id into v_id;
          else
            v_id := p.ref::uuid;
            update public.positions set
              name           = case when v ? 'name' then coalesce(nullif(btrim(v->>'name'), ''), name) else name end,
              envelope       = case when v ? 'envelope' then coalesce(v->>'envelope', '') else envelope end,
              owner          = case when v ? 'owner' then v->>'owner' else owner end,
              bloc           = case when v ? 'bloc' then coalesce(v->>'bloc', '') else bloc end,
              mode           = case when v ? 'mode' then v->>'mode' else mode end,
              isin           = case when v ? 'isin' then v_isin else isin end,
              qty            = case when v ? 'qty' then (v->>'qty')::numeric else qty end,
              pru            = case when v ? 'pru' then (v->>'pru')::numeric else pru end,
              price_override = case when v ? 'price_override' then (v->>'price_override')::numeric else price_override end,
              value          = case when v ? 'value' then (v->>'value')::numeric else value end,
              value_date     = case when v ? 'value_date' then (v->>'value_date')::date when v ? 'value' then current_date else value_date end,
              status         = case when v ? 'status' then v->>'status' else status end,
              hypothesis     = case when v ? 'hypothesis' then v->>'hypothesis' else hypothesis end,
              qty_estimated  = case when v ? 'qty_estimated' then coalesce((v->>'qty_estimated')::boolean, false) else qty_estimated end,
              note           = case when v ? 'note' then v->>'note' else note end
            where id = v_id and user_id = v_uid;
            get diagnostics v_n = row_count;
            if v_n = 0 then raise exception 'ligne « % » introuvable', p.ref; end if;
          end if;
          if jsonb_typeof(v->'transaction') = 'object' then
            v_tx := v->'transaction';
            insert into public.transactions (user_id, position_id, date, type, qty, price, amount, note, source)
            values (v_uid, v_id, coalesce((v_tx->>'date')::date, current_date), coalesce(nullif(v_tx->>'type', ''), 'autre'),
                    (v_tx->>'qty')::numeric, (v_tx->>'price')::numeric, (v_tx->>'amount')::numeric, v_tx->>'note',
                    coalesce(nullif(v_tx->>'source', ''), 'mcp'));
          end if;
        end if;

      /* ---------- biens immobiliers ---------- */
      when 'bien' then
        if p.operation = 'supprimer' then
          delete from public.biens where id = p.ref::uuid and user_id = v_uid;
        elsif p.operation = 'creer' then
          insert into public.biens (user_id, nom, usage, valeur, part_p1, crd, mensualite, loyer)
          values (v_uid, coalesce(btrim(v->>'nom'), ''), coalesce(v->>'usage', 'rp'), coalesce((v->>'valeur')::numeric, 0),
                  coalesce((v->>'part_p1')::numeric, 100), coalesce((v->>'crd')::numeric, 0), coalesce((v->>'mensualite')::numeric, 0),
                  coalesce((v->>'loyer')::numeric, 0));
        else
          update public.biens set
            nom        = case when v ? 'nom' then coalesce(btrim(v->>'nom'), '') else nom end,
            usage      = case when v ? 'usage' then v->>'usage' else usage end,
            valeur     = case when v ? 'valeur' then coalesce((v->>'valeur')::numeric, 0) else valeur end,
            part_p1    = case when v ? 'part_p1' then coalesce((v->>'part_p1')::numeric, 100) else part_p1 end,
            crd        = case when v ? 'crd' then coalesce((v->>'crd')::numeric, 0) else crd end,
            mensualite = case when v ? 'mensualite' then coalesce((v->>'mensualite')::numeric, 0) else mensualite end,
            loyer      = case when v ? 'loyer' then coalesce((v->>'loyer')::numeric, 0) else loyer end
          where id = p.ref::uuid and user_id = v_uid;
        end if;
        if p.operation <> 'creer' then
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'bien « % » introuvable', p.ref; end if;
        end if;

      /* ---------- crédits ---------- */
      when 'credit' then
        if p.operation = 'supprimer' then
          delete from public.credits where id = p.ref::uuid and user_id = v_uid;
        elsif p.operation = 'creer' then
          insert into public.credits (user_id, nom, owner, crd, mensualite)
          values (v_uid, coalesce(btrim(v->>'nom'), ''), coalesce(v->>'owner', 'commun'), coalesce((v->>'crd')::numeric, 0),
                  coalesce((v->>'mensualite')::numeric, 0));
        else
          update public.credits set
            nom        = case when v ? 'nom' then coalesce(btrim(v->>'nom'), '') else nom end,
            owner      = case when v ? 'owner' then v->>'owner' else owner end,
            crd        = case when v ? 'crd' then coalesce((v->>'crd')::numeric, 0) else crd end,
            mensualite = case when v ? 'mensualite' then coalesce((v->>'mensualite')::numeric, 0) else mensualite end
          where id = p.ref::uuid and user_id = v_uid;
        end if;
        if p.operation <> 'creer' then
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'crédit « % » introuvable', p.ref; end if;
        end if;

      /* ---------- objectifs (date_cible, ou dateCible accepté) ---------- */
      when 'objectif' then
        if p.operation = 'supprimer' then
          delete from public.objectifs where id = p.ref::uuid and user_id = v_uid;
        elsif p.operation = 'creer' then
          insert into public.objectifs (user_id, nom, type, cible, date_cible, deja, source, poches, enveloppes, rendement, priorite)
          values (v_uid, coalesce(btrim(v->>'nom'), ''), coalesce(v->>'type', 'projet'), coalesce((v->>'cible')::numeric, 0),
                  coalesce(v->>'date_cible', v->>'dateCible')::date, coalesce((v->>'deja')::numeric, 0), coalesce(v->>'source', 'saisi'),
                  case when jsonb_typeof(v->'poches') = 'array' then array(select jsonb_array_elements_text(v->'poches')) else '{}'::text[] end,
                  case when jsonb_typeof(v->'enveloppes') = 'array' then array(select jsonb_array_elements_text(v->'enveloppes')) else '{}'::text[] end,
                  coalesce((v->>'rendement')::numeric, 2), coalesce((v->>'priorite')::int, 0));
        else
          update public.objectifs set
            nom        = case when v ? 'nom' then coalesce(btrim(v->>'nom'), '') else nom end,
            type       = case when v ? 'type' then v->>'type' else type end,
            cible      = case when v ? 'cible' then coalesce((v->>'cible')::numeric, 0) else cible end,
            date_cible = case when v ? 'date_cible' then (v->>'date_cible')::date when v ? 'dateCible' then (v->>'dateCible')::date else date_cible end,
            deja       = case when v ? 'deja' then coalesce((v->>'deja')::numeric, 0) else deja end,
            source     = case when v ? 'source' then v->>'source' else source end,
            poches     = case when v ? 'poches' then (case when jsonb_typeof(v->'poches') = 'array' then array(select jsonb_array_elements_text(v->'poches')) else '{}'::text[] end) else poches end,
            enveloppes = case when v ? 'enveloppes' then (case when jsonb_typeof(v->'enveloppes') = 'array' then array(select jsonb_array_elements_text(v->'enveloppes')) else '{}'::text[] end) else enveloppes end,
            rendement  = case when v ? 'rendement' then coalesce((v->>'rendement')::numeric, 2) else rendement end,
            priorite   = case when v ? 'priorite' then coalesce((v->>'priorite')::int, 0) else priorite end
          where id = p.ref::uuid and user_id = v_uid;
        end if;
        if p.operation <> 'creer' then
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'objectif « % » introuvable', p.ref; end if;
        end if;

      /* ---------- profil de risque : réponses fusionnées, date / profil / score conservés ---------- */
      when 'risque' then
        v_obj := case when jsonb_typeof(v->'reponses') = 'object' then v->'reponses' else v end;
        select k into v_key from jsonb_object_keys(v_obj) k
         where k not in ('horizon', 'objectif', 'reaction', 'perte_max', 'connaissances', 'experience', 'revenus', 'matelas', 'part_investie', 'age')
         limit 1;
        if v_key is not null then raise exception 'question « % » inconnue', v_key; end if;
        insert into public.profiles (user_id) values (v_uid) on conflict (user_id) do nothing;
        update public.profiles set risque = jsonb_set(
            case when jsonb_typeof(risque) = 'object' then risque else '{}'::jsonb end, '{reponses}',
            case when jsonb_typeof(risque->'reponses') = 'object' then risque->'reponses' else '{}'::jsonb end || v_obj, true)
         where user_id = v_uid;

      /* ---------- protection : fusion dans profiles.protection ---------- */
      when 'protection' then
        insert into public.profiles (user_id) values (v_uid) on conflict (user_id) do nothing;
        update public.profiles set protection = jsonb_strip_nulls(coalesce(protection, '{}'::jsonb) || v) where user_id = v_uid;

      /* ---------- réglages (0019) : matelas de précaution et versements programmés, rien d'autre ---------- */
      when 'config' then
        if p.operation <> 'modifier' then raise exception 'réglages : seule la modification est possible'; end if;
        select k into v_key from jsonb_object_keys(v) k
         where k not in ('cushion', 'recurring', 'frais_enveloppes', 'enveloppes_infos', 'prets_infos', 'donations', 'avis_impot', 'projection') limit 1;
        if v_key is not null then
          raise exception 'réglage « % » non modifiable par proposition (cushion, recurring, frais_enveloppes, enveloppes_infos, prets_infos, donations, avis_impot ou projection seulement)', v_key;
        end if;
        if not (v ? 'cushion' or v ? 'recurring' or v ? 'frais_enveloppes' or v ? 'enveloppes_infos' or v ? 'prets_infos' or v ? 'donations' or v ? 'avis_impot' or v ? 'projection') then
          raise exception 'réglages : cushion ou recurring attendu (ou frais_enveloppes, enveloppes_infos, prets_infos, donations, avis_impot ou projection)';
        end if;
        insert into public.config (user_id) values (v_uid) on conflict (user_id) do nothing;

        -- cushion : { mode: "amount", min ≥ 0, max ≥ min ou null } ou { mode: "months", months > 0, depenses > 0 } ; remplacé en entier.
        if v ? 'cushion' then
          v_obj := v->'cushion';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'cushion : objet attendu'; end if;
          if v_obj->>'mode' = 'months' then
            select k into v_key from jsonb_object_keys(v_obj) k where k not in ('mode', 'months', 'depenses') limit 1;
            if v_key is not null then raise exception 'cushion : champ « % » inconnu (mode, months, depenses)', v_key; end if;
            begin v_num := (v_obj->>'months')::numeric; exception when others then v_num := null; end;
            if v_num is null or v_num <= 0 or v_num > 120 then raise exception 'cushion.months invalide (nombre de mois entre 0 et 120 attendu)'; end if;
            begin v_num2 := (v_obj->>'depenses')::numeric; exception when others then v_num2 := null; end;
            if v_num2 is null or v_num2 <= 0 then raise exception 'cushion.depenses invalide (dépenses mensuelles positives attendues)'; end if;
            v_obj := jsonb_build_object('mode', 'months', 'months', v_num, 'depenses', v_num2);
          elsif v_obj->>'mode' = 'amount' then
            select k into v_key from jsonb_object_keys(v_obj) k where k not in ('mode', 'min', 'max') limit 1;
            if v_key is not null then raise exception 'cushion : champ « % » inconnu (mode, min, max)', v_key; end if;
            begin v_num := (v_obj->>'min')::numeric; exception when others then v_num := null; end;
            if v_num is null or v_num < 0 then raise exception 'cushion.min invalide (montant positif attendu)'; end if;
            v_num2 := null;
            if v_obj ? 'max' and jsonb_typeof(v_obj->'max') <> 'null' then
              begin v_num2 := (v_obj->>'max')::numeric; exception when others then v_num2 := null; end;
              if v_num2 is null or v_num2 < v_num then raise exception 'cushion.max invalide (montant au moins égal au minimum, ou null)'; end if;
            end if;
            v_obj := jsonb_build_object('mode', 'amount', 'min', v_num, 'max', v_num2);
          else
            raise exception 'cushion.mode « % » inconnu (amount ou months)', coalesce(v_obj->>'mode', '');
          end if;
          update public.config set cushion = v_obj where user_id = v_uid;
        end if;

        -- recurring : la liste fournie remplace la liste existante. Chaque versement { id, label, positionId, amount > 0,
        -- day 1-28, start?, … } (champs inconnus conservés) ; lastApplied est tenu par l'agent nocturne (apply_recurring) :
        -- repris de la base pour un id existant, retiré pour un nouveau versement (jamais celui de la proposition).
        if v ? 'recurring' then
          v_lignes := v->'recurring';
          if jsonb_typeof(v_lignes) is distinct from 'array' then raise exception 'recurring : liste de versements attendue'; end if;
          if jsonb_array_length(v_lignes) > 50 then raise exception 'recurring : 50 versements au plus'; end if;
          select k.recurring into v_rec from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_rec) is distinct from 'array' then v_rec := '[]'::jsonb; end if;
          v_cfg := '[]'::jsonb;
          v_ids := '{}'::text[];
          for v_ligne, v_idx in select o.e, o.i::int from jsonb_array_elements(v_lignes) with ordinality as o(e, i) loop
            if jsonb_typeof(v_ligne) <> 'object' then raise exception 'versement % : objet attendu', v_idx; end if;
            v_key := nullif(btrim(v_ligne->>'id'), '');
            if v_key is null or char_length(v_key) > 64 then raise exception 'versement % : identifiant (id) manquant ou trop long', v_idx; end if;
            if v_key = any(v_ids) then raise exception 'versement % : identifiant « % » en double', v_idx, v_key; end if;
            v_ids := v_ids || v_key;
            v_txt := nullif(btrim(v_ligne->>'label'), '');
            if v_txt is null or char_length(v_txt) > 80 then raise exception 'versement % : libellé (label) manquant ou trop long (80 caractères au plus)', v_idx; end if;
            if not exists (select 1 from public.positions x
                            where x.user_id = v_uid and x.id::text = (v_ligne->>'positionId') and x.status <> 'clôturé') then
              raise exception 'versement « % » : ligne « % » introuvable ou clôturée', v_txt, coalesce(v_ligne->>'positionId', '');
            end if;
            begin v_num := (v_ligne->>'amount')::numeric; exception when others then v_num := null; end;
            if v_num is null or v_num <= 0 then raise exception 'versement « % » : montant (amount) invalide (nombre strictement positif attendu)', v_txt; end if;
            begin v_num2 := (v_ligne->>'day')::numeric; exception when others then v_num2 := null; end;
            if v_num2 is null or v_num2 <> trunc(v_num2) or v_num2 < 1 or v_num2 > 28 then
              raise exception 'versement « % » : jour (day) invalide (entier de 1 à 28)', v_txt;
            end if;
            v_ligne := v_ligne || jsonb_build_object('id', v_key, 'label', v_txt, 'amount', v_num, 'day', v_num2::int);
            if jsonb_typeof(v_ligne->'start') is not null and jsonb_typeof(v_ligne->'start') <> 'null' then
              begin
                v_ligne := jsonb_set(v_ligne, '{start}', to_jsonb(to_char((v_ligne->>'start')::date, 'YYYY-MM-DD')));
              exception when others then
                raise exception 'versement « % » : date de début (start) invalide (AAAA-MM-JJ)', v_txt;
              end;
            end if;
            v_ligne := v_ligne - 'lastApplied';
            select e->'lastApplied' into v_val from jsonb_array_elements(v_rec) e
             where jsonb_typeof(e) = 'object' and e->>'id' = v_key and jsonb_typeof(e->'lastApplied') = 'string' limit 1;
            if v_val is not null then v_ligne := v_ligne || jsonb_build_object('lastApplied', v_val); end if;
            v_cfg := v_cfg || jsonb_build_array(v_ligne);
          end loop;
          update public.config set recurring = v_cfg where user_id = v_uid;
        end if;

        -- frais_enveloppes (0026) : { "<enveloppe>": { gestion_uc_pct?, gestion_euro_pct?, garde_pct?, source, le? } | null },
        -- fusionné par enveloppe dans config.frais_enveloppes (une enveloppe fournie remplace l'existante en entier, null la retire) ;
        -- pourcentages par an de 0 à 5 (au moins un), source obligatoire (1 à 300 caractères), le en AAAA-MM-JJ (date du jour par
        -- défaut) ; 30 enveloppes au plus, avant comme après la fusion.
        if v ? 'frais_enveloppes' then
          v_obj := v->'frais_enveloppes';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'frais_enveloppes : objet { enveloppe: frais } attendu'; end if;
          select count(*) into v_n from jsonb_object_keys(v_obj);
          if v_n > 30 then raise exception 'frais_enveloppes : 30 enveloppes au plus'; end if;
          select k.frais_enveloppes into v_fe from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_fe) is distinct from 'object' then v_fe := '{}'::jsonb; end if;
          for v_key, v_val in select e.key, e.value from jsonb_each(v_obj) e loop
            v_env := btrim(v_key);
            if v_env = '' or char_length(v_env) > 80 then raise exception 'frais_enveloppes : nom d''enveloppe invalide (1 à 80 caractères)'; end if;
            if jsonb_typeof(v_val) = 'null' then
              v_fe := v_fe - v_env;
              continue;
            end if;
            if jsonb_typeof(v_val) <> 'object' then raise exception 'frais_enveloppes « % » : objet ou null attendu', v_env; end if;
            select k into v_txt from jsonb_object_keys(v_val) k where k not in ('gestion_uc_pct', 'gestion_euro_pct', 'garde_pct', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'frais_enveloppes « % » : champ « % » inconnu (gestion_uc_pct, gestion_euro_pct, garde_pct, source, le)', v_env, v_txt;
            end if;
            v_ligne := '{}'::jsonb;
            foreach v_txt in array array['gestion_uc_pct', 'gestion_euro_pct', 'garde_pct'] loop
              continue when jsonb_typeof(v_val->v_txt) is null or jsonb_typeof(v_val->v_txt) = 'null';
              v_num := null;
              if jsonb_typeof(v_val->v_txt) in ('number', 'string') then
                begin v_num := (v_val->>v_txt)::numeric; exception when others then v_num := null; end;
              end if;
              if v_num is null or v_num < 0 or v_num > 5 then
                raise exception 'frais_enveloppes « % » : % invalide (pourcentage par an entre 0 et 5 attendu)', v_env, v_txt;
              end if;
              v_ligne := v_ligne || jsonb_build_object(v_txt, v_num);
            end loop;
            if v_ligne = '{}'::jsonb then
              raise exception 'frais_enveloppes « % » : au moins un pourcentage attendu (gestion_uc_pct, gestion_euro_pct ou garde_pct)', v_env;
            end if;
            v_txt := btrim(case when jsonb_typeof(v_val->'source') = 'string' then v_val->>'source' else '' end);
            if v_txt = '' or char_length(v_txt) > 300 then raise exception 'frais_enveloppes « % » : source obligatoire (1 à 300 caractères)', v_env; end if;
            v_le := (now() at time zone 'Europe/Paris')::date;
            if jsonb_typeof(v_val->'le') is not null and jsonb_typeof(v_val->'le') <> 'null' then
              begin
                if jsonb_typeof(v_val->'le') <> 'string' or (v_val->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_le := (v_val->>'le')::date;
              exception when others then
                raise exception 'frais_enveloppes « % » : date (le) invalide (AAAA-MM-JJ)', v_env;
              end;
              if v_le > (now() at time zone 'Europe/Paris')::date then
                raise exception 'frais_enveloppes « % » : date (le) dans le futur (la date du document consulté est attendue)', v_env;
              end if;
            end if;
            v_fe := jsonb_set(v_fe, array[v_env], v_ligne || jsonb_build_object('source', v_txt, 'le', to_char(v_le, 'YYYY-MM-DD')), true);
          end loop;
          select count(*) into v_n from jsonb_object_keys(v_fe);
          if v_n > 30 then raise exception 'frais_enveloppes : 30 enveloppes au plus (% après fusion)', v_n; end if;
          update public.config set frais_enveloppes = v_fe where user_id = v_uid;
        end if;

        -- enveloppes_infos (0029) : { "<enveloppe>" | "<enveloppe>|p1" | "<enveloppe>|p2": { type, titulaire, date_ouverture?,
        -- date_ouverture_approx?, date_cloture?, versements_cumules?, versements_avant_70?, beneficiaires_revus_le?, versements? (pee, percol),
        -- moins_values? (compte_titres), source, le? } | null }, fusionné par clé dans config.enveloppes_infos (une enveloppe fournie remplace
        -- l'existante en entier, null la retire). Le suffixe |p1 ou |p2 de la clé doit être celui du titulaire. Dates réelles, jamais dans le
        -- futur (date de Paris) et à partir de 1950 ; date_ouverture et date_ouverture_approx s'excluent ; montants positifs ou nuls ;
        -- source obligatoire (1 à 300 caractères) ; le en AAAA-MM-JJ (date du jour par défaut) ; 30 enveloppes au plus, avant comme après la fusion.
        if v ? 'enveloppes_infos' then
          v_obj := v->'enveloppes_infos';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'enveloppes_infos : objet { enveloppe: informations } attendu'; end if;
          select count(*) into v_n from jsonb_object_keys(v_obj);
          if v_n > 30 then raise exception 'enveloppes_infos : 30 enveloppes au plus'; end if;
          select k.enveloppes_infos into v_ei from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_ei) is distinct from 'object' then v_ei := '{}'::jsonb; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          for v_key, v_val in select e.key, e.value from jsonb_each(v_obj) e loop
            v_env := btrim(v_key);
            v_nom := regexp_replace(v_env, '\|p[12]$', '');
            if v_nom = '' or v_nom <> btrim(v_nom) or char_length(v_nom) > 80 then raise exception 'enveloppes_infos : nom d''enveloppe invalide (1 à 80 caractères)'; end if;
            if jsonb_typeof(v_val) = 'null' then
              v_ei := v_ei - v_env;
              continue;
            end if;
            if jsonb_typeof(v_val) <> 'object' then raise exception 'enveloppes_infos « % » : objet ou null attendu', v_env; end if;
            select k into v_txt from jsonb_object_keys(v_val) k where k not in ('type', 'titulaire', 'date_ouverture', 'date_ouverture_approx', 'date_cloture',
              'versements_cumules', 'versements_avant_70', 'beneficiaires_revus_le', 'versements', 'moins_values', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'enveloppes_infos « % » : champ « % » inconnu (type, titulaire, date_ouverture, date_ouverture_approx, date_cloture, versements_cumules, versements_avant_70, beneficiaires_revus_le, versements, moins_values, source, le)', v_env, v_txt;
            end if;
            if jsonb_typeof(v_val->'type') is distinct from 'string' or (v_val->>'type') not in ('pea', 'pea_pme', 'pea_jeune', 'assurance_vie',
                'capitalisation', 'per', 'pel', 'cel', 'pee', 'percol', 'compte_titres', 'livret_a', 'ldds', 'lep', 'autre') then
              raise exception 'enveloppes_infos « % » : type invalide (pea, pea_pme, pea_jeune, assurance_vie, capitalisation, per, pel, cel, pee, percol, compte_titres, livret_a, ldds, lep ou autre attendu)', v_env;
            end if;
            if jsonb_typeof(v_val->'titulaire') is distinct from 'string' or (v_val->>'titulaire') not in ('p1', 'p2') then
              raise exception 'enveloppes_infos « % » : titulaire invalide (p1 ou p2 attendu)', v_env;
            end if;
            v_sfx := substring(v_env from '\|(p[12])$');
            if v_sfx is not null and v_sfx <> (v_val->>'titulaire') then
              raise exception 'enveloppes_infos « % » : la clé se termine par |% mais le titulaire est %', v_env, v_sfx, v_val->>'titulaire';
            end if;
            v_ligne := jsonb_build_object('type', v_val->>'type', 'titulaire', v_val->>'titulaire');
            -- dates exactes
            foreach v_txt in array array['date_ouverture', 'date_cloture', 'beneficiaires_revus_le'] loop
              continue when jsonb_typeof(v_val->v_txt) is null or jsonb_typeof(v_val->v_txt) = 'null';
              begin
                if jsonb_typeof(v_val->v_txt) <> 'string' or (v_val->>v_txt) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_dt := (v_val->>v_txt)::date;
              exception when others then
                raise exception 'enveloppes_infos « % » : % invalide (AAAA-MM-JJ)', v_env, v_txt;
              end;
              if v_dt > v_auj then raise exception 'enveloppes_infos « % » : % dans le futur', v_env, v_txt; end if;
              if v_dt < date '1950-01-01' then raise exception 'enveloppes_infos « % » : % antérieure à 1950', v_env, v_txt; end if;
              v_ligne := v_ligne || jsonb_build_object(v_txt, to_char(v_dt, 'YYYY-MM-DD'));
            end loop;
            -- date d'ouverture approchée : AAAA ou AAAA-MM
            if jsonb_typeof(v_val->'date_ouverture_approx') is not null and jsonb_typeof(v_val->'date_ouverture_approx') <> 'null' then
              if v_ligne ? 'date_ouverture' then raise exception 'enveloppes_infos « % » : date_ouverture et date_ouverture_approx ne vont pas ensemble', v_env; end if;
              begin
                if jsonb_typeof(v_val->'date_ouverture_approx') <> 'string' or (v_val->>'date_ouverture_approx') !~ '^\d{4}(-\d{2})?$' then raise exception 'format'; end if;
                v_dt := (case when char_length(v_val->>'date_ouverture_approx') = 4 then (v_val->>'date_ouverture_approx') || '-01-01'
                              else (v_val->>'date_ouverture_approx') || '-01' end)::date;
              exception when others then
                raise exception 'enveloppes_infos « % » : date_ouverture_approx invalide (AAAA ou AAAA-MM)', v_env;
              end;
              if v_dt > v_auj then raise exception 'enveloppes_infos « % » : date_ouverture_approx dans le futur', v_env; end if;
              if v_dt < date '1950-01-01' then raise exception 'enveloppes_infos « % » : date_ouverture_approx antérieure à 1950', v_env; end if;
              v_ligne := v_ligne || jsonb_build_object('date_ouverture_approx', v_val->>'date_ouverture_approx');
            end if;
            if v_ligne ? 'date_cloture' and v_ligne ? 'date_ouverture' and (v_ligne->>'date_cloture')::date < (v_ligne->>'date_ouverture')::date then
              raise exception 'enveloppes_infos « % » : date_cloture avant date_ouverture', v_env;
            end if;
            -- montants
            foreach v_txt in array array['versements_cumules', 'versements_avant_70'] loop
              continue when jsonb_typeof(v_val->v_txt) is null or jsonb_typeof(v_val->v_txt) = 'null';
              v_num := null;
              if jsonb_typeof(v_val->v_txt) = 'number' or (jsonb_typeof(v_val->v_txt) = 'string' and (v_val->>v_txt) ~ '^\d+(\.\d+)?$') then
                v_num := (v_val->>v_txt)::numeric;
              end if;
              if v_num is null or v_num < 0 then raise exception 'enveloppes_infos « % » : % invalide (montant positif ou nul attendu)', v_env, v_txt; end if;
              v_ligne := v_ligne || jsonb_build_object(v_txt, v_num);
            end loop;
            if v_ligne ? 'versements_avant_70' and v_ligne ? 'versements_cumules'
               and (v_ligne->>'versements_avant_70')::numeric > (v_ligne->>'versements_cumules')::numeric then
              raise exception 'enveloppes_infos « % » : versements_avant_70 supérieur à versements_cumules', v_env;
            end if;
            -- versements d'épargne salariale (pee, percol) : [{ le, montant, origine, disponible_le? }], 120 au plus
            if jsonb_typeof(v_val->'versements') is not null and jsonb_typeof(v_val->'versements') <> 'null' then
              if (v_val->>'type') not in ('pee', 'percol') then raise exception 'enveloppes_infos « % » : versements réservés aux types pee et percol', v_env; end if;
              v_lignes := v_val->'versements';
              if jsonb_typeof(v_lignes) <> 'array' then raise exception 'enveloppes_infos « % » : versements : liste attendue', v_env; end if;
              if jsonb_array_length(v_lignes) > 120 then raise exception 'enveloppes_infos « % » : versements : 120 au plus', v_env; end if;
              v_cfg := '[]'::jsonb;
              for v_item, v_idx in select o.e, o.i::int from jsonb_array_elements(v_lignes) with ordinality as o(e, i) loop
                if jsonb_typeof(v_item) <> 'object' then raise exception 'enveloppes_infos « % » : versement % : objet attendu', v_env, v_idx; end if;
                select k into v_txt from jsonb_object_keys(v_item) k where k not in ('le', 'montant', 'origine', 'disponible_le') limit 1;
                if v_txt is not null then
                  raise exception 'enveloppes_infos « % » : versement % : champ « % » inconnu (le, montant, origine, disponible_le)', v_env, v_idx, v_txt;
                end if;
                begin
                  if jsonb_typeof(v_item->'le') is distinct from 'string' or (v_item->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                  v_dt := (v_item->>'le')::date;
                exception when others then
                  raise exception 'enveloppes_infos « % » : versement % : date (le) invalide (AAAA-MM-JJ)', v_env, v_idx;
                end;
                if v_dt > v_auj then raise exception 'enveloppes_infos « % » : versement % : date (le) dans le futur', v_env, v_idx; end if;
                if v_dt < date '1950-01-01' then raise exception 'enveloppes_infos « % » : versement % : date (le) antérieure à 1950', v_env, v_idx; end if;
                v_num := null;
                if jsonb_typeof(v_item->'montant') = 'number' or (jsonb_typeof(v_item->'montant') = 'string' and (v_item->>'montant') ~ '^\d+(\.\d+)?$') then
                  v_num := (v_item->>'montant')::numeric;
                end if;
                if v_num is null or v_num < 0 then raise exception 'enveloppes_infos « % » : versement % : montant invalide (montant positif ou nul attendu)', v_env, v_idx; end if;
                if jsonb_typeof(v_item->'origine') is distinct from 'string' or (v_item->>'origine') not in ('versement', 'abondement', 'participation', 'interessement') then
                  raise exception 'enveloppes_infos « % » : versement % : origine invalide (versement, abondement, participation ou interessement attendu)', v_env, v_idx;
                end if;
                v_row := jsonb_build_object('le', to_char(v_dt, 'YYYY-MM-DD'), 'montant', v_num, 'origine', v_item->>'origine');
                if jsonb_typeof(v_item->'disponible_le') is not null and jsonb_typeof(v_item->'disponible_le') <> 'null' then
                  begin
                    if jsonb_typeof(v_item->'disponible_le') <> 'string' or (v_item->>'disponible_le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                    v_dt2 := (v_item->>'disponible_le')::date;
                  exception when others then
                    raise exception 'enveloppes_infos « % » : versement % : disponible_le invalide (AAAA-MM-JJ)', v_env, v_idx;
                  end;
                  if v_dt2 < v_dt then raise exception 'enveloppes_infos « % » : versement % : disponible_le avant la date du versement', v_env, v_idx; end if;
                  v_row := v_row || jsonb_build_object('disponible_le', to_char(v_dt2, 'YYYY-MM-DD'));
                end if;
                v_cfg := v_cfg || jsonb_build_array(v_row);
              end loop;
              if jsonb_array_length(v_cfg) > 0 then v_ligne := v_ligne || jsonb_build_object('versements', v_cfg); end if;
            end if;
            -- moins-values reportables (compte_titres) : [{ annee de 2000 à l'année en cours, montant > 0 }], 15 au plus
            if jsonb_typeof(v_val->'moins_values') is not null and jsonb_typeof(v_val->'moins_values') <> 'null' then
              if (v_val->>'type') <> 'compte_titres' then raise exception 'enveloppes_infos « % » : moins_values réservées au type compte_titres', v_env; end if;
              v_lignes := v_val->'moins_values';
              if jsonb_typeof(v_lignes) <> 'array' then raise exception 'enveloppes_infos « % » : moins_values : liste attendue', v_env; end if;
              if jsonb_array_length(v_lignes) > 15 then raise exception 'enveloppes_infos « % » : moins_values : 15 au plus', v_env; end if;
              v_cfg := '[]'::jsonb;
              for v_item, v_idx in select o.e, o.i::int from jsonb_array_elements(v_lignes) with ordinality as o(e, i) loop
                if jsonb_typeof(v_item) <> 'object' then raise exception 'enveloppes_infos « % » : moins-value % : objet attendu', v_env, v_idx; end if;
                select k into v_txt from jsonb_object_keys(v_item) k where k not in ('annee', 'montant') limit 1;
                if v_txt is not null then
                  raise exception 'enveloppes_infos « % » : moins-value % : champ « % » inconnu (annee, montant)', v_env, v_idx, v_txt;
                end if;
                v_num2 := null;
                if jsonb_typeof(v_item->'annee') = 'number' or (jsonb_typeof(v_item->'annee') = 'string' and (v_item->>'annee') ~ '^\d{4}$') then
                  v_num2 := (v_item->>'annee')::numeric;
                end if;
                if v_num2 is null or v_num2 <> trunc(v_num2) or v_num2 < 2000 or v_num2 > extract(year from v_auj) then
                  raise exception 'enveloppes_infos « % » : moins-value % : annee invalide (entier de 2000 à l''année en cours attendu)', v_env, v_idx;
                end if;
                v_num := null;
                if jsonb_typeof(v_item->'montant') = 'number' or (jsonb_typeof(v_item->'montant') = 'string' and (v_item->>'montant') ~ '^\d+(\.\d+)?$') then
                  v_num := (v_item->>'montant')::numeric;
                end if;
                if v_num is null or v_num <= 0 then raise exception 'enveloppes_infos « % » : moins-value % : montant invalide (montant strictement positif attendu)', v_env, v_idx; end if;
                v_cfg := v_cfg || jsonb_build_array(jsonb_build_object('annee', v_num2::int, 'montant', v_num));
              end loop;
              if jsonb_array_length(v_cfg) > 0 then v_ligne := v_ligne || jsonb_build_object('moins_values', v_cfg); end if;
            end if;
            v_txt := btrim(case when jsonb_typeof(v_val->'source') = 'string' then v_val->>'source' else '' end);
            if v_txt = '' or char_length(v_txt) > 300 then raise exception 'enveloppes_infos « % » : source obligatoire (1 à 300 caractères)', v_env; end if;
            v_le := v_auj;
            if jsonb_typeof(v_val->'le') is not null and jsonb_typeof(v_val->'le') <> 'null' then
              begin
                if jsonb_typeof(v_val->'le') <> 'string' or (v_val->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_le := (v_val->>'le')::date;
              exception when others then
                raise exception 'enveloppes_infos « % » : date (le) invalide (AAAA-MM-JJ)', v_env;
              end;
              if v_le > v_auj then
                raise exception 'enveloppes_infos « % » : date (le) dans le futur (la date du document consulté est attendue)', v_env;
              end if;
            end if;
            v_ei := jsonb_set(v_ei, array[v_env], v_ligne || jsonb_build_object('source', v_txt, 'le', to_char(v_le, 'YYYY-MM-DD')), true);
          end loop;
          select count(*) into v_n from jsonb_object_keys(v_ei);
          if v_n > 30 then raise exception 'enveloppes_infos : 30 enveloppes au plus (% après fusion)', v_n; end if;
          update public.config set enveloppes_infos = v_ei where user_id = v_uid;
        end if;

        -- prets_infos (0029) : { "credit:<identifiant>" | "bien:<identifiant>": { date_signature?, date_fin?, duree_mois?, taux_pct?,
        -- assurance_taux_pct?, ira_exoneration?, source, le? } | null }, fusionné par clé dans config.prets_infos (un prêt fourni remplace
        -- l'existant en entier, null le retire, y compris quand la ligne n'existe plus). La clé désigne un crédit ou un bien de
        -- l'utilisateur : celle d'un autre utilisateur est refusée comme une ligne inexistante (même message). date_fin après
        -- date_signature, duree_mois de 1 à 480, taux_pct de 0 à 20, assurance_taux_pct de 0 à 5 ; au moins un champ hors source et le ;
        -- 50 prêts au plus, avant comme après la fusion.
        if v ? 'prets_infos' then
          v_obj := v->'prets_infos';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'prets_infos : objet { prêt: informations } attendu'; end if;
          select count(*) into v_n from jsonb_object_keys(v_obj);
          if v_n > 50 then raise exception 'prets_infos : 50 prêts au plus'; end if;
          select k.prets_infos into v_pi from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_pi) is distinct from 'object' then v_pi := '{}'::jsonb; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          for v_key, v_val in select e.key, e.value from jsonb_each(v_obj) e loop
            v_env := lower(btrim(v_key));
            if v_env !~ '^(credit|bien):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
              raise exception 'prets_infos : clé « % » invalide (credit:<identifiant> ou bien:<identifiant> attendu)', v_key;
            end if;
            if jsonb_typeof(v_val) = 'null' then
              v_pi := v_pi - v_env;
              continue;
            end if;
            if jsonb_typeof(v_val) <> 'object' then raise exception 'prets_infos « % » : objet ou null attendu', v_env; end if;
            v_id := substring(v_env from ':(.*)$')::uuid;
            if v_env like 'credit:%' then
              if not exists (select 1 from public.credits c where c.id = v_id and c.user_id = v_uid) then raise exception 'prets_infos « % » : crédit introuvable', v_env; end if;
            else
              if not exists (select 1 from public.biens b where b.id = v_id and b.user_id = v_uid) then raise exception 'prets_infos « % » : bien introuvable', v_env; end if;
            end if;
            select k into v_txt from jsonb_object_keys(v_val) k where k not in ('date_signature', 'date_fin', 'duree_mois', 'taux_pct',
              'assurance_taux_pct', 'ira_exoneration', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'prets_infos « % » : champ « % » inconnu (date_signature, date_fin, duree_mois, taux_pct, assurance_taux_pct, ira_exoneration, source, le)', v_env, v_txt;
            end if;
            v_ligne := '{}'::jsonb;
            foreach v_txt in array array['date_signature', 'date_fin'] loop
              continue when jsonb_typeof(v_val->v_txt) is null or jsonb_typeof(v_val->v_txt) = 'null';
              begin
                if jsonb_typeof(v_val->v_txt) <> 'string' or (v_val->>v_txt) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_dt := (v_val->>v_txt)::date;
              exception when others then
                raise exception 'prets_infos « % » : % invalide (AAAA-MM-JJ)', v_env, v_txt;
              end;
              if v_txt = 'date_signature' and v_dt > v_auj then raise exception 'prets_infos « % » : date_signature dans le futur', v_env; end if;
              if v_dt < date '1950-01-01' then raise exception 'prets_infos « % » : % antérieure à 1950', v_env, v_txt; end if;
              v_ligne := v_ligne || jsonb_build_object(v_txt, to_char(v_dt, 'YYYY-MM-DD'));
            end loop;
            if v_ligne ? 'date_signature' and v_ligne ? 'date_fin' and (v_ligne->>'date_fin')::date <= (v_ligne->>'date_signature')::date then
              raise exception 'prets_infos « % » : date_fin à placer après date_signature', v_env;
            end if;
            foreach v_txt in array array['duree_mois', 'taux_pct', 'assurance_taux_pct'] loop
              continue when jsonb_typeof(v_val->v_txt) is null or jsonb_typeof(v_val->v_txt) = 'null';
              v_num := null;
              if jsonb_typeof(v_val->v_txt) = 'number' or (jsonb_typeof(v_val->v_txt) = 'string' and (v_val->>v_txt) ~ '^\d+(\.\d+)?$') then
                v_num := (v_val->>v_txt)::numeric;
              end if;
              if v_txt = 'duree_mois' and (v_num is null or v_num <> trunc(v_num) or v_num < 1 or v_num > 480) then
                raise exception 'prets_infos « % » : duree_mois invalide (entier de 1 à 480 attendu)', v_env;
              elsif v_txt = 'taux_pct' and (v_num is null or v_num < 0 or v_num > 20) then
                raise exception 'prets_infos « % » : taux_pct invalide (pourcentage par an entre 0 et 20 attendu)', v_env;
              elsif v_txt = 'assurance_taux_pct' and (v_num is null or v_num < 0 or v_num > 5) then
                raise exception 'prets_infos « % » : assurance_taux_pct invalide (pourcentage par an entre 0 et 5 attendu)', v_env;
              end if;
              v_ligne := v_ligne || jsonb_build_object(v_txt, v_num);
            end loop;
            if jsonb_typeof(v_val->'ira_exoneration') is not null and jsonb_typeof(v_val->'ira_exoneration') <> 'null' then
              if jsonb_typeof(v_val->'ira_exoneration') <> 'boolean' then raise exception 'prets_infos « % » : ira_exoneration invalide (true ou false attendu)', v_env; end if;
              v_ligne := v_ligne || jsonb_build_object('ira_exoneration', (v_val->>'ira_exoneration')::boolean);
            end if;
            if v_ligne = '{}'::jsonb then
              raise exception 'prets_infos « % » : au moins une information attendue (date_signature, date_fin, duree_mois, taux_pct, assurance_taux_pct ou ira_exoneration)', v_env;
            end if;
            v_txt := btrim(case when jsonb_typeof(v_val->'source') = 'string' then v_val->>'source' else '' end);
            if v_txt = '' or char_length(v_txt) > 300 then raise exception 'prets_infos « % » : source obligatoire (1 à 300 caractères)', v_env; end if;
            v_le := v_auj;
            if jsonb_typeof(v_val->'le') is not null and jsonb_typeof(v_val->'le') <> 'null' then
              begin
                if jsonb_typeof(v_val->'le') <> 'string' or (v_val->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_le := (v_val->>'le')::date;
              exception when others then
                raise exception 'prets_infos « % » : date (le) invalide (AAAA-MM-JJ)', v_env;
              end;
              if v_le > v_auj then
                raise exception 'prets_infos « % » : date (le) dans le futur (la date du document consulté est attendue)', v_env;
              end if;
            end if;
            v_pi := jsonb_set(v_pi, array[v_env], v_ligne || jsonb_build_object('source', v_txt, 'le', to_char(v_le, 'YYYY-MM-DD')), true);
          end loop;
          select count(*) into v_n from jsonb_object_keys(v_pi);
          if v_n > 50 then raise exception 'prets_infos : 50 prêts au plus (% après fusion)', v_n; end if;
          update public.config set prets_infos = v_pi where user_id = v_uid;
        end if;

        -- donations (0029) : la liste fournie remplace la liste existante (modèle de recurring). Chaque donation { id, date, montant > 0,
        -- donateur p1|p2, lien enfant|petit_enfant|arriere_petit_enfant|autre, beneficiaire, nature donation|don_argent_790g|don_logement_790a_bis,
        -- source, le? } ; id uniques (1 à 64 caractères), date jamais dans le futur, beneficiaire de 1 à 40 caractères (libellé au choix de
        -- l'utilisateur), source obligatoire (1 à 300 caractères) ; 100 donations au plus.
        if v ? 'donations' then
          v_lignes := v->'donations';
          if jsonb_typeof(v_lignes) is distinct from 'array' then raise exception 'donations : liste de donations attendue'; end if;
          if jsonb_array_length(v_lignes) > 100 then raise exception 'donations : 100 donations au plus'; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          v_don := '[]'::jsonb;
          v_ids := '{}'::text[];
          for v_item, v_idx in select o.e, o.i::int from jsonb_array_elements(v_lignes) with ordinality as o(e, i) loop
            if jsonb_typeof(v_item) <> 'object' then raise exception 'donation % : objet attendu', v_idx; end if;
            v_key := nullif(btrim(case when jsonb_typeof(v_item->'id') = 'string' then v_item->>'id' else '' end), '');
            if v_key is null or char_length(v_key) > 64 then raise exception 'donation % : identifiant (id) manquant ou trop long (1 à 64 caractères)', v_idx; end if;
            if v_key = any(v_ids) then raise exception 'donation % : identifiant « % » en double', v_idx, v_key; end if;
            v_ids := v_ids || v_key;
            select k into v_txt from jsonb_object_keys(v_item) k where k not in ('id', 'date', 'montant', 'donateur', 'lien', 'beneficiaire', 'nature', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'donations « % » : champ « % » inconnu (id, date, montant, donateur, lien, beneficiaire, nature, source, le)', v_key, v_txt;
            end if;
            begin
              if jsonb_typeof(v_item->'date') is distinct from 'string' or (v_item->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
              v_dt := (v_item->>'date')::date;
            exception when others then
              raise exception 'donations « % » : date invalide (AAAA-MM-JJ)', v_key;
            end;
            if v_dt > v_auj then raise exception 'donations « % » : date dans le futur', v_key; end if;
            v_num := null;
            if jsonb_typeof(v_item->'montant') = 'number' or (jsonb_typeof(v_item->'montant') = 'string' and (v_item->>'montant') ~ '^\d+(\.\d+)?$') then
              v_num := (v_item->>'montant')::numeric;
            end if;
            if v_num is null or v_num <= 0 then raise exception 'donations « % » : montant invalide (montant strictement positif attendu)', v_key; end if;
            if jsonb_typeof(v_item->'donateur') is distinct from 'string' or (v_item->>'donateur') not in ('p1', 'p2') then
              raise exception 'donations « % » : donateur invalide (p1 ou p2 attendu)', v_key;
            end if;
            if jsonb_typeof(v_item->'lien') is distinct from 'string' or (v_item->>'lien') not in ('enfant', 'petit_enfant', 'arriere_petit_enfant', 'autre') then
              raise exception 'donations « % » : lien invalide (enfant, petit_enfant, arriere_petit_enfant ou autre attendu)', v_key;
            end if;
            v_txt := btrim(case when jsonb_typeof(v_item->'beneficiaire') = 'string' then v_item->>'beneficiaire' else '' end);
            if v_txt = '' or char_length(v_txt) > 40 then raise exception 'donations « % » : bénéficiaire (beneficiaire) obligatoire (1 à 40 caractères)', v_key; end if;
            v_row := jsonb_build_object('id', v_key, 'date', to_char(v_dt, 'YYYY-MM-DD'), 'montant', v_num, 'donateur', v_item->>'donateur',
                                        'lien', v_item->>'lien', 'beneficiaire', v_txt);
            if jsonb_typeof(v_item->'nature') is distinct from 'string' or (v_item->>'nature') not in ('donation', 'don_argent_790g', 'don_logement_790a_bis') then
              raise exception 'donations « % » : nature invalide (donation, don_argent_790g ou don_logement_790a_bis attendu)', v_key;
            end if;
            v_row := v_row || jsonb_build_object('nature', v_item->>'nature');
            v_txt := btrim(case when jsonb_typeof(v_item->'source') = 'string' then v_item->>'source' else '' end);
            if v_txt = '' or char_length(v_txt) > 300 then raise exception 'donations « % » : source obligatoire (1 à 300 caractères)', v_key; end if;
            v_le := v_auj;
            if jsonb_typeof(v_item->'le') is not null and jsonb_typeof(v_item->'le') <> 'null' then
              begin
                if jsonb_typeof(v_item->'le') <> 'string' or (v_item->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_le := (v_item->>'le')::date;
              exception when others then
                raise exception 'donations « % » : date (le) invalide (AAAA-MM-JJ)', v_key;
              end;
              if v_le > v_auj then
                raise exception 'donations « % » : date (le) dans le futur (la date du document consulté est attendue)', v_key;
              end if;
            end if;
            v_don := v_don || jsonb_build_array(v_row || jsonb_build_object('source', v_txt, 'le', to_char(v_le, 'YYYY-MM-DD')));
          end loop;
          update public.config set donations = v_don where user_id = v_uid;
        end if;

        -- avis_impot (0029) : { annee_revenus, rfr?, plafonds_per?: { p1?: [{ annee, montant }], p2?: [...] }, source, le? }, remplacé en
        -- entier (un avis remplace le précédent ; l'objet vide l'efface). annee_revenus de 2000 à l'année en cours, rfr positif ou nul,
        -- plafonds : annee (année du plafond, de 2000 à l'année en cours + 1, une fois par personne) et montant > 0, 6 lignes au plus par personne ;
        -- source obligatoire (1 à 300 caractères), le en AAAA-MM-JJ (date du jour par défaut).
        if v ? 'avis_impot' then
          v_obj := v->'avis_impot';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'avis_impot : objet attendu'; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          v_an := extract(year from v_auj)::int;
          if v_obj = '{}'::jsonb then
            v_avis := '{}'::jsonb;
          else
            select k into v_txt from jsonb_object_keys(v_obj) k where k not in ('annee_revenus', 'rfr', 'plafonds_per', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'avis_impot : champ « % » inconnu (annee_revenus, rfr, plafonds_per, source, le)', v_txt;
            end if;
            v_num := null;
            if jsonb_typeof(v_obj->'annee_revenus') = 'number' or (jsonb_typeof(v_obj->'annee_revenus') = 'string' and (v_obj->>'annee_revenus') ~ '^\d{4}$') then
              v_num := (v_obj->>'annee_revenus')::numeric;
            end if;
            if v_num is null or v_num <> trunc(v_num) or v_num < 2000 or v_num > v_an then
              raise exception 'avis_impot : annee_revenus invalide (entier de 2000 à l''année en cours attendu)';
            end if;
            v_avis := jsonb_build_object('annee_revenus', v_num::int);
            if jsonb_typeof(v_obj->'rfr') is not null and jsonb_typeof(v_obj->'rfr') <> 'null' then
              v_num := null;
              if jsonb_typeof(v_obj->'rfr') = 'number' or (jsonb_typeof(v_obj->'rfr') = 'string' and (v_obj->>'rfr') ~ '^\d+(\.\d+)?$') then
                v_num := (v_obj->>'rfr')::numeric;
              end if;
              if v_num is null or v_num < 0 then raise exception 'avis_impot : rfr invalide (montant positif ou nul attendu)'; end if;
              v_avis := v_avis || jsonb_build_object('rfr', v_num);
            end if;
            if jsonb_typeof(v_obj->'plafonds_per') is not null and jsonb_typeof(v_obj->'plafonds_per') <> 'null' then
              if jsonb_typeof(v_obj->'plafonds_per') <> 'object' then raise exception 'avis_impot : plafonds_per : objet { p1, p2 } attendu'; end if;
              select k into v_txt from jsonb_object_keys(v_obj->'plafonds_per') k where k not in ('p1', 'p2') limit 1;
              if v_txt is not null then raise exception 'avis_impot : plafonds_per : personne « % » inconnue (p1 ou p2)', v_txt; end if;
              v_row := '{}'::jsonb;
              foreach v_pers in array array['p1', 'p2'] loop
                continue when jsonb_typeof(v_obj->'plafonds_per'->v_pers) is null or jsonb_typeof(v_obj->'plafonds_per'->v_pers) = 'null';
                v_lignes := v_obj->'plafonds_per'->v_pers;
                if jsonb_typeof(v_lignes) <> 'array' then raise exception 'avis_impot : plafonds_per.% : liste attendue', v_pers; end if;
                if jsonb_array_length(v_lignes) > 6 then raise exception 'avis_impot : plafonds_per.% : 6 lignes au plus', v_pers; end if;
                v_cfg := '[]'::jsonb;
                v_ids := '{}'::text[];
                for v_item, v_idx in select o.e, o.i::int from jsonb_array_elements(v_lignes) with ordinality as o(e, i) loop
                  if jsonb_typeof(v_item) <> 'object' then raise exception 'avis_impot : plafonds_per.% : ligne % : objet attendu', v_pers, v_idx; end if;
                  select k into v_txt from jsonb_object_keys(v_item) k where k not in ('annee', 'montant') limit 1;
                  if v_txt is not null then
                    raise exception 'avis_impot : plafonds_per.% : ligne % : champ « % » inconnu (annee, montant)', v_pers, v_idx, v_txt;
                  end if;
                  v_num2 := null;
                  if jsonb_typeof(v_item->'annee') = 'number' or (jsonb_typeof(v_item->'annee') = 'string' and (v_item->>'annee') ~ '^\d{4}$') then
                    v_num2 := (v_item->>'annee')::numeric;
                  end if;
                  if v_num2 is null or v_num2 <> trunc(v_num2) or v_num2 < 2000 or v_num2 > v_an + 1 then
                    raise exception 'avis_impot : plafonds_per.% : ligne % : annee invalide (entier de 2000 à l''année en cours + 1 attendu)', v_pers, v_idx;
                  end if;
                  if (v_num2::int)::text = any(v_ids) then raise exception 'avis_impot : plafonds_per.% : annee % en double', v_pers, v_num2::int; end if;
                  v_ids := v_ids || (v_num2::int)::text;
                  v_num := null;
                  if jsonb_typeof(v_item->'montant') = 'number' or (jsonb_typeof(v_item->'montant') = 'string' and (v_item->>'montant') ~ '^\d+(\.\d+)?$') then
                    v_num := (v_item->>'montant')::numeric;
                  end if;
                  if v_num is null or v_num <= 0 then
                    raise exception 'avis_impot : plafonds_per.% : ligne % : montant invalide (montant strictement positif attendu)', v_pers, v_idx;
                  end if;
                  v_cfg := v_cfg || jsonb_build_array(jsonb_build_object('annee', v_num2::int, 'montant', v_num));
                end loop;
                if jsonb_array_length(v_cfg) > 0 then v_row := v_row || jsonb_build_object(v_pers, v_cfg); end if;
              end loop;
              if v_row <> '{}'::jsonb then v_avis := v_avis || jsonb_build_object('plafonds_per', v_row); end if;
            end if;
            v_txt := btrim(case when jsonb_typeof(v_obj->'source') = 'string' then v_obj->>'source' else '' end);
            if v_txt = '' or char_length(v_txt) > 300 then raise exception 'avis_impot : source obligatoire (1 à 300 caractères)'; end if;
            v_le := v_auj;
            if jsonb_typeof(v_obj->'le') is not null and jsonb_typeof(v_obj->'le') <> 'null' then
              begin
                if jsonb_typeof(v_obj->'le') <> 'string' or (v_obj->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_le := (v_obj->>'le')::date;
              exception when others then
                raise exception 'avis_impot : date (le) invalide (AAAA-MM-JJ)';
              end;
              if v_le > v_auj then
                raise exception 'avis_impot : date (le) dans le futur (la date du document consulté est attendue)';
              end if;
            end if;
            v_avis := v_avis || jsonb_build_object('source', v_txt, 'le', to_char(v_le, 'YYYY-MM-DD'));
          end if;
          update public.config set avis_impot = v_avis where user_id = v_uid;
        end if;

        -- projection (0030) : { base_capacite?: reel|prevu|montant, capacite_mensuelle? (−100 000 à 100 000), reste_capacite?: cible|disponible,
        -- reequilibrage?: aucun|annuel, part_reaffectee_epargne_pct?, part_hausse_epargnee_pct? et assurance_pct? (0 à 100),
        -- salaire_croissance_reelle_pct? (−10 à 10), tmi_pct? (0, 11, 30, 41 ou 45), per_versements_deduits? (booléen),
        -- biens?: { "bien:<uuid>": { prix_achat > 0, date_achat (1900 à aujourd'hui), source, le? } | null } (biens de l'utilisateur, 50 au plus),
        -- source? (1 à 300 caractères), le? (AAAA-MM-JJ, jamais dans le futur) }, fusionné champ par champ dans config.projection ;
        -- null retire un champ ; un bien fourni remplace l'entrée existante en entier ; la date du jour est mise dans « le » quand la source
        -- est fournie sans date. Les champs inconnus sont refusés.
        if v ? 'projection' then
          v_obj := v->'projection';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'projection : objet attendu'; end if;
          if v_obj = '{}'::jsonb then raise exception 'projection : au moins un réglage attendu'; end if;
          select k.projection into v_proj from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_proj) is distinct from 'object' then v_proj := '{}'::jsonb; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          for v_key, v_val in select e.key, e.value from jsonb_each(v_obj) e loop
            if v_key <> all (array['base_capacite', 'capacite_mensuelle', 'reste_capacite', 'reequilibrage', 'part_reaffectee_epargne_pct',
                'part_hausse_epargnee_pct', 'salaire_croissance_reelle_pct', 'tmi_pct', 'per_versements_deduits', 'assurance_pct', 'biens', 'source', 'le']) then
              raise exception 'projection : champ « % » inconnu (base_capacite, capacite_mensuelle, reste_capacite, reequilibrage, part_reaffectee_epargne_pct, part_hausse_epargnee_pct, salaire_croissance_reelle_pct, tmi_pct, per_versements_deduits, assurance_pct, biens, source, le)', v_key;
            end if;
            if jsonb_typeof(v_val) = 'null' then
              v_proj := v_proj - v_key;
              continue;
            end if;
            if v_key = 'base_capacite' then
              if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('reel', 'prevu', 'montant') then
                raise exception 'projection : base_capacite invalide (reel, prevu ou montant attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_val);
            elsif v_key = 'reste_capacite' then
              if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('cible', 'disponible') then
                raise exception 'projection : reste_capacite invalide (cible ou disponible attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_val);
            elsif v_key = 'reequilibrage' then
              if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('aucun', 'annuel') then
                raise exception 'projection : reequilibrage invalide (aucun ou annuel attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_val);
            elsif v_key = 'capacite_mensuelle' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < -100000 or v_num > 100000 then
                raise exception 'projection : capacite_mensuelle invalide (montant de −100 000 à 100 000 € attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_num);
            elsif v_key in ('part_reaffectee_epargne_pct', 'part_hausse_epargnee_pct', 'assurance_pct') then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < 0 or v_num > 100 then
                raise exception 'projection : % invalide (pourcentage de 0 à 100 attendu)', v_key;
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_num);
            elsif v_key = 'salaire_croissance_reelle_pct' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < -10 or v_num > 10 then
                raise exception 'projection : salaire_croissance_reelle_pct invalide (de −10 à 10 %% par an attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_num);
            elsif v_key = 'tmi_pct' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num not in (0, 11, 30, 41, 45) then
                raise exception 'projection : tmi_pct invalide (0, 11, 30, 41 ou 45 attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_num);
            elsif v_key = 'per_versements_deduits' then
              if jsonb_typeof(v_val) <> 'boolean' then raise exception 'projection : per_versements_deduits invalide (vrai ou faux attendu)'; end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_val);
            elsif v_key = 'source' then
              v_txt := case when jsonb_typeof(v_val) = 'string' then public.foyer_rogner(v_val #>> '{}') else '' end;
              if v_txt = '' or char_length(v_txt) > 300 then raise exception 'projection : source invalide (1 à 300 caractères attendus)'; end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_txt);
            elsif v_key = 'le' then
              v_dt := public.foyer_date(v_val);
              if v_dt is null then raise exception 'projection : date (le) invalide (AAAA-MM-JJ)'; end if;
              if v_dt > v_auj then raise exception 'projection : date (le) dans le futur (la date du document consulté est attendue)'; end if;
              v_proj := v_proj || jsonb_build_object(v_key, to_char(v_dt, 'YYYY-MM-DD'));
            else
              -- biens
              if jsonb_typeof(v_val) <> 'object' then raise exception 'projection.biens : objet { bien:<identifiant>: informations } attendu'; end if;
              select count(*) into v_n from jsonb_object_keys(v_val);
              if v_n > 50 then raise exception 'projection.biens : 50 biens au plus'; end if;
              v_row := case when jsonb_typeof(v_proj->'biens') = 'object' then v_proj->'biens' else '{}'::jsonb end;
              for v_txt, v_item in select e.key, e.value from jsonb_each(v_val) e loop
                if v_txt !~ '^bien:.+$' then raise exception 'projection.biens : clé « % » invalide (bien:<identifiant> attendu)', v_txt; end if;
                if jsonb_typeof(v_item) = 'null' then
                  v_row := v_row - v_txt;
                  continue;
                end if;
                if not exists (select 1 from public.biens b where b.user_id = v_uid and 'bien:' || b.id::text = v_txt) then
                  raise exception 'projection.biens : bien « % » introuvable', v_txt;
                end if;
                if jsonb_typeof(v_item) <> 'object' then raise exception 'projection.biens « % » : objet ou null attendu', v_txt; end if;
                select k into v_nom from jsonb_object_keys(v_item) k where k not in ('prix_achat', 'date_achat', 'source', 'le') limit 1;
                if v_nom is not null then
                  raise exception 'projection.biens « % » : champ « % » inconnu (prix_achat, date_achat, source, le)', v_txt, v_nom;
                end if;
                v_num := public.foyer_nombre(v_item->'prix_achat');
                if v_num is null or v_num <= 0 then
                  raise exception 'projection.biens « % » : prix_achat invalide (montant strictement positif attendu)', v_txt;
                end if;
                v_dt := public.foyer_date(v_item->'date_achat');
                if v_dt is null then raise exception 'projection.biens « % » : date_achat invalide (AAAA-MM-JJ)', v_txt; end if;
                if v_dt < date '1900-01-01' then raise exception 'projection.biens « % » : date_achat antérieure à 1900', v_txt; end if;
                if v_dt > v_auj then raise exception 'projection.biens « % » : date_achat dans le futur', v_txt; end if;
                v_nom := case when jsonb_typeof(v_item->'source') = 'string' then public.foyer_rogner(v_item->>'source') else '' end;
                if v_nom = '' or char_length(v_nom) > 300 then raise exception 'projection.biens « % » : source obligatoire (1 à 300 caractères)', v_txt; end if;
                v_le := v_auj;
                if jsonb_typeof(v_item->'le') is not null and jsonb_typeof(v_item->'le') <> 'null' then
                  v_dt2 := public.foyer_date(v_item->'le');
                  if v_dt2 is null then raise exception 'projection.biens « % » : date (le) invalide (AAAA-MM-JJ)', v_txt; end if;
                  if v_dt2 > v_auj then
                    raise exception 'projection.biens « % » : date (le) dans le futur (la date du document consulté est attendue)', v_txt;
                  end if;
                  v_le := v_dt2;
                end if;
                v_row := jsonb_set(v_row, array[v_txt], jsonb_build_object('prix_achat', v_num, 'date_achat', to_char(v_dt, 'YYYY-MM-DD'),
                  'source', v_nom, 'le', to_char(v_le, 'YYYY-MM-DD')), true);
              end loop;
              select count(*) into v_n from jsonb_object_keys(v_row);
              if v_n > 50 then raise exception 'projection.biens : 50 biens au plus (% après fusion)', v_n; end if;
              if v_n = 0 then v_proj := v_proj - 'biens'; else v_proj := jsonb_set(v_proj, '{biens}', v_row, true); end if;
            end if;
          end loop;
          if jsonb_typeof(v_obj->'source') = 'string' and not (v_obj ? 'le') then
            v_proj := v_proj || jsonb_build_object('le', to_char(v_auj, 'YYYY-MM-DD'));
          end if;
          update public.config set projection = v_proj where user_id = v_uid;
        end if;

      /* ---------- événements de vie du foyer (0030) : mêmes règles que Projection.validerEvenement ---------- */
      when 'evenement' then
        if p.operation = 'supprimer' then
          delete from public.foyer_evenements where id = p.ref::uuid and user_id = v_uid;
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'événement « % » introuvable', p.ref; end if;
        else
          select k into v_key from jsonb_object_keys(v) k
           where k not in ('type', 'personne', 'libelle', 'date', 'fin', 'params', 'source', 'variante_id') limit 1;
          if v_key is not null then
            raise exception 'événement : champ « % » inconnu (type, personne, libelle, date, fin, params, source, variante_id)', v_key;
          end if;
          -- événement résultant : la proposition seule (creer), ou l'événement existant complété par les champs fournis (modifier)
          if p.operation = 'creer' then
            v_ev := v;
          else
            select to_jsonb(fe) - 'id' - 'user_id' - 'created_at' - 'updated_at' into v_ev
              from public.foyer_evenements fe where fe.id = p.ref::uuid and fe.user_id = v_uid for update;
            if v_ev is null then raise exception 'événement « % » introuvable', p.ref; end if;
            v_ev := v_ev || v;
          end if;
          select coalesce(array_agg(c.id::text), '{}'::text[]) into v_cr from public.credits c where c.user_id = v_uid;
          select coalesce(array_agg(b.id::text), '{}'::text[]) into v_bi from public.biens b where b.user_id = v_uid;
          v_msg := public.foyer_valider_evenement(v_ev, v_cr, v_bi, current_date);
          if v_msg is not null then raise exception '%', v_msg; end if;
          v_vid := null;
          if public.foyer_present(v_ev->'variante_id') then
            begin
              v_vid := (v_ev->>'variante_id')::uuid;
            exception when others then
              raise exception 'événement : variante_id invalide (identifiant de variante attendu)';
            end;
            if not exists (select 1 from public.foyer_variantes fv where fv.id = v_vid and fv.user_id = v_uid) then
              raise exception 'variante « % » introuvable', v_vid;
            end if;
          end if;
          if p.operation = 'creer' then
            select count(*) into v_n from public.foyer_evenements where user_id = v_uid;
            if v_n >= 100 then raise exception 'Limite atteinte : 100 événements au plus. Supprime un événement avant d''en ajouter un.'; end if;
            insert into public.foyer_evenements (user_id, variante_id, type, personne, libelle, date, fin, params, source)
            values (v_uid, v_vid, v_ev->>'type', v_ev->>'personne', public.foyer_rogner(v_ev->>'libelle'), (v_ev->>'date')::date,
                    case when public.foyer_present(v_ev->'fin') then (v_ev->>'fin')::date end,
                    case when v_ev ? 'params' then v_ev->'params' else '{}'::jsonb end, public.foyer_rogner(v_ev->>'source'));
          else
            update public.foyer_evenements set
              variante_id = v_vid, type = v_ev->>'type', personne = v_ev->>'personne', libelle = public.foyer_rogner(v_ev->>'libelle'),
              date = (v_ev->>'date')::date, fin = case when public.foyer_present(v_ev->'fin') then (v_ev->>'fin')::date end,
              params = case when v_ev ? 'params' then v_ev->'params' else '{}'::jsonb end, source = public.foyer_rogner(v_ev->>'source')
            where id = p.ref::uuid and user_id = v_uid;
          end if;
        end if;

      /* ---------- variantes du foyer (0030) : mêmes règles que Projection.validerVariante ---------- */
      when 'variante' then
        if p.operation = 'supprimer' then
          delete from public.foyer_variantes where id = p.ref::uuid and user_id = v_uid;
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'variante « % » introuvable', p.ref; end if;
        else
          select k into v_key from jsonb_object_keys(v) k where k not in ('nom', 'description', 'retire', 'hypotheses') limit 1;
          if v_key is not null then raise exception 'variante : champ « % » inconnu (nom, description, retire, hypotheses)', v_key; end if;
          if p.operation = 'creer' then
            v_ev := v;
          else
            select jsonb_build_object('nom', fv.nom, 'description', fv.description, 'retire', to_jsonb(fv.retire), 'hypotheses', fv.hypotheses) into v_ev
              from public.foyer_variantes fv where fv.id = p.ref::uuid and fv.user_id = v_uid for update;
            if v_ev is null then raise exception 'variante « % » introuvable', p.ref; end if;
            v_ev := v_ev || v;
          end if;
          v_msg := public.foyer_valider_variante(v_ev);
          if v_msg is not null then raise exception '%', v_msg; end if;
          if p.operation = 'creer' then
            select count(*) into v_n from public.foyer_variantes where user_id = v_uid;
            if v_n >= 10 then raise exception 'Limite atteinte : 10 variantes au plus. Supprime une variante avant d''en ajouter une.'; end if;
            insert into public.foyer_variantes (user_id, nom, description, retire, hypotheses)
            values (v_uid, public.foyer_rogner(v_ev->>'nom'), case when public.foyer_present(v_ev->'description') then v_ev->>'description' else '' end,
                    case when public.foyer_present(v_ev->'retire') then array(select jsonb_array_elements_text(v_ev->'retire'))::uuid[] else '{}'::uuid[] end,
                    case when jsonb_typeof(v_ev->'hypotheses') = 'object' then v_ev->'hypotheses' else '{}'::jsonb end);
          else
            update public.foyer_variantes set
              nom         = public.foyer_rogner(v_ev->>'nom'),
              description = case when public.foyer_present(v_ev->'description') then v_ev->>'description' else '' end,
              retire      = case when public.foyer_present(v_ev->'retire') then array(select jsonb_array_elements_text(v_ev->'retire'))::uuid[] else '{}'::uuid[] end,
              hypotheses  = case when jsonb_typeof(v_ev->'hypotheses') = 'object' then v_ev->'hypotheses' else '{}'::jsonb end
            where id = p.ref::uuid and user_id = v_uid;
          end if;
        end if;

      /* ---------- plans figés (0030) : création et suppression seulement ---------- */
      when 'plan_fige' then
        if p.operation = 'modifier' then raise exception 'plan figé : seules la création et la suppression sont possibles'; end if;
        if p.operation = 'supprimer' then
          delete from public.plans_figes where id = p.ref::uuid and user_id = v_uid;
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'plan figé « % » introuvable', p.ref; end if;
        else
          select k into v_key from jsonb_object_keys(v) k where k not in ('raison', 'horizon_mois', 'parametres', 'serie') limit 1;
          if v_key is not null then raise exception 'plan figé : champ « % » inconnu (raison, horizon_mois, parametres, serie)', v_key; end if;
          if jsonb_typeof(v->'raison') is distinct from 'string' or (v->>'raison') not in ('revue_mensuelle', 'objectif', 'manuel') then
            raise exception 'plan figé : raison invalide (revue_mensuelle, objectif ou manuel attendu)';
          end if;
          v_num := public.foyer_nombre(v->'horizon_mois');
          if v_num is null or v_num <> trunc(v_num) or v_num < 1 or v_num > 300 then
            raise exception 'plan figé : horizon_mois invalide (entier de 1 à 300 attendu)';
          end if;
          if jsonb_typeof(v->'parametres') is distinct from 'object' then raise exception 'plan figé : parametres : objet attendu'; end if;
          if jsonb_typeof(v->'serie') is distinct from 'object' then raise exception 'plan figé : serie : objet attendu'; end if;
          if octet_length((v->'parametres')::text) > 100000 then raise exception 'plan figé : parametres : 100 000 octets au plus'; end if;
          if octet_length((v->'serie')::text) > 250000 then raise exception 'plan figé : serie : 250 000 octets au plus'; end if;
          select count(*) into v_n from public.plans_figes where user_id = v_uid;
          if v_n >= 60 then raise exception 'Limite atteinte : 60 plans figés au plus. Supprime un plan figé avant d''en ajouter un.'; end if;
          insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie)
          values (v_uid, v->>'raison', v_num::int, v->'parametres', v->'serie');
        end if;
      end case;
    exception
      when check_violation or not_null_violation or foreign_key_violation then
        raise exception 'Proposition non appliquée (%, %) : valeur refusée par la base (%).', v_quoi, p.operation, sqlerrm using errcode = '22023';
      when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
        raise exception 'Proposition non appliquée (%, %) : format invalide (%).', v_quoi, p.operation, sqlerrm using errcode = '22023';
      when others then
        raise exception 'Proposition non appliquée (%, %) : %.', v_quoi, p.operation, sqlerrm using errcode = '22023';
    end;

    update public.propositions
       set statut = 'acceptee', decide_le = now(), apres = case when p.operation = 'supprimer' then p.apres else v end
     where id = p.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.appliquer_propositions(uuid[], jsonb) from public, anon;
grant execute on function public.appliquer_propositions(uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- export_all() : + foyer_evenements, foyer_variantes et plans_figes (repart de 0021_banque.sql, seule définition depuis)
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
    'routines',     (select coalesce(jsonb_agg(to_jsonb(rt) order by rt.type), '[]') from public.routines rt where rt.user_id = auth.uid()),
    'fonctionnalites',   (select coalesce(jsonb_agg(to_jsonb(fo) order by fo.cle), '[]') from public.fonctionnalites fo where fo.user_id = auth.uid()),
    'banque_connexions', (select coalesce(jsonb_agg(to_jsonb(bc) order by bc.cree_le, bc.id), '[]') from public.banque_connexions bc where bc.user_id = auth.uid()),
    'banque_comptes',    (select coalesce(jsonb_agg(to_jsonb(bk) order by bk.connexion_id, bk.id), '[]') from public.banque_comptes bk where bk.user_id = auth.uid()),
    'banque_placements', (select coalesce(jsonb_agg(to_jsonb(bp) order by bp.compte_id, bp.id), '[]') from public.banque_placements bp where bp.user_id = auth.uid()),
    'banque_operations', (select coalesce(jsonb_agg(to_jsonb(bo) order by bo.date, bo.compte_id, bo.id), '[]') from public.banque_operations bo where bo.user_id = auth.uid()),
    'banque_mois',       (select coalesce(jsonb_agg(to_jsonb(bm) order by bm.mois, bm.categorie), '[]') from public.banque_mois bm where bm.user_id = auth.uid()),
    'foyer_evenements',  (select coalesce(jsonb_agg(to_jsonb(fe) order by fe.date, fe.created_at, fe.id), '[]') from public.foyer_evenements fe where fe.user_id = auth.uid()),
    'foyer_variantes',   (select coalesce(jsonb_agg(to_jsonb(fv) order by fv.created_at, fv.id), '[]') from public.foyer_variantes fv where fv.user_id = auth.uid()),
    'plans_figes',       (select coalesce(jsonb_agg(to_jsonb(pf) order by pf.cree_le, pf.id), '[]') from public.plans_figes pf where pf.user_id = auth.uid())
  );
$$;
revoke all on function public.export_all() from public, anon;
grant execute on function public.export_all() to authenticated;

-- ---------------------------------------------------------------------------
-- Indice des prix à la consommation (série ipc_insee, Insee 011814630), 60 mois recopiés de la fixture.
-- Bloc séparé : idempotent (on conflict (serie, mois) do update).
-- ---------------------------------------------------------------------------
insert into public.indices_mensuels (serie, mois, valeur, source_titre, source_url, verifie_le) values
  ('ipc_insee', '2021-10-01', 88.67, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2021-11-01', 89, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2021-12-01', 89.17, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-01-01', 89.39, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-02-01', 90.07, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-03-01', 91.35, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-04-01', 91.75, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-05-01', 92.36, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-06-01', 93.06, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-07-01', 93.32, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-08-01', 93.74, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-09-01', 93.21, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-10-01', 94.17, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-11-01', 94.47, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2022-12-01', 94.38, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-01-01', 94.75, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-02-01', 95.73, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-03-01', 96.56, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-04-01', 97.15, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-05-01', 97.1, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-06-01', 97.27, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-07-01', 97.32, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-08-01', 98.29, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-09-01', 97.78, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-10-01', 97.92, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-11-01', 97.75, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2023-12-01', 97.88, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-01-01', 97.72, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-02-01', 98.56, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-03-01', 98.77, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-04-01', 99.27, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-05-01', 99.3, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-06-01', 99.38, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-07-01', 99.56, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-08-01', 100.09, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-09-01', 98.85, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-10-01', 99.13, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-11-01', 98.98, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2024-12-01', 99.17, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-01-01', 99.33, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-02-01', 99.35, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-03-01', 99.53, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-04-01', 100.09, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-05-01', 99.96, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-06-01', 100.34, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-07-01', 100.55, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-08-01', 100.97, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-09-01', 99.99, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-10-01', 100.06, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-11-01', 99.88, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2025-12-01', 99.95, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2026-01-01', 99.62, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2026-02-01', 100.24, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2026-03-01', 101.21, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2026-04-01', 102.25, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2026-05-01', 102.38, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2026-06-01', 102.11, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2026-07-01', 102.68, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2026-08-01', 103.35, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14'),
  ('ipc_insee', '2026-09-01', 102.99, 'Indice des prix à la consommation - Base 2025 - Ensemble des ménages - France - Nomenclature Coicop : 00 - Ensemble', 'https://www.insee.fr/fr/statistiques/serie/011814630', '2026-10-14')
on conflict (serie, mois) do update set valeur = excluded.valeur, source_titre = excluded.source_titre, source_url = excluded.source_url,
  verifie_le = excluded.verifie_le;
