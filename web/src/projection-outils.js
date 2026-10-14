/* Outils communs du moteur de projection (PROJ) : dates, générateur pseudo-aléatoire à graine fixe, normales, factorisation de
   Cholesky, centiles, lecture des repères, formats français. Pur, sans DOM ; aucune valeur chiffrée de la finance ici.
   Global ProjectionOutils (navigateur et worker) ; module CommonJS sous Node ; copié tel quel dans le connecteur (npm run gen). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ProjectionOutils = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ dates (AAAA-MM-JJ, sans fuseau) */
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const pad = (n, l) => String(n).padStart(l || 2, "0");
  const dernierJour = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (y, m, d) => pad(y, 4) + "-" + pad(m) + "-" + pad(d);
  const morceaux = s => s.split("-").map(Number);
  /** Vrai pour une date réelle au format AAAA-MM-JJ (2026-02-30 est refusée). */
  function estDate(s) {
    if (typeof s !== "string" || !ISO.test(s)) return false;
    const [y, m, d] = morceaux(s);
    return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= dernierJour(y, m);
  }
  /** Ajoute n mois au même quantième, ou au dernier jour du mois s'il n'existe pas. */
  function ajouterMois(s, n) {
    const [y, m, d] = morceaux(s), t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = t - ny * 12 + 1;
    return iso(ny, nm, Math.min(d, dernierJour(ny, nm)));
  }
  const ajouterAns = (s, n) => ajouterMois(s, n * 12);
  const utc = s => { const [y, m, d] = morceaux(s); return Date.UTC(y, m - 1, d); };
  const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  /** Mois entiers entre deux dates (a ≤ b) : le mois n'est compté que si le quantième de b atteint celui de a. */
  function moisEntre(a, b) {
    const [y1, m1, d1] = morceaux(a), [y2, m2, d2] = morceaux(b);
    let k = (y2 - y1) * 12 + (m2 - m1);
    if (d2 < d1 && d2 < dernierJour(y2, m2)) k -= 1;
    return k;
  }
  const annee = s => +s.slice(0, 4);
  /** Premier mois t ≥ 1 tel que date(t) ≥ d (date(t) = today + t mois) ; null si la date dépasse `max` mois. Une date passée donne 1. */
  function moisDe(today, d, max) {
    if (!estDate(d)) return null;
    let t = Math.max(0, moisEntre(today, d) - 1);
    if (t < 0) t = 0;
    while (ajouterMois(today, t) < d) t += 1;
    while (t > 0 && ajouterMois(today, t - 1) >= d) t -= 1;
    t = Math.max(1, t);
    return max != null && t > max ? null : t;
  }
  /** Mois d'une date de fin exclue : premier t ≥ 1 tel que date(t) ≥ fin (le mois t n'est plus concerné). */
  const moisFin = moisDe;
  /** Date + n jours. */
  function ajouterJours(s, n) { const t = new Date(utc(s) + n * 864e5); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  /** Âge révolu à une date, depuis une date de naissance. */
  function age(naissance, date) {
    const [y1, m1, d1] = morceaux(naissance), [y2, m2, d2] = morceaux(date);
    let a = y2 - y1;
    if (m2 < m1 || (m2 === m1 && d2 < d1)) a -= 1;
    return a;
  }

  /* ------------------------------------------------------------------ nombres et formats français (espaces simples, « − » typographique) */
  const n0 = v => (typeof v === "number" ? (isFinite(v) ? v : 0) : typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : 0);
  const estNombre = v => (typeof v === "number" && isFinite(v)) || (typeof v === "string" && v.trim() !== "" && isFinite(+v));
  const arrondi2 = x => Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;
  function frc(x, dec) {
    const d = dec == null ? 0 : dec;
    const s = Math.abs(x).toFixed(d).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(".", ",");
    const neg = x < 0 && Number(Math.abs(x).toFixed(d)) !== 0;
    return (neg ? "−" : "") + s.replace(/^(\d+)/, m => m.replace(/\B(?=(\d{3})+(?!\d))/g, " "));
  }
  /** Nombre à `dec` décimales fixes (zéros finaux conservés) : « 459,70 ». */
  function frcFixe(x, dec) { const s = Math.abs(x).toFixed(dec).replace(".", ",").replace(/^(\d+)/, m => m.replace(/\B(?=(\d{3})+(?!\d))/g, " ")); return (x < 0 && Number(Math.abs(x).toFixed(dec)) !== 0 ? "−" : "") + s; }
  const eurFixe = (x, dec) => frcFixe(x, dec == null ? 2 : dec) + " €";
  const eur = (x, dec) => frc(x, dec == null ? 0 : dec) + " €";
  /** Montant avec signe : « +400 € », « −1 020 € ». */
  const eurSigne = (x, dec) => (x >= 0 ? "+" : "") + eur(x, dec);
  const pct = (x, dec) => frc(x, dec == null ? 0 : dec) + " %";

  /* ------------------------------------------------------------------ repères */
  const estRepere = r => r && isFinite(+r.valeur);
  /** Index { cle: repère } d'une liste de repères (le premier de chaque clé l'emporte). */
  function indexReperes(liste) {
    const out = Object.create(null);
    (Array.isArray(liste) ? liste : []).forEach(r => { if (r && r.cle && estRepere(r) && !(r.cle in out)) out[r.cle] = r; });
    return out;
  }

  /* ------------------------------------------------------------------ générateur à graine fixe */
  /** splitmix32 : suite de mots de 32 bits à partir d'une graine de 32 bits. */
  function splitmix32(graine) {
    let a = graine >>> 0;
    return function () {
      a = (a + 0x9E3779B9) | 0;
      let t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21F0AAAD);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735A2D97);
      return ((t = t ^ (t >>> 15)) >>> 0);
    };
  }
  /** Initialise l'état xoshiro128** du chemin i (4 mots) dans s[4i .. 4i+3], à partir de la graine du calcul (jamais tout à zéro). */
  function initialiserEtat(s, i, graine) {
    const sm = splitmix32(((graine >>> 0) ^ Math.imul(i, 0x9E3779B9)) >>> 0);
    const o = 4 * i;
    s[o] = sm(); s[o + 1] = sm(); s[o + 2] = sm(); s[o + 3] = sm();
    if ((s[o] | s[o + 1] | s[o + 2] | s[o + 3]) === 0) s[o] = 1;
  }
  const TWO32 = 4294967296;
  /** Tirage xoshiro128** du chemin d'offset o dans s : uniforme dans ]0, 1[ (jamais 0 : le logarithme de Box-Muller est sûr). */
  function uniforme(s, o) {
    const r = s[o + 1] * 5;
    const resultat = Math.imul((r << 7) | (r >>> 25), 9) >>> 0;
    const t = s[o + 1] << 9;
    s[o + 2] ^= s[o];
    s[o + 3] ^= s[o + 1];
    s[o + 1] ^= s[o + 2];
    s[o] ^= s[o + 3];
    s[o + 2] ^= t;
    s[o + 3] = (s[o + 3] << 11) | (s[o + 3] >>> 21);
    return (resultat + 0.5) / TWO32;
  }

  /* ------------------------------------------------------------------ algèbre */
  /** Facteur de Cholesky L (triangulaire inférieure, tableau plat n × n) de la matrice symétrique A (tableau de tableaux) ; null si A n'est pas définie positive. */
  function cholesky(A) {
    const n = A.length, L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let somme = A[i][j];
        for (let k = 0; k < j; k++) somme -= L[i * n + k] * L[j * n + k];
        if (i === j) { if (somme <= 1e-12) return null; L[i * n + i] = Math.sqrt(somme); } else L[i * n + j] = somme / L[j * n + j];
      }
    }
    return L;
  }
  /** Valeurs propres d'une matrice symétrique (Jacobi cyclique), triées croissantes. */
  function valeursPropres(A) {
    const n = A.length, M = A.map(l => l.slice());
    for (let balayage = 0; balayage < 100; balayage++) {
      let hors = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) hors += M[i][j] * M[i][j];
      if (hors < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(M[p][q]) < 1e-18) continue;
        const theta = (M[q][q] - M[p][p]) / (2 * M[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const a = M[k][p], b = M[k][q]; M[k][p] = c * a - s * b; M[k][q] = s * a + c * b; }
        for (let k = 0; k < n; k++) { const a = M[p][k], b = M[q][k]; M[p][k] = c * a - s * b; M[q][k] = s * a + c * b; }
      }
    }
    return M.map((l, i) => l[i]).sort((a, b) => a - b);
  }
  /** Matrice de corrélation définie positive la plus proche (Higham, projections alternées) : renvoie { matrice, ecartMax, corrigee }. */
  function pluProcheDefiniePositive(A) {
    if (cholesky(A)) return { matrice: A, ecartMax: 0, corrigee: false };
    const n = A.length;
    let Y = A.map(l => l.slice()), dS = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let it = 0; it < 200; it++) {
      const R = Y.map((l, i) => l.map((v, j) => v - dS[i][j]));
      /* projection sur les semi-définies positives : décomposition spectrale par Jacobi avec vecteurs */
      const X = projeterSDP(R);
      dS = X.map((l, i) => l.map((v, j) => v - R[i][j]));
      Y = X.map(l => l.slice());
      for (let i = 0; i < n; i++) Y[i][i] = 1;
    }
    /* léger décalage de la diagonale pour garantir la stricte positivité */
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Y[i][j] = i === j ? 1 : Y[i][j] * 0.9999;
    let ecartMax = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) ecartMax = Math.max(ecartMax, Math.abs(Y[i][j] - A[i][j]));
    return { matrice: Y, ecartMax, corrigee: true };
  }
  function projeterSDP(A) {
    const n = A.length, M = A.map(l => l.slice()), V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    for (let balayage = 0; balayage < 100; balayage++) {
      let hors = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) hors += M[i][j] * M[i][j];
      if (hors < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(M[p][q]) < 1e-18) continue;
        const theta = (M[q][q] - M[p][p]) / (2 * M[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const a = M[k][p], b = M[k][q]; M[k][p] = c * a - s * b; M[k][q] = s * a + c * b; }
        for (let k = 0; k < n; k++) { const a = M[p][k], b = M[q][k]; M[p][k] = c * a - s * b; M[q][k] = s * a + c * b; }
        for (let k = 0; k < n; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - s * b; V[k][q] = s * a + c * b; }
      }
    }
    const out = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let k = 0; k < n; k++) {
      const lambda = Math.max(M[k][k], 1e-9);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i][j] += lambda * V[i][k] * V[j][k];
    }
    return out;
  }

  /* ------------------------------------------------------------------ centiles */
  /** Centile de rang ⌈p × N⌉ (1-indexé) des valeurs triées (p entre 0 et 1) ; `triees` : tableau déjà trié croissant. */
  function centileTrie(triees, p) {
    const N = triees.length;
    if (!N) return NaN;
    const rang = Math.min(N, Math.max(1, Math.ceil(p * N - 1e-9)));
    return triees[rang - 1];
  }
  /** Centile d'une liste quelconque (copie triée). */
  function centile(valeurs, p) {
    const t = Float64Array.from(valeurs);
    t.sort();
    return centileTrie(t, p);
  }

  return { ISO, pad, dernierJour, iso, estDate, ajouterMois, ajouterAns, ajouterJours, joursEntre, moisEntre, moisDe, moisFin, annee, age,
    n0, estNombre, arrondi2, frc, frcFixe, eurFixe, eur, eurSigne, pct, indexReperes, splitmix32, initialiserEtat, uniforme, cholesky, valeursPropres,
    pluProcheDefiniePositive, centileTrie, centile };
});
