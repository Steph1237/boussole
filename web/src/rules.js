/* Règles d'alerte paramétrables (config.rules) et contrôles intégrés du Pilotage. Aucun accès au DOM.

   Rules.evaluate(rules, ctx) → [{ level: "crit" | "warn" | "info", title, text, rule }]   (règles de l'utilisateur)
   Rules.builtins(ctx)        → mêmes alertes, rule = null                               (contrôles toujours actifs)
   Rules.all(ctx)             → evaluate(ctx.config.rules) + builtins(ctx)
   Rules.describe(rule, ctx)  → la règle en français (« Aucune ligne au-dessus de 15 % du patrimoine »)
   ctx = { positions, config, scope ∈ foyer | p1 | p2, people: [{ id, nom }], today: "AAAA-MM-JJ", status? }

   Types de règles :
     { type: "max_line_pct", pct }                 une ligne pèse plus de pct % du patrimoine financier (du périmètre)
     { type: "max_bloc_pct", bloc, pct }           une poche dépasse pct %
     { type: "min_bloc_pct", bloc, pct }           une poche est sous pct %
     { type: "price_floor", position_id, price }   cours ≤ seuil (urgent), ou à moins de 10 % du seuil
     { type: "envelope_cap", envelope, cap }       l'enveloppe atteint son plafond de versements
     { type: "stale_prices", days }                lignes cotées sans cours depuis plus de `days` jours
   Contrôles intégrés : écart aux cibles par personne (config.targets, tolerancePts), matelas de précaution
   (config.cushion, en montant ou en mois de dépenses, apprécié sur le foyer), mise à jour nocturne en retard
   (> 2 jours), échéances proches (config.milestones), alertes déposées par la fonction nocturne (status.alerts). */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./calc.js") : null);
  if (isNode) module.exports = api;
  else root.Rules = api;
})(typeof self !== "undefined" ? self : this, function (CalcNode) {
  const C = () => CalcNode || (typeof self !== "undefined" ? self.Calc : null);

  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur = v => nf0.format(Math.round(v)) + " €";
  const eur2 = v => nf2.format(v) + " €";
  const pct = (v, d = 1) => (+v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }) + " %";
  const pctR = v => pct(v, Number.isInteger(+v) ? 0 : 1); // seuils saisis : « 15 % », « 2,5 % »
  const sgn = v => (v > 0 ? "+" : "");
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  const frDate = d => (d ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const num = v => (v == null || v === "" || !isFinite(+v) ? null : +v);

  const TYPES = {
    max_line_pct: { label: "Plafond par ligne", fields: ["pct"] },
    max_bloc_pct: { label: "Plafond par poche", fields: ["bloc", "pct"] },
    min_bloc_pct: { label: "Plancher par poche", fields: ["bloc", "pct"] },
    price_floor: { label: "Seuil de cours (ordre stop)", fields: ["position_id", "price"] },
    envelope_cap: { label: "Plafond d'enveloppe", fields: ["envelope", "cap"] },
    stale_prices: { label: "Cours trop anciens", fields: ["days"] },
  };

  /* ---------- périmètre ---------- */
  const DEFAULT_NOMS = { p1: "Moi", p2: "Conjoint(e)" };
  const nomOf = (ctx, id) => { const p = (ctx.people || []).find(x => x.id === id); return (p && p.nom) || DEFAULT_NOMS[id] || id; };
  const rangOf = id => (id === "p2" ? 2 : 1);
  const scopeDe = ctx => (ctx.scope === "foyer" || !ctx.scope ? "du foyer" : C().deNom(nomOf(ctx, ctx.scope), rangOf(ctx.scope)));
  const scopeOf = ctx => ctx.scope || "foyer";
  const live = ctx => (ctx.positions || []).filter(p => C().counted(p) && C().inScope(p, scopeOf(ctx)));
  const totalOf = list => list.reduce((a, p) => a + C().val(p), 0);
  const today = ctx => ctx.today || new Date().toISOString().slice(0, 10);

  /* ---------- règles de l'utilisateur ---------- */
  const EVAL = {
    max_line_pct(r, ctx) {
      const lim = num(r.pct); if (lim == null) return [];
      const L = live(ctx), tot = totalOf(L); if (!tot) return [];
      return L.map(p => ({ p, w: C().val(p) / tot * 100 })).filter(x => x.w > lim).sort((a, b) => b.w - a.w)
        .map(({ p, w }) => ({ level: "warn", title: "Ligne trop lourde : " + p.name, text: pct(w) + " du patrimoine financier " + scopeDe(ctx) + " (plafond " + pctR(lim) + ")." }));
    },
    max_bloc_pct(r, ctx) {
      const lim = num(r.pct); if (lim == null || !r.bloc) return [];
      const L = live(ctx), tot = totalOf(L); if (!tot) return [];
      const w = totalOf(L.filter(p => p.bloc === r.bloc)) / tot * 100;
      return w > lim ? [{ level: "warn", title: "Poche " + r.bloc + " au-dessus de " + pctR(lim), text: pct(w) + " du patrimoine financier " + scopeDe(ctx) + "." }] : [];
    },
    min_bloc_pct(r, ctx) {
      const lim = num(r.pct); if (lim == null || !r.bloc) return [];
      const L = live(ctx), tot = totalOf(L); if (!tot) return [];
      const w = totalOf(L.filter(p => p.bloc === r.bloc)) / tot * 100;
      return w < lim ? [{ level: "info", title: "Poche " + r.bloc + " sous " + pctR(lim), text: pct(w) + " du patrimoine financier " + scopeDe(ctx) + "." }] : [];
    },
    price_floor(r, ctx) {
      const floor = num(r.price); if (floor == null || floor <= 0) return [];
      const p = (ctx.positions || []).find(x => x.id === r.position_id);
      if (!p || !C().counted(p) || !C().inScope(p, scopeOf(ctx)) || p.price == null) return [];
      const price = +p.price, d = (price / floor - 1) * 100;
      if (price <= floor) return [{ level: "crit", title: "Seuil de cours touché : " + p.name, text: "Seuil atteint : vérifiez votre ordre stop. Cours " + eur2(price) + " pour un seuil de " + eur2(floor) + "." }];
      if (d < 10) return [{ level: "warn", title: p.name + " proche de son seuil", text: "Cours " + eur2(price) + ", à " + pct(d) + " du seuil de " + eur2(floor) + "." }];
      return [];
    },
    envelope_cap(r, ctx) {
      const cap = num(r.cap); if (cap == null || cap <= 0 || !r.envelope) return [];
      const all = (ctx.positions || []).filter(p => p.envelope === r.envelope && C().counted(p));
      if (!all.some(p => C().inScope(p, scopeOf(ctx)))) return [];
      const v = totalOf(all);
      return v >= cap ? [{ level: "warn", title: r.envelope + " au plafond", text: eur(v) + " pour un plafond de " + eur(cap) + " : dirigez les prochains versements ailleurs." }] : [];
    },
    stale_prices(r, ctx) {
      const days = num(r.days); if (days == null) return [];
      const t = today(ctx);
      const stale = live(ctx).filter(p => p.mode === "market" && (!p.priceDate || daysBetween(p.priceDate, t) > days));
      if (!stale.length) return [];
      return [{ level: "info", title: "Cours anciens", text: stale.length + (stale.length > 1 ? " lignes" : " ligne") + " sans cours depuis plus de " + days + " jour" + (days > 1 ? "s" : "") + " : " + stale.slice(0, 4).map(p => p.name).join(", ") + (stale.length > 4 ? "…" : "") + "." }];
    },
  };

  function evaluate(rules, ctx) {
    const out = [];
    (Array.isArray(rules) ? rules : []).forEach(r => {
      const f = r && EVAL[r.type]; if (!f) return;
      try { f(r, ctx || {}).forEach(a => out.push(Object.assign(a, { rule: r }))); } catch (e) { if (typeof console !== "undefined") console.error("Règle invalide", r, e); }
    });
    return out;
  }

  /* ---------- contrôles intégrés ---------- */
  function builtins(ctx) {
    ctx = ctx || {};
    const A = [], cfg = ctx.config || {}, t = today(ctx), add = (level, title, text) => A.push({ level, title, text, rule: null });
    const positions = ctx.positions || [], people = ctx.people && ctx.people.length ? ctx.people : [{ id: "p1", nom: DEFAULT_NOMS.p1 }];
    // Écart aux cibles, par personne (toutes au périmètre Foyer, sinon la personne choisie).
    const tg = cfg.targets || {}, tol = num(tg.tolerancePts) ?? 3;
    const who = scopeOf(ctx) === "foyer" ? people.map(p => p.id) : [ctx.scope];
    who.forEach(id => {
      const targets = tg[id]; if (!targets || typeof targets !== "object") return;
      const L = positions.filter(p => p.owner === id && C().counted(p)), tot = totalOf(L); if (!tot) return;
      const by = {}; L.forEach(p => { by[p.bloc] = (by[p.bloc] || 0) + C().val(p); });
      const suffix = who.length > 1 ? " (" + nomOf(ctx, id) + ")" : "";
      Object.keys(targets).forEach(k => {
        const cible = num(targets[k]); if (cible == null) return;
        const cur = (by[k] || 0) / tot * 100, gap = cur - cible;
        if (Math.abs(gap) > tol) add(Math.abs(gap) > tol * 2 ? "warn" : "info", "Poche " + k + " " + (gap > 0 ? "au-dessus" : "en dessous") + " de la cible" + suffix,
          pct(cur) + " contre " + pct(cible) + " visés (" + sgn(gap) + gap.toFixed(1).replace(".", ",") + " pts).");
      });
    });
    // Matelas : épargne de précaution du foyer (poche « Épargne », lignes comptées).
    const m = C().matelas(cfg);
    if (m && m.min > 0) {
      const cush = totalOf(positions.filter(p => p.bloc === "Épargne" && C().counted(p)));
      const cible = m.mode === "months" ? " (" + nf0.format(m.months) + " mois de dépenses)" : "";
      if (cush < m.min) add("info", "Matelas sous la cible", eur(cush) + " d'épargne disponible contre " + eur(m.min) + " visés" + cible + ".");
      else if (m.max != null && m.max > 0 && cush > m.max) add("info", "Matelas au-dessus de la cible", eur(cush) + " d'épargne disponible pour une cible de " + eur(m.min) + " à " + eur(m.max) + " : " + eur(cush - m.max) + " pourraient être placés.");
    }
    // Mise à jour nocturne.
    const st = ctx.status || null;
    if (st && st.lastRun && daysBetween(String(st.lastRun).slice(0, 10), t) > 2) add("warn", "Mise à jour nocturne en retard", "Dernier passage le " + frDate(String(st.lastRun).slice(0, 10)) + ".");
    (st && Array.isArray(st.alerts) ? st.alerts : []).forEach(a => a && add(["crit", "warn", "info"].includes(a.level) ? a.level : "info", a.title || "Alerte", a.text || ""));
    // Échéances.
    (Array.isArray(cfg.milestones) ? cfg.milestones : []).forEach(ms => {
      if (!ms || !ms.date) return;
      const d = daysBetween(t, ms.date);
      if (d >= 0 && d <= (num(ms.warnDays) ?? 60)) add("info", ms.title || "Échéance", "Le " + frDate(ms.date) + " (dans " + d + " jour" + (d > 1 ? "s" : "") + "). " + (ms.text || ""));
    });
    return A;
  }

  function all(ctx) {
    const cfg = (ctx && ctx.config) || {};
    return evaluate(cfg.rules || [], ctx).concat(builtins(ctx));
  }

  /* ---------- règles en français ---------- */
  function describe(r, ctx) {
    ctx = ctx || {};
    if (!r || !TYPES[r.type]) return "Règle inconnue";
    switch (r.type) {
      case "max_line_pct": return "Aucune ligne au-dessus de " + pctR(r.pct) + " du patrimoine";
      case "max_bloc_pct": return "Poche " + r.bloc + " au plus à " + pctR(r.pct) + " du patrimoine";
      case "min_bloc_pct": return "Poche " + r.bloc + " au moins à " + pctR(r.pct) + " du patrimoine";
      case "price_floor": { const p = (ctx.positions || []).find(x => x.id === r.position_id), nm = p ? p.name : String(r.position_id); return "Seuil de cours " + (/^[aeiouyhàâéèêîôû]/i.test(nm) ? "d'" : "de ") + nm + " : " + eur2(+r.price); }
      case "envelope_cap": return "Plafond de l'enveloppe " + r.envelope + " : " + eur(+r.cap);
      case "stale_prices": return "Cours de plus de " + r.days + " jour" + (+r.days > 1 ? "s" : "") + " signalés";
    }
    return "";
  }

  /* Valide et normalise une règle saisie ; renvoie { rule } ou { error }. */
  function normalize(r) {
    if (!r || !TYPES[r.type]) return { error: "Type de règle inconnu." };
    const out = { type: r.type };
    for (const f of TYPES[r.type].fields) {
      if (f === "bloc" || f === "envelope" || f === "position_id") {
        const v = String(r[f] == null ? "" : r[f]).trim(); if (!v) return { error: "Choisissez " + ({ bloc: "une poche", envelope: "une enveloppe", position_id: "une ligne" }[f]) + "." };
        out[f] = v;
      } else {
        const v = num(r[f]);
        if (v == null || v <= 0) return { error: ({ pct: "Indiquez un pourcentage positif.", price: "Indiquez un cours positif.", cap: "Indiquez un plafond positif.", days: "Indiquez un nombre de jours positif." }[f]) };
        if (f === "pct" && v > 100) return { error: "Le pourcentage ne peut pas dépasser 100." };
        out[f] = f === "days" ? Math.round(v) : v;
      }
    }
    return { rule: out };
  }

  return { TYPES, evaluate, builtins, all, describe, normalize };
});
