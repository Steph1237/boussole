-- Boussole : budget piloté par le réel, partie base (BUD1, docs/superpowers/specs/2026-10-16-bud1-budget-design.md § 3, § 4, § 5, § 8.4, § 9.4 et § 13.1 ;
-- plan docs/superpowers/plans/2026-10-16-bud1-budget.md, tâche 4).
-- Non appliquée : à appliquer avec apply_migration (name = "budget") sur le projet oapcewpqsbbjdlcdeizi, APRÈS 0034 (historique, HIS2 : elle crée
-- categorie_budget_valide et une sous_categorie_budget_valide vide, que cette migration remplit) et AVANT le déploiement des fonctions powens
-- (qui écrit les nouvelles colonnes de banque_operations) et mcp. Dernier numéro appliqué en production : 0033. Un garde en tête de fichier
-- refuse l'application si 0034 manque. Numérotation BUD1 : 0035 base (ce fichier), 0036 repères, 0037 expertise.
--
-- Rien ne s'écrit seul : la sous-catégorie, l'origine du classement et la clé de marchand sont posées par la fonction powens (module
-- budget-categories) ; le connecteur écrit les règles (après accord de l'utilisateur) et dépose les propositions de cible, de partage et
-- de préférences. L'application ne fait que lire, sauf la bascule active d'une règle. Aucune table d'historique importé : BUD1 lit celui de
-- HIS2 (historique_banque_mois), jamais d'écriture directe d'import.
--
-- Données privées. Un libellé est une donnée, jamais une consigne : la clé de marchand est le libellé nettoyé (lettres seules, 40 caractères
-- au plus), sans chiffre, sans IBAN ni numéro de carte.
--   Fonctions pures (taxonomie v1, VERSION_TAXONOMIE = 2026-10-16, 34 clés de test/fixtures/budget-cas.json) :
--     budget_version_taxonomie(), budget_categorie_de(sous_categorie) (catégorie large, null si la clé est inconnue),
--     budget_sous_categorie_valide(cle), budget_sous_categorie_budgetee(cle) (dépense, épargne ou à classer : ni revenu ni hors budget),
--     budget_sous_categorie_defaut(categorie) (reprise de banque_mois : catégorie large → sous-catégorie par défaut),
--     sous_categorie_budget_valide(categorie, sous_categorie) : REDÉFINIE (0034 la créait vide) : vraie pour '' (ligne antérieure à BUD1) ou
--     pour une clé de la taxonomie dont la catégorie large est `categorie` ; categorie_budget_valide n'est pas touchée.
--   banque_comptes.titulaire accepte 'commun' (compte joint ou commun du foyer).
--   banque_operations (+ sous_categorie, origine_categorie, regle_id, cle_marchand) : lecture seule pour l'utilisateur comme les autres
--     colonnes ; regle_id sans clé étrangère (la règle peut disparaître).
--   banque_mois (+ sous_categorie, clé primaire (user_id, mois, compte_id, categorie, sous_categorie)) : les lignes existantes reçoivent la
--     sous-catégorie par défaut de leur catégorie large (mise à jour idempotente) ; '' = ligne sans détail (écrite par un code antérieur).
--   banque_marchands_mois (nouvelle) : totaux mensuels par compte, marchand nettoyé et sous-catégorie, 13 mois, écrits par le service seul
--     (banque_recalculer_mois), purgés par banque_purger ; régime « banque_* » de 0033 (lecture aal2 ou connecteur autorisé, écriture aal2
--     sans client_id, suppression idem).
--   budget_regles (nouvelle) : règles personnelles de classement, 300 au plus par utilisateur ; contraintes du § 3.4 (motif de 3 à 60
--     caractères sans suite de 6 chiffres ni contenu sensible, sous-catégorie contrôlée et jamais a_classer, ni hors budget sauf
--     apport_commun et transfert_foyer, sens, bornes de montant) ; politique restrictive « aal2 si facteur » de 0033 (préférences sans
--     montant, écrites par le connecteur après accord, D3) ; droit de colonne : l'application n'utilise que active.
--   config (+ partage, budget_cible, budget_preferences), écrites par appliquer_propositions (cible config) seulement.
-- appliquer_propositions : repart exactement de 0034 (sa dernière définition) ; le diff est limité à ces ajouts : une variable, trois clés
--   de la liste blanche de la cible config (partage, budget_cible, budget_preferences) et leurs trois blocs de validation et de fusion, qui
--   appellent budget_valider_partage, budget_valider_cible, budget_cible_appliquer, budget_valider_preferences et
--   budget_preferences_fusionner. Les gardes de 0034 sont intactes : un jeton OAuth (client_id) ne valide ni ne refuse jamais de proposition
--   (appliquer_propositions, refuser_propositions), propositions_garde et transactions_historique_garde ne sont pas touchées.
--   budget_cible : { perimetres: { foyer: Cible, p1?: Cible, p2?: Cible } } ; Cible = { valide_du (AAAA-MM), revenus_ref, blocs
--   { essentiels, envies, epargne }, sous_categories?, protegees?, niveau, taux_epargne?, objectifs?, source, justification?,
--   version_taxonomie? } ; somme des blocs = revenus_ref à 1 € près ; valide_du au plus tôt le mois qui suit la proposition ET la validation
--   (une cible ne répare pas la note du mois en cours) ; l'historique (24 entrées au plus, la plus ancienne sort) est tenu par la base :
--   { perimetre, valide_du, cible, propose_le } ; perimetres.<p> = la cible la plus récente. La cible du foyer est la seule exigée.
-- export_all : repart de 0034 et sort budget_regles et banque_marchands_mois de plus.
-- banque_purger : repart de 0021 (seule définition) et efface aussi les totaux par marchand de plus de 13 mois.
-- banque_recalculer_mois : repart de 0025 (dernière définition) ; regroupement par sous-catégorie ; lignes apport_commun, transfert_foyer et
--   releve_carte gardées (catégorie large virement_interne, que les lecteurs existants écartent déjà) ; carte à débit différé : ses
--   opérations comptent seulement quand un relevé de carte identifié (sous_categorie = releve_carte, posée par la fonction powens) est débité
--   sur un courant de la même connexion dans les 45 jours qui suivent, sinon écartées comme avant (le relevé, compté, reste « à classer ») ;
--   écrit banque_marchands_mois pour les mêmes mois. Même garde-fou de 90 jours, même verrou consultatif.
-- budget_reclasser_historique(utilisateur) (service seulement) : reconstruit banque_mois des mois de 90 jours à 13 mois à partir de
--   banque_marchands_mois (la fonction powens a reclassé les agrégats avant), pour chaque (mois, compte) dont la somme des agrégats égale
--   l'ancien total à 1 € près ; les autres restent figés. Renvoie { reconstruits: [mois], figes: [mois] }.
-- budget_marchands_reclasser(utilisateur, changements) (service seulement) : déplace des lignes de banque_marchands_mois d'une sous-catégorie à une
--   autre pour les mois de plus de 90 jours et de 13 mois au plus (reclassement décidé par la fonction powens après une règle), en additionnant les
--   montants d'une ligne déjà présente sous la sous-catégorie visée ; tout ou rien.
-- budget_reclasser_verrouiller(utilisateur, secondes) (service seulement) : verrou de 10 secondes du reclassement (prive.budget_reclassements).
-- Aucune espace insécable ni espace typographique (U+00A0, U+2000 à U+200F) dans ce fichier.
-- Prérequis : 0034 (categorie_budget_valide, historique_sensible), 0033 (connecteur_autorise), 0031 (foyer_nombre, foyer_rogner), 0028 (mfa_exigee).
-- Tests : test/budget-pglite.test.mjs, test/mfa-pglite.test.mjs, test/isolation.test.mjs (préproduction locale).

do $garde$
begin
  if to_regprocedure('public.categorie_budget_valide(text)') is null
     or to_regprocedure('public.sous_categorie_budget_valide(text, text)') is null
     or to_regprocedure('public.historique_sensible(text, boolean)') is null then
    raise exception '0035 (budget) exige 0034 (historique) : applique 0034 avant 0035.' using errcode = '55000';
  end if;
end
$garde$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Taxonomie : fonctions pures
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.budget_version_taxonomie()
returns text
language sql
immutable
set search_path = ''
as $$ select '2026-10-16'::text; $$;

-- Catégorie large d'une sous-catégorie (celle de banque_mois et des lecteurs existants) ; null si la clé est inconnue.
create or replace function public.budget_categorie_de(p_sous_categorie text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_sous_categorie
    when 'loyer' then 'logement'
    when 'credit_logement' then 'logement'
    when 'charges_logement' then 'logement'
    when 'energie' then 'logement'
    when 'telecom' then 'abonnements'
    when 'courses' then 'alimentation'
    when 'transport' then 'transport'
    when 'assurances' then 'divers'
    when 'sante' then 'sante'
    when 'enfants' then 'enfants'
    when 'autres_credits' then 'divers'
    when 'impots' then 'impots'
    when 'frais_bancaires' then 'divers'
    when 'especes' then 'divers'
    when 'commun_non_detaille' then 'divers'
    when 'restaurants' then 'loisirs'
    when 'sorties' then 'loisirs'
    when 'sport' then 'loisirs'
    when 'voyages' then 'loisirs'
    when 'shopping' then 'divers'
    when 'abonnements' then 'abonnements'
    when 'loisirs' then 'loisirs'
    when 'cadeaux_dons' then 'divers'
    when 'animaux' then 'divers'
    when 'epargne_precaution' then 'epargne'
    when 'investissement' then 'epargne'
    when 'projets' then 'epargne'
    when 'salaires' then 'revenus'
    when 'revenus_autres' then 'revenus'
    when 'virement_interne' then 'virement_interne'
    when 'apport_commun' then 'virement_interne'
    when 'transfert_foyer' then 'virement_interne'
    when 'releve_carte' then 'virement_interne'
    when 'a_classer' then 'divers'
    else null end;
$$;

create or replace function public.budget_sous_categorie_valide(p_cle text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select public.budget_categorie_de(p_cle) is not null; $$;

-- Sous-catégories qui entrent dans un budget : dépenses, épargne et « à classer » (ni revenus, ni hors budget).
create or replace function public.budget_sous_categorie_budgetee(p_cle text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(public.budget_categorie_de(p_cle) is not null
                  and p_cle not in ('salaires', 'revenus_autres', 'virement_interne', 'apport_commun', 'transfert_foyer', 'releve_carte'), false);
$$;

-- Reprise de banque_mois : sous-catégorie par défaut d'une catégorie large (« à classer » pour une catégorie inconnue).
create or replace function public.budget_sous_categorie_defaut(p_categorie text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_categorie
    when 'logement' then 'charges_logement'
    when 'alimentation' then 'courses'
    when 'transport' then 'transport'
    when 'enfants' then 'enfants'
    when 'sante' then 'sante'
    when 'loisirs' then 'loisirs'
    when 'abonnements' then 'abonnements'
    when 'impots' then 'impots'
    when 'divers' then 'a_classer'
    when 'revenus' then 'revenus_autres'
    when 'epargne' then 'epargne_precaution'
    when 'virement_interne' then 'virement_interne'
    else 'a_classer' end;
$$;

-- 0034 la créait vide (seule la sous-catégorie vide était valide) ; mêmes noms de paramètres (un create or replace ne peut pas les changer).
create or replace function public.sous_categorie_budget_valide(categorie text, sous_categorie text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(public.categorie_budget_valide(categorie)
                  and (sous_categorie = '' or public.budget_categorie_de(sous_categorie) = categorie), false);
$$;

revoke all on function public.budget_version_taxonomie(), public.budget_categorie_de(text), public.budget_sous_categorie_valide(text),
  public.budget_sous_categorie_budgetee(text), public.budget_sous_categorie_defaut(text), public.sous_categorie_budget_valide(text, text)
  from public, anon;
grant execute on function public.budget_version_taxonomie(), public.budget_categorie_de(text), public.budget_sous_categorie_valide(text),
  public.budget_sous_categorie_budgetee(text), public.budget_sous_categorie_defaut(text), public.sous_categorie_budget_valide(text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. Comptes, opérations, totaux mensuels
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Titulaire commun (compte joint ou commun du foyer, règle de CP2). Le déclencheur de rattachement (0022) ne contrôle pas le titulaire.
alter table public.banque_comptes drop constraint if exists banque_comptes_titulaire;
alter table public.banque_comptes add constraint banque_comptes_titulaire check (titulaire in ('p1', 'p2', 'commun'));

alter table public.banque_operations
  add column if not exists sous_categorie    text,
  add column if not exists origine_categorie text,
  add column if not exists regle_id          uuid,
  add column if not exists cle_marchand      text;
alter table public.banque_operations drop constraint if exists banque_operations_sous_categorie;
alter table public.banque_operations add constraint banque_operations_sous_categorie
  check (sous_categorie is null or public.budget_sous_categorie_valide(sous_categorie));
alter table public.banque_operations drop constraint if exists banque_operations_origine_categorie;
alter table public.banque_operations add constraint banque_operations_origine_categorie
  check (origine_categorie is null or origine_categorie in ('structure', 'regle', 'marchand', 'powens', 'motif', 'revenu', 'defaut'));
alter table public.banque_operations drop constraint if exists banque_operations_cle_marchand;
alter table public.banque_operations add constraint banque_operations_cle_marchand
  check (cle_marchand is null or (char_length(cle_marchand) <= 40 and not public.contenu_sensible(cle_marchand)));

alter table public.banque_mois add column if not exists sous_categorie text not null default '';
alter table public.banque_mois drop constraint if exists banque_mois_sous_categorie;
alter table public.banque_mois add constraint banque_mois_sous_categorie
  check (sous_categorie = '' or public.budget_sous_categorie_valide(sous_categorie));
alter table public.banque_mois drop constraint banque_mois_pkey;
alter table public.banque_mois add constraint banque_mois_pkey primary key (user_id, mois, compte_id, categorie, sous_categorie);
-- Reprise des lignes existantes : sous-catégorie par défaut de leur catégorie large (idempotent : plus aucune ligne vide après le premier passage).
update public.banque_mois set sous_categorie = public.budget_sous_categorie_defaut(categorie) where sous_categorie = '';

create table public.banque_marchands_mois (
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mois           date not null constraint banque_marchands_mois_mois check (mois = date_trunc('month', mois)::date),
  compte_id      bigint not null,
  cle_marchand   text not null default '' constraint banque_marchands_mois_cle check (char_length(cle_marchand) <= 40 and not public.contenu_sensible(cle_marchand)),
  sous_categorie text not null constraint banque_marchands_mois_sous_categorie check (public.budget_sous_categorie_valide(sous_categorie)),
  entrees        numeric not null default 0 constraint banque_marchands_mois_entrees check (entrees >= 0),
  sorties        numeric not null default 0 constraint banque_marchands_mois_sorties check (sorties >= 0),
  nombre         int not null default 0 constraint banque_marchands_mois_nombre check (nombre >= 0),
  primary key (user_id, mois, compte_id, cle_marchand, sous_categorie),
  foreign key (user_id, compte_id) references public.banque_comptes(user_id, id) on delete cascade
);
create index banque_marchands_mois_mois_idx on public.banque_marchands_mois (user_id, mois);

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. Règles personnelles de classement
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.budget_regles (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  motif          text not null,
  sous_categorie text not null,
  sens           text not null default 'sortie',
  compte_id      bigint,
  montant_min    numeric,
  montant_max    numeric,
  annuelle       boolean not null default false,
  active         boolean not null default true,
  source         text,
  cree_le        timestamptz not null default now(),
  maj_le         timestamptz not null default now(),
  -- un motif de 3 à 60 caractères, sans suite de 6 chiffres ni contenu sensible (IBAN, numéro de carte, mot de passe) : même contrôle que
  -- BudgetCategories.regleValide (le motif est testé tel quel et en majuscules, comme l'IBAN du contrôle de 0009)
  constraint budget_regles_motif check (char_length(btrim(motif)) between 3 and 60 and motif !~ '[0-9]{6,}'
    and not public.historique_sensible(motif) and not public.historique_sensible(upper(motif))),
  -- une règle range l'opération quelque part : une vraie sous-catégorie, jamais a_classer (elle ne classerait rien), jamais « hors budget »
  -- sauf apport_commun et transfert_foyer (compte d'en face non connecté)
  constraint budget_regles_sous_categorie check (public.budget_sous_categorie_valide(sous_categorie)
    and sous_categorie not in ('a_classer', 'virement_interne', 'releve_carte')),
  constraint budget_regles_sens check (sens in ('sortie', 'entree', 'les_deux')),
  constraint budget_regles_montants check ((montant_min is null or montant_min >= 0) and (montant_max is null or montant_max >= 0)
    and (montant_min is null or montant_max is null or montant_min <= montant_max)),
  constraint budget_regles_source check (source is null or char_length(source) <= 200),
  foreign key (user_id, compte_id) references public.banque_comptes(user_id, id) on delete cascade
);
create index budget_regles_user_idx on public.budget_regles (user_id, cree_le);

create or replace function public.budget_regles_garde()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.budget_regles r where r.user_id = new.user_id) >= 300 then
      raise exception 'Limite atteinte : 300 règles de classement au plus. Supprime une règle avant d''en ajouter une.' using errcode = '54000';
    end if;
  else
    new.maj_le := now();
  end if;
  return new;
end;
$$;
revoke all on function public.budget_regles_garde() from public, anon, authenticated;
create trigger budget_regles_garde before insert or update on public.budget_regles
  for each row execute function public.budget_regles_garde();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. RLS, politiques de double authentification (formes de 0033), droits
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.banque_marchands_mois enable row level security;
alter table public.budget_regles         enable row level security;

create policy "banque_marchands_mois: select" on public.banque_marchands_mois for select to authenticated using ((select auth.uid()) = user_id);

create policy "budget_regles: select" on public.budget_regles for select to authenticated using ((select auth.uid()) = user_id);
create policy "budget_regles: insert" on public.budget_regles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "budget_regles: update" on public.budget_regles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "budget_regles: delete" on public.budget_regles for delete to authenticated using ((select auth.uid()) = user_id);

-- banque_marchands_mois : forme « banque_* » (détail bancaire, écrit par le service) : lecture en aal2 OU par un connecteur autorisé,
-- écriture en aal2 ET sans client_id dans le jeton, suppression de même
create policy "banque_marchands_mois: aal2" on public.banque_marchands_mois as restrictive for all to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "banque_marchands_mois: suppression aal2" on public.banque_marchands_mois as restrictive for delete to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);

-- budget_regles : forme « aal2 si facteur » (préférences sans montant, écrites par le connecteur après accord, D3)
create policy "budget_regles: aal2 si facteur" on public.budget_regles as restrictive for all to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));

revoke all on table public.banque_marchands_mois, public.budget_regles from public, anon, authenticated;
grant select on table public.banque_marchands_mois to authenticated;
grant select, insert, delete on table public.budget_regles to authenticated;
grant update (active, motif, sous_categorie, sens, compte_id, montant_min, montant_max, annuelle, source, maj_le) on public.budget_regles to authenticated;
grant all on table public.banque_marchands_mois, public.budget_regles to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Réglages du budget (config) et leur validation
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.config add column if not exists partage jsonb not null default '{"mode": "egal", "p1": 0.5}'::jsonb;
alter table public.config add column if not exists budget_cible jsonb;
alter table public.config add column if not exists budget_preferences jsonb not null default '{}'::jsonb;
alter table public.config drop constraint if exists config_partage;
alter table public.config add constraint config_partage check (jsonb_typeof(partage) = 'object');
alter table public.config drop constraint if exists config_budget_cible;
alter table public.config add constraint config_budget_cible check (budget_cible is null or (jsonb_typeof(budget_cible) = 'object' and octet_length(budget_cible::text) <= 200000));
alter table public.config drop constraint if exists config_budget_preferences;
alter table public.config add constraint config_budget_preferences check (jsonb_typeof(budget_preferences) = 'object');

-- partage : { mode: egal | apports | fixe, p1 (0 à 1, exigé hors mode egal), source (1 à 300 caractères) } ; maj_le est posé par la base.
-- Renvoie un message en français, ou null si la valeur est valide.
create or replace function public.budget_valider_partage(j jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_num numeric;
  v_txt text;
begin
  if jsonb_typeof(j) is distinct from 'object' then return 'partage : objet attendu'; end if;
  select k into v_key from jsonb_object_keys(j) k where k not in ('mode', 'p1', 'source') limit 1;
  if v_key is not null then return format('partage : champ « %s » inconnu (mode, p1, source)', v_key); end if;
  if jsonb_typeof(j->'mode') is distinct from 'string' or (j->>'mode') not in ('egal', 'apports', 'fixe') then
    return 'partage : mode invalide (egal, apports ou fixe attendu)';
  end if;
  if j ? 'p1' and jsonb_typeof(j->'p1') <> 'null' then
    v_num := public.foyer_nombre(j->'p1');
    if v_num is null or v_num < 0 or v_num > 1 then return 'partage : p1 invalide (part de la première personne, entre 0 et 1)'; end if;
    if (j->>'mode') = 'egal' and v_num <> 0.5 then return 'partage : le mode egal implique p1 = 0,5'; end if;
  elsif (j->>'mode') <> 'egal' then
    return 'partage : p1 obligatoire (part de la première personne, entre 0 et 1) hors du mode egal';
  end if;
  if jsonb_typeof(j->'source') is distinct from 'string' then return 'partage : source obligatoire (1 à 300 caractères)'; end if;
  v_txt := public.foyer_rogner(j->>'source');
  if v_txt = '' or char_length(v_txt) > 300 then return 'partage : source obligatoire (1 à 300 caractères)'; end if;
  return null;
end;
$$;

-- budget_preferences : { protegees?: [sous-catégorie], revenus_variables?: booléen, annuelles?: [clé], especes_bloc?: essentiels | envies,
-- effort?: tenable | equilibre | ambitieux | trois, abonnements_inutilises?: [clé de marchand], source (1 à 300 caractères), le? (AAAA-MM-JJ,
-- jamais dans le futur) } ; null retire un champ. Renvoie un message en français, ou null.
create or replace function public.budget_valider_preferences(j jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
  v_elt jsonb;
  v_txt text;
  v_dt  date;
begin
  if jsonb_typeof(j) is distinct from 'object' then return 'budget_preferences : objet attendu'; end if;
  select k into v_key from jsonb_object_keys(j) k
   where k not in ('protegees', 'revenus_variables', 'annuelles', 'especes_bloc', 'effort', 'abonnements_inutilises', 'source', 'le') limit 1;
  if v_key is not null then
    return format('budget_preferences : champ « %s » inconnu (protegees, revenus_variables, annuelles, especes_bloc, effort, abonnements_inutilises, source, le)', v_key);
  end if;
  if (j - 'source' - 'le') = '{}'::jsonb then return 'budget_preferences : au moins un réglage attendu'; end if;
  if jsonb_typeof(j->'source') is distinct from 'string' then return 'budget_preferences : source obligatoire (1 à 300 caractères)'; end if;
  v_txt := public.foyer_rogner(j->>'source');
  if v_txt = '' or char_length(v_txt) > 300 then return 'budget_preferences : source obligatoire (1 à 300 caractères)'; end if;
  for v_key, v_val in select e.key, e.value from jsonb_each(j) e loop
    if v_key = 'source' or jsonb_typeof(v_val) = 'null' then continue; end if;
    if v_key = 'protegees' then
      if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) > 30 then return 'budget_preferences : protegees invalide (liste de 30 sous-catégories au plus)'; end if;
      for v_elt in select x from jsonb_array_elements(v_val) x loop
        if jsonb_typeof(v_elt) <> 'string' or not public.budget_sous_categorie_budgetee(v_elt #>> '{}') or (v_elt #>> '{}') = 'a_classer' then
          return format('budget_preferences : protegees : sous-catégorie « %s » inconnue ou sans budget', v_elt #>> '{}');
        end if;
      end loop;
    elsif v_key = 'revenus_variables' then
      if jsonb_typeof(v_val) <> 'boolean' then return 'budget_preferences : revenus_variables invalide (vrai ou faux attendu)'; end if;
    elsif v_key = 'annuelles' then
      if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) > 12 then return 'budget_preferences : annuelles invalide (liste de 12 clés au plus)'; end if;
      for v_elt in select x from jsonb_array_elements(v_val) x loop
        if jsonb_typeof(v_elt) <> 'string' or (v_elt #>> '{}') !~ '^[a-z0-9_]{1,40}$' then
          return 'budget_preferences : annuelles : clé invalide (lettres minuscules, chiffres et _, 40 caractères au plus)';
        end if;
      end loop;
    elsif v_key = 'especes_bloc' then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('essentiels', 'envies') then return 'budget_preferences : especes_bloc invalide (essentiels ou envies attendu)'; end if;
    elsif v_key = 'effort' then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('tenable', 'equilibre', 'ambitieux', 'trois') then
        return 'budget_preferences : effort invalide (tenable, equilibre, ambitieux ou trois attendu)';
      end if;
    elsif v_key = 'abonnements_inutilises' then
      if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) > 30 then return 'budget_preferences : abonnements_inutilises invalide (liste de 30 clés au plus)'; end if;
      for v_elt in select x from jsonb_array_elements(v_val) x loop
        if jsonb_typeof(v_elt) <> 'string' or (v_elt #>> '{}') !~ '^[a-z0-9 ]{1,40}$' or public.historique_sensible(v_elt #>> '{}') then
          return 'budget_preferences : abonnements_inutilises : clé de marchand invalide (lettres minuscules, 40 caractères au plus)';
        end if;
      end loop;
    elsif v_key = 'le' then
      v_dt := public.foyer_date(v_val);
      if v_dt is null then return 'budget_preferences : date (le) invalide (AAAA-MM-JJ)'; end if;
      if v_dt > (now() at time zone 'Europe/Paris')::date then return 'budget_preferences : date (le) dans le futur (la date du document consulté est attendue)'; end if;
    end if;
  end loop;
  return null;
end;
$$;

-- Fusion champ par champ dans config.budget_preferences ; null retire un champ ; la date du jour est mise dans « le » quand elle n'est pas fournie.
create or replace function public.budget_preferences_fusionner(p_actuel jsonb, p_nouveau jsonb, p_le date)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_res jsonb := case when jsonb_typeof(p_actuel) = 'object' then p_actuel else '{}'::jsonb end;
  v_key text;
  v_val jsonb;
begin
  for v_key, v_val in select e.key, e.value from jsonb_each(p_nouveau) e loop
    if jsonb_typeof(v_val) = 'null' then
      v_res := v_res - v_key;
    elsif v_key = 'source' then
      v_res := v_res || jsonb_build_object('source', public.foyer_rogner(v_val #>> '{}'));
    else
      v_res := v_res || jsonb_build_object(v_key, v_val);
    end if;
  end loop;
  if jsonb_typeof(p_nouveau->'le') is distinct from 'string' then
    v_res := v_res || jsonb_build_object('le', to_char(p_le, 'YYYY-MM-DD'));
  end if;
  return v_res;
end;
$$;

-- Une cible (spec § 8.4). Renvoie un message en français, ou null si elle est valide. Montants entre 0 et 100 000 €, somme des blocs égale à
-- revenus_ref à 1 € près ; sous_categories (facultatif) : clés budgétées, dépenses = essentiels + envies, épargne = epargne quand elle y figure.
create or replace function public.budget_valider_cible(j jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key   text;
  v_val   jsonb;
  v_elt   jsonb;
  v_num   numeric;
  v_ref   numeric;
  v_ess   numeric;
  v_env   numeric;
  v_epa   numeric;
  v_dep   numeric := 0;
  v_ep2   numeric := 0;
  v_neps  int := 0;
  v_txt   text;
begin
  if jsonb_typeof(j) is distinct from 'object' then return 'cible : objet attendu'; end if;
  select k into v_key from jsonb_object_keys(j) k
   where k not in ('valide_du', 'revenus_ref', 'blocs', 'sous_categories', 'protegees', 'niveau', 'taux_epargne', 'objectifs', 'source', 'justification', 'version_taxonomie') limit 1;
  if v_key is not null then
    return format('cible : champ « %s » inconnu (valide_du, revenus_ref, blocs, sous_categories, protegees, niveau, taux_epargne, objectifs, source, justification, version_taxonomie)', v_key);
  end if;
  if jsonb_typeof(j->'valide_du') is distinct from 'string' or (j->>'valide_du') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    return 'cible : valide_du invalide (mois AAAA-MM attendu)';
  end if;
  v_ref := public.foyer_nombre(j->'revenus_ref');
  if v_ref is null or v_ref < 0 or v_ref > 100000 then return 'cible : revenus_ref invalide (montant entre 0 et 100 000 € attendu)'; end if;
  if jsonb_typeof(j->'blocs') is distinct from 'object' then return 'cible : blocs invalide (objet { essentiels, envies, epargne } attendu)'; end if;
  select k into v_key from jsonb_object_keys(j->'blocs') k where k not in ('essentiels', 'envies', 'epargne') limit 1;
  if v_key is not null then return format('cible : blocs : champ « %s » inconnu (essentiels, envies, epargne)', v_key); end if;
  v_ess := public.foyer_nombre(j->'blocs'->'essentiels');
  v_env := public.foyer_nombre(j->'blocs'->'envies');
  v_epa := public.foyer_nombre(j->'blocs'->'epargne');
  if v_ess is null or v_env is null or v_epa is null or least(v_ess, v_env, v_epa) < 0 or greatest(v_ess, v_env, v_epa) > 100000 then
    return 'cible : blocs invalides (essentiels, envies et epargne : montants entre 0 et 100 000 € attendus)';
  end if;
  if abs(v_ess + v_env + v_epa - v_ref) > 1 then
    return format('cible : la somme des blocs (%s €) doit égaler les revenus de référence (%s €) à 1 € près', round(v_ess + v_env + v_epa), round(v_ref));
  end if;
  if j ? 'sous_categories' and jsonb_typeof(j->'sous_categories') <> 'null' then
    if jsonb_typeof(j->'sous_categories') <> 'object' then return 'cible : sous_categories invalide (objet { clé: montant } attendu)'; end if;
    for v_key, v_val in select e.key, e.value from jsonb_each(j->'sous_categories') e loop
      if not public.budget_sous_categorie_budgetee(v_key) then return format('cible : sous-catégorie « %s » inconnue ou sans budget', v_key); end if;
      v_num := public.foyer_nombre(v_val);
      if v_num is null or v_num < 0 or v_num > 100000 then return format('cible : sous_categories « %s » : montant entre 0 et 100 000 € attendu', v_key); end if;
      if public.budget_categorie_de(v_key) = 'epargne' then
        v_ep2 := v_ep2 + v_num; v_neps := v_neps + 1;
      else
        v_dep := v_dep + v_num;
      end if;
    end loop;
    if j->'sous_categories' <> '{}'::jsonb then
      if abs(v_dep - (v_ess + v_env)) > 1 then
        return format('cible : la somme des sous-catégories de dépenses (%s €) doit égaler essentiels + envies (%s €) à 1 € près', round(v_dep), round(v_ess + v_env));
      end if;
      if v_neps > 0 and abs(v_ep2 - v_epa) > 1 then
        return format('cible : la somme des sous-catégories d''épargne (%s €) doit égaler le bloc épargne (%s €) à 1 € près', round(v_ep2), round(v_epa));
      end if;
    end if;
  end if;
  if j ? 'protegees' and jsonb_typeof(j->'protegees') <> 'null' then
    if jsonb_typeof(j->'protegees') <> 'array' or jsonb_array_length(j->'protegees') > 30 then return 'cible : protegees invalide (liste de 30 sous-catégories au plus)'; end if;
    for v_elt in select x from jsonb_array_elements(j->'protegees') x loop
      if jsonb_typeof(v_elt) <> 'string' or not public.budget_sous_categorie_budgetee(v_elt #>> '{}') then
        return format('cible : protegees : sous-catégorie « %s » inconnue ou sans budget', v_elt #>> '{}');
      end if;
    end loop;
  end if;
  if jsonb_typeof(j->'niveau') is distinct from 'string' or (j->>'niveau') not in ('tenable', 'equilibree', 'ambitieuse', 'necessaire', 'personnalisee') then
    return 'cible : niveau invalide (tenable, equilibree, ambitieuse, necessaire ou personnalisee attendu)';
  end if;
  if j ? 'taux_epargne' and jsonb_typeof(j->'taux_epargne') <> 'null' then
    v_num := public.foyer_nombre(j->'taux_epargne');
    if v_num is null or v_num < 0 or v_num > 100 then return 'cible : taux_epargne invalide (pourcentage entre 0 et 100 attendu)'; end if;
  end if;
  if j ? 'objectifs' and jsonb_typeof(j->'objectifs') <> 'null' then
    if jsonb_typeof(j->'objectifs') <> 'array' or jsonb_array_length(j->'objectifs') > 50 then return 'cible : objectifs invalide (liste de 50 objectifs au plus)'; end if;
    for v_elt in select x from jsonb_array_elements(j->'objectifs') x loop
      if jsonb_typeof(v_elt) <> 'object' then return 'cible : objectifs : { id, probabilite_avant, probabilite_apres } attendu'; end if;
      select k into v_key from jsonb_object_keys(v_elt) k where k not in ('id', 'probabilite_avant', 'probabilite_apres') limit 1;
      if v_key is not null then return format('cible : objectifs : champ « %s » inconnu (id, probabilite_avant, probabilite_apres)', v_key); end if;
      if jsonb_typeof(v_elt->'id') is distinct from 'string' or char_length(v_elt->>'id') not between 1 and 100 then return 'cible : objectifs : id invalide (texte de 1 à 100 caractères)'; end if;
      foreach v_key in array array['probabilite_avant', 'probabilite_apres'] loop
        if v_elt ? v_key and jsonb_typeof(v_elt->v_key) <> 'null' then
          v_num := public.foyer_nombre(v_elt->v_key);
          if v_num is null or v_num < 0 or v_num > 1 then return format('cible : objectifs : %s invalide (probabilité entre 0 et 1)', v_key); end if;
        end if;
      end loop;
    end loop;
  end if;
  if jsonb_typeof(j->'source') is distinct from 'string' then return 'cible : source obligatoire (1 à 300 caractères)'; end if;
  v_txt := public.foyer_rogner(j->>'source');
  if v_txt = '' or char_length(v_txt) > 300 then return 'cible : source obligatoire (1 à 300 caractères)'; end if;
  if j ? 'justification' and jsonb_typeof(j->'justification') <> 'null'
     and (jsonb_typeof(j->'justification') <> 'string' or char_length(j->>'justification') > 2000) then
    return 'cible : justification invalide (texte de 2 000 caractères au plus)';
  end if;
  if j ? 'version_taxonomie' and jsonb_typeof(j->'version_taxonomie') <> 'null'
     and (jsonb_typeof(j->'version_taxonomie') <> 'string' or char_length(j->>'version_taxonomie') > 20) then
    return 'cible : version_taxonomie invalide (texte de 20 caractères au plus)';
  end if;
  return null;
end;
$$;

-- Applique une proposition de cible à config.budget_cible (spec § 8.4) : valide chaque périmètre, refuse un valide_du antérieur au mois qui suit
-- la proposition et la validation (une cible ne répare pas la note du mois en cours, D12), remplace les entrées du même périmètre qui ne sont
-- pas encore en vigueur (valide_du égal ou postérieur), tient l'historique (24 entrées au plus, la plus ancienne sort) et pose
-- perimetres.<périmètre> = la cible. La cible du foyer est la seule exigée. Lève une exception en français.
create or replace function public.budget_cible_appliquer(p_actuel jsonb, p_nouveau jsonb, p_le date, p_propose_le date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key    text;
  v_cible  jsonb;
  v_msg    text;
  v_min    text := to_char(date_trunc('month', greatest(p_le, p_propose_le)) + interval '1 month', 'YYYY-MM');
  v_perims jsonb := case when jsonb_typeof(p_actuel->'perimetres') = 'object' then p_actuel->'perimetres' else '{}'::jsonb end;
  v_hist   jsonb := case when jsonb_typeof(p_actuel->'historique') = 'array' then p_actuel->'historique' else '[]'::jsonb end;
begin
  if jsonb_typeof(p_nouveau) is distinct from 'object' then raise exception 'budget_cible : objet attendu'; end if;
  select k into v_key from jsonb_object_keys(p_nouveau) k where k <> 'perimetres' limit 1;
  if v_key is not null then
    raise exception 'budget_cible : champ « % » inconnu (perimetres seulement : l''historique est tenu par Boussole)', v_key;
  end if;
  if jsonb_typeof(p_nouveau->'perimetres') is distinct from 'object' or p_nouveau->'perimetres' = '{}'::jsonb then
    raise exception 'budget_cible : perimetres attendu ({ foyer: cible })';
  end if;
  for v_key, v_cible in select e.key, e.value from jsonb_each(p_nouveau->'perimetres') e loop
    if v_key not in ('foyer', 'p1', 'p2') then raise exception 'budget_cible : périmètre « % » inconnu (foyer, p1 ou p2)', v_key; end if;
    v_msg := public.budget_valider_cible(v_cible);
    if v_msg is not null then raise exception 'budget_cible.% : %', v_key, v_msg; end if;
    if (v_cible->>'valide_du') < v_min then
      raise exception 'budget_cible.% : valide_du « % » trop tôt : une cible s''applique au mois suivant, % au plus tôt', v_key, v_cible->>'valide_du', v_min;
    end if;
    v_hist := coalesce((select jsonb_agg(h.e order by h.e->>'valide_du', h.n) from (select x.e, x.n from jsonb_array_elements(v_hist) with ordinality x(e, n)) h
                         where not (h.e->>'perimetre' = v_key and h.e->>'valide_du' >= v_cible->>'valide_du')), '[]'::jsonb);
    v_hist := v_hist || jsonb_build_array(jsonb_build_object('perimetre', v_key, 'valide_du', v_cible->>'valide_du', 'cible', v_cible,
                                                            'propose_le', to_char(p_propose_le, 'YYYY-MM-DD')));
    v_perims := jsonb_set(v_perims, array[v_key], v_cible, true);
  end loop;
  if not v_perims ? 'foyer' then raise exception 'budget_cible : la cible du foyer est exigée'; end if;
  v_hist := coalesce((select jsonb_agg(h.e order by h.e->>'valide_du', h.n) from (select x.e, x.n from jsonb_array_elements(v_hist) with ordinality x(e, n)) h), '[]'::jsonb);
  if jsonb_array_length(v_hist) > 24 then
    v_hist := coalesce((select jsonb_agg(h.e order by h.n) from (select x.e, x.n from jsonb_array_elements(v_hist) with ordinality x(e, n) order by x.n desc limit 24) h), '[]'::jsonb);
  end if;
  return jsonb_build_object('perimetres', v_perims, 'historique', v_hist);
end;
$$;

revoke all on function public.budget_valider_partage(jsonb), public.budget_valider_preferences(jsonb), public.budget_preferences_fusionner(jsonb, jsonb, date),
  public.budget_valider_cible(jsonb), public.budget_cible_appliquer(jsonb, jsonb, date, date) from public, anon;
grant execute on function public.budget_valider_partage(jsonb), public.budget_valider_preferences(jsonb), public.budget_preferences_fusionner(jsonb, jsonb, date),
  public.budget_valider_cible(jsonb), public.budget_cible_appliquer(jsonb, jsonb, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. appliquer_propositions(ids, modifications) : 0034 (dernière définition) + partage, budget_cible, budget_preferences
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Le diff avec 0034 se limite à : la variable v_bud, la liste blanche des clés de la cible config (et ses deux messages) et les trois
-- blocs de la fin de la branche config. Tout le reste est recopié à l'identique (garde « jamais par un jeton OAuth » comprise).

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
  v_suivi  jsonb;
  v_hist   jsonb;
  v_bud    jsonb;
begin
  if v_uid is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  -- 0034 : valider est l'acte de l'utilisateur dans l'app, jamais d'un connecteur (jeton OAuth : client_id)
  if nullif(auth.jwt()->>'client_id', '') is not null then
    raise exception 'Un connecteur ne peut pas valider de proposition : l''utilisateur valide dans Boussole › Agent › À valider.' using errcode = '42501';
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
    v_quoi := coalesce(v_quoi, case p.cible when 'evenement' then 'événement' when 'variante' then 'variante' when 'plan_fige' then 'plan figé' when 'historique' then 'import d''historique' end);
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
          -- role et role_source (0032) : valeurs bornées (null les retire) ; pas de role_source sans role
          if v ? 'role' and jsonb_typeof(v->'role') <> 'null' and (jsonb_typeof(v->'role') <> 'string' or (v->>'role') not in ('reserve', 'coeur', 'satellite')) then
            raise exception 'role invalide (reserve, coeur ou satellite attendu)';
          end if;
          if v ? 'role_source' and jsonb_typeof(v->'role_source') <> 'null' and (jsonb_typeof(v->'role_source') <> 'string' or (v->>'role_source') not in ('propose', 'valide')) then
            raise exception 'role_source invalide (propose ou valide attendu)';
          end if;
          if p.operation = 'creer' then
            if v->>'role_source' is not null and v->>'role' is null then raise exception 'role_source sans role (le rôle de la ligne est attendu avec sa source)'; end if;
            insert into public.positions (user_id, name, envelope, owner, bloc, mode, isin, qty, pru, price_override, value, value_date,
                                          status, hypothesis, qty_estimated, note, role, role_source)
            values (v_uid, coalesce(nullif(btrim(v->>'name'), ''), 'Sans nom'), coalesce(v->>'envelope', ''), coalesce(v->>'owner', 'p1'),
                    coalesce(v->>'bloc', ''),
                    coalesce(v->>'mode', case when v_isin is not null and v->>'qty' is not null then 'market' else 'manual' end),
                    v_isin, (v->>'qty')::numeric, (v->>'pru')::numeric, (v->>'price_override')::numeric, (v->>'value')::numeric,
                    coalesce((v->>'value_date')::date, case when v->>'value' is not null then current_date end),
                    coalesce(v->>'status', 'actif'), v->>'hypothesis', coalesce((v->>'qty_estimated')::boolean, false), v->>'note',
                    v->>'role', v->>'role_source')
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
              note           = case when v ? 'note' then v->>'note' else note end,
              role           = case when v ? 'role' then v->>'role' else role end,
              role_source    = case when v ? 'role_source' then v->>'role_source' when v ? 'role' and v->>'role' is null then null else role_source end
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
         where k not in ('cushion', 'recurring', 'frais_enveloppes', 'enveloppes_infos', 'prets_infos', 'donations', 'avis_impot', 'projection', 'suivi', 'partage', 'budget_cible', 'budget_preferences') limit 1;
        if v_key is not null then
          raise exception 'réglage « % » non modifiable par proposition (cushion, recurring, frais_enveloppes, enveloppes_infos, prets_infos, donations, avis_impot, projection, suivi, partage, budget_cible ou budget_preferences seulement)', v_key;
        end if;
        if not (v ? 'cushion' or v ? 'recurring' or v ? 'frais_enveloppes' or v ? 'enveloppes_infos' or v ? 'prets_infos' or v ? 'donations' or v ? 'avis_impot' or v ? 'projection' or v ? 'suivi' or v ? 'partage' or v ? 'budget_cible' or v ? 'budget_preferences') then
          raise exception 'réglages : cushion ou recurring attendu (ou frais_enveloppes, enveloppes_infos, prets_infos, donations, avis_impot, projection, suivi, partage, budget_cible ou budget_preferences)';
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

        -- frais_enveloppes (0026, 0032) : { "<enveloppe>": { gestion_uc_pct?, gestion_euro_pct?, garde_pct?, arbitrage_pct?, courtage_pct?, source, le? } | null },
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
            select k into v_txt from jsonb_object_keys(v_val) k where k not in ('gestion_uc_pct', 'gestion_euro_pct', 'garde_pct', 'arbitrage_pct', 'courtage_pct', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'frais_enveloppes « % » : champ « % » inconnu (gestion_uc_pct, gestion_euro_pct, garde_pct, arbitrage_pct, courtage_pct, source, le)', v_env, v_txt;
            end if;
            v_ligne := '{}'::jsonb;
            foreach v_txt in array array['gestion_uc_pct', 'gestion_euro_pct', 'garde_pct', 'arbitrage_pct', 'courtage_pct'] loop
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
              raise exception 'frais_enveloppes « % » : au moins un pourcentage attendu (gestion_uc_pct, gestion_euro_pct, garde_pct, arbitrage_pct ou courtage_pct)', v_env;
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

        -- suivi (0032) : { revue_coeur?: annuelle|semestrielle, mois_revue_coeur? (entier de 1 à 12), seuil_ecart_pts? (3 à 10),
        -- plafond_satellite_pct? (0 à 30), seuil_baisse_satellite_pct? (10 à 50), semaine?: { actif: booléen, jour?: lundi … dimanche },
        -- source (obligatoire, 1 à 300 caractères), le? (AAAA-MM-JJ, jamais dans le futur) }, fusionné champ par champ dans config.suivi ;
        -- null retire un champ ; une semaine fournie remplace l'entrée existante en entier ; la date du jour est mise dans « le » quand elle
        -- n'est pas fournie (la source accompagne toujours la date de sa consultation). Les champs inconnus sont refusés.
        if v ? 'suivi' then
          v_obj := v->'suivi';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'suivi : objet attendu'; end if;
          if (v_obj - 'source' - 'le') = '{}'::jsonb then raise exception 'suivi : au moins un réglage attendu'; end if;
          v_txt := case when jsonb_typeof(v_obj->'source') = 'string' then public.foyer_rogner(v_obj->>'source') else '' end;
          if v_txt = '' or char_length(v_txt) > 300 then raise exception 'suivi : source obligatoire (1 à 300 caractères)'; end if;
          select k.suivi into v_suivi from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_suivi) is distinct from 'object' then v_suivi := '{}'::jsonb; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          for v_key, v_val in select e.key, e.value from jsonb_each(v_obj) e loop
            if v_key <> all (array['revue_coeur', 'mois_revue_coeur', 'seuil_ecart_pts', 'plafond_satellite_pct', 'seuil_baisse_satellite_pct', 'semaine', 'source', 'le']) then
              raise exception 'suivi : champ « % » inconnu (revue_coeur, mois_revue_coeur, seuil_ecart_pts, plafond_satellite_pct, seuil_baisse_satellite_pct, semaine, source, le)', v_key;
            end if;
            if jsonb_typeof(v_val) = 'null' then
              v_suivi := v_suivi - v_key;
              continue;
            end if;
            if v_key = 'revue_coeur' then
              if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('annuelle', 'semestrielle') then
                raise exception 'suivi : revue_coeur invalide (annuelle ou semestrielle attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, v_val);
            elsif v_key = 'mois_revue_coeur' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num <> trunc(v_num) or v_num < 1 or v_num > 12 then
                raise exception 'suivi : mois_revue_coeur invalide (mois de 1 à 12 attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, v_num::int);
            elsif v_key = 'seuil_ecart_pts' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < 3 or v_num > 10 then
                raise exception 'suivi : seuil_ecart_pts invalide (écart de 3 à 10 points attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, v_num);
            elsif v_key = 'plafond_satellite_pct' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < 0 or v_num > 30 then
                raise exception 'suivi : plafond_satellite_pct invalide (pourcentage de 0 à 30 attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, v_num);
            elsif v_key = 'seuil_baisse_satellite_pct' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < 10 or v_num > 50 then
                raise exception 'suivi : seuil_baisse_satellite_pct invalide (pourcentage de 10 à 50 attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, v_num);
            elsif v_key = 'semaine' then
              if jsonb_typeof(v_val) <> 'object' then raise exception 'suivi : semaine invalide (objet { actif, jour } attendu)'; end if;
              select k into v_nom from jsonb_object_keys(v_val) k where k not in ('actif', 'jour') limit 1;
              if v_nom is not null then raise exception 'suivi.semaine : champ « % » inconnu (actif, jour)', v_nom; end if;
              if jsonb_typeof(v_val->'actif') is distinct from 'boolean' then raise exception 'suivi.semaine : actif invalide (vrai ou faux attendu)'; end if;
              if jsonb_typeof(v_val->'jour') is not null and jsonb_typeof(v_val->'jour') <> 'null'
                 and (jsonb_typeof(v_val->'jour') <> 'string' or (v_val->>'jour') not in ('lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche')) then
                raise exception 'suivi.semaine : jour invalide (lundi, mardi, mercredi, jeudi, vendredi, samedi ou dimanche attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, jsonb_strip_nulls(jsonb_build_object('actif', v_val->'actif', 'jour', v_val->'jour')));
            elsif v_key = 'source' then
              v_suivi := v_suivi || jsonb_build_object(v_key, v_txt);
            else
              -- le
              v_dt := public.foyer_date(v_val);
              if v_dt is null then raise exception 'suivi : date (le) invalide (AAAA-MM-JJ)'; end if;
              if v_dt > v_auj then raise exception 'suivi : date (le) dans le futur (la date du document consulté est attendue)'; end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, to_char(v_dt, 'YYYY-MM-DD'));
            end if;
          end loop;
          if jsonb_typeof(v_obj->'le') is null or jsonb_typeof(v_obj->'le') = 'null' then
            v_suivi := v_suivi || jsonb_build_object('le', to_char(v_auj, 'YYYY-MM-DD'));
          end if;
          update public.config set suivi = v_suivi where user_id = v_uid;
        end if;

        -- partage (BUD1, 0035) : { mode: egal | apports | fixe, p1? (0 à 1, exigé hors mode egal), source (1 à 300 caractères) } ; remplacé en
        -- entier ; maj_le est posé ici (date de Paris). Mêmes contrôles et messages que le connecteur (regler_partage).
        if v ? 'partage' then
          v_msg := public.budget_valider_partage(v->'partage');
          if v_msg is not null then raise exception '%', v_msg; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          update public.config set partage = jsonb_build_object('mode', v->'partage'->>'mode',
              'p1', case when v->'partage'->>'mode' = 'egal' then 0.5 else round(public.foyer_nombre(v->'partage'->'p1'), 4) end,
              'maj_le', to_char(v_auj, 'YYYY-MM-DD'), 'source', public.foyer_rogner(v->'partage'->>'source'))
           where user_id = v_uid;
        end if;

        -- budget_cible (BUD1, 0035) : { perimetres: { foyer: Cible, p1?: Cible, p2?: Cible } } ; la base tient l'historique (24 entrées au plus) et
        -- refuse un valide_du antérieur au mois qui suit la proposition et la validation (budget_cible_appliquer).
        if v ? 'budget_cible' then
          v_auj := (now() at time zone 'Europe/Paris')::date;
          select k.budget_cible into v_bud from public.config k where k.user_id = v_uid for update;
          v_bud := public.budget_cible_appliquer(v_bud, v->'budget_cible', v_auj, (p.cree_le at time zone 'Europe/Paris')::date);
          update public.config set budget_cible = v_bud where user_id = v_uid;
        end if;

        -- budget_preferences (BUD1, 0035) : { protegees?, revenus_variables?, annuelles?, especes_bloc?, effort?, abonnements_inutilises?, source (obligatoire),
        -- le? } fusionné champ par champ dans config.budget_preferences ; null retire un champ ; la date du jour est mise dans « le » quand elle n'est pas fournie.
        if v ? 'budget_preferences' then
          v_msg := public.budget_valider_preferences(v->'budget_preferences');
          if v_msg is not null then raise exception '%', v_msg; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          select k.budget_preferences into v_bud from public.config k where k.user_id = v_uid for update;
          update public.config set budget_preferences = public.budget_preferences_fusionner(v_bud, v->'budget_preferences', v_auj) where user_id = v_uid;
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
      /* ---------- historique (0034) : import de relevés, d'ordres ou de versements ; création et suppression seulement ---------- */
      when 'historique' then
        if p.operation = 'modifier' then raise exception 'historique : seules la création et la suppression sont possibles'; end if;
        -- non modifiable avant validation : la proposition est appliquée telle quelle (pour corriger, redépose-la)
        v := p.apres;
        if p.operation = 'supprimer' then
          v_hist := public.historique_retirer(p.ref::uuid);
        else
          v_hist := public.historique_appliquer(p.ref, v, p.source);
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

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. export_all() : 0034 + budget_regles et banque_marchands_mois
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.export_all()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if nullif(auth.jwt()->>'client_id', '') is not null then
    raise exception 'Un connecteur ne peut pas exporter tes données : fais-le depuis Boussole › Mon compte.' using errcode = '42501';
  end if;
  return jsonb_build_object(
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
    'plans_figes',       (select coalesce(jsonb_agg(to_jsonb(pf) order by pf.cree_le, pf.id), '[]') from public.plans_figes pf where pf.user_id = auth.uid()),
    'connecteurs_autorises', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'client_id', g.client_id, 'client_nom', g.client_nom,
                                'accorde_le', g.accorde_le, 'expire_le', g.expire_le, 'lie_le', g.lie_le, 'dernier_usage', g.dernier_usage,
                                'revoque_le', g.revoque_le) order by g.accorde_le, g.id), '[]')
                              from public.connecteurs_autorises g where g.user_id = auth.uid()),
    'historique_comptes',     (select coalesce(jsonb_agg(to_jsonb(hc) order by hc.cree_le, hc.id), '[]') from public.historique_comptes hc where hc.user_id = auth.uid()),
    'historique_imports',     (select coalesce(jsonb_agg(to_jsonb(hi) order by hi.importe_le, hi.id), '[]') from public.historique_imports hi where hi.user_id = auth.uid()),
    'historique_releves',     (select coalesce(jsonb_agg(to_jsonb(hr) order by hr.compte_id, hr.mois), '[]') from public.historique_releves hr where hr.user_id = auth.uid()),
    'historique_banque_mois', (select coalesce(jsonb_agg(to_jsonb(hm) order by hm.compte_id, hm.mois, hm.categorie, hm.sous_categorie), '[]') from public.historique_banque_mois hm where hm.user_id = auth.uid()),
    'photos_reconstituees',   (select coalesce(jsonb_agg(to_jsonb(ph) order by ph.mois), '[]') from public.photos_reconstituees ph where ph.user_id = auth.uid()),
    'budget_regles',          (select coalesce(jsonb_agg(to_jsonb(br) order by br.cree_le, br.id), '[]') from public.budget_regles br where br.user_id = auth.uid()),
    'banque_marchands_mois',  (select coalesce(jsonb_agg(to_jsonb(bx) order by bx.mois, bx.compte_id, bx.cle_marchand, bx.sous_categorie), '[]') from public.banque_marchands_mois bx where bx.user_id = auth.uid())
  );
end;
$$;
revoke all on function public.export_all() from public, anon;
grant execute on function public.export_all() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. Totaux mensuels : opérations comptées, banque_recalculer_mois, banque_purger, budget_reclasser_historique
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Les opérations qui comptent dans le budget depuis p_depuis, au grain (mois, compte, catégorie, sous-catégorie, marchand). Une sous-catégorie
-- qui n'est pas de la catégorie large de la ligne (ou absente : opération antérieure à BUD1) est remplacée par celle de la reprise. Exclus : les
-- virements entre ses propres comptes (virement_interne) ; la carte à débit différé quand un courant de la même connexion existe, sauf si un relevé
-- de carte identifié (sous_categorie = releve_carte) est débité sur ce courant dans les 45 jours qui suivent l'opération (alors les opérations
-- de la carte comptent chacune à sa date et le relevé, lui, est hors budget). Gardés : apport_commun, transfert_foyer et releve_carte.
create or replace function public.banque_operations_comptees(p_user uuid, p_depuis date)
returns table (mois date, compte_id bigint, categorie text, sous_categorie text, cle_marchand text, entrees numeric, sorties numeric, nombre int)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('month', o.date)::date, o.compte_id, c.cat, s.sub, coalesce(o.cle_marchand, ''),
         coalesce(sum(o.montant) filter (where o.montant > 0), 0),
         coalesce(-sum(o.montant) filter (where o.montant < 0), 0),
         count(*)::int
    from public.banque_operations o
    join public.banque_comptes k on k.user_id = o.user_id and k.id = o.compte_id
   cross join lateral (select coalesce(nullif(btrim(o.categorie), ''), 'divers') as cat) c
   cross join lateral (select case when o.sous_categorie is not null and public.budget_categorie_de(o.sous_categorie) = c.cat
                                   then o.sous_categorie else public.budget_sous_categorie_defaut(c.cat) end as sub) s
   where o.user_id = p_user and o.date >= p_depuis
     and not (k.debit_differe
              and exists (select 1 from public.banque_comptes k2
                           where k2.user_id = k.user_id and k2.connexion_id = k.connexion_id and k2.type = 'courant' and not k2.debit_differe)
              and not exists (select 1 from public.banque_operations r
                                join public.banque_comptes k3 on k3.user_id = r.user_id and k3.id = r.compte_id
                               where r.user_id = k.user_id and k3.connexion_id = k.connexion_id and k3.type = 'courant' and not k3.debit_differe
                                 and r.sous_categorie = 'releve_carte' and r.date >= o.date and r.date <= o.date + 45))
     and (c.cat <> 'virement_interne' or s.sub in ('apport_commun', 'transfert_foyer', 'releve_carte'))
   group by 1, 2, 3, 4, 5;
$$;
revoke all on function public.banque_operations_comptees(uuid, date) from public, anon, authenticated;
grant execute on function public.banque_operations_comptees(uuid, date) to service_role;

-- banque_recalculer_mois(user, depuis) : 0025 + sous-catégorie, apports gardés, carte différée, agrégats par marchand.
create or replace function public.banque_recalculer_mois(p_user uuid, p_depuis date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_borne date := (now() at time zone 'Europe/Paris')::date - 90;
  v_debut date;
begin
  if p_user is null or p_depuis is null then
    raise exception 'Utilisateur et date de départ obligatoires.' using errcode = '22023';
  end if;
  v_debut := greatest(date_trunc('month', p_depuis)::date,
                      case when v_borne = date_trunc('month', v_borne)::date then v_borne
                           else (date_trunc('month', v_borne) + interval '1 month')::date end);
  perform pg_advisory_xact_lock(hashtext('banque_mois:' || p_user::text));
  delete from public.banque_mois m where m.user_id = p_user and m.mois >= v_debut;
  delete from public.banque_marchands_mois mm where mm.user_id = p_user and mm.mois >= v_debut;
  insert into public.banque_mois (user_id, mois, compte_id, categorie, sous_categorie, entrees, sorties, nombre)
  select p_user, c.mois, c.compte_id, c.categorie, c.sous_categorie, sum(c.entrees), sum(c.sorties), sum(c.nombre)::int
    from public.banque_operations_comptees(p_user, v_debut) c
   group by 2, 3, 4, 5;
  insert into public.banque_marchands_mois (user_id, mois, compte_id, cle_marchand, sous_categorie, entrees, sorties, nombre)
  select p_user, c.mois, c.compte_id, c.cle_marchand, c.sous_categorie, sum(c.entrees), sum(c.sorties), sum(c.nombre)::int
    from public.banque_operations_comptees(p_user, v_debut) c
   group by 2, 3, 4, 5;
end;
$$;
revoke all on function public.banque_recalculer_mois(uuid, date) from public, anon, authenticated;
grant execute on function public.banque_recalculer_mois(uuid, date) to service_role;

-- banque_purger(jours) : 0021 + les totaux par marchand de plus de 13 mois (D1). Renvoie le nombre d'opérations supprimées.
create or replace function public.banque_purger(p_jours int default 90)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if p_jours is null or p_jours < 1 then
    raise exception 'Durée de conservation invalide : au moins 1 jour.' using errcode = '22023';
  end if;
  delete from public.banque_operations o where o.date < (now() at time zone 'Europe/Paris')::date - p_jours;
  get diagnostics n = row_count;
  delete from public.banque_marchands_mois mm
   where mm.mois < (date_trunc('month', (now() at time zone 'Europe/Paris')::date) - interval '13 months')::date;
  return n;
end;
$$;
revoke all on function public.banque_purger(int) from public, anon, authenticated;
grant execute on function public.banque_purger(int) to service_role;

-- budget_reclasser_historique(user) : reconstruit banque_mois des mois de plus de 90 jours et de 13 mois au plus à partir de
-- banque_marchands_mois (que la fonction powens a reclassés avant l'appel). Un (mois, compte) n'est reconstruit que si la somme de ses agrégats
-- égale l'ancien total (entrées et sorties) à 1 € près ; sinon, ou sans agrégats, il reste figé. Renvoie { reconstruits: [AAAA-MM], figes: [AAAA-MM] }
-- (un mois est « reconstruit » quand tous ses comptes le sont).
create or replace function public.budget_reclasser_historique(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_borne date := (now() at time zone 'Europe/Paris')::date - 90;
  v_fin   date;
  v_debut date := (date_trunc('month', (now() at time zone 'Europe/Paris')::date) - interval '13 months')::date;
  r       record;
  v_ok    text[] := '{}';
  v_ko    text[] := '{}';
begin
  if p_user is null then
    raise exception 'Utilisateur obligatoire.' using errcode = '22023';
  end if;
  -- premier mois que banque_recalculer_mois peut encore recalculer : ceux d'avant sont figés côté détail
  v_fin := case when v_borne = date_trunc('month', v_borne)::date then v_borne
                else (date_trunc('month', v_borne) + interval '1 month')::date end;
  perform pg_advisory_xact_lock(hashtext('banque_mois:' || p_user::text));
  for r in
    select x.mois, x.compte_id, x.e_ag, x.s_ag, x.e_old, x.s_old
      from (select coalesce(a.mois, b.mois) as mois, coalesce(a.compte_id, b.compte_id) as compte_id,
                   a.e as e_ag, a.s as s_ag, b.e as e_old, b.s as s_old
              from (select mm.mois, mm.compte_id, sum(mm.entrees) e, sum(mm.sorties) s
                      from public.banque_marchands_mois mm
                     where mm.user_id = p_user and mm.mois >= v_debut and mm.mois < v_fin group by 1, 2) a
              full join (select m.mois, m.compte_id, sum(m.entrees) e, sum(m.sorties) s
                           from public.banque_mois m
                          where m.user_id = p_user and m.mois >= v_debut and m.mois < v_fin group by 1, 2) b
                on a.mois = b.mois and a.compte_id = b.compte_id) x
     order by x.mois, x.compte_id
  loop
    if r.e_ag is not null and r.e_old is not null and abs(r.e_ag - r.e_old) <= 1 and abs(r.s_ag - r.s_old) <= 1 then
      delete from public.banque_mois m where m.user_id = p_user and m.mois = r.mois and m.compte_id = r.compte_id;
      insert into public.banque_mois (user_id, mois, compte_id, categorie, sous_categorie, entrees, sorties, nombre)
      select p_user, mm.mois, mm.compte_id, public.budget_categorie_de(mm.sous_categorie), mm.sous_categorie,
             sum(mm.entrees), sum(mm.sorties), sum(mm.nombre)::int
        from public.banque_marchands_mois mm
       where mm.user_id = p_user and mm.mois = r.mois and mm.compte_id = r.compte_id
       group by 2, 3, 4, 5;
      v_ok := v_ok || to_char(r.mois, 'YYYY-MM');
    elsif r.e_old is not null then
      v_ko := v_ko || to_char(r.mois, 'YYYY-MM');
    end if;
  end loop;
  return jsonb_build_object(
    'reconstruits', coalesce((select jsonb_agg(distinct m order by m) from unnest(v_ok) m where m <> all (v_ko)), '[]'::jsonb),
    'figes',        coalesce((select jsonb_agg(distinct m order by m) from unnest(v_ko) m), '[]'::jsonb));
end;
$$;
revoke all on function public.budget_reclasser_historique(uuid) from public, anon, authenticated;
grant execute on function public.budget_reclasser_historique(uuid) to service_role;

-- budget_marchands_reclasser(user, changements) : applique à banque_marchands_mois un reclassement décidé par la fonction powens (règle créée,
-- modifiée, désactivée ou supprimée) pour les mois de plus de 90 jours et de 13 mois au plus. changements : [{ mois (AAAA-MM-JJ, 1er du mois),
-- compte_id, cle_marchand, de, vers }] ; la ligne (mois, compte, marchand, de) passe à la sous-catégorie `vers`, ses montants s'ajoutant à ceux d'une
-- ligne qui existerait déjà sous `vers`. Un changement hors de cette période, ou dont la ligne n'existe plus, est ignoré. Tout ou rien. Renvoie le
-- nombre de lignes déplacées. Réservée à service_role ; budget_reclasser_historique reconstruit ensuite banque_mois.
create or replace function public.budget_marchands_reclasser(p_user uuid, p_changes jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_borne date := (now() at time zone 'Europe/Paris')::date - 90;
  v_fin   date;
  v_debut date := (date_trunc('month', (now() at time zone 'Europe/Paris')::date) - interval '13 months')::date;
  v_c     jsonb;
  v_mois  date;
  v_n     int := 0;
  v_k     int;
begin
  if p_user is null or jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Utilisateur et liste de changements obligatoires.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 5000 then
    raise exception 'Trop de changements : 5 000 au plus par appel.' using errcode = '22023';
  end if;
  v_fin := case when v_borne = date_trunc('month', v_borne)::date then v_borne
                else (date_trunc('month', v_borne) + interval '1 month')::date end;
  perform pg_advisory_xact_lock(hashtext('banque_mois:' || p_user::text));
  for v_c in select x from jsonb_array_elements(p_changes) x loop
    if jsonb_typeof(v_c) is distinct from 'object' or jsonb_typeof(v_c->'mois') is distinct from 'string' or jsonb_typeof(v_c->'compte_id') is distinct from 'number'
       or jsonb_typeof(v_c->'cle_marchand') is distinct from 'string' or jsonb_typeof(v_c->'de') is distinct from 'string'
       or jsonb_typeof(v_c->'vers') is distinct from 'string' then
      raise exception 'Changement invalide : { mois, compte_id, cle_marchand, de, vers } attendu.' using errcode = '22023';
    end if;
    if not public.budget_sous_categorie_valide(v_c->>'vers') or not public.budget_sous_categorie_valide(v_c->>'de') then
      raise exception 'Sous-catégorie inconnue dans un changement.' using errcode = '22023';
    end if;
    v_mois := (v_c->>'mois')::date;
    if v_mois <> date_trunc('month', v_mois)::date then
      raise exception 'Changement invalide : mois au premier jour du mois.' using errcode = '22023';
    end if;
    if v_mois < v_debut or v_mois >= v_fin or (v_c->>'de') = (v_c->>'vers') then continue; end if;
    with src as (
      delete from public.banque_marchands_mois mm
       where mm.user_id = p_user and mm.mois = v_mois and mm.compte_id = (v_c->>'compte_id')::bigint
         and mm.cle_marchand = v_c->>'cle_marchand' and mm.sous_categorie = v_c->>'de'
       returning mm.entrees, mm.sorties, mm.nombre)
    insert into public.banque_marchands_mois as bm (user_id, mois, compte_id, cle_marchand, sous_categorie, entrees, sorties, nombre)
    select p_user, v_mois, (v_c->>'compte_id')::bigint, v_c->>'cle_marchand', v_c->>'vers', src.entrees, src.sorties, src.nombre from src
    on conflict (user_id, mois, compte_id, cle_marchand, sous_categorie)
    do update set entrees = bm.entrees + excluded.entrees, sorties = bm.sorties + excluded.sorties, nombre = bm.nombre + excluded.nombre;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.budget_marchands_reclasser(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.budget_marchands_reclasser(uuid, jsonb) to service_role;

-- Verrou du reclassement (POST /powens/reclasser) : au plus un appel toutes les 10 secondes par utilisateur. La ligne vit dans le schéma
-- non exposé prive ; budget_reclasser_verrouiller est atomique (insert … on conflict do update … where verrou expiré) et renvoie vrai si le verrou est pris.
create table if not exists prive.budget_reclassements (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  verrou_jusqua timestamptz not null
);
revoke all on table prive.budget_reclassements from public, anon, authenticated;

create or replace function public.budget_reclasser_verrouiller(p_user uuid, p_secondes int default 10)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pris boolean;
begin
  if p_user is null or p_secondes is null or p_secondes < 1 or p_secondes > 300 then
    raise exception 'Utilisateur et durée (1 à 300 secondes) obligatoires.' using errcode = '22023';
  end if;
  insert into prive.budget_reclassements as r (user_id, verrou_jusqua) values (p_user, now() + make_interval(secs => p_secondes))
  on conflict (user_id) do update set verrou_jusqua = excluded.verrou_jusqua where r.verrou_jusqua <= now()
  returning true into v_pris;
  return coalesce(v_pris, false);
end;
$$;
revoke all on function public.budget_reclasser_verrouiller(uuid, int) from public, anon, authenticated;
grant execute on function public.budget_reclasser_verrouiller(uuid, int) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. service_role : droits explicites sur les objets de cette migration (0033 § 8 : plus d'exposition automatique)
-- ---------------------------------------------------------------------------------------------------------------------------------
grant execute on function public.export_all() to service_role;
