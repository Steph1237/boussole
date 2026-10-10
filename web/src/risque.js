/* Risque : profil de risque déclaré (questionnaire inspiré de l'adéquation MiFID II) et risque réel du portefeuille.
   Calculs purs, aucun accès au DOM. Pédagogique : on parle de classes d'actifs et de comportements, jamais de produits.
   S'appuie sur Calc (calc.js) pour les positions et sur Marche (marche.js) pour les statistiques par classe. */
(function (root, factory) {
  const cjs = typeof module === "object" && module.exports;
  const Calc = cjs ? require("./calc.js") : root.Calc;
  const Marche = cjs ? require("./marche.js") : root.Marche;
  const api = factory(Calc, Marche);
  if (cjs) module.exports = api;
  else root.Risque = api;
})(typeof self !== "undefined" ? self : this, function (Calc, Marche) {
  const EPS = 1e-9;
  const sum = (list, f) => list.reduce((a, x, i) => a + f(x, i), 0);
  const n = v => (isFinite(+v) && v !== null && v !== "" ? +v : 0);

  /* ---------- questionnaire ---------- */
  /* Poids : fort 3, moyen 2, faible 1, garde-fou 0 (la question n'entre pas dans le score, elle ne fait que plafonner). */
  const QUESTIONS = [
    { id: "horizon", theme: "Horizon", poids: 3, type: "choix",
      texte: "Dans combien de temps aurez-vous besoin de la majeure partie de cet argent ?",
      aide: "Plus l'échéance est lointaine, plus vous avez le temps d'attendre qu'une baisse soit rattrapée.",
      options: [
        { v: "lt2", label: "Moins de 2 ans", points: 0 },
        { v: "2-5", label: "2 à 5 ans", points: 1 },
        { v: "5-8", label: "5 à 8 ans", points: 2 },
        { v: "8-15", label: "8 à 15 ans", points: 3 },
        { v: "gt15", label: "Plus de 15 ans", points: 4 },
      ] },
    { id: "objectif", theme: "Objectif", poids: 2, type: "choix",
      texte: "Qu'attendez-vous d'abord de vos placements ?",
      options: [
        { v: "preserver", label: "Préserver ce que j'ai, sans perte", points: 0 },
        { v: "revenus", label: "Compléter mes revenus régulièrement", points: 1 },
        { v: "croissance", label: "Faire croître mon épargne à moyen terme", points: 2 },
        { v: "maximiser", label: "Obtenir le meilleur rendement à long terme, en acceptant de fortes variations", points: 3 },
      ] },
    { id: "reaction", theme: "Réaction à une baisse", poids: 3, type: "choix",
      texte: "Vos placements perdent 20 % en trois mois. Que faites-vous ?",
      aide: "Ce genre de baisse arrive en moyenne une fois tous les 5 à 10 ans sur les actions. Répondez selon ce que vous feriez vraiment.",
      options: [
        { v: "vendre_tout", label: "Je vends tout pour arrêter les pertes", points: 0 },
        { v: "vendre_partie", label: "J'en vends une partie", points: 1 },
        { v: "rien", label: "Je ne fais rien et j'attends", points: 2 },
        { v: "renforcer", label: "J'en profite pour investir davantage", points: 3 },
      ] },
    { id: "perte_max", theme: "Perte maximale", poids: 3, type: "choix",
      texte: "Quelle baisse temporaire de vos placements, sur une année, pourriez-vous supporter sans changer vos plans ?",
      aide: "Une baisse temporaire n'est une perte que si l'on vend au plus bas. Indiquez ce que vous supporteriez sans dormir moins bien.",
      options: [
        { v: "p5", label: "5 %", points: 0, perte: 5 },
        { v: "p10", label: "10 %", points: 1, perte: 10 },
        { v: "p20", label: "20 %", points: 2, perte: 20 },
        { v: "p35", label: "35 %", points: 3, perte: 35 },
        { v: "plus", label: "Plus de 35 %", points: 4, perte: null },
      ] },
    { id: "connaissances", theme: "Connaissances", poids: 2, type: "multi",
      texte: "Quels placements connaissez-vous assez pour expliquer comment ils gagnent ou perdent de la valeur ?",
      aide: "Cochez tout ce qui s'applique. Un ETF (ou « tracker ») est un fonds coté qui réplique un indice, par exemple les grandes entreprises mondiales. " +
        "Un produit à levier amplifie les hausses comme les baisses.",
      options: [
        { v: "livrets", label: "Livrets d'épargne", points: 0 },
        { v: "fonds_euros", label: "Fonds euros d'assurance-vie", points: 0 },
        { v: "etf", label: "ETF (fonds indiciels cotés)", points: 2 },
        { v: "actions", label: "Actions", points: 2 },
        { v: "obligations", label: "Obligations", points: 1 },
        { v: "crypto", label: "Cryptoactifs", points: 1 },
        { v: "levier", label: "Produits à effet de levier", points: 1 },
        { v: "aucun", label: "Aucun de ces placements", points: 0, exclusif: true },
      ] },
    { id: "experience", theme: "Expérience", poids: 1, type: "nombre",
      texte: "Depuis combien d'années investissez-vous en bourse (actions, ETF ou fonds) ?",
      aide: "Indiquez 0 si vous n'avez jamais investi en bourse.",
      options: [
        { v: "0", min: 0, label: "Jamais ou moins d'un an", points: 0 },
        { v: "1", min: 1, label: "1 à 2 ans", points: 1 },
        { v: "3", min: 3, label: "3 à 4 ans", points: 2 },
        { v: "5", min: 5, label: "5 à 9 ans", points: 3 },
        { v: "10", min: 10, label: "10 ans ou plus", points: 4 },
      ] },
    { id: "revenus", theme: "Stabilité des revenus", poids: 2, type: "choix",
      texte: "Comment décririez-vous vos revenus ?",
      aide: "Des revenus stables permettent de traverser une baisse des marchés sans devoir vendre.",
      options: [
        { v: "fonctionnaire", label: "Très stables (fonctionnaire, pension de retraite)", points: 4 },
        { v: "cdi", label: "Stables (salarié en CDI)", points: 3 },
        { v: "independant", label: "Plutôt réguliers (indépendant, chef d'entreprise)", points: 2 },
        { v: "variables", label: "Variables (CDD, intérim, commissions)", points: 1 },
        { v: "sans", label: "Sans revenu d'activité", points: 0 },
      ] },
    { id: "matelas", theme: "Épargne de précaution", poids: 0, type: "choix", prerempli: "matelas",
      texte: "Avez-vous de côté au moins 3 mois de dépenses, disponibles tout de suite et en dehors de vos placements ?",
      aide: "C'est le matelas de sécurité (livrets, compte courant). Sans lui, un imprévu peut obliger à vendre au mauvais moment. Prérempli depuis le Bilan.",
      options: [
        { v: "oui", label: "Oui", points: 1 },
        { v: "non", label: "Non", points: 0 },
      ] },
    { id: "part_investie", theme: "Part exposée", poids: 2, type: "choix",
      texte: "Quelle part de votre épargne financière acceptez-vous d'exposer aux marchés (actions, obligations, immobilier coté…) ?",
      aide: "Le reste resterait sur des supports sans risque de perte : livrets, fonds euros.",
      options: [
        { v: "lt10", label: "Moins de 10 %", points: 0 },
        { v: "10-25", label: "10 à 25 %", points: 1 },
        { v: "25-50", label: "25 à 50 %", points: 2 },
        { v: "50-75", label: "50 à 75 %", points: 3 },
        { v: "gt75", label: "Plus de 75 %", points: 4 },
      ] },
    { id: "age", theme: "Âge", poids: 1, type: "choix", prerempli: "age",
      texte: "Quel est votre âge ?",
      aide: "Prérempli depuis le Profil.",
      options: [
        { v: "u30", label: "Moins de 30 ans", points: 4 },
        { v: "a30", label: "30 à 39 ans", points: 4 },
        { v: "a40", label: "40 à 49 ans", points: 3 },
        { v: "a50", label: "50 à 59 ans", points: 2 },
        { v: "a60", label: "60 à 69 ans", points: 1 },
        { v: "a70", label: "70 ans ou plus", points: 0 },
      ] },
  ];

  /* ---------- profils ---------- */
  /* Allocation cible indicative (%, bornes incluses) et perte maximale tolérée sur un an (%, en valeur absolue). */
  const PROFILS = [
    { id: "prudent", label: "Prudent", perteMax: 5,
      description: "Vous privilégiez la sécurité : l'essentiel reste sur des supports sans risque de perte, une petite part cherche un peu de rendement.",
      cibles: { actions: [10, 20], obligations: [20, 30], securise: [50, 70], immobilier: [0, 10], speculatif: [0, 0] } },
    { id: "modere", label: "Modéré", perteMax: 12,
      description: "Vous acceptez de petites variations pour un rendement un peu meilleur, avec une base sécurisée importante.",
      cibles: { actions: [25, 40], obligations: [20, 30], securise: [30, 45], immobilier: [5, 15], speculatif: [0, 2] } },
    { id: "equilibre", label: "Équilibré", perteMax: 20,
      description: "Vous cherchez un compromis : environ la moitié en actions pour la croissance, le reste pour amortir les baisses.",
      cibles: { actions: [45, 60], obligations: [15, 25], securise: [15, 30], immobilier: [5, 15], speculatif: [0, 5] } },
    { id: "dynamique", label: "Dynamique", perteMax: 30,
      description: "Vous visez la croissance à long terme et acceptez des baisses marquées, le temps qu'elles soient rattrapées.",
      cibles: { actions: [60, 80], obligations: [5, 15], securise: [5, 15], immobilier: [5, 15], speculatif: [0, 7] } },
    { id: "offensif", label: "Offensif", perteMax: 40,
      description: "Vous recherchez le rendement maximal sur un horizon long et supportez de fortes baisses sans vendre.",
      cibles: { actions: [75, 95], obligations: [0, 10], securise: [0, 10], immobilier: [0, 10], speculatif: [0, 10] } },
  ];
  const IDS = PROFILS.map(p => p.id);
  const rang = id => IDS.indexOf(id);
  const profil = id => PROFILS.find(p => p.id === id) || null;

  /** Score (0-100) → profil : [0, 20[ prudent, [20, 40[ modéré, [40, 60[ équilibré, [60, 80[ dynamique, [80, 100] offensif. */
  function profilDuScore(score) {
    return IDS[Math.min(4, Math.max(0, Math.floor(n(score) / 20)))];
  }

  /* ---------- évaluation ---------- */
  function prerempli(q, ctx) {
    const c = ctx || {};
    if (q.prerempli === "matelas" && c.matelasMois != null && c.matelasMois !== "" && isFinite(+c.matelasMois)) return +c.matelasMois >= 3 ? "oui" : "non";
    if (q.prerempli === "age" && c.age != null) return c.age;
    return undefined;
  }
  /* Réponse valide → { valeur, norm (0-1), option(s) } ; invalide ou absente → null. */
  function lire(q, brute) {
    if (brute === undefined || brute === null || brute === "") return null;
    const max = Math.max(...q.options.map(o => o.points));
    if (q.type === "multi") {
      const vals = (Array.isArray(brute) ? brute : [brute]).map(String).filter(v => q.options.some(o => o.v === v));
      if (!vals.length) return null;
      const autres = vals.filter(v => v !== "aucun");
      const retenues = autres.length ? autres : ["aucun"]; /* « aucun » coché avec autre chose : on garde les cases précises */
      const total = sum(q.options.filter(o => o.points > 0), o => o.points);
      const pts = sum(q.options.filter(o => retenues.includes(o.v)), o => o.points);
      return { valeur: retenues, norm: total ? Math.min(1, pts / total) : 0 };
    }
    if (q.type === "nombre") {
      const x = +brute;
      if (!isFinite(x) || x < 0) return null;
      const o = q.options.filter(op => x >= op.min).pop();
      return { valeur: x, norm: max ? o.points / max : 0, option: o };
    }
    const o = q.options.find(op => op.v === String(brute));
    return o ? { valeur: o.v, norm: max ? o.points / max : 0, option: o } : null;
  }

  /** Évalue le questionnaire. ctx : { matelasMois, age } pour préremplir. Les réponses explicites l'emportent sur le prérempli. */
  function evaluer(reponses, ctx) {
    const r = reponses || {};
    const lues = {}, manquantes = [];
    QUESTIONS.forEach(q => {
      const brute = r[q.id] !== undefined && r[q.id] !== null && r[q.id] !== "" ? r[q.id] : prerempli(q, ctx);
      const l = lire(q, brute);
      if (l) lues[q.id] = l; else manquantes.push(q.id);
    });
    const repondues = QUESTIONS.filter(q => lues[q.id]);
    const poidsTotal = sum(repondues, q => q.poids);
    const details = QUESTIONS.map(q => ({ id: q.id, valeur: lues[q.id] ? lues[q.id].valeur : null, points: lues[q.id] ? lues[q.id].norm : null, poids: q.poids }));
    const base = { complet: manquantes.length === 0, manquantes, details };
    if (!poidsTotal) return { ...base, score: null, profil: null, profilAvantGardeFous: null, gardeFous: [] };

    /* Moyenne des points normalisés, pondérée par le poids des questions répondues ; arrondie avant le seuil pour que
       le score affiché et le profil restent cohérents. */
    const score = Math.round(sum(repondues, q => q.poids * lues[q.id].norm) / poidsTotal * 100);
    const avant = profilDuScore(score);

    /* Garde-fous : chacun propose un plafond ; seuls ceux qui abaissent effectivement le profil sont retenus. */
    const candidats = [];
    if (lues.horizon && lues.horizon.valeur === "lt2")
      candidats.push({ cle: "horizon", plafond: "modere",
        texte: "Vous aurez besoin de cet argent dans moins de 2 ans : l'argent nécessaire à court terme n'a pas sa place sur les marchés, qui peuvent baisser juste avant l'échéance. Profil plafonné à Modéré." });
    if (lues.matelas && lues.matelas.valeur === "non")
      candidats.push({ cle: "matelas", plafond: "modere",
        texte: "Vous n'avez pas encore 3 mois de dépenses de côté : sans ce matelas, un imprévu peut obliger à vendre au plus bas. Profil plafonné à Modéré tant que le matelas n'est pas constitué." });
    if (lues.perte_max && lues.perte_max.option.perte != null) {
      const acceptee = lues.perte_max.option.perte;
      const ok = PROFILS.filter(p => p.perteMax <= acceptee);
      const plafond = ok.length ? ok[ok.length - 1] : PROFILS[0];
      candidats.push({ cle: "perte_max", plafond: plafond.id,
        texte: "Vous acceptez une baisse de " + acceptee + " % au plus sur un an : un profil plus exposé peut perdre davantage (jusqu'à " +
          PROFILS[Math.min(4, rang(plafond.id) + 1)].perteMax + " % pour le profil suivant). Profil plafonné à " + plafond.label + ", dont la baisse tolérée est de " + plafond.perteMax + " %." });
    }
    if (lues.connaissances && !lues.connaissances.valeur.some(v => v === "actions" || v === "etf"))
      candidats.push({ cle: "connaissances", plafond: "equilibre",
        texte: "Vous n'avez pas indiqué connaître les actions ni les ETF : mieux vaut ne pas dépasser la moitié de son épargne sur des placements dont on ne maîtrise pas le fonctionnement. Profil plafonné à Équilibré." });
    const gardeFous = candidats.filter(g => rang(g.plafond) < rang(avant));
    const final = gardeFous.reduce((p, g) => (rang(g.plafond) < rang(p) ? g.plafond : p), avant);
    return { ...base, score, profil: final, profilAvantGardeFous: avant, gardeFous };
  }

  /* ---------- allocation réelle ---------- */
  const GROUPES = ["actions", "obligations", "securise", "immobilier", "speculatif"];
  const GROUPES_LABELS = { actions: "Actions", obligations: "Obligations", securise: "Fonds euros et monétaire", immobilier: "Immobilier",
    speculatif: "Spéculatif (crypto, levier)", diversifiants: "Or et autres" };
  const GROUPE_DE = { actions: "actions", small_caps: "actions", emergents: "actions", obligations: "obligations", monetaire: "securise",
    fonds_euros: "securise", immobilier: "immobilier", crypto: "speculatif", levier: "speculatif", or: "diversifiants", autres: "diversifiants" };

  /* Montants par classe de risque (Marche.classeRisque), immobilier physique optionnel ajouté à l'immobilier. */
  function montantsParClasse(positions, scope, opts) {
    const o = opts || {}, sc = scope || "foyer", out = {};
    (positions || []).filter(p => Calc.inScope(p, sc) && Calc.counted(p)).forEach(p => {
      const k = Marche.classeRisque(p, o.surcharge);
      out[k] = (out[k] || 0) + Calc.val(p);
    });
    const phys = Math.max(0, n(o.immobilierPhysique));
    if (phys) out.immobilier = (out.immobilier || 0) + phys;
    return out;
  }

  /** Répartition en % par grand groupe (actions, obligations, sécurisé, immobilier, spéculatif) + « diversifiants » (or, autres).
      opts : { surcharge, immobilierPhysique } — la valeur du bien physique est fournie par l'appelant (ex. Calc.immobilier). */
  function allocationReelle(positions, scope, opts) {
    const parClasse = montantsParClasse(positions, scope, opts);
    const montants = { actions: 0, obligations: 0, securise: 0, immobilier: 0, speculatif: 0, diversifiants: 0 };
    Object.keys(parClasse).forEach(k => { montants[GROUPE_DE[k] || "diversifiants"] += parClasse[k]; });
    const total = sum(Object.keys(montants), k => montants[k]);
    const pct = {};
    Object.keys(montants).forEach(k => { pct[k] = total > 0 ? montants[k] * 100 / total : 0; });
    return { total, montants, pct, parClasse };
  }

  /* ---------- risque réel ---------- */
  /** Risque du portefeuille réel.
      Méthode : σ (volatilité annuelle, %) = √(wᵀΣw), avec Σᵢⱼ = ρᵢⱼ σᵢ σⱼ (volatilités et corrélations simplifiées de Marche).
      Baisse plausible à un an (approximation normale simple, 99 %) : −2,33 × σ, sans compter le rendement attendu (prudent).
      La loi normale sous-estime les krachs ; on lui applique un plancher : la moitié de la pire baisse historique pondérée
      (Σ wᵢ × pire baisseᵢ) : la baisse plausible retenue est la plus grave des deux, bornée à −100 %.
      Profil équivalent : le moins risqué des profils dont la perte tolérée couvre cette baisse, sinon Offensif.
      Contributions : part de chaque classe dans la variance, wᵢ (Σw)ᵢ / σ² (la somme fait 100 %). */
  function risquePortefeuille(positions, scope, opts) {
    const parClasse = montantsParClasse(positions, scope, opts);
    const cles = Object.keys(parClasse).filter(k => parClasse[k] > 0);
    const total = sum(cles, k => parClasse[k]);
    if (!(total > 0)) return { volatilite: 0, baissePlausible: 0, pireBaisseHistorique: 0, profilEquivalent: null, contributions: [] };
    const w = cles.map(k => parClasse[k] / total);
    const stat = k => Marche.CLASSES[k] || Marche.CLASSES.autres;
    const cov = (a, b) => Marche.correlation(a, b) * stat(a).volatilite * stat(b).volatilite;
    const sw = cles.map((a, i) => sum(cles, (b, j) => w[j] * cov(a, b))); /* (Σw)ᵢ */
    const variance = sum(cles, (a, i) => w[i] * sw[i]);
    const volatilite = Math.sqrt(Math.max(0, variance));
    const pireBaisseHistorique = sum(cles, (k, i) => w[i] * stat(k).pireBaisse);
    const baissePlausible = Math.max(-100, Math.min(-2.33 * volatilite, 0.5 * pireBaisseHistorique));
    const perte = -baissePlausible;
    const eq = PROFILS.find(p => p.perteMax + EPS >= perte);
    const contributions = cles.map((k, i) => ({ classe: k, poids: parClasse[k] * 100 / total, contributionPct: variance > 0 ? w[i] * sw[i] / variance * 100 : 0 }))
      .sort((a, b) => b.contributionPct - a.contributionPct || b.poids - a.poids);
    return { volatilite, baissePlausible, pireBaisseHistorique, profilEquivalent: eq ? eq.id : "offensif", contributions };
  }

  /* ---------- écarts ---------- */
  /** Écart par groupe entre l'allocation réelle (% ou résultat d'allocationReelle) et la cible du profil.
      ecartPts : 0 dans la fourchette, réel − min (négatif) en dessous, réel − max (positif) au-dessus. */
  function ecarts(profilId, allocation) {
    const p = profil(profilId);
    if (!p) return [];
    const pct = (allocation && allocation.pct) || allocation || {};
    return GROUPES.map(g => {
      const reel = n(pct[g]), [min, max] = p.cibles[g];
      const statut = reel < min - EPS ? "sous" : reel > max + EPS ? "au-dessus" : "dans";
      return { groupe: g, label: GROUPES_LABELS[g], reel, min, max, statut, ecartPts: statut === "sous" ? reel - min : statut === "au-dessus" ? reel - max : 0 };
    });
  }

  /* ---------- synthèse ---------- */
  /** Tout ce qu'il faut à l'interface et au connecteur. ctx : { positions, scope, surcharge, immobilierPhysique, matelasMois, age }. */
  function synthese(reponses, ctx) {
    const c = ctx || {}, scope = c.scope || "foyer";
    const opts = { surcharge: c.surcharge, immobilierPhysique: c.immobilierPhysique };
    const evaluation = evaluer(reponses, c);
    const declare = profil(evaluation.profil);
    const allocation = allocationReelle(c.positions, scope, opts);
    const risque = risquePortefeuille(c.positions, scope, opts);
    const equivalent = profil(risque.profilEquivalent);
    const ecartNiveaux = declare && equivalent ? rang(equivalent.id) - rang(declare.id) : null;
    let texte;
    if (!equivalent) texte = "Aucun placement à analyser pour le moment.";
    else if (!declare) texte = "Votre portefeuille se comporte comme un profil " + equivalent.label + ". Répondez au questionnaire pour le comparer à votre profil.";
    else if (ecartNiveaux === 0) texte = "Votre portefeuille se comporte comme un profil " + equivalent.label + ", conforme à votre profil.";
    else texte = "Votre portefeuille se comporte comme un profil " + equivalent.label + ", alors que votre profil est " + declare.label + " : il prend " +
      (ecartNiveaux > 0 ? "plus de risque que vous ne le souhaitez." : "moins de risque que votre profil ne le permet.");
    return {
      evaluation, profil: declare, allocation, risque,
      ecarts: declare ? ecarts(declare.id, allocation) : [],
      comparaison: { declare: declare ? declare.id : null, equivalent: equivalent ? equivalent.id : null, ecartNiveaux, texte },
    };
  }

  return { QUESTIONS, PROFILS, GROUPES, GROUPES_LABELS, GROUPE_DE, profilDuScore, evaluer, allocationReelle, risquePortefeuille, ecarts, synthese };
});
