/* Calculs patrimoniaux purs, partagés par tous les onglets. Aucun accès au DOM. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== "undefined" ? self : this, function () {
  const n = v => (isFinite(+v) ? +v : 0);
  const pos = v => Math.max(0, n(v));

  /* ---------- positions du Pilotage ---------- */
  function val(p) {
    if (p.mode === "market" && p.qty != null && p.price != null) return p.qty * p.price;
    return n(p.value);
  }
  const counted = p => p.status !== "à recevoir" && p.status !== "clôturé";
  const inScope = (p, scope) => scope === "couple" || p.owner === scope;
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

  function financier(positions, scope) {
    return sum((positions || []).filter(p => inScope(p, scope) && counted(p)), val);
  }
  function poche(positions, scope, bloc) {
    return sum((positions || []).filter(p => inScope(p, scope) && counted(p) && p.bloc === bloc), val);
  }
  function aRecevoir(positions, scope) {
    return sum((positions || []).filter(p => inScope(p, scope) && p.status === "à recevoir"), val);
  }

  /* ---------- profil ---------- */
  function part(scope, partSteph) {
    const s = Math.min(100, Math.max(0, partSteph == null ? 50 : n(partSteph))) / 100;
    return scope === "couple" ? 1 : scope === "steph" ? s : 1 - s;
  }
  function partCredit(scope, owner) {
    if (scope === "couple") return 1;
    if (owner === "commun") return 0.5;
    return owner === scope ? 1 : 0;
  }
  const biens = pr => (pr && Array.isArray(pr.biens) ? pr.biens : []);
  const credits = pr => (pr && Array.isArray(pr.credits) ? pr.credits : []);
  const scopePeople = scope => (scope === "couple" ? ["steph", "compagne"] : [scope]);

  function immobilier(profil, scope) {
    return sum(biens(profil), b => pos(b.valeur) * part(scope, b.partSteph));
  }
  function dettes(profil, scope) {
    return sum(biens(profil), b => pos(b.crd) * part(scope, b.partSteph)) +
      sum(credits(profil), c => pos(c.crd) * partCredit(scope, c.owner));
  }
  function mensualites(profil, scope) {
    return sum(biens(profil), b => pos(b.mensualite) * part(scope, b.partSteph)) +
      sum(credits(profil), c => pos(c.mensualite) * partCredit(scope, c.owner));
  }
  function autresActifs(profil, scope) {
    const a = (profil && profil.autres) || {};
    return scopePeople(scope).reduce((o, k) => {
      o.usage += pos(a[k] && a[k].usage);
      o.entreprise += pos(a[k] && a[k].entreprise);
      return o;
    }, { usage: 0, entreprise: 0 });
  }
  function patrimoine(positions, profil, scope) {
    const f = financier(positions, scope), i = immobilier(profil, scope), a = autresActifs(profil, scope), d = dettes(profil, scope);
    const brut = f + i + a.usage + a.entreprise;
    return { financier: f, immobilier: i, usage: a.usage, entreprise: a.entreprise, dettes: d, brut, net: brut - d };
  }

  /* Taux brut → net de la toise : 0,75 cadre, 0,78 non-cadre. */
  const brutRate = statut => (statut === "cadre" ? 0.75 : 0.78);
  function salaireNetMensuel(p) {
    if (!p) return 0;
    const v = pos(p.salaire), r = brutRate(p.statut);
    switch (p.salaireUnite) {
      case "na": return v / 12;
      case "bm": return v * r;
      case "ba": return v * r / 12;
      default: return v;
    }
  }
  function revenusFoyer(profil, scope) {
    const ps = (profil && profil.personnes) || {};
    const sal = sum(scopePeople(scope), k => salaireNetMensuel(ps[k]) + pos(ps[k] && ps[k].autresRevenus));
    return sal + sum(biens(profil), b => pos(b.loyer) * part(scope, b.partSteph));
  }

  /* Apport : épargne au-delà du matelas (règle de Stéph), + part des placements, + « à recevoir » en option. */
  function apportDisponible(positions, config, scope, opts) {
    const o = opts || {};
    const epargne = poche(positions, scope, "Épargne");
    const matelas = scope === "compagne" ? 0 : n(config && config.cushion && config.cushion.min);
    const libre = Math.max(0, epargne - matelas);
    const autres = financier(positions, scope) - epargne;
    const placements = Math.max(0, autres) * Math.min(100, Math.max(0, n(o.partPlacements))) / 100;
    const rec = o.inclureARecevoir ? aRecevoir(positions, scope) : 0;
    return { epargne, matelas, libre, placements, aRecevoir: rec, total: libre + placements + rec };
  }

  /* ---------- complétude et validation ---------- */
  function checks(profil) {
    const f = (profil && profil.foyer) || {}, ps = (profil && profil.personnes) || {};
    const has = v => v !== undefined && v !== null && v !== "";
    const list = [
      ["Taille du foyer", has(f.adultes)],
      ["Âge", has(f.age)],
      ["Tranche d'imposition", has(f.tmi)],
      ["Salaire de Stéph", pos(ps.steph && ps.steph.salaire) > 0],
      ["Statut de Stéph", has(ps.steph && ps.steph.statut)],
      ["Patrimoine hors Pilotage", !!profil && (Array.isArray(profil.biens) || Array.isArray(profil.credits))],
    ];
    if (n(f.adultes) >= 2) list.push(
      ["Salaire de la compagne", pos(ps.compagne && ps.compagne.salaire) > 0],
      ["Statut de la compagne", has(ps.compagne && ps.compagne.statut)]);
    return list;
  }
  function completude(profil) {
    if (!profil) return 0;
    const c = checks(profil);
    return Math.round(c.filter(x => x[1]).length / c.length * 100);
  }
  const manquants = profil => checks(profil).filter(x => !x[1]).map(x => x[0]);

  function valider(profil) {
    const erreurs = [], avertissements = [];
    biens(profil).forEach(b => {
      const nom = b.nom || "Bien sans nom";
      if (n(b.partSteph) < 0 || n(b.partSteph) > 100) erreurs.push(nom + " : la quote-part doit être comprise entre 0 et 100 %.");
      ["valeur", "crd", "mensualite", "loyer"].forEach(k => { if (n(b[k]) < 0) erreurs.push(nom + " : les montants ne peuvent pas être négatifs."); });
      if (pos(b.crd) > pos(b.valeur) && pos(b.valeur) > 0) avertissements.push(nom + " : le capital restant dû dépasse la valeur du bien.");
    });
    credits(profil).forEach(c => {
      if (n(c.crd) < 0 || n(c.mensualite) < 0) erreurs.push((c.nom || "Crédit sans nom") + " : les montants ne peuvent pas être négatifs.");
    });
    return { erreurs: [...new Set(erreurs)], avertissements };
  }

  return { val, counted, inScope, financier, poche, aRecevoir, part, partCredit, immobilier, dettes, mensualites,
    autresActifs, patrimoine, brutRate, salaireNetMensuel, revenusFoyer, apportDisponible, completude, manquants, valider };
});
