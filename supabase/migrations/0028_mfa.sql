-- Boussole : double authentification obligatoire (SEC2, docs/superpowers/specs/2026-10-14-sec2-mfa-design.md).
-- Non appliquée : à appliquer sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "mfa"), APRÈS le déploiement de l'app
-- (section Compte › Sécurité et écran de code : sans elle, un utilisateur concerné ne pourrait plus voir ses données ni activer la
-- double authentification) et de la fonction mcp (message « Double authentification requise »).
--   Deux niveaux de protection, tous deux par politiques RESTRICTIVES pour le rôle authenticated, toutes commandes. Une politique
--   restrictive s'AJOUTE aux politiques permissives de propriétaire (0001 → 0021) : elles sont conservées telles quelles, aucune n'est
--   retirée ni affaiblie. Un jeton sans revendication aal vaut aal1 (documentation Supabase) : refusé là où aal2 est exigé.
--   1. Données bancaires (banque_connexions, banque_comptes, banque_placements, banque_operations, banque_mois) : toujours aal2. Sans
--      second facteur activé, ces tables restent fermées : « obligatoire dès qu'une banque est connectée ». Le rattachement des comptes
--      (update de banque_comptes) exige aussi aal2.
--   2. TOUTES les autres données personnelles (toute table de public qui porte un user_id, hors banque_*) : aal2 dès que l'utilisateur
--      a au moins un facteur vérifié ; sans facteur vérifié, rien ne change (il n'a pas de second facteur à présenter). Raison : des
--      données dérivées de la banque se trouvent hors banque_* (lignes de positions alimentées par Powens, crédits, propositions déposées
--      par la synchronisation avec salaire et employeur, totaux des snapshots) ; protéger seulement banque_* laissait un mot de passe
--      volé lire l'essentiel. Le test test/mfa-pglite.test.mjs énumère les tables de public qui ont un user_id et échoue si l'une n'a
--      pas sa politique : une table future ne peut pas l'oublier. Les tables de contenu commun (instruments, savoir_fiches, reperes,
--      expertises, expertises_versions, cours) et job_runs n'ont pas de user_id : hors périmètre.
--   public.mfa_exigee() : vrai si l'utilisateur courant (auth.uid()) a au moins un facteur vérifié dans auth.mfa_factors. Fonction
--   security definer (authenticated n'a aucun droit sur le schéma auth), stable, search_path vide, réservée à authenticated. Placée
--   dans public et non dans prive : le schéma prive est fermé à authenticated, or les politiques s'exécutent avec les droits de
--   l'appelant. Elle ne révèle que la situation de l'appelant.
--   Le service (fonction powens, nuit, clé de service, BYPASSRLS) n'est pas concerné. Les fonctions security definer (delete_me,
--   take_snapshots, apply_recurring…) s'exécutent avec les droits de leur propriétaire : hors RLS, comme avant. export_all() est
--   security invoker : elle ne sort que ce que la RLS laisse voir (rien d'un compte à double authentification en aal1).
--   Prérequis : auth.jwt(), auth.uid() et auth.mfa_factors (Supabase Auth).
--   Tests : test/mfa-pglite.test.mjs (PGlite, baseComplete ; auth.jwt() et auth.mfa_factors simulés).

create function public.mfa_exigee() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke all on function public.mfa_exigee() from public, anon;
grant execute on function public.mfa_exigee() to authenticated;

create policy "banque_connexions: aal2" on public.banque_connexions as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2') with check ((select auth.jwt()->>'aal') = 'aal2');
create policy "banque_comptes: aal2" on public.banque_comptes as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2') with check ((select auth.jwt()->>'aal') = 'aal2');
create policy "banque_placements: aal2" on public.banque_placements as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2') with check ((select auth.jwt()->>'aal') = 'aal2');
create policy "banque_operations: aal2" on public.banque_operations as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2') with check ((select auth.jwt()->>'aal') = 'aal2');
create policy "banque_mois: aal2" on public.banque_mois as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2') with check ((select auth.jwt()->>'aal') = 'aal2');

-- Niveau 2 : toutes les autres données personnelles. aal2 exigé dès qu'un facteur est vérifié (voir l'en-tête).
create policy "biens: aal2 si facteur" on public.biens as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "budgets: aal2 si facteur" on public.budgets as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "config: aal2 si facteur" on public.config as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "connexions_assistant: aal2 si facteur" on public.connexions_assistant as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "credits: aal2 si facteur" on public.credits as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "fonctionnalites: aal2 si facteur" on public.fonctionnalites as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "journal: aal2 si facteur" on public.journal as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "memoire_agent: aal2 si facteur" on public.memoire_agent as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "objectifs: aal2 si facteur" on public.objectifs as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "positions: aal2 si facteur" on public.positions as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "profiles: aal2 si facteur" on public.profiles as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "propositions: aal2 si facteur" on public.propositions as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "routines: aal2 si facteur" on public.routines as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "snapshots: aal2 si facteur" on public.snapshots as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "status: aal2 si facteur" on public.status as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));
create policy "transactions: aal2 si facteur" on public.transactions as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));

-- Droits inchangés (lecture seule pour authenticated, hors les 5 colonnes de rattachement de banque_comptes ; écritures par le
-- service) : réaffirmés pour que cette migration reste la référence des droits de ces tables.
grant select on table public.banque_connexions, public.banque_comptes, public.banque_placements, public.banque_operations, public.banque_mois
  to authenticated;
