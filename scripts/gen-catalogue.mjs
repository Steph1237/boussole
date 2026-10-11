// Génère, à partir des sources de l'app, les deux fichiers du connecteur MCP qui ne doivent jamais diverger d'elles :
//
//   supabase/functions/mcp/catalogue.gen.ts          catalogue des champs des formulaires dynamiques (outils formulaire,
//                                                    soumettre_formulaire, set_risk_answers) et barème du profil de risque ;
//   supabase/functions/mcp/formulaire-logique.gen.ts source de supabase/functions/mcp/formulaire-logique.js en chaîne, injectée
//                                                    telle quelle dans la page ui://boussole/formulaire (formulaire-ui.ts).
//
// Usage : npm run gen (node scripts/gen-catalogue.mjs). test/formulaire.test.mjs échoue si un fichier généré n'est plus à jour.
//
// Sources :
//   - web/src/risque.js (QUESTIONS) pour risque.* : thème, type, valeurs (codes et libellés de l'app, inchangés), option
//     exclusive, texte et aide de chaque question, poids et points (barème du profil estimé) ;
//   - web/src/bilan-etat.js pour l'aide (« pourquoi ») des champs du profil qu'il connaît ;
//   - le schéma du profil (web/src/profil.js, web/src/store-supabase.js, schémas zod d'update_profile) pour foyer.*,
//     personnes.p1|p2.*, autres.*, protection.* : codes et bornes recopiés ci-dessous, vérifiés par test/formulaire.test.mjs.
//
// Tutoiement : les textes de l'app (risque.js, bilan-etat.js) sont au tutoiement (spec 2026-10-11-saisie-par-agent) et sont
// repris tels quels ; exigerTutoiement() fait échouer le générateur s'il y reste un « vous », « votre » ou « vos » (l'ancienne
// table de conversion vous → tu est devenue sans objet). Les libellés des options restent ceux de l'app, tels quels. Les phrases
// « Prérempli depuis … » des aides de risque.js sont retirées : le formulaire ne préremplit que des valeurs déjà validées du même
// champ, jamais une valeur déduite d'une autre donnée.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const racine = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
export const SORTIE_CATALOGUE = "supabase/functions/mcp/catalogue.gen.ts";
export const SORTIE_LOGIQUE = "supabase/functions/mcp/formulaire-logique.gen.ts";
export const SOURCE_LOGIQUE = "supabase/functions/mcp/formulaire-logique.js";

/* ---------- tutoiement ---------- */
const RESTE_VOUS = /(^|[^\p{L}])(vous|votre|vos|vôtres?)(?![\p{L}])/iu;

/** Texte de l'app repris tel quel ; lève s'il est encore au vouvoiement (le texte est à reprendre dans l'app). */
export function exigerTutoiement(texte) {
  const t = String(texte);
  if (RESTE_VOUS.test(t)) throw new Error("exigerTutoiement : texte de l'app au vouvoiement, à mettre au tutoiement à la source : « " + t + " »");
  return t;
}
/** Aide de risque.js sans la phrase « Prérempli depuis … » (aucun préremplissage déduit dans le formulaire). */
export function sansPrerempli(aide) {
  const t = String(aide || "").replace(/\s*Prérempli[^.]*\./g, "").trim();
  return t || undefined;
}

/* ---------- champs du profil (schéma du profil ; codes vérifiés contre profil.js et index.ts par les tests) ---------- */
const PERSONNES = ["p1", "p2"];
const UNITES = [["nm", "net / mois"], ["na", "net / an"], ["bm", "brut / mois"], ["ba", "brut / an"]]; // UNITS de profil.js
const TMI = [[0, "0 % (non imposable)"], [11, "11 %"], [30, "30 %"], [41, "41 %"], [45, "45 %"]];
/** Borne haute du nombre d'années d'expérience (schéma de set_risk_answers depuis l'origine). */
export const EXPERIENCE_MAX = 80;

function champsProfil(Risque, pourquoi) {
  // foyer.age : mêmes codes que la question « age » de risque.js (u30 … a70), libellés repris de ses options.
  const ages = Risque.QUESTIONS.find(q => q.id === "age").options.map(o => ({ v: o.v, label: o.label }));
  const out = [
    { champ: "foyer.adultes", theme: "Foyer", type: "choix", libelle: "Combien d'adultes composent ton foyer ?", aide: pourquoi("foyer.adultes"),
      valeurs: [{ v: 1, label: "1 adulte" }, { v: 2, label: "2 adultes" }, { v: 3, label: "3 adultes ou plus" }], cible: "profil", chemin: "foyer.adultes" },
    { champ: "foyer.enfants", theme: "Foyer", type: "choix", libelle: "Combien d'enfants as-tu à charge ?", aide: pourquoi("foyer.enfants"),
      valeurs: [{ v: 0, label: "Aucun" }, { v: 1, label: "1 enfant" }, { v: 2, label: "2 enfants" }, { v: 3, label: "3 enfants" }, { v: 4, label: "4 enfants ou plus" }],
      cible: "profil", chemin: "foyer.enfants" },
    { champ: "foyer.age", theme: "Foyer", type: "choix", libelle: "Quelle est la tranche d'âge de la personne qui gagne le plus ?", aide: pourquoi("foyer.age"),
      valeurs: ages, cible: "profil", chemin: "foyer.age" },
    { champ: "foyer.tmi", theme: "Foyer", type: "choix", libelle: "Quelle est ta tranche marginale d'imposition ?",
      aide: [pourquoi("foyer.tmi"), "Elle figure sur ton avis d'imposition."].filter(Boolean).join(" "),
      valeurs: TMI.map(([v, label]) => ({ v, label })), cible: "profil", chemin: "foyer.tmi" },
  ];
  for (const k of PERSONNES) {
    const P = "personnes." + k;
    out.push(
      { champ: P + ".nom", theme: "Revenus", type: "texte_court", libelle: "Quel est le prénom de " + (k === "p1" ? "la personne 1" : "la personne 2") + " ?",
        aide: "Il sert à nommer chaque personne du foyer dans Boussole.", max: 40, cible: "profil", chemin: P + ".nom" },
      { champ: P + ".salaire", theme: "Revenus", type: "montant", libelle: "Quel est le salaire de {nom} ?", aide: pourquoi(P + ".salaire") || pourquoi("personnes.p1.salaire"),
        min: 0, unite: "€", cible: "profil", chemin: P + ".salaire" },
      { champ: P + ".salaireUnite", theme: "Revenus", type: "choix", libelle: "Ce salaire de {nom} est-il net ou brut, par mois ou par an ?",
        aide: "Boussole ramène tout en net mensuel pour ses calculs.", valeurs: UNITES.map(([v, label]) => ({ v, label })), cible: "profil", chemin: P + ".salaireUnite" },
      { champ: P + ".statut", theme: "Revenus", type: "choix", libelle: "Quel est le statut de {nom} ?", aide: pourquoi(P + ".statut") || pourquoi("personnes.p1.statut"),
        valeurs: [{ v: "cadre", label: "Cadre" }, { v: "nc", label: "Non-cadre" }], cible: "profil", chemin: P + ".statut" },
      { champ: P + ".autresRevenus", theme: "Revenus", type: "montant", libelle: "Quels autres revenus nets perçoit {nom} chaque mois (hors loyers des biens) ?",
        aide: "Pension, revenus d'indépendant, rentes… 0 s'il n'y en a pas.", min: 0, unite: "€ / mois", cible: "profil", chemin: P + ".autresRevenus" },
    );
  }
  for (const k of PERSONNES) {
    const A = "autres." + k;
    out.push(
      { champ: A + ".usage", theme: "Autres actifs", type: "montant", libelle: "Quelle est la valeur des biens d'usage de {nom} (véhicule, mobilier…) ?",
        min: 0, unite: "€", cible: "profil", chemin: A + ".usage" },
      { champ: A + ".entreprise", theme: "Autres actifs", type: "montant", libelle: "Quelle est la valeur des parts d'entreprise de {nom} ?",
        min: 0, unite: "€", cible: "profil", chemin: A + ".entreprise" },
    );
  }
  out.push(
    { champ: "protection.prevoyance", theme: "Protection", type: "booleen", libelle: "As-tu une prévoyance (décès, invalidité) au-delà de celle de ton employeur ?",
      aide: pourquoi("protection.prevoyance"), cible: "protection", chemin: "prevoyance" },
    { champ: "protection.emprunteur", theme: "Protection", type: "booleen", libelle: "Tes crédits sont-ils couverts par une assurance emprunteur ?",
      aide: pourquoi("protection.emprunteur"), cible: "protection", chemin: "emprunteur" },
  );
  return out;
}

/* ---------- profil de risque (risque.js) ---------- */
function champsRisque(Risque) {
  return Risque.QUESTIONS.map(q => {
    const base = { champ: "risque." + q.id, theme: q.theme, libelle: exigerTutoiement(q.texte) };
    const aide = sansPrerempli(q.aide);
    if (aide) base.aide = exigerTutoiement(aide);
    if (q.type === "nombre") {
      return { ...base, type: "curseur", min: 0, max: EXPERIENCE_MAX, pas: 1, unite: "ans",
        reperes: q.options.map(o => ({ min: o.min, label: o.label })), cible: "risque", chemin: q.id };
    }
    return { ...base, type: q.type === "multi" ? "multi" : "choix",
      valeurs: q.options.map(o => (o.exclusif ? { v: o.v, label: o.label, exclusif: true } : { v: o.v, label: o.label })), cible: "risque", chemin: q.id };
  });
}
/** Barème du questionnaire (poids, points, perte, seuils) pour le port de Risque.evaluer (profil estimé). */
function baremeRisque(Risque) {
  return Risque.QUESTIONS.map(q => ({ id: q.id, poids: q.poids, type: q.type,
    options: q.options.map(o => Object.fromEntries(Object.entries({ v: o.v, points: o.points, perte: o.perte, min: o.min, exclusif: o.exclusif }).filter(([, v]) => v !== undefined))) }));
}

/** « Pourquoi » de bilan-etat.js par champ (au tutoiement), lu sur deux états vides (un et deux adultes, avec un crédit). */
function pourquoiBilan(BilanEtat) {
  const m = {};
  const etats = [
    BilanEtat.etat({ profil: null, positions: [], objectifs: [] }, "2026-01-01"),
    BilanEtat.etat({ profil: { foyer: { adultes: 2 }, personnes: {}, credits: [{ crd: 1 }], protection: {} }, positions: [], objectifs: [] }, "2026-01-01"),
  ];
  for (const e of etats) for (const s of e.sections) for (const q of s.manquants) if (/^(foyer|personnes|protection)\./.test(q.champ) && !m[q.champ]) m[q.champ] = exigerTutoiement(q.pourquoi);
  return champ => m[champ];
}

const sansIndefini = o => JSON.parse(JSON.stringify(o));

/** Contenu des fichiers générés (texte), sans écrire. */
export function generer() {
  const Risque = require(racine("web/src/risque.js"));
  const BilanEtat = require(racine("web/src/bilan-etat.js"));
  const catalogue = sansIndefini([...champsProfil(Risque, pourquoiBilan(BilanEtat)), ...champsRisque(Risque)]);
  const bareme = sansIndefini(baremeRisque(Risque));
  const entete = "// Fichier généré par scripts/gen-catalogue.mjs (npm run gen) : ne pas modifier à la main.\n";
  const cat = entete +
    "// Catalogue des champs des formulaires dynamiques (source unique : web/src/risque.js, web/src/bilan-etat.js, schéma du profil).\n" +
    "// Chaque champ : { champ, theme, type: choix|multi|curseur|montant|date|booleen|texte_court, libelle, aide?, valeurs?: [{ v, label, exclusif? }],\n" +
    "// min?, max?, pas?, unite?, reperes?, cible: profil|risque|protection, chemin } ; {nom} dans un libellé = prénom de la personne.\n" +
    "export const CATALOGUE: any[] = " + JSON.stringify(catalogue, null, 2) + ";\n\n" +
    "// Barème du questionnaire de risque (web/src/risque.js QUESTIONS : poids, points, perte, seuils), pour le profil estimé.\n" +
    "export const BAREME_RISQUE: any[] = " + JSON.stringify(bareme, null, 2) + ";\n";
  const logique = readFileSync(racine(SOURCE_LOGIQUE), "utf8");
  const log = entete + "// Source de " + SOURCE_LOGIQUE.split("/").pop() + ", injectée telle quelle dans la page ui://boussole/formulaire.\n" +
    "export const LOGIQUE_FORMULAIRE: string = " + JSON.stringify(logique) + ";\n";
  return { [SORTIE_CATALOGUE]: cat, [SORTIE_LOGIQUE]: log };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fichiers = generer();
  for (const [rel, txt] of Object.entries(fichiers)) { writeFileSync(racine(rel), txt); console.log("écrit : " + rel); }
}
