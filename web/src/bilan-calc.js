/* Calculs de la page Bilan : composition du patrimoine, allocation, flux du mois, évolution. Fonctions pures. */
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./calc.js") : root.Calc);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BilanCalc = api;
})(typeof self !== "undefined" ? self : this, function (Calc) {
  "use strict";
  const n = v => (isFinite(+v) ? +v : 0);
  const pos = v => Math.max(0, n(v));
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const desc = (a, b) => b.montant - a.montant;
  const biens = p => (p && Array.isArray(p.biens) ? p.biens : []);
  const credits = p => (p && Array.isArray(p.credits) ? p.credits : []);
  const comptes = (positions, scope) => (positions || []).filter(p => Calc.inScope(p, scope) && Calc.counted(p));

  /** Ce que je possède (financier par enveloppe, chaque bien, autres actifs) et ce que je dois (chaque dette). */
  function composition(positions, profil, scope) {
    const parEnv = {};
    comptes(positions, scope).forEach(p => { const k = p.envelope || "Sans enveloppe"; parEnv[k] = (parEnv[k] || 0) + Calc.val(p); });
    const fin = Object.keys(parEnv).map(k => ({ label: k, montant: parEnv[k] })).sort(desc);
    const immo = biens(profil).map(b => ({ label: b.nom || "Bien", montant: pos(b.valeur) * Calc.part(scope, b.part_p1) })).filter(l => l.montant > 0).sort(desc);
    const a = Calc.autresActifs(profil, scope);
    const autres = [{ label: "Voiture, meubles…", montant: a.usage }, { label: "Parts d'entreprise", montant: a.entreprise }].filter(l => l.montant > 0);
    const dettes = biens(profil).map(b => ({ label: b.nom || "Bien", montant: pos(b.crd) * Calc.part(scope, b.part_p1) }))
      .concat(credits(profil).map(c => ({ label: c.nom || "Crédit", montant: pos(c.crd) * Calc.partCredit(scope, c.owner) })))
      .filter(l => l.montant > 0).sort(desc);
    const bloc = (cle, label, lignes) => ({ cle, label, lignes, total: sum(lignes, l => l.montant) });
    const actifs = [bloc("financier", "Placements financiers", fin), bloc("immobilier", "Immobilier", immo), bloc("autres", "Autres biens", autres)];
    const d = bloc("dettes", "Dettes", dettes);
    const brut = sum(actifs, x => x.total);
    return { actifs, dettes: d, brut, net: brut - d.total };
  }

  /** Répartition triée { cle, label, montant, pct } ; mode « classe », « liquidite » ou « enveloppe ».
      L'immobilier physique du profil rejoint la classe Immobilier / « Bloqué », sauf opts.financierSeul. */
  function allocation(positions, profil, scope, mode, opts) {
    const o = opts || {};
    const immo = o.financierSeul ? 0 : sum(biens(profil), b => pos(b.valeur) * Calc.part(scope, b.part_p1));
    let m, labels;
    if (mode === "liquidite") { m = Calc.parLiquidite(positions, scope); labels = Calc.LIQUIDITE_LABELS; if (immo) m.bloque = (m.bloque || 0) + immo; }
    else if (mode === "enveloppe") {
      m = {}; labels = {};
      comptes(positions, scope).forEach(p => { const k = p.envelope || "Sans enveloppe"; m[k] = (m[k] || 0) + Calc.val(p); labels[k] = k; });
      if (immo) { m.__immo = immo; labels.__immo = "Biens immobiliers"; }
    } else { m = Calc.parClasse(positions, scope, o.surcharge); labels = Calc.CLASSES_LABELS; if (immo) m.immobilier = (m.immobilier || 0) + immo; }
    const total = sum(Object.values(m), v => v);
    return Object.keys(m).filter(k => m[k] > 0)
      .map(k => ({ cle: k, label: labels[k] || k, montant: m[k], pct: total ? m[k] / total * 100 : 0 }))
      .sort(desc);
  }

  /** Flux du mois à partir de Plan.budgetTotaux : sorties en % des revenus (dépenses par catégorie, épargne, reste). */
  function flux(t) {
    const tt = t || {};
    const revenus = pos(tt.revenus);
    const vide = revenus <= 0 && pos(tt.depenses) <= 0;
    const pc = v => (revenus ? Math.round(v / revenus * 100) : 0);
    const cats = Object.entries(tt.parCategorie || {}).filter(([, v]) => v > 0).map(([label, montant]) => ({ label, montant, type: "depense" })).sort(desc);
    const sorties = cats
      .concat(pos(tt.epargne) > 0 ? [{ label: "Épargne", montant: pos(tt.epargne), type: "epargne" }] : [])
      .concat(n(tt.reste) > 0 ? [{ label: "Reste", montant: n(tt.reste), type: "reste" }] : [])
      .map(s => Object.assign(s, { pct: pc(s.montant) }));
    return { revenus, sorties, deficit: n(tt.reste) < 0, manque: Math.max(0, -n(tt.reste)), vide };
  }

  /** Évolution : financier des photos + net estimé (immobilier, autres biens et dettes d'aujourd'hui) + point du jour. */
  function evolution(snapshots, positions, profil, scope, today) {
    const c = composition(positions, profil, scope);
    const horsFin = c.brut - c.actifs[0].total - c.dettes.total;
    const live = Calc.financier(positions, scope);
    const pts = (snapshots || []).filter(s => s && s[scope] != null && s.date !== today)
      .map(s => ({ date: s.date, financier: +s[scope], net: +s[scope] + horsFin, live: false }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    pts.push({ date: today, financier: live, net: live + horsFin, live: true });
    return pts;
  }

  return { composition, allocation, flux, evolution };
});
