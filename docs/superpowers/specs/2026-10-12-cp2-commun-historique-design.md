# CP2 : titulaire « commun » partagé selon les apports, et import de l'historique en totaux mensuels

Date : 2026-10-12. Statut : validé par Stéph (« Go all »). Partage par défaut selon les apports réels, réglable.

## 1. Titulaire « commun »
- **Données (migration 0025 ; renuméroter si 0023 ou 0024 sont déjà pris par CP1)** :
  - `positions.owner` accepte `p1`, `p2` et `commun` ;
  - `banque_comptes.titulaire` accepte `p1`, `p2` et `commun` ;
  - `config.partage` (jsonb) = `{ mode: "apports" | "egal" | "fixe", p1: 0..1, maj_le, source }`. Valeur par défaut : `{ mode: "egal", p1: 0.5 }` tant qu'aucun réglage n'existe ;
  - `appliquer_propositions` : la cible `config` accepte la clé `partage`, validée (`p1` entre 0 et 1, mode connu). Repartir exactement de la définition de 0019.
- **Calculs (`web/src/calc.js` et le bloc de calcul pur d'`index.ts`, parité testée)** :
  - pour le périmètre `p1`, une ligne `commun` compte pour `val × partage.p1` ; pour `p2`, pour `val × (1 − partage.p1)` ; pour `foyer`, pour 100 % ;
  - même règle pour les lignes de budget `commun` et pour les crédits `commun`, quand ils existent ;
  - toutes les sommes par périmètre (`poche`, `parClasse`, `parLiquidite`, `patrimoine`, budget, Rang/toise, simulation) passent par une seule fonction `Calc.partDe(objet, scope, partage)`.
- **Connecteur** :
  - outil `regler_partage({ mode, p1? })` : il dépose une proposition `config` `{ partage }` et ne modifie rien directement ;
  - en mode `apports`, Claude calcule la part à partir des apports au compte commun vus dans les relevés : moyenne des 6 derniers mois, arrondie au point. Il l'explique avant de déposer ;
  - `update_profile`, `upsert_positions` et `update_budget` acceptent `owner: "commun"`.
- **App** :
  - un sélecteur de titulaire montre « Commun » partout où un titulaire s'affiche ;
  - Compte › Données affiche « Partage du commun : 60 % Camille, 40 % Sam (selon vos apports, réglé le JJ/MM) » avec « Modifier avec Claude » ;
  - les vues de chaque personne (ex. Camille) indiquent « dont N € de commun (60 %) ».
- **Powens** : un compte commun synchronisé reçoit `titulaire = commun` quand l'utilisateur le choisit, ou par rapprochement si son nom contient « joint » ou « commun ». Ses lignes créées automatiquement héritent de `owner = commun`.

## 2. Import de l'historique en totaux mensuels
- **Table `budget_historique`** (même migration) :
  - colonnes `(user_id, mois date (1er du mois), compte text (libellé court, ex. « LCL courant », « N26 », « Revolut commun »), titulaire p1|p2|commun, categorie, entrees numeric ≥ 0, sorties numeric ≥ 0, epargne numeric ≥ 0, nombre int, source text, importe_le)`, clé primaire `(user_id, mois, compte, categorie)` ;
  - RLS propriétaire ; écriture par le connecteur (jeton de l'utilisateur) ; aucune écriture par l'app ;
  - catégories : celles du budget Boussole, plus `epargne` et `virement_interne`. `virement_interne` sert seulement au contrôle : ces montants ne sont jamais comptés comme dépense ni comme revenu.
- **Outil MCP `importer_historique`** :
  - entrée : `{ compte, titulaire, mois: [{ mois: "AAAA-MM", categories: [{ categorie, entrees, sorties, nombre }] }], source, accord_utilisateur: true }` ;
  - écriture directe, comme le journal, après l'accord explicite de l'utilisateur dans la conversation. Ce ne sont que des totaux : jamais une opération, un libellé brut, un IBAN ni un numéro de compte (contrôle `contenu_sensible` et refus de toute chaîne longue de chiffres) ;
  - limites : 36 mois au plus par appel, 20 catégories par mois ;
  - un mois déjà importé pour ce compte est remplacé (upsert), ce qui rend l'import idempotent ;
  - réponse : un récapitulatif (mois, entrées, sorties, épargne, taux d'épargne).
- **Conduite d'import (`CONDUITE_IMPORT`, renvoyée par l'outil et par la revue)** :
  - repérer les virements entre les comptes de l'utilisateur (montants opposés à 3 jours près entre fichiers, ou « vir.permanent » vers un compte à son nom) et les classer en `virement_interne` ;
  - classer en `epargne` les versements vers ses placements (PEA, PER, assurance-vie, coffres) et les versements programmés ;
  - classer les apports au compte commun en `virement_interne` côté compte personnel, et en revenu du compte commun côté commun ;
  - le loyer va dans `logement` ;
  - montrer le récapitulatif avant d'écrire.
- **Budget réel (app et connecteur)** : pour chaque mois et chaque compte, on prend `banque_mois` (Powens) quand le compte est synchronisé ce mois-là, sinon `budget_historique`. Jamais les deux pour le même compte et le même mois. La correspondance se fait par libellé de compte et établissement, avec un réglage `compte_powens_id` facultatif pour rapprocher un compte importé d'un compte synchronisé.
- **Ce que l'utilisateur voit** :
  - Patrimoine › Budget : « Réel (moyenne 3 mois) » et une courbe sur 24 mois des entrées, sorties et épargne, avec le taux d'épargne ;
  - la fiche « compte courant » de Patrimoine › Comptes affiche l'historique importé.

## 3. Revue mensuelle
- Ajouter la source N26 au catalogue `SOURCES` : « app N26 → Relevés → relevé du mois (PDF) ou export CSV ».
- La revue propose `importer_historique` pour le mois écoulé des comptes non synchronisés : N26, Revolut commun.

## 4. Tests
- PGlite : contraintes `commun`, `config.partage` via les propositions, `budget_historique` (RLS, contrôles, upsert).
- Calculs purs : `partDe`, et les sommes par périmètre avec `commun` (parité entre l'app et le connecteur).
- Connecteur : `regler_partage`, `importer_historique` (accord, refus de données sensibles, limites, idempotence), conduite.
- App : sélecteur Commun, affichage du partage, budget réel fusionné (`banque_mois` ou `budget_historique`), courbe sur 24 mois, démo.
