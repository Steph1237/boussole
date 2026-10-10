-- Boussole : fiches du savoir commun, suite (AG1). Faits vérifiés le 2026-10-10 sur les sources citées.
-- Appliqué avec apply_migration (name = "savoir_fiches"). Idempotent.
-- Fiches : allocation-profil-de-risque, diversification, frais-et-ter, investissement-programme, crises-et-recuperation,
-- crypto-actifs (marches) ; acheter-ou-louer (immobilier) ; prevoyance (protection) ; biais-comportementaux (comportement).
-- Les chiffres qui bougent (taux, plafonds, PASS, normes HCSF) ne sont pas recopiés : les fiches renvoient aux repères (table public.reperes).
insert into public.savoir_fiches (slug, theme, titre, resume, contenu, mots_cles, sources, mis_a_jour_le) values
  ('allocation-profil-de-risque', 'marches', 'Allocation et profil de risque',
   'L''allocation répartit votre épargne entre supports garantis, obligations, actions et placements spéculatifs. Elle découle de votre horizon, de votre capacité à encaisser une perte et de votre tolérance réelle aux baisses.',
   $f$## L'idée clé

Le choix le plus déterminant pour un portefeuille n'est pas tel ou tel fonds, mais la répartition entre grandes familles d'actifs : supports garantis et monétaires, obligations, actions, immobilier et, à la marge, actifs spéculatifs. Cette répartition, appelée allocation, fixe à la fois le rendement que l'on peut espérer à long terme et l'ampleur des baisses qu'il faudra traverser en chemin.

## Les trois questions à se poser

- **Horizon** : quand aurez-vous besoin de cet argent ? Une somme destinée à un projet proche n'a pas sa place sur les marchés d'actions, qui peuvent baisser juste avant l'échéance. L'AMF rappelle qu'un placement en actions, encore risqué sur 5 ans, l'est bien moins sur 15 ans.
- **Capacité à subir des pertes** : votre situation permet-elle d'encaisser une baisse sans être obligé de vendre ? Sans épargne de précaution, le moindre imprévu peut forcer une vente au plus mauvais moment.
- **Tolérance au risque** : comment réagiriez-vous, concrètement, devant une perte de 20 ou 30 % affichée sur votre relevé ? La réponse honnête compte davantage que la réponse idéale.

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

Le questionnaire de Boussole, inspiré de l'évaluation de l'adéquation MiFID, situe votre profil sur cinq niveaux : Prudent, Modéré, Équilibré, Dynamique et Offensif, avec une baisse tolérée sur un an allant de 5 % pour le premier à 40 % pour le dernier. Des garde-fous plafonnent le résultat : un horizon de moins de deux ans, ou l'absence de trois mois de dépenses mis de côté, limitent le profil à Modéré ; ne pas connaître les actions ni les ETF le limite à Équilibré. Boussole compare ensuite votre allocation réelle aux fourchettes indicatives de votre profil et estime une perte plausible sur un an, calculée de façon prudente à partir de la volatilité de vos classes d'actifs et de leurs pires baisses passées. Ces repères sont pédagogiques et ne constituent pas un conseil en investissement personnalisé.$f$,
   array['allocation','profil de risque','horizon','capacité de perte','MiFID','rééquilibrage'],
   '[{"titre": "AMF : Vous souhaitez mieux vous connaître en tant qu épargnant ? (5 octobre 2022)", "url": "https://www.amf-france.org/fr/espace-epargnants/savoir-bien-investir/conseils-pratiques/mieux-se-connaitre-en-tant-quepargnant", "consulte_le": "2026-10-10"}, {"titre": "AMF : Bien diversifier son épargne pour atteindre ses objectifs (19 octobre 2023)", "url": "https://www.amf-france.org/fr/espace-epargnants/lexique-simulateurs-et-outils-pratiques/mon-zoom-epargne/bien-diversifier-son-epargne-pour-atteindre-ses-objectifs", "consulte_le": "2026-10-10"}, {"titre": "AMF : Lettre de l Observatoire de l épargne n° 27, février 2018 (stratégies d épargne 1987-2017)", "url": "https://www.amf-france.org/sites/institutionnel/files/contenu_simple/lettre_ou_cahier/lettre_observatoire/Lettre%20de%20l%27Observatoire%20de%20l%27epargne%20de%20l%27AMF%20-%20Ndeg%2027%20-%20Fevrier%202018.pdf", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('diversification', 'marches', 'La diversification',
   'Diversifier, c''est associer des placements qui ne réagissent pas de la même façon aux mêmes événements, pour qu''un seul choc ne compromette pas votre épargne. Classes d''actifs, pays, secteurs, nombre de titres et étalement dans le temps en sont les leviers.',
   $f$## À quoi ça sert

Diversifier, c'est combiner des placements qui n'évoluent pas de la même façon au même moment. Le but n'est pas de supprimer le risque, mais d'éviter qu'un seul événement (la faillite d'une entreprise, la crise d'un secteur, la récession d'un pays, la chute d'une monnaie) emporte une grande part de votre épargne. Pour l'AMF, c'est aussi la condition pour viser, sur la durée, un rendement supérieur à celui de l'épargne sans risque tout en gardant ce risque sous contrôle.

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

Boussole note la diversification géographique de vos actions : le repère est qu'au moins la moitié d'entre elles soit investie sur le monde entier, au travers d'indices de type Monde ou tous pays. Il signale aussi la concentration sur une seule ligne, et affiche, à titre d'information sans note, la part de votre épargne financière exposée à une autre devise que l'euro. Indiquer la zone géographique de vos fonds rend cette analyse plus précise.$f$,
   array['diversification','répartition','risque','zone géographique','biais domestique','corrélation'],
   '[{"titre": "AMF : Bien diversifier son épargne pour atteindre ses objectifs (19 octobre 2023)", "url": "https://www.amf-france.org/fr/espace-epargnants/lexique-simulateurs-et-outils-pratiques/mon-zoom-epargne/bien-diversifier-son-epargne-pour-atteindre-ses-objectifs", "consulte_le": "2026-10-10"}, {"titre": "AMF : Quelques conseils pour bien investir", "url": "https://www.amf-france.org/fr/espace-epargnants/savoir-bien-investir/conseils-pratiques/les-regles-dor-de-linvestisseur", "consulte_le": "2026-10-10"}, {"titre": "MSCI : fiche de l indice MSCI World (USD), données au 30 septembre 2026", "url": "https://www.msci.com/documents/10199/178e6643-6ae6-47b9-82be-e1fc565ededb", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('frais-et-ter', 'marches', 'Les frais des placements et le TER',
   'Les frais sont prélevés chaque année, que le placement gagne ou perde, et leur effet se cumule. Le TER (frais courants) d''un fonds figure dans son document d''informations clés ; il ne dit pas tout, mais c''est le premier chiffre à regarder.',
   $f$## Pourquoi c'est important

Les frais sont l'une des rares composantes du rendement que vous maîtrisez. Ils sont prélevés chaque année, que le placement progresse ou recule, et leur effet se cumule. Un calcul simple le montre : un point de frais annuels supplémentaire réduit le capital final d'environ 17 à 18 % au bout de 20 ans, à performance de marché identique.

## Les différents frais

- **Frais courants (TER)** : frais de gestion et de fonctionnement d'un fonds, exprimés en pourcentage par an. Ils sont déduits directement de la valeur des parts : vous ne les voyez pas passer, mais ils réduisent la performance. Ils figurent dans le document d'informations clés (DIC) du fonds.
- **Frais d'entrée et de sortie** : prélevés à l'achat ou à la vente des parts de certains fonds.
- **Commissions de surperformance** : prélevées quand le fonds dépasse un objectif ; elles ne sont pas incluses dans les frais courants.
- **Frais de transaction** : supportés à l'intérieur du fonds quand il achète et vend des titres, et, pour vous, le courtage sur chaque ordre passé.
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

Boussole calcule le TER moyen de vos lignes cotées, pondéré par les montants. Le repère est de 0,3 % par an ou moins ; la note diminue progressivement jusqu'à s'annuler vers 2 %. Vous pouvez renseigner le TER de chaque fonds à partir de son DIC, avec la source consultée. Tant que moins de la moitié des montants cotés ont un TER connu, le critère est signalé comme incomplet plutôt que noté.$f$,
   array['frais','TER','frais courants','courtage','DIC','performance nette'],
   '[{"titre": "AMF : Les frais des placements financiers continuent de baisser, en particulier ceux des fonds d investissement (27 avril 2026)", "url": "https://www.amf-france.org/fr/actualites-publications/actualites/les-frais-des-placements-financiers-continuent-de-baisser-en-particulier-ceux-des-fonds", "consulte_le": "2026-10-10"}, {"titre": "AMF : Lettre de l Observatoire de l épargne n° 27, février 2018 (stratégies d épargne 1987-2017)", "url": "https://www.amf-france.org/sites/institutionnel/files/contenu_simple/lettre_ou_cahier/lettre_observatoire/Lettre%20de%20l%27Observatoire%20de%20l%27epargne%20de%20l%27AMF%20-%20Ndeg%2027%20-%20Fevrier%202018.pdf", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('investissement-programme', 'marches', 'L''investissement programmé',
   'Investir un montant fixe à intervalles réguliers lisse le prix d''achat moyen et retire la question du « bon moment ». Cela réduit le risque d''entrer juste avant une baisse, sans supprimer le risque de perte en capital.',
   $f$## L'idée clé

L'investissement programmé consiste à placer un montant fixe à intervalles réguliers, souvent chaque mois, sur le même support, quel que soit le niveau du marché ce jour-là. On parle de versements programmés sur un contrat d'assurance-vie ou un PER, et de plan d'investissement programmé sur un PEA ou un compte-titres. Parmi ses conseils pour bien investir, l'AMF invite à épargner régulièrement, à respecter ses choix initiaux et à ne pas chercher un gain rapide en jouant sur les fluctuations de court terme.

## Comment ça marche

Avec un montant constant, vous acquérez mécaniquement plus de parts quand le prix est bas et moins quand il est haut. Exemple : 100 € investis trois mois de suite à des prix de 10 €, 8 € puis 12 € donnent 10, 12,5 puis environ 8,3 parts, soit environ 30,8 parts pour 300 €. Le prix de revient moyen ressort à environ 9,73 €, un peu sous la moyenne des trois prix (10 €).

Surtout, la méthode supprime la décision la plus difficile : choisir le moment d'entrer. Elle transforme l'investissement en habitude, ce qui protège contre les réflexes coûteux, comme tout suspendre après une baisse ou tout investir après une forte hausse.

## Ce que montre l'histoire

- **Si vous épargnez sur vos revenus**, investir chaque mois est simplement la façon naturelle de placer l'argent au fur et à mesure qu'il arrive.
- **Si vous disposez déjà d'une somme**, la question est différente. Les marchés d'actions ayant plus souvent monté que baissé sur longue période, investir d'un coup a historiquement abouti plus souvent à un meilleur résultat final qu'un étalement. L'étalement réduit en revanche le risque d'entrer juste avant une chute, et le regret qui l'accompagne : c'est un choix de confort et de discipline autant que de rendement.
- **L'AMF**, dans son étude sur la performance comparée des stratégies d'épargne entre 1987 et 2017, montre que le résultat d'un placement unique dépend fortement des dates d'entrée et de sortie, et qu'un portefeuille mixte rééquilibré chaque année a fait mieux que sans rééquilibrage, aussi bien avec des versements réguliers qu'avec un investissement unique.

## Pièges fréquents

- Interrompre les versements pendant une crise, alors que c'est le moment où chaque euro achète le plus de parts.
- Croire que l'étalement garantit un gain : il lisse le prix d'achat, pas le risque de perte en capital du support.
- Programmer de petits montants sur un support où chaque versement ou chaque ordre supporte des frais fixes.
- Appliquer la méthode à un actif très spéculatif en pensant le rendre sûr.
- Commencer avant d'avoir constitué son épargne de précaution.

## Comment Boussole s'en sert

Le plan de Boussole calcule, pour chacun de vos objectifs, le versement mensuel nécessaire pour l'atteindre à la date voulue, et le met en regard de votre capacité d'épargne. Ce montant peut servir de base à des versements programmés. La règle des deux ans s'applique : l'argent destiné à un projet à moins de deux ans reste disponible et peu risqué. Boussole ne passe aucun ordre à votre place.$f$,
   array['investissement programmé','versements programmés','DCA','régularité','prix de revient','discipline'],
   '[{"titre": "AMF : Quelques conseils pour bien investir", "url": "https://www.amf-france.org/fr/espace-epargnants/savoir-bien-investir/conseils-pratiques/les-regles-dor-de-linvestisseur", "consulte_le": "2026-10-10"}, {"titre": "AMF : La performance comparée des différentes stratégies d épargne sur supports français, synthèse (7 février 2018)", "url": "https://www.amf-france.org/fr/actualites-publications/publications/rapports-etudes-et-analyses/la-performance-comparee-des-differentes-strategies-depargne-sur-supports-francais-synthese", "consulte_le": "2026-10-10"}, {"titre": "AMF : Lettre de l Observatoire de l épargne n° 27, février 2018", "url": "https://www.amf-france.org/sites/institutionnel/files/contenu_simple/lettre_ou_cahier/lettre_observatoire/Lettre%20de%20l%27Observatoire%20de%20l%27epargne%20de%20l%27AMF%20-%20Ndeg%2027%20-%20Fevrier%202018.pdf", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('crises-et-recuperation', 'marches', 'Crises boursières et durée de récupération',
   'Des baisses de 30 à 60 % des actions se produisent plusieurs fois par génération, et leur rattrapage a pris de quelques mois à plus d''une décennie. Les dividendes, la diversification et le fait de ne pas vendre au plus bas changent fortement l''expérience de l''épargnant.',
   $f$## À quoi ça sert

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

Pour estimer la perte plausible de votre portefeuille sur un an, Boussole s'appuie notamment sur les pires baisses historiques de chaque classe d'actifs, puis la compare à la baisse que votre profil tolère. En période de forte baisse, l'agent peut rappeler ces ordres de grandeur avant toute décision de vente.$f$,
   array['crise','krach','baisse maximale','récupération','CAC 40','MSCI World','dividendes'],
   '[{"titre": "AMF : L indice CAC 40 est-il un bon indicateur de la performance des grandes actions françaises ? (28 mars 2024)", "url": "https://www.amf-france.org/fr/espace-epargnants/actualites-mises-en-garde/lindice-cac-40-est-il-un-bon-indicateur-de-la-performance-des-grandes-actions-francaises", "consulte_le": "2026-10-10"}, {"titre": "Federal Reserve History : Stock Market Crash of 1929", "url": "https://www.federalreservehistory.org/essays/stock-market-crash-of-1929", "consulte_le": "2026-10-10"}, {"titre": "MSCI : fiche de l indice MSCI World (USD), données au 30 septembre 2026", "url": "https://www.msci.com/documents/10199/178e6643-6ae6-47b9-82be-e1fc565ededb", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('crypto-actifs', 'marches', 'Les crypto-actifs',
   'Les crypto-actifs sont très volatils, ne sont pas une monnaie ayant cours légal et ne bénéficient d''aucune garantie des dépôts : une perte totale est possible. Depuis le 1er juillet 2026, seuls les prestataires agréés (PSCA) peuvent proposer ces services en France.',
   $f$## De quoi parle-t-on

Les crypto-actifs (bitcoin, ether, jetons, stablecoins…) sont des actifs numériques enregistrés sur une blockchain. Ce ne sont pas des monnaies au sens légal : en France, seul l'euro a cours légal. Ils ne bénéficient pas de la garantie d'une banque centrale, et le fonds de garantie des dépôts ne les couvre pas, même lorsqu'ils sont détenus chez un prestataire autorisé.

## Les risques rappelés par l'AMF

- **Volatilité extrême** : le cours du bitcoin a baissé d'environ 73 % entre novembre 2021 et décembre 2022. L'AMF souligne qu'on peut perdre l'argent investi en quelques jours, voire en quelques heures.
- **Perte totale possible** : perte de la clé privée, piratage, défaillance du prestataire ; la récupération peut alors être impossible.
- **Arnaques nombreuses** : contact non sollicité, promesse de rendement élevé garanti (cela n'existe pas), premier petit retrait accordé pour inspirer confiance, frais ou impôts fictifs réclamés pour débloquer les fonds, faux sauveteurs proposant ensuite de récupérer l'argent perdu, usurpation de l'identité de personnalités ou de médias. Ne communiquez jamais vos clés privées.
- **Effet de levier** : les CFD sur crypto-actifs proposés aux particuliers sont limités à un levier de 2, qui reste dangereux vu la volatilité du sous-jacent.
- **Protection limitée** : les autorités européennes de supervision (ABE, AEAPP, AEMF) ont rappelé en octobre 2025 que les crypto-actifs peuvent être risqués, que la protection juridique varie selon l'actif et peut être limitée, et appelé à la prudence face à la promotion par les influenceurs.

## Le cadre : PSAN, PSCA et MiCA

Le règlement européen MiCA encadre les prestataires de services sur crypto-actifs. La période de transition depuis l'ancien régime français des PSAN s'est achevée le 1er juillet 2026 : depuis, seuls les PSCA agréés peuvent fournir ces services en France. Vérifiez la présence du prestataire sur la liste blanche de l'AMF, et que l'adresse du site correspond bien à celle de la liste ; un dossier « en cours » ne vaut pas agrément. Un PSCA agréé dans un autre pays de l'Union peut servir des clients français, mais le service client peut être dans une autre langue et le médiateur de l'AMF ne pas être compétent. Si votre prestataire n'est pas agréé, il doit vous informer : vous pouvez transférer vos actifs vers un PSCA, vers un portefeuille que vous contrôlez, ou les convertir en euros, en comparant frais et délais.

L'agrément encadre le prestataire (organisation, sécurité, information), pas l'évolution des cours : il ne protège pas contre une baisse.

## Pièges fréquents

- Investir de l'argent dont on aura besoin, ou avant d'avoir constitué son épargne de précaution.
- Suivre des conseils diffusés sur les réseaux sociaux ou par des inconnus.
- Payer quelqu'un pour récupérer des fonds perdus : c'est presque toujours une seconde arnaque. En cas d'escroquerie, le recours principal est une plainte auprès de la police ou de la gendarmerie.

## Comment Boussole s'en sert

Boussole classe les crypto-actifs et les produits à effet de levier dans une « part spéculative », rapportée à votre épargne financière. Le repère est un plafond qui dépend de votre profil : 0 % pour Prudent, 2 % pour Modéré, 5 % pour Équilibré, 7 % pour Dynamique, 10 % pour Offensif, et 5 % par défaut sans profil déclaré. Ce plafond est un garde-fou pédagogique, pas une incitation à investir.$f$,
   array['crypto-actifs','bitcoin','MiCA','PSCA','PSAN','arnaques','volatilité','spéculatif'],
   '[{"titre": "AMF : Investir dans le bitcoin : prudence ! (27 juillet 2026)", "url": "https://www.amf-france.org/fr/espace-epargnants/proteger-son-epargne/crypto-actifs-bitcoin-etc/investir-dans-le-bitoin-prudence", "consulte_le": "2026-10-10"}, {"titre": "AMF : Entrée en application du règlement européen MiCA : quelles conséquences pour les détenteurs de cryptos ? (27 juillet 2026)", "url": "https://www.amf-france.org/fr/espace-epargnants/actualites-mises-en-garde/entree-en-application-du-reglement-europeen-mica-quelles-consequences-pour-les-detenteurs-de-cryptos", "consulte_le": "2026-10-10"}, {"titre": "ESMA : EU Supervisory Authorities warn consumers of risks and limited protection for certain crypto-assets and providers (6 octobre 2025)", "url": "https://www.esma.europa.eu/press-news/esma-news/eu-supervisory-authorities-warn-consumers-risks-and-limited-protection-certain", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('acheter-ou-louer', 'immobilier', 'Acheter ou louer sa résidence principale',
   'Il n''y a pas de réponse universelle : tout dépend du rapport entre prix et loyers, de la durée pendant laquelle vous resterez, des taux, des frais d''acquisition et de ce que rapporterait votre apport s''il était placé.',
   $f$## L'idée clé

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

Le simulateur « Acheter ou louer » de Boussole compare, année après année, le patrimoine net d'un acheteur et celui d'un locataire qui place la différence. Il s'appuie sur des données de prix et de loyers par ville, les frais de notaire, la taxe foncière, les charges et l'entretien, et propose plusieurs scénarios (central, retour de l'inflation…). Votre apport et vos crédits existants peuvent être repris de votre bilan. Toutes les hypothèses sont modifiables, et les résultats sont des projections, pas des promesses.$f$,
   array['acheter ou louer','résidence principale','apport','frais de notaire','coût d''opportunité','simulateur'],
   '[{"titre": "Insee : Informations rapides n° 224, prix des logements anciens au deuxième trimestre 2026 (18 septembre 2026)", "url": "https://www.insee.fr/fr/statistiques/9050027", "consulte_le": "2026-10-10"}, {"titre": "Service Public : Frais de notaire, de quoi s agit-il ?", "url": "https://www.service-public.gouv.fr/particuliers/vosdroits/F17701", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('prevoyance', 'protection', 'La prévoyance : incapacité, invalidité, décès',
   'La prévoyance protège vos revenus et votre famille contre les risques lourds : arrêt de travail prolongé, invalidité, décès. Les prestations de la Sécurité sociale sont plafonnées et souvent insuffisantes ; un contrat collectif ou individuel peut les compléter.',
   $f$## À quoi ça sert

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

Vérifiez la franchise avant le premier versement, la définition de l'invalidité (le barème de l'assureur peut différer de celui de la Sécurité sociale), les exclusions, le délai d'attente, le questionnaire de santé, le choix entre rente et capital, la revalorisation des prestations et la rédaction de la clause bénéficiaire.

## Pièges fréquents

- Supposer que l'employeur couvre tout sans avoir lu la notice du contrat collectif.
- Confondre complémentaire santé (remboursement des soins) et prévoyance (maintien des revenus).
- Sous-estimer le risque d'invalidité ou d'arrêt de travail prolongé, en ne pensant qu'au décès.
- Laisser une clause bénéficiaire obsolète après un mariage, une séparation ou une naissance.

## Comment Boussole s'en sert

Dans votre profil, Boussole vous demande si une prévoyance (décès, invalidité) et, en cas de crédit, une assurance emprunteur couvrent le foyer. Le critère « Protection de la famille » est signalé lorsqu'un crédit ou des enfants à charge ne sont pas accompagnés de ces garanties. C'est un repère d'usage, pas une obligation légale.$f$,
   array['prévoyance','incapacité','invalidité','décès','indemnités journalières','protection'],
   '[{"titre": "Direction de la sécurité sociale : La prévoyance des salariés du privé, actes du colloque du 9 décembre 2024", "url": "https://www.securite-sociale.fr/files/live/sites/SSFR/files/medias/DSS/2025/La%20pr%C3%A9voyance%20des%20salaries%20du%20priv%C3%A9%20-%20actes%20du%20colloque%2009122024%20(002).pdf", "consulte_le": "2026-10-10"}, {"titre": "Service Public : Arrêt maladie, indemnités journalières versées au salarié", "url": "https://www.service-public.gouv.fr/particuliers/vosdroits/F3053", "consulte_le": "2026-10-10"}, {"titre": "Service Public : Pension d invalidité de la Sécurité sociale", "url": "https://www.service-public.gouv.fr/particuliers/vosdroits/F672", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10'),

  ('biais-comportementaux', 'comportement', 'Les biais comportementaux de l''épargnant',
   'Nos décisions d''épargne sont influencées par des réflexes qui nous éloignent de nos objectifs : peur de la perte, imitation, statu quo, excès de confiance. Les connaître et se fixer des règles à l''avance sont les meilleurs remèdes.',
   $f$## L'idée clé

Les choix financiers ne sont pas seulement rationnels : ils sont influencés par des réflexes, appelés biais comportementaux, qui peuvent conduire à des décisions contraires à nos propres objectifs. L'AMF en recense huit dans un article pédagogique de juin 2022, et souligne que le meilleur moyen de les corriger est d'en avoir conscience. Leur effet varie d'une personne à l'autre.

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

Boussole vous aide à décider à froid : questionnaire de profil de risque avec garde-fous, allocation cible, et règles d'alerte que vous fixez vous-même (seuil d'une position, matelas de précaution…), dont les déclenchements apparaissent dans vos actions recommandées. L'agent peut aussi mémoriser vos décisions et leurs raisons, pour vous les rappeler quand le marché pousse à les remettre en cause.$f$,
   array['biais comportementaux','finance comportementale','aversion à la perte','émotions','discipline','décision'],
   '[{"titre": "AMF : Mieux connaître ses réactions pour mieux investir : comprendre les biais comportementaux (14 juin 2022)", "url": "https://www.amf-france.org/fr/espace-epargnants/actualites-mises-en-garde/mieux-connaitre-ses-reactions-pour-mieux-investir-comprendre-les-biais-comportementaux", "consulte_le": "2026-10-10"}, {"titre": "AMF : Vous souhaitez mieux vous connaître en tant qu épargnant ? (5 octobre 2022)", "url": "https://www.amf-france.org/fr/espace-epargnants/savoir-bien-investir/conseils-pratiques/mieux-se-connaitre-en-tant-quepargnant", "consulte_le": "2026-10-10"}]'::jsonb, '2026-10-10')
on conflict (slug) do update set theme = excluded.theme, titre = excluded.titre, resume = excluded.resume, contenu = excluded.contenu,
  mots_cles = excluded.mots_cles, sources = excluded.sources, mis_a_jour_le = excluded.mis_a_jour_le, version = public.savoir_fiches.version + 1;
