/* Calcul des scénarios hors du fil principal (SCN1, spec § 10.2 et § 10.3) : un seul code pour le Web Worker et pour le repli sur le fil principal.
   - Dans un worker (new Worker("app/scenarios-worker.js")) : charge les modules purs par importScripts et répond aux messages ;
   - dans la page (script chargé par build.mjs) : expose window.ScenariosCalcul = { traiter } pour le repli sans worker ;
   - sous Node (tests) : module.exports = { traiter }.
   Messages : { type: "cartes", catalogue, data, joues, today, opts } → { type: "cartes", dernier: true, resultat } (Scenarios.lister à 500 chemins, plus
   `manquants_questions` pour les cartes « à compléter » : les libellés des questions qui manquent) ;
   { type: "jouer", entree, data, reponses, today, etapes: [500, 2000] } → { type: "jouer", etape, chemins, dernier, resultat } par étape (mêmes tirages,
   les premiers chemins sont communs). Une erreur → { erreur }. Aucun texte ne vient d'ailleurs que de Scenarios. */
(function (root) {
  "use strict";
  const noeud = typeof module === "object" && module.exports;
  const dansWorker = !noeud && typeof importScripts === "function" && typeof window === "undefined";
  if (dansWorker) {
    importScripts("calc.js", "reperes.js", "calendrier.js", "plan.js", "marche.js", "projection-outils.js", "projection-fiscalite.js", "projection-evenements.js",
      "projection-credit.js", "projection-donnees.js", "projection.js", "projection-immo.js", "scenarios.js");
  }
  const Sc = () => (noeud ? require("./scenarios.js") : root.Scenarios);

  /** Cartes du catalogue : Scenarios.lister, puis, pour une carte « à compléter », les questions qui manquent (jouer s'arrête avant de simuler). */
  function cartes(msg) {
    const S = Sc(), o = msg.opts || {}, cat = Array.isArray(msg.catalogue) ? msg.catalogue : [];
    const L = S.lister(cat, msg.data, msg.joues || [], msg.today, o);
    L.cartes.forEach(c => {
      if (c.enjeu_statut !== "a_completer") return;
      const e = cat.find(x => x.cle === c.cle);
      try {
        const r = S.jouer(e, msg.data, (o.reponses_par_cle || {})[c.cle] || {}, msg.today, { chemins: 500, enjeu: true });
        c.manquants_questions = (r.manquants || []).map(m => m.libelle);
      } catch (err) { c.manquants_questions = []; }
    });
    return L;
  }
  /** Traite un message ; publie chaque réponse (une par étape pour « jouer »). */
  function traiter(msg, publier) {
    try {
      if (msg && msg.type === "cartes") { publier({ type: "cartes", dernier: true, resultat: cartes(msg) }); return; }
      if (msg && msg.type === "jouer") {
        const etapes = Array.isArray(msg.etapes) && msg.etapes.length ? msg.etapes : [2000];
        etapes.forEach((n, k) => {
          const r = Sc().jouer(msg.entree, msg.data, msg.reponses || {}, msg.today, { chemins: n });
          publier({ type: "jouer", etape: k, chemins: n, dernier: k === etapes.length - 1 || r.statut !== "ok", resultat: r });
          if (r.statut !== "ok") throw { arret: true };
        });
        return;
      }
      publier({ erreur: "message inconnu" });
    } catch (e) {
      if (e && e.arret) return;
      publier({ erreur: String((e && e.message) || e) });
    }
  }
  const api = { traiter, cartes };
  if (noeud) module.exports = api;
  else if (dansWorker) root.onmessage = ev => traiter(ev.data, m => root.postMessage(m));
  else root.ScenariosCalcul = api;
})(typeof self !== "undefined" ? self : this);
