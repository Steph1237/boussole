# Sous-projet 2 : plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec : `docs/superpowers/specs/2026-10-10-sp2-diagnostic.md`.

## Phase 1 (parallèle, calcul pur, tests d'abord)
- **D1 Risque** — `web/src/marche.js` (statistiques historiques par classe d'actifs et cas particuliers — levier, sourcées), `web/src/risque.js` (questionnaire : questions, barème, garde-fous, 5 profils et allocations cibles ; risque réel : volatilité et baisse plausible du portefeuille, profil équivalent, écarts par classe), `test/marche.test.mjs`, `test/risque.test.mjs`.
- **D2 Bonnes pratiques** — `web/src/pratiques.js` : critères des 4 familles (Sécurité, Effort, Allocation, Efficacité), chacun `{cle, famille, titre, points, sur, valeur, cible, texte, piste, regle, source, aCompleter}`, score par famille et global ; réutilise `Plan.score` pour les 5 critères existants ; `test/pratiques.test.mjs`.

## Phase 2 (après D1 + D2)
- **D3 Données** — migration `0005_diagnostic.sql` (`profiles.risque jsonb`, `profiles.classes jsonb`, `instruments.ter numeric`, `instruments.zone text`, `instruments.devise text`, `instruments.annote_source text`, `instruments.annote_le timestamptz`), stores (S.risque, S.classes, positions enrichies de ter/zone/devise), MCP : outil `annotate_instrument` + `get_overview` enrichi (profil de risque, bonnes pratiques) + correctif du libellé « Pilotage », redéploiement.
- **D4 Interface** — Diagnostic › Profil de risque (questionnaire pas à pas, résultat, allocation cible vs réelle, profil équivalent, rattachement poche → classe modifiable) ; Diagnostic › Santé devient « Bonnes pratiques » (4 familles) ; mise à jour du Bilan (cellule Profil de risque) et des Actions (pistes des bonnes pratiques).

## Phase 3
Vérification complète (démo, mobile, sombre), CI, déploiement.
