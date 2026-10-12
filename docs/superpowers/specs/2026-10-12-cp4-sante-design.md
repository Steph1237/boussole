# CP4 : Santé juste, expliquée et lisible, frais des supports compris

Date : 2026-10-12. Statut : demandé par Stéph :
- « plus accurate et clair sur pourquoi on a ce score, améliore l'UX et l'UI » ;
- « prendre en compte les supports, notamment les frais, sont-ils bien optimisés ? ».

## 1. Justesse : corrections constatées sur un portefeuille réel (chiffres non publiés)
1. **Aucune note sans données.** Un critère dont les données manquent n'a pas de note. Il est « à compléter » (gris), ne compte pas dans la famille et n'affiche jamais « tout est au vert ».
   - La note de famille et la note globale indiquent leur **couverture** : « calculée sur 7 critères sur 11 ».
   - En dessous de 60 % de couverture, la note globale est accompagnée de la mention « provisoire ».
2. **Taux d'épargne** : on prend le **réel** dès qu'il existe (`Calc.budgetReel`, comptes courants, 3 mois). Le prévu ne sert qu'en l'absence de réel. La carte précise la source (« réel, juillet à septembre » ou « prévu »).
3. **Argent pour les projets proches** :
   - on compte seulement ce qui est disponible **et peu risqué** : épargne disponible, monétaire, fonds en euros, et obligations courtes si elles sont identifiées ;
   - les actions, le levier, la crypto et les SCPI ne comptent pas pour un projet à moins de 3 ans ;
   - l'écart est affiché : « 71 700 € disponibles, dont 8 300 € sans risque de baisse ».
4. **Apport immobilier** :
   - seules les poches rattachées à l'objectif et la personne de l'objectif comptent ;
   - « à recevoir » est exclu par défaut et affiché à part (« + 18 000 € attendus ») ;
   - le détail par ligne est donné.
5. **Adéquation au profil** :
   - un tableau par classe montre ton %, la fourchette du profil et l'écart en points ;
   - la note dépend de l'écart total, avec un barème affiché ;
   - les comptes courants sont exclus (CP1).
6. **Part spéculative** : les lignes comptées sont listées (levier, crypto), avec leur poids, et le plafond du profil est rappelé.
7. **Matelas** : la mesure est donnée en mois de dépenses réelles. La réserve de fonctionnement est expliquée, ainsi que ce qui est compté (livrets, excédent des comptes courants).
8. **Parité** : les mêmes règles s'appliquent dans l'app (`plan.js`, `pratiques.js`) et dans le connecteur (`index.ts`), avec des tests de parité.

## 2. Nouveau critère : frais des supports (famille Efficacité)
- **Mesure** : coût total annuel estimé, en € et en % de l'encours investi.
  - **Frais des fonds** : Σ (frais courants du fonds × valeur), pour les ETF, OPCVM et unités de compte. Les titres en direct et la crypto valent 0, mais restent comptés dans l'encours.
  - **Frais d'enveloppe** : `config.frais_enveloppes = { "<enveloppe>": { gestion_uc_pct?, gestion_euro_pct?, garde_pct?, source, le } }`. Par exemple, les frais de gestion d'une assurance-vie sur les unités de compte et sur le fonds en euros.
    - Renseignés par Claude, à partir des documents du contrat (proposition de cible `config` ; la clé est ajoutée à la liste blanche de 0019, voir la migration).
    - Sans valeur renseignée, l'enveloppe est « frais d'enveloppe à compléter ».
  - **SCPI** : leurs frais (souscription, gestion) sont montrés à part, à titre d'information : ils ne sont pas comparables à des frais courants. Ils ne comptent pas dans la note.
- **Barème** (repères de Boussole, sourcés dans le savoir, fiche « frais-et-ter ») :

  | Coût total en % de l'encours par an | Note |
  |---|---|
  | ≤ 0,40 % | 20 |
  | 0,40 à 0,75 % | 15 |
  | 0,75 à 1,20 % | 10 |
  | 1,20 à 1,80 % | 5 |
  | au-delà | 0 |

  La note est calculée sur la part de l'encours dont les frais sont connus. En dessous de 70 % de couverture, le critère reste « à compléter », avec le coût partiel affiché.
- **Détail** :
  - les 5 lignes les plus coûteuses, en € par an ;
  - les lignes au-dessus de 0,50 % qui ont, en classe d'actifs, un équivalent courant moins cher. C'est un repère de classe, jamais un produit nommé : « un fonds indiciel actions monde coûte souvent 0,10 à 0,30 % par an » ;
  - la projection de l'écart sur 10 et 20 ans, à rendement égal (intérêts composés) ;
  - bouton « Demander à Claude », qui active l'expertise etf-fonds et les questions sur les frais du contrat.
- **Frais des fonds récupérés automatiquement** : la nuit, pour chaque ISIN de fonds sans frais connus, Boussole lit les frais publiés (Yahoo `quoteSummary`, modules `fundProfile` et `defaultKeyStatistics` : `annualReportExpenseRatio`, ou le champ équivalent disponible).
  - Les frais sont écrits dans `instruments.ter` avec `ter_source = "yahoo"` et `ter_le`. 10 ISIN au plus par nuit, chaque appel coupé au bout de 10 s.
  - Les frais renseignés par Claude à partir d'un DIC (`annotate_instrument`) passent avant ceux de Yahoo.
  - Si un ISIN n'est pas trouvé, il est retenté dans 30 jours.

## 3. Clarté : chaque note s'explique
Contrat d'un critère, dans l'app comme dans le connecteur. Les champs existants sont gardés, ceux-ci sont ajoutés :

```
{ cle, famille, libelle, statut: bon|surveiller|travailler|a_completer, points|null, max: 20,
  mesure: { valeur, unite, texte },            // « 3,1 mois de dépenses »
  repere: { texte, zones: [{ jusqua, statut }] }, // barème lisible et zones pour la jauge
  pourquoi: "une phrase",                      // la raison de la note
  calcul: ["étape 1", "étape 2"],              // la formule en clair, avec les chiffres de l'utilisateur
  donnees: [{ libelle, valeur, lien? }],       // lignes et comptes utilisés, avec lien vers la fiche
  ameliorer: [{ action, gain_points }],        // « +5 points si ton matelas atteint 4 mois (≈ +3 000 €) »
  manque: ["…"], source_donnees: "réel juil.–sept." , confiance: complete|partielle|absente }
```

**Note globale** :
- moyenne pondérée des familles. Les poids (Sécurité 30 %, Effort 25 %, Allocation 30 %, Efficacité 15 %) sont rappelés une seule fois ;
- « points perdus » par critère : contribution = (20 − points) × poids, rapporté sur 100 ;
- « Ce qui te coûte le plus » : les 3 plus gros points perdus, avec l'action correspondante.

## 4. Interface de Santé
- **En-tête** :
  - la note globale en grand, avec un anneau, et une phrase qui la résume ;
  - la couverture des données ;
  - la date de calcul ;
  - « Ce qui te coûte le plus » : 3 lignes cliquables qui ouvrent le critère, avec les points en jeu.
- **Familles en onglets** (Sécurité, Effort, Allocation, Efficacité), pas tout empilé. Chaque onglet montre sa note, sa couverture et ses critères.
- **Carte de critère** :
  - le nom ;
  - une **jauge horizontale à zones** (rouge, orange, vert) avec le repère et la position de l'utilisateur ;
  - la mesure en clair (« 3,1 mois ») ;
  - la note /20 ;
  - le « pourquoi » en une ligne.

  Une carte « à compléter » est grise, avec la donnée manquante et le bouton « Compléter avec Claude ». La phrase « poids 30 % de la note globale » n'est plus répétée sur chaque carte.
- **Panneau de critère**, au clic, dans cet ordre :
  1. Ta situation (mesure et jauge) ;
  2. Pourquoi cette note (barème) ;
  3. Le calcul avec tes chiffres ;
  4. Les données utilisées, avec liens vers les fiches de Patrimoine › Comptes ;
  5. Pour progresser (actions et points gagnés) ;
  6. Ce qui manque ;
  7. Demander à Claude (avec l'expertise adaptée).
- **Accessibilité** :
  - onglets ARIA ;
  - jauges avec texte équivalent ;
  - vrais boutons ;
  - contrastes AA en clair comme en sombre ;
  - l'état n'est jamais porté par la seule couleur : un mot l'accompagne (bon, à surveiller, à travailler, à compléter).
- **Liens profonds** : `#pilotage/sante?famille=<clé>&critere=<clé>`.

## 5. Connecteur
- `get_overview` et `analyser` renvoient le nouveau contrat (`pourquoi`, `calcul`, `ameliorer`, `confiance`).
- Règle de conduite : expliquer une note par ses étapes de calcul et ses actions, jamais par une recommandation de produit.

## 6. Données (migration 0026)
- `instruments` : `ter_source text`, `ter_le date` et `ter_essai_le timestamptz`, si ces colonnes manquent (vérifier 0001 et les migrations suivantes).
- `appliquer_propositions` : la cible `config` accepte la clé `frais_enveloppes`, validée (pourcentages entre 0 et 5, source obligatoire). Repartir exactement de la définition de 0019.

## 7. Tests
- **Calculs purs** : chaque critère sur un jeu fictif aux proportions réalistes (montants inventés). Résultats attendus : frais « à compléter » sans frais courants ; projets proches sans les actions ; apport sans « à recevoir » ; taux d'épargne réel ; adéquation détaillée par classe. Plus le barème des frais, la couverture, les points perdus et les actions.
- **Parité** entre l'app et le connecteur pour tous les critères.
- **Nuit** : lecture des frais par Yahoo, avec un `fetch` simulé.
- **Interface** : onglets, cartes, jauges (texte équivalent), panneau, liens profonds, démo, mobile.
