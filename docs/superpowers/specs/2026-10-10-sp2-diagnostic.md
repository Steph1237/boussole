# Sous-projet 2 : Diagnostic 

Date : 2026-10-10 · Statut : validé (« continue sur le produit », 2026-10-10).

## 1. Profil de risque

Questionnaire d'une dizaine de questions, inspiré du questionnaire d'adéquation MiFID II (connaissances, expérience, situation financière, objectifs, tolérance aux pertes), rempli une fois et révisable. Une personne ou le foyer.

| Thème | Question type | Poids |
|---|---|---|
| Horizon | Dans combien de temps aurez-vous besoin de la majeure partie de cet argent ? (< 2 ans … > 15 ans) | fort |
| Objectif | Préserver · compléter des revenus · faire croître · maximiser à long terme | moyen |
| Réaction | Votre portefeuille perd 20 % en 3 mois : vous vendez tout · une partie · ne faites rien · renforcez | fort |
| Perte maximale | Perte temporaire acceptable sur un an : 5 % · 10 % · 20 % · 35 % · plus | fort |
| Connaissances | Livrets / fonds euros / ETF / actions / obligations / crypto / produits à levier (cases) | moyen |
| Expérience | Depuis combien d'années investissez-vous en bourse ? | faible |
| Stabilité des revenus | Fonctionnaire / CDI / indépendant / revenus variables / sans revenu | moyen |
| Matelas | Avez-vous 3 mois de dépenses disponibles hors placements ? (prérempli depuis le Bilan) | garde-fou |
| Part investie | Part du patrimoine financier que vous acceptez d'exposer aux marchés | moyen |
| Âge | Prérempli depuis le Profil | faible |

Résultat : **5 profils** (Prudent, Modéré, Équilibré, Dynamique, Offensif) avec, pour chacun, une **allocation cible indicative** par classe et une **perte maximale tolérée** :

| Profil | Actions | Obligations | Fonds euros / monétaire | Immobilier | Spéculatif (crypto, levier) | Perte max tolérée |
|---|---|---|---|---|---|---|
| Prudent | 10–20 % | 20–30 % | 50–70 % | 0–10 % | 0 % | −5 % |
| Modéré | 25–40 % | 20–30 % | 30–45 % | 5–15 % | 0–2 % | −12 % |
| Équilibré | 45–60 % | 15–25 % | 15–30 % | 5–15 % | 0–5 % | −20 % |
| Dynamique | 60–80 % | 5–15 % | 5–15 % | 5–15 % | 0–7 % | −30 % |
| Offensif | 75–95 % | 0–10 % | 0–10 % | 0–10 % | 0–10 % | −40 % |

Garde-fous : horizon < 2 ans ou matelas absent plafonnent le profil à Modéré, quelles que soient les autres réponses (règle « pas d'argent nécessaire à court terme sur les marchés »).

## 2. Risque réel du portefeuille

Table embarquée et sourcée de statistiques historiques par classe (volatilité annuelle, pire baisse observée, pire année), par exemple : actions monde ≈ 15 % / −55 % (2007-2009) ; ETF Nasdaq 2x ≈ 45 % / −85 % ; obligations euro ≈ 5 % / −17 % (2022) ; fonds euros ≈ 0 % / 0 % ; SCPI ≈ 6 % / −20 % ; or ≈ 15 % / −45 % ; crypto ≈ 70 % / −80 %. Calcul de la volatilité et de la baisse plausible du portefeuille (corrélations simplifiées), puis **profil équivalent** du portefeuille réel et écart avec le profil déclaré (« votre portefeuille se comporte comme un profil Offensif, vous êtes Dynamique »). Rattachement poche → classe modifiable (corrige par exemple « Protection » qui mélange fonds euros et or).

## 3. Bonnes pratiques notées (extension du score de santé)

Chaque critère : note, valeur, cible, explication, piste, règle et source visibles. Groupés en 4 familles.

**Sécurité** : matelas 3 à 6 mois · assurance emprunteur et prévoyance si crédit ou enfants (déclaratif) · liquidité suffisante pour les objectifs à moins de 2 ans.
**Effort** : taux d'épargne ≥ 15 % · endettement ≤ 35 % (HCSF) · apport ≥ 10 % du prix + frais de notaire pour un projet immobilier (si objectif Apport).
**Allocation** : adéquation au profil de risque (écart par classe) · concentration (ligne ≤ 10–20 %) · diversification géographique (part « monde » vs pays unique, biais domestique) · spéculatif (crypto + levier ≤ plafond du profil) · exposition hors euro (informatif).
**Efficacité** : frais moyens pondérés des fonds (TER ; renseignés par le Claude de l'utilisateur via le connecteur, sinon « inconnu ») · ordre des enveloppes (PEA avant compte-titres pour les actions européennes, assurance-vie > 8 ans pour l'abattement, PER pertinent si TMI ≥ 30 %) · argent dormant (> 12 mois de dépenses sur livrets alors que l'horizon est long).

Score global sur 100 = moyenne pondérée des familles ; détail par famille. Le patrimoine net par âge et le rang INSEE restent dans « Rang parmi les Français ».

## 4. Interface

Diagnostic › Santé devient « Bonnes pratiques » (4 familles, critères dépliables) ; Diagnostic › Profil de risque : questionnaire pas à pas, résultat, allocation cible vs réelle (barres doubles), profil équivalent du portefeuille ; Rang parmi les Français inchangé.

## 5. Données

`profiles.risque` (jsonb : réponses, profil, date) ; `profiles.classes` (surcharges poche → classe) ; `instruments.ter`, `instruments.devise_expo`, `instruments.zone` renseignables par le connecteur (outil `annotate_instrument`, avec source).
