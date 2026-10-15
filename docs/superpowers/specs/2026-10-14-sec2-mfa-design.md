# SEC2 : double authentification (TOTP), obligatoire dès qu'une banque est connectée

Date : 2026-10-14. Statut : livré (SEC2 puis correctifs de la revue de sécurité), migration 0028 non appliquée. Complété le 2026-10-15
par l'autorisation du connecteur liée au second facteur (migration 0033, section « Connecteur MCP : autorisation liée au second facteur »).

## Décision

Les données bancaires (Powens, BQ1) sont les plus sensibles de Boussole, et elles irriguent le reste (lignes de positions alimentées
par la synchronisation, crédits, propositions avec salaire et employeur, totaux des snapshots). Deux règles, toutes deux portées par la
revendication `aal` du JWT (`aal2` = session passée par un second facteur, un code à usage unique TOTP de Supabase Auth) :

1. **Sans second facteur activé, les comptes bancaires sont masqués.** Les tables `banque_*` exigent toujours `aal2` : tant que
   l'utilisateur n'a pas activé la double authentification, il ne voit aucune donnée bancaire (« obligatoire dès qu'une banque est
   connectée »).
2. **Dès qu'un facteur est activé, TOUTES les données personnelles demandent le code.** Toute table de `public` qui porte un
   `user_id` n'est lisible et modifiable qu'en `aal2` pour un utilisateur qui a au moins un facteur vérifié. Sans facteur vérifié,
   rien ne change pour ces tables (il n'a pas de second facteur à présenter).

Pas de SMS, pas de codes de récupération (Supabase n'en propose pas) : l'app conseille d'enregistrer un second appareil.

| Où | Comment |
| --- | --- |
| Base (0028) | `banque_*` : politique RESTRICTIVE `aal2` ; toutes les autres tables avec `user_id` : politique RESTRICTIVE `aal2` OU pas de facteur vérifié (`public.mfa_exigee()`) |
| Fonction `powens` | `/connecter` : 403 `{ erreur, code: "mfa_requise" }` sans `aal2`, avant tout appel Powens. `/deconnecter`, `/synchroniser`, `/supprimer` : même 403 sans `aal2` si l'utilisateur a un facteur vérifié (lu côté serveur par l'API admin) |
| Connecteur MCP | garde globale (`garde-mfa.ts`) : jeton `aal1` + facteur vérifié (lu côté serveur) → tout outil de données personnelles répond « Double authentification requise… Reconnecte le connecteur Boussole dans Claude » au lieu de s'exécuter, sauf autorisation du connecteur liée au second facteur (0033) ; savoir commun (`consulter_savoir`, `reperes`, `consulter_expertise`) inchangé ; la RLS reste la barrière (voir plus bas) |
| App | écran de code, section Compte › Sécurité, carte bloquante, page de consentement, bandeau « appareil ajouté » |

## Base de données (0028_mfa.sql)

- **Niveau 1, `banque_*`** : `banque_connexions`, `banque_comptes`, `banque_placements`, `banque_operations`, `banque_mois` (les seules
  tables `banque_*` des migrations 0021 à 0027 ; un test échoue si une nouvelle table `banque_*` n'est pas couverte). Toujours `aal2`.
  Le rattachement d'un compte (update des 5 colonnes) l'exige aussi.
- **Niveau 2, le reste** : `public.mfa_exigee()` (`security definer`, `stable`, `search_path` vide, exécutable par `authenticated`
  seulement) renvoie vrai si `auth.uid()` a un facteur `verified` dans `auth.mfa_factors`. Une politique RESTRICTIVE
  `for all to authenticated` sur chaque table privée : `using / with check ((select auth.jwt()->>'aal') = 'aal2' or not (select
  public.mfa_exigee()))`. Tables : `profiles`, `biens`, `credits`, `positions`, `transactions`, `snapshots`, `config`, `status`,
  `budgets`, `objectifs`, `propositions`, `connexions_assistant`, `memoire_agent`, `journal`, `routines`, `fonctionnalites`. La fonction
  est dans `public` et non dans `prive` : le schéma `prive` est fermé à `authenticated`, or les politiques s'exécutent avec ses droits.
- **Anti-oubli** : un test énumère dans le catalogue toutes les tables de `public` qui ont une colonne `user_id` et échoue si l'une n'a pas
  sa politique restrictive. Une table future ne peut pas l'oublier. Hors périmètre : les contenus communs sans `user_id` (`instruments`,
  `savoir_fiches`, `reperes`, `expertises`, `expertises_versions`, `cours`) et `job_runs`.
- Politiques permissives de propriétaire conservées : la restrictive s'y ajoute, rien n'est affaibli. Jeton sans `aal` = `aal1`.
- `fonctionnalites` est couverte : l'interrupteur « banque » reste lisible pour l'utilisateur sans facteur (la carte « Active la double
  authentification » s'affiche) ; pour l'utilisateur avec facteur, l'écran de code précède de toute façon toute lecture.
- Fonctions `security definer` : `service_role` (fonction powens, nuit) contourne la RLS comme avant ; les fonctions réservées à
  `service_role` (`powens_*`, `banque_*`) ne sont pas exécutables par `authenticated`. `delete_me()` (propriétaire, hors RLS) et
  `export_all()` (`security invoker` : ne sort que ce que la RLS laisse voir) se comportent comme avant ; un test les exerce. Un test
  parcourt `pg_proc` pour qu'aucune fonction `security definer` exécutable par `authenticated` ne lise `banque_*`.
- Limite connue : `delete_me()` reste appelable en `aal1` (c'est une suppression, pas une lecture) ; ne pas l'étendre sans décision.
- À appliquer APRÈS le déploiement de l'app et du connecteur : sans la section Sécurité, un utilisateur concerné ne pourrait plus
  activer la double authentification.

## Fonction `powens` : actions sur une banque déjà connectée

- `/connecter` (connexion, reconnexion, gestion) : `aal2` toujours exigé.
- `/deconnecter`, `/synchroniser`, `/supprimer` : avec un jeton `aal1`, la fonction interroge l'API admin Auth
  (`auth.admin.mfa.listFactors({ userId })`, clé de service, supabase-js 2.117 : retourne `{ data: { factors }, error }`) et répond 403
  `mfa_requise` si un facteur est `verified`. Sans facteur vérifié : comportement inchangé. Lecture des facteurs en échec : 503 (échec
  fermé, jamais un passe-droit). Avec un jeton `aal2` aucune lecture n'est faite.
- Le niveau du jeton n'est lu qu'après `auth.getUser` (un seul endroit, `utilisateur()`, qui renvoie `{ id, aal }`) ; `aalDuJeton`
  décode la charge utile sans vérifier la signature et porte cet avertissement. Même principe côté connecteur : `chargeUtileDuJeton`
  (`banque.ts`) est le seul décodeur, utilisé par `aalDuJeton` et `clientDuJeton`.

## App

- `web/src/mfa.js` (partagé) : adaptateur `client.auth.mfa`, écran de code, garde plein écran, section Sécurité, bandeau, textes d'erreur.
  Le style est injecté par le module (classes `mfa-*`).
- **Compte › Sécurité** (`compte.html#securite`, `account.js`) : liste des appareils vérifiés, retrait avec confirmation dans la page
  (`unenroll`, exige `aal2` ; la page exige donc le code avant de s'afficher), bouton « Activer » / « Ajouter un second appareil » qui
  ouvre l'assistant d'activation. Une phrase explique l'absence de codes de secours. Compte anonyme : phrase et lien « Sécuriser mon compte ».
- **Assistant d'activation** (`Mfa.ouvrirActivation`, boîte de dialogue modale en 4 étapes, « Étape N sur 4 » + barre de progression) :
  1. « Pourquoi un code ? » (deux phrases) ; **mot de passe redemandé avant la première inscription** (`signInWithPassword` sur l'e-mail
     courant doit réussir avant tout appel à `enroll` : une session volée ne suffit pas à enrôler le facteur d'un attaquant) ; un second
     appareil se fait depuis une session `aal2` : pas de nouveau mot de passe ;
  2. « Ajoute Boussole à ton application » : QR code (SVG de `enroll`) ; sur petit écran (`max-width: 640px`), un bouton « Ouvrir dans mon
     application d'authentification » (lien `otpauth://totp/…` renvoyé par `enroll`, seul schéma accepté) passe AVANT le QR code, qu'on ne peut
     pas scanner avec le téléphone qui l'affiche ; « Je ne peux pas scanner » révèle la clé avec un bouton « Copier »
     (`navigator.clipboard.writeText` en `try/catch`, sinon clé sélectionnée et message) ;
  3. « Saisis le code » : 6 chiffres (`inputmode="numeric"`, `autocomplete="one-time-code"`), envoi automatique au 6e chiffre (frappe, saisie
     automatique, collage tolérant), erreur claire et nouvel essai, « Retour » / « Annuler » ;
  4. « C'est activé » : confirmation, conseil d'un second appareil (bouton qui repart à l'étape 2), « Terminer ».
  Accessibilité : `role="dialog"`, `aria-modal`, nommé par le titre de l'étape, piège à focus (Tab, Maj+Tab), page derrière `inert`, focus
  rendu à l'élément d'origine, Échap ferme, feuille plein écran sur téléphone, `prefers-reduced-motion` respecté, variables de thème (clair /
  sombre). **Fermer en cours de route** (Échap, ×, Annuler, Retour avant le code) retire l'inscription non vérifiée (`listFactors` puis
  `unenroll` des non vérifiés) : une nouvelle tentative repart proprement. L'assistant s'ouvre aussi depuis la carte bloquante
  (`data-mfa-activer`, `Mfa.installerOuverture`) ; compte anonyme ou sans client : lien normal vers Compte › Sécurité.
- **Bandeau « appareil ajouté »** : à chaque démarrage de l'app (après la garde), si un facteur vérifié n'a pas encore été acquitté sur
  ce navigateur (identifiants dans `localStorage`, clé `boussole.mfa.vus`, accès protégés par try/catch), bandeau d'alerte : « Un
  appareil de double authentification a été ajouté le … — ce n'est pas toi ? Écris à stephane@ceres.agency » (adresse des mentions
  légales), bouton « C'est moi ». Un facteur enrôlé depuis ce navigateur est acquitté d'office. Stockage indisponible : le bandeau
  reparaît à chaque démarrage, par prudence. Information, jamais une barrière.
- **Connexion** : après le mot de passe (`landing.js`, `Mfa.apresConnexion`) et à chaque démarrage de l'app (`store-supabase.js`,
  `Mfa.exiger`, donc aussi à la reprise de session) : si `nextLevel = aal2` et `currentLevel = aal1`, écran de code avant toute lecture.
  Une seule étape, le champ du code au premier plan (envoi automatique au 6e chiffre, collage, `one-time-code`) ; plusieurs appareils :
  « Utiliser un autre appareil » passe au suivant. Mauvais code : message en français, champ vidé. Aucun verrouillage côté app : Supabase décide.
- **Les contrôles côté navigateur échouent fermés** : si le niveau de session est illisible (`exiger`, `apresConnexion`,
  `etatConsentement`) ou la liste des appareils illisible (écran de code), l'écran affiche le message d'erreur et un bouton
  « Réessayer » ; rien n'est lu, aucun écran n'est levé, aucune autorisation n'est approuvée tant que le niveau n'a pas été lu.
- **Banque** : `S.banque.mfaRequise` (interrupteur actif, session `aal1`) ; rien de bancaire n'est lu ; Patrimoine › Comptes et
  Agent › Connexion montrent la carte « Active la double authentification pour voir tes comptes bancaires » (bouton vers Compte ›
  Sécurité) : sans second facteur les comptes bancaires restent masqués, et une fois un facteur activé tout Boussole demande le code ;
  `Store.banque.connecter` et `gerer` refusent sans appel réseau.

## Support : appareil de double authentification perdu ou ajouté par un tiers

Supabase n'a pas de codes de secours : un utilisateur qui a perdu tous ses appareils, ou qui signale un appareil qu'il n'a pas ajouté
(bandeau « ce n'est pas toi ? »), écrit à l'adresse des mentions légales. Procédure :

1. Vérifier l'identité par un canal indépendant de l'accès au compte (réponse depuis l'adresse e-mail du compte, plus une question que
   seul le titulaire connaît : date d'ouverture du compte, dernier montant saisi, etc.). Ne jamais agir sur la seule demande par e-mail
   d'une adresse inconnue du compte.
2. Retirer le facteur avec l'API admin de Supabase Auth (clé de service, jamais depuis le navigateur) :
   `supabase.auth.admin.mfa.listFactors({ userId })` pour repérer le facteur (id, `created_at`), puis
   `supabase.auth.admin.mfa.deleteFactor({ id, userId })`. Supprimer un facteur vérifié ferme toutes les sessions de l'utilisateur.
3. Si l'appareil signalé n'est pas celui de l'utilisateur : retirer ce facteur, puis faire changer le mot de passe avant de laisser
   l'utilisateur réactiver la double authentification (le mot de passe est redemandé avant la première inscription).
4. Noter l'intervention (date, utilisateur, facteur retiré) hors de Boussole ; ne jamais copier de donnée de l'utilisateur.

## Connecteur MCP : que contient le jeton OAuth ?

Constat (documentation Supabase) :

- Tout jeton d'accès OAuth contient les revendications `aal` et `amr` ; l'exemple de la page montre `"aal": "aal1"` avec une méthode
  `password`. <https://supabase.com/docs/guides/auth/oauth-server/token-security>
- Un jeton sans `aal` vaut `aal1`, et `aal2` n'est atteint qu'après un facteur vérifié.
  <https://supabase.com/docs/guides/auth/auth-mfa>, <https://supabase.com/docs/guides/auth/auth-mfa/totp>
- **Non documenté** : que l'`aal` du jeton émis suive celui de la session qui a approuvé le consentement. La page MCP ne parle ni de
  MFA, ni d'`aal`, ni d'élévation. <https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication>

Conséquence : le comportement n'est pas supposé, il est protégé de trois façons.

1. La page de consentement exige `aal2` avant d'approuver quand le compte a un facteur vérifié (code demandé avant d'afficher la
   demande, et de nouveau au clic sur « Autoriser » si la session est retombée à `aal1`).
2. Le connecteur lit l'`aal` du jeton (`aalDuJeton`, après `auth.getUser`). Hors `aal2`, il lit côté serveur les facteurs de l'utilisateur
   (`auth.admin.mfa.listFactors`, clé de service de la plateforme, comme la fonction `powens` ; aucune autre lecture ni écriture avec cette
   clé). Jeton `aal1` + facteur vérifié, ou lecture impossible (échec fermé) : TOUS les outils de données personnelles, `demarrer_session`
   comprise, répondent un message unique (« Double authentification requise : ton compte Boussole est protégé par un code. Reconnecte le
   connecteur Boussole dans Claude (Réglages › Connecteurs) et saisis ton code à 6 chiffres sur la page d'autorisation. », ou, si la
   vérification est impossible, un message qui dit qu'aucune donnée n'a été lue) au lieu de s'exécuter, pour que le Copilote ne conclue
   jamais « tu n'as rien » quand la RLS rend les tables illisibles ; la règle 19 de sa conduite et une ligne des instructions lui demandent
   de relayer le message. Sans facteur vérifié : comportement inchangé. Les outils de savoir commun restent disponibles. Les messages
   propres à la banque (`lire_banque`, `banque.mfa_requise`, règle 17) restent pour un jeton `aal2` sans second facteur.
3. La RLS reste la barrière : un jeton `aal1` ne lit rien dans `banque_*`, ni rien d'autre pour un compte à facteur vérifié, quoi que fasse le connecteur.

**Résultat mesuré en préproduction locale (2026-10-15, GoTrue v2.190.0 du CLI Supabase 2.107.0, `npm run preprod:fumee`)** : le jeton OAuth
émis au connecteur est **toujours `aal1`**, même quand la session qui approuve le consentement est `aal2`. Le jeton porte
`amr = [{ method: "oauth_provider/authorization_code" }]` et un `session_id` neuf : GoTrue ouvre une nouvelle session pour le client OAuth, sans
reprendre le niveau d'assurance de la session approbatrice. Constats : (1) la garde du connecteur fait ce qu'elle doit (tous les outils de
données personnelles répondent « Double authentification requise », savoir commun ouvert, aucune lecture) ; (2) la RLS ne laisse rien lire en `aal1` ;
(3) mais **un compte à double authentification ne peut donc pas utiliser le connecteur**, quel que soit le code saisi sur la page de consentement : le
message « reconnecte le connecteur et saisis ton code » ne peut pas aboutir ; (4) un jeton de session `aal1` peut appeler `approveAuthorization`
sans passer par la page (confirmé), ce qui reste sans effet puisque le jeton émis est `aal1`. À confirmer sur la version de GoTrue de la production
(même parcours, compte de test avec facteur) avant de décider : attendre une évolution de Supabase (jeton OAuth `aal2` quand la session approbatrice l'est),
ou accepter que les comptes à double authentification n'ouvrent pas le connecteur (le dire sur la page de consentement et dans la fiche Sécurité).
L'interdiction de laisser passer les jetons OAuth dans les politiques reste entière.

**À vérifier après déploiement** : connecter le connecteur avec un compte qui a la double authentification, puis appeler un outil de
lecture. Avec la RLS étendue à toutes les données personnelles, un jeton OAuth resté `aal1` ne lit plus rien pour un compte à facteur
vérifié (pas seulement la banque) : c'est le comportement voulu tant que l'`aal` du jeton émis n'est pas établi.

**Repli interdit, à ne jamais implémenter** : « laisser passer les jetons OAuth (`client_id`) » dans les politiques, au motif que la page
de consentement a exigé `aal2`. Le contrôle de la page de consentement n'existe que dans le navigateur (`consent.js`) : un attaquant qui
a un jeton de session `aal1` appelle `approveAuthorization` directement, sans passer par la page, et obtient un jeton OAuth qui
contournerait alors la double authentification. Si les jetons OAuth restent `aal1`, la seule voie acceptable est d'obtenir un jeton
`aal2` côté Supabase, ou une preuve `aal2` vérifiée **côté serveur** et liée à une session précise (section suivante), jamais d'affaiblir
la RLS sur la seule foi d'un `client_id`.

## Connecteur MCP : autorisation liée au second facteur (SEC2 bis, migration 0033)

Date : 2026-10-15. Statut : livré sur la branche `mcp-mfa`, migration 0033 non appliquée, vérifié de bout en bout en préproduction locale.

**Problème.** Mesuré en préproduction (ci-dessus) : le jeton OAuth est toujours `aal1`. Le propriétaire du produit a la double
authentification : son connecteur Claude ne lisait rien, et le message « reconnecte et saisis ton code » ne pouvait pas aboutir.

**Ce que contient le jeton (mesuré, GoTrue v2.190.0)** : `aal: "aal1"`, `amr: [{ method: "oauth_provider/authorization_code" }]`,
`client_id` (uuid du client OAuth, signé), `session_id` (session OAuth **neuve**, ouverte à l'échange du code, `auth.sessions.oauth_client_id`
renseigné, conservée au rafraîchissement), `scope`. GoTrue **supprime** la demande (`auth.oauth_authorizations`) à l'échange de son code ;
avec un consentement mémorisé, `getAuthorizationDetails` approuve tout seul et renvoie directement l'adresse de retour (la demande existe
encore, `approved`, jusqu'à l'échange).

**Décision : une autorisation du connecteur, créée par une preuve `aal2` côté serveur et liée à une seule session OAuth.**

1. Table `public.connecteurs_autorises` (une active par utilisateur et client ; `accorde_aal` ne peut valoir que `aal2` ; 90 jours ;
   `revoque_le` ; `session_id` lié au premier usage ; `dernier_usage`). Aucun droit d'écriture pour `authenticated` ; lecture par le
   propriétaire, sans `session_id` ni `autorisation_id`.
2. `autoriser_connecteur(authorization_id)` (security definer) : exige `aal = aal2` **de la session appelante** dans le JWT signé, refuse un
   jeton qui porte un `client_id`, lit le client dans la demande de GoTrue (à l'appelant, en attente ou approuvée, non expirée) au lieu de
   le recevoir de la page. La page de consentement l'appelle juste après le code, **avant** `approveAuthorization` (et avant la redirection
   quand le consentement est mémorisé) ; sans autorisation enregistrée, elle n'approuve pas. **Code frais** : la revendication `amr`
   doit porter un `totp` de moins de 10 minutes (sinon `BOU02`) ; la page redemande le code au-delà de 8 minutes, même en session `aal2`
   (mesuré : une nouvelle vérification en `aal2` rafraîchit l'instant `totp` de `amr`). **Client déclaré seulement** :
   `auth.oauth_clients.registration_type = manual`, non supprimé (sinon `BOU01`, « Application non reconnue »). Écart avec la consigne initiale
   (`autoriser_connecteur(client_id)`) : un identifiant de demande prouve que l'appelant a bien une demande en cours pour ce client et
   ne laisse pas la page choisir le client.
3. `lier_connecteur()` (security definer, appelée par le connecteur à chaque requête d'un compte à facteur) : lit `client_id` et
   `session_id` dans le jeton signé. Liaison au premier usage seulement si la demande a disparu (code échangé), si la session est une session
   OAuth de ce client pour cet utilisateur, ouverte après l'autorisation, avant l'expiration de la demande et dans les 15 minutes, et si
   c'est la **seule** session OAuth de ce client ouverte depuis l'autorisation. Ensuite, seule cette session passe.
4. `connecteur_autorise()` (security definer, stable) dans les politiques : autorisation liée, non révoquée, non expirée, session encore
   ouverte dans `auth.sessions`, et un facteur vérifié **antérieur à l'autorisation** existe encore (retrait puis réinscription d'un facteur :
   l'autorisation ne revit pas). `lier_connecteur` révoque en base les autorisations quand plus aucun facteur ne les couvre.
5. Politiques (même noms, `alter policy`) : « aal2 si facteur » accepte aussi le connecteur autorisé, en lecture et en écriture (le
   connecteur dépose propositions, mémoire, journal) ; `banque_*` : **lecture** par le connecteur autorisé, **écriture jamais** (with check
   `aal2` ET pas de `client_id`, même si GoTrue émettait un jour des jetons OAuth `aal2` ; nouvelle politique restrictive de suppression,
   même condition) : seules l'app en `aal2` et le service écrivent la banque, le
   connecteur n'en a pas besoin. Toutes en `(select auth.jwt())` : les 24 avertissements `auth_rls_initplan` tombent à 0 (mesuré).
6. Connecteur : `garde-mfa.ts` ajoute les verdicts `autorise` (outils ouverts, niveau effectif `aal2` pour les outils bancaires) et
   `expiree` (message « l'autorisation … a expiré (elle vaut 90 jours) ») ; tout autre refus garde « Double authentification requise… » ;
   lecture impossible : échec fermé. App : durée annoncée sur la page de consentement et à la redirection ; Mon compte › Connexion de Claude
   liste les accès protégés par le code et les retire (`revoquer_connecteur`) ; retirer une application chez Supabase les retire aussi.
7. `delete_me()` et `export_all()` recréées à l'identique avec des gardes : jamais par un jeton OAuth (42501), même autorisé (sinon la
   RLS ouverte au connecteur lui laisserait exporter tout et supprimer le compte, contrairement à la promesse de Mon compte) ;
   `delete_me` exige `aal2` pour un compte à facteur (un mot de passe volé ne supprime plus le compte) ; `export_all` exporte aussi
   `connecteurs_autorises` (colonnes visibles). Mon compte dit « en attente de première connexion » pour une autorisation pas encore liée.
8. Même migration : droits explicites de `service_role` sur toutes les tables, séquences et fonctions de `public`, et privilèges par
   défaut pour les objets futurs (fin de `auto_expose_new_tables` le 2026-10-30) ; `anon` et `authenticated` inchangés (test).

**Modèle de menace**

| Menace | Ce qui l'arrête |
| --- | --- |
| Hameçonnage du consentement : un client inscrit dynamiquement, nommé « Claude », envoie à l'utilisateur un lien d'autorisation ; l'utilisateur saisit son code | `autoriser_connecteur` n'accepte que les clients déclarés par l'administrateur (`registration_type = manual`) : `BOU01`, aucune autorisation (testé et mesuré). L'utilisateur peut encore approuver un jeton `aal1` sans autorisation, qui ne lit rien d'un compte à facteur. **À décider** : couper l'enregistrement dynamique en production (`allow_dynamic_registration`) si Claude n'en a pas besoin (le seul client de production est déclaré à la main et confidentiel). |
| Mot de passe volé seul (`aal1`) : créer une autorisation | `autoriser_connecteur` vérifie `aal2` dans le JWT **signé** de l'appelant, côté base : refus « Double authentification requise » (mesuré). L'attaquant ne peut pas atteindre `aal2` (`mfa.enroll` refusé à `aal1`, mesuré : 403 `insufficient_aal`). |
| Mot de passe volé : `approveAuthorization` direct, sans la page | Le jeton obtenu est `aal1` sans autorisation pour sa session : `lier_connecteur` → `absente`, RLS fermée (mesuré). |
| Mot de passe volé **après** une autorisation légitime, même `client_id` (client public partagé, redirection de bouclage, ou le même client que Claude) | L'autorisation est liée à la session OAuth de la victime ; la session de l'attaquant est une autre `session_id` → `autre_session`, rien de lisible, refus journalisé (mesuré). C'est ce qui manquait à une autorisation par `client_id` seul : le `client_id` d'un client public n'est pas un secret, et n'importe quel détenteur du mot de passe peut obtenir un jeton signé pour ce client. |
| Course : l'attaquant échange son propre code **entre** l'autorisation de la victime et l'échange légitime | Tant que la demande de la victime existe, rien ne se lie (`en_attente`) ; après l'échange légitime, deux sessions OAuth depuis l'autorisation → `ambigu`, rien n'est lié, la victime reconnecte (mesuré). |
| Usurpation du `client_id` ou de la `session_id` | Les deux viennent du JWT signé par GoTrue (`auth.jwt()`), jamais d'un paramètre ; la session doit exister dans `auth.sessions` pour cet utilisateur et ce client. |
| Vol du jeton OAuth (ou de son jeton de rafraîchissement) chez le client | Borné : 90 jours au plus ; retrait immédiat dans Mon compte › Connexion de Claude ; fermeture de la session OAuth (révocation chez Supabase, déconnexion) → fermé tout de suite ; facteur retiré par le support → fermé. Le jeton ne donne jamais d'écriture bancaire. |
| Autorisation d'un autre utilisateur | Toutes les fonctions et politiques filtrent par `auth.uid()` ; la session doit appartenir au même utilisateur (testé). |
| Un connecteur qui s'autorise lui-même | Refus si le JWT appelant porte un `client_id` ; un jeton OAuth est de toute façon `aal1`. |
| Session de navigateur `aal2` ancienne (ordinateur partagé, onglet resté ouvert) | Code frais exigé par la base (moins de 10 minutes) : une session `aal2` d'hier ne crée pas d'autorisation. |
| Un connecteur autorisé qui exporte tout, supprime le compte ou change le mot de passe | `export_all` et `delete_me` refusent tout jeton OAuth (mesuré : 42501) ; GoTrue refuse au jeton OAuth (`aal1`) d'un compte à facteur le changement de mot de passe et d'e-mail (`PUT /auth/v1/user` : 401 `insufficient_aal`, mesuré). |

**Pourquoi le repli interdit reste interdit.** « Laisser passer `client_id` » sans autorisation ouvrirait les données à tout jeton OAuth,
donc à tout détenteur du mot de passe (`approveAuthorization` n'exige qu'`aal1`), et la page de consentement ne serait qu'un contrôle de
navigateur contournable. Ici, la preuve `aal2` est vérifiée par la base au moment où l'autorisation est créée, et l'autorisation ne vaut
que pour une session précise, née de l'échange du code de cette demande.

**Risques résiduels** : (1) le vol d'une session de navigateur **`aal2`** (logiciel malveillant, XSS) dans les 10 minutes qui suivent un
code permet de créer une autorisation : mais une telle session donne déjà tout dans l'app. (2) La liaison
repose sur deux comportements de GoTrue mesurés en v2.190.0 (demande supprimée à l'échange ; `oauth_client_id` et `session_id` dans
`auth.sessions` et le jeton) et sur le schéma interne `auth` : **à revérifier sur la version de GoTrue de la production avant d'appliquer
0033** (requête en lecture des colonnes de `auth.sessions`, `auth.oauth_authorizations`, `auth.oauth_clients` ; `npm run preprod:connecteur`
reste la référence). Si GoTrue changeait ces comportements, la conséquence est un refus (jamais une ouverture) : la liaison n'aboutit
pas. (3) Pendant la durée de vie d'un jeton d'accès (1 h), un retrait de facteur ou une révocation est pris en compte tout de suite
par la RLS (pas d'attente d'expiration). (4) `export_all` n'inclut pas encore `connecteurs_autorises` (liste visible dans Mon compte).
(5) Un attaquant qui n'a que le mot de passe peut **retirer** une autorisation (`revoquer_connecteur` à tout niveau) : déni de service
seulement, l'utilisateur reconnecte avec son code. (6) Cas limite de la liaison : si la session OAuth légitime disparaît (déconnexion côté client) avant le
premier appel du connecteur, et qu'un détenteur du mot de passe ouvre alors sa propre session du même client dans les 10 minutes de
validité de la demande légitime, sa session devient la seule et peut être liée. Il faut à la fois le mot de passe, savoir que la victime
vient d'autoriser, et que la session légitime soit fermée avant tout appel : jugé négligeable ; le retrait dans Mon compte et
l'expiration le bornent. (7) **Mesuré, hors 0033, pour les comptes SANS double authentification** : un jeton OAuth (n'importe quel
connecteur) peut changer le mot de passe (`PUT /auth/v1/user` : 200) : un connecteur malveillant ou un jeton volé prend alors le compte.
Changement d'e-mail : non concluant en local (500, envoi du courriel de confirmation impossible, mailpit exclu de la préproduction) ; en
production, il dépend de la configuration des e-mails (`double_confirm_changes = false`, pas de service d'e-mail) : à vérifier. Il peut aussi modifier
`user_metadata` (200 ; Boussole n'en dépend pas) et déconnecter les autres sessions (`POST /logout?scope=others` : 204, mesuré avec un compte
à facteur : nuisance seulement). On ne peut pas modifier GoTrue ; options : (a) `secure_password_change = true` (réauthentification récente ;
mais le nonce part par e-mail, absent aujourd'hui) ; (b) n'ouvrir le connecteur qu'aux comptes à double authentification (le jeton OAuth y est
`aal1`, refusé par GoTrue), ou le recommander fortement sur la page de consentement ; (c) ne déclarer que des clients de confiance (Claude) et
couper l'enregistrement dynamique ; (d) surveiller les journaux d'audit `user_updated_password` dont la session est OAuth. À décider.

**Vérification de bout en bout (préproduction locale, 2026-10-15, GoTrue v2.190.0, PostgREST v14.13, PostgreSQL 17.6)** :
`npm run preprod:connecteur` (10 étapes après la revue de sécurité, toutes conformes, client déclaré par l'API d'administration ;
étape 0 : client dynamique refusé `BOU01` ; étape 2 bis : `export_all` et `delete_me` 42501, `PUT /user` 401 `insufficient_aal`) et la fumée (`npm run preprod:fumee`, parcours `connecteur-mfa`) : mot de passe
seul → `autoriser_connecteur` refusé et jeton OAuth sans lecture ; code validé → autorisation de 90 jours, liaison à la session, `get_overview`,
`lire_banque` et `demarrer_session` lisent (7 positions), écriture bancaire refusée par la RLS ; rafraîchissement : même session, toujours
lu ; mot de passe volé après coup (consentement mémorisé) → autre session refusée, session légitime intacte ; retrait → refus immédiat ;
nouvelle autorisation → nouveau jeton lu, ancien refusé ; expiration → message « a expiré » ; course → rien de lié, personne ne lit.
Conseiller de base : `auth_rls_initplan` 24 → 0, aucun avertissement de sécurité. Vraie page dans un navigateur (`npm run preprod:app`) :
connexion par mot de passe, écran de code, demande avec la durée de 90 jours, « Autoriser » → autorisation `aal2` enregistrée avant
l'approbation, jeton OAuth `aal1` qui lit `get_overview` et `lire_banque` ; Mon compte › Connexion de Claude liste l'accès et « Retirer »
le révoque (le facteur reste intact). `npm run preprod:test` : 166 tests d'intégration conformes.

## Ajout d'un facteur quand un facteur existe déjà (M3)

La documentation Supabase est **muette** sur le point de savoir si GoTrue refuse `mfa.enroll` à `aal1` quand l'utilisateur a déjà un
facteur vérifié : ni la page TOTP (<https://supabase.com/docs/guides/auth/auth-mfa/totp>), ni la page MFA
(<https://supabase.com/docs/guides/auth/auth-mfa>), ni la référence `enroll`
(<https://supabase.com/docs/reference/javascript/auth-mfa-enroll>), ni la page téléphone
(<https://supabase.com/docs/guides/auth/auth-mfa/phone>) ne l'indiquent (consultées le 2026-10-14). La seule exigence `aal2` documentée
concerne le retrait : « users can only unenroll a factor after completing the enrollment flow and obtaining an `aal2` JWT claim »
(page MFA). La référence `enroll` précise seulement que la vérification d'un facteur élève la session courante à `aal2` et ferme les
autres sessions. Conséquence : on ne suppose pas que le serveur protège l'ajout d'un second appareil. Les mesures de l'app (mot de passe
redemandé avant la première inscription, bandeau « appareil ajouté », code exigé avant la page Sécurité) ne s'appuient pas sur ce
comportement. Si l'on veut une garantie serveur, elle reste à tester sur le projet (appeler `enroll` avec un jeton `aal1` d'un compte à
facteur vérifié) et à documenter ici avec le résultat.

**Résultat mesuré en préproduction locale (2026-10-15, GoTrue v2.190.0)** : GoTrue **refuse** `mfa.enroll` avec un jeton `aal1` quand le compte a déjà un
facteur vérifié : HTTP 403, code `insufficient_aal`, message « AAL2 required to enroll a new factor ». Un mot de passe volé ne suffit donc pas à ajouter un
second facteur que l'attaquant maîtriserait (la chaîne enroll puis verify vers `aal2` est fermée côté serveur). Les mesures de l'app (mot de passe redemandé,
bandeau, code avant la page Sécurité) restent utiles mais ne portent plus seules cette garantie. À reconfirmer sur la production (même appel, compte de test).

## Tests

`test/mfa-pglite.test.mjs` (PGlite : politiques, aal1 / aal2 / absent, facteur vérifié / non vérifié / aucun, écritures, `export_all`,
`delete_me`, `mfa_exigee`, énumération de toutes les tables avec `user_id`, fonctions `security definer`, `service_role`), `test/connecteur-autorise-pglite.test.mjs` (0033 : création seulement en `aal2`, liaison, autre session, course, expiration, révocation, session fermée, facteur retiré, autre utilisateur, politiques, `auth_rls_initplan`, droits de `service_role` sans exposition automatique), `test/connecteur-autorise-ui.test.mjs` (Mon compte › Connexion de Claude), `test/powens-fonction.test.mjs` (403 `mfa_requise` ; facteurs lus par l'API admin ; échec fermé), `test/banque-mcp.test.mjs` (outils,
session, routine, `aalDuJeton`), `test/mfa-connecteur.test.mjs` (garde MFA du connecteur : aal1 + facteur, aal2, sans facteur, échec fermé, savoir commun), `test/mfa-ui.test.mjs` (adaptateur, écran de code, garde, Sécurité, assistant d'activation en 4 étapes : navigation, focus, nettoyage à la fermeture, envoi automatique, bouton `otpauth://`), `test/mfa-banque-app.test.mjs`
(carte, store exécuté, page de consentement exécutée). `auth.jwt()` est simulé dans `test/helpers/pglite.mjs` (aal2 par défaut, réglable
par `test.aal`).

## Hors périmètre

Codes de récupération (absents de Supabase), SMS, double authentification imposée à tous les comptes sans banque, journal des
connexions.
