# Saisie par l'agent : app en lecture seule, formulaires dynamiques dans Claude, tutoiement

Date : 2026-10-11 · Statut : décidé par Stéph (« les formulaires restent en back, accessibles au LLM seulement » ; « tout transite par le LLM, l'import de fichier et autre » ; « tutoiement »).

## Principe

Boussole devient un **cockpit en lecture seule**. Toute la saisie passe par l'assistant de l'utilisateur (Claude d'abord) :
- **formulaires dynamiques** composés par le LLM (questions, ordre, formulation, aides) et affichés **dans Claude** sous forme
  de composant interactif (MCP Apps), avec repli texte ;
- **imports de fichiers** (relevés bancaires, exports de courtier, avis d'imposition, tableaux d'amortissement) déposés
  dans la conversation : le LLM en tire les chiffres et dépose des propositions ;
- **questionnaires** (profil de risque…) idem.

L'app garde uniquement le **contrôle** : valider / corriger / refuser les propositions ; relire, confirmer, corriger, clore
les entrées du journal ; voir et effacer la mémoire ; consentement du journal ; bascule actif / inactif des règles ;
sécurité, export et suppression du compte. Les simulateurs (Rang, Scénarios) gardent leurs paramètres d'exploration
(non enregistrés). Partout où l'app permettait de saisir, elle propose **« Compléter avec Claude »**, qui ouvre Claude avec
une phrase prête activant l'agent Boussole sur la bonne section.

**Tutoiement partout** : app, agent (instructions, conduites, descriptions d'outils), formulaires, fiches du savoir.

## 1. Connecteur : formulaires dynamiques

### Catalogue des champs (source unique, généré)
`supabase/functions/mcp/catalogue.gen.ts`, produit par `scripts/gen-catalogue.mjs` à partir des sources de l'app
(`web/src/risque.js` pour `risque.*` ; `web/src/bilan-etat.js` et le schéma du profil pour `foyer.*`, `personnes.p1|p2.*`,
`protection.*`, `autres.*`). Un test échoue si le fichier généré n'est plus à jour. Chaque champ :
`{ champ, theme, type: choix|multi|curseur|montant|date|booleen|texte_court, valeurs?: [{ v, label, exclusif? }], min?, max?, pas?,
unite?, cible: profil|risque|protection, chemin }`. Première version : foyer (adultes, enfants, âge, TMI), revenus (salaire,
unité, statut, autres revenus par personne), protection (prévoyance, emprunteur), profil de risque (10 questions). Les entités
multiples (biens, crédits, objectifs, lignes de budget, positions) restent saisies par les outils d'écriture existants (une
proposition par élément), le LLM pouvant les collecter avec un formulaire de type « liste » dans une version ultérieure.

### Outil `formulaire` (visible du LLM)
Entrée : `{ titre, intro?, questions: [{ champ, libelle?, aide? }] (1 à 20) }`.
- Refuse tout `champ` hors catalogue (message clair avec la liste des champs proches).
- Complète chaque question avec le type, les valeurs et bornes du catalogue ; garde le libellé et l'aide du LLM (sinon ceux du
  catalogue) ; ajoute les **aides calculées** côté serveur à partir des vraies données, arrondies : `risque.perte_max`
  (baisse plausible sur un an et pire baisse historique du portefeuille réel), `risque.reaction` (−20 % en euros sur l'encours
  financier), `risque.part_investie` (part actuelle hors fonds euros et monétaire), `risque.horizon` (objectif d'achat qui
  mobilise la majorité de l'épargne et son échéance), `risque.matelas` (« hors placements » = épargne non destinée à être investie).
  Les aides informent, elles ne recommandent jamais une réponse.
- Pré-remplit **uniquement** les valeurs déjà validées dans Boussole (jamais de déduction).
- `_meta.ui.resourceUri = "ui://boussole/formulaire"`. Résultat : `content` texte (repli : questions numérotées, valeurs
  permises, aides) + `structuredContent` (formulaire complet pour le composant, identifiant de formulaire).

### Ressource `ui://boussole/formulaire`
`text/html;profile=mcp-app`, un seul fichier HTML/CSS/JS sans dépendance, protocole MCP Apps écrit à la main
(`ui/initialize`, `ui/notifications/initialized`, `ui/notifications/tool-result`, `tools/call`, `ui/update-model-context`,
`ui/notifications/size-changed`). Stepper : barre de progression, « Question N sur M », thème ; Précédente / Suivante, puis
« Envoyer mes réponses » ; erreur en ligne sans bloquer le bouton ; réponses conservées ; contrôles : choix unique pleine
largeur, choix multiple avec option exclusive, curseur (valeur affichée en grand, « 3 ans »), montant (clavier numérique),
date, oui/non. Thème clair/sombre (`hostContext.theme`, variables de l'hôte avec valeurs de secours), mobile 380 px, mention
« Indicateur pédagogique, pas un conseil en investissement. ». Logique (navigation, validation, exclusivité, bornes) dans un
module testable sous Node, injecté dans le HTML.

### Outil `soumettre_formulaire` (visibilité `["app"]`, invisible du LLM)
Entrée : `{ formulaire_id?, reponses: { [champ]: valeur } }`. Revalide chaque réponse contre le catalogue ; regroupe par cible ;
dépose les propositions dans **un seul lot** avec `source = "Saisi par l'utilisateur dans le formulaire interactif"` (mêmes
fonctions que `update_profile`, `set_risk_answers`, `set_protection`) ; renvoie le résumé, l'identifiant du lot et, si des
réponses de risque sont présentes, un **profil estimé** (port fidèle de `Risque.evaluer`, parité testée). Le composant affiche
la confirmation (« à valider dans Boussole › Agent › Propositions ») et envoie le résumé au LLM (`ui/update-model-context`).

### Imports de fichiers par le LLM
Conduite : quand l'utilisateur dépose un relevé, le LLM extrait, **agrège** (budget : totaux mensuels par catégorie, jamais les
lignes brutes ; placements : soldes, positions, opérations sur titres), retire tout identifiant (IBAN, numéros), récapitule,
puis dépose les propositions avec la source « Relevé … du … déposé par l'utilisateur ». Le formulaire sert à confirmer ou
compléter ce qui est ambigu.

### Instructions et prompts
- INSTRUCTIONS / conduite : « Dès que tu dois poser plusieurs questions (formulaire, questionnaire, données manquantes), utilise
  l'outil formulaire plutôt que des questions en texte. Ne réponds jamais à la place de l'utilisateur. Les aides informent, elles
  ne recommandent pas. Après l'envoi, résume ce qui a été proposé ; pour le profil de risque, résume le profil estimé et signale
  tout écart avec le risque réel du portefeuille. »
- Prompt MCP `completer_profil` (argument `section` : foyer, revenus, protection, risque, budget, placements, immobilier, objectifs).
- Tout au tutoiement.

## 2. App : lecture seule

- Retirer tous les formulaires de saisie : Compte › Données (sections en lecture seule avec résumé et « Compléter avec Claude »
  par section), Placements (« Modifier à la main », « Enregistrer un mouvement », « Ajouter à la main », import CSV),
  Budget (ajout / modification / suppression de lignes, dialogue assistant), Objectifs (ajout / modification / priorité /
  suppression), Règles (formulaire ; la bascule actif/inactif reste), épargne de précaution (réglage via Claude),
  questionnaire de risque (panneau supprimé), Accueil et onboarding (parcours « sans assistant » et formulaires supprimés),
  `import.js`.
- Module `web/src/claude-prompts.js` (pur, testé) : `phrase(section, contexte)` → phrase prête au tutoiement, par ex.
  « Boussole : aide-moi à compléter mon profil de risque. Commence par demarrer_session, puis utilise les formulaires
  interactifs Boussole. » ; `UI.demanderAClaude(phrase, "Compléter avec Claude")` partout.
- Les panneaux de détail restent (lecture), avec « Compléter avec Claude » / « Corriger avec Claude » contextuels.
- Écritures restantes côté store : propositions (appliquer / refuser / corriger), journal (confirmer / corriger / statuts /
  supprimer / consentement), mémoire (modifier / supprimer / tout effacer), règles (actif), compte. Les autres écritures du store
  sont retirées (ou conservées seulement pour l'application des propositions par la RPC).
- Tutoiement de tous les textes de l'app.

## 3. Fiches du savoir au tutoiement
Migration de contenu qui réécrit les 19 fiches au tutoiement (`version + 1`), validée sur PGlite.

## Tests
Catalogue généré à jour ; champ / valeur hors catalogue refusés (formulaire et soumission) ; « aucun » exclusif ; bornes du
curseur ; aucun pré-remplissage déduit ; regroupement par cible et lot unique ; parité du profil estimé ; aucune URL externe
dans le composant ; protocole MCP Apps (handshake, résultat, appel d'outil) avec un hôte simulé ; app : plus aucun formulaire de
saisie (test qui cherche `<form`, `<input` hors simulateurs et contrôles autorisés), boutons « Compléter avec Claude » ;
tutoiement (test qui cherche « vous » / « votre » dans les textes de l'app et du connecteur, avec liste d'exceptions).
