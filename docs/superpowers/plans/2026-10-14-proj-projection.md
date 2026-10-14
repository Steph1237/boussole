# PROJ : moteur de projection, graphique maître, événements de vie et capacité d'emprunt — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal :** un seul moteur de projection (`web/src/projection.js`) pour l'app et le Copilote : flux du foyer mois par mois, Monte-Carlo à 2 000 chemins avec graine fixe et tirages communs, crises rejouées, euros constants, toujours net de frais, net d'impôts en option, événements de vie V1 et capacité d'emprunt aujourd'hui et demain. Un seul composant de graphique (SIM2) sur Aujourd'hui, Placements, Objectifs et Immobilier et crédits. Toutes les projections existantes migrent dessus.

**Spec :** `docs/superpowers/specs/2026-10-14-proj-projection-design.md`. À lire en entier avant de commencer, en particulier § 4 (moteur), § 5 (frais et impôts), § 6 (flux), § 7 (événements), § 8 (IMMO1), § 11 (sources) et § 12 (cas de référence).

**Repères :**
- Dépôt : `/Users/stephane/boussole`.
- Commandes : `npm test` (et `node --test test/<fichier>.test.mjs`), `node build.mjs`, `npm run gen` (ce chantier ajoute un fichier généré : la copie du moteur pour le connecteur).
- Base de test : PGlite, `test/helpers/pglite.mjs` (`baseComplete`, `comme`) ; modèles : `test/frais-suite-pglite.test.mjs`, `test/mfa-pglite.test.mjs`.
- Connecteur testé avec `stripTypeScriptTypes` et `vm` ; modèles : `test/routines-mcp.test.mjs` (outils), `test/formulaire.test.mjs` (fichier généré à jour).
- Tutoiement partout (`test/tutoiement.test.mjs`), jamais « conseiller », jamais un produit nommé, **aucune donnée réelle** (exemples fictifs : « PEA Exemple », « Enfant 2 », 1 234 €).
- App en lecture seule (`test/lecture-seule.test.mjs`) : aucune nouvelle méthode d'écriture dans le store.
- Ne pas committer dans les tâches : c'est le contrôleur qui committe.
- **Dépendances et chantiers en cours** :
  - **DAT1** (`0029_calendrier.sql`, `web/src/calendrier.js`) doit être fusionné avant les tâches 3 et 5 : le moteur lit les types et les dates d'enveloppe de DAT1, et `appliquer_propositions` de 0030 repart de 0029.
  - **HIS1** (`web/src/historique.js`, `aujourdhui.*`, en cours par un autre agent) doit être fusionné avant la tâche 12 (partie Aujourd'hui). Ne pas modifier `historique.js`, `aujourdhui.*` ni le routage avant.
  - **SEC2** (0028) est la base des politiques restrictives : 0030 s'applique après 0028 et 0029.

**Modèle par tâche** (roadmap § 3 bis) : **Opus** pour la relecture de la spec, les mathématiques du moteur, les cas de test et la relecture finale (tâches 0, 3 relecture, 15) ; **Sonnet** pour le code ; **Haiku** pour le mécanique (tâches 2, 14). L'effort est indiqué à chaque tâche.

**Ordre :**
1. Tâche 0 (Opus) d'abord : elle relit la spec, lève les points non vérifiés et fige la fixture des cas de référence.
2. Puis en parallèle, sur des fichiers disjoints : tâche 1 (migration), tâche 2 (repères et indices), tâche 3 (cœur du moteur).
3. Puis tâches 4, 5, 6, 7 (modules du moteur, après 3 ; fichiers distincts dans `projection.js` découpé en sections, à faire **dans l'ordre** si un seul agent, sinon 4 et 6 en parallèle, puis 5, puis 7).
4. Puis tâche 8 (worker et performance), tâche 9 (connecteur, après 1 et 7), tâche 10 (store, après 1).
5. Puis tâche 11 (composant SIM2, après 7), tâche 12 (branchements, après 10 et 11 ; partie Aujourd'hui après HIS1), tâche 13 (IMMO1 interface, après 7, 10, 11).
6. Puis tâche 14 (mécanique), tâche 15 (relecture Opus), tâche 16 (déploiement).

## Contrats communs (à respecter à l'identique dans toutes les tâches)

### Données (spec § 14)

| Où | Forme | Défaut |
|---|---|---|
| `foyer_evenements` | `{ id, user_id, variante_id?, type, personne: p1\|p2\|foyer, libelle (1-60), date, fin?, params (objet), source (1-300), created_at, updated_at }` ; `type` V1 : `naissance`, `creche`, `scolarite_privee`, `achat_immobilier`, `retrait`, `hausse_revenu`, `fin_credit`, `crise` ; réservés (acceptés par la contrainte, refusés par les validateurs V1) : `chomage`, `separation`, `invalidite`, `retraite`, `heritage`, `conge_parental`, `temps_partiel` | — |
| `foyer_variantes` | `{ id, user_id, nom (1-40), description (≤ 300), retire uuid[], hypotheses (objet), created_at, updated_at }` | — |
| `config.projection` | `{ reste_capacite?: "cible"\|"disponible", reequilibrage?: "aucun"\|"annuel", part_reaffectee_epargne_pct?, part_hausse_epargnee_pct?, salaire_croissance_reelle_pct?, tmi_pct?: 0\|11\|30\|41\|45, per_versements_deduits?, assurance_pct?, biens?: { "bien:<uuid>": { prix_achat, date_achat, source, le } }, source, le }` | `{}` |
| `indices_mensuels` | `{ serie, mois (1er du mois), valeur, source_titre, source_url, verifie_le }`, clé (`serie`, `mois`), série `ipc_insee` | — |
| `propositions.cible` | + `evenement`, `variante` | — |

Paramètres par type d'événement : spec § 7.1, à l'identique. Limites : 100 événements, 10 variantes par utilisateur ; 10 événements par appel de `decrire_foyer`.

### Moteur (spec § 3, § 4)

```
Projection.preparer(data, options) → modele
Projection.simuler(modele, { chemins = 2000, graine = Projection.GRAINE (20261014), volatilite? }) → resultat
Projection.crise(modele, { cle, debut }) → resultat
Projection.comparer(modeleA, modeleB, opts) → comparaison
Projection.fiscaliteSortie(compartiment, date, ctx) → { brut, impot_revenu, prelevements_sociaux, net, regle, sources, confiance }
Projection.amortissement({ capital, taux_pct, duree_mois, assurance_pct, debut }) → [{ mois, date, interets, capital, assurance, crd }]
Projection.capaciteEmprunt(data, opts) → capacite ; Projection.capaciteDansLeTemps(modele, resultat, opts) → serie
Projection.validerEvenement(evenement) → null | "message" ; Projection.validerVariante(v) → null | "message"
Projection.rendementAttendu(compartiments) ; Projection.capitaliser(v0, versement, mois, taux_pct)
Projection.EVENEMENTS, Projection.HYPOTHESES, Projection.CLASSES_TIREES, Projection.GRAINE, Projection.versionModele
```

`data = { today, positions, instruments, config, profil, credits, biens, budget, banque, objectifs, foyer: { evenements, variantes }, reperes, indices, calendrier? }` (formes de l'app). `options = { horizon_ans (5|10|15|20|25, défaut 10), perimetre ("foyer"|"p1"|"p2"), vue ("net"|"financier"|"disponible"), euros ("constants"|"courants"), net_impots (bool), variante (id|null) }`.

Sortie de `simuler` (mêmes noms dans le connecteur, en snake_case) :
```
{ version_modele, graine, chemins, today, mois: ["AAAA-MM-JJ", ...],
  vues: { net|financier|disponible: { p10: [], p25: [], p50: [], p75: [], p90: [] } },   // seulement la vue demandée, les autres à la demande
  objectifs: [{ id, cible, date, probabilite, statut }],
  manquer_argent: { probabilite, date_p10 },
  jalons: [{ id, date, type, titre, icone, effet: { texte, montants: {...} }, source: "evenement"|"calendrier"|"credit"|"objectif" }],
  phrase, capacite_source: "reel"|"prevu"|null, capacite_periode,
  hypotheses: [{ cle, libelle, valeur, unite, source_titre, source_url, verifie_le, statut }],
  a_completer: [{ cle, titre, effet, phrase_claude }], couverture, avertissements: [] }
```
Centile : valeur de rang `⌈p × N⌉` des valeurs triées. Ordre des opérations d'un mois : rendement, frais, flux et affectation (versements en fin de mois), événements datés, amortissement, relevé.

### Outils MCP (spec § 15)

| Outil | Annotations | Dépose |
|---|---|---|
| `decrire_foyer({ evenements?, variante?, reglages_projection?, justification? })` | RW | propositions `evenement`, `variante`, `config.projection` |
| `lire_foyer()` | RO | rien |
| `projeter({ horizon_ans?, vue?, perimetre?, euros?, net_impots?, variante?, crise?, annees? })` | RO | rien |
| `comparer_variantes({ variantes, horizon_ans?, vue? })` | RO | rien |
| `capacite_emprunt({ perimetre?, date?, scenario?, duree_ans?, neuf?, primo?, variante? })` | RO | rien |

## Task 0 : relecture de la spec, sources et cas de référence (Opus, effort high)
**Fichiers :** spec (corrections, mention « relu le … » en tête) ; `test/fixtures/projection-cas.json` (nouveau) ; `web/src/marche.js` (ajout de `verifie_le` et `periode` par classe, **valeurs inchangées**).

- [ ] Relire la spec en entier, en particulier les formules des § 4.4.3 (levier), § 5.2 (fiscalité), § 6.3 (ordre de retrait) et § 8.1 (IMMO1). Signaler toute incohérence au contrôleur avant la suite.
- [ ] Lever les points du § 11.5 sur les sources officielles (service-public, BOFiP, Légifrance, Insee, Banque de France, BCE, Cnaf) et compléter le § 11.4 : pour chaque repère « à relever », valeur, date d'effet, source (titre, URL), date de vérification. Une règle qui reste non vérifiée reste marquée NV et n'est pas appliquée sans mention ; ne jamais inventer.
  - parts de SCPI (art. 150 UB) ; PS des actifs numériques en 2026 ; prorata de l'assurance-vie au-delà de 150 000 € ; PS de l'épargne salariale ; durée HCSF avec différé ; barème PTZ 2026 ; barème PSU (taux par nombre d'enfants, plancher, plafond) ; instruction obligatoire à 3 ans ; barème de l'IR 2026 ;
  - `estr_taux`, `nasdaq100_rendement`, `nasdaq100_volatilite`, `immo_volatilite` (calculée sur la série annuelle de l'Insee, méthode écrite), `scpi_taux_distribution`, `taux_usure_*`, `taux_credit_immo_*` (confirmés sur le tableau de bord de l'Observatoire), inflation française 1973 et 1974, série IPC mensuelle des 5 dernières années (identifiant de série Insee noté).
- [ ] Écrire `test/fixtures/projection-cas.json` : tous les cas du § 12 (D-1 à D-11, F-1 à F-10, R-1 à R-4, I-1 à I-5, MC-1 à MC-8), chacun `{ nom, data, options, attendu, tolerance? }`, avec des données fictives complètes (positions, config, profil, crédits, budget). Recalculer chaque attendu indépendamment (script jetable, non commité) et corriger la spec s'il diffère.
- [ ] Ajouter 6 cas composés : un foyer fictif complet sur 10 ans en mode déterministe (naissance, crèche, achat avec apport, fin de crédit, hausse de revenu), dont les valeurs annuelles attendues sont calculées à la main dans un tableur et recopiées.
- [ ] Rendre la liste des corrections au contrôleur. Aucun code hors `marche.js` (dates seulement).

## Task 1 : migration 0030 et tests PGlite (Sonnet, effort medium)
**Fichiers :** `supabase/migrations/0030_projection.sql` (nouveau) ; `test/projection-pglite.test.mjs` (nouveau) ; `test/helpers/pglite.mjs` seulement si `baseComplete` doit inclure 0030 (ajout seulement).

- [ ] **Tests d'abord** (PGlite, `baseComplete` jusqu'à 0029, puis 0030) :
  - tables `foyer_evenements`, `foyer_variantes` : colonnes, défauts, contraintes (`type`, `personne`, longueurs, `fin >= date`, `jsonb_typeof`) ; `variante_id` d'un autre utilisateur refusé ; suppression d'une variante → ses événements supprimés ; suppression de l'utilisateur → tout supprimé ;
  - RLS : B ne lit rien de A ; `authenticated` n'écrit pas directement (seulement par `appliquer_propositions`) ; politiques restrictives `aal2 si facteur` présentes et effectives (jeton aal1 avec facteur vérifié → rien) ; `test/mfa-pglite.test.mjs` reste vert ;
  - `appliquer_propositions` : cibles `evenement` et `variante` en `creer`, `modifier`, `supprimer` ; validation par type (spec § 14.2 : paramètres obligatoires, bornes, `frais_annuels` pour `scolarite_privee`, `charges_mensuelles` pour `achat_immobilier`, crise connue, crédit de l'utilisateur pour `fin_credit`) ; types réservés refusés ; limites de 100 et 10 ; tout ou rien ; mêmes messages que `Projection.validerEvenement` (liste de 15 cas partagée avec la tâche 5, dans la fixture) ;
  - `config.projection` : champs connus seulement, `tmi_pct` dans la liste, pourcentages de 0 à 100, `biens` sur des biens de l'utilisateur ;
  - `export_all()` contient `foyer_evenements` et `foyer_variantes` ;
  - `indices_mensuels` : lisible par `anon` et `authenticated`, non modifiable par eux ;
  - le diff de `appliquer_propositions` contre 0029 se limite aux ajouts (coller le résumé dans le compte rendu).
- [ ] **Migration.** En-tête au format des précédentes (non appliquée ; ordre : après 0029, avant le déploiement de `mcp`). `appliquer_propositions` : **copie intégrale de la définition de 0029**, puis ajouts. `export_all` : copie de la définition de 0021, puis ajout des deux tables. Repères : bloc séparé livré par la tâche 2.
- [ ] `node --test test/projection-pglite.test.mjs`, puis `npm test`.

## Task 2 : repères et indices (Haiku, effort low)
**Fichiers :** bloc d'inserts dans `supabase/migrations/0030_projection.sql` (repères et `indices_mensuels`) ; `web/src/demo-data.js` (mêmes repères, marqués « démo », et la série IPC) ; `test/reperes.test.mjs`.

- [ ] Recopier **à l'identique** les repères du § 11.4 de la spec tels que la tâche 0 les a complétés (clé, libellé, valeur, unité, date d'effet, date de fin, titre de la source, URL, vérifié le). Seulement les lignes V, V-DAT1, CR et CONV ; jamais une ligne NV. Ne rien recalculer, ne rien arrondir.
- [ ] Recopier la série IPC relevée en tâche 0 dans `indices_mensuels` (`on conflict do update`).
- [ ] Test : chaque clé lue par `Projection.HYPOTHESES` (tâche 3) existe dans la migration ou est listée comme manquante assumée ; chaque URL est `https://` d'un domaine officiel ou, pour une ligne CONV, porte « convention » dans son libellé.
- [ ] `npm test`.

## Task 3 : cœur du moteur — compartiments, temps, Monte-Carlo, frais (Sonnet, effort medium ; relecture Opus, effort high)
**Fichiers :** `web/src/projection.js` (nouveau, UMD, global `Projection`) ; `build.mjs` (`projection` dans `SCRIPTS`, après `calendrier` et `marche`) ; `test/projection.test.mjs`, `test/projection-mc.test.mjs` (nouveaux).

- [ ] **Tests d'abord** : cas D-1 à D-5, D-9, MC-1 à MC-8 de la fixture ; ordre des opérations d'un mois ; `preparer` pur (entrée non modifiée, copie profonde comparée) ; compartiments (enveloppe × titulaire × classe, type DAT1, `ter_pct` pondéré, `frais_enveloppe_pct`, base fiscale et mention « prix de revient à compléter ») ; livrets au taux réglementé jusqu'à `date_fin` puis classe `monetaire` ; levier (`multiple` lu dans le nom, sous-jacent `actions` ou `actions_nasdaq100`, mention si les repères Nasdaq manquent) ; euros constants et courants ; centile au rang `⌈p × N⌉` ; matrice de corrélation définie positive (ou corrigée, écart < 0,02) ; tirages : liste fixe `CLASSES_TIREES`, même choc pour (chemin, mois, classe) quelle que soit la variante ; mode déterministe = `volatilite: 0`.
- [ ] Implémenter selon la spec § 3, § 4 et § 5.1 : `xoshiro128**` + `splitmix32`, Box-Muller, Cholesky (et correction de Higham si besoin), boucle mois à l'extérieur, tableaux typés (spec § 9), vues `financier` et `disponible` (la vue `net` arrive en tâche 5), centiles, `versionModele`.
- [ ] **Relecture Opus** (effort high) de la tâche avant la suite : formules, conventions de temps, tirages communs, centiles. Corrections avant la tâche 4.
- [ ] `node --test test/projection.test.mjs test/projection-mc.test.mjs`, puis `npm test`.

## Task 4 : fiscalité de sortie (Sonnet, effort medium)
**Fichiers :** `web/src/projection.js` (section « fiscalité », `fiscaliteSortie`, option `net_impots`) ; `test/projection-fiscalite.test.mjs` (nouveau).

- [ ] **Tests d'abord** : F-1 à F-10 ; chaque ligne du tableau du § 5.2 ; veille et lendemain de `pea_5_ans` et `av_8_ans` (dates de `Calendrier.calendrier`) ; date inconnue → règle prudente et mention ; date approchée → au plus tard ; abattement de l'assurance-vie consommé une fois par année civile et par foyer ; repère manquant → compartiment en brut avec mention, jamais de valeur de secours ; règles NV (§ 11.5) marquées dans `confiance` et `avertissements` ; TMI absent → 30 % avec mention ; PER « bloqué sauf résidence principale ».
- [ ] Implémenter. `npm test`.

## Task 5 : flux du foyer, crédits, biens et événements (Sonnet, effort medium)
**Fichiers :** `web/src/projection.js` (sections « flux », « crédits », « événements », vue `net`, `validerEvenement`, `validerVariante`, `EVENEMENTS`, `amortissement`, `capitaliser`, `rendementAttendu`) ; `test/projection-evenements.test.mjs` (nouveau) ; `test/projection.test.mjs` (vue `net`).

- [ ] **Tests d'abord** : D-6 à D-8, D-10, R-1 à R-4 et les 6 cas composés de la tâche 0 ; capacité de départ réelle puis prévue, avec `capacite_source` et sa période ; décomposition revenus, dépenses, mensualités ; périmètre d'une personne (moitié du commun) ; hausse tendancielle des salaires et `part_hausse_epargnee_pct` ; cascade d'affectation (versements programmés, matelas, objectifs par `Plan.repartirEpargne`, reste selon `reste_capacite`) ; capacité négative et « manquer d'argent » ; ordre de retrait par niveaux puis coût fiscal, dates DAT1 qui changent l'ordre dans le temps ; crédits : taux ou fin inconnus (déduits, ou taux supposé avec mention) ; fin de crédit et règle de réaffectation ; biens revalorisés, `part_p1`, prix d'achat à compléter ; chaque type d'événement V1 (effet et `effet` chiffré du jalon, § 7.4) ; enfant déjà né (seuls les changements comptent) ; validation et messages (15 cas partagés avec la tâche 1) ; types réservés refusés ; variantes (`retire`, hypothèses, événements propres) ; 100 et 10 au plus.
- [ ] Implémenter selon la spec § 6 et § 7. Chaque type d'événement est une entrée de `EVENEMENTS` : `{ type, parametres, valider, effet, titre, icone, defauts: [{ cle, repere }] }`.
- [ ] `npm test`.

## Task 6 : crises rejouées et comparaison de variantes (Sonnet, effort medium)
**Fichiers :** `web/src/projection.js` (`crise`, `comparer`) ; `test/projection-mc.test.mjs` (ajouts).

- [ ] **Tests d'abord** : D-11 ; chaque crise de `Marche.CRISES` (durée en mois, choc cumulé exact à la fin de la fenêtre, rendements attendus avant et après, aucun rebond forcé) ; levier pendant la crise = choc `levier` ; inflation 1973-1974 depuis le repère relevé (sans repère : scénario indisponible, mention) ; événement `crise` d'une variante ; `comparer` : MC-4, écarts par centile calculés **chemin par chemin**, probabilité que la variante fasse mieux.
- [ ] Implémenter. `npm test`.

## Task 7 : capacité d'emprunt IMMO1 et migration de Rang (Sonnet, effort medium)
**Fichiers :** `web/src/projection.js` (`capaciteEmprunt`, `capaciteDansLeTemps`, `annuite`, `planPret`, `ptz`, `taeg`) ; `web/src/toise.js` (appelle le moteur ; `LOAN.rates` et les frais lus dans les repères) ; `test/projection-capacite.test.mjs` (nouveau) ; `test/toise.test.mjs` ; `test/port.test.mjs` (bloc moteur de la Toise réduit, commentaire de justification : spec § 8.3).

- [ ] **Tests d'abord** : I-1 à I-5 ; revenus retenus (net avant impôt, primes moyennées si présentes, loyers à 70 % avec la mention « convention ») ; périmètre foyer et personne ; apport mobilisable net d'impôts, matelas exclu, PEA de moins de 5 ans exclu, PER indiqué à part ; reste à vivre comparé aux dépenses hors logement, sans seuil ; sensibilité ±1 point × 20/25 ans ; taux du repère avec sa date, « taux à actualiser » après `date_fin` ; TAEG estimé contre le taux d'usure ; trajectoire : fin d'un crédit, achat prévu, enfants (reste à vivre), apport en P10/P50/P90 ; mention « estimation selon les règles du HCSF, chaque banque décide » dans la sortie ; **non-régression de Rang** : mêmes montants qu'avant à taux égaux (instantané pris avant la modification).
- [ ] Déplacer le code de crédit de `toise.js` dans le moteur, **sans changer les calculs** ; adapter `port.test.mjs`.
- [ ] `npm test`.

## Task 8 : worker et performance (Sonnet, effort medium)
**Fichiers :** `web/src/projection-worker.js` (nouveau) ; `web/src/projection.js` (cache par empreinte, `executer(data, options, rappel)` : 500 chemins puis 2 000, worker si disponible) ; `build.mjs` (copie du worker dans `dist/app/`) ; `scripts/bench-projection.mjs` (nouveau) ; `test/projection-mc.test.mjs` (plafond de temps).

- [ ] **Tests d'abord** : MC-6 (500 premiers chemins) ; même résultat avec et sans worker (worker simulé sous Node) ; cache : même empreinte → même objet, `versionModele` changé → recalcul ; plafond de 600 ms pour 2 000 × 300 sous Node.
- [ ] Implémenter ; mesurer sur la machine de développement et noter le temps réel dans le compte rendu (objectif : < 150 ms). Si l'objectif n'est pas tenu : profiler (tirages, tri des centiles) avant de toucher au modèle.
- [ ] `npm test`.

## Task 9 : connecteur MCP (Sonnet, effort medium)
**Fichiers :** `scripts/gen-catalogue.mjs` (génère `supabase/functions/mcp/projection-moteur.gen.js` à partir de `marche.js`, `reperes.js`, `calendrier.js`, `calc.js` (fonctions pures utilisées), `plan.js` (`repartirEpargne`) et `projection.js`) ; `supabase/functions/mcp/projection.ts` (nouveau : conversion SQL → formes de l'app, `registerProjection`) ; `supabase/functions/mcp/index.ts` (enregistrement ; portages `effortMensuel`, `dateAtteinte`, `repartirEpargne`, `statutObjectif` remplacés par le moteur ; `INSTRUCTIONS` : conduite du § 7.3 ; `demarrer_session`) ; `test/projection-mcp.test.mjs` (nouveau), `test/mcp.test.mjs`.

- [ ] **Tests d'abord** : `npm run gen` ne produit aucun écart (copie à jour) ; sorties du connecteur identiques à celles de l'app sur toute la fixture et sur la démo (données converties en lignes SQL comme `enSql` de `test/sante-calc.test.mjs`) ; `decrire_foyer` (validation, messages, 10 au plus, valeurs par défaut renvoyées avec leurs sources, types réservés refusés, aucune proposition si rien ne change) ; `lire_foyer` ; `projeter` (résumé seulement, jamais les chemins ; `conduite` ; `version_modele`) ; `comparer_variantes` ; `capacite_emprunt` ; annotations RO/RW ; `demarrer_session.projection` (null sans lever en cas d'échec) ; `list_objectifs` renvoie `probabilite` ; tutoiement ; aucun « conseiller ».
- [ ] Implémenter. `npm test`.

## Task 10 : store et démo (Sonnet, effort low)
**Fichiers :** `web/src/store-supabase.js` (lecture de `foyer_evenements`, `foyer_variantes`, `config.projection`, `indices_mensuels` → `S.foyer`, `S.indices`) ; `web/src/store-demo.js` (application des propositions `evenement` et `variante` avec `Projection.validerEvenement`) ; `web/src/demo-data.js` (foyer fictif : un enfant né, une naissance prévue, une crèche, un achat prévu, un crédit auto qui finit, une variante « 2ᵉ enfant ») ; `web/src/propositions.js` (descriptions en clair, spec § 14.2) ; `test/store-contract.test.mjs`, `test/propositions-ui.test.mjs`.

- [ ] **Tests d'abord** : contrat du store (clés, défauts, lecture seule) ; démo valide pour le moteur (aucun avertissement de donnée invalide) ; propositions lisibles ; parité des messages store démo / base / moteur sur les 15 cas partagés.
- [ ] Implémenter. `npm test`.

## Task 11 : composant SIM2 `CourbeProjection` (Sonnet, effort medium)
**Fichiers :** `web/src/courbe-projection.js` (nouveau : fonctions pures + contrôleur `monter`/`mettreAJour`) ; `web/src/courbe-projection.css` (nouveau, styles `cp-*`, variables de `theme.css`) ; `build.mjs` (script et CSS) ; `test/courbe-projection.test.mjs` (nouveau).

- [ ] **Tests d'abord** (fonctions pures sous Node, DOM simulé comme `test/aujourdhui.test.mjs`) : passé observé et reconstitué, marqueur « Aujourd'hui », éventail P10–P90 et P25–P75, médiane, aucun point annuel ; passé converti en euros constants avec `indices_mensuels` ; variante (seconde couleur, écart à l'horizon écrit) ; crise en pointillé avec sa légende ; couloir des jalons (vrais boutons, icône + libellé court, trait vertical, regroupement, bulle au focus et au survol avec l'effet en euros, Échap) ; objectifs (losange, couleur **et mot**, « 8 chances sur 10 ») ; phrase de titre (arrondi à deux chiffres significatifs, « provisoire » sous 60 %, « en euros de 2036 » en courants) ; contrôles (horizon, variante si elle existe, crise) ; panneau « Comment c'est calculé » (hypothèses, sources, limites, graine, version, données manquantes avec « Compléter avec Claude ») ; tableau accessible ; `role="img"` et `aria-label` ; mobile 400 px ; `prefers-reduced-motion` ; mode `capacite` ; réglages locaux jamais enregistrés.
- [ ] Implémenter. Vérification visuelle en clair et en sombre, à 1 280 px et à 400 px (captures dans le compte rendu). `npm test`.

## Task 12 : branchements — Objectifs, Placements, Aujourd'hui (Sonnet, effort medium)
**Fichiers :** `web/src/objectifs-view.{js,html,css}` ; `web/src/pilotage.{js,html}` ; `web/src/aujourdhui.{js,css}` et `web/src/historique.js` (`projeter` délègue au moteur) **seulement après la fusion de HIS1** ; `web/src/plan.js` (`projection` en façade dépréciée, `statutObjectif` + `probabilite`, `repartirEpargne` avec `rendementAttendu`) ; tests correspondants.

- [ ] **Tests d'abord** :
  - Objectifs : l'accordéon utilise `CourbeProjection` (vue `financier`, 10 ans) ; plus de champ « versement » ni d'étiquette « réel » ; la ligne de source dit « capacité d'épargne réelle (période) » ou « prévue au budget », jamais les deux ; la note de répartition dit la même source ; panneau d'un objectif : bande des poches et probabilité ; bandeau unique « cibles en euros d'aujourd'hui » ; statuts existants conservés + probabilité ;
  - Placements : courbe de la vue `financier` sous l'évolution passée, réglages du § 10.2 ;
  - Aujourd'hui : la courbe maîtresse de HIS1 prend l'éventail du moteur (vue `net`), les jalons et les objectifs ; `Historique.projeter` garde sa forme de points (+ `p25`, `p75`) ;
  - plus aucun appel à `Plan.RENDEMENTS` ; `Plan.projection` n'est plus appelé que par sa façade (test qui cherche les appels dans `web/src`).
- [ ] Implémenter dans cet ordre : Objectifs, Placements, puis Aujourd'hui. `npm test`.

## Task 13 : interface IMMO1 dans Immobilier et crédits (Sonnet, effort medium)
**Fichiers :** `web/src/bilan.{js,html,css}` (section « Capacité d'emprunt ») ; `web/src/claude-prompts.js` (phrases « Compléter avec Claude » : revenus, primes, taux du crédit, apport) ; `test/bilan.test.mjs`.

- [ ] **Tests d'abord** : sélecteur de périmètre existant (foyer, chaque personne) ; aujourd'hui : mensualité max, montant empruntable, apport par enveloppe (PER à part), budget d'achat, reste à vivre et dépenses hors logement, taux et sa date, sensibilité (tableau), mention fixe « estimation selon les règles du HCSF… chaque banque décide » ; demain : `CourbeProjection` en mode `capacite`, phrase de titre (§ 8.2), jalons ; données manquantes avec « Compléter avec Claude » ; accessibilité et mobile comme la tâche 11 ; lecture seule.
- [ ] Implémenter. `npm test`.

## Task 14 : mécanique (Haiku, effort low)
**Fichiers :** `build.mjs`, `test/shell.test.mjs` (scripts chargés), `test/tutoiement.test.mjs` (nouveaux fichiers couverts), `docs/superpowers/specs/2026-10-10-cockpit.md` (renvoi vers PROJ pour la courbe maîtresse), roadmap privée `~/Finance/docs/boussole-roadmap.md` (statuts SIM1, SIM2, FOY1, IMMO1 ; idée « rejouer une projection passée » reliée à `versionModele`).

- [ ] Vérifier que `node build.mjs` copie `projection.js`, `projection-worker.js`, `courbe-projection.js` et leur CSS ; `npm run gen` ; `npm test`.
- [ ] Rechercher et remplacer les textes restants « hors inflation » des anciennes projections ; aucun « vous ».
- [ ] Mettre à jour la roadmap (section 6, 7 et 11) et le renvoi du cockpit.

## Task 15 : relecture finale (Opus, effort high)
**Fichiers :** aucun (compte rendu au contrôleur, corrections par Sonnet).

- [ ] Mathématiques : relire `projection.js` contre la spec (tirages communs, levier, centiles, ordre des opérations, euros constants, fiscalité, ordre de retrait, amortissement, IMMO1) ; rejouer la fixture ; vérifier 3 cas au hasard à la main.
- [ ] Honnêteté : aucun chiffre sans source ou sans mention « hypothèse » ou « convention » ; aucune règle NV appliquée sans mention ; textes (pas de promesse, pas de « conseiller », pas de produit nommé).
- [ ] Sécurité : RLS et politiques MFA des deux tables, `appliquer_propositions` (tout ou rien, `security invoker`, `search_path = ''`, aucun nouveau droit), export, suppression, aucune donnée réelle dans les fixtures et la démo, `projeter` ne renvoie pas les chemins.
- [ ] Interface : accessibilité (clavier, lecteur d'écran, contrastes), mobile, mouvement réduit.

## Task 16 : déploiement (Sonnet, effort low, procédure écrite)
- [ ] Appliquer `0030_projection.sql` (après 0029) sur le projet Supabase, vérifier par md5 ; contrôler les politiques (`pg_policies`) des deux tables.
- [ ] Déployer `mcp` (copie générée à jour), vérifier `projeter` et `capacite_emprunt` sur le compte de démonstration.
- [ ] Publier le site, CI Pages au vert ; test de fumée (Aujourd'hui, Objectifs, Placements, Immobilier et crédits, à 1 280 et 400 px).
- [ ] Mettre à jour la roadmap (section 11, Fait).
