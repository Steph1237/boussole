# SEC5 + EX3-MVP : préproduction locale et banc d'évaluation — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal :** développer et tester sans jamais toucher la base de production `oapcewpqsbbjdlcdeizi`, sur une pile Supabase locale peuplée de foyers fictifs, MFA et OAuth compris ; puis faire jouer le Copilote sur 60 cas de référence, le noter par des correcteurs automatiques et un juge Haiku, et bloquer toute publication en régression.

**Spec :** `docs/superpowers/specs/2026-10-16-sec5-ex3-preprod-banc-design.md`. À lire en entier avant de commencer, en particulier § 0 (décisions), § 1.1 (contacts actuels avec la production), § 3.3 (différences locales), § 3.8 (garde), § 5 (correcteurs), § 6.5 (porte) et § 7 (secrets).

**Repères :**
- Dépôt : `/Users/stephane/boussole`. Outils : Supabase CLI 2.107.0 (`/opt/homebrew/bin/supabase`, non connecté), Docker par colima 0.10.3 (`colima start` ; 2 processeurs, 4 Go), Node 25 en local, 22 en CI.
- Commandes : `npm test` (et `node --test test/<fichier>.test.mjs`), `node build.mjs`, `npm run gen`, `npm run check:mcp`.
- Toujours `--workdir .preprod` pour le CLI. **Interdit** dans tous les scripts : `supabase link`, `db push`, `--linked`, `config push`, `functions deploy`, `secrets set`, `--db-url` ou `--project-ref` hors `127.0.0.1`.
- Ne jamais modifier une migration existante (vérifiées par md5 en production). Aucune migration nouvelle n'est prévue par ce plan.
- Aucune donnée réelle : prénoms, montants, libellés et supports inventés (« Fonds Monde Indiciel A », « PEA Exemple ») ; jamais un ISIN réel ; jamais `~/Finance/sources`.
- Secrets : uniquement par l'environnement. Clé API Anthropic fournie par Stéph (décision D1), jamais dans le dépôt, `.preprod/` ni les résultats.
- Tutoiement, jamais « conseiller », jamais un produit nommé, dans tout texte destiné à l'utilisateur ou au modèle.
- Ne pas committer dans les tâches : c'est le contrôleur qui committe.

**Modèle par tâche** (roadmap § 3 bis) : **Opus** pour les foyers, les cas, la grille, la calibration et les relectures de fin de phase ; **Sonnet** pour le code ; **Haiku** pour lancer, rapporter et les textes mécaniques. Effort : S ≤ ½ journée · M 1 à 2 jours · L 3 à 5 jours.

**Prérequis (Stéph)** : D1 (clé API, avant la phase 7), D2 (budget, avant la phase 7), D4, D5, D6 (après la phase 4), D7 (avant tout `config push`), D8 (après la phase 5). Les phases 1 à 6 n'ont besoin d'aucune clé API.

## Contrats communs

### Arborescence

```
preprod/config.toml                 config locale (copie de supabase/config.toml + différences du § 3.3 de la spec)
preprod/seed.sql                    désarme pg_cron vers la production, schéma preprod (lancer_nuit)
scripts/preprod/garde.mjs           assertLocal(url), assertCleLocale(cle), assertPasDeLien(), assertChemin(p)
scripts/preprod/preparer.mjs        assemble .preprod/supabase/ (config, copies de migrations et functions, seed)
scripts/preprod/env.mjs             lit `supabase status -o env`, écrit .preprod/fonctions.env et .preprod/web-config.js, imprime les variables de test
scripts/preprod/graine.mjs          comptes GoTrue + foyers ; .preprod/comptes.json (600)
scripts/preprod/charger-foyer.mjs   foyer JSON → tables (clé de service locale)
scripts/preprod/totp.mjs            code TOTP RFC 6238 (HMAC-SHA1, 30 s, 6 chiffres)
scripts/preprod/fumee.mjs           parcours de fumée (spec § 3.6)
banc/foyers/*.json, banc/foyers/cours.json
banc/cas.schema.json, banc/cas/*.json
banc/correcteurs/*.mjs              fonctions pures (cas, transcription, diffBase) → { ok, details }
banc/lanceur/{pont-mcp,boucle,utilisateur,base,cache,resultats}.mjs, banc/lanceur/index.mjs
banc/juge/{grille.md,consigne.md,juge.mjs,calibrer.mjs}
banc/references/<modele>.json       (versionné)
banc/resultats/                     (ignoré par git)
banc/transcriptions-test/*.json     transcriptions de référence pour les tests des correcteurs (fictives, sans appel au modèle)
```

### Scripts `package.json`

| Script | Effet |
|---|---|
| `preprod:start` | `preparer` → `supabase start --workdir .preprod -x analytics,vector,imgproxy,inbucket` → `env` → `graine` |
| `preprod:stop` | `supabase stop --workdir .preprod` |
| `preprod:reset` | `preparer` → `supabase db reset --local --workdir .preprod` → `graine` |
| `preprod:sync` | recopie migrations et fonctions dans `.preprod/` |
| `preprod:fonctions` | `supabase functions serve --workdir .preprod --env-file .preprod/fonctions.env` |
| `preprod:fumee` | parcours de fumée |
| `banc` | lanceur (`--modele`, `--cas`, `--porte`, `--complet`, `--nouvelle-reference`, `--rejouer <dossier>`) |
| `banc:porte` | porte ciblée Sonnet + Haiku, écrit `banc/porte.json` |
| `banc:juger` | rejuge un dossier de résultats (sans rejouer le modèle) |
| `banc:calibrer` | calibration mensuelle Opus |

### Variables d'environnement

| Variable | Qui la lit | Valeur |
|---|---|---|
| `BOUSSOLE_ENV` | connecteur, fonctions | `preprod` en local ; absente en production |
| `BOUSSOLE_PUBLIC_URL` | connecteur (`RESOURCE`, `authorization_servers`) | `http://127.0.0.1:54321` ; absente en production |
| `BOUSSOLE_PUBLISHABLE_KEY` | connecteur (existe) | clé anonyme locale |
| `BOUSSOLE_HORS_LIGNE` | `nightly` | `1` : cours figés, aucun appel externe |
| `BOUSSOLE_SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | `test/helpers/supabase.mjs` | pile locale |
| `BOUSSOLE_PROD` | `test/helpers/supabase.mjs` | `1` seulement pour `scripts/migrate-steph.mjs` |
| `ANTHROPIC_API_KEY` | lanceur, juge | fournie par Stéph |

---

## Phase 1 : socle local (SEC5)

### Tâche 1.1 : garde « jamais la production » — Sonnet, S

**Files :** `scripts/preprod/garde.mjs`, `test/preprod-garde.test.mjs`

- [ ] Écrire d'abord les tests : `assertLocal` accepte `http://127.0.0.1:54321`, `http://localhost:8780`, `http://kong:8000` ; refuse `https://oapcewpqsbbjdlcdeizi.supabase.co`, tout `*.supabase.co`, tout `https://`, une URL vide.
- [ ] `assertCleLocale` : décode la charge utile du JWT (sans vérifier la signature) et refuse un `iss` ou un `ref` de production ; refuse une clé `sb_secret_` dont le préfixe ne correspond pas à la pile locale (vérifier le format des clés locales du CLI 2.107.0 à la tâche 1.3, puis figer le test).
- [ ] `assertPasDeLien` : refuse si `supabase/.temp/project-ref` ou `.preprod/supabase/.temp/project-ref` existe.
- [ ] `assertChemin` : refuse tout chemin hors du dépôt et de `.preprod/`, et nommément `~/Finance/sources`.
- [ ] Test « dépôt sans secret » : aucune chaîne `sk-ant-`, `sb_secret_`, ni JWT `service_role` dans les fichiers suivis (`git ls-files`).

### Tâche 1.2 : configuration locale et dossier généré — Sonnet, S

**Files :** `preprod/config.toml`, `scripts/preprod/preparer.mjs`, `.gitignore`, `test/preprod-config.test.mjs`

- [ ] Test de parité d'abord : analyse TOML minimale (ou comparaison ligne à ligne hors commentaires) ; seules les clés du § 3.3 de la spec diffèrent entre `supabase/config.toml` et `preprod/config.toml`.
- [ ] Écrire `preprod/config.toml` : `project_id = "boussole-preprod"`, `site_url = "http://localhost:8780"`, `additional_redirect_urls = ["http://localhost:8780/**"]`, `authorization_url_path = "/oauth/consent.html"`, TOTP `enroll_enabled` et `verify_enabled` à `true`, limites de débit d'authentification à 1 000, `[db.seed] sql_paths = ["./seed.sql"]`, `major_version = 17`.
- [ ] `preparer.mjs` : appelle la garde, recrée `.preprod/supabase/` (config, `seed.sql`, copies de `supabase/migrations` et `supabase/functions`). Idempotent.
- [ ] `.gitignore` : `.preprod/`, `dist-preprod/`, `banc/resultats/`, `banc/porte.json`.

### Tâche 1.3 : graine qui désarme les tâches vers la production — Sonnet, S

**Files :** `preprod/seed.sql`, `test/preprod-seed.test.mjs`

- [ ] Test d'abord (analyse de fichiers, sans Docker) : pour chaque `cron.schedule('<nom>', …)` d'une migration dont la commande contient `oapcewpqsbbjdlcdeizi`, `seed.sql` contient `cron.unschedule('<nom>')`. Aujourd'hui : `boussole-nightly` (0003), `boussole-powens-nuit` (0021).
- [ ] `seed.sql` : `cron.unschedule` de ces tâches, puis `do $$ … if exists (select 1 from cron.job where command like '%supabase.co%') then raise exception … $$` ; schéma `preprod` ; fonction `preprod.lancer_nuit()` (`net.http_post` vers la fonction `nightly` locale, URL interne Docker à déterminer à la tâche 1.4, jeton lu dans Vault local).
- [ ] Le même test PGlite applique `baseComplete` puis `seed.sql` (bouchons pg_cron) et vérifie `cron.job` sans URL de production.

### Tâche 1.4 : premier démarrage réel — Sonnet, M (Haiku pour relancer et rapporter)

- [ ] `colima start` ; `npm run preprod:start`. Noter la mémoire consommée (`docker stats --no-stream`) ; si la pile ne tient pas dans 4 Go, le signaler (D9).
- [ ] Vérifier que les 31 migrations s'appliquent sur une base neuve (`supabase db reset --local --workdir .preprod`). En cas d'échec : **ne pas modifier la migration** ; noter la cause, corriger dans `seed.sql` si c'est un prérequis local, sinon remonter au contrôleur (nouvelle migration éventuelle).
- [ ] `supabase db query --local --workdir .preprod "select jobname, command from cron.job"` : aucune URL de production.
- [ ] `supabase db advisors --local --workdir .preprod` : comparer aux avertissements connus de la production, consigner les écarts.
- [ ] `lsof -iTCP -sTCP:LISTEN -n -P | grep -E '5432[0-9]'` : consigner l'interface d'écoute. Si `*` ou `0.0.0.0` : ajouter un avertissement au démarrage (`preprod:start` l'imprime) et la règle « réseau de confiance, arrêt après usage ».
- [ ] Relever le format des clés locales (`supabase status -o env`) et figer le test de `assertCleLocale`.
- [ ] Essayer un lien symbolique pour `functions/` au lieu de la copie ; garder la copie si le rechargement échoue.

**Fin de phase 1 :** pile locale démarrée et réinitialisée sans erreur, aucune tâche planifiée vers la production, tests `preprod-*` au vert.

---

## Phase 2 : comptes et foyers fictifs (SEC5)

### Tâche 2.1 : six foyers et deux foyers techniques — Opus, M (effort high)

**Files :** `banc/foyers/{jeune-actif,couple-enfants,proprietaire-credit,independant,preretraite,endette,vide,mfa-aal1}.json`, `banc/foyers/cours.json`, `banc/foyers/schema.json`

- [ ] Pour chaque foyer de la spec § 3.5 : profil (personnes, âges, statut, revenus, tranche), biens, crédits (capital restant, taux, fin), positions par enveloppe (dates d'ouverture et de premier versement), budget, objectifs datés, profil de risque (sauf `independant` : absent, pour le cas « données manquantes »), protection, `config` (enveloppes_infos, matelas), foyer et événements de vie (PROJ), consentement du journal (`demander` pour au moins deux foyers), fonctionnalités ouvertes.
- [ ] `proprietaire-credit` : `fonctionnalites.banque` actif et des lignes `banque_*` fictives (comptes, opérations sur 90 jours) dont **un libellé piégé** (consigne + canari) et un libellé contenant un faux numéro de compte, pour les correcteurs `injection` et `identifiants`.
- [ ] Cohérence financière vérifiée par Opus : endettement, épargne, patrimoine net plausibles pour l'âge ; dates qui font tomber au moins une échéance du calendrier dans les 12 mois (PEA à 5 ans pour `jeune-actif`, assurance-vie à 8 ans pour `preretraite`).
- [ ] `cours.json` : prix figés de tous les supports cités.
- [ ] Relecture par Stéph (D8).

### Tâche 2.2 : TOTP local — Sonnet, S

**Files :** `scripts/preprod/totp.mjs`, `test/preprod-totp.test.mjs`

- [ ] Tests sur les vecteurs de la RFC 6238 (SHA-1, secret `12345678901234567890`, T = 59, 1111111109, …), en base32 comme le renvoie GoTrue.
- [ ] `codeTotp(secretBase32, instant = Date.now())`.

### Tâche 2.3 : chargeur de foyer — Sonnet, M

**Files :** `scripts/preprod/charger-foyer.mjs`, `test/preprod-chargeur.test.mjs`

- [ ] Test de couverture d'abord : sur `baseComplete` (PGlite), lister les tables du schéma `public` qui ont une colonne `user_id` ; chacune est soit traitée par le chargeur, soit dans une liste `IGNOREES` avec sa raison. Un nouveau module non traité fait échouer le test.
- [ ] Test d'exécution sur PGlite : charger chaque foyer pour un `uid`, relire les totaux (patrimoine, crédits, budget) et les comparer à ceux du fichier.
- [ ] Le chargeur prend un client (PGlite en test, supabase-js avec la clé de service locale en réel) ; appelle la garde ; applique une `variante` (surcharges JSON) quand elle est fournie.

### Tâche 2.4 : graine des comptes — Sonnet, M

**Files :** `scripts/preprod/graine.mjs`

- [ ] Garde ; clés locales lues par `supabase status -o env` (jamais écrites ailleurs que `.preprod/`).
- [ ] Un compte modèle par foyer (`<slug>@preprod.boussole.test`, mot de passe aléatoire) par `auth.admin.createUser({ email_confirm: true })`, puis chargement du foyer.
- [ ] Foyers avec double authentification : connexion, `mfa.enroll({ factorType: "totp" })`, `challenge`, `verify` avec `codeTotp` ; vérifier que la session obtenue est `aal2`.
- [ ] `.preprod/comptes.json` (droits 600) : identifiants, mot de passe, secret TOTP, `uid`. Rien n'est affiché.
- [ ] Fonction exportée `compteNeuf(slug, { variante, jeton })` pour le banc : crée un compte jetable, charge le foyer, renvoie un jeton `aal2`, `aal1` ou de session simple.

**Fin de phase 2 :** `npm run preprod:reset` produit huit comptes fictifs utilisables ; une connexion `aal2` réussit pour `proprietaire-credit`.

---

## Phase 3 : fonctions et application en local (SEC5)

### Tâche 3.1 : connecteur paramétrable sans changer la production — Sonnet, S

**Files :** `supabase/functions/mcp/index.ts`, `test/mcp-preprod.test.mjs`

- [ ] Tests d'abord (même méthode que `test/mcp.test.mjs` : `stripTypeScriptTypes` et `vm`, `deps.env` simulé) : sans variable, `PROTECTED_RESOURCE` et `WWW-Authenticate` sont identiques à aujourd'hui ; avec `BOUSSOLE_ENV=preprod` et `BOUSSOLE_PUBLIC_URL=http://127.0.0.1:54321`, ils pointent vers la pile locale ; avec `BOUSSOLE_ENV=preprod` et une URL `supabase.co`, toute requête répond 500.
- [ ] Lire `BOUSSOLE_PUBLIC_URL` pour `RESOURCE` et `authorization_servers`, valeur par défaut inchangée.
- [ ] `npm run check:mcp` au vert.

### Tâche 3.2 : nuit hors ligne — Sonnet, S

**Files :** `supabase/functions/nightly/*`, `test/nightly-hors-ligne.test.mjs`

- [ ] Test d'abord (modèle `test/nightly-frais.test.mjs`, `fetch` simulé) : avec `BOUSSOLE_HORS_LIGNE=1`, aucun `fetch` externe ; cours lus dans le fichier fourni ; sans la variable, comportement inchangé.
- [ ] Implémenter le court-circuit au seul point d'entrée des appels externes.

### Tâche 3.3 : variables locales et application — Sonnet, S

**Files :** `scripts/preprod/env.mjs`, `build.mjs`, `test/build-config.test.mjs`

- [ ] `env.mjs` : écrit `.preprod/fonctions.env` (`BOUSSOLE_ENV`, `BOUSSOLE_PUBLIC_URL`, `BOUSSOLE_PUBLISHABLE_KEY`, `BOUSSOLE_HORS_LIGNE`) et `.preprod/web-config.js` (`supabaseUrl`, `supabaseKey`, `mcpUrl` locaux ; `claude.clientId` vide) ; imprime `BOUSSOLE_SUPABASE_URL=…` et l'export de la clé de service pour un `eval` dans le terminal, sans l'écrire dans un fichier suivi.
- [ ] `build.mjs --config=preprod` : copie `.preprod/web-config.js` à la place de `web/config.js` et écrit dans `dist-preprod/`. Test : sans l'option, `dist/config.js` reste celui de production.

### Tâche 3.4 : parcours de fumée — Sonnet, M

**Files :** `scripts/preprod/fumee.mjs`

- [ ] Les cinq parcours de la spec § 3.6 (RLS entre deux comptes ; MFA `aal1` / `aal2` et refus du connecteur ; OAuth 2.1 avec enregistrement dynamique, PKCE, `approveAuthorization`, échange du code, claim `client_id` ; connecteur `initialize`, `tools/list` = 57 outils, `demarrer_session`, proposition puis `appliquer_propositions` ; nuit locale par `preprod.lancer_nuit()`).
- [ ] Vérifier sur le CLI 2.107.0 les points d'accès OAuth de GoTrue avant d'écrire le parcours 3 (lecture de `web/src/consent.js` et des en-têtes `WWW-Authenticate` du connecteur local).
- [ ] Trancher le point ouvert de SEC2 : `mfa.enroll` avec un jeton `aal1` d'un compte qui a déjà un facteur vérifié. Consigner le résultat dans la spec SEC2 (§ « point à tester »).
- [ ] Sortie courte : une ligne par parcours, `ok` ou la cause.

**Fin de phase 3 :** `npm run preprod:fumee` au vert ; l'app tourne sur `http://localhost:8780` contre la pile locale ; la page de consentement locale fonctionne.

---

## Phase 4 : tests et CI hors production (SEC5)

### Tâche 4.1 : aide de test vers la préproduction — Sonnet, S

**Files :** `test/helpers/supabase.mjs`, `scripts/migrate-steph.mjs`, `test/helpers-supabase.test.mjs`

- [ ] Tests d'abord : sans `BOUSSOLE_SUPABASE_URL`, les tests d'intégration sont sautés avec une raison claire ; avec une URL locale et une clé locale, `adminClient()` vise la pile locale ; une clé de service avec l'URL de production lève une erreur, sauf `BOUSSOLE_PROD=1`.
- [ ] `migrate-steph.mjs` : exige `BOUSSOLE_PROD=1` (message explicite), lit l'URL de production comme avant.
- [ ] Lancer `isolation`, `journal-db`, `savoir-db`, `nightly` contre la pile locale ; corriger ce qui supposait la production (sans affaiblir les assertions).

### Tâche 4.2 : CI sur une pile locale — Sonnet, M

**Files :** `.github/workflows/pages.yml` (ou `preprod.yml`)

- [ ] Job « préproduction » : `supabase/setup-cli` épinglé à 2.107.0, `supabase start --workdir .preprod -x …` après `preparer`, `graine`, export des variables locales, `npm test`.
- [ ] Retirer `SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}` du workflow. Signaler à Stéph de supprimer le secret (D6).
- [ ] Le job Pages reste rapide : il dépend du job PGlite (`npm test` sans Docker) ; le job préproduction est requis pour fusionner mais ne bloque pas la publication de Pages si GitHub est en panne de Docker (à arbitrer par le contrôleur).

### Tâche 4.3 : relecture de sécurité de SEC5 — Opus, S (effort high)

- [ ] Aucune voie de la préproduction ou des tests vers la production (URL, clé, cron, CI, `migrate-steph`).
- [ ] Valeurs par défaut du connecteur en production inchangées.
- [ ] Secrets : rien dans les fichiers suivis, `.preprod/` ignoré, droits 600.
- [ ] Ports et réseau (§ 3.10) consignés.
- [ ] Roadmap : SEC5 « Fait » (date + commit), risque « Accès administrateur » mis à jour (Haiku).

**Fin de phase 4 (fin de SEC5) :** `npm test` et la CI ne touchent plus la production ; relecture Opus sans point bloquant.

---

## Phase 5 : cas de référence et grille (EX3-MVP)

### Tâche 5.1 : schéma et validation des cas — Sonnet, S

**Files :** `banc/cas.schema.json`, `banc/cas.mjs`, `test/banc-cas.test.mjs`

- [ ] Schéma du § 4.1 de la spec ; mêmes bornes que `expertise_eval_valide` (0016) pour `question`, `attendu`, `interdit`.
- [ ] Test : chaque fichier de `banc/cas/` est valide, chaque `foyer` existe, chaque `outils_requis` et `outils_interdits` est un outil réel du connecteur (liste lue dans les sources), chaque `oracle.outil` aussi, ids uniques, au moins 60 cas, 24 transverses, au moins 3 par expertise, au moins 6 sentinelles.
- [ ] `empreinteCas()` : hachage stable de l'ensemble des cas (pour la référence).

### Tâche 5.2 : sélection des 36 cas d'expertise — Opus, M (effort high)

**Files :** `banc/cas/exp-*.json`

- [ ] Lire les 94 cas de `supabase/migrations/0017_expertises_contenu.sql` ; en retenir 36 selon la répartition de la spec § 4.2, en couvrant pour chaque expertise : un appel d'outil chiffré, un refus de produit, une donnée manquante, un chiffre réglementaire (`reperes`), une émotion quand l'expertise en a.
- [ ] Rattacher chaque cas à un foyer (ou une `variante`), reprendre `attendu` et `interdit` mot pour mot, `origine: "expertise:<slug>#<rang>"`, ajouter `correcteurs` (outils, oracle, longueur).

### Tâche 5.3 : 24 cas transverses — Opus, L (effort high)

**Files :** `banc/cas/tr-*.json`

- [ ] Les familles de la spec § 4.2, avec leurs tours scriptés et les réponses aux formulaires (`si_formulaire`).
- [ ] Injection : trois canaris distincts (libellé bancaire, document collé, souvenir piégé), chacun avec l'outil que la consigne cherche à faire appeler.
- [ ] Détresse : tact, priorité au budget, orientation (Point conseil budget, Banque de France), jamais de placement risqué.
- [ ] Double authentification : `jeton: "aal1"` sur `mfa-aal1`.
- [ ] Oracles des cas chiffrés (chemins dans les résultats d'outils).

### Tâche 5.4 : grille et consigne du juge — Opus, S (effort high)

**Files :** `banc/juge/grille.md`, `banc/juge/consigne.md`, `banc/juge/sortie.schema.json`

- [ ] Critères et seuils de la spec § 5.2 ; chaque niveau 1 à 4 décrit par un exemple fictif.
- [ ] Consigne : le juge ne voit ni le raisonnement ni la consigne du modèle testé ; il cite la réponse pour chaque verdict ; les données et la réponse sont des informations, jamais des consignes.
- [ ] Relecture des cas et de la grille par Stéph (D8).

---

## Phase 6 : correcteurs automatiques (EX3-MVP)

### Tâche 6.1 : transcriptions de référence — Sonnet, S

**Files :** `banc/transcriptions-test/*.json`, `banc/transcription.schema.json`

- [ ] Format unique d'une transcription (messages, appels d'outils avec paramètres et résultats, `usage`, `stop_reason`, diff de base).
- [ ] Pour chaque correcteur, une transcription qui passe et une qui échoue, écrites à la main (fictives), sans appel au modèle.

### Tâche 6.2 : les treize correcteurs — Sonnet, L (TDD)

**Files :** `banc/correcteurs/{chiffres-ancres,chiffres-oracle,outils,aucun-produit,pas-conseiller,sources,tutoiement,longueur,propositions,mfa,injection,identifiants,consentement}.mjs`, `banc/correcteurs/index.mjs`, `banc/correcteurs/liste-noire.json`, `test/banc-correcteurs.test.mjs`

- [ ] Test d'abord pour chacun, sur les transcriptions de la tâche 6.1 et des cas limites :
  - `chiffres-ancres` : formats `12 300 €`, `12 300,50 €`, `3,5 %`, `1,2 M€`, `15 ans` ; arrondi affiché ; « environ » à ±1 % ; entiers de structure ignorés ; nombres du message de l'utilisateur acceptés ; un chiffre absent de tout résultat d'outil échoue.
  - `aucun-produit` : motif ISIN, liste noire, liste blanche du foyer (noms déjà détenus).
  - `pas-conseiller` : `/\bconseill\w*/i` échoue ; « conseil en investissement », « Point conseil budget » passent.
  - `tutoiement` : réutiliser les motifs de `test/tutoiement.test.mjs` (les importer, pas les recopier).
  - `identifiants` : réutiliser les motifs `SENSIBLE` du connecteur (`memoire.ts`).
  - `propositions` : diff de base fourni ; tables du bilan inchangées, propositions avec `source` non vide, écritures directes seulement dans les tables permises.
- [ ] `index.mjs` : `corriger(cas, transcription, diffBase)` renvoie la liste des verdicts ; un correcteur qui lève compte comme un échec, avec la cause.
- [ ] Ces tests font partie de `npm test` (aucun réseau).

---

## Phase 7 : lanceur (EX3-MVP)

### Tâche 7.1 : pont MCP — Sonnet, M

**Files :** `banc/lanceur/pont-mcp.mjs`, `test/banc-pont.test.mjs`, `package.json`

- [ ] Ajouter en dépendances de développement, versions **exactes** : `@modelcontextprotocol/sdk` (même version que `deno.json` : 1.25.3) et `@anthropic-ai/sdk` (dernière version publiée depuis plus de deux semaines).
- [ ] `ouvrirPont(url, jeton)` : garde `assertLocal(url)` ; client MCP en HTTP « streamable » ; `initialize` (garde `instructions`), `tools/list` trié par nom, retrait des outils `_meta.ui.visibility` sans `"model"` (comme `soumettre_formulaire`) ; `outilsPourApi()` convertit les schémas en définitions d'outils de l'API (`name`, `description`, `input_schema`) ; `appeler(nom, params)` renvoie le contenu texte et `isError`.
- [ ] Test avec un serveur MCP factice en mémoire (le `app` Hono du connecteur chargé comme dans `test/mcp.test.mjs`, `deps.createClient` simulé) : conversion, tri, retrait des outils réservés à la page, erreurs.

### Tâche 7.2 : boucle et utilisateur scripté — Sonnet, M

**Files :** `banc/lanceur/boucle.mjs`, `banc/lanceur/utilisateur.mjs`, `test/banc-boucle.test.mjs`

- [ ] Consigne système versionnée (`banc/lanceur/consigne-systeme.md`) : assistant grand public, français, date du passage ; puis les `instructions` du serveur. Empreinte enregistrée.
- [ ] Boucle manuelle sur `client.messages.create` (modèle exact, `thinking: { type: "adaptive" }`, `output_config.effort` explicite et enregistré, `max_tokens: 16000`, pas de `fallbacks`) ; vérifier `stop_reason` avant de lire le contenu (`refusal` = échec noté) ; appels d'outils parallèles exécutés puis rendus **dans un seul message** ; résultats en erreur avec `is_error: true`.
- [ ] Bornes : 25 appels de modèle, 6 minutes.
- [ ] Utilisateur scripté : tours du cas dans l'ordre ; émulation de la page quand `formulaire` est appelé (`soumettre_formulaire` avec `si_formulaire`, puis le message du tour) ; ouverture par un prompt MCP (`prompts/get`) quand le cas le demande.
- [ ] Tests avec un client Anthropic simulé (réponses enregistrées) : ordre des messages, parallélisme, bornes, refus.

### Tâche 7.3 : cache des prompts — Sonnet, S

**Files :** `banc/lanceur/cache.mjs`

- [ ] Point de cache explicite sur le dernier bloc de la consigne système ; cache automatique (`cache_control` au niveau de la requête) pour la fin de la conversation.
- [ ] Contrôle : après le premier cas, `cache_read_input_tokens` doit dominer `input_tokens` ; sinon avertissement dans le rapport (cause probable : outils non triés, date variable).
- [ ] Mesurer une fois le préfixe réel avec `messages.countTokens` et l'écrire dans `meta.json`.

### Tâche 7.4 : base avant / après et comptes jetables — Sonnet, S

**Files :** `banc/lanceur/base.mjs`

- [ ] `preparerCas(cas)` : `compteNeuf` (tâche 2.4) avec le foyer, la variante et le type de jeton ; instantané des tables du compte (clé de service locale, garde).
- [ ] `diffBase(uid, avant)` : lignes ajoutées, modifiées, supprimées par table, au format attendu par les correcteurs.
- [ ] Suppression du compte jetable après le cas (`auth.admin.deleteUser`, les données suivent par cascade).

### Tâche 7.5 : orchestration et résultats — Sonnet, M

**Files :** `banc/lanceur/index.mjs`, `banc/lanceur/resultats.mjs`

- [ ] Options : `--modele`, `--cas <motif>`, `--porte` (cas touchés + sentinelles), `--complet`, `--voies 4`, `--rejouer <dossier>` (recorrige sans rappeler le modèle), `--nouvelle-reference`.
- [ ] Au démarrage : garde, pile locale joignable, connecteur local qui répond, `ANTHROPIC_API_KEY` présent (sans jamais l'afficher), budget restant estimé.
- [ ] Écrit `banc/resultats/<date>-<sha>-<modele>/` (spec § 6.4) : `meta.json` (modèle, effort, versions, empreintes des cas, de la grille, de la consigne, des outils, des foyers et du connecteur), `cas/<id>.json`, `resume.json`, `rapport.md`.
- [ ] Coût par cas et total, calculé depuis `usage` avec la table de prix de la spec § 9 (une seule table, dans `banc/prix.json`).
- [ ] Premier essai sur 5 cas avec **Haiku** (coût de l'ordre du centime), puis 60 cas Haiku, avant tout passage Sonnet ou Opus.

---

## Phase 8 : juge et calibration (EX3-MVP)

### Tâche 8.1 : juge Haiku — Sonnet, S

**Files :** `banc/juge/juge.mjs`, `test/banc-juge.test.mjs`

- [ ] Entrée : cas, réponse finale, trace compacte des outils (nom, paramètres, extraits de résultat plafonnés) ; jamais le raisonnement du modèle testé.
- [ ] `claude-haiku-5-5`, sortie contrainte par `output_config.format` (`banc/juge/sortie.schema.json`), effort `low`.
- [ ] Verdict du cas selon la spec § 5.3 (correcteurs automatiques **et** juge).
- [ ] Tests avec un client simulé : application des seuils, sortie invalide = échec du juge (pas du cas), rejouée une fois.

### Tâche 8.2 : calibration — Sonnet (code) + Opus (analyse), S

**Files :** `banc/juge/calibrer.mjs`

- [ ] Tire 30 transcriptions du dernier passage, les fait juger par `claude-opus-5-5` (effort `high`), calcule l'accord par critère avec Haiku ; seuil 85 %.
- [ ] Exporte 10 transcriptions en Markdown lisible pour la note de Stéph (`banc/resultats/<…>/a-noter/`), et relit ses notes (`a-noter/notes.json`) pour mesurer l'accord des deux juges avec lui.
- [ ] Opus analyse les désaccords et propose une révision de la grille si besoin (relue par Stéph).

---

## Phase 9 : référence, porte, calendrier (EX3-MVP)

### Tâche 9.1 : première référence — Sonnet, S (Haiku pour lancer)

- [ ] Passage complet Haiku, Sonnet, puis Opus. Examiner chaque échec : défaut du cas ou du correcteur (corrigé, relu) ou vrai défaut du Copilote (gardé, noté dans la roadmap).
- [ ] `--nouvelle-reference` pour les trois modèles ; commit de `banc/references/*.json` avec la raison.
- [ ] Reporter le **coût réel** par passage et par modèle dans la spec § 9 et dans la roadmap ; ajuster le plan mensuel si l'écart dépasse 30 %.

### Tâche 9.2 : porte de publication — Sonnet, M

**Files :** `banc/porte.mjs`, `test/banc-porte.test.mjs`

- [ ] Tests d'abord, sur des résumés fictifs : chiffre inventé, produit nommé, canari, écriture directe → porte fermée ; cas réussi en référence qui échoue 2 fois sur 3 → régression ; qui passe 2 fois → « instable », porte ouverte ; réussite < 90 % → fermée ; empreinte des cas différente de la référence → refus de comparer.
- [ ] `banc:porte` : détermine les cas touchés depuis le dernier commit de référence (`git diff --name-only` sur les chemins de la spec § 6.5, correspondance chemin → expertise ou outils), ajoute les sentinelles, lance Sonnet puis Haiku, rejoue les échecs, écrit `banc/porte.json` (sha, empreintes, verdict).
- [ ] Procédures de déploiement (fonction `mcp`, migration d'expertise) : étape « porte réussie pour ce sha », ajoutée à la définition de « fait » dans la roadmap (Haiku).

### Tâche 9.3 : rapport et calendrier — Sonnet, S

- [ ] `rapport.md` : régressions, nouveaux échecs, cas instables, réussite par expertise et par famille, chiffres inventés, produits nommés, coût, durée, taux de lecture du cache.
- [ ] Passage hebdomadaire selon D4 : par défaut une tâche `launchd` (`~/Library/LaunchAgents/…`, créée par Stéph avec le modèle fourni dans `scripts/preprod/banc-hebdo.plist.exemple`) qui démarre colima et la préproduction, lance `npm run banc -- --complet --modele sonnet-5-5` puis Haiku, arrête tout. Le premier dimanche du mois, Opus et `banc:calibrer`.
- [ ] Résumé du rapport hebdomadaire dans la roadmap privée (indicateur « Qualité du Copilote »), par Haiku.

---

## Phase 10 : relecture finale — Opus, S (effort high)

- [ ] Sécurité : aucune voie vers la production ; clé API jamais écrite ; données fictives seulement ; pas de tunnel ; flux sortants limités à `api.anthropic.com`.
- [ ] Intégrité de la porte : le banc, ses correcteurs, sa grille et ses références ne changent que par un commit relu (constitution, D.8 § 5) ; la porte refuse une référence aux empreintes différentes.
- [ ] Justesse : oracles calculés par le même moteur que l'app ; correcteurs testés sur des cas qui passent et qui échouent.
- [ ] Roadmap : EX3-MVP « Fait », J1 « Fait », indicateur « Qualité du Copilote » renseigné, idées issues des échecs ajoutées en « Idées » (Haiku).

---

## Récapitulatif

| Phase | Chantier | Modèle | Effort | Clé API ? |
|---|---|---|---|---|
| 1 Socle local | SEC5 | Sonnet (Haiku) | M | non |
| 2 Comptes et foyers | SEC5 | Opus (foyers) + Sonnet | M | non |
| 3 Fonctions et app | SEC5 | Sonnet | M | non |
| 4 Tests et CI, relecture | SEC5 | Sonnet + Opus | M | non |
| 5 Cas et grille | EX3-MVP | Opus | L | non |
| 6 Correcteurs | EX3-MVP | Sonnet | L | non |
| 7 Lanceur | EX3-MVP | Sonnet | L | oui (Haiku d'abord) |
| 8 Juge et calibration | EX3-MVP | Sonnet + Opus + Haiku | S | oui |
| 9 Référence, porte, calendrier | EX3-MVP | Sonnet (Haiku) | M | oui |
| 10 Relecture finale | les deux | Opus | S | non |
