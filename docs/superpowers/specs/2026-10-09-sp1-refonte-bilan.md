# Sous-projet 1 : refonte de l'interface et Bilan

Date : 2026-10-09 · Statut : validé par Stéph. Feuille de route : `2026-10-09-feuille-de-route-copilote.md`.

## Coque

- Ordinateur (≥ 900 px) : barre latérale collante de 220 px. Haut : logo « Boussole ». Milieu : Bilan, Diagnostic, Décisions, Avenir, Recommandations (pastille = nombre d'actions « à traiter »), puis Profil et données. Bas : sélecteur de périmètre (Foyer / prénoms), état de la veille (« Veille : jamais lancée » / « il y a 3 j » / alerte au-delà de 8 j — lit `S.status.veille` si présent, sinon « jamais lancée »), lien Mon compte, bandeau démo le cas échéant.
- Mobile : en-tête compact (logo, périmètre, menu compte/profil) ; barre d'onglets fixée en bas (5 icônes + libellé court), `padding-bottom: env(safe-area-inset-bottom)`.
- Chaque espace a des sous-onglets (segmented control en tête de page). Routage par hash `#espace/sous-vue` ; anciens hash conservés : `#pilotage`→`#bilan/placements`, `#position|#foyer|#salaire|#patrimoine|#emprunt`→`#diagnostic/rang`, `#acheter|#simulateur`→`#decisions/acheter`, `#plan|#budget|#objectifs`→`#avenir/plan`, `#profil`→`#profil/donnees`. Dernière vue mémorisée (localStorage).
- Contrat de module inchangé (`App.register(name, {mount, update(S, visible), show, headline})`). La coque gère espaces et sous-vues ; un module est visible quand sa sous-vue est active.

## Rangement

| Espace › sous-vue | Module | Statut |
|---|---|---|
| Bilan › Vue d'ensemble | `bilan` (nouveau) | ce sous-projet |
| Bilan › Placements | `pilotage` (sans carte santé, sans alertes ni règles) | déplacé |
| Diagnostic › Santé | carte santé (aujourd'hui dans `pilotage`) → module `sante` | extrait |
| Diagnostic › Rang parmi les Français | `toise` | déplacé |
| Décisions › Acheter ou louer | `simu` | déplacé |
| Avenir › Budget et objectifs | `plan` (vue `plan-view`) | déplacé |
| Recommandations › Actions | `actions` (nouveau, provisoire) : alertes des règles + pistes du score, triées par gravité | ce sous-projet |
| Profil et données › Données | `profil` | déplacé |
| Profil et données › Règles | règles d'alerte et matelas (extraits de `pilotage`) → module `regles` | extrait |

Les espaces sans contenu encore (Diagnostic › Profil de risque, Avenir › Projections, Décisions › autres simulateurs) affichent une carte « Bientôt » décrivant ce qui arrive ; pas de sous-onglet vide.

## Bilan › Vue d'ensemble (`bilan`)

1. Chiffres clés : patrimoine net, financier en direct (Δ 30 jours), épargne du mois (budget), matelas en mois de dépenses, score de santé (lien Diagnostic), profil de risque (« À définir » → lien).
2. Ce que je possède / ce que je dois : barre empilée (financier, immobilier, autres actifs, dettes) + tableau (financier par enveloppe, chaque bien, autres actifs, chaque dette, total net). Périmètre respecté.
3. Flux du mois : revenus → dépenses par catégorie / crédits / épargne / reste, en barres horizontales proportionnelles (pas de sankey) ; budget vide → invitation « Remplir mon budget » (lien Avenir › Budget).
4. Allocation : trois vues commutables — par classe (`Calc.parClasse`, libellés `Calc.CLASSES_LABELS`), par enveloppe, par liquidité (`Calc.parLiquidite`, `Calc.LIQUIDITE_LABELS`) ; barres + pourcentages ; l'immobilier physique du profil s'ajoute à la classe Immobilier et à « Bloqué ».
5. Évolution : courbe du financier (snapshots) + net estimé (snapshot financier + immobilier − dettes actuels) avec point du jour.
6. À traiter : 3 premières entrées du module `actions`, lien « Tout voir ».

## Design

Mêmes tokens (thème actuel). Espace de travail max 1180 px à droite de la barre. Cartes par rôle, pas de carte partout ; titres de section en Schibsted 16 px ; chiffres en IBM Plex Mono. Icônes : SVG inline simples (pas de dépendance). Clair et sombre, 375 px sans défilement horizontal, focus visible, navigation clavier dans la barre et les sous-onglets.

## Tests

`test/shell.test.mjs` : table de routage (anciens hash), chaque module enregistré a une place, CSS des nouveaux modules scopé. `test/bilan.test.mjs` : fonctions pures de la vue (agrégats patrimoine par catégorie, flux, allocation avec immobilier physique) sur les données de démo. Tests existants verts. Vérification visuelle démo complète.
