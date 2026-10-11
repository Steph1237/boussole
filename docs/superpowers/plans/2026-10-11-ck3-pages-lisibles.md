# CK3 : pages lisibles — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Spec :** `docs/superpowers/specs/2026-10-10-cockpit.md` § Principe (règles 1-9) et § CK3 en détail. Dépôt `/Users/stephane/boussole`.
Composants : `web/src/ui.js` (API en tête du fichier). Modèles de pages déjà refaites : `web/src/aujourdhui.*`, `web/src/journal-view.*`.
Aucun moteur de calcul ne change. Tests : `npm test` ; build : `node build.mjs`.

## Vague 1 (fichiers disjoints)
- **A. Placements** — `web/src/pilotage.{html,css,js}`, `test/pilotage*.test.mjs` (créer `test/pilotage.test.mjs` si absent).
- **C. Budget + Objectifs** — `web/src/plan-view.{html,css,js}` (budget seul), nouveau `web/src/objectifs-view.{html,css,js}`, `test/plan-view.test.mjs`, nouveau `test/objectifs-view.test.mjs` ; navigation : `web/src/app.js` (SPACES Patrimoine = placements · immobilier · budget · objectifs ; LEGACY), `web/src/shell.html`, `build.mjs`, `test/shell.test.mjs`. Seul agent autorisé à toucher app.js / shell.html / build.mjs dans cette vague.
- **D. Santé + Risque** — `web/src/sante.{html,css,js}`, `web/src/risque-view.{html,css,js}`, leurs tests.

## Vague 2
- **B. Immobilier et crédits** — `web/src/bilan.{html,css,js}` + test ; composition « Ce que je possède, ce que je dois » ajoutée au panneau Patrimoine net de `web/src/aujourdhui.js`.
- **E. Rang** — `web/src/toise.{html,css,js}` + tests.
- **F. Compte** — `web/src/profil.{html,css,js}`, `web/src/regles.{html,css,js}` + tests (ancres de section `#compte/donnees?section=biens` via `App.parametres()`).

## Pour chaque tâche
TDD (fonctions pures exportées et testées : regroupements, verdicts, résumés), échappement de tout texte, CSS scopé `#view-<module>` (+ `.ui-panneau .<préfixe>-…` pour le contenu des panneaux), états vide / chargement / erreur, « Demander à Claude » contextuel, aucune régression des fonctions existantes (formulaires conservés derrière « Modifier à la main »), vérification navigateur en démo (ordinateur, mobile 375 px, clair, sombre, clavier) dans un onglet à soi, serveur arrêté et viewport remis à la fin. Pas de git add ni de commit ; le contrôleur commite après revue.
