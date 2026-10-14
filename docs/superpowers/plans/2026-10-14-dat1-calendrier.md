# DAT1 : calendrier patrimonial — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal :** Boussole connaît les dates qui font courir les délais fiscaux de chaque enveloppe (ouverture, versements, donations, crédit, avis d'impôt) et en tire un calendrier honnête : PEA à 5 ans, assurance-vie à 8 ans et au 70ᵉ anniversaire, PEL, épargne salariale, donations à 15 ans, moins-values à 10 ans, 31 décembre, révision des livrets. Aucune date n'est affichée sans donnée : ce qui manque devient « à compléter ». L'app montre (Aujourd'hui, fiche d'enveloppe, revue mensuelle), Claude recueille (outils de proposition) et lit (`calendrier`).

**Spec :** `docs/superpowers/specs/2026-10-14-dat1-calendrier-design.md`. À lire en entier avant de commencer, en particulier § 3 (règles), § 4 (moteur) et § 11 (sources vérifiées).

**Repères :**
- Dépôt : `/Users/stephane/boussole`.
- Commandes : `npm test` (et `node --test test/<fichier>.test.mjs` pour un seul fichier), `node build.mjs`, `npm run gen` si un fichier généré change (ce chantier n'en ajoute pas).
- Base de test : PGlite, `test/helpers/pglite.mjs` (`baseComplete`, `comme`) ; modèle : `test/frais-suite-pglite.test.mjs`.
- Connecteur testé avec `stripTypeScriptTypes` et `vm` ; modèles : `test/routines-mcp.test.mjs` (outils), `test/sante-calc.test.mjs` § « parité » (portage).
- Tutoiement partout (`test/tutoiement.test.mjs`), jamais « conseiller », jamais un produit nommé, aucune donnée réelle (exemples fictifs : « PEA Exemple », 1 234 €).
- App en lecture seule (`test/lecture-seule.test.mjs`) : aucune nouvelle méthode d'écriture dans le store.
- Ne pas committer dans les tâches : c'est le contrôleur qui committe.
- **SEC2 en cours** : `0028_mfa.sql`, `mfa.js`, `account.js`, `consent.js`, `store-supabase.js` et `powens/index.ts` sont modifiés par le chantier SEC2. Ne commencer les tâches 6 et 8 qu'une fois SEC2 fusionné sur `main`, et repartir de `main` à jour. La migration de ce chantier est **0029** et s'applique **après** 0028.

**Modèle par tâche** (roadmap § 3 bis) : Opus pour la relecture des règles fiscales seulement (tâches 0 et 10) ; Sonnet pour le code ; Haiku pour le mécanique. L'effort est indiqué à chaque tâche.

**Ordre :**
1. Tâche 0 (Opus) d'abord : elle fige les règles et les cas de test.
2. Puis en parallèle, sur des fichiers disjoints : tâche 1 (migration), tâche 2 (repères), tâche 3 (moteur).
3. Puis tâche 4 (portage connecteur, après 3), tâche 5 (outils MCP, après 1 et 4), tâche 6 (store, après 1 et SEC2), tâche 8 (Powens, après 1 et SEC2).
4. Puis tâche 7 (interface, après 3 et 6), tâche 9 (mécanique), tâche 10 (relecture Opus), tâche 11 (déploiement).

## Contrats communs (à respecter à l'identique dans toutes les tâches)

### Données (spec § 2)

| Où | Forme | Défaut |
|---|---|---|
| `config.enveloppes_infos` | `{ "<clé d'enveloppe>": { type, titulaire, date_ouverture?, date_ouverture_approx?, date_cloture?, versements_cumules?, versements_avant_70?, beneficiaires_revus_le?, versements?, moins_values?, source, le } }` | `{}` |
| `config.prets_infos` | `{ "credit:<uuid>" \| "bien:<uuid>": { date_signature?, date_fin?, duree_mois?, taux_pct?, assurance_taux_pct?, ira_exoneration?, source, le } }` | `{}` |
| `config.donations` | `[{ id, date, montant, donateur: p1\|p2, lien: enfant\|petit_enfant\|arriere_petit_enfant\|autre, beneficiaire, nature: donation\|don_argent_790g\|don_logement_790a_bis, source, le }]` | `[]` |
| `config.avis_impot` | `{ annee_revenus, rfr?, plafonds_per?: { p1?: [{ annee, montant }], p2?: [...] }, source, le }` ou `{}` (`annee` = année du plafond, 6 lignes au plus par personne) | `{}` |
| `profiles.personnes.p1\|p2.naissance` | `AAAA-MM-JJ` ou `AAAA-MM` (lu seulement ; champ porté par FOY1, validé ici s'il arrive avant) | absent |
| `banque_comptes.ouverture_le` | `date` null | null |
| `banque_comptes.pret` | `jsonb` null : champs documentés du prêt Powens | null |
| `banque_comptes.infos_proposees_le` | `timestamptz` null | null |
| `reperes.date_fin` | `date` null | null |
| `reperes.unite` | `%`, `€`, `ans`, **`mois`** | — |

Clé d'enveloppe : le nom de l'enveloppe tel que `positions.envelope` (1 à 80 caractères), ou `"<nom>|p1"` / `"<nom>|p2"` quand les deux titulaires ont une enveloppe de ce nom (spec § 2.1). `type` ∈ `pea`, `pea_pme`, `pea_jeune`, `assurance_vie`, `capitalisation`, `per`, `pel`, `cel`, `pee`, `percol`, `compte_titres`, `livret_a`, `ldds`, `lep`, `autre`.

Messages d'erreur : même style que `frais_enveloppes` (0027), préfixés par la clé (`enveloppes_infos « PEA Exemple » : date_ouverture invalide (AAAA-MM-JJ)`). Les dates fournies (`date_ouverture`, `le`, `beneficiaires_revus_le`, `date` d'une donation, d'un versement) ne sont **jamais dans le futur** (date de Paris).

### Moteur (spec § 4)

`Calendrier.calendrier(data, today, options?)` dans `web/src/calendrier.js` (UMD, global `Calendrier`), exposé aussi en `Calc.calendrier` (délégation). Entrée `data = { positions, config, profil, credits, biens, reperes }` (formes de l'app : `S.positions`, `S.config`, `S.profil`, `S.savoir.reperes`), `today = "AAAA-MM-JJ"` (Paris), `options = { horizonAns = 40 }`.

Sortie :
```
{
  jalons: [{ id, date, enveloppe, titulaire, type, cle, titre, effet, statut: "passe"|"proche"|"futur", jours,
             source: { titre, url, verifie_le, reperes: [cle] }, confiance: "sure"|"approchee"|"calculee" , donnee: { champ, source, le } }],
  a_completer: [{ id, enveloppe, titulaire, type, cle, champ, titre, pourquoi }],
  seuils: [{ id, enveloppe, cle, titre, verse, plafond, reste, source }],
  regles_indisponibles: [{ cle, reperes_manquants: [cle] }],
  prochains: [3 premiers jalons non passés], dans_3_mois: [jalons proches]
}
```
Tri : date croissante, puis `cle`, puis `enveloppe`. `id` stable : `<cle>:<clé d'enveloppe ou "foyer">:<date>`. `proche` = de 0 à 92 jours (`PROCHE_JOURS = 92`). Le connecteur rend la même sortie en snake_case (déjà en snake_case ci-dessus : les deux côtés utilisent ces noms).

### Outils MCP (spec § 6)

| Outil | Annotations | Dépose |
|---|---|---|
| `calendrier({ horizon_mois?, enveloppe?, inclure_passes? })` | RO | rien (lecture) |
| `regler_infos_enveloppe({ enveloppe, type, titulaire, date_ouverture?, date_ouverture_approx?, date_cloture?, versements_cumules?, versements_avant_70?, beneficiaires_revus_le?, versements?, moins_values?, le?, source, justification? })` | RW | cible `config`, `apres { enveloppes_infos: { <clé>: … } }` |
| `regler_infos_pret({ pret: "credit:<uuid>"\|"bien:<uuid>", date_signature?, date_fin?, duree_mois?, taux_pct?, assurance_taux_pct?, ira_exoneration?, le?, source })` | RW | cible `config`, `apres { prets_infos: { <clé>: … } }` |
| `regler_donations({ donations, mode: "remplacer", source })` | RW | cible `config`, `apres { donations: [...] }` |
| `regler_avis_impot({ annee_revenus, rfr?, plafonds_per?, le?, source })` | RW | cible `config`, `apres { avis_impot: {...} }` |

## Task 0 : relecture des règles fiscales et cas de test (Opus, effort high)
**Fichiers :** spec § 3 et § 11 (corrections éventuelles) ; `test/fixtures/calendrier-cas.json` (nouveau, cas de référence).

- [ ] Relire § 3 (catalogue des règles) contre § 11 (sources vérifiées). Revérifier en ligne les lignes marquées « à revérifier » ou « changé récemment » (§ 12) : taux et sources à la date du jour. Corriger la spec si besoin, et le noter en tête de la spec (« relu le … »).
- [ ] Écrire `test/fixtures/calendrier-cas.json` : 25 cas au moins, chacun `{ nom, today, data, attendu: { jalons: [{ cle, date, statut, confiance }], a_completer: [cle], seuils: [...] } }`. Obligatoires :
  - PEA ouvert le 2021-06-15 → `pea_5_ans` le 2026-06-16, statut `passe` le 2026-10-14 ;
  - PEA ouvert le 2024-02-29 → anniversaire au 2029-02-28 (art. 641 CPC), jalon le 2029-03-01 ;
  - PEA sans date → aucun jalon, `a_completer` `date_ouverture` ;
  - PEA avec seulement `date_ouverture_approx: "2019"` → jalon au 2025-01-01 (fin d'année + 5 ans + 1 jour), confiance `approchee` ;
  - PEA clos (`date_cloture`) → plus aucun jalon futur ; les jalons passés avant la clôture restent ;
  - PEA dont toutes les lignes sont clôturées et sans `date_cloture` → traité comme clos (confiance `calculee`) ;
  - PEA à 92 000 € de versements → seuil `pea_plafond` reste 58 000 € ; PEA + PEA-PME du même titulaire → seuil global 225 000 € (le reste du PEA est le plus petit des deux restes, spec § 3.1) ;
  - assurance-vie ouverte le 2018-03-01, titulaire né le 1960-05-20 → `av_8_ans` le 2026-03-02 (passé), `av_70_ans` le 2030-05-20 (jour de l'anniversaire, sans lendemain) ; titulaire de 72 ans → `av_70_ans` passé et effet au passé ; naissance absente → `a_completer` `naissance` (et aucun jalon `av_70_ans`) ; naissance au mois seulement (`1960-05`) → jalon au 2030-05-01 (date la plus précoce, prudente pour une limite d'âge), `approchee` ;
  - assurance-vie dont `av_8_ans` est passé → jalon `av_abattement_annee` au 31/12 de l'année en cours ;
  - PER, titulaire né le 1957-11-02 → `per_70_ans` le 2027-11-02 ;
  - assurance-vie ouverte un 29 février ;
  - contrat de capitalisation : 8 ans, mais aucun jalon 70 ans ;
  - PEL ouvert le 2009-05-10 (avant le 2011-03-01) → `pel_2_ans`, `pel_4_ans`, `pel_10_ans` (2019-05-11), `pel_12_ans` (2021-05-10, jour de l'anniversaire), aucun `pel_15_ans` ; PEL ouvert le 2014-09-01 → `pel_2_ans`, `pel_4_ans`, `pel_10_ans` (2024-09-02), `pel_12_ans` (2026-09-01), `pel_15_ans` (2029-09-02) ; PEL ouvert le 2019-01-15 → `pel_2_ans`, `pel_4_ans`, `pel_10_ans`, `pel_15_ans`, aucun `pel_12_ans` *(corrigé en tâche 0 : spec § 12.2, point 5, et BOFiP pour le 12ᵉ anniversaire)* ;
  - PEE avec trois versements : un avec `disponible_le` du relevé (`sure`), deux sans, de même date (regroupés en un jalon « au plus tôt », `approchee`) ;
  - donation du 2015-07-01 → `donation_15_ans` le 2030-07-02 ;
  - moins-value de 2017 → expire le 2027-12-31 (statut `futur` le 2026-10-14, `proche` le 2027-10-01) ;
  - avis d'impôt avec un plafond 2023 non utilisé de 1 234 € → `per_plafond_expire` le 2026-12-31 ; plafond 2026 → 2031-12-31 (report de 5 ans) ; sans avis : `per_fin_annee` au 31/12 si le foyer a un PER, plus `a_completer` `avis_impot` ;
  - Livret A détenu, repère `livret_a_taux` avec `date_fin` 2027-01-31 → `taux_reglementes` le 2027-02-01 ; repère sans `date_fin` → aucun jalon ; aucun livret → aucun jalon ;
  - crédit avec `date_signature` et `duree_mois` → fin calculée (`calculee`) ; avec `date_fin` → `sure` ; sans rien → `a_completer` ;
  - repère manquant (`pea_duree_ans` absent de `reperes`) → aucun jalon PEA, `regles_indisponibles` ;
  - deux titulaires avec une enveloppe « PEA » chacun → clés `PEA|p1` et `PEA|p2`.
- [ ] Rendre la liste des corrections au contrôleur. Aucun code.

> **Tâche 0 faite le 2026-10-14** : spec relue (en-tête, § 3, § 11, § 12.2 « résolution »), fixture `test/fixtures/calendrier-cas.json` (43 cas ; conventions de comparaison dans son champ `conventions`).

## Task 1 : migration 0029 et tests PGlite (Sonnet, effort medium)
**Fichiers :** `supabase/migrations/0029_calendrier.sql` (nouveau) ; `test/calendrier-pglite.test.mjs` (nouveau) ; `test/helpers/pglite.mjs` seulement si `baseComplete` doit inclure 0029 pour d'autres tests (ajout seulement).

- [ ] **Tests d'abord** (PGlite, `baseComplete` jusqu'à 0028, puis 0029). Ils couvrent :
  - colonnes `config.enveloppes_infos`, `prets_infos`, `donations`, `avis_impot` : défauts, contraintes `jsonb_typeof` (objet, objet, liste, objet) ;
  - `appliquer_propositions`, cible `config` : chaque nouvelle clé acceptée seule ou avec les autres ; champ inconnu refusé ; type d'enveloppe inconnu refusé ; titulaire hors `p1`/`p2` refusé ; dates invalides (`2026-02-30`), dates dans le futur, `date_ouverture` et `date_ouverture_approx` ensemble refusées ; montants négatifs refusés ; `versements_avant_70` > `versements_cumules` refusé ; `versements` seulement pour `pee`/`percol`, `moins_values` seulement pour `compte_titres` ; 30 enveloppes au plus avant et après fusion ; `null` retire une enveloppe ; source obligatoire (1 à 300 caractères) ; `le` par défaut = date du jour à Paris ;
  - clé `"<nom>|p2"` acceptée seulement si `titulaire = 'p2'` ;
  - `prets_infos` : clé `credit:<uuid>` ou `bien:<uuid>` d'une ligne de l'utilisateur (une clé d'un autre utilisateur est refusée, comme une ligne inexistante) ; `date_fin` > `date_signature` ; `taux_pct` entre 0 et 20 ; `duree_mois` de 1 à 480 ;
  - `donations` : liste qui remplace la liste ; 100 au plus ; `id` unique ; `nature` et `lien` dans les listes fermées ;
  - `avis_impot` : `annee_revenus` entre 2000 et l'année en cours ; plafonds positifs, 5 années au plus par personne ;
  - `profiles.personnes.pX.naissance` : `AAAA-MM-JJ` ou `AAAA-MM`, pas dans le futur, après 1900 (si FOY1 ne l'a pas déjà livré : vérifier d'abord la dernière définition de la branche profil) ;
  - tout ou rien : une proposition invalide dans un lot n'applique rien ; propositions refusées → aucune écriture ; RLS : B n'applique pas les propositions de A ;
  - `reperes` : colonne `date_fin` (null par défaut, `date_fin >= date_effet`), unité `mois` acceptée, une autre refusée ;
  - `banque_comptes` : colonnes `ouverture_le`, `pret`, `infos_proposees_le` présentes ; `authenticated` ne peut pas les modifier (seules les 5 colonnes de rattachement le restent) ;
  - politiques restrictives MFA de 0028 toujours présentes sur `config` et `banque_comptes` (le test `mfa-pglite` reste vert).
- [ ] **Migration.** En-tête au format des migrations précédentes (non appliquée, ordre : après 0028, avant le déploiement des fonctions `mcp` et `powens`). Contenu :
  - `alter table public.config add column if not exists …` pour les 4 colonnes, avec contraintes nommées `config_enveloppes_infos`, `config_prets_infos`, `config_donations`, `config_avis_impot` ;
  - `alter table public.reperes add column if not exists date_fin date` + contrainte `reperes_date_fin` ; remplacement de la contrainte d'unité (nom réel à lire dans le catalogue PGlite : `reperes_unite_check` par défaut) par `unite in ('%','€','ans','mois')` ;
  - `alter table public.banque_comptes add column if not exists ouverture_le date, pret jsonb, infos_proposees_le timestamptz` + contrainte `banque_comptes_pret` (`pret is null or jsonb_typeof(pret) = 'object'`) ; aucun nouveau `grant update` ;
  - `appliquer_propositions` : **repartir exactement de la définition de `0027_frais_suite.sql`** (copie intégrale, puis ajouts). Changements : nouvelles variables ; liste des clés de la cible `config` étendue (`cushion`, `recurring`, `frais_enveloppes`, `enveloppes_infos`, `prets_infos`, `donations`, `avis_impot`) avec le message d'erreur à jour ; un bloc par clé, sur le modèle exact du bloc `frais_enveloppes` (fusion par clé pour les objets, remplacement pour `donations`) ; branche `profil` : contrôle de `naissance`. Rien d'autre ne change (tout ou rien, `security invoker`, `search_path = ''`, mêmes messages, mêmes droits) ;
  - les inserts de repères de la tâche 2 (bloc séparé, `on conflict (cle) do update`).
- [ ] Vérifier avec `diff` que la fonction recréée ne diffère de 0027 que par les ajouts listés (coller le résumé du diff dans le compte rendu).
- [ ] `node --test test/calendrier-pglite.test.mjs`, puis `npm test`.

## Task 2 : repères sourcés (Haiku, effort low)
**Fichiers :** bloc d'inserts de repères dans `supabase/migrations/0029_calendrier.sql` (livré au contrôleur ou ajouté en fin de fichier après la tâche 1) ; `web/src/demo-data.js` (repères de la démo, alignés) ; `test/reperes.test.mjs` ; `web/src/reperes.js` (`depuisLignes` lit `date_fin` → `dateFin`).

- [ ] Recopier **à l'identique** la table § 11.2 de la spec (clé, libellé, valeur, unité, date d'effet, date de fin, titre de la source, URL, vérifié le). Ne rien recalculer, ne rien arrondir.
- [ ] Test : chaque clé de `Calendrier.REGLES[].reperes` existe dans la migration, avec une URL `https://` d'un domaine officiel (`service-public.fr`, `service-public.gouv.fr`, `impots.gouv.fr`, `bofip.impots.gouv.fr`, `legifrance.gouv.fr`, `economie.gouv.fr`, `amf-france.org`, `banque-france.fr`) et un `verifie_le` ≤ aujourd'hui.
- [ ] Test : `Reperes.depuisLignes` rend `dateFin`.
- [ ] `npm test`.

## Task 3 : moteur pur `Calendrier.calendrier` (Sonnet, effort medium)
**Fichiers :** `web/src/calendrier.js` (nouveau) ; `web/src/calc.js` (délégation `Calc.calendrier`) ; `build.mjs` (ajouter `calendrier` dans `SCRIPTS`, après `reperes`) ; `test/calendrier.test.mjs` (nouveau).

- [ ] **Tests d'abord** : tous les cas de `test/fixtures/calendrier-cas.json` (tâche 0), plus :
  - fonctions de date : `ajouterAns("2024-02-29", 5) === "2029-02-28"`, `ajouterMois("2026-01-31", 1) === "2026-02-28"`, `lendemain`, `joursEntre` sans dérive d'heure d'été (calcul en UTC) ;
  - statut aux bornes : 0 jour → `proche`, 92 → `proche`, 93 → `futur`, −1 → `passe` ;
  - exceptions de date (spec § 3.2) : anniversaires d'âge au jour même, dates limites au dernier jour, livrets au lendemain de `date_fin` ;
  - horizon : rien au-delà de `horizonAns` ; jalons récurrents (livrets, 31/12) : seulement la prochaine occurrence ;
  - pureté : `data` non modifié (copie profonde comparée), même sortie pour deux appels ;
  - aucun texte au vouvoiement, aucun « conseiller », aucun nom de produit ou d'établissement dans `REGLES` ;
  - chaque règle de `REGLES` a `cle`, `types`, `reperes` (non vide, sauf `pret_fin`, règle contractuelle dont la source est l'offre de prêt), `fiche` (slug du savoir ou null), `titre`, `effet` ;
  - un repère absent → règle dans `regles_indisponibles`, jamais une valeur par défaut ;
  - `Calc.calendrier === Calendrier.calendrier` sous Node.
- [ ] Implémenter selon la spec § 3 et § 4. Exporter : `calendrier`, `REGLES`, `TYPES`, `typeDeduit(nom)`, `cleEnveloppe(nom, titulaire, positions)`, `ajouterAns`, `ajouterMois`, `lendemain`, `joursEntre`, `PROCHE_JOURS`, `texteDelai(jours)` (« dans 1 an et 4 mois », « dans 12 jours », « aujourd'hui », « il y a 3 mois »).
- [ ] `node --test test/calendrier.test.mjs`, puis `npm test`.

## Task 4 : portage connecteur et parité (Sonnet, effort medium)
**Fichiers :** `supabase/functions/mcp/calendrier.ts` (nouveau : portage TypeScript du moteur, fonctions pures exportées, puis `registerCalendrier`) ; `test/calendrier-mcp.test.mjs` (nouveau).

- [ ] **Tests d'abord** : parité sur tous les cas de la fixture et sur la démo (`web/src/demo-data.js`, données converties en lignes SQL comme `enSql` de `test/sante-calc.test.mjs`) : `jalons`, `a_completer`, `seuils`, `regles_indisponibles` identiques champ par champ ; `REGLES` identiques (clés, repères, textes).
- [ ] Porter `web/src/calendrier.js` en TypeScript, sans dépendance à `index.ts` (même découpage que `reglages.ts`). Entrée en snake_case de la base (`date_effet`, `source_url`, `verifie_le`, `date_fin`) convertie au début.
- [ ] `npm test`.

## Task 5 : outils MCP et conduite (Sonnet, effort medium)
**Fichiers :** `supabase/functions/mcp/calendrier.ts` (`registerCalendrier`) ; `supabase/functions/mcp/reglages.ts` (validation pure `infosEnveloppeDe`, `infosPretDe`, `donationsDe`, `avisImpotDe`, mêmes règles que 0029 ; outils `regler_infos_enveloppe`, `regler_infos_pret`, `regler_donations`, `regler_avis_impot`) ; `supabase/functions/mcp/index.ts` (enregistrement, `INSTRUCTIONS`, `get_config`, `demarrer_session`) ; `supabase/functions/mcp/routines.ts` (`demarrer_routine` revue : `echeances_3_mois`, et `CONDUITE_REVUE`) ; `test/calendrier-mcp.test.mjs`, `test/mcp.test.mjs`, `test/routines-mcp.test.mjs`.

- [ ] **Tests d'abord** :
  - validations pures : mêmes cas que la tâche 1, mêmes messages (au tutoiement, préfixés « Aucune proposition déposée : ») ;
  - `regler_infos_enveloppe` : nom aligné sur une enveloppe connue (casse, accents) ; clé `|p2` choisie seule quand les deux titulaires ont ce nom ; avertissement si aucune ligne ; aucune proposition si rien ne change ; `type` déduit du nom proposé en avertissement quand il diffère ;
  - `regler_infos_pret` : clé d'un crédit ou d'un bien de l'utilisateur ; inconnue → erreur ;
  - `regler_donations` : mode `remplacer`, id générés pour les nouvelles, avertissement pour chaque donation retirée ;
  - `calendrier` : sortie du moteur, filtres `enveloppe` et `horizon_mois` (1 à 480), `inclure_passes` (défaut : non, sauf le dernier passé de chaque enveloppe) ; ajoute `conduite` (phrases du § 6.3) et `sources` (repères utilisés) ;
  - `demarrer_session` renvoie `calendrier: { prochains (3), a_completer (nombre et 3 premiers) }` ; en échec de lecture, `null` sans lever ;
  - `demarrer_routine` (revue) renvoie `echeances_3_mois` ; `CONDUITE_REVUE` les cite ;
  - `INSTRUCTIONS` contient la règle de conduite du § 6.3 (date demandée une seule fois, documents d'abord) ; tutoiement ; aucun « conseiller ».
- [ ] Implémenter. `npm test`.

## Task 6 : store et démo (Sonnet, effort low) — après la fusion de SEC2
**Fichiers :** `web/src/store-supabase.js` (`cfgView` : 4 nouvelles clés ; repères avec `dateFin`) ; `web/src/store-demo.js` (mêmes validations que 0029 dans l'application des propositions, sur le modèle de `fusionFraisEnveloppes`) ; `web/src/demo-data.js` (foyer fictif : un PEA ouvert il y a 4 ans et 8 mois, une assurance-vie de 9 ans, une enveloppe sans date, un PEL de 2016, une donation fictive, un crédit avec `date_signature`) ; `web/src/propositions.js` (descriptions lisibles des 4 clés) ; `test/store-contract.test.mjs`, `test/propositions-ui.test.mjs`.

- [ ] Tests d'abord : contrat du store (clés présentes, défauts), démo valide pour le moteur (aucun `regles_indisponibles`), propositions lisibles (« Date d'ouverture de « PEA Exemple » : 15/06/2021 »), parité des messages d'erreur store-demo / 0029 sur 10 cas.
- [ ] Implémenter. `npm test`.

## Task 7 : interface (Sonnet, effort medium)
**Fichiers :** `web/src/aujourdhui.{js,css}` ; `web/src/comptes-view.{js,css}` ; `web/src/routine-etat.js` ou `aujourdhui.js` (élément de revue) ; `web/src/claude-prompts.js` (phrases « Compléter avec Claude ») ; `test/aujourdhui.test.mjs`, `test/comptes-view.test.mjs`, `test/ui.test.mjs`.

- [ ] Tests d'abord (fonctions pures exportées, mini-DOM) :
  - `echeances(S, today)` intègre les jalons non passés du calendrier (`source: "calendrier"`) ; la carte « Prochaine échéance » prend le plus proche ;
  - carte « Prochaines échéances » (`prochainesHtml`) : 5 jalons au plus, date, délai en mots, enveloppe, effet en une ligne, mot d'état (« bientôt », « à venir ») en plus de la couleur ; « N informations à compléter » avec « Compléter avec Claude » ; état vide honnête (« Aucune échéance connue : il manque … ») ; aucune date quand la donnée manque ;
  - boîte de réception : jalon `proche` à 30 jours ou moins → élément urgence 3 (2 si 7 jours ou moins) ;
  - fiche d'enveloppe : ligne « PEA : 5 ans dans 1 an et 4 mois » (ou « 5 ans atteints depuis le 16/06/2026 », ou « Date d'ouverture à compléter » + bouton) et seuil de versements (jauge avec texte équivalent) ;
  - revue mensuelle : « N échéances dans les 3 prochains mois » dans le contexte de l'élément de revue ;
  - panneau d'un jalon (UI.panneau) : effet, calcul (« ouverture le 15/06/2021 + 5 ans »), donnée et sa source, règle et sa source datée, « Demander à Claude » ;
  - accessibilité (spec § 5.5) : liste sémantique, vrais boutons, texte équivalent des jauges, état jamais porté par la seule couleur ;
  - export pour SIM2 : `Calendrier.calendrier(...).jalons` suffit ; aucun code SIM2 ici.
- [ ] Implémenter. Vérification visuelle en démo (Aujourd'hui, une fiche d'enveloppe, mobile 375 px, thème sombre) si l'outil est disponible.
- [ ] `npm test`, `node build.mjs`.

## Task 8 : Powens, données du prêt (Sonnet, effort medium) — après la fusion de SEC2
**Fichiers :** `supabase/functions/powens/synchro.ts` ; `test/powens-synchro.test.mjs`.

- [ ] Tests d'abord (`fetch` Powens simulé, base factice) :
  - compte `loan` avec `loan.subscription_date`, `maturity_date`, `rate`, `duration`, `total_amount`, `insurance_rate`, `next_payment_date` → `banque_comptes.pret` (seulement les champs documentés présents, nombres et dates validés, rien d'autre) et `ouverture_le = subscription_date` ;
  - `loan` absent ou champs nuls → `pret` null, `ouverture_le` null ; jamais de date inventée ;
  - compte de crédit rattaché à un crédit (`credit_id`) ou à un bien, `pret` renseigné, `infos_proposees_le` null → une proposition `config` `prets_infos` (source « Powens — <établissement> : données du prêt transmises par la banque », `le` = jour de la synchronisation), une seule fois ; `infos_proposees_le` renseigné ensuite ;
  - si `prets_infos` contient déjà la clé → aucune proposition ;
  - compte non crédit : `ouverture_le` reste null (aucun champ documenté) ; aucune proposition `enveloppes_infos` ;
  - une erreur sur un compte n'arrête pas les autres.
- [ ] Mettre à jour le commentaire « Champs Powens lus » (documentation consultée le 2026-10-14, URL de la page des comptes).
- [ ] Implémenter. `npm test`.

## Task 9 : mécanique (Haiku, effort low)
**Fichiers :** `test/tutoiement.test.mjs`, `test/lecture-seule.test.mjs` (listes de fichiers, si nécessaire) ; `/Users/stephane/Finance/docs/boussole-roadmap.md` (DAT1 : statut, commit ; idées nées du chantier).

- [ ] Ajouter les nouveaux fichiers aux listes des tests transverses (tutoiement, lecture seule, absence de « conseiller »).
- [ ] `npm test` ; rapporter seulement le résumé (`tail -5`).

## Task 10 : relecture fiscale et finale (Opus, effort high)
- [ ] Relire `web/src/calendrier.js` et `supabase/functions/mcp/calendrier.ts` contre la spec § 3 et § 11 : chaque règle, chaque date limite, chaque texte d'effet (aucune promesse, aucun produit, au tutoiement, honnête quand la donnée manque).
- [ ] Revérifier les sources marquées « changé récemment » (§ 12) à la date du jour ; mettre à jour `verifie_le` dans la migration si la valeur est confirmée.
- [ ] Relecture de code par `superpowers:code-reviewer` (Sonnet) : RLS et propositions (aucune écriture directe), validations identiques base / store démo / connecteur, absence de données réelles.

## Task 11 : intégration et déploiement (contrôleur, Sonnet, effort low)
- [ ] `npm test` (Node 22 aussi), `node build.mjs`, commit, push.
- [ ] Appliquer 0029 avec `apply_migration` (name `calendrier`) **après** 0028 ; vérifier l'empreinte md5 de `appliquer_propositions` contre le fichier.
- [ ] Déployer `mcp`, puis `powens` (entrée épinglée sur le commit, comme d'habitude).
- [ ] Contrôle Powens en sandbox (une fois) : lister les **clés** (jamais les valeurs) d'un objet compte réel par type (PEA, assurance-vie, crédit) pour confirmer qu'aucun champ de date d'ouverture n'existe hors `loan`. Noter le résultat dans la spec § 7.
- [ ] Publier le site, vérifier la CI Pages ; test de fumée : Aujourd'hui en démo, outil `calendrier` depuis Claude.
- [ ] Mettre à jour la roadmap (tâche 9).
