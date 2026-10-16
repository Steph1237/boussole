// Fichier généré par scripts/gen-catalogue.mjs (npm run gen) : ne pas modifier à la main.
// Copie du moteur du budget de l'app (BUD1, docs/superpowers/specs/2026-10-16-bud1-budget-design.md) : les modules purs de web/src
// (sensible, budget-categories, reperes, calendrier, calc, periodes, budget) recopiés tels quels, évalués dans cet ordre. Aucune modification : un écart avec l'app est un bug du générateur.
const definitions = {}, modules = {};
function def(nom, fabrique) { definitions[nom] = fabrique; }
function charger(nom) {
  if (modules[nom]) return modules[nom].exports;
  const fabrique = definitions[nom];
  if (!fabrique) throw new Error("budget-moteur : module inconnu « " + nom + " »");
  const module = modules[nom] = { exports: {} };
  fabrique.call(globalThis, module, module.exports, chemin => charger(chemin.replace(/^.*\//, "").replace(/\.js$/, "")));
  return module.exports;
}

/* ---------- web/src/sensible.js ---------- */
def("sensible", function (module, exports, require) {
/* Filtre de contenu sensible de la mémoire de l'agent : mêmes motifs que public.contenu_sensible
   (supabase/migrations/0009_savoir_memoire.sql) et que SENSIBLE dans supabase/functions/mcp/memoire.ts.
   - IBAN : pays + clé + 11 à 30 caractères, refusé seulement si la correspondance contient au moins IBAN_CHIFFRES_MIN chiffres
     (un ISIN « IE00B4L5Y983 » suivi d'un libellé n'en a que 7) ;
   - carte : trois groupes de 4 chiffres puis 1 à 7 chiffres, espaces seulement, bornés par des non-chiffres ;
   - mots interdits, insensible à la casse.
   Pur, sans DOM. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Sensible = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const SENSIBLE = [
    "[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]){11,30}",
    "(?<![0-9])[0-9]{4} ?[0-9]{4} ?[0-9]{4} ?[0-9]{1,7}(?![0-9])",
    "mot de passe|password|code secret|code pin|identifiant de connexion",
  ];
  /* le motif partagé avec le SQL et le connecteur reste identique (lookbehind) ; côté navigateur il est lu sans lookbehind (Safari < 16.4 refuse la syntaxe) : « pas de chiffre juste avant » devient « début ou non-chiffre » */
  const IBAN_CHIFFRES_MIN = 12;
  const RE_IBAN = new RegExp(SENSIBLE[0], "g"), RE_CARTE = new RegExp(SENSIBLE[1].replace("(?<![0-9])", "(?:^|[^0-9])")), RE_MOTS = new RegExp(SENSIBLE[2], "i");
  const chiffres = s => s.replace(/[^0-9]/g, "").length;
  /** Vrai si le texte ressemble à un IBAN, un numéro de carte ou contient un mot interdit. */
  function estSensible(t) {
    const s = String(t == null ? "" : t);
    for (const m of s.matchAll(RE_IBAN)) if (chiffres(m[0]) >= IBAN_CHIFFRES_MIN) return true;
    return RE_CARTE.test(s) || RE_MOTS.test(s);
  }
  return { SENSIBLE, IBAN_CHIFFRES_MIN, estSensible };
});
});

/* ---------- web/src/budget-categories.js ---------- */
def("budget-categories", function (module, exports, require) {
/* Catégories du budget (BUD1) : taxonomie des sous-catégories, table des marchands, motifs génériques, correspondance Powens et classement d'une
   opération. Pur, sans DOM ni réseau, au tutoiement. Global BudgetCategories (navigateur), module CommonJS sous Node, copies générées dans les
   fonctions powens et mcp (supabase/functions/{powens,mcp}/budget-categories.gen.js, npm run gen) : une seule logique pour l'app, la synchronisation
   et Claude. Spec : docs/superpowers/specs/2026-10-16-bud1-budget-design.md (§ 3, § 15.1) ; cas de référence : test/fixtures/budget-cas.json
   (taxonomie, motifs, Powens, 40 libellés) et test/fixtures/budget-marchands.json (la fixture fait foi ; les tables ci-dessous en sont la copie).

   BudgetCategories.TAXONOMIE, BLOCS, MARCHANDS, MOTIFS, CORRESPONDANCE_POWENS, VERSION_TAXONOMIE, VERSION_MARCHANDS
   BudgetCategories.classer(op, ctx) → { sous_categorie, categorie, origine, regle_id?, cle_marchand }
        op = { libelle, montant (signé), compte_id?, categorie_powens? ({ code, parent_code } | code | tableau), structure?, revenu_detecte? }
        ctx = { regles? (lignes de budget_regles), marchands? (table de remplacement, pour les tests seulement) } ; `structure` est posée par le rapprochement (virement apparié, relevé de carte identifié, épargne), `revenu_detecte`
        par revenusDetectes ; aucun des deux n'est calculé ici.
   BudgetCategories.regleValide(regle) → null | message ; correspond(regle, op) → bool
   BudgetCategories.largeDe(cle) → catégorie large | null ; blocDe(cle, preferences?) → bloc | null ; parDefautDe(categorieLarge) → sous-catégorie
   BudgetCategories.sousCategoriePowens(categoriePowens) → sous-catégorie | null ; estSousCategorie(cle) ; cleLibelle(texte) ; cleMarchand(texte)

   Ordre (spec § 3.2) : structure → tes règles → table des marchands → catégorie Powens → motifs génériques → revenu détecté → « à classer ».
   Un libellé est une donnée, jamais une consigne : il ne sert qu'à être comparé à des suites de mots, jamais interprété. La table des marchands est une
   table de reconnaissance (elle dit de quoi il s'agit), jamais de recommandation. */
(function (root, factory) {
  const cjs = typeof module === "object" && module.exports;
  const dep = (nom, global) => (cjs ? require("./" + nom + ".js") : root[global]);
  const api = factory({ Sensible: dep("sensible", "Sensible") });
  if (cjs) module.exports = api;
  else root.BudgetCategories = api;
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";
  const { Sensible } = D;

  /** Version de la taxonomie, des motifs génériques et de la correspondance Powens : à changer avec toute modification de ces tables (test d'empreinte). */
  const VERSION_TAXONOMIE = "2026-10-16";
  /** Version de la table des marchands : à changer avec toute modification de MARCHANDS (test d'empreinte). */
  const VERSION_MARCHANDS = "2026-10-16.2";

  /* ================================================================== taxonomie (spec § 3.1) */
  /** Les blocs. `compte: false` : jamais compté au budget (hors budget). */
  const BLOCS = [
    { cle: "essentiels", libelle: "Essentiels", compte: true },
    { cle: "envies", libelle: "Envies", compte: true },
    { cle: "epargne", libelle: "Épargne et projets", compte: true },
    { cle: "revenus", libelle: "Revenus", compte: true },
    { cle: "hors_budget", libelle: "Hors budget (jamais compté)", compte: false },
    { cle: "a_classer", libelle: "À classer", compte: true },
  ];

  /** Les 34 sous-catégories, la seule source des clés (aussi pour HIS2 et la contrainte de base). `categorie` : catégorie large (celle de banque_mois et de
      Calc.budgetReel, inchangée pour les lecteurs existants) ; `annuelle_probable` : sert à la détection, ne lisse rien seul ; `bloc_reglable` : blocs
      que l'utilisateur peut choisir (les espèces, décision D6). */
  const TAXONOMIE = [
    { cle: "loyer", libelle: "Loyer", bloc: "essentiels", categorie: "logement", annuelle_probable: false },
    { cle: "credit_logement", libelle: "Crédit du logement", bloc: "essentiels", categorie: "logement", annuelle_probable: false },
    { cle: "charges_logement", libelle: "Charges et entretien du logement", bloc: "essentiels", categorie: "logement", annuelle_probable: false },
    { cle: "energie", libelle: "Énergie et eau", bloc: "essentiels", categorie: "logement", annuelle_probable: false },
    { cle: "telecom", libelle: "Internet et téléphone", bloc: "essentiels", categorie: "abonnements", annuelle_probable: false },
    { cle: "courses", libelle: "Courses", bloc: "essentiels", categorie: "alimentation", annuelle_probable: false },
    { cle: "transport", libelle: "Transport", bloc: "essentiels", categorie: "transport", annuelle_probable: false },
    { cle: "assurances", libelle: "Assurances", bloc: "essentiels", categorie: "divers", annuelle_probable: true },
    { cle: "sante", libelle: "Santé", bloc: "essentiels", categorie: "sante", annuelle_probable: false },
    { cle: "enfants", libelle: "Enfants", bloc: "essentiels", categorie: "enfants", annuelle_probable: false },
    { cle: "autres_credits", libelle: "Autres crédits", bloc: "essentiels", categorie: "divers", annuelle_probable: false },
    { cle: "impots", libelle: "Impôts et taxes", bloc: "essentiels", categorie: "impots", annuelle_probable: true },
    { cle: "frais_bancaires", libelle: "Frais bancaires", bloc: "essentiels", categorie: "divers", annuelle_probable: false },
    { cle: "especes", libelle: "Retraits d'espèces", bloc: "envies", categorie: "divers", annuelle_probable: false, bloc_reglable: ["envies", "essentiels"] },
    { cle: "commun_non_detaille", libelle: "Versé au commun (non détaillé)", bloc: "essentiels", categorie: "divers", annuelle_probable: false },
    { cle: "restaurants", libelle: "Restaurants et livraison", bloc: "envies", categorie: "loisirs", annuelle_probable: false },
    { cle: "sorties", libelle: "Sorties et culture", bloc: "envies", categorie: "loisirs", annuelle_probable: false },
    { cle: "sport", libelle: "Sport", bloc: "envies", categorie: "loisirs", annuelle_probable: false },
    { cle: "voyages", libelle: "Voyages et vacances", bloc: "envies", categorie: "loisirs", annuelle_probable: true },
    { cle: "shopping", libelle: "Achats", bloc: "envies", categorie: "divers", annuelle_probable: false },
    { cle: "abonnements", libelle: "Abonnements", bloc: "envies", categorie: "abonnements", annuelle_probable: false },
    { cle: "loisirs", libelle: "Loisirs et activités", bloc: "envies", categorie: "loisirs", annuelle_probable: false },
    { cle: "cadeaux_dons", libelle: "Cadeaux et dons", bloc: "envies", categorie: "divers", annuelle_probable: false },
    { cle: "animaux", libelle: "Animaux", bloc: "envies", categorie: "divers", annuelle_probable: false },
    { cle: "epargne_precaution", libelle: "Vers ton épargne disponible", bloc: "epargne", categorie: "epargne", annuelle_probable: false },
    { cle: "investissement", libelle: "Vers tes placements", bloc: "epargne", categorie: "epargne", annuelle_probable: false },
    { cle: "projets", libelle: "Vers un projet", bloc: "epargne", categorie: "epargne", annuelle_probable: false },
    { cle: "salaires", libelle: "Salaires", bloc: "revenus", categorie: "revenus", annuelle_probable: false },
    { cle: "revenus_autres", libelle: "Autres revenus", bloc: "revenus", categorie: "revenus", annuelle_probable: false },
    { cle: "virement_interne", libelle: "Entre tes comptes", bloc: "hors_budget", categorie: "virement_interne", annuelle_probable: false },
    { cle: "apport_commun", libelle: "Apport au compte commun", bloc: "hors_budget", categorie: "virement_interne", annuelle_probable: false },
    { cle: "transfert_foyer", libelle: "Entre vous deux", bloc: "hors_budget", categorie: "virement_interne", annuelle_probable: false },
    { cle: "releve_carte", libelle: "Relevé de carte à débit différé", bloc: "hors_budget", categorie: "virement_interne", annuelle_probable: false },
    { cle: "a_classer", libelle: "À classer", bloc: "a_classer", categorie: "divers", annuelle_probable: false },
  ];
  const PAR_CLE = new Map(TAXONOMIE.map(t => [t.cle, t]));
  /** Sous-catégories posées par le rapprochement (op.structure) : jamais surchargées par une règle. */
  const STRUCTURES = ["virement_interne", "epargne_precaution", "investissement", "apport_commun", "transfert_foyer", "releve_carte"];
  /** Seules sous-catégories « hors budget » qu'une règle peut viser (compte d'en face non connecté). */
  const HORS_BUDGET_EN_REGLE = ["apport_commun", "transfert_foyer"];
  /** Sous-catégorie donnée à une catégorie large par la reprise de banque_mois (un mois enregistré avant BUD1 n'a que la catégorie large). */
  const PAR_DEFAUT = { logement: "charges_logement", alimentation: "courses", transport: "transport", enfants: "enfants", sante: "sante", loisirs: "loisirs",
    abonnements: "abonnements", impots: "impots", divers: "a_classer", revenus: "revenus_autres", epargne: "epargne_precaution", virement_interne: "virement_interne" };

  /* ================================================================== motifs génériques (spec § 3.2 point 5) */
  /** Motifs génériques, suites de mots au format cleLibelle ; `sens` : sortie (montant < 0), entree (montant > 0) ou les_deux. */
  const MOTIFS = [
    { motif: "loyer", sous_categorie: "loyer", sens: "sortie" },
    { motif: "loyer", sous_categorie: "revenus_autres", sens: "entree" },
    { motif: "dgfip", sous_categorie: "impots", sens: "les_deux" },
    { motif: "impot", sous_categorie: "impots", sens: "les_deux" },
    { motif: "impots", sous_categorie: "impots", sens: "les_deux" },
    { motif: "cotisation carte", sous_categorie: "frais_bancaires", sens: "sortie" },
    { motif: "commission intervention", sous_categorie: "frais_bancaires", sens: "sortie" },
    { motif: "commission d intervention", sous_categorie: "frais_bancaires", sens: "sortie" },
    { motif: "commissions d intervention", sous_categorie: "frais_bancaires", sens: "sortie" },
    { motif: "agios", sous_categorie: "frais_bancaires", sens: "sortie" },
    { motif: "frais tenue de compte", sous_categorie: "frais_bancaires", sens: "sortie" },
    { motif: "frais de tenue de compte", sous_categorie: "frais_bancaires", sens: "sortie" },
    { motif: "retrait dab", sous_categorie: "especes", sens: "sortie" },
    { motif: "retrait especes", sous_categorie: "especes", sens: "sortie" },
    { motif: "cpam", sous_categorie: "sante", sens: "entree" },
    { motif: "mutuelle", sous_categorie: "sante", sens: "entree" },
    { motif: "caf", sous_categorie: "revenus_autres", sens: "entree" },
    { motif: "salaire", sous_categorie: "salaires", sens: "entree" },
    { motif: "paie", sous_categorie: "salaires", sens: "entree" },
  ];

  /* ================================================================== correspondance Powens (spec § 3.2 point 4) */
  /** Code Powens (taxonomie française, plus from_own_account et to_own_account de la taxonomie espagnole) → sous-catégorie ; null : le code ne dit rien
      (bank_insurances, others), le classement continue. */
  const CORRESPONDANCE_POWENS = {
    administration_and_taxes: "impots",
    bank_insurances: null,
    food_and_restaurants: "courses",
    household: "charges_logement",
    healthcare: "sante",
    housing: "charges_logement",
    leisure: "loisirs",
    loans: "autres_credits",
    media_and_telecommunications: "abonnements",
    others: null,
    revenue: "revenus_autres",
    shopping: "shopping",
    travel_and_transport: "transport",
    legal_advice: "a_classer",
    others_administration_and_taxes: "impots",
    social_contributions: "impots",
    taxes: "impots",
    banking_fees: "frais_bancaires",
    insurance_repayments: "assurances",
    account_card_maintenance: "frais_bancaires",
    insurances: "assurances",
    others_bank_insurances: "a_classer",
    retirement_insurance: "investissement",
    savings: "epargne_precaution",
    unauthorized_debit_fees: "frais_bancaires",
    irregularity_and_incident_fees: "frais_bancaires",
    intervention_fees: "frais_bancaires",
    foreign_exchange_fees: "frais_bancaires",
    withdrawal: "especes",
    rejection_fees: "frais_bancaires",
    third_party_administrative_seizure: "a_classer",
    deposit: "a_classer",
    savings_investments_and_crypto_assets: "investissement",
    baker: "courses",
    bars_restaurants: "restaurants",
    butcher_fishmongers_produce: "courses",
    others_food_and_restaurants: "courses",
    supermarket_and_groceries: "courses",
    vending: "courses",
    home_services_cleaning: "charges_logement",
    kitchen_and_appliances: "shopping",
    others_household: "charges_logement",
    works_diy_gardening: "charges_logement",
    child_care_kindergarten: "enfants",
    furniture_and_decoration: "shopping",
    alimony_payment: "enfants",
    education_and_training: "enfants",
    pet_care: "animaux",
    post_and_courier: "shopping",
    doctors_specialist_dentists_hospitals: "sante",
    health_insurance_fees: "assurances",
    health_insurance_reimbursement: "sante",
    others_healthcare: "sante",
    pharmacy: "sante",
    energy: "energie",
    others_housing: "charges_logement",
    rent: "loyer",
    water: "energie",
    cinema_theater_culture: "sorties",
    hotels: "voyages",
    others_leisure: "loisirs",
    sports: "sport",
    tobacco_gambling: "loisirs",
    charity_ngo_unions_associations: "cadeaux_dons",
    consumer_loans_disposal: "a_classer",
    mortgage_disposal: "a_classer",
    others_loans: "autres_credits",
    consumer_loans_payment: "autres_credits",
    mortgage_payment: "credit_logement",
    media_subscriptions: "abonnements",
    others_media_and_telecommunications: "abonnements",
    phone_internet_tv: "telecom",
    return_debit: "a_classer",
    transfers: "a_classer",
    online_transfers_and_payment_services: "a_classer",
    others_revenue: "revenus_autres",
    pensions: "revenus_autres",
    rental_income: "revenus_autres",
    salary: "salaires",
    alimony: "revenus_autres",
    family_benefits: "revenus_autres",
    unemployment_benefits: "revenus_autres",
    other_benefits: "revenus_autres",
    housing_benefits: "revenus_autres",
    financial_income: "revenus_autres",
    savings_disposal: "epargne_precaution",
    beauty_hairdressing_aesthetic: "shopping",
    clothing_and_accessories: "shopping",
    ecommerce: "shopping",
    multimedia_books_stationery: "loisirs",
    others_shopping: "shopping",
    fuel_and_vehicle_charging: "transport",
    others_travel_and_transport: "transport",
    parking_maintenance_tolls: "transport",
    plane_or_boat_travel: "voyages",
    public_transportation: "transport",
    rental_and_taxis: "transport",
    train_travel: "transport",
    from_own_account: "epargne_precaution",
    to_own_account: "epargne_precaution",
  };

  /* ================================================================== table des marchands (spec § 3.2 point 3) */
  /** Enseignes, organismes et termes génériques (`type`), en suites de mots au format cleLibelle ; `famille` : famille d'un abonnement ; `sens` : l'entrée
      ne vaut que pour ce sens. Aucun motif de MOTIFS ici (loyer, impôts, frais, espèces, caisses, salaires). */
  const MARCHANDS = [
    { motif: "cdc habitat", sous_categorie: "loyer", type: "organisme" },
    { motif: "est metropole habitat", sous_categorie: "loyer", type: "organisme" },
    { motif: "grand lyon habitat", sous_categorie: "loyer", type: "organisme" },
    { motif: "habitat marseille provence", sous_categorie: "loyer", type: "organisme" },
    { motif: "icf habitat", sous_categorie: "loyer", type: "organisme" },
    { motif: "lille metropole habitat", sous_categorie: "loyer", type: "organisme" },
    { motif: "logirep", sous_categorie: "loyer", type: "organisme" },
    { motif: "paris habitat", sous_categorie: "loyer", type: "organisme" },
    { motif: "seqens", sous_categorie: "loyer", type: "organisme" },
    { motif: "toulouse metropole habitat", sous_categorie: "loyer", type: "organisme" },
    { motif: "vilogia", sous_categorie: "loyer", type: "organisme" },
    { motif: "credit immobilier", sous_categorie: "credit_logement", type: "generique" },
    { motif: "echeance pret", sous_categorie: "credit_logement", type: "generique" },
    { motif: "pret habitat", sous_categorie: "credit_logement", type: "generique" },
    { motif: "pret immo", sous_categorie: "credit_logement", type: "generique" },
    { motif: "pret immobilier", sous_categorie: "credit_logement", type: "generique" },
    { motif: "botanic", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "brico cash", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "brico depot", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "brico leclerc", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "bricoman", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "bricomarche", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "bricorama", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "castorama", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "charges locatives", sous_categorie: "charges_logement", type: "generique" },
    { motif: "copropriete", sous_categorie: "charges_logement", type: "generique" },
    { motif: "entretien chaudiere", sous_categorie: "charges_logement", type: "generique" },
    { motif: "gamm vert", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "ista", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "jardiland", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "lapeyre", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "laverie", sous_categorie: "charges_logement", type: "generique" },
    { motif: "leroy merlin", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "manomano", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "mr bricolage", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "plombier", sous_categorie: "charges_logement", type: "generique" },
    { motif: "point p", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "proxiserve", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "ramonage", sous_categorie: "charges_logement", type: "generique" },
    { motif: "serrurier", sous_categorie: "charges_logement", type: "generique" },
    { motif: "syndic", sous_categorie: "charges_logement", type: "generique" },
    { motif: "techem", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "truffaut", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "villaverde", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "weldom", sous_categorie: "charges_logement", type: "enseigne" },
    { motif: "alpiq", sous_categorie: "energie", type: "enseigne" },
    { motif: "antargaz", sous_categorie: "energie", type: "enseigne" },
    { motif: "butagaz", sous_categorie: "energie", type: "enseigne" },
    { motif: "dyneff", sous_categorie: "energie", type: "enseigne" },
    { motif: "eau de paris", sous_categorie: "energie", type: "enseigne" },
    { motif: "eau du grand lyon", sous_categorie: "energie", type: "enseigne" },
    { motif: "eaux de marseille", sous_categorie: "energie", type: "enseigne" },
    { motif: "edf", sous_categorie: "energie", type: "enseigne" },
    { motif: "edf clients particuliers", sous_categorie: "energie", type: "enseigne" },
    { motif: "ekwateur", sous_categorie: "energie", type: "enseigne" },
    { motif: "electricite", sous_categorie: "energie", type: "generique" },
    { motif: "elmy", sous_categorie: "energie", type: "enseigne" },
    { motif: "enedis", sous_categorie: "energie", type: "enseigne" },
    { motif: "enercoop", sous_categorie: "energie", type: "enseigne" },
    { motif: "energies du santerre", sous_categorie: "energie", type: "enseigne" },
    { motif: "engie", sous_categorie: "energie", type: "enseigne" },
    { motif: "eni", sous_categorie: "energie", type: "enseigne" },
    { motif: "eni gas power", sous_categorie: "energie", type: "enseigne" },
    { motif: "es energies strasbourg", sous_categorie: "energie", type: "enseigne" },
    { motif: "facture eau", sous_categorie: "energie", type: "generique" },
    { motif: "fioul", sous_categorie: "energie", type: "generique" },
    { motif: "gaz de bordeaux", sous_categorie: "energie", type: "enseigne" },
    { motif: "gaz naturel", sous_categorie: "energie", type: "generique" },
    { motif: "gedia", sous_categorie: "energie", type: "enseigne" },
    { motif: "happ e", sous_categorie: "energie", type: "enseigne" },
    { motif: "ilek", sous_categorie: "energie", type: "enseigne" },
    { motif: "lyonnaise des eaux", sous_categorie: "energie", type: "enseigne" },
    { motif: "mint energie", sous_categorie: "energie", type: "enseigne" },
    { motif: "octopus energy", sous_categorie: "energie", type: "enseigne" },
    { motif: "ohm energie", sous_categorie: "energie", type: "enseigne" },
    { motif: "planete oui", sous_categorie: "energie", type: "enseigne" },
    { motif: "primagaz", sous_categorie: "energie", type: "enseigne" },
    { motif: "regie des eaux", sous_categorie: "energie", type: "generique" },
    { motif: "saur", sous_categorie: "energie", type: "enseigne" },
    { motif: "sede environnement", sous_categorie: "energie", type: "enseigne" },
    { motif: "service des eaux", sous_categorie: "energie", type: "generique" },
    { motif: "sowee", sous_categorie: "energie", type: "enseigne" },
    { motif: "suez", sous_categorie: "energie", type: "enseigne" },
    { motif: "total direct energie", sous_categorie: "energie", type: "enseigne" },
    { motif: "totalenergies electricite", sous_categorie: "energie", type: "enseigne" },
    { motif: "totalenergies electricite et gaz", sous_categorie: "energie", type: "enseigne" },
    { motif: "vattenfall", sous_categorie: "energie", type: "enseigne" },
    { motif: "veolia", sous_categorie: "energie", type: "enseigne" },
    { motif: "veolia eau", sous_categorie: "energie", type: "enseigne" },
    { motif: "wekiwi", sous_categorie: "energie", type: "enseigne" },
    { motif: "abonnement mobile", sous_categorie: "telecom", type: "generique" },
    { motif: "auchan telecom", sous_categorie: "telecom", type: "enseigne" },
    { motif: "b you", sous_categorie: "telecom", type: "enseigne" },
    { motif: "bouygues telecom", sous_categorie: "telecom", type: "enseigne" },
    { motif: "box internet", sous_categorie: "telecom", type: "generique" },
    { motif: "cdiscount mobile", sous_categorie: "telecom", type: "enseigne" },
    { motif: "coriolis", sous_categorie: "telecom", type: "enseigne" },
    { motif: "forfait mobile", sous_categorie: "telecom", type: "generique" },
    { motif: "free mobile", sous_categorie: "telecom", type: "enseigne" },
    { motif: "free telecom", sous_categorie: "telecom", type: "enseigne" },
    { motif: "freebox", sous_categorie: "telecom", type: "enseigne" },
    { motif: "k net", sous_categorie: "telecom", type: "enseigne" },
    { motif: "la poste mobile", sous_categorie: "telecom", type: "enseigne" },
    { motif: "lebara", sous_categorie: "telecom", type: "enseigne" },
    { motif: "lycamobile", sous_categorie: "telecom", type: "enseigne" },
    { motif: "nrj mobile", sous_categorie: "telecom", type: "enseigne" },
    { motif: "numericable", sous_categorie: "telecom", type: "enseigne" },
    { motif: "orange", sous_categorie: "telecom", type: "enseigne" },
    { motif: "orange bank", sous_categorie: "frais_bancaires", type: "enseigne" },
    { motif: "prixtel", sous_categorie: "telecom", type: "enseigne" },
    { motif: "red by sfr", sous_categorie: "telecom", type: "enseigne" },
    { motif: "reglo mobile", sous_categorie: "telecom", type: "enseigne" },
    { motif: "sfr", sous_categorie: "telecom", type: "enseigne" },
    { motif: "sosh", sous_categorie: "telecom", type: "enseigne" },
    { motif: "starlink", sous_categorie: "telecom", type: "enseigne" },
    { motif: "syma mobile", sous_categorie: "telecom", type: "enseigne" },
    { motif: "videofutur", sous_categorie: "telecom", type: "enseigne" },
    { motif: "youprice", sous_categorie: "telecom", type: "enseigne" },
    { motif: "zeop", sous_categorie: "telecom", type: "enseigne" },
    { motif: "aldi", sous_categorie: "courses", type: "enseigne" },
    { motif: "alimentation generale", sous_categorie: "courses", type: "generique" },
    { motif: "auchan", sous_categorie: "courses", type: "enseigne" },
    { motif: "auchan supermarche", sous_categorie: "courses", type: "enseigne" },
    { motif: "banette", sous_categorie: "courses", type: "enseigne" },
    { motif: "bio c bon", sous_categorie: "courses", type: "enseigne" },
    { motif: "biocoop", sous_categorie: "courses", type: "enseigne" },
    { motif: "boucherie", sous_categorie: "courses", type: "generique" },
    { motif: "boulangerie", sous_categorie: "courses", type: "generique" },
    { motif: "carrefour", sous_categorie: "courses", type: "enseigne" },
    { motif: "carrefour bio", sous_categorie: "courses", type: "enseigne" },
    { motif: "carrefour city", sous_categorie: "courses", type: "enseigne" },
    { motif: "carrefour contact", sous_categorie: "courses", type: "enseigne" },
    { motif: "carrefour drive", sous_categorie: "courses", type: "enseigne" },
    { motif: "carrefour express", sous_categorie: "courses", type: "enseigne" },
    { motif: "carrefour market", sous_categorie: "courses", type: "enseigne" },
    { motif: "casino shop", sous_categorie: "courses", type: "enseigne" },
    { motif: "casino supermarche", sous_categorie: "courses", type: "enseigne" },
    { motif: "charcuterie", sous_categorie: "courses", type: "generique" },
    { motif: "chronodrive", sous_categorie: "courses", type: "enseigne" },
    { motif: "coccinelle", sous_categorie: "courses", type: "enseigne" },
    { motif: "colruyt", sous_categorie: "courses", type: "enseigne" },
    { motif: "costco", sous_categorie: "courses", type: "enseigne" },
    { motif: "e leclerc", sous_categorie: "courses", type: "enseigne" },
    { motif: "epicerie", sous_categorie: "courses", type: "generique" },
    { motif: "flink", sous_categorie: "courses", type: "enseigne" },
    { motif: "franprix", sous_categorie: "courses", type: "enseigne" },
    { motif: "fromagerie", sous_categorie: "courses", type: "generique" },
    { motif: "geant casino", sous_categorie: "courses", type: "enseigne" },
    { motif: "grand frais", sous_categorie: "courses", type: "enseigne" },
    { motif: "hellofresh", sous_categorie: "courses", type: "enseigne" },
    { motif: "hyper u", sous_categorie: "courses", type: "enseigne" },
    { motif: "hypermarche", sous_categorie: "courses", type: "generique" },
    { motif: "intermarche", sous_categorie: "courses", type: "enseigne" },
    { motif: "la belle vie", sous_categorie: "courses", type: "enseigne" },
    { motif: "la fourche", sous_categorie: "courses", type: "enseigne" },
    { motif: "la grande epicerie", sous_categorie: "courses", type: "enseigne" },
    { motif: "la vie claire", sous_categorie: "courses", type: "enseigne" },
    { motif: "lafayette gourmet", sous_categorie: "courses", type: "enseigne" },
    { motif: "leader price", sous_categorie: "courses", type: "enseigne" },
    { motif: "leclerc", sous_categorie: "courses", type: "enseigne" },
    { motif: "leclerc drive", sous_categorie: "courses", type: "enseigne" },
    { motif: "les nouveaux robinson", sous_categorie: "courses", type: "enseigne" },
    { motif: "lidl", sous_categorie: "courses", type: "enseigne" },
    { motif: "magasins u", sous_categorie: "courses", type: "enseigne" },
    { motif: "marie blachere", sous_categorie: "courses", type: "enseigne" },
    { motif: "match supermarche", sous_categorie: "courses", type: "enseigne" },
    { motif: "monop", sous_categorie: "courses", type: "enseigne" },
    { motif: "monoprix", sous_categorie: "courses", type: "enseigne" },
    { motif: "naturalia", sous_categorie: "courses", type: "enseigne" },
    { motif: "netto", sous_categorie: "courses", type: "enseigne" },
    { motif: "nous anti gaspi", sous_categorie: "courses", type: "enseigne" },
    { motif: "o marche frais", sous_categorie: "courses", type: "enseigne" },
    { motif: "patisserie", sous_categorie: "courses", type: "generique" },
    { motif: "petit casino", sous_categorie: "courses", type: "enseigne" },
    { motif: "picard surgeles", sous_categorie: "courses", type: "enseigne" },
    { motif: "poissonnerie", sous_categorie: "courses", type: "generique" },
    { motif: "primeur", sous_categorie: "courses", type: "generique" },
    { motif: "proxi", sous_categorie: "courses", type: "enseigne" },
    { motif: "quitoque", sous_categorie: "courses", type: "enseigne" },
    { motif: "satoriz", sous_categorie: "courses", type: "enseigne" },
    { motif: "simply market", sous_categorie: "courses", type: "enseigne" },
    { motif: "spar", sous_categorie: "courses", type: "enseigne" },
    { motif: "super u", sous_categorie: "courses", type: "enseigne" },
    { motif: "superette", sous_categorie: "courses", type: "generique" },
    { motif: "supermarche", sous_categorie: "courses", type: "generique" },
    { motif: "systeme u", sous_categorie: "courses", type: "enseigne" },
    { motif: "too good to go", sous_categorie: "courses", type: "enseigne" },
    { motif: "traiteur", sous_categorie: "courses", type: "generique" },
    { motif: "u express", sous_categorie: "courses", type: "enseigne" },
    { motif: "vival", sous_categorie: "courses", type: "enseigne" },
    { motif: "ada location", sous_categorie: "transport", type: "enseigne" },
    { motif: "aprr", sous_categorie: "transport", type: "enseigne" },
    { motif: "asf", sous_categorie: "transport", type: "enseigne" },
    { motif: "astuce rouen", sous_categorie: "transport", type: "enseigne" },
    { motif: "atmb", sous_categorie: "transport", type: "enseigne" },
    { motif: "auto ecole", sous_categorie: "transport", type: "generique" },
    { motif: "autosur", sous_categorie: "transport", type: "enseigne" },
    { motif: "avia", sous_categorie: "transport", type: "enseigne" },
    { motif: "bip go", sous_categorie: "transport", type: "enseigne" },
    { motif: "blablacar", sous_categorie: "transport", type: "enseigne" },
    { motif: "blablacar bus", sous_categorie: "transport", type: "enseigne" },
    { motif: "bolt", sous_categorie: "transport", type: "enseigne" },
    { motif: "carburant", sous_categorie: "transport", type: "generique" },
    { motif: "carglass", sous_categorie: "transport", type: "enseigne" },
    { motif: "carrefour station", sous_categorie: "transport", type: "enseigne" },
    { motif: "chargemap", sous_categorie: "transport", type: "enseigne" },
    { motif: "cofiroute", sous_categorie: "transport", type: "enseigne" },
    { motif: "controle technique", sous_categorie: "transport", type: "generique" },
    { motif: "dekra", sous_categorie: "transport", type: "enseigne" },
    { motif: "effia", sous_categorie: "transport", type: "enseigne" },
    { motif: "electra", sous_categorie: "transport", type: "enseigne" },
    { motif: "en voiture simone", sous_categorie: "transport", type: "enseigne" },
    { motif: "escota", sous_categorie: "transport", type: "enseigne" },
    { motif: "esso", sous_categorie: "transport", type: "enseigne" },
    { motif: "euromaster", sous_categorie: "transport", type: "enseigne" },
    { motif: "europcar", sous_categorie: "transport", type: "enseigne" },
    { motif: "feu vert", sous_categorie: "transport", type: "enseigne" },
    { motif: "fil bleu", sous_categorie: "transport", type: "enseigne" },
    { motif: "flixbus", sous_categorie: "transport", type: "enseigne" },
    { motif: "flowbird", sous_categorie: "transport", type: "enseigne" },
    { motif: "free move", sous_categorie: "transport", type: "enseigne" },
    { motif: "freshmile", sous_categorie: "transport", type: "enseigne" },
    { motif: "getaround", sous_categorie: "transport", type: "enseigne" },
    { motif: "heetch", sous_categorie: "transport", type: "enseigne" },
    { motif: "hertz", sous_categorie: "transport", type: "enseigne" },
    { motif: "ilevia", sous_categorie: "transport", type: "enseigne" },
    { motif: "indigo", sous_categorie: "transport", type: "enseigne" },
    { motif: "intermarche station", sous_categorie: "transport", type: "enseigne" },
    { motif: "interparking", sous_categorie: "transport", type: "enseigne" },
    { motif: "ionity", sous_categorie: "transport", type: "enseigne" },
    { motif: "irigo", sous_categorie: "transport", type: "enseigne" },
    { motif: "izivia", sous_categorie: "transport", type: "enseigne" },
    { motif: "keolis", sous_categorie: "transport", type: "enseigne" },
    { motif: "leasys", sous_categorie: "transport", type: "enseigne" },
    { motif: "leclerc station", sous_categorie: "transport", type: "enseigne" },
    { motif: "lignes d azur", sous_categorie: "transport", type: "enseigne" },
    { motif: "marcel cab", sous_categorie: "transport", type: "enseigne" },
    { motif: "midas", sous_categorie: "transport", type: "enseigne" },
    { motif: "mistral toulon", sous_categorie: "transport", type: "enseigne" },
    { motif: "navigo", sous_categorie: "transport", type: "enseigne" },
    { motif: "norauto", sous_categorie: "transport", type: "enseigne" },
    { motif: "onepark", sous_categorie: "transport", type: "enseigne" },
    { motif: "ornikar", sous_categorie: "transport", type: "enseigne" },
    { motif: "ouigo", sous_categorie: "transport", type: "enseigne" },
    { motif: "parking", sous_categorie: "transport", type: "generique" },
    { motif: "paybyphone", sous_categorie: "transport", type: "enseigne" },
    { motif: "peage", sous_categorie: "transport", type: "generique" },
    { motif: "point s", sous_categorie: "transport", type: "enseigne" },
    { motif: "q park", sous_categorie: "transport", type: "enseigne" },
    { motif: "ratp", sous_categorie: "transport", type: "enseigne" },
    { motif: "rent a car", sous_categorie: "transport", type: "enseigne" },
    { motif: "rtm marseille", sous_categorie: "transport", type: "enseigne" },
    { motif: "saemes", sous_categorie: "transport", type: "enseigne" },
    { motif: "sanef", sous_categorie: "transport", type: "enseigne" },
    { motif: "sapn", sous_categorie: "transport", type: "enseigne" },
    { motif: "securitest", sous_categorie: "transport", type: "enseigne" },
    { motif: "shell", sous_categorie: "transport", type: "enseigne" },
    { motif: "sixt", sous_categorie: "transport", type: "enseigne" },
    { motif: "sncf", sous_categorie: "transport", type: "enseigne" },
    { motif: "sncf connect", sous_categorie: "transport", type: "enseigne" },
    { motif: "sncf voyageurs", sous_categorie: "transport", type: "enseigne" },
    { motif: "speedy", sous_categorie: "transport", type: "enseigne" },
    { motif: "station service", sous_categorie: "transport", type: "generique" },
    { motif: "stych", sous_categorie: "transport", type: "enseigne" },
    { motif: "tag grenoble", sous_categorie: "transport", type: "enseigne" },
    { motif: "taxi", sous_categorie: "transport", type: "generique" },
    { motif: "tbm", sous_categorie: "transport", type: "enseigne" },
    { motif: "tcl", sous_categorie: "transport", type: "enseigne" },
    { motif: "tesla", sous_categorie: "transport", type: "enseigne" },
    { motif: "tisseo", sous_categorie: "transport", type: "enseigne" },
    { motif: "total access", sous_categorie: "transport", type: "enseigne" },
    { motif: "totalenergies", sous_categorie: "transport", type: "enseigne" },
    { motif: "trainline", sous_categorie: "transport", type: "enseigne" },
    { motif: "transdev", sous_categorie: "transport", type: "enseigne" },
    { motif: "transilien", sous_categorie: "transport", type: "enseigne" },
    { motif: "uber", sous_categorie: "transport", type: "enseigne" },
    { motif: "ucar", sous_categorie: "transport", type: "enseigne" },
    { motif: "ulys", sous_categorie: "transport", type: "enseigne" },
    { motif: "velib", sous_categorie: "transport", type: "enseigne" },
    { motif: "vinci autoroutes", sous_categorie: "transport", type: "enseigne" },
    { motif: "vulco", sous_categorie: "transport", type: "enseigne" },
    { motif: "zenpark", sous_categorie: "transport", type: "enseigne" },
    { motif: "abeille assurances", sous_categorie: "assurances", type: "enseigne" },
    { motif: "acheel", sous_categorie: "assurances", type: "enseigne" },
    { motif: "ag r la mondiale", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "allianz", sous_categorie: "assurances", type: "enseigne" },
    { motif: "allianz iard", sous_categorie: "assurances", type: "enseigne" },
    { motif: "ampli mutuelle", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "amv assurance", sous_categorie: "assurances", type: "enseigne" },
    { motif: "apivia", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "april", sous_categorie: "assurances", type: "enseigne" },
    { motif: "assurance", sous_categorie: "assurances", type: "generique" },
    { motif: "assurance auto", sous_categorie: "assurances", type: "generique" },
    { motif: "assurance habitation", sous_categorie: "assurances", type: "generique" },
    { motif: "assurances", sous_categorie: "assurances", type: "generique" },
    { motif: "aviva", sous_categorie: "assurances", type: "enseigne" },
    { motif: "axa", sous_categorie: "assurances", type: "enseigne" },
    { motif: "axa france iard", sous_categorie: "assurances", type: "enseigne" },
    { motif: "cardif", sous_categorie: "assurances", type: "enseigne" },
    { motif: "cnp assurances", sous_categorie: "assurances", type: "enseigne" },
    { motif: "direct assurance", sous_categorie: "assurances", type: "enseigne" },
    { motif: "generali", sous_categorie: "assurances", type: "enseigne" },
    { motif: "gmf", sous_categorie: "assurances", type: "enseigne" },
    { motif: "groupama", sous_categorie: "assurances", type: "enseigne" },
    { motif: "groupama assurances", sous_categorie: "assurances", type: "enseigne" },
    { motif: "harmonie mutuelle", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "heyme", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "hiscox", sous_categorie: "assurances", type: "enseigne" },
    { motif: "l olivier assurance", sous_categorie: "assurances", type: "enseigne" },
    { motif: "leocare", sous_categorie: "assurances", type: "enseigne" },
    { motif: "lovys", sous_categorie: "assurances", type: "enseigne" },
    { motif: "luko", sous_categorie: "assurances", type: "enseigne" },
    { motif: "maaf", sous_categorie: "assurances", type: "enseigne" },
    { motif: "macif", sous_categorie: "assurances", type: "enseigne" },
    { motif: "macsf", sous_categorie: "assurances", type: "enseigne" },
    { motif: "maif", sous_categorie: "assurances", type: "enseigne" },
    { motif: "malakoff humanis", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "matmut", sous_categorie: "assurances", type: "enseigne" },
    { motif: "metlife", sous_categorie: "assurances", type: "enseigne" },
    { motif: "mgen", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "mma", sous_categorie: "assurances", type: "enseigne" },
    { motif: "mutuelle bleue", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "mutuelle de poitiers", sous_categorie: "assurances", type: "enseigne" },
    { motif: "mutuelle des motards", sous_categorie: "assurances", type: "enseigne" },
    { motif: "mutuelle generale", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "mutuelle saint christophe", sous_categorie: "assurances", type: "enseigne" },
    { motif: "ociane", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "pacifica", sous_categorie: "assurances", type: "enseigne" },
    { motif: "prevoyance", sous_categorie: "assurances", type: "generique" },
    { motif: "smacl", sous_categorie: "assurances", type: "enseigne" },
    { motif: "smerep", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "sogessur", sous_categorie: "assurances", type: "enseigne" },
    { motif: "solimut", sous_categorie: "assurances", type: "organisme", sens: "sortie" },
    { motif: "swiss life", sous_categorie: "assurances", type: "enseigne" },
    { motif: "thelem assurances", sous_categorie: "assurances", type: "enseigne" },
    { motif: "afflelou", sous_categorie: "sante", type: "enseigne" },
    { motif: "alain afflelou", sous_categorie: "sante", type: "enseigne" },
    { motif: "ameli", sous_categorie: "sante", type: "enseigne" },
    { motif: "amplifon", sous_categorie: "sante", type: "enseigne" },
    { motif: "atol", sous_categorie: "sante", type: "enseigne" },
    { motif: "audika", sous_categorie: "sante", type: "enseigne" },
    { motif: "biogroup", sous_categorie: "sante", type: "enseigne" },
    { motif: "cabinet medical", sous_categorie: "sante", type: "generique" },
    { motif: "caisse primaire", sous_categorie: "sante", type: "enseigne" },
    { motif: "centre dentaire", sous_categorie: "sante", type: "generique" },
    { motif: "centre hospitalier", sous_categorie: "sante", type: "generique" },
    { motif: "centre medical", sous_categorie: "sante", type: "generique" },
    { motif: "cerballiance", sous_categorie: "sante", type: "enseigne" },
    { motif: "clinique", sous_categorie: "sante", type: "generique" },
    { motif: "dentiste", sous_categorie: "sante", type: "generique" },
    { motif: "doctolib", sous_categorie: "sante", type: "enseigne" },
    { motif: "ecouter voir", sous_categorie: "sante", type: "enseigne" },
    { motif: "eurofins biologie", sous_categorie: "sante", type: "enseigne" },
    { motif: "general d optique", sous_categorie: "sante", type: "enseigne" },
    { motif: "grandoptical", sous_categorie: "sante", type: "enseigne" },
    { motif: "hopital", sous_categorie: "sante", type: "generique" },
    { motif: "inovie", sous_categorie: "sante", type: "enseigne" },
    { motif: "kinesitherapeute", sous_categorie: "sante", type: "generique" },
    { motif: "krys", sous_categorie: "sante", type: "enseigne" },
    { motif: "laboratoire d analyses", sous_categorie: "sante", type: "generique" },
    { motif: "lissac", sous_categorie: "sante", type: "enseigne" },
    { motif: "optic", sous_categorie: "sante", type: "enseigne" },
    { motif: "optical center", sous_categorie: "sante", type: "enseigne" },
    { motif: "opticien", sous_categorie: "sante", type: "generique" },
    { motif: "osteopathe", sous_categorie: "sante", type: "generique" },
    { motif: "parapharmacie", sous_categorie: "sante", type: "generique" },
    { motif: "pharmacie", sous_categorie: "sante", type: "generique" },
    { motif: "synlab", sous_categorie: "sante", type: "enseigne" },
    { motif: "assistante maternelle", sous_categorie: "enfants", type: "generique" },
    { motif: "aubert", sous_categorie: "enfants", type: "enseigne" },
    { motif: "cantine", sous_categorie: "enfants", type: "generique" },
    { motif: "centre de loisirs", sous_categorie: "enfants", type: "generique" },
    { motif: "creche", sous_categorie: "enfants", type: "generique" },
    { motif: "du pareil au meme", sous_categorie: "enfants", type: "enseigne" },
    { motif: "garderie", sous_categorie: "enfants", type: "generique" },
    { motif: "jacadi", sous_categorie: "enfants", type: "enseigne" },
    { motif: "joueclub", sous_categorie: "enfants", type: "enseigne" },
    { motif: "king jouet", sous_categorie: "enfants", type: "enseigne" },
    { motif: "la grande recre", sous_categorie: "enfants", type: "enseigne" },
    { motif: "okaidi", sous_categorie: "enfants", type: "enseigne" },
    { motif: "orchestra", sous_categorie: "enfants", type: "enseigne" },
    { motif: "pajemploi", sous_categorie: "enfants", type: "enseigne" },
    { motif: "restauration scolaire", sous_categorie: "enfants", type: "generique" },
    { motif: "sergent major", sous_categorie: "enfants", type: "enseigne" },
    { motif: "tape a l oeil", sous_categorie: "enfants", type: "enseigne" },
    { motif: "toys r us", sous_categorie: "enfants", type: "enseigne" },
    { motif: "vertbaudet", sous_categorie: "enfants", type: "enseigne" },
    { motif: "bmw finance", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "ca consumer finance", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "carrefour banque", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "cetelem", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "cofidis", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "cofinoga", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "credipar", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "credit renouvelable", sous_categorie: "autres_credits", type: "generique" },
    { motif: "diac", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "echeance credit conso", sous_categorie: "autres_credits", type: "generique" },
    { motif: "floa", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "franfinance", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "klarna", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "mobilize financial", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "oney", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "pret auto", sous_categorie: "autres_credits", type: "generique" },
    { motif: "pret personnel", sous_categorie: "autres_credits", type: "generique" },
    { motif: "psa banque", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "rci banque", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "scalapay", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "sofinco", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "stellantis financial", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "toyota financial", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "volkswagen bank", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "younited", sous_categorie: "autres_credits", type: "enseigne" },
    { motif: "amende", sous_categorie: "impots", type: "generique" },
    { motif: "amendes gouv", sous_categorie: "impots", type: "organisme" },
    { motif: "antai", sous_categorie: "impots", type: "organisme" },
    { motif: "direction generale des finances", sous_categorie: "impots", type: "organisme" },
    { motif: "taxe fonciere", sous_categorie: "impots", type: "generique" },
    { motif: "taxe habitation", sous_categorie: "impots", type: "generique" },
    { motif: "tresor public", sous_categorie: "impots", type: "organisme" },
    { motif: "urssaf", sous_categorie: "impots", type: "organisme" },
    { motif: "commission change", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "cotisation forfait", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "cotisation formule", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "cotisation offre", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "frais carte", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "frais de change", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "frais de dossier", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "frais de rejet", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "frais de virement", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "frais irregularite", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "frais lettre information", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "frais opposition", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "frais rejet prelevement", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "frais saisie", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "interets debiteurs", sous_categorie: "frais_bancaires", type: "generique" },
    { motif: "bagelstein", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "bert s", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "big fernand", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "big mamma", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "bistro regent", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "brasserie", sous_categorie: "restaurants", type: "generique" },
    { motif: "brioche doree", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "buffalo grill", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "burger king", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "cafeteria", sous_categorie: "restaurants", type: "generique" },
    { motif: "class croute", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "cojean", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "columbus cafe", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "courtepaille", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "creperie", sous_categorie: "restaurants", type: "generique" },
    { motif: "del arte", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "deliveroo", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "domino s", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "exki", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "five guys", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "flunch", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "frichti", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "hippopotamus", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "just eat", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "kebab", sous_categorie: "restaurants", type: "generique" },
    { motif: "kfc", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "la pataterie", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "le paradis du fruit", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "leon de bruxelles", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "mcdo", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "mcdonald s", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "memphis coffee", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "nachos", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "o tacos", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "pitaya", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "pizza hut", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "pizzeria", sous_categorie: "restaurants", type: "generique" },
    { motif: "planet sushi", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "pokawa", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "pomme de pain", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "popchef", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "pret a manger", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "quick", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "restaurant", sous_categorie: "restaurants", type: "generique" },
    { motif: "speed burger", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "starbucks", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "subway", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "sushi", sous_categorie: "restaurants", type: "generique" },
    { motif: "sushi shop", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "tablapizza", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "traiteur asiatique", sous_categorie: "restaurants", type: "generique" },
    { motif: "uber eats", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "volfoni", sous_categorie: "restaurants", type: "enseigne" },
    { motif: "billetreduc", sous_categorie: "sorties", type: "enseigne" },
    { motif: "billetterie", sous_categorie: "sorties", type: "generique" },
    { motif: "centre pompidou", sous_categorie: "sorties", type: "enseigne" },
    { motif: "cgr", sous_categorie: "sorties", type: "enseigne" },
    { motif: "chateau de versailles", sous_categorie: "sorties", type: "enseigne" },
    { motif: "cinema", sous_categorie: "sorties", type: "generique" },
    { motif: "cite des sciences", sous_categorie: "sorties", type: "enseigne" },
    { motif: "concert", sous_categorie: "sorties", type: "generique" },
    { motif: "digitick", sous_categorie: "sorties", type: "enseigne" },
    { motif: "disneyland paris", sous_categorie: "sorties", type: "enseigne" },
    { motif: "exposition", sous_categorie: "sorties", type: "generique" },
    { motif: "fever", sous_categorie: "sorties", type: "enseigne" },
    { motif: "fnac spectacles", sous_categorie: "sorties", type: "enseigne" },
    { motif: "futuroscope", sous_categorie: "sorties", type: "enseigne" },
    { motif: "gaumont", sous_categorie: "sorties", type: "enseigne" },
    { motif: "kinepolis", sous_categorie: "sorties", type: "enseigne" },
    { motif: "la villette", sous_categorie: "sorties", type: "enseigne" },
    { motif: "louvre", sous_categorie: "sorties", type: "enseigne" },
    { motif: "megarama", sous_categorie: "sorties", type: "enseigne" },
    { motif: "musee", sous_categorie: "sorties", type: "generique" },
    { motif: "musee d orsay", sous_categorie: "sorties", type: "enseigne" },
    { motif: "olympia", sous_categorie: "sorties", type: "enseigne" },
    { motif: "opera de paris", sous_categorie: "sorties", type: "enseigne" },
    { motif: "parc asterix", sous_categorie: "sorties", type: "enseigne" },
    { motif: "pathe", sous_categorie: "sorties", type: "enseigne" },
    { motif: "philharmonie", sous_categorie: "sorties", type: "enseigne" },
    { motif: "puy du fou", sous_categorie: "sorties", type: "enseigne" },
    { motif: "see tickets", sous_categorie: "sorties", type: "enseigne" },
    { motif: "shotgun", sous_categorie: "sorties", type: "enseigne" },
    { motif: "spectacle", sous_categorie: "sorties", type: "generique" },
    { motif: "theatre", sous_categorie: "sorties", type: "generique" },
    { motif: "theatre de paris", sous_categorie: "sorties", type: "enseigne" },
    { motif: "ticketmaster", sous_categorie: "sorties", type: "enseigne" },
    { motif: "ugc", sous_categorie: "sorties", type: "enseigne" },
    { motif: "vulcania", sous_categorie: "sorties", type: "enseigne" },
    { motif: "walibi", sous_categorie: "sorties", type: "enseigne" },
    { motif: "zoo de beauval", sous_categorie: "sorties", type: "enseigne" },
    { motif: "alltricks", sous_categorie: "sport", type: "enseigne" },
    { motif: "au vieux campeur", sous_categorie: "sport", type: "enseigne" },
    { motif: "basic fit", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "club de tennis", sous_categorie: "sport", type: "generique" },
    { motif: "club med gym", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "cmg sports club", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "courir", sous_categorie: "sport", type: "enseigne" },
    { motif: "cyclable", sous_categorie: "sport", type: "enseigne" },
    { motif: "decathlon", sous_categorie: "sport", type: "enseigne" },
    { motif: "ekosport", sous_categorie: "sport", type: "enseigne" },
    { motif: "episod", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "fitness park", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "foot locker", sous_categorie: "sport", type: "enseigne" },
    { motif: "forfait ski", sous_categorie: "sport", type: "generique" },
    { motif: "freeletics", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "gigafit", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "go sport", sous_categorie: "sport", type: "enseigne" },
    { motif: "intersport", sous_categorie: "sport", type: "enseigne" },
    { motif: "jd sports", sous_categorie: "sport", type: "enseigne" },
    { motif: "keep cool", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "l appart fitness", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "l orange bleue", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "liberty gym", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "magic form", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "neoness", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "on air fitness", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "patinoire", sous_categorie: "sport", type: "generique" },
    { motif: "piscine", sous_categorie: "sport", type: "generique" },
    { motif: "remontees mecaniques", sous_categorie: "sport", type: "generique" },
    { motif: "salle de sport", sous_categorie: "sport", type: "generique" },
    { motif: "skimium", sous_categorie: "sport", type: "enseigne" },
    { motif: "snowleader", sous_categorie: "sport", type: "enseigne" },
    { motif: "strava", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "ucpa", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "urban soccer", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "vita liberte", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "wellness sport club", sous_categorie: "sport", type: "enseigne", famille: "sport" },
    { motif: "abritel", sous_categorie: "voyages", type: "enseigne" },
    { motif: "accor", sous_categorie: "voyages", type: "enseigne" },
    { motif: "agence de voyages", sous_categorie: "voyages", type: "generique" },
    { motif: "air corsica", sous_categorie: "voyages", type: "enseigne" },
    { motif: "air france", sous_categorie: "voyages", type: "enseigne" },
    { motif: "airbnb", sous_categorie: "voyages", type: "enseigne" },
    { motif: "auberge de jeunesse", sous_categorie: "voyages", type: "generique" },
    { motif: "b b hotels", sous_categorie: "voyages", type: "enseigne" },
    { motif: "belambra", sous_categorie: "voyages", type: "enseigne" },
    { motif: "best western", sous_categorie: "voyages", type: "enseigne" },
    { motif: "booking com", sous_categorie: "voyages", type: "enseigne" },
    { motif: "brittany ferries", sous_categorie: "voyages", type: "enseigne" },
    { motif: "campanile", sous_categorie: "voyages", type: "enseigne" },
    { motif: "camping", sous_categorie: "voyages", type: "generique" },
    { motif: "capfun", sous_categorie: "voyages", type: "enseigne" },
    { motif: "center parcs", sous_categorie: "voyages", type: "enseigne" },
    { motif: "club med", sous_categorie: "voyages", type: "enseigne" },
    { motif: "corsair", sous_categorie: "voyages", type: "enseigne" },
    { motif: "corsica ferries", sous_categorie: "voyages", type: "enseigne" },
    { motif: "e leclerc voyages", sous_categorie: "voyages", type: "enseigne" },
    { motif: "easyjet", sous_categorie: "voyages", type: "enseigne" },
    { motif: "edreams", sous_categorie: "voyages", type: "enseigne" },
    { motif: "eurostar", sous_categorie: "voyages", type: "enseigne" },
    { motif: "expedia", sous_categorie: "voyages", type: "enseigne" },
    { motif: "flower campings", sous_categorie: "voyages", type: "enseigne" },
    { motif: "fram", sous_categorie: "voyages", type: "enseigne" },
    { motif: "gite", sous_categorie: "voyages", type: "generique" },
    { motif: "gites de france", sous_categorie: "voyages", type: "enseigne" },
    { motif: "hilton", sous_categorie: "voyages", type: "enseigne" },
    { motif: "homair", sous_categorie: "voyages", type: "enseigne" },
    { motif: "hotel", sous_categorie: "voyages", type: "generique" },
    { motif: "hotels com", sous_categorie: "voyages", type: "enseigne" },
    { motif: "huttopia", sous_categorie: "voyages", type: "enseigne" },
    { motif: "ibis", sous_categorie: "voyages", type: "enseigne" },
    { motif: "interhome", sous_categorie: "voyages", type: "enseigne" },
    { motif: "kyriad", sous_categorie: "voyages", type: "enseigne" },
    { motif: "lastminute", sous_categorie: "voyages", type: "enseigne" },
    { motif: "leclerc voyages", sous_categorie: "voyages", type: "enseigne" },
    { motif: "look voyages", sous_categorie: "voyages", type: "enseigne" },
    { motif: "marriott", sous_categorie: "voyages", type: "enseigne" },
    { motif: "mercure", sous_categorie: "voyages", type: "enseigne" },
    { motif: "novotel", sous_categorie: "voyages", type: "enseigne" },
    { motif: "odalys", sous_categorie: "voyages", type: "enseigne" },
    { motif: "opodo", sous_categorie: "voyages", type: "enseigne" },
    { motif: "pierre et vacances", sous_categorie: "voyages", type: "enseigne" },
    { motif: "premiere classe", sous_categorie: "voyages", type: "enseigne" },
    { motif: "promovacances", sous_categorie: "voyages", type: "enseigne" },
    { motif: "residence de tourisme", sous_categorie: "voyages", type: "generique" },
    { motif: "ryanair", sous_categorie: "voyages", type: "enseigne" },
    { motif: "sunelia", sous_categorie: "voyages", type: "enseigne" },
    { motif: "transavia", sous_categorie: "voyages", type: "enseigne" },
    { motif: "tui", sous_categorie: "voyages", type: "enseigne" },
    { motif: "volotea", sous_categorie: "voyages", type: "enseigne" },
    { motif: "voyage prive", sous_categorie: "voyages", type: "enseigne" },
    { motif: "vueling", sous_categorie: "voyages", type: "enseigne" },
    { motif: "vvf", sous_categorie: "voyages", type: "enseigne" },
    { motif: "yelloh village", sous_categorie: "voyages", type: "enseigne" },
    { motif: "action", sous_categorie: "shopping", type: "enseigne" },
    { motif: "adidas", sous_categorie: "shopping", type: "enseigne" },
    { motif: "aliexpress", sous_categorie: "shopping", type: "enseigne" },
    { motif: "alinea", sous_categorie: "shopping", type: "enseigne" },
    { motif: "amazon", sous_categorie: "shopping", type: "enseigne" },
    { motif: "amazon marketplace", sous_categorie: "shopping", type: "enseigne" },
    { motif: "amzn mktp", sous_categorie: "shopping", type: "enseigne" },
    { motif: "apple store", sous_categorie: "shopping", type: "enseigne" },
    { motif: "asos", sous_categorie: "shopping", type: "enseigne" },
    { motif: "back market", sous_categorie: "shopping", type: "enseigne" },
    { motif: "bershka", sous_categorie: "shopping", type: "enseigne" },
    { motif: "bijouterie", sous_categorie: "shopping", type: "generique" },
    { motif: "bon marche", sous_categorie: "shopping", type: "enseigne" },
    { motif: "bonobo", sous_categorie: "shopping", type: "enseigne" },
    { motif: "but international", sous_categorie: "shopping", type: "enseigne" },
    { motif: "camif", sous_categorie: "shopping", type: "enseigne" },
    { motif: "cdiscount", sous_categorie: "shopping", type: "enseigne" },
    { motif: "celio", sous_categorie: "shopping", type: "enseigne" },
    { motif: "centrakor", sous_categorie: "shopping", type: "enseigne" },
    { motif: "coiffeur", sous_categorie: "shopping", type: "generique" },
    { motif: "coiffure", sous_categorie: "shopping", type: "generique" },
    { motif: "conforama", sous_categorie: "shopping", type: "enseigne" },
    { motif: "cordonnerie", sous_categorie: "shopping", type: "generique" },
    { motif: "cyrillus", sous_categorie: "shopping", type: "enseigne" },
    { motif: "darty", sous_categorie: "shopping", type: "enseigne" },
    { motif: "devred", sous_categorie: "shopping", type: "enseigne" },
    { motif: "ebay", sous_categorie: "shopping", type: "enseigne" },
    { motif: "electro depot", sous_categorie: "shopping", type: "enseigne" },
    { motif: "etam", sous_categorie: "shopping", type: "enseigne" },
    { motif: "fleuriste", sous_categorie: "shopping", type: "generique" },
    { motif: "flying tiger", sous_categorie: "shopping", type: "enseigne" },
    { motif: "fnac", sous_categorie: "shopping", type: "enseigne" },
    { motif: "galeries lafayette", sous_categorie: "shopping", type: "enseigne" },
    { motif: "gemo", sous_categorie: "shopping", type: "enseigne" },
    { motif: "gifi", sous_categorie: "shopping", type: "enseigne" },
    { motif: "hema", sous_categorie: "shopping", type: "enseigne" },
    { motif: "ikea", sous_categorie: "shopping", type: "enseigne" },
    { motif: "institut de beaute", sous_categorie: "shopping", type: "generique" },
    { motif: "jennyfer", sous_categorie: "shopping", type: "enseigne" },
    { motif: "kiabi", sous_categorie: "shopping", type: "enseigne" },
    { motif: "kiko", sous_categorie: "shopping", type: "enseigne" },
    { motif: "l occitane", sous_categorie: "shopping", type: "enseigne" },
    { motif: "la foir fouille", sous_categorie: "shopping", type: "enseigne" },
    { motif: "la halle", sous_categorie: "shopping", type: "enseigne" },
    { motif: "la poste", sous_categorie: "shopping", type: "enseigne" },
    { motif: "la redoute", sous_categorie: "shopping", type: "enseigne" },
    { motif: "ldlc", sous_categorie: "shopping", type: "enseigne" },
    { motif: "leboncoin", sous_categorie: "shopping", type: "enseigne" },
    { motif: "lush", sous_categorie: "shopping", type: "enseigne" },
    { motif: "maisons du monde", sous_categorie: "shopping", type: "enseigne" },
    { motif: "mango", sous_categorie: "shopping", type: "enseigne" },
    { motif: "marionnaud", sous_categorie: "shopping", type: "enseigne" },
    { motif: "materiel net", sous_categorie: "shopping", type: "enseigne" },
    { motif: "mercerie", sous_categorie: "shopping", type: "generique" },
    { motif: "naf naf", sous_categorie: "shopping", type: "enseigne" },
    { motif: "nature et decouvertes", sous_categorie: "shopping", type: "enseigne" },
    { motif: "nike", sous_categorie: "shopping", type: "enseigne" },
    { motif: "nocibe", sous_categorie: "shopping", type: "enseigne" },
    { motif: "noz", sous_categorie: "shopping", type: "enseigne" },
    { motif: "parfumerie", sous_categorie: "shopping", type: "generique" },
    { motif: "picwictoys", sous_categorie: "shopping", type: "enseigne" },
    { motif: "pimkie", sous_categorie: "shopping", type: "enseigne" },
    { motif: "pressing", sous_categorie: "shopping", type: "generique" },
    { motif: "primark", sous_categorie: "shopping", type: "enseigne" },
    { motif: "printemps", sous_categorie: "shopping", type: "enseigne" },
    { motif: "promod", sous_categorie: "shopping", type: "enseigne" },
    { motif: "pull bear", sous_categorie: "shopping", type: "enseigne" },
    { motif: "quincaillerie", sous_categorie: "shopping", type: "generique" },
    { motif: "rituals", sous_categorie: "shopping", type: "enseigne" },
    { motif: "rue du commerce", sous_categorie: "shopping", type: "enseigne" },
    { motif: "samsung", sous_categorie: "shopping", type: "enseigne" },
    { motif: "sephora", sous_categorie: "shopping", type: "enseigne" },
    { motif: "shein", sous_categorie: "shopping", type: "enseigne" },
    { motif: "showroomprive", sous_categorie: "shopping", type: "enseigne" },
    { motif: "sostrene grene", sous_categorie: "shopping", type: "enseigne" },
    { motif: "temu", sous_categorie: "shopping", type: "enseigne" },
    { motif: "the body shop", sous_categorie: "shopping", type: "enseigne" },
    { motif: "undiz", sous_categorie: "shopping", type: "enseigne" },
    { motif: "uniqlo", sous_categorie: "shopping", type: "enseigne" },
    { motif: "veepee", sous_categorie: "shopping", type: "enseigne" },
    { motif: "vinted", sous_categorie: "shopping", type: "enseigne" },
    { motif: "yves rocher", sous_categorie: "shopping", type: "enseigne" },
    { motif: "zalando", sous_categorie: "shopping", type: "enseigne" },
    { motif: "zara", sous_categorie: "shopping", type: "enseigne" },
    { motif: "zodio", sous_categorie: "shopping", type: "enseigne" },
    { motif: "adn anime", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "adobe", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "amazon music", sous_categorie: "abonnements", type: "enseigne", famille: "musique" },
    { motif: "amazon prime", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "anthropic", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "app store", sous_categorie: "abonnements", type: "generique", famille: "autre" },
    { motif: "apple com bill", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "apple music", sous_categorie: "abonnements", type: "enseigne", famille: "musique" },
    { motif: "apple tv", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "audible", sous_categorie: "abonnements", type: "enseigne", famille: "livres" },
    { motif: "babbel", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "bein sports", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "cafeyn", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "canal", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "canal plus", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "canva", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "chatgpt", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "courrier international", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "crunchyroll", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "dashlane", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "dazn", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "deezer", sous_categorie: "abonnements", type: "enseigne", famille: "musique" },
    { motif: "disney plus", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "disneyplus", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "dropbox", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "duolingo", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "epsiloon", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "evernote", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "google one", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "google play", sous_categorie: "abonnements", type: "generique", famille: "autre" },
    { motif: "google storage", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "hbo max", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "icloud", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "kindle unlimited", sous_categorie: "abonnements", type: "enseigne", famille: "livres" },
    { motif: "kobo plus", sous_categorie: "abonnements", type: "enseigne", famille: "livres" },
    { motif: "l equipe", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "l express", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "l obs", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "la depeche", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "la provence", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "la voix du nord", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "le canard enchaine", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "le dauphine libere", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "le figaro", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "le monde", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "le parisien", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "le point", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "le progres", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "le telegramme", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "les echos", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "les jours", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "liberation", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "linkedin", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "mediapart", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "microsoft", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "molotov", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "mubi", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "mycanal", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "netflix", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "nice matin", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "nintendo eshop", sous_categorie: "abonnements", type: "enseigne", famille: "jeux" },
    { motif: "nordvpn", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "norton", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "notion labs", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "ocs", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "openai", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "ouest france", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "paramount plus", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "playstation network", sous_categorie: "abonnements", type: "enseigne", famille: "jeux" },
    { motif: "prime video", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "proton", sous_categorie: "abonnements", type: "enseigne", famille: "logiciel" },
    { motif: "qobuz", sous_categorie: "abonnements", type: "enseigne", famille: "musique" },
    { motif: "rmc sport", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "science et vie", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "soundcloud", sous_categorie: "abonnements", type: "enseigne", famille: "musique" },
    { motif: "spotify", sous_categorie: "abonnements", type: "enseigne", famille: "musique" },
    { motif: "sud ouest", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "telerama", sous_categorie: "abonnements", type: "enseigne", famille: "presse" },
    { motif: "tidal", sous_categorie: "abonnements", type: "enseigne", famille: "musique" },
    { motif: "twitch", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "ubisoft", sous_categorie: "abonnements", type: "enseigne", famille: "jeux" },
    { motif: "universcine", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "xbox game pass", sous_categorie: "abonnements", type: "enseigne", famille: "jeux" },
    { motif: "youboox", sous_categorie: "abonnements", type: "enseigne", famille: "livres" },
    { motif: "youtube", sous_categorie: "abonnements", type: "enseigne", famille: "video" },
    { motif: "betclic", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "bowling", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "bureau de tabac", sous_categorie: "loisirs", type: "generique" },
    { motif: "cours de musique", sous_categorie: "loisirs", type: "generique" },
    { motif: "cultura", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "decitre", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "escape game", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "fdj", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "furet du nord", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "gibert jeune", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "gibert joseph", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "jeux video", sous_categorie: "loisirs", type: "generique" },
    { motif: "laser game", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "le geant des beaux arts", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "librairie", sous_categorie: "loisirs", type: "generique" },
    { motif: "loisirs creatifs", sous_categorie: "loisirs", type: "generique" },
    { motif: "maison de la presse", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "micromania", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "mollat", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "nintendo", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "parions sport", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "playstation", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "pmu", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "relay", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "rougier ple", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "smartbox", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "steam", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "tabac presse", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "unibet", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "winamax", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "wonderbox", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "xbox", sous_categorie: "loisirs", type: "enseigne" },
    { motif: "action contre la faim", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "action logement", sous_categorie: "credit_logement", type: "organisme" },
    { motif: "cagnotte", sous_categorie: "cadeaux_dons", type: "generique" },
    { motif: "carte cadeau", sous_categorie: "cadeaux_dons", type: "generique" },
    { motif: "croix rouge", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "don en ligne", sous_categorie: "cadeaux_dons", type: "generique" },
    { motif: "fondation abbe pierre", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "fondation de france", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "handicap international", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "helloasso", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "institut pasteur", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "leetchi", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "lepotcommun", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "medecins sans frontieres", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "restos du coeur", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "secours populaire", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "telethon", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "unicef", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "wwf", sous_categorie: "cadeaux_dons", type: "organisme" },
    { motif: "animalerie", sous_categorie: "animaux", type: "generique" },
    { motif: "animalis", sous_categorie: "animaux", type: "enseigne" },
    { motif: "bitiba", sous_categorie: "animaux", type: "enseigne" },
    { motif: "clinique veterinaire", sous_categorie: "animaux", type: "generique" },
    { motif: "jardiland animalerie", sous_categorie: "animaux", type: "enseigne" },
    { motif: "maxi zoo", sous_categorie: "animaux", type: "enseigne" },
    { motif: "medor et compagnie", sous_categorie: "animaux", type: "enseigne" },
    { motif: "toilettage", sous_categorie: "animaux", type: "generique" },
    { motif: "tom co", sous_categorie: "animaux", type: "enseigne" },
    { motif: "veterinaire", sous_categorie: "animaux", type: "generique" },
    { motif: "wanimo", sous_categorie: "animaux", type: "enseigne" },
    { motif: "zooplus", sous_categorie: "animaux", type: "enseigne" },
    { motif: "ldds", sous_categorie: "epargne_precaution", type: "generique" },
    { motif: "lep", sous_categorie: "epargne_precaution", type: "generique" },
    { motif: "livret a", sous_categorie: "epargne_precaution", type: "generique" },
    { motif: "livret developpement durable", sous_categorie: "epargne_precaution", type: "generique" },
    { motif: "livret jeune", sous_categorie: "epargne_precaution", type: "generique" },
    { motif: "assurance vie", sous_categorie: "investissement", type: "generique" },
    { motif: "binance", sous_categorie: "investissement", type: "enseigne" },
    { motif: "bitstack", sous_categorie: "investissement", type: "enseigne" },
    { motif: "bourse direct", sous_categorie: "investissement", type: "enseigne" },
    { motif: "coinbase", sous_categorie: "investissement", type: "enseigne" },
    { motif: "degiro", sous_categorie: "investissement", type: "enseigne" },
    { motif: "goodvest", sous_categorie: "investissement", type: "enseigne" },
    { motif: "kraken", sous_categorie: "investissement", type: "enseigne" },
    { motif: "linxea", sous_categorie: "investissement", type: "enseigne" },
    { motif: "nalo", sous_categorie: "investissement", type: "enseigne" },
    { motif: "paymium", sous_categorie: "investissement", type: "enseigne" },
    { motif: "placement direct", sous_categorie: "investissement", type: "enseigne" },
    { motif: "plan epargne retraite", sous_categorie: "investissement", type: "generique" },
    { motif: "ramify", sous_categorie: "investissement", type: "enseigne" },
    { motif: "trade republic", sous_categorie: "investissement", type: "enseigne" },
    { motif: "versement pea", sous_categorie: "investissement", type: "generique" },
    { motif: "versement per", sous_categorie: "investissement", type: "generique" },
    { motif: "yomoni", sous_categorie: "investissement", type: "enseigne" },
    { motif: "agirc arrco", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
    { motif: "assurance retraite", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
    { motif: "carsat", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
    { motif: "cipav", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
    { motif: "cnav", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
    { motif: "cnracl", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
    { motif: "france travail", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
    { motif: "ircantec", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
    { motif: "msa", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
    { motif: "pension", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
    { motif: "pole emploi", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
    { motif: "retraite complementaire", sous_categorie: "revenus_autres", type: "organisme", sens: "entree" },
  ];

  /* ================================================================== libellés */
  /** Noms de mois (complets et abrégés, sans accents) retirés des libellés. Même liste que MOIS_LIBELLES de synchro.ts et de mcp/banque.ts (parité testée). */
  const MOIS_LIBELLES = ["janvier", "janv", "jan", "fevrier", "fevr", "fev", "mars", "mar", "avril", "avr", "mai", "juin", "juillet", "juil",
    "juill", "aout", "septembre", "sept", "sep", "octobre", "oct", "novembre", "nov", "decembre", "dec"];
  /** Longueur maximale de cle_marchand : celle de LIBELLE_RECURRENT_MAX du connecteur (la clé déjà renvoyée par lire_banque pour les récurrents). */
  const LIBELLE_RECURRENT_MAX = 40;
  /** Libellé nettoyé : minuscules, sans accents, tout ce qui n'est pas une lettre devient espace, sans noms de mois, espaces réduits. Même règle que
      cleLibelle de synchro.ts (fonction powens) et de mcp/banque.ts (parité testée). */
  function cleLibelle(t) {
    return String(t == null ? "" : t).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, " ").trim()
      .split(" ").filter(m => m && !MOIS_LIBELLES.includes(m)).join(" ");
  }
  /** Clé d'un marchand : le libellé nettoyé, tronqué à LIBELLE_RECURRENT_MAX caractères. */
  const cleMarchand = t => cleLibelle(t).slice(0, LIBELLE_RECURRENT_MAX).trim();

  /* ================================================================== lectures de la taxonomie */
  const estSousCategorie = cle => typeof cle === "string" && PAR_CLE.has(cle);
  /** Catégorie large d'une sous-catégorie (celle des lecteurs existants), null si la clé est inconnue. */
  const largeDe = cle => (estSousCategorie(cle) ? PAR_CLE.get(cle).categorie : null);
  /** Bloc d'une sous-catégorie. Seules les espèces se règlent (preferences.especes_bloc : envies ou essentiels, défaut envies) ; null si la clé est inconnue. */
  function blocDe(cle, preferences) {
    if (!estSousCategorie(cle)) return null;
    const t = PAR_CLE.get(cle), choix = preferences && preferences.especes_bloc;
    return t.bloc_reglable && t.bloc_reglable.includes(choix) ? choix : t.bloc;
  }
  /** Sous-catégorie donnée à une catégorie large par la reprise de banque_mois ; « à classer » pour une catégorie inconnue. */
  const parDefautDe = categorie => (typeof categorie === "string" && Object.prototype.hasOwnProperty.call(PAR_DEFAUT, categorie) ? PAR_DEFAUT[categorie] : "a_classer");

  /** Sous-catégorie d'un code Powens : le code enfant d'abord, puis le code parent ; null si aucun ne dit rien. Accepte un code, un objet { code, parent_code }
      ou le tableau `categories` d'une opération (le premier élément). */
  function sousCategoriePowens(categoriePowens) {
    const c = Array.isArray(categoriePowens) ? categoriePowens[0] : categoriePowens;
    const code = v => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null);
    const lire = k => (k !== null && Object.prototype.hasOwnProperty.call(CORRESPONDANCE_POWENS, k) ? CORRESPONDANCE_POWENS[k] : null);
    if (typeof c === "string") return lire(code(c));
    if (c && typeof c === "object") return lire(code(c.code)) || lire(code(c.parent_code)) || null;
    return null;
  }

  /* ================================================================== suites de mots */
  const mots = t => cleLibelle(t).split(" ").filter(Boolean);
  /** Vrai si `sous` (liste de mots) est une suite contiguë de `mots` (jamais une sous-chaîne : « edf » ne prend pas « medfit »). */
  function contientSuite(liste, sous) {
    if (!sous.length) return false;
    for (let i = 0; i + sous.length <= liste.length; i++) {
      let ok = true;
      for (let j = 0; j < sous.length; j++) if (liste[i + j] !== sous[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }
  const nombre = v => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim().replace(",", ".")) : NaN);
  /** Un sens (sortie : montant < 0, entree : montant > 0, les_deux ou absent : tous) vaut-il pour ce montant ? */
  function sensVaut(sens, montant) {
    if (sens === "sortie") return montant < 0;
    if (sens === "entree") return montant > 0;
    return true;
  }
  /** Index d'une table de motifs par premier mot : les entrées gardent leur rang (à égalité de longueur, la première de la table gagne). */
  function indexer(table) {
    const index = new Map();
    table.forEach((e, rang) => {
      const suite = typeof e.motif === "string" ? mots(e.motif) : [];
      if (!suite.length) return;
      const c = { e, rang, suite, longueur: suite.join(" ").length };
      if (!index.has(suite[0])) index.set(suite[0], []);
      index.get(suite[0]).push(c);
    });
    return index;
  }
  const INDEX_MARCHANDS = indexer(MARCHANDS), INDEX_MOTIFS = indexer(MOTIFS);
  /** Meilleure entrée d'une table pour un libellé : la plus longue suite (en caractères), à égalité la première de la table. */
  function meilleure(index, motsLibelle, montant) {
    let best = null;
    motsLibelle.forEach((m, i) => {
      for (const c of index.get(m) || []) {
        if (!sensVaut(c.e.sens, montant)) continue;
        if (best && (c.longueur < best.longueur || (c.longueur === best.longueur && c.rang > best.rang))) continue;
        if (c.suite.every((w, j) => motsLibelle[i + j] === w)) best = c;
      }
    });
    return best && best.e;
  }

  /* ================================================================== règles personnelles (spec § 3.4) */
  const MOTIF_MIN = 3, MOTIF_MAX = 60, SENS = ["sortie", "entree", "les_deux"];
  const borne = v => v === null || v === undefined;
  /** Message de refus d'une sous-catégorie de règle, nul si une règle peut la viser : une vraie sous-catégorie de dépense, de revenu ou d'épargne
      (jamais « à classer », jamais « hors budget » sauf apport au commun et virement entre personnes du foyer). */
  function refusSousCategorie(s) {
    if (!estSousCategorie(s)) return "Cette sous-catégorie n'existe pas : choisis-en une de la liste.";
    if (s === "a_classer") return "Une règle doit ranger l'opération quelque part : choisis une sous-catégorie.";
    if (s === "commun_non_detaille") return "Cette sous-catégorie est posée par Boussole quand le compte commun n'est pas connecté : choisis-en une autre.";
    if (PAR_CLE.get(s).bloc === "hors_budget" && !HORS_BUDGET_EN_REGLE.includes(s)) return "Une règle ne peut pas écarter une opération du budget : seuls l'apport au compte commun et le virement entre deux personnes du foyer sont permis.";
    return null;
  }
  /** Nul si la règle est acceptable, sinon le message (en français, au tutoiement) à montrer. Mêmes refus que la base (budget_regles). */
  function regleValide(regle) {
    if (!regle || typeof regle !== "object" || Array.isArray(regle)) return "Une règle est un motif et une sous-catégorie.";
    const motif = regle.motif;
    if (typeof motif !== "string" || motif.trim().length < MOTIF_MIN || motif.trim().length > MOTIF_MAX) return "Le motif doit faire entre 3 et 60 caractères.";
    if (/[0-9]{6,}/.test(motif)) return "Le motif ne doit pas contenir de suite de 6 chiffres ou plus : garde seulement le nom reconnaissable du libellé.";
    if (Sensible.estSensible(motif) || Sensible.estSensible(motif.toUpperCase())) return "Le motif ne doit contenir ni numéro de compte ou de carte, ni mot de passe.";
    if (cleLibelle(motif).length < MOTIF_MIN) return "Le motif doit contenir au moins 3 lettres : les chiffres et la ponctuation ne comptent pas.";
    const refus = refusSousCategorie(regle.sous_categorie);
    if (refus) return refus;
    if (!borne(regle.sens) && !SENS.includes(regle.sens)) return "Le sens d'une règle est sortie, entree ou les_deux.";
    for (const k of ["montant_min", "montant_max"]) if (!borne(regle[k]) && !(typeof regle[k] === "number" && isFinite(regle[k]) && regle[k] >= 0)) return "Les bornes de montant sont des nombres positifs.";
    if (!borne(regle.montant_min) && !borne(regle.montant_max) && regle.montant_min > regle.montant_max) return "Les bornes de montant sont inversées : le minimum dépasse le maximum.";
    if (!borne(regle.annuelle) && typeof regle.annuelle !== "boolean") return "« annuelle » est oui ou non.";
    return null;
  }
  /** Vrai si la règle (active) s'applique à l'opération : motif en suite de mots du libellé, sens, compte, bornes sur la valeur absolue du montant. */
  function correspond(regle, op) {
    if (!regle || typeof regle !== "object" || !op || typeof op !== "object" || regle.active === false) return false;
    const m = nombre(op.montant);
    if (!sensVaut(borne(regle.sens) ? "sortie" : regle.sens, m)) return false;
    if (!borne(regle.compte_id) && String(regle.compte_id) !== String(op.compte_id)) return false;
    const a = Math.abs(m);
    if (!borne(regle.montant_min) && !(a >= Number(regle.montant_min))) return false;
    if (!borne(regle.montant_max) && !(a <= Number(regle.montant_max))) return false;
    return contientSuite(mots(op.libelle), mots(regle.motif));
  }
  const bornee = r => (!borne(r.montant_min) || !borne(r.montant_max) ? 1 : 0);
  /** Règles qui s'appliquent, de la plus spécifique à la moins spécifique : compte précisé, puis bornes de montant, puis motif le plus long (caractères),
      puis création la plus ancienne ; à égalité, l'ordre donné. Une règle dont la sous-catégorie est refusée (à classer, hors budget, inconnue) ne classe rien. */
  function reglesQuiCorrespondent(regles, op) {
    const ordre = r => [borne(r.compte_id) ? 0 : 1, bornee(r), cleLibelle(r.motif).length];
    const date = r => (typeof r.cree_le === "string" ? r.cree_le : "");
    return (Array.isArray(regles) ? regles : []).filter(r => correspond(r, op) && refusSousCategorie(r.sous_categorie) === null)
      .map((r, i) => ({ r, i, o: ordre(r) }))
      .sort((x, y) => (y.o[0] - x.o[0]) || (y.o[1] - x.o[1]) || (y.o[2] - x.o[2]) || (date(x.r) < date(y.r) ? -1 : date(x.r) > date(y.r) ? 1 : 0) || (x.i - y.i))
      .map(x => x.r);
  }

  /* ================================================================== classement d'une opération (spec § 3.2) */
  /** Classe une opération. Sortie : { sous_categorie, categorie (large), origine: structure | regle | marchand | powens | motif | revenu | defaut, regle_id?, cle_marchand }.
      Jamais d'exception : une opération mal formée est « à classer ». */
  function classer(op, ctx) {
    const o = op && typeof op === "object" ? op : {}, c = ctx && typeof ctx === "object" ? ctx : {};
    const montant = nombre(o.montant), cle = cleMarchand(o.libelle), liste = mots(o.libelle);
    const rendre = (sous_categorie, origine, regle_id) => {
      const r = { sous_categorie, categorie: largeDe(sous_categorie), origine, cle_marchand: cle };
      if (regle_id !== undefined) r.regle_id = regle_id;
      return r;
    };
    // 1. structure : posée par le rapprochement, jamais surchargée
    if (STRUCTURES.includes(o.structure)) return rendre(o.structure, "structure");
    // 2. tes règles
    const regle = reglesQuiCorrespondent(c.regles, o)[0];
    if (regle) return rendre(regle.sous_categorie, "regle", regle.id);
    // 3. table des marchands
    const marchand = meilleure(Array.isArray(c.marchands) ? indexer(c.marchands) : INDEX_MARCHANDS, liste, montant);
    if (marchand) return rendre(marchand.sous_categorie, "marchand");
    // 4. catégorie Powens
    const powens = sousCategoriePowens(o.categorie_powens);
    if (powens) return rendre(powens, "powens");
    // 5. motifs génériques
    const motif = meilleure(INDEX_MOTIFS, liste, montant);
    if (motif) return rendre(motif.sous_categorie, "motif");
    // 6. revenu détecté : une entrée stable retenue comme salaire
    if (o.revenu_detecte === true && montant > 0) return rendre("salaires", "revenu");
    // 7. rien ne reconnaît l'opération
    return rendre("a_classer", "defaut");
  }

  return { VERSION_TAXONOMIE, VERSION_MARCHANDS, BLOCS, TAXONOMIE, MARCHANDS, MOTIFS, CORRESPONDANCE_POWENS, MOIS_LIBELLES, LIBELLE_RECURRENT_MAX,
    classer, regleValide, correspond, largeDe, blocDe, parDefautDe, sousCategoriePowens, estSousCategorie, cleLibelle, cleMarchand };
});
});

/* ---------- web/src/reperes.js ---------- */
def("reperes", function (module, exports, require) {
/* Repères chiffrés du savoir commun (table reperes) : lecture avec valeur de secours, ancienneté, format français.
   Pur, sans DOM. S.savoir.reperes = [{ cle, libelle, valeur, unite, dateEffet, dateFin, sourceTitre, sourceUrl, verifieLe, mode }]
   (dateFin : fin d'un dispositif ou d'une période, null si aucune). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Reperes = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const A_VERIFIER_JOURS = 180;
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const trouver = (liste, cle) => (Array.isArray(liste) ? liste.find(r => r && r.cle === cle) : null) || null;
  /** Valeur du repère `cle`, ou `defaut` s'il est absent (table injoignable, démo sans repère). */
  function valeur(liste, cle, defaut) { const r = trouver(liste, cle); return r && isFinite(+r.valeur) ? +r.valeur : defaut; }
  /** Vrai si la dernière vérification date de plus de 180 jours. */
  function aVerifier(r, today) {
    if (!r || !r.verifieLe) return true;
    return (Date.parse(today || new Date().toISOString().slice(0, 10)) - Date.parse(r.verifieLe)) / 864e5 > A_VERIFIER_JOURS;
  }
  function format(r) { return r ? nf.format(+r.valeur) + " " + r.unite : ""; }
  function depuisLignes(rows) {
    return (rows || []).map(x => ({ cle: x.cle, libelle: x.libelle, valeur: +x.valeur, unite: x.unite, dateEffet: x.date_effet,
      dateFin: x.date_fin || null, sourceTitre: x.source_titre, sourceUrl: x.source_url, verifieLe: x.verifie_le, mode: x.mode }));
  }
  return { valeur, aVerifier, format, depuisLignes, trouver, A_VERIFIER_JOURS };
});
});

/* ---------- web/src/calendrier.js ---------- */
def("calendrier", function (module, exports, require) {
/* Calendrier patrimonial (DAT1, docs/superpowers/specs/2026-10-14-dat1-calendrier-design.md) : les dates qui font courir les délais
   fiscaux de chaque enveloppe (PEA à 5 ans, assurance-vie à 8 ans et au 70ᵉ anniversaire, PEL, épargne salariale, donations à 15 ans,
   moins-values à 10 ans, plafond épargne retraite, 31 décembre, révision des livrets, fin des prêts). Pur, sans DOM, au tutoiement.
   Jamais une date sans donnée : une donnée manquante devient « à compléter » ; un repère manquant rend la règle « indisponible ».
   Les durées, âges et montants viennent des repères sourcés (table reperes, S.savoir.reperes) ; ce fichier ne contient que la logique
   (quelle date part de quelle donnée). Porté à l'identique dans supabase/functions/mcp/calendrier.ts (parité testée sur
   test/fixtures/calendrier-cas.json).

   Calendrier.calendrier(data, today, options?) → {
     jalons: [{ id, date, enveloppe, enveloppe_nom, titulaire, type, cle, titre, effet, calcul, statut: passe|proche|futur, jours, delai,
                source: { titre, url, verifie_le, reperes }, confiance: sure|approchee|calculee, donnee: { champ, source, le } | null,
                avertissements: [texte] }],
     a_completer: [{ id, enveloppe, enveloppe_nom, titulaire, type, cle, champ, titre, pourquoi, document }],
     seuils: [{ id, enveloppe, enveloppe_nom, cle, titre, verse, plafond, reste, source, donnee }],
     regles_indisponibles: [{ cle, reperes_manquants: [cle] }],
     prochains: [3 premiers jalons non passés], dans_3_mois: [jalons proches] }
   data = { positions, config, profil, credits, biens, reperes } (formes de l'app ; Calendrier.depuisEtat(S) la construit depuis le store) ; today = AAAA-MM-JJ (date de Paris) ;
   options = { horizonAns = 40 }. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Calendrier = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  const R = (root && root.Reperes) || (typeof require === "function" ? require("./reperes.js") : null);
  const PROCHE_JOURS = 92;
  const HORIZON_DEFAUT = 40;

  /** Types d'enveloppe et leur libellé. */
  const TYPES = {
    pea: "PEA", pea_pme: "PEA PME-ETI", pea_jeune: "PEA d'un majeur rattaché", assurance_vie: "Assurance-vie", capitalisation: "Contrat de capitalisation",
    per: "PER", pel: "PEL", cel: "CEL", pee: "PEE", percol: "PERCOL", compte_titres: "Compte-titres", livret_a: "Livret A", ldds: "LDDS", lep: "LEP", autre: "Autre",
  };

  /* ------------------------------------------------------------------ dates */
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const pad = (n, l) => String(n).padStart(l || 2, "0");
  const dernierJour = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (y, m, d) => pad(y, 4) + "-" + pad(m) + "-" + pad(d);
  const morceaux = s => s.split("-").map(Number);
  /** Vrai pour une date réelle au format AAAA-MM-JJ (2026-02-30 est refusée). */
  function estDate(s) {
    if (typeof s !== "string" || !ISO.test(s)) return false;
    const [y, m, d] = morceaux(s);
    return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= dernierJour(y, m);
  }
  const utc = s => { const [y, m, d] = morceaux(s); return Date.UTC(y, m - 1, d); };
  /** Ajoute n mois au même quantième, ou au dernier jour du mois s'il n'existe pas (art. 641 du code de procédure civile). */
  function ajouterMois(s, n) {
    const [y, m, d] = morceaux(s), t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = t - ny * 12 + 1;
    return iso(ny, nm, Math.min(d, dernierJour(ny, nm)));
  }
  const ajouterAns = (s, n) => ajouterMois(s, n * 12);
  function lendemain(s) { const t = new Date(utc(s) + 864e5); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  /** Écart signé en jours entre deux dates (calcul en UTC : aucune dérive d'heure d'été). */
  const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  const annee = s => +s.slice(0, 4);
  const dateFr = s => (estDate(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : String(s == null ? "" : s));
  /** Date approchée « AAAA » ou « AAAA-MM » → { min, max } (premier et dernier jour possibles), ou null. */
  function approx(s) {
    const m = typeof s === "string" ? /^(\d{4})(?:-(\d{2}))?$/.exec(s) : null;
    if (!m) return null;
    const y = +m[1];
    if (m[2] == null) return { min: iso(y, 1, 1), max: iso(y, 12, 31) };
    const mo = +m[2];
    return mo >= 1 && mo <= 12 ? { min: iso(y, mo, 1), max: iso(y, mo, dernierJour(y, mo)) } : null;
  }
  const statutDe = jours => (jours < 0 ? "passe" : jours <= PROCHE_JOURS ? "proche" : "futur");

  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const eur = v => nf.format(+v) + " €";
  /** « dans 1 an et 4 mois », « dans 12 jours », « aujourd'hui », « il y a 3 mois ». */
  function texteDelai(jours) {
    const j = Math.round(+jours);
    if (!isFinite(j)) return "";
    if (j === 0) return "aujourd'hui";
    const a = Math.abs(j);
    let t;
    if (a < 60) t = a + (a > 1 ? " jours" : " jour");
    else {
      const mois = Math.max(2, Math.round(a / 30.4375)), ans = Math.floor(mois / 12), reste = mois % 12;
      t = mois < 12 ? mois + " mois" : ans + (ans > 1 ? " ans" : " an") + (reste ? " et " + reste + " mois" : "");
    }
    return j > 0 ? "dans " + t : "il y a " + t;
  }

  /* ------------------------------------------------------------------ types déduits du nom */
  const sansAccent = s => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const mots = s => sansAccent(s).split(/[^a-z0-9]+/).filter(Boolean);
  const contient = (ts, suite) => ts.some((_, i) => suite.every((m, k) => ts[i + k] === m));
  /** Type d'une enveloppe d'après son nom (mêmes motifs que pratiques.js et powens/synchro.ts), ou null si le nom ne dit rien. */
  function typeDeduit(nom) {
    const ts = mots(nom);
    if (!ts.length) return null;
    if (ts.includes("pea") || ts[0].startsWith("pea")) return ts.includes("pme") || ts.includes("eti") ? "pea_pme" : ts.includes("jeune") ? "pea_jeune" : "pea";
    if (ts.includes("cto") || contient(ts, ["compte", "titres"]) || contient(ts, ["compte", "titre"]) || contient(ts, ["comptes", "titres"])) return "compte_titres";
    if (ts.includes("capitalisation")) return "capitalisation";
    if (contient(ts, ["assurance", "vie"]) || ts.includes("av")) return "assurance_vie";
    if (ts.includes("percol") || ts.includes("perco")) return "percol";
    if (ts.includes("per") || ts.includes("perin")) return "per";
    if (ts.includes("pel")) return "pel";
    if (ts.includes("cel")) return "cel";
    if (ts.includes("pee")) return "pee";
    if (ts.includes("ldds")) return "ldds";
    if (ts.includes("lep")) return "lep";
    if (contient(ts, ["livret", "a"])) return "livret_a";
    return null;
  }
  const LIVRETS = ["livret_a", "ldds", "lep"];

  /* ------------------------------------------------------------------ catalogue des règles (spec § 3.1) */
  /* Chaque règle : clé, types concernés, ancre (la donnée dont part la date), repères (durées, âges et montants), fiche du savoir,
     titre et effet (gabarits : {env}, {montant}, {annee}, {beneficiaire}, {date}, {mensualite}, {taux}, ou la clé d'un repère, rendue
     au format français). `effetPasse` : même effet une fois la date passée. `variantes` : effets propres à un cas (génération du plan,
     lien ou nature de la donation). Aucun produit ni établissement nommé ; les effets sont décrits, jamais recommandés. */
  const REGLES = [
    { cle: "pea_5_ans", types: ["pea", "pea_pme", "pea_jeune"], ancre: "date_ouverture", reperes: ["pea_duree_ans"], fiche: "pea",
      titre: "{env} : {pea_duree_ans} révolus",
      effet: "Un retrait partiel ne clôture plus le plan et {qui} peut continuer à verser. Les gains sont exonérés d'impôt sur le revenu ; les prélèvements sociaux restent dus. Avant cette date, un retrait clôture le plan, sauf cas prévus par la loi (licenciement, invalidité, mise à la retraite anticipée…).",
      effetPasse: "Les {pea_duree_ans} sont révolus : un retrait partiel ne clôture plus le plan et {qui} peut continuer à verser. Les gains sont exonérés d'impôt sur le revenu ; les prélèvements sociaux restent dus." },
    { cle: "av_8_ans", types: ["assurance_vie", "capitalisation"], ancre: "date_ouverture",
      reperes: ["av_duree_ans", "av_abattement_seul", "av_abattement_couple", "av_seuil_versements"], fiche: "assurance-vie",
      titre: "{env} : {av_duree_ans} révolus",
      effet: "Les gains retirés bénéficient chaque année d'un abattement de {av_abattement_seul} ({av_abattement_couple} pour un couple soumis à imposition commune), tous contrats confondus. Au-delà, ils sont taxés à un taux réduit tant que les versements nets (tous contrats confondus) restent sous {av_seuil_versements} ; au-dessus, ce taux ne s'applique qu'au prorata. L'abattement ne joue que sur l'impôt sur le revenu : les prélèvements sociaux restent dus sur la totalité des gains.",
      effetPasse: "Les {av_duree_ans} sont révolus : les gains retirés bénéficient chaque année d'un abattement de {av_abattement_seul} ({av_abattement_couple} pour un couple soumis à imposition commune), tous contrats confondus. Au-delà, ils sont taxés à un taux réduit tant que les versements nets (tous contrats confondus) restent sous {av_seuil_versements} ; au-dessus, ce taux ne s'applique qu'au prorata. L'abattement ne joue que sur l'impôt sur le revenu : les prélèvements sociaux restent dus sur la totalité des gains." },
    { cle: "av_70_ans", types: ["assurance_vie"], ancre: "naissance", reperes: ["av_age_seuil", "av_990i_abattement", "av_757b_abattement"], fiche: "assurance-vie",
      titre: "{env} : {av_age_seuil} de l'assuré",
      effet: "Les versements faits avant cette date relèvent, au décès de l'assuré, d'un abattement de {av_990i_abattement} par bénéficiaire. Ceux faits ensuite relèvent d'un abattement global de {av_757b_abattement}, tous contrats et bénéficiaires confondus ; seuls ces versements sont comptés, pas les gains qu'ils ont produits.",
      effetPasse: "L'assuré a passé les {av_age_seuil} : les versements faits avant relèvent, à son décès, d'un abattement de {av_990i_abattement} par bénéficiaire. Ceux faits depuis relèvent d'un abattement global de {av_757b_abattement}, tous contrats et bénéficiaires confondus ; seuls ces versements sont comptés, pas les gains qu'ils ont produits." },
    { cle: "pel_2_ans", types: ["pel"], ancre: "date_ouverture", reperes: ["pel_retrait_min_ans"], fiche: null,
      titre: "{env} : {pel_retrait_min_ans} révolus",
      effet: "Un retrait, à tout moment, clôture le PEL. Avant cette date, ses intérêts sont alors recalculés au taux du CEL et tu perds le droit au prêt.",
      effetPasse: "Les {pel_retrait_min_ans} sont révolus : clôturer le PEL ne fait plus recalculer ses intérêts au taux du CEL." },
    { cle: "pel_4_ans", types: ["pel"], ancre: "date_ouverture", reperes: ["pel_duree_min_ans", "pel_duree_max_ans"], fiche: null,
      titre: "{env} : {pel_duree_min_ans} révolus",
      effet: "Durée minimale du plan atteinte. Il peut être prolongé jusqu'à {pel_duree_max_ans}.",
      effetPasse: "Durée minimale du plan atteinte ({pel_duree_min_ans}). Il peut être prolongé jusqu'à {pel_duree_max_ans}." },
    { cle: "pel_10_ans", types: ["pel"], ancre: "date_ouverture", reperes: ["pel_duree_max_ans", "pel_duree_vie_ans"], fiche: null,
      titre: "{env} : {pel_duree_max_ans}, fin des versements",
      effet: "Fin des versements : le plan ne reçoit plus d'argent, ses intérêts continuent de courir pendant {pel_prolongation} au plus.",
      effetPasse: "Fin des versements : le plan ne reçoit plus d'argent, ses intérêts continuent de courir pendant {pel_prolongation} au plus.",
      variantes: { avant_2011: {
        reperes: ["pel_duree_max_ans"],
        effet: "Fin des versements : le plan ne reçoit plus d'argent ; ses intérêts continuent de courir au taux du contrat, sans limite de durée.",
        effetPasse: "Fin des versements : le plan ne reçoit plus d'argent ; ses intérêts continuent de courir au taux du contrat, sans limite de durée." } } },
    { cle: "pel_15_ans", types: ["pel"], ancre: "date_ouverture", reperes: ["pel_duree_vie_ans"], fiche: null,
      titre: "{env} : {pel_duree_vie_ans}, fin du plan",
      effet: "Le plan devient un livret d'épargne ordinaire : son taux et sa fiscalité changent.",
      effetPasse: "Le plan est devenu un livret d'épargne ordinaire : son taux et sa fiscalité ont changé." },
    { cle: "pel_12_ans", types: ["pel"], ancre: "date_ouverture", reperes: ["pel_exoneration_ir_ans"], fiche: null,
      titre: "{env} : {pel_exoneration_ir_ans}, fin de l'exonération d'impôt",
      effet: "Les intérêts acquis à partir de cette date sont soumis à l'impôt sur le revenu (ceux acquis pendant les {pel_exoneration_ir_ans} qui précèdent en sont exonérés ; les prélèvements sociaux restent dus).",
      effetPasse: "Les intérêts acquis depuis cette date sont soumis à l'impôt sur le revenu (ceux acquis pendant les {pel_exoneration_ir_ans} qui précédaient en étaient exonérés ; les prélèvements sociaux restent dus)." },
    { cle: "pee_disponible", types: ["pee"], ancre: "versements", reperes: ["pee_blocage_ans"], fiche: null,
      titre: "{env} : avoirs disponibles",
      effet: "{montant} deviennent disponibles sans motif.",
      effetPasse: "{montant} sont disponibles sans motif.",
      variantes: { au_plus_tot: {
        effet: "{montant} deviennent disponibles sans motif, au plus tôt à cette date : le règlement du plan peut en fixer une plus tardive, ton relevé l'indique.",
        effetPasse: "{montant} sont disponibles sans motif, au plus tôt depuis cette date : le règlement du plan peut en fixer une plus tardive, ton relevé l'indique." } } },
    { cle: "per_70_ans", types: ["per"], ancre: "naissance", reperes: ["per_age_fin_deduction"], fiche: "per",
      titre: "{env} : {per_age_fin_deduction}, fin de la déduction",
      effet: "À partir de cette date, {qui} ne peut plus déduire de son revenu imposable ses versements sur un PER.",
      effetPasse: "Depuis cette date, les versements sur un PER ne sont plus déductibles du revenu imposable." },
    { cle: "per_plafond_expire", types: [], ancre: "avis_impot", reperes: ["per_report_ans", "per_report_ans_ancien"], fiche: "per",
      titre: "Plafond épargne retraite {annee} : dernier jour pour l'utiliser",
      effet: "Dernier jour pour verser sur un PER en utilisant ce reste de plafond ({montant}) ; il ne peut plus servir ensuite.",
      effetPasse: "Ce reste de plafond ({montant}) ne pouvait plus servir après cette date." },
    { cle: "per_fin_annee", types: [], ancre: "annee", reperes: ["per_report_ans"], fiche: "per",
      titre: "Épargne retraite de l'année",
      effet: "Les versements déductibles comptent pour l'année où ils sont faits. Ton plafond disponible est sur ton avis d'impôt.",
      effetPasse: "Les versements déductibles comptent pour l'année où ils sont faits." },
    { cle: "av_abattement_annee", types: [], ancre: "annee", reperes: ["av_abattement_seul", "av_abattement_couple"], fiche: "assurance-vie",
      titre: "Abattement assurance-vie",
      effet: "L'abattement sur les gains retirés est annuel : celui de cette année ne se reporte pas sur la suivante.",
      effetPasse: "L'abattement sur les gains retirés est annuel : celui de l'année ne se reporte pas sur la suivante." },
    { cle: "donation_15_ans", types: [], ancre: "donations", reperes: ["donation_rappel_ans", "donation_abattement_enfant", "don_familial_argent"], fiche: null,
      titre: "Donation à {beneficiaire} : {donation_rappel_ans} révolus",
      effet: "La donation du {date} à {beneficiaire} n'est plus rappelée : l'abattement de {donation_abattement_enfant} entre ce parent et cet enfant est de nouveau entier.",
      effetPasse: "La donation du {date} à {beneficiaire} n'est plus rappelée : l'abattement de {donation_abattement_enfant} entre ce parent et cet enfant est de nouveau entier.",
      variantes: {
        reconstitue: { reperes: ["donation_rappel_ans", "donation_abattement_enfant"],
          effet: "La donation du {date} n'est plus rappelée : l'abattement se reconstitue de son montant ({montant}).",
          effetPasse: "La donation du {date} n'est plus rappelée : l'abattement se reconstitue de son montant ({montant})." },
        don_argent: { reperes: ["donation_rappel_ans", "don_familial_argent"],
          effet: "Le don familial de sommes d'argent ({don_familial_argent}) est de nouveau possible entre {donateur} et {beneficiaire}, si les conditions d'âge sont remplies.",
          effetPasse: "Le don familial de sommes d'argent ({don_familial_argent}) est de nouveau possible entre {donateur} et {beneficiaire}, si les conditions d'âge sont remplies." },
        autre: { reperes: ["donation_rappel_ans"],
          effet: "La donation du {date} à {beneficiaire} n'est plus rappelée lors d'une nouvelle donation à la même personne.",
          effetPasse: "La donation du {date} à {beneficiaire} n'est plus rappelée lors d'une nouvelle donation à la même personne." } } },
    { cle: "mv_expire", types: ["compte_titres"], ancre: "moins_values", reperes: ["mv_report_ans"], fiche: "compte-titres-fiscalite",
      titre: "{env} : moins-value {annee} à imputer avant cette date",
      effet: "Dernier jour pour imputer la moins-value de {annee} ({montant}) sur des plus-values de même nature ; elle est perdue ensuite.",
      effetPasse: "La moins-value de {annee} ({montant}) ne peut plus être imputée sur des plus-values de même nature." },
    { cle: "taux_reglementes", types: ["livret_a", "ldds", "lep"], ancre: "reperes", reperes: ["livret_a_taux", "lep_taux"], fiche: "livrets-reglementes",
      titre: "Taux des livrets réglementés",
      effet: "Fin de la période du taux actuel ({taux}) : un nouveau taux peut s'appliquer à partir de cette date.",
      effetPasse: "La période du taux indiqué ({taux}) est terminée : un nouveau taux s'applique." },
    { cle: "pret_fin", types: [], ancre: "prets_infos", reperes: [], fiche: null,
      titre: "{env} : dernière échéance",
      effet: "Dernière échéance du prêt : sa mensualité ({mensualite}) se libère ensuite.",
      effetPasse: "Dernière échéance du prêt passée : sa mensualité ({mensualite}) est libérée.",
      variantes: { sans_mensualite: { effet: "Dernière échéance du prêt.", effetPasse: "Dernière échéance du prêt passée." } } },
  ];
  const REGLE = Object.fromEntries(REGLES.map(r => [r.cle, r]));

  /** Où trouver chaque donnée (spec § 6.2). */
  const DOCUMENTS = {
    date_ouverture: {
      pea: "le relevé annuel du PEA, ou l'attestation d'ouverture", pea_pme: "le relevé annuel du PEA, ou l'attestation d'ouverture",
      pea_jeune: "le relevé annuel du PEA, ou l'attestation d'ouverture", assurance_vie: "les conditions particulières ou le relevé annuel d'information",
      capitalisation: "les conditions particulières ou le relevé annuel d'information", pel: "le contrat ou le relevé annuel du PEL",
    },
    naissance: "la date de naissance de la personne concernée (profil du foyer)",
    versements: "le relevé de l'épargne salariale : il indique la date de disponibilité de chaque avoir",
    avis_impot: "ton avis d'impôt (rubrique « plafond épargne retraite »)",
    date_fin: "l'offre de prêt ou le tableau d'amortissement",
  };

  /* ------------------------------------------------------------------ gabarits */
  function remplir(modele, ctx, reperes) {
    return String(modele).replace(/\{([a-z0-9_]+)\}/g, (tout, k) => {
      if (ctx && ctx[k] != null) return String(ctx[k]);
      const r = R.trouver(reperes, k);
      return r && isFinite(+r.valeur) ? R.format(r) : tout;
    });
  }

  /* ------------------------------------------------------------------ moteur */
  const objet = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const liste = v => (Array.isArray(v) ? v : []);
  const norm = s => sansAccent(String(s == null ? "" : s)).replace(/\s+/g, " ").trim();
  const nombre = v => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? +v : NaN);
  const PERSONNES = ["p1", "p2"];
  const SUFFIXE = /\|p[12]$/;

  /** Clé d'une enveloppe : son nom, ou « <nom>|p1 » / « <nom>|p2 » quand les deux titulaires ont une enveloppe de ce nom. Une clé
      déjà présente dans enveloppes_infos (infos) l'emporte. */
  function cleEnveloppe(nom, titulaire, positions, infos) {
    const n = norm(nom), inf = objet(infos);
    const direct = Object.keys(inf).find(k => norm(k) === norm(nom + "|" + titulaire));
    if (direct) return direct;
    const nu = Object.keys(inf).find(k => norm(k) === n && (!objet(inf[k]).titulaire || objet(inf[k]).titulaire === titulaire));
    if (nu) return nu;
    // une clé sans suffixe existe pour l'autre titulaire : celle-ci ne doit pas être écrasée
    if (PERSONNES.includes(titulaire) && Object.keys(inf).some(k => norm(k) === n && objet(inf[k]).titulaire && objet(inf[k]).titulaire !== titulaire)) return String(nom).trim() + "|" + titulaire;
    const proprietaires = new Set(liste(positions).filter(p => p && norm(p.envelope) === n).map(p => p.owner));
    return proprietaires.size > 1 && PERSONNES.includes(titulaire) ? String(nom).trim() + "|" + titulaire : String(nom).trim();
  }

  /** Enveloppes du calendrier : union des clés de enveloppes_infos et des enveloppes des lignes (spec § 4, étape 1). */
  function enveloppes(positions, infos, today) {
    const inf = objet(infos), out = [], prises = new Set();
    const lignes = liste(positions).filter(p => p && typeof p.envelope === "string" && p.envelope.trim());
    const groupes = new Map();
    lignes.forEach(p => {
      const k = norm(p.envelope) + "\u0001" + p.owner;
      if (!groupes.has(k)) groupes.set(k, { nom: p.envelope.trim(), owner: p.owner, lignes: [] });
      groupes.get(k).lignes.push(p);
    });
    const cles = Object.keys(inf).filter(k => inf[k] && typeof inf[k] === "object" && !Array.isArray(inf[k]));
    const creer = (cle, nom, owner, lg) => {
      const i = cles.includes(cle) ? objet(inf[cle]) : null;
      const declare = i && typeof i.type === "string" && TYPES[i.type] ? i.type : null;
      const type = declare || typeDeduit(nom);
      const titulaire = i && PERSONNES.includes(i.titulaire) ? i.titulaire : PERSONNES.includes(owner) ? owner : null;
      let cloture = null;
      if (i && estDate(i.date_cloture)) cloture = { date: i.date_cloture, confiance: "sure" };
      else if (lg.length && lg.every(p => p.status === "clôturé")) cloture = { date: today, confiance: "calculee" };
      out.push({ cle, nom, type, type_deduit: !declare, titulaire, infos: i, lignes: lg, cloture });
    };
    groupes.forEach(g => {
      const cle = cleEnveloppe(g.nom, g.owner, lignes, inf);
      const connue = cles.includes(cle);
      if (!connue && g.lignes.every(p => p.status === "clôturé")) return; // enveloppe sans information et sans ligne active : hors calendrier
      prises.add(cle);
      creer(cle, connue ? cle.replace(SUFFIXE, "") : g.nom, g.owner, g.lignes);
    });
    cles.forEach(k => { if (!prises.has(k)) creer(k, k.replace(SUFFIXE, ""), null, []); });
    return out.sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
  }

  function calendrier(data, today, options) {
    const d = objet(data), cfg = objet(d.config), profil = objet(d.profil), opt = objet(options);
    const vide = { jalons: [], a_completer: [], seuils: [], regles_indisponibles: [], prochains: [], dans_3_mois: [] };
    if (!estDate(today)) return vide;
    const reperes = liste(d.reperes);
    const horizon = opt.horizonAns > 0 ? +opt.horizonAns : HORIZON_DEFAUT;
    const finHorizon = ajouterAns(today, horizon);
    const personnes = objet(profil.personnes);
    const credits = liste(d.credits).length || !profil.credits ? liste(d.credits) : liste(profil.credits);
    const biens = liste(d.biens).length || !profil.biens ? liste(d.biens) : liste(profil.biens);
    const jalons = [], aCompleter = [], seuils = [], indispo = new Map();
    const dejaDemande = new Set();

    const rep = cle => { const r = R.trouver(reperes, cle); return r && isFinite(+r.valeur) ? r : null; };
    const val = cle => +rep(cle).valeur;
    /** Repères manquants parmi `cles` ; les consigne comme règle indisponible. */
    function manquants(regle, cles) {
      const m = cles.filter(c => !rep(c));
      if (m.length) {
        const prev = indispo.get(regle) || new Set();
        m.forEach(c => prev.add(c));
        indispo.set(regle, prev);
      }
      return m.length > 0;
    }
    const nomPersonne = p => (personnes[p] && typeof personnes[p].nom === "string" && personnes[p].nom.trim()) || null;

    function sourceDe(cles, secours) {
      const r = cles.map(rep).find(Boolean);
      if (r) return { titre: r.sourceTitre || null, url: r.sourceUrl || null, verifie_le: r.verifieLe || null, reperes: cles.filter(c => rep(c)) };
      return secours || { titre: null, url: null, verifie_le: null, reperes: [] };
    }
    const IGNORER_FIN = ["per_report_ans_ancien"]; // dispositif terminé mais toujours valable pour les années qu'il couvre
    function avertissementsDe(cles) {
      const out = [];
      cles.map(rep).filter(Boolean).forEach(r => {
        if (R.aVerifier(r, today)) out.push(r.libelle + " : chiffre vérifié le " + dateFr(r.verifieLe) + ", à revérifier.");
        if (r.dateFin && estDate(r.dateFin) && r.dateFin < today && !IGNORER_FIN.includes(r.cle)) out.push(r.libelle + " : dispositif terminé le " + dateFr(r.dateFin) + ".");
      });
      return out;
    }

    /** Ajoute un jalon (sauf après la clôture de l'enveloppe ou au-delà de l'horizon). */
    function jalon(o) {
      const regle = REGLE[o.cle], v = o.variante && regle.variantes && regle.variantes[o.variante];
      const cles = o.reperes || (v && v.reperes) || regle.reperes;
      if (o.inst && o.inst.cloture && !o.ignorerCloture && o.date > o.inst.cloture.date) return;
      if (o.date > finHorizon) return;
      const jours = joursEntre(today, o.date), statut = statutDe(jours);
      const ctx = Object.assign({ env: o.nom || "", pel_prolongation: "", qui: nomPersonne(o.titulaire) || "le titulaire" }, o.ctx || {});
      if (o.cle === "pel_10_ans" && !o.variante) ctx.pel_prolongation = R.format({ valeur: val("pel_duree_vie_ans") - val("pel_duree_max_ans"), unite: "ans" });
      const modele = (v && v.effet) || regle.effet, modelePasse = (v && v.effetPasse) || regle.effetPasse;
      jalons.push({
        id: o.cle + ":" + o.enveloppe + ":" + o.date, date: o.date, enveloppe: o.enveloppe, enveloppe_nom: o.nom || null,
        titulaire: o.titulaire || null, type: o.type, cle: o.cle, titre: remplir(regle.titre, ctx, reperes),
        effet: remplir(statut === "passe" ? modelePasse : modele, ctx, reperes), calcul: o.calcul || "", statut, jours, delai: texteDelai(jours),
        source: o.source || sourceDe(cles), confiance: o.confiance, donnee: o.donnee || null, avertissements: avertissementsDe(cles),
      });
    }
    function aCompl(inst, regleCle, champ, titre, pourquoi, document, idUnique) {
      const id = idUnique || champ + ":" + inst.cle;
      if (dejaDemande.has(id)) return;
      dejaDemande.add(id);
      aCompleter.push({ id, enveloppe: inst.cle, enveloppe_nom: inst.nom || null, titulaire: inst.titulaire || null, type: inst.type, cle: regleCle, champ, titre, pourquoi, document });
    }
    const donneeDe = (inst, champ) => ({ champ, source: inst.infos && inst.infos.source != null ? String(inst.infos.source) : null, le: inst.infos && inst.infos.le != null ? String(inst.infos.le) : null });

    /** Ancre « date d'ouverture » : exacte, ou approchée (au plus tard). */
    function ancreOuverture(inst) {
      const i = inst.infos;
      if (!i) return null;
      if (estDate(i.date_ouverture)) return { date: i.date_ouverture, min: i.date_ouverture, max: i.date_ouverture, confiance: "sure", champ: "date_ouverture" };
      const a = approx(i.date_ouverture_approx);
      return a ? { date: a.max, min: a.min, max: a.max, confiance: "approchee", champ: "date_ouverture_approx", approx: i.date_ouverture_approx } : null;
    }
    /** Ancre « naissance » du titulaire : jour exact, ou mois (1er du mois : la limite d'âge n'est jamais crue plus lointaine). */
    function ancreNaissance(inst) {
      const n = inst.titulaire && personnes[inst.titulaire] ? personnes[inst.titulaire].naissance : null;
      const champ = { champ: "naissance", source: "date de naissance du profil", le: null };
      if (estDate(n)) return { date: n, confiance: "sure", donnee: champ };
      const a = approx(n);
      return a && typeof n === "string" && n.length === 7 ? { date: a.min, confiance: "approchee", donnee: champ, mois: n } : null;
    }
    function calculDuree(libelle, a, nTxt, expire, final) {
      const debut = a.approx ? libelle + " connu à " + (a.approx.length === 4 ? "l'année" : "au mois") + " près : au plus tard le " + dateFr(a.date) : libelle + " le " + dateFr(a.date);
      return debut + " + " + nTxt + " → " + dateFr(expire) + (final !== expire ? ", révolus le " + dateFr(final) : "");
    }

    const ens = enveloppes(d.positions, cfg.enveloppes_infos, today);
    const ouverts = ens.filter(e => !e.cloture);
    const PEA = ["pea", "pea_pme", "pea_jeune"], AV = ["assurance_vie", "capitalisation"];

    /* ---- règles des enveloppes ---- */
    ens.forEach(inst => {
      const t = inst.type, ouvert = !inst.cloture;
      if (!t) return;
      const base = { inst, enveloppe: inst.cle, nom: inst.nom, titulaire: inst.titulaire, type: t };
      /* durée à partir de la date d'ouverture */
      const duree = (cleRegle, repereDuree, o) => {
        const requis = o.requis || REGLE[cleRegle].reperes;
        if (manquants(cleRegle, requis)) return false;
        const a = ancreOuverture(inst);
        if (!a) return "manque";
        const n = val(repereDuree), expire = ajouterAns(a.date, n), final = o.jourMeme ? expire : lendemain(expire);
        jalon(Object.assign({}, base, { cle: cleRegle, date: final, confiance: a.confiance, reperes: requis, variante: o.variante,
          donnee: donneeDe(inst, a.champ), calcul: calculDuree(o.ancre, a, R.format(rep(repereDuree)), expire, final) }));
        return true;
      };
      const demanderOuverture = (regleCle, pourquoi) => aCompl(inst, regleCle, "date_ouverture", "Date d'ouverture de « " + inst.nom + " »", pourquoi, DOCUMENTS.date_ouverture[t]);

      if (PEA.includes(t)) {
        const r = duree("pea_5_ans", "pea_duree_ans", { ancre: "premier versement" });
        if (r === "manque" && ouvert) demanderOuverture("pea_5_ans", "Elle fait courir le délai de " + R.format(rep("pea_duree_ans")) + " du PEA, après lequel un retrait ne clôture plus le plan.");
      }
      if (AV.includes(t)) {
        const r = duree("av_8_ans", "av_duree_ans", { ancre: "premier versement" });
        if (r === "manque" && ouvert) demanderOuverture("av_8_ans", "Elle fait courir les " + R.format(rep("av_duree_ans")) + " après lesquels les gains retirés bénéficient de l'abattement annuel.");
      }
      if (t === "assurance_vie" && !manquants("av_70_ans", REGLE.av_70_ans.reperes) && inst.titulaire) {
        const n = ancreNaissance(inst);
        if (!n) {
          if (ouvert) aCompl(inst, "av_70_ans", "naissance", "Date de naissance " + (nomPersonne(inst.titulaire) ? "de " + nomPersonne(inst.titulaire) : "de l'assuré"),
            "Elle fixe le " + R.format(rep("av_age_seuil")).replace(" ans", "ᵉ anniversaire") + " de l'assuré, qui change l'abattement applicable aux versements à son décès.", DOCUMENTS.naissance, "naissance:" + inst.titulaire);
        } else {
          const age = val("av_age_seuil"), date = ajouterAns(n.date, age);
          jalon(Object.assign({}, base, { cle: "av_70_ans", date, confiance: n.confiance, donnee: n.donnee,
            calcul: (n.mois ? "naissance en " + n.mois.slice(5) + "/" + n.mois.slice(0, 4) + " (1er du mois, la date la plus précoce)" : "naissance le " + dateFr(n.date)) + " + " + R.format(rep("av_age_seuil")) + " → " + dateFr(date) }));
        }
      }
      if (t === "per" && !manquants("per_70_ans", REGLE.per_70_ans.reperes) && inst.titulaire) {
        const n = ancreNaissance(inst);
        if (!n) {
          if (ouvert) aCompl(inst, "per_70_ans", "naissance", "Date de naissance " + (nomPersonne(inst.titulaire) ? "de " + nomPersonne(inst.titulaire) : "du titulaire"),
            "Elle fixe le " + R.format(rep("per_age_fin_deduction")).replace(" ans", "ᵉ anniversaire") + ", à partir duquel les versements ne sont plus déductibles.", DOCUMENTS.naissance, "naissance:" + inst.titulaire);
        } else {
          const age = val("per_age_fin_deduction"), date = ajouterAns(n.date, age);
          jalon(Object.assign({}, base, { cle: "per_70_ans", date, confiance: n.confiance, donnee: n.donnee,
            calcul: (n.mois ? "naissance en " + n.mois.slice(5) + "/" + n.mois.slice(0, 4) + " (1er du mois, la date la plus précoce)" : "naissance le " + dateFr(n.date)) + " + " + R.format(rep("per_age_fin_deduction")) + " → " + dateFr(date) }));
        }
      }
      if (t === "pel") {
        const a = ancreOuverture(inst);
        if (!a) {
          if (ouvert) {
            const ok = !["pel_2_ans", "pel_4_ans", "pel_10_ans", "pel_15_ans", "pel_12_ans"].every(c => manquants(c, REGLE[c].reperes));
            if (ok) demanderOuverture("pel_2_ans", "Elle fixe les étapes du plan : retrait sans pénalité, durée minimale, fin des versements et, pour un plan d'avant 2018, fin de l'exonération d'impôt.");
          }
        } else {
          const depuis2011 = a.min >= "2011-03-01", avant2011 = a.max < "2011-03-01", depuis1992 = a.min >= "1992-04-01";
          const plan = (c, rd, o) => duree(c, rd, Object.assign({ ancre: "versement initial" }, o));
          const cheval = (borne) => a.min < borne && a.max >= borne;
          if (ouvert && a.confiance === "approchee" && (cheval("2011-03-01") || cheval("1992-04-01")))
            demanderOuverture("pel_10_ans", "Elle n'est connue qu'à l'année près et la génération du plan en dépend : durée maximale, fin du plan et exonération d'impôt ne sont pas les mêmes selon la date d'ouverture exacte.");
          plan("pel_2_ans", "pel_retrait_min_ans", {});
          if (depuis1992) plan("pel_4_ans", "pel_duree_min_ans", {});
          if (depuis2011) plan("pel_10_ans", "pel_duree_max_ans", {});
          else if (avant2011) plan("pel_10_ans", "pel_duree_max_ans", { variante: "avant_2011", requis: REGLE.pel_10_ans.variantes.avant_2011.reperes });
          if (depuis2011) plan("pel_15_ans", "pel_duree_vie_ans", {});
          if (depuis1992 && a.max <= "2017-12-31") plan("pel_12_ans", "pel_exoneration_ir_ans", { jourMeme: true });
        }
      }
      if (t === "pee") {
        const vs = liste(inst.infos && inst.infos.versements).filter(v => v && typeof v === "object" && estDate(v.le) && nombre(v.montant) > 0);
        if (!vs.length) {
          if (ouvert && !manquants("pee_disponible", REGLE.pee_disponible.reperes))
            aCompl(inst, "pee_disponible", "versements", "Versements de « " + inst.nom + " »",
              "Chaque versement devient disponible sans motif au bout de " + R.format(rep("pee_blocage_ans")) + " ; le relevé indique la date exacte.", DOCUMENTS.versements);
        } else if (!manquants("pee_disponible", REGLE.pee_disponible.reperes)) {
          const groupes = new Map();
          vs.forEach(v => {
            const sure = estDate(v.disponible_le), date = sure ? v.disponible_le : lendemain(ajouterAns(v.le, val("pee_blocage_ans")));
            const k = date + "|" + (sure ? "sure" : "approchee");
            if (!groupes.has(k)) groupes.set(k, { date, sure, montant: 0, les: [] });
            const g = groupes.get(k);
            g.montant += +v.montant;
            g.les.push(v.le);
          });
          groupes.forEach(g => jalon(Object.assign({}, base, { cle: "pee_disponible", date: g.date, confiance: g.sure ? "sure" : "approchee",
            variante: g.sure ? null : "au_plus_tot", ctx: { montant: eur(g.montant) }, donnee: donneeDe(inst, g.sure ? "versements.disponible_le" : "versements"),
            calcul: g.sure ? "date de disponibilité du relevé : " + dateFr(g.date)
              : "versement" + (g.les.length > 1 ? "s" : "") + " du " + g.les.map(dateFr).join(", ") + " + " + R.format(rep("pee_blocage_ans")) + " → au plus tôt le " + dateFr(g.date) })));
        }
      }
      if (t === "compte_titres" && inst.infos && !manquants("mv_expire", REGLE.mv_expire.reperes)) {
        const parDate = new Map();
        liste(inst.infos.moins_values).filter(m => m && typeof m === "object" && Number.isInteger(+m.annee) && nombre(m.montant) > 0).forEach(m => {
          const date = (+m.annee + val("mv_report_ans")) + "-12-31", g = parDate.get(date) || { annee: +m.annee, montant: 0 };
          g.montant += +m.montant;
          parDate.set(date, g);
        });
        parDate.forEach((g, date) => jalon(Object.assign({}, base, { cle: "mv_expire", date, confiance: "sure", ignorerCloture: true, ctx: { annee: g.annee, montant: eur(g.montant) },
          donnee: donneeDe(inst, "moins_values"), calcul: "moins-value de " + g.annee + " + " + R.format(rep("mv_report_ans")) + " → dernier jour le " + dateFr(date) })));
      }
    });

    /* ---- règles du foyer ---- */
    const annee0 = annee(today), finAnnee = annee0 + "-12-31";
    // abattement annuel de l'assurance-vie : un seul jalon dès qu'un contrat ouvert a passé ses 8 ans
    const avPasse = ouverts.some(inst => AV.includes(inst.type) && !manquants("av_8_ans", REGLE.av_8_ans.reperes) && (a => a && lendemain(ajouterAns(a.date, val("av_duree_ans"))) < today)(ancreOuverture(inst)));
    if (avPasse && !manquants("av_abattement_annee", REGLE.av_abattement_annee.reperes))
      jalon({ cle: "av_abattement_annee", enveloppe: "foyer", nom: "Foyer", titulaire: null, type: "foyer", date: finAnnee, confiance: "sure", donnee: null,
        calcul: "dernier jour de l'année " + annee0 });
    // épargne retraite : plafond de l'avis d'impôt, ou 31 décembre quand il manque
    const avis = objet(cfg.avis_impot), avisPresent = Number.isInteger(avis.annee_revenus);
    if (ouverts.some(inst => inst.type === "per") && !avisPresent && !manquants("per_fin_annee", REGLE.per_fin_annee.reperes)) {
      jalon({ cle: "per_fin_annee", enveloppe: "foyer", nom: "Foyer", titulaire: null, type: "foyer", date: finAnnee, confiance: "sure", donnee: null,
        calcul: "dernier jour de l'année " + annee0 });
      const id = "avis_impot:foyer";
      if (!dejaDemande.has(id)) {
        dejaDemande.add(id);
        aCompleter.push({ id, enveloppe: "foyer", enveloppe_nom: "Foyer", titulaire: null, type: "foyer", cle: "per_fin_annee", champ: "avis_impot", titre: "Avis d'impôt (plafond épargne retraite)",
          pourquoi: "Il donne ton plafond de versement sur un PER et la date où chaque part non utilisée s'éteint.", document: DOCUMENTS.avis_impot });
      }
    }
    if (avisPresent) {
      const pl = objet(avis.plafonds_per);
      const parts = PERSONNES.some(p => liste(pl[p]).some(l => l && Number.isInteger(+l.annee) && nombre(l.montant) > 0));
      PERSONNES.forEach(p => parts && !manquants("per_plafond_expire", ["per_report_ans"]) && liste(pl[p]).forEach(l => {
        if (!l || !Number.isInteger(+l.annee) || !(nombre(l.montant) > 0)) return;
        const nouveau = +l.annee >= annee(rep("per_report_ans").dateEffet);
        const cle = nouveau ? "per_report_ans" : "per_report_ans_ancien";
        if (manquants("per_plafond_expire", [cle])) return;
        const date = (+l.annee + val(cle)) + "-12-31";
        if (date < today) return; // part déjà éteinte : plus rien à faire
        jalon({ cle: "per_plafond_expire", enveloppe: "foyer|" + p, nom: nomPersonne(p) || p, titulaire: p, type: "foyer", date, confiance: "sure", reperes: [cle],
          ctx: { annee: +l.annee, montant: eur(l.montant) }, variante: null,
          donnee: { champ: "avis_impot.plafonds_per." + p, source: avis.source != null ? String(avis.source) : null, le: avis.le != null ? String(avis.le) : null },
          calcul: "plafond " + l.annee + " + " + R.format(rep(cle)) + " de report → dernier jour le " + dateFr(date) });
      }));
    }
    // donations consenties : rappel fiscal à 15 ans
    liste(cfg.donations).forEach(dn => {
      if (!dn || typeof dn !== "object" || !estDate(dn.date) || dn.nature === "don_logement_790a_bis" || typeof dn.id !== "string" || !dn.id) return;
      let variante = dn.nature === "don_argent_790g" ? "don_argent" : dn.lien === "enfant" ? null : "autre";
      const v = variante && REGLE.donation_15_ans.variantes[variante];
      const requis = v ? v.reperes : REGLE.donation_15_ans.reperes.slice(0, 2);
      if (manquants("donation_15_ans", requis)) return;
      const expire = ajouterAns(dn.date, val("donation_rappel_ans")), date = lendemain(expire);
      // une autre donation des mêmes donateur et bénéficiaire encore dans le rappel à cette date : l'abattement ne redevient pas « entier »
      const garde = o => o && o !== dn && typeof o === "object" && estDate(o.date) && o.date <= date && ajouterAns(o.date, val("donation_rappel_ans")) >= date
        && o.nature !== "don_argent_790g" && o.nature !== "don_logement_790a_bis" && o.donateur === dn.donateur && norm(o.beneficiaire) === norm(dn.beneficiaire);
      const montant = nombre(dn.montant);
      if (!variante && montant > 0 && typeof dn.donateur === "string" && norm(dn.beneficiaire) && liste(cfg.donations).some(garde)) variante = "reconstitue";
      jalon({ cle: "donation_15_ans", enveloppe: "donation:" + dn.id, nom: dn.beneficiaire || "le bénéficiaire", titulaire: PERSONNES.includes(dn.donateur) ? dn.donateur : null, type: "donation",
        date, confiance: "sure", reperes: requis, variante, ctx: { beneficiaire: dn.beneficiaire || "le bénéficiaire", date: dateFr(dn.date), donateur: nomPersonne(dn.donateur) || "le donateur",
          montant: eur(variante === "reconstitue" ? Math.min(montant, val("donation_abattement_enfant")) : montant || 0) },
        donnee: { champ: "donations", source: dn.source != null ? String(dn.source) : null, le: dn.le != null ? String(dn.le) : null },
        calcul: "donation du " + dateFr(dn.date) + " + " + R.format(rep("donation_rappel_ans")) + " → " + dateFr(expire) + ", rappel écarté dès le " + dateFr(date) });
    });
    // révision des livrets réglementés : lendemain de la fin de période du repère du taux
    const lignesLivret = ens.filter(e => !e.cloture && !e.type);
    const detenus = new Set(ouverts.map(e => e.type).filter(t => LIVRETS.includes(t)));
    lignesLivret.forEach(e => e.lignes.forEach(p => { const t = typeDeduit(p.name); if (LIVRETS.includes(t)) detenus.add(t); }));
    if (detenus.size) {
      const lot = [];
      if (detenus.has("livret_a") || detenus.has("ldds")) lot.push({ cle: "livret_a_taux", noms: ["livret_a", "ldds"].filter(x => detenus.has(x)).map(x => (x === "livret_a" ? "Livret A" : "LDDS")).join(" et ") });
      if (detenus.has("lep")) lot.push({ cle: "lep_taux", noms: "LEP" });
      const manque = lot.filter(l => manquants("taux_reglementes", [l.cle]));
      const parFin = new Map();
      lot.filter(l => !manque.includes(l)).forEach(l => {
        const r = rep(l.cle);
        if (!r.dateFin || !estDate(r.dateFin)) return;
        const date = lendemain(r.dateFin), g = parFin.get(date) || { date, lots: [] };
        g.lots.push(l);
        parFin.set(date, g);
      });
      parFin.forEach(g => jalon({ cle: "taux_reglementes", enveloppe: "foyer", nom: "Foyer", titulaire: null, type: "foyer", date: g.date, confiance: "sure", reperes: g.lots.map(l => l.cle),
        ctx: { taux: g.lots.map(l => l.noms + " : " + R.format(rep(l.cle))).join(" ; ") },
        source: sourceDe(g.lots.map(l => l.cle)), donnee: null,
        calcul: "fin de la période du taux (" + dateFr(rep(g.lots[0].cle).dateFin) + ") → révision possible dès le " + dateFr(g.date) }));
    }
    // prêts : dernière échéance
    const prets = objet(cfg.prets_infos);
    [["credit", credits], ["bien", biens]].forEach(([genre, elems]) => elems.forEach(el => {
      if (!el || typeof el !== "object" || typeof el.id !== "string" || !el.id) return;
      const cle = genre + ":" + el.id, i = prets[cle] && typeof prets[cle] === "object" ? prets[cle] : null;
      const nom = el.nom || (genre === "credit" ? "Crédit" : "Bien"), titulaire = PERSONNES.includes(el.owner) ? el.owner : null;
      let date = null, confiance = null, champ = null, calcul = "";
      if (i && estDate(i.date_fin)) { date = i.date_fin; confiance = "sure"; champ = "date_fin"; calcul = "date de fin du prêt : " + dateFr(date); }
      else if (i && estDate(i.date_signature) && Number.isInteger(+i.duree_mois) && +i.duree_mois > 0) {
        date = ajouterMois(i.date_signature, +i.duree_mois); confiance = "calculee"; champ = "date_signature+duree_mois";
        calcul = "signature le " + dateFr(i.date_signature) + " + " + i.duree_mois + " mois → " + dateFr(date);
      }
      if (date) {
        const mens = nombre(el.mensualite);
        jalon({ cle: "pret_fin", enveloppe: cle, nom, titulaire, type: genre, date, confiance, variante: mens > 0 ? null : "sans_mensualite", ctx: { mensualite: eur(mens) },
          source: { titre: i.source != null ? String(i.source) : "Offre de prêt", url: null, verifie_le: null, reperes: [] },
          donnee: { champ, source: i.source != null ? String(i.source) : null, le: i.le != null ? String(i.le) : null }, calcul });
      } else if (nombre(el.crd) > 0) {
        const id = "date_fin:" + cle;
        if (!dejaDemande.has(id)) {
          dejaDemande.add(id);
          aCompleter.push({ id, enveloppe: cle, enveloppe_nom: nom, titulaire, type: genre, cle: "pret_fin", champ: "date_fin", titre: "Date de fin du prêt « " + nom + " »",
            pourquoi: "Elle dit quand la mensualité se libère.", document: DOCUMENTS.date_fin });
        }
      }
    }));

    /* ---- seuils ---- */
    const vc = inst => (inst.infos && nombre(inst.infos.versements_cumules) >= 0 ? +inst.infos.versements_cumules : null);
    const seuil = (inst, cle, titre, verse, plafond, reste, cles) => seuils.push({ id: cle + ":" + inst.cle, enveloppe: inst.cle, enveloppe_nom: inst.nom, cle, titre, verse, plafond,
      reste: Math.max(0, reste), source: sourceDe(cles), donnee: donneeDe(inst, "versements_cumules") });
    ouverts.filter(e => PEA.includes(e.type) && vc(e) != null).forEach(inst => {
      const cles = inst.type === "pea" ? ["pea_plafond"] : inst.type === "pea_jeune" ? ["pea_jeune_plafond"] : ["pea_pme_plafond_global"];
      if (manquants("pea_plafond", cles)) return;
      const memeTitulaire = e => e.titulaire === inst.titulaire && inst.titulaire != null;
      if (inst.type === "pea_pme") {
        const peas = ouverts.filter(e => e.type === "pea" && memeTitulaire(e));
        if (peas.some(e => vc(e) == null)) return; // total du titulaire inconnu : pas de plafond global fiable
        const verse = vc(inst) + peas.reduce((s, e) => s + vc(e), 0);
        seuil(inst, "pea_plafond", "Plafond cumulé du PEA et du PEA PME-ETI", verse, val(cles[0]), val(cles[0]) - verse, cles);
      } else if (inst.type === "pea") {
        let reste = val(cles[0]) - vc(inst);
        const pmes = ouverts.filter(e => e.type === "pea_pme" && memeTitulaire(e));
        if (pmes.length && pmes.every(e => vc(e) != null) && rep("pea_pme_plafond_global")) reste = Math.min(reste, val("pea_pme_plafond_global") - vc(inst) - pmes.reduce((s, e) => s + vc(e), 0));
        seuil(inst, "pea_plafond", "Plafond de versements du PEA", vc(inst), val(cles[0]), reste, cles.concat(pmes.length ? ["pea_pme_plafond_global"] : []));
      } else seuil(inst, "pea_plafond", "Plafond de versements du PEA d'un majeur rattaché", vc(inst), val(cles[0]), val(cles[0]) - vc(inst), cles);
    });
    ouverts.filter(e => AV.includes(e.type) && e.titulaire && vc(e) != null).forEach(inst => {
      if (manquants("av_seuil_versements", ["av_seuil_versements"])) return;
      const freres = ouverts.filter(e => AV.includes(e.type) && e.titulaire === inst.titulaire);
      if (freres.some(e => vc(e) == null)) return;
      const verse = freres.reduce((s, e) => s + vc(e), 0);
      seuil(inst, "av_seuil_versements", "Seuil de versements du taux réduit (à titre indicatif)", verse, val("av_seuil_versements"), val("av_seuil_versements") - verse, ["av_seuil_versements"]);
    });

    /* ---- sortie ---- */
    const ordre = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    jalons.sort((a, b) => ordre(a.date, b.date) || ordre(a.cle, b.cle) || ordre(a.enveloppe, b.enveloppe));
    aCompleter.sort((a, b) => ordre(a.enveloppe, b.enveloppe) || ordre(a.champ, b.champ));
    seuils.sort((a, b) => ordre(a.enveloppe, b.enveloppe) || ordre(a.cle, b.cle));
    const regles_indisponibles = [...indispo.entries()].map(([cle, m]) => ({ cle, reperes_manquants: [...m].sort() })).sort((a, b) => ordre(a.cle, b.cle));
    return {
      jalons, a_completer: aCompleter, seuils, regles_indisponibles,
      prochains: jalons.filter(j => j.statut !== "passe").slice(0, 3), dans_3_mois: jalons.filter(j => j.statut === "proche"),
    };
  }

  /** Entrée du moteur depuis l'état S du store (S.positions, S.config, S.profil, S.savoir.reperes) : crédits et biens sont ceux du profil. */
  function depuisEtat(S) {
    const s = objet(S), pr = objet(s.profil);
    return { positions: liste(s.positions), config: objet(s.config), profil: pr, credits: liste(pr.credits), biens: liste(pr.biens), reperes: liste(objet(s.savoir).reperes) };
  }

  return { depuisEtat, calendrier, REGLES, TYPES, typeDeduit, cleEnveloppe, ajouterAns, ajouterMois, lendemain, joursEntre, estDate, texteDelai, dateFr, PROCHE_JOURS, DOCUMENTS };
});
});

/* ---------- web/src/calc.js ---------- */
def("calc", function (module, exports, require) {
/* Calculs patrimoniaux purs, partagés par tous les onglets. Aucun accès au DOM. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  const n = v => (isFinite(+v) ? +v : 0);
  const pos = v => Math.max(0, n(v));

  /* ---------- positions du Pilotage ---------- */
  function val(p) {
    if (p.mode === "market" && p.qty != null && p.price != null) return p.qty * p.price;
    return n(p.value);
  }
  const counted = p => p.status !== "à recevoir" && p.status !== "clôturé";
  const inScope = (p, scope) => scope === "foyer" || p.owner === scope;
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

  function financier(positions, scope) {
    return sum((positions || []).filter(p => inScope(p, scope) && counted(p)), val);
  }
  function poche(positions, scope, bloc) {
    return sum((positions || []).filter(p => inScope(p, scope) && counted(p) && p.bloc === bloc), val);
  }
  function aRecevoir(positions, scope) {
    return sum((positions || []).filter(p => inScope(p, scope) && p.status === "à recevoir"), val);
  }

  /* ---------- classes d'actifs et liquidité ---------- */
  const sansAccent = s => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  /* Poche (libellé libre) → classe d'actifs. Table par défaut, surchargeable par l'utilisateur. */
  const CLASSES = {
    monde: "actions", europe: "actions", asie: "actions", "nasdaq 2x": "actions", nasdaq: "actions", "convictions tech": "actions", convictions: "actions",
    actions: "actions", "etats-unis": "actions", usa: "actions", emergents: "actions", "small caps": "actions",
    obligations: "obligations", oblig: "obligations",
    scpi: "immobilier", immobilier: "immobilier", sci: "immobilier", opci: "immobilier",
    epargne: "monetaire", livrets: "monetaire", monetaire: "monetaire", cash: "monetaire", liquidites: "monetaire",
    "comptes courants": "monetaire", "compte courant": "monetaire",
    protection: "fonds_euros", "fonds euros": "fonds_euros", "fonds euro": "fonds_euros",
    or: "or", "metaux precieux": "or", crypto: "crypto", cryptos: "crypto",
  };
  const CLASSES_LABELS = { actions: "Actions", obligations: "Obligations", immobilier: "Immobilier", monetaire: "Monétaire et livrets", fonds_euros: "Fonds euros", or: "Or", crypto: "Crypto", autres: "Autres" };
  function classe(bloc, surcharge) {
    if (surcharge && bloc in surcharge) return surcharge[bloc];
    return CLASSES[sansAccent(bloc)] || "autres";
  }
  /* Enveloppe → délai pour récupérer l'argent : immediate, jours (titres cotés), semaines (assurance-vie), bloque (PER, immobilier).
     « compte » non suivi de « titres » (un compte-titres se vend en quelques jours) ; « PERin » bloqué. Même règle que liquidite() du connecteur. */
  const LIQUIDITE_LABELS = { immediate: "Disponible tout de suite", jours: "Sous quelques jours", semaines: "Sous quelques semaines", bloque: "Bloqué ou peu liquide" };
  function liquidite(envelope) {
    const e = sansAccent(envelope);
    if (/\bper\b|\bperin\b|perco|pee|retraite|scpi|immobilier/.test(e)) return "bloque";
    if (/livret|ldds|lep|\bcomptes?\b(?![- ]?titres?)|cash|especes|courant/.test(e)) return "immediate";
    if (/\bav\b|assurance|vie|capitalisation/.test(e)) return "semaines";
    return "jours";
  }
  function grouper(positions, scope, cle) {
    const out = {};
    (positions || []).filter(p => inScope(p, scope) && counted(p)).forEach(p => { const k = cle(p); out[k] = (out[k] || 0) + val(p); });
    return out;
  }

  /* ---------- familles de comptes (spec 2026-10-12-cp1, § 1) ---------- */
  /* Chaque ligne appartient à une famille, déduite de son enveloppe et de son bloc :
     - courant : bloc ou enveloppe « Compte(s) courant(s) » (bloc créé par la synchronisation bancaire) ou « Compte joint » ;
     - investissement : enveloppe PEA, PEA-PME, compte-titres (CTO), assurance-vie (AV), capitalisation, PER (PERin, PERP, PERCO,
       PERCOL, PERECO), Madelin, PEE / épargne salariale, « Plan d'épargne en actions / retraite / entreprise / avenir » en toutes
       lettres, crypto (Binance), SCPI / OPCI / SCI — l'enveloppe d'investissement prime sur la poche (un fonds
       monétaire dans un compte-titres reste de l'investissement) ;
     - epargne : enveloppe livret (Livret A, LDDS, LEP, CEL, PEL, CSL), compte à terme, compte épargne, monétaire, cash, espèces ;
     - repli (enveloppe muette, ex. « Banque ») : la classe de la poche (Calc.classe, surcharge comprise) ; monétaire → epargne,
       tout le reste → investissement.
     Les dettes ne sont pas des lignes : elles viennent des biens (capital restant dû) et des crédits du profil (Calc.dettes).
     Même fonction dans le connecteur (supabase/functions/mcp/index.ts, famille), parité testée sur une liste de libellés. */
  const FAMILLES_LABELS = { courant: "Comptes courants", epargne: "Épargne disponible", investissement: "Investissement", dettes: "Dettes" };
  const RE_COURANT = /\bcomptes? courants?\b|\bcomptes? joints?\b/;
  const RE_INVEST = /\bpea\b|\bcto\b|\bcomptes?[- ]?titres?\b|assurance.?vie|\bav\b|capitalisation|\bper\b|\bperin\b|\bperp\b|\bperco\b|\bpercol\b|\bpereco\b|\bpee\b|\bmadelin\b|plans? (d.)?epargne (en actions|(pour la )?retraite|(d.)?entreprise|avenir)|epargne salariale|crypto|binance|\bscpi\b|\bopci\b|\bsci\b/;
  const RE_EPARGNE = /livret|\bldds\b|\blep\b|\bcel\b|\bpel\b|\bcsl\b|compte a terme|epargne|monetaire|\bcash\b|especes/;
  function famille(position, surcharge) {
    const p = position || {}, env = sansAccent(p.envelope), bloc = sansAccent(p.bloc);
    if (RE_COURANT.test(bloc) || RE_COURANT.test(env)) return "courant";
    if (RE_INVEST.test(env)) return "investissement";
    if (RE_EPARGNE.test(env)) return "epargne";
    return classe(p.bloc, surcharge) === "monetaire" ? "epargne" : "investissement";
  }
  const estCourant = p => famille(p) === "courant";
  /** Lignes hors comptes courants : base de l'allocation, du risque et de la diversification (le patrimoine net garde tout). */
  const horsCourants = positions => (positions || []).filter(p => p && !estCourant(p));

  const parClasse = (positions, scope, surcharge) => grouper(horsCourants(positions), scope, p => classe(p.bloc, surcharge));
  const parLiquidite = (positions, scope) => grouper(positions, scope, p => liquidite(p.envelope));

  /* ---------- profil ---------- */
  /* Quote-part d'un bien : part_p1 (0-100) appartient à la personne 1, le complément à la personne 2. */
  function part(scope, partP1) {
    const s = Math.min(100, Math.max(0, partP1 == null ? 50 : n(partP1))) / 100;
    return scope === "foyer" ? 1 : scope === "p1" ? s : 1 - s;
  }
  function partCredit(scope, owner) {
    if (scope === "foyer") return 1;
    if (owner === "commun") return 0.5;
    return owner === scope ? 1 : 0;
  }
  const biens = pr => (pr && Array.isArray(pr.biens) ? pr.biens : []);
  const credits = pr => (pr && Array.isArray(pr.credits) ? pr.credits : []);
  const scopePeople = scope => (scope === "foyer" ? ["p1", "p2"] : [scope]);

  function immobilier(profil, scope) {
    return sum(biens(profil), b => pos(b.valeur) * part(scope, b.part_p1));
  }
  function dettes(profil, scope) {
    return sum(biens(profil), b => pos(b.crd) * part(scope, b.part_p1)) +
      sum(credits(profil), c => pos(c.crd) * partCredit(scope, c.owner));
  }
  /** Crédits en cours du foyer (avant partage par personne), UNE définition pour Patrimoine › Immobilier et crédits, Compte › Données et la
      protection du bilan : les prêts rattachés aux biens (reste dû ou mensualité positifs), puis chaque crédit déclaré (auto, consommation,
      travaux). → [{ kind: "pret" | "credit", nom, crd, mensualite }]. Leur somme est Calc.dettes / Calc.mensualites du foyer. */
  function creditsEnCours(profil) {
    const out = [];
    biens(profil).forEach(b => { if (b && (pos(b.crd) > 0 || pos(b.mensualite) > 0)) out.push({ kind: "pret", nom: String(b.nom || "").trim() || "Bien", crd: pos(b.crd), mensualite: pos(b.mensualite) }); });
    credits(profil).forEach(c => { if (c) out.push({ kind: "credit", nom: String(c.nom || "").trim() || "Crédit", crd: pos(c.crd), mensualite: pos(c.mensualite) }); });
    return out;
  }
  function mensualites(profil, scope) {
    return sum(biens(profil), b => pos(b.mensualite) * part(scope, b.part_p1)) +
      sum(credits(profil), c => pos(c.mensualite) * partCredit(scope, c.owner));
  }
  function autresActifs(profil, scope) {
    const a = (profil && profil.autres) || {};
    return scopePeople(scope).reduce((o, k) => {
      o.usage += pos(a[k] && a[k].usage);
      o.entreprise += pos(a[k] && a[k].entreprise);
      return o;
    }, { usage: 0, entreprise: 0 });
  }
  function patrimoine(positions, profil, scope) {
    const f = financier(positions, scope), i = immobilier(profil, scope), a = autresActifs(profil, scope), d = dettes(profil, scope);
    const brut = f + i + a.usage + a.entreprise;
    return { financier: f, immobilier: i, usage: a.usage, entreprise: a.entreprise, dettes: d, brut, net: brut - d };
  }

  /* Taux brut → net de la toise : 0,75 cadre, 0,78 non-cadre. */
  const brutRate = statut => (statut === "cadre" ? 0.75 : 0.78);
  function salaireNetMensuel(p) {
    if (!p) return 0;
    const v = pos(p.salaire), r = brutRate(p.statut);
    switch (p.salaireUnite) {
      case "na": return v / 12;
      case "bm": return v * r;
      case "ba": return v * r / 12;
      default: return v;
    }
  }
  function revenusFoyer(profil, scope) {
    const ps = (profil && profil.personnes) || {};
    const sal = sum(scopePeople(scope), k => salaireNetMensuel(ps[k]) + pos(ps[k] && ps[k].autresRevenus));
    return sal + sum(biens(profil), b => pos(b.loyer) * part(scope, b.part_p1));
  }

  /* Matelas de précaution (config.cushion) : { mode: "amount", min, max } ou { mode: "months", months, depenses }
     (cible = months × depenses, sans plafond). Ancienne forme sans mode = montant. null si non défini. */
  function matelas(config) {
    const c = config && config.cushion;
    if (!c || typeof c !== "object") return null;
    if (c.mode === "months") return { mode: "months", min: pos(c.months) * pos(c.depenses), max: null, months: pos(c.months), depenses: pos(c.depenses) };
    return { mode: "amount", min: pos(c.min), max: c.max == null || c.max === "" ? null : pos(c.max) };
  }

  /* ---------- budget réel (banques connectées, spec cp1 § 5) ---------- */
  /* banque = S.banque { actif?, comptes, mois } (ou la même forme lue en SQL par le connecteur : doublon_de, compte_id).
     Comptes courants suivis : type « courant », non ignorés, pas en double, actifs. */
  const doublonDe = c => (c.doublonDe !== undefined ? c.doublonDe : c.doublon_de);
  function comptesCourants(banque) {
    const L = banque && Array.isArray(banque.comptes) ? banque.comptes : [];
    return L.filter(c => c && c.type === "courant" && c.ignore !== true && doublonDe(c) == null && c.actif !== false);
  }
  /* Compte d'une ligne de banque_mois : compteId (store) ou compte_id (SQL) ; 0 (valeur par défaut de la migration 0025) = totaux par
     utilisateur, comme une ligne sans compte. */
  const idCompte = r => { const v = r.compteId != null ? r.compteId : r.compte_id; return v == null || v === "" || +v === 0 ? null : v; };
  const moisIso = d => { const s = d instanceof Date ? d.toISOString() : String(d == null ? "" : d); return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null; };
  const lignesMois = banque => (banque && Array.isArray(banque.mois) ? banque.mois : []).filter(Boolean);
  /** Mois (AAAA-MM) détaillés par compte : au moins une ligne porte un compte. */
  const moisDetailles = banque => new Set(lignesMois(banque).filter(r => idCompte(r) != null).map(r => moisIso(r.mois)));
  /** Lignes de banque_mois des comptes courants, mois par mois : un mois détaillé par compte (compteId / compte_id) ne garde que les
      lignes des comptes courants suivis (ses éventuels totaux agrégés sont écartés) ; un mois sans détail (totaux par utilisateur, BQ1)
      garde ses lignes telles quelles. */
  function moisCourants(banque) {
    const L = lignesMois(banque), det = moisDetailles(banque);
    if (!det.size) return L;
    const ids = new Set(comptesCourants(banque).map(c => String(c.id)));
    return L.filter(r => (det.has(moisIso(r.mois)) ? idCompte(r) != null && ids.has(String(idCompte(r))) : true));
  }
  const RE_INTERNE = /^virements?[_ ]internes?$|^interne$/;

  /* ---------- série fusionnée des mois bancaires (HIS2, spec 2026-10-16-his2-historique-design.md § 6.1) ---------- */
  const liste = v => (Array.isArray(v) ? v.filter(Boolean) : []);
  const cleCompte = v => (v == null || v === "" ? null : String(v));
  const compteBanqueDe = hc => { const v = hc.banqueCompteId !== undefined ? hc.banqueCompteId : hc.banque_compte_id; return v == null || v === "" || +v === 0 ? null : v; };
  const compteImporteDe = r => (r.compteId != null ? r.compteId : r.compte_id);
  const importDe = r => (r.importId !== undefined ? r.importId : r.import_id);
  /** Ligne de totaux d'un mois importé, dans la forme d'une ligne de banque_mois (mois au 1er du mois, compte, catégorie large, sous-catégorie). */
  const ligneImportee = (r, mois, compte) => ({ mois: mois + "-01", compte_id: compte, categorie: r.categorie, sous_categorie: r.sous_categorie == null ? "" : r.sous_categorie,
    entrees: n(r.entrees), sorties: n(r.sorties), nombre: n(r.nombre) });
  /** Série des mois bancaires par compte et par mois, UNE fonction pour la synchronisation (Powens) et les relevés importés (HIS2) : jamais deux fois
      le même euro. Consommée par budgetReel (donc la projection et la santé), par le connecteur et par l'écran de couverture.
      banque = S.banque { comptes, mois } ; historique = { comptes, releves, banqueMois } (historique_comptes, historique_releves,
      historique_banque_mois ; champs en snake_case de la base ou en camelCase du store) ; auj = date du jour (les mois importés après le mois en
      cours sont ignorés). Règles : un compte importé rattaché à un compte Powens (banque_compte_id) prend Powens pour un mois que banque_mois
      couvre, sauf le premier mois du compte dans banque_mois (réputé entamé : la synchronisation a commencé en cours de mois) où l'import l'emporte ;
      un compte importé non rattaché : l'import ; un compte Powens sans import : Powens pour tous ses mois, premier mois compris. Une carte à débit
      différé importée compte si le courant importé du même établissement et du même titulaire porte ce mois-là une ligne « releve_carte » (hors budget),
      ou si aucun courant de cet établissement et de ce titulaire n'est importé ce mois-là ; sinon elle est écartée (son relevé, compté sur le courant, ne
      doit pas l'être deux fois).
      → [{ compte, mois: "AAAA-MM", source: "powens" | "import" | null, type?, categories: [lignes de banque_mois], releve?, import_id?, ecarte? }], triée par
      mois puis par compte (en texte). compte = banque_compte_id si le compte importé est rattaché ou si c'est un compte Powens (null pour des
      totaux sans compte), sinon "h:" + id du compte importé ; releve = en-tête du mois importé { complet, solde_debut, solde_fin, total_entrees,
      total_sorties, nombre } ; ecarte = [{ source, import_id?, raison }] avec raison couvert_par_powens | premier_mois | carte_comptee_sur_courant
      (ce qui a été mis de côté reste visible dans la couverture). Même calcul dans le connecteur (parité testée). */
  function moisBancaires(banque, historique, auj) {
    const courant = moisIso(auj == null ? new Date() : auj);
    const H = historique || {};
    const hComptes = liste(H.comptes), hReleves = liste(H.releves), hLignes = liste(H.banqueMois);
    // Powens : lignes par (compte, mois) et premier mois de chaque compte
    const powens = new Map(), premier = {};
    lignesMois(banque).forEach(r => {
      const m = moisIso(r.mois);
      if (!m) return;
      const c = idCompte(r), k = cleCompte(c) + "|" + m;
      if (!powens.has(k)) powens.set(k, { compte: c, mois: m, lignes: [] });
      powens.get(k).lignes.push(r);
      if (c != null && (premier[String(c)] === undefined || m < premier[String(c)])) premier[String(c)] = m;
    });
    // Relevés importés : lignes par (compte importé, mois)
    const compteH = new Map(hComptes.map(c => [String(c.id), c]));
    const lignesH = new Map();
    hLignes.forEach(r => {
      const m = moisIso(r.mois), c = cleCompte(compteImporteDe(r));
      if (!m || c == null) return;
      const k = c + "|" + m;
      if (!lignesH.has(k)) lignesH.set(k, []);
      lignesH.get(k).push(r);
    });
    const importes = hReleves.map(r => ({ r, hc: compteH.get(String(compteImporteDe(r))), mois: moisIso(r.mois) }))
      .filter(x => x.hc && x.mois && (!courant || x.mois <= courant));
    const courants = (hc, mois) => importes.filter(x => x.mois === mois && x.hc.type === "courant" && x.hc.etablissement === hc.etablissement && x.hc.titulaire === hc.titulaire);
    const aReleveCarte = x => (lignesH.get(String(x.hc.id) + "|" + x.mois) || []).some(l => l.sous_categorie === "releve_carte");
    const sortie = [], prises = new Set();
    importes.forEach(x => {
      const { r, hc, mois } = x, rattache = compteBanqueDe(hc), compte = rattache != null ? rattache : "h:" + hc.id;
      const lignes = (lignesH.get(String(hc.id) + "|" + mois) || []).map(l => ligneImportee(l, mois, compte));
      const releve = { complet: r.complet !== false, solde_debut: r.solde_debut == null ? null : n(r.solde_debut), solde_fin: r.solde_fin == null ? null : n(r.solde_fin),
        total_entrees: n(r.total_entrees), total_sorties: n(r.total_sorties), nombre: n(r.nombre) };
      const imp = importDe(r), base = { compte, mois, type: hc.type, categories: lignes, releve };
      if (imp != null) base.import_id = imp;
      const kp = cleCompte(rattache) + "|" + mois, p = rattache != null ? powens.get(kp) : null;
      if (p) {
        prises.add(kp);
        if (mois === premier[String(rattache)]) { sortie.push({ ...base, source: "import", ecarte: [{ source: "powens", raison: "premier_mois" }] }); return; }
        const e = { source: "import", raison: "couvert_par_powens" };
        if (imp != null) e.import_id = imp;
        sortie.push({ compte, mois, source: "powens", type: hc.type, categories: p.lignes, ecarte: [e] });
        return;
      }
      if (hc.type === "carte_differe") {
        const cc = courants(hc, mois);
        if (cc.length && !cc.some(aReleveCarte)) {
          const e = { source: "import", raison: "carte_comptee_sur_courant" };
          if (imp != null) e.import_id = imp;
          sortie.push({ compte, mois, source: null, type: hc.type, categories: [], ecarte: [e] });
          return;
        }
      }
      sortie.push({ ...base, source: "import" });
    });
    powens.forEach((p, k) => { if (!prises.has(k)) sortie.push({ compte: p.compte, mois: p.mois, source: "powens", categories: p.lignes }); });
    return sortie.sort((a, b) => (a.mois < b.mois ? -1 : a.mois > b.mois ? 1 : String(a.compte) < String(b.compte) ? -1 : String(a.compte) > String(b.compte) ? 1 : 0));
  }
  /** Lignes des relevés importés qui comptent au budget : source « import », mois complet, compte courant ou joint (une carte à débit différé
      déjà décidée par moisBancaires). Les livrets et autres comptes importés ne servent qu'à la couverture. */
  const importeAuBudget = e => e.source === "import" && e.releve && e.releve.complet !== false && (e.type === "courant" || e.type === "joint" || e.type === "carte_differe");
  /** Budget réel moyen des nb (3) derniers mois complets (mois en cours exclu), comptes courants seulement :
      revenus = entrées − sorties de « revenus » ; épargne = sorties − entrées de « epargne » (virements vers l'épargne et
      l'investissement) ; dépenses = sorties − entrées de toutes les autres catégories ; virements internes exclus.
      tauxEpargne = « Épargne versée » : versements d'épargne et d'investissement ÷ revenus (moyennes de la période ; même chiffre que lire_banque, banque.ts). « Capacité d'épargne » réelle
      (spec cp4 § 1.2, critère « Capacité d'épargne » de Santé) : capacite = revenus − dépenses, tauxCapacite = capacite ÷ revenus (l'épargne
      versée en est une partie, affichée à part). parCompte : vrai si chaque mois retenu est détaillé par compte
      (chiffres des seuls comptes courants) ; faux sinon (totaux de tous les comptes connectés : libellé « tous comptes connectés »).
      historique (facultatif, HIS2) : relevés importés { comptes, releves, banqueMois } ; le calcul porte alors sur la série de moisBancaires
      (Powens et import, jamais les deux pour le même compte et le même mois) ; sans lui, comportement inchangé. Un mois importé non complet n'y entre jamais.
      → { n, du, au, revenus, depenses, epargne, tauxEpargne, capacite, tauxCapacite, parCompte, moisImportes? (avec relevés importés : mois retenus qui en viennent) } ou null (interrupteur éteint et aucun relevé importé,
      aucun mois complet). Même calcul dans le connecteur (budgetReel, index.ts). */
  function budgetReel(banque, auj, nb, historique) {
    const actif = !!banque && banque.actif !== false;
    const utileH = !!historique && (liste(historique.releves).length > 0);
    if (!actif && !utileH) return null;
    const b = actif ? banque : { mois: [], comptes: [] };
    const k = Number.isInteger(nb) && nb > 0 ? nb : 3;
    const courant = moisIso(auj == null ? new Date() : auj);
    let L0 = moisCourants(b), importees = [];
    if (utileH) {
      const serie = moisBancaires(b, historique, auj);
      const remplaces = new Set(serie.filter(e => e.source !== "powens" && (e.ecarte || []).some(x => x.source === "powens")).map(e => cleCompte(e.compte) + "|" + e.mois));
      L0 = L0.filter(r => !remplaces.has(cleCompte(idCompte(r)) + "|" + moisIso(r.mois)));
      importees = serie.filter(importeAuBudget);
      importees.forEach(e => e.categories.forEach(l => L0.push(l)));
    }
    const L = L0.filter(r => moisIso(r.mois) && moisIso(r.mois) < courant && !RE_INTERNE.test(sansAccent(r.categorie)));
    const retenus = [...new Set(L.map(r => moisIso(r.mois)))].sort().slice(-k);
    if (!retenus.length) return null;
    let rev = 0, dep = 0, ep = 0;
    L.filter(r => retenus.includes(moisIso(r.mois))).forEach(r => {
      const e = n(r.entrees), s = n(r.sorties), c = sansAccent(r.categorie);
      if (c === "revenus") rev += e - s; else if (c === "epargne") ep += s - e; else dep += s - e;
    });
    const det = moisDetailles(b);
    importees.forEach(e => det.add(e.mois));
    const m = retenus.length, revenus = pos(rev) / m, depenses = pos(dep) / m, epargne = pos(ep) / m;
    const res = { n: m, du: retenus[0] + "-01", au: retenus[m - 1] + "-01", revenus, depenses, epargne, tauxEpargne: revenus > 0 ? epargne / revenus : null,
      capacite: revenus - depenses, tauxCapacite: revenus > 0 ? (revenus - depenses) / revenus : null, parCompte: retenus.every(x => det.has(x)) };
    // avec des relevés importés : combien des mois retenus viennent d'eux (au moins un compte importé ce mois-là)
    if (utileH) res.moisImportes = retenus.filter(x => importees.some(e => e.mois === x)).length;
    return res;
  }
  /** Période d'un budget réel en clair (spec cp4 § 1) : « juillet à septembre 2026 », « novembre 2025 à janvier 2026 », « septembre 2026 ».
      r = { du, au } (AAAA-MM-JJ) ; "" si r est absent. Même fonction dans le connecteur (periodeReel, index.ts). */
  const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  function periodeReel(r) {
    const a = r && moisIso(r.du), b = r && moisIso(r.au);
    if (!a || !b) return "";
    const nom = m => MOIS_FR[+m.slice(5, 7) - 1], an = m => m.slice(0, 4);
    if (a === b) return nom(b) + " " + an(b);
    return an(a) === an(b) ? nom(a) + " à " + nom(b) + " " + an(b) : nom(a) + " " + an(a) + " à " + nom(b) + " " + an(b);
  }
  /** Dépenses mensuelles du budget prévu (mêmes règles que Plan.budgetTotaux : lignes de dépense × part du périmètre + mensualités
      de crédit, si au moins une ligne de dépense ; sinon les dépenses saisies du matelas en mois ; sinon 0). */
  function depensesPrevues(budget, profil, config, scope) {
    const sc = scope || "foyer";
    const L = Array.isArray(budget) ? budget : budget && Array.isArray(budget.lignes) ? budget.lignes : [];
    const lignes = sum(L.filter(l => l && l.type === "depense"), l =>
      (l.frequence === "an" ? pos(l.montant) / 12 : pos(l.montant)) * partCredit(sc, l.owner === "p1" || l.owner === "p2" ? l.owner : "commun"));
    if (lignes > 0) return lignes + mensualites(profil, sc);
    const m = matelas(config);
    return m && m.mode === "months" && m.depenses > 0 ? m.depenses : 0;
  }
  /** Dépenses mensuelles de référence : budget réel (foyer seulement : les comptes ne sont pas répartis par personne) s'il existe,
      sinon budget prévu. ctx = { banque, relevesBancaires (relevés importés, facultatif), budget, profil, config, scope, auj } → { montant, source: "reel" | "prevu", reel? } ou null. */
  function depensesMensuelles(ctx) {
    const c = ctx || {}, sc = c.scope || "foyer";
    const r = sc === "foyer" ? budgetReel(c.banque, c.auj, undefined, c.relevesBancaires) : null;
    if (r && r.depenses > 0) return { montant: r.depenses, source: "reel", reel: r };
    const p = depensesPrevues(c.budget, c.profil, c.config, sc);
    return p > 0 ? { montant: p, source: "prevu" } : null;
  }

  /* ---------- matelas disponible (spec cp1 § 1) ---------- */
  /** Réserve de fonctionnement laissée sur les comptes courants, en mois de dépenses : config.cushion.reserve_mois (facultatif,
      à côté des formes amount / months), 1 par défaut. */
  function reserveMois(config) {
    const c = config && config.cushion, v = c && typeof c === "object" ? c.reserve_mois : undefined;
    return v !== null && v !== undefined && v !== "" && isFinite(+v) && +v >= 0 ? +v : 1;
  }
  /** Matelas = épargne disponible + max(0, soldes courants − réserve), réserve = reserveMois × dépenses mensuelles.
      opts = { config, depenses } → { epargne, courants, reserveMois, depenses, reserve, courantsAuDela, total }. */
  function matelasDisponible(positions, scope, opts) {
    const o = opts || {}, sc = scope || "foyer";
    const L = (positions || []).filter(p => p && inScope(p, sc) && counted(p));
    const epargne = sum(L.filter(p => famille(p) === "epargne"), val);
    const courants = sum(L.filter(estCourant), val);
    const rm = reserveMois(o.config), depenses = pos(o.depenses), reserve = rm * depenses;
    const courantsAuDela = Math.max(0, courants - reserve);
    return { epargne, courants, reserveMois: rm, depenses, reserve, courantsAuDela, total: epargne + courantsAuDela };
  }

  /* ---------- poches d'une photo (snapshots.by_bloc) ---------- */
  const objetSimple = v => !!v && typeof v === "object" && !Array.isArray(v);
  const nombreOk = v => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && isFinite(+v);
  /** Poches d'une photo du patrimoine, à plat : { poche: valeur } pour un périmètre (foyer | p1 | p2). Lecteur UNIQUE de snapshots.by_bloc, utilisé par
      l'app et par le connecteur (copies générées de ce module) : la fonction nocturne (take_snapshots, migration 0003) l'écrit PAR PERSONNE,
      { p1: { poche: valeur }, p2: { … } } (forme de production) ; l'ancienne forme de la démo et des lignes migrées est à plat, { poche: valeur }.
      Photo en forme de l'app ({ byBloc }) ou ligne SQL ({ by_bloc }). Foyer = somme de toutes les personnes (p1, p2, et « commun » s'il existe) ;
      p1 / p2 = la leur ; une photo à plat ne se découpe pas par personne (null pour p1 / p2). Valeurs non numériques écartées ; la photo n'est
      jamais modifiée. → objet (éventuellement vide) ou null si la photo n'a pas de poches lisibles. */
  function blocsPhoto(photo, perimetre) {
    const bb = photo && (photo.byBloc || photo.by_bloc), scope = perimetre || "foyer";
    if (!objetSimple(bb)) return null;
    const cles = Object.keys(bb);
    if (!cles.length) return null;
    const out = {};
    const ajoute = m => Object.keys(m).forEach(k => { if (nombreOk(m[k])) out[k] = (out[k] || 0) + +m[k]; });
    if (cles.every(k => objetSimple(bb[k]))) {
      if (scope === "foyer") cles.forEach(o => ajoute(bb[o]));
      else if (objetSimple(bb[scope])) ajoute(bb[scope]);
    } else if (scope === "foyer") ajoute(bb);
    else return null;
    return out;
  }

  /* ---------- argent qui dort (spec cp1 § 1) ---------- */
  const SEUIL_DORT = 1.5;
  const moisAvant = (m, k) => { const [y, mo] = m.split("-").map(Number), t = y * 12 + (mo - 1) - k; return Math.floor(t / 12) + "-" + String(t % 12 + 1).padStart(2, "0"); };
  /** Soldes des comptes courants supérieurs à 1,5 mois de dépenses deux mois de suite (foyer).
      Points mesurés, du plus récent au plus ancien : fins des mois complets d'après les photos (dernière photo de chaque mois), sur les
      seules lignes des comptes courants : poches courantes (byBloc : une poche « Comptes courants » ne contient que des comptes courants)
      et enveloppes courantes (byEnvelope, pour les comptes courants reconnus à leur enveloppe, « Compte joint » par exemple, quand
      aucune de leurs lignes n'est dans une poche courante — sans quoi l'enveloppe est laissée de côté plutôt que comptée deux fois) ;
      jamais une enveloppe mixte (« Boursorama » avec un compte courant et un PEA). À défaut de photo deux mois en arrière : solde
      actuel de ces mêmes lignes puis fin du mois précédent. Dépenses : Calc.depensesMensuelles (réel, sinon prévu).
      → { montant (dépassement le plus faible des deux derniers points, arrondi), mois (mois de suite au-dessus du seuil, ≥ 2), solde
      (point le plus récent), seuil, depenses, source } ou null. Pour Aujourd'hui et la revue mensuelle. */
  function argentQuiDort(S, auj) {
    const s = S || {}, jour = auj == null ? new Date() : auj;
    const courants = (s.positions || []).filter(p => p && counted(p) && estCourant(p));
    if (!courants.length) return null;
    const d = depensesMensuelles({ banque: s.banque, relevesBancaires: s.relevesBancaires, budget: s.budget, profil: s.profil, config: s.config, scope: "foyer", auj: jour });
    if (!d) return null;
    const seuil = SEUIL_DORT * d.montant, m0 = moisIso(jour);
    const blocCourant = p => RE_COURANT.test(sansAccent(p.bloc));
    const blocs = [...new Set(courants.filter(blocCourant).map(p => p.bloc))];
    const envsMelees = new Set(courants.filter(blocCourant).map(p => p.envelope));
    const envs = [...new Set(courants.filter(p => !blocCourant(p) && p.envelope && !envsMelees.has(p.envelope)).map(p => p.envelope))];
    const mesurees = courants.filter(p => blocs.includes(p.bloc) || envs.includes(p.envelope));
    if (!mesurees.length) return null;
    const parBloc = x => blocsPhoto(x, "foyer"), parEnv = x => x && (x.byEnvelope || x.by_envelope);
    const a = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
    const photos = {};
    (Array.isArray(s.snapshots) ? s.snapshots : []).forEach(x => {
      const m = x && moisIso(x.date);
      if (!m || m >= m0 || !(blocs.some(b => a(parBloc(x), b)) || envs.some(e => a(parEnv(x), e)))) return;
      if (!photos[m] || String(x.date) > String(photos[m].date)) photos[m] = x;
    });
    const solde = x => sum(blocs, b => n((parBloc(x) || {})[b])) + sum(envs, e => n((parEnv(x) || {})[e]));
    const points = [];
    if (photos[moisAvant(m0, 1)] && photos[moisAvant(m0, 2)]) {
      for (let k = 1; photos[moisAvant(m0, k)]; k++) points.push(solde(photos[moisAvant(m0, k)]));
    } else if (photos[moisAvant(m0, 1)]) points.push(sum(mesurees, val), solde(photos[moisAvant(m0, 1)]));
    let mois = 0;
    while (mois < points.length && points[mois] > seuil) mois++;
    if (mois < 2) return null;
    return { montant: Math.round(Math.min(points[0], points[1]) - seuil), mois, solde: points[0], seuil, depenses: d.montant, source: d.source };
  }

  /* ---------- doublons probables (revue CP1) ---------- */
  const TOLERANCE_DOUBLON = 0.03;
  /** Lignes qui recopient probablement le total de leur enveloppe (ex. ligne « PEA DUPONT » créée en validant une proposition « créer
      une ligne » alors que les titres du PEA sont déjà suivis : le PEA compte deux fois). Dans une même enveloppe et un même titulaire,
      une ligne manuelle sans ISIN, comptée, dont la valeur est à ±3 % de la somme des autres lignes comptées (au moins 2 autres).
      → [{ ligne (id), nom, enveloppe, titulaire, valeur, sommeAutres }]. Même règle dans le connecteur (doublonsProbables, index.ts). */
  function doublonsProbables(positions) {
    const L = (positions || []).filter(p => p && counted(p) && String(p.envelope || "").trim());
    const groupes = new Map();
    L.forEach(p => { const k = String(p.envelope).trim() + "|" + (p.owner || ""); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(p); });
    const out = [];
    groupes.forEach(g => {
      if (g.length < 3) return;
      const total = sum(g, val);
      g.forEach(p => {
        if (p.mode === "market" || String(p.isin || "").trim()) return;
        const v = val(p), autres = total - v;
        if (v > 0 && autres > 0 && Math.abs(v - autres) <= TOLERANCE_DOUBLON * autres)
          out.push({ ligne: p.id, nom: p.name || "", enveloppe: String(p.envelope).trim(), titulaire: p.owner || null, valeur: v, sommeAutres: autres });
      });
    });
    return out;
  }

  /* Apport : épargne au-delà du matelas (porté par la personne 1 et le foyer), + part des placements, + « à recevoir » en option. */
  function apportDisponible(positions, config, scope, opts) {
    const o = opts || {};
    const epargne = poche(positions, scope, "Épargne");
    const m = matelas(config);
    const matelas_ = scope === "p2" || !m ? 0 : m.min;
    const libre = Math.max(0, epargne - matelas_);
    const autres = financier(positions, scope) - epargne;
    const placements = Math.max(0, autres) * Math.min(100, Math.max(0, n(o.partPlacements))) / 100;
    const rec = o.inclureARecevoir ? aRecevoir(positions, scope) : 0;
    return { epargne, matelas: matelas_, libre, placements, aRecevoir: rec, total: libre + placements + rec };
  }

  /* ---------- noms et validation (la complétude du bilan est dans bilan-etat.js : une seule fonction) ---------- */
  /* « de Camille », « d'Alex » ; sans prénom (ou prénom par défaut) : « de la personne 1 ». */
  const NOMS_PAR_DEFAUT = ["", "moi", "conjoint", "conjoint(e)", "conjointe"];
  function deNom(nom, rang) {
    const s = String(nom == null ? "" : nom).trim();
    if (NOMS_PAR_DEFAUT.includes(s.toLowerCase())) return "de la personne " + (rang || 1);
    return (/^[aeiouyhàâäéèêëîïôöûüÿæœ]/i.test(s) ? "d'" : "de ") + s;
  }
  function valider(profil) {
    const erreurs = [], avertissements = [];
    biens(profil).forEach(b => {
      const nom = b.nom || "Bien sans nom";
      if (n(b.part_p1) < 0 || n(b.part_p1) > 100) erreurs.push(nom + " : la quote-part doit être comprise entre 0 et 100 %.");
      ["valeur", "crd", "mensualite", "loyer"].forEach(k => { if (n(b[k]) < 0) erreurs.push(nom + " : les montants ne peuvent pas être négatifs."); });
      if (pos(b.crd) > pos(b.valeur) && pos(b.valeur) > 0) avertissements.push(nom + " : le capital restant dû dépasse la valeur du bien.");
    });
    credits(profil).forEach(c => {
      if (n(c.crd) < 0 || n(c.mensualite) < 0) erreurs.push((c.nom || "Crédit sans nom") + " : les montants ne peuvent pas être négatifs.");
    });
    return { erreurs: [...new Set(erreurs)], avertissements };
  }

  /* Calendrier patrimonial (DAT1) : délégation à Calendrier.calendrier (web/src/calendrier.js), la même fonction sous Node. */
  const calendrier = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./calendrier.js").calendrier
    : (data, today, options) => root.Calendrier.calendrier(data, today, options);

  return { calendrier, CLASSES_LABELS, LIQUIDITE_LABELS, FAMILLES_LABELS, classe, liquidite, famille, horsCourants, parClasse, parLiquidite,
    comptesCourants, moisCourants, moisBancaires, budgetReel, periodeReel, doublonsProbables, depensesPrevues, depensesMensuelles, reserveMois, matelasDisponible, argentQuiDort, blocsPhoto,
    val, counted, inScope, financier, poche, aRecevoir, part, partCredit, immobilier, dettes, mensualites, creditsEnCours,
    autresActifs, patrimoine, brutRate, salaireNetMensuel, revenusFoyer, matelas, apportDisponible, deNom, valider };
});
});

/* ---------- web/src/periodes.js ---------- */
def("periodes", function (module, exports, require) {
/* Filtres de dates communs aux graphiques d'évolution : période (prédéfinie ou personnalisée), granularité
   (jour → année), agrégation d'une série de stock (valeur de fin de période) et variations. Fonctions pures. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Periodes = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const PERIODES = [
    { id: "1m", label: "1 mois" }, { id: "3m", label: "3 mois" }, { id: "6m", label: "6 mois" }, { id: "ytd", label: "Depuis janvier" },
    { id: "1a", label: "1 an" }, { id: "3a", label: "3 ans" }, { id: "tout", label: "Tout" }, { id: "perso", label: "Personnalisé" },
  ];
  const GRANULARITES = [
    { id: "auto", label: "Auto" }, { id: "jour", label: "Jour" }, { id: "semaine", label: "Semaine" },
    { id: "mois", label: "Mois" }, { id: "trimestre", label: "Trimestre" }, { id: "annee", label: "Année" },
  ];

  /* ---------- dates ISO (AAAA-MM-JJ), calculées en UTC pour éviter les décalages d'heure d'été ---------- */
  const parse = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const iso = d => d.toISOString().slice(0, 10);
  const finMois = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  function moinsMois(s, k) {
    const d = parse(s), y = d.getUTCFullYear(), m = d.getUTCMonth() - k;
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    return iso(new Date(Date.UTC(yy, mm, Math.min(d.getUTCDate(), finMois(yy, mm)))));
  }
  const jours = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);

  /** Bornes { du, au } d'une période prédéfinie (« 3m », « ytd »…) ou personnalisée ({ du, au }). */
  function bornes(periode, today, premiere) {
    if (periode && typeof periode === "object") {
      const a = periode.du || premiere || today, b = periode.au || today;
      return a <= b ? { du: a, au: b } : { du: b, au: a };
    }
    const mois = { "1m": 1, "3m": 3, "6m": 6, "1a": 12, "3a": 36 }[periode];
    if (mois) return { du: moinsMois(today, mois), au: today };
    if (periode === "ytd") return { du: today.slice(0, 4) + "-01-01", au: today };
    return { du: premiere && premiere < today ? premiere : today, au: today };
  }

  /** Granularité lisible selon la durée : jour (≤ 3 mois), semaine (≤ 1 an), mois (≤ 3 ans), trimestre (≤ 10 ans), année. */
  function auto(b) {
    const n = jours(b.du, b.au);
    return n <= 93 ? "jour" : n <= 366 ? "semaine" : n <= 1098 ? "mois" : n <= 3660 ? "trimestre" : "annee";
  }

  /** Clé de la période contenant une date : jour, lundi de la semaine, AAAA-MM, AAAA-Tq, AAAA. */
  function cle(date, g) {
    const s = String(date).slice(0, 10);
    if (g === "semaine") { const d = parse(s); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return iso(d); }
    if (g === "mois") return s.slice(0, 7);
    if (g === "trimestre") return s.slice(0, 4) + "-T" + (Math.floor((+s.slice(5, 7) - 1) / 3) + 1);
    if (g === "annee") return s.slice(0, 4);
    return s;
  }
  const fmt = (d, o) => parse(d).toLocaleDateString("fr-FR", Object.assign({ timeZone: "UTC" }, o));
  /** Libellé court d'une clé de période, pour les axes et infobulles. */
  function libelle(k, g) {
    if (g === "mois") return fmt(k + "-01", { month: "short", year: "numeric" });
    if (g === "trimestre") return k.slice(5) + " " + k.slice(0, 4);
    if (g === "annee") return k;
    if (g === "semaine") return "sem. du " + fmt(k, { day: "numeric", month: "short" });
    return fmt(k, { day: "numeric", month: "short" });
  }

  const propres = (points, get) => (points || []).map(p => ({ p, date: String(p.date).slice(0, 10), v: get(p) }))
    .filter(x => x.v != null && isFinite(+x.v)).map(x => Object.assign(x, { v: +x.v })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  /** Série agrégée sur { du, au } : une valeur par période (dernière observation), variation vs période précédente
      (le premier point est comparé à la dernière observation avant la période, si elle existe). */
  function agreger(points, b, granularite, get) {
    const g = !granularite || granularite === "auto" ? auto(b) : granularite;
    const xs = propres(points, get);
    const avant = xs.filter(x => x.date < b.du).pop();
    const groupes = new Map();
    xs.filter(x => x.date >= b.du && x.date <= b.au).forEach(x => groupes.set(cle(x.date, g), x));
    let prec = avant ? avant.v : null;
    return [...groupes.entries()].map(([k, x]) => {
      const variation = prec == null ? null : x.v - prec;
      const out = { cle: k, date: x.date, label: libelle(k, g), valeur: x.v, variation, variationPct: prec ? variation / prec * 100 : null, granularite: g };
      prec = x.v;
      return out;
    });
  }

  /** Début, fin et variation sur la période (début = dernière valeur avant la période, sinon première de la période). */
  function resume(agreges, points, b, get) {
    if (!agreges || !agreges.length) return { debut: null, fin: null, variation: null, variationPct: null };
    const avant = propres(points, get).filter(x => x.date < b.du).pop();
    const debut = avant ? avant.v : propres(points, get).find(x => x.date >= b.du).v;
    const fin = agreges[agreges.length - 1].valeur;
    return { debut, fin, variation: fin - debut, variationPct: debut ? (fin - debut) / debut * 100 : null };
  }

  return { PERIODES, GRANULARITES, bornes, auto, cle, libelle, agreger, resume };
});
});

/* ---------- web/src/budget.js ---------- */
def("budget", function (module, exports, require) {
/* Moteur du budget (BUD1) : cible en vigueur, note du mois, détections et pistes, cible proposée. Module pur, sans DOM, au tutoiement.
   Spec : docs/superpowers/specs/2026-10-16-bud1-budget-design.md (§ 6, § 7, § 8) ; cas de référence : test/fixtures/budget-cas.json (la fixture fait foi :
   score S1 à S15, cible_en_vigueur, cible T1 à T5, reperes). Global Budget (navigateur), module CommonJS sous Node, copie générée dans le connecteur
   (supabase/functions/mcp/budget.gen.js, npm run gen) : une seule logique pour l'app et pour Claude.

   Livré (tâches 8, 9 et 10 du plan) :
   Budget.cibleEnVigueur(config, perimetre, mois) → cible | null                       // § 7.5 : la cible validée s'applique au mois suivant
   Budget.score(M, cible, opts?) → { score, mot, provisoire, raisons_provisoire, raison_absence, termes, points, texte, … }   // § 7
   Budget.detections(data, opts?) → { recurrents, doublons, frais, petits_achats, energie, fragilite }               // § 6.4
   Budget.pistes(data, opts?) → [piste]                                                                              // § 8.2
   Budget.proposerCible(data, entree) → { options, retenue, cible, controles, … }                                    // § 8.3
   Budget.plancherResteAVivre(foyer, reperes) → { repere, valeur } | null ; Budget.comparerInsee(reference, reperes, opts?) → comparaison (T5)

   Livré (tâche 7) : le moteur du mois, qui lit les mois bancaires fusionnés par Calc.moisBancaires (HIS2) :
   Budget.donnees(S, { aujourdhui }) → data                                            // comptes du budget, mois (Powens et import), partage, préférences, cible, repères
   Budget.mois(data, { vue: "tout" | "commun" | "perso", personne?, mois }) → M       // § 6.1 : revenus, blocs, hors budget, capacité, épargne, lissage, couverture
   Budget.serie(data, { vue, personne?, du, au, granularite: "mois" | "trimestre" | "annee" }) → [M]
   Budget.reference(data, { vue, personne?, mois_ref? }) → référence | null            // § 6.2 : médianes lissées sur 12 mois (6 au moins, sinon 3 : période courte)
   Budget.depensesAnnuelles(data, { vue, personne, part }) → [dépense annuelle]        // § 6.3
   Livré (tâche 9b, § 6.5, D15 et D18 ; règles et arrondis : `conventions_recurrents` de la fixture) : le récurrent, lu sur les agrégats par marchand (data.marchands)
   Budget.recurrents(data, { vue, personne?, mois? }) → { disponible, mois_couverts, recurrents: [ligne], synthese } | { disponible: false, raison, mois_couverts }
   Budget.variations(data, { vue, personne?, mois, niveau: "sous_categorie" | "cle", sous_categorie? | compte_id + cle_marchand })   // effet volume et effet prix
   Budget.inhabituel(data, { vue, personne?, mois }) → { disponible, mois, depenses }
   Ces trois fonctions lisent { aujourdhui, comptes: [{ id, type, titulaire }], partage, marchands } ; Budget.pistes en tire les pistes liées (hausse de prix, abonnement arrêté
   prélevé ailleurs, habitude en hausse). Fréquence, panier et seuils lisent `nombre_sorties` (sorties seules), à défaut `nombre` (qui compte aussi les entrées).
   Les fonctions de note, de détection et de pistes lisent les formes que ces fonctions produisent (data.mois, data.reference…).

   Formes lues :
   M (mois, § 6.1) : { revenus, blocs: { essentiels, envies, epargne }, a_classer, lisse?: { annuelles: [{ sous_categorie, montant_mois, provision }], essentiels_lisses?,
       envies_lisses? }, couverture?: { a_classer_part?, comptes_observes?, mois_complet?, sans_detail?, import_incomplet?, en_partie_importe? } }
   cible : { revenus_ref, blocs: { essentiels, envies, epargne } } (ou à plat : { revenus_ref, essentiels, envies, epargne }), valide_du?
   reference : { revenus, essentiels: { cle: montant }, envies: { cle: montant }, epargne?: { cle: montant } } (montants mensuels lissés, § 6.2) ou
       { revenus, par_sous_categorie: { cle: montant } } (le bloc de chaque clé vient de la taxonomie et des préférences)
   data (détections et pistes) : { aujourdhui: 'AAAA-MM-JJ', reference, marchands: [lignes de banque_marchands_mois], operations: [{ date, montant, libelle,
       compte_id, sous_categorie, cle_marchand, type_powens? }] (90 jours), comptes: [{ id, type, solde, titulaire?, pret? }], mois: [{ mois, capacite }]
       (capacités des derniers mois), preferences: config.budget_preferences, reperes: [{ cle, valeur }] (conventions budget_*) }
   Tout est déterministe : mêmes entrées, mêmes sorties. Les pourcentages et seuils sont des conventions de Boussole (repères budget_*, statut CONV),
   lues dans data.reperes quand ils y sont. Aucune piste ne vise une sous-catégorie protégée ; aucun fournisseur n'est nommé ni recommandé : une piste
   désigne une sous-catégorie ou une famille, jamais une marque. */
(function (root, factory) {
  const cjs = typeof module === "object" && module.exports;
  const dep = (nom, global) => (cjs ? require("./" + nom + ".js") : root[global]);
  const api = factory({ BudgetCategories: dep("budget-categories", "BudgetCategories"), Calc: dep("calc", "Calc"), Periodes: dep("periodes", "Periodes") });
  if (cjs) module.exports = api;
  else root.Budget = api;
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";
  const { BudgetCategories: BC } = D;

  /* ================================================================== conventions (repères budget_*, § 12) */
  /** Valeurs de départ des conventions ; data.reperes (clé → valeur) les remplace. Statut CONV, revues après 3 mois d'usage (D4, D15). */
  const CONVENTIONS = {
    budget_score_poids_epargne: 3, budget_score_poids_envies: 2, budget_score_poids_essentiels: 1, budget_score_franchise_pct: 1,
    budget_score_seuil_tenu: 85, budget_score_seuil_presque: 60, budget_score_a_classer_provisoire_pct: 15, budget_score_a_classer_sans_note_pct: 30,
    budget_score_revenus_incomplets_pct: 50,
    budget_piste_contrats_pct: 10, budget_piste_envies_pct: 10, budget_piste_envies_fort_pct: 25, budget_piste_petits_achats_pct: 50,
    budget_piste_petit_achat_seuil: 15, budget_piste_petits_achats_nombre: 8, budget_piste_frais_cotisation_laissee: 5, budget_piste_habitude_tendance_pct: 15,
    budget_essentiel_plancher_pct: 90, budget_annuelle_seuil: 150, budget_recurrent_tolerance_pct: 10, budget_matelas_reconstitution_mois: 12,
  };
  /** Convention `cle` : repère de data.reperes (tableau de { cle, valeur } ou objet cle → valeur) s'il y est, sinon valeur de départ. */
  function convention(reperes, cle) {
    let v;
    if (Array.isArray(reperes)) { const r = reperes.find(x => x && x.cle === cle); v = r && r.valeur; }
    else if (reperes && typeof reperes === "object") v = reperes[cle];
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return typeof n === "number" && isFinite(n) ? n : CONVENTIONS[cle];
  }

  /* ================================================================== outils */
  const nombre = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const n0 = v => nombre(v) || 0;
  /** Arrondi à l'entier, 0,5 vers le haut (montants positifs), tolérant aux erreurs de virgule flottante. */
  const arrondi = x => Math.floor(x + 0.5 + 1e-9);
  const dixieme = x => Math.round(x * 10 + 1e-9) / 10;
  const centieme = x => Math.round(x * 100 + 1e-9) / 100;
  const mois7 = d => (typeof d === "string" && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null);
  /** Mois AAAA-MM décalé de k mois. */
  function decale(m, k) { const [a, b] = m.split("-").map(Number); const t = a * 12 + (b - 1) + k; return String(Math.floor(t / 12)).padStart(4, "0") + "-" + String(t % 12 + 1).padStart(2, "0"); }
  const prix = x => String(Math.round(Math.abs(x) * 100) / 100).replace(".", ",") + " €";
  const moisFr = m => ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"][+m.slice(5, 7) - 1] + " " + m.slice(0, 4);
  const euros = x => { const r = arrondi(Math.abs(x)); return String(r).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " €"; };
  const mediane = xs => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
  const somme = xs => xs.reduce((t, x) => t + x, 0);
  const ORDRE_TAXONOMIE = new Map(BC.TAXONOMIE.map((t, i) => [t.cle, i]));
  const blocDe = (cle, preferences) => BC.blocDe(cle, preferences);

  /* ================================================================== cible en vigueur (§ 7.5) */
  /** Cible en vigueur pour un périmètre ("foyer", "p1", "p2") et un mois AAAA-MM : la cible validée la plus récente dont `valide_du` n'est pas après ce mois
      (une cible validée en septembre s'applique en octobre : le mois en cours garde l'ancienne). Cherche dans config.budget_cible.historique
      ([{ perimetre, valide_du, cible }]) puis dans perimetres[périmètre] ; { ...cible, valide_du } ou null. */
  function cibleEnVigueur(config, perimetre, mois) {
    const bc = config && (config.budget_cible || config);
    const m = mois7(mois);
    if (!bc || typeof bc !== "object" || !m) return null;
    const per = perimetre || "foyer";
    const entrees = [];
    for (const h of Array.isArray(bc.historique) ? bc.historique : []) {
      if (h && (h.perimetre || "foyer") === per && mois7(h.valide_du) && h.cible && typeof h.cible === "object") entrees.push({ valide_du: mois7(h.valide_du), cible: h.cible });
    }
    const courante = bc.perimetres && bc.perimetres[per];
    if (courante && mois7(courante.valide_du) && !entrees.some(e => e.valide_du === mois7(courante.valide_du))) entrees.push({ valide_du: mois7(courante.valide_du), cible: courante });
    const valides = entrees.filter(e => e.valide_du <= m).sort((a, b) => (a.valide_du < b.valide_du ? -1 : a.valide_du > b.valide_du ? 1 : 0));
    const e = valides[valides.length - 1];
    return e ? { ...e.cible, valide_du: e.valide_du } : null;
  }

  /* ================================================================== note du mois (§ 7) */
  const MOTS = { tenu: "tenu", presque: "presque", a_revoir: "à revoir" };
  const BLOCS_CIBLE = c => (c && c.blocs && typeof c.blocs === "object" ? c.blocs : c) || {};
  /** Montants lissés d'un mois (§ 6.3) : dépenses annuelles ramenées à leur provision (1/12), ailleurs le réel du mois. */
  function lisses(M, preferences) {
    const bl = (M && M.blocs) || {}, l = (M && M.lisse) || {};
    let ess = n0(bl.essentiels), env = n0(bl.envies);
    if (nombre(l.essentiels_lisses) !== null && nombre(l.envies_lisses) !== null) return { essentiels: l.essentiels_lisses, envies: l.envies_lisses };
    for (const a of Array.isArray(l.annuelles) ? l.annuelles : []) {
      const delta = n0(a.provision) - n0(a.montant_mois);
      if (blocDe(a.sous_categorie, preferences) === "envies") env += delta; else if (blocDe(a.sous_categorie, preferences) === "essentiels") ess += delta;
    }
    return { essentiels: ess, envies: env };
  }
  /** Note de respect du budget d'un mois complet par rapport à la cible en vigueur (§ 7). `M` : le mois (forme du § 6.1), `cible` : cible en vigueur ou null,
      `opts` : { reperes, preferences }. Jamais de série, de record ni de récompense : un nombre, un mot, les points perdus par terme et une phrase. */
  function score(M, cible, opts) {
    const o = opts || {}, K = c => convention(o.reperes, c);
    const cv = (M && M.couverture) || {};
    const absent = raison => ({ score: null, mot: null, provisoire: false, raisons_provisoire: [], raison_provisoire: null, raison_absence: raison, termes: null, points: null,
      part_a_classer: partAClasser, texte: texteAbsence(raison, partAClasser) });
    const bl = (M && M.blocs) || {};
    const Ac = n0(M && M.a_classer);
    const depBrutes = n0(bl.essentiels) + n0(bl.envies) + Ac;
    const partExacte = nombre(cv.a_classer_part) !== null ? cv.a_classer_part : depBrutes > 0 ? Ac / depBrutes : 0;
    const partAClasser = Math.round(partExacte * 10000) / 10000;   // affichée ; les seuils se lisent sur la part exacte
    const B = BLOCS_CIBLE(cible), Rstar = nombre(cible && cible.revenus_ref);
    if (!cible || !Rstar || Rstar <= 0 || nombre(B.essentiels) === null || nombre(B.envies) === null || nombre(B.epargne) === null) return absent("sans_cible");
    if (cv.mois_complet === false || (M && M.mois_complet === false)) return absent("mois_en_cours");
    if (cv.import_incomplet === true) return absent("import_incomplet");
    if (cv.comptes_observes === 0) return absent("aucun_compte");
    if (cv.sans_detail === true) return absent("sans_detail");
    if (partExacte * 100 > K("budget_score_a_classer_sans_note_pct") + 1e-9) return absent("a_classer");
    const R = n0(M.revenus), L = lisses(M, o.preferences);
    const Ess = L.essentiels, Env = L.envies;
    const Dep = Ess + Env + Ac, DepStar = n0(B.essentiels) + n0(B.envies), Sstar = n0(B.epargne);
    const dS = Math.max(0, Dep - Math.max(DepStar, R - Sstar)), dEnv = Math.max(0, Env - n0(B.envies)), dEss = Math.max(0, Ess - n0(B.essentiels));
    const f = K("budget_score_franchise_pct") / 100 * Rstar;
    const poids = { epargne: K("budget_score_poids_epargne"), envies: K("budget_score_poids_envies"), essentiels: K("budget_score_poids_essentiels") };
    const ecart = { epargne: dS, envies: dEnv, essentiels: dEss };
    const num = {}, pts = {};
    let total = 0;
    for (const t of ["epargne", "envies", "essentiels"]) {
      num[t] = poids[t] * Math.max(0, ecart[t] - f);
      total += num[t];
      pts[t] = arrondi(100 * num[t] / Rstar);
    }
    const brut = 100 - 100 * total / Rstar;
    const borne = brut <= 0;
    const sc = borne ? 0 : Math.min(100, arrondi(brut));
    const mot = sc >= K("budget_score_seuil_tenu") ? MOTS.tenu : sc >= K("budget_score_seuil_presque") ? MOTS.presque : MOTS.a_revoir;
    const points = { epargne: pts.epargne, envies: pts.envies, essentiels: pts.essentiels };
    const ecartArrondi = (100 - sc) - (pts.epargne + pts.envies + pts.essentiels);
    if (!borne && ecartArrondi !== 0) points.arrondi = ecartArrondi;
    const raisons = [];
    if (R < K("budget_score_revenus_incomplets_pct") / 100 * Rstar) raisons.push("revenus_incomplets");
    if (partExacte * 100 >= K("budget_score_a_classer_provisoire_pct") - 1e-9) raisons.push("a_classer");
    if (cv.en_partie_importe === true) raisons.push("mois_en_partie_importe");
    const ecartRevenus = R - Rstar;
    const phrase = !(pts.epargne || pts.envies || pts.essentiels) && ecartRevenus < -f ? "revenus_plus_bas" : null;
    const annuelles = Array.isArray(M.lisse && M.lisse.annuelles) ? M.lisse.annuelles : [];
    const res = {
      score: sc, mot, provisoire: raisons.length > 0, raisons_provisoire: raisons, raison_provisoire: raisons[0] || null, raison_absence: null,
      termes: { epargne: { ecart: dS, poids: poids.epargne, points: pts.epargne }, envies: { ecart: dEnv, poids: poids.envies, points: pts.envies },
        essentiels: { ecart: dEss, poids: poids.essentiels, points: pts.essentiels } },
      points, part_a_classer: partAClasser, essentiels_lisses: Ess, envies_lisses: Env, franchise: f, ecart_revenus: ecartRevenus, phrase,
      capacite_reelle: R - n0(bl.essentiels) - n0(bl.envies) - Ac,
      repere: annuelles.length ? "depense_annuelle_lissee" : null,
    };
    res.texte = texteScore(res);
    return res;
  }
  function texteAbsence(raison, part) {
    const t = {
      sans_cible: "Pas de note : aucune cible n'est validée pour ce mois.",
      mois_en_cours: "Pas de note : le mois n'est pas terminé.",
      import_incomplet: "Pas de note : le relevé importé de ce mois est incomplet.",
      aucun_compte: "Pas de note : aucun compte n'est observé ce mois-ci.",
      sans_detail: "Pas de note : ce mois n'a pas de détail par sous-catégorie.",
      a_classer: "Pas de note : " + Math.round((part || 0) * 100) + " % de tes dépenses sont encore à classer. Classe d'abord ces opérations avec Claude.",
    };
    return t[raison] || "Pas de note.";
  }
  function texteScore(r) {
    const morceaux = [];
    if (r.termes.essentiels.points) morceaux.push("tes essentiels ont dépassé de " + euros(r.termes.essentiels.ecart) + " (−" + r.termes.essentiels.points + " points)");
    if (r.termes.envies.points) morceaux.push("tes envies ont dépassé de " + euros(r.termes.envies.ecart) + " (−" + r.termes.envies.points + " points)");
    if (r.termes.epargne.points) morceaux.push("ton épargne est " + euros(r.termes.epargne.ecart) + " sous ta cible (−" + r.termes.epargne.points + " points)");
    let corps;
    if (morceaux.length) {
      const phrase = morceaux.length > 1 ? morceaux.slice(0, -1).join(", ") + " et " + morceaux[morceaux.length - 1] : morceaux[0];
      corps = phrase.charAt(0).toUpperCase() + phrase.slice(1) + ".";
    } else if (r.phrase === "revenus_plus_bas") {
      corps = "Tes revenus étaient plus bas de " + euros(r.ecart_revenus) + " : ta cible d'épargne du mois baisse d'autant, et tu as tenu tes dépenses.";
    } else corps = "Tes dépenses sont à ta cible.";
    const mention = r.provisoire ? " Note provisoire : " + ({ revenus_incomplets: "les revenus du mois sont incomplets ou en retard, la note ne regarde que tes dépenses", a_classer: "une partie de tes opérations reste à classer",
      mois_en_partie_importe: "une partie du mois vient d'un import" }[r.raison_provisoire] || "elle peut encore bouger") + "." : "";
    const lisse = r.repere === "depense_annuelle_lissee" ? " Les dépenses annuelles sont lissées sur l'année." : "";
    return r.score + " · " + r.mot + ". " + corps + lisse + mention;
  }

  /* ================================================================== référence normalisée */
  /** Référence → { revenus, essentiels: Map, envies: Map, epargne: Map } (clés rangées dans leur bloc d'après la taxonomie et les préférences). */
  function normaliserReference(ref, preferences) {
    const r = ref || {}, out = { revenus: n0(r.revenus), essentiels: new Map(), envies: new Map(), epargne: new Map() };
    const range = (cle, m, bloc) => { const v = nombre(m); if (v !== null && v > 0) out[bloc].set(cle, v); };
    if (r.essentiels && typeof r.essentiels === "object" && !nombre(r.essentiels)) {
      for (const [k, m] of Object.entries(r.essentiels)) range(k, m, "essentiels");
      for (const [k, m] of Object.entries(r.envies || {})) range(k, m, "envies");
      for (const [k, m] of Object.entries(r.epargne || {})) range(k, m, "epargne");
    } else {
      for (const [k, m] of Object.entries(r.par_sous_categorie || {})) {
        const b = blocDe(k, preferences);
        if (b === "essentiels" || b === "envies" || b === "epargne") range(k, m, b);
      }
    }
    return out;
  }
  const trier = cles => [...cles].sort((a, b) => (ORDRE_TAXONOMIE.get(a) ?? 99) - (ORDRE_TAXONOMIE.get(b) ?? 99));
  const sommeMap = m => somme([...m.values()]);

  /* ================================================================== détections (§ 6.4) */
  const SORTIES_EXCLUES = ["virement_interne", "apport_commun", "transfert_foyer", "releve_carte", "epargne_precaution", "investissement", "projets", "salaires", "revenus_autres"];
  const FAMILLES_DOUBLON = ["video", "musique"];
  /** Mots de libellé qui ne désignent aucun payeur (« PRLV », « CB », « SEPA »…) : ignorés pour savoir si deux clés se recouvrent. */
  const MOTS_GENERIQUES = new Set(["prlv", "prelevement", "prelevements", "sepa", "cb", "carte", "vir", "virement", "paiement", "par", "de", "du", "la", "le", "les", "des", "facture", "pour", "et", "com", "fr"]);
  const MOTS_CARTE = ["card", "deferred_card", "summary_card"];
  const motsDe = t => String(t || "").split(" ").filter(Boolean);
  function contient(ts, seq) {
    if (!seq.length || seq.length > ts.length) return false;
    for (let i = 0; i + seq.length <= ts.length; i++) { let ok = true; for (let j = 0; j < seq.length; j++) if (ts[i + j] !== seq[j]) { ok = false; break; } if (ok) return true; }
    return false;
  }
  /** Famille d'un abonnement (vidéo, musique, presse, logiciel, sport…) d'après la table des marchands (suite de mots entière, la plus longue) ; null sinon. */
  function familleDe(cle) {
    const ts = motsDe(cle);
    let best = null;
    for (const e of BC.MARCHANDS) {
      if (!e.famille) continue;
      const seq = motsDe(e.motif);
      if (contient(ts, seq) && (!best || e.motif.length > best.motif.length)) best = e;
    }
    return best ? best.famille : null;
  }
  /** Mois complets (AAAA-MM) qui précèdent le mois de `aujourdhui`, du plus ancien au plus récent : `n` au plus. */
  function derniersMois(aujourdhui, n) {
    const cour = mois7(aujourdhui);
    const out = [];
    if (!cour) return out;
    for (let k = n; k >= 1; k--) out.push(decale(cour, -k));
    return out;
  }
  const lignesSorties = (data, comptes) => (Array.isArray(data && data.marchands) ? data.marchands : [])
    .filter(l => l && mois7(l.mois) && n0(l.sorties) > 0 && !SORTIES_EXCLUES.includes(l.sous_categorie) && (!comptes || comptes.includes(String(l.compte_id))));

  /** Récurrents (§ 6.4) : même clé de marchand, sorties seulement. Mensuel : présent dans 3 des 4 derniers mois complets (ou 5 des 6), montants à ±tolérance de la
      médiane ; annuel (§ 6.3) : une seule fois sur 12 mois, dans une sous-catégorie « annuelle probable » ou à partir du seuil, confirmé s'il revient 11 à 13 mois plus
      tôt (sinon « probable »). → [{ cle_marchand, sous_categorie, famille, rythme, montant_mensuel, montant, mois_presents, confirme }]. */
  function recurrentsMensuels(data, opts) {
    const o = opts || {}, reperes = data && data.reperes;
    const tol = convention(reperes, "budget_recurrent_tolerance_pct") / 100, seuil = convention(reperes, "budget_annuelle_seuil");
    const dernier = derniersMois(data.aujourdhui, 13);                 // 13 mois complets au plus
    const m4 = dernier.slice(-4), m6 = dernier.slice(-6), m12 = dernier.slice(-12);
    const groupes = new Map();
    for (const l of lignesSorties(data, o.comptes)) {
      const m = mois7(l.mois);
      if (!dernier.includes(m)) continue;
      const k = l.cle_marchand || "";
      if (!k) continue;
      if (!groupes.has(k)) groupes.set(k, { sous: new Map(), mois: new Map() });
      const g = groupes.get(k);
      g.mois.set(m, (g.mois.get(m) || 0) + n0(l.sorties) - n0(l.entrees));
      g.sous.set(l.sous_categorie, (g.sous.get(l.sous_categorie) || 0) + n0(l.sorties));
    }
    const out = [];
    for (const [cle, g] of groupes) {
      const montants = new Map([...g.mois].filter(([, v]) => v > 0));
      const sous = [...g.sous].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
      const dans = (liste) => liste.filter(m => montants.has(m));
      const stable = ms => { const v = ms.map(m => montants.get(m)), med = mediane(v); return med > 0 && v.every(x => Math.abs(x - med) <= med * tol + 1e-9); };
      const p4 = dans(m4), p6 = dans(m6);
      let rythme = null, presents = [];
      if (p4.length >= 3 && stable(p4)) { rythme = "mensuel"; presents = p4; }
      else if (p6.length >= 5 && stable(p6)) { rythme = "mensuel"; presents = p6; }
      if (rythme === "mensuel") {
        const montant = centieme(mediane(presents.map(m => montants.get(m))));
        out.push({ cle_marchand: cle, sous_categorie: sous, famille: familleDe(cle), rythme, montant_mensuel: montant, montant, mois_presents: presents, confirme: true });
        continue;
      }
      // annuel : une seule présence sur les 12 derniers mois
      const p12 = dans(m12);
      const taxo = BC.TAXONOMIE.find(t => t.cle === sous);
      if (p12.length === 1) {
        const m = p12[0], montant = montants.get(m);
        if (montant >= seuil || (taxo && taxo.annuelle_probable)) {
          const avant = [decale(m, -13), decale(m, -12), decale(m, -11)].filter(x => montants.has(x));
          const historique = dernier.includes(decale(m, -12)) || dernier.includes(decale(m, -13)) || dernier.includes(decale(m, -11));
          out.push({ cle_marchand: cle, sous_categorie: sous, famille: familleDe(cle), rythme: "annuel", montant_mensuel: centieme(montant / 12), montant: centieme(montant),
            mois_presents: [m], confirme: avant.length > 0 || false, historique_suffisant: historique });
        }
      }
    }
    return out.sort((a, b) => (a.cle_marchand < b.cle_marchand ? -1 : a.cle_marchand > b.cle_marchand ? 1 : 0));
  }

  /** Détections (§ 6.4). `data` : voir l'en-tête ; `opts` : { comptes: [id] } (seuls ces comptes comptent). */
  function detections(data, opts) {
    const o = opts || {}, reperes = data && data.reperes;
    const rec = recurrentsMensuels(data, o);
    // doublons possibles
    const doublons = [];
    const assurances = rec.filter(r => r.sous_categorie === "assurances");
    const clesDe = r => new Set(motsDe(r.cle_marchand).filter(m => !MOTS_GENERIQUES.has(m)));
    const sansRecouvrement = (a, b) => { const A = clesDe(a); return ![...clesDe(b)].some(m => A.has(m)); };
    if (assurances.length >= 2) {
      const paires = [];
      for (let i = 0; i < assurances.length; i++) for (let j = i + 1; j < assurances.length; j++) if (sansRecouvrement(assurances[i], assurances[j])) paires.push([assurances[i], assurances[j]]);
      if (paires.length) {
        const concernes = [...new Set(paires.flat().map(r => r.cle_marchand))];
        const lignes = rec.filter(r => concernes.includes(r.cle_marchand));
        doublons.push({ type: "assurances", famille: null, cles_marchand: concernes.sort(), montant_mensuel_min: Math.min(...lignes.map(r => r.montant_mensuel)) });
      }
    }
    for (const fam of FAMILLES_DOUBLON) {
      const l = rec.filter(r => r.sous_categorie === "abonnements" && r.famille === fam);
      if (l.length >= 2) doublons.push({ type: "abonnements", famille: fam, cles_marchand: l.map(r => r.cle_marchand).sort(), montant_mensuel_min: Math.min(...l.map(r => r.montant_mensuel)) });
    }
    // frais bancaires sur 12 mois
    const m12 = derniersMois(data.aujourdhui, 12);
    const fr = lignesSorties(data, o.comptes).filter(l => l.sous_categorie === "frais_bancaires" && m12.includes(mois7(l.mois)));
    const frais = { total_12_mois: centieme(somme(fr.map(l => n0(l.sorties) - n0(l.entrees)))), commissions: somme(fr.map(l => n0(l.nombre))), mois: [...new Set(fr.map(l => mois7(l.mois)))].length };
    // petits achats récurrents
    const seuilPA = convention(reperes, "budget_piste_petit_achat_seuil"), nbPA = convention(reperes, "budget_piste_petits_achats_nombre");
    const protegees = new Set((data.preferences && data.preferences.protegees) || []);
    const ops = (Array.isArray(data.operations) ? data.operations : []).filter(x => x && n0(x.montant) < 0 && -n0(x.montant) < seuilPA
      && ["restaurants", "shopping", "loisirs"].includes(x.sous_categorie) && !protegees.has(x.sous_categorie) && (!o.comptes || o.comptes.includes(String(x.compte_id)))
      && (MOTS_CARTE.includes(String(x.type_powens || "").toLowerCase()) || motsDe(String(x.libelle || "").toLowerCase().replace(/[^a-z]+/g, " ").trim())[0] === "cb"));
    const moisOps = Math.max(1, nombre(data.mois_detail) || 3);
    const petits = { nombre: ops.length, par_mois: centieme(ops.length / moisOps), total_mensuel: centieme(somme(ops.map(x => -n0(x.montant))) / moisOps), seuil: seuilPA, recurrent: ops.length / moisOps > nbPA };
    // énergie
    const en = lignesSorties(data, o.comptes).filter(l => l.sous_categorie === "energie" && m12.includes(mois7(l.mois)));
    const parMois = {};
    for (const l of en) parMois[mois7(l.mois)] = centieme((parMois[mois7(l.mois)] || 0) + n0(l.sorties) - n0(l.entrees));
    const valeurs = Object.entries(parMois);
    const energie = { total_12_mois: centieme(somme(valeurs.map(([, v]) => v))), par_mois: parMois,
      plus_cher: valeurs.length ? valeurs.slice().sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0] : null,
      moins_cher: valeurs.length ? valeurs.slice().sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))[0][0] : null };
    return { recurrents: rec, doublons, frais, petits_achats: petits, energie, fragilite: fragilite(data, o) };
  }

  /** Signaux de fragilité (§ 6.4) : solde d'un courant négatif plus de 5 jours dans le mois sur 2 des 3 derniers mois, agios ou commissions d'intervention
      récurrents, crédit renouvelable, capacité négative 3 mois de suite. Aucun signal ne dit « mal » : il oriente (étape 4 de l'expertise). */
  function fragilite(data, opts) {
    const o = opts || {};
    const m3 = derniersMois(data.aujourdhui, 3);
    // solde du jour reconstitué à rebours à partir du solde actuel, pour chaque courant suivi
    const comptes = (Array.isArray(data.comptes) ? data.comptes : []).filter(c => c && c.type === "courant" && nombre(c.solde) !== null && (!o.comptes || o.comptes.includes(String(c.id))));
    const joursNegatifs = new Map(m3.map(m => [m, 0]));
    const ops = Array.isArray(data.operations) ? data.operations : [];
    const jourDe = d => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);
    const hier = d => new Date(Date.parse(d + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
    for (const c of comptes) {
      const mvts = new Map();
      for (const x of ops) if (String(x.compte_id) === String(c.id) && jourDe(x.date)) mvts.set(jourDe(x.date), (mvts.get(jourDe(x.date)) || 0) + n0(x.montant));
      // fin de journée d'aujourd'hui = solde actuel ; la veille = solde − mouvements du jour ; sans mouvement connu, le solde ne bouge pas jusqu'au début de la
      // fenêtre de détail (90 jours)
      let solde = nombre(c.solde), d = jourDe(data.aujourdhui);
      if (!d) continue;
      const debut = new Date(Date.parse(d + "T12:00:00Z") - 90 * 864e5).toISOString().slice(0, 10);
      for (; d >= debut; d = hier(d)) {
        const m = mois7(d);
        if (solde < 0 && joursNegatifs.has(m)) joursNegatifs.set(m, joursNegatifs.get(m) + 1);
        solde -= mvts.get(d) || 0;
      }
    }
    const moisNegatifs = m3.filter(m => joursNegatifs.get(m) > 5);
    const decouvert = moisNegatifs.length >= 2;
    const mf = (Array.isArray(data.marchands) ? data.marchands : []).filter(l => l && l.sous_categorie === "frais_bancaires" && m3.includes(mois7(l.mois)) && n0(l.sorties) > 0
      && /\b(agios?|commission intervention|interv)\b/.test(String(l.cle_marchand || "")));
    const agios = [...new Set(mf.map(l => mois7(l.mois)))].length >= 2;
    const renouvelable = (Array.isArray(data.comptes) ? data.comptes : []).some(c => c && c.pret && /revolving/i.test(String(c.pret.type || "")));
    const caps = (Array.isArray(data.mois) ? data.mois : []).filter(x => x && mois7(x.mois)).sort((a, b) => (mois7(a.mois) < mois7(b.mois) ? -1 : 1)).slice(-3);
    const capacite = caps.length === 3 && caps.every(x => n0(x.capacite) < 0) && caps.every((x, i) => i === 0 || mois7(x.mois) === decale(mois7(caps[i - 1].mois), 1));
    return { decouvert, jours_negatifs: Object.fromEntries(joursNegatifs), agios, renouvelable, capacite_negative: capacite, fragile: decouvert || agios || renouvelable || capacite };
  }

  /* ================================================================== pistes (§ 8.2) */
  const DIFFICULTES = ["facile", "moyen", "vrai_changement"];
  const rang = d => DIFFICULTES.indexOf(d);
  /** Pistes d'économie, déterministes, triées par difficulté puis par économie. Chaque piste : { cle, poste, titre, pourquoi, economie_mensuelle: { min, max, retenue },
      difficulte, question, donnees: { cles_marchand, montant_annuel, nombre }, source }. La fourchette est celle de la convention : égale au montant pour une économie
      qui vient d'une ligne précise (abonnement, doublon, frais), de la moitié à une fois et demie la retenue pour une économie estimée en pourcentage. */
  function pistes(data, opts) {
    const o = opts || {}, reperes = data && data.reperes;
    const prefs = data.preferences || {};
    const protegees = new Set(Array.isArray(prefs.protegees) ? prefs.protegees : []);
    const ref = normaliserReference(data.reference, prefs);
    const det = detections(data, o);
    const liste = [];
    const ajoute = p => { if (!protegees.has(p.poste)) liste.push(p); };
    const fourchette = r => ({ min: arrondi(r / 2), max: arrondi(r * 1.5), retenue: r });
    const exacte = r => ({ min: r, max: r, retenue: r });
    const SOURCE = "Calcul de Boussole sur tes relevés (convention, pas une promesse)";
    // 1. abonnement que tu n'utilises plus (réponse au questionnaire)
    const inutilises = new Set(Array.isArray(prefs.abonnements_inutilises) ? prefs.abonnements_inutilises : []);
    const abos = det.recurrents.filter(r => inutilises.has(r.cle_marchand) && r.sous_categorie === "abonnements");
    if (abos.length) {
      const r = arrondi(somme(abos.map(a => a.montant_mensuel)));
      if (r > 0) ajoute({ cle: "abonnement_inutilise", poste: "abonnements", titre: abos.length > 1 ? "Des abonnements que tu n'utilises plus" : "Un abonnement que tu n'utilises plus",
        pourquoi: "Tu as dit ne plus l'utiliser ; il revient chaque mois.", economie_mensuelle: exacte(r), difficulte: "facile", question: "Veux-tu le résilier ou le mettre en pause ?",
        donnees: { cles_marchand: abos.map(a => a.cle_marchand), montant_annuel: centieme(r * 12), nombre: abos.length }, source: SOURCE });
    }
    // 2. doublons de même famille
    for (const d of det.doublons.filter(x => x.type === "abonnements")) {
      const r = arrondi(d.montant_mensuel_min);
      if (r > 0) ajoute({ cle: "doublon_abonnements_" + d.famille, poste: "abonnements", titre: "Deux abonnements de la même famille (" + ({ video: "vidéo", musique: "musique" }[d.famille] || d.famille) + ")",
        pourquoi: "Deux paiements récurrents semblent faire le même usage.", economie_mensuelle: exacte(r), difficulte: "facile", question: "Utilises-tu vraiment les deux ?",
        donnees: { cles_marchand: d.cles_marchand, montant_annuel: centieme(r * 12), nombre: d.cles_marchand.length }, source: SOURCE });
    }
    // 3. frais bancaires
    const laissee = convention(reperes, "budget_piste_frais_cotisation_laissee");
    if (det.frais.mois > 0) {
      const r = arrondi(det.frais.total_12_mois / 12 - laissee);
      if (r > 0) ajoute({ cle: "frais_bancaires", poste: "frais_bancaires", titre: "Des frais bancaires à regarder",
        pourquoi: "Tes frais bancaires font " + euros(det.frais.total_12_mois) + " sur 12 mois (" + det.frais.commissions + " opération" + (det.frais.commissions > 1 ? "s" : "") + "), dont une cotisation de " + euros(laissee) + " par mois laissée.",
        economie_mensuelle: exacte(r), difficulte: "facile", question: "Veux-tu qu'on regarde ensemble ce que ton offre comprend, et tes droits (plafonds de commissions) ?",
        donnees: { cles_marchand: [], montant_annuel: det.frais.total_12_mois, nombre: det.frais.commissions }, source: SOURCE });
    }
    // 4. assurances en double possible
    for (const d of det.doublons.filter(x => x.type === "assurances")) {
      const r = arrondi(d.montant_mensuel_min);
      if (r > 0) ajoute({ cle: "assurances_en_double", poste: "assurances", titre: "Des assurances qui font peut-être double emploi",
        pourquoi: "Plusieurs assurances reviennent chaque mois sans lien visible entre elles : c'est à vérifier sur tes contrats, rien n'est affirmé.",
        economie_mensuelle: exacte(r), difficulte: "moyen", question: "Peux-tu relire tes garanties pour voir si deux contrats couvrent la même chose ?",
        donnees: { cles_marchand: d.cles_marchand, montant_annuel: centieme(r * 12), nombre: d.cles_marchand.length }, source: SOURCE });
    }
    // 5. revoir les contrats : assurances, énergie, télécoms (trois pistes distinctes)
    const pct = convention(reperes, "budget_piste_contrats_pct") / 100;
    for (const cle of ["assurances", "energie", "telecom"]) {
      const m = ref.essentiels.get(cle) || 0;
      const r = arrondi(m * pct);
      if (r > 0) ajoute({ cle: "contrats_" + cle, poste: cle, titre: { assurances: "Revoir tes contrats d'assurance", energie: "Revoir tes contrats d'énergie", telecom: "Revoir ton forfait internet et mobile" }[cle],
        pourquoi: "Un contrat se renégocie ou se revoit sans changer d'usage (garanties, franchises, engagement, prix après promotion).", economie_mensuelle: fourchette(r), difficulte: "moyen",
        question: "Veux-tu qu'on compare tes garanties actuelles à ce dont tu as besoin ?", donnees: { cles_marchand: det.recurrents.filter(x => x.sous_categorie === cle).map(x => x.cle_marchand), montant_annuel: centieme(m * 12), nombre: 1 }, source: SOURCE });
    }
    // 6. envies modulables (hors protégées, hors abonnements)
    const modulables = trier(ref.envies.keys()).filter(k => !protegees.has(k) && k !== "abonnements");
    const base = somme(modulables.map(k => ref.envies.get(k)));
    const pe = convention(reperes, "budget_piste_envies_pct") / 100, pf = convention(reperes, "budget_piste_envies_fort_pct") / 100;
    const r10 = arrondi(base * pe), r25 = arrondi(base * pf);
    if (r10 > 0) liste.push({ cle: "envies_modulables", poste: "envies", titre: "Un peu moins sur les envies que tu gardes modulables", pourquoi: "Sans toucher à ce que tu protèges ni à tes abonnements.",
      economie_mensuelle: fourchette(r10), difficulte: "moyen", question: "Quelles envies te tiennent le moins à cœur ce trimestre ?", donnees: { cles_marchand: [], montant_annuel: centieme(base * 12), nombre: modulables.length }, source: SOURCE, sous_categories: modulables });
    if (r25 > 0) liste.push({ cle: "envies_modulables_fort", poste: "envies", titre: "Un vrai changement sur les envies modulables", pourquoi: "Un effort plus marqué, à choisir en connaissance de cause.",
      economie_mensuelle: fourchette(r25), difficulte: "vrai_changement", question: "Est-ce un effort que tu veux faire pour atteindre tes objectifs plus tôt ?", donnees: { cles_marchand: [], montant_annuel: centieme(base * 12), nombre: modulables.length }, source: SOURCE, sous_categories: modulables });
    // 7. petits achats récurrents
    if (det.petits_achats.recurrent) {
      const r = arrondi(det.petits_achats.total_mensuel * convention(reperes, "budget_piste_petits_achats_pct") / 100);
      if (r > 0) liste.push({ cle: "petits_achats", poste: "envies", titre: "Les petits achats de carte qui s'additionnent", pourquoi: "Plus de " + convention(reperes, "budget_piste_petits_achats_nombre") + " achats de moins de " + euros(det.petits_achats.seuil) + " par mois en moyenne.",
        economie_mensuelle: fourchette(r), difficulte: "moyen", question: "Y a-t-il des habitudes que tu veux garder, et d'autres que tu lâcherais sans regret ?",
        donnees: { cles_marchand: [], montant_annuel: centieme(det.petits_achats.total_mensuel * 12), nombre: det.petits_achats.nombre }, source: SOURCE });
    }
    // 8. le récurrent (§ 6.5) : hausse de prix, abonnement arrêté mais prélevé ailleurs, habitude en hausse
    const rec = recurrentsVue(data, { vue: o.vue, personne: o.personne });
    if (rec.disponible) {
      const lignes = rec.recurrents.filter(r => !Array.isArray(o.comptes) || o.comptes.includes(String(r.compte_id)));
      for (const r of lignes.filter(x => x.hausse && x.famille !== "habitude")) {
        const e = arrondi(r.hausse.nouveau - r.hausse.ancien);
        if (e > 0) ajoute({ cle: "hausse_prix_" + r.compte_id + "_" + r.cle_marchand, poste: r.sous_categorie,
          titre: r.famille === "abonnement" ? "Un abonnement a augmenté" : "Un contrat a augmenté",
          pourquoi: "Son prix est passé de " + prix(r.hausse.ancien) + " à " + prix(r.hausse.nouveau) + " depuis " + moisFr(r.hausse.depuis) + ".",
          economie_mensuelle: exacte(e), difficulte: r.famille === "abonnement" ? "facile" : "moyen",
          question: "Veux-tu le renégocier, ou regarder tes droits de résiliation (vérifiés sur ton contrat) ?",
          donnees: { cles_marchand: [r.cle_marchand], montant_annuel: centieme((r.hausse.nouveau - r.hausse.ancien) * 12), nombre: 1 }, source: SOURCE });
      }
      for (const r of lignes.filter(x => x.famille === "abonnement" && x.statuts.includes("arrete"))) {
        const autre = lignes.find(x => x.cle_marchand === r.cle_marchand && String(x.compte_id) !== String(r.compte_id) && x.famille !== "habitude" && !x.statuts.includes("arrete"));
        const e = autre ? arrondi(autre.montant_habituel) : 0;
        if (e > 0) ajoute({ cle: "abonnement_arrete_ailleurs_" + r.cle_marchand, poste: r.sous_categorie, titre: "Un abonnement qui passe encore sur un autre compte",
          pourquoi: "Il ne passe plus sur l'un de tes comptes (arrêté ?), mais il est prélevé " + prix(autre.montant_habituel) + " par mois sur un autre.",
          economie_mensuelle: exacte(e), difficulte: "facile", question: "Est-ce le même abonnement qui a changé de compte, et le veux-tu encore ?",
          donnees: { cles_marchand: [r.cle_marchand], montant_annuel: centieme(autre.montant_habituel * 12), nombre: 2 }, source: SOURCE });
      }
      const seuilHabitude = convention(reperes, "budget_piste_habitude_tendance_pct");
      for (const r of lignes.filter(x => x.famille === "habitude" && x.tendance !== null && x.tendance > seuilHabitude + 1e-9)) {
        const e = arrondi(r.total_mensuel * r.tendance / (100 + r.tendance));
        if (e > 0) ajoute({ cle: "habitude_en_hausse_" + r.compte_id + "_" + r.cle_marchand, poste: r.sous_categorie, titre: "Une habitude qui prend de la place",
          pourquoi: "Elle pèse " + prix(r.total_mensuel) + " par mois, " + String(r.tendance).replace(".", ",") + " % de plus que les trois mois d'avant.",
          economie_mensuelle: fourchette(e), difficulte: "moyen", question: "Veux-tu la garder au même rythme, ou en changer un peu ?",
          donnees: { cles_marchand: [r.cle_marchand], montant_annuel: centieme(r.total_mensuel * 12), nombre: Math.round(r.frequence) }, source: SOURCE });
      }
    }
    // logement et voiture : jamais chiffrés par Boussole (le coach en parle si tu le demandes)
    return liste.sort((a, b) => rang(a.difficulte) - rang(b.difficulte) || b.economie_mensuelle.retenue - a.economie_mensuelle.retenue || (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
  }

  /* ================================================================== plancher et repères Insee (§ 8.3, T4, T5) */
  /** Repère du reste à vivre minimal du foyer (RSA forfaitaire) : { repere, valeur } d'après sa composition ({ adultes, enfants }), null si le repère manque. */
  function plancherResteAVivre(foyer, reperes) {
    const f = foyer || {}, adultes = Math.max(1, Math.trunc(n0(f.adultes) || 1)), enfants = Math.max(0, Math.trunc(n0(f.enfants)));
    const val = cle => { const r = (Array.isArray(reperes) ? reperes : []).find(x => x && x.cle === cle); const v = r && nombre(r.valeur); return v === null || v === undefined ? null : v; };
    const jusque2 = Math.min(enfants, 2);
    const cle = (adultes === 1 ? "rsa_forfaitaire_seul" : "rsa_forfaitaire_couple") + (jusque2 ? "_" + jusque2 + (jusque2 > 1 ? "_enfants" : "_enfant") : "");
    const base = val(cle);
    if (base === null) return null;
    const plus = Math.max(0, enfants - 2), supp = val("rsa_forfaitaire_personne_supplementaire");
    if (plus > 0 && supp === null) return null;
    return { repere: cle, valeur: centieme(base + plus * (supp || 0)), personnes_en_plus: plus };
  }
  /** Part du logement (loyer, charges, énergie) dans la consommation (essentiels + envies, hors crédits et impôts) comparée au repère Insee 2017 du ménage (T5) ;
      « au-dessus du repère » n'est jamais une contrainte. `opts` : { logement: "locataire" | "proprietaire", menage: "personne_seule" | … }. */
  function comparerInsee(reference, reperes, opts) {
    const o = opts || {}, ref = normaliserReference(reference, o.preferences);
    const g = (m, k) => m.get(k) || 0;
    const logement = g(ref.essentiels, "loyer") + g(ref.essentiels, "charges_logement") + g(ref.essentiels, "energie");
    const conso = sommeMap(ref.essentiels) + sommeMap(ref.envies) - g(ref.essentiels, "autres_credits") - g(ref.essentiels, "credit_logement") - g(ref.essentiels, "impots");
    if (!(conso > 0)) return null;
    const part = dixieme(logement / conso * 100);
    const cle = o.logement === "proprietaire" ? "insee_bdf2017_logement_proprietaires" : o.logement === "locataire" ? "insee_bdf2017_logement_locataires"
      : "insee_bdf2017_logement_" + (o.menage || "ensemble");
    const val = k => { const r = (Array.isArray(reperes) ? reperes : []).find(x => x && x.cle === k); return r ? nombre(r.valeur) : null; };
    const v = val(cle);
    if (v === null) return null;
    const bornes = o.logement === "locataire" ? [v, val("insee_bdf2017_logement_locataires_q1"), val("insee_bdf2017_logement_locataires_q5")].filter(x => x !== null) : [v];
    const bas = Math.min(...bornes), haut = Math.max(...bornes);
    const lecture = part > haut + 1e-9 ? "au_dessus_du_repere" : part < bas - 1e-9 ? "sous_le_repere" : "dans_le_repere";
    return { logement: arrondi(logement), consommation: arrondi(conso), part, repere: cle, repere_valeur: v, fourchette: bornes.length > 1 ? [bas, haut] : null, lecture,
      texte: "Ton logement pèse " + String(part).replace(".", ",") + " % de ta consommation, contre " + String(v).replace(".", ",") + " % en moyenne" +
        ({ locataire: " pour les locataires", proprietaire: " pour les propriétaires" }[o.logement] || "") + " (Insee, enquête 2017) : " +
        ({ au_dessus_du_repere: "au-dessus de ce repère", sous_le_repere: "sous ce repère", dans_le_repere: "dans ce repère" })[lecture] + ". C'est un point de comparaison, jamais une contrainte." };
  }

  /* ================================================================== cible proposée (§ 8.3) */
  const LEVIERS = ["repousser_date", "baisser_montant", "accepter_moins_de_chances", "revenus"];
  /** Répartition d'un total entre des clés au prorata de leurs références, en euros entiers par la méthode du plus fort reste : planchers, puis +1 € aux plus
      forts restes, à reste égal selon l'ordre de la taxonomie. La somme est exacte. */
  function repartir(total, refs) {
    const cles = trier(refs.keys()), base = somme(cles.map(k => refs.get(k)));
    const out = new Map();
    if (!cles.length) return out;
    if (!(base > 0)) { cles.forEach(k => out.set(k, 0)); return out; }
    const bruts = cles.map(k => ({ k, x: total * refs.get(k) / base }));
    bruts.forEach(b => out.set(b.k, Math.floor(b.x + 1e-9)));
    let reste = Math.round(total) - somme(cles.map(k => out.get(k)));
    const ordre = bruts.map((b, i) => ({ ...b, i, f: b.x - Math.floor(b.x + 1e-9) })).sort((a, b) => (Math.abs(a.f - b.f) < 1e-9 ? a.i - b.i : b.f - a.f));
    for (let j = 0; j < ordre.length && reste > 0; j++, reste--) out.set(ordre[j].k, out.get(ordre[j].k) + 1);
    return out;
  }
  const tauxPct = (m, R) => (R > 0 ? dixieme(m / R * 100) : 0);
  /** Options et cible proposée. `entree` : { reference, capacite_constatee, epargne_necessaire (ou null), matelas_mensuel, pistes, protegees, choix_pistes?, niveau?,
      plancher?: { repere, valeur }, preferences?, reperes?, objectifs?, evaluer?: (épargne mensuelle) → [{ id, probabilite_avant, probabilite_apres }] }.
      → { options: { tenable, equilibree, ambitieuse }, necessaire, retenue, niveau, cible, controles, limite_par_plancher, orientation, atteignable_8_sur_10, leviers, couverture }.
      Contrôles bloquants : controles.somme, controles.protegees, controles.plancher et montants_positifs (aucun bloc ni sous-catégorie négatif : sinon la base refuse
      la cible) ; controles.essentiels_90 est un garde-fou affiché. */
  function proposerCible(data, entree) {
    const e = entree || {}, d = data || {};
    const prefs = e.preferences || d.preferences || {}, reperes = e.reperes || d.reperes;
    const protegees = new Set(Array.isArray(e.protegees) ? e.protegees : Array.isArray(prefs.protegees) ? prefs.protegees : []);
    const ref = normaliserReference(e.reference || d.reference, prefs);
    const R = ref.revenus;
    const C = nombre(e.capacite_constatee) !== null ? e.capacite_constatee : R - sommeMap(ref.essentiels) - sommeMap(ref.envies);
    const N = nombre(e.epargne_necessaire);
    const matelas = n0(e.matelas_mensuel);
    const choix = Array.isArray(e.choix_pistes) ? new Set(e.choix_pistes) : null;
    const toutes = (Array.isArray(e.pistes) ? e.pistes : []).filter(p => p && (p.economie_mensuelle || nombre(p.retenue) !== null) && !protegees.has(p.poste) && (!choix || choix.has(p.cle)));
    const val = p => arrondi(n0(p.economie_mensuelle ? p.economie_mensuelle.retenue : p.retenue));
    const envMod = p => p.cle === "envies_modulables", envFort = p => p.cle === "envies_modulables_fort";
    const faciles = toutes.filter(p => p.difficulte === "facile"), moyennes = toutes.filter(p => p.difficulte === "moyen");
    const hors = moyennes.filter(p => !envMod(p)), fort = toutes.find(envFort), moyenne10 = moyennes.find(envMod);
    const tenable = C + somme(faciles.map(val));
    const equilibree = tenable + somme(moyennes.map(val));
    const ambitieuse = tenable + somme(hors.map(val)) + (fort ? val(fort) : moyenne10 ? val(moyenne10) : 0);
    const options = { tenable: montantOption(tenable, R, "léger"), equilibree: montantOption(equilibree, R, "moyen"), ambitieuse: montantOption(ambitieuse, R, "soutenu") };
    const necessaire = N === null ? null : N + matelas;
    // montant retenu
    let niveau, S;
    if (e.niveau === "tenable" || e.niveau === "equilibree" || e.niveau === "ambitieuse") { niveau = e.niveau; S = { tenable, equilibree, ambitieuse }[niveau]; }
    else if (e.niveau === "necessaire" && necessaire !== null) { niveau = "necessaire"; S = Math.max(tenable, Math.min(necessaire, ambitieuse)); }
    else if (necessaire === null) { niveau = "equilibree"; S = equilibree; }
    else {
      S = Math.max(tenable, Math.min(necessaire, ambitieuse));
      niveau = necessaire >= ambitieuse ? "ambitieuse" : necessaire <= tenable ? "tenable" : "necessaire";
    }
    S = arrondi(S);
    // plancher de reste à vivre
    const plancher = e.plancher && nombre(e.plancher.valeur) !== null ? e.plancher : null;
    let limite = false;
    if (plancher && R - S < plancher.valeur) { S = Math.max(0, Math.floor(R - plancher.valeur + 1e-9)); limite = true; niveau = "personnalisee"; }
    // répartition de l'écart par rapport à la référence : faciles, autres moyennes (contrats…), puis le complément sur les envies modulables
    const refEss = ref.essentiels, refEnv = ref.envies;
    const Cref = R - sommeMap(refEss) - sommeMap(refEnv);
    let reste = S - Cref;
    const prises = [], reductions = new Map();
    let poolEnvies = 0;   // part des économies qui vient des envies modulables (pistes sur « envies » en général, puis le complément)
    const prend = p => {
      const v = Math.min(val(p), Math.max(0, reste));
      if (v <= 0) return;
      prises.push({ cle: p.cle, poste: p.poste, montant: v });
      if (p.poste === "envies") poolEnvies += v; else reductions.set(p.poste, (reductions.get(p.poste) || 0) + v);
      reste -= v;
    };
    faciles.forEach(prend);
    hors.filter(p => p.poste !== "envies").forEach(prend);
    hors.filter(p => p.poste === "envies").forEach(prend);
    const couverture = { faciles: somme(prises.filter(x => faciles.some(p => p.cle === x.cle)).map(x => x.montant)), contrats: somme(prises.filter(x => hors.some(p => p.cle === x.cle)).map(x => x.montant)) };
    const plafondEnvies = fort ? val(fort) : moyenne10 ? val(moyenne10) : 0;
    const complement = poolEnvies + (reste >= 0 ? Math.min(reste, plafondEnvies || reste) : reste);
    couverture.envies = Math.max(0, complement);
    // sous-catégories finales
    const sous = new Map();
    for (const k of trier(refEss.keys())) sous.set(k, refEss.get(k) - (reductions.get(k) || 0));
    for (const k of trier(refEnv.keys())) if (k !== "envies") sous.set(k, refEnv.get(k) - (reductions.get(k) || 0));
    const modulables = trier(refEnv.keys()).filter(k => !protegees.has(k) && k !== "abonnements");
    const poolRefs = new Map(modulables.map(k => [k, refEnv.get(k)]));
    if (modulables.length && complement !== 0) {
      const finalPool = somme(modulables.map(k => poolRefs.get(k))) - complement;
      const rep = repartir(Math.max(0, finalPool), poolRefs);
      for (const k of modulables) sous.set(k, rep.get(k));
    }
    // arrondi des sous-catégories réduites par piste (entiers)
    for (const [k, v] of sous) sous.set(k, arrondi(v));
    const Ess = somme([...refEss.keys()].map(k => sous.get(k))), EnvSous = somme([...refEnv.keys()].map(k => sous.get(k)));
    const Env = R - Ess - S;
    const sousObj = {};
    for (const k of trier(sous.keys())) sousObj[k] = sous.get(k);
    // contrôles
    const plancherEss = convention(reperes, "budget_essentiel_plancher_pct") / 100;
    const controles = {
      somme: Math.abs(Ess + Env + S - R) <= 1 && Math.abs(Ess + EnvSous - (R - S)) <= 1,
      protegees: [...protegees].every(k => !sous.has(k) || sous.get(k) >= (refEss.get(k) ?? refEnv.get(k) ?? 0) - 1e-9),
      plancher: !plancher || (R - S) >= plancher.valeur - 1e-9,
      essentiels_90: [...refEss.keys()].every(k => sous.get(k) >= plancherEss * refEss.get(k) - 1e-9 || prises.some(x => x.poste === k)),
    };
    // bloquant (hors `controles`, dont la forme est celle de la fixture) : une cible n'a jamais de bloc ni de sous-catégorie négatifs (la base les refuse) ;
    // faux quand la capacité constatée est négative ou que les essentiels de référence dépassent les revenus moins l'épargne : la fragilité passe avant la cible
    // (étape 4 de l'expertise), rien n'est à proposer tel quel
    const montantsPositifs = S >= 0 && Ess >= -1e-9 && Env >= -1e-9 && [...sous.values()].every(v => v >= 0);
    const atteignable = necessaire === null ? null : S >= necessaire - 1e-9;
    const cible = { revenus_ref: R, blocs: { essentiels: Ess, envies: Env, epargne: S }, sous_categories: sousObj, protegees: [...protegees], niveau,
      taux_epargne: R > 0 ? centieme(S / R * 100) : 0, source: "Proposée par Claude à partir de tes relevés et de tes objectifs", version_taxonomie: BC.VERSION_TAXONOMIE };
    if (typeof e.evaluer === "function") cible.objectifs = e.evaluer(S);
    else if (Array.isArray(e.objectifs)) cible.objectifs = e.objectifs;
    return { options, necessaire, retenue: S, niveau, taux: cible.taux_epargne, cible, blocs: cible.blocs, sous_categories: sousObj, controles, montants_positifs: montantsPositifs, couverture,
      limite_par_plancher: limite, orientation: limite, atteignable_8_sur_10: atteignable, leviers: atteignable === false ? LEVIERS.slice() : [], pistes_retenues: prises,
      capacite_taux: R > 0 ? dixieme(C / R * 100) : 0 };
  }
  function montantOption(m, R, effort) { return { montant: arrondi(m), taux: tauxPct(arrondi(m), R), effort }; }

  /* ================================================================== le moteur du mois (tâche 7, § 5 et § 6) */
  const r6 = x => (Math.round(x * 1e6) / 1e6) || 0;
  const sansAccent = s => String(s == null ? "" : s).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const jourDe = d => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : d instanceof Date && isFinite(d) ? d.toISOString().slice(0, 10) : null);
  const COMPTES_BUDGET = ["courant", "joint"];
  const HORS_BUDGET_CLES = ["virement_interne", "apport_commun", "transfert_foyer", "releve_carte"];
  /** Part de p1 dans le commun (config.partage : égal, apports ou fixe → toujours `p1`, 0,5 par défaut). */
  function partageDe(config) {
    const p = config && typeof config.partage === "object" && config.partage ? config.partage : {};
    const p1 = nombre(p.p1);
    return { mode: p.mode === "apports" || p.mode === "fixe" ? p.mode : "egal", p1: p1 !== null && p1 >= 0 && p1 <= 1 ? p1 : 0.5 };
  }
  /** Mois bancaires lus par l'app → données du moteur. `S` : le store (banque, relevesBancaires, config, savoir…) ; `opts.aujourdhui` : date du jour (AAAA-MM-JJ).
      Les mois viennent de `Calc.moisBancaires` (Powens et relevés importés de HIS2, jamais les deux pour un compte et un mois) ; ne restent que les comptes du budget
      (courant ou joint, ni ignoré ni en double, actif) et les cartes à débit différé importées que moisBancaires retient. Un mois importé `complet: false` n'entre jamais
      au budget (il est listé dans `incomplets`, ce qui rend le mois « sans note »).
      → { aujourdhui, comptes: [{ id, libelle, type, titulaire, origine, solde? }], releves: [{ compte, mois, source, categories: [{ sous, categorie, entrees, sorties, nombre,
      sans_detail }], ecarte }], incomplets: [{ compte, mois }], ecartes, partage, preferences, regles, cible, reperes, marchands, operations, mois, reference }. */
  function donnees(S, opts) {
    const o = opts || {}, s = S || {}, Calc = D.Calc;
    const aujourdhui = jourDe(o.aujourdhui) || jourDe(s.aujourdhui) || jourDe(s.today) || new Date().toISOString().slice(0, 10);
    const banque = s.banque && typeof s.banque === "object" ? s.banque : null;
    const b = banque && banque.actif !== false ? banque : { mois: [], comptes: [] };
    const hist = s.relevesBancaires && typeof s.relevesBancaires === "object" ? s.relevesBancaires : null;
    const serie = Calc.moisBancaires(b, hist, aujourdhui);
    const doublon = c => (c.doublonDe !== undefined ? c.doublonDe : c.doublon_de);
    const powens = new Map((Array.isArray(b.comptes) ? b.comptes : []).filter(c => c && c.id != null).map(c => [String(c.id), c]));
    const importes = new Map((hist && Array.isArray(hist.comptes) ? hist.comptes : []).filter(Boolean).map(c => [String(c.id), c]));
    const rattaches = new Map([...importes.values()].filter(c => (c.banqueCompteId ?? c.banque_compte_id) != null).map(c => [String(c.banqueCompteId ?? c.banque_compte_id), c]));
    const detaille = new Set(serie.filter(e => e.compte != null).map(e => e.mois));
    const comptes = new Map(), releves = [], incomplets = [], ecartes = [];
    for (const e of serie) {
      if (e.compte == null && detaille.has(e.mois)) continue;   // totaux par utilisateur d'un mois détaillé par compte : écartés (comme Calc.moisCourants)
      const cle = e.compte == null ? "tous" : String(e.compte);
      const h = cle.startsWith("h:") ? importes.get(cle.slice(2)) : rattaches.get(cle), p = powens.get(cle);
      const type = e.type || (p && p.type) || (h && h.type) || "courant";
      if (!COMPTES_BUDGET.includes(type) && type !== "carte_differe") continue;
      if (p && (p.ignore === true || doublon(p) != null || p.actif === false)) continue;
      if (e.ecarte && e.ecarte.length) for (const x of e.ecarte) ecartes.push({ compte: cle, mois: e.mois, ...x });
      if (e.source !== null && comptes.has(cle)) delete comptes.get(cle).ecartee;
      if (!comptes.has(cle)) {
        const titulaire = (p && p.titulaire) || (h && h.titulaire) || null;
        const c = { id: cle, libelle: (p && (p.nom || p.libelle)) || (h && h.libelle) || (cle === "tous" ? "Tous les comptes connectés" : "Compte"), type, titulaire,
          origine: p ? "banque" : "import" };
        if (p && nombre(p.solde) !== null) c.solde = nombre(p.solde);
        if (p && p.pret) c.pret = p.pret;
        if (p && p.debit_differe === true) c.debit_differe = true;
        if (e.source === null) c.ecartee = true;                 // carte comptée sur le courant : écartée par moisBancaires, jamais « absente »
        comptes.set(cle, c);
      }
      if (e.source === null) continue;
      if (e.source === "import" && e.releve && e.releve.complet === false) { incomplets.push({ compte: cle, mois: e.mois }); continue; }
      const categories = (Array.isArray(e.categories) ? e.categories : []).filter(Boolean).map(l => {
        const valide = BC.estSousCategorie(l.sous_categorie);
        return { sous: valide ? l.sous_categorie : BC.parDefautDe(sansAccent(l.categorie)), categorie: l.categorie, entrees: n0(l.entrees), sorties: n0(l.sorties),
          nombre: n0(l.nombre), sans_detail: !valide };
      });
      releves.push({ compte: cle, mois: e.mois, source: e.source, categories, ecarte: e.ecarte || [] });
    }
    // comptes du budget connus sans mois (ils comptent dans « comptes absents ») : les comptes courants de la banque et des relevés
    for (const [id, p] of powens) {
      if (comptes.has(id) || !COMPTES_BUDGET.includes(p.type) || p.ignore === true || doublon(p) != null || p.actif === false) continue;
      const c = { id, libelle: p.nom || p.libelle || "Compte", type: p.type, titulaire: p.titulaire || null, origine: "banque" };
      if (nombre(p.solde) !== null) c.solde = nombre(p.solde);
      if (p.pret) c.pret = p.pret;
      if (p.debit_differe === true) c.debit_differe = true;
      comptes.set(id, c);
    }
    const config = s.config && typeof s.config === "object" ? s.config : {};
    const savoir = s.savoir && Array.isArray(s.savoir.reperes) ? s.savoir.reperes : Array.isArray(s.reperes) ? s.reperes : [];
    const data = { aujourdhui, comptes: [...comptes.values()], releves, incomplets, ecartes, partage: partageDe(config), preferences: config.budget_preferences || {},
      regles: Array.isArray(s.regles) ? s.regles : Array.isArray(s.budgetRegles) ? s.budgetRegles : [], cible: config.budget_cible || null, reperes: savoir,
      marchands: Array.isArray(b.marchands) ? b.marchands : Array.isArray(s.marchands) ? s.marchands : [], operations: Array.isArray(b.operations) ? b.operations : [] };
    // formes que lisent `detections` et `pistes` (§ 6.4, § 8.2) : capacités des 6 derniers mois complets et référence du foyer
    const courant = mois7(aujourdhui);
    data.mois = Array.from({ length: 6 }, (_, i) => decale(courant, i - 6)).map(m => ({ m, M: mois(data, { vue: "tout", mois: m }) }))
      .filter(x => x.M.couverture.comptes_observes > 0).map(x => ({ mois: x.m, capacite: x.M.capacite }));
    data.reference = reference(data, { vue: "tout" });
    return data;
  }

  const titulaireDe = (data, id) => { const c = data.comptes.find(x => x.id === String(id)); return c ? c.titulaire : null; };
  /** Poids d'un compte dans une vue : Tout, tous à 100 % ; Commun, les comptes communs à 100 % ; Perso, les comptes de la personne à 100 % et les comptes communs
      à sa part (un compte sans titulaire n'est que dans Tout). */
  function poidsDe(titulaire, vue, personne, part) {
    if (vue === "commun") return titulaire === "commun" ? 1 : 0;
    if (vue === "perso") return titulaire === personne ? 1 : titulaire === "commun" ? part : 0;
    return 1;
  }
  const VUES = ["tout", "commun", "perso"];
  function lectureVue(data, o) {
    const vue = VUES.includes(o && o.vue) ? o.vue : "tout";
    const personne = vue === "perso" ? (o.personne === "p2" ? "p2" : "p1") : null;
    const p1 = (data.partage && data.partage.p1) ?? 0.5;
    return { vue, personne, part: personne === "p2" ? 1 - p1 : p1 };
  }

  /** Le mois `M` d'une vue (§ 6.1) : revenus, blocs, hors budget, sous-catégories, capacité, épargne, lissage des dépenses annuelles et couverture.
      `opts` : { vue: "tout" | "commun" | "perso", personne?: "p1" | "p2", mois: "AAAA-MM" }. Les montants sont en euros exacts (arrondis seulement à l'affichage). */
  function mois(data, opts) {
    const o = opts || {}, d = data || {}, m = mois7(o.mois);
    const { vue, personne, part } = lectureVue(d, o);
    const courant = mois7(d.aujourdhui);
    const comptes = (d.comptes || []).filter(c => poidsDe(c.titulaire, vue, personne, part) > 0);
    const rel = (d.releves || []).filter(r => r.mois === m && poidsDe(titulaireDe(d, r.compte), vue, personne, part) > 0);
    const base = {
      mois: m, vue, personne, en_cours: !!courant && m === courant, mois_complet: !!courant && !!m && m < courant, revenus: 0,
      blocs: { essentiels: 0, envies: 0, epargne: 0 }, a_classer: 0, depenses: 0, hors_budget: { virement_interne: 0, apport_commun: 0, transfert_foyer: 0, releve_carte: 0 },
      par_sous_categorie: {}, revenus_detail: {}, capacite: 0, epargne_versee: 0, epargne_restee: 0, puise: 0, sources: [],
      lisse: { annuelles: [], essentiels_lisses: 0, envies_lisses: 0 }, mentions: [],
    };
    const couv = { a_classer_part: 0, comptes_observes: 0, comptes_absents: [], mois_complet: base.mois_complet, sans_detail: false, import_incomplet: false, en_partie_importe: false, ecartes: [] };
    if (vue === "perso" && !(d.comptes || []).some(c => c.titulaire === personne)) return { ...base, vide: "aucun_compte_personne", couverture: { ...couv, comptes_absents: comptes.map(c => c.id) } };
    const communObserve = rel.some(r => titulaireDe(d, r.compte) === "commun");
    const acc = new Map(), hb = new Map(HORS_BUDGET_CLES.map(k => [k, { sorties: 0, entrees: 0 }])), rev = new Map();
    let revenus = 0, apportsRecusCommun = 0, apportsVersesPerso = 0, nonDetaille = false;
    const ajoute = (sous, w, l) => { const a = acc.get(sous) || { sorties: 0, entrees: 0, nombre: 0 }; a.sorties += w * l.sorties; a.entrees += w * l.entrees; a.nombre += l.nombre; acc.set(sous, a); };
    for (const r of rel) {
      const t = titulaireDe(d, r.compte), w = poidsDe(t, vue, personne, part), commun = t === "commun";
      for (const l of r.categories) {
        const bloc = blocDe(l.sous, d.preferences);
        if (l.sous === "apport_commun") {
          // apports nets : un virement du commun vers un compte personnel (sortie côté commun, entrée côté perso) diminue les apports
          if (commun) apportsRecusCommun += l.entrees - l.sorties; else apportsVersesPerso += l.sorties - l.entrees;
          if (vue === "perso" && commun) continue;                 // remplacé par ta part des dépenses du commun
          if (vue === "commun") { if (commun) revenus += l.entrees - l.sorties; continue; }
          if (!communObserve && !commun) { ajoute("commun_non_detaille", w, l); nonDetaille = true; continue; }
          const h = hb.get("apport_commun"); h.sorties += w * l.sorties; h.entrees += w * l.entrees; continue;
        }
        if (l.sous === "transfert_foyer") {
          if (vue === "commun" || (vue === "perso" && commun)) continue;
          const h = hb.get("transfert_foyer"); h.sorties += w * l.sorties; h.entrees += w * l.entrees;
          if (vue === "perso") revenus += w * (l.entrees - l.sorties);
          continue;
        }
        if (bloc === "hors_budget") { const h = hb.get(l.sous); if (h) { h.sorties += w * l.sorties; h.entrees += w * l.entrees; } continue; }
        if (bloc === "revenus") { const v = w * (l.entrees - l.sorties); revenus += v; rev.set(l.sous, (rev.get(l.sous) || 0) + v); continue; }
        ajoute(l.sous, w, l);
      }
    }
    // apports reçus sur le commun depuis un compte non observé : revenus de l'ensemble du foyer (Tout), pas de la personne
    let externes = 0;
    if (vue === "tout" && communObserve) { externes = Math.max(0, apportsRecusCommun - apportsVersesPerso); revenus += externes; }
    const par = {}, bl = { essentiels: 0, envies: 0, epargne: 0, a_classer: 0 };
    for (const sous of trier(acc.keys())) {
      const a = acc.get(sous), net = r6(a.sorties - a.entrees);
      par[sous] = { sorties: r6(a.sorties), entrees: r6(a.entrees), net, nombre: a.nombre };
      bl[blocDe(sous, d.preferences)] = (bl[blocDe(sous, d.preferences)] || 0) + net;
    }
    const hors = {};
    for (const [k, h] of hb) hors[k] = r6(h.sorties > 0 ? h.sorties : h.entrees);
    const depenses = r6(bl.essentiels + bl.envies + bl.a_classer), capacite = r6(revenus - depenses), versee = r6(bl.epargne);
    // part « à classer » (§ 7.3) lue sur les sorties brutes : une entrée inconnue (virement reçu d'un proche, vente) range en « à classer » et diminue son net,
    // elle ne doit pas masquer des sorties qui restent à classer (ni rendre la part négative)
    let sortiesDepenses = 0;
    for (const [sous, a] of acc) { const b = blocDe(sous, d.preferences); if (b === "essentiels" || b === "envies" || b === "a_classer") sortiesDepenses += a.sorties; }
    const sortiesAClasser = acc.has("a_classer") ? acc.get("a_classer").sorties : 0;
    const sources = rel.map(r => ({ compte: r.compte, origine: r.source === "import" ? "import" : "banque", titulaire: titulaireDe(d, r.compte) }));
    const incompl = (d.incomplets || []).some(x => x.mois === m && poidsDe(titulaireDe(d, x.compte), vue, personne, part) > 0);
    const observes = new Set(rel.map(r => r.compte));
    const res = { ...base, revenus: r6(revenus), blocs: { essentiels: r6(bl.essentiels), envies: r6(bl.envies), epargne: versee }, a_classer: r6(bl.a_classer), depenses,
      hors_budget: hors, par_sous_categorie: par, revenus_detail: Object.fromEntries([...rev].map(([k, v]) => [k, r6(v)])), capacite, epargne_versee: versee,
      epargne_restee: r6(capacite - versee), puise: r6(Math.max(0, -capacite)), sources };
    if (nonDetaille) res.mentions.push("commun_non_connecte");
    if (externes > 0) res.mentions.push("apports_externes");
    if (rel.some(r => r.categories.some(l => l.sans_detail))) res.mentions.push("mois_sans_detail");
    // carte à débit différé sans détail ce mois-ci alors que le mois compte des opérations à classer : le relevé n'a pas pu être identifié (§ 4.5)
    if (res.a_classer > 0 && comptes.some(c => c.debit_differe === true && !observes.has(c.id))) res.mentions.push("detail_carte_indisponible");
    res.couverture = { ...couv, a_classer_part: sortiesDepenses > 0 ? r6(sortiesAClasser / sortiesDepenses) : 0, comptes_observes: observes.size,
      comptes_absents: comptes.filter(c => !observes.has(c.id) && c.ecartee !== true).map(c => c.id), sans_detail: res.mentions.includes("mois_sans_detail"), import_incomplet: incompl,
      en_partie_importe: sources.some(x => x.origine === "import") && sources.some(x => x.origine !== "import"), apports_externes: r6(externes),
      ecartes: (d.ecartes || []).filter(x => x.mois === m && poidsDe(titulaireDe(d, x.compte), vue, personne, part) > 0) };
    res.lisse = lissage(d, { vue, personne, part }, m, res);
    return res;
  }

  /* ================================================================== dépenses annuelles et lissage (§ 6.3) */
  /** Dépenses annuelles de la vue, d'après les agrégats par marchand : une règle `annuelle: true`, ou une clé qui n'apparaît qu'une fois sur les 13 mois (ou deux fois à
      11 à 13 mois d'écart, « confirmée ») avec une sous-catégorie « annuelle probable » ou un montant d'au moins `budget_annuelle_seuil`. Seules les dépenses des blocs
      essentiels et envies se lissent. → [{ compte_id, cle_marchand, sous_categorie, regle_id, confirmee, paiements: [{ mois, montant }] }] (montants à 100 %). */
  function annuelles(data, v) {
    const d = data || {}, seuil = convention(d.reperes, "budget_annuelle_seuil"), regles = (d.regles || []).filter(r => r && r.annuelle === true && r.active !== false);
    const groupes = new Map();
    for (const l of Array.isArray(d.marchands) ? d.marchands : []) {
      if (!l || !mois7(l.mois) || !(n0(l.sorties) > 0) || !l.cle_marchand) continue;
      if (poidsDe(titulaireDe(d, l.compte_id), v.vue, v.personne, v.part) <= 0) continue;
      const bloc = blocDe(l.sous_categorie, d.preferences);
      if (bloc !== "essentiels" && bloc !== "envies") continue;
      const k = [String(l.compte_id), l.cle_marchand, l.sous_categorie].join("|");
      if (!groupes.has(k)) groupes.set(k, { compte_id: String(l.compte_id), cle_marchand: l.cle_marchand, sous_categorie: l.sous_categorie, par_mois: new Map(), max: 0 });
      const g = groupes.get(k), m = mois7(l.mois);
      g.par_mois.set(m, (g.par_mois.get(m) || 0) + n0(l.sorties));
      g.max = Math.max(g.max, nombre(l.montant_max) ?? n0(l.sorties));
    }
    const sorties = [];
    for (const g of groupes.values()) {
      const paiements = [...g.par_mois].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([mo, montant]) => ({ mois: mo, montant: r6(montant) }));
      const regle = regles.find(r => r.sous_categorie === g.sous_categorie && BC.correspond(r, { libelle: g.cle_marchand, montant: -g.max, compte_id: g.compte_id }));
      const taxo = BC.TAXONOMIE.find(t => t.cle === g.sous_categorie);
      let annuelle = false, confirmee = false;
      if (regle) annuelle = confirmee = true;
      else {
        const gros = paiements.every(p => p.montant >= seuil) || !!(taxo && taxo.annuelle_probable);
        if (paiements.length === 1 && gros) annuelle = true;
        else if (paiements.length === 2 && gros) {
          const ecart = (+paiements[1].mois.slice(0, 4) * 12 + +paiements[1].mois.slice(5)) - (+paiements[0].mois.slice(0, 4) * 12 + +paiements[0].mois.slice(5));
          if (ecart >= 11 && ecart <= 13) annuelle = confirmee = true;
        }
      }
      if (annuelle) sorties.push({ compte_id: g.compte_id, cle_marchand: g.cle_marchand, sous_categorie: g.sous_categorie, regle_id: regle ? regle.id ?? null : null, confirmee, paiements });
    }
    return sorties.sort((a, b) => (a.cle_marchand < b.cle_marchand ? -1 : a.cle_marchand > b.cle_marchand ? 1 : a.compte_id < b.compte_id ? -1 : 1));
  }
  /** Lissage du mois `m` : chaque dépense annuelle compte pour 1/12 de son dernier montant les 12 mois qui suivent son paiement (provision) ; le mois du paiement garde
      le réel dans `blocs` (graphiques) et la note lit `essentiels_lisses` / `envies_lisses`. */
  function lissage(data, v, m, M) {
    const items = [];
    let ess = M.blocs.essentiels, env = M.blocs.envies;
    for (const a of annuelles(data, v)) {
      const w = poidsDe(titulaireDe(data, a.compte_id), v.vue, v.personne, v.part);
      const reel = a.paiements.filter(p => p.mois === m).reduce((t, p) => t + p.montant, 0);
      const dernier = a.paiements.filter(p => p.mois <= m).pop();
      const age = dernier ? (+m.slice(0, 4) * 12 + +m.slice(5)) - (+dernier.mois.slice(0, 4) * 12 + +dernier.mois.slice(5)) : null;
      const provision = dernier && age <= 11 ? dernier.montant / 12 : 0;
      if (!(reel > 0) && !(provision > 0)) continue;
      const montant_mois = r6(reel * w), prov = r6(provision * w);
      items.push({ sous_categorie: a.sous_categorie, compte_id: a.compte_id, cle_marchand: a.cle_marchand, regle_id: a.regle_id, confirmee: a.confirmee, montant_mois, provision: prov });
      const delta = prov - montant_mois;
      if (blocDe(a.sous_categorie, data.preferences) === "envies") env += delta; else ess += delta;
    }
    return { annuelles: items, essentiels_lisses: r6(ess), envies_lisses: r6(env) };
  }

  /* ================================================================== série, agrégation et référence */
  /** Mois AAAA-MM de `du` à `au` (inclus). */
  function moisDe(du, au) {
    const a = mois7(du), b = mois7(au), out = [];
    if (!a || !b) return out;
    for (let m = a; m <= b && out.length < 600; m = decale(m, 1)) out.push(m);
    return out;
  }
  const GRANULARITES_BUDGET = ["mois", "trimestre", "annee"];
  function agreger(ms, cle, granularite) {
    const somme_ = f => r6(somme(ms.map(f)));
    const par = {};
    for (const M of ms) for (const [k, a] of Object.entries(M.par_sous_categorie)) {
      const t = par[k] || (par[k] = { sorties: 0, entrees: 0, net: 0, nombre: 0 });
      t.sorties = r6(t.sorties + a.sorties); t.entrees = r6(t.entrees + a.entrees); t.net = r6(t.net + a.net); t.nombre += a.nombre;
    }
    const hors = {};
    for (const k of HORS_BUDGET_CLES) hors[k] = somme_(M => M.hors_budget[k]);
    const capacite = somme_(M => M.capacite), versee = somme_(M => M.epargne_versee), depenses = somme_(M => M.depenses), ac = somme_(M => M.a_classer);
    const premier = ms[0] || {};
    return { mois: cle, granularite, vue: premier.vue, personne: premier.personne, mois_inclus: ms.map(M => M.mois), en_cours: ms.some(M => M.en_cours), mois_complet: ms.length > 0 && ms.every(M => M.mois_complet),
      revenus: somme_(M => M.revenus), blocs: { essentiels: somme_(M => M.blocs.essentiels), envies: somme_(M => M.blocs.envies), epargne: versee }, a_classer: ac, depenses,
      hors_budget: hors, par_sous_categorie: par, capacite, epargne_versee: versee, epargne_restee: r6(capacite - versee), puise: r6(Math.max(0, -capacite)),
      sources: [], mentions: [...new Set(ms.flatMap(M => M.mentions))],
      lisse: { annuelles: ms.flatMap(M => M.lisse.annuelles), essentiels_lisses: somme_(M => M.lisse.essentiels_lisses), envies_lisses: somme_(M => M.lisse.envies_lisses) },
      couverture: { a_classer_part: depenses > 0 ? r6(ac / depenses) : 0, comptes_observes: Math.max(0, ...ms.map(M => M.couverture.comptes_observes)),
        comptes_absents: [...new Set(ms.flatMap(M => M.couverture.comptes_absents))], mois_complet: ms.length > 0 && ms.every(M => M.mois_complet), sans_detail: ms.some(M => M.couverture.sans_detail),
        import_incomplet: ms.some(M => M.couverture.import_incomplet), en_partie_importe: ms.some(M => M.couverture.en_partie_importe), ecartes: ms.flatMap(M => M.couverture.ecartes) } };
  }
  /** Série de mois, de trimestres ou d'années entre `du` et `au` (AAAA-MM ou AAAA-MM-JJ) : un `M` par période (les périodes sans compte observé gardent des zéros et
      `couverture.comptes_observes: 0`). `opts` : { vue, personne?, du, au, granularite: "mois" | "trimestre" | "annee" }. */
  function serie(data, opts) {
    const o = opts || {}, g = GRANULARITES_BUDGET.includes(o.granularite) ? o.granularite : "mois";
    const ms = moisDe(o.du, o.au).map(m => mois(data, { vue: o.vue, personne: o.personne, mois: m }));
    if (g === "mois") return ms;
    const groupes = new Map();
    for (const M of ms) { const k = D.Periodes.cle(M.mois + "-01", g); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(M); }
    return [...groupes].map(([k, l]) => agreger(l, k, g));
  }

  /** Référence (§ 6.2) : ce que tu dépenses d'habitude. Médiane mensuelle de chaque sous-catégorie sur les `mois_ref` (12) derniers mois complets quand ils existent (au moins 6,
      sinon 3 à 5 avec `periode_courte: true` ; moins de 3 : null). Les dépenses annuelles sont lissées (total ÷ 12) avant la médiane ; un mois importé incomplet ou sans détail n'y entre
      jamais. → { vue, personne, du, au, n, periode_courte, revenus, essentiels, envies, epargne, a_classer, par_sous_categorie, totaux, annuelles } ou null. */
  function reference(data, opts) {
    const o = opts || {}, d = data || {}, courant = mois7(d.aujourdhui);
    if (!courant) return null;
    const k = Math.max(3, Math.min(24, Math.trunc(nombre(o.mois_ref) || 12)));
    const candidats = Array.from({ length: k }, (_, i) => decale(courant, i - k)).map(m => mois(d, { vue: o.vue, personne: o.personne, mois: m }))
      .filter(M => M.couverture.comptes_observes > 0 && !M.couverture.import_incomplet && !M.couverture.sans_detail);
    const n = candidats.length;
    if (n < 3) return null;
    const lisseDe = (M, sous) => {
      const reel = M.par_sous_categorie[sous] ? M.par_sous_categorie[sous].net : 0;
      return reel + somme(M.lisse.annuelles.filter(a => a.sous_categorie === sous).map(a => a.provision - a.montant_mois));
    };
    const cles = new Set(); candidats.forEach(M => { Object.keys(M.par_sous_categorie).forEach(c => cles.add(c)); M.lisse.annuelles.forEach(a => cles.add(a.sous_categorie)); });
    const par = {}, blocs = { essentiels: {}, envies: {}, epargne: {}, a_classer: {} };
    for (const c of trier(cles)) {
      const med = r6(mediane(candidats.map(M => lisseDe(M, c))));
      if (!(med > 0)) continue;
      par[c] = med;
      const b = blocDe(c, d.preferences);
      if (blocs[b]) blocs[b][c] = med;
    }
    const v = lectureVue(d, o);
    const vues = { vue: v.vue, personne: v.personne };
    const annuellesVue = annuelles(d, v).map(a => { const dernier = a.paiements[a.paiements.length - 1]; return { sous_categorie: a.sous_categorie, cle_marchand: a.cle_marchand, compte_id: a.compte_id,
      montant_annuel: dernier.montant, mensuel: r6(dernier.montant / 12), confirmee: a.confirmee }; });
    return { ...vues, du: candidats[0].mois, au: candidats[n - 1].mois, n, periode_courte: n < 6, revenus: r6(mediane(candidats.map(M => M.revenus))), essentiels: blocs.essentiels,
      envies: blocs.envies, epargne: blocs.epargne, a_classer: blocs.a_classer.a_classer || 0, par_sous_categorie: par,
      totaux: { essentiels: r6(somme(Object.values(blocs.essentiels))), envies: r6(somme(Object.values(blocs.envies))), epargne: r6(somme(Object.values(blocs.epargne))) },
      annuelles: annuellesVue };
  }

  /* ================================================================== le récurrent (§ 6.5, tâche 9b) */
  /* Règles exactes : `conventions_recurrents` et cas R1 à R8 de test/fixtures/budget-cas.json (D18). Calculs en centimes (entiers ou demi-centimes), arrondis à la sortie
     seulement (demi-centime vers l'extérieur, pourcentages et fréquences au dixième). */
  const SOUS_ENGAGEMENT = ["loyer", "credit_logement", "autres_credits", "assurances", "telecom", "energie", "charges_logement", "enfants", "impots"];
  const SOUS_ABONNEMENT = ["abonnements", "sport"];
  const BLOCS_EXCLUS = ["hors_budget", "epargne", "revenus"];
  const PERIODES_RYTHME = { mensuel: { mois: 1, jours: 30, cout: 12 }, trimestriel: { mois: 3, jours: 91, cout: 4 }, annuel: { mois: 12, jours: 365, cout: 1 } };
  const cts = x => Math.round(n0(x) * 100);
  const arrondiExt = x => (x < 0 ? -1 : 1) * Math.floor(Math.abs(x) + 0.5 + 1e-7);
  const euroC = (c, part) => arrondiExt(c * (part === undefined ? 1 : part)) / 100;
  const dixiemeExt = x => arrondiExt(x * 10) / 10;
  const ecartMois = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  const joursEntre = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
  /** Date AAAA-MM-JJ décalée de k mois, le jour ramené au dernier jour du mois quand il n'existe pas (31 août + 3 mois = 30 novembre). */
  function plusMois(date, k) {
    const m = decale(date.slice(0, 7), k), dernier = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
    return m + "-" + String(Math.min(+date.slice(8, 10), dernier)).padStart(2, "0");
  }
  /** Paliers d'une suite de montants (centimes) : un montant rejoint le palier courant s'il est à ±10 % de sa médiane (bornes comprises), sinon il en ouvre un. */
  function paliersDe(montants, tol) {
    const t = tol === undefined ? 0.1 : tol, P = [];
    for (const a of montants) {
      const cur = P[P.length - 1], med = cur ? mediane(cur) : 0;
      if (cur && Math.abs(a - med) <= med * t + 1e-9) cur.push(a); else P.push([a]);
    }
    return P;
  }
  const suiteDeMots = (a, b) => contient(motsDe(a), motsDe(b)) || contient(motsDe(b), motsDe(a));

  /** Lecture commune du récurrent, des variations et de l'inhabituel : lignes de `banque_marchands_mois` de la vue, de m0 − 12 à m0, regroupées par
      (compte, clé, sous-catégorie) ; flux exclus (hors budget, épargne, revenus) et lignes sans sortie ignorés ; premier mois des données de la vue. */
  function lectureRecurrent(data, opts) {
    const d = data || {}, o = opts || {}, v = lectureVue(d, o), m0 = mois7(d.aujourdhui);
    if (!m0) return null;
    const debut = decale(m0, -12), connus = new Map((Array.isArray(d.comptes) ? d.comptes : []).filter(c => c && c.id != null).map(c => [String(c.id), c]));
    const poids = id => {
      const c = connus.get(String(id));
      if (!c) return v.vue === "tout" ? 1 : 0;                      // compte inconnu : compté dans Tout seulement
      if (!COMPTES_BUDGET.includes(c.type) && !(c.type === "carte_differe")) return 0;
      return poidsDe(c.titulaire, v.vue, v.personne, v.part);
    };
    const seuil = convention(d.reperes, "budget_annuelle_seuil");
    const groupes = new Map();
    let premier = null;
    for (const l of Array.isArray(d.marchands) ? d.marchands : []) {
      const m = l && mois7(l.mois);
      if (!m || m < debut || m > m0) continue;
      const w = poids(l.compte_id);
      if (!(w > 0)) continue;
      if (premier === null || m < premier) premier = m;
      const sous = l.sous_categorie, bloc = BC.estSousCategorie(sous) ? blocDe(sous, d.preferences) : "a_classer";
      if (BLOCS_EXCLUS.includes(bloc) || !(n0(l.sorties) > 0)) continue;
      const cle = l.cle_marchand == null ? "" : String(l.cle_marchand);
      const k = [String(l.compte_id), cle, sous].join("\u0001");
      if (!groupes.has(k)) groupes.set(k, { compte_id: l.compte_id, cle, sous, w, mois: new Map() });
      const g = groupes.get(k), s = cts(l.sorties), cur = g.mois.get(m) || { s: 0, n: 0, max: 0, jour: null };
      cur.s += s; cur.n += nombre(l.nombre_sorties) !== null ? n0(l.nombre_sorties) : n0(l.nombre);
      cur.max = Math.max(cur.max, nombre(l.montant_max) !== null ? cts(l.montant_max) : s);
      if (nombre(l.dernier_jour) !== null) cur.jour = Math.max(cur.jour || 0, nombre(l.dernier_jour));
      g.mois.set(m, cur);
    }
    return { d, v, m0, debut, premier, groupes: [...groupes.values()], seuil, aujourdhui: jourDe(d.aujourdhui), couverts: premier === null ? 0 : Math.max(0, ecartMois(premier, m0)) };
  }
  const indisponible = (mois_couverts) => ({ disponible: false, raison: "moins_de_3_mois", mois_couverts });

  /** Rythme, paliers, famille et statuts d'un groupe (lu à sa dernière présence). */
  function analyserGroupe(g, ctx) {
    const { m0, seuil, premier } = ctx;
    const pres = [...g.mois.keys()].filter(m => g.mois.get(m).s > 0).sort();
    const ancre = pres[pres.length - 1], complet = m => m < m0, S = m => (g.mois.has(m) ? g.mois.get(m).s : 0), N = m => (g.mois.has(m) ? g.mois.get(m).n : 0);
    const mois3 = [decale(m0, -3), decale(m0, -2), decale(m0, -1)], mois3avant = [decale(m0, -6), decale(m0, -5), decale(m0, -4)];
    const dans = (fin, k) => pres.filter(m => ecartMois(m, fin) >= 0 && ecartMois(m, fin) < k);
    let rythme = null, annuel = null, fenetre = [];
    if (dans(ancre, 4).length >= 3) { rythme = "mensuel"; fenetre = Array.from({ length: 4 }, (_, i) => decale(ancre, i - 3)); }
    else if (dans(ancre, 6).length >= 5) { rythme = "mensuel"; fenetre = Array.from({ length: 6 }, (_, i) => decale(ancre, i - 5)); }
    else if (pres.length >= 3 && [ecartMois(pres[pres.length - 3], pres[pres.length - 2]), ecartMois(pres[pres.length - 2], pres[pres.length - 1])].every(e => e >= 2 && e <= 4)) {
      rythme = "trimestriel"; fenetre = pres.slice(-3);
    } else if (pres.length === 2 && ecartMois(pres[0], pres[1]) >= 11 && ecartMois(pres[0], pres[1]) <= 13) { rythme = "annuel"; annuel = "confirme"; fenetre = pres.slice(); }
    else if (pres.length === 1 && complet(pres[0]) && (((BC.TAXONOMIE.find(t => t.cle === g.sous) || {}).annuelle_probable === true) || S(pres[0]) >= seuil * 100)) { rythme = "annuel"; annuel = "probable"; fenetre = pres.slice(); }
    const presFenetre = pres.filter(m => fenetre.includes(m));
    const montants = presFenetre.filter(complet).map(S), P = paliersDe(montants);
    const stable = montants.length >= 1 && P.length <= 2, nombreOk = presFenetre.every(m => N(m) <= 2);
    const famMarchand = familleDe(g.cle);
    // habitude : fréquence, ou montant variable sur les 4 derniers mois complets
    const somS = somme(mois3.map(S)), somN = somme(mois3.map(N));
    const m4 = [decale(m0, -4), ...mois3].filter(m => pres.includes(m));
    const habitude = somN >= 12 || (m4.length >= 3 && paliersDe(m4.map(S)).length >= 2);
    let famille = "ponctuel";
    if (g.cle !== "" && rythme !== null && stable && nombreOk) famille = SOUS_ENGAGEMENT.includes(g.sous) ? "engagement" : (SOUS_ABONNEMENT.includes(g.sous) || famMarchand) ? "abonnement" : "ponctuel";
    if (famille === "ponctuel" && g.cle !== "" && habitude) famille = "habitude";
    const r = { g, pres, ancre, rythme, annuel, famille, famMarchand, fenetre, montants, paliers: P, somS, somN, hausse: null, arrete: false, nouveau: false, statuts: [] };
    if (famille === "ponctuel") return r;
    const j = g.mois.get(ancre).jour;
    r.derniere = j === null ? null : ancre + "-" + String(j).padStart(2, "0");
    if (famille === "habitude") {
      r.habituel = mediane(mois3.map(S)); r.total = somS / 3; r.cout = somS * 4; r.frequence = somN / 3; r.panier = somN > 0 ? somS / somN : null;
      const couvert = mois3avant.every(m => premier !== null && m >= premier), base = somme(mois3avant.map(S));
      r.tendance = couvert && base > 0 ? (somS - base) / base * 100 : null;
    } else {
      const per = PERIODES_RYTHME[rythme], dernierPalier = P[P.length - 1];
      r.habituel = mediane(dernierPalier); r.cout = r.habituel * per.cout;
      if (pres.length >= 4) {
        const ref = mediane(pres.slice(-4, -1).map(S)), cond = a => a * 100 > ref * 105 + 1e-9 && a - ref >= 100 - 1e-9;
        if (cond(S(ancre))) {
          let i = pres.length - 1;
          while (i >= 0 && cond(S(pres[i]))) i--;
          r.hausse = { ancien: ref, nouveau: S(ancre), depuis: pres[i + 1] };
        }
      }
      r.arrete = r.derniere !== null && rythme !== "annuel" && joursEntre(r.derniere, ctx.aujourdhui) > 1.5 * per.jours + 1e-9;
      r.prochaine = r.derniere !== null && !r.arrete ? plusMois(r.derniere, per.mois) : null;
    }
    r.nouveau = [decale(m0, -2), decale(m0, -1), m0].includes(pres[0]);
    return r;
  }

  const LIBELLES_STATUTS = ["nouveau", "hausse_de_prix", "arrete", "doublon_possible"];
  /** Le récurrent d'une vue (§ 6.5) : engagements (contraint), abonnements et habitudes (pilotables), avec synthèse du mois et « reste à prélever ».
      `opts` : { vue, personne?, mois? }. → { disponible, mois_couverts, recurrents: [ligne], synthese } ou { disponible: false, raison: "moins_de_3_mois", mois_couverts }. */
  function recurrentsVue(data, opts) {
    const ctx = lectureRecurrent(data, opts);
    if (!ctx) return indisponible(0);
    if (ctx.couverts < 3) return indisponible(ctx.couverts);
    const mo = mois7(opts && opts.mois) || ctx.m0;
    const analyses = ctx.groupes.map(g => analyserGroupe(g, ctx));
    const lignes = analyses.filter(a => a.famille !== "ponctuel");
    // statuts : nouveau, hausse de prix, arrêté ?, doublon possible
    const actifs = lignes.filter(a => a.famille !== "habitude" && !a.arrete);
    const assurances = actifs.filter(a => a.g.sous === "assurances");
    const doublons = new Set();
    for (const a of assurances) for (const b of assurances) if (a !== b && !suiteDeMots(a.g.cle, b.g.cle)) doublons.add(a);
    for (const fam of FAMILLES_DOUBLON) {
      const l = actifs.filter(a => a.famille === "abonnement" && a.famMarchand === fam);
      if (l.length >= 2) l.forEach(a => doublons.add(a));
    }
    for (const a of lignes) {
      if (a.nouveau) a.statuts.push("nouveau");
      if (a.hausse) a.statuts.push("hausse_de_prix");
      if (a.arrete) a.statuts.push("arrete");
      if (doublons.has(a)) a.statuts.push("doublon_possible");
    }
    const ORDRE = { engagement: 0, abonnement: 1, habitude: 2 };
    const rendu = a => euroC(a.cout, a.g.w);
    lignes.sort((a, b) => ORDRE[a.famille] - ORDRE[b.famille] || rendu(b) - rendu(a) || (a.g.cle < b.g.cle ? -1 : a.g.cle > b.g.cle ? 1 : String(a.g.compte_id) < String(b.g.compte_id) ? -1 : String(a.g.compte_id) > String(b.g.compte_id) ? 1 : 0));
    const rows = lignes.map(a => {
      const w = a.g.w, hab = a.famille === "habitude";
      return { compte_id: a.g.compte_id, cle_marchand: a.g.cle, sous_categorie: a.g.sous, part: w, famille: a.famille, famille_marchand: a.famMarchand, rythme: a.rythme, annuel: a.annuel,
        montant_habituel: euroC(a.habituel, w), cout_12_mois: euroC(a.cout, w), derniere_date: a.derniere, prochaine_date: hab ? null : a.prochaine,
        frequence: hab ? dixiemeExt(a.frequence) : null, panier_moyen: hab && a.panier !== null ? euroC(a.panier, w) : null, total_mensuel: hab ? euroC(a.total, w) : null,
        tendance: hab && a.tendance !== null ? dixiemeExt(a.tendance) : null,
        hausse: a.hausse ? { ancien: euroC(a.hausse.ancien, w), nouveau: euroC(a.hausse.nouveau, w), depuis: a.hausse.depuis } : null, statuts: a.statuts.slice() };
    });
    // synthèse du mois : sorties brutes de chaque groupe, ventilées selon sa famille (calculée aujourd'hui)
    const parFamille = { engagement: 0, abonnement: 0, habitude: 0, ponctuel: 0 };
    for (const a of analyses) { const m = a.g.mois.get(mo); if (m && m.s > 0) parFamille[a.famille] += m.s * a.g.w; }
    const total = parFamille.engagement + parFamille.abonnement + parFamille.habitude + parFamille.ponctuel;
    const pct = x => (total > 0 ? dixiemeExt(x / total * 100) : null);
    const enCours = mo === ctx.m0;
    let attendus = null, reste = null, prochain = null;
    if (enCours) {
      attendus = lignes.filter(a => a.famille !== "habitude" && a.prochaine && a.prochaine.slice(0, 7) === ctx.m0).map(a => ({ compte_id: a.g.compte_id, cle_marchand: a.g.cle, date: a.prochaine,
        montant: euroC(a.g.mois.get(a.ancre).s, a.g.w), en_retard: joursEntre(a.prochaine, ctx.aujourdhui) > 3, _c: a.g.mois.get(a.ancre).s * a.g.w }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.cle_marchand < b.cle_marchand ? -1 : a.cle_marchand > b.cle_marchand ? 1 : String(a.compte_id) < String(b.compte_id) ? -1 : 1));
      reste = euroC(somme(attendus.map(x => x._c)));
      attendus.forEach(x => delete x._c);
      const venir = attendus.filter(x => x.date >= ctx.aujourdhui);
      prochain = venir.length ? venir[0].date : null;
    }
    const synthese = { mois: mo, en_cours: enCours, engagements: euroC(parFamille.engagement), abonnements: euroC(parFamille.abonnement), habitudes: euroC(parFamille.habitude), ponctuel: euroC(parFamille.ponctuel),
      total: euroC(total), parts: total > 0 ? { engagements: pct(parFamille.engagement), abonnements: pct(parFamille.abonnement), habitudes: pct(parFamille.habitude), ponctuel: pct(parFamille.ponctuel) } : null,
      reste_a_prelever: reste, attendus, prochain_prelevement: prochain,
      cout_annuel_abonnements: euroC(somme(lignes.filter(a => a.famille === "abonnement" && !a.arrete).map(a => a.cout * a.g.w))) };
    return { disponible: true, mois_couverts: ctx.couverts, recurrents: rows, synthese };
  }

  /** Mois de référence d'une analyse (variations, inhabituel) : mois complets avant `mo`, 12 au plus (m0 − 12 au plus loin), couverts par les données. */
  function moisReference(ctx, mo) {
    if (!mo || mo > ctx.m0 || ctx.premier === null) return [];
    const debut = ctx.premier > ctx.debut ? ctx.premier : ctx.debut, out = [];
    for (let m = debut; m < mo; m = decale(m, 1)) out.push(m);
    return out;
  }
  /** Pourquoi une dépense a bougé (§ 6.5) : écart entre le mois et sa référence (médianes), effet volume et effet prix, et les clés qui l'expliquent.
      `opts` : { vue, personne?, mois, niveau: "sous_categorie" | "cle", sous_categorie? | compte_id + cle_marchand }. */
  function variations(data, opts) {
    const o = opts || {}, ctx = lectureRecurrent(data, o), mo = mois7(o.mois);
    if (!ctx) return indisponible(0);
    const niveau = o.niveau === "cle" ? "cle" : "sous_categorie", refs = moisReference(ctx, mo);
    if (refs.length < 3) return indisponible(refs.length);
    const choisis = ctx.groupes.filter(g => (niveau === "cle" ? String(g.compte_id) === String(o.compte_id) && g.cle === String(o.cle_marchand) : g.sous === o.sous_categorie));
    const serie = (liste, f, mois) => mois.map(m => somme(liste.map(g => (g.mois.has(m) ? f(g.mois.get(m)) * g.w : 0))));
    const S0 = mediane(serie(choisis, x => x.s, refs)), N0 = mediane(choisis.length ? refs.map(m => somme(choisis.map(g => (g.mois.has(m) ? g.mois.get(m).n : 0)))) : refs.map(() => 0));
    const S1 = serie(choisis, x => x.s, [mo])[0], N1 = somme(choisis.map(g => (g.mois.has(mo) ? g.mois.get(mo).n : 0)));
    const ecart = S1 - S0;
    const volume = N0 === 0 ? ecart : N1 === 0 ? ecart : (N1 - N0) * S0 / N0, prix = ecart - volume;
    let cles = null;
    if (niveau === "sous_categorie") {
      const parCle = new Map();
      for (const g of choisis) {
        if (g.cle === "") continue;
        const k = String(g.compte_id) + "\u0001" + g.cle;
        if (!parCle.has(k)) parCle.set(k, []);
        parCle.get(k).push(g);
      }
      const sg = ecart > 0 ? 1 : ecart < 0 ? -1 : 0;
      const liste = [...parCle.values()].map(gs => ({ compte_id: gs[0].compte_id, cle_marchand: gs[0].cle, e: serie(gs, x => x.s, [mo])[0] - mediane(serie(gs, x => x.s, refs)) }))
        .filter(x => sg !== 0 && Math.abs(x.e) > 1e-9 && Math.sign(x.e) === sg)
        .sort((a, b) => Math.abs(b.e) - Math.abs(a.e) || (a.cle_marchand < b.cle_marchand ? -1 : a.cle_marchand > b.cle_marchand ? 1 : String(a.compte_id) < String(b.compte_id) ? -1 : 1));
      cles = liste.slice(0, 3).map(x => ({ compte_id: x.compte_id, cle_marchand: x.cle_marchand, ecart: euroC(x.e) }));
    }
    const panier = (s, n) => (n > 0 ? euroC(s / n) : null);
    const res = { disponible: true, mois: mo, niveau };
    if (niveau === "cle") { res.compte_id = o.compte_id; res.cle_marchand = String(o.cle_marchand); } else res.sous_categorie = o.sous_categorie;
    return { ...res, reference: { du: refs[0], au: refs[refs.length - 1], n: refs.length, periode_courte: refs.length < 6, montant: euroC(S0), nombre: N0, panier: panier(S0, N0) },
      mois_analyse: { montant: euroC(S1), nombre: N1, panier: panier(S1, N1) }, ecart: euroC(ecart), delta_nombre: N1 - N0, effet_volume: euroC(volume), effet_prix: euroC(prix), cles };
  }

  /** Dépenses inhabituelles du mois (§ 6.5) : une clé jamais vue sur les mois de référence et d'au moins 50 €, ou une sortie supérieure à 3 fois le panier médian de sa clé.
      `opts` : { vue, personne?, mois }. → { disponible, mois, depenses: [{ compte_id, cle_marchand, sous_categorie, montant, montant_max, raison, mediane_panier }] }. */
  function inhabituel(data, opts) {
    const o = opts || {}, ctx = lectureRecurrent(data, o), mo = mois7(o.mois);
    if (!ctx) return indisponible(0);
    const refs = moisReference(ctx, mo);
    if (refs.length < 3) return indisponible(refs.length);
    const parCle = new Map();
    for (const g of ctx.groupes) { if (g.cle === "") continue; if (!parCle.has(g.cle)) parCle.set(g.cle, []); parCle.get(g.cle).push(g); }
    const sortie = [];
    for (const g of ctx.groupes) {
      if (g.cle === "" || !g.mois.has(mo) || !(g.mois.get(mo).s > 0)) continue;
      const m = g.mois.get(mo), memes = parCle.get(g.cle);
      const vus = refs.filter(r => memes.some(x => x.mois.has(r) && x.mois.get(r).s > 0));
      let raison = null, med = null;
      if (!vus.length) { if (m.s >= 5000) raison = "nouvelle_cle"; }
      else {
        med = mediane(vus.map(r => { const s = somme(memes.map(x => (x.mois.has(r) ? x.mois.get(r).s : 0))), nn = somme(memes.map(x => (x.mois.has(r) ? x.mois.get(r).n : 0))); return nn > 0 ? s / nn : s; }));
        if (m.max > 3 * med + 1e-9) raison = "montant_eleve";
      }
      if (raison) sortie.push({ g, raison, m, med: raison === "montant_eleve" ? med : null });
    }
    sortie.sort((a, b) => b.m.s - a.m.s || (a.g.cle < b.g.cle ? -1 : a.g.cle > b.g.cle ? 1 : String(a.g.compte_id) < String(b.g.compte_id) ? -1 : 1));
    return { disponible: true, mois: mo, depenses: sortie.map(x => ({ compte_id: x.g.compte_id, cle_marchand: x.g.cle, sous_categorie: x.g.sous, montant: euroC(x.m.s, x.g.w),
      montant_max: euroC(x.m.max, x.g.w), raison: x.raison, mediane_panier: x.med === null ? null : euroC(x.med, x.g.w) })) };
  }

  /* ================================================================== export */
  return { CONVENTIONS, convention, cibleEnVigueur, donnees, mois, serie, reference, depensesAnnuelles: annuelles, score, recurrents: recurrentsVue, variations, inhabituel, detections, fragilite, pistes, plancherResteAVivre, comparerInsee, proposerCible, repartir, familleDe, normaliserReference };
});
});

export const Budget = charger("budget");
export const BudgetCategories = charger("budget-categories");
