-- Boussole : banque, rapprochement automatique et anti-doublons (BQ1 suite, docs/superpowers/specs/2026-10-12-bq1-powens-design.md).
-- Non appliquée : à appliquer sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "banque_rapprochement"), AVANT le
-- déploiement de la fonction powens et de l'app qui lisent ces colonnes.
--   banque_connexions : + connecteur (identifiant du connecteur Powens, connection.id_connector) et doublon_de (id de l'autre
--                       connexion du même établissement quand celle-ci ne contient que des comptes déjà présents dans l'autre :
--                       connexion à déconnecter). Écrits par la fonction powens (service_role) seulement.
--   banque_comptes    : + doublon_de (id du compte jumeau d'une autre connexion du même établissement : compte en double, ni
--                       proposition ni rattachement automatique), rattache_auto (horodatage du rattachement posé automatiquement
--                       par la synchronisation ; remis à null par le déclencheur dès que l'utilisateur modifie le rattachement),
--                       cree_auto (la ligne ou l'enveloppe visée a été créée par la synchronisation : « Créé automatiquement » ;
--                       remis à false avec rattache_auto),
--                       auto_retire_le (l'utilisateur a modifié ou retiré un rattachement automatique : plus jamais de rattachement
--                       automatique pour ce compte), suggestion (null ou { type: ligne|enveloppe|credit, id?, enveloppe?,
--                       titulaire?, libelle, raison } : rattachement probable quand plusieurs candidats existent). Écrits par la
--                       fonction powens seulement : authenticated garde ses 5 colonnes modifiables (0021), rien de plus.
--   Index uniques partiels : une ligne (position_id) ou un crédit (credit_id) n'est rattaché qu'à un seul compte par utilisateur.
--                       Les doublons existants sont d'abord détachés (le compte actif de plus petit identifiant garde son rattachement).
--   banque_comptes_rattachement (déclencheur de 0021, remplacé) : mêmes règles, plus
--                       - ligne ou crédit déjà rattaché à un autre compte : refus en français (« Cette ligne est déjà rattachée au
--                         compte X. » / « Ce crédit est déjà rattaché au compte X. »), avant la violation d'index ;
--                       - modification du rattachement par l'utilisateur (rôle authenticated) : rattache_auto et suggestion remis à
--                         null ; si le rattachement était automatique, auto_retire_le = now() ;
--                       - ignore = true : rattache_auto, cree_auto et suggestion remis à null ;
--                       - l'utilisateur quitte un rattachement créé automatiquement (ignore, autre cible ou aucune) : la ligne créée
--                         (source_auto = 'powens'), ou pour une enveloppe créée les lignes de ses placements encore alimentées,
--                         passent en « clôturé » (jamais supprimées).
--   export_all()      : inchangée (to_jsonb des lignes : les nouvelles colonnes y figurent d'elles-mêmes).
--   Tests : test/banque-rapprochement-pglite.test.mjs (PGlite, baseComplete).

-- ---------------------------------------------------------------------------
-- Colonnes
-- ---------------------------------------------------------------------------
alter table public.banque_connexions
  add column connecteur bigint,
  add column doublon_de bigint;

alter table public.banque_comptes
  add column doublon_de     bigint,
  add column rattache_auto  timestamptz,
  add column cree_auto      boolean not null default false,
  add column auto_retire_le timestamptz,
  add column suggestion     jsonb constraint banque_comptes_suggestion check (
    suggestion is null or coalesce(
      jsonb_typeof(suggestion) = 'object'
      and suggestion->>'type' in ('ligne', 'enveloppe', 'credit')
      and jsonb_typeof(suggestion->'libelle') = 'string'
      and char_length(suggestion::text) <= 2000, false));

-- Rien de plus pour authenticated : la mise à jour reste limitée aux 5 colonnes accordées par 0021 (droits par colonne).
revoke update on table public.banque_comptes from authenticated;
grant update (position_id, enveloppe, titulaire, credit_id, ignore) on public.banque_comptes to authenticated;
revoke update on table public.banque_connexions from authenticated;

-- ---------------------------------------------------------------------------
-- Anti-doublons : une ligne, un crédit → un seul compte. Doublons existants détachés d'abord (sans quoi l'index échoue).
-- ---------------------------------------------------------------------------
with rangs as (
  select user_id, id, row_number() over (partition by user_id, position_id order by actif desc, id) n
    from public.banque_comptes where position_id is not null
)
update public.banque_comptes k set position_id = null
  from rangs r where r.user_id = k.user_id and r.id = k.id and r.n > 1;

with rangs as (
  select user_id, id, row_number() over (partition by user_id, credit_id order by actif desc, id) n
    from public.banque_comptes where credit_id is not null
)
update public.banque_comptes k set credit_id = null
  from rangs r where r.user_id = k.user_id and r.id = k.id and r.n > 1;

create unique index banque_comptes_position_unique on public.banque_comptes (user_id, position_id) where position_id is not null;
create unique index banque_comptes_credit_unique   on public.banque_comptes (user_id, credit_id)   where credit_id is not null;

-- ---------------------------------------------------------------------------
-- Déclencheur de rattachement (remplace celui de 0021). Security invoker : lectures filtrées explicitement par user_id ;
-- current_user = 'authenticated' : écriture de l'utilisateur (app), sinon service (fonction powens) ou administrateur.
-- ---------------------------------------------------------------------------
create or replace function public.banque_comptes_rattachement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_autre text;
begin
  new.enveloppe := nullif(btrim(new.enveloppe), '');
  if new.ignore then
    new.position_id := null; new.enveloppe := null; new.titulaire := null; new.credit_id := null;
    new.suggestion := null;
  end if;
  -- L'utilisateur modifie le rattachement : le rattachement n'est plus automatique, la suggestion est caduque ; s'il retire ou
  -- change un rattachement automatique, la synchronisation ne rattachera plus ce compte d'elle-même ; s'il quitte une ligne ou une
  -- enveloppe créée par la synchronisation, ce qu'elle avait créé passe en « clôturé » (jamais supprimé).
  if tg_op = 'UPDATE' and current_user = 'authenticated'
     and (new.position_id, new.enveloppe, new.titulaire, new.credit_id, new.ignore)
         is distinct from (old.position_id, old.enveloppe, old.titulaire, old.credit_id, old.ignore) then
    if old.rattache_auto is not null then
      new.auto_retire_le := now();
    end if;
    if old.cree_auto and old.position_id is not null and new.position_id is distinct from old.position_id then
      update public.positions p set status = 'clôturé'
       where p.id = old.position_id and p.user_id = old.user_id and p.source_auto = 'powens' and p.status <> 'clôturé';
    end if;
    if old.cree_auto and old.enveloppe is not null and new.enveloppe is distinct from old.enveloppe then
      update public.positions p set status = 'clôturé'
       where p.user_id = old.user_id and p.source_auto = 'powens' and p.status <> 'clôturé'
         and p.id in (select bp.position_id from public.banque_placements bp where bp.user_id = old.user_id and bp.compte_id = old.id);
    end if;
    new.rattache_auto := null;
    new.cree_auto := false;
    new.suggestion := null;
  end if;
  if new.ignore then
    new.rattache_auto := null; new.cree_auto := false;
    return new;
  end if;
  if new.credit_id is not null and new.type is distinct from 'credit' then
    if tg_op = 'UPDATE' and new.credit_id is not distinct from old.credit_id then
      new.credit_id := null;
    else
      raise exception 'Rattachement invalide : un crédit se rattache seulement à un compte de crédit.' using errcode = '22023';
    end if;
  end if;
  if new.position_id is not null and new.enveloppe is not null then
    raise exception 'Rattachement invalide : un compte se rattache à une ligne ou à une enveloppe, pas aux deux.' using errcode = '22023';
  end if;
  if new.position_id is not null
     and not exists (select 1 from public.positions p where p.id = new.position_id and p.user_id = new.user_id) then
    raise exception 'Ligne introuvable : choisis une de tes lignes.' using errcode = '22023';
  end if;
  if new.credit_id is not null
     and not exists (select 1 from public.credits c where c.id = new.credit_id and c.user_id = new.user_id) then
    raise exception 'Crédit introuvable : choisis un de tes crédits.' using errcode = '22023';
  end if;
  -- Une ligne, un crédit : un seul compte (index uniques partiels ; message en français avant la violation).
  if new.position_id is not null and (tg_op = 'INSERT' or new.position_id is distinct from old.position_id) then
    select coalesce(nullif(btrim(k.nom), ''), 'sans nom') || coalesce(' (' || nullif(btrim(c.etablissement), '') || ')', '') into v_autre
      from public.banque_comptes k left join public.banque_connexions c on c.user_id = k.user_id and c.id = k.connexion_id
     where k.user_id = new.user_id and k.position_id = new.position_id and k.id <> new.id limit 1;
    if found then
      raise exception 'Cette ligne est déjà rattachée au compte %.', v_autre using errcode = '23505';
    end if;
  end if;
  if new.credit_id is not null and (tg_op = 'INSERT' or new.credit_id is distinct from old.credit_id) then
    select coalesce(nullif(btrim(k.nom), ''), 'sans nom') || coalesce(' (' || nullif(btrim(c.etablissement), '') || ')', '') into v_autre
      from public.banque_comptes k left join public.banque_connexions c on c.user_id = k.user_id and c.id = k.connexion_id
     where k.user_id = new.user_id and k.credit_id = new.credit_id and k.id <> new.id limit 1;
    if found then
      raise exception 'Ce crédit est déjà rattaché au compte %.', v_autre using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.banque_comptes_rattachement() from public, anon, authenticated;
