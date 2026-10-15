// Boussole : correspondance des catégories Powens vers les catégories du budget Boussole (BQ1, spec § 6).
//
// Source : https://docs.powens.com/api-reference/products/data-aggregation/categorization (taxonomie française, consultée le
// 2026-10-12). Une opération porte `categories` (tableau d'objets { code, parent_code }, propriété dépliable par
// `expand=categories`, cf. https://docs.powens.com/api-reference/products/data-aggregation/bank-transactions). La catégorisation
// n'est pas activée par défaut sur un domaine Powens : sans elle, toutes les opérations tombent dans « divers ».
// Règle : le code enfant prime, puis le code parent ; tout code inconnu (ou absent) devient « divers ».
// Virements internes : la taxonomie française n'a pas de catégorie « virement entre mes comptes » (transfers couvre tous les
// virements, y compris vers des tiers : il reste en « divers ») ; savings (versement vers un compte d'épargne) et les codes
// from_own_account / to_own_account (taxonomie espagnole, présents si le domaine l'utilise) sont rangés en « epargne », jamais
// comparée au budget des dépenses : un virement du courant vers le livret n'est pas compté comme une dépense. Les cartes à
// débit différé sont traitées à part (banque_comptes.debit_differe, banque_recalculer_mois). Le vrai rapprochement des virements
// entre comptes connectés (montant opposé, autre compte, 3 jours au plus, indice de virement d'un côté au moins, jamais une carte
// ni un revenu ou une dépense catégorisée ici) est fait après coup par synchro.ts (rapprocherVirements) : « virement_interne »
// des deux côtés, ou « epargne » côté courant d'un virement avec l'épargne. La catégorie tirée de cette table est gardée dans
// banque_operations.categorie_powens (migration 0025) : le rapprochement est recalculé à partir d'elle à chaque synchronisation,
// et elle est rendue à l'opération quand l'appariement n'est plus valide.
// Table versionnée : changer une correspondance → changer VERSION_CATEGORIES (test/powens-synchro.test.mjs).
//
// BUD1 (docs/superpowers/specs/2026-10-16-bud1-budget-design.md § 3.2 point 4) : chaque opération reçoit aussi une sous-catégorie ; la table complète des codes Powens
// vers les sous-catégories, et tout le classement, vivent dans le module partagé web/src/budget-categories.js (copie générée budget-categories.gen.js, npm run gen).
// Ce fichier délègue la sous-catégorie à cette copie (sousCategorieBoussole) et garde la catégorie large, qui reste celle des lecteurs existants ; elle doit rester la
// catégorie large de la sous-catégorie (test/powens-synchro.test.mjs). Quatre codes changent de catégorie large, d'une dépense à une autre (totaux de revenus, de dépenses
// et de capacité inchangés) : kitchen_and_appliances et furniture_and_decoration (logement → divers), health_insurance_fees (sante → divers), plane_or_boat_travel
// (transport → loisirs) ; VERSION_CATEGORIES change en conséquence.
import { BudgetCategories } from "./budget-categories.gen.js";

export const VERSION_CATEGORIES = "2026-10-16";

export const CATEGORIES_BOUSSOLE = [
  "logement", "alimentation", "transport", "enfants", "sante", "loisirs", "abonnements", "impots", "divers", "revenus", "epargne",
  // jamais issue d'un code Powens : posée par le rapprochement des virements entre comptes connectés (synchro.ts, CP1 § 5),
  // exclue des entrées et des sorties de banque_mois (migrations 0024, 0025) et du budget réel (mcp/banque.ts)
  "virement_interne",
];

export const CORRESPONDANCE: Record<string, string> = {
  // Parents (taxonomie française).
  administration_and_taxes: "impots",
  bank_insurances: "divers",
  food_and_restaurants: "alimentation",
  household: "logement",
  healthcare: "sante",
  housing: "logement",
  leisure: "loisirs",
  loans: "divers",
  media_and_telecommunications: "abonnements",
  others: "divers",
  revenue: "revenus",
  shopping: "divers",
  travel_and_transport: "transport",

  // Enfants dont la catégorie diffère de celle du parent.
  legal_advice: "divers",
  kitchen_and_appliances: "divers",
  furniture_and_decoration: "divers",
  health_insurance_fees: "divers",
  plane_or_boat_travel: "loisirs",
  savings: "epargne",
  retirement_insurance: "epargne",
  savings_investments_and_crypto_assets: "epargne",
  bars_restaurants: "loisirs",
  child_care_kindergarten: "enfants",
  education_and_training: "enfants",
  alimony_payment: "enfants",
  pet_care: "divers",
  post_and_courier: "divers",
  charity_ngo_unions_associations: "divers",
  mortgage_payment: "logement",
  savings_disposal: "epargne",
  from_own_account: "epargne",
  to_own_account: "epargne",
  multimedia_books_stationery: "loisirs",

  // Enfants rattachés explicitement (même catégorie que le parent), pour lire la table d'un coup d'œil.
  taxes: "impots",
  social_contributions: "impots",
  supermarket_and_groceries: "alimentation",
  rent: "logement",
  energy: "logement",
  water: "logement",
  pharmacy: "sante",
  cinema_theater_culture: "loisirs",
  phone_internet_tv: "abonnements",
  media_subscriptions: "abonnements",
  salary: "revenus",
  pensions: "revenus",
  public_transportation: "transport",
  fuel_and_vehicle_charging: "transport",
  transfers: "divers",
};

function code(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null;
}
/** Catégorie d'un code, propriétés propres seulement (« constructor » ou « __proto__ » ne correspondent à rien). */
function correspondance(k: string | null): string | null {
  return k && Object.prototype.hasOwnProperty.call(CORRESPONDANCE, k) ? CORRESPONDANCE[k] : null;
}

/** Catégorie Boussole d'une catégorie Powens : code (enfant ou parent), objet { code, parent_code } ou tableau `categories`. */
export function categorieBoussole(categoriePowens: unknown): string {
  const c: any = Array.isArray(categoriePowens) ? categoriePowens[0] : categoriePowens;
  if (typeof c === "string") return correspondance(code(c)) ?? "divers";
  if (c && typeof c === "object") return correspondance(code(c.code)) ?? correspondance(code(c.parent_code)) ?? "divers";
  return "divers";
}

/** Sous-catégorie du budget d'une catégorie Powens (code enfant, puis code parent), null si aucune ne la dit : le classement continue (marchands, motifs, « à classer »).
    Délègue à BudgetCategories.sousCategoriePowens ; mêmes formes d'entrée que categorieBoussole. */
export function sousCategorieBoussole(categoriePowens: unknown): string | null {
  return BudgetCategories.sousCategoriePowens(categoriePowens);
}
