/* @genere:scenarios-catalogue (scripts/gen-scenarios-demo.mjs, npm run gen ; ne pas modifier à la main).
   Catalogue des scénarios publiés et repères qu'ils lisent, repris de test/fixtures/scenarios-cas.json (et des migrations des repères) : repli de l'app quand la
   table publique scenarios n'existe pas encore, et données de la démo. 6 scénarios, 171 repères (dont 71 lus par les scénarios). */
(function (root) {
  const ScenariosCatalogue = {
   "catalogue": [
    {
     "cle": "ouvrir_pea",
     "numero": 1,
     "theme": "placements",
     "question": "Faut-il que j'ouvre un PEA, même petit ?",
     "resume": "Boussole compare, sur tes versements en actions, un PEA ouvert maintenant et ce que tu fais aujourd'hui : gain après impôts en euros d'aujourd'hui, date à partir de laquelle le PEA prend l'avantage, frais au-delà desquels il passe derrière, et valeur de « prendre date » avec un petit versement.",
     "pertinence": {
      "sans_enveloppe": [
       "pea"
      ],
      "un_de": [
       {
        "capacite_min": 1
       },
       {
        "surplus_matelas": true
       }
      ],
      "age_min": 18
     },
     "donnees": [
      {
       "champ": "enveloppes",
       "libelle": "Tes enveloppes et leurs dates d'ouverture",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "capacite",
       "libelle": "Ta capacité d'épargne",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "targets",
       "libelle": "Ton allocation cible",
       "origine": "boussole",
       "obligatoire": false
      },
      {
       "champ": "objectifs",
       "libelle": "Tes objectifs et leurs dates",
       "origine": "boussole",
       "obligatoire": false
      }
     ],
     "questions": [
      {
       "id": "versement_initial",
       "type": "montant_eur",
       "libelle": "Versement de départ",
       "aide": "0 si tu commences par des versements mensuels.",
       "obligatoire": true,
       "min": 0,
       "max": 150000,
       "prerempli": "zero"
      },
      {
       "id": "versement_mensuel",
       "type": "montant_eur",
       "libelle": "Versement mensuel en actions",
       "aide": "Prérempli : ta capacité d'épargne × la part actions de ton allocation cible.",
       "obligatoire": true,
       "min": 0,
       "max": 10000,
       "prerempli": "capacite_x_part_actions"
      },
      {
       "id": "debut",
       "type": "choix",
       "libelle": "Début des versements",
       "aide": "Tu peux ouvrir maintenant avec un petit versement et verser plus tard.",
       "obligatoire": true,
       "options": [
        "maintenant",
        "plus_tard"
       ],
       "prerempli": "maintenant"
      },
      {
       "id": "debut_date",
       "type": "date",
       "libelle": "Si plus tard : à partir de quand ?",
       "aide": "Le premier versement mensuel.",
       "obligatoire": false
      },
      {
       "id": "horizon_ans",
       "type": "entier",
       "libelle": "Dans combien d'années penses-tu retirer cet argent ?",
       "aide": "Prérempli : ton objectif le plus proche placé en actions, sinon 10 ans (convention).",
       "obligatoire": true,
       "min": 1,
       "max": 40,
       "prerempli": "horizon_objectif_actions"
      },
      {
       "id": "frais_pea_pct",
       "type": "pourcentage",
       "libelle": "Frais annuels du PEA, si tu les connais",
       "aide": "Droits de garde et frais de tenue, en % par an. Sinon, Boussole calcule les frais au-delà desquels le PEA passe derrière.",
       "obligatoire": false,
       "min": 0,
       "max": 3
      },
      {
       "id": "destination_actuelle",
       "type": "choix",
       "libelle": "Où vont ces versements aujourd'hui ?",
       "aide": "Sert de point de comparaison.",
       "obligatoire": true,
       "options": [
        "compte_titres",
        "assurance_vie",
        "livret",
        "courant"
       ],
       "prerempli": "destination_actions"
      }
     ],
     "reperes": [
      "pea_duree_ans",
      "pea_plafond",
      "ir_taux_forfaitaire",
      "ps_taux_general",
      "inflation_hypothese",
      "rendement_central_actions",
      "scn_delai_ouverture_mois",
      "suivi_horizon_suppose_ans"
     ],
     "calcul": "ouvrirPea",
     "version_calcul": "scn-1.0.0",
     "version": 1,
     "statut": "publie",
     "changelog": "v1 : premier lot SCN1."
    },
    {
     "cle": "prochain_euro",
     "numero": 2,
     "theme": "placements",
     "question": "Assurance-vie, PEA ou PER : où mettre mon prochain euro ?",
     "resume": "Boussole compare, pour le même effort d'épargne et la même allocation, une assurance-vie, un PEA complété d'une assurance-vie, un PER et un compte-titres, nets de frais et d'impôts de sortie à ton horizon, en euros d'aujourd'hui, et dit ce qui changerait le classement.",
     "pertinence": {
      "un_de": [
       {
        "capacite_min": 1
       },
       {
        "surplus_matelas": true
       }
      ],
      "age_min": 18
     },
     "donnees": [
      {
       "champ": "enveloppes",
       "libelle": "Tes enveloppes, leurs frais et dates d'ouverture",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "capacite",
       "libelle": "Ta capacité d'épargne",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "targets",
       "libelle": "Ton allocation cible",
       "origine": "boussole",
       "obligatoire": false
      },
      {
       "champ": "tmi",
       "libelle": "Ta tranche marginale d'imposition",
       "origine": "boussole",
       "obligatoire": false
      },
      {
       "champ": "avis_impot",
       "libelle": "Ton plafond épargne retraite",
       "origine": "boussole",
       "obligatoire": false
      }
     ],
     "questions": [
      {
       "id": "versement_mensuel",
       "type": "montant_eur",
       "libelle": "Montant mensuel",
       "aide": "Prérempli : ta capacité d'épargne.",
       "obligatoire": true,
       "min": 0,
       "max": 10000,
       "prerempli": "capacite"
      },
      {
       "id": "versement_initial",
       "type": "montant_eur",
       "libelle": "Versement de départ",
       "aide": "0 si aucun.",
       "obligatoire": true,
       "min": 0,
       "max": 1000000,
       "prerempli": "zero"
      },
      {
       "id": "horizon_ans",
       "type": "entier",
       "libelle": "Pour quel horizon ?",
       "aide": "Prérempli depuis tes objectifs.",
       "obligatoire": true,
       "min": 1,
       "max": 40,
       "prerempli": "horizon_objectif"
      },
      {
       "id": "retrait_avant",
       "type": "booleen",
       "libelle": "As-tu besoin de pouvoir retirer avant cet horizon ?",
       "aide": "Si oui, le PER est écarté.",
       "obligatoire": true,
       "prerempli": "non"
      },
      {
       "id": "tmi_retraite_pct",
       "type": "choix",
       "libelle": "Ta tranche d'imposition attendue à la retraite",
       "aide": "Sert seulement si le PER est en jeu.",
       "obligatoire": false,
       "options": [
        0,
        11,
        30,
        41,
        45,
        "ne_sait_pas"
       ]
      },
      {
       "id": "date_retraite",
       "type": "date",
       "libelle": "Date de départ à la retraite envisagée",
       "aide": "Aucune valeur par défaut (D7). Sert seulement si le PER est en jeu.",
       "obligatoire": false
      },
      {
       "id": "transmission",
       "type": "booleen",
       "libelle": "La transmission compte-t-elle pour toi ?",
       "aide": "Ligne d'information, sans calcul en V1.",
       "obligatoire": false
      }
     ],
     "reperes": [
      "ir_taux_forfaitaire",
      "ps_taux_general",
      "ps_taux_av_epargne_logement",
      "pea_duree_ans",
      "pea_plafond",
      "av_duree_ans",
      "av_taux_ir_reduit",
      "av_seuil_versements",
      "av_abattement_seul",
      "av_abattement_couple",
      "av_990i_abattement",
      "av_age_seuil",
      "per_plafond_plancher",
      "per_plafond_max",
      "per_plafond_taux_revenus",
      "inflation_hypothese",
      "rendement_central_actions",
      "rendement_central_fonds_euros",
      "rendement_central_obligations"
     ],
     "calcul": "prochainEuro",
     "version_calcul": "scn-1.0.0",
     "version": 1,
     "statut": "publie",
     "changelog": "v1 : premier lot SCN1."
    },
    {
     "cle": "per_interet",
     "numero": 3,
     "theme": "retraite",
     "question": "Le PER est-il intéressant pour moi ?",
     "resume": "Boussole calcule ton économie d'impôt avec ton plafond, puis compare un PER et une assurance-vie à effort net égal jusqu'à ta retraite, pour plusieurs tranches d'imposition à la sortie, et donne la tranche à partir de laquelle l'assurance-vie fait mieux.",
     "pertinence": {
      "revenus_activite": true,
      "age_sous_repere": "per_age_fin_deduction",
      "tmi_min": 11
     },
     "donnees": [
      {
       "champ": "tmi",
       "libelle": "Ta tranche marginale d'imposition",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "avis_impot",
       "libelle": "Ton plafond épargne retraite (avis d'impôt)",
       "origine": "boussole",
       "obligatoire": false
      },
      {
       "champ": "revenus",
       "libelle": "Tes revenus d'activité",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "objectifs",
       "libelle": "Un projet d'achat de ta résidence principale",
       "origine": "boussole",
       "obligatoire": false
      }
     ],
     "questions": [
      {
       "id": "versement_mensuel",
       "type": "montant_eur",
       "libelle": "Effort d'épargne mensuel envisagé",
       "aide": "Ce que tu es prêt à mettre de côté chaque mois, après économie d'impôt.",
       "obligatoire": true,
       "min": 0,
       "max": 10000,
       "prerempli": "capacite"
      },
      {
       "id": "tmi_pct",
       "type": "choix",
       "libelle": "Ta tranche marginale d'imposition aujourd'hui",
       "aide": "Sur ton avis d'impôt.",
       "obligatoire": true,
       "options": [
        0,
        11,
        30,
        41,
        45
       ],
       "prerempli": "tmi"
      },
      {
       "id": "tmi_retraite_pct",
       "type": "choix",
       "libelle": "Ta tranche attendue à la retraite",
       "aide": "Le tableau montre aussi les autres.",
       "obligatoire": true,
       "options": [
        0,
        11,
        30,
        41,
        45,
        "ne_sait_pas"
       ]
      },
      {
       "id": "date_retraite",
       "type": "date",
       "libelle": "Date de départ à la retraite envisagée",
       "aide": "Aucune valeur par défaut : l'âge légal dépend de ton année de naissance.",
       "obligatoire": true
      },
      {
       "id": "achat_rp",
       "type": "booleen",
       "libelle": "Un projet d'achat de ta résidence principale avant la retraite ?",
       "aide": "Le PER peut être débloqué pour cet achat.",
       "obligatoire": false,
       "prerempli": "objectif_rp"
      },
      {
       "id": "statut",
       "type": "choix",
       "libelle": "Salarié ou indépendant ?",
       "aide": "Indépendant : plafond différent, non calculé en V1.",
       "obligatoire": true,
       "options": [
        "salarie",
        "independant"
       ],
       "prerempli": "statut_risque"
      }
     ],
     "reperes": [
      "per_plafond_plancher",
      "per_plafond_max",
      "per_plafond_taux_revenus",
      "per_report_ans",
      "per_report_ans_ancien",
      "per_age_fin_deduction",
      "ir_taux_forfaitaire",
      "ps_taux_general",
      "ps_taux_av_epargne_logement",
      "av_duree_ans",
      "av_taux_ir_reduit",
      "av_seuil_versements",
      "av_abattement_seul",
      "av_abattement_couple",
      "ir_bareme_11_seuil",
      "ir_bareme_30_seuil",
      "ir_bareme_41_seuil",
      "ir_bareme_45_seuil",
      "inflation_hypothese",
      "rendement_central_actions"
     ],
     "calcul": "perInteret",
     "version_calcul": "scn-1.0.0",
     "version": 1,
     "statut": "publie",
     "changelog": "v1 : premier lot SCN1."
    },
    {
     "cle": "matelas",
     "numero": 6,
     "theme": "epargne",
     "question": "Combien garder de côté, et où ?",
     "resume": "Boussole calcule une cible d'épargne de précaution à partir de tes dépenses essentielles, la compare à ce que tu as de disponible, dit dans quel ordre remplir LEP, Livret A et LDDS, et ce que te coûte, ou te rapporte, de garder un surplus de côté.",
     "pertinence": {
      "toujours": true,
      "pour_toi_si": {
       "un_de": [
        {
         "matelas_ecart_pct": 25
        },
        {
         "lep_possible_non_detenu": true
        }
       ]
      }
     },
     "donnees": [
      {
       "champ": "depenses_essentielles",
       "libelle": "Tes dépenses essentielles (ou ton budget prévu)",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "matelas",
       "libelle": "Ton épargne disponible (livrets, comptes courants)",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "revenus_stabilite",
       "libelle": "La stabilité de tes revenus",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "avis_impot",
       "libelle": "Ton revenu fiscal de référence",
       "origine": "boussole",
       "obligatoire": false
      }
     ],
     "questions": [
      {
       "id": "mois",
       "type": "entier",
       "libelle": "Combien de mois de dépenses veux-tu garder ?",
       "aide": "Prérempli selon la stabilité de tes revenus (convention Boussole : 3, 6 ou 9 mois).",
       "obligatoire": true,
       "min": 3,
       "max": 12,
       "prerempli": "mois_convention"
      },
      {
       "id": "depense_prevue",
       "type": "montant_eur",
       "libelle": "Une grosse dépense prévue dans les 12 prochains mois ?",
       "aide": "0 si aucune.",
       "obligatoire": true,
       "min": 0,
       "max": 200000,
       "prerempli": "zero"
      },
      {
       "id": "parts_fiscales",
       "type": "choix",
       "libelle": "Nombre de parts de ton avis d'impôt",
       "aide": "Sert à savoir si tu peux ouvrir un LEP.",
       "obligatoire": false,
       "options": [
        1,
        1.25,
        1.5,
        1.75,
        2,
        2.25,
        2.5,
        2.75,
        3,
        3.5,
        4
       ]
      },
      {
       "id": "horizon_ans",
       "type": "entier",
       "libelle": "Sur combien d'années comparer le surplus ?",
       "aide": "5 ans par défaut.",
       "obligatoire": true,
       "min": 1,
       "max": 30,
       "prerempli": "cinq"
      },
      {
       "id": "destination_surplus",
       "type": "choix",
       "libelle": "Où placerais-tu le surplus ?",
       "aide": "Compte-titres par défaut : le plus imposé, donc prudent (D13).",
       "obligatoire": true,
       "options": [
        "compte_titres",
        "assurance_vie",
        "pea"
       ],
       "prerempli": "compte_titres"
      }
     ],
     "reperes": [
      "scn_matelas_mois_stable",
      "scn_matelas_mois_fragile",
      "scn_matelas_mois_independant",
      "scn_matelas_ecart_pct",
      "lep_taux",
      "lep_plafond",
      "lep_rfr_1_part",
      "lep_rfr_demi_part_sup",
      "lep_rfr_quart_part_sup",
      "livret_a_taux",
      "livret_a_plafond",
      "ldds_plafond",
      "rendement_central_monetaire",
      "rendement_central_actions",
      "ir_taux_forfaitaire",
      "ps_taux_general",
      "inflation_hypothese"
     ],
     "calcul": "matelas",
     "version_calcul": "scn-1.0.0",
     "version": 1,
     "statut": "publie",
     "changelog": "v1 : premier lot SCN1."
    },
    {
     "cle": "av_maintenant",
     "numero": 12,
     "theme": "epargne",
     "question": "Ouvrir une assurance-vie maintenant, même sans projet ?",
     "resume": "Boussole calcule ce que vaut l'ancienneté d'un contrat ouvert aujourd'hui avec un petit versement, si tu y verses plus tard : l'écart d'impôt selon la date de retrait, en euros d'aujourd'hui, et ce que coûte ce petit versement.",
     "pertinence": {
      "sans_enveloppe": [
       "assurance_vie"
      ],
      "age_sous_repere": "av_age_seuil",
      "age_min": 18
     },
     "donnees": [
      {
       "champ": "enveloppes",
       "libelle": "Tes enveloppes",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "naissance",
       "libelle": "Ta date de naissance",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "union",
       "libelle": "Couple soumis à imposition commune",
       "origine": "boussole",
       "obligatoire": true
      }
     ],
     "questions": [
      {
       "id": "versement_initial",
       "type": "montant_eur",
       "libelle": "Premier versement qui te paraît confortable",
       "aide": "Aucun minimum légal ; certains contrats en fixent un.",
       "obligatoire": true,
       "min": 0,
       "max": 100000
      },
      {
       "id": "versement_mensuel",
       "type": "montant_eur",
       "libelle": "Si un jour tu y verses : combien par mois ?",
       "aide": "Une estimation suffit.",
       "obligatoire": true,
       "min": 0,
       "max": 10000
      },
      {
       "id": "debut_date",
       "type": "date",
       "libelle": "À partir de quand ?",
       "aide": "Le premier versement mensuel.",
       "obligatoire": true
      },
      {
       "id": "retrait_ans",
       "type": "entier",
       "libelle": "Dans combien d'années penses-tu retirer ?",
       "aide": "« Je ne sais pas » : Boussole trace la courbe de 8 à 20 ans.",
       "obligatoire": false,
       "min": 1,
       "max": 40
      },
      {
       "id": "part_fonds_euros_pct",
       "type": "pourcentage",
       "libelle": "Part en fonds euros",
       "aide": "0 à 100 %.",
       "obligatoire": true,
       "min": 0,
       "max": 100,
       "prerempli": "part_fonds_euros_cible"
      },
      {
       "id": "frais_contrat_pct",
       "type": "pourcentage",
       "libelle": "Frais annuels du contrat, si tu les connais",
       "aide": "Sinon, frais nuls des deux côtés : seule l'ancienneté compte.",
       "obligatoire": false,
       "min": 0,
       "max": 3
      }
     ],
     "reperes": [
      "av_duree_ans",
      "av_taux_ir_reduit",
      "av_seuil_versements",
      "av_abattement_seul",
      "av_abattement_couple",
      "av_990i_abattement",
      "av_age_seuil",
      "ir_taux_forfaitaire",
      "ps_taux_av_epargne_logement",
      "inflation_hypothese",
      "rendement_central_actions",
      "rendement_central_fonds_euros",
      "scn_delai_ouverture_mois"
     ],
     "calcul": "avMaintenant",
     "version_calcul": "scn-1.0.0",
     "version": 1,
     "statut": "publie",
     "changelog": "v1 : premier lot SCN1."
    },
    {
     "cle": "locatif_scpi",
     "numero": 20,
     "theme": "immobilier",
     "question": "Investir dans un bien locatif ou en SCPI ?",
     "resume": "Boussole compare, à effort d'épargne égal, un bien locatif financé à crédit et des SCPI (en direct, en assurance-vie ou à crédit) : patrimoine net après revente ou retrait, crédit soldé et impôts, en euros d'aujourd'hui, avec sa bande d'incertitude, le rendement annuel équivalent et ce qui changerait la réponse.",
     "pertinence": {
      "un_de": [
       {
        "capacite_min": 200
       },
       {
        "surplus_matelas": true
       }
      ],
      "age_min": 18
     },
     "donnees": [
      {
       "champ": "capacite",
       "libelle": "Ta capacité d'épargne",
       "origine": "boussole",
       "obligatoire": false
      },
      {
       "champ": "tmi",
       "libelle": "Ta tranche d'imposition",
       "origine": "boussole",
       "obligatoire": true
      },
      {
       "champ": "objectifs",
       "libelle": "Tes objectifs et leurs dates",
       "origine": "boussole",
       "obligatoire": false
      },
      {
       "champ": "bien",
       "libelle": "Le bien que tu regardes (prix, loyer, charges)",
       "origine": "question",
       "obligatoire": true
      }
     ],
     "questions": [
      {
       "id": "prix",
       "type": "montant_eur",
       "libelle": "Prix du bien (hors frais de notaire)",
       "aide": "Le prix net vendeur de l'annonce.",
       "obligatoire": true,
       "min": 20000,
       "max": 3000000
      },
      {
       "id": "neuf",
       "type": "booleen",
       "libelle": "Est-ce un logement neuf ?",
       "aide": "Les frais d'acquisition sont plus bas dans le neuf.",
       "obligatoire": true,
       "prerempli": "non"
      },
      {
       "id": "travaux",
       "type": "montant_eur",
       "libelle": "Travaux à l'achat",
       "aide": "0 s'il n'y en a pas.",
       "obligatoire": false,
       "min": 0,
       "max": 1000000,
       "prerempli": "zero"
      },
      {
       "id": "mobilier",
       "type": "montant_eur",
       "libelle": "Mobilier (si meublé)",
       "aide": "Souvent quelques milliers d'euros pour un studio ou un deux-pièces.",
       "obligatoire": false,
       "min": 0,
       "max": 100000,
       "prerempli": "zero"
      },
      {
       "id": "apport",
       "type": "montant_eur",
       "libelle": "Apport",
       "aide": "Ce que tu mets de ta poche le jour de l'achat ; les SCPI reçoivent la même somme.",
       "obligatoire": true,
       "min": 0,
       "max": 3000000
      },
      {
       "id": "duree_credit_ans",
       "type": "entier",
       "libelle": "Durée du crédit",
       "aide": "En années.",
       "obligatoire": true,
       "min": 5,
       "max": 25,
       "prerempli": "vingt"
      },
      {
       "id": "taux_credit_pct",
       "type": "pourcentage",
       "libelle": "Taux du crédit, hors assurance",
       "aide": "Prérempli : le taux moyen du marché sur 20 ans.",
       "obligatoire": true,
       "min": 0,
       "max": 10,
       "prerempli": "repere_taux_credit_20"
      },
      {
       "id": "loyer_mensuel",
       "type": "montant_eur",
       "libelle": "Loyer mensuel hors charges",
       "aide": "Le loyer que tu peux raisonnablement demander.",
       "obligatoire": true,
       "min": 50,
       "max": 20000
      },
      {
       "id": "vacance_mois",
       "type": "entier",
       "libelle": "Mois sans locataire par an",
       "aide": "Prérempli : 1 mois par an (convention).",
       "obligatoire": true,
       "min": 0,
       "max": 6,
       "prerempli": "repere_vacance"
      },
      {
       "id": "charges_annuelles",
       "type": "montant_eur",
       "libelle": "Charges annuelles à ta charge",
       "aide": "Taxe foncière, copropriété non récupérable, assurance du propriétaire, entretien.",
       "obligatoire": true,
       "min": 0,
       "max": 50000
      },
      {
       "id": "gestion_pct",
       "type": "pourcentage",
       "libelle": "Gestion par une agence, en % des loyers",
       "aide": "0 si tu gères toi-même.",
       "obligatoire": false,
       "min": 0,
       "max": 15,
       "prerempli": "zero"
      },
      {
       "id": "regime",
       "type": "choix",
       "libelle": "Location et régime fiscal",
       "aide": "Meublé ou nu, au réel ou au forfait (micro).",
       "obligatoire": true,
       "options": [
        "lmnp_reel",
        "lmnp_micro",
        "nu_reel",
        "nu_micro"
       ],
       "prerempli": "regime_lmnp_reel"
      },
      {
       "id": "horizon_ans",
       "type": "entier",
       "libelle": "Dans combien d'années penses-tu revendre ou retirer ?",
       "aide": "Prérempli : 20 ans (convention). Un investissement immobilier se juge sur la durée : les frais d'entrée pèsent lourd les premières années.",
       "obligatoire": true,
       "min": 3,
       "max": 30,
       "prerempli": "vingt"
      },
      {
       "id": "tmi",
       "type": "choix",
       "libelle": "Ta tranche d'imposition (TMI)",
       "aide": "Elle figure sur ton avis d'impôt.",
       "obligatoire": true,
       "options": [
        0,
        11,
        30,
        41,
        45
       ],
       "prerempli": "tmi"
      },
      {
       "id": "scpi_frais_souscription_pct",
       "type": "pourcentage",
       "libelle": "Frais de souscription des SCPI",
       "aide": "Prérempli : 10 % (convention, fourchette usuelle 8 à 12 %).",
       "obligatoire": true,
       "min": 0,
       "max": 15,
       "prerempli": "repere_frais_souscription_scpi"
      },
      {
       "id": "scpi_taux_distribution_pct",
       "type": "pourcentage",
       "libelle": "Taux de distribution des SCPI",
       "aide": "Prérempli : le taux moyen publié du marché.",
       "obligatoire": true,
       "min": 0,
       "max": 12,
       "prerempli": "repere_distribution_scpi"
      },
      {
       "id": "scpi_prix_part_pct",
       "type": "pourcentage",
       "libelle": "Évolution annuelle du prix des parts",
       "aide": "Prérempli : rendement central de la pierre-papier moins sa distribution.",
       "obligatoire": true,
       "min": -5,
       "max": 5,
       "prerempli": "repere_prix_part_scpi"
      },
      {
       "id": "scpi_reinvestir",
       "type": "booleen",
       "libelle": "Réinvestir les revenus des SCPI ?",
       "aide": "Oui : les revenus nets rachètent des parts, avec les frais de souscription.",
       "obligatoire": true,
       "prerempli": "oui"
      },
      {
       "id": "frais_av_pct",
       "type": "pourcentage",
       "libelle": "Frais annuels de l'assurance-vie, si tu les connais",
       "aide": "Frais de gestion des unités de compte, en % par an.",
       "obligatoire": false,
       "min": 0,
       "max": 3,
       "prerempli": "frais_av_renseignes"
      },
      {
       "id": "scpi_credit",
       "type": "booleen",
       "libelle": "Comparer aussi des SCPI achetées à crédit ?",
       "aide": "Même crédit que pour le bien.",
       "obligatoire": false,
       "prerempli": "non"
      }
     ],
     "reperes": [
      "frais_acquisition_ancien_pct",
      "frais_acquisition_neuf_pct",
      "ps_taux_foncier",
      "ps_taux_general",
      "pv_immo_ir_taux",
      "pv_immo_ps_taux",
      "micro_foncier_plafond",
      "micro_bic_plafond",
      "deficit_foncier_plafond",
      "scpi_taux_distribution",
      "rendement_central_immobilier",
      "immo_revalorisation_reelle",
      "immo_volatilite",
      "inflation_hypothese",
      "taux_credit_immo_20"
     ],
     "calcul": "locatifScpi",
     "version_calcul": "scn-1.1.0",
     "version": 1,
     "statut": "publie",
     "changelog": "v1 : scénario n° 20, locatif ou SCPI (spec du 2026-10-26)."
    }
   ],
   "reperes": [
    {
     "cle": "assurance_emprunteur_defaut_pct",
     "libelle": "Assurance emprunteur supposée, par an sur le capital (convention Boussole)",
     "valeur": 0.3,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": null,
     "sourceTitre": "Convention Boussole",
     "sourceUrl": "https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000044178678",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "assurance_emprunteur_sans_questionnaire",
     "libelle": "Part assurée par assuré en dessous de laquelle aucun questionnaire de santé n'est demandé (fin du crédit avant 60 ans)",
     "valeur": 200000,
     "unite": "€",
     "dateEffet": "2022-06-01",
     "dateFin": null,
     "sourceTitre": "Légifrance — loi n° 2022-270 du 28 février 2022",
     "sourceUrl": "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000045268729",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "av_757b_abattement",
     "libelle": "Abattement global, primes versées après 70 ans (art. 757 B)",
     "valeur": 30500,
     "unite": "€",
     "dateEffet": "2023-03-11",
     "dateFin": null,
     "sourceTitre": "Légifrance — CGI art. 757 B",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288569",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "av_990i_abattement",
     "libelle": "Abattement par bénéficiaire, primes versées avant 70 ans (art. 990 I)",
     "valeur": 152500,
     "unite": "€",
     "dateEffet": "2023-03-11",
     "dateFin": null,
     "sourceTitre": "Légifrance — CGI art. 990 I",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288653",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "av_abattement_couple",
     "libelle": "Abattement annuel assurance-vie après 8 ans, couple soumis à imposition commune",
     "valeur": 9200,
     "unite": "€",
     "dateEffet": "2018-01-01",
     "dateFin": null,
     "sourceTitre": "impots.gouv.fr — Imposition des produits des contrats d'assurance-vie",
     "sourceUrl": "https://www.impots.gouv.fr/particulier/questions/jai-effectue-des-retraits-sur-mon-contrat-dassurance-vie-quelles-sont-les",
     "verifieLe": "2026-10-10"
    },
    {
     "cle": "av_abattement_seul",
     "libelle": "Abattement annuel assurance-vie après 8 ans, personne seule",
     "valeur": 4600,
     "unite": "€",
     "dateEffet": "2018-01-01",
     "dateFin": null,
     "sourceTitre": "impots.gouv.fr — Imposition des produits des contrats d'assurance-vie",
     "sourceUrl": "https://www.impots.gouv.fr/particulier/questions/jai-effectue-des-retraits-sur-mon-contrat-dassurance-vie-quelles-sont-les",
     "verifieLe": "2026-10-10"
    },
    {
     "cle": "av_age_seuil",
     "libelle": "Âge de l'assuré qui sépare les régimes 990 I et 757 B",
     "valeur": 70,
     "unite": "ans",
     "dateEffet": "2023-03-11",
     "dateFin": null,
     "sourceTitre": "Légifrance — CGI art. 757 B",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288569",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "av_duree_ans",
     "libelle": "Durée d'un contrat d'assurance-vie ouvrant l'abattement annuel",
     "valeur": 8,
     "unite": "ans",
     "dateEffet": "1990-01-01",
     "dateFin": null,
     "sourceTitre": "BOFiP — BOI-RPPM-RCM-30-10-20-20 (durée du contrat)",
     "sourceUrl": "https://bofip.impots.gouv.fr/bofip/9312-PGP.html/identifiant=BOI-RPPM-RCM-30-10-20-20-20220630",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "av_seuil_versements",
     "libelle": "Seuil de primes nettes pour le taux réduit de l'assurance-vie après 8 ans",
     "valeur": 150000,
     "unite": "€",
     "dateEffet": "2017-09-27",
     "dateFin": null,
     "sourceTitre": "Service-public — Fiscalité de l'assurance-vie",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F22414",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "av_taux_ir_reduit",
     "libelle": "Assurance-vie après 8 ans : taux réduit sous 150 000 € de primes",
     "valeur": 7.5,
     "unite": "%",
     "dateEffet": "2017-09-27",
     "dateFin": null,
     "sourceTitre": "Service-public — Fiscalité de l'assurance-vie",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F22414",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "courtage_banque_reseau_pct",
     "libelle": "Courtage moyen d'un ordre de bourse de 1 000 €, banques de réseau (janvier 2026)",
     "valeur": 0.65,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "AMF — Les frais des placements financiers continuent de baisser (27 avril 2026) : courtage moyen d'un ordre de 1 000 €, janvier 2026",
     "sourceUrl": "https://www.amf-france.org/fr/actualites-publications/actualites/les-frais-des-placements-financiers-continuent-de-baisser-en-particulier-ceux-des-fonds",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "courtage_en_ligne_pct",
     "libelle": "Courtage moyen d'un ordre de bourse de 1 000 €, intermédiaires en ligne établis (janvier 2026)",
     "valeur": 0.45,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "AMF — Les frais des placements financiers continuent de baisser (27 avril 2026) : courtage moyen d'un ordre de 1 000 €, janvier 2026",
     "sourceUrl": "https://www.amf-france.org/fr/actualites-publications/actualites/les-frais-des-placements-financiers-continuent-de-baisser-en-particulier-ceux-des-fonds",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "courtage_neo_courtier_pct",
     "libelle": "Courtage moyen d'un ordre de bourse de 1 000 €, néo-courtiers (janvier 2026)",
     "valeur": 0.15,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "AMF — Les frais des placements financiers continuent de baisser (27 avril 2026) : courtage moyen d'un ordre de 1 000 €, janvier 2026",
     "sourceUrl": "https://www.amf-france.org/fr/actualites-publications/actualites/les-frais-des-placements-financiers-continuent-de-baisser-en-particulier-ceux-des-fonds",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "creche_heures_mois",
     "libelle": "Heures de crèche par mois (convention Boussole : 10 h × 20 jours)",
     "valeur": 200,
     "unite": "h",
     "dateEffet": "2026-10-14",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec PROJ § 7.1)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-14-proj-projection-design.md",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "creche_psu_plafond",
     "libelle": "Crèche (PSU) : ressources mensuelles plafond",
     "valeur": 8500,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Cnaf — Guide PSU 2026",
     "sourceUrl": "https://caf.fr/sites/default/files/medias/493/Partenaires/Petite-enfance/EAJE/Guide_PSU_2026_02_V_Def.pdf",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "creche_psu_plancher",
     "libelle": "Crèche (PSU) : ressources mensuelles plancher",
     "valeur": 814.62,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Cnaf — Guide PSU 2026",
     "sourceUrl": "https://caf.fr/sites/default/files/medias/493/Partenaires/Petite-enfance/EAJE/Guide_PSU_2026_02_V_Def.pdf",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "creche_psu_taux_1_enfant",
     "libelle": "Crèche (PSU) : taux d'effort horaire, famille d'un enfant, accueil collectif",
     "valeur": 0.0619,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "Cnaf — Guide PSU 2026, barème national des participations familiales",
     "sourceUrl": "https://caf.fr/sites/default/files/medias/493/Partenaires/Petite-enfance/EAJE/Guide_PSU_2026_02_V_Def.pdf",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "creche_psu_taux_2_enfants",
     "libelle": "Crèche (PSU) : taux d'effort horaire, famille de 2 enfants",
     "valeur": 0.0516,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "Cnaf — Guide PSU 2026",
     "sourceUrl": "https://caf.fr/sites/default/files/medias/493/Partenaires/Petite-enfance/EAJE/Guide_PSU_2026_02_V_Def.pdf",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "creche_psu_taux_3_enfants",
     "libelle": "Crèche (PSU) : taux d'effort horaire, famille de 3 enfants",
     "valeur": 0.0413,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "Cnaf — Guide PSU 2026",
     "sourceUrl": "https://caf.fr/sites/default/files/medias/493/Partenaires/Petite-enfance/EAJE/Guide_PSU_2026_02_V_Def.pdf",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "creche_psu_taux_4_7_enfants",
     "libelle": "Crèche (PSU) : taux d'effort horaire, famille de 4 à 7 enfants",
     "valeur": 0.031,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "Cnaf — Guide PSU 2026",
     "sourceUrl": "https://caf.fr/sites/default/files/medias/493/Partenaires/Petite-enfance/EAJE/Guide_PSU_2026_02_V_Def.pdf",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "creche_psu_taux_8_enfants",
     "libelle": "Crèche (PSU) : taux d'effort horaire, famille de 8 enfants ou plus",
     "valeur": 0.0206,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "Cnaf — Guide PSU 2026",
     "sourceUrl": "https://caf.fr/sites/default/files/medias/493/Partenaires/Petite-enfance/EAJE/Guide_PSU_2026_02_V_Def.pdf",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "deficit_bic_report_ans",
     "libelle": "Location meublée non professionnelle : report des déficits sur les revenus de location meublée",
     "valeur": 10,
     "unite": "ans",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "impots.gouv.fr — Régime des locations meublées, foire aux questions (03/2026)",
     "sourceUrl": "https://www.impots.gouv.fr/sites/default/files/media/1_metier/5_international/actualite/faq-lmnp-03_2026.pdf",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "deficit_foncier_plafond",
     "libelle": "Déficit foncier imputable sur le revenu global, par an (hors intérêts d'emprunt)",
     "valeur": 10700,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "impots.gouv.fr — Location vide de meubles (page modifiée le 07/04/2026)",
     "sourceUrl": "https://www.impots.gouv.fr/particulier/location-vide-de-meubles",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "deficit_foncier_report_ans",
     "libelle": "Déficit foncier : report sur les revenus fonciers",
     "valeur": 10,
     "unite": "ans",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "impots.gouv.fr — Location vide de meubles (page modifiée le 07/04/2026)",
     "sourceUrl": "https://www.impots.gouv.fr/particulier/location-vide-de-meubles",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "don_familial_argent",
     "libelle": "Don familial de sommes d'argent (art. 790 G), par donateur et par bénéficiaire",
     "valeur": 31865,
     "unite": "€",
     "dateEffet": "2023-12-31",
     "dateFin": null,
     "sourceTitre": "Légifrance — CGI art. 790 G",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041471332",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "don_logement_donataire",
     "libelle": "Dons pour un logement neuf ou une rénovation énergétique : plafond par donataire (art. 790 A bis)",
     "valeur": 300000,
     "unite": "€",
     "dateEffet": "2025-02-15",
     "dateFin": "2026-12-31",
     "sourceTitre": "Légifrance — CGI art. 790 A bis",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043662329",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "don_logement_donateur",
     "libelle": "Dons pour un logement neuf ou une rénovation énergétique : plafond par donateur et par donataire (art. 790 A bis)",
     "valeur": 100000,
     "unite": "€",
     "dateEffet": "2025-02-15",
     "dateFin": "2026-12-31",
     "sourceTitre": "Service-public — Don familial de sommes d'argent",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F36656",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "donation_abattement_enfant",
     "libelle": "Abattement par parent et par enfant sur une donation",
     "valeur": 100000,
     "unite": "€",
     "dateEffet": "2012-08-17",
     "dateFin": null,
     "sourceTitre": "Service-public — Donation : abattements",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F14203",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "donation_rappel_ans",
     "libelle": "Délai de rappel fiscal des donations",
     "valeur": 15,
     "unite": "ans",
     "dateEffet": "2012-08-17",
     "dateFin": null,
     "sourceTitre": "Service-public — Donation : abattements",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F14203",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ecole_obligatoire_age",
     "libelle": "Âge de début de l'instruction obligatoire",
     "valeur": 3,
     "unite": "ans",
     "dateEffet": "2019-09-02",
     "dateFin": null,
     "sourceTitre": "Légifrance — Code de l'éducation, art. L131-1",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038901859",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "enfant_fin_charge_age",
     "libelle": "Âge de fin de charge d'un enfant (convention Boussole)",
     "valeur": 20,
     "unite": "ans",
     "dateEffet": "2026-10-14",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (enfant à charge de moins de 20 ans, périmètre du HCFEA)",
     "sourceUrl": "https://www.hcfea.fr/IMG/pdf/synthese_cout_de_l_enfant_def.pdf",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "estr_taux",
     "libelle": "Taux €STR (coût de financement d'un levier)",
     "valeur": 2.439,
     "unite": "%",
     "dateEffet": "2026-10-13",
     "dateFin": "2026-11-30",
     "sourceTitre": "BCE — euro short-term rate (€STR)",
     "sourceUrl": "https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_short-term_rate/html/index.en.html",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "frais_acquisition_ancien_pct",
     "libelle": "Frais d'acquisition dans l'ancien (convention Boussole)",
     "valeur": 8,
     "unite": "%",
     "dateEffet": "2025-04-01",
     "dateFin": null,
     "sourceTitre": "Convention de Rang ; droits de mutation : service-public A18183",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/actualites/A18183",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "frais_acquisition_neuf_pct",
     "libelle": "Frais d'acquisition dans le neuf (convention Boussole)",
     "valeur": 2.5,
     "unite": "%",
     "dateEffet": "2025-04-01",
     "dateFin": null,
     "sourceTitre": "Convention de Rang",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/actualites/A18183",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "frais_acquisition_primo_pct",
     "libelle": "Frais d'acquisition dans l'ancien, primo-accédant (convention Boussole)",
     "valeur": 7.5,
     "unite": "%",
     "dateEffet": "2025-04-01",
     "dateFin": null,
     "sourceTitre": "Convention de Rang ; droits de mutation : service-public A18183",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/actualites/A18183",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "frais_dossier",
     "libelle": "Frais de dossier du prêt (convention Boussole)",
     "valeur": 1000,
     "unite": "€",
     "dateEffet": "2026-10-14",
     "dateFin": null,
     "sourceTitre": "Convention de Rang",
     "sourceUrl": "https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000044178678",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "garantie_pct",
     "libelle": "Coût de la garantie du prêt (convention Boussole)",
     "valeur": 1,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": null,
     "sourceTitre": "Convention de Rang",
     "sourceUrl": "https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000044178678",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "garde_fou_croissance_annuelle",
     "libelle": "Garde-fou : croissance médiane annuelle au-delà de laquelle la projection est signalée (convention Boussole)",
     "valeur": 8,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec PROJ § 6.8, § 6.9)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-14-proj-projection-design.md",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "garde_fou_ecart_capacite",
     "libelle": "Garde-fou : écart entre capacité constatée et prévue au-delà duquel les deux sont montrées (convention Boussole)",
     "valeur": 30,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec PROJ § 6.8, § 6.9)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-14-proj-projection-design.md",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "garde_fou_rendement_marge",
     "libelle": "Garde-fou : marge sur le rendement attendu du portefeuille (convention Boussole)",
     "valeur": 0.5,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec PROJ § 6.8, § 6.9)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-14-proj-projection-design.md",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "hcsf_duree_max",
     "libelle": "Durée maximale du crédit immobilier HCSF",
     "valeur": 25,
     "unite": "ans",
     "dateEffet": "2022-01-01",
     "dateFin": null,
     "sourceTitre": "Haut Conseil de stabilité financière — mesure relative à l'octroi de crédits immobiliers (25 ans, jusqu'à 2 ans de différé en plus)",
     "sourceUrl": "https://www.economie.gouv.fr/hcsf/mesures/mesure-relative-loctroi-de-credits-immobiliers",
     "verifieLe": "2026-10-10"
    },
    {
     "cle": "hcsf_duree_max_differe",
     "libelle": "Durée maximale avec différé (VEFA, construction, promotion, ancien avec au moins 10 % de travaux)",
     "valeur": 27,
     "unite": "ans",
     "dateEffet": "2022-01-01",
     "dateFin": null,
     "sourceTitre": "Légifrance — décision du HCSF du 29 septembre 2021, art. 1",
     "sourceUrl": "https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000044178678",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "hcsf_taux_effort",
     "libelle": "Taux d'effort maximal HCSF",
     "valeur": 35,
     "unite": "%",
     "dateEffet": "2022-01-01",
     "dateFin": null,
     "sourceTitre": "Haut Conseil de stabilité financière — mesure relative à l'octroi de crédits immobiliers (décision D-HCSF-2021-7, maintenue le 15 septembre 2026)",
     "sourceUrl": "https://www.economie.gouv.fr/hcsf/mesures/mesure-relative-loctroi-de-credits-immobiliers",
     "verifieLe": "2026-10-10"
    },
    {
     "cle": "hcsf_travaux_seuil_pct",
     "libelle": "Part minimale de travaux dans le coût total pour le différé dans l'ancien",
     "valeur": 10,
     "unite": "%",
     "dateEffet": "2024-01-01",
     "dateFin": null,
     "sourceTitre": "Légifrance — décision du HCSF du 18 décembre 2023",
     "sourceUrl": "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000048659704",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "immo_revalorisation_reelle",
     "libelle": "Revalorisation réelle des logements (convention prudente : prix = inflation)",
     "valeur": 0,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": null,
     "sourceTitre": "Convention Boussole ; contrôle : Insee, indice des prix des logements anciens (série 010567058)",
     "sourceUrl": "https://www.insee.fr/fr/statistiques/serie/010567058",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "immo_volatilite",
     "libelle": "Volatilité annuelle des prix des logements anciens (calcul Boussole 1997-2025)",
     "valeur": 5.3,
     "unite": "%",
     "dateEffet": "2026-09-08",
     "dateFin": null,
     "sourceTitre": "Insee — indice des prix des logements anciens, France métropolitaine, série brute 010567058",
     "sourceUrl": "https://www.insee.fr/fr/statistiques/serie/010567058",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "inflation_fr_1973",
     "libelle": "Inflation en France en 1973 (moyenne annuelle)",
     "valeur": 7.3,
     "unite": "%",
     "dateEffet": "1973-12-31",
     "dateFin": null,
     "sourceTitre": "Insee — indice des prix des 295 postes, base 1970, série 000000282 (120,2 / 112,0)",
     "sourceUrl": "https://www.insee.fr/fr/statistiques/serie/000000282",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "inflation_fr_1974",
     "libelle": "Inflation en France en 1974 (moyenne annuelle)",
     "valeur": 13.7,
     "unite": "%",
     "dateEffet": "1974-12-31",
     "dateFin": null,
     "sourceTitre": "Insee — indice des prix des 295 postes, base 1970, série 000000282 (136,7 / 120,2)",
     "sourceUrl": "https://www.insee.fr/fr/statistiques/serie/000000282",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "inflation_hypothese",
     "libelle": "Inflation supposée (objectif de la BCE)",
     "valeur": 2,
     "unite": "%",
     "dateEffet": "2021-07-08",
     "dateFin": null,
     "sourceTitre": "BCE — stratégie de politique monétaire",
     "sourceUrl": "https://www.ecb.europa.eu/mopo/strategy/pricestab/html/index.fr.html",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ir_bareme_11_seuil",
     "libelle": "Barème de l'IR (revenus 2025) : 11 % au-delà de",
     "valeur": 11600,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Service-public — Barème de l'impôt sur le revenu",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F1419",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ir_bareme_30_seuil",
     "libelle": "Barème de l'IR (revenus 2025) : 30 % au-delà de",
     "valeur": 29579,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Service-public — Barème de l'impôt sur le revenu",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F1419",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ir_bareme_41_seuil",
     "libelle": "Barème de l'IR (revenus 2025) : 41 % au-delà de",
     "valeur": 84577,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Service-public — Barème de l'impôt sur le revenu",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F1419",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ir_bareme_45_seuil",
     "libelle": "Barème de l'IR (revenus 2025) : 45 % au-delà de",
     "valeur": 181917,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Service-public — Barème de l'impôt sur le revenu",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F1419",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ir_taux_forfaitaire",
     "libelle": "Impôt forfaitaire sur les revenus du capital (part impôt du PFU)",
     "valeur": 12.8,
     "unite": "%",
     "dateEffet": "2018-01-01",
     "dateFin": null,
     "sourceTitre": "Service-public — Fiscalité de l'assurance-vie",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F22414",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ira_plafond_mois",
     "libelle": "Plafond des indemnités de remboursement anticipé : mois d'intérêts",
     "valeur": 6,
     "unite": "mois",
     "dateEffet": "2016-07-01",
     "dateFin": null,
     "sourceTitre": "Légifrance — Code de la consommation R313-25",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032807570/",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ira_plafond_pct",
     "libelle": "Plafond des indemnités de remboursement anticipé : part du capital restant dû",
     "valeur": 3,
     "unite": "%",
     "dateEffet": "2016-07-01",
     "dateFin": null,
     "sourceTitre": "Légifrance — Code de la consommation R313-25",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032807570/",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ldds_plafond",
     "libelle": "Plafond du LDDS",
     "valeur": 12000,
     "unite": "€",
     "dateEffet": "2012-10-01",
     "dateFin": null,
     "sourceTitre": "Service-public.fr — Livret de développement durable et solidaire (LDDS)",
     "sourceUrl": "https://www.service-public.fr/particuliers/vosdroits/F2368",
     "verifieLe": "2026-10-10"
    },
    {
     "cle": "lep_plafond",
     "libelle": "Plafond du LEP",
     "valeur": 10000,
     "unite": "€",
     "dateEffet": "2023-10-01",
     "dateFin": null,
     "sourceTitre": "Service-public.fr — Livret d'épargne populaire (LEP)",
     "sourceUrl": "https://www.service-public.fr/particuliers/vosdroits/F2367",
     "verifieLe": "2026-10-10"
    },
    {
     "cle": "lep_rfr_1_part",
     "libelle": "Revenu fiscal de référence maximal pour un LEP, 1 part (métropole, 2026)",
     "valeur": 23028,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Service-public — Livret d'épargne populaire (LEP)",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F2367",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "lep_rfr_demi_part_sup",
     "libelle": "LEP : majoration du plafond de revenu fiscal de référence par demi-part supplémentaire (métropole, 2026)",
     "valeur": 6149,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Service-public — Livret d'épargne populaire (LEP)",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F2367",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "lep_rfr_quart_part_sup",
     "libelle": "LEP : majoration du plafond de revenu fiscal de référence par quart de part supplémentaire (métropole, 2026)",
     "valeur": 3075,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Service-public — Livret d'épargne populaire (LEP)",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F2367",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "lep_taux",
     "libelle": "Taux du LEP",
     "valeur": 2.5,
     "unite": "%",
     "dateEffet": "2026-08-01",
     "dateFin": "2027-01-31",
     "sourceTitre": "Légifrance — arrêté du 29 juillet 2026 relatif au taux d'intérêt du livret d'épargne populaire",
     "sourceUrl": "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569438",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "livret_a_plafond",
     "libelle": "Plafond du Livret A",
     "valeur": 22950,
     "unite": "€",
     "dateEffet": "2013-01-01",
     "dateFin": null,
     "sourceTitre": "Service-public.fr — Livret A",
     "sourceUrl": "https://www.service-public.fr/particuliers/vosdroits/F2365",
     "verifieLe": "2026-10-10"
    },
    {
     "cle": "livret_a_taux",
     "libelle": "Taux du Livret A (et du LDDS)",
     "valeur": 1.7,
     "unite": "%",
     "dateEffet": "2026-08-01",
     "dateFin": "2027-01-31",
     "sourceTitre": "Légifrance — arrêté du 28 juillet 2026 relatif aux taux d'intérêt des produits d'épargne réglementée",
     "sourceUrl": "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054541376",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "micro_bic_abattement_pct",
     "libelle": "Micro-BIC, location meublée de longue durée : abattement forfaitaire (revenus 2025)",
     "valeur": 50,
     "unite": "%",
     "dateEffet": "2025-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "impots.gouv.fr — Régime des locations meublées, foire aux questions (03/2026)",
     "sourceUrl": "https://www.impots.gouv.fr/sites/default/files/media/1_metier/5_international/actualite/faq-lmnp-03_2026.pdf",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "micro_bic_plafond",
     "libelle": "Micro-BIC, location meublée de longue durée : plafond de recettes (revenus 2025)",
     "valeur": 77700,
     "unite": "€",
     "dateEffet": "2025-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "impots.gouv.fr — Régime des locations meublées, foire aux questions (03/2026)",
     "sourceUrl": "https://www.impots.gouv.fr/sites/default/files/media/1_metier/5_international/actualite/faq-lmnp-03_2026.pdf",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "micro_foncier_abattement_pct",
     "libelle": "Micro-foncier : abattement forfaitaire",
     "valeur": 30,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "impots.gouv.fr — Location vide de meubles (page modifiée le 07/04/2026)",
     "sourceUrl": "https://www.impots.gouv.fr/particulier/location-vide-de-meubles",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "micro_foncier_plafond",
     "libelle": "Micro-foncier : plafond des loyers bruts annuels du foyer",
     "valeur": 15000,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "impots.gouv.fr — Location vide de meubles (page modifiée le 07/04/2026)",
     "sourceUrl": "https://www.impots.gouv.fr/particulier/location-vide-de-meubles",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "mv_report_ans",
     "libelle": "Années de report des moins-values sur valeurs mobilières",
     "valeur": 10,
     "unite": "ans",
     "dateEffet": "2017-01-01",
     "dateFin": null,
     "sourceTitre": "Service-public — Plus-values sur valeurs mobilières",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F21618",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "nasdaq100_volatilite",
     "libelle": "Volatilité annualisée du Nasdaq-100 (rendement total, 31/12/2007 au 30/06/2026)",
     "valeur": 22.9,
     "unite": "%",
     "dateEffet": "2026-06-30",
     "dateFin": null,
     "sourceTitre": "Nasdaq Global Indexes — Nasdaq-100 vs S&P 500 (données au 30/06/2026)",
     "sourceUrl": "https://indexes.nasdaqomx.com/docs/NDX%20vs.%20SPX%20-%202%20pager.pdf",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pass",
     "libelle": "Plafond annuel de la Sécurité sociale",
     "valeur": 48060,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "Urssaf — Plafonds de la Sécurité sociale 2026",
     "sourceUrl": "https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/plafonds-securite-sociale.html",
     "verifieLe": "2026-10-10"
    },
    {
     "cle": "pea_duree_ans",
     "libelle": "Durée après laquelle un retrait ne clôture plus le PEA",
     "valeur": 5,
     "unite": "ans",
     "dateEffet": "2019-05-24",
     "dateFin": null,
     "sourceTitre": "Service-public — PEA : retraits et clôture",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F22449",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pea_jeune_plafond",
     "libelle": "Plafond du PEA d'un majeur rattaché au foyer de ses parents",
     "valeur": 20000,
     "unite": "€",
     "dateEffet": "2019-05-24",
     "dateFin": null,
     "sourceTitre": "Service-public — PEA",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F2385",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pea_plafond",
     "libelle": "Plafond de versements du PEA",
     "valeur": 150000,
     "unite": "€",
     "dateEffet": "2014-01-01",
     "dateFin": null,
     "sourceTitre": "Service-public.fr — Plan d'épargne en actions (PEA)",
     "sourceUrl": "https://www.service-public.fr/particuliers/vosdroits/F2385",
     "verifieLe": "2026-10-10"
    },
    {
     "cle": "pea_pme_plafond_global",
     "libelle": "Plafond cumulé PEA + PEA PME-ETI par titulaire",
     "valeur": 225000,
     "unite": "€",
     "dateEffet": "2019-05-24",
     "dateFin": null,
     "sourceTitre": "Service-public — Plan d'épargne en actions (PEA)",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F2385",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pee_blocage_ans",
     "libelle": "Durée minimale de blocage d'un versement sur un PEE",
     "valeur": 5,
     "unite": "ans",
     "dateEffet": "2021-01-01",
     "dateFin": null,
     "sourceTitre": "Légifrance — Code du travail art. L3332-25",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042340834",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pel_duree_max_ans",
     "libelle": "Durée maximale de versement du PEL",
     "valeur": 10,
     "unite": "ans",
     "dateEffet": "2011-03-01",
     "dateFin": null,
     "sourceTitre": "Service-public — PEL",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F16140",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pel_duree_min_ans",
     "libelle": "Durée minimale du PEL",
     "valeur": 4,
     "unite": "ans",
     "dateEffet": "2019-09-01",
     "dateFin": null,
     "sourceTitre": "Légifrance — Code de la construction et de l'habitation, art. R315-28",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000039042324",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pel_duree_vie_ans",
     "libelle": "Durée au terme de laquelle un PEL ouvert depuis le 1er mars 2011 devient un livret ordinaire",
     "valeur": 15,
     "unite": "ans",
     "dateEffet": "2011-03-01",
     "dateFin": null,
     "sourceTitre": "Service-public — PEL",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F16140",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pel_exoneration_ir_ans",
     "libelle": "Années d'intérêts exonérés d'impôt sur le revenu, PEL ouvert du 1er avril 1992 au 31 décembre 2017",
     "valeur": 12,
     "unite": "ans",
     "dateEffet": "2018-01-01",
     "dateFin": null,
     "sourceTitre": "BOFiP — BOI-RPPM-RCM-10-10-50, § 60",
     "sourceUrl": "https://bofip.impots.gouv.fr/bofip/857-PGP.html",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pel_retrait_min_ans",
     "libelle": "Durée en dessous de laquelle la résiliation du PEL fait appliquer aux intérêts le taux du CEL",
     "valeur": 2,
     "unite": "ans",
     "dateEffet": "2019-09-01",
     "dateFin": null,
     "sourceTitre": "Légifrance — Code de la construction et de l'habitation, art. R315-32",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000039042305",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pel_taux_ouverture",
     "libelle": "Taux du PEL ouvert en 2026 (fixé à l'ouverture)",
     "valeur": 2,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Légifrance — avis du 20 décembre 2025 relatif au taux du PEL",
     "sourceUrl": "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053095350",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "per_age_fin_deduction",
     "libelle": "Âge à partir duquel les versements sur un PER ne sont plus déductibles",
     "valeur": 70,
     "unite": "ans",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "Service-public — Plafond de déduction de l'épargne retraite",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F14709",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "per_plafond_max",
     "libelle": "Plafond maximal de déduction épargne retraite d'un salarié (2026)",
     "valeur": 37680,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Service-public — Plafond de déduction de l'épargne retraite",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F14709",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "per_plafond_plancher",
     "libelle": "Plafond minimal de déduction épargne retraite (2026)",
     "valeur": 4710,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Service-public — Plafond de déduction de l'épargne retraite",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F14709",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "per_plafond_taux_revenus",
     "libelle": "Plafond de déduction épargne retraite d'un salarié : part des revenus d'activité nets de frais de l'année précédente",
     "valeur": 10,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "Service-public — Plafond de déduction de l'épargne retraite",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F14709",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "per_report_ans",
     "libelle": "Années de report du plafond épargne retraite non utilisé (plafonds depuis 2026)",
     "valeur": 5,
     "unite": "ans",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "BOFiP — ACTU-2026-00106 (loi de finances pour 2026, art. 10)",
     "sourceUrl": "https://bofip.impots.gouv.fr/bofip/15111-PGP.html/ACTU-2026-00106",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "per_report_ans_ancien",
     "libelle": "Années de report du plafond épargne retraite non utilisé (plafonds jusqu'à 2025)",
     "valeur": 3,
     "unite": "ans",
     "dateEffet": "2019-10-01",
     "dateFin": "2025-12-31",
     "sourceTitre": "Service-public — Plafond de déduction de l'épargne retraite",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F14709",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pfu_taux",
     "libelle": "Prélèvement forfaitaire unique, taux global prélèvements sociaux inclus",
     "valeur": 31.4,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "impots.gouv.fr — Imposition des valeurs mobilières (12,8 % d'impôt + 18,6 % de prélèvements sociaux)",
     "sourceUrl": "https://www.impots.gouv.fr/particulier/questions/jai-des-valeurs-mobilieres-comment-sont-elles-imposees",
     "verifieLe": "2026-10-10"
    },
    {
     "cle": "prepare_duree_premier_enfant_mois",
     "libelle": "PreParE, premier enfant, couple : mois par parent, avant le premier anniversaire",
     "valeur": 6,
     "unite": "mois",
     "dateEffet": "2026-04-01",
     "dateFin": null,
     "sourceTitre": "Service-public — PreParE",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F32485",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "prepare_mi_temps",
     "libelle": "PreParE : montant mensuel, temps partiel à 50 % au plus",
     "valeur": 297.17,
     "unite": "€",
     "dateEffet": "2026-04-01",
     "dateFin": "2027-03-31",
     "sourceTitre": "Service-public — PreParE",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F32485",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "prepare_taux_plein",
     "libelle": "PreParE : montant mensuel, activité interrompue",
     "valeur": 459.7,
     "unite": "€",
     "dateEffet": "2026-04-01",
     "dateFin": "2027-03-31",
     "sourceTitre": "Service-public — Prestation partagée d'éducation de l'enfant (PreParE)",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F32485",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "prepare_temps_partiel",
     "libelle": "PreParE : montant mensuel, temps partiel de 50 à 80 %",
     "valeur": 171.42,
     "unite": "€",
     "dateEffet": "2026-04-01",
     "dateFin": "2027-03-31",
     "sourceTitre": "Service-public — PreParE",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F32485",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ps_taux_actifs_numeriques",
     "libelle": "Prélèvements sociaux sur les plus-values d'actifs numériques",
     "valeur": 18.6,
     "unite": "%",
     "dateEffet": "2025-01-01",
     "dateFin": null,
     "sourceTitre": "Légifrance — CSS art. L136-8 (I 2° : 10,6 % ; IV : liste des revenus restés à 9,2 %, les actifs numériques n'y sont pas)",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051287395",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ps_taux_av_epargne_logement",
     "libelle": "Prélèvements sociaux sur l'assurance-vie, le PEL et le CEL",
     "valeur": 17.2,
     "unite": "%",
     "dateEffet": "2018-01-01",
     "dateFin": null,
     "sourceTitre": "Service-public — Prélèvements sociaux sur les revenus du capital",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F2329",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ps_taux_epargne_salariale",
     "libelle": "Prélèvements sociaux sur les gains de l'épargne salariale (PEE, PERCOL)",
     "valeur": 18.6,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "Légifrance — CSS art. L136-8 (IV) et L136-7 (II)",
     "sourceUrl": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051287395",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ps_taux_foncier",
     "libelle": "Prélèvements sociaux sur les revenus fonciers",
     "valeur": 17.2,
     "unite": "%",
     "dateEffet": "2018-01-01",
     "dateFin": null,
     "sourceTitre": "Service-public — Prélèvements sociaux sur les revenus du capital",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F2329",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "ps_taux_general",
     "libelle": "Prélèvements sociaux sur les revenus du capital, cas général",
     "valeur": 18.6,
     "unite": "%",
     "dateEffet": "2026-01-01",
     "dateFin": null,
     "sourceTitre": "Service-public — Prélèvements sociaux sur les revenus du capital",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F2329",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pv_immo_ir_taux",
     "libelle": "Plus-values immobilières : impôt sur le revenu",
     "valeur": 19,
     "unite": "%",
     "dateEffet": "2014-09-01",
     "dateFin": null,
     "sourceTitre": "Service-public — Plus-value immobilière",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F10864",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pv_immo_ps_taux",
     "libelle": "Plus-values immobilières : prélèvements sociaux",
     "valeur": 17.2,
     "unite": "%",
     "dateEffet": "2018-01-01",
     "dateFin": null,
     "sourceTitre": "Service-public — Prélèvements sociaux sur les revenus du capital",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F2329",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "pv_immo_surtaxe_seuil",
     "libelle": "Plus-values immobilières : seuil de la surtaxe",
     "valeur": 50000,
     "unite": "€",
     "dateEffet": "2013-01-01",
     "dateFin": null,
     "sourceTitre": "Service-public — Plus-value immobilière",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F10864",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "qf_plafond_demi_part",
     "libelle": "Plafonnement de l'avantage par demi-part de quotient familial (revenus 2025)",
     "valeur": 1807,
     "unite": "€",
     "dateEffet": "2026-01-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Service-public — Quotient familial",
     "sourceUrl": "https://www.service-public.gouv.fr/particuliers/vosdroits/F2705",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "rendement_central_actions",
     "libelle": "Actions monde développé : rendement central (convention prudente)",
     "valeur": 6,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": "2027-10-31",
     "sourceTitre": "Convention Boussole : min(historique de marche.js, moyenne Vanguard VCMM 31/03/2026 et Amundi CMA 30/06/2026), arrondi au demi-point inférieur",
     "sourceUrl": "https://research-center.amundi.com/files/nuxeo/dl/6df1bf9d-44de-412e-aa5c-4578e393e8b0",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "rendement_central_autres",
     "libelle": "Actif non classé : rendement central (convention Boussole)",
     "valeur": 4,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": "2027-10-31",
     "sourceTitre": "Convention Boussole : min(historique de marche.js, moyenne Vanguard VCMM 31/03/2026 et Amundi CMA 30/06/2026), arrondi au demi-point inférieur",
     "sourceUrl": "https://research-center.amundi.com/files/nuxeo/dl/6df1bf9d-44de-412e-aa5c-4578e393e8b0",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "rendement_central_crypto",
     "libelle": "Cryptoactifs : rendement central (convention Boussole, aucune source prospective)",
     "valeur": 10,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": "2027-10-31",
     "sourceTitre": "Convention Boussole : min(historique de marche.js, moyenne Vanguard VCMM 31/03/2026 et Amundi CMA 30/06/2026), arrondi au demi-point inférieur",
     "sourceUrl": "https://research-center.amundi.com/files/nuxeo/dl/6df1bf9d-44de-412e-aa5c-4578e393e8b0",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "rendement_central_emergents",
     "libelle": "Actions émergentes : rendement central (convention prudente)",
     "valeur": 6.5,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": "2027-10-31",
     "sourceTitre": "Convention Boussole : min(historique de marche.js, moyenne Vanguard VCMM 31/03/2026 et Amundi CMA 30/06/2026), arrondi au demi-point inférieur",
     "sourceUrl": "https://research-center.amundi.com/files/nuxeo/dl/6df1bf9d-44de-412e-aa5c-4578e393e8b0",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "rendement_central_fonds_euros",
     "libelle": "Fonds euros : rendement central (convention, historique 2015-2024)",
     "valeur": 2.5,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": "2027-10-31",
     "sourceTitre": "Convention Boussole : min(historique de marche.js, moyenne Vanguard VCMM 31/03/2026 et Amundi CMA 30/06/2026), arrondi au demi-point inférieur",
     "sourceUrl": "https://research-center.amundi.com/files/nuxeo/dl/6df1bf9d-44de-412e-aa5c-4578e393e8b0",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "rendement_central_immobilier",
     "libelle": "SCPI et pierre-papier : rendement central (convention prudente)",
     "valeur": 4.5,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": "2027-10-31",
     "sourceTitre": "Convention Boussole : min(historique de marche.js, moyenne Vanguard VCMM 31/03/2026 et Amundi CMA 30/06/2026), arrondi au demi-point inférieur",
     "sourceUrl": "https://research-center.amundi.com/files/nuxeo/dl/6df1bf9d-44de-412e-aa5c-4578e393e8b0",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "rendement_central_monetaire",
     "libelle": "Monétaire : rendement central (convention prudente)",
     "valeur": 1.5,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": "2027-10-31",
     "sourceTitre": "Convention Boussole : min(historique de marche.js, moyenne Vanguard VCMM 31/03/2026 et Amundi CMA 30/06/2026), arrondi au demi-point inférieur",
     "sourceUrl": "https://research-center.amundi.com/files/nuxeo/dl/6df1bf9d-44de-412e-aa5c-4578e393e8b0",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "rendement_central_obligations",
     "libelle": "Obligations zone euro : rendement central (convention prudente)",
     "valeur": 3.5,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": "2027-10-31",
     "sourceTitre": "Convention Boussole : min(historique de marche.js, moyenne Vanguard VCMM 31/03/2026 et Amundi CMA 30/06/2026), arrondi au demi-point inférieur",
     "sourceUrl": "https://research-center.amundi.com/files/nuxeo/dl/6df1bf9d-44de-412e-aa5c-4578e393e8b0",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "rendement_central_or",
     "libelle": "Or : rendement central (convention prudente)",
     "valeur": 4,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": "2027-10-31",
     "sourceTitre": "Convention Boussole : min(historique de marche.js, moyenne Vanguard VCMM 31/03/2026 et Amundi CMA 30/06/2026), arrondi au demi-point inférieur",
     "sourceUrl": "https://research-center.amundi.com/files/nuxeo/dl/6df1bf9d-44de-412e-aa5c-4578e393e8b0",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "rendement_central_small_caps",
     "libelle": "Petites capitalisations : rendement central (convention prudente, sans prime de taille)",
     "valeur": 6,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": "2027-10-31",
     "sourceTitre": "Convention Boussole : min(historique de marche.js, moyenne Vanguard VCMM 31/03/2026 et Amundi CMA 30/06/2026), arrondi au demi-point inférieur",
     "sourceUrl": "https://research-center.amundi.com/files/nuxeo/dl/6df1bf9d-44de-412e-aa5c-4578e393e8b0",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "retro_min_origines",
     "libelle": "Rétro-contrôle : nombre minimal de dates de départ pour afficher la couverture (convention Boussole)",
     "valeur": 24,
     "unite": "dates",
     "dateEffet": "2026-10-14",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec PROJ § 6.8, § 6.9)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-14-proj-projection-design.md",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "revenus_locatifs_ponderation",
     "libelle": "Part des loyers retenue dans les revenus (convention bancaire usuelle)",
     "valeur": 70,
     "unite": "%",
     "dateEffet": "2026-10-14",
     "dateFin": null,
     "sourceTitre": "Convention bancaire usuelle, reprise de Rang (toise.js) ; ce n'est pas une règle du HCSF",
     "sourceUrl": "https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000044178678",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "salaire_croissance_reelle",
     "libelle": "Hausse réelle des salaires par an (moyenne 1996-2024, calcul Boussole)",
     "valeur": 0.5,
     "unite": "%",
     "dateEffet": "2025-10-23",
     "dateFin": null,
     "sourceTitre": "Insee Première n° 2079 — Les salaires dans le secteur privé en 2024",
     "sourceUrl": "https://www.insee.fr/fr/statistiques/8657156",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "scn_delai_ouverture_mois",
     "libelle": "Délai supposé entre la décision et l'ouverture d'une enveloppe (convention Boussole)",
     "valeur": 1,
     "unite": "mois",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN1 § 7.1 et § 8.4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-17-scn1-scenarios-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "scn_enjeu_min_eur_an",
     "libelle": "Enjeu en dessous duquel une carte n'entre pas dans « Pour toi » (convention Boussole)",
     "valeur": 30,
     "unite": "€",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN1 § 8.4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-17-scn1-scenarios-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "scn_immo_frais_revente_pct",
     "libelle": "Locatif : frais de revente à la charge du vendeur (convention Boussole)",
     "valeur": 5,
     "unite": "%",
     "dateEffet": "2026-10-26",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN n° 20, locatif ou SCPI, § 4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-26-scn-locatif-scpi-design.md",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "scn_lmnp_duree_bati_ans",
     "libelle": "Meublé au réel : durée d'amortissement du bâti (convention Boussole)",
     "valeur": 30,
     "unite": "ans",
     "dateEffet": "2026-10-26",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN n° 20, locatif ou SCPI, § 4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-26-scn-locatif-scpi-design.md",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "scn_lmnp_duree_mobilier_ans",
     "libelle": "Meublé au réel : durée d'amortissement du mobilier (convention Boussole)",
     "valeur": 7,
     "unite": "ans",
     "dateEffet": "2026-10-26",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN n° 20, locatif ou SCPI, § 4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-26-scn-locatif-scpi-design.md",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "scn_lmnp_duree_travaux_ans",
     "libelle": "Meublé au réel : durée d'amortissement des travaux (convention Boussole)",
     "valeur": 10,
     "unite": "ans",
     "dateEffet": "2026-10-26",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN n° 20, locatif ou SCPI, § 4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-26-scn-locatif-scpi-design.md",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "scn_lmnp_part_terrain_pct",
     "libelle": "Meublé au réel : part du terrain, non amortissable (convention Boussole)",
     "valeur": 15,
     "unite": "%",
     "dateEffet": "2026-10-26",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN n° 20, locatif ou SCPI, § 4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-26-scn-locatif-scpi-design.md",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "scn_locatif_vacance_mois",
     "libelle": "Locatif : mois sans locataire par an (convention Boussole)",
     "valeur": 1,
     "unite": "mois",
     "dateEffet": "2026-10-26",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN n° 20, locatif ou SCPI, § 4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-26-scn-locatif-scpi-design.md",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "scn_matelas_ecart_pct",
     "libelle": "Matelas : écart à la cible qui met la carte « pour toi » (convention Boussole)",
     "valeur": 25,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN1 § 8.4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-17-scn1-scenarios-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "scn_matelas_mois_fragile",
     "libelle": "Matelas : mois de dépenses essentielles, un seul revenu, enfants à charge ou revenus variables (convention Boussole)",
     "valeur": 6,
     "unite": "mois",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN1 § 7.4 et § 8.4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-17-scn1-scenarios-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "scn_matelas_mois_independant",
     "libelle": "Matelas : mois de dépenses essentielles, indépendant, chef d'entreprise ou sans revenu d'activité (convention Boussole)",
     "valeur": 9,
     "unite": "mois",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN1 § 7.4 et § 8.4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-17-scn1-scenarios-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "scn_matelas_mois_stable",
     "libelle": "Matelas : mois de dépenses essentielles, deux revenus stables (convention Boussole)",
     "valeur": 3,
     "unite": "mois",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN1 § 7.4 et § 8.4 ; repère public : 2 à 6 mois de revenus, Banque de France, mesquestionsdargent.fr)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-17-scn1-scenarios-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "scn_scpi_delai_jouissance_mois",
     "libelle": "SCPI : délai de jouissance (convention Boussole)",
     "valeur": 4,
     "unite": "mois",
     "dateEffet": "2026-10-26",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN n° 20, locatif ou SCPI, § 4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-26-scn-locatif-scpi-design.md",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "scn_scpi_frais_souscription_pct",
     "libelle": "SCPI : frais de souscription (convention Boussole, fourchette usuelle 8 à 12 %)",
     "valeur": 10,
     "unite": "%",
     "dateEffet": "2026-10-26",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SCN n° 20, locatif ou SCPI, § 4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-26-scn-locatif-scpi-design.md",
     "verifieLe": "2026-10-26"
    },
    {
     "cle": "scpi_taux_distribution",
     "libelle": "Taux de distribution moyen des SCPI (2025)",
     "valeur": 4.91,
     "unite": "%",
     "dateEffet": "2025-12-31",
     "dateFin": "2026-12-31",
     "sourceTitre": "ASPIM — SCPI en chiffres",
     "sourceUrl": "https://www.aspim.fr/scpi-en-chiffres/",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "suivi_aggravation_pct",
     "libelle": "Aggravation d'une mesure qui fait remontrer un déclencheur avant la revue suivante (convention Boussole)",
     "valeur": 50,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_anciennete_fonds_ans",
     "libelle": "Ancienneté d'un fonds jugée suffisante pour le constat de solidité (convention Boussole)",
     "valeur": 3,
     "unite": "ans",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_arbitrage_av_defaut_pct",
     "libelle": "Frais d'arbitrage supposés d'un contrat dont les frais ne sont pas renseignés (convention Boussole, prudente)",
     "valeur": 1,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; sources de place non officielles : rarement plus de 1 %",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_chevauchement_surveiller_pct",
     "libelle": "Chevauchement pondéré des 10 premières lignes de deux fonds « à surveiller » (convention Boussole)",
     "valeur": 30,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_chevauchement_travailler_pct",
     "libelle": "Chevauchement pondéré des 10 premières lignes de deux fonds « à travailler » (convention Boussole)",
     "valeur": 60,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_cout_bon_marge_pct",
     "libelle": "Marge au-dessus du bas du repère de classe pour un coût « bon » (convention Boussole)",
     "valeur": 0.1,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_couverture_min_pct",
     "libelle": "Part des constats applicables calculés en dessous de laquelle la météo est « à compléter » (convention Boussole)",
     "valeur": 60,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_croisement_exposition_pct",
     "libelle": "Exposition à une devise, une zone ou un pays qui fait apparaître un événement dans « Ta semaine » (convention Boussole)",
     "valeur": 5,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_croisement_societe_pct",
     "libelle": "Poids par transparence d'une société qui fait apparaître ses événements dans « Ta semaine » (convention Boussole)",
     "valeur": 1,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_demi_ecart_cote_pct",
     "libelle": "Coût d'écart achat-vente supposé par ordre sur un titre coté (convention Boussole, prudente)",
     "valeur": 0.1,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; aucune source publique trouvée",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_devise_info_pct",
     "libelle": "Part du financier en devises étrangères au-delà de laquelle le constat devise le signale (information)",
     "valeur": 50,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_devise_prudent_pct",
     "libelle": "Part en devises étrangères « à surveiller » pour un profil Prudent (convention Boussole)",
     "valeur": 30,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_encours_bas_eur",
     "libelle": "Encours d'un fonds en dessous duquel la solidité est « à surveiller » (convention Boussole)",
     "valeur": 20000000,
     "unite": "€",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; aucune source publique trouvée : jamais « à travailler »",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_encours_bon_eur",
     "libelle": "Encours d'un fonds jugé suffisant pour le constat de solidité (convention Boussole, à surveiller au plus)",
     "valeur": 100000000,
     "unite": "€",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; aucune source publique trouvée : jamais « à travailler »",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_frais_plancher_pct",
     "libelle": "Frais d'un fonds en dessous desquels aucun déclencheur de frais n'est créé (convention de CP4)",
     "valeur": 0.5,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; même plancher que fraisSupports (CP4)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_horizon_long_ans",
     "libelle": "Horizon à partir duquel le cœur est revu une fois par an (convention Boussole)",
     "valeur": 8,
     "unite": "ans",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_horizon_reserve_ans",
     "libelle": "Échéance d'objectif en dessous de laquelle l'argent sans risque est rangé en réserve (convention Boussole)",
     "valeur": 3,
     "unite": "ans",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; même seuil que le projet proche de CP4 § 1.3",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_horizon_suppose_ans",
     "libelle": "Horizon supposé d'une ligne sans objectif (convention Boussole)",
     "valeur": 10,
     "unite": "ans",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_ligne_satellite_max_pct",
     "libelle": "Poids d'une ligne satellite dans le financier investi au-delà duquel une revue est proposée (repère Boussole d'après la règle des OPCVM)",
     "valeur": 5,
     "unite": "%",
     "dateEffet": "2009-07-13",
     "dateFin": null,
     "sourceTitre": "Directive 2009/65/CE (OPCVM), art. 52 : 5 % par émetteur, porté à 10 % au plus (texte de l'UE tel qu'adopté)",
     "sourceUrl": "https://www.legislation.gov.uk/eudr/2009/65/article/52/adopted",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_plafond_satellite_dynamique",
     "libelle": "Plafond satellite par défaut, profil Dynamique (repère Boussole, prudent)",
     "valeur": 20,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_plafond_satellite_equilibre",
     "libelle": "Plafond satellite par défaut, profil Équilibré (repère Boussole, prudent)",
     "valeur": 15,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_plafond_satellite_modere",
     "libelle": "Plafond satellite par défaut, profil Modéré ou profil à faire (repère Boussole, prudent)",
     "valeur": 10,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_plafond_satellite_offensif",
     "libelle": "Plafond satellite par défaut, profil Offensif (repère Boussole, prudent)",
     "valeur": 25,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_plafond_satellite_prudent",
     "libelle": "Plafond satellite par défaut, profil Prudent (repère Boussole, prudent)",
     "valeur": 5,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; pratique cœur-satellite sans norme publique",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_point_mort_max_ans",
     "libelle": "Point mort au-delà duquel un changement n'est plus « ça vaut le coût » (convention Boussole)",
     "valeur": 3,
     "unite": "ans",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_point_mort_part_horizon_pct",
     "libelle": "Part de l'horizon au-delà de laquelle un changement n'est plus « ça vaut le coût » (convention Boussole)",
     "valeur": 50,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_revue_coeur_annuelle_mois",
     "libelle": "Fréquence de revue du cœur, horizon long (annuelle)",
     "valeur": 12,
     "unite": "mois",
     "dateEffet": "2010-07-01",
     "dateFin": null,
     "sourceTitre": "Vanguard — Jaconetti, Kinniry, Zilbering, « Best practices for portfolio rebalancing », juillet 2010 (copie lue chez un tiers)",
     "sourceUrl": "https://indexacapital.com/bundles/unaiadvisor/docs/papers/2010-Vanguard-Best-practices-for-portfolio-rebalancing.pdf",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_revue_coeur_semestrielle_mois",
     "libelle": "Fréquence de revue du cœur, horizon de 3 à 8 ans (semestrielle)",
     "valeur": 6,
     "unite": "mois",
     "dateEffet": "2010-07-01",
     "dateFin": null,
     "sourceTitre": "Vanguard — Jaconetti, Kinniry, Zilbering, « Best practices for portfolio rebalancing », juillet 2010 (copie lue chez un tiers)",
     "sourceUrl": "https://indexacapital.com/bundles/unaiadvisor/docs/papers/2010-Vanguard-Best-practices-for-portfolio-rebalancing.pdf",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_seuil_baisse_satellite_pct",
     "libelle": "Baisse d'une ligne satellite qui déclenche une revue de sa raison de détention (repère Boussole, prudent)",
     "valeur": 25,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0)",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_seuil_ecart_pts",
     "libelle": "Écart d'une classe à sa fourchette cible qui déclenche une revue, en points (repère Boussole d'après Vanguard)",
     "valeur": 5,
     "unite": "%",
     "dateEffet": "2010-07-01",
     "dateFin": null,
     "sourceTitre": "Vanguard — Jaconetti, Kinniry, Zilbering, « Best practices for portfolio rebalancing », juillet 2010 (copie lue chez un tiers)",
     "sourceUrl": "https://indexacapital.com/bundles/unaiadvisor/docs/papers/2010-Vanguard-Best-practices-for-portfolio-rebalancing.pdf",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_societe_max_pct",
     "libelle": "Poids d'une société (en direct et par transparence) dans le financier investi au-delà duquel une revue est proposée (repère Boussole d'après la règle des OPCVM)",
     "valeur": 10,
     "unite": "%",
     "dateEffet": "2009-07-13",
     "dateFin": null,
     "sourceTitre": "Directive 2009/65/CE (OPCVM), art. 52 : 5 % par émetteur, porté à 10 % au plus (texte de l'UE tel qu'adopté)",
     "sourceUrl": "https://www.legislation.gov.uk/eudr/2009/65/article/52/adopted",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "suivi_volatilite_surveiller_pct",
     "libelle": "Volatilité de classe à partir de laquelle le constat de risque est « à surveiller » (convention Boussole)",
     "valeur": 20,
     "unite": "%",
     "dateEffet": "2026-10-15",
     "dateFin": null,
     "sourceTitre": "Convention Boussole (spec SUIVI § 4 et § 5, tâche 0) ; volatilités de marche.js",
     "sourceUrl": "https://github.com/Steph1237/boussole/blob/main/docs/superpowers/specs/2026-10-15-suivi-lignes-design.md",
     "verifieLe": "2026-10-15"
    },
    {
     "cle": "taux_credit_immo_15",
     "libelle": "Taux moyen des crédits immobiliers sur 15 ans (août 2026)",
     "valeur": 3.14,
     "unite": "%",
     "dateEffet": "2026-08-01",
     "dateFin": "2026-10-31",
     "sourceTitre": "Observatoire Crédit Logement/CSA — analyse du marché, août 2026",
     "sourceUrl": "https://lobservatoire.creditlogement.fr/publications/analyse-marche-immobilier-aout-2026/",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "taux_credit_immo_20",
     "libelle": "Taux moyen des crédits immobiliers sur 20 ans (août 2026)",
     "valeur": 3.27,
     "unite": "%",
     "dateEffet": "2026-08-01",
     "dateFin": "2026-10-31",
     "sourceTitre": "Observatoire Crédit Logement/CSA — analyse du marché, août 2026",
     "sourceUrl": "https://lobservatoire.creditlogement.fr/publications/analyse-marche-immobilier-aout-2026/",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "taux_credit_immo_25",
     "libelle": "Taux moyen des crédits immobiliers sur 25 ans (août 2026)",
     "valeur": 3.35,
     "unite": "%",
     "dateEffet": "2026-08-01",
     "dateFin": "2026-10-31",
     "sourceTitre": "Observatoire Crédit Logement/CSA — analyse du marché, août 2026",
     "sourceUrl": "https://lobservatoire.creditlogement.fr/publications/analyse-marche-immobilier-aout-2026/",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "taux_usure_10_20",
     "libelle": "Taux d'usure, prêt immobilier à taux fixe de 10 à moins de 20 ans",
     "valeur": 4.68,
     "unite": "%",
     "dateEffet": "2026-10-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Banque de France — taux d'usure 2026-T4",
     "sourceUrl": "https://www.banque-france.fr/fr/statistiques/taux-et-cours/taux-dusure-2026-q4",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "taux_usure_20_plus",
     "libelle": "Taux d'usure, prêt immobilier à taux fixe de 20 ans et plus",
     "valeur": 5.4,
     "unite": "%",
     "dateEffet": "2026-10-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Banque de France — taux d'usure 2026-T4",
     "sourceUrl": "https://www.banque-france.fr/fr/statistiques/taux-et-cours/taux-dusure-2026-q4",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "taux_usure_moins_10",
     "libelle": "Taux d'usure, prêt immobilier à taux fixe de moins de 10 ans",
     "valeur": 4.09,
     "unite": "%",
     "dateEffet": "2026-10-01",
     "dateFin": "2026-12-31",
     "sourceTitre": "Banque de France — taux d'usure 2026-T4",
     "sourceUrl": "https://www.banque-france.fr/fr/statistiques/taux-et-cours/taux-dusure-2026-q4",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "uc_adulte_supplementaire",
     "libelle": "Unité de consommation d'une personne de 14 ans ou plus (hors premier adulte)",
     "valeur": 0.5,
     "unite": "UC",
     "dateEffet": "2022-12-16",
     "dateFin": null,
     "sourceTitre": "Insee — définition « Unité de consommation »",
     "sourceUrl": "https://www.insee.fr/fr/metadonnees/definition/c1802",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "uc_age_seuil",
     "libelle": "Âge à partir duquel un enfant compte 0,5 UC",
     "valeur": 14,
     "unite": "ans",
     "dateEffet": "2022-12-16",
     "dateFin": null,
     "sourceTitre": "Insee — définition « Unité de consommation »",
     "sourceUrl": "https://www.insee.fr/fr/metadonnees/definition/c1802",
     "verifieLe": "2026-10-14"
    },
    {
     "cle": "uc_enfant_moins_14",
     "libelle": "Unité de consommation d'un enfant de moins de 14 ans",
     "valeur": 0.3,
     "unite": "UC",
     "dateEffet": "2022-12-16",
     "dateFin": null,
     "sourceTitre": "Insee — définition « Unité de consommation »",
     "sourceUrl": "https://www.insee.fr/fr/metadonnees/definition/c1802",
     "verifieLe": "2026-10-14"
    }
   ],
   "reperes_scenarios": [
    "assurance_emprunteur_defaut_pct",
    "av_990i_abattement",
    "av_abattement_couple",
    "av_abattement_seul",
    "av_age_seuil",
    "av_duree_ans",
    "av_seuil_versements",
    "av_taux_ir_reduit",
    "deficit_bic_report_ans",
    "deficit_foncier_plafond",
    "deficit_foncier_report_ans",
    "frais_acquisition_ancien_pct",
    "frais_acquisition_neuf_pct",
    "frais_dossier",
    "garantie_pct",
    "immo_revalorisation_reelle",
    "immo_volatilite",
    "inflation_hypothese",
    "ir_bareme_11_seuil",
    "ir_bareme_30_seuil",
    "ir_bareme_41_seuil",
    "ir_bareme_45_seuil",
    "ir_taux_forfaitaire",
    "ldds_plafond",
    "lep_plafond",
    "lep_rfr_1_part",
    "lep_rfr_demi_part_sup",
    "lep_rfr_quart_part_sup",
    "lep_taux",
    "livret_a_plafond",
    "livret_a_taux",
    "micro_bic_abattement_pct",
    "micro_bic_plafond",
    "micro_foncier_abattement_pct",
    "micro_foncier_plafond",
    "pea_duree_ans",
    "pea_plafond",
    "per_age_fin_deduction",
    "per_plafond_max",
    "per_plafond_plancher",
    "per_plafond_taux_revenus",
    "per_report_ans",
    "per_report_ans_ancien",
    "ps_taux_av_epargne_logement",
    "ps_taux_foncier",
    "ps_taux_general",
    "pv_immo_ir_taux",
    "pv_immo_ps_taux",
    "pv_immo_surtaxe_seuil",
    "rendement_central_actions",
    "rendement_central_fonds_euros",
    "rendement_central_immobilier",
    "rendement_central_monetaire",
    "rendement_central_obligations",
    "scn_delai_ouverture_mois",
    "scn_enjeu_min_eur_an",
    "scn_immo_frais_revente_pct",
    "scn_lmnp_duree_bati_ans",
    "scn_lmnp_duree_mobilier_ans",
    "scn_lmnp_duree_travaux_ans",
    "scn_lmnp_part_terrain_pct",
    "scn_locatif_vacance_mois",
    "scn_matelas_ecart_pct",
    "scn_matelas_mois_fragile",
    "scn_matelas_mois_independant",
    "scn_matelas_mois_stable",
    "scn_scpi_delai_jouissance_mois",
    "scn_scpi_frais_souscription_pct",
    "scpi_taux_distribution",
    "suivi_horizon_suppose_ans",
    "taux_credit_immo_20"
   ]
  };
  if (typeof module === "object" && module.exports) module.exports = ScenariosCatalogue;
  else root.ScenariosCatalogue = ScenariosCatalogue;
})(typeof self !== "undefined" ? self : this);
