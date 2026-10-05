/* Réel / scénario / exemple : traduit le store en valeurs prêtes pour la Toise et le Simulateur,
   et mémorise (dans ce navigateur) les champs que l'utilisateur a modifiés pour tester un scénario. */
(function () {
  const KEY = "reel-v1";
  let mem = { ov: {}, prefs: { partPlacements: 0, inclureARecevoir: false } };
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && typeof s === "object") mem = { ov: s.ov || {}, prefs: Object.assign(mem.prefs, s.prefs || {}) }; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {} };

  /* Valeurs réelles pour le périmètre courant. `has` dit, champ par champ, si la donnée existe vraiment. */
  function values(snap) {
    const C = window.Calc, sc = snap.scope, pr = snap.profil;
    const f = (pr && pr.foyer) || {}, ps = (pr && pr.personnes) || {};
    const who = sc === "couple" ? "steph" : sc;
    const pat = C.patrimoine(snap.positions, pr, sc);
    const apport = C.apportDisponible(snap.positions, snap.config, sc, mem.prefs);
    const salNet = k => C.salaireNetMensuel(ps[k]);
    const has = {
      positions: snap.positions.length > 0,
      foyer: f.adultes != null,
      age: !!f.age,
      tmi: f.tmi != null,
      salaire: (ps[who] && +ps[who].salaire > 0) || false,
      revenus: sc === "couple" ? (salNet("steph") + salNet("compagne")) > 0 : salNet(sc) > 0,
      patrimoine: !!pr && (Array.isArray(pr.biens) || Array.isArray(pr.credits)),
    };
    return {
      scope: sc, who, has, profilVide: !pr,
      patrimoine: pat,
      revenusFoyer: C.revenusFoyer(pr, sc),
      revenusSansLoyers: C.revenusFoyer(pr ? Object.assign({}, pr, { biens: (pr.biens || []).map(b => Object.assign({}, b, { loyer: 0 })) }) : pr, sc),
      loyers: (pr && pr.biens || []).reduce((a, b) => a + Math.max(0, +b.loyer || 0) * C.part(sc, b.partSteph), 0),
      mensualites: C.mensualites(pr, sc),
      apport,
      foyer: {
        adultes: sc === "couple" ? (f.adultes != null ? +f.adultes : null) : 1,
        enfants: f.enfants != null ? +f.enfants : null,
        enfants14: f.enfants14 != null ? +f.enfants14 : null,
        union: f.union || null, age: f.age || null, tmi: f.tmi != null ? +f.tmi : null,
      },
      personne: Object.assign({ salaire: 0, salaireUnite: "nm", statut: "nc", csp: "", essai: false, autresRevenus: 0 }, ps[who] || {}),
      salaireNet: salNet(who),
    };
  }

  const Reel = {
    values,
    prefs: () => mem.prefs,
    setPref(k, v) { mem.prefs[k] = v; save(); window.Store && window.Store.emit(); },
    isOverridden: (mod, k) => !!(mem.ov[mod] && mem.ov[mod][k]),
    override(mod, k) { (mem.ov[mod] = mem.ov[mod] || {})[k] = true; save(); },
    clear(mod, k) { if (mem.ov[mod]) { delete mem.ov[mod][k]; save(); } },
    clearAll(mod) { delete mem.ov[mod]; save(); },
    /* Pastille : "reel" | "scen" | "ex". Une pastille scénario est un bouton qui rétablit le réel. */
    tag(kind, mod, k) {
      if (kind === "scen") return '<button type="button" class="src-tag scen" data-reel-reset="' + mod + ":" + k + '" title="Revenir à la valeur réelle">scénario ↺</button>';
      if (kind === "reel") return '<span class="src-tag reel" title="Repris de vos données">réel</span>';
      return '<span class="src-tag ex" title="Valeur d\'exemple : complétez votre profil">exemple</span>';
    },
    kind(mod, k, hasReal) { return Reel.isOverridden(mod, k) ? "scen" : hasReal ? "reel" : "ex"; },
  };
  window.Reel = Reel;
})();
