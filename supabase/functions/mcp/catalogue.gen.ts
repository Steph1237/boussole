// Fichier généré par scripts/gen-catalogue.mjs (npm run gen) : ne pas modifier à la main.
// Catalogue des champs des formulaires dynamiques (source unique : web/src/risque.js, web/src/bilan-etat.js, schéma du profil).
// Chaque champ : { champ, theme, type: choix|multi|curseur|montant|date|booleen|texte_court, libelle, aide?, valeurs?: [{ v, label, exclusif? }],
// min?, max?, pas?, unite?, reperes?, cible: profil|risque|protection, chemin } ; {nom} dans un libellé = prénom de la personne.
export const CATALOGUE: any[] = [
  {
    "champ": "foyer.adultes",
    "theme": "Foyer",
    "type": "choix",
    "libelle": "Combien d'adultes composent ton foyer ?",
    "aide": "Le niveau de vie et l'impôt dépendent de la taille du foyer.",
    "valeurs": [
      {
        "v": 1,
        "label": "1 adulte"
      },
      {
        "v": 2,
        "label": "2 adultes"
      },
      {
        "v": 3,
        "label": "3 adultes ou plus"
      }
    ],
    "cible": "profil",
    "chemin": "foyer.adultes"
  },
  {
    "champ": "foyer.enfants",
    "theme": "Foyer",
    "type": "choix",
    "libelle": "Combien d'enfants as-tu à charge ?",
    "aide": "Ils comptent dans l'impôt, le budget et la protection à prévoir.",
    "valeurs": [
      {
        "v": 0,
        "label": "Aucun"
      },
      {
        "v": 1,
        "label": "1 enfant"
      },
      {
        "v": 2,
        "label": "2 enfants"
      },
      {
        "v": 3,
        "label": "3 enfants"
      },
      {
        "v": 4,
        "label": "4 enfants ou plus"
      }
    ],
    "cible": "profil",
    "chemin": "foyer.enfants"
  },
  {
    "champ": "foyer.age",
    "theme": "Foyer",
    "type": "choix",
    "libelle": "Quelle est la tranche d'âge de la personne qui gagne le plus ?",
    "aide": "L'horizon de placement et les repères de patrimoine dépendent de l'âge.",
    "valeurs": [
      {
        "v": "u30",
        "label": "Moins de 30 ans"
      },
      {
        "v": "a30",
        "label": "30 à 39 ans"
      },
      {
        "v": "a40",
        "label": "40 à 49 ans"
      },
      {
        "v": "a50",
        "label": "50 à 59 ans"
      },
      {
        "v": "a60",
        "label": "60 à 69 ans"
      },
      {
        "v": "a70",
        "label": "70 ans ou plus"
      }
    ],
    "cible": "profil",
    "chemin": "foyer.age"
  },
  {
    "champ": "foyer.tmi",
    "theme": "Foyer",
    "type": "choix",
    "libelle": "Quelle est ta tranche marginale d'imposition ?",
    "aide": "Elle détermine l'intérêt du PER et la fiscalité de tes placements. Elle figure sur ton avis d'imposition.",
    "valeurs": [
      {
        "v": 0,
        "label": "0 % (non imposable)"
      },
      {
        "v": 11,
        "label": "11 %"
      },
      {
        "v": 30,
        "label": "30 %"
      },
      {
        "v": 41,
        "label": "41 %"
      },
      {
        "v": 45,
        "label": "45 %"
      }
    ],
    "cible": "profil",
    "chemin": "foyer.tmi"
  },
  {
    "champ": "personnes.p1.nom",
    "theme": "Revenus",
    "type": "texte_court",
    "libelle": "Quel est le prénom de la personne 1 ?",
    "aide": "Il sert à nommer chaque personne du foyer dans Boussole.",
    "max": 40,
    "cible": "profil",
    "chemin": "personnes.p1.nom"
  },
  {
    "champ": "personnes.p1.salaire",
    "theme": "Revenus",
    "type": "montant",
    "libelle": "Quel est le salaire de {nom} ?",
    "aide": "C'est la base de la capacité d'épargne, de l'endettement et de la capacité d'emprunt.",
    "min": 0,
    "unite": "€",
    "cible": "profil",
    "chemin": "personnes.p1.salaire"
  },
  {
    "champ": "personnes.p1.salaireUnite",
    "theme": "Revenus",
    "type": "choix",
    "libelle": "Ce salaire de {nom} est-il net ou brut, par mois ou par an ?",
    "aide": "Boussole ramène tout en net mensuel pour ses calculs.",
    "valeurs": [
      {
        "v": "nm",
        "label": "net / mois"
      },
      {
        "v": "na",
        "label": "net / an"
      },
      {
        "v": "bm",
        "label": "brut / mois"
      },
      {
        "v": "ba",
        "label": "brut / an"
      }
    ],
    "cible": "profil",
    "chemin": "personnes.p1.salaireUnite"
  },
  {
    "champ": "personnes.p1.statut",
    "theme": "Revenus",
    "type": "choix",
    "libelle": "Quel est le statut de {nom} ?",
    "aide": "Utile pour convertir un salaire brut en net.",
    "valeurs": [
      {
        "v": "cadre",
        "label": "Cadre"
      },
      {
        "v": "nc",
        "label": "Non-cadre"
      }
    ],
    "cible": "profil",
    "chemin": "personnes.p1.statut"
  },
  {
    "champ": "personnes.p1.autresRevenus",
    "theme": "Revenus",
    "type": "montant",
    "libelle": "Quels autres revenus nets perçoit {nom} chaque mois (hors loyers des biens) ?",
    "aide": "Pension, revenus d'indépendant, rentes… 0 s'il n'y en a pas.",
    "min": 0,
    "unite": "€ / mois",
    "cible": "profil",
    "chemin": "personnes.p1.autresRevenus"
  },
  {
    "champ": "personnes.p2.nom",
    "theme": "Revenus",
    "type": "texte_court",
    "libelle": "Quel est le prénom de la personne 2 ?",
    "aide": "Il sert à nommer chaque personne du foyer dans Boussole.",
    "max": 40,
    "cible": "profil",
    "chemin": "personnes.p2.nom"
  },
  {
    "champ": "personnes.p2.salaire",
    "theme": "Revenus",
    "type": "montant",
    "libelle": "Quel est le salaire de {nom} ?",
    "aide": "C'est la base de la capacité d'épargne, de l'endettement et de la capacité d'emprunt.",
    "min": 0,
    "unite": "€",
    "cible": "profil",
    "chemin": "personnes.p2.salaire"
  },
  {
    "champ": "personnes.p2.salaireUnite",
    "theme": "Revenus",
    "type": "choix",
    "libelle": "Ce salaire de {nom} est-il net ou brut, par mois ou par an ?",
    "aide": "Boussole ramène tout en net mensuel pour ses calculs.",
    "valeurs": [
      {
        "v": "nm",
        "label": "net / mois"
      },
      {
        "v": "na",
        "label": "net / an"
      },
      {
        "v": "bm",
        "label": "brut / mois"
      },
      {
        "v": "ba",
        "label": "brut / an"
      }
    ],
    "cible": "profil",
    "chemin": "personnes.p2.salaireUnite"
  },
  {
    "champ": "personnes.p2.statut",
    "theme": "Revenus",
    "type": "choix",
    "libelle": "Quel est le statut de {nom} ?",
    "aide": "Utile pour convertir un salaire brut en net.",
    "valeurs": [
      {
        "v": "cadre",
        "label": "Cadre"
      },
      {
        "v": "nc",
        "label": "Non-cadre"
      }
    ],
    "cible": "profil",
    "chemin": "personnes.p2.statut"
  },
  {
    "champ": "personnes.p2.autresRevenus",
    "theme": "Revenus",
    "type": "montant",
    "libelle": "Quels autres revenus nets perçoit {nom} chaque mois (hors loyers des biens) ?",
    "aide": "Pension, revenus d'indépendant, rentes… 0 s'il n'y en a pas.",
    "min": 0,
    "unite": "€ / mois",
    "cible": "profil",
    "chemin": "personnes.p2.autresRevenus"
  },
  {
    "champ": "autres.p1.usage",
    "theme": "Autres actifs",
    "type": "montant",
    "libelle": "Quelle est la valeur des biens d'usage de {nom} (véhicule, mobilier…) ?",
    "min": 0,
    "unite": "€",
    "cible": "profil",
    "chemin": "autres.p1.usage"
  },
  {
    "champ": "autres.p1.entreprise",
    "theme": "Autres actifs",
    "type": "montant",
    "libelle": "Quelle est la valeur des parts d'entreprise de {nom} ?",
    "min": 0,
    "unite": "€",
    "cible": "profil",
    "chemin": "autres.p1.entreprise"
  },
  {
    "champ": "autres.p2.usage",
    "theme": "Autres actifs",
    "type": "montant",
    "libelle": "Quelle est la valeur des biens d'usage de {nom} (véhicule, mobilier…) ?",
    "min": 0,
    "unite": "€",
    "cible": "profil",
    "chemin": "autres.p2.usage"
  },
  {
    "champ": "autres.p2.entreprise",
    "theme": "Autres actifs",
    "type": "montant",
    "libelle": "Quelle est la valeur des parts d'entreprise de {nom} ?",
    "min": 0,
    "unite": "€",
    "cible": "profil",
    "chemin": "autres.p2.entreprise"
  },
  {
    "champ": "protection.prevoyance",
    "theme": "Protection",
    "type": "booleen",
    "libelle": "As-tu une prévoyance (décès, invalidité) au-delà de celle de ton employeur ?",
    "aide": "Protéger les revenus du foyer passe avant l'investissement.",
    "cible": "protection",
    "chemin": "prevoyance"
  },
  {
    "champ": "protection.emprunteur",
    "theme": "Protection",
    "type": "booleen",
    "libelle": "Tes crédits sont-ils couverts par une assurance emprunteur ?",
    "aide": "Elle protège le foyer si un emprunteur ne peut plus rembourser.",
    "cible": "protection",
    "chemin": "emprunteur"
  },
  {
    "champ": "risque.horizon",
    "theme": "Horizon",
    "libelle": "Dans combien de temps auras-tu besoin de la majeure partie de cet argent ?",
    "aide": "Plus l'échéance est lointaine, plus tu as le temps d'attendre qu'une baisse soit rattrapée.",
    "type": "choix",
    "valeurs": [
      {
        "v": "lt2",
        "label": "Moins de 2 ans"
      },
      {
        "v": "2-5",
        "label": "2 à 5 ans"
      },
      {
        "v": "5-8",
        "label": "5 à 8 ans"
      },
      {
        "v": "8-15",
        "label": "8 à 15 ans"
      },
      {
        "v": "gt15",
        "label": "Plus de 15 ans"
      }
    ],
    "cible": "risque",
    "chemin": "horizon"
  },
  {
    "champ": "risque.objectif",
    "theme": "Objectif",
    "libelle": "Qu'attends-tu d'abord de tes placements ?",
    "type": "choix",
    "valeurs": [
      {
        "v": "preserver",
        "label": "Préserver ce que j'ai, sans perte"
      },
      {
        "v": "revenus",
        "label": "Compléter mes revenus régulièrement"
      },
      {
        "v": "croissance",
        "label": "Faire croître mon épargne à moyen terme"
      },
      {
        "v": "maximiser",
        "label": "Obtenir le meilleur rendement à long terme, en acceptant de fortes variations"
      }
    ],
    "cible": "risque",
    "chemin": "objectif"
  },
  {
    "champ": "risque.reaction",
    "theme": "Réaction à une baisse",
    "libelle": "Tes placements perdent 20 % en trois mois. Que fais-tu ?",
    "aide": "Ce genre de baisse arrive en moyenne une fois tous les 5 à 10 ans sur les actions. Réponds selon ce que tu ferais vraiment.",
    "type": "choix",
    "valeurs": [
      {
        "v": "vendre_tout",
        "label": "Je vends tout pour arrêter les pertes"
      },
      {
        "v": "vendre_partie",
        "label": "J'en vends une partie"
      },
      {
        "v": "rien",
        "label": "Je ne fais rien et j'attends"
      },
      {
        "v": "renforcer",
        "label": "J'en profite pour investir davantage"
      }
    ],
    "cible": "risque",
    "chemin": "reaction"
  },
  {
    "champ": "risque.perte_max",
    "theme": "Perte maximale",
    "libelle": "Quelle baisse temporaire de tes placements, sur une année, pourrais-tu supporter sans changer tes plans ?",
    "aide": "Une baisse temporaire n'est une perte que si l'on vend au plus bas. Indique ce que tu supporterais sans dormir moins bien.",
    "type": "choix",
    "valeurs": [
      {
        "v": "p5",
        "label": "5 %"
      },
      {
        "v": "p10",
        "label": "10 %"
      },
      {
        "v": "p20",
        "label": "20 %"
      },
      {
        "v": "p35",
        "label": "35 %"
      },
      {
        "v": "plus",
        "label": "Plus de 35 %"
      }
    ],
    "cible": "risque",
    "chemin": "perte_max"
  },
  {
    "champ": "risque.connaissances",
    "theme": "Connaissances",
    "libelle": "Quels placements connais-tu assez pour expliquer comment ils gagnent ou perdent de la valeur ?",
    "aide": "Coche tout ce qui s'applique. Un ETF (ou « tracker ») est un fonds coté qui réplique un indice, par exemple les grandes entreprises mondiales. Un produit à levier amplifie les hausses comme les baisses.",
    "type": "multi",
    "valeurs": [
      {
        "v": "livrets",
        "label": "Livrets d'épargne"
      },
      {
        "v": "fonds_euros",
        "label": "Fonds euros d'assurance-vie"
      },
      {
        "v": "etf",
        "label": "ETF (fonds indiciels cotés)"
      },
      {
        "v": "actions",
        "label": "Actions"
      },
      {
        "v": "obligations",
        "label": "Obligations"
      },
      {
        "v": "crypto",
        "label": "Cryptoactifs"
      },
      {
        "v": "levier",
        "label": "Produits à effet de levier"
      },
      {
        "v": "aucun",
        "label": "Aucun de ces placements",
        "exclusif": true
      }
    ],
    "cible": "risque",
    "chemin": "connaissances"
  },
  {
    "champ": "risque.experience",
    "theme": "Expérience",
    "libelle": "Depuis combien d'années investis-tu en bourse (actions, ETF ou fonds) ?",
    "aide": "Indique 0 si tu n'as jamais investi en bourse.",
    "type": "curseur",
    "min": 0,
    "max": 80,
    "pas": 1,
    "unite": "ans",
    "reperes": [
      {
        "min": 0,
        "label": "Jamais ou moins d'un an"
      },
      {
        "min": 1,
        "label": "1 à 2 ans"
      },
      {
        "min": 3,
        "label": "3 à 4 ans"
      },
      {
        "min": 5,
        "label": "5 à 9 ans"
      },
      {
        "min": 10,
        "label": "10 ans ou plus"
      }
    ],
    "cible": "risque",
    "chemin": "experience"
  },
  {
    "champ": "risque.revenus",
    "theme": "Stabilité des revenus",
    "libelle": "Comment décrirais-tu tes revenus ?",
    "aide": "Des revenus stables permettent de traverser une baisse des marchés sans devoir vendre.",
    "type": "choix",
    "valeurs": [
      {
        "v": "fonctionnaire",
        "label": "Très stables (fonctionnaire, pension de retraite)"
      },
      {
        "v": "cdi",
        "label": "Stables (salarié en CDI)"
      },
      {
        "v": "independant",
        "label": "Plutôt réguliers (indépendant, chef d'entreprise)"
      },
      {
        "v": "variables",
        "label": "Variables (CDD, intérim, commissions)"
      },
      {
        "v": "sans",
        "label": "Sans revenu d'activité"
      }
    ],
    "cible": "risque",
    "chemin": "revenus"
  },
  {
    "champ": "risque.matelas",
    "theme": "Épargne de précaution",
    "libelle": "As-tu de côté au moins 3 mois de dépenses, disponibles tout de suite et en dehors de tes placements ?",
    "aide": "C'est le matelas de sécurité (livrets, compte courant). Sans lui, un imprévu peut obliger à vendre au mauvais moment.",
    "type": "choix",
    "valeurs": [
      {
        "v": "oui",
        "label": "Oui"
      },
      {
        "v": "non",
        "label": "Non"
      }
    ],
    "cible": "risque",
    "chemin": "matelas"
  },
  {
    "champ": "risque.part_investie",
    "theme": "Part exposée",
    "libelle": "Quelle part de ton épargne financière acceptes-tu d'exposer aux marchés (actions, obligations, immobilier coté…) ?",
    "aide": "Le reste resterait sur des supports sans risque de perte : livrets, fonds euros.",
    "type": "choix",
    "valeurs": [
      {
        "v": "lt10",
        "label": "Moins de 10 %"
      },
      {
        "v": "10-25",
        "label": "10 à 25 %"
      },
      {
        "v": "25-50",
        "label": "25 à 50 %"
      },
      {
        "v": "50-75",
        "label": "50 à 75 %"
      },
      {
        "v": "gt75",
        "label": "Plus de 75 %"
      }
    ],
    "cible": "risque",
    "chemin": "part_investie"
  },
  {
    "champ": "risque.age",
    "theme": "Âge",
    "libelle": "Quel est ton âge ?",
    "type": "choix",
    "valeurs": [
      {
        "v": "u30",
        "label": "Moins de 30 ans"
      },
      {
        "v": "a30",
        "label": "30 à 39 ans"
      },
      {
        "v": "a40",
        "label": "40 à 49 ans"
      },
      {
        "v": "a50",
        "label": "50 à 59 ans"
      },
      {
        "v": "a60",
        "label": "60 à 69 ans"
      },
      {
        "v": "a70",
        "label": "70 ans ou plus"
      }
    ],
    "cible": "risque",
    "chemin": "age"
  }
];

// Barème du questionnaire de risque (web/src/risque.js QUESTIONS : poids, points, perte, seuils), pour le profil estimé.
export const BAREME_RISQUE: any[] = [
  {
    "id": "horizon",
    "poids": 3,
    "type": "choix",
    "options": [
      {
        "v": "lt2",
        "points": 0
      },
      {
        "v": "2-5",
        "points": 1
      },
      {
        "v": "5-8",
        "points": 2
      },
      {
        "v": "8-15",
        "points": 3
      },
      {
        "v": "gt15",
        "points": 4
      }
    ]
  },
  {
    "id": "objectif",
    "poids": 2,
    "type": "choix",
    "options": [
      {
        "v": "preserver",
        "points": 0
      },
      {
        "v": "revenus",
        "points": 1
      },
      {
        "v": "croissance",
        "points": 2
      },
      {
        "v": "maximiser",
        "points": 3
      }
    ]
  },
  {
    "id": "reaction",
    "poids": 3,
    "type": "choix",
    "options": [
      {
        "v": "vendre_tout",
        "points": 0
      },
      {
        "v": "vendre_partie",
        "points": 1
      },
      {
        "v": "rien",
        "points": 2
      },
      {
        "v": "renforcer",
        "points": 3
      }
    ]
  },
  {
    "id": "perte_max",
    "poids": 3,
    "type": "choix",
    "options": [
      {
        "v": "p5",
        "points": 0,
        "perte": 5
      },
      {
        "v": "p10",
        "points": 1,
        "perte": 10
      },
      {
        "v": "p20",
        "points": 2,
        "perte": 20
      },
      {
        "v": "p35",
        "points": 3,
        "perte": 35
      },
      {
        "v": "plus",
        "points": 4,
        "perte": null
      }
    ]
  },
  {
    "id": "connaissances",
    "poids": 2,
    "type": "multi",
    "options": [
      {
        "v": "livrets",
        "points": 0
      },
      {
        "v": "fonds_euros",
        "points": 0
      },
      {
        "v": "etf",
        "points": 2
      },
      {
        "v": "actions",
        "points": 2
      },
      {
        "v": "obligations",
        "points": 1
      },
      {
        "v": "crypto",
        "points": 1
      },
      {
        "v": "levier",
        "points": 1
      },
      {
        "v": "aucun",
        "points": 0,
        "exclusif": true
      }
    ]
  },
  {
    "id": "experience",
    "poids": 1,
    "type": "nombre",
    "options": [
      {
        "v": "0",
        "points": 0,
        "min": 0
      },
      {
        "v": "1",
        "points": 1,
        "min": 1
      },
      {
        "v": "3",
        "points": 2,
        "min": 3
      },
      {
        "v": "5",
        "points": 3,
        "min": 5
      },
      {
        "v": "10",
        "points": 4,
        "min": 10
      }
    ]
  },
  {
    "id": "revenus",
    "poids": 2,
    "type": "choix",
    "options": [
      {
        "v": "fonctionnaire",
        "points": 4
      },
      {
        "v": "cdi",
        "points": 3
      },
      {
        "v": "independant",
        "points": 2
      },
      {
        "v": "variables",
        "points": 1
      },
      {
        "v": "sans",
        "points": 0
      }
    ]
  },
  {
    "id": "matelas",
    "poids": 0,
    "type": "choix",
    "options": [
      {
        "v": "oui",
        "points": 1
      },
      {
        "v": "non",
        "points": 0
      }
    ]
  },
  {
    "id": "part_investie",
    "poids": 2,
    "type": "choix",
    "options": [
      {
        "v": "lt10",
        "points": 0
      },
      {
        "v": "10-25",
        "points": 1
      },
      {
        "v": "25-50",
        "points": 2
      },
      {
        "v": "50-75",
        "points": 3
      },
      {
        "v": "gt75",
        "points": 4
      }
    ]
  },
  {
    "id": "age",
    "poids": 1,
    "type": "choix",
    "options": [
      {
        "v": "u30",
        "points": 4
      },
      {
        "v": "a30",
        "points": 4
      },
      {
        "v": "a40",
        "points": 3
      },
      {
        "v": "a50",
        "points": 2
      },
      {
        "v": "a60",
        "points": 1
      },
      {
        "v": "a70",
        "points": 0
      }
    ]
  }
];
