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
  const IBAN_CHIFFRES_MIN = 12;
  const RE_IBAN = new RegExp(SENSIBLE[0], "g"), RE_CARTE = new RegExp(SENSIBLE[1]), RE_MOTS = new RegExp(SENSIBLE[2], "i");
  const chiffres = s => s.replace(/[^0-9]/g, "").length;
  /** Vrai si le texte ressemble à un IBAN, un numéro de carte ou contient un mot interdit. */
  function estSensible(t) {
    const s = String(t == null ? "" : t);
    for (const m of s.matchAll(RE_IBAN)) if (chiffres(m[0]) >= IBAN_CHIFFRES_MIN) return true;
    return RE_CARTE.test(s) || RE_MOTS.test(s);
  }
  return { SENSIBLE, IBAN_CHIFFRES_MIN, estSensible };
});
