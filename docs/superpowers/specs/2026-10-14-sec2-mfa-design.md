# SEC2 : double authentification (TOTP), obligatoire dès qu'une banque est connectée

Date : 2026-10-14. Statut : livré (SEC2 puis correctifs de la revue de sécurité), migration 0028 non appliquée.

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
| Connecteur MCP | garde globale (`garde-mfa.ts`) : jeton `aal1` + facteur vérifié (lu côté serveur) → tout outil de données personnelles répond « Double authentification requise… Reconnecte le connecteur Boussole dans Claude » au lieu de s'exécuter ; savoir commun (`consulter_savoir`, `reperes`, `consulter_expertise`) inchangé ; la RLS reste la barrière (voir plus bas) |
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
`aal2` côté Supabase, pas d'affaiblir la RLS.

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
`delete_me`, `mfa_exigee`, énumération de toutes les tables avec `user_id`, fonctions `security definer`, `service_role`), `test/powens-fonction.test.mjs` (403 `mfa_requise` ; facteurs lus par l'API admin ; échec fermé), `test/banque-mcp.test.mjs` (outils,
session, routine, `aalDuJeton`), `test/mfa-connecteur.test.mjs` (garde MFA du connecteur : aal1 + facteur, aal2, sans facteur, échec fermé, savoir commun), `test/mfa-ui.test.mjs` (adaptateur, écran de code, garde, Sécurité, assistant d'activation en 4 étapes : navigation, focus, nettoyage à la fermeture, envoi automatique, bouton `otpauth://`), `test/mfa-banque-app.test.mjs`
(carte, store exécuté, page de consentement exécutée). `auth.jwt()` est simulé dans `test/helpers/pglite.mjs` (aal2 par défaut, réglable
par `test.aal`).

## Hors périmètre

Codes de récupération (absents de Supabase), SMS, double authentification imposée à tous les comptes sans banque, journal des
connexions.
