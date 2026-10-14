-- Boussole : calendrier patrimonial (DAT1, docs/superpowers/specs/2026-10-14-dat1-calendrier-design.md § 2, § 8 et § 11.2).
-- Non appliquée : à appliquer avec apply_migration (name = "calendrier") sur le projet oapcewpqsbbjdlcdeizi, après 0028 (mfa),
-- AVANT le déploiement des fonctions mcp et powens (elles écrivent les nouvelles clés et les nouvelles colonnes).
-- Aucune nouvelle table : les politiques restrictives de double authentification de 0028 couvrent déjà config et banque_comptes.
--
-- config : quatre colonnes jsonb not null, écrites par appliquer_propositions seulement (cible config), jamais directement.
--   enveloppes_infos (objet, défaut {}) : informations d'une enveloppe, par clé « <nom> » ou « <nom>|p1 » / « <nom>|p2 » : type, titulaire,
--     date d'ouverture (exacte ou approchée), date de clôture, versements cumulés, versements avant 70 ans, revue de la clause
--     bénéficiaire, versements d'épargne salariale (pee, percol), moins-values reportables (compte_titres), source, date du document ;
--   prets_infos (objet, défaut {}) : informations du contrat d'un crédit ou d'un bien (clé « credit:<identifiant> » ou « bien:<identifiant> ») ;
--   donations (liste, défaut []) : donations consenties par le foyer ;
--   avis_impot (objet, défaut {}) : dernier avis d'impôt (année des revenus, revenu fiscal de référence, plafonds d'épargne retraite).
--   Contraintes nommées config_enveloppes_infos, config_prets_infos, config_donations, config_avis_impot (type JSON attendu).
-- reperes : date_fin (date, null) = fin d'un dispositif ou d'une période (contrainte reperes_date_fin : au plus tôt le jour d'effet) ;
--   l'unité « mois » s'ajoute à %, €, ans (la contrainte reperes_unite_check est remplacée). Les repères du § 11.2 sont insérés en fin de
--   fichier, et ceux du Livret A et du LEP (0010) sont mis à jour.
-- banque_comptes : ouverture_le (date), pret (jsonb, objet) et infos_proposees_le (timestamptz), écrites par la fonction powens seule :
--   AUCUN droit de modification ajouté pour authenticated (seules les cinq colonnes de rattachement de 0021 le restent).
-- appliquer_propositions : repart exactement de 0027 ; les ajouts sont :
--   - la cible config accepte aussi enveloppes_infos, prets_infos, donations et avis_impot (liste blanche et messages mis à jour) ; un bloc
--     par clé, sur le modèle du bloc frais_enveloppes (fusion par clé pour enveloppes_infos et prets_infos, remplacement de la liste pour
--     donations, remplacement de l'objet pour avis_impot) ; chaque date est réelle, et celles d'un document ou d'un événement passé (ouverture,
--     versement, donation, signature, le) ne sont jamais dans le futur (date de Paris) ;
--   - la branche profil contrôle personnes.<p1|p2>.naissance (AAAA-MM-JJ ou AAAA-MM, date réelle, pas dans le futur, pas avant 1900) ;
--     le champ appartient à FOY1, ce contrôle y est posé dès maintenant pour que le calendrier ne lise jamais une date absurde.
--   Tout le reste est inchangé : tout ou rien, security invoker, search_path vide, mêmes messages et mêmes droits.
--   Les contrôles sont répétés à l'identique dans le connecteur (supabase/functions/mcp/reglages.ts) et dans la démo (store-demo.js) :
--   l'utilisateur peut corriger une proposition avant de la valider, et seule la base voit la valeur finale.

-- ---------------------------------------------------------------------------
-- config : informations d'enveloppes, de prêts, donations, avis d'impôt
-- ---------------------------------------------------------------------------
alter table public.config
  add column if not exists enveloppes_infos jsonb not null default '{}'::jsonb,
  add column if not exists prets_infos      jsonb not null default '{}'::jsonb,
  add column if not exists donations        jsonb not null default '[]'::jsonb,
  add column if not exists avis_impot       jsonb not null default '{}'::jsonb;
alter table public.config drop constraint if exists config_enveloppes_infos;
alter table public.config add constraint config_enveloppes_infos check (jsonb_typeof(enveloppes_infos) = 'object');
alter table public.config drop constraint if exists config_prets_infos;
alter table public.config add constraint config_prets_infos check (jsonb_typeof(prets_infos) = 'object');
alter table public.config drop constraint if exists config_donations;
alter table public.config add constraint config_donations check (jsonb_typeof(donations) = 'array');
alter table public.config drop constraint if exists config_avis_impot;
alter table public.config add constraint config_avis_impot check (jsonb_typeof(avis_impot) = 'object');

-- ---------------------------------------------------------------------------
-- reperes : date de fin et unité « mois »
-- ---------------------------------------------------------------------------
alter table public.reperes add column if not exists date_fin date;
alter table public.reperes drop constraint if exists reperes_date_fin;
alter table public.reperes add constraint reperes_date_fin check (date_fin is null or date_fin >= date_effet);
alter table public.reperes drop constraint if exists reperes_unite_check;
alter table public.reperes add constraint reperes_unite_check check (unite in ('%', '€', 'ans', 'mois'));

-- ---------------------------------------------------------------------------
-- banque_comptes : données de prêt transmises par Powens (écrites par la fonction powens seule)
-- ---------------------------------------------------------------------------
alter table public.banque_comptes
  add column if not exists ouverture_le       date,
  add column if not exists pret               jsonb,
  add column if not exists infos_proposees_le timestamptz;
alter table public.banque_comptes drop constraint if exists banque_comptes_pret;
alter table public.banque_comptes add constraint banque_comptes_pret check (pret is null or jsonb_typeof(pret) = 'object');
-- Aucun droit de modification ajouté : les droits par colonne de 0021 (position_id, enveloppe, titulaire, credit_id, ignore) restent les seuls.

-- ---------------------------------------------------------------------------
-- appliquer_propositions(ids, modifications) : 0027 + enveloppes_infos, prets_infos, donations, avis_impot (cible config) et
-- contrôle de personnes.<p1|p2>.naissance (cible profil).
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
          if p.operation = 'creer' then
            insert into public.positions (user_id, name, envelope, owner, bloc, mode, isin, qty, pru, price_override, value, value_date,
                                          status, hypothesis, qty_estimated, note)
            values (v_uid, coalesce(nullif(btrim(v->>'name'), ''), 'Sans nom'), coalesce(v->>'envelope', ''), coalesce(v->>'owner', 'p1'),
                    coalesce(v->>'bloc', ''),
                    coalesce(v->>'mode', case when v_isin is not null and v->>'qty' is not null then 'market' else 'manual' end),
                    v_isin, (v->>'qty')::numeric, (v->>'pru')::numeric, (v->>'price_override')::numeric, (v->>'value')::numeric,
                    coalesce((v->>'value_date')::date, case when v->>'value' is not null then current_date end),
                    coalesce(v->>'status', 'actif'), v->>'hypothesis', coalesce((v->>'qty_estimated')::boolean, false), v->>'note')
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
              note           = case when v ? 'note' then v->>'note' else note end
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
         where k not in ('cushion', 'recurring', 'frais_enveloppes', 'enveloppes_infos', 'prets_infos', 'donations', 'avis_impot') limit 1;
        if v_key is not null then
          raise exception 'réglage « % » non modifiable par proposition (cushion, recurring, frais_enveloppes, enveloppes_infos, prets_infos, donations ou avis_impot seulement)', v_key;
        end if;
        if not (v ? 'cushion' or v ? 'recurring' or v ? 'frais_enveloppes' or v ? 'enveloppes_infos' or v ? 'prets_infos' or v ? 'donations' or v ? 'avis_impot') then
          raise exception 'réglages : cushion ou recurring attendu (ou frais_enveloppes, enveloppes_infos, prets_infos, donations ou avis_impot)';
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

        -- frais_enveloppes (0026) : { "<enveloppe>": { gestion_uc_pct?, gestion_euro_pct?, garde_pct?, source, le? } | null },
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
            select k into v_txt from jsonb_object_keys(v_val) k where k not in ('gestion_uc_pct', 'gestion_euro_pct', 'garde_pct', 'source', 'le') limit 1;
            if v_txt is not null then
              raise exception 'frais_enveloppes « % » : champ « % » inconnu (gestion_uc_pct, gestion_euro_pct, garde_pct, source, le)', v_env, v_txt;
            end if;
            v_ligne := '{}'::jsonb;
            foreach v_txt in array array['gestion_uc_pct', 'gestion_euro_pct', 'garde_pct'] loop
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
              raise exception 'frais_enveloppes « % » : au moins un pourcentage attendu (gestion_uc_pct, gestion_euro_pct ou garde_pct)', v_env;
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
-- Repères du calendrier (spec § 11.2, valeurs recopiées à l'identique, vérifiées le 2026-10-14 sur les sources citées).
-- Bloc séparé du reste de la migration : idempotent (on conflict (cle) do update, date_fin comprise).
-- ---------------------------------------------------------------------------
insert into public.reperes (cle, libelle, valeur, unite, date_effet, date_fin, source_titre, source_url, verifie_le) values
  ('pea_duree_ans', 'Durée après laquelle un retrait ne clôture plus le PEA', 5, 'ans', '2019-05-24', null, 'Service-public — PEA : retraits et clôture', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F22449', '2026-10-14'),
  ('pea_pme_plafond_global', 'Plafond cumulé PEA + PEA PME-ETI par titulaire', 225000, '€', '2019-05-24', null, 'Service-public — Plan d''épargne en actions (PEA)', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2385', '2026-10-14'),
  ('pea_jeune_plafond', 'Plafond du PEA d''un majeur rattaché au foyer de ses parents', 20000, '€', '2019-05-24', null, 'Service-public — PEA', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2385', '2026-10-14'),
  ('av_duree_ans', 'Durée d''un contrat d''assurance-vie ouvrant l''abattement annuel', 8, 'ans', '1990-01-01', null, 'BOFiP — BOI-RPPM-RCM-30-10-20-20 (durée du contrat)', 'https://bofip.impots.gouv.fr/bofip/9312-PGP.html/identifiant=BOI-RPPM-RCM-30-10-20-20-20220630', '2026-10-14'),
  ('av_seuil_versements', 'Seuil de primes nettes pour le taux réduit de l''assurance-vie après 8 ans', 150000, '€', '2017-09-27', null, 'Service-public — Fiscalité de l''assurance-vie', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F22414', '2026-10-14'),
  ('av_age_seuil', 'Âge de l''assuré qui sépare les régimes 990 I et 757 B', 70, 'ans', '2023-03-11', null, 'Légifrance — CGI art. 757 B', 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288569', '2026-10-14'),
  ('av_990i_abattement', 'Abattement par bénéficiaire, primes versées avant 70 ans (art. 990 I)', 152500, '€', '2023-03-11', null, 'Légifrance — CGI art. 990 I', 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288653', '2026-10-14'),
  ('av_757b_abattement', 'Abattement global, primes versées après 70 ans (art. 757 B)', 30500, '€', '2023-03-11', null, 'Légifrance — CGI art. 757 B', 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288569', '2026-10-14'),
  ('pel_retrait_min_ans', 'Durée en dessous de laquelle la résiliation du PEL fait appliquer aux intérêts le taux du CEL', 2, 'ans', '2019-09-01', null, 'Légifrance — Code de la construction et de l''habitation, art. R315-32', 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000039042305', '2026-10-14'),
  ('pel_duree_min_ans', 'Durée minimale du PEL', 4, 'ans', '2019-09-01', null, 'Légifrance — Code de la construction et de l''habitation, art. R315-28', 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000039042324', '2026-10-14'),
  ('pel_duree_max_ans', 'Durée maximale de versement du PEL', 10, 'ans', '2011-03-01', null, 'Service-public — PEL', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F16140', '2026-10-14'),
  ('pel_duree_vie_ans', 'Durée au terme de laquelle un PEL ouvert depuis le 1er mars 2011 devient un livret ordinaire', 15, 'ans', '2011-03-01', null, 'Service-public — PEL', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F16140', '2026-10-14'),
  ('pel_exoneration_ir_ans', 'Années d''intérêts exonérés d''impôt sur le revenu, PEL ouvert du 1er avril 1992 au 31 décembre 2017', 12, 'ans', '2018-01-01', null, 'BOFiP — BOI-RPPM-RCM-10-10-50, § 60', 'https://bofip.impots.gouv.fr/bofip/857-PGP.html', '2026-10-14'),
  ('pel_taux_ouverture', 'Taux du PEL ouvert en 2026 (fixé à l''ouverture)', 2, '%', '2026-01-01', '2026-12-31', 'Légifrance — avis du 20 décembre 2025 relatif au taux du PEL', 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053095350', '2026-10-14'),
  ('pee_blocage_ans', 'Durée minimale de blocage d''un versement sur un PEE', 5, 'ans', '2021-01-01', null, 'Légifrance — Code du travail art. L3332-25', 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042340834', '2026-10-14'),
  ('donation_rappel_ans', 'Délai de rappel fiscal des donations', 15, 'ans', '2012-08-17', null, 'Service-public — Donation : abattements', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F14203', '2026-10-14'),
  ('donation_abattement_enfant', 'Abattement par parent et par enfant sur une donation', 100000, '€', '2012-08-17', null, 'Service-public — Donation : abattements', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F14203', '2026-10-14'),
  ('don_familial_argent', 'Don familial de sommes d''argent (art. 790 G), par donateur et par bénéficiaire', 31865, '€', '2023-12-31', null, 'Légifrance — CGI art. 790 G', 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041471332', '2026-10-14'),
  ('don_logement_donateur', 'Dons pour un logement neuf ou une rénovation énergétique : plafond par donateur et par donataire (art. 790 A bis)', 100000, '€', '2025-02-15', '2026-12-31', 'Service-public — Don familial de sommes d''argent', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F36656', '2026-10-14'),
  ('don_logement_donataire', 'Dons pour un logement neuf ou une rénovation énergétique : plafond par donataire (art. 790 A bis)', 300000, '€', '2025-02-15', '2026-12-31', 'Légifrance — CGI art. 790 A bis', 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043662329', '2026-10-14'),
  ('mv_report_ans', 'Années de report des moins-values sur valeurs mobilières', 10, 'ans', '2017-01-01', null, 'Service-public — Plus-values sur valeurs mobilières', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F21618', '2026-10-14'),
  ('per_report_ans', 'Années de report du plafond épargne retraite non utilisé (plafonds depuis 2026)', 5, 'ans', '2026-01-01', null, 'BOFiP — ACTU-2026-00106 (loi de finances pour 2026, art. 10)', 'https://bofip.impots.gouv.fr/bofip/15111-PGP.html/ACTU-2026-00106', '2026-10-14'),
  ('per_report_ans_ancien', 'Années de report du plafond épargne retraite non utilisé (plafonds jusqu''à 2025)', 3, 'ans', '2019-10-01', '2025-12-31', 'Service-public — Plafond de déduction de l''épargne retraite', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F14709', '2026-10-14'),
  ('per_age_fin_deduction', 'Âge à partir duquel les versements sur un PER ne sont plus déductibles', 70, 'ans', '2026-01-01', null, 'Service-public — Plafond de déduction de l''épargne retraite', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F14709', '2026-10-14'),
  ('per_plafond_plancher', 'Plafond minimal de déduction épargne retraite (2026)', 4710, '€', '2026-01-01', '2026-12-31', 'Service-public — Plafond de déduction de l''épargne retraite', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F14709', '2026-10-14'),
  ('per_plafond_max', 'Plafond maximal de déduction épargne retraite d''un salarié (2026)', 37680, '€', '2026-01-01', '2026-12-31', 'Service-public — Plafond de déduction de l''épargne retraite', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F14709', '2026-10-14'),
  ('ps_taux_general', 'Prélèvements sociaux sur les revenus du capital, cas général', 18.6, '%', '2026-01-01', null, 'Service-public — Prélèvements sociaux sur les revenus du capital', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2329', '2026-10-14'),
  ('ps_taux_av_epargne_logement', 'Prélèvements sociaux sur l''assurance-vie, le PEL et le CEL', 17.2, '%', '2018-01-01', null, 'Service-public — Prélèvements sociaux sur les revenus du capital', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2329', '2026-10-14'),
  ('lep_rfr_1_part', 'Revenu fiscal de référence maximal pour un LEP, 1 part (métropole, 2026)', 23028, '€', '2026-01-01', '2026-12-31', 'Service-public — Livret d''épargne populaire (LEP)', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2367', '2026-10-14'),
  ('ira_plafond_mois', 'Plafond des indemnités de remboursement anticipé : mois d''intérêts', 6, 'mois', '2016-07-01', null, 'Légifrance — Code de la consommation R313-25', 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032807570/', '2026-10-14'),
  ('ira_plafond_pct', 'Plafond des indemnités de remboursement anticipé : part du capital restant dû', 3, '%', '2016-07-01', null, 'Légifrance — Code de la consommation R313-25', 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032807570/', '2026-10-14'),
  ('assurance_emprunteur_sans_questionnaire', 'Part assurée par assuré en dessous de laquelle aucun questionnaire de santé n''est demandé (fin du crédit avant 60 ans)', 200000, '€', '2022-06-01', null, 'Légifrance — loi n° 2022-270 du 28 février 2022', 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000045268729', '2026-10-14')
on conflict (cle) do update set libelle = excluded.libelle, valeur = excluded.valeur, unite = excluded.unite, date_effet = excluded.date_effet,
  date_fin = excluded.date_fin, source_titre = excluded.source_titre, source_url = excluded.source_url, verifie_le = excluded.verifie_le;

-- Mises à jour de deux repères de 0010 (taux du Livret A et du LEP) : valeur, date d'effet, date de fin de la période du taux et
-- source (les arrêtés, qui portent la période). Le moteur du calendrier date la révision des livrets au lendemain de date_fin.
insert into public.reperes (cle, libelle, valeur, unite, date_effet, date_fin, source_titre, source_url, verifie_le) values
  ('livret_a_taux', 'Taux du Livret A (et du LDDS)', 1.7, '%', '2026-08-01', '2027-01-31', 'Légifrance — arrêté du 28 juillet 2026 relatif aux taux d''intérêt des produits d''épargne réglementée', 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054541376', '2026-10-14'),
  ('lep_taux', 'Taux du LEP', 2.5, '%', '2026-08-01', '2027-01-31', 'Légifrance — arrêté du 29 juillet 2026 relatif au taux d''intérêt du livret d''épargne populaire', 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569438', '2026-10-14')
on conflict (cle) do update set libelle = excluded.libelle, valeur = excluded.valeur, unite = excluded.unite, date_effet = excluded.date_effet,
  date_fin = excluded.date_fin, source_titre = excluded.source_titre, source_url = excluded.source_url, verifie_le = excluded.verifie_le;
