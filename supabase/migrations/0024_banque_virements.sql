-- Boussole : banque, virements internes exclus des totaux mensuels (CP1, docs/superpowers/specs/2026-10-12-cp1-comptes-performance-design.md § 5).
-- Non appliquée : à appliquer sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "banque_virements"), AVANT le
-- déploiement de la fonction powens qui pose la catégorie « virement_interne » (sans elle, ces opérations seraient comptées dans
-- banque_mois sous une catégorie « virement_interne » ; le connecteur les écarte de toute façon de ses totaux).
--   banque_operations.categorie reste un texte libre (aucune contrainte) : « virement_interne » y est posée par la fonction powens
--   (synchro.ts, rapprocherVirements) sur les deux côtés d'un virement entre deux comptes connectés du même utilisateur.
--   banque_recalculer_mois (0021, remplacée) : reprise à l'identique, plus l'exclusion des opérations « virement_interne » (ni
--   entrées, ni sorties, ni nombre). Les virements vers l'épargne gardent leur catégorie « epargne » et restent comptés.
--   Droits inchangés (réservée à service_role), réaffirmés ci-dessous.
--   Tests : test/banque-virements-pglite.test.mjs (PGlite, baseComplete).

-- ---------------------------------------------------------------------------
-- banque_recalculer_mois(user, depuis) : 0021 + opérations « virement_interne » exclues des totaux.
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
     and coalesce(btrim(o.categorie), '') <> 'virement_interne'
   group by 2, 3;
end;
$$;

revoke all on function public.banque_recalculer_mois(uuid, date) from public, anon, authenticated;
grant execute on function public.banque_recalculer_mois(uuid, date) to service_role;
