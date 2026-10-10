/* Marché : statistiques historiques de référence par classe d'actifs, corrélations simplifiées et crises de référence.
   Données embarquées et sourcées (pas de recherche en direct). Chiffres nominaux en euros, arrondis, volontairement prudents :
   ce sont des ordres de grandeur pédagogiques, pas des prévisions. Aucun accès au DOM.
   S'appuie sur Calc (calc.js) pour le rattachement poche → classe. */
(function (root, factory) {
  const Calc = typeof module === "object" && module.exports ? require("./calc.js") : root.Calc;
  const api = factory(Calc);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Marche = api;
})(typeof self !== "undefined" ? self : this, function (Calc) {
  /* Pour chaque classe : rendementLong (% nominal par an, longue période), volatilite (% annualisée),
     pireBaisse (% du sommet au creux, négatif), episodePireBaisse, pireAnnee (% sur une année civile), anneePire, source. */
  const CLASSES = {
    actions: {
      label: "Actions (monde développé)",
      rendementLong: 7, volatilite: 15, pireBaisse: -55, episodePireBaisse: "2007-2009", pireAnnee: -38, anneePire: 2008,
      source: "MSCI World NR EUR 1970-2025, MSCI ; Jordà et al., « The Rate of Return on Everything », QJE 2019 ; 2008 : −38 %",
    },
    small_caps: {
      label: "Actions de petites entreprises (small caps)",
      rendementLong: 7.5, volatilite: 20, pireBaisse: -60, episodePireBaisse: "2007-2009", pireAnnee: -40, anneePire: 2008,
      source: "MSCI World Small Cap NR 2001-2025, MSCI ; Fama et French (prime de taille, États-Unis 1926-2024)",
    },
    emergents: {
      label: "Actions des pays émergents",
      rendementLong: 6.5, volatilite: 20, pireBaisse: -60, episodePireBaisse: "2007-2009", pireAnnee: -50, anneePire: 2008,
      source: "MSCI Emerging Markets NR 1988-2025, MSCI ; 2008 : environ −50 % en euros",
    },
    levier: {
      label: "Produits à effet de levier (ETF ×2 quotidien)",
      rendementLong: 9, volatilite: 45, pireBaisse: -85, episodePireBaisse: "2000-2002 (reconstitution)", pireAnnee: -60, anneePire: 2022,
      source: "Nasdaq-100 levier ×2 quotidien : reconstitutions −85 % à −95 % sur 2000-2002, environ −60 % en 2022 (ProShares Ultra QQQ) ; " +
        "volatilité ≈ 2 × celle de l'indice, avec l'effet de recalibrage quotidien qui érode la performance en marché agité",
    },
    obligations: {
      label: "Obligations (zone euro)",
      rendementLong: 3.5, volatilite: 5, pireBaisse: -17, episodePireBaisse: "2021-2022", pireAnnee: -17, anneePire: 2022,
      source: "Indice obligataire euro agrégé, Bloomberg Euro Aggregate, 1999-2025 ; 2022 : −17 % (remontée des taux)",
    },
    immobilier: {
      label: "Immobilier (SCPI, pierre)",
      rendementLong: 4.5, volatilite: 6, pireBaisse: -20, episodePireBaisse: "1991-1997 et 2023-2024", pireAnnee: -10, anneePire: 2024,
      source: "IEIF pour les SCPI : pire baisse du prix de part ≈ −20 % (1991-1997 et 2023-2024) ; ASPIM ; Notaires de France / INSEE pour la pierre. " +
        "Volatilité lissée par la valorisation par expertise, le risque réel est plus élevé que le chiffre affiché",
    },
    monetaire: {
      label: "Monétaire et livrets",
      rendementLong: 1.5, volatilite: 0.5, pireBaisse: 0, episodePireBaisse: "aucune baisse nominale (érosion par l'inflation possible)", pireAnnee: 0, anneePire: null,
      source: "Livret A : Banque de France (taux réglementé 0,5 % à 3 %, 2015-2025) ; €STR / Eonia, BCE, 1999-2025",
    },
    fonds_euros: {
      label: "Fonds euros",
      rendementLong: 2.5, volatilite: 0.5, pireBaisse: 0, episodePireBaisse: "aucune baisse (capital garanti par l'assureur)", pireAnnee: 0, anneePire: null,
      source: "Fonds euros : ACPR / France Assureurs, rendement moyen 1,3–2,5 % sur 2015-2024, capital garanti",
    },
    or: {
      label: "Or",
      rendementLong: 4, volatilite: 15, pireBaisse: -45, episodePireBaisse: "1980-1985", pireAnnee: -30, anneePire: 2013,
      source: "Or en euros : LBMA (cours de référence), −45 % sur 1980-1985 ; 2013 : environ −30 % en euros",
    },
    crypto: {
      label: "Cryptoactifs",
      rendementLong: 10, volatilite: 70, pireBaisse: -80, episodePireBaisse: "2017-2018 et 2021-2022", pireAnnee: -73, anneePire: 2018,
      source: "Bitcoin : −84 % en 2017-2018, −77 % en 2021-2022 (CoinMarketCap) ; 2018 : −73 %. Historique court (depuis 2010), " +
        "rendement long très incertain : hypothèse prudente",
    },
    autres: {
      label: "Autres (non classé)",
      rendementLong: 4, volatilite: 12, pireBaisse: -35, episodePireBaisse: "2007-2009 (hypothèse)", pireAnnee: -20, anneePire: 2008,
      source: "Hypothèse prudente Boussole pour un actif non classé, calée sur un fonds diversifié (mi-actions, mi-obligations) : " +
        "Morningstar, catégorie « allocation flexible EUR », 2008",
    },
  };
  const CLES = Object.keys(CLASSES);

  /* Corrélations simplifiées entre classes (une seule valeur par paire, symétrique, diagonale à 1) :
     - famille actions (actions, small caps, émergents, levier) très corrélée entre elle (0,8 à 0,95) ;
     - obligations et or peu corrélés aux actions (0,1) ; crypto moyennement (0,4) ; immobilier à moitié (0,5) ;
     - monétaire et fonds euros : 0 avec tout (valeur quasi constante) ;
     - « autres » traité comme un fonds diversifié (0,5 avec les actions).
     Ordres de grandeur sur 2000-2025 (rendements mensuels en euros), arrondis ; la matrice reste semi-définie positive. */
  const PAIRES = {
    "actions|small_caps": 0.9, "actions|emergents": 0.85, "actions|levier": 0.9,
    "small_caps|emergents": 0.8, "small_caps|levier": 0.85, "emergents|levier": 0.8,
    "actions|obligations": 0.1, "small_caps|obligations": 0.1, "emergents|obligations": 0.1, "levier|obligations": 0.1,
    "actions|or": 0.1, "small_caps|or": 0.1, "emergents|or": 0.1, "levier|or": 0.1,
    "actions|crypto": 0.4, "small_caps|crypto": 0.4, "emergents|crypto": 0.4, "levier|crypto": 0.4,
    "actions|immobilier": 0.5, "small_caps|immobilier": 0.5, "emergents|immobilier": 0.5, "levier|immobilier": 0.5,
    "actions|autres": 0.5, "small_caps|autres": 0.5, "emergents|autres": 0.5, "levier|autres": 0.5,
    "obligations|immobilier": 0.3, "obligations|or": 0.2, "obligations|crypto": 0, "obligations|autres": 0.3,
    "immobilier|or": 0.1, "immobilier|crypto": 0.2, "immobilier|autres": 0.3,
    "or|crypto": 0.1, "or|autres": 0.1, "crypto|autres": 0.2,
  };
  function correlation(a, b) {
    if (a === b) return 1;
    const v = PAIRES[a + "|" + b];
    if (v != null) return v;
    const w = PAIRES[b + "|" + a];
    return w != null ? w : 0; /* monétaire et fonds euros : 0 avec tout */
  }
  const CORRELATIONS = {};
  CLES.forEach(a => { CORRELATIONS[a] = {}; CLES.forEach(b => { CORRELATIONS[a][b] = correlation(a, b); }); });

  /* Crises de référence (utilisées par le sous-projet Avenir) : choc nominal cumulé approximatif par classe, en %, du sommet au creux
     des actions, en euros. Le rendement perçu pendant la crise par le monétaire et les fonds euros est négligé (0).
     proxy : classe qui n'existait pas (ou sans indice) à l'époque, remplacée par une hypothèse prudente. */
  const SOURCE_CRISES = "MSCI World / Small Cap / Emerging Markets NR EUR (MSCI) ; Bloomberg Euro Aggregate ; LBMA (or) ; IEIF (SCPI) ; " +
    "CoinMarketCap (bitcoin) ; reconstitutions Boussole pour le levier ×2 quotidien";
  const CRISES = {
    dotcom_2000: {
      label: "Bulle internet (2000-2002)", debut: "2000-03", fin: "2002-10",
      description: "Éclatement de la bulle technologique : les actions mondiales perdent plus de la moitié, le Nasdaq plus de 80 %.",
      chocs: { actions: -55, small_caps: -30, emergents: -45, levier: -95, obligations: 15, immobilier: 10, monetaire: 0, fonds_euros: 0, or: 5, crypto: -70, autres: -30 },
      proxy: { crypto: true }, source: SOURCE_CRISES,
    },
    gfc_2008: {
      label: "Crise financière (2007-2009)", debut: "2007-10", fin: "2009-03",
      description: "Crise des subprimes puis faillite de Lehman Brothers : les actions mondiales perdent environ 55 % en 17 mois.",
      chocs: { actions: -55, small_caps: -60, emergents: -60, levier: -85, obligations: 5, immobilier: -15, monetaire: 0, fonds_euros: 0, or: 15, crypto: -70, autres: -35 },
      proxy: { crypto: true }, source: SOURCE_CRISES,
    },
    covid_2020: {
      label: "Covid (2020)", debut: "2020-02", fin: "2020-03",
      description: "Krach éclair du confinement : un tiers de baisse en cinq semaines, effacée en quelques mois.",
      chocs: { actions: -34, small_caps: -40, emergents: -32, levier: -50, obligations: -3, immobilier: -5, monetaire: 0, fonds_euros: 0, or: -3, crypto: -50, autres: -20 },
      proxy: {}, source: SOURCE_CRISES,
    },
    taux_2022: {
      label: "Remontée des taux (2022)", debut: "2022-01", fin: "2022-10",
      description: "Retour de l'inflation et hausse rapide des taux : actions et obligations baissent ensemble, cas rare.",
      chocs: { actions: -20, small_caps: -25, emergents: -25, levier: -60, obligations: -17, immobilier: -5, monetaire: 0, fonds_euros: 0, or: 5, crypto: -65, autres: -15 },
      proxy: {}, source: SOURCE_CRISES,
    },
    inflation_1973: {
      label: "Choc pétrolier et inflation (1973-1974)", debut: "1973-01", fin: "1974-12",
      description: "Premier choc pétrolier : actions en forte baisse, inflation à deux chiffres qui ronge aussi l'épargne sans risque (perte réelle).",
      chocs: { actions: -45, small_caps: -55, emergents: -50, levier: -80, obligations: -10, immobilier: -10, monetaire: 0, fonds_euros: 0, or: 100, crypto: -70, autres: -30 },
      proxy: { crypto: true, emergents: true, levier: true }, source: SOURCE_CRISES + " ; Dimson, Marsh et Staunton (1973-1974)",
    },
  };

  /* ---------- rattachement d'une position à une classe de risque ---------- */
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  /* « 2x », « x2 », « ×3 », « levier », « leveraged », « daily 2x »… */
  const LEVIER = /(^|[^a-z0-9])([23] ?[x×]|[x×] ?[23])([^a-z0-9]|$)|levier|leverag/;
  const SMALL = /small ?caps?|petites? cap|russell 2000/;
  const EMERG = /emergent|emerging|\bem\b|msci em\b/;

  /** Classe de risque d'une position : `levier` si le nom ou la poche l'indique, sinon la classe de Calc
      (surcharge comprise), affinée en small caps ou émergents pour les actions.
      Une surcharge explicite de la poche l'emporte sur la détection faite sur la poche ; le levier écrit dans le nom
      de la ligne reste prioritaire (c'est une propriété du produit, pas de la poche). */
  function classeRisque(position, surcharge) {
    const p = position || {}, bloc = p.bloc, nom = norm(p.name), poche = norm(bloc);
    if (LEVIER.test(nom)) return "levier";
    const surchargee = surcharge && bloc in surcharge;
    if (!surchargee && LEVIER.test(poche)) return "levier";
    const base = Calc.classe(bloc, surcharge);
    if (surchargee && CLASSES[base] && base !== "actions") return base;
    if (base === "actions") {
      const txt = poche + " " + nom;
      if (SMALL.test(txt)) return "small_caps";
      if (EMERG.test(txt)) return "emergents";
    }
    return CLASSES[base] ? base : "autres";
  }

  return { CLASSES, CLES, CORRELATIONS, correlation, CRISES, classeRisque };
});
