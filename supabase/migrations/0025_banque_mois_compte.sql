-- Boussole : banque, totaux mensuels par compte et trace des virements internes (correctifs CP1 après relecture,
-- docs/superpowers/specs/2026-10-12-cp1-comptes-performance-design.md § 5).
-- Non appliquée : à appliquer sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "banque_mois_compte"), AVANT le
-- déploiement des fonctions powens (qui écrit les nouvelles colonnes de banque_operations) et mcp (qui lit banque_mois.compte_id).
--   banque_operations (colonnes écrites par la fonction powens, lecture seule pour l'utilisateur comme les autres) :
--     categorie_powens : catégorie Boussole tirée de la catégorie Powens (categories.ts), avant tout rapprochement ; c'est elle
--       qui est restaurée quand un virement interne ou un versement d'épargne n'est plus reconnu (contrepartie disparue, règle
--       plus stricte) : le rapprochement est recalculé à chaque synchronisation, de façon idempotente ;
--     contrepartie_id : identifiant de l'opération appariée (virement entre deux comptes connectés du même utilisateur), null sinon ;
--     type_powens : type Powens de l'opération (transfer, card, deferred_card, order, check, withdrawal…), indice d'un virement
--       ou d'un paiement par carte quand le libellé simplifié l'a perdu.
--   banque_mois : + compte_id (bigint, 0 par défaut) ; clé primaire (user_id, mois, compte_id, categorie). Les lignes écrites
--     avant cette migration gardent compte_id = 0 (tous comptes confondus) : celles des mois de plus de 90 jours ne sont jamais
--     recalculées (garde-fou de 0021) et restent ; les autres sont recalculées par compte ci-dessous.
--   banque_recalculer_mois (0024, remplacée) : reprise à l'identique, plus le compte (insert, select, group by). Garde-fou de
--     0021 inchangé : un mois dont le 1er jour a plus de 90 jours n'est ni effacé ni recalculé.
--   Recalcul immédiat, par compte, des mois encore couverts par le détail, pour chaque utilisateur qui a des opérations.
--   Droits inchangés (fonction réservée à service_role, réaffirmés ci-dessous ; tables en lecture seule pour authenticated).
--   Tests : test/banque-mois-compte-pglite.test.mjs (PGlite, baseComplete).

alter table public.banque_operations
  add column categorie_powens text,
  add column contrepartie_id  bigint,
  add column type_powens      text;

alter table public.banque_mois add column compte_id bigint not null default 0;
alter table public.banque_mois drop constraint banque_mois_pkey;
alter table public.banque_mois add constraint banque_mois_pkey primary key (user_id, mois, compte_id, categorie);

-- ---------------------------------------------------------------------------
-- banque_recalculer_mois(user, depuis) : 0024 + un total par compte.
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
  insert into public.banque_mois (user_id, mois, compte_id, categorie, entrees, sorties, nombre)
  select p_user,
         date_trunc('month', o.date)::date, o.compte_id,
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
   group by 2, 3, 4;
end;
$$;

revoke all on function public.banque_recalculer_mois(uuid, date) from public, anon, authenticated;
grant execute on function public.banque_recalculer_mois(uuid, date) to service_role;

-- Totaux par compte tout de suite (la fonction ramène la date de départ au garde-fou : seuls les mois récents sont recalculés).
select public.banque_recalculer_mois(u.user_id, date '1900-01-01')
  from (select distinct o.user_id from public.banque_operations o) u;
