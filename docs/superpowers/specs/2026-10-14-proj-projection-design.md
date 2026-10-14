# PROJ : moteur de projection, graphique maître, événements de vie et capacité d'emprunt

Date : 2026-10-14. Statut : spec écrite, à relire par Opus (tâche 0 du plan) puis à valider par Stéph.
- Chantier « PROJ » = **SIM1** (moteur de projection) + **SIM2** (graphique des scénarios) + **FOY1-lite** (événements de vie, V1) + **IMMO1** (capacité d'emprunt aujourd'hui et demain, ajouté le 2026-10-14).
- Jalon : **J2 Mon foyer dans 25 ans** (roadmap privée, annexe A.2, A.4, A.5, A.8, A.9).
- Dépend de : **DAT1** (dates des enveloppes, types d'enveloppe, repères fiscaux vérifiés, migration 0029), **HIS1** (historique observé et reconstitué, `web/src/historique.js`, en cours), **CP4** (frais des fonds `instruments.ter`, frais d'enveloppe `config.frais_enveloppes`), **FIX1** (capacité d'épargne).
- Plan : `docs/superpowers/plans/2026-10-14-proj-projection.md`.
- Données d'exemple : fictives uniquement (« PEA Exemple », « Enfant 2 », 1 234 €).

---

## 0. Décisions en bref

Les décisions 1 à 10 sont celles de Stéph (2026-10-14) : elles ne se rediscutent pas. Les choix de conception de cette spec sont marqués **[C]**.

1. **Un seul moteur** pour tous les écrans (Aujourd'hui, Placements, Objectifs, Immobilier et crédits) et pour le Copilote : `web/src/projection.js`, JavaScript pur, UMD, sans DOM. **[C]** Le connecteur n'en a pas un portage écrit à la main : il reçoit une **copie générée** du même fichier (`npm run gen`, comme `formulaire-logique.gen.ts`), et un test vérifie que la copie est à jour et que les sorties sont identiques. Tous les calculs de projection existants migrent dessus (§ 13).
2. **Pas mensuel. Euros constants (euros d'aujourd'hui) par défaut**, euros courants sur demande. Inflation tirée d'un repère sourcé (objectif de la BCE, § 11).
3. **Monte-Carlo** : 2 000 chemins, **graine fixe** (résultat reproductible), rendement, volatilité et corrélations par classe d'actifs tirés des statistiques sourcées déjà dans Boussole (`web/src/marche.js`). **Pessimiste / central / optimiste = centiles 10 / 50 / 90.** Bandes P25–P75 et P10–P90. Levier modélisé avec la perte due à la volatilité et le coût de financement. Règle de rééquilibrage explicite. **Mêmes tirages** pour toutes les variantes (nombres aléatoires communs).
4. **Crises historiques rejouées** (2000-2002, 2008, 2020, 2022, inflation 1973-1974) à une date choisie, comme scénarios **séparés**, jamais mêlés au P10.
5. **Toujours net de frais** (frais des fonds + frais d'enveloppe). **Net d'impôts en option** (« si tu retirais tout à cette date »), par enveloppe et selon son ancienneté, avec les règles vérifiées de DAT1 et de cette spec (§ 11). Aucun chiffre fiscal inventé : ce qui n'est pas vérifié est marqué, et le moteur n'applique pas de valeur de secours.
6. **Versements** tirés de la capacité d'épargne réelle (FIX1), avec une évolution explicite (hypothèse de hausse des salaires, événements), répartis selon les versements programmés puis une cascade explicite. Le libellé contradictoire « réel / d'après l'épargne prévue au budget » disparaît (§ 13.2).
7. **Périmètre = patrimoine net** (financier + immobilier − dettes), avec les vues **financier** et **disponible**, et le sélecteur de périmètre existant (foyer, chaque personne).
8. **Événements de vie V1** : naissance (coût par âge sourcé), crèche, école privée par niveau, achat immobilier (apport retiré des enveloppes dans un ordre qui tient compte de l'impôt et des dates DAT1, vrai tableau d'amortissement, mensualité qui réduit la capacité, bien et dette dans le patrimoine), retrait ponctuel, hausse de revenu (avec la part épargnée), fin de crédit (mensualité libérée réaffectée selon une règle), crise. Plus tard, sans casser le modèle : chômage, séparation, invalidité, retraite. **[C]** Les événements sont des **lignes de table** (`foyer_evenements`, `foyer_variantes`), avec RLS, politique restrictive de double authentification (modèle 0028), export et suppression. Ils ne sont saisis que par le Copilote, en propositions validées dans l'app.
9. **Graphique SIM2** : une courbe continue du passé (observé et reconstitué) au futur (éventail), marqueur « Aujourd'hui », jalons sous l'axe, objectifs en cibles avec leur probabilité, phrase de titre, contrôles minimaux, « Comment c'est calculé », tableau accessible, variante en seconde couleur. **Le même composant** sert sur Aujourd'hui, Placements, Objectifs et Immobilier (IMMO1), avec des réglages par défaut différents.
10. **Performance** : moins de 150 ms pour 2 000 chemins × 300 mois dans le navigateur. **[C]** Tableaux typés, boucle « mois à l'extérieur, chemins à l'intérieur », calcul dans un *Web Worker*, premier affichage avec 500 chemins (§ 9).
11. **IMMO1** (ajout du 2026-10-14) : capacité d'emprunt **aujourd'hui** (règles HCSF, revenus retenus comme le font les banques, reste à vivre, taux du jour sourcé, apport réellement mobilisable) et **demain** (trajectoire calculée par le même moteur). La logique de `web/src/toise.js` (Pilotage › Rang) migre dans le moteur partagé. Outil MCP `capacite_emprunt`. Jamais présenté comme une offre : « estimation selon les règles du HCSF, chaque banque décide » (§ 8).

## 1. Règles d'or appliquées

| Règle (roadmap § 2) | Application dans PROJ |
|---|---|
| 1. MCP d'abord, app en lecture seule | Événements, variantes et réglages arrivent par propositions (`decrire_foyer`). L'app n'écrit rien ; ses contrôles (horizon, variante, crise, vue) sont des réglages d'affichage locaux, jamais enregistrés. Outils `lire_foyer`, `projeter`, `comparer_variantes`, `capacite_emprunt`. |
| 2. Sécurité | Deux nouvelles tables avec RLS de propriétaire **et** politique restrictive `aal2 si facteur` (0028) ; `test/mfa-pglite.test.mjs` les détecte. Aucun nom d'enfant : un libellé court (« Enfant 2 »). Export et suppression du compte couverts. |
| 3. Simple | Une phrase de titre, une courbe, trois contrôles. Les hypothèses et leurs sources sont dans « Comment c'est calculé ». |
| 4. Simulation précise et comparable | Euros constants, hypothèses sourcées et datées, mêmes tirages pour les variantes, une bande et jamais une ligne seule, même moteur dans l'app et le connecteur, cas calculés à la main (§ 12). |
| 5. Pas de note sans données | Une donnée qui manque donne « à compléter », pas une valeur inventée (frais d'école, prix d'achat d'un bien, taux d'un crédit). La projection affiche sa couverture (§ 6.6). |
| 7. Questions au bon format | Le Copilote part des valeurs par défaut sourcées et ne demande que ce qui change le résultat (§ 7.3). |
| 9. Honnête | « Une projection n'est pas une promesse. » Jamais « conseiller », jamais un produit nommé : des classes d'actifs et des enveloppes. IMMO1 : « estimation, chaque banque décide ». |
| Tutoiement | Tous les textes. |

## 2. Le modèle actuel et ses défauts

| # | Défaut constaté (code au 2026-10-14) | Effet | Correction dans PROJ |
|---|---|---|---|
| 1 | **Euros courants.** `Plan.projection`, `Historique.projeter` et la série d'un objectif capitalisent en nominal ; la note d'Objectifs dit « hors inflation ». | Sur 25 ans à 2 % d'inflation, un montant paraît 64 % plus gros que son pouvoir d'achat. | Calcul interne en nominal (l'impôt porte sur les gains nominaux), **affichage en euros constants** par défaut (§ 4.2). |
| 2 | **Scénarios à taux fixes choisis à la main** (`Plan.RENDEMENTS` : « Nasdaq 2x » pessimiste −2 %, optimiste +16 %…). La table d'une poche s'applique chaque année. | Aucune probabilité derrière « pessimiste » ; une baisse ne se produit jamais ; l'ordre des rendements n'existe pas. Déjà écarté dans la roadmap (§ 12). | Monte-Carlo par classe avec corrélations, P10/P50/P90 ; crises réelles rejouées à part (§ 4.4, § 4.6). |
| 3 | **Somme des scénarios par poche.** Le « pessimiste » total additionne les pessimistes de chaque poche. | Corrélation parfaite implicite : la somme de centiles n'est pas le centile de la somme. | Les centiles sont pris sur le **total de chaque chemin** (§ 4.5). |
| 4 | **Levier à taux fixe** (9 % central). | La perte due au recalibrage quotidien et le coût de financement sont ignorés : un ×2 paraît meilleur qu'il n'est en marché agité. | Modèle du levier quotidien : `L·x − (L−1)·r − L(L−1)σ²/2` (§ 4.4.3). |
| 5 | **Aucun frais, aucun impôt.** | Surestimation de 0,5 à 1,5 % par an selon les enveloppes ; montants « bruts » non retirables. | Frais des fonds et d'enveloppe toujours déduits ; option « net d'impôts si tu retirais tout » (§ 5). |
| 6 | **Versement plat, réparti comme le portefeuille actuel.** | Une épargne nouvelle irait proportionnellement en crypto et en levier ; aucune hausse de salaire, aucune naissance, aucune fin de crédit. | Flux du foyer mois par mois et cascade d'affectation explicite (§ 6). |
| 7 | **Source du versement contradictoire.** Objectifs affiche l'étiquette « réel » avec la source « d'après l'épargne prévue au budget » (`objectifs-view.js`, `versementReel`), et lit l'épargne **prévue** (`totaux.epargne`), pas la capacité d'épargne réelle de FIX1. | L'utilisateur ne sait pas ce qui est projeté. | Une seule source, nommée : la capacité d'épargne réelle (3 derniers mois des comptes courants), sinon la capacité prévue du budget, dite comme telle (§ 6.1, § 13.2). |
| 8 | **Financier seulement ; immobilier et dettes figés.** `Historique.projeter` ajoute `horsFin` constant. | Un crédit ne baisse jamais : le patrimoine net futur est **sous-estimé** de tout le capital remboursé ; le bien ne suit pas les prix. | Patrimoine net : biens revalorisés selon une hypothèse sourcée, crédits amortis selon leur vrai tableau (§ 6.4). |
| 9 | **Aucun événement de vie.** | « Où va-t-on avec nos enfants, nos crédits ? » n'a pas de réponse. | Événements V1 (§ 7). |
| 10 | **Plusieurs projections incohérentes** : `Plan.projection` (Objectifs), `Historique.projeter` (Aujourd'hui), `Plan.valeurFuture` avec le `rendement` saisi de chaque objectif (2 % par défaut, sans rapport avec ses poches), `Plan.dateAtteinte` / `statutObjectif`, leurs portages dans `supabase/functions/mcp/index.ts`, `loanPlan` de `toise.js` avec des taux codés en dur, la projection des frais de `pratiques.js`. | Deux écrans donnent deux avenirs différents pour la même personne. | Un moteur, une copie générée pour le connecteur, migration de chaque appel (§ 13). |
| 11 | **Objectif binaire** (« en avance », « en retard ») sans probabilité. | Faux sentiment de certitude. | Probabilité d'atteinte sur les chemins (§ 10.4). SIM3 ira plus loin (calcul inverse). |
| 12 | **Capacité d'emprunt d'aujourd'hui seulement**, taux codés en dur (`LOAN.rates`), aucune date de source. | Ni « combien dans 3 ans ? », ni date du taux. | IMMO1 : repères datés, trajectoire calculée par le moteur (§ 8). |

## 3. Architecture

```
web/src/projection.js        moteur pur (UMD, global Projection) : modèle, flux, Monte-Carlo, crises, fiscalité de sortie,
                             capacité d'emprunt, amortissement ; dépend de Marche, Calc, Plan (repartirEpargne),
                             Calendrier (DAT1 : types et dates d'enveloppe), Reperes — injectés ou globaux
web/src/projection-worker.js Web Worker : importScripts des modules purs, reçoit { data, options }, renvoie le résultat
web/src/graphe-patrimoine.js composant SIM2 : le graphe maître créé par HIS1 (GraphePatrimoine), généralisé : éventail, jalons,
                             objectifs, variante, crise, mode capacité ; tableau et panneau « Comment c'est calculé » (UI.panneau)
supabase/functions/mcp/projection-moteur.gen.js   copie générée de projection.js (+ marche.js, calendrier.js, reperes.js)
supabase/functions/mcp/projection.ts              outils MCP (decrire_foyer, lire_foyer, projeter, comparer_variantes,
                                                  capacite_emprunt), lecture SQL → forme de l'app, puis appel du moteur
supabase/migrations/0030_projection.sql           tables, propositions, repères, indices mensuels
```

- **Pourquoi une copie générée et pas un portage TypeScript** : un portage à la main (comme `calendrier.ts` de DAT1) double le risque d'écart sur un moteur de plusieurs centaines de lignes de calcul numérique. La copie générée garantit l'identité du code ; le test de parité vérifie en plus les sorties sur les cas de référence. Les fonctions Edge ne peuvent pas importer `web/src` (hors du dossier de la fonction) : le script de génération recopie les modules UMD dans un fichier ES qui les évalue dans l'ordre et exporte `Projection`.
- **Entrée unique du moteur** : `data` = formes de l'app (le connecteur convertit ses lignes SQL au début, comme DAT1) :
  `{ today, positions, instruments, config, profil, credits, biens, budget, banque, objectifs, foyer: { evenements, variantes }, reperes, indices, calendrier? }`. `calendrier` est la sortie de `Calendrier.calendrier(data, today)` ; s'il manque, le moteur l'appelle.
- **API** (mêmes noms côté connecteur) :

```
Projection.preparer(data, options) → modele            // pur, déterministe : compartiments, flux, échéancier des événements
Projection.simuler(modele, opts)    → resultat          // Monte-Carlo (opts.chemins, opts.graine) ou déterministe (opts.volatilite = 0)
Projection.crise(modele, { cle, debut })  → resultat     // un chemin : rendements attendus, sauf la fenêtre de crise
Projection.comparer(modeleA, modeleB, opts) → comparaison // mêmes tirages ; écarts par centile et chemin par chemin
Projection.fiscaliteSortie(compartiment, date, ctx) → { brut, impot_revenu, prelevements_sociaux, net, regle, sources, confiance }
Projection.amortissement({ capital, taux_pct, duree_mois, assurance_pct, debut }) → [{ mois, date, interets, capital, assurance, crd }]
Projection.capaciteEmprunt(data, { perimetre, date?, duree_ans?, taux_pct?, neuf?, primo? }) → capacite      // § 8.1
Projection.capaciteDansLeTemps(modele, resultat, { duree_ans }) → serie                                      // § 8.2
Projection.HYPOTHESES, Projection.EVENEMENTS, Projection.GRAINE, Projection.versionModele
```

- **`options`** : `{ horizon_ans: 5|10|15|20|25 (défaut 10), perimetre: "foyer"|"p1"|"p2", vue: "net"|"financier"|"disponible" (défaut "net"), euros: "constants"|"courants", net_impots: bool (défaut faux), variante: id|null, chemins: 2000, graine: GRAINE }`.
- **`versionModele`** : chaîne incrémentée à chaque changement de calcul ; elle est rendue avec chaque résultat et consignée au journal par le Copilote quand un scénario est retenu (pour CK5 : rejouer une projection passée contre le réel).

## 4. Le moteur financier

### 4.1 Compartiments

- Un **compartiment** = (enveloppe, titulaire, classe d'actifs). Chaque ligne comptée de `positions` (périmètre et statuts comme `Calc.financier`) rejoint le compartiment de son enveloppe et de sa classe.
- **Classe** : `Marche.classeRisque(position, surcharges)` (classes de `Marche.CLASSES`). Un produit à levier garde sa classe `levier`, avec deux attributs : `multiple` (2 ou 3, lu dans le nom comme `Marche.LEVIER`) et `sous_jacent` (classe de l'indice : `actions` par défaut, `actions_nasdaq100` quand le nom ou la poche l'indique, § 4.4.3).
- **Type d'enveloppe** : celui de DAT1 (`config.enveloppes_infos[clé].type`, sinon `Calendrier.typeDeduit(nom)`). Il porte les frais (§ 5.1), la fiscalité (§ 5.2) et la disponibilité. Comptes courants rattachés (`banque_comptes`) et liquidités : type `courant`.
- **Disponible** : compartiments de type `courant`, `livret_a`, `ldds`, `lep`, `cel` et livrets non classés : ce que la page Placements qualifie de « disponible tout de suite » (`pilotage.js`, `disponibilite`). Le matelas (`config.cushion`) est une part du disponible.
- **Base fiscale** (prix de revient) suivie par compartiment, en nominal : valeur d'achat (`qty × pru`) pour les lignes cotées ; `versements_cumules` de DAT1 pour une assurance-vie, un PER ou un PEA quand ils sont connus ; à défaut, la valeur d'aujourd'hui (aucun gain latent supposé, ce qui **sous-estime** l'impôt d'aujourd'hui) avec la mention « prix de revient à compléter » (§ 6.6). Les versements futurs s'ajoutent à la base ; un retrait la réduit au prorata.
- Un compartiment reçoit aussi `ter_pct` (moyenne pondérée de `instruments.ter` de ses lignes, 0 pour les titres en direct et la crypto, comme CP4) et `frais_enveloppe_pct` (`config.frais_enveloppes`, § 5.1).
- **Biens** (`biens`) et **crédits** (`credits`, `biens.crd`) sont hors compartiments financiers : § 6.4.

### 4.2 Pas de temps, inflation, euros constants

- **Mois** `t = 0 … 12 × horizon`. `t = 0` est aujourd'hui (valeurs du jour). Les mois sont datés au même quantième que `today` (`Historique.plusMois`, dernier jour du mois s'il n'existe pas).
- **Ordre des opérations dans un mois** (contrat, testé) : 1) rendement du mois sur chaque compartiment ; 2) frais du mois ; 3) flux du foyer (revenus − dépenses − mensualités − coûts d'événements = capacité du mois) et affectation (§ 6.2), versements **en fin de mois** (même convention que `Plan.valeurFuture`) ; 4) événements datés de ce mois (achat, retrait) ; 5) amortissement des crédits ; 6) relevé des vues.
- **Calcul en nominal, affichage en euros constants.** L'inflation `π` est le repère `inflation_hypothese` (2 %, objectif de la BCE, § 11.1), déterministe et identique pour tous les chemins. Déflateur `D(t) = (1 + π)^(−t/12)`. Une valeur affichée en euros constants est `V_nominal(t) × D(t)`.
- Les montants que l'utilisateur donne aujourd'hui (salaire, dépenses, coûts d'événements, cibles d'objectifs) sont **en euros d'aujourd'hui** : ils deviennent nominaux par `× (1 + π)^(t/12)`. Les montants fixés en nominal par contrat (mensualité d'un crédit à taux fixe, taux réglementés) restent nominaux, donc baissent en euros constants : c'est voulu, et c'est ce que l'ancien modèle ignorait.
- Option `euros: "courants"` : mêmes calculs, sans déflateur à l'affichage.
- **Limite assumée (V1)** : l'inflation n'est pas aléatoire. La dispersion du pouvoir d'achat vient seulement de celle des rendements nominaux. Le scénario « inflation 1973-1974 » montre ce que coûte une inflation forte (§ 4.6).

### 4.3 Rendements attendus par classe

- Source : `Marche.CLASSES` (`rendementLong`, `volatilite`) et `Marche.CORRELATIONS`, statistiques déjà sourcées dans Boussole (SP2). Table complète et sources au § 11.3.
- **Interprétation [C]** : `rendementLong` est un **rendement géométrique annuel nominal** (taux de croissance médian, avant frais des fonds). Le logarithme du rendement mensuel suit une loi normale de moyenne `μ_m = ln(1 + rendementLong) / 12` et d'écart type `σ_m = volatilite / √12`. Conséquence vérifiable : sans versement ni frais, la médiane des chemins à `T` ans vaut `V0 × (1 + rendementLong)^T` (cas MC-1, § 12.2).
- **Monétaire et livrets** : le repère du taux réglementé en vigueur (`livret_a_taux`, `lep_taux`) jusqu'à sa `date_fin` (DAT1), puis le rendement long de la classe `monetaire`. Volatilité 0 pour les livrets réglementés (taux connu à l'avance), celle de la classe pour un fonds monétaire.
- **Fonds euros** : rendement long de la classe `fonds_euros`, volatilité 0 (capital garanti).
- **Immobilier physique** (biens, § 6.4) : classe ajoutée `immobilier_physique` : `π + immo_revalorisation_reelle` (repère), volatilité `immo_volatilite` (repère à calculer, § 11.4), corrélations de la classe `immobilier` de `Marche`. Les SCPI restent dans la classe `immobilier` de `Marche` (rendement total, distribution comprise) ; la part distribuée est traitée au § 5.3.

### 4.4 Monte-Carlo

#### 4.4.1 Tirages
- **Générateur** : `xoshiro128**` sur des entiers de 32 bits, un état par chemin, initialisé par `splitmix32(graine ⊕ (i × 0x9E3779B9))` pour le chemin `i`. Normales par Box-Muller (les deux valeurs servent, dans un ordre fixe). `GRAINE = 20261014` par défaut.
- **Nombres aléatoires communs** : pour le chemin `i` et le mois `t`, le moteur tire **toujours** un vecteur de normales indépendantes de la même longueur, une par classe de la liste fixe `Projection.CLASSES_TIREES` (toutes les classes de `Marche.CLES` + `actions_nasdaq100` + `immobilier_physique`), **même si le foyer ne détient pas la classe**. Ainsi le choc de la classe `k` au mois `t` du chemin `i` est le même quelles que soient la variante, l'allocation ou l'horizon. Test : une variante qui ne fait qu'ajouter 100 € par mois donne, **chemin par chemin**, une valeur supérieure ou égale (cas MC-4).
- **Corrélations** : `z = L · ε`, `L` facteur de Cholesky de la matrice de corrélation des classes tirées (calculé une fois). Si la matrice n'est pas définie positive (corrélations simplifiées), elle est corrigée par projection sur la matrice définie positive la plus proche (méthode de Higham), et un test vérifie que l'écart reste sous 0,02 par coefficient. Classes à volatilité 0 : tirées quand même (pour la stabilité des flux), sans effet.
- **Loi** : normale sur les log-rendements mensuels. **Limite assumée** : pas de queues épaisses ; les crises rejouées (§ 4.6) montrent les chocs extrêmes, et le texte le dit.

#### 4.4.2 Rendement d'un compartiment
`ln(1 + r_k,t) = μ_m,k + σ_m,k · z_k,t` pour une classe `k` sans levier.

#### 4.4.3 Levier quotidien
Un produit qui vise `L` fois la performance **quotidienne** d'un indice de classe `u` (sous-jacent), recalibré chaque jour, suit sur un mois :

`ln(1 + r_L,t) = L · x_u,t − (L − 1) · r_fin / 12 − L (L − 1) · σ_u² / 24`

où `x_u,t = μ_m,u + σ_m,u · z_u,t` est le log-rendement du sous-jacent **sur le même tirage** (le produit à levier est donc corrélé à son indice sans tirage propre), `σ_u` sa volatilité annuelle, `r_fin` le coût de financement annuel (repère `estr_taux`, taux €STR de la BCE, § 11.4). Les frais du produit (`ter_pct`) sont déduits au § 5.1 comme pour tout fonds.
- Résultat classique pour un levier recalibré chaque jour sur un indice log-normal : `V_L(T) = V_L(0) · (S_T / S_0)^L · exp(−(L−1) r_fin T − L(L−1) σ² T / 2)`. Le dernier terme est la **perte due à la volatilité** : elle croît comme `σ²` et peut annuler l'effet du levier.
- Exemple (cas D-9, § 12.1) : sous-jacent à 7 % par an et 22,5 % de volatilité, financement 2 %, frais 0,6 % : un ×2 croît en médiane d'environ **6,0 % par an**, moins que son indice (7 %). L'ancien modèle supposait 9 %.
- Le sous-jacent par défaut est `actions` (Marche) ; `actions_nasdaq100` (repères `nasdaq100_rendement`, `nasdaq100_volatilite`, à sourcer en tâche 0, § 11.4) est pris quand le nom ou la poche contient « nasdaq ». Tant que ces repères manquent, le moteur prend `actions` et l'écrit (« volatilité de l'indice supposée égale à celle des actions monde : la perte due au levier est sous-estimée »).
- Limite : la ruine intrajournalière (baisse de plus de 1/L en un jour) n'est pas modélisée.

#### 4.4.4 Rééquilibrage
- **Règle par défaut [C] : aucun rééquilibrage du stock.** Chaque compartiment suit sa classe ; seuls les **nouveaux versements** vont vers la cible (§ 6.2). C'est ce que font la plupart des foyers, et cela n'invente aucune vente (donc aucun impôt caché).
- **Option `reequilibrage: "annuel"`** (réglage `config.projection` ou hypothèse d'une variante) : chaque mois de janvier, les compartiments **d'une même enveloppe** sont ramenés à l'allocation cible du profil (`config.targets`, fourchettes de `Risque`), sans frottement ni impôt (un arbitrage à l'intérieur d'une enveloppe n'est pas imposé ; un compte-titres est exclu de l'option, parce qu'une vente y serait imposée). Cette option servira de levier à SIM4.

### 4.5 Résultats
- Pour chaque mois et chaque vue (`net`, `financier`, `disponible`), en euros constants (ou courants) : centiles **P10, P25, P50, P75, P90** pris sur le **total de chaque chemin**. Le centile est la valeur de rang `⌈p × N⌉` des valeurs triées (définition fixe, testée).
- **Probabilités** : pour chaque objectif, part des chemins où la valeur de ses poches atteint sa cible à sa date (§ 10.4) ; **« manquer d'argent »** : part des chemins où, un mois, le disponible et les enveloppes mobilisables ne couvrent plus un besoin (capacité négative, apport) ; la première date où cela arrive dans 10 % des chemins.
- **Jalons** (événements, DAT1, fins de crédit, objectifs) avec leur effet en euros (§ 7.4).
- **Hypothèses et sources** utilisées (clé, valeur, unité, source, date de vérification), **avertissements** (données à compléter, repères à revérifier), **couverture** (§ 6.6), `versionModele`, `graine`, `chemins`.

### 4.6 Crises rejouées
- Source : `Marche.CRISES` (chocs cumulés par classe du sommet au creux, dates de début et de fin) : `dotcom_2000`, `gfc_2008`, `covid_2020`, `taux_2022`, `inflation_1973`.
- **Un seul chemin** : rendements attendus (`μ_m`, sans aléa) partout, sauf pendant la fenêtre de crise qui commence au mois choisi `debut` et dure `d` mois (`d` = mois entre `debut` et `fin` de la crise, 31 mois pour 2000-2002, 17 pour 2008, 1 pour 2020, 9 pour 2022, 23 pour 1973-1974). Pendant la fenêtre, le log-rendement mensuel de la classe `k` vaut `ln(1 + choc_k) / d`. Les produits à levier prennent le choc `levier` de la crise (reconstitution qui inclut déjà la perte due à la volatilité), pas la formule du § 4.4.3.
- Après la fenêtre, rendements attendus. **Aucun rebond n'est forcé** (le rebond réel n'est pas dans les données de `Marche`) : c'est prudent, et le texte le dit (« après la crise, la projection reprend les rendements moyens ; dans l'histoire, les marchés sont remontés plus vite »).
- **Inflation 1973-1974** : pendant la fenêtre, l'inflation mensuelle suit les taux annuels français de 1973 et 1974 (Insee, repère à relever en tâche 0, § 11.4), au lieu de 2 %. C'est ce scénario qui montre la perte de pouvoir d'achat de l'épargne sans risque.
- Date par défaut : le mois d'aujourd'hui + 12 ; l'utilisateur ou le Copilote la choisit (par exemple « juste avant l'achat »). Les flux, événements et règles de retrait sont les mêmes que pour le Monte-Carlo.
- Un événement `crise` (§ 7.1) fixe la crise et sa date d'une variante.
- Affichage : une ligne pointillée, jamais mêlée à l'éventail.

### 4.7 Mode déterministe
`simuler(modele, { volatilite: 0 })` : un chemin unique, `z = 0` partout. Les rendements valent `μ_m` ; la perte du levier reste (elle est structurelle). Sert aux cas de test (§ 12.1), au calcul des efforts d'objectif (§ 13.3) et au comparateur des frais de Santé.

## 5. Frais et impôts

### 5.1 Frais (toujours)
- Chaque mois, après le rendement : `V ← V × (1 − f)^(1/12)`, avec `f = ter_pct + frais_enveloppe_pct` du compartiment. Un an de frais `f` retire exactement la fraction `f` (cas D-5).
- `frais_enveloppe_pct` : `gestion_uc_pct` (unités de compte d'une assurance-vie ou d'un PER), `gestion_euro_pct` (fonds euros), `garde_pct` (droits de garde d'un compte-titres ou d'un PEA) de `config.frais_enveloppes` (CP4). Absent : 0, et l'avertissement « frais d'enveloppe à compléter » (la projection est alors un peu optimiste, et le dit).
- SCPI : les frais de souscription sont déjà dans l'écart entre prix de part et valeur de retrait (la valeur de la ligne est sa valeur de retrait) ; les frais de gestion sont déjà déduits du taux de distribution publié. Aucun frais supplémentaire.

### 5.2 « Net d'impôts si tu retirais tout à cette date »
Option d'affichage : pour chaque chemin et chaque mois, la valeur nette = Σ des compartiments de `fiscaliteSortie(compartiment, date)`. Les centiles sont pris sur ce net. Règles par type d'enveloppe (sources et statut au § 11.2) :

| Type | Gain imposable | Impôt sur le revenu | Prélèvements sociaux | Remarque |
|---|---|---|---|---|
| `livret_a`, `ldds`, `lep` | — | 0 | 0 | Exonérés. |
| `courant` | — | 0 | 0 | Pas de gain. |
| `pel`, `cel` | intérêts | 12,8 % (`ir_taux_forfaitaire`) | 17,2 % (`ps_taux_av_epargne_logement`) | PEL ouvert depuis 2018. Avant : intérêts des 12 premières années exonérés d'IR (DAT1 `pel_12_ans`). |
| `pea`, `pea_pme`, `pea_jeune` **avant** `pea_5_ans` | `V − base` | 12,8 % | 18,6 % (`ps_taux_general`) | Le retrait clôture le plan (DAT1). |
| idem **après** `pea_5_ans` | `V − base` | 0 | 18,6 % | Règles particulières des gains d'avant 2018 ignorées (limite écrite). |
| `compte_titres` | `V − base` | 12,8 % | 18,6 % | Prélèvement forfaitaire unique ; l'option pour le barème et l'imputation des moins-values reportables (DAT1 `moins_values`) sont ignorées en V1. |
| `assurance_vie`, `capitalisation` **avant** `av_8_ans` | `V − base` | 12,8 % | 17,2 % | |
| idem **après** `av_8_ans` | `V − base` | après abattement annuel `av_abattement_seul` / `av_abattement_couple` (couple soumis à imposition commune) : 7,5 % (`av_taux_ir_reduit`) sur la part du gain qui correspond à des primes nettes sous `av_seuil_versements` (150 000 €, tous contrats du titulaire), 12,8 % au-delà | 17,2 % sur tout le gain | Répartition au prorata des primes : à confirmer (§ 11.5). Abattement consommé une fois par année civile et par foyer, partagé entre les retraits de l'année. |
| `per` | versements déduits | barème : `TMI × versements déduits` | 0 sur les versements | Gains : 12,8 % + 18,6 %. **Bloqué** jusqu'à la retraite, sauf achat de la résidence principale : la ligne le dit. TMI et part déduite : hypothèses du foyer (§ 5.4). |
| `pee`, `percol` | gains | 0 | 18,6 % | Disponibilité selon DAT1 ; règle des gains à confirmer (§ 11.5). |
| crypto (classe `crypto`, toute enveloppe compte-titres) | `V − base` | 12,8 % | 18,6 % (à confirmer, § 11.5) | Formule globale du portefeuille (art. 150 VH bis) simplifiée : gain = valeur − prix total d'acquisition. |
| SCPI en direct | plus-value | 19 % (`pv_immo_ir_taux`) après abattement pour durée de détention | 17,2 % (`pv_immo_ps_taux`) après abattement | Régime des plus-values immobilières (à confirmer pour les parts de SCPI, § 11.5). Abattements : IR 6 % par an de la 6ᵉ à la 21ᵉ année, 4 % la 22ᵉ ; PS 1,65 % par an de la 6ᵉ à la 21ᵉ, 1,60 % la 22ᵉ, 9 % par an de la 23ᵉ à la 30ᵉ. Surtaxe au-delà de 50 000 € de plus-value imposable : signalée, non calculée en V1. |
| SCPI dans une assurance-vie | — | règle de l'assurance-vie | | Le compartiment suit son enveloppe. |
| Résidence principale | — | 0 | 0 | Exonérée. |
| Autre bien | plus-value | 19 % | 17,2 % | Mêmes abattements ; prix d'achat requis (§ 6.4), sinon « à compléter » et montant brut. |

- **Date d'ouverture inconnue** (DAT1 `a_completer`) : le moteur applique la règle **la plus prudente** (avant 5 ans, avant 8 ans) et le dit (« date d'ouverture à compléter : fiscalité d'avant 8 ans appliquée »). Une date approchée suit la convention de DAT1 (au plus tard).
- **Base inconnue** : gain 0 et mention « prix de revient à compléter » (§ 4.1).
- Repère manquant : la règle est indisponible, l'option « net d'impôts » est désactivée pour ce compartiment (montant brut, mention), jamais une valeur de secours.
- La valeur nette est une estimation « toutes choses égales » : elle ne tient compte ni des tranches traversées par une sortie de PER, ni de la surtaxe, ni des frais de vente d'un bien. Le panneau le dit.

### 5.3 Impôt pendant la vie du placement
- SCPI en direct : la distribution (`scpi_taux_distribution`, repère, § 11.4) est une part du rendement total de la classe ; elle est versée chaque mois au disponible **après** impôt au barème (`TMI`) et prélèvements sociaux sur les revenus fonciers (17,2 %, `ps_taux_foncier`), et le reste du rendement (variation du prix de part) reste dans le compartiment. Sans `scpi_taux_distribution`, toute la performance reste dans le compartiment (limite écrite).
- Fonds euros : les prélèvements sociaux annuels sur les intérêts sont pris **à la sortie** en V1 (écart faible, écrit).
- Compte-titres : fonds supposés capitalisants ; dividendes et coupons ignorés en V1.

### 5.4 Hypothèses fiscales du foyer
- `tmi_pct` : taux marginal d'imposition, parmi les taux du barème (0, 11, 30, 41, 45 %, repère `ir_bareme_taux` à vérifier en tâche 0). Lu dans `config.projection` ; absent, l'option « net d'impôts » utilise 30 % et le dit (« taux marginal supposé de 30 %, à confirmer avec Claude »). PAT1 le calculera.
- `per_versements_deduits` : vrai par défaut (cas le plus courant), dit dans le panneau.
- `couple_imposition_commune` : déduit de `profil.foyer` (marié ou pacsé).

## 6. Les flux du foyer

### 6.1 Capacité d'épargne de départ
- **Source unique et nommée** (même règle que Santé, CP4 § 1.2, et FIX1) : la **capacité d'épargne réelle** (`Calc.budgetReel`, comptes courants, 3 derniers mois complets) quand elle existe ; sinon la **capacité prévue** (`Plan.capaciteEpargne(Plan.budgetTotaux(...))` : épargne prévue + reste positif). Le résultat porte `capacite_source: "reel" | "prevu"` et sa période (« réel, juillet à septembre »).
- Elle se décompose en `revenus_0` (revenus nets mensuels du périmètre), `depenses_0` (dépenses hors mensualités de crédit) et `mensualites_0` (crédits en cours) : `capacite_0 = revenus_0 − depenses_0 − mensualites_0`. Si le budget ne permet pas la décomposition (réel connu seulement en total), `depenses_0 = revenus_0 − mensualites_0 − capacite_0`.
- Périmètre d'une personne : ses revenus, ses crédits propres, la moitié des crédits communs (règle de `Plan.lignesCredits`), la moitié des dépenses communes du budget.

### 6.2 Chaque mois
```
revenus(t)    = Σ personnes salaire_net(t) + autres revenus du budget, en € d'aujourd'hui → nominal
salaire_net(t)= salaire_0 × (1 + salaire_croissance_reelle)^(t/12) + Σ hausses de revenu en vigueur
depenses(t)   = depenses_0 + Σ coûts d'événements en vigueur (enfants, crèche, école, charges d'un bien acheté) − loyer remplacé
mensualites(t)= Σ échéances des crédits en cours et nouveaux (nominal, tableau d'amortissement), assurance comprise
capacite(t)   = revenus(t) − depenses(t) − mensualites(t) + revenus nets distribués (SCPI) + mensualités libérées réaffectées − …
```
- **Hausse des salaires** : repère `salaire_croissance_reelle` (0,5 % par an en euros constants, Insee, § 11.1), ou la valeur du foyer (`config.projection.salaire_croissance_reelle_pct`). Elle s'applique aux salaires seulement.
- **Réponse de l'épargne** : par défaut, toute hausse de revenu non suivie d'une hausse des dépenses s'épargne. Une hausse de revenu déclarée comme événement porte sa `part_epargnee_pct` (§ 7.1) ; la croissance tendancielle des salaires suit `config.projection.part_hausse_epargnee_pct` (défaut 50 %, hypothèse dite comme telle, levier de SIM4), le reste est supposé dépensé.
- **Affectation d'une capacité positive (cascade [C], testée)** :
  1. **versements programmés** (`config.recurring`) vers leurs lignes, même si la capacité ne les couvre pas (ce sont des virements automatiques : l'écart est pris sur le disponible) ;
  2. **matelas** : le disponible jusqu'au plafond du matelas (`config.cushion`) ;
  3. **objectifs** : les poches des objectifs en cours, selon `Plan.repartirEpargne` (priorité puis échéance), effort calculé avec le rendement attendu net de frais des poches (§ 13.3) ;
  4. **le reste** selon `config.projection.reste_capacite` : `"cible"` (allocation cible du profil, `config.targets`, dans les enveloppes ouvertes, ordre PEA puis assurance-vie puis compte-titres tant que le plafond n'est pas atteint) ou `"disponible"` (reste en épargne disponible). **Défaut : `"disponible"`** quand aucune allocation cible n'existe, `"cible"` sinon. Le panneau dit lequel s'applique ; c'est un levier de SIM4.
- **Capacité négative** : retrait selon l'ordre du § 6.3 ; si rien ne couvre le besoin, le chemin est compté dans « manquer d'argent » et le disponible devient négatif (découvert visible, pas masqué).

### 6.3 Ordre de retrait (apport, retrait ponctuel, capacité négative)
Ordre **déterministe** par niveaux, puis, à l'intérieur d'un niveau, par **coût fiscal croissant** du montant demandé (impôt ÷ net obtenu, calculé avec § 5.2 à la date du retrait) :
1. disponible au-dessus du matelas ;
2. compte-titres, assurance-vie après `av_8_ans`, PEA après `pea_5_ans`, épargne salariale disponible (DAT1 `pee_disponible`) ;
3. assurance-vie avant `av_8_ans` ;
4. PER : **seulement** pour un achat de résidence principale (déblocage anticipé, § 11.2) ;
5. matelas ;
6. PEA avant `pea_5_ans` : **jamais**, sauf si l'événement porte `autoriser_cloture_pea: true` (le retrait clôture le plan : tout le PEA est liquidé, l'excédent revient au disponible) ;
7. jamais un bien immobilier ni un PERCOL.
- Chaque prélèvement réduit la valeur et la base au prorata, calcule l'impôt et le note dans l'effet de l'événement (« apport −60 k€ pris sur l'épargne disponible, le compte-titres et l'assurance-vie, impôts 1 363 € »). Un retrait « net » demande le brut qui donne ce net (résolution exacte pour les taux proportionnels, par dichotomie quand l'abattement est en jeu).
- Les dates d'enveloppe viennent de DAT1 : l'ordre change au cours du temps (un PEA ouvert en 2023 devient mobilisable sans clôture en 2028).
- L'ordre est le même dans les chemins Monte-Carlo, la crise et IMMO1.

### 6.4 Biens et crédits
- **Biens existants** : valeur d'aujourd'hui, revalorisée chaque mois au rendement de `immobilier_physique` (§ 4.3, avec aléa dans le Monte-Carlo). Part du périmètre : `part_p1`. Prix et date d'achat (pour l'impôt d'un bien autre que la résidence principale) : `config.projection.biens["bien:<uuid>"] = { prix_achat, date_achat, source, le }` ; absent → « à compléter ».
- **Crédits existants** (`credits`, `biens.crd` et `biens.mensualite`) : tableau d'amortissement mensuel à échéance constante (`Projection.amortissement`). Taux et fin : `config.prets_infos` (DAT1). Taux connu et fin inconnue → durée restante déduite du capital restant dû et de la mensualité. Fin connue et taux inconnu → taux déduit (dichotomie). Les deux inconnus → taux supposé égal au repère du taux moyen sur 20 ans (§ 8.1), durée déduite, mention « taux du crédit supposé, à compléter » (§ 6.6). La mensualité de `credits` est supposée assurance comprise (champ unique) ; si `prets_infos.assurance_taux_pct` existe, la part d'assurance est séparée.
- **Convention de taux** : taux nominal annuel proportionnel (`taux / 12` par mois), échéance `C · i / (1 − (1 + i)^−n)` ; assurance sur le capital initial (`C × assurance_pct / 12` par mois), comme `toise.js`.
- **Fin d'un crédit** : la mensualité libérée part dans la capacité selon `part_reaffectee_epargne_pct` (défaut **100 %**, « si tes dépenses n'augmentent pas » : hypothèse dite, levier de SIM4 et astuce 11 d'OPT1), modifiable par un événement `fin_credit` (§ 7.1). Le jalon « Fin du prêt » est automatique (DAT1 `pret_fin` ou fin calculée).
- **Patrimoine net** = financier + Σ (valeur des biens × part) − Σ capitaux restant dus (× part).

### 6.5 Vues
- `net` : patrimoine net (§ 6.4) ; `financier` : compartiments financiers ; `disponible` : compartiments disponibles (§ 4.1). Vue `net` par défaut sur Aujourd'hui, `financier` sur Placements, poches de l'objectif sur Objectifs (§ 10).

### 6.6 Couverture et données manquantes
Le résultat liste, comme Santé, ce qui manque et son effet : prix de revient, date d'ouverture d'enveloppe (DAT1), taux d'un crédit, frais d'enveloppe, frais d'une école, prix d'achat d'un bien, taux marginal. Chaque élément a un bouton « Compléter avec Claude » (phrase prête). `couverture = données présentes ÷ données utiles` ; sous 60 %, la phrase de titre ajoute « provisoire ».

## 7. Événements de vie (FOY1-lite)

### 7.1 Types V1
Tous les montants sont en **euros d'aujourd'hui**. `date` = premier jour d'effet ; `fin` facultative. `personne` ∈ `p1`, `p2`, `foyer`. Les enfants sont désignés par un **libellé court** (`enfant`, 1 à 40 caractères, « Enfant 2 »), jamais un prénom imposé.

| `type` | Paramètres (`params`) | Effet | Valeurs par défaut sourcées |
|---|---|---|---|
| `naissance` | `enfant`, `date` (naissance réelle ou prévue), `cout_mode: "uc"|"montant"`, `cout_mensuel?`, `fin_age?` | Dépenses `+ c(âge)` chaque mois de la naissance à `fin_age` ; un enfant déjà né est déjà dans les dépenses d'aujourd'hui : seuls les **changements** (passage à 14 ans, fin de charge) comptent. | `cout_mode: "uc"` : `c = dépenses courantes par unité de consommation × 0,3` avant 14 ans, `× 0,5` à partir de 14 ans (échelle de l'OCDE utilisée par l'Insee, § 11.1). Dépenses par UC = `depenses_0 ÷ UC du foyer aujourd'hui` (1 pour le premier adulte, 0,5 par personne de 14 ans ou plus, 0,3 par enfant de moins de 14 ans). `fin_age` : 20 ans (convention, § 11.4). |
| `creche` | `enfant`, `date`, `fin?`, `mode: "psu"|"montant"`, `heures_mois?`, `ressources_mensuelles?`, `cout_mensuel?` | Dépenses `+ coût` de `date` à `fin`. | `mode: "psu"` : barème national de la Cnaf : `taux d'effort × ressources mensuelles × heures` ; taux selon le nombre d'enfants à charge (0,0619 % pour un enfant en accueil collectif en 2026), ressources entre le plancher et le plafond du barème ; `ressources_mensuelles` = revenus du foyer ; `heures_mois` : 200 (hypothèse : 10 h × 20 jours, dite) ; `fin` : 1er septembre de l'année des 3 ans (instruction obligatoire, § 11.4). Les aides et crédits d'impôt (garde) viennent avec PAT1. |
| `scolarite_privee` | `enfant`, `niveau: "maternelle"|"elementaire"|"college"|"lycee"|"superieur"`, `date`, `fin`, `frais_annuels` | Dépenses `+ frais_annuels / 12`. | **Aucune** : les frais varient trop d'un établissement à l'autre et aucune source officielle ne publie de moyenne. `frais_annuels` est obligatoire ; le Copilote demande le tarif de l'établissement. |
| `achat_immobilier` | `date`, `prix`, `usage: "rp"|"locatif"|"secondaire"`, `neuf`, `primo`, `apport: montant | "max"`, `autoriser_cloture_pea?`, `pret: { duree_ans, taux_pct?, assurance_pct? }`, `loyer_remplace?`, `charges_mensuelles`, `loyer_percu?`, `libelle` | Le mois `date` : apport retiré (§ 6.3), frais d'acquisition payés, nouveau bien (valeur `prix`) et nouveau crédit (`prix + frais − apport`) ; ensuite mensualité et charges en dépenses, loyer remplacé retiré des dépenses (résidence principale), loyer perçu en revenus (locatif). | Frais d'acquisition : repères `frais_acquisition_*` (§ 8.1) ; taux : repère du jour pour la durée ; assurance : 0,30 % (hypothèse dite) ; `loyer_remplace` : ligne « loyer » du budget s'il y en a une ; `charges_mensuelles` obligatoire (taxe foncière, copropriété, entretien : le Copilote les demande). `apport: "max"` = tout le mobilisable au-dessus du matelas. |
| `retrait` | `date`, `montant`, `libelle` | Retrait net (§ 6.3) : voiture, voyage, travaux. | — |
| `hausse_revenu` | `personne`, `date`, `delta_mensuel` (net, € d'aujourd'hui, positif ou négatif) ou `delta_pct`, `part_epargnee_pct?` | Revenus `+ delta` ; capacité `+ delta × part_epargnee_pct` si `delta > 0`, `+ delta` (baisse entière) si `delta < 0`. | `part_epargnee_pct` : 50 % (hypothèse dite, le Copilote la demande). |
| `fin_credit` | `credit: "credit:<uuid>"|"bien:<uuid>"`, `part_reaffectee_epargne_pct`, `date_fin?` | Remplace la règle de réaffectation (et la date si elle est connue autrement). | Règle par défaut du § 6.4. |
| `crise` | `cle` (`Marche.CRISES`), `date` | Fixe la crise rejouée et sa date pour la situation ou la variante (§ 4.6). | — |

- **Réservés** (le schéma les accepte dans la liste des types futurs, sans effet tant que le moteur ne les implémente pas ; refusés par `decrire_foyer` en V1) : `chomage`, `separation`, `invalidite`, `retraite`, `heritage`, `conge_parental`, `temps_partiel`. Le modèle est extensible : un type = une fonction `effet(evenement, t, etat)` qui modifie revenus, dépenses, compartiments ou crédits ; ajouter un type = ajouter une entrée au catalogue `Projection.EVENEMENTS` (paramètres, validation, effet, textes, défauts sourcés) et son contrôle SQL.

### 7.2 Variantes
- **Situation actuelle** = les données du foyer + les événements sans variante.
- **Variante** (`foyer_variantes`) = la situation actuelle + ses propres événements (`variante_id`) − les événements de base qu'elle retire (`retire`) + des hypothèses modifiées (`hypotheses` : `epargne_delta_mensuel`, `reste_capacite`, `reequilibrage`, `part_reaffectee_epargne_pct`, `part_hausse_epargnee_pct`, `salaire_croissance_reelle_pct`). 10 variantes au plus.
- Comparaison : mêmes tirages (§ 4.4.1), écart **par chemin** puis centiles de l'écart, et probabilité que la variante fasse mieux.

### 7.3 Conduite du Copilote
1. « Pars des valeurs par défaut sourcées et dis-les. Ne demande que ce qui change notablement le résultat : la date et le prix d'un achat, les frais d'une école, les charges d'un bien. »
2. « Pour un enfant, demande seulement la date (réelle ou prévue) et un libellé court ; jamais de prénom. »
3. « Propose les événements, ne les écris jamais : l'utilisateur valide dans Agent › Propositions. »
4. « Une projection n'est pas une promesse. Donne des ordres de grandeur arrondis, toujours avec la bande, en euros d'aujourd'hui. »
5. « Quand l'utilisateur retient un scénario, consigne-le au journal avec la version du modèle. »
6. « Ne recommande jamais un produit ; parle d'enveloppes, de classes d'actifs et de leviers. »

### 7.4 Effet d'un événement en euros
Le moteur rend pour chaque jalon un `effet` chiffré, calculé sur le chemin médian du déterministe (et non sur un chemin Monte-Carlo, pour rester stable) :
- achat : apport par enveloppe source, impôts payés, frais d'acquisition, montant emprunté, mensualité (« apport −60 k€ pris sur PEA et assurance-vie, mensualité −1 100 €/mois ») ;
- naissance : coût mensuel aujourd'hui et à 14 ans (« −600 €/mois, −1 000 €/mois à partir de 14 ans ») ;
- crèche, école : coût mensuel et total ;
- hausse de revenu : revenu et épargne en plus par mois ;
- fin de crédit : mensualité libérée et part réaffectée ;
- jalon DAT1 : l'effet de DAT1 (« retraits sans clôture du plan possibles »).

## 8. IMMO1 : capacité d'emprunt aujourd'hui et demain

Affichée dans **Patrimoine › Immobilier et crédits** (module `bilan`), avec le sélecteur de périmètre existant (foyer, chaque personne). Mention fixe : « Estimation selon les règles du HCSF et les usages courants des banques. Ce n'est pas une offre de prêt : chaque banque décide. »

### 8.1 Aujourd'hui : `Projection.capaciteEmprunt(data, opts)`
- **Revenus retenus** `R` (mensuels, nets avant impôt sur le revenu, comme le prévoit la décision du HCSF) : salaires nets du périmètre (`profil.personnes.<p>.salaire`, ramené au mois) ; primes et variable : moyenne des 3 dernières années quand le profil les porte (`primes_annuelles`, champ de FOY1), sinon non comptés et la mention le dit ; revenus locatifs × `revenus_locatifs_ponderation` (70 %, **convention bancaire** usuelle, pas une règle du HCSF, § 11.4).
- **Charges** `Ch` : mensualités des crédits en cours du périmètre, assurance comprise (§ 6.4).
- **Mensualité maximale** `M = hcsf_taux_effort × R − Ch` (35 %, assurance comprise, repère existant).
- **Durée** : `hcsf_duree_max` (25 ans) par défaut ; 20 ans en sensibilité ; « jusqu'à 27 ans pour un achat dans le neuf en construction ou avec travaux, différé compris » affiché seulement quand `hcsf_duree_max_differe` est vérifié (§ 11.5).
- **Taux du jour** : repère `taux_credit_immo_<durée>` (Observatoire Crédit Logement/CSA, taux moyen du mois, hors assurance), avec sa date (« taux moyen d'août 2026 »). **Mise à jour** : chaque mois, par une ligne de `reperes` (la veille AG1 le signale ; le Copilote ne l'écrit pas, `reperes` est un contenu commun) ; `date_fin` = fin du mois suivant la publication, au-delà « taux à actualiser » (DAT1 : `date_fin` passée = signalée). Plus tard : la nuit (EX2). Assurance emprunteur : `config.projection.assurance_pct` du foyer, sinon 0,30 % (hypothèse dite). **Taux d'usure** : repère `taux_usure_<durée>` (Banque de France, trimestriel) ; un TAEG estimé au-dessus est signalé.
- **Montant empruntable** `C = M / (a(i, n) + assurance_pct / 12)`, avec `a(i, n) = i / (1 − (1 + i)^−n)`.
- **Apport mobilisable** `A` : ce que l'ordre du § 6.3 peut retirer **net d'impôts** à la date, au-dessus du matelas, sans clôturer un PEA de moins de 5 ans, PER compris (déblocage pour la résidence principale) et indiqué à part ; « à recevoir » exclu (CP4 § 1.4). Le détail par enveloppe est affiché.
- **Budget d'achat** `P = (C + A − garantie_pct × C − frais_dossier) / (1 + frais_acquisition)`, avec `frais_acquisition` = `frais_acquisition_ancien_pct` (ou `_primo_pct`, ou `_neuf_pct` selon les options). Garantie et frais de dossier : conventions de Rang (1 %, 1 000 €), dites.
- **Reste à vivre** = `R − Ch − mensualité nouvelle`, comparé aux **dépenses courantes du foyer hors logement** (§ 6.1) : « après ce crédit, il te resterait 2 900 € par mois ; tes dépenses courantes hors logement sont de 2 400 € ». Aucun seuil inventé : les banques ont chacune le leur.
- **Sensibilité** : tableau taux du jour −1 pt / taux du jour / +1 pt × 20 et 25 ans (montant empruntable et budget d'achat).
- **Sortie** : `{ revenus_retenus: { total, detail }, charges, mensualite_max, taux: { valeur, source, date }, duree_ans, montant_empruntable, apport: { total, detail, impots }, frais, budget_achat, reste_a_vivre, depenses_hors_logement, sensibilite: [[...]], taeg_estime, usure, avertissements, sources }`.
- PTZ : la logique PTZ de `toise.js` est déplacée telle quelle dans le moteur (même code), mais IMMO1 ne l'affiche pas en V1 tant que son barème n'est pas revérifié (§ 11.5) ; Rang continue de l'afficher avec sa mention actuelle.

### 8.2 Demain : `Projection.capaciteDansLeTemps(modele, resultat, opts)`
- Pour chaque mois du modèle : `R(t)` (trajectoire des revenus, hausses), `Ch(t)` (crédits en cours qui finissent, nouveaux crédits d'un achat prévu), dépenses (enfants : elles ne changent pas le taux d'effort mais baissent le reste à vivre), **apport mobilisable** par chemin → centiles P10/P50/P90 de l'apport, donc du budget d'achat.
- Taux : taux du jour, et deux lignes fines à ±1 point pour la médiane (pas de modèle des taux en V1, c'est écrit).
- Après un `achat_immobilier` prévu, la capacité baisse (nouvelle mensualité) : la courbe le montre, avec le jalon.
- **Graphique** : le composant SIM2 en mode `capacite` : éventail du budget d'achat (P10–P90, P25–P75 si utile), médiane, ligne du montant empruntable (déterministe en revenus), jalons (« Fin du prêt auto », « Hausse de salaire », « Enfant 2 »). **Phrase de titre** : « En 2028, budget d'achat médian 310 000 € avec 55 000 € d'apport (9 chances sur 10 d'avoir au moins 40 000 €). »
- Euros constants par défaut, comme le reste.

### 8.3 Une seule logique
- `annuity`, `loanPlan`, `ptzInfo`, `taeg`, `amortization` de `toise.js` passent dans `projection.js` (sous les noms `annuite`, `planPret`, `ptz`, `taeg`, `amortissement`) ; `toise.js` appelle le moteur. Les constantes `LOAN` deviennent des repères (taux, frais d'acquisition, garantie, frais de dossier, pondération des loyers) ; `LOAN.ins` (assurance par âge) reste une convention de Rang, citée comme telle.
- `test/port.test.mjs` lie le bloc moteur de `toise.js` à `sources/toise.html` : ce bloc est réduit (les fonctions de crédit en sortent, la référence devient `projection.js`), avec un commentaire qui le justifie (décision 1).
- Outil MCP `capacite_emprunt({ perimetre?, date?, scenario?: "p10"|"p50"|"p90", duree_ans?, neuf?, primo?, variante? })` (lecture) : aujourd'hui si `date` est absente, sinon la valeur de la trajectoire à cette date.

## 9. Performance

- **Budget** : 2 000 chemins × 300 mois en moins de **150 ms** sur un ordinateur portable courant, dans le *worker*.
- **Structure** : boucle **mois à l'extérieur, chemins à l'intérieur**. État dans des `Float64Array` : valeurs `P × B` (B compartiments, typiquement 5 à 30), bases `P × B`, disponible et crédits par chemin ; états du générateur dans un `Uint32Array(4 × P)`. Aucun objet alloué dans la boucle.
- **Tirages** : 13 normales par chemin et par mois (liste fixe), 7 appels Box-Muller ; Cholesky 13 × 13 précalculé (91 multiplications). Les classes absentes sont tirées mais ni multipliées ni appliquées (seul le générateur avance), ce qui garde les nombres aléatoires communs.
- **Centiles** : chaque mois, une copie des totaux de la **vue affichée** dans un `Float64Array(P)` réutilisé, triée (`TypedArray.prototype.sort`, numérique) ; les autres vues seulement à la demande. Les probabilités d'objectif sont comptées au mois de leur date, sans stocker les chemins.
- **Worker** : `projection-worker.js` charge les modules purs par `importScripts` ; l'écran envoie `{ data, options }`, affiche d'abord un calcul à **500 chemins** (même graine : ce sont les 500 premiers chemins des 2 000), puis le résultat complet. Résultats mis en cache par empreinte de l'entrée (données + options + `versionModele`). Sans `Worker` (tests, vieux navigateurs), même code sur le fil principal.
- **Mesure** : `scripts/bench-projection.mjs` (Node) affiche le temps de 2 000 × 300 ; un test vérifie un plafond large (600 ms) pour ne pas être instable en intégration continue, et le compte rendu de la tâche donne la mesure réelle.

## 10. SIM2 : le graphique

### 10.1 Composant `GraphePatrimoine`
- **On part du composant de HIS1** : `web/src/graphe-patrimoine.js` (`GraphePatrimoine.construire(f, fut, opt)`, `legendeHtml`, `tableauHtml`, `calculHtml`, `infobulle`), créé pour la courbe maîtresse d'Aujourd'hui (passé observé et reconstitué, trait « Aujourd'hui », échelles de temps distinctes du passé et du futur, tableau et panneau). SIM2 **le généralise** au lieu d'en créer un second : `fut` reçoit la sortie du moteur (centiles, jalons, objectifs, variante, crise), et un petit contrôleur DOM (`monter(el, { donnees, reglages })`, `mettreAJour`) le rend réutilisable sur les autres écrans. Fonctions pures testables sous Node ; ses conventions (échappement, tutoiement, styles scopés) sont gardées.
- **Courbe continue** : passé observé (trait plein), passé reconstitué (trait plein plus clair, avec la mention de HIS1), marqueur vertical **« Aujourd'hui »**, puis l'éventail : P10–P90 en aplat clair, P25–P75 plus foncé, **médiane en trait plein**. Pas de points annuels. Le passé est converti en euros constants avec l'indice des prix (`indices_mensuels`, série IPC de l'Insee, § 11.4) quand la vue est en euros constants.
- **Variante** : seconde couleur (médiane + P25–P75), et **l'écart à l'horizon** écrit (« +38 000 € en médiane à 10 ans, variante meilleure dans 7 chemins sur 10 »).
- **Crise** : ligne pointillée, avec sa légende (« Crise de 2008 rejouée en octobre 2027 »).
- **Couloir des jalons** sous l'axe : une icône et un libellé court par jalon (« Enfant 2 », « Achat RP », « PEA 5 ans », « Fin du prêt »), un fin trait vertical jusqu'à la courbe. Survol ou focus (vrai bouton) : une bulle avec l'effet en euros (§ 7.4) ; clic : panneau du jalon. Jalons proches regroupés (« 3 jalons en 2028 ») quand ils se chevauchent. Sources : événements du foyer, `Calendrier.calendrier(...).jalons` non passés (DAT1 § 5.6), fins de crédit, objectifs.
- **Objectifs** : une cible (losange) à la date et au montant de l'objectif, couleur **et mot** : « probable » (≥ 80 %), « incertain » (50 à 80 %), « peu probable » (< 50 %), avec « 8 chances sur 10 ». Le seuil « probable » suivra le niveau de confiance visé d'OBJ1.
- **Phrase de titre** : « Dans 10 ans, en euros d'aujourd'hui : 9 chances sur 10 d'avoir plus de 310 000 €, médiane 420 000 €. » Montants arrondis à deux chiffres significatifs (pas de fausse précision), « provisoire » sous 60 % de couverture. En euros courants : « en euros de 2036 ».
- **Contrôles minimaux** : horizon (5, 10, 15, 20, 25 ans, `UI.bascule`), situation actuelle / variante (liste des variantes, si elles existent), crise oui/non (avec la crise et la date de l'événement `crise`, sinon 2008 dans un an). Vue (net, financier, disponible), euros constants/courants et « net d'impôts » sont dans le panneau « Comment c'est calculé » pour rester simples. Ces réglages sont locaux (jamais enregistrés), comme la projection actuelle d'Objectifs.
- **« Comment c'est calculé »** (`UI.panneau`) : méthode en 5 phrases ; table des hypothèses (classe, rendement, volatilité, source, date ; inflation ; hausse des salaires ; frais ; règles fiscales) ; données utilisées et ce qui manque ; limites (§ 4.2, 4.4, 4.6, 5.2) ; graine et nombre de chemins ; version du modèle ; « Demander à Claude ».
- **Tableau accessible** sous le graphique (repliable, ouvert au lecteur d'écran) : une ligne par année (P10, P25, médiane, P75, P90, variante, écart), puis la liste des jalons avec date et effet.
- **Accessibilité** : `role="img"` et `aria-label` qui reprend la phrase de titre ; jalons en vrais boutons atteignables au clavier ; bulle au focus, fermée par Échap ; état jamais porté par la seule couleur ; contrastes AA en clair et en sombre (variables de `theme.css`) ; **mobile 400 px** : libellés des jalons abrégés, couloir défilant horizontalement si besoin, contrôles en une colonne ; **`prefers-reduced-motion`** : aucune animation de tracé.
- **Mode `capacite`** (IMMO1, § 8.2) : même composant, séries « budget d'achat » et « montant empruntable ».

### 10.2 Réglages par défaut par écran

| Écran | Vue | Passé | Horizon | Objectifs | Contrôles |
|---|---|---|---|---|---|
| Aujourd'hui (courbe maîtresse, HIS1) | net, foyer ou périmètre | 5 ans (HIS1) | 10 ans | tous | horizon, variante, crise |
| Patrimoine › Placements | financier | 5 ans | 10 ans | aucun | horizon, crise |
| Patrimoine › Objectifs | financier (accordéon actuel) ; dans le panneau d'un objectif : les poches de l'objectif | non | jusqu'à la date de l'objectif (au moins 5 ans) | l'objectif concerné | horizon |
| Patrimoine › Immobilier et crédits (IMMO1) | `capacite` | non | 10 ans | objectif « apport » s'il existe | horizon, durée 20/25 ans |

### 10.3 Données passées
Le passé vient de `Historique.fusionner(...)` (HIS1). PROJ ne touche pas à la reconstitution ; il remplace `Historique.projeter` par un appel au moteur (§ 13.1).

### 10.4 Probabilité d'un objectif
Valeur de référence : les poches rattachées (`objectifs.poches`, `objectifs.enveloppes`) ou, pour un objectif « saisi », la vue `disponible` du titulaire. Cible en **euros d'aujourd'hui** (changement de sens annoncé, § 13.3). Probabilité = part des chemins où la valeur de référence, en euros constants, atteint la cible à la date. Un objectif « matelas » utilise la vue `disponible`.

## 11. Hypothèses et sources

Consultées le **2026-10-14** sauf mention. Statut : **V** vérifié sur la page officielle ; **V-DAT1** vérifié dans la spec DAT1 (§ 11.1 de DAT1) ; **CR** changé récemment ; **NV** non vérifié sur une page officielle (à lever en tâche 0, § 11.5) ; **CONV** convention ou hypothèse de Boussole, dite comme telle.

### 11.1 Hypothèses économiques

| Hypothèse | Valeur | Source | Statut |
|---|---|---|---|
| Inflation (`inflation_hypothese`) | 2 % par an | BCE, stratégie de politique monétaire : objectif de 2 % d'inflation à moyen terme, mesurée par l'IPCH — https://www.ecb.europa.eu/mopo/strategy/pricestab/html/index.fr.html (page sans date) | V |
| Hausse réelle des salaires (`salaire_croissance_reelle`) | 0,5 % par an | Insee Première n° 2079, « Les salaires dans le secteur privé en 2024 », 23/10/2025 : pouvoir d'achat du salaire net moyen +0,6 % par an de 1996 à 2019, niveau de 2019 à peine retrouvé en 2024 ; 0,5 % = moyenne 1996-2024 calculée par Boussole — https://www.insee.fr/fr/statistiques/8657156 | V (calcul Boussole) |
| Unités de consommation | 1 / 0,5 (14 ans ou plus) / 0,3 (moins de 14 ans) | Insee, définition « Unité de consommation » (échelle de l'OCDE), mise à jour le 16/12/2022 — https://www.insee.fr/fr/metadonnees/definition/c1802 | V |
| Coût d'un enfant | 0,3 ou 0,5 UC × dépenses par UC du foyer | Méthode des échelles d'équivalence, discutée par la Drees (« Mesurer le coût de l'enfant : deux approches à partir des enquêtes Budget de famille », Dossiers de la Drees n° 62, 2020) — https://www.drees.solidarites-sante.gouv.fr/sites/default/files/2020-07/dss62.pdf. Ordre de grandeur de contrôle : HCFEA, « Le coût de l'enfant » (≈ 1 500 € par mois, dépenses publiques comprises) — https://www.hcfea.fr/IMG/pdf/synthese_cout_de_l_enfant_def.pdf | V (définition) ; méthode = CONV documentée |
| Crèche : taux d'effort (accueil collectif, 1 enfant) | 0,0619 % des ressources mensuelles par heure | Cnaf, Guide PSU 2026 — https://caf.fr/sites/default/files/medias/493/Partenaires/Petite-enfance/EAJE/Guide_PSU_2026_02_V_Def.pdf (barème inchangé en 2026) | V (lu via recherche ; tableau complet par nombre d'enfants, plancher et plafond : tâche 0) |
| Heures de crèche par mois | 200 | 10 h × 20 jours | CONV |
| Revalorisation réelle des logements (`immo_revalorisation_reelle`) | 0 % (prix = inflation) | Hypothèse prudente ; à confronter à l'indice des prix des logements anciens de l'Insee et aux travaux de long terme (tâche 0) | CONV |

### 11.2 Fiscalité (option « net d'impôts »)

| Règle | Valeur | Source | Statut |
|---|---|---|---|
| Prélèvements sociaux, cas général (PEA, compte-titres, PER, gains) | 18,6 % depuis le 01/01/2026 | Service-public F2329 (vérifié le 30/06/2026) — https://www.service-public.gouv.fr/particuliers/vosdroits/F2329 ; LFSS 2026 | V-DAT1, CR |
| Prélèvements sociaux : assurance-vie, PEL, CEL | 17,2 % | F2329 | V-DAT1 |
| Prélèvements sociaux : revenus fonciers et plus-values immobilières (`ps_taux_foncier`, `pv_immo_ps_taux`) | 17,2 % (CSG 9,2 + CRDS 0,5 + solidarité 7,5) | F2329 (vérifié le 30/06/2026) | V |
| Impôt forfaitaire (`ir_taux_forfaitaire`) | 12,8 % | Service-public F22449 (PEA avant 5 ans), F22414 (assurance-vie avant 8 ans) | V-DAT1 |
| PEA : 5 ans, gains exonérés d'IR ensuite, PS dus ; retrait avant 5 ans = clôture | — | F22449 | V-DAT1 |
| Assurance-vie après 8 ans : abattement 4 600 / 9 200 € ; 7,5 % sous 150 000 € de primes nettes, 12,8 % au-delà (`av_taux_ir_reduit` = 7,5) | — | F22414 | V-DAT1 |
| PER : sortie en capital, part des versements déduits au barème sans abattement de 10 % et sans PS ; gains au PFU de 31,4 % (12,8 + 18,6) pour les gains depuis le 01/01/2026 ; déblocage anticipé pour la résidence principale | — | Service-public F34982 (vérifié le 12/10/2026) — https://www.service-public.gouv.fr/particuliers/vosdroits/F34982 | V |
| Plus-value immobilière : 19 % d'IR, 17,2 % de PS ; abattements IR 6 %/an (6ᵉ à 21ᵉ), 4 % (22ᵉ) ; PS 1,65 %/an (6ᵉ à 21ᵉ), 1,60 % (22ᵉ), 9 %/an (23ᵉ à 30ᵉ) ; surtaxe au-delà de 50 000 € ; résidence principale exonérée | — | Service-public F10864 (vérifié le 15/04/2026) — https://www.service-public.gouv.fr/particuliers/vosdroits/F10864 | V |
| Parts de SCPI détenues en direct : régime des plus-values immobilières (art. 150 UB du CGI) | — | Sources non officielles concordantes ; F10864 ne cite pas les SCPI | **NV** |
| Crypto : 12,8 % d'IR sur les plus-values d'actifs numériques, option pour le barème | — | Notice 2086 (impots.gouv.fr) — https://static.impots.gouv.fr/tdir/static/2026-03-30T16:36:08Z/aide/notices/notices2024/2086/notice2086.pdf | V (IR) ; PS 18,6 % : **NV** |
| Dates PEA 5 ans, assurance-vie 8 ans, PEE, PEL | — | Calendrier DAT1 (`pea_5_ans`, `av_8_ans`, `pee_disponible`, `pel_*`) | V-DAT1 |
| Barème de l'IR (taux marginaux) | 0, 11, 30, 41, 45 % | Service-public (barème 2026) | **NV** (tâche 0) |

### 11.3 Statistiques de marché (reprises de `web/src/marche.js`, SP2)
Rendement géométrique nominal en euros, avant frais des fonds ; « réel » = `(1 + r) / 1,02 − 1`. Corrélations : `Marche.PAIRES` (actions entre elles 0,8 à 0,95 ; obligations et or 0,1 avec les actions ; crypto 0,4 ; immobilier 0,5 ; monétaire et fonds euros 0).

| Classe | Rendement nominal | Réel (≈) | Volatilité | Source (marche.js) |
|---|---|---|---|---|
| Actions (monde développé) | 7 % | 4,9 % | 15 % | MSCI World NR EUR 1970-2025 ; Jordà et al., QJE 2019 |
| Petites capitalisations | 7,5 % | 5,4 % | 20 % | MSCI World Small Cap NR 2001-2025 ; Fama et French |
| Émergents | 6,5 % | 4,4 % | 20 % | MSCI Emerging Markets NR 1988-2025 |
| Levier ×2 | **calculé** (§ 4.4.3) ; `marche.js` : 9 % | — | 2 × σ du sous-jacent | ProShares Ultra QQQ, reconstitutions 2000-2002 |
| Obligations zone euro | 3,5 % | 1,5 % | 5 % | Bloomberg Euro Aggregate 1999-2025 |
| Immobilier (SCPI, pierre) | 4,5 % | 2,5 % | 6 % (lissée) | IEIF, ASPIM, Notaires de France / Insee |
| Monétaire et livrets | 1,5 % (livrets : taux réglementé en vigueur) | −0,5 % | 0,5 % (0 pour les livrets) | Banque de France ; €STR, BCE |
| Fonds euros | 2,5 % | 0,5 % | 0 (garanti) | ACPR / France Assureurs 2015-2024 |
| Or | 4 % | 2 % | 15 % | LBMA |
| Crypto | 10 % | 7,8 % | 70 % | CoinMarketCap ; historique court, hypothèse prudente |
| Autres | 4 % | 2 % | 12 % | Hypothèse Boussole (fonds diversifié) |

Ces chiffres ont une source mais pas de date de vérification dans `marche.js` : la tâche 0 ajoute `verifie_le` et `periode` à chaque classe, sans changer les valeurs. Ils passeront dans les données de la nuit avec EX2.

### 11.4 Repères à ajouter ou à relever (tâche 0, puis migration 0030)

| Clé | Valeur | Source à utiliser | Statut |
|---|---|---|---|
| `inflation_hypothese` | 2 % | BCE (§ 11.1) | V |
| `salaire_croissance_reelle` | 0,5 % | Insee Première n° 2079 | V |
| `uc_adulte_supplementaire`, `uc_enfant_moins_14`, `uc_age_seuil` | 0,5 ; 0,3 ; 14 ans | Insee c1802 | V |
| `enfant_fin_charge_age` | 20 ans | Convention (enfant à charge de moins de 20 ans, périmètre du HCFEA) | CONV |
| `creche_psu_taux_<n>_enfants` (1 à 4+), `creche_psu_plancher`, `creche_psu_plafond` | 0,0619 % (1 enfant) ; autres à relever ; plancher ≈ 814,62 €, plafond 8 500 € (sources secondaires) | Cnaf, Guide PSU 2026 | V (1 enfant) / NV |
| `ecole_obligatoire_age` | 3 ans | Code de l'éducation, art. L131-1 (Légifrance) | NV |
| `ir_taux_forfaitaire`, `av_taux_ir_reduit` | 12,8 % ; 7,5 % | F22449, F22414 | V-DAT1 |
| `pv_immo_ir_taux`, `pv_immo_ps_taux`, `pv_immo_surtaxe_seuil`, `ps_taux_foncier` | 19 % ; 17,2 % ; 50 000 € ; 17,2 % | F10864, F2329 | V |
| `ir_bareme_taux` (liste) | 0, 11, 30, 41, 45 % | Service-public (barème 2026) | NV |
| `taux_credit_immo_15`, `_20`, `_25` | 3,14 % ; 3,27 % ; 3,35 % (août 2026) | Observatoire Crédit Logement/CSA, tableau de bord mensuel — https://lobservatoire.creditlogement.fr (lu via un résumé de recherche ; mêmes valeurs que `toise.js`) | CR, à confirmer sur le document |
| `taux_usure_<durée>` | à relever | Banque de France, taux d'usure du trimestre | NV |
| `hcsf_duree_max_differe` | 27 ans | Décision D-HCSF-2021-7 modifiée (D-HCSF-2023-2) ; page economie.gouv.fr refusée (403) le 2026-10-14 ; sources parlementaires et secondaires concordantes | NV |
| `revenus_locatifs_ponderation` | 70 % | Usage bancaire (convention de `toise.js`), pas une règle du HCSF | CONV |
| `frais_acquisition_ancien_pct`, `_primo_pct`, `_neuf_pct` | 8 % ; 7,5 % ; 2,5 % (`toise.js`) | Notaires de France (estimation des frais) ; hausse des droits de mutation de 4,5 à 5 % votable par les départements du 01/04/2025 au 30/04/2028, sauf primo-accédants : service-public A18183 (02/04/2025) | V (règle DMTO) / CONV (totaux) |
| `garantie_pct`, `frais_dossier` | 1 % ; 1 000 € | Conventions de `toise.js` | CONV |
| `estr_taux` | à relever | BCE, €STR (portail de données) | NV |
| `nasdaq100_rendement`, `nasdaq100_volatilite` | à relever | Fiche de l'indice (Nasdaq) ou série longue publiée | NV |
| `immo_volatilite` | à calculer | Insee, indice des prix des logements anciens (série annuelle), écart type des variations | NV |
| `scpi_taux_distribution` | à relever | ASPIM / IEIF, taux de distribution moyen de l'année | NV |
| Inflation France 1973 et 1974 | à relever | Insee, IPC, évolution annuelle | NV |
| Série IPC mensuelle (5 ans) | à relever | Insee, IPC ensemble des ménages (table `indices_mensuels`) | NV |

### 11.5 Non vérifié (à lever en tâche 0 ; en attendant, la règle est marquée et n'est pas appliquée sans mention)
1. Parts de SCPI en direct : régime des plus-values immobilières (art. 150 UB, Légifrance ou BOFiP RFPI-PVI).
2. Prélèvements sociaux sur les plus-values d'actifs numériques en 2026 (18,6 % probable, aucune page officielle lue).
3. Assurance-vie après 8 ans : répartition du gain entre 7,5 % et 12,8 % au prorata des primes au-delà de 150 000 € (BOFiP BOI-RPPM-RCM-20-10-20-50).
4. PEE et PERCOL : prélèvements sociaux sur les gains au déblocage.
5. Durée HCSF de 27 ans (différé) : cas exacts (VEFA, construction, travaux) et seuil de travaux.
6. Barème PTZ de `toise.js` (2026) avant tout affichage dans IMMO1.
7. Plancher et plafond de ressources du barème PSU 2026, taux pour 2 enfants et plus.
8. Âge de l'instruction obligatoire (3 ans, art. L131-1).
9. Les repères « à relever » du § 11.4.
10. `marche.js` : dates de vérification des statistiques.

## 12. Cas de référence

Cas à reprendre à l'identique dans `test/fixtures/projection-cas.json` (tâche 0) ; chiffres calculés à la main (vérifiés par un calcul indépendant), arrondis au centime. Données fictives. Tous en euros **courants** sauf mention, inflation 0 sauf mention.

### 12.1 Mode déterministe (volatilité 0)

| Cas | Entrée | Attendu |
|---|---|---|
| D-1 Flux sans rendement | 10 000 € sur un compartiment à 0 %, capacité 500 €/mois (cascade : `reste_capacite: "disponible"`, matelas 0), 12 mois | 16 000,00 € |
| D-2 Capitalisation, versements en fin de mois | 10 000 € à 3 % par an (géométrique : `r_m = 1,03^(1/12) − 1`), 500 €/mois, 12 mois | 16 382,06 € (`10 000 × 1,03 + 500 × 0,03 / r_m`) |
| D-3 Euros constants | 100 000 € nominaux dans 10 ans, inflation 2 % | 82 034,83 € d'aujourd'hui |
| D-4 Rendement réel | 10 000 € à 5 % nominal, inflation 2 %, 10 ans | 16 288,95 € courants ; 13 362,61 € constants |
| D-5 Frais | 10 000 € à 0 %, frais des fonds 0,20 % + frais d'enveloppe 0,50 %, 12 mois | 9 930,00 € |
| D-6 Amortissement | 200 000 € à 3,35 % (proportionnel), 300 mois | échéance 985,23 € ; intérêts du 1ᵉʳ mois 558,33 € ; capital restant dû après 12 mois 194 797,85 € (intérêts payés 6 620,61 €) ; 0 € après 300 mois ; intérêts totaux 95 568,99 € ; échéance du mois 120 en euros constants (2 %) : 808,23 € |
| D-7 Fin de crédit | capacité 1 000 €/mois, crédit en cours de 300 €/mois qui finit au mois 24, règle 100 % | capacité 1 000 € jusqu'au mois 24, 1 300 € à partir du mois 25 |
| D-8 Naissance (UC) | 2 adultes, dépenses hors crédits 3 000 €/mois (UC 1,5 → 2 000 € par UC), naissance au mois 6 | +600 €/mois du mois 6 au mois précédant les 14 ans, +1 000 €/mois de 14 à 20 ans, 0 ensuite |
| D-9 Levier ×2 | sous-jacent 7 % géométrique, σ 22,5 %, financement 2 %, frais 0,6 %, 10 000 €, 12 mois | 10 604,49 € (`exp(2 ln 1,07 − 0,02 − 0,050625 − 0,006)`) ; sans frais 10 668,3 € ; même calcul avec σ 15 % : +9,07 % par an |
| D-10 Crèche (PSU) | ressources 6 000 €/mois, 1 enfant, 0,0619 %, 200 h | 742,80 €/mois |
| D-11 Crise 2008 | 100 000 € tout en actions, `gfc_2008` au mois 1 (17 mois, choc −55 %) | 45 000,00 € nominaux au mois 17 ; puis 7 % par an |

### 12.2 Fiscalité de sortie

| Cas | Entrée | Attendu |
|---|---|---|
| F-1 PEA avant 5 ans | valeur 50 000 €, versements 40 000 € | impôt 3 140 € (10 000 × 31,4 %), net 46 860 € |
| F-2 PEA après 5 ans | idem | PS 1 860 € (18,6 %), net 48 140 € |
| F-3 Assurance-vie après 8 ans, couple | valeur 120 000 €, primes 100 000 € | IR (20 000 − 9 200) × 7,5 % = 810 € ; PS 20 000 × 17,2 % = 3 440 € ; net 115 750 € |
| F-4 Assurance-vie avant 8 ans | idem | 20 000 × 30 % = 6 000 € ; net 114 000 € |
| F-5 Assurance-vie après 8 ans, primes 200 000 € | valeur 240 000 €, couple | IR 30 800 × (0,75 × 7,5 % + 0,25 × 12,8 %) = 2 718,10 € ; PS 6 880 € (sous réserve du § 11.5, point 3) |
| F-6 Compte-titres | gain 5 000 € | 1 570 € |
| F-7 PER | versements déduits 30 000 €, valeur 40 000 €, TMI 30 % | IR 9 000 € + gains 3 140 € = 12 140 € ; net 27 860 € |
| F-8 SCPI en direct, 10 ans | plus-value 10 000 € | IR 7 000 × 19 % = 1 330 € ; PS 9 175 × 17,2 % = 1 578,10 € ; total 2 908,10 € (sous réserve du § 11.5, point 1) |
| F-9 Livret A | gain 300 € | 0 € |
| F-10 Date d'ouverture inconnue | AV, valeur 120 000 €, primes 100 000 €, sans date | règle « avant 8 ans » (6 000 €), mention « date d'ouverture à compléter » |

### 12.3 Ordre de retrait (§ 6.3)

| Cas | Entrée | Attendu |
|---|---|---|
| R-1 Apport | disponible 30 000 € (matelas 10 000 €), compte-titres 20 000 € (gain 2 000 €), assurance-vie de 9 ans 50 000 € (primes 40 000 €, couple, abattement de l'année intact), PEA de 3 ans 40 000 € ; apport net demandé 60 000 € | disponible 20 000 € ; compte-titres 20 000 € (impôt 628 €, net 19 372 €) ; assurance-vie 21 362,88 € brut (gain 4 272,58 € sous l'abattement, PS 734,88 €) ; PEA intact ; impôts 1 362,88 € |
| R-2 PEA protégé | même foyer, apport 150 000 € | apport partiel, PEA intact, « apport insuffisant : il manque … » |
| R-3 Clôture autorisée | idem avec `autoriser_cloture_pea: true` | PEA liquidé entièrement (impôt avant 5 ans), excédent au disponible |
| R-4 PER et résidence principale | achat `usage: "rp"` | PER mobilisable au niveau 4 ; achat `locatif` : jamais |

### 12.4 IMMO1

| Cas | Entrée | Attendu |
|---|---|---|
| I-1 Capacité | revenus retenus 5 000 €/mois, crédits 300 €, 35 %, 3,35 %, 25 ans, assurance 0,15 % | mensualité max 1 450 € ; montant empruntable 287 063,35 € (échéance 1 414,12 € + assurance 35,88 €) |
| I-2 Budget | I-1 + apport 50 000 €, garantie 1 %, dossier 1 000 € | ancien 8 % : 308 511,77 € ; primo 7,5 % : 309 946,71 € ; neuf 2,5 % : 325 066,06 € |
| I-3 Sensibilité | I-1, 20/25 ans × 2,35 / 3,35 / 4,35 % | 270 964,31 / 319 664,88 ; 247 955,86 / 287 063,35 ; 227 600,49 / 258 996,64 |
| I-4 Loyers | revenus 4 000 € + loyers 1 000 € | revenus retenus 4 700 € (convention 70 %) |
| I-5 Demain | crédit de 300 € qui finit dans 18 mois | mensualité max 1 450 € avant, 1 750 € après (revenus constants) |

### 12.5 Monte-Carlo (graine fixe, contrôles statistiques)

| Cas | Entrée | Attendu (tolérance) |
|---|---|---|
| MC-1 Loi log-normale | 100 000 € en actions (7 %, 15 %), sans flux ni frais, 10 ans, 2 000 chemins | médiane 196 715 € (± 3 %) ; P10 107 111 € (± 5 %) ; P90 361 279 € (± 5 %) ; P25 142 853 €, P75 270 885 € (± 4 %) |
| MC-2 Reproductible | MC-1 deux fois, même graine | résultats identiques à l'octet ; une autre graine : différents |
| MC-3 Corrélation | actions + obligations, 2 000 × 120 tirages | corrélation empirique des log-rendements 0,10 ± 0,03 |
| MC-4 Tirages communs | MC-1 contre la même chose + 100 €/mois | chaque chemin de la variante ≥ le chemin de base ; écart médian ≈ valeur future des 100 € |
| MC-5 Stabilité des flux | ajout d'une ligne d'or à un portefeuille | les chocs des autres classes, chemin par chemin, ne changent pas |
| MC-6 500 premiers chemins | P50 sur 500 chemins | égal au P50 calculé sur les 500 premiers des 2 000 |
| MC-7 Centile | 10 valeurs connues | P10 = 1ʳᵉ valeur triée, P50 = 5ᵉ, P90 = 9ᵉ (rang `⌈p × N⌉`) |
| MC-8 Volatilité nulle | toutes classes σ = 0 | identique au déterministe |

## 13. Migration des calculs existants

### 13.1 Inventaire et sort

| Appel actuel | Fichier | Devient |
|---|---|---|
| `Plan.projection`, `Plan.RENDEMENTS` | `plan.js`, `objectifs-view.js` (accordéon « Projection du patrimoine financier »), `historique.js` | `Projection.simuler`. `Plan.projection` reste un temps comme fine façade **dépréciée** qui appelle le moteur (mêmes clés `central/pessimiste/optimiste` = P50/P10/P90), puis disparaît quand plus rien ne l'appelle (test). `RENDEMENTS` est supprimé. |
| `Historique.projeter` | `historique.js` (HIS1, en cours) | délègue au moteur (vue `net`, euros constants), même forme de points `{ date, mois, pessimiste, central, optimiste }` + `p25`, `p75`. Fait **après** la fusion de HIS1, sans toucher à `reconstituer` ni `fusionner`. |
| `Plan.valeurFuture`, `serieObjectif` | `objectifs-view.js` (série d'un objectif) | moteur sur les poches de l'objectif, bande et probabilité. `valeurFuture` reste une primitive pure (utile aux tests). |
| `Plan.effortMensuel`, `dateAtteinte`, `statutObjectif`, `repartirEpargne` avec `obj.rendement` | `plan.js`, `objectifs-view.js`, `index.ts` (portages) | le rendement est celui, **net de frais et en euros constants**, des poches de l'objectif (`Projection.rendementAttendu(compartiments)`, déterministe) ; `statutObjectif` ajoute `probabilite` ; la colonne `objectifs.rendement` n'est plus lue (gardée pour l'export, retirée par OBJ1). |
| Portages de l'objectif dans le connecteur | `supabase/functions/mcp/index.ts` (`effortMensuel`, `dateAtteinte`, `repartirEpargne`, `statutObjectif`) | importés de `projection-moteur.gen.js` (plus de portage). |
| `loanPlan`, `annuity`, `ptzInfo`, `taeg`, `amortization`, `LOAN` | `toise.js` | moteur (§ 8.3) ; Rang affiche les mêmes chiffres, sauf les taux, désormais lus dans les repères datés. |
| Projection de l'écart de frais | `pratiques.js`, `index.ts` (`fs.projection`) | `Projection.capitaliser` (primitive déterministe partagée), mêmes résultats (test de non-régression). |
| Simulateur « Acheter ou louer » | `simu.js` | **hors PROJ** : c'est DEC1 (roadmap § 8 : « déjà fait, à brancher sur SIM1 »). Il garde ses scénarios et son lien avec `sources/simu.html`. Le moteur lui fournira l'API. |

### 13.2 Le libellé de la source des versements
- `versementReel` et son étiquette « réel » disparaissent. La projection affiche une ligne : « Épargne mensuelle projetée : 1 200 € — ta capacité d'épargne réelle (juillet à septembre, comptes courants) », ou « … — capacité d'épargne prévue au budget (pas encore de comptes connectés) », ou « Pas encore de capacité d'épargne connue : la projection suppose 0 € par mois ». Le simulateur local (champ « versement ») est retiré : un « et si j'épargnais plus ? » devient une variante proposée par le Copilote (règle 1), ou le levier de SIM4.
- La note « Épargne mensuelle répartie par priorité : … (épargne prévue au budget et reste positif) » d'Objectifs dit désormais la même source que la projection.

### 13.3 Objectifs existants
- **Cible en euros d'aujourd'hui** : changement de sens annoncé une fois (bandeau dans Objectifs, et le Copilote le dit à la prochaine session : « tes cibles sont maintenant lues en euros d'aujourd'hui ; dis-moi si une cible était déjà prévue en euros de l'époque »). Aucune donnée n'est réécrite.
- **Statut** : les clés existantes restent (`atteint`, `avance`, `dans_les_temps`, `retard`, `hors_portee`) pour l'interface et le connecteur ; elles sont calculées sur le chemin déterministe, et la probabilité (§ 10.4) s'affiche à côté. SCO1 remplacera la jauge par la probabilité.
- `repartirEpargne` est appelé par le moteur (cascade, § 6.2, étape 3) : une seule répartition partout.

### 13.4 Ordre de migration
1. Moteur et tests (sans brancher). 2. Connecteur (copie générée, outils). 3. Composant SIM2. 4. Objectifs (accordéon, série, statut). 5. Placements. 6. Aujourd'hui (après la fusion de HIS1, en remplaçant le cône de `Historique.projeter`). 7. IMMO1 et Rang. 8. Suppression de `Plan.projection` et `RENDEMENTS`. Chaque étape garde `npm test` vert.

## 14. Données (migration 0030 `0030_projection.sql`)

Après **0029** (DAT1) : `appliquer_propositions` repart **exactement** de la définition de 0029.

### 14.1 Tables
```
foyer_evenements (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  variante_id uuid null references foyer_variantes(id) on delete cascade,   -- null : situation actuelle
  type text not null check (type in ('naissance','creche','scolarite_privee','achat_immobilier','retrait','hausse_revenu',
        'fin_credit','crise','chomage','separation','invalidite','retraite','heritage','conge_parental','temps_partiel')),
  personne text not null default 'foyer' check (personne in ('p1','p2','foyer')),
  libelle text not null check (char_length(libelle) between 1 and 60),
  date date not null, fin date null check (fin is null or fin >= date),
  params jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  source text not null check (char_length(source) between 1 and 300),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
)
foyer_variantes (
  id uuid pk, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null check (char_length(nom) between 1 and 40), description text not null default '' check (char_length(description) <= 300),
  retire uuid[] not null default '{}', hypotheses jsonb not null default '{}' check (jsonb_typeof(hypotheses) = 'object'),
  created_at, updated_at
)
```
- Index sur `user_id` ; `variante_id` doit appartenir au même utilisateur (déclencheur ou contrôle dans `appliquer_propositions`) ; 100 événements et 10 variantes au plus par utilisateur ; `updated_at` par le déclencheur existant.
- **RLS** : politiques de propriétaire (`user_id = auth.uid()`) en `select` seulement pour `authenticated` (l'écriture passe par `appliquer_propositions`, `security invoker` : droits `insert/update/delete` accordés comme pour `objectifs`, mêmes politiques). **Politique restrictive** `"<table>: aal2 si facteur"` (modèle exact de 0028). `test/mfa-pglite.test.mjs` énumère déjà les tables à `user_id` : il échoue tant qu'elles n'ont pas leur politique.
- **Export** : `export_all()` repart de sa dernière définition (0021) et ajoute `foyer_evenements` et `foyer_variantes`. **Suppression** : `on delete cascade` depuis `auth.users` (`delete_me`).
- **Contenu commun** : `indices_mensuels (serie text, mois date, valeur numeric, source_titre, source_url, verifie_le, primary key (serie, mois))`, lisible par tous (comme `reperes`), sans `user_id`, écrit par migration ou par le service ; série `ipc_insee`.

### 14.2 Propositions
- Nouvelles cibles `evenement` et `variante` (contrainte `propositions_cible` étendue ; `ref` obligatoire pour `modifier` et `supprimer`), mêmes opérations que `objectif`. Validation par type d'événement (paramètres obligatoires, bornes : montants ≥ 0 sauf `delta_mensuel`, dates réelles entre 1950 et aujourd'hui + 40 ans, `enfant` 1 à 40 caractères, clés de crise et de crédit connues, `frais_annuels` obligatoire pour `scolarite_privee`, `charges_mensuelles` pour `achat_immobilier`), **mêmes règles et messages** dans le validateur pur du moteur (`Projection.validerEvenement`), dans le store démo et dans `decrire_foyer` (parité testée). Types réservés refusés en V1.
- Nouvelle clé de la cible `config` : `projection` = `{ reste_capacite?, reequilibrage?, part_reaffectee_epargne_pct?, part_hausse_epargnee_pct?, salaire_croissance_reelle_pct?, tmi_pct?, per_versements_deduits?, assurance_pct?, biens?: { "bien:<uuid>": { prix_achat, date_achat, source, le } }, source, le }` (fusion par champ, `null` retire).
- `propositions.js` décrit chaque proposition en clair : « Naissance prévue : Enfant 2, mars 2028 (coût selon l'échelle de l'Insee) », « Achat de la résidence principale en septembre 2029 : 420 000 €, apport maximal, prêt sur 25 ans ».

### 14.3 Repères
Les lignes du § 11.4 dont la valeur est vérifiée ou conventionnelle (statut V, V-DAT1, CR, CONV), `on conflict (cle) do update`, avec `date_fin` pour les taux mensuels. Les lignes « à relever » n'entrent qu'une fois relevées en tâche 0 ; d'ici là le moteur les signale comme manquantes.

## 15. Connecteur MCP

| Outil | Annotations | Rôle |
|---|---|---|
| `decrire_foyer({ evenements?: [...], variante?: {...}, reglages_projection?: {...}, justification? })` | RW | Dépose des propositions (`evenement`, `variante`, `config.projection`), 10 événements au plus par appel, après validation (`Projection.validerEvenement`). Renvoie les propositions et les valeurs par défaut appliquées, avec leurs sources. |
| `lire_foyer()` | RO | Événements, variantes, réglages, jalons dérivés (DAT1, fins de crédit), données à compléter. |
| `projeter({ horizon_ans?, vue?, perimetre?, euros?, net_impots?, variante?, crise?: { cle, date }, annees?: [..] })` | RO | Résumé : phrase de titre, centiles par année, probabilités des objectifs, « manquer d'argent », jalons et effets, hypothèses et sources, couverture, `version_modele`, `graine`. Pas les 2 000 chemins. |
| `comparer_variantes({ variantes: [null, id, ...], horizon_ans?, vue? })` | RO | Écarts par centile à l'horizon, probabilité que chaque variante fasse mieux (chemin par chemin), mêmes tirages. |
| `capacite_emprunt({ perimetre?, date?, scenario?, duree_ans?, neuf?, primo?, variante? })` | RO | § 8. |

- Les outils lisent les tables, convertissent en formes de l'app et appellent **la copie générée** du moteur. `demarrer_session` ajoute `projection: { phrase, couverture }` (null en cas d'échec, sans lever).
- Conduite (§ 7.3) ajoutée aux `INSTRUCTIONS` et renvoyée par `projeter`.
- Expertise : la fiche de conduite de l'expertise « projection » (EX1) cite les outils ; le banc EX3 recevra des cas de référence (Opus, plus tard).

## 16. Tests

- **Moteur** (`test/projection.test.mjs`) : tous les cas du § 12 depuis la fixture ; ordre des opérations d'un mois ; pureté (entrée non modifiée) ; aucune valeur de secours quand un repère manque ; couverture ; textes au tutoiement, sans « conseiller » ni produit.
- **Fiscalité** (`test/projection-fiscalite.test.mjs`) : chaque ligne du § 5.2 ; dates DAT1 aux bornes (veille et lendemain de `pea_5_ans`) ; règles NV marquées.
- **Événements** (`test/projection-evenements.test.mjs`) : chaque type, validation et messages (parité avec la base et le store démo), extensibilité (un type réservé est refusé).
- **IMMO1** (`test/projection-capacite.test.mjs`) : cas I-1 à I-5, non-régression des chiffres de Rang avec les mêmes taux.
- **Monte-Carlo** (`test/projection-mc.test.mjs`) : MC-1 à MC-8, matrice définie positive, temps (plafond large).
- **Connecteur** (`test/projection-mcp.test.mjs`) : la copie générée est à jour (`npm run gen` sans écart) ; sorties identiques à l'app sur la fixture et la démo ; outils, annotations, validations, conduite.
- **Migration** (`test/projection-pglite.test.mjs`) : tables, contraintes, RLS (B ne lit ni n'applique rien de A), politiques MFA, propositions tout ou rien, `export_all`, cascade, `config.projection`, `indices_mensuels` en lecture seule pour `authenticated`, diff de `appliquer_propositions` contre 0029 limité aux ajouts.
- **Interface** (`test/graphe-patrimoine.test.mjs`, `aujourdhui`, `objectifs-view`, `pilotage`, `bilan`) : SVG, phrase de titre, jalons (boutons, bulle, Échap), objectifs (mot + couleur), tableau, panneau, mobile, mouvement réduit, libellé de la source des versements, lecture seule.

## 17. Hors périmètre

- Calcul inverse, tornade (SIM3), leviers (SIM4), score de trajectoire (SCO1), prévu contre réalisé (CK5) : ils s'appuieront sur ce moteur.
- Événements réservés (chômage, séparation, invalidité, retraite, héritage, congé parental, temps partiel), pensions (PAT2), impôt sur le revenu du foyer et quotient familial (PAT1), aides familiales.
- Inflation et taux aléatoires ; queues épaisses ; surtaxe des plus-values immobilières ; option pour le barème ; imputation des moins-values ; frais de vente d'un bien.
- Le simulateur « Acheter ou louer » (DEC1).
- La page Pilotage › Projections (emplacement réservé dans `app.js`) : elle recevra la vue complète avec SIM3.
