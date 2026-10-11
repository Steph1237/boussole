-- Boussole : durcissement du journal des décisions (revue de CK2). 0013_journal.sql est en production : on la complète ici.
-- Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "journal_durcissement").
--   1. journal_historique : la provenance (source) est figée comme l'état et la date de création ; le plafond de l'historique
--      garde les 20 premières entrées ET les 180 dernières (au lieu des 200 dernières), pour qu'on ne puisse pas effacer les
--      premières corrections en multipliant les écritures.
--   2. Contenu sensible : les textes des options comparées (titre, pourquoi) sont contrôlés comme le titre, la synthèse et le
--      raisonnement (même fonction public.contenu_sensible, 0009).

-- ---------------------------------------------------------------------------
-- Textes des options : titre et pourquoi de chaque option, un par ligne (jamais la sérialisation JSON brute : ni clés, ni
-- booléens, ni guillemets dans le texte contrôlé). Le saut de ligne sépare les textes : contenu_sensible n'admet que des
-- espaces dans un numéro, deux textes voisins ne forment donc jamais un faux numéro de compte ou de carte.
-- Valeur non tableau ou option non objet : ignorée (texte vide). Immuable : utilisable dans une contrainte.
-- ---------------------------------------------------------------------------
create or replace function public.options_texte(p_options jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(concat_ws(E'\n', t.o ->> 'titre', t.o ->> 'pourquoi'), E'\n' order by t.i), '')
    from jsonb_array_elements(case when jsonb_typeof(p_options) = 'array' then p_options else '[]'::jsonb end) with ordinality as t(o, i)
   where jsonb_typeof(t.o) = 'object';
$$;

-- Même nom de contrainte : le front et le connecteur reconnaissent « journal_contenu_sensible » dans le message d'erreur.
alter table public.journal drop constraint journal_contenu_sensible;
alter table public.journal add constraint journal_contenu_sensible check (not (
  public.contenu_sensible(titre) or public.contenu_sensible(synthese) or public.contenu_sensible(raisonnement)
  or public.contenu_sensible(public.options_texte(options))));

-- ---------------------------------------------------------------------------
-- Historique (repart de 0013) : rien ne se réécrit en silence. Une fois l'entrée confirmée (statut ≠ a_relire, ou historique
-- déjà commencé), toute modification de type, titre, synthese, raisonnement, statut, date_decision, revue_le, options ou liens
-- ajoute { le, champ, avant, apres } (ou { le, champ: "raisonnement", ajout } pour une note ajoutée à la fin).
-- État figé, provenance (source) et date de création immuables ; historique repartant toujours de l'ancien ; maj_le à jour.
-- Plafond : 200 entrées, soit les 20 premières et les 180 dernières.
-- ---------------------------------------------------------------------------
create or replace function public.journal_historique()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_avant jsonb := to_jsonb(old);
  v_apres jsonb := to_jsonb(new);
  v_champ text;
  v_ancien text := coalesce(old.raisonnement, '');
  v_n int;
begin
  new.etat := old.etat;
  new.source := old.source;
  new.cree_le := old.cree_le;
  new.historique := old.historique;
  new.maj_le := now();
  if old.statut <> 'a_relire' or jsonb_array_length(old.historique) > 0 then
    foreach v_champ in array array['type','titre','synthese','raisonnement','statut','date_decision','revue_le','options','liens'] loop
      if v_apres -> v_champ is distinct from v_avant -> v_champ then
        if v_champ = 'raisonnement' and new.raisonnement is not null and starts_with(new.raisonnement, v_ancien) then
          new.historique := new.historique || jsonb_build_array(jsonb_build_object('le', now(), 'champ', 'raisonnement', 'ajout', substr(new.raisonnement, char_length(v_ancien) + 1)));
        else
          new.historique := new.historique || jsonb_build_array(jsonb_build_object('le', now(), 'champ', v_champ, 'avant', v_avant -> v_champ, 'apres', v_apres -> v_champ));
        end if;
      end if;
    end loop;
    -- Plafond : les 20 premières entrées et les 180 dernières.
    v_n := jsonb_array_length(new.historique);
    if v_n > 200 then
      select jsonb_agg(h.e order by h.i) into new.historique
        from jsonb_array_elements(new.historique) with ordinality as h(e, i)
       where h.i <= 20 or h.i > v_n - 180;
    end if;
  end if;
  return new;
end;
$$;
-- Le déclencheur journal_historique (0013) appelle déjà cette fonction : rien à recréer.
