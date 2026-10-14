/* Web Worker du moteur de projection (PROJ, spec § 9) : charge les modules purs, reçoit { data, options, etapes }, renvoie un résultat par étape
   ({ etape, resultat }) : d'abord 500 chemins, puis 2 000 (même graine, les premiers chemins sont communs). Même code que sur le fil principal.
   Sous Node (tests), exporte traiter(message, publier) pour simuler un worker sans fil séparé. */
(function () {
  "use strict";
  const noeud = typeof module === "object" && module.exports;
  if (!noeud) {
    importScripts("calc.js", "reperes.js", "calendrier.js", "plan.js", "marche.js", "projection-outils.js", "projection-fiscalite.js", "projection-evenements.js",
      "projection-credit.js", "projection-donnees.js", "projection-immo.js", "projection.js");
  }
  const Projection = noeud ? require("./projection.js") : self.Projection;
  /** Traite un message du fil principal ; publie chaque étape. */
  function traiter(msg, publier) {
    try {
      const etapes = Array.isArray(msg.etapes) && msg.etapes.length ? msg.etapes : [2000];
      const o = msg.options || {}, M = Projection.preparer(msg.data, o);
      etapes.forEach((n, k) => publier({ etape: k, resultat: Projection.simuler(M, { chemins: n, graine: o.graine, volatilite: o.volatilite }) }));
    } catch (e) {
      publier({ erreur: String((e && e.message) || e) });
    }
  }
  if (noeud) module.exports = { traiter };
  else self.onmessage = ev => traiter(ev.data, m => self.postMessage(m));
})();
