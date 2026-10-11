/* Phrases « Compléter avec Claude » : la saisie se fait dans l'assistant de l'utilisateur (spec
   docs/superpowers/specs/2026-10-11-saisie-par-agent.md). Chaque bouton de l'app ouvre Claude avec une phrase prête qui active
   l'agent Boussole sur la bonne section et lui demande d'utiliser les formulaires interactifs. Pur, sans DOM, au tutoiement.
   ClaudePrompts.phrase(section, contexte?) → texte ; ClaudePrompts.SECTIONS → sections connues. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClaudePrompts = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const DEBUT = "Boussole : ";
  const FIN = " Commence par demarrer_session, puis utilise les formulaires interactifs Boussole plutôt que des questions en texte.";
  /* Objet de la demande, par section (ce que l'agent doit compléter ou corriger). */
  const SECTIONS = {
    bilan: "aide-moi à compléter mon bilan, en partant de ce qui manque.",
    foyer: "aide-moi à compléter mon foyer (adultes, enfants, âge, tranche d'imposition).",
    revenus: "aide-moi à compléter mes revenus.",
    protection: "aide-moi à renseigner ma protection (prévoyance, assurance emprunteur).",
    risque: "aide-moi à remplir mon profil de risque.",
    budget: "aide-moi à établir mon budget mensuel. Je peux te donner un relevé bancaire.",
    placements: "aide-moi à mettre à jour mes placements. Je peux te donner mes relevés ou l'export de mon courtier.",
    mouvement: "je veux enregistrer un mouvement sur mes placements (achat, vente, versement, retrait).",
    immobilier: "aide-moi à renseigner mes biens immobiliers et mes crédits.",
    objectifs: "aide-moi à définir ou mettre à jour mes objectifs.",
    regles: "aide-moi à régler mes règles d'alerte et mon épargne de précaution.",
    revue: "faisons ma revue du mois.",
  };
  /** Phrase prête pour la section ; `contexte` (facultatif) précise l'élément concerné, par ex. « la ligne PEA Monde ». */
  function phrase(section, contexte) {
    const objet = SECTIONS[section] || SECTIONS.bilan;
    const ctx = contexte == null || String(contexte).trim() === "" ? "" : " Concerne : " + String(contexte).trim().slice(0, 120) + ".";
    return DEBUT + objet + ctx + FIN;
  }
  return { phrase, SECTIONS };
});
