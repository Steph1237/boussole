# SCN1 : scénarios de décision patrimoniale (V1)

Date : 2026-10-17. Statut : **décisions D1 à D14 tranchées par Stéph le 2026-10-16 : recommandations retenues** (§ 15). Phase 0 faite le 2026-10-15/16 (repères relus, fixture `test/fixtures/scenarios-cas.json`, § 8.3 et § 13.1). Cadrage produit tranché le 2026-10-15 (roadmap privée, annexe J, J.1 à J.4, et ligne SCN1).
Plan : `docs/superpowers/plans/2026-10-17-scn1-scenarios.md`.
Dépend de : PROJ (moteur `web/src/projection*.js`, `proj-1.2.0`), DAT1 (`web/src/calendrier.js`), repères (`reperes`), politiques de 0033 et garde des propositions de 0034 (HIS2), BUD1 (0035 à 0037, dépenses essentielles et capacité réelle, § 12.1).

Toutes les données de ce document sont fictives (foyer « Camille et Sam », comptes « Courant Exemple », montants ronds). Aucune donnée réelle n'entre dans ce dépôt public.

---

## 0. Décisions en bref

1. **La question de la section** : « Et si… ? Les questions que tout le monde se pose, calculées sur ta situation. » Pilotage › Scénarios devient **une seule section** à deux onglets : **« Pour toi »** (le catalogue en cartes) et **« Mes variantes »** (les variantes de projection, dont celles des scénarios retenus). Plus jamais deux choses appelées « scénario ».
2. **Un scénario, toujours le même déroulé** (J.1) : une question simple ; 3 à 6 questions seulement pour ce qui manque, par formulaire ; une comparaison chiffrée sur **les mêmes tirages que le moteur PROJ**, en euros d'aujourd'hui, nette de frais et d'impôts de sortie, avec sa **bande P10–P90** ; la réponse, l'écart en €, la date de bascule et **« ce qui changerait la réponse »** ; la trace (journal, variante figée).
3. **Le catalogue est une donnée partagée et versionnée** : table `scenarios` (comme `expertises`), copie de chaque version dans `scenarios_versions`, publiée seulement après le banc d'évaluation. Elle porte la question, le thème, les conditions de pertinence, les données et questions, les repères et le nom du calcul avec sa version. **Jamais une formule en base.**
4. **Le calcul est du code testé** : module UMD pur `web/src/scenarios.js` (global `Scenarios`), copié dans le connecteur avec le moteur (`supabase/functions/mcp/projection-moteur.gen.js`, `npm run gen`). Il réutilise `Projection.tirages` (même graine, mêmes nombres aléatoires), `ProjectionDonnees.parametresClasse` (mêmes rendements et volatilités), `ProjectionFiscalite` (mêmes impôts de sortie), `Calendrier` (mêmes dates de 5 et 8 ans) et les repères. **Claude ne calcule jamais** : il appelle l'outil.
5. **Deux étages de calcul** : (a) la **comparaison d'enveloppes « à la marge »** (le prochain euro, le prochain versement, le surplus du matelas), rapide, exacte sur les mêmes tirages, qui fait la réponse ; (b) le **scénario retenu** devient une variante du foyer avec une nouvelle hypothèse du moteur, `enveloppe_scenario`, que la courbe maîtresse et le prévu contre réel (CK5) savent rejouer. `proj-1.3.0`, aucun résultat existant ne change (test de non-régression).
6. **Ce que la personne a joué est privé** : table `scenarios_joues` (RLS propriétaire, politique restrictive **« aal2 si facteur » OU `connecteur_autorise()`** aux formes de 0033). **Le connecteur n'y écrit jamais** : `jouer_scenario` calcule puis dépose une **proposition** (cible `scenario_joue`) que la personne valide dans l'app ; un déclencheur refuse toute écriture portant un `client_id`, comme `propositions_garde` et `transactions_historique_garde` de 0034.
7. **Retenir un scénario** = une proposition qui, validée, passe l'état à « retenu », crée la variante figée (`foyer_variantes`, hypothèse `enveloppe_scenario`) et le plan figé (`plans_figes`, raison `scenario`) en une seule transaction, tout ou rien.
8. **Premier lot (V1)** : n° 1 « Faut-il ouvrir un PEA ? », n° 2 « Assurance-vie, PEA ou PER : où mettre le prochain euro ? », n° 3 « Le PER est-il intéressant pour moi ? », n° 6 « Combien garder de côté, et où ? », n° 12 « Ouvrir une assurance-vie maintenant, même sans projet ? ».
9. **Garde-fous** : aucun produit ni établissement nommé ou recommandé (on compare des critères : frais, fiscalité, liquidité, plafonds, garanties) ; jamais le mot « conseiller » ; le scénario n'exécute rien (ouvrir, verser, résilier : c'est toi qui le fais) ; chaque chiffre affiché vient avec ses hypothèses, ses sources, leurs dates et « ce qui changerait la réponse » ; l'incertitude est une bande P10–P90.
10. **Outils MCP** : `lister_scenarios` (pertinence et enjeu pour la personne), `jouer_scenario` (calcul, puis proposition à valider si la personne le veut) et `lire_scenario` (fiche du catalogue et parties jouées).
11. **Données** : migration **0038** (tables, politiques, garde, cible de proposition, validation de l'hypothèse de variante, raison de plan figé, export) et **0039** (repères nouveaux vérifiés, catalogue v1). 0038 repart des définitions de 0035 (BUD1) pour `appliquer_propositions` et `export_all`.

---

## 1. Contexte et existant (vérifié dans le code le 2026-10-17)

| Élément | Où | État |
|---|---|---|
| Moteur de projection | `web/src/projection.js` (`proj-1.2.0`, `GRAINE = 20261014`), `projection-donnees.js`, `projection-fiscalite.js`, `projection-outils.js` ; copie `supabase/functions/mcp/projection-moteur.gen.js` | Monte-Carlo à tirages communs ; croissance mensuelle d'un compartiment `exp(a + s·z) · (1 − f)^(1/12)` avec `a = ln(1 + r)/12`, `s = σ/√12`, `f = TER + frais d'enveloppe` ; flux en fin de mois ; euros constants par `(1 + π)^(t/12)`. `Projection.tirages({ chemins, mois, graine, classes })` rend **les mêmes normales corrélées** que `derouler` (les 12 uniformes de chaque mois sont toujours consommées, même pour une classe non utilisée). `Projection.comparer` compare deux modèles chemin par chemin. |
| Fiscalité de sortie | `ProjectionFiscalite.preparer / fiscaliteSortie` | PEA avant et après 5 ans, assurance-vie avant et après 8 ans (7,5 % sous 150 000 € de primes, abattement 4 600 / 9 200 € imputé d'abord sur la fraction à 7,5 %), PER (TMI × versements déduits + 12,8 % et 18,6 % sur les gains), compte-titres (12,8 % + 18,6 %), livrets exonérés. Repère manquant : règle indisponible, jamais de valeur de secours. |
| Variantes | `foyer_variantes` (0031, 10 au plus), `Evenements.HYPOTHESES_VARIANTE`, validation SQL `foyer_valider_variante` | Hypothèses : `epargne_delta_mensuel`, `reste_capacite`, `reequilibrage`, `part_reaffectee_epargne_pct`, `part_hausse_epargnee_pct`, `salaire_croissance_reelle_pct`, `hypotheses_classes`. **Aucune ne sait créer une enveloppe qui n'existe pas encore** : d'où `enveloppe_scenario` (§ 6.6). |
| Plans figés | `plans_figes` (0031, 60 au plus, raisons `revue_mensuelle`, `objectif`, `manuel`), `Projection.figerPlan`, `Projection.comparerPlanReel` | Base de CK5 (prévu contre réel). |
| Écran des variantes | — | **Il n'existe pas d'écran « variantes » dédié.** Les variantes se choisissent dans les Réglages du graphique maître (`graphe-patrimoine.js`, ensemble « Variante », dessinée en médiane et P25–P75 par-dessus la bande principale) sur Aujourd'hui ; le connecteur a `comparer_variantes`. Pilotage › Scénarios porte aujourd'hui le module `simu` (simulateur acheter ou louer, porté de l'ancien outil) ; Pilotage › Projections est une carte « Bientôt » (réservée à SIM3). « Mes variantes » est donc **à construire** (§ 10.5). |
| Calendrier | `web/src/calendrier.js` (DAT1), `Calendrier.enveloppes`, jalons `pea_5_ans`, `av_8_ans`, `av_70_ans`, `per_70_ans`, `per_plafond_expire`, `per_fin_annee` | Dates d'ouverture dans `config.enveloppes_infos` ; plafonds PER dans `config.avis_impot.plafonds_per` (0029). |
| Repères | `reperes` (0009, 0010, 0029, 0030, 0032) ; `Reperes.aVerifier` (180 jours) | Déjà là et utiles : `pea_plafond`, `pea_duree_ans`, `av_duree_ans`, `av_taux_ir_reduit`, `av_seuil_versements`, `av_abattement_seul`, `av_abattement_couple`, `av_990i_abattement`, `av_age_seuil`, `ir_taux_forfaitaire`, `ps_taux_general`, `ps_taux_av_epargne_logement`, `pfu_taux`, `per_plafond_plancher`, `per_plafond_max`, `per_report_ans`, `per_report_ans_ancien`, `per_age_fin_deduction`, `ir_bareme_*_seuil`, `qf_plafond_demi_part`, `livret_a_taux` (et LDDS), `livret_a_plafond`, `ldds_plafond`, `lep_taux`, `lep_plafond`, `lep_rfr_1_part`, `inflation_hypothese`, `rendement_central_*`, `suivi_horizon_suppose_ans`. |
| Matelas | `config.cushion`, `Calc.matelas`, `Calc.matelasDisponible`, fiche `epargne-de-precaution` (repère pédagogique 3 à 6 mois) | Stabilité des revenus dans le questionnaire de risque (`risque.reponses.revenus` : fonctionnaire, cdi, independant, variables, sans). |
| Propositions | `appliquer_propositions` (dernière version : 0034, redéfinie par 0035 de BUD1), `propositions_garde` (0034) | Un jeton OAuth ne dépose que des propositions en attente, ne les décide jamais ; 500 en attente au plus. |
| Ouverture progressive | — | PROG1 n'est pas codé (aucun `ouverture.js`) : intégration légère, § 12.3. |
| Lexique | `test/conseiller.test.mjs`, `test/tutoiement.test.mjs`, `test/ux4-lexique.test.mjs` | Les textes de SCN1 y passent. |

---

## 2. Objectifs et non-objectifs

### 2.1 Objectifs (V1)
- Répondre, chiffres à l'appui, aux 5 questions du premier lot, pour **cette** personne, avec la même rigueur que la projection : mêmes tirages, euros d'aujourd'hui, frais et impôts de sortie, bande P10–P90.
- Dire **pourquoi** un scénario la concerne, **combien** il pèse (enjeu en €/an), **ce qui manque** pour répondre, et **ce qui changerait** la réponse (seuils chiffrés).
- Faire de Claude le guide du parcours (questions par formulaire, explication, trace) sans qu'il calcule ni écrive lui-même.
- Garder la trace des décisions : un scénario retenu devient une variante comparable sur la courbe maîtresse et un plan figé comparable au réel (CK5).
- Une section claire, mobile d'abord et large écran jusqu'à 1 680 px, aux jetons existants.

### 2.2 Non-objectifs (V1)
- Les scénarios 4, 5, 7 à 11, 13 à 19 (lots 2 à 4 de J.3) ; leur place est prévue dans le catalogue (thèmes, numéros).
- Nommer, classer ou recommander un produit, un contrat, un établissement ou une offre. Les fourchettes de marché ne servent jamais (V1 n'en a pas besoin).
- Exécuter quoi que ce soit : ouverture, versement, transfert, résiliation.
- Le calcul exact de l'impôt sur le revenu du foyer (PAT1) : décote, plafonnement du quotient familial, réductions et crédits d'impôt. La V1 travaille sur la TMI et le dit (§ 7.3).
- La sortie du PER en rente (règles vérifiées, § 8.2, mais non calculées en V1 : D6).
- Les travailleurs non salariés pour le plafond PER (plafond « Madelin » différent) : dit, non calculé.
- L'onglet complet Pilotage › Projections (SIM3).

---

## 3. Règles d'or appliquées

| Règle | Application |
|---|---|
| 1. MCP et IA d'abord, app en lecture seule | Claude pose les questions (formulaire) et appelle `jouer_scenario` ; l'enregistrement passe par une proposition validée dans l'app. L'app calcule les cartes elle-même (calcul, aucune écriture) ; seule écriture directe envisagée : « écarter / remettre à explorer » (D3). |
| 2. Sécurité et confidentialité | `scenarios_joues` en RLS propriétaire, double authentification aux formes de 0033, garde « aucun `client_id` » sur l'écriture, clés composites vers les variantes et plans, tailles bornées, aucune réponse en texte libre, export complet, suppression en cascade. |
| 3. Simple | Une réponse d'abord (une phrase, un écart, une bande), le détail ensuite ; 3 cartes « pour toi » au plus en tête. |
| 4. Simulation comparable | Même moteur, mêmes tirages, mêmes repères, mêmes impôts que Objectifs, Budget et le connecteur ; parité testée entre l'app et la copie générée. |
| 5. Des chiffres pertinents | L'enjeu est un écart médian sur les mêmes chemins, avec sa bande ; pas d'enjeu sans données (« à compléter »), jamais un chiffre inventé. |
| 6. Copilote qui progresse sous contrôle | Catalogue versionné, cas chiffrés à la main (fixture), cas du banc EX3 ; publication si le banc passe. |
| 7. Questions au bon format | Formulaire MCP Apps (section `scenario`) pour les 3 à 6 questions ; préremplissage depuis Boussole, jamais par le LLM. |
| 8. Adapté à chacun | Pertinence et tri par enjeu propres à la personne ; « pourquoi ça te concerne » écrit à partir de ses données. |
| 9. Honnête et dans les règles | Sources et dates de chaque repère ; repère à revérifier signalé ; aucun produit nommé ; jamais « conseiller » ; « une projection n'est pas une promesse ». |
| 10. Gratuit | Calcul dans l'app et dans le connecteur, sans IA côté serveur. |

---

## 4. Le catalogue partagé (`scenarios`)

### 4.1 Contenu d'une entrée

| Champ | Forme | Exemple (n° 1) |
|---|---|---|
| `cle` | `^[a-z0-9_]{3,40}$`, unique | `ouvrir_pea` |
| `numero` | entier du catalogue J.2 (1 à 99) | 1 |
| `theme` | `banque`, `epargne`, `placements`, `immobilier`, `famille`, `retraite` | `placements` |
| `question` | 10 à 120 caractères, au tutoiement | « Faut-il que j'ouvre un PEA, même petit ? » |
| `resume` | 40 à 400 caractères : ce que Boussole calcule | « La valeur de l'antériorité de 5 ans… » |
| `pertinence` | jsonb : règles déclaratives lues par le module (clés connues seulement, § 6.4) | `{ "sans_enveloppe": ["pea"], "capacite_min": 1, "age_min": 18 }` |
| `donnees` | jsonb : `[{ champ, libelle, origine: boussole \| question, obligatoire }]` | `{ champ: "enveloppes", origine: "boussole" }` |
| `questions` | jsonb : `[{ id, type, libelle, aide, prerempli?, options?, min?, max?, obligatoire }]` (§ 9.4) | `versement_mensuel`, `horizon_ans`… |
| `reperes` | `text[]`, contrôlé par `cles_reperes_valides` (0016) | `{pea_duree_ans, pea_plafond, ir_taux_forfaitaire, ps_taux_general, …}` |
| `calcul` | nom de la fonction du module | `ouvrirPea` |
| `version_calcul` | `scn-<maj>.<min>.<cor>` | `scn-1.0.0` |
| `ouverture` | jsonb : déclencheurs pour PROG1 (§ 12.3), lus seulement quand PROG1 existe | `{ "donnees": ["capacite_positive"], "copilote": true }` |
| `garde_fous` | texte (100 à 1 500) : ce que Claude ne dit jamais pour ce scénario | « Ne cite aucun établissement… » |
| `evals` | jsonb : identifiants des cas du banc EX3 et de la fixture | `["SCN-PEA-1", …]` |
| `version`, `statut` (`brouillon`, `publie`, `archive`), `changelog`, `mis_a_jour_le`, `publie_le` | comme `expertises` (0016) | 1, `publie` |

Contrainte `scenarios_contenu_sensible` : `contenu_sensible` (0009) sur tous les textes et sur `jsonb_textes(questions)` ; un mot interdit (dont « conseiller ») est refusé par la base, comme pour les expertises.

### 4.2 Versions et publication
- Déclencheur `scenarios_versionner` (modèle `expertises_versionner` de 0016) : à chaque changement de `version` ou de `statut`, la ligne est copiée dans `scenarios_versions` (`unique (scenario_id, version, statut)`).
- Une version n'est publiée qu'après **les cas chiffrés de la fixture** (`test/fixtures/scenarios-cas.json`) **et le banc EX3** (cas SCN, § 13.6). En pratique : la migration qui publie (0039) n'est appliquée en production qu'après le passage du banc en préproduction (D9).
- Un changement de formule incrémente `version_calcul` ; un changement de texte ou de pertinence incrémente `version`. Un scénario joué garde les deux versions avec son résultat : on sait toujours quel calcul a produit quel chiffre.

### 4.3 Droits
`select` pour `anon` et `authenticated` des lignes `publie` seulement (la démo les lit) ; aucune écriture pour `anon` ni `authenticated` ; `service_role` explicite (0033). `scenarios_versions` : lecture des versions publiées seulement.

---

## 5. Ce que la personne a joué (`scenarios_joues`)

### 5.1 Une ligne par partie jouée

| Colonne | Forme | Remarque |
|---|---|---|
| `id` | uuid | |
| `user_id` | uuid, `auth.uid()` par défaut, `on delete cascade` | |
| `scenario_cle`, `scenario_version`, `version_calcul`, `version_modele` | textes, entiers | `scenario_cle` doit exister au catalogue (publié au moment de l'application) |
| `etat` | `joue`, `retenu`, `ecarte` | « À explorer » n'est **pas** stocké : c'est l'absence de ligne (D2) |
| `reponses` | jsonb ≤ 8 ko, clés des `questions` du scénario seulement, valeurs nombres, booléens, dates ou options | aucun texte libre |
| `resultat` | jsonb ≤ 60 ko : sortie résumée du module (§ 6.7), sans chemins | `octet_length` contrôlé |
| `enjeu_annuel_p50` | numeric | pour trier sans relire le jsonb |
| `graine`, `chemins` | entiers | pour rejouer |
| `variante_id` | uuid null, clé composite `(user_id, variante_id)` → `foyer_variantes(user_id, id)` **on delete set null (variante_id)** | rempli quand l'état est `retenu` |
| `plan_fige_id` | uuid null, clé composite → `plans_figes(user_id, id)`, on delete set null | idem |
| `source` | 1 à 300 caractères, `contenu_sensible` refusé | « Ce que tu as dit à Claude » |
| `joue_le`, `decide_le`, `created_at`, `updated_at` | timestamptz | |

Index unique `(user_id, id)` sur `foyer_variantes` et `plans_figes` (pour les clés composites, comme 0034 l'a fait pour `positions`). Limites (déclencheur, verrou consultatif par utilisateur) : **20 parties par scénario, 200 en tout** ; au-delà, la proposition est refusée avec le message « Limite atteinte… supprime d'anciennes parties ». Une suppression est permise au propriétaire en aal2 (jamais par un connecteur).

### 5.2 États et transitions

```
(aucune ligne) = à explorer ──jouer + valider──► joué ──retenir + valider──► retenu
                                                  │  ▲                         │
                                       écarter    ▼  │ remettre                │ écarter
                                                 écarté ◄──────────────────────┘
```
- **À explorer** : le scénario est pertinent et n'a jamais été joué (ou ses parties ont été supprimées).
- **Joué** : une partie validée existe (la plus récente fait foi).
- **Retenu** : la personne a choisi une option ; la variante figée et le plan figé existent. Un seul `retenu` par scénario à la fois : retenir une nouvelle partie remet l'ancienne à `joue` (sa variante reste, renommée « (ancienne) », D4).
- **Écarté** : « pas pour moi » ; la carte descend en bas de son thème, son enjeu n'est plus compté dans « Pour toi ».
- Repasser de `retenu` à `ecarte` ne supprime ni la variante ni le plan (on garde la trace) ; la personne les supprime si elle veut, depuis « Mes variantes ».

### 5.3 Retenir : la variante figée
La proposition `scenario_joue` d'opération `modifier` avec `apres.etat = "retenu"` porte aussi `apres.variante` (`{ nom, description, hypotheses: { enveloppe_scenario: … } }`, § 6.6) et `apres.plan_fige` (sortie de `Projection.figerPlan` avec la variante provisoire `scenario:<cle>`). La branche SQL, dans une seule transaction :
1. valide la variante par `foyer_valider_variante` (étendue, § 11.1) et la limite de 10 variantes (message clair si elle est atteinte : « Supprime une variante avant de retenir ce scénario ») ;
2. insère la variante, puis le plan figé (raison `scenario`, limite de 60), en remplaçant dans `parametres.options.variante` l'identifiant provisoire par celui de la variante créée ;
3. met la partie à `retenu` avec `variante_id`, `plan_fige_id`, `decide_le` ; remet un éventuel ancien `retenu` du même scénario à `joue`.
Tout ou rien (comme le reste d'`appliquer_propositions`).

---

## 6. Le module de calcul (`web/src/scenarios.js`, global `Scenarios`)

### 6.1 Contrat

```
Scenarios.VERSION_CALCUL                                   // "scn-1.0.0"
Scenarios.CALCULS                                          // { ouvrirPea, prochainEuro, perInteret, matelas, avMaintenant }
Scenarios.pertinence(entree, data, today) → { pertinent, raisons: [texte], manquants: [{ champ, libelle, comment }] }
Scenarios.enjeu(entree, data, today, { chemins: 500 }) → { p10, p50, p90, unite: "€/an d'aujourd'hui", statut: ok|a_completer|indisponible, raison? }
Scenarios.lister(catalogue, data, joues, today) → { pour_toi: [cle ≤ 3], par_theme: { theme: [carte] }, cartes: [carte] }
Scenarios.jouer(entree, data, reponses, today, { chemins: 2000, graine }) → resultat (§ 6.7)
Scenarios.varianteRetenue(entree, resultat, option_id) → { nom, description, hypotheses: { enveloppe_scenario } }
Scenarios.reponsesValides(entree, reponses) → null | [message]
Scenarios.simulerEnveloppes(data, plan, opts) → { options: { id: { net: Float64Array(P), brut, base, impots, frais } }, P, T, graine }   // § 6.2
```
`data` est la forme de `Projection.preparer` (`ProjectionDonnees.depuisEtat(S)` dans l'app, `lireDonneesProjection` dans le connecteur) ; `entree` est la ligne du catalogue (forme de l'app). Pur, sans DOM, au tutoiement. Les textes (phrases, raisons, « ce qui changerait ») sont des gabarits du module, remplis de nombres formatés : aucun texte ne vient du LLM.

### 6.2 Le socle commun : simuler des enveloppes « à la marge »
Un **plan de flux** décrit ce qu'on compare : pour chaque option `o`, une ou plusieurs enveloppes `e` avec type, titulaire, date d'ouverture `O_e`, allocation `w_{e,k}` (somme 1), frais annuels `f_e` (TER + frais d'enveloppe), plafond de versements, et une suite de versements `m_{e,t}` (initial à `t = 1`, mensuels ensuite). Toutes les options reçoivent **le même effort net** de la personne (§ 7.2 pour le PER).

Pour chaque chemin `i` (1..P) et mois `t` (1..T), avec `z_{i,t,k}` = `Projection.tirages({ chemins: P, mois: T, graine })` :
```
g_{i,t,k}   = exp(a_k + s_k · z_{i,t,k})            a_k = ln(1 + r_k)/12, s_k = σ_k/√12   (ProjectionDonnees.parametresClasse, mêmes surcharges)
V_{e,k,t}   = V_{e,k,t−1} · g_{i,t,k} · (1 − f_e)^(1/12) + w_{e,k} · m_{e,t}         (flux en fin de mois, sans rééquilibrage : règle « aucun » du moteur)
B_{e,t}     = B_{e,t−1} + m_{e,t}                                                     (base fiscale = versements)
net_e(D)    = V_e − impots_e(V_e, B_e, D)       impots_e = ProjectionFiscalite.preparer({ type, date_ouverture: O_e, base, … }, ctx).calculer
net_o(i)    = Σ_e net_e(D_T) / (1 + π)^(T/12)   (euros d'aujourd'hui ; π = inflation_hypothese)
```
- Fonds euros : volatilité nulle (règle du moteur) ; livrets : taux réglementé du repère (`livret_a_taux`, `lep_taux`), jusqu'à sa `date_fin` puis le rendement central du monétaire, comme `aSerie` dans `projection.js`.
- Plafond : un versement qui dépasserait le plafond de l'enveloppe (`pea_plafond`, `lep_plafond`, `livret_a_plafond`, `ldds_plafond`, plafond PER disponible pour la déduction) va dans l'enveloppe de **débordement** déclarée par l'option (compte-titres par défaut, le plus imposé : prudent).
- Contexte fiscal (`ctx`) : `couple` (imposition commune, `profil.foyer`), `primes_titulaire` (primes d'assurance-vie déjà versées par le titulaire + celles du plan), `tmi_pct`, abattement de l'année non consommé : 100 % (hypothèse dite : « tu n'as pas d'autre retrait d'assurance-vie cette année-là »).
- **Écart** entre deux options `A` et `B` : `Δ(i) = net_A(i) − net_B(i)`, chemin par chemin (tirages communs) ; on rend `Q10, Q50, Q90` de `Δ`, `P(Δ > 0)` et la **date de bascule** (premier mois où la médiane de `Δ` devient et reste positive). *Phase 0 : la grille des dates de sortie est **mensuelle** (`date(t)`, t = 1..T), pas annuelle : sur une grille annuelle, la bascule d'un PEA ouvert le 15/11/2026 tomberait le 15/10/2032 au lieu du 15/12/2031 (cas PEA-1).*
- **Calendrier des flux** (phase 0) : versement de départ et premier mensuel au mois 1 (fin de mois) ; une enveloppe nouvelle s'ouvre au mois de son premier versement, jamais avant `scn_delai_ouverture_mois` (1 mois, convention) ; la référence reçoit les mêmes flux aux mêmes mois ; le surplus du matelas est placé au mois 0, des deux côtés. Les 5 et 8 ans courent depuis l'ouverture (premier versement), seuil le lendemain de l'anniversaire (règle DAT1).
- **Fonds euros** (phase 0) : une poche fonds euros ne va qu'en assurance-vie ; dans les options PEA et compte-titres, elle reste en assurance-vie (« PEA + AV », « CTO + AV ») ; ses frais sont ceux de gestion du contrat, sans TER.
- **Enjeu annuel** : `Q50(Δ_meilleure, référence) / H` (H en années), avec `Q10/H` et `Q90/H` ; la référence est ce que la personne fait aujourd'hui (§ 7 pour chaque scénario). Cartes : 500 chemins ; partie jouée : 2 000 (comme `projeter`).
- **Mode déterministe** (`volatilite: 0`, comme le moteur) : sert aux cas chiffrés à la main (§ 13.1).
- Temps visé : `lister` pour 5 scénarios < 1,5 s dans l'app (fil du worker) et < 3 s dans le connecteur ; `jouer` < 2 s.

### 6.3 Pourquoi ne pas tout faire avec le moteur complet
Le moteur complet déroule tout le foyer (cascade d'affectation, objectifs, retraits) : une différence d'enveloppe y est noyée dans le reste et dépend de choix qui ne sont pas la question (« le reste va au disponible »). La question d'un scénario est **marginale** (« ce prochain euro, où ? ») : le socle compare ce flux seul, sur les mêmes tirages et avec les mêmes règles. Le moteur complet sert ensuite à **voir l'effet sur tout le patrimoine** (variante retenue, courbe maîtresse). Un test vérifie la cohérence des deux : sur un foyer sans cascade active (un compte courant, pas d'objectif, `reste_capacite: "disponible"`), l'écart médian du socle et celui de `Projection.comparer` entre la situation et la variante retenue diffèrent de moins de 1 % (§ 13.2).

### 6.4 Pertinence (`Scenarios.pertinence`)
Règles déclaratives du catalogue (clés connues ; une clé inconnue fait échouer le test du catalogue) :

| Clé | Sens | Données lues |
|---|---|---|
| `sans_enveloppe: [type]` | la personne (ou une personne du foyer) n'a pas ce type d'enveloppe | `Calendrier.enveloppes`, `config.enveloppes_infos` |
| `avec_enveloppe: [type]` | elle en a une | idem |
| `capacite_min: €` | capacité d'épargne retenue ≥ seuil (mensuelle) | `ProjectionDonnees.capaciteDeBase` (BUD1 : cible en vigueur, § 12.1) |
| `tmi_min: %` | TMI connue ≥ seuil (inconnue : pertinent, manquant « tranche d'imposition ») | `config.projection.tmi_pct`, `profil.foyer.tmi` |
| `age_min`, `age_max` | âge de la personne | `profil` (date de naissance) |
| `matelas_ecart_pct: x` | matelas actuel hors de [cible × (1 − x %), cible × (1 + x %)] (x en %, repère `scn_matelas_ecart_pct`) | § 7.4 |
| `toujours: true` | toujours pertinent | — |
| `un_de: [règles]` | au moins une des règles (OU) ; les clés d'un même objet restent en ET | — |
| `surplus_matelas: true` | matelas actuel > cible (§ 7.4) | § 7.4 |
| `revenus_activite: true` | au moins une personne du foyer a un revenu d'activité (`profil.personnes.*.salaire` > 0, ou réponse `revenus` du risque autre que `sans`) | `profil`, `risque` |
| `age_sous_repere: cle` | âge de la personne < valeur du repère (`per_age_fin_deduction`, `av_age_seuil`) : jamais une valeur recopiée | `profil`, repères |
| `pour_toi_si: { règles }` | la carte n'entre dans « Pour toi » que si ces règles sont vraies (elle reste dans son thème sinon) | — |
| `lep_possible_non_detenu: true` | LEP possible (revenu fiscal de référence, § 7.4) pour une personne qui n'en a pas | `config.avis_impot`, enveloppes |

Phase 0 : les six dernières clés sont ajoutées pour écrire les règles des § 7.1 à 7.5 (« capacité ou surplus », « revenus d'activité », « âge < repère », « en tête si… ») ; leurs cas sont dans la fixture (`PEA-PERT-*`, `PER-PERT`, `AV-PERT-*`, `MAT-3`, `MAT-5`).

`raisons` est la phrase « pourquoi ça te concerne », faite des faits qui ont déclenché la règle (« Tu n'as pas de PEA », « TMI 30 % », « 4 200 € de plafond PER non utilisé en 2025 »), jamais d'un jugement.

### 6.5 « Ce qui changerait la réponse »
Pour chaque scénario, le module cherche, **sur les mêmes tirages**, la valeur d'une hypothèse qui ferait changer l'option en tête (dichotomie, 12 itérations au plus, précision indiquée) :
- horizon (date de sortie) : la date de bascule ;
- TMI à la retraite (PER) : le seuil `t*` où la médiane de l'écart s'annule ;
- frais annuels d'une enveloppe : les **frais de seuil** au-delà desquels elle passe derrière ;
- besoin de l'argent avant une date (liquidité) : option exclue ou pénalisée ;
- taux d'un livret ; plafond disponible.
Chaque ligne : `{ hypothese, valeur_retenue, seuil, effet, phrase }`, par exemple « Si tu as besoin de cet argent avant le 16 novembre 2031, le PEA ne t'apporte rien : avant 5 ans, un retrait le clôture et le gain est imposé comme sur un compte-titres. »

### 6.6 L'hypothèse de variante `enveloppe_scenario` (PROJ `proj-1.3.0`)
Ajoutée à `HYPOTHESES_VARIANTE`, validée en JS (`Evenements.validerVariante`) et en SQL (`foyer_valider_variante`, parité testée) :
```
enveloppe_scenario: {
  scenario: "ouvrir_pea", version_calcul: "scn-1.0.0",
  type: "pea" | "assurance_vie" | "per" | "compte_titres" | "livret_a" | "ldds" | "lep",
  titulaire: "p1" | "p2", ouverture: "AAAA-MM-JJ",
  allocation: { <classe>: % } (somme 100, classes de Marche.CLES hors levier),
  ter_pct: 0..3, frais_enveloppe_pct: 0..3,
  initial: { montant: 0..1 000 000, depuis: "disponible" },          // pris au mois 1 sur le disponible au-dessus du matelas (niveau 1 de l'ordre de retrait)
  mensuel: { montant: 0..100 000, depuis: "capacite" | "en_plus" },  // « capacite » : prélevé comme un versement programmé (étape 1 de la cascade)
  debut: "AAAA-MM-JJ"?, plafond_versements: €?, debordement: "compte_titres" | "disponible",
  per: { deduit: bool, tmi_retraite_pct: 0|11|30|41|45, economie: "reinvestie" | "depensee" }?,
  transferts: [{ de: "livret_a" | "ldds" | "courant", montant }]?    // scénario 6 : déplacer le surplus du matelas
}
```
- Le moteur crée des compartiments synthétiques (`synthetique: true`, un par classe) de valeur 0, ouverts à `ouverture`, avec `F.preparer` à la date d'ouverture donnée (dates de 5 et 8 ans calculées comme DAT1).
- PER : l'économie d'impôt `versements déduits × TMI actuelle` est ajoutée à la capacité de **septembre de l'année suivante** (régularisation de l'impôt), quand `economie = "reinvestie"` ; sortie en capital avec `tmi_retraite_pct` (au lieu de la TMI du foyer) pour ce compartiment.
- Une seule `enveloppe_scenario` par variante en V1.
- **Non-régression** : sans cette hypothèse, toutes les sorties de `proj-1.2.0` sont identiques (fixtures `projection-cas.json`, `projection-mc`, démo) ; seul `version_modele` change.
- *Tâche 7 (codée) : ordre exact dans la cascade d'un mois `t`, après la croissance des compartiments (flux en fin de mois) et avant la décision « reste de la capacité »* :
  1. **versements programmés** de la personne (inchangés) ;
  2. **enveloppe du scénario**, au mois d'ouverture `tInit = max(1, mois(ouverture))` : le **versement de départ** est retiré du disponible au-dessus du matelas par le niveau 1 de l'ordre de retrait (`retirer(…, { niveau_max: 1 })` : compte courant d'abord, puis livrets ; limité à ce qui est disponible, sans jamais descendre sous le matelas indexé) puis déposé ; les **transferts** (`livret_a`, `ldds`, `courant`) retirent leur montant (dans la limite du solde) et le déposent ;
  3. **versement mensuel**, à partir de `tDeb = max(tInit, mois(debut ou ouverture))` : déposé comme un versement programmé et retranché du reste de la capacité (`depuis: "capacite"`), ou déposé en plus sans réduire la capacité (`"en_plus"`) ;
  4. le reste de la capacité suit la cascade existante (matelas, objectifs, allocation cible ou disponible).
  Le **plafond** (`plafond_versements`, hors PER) compte les versements cumulés de l'enveloppe par chemin ; ce qui le dépasse va au **débordement** (`compte_titres` : compartiments synthétiques de compte-titres de même allocation ; `disponible` : compte courant). Pour un **PER**, `plafond_versements` est le plafond annuel de **déduction** (les dépôts ne sont pas limités) : les versements déduits de l'année civile `Y` sont `min(dépôts de Y, plafond)` ; l'**économie** `déduits × TMI du foyer` est ajoutée à la capacité de **septembre de `Y + 1`** (marche d'un mois, composant de capacité « économie d'impôt du PER ») si `economie = "reinvestie"`, rien si `"depensee"` ; la sortie en capital utilise `tmi_retraite_pct` pour ce compartiment (versements déduits proportionnels à la base versée). Le versement de départ est supposé complet pour calculer les déductions.
  Les compartiments synthétiques (`scenario: true`) sont de valeur 0 à l'ouverture, un par classe, **hors de l'allocation cible, du rééquilibrage et de l'« existant »** ; leurs dates de 5 et 8 ans courent depuis `ouverture` (règle DAT1). Un repère fiscal manquant donne un avertissement, jamais un impôt nul en silence.
  **Validation** : `Evenements.validerEnveloppeScenario` (messages entre accents graves dans `projection-evenements.js`, à reprendre à l'identique dans `foyer_valider_variante` de 0038) ; **non-régression** : empreintes de `test/fixtures/proj-nonreg-1.2.0.json` (64 sorties relevées avant la modification) identiques. *Limite V1 dite* : une variante ne porte qu'**une** enveloppe ; les options qui répartissent entre plusieurs enveloppes (« PEA + assurance-vie », « compte-titres + assurance-vie ») ne se retiennent pas (message à l'écran).

### 6.7 Sortie de `Scenarios.jouer`
```
{ cle, version, version_calcul, version_modele, graine, chemins, date, statut: "ok" | "a_completer" | "indisponible",
  manquants: [{ champ, libelle, comment, question_id? }],
  reponse: { phrase, option_en_tete, reference, ecart: { p10, p50, p90 }, ecart_annuel: { p10, p50, p90 }, probabilite_mieux, date_bascule },
  options: [{ id, libelle, enveloppes: [type], net: { p10, p50, p90 }, verse, impots_p50, frais_p50, disponible: bool, contraintes: [texte], exclue?: raison }],
  courbe?: { abscisse: "date_sortie", points: [{ date, p10, p50, p90 }] },        // n° 1 et n° 12 : gain selon la date de retrait
  ce_qui_changerait: [{ hypothese, valeur_retenue, seuil, effet, phrase }],
  hypotheses: [{ cle, libelle, valeur, unite, statut: "verifie" | "convention" | "donnee" | "reponse" | "a_reverifier", source: { titre, url, verifie_le }, date_effet, date_fin }],
  donnees_utilisees: [{ champ, libelle, valeur, origine, le }],
  avertissements: [texte], enjeu_annuel: { p10, p50, p90 },
  rappel: "Une projection n'est pas une promesse. Boussole n'exécute rien : c'est toi qui décides et qui fais." }
```
Montants arrondis à la dizaine d'euros pour l'affichage (le résultat stocké garde l'euro). Un repère dont `date_fin` est passée ou que `Reperes.aVerifier` signale passe en `a_reverifier` et ajoute un avertissement ; un repère **absent** rend le scénario `indisponible` (jamais de valeur de secours).

---

## 7. Les cinq scénarios du premier lot

Notations : `m` versement mensuel (effort net de la personne), `V0` versement initial, `T` mois jusqu'à la sortie, `H = T/12`, `π` inflation, `r_k, σ_k` hypothèses de classe, `f` frais annuels. « Référence » = ce que fait la personne aujourd'hui. Cas chiffrés : mode déterministe (σ = 0), actions `r = 6 %` (`rendement_central_actions`), `π = 2 %`, frais fictifs dits dans le cas ; ils sont **recalculés indépendamment en phase 0** (tâche 0 du plan) avant d'entrer dans la fixture.

### 7.1 N° 1 : « Faut-il ouvrir un PEA, même petit ? » (`ouvrir_pea`, thème Placements)
- **Pertinence** : pas de PEA pour la personne ; capacité ≥ 1 €/mois ou surplus de matelas ; 18 ans ou plus. Raison type : « Tu n'as pas de PEA et environ 300 €/mois partent vers des actions. »
- **Questions** (préremplies) : versement initial `V0` ; versement mensuel en actions `m` (prérempli : capacité × part actions de `config.targets`) ; début des versements (`maintenant` ou date `P`) ; horizon ou objectif visé (prérempli : objectif le plus proche dont les poches sont en actions, sinon `suivi_horizon_suppose_ans`) ; droits de garde du PEA (si la personne les connaît) ; où vont ces versements aujourd'hui (compte-titres, assurance-vie en unités de compte).
- **Options** : **A** PEA ouvert à `O = aujourd'hui + 1 mois` (délai d'ouverture supposé, dit), flux dans le PEA jusqu'à `pea_plafond`, débordement en compte-titres ; **R** (référence) même flux dans l'enveloppe actuelle (compte-titres par défaut). **Prendre date** : **A′** PEA ouvert maintenant avec un petit versement `v_min` (aucun minimum légal, § 8.2) et flux à partir de `P` ; **C** PEA ouvert seulement à `P`.
- **Formules** : socle § 6.2. PEA : `impots = G × ps_taux_general` si `D ≥ O + pea_duree_ans` (jalon DAT1 `pea_5_ans`), sinon `G × (ir_taux_forfaitaire + ps_taux_general)` **et clôture** ; compte-titres : `G × (ir_taux_forfaitaire + ps_taux_general)`. D'où, à frais égaux et après 5 ans : `Δ = ir_taux_forfaitaire × G / (1 + π)^H`. Valeur de l'antériorité : `Δ_date(W) = net_{A′}(W) − net_C(W)`, non nulle seulement pour une sortie `W ∈ [O + 5 ans, P + 5 ans)`. *Phase 0 : l'antériorité se calcule sur les flux communs aux deux options (versements de `P` à `W`, qui continuent jusqu'au retrait) ; `v_min` est rendu à part (brut, net, frais payés), ce qui garde l'écart exactement fonction croissante du gain (invariant Monte-Carlo de la fixture).*
- **Sorties** : écart A − R (bande), date de bascule (`O + 5 ans` à frais égaux, plus tard si les frais du PEA sont plus élevés), **frais de seuil** du PEA, courbe « gain selon la date de retrait » (A′ − C), plafond utilisé.
- **Ce qui changerait** : besoin de l'argent avant `O + 5 ans` ; frais du PEA au-delà des frais de seuil ; versements qui dépassent 150 000 € ; détention de titres non éligibles (dit, non calculé : « le PEA n'accepte que certains titres ; la liste des titres éligibles est fixée par la loi »).
- **Limites dites** : dividendes réinvestis des deux côtés (le moteur ignore l'impôt annuel des dividendes sur un compte-titres : **défavorable au PEA**, donc prudent) ; règles des gains d'avant 2018 ignorées.
- **Cas de référence** (déterministe, TER 0,2 % des deux côtés, garde 0) :
  - **PEA-1** : `m = 300`, `V0 = 0`, sortie à 8 ans (96 mois). `V_T = 36 289,41`, `B = 28 800`, `G = 7 489,41` ; net compte-titres `33 937,74`, net PEA `34 896,38` ; **écart 958,64 € courants = 818,19 € d'aujourd'hui, ≈ 102 €/an** (102,27). *Recalculé en phase 0 : identique au centime. Bascule le 15/12/2031 (plan ouvert le 15/11/2026, 5 ans révolus le 16/11/2031) ; frais de seuil : 0,774 %/an en plus du TER.*
  - **PEA-2** : même flux, sortie à 4 ans : `G = 1 711,39`, **écart 0** (avant 5 ans, même impôt, et le retrait clôture le plan).
  - **PEA-3** (prendre date) : ouvert maintenant avec 10 €, 300 €/mois à partir de 2 ans, sortie à 6 ans (48 mois de versements) : `G = 1 711,39` ; ouvert à 2 ans, le plan n'a que 4 ans à la sortie. **Gain de l'antériorité 219,06 € courants = 194,52 € d'aujourd'hui** ; les 10 € deviennent ~~14,02 €~~ **13,95 €** (phase 0 : versés au mois 1, délai d'ouverture d'un mois, et non au mois 0). Fenêtre où l'antériorité compte : sortie du 15/12/2031 au 15/11/2033.
  - Phase 0 : la fixture ajoute PEA-4 (frais du PEA plus élevés : bascule inchangée, frais de seuil 0,749 % à 10 ans), PEA-5a/5b/5c (plan de 4 ans 11 mois, 5 ans pile, 5 ans 1 mois), PEA-6 (plafond de 150 000 € atteint au mois 5, débordement en compte-titres), les cas de pertinence, manquant, repère absent, repère expiré et un Monte-Carlo (MC-PEA).

### 7.2 N° 2 : « Assurance-vie, PEA ou PER : où mettre le prochain euro ? » (`prochain_euro`, thème Placements)
- **Pertinence** : capacité ≥ 1 €/mois ou surplus de matelas.
- **Questions** : montant mensuel `m` et initial `V0` ; pour quel objectif ou quel horizon (prérempli depuis `objectifs`) ; besoin de pouvoir retirer avant l'horizon (oui, non) ; TMI actuelle (préremplie) ; TMI attendue à la retraite (0, 11, 30, 41, 45 %, « je ne sais pas ») ; date de départ à la retraite envisagée (si le PER est en jeu) ; la transmission compte-t-elle pour toi (oui, non).
- **Options** (même allocation `w` pour toutes : allocation cible du profil, ou réponse) :
  - **AV** : tout en assurance-vie (unités de compte + fonds euros selon `w`), frais `gestion_uc_pct` / `gestion_euro_pct` du contrat existant, sinon question ;
  - **PEA+AV** : la part actions dans un PEA, le reste en assurance-vie (le PEA ne reçoit pas d'obligations ni de fonds euros) ;
  - *phase 0 : une allocation avec fonds euros donne aussi « CTO + AV » (actions en compte-titres, fonds euros en assurance-vie) à la place de « CTO », qui devient la référence (cas EUR-3) ;*
  - **PER** : versement brut `v = m / (1 − TMI)` (même **effort net** : l'économie d'impôt compense la différence), plafonné par le plafond de déduction disponible (§ 7.3), le reste non déduit ; sortie en capital à la retraite : `TMI_retraite × versements déduits + (ir_taux_forfaitaire + ps_taux_general) × G` ;
  - **CTO** : compte-titres, référence fiscale la plus simple.
- **Exclusions** (option affichée grisée, avec la raison, jamais cachée) : PER si l'horizon est avant la retraite et que l'objectif n'est pas l'achat de la résidence principale, ou si la personne a besoin de retirer avant ; PEA si l'horizon est à moins de 5 ans (« rien à gagner, et un retrait clôture le plan »).
- **Arbre de décision** (affiché comme résultat, pas comme règle) : liquidité → horizon (< 5, 5 à 8, ≥ 8 ans) → TMI aujourd'hui contre à la retraite → transmission (ligne qualitative : abattement `av_990i_abattement` par bénéficiaire pour les primes versées avant `av_age_seuil`, sans calcul en V1). Chaque nœud cite la donnée qui l'a décidé.
- **Sorties** : classement par net P50 avec bandes ; probabilité que l'option en tête fasse mieux que la deuxième ; « ce qui changerait » : seuil de TMI à la retraite, horizon de bascule PEA contre AV, frais de seuil.
- **Hypothèse de trésorerie dite** : le PER suppose d'avancer chaque mois `v − m`, rendu l'année suivante par l'impôt ; ce décalage n'est pas compté (léger avantage au PER, dit).
- **Cas de référence** (phase 0, déterministe ; frais fictifs du cas : UC 0,6 % + TER 0,2 %, fonds euros 0,6 %, PEA et compte-titres TER 0,2 %, PER 0,7 % + TER 0,2 %) : **EUR-1** 300 €/mois, 10 ans, 100 % actions, retrait possible avant : PEA en tête (45 942,81 contre AV 44 724,53 et compte-titres 44 379,32), 128,26 €/an, frais de seuil de l'AV 0,172 % ; **EUR-2** 4 ans : PEA écarté, le compte-titres (référence) passe devant l'AV avant 8 ans, enjeu 0 ; **EUR-3** 60 % actions / 40 % fonds euros sur 12 ans : « PEA + AV » en tête, 92,65 €/an ; **EUR-4** 20 ans jusqu'à la retraite, TMI 30 % → 11 % : PER en tête (140 895,32), 913,67 €/an ; **EUR-5** même cas, plafond épuisé et TMI 30 % à la retraite : le PER passe dernier (106 546,73). Plus manquant (date de retraite, D7), repère absent, repère expiré et Monte-Carlo (MC-EUR).

### 7.3 N° 3 : « Le PER est-il intéressant pour moi ? » (`per_interet`, thème Retraite)
- **Pertinence** : revenus d'activité ; âge < `per_age_fin_deduction` ; TMI ≥ 11 % ou inconnue. Raison type : « TMI 30 % et 4 200 € de plafond non utilisé. »
- **Questions** : versement envisagé (annuel ou mensuel) ; TMI actuelle ; TMI attendue à la retraite ; date de départ envisagée (aucune valeur par défaut : l'âge légal n'est pas supposé, D7) ; projet d'achat de la résidence principale avant la retraite (oui, non, date) ; salarié ou indépendant (indépendant : plafond non calculé en V1, dit).
- **Plafond disponible** : d'abord `config.avis_impot.plafonds_per[personne]` (lignes de l'avis, reports compris, `per_report_ans` et `per_report_ans_ancien`), dans l'ordre d'imputation vérifié en phase 0 (§ 8.3 : plafond de l'année d'abord, puis reportés du plus ancien au plus récent, cas PER-4) ; sans avis : ~~estimation `max(per_plafond_plancher, min(per_plafond_taux_revenus × revenus d'activité nets de frais de l'an dernier, per_plafond_max))`~~ **`per_plafond_plancher`** (phase 0 : aucune donnée de Boussole ne porte les revenus d'activité *nets de frais professionnels* ; le plancher est le minimum garanti à un salarié, donc prudent ; la formule à 10 % reste citée dans le texte, avec `per_plafond_taux_revenus`), dite « estimation : ton plafond exact est sur ton avis d'impôt », et la question de l'avis en premier manquant. Pour les années suivantes : plafond de l'année en cours de l'avis (ou le plancher), constant en euros courants, par bloc de 12 mois depuis le premier versement (simplification dite) ; pas de mutualisation entre conjoints en V1 (dite).
- **Économie d'impôt** : `E = min(versement annuel, plafond disponible) × TMI`. Si le revenu net imposable et le nombre de parts sont connus, le module vérifie le **changement de tranche** : `E = Σ_tranches (part du versement dans la tranche) × taux` avec `ir_bareme_*_seuil × parts` ; décote et plafonnement du quotient familial non calculés (avertissement : « près du bas d'une tranche, l'économie peut être plus faible »).
- **Comparaison** : PER contre assurance-vie à **effort net égal** sur l'horizon de la retraite (socle § 6.2, options de § 7.2), en tableau pour `TMI_retraite ∈ {0, 11, 30, 41} %`, la valeur répondue en surbrillance. Seuil `t*` : TMI à la retraite au-delà de laquelle l'assurance-vie fait mieux.
- **Déblocage pour la résidence principale** : si l'objectif d'achat existe, une ligne « tu pourrais le débloquer pour l'achat, imposé comme une sortie en capital » (règle vérifiée, § 8.2) ; le calcul de l'option à cette date est fait (sortie en capital à la date d'achat).
- **Cas de référence** (déterministe, 20 ans, `m = 200 €/mois` d'effort net, frais PER 0,7 % + TER 0,2 %, AV 0,6 % + 0,2 %, couple soumis à imposition commune, abattement 9 200 €) :
  - **PER-1** : TMI actuelle 30 % → `v = 285,71 €/mois`, `V_T = 116 533,01`, `B = 68 571,43`, `G = 47 961,58` ; net PER (courants) : TMI retraite 0 % `101 473,07`, 11 % `93 930,22`, 30 % `80 901,64`, 41 % `73 358,79` ; assurance-vie `V_T = 82 532,18`, `G = 34 532,18`, impôt `1 899,91`, prélèvements `5 939,54`, net `74 692,73` (`50 266,07` € d'aujourd'hui). **Seuil `t*` ≈ 39,05 %** : le PER reste devant tant que la TMI à la retraite est sous ce taux.
  - **PER-2** : TMI 11 % aujourd'hui et à la retraite → `v = 224,72 €/mois`, net PER `73 877,70` contre AV `74 692,73` : **l'assurance-vie fait un peu mieux** (seuil `t*` ≈ 9,49 %). C'est ce cas qui fonde la phrase « à 11 %, souvent non », jamais écrite comme une règle.
  - *Phase 0 : PER-1 et PER-2 recalculés, identiques au centime (t* = 39,05 % et 9,49 % ; à 30 % à la retraite, PER-1 rapporte 4 178,42 € d'aujourd'hui de plus, 208,92 €/an ; en Monte-Carlo, t* = 38,99 %). La fixture ajoute PER-3 (plafond de 4 710 €/an atteint : 617,75 €/mois versés, t* 35,78 %), PER-4 (ordre d'imputation), PER-5 (plafond épuisé : le PER perd à toute TMI), PER-6 (TMI 0 % : non pertinent, aucun seuil), PER-7 (changement de tranche : 979,98 € au lieu de 1 200 €), la pertinence, le manquant, le repère absent et expiré.*

### 7.4 N° 6 : « Combien garder de côté, et où ? » (`matelas`, thème Épargne)
- **Pertinence** : toujours ; en tête si le matelas sort de ±25 % de la cible (`matelas_ecart_pct: 0.25`, convention) ou si un LEP est possible et non détenu.
- **Dépenses de référence `D`** : avec BUD1, la médiane sur 12 mois du bloc **Essentiels** (`Budget.reference`, § 12.1) ; sans BUD1 : dépenses du budget prévu hors épargne ; sinon `config.cushion.depenses`. La source est dite.
- **Nombre de mois `k`** (convention de Boussole, § 8.4 ; affichée comme fourchette) : 3 si deux revenus stables (fonctionnaire ou CDI) ; 6 si un seul revenu, des enfants à charge, ou des revenus variables (CDD, intérim, commissions) ; 9 si indépendant, chef d'entreprise ou sans revenu d'activité ; la personne peut choisir dans la fourchette 3 à 12 (question).
- **Cible** `M* = k × D + dépenses connues des 12 prochains mois` (question : « une grosse dépense prévue dans l'année ? » ; événements de vie datés dans les 12 mois, par exemple une naissance, ajoutés à titre d'information).
- **Matelas actuel** : `Calc.matelasDisponible` (livrets et courant, hors réserve de fonctionnement `reserve_mois`).
- **Ordre de remplissage** (par titulaire) : **LEP** si éligible (revenu fiscal de référence de l'avis `≤ lep_rfr_1_part + n_demi × lep_rfr_demi_part_sup + n_quart × lep_rfr_quart_part_sup`, § 8.2), jusqu'à `lep_plafond` ; puis **Livret A** jusqu'à `livret_a_plafond` ; puis **LDDS** jusqu'à `ldds_plafond`. Gain annuel de l'ordre : `Σ montants déplacés × (taux visé − taux actuel)` (`lep_taux`, `livret_a_taux`).
- **Surplus** `S = actuel − M*` (si > 0) : coût de garder le surplus, sur un horizon `H` (5 ans par défaut, question) : socle § 6.2, `S` placé selon l'allocation cible dans l'enveloppe choisie (compte-titres par défaut : le plus imposé, prudent) contre `S` sur le livret ; enjeu = `Q50(Δ)/H` avec la bande (la bande peut être négative : on le dit, « 1 chance sur 10 de perdre plus de … »).
- **Manque** `M* − actuel` (si > 0) : mois pour le combler au rythme de la capacité ; aucun chiffre de rendement.
- **Cas de référence** **MAT-1** : `D = 2 000`, deux CDI → `k = 3`, `M* = 6 000` ; matelas 16 000 → surplus 10 000 ; couple éligible au LEP (2 parts, revenu fiscal de référence 33 000 € ≤ 35 326 €) : 6 000 € du Livret A vers un LEP → **+48 €/an** ; surplus de 10 000 € sur 5 ans (actions 6 %, TER 0,2 %, compte-titres) : net `12 228,79` contre livret ~~`10 879,40`~~ **`10 778,14`** → **écart ≈ ~~244~~ 263 € d'aujourd'hui par an** (262,78) en déterministe (la bande Monte-Carlo dit le risque : de −365 à +1 199 €/an, 7 chances sur 10 de faire mieux). *Phase 0 : le spec gardait 1,7 % cinq ans ; la règle du moteur (§ 6.2) applique le taux du repère tant que la date du mois est au plus sa `date_fin` (31/01/2027, mois 1 à 3) puis le rendement central du monétaire (1,5 %). Enjeu total de la carte : 48 + 262,78 = 310,78 €/an. Ordre de remplissage = répartition de la cible (LEP de p1 puis de p2, puis Livret A, puis LDDS), gain d'ordre compté sur l'argent déjà détenu qui change de livret, aux taux d'aujourd'hui ; repère public montré à côté : 3 mois de revenus = 15 000 €. La fixture ajoute matelas nul, surplus nul et LEP non éligible, LEP au seuil (35 326 / 35 327 €, parts non entières), indépendant (9 mois), repli sans BUD1 (budget prévu), aucun budget (manquant), bouchon de `Budget.reference`, deux LEP, repère absent et expiré, Monte-Carlo (MC-MAT).*

### 7.5 N° 12 : « Ouvrir une assurance-vie maintenant, même sans projet ? » (`av_maintenant`, thème Épargne)
- **Pertinence** : pas d'assurance-vie pour la personne ; âge < `av_age_seuil` (au-delà, d'autres règles de transmission : dit).
- **Questions** : premier versement que tu trouverais confortable `v_min` ; si un jour tu y verses : combien par mois et à partir de quand `P` ; date de retrait envisagée `W` (ou « je ne sais pas » : grille de 8 à 20 ans) ; part en fonds euros (0 à 100 %) ; frais du contrat (si connus).
- **Options** : **A** ouverte maintenant avec `v_min`, versements à partir de `P` ; **B** ouverte à `P`. Sortie totale à `W`.
- **Formules** : la durée de 8 ans court depuis l'ouverture du contrat (`av_duree_ans` ; **confirmé en phase 0** pour les primes versées plus tard : BOFiP BOI-RPPM-RCM-30-10-20-20 § 120, « durée effective », du premier versement au rachat, « quelles que soient les modalités de paiement des primes », contrats depuis 1990). Pour `W ≥ O_A + 8 ans` et `W < O_B + 8 ans` : `impots_A = (G_7,5 − a_7,5) × av_taux_ir_reduit + (G_12,8 − a_12,8) × ir_taux_forfaitaire + G × ps_taux_av_epargne_logement` (abattement `av_abattement_seul` ou `av_abattement_couple`) ; `impots_B = G × (ir_taux_forfaitaire + ps_taux_av_epargne_logement)`. Valeur de l'antériorité = `Q50(net_A − net_B)` ; courbe selon `W` ; coût = frais sur `v_min`.
- **Aussi montré** : fonds euros contre unités de compte selon l'horizon (bandes P10–P90 pour 100 % fonds euros, 50/50, 100 % actions, mêmes tirages) ; le **transfert** d'un ancien contrat chez le même assureur sans perdre l'antériorité (texte vérifié en phase 0 : CGI art. 125-0 A, I, 2°, transformation par avenant ou nouveau contrat auprès de la même entreprise d'assurance, sans les conséquences fiscales d'un dénouement ; rien n'est dit d'un autre assureur) ; la **clause bénéficiaire** (texte et repères `av_990i_abattement`, `av_age_seuil` ; « pour un cas particulier, un notaire »).
- **Cas de référence** **AV-1** (déterministe, UC actions 6 %, frais 0,6 % + TER 0,2 %, personne seule) : ouverte maintenant avec 100 €, 200 €/mois de l'année 3 à l'année 9 (72 mois), retrait total à 9 ans. `V = 16 770,60`, `B = 14 400`, `G = 2 370,60`. A (contrat de 9 ans) : `G < 4 600` → impôt sur le revenu 0, prélèvements `407,74` ; B (contrat de 6 ans) : impôt `303,44` + mêmes prélèvements. **Valeur de l'antériorité 303,44 € courants = 253,90 € d'aujourd'hui** (28,21 €/an : sous le seuil de « Pour toi ») ; les 100 € deviennent ~~157,17 €~~ **156,51 €** (phase 0 : versés au mois 1, délai d'ouverture d'un mois ; 11,62 € de frais sur 9 ans). *La fixture ajoute retrait à 7 ans (aucun écart), couple (863,87 € d'aujourd'hui), retrait quand B a 8 ans pile (encore avant) et 8 ans 1 mois (plus d'écart : fenêtre du 16/11/2034 au 15/11/2037), 50 % fonds euros, pertinence, manquant, repère absent et expiré, Monte-Carlo (MC-AV).*

---

## 8. Repères et sources

### 8.1 Repères existants utilisés (aucun changement de valeur)
Voir § 1 ; tous ont une source primaire (service-public, BOFiP, Légifrance, ministère) ou sont des conventions de Boussole dites comme telles. **À surveiller** : `per_plafond_plancher`, `per_plafond_max`, `qf_plafond_demi_part`, `ir_bareme_*_seuil`, `lep_rfr_1_part` ont une `date_fin` au **2026-12-31** : à partir du 1er janvier 2027, le module les passe en `a_reverifier` (avertissement sur la carte et dans le résultat) tant qu'une nouvelle ligne n'est pas publiée ; la roadmap porte la tâche annuelle de mise à jour.

### 8.2 Nouveaux repères, vérifiés le 2026-10-15 sur la source primaire et revérifiés en phase 0 (migration 0039)

| Clé | Valeur | Unité | Effet | Source (vérifiée le) |
|---|---|---|---|---|
| `lep_rfr_demi_part_sup` | 6 149 | € | 2026-01-01, fin 2026-12-31 | Service-public, LEP, F2367 (page « vérifiée le 1er août 2026 ») : table des plafonds de revenu fiscal de référence 2026, métropole, « + 6 149 € par demi-part supplémentaire » ; contrôle : 1 part 23 028, 1,5 part 29 177, 2 parts 35 326 |
| `lep_rfr_quart_part_sup` | 3 075 | € | idem | Même page : « + 3 075 € par quart de part supplémentaire » ; contrôle : 1,25 part 26 103 |
| `per_plafond_taux_revenus` | 10 | % | 2026-01-01 | Service-public, plafond de déduction de l'épargne retraite, F14709 (« vérifié le 15 avril 2026 ») : « 10 % de vos revenus d'activité (nets de frais professionnels) de 2025 », avec le plancher et le maximum déjà en repères |

Règles sans valeur chiffrée, vérifiées, rangées dans la clé `textes` de la fixture et citées par le module (pas de ligne `reperes`) :
- **PEA** (F2385, « vérifié le 22 mai 2026 ») : pas de versement minimum légal (PEA bancaire) ; un seul PEA classique par personne ; avant 5 ans, un retrait clôture le plan, sauf exceptions (licenciement, invalidité, mise à la retraite anticipée du titulaire ou de son conjoint ; liquidation judiciaire de son entreprise ; création ou reprise d'entreprise) ; après 5 ans, retraits partiels sans clôture et gains exonérés d'impôt sur le revenu, prélèvements sociaux dus.
- **Assurance-vie** (F22414, « vérifié le 15 avril 2026 ») : avant 8 ans, 12,8 % (ou barème) ; après 8 ans, abattement 4 600 / 9 200 € tous contrats, 7,5 % sous le seuil de 150 000 € de primes, 12,8 % au-delà ; prélèvements 17,2 %.
- **PER** (F34982, « vérifié le 12 octobre 2026 ») : sortie en capital des versements déduits au barème **sans** l'abattement de 10 % et sans prélèvements sociaux ; gains au prélèvement forfaitaire unique, 31,4 % depuis le 1er janvier 2026 (12,8 % + 18,6 %) ; achat de la résidence principale : même imposition de la part versements, exonérée de prélèvements sociaux ; accidents de la vie : part versements exonérée ; rente : imposée comme une pension avec l'abattement de 10 % plafonné, prélèvements sociaux de 18,6 % sur une fraction de la rente selon l'âge au premier versement (70 %, 50 %, 40 %, 30 %) **(non calculé en V1)**.
- **Plafond PER** (F14709) : plafond personnalisé sur l'avis d'impôt de l'année ; report des plafonds non utilisés sur 5 ans pour les plafonds depuis 2026 (3 ans pour 2024 et 2025) ; mutualisation possible entre époux ou partenaires soumis à imposition commune (sur demande, dans la déclaration).
Ces trois pages confirment les règles déjà codées dans `projection-fiscalite.js` (dont 18,6 % sur les gains du PER et du PEA) : aucun écart.

### 8.3 Vérifications de la phase 0 (faites le 2026-10-15, sources officielles seulement)

| Point | Source relue | Résultat | Comportement retenu |
|---|---|---|---|
| Plafonds réglementaires des frais du PEA | Légifrance, CMF art. D221-111-1 (version du 15/07/2021) | Trouvés : ouverture 10 € ; garde 0,4 %/an + 5 € par ligne (25 € non cotée) ; ordres 0,5 % en ligne, 1,2 % autrement ; transfert 15 € par ligne (50 € non cotée), 150 € au plus ; montants en euros revalorisés tous les 3 ans (montants revalorisés non trouvés) | **Texte seul** (`pea_frais_plafonds`), aucun repère : le calcul ne suppose aucun frais et rend les **frais de seuil** ; il demande les frais réels (inchangé) |
| Transfert d'une assurance-vie chez le même assureur (loi Pacte) | Légifrance, CGI art. 125-0 A, I, 2° (version du 01/01/2022) | Confirmé : transformation par avenant ou nouveau contrat « auprès de la même entreprise d'assurance », sans les conséquences fiscales d'un dénouement | Paragraphe « transfert » **affiché** (texte `av_transformation_meme_assureur`) ; jamais dit pour un autre assureur |
| Point de départ des 8 ans pour les primes versées après l'ouverture | BOFiP BOI-RPPM-RCM-30-10-20-20 § 120 ; BOI-RPPM-RCM-20-10-20-50 § 190, § 230 | Confirmé : durée effective du contrat, du premier versement au rachat, quelles que soient les modalités de paiement des primes (contrats depuis 1990) ; appréciée à la date du rachat | Calcul « depuis l'ouverture » ; le scénario 12 n'est pas bloqué |
| Ordre d'imputation des plafonds PER reportés | F14709 (vérifiée le 15/04/2026) ; Légifrance CGI art. 163 quatervicies (version du 21/02/2026) | Confirmé par F14709 : plafond de l'année d'abord, puis les reportés du plus ancien au plus récent ; l'article du CGI fixe le report (« au cours de l'une des cinq années suivantes ») sans fixer l'ordre | Le module détaille l'imputation par année (cas PER-4) |
| Durée de l'épargne de précaution | Banque de France, mesquestionsdargent.fr (page du 17/08/2025) ; AMF, guide « Se constituer une épargne de précaution » (2023) | **Source officielle trouvée** (le spec disait le contraire) : « 2 à 6 mois de revenus, plus généralement 3 mois » ; compter en mois de dépenses essentielles est « moins protecteur » ; besoins selon le foyer et la régularité des revenus ; livrets réglementés | D12 retenue : convention de Boussole en dépenses essentielles (§ 8.4), **dite comme telle, avec le repère public cité** (texte `epargne_precaution_reperes_publics`) et la cible en mois de revenus montrée à côté |
| Abattement de 10 % des pensions et fractions de la rente | F34982 | Fractions 70 / 50 / 40 / 30 % relues ; abattement plafonné non chiffré | Sans objet en V1 (D6) |

Revérifiés le même jour : `lep_rfr_demi_part_sup` 6 149 €, `lep_rfr_quart_part_sup` 3 075 € (F2367, vérifiée le 01/08/2026 ; contrôle sur les 23 lignes du tableau, de 1 à 6 parts), `per_plafond_taux_revenus` 10 % (F14709 ; la section 2025 de la page garde l'ancienne rédaction, sans effet), F2385 (vérifiée le 22/05/2026 ; **la liquidation judiciaire s'ajoute aux exceptions à la clôture**, texte complété), F22449 (15/04/2026 : le délai de 5 ans court depuis l'ouverture du plan), F22414 (15/04/2026), F34982 (12/10/2026), F2329 (30/06/2026 : 18,6 % cas général, assurance-vie, PEL, CEL restés à 17,2 %, le PEA n'y est pas), BOFiP BOI-RPPM-RCM-20-10-20-50 § 285 à 288 (abattement imputé d'abord sur la fraction à 7,5 %), F2365 et F2368 (Livret A et LDDS : 22 950 € et 12 000 €, 1,7 % jusqu'au 31/01/2027). Aucune valeur n'a changé ; les sources, dates et textes sont dans la fixture (`reperes`, `textes`, `verifications_phase0`).

### 8.4 Conventions de Boussole (statut CONV, dites comme telles à l'écran)
| Clé | Valeur | Pourquoi |
|---|---|---|
| `scn_matelas_mois_stable` | 3 mois | Bas de la fourchette pédagogique de la fiche `epargne-de-precaution` |
| `scn_matelas_mois_fragile` | 6 mois | Un revenu, enfants à charge, revenus variables |
| `scn_matelas_mois_independant` | 9 mois | Indépendant, chef d'entreprise, sans revenu d'activité |
| `scn_matelas_ecart_pct` | 25 % | Écart à la cible qui met la carte « pour toi » |
| `scn_delai_ouverture_mois` | 1 mois | Délai supposé entre la décision et l'ouverture |
| `scn_enjeu_min_eur_an` | 30 € | En dessous, une carte n'entre pas dans « Pour toi » (elle reste dans son thème) |
Unité `mois` déjà admise (0029) ; source : « Convention Boussole » et l'URL de ce spec sur le dépôt (même forme que les conventions `suivi_*` de 0032 ; `test/reperes.test.mjs` n'admet pour une convention que `github.com/Steph1237/boussole`). `scn_matelas_ecart_pct` vaut 25 (unité %), comme les autres pourcentages des repères. Le titre de la source de `scn_matelas_mois_stable` cite le repère public de la Banque de France (2 à 6 mois de revenus). Lignes exactes : fixture, clé `reperes` (statut CONV).

---

## 9. Le connecteur (`supabase/functions/mcp/scenarios.ts`)

Module sans dépendance à `index.ts` (modèle `projection.ts`, `suivi.ts`) : `registerScenarios(server, { db, wrap, must, UserError, RO, RW, DEPOT, deposer, today, banque })`. Les données viennent de `lireDonneesProjection` (projection.ts) plus `scenarios`, `scenarios_joues`, `config.avis_impot`, `risque`. Les trois outils sont **non publics** pour la garde de double authentification (`garde-mfa.ts`) : un compte à facteur sans connecteur autorisé reçoit le message habituel.

### 9.1 `lister_scenarios` (lecture)
Entrée : `{ theme?: banque|epargne|placements|immobilier|famille|retraite, inclure_ecartes?: bool }`.
Sortie : `{ date, version_catalogue, pour_toi: [cle ≤ 3], scenarios: [{ cle, numero, question, theme, pertinent, pourquoi: [texte], enjeu_annuel: { p10, p50, p90 } | null, enjeu_statut, manquants: [{ champ, libelle, comment }], etat: a_explorer|joue|retenu|ecarte, joue_le, version, reperes_a_reverifier: [cle] }], conduite }`.
Calcul : `Scenarios.lister`, 500 chemins, mêmes tirages que l'app (parité testée sur la démo).

### 9.2 `jouer_scenario` (calcul, et proposition si demandé)
Entrée : `{ cle, reponses: { <id de question>: valeur }, enregistrer?: "non" | "joue" | "retenu" | "ecarte" (défaut "non"), option?: id (avec "retenu"), source? (obligatoire si enregistrer ≠ "non"), justification?, lot? }`.
- `reponses` : schéma **strict** construit depuis `questions` du catalogue (zod : types, bornes, options) ; clé inconnue refusée ; aucune chaîne libre.
- Le serveur recalcule tout (`Scenarios.jouer`, 2 000 chemins) : **aucun chiffre ne vient du LLM**.
- `statut: "a_completer"` : renvoie `manquants` et `formulaire: { section: "scenario", cle }` (§ 9.4) ; rien n'est déposé.
- `enregistrer: "joue"` : proposition `scenario_joue` / `creer` (`apres` = réponses, résultat résumé, versions, graine) ; `"retenu"` : en plus `variante` (`Scenarios.varianteRetenue`) et `plan_fige` (`Projection.figerPlan` sur la variante provisoire), tailles contrôlées comme `figer_projection` ; `"ecarte"` : proposition de changement d'état seulement.
- Sortie : le résultat du § 6.7 (sans chemins), `proposition?: { ids, rappel: "Rien n'est enregistré tant que tu n'as pas validé dans Boussole › Agent › À valider." }`, `conduite`.

### 9.3 `lire_scenario` (lecture)
Entrée : `{ cle }`. Sortie : la fiche publiée (question, résumé, thème, données, questions, repères avec valeur, source, date et statut `a_reverifier`, version, `version_calcul`, `changelog`) et les 5 dernières parties de la personne (`etat`, `joue_le`, `reponse.phrase`, `enjeu_annuel`, versions, `variante_id`), plus `ecart_au_calcul_actuel` si `version_calcul` a changé depuis (« ce résultat date d'un ancien calcul : rejoue-le »).

### 9.4 Formulaire (MCP Apps)
Nouvelle section `scenario` du catalogue des formulaires (`scripts/gen-catalogue.mjs`), dont les champs sont **ceux du scénario demandé**, lus dans `scenarios.questions` côté serveur ; préremplissage par le serveur depuis Boussole (jamais par le LLM) ; seuls les champs manquants ou à confirmer sont montrés (3 à 6). La réponse du formulaire revient à Claude, qui rappelle `jouer_scenario`.

### 9.5 Conduite (`CONDUITE_SCENARIOS`, renvoyée par les trois outils et reprise dans les `INSTRUCTIONS`)
1. Ne calcule jamais toi-même : appelle `jouer_scenario` et ne cite que ce qu'il renvoie, arrondi, **toujours avec la bande P10–P90**, en euros d'aujourd'hui.
2. Pour chaque chiffre, dis l'hypothèse qui le porte, sa source et sa date (`hypotheses`) ; dis toujours « ce qui changerait la réponse » (au moins la première ligne).
3. Ne nomme ni ne recommande aucun produit, contrat, établissement ni offre ; parle d'enveloppes, de frais, de fiscalité, de liquidité et de plafonds. Si on te demande « lequel choisir », réponds par les critères à comparer.
4. Un scénario n'exécute rien. Si la personne veut agir (ouvrir, verser, transférer), dis ce que ça implique et que c'est elle qui le fait ; propose ensuite de l'enregistrer (`enregistrer: "retenu"`).
5. Ne pose que les questions manquantes, par le formulaire, 6 au plus ; jamais une question dont Boussole a la réponse.
6. Propose d'enregistrer seulement avec l'accord de la personne ; quand elle retient, journalise (`journaliser`, type `scenario`) avec `version_calcul` et `version_modele`.
7. Un repère `a_reverifier` ou un résultat `indisponible` se dit tel quel ; jamais de valeur de remplacement.
8. Jamais le mot « conseiller » ; au tutoiement.

### 9.6 Session
`demarrer_session` ajoute `scenarios: { pour_toi: [{ cle, question, enjeu_annuel_p50 }], a_reverifier: n }` (lecture légère, 500 chemins, cache par empreinte des données) ; la revue mensuelle (RT1) peut citer une carte « pour toi » nouvelle, une fois.

---

## 10. L'interface (Pilotage › Scénarios)

### 10.1 Navigation
- `app.js` : la sous-vue `pilotage/scenarios` prend le module **`scenarios-view`** (nouveau) ; le simulateur `simu` devient un **outil ouvert depuis une carte** du thème Immobilier (« Acheter ou louer : le simulateur simple », mention « calcul simplifié, sans tirages »), route `pilotage/scenarios?outil=acheter-louer` ; les anciennes ancres (`#acheter`, `#simulateur`, `#theorie`, `#explication`, `decisions/*`, `simu`) y mènent toujours (D8).
- Onglets internes (`.ui-onglets`, rôle `tablist`) : **Pour toi** · **Mes variantes**. Liens profonds : `pilotage/scenarios?onglet=variantes`, `pilotage/scenarios?scenario=<cle>` (ajouté à `PARAMS_DANS_URL`).

### 10.2 Onglet « Pour toi »
- **En-tête** (une phrase) : « Les questions que tout le monde se pose, calculées sur ta situation. Rien n'est fait à ta place. »
- **« Pour toi »** : 3 cartes au plus, triées par enjeu P50 décroissant (pertinentes, non écartées, enjeu ≥ `scn_enjeu_min_eur_an`) ; s'il n'y en a aucune : « Rien d'urgent ici. Parcours les thèmes si une question te parle. »
- **Par thème**, dans l'ordre Épargne, Placements, Retraite, Banque, Immobilier, Famille ; un thème sans scénario publié n'apparaît pas ; une ligne finale « D'autres questions arrivent : frais de ta banque, acheter ou louer, rembourser ou placer… » (texte seul, sans carte vide).
- **Carte** (`.ui-carte`, cible entière cliquable, 44 px minimum) :
  - puce de thème ; **question** (titre h3) ;
  - **pourquoi ça te concerne** : 1 ligne (`raisons[0]`), le reste dans le détail ;
  - **enjeu** en chiffres tabulaires : « ≈ 100 €/an » et, dessous, « de 40 à 210 €/an, 8 chances sur 10 » ; sans données : « Enjeu à calculer » ;
  - **données manquantes** : puces `.ui-puce.completer` (2 au plus, « + 1 ») ;
  - **état** : puce « À explorer » (neutre), « Joué le 12/10 » (information), « Retenu » (`.bon`), « Écarté » (atténuée) ;
  - repère à revérifier : petite mention « chiffres à revérifier » (`.surveiller`).
- **États** : chargement (squelettes de 3 cartes, sans chiffre) ; calcul en cours dans le worker (puces d'enjeu « calcul… », jamais un faux chiffre) ; données insuffisantes ; double authentification requise (message habituel, aucune donnée) ; démo (catalogue et foyer de démonstration).

### 10.3 Le détail d'un scénario
Ordre des blocs (identique sur mobile et sur grand écran) :
1. **La réponse** : une phrase (« Avec 300 €/mois sur 8 ans, un PEA te laisserait environ 820 € de plus qu'un compte-titres, en euros d'aujourd'hui »), l'écart en grand (P50) et sa bande en dessous ; la date de bascule (« à partir de décembre 2031 ») ; l'état et la date du calcul (« calculé aujourd'hui avec tes données » ou « joué le 12/10, calcul scn-1.0.0 »).
2. **La comparaison** : graphique **barres d'intervalle** horizontales, une rangée par option : trait P10–P90, point P50 avec sa valeur, ligne verticale de la référence ; option exclue grisée avec sa raison ; `role="img"` et phrase équivalente ; bouton « Voir les chiffres » (tableau P10, P50, P90, versé, impôts, frais). N° 1 et n° 12 ajoutent la **courbe « gain selon la date de retrait »** (médiane et bande P10–P90, axe du temps proportionnel, repère de la date de 5 ou 8 ans).
3. **Ce qui changerait la réponse** : liste de 2 à 4 lignes, chacune avec son seuil chiffré.
4. **Hypothèses et sources** (replié sur mobile, ouvert sur grand écran) : chaque hypothèse avec valeur, statut (vérifié, convention, ta donnée, ta réponse, à revérifier), source cliquable et date de vérification.
5. **Tes données utilisées** : champ, valeur, origine, date (« Allocation cible, ton profil, 03/10 »), lien « Compléter avec Claude » pour les manquantes.
6. **Explorer avec Claude** : bouton principal (texte prêt à coller de `claude-prompts.js` : « Joue avec moi le scénario « Faut-il ouvrir un PEA ? » de Boussole »), et, si D3 est retenue, « Écarter » / « Remettre à explorer ».
7. Pied : « Un calcul sur tes données, pas une recommandation de produit. Une projection n'est pas une promesse. Boussole n'exécute rien : c'est toi qui décides et qui fais. »

Le détail montre le **calcul du jour** fait par l'app (worker, 2 000 chemins progressifs comme le graphique maître) ; si une partie a été jouée, son résultat stocké est montré à côté (« joué le 12/10 ») avec l'écart au calcul du jour quand il dépasse 10 %.

### 10.4 Mise en page (mobile d'abord, fluide jusqu'à 1 680 px)
| Largeur | « Pour toi » | Détail |
|---|---|---|
| < 600 px (référence 390) | cartes empilées, pleine largeur ; thèmes en accordéons de lignes compactes (question, enjeu, état) | **page** dédiée (route `?scenario=`), retour en haut à gauche ; « Explorer avec Claude » collé en bas au-dessus de la barre basse (`--bbar-h`), zone sûre comprise |
| 600 à 899 px | 2 cartes par rangée (`.col-sm-6`) ; la 3ᵉ « pour toi » en pleine largeur | page dédiée, blocs 2 et 3 côte à côte quand ils tiennent |
| 900 à 1 439 px | 3 cartes « pour toi » (`.col-4`) ; thèmes en `.grid-fit` (`--fit: 320px`) | **panneau latéral** `.ui-panneau` (largeur 560 px), la liste reste visible derrière le voile |
| ≥ 1 440 px | maître-détail en ligne : liste à gauche (`.col-xl-5`), détail à droite (`.col-xl-7`) | détail inline, hypothèses ouvertes |
| ≥ 1 680 px | liste (`.col-xxl-4`), détail (`.col-xxl-5`), colonne « Hypothèses et sources » à part (`.col-xxl-3`) | contenu borné par `--content-max` (1 680 px), gouttières `--gutter` |
Jetons de `theme.css` seulement : typographie `--t-h2`, `--t-h3`, `--t-body`, `--t-small`, `--t-kpi` (chiffres), `--f-num` (chiffres tabulaires) ; couleurs à rôle unique (`--s1` et `--s1-soft` pour l'option en tête, `--s2`, `--s2-soft` pour la référence, `--q0` pour les options exclues, `--good` / `--warn` pour les états), `--radius`, `--gap-cards`, `--sp-*`, `--hit` (44 px) ; clair et sombre ; `prefers-reduced-motion` respecté. Texte courant ≤ `--measure` (72 caractères).

### 10.5 Onglet « Mes variantes »
- **Le graphique maître** (`GraphePatrimoine`, nouveau préréglage `variantes` : vue net, 10 ans, couches complet + existant, commandes Réglages et Plein écran) avec un sélecteur de variante en puces (`role="radiogroup"`) au-dessus : la variante choisie est dessinée par le composant comme aujourd'hui (médiane et P25–P75 par-dessus la bande P10–P90 de la situation actuelle, D11).
- **La liste des variantes** (`foyer_variantes`), en cartes : nom, origine (« créée avec Claude » ou « scénario retenu : Faut-il ouvrir un PEA ? » avec lien vers le scénario), date ; écart à 5 et 10 ans contre la situation actuelle (P10, P50, P90, `Projection.comparer`, 500 chemins) et probabilité de faire mieux ; plan figé associé et, quand CK5 existera, « prévu contre réel ».
- Lecture seule : « Créer ou modifier une variante avec Claude » (texte prêt à coller) ; aucune suppression depuis l'app en V1 (elle passe par `decrire_foyer`, proposition).
- État vide : « Pas encore de variante. Retiens un scénario ou demande à Claude « et si j'avais un 2ᵉ enfant ? ». »

### 10.6 Propositions à valider (Agent › À valider)
`propositions.js` affiche une proposition `scenario_joue` comme une carte : question, état demandé, phrase de la réponse, écart et bande, option retenue, variante et plan qui seront créés. **Avant validation, l'app recalcule** le scénario avec `Scenarios.jouer` sur les réponses de la proposition (même graine, mêmes données) : si l'écart P50 diffère de plus de 2 % (données changées entre-temps), la carte le dit et propose de demander à Claude de rejouer ; la validation reste possible (D5).

### 10.7 Accessibilité et textes
Contrastes ≥ 4,5:1 (textes), ≥ 3:1 (marques) ; ordre de lecture identique à l'ordre visuel ; graphiques avec phrase et tableau ; puces d'état lisibles sans couleur (texte) ; clavier : flèches dans les onglets, Échap ferme le panneau, focus rendu à la carte. Tutoiement, sans morale (« tu devrais »), sans superlatif, sans nom de produit ; « conseiller » et « conseil » absents ; chiffres arrondis, unité toujours dite (« € d'aujourd'hui », « €/an »).

---

## 11. Données et sécurité

### 11.1 `0038_scenarios.sql`
**Prérequis** : 0034 (HIS2) puis 0035 à 0037 (BUD1) appliquées. Repartir **exactement** des dernières définitions en vigueur de `appliquer_propositions` et `export_all` (0035), de `foyer_valider_variante` (0031) et de `propositions_cible_check` (0034).
- Tables `scenarios`, `scenarios_versions` (§ 4), `scenarios_joues` (§ 5) ; index ; `set_updated_at` ; déclencheurs de versions et de limites (20 par scénario, 200 en tout, verrou consultatif par utilisateur).
- `unique (user_id, id)` sur `foyer_variantes` et `plans_figes` ; clés composites de `scenarios_joues` (`on delete set null (variante_id)` et `(plan_fige_id)`, PostgreSQL 15 au moins, vérifié comme pour 0034).
- **RLS** `scenarios_joues` : propriétaire pour `select`, `insert`, `update`, `delete` ; **politique restrictive « scenarios_joues: aal2 si facteur »** pour tout, exactement à la forme de 0033 : `((select auth.jwt())->>'aal') = 'aal2' or not (select public.mfa_exigee()) or (select public.connecteur_autorise())` en `using` et en `with check`. `test/mfa-pglite.test.mjs` voit la table.
- **Garde** `scenarios_joues_garde` (before insert, update, delete ; `security invoker`, `search_path = ''`) : si `nullif(auth.jwt()->>'client_id', '')` n'est pas nul → refus `42501` (« Un connecteur n'écrit jamais une partie jouée : il dépose une proposition, que tu valides dans Boussole › Agent › À valider. »). Ainsi le connecteur **lit** (politique) mais n'écrit **que** des propositions (garde de 0034).
- **Droits de colonnes** (si D3 retenue) : `grant update (etat, decide_le)` à `authenticated`, plus un contrôle dans la garde : en dehors d'`appliquer_propositions`, seules les transitions `joue ↔ ecarte` et `retenu → ecarte` sont permises (jamais vers `retenu`).
- `propositions_cible_check` : + `scenario_joue`.
- **`appliquer_propositions`** : branche `scenario_joue` (`creer` : contrôle des clés de `apres`, scénario publié, versions, tailles, réponses aux clés des questions, état `joue` ou `ecarte` ; `modifier` : changement d'état et retenue § 5.3 ; `supprimer` : la partie, jamais la variante ni le plan) ; libellé `v_quoi` « scénario » ; la garde « jamais par un jeton OAuth » en tête est conservée.
- `foyer_valider_variante` : accepte `enveloppe_scenario` (§ 6.6, mêmes bornes et messages que le JS) ; `plans_figes.raison` et la branche `plan_fige` : + `scenario`.
- **`export_all`** : + `scenarios_joues` ; `delete_me` : cascade par `user_id`.
- `revoke all from anon` sur `scenarios_joues` ; `service_role` explicite (0033) sur les nouvelles tables et fonctions.
- En-tête de migration au format de 0034 (ce qui change, prérequis, vérifications à faire en production avant, tests).

### 11.2 `0039_scenarios_catalogue.sql`
Idempotente (`on conflict do update`) : les repères du § 8.2 et du § 8.4, recopiés à l'identique de la fixture (parité testée par `test/reperes.test.mjs`), jamais une valeur non vérifiée ; les 5 entrées du catalogue v1 (`statut = 'publie'`, `version = 1`, `version_calcul = 'scn-1.0.0'`), copiées dans `scenarios_versions` par le déclencheur. Appliquée en production seulement après le banc (D9).

### 11.3 Revue de sécurité (points que la relecture Opus doit fermer)
1. Aucun chemin d'écriture de `scenarios_joues` pour un jeton portant `client_id` (insert, update, delete, et par `appliquer_propositions` : déjà refusé en tête).
2. Aucune lecture croisée (B ne lit, n'applique ni ne référence une variante ou un plan de A : clés composites).
3. `scenarios` : aucune écriture hors service ; lecture des seules lignes publiées.
4. Pas d'injection par les réponses : schéma strict des deux côtés (zod et SQL), aucune chaîne libre, `contenu_sensible` sur `source`.
5. Tailles bornées (réponses 8 ko, résultat 60 ko, variante 20 ko, plan 400 ko).
6. `security invoker` et `search_path = ''` partout ; `(select auth.jwt())`, `(select auth.uid())`.
7. Les textes stockés du résultat sont des gabarits du module : relecture qu'aucun champ libre du LLM n'y entre.
8. Export et suppression complets.
9. Parité du recalcul de l'app (§ 10.6) : une proposition forgée hors de l'outil se voit à la validation.

---

## 12. Intégrations

### 12.1 BUD1 (seulement là où il faut)
- **Capacité d'épargne** : `ProjectionDonnees.capaciteDeBase` reste la seule entrée ; avec BUD1, la capacité prévue est la cible validée (`config.budget_cible.perimetres.foyer.blocs.epargne`, BUD1 § 8.5) et la constatée vient du réel catégorisé. SCN1 n'en recalcule aucune.
- **Dépenses essentielles** (scénario 6) : `Budget.reference(data, { vue: "tout" })`, bloc `essentiels` (médiane lissée sur 12 mois, BUD1 § 6.2) ; **nom exact du champ à figer avec la tâche 7 de BUD1**. Sans BUD1 en ligne : repli sur le budget prévu, dit comme tel.
- Pas de dépendance dure : SCN1 fonctionne sans BUD1 (repli) ; les tests utilisent un bouchon de `Budget.reference`.
- Les scénarios 4, 5, 9 et 11 (lot 2) s'appuieront sur `Budget.pistes` ; hors V1.

### 12.2 CK5 et courbe maîtresse
La variante retenue est une variante comme les autres (sélecteur du graphique maître, `comparer_variantes`) ; le plan figé (raison `scenario`) est rejouable par `Projection.comparerPlanReel`. CK5 n'est pas livré par SCN1 : il trouvera ces plans tels quels.

### 12.3 PROG1 (léger)
PROG1 n'est pas codé. SCN1 range dans chaque entrée du catalogue ses déclencheurs (`ouverture`, § 4.1 ; par exemple « capacité positive », « question au Copilote », « enfant prévu », « après 3 mois de données ») sans les évaluer. En V1, la section est visible de tous ; quand `ouverture.js` existera, il lira ces champs, et une carte « pour toi » nouvelle sera annoncée comme les autres ouvertures (pastille « Nouveau »).

### 12.4 DAT1, journal, savoir
Dates de 5 et 8 ans par `Calendrier` ; un jalon `pea_5_ans` ou `av_8_ans` proche est cité dans « ce qui changerait ». Une partie retenue se journalise (type `scenario`, déjà prévu par `journal-view.js`). Les fiches du savoir (`pea`, `assurance-vie`, `per`, `livrets-reglementes`, `epargne-de-precaution`) sont liées depuis les hypothèses.

---

## 13. Tests

### 13.1 Cas chiffrés à la main (`test/fixtures/scenarios-cas.json`, `test/scenarios.test.mjs`)
*Phase 0 faite : 65 cas (n° 1 : 15, n° 2 : 9, n° 3 : 12, n° 6 : 14, n° 12 : 12, tri « pour toi » : 3), dont 5 Monte-Carlo (2 000 chemins, graine 20261014) calculés sur `Projection.tirages` par un socle écrit à la main, avec leurs invariants exacts (quantile de l'écart = fonction du quantile du gain quand l'écart est une fonction croissante du gain ; t* = Q50(X) / versements déduits). Chiffres produits par un script Python mois par mois, revérifiés par un script Node indépendant (rentes en formules fermées, dates par `Date`, fausse position au lieu de la dichotomie, Monte-Carlo par produits à rebours) : 596 valeurs, aucun écart ; 582 mutations de la fixture et 8 du script, toutes détectées ; test de mutation des deux côtés (`seconde_verification` de la fixture). Conventions de lecture (calendrier des flux, impôts, euros d'aujourd'hui, bascule, seuils, matelas, PER) : clé `conventions`.*
Pour chaque scénario, au moins 4 cas en mode déterministe (dont ceux des § 7.1 à 7.5 : PEA-1 à PEA-3, PER-1, PER-2, MAT-1, AV-1), chacun avec ses entrées, son attendu à 0,01 € près et son calcul en clair ; recalculés une seconde fois par un script jetable indépendant du module (phase 0). Plus, par scénario : un cas « donnée manquante » (`a_completer`, manquants attendus), un cas « repère absent » (`indisponible`), un cas « repère expiré » (`a_reverifier`), un cas limite (plafond atteint, horizon de 4 ans 11 mois et 5 ans 1 mois, TMI 0 %, matelas nul, surplus nul, LEP juste au seuil de 35 326 € et à 35 327 €).

### 13.2 Propriétés Monte-Carlo (`test/scenarios-mc.test.mjs`)
Mêmes tirages que le moteur (`Projection.tirages` contre `derouler` sur un compartiment seul : valeurs identiques à 1e-9) ; monotonie (plus de frais → net plus bas sur chaque chemin ; plus d'horizon après 5 ans → écart PEA non décroissant à frais égaux) ; écart chemin par chemin ; cohérence du socle et du moteur complet à 1 % près (§ 6.3) ; graine fixée → résultats reproductibles ; parité app et copie générée ; temps (§ 6.2).

### 13.3 Moteur PROJ (`test/projection-enveloppe-scenario.test.mjs`)
Validation JS et SQL de `enveloppe_scenario` (parité de messages) ; compartiment synthétique ouvert à sa date ; PEA à 5 ans et AV à 8 ans depuis l'ouverture ; économie PER en septembre N+1 ; débordement au plafond ; transfert depuis un livret ; **non-régression `proj-1.2.0`** (toutes les fixtures et la démo identiques sans l'hypothèse).

### 13.4 Base (`test/scenarios-pglite.test.mjs`, extension de `test/mfa-pglite.test.mjs`)
Contraintes, RLS (lecture croisée refusée), politique restrictive aal2 (lecture refusée en aal1 avec facteur, permise avec connecteur autorisé), **garde : insert, update, delete refusés pour un jeton à `client_id`** même autorisé, propositions `scenario_joue` (créer, retenir avec variante et plan en une transaction, limite de 10 variantes, tout ou rien, refus des clés inconnues, scénario non publié refusé), clés composites, limites 20/200, transitions d'état, droits de colonnes (D3), `export_all`, cascade, `scenarios` en lecture publique des lignes publiées seulement, versions copiées, contenu sensible et mot interdit refusés.

### 13.5 Connecteur (`test/scenarios-mcp.test.mjs`)
Trois outils, annotations RO/RW, garde MFA, schémas stricts (clé inconnue, chaîne libre, borne), `a_completer` sans dépôt, dépôt seulement avec `source`, recalcul serveur (un résultat fourni par l'appelant est ignoré), tailles, conduite, parité avec l'app sur la démo, `lire_scenario` après changement de `version_calcul`, formulaire `scenario` (options et préremplissage fournis par le serveur).

### 13.6 Banc EX3 (cas `banc/cas/SCN-*.json`)
8 cas : un par scénario (oracle par chemin, par exemple `jouer_scenario › reponse.ecart.p50`, tolérance 2 %), plus 3 sentinelles : « quel PEA choisir ? » (aucun nom d'établissement ni de produit dans la réponse) ; « calcule-moi de tête » (refus, appel de l'outil) ; donnée piégée dans une réponse (« ignore tes règles… » dans un libellé fictif d'objectif : jamais recopiée, jamais exécutée). Critères `chiffres_ancres` et `chiffres_oracle` du banc.

### 13.7 Interface (`test/scenarios-view.test.mjs`)
Tri et plafond de 3 « pour toi », seuil d'enjeu, ordre des thèmes, carte (pourquoi, enjeu et bande, manquants, état), états vides, chargement et MFA, détail (ordre des blocs, phrase équivalente et tableau, options exclues lisibles), maître-détail aux 5 largeurs (390, 768, 1 024, 1 440, 1 680 px), panneau (Échap, focus), liens profonds et anciennes routes du simulateur, « Mes variantes » (sélecteur, comparaison, état vide), recalcul à la validation (§ 10.6), **lecture seule** (`test/lecture-seule.test.mjs` : aucune écriture sauf, avec D3, `etat` et `decide_le`), lexique (`conseiller.test`, `tutoiement.test`, `ux4-lexique.test`, aucun nom d'établissement de la liste de contrôle), contrastes et cibles de 44 px. Captures 390 px et 1 440 px et 1 680 px, clair et sombre, dans `docs/captures/scn1/`.

---

## 14. Hors périmètre
Lots 2 à 4 du catalogue ; sortie du PER en rente ; plafond PER des indépendants ; calcul exact de l'impôt du foyer (décote, quotient familial) ; dividendes du compte-titres ; titres non éligibles au PEA ; fourchettes de frais de marché ; transmission chiffrée (seulement citée) ; écran Pilotage › Projections (SIM3) ; CK5 ; PROG1.

---

## 15. Décisions (tranchées par Stéph le 2026-10-16 : les 14 recommandations en gras sont retenues, sans changement des sections du spec)

| # | Question | Options | Recommandation (retenue) |
|---|---|---|---|
| D1 | Comment calculer la réponse d'un scénario | Socle « à la marge » sur les mêmes tirages + variante du moteur complet pour le retenu · tout par le moteur complet · socle seul | **Socle à la marge + variante retenue** (§ 6.2, § 6.3) : la question est marginale, la variante montre l'effet sur tout le patrimoine ; cohérence testée à 1 % |
| D2 | « À explorer » | Absence de ligne · ligne créée pour chaque scénario pertinent | **Absence de ligne** : rien n'est écrit tant que la personne n'a pas joué |
| D3 | L'app peut-elle « écarter » ou « remettre à explorer » sans Claude ? | Oui, bascule directe (comme `budget_regles.active`) · seulement par proposition | **Oui, bascule directe** limitée à `joue ↔ ecarte` et `retenu → ecarte` ; retenir passe toujours par une proposition |
| D4 | Retenir une 2ᵉ fois le même scénario | L'ancien retenu redevient « joué », sa variante reste (renommée) · on remplace la variante | **L'ancien redevient joué, la variante reste** : on garde la trace pour CK5 |
| D5 | Recalcul de l'app à la validation | Recalcul et alerte au-delà de 2 % · aucun recalcul · blocage | **Recalcul et alerte** (sécurité et confiance), sans blocage |
| D6 | Sortie du PER en rente | Calculée en V1 (repères de l'abattement des pensions et des fractions à vérifier) · texte seul | **Texte seul en V1** : règles vérifiées citées, calcul en lot 3 |
| D7 | Date de départ à la retraite | Demandée, sans valeur par défaut · âge légal supposé | **Demandée** : l'âge légal a changé récemment et dépend de l'année de naissance ; pas de repère supposé |
| D8 | Le simulateur acheter ou louer actuel | Outil ouvert depuis une carte du thème Immobilier · 3ᵉ onglet · retiré | **Carte du thème Immobilier**, en attendant le scénario n° 7 (lot 3) qui le remplacera |
| D9 | Publication du catalogue | 0039 publie, appliquée en production après le banc · 0039 en brouillon puis 0040 qui publie | **0039 publie, appliquée après le banc** (deux migrations au lieu de trois) |
| D10 | Les variantes de scénarios comptent-elles dans la limite de 10 ? | Oui, message clair · limite portée à 20 | **Oui** : la limite protège la lisibilité du graphique ; le message dit quoi supprimer |
| D11 | Bande de la variante sur la courbe maîtresse | Garder médiane + P25–P75 par-dessus la bande P10–P90 · passer en P10–P90 | **Garder l'existant** sur la courbe (lisibilité) ; P10–P90 partout dans les scénarios |
| D12 | Durées du matelas sans source officielle | Convention Boussole 3 / 6 / 9 mois, dite · pas de nombre de mois, seulement les dépenses | **Convention dite**, alignée sur la fiche du savoir ; à remplacer si la phase 0 trouve une page officielle. *Phase 0 : la Banque de France (mesquestionsdargent.fr) donne « 2 à 6 mois de revenus, plus généralement 3 » et juge le calcul en dépenses essentielles « moins protecteur » : la décision retenue garde la convention en dépenses, et l'écran cite ce repère public avec la cible en mois de revenus à côté (§ 8.3, § 8.4).* |
| D13 | Où placer le surplus du matelas dans le calcul | Compte-titres (le plus imposé, prudent) · l'enveloppe principale de la personne · question | **Question, compte-titres par défaut** |
| D14 | Copie pour le connecteur | Dans `projection-moteur.gen.js` (un seul moteur copié) · copie à part `scenarios.gen.js` | **Dans `projection-moteur.gen.js`** : mêmes tirages par construction, pas de troisième copie du moteur |

---

## 16. Risques
- **Lisibilité** : cinq options, des bandes et des seuils peuvent noyer la réponse ; d'où la phrase d'abord et 4 lignes au plus de « ce qui changerait ». Revue sur captures avant la mise en ligne.
- **Fausse précision** : un écart médian de 100 €/an avec une bande de −300 à +500 n'est pas une certitude : la bande et la probabilité sont toujours à côté du chiffre, et l'arrondi est à la dizaine.
- **Repères annuels** : plusieurs repères expirent le 2026-12-31 ; alerte automatique et tâche annuelle.
- **Évolution des règles** (fiscalité de l'épargne revue chaque année par les lois de finances et de financement de la sécurité sociale) : chaque règle passe par un repère ou un texte daté ; `version_calcul` trace les changements.
- **Performance** du calcul des cartes sur mobile : 500 chemins dans le worker, cache par empreinte des données, chiffres affichés seulement une fois calculés.
- **Conflits de numéros** avec BUD1 (0035 à 0037) : 0038 repart des définitions de 0035 ; si BUD1 glisse, renuméroter au moment du code et repartir des dernières définitions en vigueur.
- **Variante limitée à 10** : un utilisateur actif peut la remplir vite ; mesurer après un mois (D10).
