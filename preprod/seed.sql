-- Graine de la PRÉPRODUCTION LOCALE (SEC5, spec § 3.4). Exécutée par `supabase db reset --local` juste après les migrations.
-- Ce n'est PAS une migration : elle n'est jamais appliquée en production. Les migrations existantes ne sont pas modifiées
-- (vérifiées par md5 en production) ; ce qui est propre à l'environnement local se règle ici.
--
-- 1. Désarme les tâches planifiées qui appellent la production (0003 : boussole-nightly, 0021 : boussole-powens-nuit).
--    test/preprod-seed.test.mjs échoue si une migration programme un jour une autre tâche vers la production.
-- 2. Échoue (le reset s'arrête) si une tâche vise encore supabase.co ou le projet de production.
-- 3. Crée le schéma `preprod` (local seulement, non exposé par l'API) avec preprod.lancer_nuit() : appelle la fonction
--    `nightly` LOCALE par pg_net, avec le jeton du Vault local, pour la tester à la main (npm run preprod:fumee).
-- Aucun utilisateur n'est créé ici : les comptes passent par l'API de GoTrue (scripts/preprod/graine.mjs).

do $$
declare
  j text;
begin
  foreach j in array array['boussole-nightly', 'boussole-powens-nuit'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end;
$$;

do $$
declare
  fautif text;
begin
  select string_agg(jobname, ', ') into fautif
    from cron.job
   where command ilike '%supabase.co%' or command ilike '%oapcewpqsbbjdlcdeizi%';
  if fautif is not null then
    raise exception 'préproduction : tâche(s) pg_cron encore dirigée(s) vers la production : %. Ajoute cron.unschedule dans preprod/seed.sql.', fautif;
  end if;
end;
$$;

create schema if not exists preprod;

-- Appelle la fonction `nightly` servie en local (supabase functions serve). L'URL interne par défaut est celle de Kong
-- dans le réseau Docker de la pile ; le jeton est celui que la migration 0003 a rangé dans le Vault local.
create or replace function preprod.lancer_nuit(p_url text default 'http://kong:8000/functions/v1/nightly')
returns bigint
language sql
set search_path = ''
as $$
  select net.http_post(
    url := p_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'nightly_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$;

revoke all on schema preprod from public, anon, authenticated;
revoke all on function preprod.lancer_nuit(text) from public, anon, authenticated;
