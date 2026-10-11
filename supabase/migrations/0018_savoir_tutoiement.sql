-- Boussole : fiches du savoir commun au tutoiement (spec 2026-10-11 « saisie par l'agent », § 3).
-- Appliqué avec apply_migration (name = "savoir_tutoiement"), après 0015. Les 19 fiches passent du vouvoiement au tutoiement ;
-- le fond (chiffres, règles, sources, liens) est inchangé. Dans « Comment Boussole s'en sert », la saisie se fait désormais
-- avec l'assistant (Claude) : l'app est en lecture seule, les chemins de navigation (Pilotage › Rang, Patrimoine › Objectifs,
-- Compte › Données…) restent ceux du cockpit.
-- Rejouable : chaque mise à jour ne porte que sur une fiche dont le contenu diffère encore du texte au tutoiement, la version
-- n'est donc incrémentée qu'une fois. Les sources ne sont pas touchées.

-- acheter-ou-louer
update public.savoir_fiches
   set titre = 'Acheter ou louer sa résidence principale',
       resume = 'Il n''y a pas de réponse universelle : tout dépend du rapport entre prix et loyers, de la durée pendant laquelle tu resteras, des taux, des frais d''acquisition et de ce que rapporterait ton apport s''il était placé.',
       contenu = $f$## L'idée clé

Acheter ou louer n'est pas une question de principe mais de comparaison chiffrée. Le propriétaire et le locataire paient tous deux pour se loger ; la vraie question est de savoir lequel des deux, à la fin de la période envisagée, aura le patrimoine le plus élevé, à condition que le locataire place effectivement l'argent qu'il n'a pas mis dans l'achat.

## Comparer des coûts comparables

Le remboursement du capital emprunté n'est pas un coût : c'est de l'épargne qui se transforme en patrimoine. Les coûts à comparer sont ceux qui ne reviennent jamais.

- **Côté propriétaire** : intérêts du crédit, assurance emprunteur, frais de garantie, frais d'acquisition (souvent de l'ordre de 7 à 8 % du prix dans l'ancien, nettement moins dans le neuf), taxe foncière, charges de copropriété non récupérables, entretien et gros travaux, frais de revente éventuels.
- **Le coût d'opportunité de l'apport** : l'apport immobilisé dans le logement aurait pu être placé ; ce rendement perdu est un coût réel, souvent oublié.
- **Côté locataire** : le loyer et ses hausses, en contrepartie de la liberté de déménager et de l'épargne qu'il peut investir.

## Le rôle de la durée

Les frais d'acquisition et de revente sont payés une seule fois. Plus la durée d'occupation est courte, plus ils pèsent par année : sur quelques années seulement, la location est souvent plus avantageuse. Le point d'équilibre dépend fortement de la ville, du rapport entre prix et loyers, des taux d'intérêt et de l'évolution future des prix, qui n'est jamais garantie. L'Insee relevait par exemple une baisse de 0,8 % sur un an des prix des logements anciens au deuxième trimestre 2026 (données provisoires) : les prix ne montent pas toujours.

La capacité d'emprunt est par ailleurs encadrée par les normes du Haut Conseil de stabilité financière (voir les repères Taux d'effort maximal HCSF et Durée maximale du crédit immobilier HCSF).

## Au-delà des chiffres

- **Sécurité et liberté** : stabilité, possibilité d'aménager son logement, mais aussi mobilité réduite.
- **Concentration du risque** : un achat met souvent l'essentiel du patrimoine sur un seul bien, peu liquide, dans une seule ville.
- **Discipline** : l'avantage de la location suppose d'investir réellement la différence, chaque mois, pendant des années.
- **Imprévus** : séparation, mutation ou perte d'emploi peuvent imposer une revente rapide, au mauvais moment.

## Pièges fréquents

- Comparer la mensualité au loyer, alors que la mensualité inclut du capital remboursé.
- Oublier le rendement qu'aurait procuré l'apport.
- Supposer que les prix continueront de monter au rythme passé.
- Ignorer les frais d'acquisition pour une durée d'occupation courte.
- Mobiliser toute son épargne en apport sans garder d'épargne de précaution.

## Comment Boussole s'en sert

Le simulateur « Acheter ou louer » de Boussole compare, année après année, le patrimoine net d'un acheteur et celui d'un locataire qui place la différence. Il s'appuie sur des données de prix et de loyers par ville, les frais de notaire, la taxe foncière, les charges et l'entretien, et propose plusieurs scénarios (central, retour de l'inflation…). Ton apport et tes crédits existants peuvent être repris de ton bilan ; s'il en manque, complète-les avec Claude. Toutes les hypothèses sont modifiables, et les résultats sont des projections, pas des promesses.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'acheter-ou-louer' and contenu is distinct from $f$## L'idée clé

Acheter ou louer n'est pas une question de principe mais de comparaison chiffrée. Le propriétaire et le locataire paient tous deux pour se loger ; la vraie question est de savoir lequel des deux, à la fin de la période envisagée, aura le patrimoine le plus élevé, à condition que le locataire place effectivement l'argent qu'il n'a pas mis dans l'achat.

## Comparer des coûts comparables

Le remboursement du capital emprunté n'est pas un coût : c'est de l'épargne qui se transforme en patrimoine. Les coûts à comparer sont ceux qui ne reviennent jamais.

- **Côté propriétaire** : intérêts du crédit, assurance emprunteur, frais de garantie, frais d'acquisition (souvent de l'ordre de 7 à 8 % du prix dans l'ancien, nettement moins dans le neuf), taxe foncière, charges de copropriété non récupérables, entretien et gros travaux, frais de revente éventuels.
- **Le coût d'opportunité de l'apport** : l'apport immobilisé dans le logement aurait pu être placé ; ce rendement perdu est un coût réel, souvent oublié.
- **Côté locataire** : le loyer et ses hausses, en contrepartie de la liberté de déménager et de l'épargne qu'il peut investir.

## Le rôle de la durée

Les frais d'acquisition et de revente sont payés une seule fois. Plus la durée d'occupation est courte, plus ils pèsent par année : sur quelques années seulement, la location est souvent plus avantageuse. Le point d'équilibre dépend fortement de la ville, du rapport entre prix et loyers, des taux d'intérêt et de l'évolution future des prix, qui n'est jamais garantie. L'Insee relevait par exemple une baisse de 0,8 % sur un an des prix des logements anciens au deuxième trimestre 2026 (données provisoires) : les prix ne montent pas toujours.

La capacité d'emprunt est par ailleurs encadrée par les normes du Haut Conseil de stabilité financière (voir les repères Taux d'effort maximal HCSF et Durée maximale du crédit immobilier HCSF).

## Au-delà des chiffres

- **Sécurité et liberté** : stabilité, possibilité d'aménager son logement, mais aussi mobilité réduite.
- **Concentration du risque** : un achat met souvent l'essentiel du patrimoine sur un seul bien, peu liquide, dans une seule ville.
- **Discipline** : l'avantage de la location suppose d'investir réellement la différence, chaque mois, pendant des années.
- **Imprévus** : séparation, mutation ou perte d'emploi peuvent imposer une revente rapide, au mauvais moment.

## Pièges fréquents

- Comparer la mensualité au loyer, alors que la mensualité inclut du capital remboursé.
- Oublier le rendement qu'aurait procuré l'apport.
- Supposer que les prix continueront de monter au rythme passé.
- Ignorer les frais d'acquisition pour une durée d'occupation courte.
- Mobiliser toute son épargne en apport sans garder d'épargne de précaution.

## Comment Boussole s'en sert

Le simulateur « Acheter ou louer » de Boussole compare, année après année, le patrimoine net d'un acheteur et celui d'un locataire qui place la différence. Il s'appuie sur des données de prix et de loyers par ville, les frais de notaire, la taxe foncière, les charges et l'entretien, et propose plusieurs scénarios (central, retour de l'inflation…). Ton apport et tes crédits existants peuvent être repris de ton bilan ; s'il en manque, complète-les avec Claude. Toutes les hypothèses sont modifiables, et les résultats sont des projections, pas des promesses.$f$;

-- allocation-profil-de-risque
update public.savoir_fiches
   set titre = 'Allocation et profil de risque',
       resume = 'L''allocation répartit ton épargne entre supports garantis, obligations, actions et placements spéculatifs. Elle découle de ton horizon, de ta capacité à encaisser une perte et de ta tolérance réelle aux baisses.',
       contenu = $f$## L'idée clé

Le choix le plus déterminant pour un portefeuille n'est pas tel ou tel fonds, mais la répartition entre grandes familles d'actifs : supports garantis et monétaires, obligations, actions, immobilier et, à la marge, actifs spéculatifs. Cette répartition, appelée allocation, fixe à la fois le rendement que l'on peut espérer à long terme et l'ampleur des baisses qu'il faudra traverser en chemin.

## Les trois questions à te poser

- **Horizon** : quand auras-tu besoin de cet argent ? Une somme destinée à un projet proche n'a pas sa place sur les marchés d'actions, qui peuvent baisser juste avant l'échéance. L'AMF rappelle qu'un placement en actions, encore risqué sur 5 ans, l'est bien moins sur 15 ans.
- **Capacité à subir des pertes** : ta situation te permet-elle d'encaisser une baisse sans être obligé de vendre ? Sans épargne de précaution, le moindre imprévu peut forcer une vente au plus mauvais moment.
- **Tolérance au risque** : comment réagirais-tu, concrètement, devant une perte de 20 ou 30 % affichée sur ton relevé ? La réponse honnête compte davantage que la réponse idéale.

La réglementation européenne (MiFID II) impose aux professionnels qui conseillent de recueillir ces éléments : situation financière, objectifs, horizon, capacité à subir des pertes, connaissances et expérience. L'ESMA a détaillé ces exigences dans ses orientations sur l'évaluation de l'adéquation.

## Comment ça marche

Plus la part d'actions est élevée, plus le rendement espéré à long terme est élevé, et plus les baisses temporaires sont profondes. Les obligations et les supports garantis amortissent les chocs mais rapportent moins ; une épargne entièrement garantie risque même de perdre du pouvoir d'achat face à l'inflation sur longue période. Selon l'AMF, la part d'actions dépend du profil, de l'âge, de l'horizon et de la confiance dans l'avenir : un épargnant jeune qui prépare sa retraite peut en détenir une large part, à condition de n'y placer que de l'argent dont il n'aura pas besoin avant l'échéance.

Une allocation se décide une fois, puis s'entretient. Les mouvements de marché la déforment : un rééquilibrage périodique, qui consiste à alléger ce qui a le plus progressé pour revenir aux proportions visées, maintient le niveau de risque choisi. Une étude de l'AMF portant sur 1987-2017 a constaté qu'un rééquilibrage annuel d'un portefeuille mixte actions et obligations avait donné de meilleurs résultats que l'absence de rééquilibrage.

## Pièges fréquents

- Se déclarer « dynamique » quand tout monte, et découvrir sa vraie tolérance pendant une crise.
- Raisonner placement par placement en oubliant l'ensemble : immobilier, épargne salariale et livrets comptent aussi dans l'équilibre.
- Confondre une baisse temporaire avec une perte définitive : la perte ne devient réelle que si l'on vend.
- Changer de profil après chaque mouvement de marché, ce qui revient souvent à vendre bas et racheter haut.

## Comment Boussole s'en sert

Le questionnaire de Boussole, inspiré de l'évaluation de l'adéquation MiFID, se remplit avec Claude. Il situe ton profil sur cinq niveaux : Prudent, Modéré, Équilibré, Dynamique et Offensif, avec une baisse tolérée sur un an allant de 5 % pour le premier à 40 % pour le dernier. Des garde-fous plafonnent le résultat : un horizon de moins de deux ans, ou l'absence de trois mois de dépenses mis de côté, limitent le profil à Modéré ; ne pas connaître les actions ni les ETF le limite à Équilibré. Boussole compare ensuite ton allocation réelle aux fourchettes indicatives de ton profil et estime une perte plausible sur un an, calculée de façon prudente à partir de la volatilité de tes classes d'actifs et de leurs pires baisses passées. Ces repères sont pédagogiques et ne constituent pas un conseil en investissement personnalisé.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'allocation-profil-de-risque' and contenu is distinct from $f$## L'idée clé

Le choix le plus déterminant pour un portefeuille n'est pas tel ou tel fonds, mais la répartition entre grandes familles d'actifs : supports garantis et monétaires, obligations, actions, immobilier et, à la marge, actifs spéculatifs. Cette répartition, appelée allocation, fixe à la fois le rendement que l'on peut espérer à long terme et l'ampleur des baisses qu'il faudra traverser en chemin.

## Les trois questions à te poser

- **Horizon** : quand auras-tu besoin de cet argent ? Une somme destinée à un projet proche n'a pas sa place sur les marchés d'actions, qui peuvent baisser juste avant l'échéance. L'AMF rappelle qu'un placement en actions, encore risqué sur 5 ans, l'est bien moins sur 15 ans.
- **Capacité à subir des pertes** : ta situation te permet-elle d'encaisser une baisse sans être obligé de vendre ? Sans épargne de précaution, le moindre imprévu peut forcer une vente au plus mauvais moment.
- **Tolérance au risque** : comment réagirais-tu, concrètement, devant une perte de 20 ou 30 % affichée sur ton relevé ? La réponse honnête compte davantage que la réponse idéale.

La réglementation européenne (MiFID II) impose aux professionnels qui conseillent de recueillir ces éléments : situation financière, objectifs, horizon, capacité à subir des pertes, connaissances et expérience. L'ESMA a détaillé ces exigences dans ses orientations sur l'évaluation de l'adéquation.

## Comment ça marche

Plus la part d'actions est élevée, plus le rendement espéré à long terme est élevé, et plus les baisses temporaires sont profondes. Les obligations et les supports garantis amortissent les chocs mais rapportent moins ; une épargne entièrement garantie risque même de perdre du pouvoir d'achat face à l'inflation sur longue période. Selon l'AMF, la part d'actions dépend du profil, de l'âge, de l'horizon et de la confiance dans l'avenir : un épargnant jeune qui prépare sa retraite peut en détenir une large part, à condition de n'y placer que de l'argent dont il n'aura pas besoin avant l'échéance.

Une allocation se décide une fois, puis s'entretient. Les mouvements de marché la déforment : un rééquilibrage périodique, qui consiste à alléger ce qui a le plus progressé pour revenir aux proportions visées, maintient le niveau de risque choisi. Une étude de l'AMF portant sur 1987-2017 a constaté qu'un rééquilibrage annuel d'un portefeuille mixte actions et obligations avait donné de meilleurs résultats que l'absence de rééquilibrage.

## Pièges fréquents

- Se déclarer « dynamique » quand tout monte, et découvrir sa vraie tolérance pendant une crise.
- Raisonner placement par placement en oubliant l'ensemble : immobilier, épargne salariale et livrets comptent aussi dans l'équilibre.
- Confondre une baisse temporaire avec une perte définitive : la perte ne devient réelle que si l'on vend.
- Changer de profil après chaque mouvement de marché, ce qui revient souvent à vendre bas et racheter haut.

## Comment Boussole s'en sert

Le questionnaire de Boussole, inspiré de l'évaluation de l'adéquation MiFID, se remplit avec Claude. Il situe ton profil sur cinq niveaux : Prudent, Modéré, Équilibré, Dynamique et Offensif, avec une baisse tolérée sur un an allant de 5 % pour le premier à 40 % pour le dernier. Des garde-fous plafonnent le résultat : un horizon de moins de deux ans, ou l'absence de trois mois de dépenses mis de côté, limitent le profil à Modéré ; ne pas connaître les actions ni les ETF le limite à Équilibré. Boussole compare ensuite ton allocation réelle aux fourchettes indicatives de ton profil et estime une perte plausible sur un an, calculée de façon prudente à partir de la volatilité de tes classes d'actifs et de leurs pires baisses passées. Ces repères sont pédagogiques et ne constituent pas un conseil en investissement personnalisé.$f$;

-- assurance-emprunteur
update public.savoir_fiches
   set titre = 'L''assurance emprunteur',
       resume = 'L''assurance qui rembourse tout ou partie d''un crédit immobilier en cas de décès ou d''incapacité. Depuis la loi Lemoine, tu peux en changer à tout moment, et le questionnaire de santé n''est plus exigé sous certaines conditions.',
       contenu = $f$## À quoi ça sert

L'assurance emprunteur prend en charge tout ou partie des mensualités, ou le capital restant dû, si l'emprunteur décède ou ne peut plus travailler à la suite d'une maladie ou d'un accident. Elle n'est pas obligatoire par la loi, mais les banques l'exigent presque toujours pour un crédit immobilier. Elle protège à la fois le prêteur et ta famille, qui n'aura pas à rembourser le prêt en cas de coup dur.

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

Boussole intègre la cotisation d'assurance dans tes mensualités de crédit, et donc dans le taux d'endettement comparé au plafond HCSF dans Pilotage › Rang. Si la cotisation manque, donne-la à Claude. Indicateur pédagogique, pas un conseil en assurance ni en investissement.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'assurance-emprunteur' and contenu is distinct from $f$## À quoi ça sert

L'assurance emprunteur prend en charge tout ou partie des mensualités, ou le capital restant dû, si l'emprunteur décède ou ne peut plus travailler à la suite d'une maladie ou d'un accident. Elle n'est pas obligatoire par la loi, mais les banques l'exigent presque toujours pour un crédit immobilier. Elle protège à la fois le prêteur et ta famille, qui n'aura pas à rembourser le prêt en cas de coup dur.

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

Boussole intègre la cotisation d'assurance dans tes mensualités de crédit, et donc dans le taux d'endettement comparé au plafond HCSF dans Pilotage › Rang. Si la cotisation manque, donne-la à Claude. Indicateur pédagogique, pas un conseil en assurance ni en investissement.$f$;

-- assurance-vie
update public.savoir_fiches
   set titre = 'L''assurance-vie',
       resume = 'Une enveloppe d''épargne polyvalente : fonds en euros garanti et unités de compte non garanties, fiscalité des gains allégée après 8 ans et cadre spécifique pour transmettre un capital aux bénéficiaires.',
       contenu = $f$## À quoi ça sert

Malgré son nom, l'assurance-vie est surtout un placement d'épargne. Elle sert à faire fructifier un capital à moyen ou long terme, à préparer des revenus complémentaires et à organiser une transmission. L'argent reste disponible : tu peux effectuer un retrait (on parle de rachat) à tout moment, l'ancienneté du contrat ne jouant que sur la fiscalité.

## Comment ça marche

Un contrat combine généralement deux types de supports :

- **Le fonds en euros** : le capital est garanti par l'assureur (selon les contrats, net ou brut de frais de gestion), les intérêts acquis le restent. Son rendement varie chaque année.
- **Les unités de compte** : fonds actions, obligations, immobiliers, etc. Leur valeur fluctue et n'est pas garantie ; ils offrent un potentiel de rendement plus élevé sur la durée, avec un risque de perte.

Le contrat prévoit des frais (sur versements, de gestion annuelle, d'arbitrage) qu'il vaut la peine de comparer, car ils s'accumulent sur de longues durées.

## La fiscalité des rachats

Seuls les **gains** contenus dans un rachat sont imposés, pas le capital versé. Pour les versements effectués depuis le 27 septembre 2017 :

- **Contrat de moins de 8 ans** : gains soumis au prélèvement forfaitaire de 12,8 % ou, sur option, au barème de l'impôt sur le revenu.
- **Contrat de plus de 8 ans** : un abattement annuel s'applique sur les gains (voir les repères Abattement annuel assurance-vie après 8 ans, personne seule et couple soumis à imposition commune). Au-delà, les gains sont imposés à 7,5 % tant que l'ensemble des primes versées sur tes contrats ne dépasse pas 150 000 €, puis à 12,8 % pour la fraction correspondant aux primes au-delà.
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

Boussole classe le fonds en euros à part dans la répartition de tes placements. À partir de la date d'ouverture de chaque contrat (donne-la à Claude ; tu la retrouves dans Compte › Données), le diagnostic indique quand le contrat atteindra 8 ans et signale un objectif financé par ce contrat dont l'échéance tombe avant : un retrait anticipé ne profiterait pas de l'abattement. Dans la vue par liquidité de Patrimoine, l'assurance-vie est considérée comme disponible en quelques semaines. Indicateur pédagogique, pas un conseil en investissement.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'assurance-vie' and contenu is distinct from $f$## À quoi ça sert

Malgré son nom, l'assurance-vie est surtout un placement d'épargne. Elle sert à faire fructifier un capital à moyen ou long terme, à préparer des revenus complémentaires et à organiser une transmission. L'argent reste disponible : tu peux effectuer un retrait (on parle de rachat) à tout moment, l'ancienneté du contrat ne jouant que sur la fiscalité.

## Comment ça marche

Un contrat combine généralement deux types de supports :

- **Le fonds en euros** : le capital est garanti par l'assureur (selon les contrats, net ou brut de frais de gestion), les intérêts acquis le restent. Son rendement varie chaque année.
- **Les unités de compte** : fonds actions, obligations, immobiliers, etc. Leur valeur fluctue et n'est pas garantie ; ils offrent un potentiel de rendement plus élevé sur la durée, avec un risque de perte.

Le contrat prévoit des frais (sur versements, de gestion annuelle, d'arbitrage) qu'il vaut la peine de comparer, car ils s'accumulent sur de longues durées.

## La fiscalité des rachats

Seuls les **gains** contenus dans un rachat sont imposés, pas le capital versé. Pour les versements effectués depuis le 27 septembre 2017 :

- **Contrat de moins de 8 ans** : gains soumis au prélèvement forfaitaire de 12,8 % ou, sur option, au barème de l'impôt sur le revenu.
- **Contrat de plus de 8 ans** : un abattement annuel s'applique sur les gains (voir les repères Abattement annuel assurance-vie après 8 ans, personne seule et couple soumis à imposition commune). Au-delà, les gains sont imposés à 7,5 % tant que l'ensemble des primes versées sur tes contrats ne dépasse pas 150 000 €, puis à 12,8 % pour la fraction correspondant aux primes au-delà.
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

Boussole classe le fonds en euros à part dans la répartition de tes placements. À partir de la date d'ouverture de chaque contrat (donne-la à Claude ; tu la retrouves dans Compte › Données), le diagnostic indique quand le contrat atteindra 8 ans et signale un objectif financé par ce contrat dont l'échéance tombe avant : un retrait anticipé ne profiterait pas de l'abattement. Dans la vue par liquidité de Patrimoine, l'assurance-vie est considérée comme disponible en quelques semaines. Indicateur pédagogique, pas un conseil en investissement.$f$;

-- biais-comportementaux
update public.savoir_fiches
   set titre = 'Les biais comportementaux de l''épargnant',
       resume = 'Tes décisions d''épargne sont influencées par des réflexes qui t''éloignent de tes objectifs : peur de la perte, imitation, statu quo, excès de confiance. Les connaître et te fixer des règles à l''avance sont les meilleurs remèdes.',
       contenu = $f$## L'idée clé

Les choix financiers ne sont pas seulement rationnels : ils sont influencés par des réflexes, appelés biais comportementaux, qui peuvent conduire à des décisions contraires à tes propres objectifs. L'AMF en recense huit dans un article pédagogique de juin 2022, et souligne que le meilleur moyen de les corriger est d'en avoir conscience. Leur effet varie d'une personne à l'autre.

## Les biais identifiés par l'AMF

- **Aversion à la perte** : une perte fait davantage souffrir qu'un gain de même montant ne réjouit. Conséquence fréquente : garder trop longtemps un placement perdant pour ne pas « acter » la perte, ou fuir tout placement fluctuant.
- **Préférence pour le présent** : un plaisir immédiat pèse plus qu'un bénéfice futur, ce qui retarde l'épargne pour la retraite.
- **Comportement moutonnier** : faire comme tout le monde, acheter ce qui est à la mode et vendre quand tout le monde vend.
- **Aversion à l'ambiguïté** : préférer un risque connu à un risque mal connu, au point de délaisser des placements simplement parce qu'on les comprend mal.
- **Biais de confirmation** : ne retenir que les informations qui confortent son avis.
- **Aversion au changement** : laisser les choses en l'état par défaut, même quand la situation a changé.
- **Surestimation des événements rares** : accorder trop de poids à un scénario spectaculaire mais improbable, dans un sens comme dans l'autre.
- **Aversion myope à la perte** : regarder ses placements trop souvent, ce qui multiplie les occasions de voir des baisses temporaires et pousse vers des placements trop prudents pour un horizon long.

S'y ajoutent deux réflexes souvent décrits en finance comportementale : l'**excès de confiance** (surestimer sa capacité à choisir les bons titres ou le bon moment) et l'**ancrage** (rester accroché à un prix de référence, comme son prix d'achat, qui n'a aucune importance pour l'avenir).

## Des garde-fous concrets

- **Écrire ses règles à l'avance** : allocation visée, fréquence de rééquilibrage, conditions dans lesquelles on vendrait. On les rédige à froid, on les applique à chaud.
- **Automatiser** : des versements programmés évitent d'avoir à décider chaque mois s'il faut investir.
- **Espacer la consultation** de ses placements de long terme, en particulier quand les marchés sont agités.
- **S'imposer un délai de réflexion** avant toute décision importante, et chercher activement l'argument contraire à son intuition.
- **Se méfier de l'urgence** : une offre qui presse de décider vite est un signal d'alerte, et souvent la marque d'une arnaque.
- **Prendre conscience de ses réactions** : l'AMF propose un questionnaire pédagogique pour mieux se connaître en tant qu'épargnant.

## Pièges fréquents

- Croire que l'on est moins sujet aux biais que les autres.
- Juger une décision à son résultat plutôt qu'à la qualité du raisonnement au moment où elle a été prise.
- Changer de stratégie après chaque mouvement de marché.

## Comment Boussole s'en sert

Boussole t'aide à décider à froid : questionnaire de profil de risque avec garde-fous, allocation cible, et règles d'alerte que tu fixes toi-même avec Claude (seuil d'une position, matelas de précaution…), dont les déclenchements apparaissent dans Aujourd'hui. Claude peut aussi mémoriser tes décisions et leurs raisons, pour te les rappeler quand le marché pousse à les remettre en cause.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'biais-comportementaux' and contenu is distinct from $f$## L'idée clé

Les choix financiers ne sont pas seulement rationnels : ils sont influencés par des réflexes, appelés biais comportementaux, qui peuvent conduire à des décisions contraires à tes propres objectifs. L'AMF en recense huit dans un article pédagogique de juin 2022, et souligne que le meilleur moyen de les corriger est d'en avoir conscience. Leur effet varie d'une personne à l'autre.

## Les biais identifiés par l'AMF

- **Aversion à la perte** : une perte fait davantage souffrir qu'un gain de même montant ne réjouit. Conséquence fréquente : garder trop longtemps un placement perdant pour ne pas « acter » la perte, ou fuir tout placement fluctuant.
- **Préférence pour le présent** : un plaisir immédiat pèse plus qu'un bénéfice futur, ce qui retarde l'épargne pour la retraite.
- **Comportement moutonnier** : faire comme tout le monde, acheter ce qui est à la mode et vendre quand tout le monde vend.
- **Aversion à l'ambiguïté** : préférer un risque connu à un risque mal connu, au point de délaisser des placements simplement parce qu'on les comprend mal.
- **Biais de confirmation** : ne retenir que les informations qui confortent son avis.
- **Aversion au changement** : laisser les choses en l'état par défaut, même quand la situation a changé.
- **Surestimation des événements rares** : accorder trop de poids à un scénario spectaculaire mais improbable, dans un sens comme dans l'autre.
- **Aversion myope à la perte** : regarder ses placements trop souvent, ce qui multiplie les occasions de voir des baisses temporaires et pousse vers des placements trop prudents pour un horizon long.

S'y ajoutent deux réflexes souvent décrits en finance comportementale : l'**excès de confiance** (surestimer sa capacité à choisir les bons titres ou le bon moment) et l'**ancrage** (rester accroché à un prix de référence, comme son prix d'achat, qui n'a aucune importance pour l'avenir).

## Des garde-fous concrets

- **Écrire ses règles à l'avance** : allocation visée, fréquence de rééquilibrage, conditions dans lesquelles on vendrait. On les rédige à froid, on les applique à chaud.
- **Automatiser** : des versements programmés évitent d'avoir à décider chaque mois s'il faut investir.
- **Espacer la consultation** de ses placements de long terme, en particulier quand les marchés sont agités.
- **S'imposer un délai de réflexion** avant toute décision importante, et chercher activement l'argument contraire à son intuition.
- **Se méfier de l'urgence** : une offre qui presse de décider vite est un signal d'alerte, et souvent la marque d'une arnaque.
- **Prendre conscience de ses réactions** : l'AMF propose un questionnaire pédagogique pour mieux se connaître en tant qu'épargnant.

## Pièges fréquents

- Croire que l'on est moins sujet aux biais que les autres.
- Juger une décision à son résultat plutôt qu'à la qualité du raisonnement au moment où elle a été prise.
- Changer de stratégie après chaque mouvement de marché.

## Comment Boussole s'en sert

Boussole t'aide à décider à froid : questionnaire de profil de risque avec garde-fous, allocation cible, et règles d'alerte que tu fixes toi-même avec Claude (seuil d'une position, matelas de précaution…), dont les déclenchements apparaissent dans Aujourd'hui. Claude peut aussi mémoriser tes décisions et leurs raisons, pour te les rappeler quand le marché pousse à les remettre en cause.$f$;

-- compte-titres-fiscalite
update public.savoir_fiches
   set titre = 'Le compte-titres et la fiscalité des revenus du capital',
       resume = 'Le compte-titres ordinaire n''a ni plafond ni avantage fiscal : dividendes, intérêts et plus-values sont soumis chaque année au prélèvement forfaitaire unique, ou sur option au barème de l''impôt sur le revenu.',
       contenu = $f$## À quoi ça sert

Le compte-titres ordinaire (CTO) permet de détenir tout type de titres : actions du monde entier, obligations, fonds, trackers. Il n'a ni plafond de versement ni durée minimale, et l'argent est disponible à tout moment. En contrepartie, il n'offre aucun avantage fiscal : les revenus et les gains sont imposés l'année où ils sont perçus ou réalisés. Il sert souvent de complément une fois les enveloppes avantagées (PEA, assurance-vie) utilisées, ou pour des titres qu'elles n'acceptent pas.

## Comment les revenus sont imposés

Depuis 2018, les revenus du capital relèvent par défaut du **prélèvement forfaitaire unique** (PFU), qui réunit une part d'impôt sur le revenu de 12,8 % et les prélèvements sociaux. Depuis le 1er janvier 2026, ces prélèvements sociaux sont passés de 17,2 % à 18,6 % pour la plupart des revenus du capital (voir le repère Prélèvement forfaitaire unique, taux global prélèvements sociaux inclus).

- **Dividendes et intérêts** : un acompte est prélevé à la source par l'établissement, puis régularisé lors de la déclaration. Les foyers sous un certain revenu fiscal de référence peuvent demander à en être dispensés.
- **Plus-values de cession** : calculées vente par vente (prix de vente moins prix d'acquisition moyen, frais compris) et déclarées l'année suivante.
- **Moins-values** : elles s'imputent sur les plus-values de même nature de l'année, puis l'excédent est reportable sur les dix années suivantes. Elles ne réduisent pas le revenu global.

## L'option pour le barème

Tu peux choisir, lors de la déclaration, d'imposer ces revenus au barème progressif plutôt qu'au taux forfaitaire. Cette option est **globale** : elle vaut pour l'ensemble de tes revenus du capital de l'année. Elle peut être intéressante pour un foyer faiblement imposé, car :

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

Boussole valorise les positions de ton compte-titres chaque soir. Son diagnostic repère les actions européennes logées en compte-titres alors qu'un PEA du même titulaire a encore de la place, puisque la fiscalité des gains y serait plus légère après 5 ans. Le taux du prélèvement forfaitaire affiché vient du repère daté, pas d'un chiffre figé. Indicateur pédagogique, pas un conseil en investissement.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'compte-titres-fiscalite' and contenu is distinct from $f$## À quoi ça sert

Le compte-titres ordinaire (CTO) permet de détenir tout type de titres : actions du monde entier, obligations, fonds, trackers. Il n'a ni plafond de versement ni durée minimale, et l'argent est disponible à tout moment. En contrepartie, il n'offre aucun avantage fiscal : les revenus et les gains sont imposés l'année où ils sont perçus ou réalisés. Il sert souvent de complément une fois les enveloppes avantagées (PEA, assurance-vie) utilisées, ou pour des titres qu'elles n'acceptent pas.

## Comment les revenus sont imposés

Depuis 2018, les revenus du capital relèvent par défaut du **prélèvement forfaitaire unique** (PFU), qui réunit une part d'impôt sur le revenu de 12,8 % et les prélèvements sociaux. Depuis le 1er janvier 2026, ces prélèvements sociaux sont passés de 17,2 % à 18,6 % pour la plupart des revenus du capital (voir le repère Prélèvement forfaitaire unique, taux global prélèvements sociaux inclus).

- **Dividendes et intérêts** : un acompte est prélevé à la source par l'établissement, puis régularisé lors de la déclaration. Les foyers sous un certain revenu fiscal de référence peuvent demander à en être dispensés.
- **Plus-values de cession** : calculées vente par vente (prix de vente moins prix d'acquisition moyen, frais compris) et déclarées l'année suivante.
- **Moins-values** : elles s'imputent sur les plus-values de même nature de l'année, puis l'excédent est reportable sur les dix années suivantes. Elles ne réduisent pas le revenu global.

## L'option pour le barème

Tu peux choisir, lors de la déclaration, d'imposer ces revenus au barème progressif plutôt qu'au taux forfaitaire. Cette option est **globale** : elle vaut pour l'ensemble de tes revenus du capital de l'année. Elle peut être intéressante pour un foyer faiblement imposé, car :

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

Boussole valorise les positions de ton compte-titres chaque soir. Son diagnostic repère les actions européennes logées en compte-titres alors qu'un PEA du même titulaire a encore de la place, puisque la fiscalité des gains y serait plus légère après 5 ans. Le taux du prélèvement forfaitaire affiché vient du repère daté, pas d'un chiffre figé. Indicateur pédagogique, pas un conseil en investissement.$f$;

-- crises-et-recuperation
update public.savoir_fiches
   set titre = 'Crises boursières et durée de récupération',
       resume = 'Des baisses de 30 à 60 % des actions se produisent plusieurs fois par génération, et leur rattrapage a pris de quelques mois à plus d''une décennie. Les dividendes, la diversification et le fait de ne pas vendre au plus bas changent fortement l''expérience de l''épargnant.',
       contenu = $f$## À quoi ça sert

Connaître les grandes crises passées aide à dimensionner la part d'actions que l'on peut détenir sans être tenté de tout vendre au plus bas. Attention à la nature des indices cités : un indice « de prix » ne compte que l'évolution des cours, alors qu'un indice « dividendes réinvestis » reflète mieux ce qu'a vécu un investisseur. Les chiffres ci-dessous sont arrondis et exprimés en monnaie locale, hors inflation sauf mention contraire.

## Quelques épisodes

- **1929-1932** : l'indice américain Dow Jones (cours seuls) a perdu 89 % entre le 3 septembre 1929 et le 8 juillet 1932, et n'a retrouvé son sommet de 1929 que le 23 novembre 1954, soit 25 ans plus tard. Avec les dividendes et la forte baisse des prix des années 1930, le rattrapage a été nettement plus court pour un investisseur, mais l'épisode reste la référence extrême.
- **1973-1974** : choc pétrolier et inflation forte. Le marché américain a perdu près de la moitié de sa valeur (cours seuls) entre début 1973 et fin 1974. Corrigé de l'inflation, très élevée à l'époque, le rattrapage a été beaucoup plus long.
- **2000-2003** : éclatement de la bulle internet. Le CAC 40 (cours seuls) a perdu environ 65 % entre son sommet de septembre 2000 et son plus bas de mars 2003, et n'a dépassé son record qu'en 2021. Dividendes réinvestis (CAC 40 GR), le niveau de septembre 2000 a été retrouvé dès 2007, puis à nouveau en 2014 après la rechute de 2008 ; après inflation, en juillet 2015 (AMF).
- **2007-2009** : crise financière mondiale. L'indice MSCI World (pays développés, en dollars, dividendes réinvestis) a reculé d'environ 57 % entre le 31 octobre 2007 et le 9 mars 2009 : c'est sa plus forte baisse depuis fin 1987.
- **2020** : pandémie. Les grands indices mondiaux ont perdu environ un tiers en cinq semaines, entre février et mars, puis ont retrouvé leur niveau d'avant-crise avant la fin de l'année.
- **2022** : retour de l'inflation et hausse rapide des taux. Le MSCI World a reculé de 17,7 % sur l'année (en dollars, dividendes réinvestis), et les obligations ont baissé en même temps que les actions, ce qui est inhabituel.

## Ce qu'il faut en retenir

- Une baisse de plus de 30 % n'est pas une anomalie : un épargnant en actions en traversera probablement plusieurs.
- La durée de rattrapage varie de quelques mois à plus de dix ans ; elle est plus courte dividendes réinvestis, et pour qui continue d'investir régulièrement pendant la baisse.
- La diversification compte : en 2000-2003, un portefeuille limité à quelques valeurs technologiques a souffert bien davantage qu'un portefeuille mondial et mixte.
- Les performances passées ne préjugent pas des performances futures, et la prochaine crise ne ressemblera pas forcément aux précédentes.

## Pièges fréquents

- Vendre au plus bas, ce qui transforme une perte latente en perte définitive.
- Devoir puiser dans ses actions en pleine crise faute d'épargne de précaution, ou parce que l'argent d'un projet proche y était placé.
- Juger sa performance sur un indice de prix comme le CAC 40 « nu », qui ignore les dividendes.

## Comment Boussole s'en sert

Pour estimer la perte plausible de ton portefeuille sur un an, Boussole s'appuie notamment sur les pires baisses historiques de chaque classe d'actifs, puis la compare à la baisse que ton profil tolère. En période de forte baisse, Claude peut te rappeler ces ordres de grandeur avant toute décision de vente.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'crises-et-recuperation' and contenu is distinct from $f$## À quoi ça sert

Connaître les grandes crises passées aide à dimensionner la part d'actions que l'on peut détenir sans être tenté de tout vendre au plus bas. Attention à la nature des indices cités : un indice « de prix » ne compte que l'évolution des cours, alors qu'un indice « dividendes réinvestis » reflète mieux ce qu'a vécu un investisseur. Les chiffres ci-dessous sont arrondis et exprimés en monnaie locale, hors inflation sauf mention contraire.

## Quelques épisodes

- **1929-1932** : l'indice américain Dow Jones (cours seuls) a perdu 89 % entre le 3 septembre 1929 et le 8 juillet 1932, et n'a retrouvé son sommet de 1929 que le 23 novembre 1954, soit 25 ans plus tard. Avec les dividendes et la forte baisse des prix des années 1930, le rattrapage a été nettement plus court pour un investisseur, mais l'épisode reste la référence extrême.
- **1973-1974** : choc pétrolier et inflation forte. Le marché américain a perdu près de la moitié de sa valeur (cours seuls) entre début 1973 et fin 1974. Corrigé de l'inflation, très élevée à l'époque, le rattrapage a été beaucoup plus long.
- **2000-2003** : éclatement de la bulle internet. Le CAC 40 (cours seuls) a perdu environ 65 % entre son sommet de septembre 2000 et son plus bas de mars 2003, et n'a dépassé son record qu'en 2021. Dividendes réinvestis (CAC 40 GR), le niveau de septembre 2000 a été retrouvé dès 2007, puis à nouveau en 2014 après la rechute de 2008 ; après inflation, en juillet 2015 (AMF).
- **2007-2009** : crise financière mondiale. L'indice MSCI World (pays développés, en dollars, dividendes réinvestis) a reculé d'environ 57 % entre le 31 octobre 2007 et le 9 mars 2009 : c'est sa plus forte baisse depuis fin 1987.
- **2020** : pandémie. Les grands indices mondiaux ont perdu environ un tiers en cinq semaines, entre février et mars, puis ont retrouvé leur niveau d'avant-crise avant la fin de l'année.
- **2022** : retour de l'inflation et hausse rapide des taux. Le MSCI World a reculé de 17,7 % sur l'année (en dollars, dividendes réinvestis), et les obligations ont baissé en même temps que les actions, ce qui est inhabituel.

## Ce qu'il faut en retenir

- Une baisse de plus de 30 % n'est pas une anomalie : un épargnant en actions en traversera probablement plusieurs.
- La durée de rattrapage varie de quelques mois à plus de dix ans ; elle est plus courte dividendes réinvestis, et pour qui continue d'investir régulièrement pendant la baisse.
- La diversification compte : en 2000-2003, un portefeuille limité à quelques valeurs technologiques a souffert bien davantage qu'un portefeuille mondial et mixte.
- Les performances passées ne préjugent pas des performances futures, et la prochaine crise ne ressemblera pas forcément aux précédentes.

## Pièges fréquents

- Vendre au plus bas, ce qui transforme une perte latente en perte définitive.
- Devoir puiser dans ses actions en pleine crise faute d'épargne de précaution, ou parce que l'argent d'un projet proche y était placé.
- Juger sa performance sur un indice de prix comme le CAC 40 « nu », qui ignore les dividendes.

## Comment Boussole s'en sert

Pour estimer la perte plausible de ton portefeuille sur un an, Boussole s'appuie notamment sur les pires baisses historiques de chaque classe d'actifs, puis la compare à la baisse que ton profil tolère. En période de forte baisse, Claude peut te rappeler ces ordres de grandeur avant toute décision de vente.$f$;

-- crypto-actifs
update public.savoir_fiches
   set titre = 'Les crypto-actifs',
       resume = 'Les crypto-actifs sont très volatils, ne sont pas une monnaie ayant cours légal et ne bénéficient d''aucune garantie des dépôts : une perte totale est possible. Depuis le 1er juillet 2026, seuls les prestataires agréés (PSCA) peuvent proposer ces services en France.',
       contenu = $f$## De quoi parle-t-on

Les crypto-actifs (bitcoin, ether, jetons, stablecoins…) sont des actifs numériques enregistrés sur une blockchain. Ce ne sont pas des monnaies au sens légal : en France, seul l'euro a cours légal. Ils ne bénéficient pas de la garantie d'une banque centrale, et le fonds de garantie des dépôts ne les couvre pas, même lorsqu'ils sont détenus chez un prestataire autorisé.

## Les risques rappelés par l'AMF

- **Volatilité extrême** : le cours du bitcoin a baissé d'environ 73 % entre novembre 2021 et décembre 2022. L'AMF souligne qu'on peut perdre l'argent investi en quelques jours, voire en quelques heures.
- **Perte totale possible** : perte de la clé privée, piratage, défaillance du prestataire ; la récupération peut alors être impossible.
- **Arnaques nombreuses** : contact non sollicité, promesse de rendement élevé garanti (cela n'existe pas), premier petit retrait accordé pour inspirer confiance, frais ou impôts fictifs réclamés pour débloquer les fonds, faux sauveteurs proposant ensuite de récupérer l'argent perdu, usurpation de l'identité de personnalités ou de médias. Ne communique jamais tes clés privées.
- **Effet de levier** : les CFD sur crypto-actifs proposés aux particuliers sont limités à un levier de 2, qui reste dangereux vu la volatilité du sous-jacent.
- **Protection limitée** : les autorités européennes de supervision (ABE, AEAPP, AEMF) ont rappelé en octobre 2025 que les crypto-actifs peuvent être risqués, que la protection juridique varie selon l'actif et peut être limitée, et appelé à la prudence face à la promotion par les influenceurs.

## Le cadre : PSAN, PSCA et MiCA

Le règlement européen MiCA encadre les prestataires de services sur crypto-actifs. La période de transition depuis l'ancien régime français des PSAN s'est achevée le 1er juillet 2026 : depuis, seuls les PSCA agréés peuvent fournir ces services en France. Vérifie la présence du prestataire sur la liste blanche de l'AMF, et que l'adresse du site correspond bien à celle de la liste ; un dossier « en cours » ne vaut pas agrément. Un PSCA agréé dans un autre pays de l'Union peut servir des clients français, mais le service client peut être dans une autre langue et le médiateur de l'AMF ne pas être compétent. Si ton prestataire n'est pas agréé, il doit t'informer : tu peux transférer tes actifs vers un PSCA, vers un portefeuille que tu contrôles, ou les convertir en euros, en comparant frais et délais.

L'agrément encadre le prestataire (organisation, sécurité, information), pas l'évolution des cours : il ne protège pas contre une baisse.

## Pièges fréquents

- Investir de l'argent dont on aura besoin, ou avant d'avoir constitué son épargne de précaution.
- Suivre des conseils diffusés sur les réseaux sociaux ou par des inconnus.
- Payer quelqu'un pour récupérer des fonds perdus : c'est presque toujours une seconde arnaque. En cas d'escroquerie, le recours principal est une plainte auprès de la police ou de la gendarmerie.

## Comment Boussole s'en sert

Boussole classe les crypto-actifs et les produits à effet de levier dans une « part spéculative », rapportée à ton épargne financière. Le repère est un plafond qui dépend de ton profil : 0 % pour Prudent, 2 % pour Modéré, 5 % pour Équilibré, 7 % pour Dynamique, 10 % pour Offensif, et 5 % par défaut sans profil déclaré. Ce plafond est un garde-fou pédagogique, pas une incitation à investir.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'crypto-actifs' and contenu is distinct from $f$## De quoi parle-t-on

Les crypto-actifs (bitcoin, ether, jetons, stablecoins…) sont des actifs numériques enregistrés sur une blockchain. Ce ne sont pas des monnaies au sens légal : en France, seul l'euro a cours légal. Ils ne bénéficient pas de la garantie d'une banque centrale, et le fonds de garantie des dépôts ne les couvre pas, même lorsqu'ils sont détenus chez un prestataire autorisé.

## Les risques rappelés par l'AMF

- **Volatilité extrême** : le cours du bitcoin a baissé d'environ 73 % entre novembre 2021 et décembre 2022. L'AMF souligne qu'on peut perdre l'argent investi en quelques jours, voire en quelques heures.
- **Perte totale possible** : perte de la clé privée, piratage, défaillance du prestataire ; la récupération peut alors être impossible.
- **Arnaques nombreuses** : contact non sollicité, promesse de rendement élevé garanti (cela n'existe pas), premier petit retrait accordé pour inspirer confiance, frais ou impôts fictifs réclamés pour débloquer les fonds, faux sauveteurs proposant ensuite de récupérer l'argent perdu, usurpation de l'identité de personnalités ou de médias. Ne communique jamais tes clés privées.
- **Effet de levier** : les CFD sur crypto-actifs proposés aux particuliers sont limités à un levier de 2, qui reste dangereux vu la volatilité du sous-jacent.
- **Protection limitée** : les autorités européennes de supervision (ABE, AEAPP, AEMF) ont rappelé en octobre 2025 que les crypto-actifs peuvent être risqués, que la protection juridique varie selon l'actif et peut être limitée, et appelé à la prudence face à la promotion par les influenceurs.

## Le cadre : PSAN, PSCA et MiCA

Le règlement européen MiCA encadre les prestataires de services sur crypto-actifs. La période de transition depuis l'ancien régime français des PSAN s'est achevée le 1er juillet 2026 : depuis, seuls les PSCA agréés peuvent fournir ces services en France. Vérifie la présence du prestataire sur la liste blanche de l'AMF, et que l'adresse du site correspond bien à celle de la liste ; un dossier « en cours » ne vaut pas agrément. Un PSCA agréé dans un autre pays de l'Union peut servir des clients français, mais le service client peut être dans une autre langue et le médiateur de l'AMF ne pas être compétent. Si ton prestataire n'est pas agréé, il doit t'informer : tu peux transférer tes actifs vers un PSCA, vers un portefeuille que tu contrôles, ou les convertir en euros, en comparant frais et délais.

L'agrément encadre le prestataire (organisation, sécurité, information), pas l'évolution des cours : il ne protège pas contre une baisse.

## Pièges fréquents

- Investir de l'argent dont on aura besoin, ou avant d'avoir constitué son épargne de précaution.
- Suivre des conseils diffusés sur les réseaux sociaux ou par des inconnus.
- Payer quelqu'un pour récupérer des fonds perdus : c'est presque toujours une seconde arnaque. En cas d'escroquerie, le recours principal est une plainte auprès de la police ou de la gendarmerie.

## Comment Boussole s'en sert

Boussole classe les crypto-actifs et les produits à effet de levier dans une « part spéculative », rapportée à ton épargne financière. Le repère est un plafond qui dépend de ton profil : 0 % pour Prudent, 2 % pour Modéré, 5 % pour Équilibré, 7 % pour Dynamique, 10 % pour Offensif, et 5 % par défaut sans profil déclaré. Ce plafond est un garde-fou pédagogique, pas une incitation à investir.$f$;

-- diversification
update public.savoir_fiches
   set titre = 'La diversification',
       resume = 'Diversifier, c''est associer des placements qui ne réagissent pas de la même façon aux mêmes événements, pour qu''un seul choc ne compromette pas ton épargne. Classes d''actifs, pays, secteurs, nombre de titres et étalement dans le temps en sont les leviers.',
       contenu = $f$## À quoi ça sert

Diversifier, c'est combiner des placements qui n'évoluent pas de la même façon au même moment. Le but n'est pas de supprimer le risque, mais d'éviter qu'un seul événement (la faillite d'une entreprise, la crise d'un secteur, la récession d'un pays, la chute d'une monnaie) emporte une grande part de ton épargne. Pour l'AMF, c'est aussi la condition pour viser, sur la durée, un rendement supérieur à celui de l'épargne sans risque tout en gardant ce risque sous contrôle.

## Les dimensions de la diversification

- **Classes d'actifs** : supports garantis, obligations, actions et immobilier ne montent ni ne baissent au même rythme.
- **Zones géographiques** : les économies ne traversent pas les mêmes cycles ; investir au-delà de son pays réduit la dépendance à une seule économie.
- **Secteurs** : technologie, santé, énergie, finance, consommation… un secteur entier peut connaître une décennie difficile.
- **Nombre de titres** : un fonds indiciel large détient des centaines, voire des milliers d'entreprises ; une poignée d'actions détenues en direct diversifie peu.
- **Temps** : investir régulièrement et conserver ses placements dans la durée étale les points d'entrée et laisse le temps aux baisses d'être compensées.
- **Monnaies** : détenir des actifs en dollars, en yens ou en livres ajoute un risque de change, qui peut jouer dans les deux sens.

## Ordres de grandeur

Un indice « monde » n'est pas pour autant réparti également entre les pays. Selon la fiche de l'indice MSCI World (pays développés) au 30 septembre 2026, les États-Unis représentaient environ 73 % de l'indice, la France environ 2 %, et les dix premières entreprises près de 28 %, en majorité issues du secteur technologique. Un placement « monde » reste donc très lié au marché américain et à quelques très grandes valeurs.

À l'inverse, les épargnants ont tendance à surpondérer leur propre pays : c'est le biais domestique. Un portefeuille composé uniquement d'actions françaises repose sur une économie qui pèse quelques pourcents de la capitalisation des pays développés.

## Pièges fréquents

- Multiplier les fonds qui détiennent les mêmes titres : plusieurs fonds de grandes valeurs américaines ne font pas une diversification.
- Surestimer la protection en pleine crise : lors des fortes baisses, la plupart des actifs risqués chutent ensemble ; seuls les supports réellement peu risqués amortissent alors le choc.
- Concentrer son épargne sur les actions de son employeur, ce qui cumule le risque sur l'emploi et le risque sur le patrimoine.
- Oublier l'immobilier : la résidence principale représente souvent l'essentiel du patrimoine et pèse dans l'équilibre d'ensemble.

## Comment Boussole s'en sert

Boussole note la diversification géographique de tes actions : le repère est qu'au moins la moitié d'entre elles soit investie sur le monde entier, au travers d'indices de type Monde ou tous pays. Il signale aussi la concentration sur une seule ligne, et affiche, à titre d'information sans note, la part de ton épargne financière exposée à une autre devise que l'euro. Donne à Claude la zone géographique de tes fonds : l'analyse sera plus précise.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'diversification' and contenu is distinct from $f$## À quoi ça sert

Diversifier, c'est combiner des placements qui n'évoluent pas de la même façon au même moment. Le but n'est pas de supprimer le risque, mais d'éviter qu'un seul événement (la faillite d'une entreprise, la crise d'un secteur, la récession d'un pays, la chute d'une monnaie) emporte une grande part de ton épargne. Pour l'AMF, c'est aussi la condition pour viser, sur la durée, un rendement supérieur à celui de l'épargne sans risque tout en gardant ce risque sous contrôle.

## Les dimensions de la diversification

- **Classes d'actifs** : supports garantis, obligations, actions et immobilier ne montent ni ne baissent au même rythme.
- **Zones géographiques** : les économies ne traversent pas les mêmes cycles ; investir au-delà de son pays réduit la dépendance à une seule économie.
- **Secteurs** : technologie, santé, énergie, finance, consommation… un secteur entier peut connaître une décennie difficile.
- **Nombre de titres** : un fonds indiciel large détient des centaines, voire des milliers d'entreprises ; une poignée d'actions détenues en direct diversifie peu.
- **Temps** : investir régulièrement et conserver ses placements dans la durée étale les points d'entrée et laisse le temps aux baisses d'être compensées.
- **Monnaies** : détenir des actifs en dollars, en yens ou en livres ajoute un risque de change, qui peut jouer dans les deux sens.

## Ordres de grandeur

Un indice « monde » n'est pas pour autant réparti également entre les pays. Selon la fiche de l'indice MSCI World (pays développés) au 30 septembre 2026, les États-Unis représentaient environ 73 % de l'indice, la France environ 2 %, et les dix premières entreprises près de 28 %, en majorité issues du secteur technologique. Un placement « monde » reste donc très lié au marché américain et à quelques très grandes valeurs.

À l'inverse, les épargnants ont tendance à surpondérer leur propre pays : c'est le biais domestique. Un portefeuille composé uniquement d'actions françaises repose sur une économie qui pèse quelques pourcents de la capitalisation des pays développés.

## Pièges fréquents

- Multiplier les fonds qui détiennent les mêmes titres : plusieurs fonds de grandes valeurs américaines ne font pas une diversification.
- Surestimer la protection en pleine crise : lors des fortes baisses, la plupart des actifs risqués chutent ensemble ; seuls les supports réellement peu risqués amortissent alors le choc.
- Concentrer son épargne sur les actions de son employeur, ce qui cumule le risque sur l'emploi et le risque sur le patrimoine.
- Oublier l'immobilier : la résidence principale représente souvent l'essentiel du patrimoine et pèse dans l'équilibre d'ensemble.

## Comment Boussole s'en sert

Boussole note la diversification géographique de tes actions : le repère est qu'au moins la moitié d'entre elles soit investie sur le monde entier, au travers d'indices de type Monde ou tous pays. Il signale aussi la concentration sur une seule ligne, et affiche, à titre d'information sans note, la part de ton épargne financière exposée à une autre devise que l'euro. Donne à Claude la zone géographique de tes fonds : l'analyse sera plus précise.$f$;

-- epargne-de-precaution
update public.savoir_fiches
   set titre = 'L''épargne de précaution',
       resume = 'Une réserve d''argent disponible immédiatement et sans risque de perte, pour faire face aux imprévus sans vendre tes placements au mauvais moment. On l''exprime en mois de dépenses.',
       contenu = $f$## À quoi ça sert

L'épargne de précaution est la somme que tu gardes de côté pour absorber un coup dur : une panne de voiture, une facture de santé, une période sans revenus, un déménagement imprévu. Son rôle n'est pas de rapporter, mais d'être là au bon moment. Sans elle, le moindre imprévu peut t'obliger à recourir à un crédit à la consommation ou à vendre des placements en actions alors que leur valeur est basse, ce qui transforme une baisse passagère en perte réelle.

C'est pour cette raison qu'elle vient avant tout autre projet d'investissement : tant qu'elle n'est pas constituée, prendre du risque ailleurs fragilise l'ensemble.

## Comment la calibrer

On l'exprime le plus souvent en **mois de dépenses courantes** (loyer ou mensualité, alimentation, énergie, transports, assurances), plutôt qu'en mois de revenus : c'est ce que tu dois continuer à payer quoi qu'il arrive.

- **3 mois** est un minimum raisonnable pour un salarié en poste stable, dans un foyer à deux revenus.
- **6 mois** conviennent mieux à un foyer à un seul revenu, avec des enfants, ou à un emploi moins sûr.
- **Davantage** (9 à 12 mois) se justifie pour un indépendant, un dirigeant ou une personne aux revenus irréguliers, ou à l'approche d'une grosse dépense connue (travaux, voiture).

Ces fourchettes sont des repères pédagogiques, pas des règles : ta situation (stabilité de l'emploi, aides possibles de l'entourage, couverture prévoyance) peut justifier plus ou moins.

## Où la placer

Trois critères comptent : **disponibilité immédiate**, **absence de risque de perte** et **simplicité**. Les livrets réglementés y répondent bien : ils sont garantis, sans frais et les intérêts sont exonérés d'impôt. Le Livret A et le LDDS sont ouverts à tous ; le LEP, mieux rémunéré, est réservé aux foyers sous un plafond de revenus (voir le repère Taux du LEP et le repère Taux du Livret A). Une petite partie peut rester sur le compte courant pour les dépenses du mois.

Les supports dont la valeur fluctue (actions, fonds, unités de compte) ou qui imposent un délai (plan bloqué, compte à terme) ne conviennent pas à cette réserve.

## Les pièges fréquents

- **La laisser grossir sans fin** : au-delà du besoin, l'argent placé sur un livret perd souvent du pouvoir d'achat sur le long terme. Le surplus peut servir d'autres objectifs.
- **La confondre avec l'épargne projet** : l'argent mis de côté pour un apport immobilier ou des travaux datés n'est pas une réserve d'urgence ; mieux vaut les suivre séparément.
- **Ne pas la reconstituer** après l'avoir utilisée : c'est la première chose à remettre à niveau.
- **Oublier les dépenses annuelles** (taxe foncière, assurances) dans le calcul des dépenses mensuelles.

## Comment Boussole s'en sert

Dans Patrimoine, Boussole calcule ton **matelas en mois de dépenses** : le montant de ta poche Épargne disponible divisé par tes dépenses mensuelles du budget, avec un repère de 3 à 6 mois. Le questionnaire de profil de risque reprend ce chiffre : tant que le matelas est inférieur à 3 mois, le profil est plafonné à Modéré, parce qu'un imprévu pourrait te forcer à vendre au plus bas. C'est un indicateur pédagogique, pas un conseil en investissement.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'epargne-de-precaution' and contenu is distinct from $f$## À quoi ça sert

L'épargne de précaution est la somme que tu gardes de côté pour absorber un coup dur : une panne de voiture, une facture de santé, une période sans revenus, un déménagement imprévu. Son rôle n'est pas de rapporter, mais d'être là au bon moment. Sans elle, le moindre imprévu peut t'obliger à recourir à un crédit à la consommation ou à vendre des placements en actions alors que leur valeur est basse, ce qui transforme une baisse passagère en perte réelle.

C'est pour cette raison qu'elle vient avant tout autre projet d'investissement : tant qu'elle n'est pas constituée, prendre du risque ailleurs fragilise l'ensemble.

## Comment la calibrer

On l'exprime le plus souvent en **mois de dépenses courantes** (loyer ou mensualité, alimentation, énergie, transports, assurances), plutôt qu'en mois de revenus : c'est ce que tu dois continuer à payer quoi qu'il arrive.

- **3 mois** est un minimum raisonnable pour un salarié en poste stable, dans un foyer à deux revenus.
- **6 mois** conviennent mieux à un foyer à un seul revenu, avec des enfants, ou à un emploi moins sûr.
- **Davantage** (9 à 12 mois) se justifie pour un indépendant, un dirigeant ou une personne aux revenus irréguliers, ou à l'approche d'une grosse dépense connue (travaux, voiture).

Ces fourchettes sont des repères pédagogiques, pas des règles : ta situation (stabilité de l'emploi, aides possibles de l'entourage, couverture prévoyance) peut justifier plus ou moins.

## Où la placer

Trois critères comptent : **disponibilité immédiate**, **absence de risque de perte** et **simplicité**. Les livrets réglementés y répondent bien : ils sont garantis, sans frais et les intérêts sont exonérés d'impôt. Le Livret A et le LDDS sont ouverts à tous ; le LEP, mieux rémunéré, est réservé aux foyers sous un plafond de revenus (voir le repère Taux du LEP et le repère Taux du Livret A). Une petite partie peut rester sur le compte courant pour les dépenses du mois.

Les supports dont la valeur fluctue (actions, fonds, unités de compte) ou qui imposent un délai (plan bloqué, compte à terme) ne conviennent pas à cette réserve.

## Les pièges fréquents

- **La laisser grossir sans fin** : au-delà du besoin, l'argent placé sur un livret perd souvent du pouvoir d'achat sur le long terme. Le surplus peut servir d'autres objectifs.
- **La confondre avec l'épargne projet** : l'argent mis de côté pour un apport immobilier ou des travaux datés n'est pas une réserve d'urgence ; mieux vaut les suivre séparément.
- **Ne pas la reconstituer** après l'avoir utilisée : c'est la première chose à remettre à niveau.
- **Oublier les dépenses annuelles** (taxe foncière, assurances) dans le calcul des dépenses mensuelles.

## Comment Boussole s'en sert

Dans Patrimoine, Boussole calcule ton **matelas en mois de dépenses** : le montant de ta poche Épargne disponible divisé par tes dépenses mensuelles du budget, avec un repère de 3 à 6 mois. Le questionnaire de profil de risque reprend ce chiffre : tant que le matelas est inférieur à 3 mois, le profil est plafonné à Modéré, parce qu'un imprévu pourrait te forcer à vendre au plus bas. C'est un indicateur pédagogique, pas un conseil en investissement.$f$;

-- frais-et-ter
update public.savoir_fiches
   set titre = 'Les frais des placements et le TER',
       resume = 'Les frais sont prélevés chaque année, que le placement gagne ou perde, et leur effet se cumule. Le TER (frais courants) d''un fonds figure dans son document d''informations clés ; il ne dit pas tout, mais c''est le premier chiffre à regarder.',
       contenu = $f$## Pourquoi c'est important

Les frais sont l'une des rares composantes du rendement que tu maîtrises. Ils sont prélevés chaque année, que le placement progresse ou recule, et leur effet se cumule. Un calcul simple le montre : un point de frais annuels supplémentaire réduit le capital final d'environ 17 à 18 % au bout de 20 ans, à performance de marché identique.

## Les différents frais

- **Frais courants (TER)** : frais de gestion et de fonctionnement d'un fonds, exprimés en pourcentage par an. Ils sont déduits directement de la valeur des parts : tu ne les vois pas passer, mais ils réduisent la performance. Ils figurent dans le document d'informations clés (DIC) du fonds.
- **Frais d'entrée et de sortie** : prélevés à l'achat ou à la vente des parts de certains fonds.
- **Commissions de surperformance** : prélevées quand le fonds dépasse un objectif ; elles ne sont pas incluses dans les frais courants.
- **Frais de transaction** : supportés à l'intérieur du fonds quand il achète et vend des titres, et, pour toi, le courtage sur chaque ordre passé.
- **Frais de l'enveloppe** : frais de gestion annuels d'un contrat d'assurance-vie ou d'un PER, frais sur versements, droits de garde ou de tenue de compte.
- **Frais de change** : lors de l'achat d'un titre coté dans une autre devise.

## Ordres de grandeur

Selon l'AMF (avril 2026), les frais courants moyens des fonds d'actions françaises sont passés de 2,3 % par an en 2010 à 1,3 % en 2025, et ceux des fonds diversifiés de 2,1 % à 1,3 %. Pour un ordre de bourse de 1 000 € en janvier 2026, le courtage moyen relevé par l'AMF était de 0,65 % dans les banques de réseau, 0,45 % chez les courtiers en ligne historiques et 0,15 % chez les néo-courtiers. Les fonds indiciels cotés les plus larges affichent en général des frais courants de quelques dixièmes de point par an.

Une étude de l'AMF sur la période 1987-2017 illustre l'écart entre rendement affiché et rendement perçu : pour des placements de 10 ans en actions françaises dividendes réinvestis, le rendement réel annualisé moyen était de 5,6 % avant frais et fiscalité, contre 2,7 % une fois les frais et les impôts déduits.

## Pièges fréquents

- Comparer des performances passées sans vérifier si elles sont nettes de tous les frais.
- Oublier les commissions de surperformance, absentes du TER.
- Empiler les couches : un fonds de fonds, logé dans un contrat qui prélève ses propres frais, cumule plusieurs étages de frais.
- Passer de petits ordres fréquents soumis à un courtage minimum fixe, qui pèse lourd en pourcentage.
- Choisir un fonds sur un seul critère de frais en ignorant ce qu'il détient : un fonds peu coûteux mais très concentré reste risqué.

## Comment Boussole s'en sert

Boussole calcule le TER moyen de tes lignes cotées, pondéré par les montants. Le repère est de 0,3 % par an ou moins ; la note diminue progressivement jusqu'à s'annuler vers 2 %. Pour chaque fonds, donne à Claude le TER lu dans son DIC, avec la source consultée. Tant que moins de la moitié des montants cotés ont un TER connu, le critère est signalé comme incomplet plutôt que noté.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'frais-et-ter' and contenu is distinct from $f$## Pourquoi c'est important

Les frais sont l'une des rares composantes du rendement que tu maîtrises. Ils sont prélevés chaque année, que le placement progresse ou recule, et leur effet se cumule. Un calcul simple le montre : un point de frais annuels supplémentaire réduit le capital final d'environ 17 à 18 % au bout de 20 ans, à performance de marché identique.

## Les différents frais

- **Frais courants (TER)** : frais de gestion et de fonctionnement d'un fonds, exprimés en pourcentage par an. Ils sont déduits directement de la valeur des parts : tu ne les vois pas passer, mais ils réduisent la performance. Ils figurent dans le document d'informations clés (DIC) du fonds.
- **Frais d'entrée et de sortie** : prélevés à l'achat ou à la vente des parts de certains fonds.
- **Commissions de surperformance** : prélevées quand le fonds dépasse un objectif ; elles ne sont pas incluses dans les frais courants.
- **Frais de transaction** : supportés à l'intérieur du fonds quand il achète et vend des titres, et, pour toi, le courtage sur chaque ordre passé.
- **Frais de l'enveloppe** : frais de gestion annuels d'un contrat d'assurance-vie ou d'un PER, frais sur versements, droits de garde ou de tenue de compte.
- **Frais de change** : lors de l'achat d'un titre coté dans une autre devise.

## Ordres de grandeur

Selon l'AMF (avril 2026), les frais courants moyens des fonds d'actions françaises sont passés de 2,3 % par an en 2010 à 1,3 % en 2025, et ceux des fonds diversifiés de 2,1 % à 1,3 %. Pour un ordre de bourse de 1 000 € en janvier 2026, le courtage moyen relevé par l'AMF était de 0,65 % dans les banques de réseau, 0,45 % chez les courtiers en ligne historiques et 0,15 % chez les néo-courtiers. Les fonds indiciels cotés les plus larges affichent en général des frais courants de quelques dixièmes de point par an.

Une étude de l'AMF sur la période 1987-2017 illustre l'écart entre rendement affiché et rendement perçu : pour des placements de 10 ans en actions françaises dividendes réinvestis, le rendement réel annualisé moyen était de 5,6 % avant frais et fiscalité, contre 2,7 % une fois les frais et les impôts déduits.

## Pièges fréquents

- Comparer des performances passées sans vérifier si elles sont nettes de tous les frais.
- Oublier les commissions de surperformance, absentes du TER.
- Empiler les couches : un fonds de fonds, logé dans un contrat qui prélève ses propres frais, cumule plusieurs étages de frais.
- Passer de petits ordres fréquents soumis à un courtage minimum fixe, qui pèse lourd en pourcentage.
- Choisir un fonds sur un seul critère de frais en ignorant ce qu'il détient : un fonds peu coûteux mais très concentré reste risqué.

## Comment Boussole s'en sert

Boussole calcule le TER moyen de tes lignes cotées, pondéré par les montants. Le repère est de 0,3 % par an ou moins ; la note diminue progressivement jusqu'à s'annuler vers 2 %. Pour chaque fonds, donne à Claude le TER lu dans son DIC, avec la source consultée. Tant que moins de la moitié des montants cotés ont un TER connu, le critère est signalé comme incomplet plutôt que noté.$f$;

-- investissement-programme
update public.savoir_fiches
   set titre = 'L''investissement programmé',
       resume = 'Investir un montant fixe à intervalles réguliers lisse le prix d''achat moyen et retire la question du « bon moment ». Cela réduit le risque d''entrer juste avant une baisse, sans supprimer le risque de perte en capital.',
       contenu = $f$## L'idée clé

L'investissement programmé consiste à placer un montant fixe à intervalles réguliers, souvent chaque mois, sur le même support, quel que soit le niveau du marché ce jour-là. On parle de versements programmés sur un contrat d'assurance-vie ou un PER, et de plan d'investissement programmé sur un PEA ou un compte-titres. Parmi ses conseils pour bien investir, l'AMF invite à épargner régulièrement, à respecter ses choix initiaux et à ne pas chercher un gain rapide en jouant sur les fluctuations de court terme.

## Comment ça marche

Avec un montant constant, tu acquiers mécaniquement plus de parts quand le prix est bas et moins quand il est haut. Exemple : 100 € investis trois mois de suite à des prix de 10 €, 8 € puis 12 € donnent 10, 12,5 puis environ 8,3 parts, soit environ 30,8 parts pour 300 €. Le prix de revient moyen ressort à environ 9,73 €, un peu sous la moyenne des trois prix (10 €).

Surtout, la méthode supprime la décision la plus difficile : choisir le moment d'entrer. Elle transforme l'investissement en habitude, ce qui protège contre les réflexes coûteux, comme tout suspendre après une baisse ou tout investir après une forte hausse.

## Ce que montre l'histoire

- **Si tu épargnes sur tes revenus**, investir chaque mois est simplement la façon naturelle de placer l'argent au fur et à mesure qu'il arrive.
- **Si tu disposes déjà d'une somme**, la question est différente. Les marchés d'actions ayant plus souvent monté que baissé sur longue période, investir d'un coup a historiquement abouti plus souvent à un meilleur résultat final qu'un étalement. L'étalement réduit en revanche le risque d'entrer juste avant une chute, et le regret qui l'accompagne : c'est un choix de confort et de discipline autant que de rendement.
- **L'AMF**, dans son étude sur la performance comparée des stratégies d'épargne entre 1987 et 2017, montre que le résultat d'un placement unique dépend fortement des dates d'entrée et de sortie, et qu'un portefeuille mixte rééquilibré chaque année a fait mieux que sans rééquilibrage, aussi bien avec des versements réguliers qu'avec un investissement unique.

## Pièges fréquents

- Interrompre les versements pendant une crise, alors que c'est le moment où chaque euro achète le plus de parts.
- Croire que l'étalement garantit un gain : il lisse le prix d'achat, pas le risque de perte en capital du support.
- Programmer de petits montants sur un support où chaque versement ou chaque ordre supporte des frais fixes.
- Appliquer la méthode à un actif très spéculatif en pensant le rendre sûr.
- Commencer avant d'avoir constitué son épargne de précaution.

## Comment Boussole s'en sert

Dans Patrimoine › Objectifs, Boussole calcule, pour chacun de tes objectifs (tu les ajoutes avec Claude), le versement mensuel nécessaire pour l'atteindre à la date voulue, et le met en regard de ta capacité d'épargne. Ce montant peut servir de base à des versements programmés. La règle des deux ans s'applique : l'argent destiné à un projet à moins de deux ans reste disponible et peu risqué. Boussole ne passe aucun ordre à ta place.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'investissement-programme' and contenu is distinct from $f$## L'idée clé

L'investissement programmé consiste à placer un montant fixe à intervalles réguliers, souvent chaque mois, sur le même support, quel que soit le niveau du marché ce jour-là. On parle de versements programmés sur un contrat d'assurance-vie ou un PER, et de plan d'investissement programmé sur un PEA ou un compte-titres. Parmi ses conseils pour bien investir, l'AMF invite à épargner régulièrement, à respecter ses choix initiaux et à ne pas chercher un gain rapide en jouant sur les fluctuations de court terme.

## Comment ça marche

Avec un montant constant, tu acquiers mécaniquement plus de parts quand le prix est bas et moins quand il est haut. Exemple : 100 € investis trois mois de suite à des prix de 10 €, 8 € puis 12 € donnent 10, 12,5 puis environ 8,3 parts, soit environ 30,8 parts pour 300 €. Le prix de revient moyen ressort à environ 9,73 €, un peu sous la moyenne des trois prix (10 €).

Surtout, la méthode supprime la décision la plus difficile : choisir le moment d'entrer. Elle transforme l'investissement en habitude, ce qui protège contre les réflexes coûteux, comme tout suspendre après une baisse ou tout investir après une forte hausse.

## Ce que montre l'histoire

- **Si tu épargnes sur tes revenus**, investir chaque mois est simplement la façon naturelle de placer l'argent au fur et à mesure qu'il arrive.
- **Si tu disposes déjà d'une somme**, la question est différente. Les marchés d'actions ayant plus souvent monté que baissé sur longue période, investir d'un coup a historiquement abouti plus souvent à un meilleur résultat final qu'un étalement. L'étalement réduit en revanche le risque d'entrer juste avant une chute, et le regret qui l'accompagne : c'est un choix de confort et de discipline autant que de rendement.
- **L'AMF**, dans son étude sur la performance comparée des stratégies d'épargne entre 1987 et 2017, montre que le résultat d'un placement unique dépend fortement des dates d'entrée et de sortie, et qu'un portefeuille mixte rééquilibré chaque année a fait mieux que sans rééquilibrage, aussi bien avec des versements réguliers qu'avec un investissement unique.

## Pièges fréquents

- Interrompre les versements pendant une crise, alors que c'est le moment où chaque euro achète le plus de parts.
- Croire que l'étalement garantit un gain : il lisse le prix d'achat, pas le risque de perte en capital du support.
- Programmer de petits montants sur un support où chaque versement ou chaque ordre supporte des frais fixes.
- Appliquer la méthode à un actif très spéculatif en pensant le rendre sûr.
- Commencer avant d'avoir constitué son épargne de précaution.

## Comment Boussole s'en sert

Dans Patrimoine › Objectifs, Boussole calcule, pour chacun de tes objectifs (tu les ajoutes avec Claude), le versement mensuel nécessaire pour l'atteindre à la date voulue, et le met en regard de ta capacité d'épargne. Ce montant peut servir de base à des versements programmés. La règle des deux ans s'applique : l'argent destiné à un projet à moins de deux ans reste disponible et peu risqué. Boussole ne passe aucun ordre à ta place.$f$;

-- livrets-reglementes
update public.savoir_fiches
   set titre = 'Les livrets réglementés : Livret A, LDDS, LEP',
       resume = 'Trois livrets garantis par l''État, sans frais et défiscalisés, dont le taux et le plafond sont fixés par les pouvoirs publics. Le LEP est le mieux rémunéré mais réservé aux revenus modestes.',
       contenu = $f$## À quoi ça sert

Les livrets réglementés sont des comptes d'épargne dont les règles (taux, plafond, fiscalité) sont fixées par l'État et identiques dans tous les établissements. Ils servent d'abord à loger l'épargne de précaution et l'épargne de court terme : l'argent reste disponible à tout moment, sans risque de perte en capital, et les intérêts sont exonérés d'impôt sur le revenu et de prélèvements sociaux.

## Comment ça marche

- **Livret A** : ouvert à toute personne, un seul par personne. Les versements sont limités par un plafond (voir le repère Plafond du Livret A) ; les intérêts capitalisés peuvent le dépasser, mais tu ne peux plus verser une fois le plafond atteint.
- **LDDS** (livret de développement durable et solidaire) : réservé aux majeurs domiciliés fiscalement en France, un par contribuable (un par époux ou partenaire de Pacs). Son taux est aligné sur celui du Livret A ; son plafond est plus bas (voir le repère Plafond du LDDS).
- **LEP** (livret d'épargne populaire) : accessible aux foyers dont le revenu fiscal de référence ne dépasse pas un seuil qui dépend du nombre de parts. Sa rémunération est la plus élevée des trois (voir le repère Taux du LEP) et son plafond est intermédiaire (voir le repère Plafond du LEP). La banque vérifie chaque année que tu restes éligible.

Les intérêts sont calculés par **quinzaine** : un versement commence à rapporter à partir de la quinzaine suivante, un retrait cesse de rapporter dès le début de la quinzaine en cours. Ils sont crédités une fois par an, au 31 décembre.

## Les chiffres clés

Le taux du Livret A est révisé deux fois par an (1er février et 1er août) à partir d'une formule qui combine l'inflation et les taux courts du marché monétaire, le gouvernement pouvant s'en écarter (voir le repère Taux du Livret A). Le LEP suit une formule propre, au moins égale au taux du Livret A. Ces taux bougent : Boussole les affiche depuis ses repères datés plutôt que de les figer dans cette fiche.

## Les pièges fréquents

- **Regarder le taux nominal sans l'inflation** : quand l'inflation dépasse le taux du livret, ton épargne perd du pouvoir d'achat, même si son montant augmente.
- **Négliger le LEP** : beaucoup de foyers éligibles n'en ont pas ouvert. Comme il rapporte davantage, il est logique de le remplir en premier si tu y as droit.
- **Ouvrir un second Livret A ou un second LDDS** : c'est interdit, et les établissements vérifient la détention de livrets auprès de l'administration fiscale avant toute ouverture.
- **Y laisser une épargne de long terme** : pour un horizon de plus de huit à dix ans, d'autres supports ont historiquement mieux protégé le pouvoir d'achat, avec en contrepartie un risque de fluctuation.

## Comment Boussole s'en sert

Boussole range tes livrets dans la poche Épargne, qui alimente le calcul du matelas de précaution en mois de dépenses. Le diagnostic signale aussi l'« argent dormant » : au-delà de 12 mois de dépenses sur livrets et monétaire, hors projets à moins de deux ans, une partie de cette épargne pourrait servir un objectif plus lointain. Le taux du Livret A affiché vient du repère daté correspondant. Indicateur pédagogique, pas un conseil en investissement.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'livrets-reglementes' and contenu is distinct from $f$## À quoi ça sert

Les livrets réglementés sont des comptes d'épargne dont les règles (taux, plafond, fiscalité) sont fixées par l'État et identiques dans tous les établissements. Ils servent d'abord à loger l'épargne de précaution et l'épargne de court terme : l'argent reste disponible à tout moment, sans risque de perte en capital, et les intérêts sont exonérés d'impôt sur le revenu et de prélèvements sociaux.

## Comment ça marche

- **Livret A** : ouvert à toute personne, un seul par personne. Les versements sont limités par un plafond (voir le repère Plafond du Livret A) ; les intérêts capitalisés peuvent le dépasser, mais tu ne peux plus verser une fois le plafond atteint.
- **LDDS** (livret de développement durable et solidaire) : réservé aux majeurs domiciliés fiscalement en France, un par contribuable (un par époux ou partenaire de Pacs). Son taux est aligné sur celui du Livret A ; son plafond est plus bas (voir le repère Plafond du LDDS).
- **LEP** (livret d'épargne populaire) : accessible aux foyers dont le revenu fiscal de référence ne dépasse pas un seuil qui dépend du nombre de parts. Sa rémunération est la plus élevée des trois (voir le repère Taux du LEP) et son plafond est intermédiaire (voir le repère Plafond du LEP). La banque vérifie chaque année que tu restes éligible.

Les intérêts sont calculés par **quinzaine** : un versement commence à rapporter à partir de la quinzaine suivante, un retrait cesse de rapporter dès le début de la quinzaine en cours. Ils sont crédités une fois par an, au 31 décembre.

## Les chiffres clés

Le taux du Livret A est révisé deux fois par an (1er février et 1er août) à partir d'une formule qui combine l'inflation et les taux courts du marché monétaire, le gouvernement pouvant s'en écarter (voir le repère Taux du Livret A). Le LEP suit une formule propre, au moins égale au taux du Livret A. Ces taux bougent : Boussole les affiche depuis ses repères datés plutôt que de les figer dans cette fiche.

## Les pièges fréquents

- **Regarder le taux nominal sans l'inflation** : quand l'inflation dépasse le taux du livret, ton épargne perd du pouvoir d'achat, même si son montant augmente.
- **Négliger le LEP** : beaucoup de foyers éligibles n'en ont pas ouvert. Comme il rapporte davantage, il est logique de le remplir en premier si tu y as droit.
- **Ouvrir un second Livret A ou un second LDDS** : c'est interdit, et les établissements vérifient la détention de livrets auprès de l'administration fiscale avant toute ouverture.
- **Y laisser une épargne de long terme** : pour un horizon de plus de huit à dix ans, d'autres supports ont historiquement mieux protégé le pouvoir d'achat, avec en contrepartie un risque de fluctuation.

## Comment Boussole s'en sert

Boussole range tes livrets dans la poche Épargne, qui alimente le calcul du matelas de précaution en mois de dépenses. Le diagnostic signale aussi l'« argent dormant » : au-delà de 12 mois de dépenses sur livrets et monétaire, hors projets à moins de deux ans, une partie de cette épargne pourrait servir un objectif plus lointain. Le taux du Livret A affiché vient du repère daté correspondant. Indicateur pédagogique, pas un conseil en investissement.$f$;

-- ordre-de-priorite-epargne
update public.savoir_fiches
   set titre = 'Dans quel ordre épargner ?',
       resume = 'Une méthode simple pour hiérarchiser : rembourser les dettes chères, constituer la réserve de précaution, financer les projets datés, puis investir à long terme selon l''horizon et le profil de risque.',
       contenu = $f$## À quoi ça sert

Quand on commence à épargner, la question n'est pas seulement « quel placement ? » mais « dans quel ordre ? ». Chaque euro ne peut servir qu'à un objectif à la fois, et certains objectifs protègent tous les autres. Cette fiche propose une hiérarchie générale, à adapter à ta situation : elle relève de la méthode, pas d'un conseil personnalisé.

## Les étapes, dans l'ordre

1. **Solder les dettes coûteuses.** Un crédit renouvelable ou un découvert permanent coûte presque toujours plus cher que ce qu'un placement peut rapporter sans risque. Les rembourser est un rendement certain. Le crédit immobilier, à taux plus faible et souvent assuré, relève d'une autre logique.
2. **Constituer l'épargne de précaution.** Quelques mois de dépenses sur des supports disponibles et garantis (voir la fiche « L'épargne de précaution »). C'est le socle qui évite de devoir vendre au mauvais moment.
3. **Profiter des dispositifs les plus avantageux.** Si tu y as droit, le LEP rapporte plus que les autres livrets (voir le repère Taux du LEP). Si ton employeur abonde un plan d'épargne salariale, ne pas verser au moins le montant qui déclenche l'abondement revient à renoncer à une partie de ta rémunération.
4. **Financer les projets datés.** Apport immobilier, voiture, études : pour un horizon de moins de cinq ans environ, la sécurité prime sur le rendement, car il n'y aura pas le temps de récupérer d'une baisse.
5. **Investir pour le long terme.** Pour un horizon de huit ans et plus, une part en actions largement diversifiées devient envisageable, dans des enveloppes fiscalement adaptées (PEA, assurance-vie, PER selon l'objectif). La part de risque dépend de ton profil et de ton horizon.

## Choisir l'enveloppe pour le long terme

- **PEA** : pour les actions européennes, gains exonérés d'impôt sur le revenu après 5 ans (voir la fiche « Le PEA »).
- **Assurance-vie** : enveloppe polyvalente, fiscalité allégée après 8 ans et atouts pour la transmission.
- **PER** : pour la retraite, surtout intéressant si ton taux marginal d'imposition est élevé, mais l'argent est en principe bloqué jusqu'à la retraite.
- **Compte-titres** : sans plafond ni avantage fiscal, utile une fois les autres enveloppes utilisées.

## Les pièges fréquents

- **Investir avant d'avoir une réserve** : la première baisse des marchés coïncide parfois avec un imprévu personnel.
- **Tout garder sur des livrets** par prudence, alors que l'horizon est très long : l'inflation grignote le pouvoir d'achat.
- **Choisir une enveloppe pour sa seule fiscalité**, sans regarder les frais, la disponibilité ou l'horizon.
- **Oublier de revoir l'ordre** quand la situation change (naissance, changement d'emploi, achat immobilier).

## Comment Boussole s'en sert

Boussole compare ton matelas en mois de dépenses au repère de 3 à 6 mois et plafonne le profil de risque tant que la réserve est insuffisante. Son diagnostic signale ensuite l'argent qui dort sur les livrets au-delà d'un an de dépenses et vérifie que les enveloppes sont utilisées dans un ordre cohérent (PEA avant compte-titres pour les actions européennes, ancienneté des contrats d'assurance-vie, PER rapproché de ta tranche d'imposition). Indicateur pédagogique, pas un conseil en investissement.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'ordre-de-priorite-epargne' and contenu is distinct from $f$## À quoi ça sert

Quand on commence à épargner, la question n'est pas seulement « quel placement ? » mais « dans quel ordre ? ». Chaque euro ne peut servir qu'à un objectif à la fois, et certains objectifs protègent tous les autres. Cette fiche propose une hiérarchie générale, à adapter à ta situation : elle relève de la méthode, pas d'un conseil personnalisé.

## Les étapes, dans l'ordre

1. **Solder les dettes coûteuses.** Un crédit renouvelable ou un découvert permanent coûte presque toujours plus cher que ce qu'un placement peut rapporter sans risque. Les rembourser est un rendement certain. Le crédit immobilier, à taux plus faible et souvent assuré, relève d'une autre logique.
2. **Constituer l'épargne de précaution.** Quelques mois de dépenses sur des supports disponibles et garantis (voir la fiche « L'épargne de précaution »). C'est le socle qui évite de devoir vendre au mauvais moment.
3. **Profiter des dispositifs les plus avantageux.** Si tu y as droit, le LEP rapporte plus que les autres livrets (voir le repère Taux du LEP). Si ton employeur abonde un plan d'épargne salariale, ne pas verser au moins le montant qui déclenche l'abondement revient à renoncer à une partie de ta rémunération.
4. **Financer les projets datés.** Apport immobilier, voiture, études : pour un horizon de moins de cinq ans environ, la sécurité prime sur le rendement, car il n'y aura pas le temps de récupérer d'une baisse.
5. **Investir pour le long terme.** Pour un horizon de huit ans et plus, une part en actions largement diversifiées devient envisageable, dans des enveloppes fiscalement adaptées (PEA, assurance-vie, PER selon l'objectif). La part de risque dépend de ton profil et de ton horizon.

## Choisir l'enveloppe pour le long terme

- **PEA** : pour les actions européennes, gains exonérés d'impôt sur le revenu après 5 ans (voir la fiche « Le PEA »).
- **Assurance-vie** : enveloppe polyvalente, fiscalité allégée après 8 ans et atouts pour la transmission.
- **PER** : pour la retraite, surtout intéressant si ton taux marginal d'imposition est élevé, mais l'argent est en principe bloqué jusqu'à la retraite.
- **Compte-titres** : sans plafond ni avantage fiscal, utile une fois les autres enveloppes utilisées.

## Les pièges fréquents

- **Investir avant d'avoir une réserve** : la première baisse des marchés coïncide parfois avec un imprévu personnel.
- **Tout garder sur des livrets** par prudence, alors que l'horizon est très long : l'inflation grignote le pouvoir d'achat.
- **Choisir une enveloppe pour sa seule fiscalité**, sans regarder les frais, la disponibilité ou l'horizon.
- **Oublier de revoir l'ordre** quand la situation change (naissance, changement d'emploi, achat immobilier).

## Comment Boussole s'en sert

Boussole compare ton matelas en mois de dépenses au repère de 3 à 6 mois et plafonne le profil de risque tant que la réserve est insuffisante. Son diagnostic signale ensuite l'argent qui dort sur les livrets au-delà d'un an de dépenses et vérifie que les enveloppes sont utilisées dans un ordre cohérent (PEA avant compte-titres pour les actions européennes, ancienneté des contrats d'assurance-vie, PER rapproché de ta tranche d'imposition). Indicateur pédagogique, pas un conseil en investissement.$f$;

-- pea
update public.savoir_fiches
   set titre = 'Le plan d''épargne en actions (PEA)',
       resume = 'Une enveloppe dédiée aux actions européennes, plafonnée en versements, dont les gains échappent à l''impôt sur le revenu après 5 ans (les prélèvements sociaux restent dus). Un retrait avant 5 ans clôt en principe le plan.',
       contenu = $f$## À quoi ça sert

Le PEA est une enveloppe fiscale conçue pour encourager l'investissement en actions d'entreprises européennes. Tant que l'argent reste dans le plan, les dividendes et plus-values ne sont pas imposés. Après cinq ans, les gains retirés sont exonérés d'impôt sur le revenu : seuls les prélèvements sociaux restent dus. C'est donc un outil adapté à un horizon long.

## Comment ça marche

- **Un seul PEA classique par personne** (bancaire ou sous forme d'assurance), donc deux pour un couple. Il peut être complété par un PEA PME-ETI.
- **Plafond de versements** (voir le repère Plafond de versements du PEA) : il porte sur les sommes versées, pas sur la valeur du plan. Un plan qui a pris de la valeur peut dépasser ce montant sans problème. Le PEA PME-ETI a son propre plafond, avec un plafond commun aux deux plans.
- **Titres éligibles** : actions de sociétés ayant leur siège dans l'Union européenne ou l'Espace économique européen, et fonds investis au moins à 75 % dans ces actions. Certains fonds indiciels répliquant des indices mondiaux sont éligibles grâce à des mécanismes de réplication synthétique ; l'éligibilité est indiquée dans la documentation du fonds.
- **Jeune majeur rattaché** au foyer fiscal de ses parents : PEA possible, avec un plafond réduit.

## Les retraits : la règle des 5 ans

- **Avant 5 ans** : en principe, tout retrait, même partiel, entraîne la clôture du plan. Les gains sont alors soumis au prélèvement forfaitaire unique (voir le repère Prélèvement forfaitaire unique, taux global prélèvements sociaux inclus), sauf option pour le barème. Des exceptions existent : licenciement, invalidité ou mise à la retraite anticipée du titulaire ou de son conjoint, ou création ou reprise d'entreprise.
- **Après 5 ans** : les retraits partiels sont possibles sans clôturer le plan et sans empêcher de nouveaux versements. Les gains sont exonérés d'impôt sur le revenu ; les prélèvements sociaux s'appliquent.

La date qui compte est celle du **premier versement** : ouvrir tôt un PEA avec une petite somme permet de « prendre date », même si tu n'investis vraiment que plus tard.

## Les pièges fréquents

- **Y placer l'épargne de précaution** : un PEA investi en actions n'offre aucune garantie en capital et un retrait anticipé peut le clôturer.
- **Croire que le plafond limite la valeur** : seuls les versements comptent.
- **Négliger les frais** de tenue de compte, de courtage et les frais courants des fonds, qui pèsent sur la durée.
- **Concentrer le plan** sur quelques titres : la fiscalité ne compense pas un manque de diversification.

## Comment Boussole s'en sert

Boussole suit ton PEA comme une enveloppe à part, avec des cours relevés chaque soir. Dans le diagnostic, le critère « Choix des enveloppes » signale des actions européennes détenues en compte-titres alors que le PEA du même titulaire a encore de la place sous le plafond de versements. Indicateur pédagogique, pas un conseil en investissement.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'pea' and contenu is distinct from $f$## À quoi ça sert

Le PEA est une enveloppe fiscale conçue pour encourager l'investissement en actions d'entreprises européennes. Tant que l'argent reste dans le plan, les dividendes et plus-values ne sont pas imposés. Après cinq ans, les gains retirés sont exonérés d'impôt sur le revenu : seuls les prélèvements sociaux restent dus. C'est donc un outil adapté à un horizon long.

## Comment ça marche

- **Un seul PEA classique par personne** (bancaire ou sous forme d'assurance), donc deux pour un couple. Il peut être complété par un PEA PME-ETI.
- **Plafond de versements** (voir le repère Plafond de versements du PEA) : il porte sur les sommes versées, pas sur la valeur du plan. Un plan qui a pris de la valeur peut dépasser ce montant sans problème. Le PEA PME-ETI a son propre plafond, avec un plafond commun aux deux plans.
- **Titres éligibles** : actions de sociétés ayant leur siège dans l'Union européenne ou l'Espace économique européen, et fonds investis au moins à 75 % dans ces actions. Certains fonds indiciels répliquant des indices mondiaux sont éligibles grâce à des mécanismes de réplication synthétique ; l'éligibilité est indiquée dans la documentation du fonds.
- **Jeune majeur rattaché** au foyer fiscal de ses parents : PEA possible, avec un plafond réduit.

## Les retraits : la règle des 5 ans

- **Avant 5 ans** : en principe, tout retrait, même partiel, entraîne la clôture du plan. Les gains sont alors soumis au prélèvement forfaitaire unique (voir le repère Prélèvement forfaitaire unique, taux global prélèvements sociaux inclus), sauf option pour le barème. Des exceptions existent : licenciement, invalidité ou mise à la retraite anticipée du titulaire ou de son conjoint, ou création ou reprise d'entreprise.
- **Après 5 ans** : les retraits partiels sont possibles sans clôturer le plan et sans empêcher de nouveaux versements. Les gains sont exonérés d'impôt sur le revenu ; les prélèvements sociaux s'appliquent.

La date qui compte est celle du **premier versement** : ouvrir tôt un PEA avec une petite somme permet de « prendre date », même si tu n'investis vraiment que plus tard.

## Les pièges fréquents

- **Y placer l'épargne de précaution** : un PEA investi en actions n'offre aucune garantie en capital et un retrait anticipé peut le clôturer.
- **Croire que le plafond limite la valeur** : seuls les versements comptent.
- **Négliger les frais** de tenue de compte, de courtage et les frais courants des fonds, qui pèsent sur la durée.
- **Concentrer le plan** sur quelques titres : la fiscalité ne compense pas un manque de diversification.

## Comment Boussole s'en sert

Boussole suit ton PEA comme une enveloppe à part, avec des cours relevés chaque soir. Dans le diagnostic, le critère « Choix des enveloppes » signale des actions européennes détenues en compte-titres alors que le PEA du même titulaire a encore de la place sous le plafond de versements. Indicateur pédagogique, pas un conseil en investissement.$f$;

-- per
update public.savoir_fiches
   set titre = 'Le plan d''épargne retraite (PER) et la tranche d''imposition',
       resume = 'Une enveloppe pour préparer la retraite : les versements volontaires sont déductibles du revenu imposable dans une limite annuelle, en échange d''une épargne en principe bloquée jusqu''à la retraite et imposée à la sortie.',
       contenu = $f$## À quoi ça sert

Le PER individuel sert à se constituer un complément de revenus pour la retraite. Son principal attrait est fiscal : les versements volontaires peuvent être déduits du revenu imposable l'année où tu les fais. En contrepartie, l'argent est en principe bloqué jusqu'au départ à la retraite et la sortie est imposée. Le PER déplace donc l'impôt dans le temps, plus qu'il ne le supprime.

## Comment ça marche

- **Versements libres**, investis selon une gestion que tu choisis ou une gestion pilotée qui réduit le risque à l'approche de la retraite.
- **Déduction** : par défaut, les versements effectués avant 70 ans sont déductibles. Depuis le 1er janvier 2026, les versements faits après 70 ans ne le sont plus. Tu peux aussi renoncer à la déduction versement par versement, ce qui allège l'imposition à la sortie.
- **Plafond de déduction** pour un salarié : 10 % des revenus d'activité nets de l'année précédente, dans une limite exprimée en multiples du plafond annuel de la Sécurité sociale (voir le repère Plafond annuel de la Sécurité sociale), avec un minimum garanti même sans revenus d'activité. Les plafonds non utilisés des cinq années précédentes peuvent être reportés. Le montant disponible figure sur ton avis d'impôt. Les travailleurs indépendants ont un plafond calculé autrement.
- **Déblocage anticipé** possible dans des cas limités : achat de la résidence principale, décès du conjoint ou partenaire de Pacs, invalidité, surendettement, fin des droits au chômage, liquidation judiciaire.
- **Sortie** à la retraite en capital, en rente viagère ou en combinant les deux.

## Pourquoi la tranche d'imposition compte

L'économie d'impôt d'un versement déduit est égale à ton **taux marginal d'imposition** (la tranche dans laquelle tombe le dernier euro de revenu). Un versement de 1 000 € fait économiser 300 € à un foyer dans la tranche à 30 %, 110 € dans la tranche à 11 %, rien s'il n'est pas imposable. À la sortie en capital, la part correspondant aux versements déduits est réintégrée au revenu imposable de l'année de sortie. Le PER est donc surtout intéressant si ta tranche pendant la vie active est plus élevée que celle attendue à la retraite.

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

Boussole rapproche ton PER de ta tranche d'imposition (donne-la à Claude ; tu la retrouves dans Compte › Données) : en dessous de 30 %, le diagnostic signale que la déduction à l'entrée pèse peu face à l'impôt à la sortie. Dans la vue par liquidité de Patrimoine, le PER est classé parmi les sommes bloquées. Indicateur pédagogique, pas un conseil en investissement.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'per' and contenu is distinct from $f$## À quoi ça sert

Le PER individuel sert à se constituer un complément de revenus pour la retraite. Son principal attrait est fiscal : les versements volontaires peuvent être déduits du revenu imposable l'année où tu les fais. En contrepartie, l'argent est en principe bloqué jusqu'au départ à la retraite et la sortie est imposée. Le PER déplace donc l'impôt dans le temps, plus qu'il ne le supprime.

## Comment ça marche

- **Versements libres**, investis selon une gestion que tu choisis ou une gestion pilotée qui réduit le risque à l'approche de la retraite.
- **Déduction** : par défaut, les versements effectués avant 70 ans sont déductibles. Depuis le 1er janvier 2026, les versements faits après 70 ans ne le sont plus. Tu peux aussi renoncer à la déduction versement par versement, ce qui allège l'imposition à la sortie.
- **Plafond de déduction** pour un salarié : 10 % des revenus d'activité nets de l'année précédente, dans une limite exprimée en multiples du plafond annuel de la Sécurité sociale (voir le repère Plafond annuel de la Sécurité sociale), avec un minimum garanti même sans revenus d'activité. Les plafonds non utilisés des cinq années précédentes peuvent être reportés. Le montant disponible figure sur ton avis d'impôt. Les travailleurs indépendants ont un plafond calculé autrement.
- **Déblocage anticipé** possible dans des cas limités : achat de la résidence principale, décès du conjoint ou partenaire de Pacs, invalidité, surendettement, fin des droits au chômage, liquidation judiciaire.
- **Sortie** à la retraite en capital, en rente viagère ou en combinant les deux.

## Pourquoi la tranche d'imposition compte

L'économie d'impôt d'un versement déduit est égale à ton **taux marginal d'imposition** (la tranche dans laquelle tombe le dernier euro de revenu). Un versement de 1 000 € fait économiser 300 € à un foyer dans la tranche à 30 %, 110 € dans la tranche à 11 %, rien s'il n'est pas imposable. À la sortie en capital, la part correspondant aux versements déduits est réintégrée au revenu imposable de l'année de sortie. Le PER est donc surtout intéressant si ta tranche pendant la vie active est plus élevée que celle attendue à la retraite.

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

Boussole rapproche ton PER de ta tranche d'imposition (donne-la à Claude ; tu la retrouves dans Compte › Données) : en dessous de 30 %, le diagnostic signale que la déduction à l'entrée pèse peu face à l'impôt à la sortie. Dans la vue par liquidité de Patrimoine, le PER est classé parmi les sommes bloquées. Indicateur pédagogique, pas un conseil en investissement.$f$;

-- prevoyance
update public.savoir_fiches
   set titre = 'La prévoyance : incapacité, invalidité, décès',
       resume = 'La prévoyance protège tes revenus et ta famille contre les risques lourds : arrêt de travail prolongé, invalidité, décès. Les prestations de la Sécurité sociale sont plafonnées et souvent insuffisantes ; un contrat collectif ou individuel peut les compléter.',
       contenu = $f$## À quoi ça sert

La prévoyance couvre les « risques lourds » qui peuvent faire basculer les finances d'un foyer : un arrêt de travail prolongé (incapacité), une invalidité durable, un décès. Contrairement à un imprévu ordinaire, aucune épargne de précaution ne suffit à compenser des années de revenus perdus. C'est une protection à mettre en place avant d'investir, surtout avec un crédit en cours ou des enfants à charge.

## Ce que verse la Sécurité sociale (salariés du privé)

- **Arrêt maladie** : des indemnités journalières d'environ la moitié du salaire journalier de base, après un délai de carence de 3 jours, dans la limite d'un salaire plafonné (1,4 fois le Smic pour les arrêts commencés depuis le 1er avril 2025). Elles sont versées en général 12 mois au plus sur 3 ans, 3 ans en cas d'affection de longue durée. L'employeur peut compléter selon l'ancienneté et la convention collective.
- **Invalidité** : si la capacité de travail ou de gain est réduite d'au moins deux tiers, une pension égale à 30 % (si une activité reste possible) ou 50 % (sinon) du salaire annuel moyen des 10 meilleures années, retenu dans la limite du plafond de la Sécurité sociale (voir le repère Plafond annuel de la Sécurité sociale), majorée en cas de besoin d'une tierce personne.
- **Décès** : un capital forfaitaire, modeste au regard des besoins d'une famille.

Au-delà de ces plafonds, la baisse de revenus est donc forte. Les travailleurs indépendants relèvent de règles différentes, souvent moins protectrices.

## La prévoyance complémentaire

- **Collective** : pour les cadres, la convention de 1947, reprise par l'accord national interprofessionnel de 2017, impose une couverture financée par l'employeur à hauteur d'au moins 1,5 % du salaire (sur la part limitée au plafond de la Sécurité sociale), prioritairement affectée au décès. Pour les non-cadres, tout dépend des accords de branche : selon la Direction de la sécurité sociale, 71 des 116 accords de branche analysés en 2023 prévoyaient une couverture prévoyance.
- **Individuelle** : pour les indépendants, ou pour compléter une couverture collective jugée insuffisante. Elle peut prévoir des indemnités journalières complémentaires, une rente d'invalidité, un capital décès, une rente pour le conjoint ou pour l'éducation des enfants.
- **L'assurance emprunteur** protège le remboursement d'un crédit, pas le niveau de vie de la famille : les deux sont complémentaires.

## Bien lire un contrat

Vérifie la franchise avant le premier versement, la définition de l'invalidité (le barème de l'assureur peut différer de celui de la Sécurité sociale), les exclusions, le délai d'attente, le questionnaire de santé, le choix entre rente et capital, la revalorisation des prestations et la rédaction de la clause bénéficiaire.

## Pièges fréquents

- Supposer que l'employeur couvre tout sans avoir lu la notice du contrat collectif.
- Confondre complémentaire santé (remboursement des soins) et prévoyance (maintien des revenus).
- Sous-estimer le risque d'invalidité ou d'arrêt de travail prolongé, en ne pensant qu'au décès.
- Laisser une clause bénéficiaire obsolète après un mariage, une séparation ou une naissance.

## Comment Boussole s'en sert

Boussole a besoin de savoir si une prévoyance (décès, invalidité) et, en cas de crédit, une assurance emprunteur couvrent ton foyer : réponds avec Claude, et ta réponse apparaît dans Compte › Données. Le critère « Protection de la famille » est signalé lorsqu'un crédit ou des enfants à charge ne sont pas accompagnés de ces garanties. C'est un repère d'usage, pas une obligation légale.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'prevoyance' and contenu is distinct from $f$## À quoi ça sert

La prévoyance couvre les « risques lourds » qui peuvent faire basculer les finances d'un foyer : un arrêt de travail prolongé (incapacité), une invalidité durable, un décès. Contrairement à un imprévu ordinaire, aucune épargne de précaution ne suffit à compenser des années de revenus perdus. C'est une protection à mettre en place avant d'investir, surtout avec un crédit en cours ou des enfants à charge.

## Ce que verse la Sécurité sociale (salariés du privé)

- **Arrêt maladie** : des indemnités journalières d'environ la moitié du salaire journalier de base, après un délai de carence de 3 jours, dans la limite d'un salaire plafonné (1,4 fois le Smic pour les arrêts commencés depuis le 1er avril 2025). Elles sont versées en général 12 mois au plus sur 3 ans, 3 ans en cas d'affection de longue durée. L'employeur peut compléter selon l'ancienneté et la convention collective.
- **Invalidité** : si la capacité de travail ou de gain est réduite d'au moins deux tiers, une pension égale à 30 % (si une activité reste possible) ou 50 % (sinon) du salaire annuel moyen des 10 meilleures années, retenu dans la limite du plafond de la Sécurité sociale (voir le repère Plafond annuel de la Sécurité sociale), majorée en cas de besoin d'une tierce personne.
- **Décès** : un capital forfaitaire, modeste au regard des besoins d'une famille.

Au-delà de ces plafonds, la baisse de revenus est donc forte. Les travailleurs indépendants relèvent de règles différentes, souvent moins protectrices.

## La prévoyance complémentaire

- **Collective** : pour les cadres, la convention de 1947, reprise par l'accord national interprofessionnel de 2017, impose une couverture financée par l'employeur à hauteur d'au moins 1,5 % du salaire (sur la part limitée au plafond de la Sécurité sociale), prioritairement affectée au décès. Pour les non-cadres, tout dépend des accords de branche : selon la Direction de la sécurité sociale, 71 des 116 accords de branche analysés en 2023 prévoyaient une couverture prévoyance.
- **Individuelle** : pour les indépendants, ou pour compléter une couverture collective jugée insuffisante. Elle peut prévoir des indemnités journalières complémentaires, une rente d'invalidité, un capital décès, une rente pour le conjoint ou pour l'éducation des enfants.
- **L'assurance emprunteur** protège le remboursement d'un crédit, pas le niveau de vie de la famille : les deux sont complémentaires.

## Bien lire un contrat

Vérifie la franchise avant le premier versement, la définition de l'invalidité (le barème de l'assureur peut différer de celui de la Sécurité sociale), les exclusions, le délai d'attente, le questionnaire de santé, le choix entre rente et capital, la revalorisation des prestations et la rédaction de la clause bénéficiaire.

## Pièges fréquents

- Supposer que l'employeur couvre tout sans avoir lu la notice du contrat collectif.
- Confondre complémentaire santé (remboursement des soins) et prévoyance (maintien des revenus).
- Sous-estimer le risque d'invalidité ou d'arrêt de travail prolongé, en ne pensant qu'au décès.
- Laisser une clause bénéficiaire obsolète après un mariage, une séparation ou une naissance.

## Comment Boussole s'en sert

Boussole a besoin de savoir si une prévoyance (décès, invalidité) et, en cas de crédit, une assurance emprunteur couvrent ton foyer : réponds avec Claude, et ta réponse apparaît dans Compte › Données. Le critère « Protection de la famille » est signalé lorsqu'un crédit ou des enfants à charge ne sont pas accompagnés de ces garanties. C'est un repère d'usage, pas une obligation légale.$f$;

-- taux-endettement
update public.savoir_fiches
   set titre = 'Le taux d''endettement et la norme HCSF',
       resume = 'Le taux d''effort rapporte tes mensualités de crédit, assurance comprise, à tes revenus nets. Pour un crédit immobilier, la norme du HCSF le limite et plafonne la durée, avec une marge de dérogation pour les banques.',
       contenu = $f$## À quoi ça sert

Le taux d'endettement, que les autorités appellent **taux d'effort**, mesure la part de tes revenus consacrée au remboursement de tes crédits. C'est le premier indicateur regardé par une banque pour un prêt immobilier, et un bon outil pour toi-même : au-delà d'un certain niveau, le budget n'a plus de marge pour les imprévus.

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

Dans Pilotage › Rang, Boussole calcule ton taux d'endettement, assurance comprise et toutes mensualités confondues, et le compare au plafond HCSF : vert sous le plafond, orange un peu au-delà (zone de dérogation possible), rouge nettement au-dessus. Il indique aussi de combien les revenus ou l'apport devraient augmenter pour revenir au plafond. Indicateur pédagogique, pas un conseil en investissement ni une offre de crédit.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'taux-endettement' and contenu is distinct from $f$## À quoi ça sert

Le taux d'endettement, que les autorités appellent **taux d'effort**, mesure la part de tes revenus consacrée au remboursement de tes crédits. C'est le premier indicateur regardé par une banque pour un prêt immobilier, et un bon outil pour toi-même : au-delà d'un certain niveau, le budget n'a plus de marge pour les imprévus.

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

Dans Pilotage › Rang, Boussole calcule ton taux d'endettement, assurance comprise et toutes mensualités confondues, et le compare au plafond HCSF : vert sous le plafond, orange un peu au-delà (zone de dérogation possible), rouge nettement au-dessus. Il indique aussi de combien les revenus ou l'apport devraient augmenter pour revenir au plafond. Indicateur pédagogique, pas un conseil en investissement ni une offre de crédit.$f$;

-- transmission-bases
update public.savoir_fiches
   set titre = 'Transmettre : les bases (donations, succession, assurance-vie)',
       resume = 'Les grands mécanismes pour transmettre un patrimoine en France : abattements par enfant renouvelables tous les 15 ans, exonération du conjoint au décès et régime propre de l''assurance-vie.',
       contenu = $f$## À quoi ça sert

Préparer la transmission, c'est décider à qui ira ton patrimoine, quand, et à quel coût fiscal pour ceux qui le reçoivent. Une partie se règle de son vivant (donations), une partie au décès (succession et assurance-vie). Cette fiche présente les règles de base ; un notaire reste l'interlocuteur pour toute situation concrète, notamment en présence d'une famille recomposée, d'un bien immobilier ou d'une entreprise.

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

Boussole ne calcule pas de droits de succession. Il t'aide à garder une vue claire de ce qui serait transmis (biens, contrats d'assurance-vie et leur date d'ouverture) pour préparer un échange avec un notaire. Indicateur pédagogique, pas un conseil juridique ou en investissement.$f$,
       version = version + 1, mis_a_jour_le = '2026-10-11'
 where slug = 'transmission-bases' and contenu is distinct from $f$## À quoi ça sert

Préparer la transmission, c'est décider à qui ira ton patrimoine, quand, et à quel coût fiscal pour ceux qui le reçoivent. Une partie se règle de son vivant (donations), une partie au décès (succession et assurance-vie). Cette fiche présente les règles de base ; un notaire reste l'interlocuteur pour toute situation concrète, notamment en présence d'une famille recomposée, d'un bien immobilier ou d'une entreprise.

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

Boussole ne calcule pas de droits de succession. Il t'aide à garder une vue claire de ce qui serait transmis (biens, contrats d'assurance-vie et leur date d'ouverture) pour préparer un échange avec un notaire. Indicateur pédagogique, pas un conseil juridique ou en investissement.$f$;
