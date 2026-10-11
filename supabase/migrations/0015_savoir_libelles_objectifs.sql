-- Boussole : libellés de navigation dans les fiches du savoir commun (CK3, Patrimoine › Budget et Patrimoine › Objectifs séparés).
-- Appliqué avec apply_migration (name = "savoir_libelles_objectifs"). Rejouable : la mise à jour ne porte que sur une fiche
-- qui contient encore l'ancienne mention, la version n'est donc incrémentée qu'une fois.
-- Ancien chemin → nouveau : Patrimoine › Budget et objectifs → Patrimoine › Objectifs (seule la fiche investissement-programme,
-- réécrite par 0012, le mentionne).

update public.savoir_fiches
   set contenu = replace(contenu, 'Dans Patrimoine › Budget et objectifs, Boussole calcule, pour chacun de vos objectifs,',
         'Dans Patrimoine › Objectifs, Boussole calcule, pour chacun de vos objectifs,'),
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'investissement-programme' and strpos(contenu, 'Patrimoine › Budget et objectifs') > 0;
