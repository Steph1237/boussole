# SEC2 : double authentification (TOTP), obligatoire dès qu'une banque est connectée

Date : 2026-10-14. Statut : livré sur la branche `sec2-mfa`, migration 0028 non appliquée.

## Décision

Les données bancaires (Powens, BQ1) sont les plus sensibles de Boussole. Elles ne se lisent qu'avec un second facteur : un code
à usage unique (TOTP) de Supabase Auth, en plus du mot de passe. Pas de SMS, pas de codes de récupération (Supabase n'en propose pas) :
l'app conseille d'enregistrer un second appareil.

Règle unique, appliquée à quatre endroits : **la session doit être `aal2`** (revendication `aal` du JWT).

| Où | Comment |
| --- | --- |
| Base (0028) | une politique RESTRICTIVE par table `banque_*` (`for all to authenticated`, `(select auth.jwt()->>'aal') = 'aal2'`) |
| Fonction `powens` | `/connecter` (connexion, reconnexion, gestion) répond 403 `{ erreur, code: "mfa_requise" }` sans `aal2`, avant tout appel Powens |
| Connecteur MCP | `lire_banque`, `operations_recentes`, `demarrer_session`, `demarrer_routine`, budget réel : message « Double authentification requise : reconnecte le connecteur après avoir validé ton code » |
| App | écran de code, section Compte › Sécurité, carte bloquante, page de consentement |

Un utilisateur sans facteur vérifié n'atteint jamais `aal2` : tant qu'il n'a pas activé la double authentification, il ne voit aucune
donnée bancaire. C'est le sens de « obligatoire ».

## Base de données (0028_mfa.sql)

- Tables couvertes : `banque_connexions`, `banque_comptes`, `banque_placements`, `banque_operations`, `banque_mois` (les seules tables
  `banque_*` des migrations 0021 à 0027 ; un test échoue si une nouvelle table `banque_*` n'est pas couverte).
- Politiques permissives de 0021 (propriétaire) conservées : la restrictive s'y ajoute, rien n'est affaibli. Jeton sans `aal` = `aal1`.
- Le rattachement d'un compte (update des 5 colonnes) exige aussi `aal2`.
- Fonctions `security definer` : aucune ne lit ces tables pour `authenticated` (`powens_*`, `banque_*` : `service_role` seulement).
  `export_all()` est `security invoker` : ses sections `banque_*` sortent vides sans `aal2`. Un test parcourt `pg_proc` pour le garantir
  pour toute fonction future.
- Hors périmètre, volontairement : `fonctionnalites` (l'interrupteur doit rester lisible pour afficher la carte), les propositions
  déposées par la synchronisation et les lignes de `positions` alimentées par Powens (patrimoine validé par l'utilisateur, pas le détail
  bancaire).
- À appliquer APRÈS le déploiement de l'app et du connecteur : sans la section Sécurité, un utilisateur concerné ne pourrait plus
  activer la double authentification.

## App

- `web/src/mfa.js` (nouveau, partagé) : adaptateur `client.auth.mfa`, écran de code, garde plein écran, section Sécurité, textes d'erreur.
  Le style est injecté par le module (classes `mfa-*`).
- **Compte › Sécurité** (`compte.html#securite`, `account.js`) : activation (QR code SVG de `enroll`, clé en texte, code à 6 chiffres :
  `challenge` + `verify`), liste des appareils vérifiés, second appareil, retrait avec confirmation dans la page (`unenroll`, exige
  `aal2` ; la page exige donc le code avant de s'afficher). Une phrase explique l'absence de codes de secours. Compte anonyme : phrase et
  lien « Sécuriser mon compte ».
- **Connexion** : après le mot de passe (`landing.js`, `Mfa.apresConnexion`) et à chaque démarrage de l'app (`store-supabase.js`,
  `Mfa.exiger`, donc aussi à la reprise de session) : si `nextLevel = aal2` et `currentLevel = aal1`, écran de code avant toute lecture.
  Mauvais code : message en français, champ vidé. Aucun verrouillage côté app : Supabase décide.
- **Banque** : `S.banque.mfaRequise` (interrupteur actif, session `aal1`) ; rien de bancaire n'est lu ; Patrimoine › Comptes et
  Agent › Connexion montrent la carte « Active la double authentification pour voir tes comptes bancaires » (bouton vers Compte ›
  Sécurité) ; `Store.banque.connecter` et `gerer` refusent sans appel réseau.
- Retirer ses données (`deconnecter`) et fermer son compte (`supprimer`) ne demandent pas `aal2`.

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
2. Le connecteur lit l'`aal` du jeton (`aalDuJeton`). Sans `aal2`, les outils bancaires répondent le message clair ci-dessus et
   `demarrer_session` / `demarrer_routine` renvoient `mfa_requise: true` (rien n'est lu) ; Claude le répète à l'utilisateur (règle 17).
3. La RLS reste la barrière : un jeton `aal1` ne lit rien dans `banque_*`, quoi que fasse le connecteur.

**À vérifier après déploiement** : connecter le connecteur avec un compte qui a la double authentification, puis appeler `lire_banque`.
Si les jetons OAuth sont toujours `aal1`, les outils bancaires resteront fermés malgré le code saisi au consentement. Repli possible,
non implémenté : autoriser dans la politique restrictive les jetons OAuth (`auth.jwt()->>'client_id' is not null`), la page de
consentement exigeant `aal2` tenant lieu de second facteur. Ce serait un assouplissement : à décider avec les résultats du test.

## Tests

`test/mfa-pglite.test.mjs` (PGlite : politiques, aal1 / aal2 / absent, facteur vérifié / non vérifié / aucun, écritures, `export_all`,
fonctions `security definer`, `service_role`), `test/powens-fonction.test.mjs` (403 `mfa_requise`), `test/banque-mcp.test.mjs` (outils,
session, routine, `aalDuJeton`), `test/mfa-ui.test.mjs` (adaptateur, écran de code, garde, Sécurité), `test/mfa-banque-app.test.mjs`
(carte, store exécuté, page de consentement exécutée). `auth.jwt()` est simulé dans `test/helpers/pglite.mjs` (aal2 par défaut, réglable
par `test.aal`).

## Hors périmètre

Codes de récupération (absents de Supabase), SMS, double authentification imposée à tous les comptes sans banque, journal des
connexions, durcissement du reste des tables.
