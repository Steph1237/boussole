/* Formats uniques des nombres, montants, pourcentages et dates (UX1, brief § 2.6) : une seule règle dans toute l'app.
   Global Fmt (navigateur) ou module (Node) ; UI.fmtEUR, UI.fmtPct… sont des alias (ui.js). Pur, sans DOM, sans dépendance.

   Conventions : espace fine insécable (U+202F) pour les milliers, espace insécable (U+00A0) avant « € », « k€ », « M€ » et « % » (écart voulu avec le brief,
   qui disait U+202F partout : la fine collait le symbole au chiffre à 16 px) ; signe « − » typographique (U+2212, jamais le tiret) ;
   « + » explicite pour une hausse quand `signe` est demandé ; une valeur absente ou non finie s'écrit « — ».

   Fmt.fmtNombre(v, { decimales = 0 }?) → "193 490" (milliers en espace fine)
   Fmt.fmtEUR(v, { decimales = 0, signe = false, compact = false | "kpi" | "graphe", dette = false }?) → "193 490 €"
     compact "kpi" (mini-cartes) : au millier à partir de 100 000 € (« 193 k€ »), en millions à partir de 1 M€ (« 1,2 M€ ») ;
     compact "graphe" (axes, bulles) : en k€ à partir de 10 000 € (« 24,5 k€ »), en M€ à partir de 1 M€. Sous le seuil : l'euro entier.
     La valeur exacte reste affichée ailleurs (héros, panneau de détail) : le compact n'est qu'un arrondi de lecture.
     dette : v est un reste dû (positif) écrit « −156 500 € » ; la dette est en encre (pas en rouge), la couleur est décidée par l'appelant
     (Fmt.classeMontant).
   Fmt.fmtPct(v, { signe = false, ratio = false, decimales? }?) → "5,2 %" : une décimale sous 10 %, sinon entier (v en pourcents ; ratio : v est une
     proportion, 0,052 → « 5,2 % »).
   Fmt.fmtDate(d, { court = false, maintenant? }?) → "14 oct. 2026" ; court (listes) : « 14 oct. ». d : "AAAA-MM-JJ", ISO avec heure ou Date.
     Avec `maintenant` (date, ISO ou Date) : relatif pour moins de 7 jours (« aujourd'hui, 22 h 31 », « hier, 22 h 31 », « il y a 3 j »),
     sinon la date. Les dates sans heure sont lues telles quelles (aucun décalage de fuseau) ; avec heure : jour et heure de Paris.
   Fmt.fmtDelta({ montant, pct, periode = "sur 1 an" }) → { texte: "▲ +9 646 € · +5,2 % sur 1 an", sens: "hausse" | "baisse" | "stable",
     ton: "pos" | "neg" | "neutre", lu: "En hausse de 9 646 euros, 5,2 pour cent, sur 1 an" }
     Toujours avec la période (une seule par défaut dans toute l'app). Le signe et la flèche portent le sens : la couleur ne le porte jamais seule.
   Fmt.classeMontant(v, { dette = false }?) → "pos" | "neg" | "neutre" : la dette est neutre (encre) ; un mouvement d'argent suit son signe.
   Fmt.graduations(min, max, n = 4) → [valeurs rondes] : au plus n graduations, pas de 1, 2, 2,5 ou 5 × 10ⁿ, couvrant [min, max].
   Fmt.fmtAxe(graduations) → ["24,0 k€", "24,5 k€", …] : libellés d'axe cohérents (même unité € / k€ / M€ selon la plus grande valeur, mêmes décimales).
   Exemples : Fmt.fmtEUR(-156500) → "−156 500 €" ; Fmt.fmtEUR(193490, { compact: "kpi" }) → "193 k€" ; Fmt.fmtPct(5.23, { signe: true }) → "+5,2 %". */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Fmt = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FIN = " "; // espace fine insécable (milliers)
  const NB = " "; // espace insécable avant l'unité (€, k€, M€, %) : plus lisible que la fine à 16 px, comme la maquette
  const MOINS = "−";
  const TIRET = "—";
  const fini = v => v != null && v !== "" && typeof v !== "boolean" && Number.isFinite(+v);
  /** Arrondi « commercial » (moitié vers l'infini), robuste aux flottants (5,25 → 5,3 ; 1,005 → 1,01). */
  const arrondir = (v, d) => { const f = Math.pow(10, d); return Math.sign(v) * Math.round(Math.abs(v) * f * (1 + 1e-12) + 1e-9) / f; };
  const milliers = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, FIN);
  /** Partie absolue arrondie → « 1 234,5 » ; `rogner` retire les décimales nulles (« 24,0 » → « 24 »). */
  function corps(abs, d, rogner) {
    const r = arrondir(abs, d), s = r.toFixed(d);
    const [e, f] = s.split(".");
    const dec = f && rogner ? f.replace(/0+$/, "") : f;
    return milliers(e) + (dec ? "," + dec : "");
  }
  const signeDe = (v, signe) => (v < 0 ? MOINS : signe && v > 0 ? "+" : "");

  function fmtNombre(v, o) {
    if (!fini(v)) return TIRET;
    const d = o && o.decimales > 0 ? o.decimales : 0, x = +v, r = arrondir(x, d);
    return (r < 0 ? MOINS : "") + corps(Math.abs(x), d, false);
  }

  function fmtEUR(v, o) {
    o = o || {};
    if (!fini(v)) return TIRET;
    let x = +v;
    if (o.dette) x = -Math.abs(x);
    const abs = Math.abs(x);
    let txt, rond = arrondir(x, o.decimales > 0 ? o.decimales : 0);
    const seuilK = o.compact === "kpi" || o.compact === true ? 1e5 : o.compact === "graphe" ? 1e4 : Infinity;
    if (abs >= 1e6 && seuilK !== Infinity) {
      txt = corps(abs / 1e6, abs >= 1e7 ? 0 : 1, true) + NB + "M€"; rond = arrondir(abs / 1e6, 1);
    } else if (abs >= seuilK) {
      const k = abs / 1e3;
      txt = corps(k, o.compact === "graphe" && k < 100 ? 1 : 0, true) + NB + "k€"; rond = arrondir(k, 0);
    } else txt = corps(abs, o.decimales > 0 ? o.decimales : 0, false) + NB + "€";
    return (rond === 0 && !/[1-9]/.test(txt.replace(/[^\d]/g, "")) ? "" : signeDe(x, o.signe)) + txt;
  }

  function fmtPct(v, o) {
    o = o || {};
    if (!fini(v)) return TIRET;
    let x = +v;
    if (o.ratio) x *= 100;
    // une décimale sous 10 %, sinon entier (9,96 → « 10 % », pas « 10,0 % »)
    const d = o.decimales != null ? o.decimales : arrondir(x, 1) === 0 ? 0 : Math.abs(arrondir(x, 1)) < 10 ? 1 : 0;
    const r = arrondir(x, d);
    return (r === 0 ? "" : signeDe(r, o.signe)) + corps(Math.abs(x), d, false) + NB + "%";
  }

  /* ---------- dates ---------- */
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const pad = n => String(n).padStart(2, "0");
  /** Date calendaire (Y, M, J) et heure de Paris éventuelle ; null si illisible. */
  function lire(d) {
    if (d == null || d === "") return null;
    if (typeof d === "string") {
      const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return { a: +m[1], m: +m[2], j: +m[3], h: null, mn: null };
    }
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;
    const p = {};
    for (const x of new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(dt)) p[x.type] = x.value;
    return { a: +p.year, m: +p.month, j: +p.day, h: +p.hour, mn: +p.minute };
  }
  const jourJulien = p => Math.round(Date.UTC(p.a, p.m - 1, p.j) / 864e5);
  const heure = p => (p.h == null || (p.h === 0 && p.mn === 0) ? "" : p.h + " h " + pad(p.mn));

  function fmtDate(d, o) {
    o = o || {};
    const p = lire(d);
    if (!p) return TIRET;
    const date = p.j + " " + MOIS[p.m - 1] + (o.court ? "" : " " + p.a);
    if (o.maintenant == null) return date;
    const n = lire(o.maintenant);
    if (!n) return date;
    const ecart = jourJulien(n) - jourJulien(p);
    if (ecart < 0 || ecart >= 7) return date;
    const h = heure(p);
    if (ecart === 0) return "aujourd'hui" + (h ? ", " + h : "");
    if (ecart === 1) return "hier" + (h ? ", " + h : "");
    return "il y a " + ecart + " j";
  }

  /* ---------- variations ---------- */
  function fmtDelta(o) {
    o = o || {};
    const periode = o.periode == null || o.periode === "" ? "sur 1 an" : String(o.periode);
    const m = fini(o.montant) ? +o.montant : null, p = fini(o.pct) ? +o.pct : null;
    const ref = m != null ? m : p;
    const nul = ref == null || (m != null ? arrondir(m, 0) === 0 : arrondir(p, p != null && Math.abs(p) < 10 ? 1 : 0) === 0);
    const sens = nul ? "stable" : ref > 0 ? "hausse" : "baisse";
    const fleche = sens === "hausse" ? "▲" : sens === "baisse" ? "▼" : "–";
    const parts = [];
    if (m != null) parts.push(fmtEUR(m, { signe: true }));
    if (p != null) parts.push(fmtPct(p, { signe: true }));
    const corpsTxt = parts.length ? parts.join(" · ") : "stable";
    const lu = [];
    if (m != null) lu.push(arrondir(Math.abs(m), 0) === 0 ? "aucune variation" : fmtNombre(Math.abs(m)) + " euros");
    if (p != null) lu.push(fmtPct(Math.abs(p)).replace(NB + "%", " pour cent"));
    const verbe = sens === "hausse" ? "En hausse de " : sens === "baisse" ? "En baisse de " : "Stable";
    return {
      texte: fleche + " " + (sens === "stable" ? "stable" : corpsTxt) + " " + periode,
      sens,
      ton: sens === "hausse" ? "pos" : sens === "baisse" ? "neg" : "neutre",
      lu: verbe + (sens === "stable" ? "" : lu.join(", ")) + ", " + periode,
    };
  }

  function classeMontant(v, o) {
    if (!fini(v) || (o && o.dette)) return "neutre";
    const r = arrondir(+v, 0);
    return r > 0 ? "pos" : r < 0 ? "neg" : "neutre";
  }

  /* ---------- graduations rondes ---------- */
  /** Pas « rond » (1, 2, 2,5 ou 5 × 10ⁿ) d'au moins `brut`. */
  function pasRond(brut) {
    if (!(brut > 0)) return 1;
    const e = Math.floor(Math.log10(brut)), f = brut / Math.pow(10, e);
    const m = f <= 1 + 1e-9 ? 1 : f <= 2 + 1e-9 ? 2 : f <= 2.5 + 1e-9 ? 2.5 : f <= 5 + 1e-9 ? 5 : 10;
    return m * Math.pow(10, e);
  }
  function graduations(min, max, n) {
    n = n > 1 ? Math.floor(n) : 4;
    let lo = +min, hi = +max;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo === hi) { const a = Math.abs(lo) || 1; lo -= a / 2; hi += a / 2; }
    let pas = pasRond((hi - lo) / (n - 1));
    const prec = x => Math.round(x * 1e9) / 1e9;
    for (let k = 0; k < 6; k++) {
      const d = prec(Math.floor(lo / pas + 1e-9) * pas), f = prec(Math.ceil(hi / pas - 1e-9) * pas);
      const nb = Math.round((f - d) / pas) + 1;
      if (nb <= n) { const out = []; for (let i = 0; i < nb; i++) out.push(prec(d + i * pas)); return out; }
      pas = pasRond(pas * 1.01);
    }
    return [prec(lo), prec(hi)];
  }
  /** Libellés d'axe cohérents pour une liste de graduations : même unité (€, k€ ou M€ selon la plus grande) et même nombre de décimales. */
  function fmtAxe(ticks) {
    const t = (Array.isArray(ticks) ? ticks : []).filter(fini).map(Number);
    if (!t.length) return [];
    const m = Math.max(...t.map(Math.abs));
    const [div, unite] = m >= 1e6 ? [1e6, "M€"] : m >= 1e4 ? [1e3, "k€"] : [1, "€"];
    let d = 0;
    while (d < 2 && t.some(v => Math.abs(arrondir(v / div, d) - v / div) > 1e-9)) d++;
    return t.map(v => (arrondir(v / div, d) < 0 ? MOINS : "") + corps(Math.abs(v) / div, d, false) + NB + unite);
  }

  return { fmtNombre, fmtEUR, fmtPct, fmtDate, fmtDelta, classeMontant, graduations, fmtAxe, FIN, NB, MOINS, MOIS };
});
