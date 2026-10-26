# SCN : « Investir dans un bien locatif ou en SCPI ? » (scénario n° 20, `locatif_scpi`)

Date : 2026-10-26. Statut : **proposé** (à relire par Stéph). Complète la spec SCN1 (`2026-10-17-scn1-scenarios-design.md`) : même contrat de module (§ 6), même sortie (§ 6.7), même interface (§ 10). Toutes les données d'exemple sont fictives.

## 0. Décisions en bref

1. **La question** : « Investir dans un bien locatif ou en SCPI ? » (thème Immobilier, numéro 20 : hors des numéros réservés J.2 des lots 1 à 4, à renuméroter si J.2 lui en donne un).
2. **À effort égal** : chaque option reçoit, chaque mois, le même argent de ta poche. Le locatif fixe cet effort (apport le jour de l'achat, puis ce que coûtent chaque mois crédit, charges et impôts moins les loyers). Les SCPI au comptant reçoivent exactement ces versements. Quand une option demande moins qu'une autre un mois donné, la différence est placée sur un livret, des deux côtés de la même façon (§ 3.5). On compare le **patrimoine net** à la sortie : revente ou retrait, crédit soldé, impôts de sortie payés, livret compris, en euros d'aujourd'hui, avec la bande P10–P90.
3. **Mêmes tirages que le moteur PROJ** : le prix du bien suit la classe `immobilier_physique` (inflation + `immo_revalorisation_reelle`, volatilité `immo_volatilite`), le prix des parts de SCPI suit la classe `immobilier` (volatilité de `Marche`) ; corrélation 0,5 entre les deux (matrice du moteur). Loyers, charges, crédit et impôts sur les revenus du bien sont déterministes ; la distribution des SCPI suit la valeur des parts.
4. **Options** : **L** le bien locatif (régime fiscal choisi parmi 4) ; **S** SCPI en direct au comptant ; **AV** SCPI dans une assurance-vie ; **SC** SCPI en direct à crédit (seulement si la personne le demande). Aucune n'est « ce que tu fais aujourd'hui » : l'option en tête est comparée à la deuxième.
5. **Fiscalité 2026** : revenus fonciers au TMI + 17,2 % (`ps_taux_foncier`) ; meublé non professionnel (BIC) au TMI + 18,6 % (`ps_taux_general`, hausse de CSG de la LFSS 2026) ; plus-values immobilières 19 % + 17,2 % avec les abattements pour durée de détention (`ProjectionFiscalite.abattementIR/PS`) ; **réintégration des amortissements** du meublé au réel dans la plus-value pour les cessions depuis le 15/02/2025 (LF 2025, art. 84) ; assurance-vie par `ProjectionFiscalite` (règle déjà testée).
6. **Rien n'est retenable en variante** en V1 : `enveloppe_scenario` ne porte ni un bien ni des parts de SCPI. Le texte le dit et renvoie vers Claude (événement `achat_immobilier` d'usage `locatif`).

## 1. Pertinence

`{ "un_de": [{ "capacite_min": 200 }, { "surplus_matelas": true }], "age_min": 18 }` : une capacité d'épargne d'au moins 200 €/mois ou un surplus de précaution. L'enjeu de la carte reste « à calculer » tant que le bien n'est pas décrit (prix, loyer, apport : questions obligatoires sans préremplissage). Le scénario n'entre donc dans « Pour toi » qu'après une partie jouée.

## 2. Questions (préremplies quand Boussole sait, jamais par le LLM)

| id | type | défaut / prérempli | obligatoire |
|---|---|---|---|
| `prix` | montant_eur (20 000 à 3 000 000) | — | oui |
| `neuf` | booleen | non | oui |
| `travaux` | montant_eur (0 à 1 000 000) | 0 | non |
| `mobilier` | montant_eur (0 à 100 000) | 0 (meublé : à renseigner) | non |
| `apport` | montant_eur (0 à 3 000 000) | — | oui |
| `duree_credit_ans` | entier (5 à 25) | 20 | oui |
| `taux_credit_pct` | pourcentage (0 à 10) | repère `taux_credit_immo_15/20/25` le plus proche de la durée | oui |
| `loyer_mensuel` | montant_eur (50 à 20 000) | — | oui |
| `vacance_mois` | entier (0 à 6) | `scn_locatif_vacance_mois` (1, convention) | oui |
| `charges_annuelles` | montant_eur (0 à 50 000) | — (taxe foncière, copropriété non récupérable, assurance, entretien) | oui |
| `gestion_pct` | pourcentage (0 à 15) | 0 | non |
| `regime` | choix `lmnp_reel`, `lmnp_micro`, `nu_reel`, `nu_micro` | `lmnp_reel` | oui |
| `horizon_ans` | entier (3 à 30) | 20 (convention : l'objectif le plus proche n'a pas de rapport avec un investissement immobilier) | oui |
| `tmi` | choix 0, 11, 30, 41, 45 | TMI du foyer | oui |
| `scpi_frais_souscription_pct` | pourcentage (0 à 15) | `scn_scpi_frais_souscription_pct` (10, convention) | oui |
| `scpi_taux_distribution_pct` | pourcentage (0 à 12) | `scpi_taux_distribution` | oui |
| `scpi_prix_part_pct` | pourcentage (−5 à 5) | `rendement_central_immobilier` − `scpi_taux_distribution` | oui |
| `scpi_reinvestir` | booleen | oui | oui |
| `frais_av_pct` | pourcentage (0 à 3) | frais UC de l'assurance-vie renseignés, sinon 0 (dit) | non |
| `scpi_credit` | booleen | non | non |

## 3. Formules (mois `t` = 1..T, achat et souscription à `t = 0`, flux en fin de mois)

### 3.1 Achat et crédit
- Frais d'acquisition `FA = prix × frais_acquisition_ancien_pct` (ou `_neuf_pct`).
- Coût `K = prix + FA + travaux + mobilier`. Besoin `B = max(0, K − apport)`. Capital emprunté `C = (B + frais_dossier) / (1 − garantie_pct)` (garantie sur le capital, frais de dossier financés) ; `C = 0` si `B = 0` ; apport utilisé `A0 = min(apport, K)`.
- Crédit : `ProjectionCredit.amortissement({ capital: C, taux_pct, duree_mois, assurance_pct: assurance_emprunteur_defaut_pct })` (échéance constante, assurance sur le capital initial). `CRD_t`, intérêts `I_t`, assurance `Ass_t`.

### 3.2 Exploitation (déterministe)
- Année de détention `y = ⌈t/12⌉`. Loyer `Lo_t = loyer × (1 + π)^(y−1) × (12 − vacance)/12` (révision annuelle à l'inflation supposée, convention : IRL ≈ inflation).
- Charges `Ch_t = charges_annuelles/12 × (1 + π)^(y−1)` ; gestion `G_t = gestion_pct × Lo_t`.

### 3.3 Impôt sur les revenus du bien, par année de détention `y` (versé par douzièmes dans l'année : prélèvement à la source, convention dite)
Recettes `R_y = Σ Lo_t`, charges `D_y = Σ (Ch_t + G_t)`, intérêts et assurance `J_y = Σ (I_t + Ass_t)`, frais d'emprunt `E_1 = frais_dossier + garantie` (année 1).
- **`nu_micro`** : si `R_y ≤ micro_foncier_plafond`, base `R_y × (1 − micro_foncier_abattement_pct)` ; sinon régime réel (dit). Impôt `base × (TMI + ps_taux_foncier)`.
- **`lmnp_micro`** : si `R_y ≤ micro_bic_plafond`, base `R_y × (1 − micro_bic_abattement_pct)` ; sinon réel (dit). Impôt `base × (TMI + ps_taux_general)`.
- **`nu_reel`** : résultat `r = R_y − D_y − J_y − (y = 1 ? travaux + E_1 : 0)` (travaux d'entretien ou d'amélioration déductibles : hypothèse dite ; le mobilier n'a pas de sens en location nue et n'est pas compté). Si `r ≥ 0` : imputation des déficits reportés (premier entré, premier sorti, 10 ans, `deficit_foncier_report_ans`), impôt `reste × (TMI + ps_taux_foncier)`. Si `r < 0` : la part hors intérêts `h = max(0, −(R_y − D_y − (y = 1 ? travaux : 0)))` s'impute sur le revenu global jusqu'à `deficit_foncier_plafond` (économie `min(h, plafond) × TMI`, impôt négatif, sans prélèvements sociaux) ; le reste du déficit est reporté 10 ans.
- **`lmnp_reel`** : résultat avant amortissement `r = R_y − D_y − J_y − (y = 1 ? FA + E_1 : 0)` (frais d'acquisition passés en charge la 1ʳᵉ année). Si `r < 0` : déficit reporté 10 ans (`deficit_bic_report_ans`). Sinon : déficits reportés d'abord, puis amortissements, **sans jamais créer de déficit** ; l'amortissement non déduit est reporté sans limite de durée. Dotations annuelles : bâti `prix × (1 − scn_lmnp_part_terrain_pct) / scn_lmnp_duree_bati_ans`, travaux `travaux / scn_lmnp_duree_travaux_ans`, mobilier `mobilier / scn_lmnp_duree_mobilier_ans`. Ordre d'imputation dans l'année : bâti, puis travaux, puis mobilier, stock reporté dans le même ordre (convention dite). Impôt `base × (TMI + ps_taux_general)`.
- Le **cash-flow** du mois : `CF_t = Lo_t − Ch_t − G_t − échéance_t − Ass_t − Impôt_y/12`. Effort `max(0, −CF_t)` ; surplus `max(0, CF_t)` placé sur le livret de l'option L.

### 3.4 SCPI
- Prix de part `Pr_t = Pr_{t−1} × exp(a_p + s × z_{t,immobilier})`, `a_p = ln(1 + scpi_prix_part_pct)/12`, `s = σ_immobilier/√12` (0 en déterministe), `Pr_0 = 1`.
- Une souscription de `X` au mois `u` achète `X / Pr_u` parts ; valeur de retrait `parts × Pr_t × (1 − frais_souscription)` (convention PROJ : la valeur d'une ligne est sa valeur de retrait). Les parts touchent la distribution à partir du mois `u + scn_scpi_delai_jouissance_mois + 1`.
- Distribution du mois : `Dist_t = parts_jouissantes × Pr_{t−1} × taux_distribution / 12` (taux publié, net des frais de gestion de la société).
- **S (direct)** : distribution imposée au TMI + `ps_taux_foncier` (revenus fonciers au réel, aucune charge : la société les a déjà déduites ; part de revenus étrangers non distinguée, ce qui pénalise un peu la SCPI : dit). Net réinvesti en parts si `scpi_reinvestir` (avec les frais de souscription), sinon placé sur le livret de l'option.
- **AV** : mêmes parts dans l'assurance-vie ; distribution réinvestie sans frais d'entrée ; frais de gestion `frais_av_pct` prélevés chaque mois sur la valeur ; impôt de sortie par `ProjectionFiscalite` (assurance-vie ouverte au mois 0, base = versements) ; frais d'entrée = `scpi_frais_souscription_pct` (souvent plus bas en assurance-vie : dit).
- **SC (à crédit)** : capital `C` (le même que le locatif, mêmes taux et durée), apport `A0` ; tout est souscrit au mois 0 ; intérêts et assurance déductibles de la distribution (réel ; déficit reporté 10 ans, aucune imputation sur le revenu global : il ne vient que d'intérêts) ; distribution nette non réinvestie, elle rembourse l'échéance ; l'effort suit.
- Plus-value de sortie (direct et crédit) : par souscription, gain `parts × Pr_T × (1 − fs) − X` (souvent négatif : aucun impôt), impôt `19 % × (1 − abattIR(ans)) + 17,2 % × (1 − abattPS(ans))` avec les années pleines depuis la souscription (régime des plus-values immobilières, `confiance: probable`, mention `MENTION_SCPI` du moteur).

### 3.5 Effort égal et livret
- Effort mensuel `e_o(t)` de chaque option ; budget `b(t) = max_o e_o(t)` (S et AV au comptant reçoivent `e_L(t)` : leur effort est égal par construction). Le livret de l'option `o` reçoit chaque mois `b(t) − e_o(t)` + ses surplus ; il rapporte `livret_a_taux` jusqu'à sa date de fin puis `rendement_central_monetaire` (règle du socle § 6.2), sans impôt.
- Au mois 0, toutes les options reçoivent `A0`.

### 3.6 Sortie au mois `T`
- **L** : valeur `V_T = prix × Π g_t` (classe `immobilier_physique` ; les travaux ne sont pas ajoutés à la valeur : prudent, dit) ; net de revente `V_T × (1 − scn_immo_frais_revente_pct)` ; plus-value : prix de cession net − prix d'acquisition majoré `prix + max(FA réels, 7,5 % × prix) + (détention > 5 ans ? max(travaux non déduits, 15 % × prix) : travaux non déduits)` + amortissements de bâti et de travaux déduits (meublé au réel, cession depuis le 15/02/2025) ; en `lmnp_reel` les frais d'acquisition passés en charge ne sont pas recomptés : seul le forfait de 7,5 % reste. Impôt avec abattements pour durée de détention (années pleines) ; surtaxe au-delà de `pv_immo_surtaxe_seuil` signalée, non calculée. Patrimoine net = net de revente − `CRD_T` − impôt + livret.
- **S** : valeur de retrait − impôt de plus-value + livret. **AV** : valeur − impôt de l'assurance-vie + livret. **SC** : valeur de retrait − `CRD_T` − impôt + livret.
- Tout en euros d'aujourd'hui `÷ (1 + π)^(T/12)`.

### 3.7 Sorties
- `reponse` : option en tête (P50), comparée à la deuxième : écart chemin par chemin (P10, P50, P90), écart annuel `÷ H`, probabilité de faire mieux, date de bascule (premier anniversaire à partir duquel la médiane de l'écart reste positive).
- `options[]` : net (bande), versé (somme du budget), impôts (revenus + sortie, P50), frais (frais d'acquisition, de souscription, de gestion, garantie : P50), TRI médian (`detail.tri`, taux annuel qui égalise le budget versé et le patrimoine net médian, en courants).
- `detail.patrimoine.points` : chaque anniversaire, patrimoine net de chaque option (bande), pour le graphique.
- `ce_qui_changerait` : (1) **revalorisation réelle du bien** à partir de laquelle l'ordre L contre la meilleure SCPI s'inverse (dichotomie sur `immo_revalorisation_reelle` entre −3 et +3 %/an) ; (2) **taux de distribution** des SCPI qui inverse l'ordre (0 à 10 %) ; (3) **horizon** : date de bascule ; (4) **vacance** : mois de vacance par an au-delà desquels le locatif passe derrière (0 à 6) ; seuils sur les mêmes tirages.
- `avertissements` : frais d'assurance-vie non renseignés, micro au-delà du plafond, surtaxe, SCPI (part étrangère, régime à confirmer), travaux non revalorisés, imputation du déficit foncier conditionnée à la location jusqu'au 31 décembre de la 3ᵉ année, exception des résidences de services pour la réintégration des amortissements.

## 4. Repères nouveaux

| Clé | Valeur | Statut | Source |
|---|---|---|---|
| `micro_foncier_plafond` | 15 000 € | V | impots.gouv.fr, « Location vide de meubles », modifiée le 07/04/2026 |
| `micro_foncier_abattement_pct` | 30 % | V | idem |
| `deficit_foncier_plafond` | 10 700 € | V | idem |
| `deficit_foncier_report_ans` | 10 ans | V | idem |
| `micro_bic_plafond` | 77 700 € | V (revenus 2025) | impots.gouv.fr, FAQ « Régime des locations meublées », 03/2026 |
| `micro_bic_abattement_pct` | 50 % | V (revenus 2025) | idem |
| `deficit_bic_report_ans` | 10 ans | V | idem |
| `scn_lmnp_part_terrain_pct` | 15 % | CONV | Convention Boussole |
| `scn_lmnp_duree_bati_ans` | 30 ans | CONV | Convention Boussole |
| `scn_lmnp_duree_travaux_ans` | 10 ans | CONV | Convention Boussole |
| `scn_lmnp_duree_mobilier_ans` | 7 ans | CONV | Convention Boussole |
| `scn_locatif_vacance_mois` | 1 mois/an | CONV | Convention Boussole |
| `scn_immo_frais_revente_pct` | 5 % | CONV | Convention Boussole |
| `scn_scpi_frais_souscription_pct` | 10 % | CONV | Convention Boussole |
| `scn_scpi_delai_jouissance_mois` | 4 mois | CONV | Convention Boussole |

Règles sans valeur, datées : réintégration des amortissements (LF 2025, loi n° 2025-127, art. 84 ; impots.gouv.fr, page du 10/07/2026 ; exception des résidences de services étudiants et seniors) ; non-création de déficit par l'amortissement (CGI art. 39 C) ; condition de location jusqu'au 31/12 de la 3ᵉ année (impots.gouv.fr).

## 5. Cas chiffrés (déterministes, `test/fixtures/scenarios-cas.json`, préfixe `LOC-`)

Recalculés par un script indépendant (`scripts/verif/locatif-scpi-verif.py`, sans le module) : LOC-1 (meublé au réel, 20 ans), LOC-2 (même bien, micro-foncier), LOC-3 (location nue au réel, déficit imputé), LOC-4 (apport total, aucun crédit), LOC-5 (SCPI à crédit), plus pertinence, manquant (prix absent) et repère absent (`micro_bic_plafond`).

## 6. Limites dites
Part étrangère des SCPI non distinguée ; micro-foncier supposé seul revenu foncier du foyer ; surtaxe des plus-values non calculée ; travaux non ajoutés à la valeur du bien ; IFI non calculé ; trésorerie de l'impôt lissée par douzièmes ; aucune exécution, aucun produit nommé.
