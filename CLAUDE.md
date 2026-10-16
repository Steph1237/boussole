# Boussole — notes pour Claude

App de pilotage patrimonial. Spec : `docs/superpowers/specs/`, plans : `docs/superpowers/plans/`.

## Stack
- Front : HTML/CSS/JS vanilla, sans framework ni bundler. Sources dans `web/` (modules dans `web/src/`).
- `build.mjs` assemble `web/` dans `dist/` ; GitHub Pages publie `dist/` à chaque push sur `main` (`.github/workflows/pages.yml`).
- Back : Supabase (Postgres + RLS, Auth, Edge Functions Deno, pg_cron).
  - Migrations : `supabase/migrations/NNNN_nom.sql` (numérotées, à la suite).
  - Fonctions : `supabase/functions/{mcp,nightly,powens,resolve-symbol}`.
- Tests : `node --test` (pas de framework). PGlite (`@electric-sql/pglite`) pour les tests SQL hors ligne.
- Node 22 (CI et local via nvm, `nvm alias default 22`). Deno via `npx -y deno` pour les vérifications de types.

## Commandes
- Installer : `npm ci`
- Tester : `npm test` (~3 600 tests, 99 ignorés sans `BOUSSOLE_LIVE=1`)
- Un fichier : `node --test test/<nom>.test.mjs`
- Builder : `npm run build` (sortie `dist/`) ; `npm run dev` (sortie `dist-dev/`)
- Types des fonctions : `npm run check:fonctions`
- Fichiers générés : `npm run gen` (catalogue, expertises démo, police) ; les `*.gen.js` ne s'éditent pas à la main.
- Préprod locale : `npm run preprod:start`, puis `preprod:app`, `preprod:test`, `preprod:stop`.

## Conventions
- Code, commentaires, noms de fonctions et messages en français.
- Commits : `type(lot): description en français` (feat, fix, test, docs, polish), par ex. `fix(bud1): …`.
- Une branche par lot, PR vers `main`.
- La clé publiable de `web/config.js` est publique par nature : la sécurité repose sur RLS, jamais sur le secret de cette clé.
- Toute nouvelle table : RLS activé et politiques dans la même migration.

## Pièges
- **Production** : `web/config.js` pointe sur la prod (`oapcewpqsbbjdlcdeizi`). Ne jamais lancer de `supabase link`,
  `db push`, `functions deploy` ou `secrets` : `test/preprod-ci.test.mjs` les interdit dans les scripts.
- `scripts/migrate-steph.mjs` écrit en PRODUCTION (garde `BOUSSOLE_PROD=1`) : ne pas le lancer.
- La préprod refuse toute config qui nomme la prod (garde dans `build.mjs` et `scripts/preprod/garde.mjs`).
- Sandbox Claude Code : `test/preprod-fumee.test.mjs` écoute sur 127.0.0.1, ce qui échoue avec EPERM sous le sandbox
  (il faut `sandbox.network.allowLocalBinding: true`). `npm ci` sous le sandbox a besoin de `--cache "$TMPDIR/npm-cache"`.
- Les tests à fuseau (`aujourdhui.test.mjs`) modifient `TZ` : ne pas supposer Europe/Paris dans le code.
- `.env*`, `.preprod/`, `dist*/` sont ignorés par git ; la clé de service locale n'est jamais écrite sur disque.
