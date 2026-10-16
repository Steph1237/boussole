// Fichier généré par scripts/gen-catalogue.mjs (npm run gen) : ne pas modifier à la main.
// Copie du moteur du budget de l'app (BUD1, docs/superpowers/specs/2026-10-16-bud1-budget-design.md) : les modules purs de web/src
// (sensible, budget-categories, budget) recopiés tels quels, évalués dans cet ordre. Aucune modification : un écart avec l'app est un bug du générateur.
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

   POINT D'INTÉGRATION DE LA TÂCHE 7 (non livré ici : dépend de Calc.moisBancaires, fourni par HIS2 sur une autre branche) :
   Budget.donnees(S), Budget.mois(data, { vue, personne, mois }), Budget.serie(...), Budget.reference(...) viendront s'ajouter à l'objet exporté en bas de ce
   fichier. Les fonctions ci-dessous n'en dépendent pas : elles lisent des formes simples, décrites ci-dessous, que ces fonctions produiront.

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
  const api = factory({ BudgetCategories: dep("budget-categories", "BudgetCategories") });
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
    budget_piste_petit_achat_seuil: 15, budget_piste_petits_achats_nombre: 8, budget_piste_frais_cotisation_laissee: 5,
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
  function recurrents(data, opts) {
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
    const rec = recurrents(data, o);
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
      texte: "Ton logement pèse " + String(part).replace(".", ",") + " % de ta consommation, contre " + String(v).replace(".", ",") + " % en moyenne (Insee, enquête 2017) : " +
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
      → { options: { tenable, equilibree, ambitieuse }, necessaire, retenue, niveau, cible, controles, limite_par_plancher, orientation, atteignable_8_sur_10, leviers, couverture }. */
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
    const atteignable = necessaire === null ? null : S >= necessaire - 1e-9;
    const cible = { revenus_ref: R, blocs: { essentiels: Ess, envies: Env, epargne: S }, sous_categories: sousObj, protegees: [...protegees], niveau,
      taux_epargne: R > 0 ? centieme(S / R * 100) : 0, source: "Proposée par Claude à partir de tes relevés et de tes objectifs", version_taxonomie: BC.VERSION_TAXONOMIE };
    if (typeof e.evaluer === "function") cible.objectifs = e.evaluer(S);
    else if (Array.isArray(e.objectifs)) cible.objectifs = e.objectifs;
    return { options, necessaire, retenue: S, niveau, taux: cible.taux_epargne, cible, blocs: cible.blocs, sous_categories: sousObj, controles, couverture,
      limite_par_plancher: limite, orientation: limite, atteignable_8_sur_10: atteignable, leviers: atteignable === false ? LEVIERS.slice() : [], pistes_retenues: prises,
      capacite_taux: R > 0 ? dixieme(C / R * 100) : 0 };
  }
  function montantOption(m, R, effort) { return { montant: arrondi(m), taux: tauxPct(arrondi(m), R), effort }; }

  /* ================================================================== export */
  return { CONVENTIONS, convention, cibleEnVigueur, score, recurrents, detections, fragilite, pistes, plancherResteAVivre, comparerInsee, proposerCible, repartir, familleDe, normaliserReference };
});
});

export const Budget = charger("budget");
export const BudgetCategories = charger("budget-categories");
