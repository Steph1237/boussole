# DAT1 : calendrier patrimonial

Date : 2026-10-14. Statut : spec écrite, à valider par Stéph.
- Demandé par Stéph le 2026-10-14 (roadmap privée, annexe B, sections B.1 « Les données à recueillir » et B.2 « Le calendrier »).
- Jalon : **J2 Mon foyer dans 25 ans**. DAT1 fournit les dates que SIM2 posera sur son graphique, et les données qu'OPT1 (annexe B.3, les astuces) réutilisera.
- Périmètre : les données de B.1 et le calendrier de B.2. Les astuces (B.3) sont un chantier suivant (OPT1) ; la spec prépare leurs données et leurs règles (§ 3.4), sans les afficher.
- Plan : `docs/superpowers/plans/2026-10-14-dat1-calendrier.md`.

---

## 0. Décisions en bref

1. **Toutes les données passent par des propositions**, comme `frais_enveloppes` (0026, 0027) : quatre nouvelles clés de la cible `config` (`enveloppes_infos`, `prets_infos`, `donations`, `avis_impot`), validées par `appliquer_propositions` (migration **0029**, repartie exactement de 0027). Aucune nouvelle table : les politiques restrictives de double authentification de 0028 couvrent déjà `config`, et `export_all` sort déjà `config` en entier.
2. **Les règles sont des repères sourcés et datés** (table `reperes`, 0009) : durées, âges, plafonds, abattements. Une loi de finances qui change un seuil se corrige par une ligne de `reperes`, sans code. Deux ajouts à la table : `date_fin` (dispositif temporaire) et l'unité `mois`. La logique (quelle date part de quelle donnée) est un catalogue `REGLES` dans le code, où chaque règle cite ses repères.
3. **Jamais une date sans donnée.** Une donnée manquante produit un élément « à compléter », pas une date estimée. Une date connue à l'année près produit un jalon « approché », calculé au plus tard (prudent). Un repère manquant rend la règle « indisponible » : pas de valeur de secours.
4. **Convention de date unique** : un délai en années ou en mois expire le jour de même quantième, ou le dernier jour du mois s'il n'existe pas (art. 641 du code de procédure civile : un 29 février + 5 ans donne un 28 février). Le jalon est daté du **lendemain** de cette expiration, premier jour où la durée est révolue sans discussion (exceptions motivées au § 3.2 : anniversaires d'âge et dates limites).
5. **Un moteur pur partagé** : `Calendrier.calendrier(data, today)` (`web/src/calendrier.js`, exposé en `Calc.calendrier`), porté à l'identique dans le connecteur (`supabase/functions/mcp/calendrier.ts`), parité testée sur un jeu de cas de référence relu par Opus.
6. **Powens ne transmet aucune date d'ouverture** d'enveloppe (documentation consultée le 2026-10-14, § 7). Il transmet en revanche, pour un prêt, sa date de souscription, sa date de fin, son taux et sa durée : ces champs sont gardés sur `banque_comptes` et proposés une fois dans `prets_infos`. La date d'ouverture d'un PEA ou d'une assurance-vie vient des documents de l'utilisateur, ou d'une question posée une seule fois.
7. **On ne collecte que l'utile** : aucune identité de bénéficiaire (seulement la date de la dernière revue de la clause), aucun numéro de contrat, un bénéficiaire de donation désigné par un libellé court au choix de l'utilisateur (« Enfant 1 »).

## 1. Règles d'or appliquées

| Règle (roadmap § 2) | Application dans DAT1 |
|---|---|
| 1. MCP et IA d'abord, app en lecture seule | 4 outils de proposition et 1 outil de lecture (§ 6) ; l'app n'écrit rien (test `lecture-seule`). |
| 3. Simple | Une date, un délai en mots, un effet en une ligne. Le calcul et les sources s'ouvrent au clic (« Comment c'est calculé »). |
| 5. Pas de note sans données | Pas de date sans donnée : « à compléter » à la place, avec la donnée qui manque et où la trouver. |
| 7. Questions au bon format | Import d'un document d'abord (relevé annuel, conditions particulières, avis d'impôt, offre de prêt), puis un formulaire court, et une seule fois. |
| 9. Honnête et dans les règles | Chaque jalon porte sa règle, sa source officielle et sa date de vérification. Jamais « conseiller », jamais un produit ni un établissement nommé : on parle d'enveloppes et de comportements (« un retrait n'entraîne plus la clôture »). Les effets fiscaux sont décrits, pas recommandés. |
| Tutoiement | Tous les textes. |

## 2. Données (B.1)

### 2.1 `config.enveloppes_infos`

```
{ "<clé d'enveloppe>": {
    type,                     // obligatoire, liste fermée (ci-dessous)
    titulaire,                // obligatoire : p1 | p2 (pour une assurance-vie : l'assuré, supposé être le souscripteur)
    date_ouverture?,          // AAAA-MM-JJ : date du 1er versement (PEA, assurance-vie, capitalisation), date d'ouverture (PEL, CEL)
    date_ouverture_approx?,   // AAAA ou AAAA-MM, quand l'utilisateur ne connaît que l'année ou le mois ; exclusif de date_ouverture
    date_cloture?,            // AAAA-MM-JJ : enveloppe close (plus aucun jalon futur)
    versements_cumules?,      // € ≥ 0 : versements nets cumulés (plafond du PEA, seuil de 150 000 € de l'assurance-vie)
    versements_avant_70?,     // € ≥ 0, ≤ versements_cumules : assurance-vie, primes versées avant les 70 ans de l'assuré
    beneficiaires_revus_le?,  // AAAA-MM-JJ : dernière revue de la clause bénéficiaire (aucun nom n'est gardé)
    versements?,              // pee | percol : [{ le, montant, origine: versement|abondement|participation|interessement, disponible_le? }], 120 au plus
    moins_values?,            // compte_titres : [{ annee, montant }], 15 au plus, montant > 0
    source,                   // obligatoire, 1 à 300 caractères : document consulté (« relevé annuel 2025 ») ou « déclaration de l'utilisateur »
    le                        // AAAA-MM-JJ, jamais dans le futur ; défaut : date du jour à Paris
} }
```

- **Types** : `pea`, `pea_pme`, `pea_jeune`, `assurance_vie`, `capitalisation`, `per`, `pel`, `cel`, `pee`, `percol`, `compte_titres`, `livret_a`, `ldds`, `lep`, `autre`. `type` est obligatoire dans une proposition ; à défaut d'information, le moteur le **déduit du nom** de l'enveloppe (`typeDeduit`, mêmes motifs que `pratiques.js` et `synchro.ts` : « PEA », « PEA-PME », « assurance vie », « AV », « PEL », « PEE »…) et le signale (« type déduit du nom »).
- **Clé** : le nom de l'enveloppe tel que dans `positions.envelope` (1 à 80 caractères), comme `frais_enveloppes`. Quand les deux titulaires du foyer ont chacun une enveloppe du même nom (deux « PEA »), la clé porte le titulaire : `"PEA|p1"`, `"PEA|p2"` ; la base refuse une clé `|p2` dont le `titulaire` n'est pas `p2`. L'outil MCP choisit la forme seul (§ 6.1).
- **Fusion** par clé (une enveloppe fournie remplace l'existante en entier, `null` la retire), 30 enveloppes au plus avant et après fusion : exactement le modèle de `frais_enveloppes`.
- **Contrôles** (base, store démo et connecteur, mêmes messages) : champ inconnu ; type ou titulaire hors liste ; dates réelles (`2026-02-30` refusée), jamais dans le futur, après 1950 ; `date_ouverture` et `date_ouverture_approx` ensemble ; `date_cloture` avant `date_ouverture` ; montants négatifs ou non numériques ; `versements_avant_70 > versements_cumules` ; `versements` hors `pee`/`percol` ; `moins_values` hors `compte_titres` ; `disponible_le` avant `le` du versement ; `annee` de moins-value hors [2000, année en cours].
- **Versements cumulés** : valeur relevée dans un document à sa date `le`. Le moteur ne l'incrémente pas avec les versements programmés (`config.recurring`) : il affiche « au 31/12/2025 » et laisse l'agent la mettre à jour à la revue mensuelle. Le suivi automatique des versements est hors périmètre (FOY1 et SIM1 projettent, DAT1 constate).

### 2.2 `config.prets_infos`

Le capital restant dû et la mensualité restent dans `credits` et `biens` (inchangés). Les informations du contrat de prêt, utiles au calendrier et plus tard à OPT1 (assurance emprunteur, remboursement anticipé), vont dans :

```
{ "credit:<uuid>" | "bien:<uuid>": {
    date_signature?, date_fin?,  // AAAA-MM-JJ ; date_fin > date_signature
    duree_mois?,                 // 1 à 480
    taux_pct?,                   // taux nominal annuel, 0 à 20
    assurance_taux_pct?,         // taux annuel de l'assurance emprunteur, 0 à 5
    ira_exoneration?,            // booléen : l'offre exclut les indemnités de remboursement anticipé
    source, le
} }
```

- La clé désigne une ligne de l'utilisateur (`credits.id` ou `biens.id`) : la base vérifie qu'elle existe pour `auth.uid()` (une clé d'un autre utilisateur se comporte comme une ligne inexistante). Une ligne supprimée laisse une information orpheline : le moteur l'ignore, l'outil propose de la retirer.
- Au moins un champ hors `source`/`le` est exigé. Fusion par clé, `null` retire, 50 prêts au plus.
- Raison de ne pas ajouter de colonnes à `credits` et `biens` : un seul schéma (validé comme les autres clés de `config`), aucun changement des branches `credit` et `bien` d'`appliquer_propositions`, ni d'`upsert_credits`/`upsert_biens`.

### 2.3 `config.donations`

```
[{ id, date, montant, donateur: p1|p2, lien: enfant|petit_enfant|arriere_petit_enfant|autre,
   beneficiaire,       // libellé court choisi par l'utilisateur, 1 à 40 caractères (« Enfant 1 ») : jamais un nom imposé
   nature: donation|don_argent_790g|don_logement_790a_bis, source, le }]
```

- Donations **consenties par le foyer** (celles qu'il reçoit, par exemple des grands-parents, sont hors périmètre). 100 au plus. La liste fournie remplace la liste (modèle de `recurring`), `id` uniques (1 à 64 caractères), `date` jamais dans le futur, `montant > 0`.

### 2.4 `config.avis_impot`

```
{ annee_revenus,                      // année des revenus de l'avis (ex. 2025 pour l'avis reçu en 2026), 2000 à année en cours
  rfr?,                               // revenu fiscal de référence, € ≥ 0 (droit au LEP : OPT1)
  plafonds_per?: { p1?: [{ annee, montant }], p2?: [...] },  // plafond épargne retraite non utilisé, par année du plafond (« plafond 2024 »), 6 lignes au plus
  source, le }
```

Remplacé en entier (un avis remplace le précédent). L'avis d'impôt indique, par déclarant, le plafond disponible pour l'année suivante, ventilé par année d'origine : c'est ce qui permet de dater l'expiration de la part la plus ancienne (§ 3.1, règle `per_plafond_expire`).

### 2.5 Date de naissance (lue, portée par FOY1)

Le jalon du 70ᵉ anniversaire de l'assuré exige sa date de naissance : `profiles.personnes.<p1|p2>.naissance` (`AAAA-MM-JJ`, ou `AAAA-MM` → anniversaire pris au **1er du mois**, la date la plus précoce possible, confiance `approchee` : pour une limite d'âge, la prudence est de ne jamais la croire plus lointaine qu'elle n'est). Le champ appartient à FOY1 (foyer et événements de vie). Si FOY1 n'est pas livré avant DAT1, la migration 0029 ajoute seulement son contrôle de format dans la branche `profil` (`personnes` est déjà fusionné par clé, sans liste fermée de champs) ; le formulaire de FOY1 le reprendra tel quel. La tranche d'âge actuelle (`foyer.age`) ne suffit pas et n'est jamais utilisée pour dater.

### 2.6 `banque_comptes` (Powens, § 7)

Trois colonnes nullables, écrites par la fonction `powens` seule (aucun nouveau droit de modification pour `authenticated`) :
- `ouverture_le date` : date de souscription du prêt (`loan.subscription_date`) pour un compte de type `credit` ; null pour les autres types (aucun champ documenté) ;
- `pret jsonb` : champs documentés du prêt, copiés tels quels quand ils sont présents (`subscription_date`, `maturity_date`, `start_repayment_date`, `rate`, `duration`, `total_amount`, `insurance_rate`, `next_payment_date`, `type`) ;
- `infos_proposees_le timestamptz` : proposition `prets_infos` déjà déposée pour ce compte (une seule fois, même refusée), sur le modèle de `propose_le`.

### 2.7 `reperes`

- Nouvelle colonne `date_fin date null` (contrainte `date_fin >= date_effet`) : fin d'un dispositif temporaire. Lue par `Reperes.depuisLignes` (`dateFin`). Un repère dont `date_fin` est passée reste lisible (historique) mais le moteur le signale (« dispositif terminé le … »).
- L'unité accepte `mois` en plus de `%`, `€` et `ans`.
- Les repères ajoutés sont listés au § 11.2, avec leur source vérifiée. Ils sont recopiés à l'identique dans `demo-data.js` (marqués « démo » comme les autres).

## 3. Les règles du calendrier (B.2)

### 3.1 Catalogue `REGLES`

Chaque règle : `{ cle, types, ancre, reperes, fiche, titre, effet, confiance }`. `ancre` dit de quelle donnée part la date. Les durées, âges et montants viennent des repères (colonne « Repères »). La révision des livrets n'est pas codée en dur au 1er février et au 1er août : elle part de la `date_fin` du repère du taux (fin de la période fixée par l'arrêté), ce qui suit tout changement de calendrier sans code. Seul le 31 décembre (fin de l'année civile, année des versements et des cessions) est dans le code.

Les effets ci-dessous sont les textes affichés (au tutoiement) ; `{x}` est remplacé par la valeur du repère au format français.

| Clé | Types | Ancre → date du jalon | Repères | Effet affiché | Confiance |
|---|---|---|---|---|---|
| `pea_5_ans` | `pea`, `pea_pme`, `pea_jeune` | `date_ouverture` (1er versement) + `{pea_duree_ans}` ans, lendemain | `pea_duree_ans` | « Un retrait partiel ne clôture plus le plan et tu peux continuer à verser. Les gains sont exonérés d'impôt sur le revenu ; les prélèvements sociaux restent dus. Avant cette date, un retrait clôture le plan, sauf cas prévus par la loi (licenciement, invalidité, mise à la retraite anticipée…). » | `sure` ou `approchee` |
| `av_8_ans` | `assurance_vie`, `capitalisation` | `date_ouverture` (1er versement) + `{av_duree_ans}` ans, lendemain | `av_duree_ans`, `av_abattement_seul`, `av_abattement_couple`, `av_seuil_versements` | « Les gains retirés bénéficient chaque année d'un abattement de {av_abattement_seul} ({av_abattement_couple} pour un couple soumis à imposition commune), tous contrats confondus. Au-delà, ils sont taxés à un taux réduit tant que tes versements nets restent sous {av_seuil_versements}. Les prélèvements sociaux restent dus. » | `sure` ou `approchee` |
| `av_70_ans` | `assurance_vie` (pas `capitalisation`) | naissance de l'assuré (`titulaire`) + `{av_age_seuil}` ans : **le jour de l'anniversaire** (les versements « après 70 ans » commencent ce jour-là) | `av_age_seuil`, `av_990i_abattement`, `av_757b_abattement` | « Les versements faits avant cette date relèvent, à ton décès, d'un abattement de {av_990i_abattement} par bénéficiaire. Ceux faits ensuite relèvent d'un abattement global de {av_757b_abattement}, tous contrats et bénéficiaires confondus. » | `sure` (naissance au jour) ou `approchee` (au mois) |
| `pel_2_ans` | `pel` | `date_ouverture` + `{pel_retrait_min_ans}` ans, lendemain | `pel_retrait_min_ans` | « Avant cette date, un retrait clôture le PEL : ses intérêts sont recalculés au taux du CEL et tu perds le droit au prêt. » | `sure` ou `approchee` |
| `pel_4_ans` | `pel` | `date_ouverture` + `{pel_duree_min_ans}` ans, lendemain | `pel_duree_min_ans`, `pel_duree_max_ans` | « Durée minimale du plan atteinte. Il peut être prolongé jusqu'à {pel_duree_max_ans}. » | idem |
| `pel_10_ans` | `pel` ouvert **depuis le 2011-03-01** | `date_ouverture` + `{pel_duree_max_ans}` ans, lendemain | `pel_duree_max_ans` | « Fin des versements : le plan ne reçoit plus d'argent, ses intérêts continuent de courir pendant 5 ans au plus. » | idem |
| `pel_15_ans` | `pel` ouvert depuis le 2011-03-01 | `date_ouverture` + `{pel_duree_vie_ans}` ans, lendemain | `pel_duree_vie_ans` | « Le plan devient un livret d'épargne ordinaire : son taux et sa fiscalité changent. » | idem |
| `pel_12_ans` | `pel` ouvert **avant le 2018-01-01** | `date_ouverture` + `{pel_exoneration_ir_ans}` ans, lendemain | `pel_exoneration_ir_ans` | « Les intérêts acquis à partir de cette date sont soumis à l'impôt sur le revenu (ceux des 12 premières années en sont exonérés ; les prélèvements sociaux restent dus). » | idem |
| `pee_disponible` | `pee` | chaque versement : `disponible_le` du relevé (`sure`), sinon `le` + `{pee_blocage_ans}` ans, lendemain (`approchee`, « au plus tôt ») ; les versements de même date sont regroupés | `pee_blocage_ans` | « {montant} deviennent disponibles sans motif. » Sans date du relevé : « au plus tôt le … : le règlement du plan peut fixer une date plus tardive, ton relevé l'indique. » | `sure` ou `approchee` |
| `per_70_ans` | `per` | naissance du titulaire + `{per_age_fin_deduction}` ans, le jour de l'anniversaire | `per_age_fin_deduction` | « À partir de cette date, tes versements sur un PER ne sont plus déductibles de ton revenu imposable. » | `sure` ou `approchee` |
| `per_plafond_expire` | foyer (`avis_impot.plafonds_per`) | pour chaque part non utilisée du plafond de l'année `annee` (année des versements à laquelle ce plafond se rapporte, « plafond 2024 ») : 31 décembre de l'année `annee + report`, avec report = `{per_report_ans_ancien}` pour un plafond jusqu'à 2025 (`date_fin` du repère : 2025-12-31), `{per_report_ans}` à partir du plafond 2026. Exemples de la source : plafond 2024 utilisable jusqu'en 2027 ; plafond 2026 pendant 5 ans | `per_report_ans`, `per_report_ans_ancien` | « Dernier jour pour verser sur un PER en utilisant ce reste de plafond ({montant}) ; il ne peut plus servir ensuite. » | `sure` |
| `per_fin_annee` | foyer qui a au moins un `per`, sans avis d'impôt | 31 décembre de l'année en cours | `per_report_ans` | « Les versements déductibles comptent pour l'année où ils sont faits. Ton plafond disponible est sur ton avis d'impôt. » + `a_completer` `avis_impot` | `sure` |
| `av_abattement_annee` | `assurance_vie`, `capitalisation` dont `av_8_ans` est passé | 31 décembre de l'année en cours | `av_abattement_seul`, `av_abattement_couple` | « L'abattement sur les gains retirés est annuel : celui de cette année ne se reporte pas sur la suivante. » | `sure` |
| `donation_15_ans` | foyer (`donations`, natures `donation` et `don_argent_790g`) | `date` + `{donation_rappel_ans}` ans, lendemain | `donation_rappel_ans`, `donation_abattement_enfant` (lien `enfant`), `don_familial_argent` (nature `don_argent_790g`) | Lien `enfant` : « La donation du … à {beneficiaire} n'est plus rappelée : l'abattement de {donation_abattement_enfant} entre ce parent et cet enfant est de nouveau entier. » Nature `don_argent_790g` : « Le don familial de sommes d'argent ({don_familial_argent}) est de nouveau possible entre vous, si les conditions d'âge sont remplies. » Autres liens : texte général sans montant. | `sure` |
| `mv_expire` | `compte_titres` (`moins_values`) | 31 décembre de `annee + {mv_report_ans}` (dernier jour, pas de lendemain) | `mv_report_ans` | « Dernier jour pour imputer la moins-value de {annee} ({montant}) sur des plus-values de même nature ; elle est perdue ensuite. » | `sure` |
| `taux_reglementes` | foyer qui détient un `livret_a`, `ldds` ou `lep` (type déclaré ou déduit) | lendemain de `date_fin` du repère `livret_a_taux` (Livret A et LDDS) ou `lep_taux` (LEP) ; rien si `date_fin` est absente | `livret_a_taux`, `lep_taux` | « Fin de la période du taux actuel ({livret_a_taux}) : un nouveau taux peut s'appliquer à partir de cette date. » | `sure` |
| `pret_fin` | prêt (`prets_infos`) | `date_fin` (`sure`), sinon `date_signature` + `duree_mois` mois (`calculee`) ; rien sinon (`a_completer`) | aucun : règle contractuelle, la source est l'offre de prêt (`donnee.source`) | « Dernière échéance du prêt : sa mensualité ({mensualite}) se libère ensuite. » | `sure` ou `calculee` |

**Seuils** (pas des dates : `seuils`, affichés sur la fiche) :
- `pea_plafond` : `pea` → `{pea_plafond}` ; `pea_jeune` → `{pea_jeune_plafond}` ; `pea_pme` → `{pea_pme_plafond_global}` moins les versements du PEA du même titulaire (le plafond global porte sur la somme des deux plans).
- `av_seuil_versements` : somme des `versements_cumules` des contrats `assurance_vie`/`capitalisation` du même titulaire → `{av_seuil_versements}`. Affiché « à titre indicatif » : le seuil porte sur les primes nettes de tous les contrats, à la date du rachat.

**Écartés après vérification** :
- *Anniversaire du prêt* : depuis la loi Lemoine (2022), l'assurance emprunteur se change **à tout moment** ; l'anniversaire n'a plus d'effet particulier. Il ne serait qu'un bruit dans le calendrier. L'information va à OPT1 (astuce 9).
- *Fin du dispositif temporaire de dons pour un logement neuf ou une rénovation énergétique* (art. 790 A bis, jusqu'au 31/12/2026) : ce n'est pas une échéance d'une donnée du foyer. Le repère est créé (avec `date_fin`) pour OPT1 (astuce 14).
- *PERCOL* : bloqué jusqu'à la retraite sauf cas prévus ; aucune date sans l'âge de départ (FOY1, SIM1).
- *PEA jeune à la fin du rattachement* : la règle (plafond porté au plafond normal) n'a pas pu être vérifiée sur une page officielle ; pas de jalon (§ 12).

### 3.2 Conventions de calcul

- **Durée en années ou en mois** : `ajouterAns(d, n)` / `ajouterMois(d, n)` au même quantième, ou au dernier jour du mois s'il n'existe pas (art. 641 CPC). Le jalon est au **lendemain** (`lendemain`) : « 5 ans révolus le 16/06/2026 » pour un premier versement du 15/06/2021. Trois exceptions, écrites dans la règle : les anniversaires d'âge (`av_70_ans`, `per_70_ans`) sont datés du jour de l'anniversaire, parce que la règle change ce jour-là ; les dates limites (`mv_expire`, `per_plafond_expire`, 31 décembre) sont datées du **dernier jour** utile ; la révision des livrets, du lendemain de la fin de période.
- **Date approchée** : toujours la date prudente. Pour une durée à attendre (`date_ouverture_approx`), la plus tardive possible (31/12 de l'année, ou dernier jour du mois), puis la même règle : texte « au plus tard le … », l'utilisateur n'agit jamais trop tôt. Pour une limite d'âge (naissance au mois), la plus précoce (1er du mois) : texte « dès le … », il n'agit jamais trop tard. Confiance `approchee` dans les deux cas.
- **Calendrier en UTC** pour les écarts en jours (aucune dérive d'heure d'été). `today` est la date de Paris (`RoutineEtat.aujParis()` dans l'app, `Intl` Europe/Paris dans le connecteur).
- **Statut** : `passe` (date < aujourd'hui), `proche` (0 à 92 jours, soit les 3 prochains mois), `futur`. `jours` = écart signé.
- **Horizon** : 40 ans par défaut (`horizonAns`), pour couvrir les 25 ans de SIM2 et les 70 ans d'un titulaire jeune. Jalons récurrents (livrets, 31 décembre, anniversaire du prêt) : seulement la prochaine occurrence.
- **Enveloppe close** : `date_cloture` renseignée, ou toutes les lignes de l'enveloppe `clôturé` (confiance `calculee`, « enveloppe sans ligne active ») : les jalons passés avant la clôture restent, plus aucun jalon futur ni « à compléter ».
- **Confiance** : `sure` (date d'un document ou déclarée exacte), `approchee` (année ou mois seulement ; date de naissance au mois ; disponibilité d'épargne salariale sans date du relevé), `calculee` (dérivée d'une autre donnée : fin de prêt = signature + durée).
- **Donnée d'origine** : chaque jalon garde `donnee: { champ, source, le }` (« date_ouverture · relevé annuel 2025 · 12/02/2026 »), affichée dans « Comment c'est calculé ».

### 3.3 Ce que le moteur ne fait jamais

- Dater à partir de la date de découverte d'un compte par Powens (`disabled`), de la première opération synchronisée ou de la première photo : ce ne sont pas des dates d'ouverture.
- Utiliser une valeur de secours quand un repère manque.
- Recommander une action : l'effet est décrit (« les gains retirés bénéficient de l'abattement annuel »), la décision reste à l'utilisateur et passe, le cas échéant, par OPT1 et le Copilote.
- Montrer un jalon fiscal pour une enveloppe d'un type inconnu (`autre`).

### 3.4 Préparation d'OPT1

`REGLES` et les repères servent aussi aux astuces : une astuce d'OPT1 sera une condition sur la sortie du calendrier (jalon `av_8_ans` passé → astuce « purger les plus-values » ; `per_plafond_expire` proche → astuce « plafond PER non utilisé » ; `pea_5_ans` futur et pas d'assurance-vie → astuce « prendre date »), plus un gain estimé. Les champs `rfr`, `ira_exoneration`, `assurance_taux_pct`, `beneficiaires_revus_le`, `lien` des donations et les repères `don_logement_*`, `ira_*`, `assurance_emprunteur_sans_questionnaire`, `ps_taux_*`, `lep_rfr_1_part`, `per_plafond_*` ne servent pas au calendrier : ils sont recueillis maintenant pour qu'OPT1 n'ait pas à reposer les questions.

## 4. Le moteur `Calendrier.calendrier(data, today, options)`

- **Module** : `web/src/calendrier.js`, UMD (global `Calendrier`, `module.exports` sous Node), pur, sans DOM ; dépend de `Reperes` (injecté ou global). `Calc.calendrier` délègue (même fonction). Ajouté à `SCRIPTS` de `build.mjs` après `reperes`.
- **Entrée** : `data = { positions, config, profil, credits, biens, reperes }`, formes de l'app (`S.positions`, `S.config`, `S.profil`, `S.profil.credits`/`S.biens` selon le store, `S.savoir.reperes`) ; le connecteur convertit ses lignes SQL avant l'appel. `today` = `AAAA-MM-JJ`.
- **Étapes** :
  1. Enveloppes : l'union des clés de `enveloppes_infos` et des enveloppes des lignes non clôturées (`positions.envelope` + `owner`). Pour chacune : type (déclaré, sinon déduit), titulaire, état (ouverte ou close).
  2. Pour chaque règle applicable au type : repères requis présents ? Sinon `regles_indisponibles`. Donnée d'ancre présente ? Sinon `a_completer` (une seule entrée par enveloppe et par champ). Sinon, jalon(s).
  3. Règles du foyer (31 décembre, livrets, donations, prêts, moins-values) sur les mêmes principes.
  4. Seuils (plafond du PEA, plafond global PEA + PEA-PME par titulaire, seuil de 150 000 € de l'assurance-vie) : `{ verse, plafond, reste }` quand `versements_cumules` est connu ; sinon rien (pas d'« à compléter » séparé : la donnée est demandée avec la date d'ouverture).
  5. Tri (date, puis `cle`, puis enveloppe), `prochains` (3 premiers non passés), `dans_3_mois` (statut `proche`).
- **Sortie** : voir le plan (« Contrats communs › Moteur ») ; mêmes noms côté app et connecteur.
- **Textes** : `titre` court (« PEA Exemple : 5 ans révolus »), `effet` en une phrase au tutoiement (§ 3.1), `texteDelai(jours)` (« dans 1 an et 4 mois », « dans 12 jours », « aujourd'hui », « depuis 3 mois »). Les montants des repères sont insérés dans le texte au format français, avec la date d'effet du repère.
- **Repère à revérifier** : un repère vérifié il y a plus de 180 jours (`Reperes.aVerifier`) est utilisé, mais le jalon le signale (« chiffre vérifié le … ») ; c'est le signal pour la veille (AG1).

## 5. Interface

### 5.1 Aujourd'hui

- **Carte « Prochaine échéance »** (bandeau existant) : alimentée aussi par le calendrier (`echeances(S, today)` reçoit les jalons non passés, `source: "calendrier"`). Le panneau de la carte liste les 3 suivantes.
- **Nouvelle carte « Prochaines échéances »** sous le bandeau : 5 jalons au plus, non passés, triés par date. Chaque ligne : date (« 16 juin 2026 »), délai en mots, enveloppe, effet en une ligne, mot d'état (« bientôt » pour `proche`, « à venir ») et pastille de couleur. Clic → panneau du jalon (§ 5.4). En pied : « 3 informations à compléter » → panneau listant les `a_completer`, chacune avec son bouton « Compléter avec Claude » (phrase prête : « Boussole : je veux compléter la date d'ouverture de mon PEA Exemple. Lis-la dans le document que je te donne, sinon demande-la-moi. »). État vide honnête : « Aucune échéance connue pour l'instant. Il manque la date d'ouverture de 2 enveloppes. »
- **Boîte de réception** : un jalon `proche` à 30 jours ou moins devient un élément (urgence 3 ; 2 à 7 jours ou moins), comme les échéances actuelles. Aucun élément pour un jalon passé.

### 5.2 Fiche d'enveloppe (Patrimoine › Comptes)

- Sous l'en-tête, une ligne par jalon de l'enveloppe : « PEA : 5 ans dans 1 an et 4 mois (16/02/2028) », « Assurance-vie : 8 ans révolus depuis le 02/03/2026 », ou « Date d'ouverture à compléter » + « Compléter avec Claude ». Un jalon approché le dit (« au plus tard le … », « dès le … », « au plus tôt le … »).
- Seuil de versements, quand il est connu : jauge horizontale avec texte équivalent (« 92 000 € versés sur 150 000 €, il reste 58 000 € »), date de la donnée.
- Lien « Voir le calendrier » vers la carte d'Aujourd'hui (`#aujourdhui?echeances=1`, ouvre le panneau complet).

### 5.3 Revue mensuelle (RT1)

- `demarrer_routine` (revue) renvoie `echeances_3_mois` (jalons `proche`) et `a_completer` ; `CONDUITE_REVUE` demande de les citer en une phrase chacune et de proposer de compléter une seule donnée par revue.
- Dans l'app, l'élément « Revue mensuelle » de la boîte ajoute au contexte « 2 échéances dans les 3 prochains mois ».

### 5.4 Panneau d'un jalon (UI.panneau)

Dans l'ordre : l'effet (une phrase) ; « Comment c'est calculé » (« premier versement le 15/06/2021 + 5 ans → 15/06/2026, révolus le 16/06/2026 ») ; la donnée et sa source (« relevé annuel 2025, relevé le 12/02/2026 ») ; la règle, sa source officielle cliquable et sa date de vérification ; la confiance en mots (« date exacte », « au plus tard », « calculée ») ; « Demander à Claude » (expertise `fiscalite-enveloppes`). Mention fixe : « Information générale sur la règle, pas une recommandation. Vérifie auprès de ton établissement avant une opération proche de la date. »

### 5.5 Accessibilité (mêmes exigences que CP4 § 4)

- Liste sémantique (`<ol>` ordonnée par date), dates dans `<time datetime>`.
- Vrais boutons pour chaque ligne et « Compléter avec Claude » ; focus visible ; panneau fermable au clavier (Échap), focus rendu à la ligne.
- Jauges avec texte équivalent ; contrastes AA en clair comme en sombre.
- L'état n'est jamais porté par la seule couleur : un mot l'accompagne (« bientôt », « à venir », « passé », « à compléter », « approché »).
- Mobile (375 px) : la carte passe en une colonne, l'effet sous la date.

### 5.6 SIM2

SIM2 lit `Calendrier.calendrier(data, today, { horizonAns }).jalons` et pose sur sa frise les jalons non passés (date, titre court, confiance). DAT1 ne dessine rien dans SIM2.

### 5.7 Propositions

`propositions.js` décrit les nouvelles clés en clair : « Date d'ouverture de « PEA Exemple » : 15/06/2021 (relevé annuel 2025) », « Donation à Enfant 1 du 01/07/2015 : 20 000 € », « Prêt « Crédit auto » : fin le 30/04/2029 ». Le store démo applique les mêmes contrôles que 0029 (modèle de `fusionFraisEnveloppes`).

## 6. Connecteur MCP

### 6.1 Outils

- **`calendrier`** (lecture, RO) : `{ horizon_mois? (1 à 480, défaut 480), enveloppe?, inclure_passes? }` → sortie du moteur (passés exclus par défaut, sauf le dernier de chaque enveloppe, qui dit « 5 ans révolus depuis »), plus `sources` (repères utilisés : clé, libellé, valeur, unité, URL, vérifié le) et `conduite` (§ 6.3).
- **`regler_infos_enveloppe`** (RW) : propose `enveloppes_infos` pour une enveloppe. Nom aligné sur une enveloppe connue (casse et accents, comme `regler_frais_enveloppe`) ; clé `|p1`/`|p2` choisie quand deux titulaires ont ce nom ; avertissement si aucune ligne ne porte ce nom, ou si le `type` proposé diffère du type déduit du nom ; aucune proposition si rien ne change. Fusion : les champs non fournis d'une enveloppe déjà renseignée sont **repris** de la valeur actuelle (l'outil envoie l'objet complet, la base remplace).
- **`regler_infos_pret`** (RW) : `prets_infos` pour un crédit ou un bien (`list` via `get_overview`) ; clé inconnue → erreur.
- **`regler_donations`** (RW) : liste complète, mode `remplacer` (modèle de `regler_versements`), avertissement pour chaque donation retirée.
- **`regler_avis_impot`** (RW) : `avis_impot` en entier, à partir de l'avis que l'utilisateur donne.
- `get_config` renvoie les 4 nouvelles clés ; `demarrer_session` renvoie `calendrier: { prochains, a_completer: { nombre, premiers } }` (null en cas d'échec de lecture, sans lever).
- Validations pures exportées dans `reglages.ts` (`infosEnveloppeDe`, `infosPretDe`, `donationsDe`, `avisImpotDe`), mêmes règles et messages que 0029.

### 6.2 Les documents qui portent les données

| Donnée | Document à demander d'abord |
|---|---|
| Date du 1er versement d'un PEA | Relevé annuel du PEA, ou attestation d'ouverture |
| Date d'effet d'une assurance-vie, versements cumulés, avant 70 ans | Conditions particulières, relevé annuel d'information |
| Date d'ouverture d'un PEL | Contrat ou relevé annuel du PEL |
| Versements et disponibilités de l'épargne salariale | Relevé de l'épargne salariale (il indique la date de disponibilité de chaque avoir) |
| Plafond épargne retraite, revenu fiscal de référence | Avis d'impôt (rubrique « plafond épargne retraite ») |
| Date de signature, durée, taux, assurance d'un prêt | Offre de prêt, tableau d'amortissement |
| Moins-values reportables | Déclaration de revenus (2074) ou avis d'impôt, IFU |

### 6.3 Conduite (ajoutée aux `INSTRUCTIONS` et renvoyée par `calendrier`)

1. « Une date qui fait courir un délai fiscal se lit dans un document : demande d'abord le document (§ 6.2) et relève la date avec sa source. Sans document, pose la question **une seule fois** ; si l'utilisateur ne sait pas, propose l'année seule (`date_ouverture_approx`), et mémorise (`memoriser`) qu'il ne faut pas reposer la question. »
2. « N'invente jamais une date, ne la déduis jamais de la synchronisation bancaire ni de la première opération connue. »
3. « Pour une assurance-vie, la date qui compte est celle du premier versement (souvent la date d'effet des conditions particulières) ; l'âge qui compte est celui de l'assuré. »
4. « Décris l'effet d'une échéance, jamais une recommandation de produit. Quand une opération est envisagée près d'une date, invite à la confirmer auprès de l'établissement ; pour une donation ou une succession, rappelle que l'avis d'un notaire est utile. »
5. « À la revue mensuelle, cite les échéances des 3 prochains mois et propose de compléter **une** donnée manquante, pas toutes. »

## 7. Powens

**Constat** (documentation consultée le 2026-10-14) :
- L'objet compte (`https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts`) n'a **aucun champ de date d'ouverture**. Ses seules dates sont `last_update`, `deleted` et `disabled` ; `disabled` vaut la date de **découverte** du compte par Powens, pas son ouverture. Les placements (`investments`) n'ont pas non plus de date de premier versement (`vdate` est une date de valorisation). Aucun type de compte (PEA, assurance-vie, PER, livrets, PEE) ne fait exception.
- L'objet prêt imbriqué (`loan`, même page) documente, tous nullables : `subscription_date`, `maturity_date`, `start_repayment_date`, `rate`, `duration` (mois), `total_amount`, `insurance_rate`, `insurance_amount`, `next_payment_date`, `nb_payments_left`, `type` (`mortgage`, `consumercredit`, `revolvingcredit`, `loan`). Aucune garantie de remplissage par banque n'est donnée : on traite chaque champ comme facultatif.
- Constat annexe : `synchro.ts` lit `loan.remaining_capital`, qui n'existe pas dans l'objet `loan` documenté (le capital restant dû n'est documenté que dans les tableaux d'amortissement, ressource à faire activer par Powens). En pratique, le repli sur le solde du compte est ce qui fonctionne. À traiter dans un FIX séparé, hors DAT1.

**Conception** :
- `synchro.ts` (fonction pure `pretDe(compte)`) copie les champs documentés présents de `loan` dans `banque_comptes.pret` (dates `AAAA-MM-JJ` réelles, nombres finis, rien d'autre) et `subscription_date` dans `ouverture_le`. Les autres types gardent `ouverture_le` null.
- Propagation : pour un compte `credit` rattaché à un crédit (`credit_id`) ou à un bien (rattachement BQ1), avec `pret` renseigné, sans `infos_proposees_le`, et sans clé déjà présente dans `prets_infos`, la synchronisation dépose **une** proposition `config` `prets_infos` (`date_signature` ← `subscription_date`, `date_fin` ← `maturity_date`, `duree_mois` ← `duration`, `taux_pct` ← `rate`, `assurance_taux_pct` ← `insurance_rate` × 100 si la documentation donne un ratio de 0 à 1) ; source « Powens — <établissement> : données du prêt transmises par la banque », `le` = jour de la synchronisation ; puis `infos_proposees_le`. L'utilisateur valide, corrige ou refuse comme toute proposition.
- Enveloppes : aucune propagation vers `enveloppes_infos` tant que Powens ne documente pas de date d'ouverture. La colonne `ouverture_le` est générique : si un champ documenté apparaît, la propagation suivra le même modèle (proposition unique, source Powens, confiance `sure`), dans un chantier dédié.
- Contrôle au déploiement (plan, tâche 11) : lister une fois les **clés** (jamais les valeurs) d'un compte réel par type en sandbox, pour confirmer l'absence de champ non documenté.

## 8. Migration 0029 (`0029_calendrier.sql`)

- `config` : `enveloppes_infos jsonb not null default '{}'`, `prets_infos jsonb not null default '{}'`, `donations jsonb not null default '[]'`, `avis_impot jsonb not null default '{}'`, avec contraintes `jsonb_typeof` nommées.
- `reperes` : `date_fin`, unité `mois` ; inserts des repères du § 11.2 (`on conflict (cle) do update`).
- `banque_comptes` : `ouverture_le`, `pret`, `infos_proposees_le` ; aucun `grant update` nouveau.
- `appliquer_propositions` : **repartir exactement de 0027** ; ajouter les 4 clés à la cible `config` (blocs sur le modèle du bloc `frais_enveloppes`), et le contrôle de `naissance` dans la branche `profil`. Tout le reste inchangé (tout ou rien, `security invoker`, `search_path = ''`, mêmes messages, mêmes droits).
- Ordre : après 0028 (MFA), avant le déploiement de `mcp` et `powens`. Aucune nouvelle table : les politiques restrictives de 0028 s'appliquent déjà à `config` et `banque_comptes`, et `test/mfa-pglite.test.mjs` reste vert.

## 9. Tests

- **Calculs purs** (`test/calendrier.test.mjs`, cas de référence `test/fixtures/calendrier-cas.json` relus par Opus) : chaque règle du § 3.1 ; 29 février (ouverture, naissance) ; donnée manquante → `a_completer` et aucune date ; date approchée → au plus tard ; titulaire qui a 70 ans aujourd'hui, l'an prochain, ou qui les a passés ; assurance-vie sans date de naissance ; contrat de capitalisation (pas de jalon 70 ans) ; PEA clos (date de clôture ; toutes lignes clôturées) ; PEA + PEA-PME (plafond global) ; PEL de chaque génération ; PEE avec et sans date de disponibilité du relevé ; donations ; moins-values de l'année limite ; plafond PER ; livrets détenus ou non ; prêts (date de fin, signature + durée, rien) ; deux titulaires avec le même nom d'enveloppe ; repère manquant → règle indisponible ; repère à revérifier ; statut aux bornes (0, 92, 93, −1 jour) ; horizon ; pureté (entrée non modifiée) ; textes au tutoiement, sans « conseiller » ni produit.
- **Parité** (`test/calendrier-mcp.test.mjs`) : moteur de l'app et portage du connecteur identiques champ par champ sur toute la fixture et sur la démo.
- **Migration** (`test/calendrier-pglite.test.mjs`, PGlite) : défauts et contraintes, chaque contrôle d'`appliquer_propositions` (§ 2), tout ou rien, RLS, clés `prets_infos` d'un autre utilisateur refusées, `reperes.date_fin` et unité `mois`, colonnes de `banque_comptes` non modifiables par `authenticated`, diff de la fonction contre 0027 limité aux ajouts, MFA toujours en place.
- **Interface** (`test/aujourdhui.test.mjs`, `test/comptes-view.test.mjs`) : carte, boîte, fiche, revue, panneau, état vide, accessibilité (§ 5.5), démo, mobile.
- **MCP** (`test/calendrier-mcp.test.mjs`, `test/mcp.test.mjs`, `test/routines-mcp.test.mjs`) : 5 outils, annotations, validations et messages, alignement des noms, clés `|p1`/`|p2`, `demarrer_session`, `demarrer_routine`, conduite dans `INSTRUCTIONS`, tutoiement.
- **Powens** (`test/powens-synchro.test.mjs`) : `pretDe`, proposition unique, aucune date pour les autres types, erreur isolée.
- **Repères** (`test/reperes.test.mjs`) : chaque repère cité par `REGLES` existe, avec une source d'un domaine officiel et une date de vérification.

## 10. Hors périmètre

- Les astuces et leurs gains (OPT1) ; les événements de vie et la date de naissance comme donnée recueillie (FOY1) ; le graphique (SIM2).
- Les donations reçues ; la succession ; le suivi automatique des versements cumulés.
- Le correctif `loan.remaining_capital` (§ 7, constat annexe).
- Des rappels envoyés hors de l'app (courriel, notification) : Boussole n'envoie rien ; la revue mensuelle et Aujourd'hui suffisent.

## 11. Sources vérifiées

### 11.1 Règles et montants

Toutes les pages ont été consultées le **2026-10-14**. « Date de la page » = mention « Vérifié le » ou version du texte. Statut : **V** vérifié sur la page officielle ; **CR** changé récemment (vérifié) ; **NV** non vérifié sur une page officielle (voir § 12). Pendant la vérification, impots.gouv.fr était en maintenance, amf-france.org injoignable et economie.gouv.fr refusait l'accès : les pages de service-public, le BOFiP et Légifrance ont servi de sources principales.

| Règle | Valeur retenue | Source | Date de la page | Statut |
|---|---|---|---|---|
| Calcul des délais en mois et en années (quantième, dernier jour du mois) | 29/02 + 5 ans → 28/02 | Code de procédure civile, art. 641 — https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006411002 | en vigueur depuis 1976 | V |
| PEA : date d'ouverture = 1er versement | — | https://www.service-public.gouv.fr/particuliers/vosdroits/F2385 | 22/05/2026 | V |
| PEA : retrait avant 5 ans → clôture, sauf licenciement, invalidité, mise à la retraite anticipée (titulaire, conjoint, partenaire), titres d'une société en liquidation, création ou reprise d'entreprise (réinvestissement sous 3 mois, versements alors fermés) ; après 5 ans, seul un retrait total clôture ; gains exonérés d'IR, prélèvements sociaux dus | 5 ans | https://www.service-public.gouv.fr/particuliers/vosdroits/F22449 | 15/04/2026 | V |
| PEA : un transfert intégral entre établissements n'est pas un retrait ; la date d'ouverture est transmise | — | BOFiP BOI-RPPM-RCM-40-50-60, § 1 et § 10 — https://bofip.impots.gouv.fr/bofip/2275-PGP.html/identifiant=BOI-RPPM-RCM-40-50-60-20240730 | 30/07/2024 | V |
| Plafond PEA ; PEA PME-ETI ; cumul des deux par titulaire | 150 000 € ; 225 000 € ; 225 000 € | https://www.service-public.gouv.fr/particuliers/vosdroits/F2385 | 22/05/2026 | V |
| PEA d'un majeur rattaché au foyer fiscal de ses parents (« PEA jeune ») ; non compté dans le plafond des parents ; PEA PME-ETI fermé pendant le rattachement | 20 000 € | F2385 ; BOFiP BOI-RPPM-RCM-40-50-20-10, I § 20 — https://bofip.impots.gouv.fr/bofip/1552-PGP.html/identifiant=BOI-RPPM-RCM-40-50-20-10-20240730 | 22/05/2026 ; 30/07/2024 | V |
| Assurance-vie : durée comptée du 1er versement (contrats souscrits depuis le 01/01/1990) ; un contrat transformé garde la date du 1er versement du contrat d'origine | 8 ans | BOFiP BOI-RPPM-RCM-30-10-20-20 — https://bofip.impots.gouv.fr/bofip/9312-PGP.html/identifiant=BOI-RPPM-RCM-30-10-20-20-20220630 | 30/06/2022 (version lue par recherche ; version en vigueur à confirmer, tâche 0) | V (à reconfirmer) |
| Assurance-vie après 8 ans : abattement annuel sur les gains, tous contrats ; 7,5 % sous 150 000 € de primes nettes, 12,8 % au-delà ; avant 8 ans 12,8 % ; prélèvements sociaux toujours dus | 4 600 € / 9 200 € ; 150 000 € | https://www.service-public.gouv.fr/particuliers/vosdroits/F22414 | 15/04/2026 | V |
| Art. 990 I CGI : primes versées avant 70 ans, abattement par bénéficiaire (puis 20 % jusqu'à 700 000 €, 31,25 % au-delà) | 152 500 € | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288653 | version du 11/03/2023 | V |
| Art. 757 B CGI : primes versées après 70 ans, abattement global par assuré, tous contrats | 30 500 € | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288569 | version du 11/03/2023 | V (le texte parle des primes ; l'exonération des gains : NV) |
| PEL : 4 ans minimum, prolongeable jusqu'à 10 ans ; ouvert avant le 01/03/2011 : sans limite de durée ; ouvert depuis le 01/03/2011 : 15 ans au plus (intérêts 5 ans après les 10 ans, puis livret ordinaire) ; depuis 2018 : plus de prime d'État ; retrait avant 2 ans : clôture, intérêts au taux du CEL, plus de droit à prêt ; plafond 61 200 € | 2, 4, 10, 15 ans | https://www.service-public.gouv.fr/particuliers/vosdroits/F16140 (cohérent avec https://www.banque-france.fr/fr/a-votre-service/particuliers/connaitre-pratiques-bancaires-assurance/epargne/epargne-logement) | 09/10/2026 | V |
| PEL ouvert avant 2018 : intérêts des 12 premières années exonérés d'IR | 12 ans | F16140 | 09/10/2026 | V |
| Taux du PEL ouvert en 2026 (fixé à l'ouverture ; 1,75 % pour 2025) | 2,00 % | Avis du 20/12/2025 (NOR ECOT2532149V) — https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053095350 ; https://www.service-public.gouv.fr/particuliers/actualites/A16217 | 20/12/2025 ; 23/12/2025 | CR |
| PEE : sommes bloquées au moins 5 ans, à compter de l'acquisition des titres (délai **minimum** : le règlement du plan peut prévoir plus) | 5 ans | Code du travail, art. L3332-25 — https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042340834 ; https://www.service-public.gouv.fr/particuliers/vosdroits/F2142 | version du 01/01/2021 ; 01/01/2026 | V |
| PEE : 14 cas de déblocage anticipé (mariage ou PACS, 3ᵉ enfant, divorce avec garde, violences conjugales, invalidité, décès, rupture du contrat de travail, création ou reprise d'entreprise, résidence principale, catastrophe naturelle, rénovation énergétique, surendettement, proche aidant, véhicule propre ou vélo à assistance neufs) ; demande dans les 6 mois, sauf rupture, décès, invalidité, violences, surendettement, proche aidant | — | https://www.service-public.gouv.fr/particuliers/vosdroits/F31622 | 12/10/2026 | V (pour OPT1) |
| Donation parent → enfant : abattement par parent et par enfant, rappel fiscal | 100 000 € ; 15 ans | https://www.service-public.gouv.fr/particuliers/vosdroits/F14203 | 13/05/2026 | V |
| Don familial de sommes d'argent (art. 790 G) : donateur de moins de 80 ans, bénéficiaire majeur ou émancipé, cumulable avec l'abattement de parenté, renouvelable tous les 15 ans, déclaration dans le mois | 31 865 € | https://www.service-public.gouv.fr/particuliers/vosdroits/F36656 | 01/01/2026 | V |
| Dons pour un logement neuf ou une rénovation énergétique de la résidence principale (art. 790 A bis, loi n° 2025-127 du 14/02/2025, art. 71) : par donateur et par donataire ; fonds utilisés au plus tard le dernier jour du 6ᵉ mois ; conservation 5 ans | 100 000 € par donateur, 300 000 € par donataire ; du 15/02/2025 au 31/12/2026 | F36656 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043662329 | 01/01/2026 | CR (V) |
| Moins-values sur valeurs mobilières : imputables sur les plus-values de même nature de l'année et des 10 années suivantes | 10 ans | https://www.service-public.gouv.fr/particuliers/vosdroits/F21618 | 15/04/2026 | V |
| PER : plafond 2026 (10 % des revenus d'activité nets 2025) ; plancher ; mutualisable pour un couple marié ou pacsé | 37 680 € ; 4 710 € | https://www.service-public.gouv.fr/particuliers/vosdroits/F14709 | 15/04/2026 | V |
| PER : report du plafond non utilisé porté de 3 à 5 ans à partir du plafond 2026 (loi n° 2026-103 du 19/02/2026 de finances pour 2026, art. 10) ; plafonds 2024 et 2025 : 3 ans | 5 ans (3 ans avant 2026) | F14709 ; BOFiP ACTU-2026-00106 — https://bofip.impots.gouv.fr/bofip/15111-PGP.html/ACTU-2026-00106 ; https://www.service-public.gouv.fr/particuliers/actualites/A18841 | 15/04/2026 ; 10/08/2026 ; 29/04/2026 | **CR** |
| PER : plus de déduction des versements à partir de 70 ans (LF 2026, art. 9) | 70 ans | F14709 ; ACTU-2026-00106 | 15/04/2026 | **CR** |
| Livret A et LDDS ; LEP (maintenu) : taux du 01/08/2026 au 31/01/2027 (arrêté du 28/07/2026) ; plafonds | 1,7 % ; 2,5 % ; 22 950 €, 12 000 €, 10 000 € | https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054541376 ; https://www.service-public.gouv.fr/particuliers/vosdroits/F2365 ; F2368 ; F2367 ; https://www.service-public.gouv.fr/particuliers/actualites/A18000 | 28/07/2026 ; 01/08/2026 | CR (V) |
| Révision semestrielle des taux réglementés (formule de la Banque de France) | tous les 6 mois | A18000 | 31/07/2026 | V (dates du 1er février et du 1er août déduites des périodes de l'arrêté) |
| Prélèvements sociaux sur les revenus du capital (LFSS 2026, loi n° 2025-1403 du 30/12/2025, art. 12) : cas général (dont PEA et compte-titres ; PER d'après A18841, périmètre non précisé) ; assurance-vie, PEL, CEL ; livrets réglementés exonérés | 18,6 % ; 17,2 % ; 0 % | https://www.service-public.gouv.fr/particuliers/vosdroits/F2329 ; https://www.service-public.gouv.fr/particuliers/vosdroits/F34913 ; https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053226384 | 30/06/2026 ; 15/04/2026 | **CR** (conflit avec des sites non officiels, § 12) |
| Indemnités de remboursement anticipé d'un crédit immobilier : au plus 6 mois d'intérêts sur le capital remboursé au taux moyen, et au plus 3 % du capital restant dû ; aucune en cas de vente consécutive à un changement de lieu de travail, au décès ou à la cessation forcée d'activité (emprunteur ou conjoint) | 6 mois ; 3 % | https://www.service-public.gouv.fr/particuliers/vosdroits/F1669 ; Code de la consommation R313-25 — https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032807570/ ; L313-48 — https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032222295/ | 16/09/2026 | V (pour OPT1) |
| Assurance emprunteur : changement à tout moment (offres depuis le 01/06/2022, contrats en cours depuis le 01/09/2022), équivalence des garanties, refus motivé, avenant sous 10 jours ouvrés ; pas de questionnaire de santé si la part assurée ≤ 200 000 € par assuré et fin du crédit avant ses 60 ans | 200 000 € ; 60 ans | Loi n° 2022-270 du 28/02/2022 — https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000045268729 ; https://www.service-public.gouv.fr/particuliers/vosdroits/F1671 | 20/05/2025 | V (pour OPT1 ; « sans frais » : NV) |
| Powens : aucun champ de date d'ouverture sur les comptes ni les placements ; champs du prêt (`loan`) | voir § 7 | https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts ; …/bank-account-types ; …/investments | consultée le 14/10/2026 | V |

### 11.2 Repères à ajouter (migration 0029)

`verifie_le` = **2026-10-14** pour toutes les lignes. **Règle pour `date_effet`** : date de la version en vigueur du texte cité, ou début du régime décrit par la page (« PEL ouverts depuis le 1er mars 2011 ») ; jamais une date supposée. Les lignes marquées † ont une `date_effet` à confirmer en tâche 0 (l'historique du dispositif n'a pas été vérifié ; la **valeur**, elle, l'est). Les repères existants de 0010 (`pea_plafond`, `av_abattement_seul`, `av_abattement_couple`, `livret_a_plafond`, `ldds_plafond`, `lep_plafond`, `pfu_taux`) sont réutilisés tels quels, sauf les deux mises à jour en fin de table.

| Clé | Libellé | Valeur | Unité | Date d'effet | Date de fin | Source (titre) | URL |
|---|---|---|---|---|---|---|---|
| `pea_duree_ans` | Durée après laquelle un retrait ne clôture plus le PEA | 5 | ans | 2019-05-24 † | — | Service-public — PEA : retraits et clôture | https://www.service-public.gouv.fr/particuliers/vosdroits/F22449 |
| `pea_pme_plafond_global` | Plafond cumulé PEA + PEA PME-ETI par titulaire | 225000 | € | 2019-05-24 † | — | Service-public — Plan d'épargne en actions (PEA) | https://www.service-public.gouv.fr/particuliers/vosdroits/F2385 |
| `pea_jeune_plafond` | Plafond du PEA d'un majeur rattaché au foyer de ses parents | 20000 | € | 2019-05-24 † | — | Service-public — PEA | https://www.service-public.gouv.fr/particuliers/vosdroits/F2385 |
| `av_duree_ans` | Durée d'un contrat d'assurance-vie ouvrant l'abattement annuel | 8 | ans | 1990-01-01 | — | BOFiP — BOI-RPPM-RCM-30-10-20-20 (durée du contrat) | https://bofip.impots.gouv.fr/bofip/9312-PGP.html/identifiant=BOI-RPPM-RCM-30-10-20-20-20220630 |
| `av_seuil_versements` | Seuil de primes nettes pour le taux réduit de l'assurance-vie après 8 ans | 150000 | € | 2017-09-27 | — | Service-public — Fiscalité de l'assurance-vie | https://www.service-public.gouv.fr/particuliers/vosdroits/F22414 |
| `av_age_seuil` | Âge de l'assuré qui sépare les régimes 990 I et 757 B | 70 | ans | 2023-03-11 | — | Légifrance — CGI art. 757 B | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288569 |
| `av_990i_abattement` | Abattement par bénéficiaire, primes versées avant 70 ans (art. 990 I) | 152500 | € | 2023-03-11 | — | Légifrance — CGI art. 990 I | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288653 |
| `av_757b_abattement` | Abattement global, primes versées après 70 ans (art. 757 B) | 30500 | € | 2023-03-11 | — | Légifrance — CGI art. 757 B | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288569 |
| `pel_retrait_min_ans` | Durée en dessous de laquelle un retrait du PEL le clôture avec intérêts au taux du CEL | 2 | ans | 2018-01-01 † | — | Service-public — Plan d'épargne logement (PEL) | https://www.service-public.gouv.fr/particuliers/vosdroits/F16140 |
| `pel_duree_min_ans` | Durée minimale du PEL | 4 | ans | 2018-01-01 † | — | Service-public — PEL | https://www.service-public.gouv.fr/particuliers/vosdroits/F16140 |
| `pel_duree_max_ans` | Durée maximale de versement du PEL | 10 | ans | 2011-03-01 | — | Service-public — PEL | https://www.service-public.gouv.fr/particuliers/vosdroits/F16140 |
| `pel_duree_vie_ans` | Durée au terme de laquelle un PEL ouvert depuis le 1er mars 2011 devient un livret ordinaire | 15 | ans | 2011-03-01 | — | Service-public — PEL | https://www.service-public.gouv.fr/particuliers/vosdroits/F16140 |
| `pel_exoneration_ir_ans` | Années d'intérêts exonérés d'impôt sur le revenu, PEL ouvert avant 2018 | 12 | ans | 2018-01-01 † | — | Service-public — PEL | https://www.service-public.gouv.fr/particuliers/vosdroits/F16140 |
| `pel_taux_ouverture` | Taux du PEL ouvert en 2026 (fixé à l'ouverture) | 2 | % | 2026-01-01 | 2026-12-31 | Légifrance — avis du 20 décembre 2025 relatif au taux du PEL | https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053095350 |
| `pee_blocage_ans` | Durée minimale de blocage d'un versement sur un PEE | 5 | ans | 2021-01-01 | — | Légifrance — Code du travail art. L3332-25 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042340834 |
| `donation_rappel_ans` | Délai de rappel fiscal des donations | 15 | ans | 2012-08-17 † | — | Service-public — Donation : abattements | https://www.service-public.gouv.fr/particuliers/vosdroits/F14203 |
| `donation_abattement_enfant` | Abattement par parent et par enfant sur une donation | 100000 | € | 2012-08-17 † | — | Service-public — Donation : abattements | https://www.service-public.gouv.fr/particuliers/vosdroits/F14203 |
| `don_familial_argent` | Don familial de sommes d'argent (art. 790 G), par donateur et par bénéficiaire | 31865 | € | 2011-01-01 † | — | Service-public — Don familial de sommes d'argent | https://www.service-public.gouv.fr/particuliers/vosdroits/F36656 |
| `don_logement_donateur` | Dons pour un logement neuf ou une rénovation énergétique : plafond par donateur et par donataire (art. 790 A bis) | 100000 | € | 2025-02-15 | 2026-12-31 | Service-public — Don familial de sommes d'argent | https://www.service-public.gouv.fr/particuliers/vosdroits/F36656 |
| `don_logement_donataire` | Dons pour un logement neuf ou une rénovation énergétique : plafond par donataire (art. 790 A bis) | 300000 | € | 2025-02-15 | 2026-12-31 | Légifrance — CGI art. 790 A bis | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043662329 |
| `mv_report_ans` | Années de report des moins-values sur valeurs mobilières | 10 | ans | 2014-01-01 † | — | Service-public — Plus-values sur valeurs mobilières | https://www.service-public.gouv.fr/particuliers/vosdroits/F21618 |
| `per_report_ans` | Années de report du plafond épargne retraite non utilisé (plafonds depuis 2026) | 5 | ans | 2026-01-01 | — | BOFiP — ACTU-2026-00106 (loi de finances pour 2026, art. 10) | https://bofip.impots.gouv.fr/bofip/15111-PGP.html/ACTU-2026-00106 |
| `per_report_ans_ancien` | Années de report du plafond épargne retraite non utilisé (plafonds jusqu'à 2025) | 3 | ans | 2019-10-01 † | 2025-12-31 | Service-public — Plafond de déduction de l'épargne retraite | https://www.service-public.gouv.fr/particuliers/vosdroits/F14709 |
| `per_age_fin_deduction` | Âge à partir duquel les versements sur un PER ne sont plus déductibles | 70 | ans | 2026-01-01 | — | Service-public — Plafond de déduction de l'épargne retraite | https://www.service-public.gouv.fr/particuliers/vosdroits/F14709 |
| `per_plafond_plancher` | Plafond minimal de déduction épargne retraite (2026) | 4710 | € | 2026-01-01 | 2026-12-31 | Service-public — Plafond de déduction de l'épargne retraite | https://www.service-public.gouv.fr/particuliers/vosdroits/F14709 |
| `per_plafond_max` | Plafond maximal de déduction épargne retraite d'un salarié (2026) | 37680 | € | 2026-01-01 | 2026-12-31 | Service-public — Plafond de déduction de l'épargne retraite | https://www.service-public.gouv.fr/particuliers/vosdroits/F14709 |
| `ps_taux_general` | Prélèvements sociaux sur les revenus du capital, cas général | 18.6 | % | 2026-01-01 | — | Service-public — Prélèvements sociaux sur les revenus du capital | https://www.service-public.gouv.fr/particuliers/vosdroits/F2329 |
| `ps_taux_av_epargne_logement` | Prélèvements sociaux sur l'assurance-vie, le PEL et le CEL | 17.2 | % | 2018-01-01 | — | Service-public — Prélèvements sociaux sur les revenus du capital | https://www.service-public.gouv.fr/particuliers/vosdroits/F2329 |
| `lep_rfr_1_part` | Revenu fiscal de référence maximal pour un LEP, 1 part (métropole, 2026) | 23028 | € | 2026-01-01 | 2026-12-31 | Service-public — Livret d'épargne populaire (LEP) | https://www.service-public.gouv.fr/particuliers/vosdroits/F2367 |
| `ira_plafond_mois` | Plafond des indemnités de remboursement anticipé : mois d'intérêts | 6 | mois | 2016-07-01 † | — | Légifrance — Code de la consommation R313-25 | https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032807570/ |
| `ira_plafond_pct` | Plafond des indemnités de remboursement anticipé : part du capital restant dû | 3 | % | 2016-07-01 † | — | Légifrance — Code de la consommation R313-25 | https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032807570/ |
| `assurance_emprunteur_sans_questionnaire` | Part assurée par assuré en dessous de laquelle aucun questionnaire de santé n'est demandé (fin du crédit avant 60 ans) | 200000 | € | 2022-06-01 | — | Légifrance — loi n° 2022-270 du 28 février 2022 | https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000045268729 |
| **mise à jour** `livret_a_taux` | Taux du Livret A (et du LDDS) | 1.7 | % | 2026-08-01 | **2027-01-31** | Légifrance — arrêté du 28 juillet 2026 relatif aux taux d'intérêt des produits d'épargne réglementée | https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054541376 |
| **mise à jour** `lep_taux` | Taux du LEP | 2.5 | % | 2026-08-01 | **2027-01-31** | Légifrance — arrêté du 28 juillet 2026 | https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054541376 |

`livret_a_taux` et `lep_taux` avaient en 0010 une `date_effet` du 2026-08-01 (Livret A) et du 2026-02-01 (LEP) et une source economie.gouv.fr ; ils passent à la source Légifrance (l'arrêté), qui porte la période. `lep_taux.date_effet` devient 2026-08-01 (taux maintenu par le même arrêté).

## 12. Changé récemment, conflits et points non vérifiés

### 12.1 Changé récemment (à surveiller par la veille)

1. **PER, loi de finances pour 2026** (loi n° 2026-103 du 19/02/2026) : report du plafond non utilisé porté de **3 à 5 ans** à partir du plafond 2026 (art. 10), et **fin de la déduction à 70 ans** dès le 01/01/2026 (art. 9). La roadmap (annexe B.3, astuce 5) dit encore « sur 3 ans » : à corriger dans la roadmap au moment de la livraison.
2. **Prélèvements sociaux, LFSS 2026** (loi n° 2025-1403 du 30/12/2025, art. 12) : **18,6 %** dans le cas général depuis le 01/01/2026 (dont PEA et compte-titres), mais **17,2 %** maintenus pour l'assurance-vie, le PEL et le CEL d'après service-public (F2329, 30/06/2026). Plusieurs sites non officiels annoncent 18,6 % pour l'assurance-vie ou le PEL : **conflit**, l'officiel est retenu. Conséquence hors DAT1 : le repère existant `pfu_taux` (31,4 %) ne vaut pas pour l'assurance-vie ni le PEL (30 %) ; vérifier ses usages actuels (`pratiques.js`, `analyser.ts`) dans un correctif séparé.
3. **PEL ouvert en 2026** : taux de **2,00 %** (1,75 % en 2025).
4. **Livrets** : Livret A et LDDS à 1,7 %, LEP à 2,5 % du 01/08/2026 au 31/01/2027. La page de la Banque de France sur la rémunération des livrets affichait encore, le 2026-10-14, les taux du 1er février 2026 (Livret A 1,5 %) : page non rafraîchie, l'arrêté et service-public sont retenus.
5. **Dons pour un logement neuf ou une rénovation énergétique** (art. 790 A bis) : dispositif créé par la LF 2025, **jusqu'au 31/12/2026**. Le projet de loi de finances pour 2027 (déposé le 01/10/2026) contiendrait des changements sur les dons familiaux : non adopté et non vérifié sur le texte ; rien n'en est repris.
6. **PEE** : une proposition de loi de déblocage exceptionnel (5 000 €) est en cours d'examen à l'Assemblée nationale au 2026-10-14 ; **non adoptée**, rien n'en est repris.

### 12.2 Non vérifié sur une page officielle (à lever en tâche 0)

1. **Assurance-vie, art. 757 B** : l'exonération des **gains** des primes versées après 70 ans (seules les primes sont taxées au-delà de 30 500 €) n'a été vue que dans un résultat de recherche du BOFiP (BOI-ENR-DMTG-10-10-20-20). L'effet affiché de `av_70_ans` n'en parle donc pas.
2. **Assurance-vie** : que l'abattement de 4 600 / 9 200 € ne s'applique pas aux prélèvements sociaux (vu dans un résultat de recherche impots.gouv.fr, site en maintenance). L'effet de `av_8_ans` dit seulement « les prélèvements sociaux restent dus », ce qui est vérifié.
3. **Durée du contrat d'assurance-vie** : la version du BOFiP lue (30/06/2022) dit que la durée court du premier versement ; confirmer la version en vigueur.
4. **PEE** : la convention « disponible le 1er jour du 7ᵉ mois de la 5ᵉ année » souvent citée n'a été trouvée sur aucune page officielle. D'où la conception : date de disponibilité **lue sur le relevé**, sinon minimum légal « au plus tôt ».
5. **PEL ouvert avant le 01/03/2011** : « sans limite de durée » est vérifié ; l'arrêt des versements à 10 ans pour ces plans ne l'est pas. Pas de jalon `pel_10_ans` pour eux tant que ce n'est pas confirmé.
6. **Avis d'impôt** : la correspondance exacte entre les lignes de l'avis (« plafond non utilisé des revenus 2023, 2024, 2025 », « plafond pour les cotisations versées en 2026 ») et le champ `annee` de `plafonds_per` est à confirmer sur un avis réel (données masquées), avant d'écrire la consigne de lecture dans l'outil `regler_avis_impot`.
7. **31 décembre, PER** : que la déduction porte sur les versements de l'année civile est implicite sur F14709 (« cotisations versées en 2026 »), pas écrit comme une date limite.
8. **Dates de révision des livrets (1er février, 1er août)** : déduites des périodes de l'arrêté, aucune page ne les énonce. La conception ne les code pas en dur (`date_fin` du repère).
9. **PEA d'un majeur rattaché** : passage au plafond normal à la fin du rattachement, vu dans un résultat de recherche seulement. Pas de jalon.
10. **Assurance emprunteur** : « sans frais » pour le changement d'assureur, pas de citation officielle trouvée (sert à OPT1 seulement).
11. **PEA** : le taux global de 31,4 % (12,8 % + 18,6 %) en cas de retrait avant 5 ans n'a pu être lu que dans un résultat de recherche impots.gouv.fr (le 12,8 % est vérifié sur F22449, le 18,6 % sur F2329).
12. **Dates d'effet marquées †** au § 11.2 : historique non vérifié (les valeurs le sont).

### 12.3 Sources inaccessibles pendant la vérification

impots.gouv.fr (maintenance), amf-france.org (indisponible), economie.gouv.fr (accès refusé). Les repères de 0010 qui citent impots.gouv.fr (`av_abattement_*`, `pfu_taux`) n'ont pas été relus aujourd'hui ; leurs valeurs sont cohérentes avec F22414 et F2329.
