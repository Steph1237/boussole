-- Boussole : libellés de navigation dans les fiches du savoir commun (CK1, nouvelle navigation du cockpit).
-- Appliqué avec apply_migration (name = "savoir_libelles"). Rejouable : chaque mise à jour ne porte que sur une fiche
-- qui contient encore l'ancienne mention, la version n'est donc incrémentée qu'une fois.
-- Anciens chemins → nouveaux : l'onglet Ma position → Pilotage › Rang ; le Bilan → Patrimoine ; votre profil (page de
-- saisie) → Compte › Données ; vos actions recommandées → Aujourd'hui ; le plan de Boussole → Patrimoine › Budget et objectifs.

update public.savoir_fiches
   set contenu = replace(contenu, 'comparé au plafond HCSF dans l''onglet Ma position.', 'comparé au plafond HCSF dans Pilotage › Rang.'),
       version = version + 1, mis_a_jour_le = '2026-10-10'
 where slug = 'assurance-emprunteur' and strpos(contenu, 'l''onglet Ma position') > 0;

update public.savoir_fiches
   set contenu = replace(replace(contenu,
         'renseignée dans votre profil, le diagnostic indique', 'renseignée dans Compte › Données, le diagnostic indique'),
         'Dans la vue de liquidité du Bilan, l''assurance-vie', 'Dans la vue par liquidité de Patrimoine, l''assurance-vie'),
       version = version + 1, mis_a_jour_le = '2026-10-10'
 where slug = 'assurance-vie' and (strpos(contenu, 'renseignée dans votre profil') > 0 or strpos(contenu, 'du Bilan') > 0);

update public.savoir_fiches
   set contenu = replace(contenu, 'apparaissent dans vos actions recommandées.', 'apparaissent dans Aujourd''hui.'),
       version = version + 1, mis_a_jour_le = '2026-10-10'
 where slug = 'biais-comportementaux' and strpos(contenu, 'vos actions recommandées') > 0;

update public.savoir_fiches
   set contenu = replace(contenu, 'Dans le Bilan, Boussole calcule votre', 'Dans Patrimoine, Boussole calcule votre'),
       version = version + 1, mis_a_jour_le = '2026-10-10'
 where slug = 'epargne-de-precaution' and strpos(contenu, 'Dans le Bilan') > 0;

update public.savoir_fiches
   set contenu = replace(contenu, 'Le plan de Boussole calcule, pour chacun de vos objectifs,',
         'Dans Patrimoine › Budget et objectifs, Boussole calcule, pour chacun de vos objectifs,'),
       version = version + 1, mis_a_jour_le = '2026-10-10'
 where slug = 'investissement-programme' and strpos(contenu, 'Le plan de Boussole') > 0;

update public.savoir_fiches
   set contenu = replace(replace(contenu,
         'renseignée dans votre profil : en dessous', 'renseignée dans Compte › Données : en dessous'),
         'Dans la vue de liquidité du Bilan, le PER', 'Dans la vue par liquidité de Patrimoine, le PER'),
       version = version + 1, mis_a_jour_le = '2026-10-10'
 where slug = 'per' and (strpos(contenu, 'renseignée dans votre profil') > 0 or strpos(contenu, 'du Bilan') > 0);

update public.savoir_fiches
   set contenu = replace(contenu, 'Dans votre profil, Boussole vous demande', 'Dans Compte › Données, Boussole vous demande'),
       version = version + 1, mis_a_jour_le = '2026-10-10'
 where slug = 'prevoyance' and strpos(contenu, 'Dans votre profil, Boussole') > 0;

update public.savoir_fiches
   set contenu = replace(contenu, 'L''onglet Ma position calcule votre taux', 'Dans Pilotage › Rang, Boussole calcule votre taux'),
       version = version + 1, mis_a_jour_le = '2026-10-10'
 where slug = 'taux-endettement' and strpos(contenu, 'L''onglet Ma position') > 0;
