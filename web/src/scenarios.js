/* Scénarios de décision patrimoniale (SCN1 V1) : le calcul des cinq scénarios du premier lot, leur pertinence, leur enjeu et le tri « pour toi ».
   Module pur, sans DOM, au tutoiement. Spec : docs/superpowers/specs/2026-10-17-scn1-scenarios-design.md (§ 6 et § 7) ; cas de référence :
   test/fixtures/scenarios-cas.json (la fixture fait foi). Global Scenarios (navigateur), module CommonJS sous Node, copie générée dans le
   connecteur avec le moteur de projection (supabase/functions/mcp/projection-moteur.gen.js, npm run gen, décision D14) : un seul calcul
   pour l'app et pour Claude. Aucun texte ne vient du LLM : les phrases sont des gabarits de ce module.

   Scenarios.VERSION_CALCUL, CALCULS, THEMES
   Scenarios.simulerEnveloppes(data, plan, opts)            socle : des enveloppes « à la marge » sur les tirages du moteur PROJ (§ 6.2)
   Scenarios.pertinence(entree, data, today)                → { pertinent, personnes, raisons, manquants }
   Scenarios.enjeu(entree, data, today, { chemins })        → { p10, p50, p90, unite, statut, raison? }
   Scenarios.lister(catalogue, data, joues, today, opts)    → { pour_toi, par_theme, cartes, message }
   Scenarios.jouer(entree, data, reponses, today, opts)     → résultat (§ 6.7)
   Scenarios.reponsesValides(entree, reponses)              → null | [message]
   Scenarios.preremplir(entree, data, today)                → { id_question: valeur } (jamais par le LLM)
   Scenarios.pourToi(cartes, seuil)                         → { cles, message }

   data = forme de Projection.preparer ({ today, positions, instruments, config, profil, budget, objectifs, risque, reperes, … }) ;
   entree = ligne du catalogue (forme de l'app) ; reponses = { id de question: valeur } (nombres, booléens, dates ISO, options : jamais de texte libre).
   opts (tous facultatifs) : { chemins (2 000 par défaut ; 500 pour les cartes), graine, volatilite: 0 (mode déterministe des cas chiffrés à la main),
   frais, allocation, plafondPerAnnuel, budgetReference, hypotheses_classes } : les cinq derniers sont des points d'entrée des tests et des hypothèses
   dites (frais des enveloppes quand l'utilisateur ne les a pas renseignés, allocation, plafond de déduction du PER, dépenses essentielles de BUD1). */
(function (root, factory) {
  const cjs = typeof module === "object" && module.exports;
  const dep = (nom, global) => (cjs ? require("./" + nom + ".js") : root[global]);
  /* BUD1 (Budget.reference) n'existe pas encore : lecture facultative, jamais bloquante (voir lireEssentiels, point d'intégration). */
  const facultatif = (nom, global) => { try { return cjs ? require("./" + nom + ".js") : root[global]; } catch (e) { return undefined; } };
  const api = factory({
    O: dep("projection-outils", "ProjectionOutils"), F: dep("projection-fiscalite", "ProjectionFiscalite"), D: dep("projection-donnees", "ProjectionDonnees"),
    Proj: dep("projection", "Projection"), Calendrier: dep("calendrier", "Calendrier"), Calc: dep("calc", "Calc"), Plan: dep("plan", "Plan"),
    Marche: dep("marche", "Marche"), Reperes: dep("reperes", "Reperes"), Budget: facultatif("budget", "Budget"),
  });
  if (cjs) module.exports = api;
  else root.Scenarios = api;
})(typeof self !== "undefined" ? self : this, function (X) {
  "use strict";
  const { O, F, D, Proj, Calendrier, Calc, Plan, Marche, Reperes } = X;

  const VERSION_CALCUL = "scn-1.0.0";
  /** Thèmes, dans l'ordre d'affichage de l'onglet « Pour toi ». */
  const THEMES = ["epargne", "placements", "retraite", "banque", "immobilier", "famille"];
  const RAPPEL = "Une projection n'est pas une promesse. Boussole n'exécute rien : c'est toi qui décides et qui fais.";
  const MESSAGE_RIEN_URGENT = "Rien d'urgent ici. Parcours les thèmes si une question te parle.";
  const UNITE_ENJEU = "€/an d'aujourd'hui";
  /** Repères propres aux scénarios (conventions) : valeurs de secours seulement pour le seuil d'affichage, jamais pour un calcul fiscal. */
  const SEUIL_ENJEU_DEFAUT = 30;
  const EPS = 1e-9;

  const objet = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const liste = v => (Array.isArray(v) ? v : []);
  const somme = (l, f) => l.reduce((a, x) => a + f(x), 0);
  const r2 = x => (x == null || !isFinite(x) ? x : O.arrondi2(x));
  const nombre = v => (typeof v === "number" && isFinite(v)) || (typeof v === "string" && v.trim() !== "" && isFinite(+v));
  const copie = v => JSON.parse(JSON.stringify(v));

  /* ================================================================== repères */
  /** Lecteur de repères d'une entrée : v(cle) → valeur ou undefined ; trace les repères lus. */
  function lecteur(d) {
    const idx = O.indexReperes(d.reperes), lus = new Map();
    const v = cle => { const r = idx[cle]; if (!r) return undefined; lus.set(cle, r); return +r.valeur; };
    return { v, idx, lus };
  }
  /** Statut d'un repère à la date du jour : « a_reverifier » (fin de période passée ou vérifié il y a plus de 180 jours), « convention » ou « verifie ». */
  function statutRepere(r, today) {
    if ((r.dateFin && r.dateFin < today) || Reperes.aVerifier(r, today)) return "a_reverifier";
    return /^scn_|^suivi_/.test(r.cle) || /^Convention Boussole/.test(r.sourceTitre || "") ? "convention" : "verifie";
  }
  const hypotheseDe = (r, today) => ({ cle: r.cle, libelle: r.libelle, valeur: +r.valeur, unite: r.unite, statut: statutRepere(r, today),
    source: { titre: r.sourceTitre || null, url: r.sourceUrl || null, verifie_le: r.verifieLe || null }, date_effet: r.dateEffet || null, date_fin: r.dateFin || null });

  /* ================================================================== le foyer */
  /** Personnes du foyer { id, nom, naissance, salaire }, périmètre fiscal (couple à imposition commune), enveloppes par personne. */
  function foyer(d, today) {
    const profil = objet(d.profil), pers = objet(profil.personnes), f = objet(profil.foyer);
    const ids = ["p1", "p2"].filter(k => pers[k] && typeof pers[k] === "object");
    const personnes = ids.map(k => ({ id: k, nom: pers[k].nom || (k === "p1" ? "Personne 1" : "Personne 2"), naissance: pers[k].naissance || null,
      salaire: pers[k].salaire != null ? +pers[k].salaire : null, age: pers[k].naissance && O.estDate(pers[k].naissance) ? O.age(pers[k].naissance, today) : null }));
    const adultes = f.adultes != null ? +f.adultes : personnes.length;
    const couple = f.union === "joint" && adultes >= 2 && personnes.length >= 2;
    const enveloppes = Calendrier.enveloppes(d.positions, objet(d.config).enveloppes_infos, today).filter(e => !e.cloture);
    return { personnes, adultes, enfants: +f.enfants || 0, couple, enveloppes };
  }
  /** La personne détient-elle une enveloppe de l'une de ces familles de types ? (une enveloppe commune compte pour les deux) */
  const detient = (fo, personne, types) => fo.enveloppes.some(e => types.includes(e.type) && (e.titulaire === personne || e.titulaire === "commun" || !e.titulaire));
  const TYPES_PEA = F.PEA, TYPES_AV = F.AV;
  const famillesTypes = { pea: TYPES_PEA, assurance_vie: TYPES_AV, per: ["per"], compte_titres: ["compte_titres"], lep: ["lep"], livret_a: ["livret_a"], ldds: ["ldds"] };
  const nomEnveloppe = { pea: "PEA", assurance_vie: "assurance-vie", per: "PER", compte_titres: "compte-titres", lep: "LEP", livret_a: "Livret A", ldds: "LDDS" };

  /** TMI du foyer (%), ou null si elle est inconnue. */
  function tmiDe(d) {
    const v = objet(objet(d.config).projection).tmi_pct != null ? objet(objet(d.config).projection).tmi_pct : objet(objet(d.profil).foyer).tmi;
    return v == null || v === "" || !isFinite(+v) ? null : +v;
  }
  const capaciteDe = d => D.capaciteDeBase(d, {}).retenue;

  /* ================================================================== dépenses de référence et matelas (§ 7.4) */
  /* POINT D'INTÉGRATION BUD1 : nom du champ « dépenses essentielles » de Budget.reference (BUD1 tâche 7). Tant que BUD1 n'est pas en ligne,
     lireEssentiels rend null (ou le bouchon des tests, opts.budgetReference) et le calcul se replie sur le budget prévu, en le disant. */
  const CHAMP_ESSENTIELS = "essentiels";
  function lireEssentiels(d, today, opts) {
    const o = opts || {};
    let ref = null;
    try {
      if (o.budgetReference !== undefined) ref = typeof o.budgetReference === "function" ? o.budgetReference(d, { vue: "tout" }) : o.budgetReference;
      else if (X.Budget && typeof X.Budget.reference === "function") ref = X.Budget.reference(d, { vue: "tout" });
    } catch (e) { ref = null; }
    const v = ref && ref[CHAMP_ESSENTIELS];
    return nombre(v) && +v > 0 ? { montant: +v, source: "budget_reference", detail: ref.source || null } : null;
  }
  /** Dépenses mensuelles de référence : Budget.reference → budget prévu hors épargne → dépenses saisies du matelas → null. */
  function depensesReference(d, today, opts) {
    const e = lireEssentiels(d, today, opts);
    if (e) return e;
    const lignes = liste(objet(d.budget).lignes || d.budget);
    const prevues = Calc.depensesPrevues(d.budget, d.profil, d.config, "foyer");
    if (prevues > 0) return { montant: prevues, source: lignes.some(l => l && l.type === "depense") ? "budget_prevu" : "matelas_saisi", detail: null };
    return null;
  }
  /** Nombre de mois de la convention (§ 8.4) : 9 indépendant ou sans revenu d'activité, 6 un seul revenu, enfants ou revenus variables, sinon 3. */
  function moisConvention(d, fo, lire) {
    const rev = objet(objet(d.risque).reponses).revenus;
    if (rev === "independant" || rev === "sans") return { mois: lire("scn_matelas_mois_independant"), cle: "scn_matelas_mois_independant" };
    const actifs = fo.personnes.filter(p => p.salaire > 0).length;
    if (rev === "variables" || actifs < 2 || fo.enfants > 0) return { mois: lire("scn_matelas_mois_fragile"), cle: "scn_matelas_mois_fragile" };
    return { mois: lire("scn_matelas_mois_stable"), cle: "scn_matelas_mois_stable" };
  }
  /** Plafond de revenu fiscal de référence du LEP pour un nombre de parts : 1 part + n demi-parts + au plus un quart de part. */
  function plafondRfrLep(parts, lire) {
    const base = lire("lep_rfr_1_part"), demi = lire("lep_rfr_demi_part_sup"), quart = lire("lep_rfr_quart_part_sup");
    if ([base, demi, quart].some(v => v === undefined) || !(parts >= 1)) return null;
    const sup = Math.round((parts - 1) * 4) / 4, nDemi = Math.floor(sup / 0.5 + 1e-9), nQuart = sup - nDemi * 0.5 > 1e-9 ? 1 : 0;
    return base + nDemi * demi + nQuart * quart;
  }
  /** État du matelas du foyer : dépenses, mois, cible, actuel, surplus, manque ; null si les dépenses sont inconnues. */
  function etatMatelas(d, today, lire, opts, rep) {
    const fo = foyer(d, today), dep = depensesReference(d, today, opts);
    if (!dep) return { dep: null, fo };
    const conv = moisConvention(d, fo, lire), mois = rep && nombre(rep.mois) ? +rep.mois : conv.mois, prevue = rep && nombre(rep.depense_prevue) ? +rep.depense_prevue : 0;
    const cible = mois * dep.montant + prevue;
    const dispo = Calc.matelasDisponible(d.positions, "foyer", { config: d.config, depenses: dep.montant });
    return { fo, dep, mois, convention: conv, prevue, cible, actuel: dispo.total, dispo, surplus: Math.max(0, dispo.total - cible), manque: Math.max(0, cible - dispo.total) };
  }

  /* ================================================================== questions : préremplissage, validité, manquants */
  /** Poids de l'allocation cible (somme 1) : opts.allocation (en %) → config.targets → null. */
  function allocationDe(d, opts) {
    const a = opts && opts.allocation;
    if (a && typeof a === "object") {
      const t = somme(Object.values(a), x => +x || 0);
      if (t > 0) return Object.fromEntries(Object.keys(a).filter(k => +a[k] > 0).map(k => [k, +a[k] / t]));
    }
    return D.ciblesAllocation(d, "foyer");
  }
  const ESTACTIONS = k => /^actions/.test(k);
  const partActions = alloc => (alloc ? somme(Object.keys(alloc).filter(ESTACTIONS), k => alloc[k]) : 0);

  /** Objectifs à venir, du plus proche : { id, date, mois }. */
  function objectifsAVenir(d, today) {
    return liste(d.objectifs).map(o => ({ o, date: o && (o.dateCible || o.date_cible) })).filter(x => x.date && O.estDate(x.date) && x.date > today)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  const anneesEntre = (today, date) => Math.max(1, Math.round(O.moisEntre(today, date) / 12));

  /** Préremplissage des questions depuis les données de Boussole (§ 9.4) : { id: valeur } pour celles qu'on sait remplir. */
  function preremplir(entree, data, today, opts) {
    const d = Object.assign({}, data, { today }), fo = foyer(d, today), L = lecteur(d), out = {};
    const alloc = allocationDe(d, opts), cap = capaciteDe(d), suivi = L.v("suivi_horizon_suppose_ans");
    const prochain = objectifsAVenir(d, today)[0];
    const val = {
      zero: () => 0,
      capacite: () => (cap > 0 ? Math.round(cap) : undefined),
      capacite_x_part_actions: () => (cap > 0 && alloc && partActions(alloc) > 0 ? Math.round(cap * partActions(alloc)) : undefined),
      horizon_objectif: () => (prochain ? anneesEntre(today, prochain.date) : suivi),
      horizon_objectif_actions: () => (prochain ? anneesEntre(today, prochain.date) : suivi),
      destination_actions: () => "compte_titres",
      tmi: () => { const t = tmiDe(d); return t == null ? undefined : t; },
      objectif_rp: () => false,
      statut_risque: () => (objet(objet(d.risque).reponses).revenus === "independant" ? "independant" : "salarie"),
      mois_convention: () => moisConvention(d, fo, L.v).mois,
      cinq: () => 5,
      compte_titres: () => "compte_titres",
      part_fonds_euros_cible: () => (alloc ? Math.round((alloc.fonds_euros || 0) * 100) : undefined),
      maintenant: () => "maintenant",
      non: () => false,
    };
    liste(entree.questions).forEach(q => { if (q.prerempli && val[q.prerempli]) { const v = val[q.prerempli](); if (v !== undefined && v !== null) out[q.id] = v; } });
    return out;
  }

  /** Contrôle strict des réponses d'après les questions du catalogue : clé inconnue, type, borne, option, texte libre. → null si tout va bien, sinon la liste des messages. */
  function reponsesValides(entree, reponses) {
    const qs = Object.fromEntries(liste(entree.questions).map(q => [q.id, q])), r = objet(reponses), msgs = [];
    Object.keys(r).forEach(k => {
      const q = qs[k], v = r[k];
      if (!q) { msgs.push("« " + k + " » n'est pas une question de ce scénario"); return; }
      if (v === null || v === undefined) return;
      const hors = () => msgs.push("« " + k + " » : valeur hors des bornes");
      switch (q.type) {
        case "montant_eur": case "entier": case "pourcentage":
          if (typeof v !== "number" || !isFinite(v)) { msgs.push("« " + k + " » doit être un nombre"); break; }
          if (q.type === "entier" && !Number.isFinite(v)) { msgs.push("« " + k + " » doit être un nombre"); break; }
          if ((q.min != null && v < q.min) || (q.max != null && v > q.max)) hors();
          break;
        case "booleen": if (typeof v !== "boolean") msgs.push("« " + k + " » doit être oui ou non"); break;
        case "date": if (typeof v !== "string" || !O.estDate(v)) msgs.push("« " + k + " » doit être une date AAAA-MM-JJ"); break;
        case "choix": if (!liste(q.options).some(o => o === v)) msgs.push("« " + k + " » : choix inconnu"); break;
        default: msgs.push("« " + k + " » : type de question inconnu");
      }
    });
    return msgs.length ? msgs : null;
  }

  /* ================================================================== tirages (mêmes nombres aléatoires que le moteur) */
  let cacheTirages = null;
  /** Normales corrélées par classe, mises en cache : même (chemins, graine) → mêmes tirages, étendus si besoin (le préfixe de mois est identique). */
  function tirer(P, T, graine, classes) {
    const c = cacheTirages, memeChemins = c && c.P === P && c.graine === graine;
    if (memeChemins && c.T >= T && classes.every(k => c.z[k])) return c;
    const T2 = Math.max(T, memeChemins ? c.T : 0), cl = [...new Set(classes.concat(memeChemins && c.T >= T2 ? Object.keys(c.z) : []))];
    cacheTirages = { P, graine, T: T2, z: Proj.tirages({ chemins: P, mois: T2, graine, classes: cl }) };
    return cacheTirages;
  }
  const quantile = (a, p) => O.centile(Array.from(a), p);
  const bande = a => { const t = Float64Array.from(a).sort(); return { p10: O.centileTrie(t, 0.1), p50: O.centileTrie(t, 0.5), p90: O.centileTrie(t, 0.9) }; };
  const bandeR = (a, f) => { const b = bande(a), g = f || (x => x); return { p10: r2(g(b.p10)), p50: r2(g(b.p50)), p90: r2(g(b.p90)) }; };

  /* ================================================================== le socle : simulerEnveloppes (§ 6.2) */
  const LIVRETS = F.LIVRETS.concat(["courant"]);
  const REPERE_LIVRET = { livret_a: "livret_a_taux", ldds: "livret_a_taux", lep: "lep_taux" };

  /** Versement brut mensuel du PER à effort net égal : v = m / (1 − TMI) tant que tout est déductible, sinon m + TMI × plafond / 12 (seul le plafond est déduit).
      → { v, deduit } par mois. plafond null ou undefined : aucun plafond. */
  function versementPer(effort, tmiPct, plafondAnnuel) {
    const t = tmiPct / 100;
    const v = effort / (1 - t);
    if (plafondAnnuel == null || 12 * v <= plafondAnnuel + EPS) return { v, deduit: v };
    return { v: effort + t * plafondAnnuel / 12, deduit: plafondAnnuel / 12 };
  }

  /** Simule des enveloppes pour chaque option d'un plan de flux, chemin par chemin, sur les tirages du moteur (§ 6.2). Retourne :
      { P, T, Tmax, graine, deterministe, today, options: { id: { net (€ d'aujourd'hui), courants, brut, impots, base, deduits } }, netA(id, t, sur) → sorties au mois t,
        ecart(a, b, t?), bascule(a, b), reperes, indisponible? }.
      plan = { T, couple, options: { id: [enveloppe] }, comparer?, reference?, v_min? } ; enveloppe = { type, ouverture_t, date_ouverture?, poches: [{ classe, part, frais_pct }],
      flux: [{ de, a, montant | effort_net, deduit? }], tmi_pct?, tmi_retraite_pct?, plafond_annuel?, plafond_premiere_annee? } ; un flux versé au mois t l'est en fin de mois t
      (t = 0 : aujourd'hui) ; un flux qui court jusqu'à T se prolonge jusqu'à opts.horizon_max (courbe selon la date de retrait). */
  function simulerEnveloppes(data, plan, opts) {
    const o = opts || {}, d = data || {}, today = d.today;
    const det = o.volatilite === 0, P = det ? 1 : Math.max(1, Math.round(o.chemins || 2000));
    const T = plan.T, Tmax = Math.max(T, Math.round(o.horizon_max || T)), graine = o.graine == null ? Proj.GRAINE : o.graine;
    const ctx = D.contexte(d, { hypotheses_classes: o.hypotheses_classes }), pi = ctx.pi, date = t => O.ajouterMois(today, t);
    const defl = t => Math.pow(1 + pi, t / 12);
    const ids = Object.keys(plan.options), manquants = new Set();
    const paramsClasse = {}, pc = k => (paramsClasse[k] || (paramsClasse[k] = D.parametresClasse(k, ctx)));
    const classes = new Set();
    ids.forEach(id => plan.options[id].forEach(e => liste(e.poches).forEach(p => { if (!LIVRETS.includes(e.type) && p.classe) classes.add(p.classe); })));
    const Z = det ? null : tirer(P, Tmax, graine, [...classes].filter(k => D.IDX[k] != null));
    const W = Tmax + 1;
    const envs = [], parOption = {};
    ids.forEach(id => {
      parOption[id] = plan.options[id].map(e => {
        /* flux mensuels de l'enveloppe (versements bruts) et part déductible (PER) */
        const m = new Float64Array(W), ded = new Float64Array(W);
        liste(e.flux).forEach(s => {
          const a = s.a >= T ? Tmax : s.a;
          for (let t = Math.max(0, s.de); t <= Math.min(a, Tmax); t++) {
            if (s.effort_net != null) {
              const cap = e.plafond_premiere_annee != null && t < s.de + 12 ? e.plafond_premiere_annee : e.plafond_annuel;
              const x = versementPer(s.effort_net, e.tmi_pct || 0, cap);
              m[t] += x.v; ded[t] += x.deduit;
            } else { m[t] += s.montant; ded[t] += s.deduit != null ? s.deduit : (e.type === "per" ? s.montant : 0); }
          }
        });
        const base = new Float64Array(W), dedCum = new Float64Array(W);
        for (let t = 0; t < W; t++) { base[t] = (t ? base[t - 1] : 0) + m[t]; dedCum[t] = (t ? dedCum[t - 1] : 0) + ded[t]; }
        const dateOuv = e.date_ouverture || date(e.ouverture_t || 0);
        /* règle fiscale (une fois par enveloppe) */
        const primes = e.type && F.AV.includes(e.type) ? base[T] + (o.primes_existantes || 0) : undefined;
        const fiscal = { type: e.type, valeur: 0, base: base[T], classe: "actions", date_ouverture: dateOuv, versements_deduits: e.type === "per" ? dedCum[T] : undefined };
        const ctxF = { reperes: d.reperes, couple: !!plan.couple, primes_titulaire: primes, tmi_pct: e.type === "per" ? e.tmi_retraite_pct : e.tmi_pct };
        const prep = F.preparer(fiscal, ctxF);
        if (prep.indisponible) prep.reperes.manquants.forEach(k => manquants.add(k));
        /* croissance des poches */
        const E = new Float64Array(P * W);
        if (LIVRETS.includes(e.type)) {
          const cle = REPERE_LIVRET[e.type], r = cle ? ctx.R[cle] : null, central = pc("monetaire"), ac = Math.log(1 + central.rendement / 100) / 12;
          const ar = r ? Math.log(1 + +r.valeur / 100) / 12 : e.type === "courant" ? 0 : ac, fin = r && r.dateFin;
          if (r) ctx.rv(cle);
          const g = new Float64Array(W);
          for (let t = 1; t < W; t++) g[t] = Math.exp(!fin || date(t) <= fin ? ar : ac);
          for (let i = 0; i < P; i++) { let v = m[0]; E[i * W] = v; for (let t = 1; t < W; t++) { v = v * g[t] + m[t]; E[i * W + t] = v; } }
        } else {
          liste(e.poches).forEach(p => {
            const par = pc(p.classe), a = Math.log(1 + par.rendement / 100) / 12, s = det ? 0 : par.volatilite / 100 / Math.sqrt(12);
            const feeM = Math.pow(1 - (p.frais_pct || 0) / 100, 1 / 12), z = s > 0 && Z ? Z.z[p.classe] : null, Tz = Z ? Z.T : 0;
            for (let i = 0; i < P; i++) {
              let v = p.part * m[0]; E[i * W] += v;
              for (let t = 1; t < W; t++) {
                const g = z ? Math.exp(a + s * z[i * Tz + (t - 1)]) : Math.exp(a);
                v = v * g * feeM + p.part * m[t]; E[i * W + t] += v;
              }
            }
          });
        }
        const env = { e, type: e.type, E, base, dedCum, prep, dateOuv, ouv_t: e.ouverture_t || 0, ctxF, preps: new Map() };
        envs.push(env);
        return env;
      });
    });
    if (manquants.size) return { indisponible: true, reperes_manquants: [...manquants], P, T, Tmax, graine, deterministe: det };
    /* sorties d'une option à un mois de sortie t (t ≥ ouverture) ; `sur` = { tmi_per } remplace la TMI de retraite du PER */
    function netA(id, t, sur) {
      const courants = new Float64Array(P), brut = new Float64Array(P), impots = new Float64Array(P), ps = new Float64Array(P);
      const dt = date(t);
      parOption[id].forEach(env => {
        let prep = env.prep;
        if (sur && sur.tmi_per != null && env.type === "per") {
          if (!env.preps.has(sur.tmi_per)) env.preps.set(sur.tmi_per, F.preparer({ type: "per", valeur: 0, base: env.base[T], classe: "actions", date_ouverture: env.dateOuv, versements_deduits: env.dedCum[T] },
            Object.assign({}, env.ctxF, { tmi_pct: sur.tmi_per })));
          prep = env.preps.get(sur.tmi_per);
        }
        const b = env.base[t];
        for (let i = 0; i < P; i++) {
          const v = env.E[i * W + t], x = prep.calculer(v, b, dt, undefined);
          brut[i] += v; impots[i] += x.ir + x.ps; ps[i] += x.ps; courants[i] += v - x.ir - x.ps;
        }
      });
      const f = 1 / defl(t), auj = new Float64Array(P);
      for (let i = 0; i < P; i++) auj[i] = courants[i] * f;
      return { courants, net: auj, brut, impots, ps, base: somme(parOption[id], env => env.base[t]), deduits: somme(parOption[id], env => env.dedCum[t]), t };
    }
    const options = {};
    ids.forEach(id => { options[id] = netA(id, T); });
    const ecart = (a, b, t) => {
      const A = t == null ? options[a] : netA(a, t), B = t == null ? options[b] : netA(b, t), dl = new Float64Array(P), dc = new Float64Array(P);
      let mieux = 0;
      for (let i = 0; i < P; i++) { dl[i] = A.net[i] - B.net[i]; dc[i] = A.courants[i] - B.courants[i]; if (dl[i] > 1e-7) mieux++; }
      return { delta: dl, courants: dc, p10: quantile(dl, 0.1), p50: quantile(dl, 0.5), p90: quantile(dl, 0.9), probabilite_mieux: mieux / P };
    };
    /* date de bascule : premier mois de sortie à partir duquel l'écart médian reste > 0 jusqu'à T (grille mensuelle) */
    const bascule = (a, b) => {
      let premier = null;
      for (let t = T; t >= 1; t--) {
        if (t < Math.max(...parOption[a].concat(parOption[b]).map(env => env.ouv_t))) break;
        const m = quantile(ecart(a, b, t).courants, 0.5);
        if (m > 1e-6) premier = t; else break;
      }
      return premier == null ? null : { t: premier, date: date(premier) };
    };
    /* le petit versement de « prendre date » : même enveloppe que la première option comparée, compté à part */
    let v_min = null;
    if (plan.v_min && plan.comparer) {
      const env0 = parOption[plan.comparer[0]][0], vm = plan.v_min, tt = vm.t || 1;
      const poches = (env0.e.poches || []), brut = new Float64Array(P), sansFrais = new Float64Array(P), net = new Float64Array(P);
      poches.forEach(p => {
        const par = pc(p.classe), a = Math.log(1 + par.rendement / 100) / 12, s = det ? 0 : par.volatilite / 100 / Math.sqrt(12);
        const feeM = Math.pow(1 - (p.frais_pct || 0) / 100, 1 / 12), z = s > 0 && Z ? Z.z[p.classe] : null, Tz = Z ? Z.T : 0;
        for (let i = 0; i < P; i++) {
          let v = p.part * vm.montant, w = v;
          for (let t = tt + 1; t <= T; t++) { const g = z ? Math.exp(a + s * z[i * Tz + (t - 1)]) : Math.exp(a); v *= g * feeM; w *= g; }
          brut[i] += v; sansFrais[i] += w;
        }
      });
      const prep = F.preparer({ type: env0.type, valeur: 0, base: vm.montant, classe: "actions", date_ouverture: env0.dateOuv }, { reperes: d.reperes, couple: !!plan.couple });
      for (let i = 0; i < P; i++) { const x = prep.calculer(brut[i], vm.montant, date(T), undefined); net[i] = brut[i] - x.ir - x.ps; }
      v_min = { brut, net, frais: sansFrais.map((w, i) => w - brut[i]) };
    }
    return { P, T, Tmax, graine, deterministe: det, today, options, netA, ecart, bascule, v_min, date, defl, envs, parOption, reperes: ctx.utilises, ctx };
  }

  /** Cherche x dans [lo, hi] tel que f(x) = 0, f décroissante, par dichotomie (12 itérations au plus). → { x, etat: "ok" | "aucun" (f(lo) ≤ 0) | "au_dela" (f(hi) > 0) }. */
  function seuilDichotomie(f, lo, hi, n) {
    if (!(f(lo) > 0)) return { x: null, etat: "aucun" };
    if (f(hi) > 0) return { x: null, etat: "au_dela" };
    let a = lo, b = hi;
    for (let k = 0; k < (n || 12); k++) { const m = (a + b) / 2; if (f(m) > 0) a = m; else b = m; }
    return { x: (a + b) / 2, etat: "ok" };
  }

  /* ================================================================== textes et formats */
  const eur0 = x => O.eur(Math.round(x / 10) * 10);          // arrondi à la dizaine d'euros pour l'affichage
  const dateFr = iso => Calendrier.dateFr(iso);
  const ans = h => (Math.abs(h - Math.round(h)) < 0.05 ? String(Math.round(h)) : O.frc(h, 1)) + (Math.round(h) > 1 || h >= 2 ? " ans" : " an");
  const ENVELOPPE_LIBELLE = { pea: "PEA", assurance_vie: "assurance-vie", per: "PER", compte_titres: "compte-titres", "pea+av": "PEA + assurance-vie", "cto+av": "compte-titres + assurance-vie",
    av: "assurance-vie", cto: "compte-titres" };

  /* ================================================================== frais (hypothèses dites) */
  /** Frais annuels par enveloppe, en % : opts.frais d'abord, puis les frais renseignés (config.frais_enveloppes), sinon 0 — dit dans les avertissements. */
  function fraisDe(d, opts, rep) {
    const o = objet(opts && opts.frais), cfg = objet(objet(d.config).frais_enveloppes), inconnus = [];
    const parType = (types, cle) => { const e = Object.keys(cfg).find(k => types.includes(objet(objet(objet(d.config).enveloppes_infos)[k]).type || Calendrier.typeDeduit(k))); return e && cfg[e][cle] != null ? +cfg[e][cle] : undefined; };
    const lu = (cle, repli) => { if (o[cle] != null) return +o[cle]; if (repli !== undefined) return repli; inconnus.push(cle); return 0; };
    const ter = o.ter_pct != null ? +o.ter_pct : (inconnus.push("ter_pct"), 0);
    return {
      ter_pct: ter,
      pea_pct: rep && nombre(rep.frais_pea_pct) ? +rep.frais_pea_pct : lu("pea_pct", parType(TYPES_PEA, "garde_pct")),
      compte_titres_pct: lu("compte_titres_pct", parType(["compte_titres"], "garde_pct")),
      assurance_vie_pct: rep && nombre(rep.frais_contrat_pct) ? +rep.frais_contrat_pct : lu("assurance_vie_pct", parType(TYPES_AV, "gestion_uc_pct")),
      fonds_euros_pct: rep && nombre(rep.frais_contrat_pct) ? +rep.frais_contrat_pct : lu("fonds_euros_pct", parType(TYPES_AV, "gestion_euro_pct")),
      per_pct: lu("per_pct", parType(["per"], "gestion_uc_pct")),
      inconnus: [...new Set(inconnus)],
    };
  }
  /** Poches d'une enveloppe selon l'allocation : fonds euros = frais de gestion du contrat seulement (pas de TER), autres classes = TER + frais d'enveloppe. */
  function poches(alloc, frais, fraisEnveloppe, fraisEuro) {
    return Object.keys(alloc).map(k => ({ classe: k, part: alloc[k], frais_pct: k === "fonds_euros" ? fraisEuro : frais.ter_pct + fraisEnveloppe }));
  }
  /** Répartit des flux mensuels entre une enveloppe plafonnée et son débordement : le versement qui dépasse le plafond (cumul) va au débordement. → { dedans, debordement, plafond_atteint_t }. */
  function repartirPlafond(flux, plafond) {
    const dedans = [], deborde = [];
    let cumul = 0, atteint = null;
    flux.forEach(s => {
      for (let t = s.de; t <= s.a; t++) {
        const libre = Math.max(0, plafond - cumul), vers = Math.min(libre, s.montant), reste = s.montant - vers;
        cumul += vers;
        if (vers > 0) dedans.push({ de: t, a: t, montant: vers });
        if (reste > EPS) deborde.push({ de: t, a: t, montant: reste });
        if (atteint == null && plafond - cumul <= EPS) atteint = t;
      }
    });
    const fusion = l => l.reduce((out, s) => { const p = out[out.length - 1]; if (p && p.a + 1 === s.de && Math.abs(p.montant - s.montant) < 1e-9) p.a = s.a; else out.push({ de: s.de, a: s.a, montant: s.montant }); return out; }, []);
    return { dedans: fusion(dedans), debordement: fusion(deborde), plafond_atteint_t: atteint, verse_dedans: cumul };
  }
  /** Flux d'un versement de départ et d'un versement mensuel : le tout au mois 1, puis le mensuel jusqu'au mois T. */
  function fluxDepart(V0, m, de, T) {
    const out = [];
    if (de > T) return out;
    if (V0 > 0) { out.push({ de, a: de, montant: V0 + m }); if (de + 1 <= T) out.push({ de: de + 1, a: T, montant: m }); }
    else out.push({ de, a: T, montant: m });
    return out.filter(s => s.montant > 0);
  }

  return {
    VERSION_CALCUL, THEMES, RAPPEL, MESSAGE_RIEN_URGENT, UNITE_ENJEU,
    simulerEnveloppes, seuilDichotomie, versementPer, repartirPlafond, plafondRfrLep, reponsesValides, preremplir, tirer, bande,
    _interne: { foyer, lecteur, statutRepere, hypotheseDe, tmiDe, capaciteDe, etatMatelas, depensesReference, lireEssentiels, allocationDe, fraisDe, poches, fluxDepart,
      detient, famillesTypes, nomEnveloppe, partActions, objectifsAVenir, quantile, bandeR, eur0, dateFr, ans, copie, somme, r2, objet, liste, nombre, SEUIL_ENJEU_DEFAUT, ENVELOPPE_LIBELLE },
  };
});
