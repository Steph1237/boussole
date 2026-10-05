-- Boussole : durcissement des RPC security definer (suite à get_advisors security)
-- Appliqué avec apply_migration (name = "harden_rpc").
--
-- Les avertissements `authenticated_security_definer_function_executable` sur
-- request_instrument() et delete_me() sont volontaires : ces RPC sont appelées par
-- les utilisateurs connectés et doivent agir au-delà de leurs droits (insertion dans
-- instruments, suppression dans auth.users). On borne donc strictement leur effet :
-- refus si non authentifié, écriture limitée à une ligne sans prix / au compte courant.

create or replace function public.request_instrument(p_isin text, p_name text default null, p_symbol text default null)
returns public.instruments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_isin text := upper(trim(p_isin));
  r public.instruments;
begin
  if auth.uid() is null then
    raise exception 'non authentifié';
  end if;
  if v_isin is null or v_isin = '' then
    raise exception 'isin requis';
  end if;
  insert into public.instruments (isin, name, symbol, requested_by)
  values (v_isin, nullif(trim(p_name), ''), nullif(trim(p_symbol), ''), auth.uid())
  on conflict (isin) do nothing;
  select * into r from public.instruments where isin = v_isin;
  return r;
end;
$$;

revoke all on function public.request_instrument(text, text, text) from public, anon;
grant execute on function public.request_instrument(text, text, text) to authenticated;
