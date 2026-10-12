# CP3 : onglet Dépenses (où va l'argent chaque mois, perso et commun séparés)

Date : 2026-10-12. Statut : demandé par Stéph (« un onglet dépense pour comprendre dans quoi on dépense le plus par mois, séparé compte perso et commun »). À construire avec CP2, dont il dépend : titulaire `commun`, `budget_historique`, partage.

## 1. Place et navigation
- **Patrimoine › Dépenses**, deuxième onglet, juste après Comptes. Budget reste l'écran « prévu contre réel ».
- **Bascule « Perso | Commun | Tout »** en tête de page :
  - **Perso** : comptes courants dont le titulaire est la personne du périmètre (p1 pour Stéph, p2 pour son ou sa conjointe) ;
  - **Commun** : comptes de titulaire `commun` (Revolut commun) ;
  - **Tout** : l'ensemble, apports au compte commun exclus pour ne pas compter deux fois.
  - Valeur par défaut : Tout en vue Foyer, Perso en vue personnelle.
- **Liens profonds** : `#patrimoine/depenses?vue=perso|commun|tout&mois=AAAA-MM&categorie=<clé>`.

## 2. Contenu
- **Le mois choisi** (sélecteur, le dernier mois complet par défaut) :
  - total des dépenses ;
  - variation par rapport à la moyenne des 3 mois précédents, en euros et en % ;
  - **barres horizontales par catégorie**, triées de la plus grosse à la plus petite, avec le montant, la part du total et l'écart à la moyenne sur 3 mois ;
  - un clic sur une catégorie ouvre son détail.
- **Tendance sur 12 mois** (ou 24 avec l'historique importé) : barres empilées par catégorie (6 catégories, le reste regroupé en « autres »), avec la ligne des revenus et le taux d'épargne. Un clic sur un mois sélectionne ce mois.
- **Détail d'une catégorie** (panneau) :
  - sur 90 jours, d'après les opérations synchronisées : ses principaux postes, regroupés par libellé nettoyé (nombre, total, moyenne), et les prélèvements récurrents ;
  - au-delà de 90 jours, ou pour un compte importé : les totaux mensuels seuls, avec la mention « détail non conservé au-delà de 90 jours » ;
  - bouton « Demander à Claude » (« analyse mes dépenses de <catégorie> ») vers l'expertise budget-épargne.
- **Ce qui n'est jamais compté comme dépense** : virements entre tes comptes, versements d'épargne et d'investissement, apports au compte commun (vue Tout), remboursements de cartes à débit différé. Une ligne discrète l'indique, avec les montants exclus du mois.
- **Le loyer** apparaît dans « logement », du côté où il est payé (Commun pour Stéph).

## 3. Catégorisation propre à Boussole
Tant que Powens ne catégorise pas, tout arrive en « divers ». Ajouts :
- **Catégorisation de repli** (`supabase/functions/powens/categories.ts`) : une table de motifs versionnée, couvrant les grandes enseignes françaises et les libellés usuels (CB, PRLV, VIR). Catégories :
  - logement, énergie, internet et téléphone ;
  - alimentation (courses), restaurants et sorties ;
  - transport, santé, abonnements, achats, loisirs et voyages, enfants, impôts ;
  - assurances, frais bancaires, retraits, cadeaux et dons, divers.

  Elle s'applique quand la catégorie Powens est absente ou vaut « divers ». Elle est testée sur un jeu de libellés anonymisés.
- **Règles personnelles** : `config.regles_categories = [{ motif (texte, 3 à 60 caractères, sans chiffres longs), categorie }]`, 200 au plus.
  - Elles passent avant la table générique.
  - Outil MCP `regler_categorie({ motif, categorie })` : préférence sans montant, écrite directement après l'accord de l'utilisateur dans la conversation, comme `update_config`.
  - Une nouvelle règle reclasse les opérations des 90 derniers jours et recalcule les totaux des mois touchés.
- **Import d'historique (CP2)** : Claude utilise les mêmes catégories et les règles personnelles, qui lui sont fournies par l'outil.

## 4. Données
- Source par compte et par mois :
  - `banque_mois` par compte (migration 0025, en cours) pour les comptes synchronisés ;
  - sinon `budget_historique` (CP2), jamais les deux pour un même compte et un même mois.
- Titulaire de chaque source : `banque_comptes.titulaire` (`commun` possible, CP2) ou `budget_historique.titulaire`.
- Détail sur 90 jours : `banque_operations`, lisible par l'utilisateur.

## 5. Connecteur
- `lire_depenses({ vue?, mois?, depuis? })` (lecture) :
  - totaux par catégorie et par mois ;
  - principaux postes sur 90 jours ;
  - exclusions du mois ;
  - comparaison avec le budget prévu.
- La revue mensuelle commente les 3 plus gros écarts du mois par rapport à la moyenne.

## 6. Tests
- Calculs purs :
  - séparation Perso / Commun / Tout ;
  - exclusions : virements internes, épargne, apports au commun ;
  - moyennes et écarts ;
  - fusion entre `banque_mois` et `budget_historique`.
- Catégorisation de repli et règles personnelles : priorité, reclassement, refus d'un motif sensible.
- Vue : bascule, sélecteur de mois, barres, panneau, liens profonds, accessibilité (vrais boutons, tableaux de données), démo avec un compte commun.
- Connecteur : `lire_depenses`, `regler_categorie`.
