-- Comptes anonymes (« Commencer sans e-mail ») : supprimés après 90 jours sans connexion.
-- Les données suivent par cascade (toutes les tables privées référencent auth.users on delete cascade).
create or replace function public.purge_comptes_anonymes(p_jours int default 90)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  with supprimes as (
    delete from auth.users
    where is_anonymous
      and coalesce(last_sign_in_at, created_at) < now() - make_interval(days => p_jours)
    returning 1
  )
  select count(*) into n from supprimes;
  return n;
end;
$$;

revoke all on function public.purge_comptes_anonymes(int) from public, anon, authenticated;
grant execute on function public.purge_comptes_anonymes(int) to service_role;

-- Chaque lundi à 03:00 UTC.
select cron.unschedule('boussole-purge-anonymes') where exists (select 1 from cron.job where jobname = 'boussole-purge-anonymes');
select cron.schedule('boussole-purge-anonymes', '0 3 * * 1', $$select public.purge_comptes_anonymes(90)$$);
