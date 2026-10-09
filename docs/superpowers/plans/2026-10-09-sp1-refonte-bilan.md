# Sous-projet 1 : plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec : `docs/superpowers/specs/2026-10-09-sp1-refonte-bilan.md`.

Prérequis : T4 (onglet Plan) et T5 (carte santé + MCP) du chantier 2 livrés et commités.

## Phase A (séquentielle, un agent) — coque
- **A1 Coque et routage** — `web/src/shell.html`, `web/src/app.js`, `web/src/theme.css`, `build.mjs`, `test/shell.test.mjs`. Espaces, sous-vues, barre latérale / barre basse, routage et anciens hash, périmètre et état de veille dans la barre, pastille Recommandations (via `headline` du module `actions`), cartes « Bientôt ». Les modules existants sont placés tels quels dans leurs sous-vues.

## Phase B (parallèle, après A1)
- **B1 Bilan** — `web/src/bilan.{js,html,css}`, `test/bilan.test.mjs` : vue d'ensemble complète (spec § Bilan), fonctions pures exportées pour les tests (`window.BilanCalc` ou `module.exports`).
- **B2 Extractions** — `web/src/pilotage.{js,html,css}` → retirer carte santé, panneau Alertes et Règles ; créer `web/src/sante.{js,html,css}` (carte santé en pleine page, détails dépliés par défaut), `web/src/regles.{js,html,css}` (règles d'alerte + matelas), `web/src/actions.{js,html,css}` (liste priorisée : règles `Rules.evaluate` + `Rules.builtins` + pistes `Plan.score` non pleines, gravité crit > warn > info > pistes, chaque entrée : titre, texte, lien vers la vue concernée ; `headline()` = nombre crit+warn) ; tests statiques (scopes CSS, enregistrement).

## Phase C
- Vérification visuelle complète en démo (ordinateur, 375 px, sombre), anciens liens, `npm test`, commit, push, CI verte.
