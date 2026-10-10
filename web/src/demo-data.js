/* DONNÉES D'EXEMPLE — mode démo (app.html?demo). Foyer fictif : « Camille » (p1) et « Sam » (p2).
   Aucune personne réelle ; montants plausibles pour un foyer français en 2026.
   Forme canonique du store (foyer / p1 / p2), exposée telle quelle par store-demo.js ; store-supabase.js produit
   la même forme depuis les lignes SQL. config.rules contient une règle de chaque type, chacune déclenchant au
   moins une alerte dans Pilotage (périmètre Foyer).
   Les dates sont relatives à aujourd'hui pour que la démo reste « fraîche » (cours d'hier, photos aux fins
   des trois mois précédents) ; les montants sont fixes.
   Total financier compté (hors « à recevoir ») : 94 989,90 € — Camille 51 815,50 €, Sam 43 174,40 €.
   Budget (couple lyonnais, un enfant) : les salaires (2 800 + 2 300 € nets) et les mensualités (820 + 210 €) viennent
   du profil, d'où aucune ligne de revenu. Dépenses saisies : 2 400 €/mois + taxe foncière 1 100 €/an (91,67 €/mois),
   soit 3 521,67 €/mois avec les mensualités ; épargne explicite 650 €/mois ; reste ≈ 928 €/mois.
   Objectif « Matelas » = 6 mois de dépenses : 6 × 3 521,67 = 21 130 → 21 100 €. */
(function (root) {
  const DAY = 864e5, now = Date.now();
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const ago = n => iso(now - n * DAY);
  const at = (n, h) => ago(n) + "T" + h + ":00.000Z";
  // Dernier jour du k-ième mois précédent (k = 1 : fin du mois dernier).
  const monthEnd = k => { const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k + 1); d.setUTCDate(0); return iso(d); };
  const hier = ago(1);

  const P = o => Object.assign({ isin: null, qty: null, pru: null, price: null, priceDate: null, value: null, valueDate: null, status: "actif", hypothesis: null, qtyEstimated: false, note: null,
    ter: null, zone: null, devise: null, annoteSource: null, annoteLe: null }, o);
  /* Annotations d'instruments (frais courants, zone, devise), comme si l'assistant les avait renseignées via le connecteur.
     Trois lignes sur cinq cotées, soit 49 % des montants cotés : le critère « Frais des fonds » reste à compléter
     (seuil de 50 %) et invite à faire annoter l'ETF Monde, la plus grosse ligne. */
  const A = (ter, zone, devise, annoteSource) => ({ ter, zone, devise, annoteSource, annoteLe: at(9, "19:05") });
  const positions = [
    P({ id: "pea-etf-monde", name: "ETF MSCI World", envelope: "PEA Camille", owner: "p1", bloc: "Monde", mode: "market", isin: "IE00B4L5Y983", qty: 120, pru: 88.4, price: 104.26, priceDate: hier }),           // 12 511,20
    P({ id: "pea-etf-europe", name: "ETF Stoxx Europe 600", envelope: "PEA Camille", owner: "p1", bloc: "Europe", mode: "market", isin: "LU0908500753", qty: 36, pru: 215.1, price: 248.3, priceDate: hier,
      ...A(0.07, "Europe", null, "Document d'informations clés du fonds (amundietf.fr), frais courants 0,07 %") }),     //  8 938,80
    P({ id: "pea-air-liquide", name: "Air Liquide", envelope: "PEA Camille", owner: "p1", bloc: "Convictions", mode: "market", isin: "FR0000120073", qty: 22, pru: 162, price: 181.5, priceDate: hier }),          //  3 993,00
    P({ id: "cto-asml", name: "ASML", envelope: "CTO Sam", owner: "p2", bloc: "Convictions", mode: "market", isin: "NL0010273215", qty: 6, pru: 640, price: 712.4, priceDate: hier,
      ...A(0, "Pays-Bas", "EUR", "Action détenue en direct : pas de frais courants de fonds (frais de courtage non compris)") }),                             //  4 274,40
    P({ id: "av-fonds-euro", name: "Fonds en euros", envelope: "Assurance vie Sam", owner: "p2", bloc: "Obligations", mode: "manual", value: 18200, valueDate: monthEnd(1) }),                                   // 18 200,00
    P({ id: "av-scpi", name: "SCPI diversifiée", envelope: "Assurance vie Sam", owner: "p2", bloc: "SCPI", mode: "manual", value: 5300, valueDate: monthEnd(1), hypothesis: "Valorisée au prix de retrait 2025, à confirmer sur le relevé annuel." }), // 5 300,00
    P({ id: "livret-a", name: "Livret A", envelope: "Livrets Camille", owner: "p1", bloc: "Épargne", mode: "manual", value: 12000, valueDate: ago(4) }),                                                        // 12 000,00
    P({ id: "ldds", name: "LDDS", envelope: "Livrets Sam", owner: "p2", bloc: "Épargne", mode: "manual", value: 12000, valueDate: ago(4) }),                                                                     // 12 000,00 (plafond)
    P({ id: "per-camille", name: "PER Camille", envelope: "PER", owner: "p1", bloc: "Monde", mode: "manual", value: 11800, valueDate: monthEnd(1) }),                                                            // 11 800,00
    P({ id: "crypto-btc", name: "Bitcoin", envelope: "Crypto", owner: "p1", bloc: "Crypto", mode: "market", isin: "X-BTC", qty: 0.042, pru: 58000, price: 61250, priceDate: ago(6), qtyEstimated: true,
      ...A(0, null, null, "Détention directe : pas de frais courants de fonds (frais de plateforme non compris)") }),      //  2 572,50 (cours ancien)
    P({ id: "compte-commun", name: "Compte courant commun", envelope: "Banque", owner: "p2", bloc: "Épargne", mode: "manual", value: 3400, valueDate: ago(1) }),                                                 //  3 400,00
    P({ id: "prime-camille", name: "Prime annuelle", envelope: "À recevoir", owner: "p1", bloc: "Épargne", mode: "manual", value: 2500, valueDate: ago(0), status: "à recevoir", note: "Versée avec la paie de décembre." }), // non compté
  ];

  const snapshots = [
    { date: monthEnd(3), foyer: 90120, p1: 48900, p2: 41220, source: "nightly",
      byBloc: { Monde: 23000, Europe: 8400, Convictions: 7800, Obligations: 18000, SCPI: 5300, "Épargne": 25300, Crypto: 2320 },
      byEnvelope: { "PEA Camille": 24100, "CTO Sam": 3900, "Assurance vie Sam": 23300, "Livrets Camille": 10800, "Livrets Sam": 11500, PER: 11200, Crypto: 2320, Banque: 3000 } },
    { date: monthEnd(2), foyer: 92340, p1: 50310, p2: 42030, source: "nightly",
      byBloc: { Monde: 23600, Europe: 8700, Convictions: 8050, Obligations: 18100, SCPI: 5300, "Épargne": 26100, Crypto: 2490 },
      byEnvelope: { "PEA Camille": 24700, "CTO Sam": 4150, "Assurance vie Sam": 23400, "Livrets Camille": 11300, "Livrets Sam": 11700, PER: 11400, Crypto: 2490, Banque: 3200 } },
    { date: monthEnd(1), foyer: 94210, p1: 51380, p2: 42830, source: "nightly",
      byBloc: { Monde: 24100, Europe: 8900, Convictions: 8200, Obligations: 18200, SCPI: 5300, "Épargne": 26950, Crypto: 2560 },
      byEnvelope: { "PEA Camille": 25200, "CTO Sam": 4300, "Assurance vie Sam": 23500, "Livrets Camille": 11800, "Livrets Sam": 11900, PER: 11700, Crypto: 2560, Banque: 3250 } },
  ];

  const tx = [
    { id: "tx-demo-1", date: ago(3), type: "versement", positionId: "livret-a", qty: null, price: null, amount: 200, note: "Virement mensuel", source: "nightly", createdAt: at(3, "20:31") },
    { id: "tx-demo-2", date: ago(12), type: "achat", positionId: "pea-etf-monde", qty: 3, price: 103.1, amount: 309.3, note: "", source: "manuel", createdAt: at(12, "12:04") },
    { id: "tx-demo-3", date: ago(30), type: "versement", positionId: "pea-etf-monde", qty: 2.94, price: 102.05, amount: 300, note: "Versement programmé", source: "nightly", createdAt: at(30, "20:30") },
    { id: "tx-demo-4", date: ago(41), type: "solde", positionId: "av-fonds-euro", qty: null, price: null, amount: 18200, note: "Relevé trimestriel", source: "manuel", createdAt: at(41, "09:12") },
  ];

  const config = {
    targets: {
      p1: { Monde: 45, Europe: 17, Convictions: 8, "Épargne": 25, Crypto: 5 },
      p2: { Convictions: 10, Obligations: 40, SCPI: 25, "Épargne": 25 },
      tolerancePts: 3,
    },
    // Chaque règle déclenche une alerte sur le foyer : fonds en euros 19 % > 15 %, crypto 2,7 % > 2,5 %,
    // Europe 9,4 % < 12 %, Air Liquide à 6,8 % de son seuil, LDDS à son plafond, cours du bitcoin vieux de 6 jours.
    rules: [
      { type: "max_line_pct", pct: 15 },
      { type: "max_bloc_pct", bloc: "Crypto", pct: 2.5 },
      { type: "min_bloc_pct", bloc: "Europe", pct: 12 },
      { type: "price_floor", position_id: "pea-air-liquide", price: 170 },
      { type: "envelope_cap", envelope: "Livrets Sam", cap: 12000 },
      { type: "stale_prices", days: 4 },
    ],
    cushion: { mode: "amount", min: 15000, max: 20000 },
    recurring: [
      { id: "rec-pea", label: "Versement PEA Camille", positionId: "pea-etf-monde", amount: 300, day: 5, start: ago(245), lastApplied: ago(30).slice(0, 7), hypothesis: null },
      { id: "rec-livret", label: "Épargne Livret A", positionId: "livret-a", amount: 200, day: 1, start: ago(150), lastApplied: ago(3).slice(0, 7), hypothesis: null },
    ],
    todo: [
      { text: "Arbitrer 1 000 € du fonds en euros vers l'ETF Monde", amount: "1 000 €", done: false },
      { text: "Ouvrir un LDDS au nom de Camille", done: false },
    ],
    milestones: [
      { title: "Fin de la période d'essai de Sam", date: iso(now + 40 * DAY), warnDays: 60, text: "Revoir la répartition des versements programmés." },
    ],
    hypotheses: [
      { text: "Le compte courant commun est compté comme épargne de précaution.", done: false },
    ],
  };

  const profil = {
    foyer: { adultes: 2, enfants: 1, enfants14: 0, union: "joint", age: "a30", tmi: 30 },
    personnes: {
      p1: { nom: "Camille", salaire: 2800, salaireUnite: "nm", statut: "cadre", csp: "cadre", essai: false, autresRevenus: 0 },
      p2: { nom: "Sam", salaire: 2300, salaireUnite: "nm", statut: "nc", csp: "inter", essai: true, autresRevenus: 0 },
    },
    biens: [
      { id: "bien-rp", nom: "Appartement (résidence principale)", usage: "rp", valeur: 240000, part_p1: 50, crd: 150000, mensualite: 820, loyer: 0 },
    ],
    credits: [
      { id: "credit-auto", nom: "Prêt auto", owner: "commun", crd: 6500, mensualite: 210 },
    ],
    autres: { p1: { usage: 9000, entreprise: 0 }, p2: { usage: 6000, entreprise: 0 } },
    protection: {}, // non déclarée : le critère « Protection de la famille » reste à compléter (crédit + enfant)
    updatedAt: at(7, "18:40"),
  };

  const status = {
    lastRun: at(1, "20:31"),
    summary: "Cours mis à jour pour 5 lignes cotées, photo du jour enregistrée, aucun versement programmé ce jour.",
    alerts: [],
    missingPrices: 0,
  };

  const L = (id, type, categorie, libelle, montant, frequence = "mois") => ({ id, type, categorie, libelle, montant, frequence });
  const budget = {
    lignes: [
      L("bl-copro", "depense", "Logement", "Charges de copropriété", 180),
      L("bl-energie", "depense", "Logement", "Électricité et gaz", 140),
      L("bl-mrh", "depense", "Logement", "Assurance habitation", 30),
      L("bl-taxe-fonciere", "depense", "Logement", "Taxe foncière", 1100, "an"),
      L("bl-courses", "depense", "Alimentation", "Courses et marché", 750),
      L("bl-voiture", "depense", "Transport", "Carburant, entretien, assurance auto", 180),
      L("bl-tcl", "depense", "Transport", "Abonnement TCL (part salarié)", 35),
      L("bl-creche", "depense", "Enfants", "Crèche et activités", 300),
      L("bl-sante", "depense", "Santé", "Mutuelle et restes à charge", 60),
      L("bl-loisirs", "depense", "Loisirs", "Sorties, sport et vacances", 250),
      L("bl-abos", "depense", "Abonnements", "Téléphones, box internet, streaming", 75),
      L("bl-ir", "depense", "Impôts", "Impôt sur le revenu (prélèvement mensualisé)", 280),
      L("bl-divers", "depense", "Divers", "Cadeaux et imprévus", 120),
      L("bl-livret-a", "epargne", "Épargne", "Livret A", 200),
      L("bl-pea", "epargne", "Épargne", "PEA Camille", 300),
      L("bl-av", "epargne", "Épargne", "Assurance vie Sam", 150),
    ],
  };

  const O = o => Object.assign({ deja: 0, source: "poches", poches: [], enveloppes: [], rendement: 2 }, o);
  const objectifs = [
    O({ id: "obj-matelas", nom: "Matelas de précaution", type: "matelas", cible: 21100, dateCible: "2027-06-30", poches: ["Épargne"], rendement: 2.4, priorite: 1 }),
    O({ id: "obj-apport", nom: "Apport maison", type: "apport", cible: 60000, dateCible: "2029-06-30", poches: ["Épargne"], rendement: 2.4, priorite: 2 }),
    O({ id: "obj-retraite", nom: "Retraite", type: "retraite", cible: 400000, dateCible: "2058-01-01", poches: ["Monde", "Europe", "Asie"], rendement: 5, priorite: 3 }),
  ];

  // Profil de risque jamais rempli (le Diagnostic propose le questionnaire) ; aucune surcharge poche → classe.
  const risque = null, classes = {};

  /* Propositions de Claude en attente (entretien guidé) : un lot de cinq changements, comme si l'assistant venait de lire
     un relevé collé par l'utilisateur. `apres` (et `avant`) suivent les noms des colonnes SQL (voir supabase/migrations/0007). */
  const Pr = (id, cible, operation, ref, avant, apres, source, justification, minutes) => ({ id, lot: "demo-lot-1", cible, operation, ref, avant, apres,
    source, justification, statut: "en_attente", creeLe: new Date(now - minutes * 6e4).toISOString(), decideLe: null });
  const propositions = [
    Pr("prop-demo-protection", "protection", "creer", null, null, { prevoyance: true, emprunteur: true },
      "Déclaration de l'utilisateur pendant l'entretien", "Camille a une prévoyance d'entreprise complétée par un contrat individuel ; les deux prêts sont assurés à 100 % chacun.", 14),
    Pr("prop-demo-pea", "position", "modifier", "pea-etf-monde", { qty: 120 }, { qty: 124 },
      "Relevé PEA du 30/09 (collé par l'utilisateur)", "Le relevé indique 124 parts d'ETF MSCI World : 4 parts achetées depuis la dernière mise à jour.", 13),
    Pr("prop-demo-rp", "bien", "modifier", "bien-rp", { crd: 150000 }, { crd: 147800 },
      "Tableau d'amortissement du prêt immobilier (collé par l'utilisateur)", "Capital restant dû après l'échéance de septembre.", 12),
    Pr("prop-demo-sport", "budget", "creer", null, null, { type: "depense", categorie: "Loisirs", libelle: "Salle de sport", montant: 39, frequence: "mois" },
      "Relevé bancaire de septembre (collé par l'utilisateur)", "Prélèvement mensuel récurrent absent du budget.", 11),
    Pr("prop-demo-risque", "risque", "creer", null, null, { horizon: "8-15", reaction: "rien" },
      "Réponses de l'utilisateur pendant l'entretien", "Deux premières réponses du questionnaire de risque ; les huit autres restent à poser.", 10),
  ];

  // Aucun assistant connecté au départ : Store.surveillerConnexions(true) simule la connexion de Claude (onboarding).
  const connexions = [];

  /* Mémoire de l'agent : ce que Claude a retenu du foyer au fil des conversations (table memoire_agent). Un point « à suivre »
     échu (relevé de la SCPI, cohérent avec l'hypothèse de la ligne av-scpi) et un souvenir épinglé (période d'essai de Sam). */
  const Mem = (id, categorie, contenu, jours, o) => Object.assign({ id, categorie, contenu, echeance: null, epingle: false, source: "Claude", creeLe: at(jours, "20:15"), majLe: at(jours, "20:15") }, o);
  const memoire = [
    Mem("mem-demo-essai", "contexte", "Sam est en période d'essai dans son nouveau poste : le foyer préfère ne prendre aucun engagement long avant sa confirmation.", 21, { epingle: true }),
    Mem("mem-demo-style", "preference", "Camille préfère des explications courtes et chiffrées, avec un exemple concret, plutôt que de longs développements.", 34),
    Mem("mem-demo-maison", "projet", "Achat d'une maison vers 2029 dans l'Est lyonnais, avec une chambre de plus ; apport visé de 60 000 €.", 34),
    Mem("mem-demo-matelas", "decision", "Le Livret A et le LDDS restent le matelas de précaution ; les nouveaux versements vont au PEA de Camille (ETF Monde).", 21),
    Mem("mem-demo-pea-av", "explique", "Différence entre PEA et assurance vie déjà expliquée : plafond de versement du PEA, fiscalité après 5 ans (PEA) et 8 ans (assurance vie).", 21),
    Mem("mem-demo-scpi", "a_suivre", "Vérifier sur le relevé annuel la valeur de retrait de la SCPI de l'assurance vie de Sam.", 21, { echeance: ago(5) }),
  ];

  /* Savoir commun : 4 fiches d'exemple (le vrai contenu vient de la table savoir_fiches) et 4 repères dont les valeurs sont
     marquées « exemple » (les valeurs vérifiées viennent de la table reperes). */
  const src = (titre, url) => ({ titre, url, consulte_le: ago(30) });
  const fiches = [
    { slug: "livret-a-ldds", theme: "epargne", titre: "Livret A et LDDS : l'épargne de précaution", version: 1, misAJourLe: ago(30),
      resume: "Deux livrets réglementés, disponibles à tout moment et sans impôt : la place naturelle du matelas de précaution.",
      motsCles: ["livret a", "ldds", "épargne de précaution", "livret réglementé"],
      sources: [src("Livret A — service-public.fr", "https://www.service-public.fr/particuliers/vosdroits/F2365"), src("Livret de développement durable et solidaire (LDDS) — service-public.fr", "https://www.service-public.fr/particuliers/vosdroits/F2368")],
      contenu: [
        "## À quoi servent ces livrets",
        "Le **Livret A** et le **LDDS** sont des livrets réglementés : l'argent reste disponible à tout moment, le capital est garanti et les intérêts ne sont soumis ni à l'impôt sur le revenu ni aux prélèvements sociaux. C'est l'endroit naturel pour le matelas de précaution, cette réserve qui couvre quelques mois de dépenses en cas d'imprévu.",
        "## Les règles à connaître",
        "- Un seul Livret A et un seul LDDS par personne.\n- Plafond de dépôt : 22 950 € pour le Livret A, 12 000 € pour le LDDS (hors intérêts capitalisés).\n- Le taux est fixé par l'État et peut être révisé deux fois par an.",
        "## Ce qu'il faut garder en tête",
        "Le rendement de ces livrets suit à peu près l'inflation : ils protègent l'épargne de court terme, mais ne la font pas croître sur la durée. Au-delà du matelas, une épargne de long terme a d'autres enveloppes.",
        "Pour aller plus loin : [la fiche Livret A de service-public.fr](https://www.service-public.fr/particuliers/vosdroits/F2365).",
      ].join("\n\n") },
    { slug: "pea-fonctionnement", theme: "enveloppes", titre: "Le PEA : fonctionnement et fiscalité", version: 1, misAJourLe: ago(30),
      resume: "Une enveloppe pour investir en actions européennes, dont les gains échappent à l'impôt sur le revenu après 5 ans.",
      motsCles: ["pea", "plan d'épargne en actions", "actions", "fiscalité", "5 ans"],
      sources: [src("Plan d'épargne en actions (PEA) — service-public.fr", "https://www.service-public.fr/particuliers/vosdroits/F2385")],
      contenu: [
        "## Le principe",
        "Le **plan d'épargne en actions** (PEA) permet d'investir en actions d'entreprises européennes, directement ou au travers de fonds éligibles (dont de nombreux ETF). Chaque personne majeure peut en ouvrir un seul, dans la limite de 150 000 € de versements.",
        "## La fiscalité dépend de l'âge du plan",
        "- **Avant 5 ans** : un retrait entraîne en principe la clôture du plan, et les gains sont imposés.\n- **Après 5 ans** : les retraits sont possibles sans clôture ; les gains sont exonérés d'impôt sur le revenu, seuls les prélèvements sociaux restent dus.",
        "## Pourquoi l'ouvrir tôt",
        "Le délai de 5 ans court à partir du premier versement. Ouvrir un PEA avec une petite somme prend date, même si l'on n'investit davantage que plus tard.",
        "Les actions restent un placement risqué : leur valeur peut baisser fortement, ce qui les réserve à un horizon long.",
      ].join("\n\n") },
    { slug: "diversifier-ses-placements", theme: "marches", titre: "Diversifier ses placements", version: 1, misAJourLe: ago(45),
      resume: "Répartir son épargne entre plusieurs supports, zones et horizons réduit le risque de tout perdre sur un seul pari.",
      motsCles: ["diversification", "risque", "allocation", "etf", "horizon"],
      sources: [src("Espace épargnants — Autorité des marchés financiers", "https://www.amf-france.org/fr/espace-epargnants")],
      contenu: [
        "## L'idée",
        "Diversifier, c'est **ne pas mettre tous ses œufs dans le même panier** : répartir son épargne entre plusieurs types de placements (livrets, fonds en euros, actions, immobilier), plusieurs zones géographiques et plusieurs entreprises. Une mauvaise surprise sur l'un pèse alors moins sur l'ensemble.",
        "## Trois niveaux de diversification",
        "- **Entre classes d'actifs** : la part placée en actions dépend de l'horizon et de la tolérance aux baisses.\n- **À l'intérieur des actions** : un fonds indiciel mondial couvre des milliers d'entreprises en une seule ligne.\n- **Dans le temps** : investir régulièrement lisse le prix d'achat.",
        "## Ce que la diversification ne fait pas",
        "Elle réduit le risque propre à une entreprise ou un secteur, mais pas le risque de marché : lors d'une crise générale, presque tout baisse en même temps. D'où l'importance de garder le matelas de précaution à part.",
        "L'AMF rappelle qu'aucun rendement élevé n'existe sans risque élevé.",
      ].join("\n\n") },
    { slug: "taux-effort-hcsf", theme: "credit", titre: "Le taux d'effort et la norme du HCSF", version: 1, misAJourLe: ago(60),
      resume: "Les banques limitent les mensualités de crédit à 35 % des revenus, assurance comprise, et la durée à 25 ans.",
      motsCles: ["taux d'effort", "taux d'endettement", "hcsf", "crédit immobilier", "35 %"],
      sources: [src("Haut Conseil de stabilité financière — economie.gouv.fr", "https://www.economie.gouv.fr/hcsf")],
      contenu: [
        "## De quoi s'agit-il",
        "Le **taux d'effort** rapporte l'ensemble des mensualités de crédit (assurance emprunteur comprise) aux revenus nets du foyer. Le Haut Conseil de stabilité financière (HCSF) impose aux banques une norme : en règle générale, ce taux ne doit pas dépasser **35 %**, et la durée d'un crédit immobilier est limitée à **25 ans** (27 ans pour un logement neuf avec différé).",
        "## Un exemple",
        "Un foyer qui gagne 5 100 € nets par mois peut consacrer au plus environ 1 785 € par mois à l'ensemble de ses crédits, prêt immobilier, prêt auto et assurances comprises.",
        "## Les marges de souplesse",
        "- Les banques peuvent déroger à la norme pour une petite partie de leurs dossiers, en priorité pour la résidence principale.\n- Rembourser un petit crédit avant de demander un prêt immobilier libère de la capacité.",
        "Le reste à vivre, ce qui reste une fois les mensualités payées, compte aussi dans la décision de la banque.",
      ].join("\n\n") },
  ];
  const rep = (cle, libelle, valeur, unite, dateEffet, site, sourceUrl) => ({ cle, libelle, valeur, unite, dateEffet,
    sourceTitre: "Valeur d'exemple (démo) — " + site, sourceUrl, verifieLe: ago(20), mode: "manuel" });
  const reperes = [
    // Valeurs et dates d'effet alignées sur la migration 0010_savoir_reperes.sql (vérifiées le 2026-10-10).
    rep("livret_a_taux", "Taux du Livret A", 1.7, "%", "2026-08-01", "service-public.fr", "https://www.service-public.fr/particuliers/vosdroits/F2365"),
    rep("pea_plafond", "Plafond de versements du PEA", 150000, "€", "2014-01-01", "service-public.fr", "https://www.service-public.fr/particuliers/vosdroits/F2385"),
    rep("hcsf_taux_effort", "Taux d'effort maximal (norme HCSF)", 35, "%", "2022-01-01", "economie.gouv.fr", "https://www.economie.gouv.fr/hcsf"),
    rep("pfu_taux", "Prélèvement forfaitaire unique (prélèvements sociaux inclus)", 31.4, "%", "2026-01-01", "impots.gouv.fr", "https://www.impots.gouv.fr/particulier"),
  ];
  const savoir = { fiches, reperes };

  const DEMO = { positions, snapshots, tx, config, profil, status, budget, objectifs, risque, classes, propositions, connexions, memoire, savoir };
  root.DEMO = DEMO;
  if (typeof module === "object" && module.exports) module.exports = DEMO;
})(typeof window !== "undefined" ? window : globalThis);
