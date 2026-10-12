/* Plan : budget, objectifs, projection et score de santé. Calculs purs, aucun accès au DOM.
   S'appuie sur Calc (calc.js) pour les positions et le profil. */
(function (root, factory) {
  const Calc = typeof module === "object" && module.exports ? require("./calc.js") : root.Calc;
  const api = factory(Calc);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Plan = api;
})(typeof self !== "undefined" ? self : this, function (Calc) {
  const n = v => (isFinite(+v) && v !== null && v !== "" ? +v : 0);
  const pos = v => Math.max(0, n(v));
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const EPS = 1e-9;

  /** Rendements annuels attendus par poche, en % : central, pessimiste, optimiste (indicatifs). */
  const RENDEMENTS = {
    "Monde": { central: 6, pessimiste: 3, optimiste: 8.5 },
    "Europe": { central: 5.5, pessimiste: 2.5, optimiste: 8 },
    "Asie": { central: 6, pessimiste: 2, optimiste: 9 },
    "Nasdaq 2x": { central: 9, pessimiste: -2, optimiste: 16 },
    "Convictions tech": { central: 7, pessimiste: 0, optimiste: 12 },
    "Crypto": { central: 5, pessimiste: -20, optimiste: 25 },
    "SCPI": { central: 4, pessimiste: 2, optimiste: 5 },
    "Protection": { central: 2.5, pessimiste: 1.5, optimiste: 3.5 },
    "Obligations": { central: 3, pessimiste: 1.5, optimiste: 4 },
    "Épargne": { central: 2.4, pessimiste: 1.7, optimiste: 3 },
    "_autre": { central: 4, pessimiste: 1.5, optimiste: 6 },
  };
  /* Alias : les données de démonstration nomment la poche « Convictions ». */
  RENDEMENTS["Convictions"] = RENDEMENTS["Convictions tech"];
  const SCENARIOS = ["central", "pessimiste", "optimiste"];

  /** Repère de patrimoine net, en années de revenus, par tranche d'âge (clés de la toise). */
  const REPERES_AGE = { u30: 0.5, a30: 1, a40: 3, a50: 6, a60: 8, a70: 10 };

  /* ---------- dates (sans fuseau : AAAA-MM-JJ) ---------- */
  function ymd(d) {
    if (d == null) d = new Date();
    if (d instanceof Date) return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
    const s = String(d).slice(0, 10).split("-").map(Number);
    return { y: s[0], m: (s[1] || 1) - 1, d: s[2] || 1 };
  }
  const dernierJour = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const tauxMensuel = tauxAnnuel => Math.pow(1 + n(tauxAnnuel) / 100, 1 / 12) - 1;

  /** Montant mensuel d'une ligne de budget (fréquence « an » ramenée au mois). */
  function mensuel(ligne) {
    const m = pos(ligne && ligne.montant);
    return ligne && ligne.frequence === "an" ? m / 12 : m;
  }

  /* Part d'une ligne de budget dans le périmètre : sans titulaire = commun (moitié pour p1 / p2). */
  const partLigne = (l, scope) => Calc.partCredit(scope, l.owner === "p1" || l.owner === "p2" ? l.owner : "commun");

  /** Totaux mensuels du budget : revenus (profil + lignes), dépenses (lignes + mensualités), épargne, reste, taux d'épargne. */
  function budgetTotaux(lignes, profil, scope) {
    const L = (Array.isArray(lignes) ? lignes : []).filter(Boolean);
    const de = type => L.filter(l => l.type === type);
    const m = l => mensuel(l) * partLigne(l, scope);
    const revenusProfil = Calc.revenusFoyer(profil, scope);
    const revenusLignes = sum(de("revenu"), m);
    const depensesLignes = sum(de("depense"), m);
    const mensualites = Calc.mensualites(profil, scope);
    const epargne = sum(de("epargne"), m);
    const revenus = revenusProfil + revenusLignes;
    const depenses = depensesLignes + mensualites;
    const reste = revenus - depenses - epargne;
    const parCategorie = {};
    de("depense").forEach(l => {
      const c = l.categorie || "Autres";
      parCategorie[c] = (parCategorie[c] || 0) + m(l);
    });
    if (mensualites > 0) parCategorie["Crédits"] = (parCategorie["Crédits"] || 0) + mensualites;
    return {
      revenusProfil, revenusLignes, revenus, depensesLignes, mensualites, depenses, epargne, reste,
      tauxEpargne: revenus > 0 ? (epargne + Math.max(0, reste)) / revenus : null,
      parCategorie,
    };
  }

  /** Versement constant de fin de mois pour passer de « deja » à « cible » en « mois » mois au taux annuel donné (%). */
  function effortMensuel(cible, deja, mois, tauxAnnuel) {
    const c = n(cible), d = n(deja), k = Math.floor(n(mois));
    if (k <= 0) return c > d ? Infinity : 0;
    const r = tauxMensuel(tauxAnnuel);
    if (Math.abs(r) < EPS) return Math.max(0, (c - d) / k);
    const f = Math.pow(1 + r, k);
    return Math.max(0, (c - d * f) * r / (f - 1));
  }

  /** Valeur capitalisée après « mois » mois : capital de départ + versements de fin de mois. */
  function valeurFuture(deja, versement, mois, tauxAnnuel) {
    const d = n(deja), v = n(versement), k = Math.max(0, Math.floor(n(mois)));
    const r = tauxMensuel(tauxAnnuel);
    if (Math.abs(r) < EPS) return d + v * k;
    const f = Math.pow(1 + r, k);
    return d * f + v * (f - 1) / r;
  }

  /** Nombre de mois entiers entre deux dates (arrondi par défaut, jamais négatif ; fin de mois = mois complet). */
  function moisEntre(dateA, dateB) {
    const a = ymd(dateA), b = ymd(dateB);
    let k = (b.y - a.y) * 12 + (b.m - a.m);
    if (b.d < a.d && b.d < dernierJour(b.y, b.m)) k -= 1;
    return Math.max(0, k);
  }

  /** Date (fin du mois) à laquelle la cible est atteinte au rythme donné ; date de départ si déjà atteinte ; null au-delà de 60 ans. */
  function dateAtteinte(cible, deja, versement, tauxAnnuel, depuis) {
    const c = n(cible), v = n(versement), r = tauxMensuel(tauxAnnuel), t = ymd(depuis);
    let val = n(deja);
    if (val >= c - EPS) return iso(t.y, t.m, t.d);
    for (let k = 1; k <= 720; k++) {
      val = val * (1 + r) + v;
      if (val >= c - 1e-6) return iso(t.y, t.m + k, dernierJour(t.y, t.m + k));
    }
    return null;
  }

  /** Montant déjà mis de côté pour un objectif : saisi, ou somme des poches / enveloppes rattachées. */
  function dejaObjectif(obj, positions, scope) {
    if (!obj) return 0;
    if (obj.source !== "poches") return pos(obj.deja);
    const poches = Array.isArray(obj.poches) ? obj.poches : [];
    const env = Array.isArray(obj.enveloppes) ? obj.enveloppes : [];
    const qui = titulaireObjectif(obj);
    return sum((positions || []).filter(p => Calc.inScope(p, scope || "foyer") && Calc.counted(p) && (!qui || p.owner === qui) &&
      (poches.includes(p.bloc) || env.includes(p.envelope))), Calc.val);
  }

  const SCORE_MIN_CRITERES = 3;

  /** Capacité d'épargne mensuelle : épargne prévue + reste positif (même base que le taux d'épargne). */
  const capaciteEpargne = t => t ? pos(t.epargne) + Math.max(0, +t.reste || 0) : 0;

  /** Répartit l'argent des poches entre objectifs, en cascade par priorité : une même ligne ne finance jamais
      deux objectifs à la fois. Renvoie { [id]: montant déjà affecté }. Les objectifs « saisis » gardent leur montant. */
  function affecterDeja(objectifs, positions, scope) {
    const reste = (positions || []).filter(p => Calc.inScope(p, scope || "foyer") && Calc.counted(p)).map(p => ({ p, v: Calc.val(p) }));
    const ordre = (objectifs || []).slice().sort((a, b) =>
      ((a.priorite ?? Infinity) - (b.priorite ?? Infinity)) || String(dateCible(a) || "9999").localeCompare(String(dateCible(b) || "9999")));
    const out = {};
    ordre.forEach(o => {
      if (o.source !== "poches") { out[o.id] = pos(o.deja); return; }
      const poches = Array.isArray(o.poches) ? o.poches : [], env = Array.isArray(o.enveloppes) ? o.enveloppes : [], qui = titulaireObjectif(o);
      let besoin = pos(o.cible), pris = 0;
      reste.forEach(r => {
        if (besoin <= 0 || r.v <= 0 || !(poches.includes(r.p.bloc) || env.includes(r.p.envelope)) || (qui && r.p.owner !== qui)) return;
        const t = Math.min(r.v, besoin); r.v -= t; besoin -= t; pris += t;
      });
      out[o.id] = Math.round(pris * 100) / 100;
    });
    return out;
  }

  /** Personne d'un objectif (titulaire, owner ou personne : p1 / p2), ou null pour le foyer (spec cp4 § 1 : l'apport de Camille
      ne compte que les lignes de Camille). Même règle dans le connecteur (titulaireObjectif, index.ts). */
  const titulaireObjectif = o => { const v = o && (o.titulaire || o.owner || o.personne); return v === "p1" || v === "p2" ? v : null; };

  /* Date cible d'un objectif : forme du store (dateCible) ou colonne SQL (date_cible). */
  const dateCible = o => o.dateCible || o.date_cible || null;

  /* Effort mensuel requis pour un objectif à une date donnée (0 si pas de date). */
  function effortObjectif(obj, deja, today) {
    if (!dateCible(obj)) return { mois: null, effort: 0 };
    const mois = moisEntre(today, dateCible(obj));
    return { mois, effort: effortMensuel(pos(obj.cible), deja, mois, obj.rendement) };
  }
  const datePassee = (date, today) => {
    const a = ymd(date), b = ymd(today);
    return iso(a.y, a.m, a.d) < iso(b.y, b.m, b.d);
  };

  /** Situation d'un objectif : progression, effort requis, date d'atteinte au versement alloué, statut. */
  function statutObjectif(obj, ctx) {
    const c = ctx || {}, today = c.today == null ? new Date() : c.today;
    const cible = pos(obj.cible);
    const deja = c.deja != null ? pos(c.deja) : dejaObjectif(obj, c.positions, c.scope);
    const versementAlloue = pos(c.versementAlloue);
    const { mois, effort } = effortObjectif(obj, deja, today);
    const atteinte = dateAtteinte(cible, deja, versementAlloue, obj.rendement, today);
    const date = dateCible(obj);
    let statut;
    if (deja >= cible) statut = "atteint";
    else if (date && (datePassee(date, today) || !isFinite(effort))) statut = "hors_portee";
    else if (!date) statut = atteinte ? "dans_les_temps" : "hors_portee";
    else if (effort <= 0 || versementAlloue >= 1.1 * effort - EPS) statut = "avance";
    else if (versementAlloue >= 0.95 * effort - EPS) statut = "dans_les_temps";
    else statut = "retard";
    return { deja, progression: cible > 0 ? Math.min(1, deja / cible) : 1, mois, effort, versementAlloue, atteinte, statut };
  }

  /** Répartit l'épargne mensuelle entre objectifs : priorité croissante, puis échéance la plus proche ; le surplus va au dernier objectif en cours. */
  function repartirEpargne(objectifs, epargneMensuelle, ctx) {
    const c = ctx || {}, today = c.today == null ? new Date() : c.today;
    const cle = o => (dateCible(o) ? String(dateCible(o)).slice(0, 10) : "9999-12-31");
    const liste = (objectifs || []).map((o, i) => {
      const deja = dejaObjectif(o, c.positions, c.scope);
      return { o, i, effort: deja >= pos(o.cible) ? 0 : effortObjectif(o, deja, today).effort };
    }).sort((a, b) => (n(a.o.priorite ?? Infinity) - n(b.o.priorite ?? Infinity)) ||
      (cle(a.o) < cle(b.o) ? -1 : cle(a.o) > cle(b.o) ? 1 : 0) || a.i - b.i);
    const out = {};
    let reste = pos(epargneMensuelle);
    liste.forEach(x => {
      const m = Math.min(x.effort, reste);
      out[x.o.id] = m;
      reste -= m;
    });
    if (reste > 0 && liste.length) {
      const enCours = liste.filter(x => x.effort > 0);
      const dernier = (enCours.length ? enCours : liste)[(enCours.length ? enCours : liste).length - 1];
      out[dernier.o.id] += reste;
    }
    return out;
  }

  /** Projection du patrimoine financier sur N années, trois scénarios, versement réparti comme le portefeuille actuel. */
  function projection(opts) {
    const o = opts || {}, scope = o.scope || "foyer", R = o.rendements || RENDEMENTS;
    const N = Math.max(0, Math.floor(o.annees == null ? 30 : n(o.annees)));
    const versement = n(o.versementMensuel);
    const capital = {};
    (o.positions || []).filter(p => Calc.inScope(p, scope) && Calc.counted(p)).forEach(p => {
      const b = p.bloc || "_autre";
      capital[b] = (capital[b] || 0) + Calc.val(p);
    });
    const total = sum(Object.values(capital), pos);
    if (total <= 0) capital._autre = capital._autre || 0;
    const blocs = Object.keys(capital);
    const poids = b => (total > 0 ? pos(capital[b]) / total : b === "_autre" ? 1 : 0);
    const taux = b => R[b] || R._autre || RENDEMENTS._autre;

    const res = { annees: Array.from({ length: N + 1 }, (_, i) => i), parBloc: {} };
    SCENARIOS.forEach(s => { res[s] = new Array(N + 1).fill(0); });
    blocs.forEach(b => {
      const pb = { capital: capital[b], poids: poids(b) };
      SCENARIOS.forEach(s => {
        const r = tauxMensuel(taux(b)[s]), v = versement * pb.poids, serie = [];
        let val = capital[b];
        serie.push(val);
        for (let k = 1; k <= N * 12; k++) {
          val = val * (1 + r) + v;
          if (k % 12 === 0) serie.push(val);
        }
        serie.forEach((x, i) => { res[s][i] += x; });
        pb[s] = serie.map(Math.round);
      });
      res.parBloc[b] = pb;
    });
    SCENARIOS.forEach(s => { res[s] = res[s].map(Math.round); });
    return res;
  }

  /* ---------- score de santé ---------- */
  /* Interpolation linéaire par morceaux, bornée aux extrémités. */
  function interp(x, pts) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return pts[pts.length - 1][1];
  }
  function fr(x, dec) {
    const s = Math.abs(x).toFixed(dec == null ? 1 : dec).replace(/\.0+$/, "").replace(".", ",");
    return (x < 0 ? "−" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  const pct = x => fr(x * 100, 0) + " %";

  /* ---------- contrat de critère (spec cp4 § 3) ----------
     Chaque critère garde ses champs (cle, titre, points, sur, valeur, cible, texte, piste, aCompleter) et reçoit :
       libelle, max (20), statut (bon · surveiller · travailler · a_completer ; « information » pour un critère informatif),
       points null quand il est à compléter, mesure { valeur, unite, texte }, repere { texte, zones: [{ jusqua, statut }] },
       pourquoi, calcul (étapes avec les chiffres), donnees [{ libelle, valeur, lien? ({ ligne } ou { enveloppe }) }],
       ameliorer [{ action, gain_points }] (gain obtenu en rejouant le barème), manque, source_donnees, confiance
       (complete · partielle · absente). Mêmes fonctions et mêmes textes dans le connecteur (index.ts), parité testée. */
  /* Formats des explications (identiques à pratiques.js et au connecteur) : zéros finaux retirés, milliers séparés par une espace. */
  function frc(x, dec) {
    const s = Math.abs(x).toFixed(dec == null ? 1 : dec).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(".", ",");
    return (x < 0 ? "−" : "") + s.replace(/^(\d+)/, m => m.replace(/\B(?=(\d{3})+(?!\d))/g, " "));
  }
  const pctc = (x, dec) => frc(x * 100, dec == null ? 0 : dec) + " %";
  const eurc = x => frc(Math.round(x), 0) + " €";
  const r1 = x => Math.round(x * 10) / 10;
  const r2 = x => Math.round(x * 100) / 100;

  /** Statut d'une note sur 20 : 16 et plus bon, 10 et plus à surveiller, en dessous à travailler ; null : à compléter. */
  function statutDe(points) {
    if (points == null || !isFinite(+points)) return "a_completer";
    return points >= 16 ? "bon" : points >= 10 ? "surveiller" : "travailler";
  }
  const STATUTS_LABELS = { bon: "bon", surveiller: "à surveiller", travailler: "à travailler", a_completer: "à compléter", information: "information" };

  /** Zones d'une jauge : statut de la note (arrondie) le long de la mesure, de min à max (même unité que mesure.valeur).
      Frontières trouvées par dichotomie, à 0,01 près ; la dernière zone n'a pas de borne (jusqua null). */
  function zones(f, min, max) {
    const st = x => statutDe(Math.round(f(x))), N = 600, out = [];
    let prev = st(min), xa = min;
    for (let i = 1; i <= N; i++) {
      const x = min + (max - min) * i / N, s = st(x);
      if (s !== prev) {
        let a = xa, b = x;
        for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (st(m) === prev) a = m; else b = m; }
        out.push({ jusqua: r2(a), statut: prev });
        prev = s;
      }
      xa = x;
    }
    out.push({ jusqua: null, statut: prev });
    return out;
  }
  /** Points gagnés si la mesure passait à x (barème rejoué, notes arrondies), jamais négatif. */
  const gain = (f, x, points) => Math.max(0, Math.round(f(x)) - (points || 0));

  /** Barèmes du score (points sur 20), en fonction de la mesure dans son unité d'affichage. */
  const BAREMES = {
    matelas: mois => (mois < 1 ? 0 : mois < 3 ? interp(mois, [[1, 5], [3, 15]]) : mois <= 6 ? 20 : interp(mois, [[6, 20], [12, 15]])),
    epargne: tauxPct => interp(tauxPct, [[0, 0], [5, 6], [10, 12], [15, 16], [20, 20]]),
    endettement: tauxPct => interp(tauxPct, [[25, 20], [35, 12], [45, 0]]),
    concentration: (maxPct, nb) => Math.max(0, interp(maxPct, [[10, 20], [20, 14], [40, 0]]) - (nb < 3 ? 5 : 0)),
    patrimoine: ratio => clamp(ratio, 0, 1) * 20,
  };
  const REPERES = {
    matelas: "3 à 6 mois de dépenses : 20/20 ; de 1 à 3 mois : de 5 à 15 ; moins d'un mois : 0 ; au-delà de 6 mois, la note redescend jusqu'à 15 à 12 mois.",
    epargne: "0 % des revenus : 0 ; 5 % : 6 ; 10 % : 12 ; 15 % : 16 ; 20 % ou plus : 20 (linéaire entre ces repères).",
    endettement: "25 % des revenus ou moins : 20 ; 35 % (plafond appliqué par les banques) : 12 ; 45 % ou plus : 0 (linéaire entre ces repères).",
    concentration: "plus grosse ligne à 10 % du financier ou moins : 20 ; 20 % : 14 ; 40 % ou plus : 0 ; 5 points de moins sous 3 poches.",
    patrimoine: "au niveau du repère de ta tranche d'âge (en années de revenus) : 20 ; proportionnel en dessous.",
  };

  /** Ajoute les champs du contrat à un critère (objet modifié et renvoyé). ex : explications (mesure, repere, pourquoi, calcul,
      donnees, ameliorer, manque, source_donnees, confiance). Un critère à compléter a des points null ; un informatif aussi. */
  function contrat(c, ex) {
    const e = ex || {}, ac = !!c.aCompleter, info = !!c.informatif;
    const points = ac || info || c.points == null ? null : c.points;
    return Object.assign(c, {
      libelle: c.titre, max: info ? null : 20, points,
      statut: info ? "information" : ac ? "a_completer" : statutDe(points),
      mesure: e.mesure || null, repere: e.repere || null, pourquoi: e.pourquoi || "", calcul: e.calcul || [], donnees: e.donnees || [],
      ameliorer: e.ameliorer || [], manque: e.manque || [], source_donnees: e.source_donnees || null,
      confiance: e.confiance || (ac ? "absente" : "complete"),
    });
  }
  const sourceBudget = (source, periode) => (source === "reel" ? "réel" + (periode ? ", " + periode : "") : "budget prévu");

  /** Matelas. o = { mois (ou null), total, epargne, courants, courantsAuDela, reserveMois, reserve, depenses, source, periode,
      avecCourants (faux pour Plan.score : seule la poche Épargne compte), donnees, points }. */
  function expliqueMatelas(o) {
    const f = BAREMES.matelas, repere = { texte: REPERES.matelas, zones: zones(f, 0, 15) };
    if (o.mois == null) return { repere, donnees: o.donnees || [], confiance: "absente",
      pourquoi: "Pas de note : il faut tes dépenses mensuelles pour savoir combien de mois ta réserve couvre.",
      manque: ["Tes dépenses mensuelles (budget, ou banque connectée)"],
      ameliorer: [{ action: "Donne tes dépenses mensuelles à Claude (ou connecte ta banque) pour mesurer ta réserve.", gain_points: null }] };
    const mois = o.mois, pts = o.points, dep = o.depenses;
    const calcul = [o.avecCourants ? "Épargne disponible (livrets, comptes d'épargne) : " + eurc(o.epargne) : "Poche Épargne : " + eurc(o.epargne)];
    if (o.avecCourants) calcul.push("Comptes courants : " + eurc(o.courants) + " ; une réserve de fonctionnement de " + frc(o.reserveMois) +
      " mois de dépenses (" + eurc(o.reserve) + ") y reste pour les dépenses courantes, seul l'excédent compte : " + eurc(o.courantsAuDela));
    calcul.push("Matelas : " + eurc(o.total), "Dépenses mensuelles (" + sourceBudget(o.source, o.periode) + ") : " + eurc(dep),
      eurc(o.total) + " ÷ " + eurc(dep) + " = " + frc(mois) + " mois", "Barème : " + frc(mois) + " mois → " + pts + "/20");
    const ameliorer = [];
    if (mois < 3) ameliorer.push({ action: "Porte ton matelas à 3 mois de dépenses (≈ +" + eurc((3 - mois) * dep) + ") sur une épargne disponible à tout moment.", gain_points: gain(f, 3, pts) });
    else if (mois > 6) ameliorer.push({ action: "Garde 6 mois de dépenses de côté et affecte l'excédent (≈ " + eurc((mois - 6) * dep) + ") à l'un de tes objectifs.", gain_points: gain(f, 6, pts) });
    return { repere, calcul, ameliorer, donnees: o.donnees || [], source_donnees: sourceBudget(o.source, o.periode), confiance: "complete",
      mesure: { valeur: r1(mois), unite: "mois", texte: frc(mois) + " mois de dépenses" },
      pourquoi: mois < 1 ? "Ta réserve couvre moins d'un mois de dépenses : un imprévu t'obligerait à vendre ou à emprunter."
        : mois < 3 ? "Ta réserve couvre " + frc(mois) + " mois de dépenses, sous le repère de 3 mois."
        : mois <= 6 ? "Ta réserve couvre " + frc(mois) + " mois de dépenses, dans le repère de 3 à 6 mois."
        : "Ta réserve couvre " + frc(mois) + " mois de dépenses : au-delà de 6 mois, une partie pourrait servir un objectif." };
  }

  /** Taux d'épargne. o = { taux (fraction ou null), revenus, epargne (mensuelle), reste (prévu), source, periode, points, manque? }. */
  function expliqueEpargne(o) {
    const f = BAREMES.epargne, repere = { texte: REPERES.epargne, zones: zones(f, 0, 30) };
    if (o.taux == null) return { repere, confiance: "absente",
      pourquoi: "Pas de note : il faut tes revenus et tes dépenses (ou ton épargne) pour calculer ton taux d'épargne.",
      manque: o.manque || ["Tes revenus et tes dépenses mensuels (budget, ou banque connectée)"],
      ameliorer: [{ action: "Donne tes revenus et tes dépenses à Claude (ou connecte ta banque) pour calculer ton taux d'épargne.", gain_points: null }] };
    const t = o.taux, pts = o.points, src = sourceBudget(o.source, o.periode);
    const calcul = o.source === "reel"
      ? ["Revenus moyens (" + src + ") : " + eurc(o.revenus) + " par mois",
        "Épargne versée (virements vers l'épargne et les placements) : " + eurc(o.epargne) + " par mois",
        eurc(o.epargne) + " ÷ " + eurc(o.revenus) + " = " + pctc(t, 1)]
      : ["Revenus du budget : " + eurc(o.revenus) + " par mois", "Épargne prévue : " + eurc(o.epargne) + " par mois",
        "Reste du mois (revenus − dépenses − épargne), compté s'il est positif : " + eurc(Math.max(0, o.reste || 0)),
        "(" + eurc(o.epargne) + " + " + eurc(Math.max(0, o.reste || 0)) + ") ÷ " + eurc(o.revenus) + " = " + pctc(t, 1)];
    calcul.push("Barème : " + pctc(t, 1) + " → " + pts + "/20");
    const ameliorer = [15, 20].filter(c => t * 100 < c).map(c => ({
      action: "Mets de côté " + eurc((c / 100 - t) * o.revenus) + " de plus par mois pour atteindre " + c + " % de tes revenus.", gain_points: gain(f, c, pts) }));
    return { repere, calcul, ameliorer: ameliorer.slice(0, 2), donnees: o.donnees || [], source_donnees: src, confiance: "complete",
      mesure: { valeur: r1(t * 100), unite: "%", texte: pctc(t, 1) + " des revenus" },
      pourquoi: "Tu mets de côté " + pctc(t, 1) + " de tes revenus (" + src + "), " + (t >= 0.15 ? "au-dessus du" : "sous le") + " repère de 15 %." };
  }

  /** Endettement. o = { taux (ou null), revenus, mensualites, donnees, points }. */
  function expliqueEndettement(o) {
    const f = BAREMES.endettement, repere = { texte: REPERES.endettement, zones: zones(f, 0, 60) };
    if (o.taux == null) return { repere, confiance: "absente", pourquoi: "Pas de note : il faut tes revenus pour calculer ton taux d'endettement.",
      manque: ["Tes revenus mensuels"], ameliorer: [{ action: "Donne tes revenus à Claude pour calculer ton taux d'endettement.", gain_points: null }] };
    const t = o.taux, pts = o.points;
    const ameliorer = t > 0.35 ? [{ action: "Ramène tes mensualités à 35 % de tes revenus (≈ −" + eurc((t - 0.35) * o.revenus) + " par mois, par remboursement anticipé ou renégociation).",
      gain_points: gain(f, 35, pts) }] : t > 0.25 ? [{ action: "Sous 25 % de tes revenus (≈ −" + eurc((t - 0.25) * o.revenus) + " de mensualités), la note est pleine.", gain_points: gain(f, 25, pts) }] : [];
    return { repere, ameliorer, donnees: o.donnees || [], source_donnees: "profil (crédits et biens)", confiance: "complete",
      calcul: ["Mensualités de crédit : " + eurc(o.mensualites) + " par mois", "Revenus : " + eurc(o.revenus) + " par mois",
        eurc(o.mensualites) + " ÷ " + eurc(o.revenus) + " = " + pctc(t, 1), "Barème : " + pctc(t, 1) + " → " + pts + "/20"],
      mesure: { valeur: r1(t * 100), unite: "%", texte: pctc(t, 1) + " des revenus" },
      pourquoi: o.mensualites > 0 ? "Tes crédits prennent " + pctc(t, 1) + " de tes revenus, " + (t <= 0.35 ? "sous le" : "au-dessus du") + " plafond de 35 %."
        : "Tu n'as aucune mensualité de crédit en cours." };
  }

  /** Diversification. o = { lignes [{ id, nom, valeur }] triées (plus grosses d'abord), total, nb (poches), points }. */
  function expliqueConcentration(o) {
    const nb = o.nb || 0, f = x => BAREMES.concentration(x, nb), repere = { texte: REPERES.concentration, zones: zones(f, 0, 60) };
    if (!(o.total > 0)) return { repere, confiance: "absente", pourquoi: "Pas de note : aucun placement enregistré.",
      manque: ["Tes placements (lignes et montants)"], ameliorer: [{ action: "Complète tes placements avec Claude pour mesurer leur diversification.", gain_points: null }] };
    const L = o.lignes || [], top = L[0], max = top.valeur / o.total, pts = o.points;
    const ameliorer = [];
    const second = L[1] ? L[1].valeur / o.total : 0, cibleMax = max > 0.2 ? 0.2 : 0.1;
    if (max > 0.1) ameliorer.push({ action: "Ramène « " + top.nom + " » à " + (cibleMax * 100) + " % du financier (≈ " + eurc(top.valeur - cibleMax * o.total) + " à répartir sur d'autres lignes).",
      gain_points: gain(f, Math.max(cibleMax, second) * 100, pts) });
    if (nb < 3) ameliorer.push({ action: "Répartis ton financier sur au moins 3 poches (tu en as " + nb + ").", gain_points: gain(x => BAREMES.concentration(x, 3), max * 100, pts) });
    return { repere, ameliorer, source_donnees: "placements", confiance: "complete",
      donnees: L.slice(0, 5).map(l => ({ libelle: l.nom, valeur: r2(l.valeur), poids_pct: r1(l.valeur / o.total * 100), lien: { ligne: l.id } })),
      calcul: ["Financier compté : " + eurc(o.total), "Plus grosse ligne : « " + top.nom + " », " + eurc(top.valeur),
        eurc(top.valeur) + " ÷ " + eurc(o.total) + " = " + pctc(max, 1), "Poches différentes : " + nb + (nb < 3 ? " (moins de 3 : 5 points de moins)" : ""),
        "Barème : " + pctc(max, 1) + (nb < 3 ? ", " + nb + " poche" + (nb > 1 ? "s" : "") : "") + " → " + pts + "/20"],
      mesure: { valeur: r1(max * 100), unite: "%", texte: "plus grosse ligne : " + pctc(max, 1) + " du financier" },
      pourquoi: "« " + top.nom + " » pèse " + pctc(max, 1) + " du financier" + (max <= 0.2 ? ", sous le repère de 20 %" : ", au-dessus du repère de 20 %") +
        (nb < 3 ? ", réparti sur seulement " + nb + " poche" + (nb > 1 ? "s" : "") + "." : ".") };
  }

  /** Patrimoine net (Plan.score seulement). o = { annees, repere, net, revenus, points, manque? }. */
  function expliquePatrimoine(o) {
    const f = r => BAREMES.patrimoine(r), repere = { texte: REPERES.patrimoine, zones: zones(f, 0, 1.5) };
    if (o.annees == null) return { repere, confiance: "absente", pourquoi: "Pas de note : il faut ta tranche d'âge et tes revenus pour situer ton patrimoine.",
      manque: o.manque || [], ameliorer: [{ action: "Donne ta tranche d'âge et tes revenus à Claude pour situer ton patrimoine.", gain_points: null }] };
    const ratio = o.annees / o.repere, pts = o.points;
    return { repere: { texte: REPERES.patrimoine + " Repère à ton âge : " + frc(o.repere) + " année" + (o.repere > 1 ? "s" : "") + " de revenus.", zones: repere.zones },
      source_donnees: "bilan et profil", confiance: "complete",
      calcul: ["Patrimoine net : " + eurc(o.net), "Revenus annuels : " + eurc(o.revenus * 12), eurc(o.net) + " ÷ " + eurc(o.revenus * 12) + " = " + frc(Math.max(0, o.annees)) + " année(s) de revenus",
        "Repère à ton âge : " + frc(o.repere) + " ; " + frc(Math.max(0, o.annees)) + " ÷ " + frc(o.repere) + " = " + pctc(clamp(ratio, 0, 1)) + " du repère → " + pts + "/20"],
      ameliorer: ratio < 1 ? [{ action: "Atteindre le repère de ton âge : patrimoine net de " + eurc(o.repere * o.revenus * 12) + " (≈ +" + eurc(o.repere * o.revenus * 12 - o.net) + "), par l'épargne régulière et le remboursement des crédits.",
        gain_points: gain(f, 1, pts) }] : [],
      mesure: { valeur: r1(ratio * 100), unite: "% du repère", texte: frc(Math.max(0, o.annees)) + " année(s) de revenus" },
      pourquoi: ratio >= 1 ? "Ton patrimoine net atteint le repère de ta tranche d'âge." : "Ton patrimoine net représente " + pctc(clamp(ratio, 0, 1)) + " du repère de ta tranche d'âge." };
  }

  function itemMatelas(positions, scope, totaux, config) {
    const L = (positions || []).filter(p => Calc.inScope(p, scope) && Calc.counted(p) && p.bloc === "Épargne");
    const epargne = sum(L, Calc.val);
    const m = Calc.matelas(config);
    const depenses = totaux.depensesLignes > 0 ? totaux.depenses : m && m.mode === "months" && m.depenses > 0 ? m.depenses : 0;
    const base = { cle: "matelas", titre: "Matelas de précaution", cible: "3 à 6 mois de dépenses" };
    const donnees = L.map(p => ({ libelle: p.name || p.envelope || "Épargne", valeur: r2(Calc.val(p)), lien: p.id ? { ligne: p.id } : { enveloppe: p.envelope } }));
    if (depenses <= 0) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Dépenses mensuelles inconnues.", piste: "Donne tes dépenses à Claude pour mesurer ta réserve." }, expliqueMatelas({ mois: null, donnees }));
    const mois = epargne / depenses;
    const points = Math.round(BAREMES.matelas(mois));
    const piste = mois < 3 ? "Vise 3 à 6 mois de dépenses sur une épargne disponible à tout moment, pour absorber un imprévu sans vendre ni emprunter."
      : mois <= 6 ? "Ta réserve couvre les imprévus courants : rien à changer de ce côté."
      : mois <= 12 ? "Au-delà de 6 mois, une partie de cette réserve pourrait être affectée à l'un de tes objectifs."
      : "Plus d'un an de dépenses dort sur des supports peu rémunérés : regarde si une partie peut servir tes objectifs.";
    return contrat({ ...base, valeur: mois, points, aCompleter: false, texte: fr(mois) + " mois de dépenses de côté.", piste },
      expliqueMatelas({ mois, total: epargne, epargne, depenses, source: "prevu", avecCourants: false, donnees, points }));
  }

  function itemEpargne(totaux) {
    const base = { cle: "epargne", titre: "Taux d'épargne", cible: "15 % des revenus ou plus" };
    if (!(totaux.revenus > 0) || (totaux.depensesLignes <= 0 && totaux.epargne <= 0)) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Budget incomplet.", piste: "Donne tes revenus et tes dépenses à Claude pour calculer ton taux d'épargne." }, expliqueEpargne({ taux: null }));
    const t = totaux.tauxEpargne;
    const points = Math.round(BAREMES.epargne(t * 100));
    const piste = t >= 0.15 ? "Tu es au-dessus du repère de 15 % : de quoi alimenter tes objectifs régulièrement."
      : "Le repère courant est de 15 % des revenus. Les postes les plus lourds du budget sont le premier endroit où regarder.";
    return contrat({ ...base, valeur: t, points, aCompleter: false, texte: "Tu mets de côté " + pct(t) + " de tes revenus.", piste },
      expliqueEpargne({ taux: t, revenus: totaux.revenus, epargne: totaux.epargne, reste: totaux.reste, source: "prevu", points,
        donnees: [{ libelle: "Revenus mensuels", valeur: r2(totaux.revenus) }, { libelle: "Dépenses mensuelles", valeur: r2(totaux.depenses) }, { libelle: "Épargne prévue", valeur: r2(totaux.epargne) }] }));
  }

  /* Crédits et biens à mensualité du périmètre : données de l'endettement. */
  function lignesCredits(profil, scope) {
    const pr = profil || {};
    return [...(Array.isArray(pr.biens) ? pr.biens : []).filter(b => pos(b.mensualite) > 0).map(b => ({ libelle: (b.nom || "Bien") + " (mensualité)", valeur: r2(pos(b.mensualite) * Calc.part(scope, b.part_p1)) })),
      ...(Array.isArray(pr.credits) ? pr.credits : []).filter(c => pos(c.mensualite) > 0).map(c => ({ libelle: (c.nom || "Crédit") + " (mensualité)", valeur: r2(pos(c.mensualite) * Calc.partCredit(scope, c.owner)) }))]
      .filter(x => x.valeur > 0);
  }

  function itemEndettement(totaux, profil, scope) {
    const base = { cle: "endettement", titre: "Taux d'endettement", cible: "35 % des revenus au plus" };
    if (!(totaux.revenus > 0)) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Revenus inconnus.", piste: "Donne tes revenus à Claude pour calculer ton taux d'endettement." }, expliqueEndettement({ taux: null }));
    const t = totaux.mensualites / totaux.revenus;
    const points = Math.round(BAREMES.endettement(t * 100));
    const texte = totaux.mensualites > 0 ? "Tes crédits représentent " + pct(t) + " de tes revenus." : "Aucune mensualité de crédit en cours.";
    const piste = t <= 0.35 ? "Tu restes sous le plafond de 35 % appliqué par les banques (norme HCSF)."
      : "Au-delà de 35 %, les banques prêtent difficilement (norme HCSF). Un remboursement anticipé ou une renégociation peuvent alléger la charge.";
    return contrat({ ...base, valeur: t, points, aCompleter: false, texte, piste },
      expliqueEndettement({ taux: t, revenus: totaux.revenus, mensualites: totaux.mensualites, points, donnees: lignesCredits(profil, scope) }));
  }

  function itemConcentration(positions, scope) {
    const base = { cle: "concentration", titre: "Diversification", cible: "aucune ligne au-delà de 20 %, au moins 3 poches" };
    const L = (positions || []).filter(p => Calc.inScope(p, scope) && Calc.counted(p) && Calc.val(p) > 0);
    const F = sum(L, Calc.val);
    if (F <= 0) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Aucun placement enregistré.", piste: "Complète tes placements avec Claude pour mesurer leur diversification." }, expliqueConcentration({ total: 0 }));
    const max = Math.max(...L.map(Calc.val)) / F;
    const nb = new Set(L.map(p => p.bloc || "_autre")).size;
    const points = Math.round(BAREMES.concentration(max * 100, nb));
    const texte = "La plus grosse ligne pèse " + pct(max) + " du financier, réparti sur " + nb + (nb > 1 ? " poches." : " poche.");
    const piste = max <= 0.2 && nb >= 3 ? "Ton financier est bien réparti : aucune ligne ne domine."
      : "Repère : aucune ligne au-delà de 20 % du financier et au moins 3 poches, pour qu'un seul support ne pèse pas sur l'ensemble.";
    const lignes = L.map(p => ({ id: p.id, nom: p.name || p.bloc || "Ligne", valeur: Calc.val(p) })).sort((a, b) => b.valeur - a.valeur);
    return contrat({ ...base, valeur: max, points, aCompleter: false, texte, piste }, expliqueConcentration({ lignes, total: F, nb, points }));
  }

  function itemPatrimoine(positions, profil, scope, totaux) {
    const age = profil && profil.foyer && profil.foyer.age;
    const repere = REPERES_AGE[age];
    const base = { cle: "patrimoine", titre: "Patrimoine net", cible: repere ? fr(repere) + " année" + (repere > 1 ? "s" : "") + " de revenus" : "selon l'âge" };
    if (!repere) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Âge non renseigné.", piste: "Donne ta tranche d'âge à Claude pour comparer ton patrimoine au repère." }, expliquePatrimoine({ annees: null, manque: ["Ta tranche d'âge"] }));
    if (!(totaux.revenus > 0)) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Revenus inconnus.", piste: "Donne tes revenus à Claude pour situer ton patrimoine." }, expliquePatrimoine({ annees: null, manque: ["Tes revenus mensuels"] }));
    const net = Calc.patrimoine(positions, profil, scope).net;
    const annees = net / (totaux.revenus * 12);
    const points = Math.round(clamp(annees / repere, 0, 1) * 20); // BAREMES.patrimoine
    const texte = "Patrimoine net : " + fr(Math.max(annees, 0)) + " année" + (annees >= 2 ? "s" : "") + " de revenus (repère à ton âge : " + fr(repere) + ").";
    const piste = annees >= repere ? "Tu es au niveau du repère de ta tranche d'âge."
      : "Le patrimoine se construit surtout par l'épargne régulière et le remboursement des crédits ; tes objectifs (Patrimoine › Objectifs) en donnent le rythme.";
    return contrat({ ...base, valeur: annees, points, aCompleter: false, texte, piste }, expliquePatrimoine({ annees, repere, net, revenus: totaux.revenus, points }));
  }

  /** Seuil de couverture sous lequel une note globale est « provisoire » (spec cp4 § 1). */
  const SEUIL_PROVISOIRE = 0.6;
  const notes = L => L.filter(c => c && !c.aCompleter && !c.informatif && c.points != null);
  /** Texte de couverture : « calculée sur 3 critères sur 5 ». */
  const texteCouverture = (k, n) => "calculée sur " + k + " critère" + (k > 1 ? "s" : "") + " sur " + n;

  /** Score de santé sur 100 : cinq critères sur 20 ; les critères à compléter (points null) sont exclus et le total ramené sur 100 ;
      couverture = critères notés ÷ critères, provisoire sous 60 % ; points perdus par critère = (20 − points) ÷ (20 × notés) × 100. */
  function score(ctx) {
    const c = ctx || {}, scope = c.scope || "foyer", positions = c.positions || [];
    const b = c.budget;
    const lignes = Array.isArray(b) ? b : b && Array.isArray(b.lignes) ? b.lignes : [];
    const totaux = b && !Array.isArray(b) && typeof b.depenses === "number" ? b : budgetTotaux(lignes, c.profil, scope);
    const items = [
      itemMatelas(positions, scope, totaux, c.config),
      itemEpargne(totaux),
      itemEndettement(totaux, c.profil, scope),
      itemConcentration(positions, scope),
      itemPatrimoine(positions, c.profil, scope, totaux),
    ].map(i => Object.assign(i, { sur: 20 }));
    const complets = notes(items);
    // Pas de note globale sur moins de 3 critères : un 100/100 calculé sur un seul critère serait trompeur.
    const total = complets.length >= SCORE_MIN_CRITERES ? Math.round(sum(complets, i => i.points) / (20 * complets.length) * 100) : null;
    items.forEach(i => { i.points_perdus = i.points == null || total == null ? null : r1((20 - i.points) / (20 * complets.length) * 100); });
    const couverture = complets.length / items.length;
    return { total, complet: complets.length === items.length, calcules: complets.length, items,
      couverture, couvertureTexte: texteCouverture(complets.length, items.length), provisoire: total != null && couverture < SEUIL_PROVISOIRE };
  }

  /** « Ce qui te coûte le plus » : les n (3) critères notés aux points perdus les plus élevés, avec la première action chiffrée.
      Accepte Plan.score (items) comme Pratiques.evaluer (criteres). → [{ cle, famille, libelle, points, points_perdus, action, gain_points }]. */
  function coutsPrincipaux(res, nb) {
    const L = ((res && (res.criteres || res.items)) || []).filter(x => x && x.points_perdus != null && x.points_perdus > 0);
    return L.slice().sort((a, b) => b.points_perdus - a.points_perdus || (a.points || 0) - (b.points || 0)).slice(0, nb == null ? 3 : nb).map(x => {
      const a = (x.ameliorer || []).find(y => y && y.gain_points) || (x.ameliorer || [])[0] || null;
      return { cle: x.cle, famille: x.famille || null, libelle: x.libelle || x.titre, points: x.points, points_perdus: x.points_perdus,
        action: a ? a.action : x.piste || "", gain_points: a ? a.gain_points : null, gain_note: a && a.gain_note != null ? a.gain_note : null };
    });
  }

  return { SCORE_MIN_CRITERES, SEUIL_PROVISOIRE, RENDEMENTS, REPERES_AGE, BAREMES, REPERES, STATUTS_LABELS, mensuel, budgetTotaux, capaciteEpargne, affecterDeja,
    effortMensuel, valeurFuture, moisEntre, dateAtteinte, dejaObjectif, titulaireObjectif, statutObjectif, repartirEpargne, projection, score, coutsPrincipaux,
    statutDe, zones, contrat, texteCouverture, expliqueMatelas, expliqueEpargne, expliqueEndettement, expliqueConcentration, frc, eurc, pctc };
});
