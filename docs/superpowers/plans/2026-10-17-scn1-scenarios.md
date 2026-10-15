# SCN1 : scénarios de décision patrimoniale (V1) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal :** une section Pilotage › Scénarios à deux onglets (« Pour toi », « Mes variantes ») ; un catalogue partagé et versionné (`scenarios`) ; cinq scénarios calculés sur les mêmes tirages que le moteur PROJ, en euros d'aujourd'hui, nets de frais et d'impôts de sortie, avec leur bande P10–P90, leurs hypothèses sourcées et « ce qui changerait la réponse » ; les parties jouées gardées dans une table privée (`scenarios_joues`) écrite seulement par des propositions validées dans l'app ; un scénario retenu devient une variante figée et un plan figé ; trois outils MCP (`lister_scenarios`, `jouer_scenario`, `lire_scenario`).

**Spec :** `docs/superpowers/specs/2026-10-17-scn1-scenarios-design.md`. À lire en entier avant de commencer, en particulier § 0 (décisions), § 5 (états), § 6 (module et formules), § 7 (les cinq scénarios et leurs cas), § 8 (repères), § 11 (migrations et sécurité), § 13 (tests) et § 15 (décisions D1 à D14, **à trancher par Stéph avant la phase 1**).

**Repères :**
- Dépôt : `/Users/stephane/boussole`.
- Commandes : `npm test` (et `node --test test/<fichier>.test.mjs`), `node build.mjs`, `npm run gen` (copie du moteur, désormais avec `scenarios.js`, et catalogue des formulaires), `npm run check:mcp`.
- Base de test : PGlite, `test/helpers/pglite.mjs` (`baseComplete` jusqu'à 0037, `comme`) ; modèles : `test/projection-pglite.test.mjs`, `test/historique-pglite.test.mjs`, `test/mfa-pglite.test.mjs`, `test/connecteur-autorise-pglite.test.mjs`.
- Connecteur testé avec `stripTypeScriptTypes` et `vm` ; modèles : `test/projection-mcp.test.mjs`, `test/suivi-mcp.test.mjs`, `test/formulaire.test.mjs`.
- Préproduction locale (SEC5) : `npm run preprod:start`, foyers fictifs `banc/foyers/*.json`, banc `banc/cas/`.
- Tutoiement (`test/tutoiement.test.mjs`), jamais « conseiller » (`test/conseiller.test.mjs`), aucun produit, contrat ni établissement nommé ou recommandé, aucune donnée réelle (foyer « Camille et Sam », montants ronds).
- App en lecture seule (`test/lecture-seule.test.mjs`) : seule écriture nouvelle permise, si D3 est retenue, `scenarios_joues.etat` et `decide_le` (transitions vers « écarté » et retour).
- Ne pas committer dans les tâches : c'est le contrôleur qui committe.
- Migrations : **0038** (base) et **0039** (repères et catalogue) ; prérequis 0034 (HIS2) et 0035 à 0037 (BUD1) ; repartir **exactement** des dernières définitions en vigueur de `appliquer_propositions`, `export_all` (0035), `foyer_valider_variante` (0031), `propositions_cible_check` (0034). Vérifier le premier numéro libre au moment du code.

**Modèle par tâche** (roadmap § 3 bis) : **Opus** pour la phase 0 (cas chiffrés et repères), la conception de l'extension du moteur, la sécurité (migration, RLS, garde), la relecture des calculs financiers, le contenu du catalogue et la relecture finale ; **Sonnet** pour le code (TDD) ; **Haiku** pour le mécanique (textes, renvois, captures, roadmap, tests de fumée). Effort : S ≤ ½ journée · M 1 à 2 jours · L 3 à 5 jours.

## Contrats communs (à respecter à l'identique dans toutes les tâches)

### Données (spec § 4, § 5, § 11)

| Où | Forme | Défaut |
|---|---|---|
| `scenarios` | `(id, cle, numero, theme, question, resume, pertinence, donnees, questions, reperes text[], calcul, version_calcul, ouverture, garde_fous, evals, version, statut, changelog, mis_a_jour_le, publie_le)` | `statut = brouillon` |
| `scenarios_versions` | copie par déclencheur, `unique (scenario_id, version, statut)` | — |
| `scenarios_joues` | `(id, user_id, scenario_cle, scenario_version, version_calcul, version_modele, etat joue\|retenu\|ecarte, reponses ≤ 8 ko, resultat ≤ 60 ko, enjeu_annuel_p50, graine, chemins, variante_id?, plan_fige_id?, source, joue_le, decide_le, created_at, updated_at)` ; 20 par scénario, 200 en tout | — |
| `propositions.cible` | + `scenario_joue` (`creer`, `modifier`, `supprimer`) | — |
| `plans_figes.raison` | + `scenario` | — |
| `foyer_variantes.hypotheses` | + `enveloppe_scenario` (spec § 6.6) | absent |

### Modules (UMD, sans DOM)

```
Scenarios.VERSION_CALCUL ("scn-1.0.0"), CALCULS, THEMES
Scenarios.pertinence(entree, data, today) → { pertinent, raisons, manquants }
Scenarios.enjeu(entree, data, today, { chemins }) → { p10, p50, p90, statut, raison? }
Scenarios.lister(catalogue, data, joues, today) → { pour_toi, par_theme, cartes }
Scenarios.jouer(entree, data, reponses, today, { chemins, graine }) → resultat (spec § 6.7)
Scenarios.varianteRetenue(entree, resultat, option_id) → { nom, description, hypotheses }
Scenarios.reponsesValides(entree, reponses) → null | [message]
Scenarios.simulerEnveloppes(data, plan, opts) → { options, P, T, graine }

Evenements.HYPOTHESES_VARIANTE += "enveloppe_scenario" ; Evenements.validerVariante (bornes du spec § 6.6)
Projection.versionModele = "proj-1.3.0" ; compartiments synthétiques d'enveloppe_scenario (spec § 6.6)
```
Copie : `supabase/functions/mcp/projection-moteur.gen.js` (`MODULES_MOTEUR` + `"scenarios"`, `EXPORTS_MOTEUR` + `Scenarios`), décision D14.

### Connecteur (spec § 9)
`supabase/functions/mcp/scenarios.ts` : `registerScenarios(server, deps)` ; lecture `lister_scenarios`, `lire_scenario` ; calcul et proposition `jouer_scenario` (`enregistrer: non|joue|retenu|ecarte`) ; `CONDUITE_SCENARIOS` ; section `scenario` du formulaire ; ajout à `demarrer_session`.

### Fixture
`test/fixtures/scenarios-cas.json` : `conventions` (déterministe, π, rendements et frais des cas), `reperes` (§ 8.2 et § 8.4 de la spec, format de 0030), `textes` (règles sans valeur, avec source et date), `catalogue` (les 5 entrées v1), `cas` (par scénario : entrées, attendu, calcul en clair ; PEA-1 à PEA-3, PER-1, PER-2, MAT-1, AV-1 au moins, plus les cas « manquant », « repère absent », « repère expiré » et limites du § 13.1), `seconde_verification` (script et écarts : aucun admis).

## Ordre et dépendances

```
Phase 0 (cas chiffrés, repères)  ──►  Phase 1 (migration 0038 + revue sécurité)  ──►  Phase 2 (module, moteur)  ──►  Phase 3 (connecteur)  ──►  Phase 4 (interface)  ──►  Phase 5 (revue, banc, production)
        │                                    ▲
        └── décisions D1 à D14 (Stéph) ──────┘ avant la phase 1 (D6, D8, D11 peuvent attendre la phase 4)
```
- Les tâches 5 et 6 (module) peuvent démarrer en parallèle de la phase 1 : elles ne lisent que la fixture.
- La tâche 7 (extension du moteur) est indépendante de la base sauf pour la parité de validation SQL (tâche 3).
- **Dépendance BUD1** : 0035 à 0037 appliquées avant 0038 (en test, `baseComplete` jusqu'à 0037). `Budget.reference` (BUD1 tâche 7) est lu par le scénario 6 ; tant qu'il n'existe pas, repli et bouchon (spec § 12.1). Le nom exact du champ « Essentiels » est à figer avec la tâche 7 de BUD1.

---

## Phase 0 : cas chiffrés à la main et repères

### Tâche 0 — Cas de référence et repères (Opus, high, M)
- [ ] Recalculer **à la main ou par un script jetable indépendant** (jamais avec le futur module) les cas PEA-1, PEA-2, PEA-3, PER-1, PER-2, MAT-1, AV-1 du spec § 7, au centime, et noter tout écart (aucun admis) ; corriger le spec si un chiffre change.
- [ ] Ajouter par scénario au moins un cas de plus (4 au moins par scénario) et les cas « manquant », « repère absent », « repère expiré », limites (horizon 4 ans 11 mois et 5 ans 1 mois, plafond PEA atteint, TMI 0 %, matelas nul, surplus nul, LEP au seuil 35 326 € et à 35 327 € pour 2 parts) ; un cas Monte-Carlo de contrôle par scénario (graine fixée, 2 000 chemins, valeurs P10 / P50 / P90 relevées après la tâche 6 et figées).
- [ ] Vérifier sur la source primaire et dater les points du spec § 8.3 : plafonds des frais du PEA (CMF art. D221-109 et suivants, Légifrance) ; transfert d'assurance-vie chez le même assureur (Code des assurances, loi n° 2019-486, Légifrance) ; point de départ des 8 ans pour les primes versées après l'ouverture (BOFiP) ; ordre d'imputation des plafonds PER reportés (CGI art. 163 quatervicies, F14709) ; durée de l'épargne de précaution (mesquestionsdargent.fr, banque-france.fr, economie.gouv.fr). Pour chacun : valeur ou texte retenu avec source et date, ou le comportement prudent du spec appliqué et écrit.
- [ ] Revérifier le jour même les trois repères nouveaux (`lep_rfr_demi_part_sup`, `lep_rfr_quart_part_sup`, `per_plafond_taux_revenus`) et les textes du § 8.2 (F2367, F14709, F2385, F22414, F34982) ; aucune valeur non vérifiée n'entre dans la fixture.
- [ ] Rédiger `test/fixtures/scenarios-cas.json` (format du § « Fixture ») et les 5 entrées du catalogue v1 (questions, pertinence, données, repères, garde-fous, `ouverture`), au tutoiement, sans aucun nom d'établissement ni de produit.
**Fini quand :** la fixture est complète, recalculée deux fois, chaque repère a sa source et sa date, le spec est cohérent avec la fixture.

### Tâche 1 — Décisions de Stéph (Haiku, low, S)
- [ ] Reporter les décisions D1 à D14 tranchées dans le spec (§ 15, statut et date) et, si une décision diffère de la recommandation, les sections touchées (liste dans la tâche).

---

## Phase 1 : migration 0038 et revue de sécurité

### Tâche 2 — Tests de base d'abord (Sonnet, medium, M)
- [ ] `test/scenarios-pglite.test.mjs` : tout le § 13.4 du spec (contraintes, RLS, politique restrictive aal2 et connecteur autorisé, **garde `client_id` sur insert, update et delete**, propositions `scenario_joue` créer / retenir / écarter / supprimer, retenue en une transaction avec variante et plan, limite de 10 variantes, limites 20 / 200, transitions, droits de colonnes si D3, clés composites, `export_all`, cascade, lecture publique des seules lignes publiées de `scenarios`, versions copiées, contenu sensible et mot interdit refusés).
- [ ] Étendre `test/mfa-pglite.test.mjs` (la table `scenarios_joues` doit y apparaître) et `test/connecteur-autorise-pglite.test.mjs` (lecture permise, écriture refusée).
- [ ] Test « 0038 sans 0035 » : échec explicite (fonctions attendues absentes).

### Tâche 3 — `0038_scenarios.sql` (Sonnet, medium, L)
- [ ] Tables `scenarios`, `scenarios_versions`, `scenarios_joues` ; index ; `unique (user_id, id)` sur `foyer_variantes` et `plans_figes` ; clés composites `on delete set null (colonne)` ; déclencheurs (`set_updated_at`, versions, limites avec verrou consultatif).
- [ ] RLS propriétaire ; politique restrictive « scenarios_joues: aal2 si facteur » **à la forme exacte de 0033** ; garde `scenarios_joues_garde` (refus `42501` pour tout jeton à `client_id`) ; droits de colonnes (D3) et transitions permises hors propositions ; `revoke all from anon` ; droits explicites de `service_role`.
- [ ] `propositions_cible_check` + `scenario_joue` ; `appliquer_propositions` (repartir de 0035 ; branche `scenario_joue` du spec § 5.3 et § 11.1 ; garde OAuth en tête conservée) ; `foyer_valider_variante` + `enveloppe_scenario` (messages identiques au JS de la tâche 7) ; `plans_figes.raison` et branche `plan_fige` + `scenario` ; `export_all` + `scenarios_joues`.
- [ ] En-tête de migration au format de 0034 : ce qui change, prérequis (0034 à 0037), vérifications à faire en production avant (`server_version_num` ≥ 150000, unicité `(user_id, id)` possible sans doublon), tests.

### Tâche 4 — Revue de sécurité de 0038 (Opus, high, S)
- [ ] Fermer les 9 points du spec § 11.3 ; relire chaque `security invoker` / `search_path`, chaque `(select auth.jwt())`, la garde contre un jeton OAuth autorisé, l'absence de lecture croisée par les clés composites, les tailles, `contenu_sensible`, la parité des messages JS et SQL de la validation de variante, le diff d'`appliquer_propositions` contre 0035 (limité à la branche et à la cible).
- [ ] Liste des points bloquants, corrigés avant la phase 2 ; les suggestions non bloquantes notées dans le spec (§ 16).

---

## Phase 2 : module de calcul et moteur

### Tâche 5 — Socle `simulerEnveloppes` (Sonnet, medium, M ; relecture Opus en tâche 8)
- [ ] Tests d'abord (`test/scenarios-mc.test.mjs`) : mêmes tirages que `derouler` sur un compartiment seul (à 1e-9), flux en fin de mois, frais mensuels, fonds euros à volatilité nulle, livrets au taux du repère jusqu'à sa `date_fin`, débordement au plafond, impôts par `ProjectionFiscalite` aux dates de 5 et 8 ans, euros d'aujourd'hui, écart chemin par chemin, date de bascule, mode déterministe égal aux cas de la fixture, monotonie, graine reproductible, temps (spec § 6.2).
- [ ] `web/src/scenarios.js` : `simulerEnveloppes`, utilitaires d'écart, de quantiles et de seuil (dichotomie, 12 itérations au plus), sur `Projection.tirages`, `ProjectionDonnees.parametresClasse`, `ProjectionFiscalite`, `Calendrier`, `Reperes`.

### Tâche 6 — Les cinq calculs, la pertinence et l'enjeu (Sonnet, medium, L ; relecture Opus en tâche 8)
- [ ] Tests d'abord (`test/scenarios.test.mjs`) : tous les cas de la fixture (déterministes au centime, Monte-Carlo aux valeurs figées), `a_completer` et manquants, `indisponible` sur repère absent, `a_reverifier` sur repère expiré ou trop ancien (`Reperes.aVerifier`), exclusions d'options (PER hors retraite et hors résidence principale, PEA sous 5 ans), « ce qui changerait » (seuils de TMI, frais de seuil, date de bascule), pertinence (chaque clé du § 6.4), tri « pour toi » (3 au plus, seuil d'enjeu, écartés exclus), gabarits de texte (tutoiement, aucun mot interdit, aucun nom de produit), `reponsesValides` (clé inconnue, borne, type, aucune chaîne libre), `varianteRetenue` (forme validée par `Evenements.validerVariante`).
- [ ] `ouvrirPea`, `prochainEuro`, `perInteret`, `matelas`, `avMaintenant`, `pertinence`, `enjeu`, `lister`, `jouer`, `varianteRetenue`, `reponsesValides` ; repli du scénario 6 sans BUD1 et bouchon de `Budget.reference`.
- [ ] `scripts/gen-catalogue.mjs` : `"scenarios"` ajouté à `MODULES_MOTEUR`, `Scenarios` à `EXPORTS_MOTEUR` (D14) ; `npm run gen` ; test de parité de la copie.

### Tâche 7 — Moteur PROJ : hypothèse `enveloppe_scenario` (Opus, high, S pour la conception ; Sonnet, medium, M pour le code)
- [ ] Opus : préciser dans le spec (§ 6.6) l'ordre exact dans la cascade (versement mensuel à l'étape 1, initial au niveau 1 de l'ordre de retrait, économie PER en septembre N+1, débordement, transfert depuis un livret), et les cas de test ; vérifier qu'aucune sortie existante ne peut changer.
- [ ] Tests d'abord (`test/projection-enveloppe-scenario.test.mjs`) : spec § 13.3, dont la **non-régression complète de `proj-1.2.0`** (fixtures `projection-cas.json`, Monte-Carlo, démo) et la parité des messages de validation JS et SQL.
- [ ] `projection-evenements.js` (validation, `HYPOTHESES_VARIANTE`), `projection-donnees.js` (compartiments synthétiques), `projection.js` (cascade, `versionModele = "proj-1.3.0"`) ; `npm run gen`.

### Tâche 8 — Relecture des calculs financiers (Opus, high, M)
- [ ] Relire le socle, les cinq calculs et l'extension du moteur contre la fixture et le spec : fiscalité (PEA avant et après 5 ans, clôture ; assurance-vie avant et après 8 ans, prorata 150 000 €, abattement imputé d'abord sur la fraction à 7,5 % ; PER effort net, plafond, sortie en capital ; livrets et LEP), euros d'aujourd'hui, frais, débordements, seuils.
- [ ] Test de cohérence socle contre moteur complet à 1 % (spec § 6.3) sur un foyer sans cascade active, puis sur la démo (écart expliqué s'il dépasse 1 %).
- [ ] Cas limites : revenus nuls, une seule personne, couple non marié (pas d'imposition commune), dates d'ouverture inconnues, enveloppe déjà au plafond, TMI inconnue, repère expiré.
- [ ] Points bloquants corrigés avant la phase 3.

---

## Phase 3 : connecteur

### Tâche 9 — Outils MCP (Sonnet, medium, M)
- [ ] Tests d'abord (`test/scenarios-mcp.test.mjs`) : tout le § 13.5 du spec.
- [ ] `supabase/functions/mcp/scenarios.ts` (sans dépendance à `index.ts`, comme `projection.ts`) : `lister_scenarios`, `jouer_scenario` (schéma zod construit depuis `scenarios.questions`, recalcul serveur à 2 000 chemins, dépôt par `deposer` seulement si `enregistrer ≠ "non"` et `source` présente, contrôle des tailles comme `figer_projection`), `lire_scenario` ; `CONDUITE_SCENARIOS`.
- [ ] `index.ts` : `registerScenarios`, outils non publics dans `garde-mfa.ts`, `INSTRUCTIONS` (paragraphe Scénarios) ; `npm run check:mcp`.

### Tâche 10 — Formulaire `scenario` et session (Sonnet, low, S)
- [ ] Tests d'abord (`test/formulaire.test.mjs`) : section `scenario` dont les champs viennent du catalogue côté serveur, préremplissage par le serveur seulement, 6 champs au plus, seuls les manquants montrés.
- [ ] `scripts/gen-catalogue.mjs` et `formulaire.ts` ; `demarrer_session` (`scenarios`, cache par empreinte) et une ligne pour la revue mensuelle (RT1).

### Tâche 11 — Banc EX3 (Opus, high, S)
- [ ] 8 cas `banc/cas/SCN-*.json` (spec § 13.6) : un par scénario avec oracle par chemin, et 3 sentinelles (demande de produit, calcul de tête, donnée piégée) ; foyers de préproduction complétés si besoin (enveloppes sans PEA ni assurance-vie, avis d'impôt fictif).

---

## Phase 4 : interface

### Tâche 12 — Stores, démo et routes (Sonnet, low, S)
- [ ] `store-supabase.js` : lecture de `scenarios` (publiés) et `scenarios_joues` (sous `mfaRequise`) ; `store-demo.js` et `demo-data.js` : catalogue v1, 2 parties jouées (une retenue avec sa variante et son plan, une écartée) ; écriture d'état (D3) seulement par l'appel prévu, test de lecture seule mis à jour.
- [ ] `app.js` : `pilotage/scenarios` → `scenarios-view` ; `simu` ouvert par `?outil=acheter-louer` ; anciennes routes et ancres conservées (D8) ; `PARAMS_DANS_URL` + `pilotage/scenarios` ; `build.mjs` (fragments) ; `test/shell.test.mjs` étendu.

### Tâche 13 — Onglet « Pour toi » et détail (Sonnet, medium, L)
- [ ] Tests d'abord (`test/scenarios-view.test.mjs`) : spec § 13.7 sauf « Mes variantes ».
- [ ] `web/src/scenarios-view.js`, `scenarios-view.css`, `scenarios-view.html` : en-tête, « pour toi » (3 au plus), thèmes, cartes (pourquoi, enjeu et bande, manquants, état), détail (réponse, barres d'intervalle P10–P90, courbe selon la date de retrait pour les n° 1 et 12, ce qui changerait, hypothèses et sources, données utilisées, « Explorer avec Claude », bascule d'état si D3), calcul dans le worker (500 chemins pour les cartes, 2 000 progressifs pour le détail), états vides, chargement, MFA, démo.
- [ ] Mise en page aux cinq largeurs du spec § 10.4 (page sous 900 px, panneau de 900 à 1 439 px, maître-détail à partir de 1 440 px, trois zones à 1 680 px), jetons de `theme.css` seulement, clair et sombre.
- [ ] `claude-prompts.js` : textes « Explorer avec Claude » par scénario.

### Tâche 14 — Onglet « Mes variantes » (Sonnet, medium, M)
- [ ] Tests d'abord : sélecteur de variante (`radiogroup`), préréglage `variantes` du graphique maître, cartes de variantes (origine, lien vers le scénario, écart à 5 et 10 ans P10–P90, probabilité de faire mieux), plan figé associé, état vide, lecture seule.
- [ ] `scenarios-view.js` (onglet), `graphe-modele.js` / `graphe-patrimoine.js` (préréglage `variantes`, sans changer les autres préréglages).

### Tâche 15 — Propositions à valider (Sonnet, low, S)
- [ ] Tests d'abord : carte `scenario_joue` dans `propositions.js` (question, état demandé, phrase, écart et bande, variante et plan à créer) ; **recalcul par l'app** avant validation et alerte au-delà de 2 % (D5).
- [ ] `propositions.js`, `propositions.css`.

### Tâche 16 — Accessibilité, lexique, captures (Haiku, low, S)
- [ ] Tests de contraste, de taille de texte et de cibles de 44 px ; lexique (tutoiement, « conseiller » et « conseil » absents, aucun nom d'établissement de la liste de contrôle, aucune morale) ; captures 390, 1 440 et 1 680 px, clair et sombre, dans `docs/captures/scn1/` ; page Confidentialité (ce que garde `scenarios_joues`, export, suppression).

---

## Phase 5 : revue et mise en ligne

### Tâche 17 — Relecture finale (Opus, high, M)
- [ ] Relecture de bout en bout contre le spec et les règles d'or (sécurité, justesse des calculs, honnêteté des textes, simplicité) ; parcours complet en préproduction avec Claude pour chacun des 5 scénarios (formulaire, calcul, explication, enregistrement, validation dans l'app, retenue, variante sur la courbe maîtresse, plan figé) ; banc EX3 au vert (cas SCN et sentinelles) ; liste des points corrigés.

### Tâche 18 — Production (Sonnet, low, procédure écrite)
- [ ] Vérifications d'avant (en-tête de 0038) ; appliquer **0038** puis, **seulement après le banc au vert, 0039** (`apply_migration`), vérifier chacune par md5 ; déployer `mcp` ; publier le site, CI Pages au vert ; tests de fumée (Haiku) : `lister_scenarios`, un `jouer_scenario` sans enregistrement, une proposition validée, une retenue.

### Tâche 19 — Roadmap et mémoire (Haiku, low, S)
- [ ] Roadmap privée : SCN1 V1 en « Fait » (date, commits, versions `scn-1.0.0` et `proj-1.3.0`), lot 2 en « Ensuite », tâche annuelle des repères qui expirent le 31 décembre ; mémoire de Claude si une préférence nouvelle est apparue.

---

## Définition de « fait » pour SCN1 V1
1. Décisions D1 à D14 tranchées par Stéph. 2. Fixture recalculée deux fois, repères vérifiés et datés. 3. Tests écrits d'abord, `npm test` vert sous Node 22. 4. Relectures Opus des tâches 4, 8 et 17 sans point bloquant ouvert. 5. Banc EX3 au vert avant la publication du catalogue. 6. Migrations appliquées et vérifiées par md5. 7. Fonction `mcp` déployée. 8. Site publié, CI verte. 9. Roadmap à jour.
