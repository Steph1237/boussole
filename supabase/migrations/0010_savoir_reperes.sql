-- Boussole : repères chiffrés et premières fiches du savoir commun (AG1). Valeurs vérifiées le 2026-10-10 sur les sources citées.
-- Appliqué avec apply_migration (name = "savoir_reperes"). Idempotent.
-- Note : service-public.fr redirige désormais vers service-public.gouv.fr (même contenu, mêmes identifiants de fiche).

insert into public.reperes (cle, libelle, valeur, unite, date_effet, source_titre, source_url, verifie_le) values
  ('livret_a_taux', 'Taux du Livret A', 1.7, '%', '2026-08-01', 'Ministère de l''Économie — communiqué du 15 juillet 2026 : taux de l''épargne réglementée au 1er août 2026', 'https://presse.economie.gouv.fr/?p=181486', '2026-10-10'),
  ('livret_a_plafond', 'Plafond du Livret A', 22950, '€', '2013-01-01', 'Service-public.fr — Livret A', 'https://www.service-public.fr/particuliers/vosdroits/F2365', '2026-10-10'),
  ('ldds_plafond', 'Plafond du LDDS', 12000, '€', '2012-10-01', 'Service-public.fr — Livret de développement durable et solidaire (LDDS)', 'https://www.service-public.fr/particuliers/vosdroits/F2368', '2026-10-10'),
  ('lep_taux', 'Taux du LEP', 2.5, '%', '2026-02-01', 'Ministère de l''Économie — communiqué du 15 juillet 2026 : LEP maintenu à 2,5 % au 1er août 2026', 'https://presse.economie.gouv.fr/?p=181486', '2026-10-10'),
  ('lep_plafond', 'Plafond du LEP', 10000, '€', '2023-10-01', 'Service-public.fr — Livret d''épargne populaire (LEP)', 'https://www.service-public.fr/particuliers/vosdroits/F2367', '2026-10-10'),
  ('pea_plafond', 'Plafond de versements du PEA', 150000, '€', '2014-01-01', 'Service-public.fr — Plan d''épargne en actions (PEA)', 'https://www.service-public.fr/particuliers/vosdroits/F2385', '2026-10-10'),
  ('pfu_taux', 'Prélèvement forfaitaire unique, taux global prélèvements sociaux inclus', 31.4, '%', '2026-01-01', 'impots.gouv.fr — Imposition des valeurs mobilières (12,8 % d''impôt + 18,6 % de prélèvements sociaux)', 'https://www.impots.gouv.fr/particulier/questions/jai-des-valeurs-mobilieres-comment-sont-elles-imposees', '2026-10-10'),
  ('av_abattement_seul', 'Abattement annuel assurance-vie après 8 ans, personne seule', 4600, '€', '2018-01-01', 'impots.gouv.fr — Imposition des produits des contrats d''assurance-vie', 'https://www.impots.gouv.fr/particulier/questions/jai-effectue-des-retraits-sur-mon-contrat-dassurance-vie-quelles-sont-les', '2026-10-10'),
  ('av_abattement_couple', 'Abattement annuel assurance-vie après 8 ans, couple soumis à imposition commune', 9200, '€', '2018-01-01', 'impots.gouv.fr — Imposition des produits des contrats d''assurance-vie', 'https://www.impots.gouv.fr/particulier/questions/jai-effectue-des-retraits-sur-mon-contrat-dassurance-vie-quelles-sont-les', '2026-10-10'),
  ('hcsf_taux_effort', 'Taux d''effort maximal HCSF', 35, '%', '2022-01-01', 'Haut Conseil de stabilité financière — mesure relative à l''octroi de crédits immobiliers (décision D-HCSF-2021-7, maintenue le 15 septembre 2026)', 'https://www.economie.gouv.fr/hcsf/mesures/mesure-relative-loctroi-de-credits-immobiliers', '2026-10-10'),
  ('hcsf_duree_max', 'Durée maximale du crédit immobilier HCSF', 25, 'ans', '2022-01-01', 'Haut Conseil de stabilité financière — mesure relative à l''octroi de crédits immobiliers (25 ans, jusqu''à 2 ans de différé en plus)', 'https://www.economie.gouv.fr/hcsf/mesures/mesure-relative-loctroi-de-credits-immobiliers', '2026-10-10'),
  ('pass', 'Plafond annuel de la Sécurité sociale', 48060, '€', '2026-01-01', 'Urssaf — Plafonds de la Sécurité sociale 2026', 'https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/plafonds-securite-sociale.html', '2026-10-10')
on conflict (cle) do update set libelle = excluded.libelle, valeur = excluded.valeur, unite = excluded.unite, date_effet = excluded.date_effet,
  source_titre = excluded.source_titre, source_url = excluded.source_url, verifie_le = excluded.verifie_le;

insert into public.savoir_fiches (slug, theme, titre, resume, contenu, mots_cles, sources, mis_a_jour_le) values
  ('epargne-de-precaution', 'epargne', 'L''épargne de précaution', 'Une réserve d''argent disponible immédiatement et sans risque de perte, pour faire face aux imprévus sans vendre vos placements au mauvais moment. On l''exprime en mois de dépenses.', $f$## À quoi ça sert

L'épargne de précaution est la somme que vous gardez de côté pour absorber un coup dur : une panne de voiture, une facture de santé, une période sans revenus, un déménagement imprévu. Son rôle n'est pas de rapporter, mais d'être là au bon moment. Sans elle, le moindre imprévu peut vous obliger à recourir à un crédit à la consommation ou à vendre des placements en actions alors que leur valeur est basse, ce qui transforme une baisse passagère en perte réelle.

C'est pour cette raison qu'elle vient avant tout autre projet d'investissement : tant qu'elle n'est pas constituée, prendre du risque ailleurs fragilise l'ensemble.

## Comment la calibrer

On l'exprime le plus souvent en **mois de dépenses courantes** (loyer ou mensualité, alimentation, énergie, transports, assurances), plutôt qu'en mois de revenus : c'est ce que vous devez continuer à payer quoi qu'il arrive.

- **3 mois** est un minimum raisonnable pour un salarié en poste stable, dans un foyer à deux revenus.
- **6 mois** conviennent mieux à un foyer à un seul revenu, avec des enfants, ou à un emploi moins sûr.
- **Davantage** (9 à 12 mois) se justifie pour un indépendant, un dirigeant ou une personne aux revenus irréguliers, ou à l'approche d'une grosse dépense connue (travaux, voiture).

Ces fourchettes sont des repères pédagogiques, pas des règles : votre situation (stabilité de l'emploi, aides possibles de l'entourage, couverture prévoyance) peut justifier plus ou moins.

## Où la placer

Trois critères comptent : **disponibilité immédiate**, **absence de risque de perte** et **simplicité**. Les livrets réglementés y répondent bien : ils sont garantis, sans frais et les intérêts sont exonérés d'impôt. Le Livret A et le LDDS sont ouverts à tous ; le LEP, mieux rémunéré, est réservé aux foyers sous un plafond de revenus (voir le repère Taux du LEP et le repère Taux du Livret A). Une petite partie peut rester sur le compte courant pour les dépenses du mois.

Les supports dont la valeur fluctue (actions, fonds, unités de compte) ou qui imposent un délai (plan bloqué, compte à terme) ne conviennent pas à cette réserve.

## Les pièges fréquents

- **La laisser grossir sans fin** : au-delà du besoin, l'argent placé sur un livret perd souvent du pouvoir d'achat sur le long terme. Le surplus peut servir d'autres objectifs.
- **La confondre avec l'épargne projet** : l'argent mis de côté pour un apport immobilier ou des travaux datés n'est pas une réserve d'urgence ; mieux vaut les suivre séparément.
- **Ne pas la reconstituer** après l'avoir utilisée : c'est la première chose à remettre à niveau.
- **Oublier les dépenses annuelles** (taxe foncière, assurances) dans le calcul des dépenses mensuelles.

## Comment Boussole s'en sert

Dans le Bilan, Boussole calcule votre **matelas en mois de dépenses** : le montant de votre poche Épargne disponible divisé par vos dépenses mensuelles du budget, avec un repère de 3 à 6 mois. Le questionnaire de profil de risque reprend ce chiffre : tant que le matelas est inférieur à 3 mois, le profil est plafonné à Modéré, parce qu'un imprévu pourrait vous forcer à vendre au plus bas. C'est un indicateur pédagogique, pas un conseil en investissement.$f$, array['matelas','urgence','livret','précaution','mois de dépenses','réserve'],
   '[{"titre": "AMF — Se constituer une épargne de précaution", "url": "https://www.amf-france.org/sites/institutionnel/files/private/2023-12/2023_se_constituer_une_epargne_de_precaution.pdf", "consulte_le": "2026-10-10"}, {"titre": "Service-public.fr — Livret A", "url": "https://www.service-public.fr/particuliers/vosdroits/F2365", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('livrets-reglementes', 'epargne', 'Les livrets réglementés : Livret A, LDDS, LEP', 'Trois livrets garantis par l''État, sans frais et défiscalisés, dont le taux et le plafond sont fixés par les pouvoirs publics. Le LEP est le mieux rémunéré mais réservé aux revenus modestes.', $f$## À quoi ça sert

Les livrets réglementés sont des comptes d'épargne dont les règles (taux, plafond, fiscalité) sont fixées par l'État et identiques dans tous les établissements. Ils servent d'abord à loger l'épargne de précaution et l'épargne de court terme : l'argent reste disponible à tout moment, sans risque de perte en capital, et les intérêts sont exonérés d'impôt sur le revenu et de prélèvements sociaux.

## Comment ça marche

- **Livret A** : ouvert à toute personne, un seul par personne. Les versements sont limités par un plafond (voir le repère Plafond du Livret A) ; les intérêts capitalisés peuvent le dépasser, mais vous ne pouvez plus verser une fois le plafond atteint.
- **LDDS** (livret de développement durable et solidaire) : réservé aux majeurs domiciliés fiscalement en France, un par contribuable (un par époux ou partenaire de Pacs). Son taux est aligné sur celui du Livret A ; son plafond est plus bas (voir le repère Plafond du LDDS).
- **LEP** (livret d'épargne populaire) : accessible aux foyers dont le revenu fiscal de référence ne dépasse pas un seuil qui dépend du nombre de parts. Sa rémunération est la plus élevée des trois (voir le repère Taux du LEP) et son plafond est intermédiaire (voir le repère Plafond du LEP). La banque vérifie chaque année que vous restez éligible.

Les intérêts sont calculés par **quinzaine** : un versement commence à rapporter à partir de la quinzaine suivante, un retrait cesse de rapporter dès le début de la quinzaine en cours. Ils sont crédités une fois par an, au 31 décembre.

## Les chiffres clés

Le taux du Livret A est révisé deux fois par an (1er février et 1er août) à partir d'une formule qui combine l'inflation et les taux courts du marché monétaire, le gouvernement pouvant s'en écarter (voir le repère Taux du Livret A). Le LEP suit une formule propre, au moins égale au taux du Livret A. Ces taux bougent : Boussole les affiche depuis ses repères datés plutôt que de les figer dans cette fiche.

## Les pièges fréquents

- **Regarder le taux nominal sans l'inflation** : quand l'inflation dépasse le taux du livret, votre épargne perd du pouvoir d'achat, même si son montant augmente.
- **Négliger le LEP** : beaucoup de foyers éligibles n'en ont pas ouvert. Comme il rapporte davantage, il est logique de le remplir en premier si vous y avez droit.
- **Ouvrir un second Livret A ou un second LDDS** : c'est interdit, et les établissements vérifient la détention de livrets auprès de l'administration fiscale avant toute ouverture.
- **Y laisser une épargne de long terme** : pour un horizon de plus de huit à dix ans, d'autres supports ont historiquement mieux protégé le pouvoir d'achat, avec en contrepartie un risque de fluctuation.

## Comment Boussole s'en sert

Boussole range vos livrets dans la poche Épargne, qui alimente le calcul du matelas de précaution en mois de dépenses. Le diagnostic signale aussi l'« argent dormant » : au-delà de 12 mois de dépenses sur livrets et monétaire, hors projets à moins de deux ans, une partie de cette épargne pourrait servir un objectif plus lointain. Le taux du Livret A affiché vient du repère daté correspondant. Indicateur pédagogique, pas un conseil en investissement.$f$, array['livret A','LDDS','LEP','taux','plafond','épargne réglementée'],
   '[{"titre": "Service-public.fr — Livret A", "url": "https://www.service-public.fr/particuliers/vosdroits/F2365", "consulte_le": "2026-10-10"}, {"titre": "Service-public.fr — Livret d’épargne populaire (LEP)", "url": "https://www.service-public.fr/particuliers/vosdroits/F2367", "consulte_le": "2026-10-10"}, {"titre": "Ministère de l’Économie — taux de l’épargne réglementée au 1er août 2026", "url": "https://presse.economie.gouv.fr/?p=181486", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('ordre-de-priorite-epargne', 'epargne', 'Dans quel ordre épargner ?', 'Une méthode simple pour hiérarchiser : rembourser les dettes chères, constituer la réserve de précaution, financer les projets datés, puis investir à long terme selon l''horizon et le profil de risque.', $f$## À quoi ça sert

Quand on commence à épargner, la question n'est pas seulement « quel placement ? » mais « dans quel ordre ? ». Chaque euro ne peut servir qu'à un objectif à la fois, et certains objectifs protègent tous les autres. Cette fiche propose une hiérarchie générale, à adapter à votre situation : elle relève de la méthode, pas d'un conseil personnalisé.

## Les étapes, dans l'ordre

1. **Solder les dettes coûteuses.** Un crédit renouvelable ou un découvert permanent coûte presque toujours plus cher que ce qu'un placement peut rapporter sans risque. Les rembourser est un rendement certain. Le crédit immobilier, à taux plus faible et souvent assuré, relève d'une autre logique.
2. **Constituer l'épargne de précaution.** Quelques mois de dépenses sur des supports disponibles et garantis (voir la fiche « L'épargne de précaution »). C'est le socle qui évite de devoir vendre au mauvais moment.
3. **Profiter des dispositifs les plus avantageux.** Si vous y avez droit, le LEP rapporte plus que les autres livrets (voir le repère Taux du LEP). Si votre employeur abonde un plan d'épargne salariale, ne pas verser au moins le montant qui déclenche l'abondement revient à renoncer à une partie de votre rémunération.
4. **Financer les projets datés.** Apport immobilier, voiture, études : pour un horizon de moins de cinq ans environ, la sécurité prime sur le rendement, car il n'y aura pas le temps de récupérer d'une baisse.
5. **Investir pour le long terme.** Pour un horizon de huit ans et plus, une part en actions largement diversifiées devient envisageable, dans des enveloppes fiscalement adaptées (PEA, assurance-vie, PER selon l'objectif). La part de risque dépend de votre profil et de votre horizon.

## Choisir l'enveloppe pour le long terme

- **PEA** : pour les actions européennes, gains exonérés d'impôt sur le revenu après 5 ans (voir la fiche « Le PEA »).
- **Assurance-vie** : enveloppe polyvalente, fiscalité allégée après 8 ans et atouts pour la transmission.
- **PER** : pour la retraite, surtout intéressant si votre taux marginal d'imposition est élevé, mais l'argent est en principe bloqué jusqu'à la retraite.
- **Compte-titres** : sans plafond ni avantage fiscal, utile une fois les autres enveloppes utilisées.

## Les pièges fréquents

- **Investir avant d'avoir une réserve** : la première baisse des marchés coïncide parfois avec un imprévu personnel.
- **Tout garder sur des livrets** par prudence, alors que l'horizon est très long : l'inflation grignote le pouvoir d'achat.
- **Choisir une enveloppe pour sa seule fiscalité**, sans regarder les frais, la disponibilité ou l'horizon.
- **Oublier de revoir l'ordre** quand la situation change (naissance, changement d'emploi, achat immobilier).

## Comment Boussole s'en sert

Boussole compare votre matelas en mois de dépenses au repère de 3 à 6 mois et plafonne le profil de risque tant que la réserve est insuffisante. Son diagnostic signale ensuite l'argent qui dort sur les livrets au-delà d'un an de dépenses et vérifie que les enveloppes sont utilisées dans un ordre cohérent (PEA avant compte-titres pour les actions européennes, ancienneté des contrats d'assurance-vie, PER rapproché de votre tranche d'imposition). Indicateur pédagogique, pas un conseil en investissement.$f$, array['priorités','méthode','dettes','précaution','horizon','enveloppes'],
   '[{"titre": "AMF — Se constituer une épargne de précaution", "url": "https://www.amf-france.org/sites/institutionnel/files/private/2023-12/2023_se_constituer_une_epargne_de_precaution.pdf", "consulte_le": "2026-10-10"}, {"titre": "Ministère de l’Économie — Tout savoir sur les produits d’épargne", "url": "https://www.economie.gouv.fr/particuliers/gerer-mon-argent/gerer-mon-budget-et-mon-epargne/tout-savoir-sur-les-produits-depargne", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('pea', 'enveloppes', 'Le plan d''épargne en actions (PEA)', 'Une enveloppe dédiée aux actions européennes, plafonnée en versements, dont les gains échappent à l''impôt sur le revenu après 5 ans (les prélèvements sociaux restent dus). Un retrait avant 5 ans clôt en principe le plan.', $f$## À quoi ça sert

Le PEA est une enveloppe fiscale conçue pour encourager l'investissement en actions d'entreprises européennes. Tant que l'argent reste dans le plan, les dividendes et plus-values ne sont pas imposés. Après cinq ans, les gains retirés sont exonérés d'impôt sur le revenu : seuls les prélèvements sociaux restent dus. C'est donc un outil adapté à un horizon long.

## Comment ça marche

- **Un seul PEA classique par personne** (bancaire ou sous forme d'assurance), donc deux pour un couple. Il peut être complété par un PEA PME-ETI.
- **Plafond de versements** (voir le repère Plafond de versements du PEA) : il porte sur les sommes versées, pas sur la valeur du plan. Un plan qui a pris de la valeur peut dépasser ce montant sans problème. Le PEA PME-ETI a son propre plafond, avec un plafond commun aux deux plans.
- **Titres éligibles** : actions de sociétés ayant leur siège dans l'Union européenne ou l'Espace économique européen, et fonds investis au moins à 75 % dans ces actions. Certains fonds indiciels répliquant des indices mondiaux sont éligibles grâce à des mécanismes de réplication synthétique ; l'éligibilité est indiquée dans la documentation du fonds.
- **Jeune majeur rattaché** au foyer fiscal de ses parents : PEA possible, avec un plafond réduit.

## Les retraits : la règle des 5 ans

- **Avant 5 ans** : en principe, tout retrait, même partiel, entraîne la clôture du plan. Les gains sont alors soumis au prélèvement forfaitaire unique (voir le repère Prélèvement forfaitaire unique, taux global prélèvements sociaux inclus), sauf option pour le barème. Des exceptions existent : licenciement, invalidité ou mise à la retraite anticipée du titulaire ou de son conjoint, ou création ou reprise d'entreprise.
- **Après 5 ans** : les retraits partiels sont possibles sans clôturer le plan et sans empêcher de nouveaux versements. Les gains sont exonérés d'impôt sur le revenu ; les prélèvements sociaux s'appliquent.

La date qui compte est celle du **premier versement** : ouvrir tôt un PEA avec une petite somme permet de « prendre date », même si vous n'investissez vraiment que plus tard.

## Les pièges fréquents

- **Y placer l'épargne de précaution** : un PEA investi en actions n'offre aucune garantie en capital et un retrait anticipé peut le clôturer.
- **Croire que le plafond limite la valeur** : seuls les versements comptent.
- **Négliger les frais** de tenue de compte, de courtage et les frais courants des fonds, qui pèsent sur la durée.
- **Concentrer le plan** sur quelques titres : la fiscalité ne compense pas un manque de diversification.

## Comment Boussole s'en sert

Boussole suit votre PEA comme une enveloppe à part, avec des cours relevés chaque soir. Dans le diagnostic, le critère « Choix des enveloppes » signale des actions européennes détenues en compte-titres alors que le PEA du même titulaire a encore de la place sous le plafond de versements. Indicateur pédagogique, pas un conseil en investissement.$f$, array['PEA','actions','5 ans','plafond','fiscalité','enveloppe'],
   '[{"titre": "Service-public.fr — Plan d’épargne en actions (PEA)", "url": "https://www.service-public.fr/particuliers/vosdroits/F2385", "consulte_le": "2026-10-10"}, {"titre": "impots.gouv.fr — Retraits d’un PEA : sont-ils imposables ?", "url": "https://www.impots.gouv.fr/particulier/questions/jai-un-plan-depargne-en-actions-pea-les-retraits-sont-ils-imposables", "consulte_le": "2026-10-10"}, {"titre": "AMF — Investir dans un PEA : ce qu’il faut savoir", "url": "https://www.amf-france.org/sites/institutionnel/files/private/2023-12/2023_investir_dans_un_pea.pdf", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('assurance-vie', 'enveloppes', 'L''assurance-vie', 'Une enveloppe d''épargne polyvalente : fonds en euros garanti et unités de compte non garanties, fiscalité des gains allégée après 8 ans et cadre spécifique pour transmettre un capital aux bénéficiaires.', $f$## À quoi ça sert

Malgré son nom, l'assurance-vie est surtout un placement d'épargne. Elle sert à faire fructifier un capital à moyen ou long terme, à préparer des revenus complémentaires et à organiser une transmission. L'argent reste disponible : vous pouvez effectuer un retrait (on parle de rachat) à tout moment, l'ancienneté du contrat ne jouant que sur la fiscalité.

## Comment ça marche

Un contrat combine généralement deux types de supports :

- **Le fonds en euros** : le capital est garanti par l'assureur (selon les contrats, net ou brut de frais de gestion), les intérêts acquis le restent. Son rendement varie chaque année.
- **Les unités de compte** : fonds actions, obligations, immobiliers, etc. Leur valeur fluctue et n'est pas garantie ; ils offrent un potentiel de rendement plus élevé sur la durée, avec un risque de perte.

Le contrat prévoit des frais (sur versements, de gestion annuelle, d'arbitrage) qu'il vaut la peine de comparer, car ils s'accumulent sur de longues durées.

## La fiscalité des rachats

Seuls les **gains** contenus dans un rachat sont imposés, pas le capital versé. Pour les versements effectués depuis le 27 septembre 2017 :

- **Contrat de moins de 8 ans** : gains soumis au prélèvement forfaitaire de 12,8 % ou, sur option, au barème de l'impôt sur le revenu.
- **Contrat de plus de 8 ans** : un abattement annuel s'applique sur les gains (voir les repères Abattement annuel assurance-vie après 8 ans, personne seule et couple soumis à imposition commune). Au-delà, les gains sont imposés à 7,5 % tant que l'ensemble des primes versées sur vos contrats ne dépasse pas 150 000 €, puis à 12,8 % pour la fraction correspondant aux primes au-delà.
- **Prélèvements sociaux** : dus sur les gains. L'assurance-vie a été tenue à l'écart de la hausse de CSG de 2026 : son taux de prélèvements sociaux est resté à 17,2 %, alors que celui des autres revenus du capital est passé à 18,6 %.

Les versements antérieurs au 27 septembre 2017 suivent un régime plus ancien, fondé lui aussi sur la durée du contrat.

## La transmission, en bref

Au décès, les capitaux vont aux bénéficiaires désignés dans la clause, hors succession civile. Pour les primes versées avant 70 ans, chaque bénéficiaire profite d'un abattement important avant taxation ; pour celles versées après 70 ans, un abattement global plus réduit s'applique, puis les droits de succession. Le conjoint ou partenaire de Pacs est exonéré. Voir la fiche « Transmettre : les bases ».

## Les pièges fréquents

- **Oublier la clause bénéficiaire** ou la laisser vague : c'est elle qui décide qui reçoit le capital.
- **Ne regarder que le fonds en euros** sans voir les frais ou la part imposée en unités de compte.
- **Attendre pour ouvrir** : l'horloge des 8 ans démarre à l'ouverture du contrat, même avec un faible versement.
- **Confondre garantie et absence de risque** pour les unités de compte.

## Comment Boussole s'en sert

Boussole classe le fonds en euros à part dans la répartition de vos placements. À partir de la date d'ouverture de chaque contrat renseignée dans votre profil, le diagnostic indique quand le contrat atteindra 8 ans et signale un objectif financé par ce contrat dont l'échéance tombe avant : un retrait anticipé ne profiterait pas de l'abattement. Dans la vue de liquidité du Bilan, l'assurance-vie est considérée comme disponible en quelques semaines. Indicateur pédagogique, pas un conseil en investissement.$f$, array['assurance-vie','fonds en euros','unités de compte','8 ans','rachat','abattement','clause bénéficiaire'],
   '[{"titre": "impots.gouv.fr — Imposition des produits des contrats d’assurance-vie", "url": "https://www.impots.gouv.fr/particulier/questions/jai-effectue-des-retraits-sur-mon-contrat-dassurance-vie-quelles-sont-les", "consulte_le": "2026-10-10"}, {"titre": "impots.gouv.fr — Je suis bénéficiaire d’une assurance-vie, comment la déclarer ?", "url": "https://www.impots.gouv.fr/particulier/questions/je-suis-beneficiaire-dune-assurance-vie-comment-la-declarer", "consulte_le": "2026-10-10"}, {"titre": "Service-public.fr — Imposition des revenus d’un contrat d’assurance-vie", "url": "https://www.service-public.fr/particuliers/vosdroits/F22414", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('per', 'retraite', 'Le plan d''épargne retraite (PER) et la tranche d''imposition', 'Une enveloppe pour préparer la retraite : les versements volontaires sont déductibles du revenu imposable dans une limite annuelle, en échange d''une épargne en principe bloquée jusqu''à la retraite et imposée à la sortie.', $f$## À quoi ça sert

Le PER individuel sert à se constituer un complément de revenus pour la retraite. Son principal attrait est fiscal : les versements volontaires peuvent être déduits du revenu imposable l'année où vous les faites. En contrepartie, l'argent est en principe bloqué jusqu'au départ à la retraite et la sortie est imposée. Le PER déplace donc l'impôt dans le temps, plus qu'il ne le supprime.

## Comment ça marche

- **Versements libres**, investis selon une gestion que vous choisissez ou une gestion pilotée qui réduit le risque à l'approche de la retraite.
- **Déduction** : par défaut, les versements effectués avant 70 ans sont déductibles. Depuis le 1er janvier 2026, les versements faits après 70 ans ne le sont plus. Vous pouvez aussi renoncer à la déduction versement par versement, ce qui allège l'imposition à la sortie.
- **Plafond de déduction** pour un salarié : 10 % des revenus d'activité nets de l'année précédente, dans une limite exprimée en multiples du plafond annuel de la Sécurité sociale (voir le repère Plafond annuel de la Sécurité sociale), avec un minimum garanti même sans revenus d'activité. Les plafonds non utilisés des cinq années précédentes peuvent être reportés. Le montant disponible figure sur votre avis d'impôt. Les travailleurs indépendants ont un plafond calculé autrement.
- **Déblocage anticipé** possible dans des cas limités : achat de la résidence principale, décès du conjoint ou partenaire de Pacs, invalidité, surendettement, fin des droits au chômage, liquidation judiciaire.
- **Sortie** à la retraite en capital, en rente viagère ou en combinant les deux.

## Pourquoi la tranche d'imposition compte

L'économie d'impôt d'un versement déduit est égale à votre **taux marginal d'imposition** (la tranche dans laquelle tombe le dernier euro de revenu). Un versement de 1 000 € fait économiser 300 € à un foyer dans la tranche à 30 %, 110 € dans la tranche à 11 %, rien s'il n'est pas imposable. À la sortie en capital, la part correspondant aux versements déduits est réintégrée au revenu imposable de l'année de sortie. Le PER est donc surtout intéressant si votre tranche pendant la vie active est plus élevée que celle attendue à la retraite.

## Fiscalité à la sortie, en résumé

- **Capital issu de versements déduits** : imposé au barème de l'impôt sur le revenu ; les gains sont soumis au prélèvement forfaitaire unique (voir le repère Prélèvement forfaitaire unique, taux global prélèvements sociaux inclus).
- **Capital issu de versements non déduits** : la part des versements est exonérée, seuls les gains sont imposés.
- **Rente** : imposée comme une pension si les versements ont été déduits, sinon sur une fraction qui dépend de l'âge.

## Les pièges fréquents

- **Verser sans être imposable** ou dans une tranche faible : l'avantage est faible et l'argent reste bloqué.
- **Oublier l'imposition à la sortie** dans le calcul du gain réel.
- **Y placer de l'argent dont on pourrait avoir besoin** avant la retraite, hors cas de déblocage.
- **Négliger les frais**, qui pèsent lourd sur des durées de vingt ou trente ans.

## Comment Boussole s'en sert

Boussole rapproche votre PER de la tranche d'imposition renseignée dans votre profil : en dessous de 30 %, le diagnostic signale que la déduction à l'entrée pèse peu face à l'impôt à la sortie. Dans la vue de liquidité du Bilan, le PER est classé parmi les sommes bloquées. Indicateur pédagogique, pas un conseil en investissement.$f$, array['PER','retraite','déduction','tranche marginale','impôt','déblocage'],
   '[{"titre": "Service-public.fr — Plan d’épargne retraite (PER)", "url": "https://www.service-public.fr/particuliers/vosdroits/F34982", "consulte_le": "2026-10-10"}, {"titre": "Service-public.fr — PER individuel", "url": "https://www.service-public.fr/particuliers/vosdroits/F36526", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('compte-titres-fiscalite', 'fiscalite', 'Le compte-titres et la fiscalité des revenus du capital', 'Le compte-titres ordinaire n''a ni plafond ni avantage fiscal : dividendes, intérêts et plus-values sont soumis chaque année au prélèvement forfaitaire unique, ou sur option au barème de l''impôt sur le revenu.', $f$## À quoi ça sert

Le compte-titres ordinaire (CTO) permet de détenir tout type de titres : actions du monde entier, obligations, fonds, trackers. Il n'a ni plafond de versement ni durée minimale, et l'argent est disponible à tout moment. En contrepartie, il n'offre aucun avantage fiscal : les revenus et les gains sont imposés l'année où ils sont perçus ou réalisés. Il sert souvent de complément une fois les enveloppes avantagées (PEA, assurance-vie) utilisées, ou pour des titres qu'elles n'acceptent pas.

## Comment les revenus sont imposés

Depuis 2018, les revenus du capital relèvent par défaut du **prélèvement forfaitaire unique** (PFU), qui réunit une part d'impôt sur le revenu de 12,8 % et les prélèvements sociaux. Depuis le 1er janvier 2026, ces prélèvements sociaux sont passés de 17,2 % à 18,6 % pour la plupart des revenus du capital (voir le repère Prélèvement forfaitaire unique, taux global prélèvements sociaux inclus).

- **Dividendes et intérêts** : un acompte est prélevé à la source par l'établissement, puis régularisé lors de la déclaration. Les foyers sous un certain revenu fiscal de référence peuvent demander à en être dispensés.
- **Plus-values de cession** : calculées vente par vente (prix de vente moins prix d'acquisition moyen, frais compris) et déclarées l'année suivante.
- **Moins-values** : elles s'imputent sur les plus-values de même nature de l'année, puis l'excédent est reportable sur les dix années suivantes. Elles ne réduisent pas le revenu global.

## L'option pour le barème

Vous pouvez choisir, lors de la déclaration, d'imposer ces revenus au barème progressif plutôt qu'au taux forfaitaire. Cette option est **globale** : elle vaut pour l'ensemble de vos revenus du capital de l'année. Elle peut être intéressante pour un foyer faiblement imposé, car :

- les dividendes bénéficient alors d'un **abattement de 40 %** ;
- les titres acquis avant 2018 peuvent bénéficier d'abattements pour durée de détention ;
- une partie de la CSG devient déductible l'année suivante.

Les prélèvements sociaux restent dus dans tous les cas, sur la totalité des gains. Le simulateur de l'administration fiscale permet de comparer les deux options.

## Les pièges fréquents

- **Vendre et racheter souvent** : chaque vente gagnante déclenche une imposition, ce qui freine l'effet des intérêts composés par rapport à une enveloppe où les gains restent à l'abri.
- **Oublier les moins-values reportables** : elles se perdent au bout de dix ans si elles ne sont pas utilisées.
- **Détenir un compte à l'étranger sans le déclarer** : c'est une obligation déclarative, sanctionnée en cas d'oubli.
- **Choisir le barème par réflexe** sans comparer : l'option s'applique à tous les revenus du capital de l'année.

## Comment Boussole s'en sert

Boussole valorise les positions de votre compte-titres chaque soir. Son diagnostic repère les actions européennes logées en compte-titres alors qu'un PEA du même titulaire a encore de la place, puisque la fiscalité des gains y serait plus légère après 5 ans. Le taux du prélèvement forfaitaire affiché vient du repère daté, pas d'un chiffre figé. Indicateur pédagogique, pas un conseil en investissement.$f$, array['compte-titres','PFU','flat tax','plus-values','dividendes','barème','moins-values'],
   '[{"titre": "impots.gouv.fr — J’ai des valeurs mobilières, comment sont-elles imposées ?", "url": "https://www.impots.gouv.fr/particulier/questions/jai-des-valeurs-mobilieres-comment-sont-elles-imposees", "consulte_le": "2026-10-10"}, {"titre": "Service-public.fr — Plus-values sur valeurs mobilières", "url": "https://www.service-public.fr/particuliers/vosdroits/F21618", "consulte_le": "2026-10-10"}, {"titre": "impots.gouv.fr — Mes valeurs mobilières ouvrent-elles droit à abattement ?", "url": "https://www.impots.gouv.fr/particulier/questions/mes-valeurs-mobilieres-ouvrent-elles-droit-abattement", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('transmission-bases', 'fiscalite', 'Transmettre : les bases (donations, succession, assurance-vie)', 'Les grands mécanismes pour transmettre un patrimoine en France : abattements par enfant renouvelables tous les 15 ans, exonération du conjoint au décès et régime propre de l''assurance-vie.', $f$## À quoi ça sert

Préparer la transmission, c'est décider à qui ira votre patrimoine, quand, et à quel coût fiscal pour ceux qui le reçoivent. Une partie se règle de son vivant (donations), une partie au décès (succession et assurance-vie). Cette fiche présente les règles de base ; un notaire reste l'interlocuteur pour toute situation concrète, notamment en présence d'une famille recomposée, d'un bien immobilier ou d'une entreprise.

## Les donations de son vivant

- **Abattement parent-enfant** : chaque parent peut donner jusqu'à 100 000 € à chaque enfant sans droits à payer.
- **Grands-parents** : abattement de 31 865 € par petit-enfant.
- **Don familial de sommes d'argent** : 31 865 € supplémentaires exonérés si le donateur a moins de 80 ans et que le bénéficiaire est majeur (enfant, petit-enfant, arrière-petit-enfant, ou neveu ou nièce dans certains cas). Il se cumule avec l'abattement de parenté.
- **Le délai de 15 ans** : ces abattements se reconstituent tous les 15 ans. Une donation faite il y a moins de 15 ans est « rappelée » : elle consomme l'abattement disponible lors de la donation suivante ou de la succession.

Donner tôt et à intervalles réguliers permet donc d'utiliser plusieurs fois les abattements.

## La succession au décès

- **Conjoint marié ou partenaire de Pacs** : exonéré de droits de succession.
- **Enfants** : abattement de 100 000 € par enfant et par parent, puis barème progressif en ligne directe. L'abattement est augmenté en cas de handicap.
- **Frères et sœurs** : abattement plus faible, avec une exonération sous conditions strictes ; neveux, nièces et personnes sans lien de parenté sont beaucoup plus taxés.

La loi réserve aussi aux enfants une part minimale de la succession (la réserve héréditaire), qu'une donation ou un testament ne peut pas entamer.

## L'assurance-vie, un régime à part

Les capitaux d'un contrat d'assurance-vie sont versés aux bénéficiaires désignés, en dehors de la succession civile, et ont leur propre fiscalité :

- **Primes versées avant les 70 ans de l'assuré** : abattement de 152 500 € par bénéficiaire, tous contrats confondus, puis prélèvement de 20 % jusqu'à 700 000 € et 31,25 % au-delà.
- **Primes versées après 70 ans** : abattement global de 30 500 € pour l'ensemble des bénéficiaires ; au-delà, les primes sont soumises aux droits de succession selon le lien de parenté. Les gains produits par ces primes sont exonérés.
- **Conjoint ou partenaire de Pacs bénéficiaire** : exonéré.

## Les pièges fréquents

- **Une clause bénéficiaire imprécise** ou jamais mise à jour après un divorce ou une naissance.
- **Oublier le rappel fiscal** des donations de moins de 15 ans.
- **Confondre concubin et partenaire de Pacs** : le concubin n'a aucun droit légal et est taxé comme un tiers.
- **Donner plus qu'on ne peut** : une donation est en principe irrévocable ; il faut garder de quoi vivre.

## Comment Boussole s'en sert

Boussole ne calcule pas de droits de succession. Il vous aide à garder une vue claire de ce qui serait transmis (biens, contrats d'assurance-vie et leur date d'ouverture) pour préparer un échange avec un notaire. Indicateur pédagogique, pas un conseil juridique ou en investissement.$f$, array['transmission','donation','succession','abattement','15 ans','assurance-vie','héritage'],
   '[{"titre": "Service-public.fr — Droits de donation : abattements selon le lien de parenté", "url": "https://www.service-public.fr/particuliers/vosdroits/F14203", "consulte_le": "2026-10-10"}, {"titre": "Service-public.fr — Droits de succession", "url": "https://www.service-public.fr/particuliers/vosdroits/F35794", "consulte_le": "2026-10-10"}, {"titre": "impots.gouv.fr — Je suis bénéficiaire d’une assurance-vie, comment la déclarer ?", "url": "https://www.impots.gouv.fr/particulier/questions/je-suis-beneficiaire-dune-assurance-vie-comment-la-declarer", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('taux-endettement', 'credit', 'Le taux d''endettement et la norme HCSF', 'Le taux d''effort rapporte vos mensualités de crédit, assurance comprise, à vos revenus nets. Pour un crédit immobilier, la norme du HCSF le limite et plafonne la durée, avec une marge de dérogation pour les banques.', $f$## À quoi ça sert

Le taux d'endettement, que les autorités appellent **taux d'effort**, mesure la part de vos revenus consacrée au remboursement de vos crédits. C'est le premier indicateur regardé par une banque pour un prêt immobilier, et un bon outil pour vous-même : au-delà d'un certain niveau, le budget n'a plus de marge pour les imprévus.

## Comment il se calcule

**Taux d'effort = total des mensualités de crédit (assurance emprunteur comprise) ÷ revenus nets mensuels avant impôt.**

- Au numérateur : toutes les mensualités en cours et à venir (immobilier, auto, consommation), y compris le nouveau prêt demandé et son assurance.
- Au dénominateur : salaires nets avant prélèvement à la source, revenus d'indépendant réguliers, une partie des loyers perçus (souvent retenus à environ 70 % par les banques pour tenir compte des vacances et charges), pensions.

Exemple : un foyer qui perçoit 4 500 € nets par mois et rembourse 1 400 € (dont 60 € d'assurance) a un taux d'effort d'environ 31 %.

## La norme du HCSF

Le Haut Conseil de stabilité financière a rendu juridiquement contraignante, depuis le 1er janvier 2022, une norme sur les crédits immobiliers :

- **Taux d'effort maximal** (voir le repère Taux d'effort maximal HCSF), assurance comprise.
- **Durée maximale** (voir le repère Durée maximale du crédit immobilier HCSF), avec jusqu'à deux ans de différé en plus lorsque l'entrée dans le logement est décalée (achat sur plan, travaux importants).
- **Marge de flexibilité** : chaque banque peut déroger à ces limites pour 20 % de sa production trimestrielle de crédits immobiliers, majoritairement réservée aux résidences principales et en partie aux primo-accédants.

Lors de sa séance du 15 septembre 2026, le HCSF a constaté une bonne appropriation de la norme sans la modifier.

## Les pièges fréquents

- **Oublier l'assurance emprunteur** dans le calcul : la norme l'inclut.
- **Ne regarder que le pourcentage** : 35 % d'un revenu élevé laisse un « reste à vivre » confortable, 35 % d'un petit revenu beaucoup moins. Les banques regardent les deux.
- **Ignorer les crédits à la consommation** en cours, qui réduisent d'autant la capacité d'emprunt immobilier.
- **Allonger la durée pour passer sous le seuil** : la mensualité baisse, mais le coût total des intérêts augmente nettement.

## Comment Boussole s'en sert

L'onglet Ma position calcule votre taux d'endettement, assurance comprise et toutes mensualités confondues, et le compare au plafond HCSF : vert sous le plafond, orange un peu au-delà (zone de dérogation possible), rouge nettement au-dessus. Il indique aussi de combien les revenus ou l'apport devraient augmenter pour revenir au plafond. Indicateur pédagogique, pas un conseil en investissement ni une offre de crédit.$f$, array['endettement','taux d''effort','HCSF','35 %','crédit immobilier','capacité d''emprunt'],
   '[{"titre": "Haut Conseil de stabilité financière — Mesure relative à l’octroi de crédits immobiliers", "url": "https://www.economie.gouv.fr/hcsf/mesures/mesure-relative-loctroi-de-credits-immobiliers", "consulte_le": "2026-10-10"}, {"titre": "Haut Conseil de stabilité financière — communiqués de presse", "url": "https://www.economie.gouv.fr/hcsf/publications/communiques-de-presse", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('assurance-emprunteur', 'credit', 'L''assurance emprunteur', 'L''assurance qui rembourse tout ou partie d''un crédit immobilier en cas de décès ou d''incapacité. Depuis la loi Lemoine, on peut en changer à tout moment, et le questionnaire de santé n''est plus exigé sous certaines conditions.', $f$## À quoi ça sert

L'assurance emprunteur prend en charge tout ou partie des mensualités, ou le capital restant dû, si l'emprunteur décède ou ne peut plus travailler à la suite d'une maladie ou d'un accident. Elle n'est pas obligatoire par la loi, mais les banques l'exigent presque toujours pour un crédit immobilier. Elle protège à la fois le prêteur et votre famille, qui n'aura pas à rembourser le prêt en cas de coup dur.

## Comment ça marche

- **Garanties** : décès et perte totale et irréversible d'autonomie (toujours demandées), puis selon le projet incapacité temporaire de travail et invalidité. La banque fixe un niveau de garanties minimal.
- **Quotité** : la part du prêt couverte pour chaque emprunteur. À deux, on peut se couvrir à 50 % chacun ou à 100 % chacun ; plus la quotité est élevée, meilleure est la protection et plus la cotisation est chère.
- **Coût** : il peut représenter une part importante du coût total du crédit. Il est calculé soit sur le capital initial (montant constant), soit sur le capital restant dû (montant décroissant).

## Ce que la loi Lemoine a changé

La loi du 28 février 2022 a ouvert trois droits :

- **Changer d'assurance à tout moment**, sans frais, depuis le 1er juin 2022 pour les nouveaux prêts et le 1er septembre 2022 pour les prêts en cours. Le nouveau contrat doit présenter des garanties au moins équivalentes à celles exigées par la banque, qui a 10 jours pour répondre après réception du dossier complet. En cas de refus, l'ancien contrat continue.
- **Pas de questionnaire de santé** lorsque la part assurée par personne ne dépasse pas 200 000 € et que le prêt est entièrement remboursé avant les 60 ans de l'emprunteur. L'assureur ne peut alors demander ni questionnaire ni examen médical.
- **Droit à l'oubli raccourci** : une personne guérie d'un cancer ou d'une hépatite C n'a plus à le déclarer cinq ans après la fin du protocole thérapeutique, sans rechute, si le contrat se termine avant ses 71 ans. Pour les autres risques aggravés de santé, la convention AERAS organise l'accès à l'assurance.

## Les pièges fréquents

- **Ne jamais comparer** : l'écart entre le contrat proposé par la banque et une délégation d'assurance peut être important, surtout pour les emprunteurs jeunes et non-fumeurs.
- **Regarder le prix sans les garanties** : exclusions, délai de carence, définition de l'invalidité et mode d'indemnisation (forfaitaire ou selon la perte de revenus) font la différence le jour où l'on en a besoin.
- **Fausse déclaration** de santé ou de tabagisme : elle peut entraîner la nullité du contrat.
- **Oublier l'assurance dans le taux d'endettement** : la norme HCSF l'inclut.

## Comment Boussole s'en sert

Boussole intègre la cotisation d'assurance dans vos mensualités de crédit, et donc dans le taux d'endettement comparé au plafond HCSF dans l'onglet Ma position. Indicateur pédagogique, pas un conseil en assurance ni en investissement.$f$, array['assurance emprunteur','loi Lemoine','résiliation','questionnaire de santé','droit à l''oubli','quotité','AERAS'],
   '[{"titre": "Ministère de l’Économie — Achat immobilier : pouvez-vous changer d’assurance emprunteur ?", "url": "https://www.economie.gouv.fr/particuliers/emprunter-et-sassurer/achat-immobilier-pouvez-vous-changer-dassurance-emprunteur", "consulte_le": "2026-10-10"}, {"titre": "Légifrance — Loi n° 2022-270 du 28 février 2022 (assurance emprunteur)", "url": "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000045268729", "consulte_le": "2026-10-10"}, {"titre": "Ministère de l’Économie — Assurance emprunteur : questionnaire de santé", "url": "https://www.economie.gouv.fr/particuliers/gerer-mon-argent/emprunter-et-sassurer/assurance-emprunteur-questionnaire-de-sante-quand-est-ce-obligatoire", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10')
on conflict (slug) do update set theme = excluded.theme, titre = excluded.titre, resume = excluded.resume, contenu = excluded.contenu,
  mots_cles = excluded.mots_cles, sources = excluded.sources, mis_a_jour_le = excluded.mis_a_jour_le, version = public.savoir_fiches.version + 1
  -- Rejouer la migration sans changement n'incrémente pas la version.
  where public.savoir_fiches.contenu is distinct from excluded.contenu or public.savoir_fiches.titre is distinct from excluded.titre
     or public.savoir_fiches.resume is distinct from excluded.resume or public.savoir_fiches.sources is distinct from excluded.sources;
