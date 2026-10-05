# Boussole : application publique de pilotage de patrimoine

Date : 2026-10-05 · Statut : validé par Stéph (sections 1 à 4 + remplissage par assistant)

## Objectif

Transformer l'outil fusionné (Pilotage + Toise + Simulateur + Profil, publié sur claude.ai/artifact/PJFXSuZo6994RykE2ddFXr, code dans ~/Finance) en une application web gratuite, ouverte à tous, où chaque personne a un espace privé. Les données de Stéph y sont migrées.

Décisions prises : outil gratuit sans paiement · front statique + Supabase (projet `boussole`, ref `oapcewpqsbbjdlcdeizi`, région eu-west-3) · code public sur github.com/Steph1237/boussole, hébergé sur GitHub Pages (https://steph1237.github.io/boussole/) · nom de travail « Boussole » · remplissage par assistant : copier-coller universel **et** connecteur MCP, tous deux dans ce chantier.

## Architecture

```
boussole/
  web/                      front statique (publié tel quel sur Pages)
    index.html              accueil : pitch, « Essayer sans compte », « Créer mon compte »
    app.html                l'application (coque + 4 onglets), accessible connecté ou en démo
    compte.html             mon compte : e-mail, connecteurs MCP autorisés, export, suppression
    oauth/consent.html      page de consentement OAuth (connecteurs MCP)
    legal/mentions.html, legal/confidentialite.html
    app/                    calc.js, reel.js, pilotage.js, toise.js, simu.js, profil.js, app.js (repris de ~/Finance/src)
    app/store-supabase.js   adaptateur : même forme de snapshot que l'artefact
    app/store-demo.js       adaptateur mémoire sur données d'exemple
    app/auth.js, app/onboarding.js, app/import.js, app/assistant.js, app/rules.js
    config.js               URL Supabase + clé publiable (publique par nature)
  supabase/
    migrations/*.sql        schéma, RLS, fonctions
    functions/nightly/      cours + photos + versements (cron 22:30 Europe/Paris)
    functions/mcp/          serveur MCP (Streamable HTTP) authentifié par Supabase Auth
  scripts/migrate-steph.mjs export artefact → compte de Stéph
  test/                     calc, port, contrat du store, isolation RLS, nightly
  build.mjs                 assemble web/ (fragments + CSS) → dist/
  .github/workflows/pages.yml
```

Contrat conservé : chaque module appelle `App.register(name, {mount, update(S, visible), show, headline})` avec `S = {ready, dbOk, positions, snapshots, tx, config, status, profil, profilLoaded, scope, people}`. `people = [{id:"p1", nom}, {id:"p2", nom}?]` remplace Stéph/Compagne ; `scope ∈ {"foyer","p1","p2"}`.

## Modèle de données (Postgres, schéma `public`)

Toutes les tables privées portent `user_id uuid not null default auth.uid()` avec `RLS : user_id = auth.uid()` en lecture et écriture.

| Table | Colonnes principales |
|---|---|
| `profiles` | user_id PK, foyer jsonb, personnes jsonb (`{p1:{nom, salaire, salaireUnite, statut, csp, essai, autresRevenus}, p2:…}`), autres jsonb, settings jsonb (matelas en montant ou mois, devise), onboarding_done bool, updated_at |
| `biens` | id, user_id, nom, usage (rp/locatif/secondaire), valeur, part_p1 (0-100), crd, mensualite, loyer |
| `credits` | id, user_id, nom, owner (p1/p2/commun), crd, mensualite |
| `positions` | id, user_id, name, envelope, owner (p1/p2), bloc, mode (market/manual), isin → instruments, qty, pru, value, value_date, status (actif/à recevoir/clôturé), hypothesis, qty_estimated, note |
| `transactions` | id, user_id, position_id, date, type, qty, price, amount, note, source (manuel/nightly/mcp/import), created_at |
| `snapshots` | user_id, date PK, total, p1, p2, by_bloc jsonb, by_envelope jsonb, source |
| `config` | user_id PK, targets jsonb (`{p1:{…}, p2:{…}, tolerancePts}`), rules jsonb (alertes paramétrables), cushion jsonb, recurring jsonb, todo jsonb, milestones jsonb, hypotheses jsonb |
| `status` | user_id PK, last_run, summary, alerts jsonb, missing_prices int |
| `instruments` (partagée) | isin PK, symbol, name, currency, price, price_date, source, requested_by, created_at. Lecture : tout utilisateur connecté. Insertion : RPC `request_instrument(isin, name, symbol)` (sans prix). Mise à jour du prix : rôle service uniquement. |
| `job_runs` | id, started_at, finished_at, ok, users int, instruments int, errors jsonb. Lecture : service. |
| `oauth_grants` (vue) | les connecteurs autorisés de l'utilisateur, via l'API Supabase Auth |

Règles d'alerte (`config.rules`), remplaçant les alertes codées en dur : `{type:"max_line_pct", pct}`, `{type:"max_bloc_pct", bloc, pct}`, `{type:"price_floor", position_id, price}`, `{type:"envelope_cap", envelope, cap}`, `{type:"stale_prices", days}`. Le matelas : `cushion = {mode:"amount", min, max}` ou `{mode:"months", months, depenses}`.

Compte : suppression = `delete from auth.users` en cascade (FK `on delete cascade` partout). Export : RPC `export_all()` renvoie un JSON de toutes les tables de l'utilisateur.

## Fonction nocturne (`nightly`, Edge Function, cron pg_cron 22:30 Europe/Paris via pg_net)

1. Cours : pour chaque instrument, GET `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d` ; dernier close ; conversion en EUR via `EURUSD=X` etc. si devise ≠ EUR. Échec → cours inchangé, compteur `missing_prices`.
2. `take_snapshots()` (SQL, security definer) : pour chaque utilisateur, totaux foyer / p1 / p2, par poche, par enveloppe ; upsert `snapshots(date = today)`.
3. `apply_recurring()` (SQL) : versements dont `day = jour du mois` et `start ≤ today` et `last_applied ≠ mois courant` → transaction `source = nightly` + position (qty += amount/price pour market ; value += amount pour manual).
4. `status` par utilisateur ; `job_runs` global.

Résolution de symbole à l'ajout d'un instrument : Edge Function `resolve-symbol` (GET Yahoo search `?q={isin}`), corrigeable par l'utilisateur.

## Comptes et sécurité

- Supabase Auth : e-mail + mot de passe, lien magique, Google (à activer dans le dashboard avec les identifiants Google de Stéph ; livré sans Google si absents).
- Clé publiable dans `config.js` ; aucune clé secrète dans le repo. Secrets des fonctions dans les secrets du projet.
- Audit `get_advisors(security)` après chaque migration ; zéro avertissement RLS toléré.
- Test d'isolation : deux comptes de test, toutes les tables, lecture et écriture croisées impossibles.

## Remplissage par assistant

**Copier-coller** (`assistant.js`) : dans Profil et dans l'import de positions, « Remplir avec mon assistant » copie un prompt contenant le schéma JSON attendu (profil, biens, crédits, positions) et des consignes ; une zone « Coller la réponse » parse le JSON, affiche l'aperçu ligne par ligne (créations, modifications, erreurs), puis « Appliquer ». Les ISIN inconnus déclenchent `request_instrument`.

**Connecteur MCP** (`functions/mcp`) :
- Authentification : Supabase Auth OAuth 2.1 (à activer dans Authentication → OAuth Server, chemin d'autorisation `/boussole/oauth/consent.html`, enregistrement dynamique activé). Le serveur sert `/.well-known/oauth-protected-resource` pointant vers `https://oapcewpqsbbjdlcdeizi.supabase.co/auth/v1`. Chaque requête porte un JWT utilisateur ; le serveur crée un client Supabase avec ce jeton, donc RLS s'applique.
- Outils, tous bornés à l'utilisateur : `get_overview` (patrimoine, rang, alertes), `get_profile`, `update_profile(patch)`, `list_positions`, `upsert_positions(rows)`, `record_transaction(…)`, `list_biens_credits`, `upsert_biens(rows)`, `upsert_credits(rows)`, `get_config`, `update_config(patch)`. Pas de suppression de compte ni d'export par MCP.
- Page « Mon compte » : liste des connecteurs autorisés et révocation.
- URL : `https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/mcp`. Instructions d'ajout pour Claude (claude.ai, Desktop, Code) sur la page compte.

## Parcours

- Accueil → « Essayer sans compte » : `store-demo` sur un foyer d'exemple (bandeau « démo », rien n'est enregistré, bouton « Créer mon compte pour garder mes données »).
- Première connexion → onboarding 3 étapes (foyer, revenus, patrimoine) ; « Passer » possible ; `onboarding_done`.
- Import CSV (positions) : colonnes `nom, isin, enveloppe, titulaire, poche, quantite, pru, valeur, statut` ; aperçu, erreurs, rien n'est écrit tant qu'une erreur bloque.
- Mon compte : e-mail, mot de passe, connecteurs, export JSON/CSV, suppression (confirmation par saisie de l'e-mail).

## Erreurs

Base injoignable : bandeau, lecture seule du dernier snapshot en mémoire, écritures refusées avec « Réessayer ». Écriture refusée (RLS, 401) : message, session rafraîchie puis nouvel essai. Cours manquant : pastille « cours à récupérer », saisie manuelle. Nightly en échec : `status.last_run` ancien → alerte « mise à jour non passée ». Deux onglets : rechargement après chaque écriture et au `visibilitychange`. Import ou collage invalide : aucune écriture.

## Tests

`npm test` : calc, port (blocs à l'identique), contrat du store (démo et Supabase produisent la même forme), `isolation.test.mjs` (deux comptes, toutes les tables), `nightly.test.mjs` (données de test : cours, snapshot, versement). Visuel : accueil, onboarding, app, compte, consentement OAuth, mobile, sombre. `get_advisors` après chaque migration.

## Migration de Stéph

`scripts/migrate-steph.mjs` : lit `~/Finance/sources/db` (positions, snapshots, config, profil s'il existe), mappe steph→p1, compagne→p2, crée les instruments par ISIN, insère sous le compte de Stéph (jeton obtenu par connexion), vérifie que le total financier calculé = dernier snapshot (223 357,20 € au 2026-10-02).

## Hors périmètre (chantier 2)

Budget, Objectifs et projection, Score de santé, fiscalité, remboursement anticipé, retraite, protection, compte rendu rédigé par un agent.
