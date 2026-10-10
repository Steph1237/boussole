# CK1 : coque, composants et page Aujourd'hui — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal :** passer Boussole à 4 destinations (Aujourd'hui · Patrimoine · Pilotage · Agent) + Compte, avec une bibliothèque de composants commune et une page d'accueil « Aujourd'hui » (indicateurs, boîte de réception, frise), sans casser les liens existants.

**Spec :** `docs/superpowers/specs/2026-10-10-cockpit.md` (§ Principe, § Navigation cible, § CK1 en détail). Dépôt `/Users/stephane/boussole`. Tests : `npm test` (glob `test/*.test.mjs`). Build : `node build.mjs` (`--dev` → `dist-dev/`).

## Tâches (fichiers disjoints, parallélisables : 1, 2, 3 ; puis 4)

### Task 1 : bibliothèque de composants `UI`
Files : create `web/src/ui.js`, `web/src/ui.css`, `test/ui.test.mjs` (le câblage dans `build.mjs` est fait par la tâche 2).
API (global `UI`, UMD/IIFE comme `web/src/reperes.js`, fonctions pures exportées pour les tests) : voir spec § Composants. Précisions :
- `UI.esc(s)` ; `UI.carte(o)` → `<button type="button" class="ui-carte" data-ui-carte="<id>">` avec `.ui-carte-titre`, `.ui-carte-valeur`, `.ui-carte-sous`, tendance (`▲`/`▼`/`–` + classe `pos`/`neg`/`neutre`, texte lisible pour lecteur d'écran), badge optionnel.
- `UI.panneau` : un seul `<div class="ui-panneau" role="dialog" aria-modal="true" aria-labelledby>` injecté dans `document.body` à la première ouverture ; fond `.ui-voile` ; ≥ 900 px volet latéral droit (420 px), < 900 px feuille du bas (85 vh max, coins arrondis, poignée) ; bouton « Fermer » ; Échap, clic sur le voile ; focus piégé ; focus rendu à `document.activeElement` d'avant l'ouverture ; `ouvrir` renvoie l'élément de contenu pour brancher des écouteurs ; `UI.panneau.ouvert()`.
- `UI.onglets(racine, o)`, `UI.bascule(racine, o)` : rendent et branchent ; flèches ←/→, Début/Fin ; `surChange(id)`.
- `UI.accordeon(o)` → `<details class="ui-acc">` ; `UI.voirPlus(liste, n, rendu, libelle)` → HTML + bouton `data-ui-voirplus` que `UI.brancher(racine)` déplie.
- `UI.periode(racine, o)` : bascule de période + bascule de granularité ; « Personnalisée » montre deux `<input type="date">` ; utilise `window.Periodes` s'il existe pour la granularité par défaut.
- `UI.demanderAClaude(question, libelle?)` → `<a class="ui-claude" href="https://claude.ai/new?q=…" target="_blank" rel="noopener noreferrer">` avec icône étincelle et « Demander à Claude ».
- CSS entièrement préfixé `.ui-` ; variables de `theme.css` ; clair et sombre ; mobile.
Tests : échappement de chaque champ texte ; rôles ARIA (tablist/tab/aria-selected, radiogroup/radio/aria-checked, dialog) ; `demanderAClaude` encode la question ; `voirPlus` (5 + « Voir plus (k) ») ; le panneau rend le focus (test en vm avec un mini-DOM factice ou test statique du code : `focus()` sur l'élément mémorisé, écouteur `keydown` Escape) ; aucun `innerHTML` avec donnée non échappée.

### Task 2 : navigation à 4 destinations
Files : modify `web/src/app.js`, `web/src/shell.html`, `build.mjs` (MODULES : ajouter `"aujourdhui"` en tête ; SCRIPTS : `"ui"` juste après `"periodes"` ; CSS : `ui.css` juste après `theme.css`), `web/src/theme.css` (si besoin pour la coque), `test/shell.test.mjs` (+ tout test qui fige l'ancienne liste d'espaces) ; create `web/src/aujourdhui.{html,js,css}` **seulement s'ils n'existent pas** (squelettes, la tâche 3 les remplit).
- `SPACES` (dans cet ordre) :
  - `aujourdhui` « Aujourd'hui », icône maison, `subs: [{ id: "vue", label: "Aujourd'hui", module: "aujourdhui" }]` ;
  - `patrimoine` « Patrimoine » : `placements` (module `pilotage`), `immobilier` « Immobilier et crédits » (module `bilan` — la vue d'ensemble actuelle, en attendant CK3), `budget` « Budget et objectifs » (module `plan`) ;
  - `pilotage` « Pilotage » : `sante` (`sante`), `risque` (`risque-view`), `rang` (`toise`), `projections` (null), `scenarios` « Scénarios » (`simu`) ;
  - `agent` « Agent » : `journal` « Journal » (null, CK2), `propositions` (`propositions`), `memoire` « Mémoire » (`memoire-view`), `fiches` (`fiches-view`), `connexion` « Connexion » (`claude-guide`) ;
  - `compte` « Compte », `primary: false`, hors barre : `donnees` « Données » (`profil`), `regles` « Règles » (`regles`).
  - Retirer `actions` des sous-vues (sa logique d'actions passe dans la boîte de réception de la tâche 3 ; garder le module chargé pour `headline` et réutilisation, sans sous-vue). Garder `decisions/autres` → `pilotage/scenarios`.
- `LEGACY` (nouvelle table, appliquée dans `resolve` / `resolveHash`) — spec § Navigation cible ; plus les anciens onglets (`pilotage`, `toise`, `simu`, `plan`, `profil`) ; route inconnue → `aujourdhui/vue` ; `DEFAULT_ROUTE = aujourdhui/vue`.
- `shell.html` : une `<section class="view" data-space data-sub>` par sous-vue ci-dessus (réutiliser les fragments `<!--@module-->` existants ; une section « bientôt » pour `pilotage/projections` et `agent/journal` avec un état vide orienté agent, texte : « Bientôt ici : … Demandez-le à Claude en attendant. »). Liens de marque `#aujourdhui/vue`.
- Barre du bas mobile et rail : les 4 destinations primaires ; `Compte` ouvert par le bouton avatar (`#profileBtn` → `compte/donnees`) et par un lien en pied de rail ; « Mon compte » (page compte.html) reste accessible depuis Compte.
- Pastilles : `aujourdhui` = `headline()` du module `aujourdhui` ; `agent` = propositions en attente. Supprimer le bandeau `#propBanner` (HTML, CSS, code).
- Sélecteur de périmètre : visible seulement sur `aujourdhui`, `patrimoine`, `pilotage`.
- Barre d'onglets cachée s'il n'y a qu'une sous-vue (déjà le cas).
- Tests : chaque ancienne route (liste de la spec) résout vers la nouvelle ; 4 destinations primaires dans l'ordre ; `compte` non primaire ; plus de `propBanner` ; sections du shell = sous-vues de SPACES ; build OK.

### Task 3 : page Aujourd'hui
Files : `web/src/aujourdhui.{html,css,js}`, `test/aujourdhui.test.mjs`.
- Module `App.register("aujourdhui", api)` (motif `__pending`), `$` scopé, CSS scopé `#view-aujourdhui`. Utilise `window.UI` (tâche 1 : API ci-dessus ; si absent au chargement des tests, les fonctions pures ne doivent pas en dépendre).
- Fonction pure exportée `boite(S, today, deps)` (deps = `{ Rules, Plan, Pratiques }` injectés, `window.*` par défaut) → éléments `{ type, urgence (1 = haute … 3), titre, contexte, action: { label, route } | { label, url } }`, triés urgence puis date :
  - propositions `en_attente` regroupées par `lot` : « Claude propose N changements » (contexte : cibles concernées), route `agent/propositions`, urgence 1 ;
  - alertes de `Rules.evaluate` (lire `web/src/rules.js` et l'usage dans `web/src/actions.js` pour la forme exacte), urgence selon gravité, route vers la page concernée ;
  - souvenirs `a_suivre` échus (`S.memoire`) : « À reprendre : <contenu> », action `UI.demanderAClaude`-like `{ label: "Reprendre avec Claude", url }` (url construite par une fonction pure `urlClaude(question)` identique à `UI.demanderAClaude`), urgence 2 ;
  - échéances ≤ 30 jours : `S.config.milestones` et objectifs datés (`S.objectifs`), urgence 2 si ≤ 7 jours sinon 3 ;
  - cours manquants / photo en retard : réutiliser la logique de fraîcheur de `web/src/app.js` (`header`) ou `S.status` ; urgence 3.
- Bandeau de 4 cartes (`UI.carte`) : patrimoine net (`Calc` / `BilanCalc`, variation sur la période choisie à partir de `S.snapshots`), bonnes pratiques (`Pratiques.evaluer`, « Provisoire » si `provisoire`, « — » si null), écart d'allocation (`Risque` : somme des écarts hors fourchette en points, « profil à faire » sinon), prochaine échéance. Chaque carte ouvre `UI.panneau` avec 2-4 lignes de détail + lien vers la page complète (`patrimoine/placements`, `pilotage/sante`, `pilotage/risque`, `patrimoine/budget`).
- Boîte de réception : 5 éléments + `UI.voirPlus` ; vide : « Rien à traiter. » + `UI.demanderAClaude("Fais le point sur ma situation avec Boussole", "Faire le point avec Claude")`.
- Frise : courbe du patrimoine net (`S.snapshots`) en SVG simple, avec `UI.periode` (défaut 1 an, granularité mois) ; utiliser `web/src/periodes.js` pour l'agrégation (lire son API).
- `headline()` = nombre d'éléments de la boîte.
- Tests : `boite` (tri, regroupement par lot, échéances 7/30 jours, à suivre échus, vide) ; rendu sans erreur en vm avec S de démo (`web/src/demo-data.js`) ; échappement ; `headline`.
- Vérification visuelle (démo) : ordinateur, mobile 375 px, clair, sombre.

### Task 4 : libellés et liens des autres pages (après la tâche 2)
- Remplacer les chemins de navigation écrits en toutes lettres (« Profil et données › Propositions », « Bilan › Placements », « Diagnostic › Profil de risque », « Profil et données › Mémoire de l'agent », « l'onglet Ma position »…) par les nouveaux (« Agent › Propositions », « Patrimoine › Placements », « Pilotage › Risque », « Agent › Mémoire », « Pilotage › Rang »…) dans `web/src/*.js|html`, `supabase/functions/mcp/*.ts`, et les `data-goto` / `href="#…"` vers les nouvelles routes. Mettre à jour les tests qui figent ces textes.
- Le connecteur est redéployé ensuite (contrôleur).
- Les fiches du savoir qui citent « Ma position » / « Bilan » : migration `0012_savoir_libelles.sql` qui met à jour ces phrases (version + 1).

### Task 5 : déploiement (contrôleur)
`npm test`, build, vérification navigateur (démo + compte réel en lecture), push, redéploiement du connecteur (point d'entrée épinglé sur le nouveau commit), `apply_migration` 0012.
