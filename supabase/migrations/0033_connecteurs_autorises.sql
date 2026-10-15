-- Boussole : autorisation du connecteur liée au second facteur (SEC2 bis, docs/superpowers/specs/2026-10-14-sec2-mfa-design.md,
-- « Connecteur MCP : autorisation liée au second facteur »), et droits explicites de service_role.
-- Non appliquée : à appliquer avec apply_migration (name = "connecteurs_autorises") sur le projet oapcewpqsbbjdlcdeizi, après 0032 (suivi),
-- AVANT le déploiement de la fonction mcp (garde : lier_connecteur) et de l'app (page de consentement : autoriser_connecteur ; Compte ›
-- Connexion : liste et retrait). Sans elle, la page de consentement d'un compte à double authentification échoue proprement (« Autorisation
-- impossible ») et le connecteur garde son message « Double authentification requise » : rien ne s'ouvre en plus.
--
-- Constat (préproduction locale, GoTrue v2.190.0, SEC5 § 3.12) : un jeton d'accès OAuth est TOUJOURS aal1 (amr
-- oauth_provider/authorization_code), même quand la session qui approuve le consentement est aal2. Avec 0028, un compte à facteur vérifié
-- ne pouvait donc rien lire par le connecteur. Le jeton porte client_id (uuid du client OAuth) et session_id (session OAuth neuve, ouverte
-- par GoTrue à l'échange du code ; conservée au rafraîchissement). GoTrue supprime la demande d'autorisation (auth.oauth_authorizations)
-- à l'échange de son code.
--
-- 1. public.connecteurs_autorises : une autorisation par (utilisateur, client OAuth) active à la fois, accordée par une session aal2,
--    valable 90 jours, révocable, liée à UNE session OAuth. Écrite seulement par les fonctions ci-dessous (aucun droit d'écriture pour
--    authenticated) ; lisible par son propriétaire (colonnes affichées dans Compte › Connexion et user_id, sans session_id ni autorisation_id).
-- 2. autoriser_connecteur(authorization_id) : security definer. Exige (select auth.jwt())->>'aal' = 'aal2' de la session APPELANTE (la page
--    de consentement l'appelle juste après le code à 6 chiffres, avant d'approuver) et refuse tout jeton qui porte un client_id (un
--    connecteur ne s'autorise pas lui-même). Le client n'est PAS fourni par l'appelant : il est lu dans la demande d'autorisation de
--    GoTrue (auth.oauth_authorizations : à l'appelant, en attente ou approuvée, non expirée), nom lu dans auth.oauth_clients. Exige un
--    code FRAIS : revendication amr « totp » de moins de 10 minutes (BOU02 sinon), et un client DÉCLARÉ par l'administrateur
--    (auth.oauth_clients.registration_type = manual, non supprimé ; BOU01 sinon) : un client inscrit tout seul (enregistrement dynamique)
--    pourrait se nommer « Claude » et hameçonner un consentement de 90 jours. Révoque l'autorisation précédente du même client.
--    20 autorisations actives au plus par utilisateur.
-- 3. lier_connecteur() : security definer, appelée par le connecteur à chaque requête d'un compte à facteur (garde-mfa.ts). Lit client_id et
--    session_id dans le jeton signé (jamais en paramètre). Si l'autorisation n'est pas encore liée, elle se lie à la session du jeton
--    seulement si : la demande d'autorisation a disparu (son code a été échangé), la session est une session OAuth de ce client pour cet
--    utilisateur, ouverte après l'autorisation et avant l'expiration de la demande, dans les 15 minutes, et c'est la SEULE session OAuth
--    de ce client ouverte depuis l'autorisation (sinon « ambigu » : rien n'est lié, l'utilisateur reconnecte). Ensuite, seule cette
--    session est acceptée. Réponses : autorise, sans_client, sans_facteur, absente, revoquee, expiree, autre_session, hors_delai,
--    en_attente, ambigu, non_liee. Plus aucun facteur vérifié, ou facteur de l'autorisation retiré (seuls des facteurs plus récents
--    restent) : les autorisations sont révoquées (revoque_le) et ne revivent pas à la réinscription.
-- 4. connecteur_autorise() : security definer, stable ; vrai si le jeton (client_id, session_id) correspond à une autorisation liée, non
--    révoquée, non expirée, de auth.uid(), dont la session OAuth existe encore (déconnexion ou révocation chez Supabase : fermé tout de
--    suite), et si un facteur vérifié ANTÉRIEUR à l'autorisation existe encore (facteur retiré par le support : fermé ; réinscription : fermé).
-- 5. revoquer_connecteur(client_id) : security definer ; révoque les autorisations actives de auth.uid() pour ce client, à tout niveau
--    (retirer un accès ne fait que fermer).
-- 6. Politiques (alter policy, mêmes noms ; aucune n'est retirée) :
--    - « <table>: aal2 si facteur » (toutes les tables personnelles hors banque_*) : aal2, OU pas de facteur vérifié, OU connecteur
--      autorisé, en lecture comme en écriture (le connecteur dépose propositions, mémoire, journal… comme avant 0028) ;
--    - « banque_*: aal2 » : lecture par aal2 OU connecteur autorisé ; écriture (with check) aal2 ET aucun client_id dans le jeton (même
--      si GoTrue émettait un jour des jetons OAuth aal2) ; nouvelle politique restrictive « banque_*: suppression aal2 » (for delete, même
--      condition). Le connecteur ne fait que lire la banque ; seules l'app (aal2) et le service écrivent ;
--    - connecteurs_autorises : « aal2 si facteur » SANS le cas connecteur (un connecteur ne lit pas ses propres autorisations).
--    Toutes écrites avec (select auth.jwt()) : corrige les 24 avertissements auth_rls_initplan du conseiller de base (SEC5 § 3.12).
-- 7. delete_me() (0001) et export_all() (0031) recréées à l'identique avec des gardes : jamais par un jeton OAuth (client_id, 42501) ;
--    delete_me exige aal2 pour un compte à facteur ; export_all exporte aussi connecteurs_autorises (colonnes visibles).
-- 8. service_role : droits explicites sur toutes les tables, séquences et fonctions de public, et privilèges par défaut pour les objets
--    futurs (l'exposition automatique, api.auto_expose_new_tables du CLI, disparaît le 2026-10-30). anon et authenticated : inchangés.
--
-- Repli interdit (toujours) : laisser passer un jeton OAuth sur son seul client_id, sans autorisation. approveAuthorization n'exige
-- qu'une session aal1 : un mot de passe volé suffit pour obtenir un jeton OAuth de n'importe quel client public (redirection de
-- bouclage, ou le même client que Claude). Ici, l'autorisation exige la preuve aal2 côté serveur (pas seulement dans consent.js), et
-- même avec une autorisation existante, un jeton obtenu par l'attaquant porte une autre session_id : refusé.
-- Prérequis : auth.jwt(), auth.uid(), auth.mfa_factors, auth.sessions (oauth_client_id), auth.oauth_authorizations, auth.oauth_clients
-- (GoTrue avec serveur OAuth 2.1). Tests : test/connecteur-autorise-pglite.test.mjs (PGlite), test/mfa-pglite.test.mjs.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.connecteurs_autorises (
  id                     bigint generated always as identity primary key,
  user_id                uuid not null references auth.users(id) on delete cascade,
  client_id              text not null check (char_length(client_id) between 1 and 200),
  client_nom             text check (client_nom is null or char_length(client_nom) <= 100),
  autorisation_id        text not null check (char_length(autorisation_id) between 1 and 200),
  autorisation_expire_le timestamptz not null,
  accorde_aal            text not null check (accorde_aal = 'aal2'),
  accorde_le             timestamptz not null default now(),
  expire_le              timestamptz not null,
  session_id             uuid,
  lie_le                 timestamptz,
  dernier_usage          timestamptz,
  revoque_le             timestamptz,
  constraint connecteurs_autorises_duree check (expire_le > accorde_le),
  constraint connecteurs_autorises_liaison check ((session_id is null) = (lie_le is null))
);
create unique index connecteurs_autorises_actif on public.connecteurs_autorises (user_id, client_id) where revoque_le is null;

alter table public.connecteurs_autorises enable row level security;
create policy "connecteurs_autorises: select" on public.connecteurs_autorises for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "connecteurs_autorises: aal2 si facteur" on public.connecteurs_autorises as restrictive for all to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()));

revoke all on table public.connecteurs_autorises from public, anon, authenticated;
revoke all on sequence public.connecteurs_autorises_id_seq from public, anon, authenticated;
grant select (id, user_id, client_id, client_nom, accorde_le, expire_le, lie_le, dernier_usage, revoque_le) on table public.connecteurs_autorises to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. autoriser_connecteur(authorization_id) : seulement depuis une session aal2 (page de consentement, après le code)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.autoriser_connecteur(p_autorisation_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_jwt    jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_duree  constant interval := interval '90 days';   -- durée d'une autorisation (affichée par la page de consentement)
  v_max    constant int := 20;                         -- autorisations actives au plus par utilisateur
  v_frais  constant int := 600;                        -- le code doit dater de 10 minutes au plus (secondes)
  v_client text;
  v_nom    text;
  v_reg    text;
  v_suppr  timestamptz;
  v_exp    timestamptz;
  v_ligne  public.connecteurs_autorises;
begin
  if v_uid is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  if nullif(v_jwt->>'client_id', '') is not null then
    raise exception 'Un connecteur ne peut pas s''autoriser lui-même : autorise-le depuis la page de consentement de Boussole.' using errcode = '42501';
  end if;
  if coalesce(v_jwt->>'aal', '') <> 'aal2' or not public.mfa_exigee() then
    raise exception 'Double authentification requise : valide ton code à 6 chiffres avant d''autoriser un connecteur.' using errcode = '42501';
  end if;
  -- code frais : la revendication amr (GoTrue) porte l'instant du dernier code TOTP validé ; une session aal2 ancienne ne suffit pas
  if not exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(v_jwt->'amr') = 'array' then v_jwt->'amr' else '[]'::jsonb end) e
     where e->>'method' = 'totp' and (e->>'timestamp') ~ '^[0-9]+(\.[0-9]+)?$'
       and (e->>'timestamp')::numeric >= extract(epoch from now()) - v_frais
  ) then
    raise exception 'Valide de nouveau ton code à 6 chiffres : il doit dater de moins de 10 minutes pour autoriser un connecteur.' using errcode = 'BOU02';
  end if;

  select a.client_id::text, a.expires_at, c.client_name, c.registration_type::text, c.deleted_at
    into v_client, v_exp, v_nom, v_reg, v_suppr
    from auth.oauth_authorizations a
    left join auth.oauth_clients c on c.id = a.client_id
   where a.authorization_id = p_autorisation_id
     and a.user_id = v_uid
     and a.status::text in ('pending', 'approved')
     and a.expires_at > now();
  if v_client is null then
    raise exception 'Demande d''autorisation introuvable ou expirée : relance la connexion du connecteur depuis Claude.' using errcode = 'P0002';
  end if;
  -- seul un client déclaré par l'administrateur (registration_type = manual, non supprimé) reçoit une autorisation : un client inscrit
  -- tout seul (enregistrement dynamique) pourrait se nommer « Claude » et hameçonner un consentement de 90 jours
  if v_reg is distinct from 'manual' or v_suppr is not null then
    raise exception 'Cette application n''est pas autorisée à recevoir un accès protégé par ton code : seuls les connecteurs déclarés par Boussole le peuvent.' using errcode = 'BOU01';
  end if;

  update public.connecteurs_autorises
     set revoque_le = now()
   where user_id = v_uid and client_id = v_client and revoque_le is null;
  if (select count(*) from public.connecteurs_autorises g where g.user_id = v_uid and g.revoque_le is null and g.expire_le > now()) >= v_max then
    raise exception 'Trop de connecteurs autorisés : retires-en un dans Boussole › Compte › Connexion.' using errcode = '54000';
  end if;
  -- historique borné : les autorisations terminées depuis plus d'un an disparaissent
  delete from public.connecteurs_autorises
   where user_id = v_uid and coalesce(revoque_le, expire_le) < now() - interval '1 year';

  insert into public.connecteurs_autorises (user_id, client_id, client_nom, autorisation_id, autorisation_expire_le, accorde_aal, expire_le)
  values (v_uid, v_client, left(nullif(btrim(v_nom), ''), 100), p_autorisation_id, v_exp, 'aal2', now() + v_duree)
  returning * into v_ligne;

  return jsonb_build_object('id', v_ligne.id, 'client_id', v_ligne.client_id, 'client_nom', v_ligne.client_nom,
    'accorde_le', v_ligne.accorde_le, 'expire_le', v_ligne.expire_le, 'duree_jours', extract(day from v_duree)::int);
end;
$$;
revoke all on function public.autoriser_connecteur(text) from public, anon;
grant execute on function public.autoriser_connecteur(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. lier_connecteur() : état de l'autorisation du jeton OAuth, et liaison à sa session au premier usage
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.lier_connecteur()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_jwt     jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_client  text := nullif(v_jwt->>'client_id', '');
  v_session text := nullif(v_jwt->>'session_id', '');
  v_delai   constant interval := interval '15 minutes';  -- délai entre l'autorisation et le premier appel du connecteur
  g         public.connecteurs_autorises;
  s_cree    timestamptz;
  v_autres  int;
begin
  if v_uid is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  if v_client is null or v_session is null then
    return 'sans_client';
  end if;
  if not public.mfa_exigee() then
    -- plus aucun facteur vérifié : les autorisations accordées avec un code tombent (elles ne revivront pas à la réinscription)
    update public.connecteurs_autorises set revoque_le = now() where user_id = v_uid and revoque_le is null;
    return 'sans_facteur';
  end if;

  select * into g from public.connecteurs_autorises
   where user_id = v_uid and client_id = v_client and revoque_le is null
   for update;
  if not found then
    return case when exists (select 1 from public.connecteurs_autorises where user_id = v_uid and client_id = v_client) then 'revoquee' else 'absente' end;
  end if;
  if g.expire_le <= now() then
    return 'expiree';
  end if;
  -- le facteur qui a servi doit exister encore : un facteur réinscrit après l'autorisation ne la fait pas revivre
  if not exists (select 1 from auth.mfa_factors f where f.user_id = v_uid and f.status::text = 'verified' and f.created_at <= g.accorde_le) then
    update public.connecteurs_autorises set revoque_le = now() where id = g.id;
    return 'revoquee';
  end if;

  -- session du jeton : session OAuth de ce client, pour cet utilisateur, encore ouverte
  select s.created_at into s_cree from auth.sessions s
   where s.id::text = v_session and s.user_id = v_uid and s.oauth_client_id::text = v_client
     and (s.not_after is null or s.not_after > now());

  if g.session_id is not null then
    if g.session_id::text <> v_session then
      return 'autre_session';
    end if;
    if s_cree is null then
      return 'non_liee';
    end if;
    update public.connecteurs_autorises set dernier_usage = now()
     where id = g.id and (dernier_usage is null or dernier_usage < now() - interval '5 minutes');
    return 'autorise';
  end if;

  -- première utilisation : liaison à la session née de l'échange du code de CETTE demande
  if now() > g.accorde_le + v_delai then
    return 'hors_delai';
  end if;
  if exists (select 1 from auth.oauth_authorizations a where a.authorization_id = g.autorisation_id) then
    return 'en_attente';
  end if;
  if s_cree is null or s_cree < g.accorde_le or s_cree > g.autorisation_expire_le then
    return 'non_liee';
  end if;
  select count(*) into v_autres from auth.sessions s
   where s.user_id = v_uid and s.oauth_client_id::text = v_client and s.created_at >= g.accorde_le and s.id::text <> v_session;
  if v_autres > 0 then
    return 'ambigu';
  end if;
  update public.connecteurs_autorises
     set session_id = v_session::uuid, lie_le = now(), dernier_usage = now()
   where id = g.id;
  return 'autorise';
end;
$$;
revoke all on function public.lier_connecteur() from public, anon;
grant execute on function public.lier_connecteur() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. connecteur_autorise() : utilisée par les politiques (une évaluation par requête, (select …))
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.connecteur_autorise()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.connecteurs_autorises g
      join auth.sessions s on s.id = g.session_id and s.user_id = g.user_id
     where g.user_id = auth.uid()
       and g.client_id = (auth.jwt()->>'client_id')
       and g.session_id::text = (auth.jwt()->>'session_id')
       and g.revoque_le is null
       and g.expire_le > now()
       and s.oauth_client_id::text = g.client_id
       and (s.not_after is null or s.not_after > now())
       and exists (select 1 from auth.mfa_factors f
                    where f.user_id = g.user_id and f.status::text = 'verified' and f.created_at <= g.accorde_le)
  );
$$;
revoke all on function public.connecteur_autorise() from public, anon;
grant execute on function public.connecteur_autorise() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. revoquer_connecteur(client_id) : retirer un accès (Compte › Connexion)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.revoquer_connecteur(p_client_id text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  update public.connecteurs_autorises set revoque_le = now()
   where user_id = v_uid and client_id = p_client_id and revoque_le is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.revoquer_connecteur(text) from public, anon;
grant execute on function public.revoquer_connecteur(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. Politiques restrictives de 0028 et 0031 : connecteur autorisé accepté ; (select auth.jwt()) partout
-- ---------------------------------------------------------------------------------------------------------------------------------
alter policy "banque_connexions: aal2" on public.banque_connexions
  using (((select auth.jwt())->>'aal') = 'aal2' or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
alter policy "banque_comptes: aal2" on public.banque_comptes
  using (((select auth.jwt())->>'aal') = 'aal2' or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
alter policy "banque_placements: aal2" on public.banque_placements
  using (((select auth.jwt())->>'aal') = 'aal2' or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
alter policy "banque_operations: aal2" on public.banque_operations
  using (((select auth.jwt())->>'aal') = 'aal2' or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
alter policy "banque_mois: aal2" on public.banque_mois
  using (((select auth.jwt())->>'aal') = 'aal2' or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);

create policy "banque_connexions: suppression aal2" on public.banque_connexions as restrictive for delete to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "banque_comptes: suppression aal2" on public.banque_comptes as restrictive for delete to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "banque_placements: suppression aal2" on public.banque_placements as restrictive for delete to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "banque_operations: suppression aal2" on public.banque_operations as restrictive for delete to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "banque_mois: suppression aal2" on public.banque_mois as restrictive for delete to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);

alter policy "biens: aal2 si facteur" on public.biens
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "budgets: aal2 si facteur" on public.budgets
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "config: aal2 si facteur" on public.config
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "connexions_assistant: aal2 si facteur" on public.connexions_assistant
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "credits: aal2 si facteur" on public.credits
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "fonctionnalites: aal2 si facteur" on public.fonctionnalites
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "foyer_evenements: aal2 si facteur" on public.foyer_evenements
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "foyer_variantes: aal2 si facteur" on public.foyer_variantes
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "journal: aal2 si facteur" on public.journal
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "memoire_agent: aal2 si facteur" on public.memoire_agent
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "objectifs: aal2 si facteur" on public.objectifs
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "plans_figes: aal2 si facteur" on public.plans_figes
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "positions: aal2 si facteur" on public.positions
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "profiles: aal2 si facteur" on public.profiles
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "propositions: aal2 si facteur" on public.propositions
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "routines: aal2 si facteur" on public.routines
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "snapshots: aal2 si facteur" on public.snapshots
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "status: aal2 si facteur" on public.status
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));
alter policy "transactions: aal2 si facteur" on public.transactions
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. delete_me() et export_all() : jamais par un jeton OAuth ; delete_me exige aal2 pour un compte à facteur
-- ---------------------------------------------------------------------------------------------------------------------------------
-- delete_me : 0001 à l'identique, plus deux gardes. Un connecteur autorisé passe la RLS : sans garde, il pourrait supprimer le compte
-- (security definer) ; et un mot de passe volé ne doit pas suffire à supprimer un compte protégé par un code.
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
  if nullif(auth.jwt()->>'client_id', '') is not null then
    raise exception 'Un connecteur ne peut pas supprimer le compte : fais-le depuis Boussole › Mon compte.' using errcode = '42501';
  end if;
  if public.mfa_exigee() and coalesce(auth.jwt()->>'aal', '') <> 'aal2' then
    raise exception 'Double authentification requise : valide ton code à 6 chiffres avant de supprimer ton compte.' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

-- export_all : 0031 à l'identique (même clés, même ordre, security invoker : la RLS borne tout), en plpgsql pour la garde « pas de
-- jeton OAuth » (le connecteur ne peut pas exporter, promesse de Mon compte), plus connecteurs_autorises (colonnes visibles seulement).
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
                              from public.connecteurs_autorises g where g.user_id = auth.uid())
  );
end;
$$;
revoke all on function public.export_all() from public, anon;
grant execute on function public.export_all() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. service_role : droits explicites (plus d'exposition automatique), objets existants et futurs ; anon et authenticated inchangés
-- ---------------------------------------------------------------------------------------------------------------------------------
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
