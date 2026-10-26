# SCN n° 20 « Locatif ou SCPI ? » et bibliothèque Scénarios dans l'app — plan

**Spec :** `docs/superpowers/specs/2026-10-26-scn-locatif-scpi-design.md` (scénario) et `docs/superpowers/specs/2026-10-17-scn1-scenarios-design.md` § 10 (interface).
**Périmètre de cette branche (app d'abord, décision de Stéph du 2026-10-26)** : calcul, catalogue, interface et démo. Le connecteur (tâches 9 à 11 de SCN1) et les migrations 0038 et 0039 suivent dans une PR à part.

## Fait
- [x] Spec du scénario (formules, fiscalité 2026, repères, limites).
- [x] Repères nouveaux dans la fixture (`micro_foncier_*`, `micro_bic_*`, `deficit_*`, conventions `scn_lmnp_*`, `scn_locatif_vacance_mois`, `scn_immo_frais_revente_pct`, `scn_scpi_*`), sources impots.gouv.fr vérifiées le 2026-10-26.
- [x] Entrée du catalogue `locatif_scpi` (n° 20, thème Immobilier, version de calcul `scn-1.1.0`).
- [x] `Scenarios.locatifScpi` : quatre options (bien locatif selon le régime, SCPI en direct, en assurance-vie, à crédit), effort égal, mêmes tirages que PROJ, bande P10–P90, TRI médian, patrimoine par anniversaire, « ce qui changerait » (revalorisation du bien, distribution, vacance, horizon).
- [x] Tests (`test/scenarios-locatif.test.mjs`) et cas chiffrés recalculés par un script indépendant (`scripts/verif/locatif-scpi-verif.py`).
- [x] Copie du connecteur régénérée (`npm run gen`), parité testée.
- [x] Bibliothèque Pilotage › Scénarios (SCN1 tâches 12 et 13) : « Pour toi », thèmes, détail, formulaire « Ajuster les hypothèses », simulateur acheter/louer en outil.

## À faire ensuite (PR suivante)
- [ ] Migration 0038 (tables `scenarios`, `scenarios_versions`, `scenarios_joues`, garde, politiques) et 0039 (repères vérifiés, dont ceux de ce scénario, et catalogue publié après le banc EX3). Tant qu'elles ne sont pas appliquées, l'app lit le catalogue embarqué et un scénario dont un repère manque en base reste « indisponible » (jamais de valeur de secours).
- [ ] Connecteur : `lister_scenarios`, `jouer_scenario`, `lire_scenario` (SCN1 tâches 9 et 10) ; cas du banc `banc/cas/SCN-LOC-*.json`.
- [ ] Onglet « Mes variantes » (SCN1 tâche 14) ; variante retenue pour un achat locatif (événement `achat_immobilier`, usage `locatif`) quand le moteur saura porter des parts de SCPI.
- [ ] Revérifier `micro_bic_plafond` et `micro_bic_abattement_pct` pour les revenus 2026 (date de fin 31/12/2026).
