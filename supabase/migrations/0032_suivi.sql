-- Boussole : suivi de mes lignes, partie A (GOV1 et SCO2, docs/superpowers/specs/2026-10-15-suivi-lignes-design.md § 3, § 3.2 et § 18 ;
-- plan docs/superpowers/plans/2026-10-15-suivi-lignes.md, tâche 1).
-- Non appliquée : à appliquer avec apply_migration (name = "suivi") sur le projet oapcewpqsbbjdlcdeizi, après 0031 (projection), AVANT le
-- déploiement de la fonction mcp et de l'app (outils et vues qui lisent et écrivent ces colonnes).
--
-- Données privées (RLS de propriétaire et politique restrictive « aal2 si facteur » de 0028 : elles portent sur les tables, donc
-- couvrent déjà les nouvelles colonnes ; aucune table nouvelle, export_all() et la suppression du compte en héritent) :
--   positions.role         : reserve | coeur | satellite, null tant que le rôle n'est pas posé (contrainte positions_role) ;
--   positions.role_source  : propose | valide, null sans rôle (contraintes positions_role_source et positions_role_source_coherent :
--                            pas de role_source sans role) ;
--   config.suivi           : politique de suivi (jsonb objet, défaut {}), écrite par appliquer_propositions (cible config, clé suivi) :
--                            revue_coeur, mois_revue_coeur, seuil_ecart_pts, plafond_satellite_pct, seuil_baisse_satellite_pct, semaine,
--                            source (obligatoire), le ; fusion par champ, null retire un champ ;
--   routines.etat_suivi    : mémoire de la dernière revue (déclencheurs vus, constats, météo ; des codes et des nombres, aucun texte libre),
--                            jsonb objet de 20 000 octets au plus, null tant qu'aucune revue ne l'a écrite (contrainte routines_etat_suivi).
-- appliquer_propositions : repart exactement de 0031 (0031 est sa dernière définition) ; le diff est limité à ces ajouts :
--   - cible position : champs role et role_source (valeurs bornées, null les retire ; pas de role_source sans role) ;
--   - cible config : clé suivi (bornes du § 3.2, source obligatoire, messages au format de 0027 et de 0031) ; la liste blanche des clés et
--     quatre lignes de messages la citent ;
--   - config.frais_enveloppes : arbitrage_pct et courtage_pct acceptés en plus de gestion_uc_pct, gestion_euro_pct et garde_pct (0 à 5).
--   Tout le reste est inchangé : tout ou rien, security invoker, search_path vide, mêmes droits.
--   Les contrôles sont répétés à l'identique dans le connecteur (supabase/functions/mcp) et dans la démo (store-demo.js).
-- cloturer_routine : repart de 0020 (dernière définition) ; nouveau paramètre optionnel p_etat_suivi jsonb (défaut null) : fourni (objet,
--   20 000 octets au plus), il est écrit dans routines.etat_suivi ; omis (ou null), l'état précédent est conservé. L'ancienne signature
--   à quatre arguments est remplacée par celle à cinq (les anciens appels, positionnels ou nommés, fonctionnent sans changement).
-- export_all : inchangée (0031) : elle sort config, positions et routines par to_jsonb de la ligne, donc les nouvelles colonnes.
-- Contenu commun (sans donnée personnelle) :
--   - reperes.libelle passe de 120 à 200 caractères au plus (deux libellés du suivi dépassent 120) ;
--   - 35 repères de suivi, recopiés à l'identique de test/fixtures/suivi-cas.json (clé reperes, hors les 11 repères fiscaux marqués
--     « reprise », déjà en base) au format de 0030 ; le champ statut (V ou CONV) ne va pas en base, un repère Boussole le dit dans son libellé ;
--   - 6 fiches du savoir (thème comportement, clé fiches de la même fixture), au format de 0011, déjà au tutoiement.
-- Expertises : « Copilote » devient « Claude » et le mot « conseiller » est reformulé dans les textes des 8 expertises v1 (sens inchangé) ;
--   une version de plus par expertise touchée, avec son entrée de journal. Le bloc des expertises de web/src/demo-data.js est régénéré
--   (scripts/gen-expertises-demo.mjs) à partir de 0017 puis de ce bloc.
-- Idempotente : tout peut être rejoué sans effet (colonnes et contraintes recréées à l'identique, inserts en on conflict, reformulation
--   sans effet quand elle est déjà faite).
-- Prérequis : 0031 (foyer_nombre, foyer_date, foyer_rogner), 0028 (mfa_exigee), 0020 (routines), 0016 et 0017 (expertises).
-- Tests : test/suivi-pglite.test.mjs (PGlite, baseComplete).

-- ---------------------------------------------------------------------------
-- positions.role et positions.role_source
-- ---------------------------------------------------------------------------
alter table public.positions add column if not exists role text;
alter table public.positions add column if not exists role_source text;
alter table public.positions drop constraint if exists positions_role;
alter table public.positions add constraint positions_role check (role is null or role in ('reserve', 'coeur', 'satellite'));
alter table public.positions drop constraint if exists positions_role_source;
alter table public.positions add constraint positions_role_source check (role_source is null or role_source in ('propose', 'valide'));
alter table public.positions drop constraint if exists positions_role_source_coherent;
alter table public.positions add constraint positions_role_source_coherent check (role_source is null or role is not null);

-- ---------------------------------------------------------------------------
-- config.suivi
-- ---------------------------------------------------------------------------
alter table public.config add column if not exists suivi jsonb not null default '{}'::jsonb;
alter table public.config drop constraint if exists config_suivi;
alter table public.config add constraint config_suivi check (jsonb_typeof(suivi) = 'object');

-- ---------------------------------------------------------------------------
-- routines.etat_suivi
-- ---------------------------------------------------------------------------
alter table public.routines add column if not exists etat_suivi jsonb;
alter table public.routines drop constraint if exists routines_etat_suivi;
alter table public.routines add constraint routines_etat_suivi check (etat_suivi is null or (jsonb_typeof(etat_suivi) = 'object' and octet_length(etat_suivi::text) <= 20000));

-- ---------------------------------------------------------------------------
-- cloturer_routine(type, client, synthese, questions, etat_suivi?) : 0020 + l'état du suivi (écrit s'il est fourni, conservé sinon).
-- ---------------------------------------------------------------------------
drop function if exists public.cloturer_routine(text, text, text, jsonb);
create or replace function public.cloturer_routine(p_type text, p_client text, p_synthese text, p_questions jsonb, p_etat_suivi jsonb default null)
returns public.routines
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_q    jsonb := coalesce(p_questions, '[]'::jsonb);
  v_norm jsonb := '[]'::jsonb;
  v_s    text := btrim(p_synthese, E' \t\r\n');
  v_etat jsonb := case when jsonb_typeof(p_etat_suivi) = 'null' then null else p_etat_suivi end;
  v_e    jsonb;
  v_i    bigint;
  v_r    public.routines;
begin
  if v_uid is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('revue_mensuelle') then
    raise exception 'Type de routine inconnu : %. Type possible : revue_mensuelle.', coalesce(p_type, '(vide)') using errcode = '22023';
  end if;
  if exists (select 1 from public.routines r where r.user_id = v_uid and r.type = p_type and not r.active) then
    raise exception 'Revue mensuelle en pause : réactive-la avant de la clôturer.' using errcode = '22023';
  end if;
  if v_s is null or v_s !~ '[^[:space:]]' or char_length(v_s) > 4000 then
    raise exception 'Synthèse vide ou trop longue : 1 à 4 000 caractères.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_q) = 'null' then
    v_q := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_q) <> 'array' then
    raise exception 'Questions invalides : un tableau [{ question, pourquoi?, champ? }] est attendu.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_q) > 10 then
    raise exception 'Trop de questions : 10 au plus (% reçues).', jsonb_array_length(v_q) using errcode = '22023';
  end if;
  for v_e, v_i in select t.e, t.i from jsonb_array_elements(v_q) with ordinality as t(e, i) loop
    if jsonb_typeof(v_e) <> 'object' then
      raise exception 'Question % : objet { question, pourquoi?, champ? } attendu.', v_i using errcode = '22023';
    end if;
    if jsonb_typeof(v_e -> 'question') is distinct from 'string'
       or char_length(btrim(v_e ->> 'question')) < 1 or char_length(btrim(v_e ->> 'question')) > 300 then
      raise exception 'Question % : texte vide ou trop long (1 à 300 caractères).', v_i using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_e -> 'pourquoi'), 'null') <> 'null'
       and (jsonb_typeof(v_e -> 'pourquoi') <> 'string' or char_length(v_e ->> 'pourquoi') > 300) then
      raise exception 'Question % : « pourquoi » invalide (texte de 300 caractères au plus).', v_i using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_e -> 'champ'), 'null') <> 'null'
       and (jsonb_typeof(v_e -> 'champ') <> 'string' or (v_e ->> 'champ') !~ '^[A-Za-z0-9_.]{1,60}$') then
      raise exception 'Question % : champ invalide (identifiant du catalogue des formulaires, 60 caractères au plus).', v_i using errcode = '22023';
    end if;
    v_norm := v_norm || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'question', btrim(v_e ->> 'question'),
      'pourquoi', nullif(btrim(v_e ->> 'pourquoi'), ''),
      'champ',    v_e ->> 'champ')));
  end loop;
  if octet_length(v_norm::text) > 10000 then
    raise exception 'Questions trop longues : 10 000 octets au plus.' using errcode = '22023';
  end if;
  -- État du suivi (0032) : un objet de 20 000 octets au plus ; omis ou null, l'état précédent est conservé.
  if v_etat is not null then
    if jsonb_typeof(v_etat) <> 'object' then
      raise exception 'État du suivi invalide : un objet est attendu.' using errcode = '22023';
    end if;
    if octet_length(v_etat::text) > 20000 then
      raise exception 'État du suivi trop long : 20 000 octets au plus.' using errcode = '22023';
    end if;
  end if;

  insert into public.routines (user_id, type, consentement_journal) values (v_uid, p_type, false) on conflict (user_id, type) do nothing;
  update public.routines r
     set dernier_passage  = now(),
         dernier_client   = left(nullif(btrim(p_client), ''), 100),
         synthese         = v_s,
         questions        = v_norm,
         etat_suivi       = coalesce(v_etat, r.etat_suivi),
         prochain_passage = public.routine_date(r.jour, (now() at time zone 'Europe/Paris')::date, 10)
   where r.user_id = v_uid and r.type = p_type
  returning r.* into v_r;
  return v_r;
end;
$$;
revoke all on function public.cloturer_routine(text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.cloturer_routine(text, text, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- appliquer_propositions(ids, modifications) : 0031 + role et role_source (cible position) + clé suivi (cible config) +
-- arbitrage_pct et courtage_pct (config.frais_enveloppes).
-- ---------------------------------------------------------------------------

create or replace function public.appliquer_propositions(p_ids uuid[], p_modifications jsonb default '{}'::jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_mods   jsonb := coalesce(p_modifications, '{}'::jsonb);
  p        record;
  v        jsonb;
  v_obj    jsonb;
  v_key    text;
  v_val    jsonb;
  v_ligne  jsonb;
  v_lignes jsonb;
  v_idx    int;
  v_num    numeric;
  v_id     uuid;
  v_isin   text;
  v_tx     jsonb;
  v_n      int;
  v_count  int := 0;
  v_quoi   text;
  v_cfg    jsonb;
  v_rec    jsonb;
  v_ids    text[];
  v_txt    text;
  v_num2   numeric;
  v_fe     jsonb;
  v_env    text;
  v_le     date;
  v_ei     jsonb;
  v_pi     jsonb;
  v_don    jsonb;
  v_avis   jsonb;
  v_item   jsonb;
  v_row    jsonb;
  v_auj    date;
  v_dt     date;
  v_dt2    date;
  v_nom    text;
  v_sfx    text;
  v_pers   text;
  v_an     int;
  v_ev     jsonb;
  v_msg    text;
  v_cr     text[];
  v_bi     text[];
  v_vid    uuid;
  v_proj   jsonb;
  v_suivi  jsonb;
begin
  if v_uid is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  if jsonb_typeof(v_mods) <> 'object' then
    raise exception 'Modifications invalides : objet { identifiant: valeur } attendu.' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  for p in
    select pr.* from public.propositions pr
    where pr.id = any(p_ids) and pr.user_id = v_uid and pr.statut = 'en_attente'
    order by pr.cree_le, pr.id
    for update
  loop
    v := case when v_mods ? p.id::text then v_mods -> p.id::text else p.apres end;
    v_quoi := case p.cible when 'profil' then 'profil' when 'budget' then 'ligne de budget' when 'position' then 'placement'
      when 'bien' then 'bien immobilier' when 'credit' then 'crédit' when 'objectif' then 'objectif'
      when 'risque' then 'profil de risque' when 'protection' then 'protection' when 'config' then 'réglages' end;
    v_quoi := coalesce(v_quoi, case p.cible when 'evenement' then 'événement' when 'variante' then 'variante' when 'plan_fige' then 'plan figé' end);
    begin
      if p.operation <> 'supprimer' and (v is null or jsonb_typeof(v) <> 'object') then
        raise exception 'valeur proposée invalide (objet attendu)';
      end if;

      case p.cible
      /* ---------- profil : fusion par clé dans foyer / personnes / autres ---------- */
      when 'profil' then
        insert into public.profiles (user_id) values (v_uid) on conflict (user_id) do nothing;
        if v ? 'foyer' then
          if jsonb_typeof(v->'foyer') <> 'object' then raise exception 'foyer : objet attendu'; end if;
          update public.profiles set foyer = jsonb_strip_nulls(coalesce(foyer, '{}'::jsonb) || (v->'foyer')) where user_id = v_uid;
        end if;
        if v ? 'personnes' then
          if jsonb_typeof(v->'personnes') <> 'object' then raise exception 'personnes : objet attendu'; end if;
          select coalesce(pf.personnes, '{}'::jsonb) into v_obj from public.profiles pf where pf.user_id = v_uid;
          for v_key, v_val in select e.key, e.value from jsonb_each(v->'personnes') e loop
            if v_key not in ('p1', 'p2') then raise exception 'personne « % » inconnue (p1 ou p2)', v_key; end if;
            if jsonb_typeof(v_val) = 'null' then
              if v_key = 'p1' then raise exception 'la première personne du foyer ne peut pas être retirée'; end if;
              v_obj := v_obj - v_key;
            elsif jsonb_typeof(v_val) = 'object' then
              -- naissance (0029) : AAAA-MM-JJ ou AAAA-MM, date réelle, pas dans le futur, pas avant 1900 (null la retire)
              if jsonb_typeof(v_val->'naissance') is not null and jsonb_typeof(v_val->'naissance') <> 'null' then
                begin
                  if jsonb_typeof(v_val->'naissance') <> 'string' or (v_val->>'naissance') !~ '^\d{4}-\d{2}(-\d{2})?$' then raise exception 'format'; end if;
                  v_dt := (case when char_length(v_val->>'naissance') = 7 then (v_val->>'naissance') || '-01' else v_val->>'naissance' end)::date;
                exception when others then
                  raise exception 'personnes.% : naissance invalide (AAAA-MM-JJ ou AAAA-MM)', v_key;
                end;
                if v_dt > (now() at time zone 'Europe/Paris')::date then raise exception 'personnes.% : naissance dans le futur', v_key; end if;
                if v_dt < date '1900-01-01' then raise exception 'personnes.% : naissance antérieure à 1900', v_key; end if;
              end if;
              v_obj := jsonb_set(v_obj, array[v_key],
                jsonb_strip_nulls(case when jsonb_typeof(v_obj->v_key) = 'object' then v_obj->v_key else '{}'::jsonb end || v_val), true);
            else
              raise exception 'personnes.% : objet ou null attendu', v_key;
            end if;
          end loop;
          update public.profiles set personnes = v_obj where user_id = v_uid;
        end if;
        if v ? 'autres' then
          if jsonb_typeof(v->'autres') <> 'object' then raise exception 'autres : objet attendu'; end if;
          select coalesce(pf.autres, '{}'::jsonb) into v_obj from public.profiles pf where pf.user_id = v_uid;
          for v_key, v_val in select e.key, e.value from jsonb_each(v->'autres') e loop
            if v_key not in ('p1', 'p2') then raise exception 'autres : personne « % » inconnue (p1 ou p2)', v_key; end if;
            if jsonb_typeof(v_val) <> 'object' then raise exception 'autres.% : objet attendu', v_key; end if;
            v_obj := jsonb_set(v_obj, array[v_key],
              jsonb_strip_nulls(case when jsonb_typeof(v_obj->v_key) = 'object' then v_obj->v_key else '{}'::jsonb end || v_val), true);
          end loop;
          update public.profiles set autres = v_obj where user_id = v_uid;
        end if;
        /* classes (0019) : surcharges poche → classe d'actifs, fusionnées ; null retire la surcharge de la poche. */
        if v ? 'classes' then
          if jsonb_typeof(v->'classes') <> 'object' then raise exception 'classes : objet { poche: classe } attendu'; end if;
          for v_key, v_val in select e.key, e.value from jsonb_each(v->'classes') e loop
            if btrim(v_key) = '' or char_length(v_key) > 60 then raise exception 'classes : nom de poche invalide (1 à 60 caractères)'; end if;
            continue when jsonb_typeof(v_val) = 'null';
            if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in
                ('actions', 'small_caps', 'emergents', 'levier', 'obligations', 'immobilier', 'monetaire', 'fonds_euros', 'or', 'crypto', 'autres') then
              raise exception 'classe « % » inconnue pour la poche « % » (actions, small_caps, emergents, levier, obligations, immobilier, monetaire, fonds_euros, or, crypto ou autres)',
                coalesce(v_val #>> '{}', ''), v_key;
            end if;
          end loop;
          update public.profiles set classes = jsonb_strip_nulls(
              case when jsonb_typeof(classes) = 'object' then classes else '{}'::jsonb end || (v->'classes'))
           where user_id = v_uid;
        end if;

      /* ---------- budget : une ligne de budgets.lignes ---------- */
      when 'budget' then
        insert into public.budgets (user_id) values (v_uid) on conflict (user_id) do nothing;
        select b.lignes into v_lignes from public.budgets b where b.user_id = v_uid for update;
        if jsonb_typeof(v_lignes) is distinct from 'array' then v_lignes := '[]'::jsonb; end if;
        v_idx := null;
        if p.operation <> 'creer' then
          select (o.i - 1)::int into v_idx from jsonb_array_elements(v_lignes) with ordinality as o(e, i) where o.e->>'id' = p.ref limit 1;
          if v_idx is null then raise exception 'ligne de budget « % » introuvable', p.ref; end if;
        end if;
        if p.operation = 'supprimer' then
          v_lignes := v_lignes - v_idx;
        else
          v_ligne := jsonb_strip_nulls(case when p.operation = 'creer' then v else (v_lignes->v_idx) || v end);
          if p.operation = 'creer' then
            v_ligne := v_ligne || jsonb_build_object('id', coalesce(nullif(btrim(v_ligne->>'id'), ''), gen_random_uuid()::text));
            if exists (select 1 from jsonb_array_elements(v_lignes) e where e->>'id' = v_ligne->>'id') then
              raise exception 'une ligne de budget porte déjà l''identifiant « % »', v_ligne->>'id';
            end if;
          else
            v_ligne := v_ligne || jsonb_build_object('id', p.ref);
          end if;
          if coalesce(v_ligne->>'type', '') not in ('revenu', 'depense', 'epargne') then
            raise exception 'type « % » inconnu (revenu, depense ou epargne)', coalesce(v_ligne->>'type', '');
          end if;
          begin
            v_num := (v_ligne->>'montant')::numeric;
          exception when others then
            v_num := null;
          end;
          if v_num is null or v_num < 0 then raise exception 'montant invalide (nombre positif attendu)'; end if;
          v_ligne := jsonb_set(v_ligne, '{montant}', to_jsonb(v_num));
          v_ligne := v_ligne || jsonb_build_object('frequence', coalesce(v_ligne->>'frequence', 'mois'),
            'categorie', coalesce(v_ligne->>'categorie', ''), 'libelle', coalesce(v_ligne->>'libelle', ''));
          if v_ligne->>'frequence' not in ('mois', 'an') then
            raise exception 'fréquence « % » inconnue (mois ou an)', v_ligne->>'frequence';
          end if;
          if v_ligne ? 'owner' and v_ligne->>'owner' not in ('p1', 'p2', 'commun') then
            raise exception 'titulaire « % » inconnu (p1, p2 ou commun)', v_ligne->>'owner';
          end if;
          if p.operation = 'creer' then v_lignes := v_lignes || jsonb_build_array(v_ligne);
          else v_lignes := jsonb_set(v_lignes, array[v_idx::text], v_ligne);
          end if;
        end if;
        update public.budgets set lignes = v_lignes where user_id = v_uid;

      /* ---------- placements (et mouvement associé) ---------- */
      when 'position' then
        if p.operation = 'supprimer' then
          delete from public.positions where id = p.ref::uuid and user_id = v_uid;
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'ligne « % » introuvable', p.ref; end if;
        else
          v_isin := upper(replace(nullif(btrim(v->>'isin'), ''), ' ', ''));
          if v_isin is not null then
            perform public.request_instrument(v_isin, v->>'name', null);
          end if;
          -- role et role_source (0032) : valeurs bornées (null les retire) ; pas de role_source sans role
          if v ? 'role' and jsonb_typeof(v->'role') <> 'null' and (jsonb_typeof(v->'role') <> 'string' or (v->>'role') not in ('reserve', 'coeur', 'satellite')) then
            raise exception 'role invalide (reserve, coeur ou satellite attendu)';
          end if;
          if v ? 'role_source' and jsonb_typeof(v->'role_source') <> 'null' and (jsonb_typeof(v->'role_source') <> 'string' or (v->>'role_source') not in ('propose', 'valide')) then
            raise exception 'role_source invalide (propose ou valide attendu)';
          end if;
          if p.operation = 'creer' then
            if v->>'role_source' is not null and v->>'role' is null then raise exception 'role_source sans role (le rôle de la ligne est attendu avec sa source)'; end if;
            insert into public.positions (user_id, name, envelope, owner, bloc, mode, isin, qty, pru, price_override, value, value_date,
                                          status, hypothesis, qty_estimated, note, role, role_source)
            values (v_uid, coalesce(nullif(btrim(v->>'name'), ''), 'Sans nom'), coalesce(v->>'envelope', ''), coalesce(v->>'owner', 'p1'),
                    coalesce(v->>'bloc', ''),
                    coalesce(v->>'mode', case when v_isin is not null and v->>'qty' is not null then 'market' else 'manual' end),
                    v_isin, (v->>'qty')::numeric, (v->>'pru')::numeric, (v->>'price_override')::numeric, (v->>'value')::numeric,
                    coalesce((v->>'value_date')::date, case when v->>'value' is not null then current_date end),
                    coalesce(v->>'status', 'actif'), v->>'hypothesis', coalesce((v->>'qty_estimated')::boolean, false), v->>'note',
                    v->>'role', v->>'role_source')
            returning id into v_id;
          else
            v_id := p.ref::uuid;
            update public.positions set
              name           = case when v ? 'name' then coalesce(nullif(btrim(v->>'name'), ''), name) else name end,
              envelope       = case when v ? 'envelope' then coalesce(v->>'envelope', '') else envelope end,
              owner          = case when v ? 'owner' then v->>'owner' else owner end,
              bloc           = case when v ? 'bloc' then coalesce(v->>'bloc', '') else bloc end,
              mode           = case when v ? 'mode' then v->>'mode' else mode end,
              isin           = case when v ? 'isin' then v_isin else isin end,
              qty            = case when v ? 'qty' then (v->>'qty')::numeric else qty end,
              pru            = case when v ? 'pru' then (v->>'pru')::numeric else pru end,
              price_override = case when v ? 'price_override' then (v->>'price_override')::numeric else price_override end,
              value          = case when v ? 'value' then (v->>'value')::numeric else value end,
              value_date     = case when v ? 'value_date' then (v->>'value_date')::date when v ? 'value' then current_date else value_date end,
              status         = case when v ? 'status' then v->>'status' else status end,
              hypothesis     = case when v ? 'hypothesis' then v->>'hypothesis' else hypothesis end,
              qty_estimated  = case when v ? 'qty_estimated' then coalesce((v->>'qty_estimated')::boolean, false) else qty_estimated end,
              note           = case when v ? 'note' then v->>'note' else note end,
              role           = case when v ? 'role' then v->>'role' else role end,
              role_source    = case when v ? 'role_source' then v->>'role_source' when v ? 'role' and v->>'role' is null then null else role_source end
            where id = v_id and user_id = v_uid;
            get diagnostics v_n = row_count;
            if v_n = 0 then raise exception 'ligne « % » introuvable', p.ref; end if;
          end if;
          if jsonb_typeof(v->'transaction') = 'object' then
            v_tx := v->'transaction';
            insert into public.transactions (user_id, position_id, date, type, qty, price, amount, note, source)
            values (v_uid, v_id, coalesce((v_tx->>'date')::date, current_date), coalesce(nullif(v_tx->>'type', ''), 'autre'),
                    (v_tx->>'qty')::numeric, (v_tx->>'price')::numeric, (v_tx->>'amount')::numeric, v_tx->>'note',
                    coalesce(nullif(v_tx->>'source', ''), 'mcp'));
          end if;
        end if;

      /* ---------- biens immobiliers ---------- */
      when 'bien' then
        if p.operation = 'supprimer' then
          delete from public.biens where id = p.ref::uuid and user_id = v_uid;
        elsif p.operation = 'creer' then
          insert into public.biens (user_id, nom, usage, valeur, part_p1, crd, mensualite, loyer)
          values (v_uid, coalesce(btrim(v->>'nom'), ''), coalesce(v->>'usage', 'rp'), coalesce((v->>'valeur')::numeric, 0),
                  coalesce((v->>'part_p1')::numeric, 100), coalesce((v->>'crd')::numeric, 0), coalesce((v->>'mensualite')::numeric, 0),
                  coalesce((v->>'loyer')::numeric, 0));
        else
          update public.biens set
            nom        = case when v ? 'nom' then coalesce(btrim(v->>'nom'), '') else nom end,
            usage      = case when v ? 'usage' then v->>'usage' else usage end,
            valeur     = case when v ? 'valeur' then coalesce((v->>'valeur')::numeric, 0) else valeur end,
            part_p1    = case when v ? 'part_p1' then coalesce((v->>'part_p1')::numeric, 100) else part_p1 end,
            crd        = case when v ? 'crd' then coalesce((v->>'crd')::numeric, 0) else crd end,
            mensualite = case when v ? 'mensualite' then coalesce((v->>'mensualite')::numeric, 0) else mensualite end,
            loyer      = case when v ? 'loyer' then coalesce((v->>'loyer')::numeric, 0) else loyer end
          where id = p.ref::uuid and user_id = v_uid;
        end if;
        if p.operation <> 'creer' then
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'bien « % » introuvable', p.ref; end if;
        end if;

      /* ---------- crédits ---------- */
      when 'credit' then
        if p.operation = 'supprimer' then
          delete from public.credits where id = p.ref::uuid and user_id = v_uid;
        elsif p.operation = 'creer' then
          insert into public.credits (user_id, nom, owner, crd, mensualite)
          values (v_uid, coalesce(btrim(v->>'nom'), ''), coalesce(v->>'owner', 'commun'), coalesce((v->>'crd')::numeric, 0),
                  coalesce((v->>'mensualite')::numeric, 0));
        else
          update public.credits set
            nom        = case when v ? 'nom' then coalesce(btrim(v->>'nom'), '') else nom end,
            owner      = case when v ? 'owner' then v->>'owner' else owner end,
            crd        = case when v ? 'crd' then coalesce((v->>'crd')::numeric, 0) else crd end,
            mensualite = case when v ? 'mensualite' then coalesce((v->>'mensualite')::numeric, 0) else mensualite end
          where id = p.ref::uuid and user_id = v_uid;
        end if;
        if p.operation <> 'creer' then
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'crédit « % » introuvable', p.ref; end if;
        end if;

      /* ---------- objectifs (date_cible, ou dateCible accepté) ---------- */
      when 'objectif' then
        if p.operation = 'supprimer' then
          delete from public.objectifs where id = p.ref::uuid and user_id = v_uid;
        elsif p.operation = 'creer' then
          insert into public.objectifs (user_id, nom, type, cible, date_cible, deja, source, poches, enveloppes, rendement, priorite)
          values (v_uid, coalesce(btrim(v->>'nom'), ''), coalesce(v->>'type', 'projet'), coalesce((v->>'cible')::numeric, 0),
                  coalesce(v->>'date_cible', v->>'dateCible')::date, coalesce((v->>'deja')::numeric, 0), coalesce(v->>'source', 'saisi'),
                  case when jsonb_typeof(v->'poches') = 'array' then array(select jsonb_array_elements_text(v->'poches')) else '{}'::text[] end,
                  case when jsonb_typeof(v->'enveloppes') = 'array' then array(select jsonb_array_elements_text(v->'enveloppes')) else '{}'::text[] end,
                  coalesce((v->>'rendement')::numeric, 2), coalesce((v->>'priorite')::int, 0));
        else
          update public.objectifs set
            nom        = case when v ? 'nom' then coalesce(btrim(v->>'nom'), '') else nom end,
            type       = case when v ? 'type' then v->>'type' else type end,
            cible      = case when v ? 'cible' then coalesce((v->>'cible')::numeric, 0) else cible end,
            date_cible = case when v ? 'date_cible' then (v->>'date_cible')::date when v ? 'dateCible' then (v->>'dateCible')::date else date_cible end,
            deja       = case when v ? 'deja' then coalesce((v->>'deja')::numeric, 0) else deja end,
            source     = case when v ? 'source' then v->>'source' else source end,
            poches     = case when v ? 'poches' then (case when jsonb_typeof(v->'poches') = 'array' then array(select jsonb_array_elements_text(v->'poches')) else '{}'::text[] end) else poches end,
            enveloppes = case when v ? 'enveloppes' then (case when jsonb_typeof(v->'enveloppes') = 'array' then array(select jsonb_array_elements_text(v->'enveloppes')) else '{}'::text[] end) else enveloppes end,
            rendement  = case when v ? 'rendement' then coalesce((v->>'rendement')::numeric, 2) else rendement end,
            priorite   = case when v ? 'priorite' then coalesce((v->>'priorite')::int, 0) else priorite end
          where id = p.ref::uuid and user_id = v_uid;
        end if;
        if p.operation <> 'creer' then
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'objectif « % » introuvable', p.ref; end if;
        end if;

      /* ---------- profil de risque : réponses fusionnées, date / profil / score conservés ---------- */
      when 'risque' then
        v_obj := case when jsonb_typeof(v->'reponses') = 'object' then v->'reponses' else v end;
        select k into v_key from jsonb_object_keys(v_obj) k
         where k not in ('horizon', 'objectif', 'reaction', 'perte_max', 'connaissances', 'experience', 'revenus', 'matelas', 'part_investie', 'age')
         limit 1;
        if v_key is not null then raise exception 'question « % » inconnue', v_key; end if;
        insert into public.profiles (user_id) values (v_uid) on conflict (user_id) do nothing;
        update public.profiles set risque = jsonb_set(
            case when jsonb_typeof(risque) = 'object' then risque else '{}'::jsonb end, '{reponses}',
            case when jsonb_typeof(risque->'reponses') = 'object' then risque->'reponses' else '{}'::jsonb end || v_obj, true)
         where user_id = v_uid;

      /* ---------- protection : fusion dans profiles.protection ---------- */
      when 'protection' then
        insert into public.profiles (user_id) values (v_uid) on conflict (user_id) do nothing;
        update public.profiles set protection = jsonb_strip_nulls(coalesce(protection, '{}'::jsonb) || v) where user_id = v_uid;

      /* ---------- réglages (0019) : matelas de précaution et versements programmés, rien d'autre ---------- */
      when 'config' then
        if p.operation <> 'modifier' then raise exception 'réglages : seule la modification est possible'; end if;
        select k into v_key from jsonb_object_keys(v) k
         where k not in ('cushion', 'recurring', 'frais_enveloppes', 'enveloppes_infos', 'prets_infos', 'donations', 'avis_impot', 'projection', 'suivi') limit 1;
        if v_key is not null then
          raise exception 'réglage « % » non modifiable par proposition (cushion, recurring, frais_enveloppes, enveloppes_infos, prets_infos, donations, avis_impot, projection ou suivi seulement)', v_key;
        end if;
        if not (v ? 'cushion' or v ? 'recurring' or v ? 'frais_enveloppes' or v ? 'enveloppes_infos' or v ? 'prets_infos' or v ? 'donations' or v ? 'avis_impot' or v ? 'projection' or v ? 'suivi') then
          raise exception 'réglages : cushion ou recurring attendu (ou frais_enveloppes, enveloppes_infos, prets_infos, donations, avis_impot, projection ou suivi)';
        end if;
        insert into public.config (user_id) values (v_uid) on conflict (user_id) do nothing;

        -- cushion : { mode: "amount", min ≥ 0, max ≥ min ou null } ou { mode: "months", months > 0, depenses > 0 } ; remplacé en entier.
        if v ? 'cushion' then
          v_obj := v->'cushion';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'cushion : objet attendu'; end if;
          if v_obj->>'mode' = 'months' then
            select k into v_key from jsonb_object_keys(v_obj) k where k not in ('mode', 'months', 'depenses') limit 1;
            if v_key is not null then raise exception 'cushion : champ « % » inconnu (mode, months, depenses)', v_key; end if;
            begin v_num := (v_obj->>'months')::numeric; exception when others then v_num := null; end;
            if v_num is null or v_num <= 0 or v_num > 120 then raise exception 'cushion.months invalide (nombre de mois entre 0 et 120 attendu)'; end if;
            begin v_num2 := (v_obj->>'depenses')::numeric; exception when others then v_num2 := null; end;
            if v_num2 is null or v_num2 <= 0 then raise exception 'cushion.depenses invalide (dépenses mensuelles positives attendues)'; end if;
            v_obj := jsonb_build_object('mode', 'months', 'months', v_num, 'depenses', v_num2);
          elsif v_obj->>'mode' = 'amount' then
            select k into v_key from jsonb_object_keys(v_obj) k where k not in ('mode', 'min', 'max') limit 1;
            if v_key is not null then raise exception 'cushion : champ « % » inconnu (mode, min, max)', v_key; end if;
            begin v_num := (v_obj->>'min')::numeric; exception when others then v_num := null; end;
            if v_num is null or v_num < 0 then raise exception 'cushion.min invalide (montant positif attendu)'; end if;
            v_num2 := null;
            if v_obj ? 'max' and jsonb_typeof(v_obj->'max') <> 'null' then
              begin v_num2 := (v_obj->>'max')::numeric; exception when others then v_num2 := null; end;
              if v_num2 is null or v_num2 < v_num then raise exception 'cushion.max invalide (montant au moins égal au minimum, ou null)'; end if;
            end if;
            v_obj := jsonb_build_object('mode', 'amount', 'min', v_num, 'max', v_num2);
          else
            raise exception 'cushion.mode « % » inconnu (amount ou months)', coalesce(v_obj->>'mode', '');
          end if;
          update public.config set cushion = v_obj where user_id = v_uid;
        end if;

        -- recurring : la liste fournie remplace la liste existante. Chaque versement { id, label, positionId, amount > 0,
        -- day 1-28, start?, … } (champs inconnus conservés) ; lastApplied est tenu par l'agent nocturne (apply_recurring) :
        -- repris de la base pour un id existant, retiré pour un nouveau versement (jamais celui de la proposition).
        if v ? 'recurring' then
          v_lignes := v->'recurring';
          if jsonb_typeof(v_lignes) is distinct from 'array' then raise exception 'recurring : liste de versements attendue'; end if;
          if jsonb_array_length(v_lignes) > 50 then raise exception 'recurring : 50 versements au plus'; end if;
          select k.recurring into v_rec from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_rec) is distinct from 'array' then v_rec := '[]'::jsonb; end if;
          v_cfg := '[]'::jsonb;
          v_ids := '{}'::text[];
          for v_ligne, v_idx in select o.e, o.i::int from jsonb_array_elements(v_lignes) with ordinality as o(e, i) loop
            if jsonb_typeof(v_ligne) <> 'object' then raise exception 'versement % : objet attendu', v_idx; end if;
            v_key := nullif(btrim(v_ligne->>'id'), '');
            if v_key is null or char_length(v_key) > 64 then raise exception 'versement % : identifiant (id) manquant ou trop long', v_idx; end if;
            if v_key = any(v_ids) then raise exception 'versement % : identifiant « % » en double', v_idx, v_key; end if;
            v_ids := v_ids || v_key;
            v_txt := nullif(btrim(v_ligne->>'label'), '');
            if v_txt is null or char_length(v_txt) > 80 then raise exception 'versement % : libellé (label) manquant ou trop long (80 caractères au plus)', v_idx; end if;
            if not exists (select 1 from public.positions x
                            where x.user_id = v_uid and x.id::text = (v_ligne->>'positionId') and x.status <> 'clôturé') then
              raise exception 'versement « % » : ligne « % » introuvable ou clôturée', v_txt, coalesce(v_ligne->>'positionId', '');
            end if;
            begin v_num := (v_ligne->>'amount')::numeric; exception when others then v_num := null; end;
            if v_num is null or v_num <= 0 then raise exception 'versement « % » : montant (amount) invalide (nombre strictement positif attendu)', v_txt; end if;
            begin v_num2 := (v_ligne->>'day')::numeric; exception when others then v_num2 := null; end;
            if v_num2 is null or v_num2 <> trunc(v_num2) or v_num2 < 1 or v_num2 > 28 then
              raise exception 'versement « % » : jour (day) invalide (entier de 1 à 28)', v_txt;
            end if;
            v_ligne := v_ligne || jsonb_build_object('id', v_key, 'label', v_txt, 'amount', v_num, 'day', v_num2::int);
            if jsonb_typeof(v_ligne->'start') is not null and jsonb_typeof(v_ligne->'start') <> 'null' then
              begin
                v_ligne := jsonb_set(v_ligne, '{start}', to_jsonb(to_char((v_ligne->>'start')::date, 'YYYY-MM-DD')));
              exception when others then
                raise exception 'versement « % » : date de début (start) invalide (AAAA-MM-JJ)', v_txt;
              end;
            end if;
            v_ligne := v_ligne - 'lastApplied';
            select e->'lastApplied' into v_val from jsonb_array_elements(v_rec) e
             where jsonb_typeof(e) = 'object' and e->>'id' = v_key and jsonb_typeof(e->'lastApplied') = 'string' limit 1;
            if v_val is not null then v_ligne := v_ligne || jsonb_build_object('lastApplied', v_val); end if;
            v_cfg := v_cfg || jsonb_build_array(v_ligne);
          end loop;
          update public.config set recurring = v_cfg where user_id = v_uid;
        end if;

        -- frais_enveloppes (0026, 0032) : { "<enveloppe>": { gestion_uc_pct?, gestion_euro_pct?, garde_pct?, arbitrage_pct?, courtage_pct?, source, le? } | null },
        -- fusionné par enveloppe dans config.frais_enveloppes (une enveloppe fournie remplace l'existante en entier, null la retire) ;
        -- pourcentages par an de 0 à 5 (au moins un), source obligatoire (1 à 300 caractères), le en AAAA-MM-JJ (date du jour par
        -- défaut) ; 30 enveloppes au plus, avant comme après la fusion.
        if v ? 'frais_enveloppes' then
          v_obj := v->'frais_enveloppes';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'frais_enveloppes : objet { enveloppe: frais } attendu'; end if;
          select count(*) into v_n from jsonb_object_keys(v_obj);
          if v_n > 30 then raise exception 'frais_enveloppes : 30 enveloppes au plus'; end if;
          select k.frais_enveloppes into v_fe from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_fe) is distinct from 'object' then v_fe := '{}'::jsonb; end if;
          for v_key, v_val in select e.key, e.value from jsonb_each(v_obj) e loop
            v_env := btrim(v_key);
            if v_env = '' or char_length(v_env) > 80 then raise exception 'frais_enveloppes : nom d''enveloppe invalide (1 à 80 caractères)'; end if;
            if jsonb_typeof(v_val) = 'null' then
              v_fe := v_fe - v_env;
              continue;
            end if;
            if jsonb_typeof(v_val) <> 'object' then raise exception 'frais_enveloppes « % » : objet ou null attendu', v_env; end if;
            select k into v_txt from jsonb_object_keys(v_val) k where k not in ('gestion_uc_pct', 'gestion_euro_pct', 'garde_pct', 'arbitrage_pct', 'courtage_pct', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'frais_enveloppes « % » : champ « % » inconnu (gestion_uc_pct, gestion_euro_pct, garde_pct, arbitrage_pct, courtage_pct, source, le)', v_env, v_txt;
            end if;
            v_ligne := '{}'::jsonb;
            foreach v_txt in array array['gestion_uc_pct', 'gestion_euro_pct', 'garde_pct', 'arbitrage_pct', 'courtage_pct'] loop
              continue when jsonb_typeof(v_val->v_txt) is null or jsonb_typeof(v_val->v_txt) = 'null';
              v_num := null;
              if jsonb_typeof(v_val->v_txt) in ('number', 'string') then
                begin v_num := (v_val->>v_txt)::numeric; exception when others then v_num := null; end;
              end if;
              if v_num is null or v_num < 0 or v_num > 5 then
                raise exception 'frais_enveloppes « % » : % invalide (pourcentage par an entre 0 et 5 attendu)', v_env, v_txt;
              end if;
              v_ligne := v_ligne || jsonb_build_object(v_txt, v_num);
            end loop;
            if v_ligne = '{}'::jsonb then
              raise exception 'frais_enveloppes « % » : au moins un pourcentage attendu (gestion_uc_pct, gestion_euro_pct, garde_pct, arbitrage_pct ou courtage_pct)', v_env;
            end if;
            v_txt := btrim(case when jsonb_typeof(v_val->'source') = 'string' then v_val->>'source' else '' end);
            if v_txt = '' or char_length(v_txt) > 300 then raise exception 'frais_enveloppes « % » : source obligatoire (1 à 300 caractères)', v_env; end if;
            v_le := (now() at time zone 'Europe/Paris')::date;
            if jsonb_typeof(v_val->'le') is not null and jsonb_typeof(v_val->'le') <> 'null' then
              begin
                if jsonb_typeof(v_val->'le') <> 'string' or (v_val->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_le := (v_val->>'le')::date;
              exception when others then
                raise exception 'frais_enveloppes « % » : date (le) invalide (AAAA-MM-JJ)', v_env;
              end;
              if v_le > (now() at time zone 'Europe/Paris')::date then
                raise exception 'frais_enveloppes « % » : date (le) dans le futur (la date du document consulté est attendue)', v_env;
              end if;
            end if;
            v_fe := jsonb_set(v_fe, array[v_env], v_ligne || jsonb_build_object('source', v_txt, 'le', to_char(v_le, 'YYYY-MM-DD')), true);
          end loop;
          select count(*) into v_n from jsonb_object_keys(v_fe);
          if v_n > 30 then raise exception 'frais_enveloppes : 30 enveloppes au plus (% après fusion)', v_n; end if;
          update public.config set frais_enveloppes = v_fe where user_id = v_uid;
        end if;

        -- enveloppes_infos (0029) : { "<enveloppe>" | "<enveloppe>|p1" | "<enveloppe>|p2": { type, titulaire, date_ouverture?,
        -- date_ouverture_approx?, date_cloture?, versements_cumules?, versements_avant_70?, beneficiaires_revus_le?, versements? (pee, percol),
        -- moins_values? (compte_titres), source, le? } | null }, fusionné par clé dans config.enveloppes_infos (une enveloppe fournie remplace
        -- l'existante en entier, null la retire). Le suffixe |p1 ou |p2 de la clé doit être celui du titulaire. Dates réelles, jamais dans le
        -- futur (date de Paris) et à partir de 1950 ; date_ouverture et date_ouverture_approx s'excluent ; montants positifs ou nuls ;
        -- source obligatoire (1 à 300 caractères) ; le en AAAA-MM-JJ (date du jour par défaut) ; 30 enveloppes au plus, avant comme après la fusion.
        if v ? 'enveloppes_infos' then
          v_obj := v->'enveloppes_infos';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'enveloppes_infos : objet { enveloppe: informations } attendu'; end if;
          select count(*) into v_n from jsonb_object_keys(v_obj);
          if v_n > 30 then raise exception 'enveloppes_infos : 30 enveloppes au plus'; end if;
          select k.enveloppes_infos into v_ei from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_ei) is distinct from 'object' then v_ei := '{}'::jsonb; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          for v_key, v_val in select e.key, e.value from jsonb_each(v_obj) e loop
            v_env := btrim(v_key);
            v_nom := regexp_replace(v_env, '\|p[12]$', '');
            if v_nom = '' or v_nom <> btrim(v_nom) or char_length(v_nom) > 80 then raise exception 'enveloppes_infos : nom d''enveloppe invalide (1 à 80 caractères)'; end if;
            if jsonb_typeof(v_val) = 'null' then
              v_ei := v_ei - v_env;
              continue;
            end if;
            if jsonb_typeof(v_val) <> 'object' then raise exception 'enveloppes_infos « % » : objet ou null attendu', v_env; end if;
            select k into v_txt from jsonb_object_keys(v_val) k where k not in ('type', 'titulaire', 'date_ouverture', 'date_ouverture_approx', 'date_cloture',
              'versements_cumules', 'versements_avant_70', 'beneficiaires_revus_le', 'versements', 'moins_values', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'enveloppes_infos « % » : champ « % » inconnu (type, titulaire, date_ouverture, date_ouverture_approx, date_cloture, versements_cumules, versements_avant_70, beneficiaires_revus_le, versements, moins_values, source, le)', v_env, v_txt;
            end if;
            if jsonb_typeof(v_val->'type') is distinct from 'string' or (v_val->>'type') not in ('pea', 'pea_pme', 'pea_jeune', 'assurance_vie',
                'capitalisation', 'per', 'pel', 'cel', 'pee', 'percol', 'compte_titres', 'livret_a', 'ldds', 'lep', 'autre') then
              raise exception 'enveloppes_infos « % » : type invalide (pea, pea_pme, pea_jeune, assurance_vie, capitalisation, per, pel, cel, pee, percol, compte_titres, livret_a, ldds, lep ou autre attendu)', v_env;
            end if;
            if jsonb_typeof(v_val->'titulaire') is distinct from 'string' or (v_val->>'titulaire') not in ('p1', 'p2') then
              raise exception 'enveloppes_infos « % » : titulaire invalide (p1 ou p2 attendu)', v_env;
            end if;
            v_sfx := substring(v_env from '\|(p[12])$');
            if v_sfx is not null and v_sfx <> (v_val->>'titulaire') then
              raise exception 'enveloppes_infos « % » : la clé se termine par |% mais le titulaire est %', v_env, v_sfx, v_val->>'titulaire';
            end if;
            v_ligne := jsonb_build_object('type', v_val->>'type', 'titulaire', v_val->>'titulaire');
            -- dates exactes
            foreach v_txt in array array['date_ouverture', 'date_cloture', 'beneficiaires_revus_le'] loop
              continue when jsonb_typeof(v_val->v_txt) is null or jsonb_typeof(v_val->v_txt) = 'null';
              begin
                if jsonb_typeof(v_val->v_txt) <> 'string' or (v_val->>v_txt) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_dt := (v_val->>v_txt)::date;
              exception when others then
                raise exception 'enveloppes_infos « % » : % invalide (AAAA-MM-JJ)', v_env, v_txt;
              end;
              if v_dt > v_auj then raise exception 'enveloppes_infos « % » : % dans le futur', v_env, v_txt; end if;
              if v_dt < date '1950-01-01' then raise exception 'enveloppes_infos « % » : % antérieure à 1950', v_env, v_txt; end if;
              v_ligne := v_ligne || jsonb_build_object(v_txt, to_char(v_dt, 'YYYY-MM-DD'));
            end loop;
            -- date d'ouverture approchée : AAAA ou AAAA-MM
            if jsonb_typeof(v_val->'date_ouverture_approx') is not null and jsonb_typeof(v_val->'date_ouverture_approx') <> 'null' then
              if v_ligne ? 'date_ouverture' then raise exception 'enveloppes_infos « % » : date_ouverture et date_ouverture_approx ne vont pas ensemble', v_env; end if;
              begin
                if jsonb_typeof(v_val->'date_ouverture_approx') <> 'string' or (v_val->>'date_ouverture_approx') !~ '^\d{4}(-\d{2})?$' then raise exception 'format'; end if;
                v_dt := (case when char_length(v_val->>'date_ouverture_approx') = 4 then (v_val->>'date_ouverture_approx') || '-01-01'
                              else (v_val->>'date_ouverture_approx') || '-01' end)::date;
              exception when others then
                raise exception 'enveloppes_infos « % » : date_ouverture_approx invalide (AAAA ou AAAA-MM)', v_env;
              end;
              if v_dt > v_auj then raise exception 'enveloppes_infos « % » : date_ouverture_approx dans le futur', v_env; end if;
              if v_dt < date '1950-01-01' then raise exception 'enveloppes_infos « % » : date_ouverture_approx antérieure à 1950', v_env; end if;
              v_ligne := v_ligne || jsonb_build_object('date_ouverture_approx', v_val->>'date_ouverture_approx');
            end if;
            if v_ligne ? 'date_cloture' and v_ligne ? 'date_ouverture' and (v_ligne->>'date_cloture')::date < (v_ligne->>'date_ouverture')::date then
              raise exception 'enveloppes_infos « % » : date_cloture avant date_ouverture', v_env;
            end if;
            -- montants
            foreach v_txt in array array['versements_cumules', 'versements_avant_70'] loop
              continue when jsonb_typeof(v_val->v_txt) is null or jsonb_typeof(v_val->v_txt) = 'null';
              v_num := null;
              if jsonb_typeof(v_val->v_txt) = 'number' or (jsonb_typeof(v_val->v_txt) = 'string' and (v_val->>v_txt) ~ '^\d+(\.\d+)?$') then
                v_num := (v_val->>v_txt)::numeric;
              end if;
              if v_num is null or v_num < 0 then raise exception 'enveloppes_infos « % » : % invalide (montant positif ou nul attendu)', v_env, v_txt; end if;
              v_ligne := v_ligne || jsonb_build_object(v_txt, v_num);
            end loop;
            if v_ligne ? 'versements_avant_70' and v_ligne ? 'versements_cumules'
               and (v_ligne->>'versements_avant_70')::numeric > (v_ligne->>'versements_cumules')::numeric then
              raise exception 'enveloppes_infos « % » : versements_avant_70 supérieur à versements_cumules', v_env;
            end if;
            -- versements d'épargne salariale (pee, percol) : [{ le, montant, origine, disponible_le? }], 120 au plus
            if jsonb_typeof(v_val->'versements') is not null and jsonb_typeof(v_val->'versements') <> 'null' then
              if (v_val->>'type') not in ('pee', 'percol') then raise exception 'enveloppes_infos « % » : versements réservés aux types pee et percol', v_env; end if;
              v_lignes := v_val->'versements';
              if jsonb_typeof(v_lignes) <> 'array' then raise exception 'enveloppes_infos « % » : versements : liste attendue', v_env; end if;
              if jsonb_array_length(v_lignes) > 120 then raise exception 'enveloppes_infos « % » : versements : 120 au plus', v_env; end if;
              v_cfg := '[]'::jsonb;
              for v_item, v_idx in select o.e, o.i::int from jsonb_array_elements(v_lignes) with ordinality as o(e, i) loop
                if jsonb_typeof(v_item) <> 'object' then raise exception 'enveloppes_infos « % » : versement % : objet attendu', v_env, v_idx; end if;
                select k into v_txt from jsonb_object_keys(v_item) k where k not in ('le', 'montant', 'origine', 'disponible_le') limit 1;
                if v_txt is not null then
                  raise exception 'enveloppes_infos « % » : versement % : champ « % » inconnu (le, montant, origine, disponible_le)', v_env, v_idx, v_txt;
                end if;
                begin
                  if jsonb_typeof(v_item->'le') is distinct from 'string' or (v_item->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                  v_dt := (v_item->>'le')::date;
                exception when others then
                  raise exception 'enveloppes_infos « % » : versement % : date (le) invalide (AAAA-MM-JJ)', v_env, v_idx;
                end;
                if v_dt > v_auj then raise exception 'enveloppes_infos « % » : versement % : date (le) dans le futur', v_env, v_idx; end if;
                if v_dt < date '1950-01-01' then raise exception 'enveloppes_infos « % » : versement % : date (le) antérieure à 1950', v_env, v_idx; end if;
                v_num := null;
                if jsonb_typeof(v_item->'montant') = 'number' or (jsonb_typeof(v_item->'montant') = 'string' and (v_item->>'montant') ~ '^\d+(\.\d+)?$') then
                  v_num := (v_item->>'montant')::numeric;
                end if;
                if v_num is null or v_num < 0 then raise exception 'enveloppes_infos « % » : versement % : montant invalide (montant positif ou nul attendu)', v_env, v_idx; end if;
                if jsonb_typeof(v_item->'origine') is distinct from 'string' or (v_item->>'origine') not in ('versement', 'abondement', 'participation', 'interessement') then
                  raise exception 'enveloppes_infos « % » : versement % : origine invalide (versement, abondement, participation ou interessement attendu)', v_env, v_idx;
                end if;
                v_row := jsonb_build_object('le', to_char(v_dt, 'YYYY-MM-DD'), 'montant', v_num, 'origine', v_item->>'origine');
                if jsonb_typeof(v_item->'disponible_le') is not null and jsonb_typeof(v_item->'disponible_le') <> 'null' then
                  begin
                    if jsonb_typeof(v_item->'disponible_le') <> 'string' or (v_item->>'disponible_le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                    v_dt2 := (v_item->>'disponible_le')::date;
                  exception when others then
                    raise exception 'enveloppes_infos « % » : versement % : disponible_le invalide (AAAA-MM-JJ)', v_env, v_idx;
                  end;
                  if v_dt2 < v_dt then raise exception 'enveloppes_infos « % » : versement % : disponible_le avant la date du versement', v_env, v_idx; end if;
                  v_row := v_row || jsonb_build_object('disponible_le', to_char(v_dt2, 'YYYY-MM-DD'));
                end if;
                v_cfg := v_cfg || jsonb_build_array(v_row);
              end loop;
              if jsonb_array_length(v_cfg) > 0 then v_ligne := v_ligne || jsonb_build_object('versements', v_cfg); end if;
            end if;
            -- moins-values reportables (compte_titres) : [{ annee de 2000 à l'année en cours, montant > 0 }], 15 au plus
            if jsonb_typeof(v_val->'moins_values') is not null and jsonb_typeof(v_val->'moins_values') <> 'null' then
              if (v_val->>'type') <> 'compte_titres' then raise exception 'enveloppes_infos « % » : moins_values réservées au type compte_titres', v_env; end if;
              v_lignes := v_val->'moins_values';
              if jsonb_typeof(v_lignes) <> 'array' then raise exception 'enveloppes_infos « % » : moins_values : liste attendue', v_env; end if;
              if jsonb_array_length(v_lignes) > 15 then raise exception 'enveloppes_infos « % » : moins_values : 15 au plus', v_env; end if;
              v_cfg := '[]'::jsonb;
              for v_item, v_idx in select o.e, o.i::int from jsonb_array_elements(v_lignes) with ordinality as o(e, i) loop
                if jsonb_typeof(v_item) <> 'object' then raise exception 'enveloppes_infos « % » : moins-value % : objet attendu', v_env, v_idx; end if;
                select k into v_txt from jsonb_object_keys(v_item) k where k not in ('annee', 'montant') limit 1;
                if v_txt is not null then
                  raise exception 'enveloppes_infos « % » : moins-value % : champ « % » inconnu (annee, montant)', v_env, v_idx, v_txt;
                end if;
                v_num2 := null;
                if jsonb_typeof(v_item->'annee') = 'number' or (jsonb_typeof(v_item->'annee') = 'string' and (v_item->>'annee') ~ '^\d{4}$') then
                  v_num2 := (v_item->>'annee')::numeric;
                end if;
                if v_num2 is null or v_num2 <> trunc(v_num2) or v_num2 < 2000 or v_num2 > extract(year from v_auj) then
                  raise exception 'enveloppes_infos « % » : moins-value % : annee invalide (entier de 2000 à l''année en cours attendu)', v_env, v_idx;
                end if;
                v_num := null;
                if jsonb_typeof(v_item->'montant') = 'number' or (jsonb_typeof(v_item->'montant') = 'string' and (v_item->>'montant') ~ '^\d+(\.\d+)?$') then
                  v_num := (v_item->>'montant')::numeric;
                end if;
                if v_num is null or v_num <= 0 then raise exception 'enveloppes_infos « % » : moins-value % : montant invalide (montant strictement positif attendu)', v_env, v_idx; end if;
                v_cfg := v_cfg || jsonb_build_array(jsonb_build_object('annee', v_num2::int, 'montant', v_num));
              end loop;
              if jsonb_array_length(v_cfg) > 0 then v_ligne := v_ligne || jsonb_build_object('moins_values', v_cfg); end if;
            end if;
            v_txt := btrim(case when jsonb_typeof(v_val->'source') = 'string' then v_val->>'source' else '' end);
            if v_txt = '' or char_length(v_txt) > 300 then raise exception 'enveloppes_infos « % » : source obligatoire (1 à 300 caractères)', v_env; end if;
            v_le := v_auj;
            if jsonb_typeof(v_val->'le') is not null and jsonb_typeof(v_val->'le') <> 'null' then
              begin
                if jsonb_typeof(v_val->'le') <> 'string' or (v_val->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_le := (v_val->>'le')::date;
              exception when others then
                raise exception 'enveloppes_infos « % » : date (le) invalide (AAAA-MM-JJ)', v_env;
              end;
              if v_le > v_auj then
                raise exception 'enveloppes_infos « % » : date (le) dans le futur (la date du document consulté est attendue)', v_env;
              end if;
            end if;
            v_ei := jsonb_set(v_ei, array[v_env], v_ligne || jsonb_build_object('source', v_txt, 'le', to_char(v_le, 'YYYY-MM-DD')), true);
          end loop;
          select count(*) into v_n from jsonb_object_keys(v_ei);
          if v_n > 30 then raise exception 'enveloppes_infos : 30 enveloppes au plus (% après fusion)', v_n; end if;
          update public.config set enveloppes_infos = v_ei where user_id = v_uid;
        end if;

        -- prets_infos (0029) : { "credit:<identifiant>" | "bien:<identifiant>": { date_signature?, date_fin?, duree_mois?, taux_pct?,
        -- assurance_taux_pct?, ira_exoneration?, source, le? } | null }, fusionné par clé dans config.prets_infos (un prêt fourni remplace
        -- l'existant en entier, null le retire, y compris quand la ligne n'existe plus). La clé désigne un crédit ou un bien de
        -- l'utilisateur : celle d'un autre utilisateur est refusée comme une ligne inexistante (même message). date_fin après
        -- date_signature, duree_mois de 1 à 480, taux_pct de 0 à 20, assurance_taux_pct de 0 à 5 ; au moins un champ hors source et le ;
        -- 50 prêts au plus, avant comme après la fusion.
        if v ? 'prets_infos' then
          v_obj := v->'prets_infos';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'prets_infos : objet { prêt: informations } attendu'; end if;
          select count(*) into v_n from jsonb_object_keys(v_obj);
          if v_n > 50 then raise exception 'prets_infos : 50 prêts au plus'; end if;
          select k.prets_infos into v_pi from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_pi) is distinct from 'object' then v_pi := '{}'::jsonb; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          for v_key, v_val in select e.key, e.value from jsonb_each(v_obj) e loop
            v_env := lower(btrim(v_key));
            if v_env !~ '^(credit|bien):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
              raise exception 'prets_infos : clé « % » invalide (credit:<identifiant> ou bien:<identifiant> attendu)', v_key;
            end if;
            if jsonb_typeof(v_val) = 'null' then
              v_pi := v_pi - v_env;
              continue;
            end if;
            if jsonb_typeof(v_val) <> 'object' then raise exception 'prets_infos « % » : objet ou null attendu', v_env; end if;
            v_id := substring(v_env from ':(.*)$')::uuid;
            if v_env like 'credit:%' then
              if not exists (select 1 from public.credits c where c.id = v_id and c.user_id = v_uid) then raise exception 'prets_infos « % » : crédit introuvable', v_env; end if;
            else
              if not exists (select 1 from public.biens b where b.id = v_id and b.user_id = v_uid) then raise exception 'prets_infos « % » : bien introuvable', v_env; end if;
            end if;
            select k into v_txt from jsonb_object_keys(v_val) k where k not in ('date_signature', 'date_fin', 'duree_mois', 'taux_pct',
              'assurance_taux_pct', 'ira_exoneration', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'prets_infos « % » : champ « % » inconnu (date_signature, date_fin, duree_mois, taux_pct, assurance_taux_pct, ira_exoneration, source, le)', v_env, v_txt;
            end if;
            v_ligne := '{}'::jsonb;
            foreach v_txt in array array['date_signature', 'date_fin'] loop
              continue when jsonb_typeof(v_val->v_txt) is null or jsonb_typeof(v_val->v_txt) = 'null';
              begin
                if jsonb_typeof(v_val->v_txt) <> 'string' or (v_val->>v_txt) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_dt := (v_val->>v_txt)::date;
              exception when others then
                raise exception 'prets_infos « % » : % invalide (AAAA-MM-JJ)', v_env, v_txt;
              end;
              if v_txt = 'date_signature' and v_dt > v_auj then raise exception 'prets_infos « % » : date_signature dans le futur', v_env; end if;
              if v_dt < date '1950-01-01' then raise exception 'prets_infos « % » : % antérieure à 1950', v_env, v_txt; end if;
              v_ligne := v_ligne || jsonb_build_object(v_txt, to_char(v_dt, 'YYYY-MM-DD'));
            end loop;
            if v_ligne ? 'date_signature' and v_ligne ? 'date_fin' and (v_ligne->>'date_fin')::date <= (v_ligne->>'date_signature')::date then
              raise exception 'prets_infos « % » : date_fin à placer après date_signature', v_env;
            end if;
            foreach v_txt in array array['duree_mois', 'taux_pct', 'assurance_taux_pct'] loop
              continue when jsonb_typeof(v_val->v_txt) is null or jsonb_typeof(v_val->v_txt) = 'null';
              v_num := null;
              if jsonb_typeof(v_val->v_txt) = 'number' or (jsonb_typeof(v_val->v_txt) = 'string' and (v_val->>v_txt) ~ '^\d+(\.\d+)?$') then
                v_num := (v_val->>v_txt)::numeric;
              end if;
              if v_txt = 'duree_mois' and (v_num is null or v_num <> trunc(v_num) or v_num < 1 or v_num > 480) then
                raise exception 'prets_infos « % » : duree_mois invalide (entier de 1 à 480 attendu)', v_env;
              elsif v_txt = 'taux_pct' and (v_num is null or v_num < 0 or v_num > 20) then
                raise exception 'prets_infos « % » : taux_pct invalide (pourcentage par an entre 0 et 20 attendu)', v_env;
              elsif v_txt = 'assurance_taux_pct' and (v_num is null or v_num < 0 or v_num > 5) then
                raise exception 'prets_infos « % » : assurance_taux_pct invalide (pourcentage par an entre 0 et 5 attendu)', v_env;
              end if;
              v_ligne := v_ligne || jsonb_build_object(v_txt, v_num);
            end loop;
            if jsonb_typeof(v_val->'ira_exoneration') is not null and jsonb_typeof(v_val->'ira_exoneration') <> 'null' then
              if jsonb_typeof(v_val->'ira_exoneration') <> 'boolean' then raise exception 'prets_infos « % » : ira_exoneration invalide (true ou false attendu)', v_env; end if;
              v_ligne := v_ligne || jsonb_build_object('ira_exoneration', (v_val->>'ira_exoneration')::boolean);
            end if;
            if v_ligne = '{}'::jsonb then
              raise exception 'prets_infos « % » : au moins une information attendue (date_signature, date_fin, duree_mois, taux_pct, assurance_taux_pct ou ira_exoneration)', v_env;
            end if;
            v_txt := btrim(case when jsonb_typeof(v_val->'source') = 'string' then v_val->>'source' else '' end);
            if v_txt = '' or char_length(v_txt) > 300 then raise exception 'prets_infos « % » : source obligatoire (1 à 300 caractères)', v_env; end if;
            v_le := v_auj;
            if jsonb_typeof(v_val->'le') is not null and jsonb_typeof(v_val->'le') <> 'null' then
              begin
                if jsonb_typeof(v_val->'le') <> 'string' or (v_val->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_le := (v_val->>'le')::date;
              exception when others then
                raise exception 'prets_infos « % » : date (le) invalide (AAAA-MM-JJ)', v_env;
              end;
              if v_le > v_auj then
                raise exception 'prets_infos « % » : date (le) dans le futur (la date du document consulté est attendue)', v_env;
              end if;
            end if;
            v_pi := jsonb_set(v_pi, array[v_env], v_ligne || jsonb_build_object('source', v_txt, 'le', to_char(v_le, 'YYYY-MM-DD')), true);
          end loop;
          select count(*) into v_n from jsonb_object_keys(v_pi);
          if v_n > 50 then raise exception 'prets_infos : 50 prêts au plus (% après fusion)', v_n; end if;
          update public.config set prets_infos = v_pi where user_id = v_uid;
        end if;

        -- donations (0029) : la liste fournie remplace la liste existante (modèle de recurring). Chaque donation { id, date, montant > 0,
        -- donateur p1|p2, lien enfant|petit_enfant|arriere_petit_enfant|autre, beneficiaire, nature donation|don_argent_790g|don_logement_790a_bis,
        -- source, le? } ; id uniques (1 à 64 caractères), date jamais dans le futur, beneficiaire de 1 à 40 caractères (libellé au choix de
        -- l'utilisateur), source obligatoire (1 à 300 caractères) ; 100 donations au plus.
        if v ? 'donations' then
          v_lignes := v->'donations';
          if jsonb_typeof(v_lignes) is distinct from 'array' then raise exception 'donations : liste de donations attendue'; end if;
          if jsonb_array_length(v_lignes) > 100 then raise exception 'donations : 100 donations au plus'; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          v_don := '[]'::jsonb;
          v_ids := '{}'::text[];
          for v_item, v_idx in select o.e, o.i::int from jsonb_array_elements(v_lignes) with ordinality as o(e, i) loop
            if jsonb_typeof(v_item) <> 'object' then raise exception 'donation % : objet attendu', v_idx; end if;
            v_key := nullif(btrim(case when jsonb_typeof(v_item->'id') = 'string' then v_item->>'id' else '' end), '');
            if v_key is null or char_length(v_key) > 64 then raise exception 'donation % : identifiant (id) manquant ou trop long (1 à 64 caractères)', v_idx; end if;
            if v_key = any(v_ids) then raise exception 'donation % : identifiant « % » en double', v_idx, v_key; end if;
            v_ids := v_ids || v_key;
            select k into v_txt from jsonb_object_keys(v_item) k where k not in ('id', 'date', 'montant', 'donateur', 'lien', 'beneficiaire', 'nature', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'donations « % » : champ « % » inconnu (id, date, montant, donateur, lien, beneficiaire, nature, source, le)', v_key, v_txt;
            end if;
            begin
              if jsonb_typeof(v_item->'date') is distinct from 'string' or (v_item->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
              v_dt := (v_item->>'date')::date;
            exception when others then
              raise exception 'donations « % » : date invalide (AAAA-MM-JJ)', v_key;
            end;
            if v_dt > v_auj then raise exception 'donations « % » : date dans le futur', v_key; end if;
            v_num := null;
            if jsonb_typeof(v_item->'montant') = 'number' or (jsonb_typeof(v_item->'montant') = 'string' and (v_item->>'montant') ~ '^\d+(\.\d+)?$') then
              v_num := (v_item->>'montant')::numeric;
            end if;
            if v_num is null or v_num <= 0 then raise exception 'donations « % » : montant invalide (montant strictement positif attendu)', v_key; end if;
            if jsonb_typeof(v_item->'donateur') is distinct from 'string' or (v_item->>'donateur') not in ('p1', 'p2') then
              raise exception 'donations « % » : donateur invalide (p1 ou p2 attendu)', v_key;
            end if;
            if jsonb_typeof(v_item->'lien') is distinct from 'string' or (v_item->>'lien') not in ('enfant', 'petit_enfant', 'arriere_petit_enfant', 'autre') then
              raise exception 'donations « % » : lien invalide (enfant, petit_enfant, arriere_petit_enfant ou autre attendu)', v_key;
            end if;
            v_txt := btrim(case when jsonb_typeof(v_item->'beneficiaire') = 'string' then v_item->>'beneficiaire' else '' end);
            if v_txt = '' or char_length(v_txt) > 40 then raise exception 'donations « % » : bénéficiaire (beneficiaire) obligatoire (1 à 40 caractères)', v_key; end if;
            v_row := jsonb_build_object('id', v_key, 'date', to_char(v_dt, 'YYYY-MM-DD'), 'montant', v_num, 'donateur', v_item->>'donateur',
                                        'lien', v_item->>'lien', 'beneficiaire', v_txt);
            if jsonb_typeof(v_item->'nature') is distinct from 'string' or (v_item->>'nature') not in ('donation', 'don_argent_790g', 'don_logement_790a_bis') then
              raise exception 'donations « % » : nature invalide (donation, don_argent_790g ou don_logement_790a_bis attendu)', v_key;
            end if;
            v_row := v_row || jsonb_build_object('nature', v_item->>'nature');
            v_txt := btrim(case when jsonb_typeof(v_item->'source') = 'string' then v_item->>'source' else '' end);
            if v_txt = '' or char_length(v_txt) > 300 then raise exception 'donations « % » : source obligatoire (1 à 300 caractères)', v_key; end if;
            v_le := v_auj;
            if jsonb_typeof(v_item->'le') is not null and jsonb_typeof(v_item->'le') <> 'null' then
              begin
                if jsonb_typeof(v_item->'le') <> 'string' or (v_item->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_le := (v_item->>'le')::date;
              exception when others then
                raise exception 'donations « % » : date (le) invalide (AAAA-MM-JJ)', v_key;
              end;
              if v_le > v_auj then
                raise exception 'donations « % » : date (le) dans le futur (la date du document consulté est attendue)', v_key;
              end if;
            end if;
            v_don := v_don || jsonb_build_array(v_row || jsonb_build_object('source', v_txt, 'le', to_char(v_le, 'YYYY-MM-DD')));
          end loop;
          update public.config set donations = v_don where user_id = v_uid;
        end if;

        -- avis_impot (0029) : { annee_revenus, rfr?, plafonds_per?: { p1?: [{ annee, montant }], p2?: [...] }, source, le? }, remplacé en
        -- entier (un avis remplace le précédent ; l'objet vide l'efface). annee_revenus de 2000 à l'année en cours, rfr positif ou nul,
        -- plafonds : annee (année du plafond, de 2000 à l'année en cours + 1, une fois par personne) et montant > 0, 6 lignes au plus par personne ;
        -- source obligatoire (1 à 300 caractères), le en AAAA-MM-JJ (date du jour par défaut).
        if v ? 'avis_impot' then
          v_obj := v->'avis_impot';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'avis_impot : objet attendu'; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          v_an := extract(year from v_auj)::int;
          if v_obj = '{}'::jsonb then
            v_avis := '{}'::jsonb;
          else
            select k into v_txt from jsonb_object_keys(v_obj) k where k not in ('annee_revenus', 'rfr', 'plafonds_per', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'avis_impot : champ « % » inconnu (annee_revenus, rfr, plafonds_per, source, le)', v_txt;
            end if;
            v_num := null;
            if jsonb_typeof(v_obj->'annee_revenus') = 'number' or (jsonb_typeof(v_obj->'annee_revenus') = 'string' and (v_obj->>'annee_revenus') ~ '^\d{4}$') then
              v_num := (v_obj->>'annee_revenus')::numeric;
            end if;
            if v_num is null or v_num <> trunc(v_num) or v_num < 2000 or v_num > v_an then
              raise exception 'avis_impot : annee_revenus invalide (entier de 2000 à l''année en cours attendu)';
            end if;
            v_avis := jsonb_build_object('annee_revenus', v_num::int);
            if jsonb_typeof(v_obj->'rfr') is not null and jsonb_typeof(v_obj->'rfr') <> 'null' then
              v_num := null;
              if jsonb_typeof(v_obj->'rfr') = 'number' or (jsonb_typeof(v_obj->'rfr') = 'string' and (v_obj->>'rfr') ~ '^\d+(\.\d+)?$') then
                v_num := (v_obj->>'rfr')::numeric;
              end if;
              if v_num is null or v_num < 0 then raise exception 'avis_impot : rfr invalide (montant positif ou nul attendu)'; end if;
              v_avis := v_avis || jsonb_build_object('rfr', v_num);
            end if;
            if jsonb_typeof(v_obj->'plafonds_per') is not null and jsonb_typeof(v_obj->'plafonds_per') <> 'null' then
              if jsonb_typeof(v_obj->'plafonds_per') <> 'object' then raise exception 'avis_impot : plafonds_per : objet { p1, p2 } attendu'; end if;
              select k into v_txt from jsonb_object_keys(v_obj->'plafonds_per') k where k not in ('p1', 'p2') limit 1;
              if v_txt is not null then raise exception 'avis_impot : plafonds_per : personne « % » inconnue (p1 ou p2)', v_txt; end if;
              v_row := '{}'::jsonb;
              foreach v_pers in array array['p1', 'p2'] loop
                continue when jsonb_typeof(v_obj->'plafonds_per'->v_pers) is null or jsonb_typeof(v_obj->'plafonds_per'->v_pers) = 'null';
                v_lignes := v_obj->'plafonds_per'->v_pers;
                if jsonb_typeof(v_lignes) <> 'array' then raise exception 'avis_impot : plafonds_per.% : liste attendue', v_pers; end if;
                if jsonb_array_length(v_lignes) > 6 then raise exception 'avis_impot : plafonds_per.% : 6 lignes au plus', v_pers; end if;
                v_cfg := '[]'::jsonb;
                v_ids := '{}'::text[];
                for v_item, v_idx in select o.e, o.i::int from jsonb_array_elements(v_lignes) with ordinality as o(e, i) loop
                  if jsonb_typeof(v_item) <> 'object' then raise exception 'avis_impot : plafonds_per.% : ligne % : objet attendu', v_pers, v_idx; end if;
                  select k into v_txt from jsonb_object_keys(v_item) k where k not in ('annee', 'montant') limit 1;
                  if v_txt is not null then
                    raise exception 'avis_impot : plafonds_per.% : ligne % : champ « % » inconnu (annee, montant)', v_pers, v_idx, v_txt;
                  end if;
                  v_num2 := null;
                  if jsonb_typeof(v_item->'annee') = 'number' or (jsonb_typeof(v_item->'annee') = 'string' and (v_item->>'annee') ~ '^\d{4}$') then
                    v_num2 := (v_item->>'annee')::numeric;
                  end if;
                  if v_num2 is null or v_num2 <> trunc(v_num2) or v_num2 < 2000 or v_num2 > v_an + 1 then
                    raise exception 'avis_impot : plafonds_per.% : ligne % : annee invalide (entier de 2000 à l''année en cours + 1 attendu)', v_pers, v_idx;
                  end if;
                  if (v_num2::int)::text = any(v_ids) then raise exception 'avis_impot : plafonds_per.% : annee % en double', v_pers, v_num2::int; end if;
                  v_ids := v_ids || (v_num2::int)::text;
                  v_num := null;
                  if jsonb_typeof(v_item->'montant') = 'number' or (jsonb_typeof(v_item->'montant') = 'string' and (v_item->>'montant') ~ '^\d+(\.\d+)?$') then
                    v_num := (v_item->>'montant')::numeric;
                  end if;
                  if v_num is null or v_num <= 0 then
                    raise exception 'avis_impot : plafonds_per.% : ligne % : montant invalide (montant strictement positif attendu)', v_pers, v_idx;
                  end if;
                  v_cfg := v_cfg || jsonb_build_array(jsonb_build_object('annee', v_num2::int, 'montant', v_num));
                end loop;
                if jsonb_array_length(v_cfg) > 0 then v_row := v_row || jsonb_build_object(v_pers, v_cfg); end if;
              end loop;
              if v_row <> '{}'::jsonb then v_avis := v_avis || jsonb_build_object('plafonds_per', v_row); end if;
            end if;
            v_txt := btrim(case when jsonb_typeof(v_obj->'source') = 'string' then v_obj->>'source' else '' end);
            if v_txt = '' or char_length(v_txt) > 300 then raise exception 'avis_impot : source obligatoire (1 à 300 caractères)'; end if;
            v_le := v_auj;
            if jsonb_typeof(v_obj->'le') is not null and jsonb_typeof(v_obj->'le') <> 'null' then
              begin
                if jsonb_typeof(v_obj->'le') <> 'string' or (v_obj->>'le') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
                v_le := (v_obj->>'le')::date;
              exception when others then
                raise exception 'avis_impot : date (le) invalide (AAAA-MM-JJ)';
              end;
              if v_le > v_auj then
                raise exception 'avis_impot : date (le) dans le futur (la date du document consulté est attendue)';
              end if;
            end if;
            v_avis := v_avis || jsonb_build_object('source', v_txt, 'le', to_char(v_le, 'YYYY-MM-DD'));
          end if;
          update public.config set avis_impot = v_avis where user_id = v_uid;
        end if;

        -- projection (0030) : { base_capacite?: reel|prevu|montant, capacite_mensuelle? (−100 000 à 100 000), reste_capacite?: cible|disponible,
        -- reequilibrage?: aucun|annuel, part_reaffectee_epargne_pct?, part_hausse_epargnee_pct? et assurance_pct? (0 à 100),
        -- salaire_croissance_reelle_pct? (−10 à 10), tmi_pct? (0, 11, 30, 41 ou 45), per_versements_deduits? (booléen),
        -- biens?: { "bien:<uuid>": { prix_achat > 0, date_achat (1900 à aujourd'hui), source, le? } | null } (biens de l'utilisateur, 50 au plus),
        -- source? (1 à 300 caractères), le? (AAAA-MM-JJ, jamais dans le futur) }, fusionné champ par champ dans config.projection ;
        -- null retire un champ ; un bien fourni remplace l'entrée existante en entier ; la date du jour est mise dans « le » quand la source
        -- est fournie sans date. Les champs inconnus sont refusés.
        if v ? 'projection' then
          v_obj := v->'projection';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'projection : objet attendu'; end if;
          if v_obj = '{}'::jsonb then raise exception 'projection : au moins un réglage attendu'; end if;
          select k.projection into v_proj from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_proj) is distinct from 'object' then v_proj := '{}'::jsonb; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          for v_key, v_val in select e.key, e.value from jsonb_each(v_obj) e loop
            if v_key <> all (array['base_capacite', 'capacite_mensuelle', 'reste_capacite', 'reequilibrage', 'part_reaffectee_epargne_pct',
                'part_hausse_epargnee_pct', 'salaire_croissance_reelle_pct', 'tmi_pct', 'per_versements_deduits', 'assurance_pct', 'biens', 'source', 'le']) then
              raise exception 'projection : champ « % » inconnu (base_capacite, capacite_mensuelle, reste_capacite, reequilibrage, part_reaffectee_epargne_pct, part_hausse_epargnee_pct, salaire_croissance_reelle_pct, tmi_pct, per_versements_deduits, assurance_pct, biens, source, le)', v_key;
            end if;
            if jsonb_typeof(v_val) = 'null' then
              v_proj := v_proj - v_key;
              continue;
            end if;
            if v_key = 'base_capacite' then
              if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('reel', 'prevu', 'montant') then
                raise exception 'projection : base_capacite invalide (reel, prevu ou montant attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_val);
            elsif v_key = 'reste_capacite' then
              if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('cible', 'disponible') then
                raise exception 'projection : reste_capacite invalide (cible ou disponible attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_val);
            elsif v_key = 'reequilibrage' then
              if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('aucun', 'annuel') then
                raise exception 'projection : reequilibrage invalide (aucun ou annuel attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_val);
            elsif v_key = 'capacite_mensuelle' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < -100000 or v_num > 100000 then
                raise exception 'projection : capacite_mensuelle invalide (montant de −100 000 à 100 000 € attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_num);
            elsif v_key in ('part_reaffectee_epargne_pct', 'part_hausse_epargnee_pct', 'assurance_pct') then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < 0 or v_num > 100 then
                raise exception 'projection : % invalide (pourcentage de 0 à 100 attendu)', v_key;
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_num);
            elsif v_key = 'salaire_croissance_reelle_pct' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < -10 or v_num > 10 then
                raise exception 'projection : salaire_croissance_reelle_pct invalide (de −10 à 10 %% par an attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_num);
            elsif v_key = 'tmi_pct' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num not in (0, 11, 30, 41, 45) then
                raise exception 'projection : tmi_pct invalide (0, 11, 30, 41 ou 45 attendu)';
              end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_num);
            elsif v_key = 'per_versements_deduits' then
              if jsonb_typeof(v_val) <> 'boolean' then raise exception 'projection : per_versements_deduits invalide (vrai ou faux attendu)'; end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_val);
            elsif v_key = 'source' then
              v_txt := case when jsonb_typeof(v_val) = 'string' then public.foyer_rogner(v_val #>> '{}') else '' end;
              if v_txt = '' or char_length(v_txt) > 300 then raise exception 'projection : source invalide (1 à 300 caractères attendus)'; end if;
              v_proj := v_proj || jsonb_build_object(v_key, v_txt);
            elsif v_key = 'le' then
              v_dt := public.foyer_date(v_val);
              if v_dt is null then raise exception 'projection : date (le) invalide (AAAA-MM-JJ)'; end if;
              if v_dt > v_auj then raise exception 'projection : date (le) dans le futur (la date du document consulté est attendue)'; end if;
              v_proj := v_proj || jsonb_build_object(v_key, to_char(v_dt, 'YYYY-MM-DD'));
            else
              -- biens
              if jsonb_typeof(v_val) <> 'object' then raise exception 'projection.biens : objet { bien:<identifiant>: informations } attendu'; end if;
              select count(*) into v_n from jsonb_object_keys(v_val);
              if v_n > 50 then raise exception 'projection.biens : 50 biens au plus'; end if;
              v_row := case when jsonb_typeof(v_proj->'biens') = 'object' then v_proj->'biens' else '{}'::jsonb end;
              for v_txt, v_item in select e.key, e.value from jsonb_each(v_val) e loop
                if v_txt !~ '^bien:.+$' then raise exception 'projection.biens : clé « % » invalide (bien:<identifiant> attendu)', v_txt; end if;
                if jsonb_typeof(v_item) = 'null' then
                  v_row := v_row - v_txt;
                  continue;
                end if;
                if not exists (select 1 from public.biens b where b.user_id = v_uid and 'bien:' || b.id::text = v_txt) then
                  raise exception 'projection.biens : bien « % » introuvable', v_txt;
                end if;
                if jsonb_typeof(v_item) <> 'object' then raise exception 'projection.biens « % » : objet ou null attendu', v_txt; end if;
                select k into v_nom from jsonb_object_keys(v_item) k where k not in ('prix_achat', 'date_achat', 'source', 'le') limit 1;
                if v_nom is not null then
                  raise exception 'projection.biens « % » : champ « % » inconnu (prix_achat, date_achat, source, le)', v_txt, v_nom;
                end if;
                v_num := public.foyer_nombre(v_item->'prix_achat');
                if v_num is null or v_num <= 0 then
                  raise exception 'projection.biens « % » : prix_achat invalide (montant strictement positif attendu)', v_txt;
                end if;
                v_dt := public.foyer_date(v_item->'date_achat');
                if v_dt is null then raise exception 'projection.biens « % » : date_achat invalide (AAAA-MM-JJ)', v_txt; end if;
                if v_dt < date '1900-01-01' then raise exception 'projection.biens « % » : date_achat antérieure à 1900', v_txt; end if;
                if v_dt > v_auj then raise exception 'projection.biens « % » : date_achat dans le futur', v_txt; end if;
                v_nom := case when jsonb_typeof(v_item->'source') = 'string' then public.foyer_rogner(v_item->>'source') else '' end;
                if v_nom = '' or char_length(v_nom) > 300 then raise exception 'projection.biens « % » : source obligatoire (1 à 300 caractères)', v_txt; end if;
                v_le := v_auj;
                if jsonb_typeof(v_item->'le') is not null and jsonb_typeof(v_item->'le') <> 'null' then
                  v_dt2 := public.foyer_date(v_item->'le');
                  if v_dt2 is null then raise exception 'projection.biens « % » : date (le) invalide (AAAA-MM-JJ)', v_txt; end if;
                  if v_dt2 > v_auj then
                    raise exception 'projection.biens « % » : date (le) dans le futur (la date du document consulté est attendue)', v_txt;
                  end if;
                  v_le := v_dt2;
                end if;
                v_row := jsonb_set(v_row, array[v_txt], jsonb_build_object('prix_achat', v_num, 'date_achat', to_char(v_dt, 'YYYY-MM-DD'),
                  'source', v_nom, 'le', to_char(v_le, 'YYYY-MM-DD')), true);
              end loop;
              select count(*) into v_n from jsonb_object_keys(v_row);
              if v_n > 50 then raise exception 'projection.biens : 50 biens au plus (% après fusion)', v_n; end if;
              if v_n = 0 then v_proj := v_proj - 'biens'; else v_proj := jsonb_set(v_proj, '{biens}', v_row, true); end if;
            end if;
          end loop;
          if jsonb_typeof(v_obj->'source') = 'string' and not (v_obj ? 'le') then
            v_proj := v_proj || jsonb_build_object('le', to_char(v_auj, 'YYYY-MM-DD'));
          end if;
          update public.config set projection = v_proj where user_id = v_uid;
        end if;

        -- suivi (0032) : { revue_coeur?: annuelle|semestrielle, mois_revue_coeur? (entier de 1 à 12), seuil_ecart_pts? (3 à 10),
        -- plafond_satellite_pct? (0 à 30), seuil_baisse_satellite_pct? (10 à 50), semaine?: { actif: booléen, jour?: lundi … dimanche },
        -- source (obligatoire, 1 à 300 caractères), le? (AAAA-MM-JJ, jamais dans le futur) }, fusionné champ par champ dans config.suivi ;
        -- null retire un champ ; une semaine fournie remplace l'entrée existante en entier ; la date du jour est mise dans « le » quand elle
        -- n'est pas fournie (la source accompagne toujours la date de sa consultation). Les champs inconnus sont refusés.
        if v ? 'suivi' then
          v_obj := v->'suivi';
          if jsonb_typeof(v_obj) is distinct from 'object' then raise exception 'suivi : objet attendu'; end if;
          if (v_obj - 'source' - 'le') = '{}'::jsonb then raise exception 'suivi : au moins un réglage attendu'; end if;
          v_txt := case when jsonb_typeof(v_obj->'source') = 'string' then public.foyer_rogner(v_obj->>'source') else '' end;
          if v_txt = '' or char_length(v_txt) > 300 then raise exception 'suivi : source obligatoire (1 à 300 caractères)'; end if;
          select k.suivi into v_suivi from public.config k where k.user_id = v_uid for update;
          if jsonb_typeof(v_suivi) is distinct from 'object' then v_suivi := '{}'::jsonb; end if;
          v_auj := (now() at time zone 'Europe/Paris')::date;
          for v_key, v_val in select e.key, e.value from jsonb_each(v_obj) e loop
            if v_key <> all (array['revue_coeur', 'mois_revue_coeur', 'seuil_ecart_pts', 'plafond_satellite_pct', 'seuil_baisse_satellite_pct', 'semaine', 'source', 'le']) then
              raise exception 'suivi : champ « % » inconnu (revue_coeur, mois_revue_coeur, seuil_ecart_pts, plafond_satellite_pct, seuil_baisse_satellite_pct, semaine, source, le)', v_key;
            end if;
            if jsonb_typeof(v_val) = 'null' then
              v_suivi := v_suivi - v_key;
              continue;
            end if;
            if v_key = 'revue_coeur' then
              if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('annuelle', 'semestrielle') then
                raise exception 'suivi : revue_coeur invalide (annuelle ou semestrielle attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, v_val);
            elsif v_key = 'mois_revue_coeur' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num <> trunc(v_num) or v_num < 1 or v_num > 12 then
                raise exception 'suivi : mois_revue_coeur invalide (mois de 1 à 12 attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, v_num::int);
            elsif v_key = 'seuil_ecart_pts' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < 3 or v_num > 10 then
                raise exception 'suivi : seuil_ecart_pts invalide (écart de 3 à 10 points attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, v_num);
            elsif v_key = 'plafond_satellite_pct' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < 0 or v_num > 30 then
                raise exception 'suivi : plafond_satellite_pct invalide (pourcentage de 0 à 30 attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, v_num);
            elsif v_key = 'seuil_baisse_satellite_pct' then
              v_num := public.foyer_nombre(v_val);
              if v_num is null or v_num < 10 or v_num > 50 then
                raise exception 'suivi : seuil_baisse_satellite_pct invalide (pourcentage de 10 à 50 attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, v_num);
            elsif v_key = 'semaine' then
              if jsonb_typeof(v_val) <> 'object' then raise exception 'suivi : semaine invalide (objet { actif, jour } attendu)'; end if;
              select k into v_nom from jsonb_object_keys(v_val) k where k not in ('actif', 'jour') limit 1;
              if v_nom is not null then raise exception 'suivi.semaine : champ « % » inconnu (actif, jour)', v_nom; end if;
              if jsonb_typeof(v_val->'actif') is distinct from 'boolean' then raise exception 'suivi.semaine : actif invalide (vrai ou faux attendu)'; end if;
              if jsonb_typeof(v_val->'jour') is not null and jsonb_typeof(v_val->'jour') <> 'null'
                 and (jsonb_typeof(v_val->'jour') <> 'string' or (v_val->>'jour') not in ('lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche')) then
                raise exception 'suivi.semaine : jour invalide (lundi, mardi, mercredi, jeudi, vendredi, samedi ou dimanche attendu)';
              end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, jsonb_strip_nulls(jsonb_build_object('actif', v_val->'actif', 'jour', v_val->'jour')));
            elsif v_key = 'source' then
              v_suivi := v_suivi || jsonb_build_object(v_key, v_txt);
            else
              -- le
              v_dt := public.foyer_date(v_val);
              if v_dt is null then raise exception 'suivi : date (le) invalide (AAAA-MM-JJ)'; end if;
              if v_dt > v_auj then raise exception 'suivi : date (le) dans le futur (la date du document consulté est attendue)'; end if;
              v_suivi := v_suivi || jsonb_build_object(v_key, to_char(v_dt, 'YYYY-MM-DD'));
            end if;
          end loop;
          if jsonb_typeof(v_obj->'le') is null or jsonb_typeof(v_obj->'le') = 'null' then
            v_suivi := v_suivi || jsonb_build_object('le', to_char(v_auj, 'YYYY-MM-DD'));
          end if;
          update public.config set suivi = v_suivi where user_id = v_uid;
        end if;

      /* ---------- événements de vie du foyer (0030) : mêmes règles que Projection.validerEvenement ---------- */
      when 'evenement' then
        if p.operation = 'supprimer' then
          delete from public.foyer_evenements where id = p.ref::uuid and user_id = v_uid;
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'événement « % » introuvable', p.ref; end if;
        else
          select k into v_key from jsonb_object_keys(v) k
           where k not in ('type', 'personne', 'libelle', 'date', 'fin', 'params', 'source', 'variante_id') limit 1;
          if v_key is not null then
            raise exception 'événement : champ « % » inconnu (type, personne, libelle, date, fin, params, source, variante_id)', v_key;
          end if;
          -- événement résultant : la proposition seule (creer), ou l'événement existant complété par les champs fournis (modifier)
          if p.operation = 'creer' then
            v_ev := v;
          else
            select to_jsonb(fe) - 'id' - 'user_id' - 'created_at' - 'updated_at' into v_ev
              from public.foyer_evenements fe where fe.id = p.ref::uuid and fe.user_id = v_uid for update;
            if v_ev is null then raise exception 'événement « % » introuvable', p.ref; end if;
            v_ev := v_ev || v;
          end if;
          select coalesce(array_agg(c.id::text), '{}'::text[]) into v_cr from public.credits c where c.user_id = v_uid;
          select coalesce(array_agg(b.id::text), '{}'::text[]) into v_bi from public.biens b where b.user_id = v_uid;
          v_msg := public.foyer_valider_evenement(v_ev, v_cr, v_bi, current_date);
          if v_msg is not null then raise exception '%', v_msg; end if;
          v_vid := null;
          if public.foyer_present(v_ev->'variante_id') then
            begin
              v_vid := (v_ev->>'variante_id')::uuid;
            exception when others then
              raise exception 'événement : variante_id invalide (identifiant de variante attendu)';
            end;
            if not exists (select 1 from public.foyer_variantes fv where fv.id = v_vid and fv.user_id = v_uid) then
              raise exception 'variante « % » introuvable', v_vid;
            end if;
          end if;
          if p.operation = 'creer' then
            select count(*) into v_n from public.foyer_evenements where user_id = v_uid;
            if v_n >= 100 then raise exception 'Limite atteinte : 100 événements au plus. Supprime un événement avant d''en ajouter un.'; end if;
            insert into public.foyer_evenements (user_id, variante_id, type, personne, libelle, date, fin, params, source)
            values (v_uid, v_vid, v_ev->>'type', v_ev->>'personne', public.foyer_rogner(v_ev->>'libelle'), (v_ev->>'date')::date,
                    case when public.foyer_present(v_ev->'fin') then (v_ev->>'fin')::date end,
                    case when v_ev ? 'params' then v_ev->'params' else '{}'::jsonb end, public.foyer_rogner(v_ev->>'source'));
          else
            update public.foyer_evenements set
              variante_id = v_vid, type = v_ev->>'type', personne = v_ev->>'personne', libelle = public.foyer_rogner(v_ev->>'libelle'),
              date = (v_ev->>'date')::date, fin = case when public.foyer_present(v_ev->'fin') then (v_ev->>'fin')::date end,
              params = case when v_ev ? 'params' then v_ev->'params' else '{}'::jsonb end, source = public.foyer_rogner(v_ev->>'source')
            where id = p.ref::uuid and user_id = v_uid;
          end if;
        end if;

      /* ---------- variantes du foyer (0030) : mêmes règles que Projection.validerVariante ---------- */
      when 'variante' then
        if p.operation = 'supprimer' then
          delete from public.foyer_variantes where id = p.ref::uuid and user_id = v_uid;
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'variante « % » introuvable', p.ref; end if;
        else
          select k into v_key from jsonb_object_keys(v) k where k not in ('nom', 'description', 'retire', 'hypotheses') limit 1;
          if v_key is not null then raise exception 'variante : champ « % » inconnu (nom, description, retire, hypotheses)', v_key; end if;
          if p.operation = 'creer' then
            v_ev := v;
          else
            select jsonb_build_object('nom', fv.nom, 'description', fv.description, 'retire', to_jsonb(fv.retire), 'hypotheses', fv.hypotheses) into v_ev
              from public.foyer_variantes fv where fv.id = p.ref::uuid and fv.user_id = v_uid for update;
            if v_ev is null then raise exception 'variante « % » introuvable', p.ref; end if;
            v_ev := v_ev || v;
          end if;
          v_msg := public.foyer_valider_variante(v_ev);
          if v_msg is not null then raise exception '%', v_msg; end if;
          if p.operation = 'creer' then
            select count(*) into v_n from public.foyer_variantes where user_id = v_uid;
            if v_n >= 10 then raise exception 'Limite atteinte : 10 variantes au plus. Supprime une variante avant d''en ajouter une.'; end if;
            insert into public.foyer_variantes (user_id, nom, description, retire, hypotheses)
            values (v_uid, public.foyer_rogner(v_ev->>'nom'), case when public.foyer_present(v_ev->'description') then v_ev->>'description' else '' end,
                    case when public.foyer_present(v_ev->'retire') then array(select jsonb_array_elements_text(v_ev->'retire'))::uuid[] else '{}'::uuid[] end,
                    case when jsonb_typeof(v_ev->'hypotheses') = 'object' then v_ev->'hypotheses' else '{}'::jsonb end);
          else
            update public.foyer_variantes set
              nom         = public.foyer_rogner(v_ev->>'nom'),
              description = case when public.foyer_present(v_ev->'description') then v_ev->>'description' else '' end,
              retire      = case when public.foyer_present(v_ev->'retire') then array(select jsonb_array_elements_text(v_ev->'retire'))::uuid[] else '{}'::uuid[] end,
              hypotheses  = case when jsonb_typeof(v_ev->'hypotheses') = 'object' then v_ev->'hypotheses' else '{}'::jsonb end
            where id = p.ref::uuid and user_id = v_uid;
          end if;
        end if;

      /* ---------- plans figés (0030) : création et suppression seulement ---------- */
      when 'plan_fige' then
        if p.operation = 'modifier' then raise exception 'plan figé : seules la création et la suppression sont possibles'; end if;
        if p.operation = 'supprimer' then
          delete from public.plans_figes where id = p.ref::uuid and user_id = v_uid;
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'plan figé « % » introuvable', p.ref; end if;
        else
          select k into v_key from jsonb_object_keys(v) k where k not in ('raison', 'horizon_mois', 'parametres', 'serie') limit 1;
          if v_key is not null then raise exception 'plan figé : champ « % » inconnu (raison, horizon_mois, parametres, serie)', v_key; end if;
          if jsonb_typeof(v->'raison') is distinct from 'string' or (v->>'raison') not in ('revue_mensuelle', 'objectif', 'manuel') then
            raise exception 'plan figé : raison invalide (revue_mensuelle, objectif ou manuel attendu)';
          end if;
          v_num := public.foyer_nombre(v->'horizon_mois');
          if v_num is null or v_num <> trunc(v_num) or v_num < 1 or v_num > 300 then
            raise exception 'plan figé : horizon_mois invalide (entier de 1 à 300 attendu)';
          end if;
          if jsonb_typeof(v->'parametres') is distinct from 'object' then raise exception 'plan figé : parametres : objet attendu'; end if;
          if jsonb_typeof(v->'serie') is distinct from 'object' then raise exception 'plan figé : serie : objet attendu'; end if;
          if octet_length((v->'parametres')::text) > 100000 then raise exception 'plan figé : parametres : 100 000 octets au plus'; end if;
          if octet_length((v->'serie')::text) > 250000 then raise exception 'plan figé : serie : 250 000 octets au plus'; end if;
          select count(*) into v_n from public.plans_figes where user_id = v_uid;
          if v_n >= 60 then raise exception 'Limite atteinte : 60 plans figés au plus. Supprime un plan figé avant d''en ajouter un.'; end if;
          insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie)
          values (v_uid, v->>'raison', v_num::int, v->'parametres', v->'serie');
        end if;
      end case;
    exception
      when check_violation or not_null_violation or foreign_key_violation then
        raise exception 'Proposition non appliquée (%, %) : valeur refusée par la base (%).', v_quoi, p.operation, sqlerrm using errcode = '22023';
      when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
        raise exception 'Proposition non appliquée (%, %) : format invalide (%).', v_quoi, p.operation, sqlerrm using errcode = '22023';
      when others then
        raise exception 'Proposition non appliquée (%, %) : %.', v_quoi, p.operation, sqlerrm using errcode = '22023';
    end;

    update public.propositions
       set statut = 'acceptee', decide_le = now(), apres = case when p.operation = 'supprimer' then p.apres else v end
     where id = p.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.appliquer_propositions(uuid[], jsonb) from public, anon;
grant execute on function public.appliquer_propositions(uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- export_all() : inchangée (0031). config, positions et routines sortent par to_jsonb de la ligne : config.suivi, positions.role,
-- positions.role_source et routines.etat_suivi sont donc exportés ; la suppression du compte (cascade sur auth.users) efface tout.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- reperes.libelle : 200 caractères au plus (120 jusqu'ici, 0009) : deux libellés du suivi (suivi_ligne_satellite_max_pct, 136 caractères,
-- et suivi_societe_max_pct, 160) disent la convention et la source de leur seuil ; les recopier à l'identique de la fixture l'exige.
-- ---------------------------------------------------------------------------
alter table public.reperes drop constraint if exists reperes_libelle_check;
alter table public.reperes add constraint reperes_libelle_check check (char_length(libelle) between 2 and 200);

-- ---------------------------------------------------------------------------
-- Repères du suivi (bloc d'inserts séparé, idempotent) : 35 repères recopiés à l'identique de test/fixtures/suivi-cas.json (clé reperes,
-- hors les 11 repères marqués « reprise », déjà en base). Même forme que 0030 ; le champ statut (V ou CONV) ne va pas en base.
-- ---------------------------------------------------------------------------
insert into public.reperes (cle, libelle, valeur, unite, date_effet, date_fin, source_titre, source_url, verifie_le) values
  ('suivi_plafond_satellite_prudent', 'Plafond satellite par défaut, profil Prudent (repère Boussole, prudent)', 5, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; pratique cœur-satellite sans norme publique', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_plafond_satellite_modere', 'Plafond satellite par défaut, profil Modéré ou profil à faire (repère Boussole, prudent)', 10, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_plafond_satellite_equilibre', 'Plafond satellite par défaut, profil Équilibré (repère Boussole, prudent)', 15, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_plafond_satellite_dynamique', 'Plafond satellite par défaut, profil Dynamique (repère Boussole, prudent)', 20, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_plafond_satellite_offensif', 'Plafond satellite par défaut, profil Offensif (repère Boussole, prudent)', 25, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_seuil_ecart_pts', 'Écart d''une classe à sa fourchette cible qui déclenche une revue, en points (repère Boussole d''après Vanguard)', 5, '%', '2010-07-01', null, 'Vanguard — Jaconetti, Kinniry, Zilbering, « Best practices for portfolio rebalancing », juillet 2010 (copie lue chez un tiers)', 'https://indexacapital.com/bundles/unaiadvisor/docs/papers/2010-Vanguard-Best-practices-for-portfolio-rebalancing.pdf', '2026-10-15'),
  ('suivi_revue_coeur_annuelle_mois', 'Fréquence de revue du cœur, horizon long (annuelle)', 12, 'mois', '2010-07-01', null, 'Vanguard — Jaconetti, Kinniry, Zilbering, « Best practices for portfolio rebalancing », juillet 2010 (copie lue chez un tiers)', 'https://indexacapital.com/bundles/unaiadvisor/docs/papers/2010-Vanguard-Best-practices-for-portfolio-rebalancing.pdf', '2026-10-15'),
  ('suivi_revue_coeur_semestrielle_mois', 'Fréquence de revue du cœur, horizon de 3 à 8 ans (semestrielle)', 6, 'mois', '2010-07-01', null, 'Vanguard — Jaconetti, Kinniry, Zilbering, « Best practices for portfolio rebalancing », juillet 2010 (copie lue chez un tiers)', 'https://indexacapital.com/bundles/unaiadvisor/docs/papers/2010-Vanguard-Best-practices-for-portfolio-rebalancing.pdf', '2026-10-15'),
  ('suivi_horizon_long_ans', 'Horizon à partir duquel le cœur est revu une fois par an (convention Boussole)', 8, 'ans', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_horizon_reserve_ans', 'Échéance d''objectif en dessous de laquelle l''argent sans risque est rangé en réserve (convention Boussole)', 3, 'ans', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; même seuil que le projet proche de CP4 § 1.3', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_horizon_suppose_ans', 'Horizon supposé d''une ligne sans objectif (convention Boussole)', 10, 'ans', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_seuil_baisse_satellite_pct', 'Baisse d''une ligne satellite qui déclenche une revue de sa raison de détention (repère Boussole, prudent)', 25, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_ligne_satellite_max_pct', 'Poids d''une ligne satellite dans le financier investi au-delà duquel une revue est proposée (repère Boussole d''après la règle des OPCVM)', 5, '%', '2009-07-13', null, 'Directive 2009/65/CE (OPCVM), art. 52 : 5 % par émetteur, porté à 10 % au plus (texte de l''UE tel qu''adopté)', 'https://www.legislation.gov.uk/eudr/2009/65/article/52/adopted', '2026-10-15'),
  ('suivi_societe_max_pct', 'Poids d''une société (en direct et par transparence) dans le financier investi au-delà duquel une revue est proposée (repère Boussole d''après la règle des OPCVM)', 10, '%', '2009-07-13', null, 'Directive 2009/65/CE (OPCVM), art. 52 : 5 % par émetteur, porté à 10 % au plus (texte de l''UE tel qu''adopté)', 'https://www.legislation.gov.uk/eudr/2009/65/article/52/adopted', '2026-10-15'),
  ('suivi_frais_plancher_pct', 'Frais d''un fonds en dessous desquels aucun déclencheur de frais n''est créé (convention de CP4)', 0.5, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; même plancher que fraisSupports (CP4)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_cout_bon_marge_pct', 'Marge au-dessus du bas du repère de classe pour un coût « bon » (convention Boussole)', 0.1, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_volatilite_surveiller_pct', 'Volatilité de classe à partir de laquelle le constat de risque est « à surveiller » (convention Boussole)', 20, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; volatilités de marche.js', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_devise_info_pct', 'Part du financier en devises étrangères au-delà de laquelle le constat devise le signale (information)', 50, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_devise_prudent_pct', 'Part en devises étrangères « à surveiller » pour un profil Prudent (convention Boussole)', 30, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_encours_bon_eur', 'Encours d''un fonds jugé suffisant pour le constat de solidité (convention Boussole, à surveiller au plus)', 100000000, '€', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; aucune source publique trouvée : jamais « à travailler »', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_encours_bas_eur', 'Encours d''un fonds en dessous duquel la solidité est « à surveiller » (convention Boussole)', 20000000, '€', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; aucune source publique trouvée : jamais « à travailler »', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_anciennete_fonds_ans', 'Ancienneté d''un fonds jugée suffisante pour le constat de solidité (convention Boussole)', 3, 'ans', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_chevauchement_surveiller_pct', 'Chevauchement pondéré des 10 premières lignes de deux fonds « à surveiller » (convention Boussole)', 30, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_chevauchement_travailler_pct', 'Chevauchement pondéré des 10 premières lignes de deux fonds « à travailler » (convention Boussole)', 60, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_croisement_exposition_pct', 'Exposition à une devise, une zone ou un pays qui fait apparaître un événement dans « Ta semaine » (convention Boussole)', 5, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_croisement_societe_pct', 'Poids par transparence d''une société qui fait apparaître ses événements dans « Ta semaine » (convention Boussole)', 1, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_couverture_min_pct', 'Part des constats applicables calculés en dessous de laquelle la météo est « à compléter » (convention Boussole)', 60, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_point_mort_max_ans', 'Point mort au-delà duquel un changement n''est plus « ça vaut le coût » (convention Boussole)', 3, 'ans', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_point_mort_part_horizon_pct', 'Part de l''horizon au-delà de laquelle un changement n''est plus « ça vaut le coût » (convention Boussole)', 50, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_aggravation_pct', 'Aggravation d''une mesure qui fait remontrer un déclencheur avant la revue suivante (convention Boussole)', 50, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('courtage_banque_reseau_pct', 'Courtage moyen d''un ordre de bourse de 1 000 €, banques de réseau (janvier 2026)', 0.65, '%', '2026-01-01', null, 'AMF — Les frais des placements financiers continuent de baisser (27 avril 2026) : courtage moyen d''un ordre de 1 000 €, janvier 2026', 'https://www.amf-france.org/fr/actualites-publications/actualites/les-frais-des-placements-financiers-continuent-de-baisser-en-particulier-ceux-des-fonds', '2026-10-15'),
  ('courtage_en_ligne_pct', 'Courtage moyen d''un ordre de bourse de 1 000 €, intermédiaires en ligne établis (janvier 2026)', 0.45, '%', '2026-01-01', null, 'AMF — Les frais des placements financiers continuent de baisser (27 avril 2026) : courtage moyen d''un ordre de 1 000 €, janvier 2026', 'https://www.amf-france.org/fr/actualites-publications/actualites/les-frais-des-placements-financiers-continuent-de-baisser-en-particulier-ceux-des-fonds', '2026-10-15'),
  ('courtage_neo_courtier_pct', 'Courtage moyen d''un ordre de bourse de 1 000 €, néo-courtiers (janvier 2026)', 0.15, '%', '2026-01-01', null, 'AMF — Les frais des placements financiers continuent de baisser (27 avril 2026) : courtage moyen d''un ordre de 1 000 €, janvier 2026', 'https://www.amf-france.org/fr/actualites-publications/actualites/les-frais-des-placements-financiers-continuent-de-baisser-en-particulier-ceux-des-fonds', '2026-10-15'),
  ('suivi_demi_ecart_cote_pct', 'Coût d''écart achat-vente supposé par ordre sur un titre coté (convention Boussole, prudente)', 0.1, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; aucune source publique trouvée', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15'),
  ('suivi_arbitrage_av_defaut_pct', 'Frais d''arbitrage supposés d''un contrat dont les frais ne sont pas renseignés (convention Boussole, prudente)', 1, '%', '2026-10-15', null, 'Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; sources de place non officielles : rarement plus de 1 %', 'https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md', '2026-10-15')
on conflict (cle) do update set libelle = excluded.libelle, valeur = excluded.valeur, unite = excluded.unite, date_effet = excluded.date_effet,
  date_fin = excluded.date_fin, source_titre = excluded.source_titre, source_url = excluded.source_url, verifie_le = excluded.verifie_le;

-- ---------------------------------------------------------------------------
-- Fiches du savoir (thème comportement), au tutoiement, d'après test/fixtures/suivi-cas.json (clé fiches). Modèle de 0011 : rejouer sans
-- changement n'incrémente pas la version.
-- ---------------------------------------------------------------------------
insert into public.savoir_fiches (slug, theme, titre, resume, contenu, mots_cles, sources, mis_a_jour_le) values
  ('frais-meilleur-indice', 'comportement', 'Les frais, le meilleur indice de ce que rapportera un fonds',
   'Parmi tout ce qu''on peut savoir d''un fonds à l''avance, ses frais sont ce qui prédit le mieux ses résultats futurs. C''est pour cela que Boussole juge d''abord le cœur de ton portefeuille sur son coût.',
   $f$## Ce que montrent les études

- **Les frais prédisent les résultats.** En 2016, Morningstar a testé ses propres données : sur la période 2010-2015, les fonds d'actions américaines les moins chers (le cinquième le moins coûteux) ont réussi, c'est-à-dire survécu et battu leur catégorie, dans 62 % des cas, contre 20 % pour les plus chers. Le même écart se retrouve pour les fonds d'actions internationales et les fonds diversifiés. L'auteur, Russel Kinnel, en conclut que les frais sont un indice éprouvé des résultats futurs, à regarder en premier ou en deuxième.
- **La plupart des fonds gérés activement font moins bien que leur indice sur 10 ans.** Selon S&P Dow Jones Indices (*SPIVA Europe*, fin 2025), sur les 10 ans qui finissent le 31 décembre 2025, 97 % des fonds actifs d'actions européennes en euros ont fait moins bien que l'indice S&P Europe 350, 98 % pour les actions mondiales et 98 % pour les actions françaises. Une partie de ces fonds a d'ailleurs disparu en route.

## Pourquoi

Les frais sont prélevés chaque année, que le fonds gagne ou perde, et leur effet se cumule. La performance future des marchés est incertaine ; le coût, lui, est connu d'avance.

## Comment Boussole s'en sert

- Le constat **coût** de chaque fonds compare ses frais courants au repère de sa classe (par exemple 0,10 à 0,30 % par an pour un fonds indiciel d'actions), sans jamais nommer un produit.
- Un changement n'est proposé que s'il **vaut le coût** : le gain de frais, certain, doit dépasser vite les coûts certains du changement (courtage, impôt, ancienneté de l'enveloppe).
- Les résultats passés d'un fonds n'entrent pas dans sa santé : ils ne prédisent presque rien.$f$,
   array['frais','frais courants','gestion indicielle','gestion active','SPIVA','performance future'],
   '[{"titre": "FAnews : Study by Morningstar''s Russel Kinnel shows fund fees are proven predictors of future success (9 mai 2016)", "url": "https://www.fanews.co.za/article/surveys-reports-and-ratings/34/general/1195/study-by-morningstar-s-russel-kinnel-shows-fund-fees-are-proven-predictors-of-future-success/20252", "consulte_le": "2026-10-15"}, {"titre": "S&P Dow Jones Indices : SPIVA Europe Scorecard, Year-End 2025 (Report 1a)", "url": "https://www.spglobal.com/spdji/en/documents/spiva/spiva-europe-year-end-2025.pdf", "consulte_le": "2026-10-15"}]'::jsonb, '2026-10-15'),

  ('moins-de-transactions', 'comportement', 'Pourquoi trop d''achats et de ventes coûtent cher',
   'Les particuliers qui achètent et vendent le plus obtiennent les moins bons résultats, et les épargnants gagnent en moyenne moins que les fonds qu''ils détiennent, à cause du moment de leurs achats et de leurs ventes.',
   $f$## Ce que montrent les études

- **Les plus actifs gagnent le moins.** Brad Barber et Terrance Odean ont étudié 66 465 foyers clients d'un courtier en ligne de 1991 à 1996 (*Journal of Finance*, 2000). Les foyers qui changeaient le plus leurs lignes ont obtenu 11,4 % par an, quand le marché faisait 17,9 %. Les auteurs relient ce résultat à l'excès de confiance et aux frais de chaque opération.
- **Le moment des achats et des ventes coûte environ un point par an.** Morningstar compare chaque année le rendement des fonds et celui qu'obtiennent réellement leurs porteurs. Sur les 10 ans qui finissent fin 2025, l'épargnant moyen des fonds d'actions américaines a obtenu 8,7 % par an, contre 9,9 % pour les fonds eux-mêmes : 1,2 point perdu chaque année, surtout en achetant après les hausses et en vendant après les baisses.

## Ce que tu peux en retenir

- Une décision prise à froid, selon une règle écrite à l'avance, coûte moins qu'une réaction au marché du jour.
- Chaque opération a un coût certain (courtage, écart entre prix d'achat et de vente, impôt sur un compte-titres), alors que son bénéfice est incertain.

## Comment Boussole s'en sert

- Le cœur de ton portefeuille n'est revu qu'une ou deux fois par an ; le satellite, une fois par mois.
- Aucune alerte de cours, aucun encouragement à passer des ordres : les bonnes habitudes mises en avant sont la revue faite, le matelas, la diversification et des frais maîtrisés.$f$,
   array['transactions','rotation','excès de confiance','rendement des épargnants','discipline'],
   '[{"titre": "Barber et Odean, « Trading Is Hazardous to Your Wealth », Journal of Finance 55 (2), 2000, p. 773-806 (résumé)", "url": "https://ideas.repec.org/a/bla/jfinan/v55y2000i2p773-806.html", "consulte_le": "2026-10-15"}, {"titre": "Morningstar Australie : Mind the Gap, rendements des épargnants sur 10 ans à fin 2025 (19 août 2026)", "url": "https://www.morningstar.com.au/personal-finance/young-invested-are-you-sabotaging-your-etf-returns", "consulte_le": "2026-10-15"}]'::jsonb, '2026-10-15'),

  ('regarder-moins-souvent', 'comportement', 'Regarder ses placements moins souvent',
   'Plus on regarde ses placements souvent, plus on voit de baisses passagères, et plus on est tenté de choisir trop prudent ou de vendre au mauvais moment. Un rythme de revue choisi à l''avance protège de ce biais.',
   $f$## L'aversion myope à la perte

Shlomo Benartzi et Richard Thaler (*Quarterly Journal of Economics*, 1995) combinent deux constats : une perte pèse à peu près deux fois plus qu'un gain du même montant, et beaucoup d'épargnants évaluent leurs placements souvent, même quand leurs projets sont lointains. Ensemble, ces deux réflexes poussent à éviter les actions plus qu'un horizon long ne le justifie. Leurs calculs indiquent que les épargnants se comportent comme s'ils jugeaient leur portefeuille environ une fois par an.

Plus la période regardée est courte, plus les baisses passagères sont fréquentes : regarder chaque jour, c'est s'exposer à davantage de mauvaises nouvelles, sans rien changer au résultat de long terme.

## Ce que tu peux faire

- Choisir un **rythme de revue** et s'y tenir : une fois par an (ou tous les six mois si ton objectif approche) pour le cœur, une fois par mois pour la réserve et le satellite.
- Juger ton portefeuille au regard de **tes objectifs et de ton horizon**, pas du marché du jour.

## Comment Boussole s'en sert

- Un résumé par semaine (« Ta semaine »), pas d'alerte de cours.
- La météo d'une ligne du cœur ne change qu'à sa revue : un fonds large ne « s'assombrit » pas un jeudi.$f$,
   array['aversion à la perte','aversion myope','fréquence de revue','horizon','émotions'],
   '[{"titre": "Benartzi et Thaler, « Myopic Loss Aversion and the Equity Premium Puzzle », NBER Working Paper 4369 (version publiée : Quarterly Journal of Economics 110 (1), 1995, p. 73-92)", "url": "https://www.nber.org/system/files/working_papers/w4369/w4369.pdf", "consulte_le": "2026-10-15"}]'::jsonb, '2026-10-15'),

  ('avis-des-analystes', 'comportement', 'Ce que valent les avis des analystes',
   'Les recommandations et objectifs de cours des analystes sont des opinions datées. Les études montrent qu''ils rapportent peu une fois les frais déduits et que les objectifs de cours sont souvent manqués.',
   $f$## Ce que montrent les études

- **Suivre les recommandations rapporte peu une fois les frais payés.** Barber, Lehavy, McNichols et Trueman (*Journal of Finance*, 2001) trouvent qu'acheter les valeurs les mieux notées et vendre les moins bien notées rapportait plus de 4 % par an avant frais, mais demandait beaucoup d'opérations ; une fois ces coûts déduits, le gain n'était plus clairement positif.
- **Les objectifs de cours sont souvent manqués.** Bradshaw, Brown et Huang (*Review of Accounting Studies*, 2013) ont étudié les objectifs à 12 mois de 2000 à 2009 : 38 % seulement étaient atteints au bout des 12 mois (64 % à un moment de la période), et l'écart moyen entre l'objectif et le cours réel était de 45 %.

## Comment lire un avis

- C'est l'opinion d'un producteur (une banque, un bureau d'analyse), à une date, avec ses méthodes et ses conflits d'intérêts possibles.
- Un consensus regroupe plusieurs opinions ; il ne dit rien de **ta** situation, de tes objectifs ni de la place de la ligne dans ton portefeuille.

## Comment Boussole s'en sert

- Les avis des tiers sont montrés **tels quels**, sur une fiche identique pour tous, avec le producteur, la date et un lien vers ses mentions ; jamais combinés en une note, jamais reliés à ta situation.
- Ils n'entrent jamais dans la santé d'une ligne et ne déclenchent rien.$f$,
   array['analystes','consensus','objectif de cours','recommandation','frais de transaction'],
   '[{"titre": "Barber, Lehavy, McNichols et Trueman, « Can Investors Profit from the Prophets? », Journal of Finance 56 (2), 2001, p. 531-563 (résumé)", "url": "https://ideas.repec.org/a/bla/jfinan/v56y2001i2p531-563.html", "consulte_le": "2026-10-15"}, {"titre": "Bradshaw, Brown et Huang, « Do sell-side analysts exhibit differential target price forecasting ability? », Review of Accounting Studies 18 (4), 2013, p. 930-955 (résumé)", "url": "https://ideas.repec.org/a/spr/reaccs/v18y2013i4d10.1007_s11142-012-9216-5.html", "consulte_le": "2026-10-15"}]'::jsonb, '2026-10-15'),

  ('reequilibrer-sans-exces', 'comportement', 'Rééquilibrer, mais pas trop souvent',
   'Rééquilibrer ramène ton portefeuille au risque que tu as choisi. Une revue une ou deux fois par an, avec un seuil d''écart d''environ 5 points, suffit en général ; plus souvent, on paie plus de frais sans réduire beaucoup le risque.',
   $f$## À quoi ça sert

Avec le temps, les classes d'actifs ne progressent pas au même rythme : la part des actions monte après une hausse, baisse après une chute. Rééquilibrer sert d'abord à **garder le risque que tu as choisi**, pas à gagner plus.

## Ce que montre l'étude de Vanguard

Jaconetti, Kinniry et Zilbering (Vanguard, juillet 2010) ont testé des portefeuilles actions et obligations américains de 1926 à 2009 : le rendement ajusté du risque n'est pas très différent qu'on rééquilibre chaque mois, chaque trimestre ou chaque année, mais le nombre d'opérations et leurs coûts augmentent fortement avec la fréquence. Leur conclusion pour la plupart des portefeuilles bien diversifiés : une surveillance **annuelle ou semestrielle**, avec un rééquilibrage quand l'écart à la cible dépasse **5 points**.

## Le faire au moindre coût

- **D'abord par tes versements** : orienter les prochains versements vers la classe en retard ne coûte rien.
- Ensuite **à l'intérieur d'une enveloppe** (arbitrage dans une assurance-vie, vente et achat dans un PEA) : pas d'impôt.
- En dernier, une vente sur un compte-titres, qui peut déclencher un impôt sur la plus-value.

## Comment Boussole s'en sert

- Ta politique de suivi fixe la fréquence de revue du cœur et le seuil d'écart (5 points par défaut, mesuré à la borne la plus proche de ta fourchette).
- Avant de proposer un changement, Boussole calcule s'il **vaut le coût** et montre toujours l'option sans coût par les versements.$f$,
   array['rééquilibrage','allocation','seuil','versements','frais','fréquence'],
   '[{"titre": "Vanguard, « Best practices for portfolio rebalancing », juillet 2010 (copie consultée chez un tiers)", "url": "https://indexacapital.com/bundles/unaiadvisor/docs/papers/2010-Vanguard-Best-practices-for-portfolio-rebalancing.pdf", "consulte_le": "2026-10-15"}]'::jsonb, '2026-10-15'),

  ('coeur-et-satellite', 'comportement', 'Cœur, satellite et réserve : un rôle pour chaque ligne',
   'Chaque ligne de ton portefeuille a un rôle : la réserve pour les imprévus et les projets proches, le cœur pour le long terme, le satellite pour les convictions et la part spéculative. Le rôle fixe la fréquence de revue et ce qui mérite ton attention.',
   $f$## Les trois rôles

- **Réserve** : matelas de précaution et argent des projets à moins de 3 ans, sur des supports sans risque de baisse (livrets, fonds en euros). On regarde le montant, pas la performance.
- **Cœur** : l'argent de long terme, sur des supports larges, diversifiés et peu coûteux. On regarde le coût et l'écart de chaque classe à ta fourchette, une ou deux fois par an.
- **Satellite** : actions en direct, fonds d'un secteur, d'un thème ou d'un seul pays, petites capitalisations, levier, crypto. On regarde la part totale (sous un plafond), le poids de chaque ligne et la raison pour laquelle tu la détiens, chaque mois.

## Les repères de Boussole

- **Plafond du satellite** selon ton profil : 5 % (prudent), 10 % (modéré), 15 % (équilibré), 20 % (dynamique), 25 % (offensif) de ton financier investi. Ce sont des repères prudents de Boussole, pas une norme : tu peux les changer avec Claude.
- **Une ligne satellite au-delà de 5 %**, ou **une société au-delà de 10 %** (en direct et à travers tes fonds), mérite une revue. Ces chiffres reprennent l'ordre de grandeur de la règle de diversification imposée aux fonds grand public européens (directive OPCVM : 5 % par émetteur, jusqu'à 10 % sous conditions).

## Comment Boussole s'en sert

- Le rôle est proposé automatiquement, puis confirmé avec Claude.
- Les jugements portent sur une classe ou une enveloppe (« la part satellite », « les actions de ton compte-titres »), jamais sur un produit nommé.$f$,
   array['cœur','satellite','réserve','rôle','plafond','diversification','politique de suivi'],
   '[{"titre": "Directive 2009/65/CE (OPCVM), article 52 (texte de l''UE tel qu''adopté)", "url": "https://www.legislation.gov.uk/eudr/2009/65/article/52/adopted", "consulte_le": "2026-10-15"}, {"titre": "Boussole : spec SUIVI, rôles et politique de suivi (§ 4)", "url": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md", "consulte_le": "2026-10-15"}]'::jsonb, '2026-10-15')
on conflict (slug) do update set theme = excluded.theme, titre = excluded.titre, resume = excluded.resume, contenu = excluded.contenu,
  mots_cles = excluded.mots_cles, sources = excluded.sources, mis_a_jour_le = excluded.mis_a_jour_le, version = public.savoir_fiches.version + 1
  -- Rejouer la migration sans changement n'incrémente pas la version.
  where public.savoir_fiches.contenu is distinct from excluded.contenu or public.savoir_fiches.titre is distinct from excluded.titre
     or public.savoir_fiches.resume is distinct from excluded.resume or public.savoir_fiches.sources is distinct from excluded.sources;

-- ---------------------------------------------------------------------------
-- Expertises : « Copilote » devient « Claude », « conseiller » est reformulé (sens inchangé). Un seul UPDATE par expertise : le
-- déclencheur expertises_version (0016) passe la version à la suivante et l'historique (expertises_versions) en garde la copie ;
-- l'entrée du journal des versions est ajoutée ici (version + 1, 2026-10-15). Seules les expertises dont un texte change sont touchées,
-- donc rejouer cette partie ne fait rien. Les slugs, les contrôles de la table et les repères ne changent pas.
-- Les paires « ancien texte, nouveau texte » sont écrites UNE fois, dans la fonction ci-dessous (premier remplacement = premier de la liste) ;
-- scripts/gen-expertises-demo.mjs les lit entre les marqueurs @expertises-reformulation pour que le bloc de web/src/demo-data.js reflète
-- le texte le plus récent (test/suivi-pglite.test.mjs compare le résultat de la base à celui du script).
-- ---------------------------------------------------------------------------
create or replace function public.expertises_reformuler(t text) returns text
language sql immutable set search_path = ''
as $$
  -- @expertises-reformulation — début
  select replace(replace(replace(replace(replace(t,
    $o$Tu es le Copilote patrimonial de Boussole, pas un conseiller en investissement :$o$,
    $n$Tu es Claude, appuyé sur les expertises de Boussole, et non un professionnel du conseil réglementé :$n$),
    $o$conseiller en investissements financiers inscrit à l'ORIAS$o$,
    $n$cabinet de conseil en investissements financiers inscrit à l'ORIAS$n$),
    $o$conseiller réglementé$o$,
    $n$professionnel réglementé du conseil$n$),
    $o$Conseiller d'attendre un meilleur moment de marché$o$,
    $n$Recommander d'attendre un meilleur moment de marché$n$),
    $o$Conseiller un placement précis$o$,
    $n$Recommander un placement précis$n$)
  -- @expertises-reformulation — fin
$$;

update public.expertises e
   set nom = public.expertises_reformuler(e.nom),
       quand_consulter = public.expertises_reformuler(e.quand_consulter),
       perimetre = public.expertises_reformuler(e.perimetre),
       methode = public.expertises_reformuler(e.methode),
       controles = public.expertises_reformuler(e.controles::text)::jsonb,
       garde_fous = public.expertises_reformuler(e.garde_fous),
       format = public.expertises_reformuler(e.format),
       evals = public.expertises_reformuler(e.evals::text)::jsonb,
       mis_a_jour_le = date '2026-10-15',
       -- @expertises-journal
       changelog = e.changelog || jsonb_build_array(jsonb_build_object('version', e.version + 1, 'le', '2026-10-15',
         'resume', $r$Reformulation : le texte s'adresse à Claude et le statut réglementé des professionnels du conseil est mieux dit ; le sens ne change pas.$r$))
 where (e.nom, e.quand_consulter, e.perimetre, e.methode, e.controles::text, e.garde_fous, e.format, e.evals::text)
       is distinct from
       (public.expertises_reformuler(e.nom), public.expertises_reformuler(e.quand_consulter), public.expertises_reformuler(e.perimetre),
        public.expertises_reformuler(e.methode), public.expertises_reformuler(e.controles::text), public.expertises_reformuler(e.garde_fous),
        public.expertises_reformuler(e.format), public.expertises_reformuler(e.evals::text));

drop function public.expertises_reformuler(text);
