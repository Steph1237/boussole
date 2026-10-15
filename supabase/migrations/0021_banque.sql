-- Boussole : banque, connexion des comptes par Powens (BQ1, docs/superpowers/specs/2026-10-12-bq1-powens-design.md § 3).
-- Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "banque").
--   fonctionnalites       : interrupteurs par utilisateur (clé « banque » en BQ1) ; lecture par le propriétaire, aucune écriture
--                           de l'app (activés par le service, execute_sql).
--   prive.powens_utilisateurs : schéma non exposé ; utilisateur Powens permanent, empreinte SHA-256 du jeton (pour reconnaître
--                           l'utilisateur d'une notification) et identifiant du secret Vault qui garde le jeton. Jamais lu par
--                           l'app ni par Claude : seules les fonctions powens_* (service_role) y accèdent.
--   banque_connexions / banque_comptes / banque_placements / banque_operations / banque_mois : données lues chez Powens,
--                           écrites par la fonction serveur `powens` (clé de service) ; RLS propriétaire, lecture seule pour
--                           authenticated, sauf les 5 colonnes de rattachement de banque_comptes (position_id, enveloppe,
--                           titulaire, credit_id, ignore), contrôlées par le déclencheur banque_comptes_rattachement.
--   prive.powens_a_supprimer : utilisateurs Powens à supprimer chez Powens (compte Boussole supprimé par delete_me sans passer
--                           par powens/supprimer) ; vidée par powens/nuit (DELETE users/me, puis secret et ligne supprimés).
--   positions             : + source_auto ('powens') et source_auto_le (ligne alimentée par la synchronisation).
--   Fonctions (security definer, service_role seulement, search_path vide) : powens_enregistrer, powens_jeton,
--                           powens_utilisateur_par_empreinte, powens_oublier, powens_a_supprimer_lister, powens_a_supprimer_fait,
--                           banque_verrouiller, banque_deverrouiller, banque_recalculer_mois, banque_purger, check_powens_nuit_token.
--   Planification         : boussole-powens-nuit, tous les jours à 00:00 UTC (2 h à Paris en heure d'été, 1 h en hiver),
--                           pg_cron → pg_net → Edge Function powens/nuit, jeton powens_nuit_token lu dans Vault à l'appel ;
--                           boussole-banque-purge, tous les jours à 00:30 UTC, select public.banque_purger(90) (purge du détail
--                           même si la fonction serveur est en panne).
--   export_all()          : + fonctionnalites et tables banque_* (repart de 0020_routines.sql, seule définition depuis).
--   delete_me()           : inchangée ; toutes les nouvelles tables cascadent sur auth.users. Le déclencheur
--                           powens_utilisateurs_oubli range l'utilisateur Powens dans prive.powens_a_supprimer (user_id null) avec son
--                           secret, que powens/nuit utilise pour le supprimer chez Powens puis efface (aucun secret orphelin durable).
--   propositions          : inchangée. La fonction powens y dépose des créations de ligne (cible 'position', operation
--                           'creer', user_id explicite). Attention : propositions.lot est un uuid (0007).
--   Prérequis : public.contenu_sensible (0009), Vault, pg_cron, pg_net, pgcrypto (extensions.digest).
--   Tests (test/banque-pglite.test.mjs) : PGlite avec bouchons de Vault, pg_cron, pg_net et pgcrypto (test/helpers/pglite.mjs,
--                           baseComplete) ; les blocs Vault et cron ci-dessous n'utilisent que ce que ces bouchons fournissent
--                           (vault.secrets, vault.decrypted_secrets, vault.create_secret, cron.job, cron.schedule,
--                           cron.unschedule, net.http_post).
--   Vault : postgres a DELETE sur vault.secrets (vérifié en production) ; le déclencheur d'oubli rattrape quand même
--                           insufficient_privilege pour ne jamais bloquer delete_me.

-- ---------------------------------------------------------------------------
-- Interrupteurs par utilisateur
-- ---------------------------------------------------------------------------
create table public.fonctionnalites (
  user_id uuid not null references auth.users(id) on delete cascade,
  cle     text not null constraint fonctionnalites_cle check (cle in ('banque')),
  active  boolean not null default false,
  maj_le  timestamptz default now(),
  primary key (user_id, cle)
);

alter table public.fonctionnalites enable row level security;
create policy "fonctionnalites: select" on public.fonctionnalites for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.fonctionnalites from public, anon, authenticated;
grant select on table public.fonctionnalites to authenticated;
grant select, insert, update, delete on table public.fonctionnalites to service_role;

-- ---------------------------------------------------------------------------
-- Schéma privé : utilisateurs Powens (jeton dans Vault, empreinte ici)
-- ---------------------------------------------------------------------------
create schema if not exists prive;
revoke all on schema prive from public, anon, authenticated;

create table prive.powens_utilisateurs (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  powens_user_id  bigint not null,
  empreinte_jeton text not null unique,
  secret_id       uuid not null,
  cree_le         timestamptz default now()
);
revoke all on table prive.powens_utilisateurs from public, anon, authenticated;

-- Utilisateurs Powens à supprimer chez Powens : compte Boussole supprimé (cascade de delete_me) sans passer par
-- powens/supprimer. Pas de clé étrangère : user_id est null (le compte n'existe plus) ; secret_id garde le jeton, seul moyen
-- d'appeler DELETE /users/me. Vidée par powens/nuit (powens_a_supprimer_lister, puis powens_a_supprimer_fait).
create table prive.powens_a_supprimer (
  id             bigint generated always as identity primary key,
  user_id        uuid,
  powens_user_id bigint not null,
  secret_id      uuid not null,
  cree_le        timestamptz not null default now()
);
revoke all on table prive.powens_a_supprimer from public, anon, authenticated;

-- Ligne supprimée :
-- - par powens_oublier (réglage local boussole.powens_oubli = 'on') : le secret Vault part avec elle ;
-- - autrement (cascade de delete_me sur auth.users) : l'utilisateur Powens n'a pas été supprimé chez Powens ; il est rangé dans
--   prive.powens_a_supprimer avec son secret (gardé), user_id null si le compte Boussole n'existe plus.
-- Un refus d'accès à Vault (insufficient_privilege) est rattrapé : delete_me n'est jamais bloqué.
create or replace function prive.powens_utilisateurs_oubli()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('boussole.powens_oubli', true), '') = 'on' then
    begin
      delete from vault.secrets s where s.id = old.secret_id;
    exception when insufficient_privilege then
      raise warning 'powens : secret Vault non supprimé (droits insuffisants)';
    end;
  else
    insert into prive.powens_a_supprimer (user_id, powens_user_id, secret_id)
    values ((select a.id from auth.users a where a.id = old.user_id), old.powens_user_id, old.secret_id);
  end if;
  return old;
end;
$$;
revoke all on function prive.powens_utilisateurs_oubli() from public, anon, authenticated;
create trigger powens_utilisateurs_oubli after delete on prive.powens_utilisateurs
  for each row execute function prive.powens_utilisateurs_oubli();

-- ---------------------------------------------------------------------------
-- Connexions, comptes, placements, opérations, totaux mensuels (identifiants Powens ; clé (user_id, id))
-- ---------------------------------------------------------------------------
create table public.banque_connexions (
  id               bigint not null,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  etablissement    text,
  -- null = à jour ; sinon l'état Powens tel quel (la fonction powens ramène un état inconnu à l'un de ceux-ci)
  etat             text constraint banque_connexions_etat check (etat is null or etat in ('SCARequired', 'webauthRequired',
                     'additionalInformationNeeded', 'wrongpass', 'decoupled', 'validating', 'actionNeeded', 'passwordExpired',
                     'rateLimiting', 'websiteUnavailable', 'bug')),
  message          text,
  derniere_synchro timestamptz,
  -- bail de synchronisation (banque_verrouiller) : une seule synchronisation à la fois par (utilisateur, connexion)
  verrou_jusqua    timestamptz,
  cree_le          timestamptz not null default now(),
  maj_le           timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.banque_comptes (
  id           bigint not null,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  connexion_id bigint not null,
  nom          text,
  type         text constraint banque_comptes_type check (type in ('courant', 'livret', 'pea', 'compte_titres', 'assurance_vie', 'per', 'credit', 'autre')),
  -- carte à débit différé (type Powens « card ») : ses opérations sont exclues des totaux si un compte courant de la même
  -- connexion existe (le relevé mensuel y est déjà débité)
  debit_differe boolean not null default false,
  solde        numeric,
  devise       text,
  solde_le     date,
  actif        boolean not null default true,
  -- rattachement (seules colonnes modifiables par l'utilisateur) : une ligne, OU une enveloppe et son titulaire, et/ou un crédit
  -- (compte de type credit seulement) ; ou ignore = true (compte écarté : aucun rattachement, aucune proposition)
  position_id  uuid references public.positions(id) on delete set null,
  enveloppe    text constraint banque_comptes_enveloppe check (char_length(enveloppe) <= 100),
  titulaire    text constraint banque_comptes_titulaire check (titulaire in ('p1', 'p2')),
  credit_id    uuid references public.credits(id) on delete set null,
  ignore       boolean not null default false,
  -- proposition de création de ligne déposée pour ce compte (une seule fois, même si elle est ensuite supprimée)
  propose_le   timestamptz,
  maj_le       timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, connexion_id) references public.banque_connexions(user_id, id) on delete cascade
);
create index banque_comptes_connexion_idx on public.banque_comptes (user_id, connexion_id);

create table public.banque_placements (
  id           bigint not null,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  compte_id    bigint not null,
  isin         text,
  libelle      text,
  quantite     numeric,
  valeur       numeric,
  prix_revient numeric,
  position_id  uuid references public.positions(id) on delete set null,
  -- ligne de marché déjà créée pour ce placement : si position_id redevient null (ligne supprimée par l'utilisateur), elle
  -- n'est pas recréée
  ligne_creee_le timestamptz,
  maj_le       timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, compte_id) references public.banque_comptes(user_id, id) on delete cascade
);
create index banque_placements_compte_idx on public.banque_placements (user_id, compte_id);

create table public.banque_operations (
  id        bigint not null,
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  compte_id bigint not null,
  date      date not null,
  montant   numeric not null,
  libelle   text,
  categorie text,
  primary key (user_id, id),
  foreign key (user_id, compte_id) references public.banque_comptes(user_id, id) on delete cascade,
  -- Contrainte nommée : même filtre que memoire_agent, journal et routines (0009) ; le libellé est nettoyé avant (fonction powens)
  constraint banque_operations_contenu_sensible check (not public.contenu_sensible(libelle))
);
create index banque_operations_date_idx on public.banque_operations (user_id, date desc);
create index banque_operations_compte_idx on public.banque_operations (user_id, compte_id);

create table public.banque_mois (
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mois      date not null constraint banque_mois_mois check (mois = date_trunc('month', mois)::date),
  categorie text not null,
  entrees   numeric not null default 0,
  sorties   numeric not null default 0,
  nombre    int not null default 0,
  primary key (user_id, mois, categorie)
);

-- RLS propriétaire ; lecture seule pour authenticated ; écritures par le service (clé de service, BYPASSRLS)
alter table public.banque_connexions enable row level security;
alter table public.banque_comptes    enable row level security;
alter table public.banque_placements enable row level security;
alter table public.banque_operations enable row level security;
alter table public.banque_mois       enable row level security;
create policy "banque_connexions: select" on public.banque_connexions for select to authenticated using ((select auth.uid()) = user_id);
create policy "banque_comptes: select"    on public.banque_comptes    for select to authenticated using ((select auth.uid()) = user_id);
create policy "banque_comptes: update"    on public.banque_comptes    for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "banque_placements: select" on public.banque_placements for select to authenticated using ((select auth.uid()) = user_id);
create policy "banque_operations: select" on public.banque_operations for select to authenticated using ((select auth.uid()) = user_id);
create policy "banque_mois: select"       on public.banque_mois       for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.banque_connexions, public.banque_comptes, public.banque_placements, public.banque_operations, public.banque_mois
  from public, anon, authenticated;
grant select on table public.banque_connexions, public.banque_comptes, public.banque_placements, public.banque_operations, public.banque_mois
  to authenticated;
-- Exception : rattachement d'un compte (Compte › Connexion)
grant update (position_id, enveloppe, titulaire, credit_id, ignore) on public.banque_comptes to authenticated;
grant select, insert, update, delete on table public.banque_connexions, public.banque_comptes, public.banque_placements,
  public.banque_operations, public.banque_mois to service_role;

-- ---------------------------------------------------------------------------
-- maj_le tenu à jour (connexions, comptes, placements)
-- ---------------------------------------------------------------------------
create or replace function public.banque_maj_le()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.maj_le := now();
  return new;
end;
$$;
revoke all on function public.banque_maj_le() from public, anon, authenticated;
create trigger banque_connexions_maj before update on public.banque_connexions for each row execute function public.banque_maj_le();
create trigger banque_comptes_maj    before update on public.banque_comptes    for each row execute function public.banque_maj_le();
create trigger banque_placements_maj before update on public.banque_placements for each row execute function public.banque_maj_le();

-- ---------------------------------------------------------------------------
-- Rattachement d'un compte : la ligne et le crédit doivent appartenir au propriétaire du compte (user_id de la ligne, que
-- l'écriture vienne de l'app ou du service) ; une ligne et une enveloppe ensemble sont refusées ; une enveloppe vide ou
-- blanche devient null ; un crédit ne se rattache qu'à un compte de type credit (un compte qui cesse d'être un crédit, type
-- changé par la synchronisation, en est détaché sans erreur) ; ignore = true efface les 4 rattachements.
-- Security invoker : lectures filtrées explicitement par user_id.
-- ---------------------------------------------------------------------------
create or replace function public.banque_comptes_rattachement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.enveloppe := nullif(btrim(new.enveloppe), '');
  if new.ignore then
    new.position_id := null; new.enveloppe := null; new.titulaire := null; new.credit_id := null;
    return new;
  end if;
  if new.credit_id is not null and new.type is distinct from 'credit' then
    if tg_op = 'UPDATE' and new.credit_id is not distinct from old.credit_id then
      new.credit_id := null;
    else
      raise exception 'Rattachement invalide : un crédit se rattache seulement à un compte de crédit.' using errcode = '22023';
    end if;
  end if;
  if new.position_id is not null and new.enveloppe is not null then
    raise exception 'Rattachement invalide : un compte se rattache à une ligne ou à une enveloppe, pas aux deux.' using errcode = '22023';
  end if;
  if new.position_id is not null
     and not exists (select 1 from public.positions p where p.id = new.position_id and p.user_id = new.user_id) then
    raise exception 'Ligne introuvable : choisis une de tes lignes.' using errcode = '22023';
  end if;
  if new.credit_id is not null
     and not exists (select 1 from public.credits c where c.id = new.credit_id and c.user_id = new.user_id) then
    raise exception 'Crédit introuvable : choisis un de tes crédits.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.banque_comptes_rattachement() from public, anon, authenticated;
create trigger banque_comptes_rattachement before insert or update on public.banque_comptes
  for each row execute function public.banque_comptes_rattachement();

-- ---------------------------------------------------------------------------
-- Lignes alimentées par la synchronisation
-- ---------------------------------------------------------------------------
alter table public.positions
  add column source_auto    text constraint positions_source_auto check (source_auto in ('powens')),
  add column source_auto_le timestamptz;

-- ---------------------------------------------------------------------------
-- Jeton Powens permanent de chaque utilisateur (Vault) : enregistrer, lire, retrouver par empreinte, oublier.
-- Langage plpgsql : corps résolus à l'exécution (vault et pgcrypto peuvent manquer à la création dans les bases de test).
-- ---------------------------------------------------------------------------
-- powens_enregistrer : enregistre l'utilisateur Powens (secret Vault + ligne prive) et renvoie true ; s'il l'est déjà (double
-- clic sur Connecter, deux /powens/connecter simultanés), ne touche à rien et renvoie false : l'appelant supprime alors chez
-- Powens l'utilisateur qu'il vient de créer et reprend le jeton enregistré. Verrou consultatif par utilisateur (les appels
-- concurrents s'attendent) + on conflict do nothing. Un réenregistrement voulu (jeton invalide) passe par powens_oublier.
-- Empreinte = SHA-256 hexadécimal du jeton.
create or replace function public.powens_enregistrer(p_user uuid, p_powens_user_id bigint, p_jeton text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
  n        int;
begin
  if p_user is null then
    raise exception 'Utilisateur manquant.' using errcode = '22023';
  end if;
  if p_powens_user_id is null then
    raise exception 'Identifiant Powens manquant.' using errcode = '22023';
  end if;
  if p_jeton is null or btrim(p_jeton) = '' then
    raise exception 'Jeton Powens manquant.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  if exists (select 1 from prive.powens_utilisateurs u where u.user_id = p_user) then
    return false;
  end if;
  -- secret au nom de l'utilisateur laissé par un enregistrement interrompu : remplacé
  delete from vault.secrets s where s.name = 'powens_jeton_' || p_user::text
    and not exists (select 1 from prive.powens_a_supprimer a where a.secret_id = s.id);
  v_secret := vault.create_secret(p_jeton, 'powens_jeton_' || p_user::text, 'Jeton Powens permanent d''un utilisateur Boussole');
  insert into prive.powens_utilisateurs (user_id, powens_user_id, empreinte_jeton, secret_id)
  values (p_user, p_powens_user_id, encode(extensions.digest(p_jeton, 'sha256'), 'hex'), v_secret)
  on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    delete from vault.secrets s where s.id = v_secret;
    return false;
  end if;
  return true;
end;
$$;

-- powens_jeton : jeton en clair (null si l'utilisateur n'a pas de compte Powens). Jamais renvoyé à l'app ni à Claude.
create or replace function public.powens_jeton(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_jeton text;
begin
  select s.decrypted_secret into v_jeton
    from prive.powens_utilisateurs u
    join vault.decrypted_secrets s on s.id = u.secret_id
   where u.user_id = p_user;
  return v_jeton;
end;
$$;

-- powens_utilisateur_par_empreinte : utilisateur d'une notification (empreinte du jeton Bearer reçu), null si inconnu.
create or replace function public.powens_utilisateur_par_empreinte(p_empreinte text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select u.user_id into v_user from prive.powens_utilisateurs u where u.empreinte_jeton = lower(btrim(p_empreinte));
  return v_user;
end;
$$;

-- powens_oublier (chemin normal : utilisateur supprimé chez Powens, ou jeton invalide) : ligne prive et secret Vault supprimés
-- (réglage local boussole.powens_oubli lu par le déclencheur powens_utilisateurs_oubli). Sans compte : rien.
create or replace function public.powens_oublier(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('boussole.powens_oubli', 'on', true);
  delete from prive.powens_utilisateurs u where u.user_id = p_user;
  perform set_config('boussole.powens_oubli', '', true);
end;
$$;

-- powens_a_supprimer_lister(limite) : utilisateurs Powens à supprimer chez Powens, avec leur jeton (null si le secret a
-- disparu), les plus anciens d'abord. Jamais renvoyé à l'app ni à Claude.
create or replace function public.powens_a_supprimer_lister(p_limite int default 50)
returns table (id bigint, powens_user_id bigint, jeton text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select a.id, a.powens_user_id, s.decrypted_secret
      from prive.powens_a_supprimer a
      left join vault.decrypted_secrets s on s.id = a.secret_id
     order by a.id
     limit greatest(1, least(coalesce(p_limite, 50), 500));
end;
$$;

-- powens_a_supprimer_fait(id) : utilisateur supprimé chez Powens (ou déjà parti) → secret Vault et ligne supprimés. Idempotent.
create or replace function public.powens_a_supprimer_fait(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
begin
  delete from prive.powens_a_supprimer a where a.id = p_id returning a.secret_id into v_secret;
  if v_secret is not null then
    delete from vault.secrets s where s.id = v_secret;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- banque_verrouiller(user, connexion, secondes) : bail de synchronisation (2 min par défaut) ; true si pris, false si une autre
-- synchronisation le tient encore. La ligne de connexion est créée si besoin (première synchronisation). Atomique :
-- insert … on conflict do update … where (bail absent ou expiré). banque_deverrouiller le libère à la fin.
-- ---------------------------------------------------------------------------
create or replace function public.banque_verrouiller(p_user uuid, p_connexion bigint, p_secondes int default 120)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if p_user is null or p_connexion is null then
    raise exception 'Utilisateur et connexion obligatoires.' using errcode = '22023';
  end if;
  insert into public.banque_connexions as c (id, user_id, verrou_jusqua)
  values (p_connexion, p_user, now() + make_interval(secs => greatest(1, least(coalesce(p_secondes, 120), 600))))
  on conflict (user_id, id) do update set verrou_jusqua = excluded.verrou_jusqua
    where c.verrou_jusqua is null or c.verrou_jusqua < now();
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

create or replace function public.banque_deverrouiller(p_user uuid, p_connexion bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.banque_connexions c set verrou_jusqua = null where c.user_id = p_user and c.id = p_connexion;
end;
$$;

-- ---------------------------------------------------------------------------
-- banque_recalculer_mois(user, depuis) : totaux de banque_mois recalculés depuis banque_operations pour les mois ≥ depuis
-- (mois de depuis inclus) : montant > 0 → entrees, montant < 0 → sorties (valeur absolue), nombre d'opérations ; catégorie
-- absente → « divers ». Les lignes de ces mois sont remplacées (une catégorie disparue s'efface).
-- Double compte évité : les opérations d'une carte à débit différé (banque_comptes.debit_differe) sont exclues des totaux
-- (entrées comme sorties) quand un compte courant sans débit différé existe dans la même connexion : le relevé mensuel de la
-- carte y est déjà débité. Les virements entre comptes du foyer (catégories Powens from_own_account, to_own_account, savings)
-- sont rangés en « epargne » par la fonction powens (categories.ts) : jamais comptés en dépense.
-- Verrou consultatif par utilisateur : deux synchronisations simultanées (deux connexions) ne se marchent pas dessus.
-- Garde-fou : un mois dont le 1er jour a plus de 90 jours (date de Paris) n'est jamais recalculé. Ses opérations les plus
-- anciennes sont purgées (banque_purger, 90 jours) ou n'ont jamais été lues (Powens : 90 jours) ; le recalculer écraserait un
-- total complet par un total partiel. Le premier mois, entamé à la première synchronisation, reste donc sans total.
-- ---------------------------------------------------------------------------
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
  insert into public.banque_mois (user_id, mois, categorie, entrees, sorties, nombre)
  select p_user,
         date_trunc('month', o.date)::date,
         coalesce(nullif(btrim(o.categorie), ''), 'divers'),
         coalesce(sum(o.montant) filter (where o.montant > 0), 0),
         coalesce(-sum(o.montant) filter (where o.montant < 0), 0),
         count(*)::int
    from public.banque_operations o
    join public.banque_comptes k on k.user_id = o.user_id and k.id = o.compte_id
   where o.user_id = p_user and o.date >= v_debut
     and not (k.debit_differe and exists (
           select 1 from public.banque_comptes k2
            where k2.user_id = k.user_id and k2.connexion_id = k.connexion_id and k2.type = 'courant' and not k2.debit_differe))
   group by 2, 3;
end;
$$;

-- ---------------------------------------------------------------------------
-- banque_purger(jours) : opérations de plus de p_jours (date < aujourd'hui à Paris − p_jours) supprimées, tous utilisateurs ;
-- renvoie leur nombre. Les totaux de banque_mois restent.
-- ---------------------------------------------------------------------------
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
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Jeton d'appel de powens/nuit (Vault), même mécanisme que nightly_token (0003)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'powens_nuit_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'powens_nuit_token',
      'Jeton d''appel de la nuit Powens'
    );
  end if;
end;
$$;

create or replace function public.check_powens_nuit_token(p text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p, '') <> ''
     and exists (
       select 1 from vault.decrypted_secrets s
       where s.name = 'powens_nuit_token' and s.decrypted_secret = p
     );
$$;

-- ---------------------------------------------------------------------------
-- Privilèges des fonctions : rôle service uniquement
-- ---------------------------------------------------------------------------
revoke all on function public.powens_enregistrer(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.powens_jeton(uuid) from public, anon, authenticated;
revoke all on function public.powens_utilisateur_par_empreinte(text) from public, anon, authenticated;
revoke all on function public.powens_oublier(uuid) from public, anon, authenticated;
revoke all on function public.powens_a_supprimer_lister(int) from public, anon, authenticated;
revoke all on function public.powens_a_supprimer_fait(bigint) from public, anon, authenticated;
revoke all on function public.banque_verrouiller(uuid, bigint, int) from public, anon, authenticated;
revoke all on function public.banque_deverrouiller(uuid, bigint) from public, anon, authenticated;
revoke all on function public.banque_recalculer_mois(uuid, date) from public, anon, authenticated;
revoke all on function public.banque_purger(int) from public, anon, authenticated;
revoke all on function public.check_powens_nuit_token(text) from public, anon, authenticated;

grant execute on function public.powens_enregistrer(uuid, bigint, text) to service_role;
grant execute on function public.powens_jeton(uuid) to service_role;
grant execute on function public.powens_utilisateur_par_empreinte(text) to service_role;
grant execute on function public.powens_oublier(uuid) to service_role;
grant execute on function public.powens_a_supprimer_lister(int) to service_role;
grant execute on function public.powens_a_supprimer_fait(bigint) to service_role;
grant execute on function public.banque_verrouiller(uuid, bigint, int) to service_role;
grant execute on function public.banque_deverrouiller(uuid, bigint) to service_role;
grant execute on function public.banque_recalculer_mois(uuid, date) to service_role;
grant execute on function public.banque_purger(int) to service_role;
grant execute on function public.check_powens_nuit_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- Planification : tous les jours à 00:00 UTC
--   = 02:00 Europe/Paris en heure d'été (UTC+2), 01:00 en heure d'hiver (UTC+1).
-- pg_cron raisonne en UTC ; le jeton est lu dans Vault au moment de l'appel.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'boussole-powens-nuit') then
    perform cron.unschedule('boussole-powens-nuit');
  end if;
end;
$$;

select cron.schedule(
  'boussole-powens-nuit',
  '0 0 * * *',
  $cron$
  select net.http_post(
    url := 'https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/powens/nuit',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'powens_nuit_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $cron$
);

-- Purge du détail de plus de 90 jours : tâche SQL séparée, à 00:30 UTC (powens/nuit purge aussi en premier ; idempotent).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'boussole-banque-purge') then
    perform cron.unschedule('boussole-banque-purge');
  end if;
end;
$$;

select cron.schedule('boussole-banque-purge', '30 0 * * *', $cron$ select public.banque_purger(90); $cron$);

-- ---------------------------------------------------------------------------
-- export_all() : + fonctionnalites et tables banque_* (repart de 0020_routines.sql, seule définition depuis)
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
    'banque_mois',       (select coalesce(jsonb_agg(to_jsonb(bm) order by bm.mois, bm.categorie), '[]') from public.banque_mois bm where bm.user_id = auth.uid())
  );
$$;
revoke all on function public.export_all() from public, anon;
grant execute on function public.export_all() to authenticated;
