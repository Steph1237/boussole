# Onboarding : connecter son assistant, puis l'entretien avec l'agent expert

Date : 2026-10-10 · Statut : validé par Stéph (Claude d'abord ; ChatGPT plus tard par identité publiée ; pas d'enregistrement dynamique).

## Objectif

Un nouvel utilisateur connecte son assistant (Claude au lancement) à Boussole en quelques minutes, puis l'agent expert en patrimoine, porté par le connecteur, mène l'entretien d'onboarding depuis cet assistant. Les réponses arrivent comme propositions à valider dans le board.

## Sécurité (décidée)

- Pas d'enregistrement dynamique de clients OAuth (risque d'hameçonnage).
- Claude : client OAuth **déclaré à l'avance et public** (PKCE, sans secret), même identifiant pour tous les utilisateurs, affiché avec un bouton « Copier » (`window.BOUSSOLE.claude.clientId`).
- ChatGPT : emplacement « Bientôt » ; arrivera par identité publiée (CIMD), via Supabase ou une porte d'entrée Boussole qui n'accepte que les identités publiées par claude.ai et chatgpt.com.
- Clé personnelle Boussole : plus tard, pour les assistants locaux.

## Parcours dans le board (première connexion, et à tout moment depuis Profil › Avec Claude)

1. **Bienvenue** (1 écran) : ce que fait Boussole en 3 lignes ; posture (pédagogique, pas de conseil réglementé) ; confidentialité (données privées, réponses qui transitent par l'assistant choisi selon ses conditions) ; principe « Claude propose, vous validez » ; durée (~15 min, interruptible).
2. **Choisir son assistant** : Claude (disponible) · ChatGPT (bientôt) · « Je n'utilise pas d'assistant » → premiers pas en formulaires existants.
3. **Connecter Claude** : étapes numérotées par client (claude.ai / Claude Desktop ; Claude Code en option), valeurs à copier (nom, URL du connecteur, identifiant client), choix exacts à cocher (« Se connecter maintenant », « Utiliser votre propre client OAuth », secret vide), pièges courants (ne pas mettre son e-mail comme identifiant), puis **voyant en direct** : « En attente de connexion… » → « Claude est connecté » dès le premier appel authentifié.
4. **Lancer l'entretien** : phrase à copier « Lance l'onboarding Boussole » + bouton qui ouvre claude.ai avec la phrase ; ce que l'agent va faire.
5. **Suivre et valider** : jauge du bilan et propositions en attente en direct ; lien vers la revue ; fin : premiers résultats (Bilan, Diagnostic) et prochaines étapes.
Comptes anonymes : sécuriser le compte d'abord (déjà en place).

## Agent expert (connecteur)

- Outil `demarrer_onboarding` (fonctionne même sur les clients qui n'affichent pas les prompts MCP) : renvoie la feuille de conduite complète + l'état du bilan + les prochaines questions + les propositions en attente. Prompt MCP `onboarding` équivalent.
- Feuille de conduite (persona « conseiller en gestion de patrimoine pédagogue ») : se présenter, rappeler confidentialité et validation dans Boussole ; demander l'accord pour commencer et la durée disponible ; suivre l'ordre de l'état du bilan ; **une question à la fois**, avec le « pourquoi » ; reformuler et confirmer les chiffres ; accepter les relevés collés (extraire, résumer, confirmer) ; expliquer les notions au passage en une phrase ; **déposer les propositions à la fin de chaque section** (un lot par entretien) ; ne jamais demander identifiants bancaires, IBAN, numéros de compte, mots de passe ; ne jamais inventer ; pas de recommandation de produit ; interruption et reprise à tout moment (l'état du bilan sert de mémoire) ; conclure par une première lecture (2-3 points d'attention issus de `get_overview`, par ex. part spéculative) et rappeler de valider les propositions.
- Détection de connexion : table `connexions_assistant` (user_id, client_id, client_nom, premier_le, dernier_le), écrite par le connecteur à chaque appel authentifié (une écriture au plus toutes les 5 minutes par client), lisible par l'utilisateur ; exposée au board (`S.connexions`).

## Tests

Connecteur : `demarrer_onboarding` renvoie conduite + état ; règle « jamais d'identifiants bancaires » présente ; écriture de connexion limitée ; port du score honnête (`total` null sous 3 critères, `provisoire` des bonnes pratiques). Board : parcours 5 étapes, voyant qui passe à « connecté » quand `S.connexions` contient un client, copie des valeurs, démo, mobile, sombre.
