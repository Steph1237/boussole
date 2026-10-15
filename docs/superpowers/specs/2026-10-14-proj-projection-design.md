# PROJ : moteur de projection, graphique maître, événements de vie et capacité d'emprunt

Date : 2026-10-14. Statut : **relue le 2026-10-14 (tâche 0, Opus)** : points non vérifiés levés sur les sources officielles (§ 11.5), formules recalculées (corrections D-9 et F-5), cas de référence figés dans `test/fixtures/projection-cas.json` (§ 12), retours produit du 2026-10-14 intégrés (décisions 12 à 18). Validée par Stéph (« go code PROJ »).
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

Retours produit du 2026-10-14 (Stéph, transmis pendant la tâche 0 ; ils ne se rediscutent pas non plus) :

12. **Versements réalistes.** Un patrimoine qui fait plus que doubler en 5 ans « paraît irréaliste » : le cône actuel projette l'épargne **prévue au budget** alors que l'épargne réellement constatée sur les comptes est nulle (période entre deux emplois). La base des versements est **toujours la capacité constatée** (6 à 12 derniers mois des comptes, virements internes exclus, retraits d'épargne comptés), comparée au budget prévu et aux versements programmés ; au-delà de 30 % d'écart, les deux sont montrées, la constatée est retenue, avec une puce « hypothèse » modifiable par le Copilote (§ 6.1). Un **changement d'emploi** (date, salaire) est un événement de vie V1, le cas réel le plus courant (§ 7.1). (Les montants du cas réel ne sont pas recopiés ici : la fixture le reproduit avec des chiffres fictifs, cas G-1 et G-2.)
13. **Rendements attendus prudents.** Les rendements centraux sont confrontés aux hypothèses de long terme publiées par de grandes maisons (Vanguard, Amundi, J.P. Morgan) ; le central retenu est le plus bas de l'historique et de ces estimations, et le panneau dit quand il est sous la moyenne historique. Volatilités et corrélations restent historiques (§ 4.3).
14. **Garde-fous de vraisemblance affichés** : décomposition à chaque horizon (« dont X € de tes versements, Y € des marchés, −Z € de frais et d'impôts, en euros d'aujourd'hui ») ; alerte quand les versements projetés dépassent la capacité constatée, quand le rendement implicite de la médiane dépasse le rendement attendu du profil, quand la croissance médiane à 5 ans dépasse une borne (§ 6.8).
15. **Rétro-contrôle.** Le moteur est rejoué depuis des dates passées sur l'historique (HIS1, HIS2) et la couverture des bandes est comparée à ce qui s'est réellement passé ; affichée dans « Comment c'est calculé » quand l'historique suffit (§ 6.9).
16. **Un enfant change tout.** La naissance baisse la capacité (coût par âge, garde avec l'aide de la Caf quand elle est vérifiable, baisse de revenu d'un congé parental déclaré ; effet fiscal du quotient familial seulement s'il est vérifié, sinon « non modélisé ») ; le Copilote vérifie les événements à venir avant toute projection, et l'en-tête dit « Événements pris en compte : … » ou « aucun événement renseigné — as-tu des changements prévus ? » (§ 7).
17. **Existant et épargne future séparés** : deux couches sur le même graphique et les mêmes chemins (« Ton patrimoine actuel, sans nouveau versement » et « + ton épargne future »), l'écart légendé ; une bande « capacité d'épargne » sous le graphique (constatée aujourd'hui, puis future mois par mois, avec la raison de chaque marche) ; la même séparation dans `projeter` (§ 6.7, § 10).
18. **« C'est le master graph, il faut qu'il soit parfait »** : passé et futur forment un seul outil, sur **un seul axe du temps proportionnel**, une seule commande de fenêtre, une lecture au doigt (curseur et panneau de lecture fixe), un mode plein écran, des tests d'acceptation (§ 10), dans la grammaire de l'audit UX mobile (`~/Finance/docs/boussole-ux-mobile.md`, constats P2 et P10).

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
| 11 | **Objectif binaire** (« en avance », « en retard ») sans probabilité. | Faux sentiment de certitude. | Probabilité d'atteinte sur les chemins (§ 10.7). SIM3 ira plus loin (calcul inverse). |
| 12 | **Capacité d'emprunt d'aujourd'hui seulement**, taux codés en dur (`LOAN.rates`), taux d'usure du 3ᵉ trimestre (périmés au 1ᵉʳ octobre 2026), aucune date de source. | Ni « combien dans 3 ans ? », ni date du taux. | IMMO1 : repères datés, trajectoire calculée par le moteur (§ 8). |
| 13 | **Versements tirés du budget prévu** même quand les comptes disent autre chose (cas réel : une épargne mensuelle prévue au budget, une épargne constatée nulle). | Un patrimoine qui paraît presque doubler en 5 ans : irréaliste, et rien ne le signale. | Capacité constatée sur 6 à 12 mois par défaut, écart signalé, garde-fous (§ 6.1, § 6.8). |
| 14 | **Rendements historiques pris comme attendus** (7 % pour les actions monde). | Plus optimiste que les estimations prospectives publiées (4,4 % à 7 %). | Rendement central prudent et sourcé (§ 4.3). |
| 15 | **Patrimoine actuel et épargne future confondus** ; passé et futur sur deux échelles de temps (HIS1 comprime le passé dans 30 à 60 % de la largeur). | On ne voit ni ce que rapporte l'existant seul, ni la part des versements ; la pente change à « Aujourd'hui ». | Deux couches, un seul axe proportionnel (§ 10). |

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
Projection.capaciteDeBase(data, options) → { constatee, prevue, programmee, retenue, source, ecart_pct, signale, periode }   // § 6.1
Projection.retroControle(data, historique, opts) → { origines, couverture }  ;  Projection.couverture(origines) → { n, taux_p10_p90, … }  // § 6.9
Projection.HYPOTHESES, Projection.EVENEMENTS, Projection.CLASSES_TIREES, Projection.GRAINE, Projection.versionModele
```

- **`options`** : `{ horizon_ans: 5|10|15|20|25 (défaut 10), perimetre: "foyer"|"p1"|"p2", vue: "net"|"financier"|"disponible" (défaut "net"), euros: "constants"|"courants", net_impots: bool (défaut faux), variante: id|null, chemins: 2000, graine: GRAINE }`. Deux réglages de test et d'hypothèse, jamais enregistrés : `hypotheses_classes: { classe: { rendement, volatilite } }` (remplace les repères centraux et les volatilités de `Marche` ; une variante peut le porter dans `hypotheses`, ce qui déclenche le garde-fou du rendement implicite, § 6.8) et `capacite_mensuelle` (capacité fixée, équivalent de `config.projection.base_capacite: "montant"`).
- **Sorties ajoutées par les retours produit** (mêmes noms dans `projeter`) : `existant` (centiles de la couche « sans nouveau versement », § 6.7), `epargne_future` (écart chemin par chemin, ses centiles et sa décomposition), `capacite_par_periode` (`[{ debut, fin, montant_mensuel, raison, source, evenement_id? }]`, § 6.7), `capacite_base` (sortie de `capaciteDeBase`), `decomposition` (par horizon, § 6.8), `garde_fous` (`[{ cle, niveau, texte, valeurs }]`, § 6.8), `evenements_pris_en_compte` (libellés, ou liste vide avec la question du § 7.3), `retro` (couverture si affichable, § 6.9).
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

- **Rendement central (décision 13)** : repère `rendement_central_<classe>` (§ 11.3), défini comme **le plus bas** du rendement historique de `Marche.CLASSES[classe].rendementLong` et de la moyenne des estimations prospectives à 10 ans publiées pour un investisseur en euros (Vanguard VCMM, Amundi CMA), arrondi au demi-point inférieur. Le panneau dit « sous la moyenne historique (7 %) » quand c'est le cas. Sans repère, le moteur prend `rendementLong` et l'écrit (« rendement historique, sans hypothèse prospective »). Volatilités et corrélations : `Marche.CLASSES` et `Marche.CORRELATIONS` (historiques, SP2). Table complète et sources au § 11.3.
- **Interprétation [C]** : le rendement central est un **rendement géométrique annuel nominal** (taux de croissance médian, avant frais des fonds). Le logarithme du rendement mensuel suit une loi normale de moyenne `μ_m = ln(1 + rendementLong) / 12` et d'écart type `σ_m = volatilite / √12`. Conséquence vérifiable : sans versement ni frais, la médiane des chemins à `T` ans vaut `V0 × (1 + r)^T` (cas MC-1, § 12.5).
- **Monétaire et livrets** : le repère du taux réglementé en vigueur (`livret_a_taux`, `lep_taux`) tant que `date(t) ≤ date_fin` (DAT1), puis le rendement central de la classe `monetaire`. Volatilité 0 pour les livrets réglementés (taux connu à l'avance), celle de la classe pour un fonds monétaire.
- **Compte courant** (type `courant`) : rendement 0 et volatilité 0 **[C]** (un compte courant n'est pas rémunéré ; sans cette règle, `Calc.classe` le rangerait en `monetaire` à 1,5 %).
- **Fonds euros** : rendement long de la classe `fonds_euros`, volatilité 0 (capital garanti).
- **Immobilier physique** (biens, § 6.4) : classe ajoutée `immobilier_physique` : `π + immo_revalorisation_reelle` (repère, 0 %), volatilité `immo_volatilite` (5,3 %, calculée sur la série de l'Insee, § 11.4), corrélations de la classe `immobilier` de `Marche`, et 0,5 avec `immobilier` (**convention**, aucune source). Les SCPI restent dans la classe `immobilier` de `Marche` (rendement total, distribution comprise) ; la part distribuée est traitée au § 5.3.

### 4.4 Monte-Carlo

#### 4.4.1 Tirages
- **Générateur** : `xoshiro128**` sur des entiers de 32 bits, un état par chemin, initialisé par `splitmix32(graine ⊕ (i × 0x9E3779B9))` pour le chemin `i`. Normales par Box-Muller (les deux valeurs servent, dans un ordre fixe). `GRAINE = 20261014` par défaut.
- **Nombres aléatoires communs** : pour le chemin `i` et le mois `t`, le moteur tire **toujours** un vecteur de normales indépendantes de la même longueur, une par classe de la liste fixe `Projection.CLASSES_TIREES` : les classes de `Marche.CLES` **sauf `levier`** (un produit à levier n'a pas de tirage propre, il prend celui de son sous-jacent, § 4.4.3), + `actions_nasdaq100` (ligne de corrélations de `levier` dans `Marche`, qui est une reconstitution sur le Nasdaq-100) + `immobilier_physique`, soit **12 classes**, **même si le foyer ne détient pas la classe**. Ainsi le choc de la classe `k` au mois `t` du chemin `i` est le même quelles que soient la variante, l'allocation ou l'horizon. Test : une variante qui ne fait qu'ajouter 100 € par mois donne, **chemin par chemin**, une valeur supérieure ou égale (cas MC-4).
- **Corrélations** : `z = L · ε`, `L` facteur de Cholesky de la matrice de corrélation des classes tirées (calculé une fois). Avec les valeurs actuelles, la matrice des 12 classes est définie positive (plus petite valeur propre 0,077, vérifiée en tâche 0, cas MC-10). Si une mise à jour la rendait non définie positive, elle serait corrigée par projection sur la matrice définie positive la plus proche (méthode de Higham), et un test vérifie que l'écart reste sous 0,02 par coefficient. Classes à volatilité 0 : tirées quand même (pour la stabilité des flux), sans effet.
- **Loi** : normale sur les log-rendements mensuels. **Limite assumée** : pas de queues épaisses ; les crises rejouées (§ 4.6) montrent les chocs extrêmes, et le texte le dit.

#### 4.4.2 Rendement d'un compartiment
`ln(1 + r_k,t) = μ_m,k + σ_m,k · z_k,t` pour une classe `k` sans levier.

#### 4.4.3 Levier quotidien
Un produit qui vise `L` fois la performance **quotidienne** d'un indice de classe `u` (sous-jacent), recalibré chaque jour, suit sur un mois :

`ln(1 + r_L,t) = L · x_u,t − (L − 1) · r_fin / 12 − L (L − 1) · σ_u² / 24`

où `x_u,t = μ_m,u + σ_m,u · z_u,t` est le log-rendement du sous-jacent **sur le même tirage** (le produit à levier est donc corrélé à son indice sans tirage propre), `σ_u` sa volatilité annuelle, `r_fin` le coût de financement annuel (repère `estr_taux`, taux €STR de la BCE, § 11.4). Les frais du produit (`ter_pct`) sont déduits au § 5.1 comme pour tout fonds.
- Résultat classique pour un levier recalibré chaque jour sur un indice log-normal : `V_L(T) = V_L(0) · (S_T / S_0)^L · exp(−(L−1) r_fin T − L(L−1) σ² T / 2)`. Le dernier terme est la **perte due à la volatilité** : elle croît comme `σ²` et peut annuler l'effet du levier.
- Exemple (cas D-9, § 12.1) : sous-jacent à 7 % par an et 22,5 % de volatilité, financement 2 %, frais 0,6 % : 10 000 € deviennent **10 604,30 €** en un an (`exp(2 ln 1,07 − 0,02 − 0,050625) × (1 − 0,006)`, frais selon § 5.1 ; la version précédente appliquait `exp(−0,006)` et donnait 10 604,49 €) : un ×2 croît en médiane d'environ **6,0 % par an**, moins que son indice (7 %). L'ancien modèle supposait 9 %.
- Le sous-jacent par défaut est `actions` ; `actions_nasdaq100` est pris quand le nom ou la poche contient « nasdaq ». Sa **volatilité** est le repère `nasdaq100_volatilite` (22,9 %, Nasdaq, rendement total 2008-2026, § 11.4) ; son **rendement central** est celui des actions monde (**convention** : les 16,7 % par an publiés pour 2008-2026 ne sont pas une hypothèse prudente, et aucune estimation prospective n'a été lue). Sans le repère de volatilité, le moteur prend celle des actions et l'écrit (« la perte due au levier est sous-estimée »).
- Limite : la ruine intrajournalière (baisse de plus de 1/L en un jour) n'est pas modélisée.

#### 4.4.4 Rééquilibrage
- **Règle par défaut [C] : aucun rééquilibrage du stock.** Chaque compartiment suit sa classe ; seuls les **nouveaux versements** vont vers la cible (§ 6.2). C'est ce que font la plupart des foyers, et cela n'invente aucune vente (donc aucun impôt caché).
- **Option `reequilibrage: "annuel"`** (réglage `config.projection` ou hypothèse d'une variante) : chaque mois de janvier, les compartiments **d'une même enveloppe** sont ramenés à l'allocation cible du profil (`config.targets`, fourchettes de `Risque`), sans frottement ni impôt (un arbitrage à l'intérieur d'une enveloppe n'est pas imposé ; un compte-titres est exclu de l'option, parce qu'une vente y serait imposée). Cette option servira de levier à SIM4.

### 4.5 Résultats
- Pour chaque mois et chaque vue (`net`, `financier`, `disponible`), en euros constants (ou courants) : centiles **P10, P25, P50, P75, P90** pris sur le **total de chaque chemin**. Le centile est la valeur de rang `⌈p × N⌉` des valeurs triées (définition fixe, testée).
- **Probabilités** : pour chaque objectif, part des chemins où la valeur de ses poches atteint sa cible à sa date (§ 10.7) ; **« manquer d'argent »** : part des chemins où, un mois, le disponible et les enveloppes mobilisables ne couvrent plus un besoin (capacité négative, apport) ; la première date où cela arrive dans 10 % des chemins.
- **Jalons** (événements, DAT1, fins de crédit, objectifs) avec leur effet en euros (§ 7.4).
- **Hypothèses et sources** utilisées (clé, valeur, unité, source, date de vérification), **avertissements** (données à compléter, repères à revérifier), **couverture** (§ 6.6), `versionModele`, `graine`, `chemins`.

### 4.6 Crises rejouées
- Source : `Marche.CRISES` (chocs cumulés par classe du sommet au creux, dates de début et de fin) : `dotcom_2000`, `gfc_2008`, `covid_2020`, `taux_2022`, `inflation_1973`.
- **Un seul chemin** : rendements attendus (`μ_m`, sans aléa) partout, sauf pendant la fenêtre de crise qui commence au mois choisi `debut` et dure `d` mois (`d` = mois entre `debut` et `fin` de la crise, 31 mois pour 2000-2002, 17 pour 2008, 1 pour 2020, 9 pour 2022, 23 pour 1973-1974). Pendant la fenêtre, le log-rendement mensuel de la classe `k` vaut `ln(1 + choc_k) / d`. Les produits à levier prennent le choc `levier` de la crise (reconstitution qui inclut déjà la perte due à la volatilité), pas la formule du § 4.4.3.
- Après la fenêtre, rendements attendus. **Aucun rebond n'est forcé** (le rebond réel n'est pas dans les données de `Marche`) : c'est prudent, et le texte le dit (« après la crise, la projection reprend les rendements moyens ; dans l'histoire, les marchés sont remontés plus vite »).
- **Inflation 1973-1974** : pendant la fenêtre de 23 mois, l'inflation mensuelle vaut `(1 + 7,3 %)^(1/12) − 1` les 12 premiers mois (repère `inflation_fr_1973`) et `(1 + 13,7 %)^(1/12) − 1` les 11 suivants (`inflation_fr_1974`) (**convention** de découpage : la fenêtre de `Marche.CRISES` compte 23 mois pour deux années civiles), au lieu de 2 %. Sans ces repères, le scénario est indisponible et le dit. C'est ce scénario qui montre la perte de pouvoir d'achat de l'épargne sans risque.
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
| idem **après** `av_8_ans` | `V − base` | fraction du gain à 7,5 % (`av_taux_ir_reduit`) = gain × `min(1, 150 000 / primes)` (primes versées depuis le 27/09/2017, tous contrats du titulaire : seuil personnel), le reste à 12,8 % ; l'abattement annuel `av_abattement_seul` / `av_abattement_couple` s'impute **d'abord sur la fraction à 7,5 %**, puis sur celle à 12,8 % | 17,2 % sur tout le gain | Vérifié : BOFiP BOI-RPPM-RCM-20-15 § 190 (prorata) et BOI-RPPM-RCM-20-10-20-50 § 288 (ordre d'imputation). Simplification écrite : primes appréciées à la date du retrait (la loi les prend au 31 décembre de l'année précédente) ; primes d'avant le 27/09/2017 non distinguées. Abattement consommé une fois par année civile et par foyer. |
| `per` | versements déduits | barème : `TMI × versements déduits` | 0 sur les versements | Gains : 12,8 % + 18,6 %. **Bloqué** jusqu'à la retraite, sauf achat de la résidence principale : la ligne le dit. TMI et part déduite : hypothèses du foyer (§ 5.4). |
| `pee`, `percol` | gains | 0 | 18,6 % (`ps_taux_epargne_salariale`) | Disponibilité selon DAT1. PS vérifiés : CSS art. L136-8, IV (l'épargne salariale n'est pas dans la liste restée à 9,2 % de CSG). |
| crypto (classe `crypto`, toute enveloppe compte-titres) | `V − base` | 12,8 % | 18,6 % (`ps_taux_actifs_numeriques`) | Formule globale du portefeuille (art. 150 VH bis) simplifiée : gain = valeur − prix total d'acquisition. PS vérifiés : CSS art. L136-8, I 2° et IV (le BOFiP BOI-RPPM-PVBMC-30-30 du 23/04/2024 dit encore 17,2 % : antérieur à la LFSS 2026). |
| SCPI en direct | plus-value | 19 % (`pv_immo_ir_taux`) après abattement pour durée de détention | 17,2 % (`pv_immo_ps_taux`) après abattement | Régime des plus-values immobilières, appliqué avec `confiance: "probable"` et la mention « parts de SCPI : régime des plus-values immobilières (CGI art. 150 UB et 239 septies), à confirmer » : l'art. 150 UB vise les parts de sociétés à prépondérance immobilière « qui relèvent des articles 8 à 8 ter », l'art. 239 septies rend les associés de SCPI personnellement imposables, mais aucune page officielle lue ne nomme les SCPI (§ 11.5). Abattements : IR 6 % par an de la 6ᵉ à la 21ᵉ année, 4 % la 22ᵉ ; PS 1,65 % par an de la 6ᵉ à la 21ᵉ, 1,60 % la 22ᵉ, 9 % par an de la 23ᵉ à la 30ᵉ. Surtaxe au-delà de 50 000 € de plus-value imposable : signalée, non calculée en V1. |
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
- `tmi_pct` : taux marginal d'imposition, parmi les taux du barème (0, 11, 30, 41, 45 %, vérifiés : service-public F1419, barème 2026 des revenus 2025 ; seuils en repères `ir_bareme_<taux>_seuil`). Lu dans `config.projection` ; absent, l'option « net d'impôts » utilise 30 % et le dit (« taux marginal supposé de 30 %, à confirmer avec Claude »). PAT1 le calculera.
- `per_versements_deduits` : vrai par défaut (cas le plus courant), dit dans le panneau.
- `couple_imposition_commune` : déduit de `profil.foyer` (marié ou pacsé).

## 6. Les flux du foyer

### 6.1 Capacité d'épargne de départ
- **Capacité constatée d'abord (décision 12)** : `Calc.budgetReel(banque, today, k)` sur les **12** derniers mois complets quand ils existent, sinon sur tous les mois complets disponibles s'il y en a au moins **6**, sinon sur 3 (règle de FIX1, avec la mention « période courte »). Capacité = revenus − dépenses des comptes courants : les virements internes sont exclus et un retrait d'épargne qui finance des dépenses fait baisser la capacité (il n'est pas compté comme un revenu). Sur une fenêtre de 6 à 12 mois, une période sans revenu ou une prime ponctuelle pèse moins que sur 3 mois.
- **Comparaison affichée** : `Projection.capaciteDeBase` rend la constatée, la **prévue** (`Plan.capaciteEpargne(Plan.budgetTotaux(...))`) et les **versements programmés** (`config.recurring`, total mensuel). Si la prévue (ou les versements programmés) s'écarte de la constatée de plus de `garde_fou_ecart_capacite` (30 %, convention) de la plus grande des deux valeurs absolues, les deux sont montrées (« capacité constatée 0 €/mois, d'octobre 2025 à septembre 2026 ; prévue au budget 1 500 €/mois ») et **la constatée est retenue**, avec une puce « hypothèse » : le Copilote peut proposer `config.projection.base_capacite: "reel" | "prevu" | "montant"` (avec `capacite_mensuelle`), après avoir demandé pourquoi les deux diffèrent (période sans revenu, dépense exceptionnelle, nouvel emploi). Sans comptes connectés : la prévue, dite comme telle. Le résultat porte `capacite_source: "reel" | "prevu" | "montant"` et sa période.
- **Ne pas compter deux fois** un changement déjà visible dans la fenêtre : un événement de revenu (changement d'emploi, congé) se mesure par rapport au **revenu de référence** de la personne sur la fenêtre observée (§ 7.1).
- Elle se décompose en `revenus_0` (revenus nets mensuels du périmètre), `depenses_0` (dépenses hors mensualités de crédit) et `mensualites_0` (crédits en cours) : `capacite_0 = revenus_0 − depenses_0 − mensualites_0`. Si le budget ne permet pas la décomposition (réel connu seulement en total), `depenses_0 = revenus_0 − mensualites_0 − capacite_0`.
- Périmètre d'une personne : ses revenus, ses crédits propres, la moitié des crédits communs (règle de `Plan.lignesCredits`), la moitié des dépenses communes du budget. La capacité constatée n'existe que pour le foyer (les comptes ne sont pas répartis par personne) : pour une personne, la capacité prévue est utilisée et dite comme telle.

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
- **Destination d'une capacité positive avec `reste_capacite: "disponible"`** : le compte courant du périmètre (créé à 0 s'il n'existe pas) ; les livrets ne reçoivent que des versements programmés.
- **Capacité négative** : retrait selon l'ordre du § 6.3 ; si rien ne couvre le besoin, le chemin est compté dans « manquer d'argent » et le disponible devient négatif (découvert visible, pas masqué).
- **Conventions de date (testées, fixture)** : un événement daté `d` s'applique au premier mois `t ≥ 1` tel que `date(t) ≥ d` ; sa `fin` est exclue (mois `t` tels que `date(t) < fin`). Un crédit créé au mois `t` paie sa première échéance au mois `t + 1`.

### 6.3 Ordre de retrait (apport, retrait ponctuel, capacité négative)
Ordre **déterministe** par niveaux, puis, à l'intérieur d'un niveau, par **coût fiscal croissant** (impôt ÷ net obtenu, calculé avec § 5.2 à la date du retrait, sur `min(besoin, valeur du compartiment)`) ; à coût égal, l'ordre de la liste :
1. disponible au-dessus du matelas (compte courant, puis livrets) ;
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
- **Crédits existants** (`credits`, `biens.crd` et `biens.mensualite`) : tableau d'amortissement mensuel à échéance constante (`Projection.amortissement`). Taux et fin : `config.prets_infos` (DAT1). Taux connu et fin inconnue → durée restante déduite du capital restant dû et de la mensualité. Fin connue et taux inconnu → taux déduit (dichotomie). Les deux inconnus → taux supposé égal au repère du taux moyen sur 20 ans (§ 8.1), durée déduite, mention « taux du crédit supposé, à compléter » (§ 6.6). La mensualité de `credits` est supposée assurance comprise (champ unique) ; la part d'assurance ne rembourse pas le capital et est séparée ainsi : `assurance_taux_pct` connu (par an, sur le capital initial) avec le taux et la durée totale (`duree_mois`) → capital initial `C0 = mensualité ÷ (annuité(taux, durée totale) + assurance_taux_pct / 12)`, assurance `C0 × assurance_taux_pct / 12`, le reste amortit le capital (cas L-1) ; `assurance_taux_pct` connu sans le taux ou la durée totale → assurance estimée sur le **capital restant dû d'aujourd'hui**, convention dite par une mention (cas L-2) ; `assurance_taux_pct` à 0 → aucune part d'assurance, sans mention ; inconnu → aucune séparation, la mensualité entière amortit le capital, avec la mention « assurance du crédit inconnue » (le capital est alors remboursé un peu trop vite, cas L-3). Durée restante, taux déduit et capital restant dû se calculent sur la part qui amortit ; la mensualité décaissée reste la mensualité entière.
- **Convention de taux** : taux nominal annuel proportionnel (`taux / 12` par mois), échéance `C · i / (1 − (1 + i)^−n)` ; assurance sur le capital initial (`C × assurance_pct / 12` par mois), comme `toise.js`.
- **Fin d'un crédit** : la mensualité libérée part dans la capacité selon `part_reaffectee_epargne_pct` (défaut **100 %**, « si tes dépenses n'augmentent pas » : hypothèse dite, levier de SIM4 et astuce 11 d'OPT1), modifiable par un événement `fin_credit` (§ 7.1). Le jalon « Fin du prêt » est automatique (DAT1 `pret_fin` ou fin calculée).
- **Patrimoine net** = financier + Σ (valeur des biens × part) − Σ capitaux restant dus (× part).

### 6.5 Vues
- `net` : patrimoine net (§ 6.4) ; `financier` : compartiments financiers ; `disponible` : compartiments disponibles (§ 4.1). Vue `net` par défaut sur Aujourd'hui, `financier` sur Placements, poches de l'objectif sur Objectifs (§ 10).

### 6.6 Couverture et données manquantes
Le résultat liste, comme Santé, ce qui manque et son effet : prix de revient, date d'ouverture d'enveloppe (DAT1), taux d'un crédit, frais d'enveloppe, frais d'une école, prix d'achat d'un bien, taux marginal. Chaque élément a un bouton « Compléter avec Claude » (phrase prête). `couverture = données présentes ÷ données utiles` ; sous 60 %, la phrase de titre ajoute « provisoire ».

### 6.7 Existant et épargne future (décision 17)
- **Deux couches, mêmes chemins.** Dans la même boucle et avec les **mêmes tirages**, le moteur suit une seconde copie de l'état : la couche **« existant »** = le patrimoine d'aujourd'hui seul (compartiments à leur valeur du jour, rendements, frais et rééquilibrage identiques), **sans aucun flux** : capacité 0, aucun versement programmé, aucun événement, aucun retrait ; les biens existants sont revalorisés, les **crédits existants sont figés** à leur capital restant dû d'aujourd'hui (le capital remboursé vient des revenus futurs : il est compté dans l'épargne future). La projection **complète** est celle des § 6.1 à 6.4.
- **Épargne future** = complet − existant, **chemin par chemin** (puis centiles de l'écart). Sans événement ni retrait, elle vaut exactement `Σ_k versement_k × Π_{j>k} (1 + r_j)` sur les mêmes chemins (cas MC-9) ; avec des événements, elle inclut leurs effets et s'appelle « + ton épargne future et tes projets ».
- **Sortie** : `existant` (centiles par mois), `epargne_future` (centiles de l'écart ; versements cumulés en euros d'aujourd'hui ; croissance des versements), et pour chaque horizon affiché les deux nombres (« dans 10 ans : ton patrimoine actuel seul, 180 000 € en médiane ; avec ton épargne future, 340 000 € »).
- **`capacite_par_periode`** : la capacité mensuelle (en euros d'aujourd'hui) découpée en périodes constantes, chacune avec sa raison et sa source : `[{ debut, fin, montant_mensuel, raison, source: "constatee"|"prevue"|"montant"|"evenement"|"credit", evenement_id? }]` (« capacité constatée d'avril à septembre : 300 €/mois » ; « nouvel emploi de Sam : +400 €/mois » ; « Enfant 1 : −1 020 €/mois » ; « fin du prêt auto : +300 €/mois »). Calculée sur le chemin déterministe. Elle alimente la bande « capacité d'épargne » du graphique (§ 10.1) et `projeter`.

### 6.8 Garde-fous de vraisemblance (décision 14)
- **Décomposition** à chaque horizon affiché, sur le chemin déterministe (§ 4.7), en euros d'aujourd'hui : `total = départ + versements nets + marchés − frais − impôts (+ biens et dettes en vue net)`, où *versements nets* = versements moins retraits (chacun déflaté à sa date), *frais* et *impôts* = sommes des montants prélevés (déflatés), et *marchés* = le reste (gains réels des placements). Phrase : « Dans 10 ans, médiane 400 000 € : 120 000 € de ton patrimoine d'aujourd'hui, 180 000 € de tes versements, 120 000 € des marchés, −20 000 € de frais (en euros d'aujourd'hui). »
- **Alertes** (`garde_fous: [{ cle, niveau: "info"|"alerte", texte, valeurs }]`), toutes montrées au-dessus du graphique quand elles se déclenchent :
  1. `ecart_capacite` (info) : capacité prévue ou versements programmés à plus de 30 % de la constatée (§ 6.1) : les deux montants et leur période.
  2. `versements_superieurs_capacite_constatee` (alerte) : la base retenue n'est pas la constatée (`base_capacite` forcée) et la capacité moyenne des 12 premiers mois dépasse la constatée de plus de `max(100 €, 30 %)` : « la projection suppose 1 500 €/mois d'épargne ; tes comptes montrent 0 €/mois d'octobre 2025 à septembre 2026 ».
  3. `rendement_implicite` (alerte) : rendement annuel implicite de la médiane de la couche existant, `(P50_existant(T) / V0)^(1/T) − 1` avec `T` = 5 ans (ou l'horizon s'il est plus court), supérieur de plus de `garde_fou_rendement_marge` (0,5 point) au **rendement attendu du profil** (`rendementAttendu` des compartiments d'aujourd'hui avec les repères centraux, net de frais, pondéré par la valeur). Il ne se déclenche que si des hypothèses ont été modifiées (variante, `hypotheses_classes`) ou en cas d'erreur du moteur : c'est aussi un test.
  4. `croissance_5_ans` (alerte) : `P50_total(60 mois) ÷ (V0 + Σ versements nominaux des 60 mois) > (1 + garde_fou_croissance_annuelle)^5`, avec 8 % par an (convention : au-dessus du rendement central de toute classe diversifiée) : « plus de 8 % par an en médiane : hypothèse très optimiste ».
- Les seuils sont des repères **CONV** (§ 11.4) ; cas G-1 à G-4 de la fixture (dont le cas réel, en chiffres fictifs : G-1 avec la base constatée, 165 587 € à 5 ans pour 125 000 € aujourd'hui ; G-2 avec la base prévue forcée, 269 816 € et l'alerte 2).

### 6.9 Rétro-contrôle (décision 15)
- `Projection.retroControle(data, historique, { horizon_mois: 12, chemins: 2000 })` : pour chaque **date de départ** `o` passée (fin de mois) où HIS1 (`Historique.fusionner`) donne la composition par compartiment et classe, et où la valeur réelle à `o + h` est connue : le moteur est lancé depuis `o` avec les positions de `o`, les **flux réellement observés** entre `o` et `o + h` (versements et retraits nets, HIS2 et banques ; ainsi seul le modèle de marché est testé), sans événement ; on relève les centiles prévus à `o + h` et la valeur réelle.
- `Projection.couverture(origines)` → `{ n, dans_p10_p90, taux_p10_p90, dans_p25_p75, taux_p25_p75, sous_p10, au_dessus_p90, affichable }` (bornes incluses ; cas BT-1, BT-2). Attendu d'un modèle bien calibré : 80 % et 50 %.
- **Affichage** dans « Comment c'est calculé » seulement si `n ≥ retro_min_origines` (24, convention) : « Rejouée depuis 30 dates passées, la projection à 1 an a encadré la valeur réelle 8 fois sur 10 (attendu : 8 sur 10). Les dates se chevauchent : c'est indicatif. » Sous 65 % : « les bandes ont été trop étroites sur ton historique ». En dessous de 24 dates : « pas encore assez d'historique pour vérifier la projection ».
- Limites écrites : périodes qui se chevauchent (pas indépendantes), historique court, reconstitution HIS1 approximative avant la première photo. Un rétro-contrôle de marché sur longue période (indices de `Marche` depuis 1970) attend les séries de la nuit (EX2).

## 7. Événements de vie (FOY1-lite)

### 7.1 Types V1
Tous les montants sont en **euros d'aujourd'hui**. `date` = premier jour d'effet ; `fin` facultative. `personne` ∈ `p1`, `p2`, `foyer`. Les enfants sont désignés par un **libellé court** (`enfant`, 1 à 40 caractères, « Enfant 2 »), jamais un prénom imposé.

| `type` | Paramètres (`params`) | Effet | Valeurs par défaut sourcées |
|---|---|---|---|
| `naissance` | `enfant`, `date` (naissance réelle ou prévue), `cout_mode: "uc"|"montant"`, `cout_mensuel?`, `fin_age?` | Dépenses `+ c(âge)` chaque mois de la naissance à `fin_age` ; un enfant déjà né est déjà dans les dépenses d'aujourd'hui : seuls les **changements** (passage à 14 ans, fin de charge) comptent. | `cout_mode: "uc"` : `c = dépenses courantes par unité de consommation × 0,3` avant 14 ans, `× 0,5` à partir de 14 ans (échelle de l'OCDE utilisée par l'Insee, § 11.1). Dépenses par UC = `depenses_0 ÷ UC du foyer aujourd'hui` (1 pour le premier adulte, 0,5 par personne de 14 ans ou plus, 0,3 par enfant de moins de 14 ans ; `depenses_0` de la capacité constatée quand elle est retenue). `fin_age` : 20 ans (convention, § 11.4). La garde et le congé parental sont des événements à part (`creche`, `conge_parental`), proposés ensemble par le Copilote. **Quotient familial** : non modélisé en V1 (l'impôt du foyer n'est pas calculé, PAT1) ; la bulle du jalon le dit avec le plafond vérifié (« une demi-part de plus réduit l'impôt d'au plus 1 807 € par an ; non compté ici », service-public F2705). |
| `creche` (garde d'un jeune enfant) | `enfant`, `date`, `fin?`, `mode: "psu"|"assistante_maternelle"|"montant"`, `heures_mois?`, `ressources_mensuelles?`, `cout_mensuel?`, `cmg_mensuel?` | Dépenses `+ coût net` de `date` à `fin`. | `mode: "psu"` (crèche, micro-crèche PSU) : barème national de la Cnaf, `taux d'effort × ressources mensuelles × heures` ; taux selon le nombre d'enfants à charge à la date (profil + naissances déclarées) : 0,0619 % (1 enfant), 0,0516 % (2), 0,0413 % (3), 0,0310 % (4 à 7), 0,0206 % (8 et plus) ; ressources bornées au plancher (814,62 €) et au plafond (8 500 €) de 2026 ; `ressources_mensuelles` = revenus du foyer au premier mois de garde, **figées** (convention : la Caf retient les revenus de l'année N−2) ; `heures_mois` : 200 (convention) ; `fin` : 1er septembre de l'année des 3 ans (instruction obligatoire à 3 ans, vérifiée ; date de rentrée : convention). `mode: "assistante_maternelle"` : `cout_mensuel` **obligatoire** (salaire et indemnités, avant aide) ; l'aide de la Caf (CMG) n'est déduite que si `cmg_mensuel` est donné (montant du simulateur de la Caf ou de Pajemploi) : sa formule depuis le 1er septembre 2025 n'a pas été lue sur une page officielle (F39152 renvoie au simulateur), donc sans `cmg_mensuel` le coût est brut, avec la mention « aide de la Caf non déduite : coût surestimé ». Crédit d'impôt pour frais de garde : PAT1. |
| `scolarite_privee` | `enfant`, `niveau: "maternelle"|"elementaire"|"college"|"lycee"|"superieur"`, `date`, `fin`, `frais_annuels` | Dépenses `+ frais_annuels / 12`. | **Aucune** : les frais varient trop d'un établissement à l'autre et aucune source officielle ne publie de moyenne. `frais_annuels` est obligatoire ; le Copilote demande le tarif de l'établissement. |
| `achat_immobilier` | `date`, `prix`, `usage: "rp"|"locatif"|"secondaire"`, `neuf`, `primo`, `apport: montant | "max"`, `autoriser_cloture_pea?`, `pret: { duree_ans, taux_pct?, assurance_pct? }`, `loyer_remplace?`, `charges_mensuelles`, `loyer_percu?`, `libelle` | Le mois `date` : apport retiré (§ 6.3), frais d'acquisition payés, nouveau bien (valeur `prix`) et nouveau crédit (`prix + frais − apport`) ; ensuite mensualité et charges en dépenses, loyer remplacé retiré des dépenses (résidence principale), loyer perçu en revenus (locatif). | Frais d'acquisition : repères `frais_acquisition_*` (§ 8.1) ; taux : repère du jour pour la durée ; assurance : 0,30 % (hypothèse dite) ; `loyer_remplace` : ligne « loyer » du budget s'il y en a une ; `charges_mensuelles` obligatoire (taxe foncière, copropriété, entretien : le Copilote les demande). `apport: "max"` = tout le mobilisable au-dessus du matelas. |
| `retrait` | `date`, `montant`, `libelle` | Retrait net (§ 6.3) : voiture, voyage, travaux. | — |
| `hausse_revenu` | `personne`, `date`, `delta_mensuel` (net, € d'aujourd'hui, positif ou négatif) ou `delta_pct`, `part_epargnee_pct?` | Revenus `+ delta` ; capacité `+ delta × part_epargnee_pct` si `delta > 0`, `+ delta` (baisse entière) si `delta < 0`. | `part_epargnee_pct` : 50 % (hypothèse dite, le Copilote la demande). |
| `fin_credit` | `credit: "credit:<uuid>"|"bien:<uuid>"`, `part_reaffectee_epargne_pct`, `date_fin?` | Remplace la règle de réaffectation (et la date si elle est connue autrement). | Règle par défaut du § 6.4. |
| `crise` | `cle` (`Marche.CRISES`), `date` | Fixe la crise rejouée et sa date pour la situation ou la variante (§ 4.6). | — |
| `changement_emploi` (décision 12) | `personne`, `date`, `salaire_net_mensuel` (net avant impôt, € d'aujourd'hui ; 0 pour une période sans revenu), `revenu_reference_mensuel?`, `part_epargnee_pct?`, `fin?` | Le salaire de la personne devient `salaire_net_mensuel` à `date` (puis suit la hausse tendancielle) ; `Δ = salaire_net_mensuel − revenu_reference_mensuel` ; capacité `+ Δ × part_epargnee_pct` si `Δ > 0`, `+ Δ` (baisse entière) si `Δ < 0`. Avec `fin`, retour au revenu de référence. | `revenu_reference_mensuel` : revenu mensuel **moyen de la personne sur la fenêtre de la capacité constatée** (le Copilote le calcule avec l'utilisateur ; une période sans revenu dans la fenêtre fait baisser la référence, ce qui évite de compter le retour à l'emploi deux fois) ; à défaut, le salaire du profil, avec la mention « revenu de référence supposé ». `part_epargnee_pct` : 50 % (hypothèse dite). Cas C-7. |
| `conge_parental` (décision 16) | `personne`, `date`, `fin`, `activite: "arret"|"mi_temps"|"temps_partiel"`, `quotite_pct?`, `enfant`, `rang_enfant?` | Revenus de la personne `× quotité` (0, 50 % ou 80 % par défaut) pendant le congé, plus la PreParE ; capacité `+ (revenu perdu en moins) + PreParE` (la baisse est entière). | PreParE (service-public F32485, vérifiée) : 459,70 €/mois (arrêt), 297,17 € (50 % au plus), 171,42 € (de 50 à 80 %) ; premier enfant, couple : 6 mois par parent avant le premier anniversaire. À partir du 2ᵉ enfant, la durée n'a pas été vérifiée : la PreParE n'est comptée que 6 mois, avec la mention. Congés de maternité et de paternité : supposés sans perte de revenu (indemnités journalières), **convention** dite. |

- **Réservés** (le schéma les accepte dans la liste des types futurs, sans effet tant que le moteur ne les implémente pas ; refusés par `decrire_foyer` en V1) : `chomage`, `separation`, `invalidite`, `retraite`, `heritage`, `temps_partiel`, `demenagement`. (`conge_parental` passe en V1 ; un chômage indemnisé se décrit en V1 par un `changement_emploi` vers le montant de l'allocation, avec `fin`.) Le modèle est extensible : un type = une fonction `effet(evenement, t, etat)` qui modifie revenus, dépenses, compartiments ou crédits ; ajouter un type = ajouter une entrée au catalogue `Projection.EVENEMENTS` (paramètres, validation, effet, textes, défauts sourcés) et son contrôle SQL.

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
7. « **Avant de montrer une projection**, regarde les événements enregistrés (`lire_foyer`). S'il n'y en a aucun, demande une fois : « Tu as des changements prévus ? Un enfant, un changement d'emploi, un déménagement, un achat ? » ; ne redemande pas dans la même session. » La sortie de `projeter` porte `evenements_pris_en_compte`, et l'en-tête du graphique dit « Événements pris en compte : Enfant 1, nouvel emploi de Sam » ou « Aucun événement renseigné — as-tu des changements prévus ? » (lien « Compléter avec Claude »).
8. « Quand la capacité prévue et la constatée diffèrent (garde-fou `ecart_capacite`), demande pourquoi avant de proposer de changer la base : période sans revenu, dépense exceptionnelle, nouvel emploi (à décrire en `changement_emploi`). »

### 7.4 Effet d'un événement en euros
Le moteur rend pour chaque jalon un `effet` chiffré, calculé sur le chemin médian du déterministe (et non sur un chemin Monte-Carlo, pour rester stable) :
- achat : apport par enveloppe source, impôts payés, frais d'acquisition, montant emprunté, mensualité (« apport −60 k€ pris sur PEA et assurance-vie, mensualité −1 100 €/mois ») ;
- naissance : coût mensuel aujourd'hui et à 14 ans (« −600 €/mois, −1 000 €/mois à partir de 14 ans ») ;
- crèche, école : coût mensuel et total ;
- hausse de revenu : revenu et épargne en plus par mois ;
- fin de crédit : mensualité libérée et part réaffectée ;
- changement d'emploi : revenu et capacité en plus ou en moins par mois (« nouvel emploi de Sam : +800 €/mois de revenus, +400 €/mois d'épargne ») ;
- congé parental : baisse de revenu, PreParE et durée (« −2 900 €/mois de salaire, +460 €/mois de PreParE, 6 mois ») ;
- naissance : le coût par mois aujourd'hui et à 14 ans, et la phrase du quotient familial (non compté) ;
- jalon DAT1 : l'effet de DAT1 (« retraits sans clôture du plan possibles »).
- Chaque effet sur la capacité apparaît aussi comme une marche de la bande « capacité d'épargne » (§ 6.7, § 10.1), avec la même raison.

## 8. IMMO1 : capacité d'emprunt aujourd'hui et demain

Affichée dans **Patrimoine › Immobilier et crédits** (module `bilan`), avec le sélecteur de périmètre existant (foyer, chaque personne). Mention fixe : « Estimation selon les règles du HCSF et les usages courants des banques. Ce n'est pas une offre de prêt : chaque banque décide. »

### 8.1 Aujourd'hui : `Projection.capaciteEmprunt(data, opts)`
- **Revenus retenus** `R` (mensuels, nets avant impôt sur le revenu, comme le prévoit la décision du HCSF) : salaires nets du périmètre (`profil.personnes.<p>.salaire`, ramené au mois) ; primes et variable : moyenne des 3 dernières années quand le profil les porte (`primes_annuelles`, champ de FOY1), sinon non comptés et la mention le dit ; revenus locatifs × `revenus_locatifs_ponderation` (70 %, **convention bancaire** usuelle, pas une règle du HCSF, § 11.4).
- **Charges** `Ch` : mensualités des crédits en cours du périmètre, assurance comprise (§ 6.4).
- **Mensualité maximale** `M = hcsf_taux_effort × R − Ch` (35 %, assurance comprise, repère existant).
- **Durée** : `hcsf_duree_max` (25 ans) par défaut ; 20 ans en sensibilité ; « jusqu'à 27 ans avec un différé, pour un achat en VEFA, en construction de maison individuelle, en contrat de promotion, ou dans l'ancien avec au moins 10 % de travaux dans le coût total ; amortissement limité à 25 ans » (`hcsf_duree_max_differe`, `hcsf_travaux_seuil_pct`, vérifiés sur Légifrance : décision du HCSF du 29/09/2021, art. 1, modifiée le 18/12/2023 pour le seuil de 10 % depuis le 01/01/2024).
- **Taux du jour** : repère `taux_credit_immo_<durée>` (Observatoire Crédit Logement/CSA, taux moyen du mois, hors assurance), avec sa date (« taux moyen d'août 2026 »). **Mise à jour** : chaque mois, par une ligne de `reperes` (la veille AG1 le signale ; le Copilote ne l'écrit pas, `reperes` est un contenu commun) ; `date_fin` = fin du mois suivant la publication, au-delà « taux à actualiser » (DAT1 : `date_fin` passée = signalée). Plus tard : la nuit (EX2). Assurance emprunteur : `config.projection.assurance_pct` du foyer, sinon 0,30 % (hypothèse dite). **Taux d'usure** : repères `taux_usure_moins_10`, `taux_usure_10_20`, `taux_usure_20_plus` (Banque de France, par tranche de durée, trimestriels : 4,09 %, 4,68 %, 5,40 % au 1ᵉʳ octobre 2026) ; 15 ans → tranche 10 à 20 ans, 20 et 25 ans → 20 ans et plus ; un TAEG estimé au-dessus est signalé. Les valeurs de `LOAN.usure` de `toise.js` sont celles du 3ᵉ trimestre (4,57 % et 5,29 %) : elles changent avec la migration (§ 8.3), sans effet sur les montants.
- **Montant empruntable** `C = M / (a(i, n) + assurance_pct / 12)`, avec `a(i, n) = i / (1 − (1 + i)^−n)`.
- **Apport mobilisable** `A` : ce que l'ordre du § 6.3 peut retirer **net d'impôts** à la date, au-dessus du matelas, sans clôturer un PEA de moins de 5 ans, PER compris (déblocage pour la résidence principale) et indiqué à part ; « à recevoir » exclu (CP4 § 1.4). Le détail par enveloppe est affiché.
- **Budget d'achat** `P = (C + A − garantie_pct × C − frais_dossier) / (1 + frais_acquisition)`, avec `frais_acquisition` = `frais_acquisition_ancien_pct` (ou `_primo_pct`, ou `_neuf_pct` selon les options). Garantie et frais de dossier : conventions de Rang (1 %, 1 000 €), dites.
- **Reste à vivre** = `R − Ch − mensualité nouvelle`, comparé aux **dépenses courantes du foyer hors logement** (§ 6.1) : « après ce crédit, il te resterait 2 900 € par mois ; tes dépenses courantes hors logement sont de 2 400 € ». Aucun seuil inventé : les banques ont chacune le leur.
- **Sensibilité** : tableau taux du jour −1 pt / taux du jour / +1 pt × 20 et 25 ans (montant empruntable et budget d'achat).
- **Sortie** : `{ revenus_retenus: { total, detail }, charges, mensualite_max, taux: { valeur, source, date }, duree_ans, montant_empruntable, apport: { total, detail, impots }, frais, budget_achat, reste_a_vivre, depenses_hors_logement, sensibilite: [[...]], taeg_estime, usure, avertissements, sources }`.
- PTZ : la logique PTZ de `toise.js` est déplacée telle quelle dans le moteur (même code). Son barème a été **revérifié** en tâche 0 (plafonds de ressources et d'opération, coefficients familiaux, tranches, quotités, durées de différé et de remboursement : identiques à service-public F10871, vérifié le 15/09/2026, et au CCH art. D31-10-11). IMMO1 ne l'affiche pas pour autant en V1 : il faut la zone du logement et le revenu fiscal de référence de l'année N−2, que Boussole n'a pas ; Rang continue de l'afficher.

### 8.2 Demain : `Projection.capaciteDansLeTemps(modele, resultat, opts)`
- Pour chaque mois du modèle : `R(t)` (trajectoire des revenus, hausses), `Ch(t)` (crédits en cours qui finissent, nouveaux crédits d'un achat prévu), dépenses (enfants : elles ne changent pas le taux d'effort mais baissent le reste à vivre), **apport mobilisable** par chemin → centiles P10/P50/P90 de l'apport, donc du budget d'achat.
- Taux : taux du jour, et deux lignes fines à ±1 point pour la médiane (pas de modèle des taux en V1, c'est écrit).
- Après un `achat_immobilier` prévu, la capacité baisse (nouvelle mensualité) : la courbe le montre, avec le jalon.
- **Graphique** : le composant SIM2 en mode `capacite` : éventail du budget d'achat (P10–P90, P25–P75 si utile), médiane, ligne du montant empruntable (déterministe en revenus), jalons (« Fin du prêt auto », « Hausse de salaire », « Enfant 2 »). **Phrase de titre** : « En 2028, budget d'achat médian 310 000 € avec 55 000 € d'apport (9 chances sur 10 d'avoir au moins 40 000 €). »
- Euros constants par défaut, comme le reste.

### 8.3 Une seule logique
- `annuity`, `loanPlan`, `ptzInfo`, `taeg`, `amortization` de `toise.js` passent dans `projection.js` (sous les noms `annuite`, `planPret`, `ptz`, `taeg`, `amortissement`) ; `toise.js` appelle le moteur. Les constantes `LOAN` deviennent des repères (taux, frais d'acquisition, garantie, frais de dossier, pondération des loyers) ; `LOAN.ins` (assurance par âge) reste une convention de Rang, citée comme telle.
- `test/port.test.mjs` lie le bloc moteur de `toise.js` à `sources/toise.html` : ce bloc est réduit (les fonctions de crédit en sortent, la référence devient `projection.js`), avec un commentaire qui le justifie (décision 1).
- Outil MCP `capacite_emprunt` (lecture, § 15) : aujourd'hui, et avec `dans_le_temps: true` la capacité année par année (point précis à `date`, trajectoire d'apport `scenario`).

## 9. Performance

- **Budget** : 2 000 chemins × 300 mois en moins de **150 ms** sur un ordinateur portable courant, dans le *worker*.
- **Structure** : boucle **mois à l'extérieur, chemins à l'intérieur**. État dans des `Float64Array` : valeurs `P × B` (B compartiments, typiquement 5 à 30), bases `P × B`, disponible et crédits par chemin ; états du générateur dans un `Uint32Array(4 × P)`. Aucun objet alloué dans la boucle.
- **Tirages** : 12 normales par chemin et par mois (liste fixe), 6 appels Box-Muller ; Cholesky 12 × 12 précalculé (78 multiplications). Les classes absentes sont tirées mais ni multipliées ni appliquées (seul le générateur avance), ce qui garde les nombres aléatoires communs.
- **Couche existant** (§ 6.7) : un second jeu de valeurs `P × B` sans flux, mis à jour avec les mêmes rendements (une multiplication de plus par compartiment) ; ses centiles ne sont triés qu'aux mois affichés (années), pas à chaque mois.
- **Centiles** : chaque mois, une copie des totaux de la **vue affichée** dans un `Float64Array(P)` réutilisé, triée (`TypedArray.prototype.sort`, numérique) ; les autres vues seulement à la demande. Les probabilités d'objectif sont comptées au mois de leur date, sans stocker les chemins.
- **Worker** : `projection-worker.js` charge les modules purs par `importScripts` ; l'écran envoie `{ data, options }`, affiche d'abord un calcul à **500 chemins** (même graine : ce sont les 500 premiers chemins des 2 000), puis le résultat complet. Résultats mis en cache par empreinte de l'entrée (données + options + `versionModele`). Sans `Worker` (tests, vieux navigateurs), même code sur le fil principal.
- **Mesure** : `scripts/bench-projection.mjs` (Node) affiche le temps de 2 000 × 300 ; un test vérifie un plafond large (600 ms) pour ne pas être instable en intégration continue, et le compte rendu de la tâche donne la mesure réelle.

## 10. SIM2 : le graphique maître

« C'est le master graph, il faut qu'il soit parfait » (décision 18). Passé et futur forment **un seul outil**. La grammaire visuelle est celle de l'audit UX mobile (`~/Finance/docs/boussole-ux-mobile.md`, § 2.5 et § 2.8, constats P2 et P10) et de la maquette (`~/Finance/docs/boussole-maquette-mobile.html`), avec deux changements voulus par Stéph : l'axe du temps est **proportionnel** des deux côtés (la maquette et HIS1 comprimaient le passé), et la lecture se fait par **toucher-glisser** (pas d'appui long).

### 10.1 Composant `GraphePatrimoine`
- **On part du composant de HIS1** : `web/src/graphe-patrimoine.js` (`GraphePatrimoine.construire(f, fut, opt)`, `legendeHtml`, `tableauHtml`, `calculHtml`, `infobulle`). SIM2 **le généralise** au lieu d'en créer un second : `fut` reçoit la sortie du moteur (centiles, existant, jalons, objectifs, variante, crise, capacité par période), et un contrôleur DOM (`monter(el, { donnees, reglages, preset })`, `mettreAJour`, `pleinEcran`) le rend réutilisable. Fonctions pures testables sous Node (géométrie, graduations, textes, état) ; conventions gardées (échappement, tutoiement, styles scopés).
- **Un seul axe du temps, proportionnel** : une échelle linéaire unique des dates, de `debut` à `fin` de la fenêtre ; un mois passé et un mois futur ont la même largeur. La compression du passé de HIS1 (passé dans 30 à 60 % de la largeur) est **supprimée**. « Aujourd'hui » tombe où la fenêtre le place (au milieu pour une fenêtre symétrique pleine).
- **Une seule commande de temps** : une rangée de segments `1 an · 5 ans · 10 ans · 20 ans · Tout` ; « N ans » veut dire **N ans avant et N ans après aujourd'hui**, le passé étant borné par l'historique disponible (la place libérée va au futur, l'axe restant proportionnel) ; « Tout » = tout l'historique et l'horizon maximal (25 ans). Une période libre (dates de début et de fin) est dans le panneau « Réglages ». **Granularité automatique** selon l'étendue (jour jusqu'à 3 mois, semaine jusqu'à 1 an, mois jusqu'à 10 ans, trimestre jusqu'à 20 ans, année au-delà ; règle de la mémoire « filtres de dates ») : aucun bouton de granularité. **Défaut : 5 ans sur mobile**, 10 ans sur desktop (préréglages du § 10.5).
- **Un seul axe des y**, à droite (lecture au pouce gauche), au plus 4 graduations **rondes** (pas de 1, 2 ou 5 × 10ⁿ), toutes au même format (« 150 k€ », « 1,2 M€ » ; espace fine insécable, signe « − » typographique), le zéro affiché si des valeurs négatives existent.
- **Mêmes séries des deux côtés** (couleurs du § 2.5 de l'audit, clair et sombre) :
  - passé **observé** : encre pleine, 2 px ; passé **reconstitué** : gris atténué en pointillé 4-3, 1,5 px, fond hachuré à 6 %, légende « estimé avant le 31 juil. » ;
  - futur : **médiane** (couleur de la marque, trait plein 2 px), bandes **P25–P75** (marque à 22 %) et **P10–P90** (marque à 10 %, bord pointillé) ;
  - couche **« Ton patrimoine actuel, sans nouveau versement »** (§ 6.7) : médiane en trait fin pointillé de la couleur de la marque, sans bande sur mobile (bande P25–P75 en plein écran) ; l'écart avec la médiane complète est légendé à l'horizon (« +160 000 € : tes versements (120 000 €) et leur croissance ») ;
  - **variante** : seconde couleur (médiane + P25–P75) et l'écart à l'horizon écrit (« +38 000 € en médiane à 10 ans, variante meilleure dans 7 chemins sur 10 ») ;
  - **crise** : ligne pointillée longue, sa légende (« crise de 2008 rejouée en octobre 2027 ») ;
  - **continuité à « Aujourd'hui »** : toutes les séries futures partent exactement de la dernière valeur observée (même point, même pixel) ; le marqueur vertical « Aujourd'hui » porte une pastille.
- **Couloir des jalons** sous l'axe (voie de 32 px, icônes de 20 px dans une zone tactile de 44 px) : objectifs (drapeau), fins de crédit (clé), vie (personne : naissance, emploi, congé, crèche), DAT1 ; une même date regroupe ses jalons (« +2 »). Toucher une icône ouvre la **feuille de détail de l'événement** (effet en euros, § 7.4 ; source ; « Modifier avec Claude »).
- **Objectifs** : un losange à la date et au montant, couleur **et mot** (« probable » ≥ 80 %, « incertain » 50 à 80 %, « peu probable » < 50 %), « 8 chances sur 10 ».
- **Bande « capacité d'épargne »** sous le couloir des jalons (décision 17) : un petit graphique en escalier de la capacité mensuelle, sur le même axe du temps : à gauche « constatée aujourd'hui » (valeur et période), puis la capacité future mois par mois (`capacite_par_periode`), chaque marche reliée à son jalon et sa raison (« Enfant 1 : −1 020 €/mois »), le zéro marqué ; une capacité négative est sous la ligne, en couleur d'alerte **et** avec le mot « négative ».

### 10.2 Lecture, en-tête et réglages
- **Phrase de titre** au-dessus du graphique, qui suit la fenêtre et le curseur : « Aujourd'hui : 120 k€ · dans 10 ans : médiane 400 k€ (300 à 540 k€), en euros d'aujourd'hui. » ; à deux chiffres significatifs ; « provisoire » sous 60 % de couverture ; « en euros de 2036 » en euros courants. Dessous, la **ligne de décomposition** (§ 6.8) : « dont 190 k€ de ton patrimoine actuel et 210 k€ de ton épargne future, après 20 k€ de frais ». Puis l'en-tête des événements (§ 7.3, règle 7) et les garde-fous déclenchés (§ 6.8), en une ligne chacun.
- **Curseur de lecture** : sur mobile, **toucher et glisser** n'importe où sur la zone du graphique déplace une ligne verticale (le défilement vertical de la page reste possible : le geste horizontal capte, le vertical laisse défiler) ; sur desktop, le survol fait la même chose ; au clavier, le graphique est focalisable et **← / →** déplacent le curseur d'un pas de granularité (**Origine / Fin** : extrémités, **Aujourd'hui** sur `T`). Le **panneau de lecture est fixe sous le graphique** (jamais une bulle seule au survol) : date, valeur, nature (« observé », « reconstitué », « projeté : médiane 412 k€, 8 chances sur 10 entre 300 et 560 k€ »), existant seul et épargne future à cette date, capacité du mois, événements de cette date. Son contenu est annoncé (`aria-live="polite"`, limité à un message par pas).
- **Commandes visibles : 5 au plus au-dessus du graphique**, en comptant le contrôle segmenté des fenêtres pour une (il a 5 segments) : fenêtres, « Réglages », « Plein écran » (icônes de 44 px dans l'en-tête de la carte, libellés accessibles). Rien d'autre (ni granularité, ni horizon séparé, ni vue). Le **périmètre** vient de la puce globale de l'en-tête (§ 3.0 de l'audit), jamais du graphique.
- **Feuille « Réglages »** (`UI.panneau`, feuille par le bas sur mobile, panneau de 480 px sur desktop) : vue (patrimoine net, financier, disponible), euros d'aujourd'hui ↔ courants, net d'impôts, variante (si elle existe), crise (oui/non, laquelle, quand), « afficher l'existant seul », période libre, « Plein écran ». Réglages **locaux, jamais enregistrés** (règle 1).
- **« Comment c'est calculé »** (`UI.panneau`) : méthode en 5 phrases ; hypothèses (classe, rendement central et historique, volatilité, sources et dates, avec « sous la moyenne historique » quand c'est le cas ; inflation ; salaires ; frais ; règles fiscales et leur confiance) ; base de la capacité (constatée, prévue, programmée) ; données utilisées et ce qui manque (« Compléter avec Claude ») ; rétro-contrôle (§ 6.9) ; limites ; graine, chemins, version du modèle ; **tableau de données** équivalent (une ligne par pas : date, nature, P10, P25, médiane, P75, P90, existant, variante, écart ; puis les jalons avec leur effet).
- **Accessibilité** : `role="img"` et `aria-label` qui reprend la phrase de titre ; curseur et jalons atteignables au clavier ; Échap ferme feuilles et bulles ; état jamais porté par la seule couleur ; contrastes AA en clair et en sombre (variables de `theme.css`) ; cibles de 44 px.

### 10.3 États et performance
- **Chargement** : squelette à la taille finale (cadre 16:10 sur mobile ≈ 220 px de haut), jamais un chiffre provisoire. **Monte-Carlo progressif** : premier rendu à 500 chemins, puis 2 000 ; l'échelle des y est calculée une fois sur le résultat à 500 chemins élargi de 10 % et n'est recalculée que si le résultat complet en sort (**le graphique ne saute pas**) ; la transition est un fondu de 120 ms.
- **États vides et partiels** : aucun historique (le passé est un point « Aujourd'hui ») ; historique reconstitué seulement ; aucune capacité connue (« la projection suppose 0 €/mois ») ; couverture faible (« provisoire ») ; moteur en échec (message et « Réessayer », pas de graphique vide).
- **Mouvement** : transition de 200 ms entre deux fenêtres (interpolation), pas de « dessin » de courbe ; `prefers-reduced-motion` : durées à 0 sauf le fondu. **Mode sombre** complet.

### 10.4 Plein écran
- Bouton « Plein écran » dans l'en-tête de la carte et dans « Réglages ». **Fullscreen API** quand elle est disponible (`element.requestFullscreen`), sinon une **couche fixe plein écran** (`role="dialog"`, `aria-modal="true"`, titre, focus piégé, bouton « Fermer » de 44 px, Échap) ; à la sortie, le focus revient au bouton d'origine. Sur mobile en portrait, une invitation discrète « tourne ton téléphone pour plus de détail » (jamais de rotation forcée).
- **Plus de détail** : toutes les séries et toutes les légendes visibles (dont la bande P25–P75 de l'existant), granularité automatique plus fine (un cran de plus), libellés des jalons en entier, **panneau de lecture ancré sur le côté** en paysage et sur desktop, **zoom de l'axe du temps** (pincer sur écran tactile, glisser-sélectionner sur desktop, molette avec Ctrl) avec « Réinitialiser », **tableau de données dans un onglet latéral**.
- **Même état** à l'entrée et à la sortie : fenêtre, réglages, position du curseur, variante, crise.
- **Lien profond** `#<route>?graphe=plein-ecran` (par exemple `#aujourdhui?graphe=plein-ecran`) : ouvre la page puis le plein écran ; la fermeture retire le paramètre (`history.replaceState`).

### 10.5 Préréglages par écran (même composant partout)

| Écran | Vue | Fenêtre par défaut (mobile / desktop) | Couches | Objectifs | Commandes visibles |
|---|---|---|---|---|---|
| Aujourd'hui (courbe maîtresse, HIS1) | net, périmètre de l'en-tête | 5 ans / 10 ans | complet + existant | tous | fenêtres, Réglages, Plein écran |
| Patrimoine › Placements | financier | 5 ans / 10 ans | complet + existant | aucun | idem |
| Patrimoine › Objectifs | financier (accordéon) ; poches de l'objectif dans son panneau | jusqu'à la date de l'objectif (au moins 5 ans) | complet | l'objectif concerné | idem |
| Patrimoine › Immobilier et crédits (IMMO1) | `capacite` (§ 8.2 : budget d'achat P10–P90, montant empruntable) | 10 ans de futur, pas de passé | — | objectif « apport » s'il existe | fenêtres, durée 20/25 ans (dans Réglages), Plein écran |

### 10.6 Données passées
Le passé vient de `Historique.fusionner(...)` (HIS1). PROJ ne touche pas à la reconstitution ; il remplace `Historique.projeter` par un appel au moteur (§ 13.1) et l'échelle du temps de HIS1 par l'axe unique (§ 10.1), **après la fusion de HIS1**. En euros constants, le passé est converti avec l'indice des prix (`indices_mensuels`, série IPC de l'Insee 011814630, § 11.4) : valeur × IPC(aujourd'hui) / IPC(mois), le dernier indice publié servant pour les mois récents.

### 10.7 Probabilité d'un objectif
Valeur de référence : les poches rattachées (`objectifs.poches`, `objectifs.enveloppes`) ou, pour un objectif « saisi », la vue `disponible` du titulaire. Cible en **euros d'aujourd'hui** (changement de sens annoncé, § 13.3). Probabilité = part des chemins où la valeur de référence, en euros constants, atteint la cible à la date. Un objectif « matelas » utilise la vue `disponible`.

### 10.8 Tests d'acceptation de l'interface
Fonctions pures sous Node et DOM simulé (comme `test/aujourdhui.test.mjs`) ; captures en clair et en sombre à 1 280 et 400 px dans le compte rendu.
1. **Nombre de commandes** : au-dessus du graphique, exactement un contrôle segmenté de 5 fenêtres (`1 an · 5 ans · 10 ans · 20 ans · Tout`), « Réglages » et « Plein écran », soit 3 commandes (5 au plus) ; aucun bouton de granularité ; aucun sélecteur de périmètre dans le composant.
2. **Axe proportionnel** : pour toute fenêtre, `x(date)` est affine en jours ; la largeur d'un an passé égale celle d'un an futur (à 1 px près) ; « 5 ans » couvre 5 ans de chaque côté (ou l'historique disponible).
3. **Continuité à « Aujourd'hui »** : le premier point de la médiane, des bandes, de l'existant et de la variante est égal à la dernière valeur observée (même x, même y).
4. **Graduations** : au plus 4, rondes, même format ; zéro présent si une valeur est négative.
5. **Curseur et panneau de lecture** : un glisser (événements de pointeur simulés) place le curseur sur le pas le plus proche ; le panneau dit date, valeur et nature (observé, reconstitué, projeté avec P10–P90) et les événements de la date ; ← / → déplacent d'un pas, Origine / Fin aux bornes ; aucune information disponible seulement au survol.
6. **Jalons** : vrais boutons ; Entrée ou toucher ouvre la feuille de l'événement ; regroupement « +2 » ; Échap ferme et rend le focus.
7. **Couches** : existant ≤ complet en médiane quand la capacité est positive ; libellés « Ton patrimoine actuel, sans nouveau versement » et « + ton épargne future » ; la bande « capacité d'épargne » a une marche par période de `capacite_par_periode`, avec sa raison.
8. **En-tête** : phrase de titre, décomposition, « Événements pris en compte : … » ou « Aucun événement renseigné — as-tu des changements prévus ? », garde-fous.
9. **Progressif** : passer de 500 à 2 000 chemins ne change pas l'échelle des y tant que le résultat reste dans la marge.
10. **Plein écran** : ouverture et fermeture (Fullscreen API simulée, et sa variante en couche) ; `role="dialog"` et `aria-modal` pour la couche ; focus piégé ; Échap ferme ; focus rendu au bouton ; fenêtre, réglages et curseur conservés ; lien `?graphe=plein-ecran` ouvre et la fermeture le retire.
11. **Accessibilité et préférences** : `role="img"` et `aria-label` égal à la phrase de titre ; contrastes AA (`test/helpers/contraste.mjs`) en clair et en sombre ; `prefers-reduced-motion` coupe les transitions ; tableau de données équivalent ; mobile 400 px sans débordement.
12. **Lecture seule** : aucun réglage enregistré (`test/lecture-seule.test.mjs`).

## 11. Hypothèses et sources

Consultées le **2026-10-14** sauf mention (tâche 0). Statut : **V** vérifié sur la page officielle ou la source primaire ; **V-DAT1** vérifié dans la spec DAT1 ; **CR** changé récemment ; **NV** non vérifié (la règle est marquée et n'est pas appliquée sans mention) ; **CONV** convention ou hypothèse de Boussole, dite comme telle. Les lignes du § 11.4 sont recopiées à l'identique dans `test/fixtures/projection-cas.json` (`reperes`) : c'est la fixture qui fait foi pour la migration 0030 (tâche 2).

### 11.1 Hypothèses économiques et familiales

| Hypothèse | Valeur | Source | Statut |
|---|---|---|---|
| Inflation (`inflation_hypothese`) | 2 % par an | BCE, stratégie de politique monétaire (objectif de 2 % à moyen terme, IPCH) — https://www.ecb.europa.eu/mopo/strategy/pricestab/html/index.fr.html | V |
| Hausse réelle des salaires (`salaire_croissance_reelle`) | 0,5 % par an | Insee Première n° 2079 (23/10/2025) ; 0,5 % = moyenne 1996-2024 calculée par Boussole — https://www.insee.fr/fr/statistiques/8657156 | V (calcul Boussole) |
| Unités de consommation | 1 / 0,5 (14 ans ou plus) / 0,3 (moins de 14 ans) | Insee, définition c1802 (16/12/2022) — https://www.insee.fr/fr/metadonnees/definition/c1802 | V |
| Coût d'un enfant | 0,3 ou 0,5 UC × dépenses par UC du foyer | Méthode des échelles d'équivalence (Drees, Dossiers n° 62, 2020) ; contrôle : HCFEA, « Le coût de l'enfant » | V (définition) ; méthode = CONV documentée |
| Crèche (PSU) : taux d'effort horaire, accueil collectif et micro-crèche | 0,0619 % (1 enfant), 0,0516 % (2), 0,0413 % (3), 0,0310 % (4 à 7), 0,0206 % (8 et plus) ; ressources plancher 814,62 €, plafond 8 500 € au 01/01/2026 | Cnaf, barème national, Guide PSU 2026 (p. 5-6) — https://caf.fr/sites/default/files/medias/493/Partenaires/Petite-enfance/EAJE/Guide_PSU_2026_02_V_Def.pdf | **V** (levé en tâche 0) |
| Heures de crèche par mois | 200 | 10 h × 20 jours | CONV |
| Assistante maternelle : aide de la Caf (CMG emploi direct) | non calculée | Service-public F39152 (vérifié le 26/06/2026) : réforme du 01/09/2025, calcul selon ressources, enfants, coût horaire plafonné et heures ; formule renvoyée au simulateur | **NV** → montant fourni par l'utilisateur (`cmg_mensuel`) ou coût brut avec mention |
| PreParE (congé parental) | 459,70 € (arrêt), 297,17 € (≤ 50 %), 171,42 € (50 à 80 %) ; 1er enfant, couple : 6 mois par parent avant 1 an | Service-public F32485 (vérifié le 01/06/2026 ; revalorisation du 01/04/2026) | V (montants, 1er enfant) ; durée à partir du 2ᵉ enfant : NV (6 mois comptés) |
| Quotient familial | +0,5 part par enfant (deux premiers) ; avantage plafonné à 1 807 € par demi-part | Service-public F2705 (vérifié le 15/04/2026) | V, **non modélisé** en V1 (mention dans le jalon) |
| Instruction obligatoire | dès 3 ans | Code de l'éducation, art. L131-1 (version du 02/09/2019) — https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038901859 | **V** (date de rentrée du 1er septembre : CONV) |
| Revalorisation réelle des logements (`immo_revalorisation_reelle`) | 0 % (prix = inflation) | Convention prudente ; contrôle : l'indice Insee des logements anciens a crû de 3,9 % par an en nominal de 1996 à 2025 (≈ 2,3 % réel) | CONV |
| Volatilité des logements (`immo_volatilite`) | 5,3 % | Calcul Boussole sur l'Insee, série 010567058 (logements anciens, France métropolitaine, brute, base 2015) : moyenne annuelle des 4 trimestres, écart type (n − 1) des log-variations annuelles 1997-2025 (29 valeurs) = 5,33 % (5,57 % sans logarithme). Limite : la moyenne annuelle lisse les variations | V (calcul Boussole) |

### 11.2 Fiscalité (option « net d'impôts »)

| Règle | Valeur | Source | Statut |
|---|---|---|---|
| Prélèvements sociaux, cas général (PEA, compte-titres, PER, gains) | 18,6 % depuis le 01/01/2026 | Service-public F2329 (vérifié le 30/06/2026) ; CSS art. L136-8, I 2° (CSG à 10,6 %, version du 27/06/2026) | V-DAT1, CR |
| PS : assurance-vie, PEL, CEL, revenus fonciers, plus-values immobilières | 17,2 % | F2329 ; CSS art. L136-8, IV (liste restée à 9,2 % de CSG : L136-6 I a, L136-7 I 2°, II 1°, 2°, 2° bis, 3°, 4°) | V |
| PS : plus-values d'actifs numériques (`ps_taux_actifs_numeriques`) | 18,6 % | CSS art. L136-8 (version du 27/06/2026) : ces gains (L136-6, I e) ne sont pas dans la liste du IV ; la LFSS 2026 (art. 12) applique le taux aux revenus du patrimoine de 2025. Le BOFiP BOI-RPPM-PVBMC-30-30 (23/04/2024) dit encore 17,2 % | **V** (levé en tâche 0) |
| PS : épargne salariale, gains (`ps_taux_epargne_salariale`) | 18,6 % | CSS art. L136-8, IV et L136-7, II (participation, épargne salariale : absentes de la liste à 9,2 %) | **V** (levé en tâche 0) |
| Impôt forfaitaire (`ir_taux_forfaitaire`) | 12,8 % | Service-public F22414 (vérifié le 15/04/2026), F22449 | V (repère à **créer** en 0030 : seul `pfu_taux` = 31,4 % existe) |
| Assurance-vie après 8 ans | abattement 4 600 / 9 200 € ; 7,5 % (`av_taux_ir_reduit`, repère à créer) sur la fraction `150 000 / primes`, 12,8 % au-delà ; abattement imputé d'abord sur la fraction à 7,5 % ; seuil personnel, tous contrats, primes depuis le 27/09/2017 | F22414 ; BOFiP BOI-RPPM-RCM-20-15 § 160, 170, 190 (21/06/2021) ; BOI-RPPM-RCM-20-10-20-50 § 285-288 (30/06/2022) | **V** (levé en tâche 0 ; corrige le cas F-5) |
| PEA : 5 ans, gains exonérés d'IR ensuite, PS dus ; retrait avant 5 ans = clôture | — | F22449 | V-DAT1 |
| PER : sortie en capital (versements déduits au barème, gains au PFU de 31,4 %) ; déblocage pour la résidence principale | — | Service-public F34982 (vérifié le 12/10/2026) | V |
| Plus-value immobilière : 19 %, 17,2 % ; abattements IR 6 %/an (6ᵉ à 21ᵉ), 4 % (22ᵉ) ; PS 1,65 %/an (6ᵉ à 21ᵉ), 1,60 % (22ᵉ), 9 %/an (23ᵉ à 30ᵉ) ; surtaxe au-delà de 50 000 € ; résidence principale exonérée | — | Service-public F10864 (vérifié le 15/04/2026) | V |
| Parts de SCPI en direct : régime des plus-values immobilières | — | CGI art. 150 UB, I (version du 01/01/2017 : droits sociaux de sociétés à prépondérance immobilière « qui relèvent des articles 8 à 8 ter ») ; CGI art. 239 septies (version du 23/10/2019 : les SCPI ne sont pas soumises à l'IS, chaque associé est imposé personnellement) ; BOFiP BOI-RFPI-SPI-10-10 § 10. Aucune page officielle lue ne nomme les SCPI | **NV** (lecture combinée des textes) → appliqué avec `confiance: "probable"` et la mention « à confirmer » |
| Crypto : 12,8 % d'IR, option pour le barème | — | BOFiP BOI-RPPM-PVBMC-30-30 ; notice 2086 | V |
| Barème de l'IR (revenus 2025) : 0 % jusqu'à 11 600 €, 11 % jusqu'à 29 579 €, 30 % jusqu'à 84 577 €, 41 % jusqu'à 181 917 €, 45 % au-delà | — | Service-public F1419 (vérifié le 15/04/2026) | **V** (levé en tâche 0) |
| Dates PEA 5 ans, assurance-vie 8 ans, PEE, PEL | — | Calendrier DAT1 | V-DAT1 |

### 11.3 Rendements centraux, volatilités et corrélations (décision 13)

Volatilités et corrélations : `web/src/marche.js` (SP2, historiques, inchangées). Rendement **central** = repère `rendement_central_<classe>` (CONV sourcée) = `min(historique de marche.js, moyenne des estimations prospectives en euros lues)`, arrondi au demi-point inférieur, révisé une fois par an (`date_fin` 2027-10-31) ou à chaque nouvelle édition. Estimations lues le 2026-10-14 (rendements géométriques annualisés à 10 ans, nominaux) :
- **Vanguard**, Vanguard Capital Markets Model, investisseur de la zone euro, simulations au 31/03/2026 (page du 23/07/2026) : actions de la zone euro 3,7 à 5,7 % ; actions mondiales hors zone euro, non couvertes, 4,4 à 6,4 % ; obligations agrégées de la zone euro 3,0 à 4,0 % — https://www.vanguardsouthamerica.com/en/home/insights/economic-market-outlook/vanguard-capital-markets-model-forecasts-2026 (le site européen de Vanguard n'a pas été lu ; la devise de base n'est pas explicite sur la page : à confirmer à la prochaine révision).
- **Amundi**, Capital Market Assumptions, mise à jour d'août 2026 (départ au 30/06/2026), monnaie locale, géométrique 10 ans : actions monde 7,0 %, zone euro 6,7 %, émergents 6,7 %, obligations agrégées euro 3,5 %, liquidités euro 1,9 %, or 5,5 %, immobilier mondial 5,3 % — https://research-center.amundi.com/files/nuxeo/dl/6df1bf9d-44de-412e-aa5c-4578e393e8b0
- **J.P. Morgan**, Long-Term Capital Market Assumptions 2026 (données au 30/09/2025), **en dollars** (la matrice en euros n'a pas été trouvée) : actions monde (AC World) 7,0 %, émergents 7,8 %, petites capitalisations américaines 6,9 %, or 5,5 % — https://am.jpmorgan.com/content/dam/jpm-am-aem/global/en/insights/ltcma-2026-us-matrix_usd.pdf. Cité pour contexte, pas dans la moyenne (devise).
- BlackRock et Natixis : non lus (pages non trouvées en accès libre) ; à ajouter à la révision annuelle.
- Ces maisons sont citées **comme sources d'hypothèses** dans « Comment c'est calculé », jamais comme produits ni comme exemples à suivre (règle 9 ; liste des interdits de l'expertise).

| Classe | Historique (marche.js) | Vanguard (centre de la fourchette) | Amundi | **Central retenu** | Volatilité | Source historique (marche.js) |
|---|---|---|---|---|---|---|
| Actions (monde développé) | 7 % | 5,4 % (hors zone euro) | 7,0 % | **6,0 %** (sous l'historique) | 15 % | MSCI World NR EUR 1970-2025 ; Jordà et al., QJE 2019 |
| Petites capitalisations | 7,5 % | — | — | **6,0 %** (= actions, sans prime de taille : aucune estimation lue) | 20 % | MSCI World Small Cap NR 2001-2025 |
| Émergents | 6,5 % | — | 6,7 % | **6,5 %** | 20 % | MSCI EM NR 1988-2025 |
| Levier ×2 | calculé (§ 4.4.3) | — | — | sous-jacent, formule du levier | 2 × σ du sous-jacent | — |
| Nasdaq-100 (sous-jacent) | — | — | — | **6,0 %** (= actions, convention) | 22,9 % (`nasdaq100_volatilite`) | Nasdaq, 2008-2026 |
| Obligations zone euro | 3,5 % | 3,5 % | 3,5 % | **3,5 %** | 5 % | Bloomberg Euro Aggregate 1999-2025 |
| Immobilier (SCPI, pierre-papier) | 4,5 % | — | 5,3 % (mondial) | **4,5 %** | 6 % (lissée) | IEIF, ASPIM |
| Monétaire | 1,5 % | — | 1,9 % | **1,5 %** (livrets : taux réglementé) | 0,5 % (0 pour les livrets) | Banque de France ; €STR |
| Fonds euros | 2,5 % | — | — | **2,5 %** (historique, aucune estimation) | 0 | ACPR / France Assureurs 2015-2024 |
| Or | 4 % | — | 5,5 % | **4,0 %** | 15 % | LBMA |
| Crypto | 10 % | — | — | **10 %** (hypothèse de marche.js, aucune estimation prospective : dite comme telle, garde-fou de croissance § 6.8) | 70 % | CoinMarketCap |
| Autres | 4 % | — | — | **4,0 %** | 12 % | Hypothèse Boussole |

Dates de vérification de `marche.js` : la tâche 0 ne modifie pas `web/src` (un autre agent y travaille) ; l'ajout de `periode` (déjà dans chaque `source`) et de `verifie_le: null` (« non revérifié en tâche 0 ») passe à la **tâche 2**, valeurs inchangées.

### 11.4 Repères à ajouter (migration 0030, tâche 2)

Liste complète, avec libellés, dates d'effet et de fin, titres et URL : `test/fixtures/projection-cas.json`, clé `reperes` (68 lignes, toutes V ou CONV ; aucune ligne NV). Résumé :

| Clé | Valeur | Date d'effet → fin | Source | Statut |
|---|---|---|---|---|
| `inflation_hypothese`, `salaire_croissance_reelle` | 2 % ; 0,5 % | — | BCE ; Insee Première 2079 | V |
| `uc_adulte_supplementaire`, `uc_enfant_moins_14`, `uc_age_seuil` | 0,5 ; 0,3 ; 14 ans | 2022-12-16 | Insee c1802 | V |
| `enfant_fin_charge_age` | 20 ans | — | convention (HCFEA) | CONV |
| `creche_psu_taux_1_enfant`, `_2_enfants`, `_3_enfants`, `_4_7_enfants`, `_8_enfants` | 0,0619 ; 0,0516 ; 0,0413 ; 0,0310 ; 0,0206 % | 2026-01-01 | Cnaf, Guide PSU 2026 | V |
| `creche_psu_plancher`, `creche_psu_plafond` | 814,62 € ; 8 500 € | 2026-01-01 → 2026-12-31 | Cnaf, Guide PSU 2026 | V |
| `creche_heures_mois` | 200 h | — | convention | CONV |
| `ecole_obligatoire_age` | 3 ans | 2019-09-02 | Légifrance, Code de l'éducation L131-1 | V |
| `prepare_taux_plein`, `prepare_mi_temps`, `prepare_temps_partiel`, `prepare_duree_premier_enfant_mois` | 459,70 € ; 297,17 € ; 171,42 € ; 6 mois | 2026-04-01 → 2027-03-31 | service-public F32485 | V |
| `qf_plafond_demi_part` | 1 807 € | 2026 | service-public F2705 | V |
| `ir_taux_forfaitaire`, `av_taux_ir_reduit` | 12,8 % ; 7,5 % | 2018-01-01 ; 2017-09-27 | service-public F22414 | V |
| `ps_taux_actifs_numeriques`, `ps_taux_epargne_salariale` | 18,6 % ; 18,6 % | 2025-01-01 ; 2026-01-01 | Légifrance, CSS L136-8 | V |
| `pv_immo_ir_taux`, `pv_immo_ps_taux`, `pv_immo_surtaxe_seuil`, `ps_taux_foncier` | 19 % ; 17,2 % ; 50 000 € ; 17,2 % | — | F10864, F2329 | V |
| `ir_bareme_11_seuil`, `_30_seuil`, `_41_seuil`, `_45_seuil` | 11 600 ; 29 579 ; 84 577 ; 181 917 € | 2026-01-01 → 2026-12-31 | service-public F1419 | V |
| `taux_credit_immo_15`, `_20`, `_25` | 3,14 % ; 3,27 % ; 3,35 % (août 2026) | 2026-08-01 → 2026-10-31 | Observatoire Crédit Logement/CSA, analyse d'août 2026 (lue sur la page de l'Observatoire) | V (était CR) |
| `taux_usure_moins_10`, `_10_20`, `_20_plus` | 4,09 % ; 4,68 % ; 5,40 % | 2026-10-01 → 2026-12-31 | Banque de France, taux d'usure 2026-T4 | V |
| `hcsf_duree_max_differe`, `hcsf_travaux_seuil_pct` | 27 ans ; 10 % | 2022-01-01 ; 2024-01-01 | Légifrance, décisions du HCSF du 29/09/2021 et du 18/12/2023 | V |
| `revenus_locatifs_ponderation` | 70 % | — | usage bancaire (Rang) | CONV |
| `frais_acquisition_ancien_pct`, `_primo_pct`, `_neuf_pct` ; `garantie_pct`, `frais_dossier` ; `assurance_emprunteur_defaut_pct` | 8 ; 7,5 ; 2,5 % ; 1 % ; 1 000 € ; 0,30 % | — | conventions de Rang ; DMTO : service-public A18183 | CONV |
| `immo_revalorisation_reelle`, `immo_volatilite` | 0 % ; 5,3 % | — | convention ; calcul Boussole sur Insee 010567058 | CONV ; V |
| `estr_taux` | 2,439 % (13/10/2026) | 2026-10-13 → 2026-11-30 | BCE, €STR | V |
| `nasdaq100_volatilite` | 22,9 % | 2007-12-31 → 2026-06-30 (période de calcul) | Nasdaq Global Indexes (données au 30/06/2026) | V (source de l'indice) |
| `scpi_taux_distribution` | 4,91 % (2025) | 2025-12-31 → 2026-12-31 | ASPIM, « SCPI en chiffres » | V |
| `inflation_fr_1973`, `inflation_fr_1974` | 7,3 % ; 13,7 % | — | Insee, série 000000282 (indice des 295 postes, base 1970 : 112,0 → 120,2 → 136,7) | V |
| `rendement_central_<classe>` (10 lignes) | § 11.3 | 2026-10-14 → 2027-10-31 | convention sourcée (Vanguard, Amundi, marche.js) | CONV |
| `garde_fou_croissance_annuelle`, `garde_fou_ecart_capacite`, `garde_fou_rendement_marge`, `retro_min_origines` | 8 % ; 30 % ; 0,5 point ; 24 dates | — | convention | CONV |
| Série IPC mensuelle (`indices_mensuels`, `ipc_insee`) | 60 mois, octobre 2021 à septembre 2026 (septembre provisoire) | — | Insee, série **011814630** (IPC base 2025, ensemble des ménages, France), mise à jour du 30/09/2026 ; valeurs dans la fixture (`indices_mensuels`) | V |

Notes pour la tâche 2 : (1) le test des domaines doit accepter, en plus des domaines publics (`*.gouv.fr`, `ecb.europa.eu`, `insee.fr`, `banque-france.fr`, `caf.fr`, `hcfea.fr`, `legifrance.gouv.fr`, `bofip.impots.gouv.fr`), les **sources primaires non publiques** citées : `lobservatoire.creditlogement.fr`, `aspim.fr`, `indexes.nasdaqomx.com`, `research-center.amundi.com` ; (2) `scpi_taux_distribution` (4,91 %) dépasse le rendement central de la classe `immobilier` (4,5 %) : la part « prix de part » du § 5.3 vaut donc −0,41 % par an, cohérent avec la baisse récente des prix de part (−3,45 % en 2025, ASPIM) ; le panneau le dit.

### 11.5 Points non vérifiés : résolution (tâche 0, 2026-10-14)
1. **Parts de SCPI en direct** : textes lus (CGI 150 UB, 239 septies ; BOFiP RFPI-SPI-10-10, -10-20 ; RFPI-PVI-10-10), aucun ne nomme les SCPI ; impots.gouv.fr en maintenance. **Reste NV** : régime des plus-values immobilières appliqué avec `confiance: "probable"` et la mention « à confirmer » (cas F-8).
2. **PS des actifs numériques** : **V**, 18,6 % (CSS L136-8, IV : liste fermée des revenus à 9,2 %, les plus-values de l'art. 150 VH bis n'y sont pas). Le BOFiP de 2024 n'est pas à jour (cas F-11).
3. **Assurance-vie au-delà de 150 000 €** : **V**, prorata `150 000 / primes` (BOFiP RCM-20-15 § 190), abattement imputé d'abord sur la fraction à 7,5 % (RCM-20-10-20-50 § 288). **Correction du cas F-5** : 2 840 € (et non 2 718,10 €).
4. **PS de l'épargne salariale** : **V**, 18,6 % (même raisonnement que le point 2 ; cas F-12).
5. **Durée HCSF avec différé** : **V**, 27 ans de maturité, amortissement ≤ 25 ans, pour VEFA, CCMI, contrat de promotion et ancien avec au moins 10 % de travaux (25 % avant le 01/01/2024).
6. **Barème PTZ** de `toise.js` : **V**, identique à F10871 (15/09/2026) et à D31-10-11 ; non affiché dans IMMO1 pour une autre raison (zone et RFR N−2 absents).
7. **Barème PSU 2026** : **V**, taux pour 1 à 8 enfants et plus, plancher 814,62 €, plafond 8 500 €.
8. **Instruction obligatoire à 3 ans** : **V** (L131-1) ; le 1er septembre comme date de fin de crèche reste une convention.
9. **Repères « à relever » du § 11.4** : tous relevés (valeurs et sources ci-dessus). `nasdaq100_rendement` n'est **pas** créé (convention : rendement des actions) ; l'inflation de 1973 est retenue à 7,3 % (série Insee 000000282 et Tableaux de l'économie française T14F114G1) ; l'Insee Focus n° 87 (2017) donne 9,2 %, écart non expliqué, signalé.
10. **Dates de vérification de `marche.js`** : reportées à la tâche 2 (périmètre de la tâche 0 limité aux documents et à la fixture).
11. **Nouveaux points des retours produit** : CMG d'une assistante maternelle **NV** (montant fourni par l'utilisateur, sinon coût brut avec mention) ; durée de la PreParE à partir du 2ᵉ enfant **NV** (6 mois comptés, mention) ; quotient familial **V** mais non modélisé (PAT1) ; matrice euros de J.P. Morgan, BlackRock et Natixis non lues (révision annuelle des rendements centraux).

## 12. Cas de référence

**Référence : `test/fixtures/projection-cas.json`** (72 cas, figés en tâche 0 ; chacun `{ id, famille, fonction, nom, data, options, attendu, tolerance?, note? }`, conventions en tête du fichier). Chiffres calculés par deux scripts indépendants (Python et Node, non commités : 165 contrôles concordants), arrondis au centime. Données fictives. En euros **courants** et inflation 0 sauf mention. Les tableaux ci-dessous résument ; en cas d'écart, la fixture fait foi.

### 12.1 Mode déterministe (volatilité 0)

| Cas | Entrée | Attendu |
|---|---|---|
| D-1 Flux sans rendement | 10 000 € à 0 %, capacité 500 €/mois, 12 mois | 16 000,00 € |
| D-2 Capitalisation, versements en fin de mois | 10 000 € à 3 % (géométrique), 500 €/mois, 12 mois | 16 382,06 € |
| D-3 Euros constants | 100 000 € nominaux dans 10 ans, inflation 2 % | 82 034,83 € d'aujourd'hui |
| D-4 Rendement réel | 10 000 € à 5 %, inflation 2 %, 10 ans | 16 288,95 € courants ; 13 362,61 € constants |
| D-5 Frais | 10 000 € à 0 %, frais 0,20 % + 0,50 %, 12 mois | 9 930,00 € |
| D-6 Amortissement | 200 000 € à 3,35 %, 300 mois | échéance 985,23 € ; intérêts du 1ᵉʳ mois 558,33 € ; CRD après 12 mois 194 797,85 € (intérêts 6 620,61 €) ; 0 € après 300 mois ; intérêts totaux 95 568,99 € ; échéance du mois 120 en euros constants (2 %) 808,23 € |
| D-7 Fin de crédit | capacité 1 000 €/mois, crédit de 300 €/mois fini au mois 24, réaffectation 100 % | 1 000 € jusqu'au mois 24, 1 300 € ensuite |
| D-8 Naissance (UC) | 2 adultes, dépenses 3 000 €/mois (2 000 € par UC), naissance le 10/04/2027 | +600 €/mois d'avril 2027 à mars 2041, +1 000 €/mois d'avril 2041 à mars 2047, 0 ensuite |
| D-9 Levier ×2 | sous-jacent 7 %, σ 22,5 %, financement 2 %, frais 0,6 %, 10 000 €, 12 mois | **10 604,30 €** (corrigé : la spec appliquait `exp(−f)` au lieu de `(1 − f)`) ; sans frais 10 668,31 € ; σ 15 % : +9,07 % par an avec frais, +9,73 % sans |
| D-10 Crèche (PSU) | ressources 6 000 €/mois, 1 enfant, 0,0619 %, 200 h | 742,80 €/mois, mois 11 à 46 |
| D-11 Crise 2008 | 100 000 € en actions (7 %), `gfc_2008` au mois 1 | 45 000,00 € au mois 17 ; 48 150,00 € au mois 29 |

### 12.2 Fiscalité de sortie

| Cas | Entrée | Attendu |
|---|---|---|
| F-1 PEA avant 5 ans | valeur 50 000 €, versements 40 000 € | 3 140 € (IR 1 280 + PS 1 860), net 46 860 € |
| F-2 PEA après 5 ans | idem | PS 1 860 €, net 48 140 € |
| F-3 AV après 8 ans, couple | 120 000 €, primes 100 000 € | IR 810 € ; PS 3 440 € ; net 115 750 € |
| F-4 AV avant 8 ans | idem | 6 000 € ; net 114 000 € |
| F-5 AV après 8 ans, primes 200 000 € | 240 000 €, couple | **IR (30 000 − 9 200) × 7,5 % + 10 000 × 12,8 % = 2 840 €** (corrigé : abattement imputé d'abord sur la fraction à 7,5 %) ; PS 6 880 € ; net 230 280 € |
| F-6 Compte-titres | gain 5 000 € | 1 570 € |
| F-7 PER | versements déduits 30 000 €, valeur 40 000 €, TMI 30 % | 12 140 € ; net 27 860 € ; « bloqué sauf résidence principale » |
| F-8 SCPI en direct, 10 ans | plus-value 10 000 € | 1 330 + 1 578,10 = 2 908,10 € ; `confiance: "probable"` |
| F-9 Livret A | gain 300 € | 0 € |
| F-10 Date d'ouverture inconnue | AV 120 000 €, primes 100 000 € | règle « avant 8 ans » (6 000 €), mention |
| F-11 Crypto (nouveau) | gain 4 000 € | 512 + 744 = 1 256 € |
| F-12 PEE disponible (nouveau) | gain 2 000 € | PS 372 € |
| F-13 Repère manquant (nouveau) | `ps_taux_general` retiré | montant brut, mention, aucune valeur de secours |

### 12.3 Ordre de retrait (§ 6.3)
Foyer commun : disponible 30 000 € (matelas 10 000 €), compte-titres 20 000 € (gain 2 000 €), assurance-vie de 9 ans 50 000 € (primes 40 000 €, couple, abattement intact), PEA de 3 ans 40 000 € (versements 30 000 €).

| Cas | Entrée | Attendu |
|---|---|---|
| R-1 Apport | 60 000 € net | disponible 20 000 € ; compte-titres 20 000 € (impôt 628 €) ; assurance-vie 21 362,88 € brut (gain 4 272,58 € sous l'abattement, PS 734,88 €) ; PEA intact ; impôts 1 362,88 € |
| R-2 PEA protégé | 150 000 € | mobilisable 97 592 € (assurance-vie entière : IR 60 €, PS 1 720 €, net 48 220 € ; matelas 10 000 €) ; « il manque 52 408 € » ; PEA intact |
| R-3 Clôture autorisée | 120 000 €, `autoriser_cloture_pea` | PEA liquidé (3 140 € d'impôt, net 36 860 €), 22 408 € utilisés, excédent de 14 452 € au disponible |
| R-4 PER et résidence principale | 110 000 €, PER 20 000 € (versements déduits 15 000 €, TMI 30 %) | `rp` : PER entier (impôts 6 070 €, net 13 930 €), matelas 8 478 € ; `locatif` : PER jamais, « il manque 12 408 € » |

### 12.4 IMMO1

| Cas | Entrée | Attendu |
|---|---|---|
| I-1 Capacité | revenus 5 000 €, crédits 300 €, 35 %, 3,35 %, 25 ans, assurance 0,15 % | mensualité max 1 450 € ; empruntable 287 063,35 € (échéance 1 414,12 € + assurance 35,88 €) |
| I-2 Budget | I-1 + apport 50 000 € | ancien 308 511,77 € ; primo 309 946,71 € ; neuf 325 066,06 € |
| I-3 Sensibilité | 20/25 ans × 2,35 / 3,35 / 4,35 % | 270 964,31 / 319 664,88 ; 247 955,86 / 287 063,35 ; 227 600,49 / 258 996,64 (budgets « ancien » dans la fixture) |
| I-4 Loyers | 4 000 € + loyers 1 000 € | 4 700 € (convention 70 %) |
| I-5 Demain | crédit de 300 € fini au mois 18 | 1 450 € jusqu'au mois 18, 1 750 € ensuite |

### 12.5 Monte-Carlo (graine fixe)

| Cas | Entrée | Attendu (tolérance) |
|---|---|---|
| MC-1 Log-normale | 100 000 € en actions (7 %, 15 %), 10 ans, 2 000 chemins | P10 107 110,75 (± 6 %) ; P25 142 853,28 (± 5 %) ; P50 196 715,14 (± 4 %) ; P75 270 885,24 (± 5 %) ; P90 361 278,80 (± 6 %) : ≈ 3 écarts types d'échantillonnage (mesurés : 1,3 à 1,8 %) |
| MC-2 Reproductible | MC-1 deux fois ; graine 1 | identiques à l'octet ; différents |
| MC-3 Corrélation | actions et obligations, 2 000 × 120 | 0,10 ± 0,03 |
| MC-4 Tirages communs | MC-1 contre MC-1 + 100 €/mois investis | chaque chemin ≥ ; médiane des écarts 17 295 € (± 5 %) ; valeur future déterministe 17 105 € pour contrôle |
| MC-5 Stabilité | ajout d'une ligne d'or | chocs des actions identiques chemin par chemin |
| MC-6 500 premiers | P50 sur 500 chemins | égal au P50 des 500 premiers des 2 000 |
| MC-7 Centile | 10 valeurs | P10 = 1ʳᵉ, P25 = 3ᵉ, P50 = 5ᵉ, P75 = 8ᵉ, P90 = 9ᵉ |
| MC-8 Volatilité nulle | σ = 0 | identique au déterministe |
| MC-9 Existant (nouveau) | 100 000 € + 1 000 €/mois, σ 15 % | existant = simulation à capacité 0, chemin par chemin ; complet − existant = versements capitalisés sur les mêmes chemins (écart relatif ≤ 1e−9) |
| MC-10 Corrélations (nouveau) | 12 classes tirées | définie positive (plus petite valeur propre 0,077), sans correction |

### 12.6 Cas composés (déterministes, 10 ans, inflation 0)
Foyer fictif (Alex 3 000 €, Sam 2 000 €, dépenses 3 000 € dont loyer 1 000 €, prêt auto de 300 €/mois fini en octobre 2028, compte courant 20 000 €, assurance-vie de 2015 en fonds euros 50 000 €, primes 40 000 €, matelas 10 000 €). Chaque cas ajoute un élément au précédent ; attendu : financier, disponible et net à chaque anniversaire, capacité par période, détail de l'achat.

| Cas | Ajout | Capacité par période | Net à 10 ans |
|---|---|---|---|
| C-1 | base | 1 700 € (mois 1 à 24), 2 000 € ensuite | 316 804,22 € |
| C-2 | naissance le 10/04/2027 | 1 700 → 1 100 (mois 6) → 1 400 (mois 25) | 247 804,22 € |
| C-3 | crèche du 01/09/2027 au 01/09/2030 (619 €) | … 481 € (mois 11 à 24), 781 € (25 à 46), 1 400 € ensuite | 225 520,22 € |
| C-4 | achat de la résidence principale le 01/01/2029 (300 000 €, apport 60 000 €, 25 ans à 3,35 %, assurance 0,30 %, loyer remplacé 1 000 €, charges 250 €) | … 781 € (25 à 27), 164,50 € (28 à 46), 783,50 € ensuite | 196 826,88 € ; apport : courant 33 077 €, assurance-vie 28 098,55 € brut (PS 1 175,54 €) ; emprunt 264 000 €, mensualité 1 366,50 € |
| C-5 | fin de crédit : moitié réaffectée | … 631 € (25 à 27), 14,50 € (28 à 46), 633,50 € ensuite | 182 308,18 € |
| C-6 | hausse de revenu de 500 € (Alex, 01/01/2030, moitié épargnée) | … 14,50 € (28 à 38), 264,50 € (39 à 46), 883,50 € ensuite | 202 808,18 € |
| C-7 | autre foyer : **nouvel emploi de Sam dans 2 mois (15/12/2026), premier enfant dans 6 mois (10/04/2027), congé parental de 6 mois, crèche** ; capacité constatée sur 6 mois (300 €/mois) contre 1 900 € prévus | 300 → 700 (nouvel emploi, mois 3) → −320 (enfant, mois 6) → −2 760,30 (congé parental, mois 9 à 14) → −1 087,56 (crèche, mois 15 à 46) → −320 | disponible 37 318,11 € à 1 an, 21 348,33 € à 2 ans ; matelas atteint, premier retrait sur le PEA au mois 35 ; sans les événements : 88 137,29 € de financier à 2 ans au lieu de 55 056,33 € |

### 12.7 Garde-fous, existant et rétro-contrôle

| Cas | Entrée | Attendu |
|---|---|---|
| G-1 Capacité constatée nulle | PEA 120 000 € (6 %), courant 5 000 €, capacité constatée 0 € sur 12 mois, prévue 1 500 € | base constatée ; garde-fou `ecart_capacite` ; 165 587,07 € à 5 ans, dont 40 587,07 € des marchés |
| G-2 Base prévue forcée | même foyer, 1 500 €/mois investis | 269 815,75 € à 5 ans (« presque le double » : le cas jugé irréaliste) ; alerte `versements_superieurs_capacite_constatee` ; ratio 1,255 sous la borne 1,469 |
| G-3 Rendement implicite | variante à 12 % | implicite 11,61 % > attendu 5,76 % + 0,5 : alerte |
| G-4 Borne de croissance | 100 % crypto (10 %) | 1,10⁵ = 1,6105 > 1,08⁵ = 1,4693 : alerte |
| E-1 Existant et épargne future | 100 000 € + 1 000 €/mois à 6 %, 10 ans | existant 179 084,77 € ; épargne future 162 473,44 € (versements 120 000 €, croissance 42 473,44 €) ; total 341 558,21 € |
| BT-1 Couverture | 10 dates | 7 dans P10–P90, 5 dans P25–P75, 1 sous P10, 2 au-dessus de P90 ; non affichable (< 24) |
| BT-2 Couverture | 30 dates | 24 dans P10–P90 (80 %), affichable |

### 12.7 bis Assurance d'un crédit existant (§ 6.4)

Prêt de 100 000 € restant dus, mensualité 600 € assurance comprise, taux 3 %, vue nette, 10 ans, déterministe. Attendus recalculés en Python, indépendamment du moteur.

| Cas | Entrée | Attendu |
|---|---|---|
| L-1 Assurance connue, durée totale connue | `duree_mois` 300, `assurance_taux_pct` 0,30 | capital initial 120 189,58 € ; assurance 30,05 €/mois ; part qui amortit 569,95 € ; 232 mois restants ; capital restant dû 96 107,33 € (mois 12), 92 096,27 € (24), 79 316,12 € (60) ; pas de mention |
| L-2 Assurance connue, durée totale inconnue | `assurance_taux_pct` 0,30 | assurance estimée sur le capital restant dû : 25 €/mois ; 575 € amortissent ; 229 mois ; 96 045,93 € au mois 12 ; mention |
| L-3 Assurance inconnue | — | aucune séparation : 216 mois ; 95 741,77 € au mois 12 (trop vite) ; mention |

### 12.8 Validation des événements
V-1 à V-15 : 15 événements (dont `changement_emploi`, `conge_parental`, garde par assistante maternelle) avec le message attendu, ou `null` s'il est valide ; **mêmes messages** dans `Projection.validerEvenement`, `appliquer_propositions` (0030), le store démo et `decrire_foyer`.

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
- `versementReel` et son étiquette « réel » disparaissent. La projection affiche une ligne : « Épargne mensuelle projetée : 300 € — ta capacité d'épargne constatée (avril à septembre 2026, comptes courants) », complétée quand le garde-fou `ecart_capacite` se déclenche par « prévue au budget : 1 900 € ; versements programmés : 500 € » et la puce « hypothèse » (§ 6.1) ; ou « … — capacité d'épargne prévue au budget (pas encore de comptes connectés) » ; ou « Pas encore de capacité d'épargne connue : la projection suppose 0 € par mois ». Les marches futures (événements) sont dans la bande « capacité d'épargne » (§ 10.1). Le simulateur local (champ « versement ») est retiré : un « et si j'épargnais plus ? » devient une variante proposée par le Copilote (règle 1), ou le levier de SIM4.
- La note « Épargne mensuelle répartie par priorité : … (épargne prévue au budget et reste positif) » d'Objectifs dit désormais la même source que la projection.

### 13.3 Objectifs existants
- **Cible en euros d'aujourd'hui** : changement de sens annoncé une fois (bandeau dans Objectifs, et le Copilote le dit à la prochaine session : « tes cibles sont maintenant lues en euros d'aujourd'hui ; dis-moi si une cible était déjà prévue en euros de l'époque »). Aucune donnée n'est réécrite.
- **Statut** : les clés existantes restent (`atteint`, `avance`, `dans_les_temps`, `retard`, `hors_portee`) pour l'interface et le connecteur ; elles sont calculées sur le chemin déterministe, et la probabilité (§ 10.7) s'affiche à côté. SCO1 remplacera la jauge par la probabilité.
- Statuts d'un objectif, dans cet ordre : `atteint` (déjà réuni ≥ cible) ; `hors_portee` (échéance passée et non atteint) ; **`hors_horizon`** (échéance au-delà de l'horizon de la projection : aucune probabilité, `probabilite` et `mot` nuls) ; puis `avance`, `dans_les_temps`, `retard` d'après le chemin déterministe. L'interface traite `hors_horizon` comme « pas de verdict ».
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
        'fin_credit','crise','changement_emploi','conge_parental',
        'chomage','separation','invalidite','retraite','heritage','temps_partiel','demenagement')),
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
- **Livré (migration 0031, séparée de 0030 qui ne porte que les repères)** : le CHECK de `type` ne laisse que les **10 types V1** (les 7 réservés sont refusés par la table comme par la RPC) ; `date >= 1950-01-01` ; `params` et `hypotheses` ≤ 20 000 octets ; `cardinality(retire) <= 100` ; des déclencheurs BEFORE INSERT / UPDATE appellent `foyer_valider_evenement` et `foyer_valider_variante` (mêmes règles et messages que `web/src/projection-evenements.js`), de sorte qu'une écriture directe ne contourne pas la validation de la proposition ; `plans_figes.cree_le` est forcé à `now()` (un plan ne s'antidate pas), les plans sont immuables (pas d'`update`), `parametres` ≤ 100 000 octets et `serie` ≤ 250 000 octets mesurés en `octet_length(jsonb::text)` ; `propositions.apres` ≤ 400 000 octets pour `plan_fige` seulement.
- Index sur `user_id` ; `variante_id` doit appartenir au même utilisateur (déclencheur ou contrôle dans `appliquer_propositions`) ; 100 événements et 10 variantes au plus par utilisateur ; `updated_at` par le déclencheur existant.
- **RLS** : politiques de propriétaire (`user_id = auth.uid()`) en `select` seulement pour `authenticated` (l'écriture passe par `appliquer_propositions`, `security invoker` : droits `insert/update/delete` accordés comme pour `objectifs`, mêmes politiques). **Politique restrictive** `"<table>: aal2 si facteur"` (modèle exact de 0028). `test/mfa-pglite.test.mjs` énumère déjà les tables à `user_id` : il échoue tant qu'elles n'ont pas leur politique.
- **Export** : `export_all()` repart de sa dernière définition (0021) et ajoute `foyer_evenements` et `foyer_variantes`. **Suppression** : `on delete cascade` depuis `auth.users` (`delete_me`).
- **Contenu commun** : `indices_mensuels (serie text, mois date, valeur numeric, source_titre, source_url, verifie_le, primary key (serie, mois))`, lisible par tous (comme `reperes`), sans `user_id`, écrit par migration ou par le service ; série `ipc_insee`.

### 14.2 Propositions
- Nouvelles cibles `evenement` et `variante` (contrainte `propositions_cible` étendue ; `ref` obligatoire pour `modifier` et `supprimer`), mêmes opérations que `objectif`. Validation par type d'événement (paramètres obligatoires, bornes : montants ≥ 0 sauf `delta_mensuel`, dates réelles entre 1950 et aujourd'hui + 40 ans, `enfant` 1 à 40 caractères, clés de crise et de crédit connues, `frais_annuels` obligatoire pour `scolarite_privee`, `charges_mensuelles` pour `achat_immobilier`), **mêmes règles et messages** dans le validateur pur du moteur (`Projection.validerEvenement`), dans le store démo et dans `decrire_foyer` (parité testée). Types réservés refusés en V1.
- Nouvelle clé de la cible `config` : `projection` = `{ base_capacite?: "reel"|"prevu"|"montant", capacite_mensuelle? (avec "montant", ≥ −100 000 et ≤ 100 000), reste_capacite?, reequilibrage?, part_reaffectee_epargne_pct?, part_hausse_epargnee_pct?, salaire_croissance_reelle_pct?, tmi_pct?, per_versements_deduits?, assurance_pct?, biens?: { "bien:<uuid>": { prix_achat, date_achat, source, le } }, source, le }` (fusion par champ, `null` retire).
- Types V1 : ceux du § 7.1, dont `changement_emploi` (`salaire_net_mensuel` obligatoire, ≥ 0) et `conge_parental` (`fin` et `activite` obligatoires) ; `creche` en mode `assistante_maternelle` exige `cout_mensuel`. Réservés : `chomage`, `separation`, `invalidite`, `retraite`, `heritage`, `temps_partiel`, `demenagement`.
- `propositions.js` décrit chaque proposition en clair : « Naissance prévue : Enfant 2, mars 2028 (coût selon l'échelle de l'Insee) », « Achat de la résidence principale en septembre 2029 : 420 000 €, apport maximal, prêt sur 25 ans ».

### 14.3 Repères
Les lignes du § 11.4 dont la valeur est vérifiée ou conventionnelle (statut V, V-DAT1, CR, CONV), `on conflict (cle) do update`, avec `date_fin` pour les taux mensuels. Toutes les lignes ont été relevées en tâche 0 (liste exacte : `reperes` de la fixture) ; une ligne NV n'entre jamais ; un repère absent est signalé comme manquant par le moteur, jamais remplacé par une valeur de secours.

## 15. Connecteur MCP

Outils tels que livrés (le tableau d'origine a été corrigé après la revue du 2026-10-15 ; écarts avec la première rédaction signalés en § 18).

| Outil | Annotations | Rôle |
|---|---|---|
| `decrire_foyer({ evenements?: [...], variantes?: [...], reglages?: {...}, source, justification?, lot? })` | RW | Dépose des propositions (`evenement`, `variante`, `config.projection`) : événements à créer (sans `id`), modifier (avec `id`, seuls les champs fournis changent) ou supprimer (`supprimer: true`), 10 événements et 10 variantes au plus par appel (100 et 10 au total), après validation par le moteur (mêmes messages que la base). Renvoie les propositions et `valeurs_par_defaut` (repère sourcé ou hypothèse dite comme telle). Aucune proposition si rien ne change. |
| `figer_projection({ horizon_ans?, perimetre?, vue?, euros?, net_impots?, variante?, raison?: "revue_mensuelle"\|"objectif"\|"manuel", source, justification?, lot? })` | RW | Dépose une proposition `plan_fige` (60 au plus) : la projection d'aujourd'hui rangée avec de quoi la rejouer et sa série P10 à P90. Le plan n'est pas renvoyé. Tailles tenues sous les limites de la base (§ 14.1). |
| `lire_foyer()` | RO | Événements, variantes, réglages de projection, plans figés (métadonnées), catalogue des types avec paramètres et valeurs par défaut, types réservés, limites, question à poser s'il n'y a aucun événement. |
| `projeter({ horizon_ans?, perimetre?, vue?, euros?, net_impots?, variante?, crise?: { cle, debut? } })` | RO | Résumé : phrase de titre, bande P10 à P90 **par année pleine**, **`couches_a_l_horizon`** (`existant`, `epargne_future`, versements cumulés), **`capacite_base`** et **`capacite_par_periode`**, **`decomposition`** et **`garde_fous`** (§ 6.8), **`evenements_pris_en_compte`** et `question_evenements` (§ 7.3), objectifs avec probabilité, « manquer d'argent », 15 jalons au plus, hypothèses sourcées, couverture, avertissements, `version_modele`, `graine`, `conduite`. Pas les 2 000 chemins. `crise.debut` : date réelle entre aujourd'hui et la fin de l'horizon (sinon refus). `retro` n'est pas branché (§ 18). |
| `comparer_variantes({ variante, reference?, horizon_ans?, perimetre?, vue?, euros?, net_impots? })` | RO | Compare la situation actuelle (ou la variante `reference`) à `variante`, sur les mêmes tirages : écarts P10 / P50 / P90 par année, probabilité que la variante fasse mieux, phrase. |
| `capacite_emprunt({ perimetre?, duree_ans?, taux_pct?, neuf?, primo?, dans_le_temps?, horizon_ans?, date?, scenario? })` | RO | § 8 ; `dans_le_temps: true` ajoute `capaciteDansLeTemps` (points annuels) ; `date` (avec `dans_le_temps`) : entre aujourd'hui et la fin de l'horizon, sinon refus. Pas de paramètre `variante` (§ 18). |

- Les outils lisent les tables, convertissent en formes de l'app et appellent **la copie générée** du moteur. `demarrer_session` ajoute `projection: { evenements: { nombre, a_venir (3 au plus), question }, variantes, plans_figes: { nombre, dernier }, version_modele }` (null en cas d'échec, sans lever) : une lecture légère, sans calcul, pour que le Copilote applique la règle 7 du § 7.3 dès le début. `list_objectifs` renvoie `probabilite` et `probabilite_mot` (moteur, 2 000 chemins ; null si le calcul échoue ou si l'échéance dépasse 25 ans).
- Conduite (§ 7.3) ajoutée aux `INSTRUCTIONS` et renvoyée par `projeter`.
- Expertise : la fiche de conduite de l'expertise « projection » (EX1) cite les outils ; le banc EX3 recevra des cas de référence (Opus, plus tard).

## 16. Tests

- **Moteur** (`test/projection.test.mjs`) : tous les cas du § 12 depuis la fixture (familles `deterministe`, `compose`, `garde-fou`, `existant`, `retro`) ; ordre des opérations d'un mois ; pureté (entrée non modifiée) ; aucune valeur de secours quand un repère manque ; couverture ; textes au tutoiement, sans « conseiller » ni produit.
- **Fiscalité** (`test/projection-fiscalite.test.mjs`) : chaque ligne du § 5.2 ; dates DAT1 aux bornes (veille et lendemain de `pea_5_ans`) ; règles NV marquées.
- **Événements** (`test/projection-evenements.test.mjs`) : chaque type, validation et messages (parité avec la base et le store démo), extensibilité (un type réservé est refusé).
- **IMMO1** (`test/projection-capacite.test.mjs`) : cas I-1 à I-5, non-régression des chiffres de Rang avec les mêmes taux.
- **Monte-Carlo** (`test/projection-mc.test.mjs`) : MC-1 à MC-10, matrice définie positive, temps (plafond large), couche existant chemin par chemin.
- **Connecteur** (`test/projection-mcp.test.mjs`) : la copie générée est à jour (`npm run gen` sans écart) ; sorties identiques à l'app sur la fixture et la démo ; outils, annotations, validations, conduite.
- **Migration** (`test/projection-pglite.test.mjs`) : tables, contraintes, RLS (B ne lit ni n'applique rien de A), politiques MFA, propositions tout ou rien, `export_all`, cascade, `config.projection`, `indices_mensuels` en lecture seule pour `authenticated`, diff de `appliquer_propositions` contre 0029 limité aux ajouts.
- **Interface** (`test/graphe-patrimoine.test.mjs`, `aujourdhui`, `objectifs-view`, `pilotage`, `bilan`) : les 12 tests d'acceptation du § 10.8 (commandes, axe proportionnel, continuité à « Aujourd'hui », graduations, curseur et panneau de lecture, clavier, jalons, couches et bande de capacité, en-tête, rendu progressif, plein écran, accessibilité, lecture seule), libellé de la source des versements.

## 17. Hors périmètre

- Calcul inverse, tornade (SIM3), leviers (SIM4), score de trajectoire (SCO1), prévu contre réalisé (CK5) : ils s'appuieront sur ce moteur.
- Événements réservés (chômage indemnisé en tant que tel, séparation, invalidité, retraite, héritage, temps partiel, déménagement), pensions (PAT2), impôt sur le revenu du foyer et quotient familial (PAT1 ; le plafond de la demi-part est seulement cité), aides familiales hors PreParE et barème PSU (allocations familiales, CMG calculé, crédit d'impôt pour frais de garde).
- Inflation et taux aléatoires ; queues épaisses ; surtaxe des plus-values immobilières ; option pour le barème ; imputation des moins-values ; frais de vente d'un bien.
- Le simulateur « Acheter ou louer » (DEC1).
- La page Pilotage › Projections (emplacement réservé dans `app.js`) : elle recevra la vue complète avec SIM3.

## 18. Écarts acceptés et corrections de revue (2026-10-15)

Écarts avec la première rédaction, décidés à la livraison ou à la revue Opus ; la fixture reste la référence des chiffres.
- **Tolérance des cas composés (famille C)** : 0,02 € près (0,0107 observé), au lieu de 0,01.
- **`retroControle` / `couverture`** : fonctions livrées et testées (BT-1, BT-2), pas encore branchées sur `projeter` (`retro: null`) ni sur l'interface : il leur manque la reconstitution HIS1 par poche, attendue avec SIM2.
- **`capacite_emprunt`** n'accepte pas de paramètre `variante` : la capacité se lit sur la situation actuelle ; `capaciteDansLeTemps` suit les événements de la situation actuelle.
- **Capacité observée sur 12 mois** : l'app et le connecteur chargent 13 mois de `banque_mois` (le mois en cours et 12 mois complets, depuis le jour de Paris) ; `Calc.budgetReel` en lit 12, sinon 6 au moins, sinon 3 (§ 6.1).
- **Coût d'un enfant (§ 7.4)** : calculé sur les dépenses du **foyer** par unité de consommation ; la part d'une personne vient du facteur de l'événement (la moitié d'un événement du foyer), jamais d'une division répétée.
- **Garde-fou de croissance à 5 ans (§ 6.8)** : compare le patrimoine financier du scénario central à `V0 + versements`, c'est-à-dire la même vue des deux côtés, quelle que soit la vue affichée (net avec la résidence et les dettes, ou après impôts). Il est supprimé quand `rendement_implicite` se déclenche (cas G-3).
- **SCPI détenues en direct (§ 5.3)** : la distribution (`scpi_taux_distribution`) est versée chaque mois au compte courant après barème (TMI, 30 % supposé et dit si inconnu) et prélèvements fonciers (`ps_taux_foncier`) ; sans l'un des deux repères rien n'est distribué et la limite est dite. Un fonds immobilier coté (ISIN, cours) n'est jamais traité en SCPI.
- **Apport futur** : les enveloppes dont l'impôt de sortie est inconnu (type à compléter, repère manquant) ne sont comptées dans aucun apport (aujourd'hui comme demain), et le sont dans `avertissements`.
- **Crise et immobilier physique (§ 4.6)** : convention dite, le choc de la classe « immobilier » (mesuré sur les SCPI, IEIF) est appliqué à la résidence et aux biens loués ; affichée dans la crise et dans `hypotheses_classes`.
- **Dates** : une date de début de crise ou d'achat envisagé absente, invalide, passée ou hors horizon rend le calcul indisponible avec la fenêtre permise ; jamais le mois 1 ou la dernière année en silence.
- **Plans figés** : paramètres réduits par étapes dites (`parametres.reductions`), série espacée (`serie.pas_mois`) pour tenir sous les limites de la base ; les paramètres des événements sont limités aux clés connues de leur type.
- **`figer` n'est plus une option de `projeter`** : outil séparé `figer_projection` (RW) ; `projeter` reste en lecture seule.
- **Pas de portage de `effortMensuel`, `dateAtteinte`, `repartirEpargne`, `statutObjectif`** dans le connecteur (tâche 12) : seule `probabilite` est branchée sur le moteur.
