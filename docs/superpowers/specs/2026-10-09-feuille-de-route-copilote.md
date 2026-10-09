# Boussole copilote : feuille de route

Date : 2026-10-09 · Statut : validé par Stéph (posture, agents, structure, ordre).

## Vision

Passer d'un tableau de suivi à un copilote financier : **bilan réel → diagnostic → décisions → avenir → recommandations**, le tout imbriqué, explicable, et enrichi par une veille faite par le Claude de chaque utilisateur.

## Décisions structurantes

1. **Posture pédagogique et explicable.** Les recommandations portent sur les comportements, les classes d'actifs et les enveloppes (« reconstituez votre matelas », « votre exposition actions dépasse votre profil », « remplissez d'abord votre PEA »), jamais sur un produit précis à acheter ou vendre. Chaque piste affiche la règle, les chiffres et les sources. Mention permanente : outil pédagogique, pas un conseil en investissement au sens de l'AMF (pas de statut CIF).
2. **Intelligence = le Claude de l'utilisateur.** Aucun appel LLM payé par Boussole. Le calcul (bilan, scores, projections, crises, recommandations à règles) tourne dans l'application, gratuitement, pour tous. La veille (fonds détenus, taux, marchés, signaux) est faite par le Claude de l'utilisateur via le connecteur MCP, qui écrit ses trouvailles dans le board.
3. **Routine imposée par contrat.** `get_routine` fournit les étapes obligatoires et le format attendu ; `submit_routine_report` refuse un rapport incomplet (sections manquantes, signal sans source, date absente) en listant ce qui manque. Le board suit la fraîcheur de la veille (dernier rapport valide) et alerte au-delà de 8 jours. Boussole fournit la routine prête à installer (instructions + planification) ; elle ne peut pas déclencher le Claude de l'utilisateur elle-même.
4. **Données de marché historiques embarquées et sourcées** (rendements et volatilités par classe d'actifs, crises de référence) ; pas de recherche en direct côté Boussole.

## Structure (5 espaces + Profil)

| Espace | Question | Contenu |
|---|---|---|
| Bilan | Où j'en suis ? | Patrimoine net (actifs / dettes), flux du mois, allocation réelle par classe, liquidité, historique ; sous-vue Placements (positions, journal, saisie, import) |
| Diagnostic | Est-ce sain ? | Profil de risque (questionnaire type MiFID) et écart avec l'allocation réelle ; ~12 bonnes pratiques notées ; rang parmi les Français (Toise) |
| Décisions | Que se passe-t-il si… ? | Acheter ou louer ; rembourser ou placer ; PER ou assurance-vie ; investir d'un coup ou progressivement ; changer d'allocation |
| Avenir | Où vais-je ? | Budget et objectifs (Plan), simulation Monte-Carlo sur historique, tests de crise sur l'allocation réelle, probabilité d'atteindre chaque objectif |
| Recommandations | Que faire ? | Actions priorisées par impact, signaux et opportunités de la veille, statut de la routine |
| Profil et données | — | Foyer, revenus, immobilier, crédits, règles d'alerte, connecteur, export |

Navigation latérale sur ordinateur, barre en bas sur mobile. Sélecteur de périmètre (foyer / personnes) global.

## Sous-projets (dans cet ordre, chacun livré utilisable)

1. **Refonte de l'interface + Bilan** — nouvelle coque à 5 espaces, rangement des modules existants, page Bilan.
2. **Diagnostic** — questionnaire de profil de risque, allocation cible, moteur de bonnes pratiques (extension du score de santé), Toise intégrée.
3. **Avenir** — Monte-Carlo (rendements et volatilités historiques, corrélations simplifiées), 5 crises de référence (2000-2002, 2008, 2020, 2022, inflation 1973-1974), probabilité d'atteinte des objectifs.
4. **Décisions** — nouveaux simulateurs au même format que « Acheter ou louer ».
5. **Recommandations et kit agent** — moteur de recommandations (règles priorisées, impact chiffré), table `signaux`, contrat de routine MCP, page d'installation de la routine, suivi de fraîcheur.

Chaque sous-projet : spec courte, plan, tests d'abord pour les calculs, agents en parallèle sur fichiers disjoints, vérification visuelle (démo, mobile, sombre), CI verte.
