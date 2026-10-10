/* Module fiches-view : squelette d'enregistrement (rempli par sa propre tâche, voir docs/superpowers/plans/2026-10-10-ag1-memoire-savoir.md). */
(function () {
  "use strict";
  function mount() {}
  function update() {}
  const api = { mount, update };
  const reg = () => App.register("fiches-view", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
