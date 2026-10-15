-- Boussole : import de l'historique réel, partie base (HIS2, docs/superpowers/specs/2026-10-16-his2-historique-design.md § 4, § 5.1 et § 8 ;
-- plan docs/superpowers/plans/2026-10-16-his2-historique.md, tâche 1).
-- Non appliquée : à appliquer avec apply_migration (name = "historique") sur le projet oapcewpqsbbjdlcdeizi, après 0033 (connecteurs_autorises,
-- la dernière appliquée en production : régime des politiques de double authentification), AVANT le déploiement de la fonction mcp (outils
-- d'import) et de la fonction nightly (photos reconstituées). BUD1 prend 0035 et suivantes (D8) : 0035 redéfinit sous_categorie_budget_valide.
-- Avant de l'appliquer, vérifier en production : select count(*) from public.transactions where position_id is null (doit valoir 0 : la
-- contrainte transactions_position_ou_enveloppe l'exige désormais pour toute ligne ne portant pas d'enveloppe) ; show server_version_num
-- (150000 au moins : « on delete set null (colonne) » des clés composites).
--
-- Données privées, jamais d'opération brute (D1) : des totaux mensuels par compte et catégorie, des mouvements de placement datés, des photos
-- mensuelles reconstituées. Aucun libellé d'opération, aucun tiers, aucun IBAN, aucun numéro de compte ou de carte.
--   historique_comptes       : les comptes dont on importe les relevés (libellé court choisi avec l'utilisateur, jamais un numéro) ;
--   historique_imports       : la trace de chaque import validé (id = ref de la proposition ; empreinte du contenu unique par utilisateur ;
--                              lignes_creees : lignes clôturées créées par l'import, pour que le retrait les enlève ; colonne ajoutée au § 4.2) ;
--   historique_releves       : un en-tête par (compte, mois) : soldes, totaux de contrôle, mois complet ou non ;
--   historique_banque_mois   : les totaux par (compte, mois, catégorie, sous-catégorie), au modèle de banque_mois ;
--   photos_reconstituees     : une photo par fin de mois avant la première photo observée, écrite par le service (la nuit) seulement.
--   transactions : colonnes import_id, cle_import, enveloppe, frais, doublon_de, estime (nulles ou fausses pour l'existant : aucun changement
--   de comportement) ; contrainte « une ligne OU une enveloppe » ; index unique partiel (user_id, cle_import). status.historique_a_recalculer.
--   Clés étrangères composites (user_id, …) partout (import_id, doublon_de, position_id d'un compte) : jamais la ligne d'un autre ; d'où
--   positions_user_id_id et transactions_user_id_id. Déclencheur transactions_historique_garde : un jeton OAuth (client_id) n'écrit ni ne
--   supprime jamais un mouvement importé ou remplacé, ni import_id, cle_import ou doublon_de.
--
-- Double authentification (formes exactes de 0033) :
--   - régime bancaire (les quatre tables historique_*) : politique restrictive « <table>: aal2 » (lecture en aal2 OU par un connecteur
--     autorisé ; écriture en aal2 ET sans client_id dans le jeton) et « <table>: suppression aal2 » (aal2 et sans client_id). Le connecteur
--     ne fait que lire ; l'app (aal2) écrit par appliquer_propositions et retirer_import. Sans second facteur, ces tables restent fermées ;
--   - régime « si facteur » (photos_reconstituees, comme snapshots) : aal2, OU pas de facteur vérifié, OU connecteur autorisé. Aucun droit
--     d'écriture pour authenticated : seul le service écrit ;
--   - (select auth.jwt()) et (select auth.uid()) partout ; droits explicites de authenticated et de service_role (anon : rien).
-- Fonctions (security invoker, search_path vide ; la RLS borne tout) :
--   - categorie_budget_valide(text) : les 12 catégories larges de CATEGORIES_BANQUE ; sous_categorie_budget_valide(text, text) : vrai
--     seulement pour la sous-catégorie vide (0035 de BUD1 la redéfinit avec sa taxonomie, spec § 4.3) ;
--   - historique_isin_valide, historique_sensible, historique_texte, historique_nombre : contrôles purs (clé de contrôle de l'ISIN ;
--     contenu_sensible aussi sur le texte aux espaces Unicode normalisés et aux séparateurs « - . / _ » entre chiffres ; texte borné sans
--     contenu sensible ni longue suite de chiffres, caractères invisibles retirés ; nombre borné) ;
--   - historique_appliquer(ref, apres, source) : la branche « historique » de appliquer_propositions, en 7 étapes (spec § 4.6) ; les
--     contrôles bloquants du § 5.1 sont répétés ici (pas les avertissements) ; tout ou rien ; un import ou un retrait à la fois par
--     utilisateur (verrou consultatif de transaction : les limites valent aussi pour deux validations simultanées) ;
--   - historique_retirer(id) : efface l'import (cascade : mois, mouvements ; doublon_de revient à nul), puis les lignes clôturées créées
--     par lui et restées sans transaction ; pose la demande de recalcul ;
--   - retirer_import(id) : écriture de contrôle de l'app (D5) ; exige aal2 et un jeton sans client_id (jamais par un connecteur).
-- appliquer_propositions : repart exactement de 0032 (sa dernière définition ; 0033 ne la redéfinit pas) ; le diff se limite à la cible
--   historique (déclaration de v_hist, libellé de v_quoi, branche when 'historique'). La proposition n'est pas modifiable avant validation.
-- export_all : repart de 0033 (garde « pas de jeton OAuth » conservée) et sort les cinq tables de plus.
-- Contrat de apres (création) : { type: releves|ordres|versements, empreinte (hex 64), fichier { nom?, format, lignes?, octets?, periode?,
--   sha256? }, etablissement, etablissement_libre?, compte { id } | { libelle, type, titulaire, cle, banque_compte_id?, position_id? }
--   (releves), enveloppe (ordres, versements), periode { du, au }, donnees { mois[] } | { mouvements[] }, lignes_a_creer[]?, doublons[]?,
--   resume {}, avertissements [] }. Mois : { mois: 'AAAA-MM', complet, controle { total_entrees, total_sorties, solde_debut?, solde_fin?,
--   nombre? }, categories [{ categorie, sous_categorie, entrees, sorties, nombre }] }. Mouvement : { cle_import, date, type, position_id? |
--   isin? (ligne créée par lignes_a_creer), enveloppe?, qty?, price?, amount?, frais?, estime?, note?, devise? }. Une quantité initiale ou
--   un relevé de titres est un mouvement de type releve avec qty (point de contrôle ; il ne fait que relever, jamais baisser, la
--   quantité cumulée du contrôle « jamais négative »). Types admis pour un import : ordres achat, vente, releve ; versements versement,
--   retrait, rachat, arbitrage_entree, arbitrage_sortie, dividende, interets, frais, releve (programme est réservé à la nuit, solde à l'app).
-- Tests : test/historique-pglite.test.mjs, test/mfa-pglite.test.mjs, test/connecteur-autorise-pglite.test.mjs (PGlite, baseComplete),
--   test/isolation.test.mjs (préproduction locale).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Fonctions pures
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.categorie_budget_valide(categorie text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(categorie in ('logement', 'alimentation', 'transport', 'enfants', 'sante', 'loisirs', 'abonnements', 'impots', 'divers',
                        'revenus', 'epargne', 'virement_interne'), false);
$$;

-- Couture avec BUD1 : seule la sous-catégorie vide est valide en 0034 ; 0035 (BUD1) la redéfinit avec sa taxonomie (create or replace : garder
-- la signature et les noms de paramètres (categorie, sous_categorie), qu'un create or replace ne peut pas changer).
create function public.sous_categorie_budget_valide(categorie text, sous_categorie text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(public.categorie_budget_valide(categorie) and sous_categorie = '', false);
$$;

-- ISIN : deux lettres, neuf caractères, un chiffre, et clé de contrôle (Luhn sur les lettres converties A=10 … Z=35) ; ou symbole X-…
create function public.historique_isin_valide(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_s    text := '';
  v_i    int;
  v_c    text;
  v_somme int := 0;
  v_d    int;
  v_dbl  boolean := false;
begin
  if p is null then return false; end if;
  if p ~ '^X-[A-Za-z0-9._=-]{1,30}$' then return true; end if;
  if p !~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$' then return false; end if;
  for v_i in 1..12 loop
    v_c := substr(p, v_i, 1);
    v_s := v_s || case when v_c ~ '[0-9]' then v_c else (ascii(v_c) - 55)::text end;
  end loop;
  for v_i in reverse char_length(v_s)..1 loop
    v_d := substr(v_s, v_i, 1)::int;
    if v_dbl then
      v_d := v_d * 2;
      if v_d > 9 then v_d := v_d - 9; end if;
    end if;
    v_somme := v_somme + v_d;
    v_dbl := not v_dbl;
  end loop;
  return v_somme % 10 = 0;
end;
$$;

-- Contenu sensible d'un texte de l'historique : contenu_sensible (0009) sur le texte tel quel, puis sur le texte dont les espaces
-- Unicode (insécables, fines, typographiques : U+00A0, U+2000 à U+200A, U+202F, U+205F, U+3000, tabulations) deviennent des espaces
-- simples et dont les caractères invisibles (U+200B à U+200F, U+2060, U+FEFF) sont retirés : sans cela, un IBAN ou un numéro de carte
-- écrit avec des espaces insécables passerait (le motif de 0009 n'admet que l'espace simple). Avec p_separateurs, aussi sur le texte
-- dont les tirets, points, barres et soulignés suivis d'un chiffre deviennent des espaces (« FR76-3000-6000-… »). Pas pour un résumé
-- jsonb (p_separateurs faux) : un uuid dont les premiers groupes ne sont que des chiffres y ressemblerait à un numéro de carte.
create function public.historique_sensible(p text, p_separateurs boolean default true)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(public.contenu_sensible(p) or public.contenu_sensible(v.e)
           or (p_separateurs and public.contenu_sensible(regexp_replace(v.e, '([0-9A-Za-z])[-./_]+(?=[0-9])', '\1 ', 'g'))), false)
    from (select regexp_replace(regexp_replace(p, '[\u200B-\u200F\u2060\uFEFF]', '', 'g'),
                                '[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\t\n\r\f\v]', ' ', 'g') as e) v;
$$;

-- Texte borné : chaîne rognée, longueur, contenu sensible (historique_sensible) et suite de p_chiffres chiffres ou plus refusés (0 : pas
-- de contrôle des chiffres ; caractères invisibles retirés avant de compter). Rend null pour une valeur absente, nulle ou vide quand elle
-- n'est pas requise.
create function public.historique_texte(j jsonb, p_nom text, p_max int, p_requis boolean default false, p_chiffres int default 0)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_t text;
begin
  if j is null or jsonb_typeof(j) = 'null' then
    if p_requis then raise exception '% : texte attendu', p_nom; end if;
    return null;
  end if;
  if jsonb_typeof(j) <> 'string' then raise exception '% : texte attendu', p_nom; end if;
  v_t := public.foyer_rogner(j #>> '{}');
  if v_t = '' then
    if p_requis then raise exception '% : texte attendu', p_nom; end if;
    return null;
  end if;
  if char_length(v_t) > p_max then raise exception '% : % caractères au plus', p_nom, p_max; end if;
  if public.historique_sensible(v_t) then
    raise exception '% : contenu sensible refusé (numéro de compte ou de carte, mot de passe)', p_nom;
  end if;
  if p_chiffres > 0 and regexp_replace(v_t, '[\u200B-\u200F\u2060\uFEFF]', '', 'g') ~ ('[0-9]{' || p_chiffres || ',}') then
    raise exception '% : une suite de % chiffres ou plus est refusée (pas de numéro dans un libellé)', p_nom, p_chiffres;
  end if;
  return v_t;
end;
$$;

-- Nombre JSON (jamais une chaîne) borné. Rend null pour une valeur absente ou nulle quand elle n'est pas requise.
create function public.historique_nombre(j jsonb, p_nom text, p_min numeric, p_max numeric, p_requis boolean default true)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n numeric;
begin
  if j is null or jsonb_typeof(j) = 'null' then
    if p_requis then raise exception '% : nombre attendu', p_nom; end if;
    return null;
  end if;
  if jsonb_typeof(j) <> 'number' then raise exception '% : nombre attendu', p_nom; end if;
  v_n := (j #>> '{}')::numeric;
  if v_n < p_min or v_n > p_max then raise exception '% : valeur hors limites (de % à %)', p_nom, p_min, p_max; end if;
  return v_n;
end;
$$;

revoke all on function public.categorie_budget_valide(text), public.sous_categorie_budget_valide(text, text), public.historique_isin_valide(text),
  public.historique_sensible(text, boolean), public.historique_texte(jsonb, text, int, boolean, int),
  public.historique_nombre(jsonb, text, numeric, numeric, boolean) from public, anon;
grant execute on function public.categorie_budget_valide(text), public.sous_categorie_budget_valide(text, text), public.historique_isin_valide(text),
  public.historique_sensible(text, boolean), public.historique_texte(jsonb, text, int, boolean, int),
  public.historique_nombre(jsonb, text, numeric, numeric, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. Tables (spec § 4.1 à § 4.5)
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Clés étrangères composites (user_id, …) partout : une ligne ne peut désigner que des lignes de son propriétaire (une clé simple
-- laisserait un utilisateur rattacher sa ligne à un import, une ligne du bilan ou une transaction d'un autre dont il connaît l'uuid :
-- la vérification de clé étrangère ne passe pas par la RLS). D'où les clés uniques (user_id, id) de positions et transactions.
alter table public.positions add constraint positions_user_id_id unique (user_id, id);
alter table public.transactions add constraint transactions_user_id_id unique (user_id, id);

create table public.historique_comptes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  libelle             text not null,
  etablissement       text not null,
  etablissement_libre text,
  type                text not null,
  titulaire           text not null,
  banque_compte_id    bigint,
  position_id         uuid,
  cle                 text not null,
  cree_le             timestamptz not null default now(),
  maj_le              timestamptz not null default now(),
  constraint historique_comptes_libelle check (char_length(libelle) between 2 and 40),
  constraint historique_comptes_libelle_sensible check (not public.historique_sensible(libelle) and libelle !~ '[0-9]{6,}'),
  constraint historique_comptes_etablissement check (etablissement in ('lcl', 'boursobank', 'revolut', 'n26', 'linxea', 'autre')),
  constraint historique_comptes_etablissement_libre check (etablissement_libre is null
    or (etablissement = 'autre' and char_length(etablissement_libre) between 1 and 40
        and not public.historique_sensible(etablissement_libre) and etablissement_libre !~ '[0-9]{6,}')),
  constraint historique_comptes_type check (type in ('courant', 'joint', 'livret', 'carte_differe', 'autre')),
  constraint historique_comptes_titulaire check (titulaire in ('p1', 'p2', 'commun')),
  constraint historique_comptes_cle check (char_length(cle) between 1 and 200 and not public.historique_sensible(cle) and cle !~ '[0-9]{6,}'),
  constraint historique_comptes_user_id_id unique (user_id, id),
  constraint historique_comptes_cle_unique unique (user_id, cle),
  constraint historique_comptes_banque foreign key (user_id, banque_compte_id) references public.banque_comptes(user_id, id)
    on delete set null (banque_compte_id),
  constraint historique_comptes_position foreign key (user_id, position_id) references public.positions(user_id, id)
    on delete set null (position_id)
);
create index historique_comptes_banque_idx   on public.historique_comptes (user_id, banque_compte_id) where banque_compte_id is not null;
create index historique_comptes_position_idx on public.historique_comptes (user_id, position_id) where position_id is not null;

create table public.historique_imports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type           text not null,
  empreinte      text not null,
  fichier        jsonb not null default '{}'::jsonb,
  etablissement  text not null,
  compte_id      uuid,
  enveloppe      text,
  periode_du     date not null,
  periode_au     date not null,
  resume         jsonb not null default '{}'::jsonb,
  source         text not null,
  lignes_creees  uuid[] not null default '{}',
  importe_le     timestamptz not null default now(),
  constraint historique_imports_type check (type in ('releves', 'ordres', 'versements')),
  constraint historique_imports_empreinte check (empreinte ~ '^[0-9a-f]{64}$'),
  constraint historique_imports_fichier check (jsonb_typeof(fichier) = 'object' and octet_length(fichier::text) <= 2000),
  constraint historique_imports_etablissement check (etablissement in ('lcl', 'boursobank', 'revolut', 'n26', 'linxea', 'autre')),
  constraint historique_imports_enveloppe check (enveloppe is null or (char_length(enveloppe) between 1 and 100
    and not public.historique_sensible(enveloppe) and enveloppe !~ '[0-9]{8,}')),
  constraint historique_imports_periode check (periode_du <= periode_au and periode_du >= date '1990-01-01'),
  constraint historique_imports_resume check (jsonb_typeof(resume) = 'object' and octet_length(resume::text) <= 4000),
  constraint historique_imports_source check (char_length(source) between 1 and 200 and not public.historique_sensible(source)),
  constraint historique_imports_lignes check (cardinality(lignes_creees) <= 50),
  constraint historique_imports_user_id_id unique (user_id, id),
  constraint historique_imports_empreinte_unique unique (user_id, empreinte),
  constraint historique_imports_compte foreign key (user_id, compte_id) references public.historique_comptes(user_id, id)
    on delete set null (compte_id)
);
create index historique_imports_compte_idx on public.historique_imports (user_id, compte_id) where compte_id is not null;

create table public.historique_releves (
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  compte_id     uuid not null,
  mois          date not null,
  complet       boolean not null,
  solde_debut   numeric,
  solde_fin     numeric,
  total_entrees numeric not null,
  total_sorties numeric not null,
  nombre        int not null default 0,
  import_id     uuid not null,
  primary key (user_id, compte_id, mois),
  constraint historique_releves_mois check (extract(day from mois) = 1 and mois >= date '2000-01-01'),
  constraint historique_releves_soldes check ((solde_debut is null or abs(solde_debut) <= 10000000) and (solde_fin is null or abs(solde_fin) <= 10000000)),
  constraint historique_releves_totaux check (total_entrees between 0 and 10000000 and total_sorties between 0 and 10000000),
  constraint historique_releves_nombre check (nombre between 0 and 5000),
  constraint historique_releves_compte foreign key (user_id, compte_id) references public.historique_comptes(user_id, id) on delete cascade,
  constraint historique_releves_import foreign key (user_id, import_id) references public.historique_imports(user_id, id) on delete cascade
);
create index historique_releves_import_idx on public.historique_releves (user_id, import_id);

create table public.historique_banque_mois (
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  compte_id      uuid not null,
  mois           date not null,
  categorie      text not null,
  sous_categorie text not null default '',
  entrees        numeric not null default 0,
  sorties        numeric not null default 0,
  nombre         int not null default 0,
  primary key (user_id, compte_id, mois, categorie, sous_categorie),
  constraint historique_banque_mois_categorie check (public.categorie_budget_valide(categorie)),
  constraint historique_banque_mois_sous_categorie check (public.sous_categorie_budget_valide(categorie, sous_categorie)),
  constraint historique_banque_mois_montants check (entrees between 0 and 10000000 and sorties between 0 and 10000000),
  constraint historique_banque_mois_nombre check (nombre between 0 and 5000),
  constraint historique_banque_mois_releve foreign key (user_id, compte_id, mois) references public.historique_releves(user_id, compte_id, mois) on delete cascade
);

create table public.photos_reconstituees (
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mois          date not null,
  date          date not null,
  total         numeric not null,
  p1            numeric not null,
  p2            numeric not null,
  financier     numeric not null,
  net           numeric not null,
  by_bloc       jsonb not null default '{}'::jsonb,
  by_envelope   jsonb not null default '{}'::jsonb,
  qualite       text not null,
  part_estimee  numeric not null,
  sources       jsonb not null default '[]'::jsonb,
  methode       text not null,
  calcule_le    timestamptz not null default now(),
  primary key (user_id, mois),
  constraint photos_reconstituees_mois check (extract(day from mois) = 1 and mois >= date '2000-01-01'),
  constraint photos_reconstituees_date check (date = (mois + interval '1 month - 1 day')::date),
  constraint photos_reconstituees_by_bloc check (jsonb_typeof(by_bloc) = 'object' and octet_length(by_bloc::text) <= 20000),
  constraint photos_reconstituees_by_envelope check (jsonb_typeof(by_envelope) = 'object' and octet_length(by_envelope::text) <= 20000),
  constraint photos_reconstituees_qualite check (qualite in ('complet', 'partiel', 'estime')),
  constraint photos_reconstituees_part check (part_estimee between 0 and 1),
  constraint photos_reconstituees_sources check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 30 and octet_length(sources::text) <= 6000),
  constraint photos_reconstituees_methode check (char_length(methode) between 1 and 20)
);

-- Règles de la spec § 4.5 : 240 mois au plus par utilisateur, et jamais de photo reconstituée pour un mois dont la date est postérieure ou
-- égale à la première photo observée (snapshots) de l'utilisateur : l'observé l'emporte toujours. Déclencheur security invoker : il ne
-- tourne que pour le service (la seule écriture), qui lit snapshots sans restriction.
create function public.photos_reconstituees_garde()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_premiere date;
begin
  select min(s.date) into v_premiere from public.snapshots s where s.user_id = new.user_id;
  if v_premiere is not null and new.date >= v_premiere then
    raise exception 'photo reconstituée refusée : le mois % n''est pas antérieur à la première photo observée (%)', to_char(new.mois, 'YYYY-MM'), v_premiere
      using errcode = '23514';
  end if;
  -- le mois lui-même n'est pas compté : un « insert … on conflict do update » de la nuit sur un mois existant, à 240 photos, passe
  if tg_op = 'INSERT' and (select count(*) from public.photos_reconstituees p where p.user_id = new.user_id and p.mois <> new.mois) >= 240 then
    raise exception 'Limite atteinte : 240 photos reconstituées au plus (20 ans).' using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function public.photos_reconstituees_garde() from public, anon, authenticated;
create trigger photos_reconstituees_garde before insert or update on public.photos_reconstituees
  for each row execute function public.photos_reconstituees_garde();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. transactions et status (spec § 4.4 et § 4.5)
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.transactions
  add column import_id  uuid,
  add column cle_import text constraint transactions_cle_import check (cle_import is null or char_length(cle_import) between 1 and 64),
  add column enveloppe  text constraint transactions_enveloppe check (enveloppe is null or (char_length(enveloppe) between 1 and 100
                                                                    and not public.historique_sensible(enveloppe))),
  add column frais      numeric constraint transactions_frais check (frais is null or (frais >= 0 and frais <= 10000000)),
  add column doublon_de uuid,
  add column estime     boolean not null default false;
alter table public.transactions add constraint transactions_position_ou_enveloppe check (position_id is not null or enveloppe is not null);
alter table public.transactions add constraint transactions_doublon_de_autre check (doublon_de is null or doublon_de <> id);
alter table public.transactions add constraint transactions_import foreign key (user_id, import_id) references public.historique_imports(user_id, id)
  on delete cascade;
alter table public.transactions add constraint transactions_doublon_de foreign key (user_id, doublon_de) references public.transactions(user_id, id)
  on delete set null (doublon_de);
create unique index transactions_cle_import_unique on public.transactions (user_id, cle_import) where cle_import is not null;
create index transactions_import_idx    on public.transactions (user_id, import_id) where import_id is not null;
create index transactions_doublon_de_idx on public.transactions (user_id, doublon_de) where doublon_de is not null;

-- Un connecteur (jeton OAuth : client_id) écrit encore transactions (régime « si facteur », 0033) mais jamais ce qui relève d'un import :
-- ni un mouvement importé (import_id), ni une clé d'import (cle_import : elle ferait ignorer le vrai mouvement au prochain import), ni
-- un remplacement (doublon_de : il retirerait une transaction de tous les calculs). Il dépose une proposition ; l'app (aal2) valide ou
-- retire l'import. Une suppression en cascade (ligne du bilan supprimée par le connecteur) est refusée de même. Sans client_id (app,
-- nuit, service, cascade de retirer_import ou de delete_me) : rien ne change.
create function public.transactions_historique_garde()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if nullif(auth.jwt()->>'client_id', '') is not null then
    if tg_op in ('UPDATE', 'DELETE') then
      if old.import_id is not null or old.cle_import is not null or old.doublon_de is not null then
        raise exception 'Un connecteur ne peut pas modifier ni supprimer un mouvement importé ou remplacé : valide ou retire l''import depuis Boussole.'
          using errcode = '42501';
      end if;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      if new.import_id is not null or new.cle_import is not null or new.doublon_de is not null then
        raise exception 'Un connecteur ne peut pas écrire un mouvement importé (import_id, cle_import, doublon_de) : dépose un import à valider dans Boussole.'
          using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.transactions_historique_garde() from public, anon, authenticated;
create trigger transactions_historique_garde before insert or update or delete on public.transactions
  for each row execute function public.transactions_historique_garde();

alter table public.status add column historique_a_recalculer timestamptz;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. RLS, double authentification, droits (spec § 4.7 ; formes de 0033)
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.historique_comptes     enable row level security;
alter table public.historique_imports     enable row level security;
alter table public.historique_releves     enable row level security;
alter table public.historique_banque_mois enable row level security;
alter table public.photos_reconstituees   enable row level security;

-- propriétaire (permissives)
create policy "historique_comptes: select" on public.historique_comptes for select to authenticated using ((select auth.uid()) = user_id);
create policy "historique_comptes: insert" on public.historique_comptes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "historique_comptes: update" on public.historique_comptes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "historique_comptes: delete" on public.historique_comptes for delete to authenticated using ((select auth.uid()) = user_id);
create policy "historique_imports: select" on public.historique_imports for select to authenticated using ((select auth.uid()) = user_id);
create policy "historique_imports: insert" on public.historique_imports for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "historique_imports: update" on public.historique_imports for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "historique_imports: delete" on public.historique_imports for delete to authenticated using ((select auth.uid()) = user_id);
create policy "historique_releves: select" on public.historique_releves for select to authenticated using ((select auth.uid()) = user_id);
create policy "historique_releves: insert" on public.historique_releves for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "historique_releves: update" on public.historique_releves for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "historique_releves: delete" on public.historique_releves for delete to authenticated using ((select auth.uid()) = user_id);
create policy "historique_banque_mois: select" on public.historique_banque_mois for select to authenticated using ((select auth.uid()) = user_id);
create policy "historique_banque_mois: insert" on public.historique_banque_mois for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "historique_banque_mois: update" on public.historique_banque_mois for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "historique_banque_mois: delete" on public.historique_banque_mois for delete to authenticated using ((select auth.uid()) = user_id);
-- photos : lecture seule pour le propriétaire (aucune politique d'écriture, aucun droit d'écriture : le service écrit)
create policy "photos_reconstituees: select" on public.photos_reconstituees for select to authenticated using ((select auth.uid()) = user_id);

-- régime bancaire : lecture en aal2 ou par un connecteur autorisé, écriture en aal2 et jamais par un jeton OAuth, suppression de même
create policy "historique_comptes: aal2" on public.historique_comptes as restrictive for all to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "historique_imports: aal2" on public.historique_imports as restrictive for all to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "historique_releves: aal2" on public.historique_releves as restrictive for all to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "historique_banque_mois: aal2" on public.historique_banque_mois as restrictive for all to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "historique_comptes: suppression aal2" on public.historique_comptes as restrictive for delete to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "historique_imports: suppression aal2" on public.historique_imports as restrictive for delete to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "historique_releves: suppression aal2" on public.historique_releves as restrictive for delete to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);
create policy "historique_banque_mois: suppression aal2" on public.historique_banque_mois as restrictive for delete to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' and ((select auth.jwt())->>'client_id') is null);

-- régime « si facteur » (comme snapshots)
create policy "photos_reconstituees: aal2 si facteur" on public.photos_reconstituees as restrictive for all to authenticated
  using (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()))
  with check (((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise()));

-- droits : rien pour anon ; authenticated lit les cinq tables et écrit les quatre tables bancaires (appliquer_propositions et retirer_import
-- sont security invoker) ; photos_reconstituees en lecture seule ; service_role explicite (plus d'exposition automatique, 0033 § 8)
revoke all on table public.historique_comptes, public.historique_imports, public.historique_releves, public.historique_banque_mois,
  public.photos_reconstituees from public, anon, authenticated;
grant select, insert, update, delete on table public.historique_comptes, public.historique_imports, public.historique_releves,
  public.historique_banque_mois to authenticated;
grant select on table public.photos_reconstituees to authenticated;
grant all on table public.historique_comptes, public.historique_imports, public.historique_releves, public.historique_banque_mois,
  public.photos_reconstituees to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Propositions : cible historique (spec § 4.6)
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.propositions drop constraint if exists propositions_cible_check;
alter table public.propositions add constraint propositions_cible_check
  check (cible in ('profil', 'budget', 'position', 'bien', 'credit', 'objectif', 'risque', 'protection', 'config', 'evenement', 'variante', 'plan_fige', 'historique'));
-- création et suppression seulement ; ref obligatoire : l'identifiant (uuid) de l'import, fourni par le connecteur
alter table public.propositions add constraint propositions_historique
  check (cible <> 'historique' or (operation in ('creer', 'supprimer') and coalesce(ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)));
-- taille de apres : 20 000 octets, 400 000 pour un plan figé, 100 000 pour un import d'historique
alter table public.propositions drop constraint if exists propositions_apres_check;
alter table public.propositions add constraint propositions_apres_check
  check (apres is null or (jsonb_typeof(apres) = 'object'
    and octet_length(apres::text) <= case when cible = 'plan_fige' then 400000 when cible = 'historique' then 100000 else 20000 end));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. Écritures : garde, historique_appliquer (création), historique_retirer et retirer_import (suppression)
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Garde commune : une session aal2 de l'app, jamais un jeton OAuth. La RLS refuserait déjà (politiques restrictives), mais avec un
-- message technique ; celui-ci dit quoi faire.
create function public.historique_garde()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;
  if nullif(auth.jwt()->>'client_id', '') is not null then
    raise exception 'Un connecteur ne peut pas écrire ni retirer un historique : valide l''import depuis Boussole › Agent › À valider.' using errcode = '42501';
  end if;
  if coalesce(auth.jwt()->>'aal', '') <> 'aal2' then
    raise exception 'Double authentification requise : valide ton code à 6 chiffres avant d''importer ou de retirer un historique.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.historique_garde() from public, anon;
grant execute on function public.historique_garde() to authenticated, service_role;

-- Création d'un import (spec § 4.6, étapes 1 à 6) : tout ou rien. Rend les compteurs de ce qui a été fait.
create function public.historique_appliquer(p_ref text, p_apres jsonb, p_source text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_auj     date := (now() at time zone 'Europe/Paris')::date;
  v_cour    date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  v_key     text;
  v_f       jsonb;
  v_g       jsonb;
  v_type    text;
  v_emp     text;
  v_etab    text;
  v_libre   text;
  v_fichier jsonb;
  v_du      date;
  v_au      date;
  v_envl    text;
  v_resume  jsonb;
  v_avert   jsonb;
  v_src     text;
  v_arr     jsonb;
  v_n       int;
  v_dej     timestamptz;
  v_nom     text;
  -- compte (relevés)
  v_c       jsonb;
  v_cpt     public.historique_comptes;
  v_cid     uuid;
  v_bc      bigint;
  v_pid     uuid;
  v_cle     text;
  v_lib     text;
  v_ctype   text;
  v_tit     text;
  v_cpt_id  uuid;
  -- relevés
  v_m       jsonb;
  v_mt      text;
  v_md      date;
  v_vus     date[] := '{}';
  v_complet boolean;
  v_ct      jsonb;
  v_te      numeric;
  v_ts      numeric;
  v_sd      numeric;
  v_sf      numeric;
  v_nb      int;
  v_cats    jsonb;
  v_l       jsonb;
  v_cat     text;
  v_sous    text;
  v_ent     numeric;
  v_sor     numeric;
  v_cnt     int;
  v_se      numeric;
  v_ss      numeric;
  v_sn      int;
  v_vcat    text[];
  v_mois    int := 0;
  v_remp    int := 0;
  -- mouvements
  v_map     jsonb := '{}'::jsonb;
  v_creees  uuid[] := '{}';
  v_pids    uuid[] := '{}';
  v_isin    text;
  v_own     text;
  v_envp    text;
  v_types   text[];
  v_cles    text[] := '{}';
  v_dt      date;
  v_t       text;
  v_qty     numeric;
  v_prix    numeric;
  v_mont    numeric;
  v_frais   numeric;
  v_est     boolean;
  v_note    text;
  v_env2    text;
  v_calc    numeric;
  v_k       int;
  v_ins     int := 0;
  v_ign     int := 0;
  v_dbl     int := 0;
  v_neuf    uuid;
  v_run     numeric;
  r         record;
begin
  perform public.historique_garde();
  -- un import ou un retrait à la fois par utilisateur (jusqu'à la fin de la transaction) : limites (40 comptes, 300 imports, 240 mois,
  -- 50 000 mouvements) et contrôle « quantité jamais négative » valent aussi pour deux validations simultanées
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('historique:' || v_uid::text, 0));
  if p_apres is null or jsonb_typeof(p_apres) <> 'object' then
    raise exception 'import : objet attendu';
  end if;
  begin
    v_id := p_ref::uuid;
  exception when others then
    raise exception 'import : identifiant invalide (uuid attendu)';
  end;
  select k into v_key from jsonb_object_keys(p_apres) k
   where k not in ('type', 'empreinte', 'fichier', 'etablissement', 'etablissement_libre', 'compte', 'enveloppe', 'periode', 'donnees',
                   'lignes_a_creer', 'doublons', 'resume', 'avertissements') limit 1;
  if v_key is not null then
    raise exception 'import : champ « % » inconnu (type, empreinte, fichier, etablissement, etablissement_libre, compte, enveloppe, periode, donnees, lignes_a_creer, doublons, resume, avertissements)', v_key;
  end if;

  -- 1. ce que le connecteur a vérifié, revérifié ici : type, empreinte, établissement, fichier, période, textes
  if jsonb_typeof(p_apres->'type') is distinct from 'string' or (p_apres->>'type') not in ('releves', 'ordres', 'versements') then
    raise exception 'import : type invalide (releves, ordres ou versements attendu)';
  end if;
  v_type := p_apres->>'type';
  if jsonb_typeof(p_apres->'empreinte') is distinct from 'string' or (p_apres->>'empreinte') !~ '^[0-9a-f]{64}$' then
    raise exception 'import : empreinte invalide (SHA-256 en hexadécimal, 64 caractères)';
  end if;
  v_emp := p_apres->>'empreinte';
  if jsonb_typeof(p_apres->'etablissement') is distinct from 'string' or (p_apres->>'etablissement') not in ('lcl', 'boursobank', 'revolut', 'n26', 'linxea', 'autre') then
    raise exception 'import : établissement invalide (lcl, boursobank, revolut, n26, linxea ou autre)';
  end if;
  v_etab := p_apres->>'etablissement';
  v_libre := public.historique_texte(p_apres->'etablissement_libre', 'etablissement_libre', 40, false, 6);
  if v_libre is not null and v_etab <> 'autre' then
    raise exception 'etablissement_libre : seulement pour l''établissement « autre »';
  end if;

  v_f := p_apres->'fichier';
  if jsonb_typeof(v_f) is distinct from 'object' then raise exception 'fichier : objet attendu'; end if;
  select k into v_key from jsonb_object_keys(v_f) k where k not in ('nom', 'format', 'lignes', 'octets', 'periode', 'sha256') limit 1;
  if v_key is not null then raise exception 'fichier : champ « % » inconnu (nom, format, lignes, octets, periode, sha256)', v_key; end if;
  if jsonb_typeof(v_f->'format') is distinct from 'string' or (v_f->>'format') not in ('csv', 'pdf', 'ofx', 'qif', 'xlsx', 'autre') then
    raise exception 'fichier : format invalide (csv, pdf, ofx, qif, xlsx ou autre)';
  end if;
  v_fichier := jsonb_build_object('format', v_f->>'format');
  if public.foyer_present(v_f->'nom') then
    v_fichier := v_fichier || jsonb_build_object('nom', public.historique_texte(v_f->'nom', 'fichier.nom', 80, false, 8));
  end if;
  if public.foyer_present(v_f->'lignes') then
    v_fichier := v_fichier || jsonb_build_object('lignes', public.historique_nombre(v_f->'lignes', 'fichier.lignes', 0, 1000000, false));
  end if;
  if public.foyer_present(v_f->'octets') then
    v_fichier := v_fichier || jsonb_build_object('octets', public.historique_nombre(v_f->'octets', 'fichier.octets', 0, 1000000000, false));
  end if;
  if public.foyer_present(v_f->'sha256') then
    if jsonb_typeof(v_f->'sha256') <> 'string' or (v_f->>'sha256') !~ '^[0-9a-f]{64}$' then
      raise exception 'fichier.sha256 : SHA-256 en hexadécimal (64 caractères) attendu';
    end if;
    v_fichier := v_fichier || jsonb_build_object('sha256', v_f->>'sha256');
  end if;
  if public.foyer_present(v_f->'periode') then
    v_g := v_f->'periode';
    if jsonb_typeof(v_g) <> 'object' or public.foyer_date(v_g->'du') is null or public.foyer_date(v_g->'au') is null then
      raise exception 'fichier.periode : { du, au } attendu (AAAA-MM-JJ)';
    end if;
    v_fichier := v_fichier || jsonb_build_object('periode', jsonb_build_object('du', v_g->>'du', 'au', v_g->>'au'));
  end if;

  v_f := p_apres->'periode';
  if jsonb_typeof(v_f) is distinct from 'object' then raise exception 'periode : objet { du, au } attendu'; end if;
  select k into v_key from jsonb_object_keys(v_f) k where k not in ('du', 'au') limit 1;
  if v_key is not null then raise exception 'periode : champ « % » inconnu (du, au)', v_key; end if;
  v_du := public.foyer_date(v_f->'du');
  v_au := public.foyer_date(v_f->'au');
  if v_du is null or v_au is null then raise exception 'periode : dates du et au attendues (AAAA-MM-JJ)'; end if;
  if v_du > v_au then raise exception 'periode : la date de début est postérieure à celle de fin'; end if;
  if v_du < date '1990-01-01' or v_au > v_auj then raise exception 'periode : du 1990-01-01 à aujourd''hui'; end if;

  v_src := public.historique_texte(to_jsonb(left(coalesce(p_source, ''), 200)), 'source', 200, true, 8);
  v_resume := coalesce(p_apres->'resume', '{}'::jsonb);
  if jsonb_typeof(v_resume) <> 'object' then raise exception 'resume : objet attendu'; end if;
  v_avert := coalesce(p_apres->'avertissements', '[]'::jsonb);
  if jsonb_typeof(v_avert) <> 'array' or jsonb_array_length(v_avert) > 50 then
    raise exception 'avertissements : tableau de 50 éléments au plus attendu';
  end if;
  if public.historique_sensible(v_resume::text, false) or public.historique_sensible(v_avert::text, false) then
    raise exception 'resume : contenu sensible refusé (numéro de compte ou de carte, mot de passe)';
  end if;

  v_g := p_apres->'donnees';
  if jsonb_typeof(v_g) is distinct from 'object' then raise exception 'donnees : objet attendu'; end if;
  select k into v_key from jsonb_object_keys(v_g) k
   where k <> case when v_type = 'releves' then 'mois' else 'mouvements' end limit 1;
  if v_key is not null then
    raise exception 'donnees : champ « % » inconnu (%)', v_key, case when v_type = 'releves' then 'mois' else 'mouvements' end;
  end if;

  -- limites par utilisateur et idempotence (spec § 5.3 et § 5.4)
  select count(*) into v_n from public.historique_imports where user_id = v_uid;
  if v_n >= 300 then
    raise exception 'Limite atteinte : 300 imports au plus. Retire un import avant d''en ajouter un.' using errcode = '54000';
  end if;
  select i.importe_le into v_dej from public.historique_imports i where i.user_id = v_uid and i.empreinte = v_emp;
  if found then
    raise exception 'Ce contenu a déjà été importé le %.', to_char(v_dej at time zone 'Europe/Paris', 'DD/MM/YYYY');
  end if;
  if exists (select 1 from public.historique_imports i where i.id = v_id) then
    raise exception 'Cet import existe déjà (même identifiant).';
  end if;

  -- 2. le compte (relevés) ou l'enveloppe (ordres, versements)
  if v_type = 'releves' then
    if p_apres ? 'enveloppe' then raise exception 'import de relevés : enveloppe non attendue (compte attendu)'; end if;
    v_c := p_apres->'compte';
    if jsonb_typeof(v_c) is distinct from 'object' then raise exception 'compte : objet attendu'; end if;
    select k into v_key from jsonb_object_keys(v_c) k
     where k not in ('id', 'libelle', 'type', 'titulaire', 'cle', 'banque_compte_id', 'position_id') limit 1;
    if v_key is not null then raise exception 'compte : champ « % » inconnu (id, libelle, type, titulaire, cle, banque_compte_id, position_id)', v_key; end if;
    if public.foyer_present(v_c->'banque_compte_id') then
      v_bc := public.historique_nombre(v_c->'banque_compte_id', 'compte.banque_compte_id', 1, 9007199254740991)::bigint;
      if v_bc::numeric <> (v_c->>'banque_compte_id')::numeric then raise exception 'compte.banque_compte_id : entier attendu'; end if;
      if not exists (select 1 from public.banque_comptes b where b.user_id = v_uid and b.id = v_bc) then
        raise exception 'compte.banque_compte_id : compte synchronisé introuvable';
      end if;
    end if;
    if public.foyer_present(v_c->'position_id') then
      begin
        v_pid := (v_c->>'position_id')::uuid;
      exception when others then
        raise exception 'compte.position_id : identifiant invalide (uuid attendu)';
      end;
      if not exists (select 1 from public.positions p where p.id = v_pid and p.user_id = v_uid) then
        raise exception 'compte.position_id : ligne introuvable';
      end if;
    end if;
    if public.foyer_present(v_c->'id') then
      if v_c ?| array['libelle', 'type', 'titulaire', 'cle'] then
        raise exception 'compte : avec un identifiant, seuls banque_compte_id et position_id peuvent suivre';
      end if;
      begin
        v_cid := (v_c->>'id')::uuid;
      exception when others then
        raise exception 'compte.id : identifiant invalide (uuid attendu)';
      end;
      select * into v_cpt from public.historique_comptes c where c.id = v_cid and c.user_id = v_uid for update;
      if not found then raise exception 'compte « % » introuvable', v_cid; end if;
      if v_cpt.etablissement <> v_etab then
        raise exception 'etablissement : ce compte est chez « % »', v_cpt.etablissement;
      end if;
    else
      v_lib := public.historique_texte(v_c->'libelle', 'compte.libelle', 40, true, 6);
      if char_length(v_lib) < 2 then raise exception 'compte.libelle : 2 caractères au moins'; end if;
      if jsonb_typeof(v_c->'type') is distinct from 'string' or (v_c->>'type') not in ('courant', 'joint', 'livret', 'carte_differe', 'autre') then
        raise exception 'compte.type invalide (courant, joint, livret, carte_differe ou autre)';
      end if;
      v_ctype := v_c->>'type';
      if jsonb_typeof(v_c->'titulaire') is distinct from 'string' or (v_c->>'titulaire') not in ('p1', 'p2', 'commun') then
        raise exception 'compte.titulaire invalide (p1, p2 ou commun)';
      end if;
      v_tit := v_c->>'titulaire';
      v_cle := public.historique_texte(v_c->'cle', 'compte.cle', 200, true, 6);
      select * into v_cpt from public.historique_comptes c where c.user_id = v_uid and c.cle = v_cle for update;
      if not found then
        select count(*) into v_n from public.historique_comptes where user_id = v_uid;
        if v_n >= 40 then
          raise exception 'Limite atteinte : 40 comptes au plus. Retire un compte avant d''en ajouter un.' using errcode = '54000';
        end if;
        insert into public.historique_comptes (user_id, libelle, etablissement, etablissement_libre, type, titulaire, banque_compte_id, position_id, cle)
        values (v_uid, v_lib, v_etab, v_libre, v_ctype, v_tit, v_bc, v_pid, v_cle)
        returning * into v_cpt;
      elsif v_cpt.etablissement <> v_etab then
        raise exception 'etablissement : ce compte est chez « % »', v_cpt.etablissement;
      end if;
    end if;
    -- rattachements fournis (accord de l'utilisateur donné par la validation de la proposition)
    update public.historique_comptes
       set maj_le = now(), banque_compte_id = coalesce(v_bc, banque_compte_id), position_id = coalesce(v_pid, position_id)
     where id = v_cpt.id and user_id = v_uid;
    v_cpt_id := v_cpt.id;
    v_envl := null;
  else
    if p_apres ? 'compte' then raise exception 'import de mouvements : compte non attendu (enveloppe attendue)'; end if;
    v_envl := public.historique_texte(p_apres->'enveloppe', 'enveloppe', 100, true, 8);
    v_cpt_id := null;
  end if;

  insert into public.historique_imports (id, user_id, type, empreinte, fichier, etablissement, compte_id, enveloppe, periode_du, periode_au, source)
  values (v_id, v_uid, v_type, v_emp, v_fichier, v_etab, v_cpt_id, v_envl, v_du, v_au, v_src);

  -- 3a. relevés : remplacement par (compte, mois)
  if v_type = 'releves' then
    if p_apres ? 'lignes_a_creer' or p_apres ? 'doublons' then
      raise exception 'import de relevés : lignes_a_creer et doublons ne concernent que les ordres et les versements';
    end if;
    v_arr := v_g->'mois';
    if jsonb_typeof(v_arr) is distinct from 'array' or jsonb_array_length(v_arr) not between 1 and 60 then
      raise exception 'donnees.mois : 1 à 60 mois attendus';
    end if;
    for v_m in select e from jsonb_array_elements(v_arr) e loop
      if jsonb_typeof(v_m) <> 'object' then raise exception 'mois : objet attendu'; end if;
      select k into v_key from jsonb_object_keys(v_m) k where k not in ('mois', 'complet', 'controle', 'categories') limit 1;
      if v_key is not null then raise exception 'mois : champ « % » inconnu (mois, complet, controle, categories)', v_key; end if;
      v_mt := case when jsonb_typeof(v_m->'mois') = 'string' then v_m->>'mois' end;
      if v_mt is null or v_mt !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
        raise exception 'mois « % » invalide (AAAA-MM attendu)', coalesce(v_mt, '');
      end if;
      v_md := (v_mt || '-01')::date;
      if v_md < date '2000-01-01' or v_md > v_cour then
        raise exception 'mois % : de 2000-01 au mois en cours seulement', v_mt;
      end if;
      if v_md = any(v_vus) then raise exception 'mois % en double dans l''import', v_mt; end if;
      v_vus := v_vus || v_md;
      if jsonb_typeof(v_m->'complet') is distinct from 'boolean' then raise exception 'mois % : complet (vrai ou faux) attendu', v_mt; end if;
      v_complet := (v_m->>'complet')::boolean;
      if v_md = v_cour and v_complet then raise exception 'mois % : le mois en cours ne peut pas être complet', v_mt; end if;

      v_ct := v_m->'controle';
      if jsonb_typeof(v_ct) is distinct from 'object' then raise exception 'mois % : controle (objet) attendu', v_mt; end if;
      select k into v_key from jsonb_object_keys(v_ct) k where k not in ('total_entrees', 'total_sorties', 'solde_debut', 'solde_fin', 'nombre') limit 1;
      if v_key is not null then raise exception 'mois % : controle : champ « % » inconnu (total_entrees, total_sorties, solde_debut, solde_fin, nombre)', v_mt, v_key; end if;
      v_te := public.historique_nombre(v_ct->'total_entrees', 'mois ' || v_mt || ' : total_entrees', 0, 10000000);
      v_ts := public.historique_nombre(v_ct->'total_sorties', 'mois ' || v_mt || ' : total_sorties', 0, 10000000);
      v_sd := public.historique_nombre(v_ct->'solde_debut', 'mois ' || v_mt || ' : solde_debut', -10000000, 10000000, false);
      v_sf := public.historique_nombre(v_ct->'solde_fin', 'mois ' || v_mt || ' : solde_fin', -10000000, 10000000, false);
      v_nb := public.historique_nombre(v_ct->'nombre', 'mois ' || v_mt || ' : nombre', 0, 5000, false);
      if v_nb is not null and v_nb <> trunc(v_nb) then raise exception 'mois % : nombre : entier attendu', v_mt; end if;
      if v_sd is not null and v_sf is not null and abs(v_sf - (v_sd + v_te - v_ts)) > 1 then
        raise exception 'mois % : le solde de fin (%) ne correspond pas au solde de début (%) plus les entrées (%) moins les sorties (%), à 1 € près', v_mt, v_sf, v_sd, v_te, v_ts;
      end if;

      v_cats := v_m->'categories';
      if jsonb_typeof(v_cats) is distinct from 'array' or jsonb_array_length(v_cats) > 30 then
        raise exception 'mois % : categories : tableau de 30 lignes au plus attendu', v_mt;
      end if;

      delete from public.historique_releves where user_id = v_uid and compte_id = v_cpt_id and mois = v_md;
      if found then v_remp := v_remp + 1; end if;
      insert into public.historique_releves (user_id, compte_id, mois, complet, solde_debut, solde_fin, total_entrees, total_sorties, nombre, import_id)
      values (v_uid, v_cpt_id, v_md, v_complet, v_sd, v_sf, v_te, v_ts, coalesce(v_nb, 0)::int, v_id);

      v_se := 0; v_ss := 0; v_sn := 0; v_vcat := '{}';
      for v_l in select e from jsonb_array_elements(v_cats) e loop
        if jsonb_typeof(v_l) <> 'object' then raise exception 'mois % : ligne de catégorie : objet attendu', v_mt; end if;
        select k into v_key from jsonb_object_keys(v_l) k where k not in ('categorie', 'sous_categorie', 'entrees', 'sorties', 'nombre') limit 1;
        if v_key is not null then raise exception 'mois % : ligne de catégorie : champ « % » inconnu (categorie, sous_categorie, entrees, sorties, nombre)', v_mt, v_key; end if;
        v_cat := case when jsonb_typeof(v_l->'categorie') = 'string' then v_l->>'categorie' end;
        if not public.categorie_budget_valide(v_cat) then
          raise exception 'mois % : catégorie « % » inconnue', v_mt, coalesce(v_cat, '');
        end if;
        v_sous := case when not public.foyer_present(v_l->'sous_categorie') then ''
                       when jsonb_typeof(v_l->'sous_categorie') = 'string' then v_l->>'sous_categorie' end;
        if not public.sous_categorie_budget_valide(v_cat, v_sous) then
          raise exception 'mois % : sous-catégorie « % » inconnue pour la catégorie « % »', v_mt, coalesce(v_sous, ''), v_cat;
        end if;
        if (v_cat || '|' || v_sous) = any(v_vcat) then
          raise exception 'mois % : plusieurs lignes pour « % / % » : additionne-les avant d''importer', v_mt, v_cat, v_sous;
        end if;
        v_vcat := v_vcat || (v_cat || '|' || v_sous);
        v_ent := public.historique_nombre(v_l->'entrees', 'mois ' || v_mt || ' : entrees', 0, 10000000);
        v_sor := public.historique_nombre(v_l->'sorties', 'mois ' || v_mt || ' : sorties', 0, 10000000);
        v_cnt := coalesce(public.historique_nombre(v_l->'nombre', 'mois ' || v_mt || ' : nombre', 0, 5000, false), 0)::int;
        v_se := v_se + v_ent; v_ss := v_ss + v_sor; v_sn := v_sn + v_cnt;
        insert into public.historique_banque_mois (user_id, compte_id, mois, categorie, sous_categorie, entrees, sorties, nombre)
        values (v_uid, v_cpt_id, v_md, v_cat, v_sous, v_ent, v_sor, v_cnt);
      end loop;
      if abs(v_se - v_te) > 1 then
        raise exception 'mois % : les catégories totalisent % € d''entrées, le contrôle en annonce % € (écart de plus de 1 €)', v_mt, v_se, v_te;
      end if;
      if abs(v_ss - v_ts) > 1 then
        raise exception 'mois % : les catégories totalisent % € de sorties, le contrôle en annonce % € (écart de plus de 1 €)', v_mt, v_ss, v_ts;
      end if;
      if v_nb is null then
        if v_sn > 5000 then raise exception 'mois % : plus de 5 000 opérations', v_mt; end if;
        update public.historique_releves set nombre = v_sn where user_id = v_uid and compte_id = v_cpt_id and mois = v_md;
      end if;
      v_mois := v_mois + 1;
    end loop;
    select count(*) into v_n from public.historique_releves where user_id = v_uid and compte_id = v_cpt_id;
    if v_n > 240 then
      raise exception 'Limite atteinte : 240 mois au plus par compte (20 ans).' using errcode = '54000';
    end if;

  -- 3b. mouvements de placement : lignes à créer (étape 4), insertion sans doublon de clé (étape 3)
  else
    v_arr := v_g->'mouvements';
    if jsonb_typeof(v_arr) is distinct from 'array' or jsonb_array_length(v_arr) not between 1 and 600 then
      raise exception 'donnees.mouvements : 1 à 600 mouvements attendus';
    end if;
    v_f := coalesce(p_apres->'lignes_a_creer', '[]'::jsonb);
    if jsonb_typeof(v_f) <> 'array' or jsonb_array_length(v_f) > 50 then
      raise exception 'lignes_a_creer : tableau de 50 lignes au plus attendu';
    end if;
    for v_l in select e from jsonb_array_elements(v_f) e loop
      if jsonb_typeof(v_l) <> 'object' then raise exception 'lignes_a_creer : objet attendu'; end if;
      select k into v_key from jsonb_object_keys(v_l) k where k not in ('isin', 'name', 'envelope', 'owner') limit 1;
      if v_key is not null then raise exception 'lignes_a_creer : champ « % » inconnu (isin, name, envelope, owner)', v_key; end if;
      v_isin := case when jsonb_typeof(v_l->'isin') = 'string' then upper(replace(v_l->>'isin', ' ', '')) end;
      if not public.historique_isin_valide(v_isin) then
        raise exception 'lignes_a_creer : ISIN « % » invalide (format ou clé de contrôle)', coalesce(v_isin, '');
      end if;
      -- un symbole X- doit exister (spec § 5.1) : l'import n'en invente pas dans la table commune des instruments
      if v_isin like 'X-%' and not exists (select 1 from public.instruments i where i.isin = v_isin) then
        raise exception 'lignes_a_creer : symbole « % » inconnu (seuls les symboles X- existants sont admis)', v_isin;
      end if;
      if v_map ? v_isin then raise exception 'lignes_a_creer : ISIN % en double', v_isin; end if;
      v_nom := public.historique_texte(v_l->'name', 'lignes_a_creer.name', 60, true, 8);
      v_envp := public.historique_texte(v_l->'envelope', 'lignes_a_creer.envelope', 100, true, 8);
      v_own := case when jsonb_typeof(v_l->'owner') = 'string' then v_l->>'owner' end;
      if v_own is null or v_own not in ('p1', 'p2') then raise exception 'lignes_a_creer : owner invalide (p1 ou p2)'; end if;
      select p.id into v_pid from public.positions p
       where p.user_id = v_uid and p.isin = v_isin and p.envelope = v_envp and p.owner = v_own order by p.created_at, p.id limit 1;
      if v_pid is null then
        perform public.request_instrument(v_isin, v_nom, null);
        insert into public.positions (user_id, name, envelope, owner, bloc, mode, isin, qty, status)
        values (v_uid, v_nom, v_envp, v_own, '', 'market', v_isin, 0, 'clôturé')
        returning id into v_pid;
        v_creees := v_creees || v_pid;
      end if;
      v_map := v_map || jsonb_build_object(v_isin, v_pid);
    end loop;

    v_types := case v_type when 'ordres' then array['achat', 'vente', 'releve']
      else array['versement', 'retrait', 'rachat', 'arbitrage_entree', 'arbitrage_sortie', 'dividende', 'interets', 'frais', 'releve'] end;
    for v_m in select e from jsonb_array_elements(v_arr) e loop
      if jsonb_typeof(v_m) <> 'object' then raise exception 'mouvement : objet attendu'; end if;
      select k into v_key from jsonb_object_keys(v_m) k
       where k not in ('cle_import', 'date', 'type', 'position_id', 'isin', 'enveloppe', 'qty', 'price', 'amount', 'frais', 'estime', 'note', 'devise') limit 1;
      if v_key is not null then
        raise exception 'mouvement : champ « % » inconnu (cle_import, date, type, position_id, isin, enveloppe, qty, price, amount, frais, estime, note, devise)', v_key;
      end if;
      v_cle := case when jsonb_typeof(v_m->'cle_import') = 'string' then v_m->>'cle_import' end;
      if v_cle is null or v_cle !~ '^[0-9a-f]{32}$' then raise exception 'mouvement : cle_import invalide (32 caractères hexadécimaux attendus)'; end if;
      if v_cle = any(v_cles) then raise exception 'mouvement : cle_import % en double dans l''import', v_cle; end if;
      v_cles := v_cles || v_cle;
      v_dt := public.foyer_date(v_m->'date');
      if v_dt is null then raise exception 'mouvement % : date invalide (AAAA-MM-JJ attendu)', v_cle; end if;
      if v_dt < date '1990-01-01' or v_dt > v_auj then
        raise exception 'mouvement du % : date hors du 1990-01-01 à aujourd''hui', to_char(v_dt, 'DD/MM/YYYY');
      end if;
      v_t := case when jsonb_typeof(v_m->'type') = 'string' then v_m->>'type' end;
      if v_t is null or not (v_t = any(v_types)) then
        raise exception 'mouvement du % : type « % » non admis pour cet import (%)', to_char(v_dt, 'DD/MM/YYYY'), coalesce(v_t, ''), array_to_string(v_types, ', ');
      end if;
      v_qty   := public.historique_nombre(v_m->'qty', 'mouvement du ' || to_char(v_dt, 'DD/MM/YYYY') || ' : qty', 0, 1000000000, false);
      v_prix  := public.historique_nombre(v_m->'price', 'mouvement du ' || to_char(v_dt, 'DD/MM/YYYY') || ' : price', 0, 1000000000, false);
      v_mont  := public.historique_nombre(v_m->'amount', 'mouvement du ' || to_char(v_dt, 'DD/MM/YYYY') || ' : amount', 0, 1000000000, false);
      v_frais := public.historique_nombre(v_m->'frais', 'mouvement du ' || to_char(v_dt, 'DD/MM/YYYY') || ' : frais', 0, 10000000, false);
      if public.foyer_present(v_m->'devise') and (jsonb_typeof(v_m->'devise') <> 'string' or upper(v_m->>'devise') <> 'EUR') then
        raise exception 'mouvement du % : seul l''euro est accepté pour l''instant (convertis au taux du jour et dis-le)', to_char(v_dt, 'DD/MM/YYYY');
      end if;
      if public.foyer_present(v_m->'estime') and jsonb_typeof(v_m->'estime') <> 'boolean' then
        raise exception 'mouvement du % : estime (vrai ou faux) attendu', to_char(v_dt, 'DD/MM/YYYY');
      end if;
      v_est := coalesce((v_m->>'estime')::boolean, false);
      v_note := public.historique_texte(v_m->'note', 'mouvement du ' || to_char(v_dt, 'DD/MM/YYYY') || ' : note', 200, false, 8);

      -- la ligne : position_id du bilan, ou ISIN d'une ligne créée par cet import, ou aucune (mouvement d'enveloppe)
      v_pid := null;
      if public.foyer_present(v_m->'position_id') then
        begin
          v_pid := (v_m->>'position_id')::uuid;
        exception when others then
          raise exception 'mouvement du % : position_id invalide (uuid attendu)', to_char(v_dt, 'DD/MM/YYYY');
        end;
        if not (v_pid = any(v_pids)) then
          if not exists (select 1 from public.positions p where p.id = v_pid and p.user_id = v_uid) then
            raise exception 'mouvement du % : ligne introuvable', to_char(v_dt, 'DD/MM/YYYY');
          end if;
          v_pids := v_pids || v_pid;
        end if;
      elsif public.foyer_present(v_m->'isin') then
        v_isin := case when jsonb_typeof(v_m->'isin') = 'string' then upper(replace(v_m->>'isin', ' ', '')) end;
        if v_isin is null or not (v_map ? v_isin) then
          raise exception 'mouvement du % : ISIN % sans ligne (donne position_id, ou liste la ligne dans lignes_a_creer)', to_char(v_dt, 'DD/MM/YYYY'), coalesce(v_isin, '');
        end if;
        v_pid := (v_map->>v_isin)::uuid;
      end if;
      v_env2 := null;
      if v_pid is null then
        v_env2 := coalesce(public.historique_texte(v_m->'enveloppe', 'mouvement du ' || to_char(v_dt, 'DD/MM/YYYY') || ' : enveloppe', 100, false, 8), v_envl);
      end if;

      if v_t in ('achat', 'vente') then
        if v_pid is null then raise exception 'ordre du % : une ligne est attendue (position_id, ou ISIN d''une ligne à créer)', to_char(v_dt, 'DD/MM/YYYY'); end if;
        if v_qty is null or v_qty <= 0 then raise exception 'ordre du % : quantité supérieure à 0 attendue', to_char(v_dt, 'DD/MM/YYYY'); end if;
        if v_prix is null or v_prix <= 0 then raise exception 'ordre du % : prix supérieur à 0 attendu', to_char(v_dt, 'DD/MM/YYYY'); end if;
        v_calc := v_qty * v_prix;
        if v_mont is null then
          v_mont := round(v_calc, 2);
        elsif abs(v_mont - v_calc) > greatest(1, 0.005 * v_calc) then
          raise exception 'ordre du % : le montant (%) ne correspond pas à quantité × prix (%), tolérance max(1 €; 0,5 %%)', to_char(v_dt, 'DD/MM/YYYY'), v_mont, trim_scale(round(v_calc, 2));
        end if;
      elsif v_t = 'releve' then
        if v_qty is null and v_mont is null then
          raise exception 'relevé du % : une quantité ou une valeur est attendue', to_char(v_dt, 'DD/MM/YYYY');
        end if;
      else
        if v_mont is null or v_mont <= 0 then raise exception 'mouvement du % (%) : montant supérieur à 0 attendu', to_char(v_dt, 'DD/MM/YYYY'), v_t; end if;
        if v_qty is not null and v_qty <= 0 then raise exception 'mouvement du % (%) : quantité supérieure à 0 attendue', to_char(v_dt, 'DD/MM/YYYY'), v_t; end if;
      end if;

      insert into public.transactions (user_id, position_id, date, type, qty, price, amount, note, source, import_id, cle_import, enveloppe, frais, estime)
      values (v_uid, v_pid, v_dt, v_t, v_qty, v_prix, v_mont, v_note, 'import', v_id, v_cle, v_env2, v_frais, v_est)
      on conflict (user_id, cle_import) where cle_import is not null do nothing;
      get diagnostics v_k = row_count;
      v_ins := v_ins + v_k;
      v_ign := v_ign + (1 - v_k);
    end loop;
    select count(*) into v_n from public.transactions where user_id = v_uid and import_id is not null;
    if v_n > 50000 then
      raise exception 'Limite atteinte : 50 000 transactions importées au plus.' using errcode = '54000';
    end if;

    -- 5. doublons : saisies et versements programmés de la nuit remplacés par le mouvement réel (doublon_de)
    v_f := coalesce(p_apres->'doublons', '[]'::jsonb);
    if jsonb_typeof(v_f) <> 'array' or jsonb_array_length(v_f) > 600 then
      raise exception 'doublons : tableau de 600 éléments au plus attendu';
    end if;
    for v_l in select e from jsonb_array_elements(v_f) e loop
      if jsonb_typeof(v_l) <> 'object' then raise exception 'doublons : objet attendu'; end if;
      select k into v_key from jsonb_object_keys(v_l) k where k not in ('transaction_id', 'mouvement_cle') limit 1;
      if v_key is not null then raise exception 'doublons : champ « % » inconnu (transaction_id, mouvement_cle)', v_key; end if;
      begin
        v_cid := (v_l->>'transaction_id')::uuid;
      exception when others then
        raise exception 'doublons : transaction_id invalide (uuid attendu)';
      end;
      v_cle := case when jsonb_typeof(v_l->'mouvement_cle') = 'string' then v_l->>'mouvement_cle' end;
      select t.id into v_neuf from public.transactions t where t.user_id = v_uid and t.cle_import = v_cle;
      if v_neuf is null then raise exception 'doublons : mouvement « % » introuvable', coalesce(v_cle, ''); end if;
      update public.transactions set doublon_de = v_neuf
       where id = v_cid and user_id = v_uid and import_id is null and doublon_de is null and source in ('nightly', 'mcp', 'manuel');
      if not found then
        raise exception 'doublons : la transaction « % » n''est pas une saisie ou un versement programmé remplaçable', v_cid;
      end if;
      v_dbl := v_dbl + 1;
    end loop;

    -- contrôle bloquant restant : la quantité cumulée d'une ligne ne devient jamais négative (les relevés de titres et les
    -- quantités initiales, de type releve, ne font que relever la quantité) ; sur la base entière, doublons déjà écartés
    for v_pid in select distinct t.position_id from public.transactions t where t.import_id = v_id and t.position_id is not null loop
      v_run := 0;
      for r in
        select t.date, t.type, t.qty from public.transactions t
         where t.user_id = v_uid and t.position_id = v_pid and t.doublon_de is null
         order by t.date, (t.type = 'releve'), (t.type in ('vente', 'retrait', 'rachat', 'arbitrage_sortie', 'frais')), t.created_at, t.id
      loop
        if r.type = 'releve' then
          if r.qty is not null and r.qty > v_run then v_run := r.qty; end if;
        else
          v_run := v_run + case when r.type in ('achat', 'versement', 'programme', 'arbitrage_entree', 'dividende', 'interets') then coalesce(r.qty, 0)
                                when r.type in ('vente', 'retrait', 'rachat', 'arbitrage_sortie', 'frais') then -coalesce(r.qty, 0)
                                else 0 end;
          if v_run < -0.0001 then
            select p.name into v_nom from public.positions p where p.id = v_pid;
            raise exception 'quantité négative le % pour « % » : il manque des achats ou une quantité initiale (début de l''historique)', to_char(r.date, 'DD/MM/YYYY'), coalesce(v_nom, '?');
          end if;
        end if;
      end loop;
    end loop;
  end if;

  -- 6. trace de l'import et demande de recalcul des photos
  v_resume := v_resume || case when v_type = 'releves'
      then jsonb_build_object('mois_importes', v_mois, 'mois_remplaces', v_remp)
      else jsonb_build_object('mouvements_importes', v_ins, 'mouvements_ignores', v_ign, 'doublons_remplaces', v_dbl, 'lignes_creees', cardinality(v_creees)) end
    || case when jsonb_array_length(v_avert) > 0 then jsonb_build_object('avertissements', v_avert) else '{}'::jsonb end;
  if octet_length(v_resume::text) > 4000 then
    raise exception 'resume : 4 000 octets au plus';
  end if;
  update public.historique_imports set resume = v_resume, lignes_creees = v_creees where id = v_id and user_id = v_uid;
  insert into public.status (user_id, historique_a_recalculer) values (v_uid, now())
  on conflict (user_id) do update set historique_a_recalculer = excluded.historique_a_recalculer;

  return jsonb_build_object('import_id', v_id, 'type', v_type, 'mois', v_mois, 'mois_remplaces', v_remp,
    'mouvements', v_ins, 'ignores', v_ign, 'doublons', v_dbl, 'lignes_creees', to_jsonb(v_creees));
end;
$$;
revoke all on function public.historique_appliquer(text, jsonb, text) from public, anon;
grant execute on function public.historique_appliquer(text, jsonb, text) to authenticated, service_role;

-- Retrait d'un import (spec § 4.6 point 7) : cascade sur les mois et les mouvements (doublon_de revient à nul), puis les lignes
-- clôturées créées par l'import et restées sans aucune transaction.
create function public.historique_retirer(p_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_lignes uuid[];
  v_mouv   int;
  v_supp   int;
  v_ligne  uuid;
begin
  perform public.historique_garde();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('historique:' || v_uid::text, 0));
  select i.lignes_creees into v_lignes from public.historique_imports i where i.id = p_id and i.user_id = v_uid for update;
  if not found then
    raise exception 'import « % » introuvable', p_id;
  end if;
  select count(*) into v_mouv from public.transactions t where t.import_id = p_id and t.user_id = v_uid;
  delete from public.historique_imports where id = p_id and user_id = v_uid;
  delete from public.positions p
   where p.user_id = v_uid and p.id = any(v_lignes) and p.status = 'clôturé'
     and not exists (select 1 from public.transactions t where t.position_id = p.id);
  get diagnostics v_supp = row_count;
  -- une ligne créée par cet import mais portée encore par les mouvements d'un autre passe à l'import le plus récent qui la porte :
  -- le retirer à son tour la supprimera (sinon une ligne clôturée sans aucune transaction resterait au bilan)
  for v_ligne in select p.id from public.positions p where p.user_id = v_uid and p.id = any(v_lignes) loop
    update public.historique_imports i set lignes_creees = i.lignes_creees || v_ligne
     where i.id = (select t.import_id from public.transactions t join public.historique_imports h on h.id = t.import_id
                    where t.position_id = v_ligne and t.user_id = v_uid order by h.importe_le desc, h.id limit 1)
       and i.user_id = v_uid and not (v_ligne = any(i.lignes_creees)) and cardinality(i.lignes_creees) < 50;
  end loop;
  insert into public.status (user_id, historique_a_recalculer) values (v_uid, now())
  on conflict (user_id) do update set historique_a_recalculer = excluded.historique_a_recalculer;
  return jsonb_build_object('import_id', p_id, 'mouvements_retires', v_mouv, 'lignes_supprimees', v_supp);
end;
$$;
revoke all on function public.historique_retirer(uuid) from public, anon;
grant execute on function public.historique_retirer(uuid) to authenticated, service_role;

-- Écriture de contrôle de l'app (D5) : « Retirer cet import » dans Compte › Données. aal2 et jamais par un jeton OAuth.
create function public.retirer_import(p_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform public.historique_garde();
  return public.historique_retirer(p_id);
end;
$$;
revoke all on function public.retirer_import(uuid) from public, anon;
grant execute on function public.retirer_import(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. appliquer_propositions(ids, modifications) : 0032 (dernière définition) + cible historique
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Le diff avec 0032 se limite à : la déclaration de v_hist, le libellé « import d'historique » de v_quoi et la branche when 'historique'
-- (création : historique_appliquer ; suppression : historique_retirer). Tout le reste est recopié à l'identique.

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
  v_hist   jsonb;
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
    v_quoi := coalesce(v_quoi, case p.cible when 'evenement' then 'événement' when 'variante' then 'variante' when 'plan_fige' then 'plan figé' when 'historique' then 'import d''historique' end);
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
      /* ---------- historique (0034) : import de relevés, d'ordres ou de versements ; création et suppression seulement ---------- */
      when 'historique' then
        if p.operation = 'modifier' then raise exception 'historique : seules la création et la suppression sont possibles'; end if;
        -- non modifiable avant validation : la proposition est appliquée telle quelle (pour corriger, redépose-la)
        v := p.apres;
        if p.operation = 'supprimer' then
          v_hist := public.historique_retirer(p.ref::uuid);
        else
          v_hist := public.historique_appliquer(p.ref, v, p.source);
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

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. export_all() : 0033 + les cinq tables de l'historique
-- ---------------------------------------------------------------------------------------------------------------------------------
-- export_all : 0033 à l'identique (même clés, même ordre, security invoker : la RLS borne tout ; garde « pas de jeton OAuth » : le
-- connecteur ne peut pas exporter, promesse de Mon compte), plus les cinq tables de l'historique (les nouvelles colonnes de transactions
-- et de status sortent déjà par to_jsonb de la ligne).
create or replace function public.export_all()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if nullif(auth.jwt()->>'client_id', '') is not null then
    raise exception 'Un connecteur ne peut pas exporter tes données : fais-le depuis Boussole › Mon compte.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'exported_at',  now(),
    'profile',      (select to_jsonb(p) from public.profiles p where p.user_id = auth.uid()),
    'biens',        (select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at), '[]') from public.biens b where b.user_id = auth.uid()),
    'credits',      (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]') from public.credits c where c.user_id = auth.uid()),
    'positions',    (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from public.positions x where x.user_id = auth.uid()),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.date, t.created_at), '[]') from public.transactions t where t.user_id = auth.uid()),
    'snapshots',    (select coalesce(jsonb_agg(to_jsonb(s) order by s.date), '[]') from public.snapshots s where s.user_id = auth.uid()),
    'config',       (select coalesce(jsonb_agg(to_jsonb(k)), '[]') from public.config k where k.user_id = auth.uid()),
    'status',       (select coalesce(jsonb_agg(to_jsonb(st)), '[]') from public.status st where st.user_id = auth.uid()),
    'budget',       (select to_jsonb(bu) from public.budgets bu where bu.user_id = auth.uid()),
    'objectifs',    (select coalesce(jsonb_agg(to_jsonb(o) order by o.priorite, o.created_at), '[]') from public.objectifs o where o.user_id = auth.uid()),
    'propositions', (select coalesce(jsonb_agg(to_jsonb(pr) order by pr.cree_le), '[]') from public.propositions pr where pr.user_id = auth.uid()),
    'connexions_assistant', (select coalesce(jsonb_agg(to_jsonb(ca) order by ca.premier_le), '[]') from public.connexions_assistant ca where ca.user_id = auth.uid()),
    'memoire_agent', (select coalesce(jsonb_agg(to_jsonb(m) order by m.cree_le), '[]') from public.memoire_agent m where m.user_id = auth.uid()),
    'journal',      (select coalesce(jsonb_agg(to_jsonb(j) order by j.cree_le), '[]') from public.journal j where j.user_id = auth.uid()),
    'routines',     (select coalesce(jsonb_agg(to_jsonb(rt) order by rt.type), '[]') from public.routines rt where rt.user_id = auth.uid()),
    'fonctionnalites',   (select coalesce(jsonb_agg(to_jsonb(fo) order by fo.cle), '[]') from public.fonctionnalites fo where fo.user_id = auth.uid()),
    'banque_connexions', (select coalesce(jsonb_agg(to_jsonb(bc) order by bc.cree_le, bc.id), '[]') from public.banque_connexions bc where bc.user_id = auth.uid()),
    'banque_comptes',    (select coalesce(jsonb_agg(to_jsonb(bk) order by bk.connexion_id, bk.id), '[]') from public.banque_comptes bk where bk.user_id = auth.uid()),
    'banque_placements', (select coalesce(jsonb_agg(to_jsonb(bp) order by bp.compte_id, bp.id), '[]') from public.banque_placements bp where bp.user_id = auth.uid()),
    'banque_operations', (select coalesce(jsonb_agg(to_jsonb(bo) order by bo.date, bo.compte_id, bo.id), '[]') from public.banque_operations bo where bo.user_id = auth.uid()),
    'banque_mois',       (select coalesce(jsonb_agg(to_jsonb(bm) order by bm.mois, bm.categorie), '[]') from public.banque_mois bm where bm.user_id = auth.uid()),
    'foyer_evenements',  (select coalesce(jsonb_agg(to_jsonb(fe) order by fe.date, fe.created_at, fe.id), '[]') from public.foyer_evenements fe where fe.user_id = auth.uid()),
    'foyer_variantes',   (select coalesce(jsonb_agg(to_jsonb(fv) order by fv.created_at, fv.id), '[]') from public.foyer_variantes fv where fv.user_id = auth.uid()),
    'plans_figes',       (select coalesce(jsonb_agg(to_jsonb(pf) order by pf.cree_le, pf.id), '[]') from public.plans_figes pf where pf.user_id = auth.uid()),
    'connecteurs_autorises', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'client_id', g.client_id, 'client_nom', g.client_nom,
                                'accorde_le', g.accorde_le, 'expire_le', g.expire_le, 'lie_le', g.lie_le, 'dernier_usage', g.dernier_usage,
                                'revoque_le', g.revoque_le) order by g.accorde_le, g.id), '[]')
                              from public.connecteurs_autorises g where g.user_id = auth.uid()),
    'historique_comptes',     (select coalesce(jsonb_agg(to_jsonb(hc) order by hc.cree_le, hc.id), '[]') from public.historique_comptes hc where hc.user_id = auth.uid()),
    'historique_imports',     (select coalesce(jsonb_agg(to_jsonb(hi) order by hi.importe_le, hi.id), '[]') from public.historique_imports hi where hi.user_id = auth.uid()),
    'historique_releves',     (select coalesce(jsonb_agg(to_jsonb(hr) order by hr.compte_id, hr.mois), '[]') from public.historique_releves hr where hr.user_id = auth.uid()),
    'historique_banque_mois', (select coalesce(jsonb_agg(to_jsonb(hm) order by hm.compte_id, hm.mois, hm.categorie, hm.sous_categorie), '[]') from public.historique_banque_mois hm where hm.user_id = auth.uid()),
    'photos_reconstituees',   (select coalesce(jsonb_agg(to_jsonb(ph) order by ph.mois), '[]') from public.photos_reconstituees ph where ph.user_id = auth.uid())
  );
end;
$$;
revoke all on function public.export_all() from public, anon;
grant execute on function public.export_all() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. service_role : droits explicites sur les objets de cette migration (0033 § 8 : plus d'exposition automatique)
-- ---------------------------------------------------------------------------------------------------------------------------------
grant all on table public.historique_comptes, public.historique_imports, public.historique_releves, public.historique_banque_mois,
  public.photos_reconstituees to service_role;
grant execute on function public.categorie_budget_valide(text), public.sous_categorie_budget_valide(text, text), public.historique_isin_valide(text),
  public.historique_sensible(text, boolean), public.historique_texte(jsonb, text, int, boolean, int),
  public.historique_nombre(jsonb, text, numeric, numeric, boolean), public.historique_garde(),
  public.historique_appliquer(text, jsonb, text), public.historique_retirer(uuid), public.retirer_import(uuid), public.export_all() to service_role;
