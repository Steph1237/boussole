# SUIVI : suivi de mes lignes (GOV1, SCO2, AVIS1, EVT1, EVT2) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal :** chaque ligne a un rôle (réserve, cœur, satellite) qui fixe sa fréquence de revue et ses seuils ; sa santé est une météo de constats objectifs ; aucun changement n'est suggéré sans le test « ça vaut le coût ? » ; les avis des tiers sont montrés tels quels sur une fiche d'instrument identique pour tous ; un calendrier commun d'événements, croisé en privé avec le portefeuille, nourrit « Ta semaine ». Tout est formulé au niveau des classes, des enveloppes et des comportements, jamais d'un produit.

**Spec :** `docs/superpowers/specs/2026-10-15-suivi-lignes-design.md`. À lire en entier avant de commencer, en particulier § 0 (décisions), § 2 (doctrine), § 4.4 (« ça vaut le coût ? »), § 9 (cadre réglementaire) et § 11 (interface).

**Repères :**
- Dépôt : `/Users/stephane/boussole`.
- Commandes : `npm test` (et `node --test test/<fichier>.test.mjs`), `node build.mjs`, `npm run gen` (copie générée de `suivi.js` dans le connecteur, comme `projection-moteur.gen.js`).
- Base de test : PGlite, `test/helpers/pglite.mjs` (`baseComplete`, `comme`) ; modèles : `test/projection-pglite.test.mjs`, `test/frais-suite-pglite.test.mjs`.
- Connecteur testé avec `stripTypeScriptTypes` et `vm` ; modèles : `test/projection-mcp.test.mjs`, `test/calendrier-mcp.test.mjs`.
- Fonctions serveur : modèle `test/nightly-frais.test.mjs` (`fetch` simulé).
- Tutoiement (`test/tutoiement.test.mjs`), jamais « conseiller » dans l'app, jamais un produit nommé ni recommandé, aucune donnée réelle (« PEA Exemple », « ETF Monde A », « Société Exemple », 1 234 €). Les ISIN de Stéph ne vont jamais dans le dépôt.
- App en lecture seule (`test/lecture-seule.test.mjs`) : aucune nouvelle méthode d'écriture dans le store.
- Ne pas committer dans les tâches : c'est le contrôleur qui committe.
- Migration : **0032** (ou le premier numéro libre au moment du code), repartir **exactement** de la dernière définition de `appliquer_propositions` en vigueur.

**Modèle par tâche** (roadmap § 3 bis) : **Opus** pour la tâche 0, la spec des consignes de veille, les relectures de fin de phase et la relecture finale ; **Sonnet** pour le code ; **Haiku** pour le mécanique (textes, roadmap, tests de fumée). Effort : S ≤ ½ journée · M 1 à 2 jours · L 3 à 5 jours.

## Contrats communs (à respecter à l'identique dans toutes les tâches)

### Données (spec § 3)

| Où | Forme | Défaut |
|---|---|---|
| `positions.role` | `reserve \| coeur \| satellite` ou null | null |
| `positions.role_source` | `propose \| valide` ou null | null |
| `config.suivi` | `{ revue_coeur: annuelle\|semestrielle, mois_revue_coeur?, seuil_ecart_pts?, plafond_satellite_pct?, seuil_baisse_satellite_pct?, semaine: { actif, jour }, source, le }` | `{}` (défauts calculés par le moteur) |
| `instruments` (ajouts) | `type_support, categorie, indice, levier, encours_eur, ecart_suivi_pct, date_creation, distribution, pays, secteur, fournisseur_symbole, donnees_source, donnees_le` ; `ter_source` accepte `fournisseur` | null |
| `instrument_expositions` | `(isin, axe pays\|devise\|secteur\|ligne, cle, libelle, poids_pct, le, source)` | — |
| `evenements_marche` | spec § 3.1 | — |
| `avis_tiers` | `(isin, producteur, type, publie_le, recu_le, diffuse_le, donnees, mentions_url, licence, source_url)`, ajout seul | — |
| `publications` | annexe D.8, ajout seul | — |
| `univers_base` | `(isin, raison, ajoute_le)` | — |

### Moteur `web/src/suivi.js` (UMD, global `Suivi`, sans DOM ; copie générée dans `supabase/functions/mcp/suivi.gen.js`)

```
Suivi.roleParDefaut(ligne, instrument, objectifs) → { role, raison }
Suivi.politique(data) → { revue: { reserve, coeur, satellite }, seuils, plafond_satellite_pct, source }
Suivi.systeme(data) → { parts: { reserve, coeur, satellite }, plafond_satellite_pct, depasse, lignes_satellite: [...] }
Suivi.constats(data, position_id) → [{ cle, statut, mesure, repere, pourquoi, calcul, donnees, manque, source_donnees, confiance }]
Suivi.meteo(constats, role, revue) → { meteo: clair|eclaircies|a_regarder|a_completer, couverture: { calcules, applicables }, gelee_jusquau? }
Suivi.declencheurs(data, today) → [{ cle, portee: ligne|classe|enveloppe|portefeuille|objectif, classe?, enveloppe?, position_ids, mesure, seuil, pourquoi, source, levier, verdict }]
Suivi.vautLeCout(changement, data, options) → { verdict: vaut_le_cout|a_peser|ne_rien_faire, gain_annuel, cout_unique, point_mort_ans, horizon_ans, effet_risque?, alternative?, calcul, hypotheses, sources }
Suivi.exposition(data, evenement) → { concerne: bool, part_pct, raison, via: [...] }
Suivi.maSemaine(data, evenements, today) → { cartes: [{ type, titre, chiffre?, texte, elements, sources }] }   // 4 à 7 cartes
Suivi.habitudes(data, today) → [{ cle, mesure, palier, prochain_palier, texte }]
```

`data = { positions, instruments, expositions, config, profil, objectifs, risque, transactions, cours, routines, reperes, calendrier }` (formes de l'app). `today` = `AAAA-MM-JJ` de Paris. `vautLeCout` appelle `projection-fiscalite.js` (impôt) et `Calendrier` (dates DAT1) ; l'effet sur le risque passe par `Projection` (`comparer_variantes`, mêmes tirages), hors du chemin synchrone.

**Règle de présentation** (spec § 9.1) : toute sortie destinée à l'affichage (`declencheurs`, leviers, verdicts) a un titre qui nomme **une classe et une enveloppe**, jamais un instrument ; les instruments figurent seulement dans `position_ids` et `donnees`.

### Connecteur (spec § 12)

Outils : `suivi_lignes`, `ligne`, `instrument`, `ca_vaut_le_cout`, `evenements`, `ma_semaine` (lecture) ; `definir_suivi` (propositions). Ajouts à `demarrer_session` et à `demarrer_routine`. Conduite du § 12.3 dans `INSTRUCTIONS`.

## Ordre et dépendances

```
Phase 0  T0 (Opus)
Phase 1  GOV1     T1 ─┬─ T2 ── T3 ── T4
                      │          └── T5 ── T6
                      └── T7 (parallèle)
Phase 2  SCO2     T8 (après T2) ── T9 (après T6, T8) ── T10 (Opus)
         ── Livraison 1 : utilisable sans fournisseur ──
         ── Décision D1 (fournisseur, budget) ──
Phase 3  Données  T11 (essai, avant D1) ; après D1 : T12 ── T13 ── T14 ; T15 (après T8, T13)
Phase 4  EVT1     T16 (après T12) ; T17 (après T13, T16) ; T18 (après T12, spec Opus) ; T19 (après T18)
Phase 5  AVIS1+EVT2  T20 (après T13) ── T21 ; T22 (après T13, T17)
Phase 6  Ta semaine  T23 (après T17, T22) ── T24 ; T25 (après T4)
Phase 7  Qualité  T26 (cas du banc, dès la phase 1) ; T27 ; T28 (Opus) ; T29 (déploiement)
```

Les phases 1 et 2 ne dépendent d'aucun fournisseur : elles livrent la doctrine, le système cœur et satellite, la météo et le test du coût sur les données déjà là (frais par DIC et Yahoo, poids, profil, enveloppes DAT1).

---

## Phase 0 : cadrage chiffré

### Tâche 0 — Repères, études et cas de référence (Opus, high, M)
- [ ] Sourcer ou requalifier en « repère Boussole, prudent » : plafonds satellite par profil, seuil d'écart de 5 points, seuil de baisse de 25 %, 5 % par ligne satellite, 10 % par société, seuils d'encours (100 M€, 20 M€), écart de suivi, seuils de chevauchement (30 %, 60 %), seuils de croisement (5 %, 1 %). Chaque repère : valeur, unité, source, URL, date de vérification ; entrées prêtes pour `reperes` (thème `comportement`).
- [ ] Revérifier les études du § 2.3 de la spec (références exactes, chiffres) et rédiger les fiches du savoir correspondantes (thème `comportement`).
- [ ] Écrire `test/fixtures/suivi-cas.json` : au moins 40 cas fictifs couvrant le § 14.1 de la spec (rôles, politique, constats, météo, déclencheurs, `vautLeCout` avec assurance-vie, PEA de moins de 5 ans, compte-titres avec plus-value, `G = 0`, bords du point mort, alternative par les versements, croisement, « Ta semaine », habitudes), chaque cas calculé à la main.
- [ ] Relire chaque texte affiché de la spec (§ 6.2, § 11.11) au regard du § 9.1 (faits sur la ligne, jugements sur la classe) et lister les formulations à risque.
- **Critère d'arrêt** : repères et fiches prêts à migrer, cas de référence relus, liste des formulations validées.

## Phase 1 : GOV1, rôles et politique de suivi

### Tâche 1 — Migration, partie A (Sonnet, medium, M)
- [ ] `0032_suivi.sql` : `positions.role`, `positions.role_source` (contraintes), clé `suivi` dans la liste blanche de la cible `config` (bornes du § 3.2, source obligatoire, messages au format de 0027), champs `role` et `role_source` acceptés par la cible `position` ; repères de la tâche 0.
- [ ] Tests PGlite : écriture seulement par `appliquer_propositions`, bornes, double authentification (`test/mfa-pglite.test.mjs`), `export_all()`, suppression du compte.
- **Dépend de** : T0 (repères).

### Tâche 2 — Moteur `suivi.js`, partie A (Sonnet, medium, L ; relecture des calculs : Opus en T10)
- [ ] TDD sur `suivi-cas.json` : `roleParDefaut`, `politique`, `systeme`, `declencheurs` (sans les familles qui demandent le fournisseur), `vautLeCout` (fiscalité par `projection-fiscalite.js`, dates par `Calendrier`, alternative par les versements avec la capacité constatée), `habitudes` (revue, matelas, frais, dates connues).
- [ ] Règle de présentation des titres (classe et enveloppe) testée.
- [ ] Ajout à `SCRIPTS` de `build.mjs` ; performance : 200 lignes en moins de 10 ms.
- **Dépend de** : T0.

### Tâche 3 — Copie générée et parité (Haiku, low, S)
- [ ] `npm run gen` produit `supabase/functions/mcp/suivi.gen.js` ; test « copie à jour » et parité des sorties sur tous les cas.
- **Dépend de** : T2.

### Tâche 4 — Outils MCP, partie A (Sonnet, medium, M)
- [ ] `suivi_lignes`, `ligne`, `ca_vaut_le_cout`, `definir_suivi` ; ajouts à `demarrer_session` (`suivi`) et à `demarrer_routine` (déclencheurs du mois selon la politique, revue du cœur à son mois) ; conduite du § 12.3 dans `INSTRUCTIONS`.
- [ ] Tests : annotations RO/RW, propositions déposées (jamais d'écriture directe), conduite renvoyée, sorties sans nom d'instrument dans les titres.
- **Dépend de** : T1, T3.

### Tâche 5 — Stores et démo (Sonnet, low, S)
- [ ] Lecture de `positions.role`, `role_source`, `config.suivi` dans `store-supabase.js` et `store-demo.js` ; démo fictive : rôles mixtes (dont 2 à confirmer), satellite à 9 % pour un plafond de 15 %, un déclencheur `frais_eleves` qui vaut le coût (assurance-vie) et un qui ne le vaut pas (compte-titres).
- **Dépend de** : T1.

### Tâche 6 — Interface, partie A (Sonnet, medium, L)
- [ ] Placements : système cœur et satellite (anneau, graduation du plafond, orbite des satellites, tableau équivalent), chip de rôle sur chaque ligne, « Grouper par : Rôle ».
- [ ] Page « Ta ligne » (squelette : rôle, poids, prochaine revue, leviers de la classe avec la carte « ça vaut le coût ? » et sa balance, « Comment c'est calculé »).
- [ ] Compte › Règles : politique de suivi en lignes de 56 px avec « Modifier avec Claude ».
- [ ] Tests DOM (§ 14.4 de la spec, parties système, leviers, lecture seule), captures 390 et 1 280 px en clair et en sombre.
- **Dépend de** : T2, T5.

### Tâche 7 — Texte de l'alerte de seuil de cours (Haiku, low, S)
- [ ] `rules.js` : « Seuil de cours touché : c'est le moment de relire ta règle pour cette ligne » (sans « vérifie ton ordre stop ») ; test mis à jour.

## Phase 2 : SCO2, la météo de chaque ligne

### Tâche 8 — Constats et météo (Sonnet, medium, M)
- [ ] `constats` et `meteo` dans `suivi.js` avec les données déjà là (`cout`, `poids`, `classe_risque`, `enveloppe`, `devise` ; `chevauchement` et `solidite` « à compléter » sans fournisseur) ; gel de la météo du cœur entre deux revues ; déclencheur `sante_degradee`.
- [ ] Parité (régénérer la copie), cas de référence.
- **Dépend de** : T2.

### Tâche 9 — Interface de la météo (Sonnet, medium, M)
- [ ] Icône et mot sur chaque ligne, anneau segmenté et constats en lignes sur « Ta ligne », panneau de constat dans l'ordre de CP4, couverture écrite, liens depuis Pilotage › Santé (§ 5.3).
- [ ] Tests DOM : icône **et** mot, aucune note chiffrée.
- **Dépend de** : T6, T8.

### Tâche 10 — Relecture de fin de phase 2 (Opus, high, S)
- [ ] Calculs (`vautLeCout`, seuils, gel), textes au regard du § 9.1, visuel 390 et 1 280 px en clair et en sombre. Corrections renvoyées en tâches FIX.

**Livraison 1** : déployer (procédure de T29), mettre à jour la roadmap (GOV1 et SCO2 « Fait »).

---

## Décision D1 (Stéph) : fournisseur et budget

### Tâche 11 — Essai du fournisseur (Sonnet, low, S ; peut démarrer pendant la phase 1)
- [ ] Script local hors dépôt public (`scripts/essai-fournisseur.mjs` lit une liste d'ISIN depuis un fichier local ignoré par git) : pour chaque ISIN, présence chez le fournisseur, frais courants, encours, lignes, répartitions, consensus (nombre d'analystes, répartition), calendriers. **Le rapport ne contient que des comptes et des pourcentages**, jamais un ISIN réel.
- [ ] Stéph : souscription d'un mois au forfait d'essai (usage interne seulement), demande de devis B2B avec les questions du § 10.3 de la spec.
- **Sortie** : tableau de couverture pour la décision D1 (seuil proposé : 80 % des ISIN couverts, devis sous 300 € par mois).

## Phase 3 : la couche de données (après D1)

### Tâche 12 — Migration, partie B (Sonnet, medium, M ; relecture sécurité : Opus)
- [ ] Colonnes de `instruments`, tables `instrument_expositions`, `univers_base`, `evenements_marche`, `avis_tiers` (ajout seul, `diffuse_le`), `publications` (si EX3 ne l'a pas créée ; déclencheur qui refuse `update` et `delete`, même pour `service_role`).
- [ ] RLS : lecture `authenticated`, écriture `service_role` ; tests PGlite du § 14.2.

### Tâche 13 — Fonction `marche` (Sonnet, medium, L)
- [ ] Edge Function séparée de `nightly` ; clé du fournisseur dans Vault ; jetons `pg_cron` comme `nightly_token`.
- [ ] Hebdomadaire (dimanche 22 h, Paris) : fondamentaux des fonds, expositions, calendriers des sociétés, liste = ISIN détenus ∪ `univers_base`. Quotidien (5 h) : changements de date, comparaison des champs des fonds (frais, indice, distribution) → événements `fonds_*`. Budgets de temps comme `nightly`, avertissements séparés des erreurs, `job_runs`.
- [ ] Test : aucun identifiant d'utilisateur dans les requêtes ; union avec l'univers ; `fetch` simulé.

### Tâche 14 — Remplacer Yahoo (Sonnet, medium, M)
- [ ] Cours et frais des fonds lus chez le fournisseur (`ter_source = fournisseur`, priorité au DIC inchangée) ; Yahoo retiré une fois la parité des cours constatée sur 2 semaines ; tests `nightly-*` adaptés.

### Tâche 15 — Constats complets (Sonnet, low, S)
- [ ] `chevauchement` et `solidite` avec les données du fournisseur ; transparence pour `concentration`.

## Phase 4 : EVT1, le calendrier commun

### Tâche 16 — Flux officiels (Sonnet, medium, M)
- [ ] BCE, Fed, Eurostat, Insee (et BLS si exposition au dollar) : lecture des calendriers publiés, sans IA, conditions de réutilisation respectées (mention de la source, § 10.5 de la spec) ; formats à constater au moment du code (aucun format supposé) ; `origine = flux`.

### Tâche 17 — Croisement et calendrier (Sonnet, medium, L)
- [ ] `Suivi.exposition` (transparence, « non réparti », seuils du § 7.3, raison chiffrée) ; outil `evenements` ; chips Toi · Tes lignes · Le monde dans le panneau du calendrier ; événements majeurs dans le couloir des jalons du graphe maître (fenêtres ≤ 1 an, un par mois au plus, icône « monde »).
- [ ] Tests du § 14.1 (croisement) et du § 14.4 (calendrier).

### Tâche 18 — Veille « marchés » (Opus high pour les consignes et le banc de la veille, S ; Sonnet medium pour le code, L)
- [ ] Consignes du proposant et du vérificateur (Opus), point d'entrée serveur `proposer_evenement` (jeton de service, contrôles automatiques avant IA : liste blanche, citation exacte, bornes, format), double vérification pour le niveau moyen, écriture dans `publications`, coupe-circuit (3 rejets par jour), retour arrière par publication corrective.
- [ ] Tâche planifiée quotidienne (6 h) sur le compte de Stéph (décision D5) ; prompt versionné dans le dépôt.
- [ ] Tests : refus hors liste blanche, citation absente, chiffre hors bornes, désaccord, coupe-circuit.

### Tâche 19 — Résumés après événement (Sonnet, medium, M)
- [ ] Gabarits par type (décision de taux, inflation, résultats, dividende), faits extraits par la veille et vérifiés, réaction des marchés calculée sur les cours ; publiés dans les 24 h.

## Phase 5 : AVIS1 et EVT2

### Tâche 20 — Avis des tiers (Sonnet, medium, M)
- [ ] Instantanés hebdomadaires (lundi 4 h) dans `avis_tiers`, `diffuse_le` à la première mise à disposition, avis sans `mentions_url` non affiché, fraîcheur (30 et 90 jours ; 13 mois pour une notation), 18 mois d'historique.

### Tâche 21 — Fiche de l'instrument (Sonnet, medium, M)
- [ ] Page identique pour tous (faits publics, avis par source en colonnes, barre de répartition en encre et gris, ligne de convergence, évolution sur 3 mois, mention fixe, identité du diffuseur, mentions du producteur, événements) ; outil `instrument`.
- [ ] Tests : même rendu pour deux jeux de données personnelles différents, aucune couleur verte ou rouge, aucun bouton d'action, aucun avis dans « Ta semaine » ni « À traiter ».

### Tâche 22 — Événements des lignes (Sonnet, medium, M)
- [ ] Sociétés (résultats, assemblées, dividendes, opérations) et fonds (fusion, fermeture, frais, indice, distribution) ; déclencheurs `evenement_fonds` et `operation_titre` (avec date limite publiée) ; historique sur « Ta ligne » et sur la fiche de l'instrument.

## Phase 6 : « Ta semaine » et les bonnes habitudes

### Tâche 23 — Contenu (Sonnet, medium, M)
- [ ] `Suivi.maSemaine` (4 à 7 cartes, « Rien à faire cette semaine » quand aucun déclencheur ne passe le test), outil `ma_semaine`, carte d'application MCP quand le client la prend en charge.

### Tâche 24 — Interface (Sonnet, medium, M)
- [ ] Carrousel à aimantation (sans défilement automatique), tirets de progression, clavier, ARIA ; colonne de droite sur desktop ; panneau « Tes bonnes habitudes » (anneaux, remplissage de 400 ms, rien avec `prefers-reduced-motion`) ; « nouveau » en état local ; View Transitions entre une ligne et sa page.
- [ ] Test de chaîne « habitudes » (vocabulaire interdit, pas de notification de cours, pas de compte à rebours sur un événement de marché).

### Tâche 25 — Revue mensuelle (Sonnet, low, S)
- [ ] `demarrer_routine` : réserve et satellite chaque mois, cœur à son mois, rôles à confirmer, événements passés du mois ; habitudes mises à jour à la clôture (lecture de `routines`).

## Phase 7 : qualité et livraison

### Tâche 26 — Banc d'évaluation (Opus high pour écrire les cas, Haiku low pour juger ; dès la phase 1)
- [ ] Cas du § 14.3 de la spec et correcteurs automatiques (verbes d'ordre suivis d'un nom de produit, mention fixe, producteur et date cités, aucun avis relié à la situation).

### Tâche 27 — Mécanique (Haiku, low, S)
- [ ] Textes au tutoiement, absence de « conseiller » et de produit recommandé, fiches du savoir, roadmap (`~/Finance/docs/boussole-roadmap.md` : statuts GOV1, SCO2, AVIS1, EVT1, EVT2, écarts D2 et D3 notés dans l'annexe G), mémoire.

### Tâche 28 — Relecture finale (Opus, high, M)
- [ ] Calculs et parité, sécurité (RLS des tables communes, aucune donnée personnelle chez le fournisseur ni chez les agents, `publications` en ajout seul), conformité de la présentation au § 9 (faits et jugements, avis identiques pour tous, mentions), gamification (§ 9.3), visuel 390 et 1 280 px en clair et en sombre.

### Tâche 29 — Déploiement (Sonnet, low, S, procédure écrite)
- [ ] Migrations appliquées et vérifiées par md5, fonctions `mcp`, `nightly`, `marche` déployées, tâches `pg_cron`, site publié et CI Pages au vert, tests de fumée (Haiku).

---

## Effort et coût

| Phase | Effort | Dépenses nouvelles |
|---|---|---|
| 0 | M | — |
| 1 GOV1 | ≈ 6 à 8 jours | — |
| 2 SCO2 | ≈ 3 à 4 jours | — |
| 3 Données | ≈ 6 à 8 jours | Fournisseur : essai 99,99 € pour un mois, puis devis B2B (plafond proposé 300 € par mois) |
| 4 EVT1 | ≈ 7 à 9 jours | Veille ≈ 6 à 10 $ par mois (ou quota de l'abonnement de Stéph) |
| 5 AVIS1 + EVT2 | ≈ 4 à 5 jours | — |
| 6 Ta semaine | ≈ 3 à 4 jours | — |
| 7 Qualité | ≈ 3 à 4 jours | Banc : quelques centimes par passage |

## Points de décision pour Stéph

| # | Décision | Avant |
|---|---|---|
| D0 | Doctrine (rôles, test du coût, avis et événements sans effet sur les actions) | Phase 1 |
| D2 | Météo sans note sur 20 | Phase 2 |
| D4 | Seuils et plafonds par défaut (après la tâche 0) | Phase 1 |
| **D1** | **Fournisseur et budget** (essai T11, devis, plafond 300 € par mois) | Phase 3 |
| D6 | Remplacer Yahoo | Phase 3 |
| D5 | Veille sur l'abonnement de Stéph ou en API | Phase 4 |
| D3 | Changements de recommandation hors de « Ta semaine » | Phase 5 |
| D7 | Avis juridique (§ 9.5 de la spec) | Ouverture au public (J5) |
| **D8** | **Option CIF** : rester hors du conseil, partenariat avec un CIF indépendant, ou statut propre (§ 13 de la spec) | J5 ou après |
