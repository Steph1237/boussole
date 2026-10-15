/* Graphe maître de Boussole (PROJ › SIM2) : UN composant pour Aujourd'hui, Placements, Objectifs et « Ta capacité demain » (Immobilier et crédits).
   Passé et futur sur UN SEUL axe du temps proportionnel (un mois passé et un mois futur ont la même largeur), une seule commande de temps
   (1 an · 5 ans · 10 ans · 20 ans · Tout : N ans avant ET après aujourd'hui), granularité automatique, échelle des y calée sur la fourchette
   « 8 chances sur 10 » de la fenêtre (4 graduations rondes au plus, à droite), valeur de fin en pastille. Référence visuelle et d'interaction :
   docs/boussole-graphe-variantes.html (« Carte retenue ») ; spec docs/superpowers/specs/2026-10-14-proj-projection-design.md § 10.

   Deux couches dans ce fichier :
   1. Fonctions PURES (aucun DOM, testables sous Node) : formats, fenêtres et domaine du temps, granularité, échelles, graduations, séries,
      courbes lissées monotones (Fritsch-Carlson), regroupement des jalons, lecture à une date, textes, tableau de données, « Comment c'est calculé ».
   2. Contrôleur DOM `monter(el, { donnees, reglages, preset, deps, … })` → { mettreAJour, pleinEcran, fermerPleinEcran, etat, detruire } :
      carte (mobile / ordinateur), curseur toucher-glisser / survol / clavier, jalons en vrais boutons, bande d'épargne, lecture en une ligne,
      feuilles (UI.panneau : réglages, jalons, détail, lecture, calcul), plein écran (API Fullscreen ou couche role="dialog"), zoom, comparaison à un plan.

   Contrat de données `donnees` (construit par graphe-modele.js à partir du moteur Projection, du passé et du store ; tout est optionnel sauf today) :
     { today: "AAAA-MM-JJ", mode?: "patrimoine" | "capacite", vue: "net" | "financier" | "disponible", euros: "constants" | "courants", etat?: "calcul" | "pret" | "erreur" | "vide",
       titre?, perimetre?: "du foyer",
       passe: { points: [{ date, valeur, nature: "observe" | "reconstitue" }], note?, drapeaux?, decalage?, euros_constants?: bool } | null,
       futur: { mois: ["AAAA-MM-JJ"], p10, p25, p50, p75, p90: [nombres, mois 0 = aujourd'hui], existant?: { p25?, p50, p75? }, epargne_future?: { versements_cumules, croissance },
                variante?: { nom, p25, p50, p75 }, crise?: { label, debut, valeurs }, avenirs?: [[…100 trajectoires]], pas_mois?: 1 | 12 } | null,
       jalons: [{ id, date, fin?, titre, type, source: "evenement" | "calendrier" | "credit" | "objectif", icone?, effet: { texte, montants }, evenement_id?, objectif_id? }],
       objectifs: [{ id, nom, cible, date, probabilite, mot, statut, valeur_deterministe, deja?, leviers? }],
       capacite: { base, par_periode: [{ debut, fin, montant_mensuel, raison, source, evenement_id? }] } | null,
       capacite_demain?: { mois, montant_empruntable, budget_achat_par_taux, taux, duree_ans, apport, phrase } (mode "capacite"),
       phrase, decomposition_phrase, garde_fous, evenements_pris_en_compte, question_evenements, hypotheses, couverture, avertissements, a_completer,
       version_modele, graine, chemins, progressif?: bool, plans?: [{ id, cree_le, raison }], variantes?: [{ id, nom }], crises?: [{ cle, label }] }
   Tous les textes sont au tutoiement ; toute donnée est échappée. Une projection n'est pas une promesse. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GraphePatrimoine = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  const glob = k => (root && root[k]) || (typeof window !== "undefined" && window[k]) || null;
  const noeud = typeof module === "object" && module.exports && typeof require === "function";
  const FmtDef = glob("Fmt") || (noeud ? require("./format.js") : null);

  /* ================================================================ 1. PUR ================================================================ */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fini = v => v != null && v !== "" && typeof v !== "boolean" && isFinite(+v);
  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
  const NB = " ", MOINS = "−", FIN = " ";
  const MS_JOUR = 864e5;

  /* ---------- dates (millisecondes UTC à minuit) ---------- */
  const msDe = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const isoDe = ms => new Date(ms).toISOString().slice(0, 10);
  const ajouterMois = (ms, k) => { const d = new Date(ms), y = d.getUTCFullYear(), m = d.getUTCMonth() + k, yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    return Date.UTC(yy, mm, Math.min(d.getUTCDate(), new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate())); };
  /** Mois entiers entre deux dates (a ≤ b → ≥ 0). */
  const moisEntre = (a, b) => { const d = new Date(a), e = new Date(b); let k = (e.getUTCFullYear() - d.getUTCFullYear()) * 12 + e.getUTCMonth() - d.getUTCMonth(); if (e.getUTCDate() < d.getUTCDate()) k--; return k; };
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const MOIS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const cap1 = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const dMois = ms => { const d = new Date(ms); return MOIS[d.getUTCMonth()] + " " + d.getUTCFullYear(); };
  const dJour = ms => { const d = new Date(ms); return d.getUTCDate() + (d.getUTCDate() === 1 ? "er" : "") + " " + MOIS[d.getUTCMonth()] + " " + d.getUTCFullYear(); };
  const dMoisLong = ms => { const d = new Date(ms); return MOIS_LONG[d.getUTCMonth()] + " " + d.getUTCFullYear(); };
  /** « 3 mois », « 1 an et 2 mois », « 5 ans » (écart absolu en mois entiers). */
  function dureeTxt(mois) {
    const a = Math.abs(Math.round(mois));
    if (a < 12) return a + " mois";
    const y = Math.floor(a / 12), r = a % 12;
    return y + (y > 1 ? " ans" : " an") + (r ? " et " + r + " mois" : "");
  }
  /** « dans 2 ans et 3 mois » / « il y a 8 mois » / « aujourd'hui », entre deux dates. */
  function relatif(todayMs, ms) {
    if (ms === todayMs) return "aujourd'hui";
    const k = ms > todayMs ? moisEntre(todayMs, ms) : moisEntre(ms, todayMs);
    if (k < 1) { const j = Math.round(Math.abs(ms - todayMs) / MS_JOUR); return (ms > todayMs ? "dans " : "il y a ") + j + (j > 1 ? " jours" : " jour"); }
    return (ms > todayMs ? "dans " : "il y a ") + dureeTxt(k);
  }

  /* ---------- montants ---------- */
  const fInt = n => Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, FIN);
  const fEur = n => (Math.round(n) < 0 ? MOINS : "") + fInt(n) + NB + "€";
  /** Compact : « 150 k€ », « 1,2 M€ » (sous 1 000 € : l'euro entier). dec = décimales du k€ (0 par défaut). */
  function fK(n, dec) {
    const a = Math.abs(n), sg = n < 0 && Math.round(a) !== 0 ? MOINS : "";
    if (a >= 1e6) return sg + (a / 1e6).toFixed(2).replace(/\.?0+$/, "").replace(".", ",") + NB + "M€";
    if (a >= 1000) return sg + ((dec ? (a / 1000).toFixed(dec) : String(Math.round(a / 1000))).replace(".", ",")) + NB + "k€";
    return sg + fInt(a) + NB + "€";
  }
  const fSK = n => (n >= 0 ? "+" : MOINS) + fK(Math.abs(n));
  const fSE = n => (n >= 0 ? "+" : MOINS) + fInt(n) + NB + "€";
  const fMois = n => (n > 0 ? "+" : n < 0 ? MOINS : "") + fInt(n) + NB + "€/mois";
  const fMoisU = n => fInt(n) + NB + "€/mois";
  const fPct = x => (x >= 0 ? "+" : MOINS) + Math.abs(x * 100).toFixed(1).replace(".", ",") + NB + "%";
  /** « 300 et 560 k€ » : la fourchette en deux nombres, l'unité une seule fois quand elle est la même. */
  const kRange = (a, b) => (Math.max(Math.abs(a), Math.abs(b)) < 1e6 && Math.min(Math.abs(a), Math.abs(b)) >= 1000 ? Math.round(a / 1000) + " et " + fK(b) : fK(a) + " et " + fK(b));
  const kTiret = (a, b) => (Math.max(Math.abs(a), Math.abs(b)) < 1e6 && Math.min(Math.abs(a), Math.abs(b)) >= 1000 ? Math.round(a / 1000) + "–" + fK(b) : fK(a) + "–" + fK(b));
  /** Chances « sur 10 » : 0,8 → « 8 chances sur 10 », 0,05 → « moins de 1 chance sur 10 », 1 → « 10 chances sur 10 ». */
  function chancesTxt(p) {
    const n = Math.round(p * 10);
    if (p < 1 && n >= 10) return "plus de 9 chances sur 10";
    if (n <= 0) return "moins de 1 chance sur 10";
    return n + (n > 1 ? " chances" : " chance") + " sur 10";
  }
  /** Mot de probabilité d'un objectif (« probable » ≥ 80 %, « incertain » 50 à 80 %, « peu probable » < 50 %) ; null sans probabilité. */
  const motProba = p => (p == null || !fini(p) ? null : p >= 0.8 ? "probable" : p >= 0.5 ? "incertain" : "peu probable");
  const TON_MOT = { "probable": "good", "incertain": "watch", "peu probable": "work" };
  const STATUT_OBJ = { atteint: ["Atteint", "good"], avance: ["En avance", "good"], dans_les_temps: ["Dans les temps", "good"], retard: ["En retard", "watch"], hors_portee: ["Hors de portée", "work"], hors_horizon: ["Au-delà de la projection", "todo"] };

  /* ---------- fenêtres, domaine du temps, granularité ---------- */
  const FENETRES = [
    { id: "1", label: "1 an", ans: 1, aria: "1 an avant et après aujourd'hui" }, { id: "5", label: "5 ans", ans: 5, aria: "5 ans avant et après aujourd'hui" },
    { id: "10", label: "10 ans", ans: 10, aria: "10 ans avant et après aujourd'hui" }, { id: "20", label: "20 ans", ans: 20, aria: "20 ans avant et après aujourd'hui" },
    { id: "tout", label: "Tout", ans: null, aria: "Tout l'historique et tout l'horizon de la projection" },
  ];
  const HORIZON_MAX_ANS = 25;
  /** Domaine du temps { debut, fin } (ms) d'une fenêtre. « N ans » = N ans avant ET après aujourd'hui ; le passé est borné par l'historique disponible et la place
      libérée va au futur (largeur totale constante, axe proportionnel) ; sans passé, la fenêtre part d'aujourd'hui. « Tout » = tout l'historique et tout l'horizon.
      ctx = { today (ms), debutPasse (ms | null), finFutur (ms), futurSeul? (mode capacité : pas de passé), periode?: { du, au } (ms) }. */
  function domaine(fenetre, ctx) {
    const { today } = ctx, finMax = fini(ctx.finFutur) ? ctx.finFutur : ajouterMois(today, 12 * HORIZON_MAX_ANS);
    if (ctx.periode && fini(ctx.periode.du) && fini(ctx.periode.au) && ctx.periode.au > ctx.periode.du) return { debut: ctx.periode.du, fin: ctx.periode.au };
    const premier = ctx.futurSeul || !fini(ctx.debutPasse) ? today : Math.min(ctx.debutPasse, today);
    const f = FENETRES.find(x => x.id === String(fenetre)) || FENETRES[1];
    if (f.ans == null) return { debut: premier, fin: Math.max(finMax, premier + 31 * MS_JOUR) };
    const voulu = ajouterMois(today, -12 * f.ans);
    if (ctx.futurSeul) return { debut: today, fin: Math.min(finMax, ajouterMois(today, 12 * f.ans)) };
    const debut = Math.max(voulu, premier);
    return { debut, fin: Math.min(finMax, ajouterMois(debut, 24 * f.ans)) };
  }
  /** Fenêtre « N ans » (id) la plus proche qui contient les deux bornes (pour agrandir sur un jalon hors fenêtre). */
  function fenetreContenant(todayMs, ms, debutPasse) {
    const ecart = Math.abs(ms - todayMs);
    for (const f of FENETRES) if (f.ans != null && ecart <= ajouterMois(todayMs, 12 * f.ans) - todayMs) return f.id;
    return "tout";
  }
  const GRANULARITES = ["jour", "semaine", "mois", "trimestre", "annee"];
  /** Granularité automatique selon l'étendue visible (règle « filtres de dates » : jour jusqu'à 3 mois, semaine jusqu'à 1 an, mois jusqu'à 10 ans,
      trimestre jusqu'à 20 ans, année au-delà) ; `plusFin` descend d'un cran (plein écran). */
  function granularite(etendueMs, plusFin) {
    const j = etendueMs / MS_JOUR;
    let i = j <= 93 ? 0 : j <= 366 ? 1 : j <= 3660 ? 2 : j <= 7320 ? 3 : 4;
    if (plusFin) i = Math.max(0, i - 1);
    return GRANULARITES[i];
  }
  /** Clé du pas qui contient une date : jour, lundi de la semaine, AAAA-MM, AAAA-Tq, AAAA. */
  function clePas(ms, g) {
    const d = new Date(ms);
    if (g === "jour") return isoDe(ms);
    if (g === "semaine") return isoDe(ms - ((d.getUTCDay() + 6) % 7) * MS_JOUR);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    if (g === "mois") return y + "-" + m;
    if (g === "trimestre") return y + "-T" + Math.floor(m / 3);
    return String(y);
  }
  /** Pas de curseur en mois pour la granularité (le futur est mensuel : on échantillonne tous les k mois). */
  const moisParPas = g => (g === "annee" ? 12 : g === "trimestre" ? 3 : 1);

  /* ---------- graduations rondes de l'axe vertical ---------- */
  const PAS_ROND = (() => { const out = []; for (let e = -2; e <= 12; e++) [1, 2, 5].forEach(m => out.push(m * Math.pow(10, e))); return out; })();
  /** Graduations rondes (pas de 1, 2 ou 5 × 10ⁿ) strictement dans [lo, hi] : au plus `max` (4 en portrait, 8 sur ordinateur). Le zéro en fait partie dès que le
      domaine contient des valeurs négatives. → { pas, valeurs: [nombres], libelles: [textes] } (libellés de même unité et même nombre de décimales). */
  function graduations(lo, hi, max) {
    const n = max > 1 ? Math.floor(max) : 4;
    if (!(hi > lo)) return { pas: 0, valeurs: [], libelles: [] };
    let pas = PAS_ROND[PAS_ROND.length - 1];
    for (const p of PAS_ROND) {
      const premier = Math.ceil(lo / p - 1e-9), dernier = Math.floor(hi / p + 1e-9), k = dernier - premier + 1;
      if (k <= n && k >= Math.min(2, n)) { pas = p; break; }
    }
    const valeurs = [];
    for (let k = Math.ceil(lo / pas - 1e-9); k * pas <= hi + pas * 1e-9; k++) valeurs.push(Math.round(k * pas * 1e6) / 1e6);
    const F = FmtDef;
    return { pas, valeurs, libelles: F && F.fmtAxe ? F.fmtAxe(valeurs) : valeurs.map(v => fK(v)) };
  }
  /** Domaine des y d'un besoin { lo, hi } : marge de 7 %, zéro inclus si des valeurs sont négatives. */
  function domaineY(lo, hi) {
    if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1 };
    if (hi - lo < 1e-9) { const a = Math.abs(hi) * 0.05 || 1000; lo -= a; hi += a; }
    const pad = (hi - lo) * 0.07;
    let a = lo - pad, b = hi + pad;
    if (lo < 0) b = Math.max(b, 0);
    return { lo: a, hi: b };
  }
  /** Échelle des y stable : le résultat à 500 chemins est calculé une fois sur son besoin élargi de 10 % ; le résultat complet (2 000 chemins) ne la change que si son
      besoin en sort (le graphique ne saute pas). prev = { lo, hi } | null ; besoin = { lo, hi } ; options.elargir = 0,1 (aperçu). → { lo, hi, change }. */
  function echelleYStable(prev, besoin, options) {
    const o = options || {}, nouveau = domaineY(besoin.lo, besoin.hi);
    if (!prev) {
      if (!o.apercu) return Object.assign({ change: true }, nouveau);
      const m = (nouveau.hi - nouveau.lo) * 0.1;
      return { lo: nouveau.lo - m, hi: nouveau.hi + m, change: true };
    }
    const dedans = besoin.lo >= prev.lo && besoin.hi <= prev.hi;
    if (dedans) return { lo: prev.lo, hi: prev.hi, change: false };
    return Object.assign({ change: true }, nouveau);
  }

  /* ---------- courbes lissées monotones (Fritsch-Carlson : pas de dépassement, pas d'ondulation inventée) ---------- */
  function segmentsMonotones(pts) {
    const n = pts.length;
    if (n < 2) return [];
    const dx = [], ms = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6; ms[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    t[0] = ms[0];
    for (let i = 1; i < n - 1; i++) t[i] = ms[i - 1] * ms[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / ms[i - 1] + (dx[i] + 2 * dx[i - 1]) / ms[i]);
    t[n - 1] = ms[n - 2];
    const sg = [];
    for (let i = 0; i < n - 1; i++) { const h = dx[i] / 3; sg.push([pts[i], [pts[i][0] + h, pts[i][1] + t[i] * h], [pts[i + 1][0] - h, pts[i + 1][1] - t[i + 1] * h], pts[i + 1]]); }
    return sg;
  }
  const F1 = v => v.toFixed(1);
  /** Chemin SVG lissé par les points [x, y] ; `suite` : continue un chemin existant par un « L » au lieu d'un « M ». */
  function chemin(pts, suite) {
    if (pts.length === 1) return (suite ? "L" : "M") + F1(pts[0][0]) + " " + F1(pts[0][1]);
    const sg = segmentsMonotones(pts);
    if (!sg.length) return "";
    return (suite ? "L" : "M") + F1(sg[0][0][0]) + " " + F1(sg[0][0][1]) + sg.map(q => "C" + F1(q[1][0]) + " " + F1(q[1][1]) + " " + F1(q[2][0]) + " " + F1(q[2][1]) + " " + F1(q[3][0]) + " " + F1(q[3][1])).join("");
  }
  /** Le même chemin parcouru à l'envers (pour fermer une bande), en continuant le chemin précédent. */
  function cheminInverse(pts) {
    if (pts.length === 1) return "L" + F1(pts[0][0]) + " " + F1(pts[0][1]);
    const sg = segmentsMonotones(pts).reverse();
    if (!sg.length) return "";
    return "L" + F1(sg[0][3][0]) + " " + F1(sg[0][3][1]) + sg.map(q => "C" + F1(q[2][0]) + " " + F1(q[2][1]) + " " + F1(q[1][0]) + " " + F1(q[1][1]) + " " + F1(q[0][0]) + " " + F1(q[0][1])).join("");
  }
  /** Bande fermée entre deux lignes de points [x, y] de mêmes abscisses. */
  const bande = (haut, bas) => (haut.length < 2 ? "" : chemin(haut) + cheminInverse(bas) + "Z");

  /* ---------- euros d'aujourd'hui pour le passé : indice des prix (Insee) ---------- */
  /** Facteur « euros d'aujourd'hui » d'un montant daté : IPC(aujourd'hui) / IPC(mois), le dernier indice publié servant pour les mois récents.
      indices = [{ mois: "AAAA-MM-01", valeur }] (série ipc_insee) ; null si les indices manquent ou ne couvrent pas la date (jamais un facteur inventé). */
  function facteurPrix(indices, dateIso, todayIso) {
    const liste = (indices || []).filter(x => x && isoOk(x.mois) && fini(x.valeur) && +x.valeur > 0).map(x => ({ m: String(x.mois).slice(0, 7), v: +x.valeur })).sort((a, b) => (a.m < b.m ? -1 : 1));
    if (!liste.length) return null;
    const mois = String(dateIso).slice(0, 7), auj = String(todayIso).slice(0, 7);
    const dernierAvant = m => { let r = null; for (const x of liste) { if (x.m <= m) r = x; else break; } return r; };
    const ref = dernierAvant(auj), cur = dernierAvant(mois);
    if (!ref || !cur) return null;
    return ref.v / cur.v;
  }

  /* ---------- données : normalisation ---------- */
  const tab = a => (Array.isArray(a) ? a : []);
  /** Cherche l'index du dernier élément ≤ x dans un tableau trié de nombres (−1 si aucun). */
  function indexAvant(arr, x) {
    let lo = 0, hi = arr.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }
  /** Valeur d'une série creuse (nulle hors de certains points, comme les couches « existant » du moteur, calculées aux anniversaires) à l'index i : la valeur si elle existe,
      sinon l'interpolation linéaire dans le temps entre les deux points connus voisins (jamais au-delà des extrémités connues). */
  function valeurCreuse(t, arr, i) {
    if (!arr) return null;
    if (arr[i] != null) return arr[i];
    let a = i - 1, b = i + 1;
    while (a >= 0 && arr[a] == null) a--;
    while (b < arr.length && arr[b] == null) b++;
    if (a < 0 || b >= arr.length) return a >= 0 ? arr[a] : b < arr.length ? arr[b] : null;
    const f = (t[i] - t[a]) / (t[b] - t[a]);
    return arr[a] + (arr[b] - arr[a]) * f;
  }
  /** Indices des points connus d'une série creuse autour de la fenêtre (avec un point connu de chaque côté pour que la courbe en sorte proprement). */
  function pointsConnus(t, arr, dom) {
    const idx = []; for (let i = 0; i < arr.length; i++) if (arr[i] != null) idx.push(i);
    if (!idx.length) return idx;
    let a = 0; while (a + 1 < idx.length && t[idx[a + 1]] <= dom.debut) a++;
    let b = idx.length - 1; while (b - 1 >= 0 && t[idx[b - 1]] >= dom.fin) b--;
    return idx.slice(a, b + 1);
  }
  /** Index de l'élément le plus proche de x dans un tableau trié (−1 si vide). */
  function plusProche(arr, x) {
    if (!arr.length) return -1;
    const i = indexAvant(arr, x);
    if (i < 0) return 0;
    if (i >= arr.length - 1) return arr.length - 1;
    return x - arr[i] <= arr[i + 1] - x ? i : i + 1;
  }

  /** Données normalisées : dates en ms, séries parallèles, jalons triés, continuité à « Aujourd'hui ». Ne modifie pas l'entrée. */
  function normaliser(d) {
    const D = d || {}, today = isoOk(D.today) ? msDe(D.today) : msDe(new Date().toISOString().slice(0, 10));
    const mode = D.mode === "capacite" ? "capacite" : "patrimoine";
    const pts = tab(D.passe && D.passe.points).filter(p => p && isoOk(p.date) && fini(p.valeur) && msDe(p.date) <= today)
      .map(p => ({ t: msDe(p.date), v: +p.valeur, nature: p.nature === "reconstitue" ? "reconstitue" : "observe" })).sort((a, b) => a.t - b.t);
    const passe = { t: pts.map(p => p.t), v: pts.map(p => p.v), nature: pts.map(p => p.nature) };
    const aujObs = pts.length && pts[pts.length - 1].t === today ? pts[pts.length - 1].v : null;
    const F = D.futur && tab(D.futur.mois).length > 1 ? D.futur : null;
    let futur = null, ecartDepart = 0;
    if (F) {
      const t = F.mois.map(msDe), n = t.length;
      const col = a => (Array.isArray(a) && a.length === n ? a.map(x => (fini(x) ? +x : null)) : null);
      futur = { t, p10: col(F.p10), p25: col(F.p25), p50: col(F.p50), p75: col(F.p75), p90: col(F.p90), n,
        existant: F.existant ? { p25: col(F.existant.p25), p50: col(F.existant.p50), p75: col(F.existant.p75) } : null,
        epargne: F.epargne_future ? { versements: col(F.epargne_future.versements_cumules), croissance: col(F.epargne_future.croissance), p50: col(F.epargne_future.p50) } : null,
        variante: F.variante && col(F.variante.p50) ? { nom: F.variante.nom || "Variante", p25: col(F.variante.p25), p50: col(F.variante.p50), p75: col(F.variante.p75) } : null,
        crise: F.crise && col(F.crise.valeurs) ? { label: F.crise.label || "Crise", debut: isoOk(F.crise.debut) ? msDe(F.crise.debut) : null, valeurs: col(F.crise.valeurs) } : null,
        avenirs: Array.isArray(F.avenirs) && F.avenirs.length ? F.avenirs.map(a => (Array.isArray(a) && a.length === n ? a : null)).filter(Boolean) : null,
        pasMois: F.pas_mois || 1 };
      if (!futur.p50) futur = null;
      else {
        const dep = aujObs != null ? aujObs : futur.p50[0];
        ecartDepart = aujObs != null && futur.p50[0] != null ? futur.p50[0] - aujObs : 0;
        /* continuité : toutes les séries futures partent exactement de la dernière valeur observée (même point) */
        ["p10", "p25", "p50", "p75", "p90"].forEach(k => { if (futur[k] && futur[k][0] != null && aujObs != null) futur[k][0] = dep; });
        if (futur.existant && aujObs != null) ["p25", "p50", "p75"].forEach(k => { if (futur.existant[k] && futur.existant[k][0] != null) futur.existant[k][0] = dep; });
        if (futur.variante && aujObs != null) ["p25", "p50", "p75"].forEach(k => { if (futur.variante[k] && futur.variante[k][0] != null) futur.variante[k][0] = dep; });
        if (futur.crise && aujObs != null && futur.crise.valeurs[0] != null) futur.crise.valeurs[0] = dep;
        if (futur.avenirs && aujObs != null) futur.avenirs = futur.avenirs.map(a => { const c = a.slice(); c[0] = dep; return c; });
      }
    }
    const jalons = tab(D.jalons).filter(j => j && isoOk(j.date)).map(j => ({ id: String(j.id), t: msDe(j.date), tFin: isoOk(j.fin) ? msDe(j.fin) : null, titre: plat(j.titre) || "Jalon", type: j.type || "", source: j.source || "evenement",
      icone: j.icone || "", effet: j.effet || { texte: "", montants: {} }, evenementId: j.evenement_id || null, objectifId: j.objectif_id || (String(j.id).startsWith("objectif:") ? String(j.id).slice(9) : null), brut: j }))
      .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    const objectifs = tab(D.objectifs).filter(o => o && o.id != null && isoOk(o.date)).map(o => Object.assign({}, o, { id: String(o.id), t: msDe(o.date) }));
    const cap = D.capacite && tab(D.capacite.par_periode).length ? D.capacite : null;
    const capacite = cap ? { base: cap.base || null, periodes: cap.par_periode.filter(p => p && isoOk(p.debut)).map(p => ({ t0: msDe(p.debut), t1: isoOk(p.fin) ? msDe(p.fin) : null, montant: +p.montant_mensuel, raison: plat(p.raison), source: p.source || "", evenementId: p.evenement_id || null })) } : null;
    const demRaw = mode === "capacite" && D.capacite_demain && tab(D.capacite_demain.mois).length > 1 ? D.capacite_demain : null;
    let demain = null;
    if (demRaw) {
      const t = demRaw.mois.map(msDe), n = t.length, c3 = o => (o ? { p10: o.p10, p50: o.p50, p90: o.p90 } : null), ser = demRaw.serie_mensuelle && tab(demRaw.serie_mensuelle.mois).length ? demRaw.serie_mensuelle : null;
      demain = { t, n, budget: c3(demRaw.budget_achat), apport: c3(demRaw.apport), empruntable: demRaw.montant_empruntable, mensualite: demRaw.mensualite_max, parTaux: demRaw.budget_achat_par_taux || null, taux: demRaw.taux || null,
        duree: demRaw.duree_ans || null, phrase: demRaw.phrase || "", serie: ser ? { t: ser.mois.map(msDe), emprunt: ser.montant_empruntable } : null };
      futur = { t, p10: demain.budget.p10, p25: null, p50: demain.budget.p50, p75: null, p90: demain.budget.p90, n, existant: null, epargne: null, variante: null, crise: null, avenirs: null, pasMois: 12 };
    }
    const debutPasse = passe.t.length ? passe.t[0] : null, finFutur = futur ? futur.t[futur.n - 1] : today;
    return { brut: D, mode, today, todayIso: isoDe(today), vue: D.vue || "net", euros: D.euros === "courants" ? "courants" : "constants", etat: D.etat || (futur || passe.t.length ? "pret" : "vide"),
      titre: plat(D.titre), perimetre: plat(D.perimetre), passe, futur, valeurAuj: aujObs != null ? aujObs : futur && futur.p50 ? futur.p50[0] : null, ecartDepart, jalons, objectifs, capacite, demain,
      debutPasse, finFutur, plans: tab(D.plans), variantes: tab(D.variantes), crises: tab(D.crises), progressif: !!D.progressif, chemins: D.chemins || null };
  }

  /* ---------- séries affichées : échantillonnage selon la granularité ---------- */
  /** Échantillons visibles d'une fenêtre : passé (un point par pas, le dernier du pas), futur (un point tous les k mois), « Aujourd'hui » toujours présent, et un voisin
      de part et d'autre pour que les courbes sortent proprement du cadre. → { passe: [{ t, v, nature, i }], futur: [indices dans M.futur], temps: [ms triés, pour le curseur] }. */
  function echantillons(M, dom, gran) {
    const out = { passe: [], futur: [], temps: [] };
    const P = M.passe, etend = dom.fin - dom.debut, marge = etend * 0.02;
    if (P.t.length && dom.debut < M.today) {
      let derniereCle = null, tampon = null;
      const i0 = Math.max(0, indexAvant(P.t, dom.debut - marge) - 0);
      const brut = [];
      for (let i = Math.max(0, i0 - 1); i < P.t.length; i++) { if (P.t[i] > dom.fin) break; brut.push(i); }
      brut.forEach((i, k) => {
        const cle = clePas(P.t[i], gran);
        if (derniereCle !== null && cle !== derniereCle && tampon != null) out.passe.push(tampon);
        derniereCle = cle; tampon = { t: P.t[i], v: P.v[i], nature: P.nature[i], i };
        if (k === brut.length - 1) out.passe.push(tampon);
      });
      /* « Aujourd'hui » : dernier point observé, toujours gardé tel quel */
      if (P.t[P.t.length - 1] === M.today && out.passe.length && out.passe[out.passe.length - 1].t !== M.today && dom.fin >= M.today) { const i = P.t.length - 1; out.passe.push({ t: M.today, v: P.v[i], nature: P.nature[i], i }); }
    }
    const F = M.futur;
    if (F) {
      const k = Math.max(1, Math.round(moisParPas(gran) / F.pasMois)), irregulier = F.pasMois !== 1;
      const dedans = [];
      for (let i = 0; i < F.n; i++) if (F.t[i] >= dom.debut - marge && F.t[i] <= dom.fin + marge * 2) dedans.push(i);
      let sel = dedans.filter(i => irregulier || i % k === 0 || i === F.n - 1);
      if (!sel.length) sel = dedans;
      const prem = sel.length ? sel[0] : 0, dern = sel.length ? sel[sel.length - 1] : 0;
      if (prem > 0 && F.t[prem] > dom.debut) sel.unshift(prem - 1);
      if (dern < F.n - 1 && F.t[dern] < dom.fin) sel.push(Math.min(F.n - 1, dern + (irregulier ? 1 : k)));
      /* le fait de sauter des mois ne doit pas perdre le dernier mois de la fenêtre */
      out.futur = [...new Set(sel)].sort((a, b) => a - b);
    }
    const temps = new Set();
    out.passe.forEach(p => { if (p.t >= dom.debut && p.t <= dom.fin) temps.add(p.t); });
    out.futur.forEach(i => { if (F.t[i] >= dom.debut && F.t[i] <= dom.fin) temps.add(F.t[i]); });
    if (M.today >= dom.debut && M.today <= dom.fin) temps.add(M.today);
    out.temps = [...temps].sort((a, b) => a - b);
    return out;
  }

  /** Besoin vertical { lo, hi } d'une fenêtre : passé observé visible, fourchette P10–P90 du futur visible (et les couches affichées), plan comparé. Les « 100 avenirs »
      ne comptent pas (la vue ne change pas d'échelle). */
  function besoinY(M, dom, ech, couches) {
    const C = couches || {};
    let lo = Infinity, hi = -Infinity;
    const voir = v => { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    ech.passe.forEach(p => { if (p.t >= dom.debut && p.t <= dom.fin) voir(p.v); });
    const F = M.futur;
    if (F) {
      ech.futur.forEach(i => {
        if (F.t[i] < dom.debut || F.t[i] > dom.fin) return;
        voir(F.p10 ? F.p10[i] : F.p50[i]); voir(F.p90 ? F.p90[i] : F.p50[i]); voir(F.p50[i]);
        if (C.existant && F.existant && F.existant.p50) { voir(F.existant.p50[i]); if (F.existant.p25) voir(F.existant.p25[i]); if (F.existant.p75) voir(F.existant.p75[i]); }
        if (F.variante) { voir(F.variante.p50[i]); if (F.variante.p25) voir(F.variante.p25[i]); if (F.variante.p75) voir(F.variante.p75[i]); }
        if (F.crise) voir(F.crise.valeurs[i]);
      });
    }
    if (M.demain && C.demain) C.demain.forEach(voir);
    if (C.plan) C.plan.forEach(v => voir(v));
    if (M.valeurAuj != null && dom.debut <= M.today && M.today <= dom.fin) voir(M.valeurAuj);
    if (!isFinite(lo)) return { lo: 0, hi: 1 };
    return { lo, hi };
  }

  /* ---------- jalons : regroupement, étiquettes ---------- */
  /** Regroupe les jalons dont les abscisses sont à moins de `px` pixels : [{ x, jalons: [...] }] triés ; les objectifs sont à part (cibles sur la médiane). */
  function regrouperJalons(jalons, X, px) {
    const out = [];
    jalons.slice().sort((a, b) => a.t - b.t).forEach(j => {
      const x = X(j.t), dernier = out[out.length - 1];
      if (dernier && x - dernier.x1 < px) { dernier.jalons.push(j); dernier.x1 = x; } else out.push({ jalons: [j], x0: x, x1: x });
    });
    return out.map(g => ({ jalons: g.jalons, x: (g.x0 + g.x1) / 2 }));
  }
  /** Jalons de la liste : les événements (vie, crédit, calendrier) d'une part, les objectifs d'autre part. */
  const estObjectif = j => j.source === "objectif";
  /** Jalon (ou groupe) le plus proche d'une abscisse, à moins de `portee` pixels ; null sinon. */
  function plusProcheGroupe(groupes, x, portee) {
    let best = null;
    groupes.forEach(g => { const dx = Math.abs(g.x - x); if (dx <= portee && (!best || dx < best.dx)) best = { dx, groupe: g }; });
    return best ? best.groupe : null;
  }
  const effetMensuel = j => { const m = j.effet && j.effet.montants; return m && fini(m.epargne) ? +m.epargne : m && fini(m.mensuel) ? +m.mensuel : null; };
  /** Étiquette flottante d'un jalon (une seule, celui qui est le plus proche du réticule) ; plusieurs formes, de la plus longue à la plus courte. */
  function etiquettesJalon(M, groupe) {
    const j = groupe.jalons[0], plus = groupe.jalons.length > 1 ? " · +" + (groupe.jalons.length - 1) : "";
    if (estObjectif(j)) {
      const o = M.objectifs.find(x => x.id === j.objectifId);
      const mot = o && o.probabilite != null ? motProba(o.probabilite) : o && STATUT_OBJ[o.statut] ? STATUT_OBJ[o.statut][0].toLowerCase() : "";
      const ch = o && o.probabilite != null ? " · " + chancesTxt(o.probabilite) : "";
      return ["Objectif " + j.titre + (mot ? " : " + mot : "") + ch + plus, j.titre + (mot ? " · " + mot : "") + plus, j.titre + plus];
    }
    const e = effetMensuel(j), eur = e != null ? " · " + fMois(e) : "";
    const dt = j.tFin ? dMois(j.t) + " → " + dMois(j.tFin) : dMois(j.t);
    return [j.titre + " · " + dt + eur + plus, j.titre + " · " + dMois(j.t) + eur + plus, j.titre + " · " + dMois(j.t) + plus, j.titre + plus];
  }

  /* ---------- lecture à une date ---------- */
  const DEMI_PAS_MS = 15.5 * MS_JOUR;
  /** Valeur interpolée d'un plan figé { t: [ms], p10, p25, p50, p75, p90 } à la date t ; null hors de sa durée. */
  function planA(P, t) {
    if (!P || !P.t || !P.t.length || t < P.t[0] || t > P.t[P.t.length - 1]) return null;
    const i = indexAvant(P.t, t), j = Math.min(P.t.length - 1, i + 1), f = P.t[j] === P.t[i] ? 0 : (t - P.t[i]) / (P.t[j] - P.t[i]);
    const lire = k => (P[k] && P[k][i] != null ? (P[k][j] != null ? P[k][i] + (P[k][j] - P[k][i]) * f : P[k][i]) : null);
    return { p10: lire("p10"), p25: lire("p25"), p50: lire("p50"), p75: lire("p75"), p90: lire("p90") };
  }
  /** Capacité d'épargne mensuelle (€) à une date : période de capacite_par_periode qui la contient ; au passé, la capacité constatée aujourd'hui. */
  function capaciteA(M, t) {
    const C = M.capacite;
    if (!C || !C.periodes.length) return null;
    if (t <= M.today) return C.base && fini(C.base.retenue) ? { montant: +C.base.retenue, raison: C.base.source === "reel" ? "constatée sur tes comptes" : C.base.source === "montant" ? "montant fixé" : "prévue au budget", source: C.base.source || "", passe: true } : null;
    let r = null;
    C.periodes.forEach(p => { if (p.t0 <= t) r = p; });
    return r ? { montant: r.montant, raison: r.raison, source: r.source, evenementId: r.evenementId } : null;
  }
  /** Jalons d'une date : ceux dont la date est à moins d'un demi-pas (un demi-mois au pas du mois) du point lu. */
  function jalonsA(M, t, demi) {
    const d = demi == null ? DEMI_PAS_MS : demi;
    return M.jalons.filter(j => Math.abs(j.t - t) < d || (j.tFin && j.t <= t && t < j.tFin && false));
  }
  /** Lecture d'un point de la courbe : tout ce que dit le panneau de lecture (date, valeur, nature, fourchette, couches, capacité, événements, plan). */
  function lecture(M, e, t, opt) {
    const o = opt || {}, r = { t, iso: isoDe(t), nature: t === M.today ? "aujourdhui" : t < M.today ? "observe" : "projete", valeur: null };
    const F = M.futur;
    if (t <= M.today && M.passe.t.length) {
      const i = plusProche(M.passe.t, t);
      r.valeur = M.passe.v[i]; r.nature = t === M.today ? "aujourdhui" : M.passe.nature[i]; r.valeurNature = M.passe.nature[i];
      if (t === M.today && M.valeurAuj != null) r.valeur = M.valeurAuj;
    } else if (t === M.today && M.valeurAuj != null) { r.valeur = M.valeurAuj; }
    if (t > M.today || (t === M.today && F)) {
      if (F) {
        const i = plusProche(F.t, t);
        r.i = i; r.p10 = F.p10 ? F.p10[i] : null; r.p25 = F.p25 ? F.p25[i] : null; r.p50 = F.p50[i]; r.p75 = F.p75 ? F.p75[i] : null; r.p90 = F.p90 ? F.p90[i] : null;
        if (t > M.today) r.valeur = F.p50[i];
        if (F.existant && F.existant.p50) { r.existant = valeurCreuse(F.t, F.existant.p50, i); r.existant25 = F.existant.p25 ? valeurCreuse(F.t, F.existant.p25, i) : null; r.existant75 = F.existant.p75 ? valeurCreuse(F.t, F.existant.p75, i) : null; }
        if (F.epargne) { r.versements = F.epargne.versements ? valeurCreuse(F.t, F.epargne.versements, i) : null; r.croissance = F.epargne.croissance ? valeurCreuse(F.t, F.epargne.croissance, i) : null; r.epargneFuture = F.epargne.p50 ? valeurCreuse(F.t, F.epargne.p50, i) : null; }
        if (F.variante) { r.variante = { nom: F.variante.nom, p50: F.variante.p50[i], p25: F.variante.p25 ? F.variante.p25[i] : null, p75: F.variante.p75 ? F.variante.p75[i] : null }; }
        if (F.crise) r.crise = { label: F.crise.label, valeur: F.crise.valeurs[i] };
      }
    }
    r.capacite = capaciteA(M, t);
    r.jalons = jalonsA(M, t, o.demi);
    r.objectifs = M.objectifs.filter(ob => Math.abs(ob.t - t) < (o.demi == null ? DEMI_PAS_MS : o.demi));
    if (e && e.plan && e.plan.t) {
      const pl = planA(e.plan, t);
      if (pl && pl.p50 != null && r.valeur != null) { r.plan = { prevu: pl.p50, p10: pl.p10, p90: pl.p90, ecart: r.valeur - pl.p50, pct: pl.p50 ? (r.valeur - pl.p50) / pl.p50 : null, attendu: t > M.today }; }
      else if (e.plan.t.length && t < e.plan.t[0]) r.plan = { avant: true };
    }
    if (M.demain) {
      const D = M.demain, i = plusProche(D.t, t);
      r.demain = { i, t: D.t[i], p10: D.budget.p10[i], p50: D.budget.p50[i], p90: D.budget.p90[i], apport: D.apport ? { p10: D.apport.p10[i], p50: D.apport.p50[i], p90: D.apport.p90[i] } : null,
        empruntable: D.empruntable[i], mensualite: D.mensualite ? D.mensualite[i] : null, bas: D.parTaux ? D.parTaux.bas[i] : null, haut: D.parTaux ? D.parTaux.haut[i] : null };
      r.valeur = D.budget.p50[i]; r.nature = "projete";
    }
    return r;
  }
  const NATURE = { observe: "observé", reconstitue: "reconstitué", aujourdhui: "aujourd'hui", projete: "projeté" };

  /* ---------- textes ---------- */
  const ap = v => "≈" + NB + fK(v);
  /** Montant lu à une date : exact pour l'observé, arrondi pour une projection. */
  const montantLu = l => (l.valeur == null ? "—" : l.nature === "projete" ? ap(l.valeur) : fEur(l.valeur));
  const avecEuros = M => (M.euros === "courants" ? ", en euros courants" : ", en euros d'aujourd'hui");
  /** Phrase de titre (aria-label de la courbe, début de l'en-tête de lecture) : « Aujourd'hui : 120 k€ · dans 10 ans : médiane 400 k€ (300 à 540 k€), en euros d'aujourd'hui. »
      `t` = fin de la fenêtre (date du dernier point futur visible). */
  function phraseTitre(M, t) {
    const lib = M.vue === "financier" ? "Patrimoine financier" : M.vue === "disponible" ? "Patrimoine disponible" : "Patrimoine net";
    if (M.mode === "capacite" && M.demain) {
      const l = lecture(M, null, t == null ? M.demain.t[M.demain.t.length - 1] : t);
      return capacitePhrase(M, l);
    }
    const aj = M.valeurAuj != null ? "Aujourd'hui : " + fK(M.valeurAuj) : lib + " : pas encore de valeur";
    if (!M.futur || t == null || t <= M.today) return aj + ".";
    const l = lecture(M, null, t), n = Math.max(1, Math.round(moisEntre(M.today, t) / 12 * 10) / 10);
    const dans = moisEntre(M.today, t) >= 12 ? "dans " + dureeTxt(moisEntre(M.today, t)) : "dans " + dureeTxt(Math.max(1, moisEntre(M.today, t)));
    const ec = M.euros === "courants" ? ", en euros de " + new Date(t).getUTCFullYear() : ", en euros d'aujourd'hui";
    const prov = M.brut && fini(M.brut.couverture) && M.brut.couverture < 0.6 ? " (provisoire)" : "";
    return aj + " · " + dans + " : médiane " + fK(l.p50) + (l.p10 != null && l.p90 != null ? " (" + fK(l.p10) + " à " + fK(l.p90) + ")" : "") + ec + prov + ".";
  }
  /** « En 2028, budget d'achat médian 310 000 € avec 55 000 € d'apport (9 chances sur 10 d'avoir au moins 40 000 €). » */
  function capacitePhrase(M, l) {
    const d = l.demain;
    if (!d) return "";
    const an = new Date(d.t).getUTCFullYear(), e = (d.t <= M.today ? "Aujourd'hui" : "En " + an);
    const ap0 = d.apport ? " avec " + fEur(Math.round(d.apport.p50 / 1000) * 1000) + " d'apport (9 chances sur 10 d'avoir au moins " + fEur(Math.round(d.apport.p10 / 1000) * 1000) + ")" : "";
    return e + ", budget d'achat médian " + fEur(Math.round(d.p50 / 1000) * 1000) + ap0 + ".";
  }
  /** Phrase de décomposition à un point futur : « Dont 190 k€ de ton patrimoine actuel et 210 k€ de ton épargne future, après 20 k€ de frais. » ; null sans les couches. */
  function decompositionPhrase(M, l) {
    if (l.existant == null || l.epargneFuture == null) return null;
    const dec = M.brut && Array.isArray(M.brut.decomposition) ? M.brut.decomposition : [], proche = dec.length ? dec.reduce((b, x) => (Math.abs(msDe(x.date) - l.t) < Math.abs(msDe(b.date) - l.t) ? x : b)) : null;
    const frais = proche && fini(proche.frais) ? +proche.frais : 0;
    return "Dont " + fK(l.existant) + " de ton patrimoine actuel et " + fK(l.epargneFuture) + " de ton épargne future" + (frais >= 1000 ? ", après " + fK(frais) + " de frais" : "") + ".";
  }
  /** En-tête de lecture : trois niveaux (k : date, v : valeur, s : fourchette ou nature). */
  function titreLecture(M, e, l, def) {
    const t = l.t;
    let k, v, s;
    if (M.mode === "capacite" && l.demain) {
      const d = l.demain;
      k = def && d.t > M.today ? "Dans " + dureeTxt(moisEntre(M.today, d.t)) + " · " + dMois(d.t) : t === M.today ? "Aujourd'hui · " + dJour(t) : cap1(dMois(d.t)) + " · dans " + dureeTxt(moisEntre(M.today, d.t));
      v = "≈" + NB + fK(d.p50);
      s = "Montant empruntable " + fK(d.empruntable) + (d.apport ? " · apport entre " + kRange(d.apport.p10, d.apport.p90) : "");
      return { k, v, s };
    }
    const pl = l.plan && !l.plan.avant ? l.plan : null;
    if (e && e.plan && def && e.plan.t) {
      const P = e.plan;
      const aj = planA(P, M.today), dernier = aj && M.valeurAuj != null ? M.valeurAuj - aj.p50 : null;
      if (dernier != null) {
        return { k: "Écart avec le plan du " + dJour(P.cree), v: fSE(dernier), s: (aj.p50 ? fPct(dernier / aj.p50) : "") + " · " + (dernier < 0 ? "en dessous de" : "au-dessus de") + " ce qui était prévu à ce jour" };
      }
    }
    k = t === M.today ? "Aujourd'hui · " + dJour(t) : def && t > M.today ? "Dans " + dureeTxt(moisEntre(M.today, t)) + " · " + dMois(t) : cap1(dMois(t)) + " · " + relatif(M.today, t);
    v = montantLu(l);
    if (l.nature === "projete" && l.p10 != null && l.p90 != null) s = chancesTxt(0.8) + " entre " + kRange(l.p10, l.p90);
    else if (l.nature === "reconstitue") s = "Estimé à partir de tes relevés";
    else s = pl ? "" : "Observé sur tes comptes";
    if (pl) s = (pl.attendu ? "Écart attendu avec le plan : " : "Écart avec le plan : ") + (pl.attendu ? fSK(pl.ecart) : fSE(pl.ecart));
    return { k, v, s };
  }
  /** Le jalon suivant aujourd'hui (le plus proche dans le futur) : null s'il n'y en a pas. */
  const prochainJalon = M => M.jalons.find(j => j.t > M.today && !estObjectif(j)) || M.jalons.find(j => j.t > M.today) || null;
  const libelleJalonCourt = (M, j) => {
    if (estObjectif(j)) { const o = M.objectifs.find(x => x.id === j.objectifId); const mot = o && o.probabilite != null ? motProba(o.probabilite) : o && STATUT_OBJ[o.statut] ? STATUT_OBJ[o.statut][0].toLowerCase() : ""; return j.titre + (mot ? " : " + mot : ""); }
    return j.titre;
  };
  /** Lecture en UNE ligne sous la courbe : date · valeur · fourchette · un événement (HTML échappé, parties en gras). */
  function ligneLecture(M, e, l, def) {
    const parts = [];
    const d = l.t === M.today ? "Aujourd'hui" : cap1(dMois(l.t));
    parts.push("<b>" + esc(d) + "</b>", "<b>" + esc(montantLu(l)) + "</b>");
    if (l.plan && !l.plan.avant) parts.push("écart " + esc(l.plan.attendu ? fSK(l.plan.ecart) : fSE(l.plan.ecart)));
    else if (l.nature === "projete" && l.p10 != null && l.p90 != null) parts.push(esc(kTiret(l.p10, l.p90)));
    else if (l.demain) parts.push(esc("emprunt " + fK(l.demain.empruntable)));
    else if (l.nature === "reconstitue") parts.push("estimé");
    const ev = l.jalons.concat(l.objectifs.length ? [] : []);
    if (!def && ev.length) parts.push(esc(libelleJalonCourt(M, ev[0]) + (ev.length > 1 ? " +" + (ev.length - 1) : "")));
    else if (def) { const n = prochainJalon(M); if (n) parts.push("prochain : " + esc(n.titre)); }
    return parts.join(" · ");
  }
  const chip = (txt, ton) => '<span class="gp-chip ' + (ton || "todo") + '">' + esc(txt) + "</span>";
  /** Ligne d'un objectif à une date (mot + couleur + probabilité, jamais la couleur seule). */
  function objectifLigne(M, o) {
    const mot = motProba(o.probabilite), st = STATUT_OBJ[o.statut] || null;
    const ton = mot ? TON_MOT[mot] : st ? st[1] : "todo";
    const verdict = mot || (st ? st[0].toLowerCase() : "");
    let h = '<div class="gp-ro-goal">' + chip(cap1(verdict || "sans verdict"), ton) + " <b>" + esc(plat(o.nom) || "Objectif") + " " + esc(fK(o.cible, o.cible % 1000 ? 1 : 0)) + "</b> : ";
    if (o.probabilite != null) h += esc(chancesTxt(o.probabilite)) + " d'atteindre la cible à l'échéance (" + esc(dMois(o.t)) + ")";
    else h += esc(o.statut === "hors_horizon" ? "échéance au-delà de l'horizon de la projection : aucune probabilité calculée" : "pas de probabilité calculée");
    if (fini(o.valeur_deterministe)) h += ". Au rythme médian prévu : " + esc(fK(o.valeur_deterministe));
    return h + ".</div>";
  }
  /** Panneau de lecture détaillé (feuille « Lecture » et panneau latéral) : HTML échappé. */
  function lectureHtml(M, e, l, opt) {
    const o = opt || {}, def = !!o.def;
    const tag = l.t === M.today ? "aujourd'hui" : l.nature === "projete" ? "projection" : l.nature === "reconstitue" ? "estimé" : "observé";
    let h = '<div class="gp-ro-h"><span class="gp-ro-date">' + esc(l.t === M.today ? "Aujourd'hui" : cap1(dMois(l.t))) + '</span><span class="gp-ro-tag">' + esc(tag) + "</span>" +
      (!def && o.effacer ? '<button type="button" class="gp-ro-x" data-act="effacer" aria-label="Effacer la lecture">' + ICO.x + "</button>" : "") + "</div>";
    if (M.mode === "capacite" && l.demain) {
      const d = l.demain;
      h += '<div class="gp-ro-v"><b>' + esc(montantLu(l)) + '</b><span class="gp-ro-dl">budget d\'achat médian</span></div>';
      h += rangeBar(d.p10, d.p50, d.p90, null, null, "8 chances sur 10");
      h += '<div class="gp-ro-d">Montant empruntable : <b>' + esc(fEur(Math.round(d.empruntable / 1000) * 1000)) + "</b>" + (d.mensualite != null ? ", mensualité maximale <b>" + esc(fEur(Math.round(d.mensualite))) + "</b>" : "") + ".</div>";
      if (d.apport) h += '<div class="gp-ro-d">Apport mobilisable : <b>' + esc(fK(d.apport.p50)) + "</b> au milieu des scénarios (9 chances sur 10 d'avoir au moins <b>" + esc(fK(d.apport.p10)) + "</b>).</div>";
      if (d.bas != null && d.haut != null) h += '<div class="gp-ro-d">Si le taux est 1 point plus bas : <b>' + esc(fK(d.bas)) + "</b> ; 1 point plus haut : <b>" + esc(fK(d.haut)) + "</b> (taux du jour supposé constant).</div>";
    } else {
      const dl = l.t === M.today ? "" : M.valeurAuj != null && l.valeur != null ? esc(fSK(l.valeur - M.valeurAuj)) + " par rapport à aujourd'hui" : "";
      h += '<div class="gp-ro-v"><b>' + esc(montantLu(l)) + '</b><span class="gp-ro-dl">' + dl + "</span></div>";
      if (l.plan && !l.plan.avant) {
        const neg = l.plan.ecart < 0;
        h += '<div class="gp-ro-cmp"><div><span>Prévu</span><b>' + esc(l.plan.attendu ? ap(l.plan.prevu) : fEur(l.plan.prevu)) + "</b></div><div><span>" + (l.plan.attendu ? "Projection" : "Réel") + "</span><b>" + esc(montantLu(l)) + '</b></div><div class="' + (neg ? "neg" : "pos") + '"><span>Écart</span><b>' + esc(l.plan.attendu ? fSK(l.plan.ecart) : fSE(l.plan.ecart)) + "</b></div></div>" +
          '<div class="gp-ro-d">' + (l.plan.attendu ? "Écart attendu" : "Écart") + " : <b>" + esc((l.plan.attendu ? fSK(l.plan.ecart) : fSE(l.plan.ecart)) + (l.plan.pct != null ? " (" + fPct(l.plan.pct) + ")" : "")) + "</b>, " + (neg ? "en dessous" : "au-dessus") + " du plan figé.</div>";
      } else if (l.plan && l.plan.avant) h += '<div class="gp-ro-d">Avant la date du plan : il n\'existait pas encore.</div>';
      else if (l.nature === "projete" && l.p10 != null) {
        h += rangeBar(l.p10, l.p50, l.p90, l.p25, l.p75, "1 chance sur 2");
        if (l.existant != null) h += '<div class="gp-ro-d"><i class="gp-sw gp-sw-sv"></i>Ton patrimoine actuel, sans nouveau versement : <b>' + esc(fK(l.existant)) + "</b></div>";
        if (l.epargneFuture != null) h += '<div class="gp-ro-d num">+ ton épargne future et tes projets : <b>' + esc(fSK(l.epargneFuture)) + "</b>" + (l.versements != null && l.croissance != null ? " (dont <b>" + esc(fSK(l.versements)) + "</b> versés et <b>" + esc(fSK(l.croissance)) + "</b> de croissance)" : "") + "</div>";
        if (l.variante && l.variante.p50 != null) h += '<div class="gp-ro-d"><i class="gp-sw gp-sw-var"></i>Variante « ' + esc(l.variante.nom) + " » : <b>" + esc(fK(l.variante.p50)) + "</b> (" + esc(fSK(l.variante.p50 - l.p50)) + " en médiane).</div>";
        if (l.crise) h += '<div class="gp-ro-d"><i class="gp-sw gp-sw-cr"></i>Avec ' + esc(l.crise.label) + " rejouée : <b>" + esc(fK(l.crise.valeur)) + "</b> (" + esc(fSK(l.crise.valeur - l.p50)) + ").</div>";
      } else if (l.nature === "reconstitue") h += '<div class="gp-ro-d">Reconstitué à partir de tes cours, transactions et soldes bancaires : une estimation, moins fiable qu\'une photo.</div>';
      else if (l.nature === "observe") h += '<div class="gp-ro-d">Relevé sur tes comptes (photo nocturne).</div>';
      else if (l.t === M.today) h += '<div class="gp-ro-d">Valeur d\'aujourd\'hui, d\'après tes lignes à jour.</div>';
    }
    if (l.capacite && M.mode !== "capacite") h += '<div class="gp-ro-d num">Capacité d\'épargne ' + (l.t <= M.today ? "constatée" : "ce mois-là") + " : <b>" + esc(fMoisU(l.capacite.montant)) + "</b>" + (l.capacite.raison ? " · " + esc(l.capacite.raison) : "") + "</div>";
    l.objectifs.forEach(ob => { h += objectifLigne(M, ob); });
    if (def) { const n = prochainJalon(M); if (n) h += '<div class="gp-ro-cs"><button type="button" class="gp-evc" data-jalon="' + esc(n.id) + '">' + icone(n) + "Prochain : " + esc(n.titre) + " <span>" + esc(relatif(M.today, n.t)) + "</span></button></div>"; }
    else if (l.jalons.length) h += '<div class="gp-ro-cs">' + l.jalons.map(j => '<button type="button" class="gp-evc" data-jalon="' + esc(j.id) + '">' + icone(j) + esc(libelleJalonCourt(M, j)) + (effetMensuel(j) != null && !estObjectif(j) ? " <span>" + esc(fMois(effetMensuel(j))) + "</span>" : "") + "</button>").join("") + "</div>";
    if (def && !o.sansAide) h += '<div class="gp-ro-hint">' + esc(o.survol ? "Survole ou clique la courbe pour lire une date." : "Touche ou fais glisser sur la courbe pour lire une date.") + "</div>";
    return h;
  }
  function rangeBar(p10, p50, p90, p25, p75, libInterne) {
    const lo = p10, hi = p90, pc = x => (hi > lo ? ((x - lo) / (hi - lo) * 100) : 50).toFixed(1);
    let h = '<div class="gp-rb" aria-hidden="true"><i class="o" style="left:0;right:0"></i>' + (p25 != null && p75 != null ? '<i class="n" style="left:' + pc(p25) + "%;right:" + (100 - pc(p75)).toFixed(1) + '%"></i>' : "") + '<i class="md" style="left:' + pc(p50) + '%"></i></div>';
    h += '<div class="gp-rb-l"><b>' + esc(fK(p10)) + "</b>" + (p25 != null && p75 != null ? '<span><i class="gp-sw gp-sw-in"></i>' + esc(libInterne) + " : <b>" + esc(kTiret(p25, p75)) + "</b></span>" : "<span></span>") + "<b>" + esc(fK(p90)) + "</b></div>";
    return h;
  }
  /** En-tête sous la lecture : phrase de décomposition, événements pris en compte (ou la question), garde-fous (une ligne chacun). */
  function enteteHtml(M, l, opt) {
    const o = opt || {}, B = M.brut || {};
    let h = "";
    const dp = l ? decompositionPhrase(M, l) : null;
    if (dp) h += '<p class="gp-en-dec">' + esc(dp) + "</p>";
    const evs = tab(B.evenements_pris_en_compte);
    if (M.mode !== "capacite") {
      if (evs.length) h += '<p class="gp-en-ev">Événements pris en compte : ' + esc(evs.join(", ")) + ".</p>";
      else if (M.futur) h += '<p class="gp-en-ev gp-en-q">' + esc(B.question_evenements || "Aucun événement renseigné — as-tu des changements prévus ? Un enfant, un changement d'emploi, un déménagement, un achat ?") + "</p>";
    }
    tab(B.garde_fous).forEach(g => { if (g && g.texte) h += '<p class="gp-en-gf" data-gf="' + esc(g.cle || "") + '">' + esc(g.texte) + "</p>"; });
    if (M.mode !== "capacite" && B.capacite_source) h += '<p class="gp-en-cap">' + esc(capaciteSourceTxt(B)) + "</p>";
    void o;
    return h;
  }
  /** « Épargne mensuelle projetée : 300 € — ta capacité d'épargne constatée (avril à septembre 2026, comptes courants) » ; jamais deux sources à la fois. */
  function capaciteSourceTxt(B) {
    const cb = B.capacite && B.capacite.base ? B.capacite.base : null, m = cb && fini(cb.retenue) ? fEur(cb.retenue) : null;
    if (!cb || B.capacite_source == null) return "Pas encore de capacité d'épargne connue : la projection suppose 0 € par mois.";
    if (B.capacite_source === "reel") return "Épargne mensuelle projetée : " + m + " — ta capacité d'épargne constatée (" + plat(B.capacite_periode || (cb.periode || "")) + ", comptes courants).";
    if (B.capacite_source === "montant") return "Épargne mensuelle projetée : " + m + " — le montant que tu as fixé.";
    return "Épargne mensuelle projetée : " + m + " — ta capacité d'épargne prévue au budget (pas encore de comptes connectés).";
  }

  /* ---------- icônes (même alphabet que la maquette : traits de 1,5 px, viewBox -10 10) ---------- */
  const ICONES_JALON = {
    emploi: '<path d="M-7 -3h14v9.5h-14z"/><path d="M-3 -3v-2.5h6v2.5"/><path d="M-7 1h14"/>',
    enfant: '<path d="M0 6.5C-6.5 2.2 -7.6 -2.4 -4.6 -4.8C-2.7 -6.2 -0.8 -5.4 0 -3.6C0.8 -5.4 2.7 -6.2 4.6 -4.8C7.6 -2.4 6.5 2.2 0 6.5z"/>',
    cle: '<path d="M-6 -1h12v8h-12z"/><path d="M-3.5 -1v-3a3.5 3.5 0 0 1 6.9 -0.8"/><path d="M0 2v2"/>',
    ecole: '<path d="M-7 1h6v6h-6z"/><path d="M1 1h6v6h-6z"/><path d="M-3 -6h6v6h-6z"/>',
    drapeau: '<path d="M-5 7.5V-7"/><path d="M-5 -6h10l-2.5 3.5 2.5 3.5h-10"/>',
    maison: '<path d="M-7.5 0.5L0 -6.5 7.5 0.5"/><path d="M-5.5 -1.5V7h11V-1.5"/><path d="M-1.8 7v-4h3.6v4"/>',
    calendrier: '<path d="M-6.5 -4h13v11h-13z"/><path d="M-6.5 0h13"/><path d="M-3 -6.5v4M3 -6.5v4"/>',
    retrait: '<path d="M0 -6v10"/><path d="M-4 0l4 4 4 -4"/><path d="M-6.5 7h13"/>',
    crise: '<path d="M0 -7l7.5 13h-15z"/><path d="M0 -2v4"/><path d="M0 4.2v0.2"/>',
    cible: '<circle r="7.5"/><circle r="4"/><circle r="0.8"/>',
    etincelle: '<path d="M0 -7.5l1.9 5.6 5.6 1.9 -5.6 1.9 -1.9 5.6 -1.9 -5.6 -5.6 -1.9 5.6 -1.9z"/>',
  };
  const iconeDe = j => (estObjectif(j) ? "cible" : ICONES_JALON[j.icone] ? j.icone : ICONES_JALON[j.type] ? j.type : j.source === "calendrier" ? "calendrier" : j.source === "credit" ? "cle" : "etincelle");
  const icoH = (nom, sz) => '<svg class="gp-i" width="' + (sz || 16) + '" height="' + (sz || 16) + '" viewBox="-10 -10 20 20" aria-hidden="true" focusable="false">' + (ICONES_JALON[nom] || "") + "</svg>";
  const icone = j => icoH(iconeDe(j), 16);
  const icoG = (nom, x, y, sc) => '<g class="gp-i" transform="translate(' + x.toFixed(1) + " " + y.toFixed(1) + ") scale(" + (sc || 0.6) + ')">' + (ICONES_JALON[nom] || "") + "</g>";
  const ICO = {
    reglages: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    plein: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M9 3v12M3 9h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
    moins: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M3 9h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  };

  /* ---------- tableau de données (équivalent accessible de la courbe) ---------- */
  /** Une ligne par pas (granularité de la fenêtre) : date, nature, P10, P25, médiane, P75, P90, existant, variante, écart ; puis les jalons avec leur effet. */
  function tableauHtml(M, dom, gran, opt) {
    const o = opt || {};
    const ech = echantillons(M, dom, gran);
    const th = ["Date", "Nature", "P10", "P25", "Médiane", "P75", "P90", "Sans versement", "Variante", "Écart"].map(t => '<th scope="col">' + t + "</th>").join("");
    const c = x => (x == null || !isFinite(x) ? "—" : fEur(x));
    const lignes = [];
    ech.temps.forEach(t => {
      const l = lecture(M, o.etat || null, t, { demi: 1 });
      const nat = l.t === M.today ? "aujourd'hui" : NATURE[l.nature] || l.nature;
      const ecart = l.variante && l.variante.p50 != null && l.p50 != null ? fSE(l.variante.p50 - l.p50) : l.plan && !l.plan.avant ? fSE(l.plan.ecart) : "—";
      lignes.push('<tr data-t="' + t + '"><th scope="row">' + esc(dJour(t)) + "</th><td>" + esc(nat) + '</td><td class="n">' + esc(c(l.p10)) + '</td><td class="n">' + esc(c(l.p25)) + '</td><td class="n">' + esc(c(l.nature === "projete" ? l.p50 : l.valeur)) +
        '</td><td class="n">' + esc(c(l.p75)) + '</td><td class="n">' + esc(c(l.p90)) + '</td><td class="n">' + esc(c(l.existant)) + '</td><td class="n">' + esc(c(l.variante ? l.variante.p50 : null)) + '</td><td class="n">' + esc(ecart) + "</td></tr>");
    });
    if (!lignes.length) return "";
    const jal = M.jalons.map(j => '<tr><th scope="row">' + esc(dJour(j.t)) + "</th><td colspan=\"9\">" + esc(j.titre) + (j.effet && j.effet.texte ? " — " + esc(j.effet.texte) : "") + "</td></tr>");
    return '<div class="gp-tab-wrap" tabindex="0" role="region" aria-label="Données du graphique"><table class="gp-tab"><caption class="ui-sr">' + esc(titreAccessible(M)) + " : une ligne par " + esc(gran) + ' affichée</caption><thead><tr>' + th + "</tr></thead><tbody>" + lignes.join("") +
      (jal.length ? '<tr class="gp-tab-sep"><th scope="colgroup" colspan="10">Jalons</th></tr>' + jal.join("") : "") + "</tbody></table></div>";
  }
  const titreAccessible = M => (M.mode === "capacite" ? "Budget d'achat dans le temps" : M.vue === "financier" ? "Patrimoine financier " + M.perimetre : M.vue === "disponible" ? "Patrimoine disponible " + M.perimetre : "Patrimoine net " + M.perimetre).trim();

  /* ---------- feuille « Comment c'est calculé » ---------- */
  /** Contenu (HTML échappé) : méthode en cinq phrases, hypothèses (source et date), base de la capacité, données utilisées et manquantes, rétro-contrôle, limites, graine, tableau. */
  function calculHtml(M, opt) {
    const o = opt || {}, B = M.brut || {}, li = t => "<li>" + t + "</li>";
    let h = '<p class="gp-sh-note"><strong>Projection, pas une promesse.</strong> Une courbe, trois natures de points : seul le trait plein est une mesure.</p>';
    h += '<h3 class="gp-sec-t">Méthode</h3><ol class="gp-liste">' +
      li("<strong>Observé</strong> : chaque nuit, Boussole photographie la valeur de tes placements ; à cette valeur s'ajoutent l'immobilier, les autres biens et les dettes d'aujourd'hui.") +
      li("<strong>Reconstitué</strong> (pointillés, fond hachuré) : avant ta première photo, le calcul est refait à rebours à partir des cours, de tes transactions et des soldes bancaires. C'est une estimation.") +
      li("<strong>Projeté</strong> : " + esc(String(B.chemins || 2000)) + " trajectoires de marché simulées (graine fixe " + esc(String(B.graine || "")) + ", donc le même résultat à chaque lecture), net de frais, avec ta capacité d'épargne mois par mois et tes événements de vie.") +
      li("La ligne est la médiane : une chance sur deux de faire mieux. La bande foncée contient une trajectoire sur deux ; la bande claire, huit sur dix.") +
      li("Les montants futurs sont en " + (M.euros === "courants" ? "euros courants (tels qu'ils apparaîtront sur tes relevés)" : "euros d'aujourd'hui (l'inflation supposée est retirée)") + ".") + "</ol>";
    if (M.brut && M.brut.passe && M.brut.passe.drapeaux) h += passeHtml(M.brut.passe);
    const cs = capaciteSourceTxt(B);
    if (M.mode !== "capacite") h += '<h3 class="gp-sec-t">Base de l\'épargne</h3><p class="gp-sh-note">' + esc(cs) + "</p>";
    const hyp = tab(B.hypotheses);
    if (hyp.length) {
      h += '<h3 class="gp-sec-t">Hypothèses</h3><ul class="gp-liste">' + hyp.map(x => li(esc(x.libelle || x.cle) + " : <strong>" + esc(String(x.valeur).replace(".", ",")) + esc(x.unite ? NB + x.unite : "") + "</strong>" +
        (x.statut && x.statut !== "ok" ? " (" + esc(x.statut) + ")" : "") + (x.source_titre ? " · " + (/^https:\/\//.test(String(x.source_url || "")) ? '<a href="' + esc(x.source_url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.source_titre) + '<span class="ui-sr"> (nouvel onglet)</span></a>' : esc(x.source_titre)) : "") +
        (x.verifie_le ? " · vérifié le " + esc(dJour(msDe(x.verifie_le))) : ""))).join("") + "</ul>";
    }
    const manque = tab(B.a_completer);
    h += '<h3 class="gp-sec-t">Données utilisées et ce qui manque</h3>';
    h += '<p class="gp-sh-note">Couverture des données : ' + (fini(B.couverture) ? Math.round(B.couverture * 100) + " %" : "inconnue") + (fini(B.couverture) && B.couverture < 0.6 ? " (la projection reste provisoire)" : "") + ".</p>";
    if (manque.length) h += '<ul class="gp-liste">' + manque.map(x => li(esc(x.titre) + " : " + esc(x.effet) + (x.phrase_claude && o.claude ? " " + o.claude(x.phrase_claude, "Compléter avec Claude") : ""))).join("") + "</ul>";
    else h += '<p class="gp-sh-note">Rien d\'important ne manque.</p>';
    if (tab(B.avertissements).length) h += '<h3 class="gp-sec-t">Hypothèses prises par défaut</h3><ul class="gp-liste gp-av">' + B.avertissements.map(a => li(esc(a))).join("") + "</ul>";
    h += '<h3 class="gp-sec-t">Rétro-contrôle</h3>';
    if (B.retro && B.retro.phrase) {
      h += '<p class="gp-sh-note">' + esc(B.retro.phrase) + "</p>";
      if (tab(B.retro.limites).length) h += '<ul class="gp-liste">' + B.retro.limites.map(l => li(esc(l))).join("") + "</ul>";
    } else h += '<p class="gp-sh-note">' + esc(B.retro_raison || "Pas encore assez d'historique pour vérifier la projection sur le passé.") + "</p>";
    h += '<h3 class="gp-sec-t">Limites</h3><ul class="gp-liste">' +
      li("Le passé reconstitué suppose que tes lignes n'ont pas changé sans transaction ; un achat non enregistré le fausse.") +
      li("Aucun modèle des taux d'intérêt, de l'inflation ou de ta carrière au-delà de ce que tu as renseigné : seuls tes événements de vie sont pris en compte.") +
      li("Les rendements sont des hypothèses sourcées ci-dessus, pas des prévisions ; les marchés ne suivent pas une moyenne.") + "</ul>";
    if (B.version_modele) h += '<p class="gp-sh-note">Version du modèle : ' + esc(B.version_modele) + " · graine " + esc(String(B.graine || "")) + " · " + esc(String(B.chemins || "")) + " chemins.</p>";
    if (o.tableau) h += '<h3 class="gp-sec-t">Données</h3>' + o.tableau;
    return h;
  }
  /** Paragraphe sur la reconstitution du passé (drapeaux de Historique.reconstituer). */
  function passeHtml(P) {
    const d = P.drapeaux, li = t => "<li>" + t + "</li>";
    if (!d) return "";
    let h = '<h3 class="gp-sec-t">Reconstitution du passé</h3><ul class="gp-liste">' +
      li("<strong>lignes cotées</strong> : quantité × cours de clôture du jour" + (tab(d.viaTransactions).length ? " ; les quantités remontent le temps par tes transactions (" + esc(d.viaTransactions.join(", ")) + ")" : "") +
        (tab(d.compositionActuelle).length ? " ; sans transaction, la quantité d'aujourd'hui est utilisée, « à composition actuelle » (" + esc(d.compositionActuelle.join(", ")) + ")" : "")) +
      (tab(d.bancaires).length ? li("<strong>comptes bancaires connectés</strong> : solde d'aujourd'hui moins les opérations postérieures, sur les 90 derniers jours seulement (" + esc(d.bancaires.join(", ")) + "), puis solde tenu constant") : "") +
      li("<strong>toutes les autres lignes</strong> : tenues à leur valeur d'aujourd'hui" + (d.constantes && tab(d.constantes.noms).length ? " (" + esc(d.constantes.noms.join(", ")) + " : " + esc(fEur(d.constantes.montant)) + ")" : "")) +
      (tab(d.courteHistoire).length ? li("historique de cours plus court que la courbe : " + esc(d.courteHistoire.join(", ")) + " (valeur de leur premier cours avant)") : "") + "</ul>";
    h += '<p class="gp-sh-note">Quand une photo existe, elle l\'emporte toujours sur le reconstitué de la même date' + (P.decalage ? " ; le reconstitué est décalé de " + esc(fSE(P.decalage)) + " pour rejoindre ta première photo sans cassure" : "") + ". Un achat non enregistré ou une composition qui a changé sans transaction faussent le passé.</p>";
    if (P.euros_constants === false) h += '<p class="gp-sh-note">Le passé est en euros courants : l\'indice des prix n\'est pas disponible pour le convertir.</p>';
    return h;
  }

  /* ---------- feuille d'un jalon ---------- */
  const cleLigne = (k, v) => '<div class="gp-sh-kv"><span>' + esc(k) + "</span><b>" + v + "</b></div>";
  /** Détail d'un jalon (HTML échappé). extra = { impact?: { montant, ans } | "calcul" | null, claude?: (question, libelle) => html }. */
  function jalonDetailHtml(M, j, extra) {
    const x = extra || {}, rel = relatif(M.today, j.t);
    const date = j.tFin ? dMois(j.t) + " → " + dMois(j.tFin) : dMois(j.t);
    let h = '<p class="gp-sh-meta num">' + esc(estObjectif(j) ? "échéance " + dMois(j.t) : date) + " · " + esc(rel) + (j.source === "calendrier" ? " · repère du calendrier de tes enveloppes" : "") + "</p>";
    const e = effetMensuel(j), E = j.effet || {};
    if (!estObjectif(j)) {
      if (e != null && j.source !== "calendrier") h += cleLigne("Effet sur ta capacité d'épargne", esc(fMois(e)));
      const avant = capaciteA(M, ajouterMois(j.t, -1)), apres = capaciteA(M, ajouterMois(j.t, 1));
      if (avant && apres && !avant.passe && Math.abs(avant.montant - apres.montant) >= 1) h += cleLigne("Capacité avant → après", esc(fInt(avant.montant) + " → " + fMoisU(apres.montant)));
      const mt = E.montants || {};
      if (fini(mt.frais_acquisition) && +mt.frais_acquisition > 0) h += cleLigne("Effet immédiat sur le patrimoine net", esc(fSK(-mt.frais_acquisition)) + " (frais d'acquisition)");
      if (x.impact === "calcul") h += cleLigne("Effet sur la médiane à l'horizon", '<span data-impact>calcul en cours…</span>');
      else if (x.impact && fini(x.impact.montant) && Math.abs(x.impact.montant) > 500) h += cleLigne("Effet sur la médiane dans " + dureeTxt(x.impact.mois), "≈ " + esc(fSK(x.impact.montant)));
      if (E.texte) h += "<p>" + esc(E.texte) + "</p>";
      if (j.brut && j.brut.quotient_familial) h += "<p>" + esc(j.brut.quotient_familial) + "</p>";
    } else {
      const o = M.objectifs.find(z => z.id === j.objectifId);
      if (o) {
        const mot = motProba(o.probabilite), st = STATUT_OBJ[o.statut], ton = mot ? TON_MOT[mot] : st ? st[1] : "todo";
        h += cleLigne("Verdict", chip(cap1(mot || (st ? st[0].toLowerCase() : "sans verdict")), ton));
        h += cleLigne("Cible", esc(fEur(o.cible) + " en " + dMois(o.t)));
        if (fini(o.deja)) h += cleLigne("Déjà de côté", esc(fEur(o.deja) + " (" + Math.round(o.deja / o.cible * 100) + NB + "%)"));
        h += cleLigne("Chances d'atteindre la cible", o.probabilite != null ? esc(chancesTxt(o.probabilite)) : "pas de probabilité (échéance au-delà de la projection)");
        if (fini(o.valeur_deterministe)) h += cleLigne("À l'échéance, au rythme médian", esc(o.valeur_deterministe >= o.cible ? fK(o.valeur_deterministe - o.cible, 1) + " d'avance" : "il manque " + fK(o.cible - o.valeur_deterministe, 1)));
        if (tab(o.leviers).length) h += "<h4>Leviers</h4>" + o.leviers.map(l => '<div class="gp-lev"><span><b>' + esc(l.titre) + "</b><small>" + esc(l.detail || "") + "</small></span>" + (l.question && x.claude ? x.claude(l.question, "Demander à Claude") : "") + "</div>").join("");
      }
      if (E.texte) h += "<p>" + esc(E.texte) + "</p>";
    }
    return h;
  }
  /** Liste chronologique des jalons (feuille « N jalons ») : toucher une ligne place le curseur ; › ouvre le détail. */
  function jalonsListeHtml(M, dom, selectionIds) {
    const sel = selectionIds || [];
    const rows = M.jalons.map((j, i) => {
      const dedans = j.t >= dom.debut && j.t <= dom.fin;
      const o = estObjectif(j) ? M.objectifs.find(z => z.id === j.objectifId) : null;
      const mot = o ? motProba(o.probabilite) : null, st = o && STATUT_OBJ[o.statut];
      const date = estObjectif(j) ? "échéance " + dMois(j.t) + (o && o.probabilite != null ? " · " + chancesTxt(o.probabilite) : "") : (j.tFin ? dMois(j.t) + " → " + dMois(j.tFin) : dMois(j.t)) + " · " + relatif(M.today, j.t);
      const eff = estObjectif(j) ? chip(cap1(mot || (st ? st[0] : "—")), mot ? TON_MOT[mot] : st ? st[1] : "todo") : effetMensuel(j) != null && j.source !== "calendrier" ? esc(fMois(effetMensuel(j))) : "";
      return '<li class="gp-jrow"><button type="button" class="gp-evrow' + (dedans ? "" : " out") + '" data-jump="' + esc(j.id) + '" aria-current="' + sel.includes(j.id) + '"><span class="gp-pn ic">' + icoH(iconeDe(j), 14) + '</span><span class="gp-ev-m"><span class="gp-ev-t">' + esc(j.titre) +
        '</span><span class="gp-ev-d num">' + esc(date) + (dedans ? "" : " · hors fenêtre") + '</span></span><span class="gp-ev-e num">' + eff + '</span></button><button type="button" class="gp-jdet" data-jdet="' + esc(j.id) + '" aria-label="Détail : ' + esc(j.titre) + '">›</button></li>';
    });
    return '<p class="gp-sh-meta">Toucher une ligne place la lecture à cette date ; › ouvre le détail.</p><ol class="gp-evl">' + rows.join("") + "</ol>";
  }
  /** Groupe de jalons rapprochés (feuille d'un marqueur fusionné). */
  function groupeHtml(M, jalons, extra) {
    return '<p class="gp-sh-meta num">' + esc(dMois(jalons[0].t) + " → " + dMois(jalons[jalons.length - 1].t)) + "</p>" +
      jalons.map(j => "<h4>" + esc(j.titre) + '</h4><div data-jalon-bloc="' + esc(j.id) + '">' + jalonDetailHtml(M, j, extra) + '</div><div class="gp-sh-acts"><button type="button" class="gp-btn ghost" data-go="' + esc(j.id) + '">Voir sur la courbe</button></div>').join("");
  }

  /* ---------- rendu SVG (pur : chaînes) ---------- */
  /** Largeur approchée d'un texte de 12 px (le navigateur la remplace par une mesure réelle via params.mesurer). */
  const mesureApprox = (t, poids) => String(t).length * (poids >= 600 ? 6.9 : 6.4);
  const MODES = {
    /* carte : mobile (≈ 390 px) et ordinateur ; le titre flotte dans le tracé, jalons presque invisibles, une seule étiquette */
    carte: { compact: true, gutter: 50, yTicks: 4, plotH: 284, labelsAll: false, pins: false, clusterPx: 12, stripH: 28, hover: false, select: false, brush: false, plein: false },
    /* plein écran, téléphone en paysage : barre fine, courbe sur toute la largeur, lecture à droite, pastilles numérotées et libellées */
    paysage: { compact: false, gutter: 56, yTicks: 5, labelsAll: true, pins: true, pinLabels: true, railRows: 2, clusterPx: 0, stripH: 30, hover: false, select: false, brush: true, fill: true, plein: true },
    /* plein écran, ordinateur : grande courbe, axe jusqu'à 8 graduations, tous les libellés, panneau latéral */
    bureau: { compact: false, gutter: 72, yTicks: 8, labelsAll: true, pins: true, pinLabels: true, fullLabels: true, railRows: 2, clusterPx: 0, stripH: 48, hover: true, select: true, brush: true, fill: true, plein: true },
    /* plein écran, téléphone en portrait : la carte agrandie, avec l'aperçu */
    portrait: { compact: false, gutter: 50, yTicks: 4, labelsAll: false, pins: true, pinLabels: false, railRows: 1, clusterPx: 0, stripH: 38, hover: false, select: false, brush: true, plein: true },
  };
  /** Paramètres d'un mode pour une largeur donnée (une carte large gagne en hauteur de tracé, en graduations et en survol). */
  function parametresMode(nom, W, opt) {
    const p = Object.assign({ nom }, MODES[nom] || MODES.carte), o = opt || {};
    if (nom === "carte" && W >= 600) { p.gutter = 58; p.yTicks = 5; p.plotH = W >= 1100 ? 440 : W >= 800 ? 380 : 330; p.hover = o.souris !== false; p.stripH = 32; }
    if (nom === "carte") p.hover = p.hover || o.souris === true;
    if (nom === "portrait") p.plotH = Math.round(clamp((o.hauteurFenetre || 800) * 0.42, 220, 420));
    return p;
  }
  /** Libellés de l'axe du temps : années ou mois selon la place (au moins 46 / 72 px entre deux), « Aujourd'hui » toujours écrit, sans chevauchement. */
  function libellesTemps(dom, X, W, mesurer, today) {
    const px = X(dom.fin) - X(dom.debut), moisVisibles = Math.max(1, (dom.fin - dom.debut) / (30.44 * MS_JOUR)), pxm = px / moisVisibles;
    let pas = 120;
    for (const s of [1, 3, 6, 12, 24, 60, 120]) { const besoin = s < 12 ? 72 : 46; if (s * pxm >= besoin) { pas = s; break; } }
    const cand = [], d0 = new Date(dom.debut), d1 = new Date(dom.fin);
    for (let y = d0.getUTCFullYear(); y <= d1.getUTCFullYear(); y++) for (let m = 0; m < 12; m++) {
      const ms = Date.UTC(y, m, 1);
      if (ms < dom.debut || ms > dom.fin) continue;
      const abs = y * 12 + m;
      if (pas < 12) { if (abs % pas !== 0) continue; } else if (m !== 0 || y % (pas / 12) !== 0) continue;
      const t = pas < 12 ? MOIS[m] + " " + y : String(y);
      cand.push({ x: X(ms), t, w: mesurer(t, 400) });
    }
    const out = [];
    if (today >= dom.debut && today <= dom.fin) { const w = mesurer("Aujourd'hui", 700); out.push({ x: clamp(X(today), w / 2, W - w / 2), t: "Aujourd'hui", w, b: true }); }
    cand.forEach(l => { if (l.x - l.w / 2 < 0 || l.x + l.w / 2 > W) return; if (out.some(o => Math.abs(o.x - l.x) < (o.w + l.w) / 2 + 8)) return; out.push(l); });
    return out;
  }

  /** Construit le graphe : { svg, geo }. M = normaliser(donnees) ; etat = { dom, gran, couches: { existant, avenirs, plan, ... }, ... } ; P = paramètres du mode + { W, H? }. */
  function construireSvg(M, etat, P) {
    const mesurer = P.mesurer || mesureApprox, W = Math.max(200, P.W | 0), dom = etat.dom, gran = etat.gran, C = etat.couches || {};
    const id = P.id || "gp", R = W - P.gutter, L = 0, span = dom.fin - dom.debut;
    const X = t => L + (t - dom.debut) / span * (R - L);
    const ech = echantillons(M, dom, gran), F = M.futur;
    const planSerie = C.plan || null;
    /* échelle des y : mémorisée entre l'aperçu (500 chemins) et le résultat complet */
    const besoin = besoinY(M, dom, ech, { existant: C.existant, plan: planSerie && planSerie.valeurs, demain: M.demain && M.demain.serie ? M.demain.serie.emprunt : M.demain ? M.demain.empruntable : null });
    const dy = etat.echelleY ? etat.echelleY : domaineY(besoin.lo, besoin.hi), lo = dy.lo, hi = dy.hi;
    const grad = graduations(lo, hi, P.yTicks);
    const topX = P.compact ? 24 : 10, railH = P.compact ? 6 : P.pins ? P.railRows * 24 + 22 : 0, labH = 22;
    const bottom = railH + labH;
    let plotH = P.plotH;
    if (P.fill && P.H) plotH = Math.max(64, P.H - topX - bottom);
    const T = topX, B = topX + plotH, H = B + bottom, DT = P.compact ? T + 80 : T;
    const Y = v => DT + (1 - (v - lo) / (hi - lo)) * (B - DT);
    const f1 = v => v.toFixed(1), cid = id + "c", hid = id + "h";
    let s = '<defs><clipPath id="' + cid + '"><rect x="' + L + '" y="' + (DT - 2) + '" width="' + (R - L) + '" height="' + (B - DT + 4) + '"/></clipPath>' +
      '<pattern id="' + hid + '" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="gp-hatch"/></pattern>' +
      '<linearGradient id="' + id + 'g1" x1="0" x2="1" y1="0" y2="0"><stop offset="0" class="gs-a"/><stop offset="1" class="gs-b"/></linearGradient>' +
      '<linearGradient id="' + id + 'g2" x1="0" x2="1" y1="0" y2="0"><stop offset="0" class="gs-c"/><stop offset="1" class="gs-d"/></linearGradient></defs>';
    /* pastille de fin : valeur de la médiane au dernier point visible */
    const aFutur = !!F && dom.fin > M.today;
    let pill = null;
    if (aFutur) {
      const i = indexAvant(F.t, dom.fin);
      pill = { v: F.p50[Math.max(0, i)], t: F.t[Math.max(0, i)], futur: true };
    } else if (M.passe.t.length) { const i = Math.max(0, indexAvant(M.passe.t, dom.fin)); pill = { v: M.passe.v[i], t: M.passe.t[i], futur: false }; }
    const pillY = pill ? clamp(Y(pill.v), T + 10, B - 10) : null;
    /* grille et graduations (celle qui tombe sur la pastille est masquée) */
    const ticks = [];
    s += '<g aria-hidden="true">';
    grad.valeurs.forEach((v, k) => {
      const y = Y(v);
      if (y < DT - 1 || y > B + 1) return;
      ticks.push({ v, y, label: grad.libelles[k] });
      s += '<line class="gp-gr" x1="' + L + '" x2="' + f1(R) + '" y1="' + f1(y) + '" y2="' + f1(y) + '"/>';
      if (!(pillY != null && Math.abs(y - pillY) < 20)) s += '<text class="gp-ytk" data-y="' + f1(y) + '" x="' + (W - 2) + '" y="' + f1(y + 4) + '" text-anchor="end">' + esc(grad.libelles[k]) + "</text>";
      else s += '<text class="gp-ytk" data-y="' + f1(y) + '" x="' + (W - 2) + '" y="' + f1(y + 4) + '" text-anchor="end" style="display:none">' + esc(grad.libelles[k]) + "</text>";
    });
    /* zone estimée (reconstituée), hachurée */
    const premObs = M.passe.nature.indexOf("observe"), finRec = premObs > 0 ? M.passe.t[premObs] : premObs === -1 && M.passe.t.length ? M.today : null;
    if (M.passe.t.length && M.passe.nature[0] === "reconstitue" && finRec != null && dom.debut < finRec) {
      const xa = X(Math.max(dom.debut, M.passe.t[0])), xb = X(Math.min(finRec, dom.fin));
      if (xb - xa > 2) {
        s += '<rect x="' + f1(xa) + '" y="' + f1(DT) + '" width="' + f1(Math.max(0, xb - xa)) + '" height="' + f1(B - DT) + '" fill="url(#' + hid + ')"/>';
        const jr = new Date(finRec), lib = "Estimé avant le " + jr.getUTCDate() + " " + MOIS[jr.getUTCMonth()], libC = "Estimé";
        const txt = mesurer(lib, 400) + 8 <= xb - xa ? lib : mesurer(libC, 400) + 8 <= xb - xa ? libC : "";
        if (txt) s += '<text x="' + f1(xa + 4) + '" y="' + f1(DT + 16) + '" class="gp-halo">' + esc(txt) + "</text>";
      }
    }
    /* séries (clipées au tracé) */
    s += '<g class="series"><g clip-path="url(#' + cid + ')">';
    const fi = ech.futur, ptsF = key => fi.map(i => [X(F.t[i]), Y(key(i))]);
    let planTop = "";
    if (planSerie && planSerie.t && planSerie.t.length) {
      const tIn = planSerie.t, ok = tIn.map((t, i) => i).filter(i => planSerie.p50[i] != null && tIn[i] <= dom.fin + span * 0.05 && tIn[i] >= dom.debut - span * 0.05 - 1);
      if (ok.length > 1) {
        const hautB = ok.map(i => [X(tIn[i]), Y(planSerie.p90[i] != null ? planSerie.p90[i] : planSerie.p50[i])]), basB = ok.map(i => [X(tIn[i]), Y(planSerie.p10[i] != null ? planSerie.p10[i] : planSerie.p50[i])]);
        s += '<path class="gp-plan-b" d="' + bande(hautB, basB) + '"/>';
        planTop += '<path class="gp-plan-l" d="' + chemin(ok.map(i => [X(tIn[i]), Y(planSerie.p50[i])])) + '"/>';
      }
      /* écart teinté entre le plan et le réel, de la date du plan à aujourd'hui */
      const passeIn = ech.passe.filter(p => p.t >= planSerie.t[0] && p.t <= M.today);
      if (passeIn.length > 1) {
        const dessus = passeIn.map(p => [X(p.t), Y(p.v)]), dessous = passeIn.map(p => { const pl = planA(planSerie, p.t); return [X(p.t), Y(pl ? pl.p50 : p.v)]; });
        const neg = (M.valeurAuj != null && planA(planSerie, M.today) ? M.valeurAuj - planA(planSerie, M.today).p50 : 0) < 0;
        s += '<path class="' + (neg ? "gp-gap-neg" : "gp-gap-pos") + '" d="' + bande(dessous, dessus) + '"/>';
      }
    }
    s += C.plan ? '<g class="gp-dim">' : "<g>";
    let hopDots = "", hopHors = 0;
    if (aFutur && fi.length > 1) {
      const fut = fi.filter(i => F.t[i] >= M.today || i === 0);
      const futPts = idx => idx.map(i => [X(F.t[i]), 0]);
      void futPts;
      const hasMid = !!(F.p25 && F.p75);
      if (C.avenirs && F.avenirs) {
        s += avenirsSvg(M, F, ech, X, Y, P, id);
        const rendu = avenirsMarge(M, F, dom, Y, DT, B, R, P);
        hopDots = rendu.dots; hopHors = rendu.hors;
      } else {
        const hautK = F.p90 ? "p90" : "p50", basK = F.p10 ? "p10" : "p50";
        s += '<path fill="url(#' + id + (hasMid ? "g1" : "g2") + ')" d="' + bande(ptsF(i => F[hautK][i]), ptsF(i => F[basK][i])) + '"/>';
        if (hasMid) s += '<path fill="url(#' + id + 'g2)" d="' + bande(ptsF(i => F.p75[i]), ptsF(i => F.p25[i])) + '"/>';
      }
      if (C.existant && F.existant && F.existant.p50) {
        /* couche « existant » : calculée aux anniversaires seulement (spec § 9) : on trace ses points connus, jamais des zéros entre eux */
        const kn = pointsConnus(F.t, F.existant.p50, dom), pk = key => kn.map(i => [X(F.t[i]), Y(key(i))]);
        if (kn.length > 1) {
          if (P.plein && F.existant.p25 && F.existant.p75 && kn.every(i => F.existant.p25[i] != null && F.existant.p75[i] != null)) s += '<path class="gp-ex-b" d="' + bande(pk(i => F.existant.p75[i]), pk(i => F.existant.p25[i])) + '"/>';
          s += '<path class="gp-sv" d="' + chemin(pk(i => F.existant.p50[i])) + '"/>';
        }
      }
      if (F.variante && F.variante.p50) {
        if (F.variante.p25 && F.variante.p75) s += '<path class="gp-var-b" d="' + bande(ptsF(i => F.variante.p75[i]), ptsF(i => F.variante.p25[i])) + '"/>';
        s += '<path class="gp-var" d="' + chemin(ptsF(i => F.variante.p50[i])) + '"/>';
      }
      if (F.crise) s += '<path class="gp-crise" d="' + chemin(ptsF(i => F.crise.valeurs[i])) + '"/>';
      if (M.demain && C.demain !== false) {
        const D = M.demain;
        if (D.parTaux && D.parTaux.bas && D.parTaux.haut) {
          s += '<path class="gp-taux" d="' + chemin(fi.map(i => [X(F.t[i]), Y(D.parTaux.bas[i])])) + '"/><path class="gp-taux" d="' + chemin(fi.map(i => [X(F.t[i]), Y(D.parTaux.haut[i])])) + '"/>';
        }
        const serie = D.serie && D.serie.t.length ? D.serie : null;
        const pts = serie ? serie.t.map((t, i) => [X(t), Y(serie.emprunt[i])]).filter((p, i) => serie.t[i] >= dom.debut - span * 0.05 && serie.t[i] <= dom.fin + span * 0.05)
          : fi.map(i => [X(D.t[i]), Y(D.empruntable[i])]);
        const echant = pts.length > 60 ? pts.filter((p, i) => i % Math.ceil(pts.length / 60) === 0 || i === pts.length - 1) : pts;
        if (echant.length > 1) s += '<path class="gp-emprunt" d="' + chemin(echant) + '"/>';
      }
      const md = chemin(ptsF(i => F.p50[i]));
      s += '<path class="gp-med-h" d="' + md + '"/><path class="gp-med" d="' + md + '"/>';
      void fut;
    }
    s += "</g>" + planTop;
    /* passé : reconstitué en pointillés, observé en plein */
    const pp = ech.passe.filter(p => p.t <= M.today), recon = pp.filter(p => p.nature === "reconstitue"), obs = pp.filter(p => p.nature === "observe");
    if (recon.length) { const avecJonction = recon.concat(obs.slice(0, 1)); if (avecJonction.length > 1) s += '<path class="gp-recon" d="' + chemin(avecJonction.map(p => [X(p.t), Y(p.v)])) + '"/>'; }
    if (obs.length > 1) s += '<path class="gp-obs" d="' + chemin(obs.map(p => [X(p.t), Y(p.v)])) + '"/>';
    s += "</g></g>";
    /* aujourd'hui : trait fin, halo, pastille d'encre sur la dernière valeur observée */
    if (dom.debut <= M.today && dom.fin >= M.today && M.valeurAuj != null) {
      const x = X(M.today), y0 = Y(M.valeurAuj);
      s += '<line class="gp-tdy" x1="' + f1(x) + '" x2="' + f1(x) + '" y1="' + f1(DT) + '" y2="' + f1(B) + '" opacity=".35"/><circle class="gp-glow' + (P.reduit ? "" : " pulse") + '" cx="' + f1(x) + '" cy="' + f1(y0) + '" r="10"/><circle class="gp-dot-ink" data-today cx="' + f1(x) + '" cy="' + f1(y0) + '" r="4.5"/>';
    }
    /* annotations des inflexions : l'achat (frais d'acquisition), écrites là où elles se voient */
    const labs = [];
    M.jalons.filter(j => j.type === "achat_immobilier" && j.t > dom.debut && j.t < dom.fin && j.effet && j.effet.montants && +j.effet.montants.frais_acquisition > 0 && aFutur && !C.avenirs && !C.plan).forEach(j => {
      const i = plusProche(F.t, j.t), x = X(j.t), y = Y(F.p50[i]), txt = P.compact ? MOINS + fK(j.effet.montants.frais_acquisition) : "Achat : " + MOINS + fK(j.effet.montants.frais_acquisition) + " de frais";
      labs.push({ x: x + 6 + mesurer(txt, 400) / 2, y: y + 20, t: txt, up: 0 });
    });
    const placed = [];
    labs.sort((a, b) => a.x - b.x).forEach(l => {
      const w = mesurer(l.t, l.b ? 600 : 400) + 6; let y = l.y, g = 0;
      while (g++ < 8 && placed.some(p => Math.abs(p.x - l.x) < (p.w + w) / 2 && Math.abs(p.y - y) < 15)) y += l.up ? -15 : 15;
      if (y < DT + 10 || y > B - 2) return;
      placed.push({ x: l.x, y, w });
      s += '<text x="' + f1(clamp(l.x, L + w / 2, R - w / 2)) + '" y="' + f1(y) + '" text-anchor="middle" class="gp-halo gp-ti after">' + esc(l.t) + "</text>";
    });
    /* étiquettes directes des séries (plein écran) */
    if (P.labelsAll && aFutur && !C.plan && !C.avenirs) s += '<g class="after">' + etiquettesDirectes(M, F, dom, X, Y, R, mesurer, C, aFutur, ech) + "</g>";
    if (C.plan && planSerie) s += '<g class="after">' + etiquettesPlan(M, planSerie, dom, X, Y, L, R, DT, T, mesurer, P) + "</g>";
    /* axe du temps */
    libellesTemps(dom, X, W, mesurer, M.today).forEach(o => { s += '<text x="' + f1(o.x) + '" y="' + (H - 6) + '" text-anchor="middle"' + (o.b ? ' class="gp-tb"' : "") + ">" + esc(o.t) + "</text>"; });
    s += "</g>";
    /* pastille de fin */
    if (pill) s += '<g class="gp-pill' + (pill.futur ? "" : " ink") + '" data-endpill aria-hidden="true"><rect x="' + (R + 3) + '" y="' + f1(pillY - 10) + '" width="' + (W - R - 3) + '" height="20" rx="10"/><text x="' + f1((R + 3 + W) / 2) + '" y="' + f1(pillY + 4) + '" text-anchor="middle">' + esc(fK(pill.v, pill.v < 1e5 && pill.v >= 1e4 ? 1 : 0)) + "</text></g>";
    /* jalons */
    const jalonsVus = M.jalons.filter(j => !etat.cacherObjectifs || !estObjectif(j) || etat.cacherObjectifs(j) === false);
    const geoJ = P.pins ? rail(M, jalonsVus, dom, X, Y, { B, W, R, P, mesurer, F, aFutur, railH, id }) : marqueursCompacts(M, jalonsVus, dom, X, Y, { B, P, F, aFutur });
    s += geoJ.svg;
    if (P.compact && C.avenirs && hopDots) s += '<g aria-hidden="true">' + hopDots + "</g>";
    s += '<g data-hop aria-hidden="true"></g><g data-sel></g>';
    s += '<g class="gp-xh" data-xh aria-hidden="true" style="opacity:0"><g data-xv><line class="gp-xh-v" x1="0" x2="0" y1="' + T + '" y2="' + (B + (P.pins ? railH : 0)) + '"/></g><g data-xhh><line class="gp-xh-h" x1="' + L + '" x2="' + f1(R) + '" y1="0" y2="0"/></g><g data-xd><circle r="11" class="gp-glow"/><circle data-xdot class="gp-dot-brand" r="5"/></g><g data-xp><g class="gp-pill" data-xpill><rect x="' + (R + 3) + '" y="-10" width="' + (W - R - 3) + '" height="20" rx="10"/><text x="' + f1((R + 3 + W) / 2) + '" y="4" text-anchor="middle"></text></g></g></g>';
    const geo = { W, H, L, R, T, B, DT, X, Y, lo, hi, dom, gran, ech, ticks, pill, pillY, marqueurs: geoJ.marqueurs, groupes: geoJ.groupes || [], hopHors, besoin, plotH, P, planTop: !!planTop };
    return { svg: s, geo };
  }

  /* ---------- couches : 100 avenirs, étiquettes ---------- */
  function avenirsSvg(M, F, ech, X, Y, P, id) {
    const pas = P.compact ? 3 : 1, idx = ech.futur.filter((i, k) => k === 0 || k === ech.futur.length - 1 || i % pas === 0);
    let s = "";
    F.avenirs.forEach(a => { s += '<path class="gp-hopp" d="' + chemin(idx.map(i => [X(F.t[i]), Y(a[i])])) + '"/>'; });
    void id; void M;
    return s;
  }
  /** Points de l'horizon visible (un par avenir) rangés en colonnes dans la marge à droite ; ceux qui sortent du cadre sont comptés, l'échelle ne change pas. */
  function avenirsMarge(M, F, dom, Y, DT, B, R, P) {
    const i = Math.max(0, indexAvant(F.t, dom.fin)), bin = P.compact ? 5 : 6, cols = {}, vals = F.avenirs.map(a => a[i]).sort((a, b) => a - b);
    let dots = "", hors = 0;
    vals.forEach(v => {
      const y = Y(v);
      if (y < DT - 2 || y > B + 2) { hors++; return; }
      const b = Math.round((y - DT) / bin), c = (cols[b] = (cols[b] || 0) + 1), cx = P.compact ? R + 5 + (c - 1) * bin : R - 4 - (c - 1) * bin;
      dots += '<circle class="gp-qd" cx="' + F1(cx) + '" cy="' + F1(DT + b * bin) + '" r="2.2"/>';
    });
    return { dots, hors, valeurs: vals };
  }
  function etiquettesDirectes(M, F, dom, X, Y, R, mesurer, C, aFutur, ech) {
    let s = "";
    const i = Math.max(0, indexAvant(F.t, dom.fin)), x = R - 6;
    const yM = Y(F.p50[i]), y75 = F.p75 ? Y(F.p75[i]) : null, y90 = F.p90 ? Y(F.p90[i]) : null, y25 = F.p25 ? Y(F.p25[i]) : null;
    if (y90 != null && y75 != null && y75 - y90 >= 17) s += '<text x="' + x + '" y="' + F1(y90 + 13) + '" text-anchor="end" class="gp-halo gp-tbr">8 chances sur 10</text>';
    if (y75 != null && yM - y75 >= 17) s += '<text x="' + x + '" y="' + F1(y75 + 13) + '" text-anchor="end" class="gp-halo gp-tbr">1 chance sur 2</text>';
    if (y25 != null && y25 - yM >= 17) s += '<text x="' + x + '" y="' + F1(yM + 14) + '" text-anchor="end" class="gp-halo gp-tbr">médiane</text>';
    else s += '<text x="' + x + '" y="' + F1(yM - 7) + '" text-anchor="end" class="gp-halo gp-tbr">médiane</text>';
    if (C.existant && F.existant && F.existant.p50) s += '<text x="' + x + '" y="' + F1(Y(F.existant.p50[i]) + 15) + '" text-anchor="end" class="gp-halo">sans nouveau versement</text>';
    void aFutur; void ech;
    if (M.passe.t.length && dom.debut < M.today - (dom.fin - dom.debut) * 0.05) {
      const dx = X(Math.min(M.today, dom.fin)) - X(Math.max(dom.debut, M.passe.t[Math.max(0, M.passe.nature.indexOf("observe"))] || dom.debut));
      if (dx > 60) { const tm = clamp(M.today - (M.today - Math.max(dom.debut, M.passe.t[Math.max(0, M.passe.nature.indexOf("observe"))] || dom.debut)) / 2, dom.debut, dom.fin); const k = plusProche(M.passe.t, tm); s += '<text x="' + F1(X(tm)) + '" y="' + F1(Y(M.passe.v[k]) + 20) + '" text-anchor="middle" class="gp-halo gp-ti">Observé</text>'; }
    }
    return s;
  }
  function etiquettesPlan(M, planSerie, dom, X, Y, L, R, DT, T, mesurer, P) {
    let s = "";
    const lt = P.compact ? "Plan" : "Plan du " + dJour(planSerie.cree), ml = clamp(planSerie.t[0] + (Math.min(dom.fin, planSerie.t[planSerie.t.length - 1]) - Math.max(planSerie.t[0], dom.debut)) * 0.72, dom.debut, dom.fin);
    const pl = planA(planSerie, ml);
    if (pl) { const lx = X(ml), ly = Y(pl.p90 != null ? pl.p90 : pl.p50) - 6; s += '<text x="' + F1(clamp(lx, L + mesurer(lt, 600) / 2, R - mesurer(lt, 600) / 2 - 4)) + '" y="' + F1(Math.max(T + 12, ly)) + '" text-anchor="middle" class="gp-halo gp-ti" style="font-weight:600">' + esc(lt) + "</text>"; }
    const aj = planA(planSerie, M.today);
    if (aj && M.valeurAuj != null && dom.debut <= M.today && dom.fin >= M.today) {
      const ecart = M.valeurAuj - aj.p50, neg = ecart < 0, yp = Y(aj.p50), ya = Y(M.valeurAuj);
      const t = (neg ? MOINS : "+") + fK(Math.abs(ecart), 1) + (P.compact ? "" : neg ? " sous le plan" : " au-dessus du plan");
      const ty = Math.abs(yp - ya) >= 16 ? (yp + ya) / 2 + 4 : Math.min(yp, ya) - 8;
      s += '<text x="' + F1(X(M.today) - 6) + '" y="' + F1(ty) + '" text-anchor="end" class="gp-halo ' + (neg ? "gp-tneg" : "gp-tpos") + '">' + esc(t) + "</text>";
    }
    return s;
  }

  /* ---------- jalons : marqueurs compacts (carte) et pastilles numérotées (plein écran) ---------- */
  /** Carte : points de 8 px sur la ligne de base (fusionnés en « N » quand ils se touchent) et petites cibles sur la médiane pour les objectifs. */
  function marqueursCompacts(M, jalons, dom, X, Y, ctx) {
    const { B, P, F, aFutur } = ctx;
    const evs = jalons.filter(j => !estObjectif(j) && j.t >= dom.debut && j.t <= dom.fin), buts = jalons.filter(j => estObjectif(j) && j.t >= dom.debut && j.t <= dom.fin && j.t >= M.today);
    const groupes = regrouperJalons(evs, X, P.clusterPx || 12);
    let s = '<g aria-hidden="true"><line class="gp-base" x1="0" x2="' + F1(X(dom.fin)) + '" y1="' + B + '" y2="' + B + '"/>';
    const marqueurs = [];
    groupes.forEach(g => {
      const ids = g.jalons.map(j => j.id).join(" ");
      s += g.jalons.length === 1 ? '<circle class="gp-mkc" data-ev="' + esc(ids) + '" cx="' + F1(g.x) + '" cy="' + B + '" r="4"/>'
        : '<g class="gp-mkc gp-mkn" data-ev="' + esc(ids) + '"><circle cx="' + F1(g.x) + '" cy="' + B + '" r="7.5"/><text x="' + F1(g.x) + '" y="' + (B + 4) + '" text-anchor="middle">' + g.jalons.length + "</text></g>";
      marqueurs.push({ x: g.x, y: B, jalons: g.jalons, type: "groupe", r: g.jalons.length > 1 ? 7.5 : 4 });
    });
    buts.forEach(j => {
      const i = aFutur ? plusProche(F.t, j.t) : -1, v = i >= 0 ? F.p50[i] : M.valeurAuj, x = X(j.t), y = v != null ? Y(v) : B - 20;
      s += '<g class="gp-tg" data-ev="' + esc(j.id) + '"><circle cx="' + F1(x) + '" cy="' + F1(y) + '" r="5"/><circle cx="' + F1(x) + '" cy="' + F1(y) + '" r="1.8"/></g>';
      marqueurs.push({ x, y, jalons: [j], type: "objectif", r: 5 });
    });
    s += '<g data-flab></g></g>';
    return { svg: s, marqueurs, groupes: groupes.map(g => ({ x: g.x, jalons: g.jalons })).concat(buts.map(j => ({ x: X(j.t), jalons: [j] }))) };
  }
  /** Plein écran : pastilles numérotées sous la courbe (numéro = rang dans la liste chronologique), reliées à leur date par un trait ; durées en traits fins ; anneau de couleur
      (et mot dans la liste) pour les objectifs. Placement sans chevauchement sur 1 à 2 rangées. */
  function rail(M, jalons, dom, X, Y, ctx) {
    const { B, W, P, mesurer, railH } = ctx, rows = P.railRows || 1, lab = !!P.pinLabels;
    const numero = new Map(M.jalons.map((j, i) => [j.id, i + 1]));
    const its = jalons.filter(j => j.t >= dom.debut && j.t <= dom.fin).map(j => { const t = P.fullLabels ? j.titre : (j.titre.length > 22 ? j.titre.slice(0, 21) + "…" : j.titre); return { j, t, x: X(j.t), w: lab ? 28 + mesurer(t, 600) + 2 : estObjectif(j) ? 24 : 20 }; });
    const end = Array(rows).fill(-Infinity);
    its.forEach(it => {
      const want = it.x - 10; let best = null;
      for (let r = 0; r < rows; r++) { const l = Math.max(want, end[r] + 4), c = l - want; if (!best || c < best.c - 0.5) best = { r, l, c }; }
      it.r = best.r; it.l = best.l; it.want = want; end[best.r] = best.l + it.w;
    });
    for (let r = 0; r < rows; r++) {
      const ri = its.filter(i => i.r === r);
      let i = 0;
      while (i < ri.length) {
        let j = i;
        while (j + 1 < ri.length && ri[j + 1].l > ri[j + 1].want + 0.5 && ri[j + 1].l <= ri[j].l + ri[j].w + 4.5) j++;
        if (j > i) { const grp = ri.slice(i, j + 1), mean = grp.reduce((a, b) => a + (b.l - b.want), 0) / grp.length, prevEnd = i > 0 ? ri[i - 1].l + ri[i - 1].w + 4 : 0, sh = Math.min(mean, grp[0].l - prevEnd); grp.forEach(x => { x.l -= Math.max(0, sh); }); }
        i = j + 1;
      }
      let lim = W;
      for (let k = ri.length - 1; k >= 0; k--) { if (ri[k].l + ri[k].w > lim) ri[k].l = lim - ri[k].w; lim = ri[k].l - 4; }
      let mn = 0;
      ri.forEach(x => { if (x.l < mn) x.l = mn; mn = x.l + x.w + 4; });
    }
    let s = '<g aria-hidden="true"><line class="gp-base" x1="0" x2="' + F1(X(dom.fin)) + '" y1="' + B + '" y2="' + B + '"/>';
    /* durées en traits fins sous la courbe */
    jalons.filter(j => j.tFin && j.tFin > dom.debut && j.t < dom.fin).forEach((j, k) => {
      const x1 = X(Math.max(j.t, dom.debut)), x2 = X(Math.min(j.tFin, dom.fin)), y = B + 5 + (k % 2) * 6;
      s += '<g class="gp-dur" data-ev="' + esc(j.id) + '"><line x1="' + F1(x1 + (j.t >= dom.debut ? 2 : 0)) + '" x2="' + F1(x2 - (j.tFin <= dom.fin ? 2 : 0)) + '" y1="' + y + '" y2="' + y + '"/>' + (j.t >= dom.debut ? '<line x1="' + F1(x1) + '" x2="' + F1(x1) + '" y1="' + (y - 3) + '" y2="' + (y + 3) + '"/>' : "") + (j.tFin <= dom.fin ? '<line x1="' + F1(x2) + '" x2="' + F1(x2) + '" y1="' + (y - 3) + '" y2="' + (y + 3) + '"/>' : "") + "</g>";
    });
    const off = 12;
    its.forEach(it => { const cy = B + 17 + off + it.r * 24, cx = it.l + 10; s += '<path class="gp-lead" d="M' + it.x.toFixed(1) + " " + (B - 3) + "V" + (B + 2 + off) + "L" + cx.toFixed(1) + " " + (cy - (estObjectif(it.j) ? 12 : 9)) + '"/>'; });
    s += "</g>";
    const marqueurs = [];
    its.forEach(it => {
      const cy = B + 17 + off + it.r * 24, cx = it.l + 10, j = it.j, o = estObjectif(j) ? M.objectifs.find(z => z.id === j.objectifId) : null;
      const mot = o ? motProba(o.probabilite) : null, st = o && STATUT_OBJ[o.statut], ton = o ? (mot ? TON_MOT[mot] : st ? st[1] : "todo") : null;
      s += '<g class="gp-pin" data-ev="' + esc(j.id) + '">';
      if (lab) s += '<rect class="gp-chipbg" x="' + F1(it.l) + '" y="' + (cy - 11) + '" width="' + F1(it.w) + '" height="22" rx="11"/>';
      if (o) s += '<circle class="gp-ring ' + ton + '" cx="' + F1(cx) + '" cy="' + cy + '" r="12"/>';
      s += '<circle class="gp-bd" cx="' + F1(cx) + '" cy="' + cy + '" r="9"/><text class="n" x="' + F1(cx) + '" y="' + (cy + 4) + '" text-anchor="middle">' + numero.get(j.id) + "</text>";
      if (lab) s += '<text class="lb" x="' + F1(cx + 14) + '" y="' + (cy + 4) + '">' + esc(it.t) + "</text>";
      s += "</g>";
      marqueurs.push({ x: cx, y: cy, jalons: [j], type: o ? "objectif" : "pastille", r: 13, numero: numero.get(j.id) });
    });
    /* cibles des objectifs sur la médiane */
    jalons.filter(j => estObjectif(j) && j.t >= M.today && j.t >= dom.debut && j.t <= dom.fin && ctx.aFutur).forEach(j => {
      const i = plusProche(ctx.F.t, j.t), x = X(j.t), y = Y(ctx.F.p50[i]);
      s = s.replace(/<g data-hop/, "<g data-hop");
      s += '<g class="gp-tg" aria-hidden="true"><circle cx="' + F1(x) + '" cy="' + F1(y) + '" r="5"/><circle cx="' + F1(x) + '" cy="' + F1(y) + '" r="1.8"/></g>';
    });
    void railH;
    return { svg: s, marqueurs, groupes: its.map(it => ({ x: it.x, jalons: [it.j] })) };
  }

  /* ---------- bande « capacité d'épargne » ---------- */
  /** Escalier de la capacité mensuelle sur le même axe du temps, à partir d'aujourd'hui (le passé n'a pas de capacité prévue) ; le zéro est marqué, une capacité négative est
      en couleur d'alerte ET portée par le mot « négative ». ouverte : montants des marches affichés. → { svg, H, Ys, marches } ; vide sans capacité. */
  function construireBande(M, etat, geo, P, ouverte) {
    const C = M.capacite;
    if (!C || !C.periodes.length) return { svg: "", H: 0, vide: true };
    const { dom, X, W } = geo, compactRepli = P.compact && !ouverte;
    const H = compactRepli ? 28 : P.stripH + (ouverte || !P.compact ? 14 : 0), top = ouverte || !P.compact ? 16 : compactRepli ? 14 : 3, bot = H - 2;
    const periodes = C.periodes.filter(p => p.t0 >= M.today || p.t1 == null || p.t1 > M.today);
    const montants = periodes.map(p => p.montant);
    let mn = Math.min(0, ...montants), mx = Math.max(0, ...montants);
    if (mx - mn < 1) mx = mn + 1;
    const pad = (mx - mn) * 0.12;
    const Ys = v => bot - ((v - (mn - pad * 0)) / (mx + pad - mn)) * (bot - top);
    let d = "", prev = null, x0 = null;
    const xa = X(clamp(Math.max(M.today, dom.debut), dom.debut, dom.fin));
    periodes.forEach((p, k) => {
      const debut = k === 0 ? Math.max(M.today, dom.debut) : p.t0, x = X(clamp(debut, dom.debut, dom.fin));
      if (p.t0 > dom.fin) return;
      if (prev === null) { d += "M" + F1(x) + " " + F1(Ys(p.montant)); x0 = x; }
      else if (p.montant !== prev) d += "L" + F1(x) + " " + F1(Ys(prev)) + "L" + F1(x) + " " + F1(Ys(p.montant));
      prev = p.montant;
    });
    if (prev === null) return { svg: "", H: 0, vide: true };
    const xf = X(dom.fin);
    d += "L" + F1(xf) + " " + F1(Ys(prev));
    let s = '<path class="gp-st-a" d="' + d + "L" + F1(xf) + " " + F1(Ys(0)) + "L" + F1(x0) + " " + F1(Ys(0)) + 'Z"/>';
    s += '<line class="gp-st-z" x1="' + F1(xa) + '" x2="' + F1(xf) + '" y1="' + F1(Ys(0)) + '" y2="' + F1(Ys(0)) + '"/><path class="gp-st-l" d="' + d + '"/>';
    if (dom.debut <= M.today && dom.fin >= M.today) s += '<line class="gp-tdy" x1="' + F1(X(M.today)) + '" x2="' + F1(X(M.today)) + '" y1="' + (top - 2) + '" y2="' + bot + '"/>';
    const marches = [];
    periodes.forEach((p, k) => { if (!k) return; const dv = p.montant - periodes[k - 1].montant; if (Math.abs(dv) >= 1 && p.t0 >= dom.debut && p.t0 <= dom.fin) marches.push({ t: p.t0, dv, raison: p.raison, evenementId: p.evenementId, x: X(p.t0) }); });
    if (ouverte || !P.compact) {
      const posees = [], mes = P.mesurer || mesureApprox;
      marches.forEach(m => { const txt = (m.dv > 0 ? "+" : MOINS) + fInt(m.dv), w = mes(txt, 400); if (posees.some(p => Math.abs(p - m.x) < w + 6)) return; posees.push(m.x); s += '<text x="' + F1(m.x) + '" y="11" text-anchor="middle" class="gp-ti">' + esc(txt) + "</text>"; });
    }
    if (montants.some(v => v < 0)) { const neg = periodes.find(p => p.montant < 0); if (neg && (ouverte || !P.compact)) s += '<text x="' + F1(clamp(X(Math.max(neg.t0, dom.debut)) + 4, 4, geo.R - 70)) + '" y="' + (bot - 2) + '" class="gp-tneg">négative</text>'; }
    if (compactRepli) s += '<text x="4" y="11" class="gp-halo">Épargne par mois</text>';
    s += "<g data-sxh></g>";
    return { svg: s, H, Ys, marches, periodes };
  }

  /* ================================================================ 2. CONTRÔLEUR DOM ================================================================ */
  const PRESETS = {
    /* Aujourd'hui : patrimoine net du périmètre de l'en-tête, tous les objectifs, 5 ans sur mobile / 10 ans sur ordinateur */
    aujourdhui: { titre: "Ton patrimoine", vue: "net", fenetre: { mobile: "5", bureau: "10" }, objectifs: "tous", liensFeuille: [{ href: "#patrimoine/comptes", libelle: "Voir le détail par compte" }] },
    /* Patrimoine › Placements : vue financier, aucun objectif */
    placements: { titre: "Tes placements", vue: "financier", fenetre: { mobile: "5", bureau: "10" }, objectifs: "aucun" },
    /* Patrimoine › Objectifs : vue financier, les objectifs au premier plan, jusqu'à l'échéance (au moins 5 ans) */
    objectifs: { titre: "Tes objectifs", vue: "financier", fenetre: { mobile: "5", bureau: "10" }, objectifs: "tous", echeance: true },
    /* Immobilier et crédits (IMMO1) : budget d'achat dans le temps, 10 ans de futur, pas de passé */
    capacite: { titre: "Ta capacité demain", vue: "financier", mode: "capacite", futurSeul: true, fenetre: { mobile: "10", bureau: "10" }, objectifs: "aucun" },
  };
  const CLES_LS = { invitationVue: "boussole.graphe.invitation.vue", invitationOff: "boussole.graphe.invitation.off" };
  let compteurId = 0;

  /** Mode d'affichage du plein écran selon la fenêtre : ordinateur (au moins 1024 × 560), paysage (bas et large), sinon la carte en portrait agrandie. */
  function modePleinEcran(w, h) {
    if (w >= 1024 && h >= 560) return "bureau";
    if (h < 520 && w > h && w >= 600) return "paysage";
    return "portrait";
  }
  /** Fenêtre par défaut d'un préréglage (mobile / ordinateur), ou celle d'un objectif : jusqu'à son échéance, au moins 5 ans. */
  function fenetreDefaut(preset, large, M, objectifId) {
    if (preset.echeance && objectifId && M) {
      const o = M.objectifs.find(x => x.id === String(objectifId));
      if (o) { const ans = (o.t - M.today) / (365.25 * MS_JOUR); const f = FENETRES.find(x => x.ans != null && x.ans >= Math.max(5, ans)); return f ? f.id : "tout"; }
    }
    const f = preset.fenetre; return typeof f === "string" ? f : large ? f.bureau : f.mobile;
  }
  /** Invitation « ouvrir en grand » : à la première visite, ou quand la vue est dense (au moins 4 jalons visibles, ou fenêtre de 10 ans et plus) ; plus jamais si elle a été fermée. */
  function invitationVisible(nbJalonsVus, fenetre, vue, off) {
    if (off) return false;
    const dense = nbJalonsVus >= 4 || ["10", "20", "tout"].includes(String(fenetre));
    return dense || !vue;
  }

  /** Monte le graphe maître dans `el`. opt = { donnees, reglages, preset: "aujourdhui" | "placements" | "objectifs" | "capacite" | objet, deps: { document, window, UI, localStorage, mesurer }, titre,
      surReglages(reglages) (relance le calcul : vue, euros, impôts, variante, crise…), chargerPlan(id) → Promise, impactJalon(jalon) → Promise<{ montant, mois }>, reessayer(), objectifId,
      claude(question, libelle) → HTML d'un lien « Demander à Claude », lienProfond: boolean }. → { mettreAJour(donnees, info), pleinEcran(), fermerPleinEcran(), etat, detruire(), … }. */
  function monter(el, opt) {
    const o = opt || {}, deps = o.deps || {}, doc = deps.document || (typeof document !== "undefined" ? document : null);
    if (!el || !doc) return null;
    return new Graphe(el, o, deps, doc).api();
  }

  class Graphe {
    constructor(el, o, deps, doc) {
      this.el = el; this.o = o; this.deps = deps; this.doc = doc; this.win = deps.window || (typeof window !== "undefined" ? window : null);
      this.id = "gp" + (++compteurId);
      this.preset = typeof o.preset === "object" && o.preset ? Object.assign({}, PRESETS.aujourdhui, o.preset) : Object.assign({}, PRESETS[o.preset] || PRESETS.aujourdhui);
      if (o.titre) this.preset.titre = o.titre;
      this.vues = new Set(); this.plein = null; this.M = null; this.donnees = null; this.detruit = false;
      const large = this.large();
      const r = Object.assign({ vue: this.preset.vue, euros: "constants", net_impots: false, variante: null, crise: { on: false, cle: null, debut: null }, existant: null, avenirs: false, plan: null, periode: null, duree: 25, neuf: false, primo: false }, o.reglages || {});
      this.etat = { fenetre: o.fenetre || null, zoom: null, curseur: null, reglages: r, bandeOuverte: false, hopI: 0, hopJoue: false, echelleY: null, cleY: "", anim: null, plan: null, selection: null, chargement: !o.donnees };
      if (!this.etat.fenetre) this.etat.fenetre = fenetreDefaut(this.preset, large, null, o.objectifId);
      this.build();
      if (o.donnees) this.mettreAJour(o.donnees, { initial: true }); else this.rendreTout();
    }
    large() { try { return !!(this.win && this.win.matchMedia && this.win.matchMedia("(min-width: 900px)").matches); } catch (e) { return false; } }
    reduit() { try { return !!(this.win && this.win.matchMedia && this.win.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
    lsGet(k) { try { return (this.deps.localStorage || (typeof localStorage !== "undefined" ? localStorage : null)).getItem(k); } catch (e) { return (this.mem || {})[k] || null; } }
    lsSet(k, v) { try { (this.deps.localStorage || localStorage).setItem(k, v); } catch (e) { (this.mem = this.mem || {})[k] = v; } }
    lsDel(k) { try { (this.deps.localStorage || localStorage).removeItem(k); } catch (e) { /* rien */ } if (this.mem) delete this.mem[k]; }
    mesurer() {
      if (this.deps.mesurer) return this.deps.mesurer;
      if (this._mes) return this._mes;
      let ctx = null;
      try { ctx = this.doc.createElement("canvas").getContext("2d"); } catch (e) { ctx = null; }
      this._mes = ctx && typeof ctx.measureText === "function" ? (t, p) => { ctx.font = (p || 400) + ' 12px "Public Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'; return ctx.measureText(String(t)).width * 1.06; } : mesureApprox;
      return this._mes;
    }
    claudeLien(question, libelle) {
      if (this.o.claude) return this.o.claude(question, libelle);
      const U = this.deps.UI || (this.win && this.win.UI);
      return U && U.demanderAClaude ? U.demanderAClaude(question, libelle) : "";
    }
    UI() { return this.deps.UI || (this.win && this.win.UI) || null; }
    api() {
      const g = this;
      return { mettreAJour: (d, info) => g.mettreAJour(d, info), pleinEcran: () => g.ouvrirPlein(), pleinEcranQuandPret: () => { g.pleinDemande = true; if (g.M && g.M.etat === "pret") { g.pleinDemande = false; g.lienFait = true; g.ouvrirPlein(); } }, fermerPleinEcran: () => g.fermerPlein(), detruire: () => g.detruire(), etat: g.etat, graphe: g,
        reglages: () => g.etat.reglages, fenetre: id => { g.choisirFenetre(id); }, curseur: ms => { g.etat.curseur = ms; g.majCurseur(); }, reglagesAppliques: r => g.appliquerReglages(r) };
    }
    /* ---------- données ---------- */
    mettreAJour(donnees, info) {
      if (this.detruit) return;
      const i = info || {}, e = this.etat;
      this.donnees = donnees || null;
      const planAvant = e.plan ? e.plan.id : null;
      if (donnees && donnees.plan !== undefined) e.plan = planNormalise(donnees.plan); else if (donnees && !e.reglages.plan) e.plan = null;
      const M = donnees ? normaliser(donnees) : null, avant = this.M;
      this.M = M;
      if (M) M.jalons = this.jalonsVisibles();
      e.chargement = !M || M.etat === "calcul";
      if (M && !avant && !e.fenetreChoisie) e.fenetre = this.o.fenetre || fenetreDefaut(this.preset, this.large(), M, this.o.objectifId);
      /* échelle mémorisée : seulement tant que la fenêtre et les couches sont les mêmes (aperçu → complet sans saut) */
      if (!M || !avant || avant.vue !== M.vue || avant.euros !== M.euros) e.echelleY = null;
      if (M && e.plan && e.plan.id !== planAvant) { e.fenetre = fenetreContenant(M.today, e.plan.cree); e.zoom = null; e.fenetreChoisie = true; e.echelleY = null; }
      this.rendreTout(i);
      this.surveillerRotation();
      if (M && M.etat === "pret" && !this.lienFait && (this.pleinDemande || (this.o.lienProfond && this.lienProfondDemande()))) { this.lienFait = true; this.pleinDemande = false; this.ouvrirPlein(); }
    }
    lienProfondDemande() {
      try { const h = (this.win && this.win.location && this.win.location.hash) || ""; return /[?&]graphe=plein-ecran(&|$)/.test(h); } catch (e) { return false; }
    }
    retirerLienProfond() {
      try {
        const w = this.win, h = w.location.hash || "";
        if (/[?&]graphe=plein-ecran/.test(h) && w.history && w.history.replaceState) {
          const propre = h.replace(/([?&])graphe=plein-ecran(&|$)/, (m, a, b) => (b ? a : "")).replace(/[?&]$/, "");
          w.history.replaceState(w.history.state, "", (w.location.pathname || "") + (w.location.search || "") + propre);
        }
      } catch (e) { /* rien */ }
    }
    detruire() {
      this.detruit = true; this.fermerPlein({ focus: false });
      this.vues.forEach(v => v.detruire()); this.vues.clear();
      if (this.hopT) clearInterval(this.hopT);
      if (this.offerEl && this.offerEl.remove) this.offerEl.remove();
      if (this.mq && this.mqF) { try { this.mq.removeEventListener("change", this.mqF); } catch (e) { /* rien */ } }
      this.el.innerHTML = "";
    }
    /* ---------- fenêtres, domaine, zoom ---------- */
    contexteTemps() {
      const M = this.M, r = this.etat.reglages, p = r.periode;
      return { today: M ? M.today : msDe(new Date().toISOString().slice(0, 10)), debutPasse: M ? M.debutPasse : null, finFutur: M && M.futur ? M.finFutur : null, futurSeul: !!this.preset.futurSeul,
        periode: p && isoOk(p.du) && isoOk(p.au) ? { du: msDe(p.du), au: msDe(p.au) } : null };
    }
    domaineBase() { return domaine(this.etat.fenetre, this.contexteTemps()); }
    bornes() { return domaine("tout", Object.assign(this.contexteTemps(), { periode: null })); }
    domaineCourant() {
      const a = this.etat.anim;
      if (a) return { debut: a.de.debut + (a.vers.debut - a.de.debut) * a.p, fin: a.de.fin + (a.vers.fin - a.de.fin) * a.p };
      return this.etat.zoom || this.domaineBase();
    }
    /** Anime (200 ms) le changement de domaine ; sous mouvement réduit, aucune animation. */
    morpher(appliquer) {
      const de = this.domaineCourant();
      appliquer();
      const vers = this.etat.zoom || this.domaineBase();
      const petit = Math.abs(de.debut - vers.debut) < MS_JOUR && Math.abs(de.fin - vers.fin) < MS_JOUR;
      const raf = this.win && this.win.requestAnimationFrame;
      if (this.reduit() || petit || typeof raf !== "function" || !this.M) { this.etat.anim = null; this.etat.echelleY = null; this.rendreTout(); return; }
      const t0 = (this.win.performance || Date).now();
      this.etat.anim = { de, vers, p: 0 };
      const pas = now => {
        if (this.detruit || !this.etat.anim) return;
        const k = Math.min(1, (now - t0) / 200), e = 1 - Math.pow(1 - k, 3);
        this.etat.anim.p = e;
        if (k < 1) { this.vues.forEach(v => v.render({ cadre: true })); raf.call(this.win, pas); } else { this.etat.anim = null; this.etat.echelleY = null; this.rendreTout(); }
      };
      raf.call(this.win, pas);
    }
    choisirFenetre(id) {
      const f = FENETRES.find(x => x.id === String(id)); if (!f) return;
      this.morpher(() => {
        this.etat.fenetre = f.id; this.etat.fenetreChoisie = true; this.etat.zoom = null; this.etat.echelleY = null;
        const d = this.domaineBase(), c = this.etat.curseur; if (c != null && (c < d.debut || c > d.fin)) this.etat.curseur = null;
      });
    }
    reglerZoom(a, b) {
      const bo = this.bornes(), minSpan = 60 * MS_JOUR, maxSpan = bo.fin - bo.debut;
      let span = clamp(b - a, minSpan, maxSpan);
      if (span >= maxSpan - MS_JOUR) { a = bo.debut; b = bo.fin; } else { if (a < bo.debut) a = bo.debut; b = a + span; if (b > bo.fin) { b = bo.fin; a = b - span; } }
      const base = this.domaineBase(), tol = (base.fin - base.debut) * 0.005;
      this.etat.zoom = Math.abs(a - base.debut) < tol && Math.abs(b - base.fin) < tol ? null : { debut: a, fin: b };
      this.etat.echelleY = null;
      this.rendreTout();
    }
    zoomAutour(t, facteur) { const d = this.domaineCourant(); this.reglerZoom(t - (t - d.debut) * facteur, t + (d.fin - t) * facteur); }
    deplacer(dt) { const d = this.domaineCourant(); this.reglerZoom(d.debut + dt, d.fin + dt); }
    reinitialiserZoom() { this.morpher(() => { this.etat.zoom = null; }); }
    /* ---------- couches et réglages ---------- */
    couches() {
      const r = this.etat.reglages, plein = this.vues && [...this.vues].some(v => v.plein);
      const existant = r.existant == null ? !!plein : !!r.existant;
      return { existant, avenirs: !!r.avenirs, plan: this.etat.plan || null, demain: true };
    }
    /** Réglages qui changent le calcul : on relance le calcul (surReglages), le reste est local. */
    appliquerReglages(nouveau) {
      const avant = this.etat.reglages, r = Object.assign({}, avant, nouveau);
      const cle = x => JSON.stringify([x.vue, x.euros, x.net_impots, x.variante, x.crise && x.crise.on ? [x.crise.cle, x.crise.debut] : null, !!x.avenirs, x.plan || null, x.duree, !!x.neuf, !!x.primo]);
      const calcul = cle(avant) !== cle(r);
      /* Prévu vs réel : le plan est en euros courants, sur la vue d'origine */
      if (nouveau.plan && nouveau.plan !== avant.plan) { r.euros = "courants"; r.vue = "net"; r.variante = null; r.crise = { on: false, cle: null, debut: null }; r.avenirs = false; r.existant = false; }
      if (nouveau.plan === null && avant.plan && this.etat.eurosAvantPlan) { r.euros = this.etat.eurosAvantPlan; r.vue = this.etat.vueAvantPlan || r.vue; }
      if (nouveau.plan && !avant.plan) { this.etat.eurosAvantPlan = avant.euros; this.etat.vueAvantPlan = avant.vue; }
      this.etat.reglages = r;
      if (nouveau.plan === null) this.etat.plan = null;
      this.etat.echelleY = null;
      if (nouveau.periode !== undefined) this.etat.zoom = null;
      if (calcul && typeof this.o.surReglages === "function") {
        this.etat.chargement = true; this.etat.echelleY = null;
        Promise.resolve(this.o.surReglages(r)).then(d => { if (d && !this.detruit) this.mettreAJour(d); }).catch(() => {});
        this.rendreTout();
      } else this.rendreTout();
    }
    /* ---------- rendu ---------- */
    rendreTout(info) { this.vues.forEach(v => v.render(info || {})); }
    build() {
      this.el.innerHTML = "";
      this.vue = new Vue(this, this.el, { mode: "carte" });
    }
    /** Jalons affichés : les objectifs selon le préréglage (tous, aucun ou un seul). */
    jalonsVisibles() {
      const M = this.M; if (!M) return [];
      const p = this.preset.objectifs, id = this.o.objectifId;
      return M.jalons.filter(j => {
        if (!estObjectif(j)) return true;
        if (p === "aucun") return false;
        return !id || j.objectifId === String(id);
      });
    }
  }

  /* ---------- une vue du graphe (la carte, ou une mise en page du plein écran) ---------- */
  class Vue {
    constructor(g, host, o) {
      this.g = g; this.host = host; this.mode = o.mode; this.plein = !!o.plein; this.onClose = o.onClose || null;
      this.id = g.id + (this.plein ? "p" : "c") + (++compteurId);
      this.fn = []; this.ptr = new Map();
      g.vues.add(this);
      this.build();
    }
    detruire() {
      this.g.vues.delete(this);
      this.fn.forEach(f => f());
      this.fn = [];
      if (this.ro) { try { this.ro.disconnect(); } catch (e) { /* rien */ } }
      if (this.raf && this.g.win && this.g.win.cancelAnimationFrame) this.g.win.cancelAnimationFrame(this.raf);
    }
    ecoute(cible, type, f, opt) { if (!cible || !cible.addEventListener) return; cible.addEventListener(type, f, opt); this.fn.push(() => { try { cible.removeEventListener(type, f, opt); } catch (e) { /* rien */ } }); }
    get M() { return this.g.M; }
    get etat() { return this.g.etat; }
    q(sel) { return this.host.querySelector(sel); }
    /* ---------- construction du DOM ---------- */
    seg() {
      return '<div class="seg gp-seg" role="group" aria-label="Fenêtre : années avant et après aujourd\'hui">' + FENETRES.map(f => '<button type="button" data-win="' + f.id + '" aria-pressed="false" aria-label="' + esc(f.aria) + '">' + esc(f.label) + "</button>").join("") + "</div>";
    }
    hl() { return '<div class="gp-hl" aria-hidden="true"><div class="gp-hl-k" data-hl="k"></div><div class="gp-hl-v num" data-hl="v"></div><div class="gp-hl-s num" data-hl="s"></div></div>'; }
    cadre(avecHl) {
      return '<div class="gp-planbar" data-planbar hidden></div><div class="gp-cadre" data-cadre><svg class="gp-svg" data-svg role="img" aria-label=""></svg>' + (avecHl ? this.hl() : "") +
        '<div class="gp-marks" data-marks></div><div class="gp-hit" data-hit role="slider" tabindex="0" aria-label="Lire le graphique à une date. Flèches pour se déplacer, plus et moins pour zoomer, zéro pour réinitialiser"></div>' +
        (avecHl ? '<button type="button" class="gp-zre" data-act="zreset" hidden>Réinitialiser le zoom</button>' : "") + '<div class="gp-etat" data-etat hidden></div></div>';
    }
    bande() {
      return '<button type="button" class="gp-bande" data-act="bande" aria-expanded="false"><span class="gp-bande-h" data-bandeh hidden><span>Capacité d\'épargne</span><span class="num" data-stripv></span></span><svg class="gp-s-svg" data-ssvg aria-hidden="true"></svg><span class="ui-sr">Capacité d\'épargne : afficher ou masquer le détail</span></button>';
    }
    apercu() {
      return '<div class="gp-apercu"><div class="gp-apercu-h"><span>Aperçu complet · fais glisser le cadre</span><span class="num" data-brushv></span></div><svg class="gp-b-svg" data-bsvg role="slider" tabindex="0" aria-label="Période affichée sur l\'aperçu complet. Flèches pour déplacer, plus et moins pour zoomer"></svg></div>';
    }
    build() {
      const id = this.id, t = this.g.preset.titre, m = this.mode;
      let h;
      if (m === "carte") {
        h = '<section class="gp gp-carte" data-mode="carte" aria-labelledby="' + id + 't"><div class="gp-tete"><h2 id="' + id + 't">' + esc(t) + '</h2>' +
          '<button type="button" class="gp-eur sm" data-act="eur"><span data-eur></span></button>' +
          '<button type="button" class="gp-icon" data-act="reglages" aria-label="Réglages du graphique">' + ICO.reglages + "</button>" +
          '<button type="button" class="gp-icon" data-act="plein" aria-label="Ouvrir en grand" title="Ouvrir en grand">' + ICO.plein + "</button></div>" +
          this.cadre(true) + this.bande() +
          '<button type="button" class="gp-ligne" data-act="lecture" aria-label="Lecture détaillée"><span class="gp-ligne-t num" data-roline aria-live="polite" aria-atomic="true"></span><span class="gp-chev" aria-hidden="true">›</span></button>' +
          '<div class="gp-ctl">' + this.seg() + '<button type="button" class="gp-jal" data-act="jalons"><span data-njal></span></button></div>' +
          '<div class="gp-invite" data-invite hidden></div><div class="gp-notes" data-notes></div><div data-why></div>' +
          '<div class="gp-pied"><span class="gp-pied-t">Projection, pas une promesse.</span><button type="button" class="gp-lien" data-act="calcul">Comment c\'est calculé</button></div><p class="ui-sr" data-sr></p></section>';
      } else {
        const L = m === "paysage", B = m === "bureau";
        h = '<div class="gp-fsv gp-fsv-' + m + '"><div class="gp-fs-bar"><button type="button" class="gp-icon" data-act="plein" aria-label="Quitter le plein écran">' + ICO.x + "</button>" +
          '<div class="gp-ttl">' + esc(L ? t : t + ", passé et futur") + "</div>" + this.seg() + '<button type="button" class="gp-btn-q ink" data-act="zreset" hidden>Réinitialiser le zoom</button>' +
          (L || m === "portrait" ? "" : '<button type="button" class="gp-eur" data-act="eur"><span data-eur></span></button>') +
          '<button type="button" class="gp-icon" data-act="reglages" aria-label="Réglages du graphique">' + ICO.reglages + "</button></div>" +
          '<div class="gp-fs-body"><div class="gp-fs-main">' + (m === "portrait" ? '<div class="gp-fs-eur"><button type="button" class="gp-eur" data-act="eur"><span data-eur></span></button></div>' : "") + (L ? "" : this.hl()) + this.cadre(false) + '<div class="gp-hopbar" data-hopbar hidden></div>' + this.bande() + this.apercu() +
          (L ? "" : '<div class="gp-fs-hint">' + (B ? "Survole pour lire · glisse pour sélectionner une période · double-clic pour zoomer · pincement du trackpad ou ctrl + molette · + / − / 0 au clavier" : "Touche ou fais glisser pour lire · pince à deux doigts pour zoomer · double touche pour zoomer") + "</div>") + "</div>" +
          '<aside class="gp-fs-side" aria-label="Lecture"><div class="gp-ro" data-ro></div><div data-notes class="gp-notes"></div><div data-why></div>' +
          (L ? '<div class="gp-pied"><span class="gp-pied-t">Projection, pas une promesse.</span><button type="button" class="gp-lien" data-act="calcul">Comment c\'est calculé</button></div>' :
            '<h4>Événements</h4><div data-list></div><h4>Données</h4><div class="gp-tbl-w" data-table></div><div class="gp-pied"><span class="gp-pied-t">Projection, pas une promesse.</span><button type="button" class="gp-lien" data-act="calcul">Comment c\'est calculé</button></div>') +
          '</aside></div><p class="ui-sr" data-sr></p></div>';
      }
      this.host.innerHTML = h;
      this.racine = this.host.firstElementChild || this.host.children[0] || this.host;
      this.cadreEl = this.q("[data-cadre]"); this.svg = this.q("[data-svg]"); this.hit = this.q("[data-hit]"); this.marks = this.q("[data-marks]");
      this.ssvg = this.q("[data-ssvg]"); this.bsvg = this.q("[data-bsvg]"); this.roEl = this.q("[data-ro]"); this.whyEl = this.q("[data-why]"); this.planBar = this.q("[data-planbar]");
      this.listEl = this.q("[data-list]"); this.tblEl = this.q("[data-table]"); this.notesEl = this.q("[data-notes]"); this.invEl = this.q("[data-invite]"); this.etatEl = this.q("[data-etat]");
      this.bind();
    }
    /* ---------- événements ---------- */
    bind() {
      const g = this.g;
      this.ecoute(this.host, "click", e => this.clic(e));
      this.bindHit();
      if (this.bsvg) this.bindApercu();
      const ObsR = g.win && g.win.ResizeObserver;
      if (typeof ObsR === "function" && this.cadreEl) { this.ro = new ObsR(() => { if (this.raf && g.win.cancelAnimationFrame) g.win.cancelAnimationFrame(this.raf); this.raf = g.win.requestAnimationFrame ? g.win.requestAnimationFrame(() => this.render({})) : 0; }); this.ro.observe(this.cadreEl); }
    }
    clic(e) {
      const g = this.g, t = e.target, c = s => (t && t.closest ? t.closest(s) : null);
      const w = c("[data-win]"); if (w) { g.choisirFenetre(w.dataset.win); return; }
      const j = c("[data-jalons]"); if (j) { this.clicMarqueur(j); return; }
      const a = c("[data-act]");
      if (a) {
        const k = a.dataset.act;
        if (c("[data-invite]") && k !== "plein") g.lsSet(CLES_LS.invitationOff, "1");
        if (k === "reglages") g.ouvrirReglages(a);
        else if (k === "plein") { if (this.plein) g.fermerPlein(); else g.ouvrirPlein(a); }
        else if (k === "zreset") g.reinitialiserZoom();
        else if (k === "eur") g.ouvrirEuros(a);
        else if (k === "calcul") g.ouvrirCalcul(a);
        else if (k === "jalons") g.ouvrirJalons(a);
        else if (k === "lecture") g.ouvrirLecture(a);
        else if (k === "bande") { g.etat.bandeOuverte = !g.etat.bandeOuverte; g.rendreTout(); }
        else if (k === "effacer") { g.etat.curseur = null; g.majCurseur(); }
        else if (k === "invite-off") { g.lsSet(CLES_LS.invitationOff, "1"); this.majInvitation(); }
        else if (k === "avenir-suivant" || k === "avenir-lecture") g.avenirSuivant(k === "avenir-lecture");
        else if (k === "plan-off") g.appliquerReglages({ plan: null });
        else if (k === "reessayer") { if (g.o.reessayer) g.o.reessayer(); }
        else if (k === "zoom+") g.zoomAutour(g.etat.curseur != null ? g.etat.curseur : (g.domaineCourant().debut + g.domaineCourant().fin) / 2, 0.6);
        else if (k === "zoom-") g.zoomAutour(g.etat.curseur != null ? g.etat.curseur : (g.domaineCourant().debut + g.domaineCourant().fin) / 2, 1 / 0.6);
        return;
      }
      const ev = c("[data-jalon]"); if (ev) { g.ouvrirJalon(ev.dataset.jalon, ev); return; }
      const lr = c(".gp-evrow"); if (lr && lr.dataset.ev) { g.selectionnerJalon(lr.dataset.ev); return; }
      const tr = c("tr[data-t]"); if (tr) { g.etat.curseur = +tr.dataset.t; g.majCurseur(); }
    }
    clicMarqueur(btn) {
      const g = this.g, ids = String(btn.dataset.jalons).split(" "), js = ids.map(i => g.M.jalons.find(x => x.id === i)).filter(Boolean);
      if (!js.length) return;
      g.etat.curseur = js[0].t; g.majCurseur();
      if (js.length === 1) g.ouvrirJalon(js[0].id, btn); else g.ouvrirGroupe(js, btn);
    }
    /* ----- curseur : toucher-glisser, survol, clavier, zoom ----- */
    tAt(clientX) {
      const g = this.g, r = this.hit.getBoundingClientRect ? this.hit.getBoundingClientRect() : { left: 0, width: this.geo ? this.geo.R - this.geo.L : 1 };
      const d = g.domaineCourant();
      return d.debut + clamp((clientX - r.left) / (r.width || 1), 0, 1) * (d.fin - d.debut);
    }
    pxParMs() { const d = this.g.domaineCourant(), gg = this.geo; return gg ? (gg.R - gg.L) / (d.fin - d.debut) : 0; }
    /** Date du point le plus proche (échantillon de la granularité), attirée par un jalon à moins de 9 px. */
    accrocher(tf) {
      const g = this.g, gg = this.geo; if (!gg || !g.M) return tf;
      const temps = gg.ech.temps; if (!temps.length) return tf;
      const dom = g.domaineCourant();
      let t = temps[plusProche(temps, clamp(tf, dom.debut, dom.fin))];
      const pxm = this.pxParMs(); let best = null;
      g.jalonsVisibles().forEach(j => { if (j.t < dom.debut || j.t > dom.fin) return; const dx = Math.abs(j.t - tf) * pxm; if (dx <= 9 && (!best || dx < best.dx)) best = { dx, t: j.t }; });
      return best ? best.t : t;
    }
    pointer(clientX, type) {
      const g = this.g, t = this.accrocher(this.tAt(clientX));
      if (t !== g.etat.curseur) {
        g.etat.curseur = t;
        try { if (type === "touch" && g.win && g.win.navigator && g.win.navigator.vibrate && g.M.jalons.some(j => Math.abs(j.t - t) < 1)) g.win.navigator.vibrate(8); } catch (e) { /* rien */ }
        g.majCurseur();
      }
    }
    bindHit() {
      const g = this.g, hit = this.hit; let drag = null, pinch = null, dernierTap = null;
      this.ecoute(hit, "pointerdown", e => {
        this.typePtr = e.pointerType; this.cadreEl.classList && this.cadreEl.classList.add("dragging");
        try { hit.setPointerCapture(e.pointerId); } catch (x) { /* rien */ }
        this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.ptr.size === 2) { const [p1, p2] = [...this.ptr.values()]; pinch = { d: Math.abs(p1.x - p2.x) || 1, dom: g.domaineCourant(), tc: this.tAt((p1.x + p2.x) / 2) }; drag = null; this.selection = null; return; }
        drag = { x0: e.clientX, t0: this.tAt(e.clientX), moved: false, pt: e.pointerType, sel: !!(this.P && this.P.select) && e.pointerType === "mouse" };
        if (!drag.sel) this.pointer(e.clientX, e.pointerType);
      });
      this.ecoute(hit, "pointermove", e => {
        if (this.ptr.has(e.pointerId)) this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && this.ptr.size === 2) {
          const [p1, p2] = [...this.ptr.values()], d = Math.abs(p1.x - p2.x) || 1, fac = pinch.d / d, a = pinch.dom.debut, b = pinch.dom.fin;
          const r = hit.getBoundingClientRect ? hit.getBoundingClientRect() : { left: 0, width: 1 }, fx = clamp(((p1.x + p2.x) / 2 - r.left) / (r.width || 1), 0, 1), span = (b - a) * fac, na = pinch.tc - fx * span;
          g.reglerZoom(na, na + span); return;
        }
        if (drag) {
          if (Math.abs(e.clientX - drag.x0) > 5) drag.moved = true;
          if (drag.sel) { if (drag.moved) { this.selection = [drag.t0, this.tAt(e.clientX)]; this.majSelection(); } } else this.pointer(e.clientX, e.pointerType);
        } else if (this.P && this.P.hover && e.pointerType === "mouse") this.pointer(e.clientX, "mouse");
      });
      const fin = e => {
        this.ptr.delete(e.pointerId); if (!this.ptr.size && this.cadreEl.classList) this.cadreEl.classList.remove("dragging");
        if (pinch) { if (this.ptr.size < 2) pinch = null; drag = null; return; }
        if (!drag) return;
        const dd = drag; drag = null;
        if (dd.sel && dd.moved && this.selection) {
          const [a, b] = this.selection; this.selection = null;
          if (Math.abs(b - a) >= 90 * MS_JOUR) g.reglerZoom(Math.min(a, b), Math.max(a, b)); else this.majSelection();
          return;
        }
        if (e.type === "pointercancel") return;
        if (!dd.moved) {
          if (dd.sel) this.pointer(e.clientX, "mouse");
          const now = (g.win && g.win.performance ? g.win.performance : Date).now();
          if (dernierTap && now - dernierTap.t < 320 && Math.abs(e.clientX - dernierTap.x) < 24) {
            dernierTap = null;
            if (dd.pt === "mouse" && !this.plein && this.mode === "carte") { g.ouvrirPlein(this.q('[data-act="plein"]')); return; }
            g.zoomAutour(this.tAt(e.clientX), 0.5); return;
          }
          dernierTap = { t: now, x: e.clientX };
        }
      };
      this.ecoute(hit, "pointerup", fin); this.ecoute(hit, "pointercancel", fin);
      this.ecoute(hit, "wheel", e => {
        if (e.ctrlKey || e.metaKey) { if (e.preventDefault) e.preventDefault(); g.zoomAutour(this.tAt(e.clientX), Math.exp(e.deltaY * 0.01)); }
        else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { if (e.preventDefault) e.preventDefault(); const d = g.domaineCourant(), r = hit.getBoundingClientRect ? hit.getBoundingClientRect() : { width: 1 }; g.deplacer(e.deltaX / (r.width || 1) * (d.fin - d.debut)); }
      }, { passive: false });
      this.ecoute(hit, "keydown", e => this.touche(e));
    }
    /** Pas du curseur au clavier : échantillon précédent / suivant de la fenêtre ; au bord d'une fenêtre zoomée, la fenêtre se déplace. */
    touche(e) {
      const g = this.g, M = g.M, gg = this.geo; if (!M || !gg) return;
      const dom = g.domaineCourant(), temps = gg.ech.temps, cur = g.etat.curseur != null ? g.etat.curseur : M.today;
      const k = e.key; let t = null;
      const suivant = n => {
        const i = plusProche(temps, cur);
        let j = clamp(i + n, 0, temps.length - 1);
        if (temps[i] !== cur && n > 0 && temps[i] < cur) j = clamp(i + n, 0, temps.length - 1); else if (temps[i] !== cur && n < 0 && temps[i] > cur) j = clamp(i + n, 0, temps.length - 1);
        return temps[j];
      };
      const pasAnnee = Math.max(1, Math.round(12 / moisParPas(gg.gran)));
      if (k === "ArrowRight") t = suivant(e.shiftKey ? pasAnnee : 1);
      else if (k === "ArrowLeft") t = suivant(e.shiftKey ? -pasAnnee : -1);
      else if (k === "PageUp") t = suivant(pasAnnee);
      else if (k === "PageDown") t = suivant(-pasAnnee);
      else if (k === "Home") t = temps[0];
      else if (k === "End") t = temps[temps.length - 1];
      else if (k === "t" || k === "T") t = M.today >= dom.debut && M.today <= dom.fin ? M.today : null;
      else if (k === "+" || k === "=") { if (e.preventDefault) e.preventDefault(); g.zoomAutour(cur, 0.6); return; }
      else if (k === "-" || k === "_") { if (e.preventDefault) e.preventDefault(); g.zoomAutour(cur, 1 / 0.6); return; }
      else if (k === "0") { if (e.preventDefault) e.preventDefault(); g.reinitialiserZoom(); return; }
      else if (k === "Escape" && g.etat.curseur != null) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); g.etat.curseur = null; g.majCurseur(); return; }
      else if (k === "Enter") {
        const sel = this.jalonsAuCurseur(); if (sel.length) { if (e.preventDefault) e.preventDefault(); if (sel.length === 1) g.ouvrirJalon(sel[0].id, this.hit); else g.ouvrirGroupe(sel, this.hit); } else g.ouvrirLecture(this.hit);
        return;
      } else return;
      if (t == null) return;
      if (e.preventDefault) e.preventDefault();
      if ((k === "ArrowRight" && cur >= temps[temps.length - 1]) || (k === "ArrowLeft" && cur <= temps[0])) {
        if (g.etat.zoom) { const sens = k === "ArrowRight" ? 1 : -1; g.etat.curseur = clamp(cur + sens * 30 * MS_JOUR, g.bornes().debut, g.bornes().fin); g.deplacer(sens * 30 * MS_JOUR); g.majCurseur(); }
        return;
      }
      g.etat.curseur = t; g.majCurseur();
    }
    jalonsAuCurseur() {
      const g = this.g, c = g.etat.curseur; if (c == null || !g.M) return [];
      return g.jalonsVisibles().filter(j => Math.abs(j.t - c) < DEMI_PAS_MS);
    }
    bindApercu() {
      const g = this.g, b = this.bsvg; let drag = null;
      const tDe = (x, W) => { const bo = g.bornes(), r = this.geoB; return bo.debut + clamp((x - r.L) / (r.R - r.L), 0, 1) * (bo.fin - bo.debut); };
      this.ecoute(b, "pointerdown", e => {
        if (!this.geoB) return;
        try { b.setPointerCapture(e.pointerId); } catch (x) { /* rien */ }
        const r = b.getBoundingClientRect ? b.getBoundingClientRect() : { left: 0, width: this.geoB.W }, sx = this.geoB.W / (r.width || this.geoB.W), px = (e.clientX - r.left) * sx;
        const d = g.domaineCourant(), x0 = this.geoB.XB(d.debut), x1 = this.geoB.XB(d.fin);
        let type = "deplacer";
        if (Math.abs(px - x0) < 10) type = "g"; else if (Math.abs(px - x1) < 10) type = "d";
        else if (px < x0 || px > x1) { const span = d.fin - d.debut, c = tDe(px); g.reglerZoom(c - span / 2, c + span / 2); }
        const n = g.domaineCourant(); drag = { type, px, a: n.debut, b: n.fin, sx, W: this.geoB.W };
      });
      this.ecoute(b, "pointermove", e => {
        if (!drag) return;
        const r = b.getBoundingClientRect ? b.getBoundingClientRect() : { left: 0, width: drag.W }, px = (e.clientX - r.left) * drag.sx, bo = g.bornes(), dm = (px - drag.px) / (this.geoB.R - this.geoB.L) * (bo.fin - bo.debut);
        if (drag.type === "deplacer") g.reglerZoom(drag.a + dm, drag.b + dm); else if (drag.type === "g") g.reglerZoom(Math.min(drag.a + dm, drag.b - 60 * MS_JOUR), drag.b); else g.reglerZoom(drag.a, Math.max(drag.b + dm, drag.a + 60 * MS_JOUR));
      });
      const fin = () => { drag = null; }; this.ecoute(b, "pointerup", fin); this.ecoute(b, "pointercancel", fin);
      this.ecoute(b, "keydown", e => {
        const d = g.domaineCourant(), s = (d.fin - d.debut) / 10;
        if (e.key === "ArrowRight") { e.preventDefault(); g.deplacer(s); } else if (e.key === "ArrowLeft") { e.preventDefault(); g.deplacer(-s); }
        else if (e.key === "+" || e.key === "=") { e.preventDefault(); g.zoomAutour((d.debut + d.fin) / 2, 0.6); } else if (e.key === "-") { e.preventDefault(); g.zoomAutour((d.debut + d.fin) / 2, 1 / 0.6); }
        else if (e.key === "0") { e.preventDefault(); g.reinitialiserZoom(); }
      });
    }
  }

  /* ---------- rendu d'une vue ---------- */
  const setStyle = (el, props) => { if (!el) return; if (el.style) Object.keys(props).forEach(k => { el.style[k] = props[k]; }); else el.setAttribute("style", Object.keys(props).map(k => k.replace(/[A-Z]/g, c => "-" + c.toLowerCase()) + ":" + props[k]).join(";")); };
  const tc = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  const classe = (el, c, on) => { if (el && el.classList) el.classList.toggle(c, !!on); };
  /** Plan figé normalisé pour le composant (dates en ms, valeurs à plat pour l'échelle). */
  function planNormalise(p) {
    if (!p || !p.serie || !tab(p.serie.mois).length) return null;
    const s = p.serie, t = s.mois.map(msDe), col = k => (Array.isArray(s[k]) && s[k].length === t.length ? s[k] : t.map(() => null));
    const o = { id: p.id, cree: msDe(p.cree_le || s.mois[0]), raison: p.raison || "manuel", comparaison: p.comparaison || null, t, p10: col("p10"), p25: col("p25"), p50: col("p50"), p75: col("p75"), p90: col("p90") };
    o.valeurs = [].concat(o.p10, o.p90, o.p50).filter(v => v != null && isFinite(v));
    return o;
  }
  const RAISONS_PLAN = { revue_mensuelle: "revue mensuelle", objectif: "objectif", manuel: "manuel" };

  Object.assign(Vue.prototype, {
    largeur() {
      const c = this.cadreEl, w = c && c.clientWidth;
      return Math.max(200, w || this.g.o.largeur || (this.g.win && this.g.win.innerWidth ? Math.min(this.g.win.innerWidth - 32, 1200) : 358));
    },
    paramsMode(W) {
      const g = this.g;
      let souris = true;
      try { souris = !!(g.win && g.win.matchMedia && g.win.matchMedia("(hover: hover) and (pointer: fine)").matches); } catch (e) { souris = true; }
      const P = parametresMode(this.mode, W, { souris, hauteurFenetre: g.win && g.win.innerHeight });
      P.W = W; P.id = this.id; P.mesurer = g.mesurer(); P.reduit = g.reduit();
      if (P.fill) { const h = this.cadreEl && this.cadreEl.clientHeight; P.H = h > 120 ? h : Math.max(240, (g.win && g.win.innerHeight ? g.win.innerHeight : 600) - 260); }
      return P;
    },
    majCommandes() {
      const g = this.g, M = g.M, e = g.etat, r = e.reglages;
      this.host.querySelectorAll("[data-win]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.win === String(e.fenetre) && !e.zoom && !r.periode)));
      this.host.querySelectorAll('[data-act="zreset"]').forEach(b => { b.hidden = !e.zoom; });
      const eurTxt = r.euros === "courants" ? (this.mode === "carte" ? "€ courants" : "en euros courants") : (this.mode === "carte" ? "€ d'aujourd'hui" : "en euros d'aujourd'hui");
      this.host.querySelectorAll("[data-eur]").forEach(b => tc(b, eurTxt));
      const n = M ? g.jalonsVisibles().length : 0, nj = this.q("[data-njal]");
      if (nj) { tc(nj, n === 1 ? "1 jalon" : n + " jalons"); const b = nj.parentNode; if (b) b.hidden = !n; }
      const pb = this.planBar;
      if (pb) {
        const p = e.plan;
        pb.hidden = !p;
        if (p) pb.innerHTML = '<svg class="k" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 9h14" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 2.5" fill="none"/></svg><span>Comparé au <b>plan du ' + esc(dJour(p.cree)) + "</b> · " + esc(RAISONS_PLAN[p.raison] || p.raison) + '</span><button type="button" data-act="plan-off" aria-label="Arrêter la comparaison">' + ICO.x + "</button>";
      }
    },
    render(opt) {
      const g = this.g, M = g.M, e = g.etat, o = opt || {};
      if (g.detruit || !this.cadreEl) return;
      this.majCommandes();
      const attend = !M || M.etat === "calcul" || (M.etat === "pret" && !M.futur && !M.passe.t.length && g.donnees && g.donnees.etat === "calcul");
      const racine = this.racine;
      classe(racine, "gp-charge", attend); classe(racine, "gp-erreur", !!M && M.etat === "erreur"); classe(racine, "gp-vide", !!M && M.etat === "vide");
      if (racine.setAttribute) { if (attend) racine.setAttribute("aria-busy", "true"); else if (racine.removeAttribute) racine.removeAttribute("aria-busy"); }
      const W = this.largeur(), P = this.P = this.paramsMode(W);
      if (attend || !M || M.etat === "erreur" || M.etat === "vide" || (!M.futur && !M.passe.t.length)) {
        /* squelette à la taille finale (jamais un chiffre provisoire), ou message honnête avec « Réessayer » */
        const plotH = P.plotH || 284, H = P.fill && P.H ? P.H : plotH + (P.compact ? 6 : 0) + 22 + 24;
        if (!P.fill) setStyle(this.cadreEl, { height: H + "px" });
        this.svg.innerHTML = ""; if (this.marks) this.marks.innerHTML = ""; if (this.ssvg) this.ssvg.innerHTML = ""; if (this.bsvg) this.bsvg.innerHTML = "";
        const st = this.etatEl;
        if (st) {
          if (!attend && M && M.etat === "erreur") { st.hidden = false; st.innerHTML = '<p>' + esc((g.donnees && g.donnees.erreur) || "Le calcul de la projection n'a pas abouti.") + '</p><button type="button" class="gp-btn" data-act="reessayer">Réessayer</button>'; }
          else if (!attend) { st.hidden = false; st.innerHTML = "<p>" + esc((M && M.brut && M.brut.raison) || "Pas encore assez de données pour tracer le graphique : Boussole prend chaque nuit une photo de ton patrimoine, la courbe se dessine au fil des jours.") + "</p>"; }
          else st.hidden = true;
        }
        setStyle(this.hit, { display: "none" });
        const hlk = this.q('[data-hl="k"]'), hlv = this.q('[data-hl="v"]'), hls = this.q('[data-hl="s"]');
        tc(hlk, ""); tc(hlv, ""); tc(hls, ""); tc(this.q("[data-roline]"), "");
        if (this.roEl) this.roEl.innerHTML = ""; if (this.notesEl) this.notesEl.innerHTML = ""; if (this.whyEl) this.whyEl.innerHTML = "";
        this.geo = null;
        return;
      }
      if (this.etatEl) this.etatEl.hidden = true;
      setStyle(this.hit, { display: "" });
      const dom = g.domaineCourant(), gran = granularite(dom.fin - dom.debut, !!P.plein && this.mode !== "portrait");
      const C = g.couches();
      /* échelle des y : mémorisée entre l'aperçu (500 chemins) et le résultat complet ; recalculée à chaque image pendant une transition */
      const cle = [M.vue, M.euros, M.mode, Math.round(dom.debut / MS_JOUR), Math.round(dom.fin / MS_JOUR), C.existant ? 1 : 0, C.plan ? C.plan.id : "", this.mode].join("|");
      const besoin = besoinFenetre(M, dom, gran, C);
      let y;
      if (e.anim) y = domaineY(besoin.lo, besoin.hi);
      else {
        if (e.cleY !== cle) { e.echelleY = null; e.cleY = cle; }
        const s = echelleYStable(e.echelleY, besoin, { apercu: M.progressif });
        e.echelleY = { lo: s.lo, hi: s.hi }; y = e.echelleY;
      }
      const r = construireSvg(M, { dom, gran, couches: C, echelleY: y, cacherObjectifs: null }, P);
      this.geo = r.geo;
      this.svg.setAttribute("viewBox", "0 0 " + r.geo.W + " " + r.geo.H); this.svg.setAttribute("width", r.geo.W); this.svg.setAttribute("height", r.geo.H);
      this.svg.innerHTML = r.svg;
      if (!P.fill) setStyle(this.cadreEl, { height: r.geo.H + "px" });
      setStyle(this.hit, { left: r.geo.L + "px", top: r.geo.T + "px", width: (r.geo.R - r.geo.L) + "px", height: r.geo.plotH + "px" });
      this.hit.setAttribute("aria-valuemin", String(Math.ceil(dom.debut / MS_JOUR))); this.hit.setAttribute("aria-valuemax", String(Math.floor(dom.fin / MS_JOUR)));
      this.svg.setAttribute("aria-label", phraseTitre(M, aFinFenetre(M, dom)));
      if (o.cadre) { this.majCurseur(); return; }
      this.rendreMarqueurs(); this.rendreBande(dom); this.rendreApercu(); this.rendreListes(dom, gran); this.rendrePourquoi();
      this.majInvitation();
      tc(this.q("[data-sr]"), resumeAccessible(M, dom));
      this.majCurseur();
    },
    rendreMarqueurs() {
      if (!this.marks) return;
      const gg = this.geo, ms = gg.marqueurs.slice().sort((a, b) => a.x - b.x), g = this.g;
      let h = "";
      ms.forEach((m, i) => {
        const dx = Math.min(i > 0 ? m.x - ms[i - 1].x : 44, i < ms.length - 1 ? ms[i + 1].x - m.x : 44), w = clamp(dx, 20, 44), ids = m.jalons.map(j => j.id).join(" ");
        const lab = m.jalons.length > 1 ? m.jalons.length + " jalons rapprochés, " + dMois(m.jalons[0].t) + " à " + dMois(m.jalons[m.jalons.length - 1].t) + ". Ouvrir la liste"
          : m.jalons[0].titre + ", " + (estObjectif(m.jalons[0]) ? "échéance " : "") + dMois(m.jalons[0].t) + ". Ouvrir le détail";
        h += '<button type="button" class="gp-mk-b" data-jalons="' + esc(ids) + '" style="left:' + (m.x - w / 2).toFixed(1) + "px;top:" + (m.y - 22).toFixed(1) + "px;width:" + w.toFixed(1) + 'px" aria-label="' + esc(lab) + '"></button>';
      });
      this.marks.innerHTML = h;
      void g;
    },
    rendreBande(dom) {
      if (!this.ssvg) return;
      const g = this.g, M = g.M, bt = this.q('[data-act="bande"]');
      const ouverte = !!g.etat.bandeOuverte || this.mode !== "carte";
      const b = construireBande(M, { dom }, this.geo, this.P, g.etat.bandeOuverte);
      if (bt) bt.hidden = !!b.vide;
      if (b.vide) { this.ssvg.innerHTML = ""; return; }
      this.ssvg.setAttribute("viewBox", "0 0 " + this.geo.W + " " + b.H); this.ssvg.setAttribute("height", b.H); this.ssvg.innerHTML = b.svg; this.bande = b;
      if (bt && this.mode === "carte") { bt.setAttribute("aria-expanded", String(!!g.etat.bandeOuverte)); const h = this.q("[data-bandeh]"); if (h) h.hidden = !g.etat.bandeOuverte; }
      void ouverte;
    },
    rendreApercu() {
      if (!this.bsvg) return;
      const g = this.g, M = g.M, gg = this.geo, bo = g.bornes(), W = gg.W, H = this.mode === "paysage" ? 28 : this.mode === "bureau" ? 48 : 36, L = gg.L, R = gg.R;
      const XB = t => L + (t - bo.debut) / (bo.fin - bo.debut) * (R - L);
      this.geoB = { W, L, R, XB, H };
      let lo = Infinity, hi = -Infinity;
      const voir = v => { if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } };
      const F = M.futur, pas = F ? Math.max(1, Math.round(F.n / 100)) : 1, pasP = Math.max(1, Math.round(M.passe.t.length / 100));
      M.passe.v.forEach((v, i) => { if (i % pasP === 0) voir(v); }); if (F) for (let i = 0; i < F.n; i += pas) { voir(F.p10 ? F.p10[i] : F.p50[i]); voir(F.p90 ? F.p90[i] : F.p50[i]); }
      if (!isFinite(lo)) { this.bsvg.innerHTML = ""; return; }
      const Yb = v => 4 + (1 - (v - lo) / (hi - lo || 1)) * (H - 8);
      let s = '<rect x="' + L + '" y="0" width="' + (R - L) + '" height="' + H + '" rx="6" class="gp-b-fond"/>';
      if (F && F.p10 && F.p90) {
        const idx = []; for (let i = 0; i < F.n; i += pas) idx.push(i); if (idx[idx.length - 1] !== F.n - 1) idx.push(F.n - 1);
        s += '<path class="gp-b90" d="' + bande(idx.map(i => [XB(F.t[i]), Yb(F.p90[i])]), idx.map(i => [XB(F.t[i]), Yb(F.p10[i])])) + '"/>';
        s += '<path class="gp-med" style="stroke-width:1.5" d="' + chemin(idx.map(i => [XB(F.t[i]), Yb(F.p50[i])])) + '"/>';
      }
      if (M.passe.t.length > 1) { const idx = []; for (let i = 0; i < M.passe.t.length; i += pasP) idx.push(i); if (idx[idx.length - 1] !== M.passe.t.length - 1) idx.push(M.passe.t.length - 1); s += '<path class="gp-recon" d="' + chemin(idx.map(i => [XB(M.passe.t[i]), Yb(M.passe.v[i])])) + '"/>'; }
      s += '<line class="gp-tdy" x1="' + XB(M.today).toFixed(1) + '" x2="' + XB(M.today).toFixed(1) + '" y1="2" y2="' + (H - 2) + '"/>';
      g.jalonsVisibles().forEach(j => { if (j.t >= bo.debut && j.t <= bo.fin) s += '<line class="gp-ax" x1="' + XB(j.t).toFixed(1) + '" x2="' + XB(j.t).toFixed(1) + '" y1="' + (H - 6) + '" y2="' + H + '"/>'; });
      const d = g.domaineCourant(), x0 = XB(d.debut), x1 = XB(d.fin);
      s += '<rect class="gp-br-win" x="' + x0.toFixed(1) + '" y="1" width="' + Math.max(6, x1 - x0).toFixed(1) + '" height="' + (H - 2) + '" rx="5"/><rect class="gp-br-h" x="' + (x0 - 2).toFixed(1) + '" y="' + (H / 2 - 9) + '" width="4" height="18" rx="2"/><rect class="gp-br-h" x="' + (x1 - 2).toFixed(1) + '" y="' + (H / 2 - 9) + '" width="4" height="18" rx="2"/>';
      if (this.mode !== "paysage") { const a0 = new Date(bo.debut).getUTCFullYear() + 1, a1 = new Date(bo.fin).getUTCFullYear(); const pasA = Math.max(1, Math.ceil((a1 - a0 + 1) / 6)); for (let a = a0; a <= a1; a += pasA) s += '<text x="' + (XB(Date.UTC(a, 0, 1)) + 3).toFixed(1) + '" y="' + (H - 6) + '" class="after">' + a + "</text>"; }
      this.bsvg.setAttribute("viewBox", "0 0 " + W + " " + H); this.bsvg.setAttribute("height", H); this.bsvg.innerHTML = s;
      tc(this.q("[data-brushv]"), dMois(d.debut) + " → " + dMois(d.fin));
    },
    rendreListes(dom, gran) {
      const g = this.g, M = g.M;
      if (this.listEl) {
        const sel = this.jalonsAuCurseur().map(j => j.id);
        this.listEl.innerHTML = '<ol class="gp-evl" aria-label="Événements de la projection">' + M.jalons.filter(j => g.jalonsVisibles().includes(j)).map(j => {
          const o = estObjectif(j) ? M.objectifs.find(z => z.id === j.objectifId) : null, mot = o ? motProba(o.probabilite) : null, st = o && STATUT_OBJ[o.statut];
          const dedans = j.t >= dom.debut && j.t <= dom.fin, num = M.jalons.indexOf(j) + 1;
          const date = estObjectif(j) ? "échéance " + dMois(j.t) + (o && o.probabilite != null ? " · " + chancesTxt(o.probabilite) : "") : (j.tFin ? dMois(j.t) + " → " + dMois(j.tFin) : dMois(j.t) + " · " + relatif(M.today, j.t));
          const eff = estObjectif(j) ? chip(cap1(mot || (st ? st[0] : "—")), mot ? TON_MOT[mot] : st ? st[1] : "todo") : effetMensuel(j) != null && j.source !== "calendrier" ? esc(fMois(effetMensuel(j))) : "";
          return '<li><button type="button" class="gp-evrow' + (dedans ? "" : " out") + '" data-ev="' + esc(j.id) + '" aria-current="' + sel.includes(j.id) + '"><span class="gp-pn' + (o ? " gl " + (mot ? TON_MOT[mot] : st ? st[1] : "todo") : "") + '">' + num + '</span><span class="gp-ev-m"><span class="gp-ev-t">' + esc(j.titre) +
            '</span><span class="gp-ev-d num">' + esc(date) + (dedans ? "" : " · hors fenêtre") + '</span></span><span class="gp-ev-e num">' + eff + "</span></button></li>";
        }).join("") + "</ol>";
      }
      if (this.tblEl) this.tblEl.innerHTML = tableauHtml(M, dom, gran, { etat: g.etat });
    },
    rendrePourquoi() {
      const g = this.g, p = g.etat.plan;
      if (!this.whyEl) return;
      if (!p) { this.whyEl.innerHTML = ""; return; }
      const c = p.comparaison, dernier = c && c.dernier;
      let h = '<section class="gp-why" aria-labelledby="' + this.id + 'w"><h3 id="' + this.id + 'w">Pourquoi cet écart</h3>';
      if (dernier) h += '<p class="gp-why-s">Du ' + esc(dJour(p.cree)) + " à aujourd'hui · " + (dernier.ecart < 0 ? "en dessous" : "au-dessus") + " du plan de " + esc(fInt(Math.abs(dernier.ecart))) + NB + "€" + (c.n ? " · le réel est resté dans la bande 8 chances sur 10 pour " + c.dans_la_bande + " mois sur " + c.n : "") + ".</p>";
      h += '<p class="gp-why-s">La décomposition de cet écart (ton épargne, les marchés, les événements, les frais et impôts, les corrections de données) n\'est pas encore calculée : elle arrive. Boussole n\'affiche aucun chiffre qu\'il ne sait pas justifier.</p>';
      h += "<p>" + this.g.claudeLien("Dans Boussole, mon patrimoine net est " + (dernier && dernier.ecart < 0 ? "en dessous" : "au-dessus") + " du plan figé le " + dJour(p.cree) + " (écart : " + (dernier ? fSE(dernier.ecart) : "inconnu") + "). Aide-moi à comprendre d'où vient cet écart : mon épargne, les marchés, des événements ou des frais ?", "Demander à Claude") + "</p></section>";
      this.whyEl.innerHTML = h;
    },
    majInvitation() {
      const g = this.g, el = this.invEl;
      if (!el || this.plein || !g.M) return;
      const dom = g.domaineCourant(), n = g.jalonsVisibles().filter(j => j.t >= dom.debut && j.t <= dom.fin).length;
      const off = !!g.lsGet(CLES_LS.invitationOff), vue = !!g.lsGet(CLES_LS.invitationVue);
      const montrer = invitationVisible(n, g.etat.fenetre, vue, off) && !!g.M.futur;
      if (montrer && el.hidden) {
        el.innerHTML = "<span>" + (g.large() ? "Ouvre le graphique en grand pour voir tous les détails." : "Plus de détail en grand, ou en tournant ton téléphone.") + '</span><button type="button" class="go" data-act="plein">Ouvrir</button><button type="button" class="x" data-act="invite-off" aria-label="Ne plus afficher cette invitation">' + ICO.x + "</button>";
        g.lsSet(CLES_LS.invitationVue, "1");
      }
      el.hidden = !montrer;
    },
    /* ---------- curseur ---------- */
    tempsParDefaut() {
      const g = this.g, M = g.M, dom = g.domaineCourant();
      if (g.etat.plan && dom.debut <= M.today && M.today <= dom.fin) return M.today;
      if (M.mode === "capacite" && M.futur) { const t3 = ajouterMois(M.today, 36); if (t3 <= dom.fin) { const i = plusProche(M.futur.t, t3); return M.futur.t[i]; } }
      if (M.futur && dom.fin > M.today) return aFinFenetre(M, dom);
      return M.passe.t.length ? Math.min(M.today, M.passe.t[M.passe.t.length - 1]) : M.today;
    },
    majSelection() {
      const sg = this.svg.querySelector("[data-sel]"); if (!sg || !this.geo) return;
      if (!this.selection) { sg.innerHTML = ""; return; }
      const gg = this.geo, [a, b] = this.selection, xa = gg.X(Math.min(a, b)), xb = gg.X(Math.max(a, b));
      sg.innerHTML = '<rect class="gp-selr" x="' + xa.toFixed(1) + '" y="' + gg.T + '" width="' + (xb - xa).toFixed(1) + '" height="' + (gg.B - gg.T) + '" rx="4"/><text x="' + ((xa + xb) / 2).toFixed(1) + '" y="' + (gg.T + 16) + '" text-anchor="middle" class="gp-halo gp-ti">' + esc(dMois(Math.min(a, b)) + " → " + dMois(Math.max(a, b))) + "</text>";
    },
    majCurseur() {
      const g = this.g, M = g.M, gg = this.geo, e = g.etat;
      if (!M || !gg) return;
      const dom = g.domaineCourant();
      let t = e.curseur; if (t != null && (t < dom.debut - MS_JOUR || t > dom.fin + MS_JOUR)) t = null;
      const def = t == null, tt = def ? this.tempsParDefaut() : t;
      const demi = demiPas(gg.gran);
      const lec = lecture(M, e, tt, { demi }), xh = this.svg.querySelector("[data-xh]"), pill = this.svg.querySelector("[data-endpill]");
      this.lec = lec; this.def = def;
      let py = gg.pillY;
      if (xh && !def && lec.valeur != null) {
        const x = gg.X(tt), v = lec.valeur, yv = gg.Y(v); py = clamp(yv, gg.T + 10, gg.B - 10);
        const tr = (sel, tx, ty) => { const n = xh.querySelector(sel); if (n) n.setAttribute("transform", "translate(" + tx.toFixed(1) + " " + ty.toFixed(1) + ")"); };
        tr("[data-xv]", x, 0); tr("[data-xhh]", 0, yv); tr("[data-xd]", x, yv); tr("[data-xp]", 0, py);
        const dot = xh.querySelector("[data-xdot]"); if (dot) dot.setAttribute("class", lec.nature === "projete" ? "gp-dot-brand" : "gp-dot-ink");
        const pl = xh.querySelector("[data-xpill]"); if (pl) { pl.setAttribute("class", "gp-pill" + (lec.nature === "projete" ? "" : " ink")); const tx = pl.querySelector("text"); if (tx) tx.textContent = fK(v, tt <= M.today && v < 1e5 && v >= 1e4 ? 1 : 0); }
        setStyle(xh, { opacity: "1" });
        if (pill) setStyle(pill, { display: "none" });
      } else {
        if (xh) setStyle(xh, { opacity: "0" });
        if (pill) setStyle(pill, { display: "" });
      }
      this.svg.querySelectorAll(".gp-ytk").forEach(n => { setStyle(n, { display: py != null && Math.abs(+n.getAttribute("data-y") - py) < 20 ? "none" : "" }); });
      /* titre qui suit le doigt */
      const T = titreLecture(M, e, lec, def);
      const hl = (k, v) => { const n = this.q('[data-hl="' + k + '"]'); tc(n, v); };
      hl("k", T.k); hl("v", T.v); hl("s", T.s);
      const hit = this.hit;
      hit.setAttribute("aria-valuenow", String(Math.round(tt / MS_JOUR)));
      hit.setAttribute("aria-valuetext", dMois(tt) + " : " + (lec.valeur == null ? "pas de valeur" : lec.nature === "projete" ? "environ " + fK(lec.valeur) : fEur(lec.valeur)));
      const rl = this.q("[data-roline]"); if (rl) rl.innerHTML = ligneLecture(M, e, lec, def) + (e.reglages.avenirs && gg.hopHors ? " · " + gg.hopHors + " avenirs hors cadre" : "");
      if (this.roEl) this.roEl.innerHTML = lectureHtml(M, e, lec, { def, effacer: true, survol: !!(this.P && this.P.hover) });
      if (this.notesEl) this.notesEl.innerHTML = enteteHtml(M, lec.nature === "projete" ? lec : lecture(M, e, aFinFenetre(M, dom), { demi }));
      /* bande d'épargne : curseur et montant du mois */
      const sx = this.ssvg && this.ssvg.querySelector("[data-sxh]"), sv = this.q("[data-stripv]"), cap = def ? capaciteA(M, M.today) : lec.capacite || capaciteA(M, M.today);
      if (sx && this.bande && !this.bande.vide) {
        if (!def && cap) { const x = gg.X(tt); sx.innerHTML = '<line class="gp-xh-v" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="0" y2="' + this.bande.H + '"/><circle class="gp-dot-ink" cx="' + x.toFixed(1) + '" cy="' + this.bande.Ys(cap.montant).toFixed(1) + '" r="3.5"/>'; } else sx.innerHTML = "";
      }
      if (sv) sv.innerHTML = cap ? "<b>" + esc(fMoisU(cap.montant)) + "</b> " + esc(def ? "aujourd'hui" : "en " + dMois(tt)) + (cap.montant < 0 ? " · négative" : "") : "";
      /* jalons : neutres, colorés seulement à la sélection ; une seule étiquette flottante */
      const sel = this.jalonsAuCurseur().map(j => j.id);
      this.svg.querySelectorAll("[data-ev]").forEach(n => classe(n, "is-sel", String(n.getAttribute("data-ev")).split(" ").some(i => sel.includes(i))));
      this.majEtiquette(def ? null : tt);
      if (this.listEl) this.listEl.querySelectorAll(".gp-evrow").forEach(r => r.setAttribute("aria-current", String(sel.includes(r.getAttribute("data-ev")))));
      if (this.tblEl) { this.tblEl.querySelectorAll("tr.cur").forEach(r => classe(r, "cur", false)); const row = this.tblEl.querySelector('tr[data-t="' + tt + '"]'); if (row) classe(row, "cur", true); }
      this.majAvenir();
    },
    majEtiquette(tt) {
      const fl = this.svg && this.svg.querySelector("[data-flab]"); if (!fl) return;
      const g = this.g, gg = this.geo;
      if (tt == null) { fl.innerHTML = ""; return; }
      const x = gg.X(tt), groupe = plusProcheGroupe(gg.groupes, x, 24);
      if (!groupe) { fl.innerHTML = ""; return; }
      const ts = etiquettesJalon(g.M, groupe), mes = g.mesurer();
      const t = ts.find(z => mes(z, 600) + 18 <= gg.W) || ts[ts.length - 1], w = Math.min(gg.W, mes(t, 600) + 18), lx = clamp(groupe.x - w / 2, gg.L, gg.W - w);
      fl.innerHTML = '<rect class="gp-flab" x="' + F1(lx) + '" y="1" width="' + F1(w) + '" height="21" rx="10.5"/><text x="' + F1(lx + 9) + '" y="16" class="gp-ti" style="font-weight:600">' + esc(t) + "</text>";
    },
    majAvenir() {
      const g = this.g, e = g.etat, M = g.M, gg = this.geo, grp = this.svg.querySelector("[data-hop]"), bar = this.q("[data-hopbar]");
      const F = M.futur;
      if (!e.reglages.avenirs || !F || !F.avenirs) { if (grp) grp.innerHTML = ""; if (bar) bar.hidden = true; return; }
      const dom = g.domaineCourant(), i = e.hopI % F.avenirs.length, a = F.avenirs[i], pts = [];
      F.t.forEach((t, k) => { if (t >= dom.debut - 40 * MS_JOUR && t <= dom.fin + 40 * MS_JOUR && t >= M.today && k % (this.P && this.P.compact ? 3 : 1) === 0) pts.push([gg.X(t), gg.Y(a[k])]); });
      if (grp && pts.length > 1) { const fin = pts[pts.length - 1]; grp.innerHTML = '<path class="gp-hop-hl" d="' + chemin(pts) + '"/><circle class="gp-dot-brand" cx="' + F1(fin[0]) + '" cy="' + F1(fin[1]) + '" r="3.5"/>'; }
      if (bar) {
        const k = Math.max(0, indexAvant(F.t, dom.fin));
        bar.hidden = false;
        bar.innerHTML = '<button type="button" data-act="avenir-lecture">' + (g.reduit() ? "Avenir suivant" : e.hopJoue ? "Pause" : "Lecture") + "</button><span>Avenir n° <b>" + (i + 1) + "</b> sur " + F.avenirs.length + " : <b>≈ " + esc(fK(a[k])) + "</b> en " + esc(dMois(F.t[k])) + ". Chaque point à droite est un avenir possible.</span>";
      }
    },
  });
  /** Fin utile d'une fenêtre : le dernier mois projeté visible (pour « dans 10 ans » et la pastille) ; aujourd'hui sans futur. */
  function aFinFenetre(M, dom) {
    if (!M.futur || dom.fin <= M.today) return Math.min(dom.fin, M.today);
    const i = indexAvant(M.futur.t, dom.fin);
    return M.futur.t[Math.max(0, i)];
  }
  const demiPas = g => (g === "jour" ? 0.5 * MS_JOUR : g === "semaine" ? 3.5 * MS_JOUR : g === "trimestre" ? 46 * MS_JOUR : g === "annee" ? 183 * MS_JOUR : DEMI_PAS_MS);
  /** Besoin vertical d'une fenêtre (mêmes données que construireSvg) : sert à mémoriser l'échelle entre l'aperçu et le résultat complet. */
  function besoinFenetre(M, dom, gran, C) {
    const ech = echantillons(M, dom, gran);
    return besoinY(M, dom, ech, { existant: C.existant, plan: C.plan && C.plan.valeurs, demain: M.demain && M.demain.serie ? M.demain.serie.emprunt : M.demain ? M.demain.empruntable : null });
  }
  /** Résumé pour les lecteurs d'écran : valeur du jour, projection à l'horizon visible, événements. */
  function resumeAccessible(M, dom) {
    const ev = M.jalons.slice(0, 12).map(j => j.titre + " en " + dMois(j.t)).join(", ");
    return phraseTitre(M, aFinFenetre(M, dom)) + (ev ? " Événements : " + ev + "." : "");
  }

  /* ---------- feuilles (UI.panneau), plein écran ---------- */
  Object.assign(Graphe.prototype, {
    majCurseur() { this.vues.forEach(v => v.majCurseur()); },
    avenirSuivant(lecture) {
      const e = this.etat, F = this.M && this.M.futur; if (!F || !F.avenirs) return;
      if (this.reduit() || !lecture) { e.hopI = (e.hopI + 37) % F.avenirs.length; this.vues.forEach(v => v.majAvenir()); return; }
      e.hopJoue = !e.hopJoue;
      if (this.hopT) { clearInterval(this.hopT); this.hopT = null; }
      if (e.hopJoue) this.hopT = setInterval(() => { e.hopI = (e.hopI + 37) % F.avenirs.length; this.vues.forEach(v => v.majAvenir()); }, 900);
      this.vues.forEach(v => v.majAvenir());
    },
    /** Place le curseur sur un jalon (la fenêtre s'élargit si le jalon est hors champ). */
    selectionnerJalon(id) {
      const j = this.M && this.M.jalons.find(x => x.id === id); if (!j) return;
      const d = this.domaineCourant();
      if (j.t < d.debut || j.t > d.fin) {
        this.etat.zoom = null; this.etat.echelleY = null;
        if (j.t < this.domaineBase().debut || j.t > this.domaineBase().fin) this.etat.fenetre = fenetreContenant(this.M.today, j.t);
      }
      this.etat.curseur = j.t; this.rendreTout();
    },
    /** Ouvre une feuille : UI.panneau (modale, focus piégé, Échap) ; les écouteurs du contenu sont posés une fois par élément de corps. */
    feuille(titre, html, retour, gestion, extra) {
      const U = this.UI();
      if (!U || !U.panneau) return null;
      const corps = U.panneau.ouvrir(Object.assign({ titre, contenu: html, retour }, extra || {}));
      if (!corps) return null;
      corps.__gp = gestion || null;
      if (!corps.__gpLie) {
        corps.__gpLie = true;
        const route = ev => { if (corps.__gp) corps.__gp(ev); };
        corps.addEventListener("click", route); corps.addEventListener("change", route); corps.addEventListener("input", route);
      }
      return corps;
    },
    fermerFeuille() { const U = this.UI(); if (U && U.panneau && U.panneau.ouvert()) U.panneau.fermer(); },
    clicSur(ev, sel) { const t = ev.target; return t && t.closest ? t.closest(sel) : null; },
    ouvrirJalon(id, opener) {
      const M = this.M, j = M && M.jalons.find(x => x.id === id); if (!j) return;
      const impact = !estObjectif(j) && j.evenementId && typeof this.o.impactJalon === "function";
      const claude = (q, l) => this.claudeLien(q, l);
      const html = j2 => jalonDetailHtml(M, j, { impact: j2, claude }) +
        '<div class="gp-sh-acts"><button type="button" class="gp-btn" data-go="' + esc(j.id) + '">Voir sur la courbe</button>' +
        (!estObjectif(j) && j.source === "evenement" ? this.claudeLien("Dans Boussole, je veux modifier l'événement « " + j.titre + " » du " + dJour(j.t) + ". Pose-moi les questions utiles et dépose la proposition de changement : je la validerai dans Agent › Propositions.", "Modifier avec Claude")
          : this.claudeLien("Dans Boussole, explique-moi " + (estObjectif(j) ? "où j'en suis de mon objectif « " + j.titre + " » et ce qui pourrait changer la probabilité de l'atteindre" : "ce que change « " + j.titre + " » pour moi") + ".", estObjectif(j) ? "Modifier avec Claude" : "Demander à Claude")) + "</div>";
      this.etat.curseur = j.t; this.majCurseur();
      const corps = this.feuille(j.titre, html(impact ? "calcul" : null), opener, ev => {
        const go = this.clicSur(ev, "[data-go]"); if (go) { this.fermerFeuille(); this.selectionnerJalon(go.dataset.go); }
      });
      if (corps && impact) {
        Promise.resolve(this.o.impactJalon(j)).then(res => {
          const U = this.UI(); if (this.detruit || !U || !U.panneau.ouvert() || corps.__gp == null) return;
          U.panneau.remplacer({ contenu: html(res || null) });
        }).catch(() => { const U = this.UI(); if (U && U.panneau.ouvert()) U.panneau.remplacer({ contenu: html(null) }); });
      }
    },
    ouvrirGroupe(js, opener) {
      const M = this.M, claude = (q, l) => this.claudeLien(q, l);
      this.feuille(js.length + " événements rapprochés", groupeHtml(M, js, { claude }), opener, ev => {
        const go = this.clicSur(ev, "[data-go]"); if (go) { this.fermerFeuille(); this.selectionnerJalon(go.dataset.go); }
      });
    },
    ouvrirJalons(opener) {
      const M = this.M; if (!M) return;
      const dom = this.domaineCourant(), sel = this.vue.jalonsAuCurseur().map(j => j.id), vis = new Set(this.jalonsVisibles().map(j => j.id));
      const Mv = Object.assign({}, M, { jalons: M.jalons.filter(j => vis.has(j.id)) });
      const n = Mv.jalons.length;
      const corps = this.feuille(n === 1 ? "1 jalon" : n + " jalons", jalonsListeHtml(Mv, dom, sel), opener, ev => {
        const j = this.clicSur(ev, "[data-jump]"), d = this.clicSur(ev, "[data-jdet]");
        if (j) { this.fermerFeuille(); this.selectionnerJalon(j.dataset.jump); }
        else if (d) this.ouvrirJalon(d.dataset.jdet, d);
      });
      void corps;
    },
    ouvrirLecture(opener) {
      const M = this.M, vue = this.vue; if (!M || !vue || !vue.lec) return;
      const lec = vue.lec, def = vue.def, dom = this.domaineCourant();
      const html = '<div class="gp-ro gp-ro-feuille">' + lectureHtml(M, this.etat, lec, { def, effacer: false, survol: !!(vue.P && vue.P.hover) }) + "</div>" +
        '<div class="gp-notes">' + enteteHtml(M, lec.nature === "projete" ? lec : lecture(M, this.etat, aFinFenetre(M, dom), { demi: DEMI_PAS_MS })) + "</div>" +
        '<div class="gp-sh-acts"><button type="button" class="gp-btn ghost" data-calcul>Comment c\'est calculé</button>' + (def ? "" : '<button type="button" class="gp-btn ghost" data-effacer>Effacer la lecture</button>') + "</div>";
      const l0 = (this.preset.liensFeuille || [])[0];
      this.feuille("Lecture · " + (lec.t === M.today ? "aujourd'hui" : dMois(lec.t)), html, opener, ev => {
        const jb = this.clicSur(ev, "[data-jalon]"), ca = this.clicSur(ev, "[data-calcul]"), ef = this.clicSur(ev, "[data-effacer]");
        if (jb) this.ouvrirJalon(jb.dataset.jalon, jb); else if (ca) this.ouvrirCalcul(ca); else if (ef) { this.fermerFeuille(); this.etat.curseur = null; this.majCurseur(); }
      }, l0 ? { lien: { href: l0.href, label: l0.libelle } } : {});
    },
    ouvrirEuros(opener) {
      const r = this.etat.reglages, courants = r.euros === "courants";
      this.feuille(courants ? "En euros courants" : "En euros d'aujourd'hui",
        "<p>" + (courants ? "Les montants futurs sont affichés tels qu'ils apparaîtront sur tes relevés, inflation comprise." : "Tous les montants futurs sont corrigés de l'inflation supposée : ils se lisent comme des euros d'aujourd'hui. Le passé est converti avec l'indice des prix de l'Insee.") + "</p>" +
        '<div class="gp-sh-acts"><button type="button" class="gp-btn" data-sw>' + (courants ? "Passer en euros d'aujourd'hui" : "Passer en euros courants") + "</button></div>", opener, ev => {
          if (this.clicSur(ev, "[data-sw]")) { this.fermerFeuille(); this.appliquerReglages({ euros: courants ? "constants" : "courants" }); }
        });
    },
    ouvrirCalcul(opener) {
      const M = this.M; if (!M) return;
      const dom = this.domaineCourant(), gran = granularite(dom.fin - dom.debut, false);
      const html = calculHtml(M, { claude: (q, l) => this.claudeLien(q, l), tableau: tableauHtml(M, dom, gran, { etat: this.etat }) });
      const U = this.UI();
      this.feuille("Comment c'est calculé", html, opener, null, { pied: U && U.demanderAClaude ? U.demanderAClaude("Explique-moi simplement comment Boussole calcule la courbe de mon patrimoine et sa projection, et ce que je dois en retenir.") : "" });
    },
    ouvrirReglages(opener) {
      const M = this.M, r = this.etat.reglages;
      const radio = (nom, val, titre, sous, coche) => '<label class="gp-set-row"><span>' + esc(titre) + (sous ? "<small>" + esc(sous) + "</small>" : "") + '</span><input type="radio" name="' + this.id + nom + '" value="' + esc(val) + '"' + (coche ? " checked" : "") + "></label>";
      const sw = (cle, titre, sous, coche, off) => '<label class="gp-set-row"><span>' + esc(titre) + (sous ? "<small>" + esc(sous) + "</small>" : "") + '</span><input type="checkbox" role="switch" data-set="' + cle + '"' + (coche ? " checked" : "") + (off ? " disabled" : "") + "></label>";
      const capacite = this.preset.mode === "capacite";
      const verrou = !!r.plan;
      let h = "";
      if (!capacite) {
        h += '<fieldset class="gp-set"><legend>Vue</legend>' + radio("vue", "net", "Patrimoine net", "ce que tu possèdes moins ce que tu dois", r.vue === "net") + radio("vue", "financier", "Patrimoine financier", "tes placements et comptes", r.vue === "financier") +
          radio("vue", "disponible", "Patrimoine disponible", "ce que tu peux retirer sans clôturer de plan", r.vue === "disponible") + "</fieldset>";
      }
      h += '<fieldset class="gp-set"><legend>Montants</legend>' + radio("eur", "constants", "En euros d'aujourd'hui", "l'inflation supposée est retirée", r.euros !== "courants") + radio("eur", "courants", "En euros courants", "tels qu'ils apparaîtront sur tes relevés", r.euros === "courants") + "</fieldset>";
      if (capacite) h += '<fieldset class="gp-set"><legend>Durée du prêt</legend>' + radio("duree", "20", "20 ans", "", +r.duree === 20) + radio("duree", "25", "25 ans", "", +r.duree !== 20) + "</fieldset>";
      if (!capacite) {
        h += sw("net_impots", "Net d'impôts", "ce que tu toucherais en retirant tout à chaque date (impôts de sortie de tes enveloppes)", !!r.net_impots, verrou);
        h += sw("existant", "Ton patrimoine actuel, sans nouveau versement", "ce que deviendrait ton patrimoine d'aujourd'hui si tu n'épargnais plus rien", this.couches().existant, verrou);
        if (M && M.variantes.length) h += '<fieldset class="gp-set"><legend>Variante</legend>' + radio("variante", "", "Situation actuelle", "tes événements tels qu'ils sont enregistrés", !r.variante) + M.variantes.map(v => radio("variante", v.id, v.nom, "second tracé, comparé à la situation actuelle", r.variante === v.id)).join("") + "</fieldset>";
        if (M && M.crises.length) {
          h += '<fieldset class="gp-set"><legend>Crise rejouée</legend>' + sw("crise_on", "Rejouer une crise", "un seul scénario, en pointillés, à la date choisie", !!(r.crise && r.crise.on), verrou) +
            '<div class="gp-set-sub"><label class="gp-set-champ"><span>Laquelle</span><select data-crise="cle">' + M.crises.map(c => '<option value="' + esc(c.cle) + '"' + (r.crise && r.crise.cle === c.cle ? " selected" : "") + ">" + esc(c.label) + "</option>").join("") + "</select></label>" +
            '<label class="gp-set-champ"><span>Quand</span><input type="month" data-crise="debut" min="' + esc(M.todayIso.slice(0, 7)) + '" value="' + esc(r.crise && r.crise.debut ? String(r.crise.debut).slice(0, 7) : "") + '"></label></div></fieldset>';
        }
        h += sw("avenirs", "100 avenirs possibles", "des points dans la marge : chacun est un avenir possible, l'échelle ne change pas", !!r.avenirs, verrou);
        h += '<fieldset class="gp-set"><legend>Période libre</legend><div class="gp-set-sub"><label class="gp-set-champ"><span>Du</span><input type="date" data-periode="du" value="' + esc(r.periode ? r.periode.du : "") + '"></label>' +
          '<label class="gp-set-champ"><span>Au</span><input type="date" data-periode="au" value="' + esc(r.periode ? r.periode.au : "") + '"></label></div>' +
          '<div class="gp-sh-acts"><button type="button" class="gp-btn ghost" data-periode-off' + (r.periode ? "" : " disabled") + ">Revenir aux fenêtres</button></div></fieldset>";
        if (M && M.plans.length) h += '<fieldset class="gp-set"><legend>Comparer à un plan</legend>' + radio("plan", "", "Aucun", "passé et projection actuelle seulement", !r.plan) +
          M.plans.map(p => radio("plan", p.id, "Plan du " + dJour(msDe(String(p.cree_le).slice(0, 10))), cap1(RAISONS_PLAN[p.raison] || p.raison) + " · en euros courants, patrimoine net", r.plan === p.id)).join("") + "</fieldset>";
      }
      h += '<div class="gp-sh-acts"><button type="button" class="gp-btn ghost" data-calcul>Comment c\'est calculé</button><button type="button" class="gp-btn ghost" data-plein>Plein écran</button></div>';
      h += '<p class="gp-sh-note">Ces réglages sont locaux : ils ne sont jamais enregistrés.</p>';
      this.feuille("Réglages du graphique", h, opener, ev => {
        const t = ev.target; if (!t) return;
        if (ev.type === "click") {
          if (this.clicSur(ev, "[data-calcul]")) { this.ouvrirCalcul(opener); return; }
          if (this.clicSur(ev, "[data-plein]")) { this.fermerFeuille(); this.ouvrirPlein(opener); return; }
          if (this.clicSur(ev, "[data-periode-off]")) { this.fermerFeuille(); this.appliquerReglages({ periode: null }); this.reinitialiserZoom(); return; }
          return;
        }
        if (ev.type !== "change") return;
        const nom = (t.getAttribute && t.getAttribute("name")) || "", val = t.value;
        if (nom.endsWith("vue")) this.appliquerReglages({ vue: val });
        else if (nom.endsWith("eur")) this.appliquerReglages({ euros: val });
        else if (nom.endsWith("duree")) this.appliquerReglages({ duree: +val });
        else if (nom.endsWith("variante")) this.appliquerReglages({ variante: val || null });
        else if (nom.endsWith("plan")) { this.fermerFeuille(); this.appliquerReglages({ plan: val || null }); }
        else if (t.getAttribute && t.getAttribute("data-set")) {
          const k = t.getAttribute("data-set"), on = !!t.checked;
          if (k === "crise_on") { const c = Object.assign({}, this.etat.reglages.crise, { on }); if (on && !c.cle && M.crises.length) c.cle = M.crises[0].cle; if (on && !c.debut) c.debut = isoDe(Math.max(ajouterMois(M.today, 12), M.today)); this.appliquerReglages({ crise: c }); }
          else if (k === "existant") this.appliquerReglages({ existant: on });
          else this.appliquerReglages({ [k]: on });
        } else if (t.getAttribute && t.getAttribute("data-crise")) {
          const c = Object.assign({}, this.etat.reglages.crise); if (t.getAttribute("data-crise") === "cle") c.cle = val; else c.debut = val ? (val + "-01" < M.todayIso ? M.todayIso : val + "-01") : null;
          this.appliquerReglages({ crise: c });
        } else if (t.getAttribute && t.getAttribute("data-periode")) {
          const p = this.etat.periodeBrouillon = Object.assign({ du: "", au: "" }, this.etat.periodeBrouillon, this.etat.reglages.periode); p[t.getAttribute("data-periode")] = val;
          if (isoOk(p.du) && isoOk(p.au) && p.du < p.au) this.appliquerReglages({ periode: p });
        }
      });
    },
    /* ---------- plein écran ---------- */
    ouvrirPlein(opener) {
      if (this.plein || !this.M) return;
      const doc = this.doc, win = this.win, body = doc.body;
      const ov = doc.createElement("div");
      ov.className = "gp-plein"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Graphe en plein écran"); ov.setAttribute("tabindex", "-1");
      body.appendChild(ov);
      const p = this.plein = { ov, opener: opener || (this.vue && this.vue.q('[data-act="plein"]')) || null, mode: null, vue: null, api: false };
      p.inertes = Array.from(body.children || []).filter(c => c !== ov && !c.inert && !(c.classList && (c.classList.contains("ui-panneau") || c.classList.contains("ui-voile"))));
      p.inertes.forEach(c => { c.inert = true; });
      if (body.classList) body.classList.add("gp-bloque");
      try { const de = doc.documentElement; if (de && typeof de.requestFullscreen === "function") { const r = de.requestFullscreen(); p.api = true; if (r && r.catch) r.catch(() => { p.api = false; }); } } catch (e) { p.api = false; }
      const choisir = () => modePleinEcran(win ? win.innerWidth : 390, win ? win.innerHeight : 800);
      const monter = () => {
        p.mode = choisir();
        if (p.vue) p.vue.detruire();
        p.vue = new Vue(this, ov, { mode: p.mode, plein: true });
        p.vue.render({});
        const h = p.vue.hit; if (h && h.focus) h.focus();
      };
      p.surTaille = () => { if (this.plein === p && choisir() !== p.mode) monter(); };
      p.surTouche = e => {
        if (this.plein !== p) return;
        const U = this.UI(), panneauOuvert = U && U.panneau && U.panneau.ouvert();
        if (e.key === "Escape" && !panneauOuvert) { if (e.preventDefault) e.preventDefault(); this.fermerPlein(); return; }
        if (e.key === "Tab" && !panneauOuvert) this.pieger(e, ov);
      };
      p.surFs = () => { if (this.plein === p && p.api && !doc.fullscreenElement) this.fermerPlein({ api: false }); };
      if (win && win.addEventListener) win.addEventListener("resize", p.surTaille);
      doc.addEventListener("keydown", p.surTouche, true);
      doc.addEventListener("fullscreenchange", p.surFs);
      monter();
    },
    fermerPlein(opt) {
      const p = this.plein; if (!p) return;
      const o = opt || {}, doc = this.doc, win = this.win;
      this.plein = null;
      if (win && win.removeEventListener) win.removeEventListener("resize", p.surTaille);
      doc.removeEventListener("keydown", p.surTouche, true);
      doc.removeEventListener("fullscreenchange", p.surFs);
      if (p.vue) p.vue.detruire();
      p.inertes.forEach(c => { c.inert = false; });
      if (doc.body.classList) doc.body.classList.remove("gp-bloque");
      p.ov.remove();
      try { if (p.api && o.api !== false && doc.fullscreenElement && typeof doc.exitFullscreen === "function") { const r = doc.exitFullscreen(); if (r && r.catch) r.catch(() => {}); } } catch (e) { /* rien */ }
      this.retirerLienProfond();
      this.rendreTout();
      const cible = p.opener && p.opener.isConnected !== false && this.el.contains(p.opener) ? p.opener : this.vue && this.vue.q('[data-act="plein"]');
      if (o.focus !== false && cible && cible.focus) cible.focus();
    },
    /** Piège du focus : Tab et Maj+Tab restent dans la couche. */
    pieger(e, ov) {
      const f = Array.from(ov.querySelectorAll("button,[href],input,select,textarea,[tabindex]")).filter(n => !n.hasAttribute("disabled") && n.getAttribute("tabindex") !== "-1" && !n.hidden && !(n.closest && n.closest("[hidden]")));
      if (!f.length) { if (e.preventDefault) e.preventDefault(); return; }
      const premier = f[0], dernier = f[f.length - 1], actif = this.doc.activeElement;
      if (e.shiftKey && (actif === premier || !ov.contains(actif))) { if (e.preventDefault) e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && (actif === dernier || !ov.contains(actif))) { if (e.preventDefault) e.preventDefault(); premier.focus(); }
    },
    /** Rotation en paysage sur un téléphone : une invitation discrète à ouvrir en grand (jamais de rotation forcée, jamais de fenêtre bloquante). */
    surveillerRotation() {
      const win = this.win; if (!win || this.mq || typeof win.matchMedia !== "function") return;
      try {
        this.mq = win.matchMedia("(orientation: landscape)");
        this.visible = true;
        if (typeof win.IntersectionObserver === "function") { this.io = new win.IntersectionObserver(es => { this.visible = es[0].isIntersecting; }); this.io.observe(this.el); }
        this.mqF = () => { if (this.mq.matches && win.innerHeight < 520 && win.innerWidth >= 600 && this.visible && !this.plein && this.M && this.M.futur) this.proposerPlein(); };
        if (this.mq.addEventListener) this.mq.addEventListener("change", this.mqF);
      } catch (e) { /* pas de détection */ }
    },
    proposerPlein() {
      const doc = this.doc; let o = this.offerEl;
      if (!o) { o = this.offerEl = doc.createElement("div"); o.className = "gp-offre"; o.setAttribute("role", "status"); doc.body.appendChild(o); }
      o.innerHTML = '<span>Le graphique est plus lisible en grand.</span><button type="button" class="go" data-go>Ouvrir en grand</button><button type="button" class="x" data-x aria-label="Fermer">' + ICO.x + "</button>";
      o.hidden = false;
      const go = o.querySelector("[data-go]"), x = o.querySelector("[data-x]");
      go.onclick = () => { o.hidden = true; this.ouvrirPlein(); }; x.onclick = () => { o.hidden = true; };
      clearTimeout(this.offerT); this.offerT = setTimeout(() => { o.hidden = true; }, 8000);
    },
  });


  return { esc, plat, fK, fEur, fSK, fSE, fMois, fMoisU, fPct, kRange, kTiret, chancesTxt, motProba, dureeTxt, relatif, dMois, dJour, FENETRES, domaine, fenetreContenant, granularite, clePas, graduations, domaineY, echelleYStable, valeurCreuse, pointsConnus,
    chemin, bande, cheminInverse, facteurPrix, normaliser, echantillons, besoinY, besoinFenetre, regrouperJalons, plusProcheGroupe, lecture, planA, capaciteA, phraseTitre, titreLecture, ligneLecture, lectureHtml, enteteHtml,
    construireSvg, construireBande, tableauHtml, calculHtml, jalonDetailHtml, jalonsListeHtml, groupeHtml, parametresMode, MODES, PRESETS, msDe, isoDe, ajouterMois, moisEntre, capaciteSourceTxt, decompositionPhrase, objectifLigne,
    etiquettesJalon, modePleinEcran, fenetreDefaut, invitationVisible, planNormalise, resumeAccessible, demiPas, monter, STATUT_OBJ, NATURE, libellesTemps, effetMensuel };
});
