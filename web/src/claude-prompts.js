/* Phrases « Compléter avec Claude » : la saisie se fait dans l'assistant de l'utilisateur (spec
   docs/superpowers/specs/2026-10-11-saisie-par-agent.md). Chaque bouton de l'app ouvre Claude avec une phrase prête qui active
   l'agent Boussole sur la bonne section et lui demande d'utiliser les formulaires interactifs. Pur, sans DOM, au tutoiement.
   ClaudePrompts.phrase(section, contexte?) → texte ; ClaudePrompts.SECTIONS → sections connues.
   Section « calendrier » (DAT1) : le contexte est la donnée à compléter (« la date d'ouverture de mon PEA Exemple »), intégrée à la demande.
   Section « expertise » (EX1) : le contexte est le nom de l'expertise, intégré à la demande (« consulte l'expertise <nom> sur ma
   situation. ») au lieu d'être ajouté en « Concerne : … ».
   ClaudePrompts.PROMPT_TACHE = { revue_mensuelle } : prompt exact de la tâche planifiée de Claude (« Tâches planifiées »), le même
   que PROMPT_TACHE dans supabase/functions/mcp/routines.ts (test d'égalité côté connecteur). */
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
    regles: "aide-moi à régler mes règles d'alerte et la cible de mon matelas de précaution.",
    versements: "aide-moi à régler mes versements programmés (montant, jour du mois, ligne qui les reçoit).",
    revue: "faisons ma revue du mois (demarrer_routine, type revue_mensuelle).",
    routine: "réponds avec moi aux questions de ma revue mensuelle (demarrer_routine, puis le formulaire, puis questions_routine).",
    expertise: "consulte l'expertise adaptée à ma question sur ma situation.",
    calendrier: "aide-moi à compléter mon calendrier patrimonial (calendrier) : les dates d'ouverture de mes enveloppes, ma date de naissance, la fin de mes prêts. Pars de mes documents et demande-moi seulement ce qui manque, une seule fois.",
  };
  /* Sections dont le contexte fait partie de la demande elle-même (plutôt qu'un « Concerne : … » ajouté). */
  const AVEC_CONTEXTE = {
    expertise: nom => "consulte l'expertise " + nom + " sur ma situation.",
    /* Calendrier patrimonial (DAT1) : la donnée à compléter (« la date d'ouverture de mon PEA Exemple »). */
    calendrier: info => "je veux compléter " + info + ". Lis cette information dans le document que je te donne, sinon demande-la-moi une seule fois.",
  };
  /* Prompt des tâches planifiées, par type de routine (contrat RT1, docs/superpowers/plans/2026-10-11-rt1-routines.md). */
  const PROMPT_TACHE = Object.freeze({
    revue_mensuelle: "Boussole : fais ma revue mensuelle. Appelle demarrer_routine avec le type revue_mensuelle et suis la conduite qu'il renvoie.",
  });
  const CONTEXTE_MAX = 120;
  /** Contexte borné à CONTEXTE_MAX caractères : coupé au dernier espace (jamais en plein mot, sauf mot unique trop long), avec « … ».
      Court : point final, sauf s'il finit déjà par une ponctuation forte (une question garde son « ? »). */
  function borner(t) {
    if (t.length <= CONTEXTE_MAX) return /[.?!…]$/.test(t) ? t : t + ".";
    const coupe = t.slice(0, CONTEXTE_MAX), i = coupe.lastIndexOf(" ");
    return (i > 0 ? coupe.slice(0, i) : coupe.slice(0, CONTEXTE_MAX - 1)).replace(/[\s,;:.«(–—-]+$/, "") + "…";
  }
  /** Phrase prête pour la section ; `contexte` (facultatif) précise l'élément concerné, par ex. « la ligne PEA Monde ». */
  function phrase(section, contexte) {
    const objet = SECTIONS[section] || SECTIONS.bilan;
    const t = contexte == null ? "" : String(contexte).replace(/\s+/g, " ").trim();
    if (t && AVEC_CONTEXTE[section]) return DEBUT + AVEC_CONTEXTE[section](borner(t).replace(/[.?!]$/, "")) + FIN;
    return DEBUT + objet + (t ? " Concerne : " + borner(t) : "") + FIN;
  }
  return { phrase, SECTIONS, PROMPT_TACHE };
});
