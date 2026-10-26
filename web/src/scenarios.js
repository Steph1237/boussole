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
   Scenarios.varianteRetenue(entree, resultat, option_id)   → { nom, description, hypotheses: { enveloppe_scenario } } (variante figée, rejouée par le moteur proj-1.3.0)
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
    Proj: dep("projection", "Projection"), Calendrier: dep("calendrier", "Calendrier"), Calc: dep("calc", "Calc"),
    Reperes: dep("reperes", "Reperes"), E: dep("projection-evenements", "ProjectionEvenements"), Budget: facultatif("budget", "Budget"),
    PC: dep("projection-credit", "ProjectionCredit"),
  });
  if (cjs) module.exports = api;
  else root.Scenarios = api;
})(typeof self !== "undefined" ? self : this, function (X) {
  "use strict";
  const { O, F, D, Proj, Calendrier, Calc, Reperes, E, PC } = X;

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
  const p3 = x => Math.round(x * 1000) / 1000;
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
  /** Enveloppes du foyer { cle, nom, type, titulaire, infos } d'après les lignes ouvertes et enveloppes_infos (types déclarés, sinon déduits du nom, comme le calendrier). */
  function lesEnveloppes(d) {
    const inf = objet(objet(d.config).enveloppes_infos), vues = new Map(), pos = liste(d.positions);
    pos.filter(p => p && typeof p.envelope === "string" && p.envelope.trim() && p.status !== "clôturé").forEach(p => {
      const cle = Calendrier.cleEnveloppe(p.envelope, p.owner, pos, inf);
      if (vues.has(cle)) return;
      const i = objet(inf[cle]), type = typeof i.type === "string" ? i.type : Calendrier.typeDeduit(p.envelope);
      vues.set(cle, { cle, nom: p.envelope.trim(), type, titulaire: ["p1", "p2", "commun"].includes(i.titulaire) ? i.titulaire : p.owner, infos: i });
    });
    Object.keys(inf).filter(k => !vues.has(k) && inf[k] && typeof inf[k] === "object").forEach(k => {
      const i = inf[k];
      if (i.date_cloture) return;
      vues.set(k, { cle: k, nom: k.replace(/\|p[12]$/, ""), type: typeof i.type === "string" ? i.type : Calendrier.typeDeduit(k), titulaire: ["p1", "p2", "commun"].includes(i.titulaire) ? i.titulaire : null, infos: i });
    });
    return [...vues.values()];
  }
  /** Personnes du foyer { id, nom, naissance, salaire }, périmètre fiscal (couple à imposition commune), enveloppes par personne. */
  function foyer(d, today) {
    const profil = objet(d.profil), pers = objet(profil.personnes), f = objet(profil.foyer);
    const ids = ["p1", "p2"].filter(k => pers[k] && typeof pers[k] === "object");
    const personnes = ids.map(k => ({ id: k, nom: pers[k].nom || (k === "p1" ? "Personne 1" : "Personne 2"), naissance: pers[k].naissance || null,
      salaire: pers[k].salaire != null ? +pers[k].salaire : null, age: pers[k].naissance && O.estDate(pers[k].naissance) ? O.age(pers[k].naissance, today) : null }));
    const adultes = f.adultes != null ? +f.adultes : personnes.length;
    const couple = f.union === "joint" && adultes >= 2 && personnes.length >= 2;
    const enveloppes = lesEnveloppes(d);
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
  /** Éligibilité au LEP d'après l'avis d'impôt (revenu fiscal de référence de l'année N − 1 ou N − 2) et le nombre de parts (réponse, sinon l'avis).
      → { eligible: vrai | faux | null, plafond_rfr, rfr, parts, avis_trop_ancien }. */
  function eligibiliteLep(d, today, lire, partsReponse) {
    const avis = objet(objet(d.config).avis_impot), parts = nombre(partsReponse) ? +partsReponse : nombre(avis.parts) ? +avis.parts : null, rfr0 = nombre(avis.rfr) ? +avis.rfr : null;
    const annee = nombre(avis.annee_revenus) ? +avis.annee_revenus : null, tropAncien = annee != null && annee < +today.slice(0, 4) - 2, rfr = tropAncien ? null : rfr0;
    const plafond = parts != null ? plafondRfrLep(parts, lire) : null;
    return { eligible: plafond != null && rfr != null ? rfr <= plafond : null, plafond_rfr: plafond, rfr, parts, avis_trop_ancien: tropAncien ? annee : null };
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
      oui: () => true,
      vingt: () => 20,
      horizon_objectif_ou_vingt: () => (prochain ? anneesEntre(today, prochain.date) : 20),
      regime_lmnp_reel: () => "lmnp_reel",
      repere_vacance: () => L.v("scn_locatif_vacance_mois"),
      repere_taux_credit_20: () => L.v("taux_credit_immo_20"),
      repere_frais_souscription_scpi: () => L.v("scn_scpi_frais_souscription_pct"),
      repere_distribution_scpi: () => L.v("scpi_taux_distribution"),
      repere_prix_part_scpi: () => { const t = L.v("rendement_central_immobilier"), dd = L.v("scpi_taux_distribution"); return t === undefined || dd === undefined ? undefined : Math.round((t - dd) * 100) / 100; },
      frais_av_renseignes: () => { const f = fraisDe(d, opts, null); return f.inconnus.includes("assurance_vie_pct") ? undefined : f.assurance_vie_pct; },
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
    const ids = Object.keys(plan.options), manquants = new Set(), mentions = [], avApres = { vu: false };
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
        const dateOuv = e.date_ouverture !== undefined ? e.date_ouverture : date(e.ouverture_t || 0);
        /* règle fiscale (une fois par enveloppe) */
        const primes = e.type && F.AV.includes(e.type) ? base[T] + (e.primes_existantes || 0) : undefined;
        const fiscal = { type: e.type, valeur: 0, base: base[T], classe: "actions", date_ouverture: dateOuv, versements_deduits: e.type === "per" ? dedCum[T] : undefined };
        const ctxF = { reperes: d.reperes, couple: !!plan.couple, primes_titulaire: primes, tmi_pct: e.type === "per" ? e.tmi_retraite_pct : e.tmi_pct };
        const prep = F.preparer(fiscal, ctxF);
        if (prep.indisponible) prep.reperes.manquants.forEach(k => manquants.add(k));
        /* mentions de la règle fiscale (date d'ouverture inconnue : règle d'avant 5 ou 8 ans appliquée) : rendues au résultat, jamais tues */
        prep.mentions.filter(t => !/^bloqué/.test(t)).forEach(t => { if (!mentions.some(x => x.texte === t && x.type === e.type)) mentions.push({ type: e.type, libelle: e.libelle || null, texte: t }); });
        /* croissance des poches */
        const E = new Float64Array(P * W), fraisT = new Float64Array(P);
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
                const av = v * g;
                v = av * feeM + p.part * m[t]; E[i * W + t] += v;
                if (t <= T) fraisT[i] += av * (1 - feeM);
              }
            }
          });
        }
        const env = { e, type: e.type, E, fraisT, base, dedCum, prep, dateOuv, ouv_t: e.ouverture_t || 0, ctxF, preps: new Map() };
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
          if (x.apres && x.abat_utilise > 0 && t === T) avApres.vu = true;
          brut[i] += v; impots[i] += x.ir + x.ps; ps[i] += x.ps; courants[i] += v - x.ir - x.ps;
        }
      });
      const f = 1 / defl(t), auj = new Float64Array(P);
      for (let i = 0; i < P; i++) auj[i] = courants[i] * f;
      const frais = new Float64Array(P);
      parOption[id].forEach(env => { for (let i = 0; i < P; i++) frais[i] += env.fraisT[i]; });
      return { courants, net: auj, brut, impots, ps, frais, base: somme(parOption[id], env => env.base[t]), deduits: somme(parOption[id], env => env.dedCum[t]), t };
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
    return { P, T, Tmax, graine, deterministe: det, today, options, netA, ecart, bascule, v_min, date, defl, envs, parOption, reperes: ctx.utilises, ctx, mentions, abattement_av_utilise: avApres.vu };
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
  /** « que » élidé devant une voyelle : « qu'un compte-titres », « que ton assurance-vie ». */
  const que = t => (/^[aeiouyéèêh]/i.test(t) ? "qu'" : "que ") + t;
  const ans = h => (Math.abs(h - Math.round(h)) < 0.05 ? String(Math.round(h)) : O.frc(h, 1)) + (Math.round(h) > 1 || h >= 2 ? " ans" : " an");

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


  /* ================================================================== sorties communes */
  const ecartBandes = e => ({ p10: r2(e.p10), p50: r2(e.p50), p90: r2(e.p90) });
  const parAn = (b, H) => ({ p10: r2(b.p10 / H), p50: r2(b.p50 / H), p90: r2(b.p90 / H) });
  /** Option du résultat (§ 6.7) à partir des sorties du socle pour un mois de sortie. */
  function sortieOption(id, libelle, types, x, extras) {
    return Object.assign({ id, libelle, enveloppes: types, net: bandeR(x.net), verse: r2(x.base), brut_p50: r2(quantile(x.brut, 0.5)), impots_p50: r2(quantile(x.impots, 0.5)),
      prelevements_sociaux_p50: r2(quantile(x.ps, 0.5)), net_courants_p50: r2(quantile(x.courants, 0.5)), frais_p50: r2(quantile(x.frais, 0.5)), disponible: true, contraintes: [], exclue: null }, extras || {});
  }
  const optionExclue = (id, libelle, types, code, texte) => ({ id, libelle, enveloppes: types, net: null, verse: null, brut_p50: null, impots_p50: null, prelevements_sociaux_p50: null,
    net_courants_p50: null, frais_p50: null, disponible: false, contraintes: [texte], exclue: code });
  const ligne = (hypothese, valeur_retenue, seuil, effet, phrase) => ({ hypothese, valeur_retenue, seuil, effet, phrase });
  /** Date de sortie (mois t) d'après la date d'aujourd'hui. */
  const dateDe = (today, t) => O.ajouterMois(today, t);
  const seuilAnnees = (ouverture, n) => O.ajouterJours(O.ajouterAns(ouverture, n), 1);        // règle DAT1 : le lendemain de l'anniversaire

  /** Destination actuelle des versements (point de comparaison) : { type, libelle, frais_pct, ouverture_t, date_ouverture? }. */
  function referenceDe(destination, frais, fo) {
    const ter = frais.ter_pct;
    if (destination === "assurance_vie") {
      const dates = fo.enveloppes.filter(e => TYPES_AV.includes(e.type) && e.infos && O.estDate(e.infos.date_ouverture)).map(e => e.infos.date_ouverture).sort();
      return { type: "assurance_vie", libelle: "ton assurance-vie", frais_pct: ter + frais.assurance_vie_pct, ouverture_t: 0, date_ouverture: dates[0] || null };
    }
    if (destination === "livret") return { type: "livret_a", libelle: "un livret", frais_pct: 0, ouverture_t: 0 };
    if (destination === "courant") return { type: "courant", libelle: "ton compte courant", frais_pct: 0, ouverture_t: 0 };
    return { type: "compte_titres", libelle: "un compte-titres", frais_pct: ter + frais.compte_titres_pct, ouverture_t: 0 };
  }
  const envReference = (ref, flux) => {
    const e = { type: ref.type, libelle: ref.libelle, ouverture_t: ref.ouverture_t, poches: [{ classe: LIVRETS.includes(ref.type) ? "monetaire" : "actions", part: 1, frais_pct: ref.frais_pct }], flux };
    if (ref.date_ouverture !== undefined) e.date_ouverture = ref.date_ouverture;
    return e;
  };
  const simOptsDe = o => ({ chemins: o.chemins, graine: o.graine, volatilite: o.volatilite, hypotheses_classes: o.hypotheses_classes });
  const LIB_FRAIS = { ter_pct: "frais des fonds", pea_pct: "frais du PEA", compte_titres_pct: "frais du compte-titres", assurance_vie_pct: "frais de l'assurance-vie",
    fonds_euros_pct: "frais du fonds euros", per_pct: "frais du PER" };
  /** Phrase d'avertissement quand des frais du scénario (cles) ne sont pas renseignés : ils sont comptés à 0 %, et c'est dit, y compris quand cela avantage une option. */
  function avertFrais(f, cles) {
    const pert = cles || Object.keys(LIB_FRAIS), inc = pert.filter(k => f.inconnus.includes(k));
    if (!inc.length) return [];
    const noms = inc.map(k => LIB_FRAIS[k]).join(", "), incEnv = inc.filter(k => k !== "ter_pct"), connus = pert.filter(k => k !== "ter_pct" && !inc.includes(k));
    return [incEnv.length && connus.length
      ? "Frais non renseignés (" + noms + ") : comptés à 0 %, ce qui avantage ces enveloppes face à celles dont tu as donné les frais ; renseigne-les pour un chiffre complet."
      : "Frais non renseignés (" + noms + ") : comptés à 0 % pour toutes les options" + (incEnv.length ? ", la comparaison est alors seulement fiscale" : "") + " ; renseigne-les pour un chiffre complet."];
  }
  const cleFraisDe = type => (type === "compte_titres" ? "compte_titres_pct" : TYPES_AV.includes(type) ? "assurance_vie_pct" : TYPES_PEA.includes(type) ? "pea_pct" : type === "per" ? "per_pct" : null);


  /* ================================================================== variante retenue : hypothèse enveloppe_scenario (§ 6.6) */
  /** Allocation en pourcentages arrondis à 0,01 dont la somme fait exactement 100. */
  function allocationPct(alloc) {
    const ks = Object.keys(alloc).filter(k => alloc[k] > 0), t = somme(ks, k => alloc[k]);
    const out = Object.fromEntries(ks.map(k => [k, Math.round(alloc[k] / t * 10000) / 100]));
    const ecart = Math.round((100 - somme(ks, k => out[k])) * 100) / 100;
    if (ks.length && ecart) { const g = ks.slice().sort((a, b) => out[b] - out[a])[0]; out[g] = Math.round((out[g] + ecart) * 100) / 100; }
    return out;
  }
  /** Hypothèse enveloppe_scenario d'une option retenable (le moteur la rejoue : Projection, proj-1.3.0). p = { type, ouverture, allocation (poids), fraisEnveloppe, initial, mensuel, debut,
      plafond, debordement, per, transferts, titulaire }. */
  function hypotheseEnveloppe(c, p) {
    const livret = F.LIVRETS.includes(p.type), es = { scenario: c.entree.cle, version_calcul: c.entree.version_calcul || VERSION_CALCUL, type: p.type, titulaire: p.titulaire === "p2" ? "p2" : "p1", ouverture: p.ouverture };
    if (!livret) es.allocation = allocationPct(p.allocation);
    es.ter_pct = r2(c.frais.ter_pct); es.frais_enveloppe_pct = r2(p.fraisEnveloppe || 0);
    if (p.initial > 0) es.initial = { montant: r2(p.initial), depuis: "disponible" };
    if (p.mensuel > 0) es.mensuel = { montant: r2(p.mensuel), depuis: "capacite" };
    if (p.debut) es.debut = p.debut;
    if (p.plafond != null) { es.plafond_versements = r2(p.plafond); if (p.type !== "per") es.debordement = p.debordement || "compte_titres"; }
    if (p.per) es.per = p.per;
    if (p.transferts && p.transferts.length) es.transferts = p.transferts.map(x => ({ de: x.de, montant: r2(x.montant) }));
    const msg = E.validerEnveloppeScenario(es);
    return msg ? { erreur: msg } : { hypothese: es };
  }
  const NON_RETENABLE_REFERENCE = "C'est ce que tu fais déjà : il n'y a rien à retenir.";
  const NON_RETENABLE_MULTI = "Cette option répartit ton versement entre plusieurs enveloppes : une variante n'en porte qu'une pour l'instant.";

  /* ================================================================== n° 1 : faut-il ouvrir un PEA ? (§ 7.1) */
  function ouvrirPea(c) {
    const { d, today, rep, L, o, fo } = c;
    const T = Math.max(1, Math.round(rep.horizon_ans * 12)), H = T / 12, delai = L.v("scn_delai_ouverture_mois"), plafond = L.v("pea_plafond"), duree = L.v("pea_duree_ans");
    const frais = c.frais, ter = frais.ter_pct, V0 = +rep.versement_initial || 0, m = +rep.versement_mensuel || 0, fPea = ter + frais.pea_pct;
    const ref = referenceDe(rep.destination_actuelle || "compte_titres", frais, fo), pre = simOptsDe(o), plusTard = rep.debut === "plus_tard";
    const peaEnv = (ouv, flux, fp) => ({ type: "pea", ouverture_t: ouv, poches: [{ classe: "actions", part: 1, frais_pct: fp }], flux });
    const avert = avertFrais(frais, ["ter_pct", "pea_pct"].concat(plusTard ? [] : [cleFraisDe(ref.type)].filter(Boolean))), ctq = [];
    if (detient(fo, c.titulaire, TYPES_PEA)) avert.push("Tu as déjà un PEA, et on ne peut en avoir qu'un : ce calcul compare un PEA neuf, pour information seulement.");
    let plan, tete, refId, libTete, libRef, P0 = null, Tmax = T;
    if (!plusTard) {
      const flux = fluxDepart(V0, m, delai, T), rp = repartirPlafond(flux, plafond);
      const A = [peaEnv(delai, rp.dedans, fPea)];
      if (rp.debordement.length) A.push({ type: "compte_titres", ouverture_t: 0, poches: [{ classe: "actions", part: 1, frais_pct: ter + frais.compte_titres_pct }], flux: rp.debordement });
      plan = { T, couple: fo.couple, options: { A, R: [envReference(ref, flux)] }, comparer: ["A", "R"], reference: "R", plafond_pea: plafond };
      tete = "A"; refId = "R"; libTete = "PEA ouvert dans " + delai + " mois"; libRef = ref.libelle;
      if (rp.debordement.length) avert.push("Ton PEA atteint son plafond de " + O.eur(plafond) + " de versements : le surplus est placé en compte-titres, dans le calcul.");
    } else {
      P0 = Math.max(delai, O.moisEntre(today, rep.debut_date));
      const flux = [{ de: P0, a: T, montant: m }];
      Tmax = Math.max(T, P0 + duree * 12 + 12);
      plan = { T, couple: fo.couple, options: { A_prime: [peaEnv(delai, flux, fPea)], C: [peaEnv(P0, flux, fPea)] }, comparer: ["A_prime", "C"], reference: "C", v_min: { montant: V0, t: delai } };
      tete = "A_prime"; refId = "C"; libTete = "PEA ouvert maintenant avec un petit versement"; libRef = "PEA ouvert au début des versements";
    }
    const sim = simulerEnveloppes(d, plan, Object.assign({ horizon_max: Tmax }, pre));
    if (sim.indisponible) return { statut: "indisponible", reperes_manquants: sim.reperes_manquants };
    const e = sim.ecart(tete, refId), dateOuv = dateDe(today, delai), seuil5 = seuilAnnees(dateOuv, duree), enjeu = parAn(e, H);
    const opts = Object.keys(plan.options).map(id => sortieOption(id, id === tete ? libTete : libRef, plan.options[id].map(x => x.type), sim.options[id], { versements_pea: id === tete ? r2(somme(plan.options[id].filter(x => x.type === "pea"), x => somme(x.flux, s => s.montant * (s.a - s.de + 1)))) : undefined }));
    let bascule = null, seuilFrais = null, courbe = null, fenetre = null, anteriorite = null, vmin = null;
    if (!plusTard) {
      const b = sim.bascule(tete, refId); bascule = b && b.date;
      seuilFrais = seuilDichotomie(x => {
        const A2 = plan.options.A.map(env => (env.type === "pea" ? Object.assign({}, env, { poches: [{ classe: "actions", part: 1, frais_pct: ter + x }] }) : env));
        const s2 = simulerEnveloppes(d, { T, couple: fo.couple, options: { A: A2 } }, pre), n2 = s2.options.A.courants, nr = sim.options[refId].courants;
        return quantile(Array.from(n2, (v, i) => v - nr[i]), 0.5);
      }, 0, 2, 12);
      ctq.push(ligne("pea_5_ans", dateFr(dateDe(today, T)), dateFr(seuil5), "Avant cette date, le PEA ne te rapporte rien de plus",
        "Si tu as besoin de cet argent avant le " + dateFr(seuil5) + ", le PEA ne t'apporte rien : avant 5 ans, un retrait le clôture et le gain est imposé comme sur un compte-titres."));
      if (seuilFrais.etat === "ok") ctq.push(ligne("frais_pea", O.frc(fPea - ter, 2) + " %", O.frc(seuilFrais.x, 2) + " %", "Au-delà, le PEA passe derrière " + libRef,
        "Si les frais annuels du PEA dépassent " + O.frc(seuilFrais.x, 2) + " % (en plus des frais des fonds), il passe derrière " + libRef + "."));
    } else {
      const ecartsT = []; let premier = null, dernier = null;
      for (let t = delai; t <= Tmax; t++) {
        const x = sim.ecart(tete, refId, t), b = bandeR(x.delta);
        ecartsT.push({ t, date: sim.date(t), p10: b.p10, p50: b.p50, p90: b.p90, courants_p50: r2(quantile(x.courants, 0.5)) });
        if (quantile(x.courants, 0.5) > 1e-6) { if (premier == null) premier = sim.date(t); dernier = sim.date(t); }
      }
      courbe = { abscisse: "date_sortie", points: ecartsT }; fenetre = premier ? { du: premier, au: dernier } : null;
      anteriorite = { courants: r2(quantile(e.courants, 0.5)), auj: r2(e.p50) };
      if (sim.v_min) vmin = { brut: r2(quantile(sim.v_min.brut, 0.5)), net: r2(quantile(sim.v_min.net, 0.5)), frais: r2(quantile(sim.v_min.frais, 0.5)) };
      ctq.push(ligne("pea_5_ans", dateFr(dateDe(today, P0)), dateFr(seuil5), "L'avance prise compte pour une sortie entre deux dates",
        "Ouvrir maintenant ne compte que si tu retires entre le " + dateFr(fenetre ? fenetre.du : seuil5) + " et le " + dateFr(fenetre ? fenetre.au : seuil5) + " : avant, aucun écart ; après, les deux PEA ont plus de 5 ans."));
    }
    ctq.push(ligne("titres_eligibles", "non calculé", null, "Seuls certains titres sont acceptés dans un PEA",
      "Le PEA n'accepte que certains titres ; la liste des titres éligibles est fixée par la loi, et ce calcul ne la vérifie pas."));
    const enTete = Math.abs(e.p50) < 0.005 ? "egalite" : e.p50 > 0 ? tete : refId;
    const meilleur = courbe ? Math.max(0, ...courbe.points.map(x => x.p50)) : 0;
    const phrase = plusTard
      ? (fenetre ? "Ouvrir un PEA maintenant avec " + O.eur(V0) + " te ferait gagner jusqu'à environ " + eur0(meilleur) + " (en euros d'aujourd'hui) si tu retires entre le " + dateFr(fenetre.du) + " et le " + dateFr(fenetre.au) + " ; en dehors de ces dates, aucun écart."
        : "Ouvrir un PEA maintenant avec " + O.eur(V0) + " ne change rien dans cet horizon : l'avance de 5 ans ne compte pour aucune date de retrait.")
      : e.p50 > 0.005 ? "Avec " + O.eur(m) + "/mois sur " + ans(H) + ", un PEA te laisserait environ " + eur0(e.p50) + " de plus " + que(libRef) + ", en euros d'aujourd'hui."
        : dateDe(today, T) < seuil5 ? "Sur " + ans(H) + ", le PEA ne change rien par rapport à " + libRef + " : avant 5 ans, un retrait clôture le plan et le gain est imposé pareil."
          : "Sur " + ans(H) + ", un PEA ne ferait pas mieux " + que(libRef) + " avec ces hypothèses" + (e.p50 < -0.005 ? " : environ " + eur0(-e.p50) + " de moins, en euros d'aujourd'hui." : ".");
    const reponse = { phrase, option_en_tete: enTete, reference: refId, ecart: ecartBandes(e), ecart_annuel: enjeu, probabilite_mieux: p3(e.probabilite_mieux), date_bascule: bascule };
    const ecartsAnnuels = [];
    if (!plusTard) for (let t = 12; t <= T; t += 12) if (t >= delai) ecartsAnnuels.push({ t, date: sim.date(t), p50_courants: r2(quantile(sim.ecart(tete, refId, t).courants, 0.5)) });
    return {
      options: opts, reponse, courbe: courbe || undefined, ce_qui_changerait: ctq, avertissements: avert,
      enjeu_annuel: { p10: Math.min(enjeu.p10, enjeu.p50), p50: Math.max(0, enjeu.p50), p90: Math.max(enjeu.p90, enjeu.p50) }, sim,
      detail: { T, mode: plusTard ? "plus_tard" : "maintenant", seuil_5_ans: seuil5, frais_seuil_pct: seuilFrais && seuilFrais.etat === "ok" ? r2(seuilFrais.x * 1000) / 1000 : null, frais_seuil_etat: seuilFrais ? seuilFrais.etat : null,
        ecart_courants: r2(quantile(e.courants, 0.5)), ecarts_annuels: ecartsAnnuels, anteriorite, v_min: vmin, fenetre, plafond_utilise: plan.plafond_pea && plan.options.A ? r2(somme(plan.options.A.filter(x => x.type === "pea"), x => somme(x.flux, s => s.montant * (s.a - s.de + 1)))) : null },
      plan: { tete, reference: refId, plan, titulaire: c.titulaire },
      retenables: retenablesPea(c, plusTard, tete, refId, { V0, m, delai, P0, plafond, fPea, today }),
    };
  }
  /** Options retenables du n° 1 : le PEA ouvert maintenant (ou « avec un petit versement »). */
  function retenablesPea(c, plusTard, tete, refId, x) {
    const h = hypotheseEnveloppe(c, { type: "pea", titulaire: c.titulaire, ouverture: dateDe(x.today, x.delai), allocation: { actions: 1 }, fraisEnveloppe: c.frais.pea_pct, initial: x.V0, mensuel: x.m,
      debut: plusTard ? dateDe(x.today, x.P0) : null, plafond: x.plafond, debordement: "compte_titres" });
    return { options: { [tete]: h }, non: { [refId]: plusTard ? "Cette option sert de point de comparaison : ouvrir plus tard est ce qui se passe si tu ne fais rien maintenant." : NON_RETENABLE_REFERENCE } };
  }

  /* ================================================================== PER : plafond de déduction (§ 7.3) */
  /** Imputation d'un versement sur les plafonds de l'avis (F14709) : le plafond de l'année d'abord, puis les reportés du plus ancien au plus récent.
      lignes = [{ annee, montant }] ; un plafond de l'année Y se reporte jusqu'à la fin de Y + n (n = per_report_ans depuis 2026, per_report_ans_ancien avant).
      → { imputation: { annee: montant }, perdu: { date, montant } | null, total_disponible, non_deduit }. */
  function imputerPlafondsPer(lignes, versement, anneeVersement, reports) {
    const r = reports || {}, expire = a => a + (a >= 2026 ? r.recent : r.ancien);
    const utilisables = liste(lignes).filter(l => l && nombre(l.annee) && nombre(l.montant) && (r.recent == null || r.ancien == null || expire(+l.annee) >= anneeVersement))
      .map(l => ({ annee: +l.annee, reste: +l.montant, montant: +l.montant }));
    const ordre = utilisables.slice().sort((a, b) => (a.annee === anneeVersement ? -1 : b.annee === anneeVersement ? 1 : a.annee - b.annee));
    let reste = versement; const imputation = {};
    ordre.forEach(l => { const x = Math.min(reste, l.reste); imputation[l.annee] = x; l.reste -= x; reste -= x; });
    const perdus = r.recent == null ? [] : utilisables.filter(l => expire(l.annee) === anneeVersement && l.reste > EPS);
    return { imputation, perdu: perdus.length ? { date: anneeVersement + "-12-31", montant: r2(somme(perdus, l => l.reste)) } : null,
      total_disponible: r2(somme(utilisables, l => l.montant)), non_deduit: r2(Math.max(0, reste)) };
  }
  /** Économie d'impôt d'une déduction de `versement` sur un revenu net imposable `rni` de `parts` parts : chaque tranche du barème que la déduction traverse compte à son taux
      (décote et plafonnement du quotient familial non calculés). seuils = { 11, 30, 41, 45 } : début de chaque tranche, par part. */
  function economiePer(rni, parts, versement, seuils) {
    const tr = [[0, 0], [seuils[11], 0.11], [seuils[30], 0.3], [seuils[41], 0.41], [seuils[45], 0.45]];
    const haut = rni / parts, bas = Math.max(0, rni - versement) / parts, parTranche = {};
    let eco = 0;
    for (let k = 0; k < tr.length; k++) {
      const a = tr[k][0], b = k + 1 < tr.length ? tr[k + 1][0] : Infinity, part = Math.max(0, Math.min(haut, b) - Math.max(bas, a)) * parts;
      if (part > 0) { eco += part * tr[k][1]; parTranche[Math.round(tr[k][1] * 100)] = r2(part); }
    }
    const marginal = tr.reduce((t, x) => (haut > x[0] ? x[1] : t), 0);
    return { economie: r2(eco), economie_au_taux_marginal: r2(versement * marginal), part_par_taux: parTranche, bas_de_tranche: Math.abs(eco - versement * marginal) > 0.005 };
  }
  /** Plafond de déduction du PER pour le scénario : { annuel, premiere_annee, source, personne, texte }. Réglage de test > avis d'impôt de la personne la mieux dotée > plancher (estimation). */
  function plafondPer(d, today, L, fo, o) {
    if (o.plafondPerAnnuel != null) return { annuel: +o.plafondPerAnnuel, premiere_annee: +o.plafondPerAnnuel, source: "reglage", personne: null, texte: null };
    const pl = objet(objet(objet(d.config).avis_impot).plafonds_per), an = +today.slice(0, 4), reports = { recent: L.v("per_report_ans"), ancien: L.v("per_report_ans_ancien") };
    const limite = L.v("per_age_fin_deduction");
    const cand = fo.personnes.filter(p => limite == null || p.age == null || p.age < limite).map(p => {
      const lg = liste(pl[p.id]).filter(l => l && nombre(l.annee) && nombre(l.montant));
      const utiles = lg.filter(l => reports.recent == null || reports.ancien == null || (+l.annee + (+l.annee >= 2026 ? reports.recent : reports.ancien)) >= an);
      const dernier = lg.slice().sort((a, b) => b.annee - a.annee)[0];
      return { p, annuel: dernier ? +dernier.montant : null, total: somme(utiles, l => +l.montant) };
    }).filter(x => x.annuel != null).sort((a, b) => b.annuel - a.annuel);
    if (cand.length) return { annuel: cand[0].annuel, premiere_annee: Math.max(cand[0].annuel, cand[0].total), source: "avis", personne: cand[0].p.id, texte: null };
    const plancher = L.v("per_plafond_plancher");
    return { annuel: plancher, premiere_annee: plancher, source: "estimation", personne: null,
      texte: "Estimation : ton plafond exact est sur ton avis d'impôt (au minimum " + O.eur(plancher) + " par an pour un salarié, ou 10 % de tes revenus d'activité nets de frais)." };
  }

  /* ================================================================== n° 2 : où mettre le prochain euro ? (§ 7.2) */
  /** Enveloppe déjà détenue dans le foyer d'une famille de types : la plus ancienne dont la date d'ouverture est connue, sinon la première.
      → { cle, nom, type, titulaire, date_ouverture (null si inconnue), versements (versements cumulés connus ou null) } ou null. */
  function existante(fo, types) {
    const l = fo.enveloppes.filter(e => types.includes(e.type));
    if (!l.length) return null;
    const dt = e => (e.infos && O.estDate(e.infos.date_ouverture) ? e.infos.date_ouverture : "9999-12-31");
    const x = l.slice().sort((a, b) => (dt(a) < dt(b) ? -1 : dt(a) > dt(b) ? 1 : 0))[0];
    return { cle: x.cle, nom: x.nom, type: x.type, titulaire: ["p1", "p2"].includes(x.titulaire) ? x.titulaire : null, date_ouverture: dt(x) === "9999-12-31" ? null : dt(x),
      versements: x.infos && nombre(x.infos.versements_cumules) ? +x.infos.versements_cumules : null };
  }
  /** Première lettre en minuscule, sauf un sigle (PEA, PER) : pour un libellé au milieu d'une phrase. */
  const minus = t => (/^[A-ZÉ]{2,}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
  /** Avertissements communs du PER (sortie en capital, avance de trésorerie, économie à la TMI). */
  function avertPer(tmi, tmiRet, ecartMensuel, parTranches) {
    const out = ["La sortie en capital est calculée en une fois, à ta tranche de " + tmiRet + " % : ajoutée à tes revenus de l'année, elle peut te faire passer dans une tranche plus haute ; une sortie étalée sur plusieurs années limite cet effet."];
    if (ecartMensuel > 0.5) out.push("L'économie d'impôt arrive l'année suivante, avec la régularisation de ton impôt : en attendant, tu avances environ " + O.eur(Math.round(ecartMensuel)) + " par mois ; ce décalage n'est pas compté (léger avantage au PER).");
    if (!parTranches && tmi > 0) out.push("L'économie d'impôt est comptée à ta tranche de " + tmi + " % sur tout le versement : près du bas de la tranche, elle peut être plus faible (ton revenu net imposable et ton nombre de parts permettraient de le vérifier).");
    return out;
  }
  const normaliser = (alloc, pred) => { const ks = Object.keys(alloc).filter(pred), t = somme(ks, k => alloc[k]); return { ks, t, parts: Object.fromEntries(ks.map(k => [k, t > 0 ? alloc[k] / t : 0])) }; };
  const echelle = (flux, f) => flux.map(s => Object.assign({}, s, { montant: s.montant * f }));

  function prochainEuro(c) {
    const { d, today, rep, L, o, fo } = c;
    const T = Math.max(1, Math.round(rep.horizon_ans * 12)), H = T / 12, delai = L.v("scn_delai_ouverture_mois");
    const V0 = +rep.versement_initial || 0, m = +rep.versement_mensuel || 0, frais = c.frais, ter = frais.ter_pct, avert = [], ctq = [];
    const alloc0 = allocationDe(d, o), alloc = alloc0 || { actions: 1 };
    if (!alloc0) avert.push("Aucune allocation cible renseignée : la comparaison suppose 100 % actions.");
    const dureePea = L.v("pea_duree_ans");
    /* un PEA ou une assurance-vie déjà détenus servent tels quels (un seul PEA par personne ; l'ancienneté d'un contrat compte) : leur date d'ouverture et leurs versements */
    const peaEx = existante(fo, ["pea"]), avEx = existante(fo, TYPES_AV);
    const ouvPea = peaEx ? { ouverture_t: 0, date_ouverture: peaEx.date_ouverture } : { ouverture_t: delai };
    const ouvAv = avEx ? { ouverture_t: 0, date_ouverture: avEx.date_ouverture, primes_existantes: avEx.versements || 0 } : { ouverture_t: delai };
    let plafondPea = L.v("pea_plafond");
    if (peaEx && peaEx.versements != null) plafondPea = Math.max(0, plafondPea - peaEx.versements);
    else if (peaEx) avert.push("Les versements déjà faits sur ton PEA ne sont pas connus : son plafond de " + O.eur(plafondPea) + " est supposé entier.");
    const nomAv = avEx ? "ton assurance-vie" : "assurance-vie";
    const flux = fluxDepart(V0, m, delai, T);
    const act = normaliser(alloc, ESTACTIONS), reste = normaliser(alloc, k => !ESTACTIONS(k)), peaPart = act.t, resteAv = 1 - peaPart;
    const pochesAv = (norm) => norm.ks.map(k => ({ classe: k, part: norm.parts[k], frais_pct: k === "fonds_euros" ? frais.fonds_euros_pct : ter + frais.assurance_vie_pct }));
    const pochesActions = fe => act.ks.map(k => ({ classe: k, part: act.parts[k], frais_pct: ter + fe }));
    const options = {}, libelles = {}, exclues = {};
    const tousAv = normaliser(alloc, () => true);
    /* AV seule */
    options.av = [Object.assign({ type: "assurance_vie", libelle: nomAv, poches: pochesAv(tousAv), flux }, ouvAv)]; libelles.av = avEx ? "Ton assurance-vie" : "Assurance-vie";
    /* PEA (+ AV pour ce qui n'est pas éligible) : écarté si le plan n'a pas 5 ans à la date de sortie */
    const datePea = peaEx ? peaEx.date_ouverture : dateDe(today, delai), pea5 = datePea ? seuilAnnees(datePea, dureePea) : null;
    if (peaEx && !datePea) exclues["pea+av"] = ["date_ouverture_pea_manquante", "La date d'ouverture de ton PEA n'est pas connue : sans elle, on ne sait pas s'il aura 5 ans à ta date de retrait."];
    else if (pea5 > dateDe(today, T)) exclues["pea+av"] = ["horizon_moins_5_ans", peaEx ? "Ton PEA n'aura pas 5 ans à cette date (le " + dateFr(pea5) + ") : avant, un retrait le clôture et le gain est imposé comme sur un compte-titres."
      : "Un PEA gagne à être gardé 5 ans : sous cet horizon, un retrait clôture le plan et le gain est imposé comme sur un compte-titres."];
    else if (peaPart <= 0) exclues["pea+av"] = ["aucune_action", "Ton allocation ne contient pas d'actions : le PEA n'a rien à recevoir."];
    else {
      const rp = repartirPlafond(echelle(flux, peaPart), plafondPea), env = [Object.assign({ type: "pea", libelle: peaEx ? "ton PEA" : "PEA", poches: pochesActions(frais.pea_pct), flux: rp.dedans }, ouvPea)];
      if (rp.debordement.length) {
        env.push({ type: "compte_titres", ouverture_t: 0, poches: pochesActions(frais.compte_titres_pct), flux: rp.debordement, debordement: true });
        avert.push("Le PEA atteint son plafond de versements (" + O.eur(L.v("pea_plafond")) + ") : ce qui dépasse est placé en compte-titres, dans le calcul.");
      }
      if (resteAv > EPS) env.push(Object.assign({ type: "assurance_vie", libelle: nomAv, poches: pochesAv(reste), flux: echelle(flux, resteAv) }, ouvAv));
      options["pea+av"] = env; libelles["pea+av"] = (peaEx ? "Ton PEA" : "PEA") + (resteAv > EPS ? " + " + nomAv : "");
    }
    /* PER */
    const dateRet = rep.date_retraite, tmiR = rep.tmi_retraite_pct, tmi = tmiDe(d), plafond = plafondPer(d, today, L, fo, o);
    if (rep.retrait_avant === true) exclues.per = ["retrait_avant", "Un PER est bloqué jusqu'à la retraite (sauf achat de la résidence principale) : tu as besoin de pouvoir retirer avant."];
    else if (!dateRet) { exclues.per = ["date_retraite_manquante", "Sans ta date de départ à la retraite, la sortie du PER ne peut pas être calculée."]; avert.push("Le PER n'est pas compté dans cette comparaison : il manque ta date de départ à la retraite."); }
    else if (tmi == null) { exclues.per = ["tmi_manquante", "Sans ta tranche d'imposition, l'économie d'impôt du PER ne peut pas être calculée."]; avert.push("Le PER n'est pas compté dans cette comparaison : il manque ta tranche d'imposition."); }
    else if (T < O.moisEntre(today, dateRet)) exclues.per = ["avant_retraite", "Ton horizon est avant ta retraite : l'argent d'un PER n'est pas disponible avant."];
    else {
      const tmiRet = tmiR === "ne_sait_pas" || tmiR == null ? tmi : +tmiR;
      if (tmiR === "ne_sait_pas") avert.push("Tranche d'imposition à la retraite inconnue : la tranche d'aujourd'hui (" + tmi + " %) est supposée pour le PER.");
      const fl = [{ de: delai, a: T, effort_net: m }];
      if (V0 > 0) { fl.splice(0, 1, { de: delai, a: delai, montant: V0, deduit: 0 }, { de: delai, a: T, effort_net: m }); avert.push("Le versement de départ n'est pas déduit dans le PER (hypothèse prudente)."); }
      options.per = [{ type: "per", ouverture_t: delai, poches: tousAv.ks.map(k => ({ classe: k, part: tousAv.parts[k], frais_pct: k === "fonds_euros" ? frais.per_pct : ter + frais.per_pct })), flux: fl,
        tmi_pct: tmi, tmi_retraite_pct: tmiRet, plafond_annuel: plafond.annuel, plafond_premiere_annee: plafond.premiere_annee }];
      libelles.per = "PER";
      if (plafond.texte) avert.push(plafond.texte);
      const vp = versementPer(m, tmi, plafond.annuel);
      avertPer(tmi, tmiRet, vp.v - m, false).forEach(x => avert.push(x));
    }
    /* compte-titres (référence), complété par l'assurance-vie pour la part qui n'est pas en actions */
    const refId = resteAv > EPS ? (peaPart > 0 ? "cto+av" : "av") : "cto";
    if (refId !== "av") {
      options[refId] = [{ type: "compte_titres", ouverture_t: 0, poches: pochesActions(frais.compte_titres_pct), flux: echelle(flux, peaPart) }];
      if (resteAv > EPS) options[refId].push(Object.assign({ type: "assurance_vie", libelle: nomAv, poches: pochesAv(reste), flux: echelle(flux, resteAv) }, ouvAv));
      libelles[refId] = resteAv > EPS ? "Compte-titres + " + nomAv : "Compte-titres";
    }
    const plan = { T, couple: fo.couple, options, reference: refId };
    const sim = simulerEnveloppes(d, plan, simOptsDe(o));
    if (sim.indisponible) return { statut: "indisponible", reperes_manquants: sim.reperes_manquants };
    const ids = Object.keys(options), p50 = id => quantile(sim.options[id].net, 0.5);
    const classement = ids.slice().sort((a, b) => p50(b) - p50(a) || (a === refId ? -1 : b === refId ? 1 : 0));
    const tete = classement[0], eRef = tete === refId ? null : sim.ecart(tete, refId), nul = { delta: [0], courants: [0], p10: 0, p50: 0, p90: 0, probabilite_mieux: 0 };
    const e = eRef || nul, enjeu = parAn(e, H);
    const opts = ids.map(id => {
      const x = sortieOption(id, libelles[id], options[id].map(s => s.type), sim.options[id]);
      if (id === "per") { x.versement_mensuel = r2(versementPer(m, tmi, plafond.annuel).v); x.deduit_annuel = r2(12 * versementPer(m, tmi, plafond.annuel).deduit); x.contraintes.push("Bloqué jusqu'à la retraite, sauf achat de la résidence principale."); x.disponible = false; }
      return x;
    }).concat(Object.keys(exclues).map(id => optionExclue(id, id === "per" ? "PER" : "PEA + assurance-vie", id === "per" ? ["per"] : ["pea", "assurance_vie"], exclues[id][0], exclues[id][1])));
    /* ce qui changerait */
    let fraisSeuil = null;
    if (options.av && tete !== "av" && tousAv.ks.some(k => k !== "fonds_euros")) {
      const cible = sim.options[tete].courants;
      fraisSeuil = seuilDichotomie(x => {
        const av2 = [Object.assign({}, options.av[0], { poches: options.av[0].poches.map(p => (p.classe === "fonds_euros" ? p : Object.assign({}, p, { frais_pct: x }))) })];
        const s2 = simulerEnveloppes(d, { T, couple: fo.couple, options: { av: av2 } }, simOptsDe(o));
        return quantile(Array.from(s2.options.av.courants, (v, i) => v - cible[i]), 0.5);
      }, 0, 3, 12);
      if (fraisSeuil.etat === "ok") ctq.push(ligne("frais_assurance_vie", O.frc(frais.assurance_vie_pct + ter, 2) + " %", O.frc(fraisSeuil.x, 2) + " %", "En dessous, l'assurance-vie rejoint " + minus(libelles[tete]),
        "Si les frais annuels de " + (avEx ? "ton assurance-vie" : "l'assurance-vie") + " (contrat et fonds) tombaient à " + O.frc(fraisSeuil.x, 2) + " %, elle rejoindrait " + minus(libelles[tete]) + "."));
    }
    let tStar = null;
    if (options.per && tete !== "per" || (options.per && classement.length > 1)) {
      const autre = classement.find(id => id !== "per"), per0 = sim.netA("per", T, { tmi_per: 0 }).courants, ded = sim.options.per.deduits, cn = sim.options[autre].courants;
      const x = Array.from(per0, (v, i) => v - cn[i]), q50 = quantile(x, 0.5);
      tStar = ded > 0 && q50 > 0 ? q50 / ded * 100 : null;
      const tmiRetenue = options.per[0].tmi_retraite_pct, perDevant = quantile(sim.options.per.net, 0.5) > quantile(sim.options[autre].net, 0.5);
      if (tStar != null && tStar < 100) ctq.push(ligne("tmi_retraite", tmiRetenue + " %", O.frc(tStar, 1) + " %", perDevant ? "Au-delà, le PER passe derrière " + minus(libelles[autre]) : "En dessous, le PER passe devant " + minus(libelles[autre]),
        perDevant ? "Le PER reste devant " + minus(libelles[autre]) + " tant que ta tranche d'imposition à la retraite reste sous " + O.frc(tStar, 1) + " %."
          : "Le PER ne passerait devant " + minus(libelles[autre]) + " que si ta tranche d'imposition à la retraite était sous " + O.frc(tStar, 1) + " %."));
    }
    if (exclues.per && exclues.per[0] === "retrait_avant") ctq.push(ligne("retrait_avant", "oui", "non", "Le PER entrerait dans la comparaison", "Si tu n'as pas besoin de retirer cet argent avant ta retraite, le PER entre dans la comparaison."));
    if (options["pea+av"]) ctq.push(peaEx ? ligne("pea_5_ans", dateFr(dateDe(today, T)), dateFr(pea5), "Avant cette date, le PEA sort de la comparaison", "Si tu retires avant le " + dateFr(pea5) + " (les 5 ans de ton PEA), il sort de la comparaison : un retrait le clôture.")
      : ligne("pea_5_ans", ans(H), ans(dureePea), "Sous 5 ans, le PEA sort de la comparaison", "Si tu retires avant 5 ans, le PEA sort de la comparaison : un retrait le clôture."));
    ctq.push(ligne("transmission", rep.transmission === true ? "oui" : "non précisé", null, "Information, sans calcul", "La transmission (clause bénéficiaire, abattement par bénéficiaire) peut compter : pour un cas particulier, un notaire."));
    const phrase = tete === refId ? "Sur " + ans(H) + ", " + minus(libelles[refId]) + " reste en tête : aucune des autres enveloppes ne fait mieux sur ces hypothèses."
      : "Sur " + ans(H) + ", " + minus(libelles[tete]) + " arrive en tête, environ " + eur0(e.p50) + " de plus " + que(minus(libelles[refId])) + ", en euros d'aujourd'hui.";
    avert.unshift(...avertFrais(frais, ["ter_pct", "pea_pct", "compte_titres_pct", "assurance_vie_pct"].concat(tousAv.ks.includes("fonds_euros") ? ["fonds_euros_pct"] : [], options.per ? ["per_pct"] : [])));
    const reponse = { phrase, option_en_tete: tete, reference: refId, ecart: ecartBandes(e), ecart_annuel: enjeu, probabilite_mieux: p3(e.probabilite_mieux), date_bascule: null };
    /* enjeu de la carte (décision du 2026-10-16, option A) : contre la meilleure option dont le foyer détient déjà toutes les enveloppes (rien à ouvrir) ; nul si c'est l'option
       en tête ; sans enveloppe détenue, contre la référence (compte-titres). La réponse garde la référence. Jamais un enjeu plus grand que ce que la décision change. */
    const tient = id => options[id].filter(x => !x.debordement).every(x => fo.enveloppes.some(y => (famillesTypes[x.type] || [x.type]).includes(y.type)));
    const refEnjeu = classement.find(tient) || refId, zero = { p10: 0, p50: 0, p90: 0 };
    const enjeuCarte = refEnjeu === tete ? zero : refEnjeu === refId ? enjeu : parAn(sim.ecart(tete, refEnjeu), H);
    if (refEnjeu !== refId) avert.push(refEnjeu === tete ? "Tu détiens déjà les enveloppes de l'option en tête (" + minus(libelles[tete]) + ") : l'enjeu de cette question est donc nul ; l'écart avec " + minus(libelles[refId]) + " reste montré pour information."
      : "L'enjeu de cette question compare " + minus(libelles[tete]) + " à " + minus(libelles[refEnjeu]) + ", que tu as déjà : c'est ce que changerait le choix.");
    /* classes que l'enveloppe ne peut pas recevoir : dites (répartition propre au lot 2) */
    const horsEnveloppe = tousAv.ks.filter(k => ["crypto", "levier"].includes(k));
    if (horsEnveloppe.length) avert.push("Ton allocation contient " + horsEnveloppe.map(k => (k === "crypto" ? "des crypto-actifs" : "des fonds à effet de levier")).join(" et ") + " : une assurance-vie ou un PER ne peut pas les recevoir ; le calcul les y place quand même, ce qui rend cette comparaison approximative.");
    return { options: opts, reponse, ce_qui_changerait: ctq, avertissements: avert, enjeu_annuel: enjeuCarte, sim,
      detail: { T, classement, reference_enjeu: refEnjeu, ecart_tete_moins_reference: r2(quantile(e.courants, 0.5)), frais_seuil_av_uc_pct: fraisSeuil && fraisSeuil.etat === "ok" ? r2(fraisSeuil.x * 1000) / 1000 : null,
        exclues: Object.fromEntries(Object.keys(exclues).map(k => [k, exclues[k][0]])), t_star_pct: tStar == null ? null : r2(tStar * 100) / 100, plafond_per: plafond },
      plan: { tete, reference: refId, plan, titulaire: plafond.personne || c.titulaire },
      retenables: retenablesEuro(c, { options, refId, ids, tousAv, act, plafond, tmi, rep, T, V0, m, delai, dateRet, peaEx, avEx, plafondPea }) };
  }
  /** Options retenables du n° 2 : une seule enveloppe par variante (assurance-vie, PER, PEA sans reste) ; le compte-titres est la référence. */
  function retenablesEuro(c, x) {
    const out = { options: {}, non: {} }, { today } = c, ouverture = dateDe(today, x.delai), tit = x.plafond.personne || c.titulaire, fr = c.frais;
    const un = (id, p) => { const h = hypotheseEnveloppe(c, Object.assign({ ouverture, titulaire: tit }, p)); out.options[id] = h; };
    /* une enveloppe déjà détenue : la variante la reprend à sa date d'ouverture (inconnue : l'option ne se retient pas) et pour son titulaire */
    const deja = (ex, nom) => (!ex ? {} : ex.date_ouverture ? { ouverture: ex.date_ouverture, titulaire: ex.titulaire || tit } : { manque: "La date d'ouverture de " + nom + " n'est pas connue : donne-la pour retenir cette option." });
    x.ids.forEach(id => {
      if (id === x.refId) { out.non[id] = NON_RETENABLE_REFERENCE; return; }
      const envs = x.options[id].filter(e => !e.debordement);             // le débordement au plafond (compte-titres) fait partie de l'enveloppe : le moteur le rejoue
      if (envs.length !== 1) { out.non[id] = NON_RETENABLE_MULTI; return; }
      if (id === "av") {
        const dj = deja(x.avEx, "ton assurance-vie");
        if (dj.manque) { out.non[id] = dj.manque; return; }
        un(id, Object.assign({ type: "assurance_vie", allocation: x.tousAv.parts, fraisEnveloppe: fr.assurance_vie_pct, initial: x.V0, mensuel: x.m }, dj));
      } else if (id === "pea+av") {
        const dj = deja(x.peaEx, "ton PEA");
        if (dj.manque) { out.non[id] = dj.manque; return; }
        un(id, Object.assign({ type: "pea", allocation: x.act.parts, fraisEnveloppe: fr.pea_pct, initial: x.V0, mensuel: x.m, plafond: x.plafondPea, debordement: "compte_titres" }, dj));
      } else if (id === "per") {
        if (x.V0 > 0) { out.non[id] = "Le versement de départ n'est pas déduit dans ce calcul du PER : mets-le à 0 pour retenir cette option."; return; }
        const tmiRet = x.rep.tmi_retraite_pct === "ne_sait_pas" || x.rep.tmi_retraite_pct == null ? x.tmi : +x.rep.tmi_retraite_pct;
        un(id, { type: "per", allocation: x.tousAv.parts, fraisEnveloppe: fr.per_pct, mensuel: versementPer(x.m, x.tmi, x.plafond.annuel).v, plafond: x.plafond.annuel,
          per: Object.assign({ deduit: true, tmi_retraite_pct: tmiRet, economie: "reinvestie" }, TMI_ADMISES.includes(x.tmi) ? { tmi_actuelle_pct: x.tmi } : {}) });
      } else out.non[id] = NON_RETENABLE_MULTI;
    });
    return out;
  }

  /* ================================================================== n° 3 : le PER est-il intéressant pour moi ? (§ 7.3) */
  function perInteret(c) {
    const { d, today, rep, L, o, fo } = c;
    const tmi = +rep.tmi_pct, tmiRep = rep.tmi_retraite_pct, tmiR = tmiRep === "ne_sait_pas" ? tmi : +tmiRep, m = +rep.versement_mensuel || 0, delai = L.v("scn_delai_ouverture_mois");
    const T = O.moisEntre(today, rep.date_retraite);
    const frais = c.frais, ter = frais.ter_pct, avert = [], ctq = [];
    if (tmiRep === "ne_sait_pas") avert.push("Tranche d'imposition à la retraite inconnue : la tranche d'aujourd'hui (" + tmi + " %) est supposée ; le tableau montre les autres.");
    if (!(T >= 12)) return { statut: "a_completer", manquants: [{ champ: "date_retraite", question_id: "date_retraite", libelle: "Une date de départ à la retraite dans au moins un an", comment: "Donne la date à laquelle tu penses partir à la retraite." }] };
    const H = T / 12, alloc0 = allocationDe(d, o), alloc = alloc0 || { actions: 1 }, tous = normaliser(alloc, () => true);
    if (tous.ks.some(k => ["crypto", "levier"].includes(k))) avert.push("Ton allocation contient des crypto-actifs ou des fonds à effet de levier : un PER ou une assurance-vie ne peut pas les recevoir ; le calcul les y place quand même, ce qui rend cette comparaison approximative.");
    avert.unshift(...avertFrais(frais, ["ter_pct", "per_pct", "assurance_vie_pct"].concat(tous.ks.includes("fonds_euros") ? ["fonds_euros_pct"] : [])));
    if (!alloc0) avert.push("Aucune allocation cible renseignée : la comparaison suppose 100 % actions.");
    const plafond = plafondPer(d, today, L, fo, o);
    if (plafond.texte) avert.push(plafond.texte);
    if (rep.statut === "independant") avert.push("Indépendant : le plafond de déduction est différent et n'est pas calculé ici ; le plafond de ton avis d'impôt, ou l'estimation, est utilisé.");
    /* effort net égal : v = m + économie / 12 ; économie à la TMI, ou par tranches si le revenu net imposable et le nombre de parts sont connus */
    const avis = objet(objet(d.config).avis_impot), rni = o.revenu_net_imposable != null ? +o.revenu_net_imposable : (nombre(avis.revenu_net_imposable) ? +avis.revenu_net_imposable : null);
    const parts = o.parts != null ? +o.parts : (nombre(avis.parts) ? +avis.parts : null);
    const seuilsIr = { 11: L.v("ir_bareme_11_seuil"), 30: L.v("ir_bareme_30_seuil"), 41: L.v("ir_bareme_41_seuil"), 45: L.v("ir_bareme_45_seuil") };
    const parTranches = rni != null && parts != null && Object.values(seuilsIr).every(v => v !== undefined);
    const bloc = cap => {
      if (!parTranches) { const x = versementPer(m, tmi, cap); return { v: x.v, deduit: x.deduit, eco: x.deduit * 12 * tmi / 100 }; }
      /* v tel que v − économie(min(12 v, plafond)) / 12 = m : la fonction est croissante, dichotomie */
      const f = v => v - economiePer(rni, parts, Math.min(12 * v, cap == null ? Infinity : cap), seuilsIr).economie / 12 - m;
      let lo = m, hi = m * 2 + (cap == null ? 0 : cap / 12) + 1;
      for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
      const v = (lo + hi) / 2, dd = Math.min(12 * v, cap == null ? Infinity : cap);
      return { v, deduit: dd / 12, eco: economiePer(rni, parts, dd, seuilsIr).economie };
    };
    const b1 = bloc(plafond.premiere_annee), b2 = bloc(plafond.annuel);
    const flPer = b1.v === b2.v && b1.deduit === b2.deduit ? [{ de: delai, a: T, montant: b2.v, deduit: b2.deduit }]
      : [{ de: delai, a: Math.min(T, delai + 11), montant: b1.v, deduit: b1.deduit }, { de: delai + 12, a: T, montant: b2.v, deduit: b2.deduit }].filter(s => s.de <= s.a);
    const per = { type: "per", ouverture_t: delai, poches: tous.ks.map(k => ({ classe: k, part: tous.parts[k], frais_pct: k === "fonds_euros" ? frais.per_pct : ter + frais.per_pct })), flux: flPer, tmi_pct: tmi, tmi_retraite_pct: tmiR };
    const av = { type: "assurance_vie", ouverture_t: delai, poches: tous.ks.map(k => ({ classe: k, part: tous.parts[k], frais_pct: k === "fonds_euros" ? frais.fonds_euros_pct : ter + frais.assurance_vie_pct })), flux: [{ de: delai, a: T, montant: m }] };
    const plan = { T, couple: fo.couple, options: { per: [per], av: [av] }, comparer: ["per", "av"], reference: "av" };
    const sim = simulerEnveloppes(d, plan, simOptsDe(o));
    if (sim.indisponible) return { statut: "indisponible", reperes_manquants: sim.reperes_manquants };
    const P_ = sim.options.per, A_ = sim.options.av, e = sim.ecart("per", "av"), q50 = a => quantile(a, 0.5);
    const table = {}; [0, 11, 30, 41].forEach(t => { table[t] = r2(q50(sim.netA("per", T, { tmi_per: t }).courants)); });
    const ded = P_.deduits, x0 = Array.from(sim.netA("per", T, { tmi_per: 0 }).courants, (v, i) => v - A_.courants[i]), tBrut = ded > 0 ? q50(x0) / ded * 100 : null;
    const tStar = tBrut != null && tBrut > 0 ? tBrut : null;
    const perEnTete = e.p50 > 0, enjeu = perEnTete ? parAn(e, H) : { p10: 0, p50: 0, p90: 0 };
    const dedAn = 12 * b2.deduit, nonDed = 12 * b2.v - dedAn;
    if (tStar != null) ctq.push(ligne("tmi_retraite", tmiR + " %", O.frc(tStar, 2) + " %", perEnTete ? "Au-delà, l'assurance-vie fait mieux" : "En dessous, le PER fait mieux",
      perEnTete ? "Le PER reste devant l'assurance-vie tant que ta tranche d'imposition à la retraite reste sous " + O.frc(tStar, 1) + " %."
        : "Le PER ne passerait devant l'assurance-vie que si ta tranche d'imposition à la retraite était sous " + O.frc(tStar, 1) + " %."));
    else ctq.push(ligne("tmi_retraite", tmiR + " %", null, "Aucun seuil : l'assurance-vie fait mieux à toute tranche", "Avec ces chiffres, l'assurance-vie fait mieux à n'importe quelle tranche d'imposition à la retraite."));
    if (dedAn >= plafond.annuel - 0.005 && isFinite(plafond.annuel)) ctq.push(ligne("plafond_per", O.eur(plafond.annuel), O.eur(12 * m), "Au-delà du plafond, les versements ne sont plus déduits", "Ton plafond de déduction est atteint : la partie de ton versement au-delà de " + O.eur(plafond.annuel) + " par an n'est pas déduite."));
    if (rep.achat_rp === true) ctq.push(ligne("achat_residence_principale", "oui", null, "Le PER peut être débloqué pour cet achat", "Tu pourrais le débloquer pour l'achat de ta résidence principale : la part des versements déduits est imposée comme une sortie en capital."));
    if (parTranches) avert.push("Près du bas d'une tranche, l'économie d'impôt peut être plus faible : la décote et le plafonnement du quotient familial ne sont pas calculés.");
    avertPer(tmi, tmiR, b2.v - m, parTranches).forEach(x => avert.push(x));
    ctq.push(ligne("sortie_en_rente", "non calculé", null, "Seule la sortie en capital est calculée", "La sortie en rente est imposée comme une pension ; elle n'est pas calculée ici."));
    const opts = [sortieOption("per", "PER", ["per"], P_, { versement_mensuel: r2(b2.v), deduit_annuel: r2(dedAn), non_deduit_annuel: r2(nonDed), disponible: false, contraintes: ["Bloqué jusqu'à la retraite, sauf achat de la résidence principale."] }),
      sortieOption("av", "Assurance-vie", ["assurance_vie"], A_)];
    const phrase = perEnTete ? "À effort égal de " + O.eur(m) + " par mois jusqu'à ta retraite, un PER te laisserait environ " + eur0(e.p50) + " de plus qu'une assurance-vie, en euros d'aujourd'hui, avec ta tranche d'imposition à la retraite de " + tmiR + " %."
      : "À effort égal de " + O.eur(m) + " par mois, l'assurance-vie fait mieux que le PER avec ces hypothèses (tranche d'imposition à la retraite de " + tmiR + " %).";
    const reponse = { phrase, option_en_tete: perEnTete ? "per" : "av", reference: "av", ecart: ecartBandes(e), ecart_annuel: parAn(e, H), probabilite_mieux: p3(e.probabilite_mieux), date_bascule: null };
    return { options: opts, reponse, ce_qui_changerait: ctq, avertissements: avert, enjeu_annuel: enjeu, sim,
      detail: { T, v_mensuel: r2(b2.v), v_mensuel_premiere_annee: r2(b1.v), economie_annuelle: r2(b2.eco), deduit_annuel: r2(dedAn), non_deduit_annuel: r2(nonDed), deduits: r2(P_.deduits), versements_per: r2(P_.base),
        V_per: r2(q50(P_.brut)), gain_per: r2(q50(P_.brut) - P_.base), net_per: r2(q50(P_.courants)), V_av: r2(q50(A_.brut)), gain_av: r2(q50(A_.brut) - A_.base),
        impot_av: r2(q50(Array.from(A_.impots, (v, i) => v - A_.ps[i]))), prelevements_av: r2(q50(A_.ps)), net_av: r2(q50(A_.courants)), net_av_auj: r2(q50(A_.net)),
        ecart_courants: r2(q50(e.courants)), table_net_per: table, t_star_pct: tStar == null ? null : r2(tStar * 10000) / 10000, t_star_brut_pct: tBrut == null ? null : r2(tBrut * 100) / 100,
        phrase_seuil: tStar == null ? "aucun_seuil" : "seuil", net_per_auj: bandeR(P_.net), net_av_auj_bande: bandeR(A_.net), plafond_per: plafond, par_tranches: parTranches },
      plan: { tete: perEnTete ? "per" : "av", reference: "av", plan, titulaire: plafond.personne || c.titulaire },
      retenables: (() => {
        const h = hypotheseEnveloppe(c, { type: "per", titulaire: plafond.personne || c.titulaire, ouverture: dateDe(today, delai), allocation: tous.parts, fraisEnveloppe: frais.per_pct, mensuel: b2.v,
          plafond: isFinite(plafond.annuel) ? plafond.annuel : null, per: Object.assign({ deduit: true, tmi_retraite_pct: TMI_ADMISES.includes(tmiR) ? tmiR : tmi, economie: "reinvestie" },
            TMI_ADMISES.includes(tmi) ? { tmi_actuelle_pct: tmi } : {}) });
        return { options: { per: h }, non: { av: NON_RETENABLE_REFERENCE } };
      })() };
  }
  const TMI_ADMISES = [0, 11, 30, 41, 45];

  /* ================================================================== n° 6 : combien garder de côté, et où ? (§ 7.4) */
  function matelas(c) {
    const { d, today, rep, L, o, fo } = c;
    const E = etatMatelas(d, today, L.v, o, rep), avert = [], ctq = [];
    const capacite = capaciteDe(d), H = Math.max(1, +rep.horizon_ans || 5), T = Math.round(H * 12);
    const lepPlafond = L.v("lep_plafond"), laPlafond = L.v("livret_a_plafond"), ldPlafond = L.v("ldds_plafond");
    const tauxLep = L.v("lep_taux"), tauxLa = L.v("livret_a_taux");
    const el = eligibiliteLep(d, today, L.v, rep.parts_fiscales), lep = { eligible: el.eligible, plafond_rfr: el.plafond_rfr, rfr: el.rfr, parts: el.parts };
    const parts = lep.parts, rfr = lep.rfr, plafondRfr = lep.plafond_rfr;
    if (el.avis_trop_ancien != null) avert.push("Ton avis d'impôt porte sur les revenus de " + el.avis_trop_ancien + " : pour un LEP, c'est celui des revenus de " + (+today.slice(0, 4) - 1) + " (ou " + (+today.slice(0, 4) - 2) + ") qui compte ; la possibilité d'en ouvrir un n'est pas évaluée.");
    else if (lep.eligible == null) avert.push("Le nombre de parts ou le revenu fiscal de référence de ton avis d'impôt manque : la possibilité d'ouvrir un LEP n'est pas évaluée.");
    /* répartition de la cible : LEP de chaque adulte du foyer fiscal (les deux seulement s'ils sont imposés ensemble : l'avis saisi n'en couvre qu'un sinon), puis Livret A, puis LDDS */
    const titulaires = fo.personnes.map(p => p.id), tit = titulaires.length ? titulaires : ["p1"], titLep = fo.couple ? tit : tit.slice(0, 1);
    if (lep.eligible && titLep.length < tit.length) avert.push("Sans imposition commune, chacun a son propre avis d'impôt : un seul LEP est compté, celui de " + (fo.personnes[0] ? fo.personnes[0].nom : "la personne de l'avis") + ".");
    const slots = [];
    if (lep.eligible) titLep.forEach(t => slots.push({ vers: "lep", titulaire: t, plafond: lepPlafond, taux: tauxLep }));
    tit.forEach(t => slots.push({ vers: "livret_a", titulaire: t, plafond: laPlafond, taux: tauxLa }));
    tit.forEach(t => slots.push({ vers: "ldds", titulaire: t, plafond: ldPlafond, taux: tauxLa }));
    let aPlacer = E.cible; const ordre = [];
    slots.forEach(s => { const x = Math.min(aPlacer, s.plafond); if (x > EPS) ordre.push({ vers: s.vers, titulaire: s.titulaire, montant: r2(x), taux: s.taux }); aPlacer -= Math.max(0, x); });
    if (aPlacer > EPS) avert.push("La cible dépasse les plafonds cumulés des livrets de ton foyer : " + O.eur(aPlacer) + " restent à placer ailleurs.");
    /* gain de l'ordre : l'argent déjà détenu qui change de livret, aux taux d'aujourd'hui */
    const infos = objet(objet(d.config).enveloppes_infos), parType = { lep: 0, livret_a: 0, ldds: 0 }, sansType = new Set();
    liste(d.positions).filter(p => p && Calc.counted(p) && Calc.famille(p, d.classes) === "epargne").forEach(p => {
      const cle = Calendrier.cleEnveloppe(p.envelope, p.owner, d.positions, infos), t = objet(infos[cle]).type || Calendrier.typeDeduit(p.envelope);
      if (t in parType) parType[t] += Calc.val(p); else if (Calc.val(p) > 0) sansType.add(String(p.envelope || p.name || "").trim());
    });
    const connu = parType.lep + parType.livret_a + parType.ldds + Math.max(0, E.dispo.courantsAuDela || 0), inconnu = Math.max(0, E.actuel - connu);
    const taux = { lep: tauxLep, livret_a: tauxLa, ldds: tauxLa }, detenu = Object.assign({}, parType);
    let pool = Math.min(E.actuel - inconnu, E.cible), gain = 0;
    const restePool = Object.assign({}, parType, { courant: E.dispo.courantsAuDela });
    ordre.forEach(s => { s.reste = s.montant; });
    ordre.forEach(s => { const reste = Math.min(s.reste, detenu[s.vers] || 0); if (reste > 0) { detenu[s.vers] -= reste; s.reste -= reste; pool -= reste; restePool[s.vers] -= reste; } });
    const totalRestant = somme(Object.values(restePool), x => Math.max(0, x)), tauxMoyen = totalRestant > 0 ? (restePool.lep * tauxLep + restePool.livret_a * tauxLa + restePool.ldds * tauxLa) / totalRestant : 0;
    ordre.forEach(s => { const x = Math.min(s.reste, Math.max(0, pool)); if (x > 0) { gain += x * (s.taux - tauxMoyen) / 100; pool -= x; } });
    const gainOrdre = Math.max(0, gain);
    if (inconnu > EPS && ordre.length) avert.push("Le taux de " + ([...sansType].filter(Boolean).map(n => "« " + n + " »").join(", ") || "certains de tes livrets") + " n'est pas connu (type de livret non précisé, ou PEL) : cet argent n'entre pas dans le gain du rangement ; précise le type (Livret A, LDDS, LEP) pour un chiffre complet.");
    const nomsOrdre = [...new Set(ordre.map(s => nomEnveloppe[s.vers]))], rangement = nomsOrdre.length > 1 ? "dans l'ordre " + nomsOrdre.join(", ") : "sur " + (nomsOrdre[0] === "Livret A" ? "un Livret A" : nomsOrdre[0] === "LEP" ? "un LEP" : "un " + (nomsOrdre[0] || "livret"));
    /* surplus : le placer au mois 0 contre le laisser sur livret */
    let simS = null, eS = null, cto = null, livret = null, enjeuSurplus = { p10: 0, p50: 0, p90: 0 }, tauxSeuil = null, bandeV = null;
    if (E.surplus > EPS) {
      const dest = rep.destination_surplus || "compte_titres", frais = c.frais, ter = frais.ter_pct;
      const fd = dest === "assurance_vie" ? frais.assurance_vie_pct : dest === "pea" ? frais.pea_pct : frais.compte_titres_pct;
      avertFrais(frais, ["ter_pct", cleFraisDe(dest)]).forEach(x => avert.push(x));
      const delai = dest === "compte_titres" ? 0 : L.v("scn_delai_ouverture_mois");
      const placement = { type: dest, ouverture_t: delai, poches: [{ classe: "actions", part: 1, frais_pct: ter + fd }], flux: [{ de: delai, a: delai, montant: E.surplus }] };
      const liv = { type: "livret_a", ouverture_t: 0, poches: [{ classe: "monetaire", part: 1, frais_pct: 0 }], flux: [{ de: 0, a: 0, montant: E.surplus }] };
      simS = simulerEnveloppes(d, { T, couple: fo.couple, options: { placement: [placement], livret: [liv] }, comparer: ["placement", "livret"], reference: "livret" }, simOptsDe(o));
      if (simS.indisponible) return { statut: "indisponible", reperes_manquants: simS.reperes_manquants };
      eS = simS.ecart("placement", "livret");
      enjeuSurplus = parAn(eS, H);
      const pl = simS.options.placement;
      cto = { V: r2(quantile(pl.brut, 0.5)), gain: r2(quantile(pl.brut, 0.5) - pl.base), impots: r2(quantile(pl.impots, 0.5)), net: r2(quantile(pl.courants, 0.5)) };
      bandeV = bandeR(pl.brut);
      livret = r2(quantile(simS.options.livret.courants, 0.5));
      tauxSeuil = r2((Math.pow(quantile(pl.courants, 0.5) / E.surplus, 1 / H) - 1) * 100 * 100) / 100;
      if (eS.p10 < 0) ctq.push(ligne("risque_surplus", "1 chance sur 10", r2(eS.p10), "Le surplus placé peut faire moins bien que le livret", "1 chance sur 10 de faire moins bien que le livret de plus de " + eur0(-eS.p10) + " sur " + ans(H) + "."));
    }
    const enjeuP50 = gainOrdre + Math.max(0, enjeuSurplus.p50);
    const enjeu = { p10: r2(gainOrdre + (enjeuSurplus.p50 > 0 ? enjeuSurplus.p10 : 0)), p50: r2(enjeuP50), p90: r2(gainOrdre + Math.max(0, enjeuSurplus.p90)) };
    if (E.manque > EPS) avert.push("Il te manque " + O.eur(E.manque) + (capacite > 0 ? ", soit environ " + Math.ceil(E.manque / capacite) + " mois à ton rythme d'épargne." : "."));
    const revenus = Calc.revenusFoyer(d.profil, "foyer") || somme(liste(objet(d.budget).lignes).filter(l => l && l.type === "revenu"), l => (l.frequence === "an" ? +l.montant / 12 : +l.montant));
    const k3 = L.v("scn_matelas_mois_stable");
    ctq.push(ligne("mois_matelas", E.mois + " mois", E.convention.mois + " mois", "La cible suit le nombre de mois choisi", "Chaque mois de plus ou de moins déplace la cible de " + O.eur(E.dep.montant) + "."));
    if (lep.eligible === false && parts != null) ctq.push(ligne("lep_rfr", O.eur(rfr), O.eur(plafondRfr), "Sous ce revenu fiscal de référence, un LEP devient possible", "Un LEP est possible si ton revenu fiscal de référence ne dépasse pas " + O.eur(plafondRfr) + " pour " + parts + " parts."));
    ctq.push(ligne("taux_livret", O.frc(tauxLa, 2) + " %", tauxSeuil == null ? null : O.frc(tauxSeuil, 2) + " %", "Au-dessus de ce taux, le livret ferait mieux que le placement", tauxSeuil == null ? "Pas de surplus à placer." : "Le livret ferait aussi bien que le placement avec un taux de " + O.frc(tauxSeuil, 2) + " % par an."));
    const ranger = gainOrdre > 0 ? "Les ranger " + rangement + " te rapporterait environ " + eur0(gainOrdre) + " de plus par an." : "";
    const phrase = E.surplus > EPS ? "Ta cible est de " + eur0(E.cible) + " (" + E.mois + " mois de dépenses) ; tu as environ " + eur0(E.surplus) + " au-delà." + (ranger ? " " + ranger : "")
      : E.manque > EPS ? "Ta cible est de " + eur0(E.cible) + " (" + E.mois + " mois de dépenses) ; il te manque environ " + eur0(E.manque) + "." + (ranger ? " " + ranger : "")
        : "Ta cible est de " + eur0(E.cible) + " (" + E.mois + " mois de dépenses) et tu y es." + (ranger ? " " + ranger : "");
    const opts = [{ id: "ordre", libelle: "Ranger la cible : " + (nomsOrdre.join(", ") || "livrets"), enveloppes: [...new Set(ordre.map(s => s.vers))], net: null, verse: r2(E.cible), disponible: true, contraintes: [], exclue: null }];
    if (cto) opts.push({ id: "placement", libelle: "Surplus placé", enveloppes: [rep.destination_surplus || "compte_titres"], net: bandeR(simS.options.placement.net), verse: r2(E.surplus), disponible: true, contraintes: [], exclue: null },
      { id: "livret", libelle: "Surplus laissé sur livret", enveloppes: ["livret_a"], net: bandeR(simS.options.livret.net), verse: r2(E.surplus), disponible: true, contraintes: [], exclue: null });
    const reponse = { phrase, option_en_tete: E.surplus > EPS && enjeuSurplus.p50 > 0 ? "placement" : "ordre", reference: "livret", ecart: eS ? ecartBandes(eS) : { p10: 0, p50: 0, p90: 0 }, ecart_annuel: enjeuSurplus, probabilite_mieux: eS ? p3(eS.probabilite_mieux) : null, date_bascule: null };
    return { options: opts, reponse, ce_qui_changerait: ctq, avertissements: avert, enjeu_annuel: enjeu, sim: simS,
      detail: { depenses_reference: r2(E.dep.montant), source_depenses: E.dep.source, mois: E.mois, mois_convention: E.convention.mois, cible: r2(E.cible), actuel: r2(E.actuel), surplus: r2(E.surplus), manque: r2(E.manque),
        mois_pour_combler: E.manque > EPS && capacite > 0 ? Math.ceil(E.manque / capacite - 1e-9) : (E.manque > EPS ? null : 0), lep, ordre: ordre.map(s => ({ vers: s.vers, titulaire: s.titulaire, montant: s.montant })), gain_ordre_annuel: r2(gainOrdre),
        surplus_cto: cto ? Object.assign({ bande_V: bandeV }, cto) : null, surplus_livret: livret, ecart_courants: eS ? r2(quantile(eS.courants, 0.5)) : 0, ecart_auj: eS ? r2(eS.p50) : 0, enjeu_surplus_annuel: enjeuSurplus,
        taux_livret_seuil_pct: tauxSeuil, cible_en_revenus_3_mois: r2(k3 * revenus), perte_p10: eS ? r2(eS.p10) : null },
      plan: { tete: "ordre", reference: "livret", plan: null, titulaire: null },
      retenables: (() => {
        const out = { options: {}, non: { ordre: "L'ordre des livrets n'est pas une variante de projection : il se règle chez toi, livret par livret.", livret: NON_RETENABLE_REFERENCE } };
        if (cto) {
          const dest = rep.destination_surplus || "compte_titres", frais = c.frais, fd = dest === "assurance_vie" ? frais.assurance_vie_pct : dest === "pea" ? frais.pea_pct : frais.compte_titres_pct;
          /* le surplus est pris là où il est : compte courant au-delà de la réserve, puis LDDS, puis Livret A (jamais le LEP), dans les enveloppes dont le type est connu (le moteur ne sait rien prendre ailleurs) */
          const sources = [["courant", Math.max(0, E.dispo.courantsAuDela || 0)], ["ldds", parType.ldds], ["livret_a", parType.livret_a]], transferts = [];
          let aPrendre = E.surplus;
          sources.forEach(([de, dispo]) => { const x = Math.min(aPrendre, dispo); if (x >= 0.01) { transferts.push({ de, montant: x }); aPrendre -= x; } });
          if (aPrendre > 0.5) out.non.placement = "Une partie de ton surplus est sur des comptes que la projection ne sait pas encore vider (" + ([...sansType].filter(Boolean).map(n => "« " + n + " »").join(", ") || "livrets") + ") : précise s'il s'agit d'un Livret A ou d'un LDDS pour retenir cette option.";
          else out.options.placement = hypotheseEnveloppe(c, { type: dest, titulaire: c.titulaire, ouverture: dateDe(today, dest === "compte_titres" ? 0 : L.v("scn_delai_ouverture_mois")), allocation: { actions: 1 },
            fraisEnveloppe: fd, transferts });
        }
        return out;
      })() };
  }

  /* ================================================================== n° 12 : ouvrir une assurance-vie maintenant ? (§ 7.5) */
  function avMaintenant(c) {
    const { d, today, rep, L, o, fo } = c;
    const delai = L.v("scn_delai_ouverture_mois"), duree = L.v("av_duree_ans"), frais = c.frais, ter = frais.ter_pct, ctq = [];
    const vmin = +rep.versement_initial || 0, m = +rep.versement_mensuel || 0, fe = Math.min(100, Math.max(0, +rep.part_fonds_euros_pct || 0)) / 100;
    const avert = avertFrais(frais, (fe < 1 ? ["ter_pct", "assurance_vie_pct"] : []).concat(fe > 0 ? ["fonds_euros_pct"] : []));
    const P0 = Math.max(delai, O.moisEntre(today, rep.debut_date));
    const sansDate = !nombre(rep.retrait_ans);
    const T = sansDate ? Math.max(P0 + 12, 120) : Math.round(rep.retrait_ans * 12), H = T / 12;
    if (sansDate) avert.push("Pas de date de retrait : " + ans(H) + " supposés pour le chiffre ; la courbe montre les autres dates.");
    if (P0 >= T) return { statut: "a_completer", manquants: [{ champ: "debut_date", question_id: "debut_date", libelle: "Une date de début des versements avant celle du retrait", comment: "Donne une date de début antérieure à ton retrait." }] };
    const poches = [];
    if (fe < 1) poches.push({ classe: "actions", part: 1 - fe, frais_pct: ter + frais.assurance_vie_pct });
    if (fe > 0) poches.push({ classe: "fonds_euros", part: fe, frais_pct: frais.fonds_euros_pct });
    const flux = [{ de: P0, a: T, montant: m }], Tmax = Math.max(T, P0 + duree * 12 + 12, sansDate ? 240 : 0);
    const plan = { T, couple: fo.couple, options: { A: [{ type: "assurance_vie", ouverture_t: delai, poches, flux }], B: [{ type: "assurance_vie", ouverture_t: P0, poches, flux }] }, comparer: ["A", "B"], reference: "B", v_min: { montant: vmin, t: delai } };
    const sim = simulerEnveloppes(d, plan, Object.assign({ horizon_max: Tmax }, simOptsDe(o)));
    if (sim.indisponible) return { statut: "indisponible", reperes_manquants: sim.reperes_manquants };
    const e = sim.ecart("A", "B"), enjeu = parAn(e, H), ouvA = dateDe(today, delai), ouvB = dateDe(today, P0), seuilA = seuilAnnees(ouvA, duree), seuilB = seuilAnnees(ouvB, duree);
    const A_ = sim.options.A, B_ = sim.options.B, q50 = a => quantile(a, 0.5), dateT = sim.date(T);
    const pts = []; for (let t = delai; t <= Tmax; t++) { const x = sim.ecart("A", "B", t), b = bandeR(x.delta); pts.push({ t, date: sim.date(t), p10: b.p10, p50: b.p50, p90: b.p90, courants_p50: r2(q50(x.courants)) }); }
    const fenetre = { du: seuilA, au: O.ajouterJours(seuilB, -1) };
    ctq.push(ligne("av_8_ans", dateFr(dateT), dateFr(seuilA) + " au " + dateFr(fenetre.au), "L'avance compte pour un retrait dans cette fenêtre", "Ouvrir maintenant ne change rien si tu retires avant le " + dateFr(seuilA) + " ou à partir du " + dateFr(seuilB) + " : entre les deux, le contrat ouvert maintenant a plus de 8 ans et l'autre non."));
    ctq.push(ligne("transfert", "non calculé", null, "Un ancien contrat peut être transformé chez le même assureur sans perdre son ancienneté", "Un contrat peut être transformé, par avenant ou par un nouveau contrat, auprès du même assureur sans les conséquences fiscales d'un dénouement ; rien n'est dit d'un autre assureur."));
    ctq.push(ligne("clause_beneficiaire", "non calculé", null, "La clause bénéficiaire compte pour la transmission", "La clause bénéficiaire règle la transmission : pour un cas particulier, un notaire."));
    const gainAnt = r2(q50(e.courants));
    const phrase = e.p50 > 0.005 ? "Ouvrir une assurance-vie maintenant, même avec " + O.eur(vmin) + ", te ferait gagner environ " + eur0(e.p50) + " en euros d'aujourd'hui si tu retires à " + ans(H) + ", parce que ses 8 ans seraient atteints plus tôt."
      : "Si tu retires à " + ans(H) + ", ouvrir maintenant ne change rien : " + (dateT < seuilA ? "les deux contrats seraient imposés pareil (aucun n'a encore 8 ans)." : dateT >= seuilB ? "les deux contrats seraient imposés pareil (les deux ont plus de 8 ans)."
        : "le gain médian serait nul ou négatif, donc sans impôt d'un côté comme de l'autre.");
    const opts = [sortieOption("A", "Contrat ouvert maintenant", ["assurance_vie"], A_), sortieOption("B", "Contrat ouvert au début des versements", ["assurance_vie"], B_)];
    const reponse = { phrase, option_en_tete: Math.abs(e.p50) < 0.005 ? "egalite" : "A", reference: "B", ecart: ecartBandes(e), ecart_annuel: enjeu, probabilite_mieux: p3(e.probabilite_mieux), date_bascule: e.p50 > 0.005 ? seuilA : null };
    const fv = sim.v_min;
    return { options: opts, reponse, courbe: { abscisse: "date_sortie", points: pts }, ce_qui_changerait: ctq, avertissements: avert, enjeu_annuel: { p10: Math.min(enjeu.p10, enjeu.p50), p50: Math.max(0, enjeu.p50), p90: Math.max(enjeu.p90, enjeu.p50) }, sim,
      detail: { T, V: r2(q50(A_.brut)), versements: r2(A_.base), gain: r2(q50(A_.brut) - A_.base), impot_A: r2(q50(Array.from(A_.impots, (v, i) => v - A_.ps[i]))), impot_B: r2(q50(Array.from(B_.impots, (v, i) => v - B_.ps[i]))),
        prelevements: r2(q50(A_.ps)), A_apres_8_ans: dateT >= seuilA, B_apres_8_ans: dateT >= seuilB, gain_anteriorite: gainAnt, gain_anteriorite_auj: r2(e.p50), seuil_A: seuilA, seuil_B: seuilB, fenetre,
        v_min_brut: r2(q50(fv.brut)), v_min_net: r2(q50(fv.net)), v_min_frais: r2(q50(fv.frais)), gain_bande: bandeR(e.delta) },
      plan: { tete: "A", reference: "B", plan, titulaire: c.titulaire },
      retenables: (() => {
        const al = {}; if (fe < 1) al.actions = 1 - fe; if (fe > 0) al.fonds_euros = fe;
        return { options: { A: hypotheseEnveloppe(c, { type: "assurance_vie", titulaire: c.titulaire, ouverture: ouvA, allocation: al, fraisEnveloppe: frais.assurance_vie_pct, initial: vmin, mensuel: m, debut: dateDe(today, P0) }) },
          non: { B: "Cette option sert de point de comparaison : ouvrir plus tard est ce qui se passe si tu ne fais rien maintenant." } };
      })() };
  }

  /* ================================================================== n° 20 : un bien locatif ou des SCPI ? (spec 2026-10-26-scn-locatif-scpi-design.md) */
  const REGIMES_LOCATIF = { lmnp_reel: "meublé au réel", lmnp_micro: "meublé au micro-BIC", nu_reel: "location nue au réel", nu_micro: "location nue au micro-foncier" };
  const LIB_LS = { L: "Bien locatif", S: "SCPI en direct", AV: "SCPI en assurance-vie", SC: "SCPI à crédit" };
  /** Libellés dans une phrase (sujet ou complément), accords compris. */
  const PH_LS = { L: "le bien locatif", S: "les SCPI en direct", AV: "les SCPI en assurance-vie", SC: "les SCPI à crédit" };
  const NON_RETENABLE_IMMO = "Une variante de projection ne sait pas encore porter un bien ou des parts de SCPI : demande à Claude d'ajouter l'achat comme événement de vie.";

  /** Paramètres du calcul à partir des réponses et des repères (§ 2 et § 3 de la spec). Les surcharges `sur` servent aux seuils de « ce qui changerait ». */
  function parametresLocatif(c, sur) {
    const { rep, L } = c, s = sur || {};
    const meuble = /^lmnp/.test(rep.regime), neuf = rep.neuf === true;
    const p = {
      prix: +rep.prix, neuf, travaux: +rep.travaux || 0, mobilier: meuble ? +rep.mobilier || 0 : 0, apport: +rep.apport, regime: rep.regime, meuble,
      duree: Math.round(+rep.duree_credit_ans), taux: +rep.taux_credit_pct, loyer: +rep.loyer_mensuel, vacance: s.vacance != null ? s.vacance : +rep.vacance_mois,
      charges: +rep.charges_annuelles, gestion: (+rep.gestion_pct || 0) / 100, T: Math.round(+rep.horizon_ans) * 12, H: Math.round(+rep.horizon_ans), tmi: +rep.tmi / 100,
      fs: +rep.scpi_frais_souscription_pct / 100, dist: (s.dist != null ? s.dist : +rep.scpi_taux_distribution_pct) / 100, prixPart: +rep.scpi_prix_part_pct / 100,
      reinvestir: rep.scpi_reinvestir !== false, fav: (nombre(rep.frais_av_pct) ? +rep.frais_av_pct : c.frais.assurance_vie_pct) / 100, credit: rep.scpi_credit === true,
      fa_pct: L.v(neuf ? "frais_acquisition_neuf_pct" : "frais_acquisition_ancien_pct") / 100, garantie: L.v("garantie_pct") / 100, dossier: L.v("frais_dossier"),
      assurance: L.v("assurance_emprunteur_defaut_pct"), psF: L.v("ps_taux_foncier") / 100, psG: L.v("ps_taux_general") / 100,
      pvIr: L.v("pv_immo_ir_taux") / 100, pvPs: L.v("pv_immo_ps_taux") / 100, surtaxe: L.v("pv_immo_surtaxe_seuil"),
      mfPlafond: L.v("micro_foncier_plafond"), mfAbat: L.v("micro_foncier_abattement_pct") / 100, mbPlafond: L.v("micro_bic_plafond"), mbAbat: L.v("micro_bic_abattement_pct") / 100,
      defPlafond: L.v("deficit_foncier_plafond"), defFoncierAns: L.v("deficit_foncier_report_ans"), defBicAns: L.v("deficit_bic_report_ans"),
      terrain: L.v("scn_lmnp_part_terrain_pct") / 100, dBati: L.v("scn_lmnp_duree_bati_ans"), dTrav: L.v("scn_lmnp_duree_travaux_ans"), dMob: L.v("scn_lmnp_duree_mobilier_ans"),
      revente: L.v("scn_immo_frais_revente_pct") / 100, dj: L.v("scn_scpi_delai_jouissance_mois"),
    };
    p.FA = p.prix * p.fa_pct;
    p.K = p.prix + p.FA + p.travaux + p.mobilier;
    const besoin = Math.max(0, p.K - p.apport);
    p.A0 = Math.min(p.apport, p.K);
    p.C = besoin > 0 ? (besoin + p.dossier) / (1 - p.garantie) : 0;
    p.fraisEmprunt = p.C > 0 ? p.dossier + p.C * p.garantie : 0;
    return p;
  }

  /** Le bien, mois par mois (déterministe, § 3.1 à 3.3) : loyers, charges, crédit, impôt de l'année par douzièmes, cash-flow, amortissements déduits. */
  function exploitationLocatif(p, pi) {
    const T = p.T, W = T + 1, tab = PC.amortissement({ capital: p.C, taux_pct: p.taux, duree_mois: p.duree * 12, assurance_pct: p.assurance });
    const ech = new Float64Array(W), ass = new Float64Array(W), inter = new Float64Array(W), crd = new Float64Array(W);
    crd[0] = p.C;
    for (let t = 1; t < W; t++) { const r = tab[t - 1]; if (r) { ech[t] = r.echeance; ass[t] = r.assurance; inter[t] = r.interets; crd[t] = r.crd; } else crd[t] = 0; }
    const loyer = new Float64Array(W), charges = new Float64Array(W), gestion = new Float64Array(W), impot = new Float64Array(W), cf = new Float64Array(W);
    for (let t = 1; t < W; t++) {
      const y = Math.ceil(t / 12), idx = Math.pow(1 + pi, y - 1);
      loyer[t] = p.loyer * idx * (12 - p.vacance) / 12; charges[t] = p.charges / 12 * idx; gestion[t] = p.gestion * loyer[t];
    }
    const H = T / 12, annees = [], avert = new Set();
    /* régime micro au-delà de son plafond : réel pour toute la durée (dit) */
    let regime = p.regime;
    const recettes = y => somme([...Array(12).keys()], k => loyer[12 * (y - 1) + k + 1]);
    if (regime === "nu_micro" && [...Array(H).keys()].some(k => recettes(k + 1) > p.mfPlafond + EPS)) { regime = "nu_reel"; avert.add("Tes loyers dépassent " + O.eur(p.mfPlafond) + " par an : le micro-foncier n'est pas possible, le calcul passe au réel."); }
    if (regime === "lmnp_micro" && [...Array(H).keys()].some(k => recettes(k + 1) > p.mbPlafond + EPS)) { regime = "lmnp_reel"; avert.add("Tes loyers dépassent " + O.eur(p.mbPlafond) + " par an : le micro-BIC n'est pas possible, le calcul passe au réel."); }
    let carry = [];                                                  // déficits reportés { montant, fin (dernière année d'imputation) }
    const stock = [0, 0, 0];                                         // amortissements non déduits : bâti, travaux, mobilier
    let amortNM = 0;                                                 // amortissements de bâti et de travaux déduits (réintégrés dans la plus-value)
    const amortNMfin = new Float64Array(H + 1), impotsCum = new Float64Array(H + 1);
    const imputer = (r, y) => { carry = carry.filter(x => x.fin >= y); for (const x of carry) { const u = Math.min(x.montant, r); x.montant -= u; r -= u; if (r <= EPS) break; } carry = carry.filter(x => x.montant > EPS); return Math.max(0, r); };
    for (let y = 1; y <= H; y++) {
      let R = 0, Dc = 0, J = 0;
      for (let t = 12 * (y - 1) + 1; t <= 12 * y; t++) { R += loyer[t]; Dc += charges[t] + gestion[t]; J += inter[t] + ass[t]; }
      const E1 = y === 1 ? p.fraisEmprunt : 0;
      let base = 0, imp = 0, imputeGlobal = 0, amortDeduit = 0, resultat = null;
      if (regime === "nu_micro") { base = R * (1 - p.mfAbat); imp = base * (p.tmi + p.psF); }
      else if (regime === "lmnp_micro") { base = R * (1 - p.mbAbat); imp = base * (p.tmi + p.psG); }
      else if (regime === "nu_reel") {
        const tr = y === 1 ? p.travaux : 0, r = R - Dc - J - E1 - tr;
        resultat = r;
        if (r >= 0) { base = imputer(r, y); imp = base * (p.tmi + p.psF); }
        else {
          const hors = R - Dc - tr, h = Math.max(0, -hors);
          imputeGlobal = Math.min(h, p.defPlafond, -r);
          imp = -imputeGlobal * p.tmi;
          const reste = -r - imputeGlobal;
          if (reste > EPS) carry.push({ montant: reste, fin: y + p.defFoncierAns });
        }
      } else {
        const r = R - Dc - J - E1 - (y === 1 ? p.FA : 0);
        resultat = r;
        const dot = [y <= p.dBati ? p.prix * (1 - p.terrain) / p.dBati : 0, y <= p.dTrav ? p.travaux / p.dTrav : 0, y <= p.dMob ? p.mobilier / p.dMob : 0];
        let reste;
        if (r < 0) { carry.push({ montant: -r, fin: y + p.defBicAns }); reste = 0; dot.forEach((v, k) => { stock[k] += v; }); }
        else {
          reste = imputer(r, y);
          for (let k = 0; k < 3; k++) {
            const dispo = dot[k] + stock[k], u = Math.min(dispo, reste);
            reste -= u; amortDeduit += u; if (k < 2) amortNM += u;
            stock[k] = dispo - u;
          }
        }
        base = reste; imp = base * (p.tmi + p.psG);
      }
      for (let t = 12 * (y - 1) + 1; t <= 12 * y; t++) impot[t] = imp / 12;
      amortNMfin[y] = amortNM; impotsCum[y] = impotsCum[y - 1] + imp;
      annees.push({ annee: y, loyers: r2(R), charges: r2(Dc), credit: r2(somme([...Array(12).keys()], k => ech[12 * (y - 1) + k + 1] + ass[12 * (y - 1) + k + 1])), interets: r2(J), resultat: resultat == null ? null : r2(resultat),
        base_imposable: r2(base), impot: r2(imp), impute_revenu_global: r2(imputeGlobal), amortissements_deduits: r2(amortDeduit) });
    }
    for (let t = 1; t < W; t++) cf[t] = loyer[t] - charges[t] - gestion[t] - ech[t] - ass[t] - impot[t];
    annees.forEach(a => { a.cash_flow = r2(somme([...Array(12).keys()], k => cf[12 * (a.annee - 1) + k + 1])); });
    return { ech, ass, inter, crd, loyer, charges, gestion, impot, cf, annees, regime, amortNMfin, impotsCum, avertissements: [...avert], stock_amortissements: r2(stock[0] + stock[1] + stock[2]) };
  }

  /** Impôt de plus-value immobilière d'un gain après `ans` années pleines (abattements du moteur) → { impot, surtaxe }. */
  function impotPvImmo(gain, ans, p) {
    if (!(gain > 0)) return { impot: 0, surtaxe: false };
    const ir = gain * (1 - F.abattementIR(ans)), ps = gain * (1 - F.abattementPS(ans));
    return { impot: ir * p.pvIr + ps * p.pvPs, surtaxe: p.surtaxe != null && ir > p.surtaxe };
  }

  /** Les quatre options, chemin par chemin, sur les tirages du moteur (§ 3.4 à 3.6). opts.fin_seule : seulement la sortie à T (seuils). → { P, T, points: [k], net: { id: [Float64Array(P) par k] } (€ d'aujourd'hui), courants, … }. */
  function simulerLocatifScpi(c, p, opts) {
    const { d, today } = c, o = opts || {}, det = o.volatilite === 0, PZ = det ? 1 : Math.max(1, Math.round(o.chemins || 2000)), T = p.T, H = T / 12;
    /* sous_chemins : les N premiers chemins des mêmes tirages (seuils de « ce qui changerait », plus rapides, sans changer de tirages) */
    const P = o.sous_chemins ? Math.min(PZ, o.sous_chemins) : PZ;
    const graine = o.graine == null ? Proj.GRAINE : o.graine;
    const ctx = D.contexte(d, { hypotheses_classes: Object.assign({}, objet(o.hypotheses_classes), objet(o.sur_classes)) }), pi = ctx.pi;
    const bien = D.parametresClasse("immobilier_physique", ctx), scpi = D.parametresClasse("immobilier", ctx), mone = D.parametresClasse("monetaire", ctx);
    const aB = Math.log(1 + bien.rendement / 100) / 12, sB = det ? 0 : bien.volatilite / 100 / Math.sqrt(12);
    const aP = Math.log(1 + p.prixPart) / 12, sP = det ? 0 : scpi.volatilite / 100 / Math.sqrt(12);
    const Z = det ? null : tirer(PZ, T, graine, ["immobilier_physique", "immobilier"]), Tz = Z ? Z.T : 0;
    const zB = Z ? Z.z.immobilier_physique : null, zS = Z ? Z.z.immobilier : null;
    /* livret : taux du repère jusqu'à sa date de fin, puis le monétaire central (règle du socle) */
    const rl = ctx.R.livret_a_taux, gl = new Float64Array(T + 1);
    if (rl) ctx.rv("livret_a_taux");
    for (let t = 1; t <= T; t++) gl[t] = rl && (!rl.dateFin || O.ajouterMois(today, t) <= rl.dateFin) ? Math.pow(1 + +rl.valeur / 100, 1 / 12) : Math.pow(1 + mone.rendement / 100, 1 / 12);
    const loc = exploitationLocatif(p, pi);
    const sc = p.credit && p.C > 0, ids = ["L", "S", "AV"].concat(sc ? ["SC"] : []);
    const lnSC = sc ? PC.amortissement({ capital: p.C, taux_pct: p.taux, duree_mois: p.duree * 12, assurance_pct: p.assurance }) : [];
    const points = o.fin_seule ? [H] : [...Array(H).keys()].map(k => k + 1);
    const net = {}, cour = {}, verse = {}, impots = {}, frais = {};
    ids.forEach(id => { net[id] = points.map(() => new Float64Array(P)); cour[id] = points.map(() => new Float64Array(P)); impots[id] = new Float64Array(P); frais[id] = new Float64Array(P); });
    const budgetCum = points.map(() => new Float64Array(P)), budgetMois = new Float64Array(T + 1);
    const effL = t => Math.max(0, -loc.cf[t]), surL = t => Math.max(0, loc.cf[t]);
    const feeM = 1 - Math.pow(1 - p.fav, 1 / 12);
    /* une règle de sortie de l'assurance-vie par anniversaire : primes versées à cette date (déterministes : A0 + efforts du locatif), pour la part au-delà de 150 000 € */
    const primesA = t => p.A0 + somme([...Array(t).keys()], m => effL(m + 1));
    const prepsAV = new Map(points.map(k => [k, F.preparer({ type: "assurance_vie", valeur: 0, base: primesA(12 * k), classe: "immobilier", date_ouverture: today },
      { reperes: d.reperes, couple: !!c.fo.couple, primes_titulaire: primesA(12 * k) })]));
    const datesK = new Map(points.map(k => [k, O.ajouterMois(today, 12 * k)])), dateT = k => datesK.get(k);
    const PrA = new Float64Array(T + 1);                              // prix de part à chaque souscription (plus-value par souscription)
    let surtaxe = false, budgetP50Base = null;
    const Xs = new Float64Array(T + 1), Ns = new Float64Array(T + 1), Nav = new Float64Array(T + 1);
    for (let i = 0; i < P; i++) {
      let Vb = p.prix, Pr = 1, potL = 0, potS = 0, potAV = 0, potSC = 0, cum = p.A0, impS = 0, impSC = 0, fraisS = 0, fraisAV = 0;
      Xs.fill(0); Ns.fill(0); Nav.fill(0);
      Xs[0] = p.A0; Ns[0] = p.A0; Nav[0] = p.A0; PrA[0] = 1;
      let minPrA = 1; fraisS += p.A0 * p.fs; fraisAV += p.A0 * p.fs;
      let jouS = 0, jouAV = 0, unitsAV = p.A0, baseAV = p.A0, Fav = 1, sumNs = p.A0;
      const XSC = p.A0 + p.C, NSC = XSC; let carrySC = [];
      const fraisSC0 = XSC * p.fs + p.fraisEmprunt;
      let ki = 0;
      for (let t = 1; t <= T; t++) {
        const zb = zB ? zB[i * Tz + (t - 1)] : 0, zs = zS ? zS[i * Tz + (t - 1)] : 0;
        Vb *= Math.exp(aB + sB * zb);
        const Prev = Pr; Pr *= Math.exp(aP + sP * zs);
        const u = t - p.dj - 1;
        if (u >= 0) { jouS += Ns[u]; jouAV += Nav[u]; }
        const eL = effL(t);
        /* S : SCPI en direct au comptant */
        const distS = jouS * Prev * p.dist / 12, taxS = distS * (p.tmi + p.psF), ndS = distS - taxS;
        impS += taxS;
        const XS = eL + (p.reinvestir ? ndS : 0);
        Xs[t] = XS; Ns[t] = XS / Pr; PrA[t] = Pr; fraisS += XS * p.fs; sumNs += Ns[t];
        if (XS > 0 && Pr < minPrA) minPrA = Pr;
        /* AV : parts dans l'assurance-vie (en parts « normalisées » : parts réelles = normalisées × Fav, Fav = facteur cumulé des frais de gestion),
           distribution réinvestie sans frais d'entrée, frais de gestion prélevés chaque mois sur toutes les parts */
        const distAV = jouAV * Fav * Prev * p.dist / 12;
        fraisAV += unitsAV * Fav * Pr * (1 - p.fs) * feeM + eL * p.fs;
        Fav *= 1 - feeM;
        const nouv = (eL / Pr + distAV / (Pr * (1 - p.fs))) / Fav;
        unitsAV += nouv; Nav[t] = nouv; baseAV += eL;
        /* SC : SCPI à crédit, intérêts déductibles mois par mois (déficit reporté 10 ans), distribution qui rembourse l'échéance */
        let eSC = 0, surSC = 0;
        if (sc) {
          const r = lnSC[t - 1], distSC = (t > p.dj ? NSC : 0) * Prev * p.dist / 12, I = r ? r.interets + r.assurance : 0, y = Math.ceil(t / 12);
          let res = distSC - I, taxSC = 0;
          carrySC = carrySC.filter(x => x.fin >= y);
          if (res < 0) carrySC.push({ montant: -res, fin: y + p.defFoncierAns });
          else { for (const x of carrySC) { const v = Math.min(x.montant, res); x.montant -= v; res -= v; if (res <= EPS) break; } carrySC = carrySC.filter(x => x.montant > EPS); taxSC = Math.max(0, res) * (p.tmi + p.psF); }
          impSC += taxSC;
          const cfSC = distSC - taxSC - (r ? r.echeance + r.assurance : 0);
          eSC = Math.max(0, -cfSC); surSC = Math.max(0, cfSC);
        }
        const b = Math.max(eL, eSC);
        cum += b; budgetMois[t] += b / P;
        potL = potL * gl[t] + (b - eL) + surL(t);
        potS = potS * gl[t] + (b - eL) + (p.reinvestir ? 0 : ndS);
        potAV = potAV * gl[t] + (b - eL);
        if (sc) potSC = potSC * gl[t] + (b - eSC) + surSC;
        if (ki < points.length && t === 12 * points[ki]) {
          const k = points[ki], defl = 1 / Math.pow(1 + pi, t / 12);
          /* L */
          const cession = Vb * (1 - p.revente), anc = k;
          const faPart = loc.regime === "lmnp_reel" ? 0.075 * p.prix : Math.max(p.FA, 0.075 * p.prix);
          let travPart = loc.regime === "nu_reel" ? 0 : p.travaux;
          if (anc > 5) travPart = Math.max(travPart, 0.15 * p.prix);
          const reint = loc.regime === "lmnp_reel" ? loc.amortNMfin[k] : 0;
          const pvL = impotPvImmo(cession - (p.prix + faPart + travPart) + reint, anc, p);
          if (pvL.surtaxe) surtaxe = true;
          const nL = cession - loc.crd[t] - pvL.impot + potL;
          /* S et SC : plus-value par souscription */
          const retS = sumNs * Pr * (1 - p.fs);
          let pvS = 0;
          if (Pr * (1 - p.fs) > minPrA) for (let v = 0; v <= t; v++) { if (!Ns[v] || Pr * (1 - p.fs) <= PrA[v]) continue; pvS += impotPvImmo(Ns[v] * Pr * (1 - p.fs) - Xs[v], Math.floor((t - v) / 12), p).impot; }
          const nS = retS - pvS + potS;
          const vAV = unitsAV * Fav * Pr * (1 - p.fs), xAV = prepsAV.get(k).calculer(vAV, baseAV, dateT(k), undefined), nAV = vAV - xAV.ir - xAV.ps + potAV;
          cour.L[ki][i] = nL; cour.S[ki][i] = nS; cour.AV[ki][i] = nAV;
          net.L[ki][i] = nL * defl; net.S[ki][i] = nS * defl; net.AV[ki][i] = nAV * defl;
          if (sc) {
            const valSC = NSC * Pr * (1 - p.fs), pvSC = impotPvImmo(valSC - XSC, k, p).impot, nSC = valSC - lnCrd(lnSC, t) - pvSC + potSC;
            cour.SC[ki][i] = nSC; net.SC[ki][i] = nSC * defl;
            if (k === points[points.length - 1]) { impots.SC[i] = impSC + pvSC; frais.SC[i] = fraisSC0; }
          }
          budgetCum[ki][i] = cum;
          if (k === points[points.length - 1]) {
            impots.L[i] = loc.impotsCum[k] + pvL.impot; frais.L[i] = p.FA + p.fraisEmprunt + somme([...Array(t).keys()], m => loc.gestion[m + 1]) + Vb * p.revente;
            impots.S[i] = impS + pvS; frais.S[i] = fraisS; impots.AV[i] = xAV.ir + xAV.ps; frais.AV[i] = fraisAV;
          }
          ki++;
        }
      }
    }
    return { P, T, H, points, net, cour, budgetCum, budgetMois, impots, frais, ids, loc, pi, surtaxe, deterministe: det, graine, ctx, bien, scpi, sc };
  }
  const lnCrd = (tab, t) => (t <= 0 ? (tab[0] ? tab[0].crd + tab[0].capital : 0) : tab[t - 1] ? tab[t - 1].crd : 0);

  /** Taux annuel qui égalise des versements mensuels (flux[0..T], négatifs) et une valeur finale à T → % ou null. */
  function triAnnuel(flux, finale) {
    const T = flux.length - 1, f = r => { let s = 0; for (let t = 0; t <= T; t++) s += flux[t] / Math.pow(1 + r, t); return s + finale / Math.pow(1 + r, T); };
    let lo = -0.04, hi = 0.04, a = f(lo), b = f(hi);
    if (!(a * b < 0)) return null;
    for (let k = 0; k < 100; k++) { const m = (lo + hi) / 2, v = f(m); if (v * a > 0) { lo = m; a = v; } else hi = m; }
    return r2((Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100);
  }

  function locatifScpi(c) {
    const { today, o, rep } = c;
    const p = parametresLocatif(c), pre = { chemins: o.chemins, graine: o.graine, volatilite: o.volatilite, hypotheses_classes: o.hypotheses_classes };
    const sim = simulerLocatifScpi(c, p, pre), H = sim.H, kT = sim.points.length - 1;
    const libL = LIB_LS.L + " (" + REGIMES_LOCATIF[sim.loc.regime] + ")", lib = id => (id === "L" ? libL : LIB_LS[id]);
    const q50 = a => quantile(a, 0.5);
    /* options au mois T */
    const options = sim.ids.map(id => Object.assign(sortieOption(id, lib(id), id === "L" ? ["bien_locatif"] : id === "AV" ? ["assurance_vie"] : ["scpi_direct"], {
      net: sim.net[id][kT], courants: sim.cour[id][kT], brut: sim.cour[id][kT], impots: sim.impots[id], ps: new Float64Array(sim.P), frais: sim.frais[id], base: q50(sim.budgetCum[kT]) }), { role: id === "L" ? "locatif" : "scpi" }));
    const p50 = id => q50(sim.net[id][kT]), ordre = sim.ids.slice().sort((a, b) => p50(b) - p50(a)), tete = ordre[0], second = ordre[1];
    const ecartK = (a, b, k) => { const A = sim.net[a][k], B = sim.net[b][k], dl = new Float64Array(sim.P), dc = new Float64Array(sim.P); let mieux = 0;
      for (let i = 0; i < sim.P; i++) { dl[i] = A[i] - B[i]; dc[i] = sim.cour[a][k][i] - sim.cour[b][k][i]; if (dl[i] > 1e-7) mieux++; }
      return { delta: dl, courants: dc, p10: quantile(dl, 0.1), p50: quantile(dl, 0.5), p90: quantile(dl, 0.9), probabilite_mieux: mieux / sim.P }; };
    const e = ecartK(tete, second, kT), enjeu = parAn(e, H);
    /* date de bascule : premier anniversaire à partir duquel la médiane de l'écart reste positive */
    let bascule = null;
    for (let k = kT; k >= 0; k--) { if (quantile(ecartK(tete, second, k).courants, 0.5) > 1e-6) bascule = O.ajouterMois(today, 12 * sim.points[k]); else break; }
    /* TRI médian : budget médian versé chaque mois, patrimoine net médian à la sortie */
    const flux = [-p.A0].concat([...Array(sim.T).keys()].map(t => -sim.budgetMois[t + 1]));
    const tri = Object.fromEntries(sim.ids.map(id => [id, triAnnuel(flux, q50(sim.cour[id][kT]))]));
    /* patrimoine par anniversaire (graphique) */
    const patrimoine = { points: sim.points.map((k, j) => ({ t: 12 * k, date: O.ajouterMois(today, 12 * k), options: Object.fromEntries(sim.ids.map(id => [id, bandeR(sim.net[id][j])])) })) };
    const courbe = { abscisse: "date_sortie", points: sim.points.map((k, j) => { const x = ecartK(tete, second, j), b = bandeR(x.delta); return { t: 12 * k, date: O.ajouterMois(today, 12 * k), p10: b.p10, p50: b.p50, p90: b.p90, courants_p50: r2(quantile(x.courants, 0.5)) }; }) };
    /* ce qui changerait la réponse (mêmes tirages, sortie à T seulement) */
    const ctq = [], avert = sim.loc.avertissements.slice();
    const meilleureScpi = sim.ids.filter(id => id !== "L").sort((a, b) => p50(b) - p50(a))[0];
    const ecartLs = (sur, surClasses) => { const s2 = simulerLocatifScpi(c, parametresLocatif(c, sur), Object.assign({}, pre, { fin_seule: true, sur_classes: surClasses, sous_chemins: 500 })); return quantile(Array.from(s2.net.L[0], (v, i) => v - s2.net[meilleureScpi][0][i]), 0.5); };
    const locDevant = q50(sim.net.L[kT]) >= p50(meilleureScpi), libS = PH_LS[meilleureScpi];
    if (!o.enjeu) {
      const pi = sim.pi, reval = c.L.v("immo_revalorisation_reelle");
      const fr = x => ecartLs(null, { immobilier_physique: { rendement: ((1 + pi) * (1 + x / 100) - 1) * 100 } });
      const sr = seuilDichotomie(x => -fr(x), -3, 3, 12);
      if (sr.etat === "ok") ctq.push(ligne("revalorisation_bien", O.frc(reval || 0, 1) + " %/an au-delà de l'inflation", O.frc(sr.x, 2) + " %/an", locDevant ? "En dessous, " + libS + " passent devant" : "Au-dessus, le bien locatif passe devant",
        (locDevant ? "Si le prix du bien progresse de moins de " : "Si le prix du bien progresse de plus de ") + O.frc(sr.x, 2) + " % par an au-delà de l'inflation, " + (locDevant ? libS + " font mieux" : "le bien locatif fait mieux") + " (les autres hypothèses restent les mêmes)."));
      const sd = seuilDichotomie(x => ecartLs({ dist: x }), 0, 10, 12);
      if (sd.etat === "ok") ctq.push(ligne("taux_distribution", O.frc(p.dist * 100, 2) + " %", O.frc(sd.x, 2) + " %", locDevant ? "Au-dessus, les SCPI passent devant" : "En dessous, le bien locatif passe devant",
        (locDevant ? "Si les SCPI distribuent plus de " : "Si les SCPI distribuent moins de ") + O.frc(sd.x, 2) + " % par an, " + (locDevant ? "elles font mieux que le bien locatif." : "le bien locatif fait mieux.")));
      const sv = seuilDichotomie(x => ecartLs({ vacance: x }), 0, 6, 12);
      if (sv.etat === "ok") ctq.push(ligne("vacance", O.frc(p.vacance, 1) + " mois/an", O.frc(sv.x, 1) + " mois/an", locDevant ? "Au-delà, le bien locatif passe derrière" : "En dessous, le bien locatif passe devant",
        (locDevant ? "Si ton bien reste vide plus de " : "Si ton bien reste vide moins de ") + O.frc(sv.x, 1) + " mois par an en moyenne, " + (locDevant ? libS + " font mieux." : "le bien locatif fait mieux.")));
      if (bascule && bascule > today) ctq.push(ligne("horizon", ans(H), dateFr(bascule), "Avant cette date, l'ordre s'inverse",
        "Si tu revends ou retires avant le " + dateFr(bascule) + ", " + PH_LS[tete] + (tete === "L" ? " ne fait" : " ne font") + " pas mieux " + que(PH_LS[second]) + " : les frais d'entrée ne sont pas encore amortis."));
    }
    /* avertissements dits */
    if (p.meuble && !(p.mobilier > 0)) avert.push("En meublé, le mobilier est à compter (souvent quelques milliers d'euros) : il est à 0 dans ce calcul.");
    if (!p.meuble && +rep.mobilier > 0) avert.push("En location nue, le mobilier n'est pas compté.");
    if (sim.loc.regime === "nu_reel" && sim.loc.annees.some(a => a.impute_revenu_global > 0)) avert.push("Le déficit foncier imputé sur ton revenu global suppose que le bien reste loué jusqu'au 31 décembre de la 3ᵉ année qui suit.");
    if (sim.loc.regime === "lmnp_reel") avert.push("À la revente, les amortissements du bâti et des travaux déduits sont ajoutés à la plus-value (cessions depuis le 15/02/2025), sauf pour certaines résidences de services (étudiants, seniors).");
    if (sim.surtaxe) avert.push("Ta plus-value immobilière dépasse " + O.eur(p.surtaxe) + " : une surtaxe s'ajoute, elle n'est pas calculée ici.");
    avert.push("SCPI : les revenus étrangers ne sont pas distingués (tout est imposé comme des revenus fonciers français, ce qui pénalise un peu les SCPI) ; plus-value des parts : " + F.MENTION_SCPI + ".");
    avert.push("Les travaux ne sont pas ajoutés à la valeur du bien (prudent) ; les loyers et les charges suivent l'inflation supposée.");
    if (c.frais.inconnus.includes("assurance_vie_pct") && !nombre(rep.frais_av_pct)) avert.push("Frais de l'assurance-vie non renseignés : comptés à 0 %, ce qui avantage l'option en assurance-vie ; renseigne-les pour un chiffre complet.");
    const enTete = Math.abs(e.p50) < 0.005 ? "egalite" : tete;
    const phrase = Math.abs(e.p50) < 0.005 ? "Sur " + ans(H) + ", à effort égal, " + PH_LS[tete] + " et " + PH_LS[second] + " font jeu égal avec ces hypothèses."
      : (tete === "L" ? "Sur " + ans(H) + ", à effort égal, le bien locatif (" + REGIMES_LOCATIF[sim.loc.regime] + ") te laisserait environ "
        : "Sur " + ans(H) + ", à effort égal, " + PH_LS[tete] + " te laisseraient environ ") + eur0(e.p50) + " de plus " + que(PH_LS[second]) + ", en euros d'aujourd'hui.";
    const reponse = { phrase, option_en_tete: enTete, reference: second, ecart: ecartBandes(e), ecart_annuel: enjeu, probabilite_mieux: p3(e.probabilite_mieux), date_bascule: bascule };
    return {
      options, reponse, courbe, ce_qui_changerait: ctq, avertissements: avert,
      enjeu_annuel: { p10: Math.min(enjeu.p10, enjeu.p50), p50: Math.max(0, enjeu.p50), p90: Math.max(enjeu.p90, enjeu.p50) }, sim: null,
      detail: { T: sim.T, regime: sim.loc.regime, credit: { capital: r2(p.C), mensualite: r2(sim.loc.ech[1] + sim.loc.ass[1]), duree_ans: p.duree, taux_pct: p.taux, frais_emprunt: r2(p.fraisEmprunt) },
        cout_total: r2(p.K), apport_utilise: r2(p.A0), frais_acquisition: r2(p.FA), effort_mensuel_an1: r2(somme([...Array(12).keys()], k => Math.max(0, -sim.loc.cf[k + 1])) / 12),
        locatif_annees: sim.loc.annees, stock_amortissements: sim.loc.stock_amortissements, tri, patrimoine, verse_p50: r2(quantile(sim.budgetCum[kT], 0.5)), ecart_courants: r2(quantile(e.courants, 0.5)) },
      plan: { tete, reference: second, plan: null, titulaire: c.titulaire },
      retenables: { options: {}, non: Object.fromEntries(sim.ids.map(id => [id, NON_RETENABLE_IMMO])) },
    };
  }

  const CALCULS = { ouvrirPea, prochainEuro, perInteret, matelas, avMaintenant, locatifScpi };
  /** Repères lus par un calcul en plus de ceux que déclare l'entrée du catalogue : un repère absent rend le scénario indisponible (jamais NaN, jamais de valeur de secours). */
  const REPERES_CALCUL = {
    ouvrirPea: ["scn_delai_ouverture_mois", "pea_plafond", "pea_duree_ans"],
    prochainEuro: ["scn_delai_ouverture_mois", "pea_plafond", "pea_duree_ans", "per_plafond_plancher"],
    perInteret: ["scn_delai_ouverture_mois", "per_plafond_plancher"],
    matelas: ["scn_delai_ouverture_mois", "scn_matelas_mois_stable", "scn_matelas_mois_fragile", "scn_matelas_mois_independant", "lep_plafond", "livret_a_plafond", "ldds_plafond", "lep_taux", "livret_a_taux"],
    avMaintenant: ["scn_delai_ouverture_mois", "av_duree_ans"],
    locatifScpi: ["frais_acquisition_ancien_pct", "frais_acquisition_neuf_pct", "garantie_pct", "frais_dossier", "assurance_emprunteur_defaut_pct", "ps_taux_foncier", "ps_taux_general",
      "pv_immo_ir_taux", "pv_immo_ps_taux", "pv_immo_surtaxe_seuil", "micro_foncier_plafond", "micro_foncier_abattement_pct", "micro_bic_plafond", "micro_bic_abattement_pct",
      "deficit_foncier_plafond", "deficit_foncier_report_ans", "deficit_bic_report_ans", "scn_lmnp_part_terrain_pct", "scn_lmnp_duree_bati_ans", "scn_lmnp_duree_travaux_ans",
      "scn_lmnp_duree_mobilier_ans", "scn_immo_frais_revente_pct", "scn_scpi_delai_jouissance_mois", "inflation_hypothese", "immo_revalorisation_reelle", "immo_volatilite",
      "rendement_central_monetaire", "rendement_central_immobilier", "scpi_taux_distribution", "ir_taux_forfaitaire", "ps_taux_av_epargne_logement", "av_duree_ans",
      "av_taux_ir_reduit", "av_seuil_versements", "av_abattement_seul", "av_abattement_couple"],
  };
  const reperesRequis = entree => [...new Set(liste(entree.reperes).concat(REPERES_CALCUL[entree.calcul] || []))];

  /* ================================================================== pertinence (§ 6.4) */
  const deNom = n => (/^[aeiouyéèh]/i.test(n) ? "d'" : "de ") + n;
  /** Évalue les règles de pertinence d'une entrée du catalogue pour une personne : { ok, raisons, manquants }. Une clé inconnue lève une erreur (test du catalogue). */
  function evaluerRegles(regles, k, p) {
    const out = { ok: true, raisons: [], manquants: [] };
    const ilA = (neg, quoi) => (k.fo.personnes.length <= 1 ? (neg ? "Tu n'as pas " : "Tu as ") : p.nom + (neg ? " n'a pas " : " a ")) + quoi;
    const non = (raison) => { out.ok = false; if (raison) out.raisons = []; };
    const oui = raison => { if (raison) out.raisons.push(raison); };
    Object.keys(objet(regles)).forEach(cle => {
      if (!out.ok) return;
      const v = regles[cle];
      switch (cle) {
        case "toujours": if (v !== true) non(); break;
        case "sans_enveloppe": {
          const manque = liste(v).filter(t => !detient(k.fo, p.id, famillesTypes[t] || [t]));
          if (manque.length === liste(v).length) manque.forEach(t => oui(ilA(true, deNom(nomEnveloppe[t] || t)))); else non();
          break;
        }
        case "avec_enveloppe": {
          const ont = liste(v).filter(t => detient(k.fo, p.id, famillesTypes[t] || [t]));
          if (ont.length) ont.forEach(t => oui(ilA(false, "un " + (nomEnveloppe[t] || t)))); else non();
          break;
        }
        case "capacite_min": if (k.cap >= v) oui("Environ " + O.eur(Math.round(k.cap)) + " par mois de capacité d'épargne"); else non(); break;
        case "tmi_min":
          if (k.tmi == null) { out.manquants.push({ champ: "tmi", libelle: "Ta tranche d'imposition", comment: "Elle figure sur ton avis d'impôt." }); oui("Ta tranche d'imposition n'est pas encore connue"); }
          else if (k.tmi >= v) oui("Tranche d'imposition de " + k.tmi + " %"); else non();
          break;
        case "age_min": case "age_max":
          if (p.age == null) { out.manquants.push({ champ: "naissance", libelle: "Ta date de naissance", comment: "Elle sert à l'âge exigé." }); break; }
          if ((cle === "age_min" && p.age < v) || (cle === "age_max" && p.age > v)) non(); break;
        case "age_sous_repere": {
          const limite = k.L.v(v);
          if (limite === undefined) { non(); break; }
          if (p.age == null) { out.manquants.push({ champ: "naissance", libelle: "Ta date de naissance", comment: "Elle sert à l'âge exigé." }); break; }
          if (p.age >= limite) non(); break;
        }
        case "revenus_activite": {
          const a = k.fo.personnes.some(x => x.salaire != null), rev = objet(objet(k.d.risque).reponses).revenus;
          const actif = a ? p.salaire > 0 : (rev != null && rev !== "sans");
          if (actif) oui("Un revenu d'activité"); else non();
          break;
        }
        case "surplus_matelas": { const E = k.matelas(); if (E.dep && E.surplus > EPS) oui("Environ " + eur0(E.surplus) + " au-delà de ta cible de précaution"); else non(); break; }
        case "matelas_ecart_pct": {
          const E = k.matelas();
          if (!E.dep) { out.manquants.push({ champ: "depenses_essentielles", libelle: "Tes dépenses essentielles", comment: "Elles viennent de ton budget." }); non(); break; }
          const sous = E.actuel < E.cible * (1 - v / 100), sur = E.actuel > E.cible * (1 + v / 100);
          if (sous) oui("Ton épargne de précaution est sous ta cible de " + eur0(E.cible)); else if (sur) oui("Ton épargne de précaution dépasse ta cible de " + eur0(E.cible)); else non();
          break;
        }
        case "lep_possible_non_detenu": {
          const lep = k.lep();
          if (lep.eligible === true && !k.fo.enveloppes.some(e => e.type === "lep")) oui("Tu peux ouvrir un LEP, plus rémunéré qu'un Livret A"); else non();
          break;
        }
        case "un_de": {
          const sous = liste(v).map(r => evaluerRegles(r, k, p)), ok = sous.find(x => x.ok);
          if (ok) { ok.raisons.forEach(r => oui(r)); ok.manquants.forEach(m => out.manquants.push(m)); } else non();
          break;
        }
        case "pour_toi_si": break;                       // lu par lister, pas par la pertinence
        default: throw new Error("règle de pertinence inconnue : « " + cle + " »");
      }
    });
    if (!out.ok) { out.raisons = []; }
    return out;
  }
  /** Pertinence d'un scénario pour le foyer : → { pertinent, personnes, raisons, manquants }. */
  function pertinence(entree, data, today, opts) {
    const d = Object.assign({}, data, { today }), L = lecteur(d), fo = foyer(d, today), o = opts || {};
    let memoE = null, memoL = null;
    const k = { d, L, fo, tmi: tmiDe(d), cap: capaciteDe(d),
      matelas: () => memoE || (memoE = etatMatelas(d, today, L.v, o, null)),
      lep: () => memoL || (memoL = eligibiliteLep(d, today, L.v, null)) };
    const pers = fo.personnes.length ? fo.personnes : [{ id: "p1", nom: "Toi", age: null, salaire: null }];
    const raisons = [], manquants = [], ok = [];
    pers.forEach(p => {
      const r = evaluerRegles(entree.pertinence, k, p);
      if (!r.ok) return;
      ok.push(p.id);
      r.raisons.forEach(x => { if (!raisons.includes(x)) raisons.push(x); });
      r.manquants.forEach(m => { if (!manquants.some(y => y.champ === m.champ)) manquants.push(m); });
    });
    return { pertinent: ok.length > 0, personnes: ok, raisons: ok.length ? raisons : [], manquants: ok.length ? manquants : [] };
  }
  /** Le scénario entre-t-il dans « Pour toi » ? (règle pour_toi_si du catalogue ; absente : oui) */
  function pourToiSi(entree, data, today, opts) {
    const r = objet(entree.pertinence).pour_toi_si;
    if (!r) return true;
    const d = Object.assign({}, data, { today }), L = lecteur(d), fo = foyer(d, today), o = opts || {};
    let memoE = null;
    const k = { d, L, fo, tmi: tmiDe(d), cap: capaciteDe(d), matelas: () => memoE || (memoE = etatMatelas(d, today, L.v, o, null)),
      lep: () => eligibiliteLep(d, today, L.v, null) };
    const p = fo.personnes[0] || { id: "p1", nom: "Toi", age: null, salaire: null };
    return evaluerRegles(r, k, p).ok;
  }

  /* ================================================================== jouer, enjeu, lister */
  /** Questions obligatoires selon les réponses : celles du catalogue, plus celles que le scénario rend nécessaires. */
  function questionsRequises(entree, rep, o) {
    const ids = liste(entree.questions).filter(q => q.obligatoire).map(q => q.id);
    if (entree.calcul === "ouvrirPea" && rep.debut === "plus_tard") ids.push("debut_date");
    if (entree.calcul === "prochainEuro" && rep.retrait_avant === false && !o.enjeu) ids.push("tmi_retraite_pct", "date_retraite");
    return [...new Set(ids)];
  }
  const manquantQuestion = q => ({ champ: q.id, question_id: q.id, libelle: q.libelle, comment: q.aide || "Réponds à cette question." });

  /** Joue un scénario : calcule la réponse sur les données et les réponses (le serveur recalcule tout, jamais de chiffre venu du LLM). → résultat (§ 6.7). */
  function jouer(entree, data, reponses, today, opts) {
    const o = opts || {}, d = Object.assign({}, data, { today }), L = lecteur(d), det = o.volatilite === 0;
    const base = { cle: entree.cle, version: entree.version == null ? null : entree.version, version_calcul: entree.version_calcul || VERSION_CALCUL, version_modele: Proj.versionModele,
      graine: o.graine == null ? Proj.GRAINE : o.graine, chemins: det ? 1 : Math.round(o.chemins || 2000), date: today, rappel: RAPPEL };
    const requis = reperesRequis(entree);
    const hypotheses = () => requis.filter(cle => L.idx[cle]).map(cle => hypotheseDe(L.idx[cle], today));
    const absents = requis.filter(cle => !L.idx[cle]);
    if (absents.length) return Object.assign(base, { statut: "indisponible", reperes_manquants: absents, manquants: [], hypotheses: hypotheses(),
      avertissements: ["Un repère nécessaire à ce calcul manque (" + absents.join(", ") + ") : aucun chiffre n'est donné plutôt qu'une valeur de remplacement."] });
    const erreurs = reponsesValides(entree, reponses);
    if (erreurs) throw new Error("réponses invalides : " + erreurs.join(" ; "));
    const donnees = Object.fromEntries(Object.entries(objet(reponses)).filter(([, v]) => v !== null && v !== undefined));
    const rep = Object.assign({}, preremplir(entree, d, today, o), donnees);
    const qs = Object.fromEntries(liste(entree.questions).map(q => [q.id, q]));
    const manquants = questionsRequises(entree, rep, o).filter(id => rep[id] === undefined).map(id => manquantQuestion(qs[id]));
    if (manquants.length) return Object.assign(base, { statut: "a_completer", manquants, hypotheses: hypotheses(), avertissements: [] });
    const calc = CALCULS[entree.calcul];
    if (!calc) throw new Error("calcul inconnu : « " + entree.calcul + " »");
    const fo = foyer(d, today), frais = fraisDe(d, o, rep), pe = pertinence(entree, d, today, o);
    if (entree.calcul === "matelas" && !depensesReference(d, today, o)) {
      return Object.assign(base, { statut: "a_completer", manquants: [{ champ: "depenses_essentielles", libelle: "Tes dépenses essentielles", comment: "Elles viennent de ton budget : demande à Claude de le compléter." }], hypotheses: hypotheses(), avertissements: [] });
    }
    const r = calc({ entree, d, today, rep, L, o, fo, frais, titulaire: pe.personnes[0] || "p1" });
    if (r.statut === "indisponible") return Object.assign(base, { statut: "indisponible", reperes_manquants: r.reperes_manquants, manquants: [], hypotheses: hypotheses(), avertissements: ["Un repère nécessaire à ce calcul manque (" + r.reperes_manquants.join(", ") + ") : aucun chiffre n'est donné plutôt qu'une valeur de remplacement."] });
    if (r.statut === "a_completer") return Object.assign(base, { statut: "a_completer", manquants: r.manquants, hypotheses: hypotheses(), avertissements: [] });
    const hyp = hypotheses(), avert = r.avertissements.slice();
    /* règles fiscales appliquées faute de donnée (date d'ouverture d'une enveloppe existante) : dites, jamais tues */
    liste(r.sim && r.sim.mentions).forEach(x => {
      const qui = x.libelle || nomEnveloppe[x.type === "capitalisation" ? "assurance_vie" : x.type] || x.type, t = qui.charAt(0).toUpperCase() + qui.slice(1) + " : " + x.texte + ".";
      if (!avert.includes(t)) avert.push(t);
    });
    /* l'abattement de l'assurance-vie après 8 ans est compté en entier pour cet argent (hypothèse du calcul « à la marge ») : dit */
    if (r.sim && r.sim.abattement_av_utilise) {
      const ab = fo.couple ? L.v("av_abattement_couple") : L.v("av_abattement_seul");
      avert.push("L'abattement annuel de l'assurance-vie (" + O.eur(ab) + (fo.couple ? " pour un couple imposé ensemble" : "") + ") est compté en entier pour cet argent : il vaut pour l'ensemble de tes contrats, donc il est plus faible si tu retires aussi d'un autre contrat la même année.");
    }
    hyp.filter(h => h.statut === "a_reverifier").forEach(h => avert.push("Le repère « " + h.libelle + " » est à revérifier" + (h.date_fin && h.date_fin < today ? " (la période s'est terminée le " + dateFr(h.date_fin) + ")" : " (vérifié le " + dateFr(h.source.verifie_le) + ")") + " : le chiffre est donné avec cette valeur."));
    const utilisees = liste(entree.questions).filter(q => rep[q.id] !== undefined).map(q => ({ champ: q.id, libelle: q.libelle, valeur: rep[q.id], origine: donnees[q.id] !== undefined ? "reponse" : "boussole", le: today }));
    const opts_ = r.options.map(o => {
      const rt = r.retenables || { options: {}, non: {} }, h = rt.options[o.id];
      if (h && h.hypothese) return Object.assign({}, o, { retenable: true, enveloppe_scenario: h.hypothese });
      return Object.assign({}, o, { retenable: false, raison_non_retenable: h ? h.erreur : (rt.non[o.id] || (o.exclue ? "Cette option est écartée pour ta situation." : "Cette option ne se retient pas.")) });
    });
    const out = Object.assign(base, { statut: "ok", manquants: [], reponse: r.reponse, options: opts_, ce_qui_changerait: r.ce_qui_changerait, hypotheses: hyp, donnees_utilisees: utilisees,
      avertissements: avert, enjeu_annuel: r.enjeu_annuel, detail: r.detail, titulaire: r.plan && r.plan.titulaire || null });
    if (r.courbe) out.courbe = r.courbe;
    Object.defineProperty(out, "_calcul", { value: { sim: r.sim, plan: r.plan, rep }, enumerable: false });
    return out;
  }

  /** Variante figée d'une option retenue : { nom, description, hypotheses: { enveloppe_scenario } }, de la forme validée par Evenements.validerVariante (le moteur la rejoue, proj-1.3.0).
      Lève une erreur claire si l'option ne se retient pas (référence, plusieurs enveloppes, écartée). */
  function varianteRetenue(entree, resultat, option_id) {
    const o = liste(resultat && resultat.options).find(x => x.id === option_id);
    if (!o) throw new Error("option inconnue : « " + option_id + " »");
    if (!o.retenable || !o.enveloppe_scenario) throw new Error("cette option ne se retient pas : " + (o.raison_non_retenable || "elle n'est pas une variante de projection"));
    const coupe = (t, n) => (t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…");
    const nom = coupe("Scénario " + (entree.numero != null ? entree.numero : entree.cle) + " : " + o.libelle, 40);
    const description = coupe("Retenu depuis « " + entree.question + " » le " + dateFr(resultat.date) + " (calcul " + resultat.version_calcul + "). " + (resultat.reponse ? resultat.reponse.phrase : ""), 300);
    const v = { nom, description, hypotheses: { enveloppe_scenario: copie(o.enveloppe_scenario) } };
    const msg = E.validerVariante(v);
    if (msg) throw new Error("variante invalide : " + msg);
    return v;
  }

  /** Enjeu annuel d'un scénario pour la personne, sur ses seules données (réponses préremplies) : { p10, p50, p90, unite, statut, raison? }. */
  function enjeu(entree, data, today, opts) {
    const o = Object.assign({}, opts || {}), reponses = o.reponses || {};
    delete o.reponses;
    const r = jouer(entree, data, reponses, today, Object.assign({ chemins: 500 }, o, { enjeu: true }));
    if (r.statut === "ok") return { p10: r.enjeu_annuel.p10, p50: r.enjeu_annuel.p50, p90: r.enjeu_annuel.p90, unite: UNITE_ENJEU, statut: "ok", avertissements: r.avertissements.slice() };
    const vide = { p10: null, p50: null, p90: null, unite: UNITE_ENJEU };
    if (r.statut === "a_completer") return Object.assign(vide, { statut: "a_completer", raison: "Il manque : " + r.manquants.map(m => m.libelle.toLowerCase()).join(", ") });
    return Object.assign(vide, { statut: "indisponible", raison: r.avertissements[0] });
  }

  /** Les cartes qui entrent dans « Pour toi » : pertinentes, non écartées, au-dessus du seuil d'enjeu, par enjeu décroissant, trois au plus. */
  function pourToi(cartes, seuil) {
    const s = seuil == null ? SEUIL_ENJEU_DEFAUT : seuil;
    const ok = liste(cartes).filter(c => c.pertinent && c.etat !== "ecarte" && c.pour_toi_si !== false && nombre(c.enjeu_p50) && c.enjeu_p50 >= s).sort((a, b) => b.enjeu_p50 - a.enjeu_p50).slice(0, 3);
    return { cles: ok.map(c => c.cle), message: ok.length ? null : MESSAGE_RIEN_URGENT };
  }

  /** Cartes du catalogue pour la personne, tri « pour toi » et regroupement par thème.
      joues = [{ scenario_cle, etat, joue_le }] (parties de la personne) ; opts.reponses_par_cle = { cle: réponses } pour calculer l'enjeu sur des réponses données. */
  function lister(catalogue, data, joues, today, opts) {
    const o = opts || {}, L = lecteur(Object.assign({}, data, { today })), seuil = L.v("scn_enjeu_min_eur_an");
    const derniere = {};
    liste(joues).forEach(j => { if (!derniere[j.scenario_cle] || String(j.joue_le || "") >= String(derniere[j.scenario_cle].joue_le || "")) derniere[j.scenario_cle] = j; });
    const cartes = liste(catalogue).map(e => {
      const pe = pertinence(e, data, today, o), j = derniere[e.cle];
      const carte = { cle: e.cle, numero: e.numero, theme: e.theme, question: e.question, pertinent: pe.pertinent, pourquoi: pe.raisons, manquants: pe.manquants.slice(), enjeu: null, enjeu_p50: null, enjeu_statut: pe.pertinent ? "a_completer" : null,
        etat: j ? j.etat : "a_explorer", joue_le: j ? j.joue_le || null : null, version: e.version == null ? null : e.version, reperes_a_reverifier: [], pour_toi_si: true, avertissements: [] };
      if (!pe.pertinent) return carte;
      const ej = enjeu(e, data, today, Object.assign({}, o, { reponses: objet(o.reponses_par_cle)[e.cle] }));
      carte.enjeu_statut = ej.statut;
      if (ej.statut === "ok") { carte.enjeu = { p10: ej.p10, p50: ej.p50, p90: ej.p90 }; carte.enjeu_p50 = ej.p50; carte.avertissements = ej.avertissements; }
      else if (ej.raison) carte.raison_enjeu = ej.raison;
      carte.reperes_a_reverifier = reperesRequis(e).filter(cle => L.idx[cle] && statutRepere(L.idx[cle], today) === "a_reverifier");
      carte.pour_toi_si = pourToiSi(e, data, today, o);
      return carte;
    });
    const choix = pourToi(cartes, seuil === undefined ? SEUIL_ENJEU_DEFAUT : seuil);
    const parTheme = {};
    THEMES.forEach(t => {
      const l = cartes.filter(c => c.theme === t);
      if (l.length) parTheme[t] = l.slice().sort((a, b) => (a.etat === "ecarte") - (b.etat === "ecarte") || (b.enjeu_p50 == null ? -1 : b.enjeu_p50) - (a.enjeu_p50 == null ? -1 : a.enjeu_p50) || a.numero - b.numero);
    });
    return { pour_toi: choix.cles, message: choix.message, par_theme: parTheme, cartes };
  }

  return {
    VERSION_CALCUL, THEMES, CALCULS, RAPPEL, MESSAGE_RIEN_URGENT, UNITE_ENJEU,
    simulerEnveloppes, jouer, enjeu, lister, pertinence, pourToi, pourToiSi, reponsesValides, preremplir, varianteRetenue,
    seuilDichotomie, versementPer, repartirPlafond, plafondRfrLep, imputerPlafondsPer, economiePer, plafondPer,
    tirer, bande, statutRepere, lireEssentiels, CHAMP_ESSENTIELS,
  };
});
