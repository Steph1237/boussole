# HIS2 : import de l'historique réel — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal :** les exports que l'utilisateur dépose dans la conversation (relevés bancaires, ordres, versements, relevés de contrats) deviennent, après sa validation en bloc, des totaux mensuels par compte et catégorie, des mouvements de placement datés et des photos mensuelles reconstituées avec leur source et leur qualité ; sans doublon, sans donnée sensible, sans jamais toucher au présent. La courbe maîtresse, le rendement, le budget et la projection en profitent.

**Spec :** `docs/superpowers/specs/2026-10-16-his2-historique-design.md`. À lire en entier, en particulier § 0 (décisions), § 4 (données), § 5 (contrôles), § 6 (fusion des sources), § 7 (reconstitution), § 8.5 (conduite) et § 14 (décisions D1 à D9).

**Repères :**
- Dépôt : `/Users/stephane/boussole`.
- Commandes : `npm test` (et `node --test test/<fichier>.test.mjs`), `node build.mjs`, `npm run gen` (copies générées des moteurs dans les fonctions, comme `projection-moteur.gen.js`).
- Base de test : PGlite, `test/helpers/pglite.mjs` (`baseComplete`, `comme`) ; modèles : `test/projection-pglite.test.mjs`, `test/mfa-pglite.test.mjs`, `test/banque-mois-compte-pglite.test.mjs`.
- Connecteur testé avec `stripTypeScriptTypes` et `vm` ; modèles : `test/projection-mcp.test.mjs`, `test/calendrier-mcp.test.mjs`.
- Fonctions serveur : modèle `test/nightly-frais.test.mjs` (`fetch` simulé).
- Préproduction locale (SEC5) : `npm run preprod:start`, foyers fictifs ; jamais de données réelles.
- Tutoiement (`test/tutoiement.test.mjs`), lexique (`test/ux4-lexique.test.mjs` : « Claude », jamais « conseiller »), aucun produit nommé, aucune donnée réelle (« Compte courant Exemple », « PEA Exemple », « ETF Monde A », 1 234 €). Aucun relevé ni ISIN de Stéph dans le dépôt.
- App en lecture seule (`test/lecture-seule.test.mjs`) : une seule écriture de contrôle ajoutée, `retirer_import` (D5), à lister dans ce test.
- Ne pas committer dans les tâches : c'est le contrôleur qui committe.
- **Migration : `0034_historique.sql`.** État au 2026-10-16 (tâche 0) : 0032 (`0032_suivi.sql`) et 0033 (`0033_connecteurs_autorises.sql`, la dernière appliquée en production) sont sur `main`. HIS2 prend 0034, BUD1 0035 et suivantes (D8, tranché). Vérifier au moment du code (`ls supabase/migrations` sur `main` et les branches) et renuméroter si besoin. Repartir **exactement** de la dernière définition en vigueur de `appliquer_propositions` (0032 si SUIVI est fusionné, sinon 0031 ; 0033 ne la redéfinit pas) et de `export_all` (0031, vérifier 0032 et 0033). Les politiques de double authentification suivent le modèle de **0033** (si elle n'est pas appliquée, celui de 0028, et le dire).

**Modèle par tâche** (roadmap § 3 bis) : **Opus** pour la tâche 0 (cas, conduite), la relecture sécurité de la migration, la relecture des calculs de reconstitution et la relecture finale ; **Sonnet** pour le code ; **Haiku** pour le mécanique (catalogue, textes, roadmap, tests de fumée). Effort : S ≤ ½ journée · M 1 à 2 jours · L 3 à 5 jours.

## Contrats communs (à respecter à l'identique dans toutes les tâches)

### Données (spec § 4)

| Table | Clé | Régime de double authentification | Écrite par |
|---|---|---|---|
| `historique_comptes` | `id` ; `cle` unique par utilisateur | bancaire (0033 : lecture aal2 ou connecteur autorisé, écriture aal2) | `appliquer_propositions` |
| `historique_imports` | `id` (= `ref` de la proposition) ; `empreinte` unique par utilisateur | bancaire | `appliquer_propositions`, `retirer_import` |
| `historique_releves` | `(user_id, compte_id, mois)` | bancaire | `appliquer_propositions` |
| `historique_banque_mois` | `(user_id, compte_id, mois, categorie, sous_categorie)` | bancaire | `appliquer_propositions` |
| `photos_reconstituees` | `(user_id, mois)` | « si facteur » | service (nuit) seulement |
| `transactions` (+ `import_id`, `cle_import`, `enveloppe`, `frais`, `doublon_de`, `estime`) | index unique `(user_id, cle_import)` partiel | « si facteur » (existant) | `appliquer_propositions` |
| `status` (+ `historique_a_recalculer timestamptz`) | — | existant | `appliquer_propositions`, `retirer_import`, nuit |

Fonctions SQL : `categorie_budget_valide(text)`, `sous_categorie_budget_valide(text, text)` (couture BUD1, spec § 4.3), `retirer_import(uuid)` (aal2, security invoker). Propositions : cible `historique`, opérations `creer` et `supprimer`, `ref` obligatoire, `apres` ≤ 100 000 octets.

### Types de transactions (spec § 4.4, le tableau fait foi)

`achat, vente, versement, programme, retrait, rachat, arbitrage_entree, arbitrage_sortie, dividende, interets, frais, releve, solde`. Une transaction avec `doublon_de` non nul est ignorée partout.

### Modules purs (UMD, sans DOM)

```
HistoriqueImport.normaliser(type, entree) → { contenu, erreurs: [{ chemin, message }] }
HistoriqueImport.controler(type, contenu, contexte) → { bloquants: [...], avertissements: [{ cle, message, donnees }] }
   contexte = { today, positions, transactions, cours, comptes, releves, banqueMois, reperes }
HistoriqueImport.empreinte(type, contenu) → Promise<hex64>          // SHA-256, forme canonique (spec § 5.4)
HistoriqueImport.clesNaturelles(mouvements) → mouvements avec cle_import et rang
HistoriqueImport.doublons(mouvements, transactions) → [{ transaction_id, mouvement_cle, ecart_jours, ecart_eur }]
HistoriqueImport.resume(type, contenu, controles) → { texte, mois?, totaux?, lignes?, remplaces?, ignores? }
HistoriqueImport.LIMITES, HistoriqueImport.TYPES_MOUVEMENT

Historique.reconstituer({ …existant, pas: "jour" | "mois", releves, soldesMois, depuisOuverture, especes }) → { points, …, qualites? }
Historique.qualite(contributions) → { qualite: complet|partiel|estime, part_estimee, sources }
Historique.deltaTx(t)            // types du § 4.4, doublon_de ignoré
Calc.moisBancaires(banque, historique, today) → [{ compte, mois, source: powens|import, categories, releve? , ecarte? }]
```

Copies générées : `supabase/functions/mcp/historique-import.gen.js`, `supabase/functions/mcp/historique.gen.js`, `supabase/functions/nightly/historique.gen.js` (et `calc` si le connecteur n'a pas déjà sa copie du calcul du budget réel : vérifier, `mcp/banque.ts` dit « même calcul que l'app, parité testée »).

### Connecteur (spec § 8)

Outils : `etat_historique` (RO) ; `importer_releves_mensuels`, `importer_ordres`, `importer_versements`, `retirer_import` (RW, dépôt de propositions). Conduite `CONDUITE_HISTORIQUE` (spec § 8.5) ; catalogue `SOURCES_HISTORIQUE` (spec § 8.4, statuts « aide officielle / inconnu / à confirmer » compris). Ajouts à `demarrer_session`, `demarrer_routine`, `lire_banque`, `projeter`.

## Ordre et dépendances

```
T0 (Opus) ─┬─> T1 migration ──> T2 relecture sécurité (Opus) ─┐
           │                                                    ├─> T6 outils MCP ──> T7 conduite et catalogue ─┐
           ├─> T3 historique-import.js ──> T4 copie générée ────┘                                              │
           │                                                                                                    ├─> T15 banc EX3
           ├─> T5 Calc.moisBancaires ─────────────────────────────> T9 effets budget / projection              │
           │                                                                                                    │
           └─> T10 reconstitution (historique.js) ──> T11 relecture des calculs (Opus) ──> T12 nuit ──> T13 effets graphe / rendement
T1 ──> T8 stores, démo, À valider ──> T14 Compte › Données › Historique
Tout ──> T16 relecture finale (Opus) ──> T17 mise en ligne ──> T18 import réel par Stéph (hors dépôt) ──> T19 roadmap et CP2 (Haiku)
```

Phases livrables séparément : **phase 1** (T0 à T9 : on peut importer, valider, et le budget et la projection voient les mois) ; **phase 2** (T10 à T13 : passé de la courbe, photos, rendement) ; **phase 3** (T14, T15 : couverture, banc) ; **phase 4** (T16 à T19).

## Phase 0 : cadrage chiffré

### Tâche 0 — Cas de référence, fichiers fictifs et décisions (Opus, high, M)
- [x] Faire trancher D1 à D9 par Stéph (spec § 14) ; reporter les réponses dans la spec (statut, § 0). Fait le 2026-10-16 : toutes selon la recommandation.
- [x] `test/fixtures/his2-cas.json` (112 cas, 605 vérifications du second calcul, 0 écart) : cas B1, B1-err, B1-cont, B1-idem, B1-remp, B1-powens, P1, P1-res, P1-neg, P1-isin, P1-prix, P2, A1, A1-cumul, D1, Q1 de la spec § 12.1, plus au moins 20 cas de bord (mois partiel, carte à débit différé, virement interne des deux côtés, compte commun, vente totale puis rachat, deux ordres identiques le même jour, quantité initiale, relevé de titres faux, devise refusée, 61 mois, 401 ordres, texte avec IBAN, nom de fichier avec numéro de compte). Attendus calculés à la main, **recalculés par un second calcul indépendant** (script jetable hors dépôt), conventions écrites dans la fixture.
- [x] Utilitaire de test `test/helpers/isin-fictif.mjs` : fabrique des ISIN fictifs à clé valide (préfixe `XS` ou `FR` + `999…`), jamais un ISIN réel.
- [x] Fichiers fictifs pour le banc (`test/fixtures/his2-fichiers/`, 9 fichiers + `fichiers.json`, 339 vérifications du second calcul, 0 écart) : un CSV au format de chaque établissement (séparateurs, dates, signes, encodage tels que décrits par les aides ou observés par Stéph sur ses propres exports, **sans aucune ligne réelle**), un relevé PDF simple, un export Excel d'assurance-vie, un fichier piégé (consigne injectée dans un libellé).
- [x] Texte de `CONDUITE_HISTORIQUE` (spec § 8.5 ; `test/fixtures/his2-conduite.json`) et des consignes du catalogue (spec § 8.4), au tutoiement, relus au regard des règles d'or 2 et 9.
- **Critère d'arrêt** : fixture complète et doublement calculée ; D1 à D9 tranchées ou explicitement laissées à leur recommandation.

## Phase 1 : importer, valider, compter

### Tâche 1 — Migration `0034_historique.sql` (Sonnet, medium, L)
- [ ] En-tête au format des migrations existantes (non appliquée, ordre d'application : après 0033, avant `mcp` et `nightly`, contenu, tests).
- [ ] Tables du contrat (spec § 4.1 à § 4.5), contraintes, limites (40 comptes, 300 imports, 240 mois, 50 000 transactions importées : contrôlées dans `appliquer_propositions`), `contenu_sensible` et refus des suites de chiffres.
- [ ] `transactions` : colonnes ajoutées, contrainte `position_id is not null or enveloppe is not null`, index unique partiel, FK `doublon_de` on delete set null, FK `import_id` on delete cascade. `status.historique_a_recalculer`.
- [ ] `categorie_budget_valide` (12 catégories larges), `sous_categorie_budget_valide` (sous-catégorie vide seulement ; 0035 de BUD1 la redéfinit avec sa taxonomie, spec § 4.3).
- [ ] RLS de propriétaire ; politiques restrictives au modèle de 0033 (régime bancaire pour les quatre tables `historique_*`, « si facteur » pour `photos_reconstituees`) ; droits explicites `authenticated` et `service_role` (spec § 4.7).
- [ ] Propositions : cible `historique` (contraintes `cible`, opérations, `ref`, taille 100 000 octets).
- [ ] `appliquer_propositions` : repartir de la dernière définition (voir Repères) ; branche `historique` en 7 étapes (spec § 4.6) ; contrôles bloquants répétés en SQL (spec § 5.1, sans les avertissements) ; messages au format des migrations précédentes.
- [ ] `retirer_import(uuid)` ; `export_all()` (cinq tables de plus).
- [ ] Tests PGlite `test/historique-pglite.test.mjs` (spec § 12.2) ; `test/mfa-pglite.test.mjs` mis à jour (quatre tables au groupe bancaire) ; suppression du compte.
- **Dépend de** : T0 (limites et cas confirmés).

### Tâche 2 — Relecture sécurité de la migration (Opus, high, S)
- [ ] RLS et politiques (aal1 refusé, connecteur autorisé en lecture seule sur les tables bancaires, service seul sur les photos), security invoker / definer, search_path, droits `anon`, injection dans les jsonb, tailles, contenu sensible, cascade et `on delete set null` corrects, `retirer_import` qui n'efface que les objets de l'import (y compris les lignes clôturées sans autre transaction).
- [ ] Points bloquants corrigés avant T6.
- **Dépend de** : T1.

### Tâche 3 — Module `web/src/historique-import.js` (Sonnet, medium, L)
- [x] TDD sur la fixture : normalisation, contrôles bloquants et avertissements (spec § 5.1, § 5.2), empreinte stable (ordre des mois, des catégories, des ordres ; arrondis ; libellés normalisés), clés naturelles et rangs, doublons avec la nuit et les saisies (7 jours, 2 € ou 2 %), résumé lisible au tutoiement. Fait : `web/src/historique-import.js` (`normaliser`, `controler`, `verifier`, `empreinte`/`empreinteSync`, `clesNaturelles`, `doublons`, `resume`, `versApres`, `decouper`) ; `test/historique-import.test.mjs` passe les 59 cas `controler`, 4 `empreinte`, 4 `clesNaturelles` et 8 `doublons` de la fixture sans en changer une valeur ; `test/historique-import-pglite.test.mjs` fait accepter par la base (0034) les `apres` produits (relevés, ordres, ligne clôturée créée, versements, doublon de la nuit, 60 mois découpés).
- [x] Limites (spec § 5.3) exportées et testées ; découpage d'un contenu au-delà de 100 000 octets en plusieurs imports (par année, puis par 200 mouvements). Le résumé et les avertissements sont rognés pour tenir dans les 4 000 octets du `resume` de la base (`compacter`).
- [x] Ajout à `SCRIPTS` de `build.mjs` si l'app l'utilise (description des propositions). Non nécessaire : la description des propositions (T8) lit `apres.resume` ; le module n'est pas chargé par l'app.
- **Dépend de** : T0.

### Tâche 4 — Copies générées et parité (Haiku, low, S)
- [x] `npm run gen` produit `supabase/functions/mcp/historique-import.gen.js` ; test « copie à jour » et parité des sorties sur tous les cas (`test/historique-import-gen.test.mjs`).
- **Dépend de** : T3.

### Tâche 5 — `Calc.moisBancaires` et budget réel (Sonnet, medium, M)
- [x] `web/src/calc.js` : `moisBancaires` (spec § 6.1) ; `budgetReel` le consomme (comportement inchangé sans import : tests existants verts) ; même changement dans le bloc de calcul du connecteur ; parité testée (cas B1, B1-powens). Fait : `Calc.moisBancaires(banque, historique, auj)` et `Calc.budgetReel(banque, auj, nb, historique)` ; le connecteur (`index.ts`, `budgetReel(banque, auj, nb, historique)`) délègue au moteur copié (`projection-moteur.gen.js`) dès qu'il y a des relevés importés ; `test/his2-calc.test.mjs` (13 cas de la fixture, dont B1, B1-powens, B-carte) et parité dans `test/mcp.test.mjs`.
- [x] `projection-donnees.js` (épargne constatée sur 12 mois) et la santé lisent la série fusionnée (`s.historique` / `S.historique`, alimentés par le store en T8).
- **Dépend de** : T0. **Coordonner avec BUD1** (qui consommera `moisBancaires`).

### Tâche 6 — Outils MCP (Sonnet, medium, L)
- [x] Nouveau module `supabase/functions/mcp/historique.ts` (au modèle de `banque.ts` et `projection.ts` : utilitaires passés en paramètre, aucun calcul dupliqué) : `etat_historique`, `importer_releves_mensuels`, `importer_ordres`, `importer_versements`, `retirer_import` ; schémas `z.strictObject` (spec § 8.1 à § 8.3) ; `accord_utilisateur` exigé ; résolution des ISIN vers les lignes ; `lignes_a_creer` ; dépôt par `deposer` (un lot par session, une proposition par import) ; garde de double authentification (message existant) ; 60 appels d'import par jour. Fait ; `CONDUITE_HISTORIQUE` et `SOURCES_HISTORIQUE` (textes de T0, copiés à l'identique) sont déjà dans ce module parce que les outils les renvoient ; la tâche 7 fait le reste (INSTRUCTIONS, ajouts aux outils existants). Le quota « 60 imports par jour » compte les propositions `historique` déposées depuis 24 h. `deposer` (index.ts) ne compare plus les imports d'historique (100 000 octets de `apres`) : `historique.ts` contrôle leur empreinte et les retraits en attente lui-même.
- [x] Aperçu de l'effet d'un import (spec § 7.4, connecteur) : branché en T13, une fois la reconstitution étendue ; renvoyer `apercu: null` d'ici là.
- [x] Tests `test/historique-mcp.test.mjs` (spec § 12.4) : annotations RO/RW, dépôt jamais direct, refus sensibles, plafonds, empreinte déjà vue, sortie de `etat_historique` sans libellé ni numéro.
- **Dépend de** : T2, T4.

### Tâche 7 — Conduite, catalogue et outils existants (Sonnet, low, M)
- [x] `CONDUITE_HISTORIQUE` et `SOURCES_HISTORIQUE` (textes de T0, copiés à l'identique en T6, test d'égalité avec `his2-conduite.json`) ; résumé dans `INSTRUCTIONS` ; règle 22 de la conduite du Copilote ; N26 ajouté à `SOURCES` (`routines.ts`).
- [x] `demarrer_session` (`historique` : `court`, `couverture_mois`, `part_estimee`, `a_demander` 3 au plus), `demarrer_routine` (`historique.comptes_a_importer` : import du mois écoulé pour les comptes importés non connectés, règle 2 octies), `lire_banque` et la revue (budget réel par `Calc.moisBancaires` avec `sources_par_mois` ; relevés importés seuls quand la banque connectée est éteinte), `projeter` et les bonnes pratiques (série fusionnée : `lireBanqueCalcul` attache `banque.historique`, `lireDonneesProjection` donne `relevesBancaires` au moteur). Le champ des données du moteur s'appelle `relevesBancaires` (et non `historique`, déjà pris par le rétro-contrôle des photos) ; il remplace `S.historique` de la tâche 5. `list_propositions` ne rend que le résumé et l'empreinte d'un import d'historique.
- [x] Tests de la conduite renvoyée et des ajouts (`test/historique-mcp.test.mjs`, `test/banque-mcp.test.mjs`, `test/routines-mcp.test.mjs`).
- **Dépend de** : T5, T6.

### Tâche 8 — Stores, démo et « À valider » (Sonnet, medium, M)
- [x] `store-supabase.js` : lecture des quatre tables bancaires (sous aal2, même garde que `banque`), des nouvelles colonnes de `transactions` et de `photos_reconstituees` ; `Store.historique.retirer(id)` (RPC `retirer_import`), seule écriture ajoutée.
- [x] `store-demo.js` : un foyer fictif avec 14 mois importés d'un compte courant (un mois manquant), un PEA importé (P1), un import retiré dans l'historique ; aucune donnée réelle.
- [x] `propositions.js` : cible `historique` (libellé, phrases par type, détail replié, avertissements, non modifiable) ; tests de `decrire`.
- [x] `test/lecture-seule.test.mjs` : `retirer_import` listée comme écriture de contrôle.
- **Dépend de** : T1, T3.

### Tâche 9 — Effets budget et projection dans l'app (Sonnet, low, S)
- [x] Patrimoine › Budget (en attendant BUD1) et la projection affichent les mois importés avec leur source (`Calc.budgetReel` rend `moisImportes`, la note du budget dit « Dont N mois tirés de relevés que tu as déposés dans la conversation » ; `budgetReelDe` lit la série fusionnée, même sans banque connectée) ; la mention « relevés trop courts » du graphe se fonde sur la série fusionnée (la capacité constatée du moteur de projection, `epargnePasseDe` du graphe, les bonnes pratiques de Santé, Aujourd'hui, Actions et Journal lisent `S.relevesBancaires`).
- [x] Tests DOM ciblés (`test/historique-effets.test.mjs`, `test/historique-store.test.mjs`) ; fumée en préproduction locale avec un foyer fictif (import validé → budget réel sur 12 mois) : `test/historique-preprod.test.mjs`.
- **Dépend de** : T5, T8.

## Phase 2 : le passé de la courbe, les photos, le rendement

### Tâche 10 — Reconstitution étendue (Sonnet, medium, L ; relecture des calculs : Opus en T11)
- [x] `web/src/historique.js` (spec § 7.2) : lignes clôturées avec transactions, prix des ordres comme cours implicites, `depuisOuverture`, lignes manuelles par relevés de valeur et flux nets, soldes de fin de mois des comptes, espèces d'enveloppe (si ligne d'espèces, D6), `doublon_de` ignoré, `deltaTx` aux types du § 4.4, mode `mois` sur 20 ans, `qualite` et `part_estimee` (spec § 7.3). Fait : `Historique.reconstituer({ pas: "mois" | "jour", releves, soldesMois, depuisOuverture, especesSuivies, jusqua, qualites, detailLignes })` rend aussi `nature`, `detail` (titres / espèces), `qualites` et `recalageEspeces` ; nouvelles fonctions `Historique.qualite`, `photos` (lignes de `photos_reconstituees`, répartition par personne et par poche comme `take_snapshots`), `depuisOuverture` et `soldesMois` (partagées par l'app et la nuit) ; `deltaTx` aux types du § 4.4. Hors fixture (choix de T10, à relire en T11) : une ligne cotée sans aucun mouvement est « à composition actuelle » donc estimée (source « cours ») ; avant le premier mouvement connu d'une ligne (hors `depuis_ouverture`) la quantité déduite du présent est estimée ; un versement ou un dividende converti en parts d'une ligne cotée ne passe pas par les espèces ; une ligne manuelle n'est « à relevés de valeur » que si elle a un relevé ou si son enveloppe est `depuis_ouverture` (sinon elle reste constante comme avant).
- [x] TDD sur P1, P2, A1, D1, Q1 en modes jour et mois ; non-régression de `test/historique.test.mjs` ; performance (spec § 12.3). Fait : `test/his2-reconstitution.test.mjs` (les 8 cas `reconstituer`, les 6 `qualite`, `deltaTx` T-types / D1, mode jour, D1 avec et sans `doublon_de`, photos, 20 ans en mode mois en ~25 ms une fois le moteur échauffé) ; adaptateur `test/helpers/his2-reconstitution.mjs`.
- [x] `SerieNet.charger` lit les transactions importées, les relevés et les soldes ; au-delà de 5 ans, les photos stockées. Fait : transactions lues depuis le début des imports (20 ans au plus), `SerieNet.soldesMois`, enveloppes `depuis_ouverture` des imports, `photosAvant` (photos stockées plus anciennes que la fenêtre calculée, net refait avec les biens hors placements d'aujourd'hui) ; `test/his2-serie-net.test.mjs`.
- **Dépend de** : T0, T8.

### Tâche 11 — Relecture des calculs (Opus, high, S)
- [x] Sens des flux et des quantités (tableau § 4.4), recalage de `fusionner` avec un historique réel (écart attendu faible ; au-delà de 5 %, `etat_historique` doit le dire), qualité, cas de bord de la fixture. Points bloquants corrigés avant T12. Fait (relecture menée par l'exécutant de T10 à T12, pas par Opus : à refaire par Opus en relecture finale T16 si besoin) : (1) écart avec le tableau § 4.4 corrigé : `achat` et `vente` sont des flux de valeur (+ / −) sur une ligne manuelle, test sur tous les types ; (2) sens des quantités et des espèces relus ligne à ligne contre le tableau (deltaTx testé sur T-types, D1/flux, D1/retrait ; espèces testées sur P2) ; (3) recalage de `fusionner` : l'écart est celui du dernier mois reconstitué (photos mensuelles) contre la première photo, il comprend l'évolution des marchés du mois ; `etat_historique` le dit au-delà de 5 % du patrimoine de la première photo (`photos.recalage`, `a_signaler`, `texte`) ; test dans `test/historique-mcp.test.mjs` ; (4) qualité et cas de bord de la fixture (bornes 5 % / 30 %, valeur négative, zéro) testés ; (5) choix hors fixture listés en T10, à confirmer.
- **Dépend de** : T10.

### Tâche 12 — La nuit : cours anciens, photos, rétention (Sonnet, medium, M)
- [x] `nightly` : rattrapage prioritaire des cours avant la plus ancienne transaction importée (plage `max` au-delà de 5 ans), dans la limite actuelle de 10 ISIN par nuit ; recalcul des photos des utilisateurs dont `historique_a_recalculer` est posé (copie générée `nightly/historique.gen.js`, écriture service, jamais à partir de la première photo observée) ; réduction des propositions `historique` décidées depuis 30 jours (D7). Fait : `supabase/functions/nightly/photos.ts` (`coursAnciens`, `demanderRecalcul`, `utilisateursARecalculer`, `recalculerPhotos`, `marquerCalcule`, `reduirePropositions`) appelé par `index.ts` (étapes 4 et 4 bis) ; copie générée `supabase/functions/nightly/historique.gen.js` (`npm run gen`, modules reperes, calendrier, calc, historique) ; script `npm run check:nightly` (deno check, ajouté à `check:fonctions`). Aucune migration : lectures et écritures du service sur les tables de 0034 et de 0001 à 0033. Choix : les ISIN à rattraper sont ceux dont le plus ancien mouvement importé précède de plus de 7 jours le plus ancien cours stocké (plage `max` si le mouvement remonte à plus de 5 ans moins 30 jours, sinon `5y`), sans nouvel essai avant 7 jours (`cours_rattrapage_le`), ni quand les cours remontent déjà au-delà de 5 ans (la plage max a eu lieu), ni pour un instrument récent déjà tenté ; ils passent avant la RPC `cours_a_rattraper` dans les 10 de la nuit ; des cours anciens arrivés posent `status.historique_a_recalculer` et les photos sont recalculées la même nuit. Les photos commencent au premier mouvement importé (ou à la veille du premier mois relevé), le détail Powens des 90 derniers jours n'entre pas dans les photos de la nuit (elles sont mensuelles et antérieures à la première photo observée). Budget de temps : aucun nouvel utilisateur après 100 s, lecture interrompue à 135 s, la demande reste posée.
- [x] Tests `test/nightly-historique.test.mjs` (`fetch` simulé) : bornes, idempotence, un utilisateur qui retire un import (photos recalculées), aucune photo après la première observée. Fait : 20 tests (copie à jour et parité sur les cas de la fixture, valeurs de P1, idempotence, import retiré, première photo observée, 240 mois, demande arrivée pendant le calcul, autre utilisateur, temps, erreur de lecture, biens hors placements, relevés bancaires, cours anciens et leurs bornes, 10 ISIN, hors ligne, rétention) ; les bases factices de `nightly-fonction` et `nightly-hors-ligne` gèrent les filtres de photos.ts (tables vides).
- **Dépend de** : T1, T11.

### Tâche 13 — Effets sur la courbe, le rendement et le connecteur (Sonnet, medium, M)
- [x] Courbe maîtresse : reconstitué en pointillé (existant), plus pâle pour `estime`, texte du curseur avec la part mesurée (spec § 9.3) ; tests de `graphe-modele.js` et `graphe-patrimoine.js`. Fait (ajouts seulement, pour faciliter la fusion avec la branche du graphe) : `reconstituer` rend `qualite` et `part_estimee` par point, `fusionner` les garde, `graphe-modele.passeDe` les passe (`part_estimee`), `graphe-patrimoine` les normalise (`passe.pe`), trace les tronçons dont la photo est `estime` (plus de 30 % estimé) avec `gp-recon-estime` (opacité .45) et dit au curseur « Reconstitué à partir de tes relevés et de tes ordres (82 % mesuré) » (texte d'avant inchangé sans qualité connue) ; `SerieNet.reconstitution` calcule les qualités et les photos stockées portent la leur. Tests : `test/graphe-patrimoine.test.mjs`, `test/graphe-modele.test.mjs`, `test/his2-serie-net.test.mjs`.
- [x] RDT1 : `Rendement.pointsEtFlux` lit les photos reconstituées (avec leur qualité) et le sens des flux du § 4.4, y compris « espèces non suivies ». **À faire avec le chantier RDT1** (arbre `boussole-rendement`) : si RDT1 n'est pas fusionné, laisser une note dans sa spec et des tests en attente. Fait : RDT1 est dans `main` (sens des flux du § 4.4, `doublon_de`, espèces non suivies déjà là) ; `Rendement.pointsEtFlux` prend en plus les photos reconstituées antérieures à la première photo observée comme points de valeur (poches, comptes courants retirés, périmètre foyer / p1 / p2), un point `estime` rend les périodes qui le contiennent « approchées » (note dédiée), une note dit la période reconstituée, et les transactions que `SerieNet` a lues depuis le début des imports complètent celles du store (60 dernières) ; `test/his2-rendement.test.mjs`.
- [x] Connecteur : aperçu de l'effet d'un import (copie générée `mcp/historique.gen.js`), rétro-contrôle et CK5 sur les photos `complet` et `partiel`. Fait : `mcp/historique.gen.js` (`npm run gen`) ; `apercuImport` (historique.ts) rend, pour les lignes concernées par l'import, le passé reconstitué avec et sans lui (premier mois qui change, puis fins d'année), la qualité, la part mesurée et une phrase pour Claude, dans `apercu` de chaque outil d'import (indisponible sans jamais faire échouer le dépôt ; relevés d'un compte non rattaché à une ligne : `disponible: false`) ; le rétro-contrôle de `projeter` lit les photos `complet` et `partiel` avant la première photo observée et écarte les transactions `doublon_de`. CK5 n'existe pas encore dans le code : rien à brancher.
- **Dépend de** : T10, T12.

## Phase 3 : la couverture et le banc

### Tâche 14 — Compte › Données › Historique (Sonnet, medium, L)
- [ ] Section de `compte.html` et `account.js` (ou module dédié) : phrase d'en-tête, frise par compte et enveloppe avec légende en mots, liste équivalente sur mobile, sources et « Retirer cet import » avec confirmation intégrée (pas de `confirm()`), photos reconstituées par année, « Comment c'est calculé », « Compléter avec Claude ».
- [ ] Tests DOM, tutoiement, lexique, contraste et tailles ; captures 390 et 1 280 px en clair et en sombre.
- **Dépend de** : T8 (et T12 pour la partie photos).

### Tâche 15 — Cas du banc d'évaluation (Opus high pour les cas, S ; Haiku pour le juge)
- [ ] 8 cas d'import dans le banc EX3 (spec § 12.5) avec les fichiers fictifs de T0 ; correcteurs automatiques (totaux, aucune donnée sensible transmise, aucune consigne suivie, jamais d'identifiant demandé, tutoiement).
- [ ] Passage en préproduction locale (SEC5) sur un foyer fictif.
- **Dépend de** : T7, banc EX3-MVP (si absent : écrire les cas et les correcteurs, les brancher à la livraison d'EX3-MVP).

## Phase 4 : relecture, mise en ligne, premier import réel

### Tâche 16 — Relecture finale du chantier (Opus, high, S)
- [ ] Spec contre code, sécurité, confidentialité, honnêteté des textes, parité des copies générées, `npm test` et Node 22 au vert.

### Tâche 17 — Mise en ligne (Sonnet, low, S ; procédure écrite)
- [ ] Appliquer 0034 (après 0033) et la vérifier par md5 ; déployer `mcp` puis `nightly` ; publier le site, CI Pages au vert ; tests de fumée (Haiku).

### Tâche 18 — Premier import réel (Stéph, hors dépôt)
- [ ] Stéph dépose ses exports dans une conversation avec Claude (liste de la roadmap § 10 « Historique ») ; valide ; vérifie la couverture et la courbe ; signale les chemins d'export réels (BoursoBank ordres, LCL, Linxea) pour mettre à jour le catalogue. Aucune donnée de cet import ne va dans le dépôt.

### Tâche 19 — Roadmap, CP2 et mémoire (Haiku, low, S)
- [ ] Roadmap privée (`~/Finance/docs/boussole-roadmap.md`) : statut HIS2, journal « Fait », décisions, migration 0034 (et 0035 pour BUD1) ; case « Historique » de la section 10 mise à jour.
- [ ] CP2 : marquer le § 2 et le § 3 « remplacés par HIS2 » (lien vers cette spec).
- [ ] Catalogue des consignes mis à jour avec les retours de T18.
