# Entretien guidé avec Claude

Date : 2026-10-10 · Statut : validé par Stéph (mode discussion + formulaires essentiels ; Claude dépose des propositions à valider).

## Pourquoi

Remplir un bilan patrimonial à la main est long et décourageant. Un entretien guidé, comme chez un conseiller, donne de meilleures données : une question à la fois, relances, explications, extraction depuis des relevés collés. L'intelligence reste le Claude de l'utilisateur (aucun coût LLM pour Boussole).

## Principes

1. **Claude propose, l'utilisateur dispose.** Toute écriture de Claude (profil, budget, placements, biens, crédits, objectifs, réponses au profil de risque) devient une **proposition** en attente, avec avant / après, source et justification. Rien n'est appliqué sans validation dans le board. Exception : l'annotation d'un fonds (frais, zone, devise), donnée publique non personnelle, s'applique directement avec source obligatoire.
2. **Claude ne repose jamais une question déjà répondue.** Un état du bilan, calculé par un module pur partagé (app et connecteur), liste par section ce qui est complet, ce qui manque et l'ordre recommandé des questions.
3. **Formulaires réduits à l'essentiel** pour qui préfère cliquer ou n'a pas Claude : démarrage en 3 questions, questionnaire de risque en cartes, édition directe de toute donnée.
4. **Posture inchangée** : pédagogique, pas de recommandation de produit ; Claude n'invente aucun chiffre, cite sa source (« relevé PEA du 30/09 », « dit par l'utilisateur »).

## Composants

### 1. État du bilan (`web/src/bilan-etat.js`, pur, porté à l'identique dans le connecteur)
`etat(S)` → `{ pourcentage, sections: [{ cle, titre, statut: complet|partiel|vide, manquants: [{ champ, question, pourquoi }] }], prochaines: [3 questions], propositionsEnAttente }`.
Sections, dans l'ordre d'un entretien : Foyer (adultes, enfants, âge, TMI) · Revenus (salaires, statut, autres revenus) · Budget (dépenses par catégorie, épargne) · Épargne et placements (au moins une ligne ; montants à jour < 90 jours) · Immobilier et crédits (biens, crédits ; « aucun » est une réponse) · Protection (prévoyance, assurance emprunteur) · Objectifs (au moins un, avec date) · Profil de risque (10 réponses).
Chaque question manquante porte une formulation naturelle et un « pourquoi » d'une phrase.

### 2. Propositions (base)
Table `propositions` : `id, user_id, lot (uuid, une session de Claude), cible (profil|budget|position|bien|credit|objectif|risque|protection), operation (creer|modifier|supprimer), ref (id visé ou null), avant jsonb, apres jsonb, source text non vide, justification text, statut (en_attente|acceptee|refusee), cree_le, decide_le`. RLS par utilisateur. Fonction `appliquer_propositions(ids uuid[], modifications jsonb default '{}')` en *security invoker* (RLS s'applique) : applique dans une transaction, en tenant compte des valeurs modifiées par l'utilisateur, et passe les lignes à `acceptee` ; `refuser_propositions(ids)`. Purge des propositions décidées après 180 jours.

### 3. Connecteur MCP
- Les outils d'écriture existants (`update_profile`, `upsert_biens`, `upsert_credits`, `upsert_positions`, `update_budget`, `upsert_objectifs`, `record_transaction`, `delete_*`) créent des propositions au lieu d'écrire, avec `source` obligatoire, et répondent « Proposition déposée : à valider dans Boussole ». Nouveaux : `set_risk_answers`, `set_protection`, `etat_du_bilan`, `list_propositions` (en attente, pour éviter les doublons).
- **Prompts MCP** (parcours lançables depuis Claude) : `bilan_complet`, `profil_de_risque`, `budget`, `placements`, `revue_mensuelle`. Chacun fixe la conduite : appeler `etat_du_bilan`, une question à la fois, expliquer le pourquoi, accepter les relevés collés, récapituler avant de proposer, ne rien inventer, citer la source, rappeler que la validation se fait dans Boussole.

### 4. Board
- **Propositions** : bandeau global « Claude propose N changements — Examiner » ; vue `profil/propositions` : lots groupés par cible, différences avant → après, source et justification, cases à cocher, valeur modifiable avant validation, « Tout valider », « Valider la sélection », « Refuser ». Pastille dans la navigation.
- **Faire mon bilan avec Claude** : carte sur le Bilan tant que l'état < 100 % et page guide (Profil et données › Avec Claude) : jauge d'avancement par section, ajout du connecteur (URL à copier, étapes par client Claude), bouton « Ouvrir Claude » avec la demande pré-remplie (lien `claude.ai/new?q=` si accepté, sinon copie), liste des prochaines questions.
- **Questionnaire de risque en cartes** (avec le Diagnostic) : une question par écran, gros boutons, progression, retour, explication courte ; « Le faire avec Claude » en alternative.

## Tests
`bilan-etat` (sections, ordre, manquants, pourcentage) ; parité app ↔ connecteur sur l'état ; SQL : appliquer / refuser, isolation des propositions ; connecteur : aucune écriture directe hors annotation, source obligatoire ; interface : revue et validation en démo.
