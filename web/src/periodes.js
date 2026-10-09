/* Filtres de dates communs aux graphiques d'évolution : période (prédéfinie ou personnalisée), granularité
   (jour → année), agrégation d'une série de stock (valeur de fin de période) et variations. Fonctions pures. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Periodes = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const PERIODES = [
    { id: "1m", label: "1 mois" }, { id: "3m", label: "3 mois" }, { id: "6m", label: "6 mois" }, { id: "ytd", label: "Depuis janvier" },
    { id: "1a", label: "1 an" }, { id: "3a", label: "3 ans" }, { id: "tout", label: "Tout" }, { id: "perso", label: "Personnalisé" },
  ];
  const GRANULARITES = [
    { id: "auto", label: "Auto" }, { id: "jour", label: "Jour" }, { id: "semaine", label: "Semaine" },
    { id: "mois", label: "Mois" }, { id: "trimestre", label: "Trimestre" }, { id: "annee", label: "Année" },
  ];

  /* ---------- dates ISO (AAAA-MM-JJ), calculées en UTC pour éviter les décalages d'heure d'été ---------- */
  const parse = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const iso = d => d.toISOString().slice(0, 10);
  const finMois = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  function moinsMois(s, k) {
    const d = parse(s), y = d.getUTCFullYear(), m = d.getUTCMonth() - k;
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    return iso(new Date(Date.UTC(yy, mm, Math.min(d.getUTCDate(), finMois(yy, mm)))));
  }
  const jours = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);

  /** Bornes { du, au } d'une période prédéfinie (« 3m », « ytd »…) ou personnalisée ({ du, au }). */
  function bornes(periode, today, premiere) {
    if (periode && typeof periode === "object") {
      const a = periode.du || premiere || today, b = periode.au || today;
      return a <= b ? { du: a, au: b } : { du: b, au: a };
    }
    const mois = { "1m": 1, "3m": 3, "6m": 6, "1a": 12, "3a": 36 }[periode];
    if (mois) return { du: moinsMois(today, mois), au: today };
    if (periode === "ytd") return { du: today.slice(0, 4) + "-01-01", au: today };
    return { du: premiere && premiere < today ? premiere : today, au: today };
  }

  /** Granularité lisible selon la durée : jour (≤ 3 mois), semaine (≤ 1 an), mois (≤ 3 ans), trimestre (≤ 10 ans), année. */
  function auto(b) {
    const n = jours(b.du, b.au);
    return n <= 93 ? "jour" : n <= 366 ? "semaine" : n <= 1098 ? "mois" : n <= 3660 ? "trimestre" : "annee";
  }

  /** Clé de la période contenant une date : jour, lundi de la semaine, AAAA-MM, AAAA-Tq, AAAA. */
  function cle(date, g) {
    const s = String(date).slice(0, 10);
    if (g === "semaine") { const d = parse(s); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return iso(d); }
    if (g === "mois") return s.slice(0, 7);
    if (g === "trimestre") return s.slice(0, 4) + "-T" + (Math.floor((+s.slice(5, 7) - 1) / 3) + 1);
    if (g === "annee") return s.slice(0, 4);
    return s;
  }
  const fmt = (d, o) => parse(d).toLocaleDateString("fr-FR", Object.assign({ timeZone: "UTC" }, o));
  /** Libellé court d'une clé de période, pour les axes et infobulles. */
  function libelle(k, g) {
    if (g === "mois") return fmt(k + "-01", { month: "short", year: "numeric" });
    if (g === "trimestre") return k.slice(5) + " " + k.slice(0, 4);
    if (g === "annee") return k;
    if (g === "semaine") return "sem. du " + fmt(k, { day: "numeric", month: "short" });
    return fmt(k, { day: "numeric", month: "short" });
  }

  const propres = (points, get) => (points || []).map(p => ({ p, date: String(p.date).slice(0, 10), v: get(p) }))
    .filter(x => x.v != null && isFinite(+x.v)).map(x => Object.assign(x, { v: +x.v })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  /** Série agrégée sur { du, au } : une valeur par période (dernière observation), variation vs période précédente
      (le premier point est comparé à la dernière observation avant la période, si elle existe). */
  function agreger(points, b, granularite, get) {
    const g = !granularite || granularite === "auto" ? auto(b) : granularite;
    const xs = propres(points, get);
    const avant = xs.filter(x => x.date < b.du).pop();
    const groupes = new Map();
    xs.filter(x => x.date >= b.du && x.date <= b.au).forEach(x => groupes.set(cle(x.date, g), x));
    let prec = avant ? avant.v : null;
    return [...groupes.entries()].map(([k, x]) => {
      const variation = prec == null ? null : x.v - prec;
      const out = { cle: k, date: x.date, label: libelle(k, g), valeur: x.v, variation, variationPct: prec ? variation / prec * 100 : null, granularite: g };
      prec = x.v;
      return out;
    });
  }

  /** Début, fin et variation sur la période (début = dernière valeur avant la période, sinon première de la période). */
  function resume(agreges, points, b, get) {
    if (!agreges || !agreges.length) return { debut: null, fin: null, variation: null, variationPct: null };
    const avant = propres(points, get).filter(x => x.date < b.du).pop();
    const debut = avant ? avant.v : propres(points, get).find(x => x.date >= b.du).v;
    const fin = agreges[agreges.length - 1].valeur;
    return { debut, fin, variation: fin - debut, variationPct: debut ? (fin - debut) / debut * 100 : null };
  }

  return { PERIODES, GRANULARITES, bornes, auto, cle, libelle, agreger, resume };
});
