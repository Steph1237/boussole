# AG1 : mémoire privée de l'agent et savoir commun (lecture)

Date : 2026-10-10 · Statut : validé par Stéph (« go »).

## Contexte et découpage

Stéph veut un agent expert diffusable à ses utilisateurs (il ne voit jamais leurs données), accessible depuis leur assistant habituel, et qui progresse : par ce que chaque utilisateur lui dit (mémoire privée + enseignements anonymisés pour tous), par l'actualité, et par des ressources de formation qu'il cherche seul. Le savoir commun est validé par Stéph, sauf les chiffres officiels, mis à jour automatiquement avec leur source. Boussole ne paie aucune IA : la veille et la recherche tournent sur le Claude de Stéph (routines planifiées), les utilisateurs n'utilisent que leur propre assistant.

Quatre chantiers : **AG1** mémoire privée + savoir commun en lecture (ce document) · AG2 atelier éditeur, veille, formation, repères automatiques · AG4 partage (lien d'invitation, pack universel pour tout assistant, ChatGPT et Le Chat par identité publiée) · AG3 enseignements anonymisés (option, filtrage, seuil d'utilisateurs distincts). Ordre : AG1 → AG2 → AG4 → AG3.

## 1. Données (migration 0009_savoir_memoire)

### `savoir_fiches` (commun, lecture publique)
- `id` uuid, `slug` text unique (`[a-z0-9-]{3,80}`), `theme` text parmi : `epargne`, `enveloppes`, `fiscalite`, `immobilier`, `retraite`, `protection`, `marches`, `comportement`, `credit`.
- `titre` (≤ 120), `resume` (≤ 400), `contenu` (markdown, ≤ 12 000 caractères), `mots_cles` text[].
- `sources` jsonb : tableau non vide de `{ titre, url, consulte_le }`.
- `version` int ≥ 1, `statut` `publie` | `archive`, `mis_a_jour_le` date, `cree_le` timestamptz.
- Recherche : colonne générée `recherche tsvector` (config `french`, titre A, résumé et mots-clés B, contenu C), index GIN.
- RLS : `select` pour `anon` et `authenticated` où `statut = 'publie'`. Aucune politique d'écriture (en AG1, contenu posé par migration ; écriture éditeur en AG2).
- RPC `chercher_savoir(p_question text, p_theme text, p_limite int)` : security invoker, `websearch_to_tsquery('french', …)`, tri `ts_rank_cd`, 5 par défaut, 10 au plus ; sans question : fiches du thème par date décroissante.

### `reperes` (commun, lecture publique)
- `cle` text pk (`[a-z0-9_]+`), `libelle`, `valeur` numeric, `unite` (`%`, `€`, `ans`), `date_effet` date, `source_titre`, `source_url`, `verifie_le` date, `mode` `auto` | `manuel` (tous `manuel` en AG1).
- Contenu initial : taux et plafond du Livret A, LDDS (plafond), LEP (taux, plafond), plafond PEA, prélèvement forfaitaire unique, abattement annuel assurance-vie après 8 ans (personne seule / couple), norme HCSF (taux d'effort, durée), PASS. **Chaque valeur est vérifiée en ligne sur une source officielle au moment de l'écriture**, avec sa date d'effet.
- Un repère dont `verifie_le` a plus de 180 jours est signalé « à vérifier » par le connecteur et l'app.

### `memoire_agent` (privée)
- `id` uuid, `user_id` (défaut `auth.uid()`, cascade), `categorie` parmi `contexte`, `preference`, `projet`, `decision`, `explique`, `a_suivre` ; `contenu` text (1 à 500 caractères) ; `echeance` date (seulement pour `a_suivre`) ; `epingle` bool ; `source` text ≤ 100 (nom de l'assistant) ; `cree_le`, `maj_le`.
- RLS propriétaire (select/insert/update/delete `to authenticated`), `revoke all from anon`.
- Déclencheur avant insertion : 200 souvenirs au plus par utilisateur (erreur claire).
- Contrainte de contenu sensible (fonction `public.contenu_sensible(text)` immuable) : refuse un IBAN (`[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}`), une suite de 13 à 19 chiffres (carte), les mots « mot de passe », « password », « code secret », « identifiant de connexion ».
- Ajoutée à `export_all()` (droit d'accès) ; supprimée avec le compte (cascade).

### Nouveautés vues (sur `connexions_assistant`)
- Colonne `savoir_vu_le timestamptz` (null à la création).
- RPC `marquer_savoir_vu(p_client_id text) returns timestamptz` (security invoker, une instruction) : renvoie la valeur précédente et la remplace par `now()` ; crée la ligne si absente. Atomique, donc indépendante de l'écriture de connexion faite en parallèle.

## 2. Agent (connecteur v6)

Organisation : le savoir et la mémoire vivent dans `supabase/functions/mcp/savoir.ts` et `memoire.ts`, chacun exportant `register(server, ctx, outils)` ; `index.ts` les appelle. Le test d'imports accepte les imports relatifs.

Outils :
- **`demarrer_session`** (lecture) : point d'entrée de toute conversation. Renvoie `conduite` (CONDUITE_EXPERT), `memoire` (épinglés puis 30 plus récents), `a_suivre_echus` (échéance ≤ aujourd'hui), `bilan` (pourcentage, 3 prochaines questions), `propositions_en_attente`, `nouveautes_savoir` (fiches mises à jour depuis la session précédente de ce client, par `marquer_savoir_vu` ; 10 au plus ; à la première session, rien), `onboarding_conseille` (bilan < 50 %).
- **`consulter_savoir`** (lecture) : `{ question?, theme?, slug? }`. Avec `slug` : fiche complète. Sinon : 5 résultats (slug, titre, résumé, thème, mis à jour le, sources). Rien trouvé : le dire, ne pas inventer.
- **`reperes`** (lecture) : `{ cles? }` → valeurs avec unité, date d'effet, source, vérifié le, `a_verifier`.
- **`memoriser`** (écriture directe, sans proposition, car ne touche pas au bilan) : `{ categorie, contenu, echeance?, epingle? }`. Refus lisible si contenu sensible ou limite atteinte.
- **`se_souvenir`** (lecture) : `{ categorie? }` → souvenirs.
- **`oublier`** (écriture directe) : `{ id }` ou `{ ids }`.

Instructions du serveur : « au début de chaque conversation, appelle demarrer_session ». `demarrer_onboarding` renvoie aussi la mémoire, et sa conduite apprend à mémoriser.

CONDUITE_EXPERT (persona conseiller en gestion de patrimoine pédagogue) :
- appeler `demarrer_session` d'abord ; saluer en tenant compte de la mémoire et des « à suivre » échus ; signaler les nouveautés du savoir pertinentes pour l'utilisateur ;
- avant tout chiffre réglementaire (taux, plafond, barème) : `reperes` ; avant toute explication de fond : `consulter_savoir` ; citer la fiche ou le repère (titre, date) ; signaler un repère « à vérifier » ;
- mémoriser ce qui est durable et utile pour la suite (contexte de vie, préférences, projets, décisions prises, notions déjà expliquées, points à suivre avec échéance) ; ne pas mémoriser ce qui est déjà dans le bilan ; demander l'accord avant de retenir une information sensible (santé, famille, situation professionnelle) ; jamais d'identifiants, IBAN, numéros de compte ou de carte, mots de passe ;
- dire à l'utilisateur qu'il peut voir et effacer la mémoire dans Boussole › Profil et données › Mémoire de l'agent ;
- posture inchangée : pédagogique, pas de recommandation de produit, pas un conseil en investissement ; propositions à valider pour le bilan.

## 3. App

- **Store** (supabase et démo), contrat étendu : `S.memoire = [{ id, categorie, contenu, echeance, epingle, source, creeLe, majLe }]`, `S.savoir = { fiches: [...résumés], reperes: [...] }` chargés au démarrage (fiches : sans le contenu ; contenu chargé à l'ouverture d'une fiche par `Store.savoir.fiche(slug)`). `Store.memoire.{ modifier(id, patch), supprimer(ids), toutEffacer() }`.
- **Profil › Mémoire de l'agent** (module `memoire-view`) : explication en tête (ce que l'agent retient, pourquoi, où c'est stocké), souvenirs groupés par catégorie, épinglés d'abord, « à suivre » avec échéance (échue en évidence) ; modifier le texte, épingler, supprimer, « Tout effacer » avec confirmation ; état vide qui explique comment la mémoire se remplit.
- **Recommandations › Fiches** (module `fiches-view`) : recherche (filtrage local sur titre, résumé, mots-clés), filtres par thème, liste de cartes (titre, résumé, date) ; ouverture d'une fiche : contenu rendu (markdown limité : titres, listes, gras, liens), sources avec lien, date ; repères affichés dans un encart « Chiffres de référence » avec source et date, mention « à vérifier » si ancien.
- **Module `reperes.js`** (pur, UMD) : `Reperes.valeur(liste, cle, defaut)`, `Reperes.aVerifier(r, today)`, `Reperes.format(r)`. La ligne « repère : Livret A … » de l'Avenir lit le taux du Livret A depuis `S.savoir.reperes` (secours : valeur actuelle codée). Les seuils des moteurs (HCSF 35 %) restent inchangés en AG1.
- **Démo** : 6 souvenirs d'exemple, 4 fiches et les repères d'exemple.
- Posture : légende « Indicateur pédagogique, pas un conseil en investissement. » sur les fiches.

## 4. Contenu initial (migration de données 0010_savoir_contenu)

Une vingtaine de fiches, **reformulées** (aucune reprise de texte de cours), chacune avec 1 à 3 sources officielles ou institutionnelles (service-public.fr, impots.gouv.fr, AMF, Banque de France, economie.gouv.fr, HCSF) : épargne de précaution ; livrets réglementés ; PEA ; assurance-vie ; PER et tranche d'imposition ; compte-titres et fiscalité des revenus du capital ; allocation selon le profil de risque ; diversification ; frais et TER ; investissement programmé ; crises passées et durée de récupération ; taux d'endettement ; acheter ou louer sa résidence principale ; prévoyance ; assurance emprunteur ; crypto-actifs ; biais comportementaux ; ordre de priorité de l'épargne ; transmission (bases). Chaque chiffre cité renvoie au repère correspondant ou est daté.

## 5. Tests

- Base (avec clé de service, sinon ignorés) : un visiteur anonyme lit fiches publiées et repères, n'écrit rien ; fiche archivée invisible ; mémoire visible du seul propriétaire ; 201e souvenir refusé ; IBAN, numéro de carte, « mot de passe » refusés ; `chercher_savoir` trouve « livret » ; export inclut la mémoire ; `marquer_savoir_vu` renvoie null puis la date précédente.
- Connecteur (statique + parité) : outils enregistrés ; `memoriser` / `oublier` seules écritures directes nouvelles ; conduite (demarrer_session, reperes, consulter_savoir, mémoire, jamais d'identifiants, effaçable) ; instructions qui pointent vers demarrer_session ; filtre sensible identique à la contrainte SQL ; nouveautés par `marquer_savoir_vu` (valeur précédente).
- App : `reperes.js` (valeur, secours, à vérifier) ; `memoire-view` et `fiches-view` (rendu, vide, groupement, suppression, recherche, rendu markdown sans HTML injecté) ; contrat des stores ; navigation (nouvelles sous-vues) ; build.
- Vérification navigateur : démo, mobile, sombre.

## Hors périmètre (chantiers suivants)

Écriture éditeur, file à relire, historique des versions, routines de veille et de formation, repères automatiques (AG2) ; partage et autres assistants (AG4) ; enseignements anonymisés (AG3).
