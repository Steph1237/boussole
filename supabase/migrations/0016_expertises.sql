-- Boussole : expertises du Copilote patrimonial (EX1, docs/superpowers/specs/2026-10-11-ex1-copilote-expertises.md § 1).
-- À appliquer avec apply_migration (name = "expertises").
--   expertises          : méthodes d'analyse que le Copilote charge à la demande (consulter_expertise) ; lisibles par tous si
--                         publiées ; écrites par migration (EX1, 0017_expertises_contenu.sql) puis par l'atelier éditeur (EX3).
--                         Aucune écriture pour anon ni authenticated.
--   expertises_versions : historique immuable, alimenté par déclencheur seul (copie à chaque version et à chaque changement de
--                         statut d'une version) ; lisible par tous pour les seules copies au statut « publie ».
-- Règles de version (déclencheur expertises_version) :
--   - tout changement de contenu (nom, quand_consulter, perimetre, methode, controles, garde_fous, format, themes_savoir,
--     reperes, angles, marches, evals) sans changement de version incrémente la version d'une unité ;
--   - la version ne redescend jamais ; elle peut être relevée explicitement (republication) ;
--   - le slug et la date de création ne changent pas ; le journal des versions (changelog) ne se réécrit pas : on n'y ajoute
--     que de nouvelles entrées, et une entrée est ajoutée d'office pour toute version qui n'en a pas.
-- Une expertise ne se supprime pas (son historique la retient, clé étrangère restrict) : on l'archive (statut « archive »).

-- ---------------------------------------------------------------------------
-- Validateurs de forme (immuables : utilisables dans des contraintes)
-- ---------------------------------------------------------------------------

-- Toutes les chaînes d'un document JSON (clés exclues), une par ligne : texte contrôlé par contenu_sensible (0009). Le saut de
-- ligne sépare les textes : deux textes voisins ne forment jamais un faux numéro de compte ou de carte.
create or replace function public.jsonb_textes(p jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(v #>> '{}', E'\n'), '')
    from jsonb_path_query(coalesce(p, 'null'::jsonb), 'strict $.** ? (@.type() == "string")') as t(v);
$$;

-- Les validateurs ne lisent les éléments d'un tableau (ou les clés d'un objet) qu'après avoir vérifié son type, par des CASE :
-- l'ordre d'évaluation d'un AND ou d'un OR n'est pas garanti en SQL. Une valeur absente (NULL) est invalide.

-- Tableau de chaînes : chaque élément non vide après espaces et de longueur ≤ p_max.
create or replace function public.chaines_valides(p jsonb, p_max int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'array' then
    not exists (select 1 from jsonb_array_elements(p) e
                 where case when jsonb_typeof(e) = 'string' then char_length(btrim(e #>> '{}')) not between 1 and p_max else true end)
  else false end;
$$;

-- Points de contrôle : tableau de 3 à 20 phrases (1 à 300 caractères).
create or replace function public.expertise_controles_valides(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'array' then jsonb_array_length(p) between 3 and 20 and public.chaines_valides(p, 300) else false end;
$$;

-- Un cas d'évaluation : objet { question, contexte?, attendu: [..], interdit: [..] } sans autre clé ; question 5 à 500
-- caractères, contexte ≤ 500, attendu 1 à 8 phrases, interdit 0 à 8 phrases (≤ 300 caractères chacune).
create or replace function public.expertise_eval_valide(e jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(e) = 'object' then
    not exists (select 1 from jsonb_object_keys(e) k where k not in ('question','contexte','attendu','interdit'))
    and case when jsonb_typeof(e -> 'question') = 'string' then char_length(btrim(e ->> 'question')) between 5 and 500 else false end
    and case when e ? 'contexte' then jsonb_typeof(e -> 'contexte') = 'string' and char_length(e ->> 'contexte') <= 500 else true end
    and case when public.chaines_valides(e -> 'attendu', 300) then jsonb_array_length(e -> 'attendu') between 1 and 8 else false end
    and case when public.chaines_valides(e -> 'interdit', 300) then jsonb_array_length(e -> 'interdit') <= 8 else false end
  else false end;
$$;

-- Cas d'évaluation : tableau de 10 à 20 cas valides.
create or replace function public.expertise_evals_valides(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'array' then
    jsonb_array_length(p) between 10 and 20
    and not exists (select 1 from jsonb_array_elements(p) e where not public.expertise_eval_valide(e))
  else false end;
$$;

-- Une entrée du journal des versions : { version (entier ≥ 1), le (AAAA-MM-JJ), resume (1 à 300 caractères) }.
create or replace function public.expertise_changelog_entree_valide(e jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(e) = 'object'
               and jsonb_typeof(e -> 'version') = 'number' and jsonb_typeof(e -> 'le') = 'string' and jsonb_typeof(e -> 'resume') = 'string'
    then (e ->> 'version') ~ '^[1-9][0-9]{0,5}$' and (e ->> 'le') ~ '^\d{4}-\d{2}-\d{2}$'
         and char_length(btrim(e ->> 'resume')) between 1 and 300
  else false end;
$$;

-- Journal des versions : tableau de 200 entrées valides au plus.
create or replace function public.expertise_changelog_valide(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'array' then
    jsonb_array_length(p) <= 200
    and not exists (select 1 from jsonb_array_elements(p) e where not public.expertise_changelog_entree_valide(e))
  else false end;
$$;

-- Clés de repères : forme de public.reperes.cle (0009), 30 au plus. L'existence des clés est vérifiée par les tests du dépôt
-- (une clé de repère peut être publiée après l'expertise qui la cite).
create or replace function public.cles_reperes_valides(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_length(p, 1), 0) <= 30
     and not exists (select 1 from unnest(p) c where c is null or c !~ '^[a-z0-9_]{2,60}$');
$$;

-- ---------------------------------------------------------------------------
-- Expertises
-- ---------------------------------------------------------------------------
create table public.expertises (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  nom             text not null check (char_length(btrim(nom)) between 3 and 80),
  quand_consulter text not null check (char_length(btrim(quand_consulter)) between 20 and 300),
  perimetre       text not null check (char_length(btrim(perimetre)) between 20 and 600),
  methode         text not null check (char_length(btrim(methode)) between 200 and 8000),
  controles       jsonb not null check (public.expertise_controles_valides(controles)),
  garde_fous      text not null check (char_length(btrim(garde_fous)) between 100 and 3000),
  format          text not null check (char_length(btrim(format)) between 20 and 1500),
  themes_savoir   text[] not null default '{}' check (themes_savoir <@ array['epargne','enveloppes','fiscalite','immobilier','retraite','protection','marches','comportement','credit']::text[]),
  reperes         text[] not null default '{}' check (public.cles_reperes_valides(reperes)),
  angles          text[] not null default '{}' check (angles <@ array['allocation','frais','concentration','devises','crise','enveloppes','liquidite']::text[]),
  marches         text[] not null default '{}' check (marches <@ array['fr','eu','us','em','monde']::text[]),
  evals           jsonb not null check (public.expertise_evals_valides(evals)),
  version         int not null default 1 check (version >= 1),
  statut          text not null default 'brouillon' check (statut in ('publie','brouillon','archive')),
  changelog       jsonb not null default '[]'::jsonb check (public.expertise_changelog_valide(changelog)),
  mis_a_jour_le   date not null default current_date,
  cree_le         timestamptz not null default now(),
  -- Contrainte nommée (même fonction que memoire_agent et journal, 0009 / 0013) : aucun IBAN, numéro de carte ni mot interdit
  -- dans les textes, les contrôles, les cas d'évaluation ni le journal des versions.
  constraint expertises_contenu_sensible check (not (
    public.contenu_sensible(nom) or public.contenu_sensible(quand_consulter) or public.contenu_sensible(perimetre)
    or public.contenu_sensible(methode) or public.contenu_sensible(garde_fous) or public.contenu_sensible(format)
    or public.contenu_sensible(public.jsonb_textes(controles)) or public.contenu_sensible(public.jsonb_textes(evals))
    or public.contenu_sensible(public.jsonb_textes(changelog))))
);

alter table public.expertises enable row level security;
revoke all on table public.expertises from anon, authenticated;
create policy "expertises: lecture" on public.expertises for select to anon, authenticated using (statut = 'publie');
grant select on table public.expertises to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Historique immuable
-- ---------------------------------------------------------------------------
create table public.expertises_versions (
  id              bigint generated always as identity primary key,
  expertise_id    uuid not null references public.expertises(id) on delete restrict,
  slug            text not null,
  version         int not null,
  statut          text not null check (statut in ('publie','brouillon','archive')),
  nom             text not null,
  quand_consulter text not null,
  perimetre       text not null,
  methode         text not null,
  controles       jsonb not null,
  garde_fous      text not null,
  format          text not null,
  themes_savoir   text[] not null,
  reperes         text[] not null,
  angles          text[] not null,
  marches         text[] not null,
  evals           jsonb not null,
  -- Résumé de la version, repris du journal des versions de l'expertise.
  resume          text,
  mis_a_jour_le   date not null,
  copie_le        timestamptz not null default now(),
  unique (expertise_id, version, statut)
);
create index expertises_versions_slug on public.expertises_versions (slug, version desc);

alter table public.expertises_versions enable row level security;
revoke all on table public.expertises_versions from anon, authenticated;
create policy "expertises_versions: lecture" on public.expertises_versions for select to anon, authenticated using (statut = 'publie');
grant select on table public.expertises_versions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Version (avant écriture) : incrément automatique, version croissante, slug et date de création figés, journal des versions
-- en ajout seul, entrée ajoutée d'office pour une version sans entrée.
-- ---------------------------------------------------------------------------
create or replace function public.expertises_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_contenu boolean;
begin
  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug then
      raise exception 'Le slug d''une expertise ne change pas (%).', old.slug using errcode = '23514';
    end if;
    new.id := old.id;
    new.cree_le := old.cree_le;
    if new.version < old.version then
      raise exception 'La version d''une expertise ne redescend pas (% → %).', old.version, new.version using errcode = '23514';
    end if;
    if not (new.changelog @> old.changelog) then
      raise exception 'Le journal des versions d''une expertise ne se réécrit pas : on y ajoute des entrées.' using errcode = '23514';
    end if;
    v_contenu := (new.nom, new.quand_consulter, new.perimetre, new.methode, new.controles, new.garde_fous, new.format,
                  new.themes_savoir, new.reperes, new.angles, new.marches, new.evals)
      is distinct from (old.nom, old.quand_consulter, old.perimetre, old.methode, old.controles, old.garde_fous, old.format,
                  old.themes_savoir, old.reperes, old.angles, old.marches, old.evals);
    if v_contenu and new.version = old.version then
      new.version := old.version + 1;
    end if;
    if new.version <> old.version and new.mis_a_jour_le is not distinct from old.mis_a_jour_le then
      new.mis_a_jour_le := current_date;
    end if;
  end if;
  if not exists (select 1 from jsonb_array_elements(new.changelog) e where (e ->> 'version') = new.version::text) then
    new.changelog := new.changelog || jsonb_build_array(jsonb_build_object(
      'version', new.version, 'le', to_char(new.mis_a_jour_le, 'YYYY-MM-DD'),
      'resume', case when tg_op = 'INSERT' then 'Première version.' else 'Mise à jour du contenu.' end));
  end if;
  return new;
end;
$$;
create trigger expertises_version before insert or update on public.expertises for each row execute function public.expertises_version();

-- ---------------------------------------------------------------------------
-- Copie (après écriture) : une ligne par (version, statut), à la création, à chaque nouvelle version et à chaque changement de
-- statut ; une copie déjà faite n'est jamais refaite ni modifiée (le contenu d'une version est figé : tout changement de
-- contenu crée une nouvelle version).
-- ---------------------------------------------------------------------------
create or replace function public.expertises_historiser()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version or new.statut <> old.statut then
    insert into public.expertises_versions (expertise_id, slug, version, statut, nom, quand_consulter, perimetre, methode, controles,
                                            garde_fous, format, themes_savoir, reperes, angles, marches, evals, resume, mis_a_jour_le)
    values (new.id, new.slug, new.version, new.statut, new.nom, new.quand_consulter, new.perimetre, new.methode, new.controles,
            new.garde_fous, new.format, new.themes_savoir, new.reperes, new.angles, new.marches, new.evals,
            (select e ->> 'resume' from jsonb_array_elements(new.changelog) e where (e ->> 'version') = new.version::text limit 1),
            new.mis_a_jour_le)
    on conflict (expertise_id, version, statut) do nothing;
  end if;
  return null;
end;
$$;
create trigger expertises_historiser after insert or update on public.expertises for each row execute function public.expertises_historiser();

-- L'historique ne s'écrit que par le déclencheur ci-dessus (profondeur ≥ 2) ; il ne se modifie ni ne s'efface, pour aucun rôle.
create or replace function public.expertises_versions_immuable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if pg_trigger_depth() < 2 then
      raise exception 'L''historique des expertises s''écrit par déclencheur seulement.' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'L''historique des expertises est immuable.' using errcode = '42501';
end;
$$;
create trigger expertises_versions_immuable before insert or update or delete on public.expertises_versions
  for each row execute function public.expertises_versions_immuable();
create trigger expertises_versions_sans_vidage before truncate on public.expertises_versions
  for each statement execute function public.expertises_versions_immuable();
