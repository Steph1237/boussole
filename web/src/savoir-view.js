/* Agent › Savoir : ce que sait l'agent, en deux volets sur une seule page, Fiches (fiches pédagogiques sourcées et chiffres de référence,
   module fiches-view) et Expertises (méthodes d'analyse de Claude, module expertises-view). Ce module ne fait que poser le sélecteur
   Fiches · Expertises (UI.bascule) et montrer l'un des deux volets ; chacun garde sa vue, son store et ses tests.
   Lien profond : #agent/savoir?expertise=<slug> (ancien #agent/expertises?expertise=<slug>) ouvre le volet Expertises ; sans paramètre,
   le volet choisi est gardé tant que la page n'est pas rechargée. Fonctions pures exportées : VOLETS, voletDe. */
(function () {
  "use strict";
  const VOLETS = [{ id: "fiches", label: "Fiches" }, { id: "expertises", label: "Expertises" }];
  /** Volet à montrer : Expertises si le lien profond porte une expertise, sinon le volet choisi, sinon Fiches. */
  const voletDe = (params, choisi) => (params && params.expertise ? "expertises" : VOLETS.some(v => v.id === choisi) ? choisi : "fiches");
  if (typeof module === "object" && module.exports) module.exports = { VOLETS, voletDe };
  if (typeof document === "undefined") return;

  let root = null, choisi = "fiches", ctl = null;
  function montrer(id) {
    choisi = id;
    root.querySelectorAll("[data-sv-volet]").forEach(v => { v.hidden = v.getAttribute("data-sv-volet") !== id; });
    if (ctl) ctl.choisir(id);
  }
  function mount(r) {
    root = r;
    const bas = root.querySelector("#svBascule");
    if (window.UI && bas) ctl = UI.bascule(bas, { label: "Ce que sait Claude", options: VOLETS, actif: choisi, surChange: id => montrer(id) });
    montrer(choisi);
  }
  /* Lien profond : lu sans être consommé (App.parametresActuels), le volet Expertises le lit ensuite lui-même (App.parametres). */
  function show() {
    const p = window.App && typeof App.parametresActuels === "function" ? App.parametresActuels() : {};
    montrer(voletDe(p, choisi));
  }
  const api = { mount, show, update() {} };
  const reg = () => App.register("savoir-view", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
