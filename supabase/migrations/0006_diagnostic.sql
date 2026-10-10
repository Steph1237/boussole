-- Boussole : Diagnostic (sous-projet 2) — profil de risque, rattachement poche → classe, protection,
-- annotations des fonds (frais, zone, devise d'exposition).
-- Appliqué avec apply_migration (name = "diagnostic").

-- ---------------------------------------------------------------------------
-- profiles : trois colonnes privées (RLS existante : user_id = auth.uid())
-- ---------------------------------------------------------------------------
-- risque     : null = questionnaire jamais rempli ; sinon { reponses, profil, score, date }.
-- classes    : surcharges poche → classe d'actifs ({ "Protection": "fonds_euros", … }).
-- protection : déclaratif { prevoyance, emprunteur } (booléens), ou le même objet par personne ({ foyer|p1|p2: {…} }).
alter table public.profiles add column if not exists risque jsonb;
alter table public.profiles add column if not exists classes jsonb not null default '{}';
alter table public.profiles add column if not exists protection jsonb not null default '{}';

-- export_all() sérialise la ligne de profil entière (to_jsonb(p)) : les trois colonnes ci-dessus y figurent
-- sans modifier la fonction (vérifié avec pg_get_functiondef avant cette migration ; test/isolation.test.mjs
-- contrôle leur présence dans l'export de l'appelant).

-- ---------------------------------------------------------------------------
-- instruments : annotations renseignées par le connecteur (outil annotate_instrument)
-- ---------------------------------------------------------------------------
-- ter           : frais courants annuels en % (0,12 = 0,12 %/an), source : DIC / KID du fonds.
-- zone          : zone géographique couverte (« Monde », « États-Unis », « Europe », « France »…).
-- devise        : devise d'exposition principale (code ISO 4217) ; distincte de currency (devise de cotation).
-- annote_source : URL ou description de la source consultée (obligatoire pour toute annotation).
-- annote_le     : date de la dernière annotation.
alter table public.instruments add column if not exists ter numeric check (ter is null or (ter >= 0 and ter <= 10));
alter table public.instruments add column if not exists zone text check (zone is null or char_length(zone) between 1 and 60);
alter table public.instruments add column if not exists devise text check (devise is null or devise ~ '^[A-Z]{3}$');
alter table public.instruments add column if not exists annote_source text check (annote_source is null or char_length(annote_source) between 1 and 300);
alter table public.instruments add column if not exists annote_le timestamptz;

-- La table reste en lecture seule pour authenticated (aucun privilège d'écriture, aucune politique d'écriture) :
-- la seule écriture possible pour un utilisateur passe par la RPC ci-dessous.
--
-- Avertissement get_advisors attendu et volontaire : `authenticated_security_definer_function_executable`
-- sur annoter_instrument (comme request_instrument et delete_me). L'effet est strictement borné :
--   - appelant authentifié, qui détient lui-même une ligne de placement sur cet ISIN ;
--   - seules les colonnes ter / zone / devise / annote_source / annote_le changent (jamais le cours) ;
--   - valeurs validées (TER entre 0 et 10 %, zone ≤ 60 caractères, devise ISO à 3 lettres, source obligatoire ≤ 300) ;
--   - search_path vide, toutes les références qualifiées.
-- L'instrument étant partagé, l'annotation profite aux autres détenteurs du même fonds : c'est voulu
-- (donnée publique du fonds, sourcée), et la dernière annotation l'emporte.
create or replace function public.annoter_instrument(
  p_isin text,
  p_ter numeric default null,
  p_zone text default null,
  p_devise text default null,
  p_source text default null
)
returns public.instruments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_isin   text := upper(trim(coalesce(p_isin, '')));
  v_zone   text := nullif(trim(coalesce(p_zone, '')), '');
  v_devise text := nullif(upper(trim(coalesce(p_devise, ''))), '');
  v_source text := nullif(trim(coalesce(p_source, '')), '');
  r public.instruments;
begin
  if auth.uid() is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  if v_isin = '' then
    raise exception 'isin requis' using errcode = '22023';
  end if;
  if not exists (select 1 from public.positions p where p.user_id = auth.uid() and p.isin = v_isin) then
    raise exception 'instrument non détenu : % ne figure dans aucune de vos lignes de placement', v_isin using errcode = '42501';
  end if;
  if p_ter is null and v_zone is null and v_devise is null then
    raise exception 'rien à annoter : fournissez au moins le TER, la zone ou la devise' using errcode = '22023';
  end if;
  if v_source is null then
    raise exception 'source requise : indiquez l''URL ou le document consulté' using errcode = '22023';
  end if;
  if char_length(v_source) > 300 then
    raise exception 'source trop longue (300 caractères au plus)' using errcode = '22023';
  end if;
  if p_ter is not null and (p_ter < 0 or p_ter > 10) then
    raise exception 'TER invalide : % (attendu entre 0 et 10 %% par an)', p_ter using errcode = '22023';
  end if;
  if v_zone is not null and char_length(v_zone) > 60 then
    raise exception 'zone trop longue (60 caractères au plus)' using errcode = '22023';
  end if;
  if v_devise is not null and v_devise !~ '^[A-Z]{3}$' then
    raise exception 'devise invalide : % (code ISO à 3 lettres attendu, ex. EUR, USD)', v_devise using errcode = '22023';
  end if;

  update public.instruments i
     set ter           = coalesce(p_ter, i.ter),
         zone          = coalesce(v_zone, i.zone),
         devise        = coalesce(v_devise, i.devise),
         annote_source = v_source,
         annote_le     = now()
   where i.isin = v_isin
  returning * into r;

  if r.isin is null then
    raise exception 'instrument inconnu : %', v_isin using errcode = 'P0002';
  end if;
  return r;
end;
$$;

revoke all on function public.annoter_instrument(text, numeric, text, text, text) from public, anon;
grant execute on function public.annoter_instrument(text, numeric, text, text, text) to authenticated;
