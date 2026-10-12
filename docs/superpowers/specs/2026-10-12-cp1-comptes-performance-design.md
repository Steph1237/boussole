# CP1 : comptes en un coup d'œil, fiches de performance, budget réel, exports réclamés, Binance

Date : 2026-10-12. Statut : validé par Stéph.

**Décisions de Stéph :**
- performance « les deux, progressivement » ;
- onglet « Patrimoine › Comptes » en premier ;
- comptes courants séparés du reste et source du budget ;
- la revue mensuelle réclame les exports Linxea et Revolut ;
- Binance en lecture seule.

## 1. Quatre familles de comptes
Chaque ligne de Boussole appartient à une famille, déduite de son enveloppe et de son bloc, comme dans `Calc.liquidite` et `Calc.classe` :

| Famille | Contenu |
|---|---|
| **Comptes courants** | Bloc ou enveloppe « Comptes courants » |
| **Épargne disponible** | Livrets, fonds monétaires |
| **Investissement** | PEA, PEA-PME, compte-titres, assurance-vie, PER, crypto |
| **Dettes** | Crédits |

Une fonction pure `Calc.famille(position)` fait ce classement. Elle est partagée avec le connecteur, et la parité entre les deux est testée.

**Règles des comptes courants :**
- Ils comptent dans le patrimoine net, mais pas dans l'allocation, le risque ni la diversification. Ces trois calculs portent sur l'épargne disponible et l'investissement.
- **Matelas** = épargne disponible + (soldes courants − réserve de fonctionnement).
  - La réserve vaut par défaut 1 mois de dépenses, réglable dans `config.cushion.reserve_mois`.
  - Les dépenses viennent du budget réel s'il existe, sinon du budget prévu.
- **Argent qui dort** : soldes courants supérieurs à 1,5 mois de dépenses pendant 2 mois de suite. Une alerte s'affiche dans Aujourd'hui, et la revue mensuelle en fait une question.

## 2. Patrimoine › Comptes (nouvel onglet, en premier)
**En tête :** patrimoine net, puis financier, immobilier et dettes, avec la variation sur 1 mois tirée des photos quotidiennes (snapshots).

**Les quatre familles en blocs repliables.** Dans chaque bloc, les comptes sont groupés par établissement : établissement Powens, mot-clé de l'enveloppe (Linxea, Binance), ou « saisi à la main ». Chaque carte montre :
- le nom et le solde ;
- la part du total ;
- la plus-value latente, pour l'investissement ;
- une pastille de source : « Synchronisé le JJ/MM » (Powens ou Binance), « Import du JJ/MM » ou « Saisi le JJ/MM ».

**Navigation.** Les fiches s'ouvrent dans la même vue, avec fil d'Ariane et adresses profondes :
- `#patrimoine/comptes?enveloppe=<nom>&titulaire=<p1|p2>` ;
- `#patrimoine/comptes?ligne=<id>` ;
- `#patrimoine/comptes?courant=<id de ligne>`.

**Fiche enveloppe** (investissement et épargne) :
- une courbe sur 1 mois, 3 mois, 1 an, 3 ans ou 5 ans, au choix, intitulée « valeur de tes lignes actuelles » : quantités actuelles × cours historiques (table `cours`), plus les liquidités et les lignes manuelles à valeur constante ;
- la plus-value latente totale et le prix de revient total ;
- la répartition par classe ;
- puis les lignes triées par poids, chacune avec sa valeur, sa plus-value en euros et en %, et sa performance sur la période choisie.

« Vraie performance » : un bloc corrigé des versements, à partir des photos quotidiennes `by_envelope` et des mouvements. Tant qu'il y a moins de 90 jours d'historique, il affiche « En construction : disponible à partir du JJ/MM ».

**Fiche ligne :**
- la courbe du cours, avec le prix de revient en ligne horizontale ;
- quantité, valeur, plus-value, frais, zone et devise, mouvements connus ;
- la source de la donnée et sa date ;
- le bouton « Demander à Claude », qui active l'expertise correspondante (actions, ETF et fonds, crypto).

**Fiche compte courant** (des flux, pas une performance) :
- le solde ;
- les entrées et sorties du mois, et la moyenne sur 6 mois ;
- le solde le plus bas des 90 derniers jours ;
- les prélèvements récurrents ;
- une courbe des entrées et sorties par mois.

## 3. Graphiques cliquables
`App.ouvrir({ enveloppe, titulaire } | { ligne } | { courant })` navigue vers la fiche. Il est branché sur :
- Patrimoine › Placements : enveloppes, lignes, poches ;
- la frise d'Aujourd'hui ;
- les lignes citées dans Risque, Objectifs et Journal, quand elles portent une ligne ou une enveloppe.

Clic, clavier (Entrée) et lecteur d'écran sont pris en charge : chaque élément est un vrai bouton ou lien.

## 4. Cours historiques (migration 0023)
- **Table `public.cours`** : `(isin, date, cloture numeric, source)`, clé primaire `(isin, date)`. Lecture publique pour `authenticated`, écriture par le service seulement. Elle contient environ 5 ans de cours quotidiens par ISIN détenu.
- **Fonction `nightly`** :
  - **chaque nuit**, enregistre la clôture du jour de chaque instrument (Yahoo ou Euronext, sources déjà utilisées) ;
  - **rattrapage** pour un ISIN sans historique : 5 ans de cours d'un coup (Yahoo `range=5y&interval=1d`, sinon le téléchargement historique Euronext), puis cours quotidiens. Au plus 10 rattrapages par nuit.
- **Lecture côté app** : `Store.cours(isins, depuis)`, à la demande, uniquement à l'ouverture d'une fiche.

## 5. Budget réel calculé sur les comptes courants
**Virements internes.** Une opération est classée `virement_interne` si elle trouve, sur un autre compte connecté du même utilisateur, une opération de montant opposé (à 0,01 € près) à 3 jours d'écart au plus.
- Le libellé (VIR, virement) ou le type renforce le rapprochement, mais n'est pas indispensable.
- Un virement d'un compte courant vers l'épargne ou l'investissement est classé en « epargne ».
- Ces opérations sont exclues des dépenses et des revenus dans `banque_mois`.

**Budget réel (Patrimoine › Budget)** :
- calculé sur les **comptes courants seulement** ;
- revenus = entrées hors virements internes ; dépenses = sorties hors virements internes et hors cartes à débit différé déjà comptées ; épargne = virements vers l'épargne et l'investissement ;
- **taux d'épargne réel** = épargne ÷ revenus, en moyenne sur les 3 derniers mois complets.

**Revenus détectés.** Une entrée récurrente sur le compte courant (même libellé nettoyé, au moins 2 mois sur 3, montant stable à ±15 %) est un salaire probable. Si l'écart avec les revenus du profil dépasse 10 %, une proposition `profil` est déposée, source « Powens — revenus détectés », jamais appliquée automatiquement.

## 6. La revue mensuelle réclame les exports
- `demarrer_routine` renvoie `sources_a_mettre_a_jour` : les enveloppes et lignes ni synchronisées (`source_auto` nul) ni mises à jour depuis 30 jours. Elles sont groupées par établissement, déduit du nom d'enveloppe, avec une consigne prête à l'emploi tirée d'un catalogue `SOURCES` :
  - Linxea : « espace client Linxea → Mes contrats → Exporter mes données financières (Excel) », lien https://www.linxea.com, un export par contrat et par titulaire ;
  - Revolut : « app Revolut → compte → Relevés → Excel/CSV du mois » ;
  - générique : selon le type de compte.
- `CONDUITE_REVUE` : une question par source à mettre à jour, avec la consigne. Le fichier déposé dans la conversation est traité comme un relevé (agrégation, ISIN, prix de revient), puis les mises à jour passent par des propositions. Les connexions Powens à reconnecter renvoient à Agent › Connexion.

## 7. Binance en lecture seule (pilote, Stéph seul)
- **Secrets** : `BINANCE_API_KEY` et `BINANCE_API_SECRET`. La clé n'a que le droit de lecture. Les secrets ne sont jamais écrits dans le code ni dans les journaux.
- **Activation** : `fonctionnalites.cle` accepte aussi `binance` (migration 0023). Une seule personne peut l'activer tant que les secrets sont communs au projet ; le contrôle se fait dans la fonction.
- **Synchronisation chaque nuit**, dans `nightly` :
  - lecture signée HMAC-SHA256 de `GET /api/v3/account` (portefeuille au comptant) et de Simple Earn (`/sapi/v1/simple-earn/flexible/position` et `/locked/position`) ;
  - somme par actif, en ignorant les quantités nulles ;
  - mise à jour des quantités des lignes de l'enveloppe « Crypto (Binance) » qui ont la même `isin` `X-<ACTIF>` ;
  - création d'une ligne de marché pour un actif nouveau au-delà de 10 € ;
  - ligne disparue → « clôturé » ;
  - `source_auto = 'binance'`, avec la contrainte `positions_source_auto` élargie en 0023.
- **Cours** : ceux de la nuit Boussole, sans changement.

## 8. Tests
- **PGlite** : table `cours` (droits), contrainte `source_auto` élargie, `fonctionnalites` binance.
- **Calculs purs** : `famille`, matelas avec réserve, argent qui dort, série de valeur d'une enveloppe, virements internes, revenus détectés, consignes d'export, Binance (signature, agrégation, application aux lignes avec un `fetch` factice).
- **App** : vue Comptes (familles, cartes, fiches, fil d'Ariane, adresses profondes, accessibilité, échappement), clics des graphiques, budget réel, démo.
- **Connecteur** : `sources_a_mettre_a_jour`, budget réel dans `lire_banque` et dans la revue.
