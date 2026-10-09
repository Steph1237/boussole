# Boussole, chantier 2 : budget, objectifs, projection, score de santé

Date : 2026-10-09 · Statut : lancé sur consigne de Stéph (« continue d'améliorer l'outil »), mêmes pratiques que le chantier 1.

## Pourquoi

L'outil suit le **stock** (patrimoine) et aide à **une** décision (acheter ou placer). Il manque les **flux** (ce qui entre et sort chaque mois) et la **trajectoire** (où en serai-je, vais-je atteindre mes objectifs). Ce sont les deux leviers qu'un conseiller en gestion de patrimoine regarde en premier.

## Périmètre

1. **Budget mensuel** : revenus, dépenses par catégorie, épargne. Le salaire et les mensualités de crédit viennent du Profil (pastille « réel »), le reste se saisit. Indicateurs : reste à vivre, taux d'épargne, matelas en mois de dépenses.
2. **Objectifs datés** : apport immobilier, matelas, retraite, projet libre. Chacun a une cible, une date, un montant déjà mis de côté (saisi, ou rattaché à des poches / enveloppes du Pilotage) et un rendement attendu. Calcul : effort mensuel requis, statut en avance / dans les temps / en retard, date d'atteinte au rythme actuel.
3. **Projection** du patrimoine financier sur 5, 10, 20, 30 ans, trois scénarios (pessimiste, central, optimiste), à partir de l'épargne mensuelle du budget (ou des versements programmés si le budget est vide) et de rendements par poche.
4. **Score de santé** sur 100, cinq ratios standards de 20 points chacun, chacun expliqué en une phrase avec la piste d'amélioration :
   - matelas de précaution en mois de dépenses (cible 3 à 6 mois) ;
   - taux d'épargne (cible ≥ 15 % des revenus nets) ;
   - taux d'endettement (≤ 35 %, norme HCSF) ;
   - concentration (aucune ligne > 20 % du financier, au moins 3 poches) ;
   - patrimoine net rapporté aux revenus annuels, comparé au repère par âge (1× à 30 ans, 3× à 40, 6× à 50, 8× à 60).
   Mention permanente : indicateur pédagogique, pas un conseil en investissement.

## Interface

- Nouvel onglet **Plan** (entre « Acheter ou placer » et « Profil ») : Budget en haut, Objectifs ensuite, Projection en bas. Chiffre clé de l'onglet : taux d'épargne.
- **Score de santé** : carte en tête du Pilotage (score, 5 jauges, lien vers le détail), recalculée en direct.
- Remplissage par assistant pour le budget (même mécanique que le Profil : prompt, collage, aperçu, application au brouillon).
- Connecteur MCP : outils `get_budget`, `update_budget`, `list_objectifs`, `upsert_objectifs`, `delete_objectif`, et `get_overview` enrichi du score.

## Données

Migration `0004_plan.sql` :
- `budgets` (user_id PK, lignes jsonb `[{id, type: revenu|depense|epargne, categorie, libelle, montant, frequence: mois|an}]`, updated_at) ;
- `objectifs` (id uuid, user_id, nom, type `apport|matelas|retraite|projet`, cible ≥ 0, date_cible, deja ≥ 0, source `saisi|poches`, poches text[], enveloppes text[], rendement numeric (% / an), priorite int, created_at, updated_at).
RLS identique au chantier 1 (`(select auth.uid()) = user_id`), cascade à la suppression du compte, inclus dans `export_all()`, tests d'isolation étendus.

Store : `S.budget` (lignes), `S.objectifs` ; façade `db.doc("budget/main").set({lignes})`, `db.collection("objectifs").upsert(row)`, `db.doc("objectifs/<id>").delete()`.

## Calculs (`web/src/plan.js`, pur, testé)

- `budgetTotaux(lignes, profil, scope)` : revenus (profil + lignes revenu), dépenses (lignes + mensualités du profil), épargne explicite, reste = revenus − dépenses − épargne ; taux d'épargne = (épargne + reste positif) / revenus.
- `effortMensuel(cible, deja, mois, tauxAnnuel)` : versement constant de fin de mois (formule d'annuité ; taux nul → linéaire).
- `dateAtteinte(cible, deja, versement, tauxAnnuel)` : premier mois où la valeur capitalisée atteint la cible, ou null si jamais (horizon 60 ans).
- `projection(capitalParPoche, versementMensuel, rendements, annees)` : 3 scénarios, valeur fin de chaque année ; rendements par défaut (central / pessimiste / optimiste, % par an) : Monde 6/3/8,5 · Europe 5,5/2,5/8 · Asie 6/2/9 · Nasdaq 2x 9/−2/16 · Convictions tech 7/0/12 · Crypto 5/−20/25 · SCPI 4/2/5 · Protection 2,5/1,5/3,5 · Obligations 3/1,5/4 · Épargne 2,4/1,7/3 · autre 4/1,5/6 ; versements répartis comme le portefeuille actuel.
- `score(ctx)` : `{total, items:[{cle, points, sur, valeur, cible, texte, piste}]}` ; données manquantes → item « à compléter », exclu du total qui est alors ramené sur 100.

## Fiabilité (en parallèle)

Cours de secours : si Yahoo échoue pour un instrument coté à Paris, Amsterdam ou Bruxelles, la fonction nocturne interroge Euronext (`live.euronext.com/en/ajax/getDetailedQuote/{ISIN}-{MIC}`) ; source enregistrée dans `instruments.source`.

## Hors périmètre

Import de relevés bancaires et catégorisation automatique, fiscalité détaillée, retraite par régime, protection et transmission : chantier 3.
