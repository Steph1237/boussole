# RT1 : routines obligatoires (revue mensuelle) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal :** chaque utilisateur a une revue mensuelle activée par défaut à l'onboarding. Elle est exécutée par une tâche planifiée de son Claude, ou lancée à la main. Boussole sait quand la revue est due et la réclame : Aujourd'hui, `demarrer_session`, Agent › Connexion. La revue prépare une synthèse et les questions du mois ; l'utilisateur y répond ensuite avec Claude.

**Spec :** `docs/superpowers/specs/2026-10-11-rt1-routines.md`. La migration est renumérotée **0020**.

**Repères :**
- Dépôt : `/Users/stephane/boussole`.
- Tests : `npm test`. Build : `node build.mjs`.
- PGlite : `test/helpers/pglite.mjs` (`baseAvec`, `comme`), avec pour modèle `test/journal-pglite.test.mjs`.
- Tutoiement partout (`test/tutoiement.test.mjs`).
- App en lecture seule (`test/lecture-seule.test.mjs`). Seule écriture permise ici : la bascule pause/active.

**Ordre :** les tâches 1, 2, 3 et 4 se font en parallèle, sur des fichiers disjoints. La tâche 5 (contrôleur) intègre, relit et déploie.

## Contrats communs (à respecter à l'identique dans toutes les tâches)

### Prompt de la tâche planifiée
Constante `PROMPT_TACHE.revue_mensuelle`, texte exact :
`Boussole : fais ma revue mensuelle. Appelle demarrer_routine avec le type revue_mensuelle et suis la conduite qu'il renvoie.`

Elle est définie deux fois, avec un test d'égalité (tâche 2) :
- dans `supabase/functions/mcp/routines.ts` ;
- dans `web/src/claude-prompts.js` (`ClaudePrompts.PROMPT_TACHE`).

### Table `public.routines` (migration 0020)

| Colonne | Définition |
|---|---|
| `user_id` | uuid, défaut `auth.uid()`, références `auth.users` on delete cascade |
| `type` | text, check `in ('revue_mensuelle')`, contrainte nommée `routines_type` |
| `jour` | int, défaut 1, check 1–28 |
| `active` | bool, défaut true |
| `consentement_journal` | bool, défaut true |
| `dernier_passage` | timestamptz |
| `dernier_client` | text ≤ 100 |
| `prochain_passage` | date |
| `questions` | jsonb, défaut `'[]'` |
| `synthese` | text ≤ 4000 |
| `cree_le`, `maj_le` | timestamptz, défaut now() |

- Clé primaire : `(user_id, type)`.
- `questions` est un tableau d'au plus 10 éléments, de 10 000 octets au plus. Chaque élément vaut `{ question (1–300 caractères), pourquoi? (≤ 300), champ? (≤ 60, identifiant du catalogue des formulaires) }`. La validation se fait dans `cloturer_routine` et `questions_routine`, et la contrainte ne garde que le tableau et sa taille.
- Contrainte nommée `routines_contenu_sensible` : `not (public.contenu_sensible(synthese) or public.contenu_sensible(questions::text))`.
- RLS propriétaire, sur le modèle de `0013_journal.sql` :
  - 4 politiques ;
  - `revoke all … from anon, authenticated` ;
  - `grant select, insert, update, delete … to authenticated`.
- Fonction pure `public.routine_date(p_jour int, p_depuis date, p_ecart int) returns date` (immutable, `search_path` vide) :
  - premier jour `p_jour` d'un mois qui tombe au plus tôt le `p_depuis + p_ecart` ;
  - exemples : `(1, '2026-10-11', 7)` → `2026-11-01` ; `(15, '2026-10-01', 7)` → `2026-10-15` ; `(28, '2026-12-25', 7)` → `2027-01-28`.
- Aujourd'hui, à Paris : `(now() at time zone 'Europe/Paris')::date`, noté `auj` ci-dessous.
- Déclencheur `routines_maj`, avant update :
  - `maj_le := now()` ;
  - si `jour` change, ou si `active` passe de false à true : `prochain_passage := routine_date(new.jour, auj, 7)`.
- Déclencheur avant insert : si `prochain_passage` est null, `routine_date(jour, auj, 7)`.
- RPC `public.activer_routine(p_type text, p_jour int default null, p_consentement_journal bool default null) returns public.routines` (security invoker, `search_path` vide) :
  - upsert : création avec les défauts, ou réactivation ;
  - un `p_jour` ou un `p_consentement_journal` non null remplace la valeur ;
  - `active := true` ;
  - renvoie la ligne.
- RPC `public.cloturer_routine(p_type text, p_client text, p_synthese text, p_questions jsonb) returns public.routines` (security invoker) :
  - crée la routine si elle n'existe pas (active, jour 1) ;
  - valide les questions comme ci-dessus, avec des messages en français ;
  - pose `dernier_passage = now()`, `dernier_client = left(p_client, 100)`, la synthèse et les questions ;
  - calcule `prochain_passage = routine_date(jour, auj, 10)` ;
  - idempotente sur un même jour : un second appel donne la même date ;
  - renvoie la ligne.
- `revoke all on function … from public, anon ; grant execute … to authenticated` pour les deux RPC et pour `routine_date`.
- `export_all()` : repartir **exactement** de la définition de `0013_journal.sql` et ajouter `'routines'`, triées par `type`.

### En retard, prête, à activer (même règle côté connecteur et côté app)
- **Due / en retard :**
  - condition : `active` et `prochain_passage <= auj` et (`dernier_passage` null ou `dernier_passage::date < prochain_passage`) ;
  - `retard_jours = auj - prochain_passage` (0 = due aujourd'hui).
- **Prête :** `questions.length > 0`.
- **À activer :** aucune ligne `revue_mensuelle`.

### Store (app)
- `S.routines = [{ type, jour, active, consentementJournal, dernierPassage, dernierClient, prochainPassage, questions: [{ question, pourquoi, champ }], synthese }]`.
- Table absente : valeur précédente (`[]` au départ), comme `journal`.
- `Store.routines.pause(type, enPause)` → `{ ok: true }` ou `{ erreur }`. Seule écriture : `update routines set active = !enPause where type = …`.
- Démo : une routine `revue_mensuelle` active, jour 1, dernier passage le 1er du mois courant (client « Claude »), prochain passage le 1er du mois suivant, 2 questions réalistes et une synthèse de 3 lignes.

## Task 1 : migration `supabase/migrations/0020_routines.sql` et `test/routines-pglite.test.mjs`
- [ ] Écrire les tests PGlite d'abord, avec les migrations `0009 → 0014` puis `0020` (vérifier ce dont `export_all` a besoin dans les bouchons, et compléter `test/helpers/pglite.mjs` si une table manque).
- [ ] Ces tests couvrent :
  - la RLS : B ne voit ni ne modifie A ;
  - `routine_date`, avec les 3 exemples et le 28 décembre ;
  - `activer_routine` : défauts, jour 31 refusé, réactivation qui recalcule ;
  - le déclencheur : le passage de la pause à l'activité recalcule, le changement de jour recalcule ;
  - `cloturer_routine` : passage, idempotence sur la journée, 11 questions refusées, question vide refusée, IBAN dans la synthèse refusé par `routines_contenu_sensible`, création si absente ;
  - `export_all` contient `routines`.
- [ ] Écrire la migration, avec un en-tête de commentaires au format des précédentes (« Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration (name = "routines") »).
- [ ] Lancer `node --test test/routines-pglite.test.mjs`, puis `npm test`.
- [ ] Ne pas committer : le contrôleur committe.

## Task 2 : connecteur — `supabase/functions/mcp/routines.ts`, `index.ts` et `test/routines-mcp.test.mjs`

### Module `routines.ts`
Modèle : `journal.ts`, dépendances injectées. Exporte :
- `PROMPT_TACHE`, `TYPES_ROUTINE = ["revue_mensuelle"]` ;
- `CONDUITE_REVUE` : texte au tutoiement ;
- `registerRoutines(server, h)` ;
- `routinesDeSession(db, must, auj)`, qui ne lève jamais et renvoie `[{ type, active, jour, prochain_passage, retard_jours | null, questions_en_attente, dernier_passage }]` (vide si la table est absente).

### Outils
1. **`activer_routine({ type, jour?, consentement_journal? })`** (RW) :
   - appelle la RPC ;
   - renvoie `{ routine, prompt_tache: PROMPT_TACHE[type], frequence: "Chaque mois, le <jour>", etapes: [...] }` ;
   - les 4 étapes, au tutoiement, pour créer la tâche planifiée dans Claude : ouvrir les tâches planifiées, coller le prompt, choisir « chaque mois » et le jour, vérifier que le connecteur Boussole est activé pour la tâche ;
   - plus une consigne : « Boussole ne peut pas vérifier que la tâche existe : demande à l'utilisateur de confirmer. »
2. **`demarrer_routine({ type })`** (RO), renvoie :
   - `conduite: CONDUITE_REVUE` et la `routine` ;
   - `depuis` : dernier passage, ou 30 jours ;
   - `patrimoine` : net actuel, et variation depuis `depuis` à partir de `snapshots` (le plus proche avant ou égal à `depuis`) ;
   - `soldes_anciens` : positions actives en mode manuel dont `value_date` a plus de 30 jours (nom, enveloppe, date, jours) ;
   - `budget` : totaux revenus / dépenses / épargne, ou null ;
   - `objectifs` : nom, statut, effort mensuel, avec les mêmes calculs que `list_objectifs` ;
   - `alertes` : celles de la table `status` si elles y sont, sinon `[]` ;
   - `revues_dues` : celles de `journalDeSession` ;
   - `nouveautes_savoir` : nouveautés depuis `depuis` ;
   - `propositions_en_attente` ;
   - `questions_precedentes` : les questions de la routine.

   Les calculs sont injectés depuis `index.ts` (`calcul`), pour ne rien dupliquer : lire `index.ts`, réutiliser `chargerDonnees`, `bilan`, `budgetTotaux` et les fonctions de `list_objectifs`.
3. **`cloturer_routine({ type, synthese (1–4000), questions })`** (RW) :
   - refuse un contenu sensible avant tout appel, avec `estSensible` de `memoire.ts` ;
   - appelle la RPC avec `p_client = client?.nom ?? "Assistant"` ;
   - écrit ensuite au journal une entrée si `routine.consentement_journal`, ou si `journal_consentement === "prevenir"` :
     - type `revue`, statut `a_relire` ;
     - titre « Revue mensuelle du JJ/MM/AAAA » ;
     - synthèse : les 600 premiers caractères, coupés au dernier espace, avec « … » ;
     - raisonnement : la synthèse complète, plus « ## Questions du mois » et la liste ;
     - état figé avec `etatFige` de `journal.ts` ; source : le client ;
   - un échec du journal ne fait pas échouer la clôture : il est renvoyé dans `journal: { ecrit: false, raison }` ;
   - renvoie `{ routine, prochain_passage, journal }` et une consigne pour dire à l'utilisateur où relire.
4. **`questions_routine({ type, questions })`** (RW) :
   - remplace les questions en attente : `update` direct sur la table, mêmes validations côté connecteur ;
   - à appeler quand l'utilisateur a répondu, avec les questions restantes (`[]` si toutes sont traitées).

### `CONDUITE_REVUE` (points à couvrir)
1. Exécution planifiée : l'utilisateur n'est pas là. Ne pose pas de question en direct, prépare.
2. Compare avec le passage précédent : patrimoine, soldes anciens, budget, objectifs, alertes, revues dues, nouveautés, propositions en attente, questions précédentes restées sans réponse (reprends-les).
3. Rédige une synthèse de 5 points au plus, en français simple, sans recommandation de produit.
4. Prépare au plus 10 questions du mois, chacune avec son pourquoi et son `champ` du catalogue quand il existe :
   - nouveaux flux (versements, achats, ventes, retraits) ;
   - changement de salaire ;
   - nouveaux prélèvements ou abonnements ;
   - soldes à confirmer ;
   - relevés à déposer.
5. N'écris rien dans le bilan, et ne dépose aucune proposition sans l'utilisateur.
6. Appelle `cloturer_routine`. Si l'utilisateur est présent (lancement manuel), propose ensuite de répondre tout de suite, avec le formulaire pour les questions qui ont un `champ`, puis `questions_routine` avec ce qui reste.

### Intégration dans `index.ts`
- Import et enregistrement après `registerJournal`, avec `calcul`.
- `demarrer_session` renvoie en plus `routines: await routinesDeSession(...)`.
- `CONDUITE_EXPERT`, nouvelle règle 12 : si une routine est en retard ou si des questions attendent, propose-le en premier ; pour répondre, formulaire puis `questions_routine` ; si aucune routine n'existe, propose d'activer la revue mensuelle (`activer_routine`).
- `CONDUITE_ONBOARDING`, nouvelle section « 6. Revue mensuelle » :
  - 6.1 : explique en deux phrases ;
  - 6.2 : elle est activée par défaut ; demande seulement le jour (1er du mois par défaut) et l'accord pour déposer la revue au journal ;
  - 6.3 : appelle `activer_routine`, sauf refus explicite ;
  - 6.4 : guide la création de la tâche planifiée avec `prompt_tache` et les étapes, puis fais confirmer.
- Prompt MCP `revue_mensuelle` : son objectif devient « Je veux faire ma revue mensuelle maintenant. Appelle demarrer_routine avec le type revue_mensuelle et suis sa conduite ; je suis là, tu peux me poser les questions du mois ensuite. »
- `INSTRUCTIONS` : une ligne « Routines (activer_routine, demarrer_routine, cloturer_routine, questions_routine) … ».
- Corriger au passage, dans `CONDUITE_ONBOARDING`, « Rôle : tu es un conseiller en gestion de patrimoine pédagogue » → « Rôle : tu es le copilote patrimonial de l'utilisateur, pédagogue ». Boussole ne se présente jamais comme conseiller.

### Tests (`test/routines-mcp.test.mjs`, et `test/mcp.test.mjs` si une assertion existante change)
Exécution vm avec une base factice, sur le modèle des tests de `journal.ts` et `memoire.ts` dans `test/mcp.test.mjs`. Ils couvrent :
- les 4 outils enregistrés ;
- `activer_routine`, qui renvoie `prompt_tache` égal à `ClaudePrompts.PROMPT_TACHE.revue_mensuelle` (lire `web/src/claude-prompts.js` avec `createRequire`) ;
- `cloturer_routine`, qui écrit au journal avec `consentement_journal` à true, n'écrit pas avec false et `demander`, écrit avec false et `prevenir` ;
- un refus de contenu sensible ;
- un échec du journal, qui n'empêche pas la clôture ;
- `demarrer_session`, qui contient `routines` avec `retard_jours` ;
- l'absence de « vous » dans `CONDUITE_REVUE` et les nouveaux textes ;
- l'absence de « conseiller » dans `CONDUITE_ONBOARDING`.

Ne pas committer.

## Task 3 : store, démo, Aujourd'hui et phrases Claude
**Fichiers :**
- `web/src/store-supabase.js`, `web/src/store-demo.js`, `web/src/demo-data.js` ;
- `web/src/claude-prompts.js` et `test/claude-prompts.test.mjs` ;
- `web/src/aujourdhui.js` et `test/aujourdhui.test.mjs` ;
- `test/store-contract.test.mjs`.

**Étapes :**
- [ ] Ajouter dans `claude-prompts.js` : `PROMPT_TACHE = { revue_mensuelle: "<texte exact du contrat>" }`, exporté.
- [ ] Ajouter dans `claude-prompts.js` une section `routine` : « réponds avec moi aux questions de ma revue mensuelle (demarrer_routine, puis le formulaire, puis questions_routine). »
- [ ] Stores : implémenter `S.routines` et `Store.routines.pause`, en suivant le contrat ci-dessus. La lecture se fait dans le même `Promise.all` que le journal ; mettre à jour les commentaires de contrat en tête de fichier.
- [ ] `aujourdhui.js` (`boite`), ajouter le type `routine` :
  - **prête** : urgence 1, titre « Ta revue du mois est prête : N question(s) », contexte = première question, action `{ label: "Répondre avec Claude", url: urlClaude(ClaudePrompts.phrase("routine", premières questions)) }` ;
  - **en retard** (prioritaire sur « prête ») : urgence 2, titre « Revue mensuelle en retard de N jour(s) » (« due aujourd'hui » si 0), action `{ label: "Lancer ma revue avec Claude", url: urlClaude(ClaudePrompts.phrase("revue")) }` ;
  - **en pause** : rien ;
  - **à activer** : uniquement si `S.dbOk` et `routines` lu ; urgence 3, « Active ta revue mensuelle », action `{ label: "Voir comment", route: "agent/connexion" }` ;
  - `TYPE_TXT` et le rendu sont mis à jour.
- [ ] Tests : les 4 cas, plus « ni prête ni en retard », plus le tutoiement. Le contrat du store vérifie `routines` et `routines.pause`. La démo doit afficher l'élément « prête ».
- [ ] `npm test`. Ne pas committer.

## Task 4 : Agent › Connexion (section Routines) et accueil
**Fichiers :**
- `web/src/claude-guide.html`, `.js`, `.css` et `test/claude-guide.test.mjs` ;
- `web/src/accueil.js` et `test/accueil.test.mjs`.

**Contrat :** lire `S.routines` comme défini plus haut, sans modifier les stores. `ClaudePrompts.PROMPT_TACHE` est ajouté par la tâche 3 : prévoir un repli identique si la propriété est absente.

**Étapes :**
- [ ] Ajouter dans `claude-guide.html` une section `id="cgRoutines"` « Ta revue mensuelle », après « En trois étapes ».
- [ ] Rendu par une fonction pure exportée `routinesHtml(S, auj, U)` :
  - **état :** voyant « Active », « En pause » ou « Pas encore activée » ;
  - « Dernière revue le JJ/MM (par Claude) » ou « Jamais passée » ;
  - « Prochaine le JJ/MM » ou « En retard de N jours » ;
  - les questions en attente (nombre, avec un bouton « Répondre avec Claude ») ;
  - **bascule** : `UI.bascule`, libellé « Revue mensuelle active », qui appelle `Store.routines.pause(type, !coche)` ; erreur affichée en ligne ;
    > **Écart validé** : bascule `role=switch` (modèle `regles.js`) et non `UI.bascule` (groupe radio).
  - **prompt** de la tâche planifiée dans un `<pre>`, avec un bouton « Copier » (`navigator.clipboard.writeText`, retour « Copié ») ;
  - **4 étapes** pour créer la tâche planifiée dans Claude, avec le même texte que les `etapes` du connecteur (tâche 2) ;
  - si aucune routine : une phrase « Elle s'active à la fin de ton premier entretien avec Claude, ou demande-lui : « Active ma revue mensuelle Boussole ». », avec un bouton qui ouvre Claude avec cette phrase.
- [ ] Accueil, étape 4 (« Terminer ») : ajouter un voyant.
  - Si une routine est active : « Revue mensuelle active — prochaine le JJ/MM ».
  - Sinon : « Ta revue mensuelle s'activera à la fin de ton entretien avec Claude. »
  - Lire `Store.get().routines`.
- [ ] Tests :
  - fonctions pures (`routinesHtml` : 4 états, prompt présent, échappement) ;
  - accueil : voyant ;
  - tutoiement ;
  - `test/lecture-seule.test.mjs` doit rester vert. Si elle refuse la bascule, l'ajouter à la liste des écritures de contrôle autorisées, en justifiant.
- [ ] Vérifier visuellement en démo (`node build.mjs`, `#agent/connexion`) : ordinateur et mobile, clair et sombre.
- [ ] `npm test`. Ne pas committer.

**Écart (relecture) :** la règle d'état de la revue (`jourParis`, `aujParis`, `routineDate`, `etat`, `phraseRoutine`) vit dans un seul module, `web/src/routine-etat.js` (`window.RoutineEtat`), chargé par `build.mjs` avant `store-demo` ; Aujourd'hui, Agent › Connexion, l'accueil et le store démo le consomment (`test/routine-etat.test.mjs` : règle, différentiel contre `retardJours` du connecteur, exemples de `routine_date`). « Répondre avec Claude » ne met dans l'URL préremplie que le nombre de questions (« 2 questions en attente ») : leur texte vient d'une exécution planifiée de l'agent et `demarrer_routine` les fournit.

## Task 5 : intégration et déploiement (contrôleur)
- [ ] Relire chaque tâche avec `superpowers:code-reviewer`, puis corriger.
- [ ] `npm test`, `node build.mjs`, puis commit.
- [ ] Appliquer 0020 avec `apply_migration` (name `routines`), puis vérifier le md5 de la fonction et la présence de la table.
- [ ] Push, puis CI Pages.
- [ ] Redéployer le connecteur épinglé sur le nouveau commit.
- [ ] `BOUSSOLE_LIVE=1 node --test test/mcp.test.mjs` et `get_advisors`.
