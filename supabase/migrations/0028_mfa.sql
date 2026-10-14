-- Boussole : double authentification obligatoire pour les données bancaires (SEC2, docs/superpowers/specs/2026-10-14-sec2-mfa-design.md).
-- Non appliquée : à appliquer sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "mfa"), APRÈS le déploiement de l'app
-- (section Compte › Sécurité et écran de code : sans elle, un utilisateur dont la banque est connectée ne pourrait plus voir ses
-- comptes ni activer la double authentification) et de la fonction mcp (message « Double authentification requise »).
--   Une politique RESTRICTIVE par table de données bancaires, pour le rôle authenticated, toutes commandes : la ligne n'est visible
--   (et modifiable, pour le rattachement des comptes) que si le jeton de la session porte aal = 'aal2', c'est-à-dire si la session
--   a franchi un second facteur (code TOTP). Une politique restrictive s'AJOUTE aux politiques permissives de 0021 (propriétaire
--   seulement) : elles sont conservées telles quelles, aucune n'est retirée ni affaiblie.
--     banque_connexions, banque_comptes, banque_placements, banque_operations, banque_mois.
--   Un jeton sans revendication aal vaut aal1 (documentation Supabase) : refusé. Un utilisateur sans facteur vérifié n'atteint jamais
--   aal2 : tant qu'il n'a pas activé la double authentification (Compte › Sécurité), il ne voit aucune donnée bancaire. C'est voulu
--   (« obligatoire dès qu'une banque est connectée »). Le service (fonction powens, nuit, clé de service, BYPASSRLS) n'est pas concerné.
--   Pas de fonction security definer à durcir : les fonctions qui lisent ou écrivent ces tables (powens_*, banque_*, 0021 → 0025) sont
--   réservées à service_role (aucun droit pour authenticated ni anon), et export_all() est security invoker, donc soumise aux nouvelles
--   politiques (ses sections banque_* sortent vides sans aal2). Le test test/mfa-pglite.test.mjs vérifie ces deux points sur la base
--   complète, pour toute fonction future qui lirait ces tables.
--   Non couvert ici (voulu) : fonctionnalites (l'interrupteur « banque » doit rester lisible pour afficher la carte « Active la
--   double authentification »), propositions déposées par la synchronisation et lignes de positions alimentées par Powens (données du
--   patrimoine saisies ou validées par l'utilisateur, pas le détail bancaire).
--   Prérequis : auth.jwt() (Supabase Auth).
--   Tests : test/mfa-pglite.test.mjs (PGlite, baseComplete ; auth.jwt() et auth.mfa_factors simulés).

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

-- Droits inchangés (lecture seule pour authenticated, hors les 5 colonnes de rattachement de banque_comptes ; écritures par le
-- service) : réaffirmés pour que cette migration reste la référence des droits de ces tables.
grant select on table public.banque_connexions, public.banque_comptes, public.banque_placements, public.banque_operations, public.banque_mois
  to authenticated;
