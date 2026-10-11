# RT1 : routines obligatoires des agents (revue mensuelle), activées à l'onboarding

Date : 2026-10-11 · Statut : demandé par Stéph (« routines des agents obligatoires pour chaque personne, en auto, activées lors de
l'onboarding ; routine mensuelle pour demander des nouvelles du portefeuille : nouveaux flux et autres »).

## Contraintes
- Boussole ne paie aucune IA et ne peut pas déclencher le Claude de l'utilisateur. Les **tâches planifiées de Claude** exécutent
  un prompt enregistré à intervalle régulier sur les serveurs d'Anthropic et peuvent utiliser les connecteurs distants du compte
  (donc Boussole) ; chaque exécution repart de zéro (la continuité vient de Boussole : mémoire, journal, état du bilan). Boussole
  ne peut ni créer la tâche ni vérifier qu'elle existe.
- Une exécution planifiée tourne sans l'utilisateur : elle prépare, elle ne questionne pas en direct.
- « Obligatoire » = **activée par défaut** à l'onboarding (pause possible) + **contrat côté serveur** qui sait quand la revue est due
  et la réclame (Aujourd'hui, `demarrer_session`), qu'une tâche planifiée existe ou non.

## 1. Données (migration `0018_routines.sql`)
`routines` (privée, RLS propriétaire) : `user_id`, `type` (`revue_mensuelle` en RT1 ; extensible : `veille_hebdo`, `revue_decisions`),
`jour` (1-28, jour du mois), `active` bool, `consentement_journal` bool (la revue est déposée au journal sans redemander, toujours
« à relire »), `cree_le`, `dernier_passage` timestamptz, `dernier_client` text, `prochain_passage` date (calculé), `questions`
jsonb (questions du mois en attente de l'utilisateur : `[{ champ?, question, pourquoi }]`), `synthese` text (≤ 4 000, dernière
synthèse), primaire `(user_id, type)`. RPC `cloturer_routine` (security invoker) qui enregistre un passage et calcule le suivant.
`export_all()` + `routines`.

## 2. Connecteur
- `activer_routine({ type, jour?, consentement_journal? })` : crée ou réactive la routine (défaut : le 1er du mois, consentement
  journal oui), renvoie **le prompt exact de la tâche planifiée** à coller dans Claude (« Tâches planifiées »), la fréquence
  conseillée et les étapes, au tutoiement. Prompt type : « Boussole : fais ma revue mensuelle. Appelle demarrer_routine avec le
  type revue_mensuelle et suis la conduite qu'il renvoie. »
- `demarrer_routine({ type })` (lecture) : conduite de la routine + ce qui a changé depuis le dernier passage : patrimoine et
  variation, soldes de plus de 30 jours, écarts au budget (si le budget existe) et aux objectifs (statuts), alertes, revues de
  décisions dues (journal), nouveautés du savoir, propositions en attente, questions du mois précédent restées sans réponse.
  Conduite : rédiger une synthèse courte (5 points au plus), préparer les **questions du mois** (nouveaux flux : versements,
  achats, ventes, retraits, changement de salaire, nouveaux prélèvements ou abonnements ; soldes à confirmer ; relevés à déposer),
  ne rien écrire dans le bilan sans l'utilisateur, appeler `cloturer_routine`.
- `cloturer_routine({ type, synthese, questions })` : enregistre le passage (client, date), mémorise synthèse et questions, dépose
  au journal une entrée `revue` « à relire » si `consentement_journal` (sinon selon le consentement du journal), renvoie le
  prochain passage.
- `demarrer_session` : + `routines` (état, prochain passage, en retard de N jours, questions en attente) ; conduite : si une revue
  est due ou si des questions attendent, le proposer en premier (formulaire dynamique pour les questions).
- `CONDUITE_ONBOARDING` : étape finale « Revue mensuelle » : expliquer en deux phrases, proposer l'activation (activée par défaut,
  l'utilisateur peut refuser ou choisir le jour), appeler `activer_routine`, guider la création de la tâche planifiée avec le prompt.
- Prompt MCP `revue_mensuelle` mis à jour pour passer par `demarrer_routine` (déclenchement manuel identique).

## 3. App
- **Aujourd'hui** (boîte de réception) : « Ta revue du mois est prête : N questions » (urgence 1, bouton « Répondre avec Claude »,
  phrase `ClaudePrompts.phrase("revue")` + contexte) ; « Revue mensuelle en retard de N jours » si `prochain_passage` dépassé sans
  passage (urgence 2, « Lancer ma revue avec Claude ») ; « Active ta revue mensuelle » si aucune routine (urgence 3).
- **Agent › Connexion** : section « Routines » : état (active / en pause / jamais passée), dernier et prochain passage, client,
  bascule pause (écriture autorisée), prompt de la tâche planifiée avec bouton « Copier », étapes pour Claude.
- **Accueil** (première connexion) : l'étape de fin affiche le voyant de la routine (« Routine active — prochaine le … » dès le
  premier passage).
- Store : `S.routines`, `Store.routines.pause(type, bool)`.

## 4. Tests
PGlite (RLS, `cloturer_routine` : prochain passage, jour 1-28, idempotence par jour), connecteur (activer → prompt ; demarrer →
données de la démo ; clôturer → journal selon consentement ; demarrer_session signale le retard), app (boîte de réception :
prête / en retard / à activer ; section Routines ; pause), tutoiement.

## Suite
Veille hebdomadaire et revue des décisions à leur date (CK5) sur le même modèle de contrat.
