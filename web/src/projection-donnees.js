/* Données du moteur de projection (PROJ) : lecture des repères avec suivi des manques, hypothèses par classe d'actifs, compartiments
   (enveloppe × titulaire × classe) construits depuis les positions, capacité d'épargne de départ (constatée, prévue, programmée),
   crédits en cours. Pur, sans DOM. Global ProjectionDonnees ; copié tel quel dans le connecteur (npm run gen).
   Entrée : data = { today, positions, instruments, config, profil, credits, biens, budget, banque, historique?, objectifs, foyer, reperes, classes?, calendrier? }. */
(function (root, factory) {
  const noeud = typeof module === "object" && module.exports;
  const dep = (global, chemin) => (noeud ? require(chemin) : root[global]);
  const api = factory({ O: dep("ProjectionOutils", "./projection-outils.js"), F: dep("ProjectionFiscalite", "./projection-fiscalite.js"),
    C: dep("ProjectionCredit", "./projection-credit.js"), Marche: dep("Marche", "./marche.js"), Calc: dep("Calc", "./calc.js"),
    Plan: dep("Plan", "./plan.js"), Calendrier: dep("Calendrier", "./calendrier.js") });
  if (noeud) module.exports = api;
  else root.ProjectionDonnees = api;
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";
  const { O, F, C, Marche, Calc, Plan, Calendrier } = D;

  const objet = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const liste = v => (Array.isArray(v) ? v : []);
  const sum = (l, f) => l.reduce((a, x) => a + f(x), 0);

  /** Les 12 classes tirées, dans cet ordre fixe, même si le foyer ne les détient pas (nombres aléatoires communs). */
  const CLASSES_TIREES = Marche.CLES.filter(k => k !== "levier").concat(["actions_nasdaq100", "immobilier_physique"]);
  const IDX = Object.fromEntries(CLASSES_TIREES.map((k, i) => [k, i]));

  /* ------------------------------------------------------------------ corrélations */
  function correlationTirees(a, b) {
    if (a === b) return 1;
    const racine = k => (k === "actions_nasdaq100" ? "levier" : k === "immobilier_physique" ? "immobilier" : k);
    const nas = k => k === "actions_nasdaq100", phy = k => k === "immobilier_physique";
    if ((nas(a) && phy(b)) || (nas(b) && phy(a))) return Marche.correlation("levier", "immobilier");
    if ((phy(a) && b === "immobilier") || (phy(b) && a === "immobilier")) return 0.5; /* convention, aucune source */
    return Marche.correlation(racine(a), racine(b));
  }
  const matriceTirees = () => CLASSES_TIREES.map(a => CLASSES_TIREES.map(b => correlationTirees(a, b)));
  let cacheCholesky = null;
  /** Facteur de Cholesky (plat 12 × 12) des classes tirées ; corrigé par la méthode de Higham si la matrice n'était pas définie positive. */
  function choleskyTirees() {
    if (!cacheCholesky) {
      const A = matriceTirees(), L = O.cholesky(A);
      if (L) cacheCholesky = { L, correction: null };
      else { const c = O.pluProcheDefiniePositive(A); cacheCholesky = { L: O.cholesky(c.matrice), correction: { ecartMax: c.ecartMax } }; }
    }
    return cacheCholesky;
  }

  /* ------------------------------------------------------------------ contexte : repères lus, manques, variante, réglages */
  /** Contexte de calcul d'une entrée : { d, o, today, perimetre, R, rv, manquant, manquants, utilises, pi, reglages, hypClasses, variante, evenements }. */
  function contexte(data, options) {
    const d = data || {}, o = options || {};
    const R = O.indexReperes(d.reperes), utilises = new Map(), manquants = new Map();
    const rv = cle => { const r = R[cle]; if (!r) return undefined; utilises.set(cle, r); return +r.valeur; };
    const manquant = (cle, pourquoi) => { if (!manquants.has(cle)) manquants.set(cle, pourquoi); };
    const cfgp = objet(objet(d.config).projection);
    const variante = o.variante ? liste(objet(d.foyer).variantes).find(v => v && v.id === o.variante) || null : null;
    const hv = variante ? objet(variante.hypotheses) : {};
    const pick = (...vals) => vals.find(v => v !== undefined && v !== null);
    const cibles = ciblesAllocation(d, o.perimetre || "foyer");
    const reglages = {
      base_capacite: pick(o.base_capacite, cfgp.base_capacite),
      capacite_mensuelle: pick(o.capacite_mensuelle),
      reste_capacite: pick(o.reste_capacite, hv.reste_capacite, cfgp.reste_capacite, cibles ? "cible" : "disponible"),
      reequilibrage: pick(o.reequilibrage, hv.reequilibrage, cfgp.reequilibrage, "aucun"),
      part_reaffectee_epargne_pct: +pick(hv.part_reaffectee_epargne_pct, cfgp.part_reaffectee_epargne_pct, 100),
      part_hausse_epargnee_pct: +pick(hv.part_hausse_epargnee_pct, cfgp.part_hausse_epargnee_pct, 50),
      salaire_croissance_reelle_pct: pick(hv.salaire_croissance_reelle_pct, cfgp.salaire_croissance_reelle_pct, R.salaire_croissance_reelle ? +R.salaire_croissance_reelle.valeur : undefined),
      tmi_pct: pick(cfgp.tmi_pct, objet(objet(d.profil).foyer).tmi),
      per_versements_deduits: cfgp.per_versements_deduits !== false,
      assurance_pct: cfgp.assurance_pct != null ? +cfgp.assurance_pct : undefined,
      epargne_delta_mensuel: +pick(hv.epargne_delta_mensuel, 0),
      biens: objet(cfgp.biens),
    };
    /* repères propres à la projection : déclarés (manquants, utilisés) par preparer(), pas par les autres fonctions (capacité d'emprunt…) */
    const salaireManquant = reglages.salaire_croissance_reelle_pct === undefined;
    if (salaireManquant) reglages.salaire_croissance_reelle_pct = 0;
    const hypClasses = Object.assign({}, objet(hv.hypotheses_classes), objet(o.hypotheses_classes));
    const pi0 = R.inflation_hypothese ? +R.inflation_hypothese.valeur : undefined;
    return { d, o, today: d.today, perimetre: o.perimetre || "foyer", R, rv, manquant, manquants, utilises, pi: (pi0 || 0) / 100, reglages, hypClasses, variante, cibles, inflationManquante: pi0 === undefined, salaireManquant };
  }

  /** Poids d'allocation cible par classe (somme 1) depuis config.targets : plat { classe: % } ou par personne { p1: { poche: % }, p2 }. null si aucune cible. */
  function ciblesAllocation(d, perimetre) {
    const t = objet(objet(d.config).targets), poids = {};
    const ajoute = (cle, v) => {
      if (!(+v > 0)) return;
      const k = Marche.CLASSES[cle] ? cle : Calc.classe(cle, d.classes);
      if (k === "levier" || !Marche.CLASSES[k]) return;
      poids[k] = (poids[k] || 0) + +v;
    };
    const plat = Object.keys(t).filter(k => typeof t[k] === "number" && k !== "tolerancePts");
    if (plat.length) plat.forEach(k => ajoute(k, t[k]));
    else (perimetre === "foyer" ? ["p1", "p2"] : [perimetre]).forEach(p => Object.keys(objet(t[p])).forEach(k => ajoute(k, t[p][k])));
    const total = sum(Object.values(poids), x => x);
    if (!(total > 0)) return null;
    Object.keys(poids).forEach(k => { poids[k] /= total; });
    return poids;
  }

  /* ------------------------------------------------------------------ hypothèses de classe */
  /** Rendement central (%), volatilité (%) d'une classe tirée, avec les surcharges d'hypothèse (variante, réglages de test). */
  function parametresClasse(k, ctx) {
    const rv = ctx.rv, over = (ctx.hypClasses && ctx.hypClasses[k]) || {};
    const base = k === "actions_nasdaq100" ? "actions" : k;
    let rendement, volatilite, repli = false, central = false;
    if (k === "immobilier_physique") {
      const reval = rv("immo_revalorisation_reelle");
      if (reval === undefined) ctx.manquant("immo_revalorisation_reelle", "revalorisation des biens : supposée nulle en euros constants");
      rendement = ((1 + ctx.pi) * (1 + (reval || 0) / 100) - 1) * 100;
      const vol = rv("immo_volatilite");
      if (vol === undefined) ctx.manquant("immo_volatilite", "volatilité des logements : celle des SCPI est prise à défaut");
      volatilite = vol !== undefined ? vol : Marche.CLASSES.immobilier.volatilite;
    } else {
      const cl = Marche.CLASSES[base], c = rv("rendement_central_" + base);
      if (c !== undefined) { rendement = c; central = true; } else { rendement = cl.rendementLong; repli = true; ctx.manquant("rendement_central_" + base, "rendement historique sans hypothèse prospective"); }
      volatilite = k === "fonds_euros" ? 0 : cl.volatilite;
      if (k === "actions_nasdaq100") {
        const v = rv("nasdaq100_volatilite");
        if (v !== undefined) volatilite = v; else ctx.manquant("nasdaq100_volatilite", "la perte due au levier est sous-estimée");
      }
    }
    if (over.rendement != null) { rendement = +over.rendement; repli = false; central = false; }
    if (over.volatilite != null) volatilite = +over.volatilite;
    return { classe: k, rendement, volatilite, repli, central, surcharge: over.rendement != null || over.volatilite != null };
  }

  /* ------------------------------------------------------------------ capacité d'épargne de départ (spec § 6.1) */
  /** Capacité de base : constatée (comptes), prévue (budget), programmée (virements), retenue et sa source. options : { perimetre, base_capacite, capacite_mensuelle }. */
  function capaciteDeBase(data, options) {
    const d = data || {}, o = options || {}, sc = o.perimetre || "foyer", cfgp = objet(objet(d.config).projection);
    const R = O.indexReperes(d.reperes), today = d.today;
    const lignes = d.budget && Array.isArray(d.budget.lignes) ? d.budget.lignes : [];
    const totaux = Plan.budgetTotaux(lignes, d.profil, sc);
    const prevue = Plan.capaciteEpargne(totaux);
    const rec = liste(objet(d.config).recurring).filter(r => {
      if (!r || !(+r.amount > 0)) return false;
      if (sc === "foyer") return true;
      const p = liste(d.positions).find(x => x && x.id === r.positionId);
      return p && p.owner === sc;
    });
    const programmee = sum(rec, r => +r.amount);
    const mentions = [];
    let constatee = null, detail = null;
    // HIS2 : la série fusionnée (Powens et relevés importés, Calc.moisBancaires) nourrit la capacité constatée, même sans banque connectée
    if (sc === "foyer" && (d.banque || liste(objet(d.historique).releves).length)) {
      let r = Calc.budgetReel(d.banque, today, 12, d.historique), courte = false;
      if (!(r && r.n >= 6)) { r = Calc.budgetReel(d.banque, today, 3, d.historique); courte = !!r; }
      if (r) {
        constatee = r.capacite;
        detail = { montant: r.capacite, mois: r.n, revenus: r.revenus, depenses: r.depenses, periode: Calc.periodeReel(r), courte, du: r.du, au: r.au };
        if (courte) mentions.push("période courte : la capacité constatée repose sur " + r.n + " mois seulement");
      }
    } else if (sc !== "foyer") mentions.push("la capacité constatée n'existe que pour le foyer : la capacité prévue est utilisée pour une personne");
    const demande = o.base_capacite || cfgp.base_capacite || null;
    const montantForce = o.capacite_mensuelle != null ? +o.capacite_mensuelle : (demande === "montant" && cfgp.capacite_mensuelle != null ? +cfgp.capacite_mensuelle : null);
    let retenue, source;
    if (montantForce != null && isFinite(montantForce)) { retenue = montantForce; source = "montant"; }
    else if (demande === "prevu") { retenue = prevue; source = "prevu"; }
    else if (constatee != null) { retenue = constatee; source = "reel"; if (demande === "montant") mentions.push("capacité fixée demandée sans montant : la capacité constatée est utilisée"); }
    else { retenue = prevue; source = "prevu"; }
    const seuil = R.garde_fou_ecart_capacite ? +R.garde_fou_ecart_capacite.valeur / 100 : null;
    let ecart = null, signale = false;
    if (constatee != null) {
      const rel = a => { const m = Math.max(Math.abs(a), Math.abs(constatee)); return m > 0 ? Math.abs(a - constatee) / m : 0; };
      ecart = Math.max(rel(prevue), programmee > 0 ? rel(programmee) : 0);
      if (seuil == null) mentions.push("repère garde_fou_ecart_capacite manquant : écart entre capacité prévue et constatée non signalé");
      else signale = ecart > seuil + 1e-12;
    }
    return { constatee, prevue, programmee, retenue, source, ecart_pct: ecart == null ? null : ecart * 100, signale, periode: detail ? detail.periode : null,
      constatee_detail: detail, base_demandee: demande, revenus_prevus: totaux.revenus, depenses_prevues: totaux.depensesLignes, mensualites_prevues: totaux.mensualites, mentions };
  }

  /* ------------------------------------------------------------------ compartiments (spec § 4.1) */
  const TYPES_ENVELOPPE = Object.keys(Calendrier.TYPES).concat(["courant", "scpi_direct", "epargne_autre"]);
  const AVEC_VC = ["assurance_vie", "capitalisation", "per", "pea", "pea_pme", "pea_jeune", "pee", "percol"];
  const DISPO = ["courant", "livret_a", "ldds", "lep", "cel", "epargne_autre"];
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const personnesDe = sc => (sc === "foyer" ? ["p1", "p2"] : [sc]);

  /** Compartiments du périmètre : [{ id, enveloppe, cle, titulaire, owner, type, classe, levier, v0, base0, base_inconnue, ter_pct, frais_env_pct, dispo, dates,
      fiscal (compartiment fiscal), prep (F.preparer), lignes }] et les avertissements de données manquantes. Crée un compte courant à 0 s'il n'y en a pas. */
  function construireCompartiments(ctx) {
    const d = ctx.d, sc = ctx.perimetre, today = ctx.today, infos = objet(objet(d.config).enveloppes_infos), fraisEnv = objet(objet(d.config).frais_enveloppes);
    const toutes = liste(d.positions), positions = toutes.filter(p => p && Calc.counted(p) && Calc.inScope(p, sc));
    const instr = {};
    liste(d.instruments).forEach(i => { if (i && i.isin) instr[i.isin] = i; });
    const cal = d.calendrier || Calendrier.calendrier(d, today);
    const groupes = new Map(), manques = { prix_revient: [], date_ouverture: [], frais_enveloppe: [], type: [] };
    positions.forEach(p => {
      const nomEnv = String(p.envelope || "").trim();
      const cle = nomEnv ? Calendrier.cleEnveloppe(nomEnv, p.owner, toutes, infos) : "";
      const info = objet(infos[cle]), famille = Calc.famille(p, d.classes);
      let type = TYPES_ENVELOPPE.includes(info.type) ? info.type : null;
      if (famille === "courant") type = "courant";
      else {
        if (!type && nomEnv) type = Calendrier.typeDeduit(nomEnv);
        if (!type && famille === "epargne") type = "epargne_autre";
      }
      let classe = Marche.classeRisque(p, d.classes);
      if (type === "courant") classe = "courant";
      else if (DISPO.includes(type) || type === "pel") classe = "monetaire";
      /* SCPI détenue en direct seulement : un fonds immobilier coté (ISIN, cours) reste un titre de son compte-titres, jamais une SCPI */
      if (classe === "immobilier" && (type == null || type === "compte_titres")) {
        const cote = !!p.isin || p.mode === "market", scpi = /scpi|pierre papier/.test(norm((p.name || "") + " " + (p.bloc || "")));
        if (type == null) type = cote ? "compte_titres" : "scpi_direct";
        else if (scpi && !cote) type = "scpi_direct";
      }
      let multiple = 0, sousJacent = null;
      if (classe === "levier") {
        const txt = norm((p.name || "") + " " + (p.bloc || ""));
        const m = /([23]) ?[x×]|[x×] ?([23])/.exec(txt);
        multiple = m ? +(m[1] || m[2]) : 2;
        sousJacent = /nasdaq/.test(txt) ? "actions_nasdaq100" : "actions";
      }
      const cleG = [cle || nomEnv, p.owner, classe, multiple, sousJacent].join("|");
      if (!groupes.has(cleG)) groupes.set(cleG, { cle, nomEnv, owner: p.owner, type, classe, multiple, sousJacent, info, lignes: [] });
      groupes.get(cleG).lignes.push(p);
    });
    const comps = [];
    groupes.forEach(g => {
      const v0 = sum(g.lignes, Calc.val);
      let base = 0, inconnu = false;
      g.lignes.forEach(p => {
        const qb = p.qty != null && p.pru != null && isFinite(+p.qty) && isFinite(+p.pru) ? +p.qty * +p.pru : null;
        if (qb != null) base += qb; else { base += Calc.val(p); inconnu = true; }
      });
      const ter = v0 > 0 ? sum(g.lignes, p => Calc.val(p) * O.n0(p.ter != null ? p.ter : (instr[p.isin] && instr[p.isin].ter))) / v0
        : sum(g.lignes, p => O.n0(p.ter != null ? p.ter : (instr[p.isin] && instr[p.isin].ter))) / Math.max(1, g.lignes.length);
      const fe = objet(fraisEnv[g.cle] || fraisEnv[g.nomEnv]);
      let fenv = 0, feConnu = false;
      if (["assurance_vie", "capitalisation", "per", "percol", "pee"].includes(g.type)) { const k = g.classe === "fonds_euros" ? "gestion_euro_pct" : "gestion_uc_pct"; feConnu = fe[k] != null; fenv = O.n0(fe[k]); }
      else if (["compte_titres", "pea", "pea_pme", "pea_jeune"].includes(g.type)) { feConnu = fe.garde_pct != null; fenv = O.n0(fe.garde_pct); }
      else feConnu = true;
      if (!feConnu && !manques.frais_enveloppe.includes(g.nomEnv)) manques.frais_enveloppe.push(g.nomEnv);
      const taxable = !DISPO.includes(g.type);
      const c = { id: "c" + comps.length, enveloppe: g.nomEnv, cle: g.cle, titulaire: g.owner, owner: g.owner, type: g.type, classe: g.classe,
        levier: g.multiple ? { multiple: g.multiple, sous_jacent: g.sousJacent } : null, v0, base0: base, base_inconnue: inconnu && taxable, ter_pct: ter,
        frais_env_pct: fenv, dispo: DISPO.includes(g.type), info: g.info, lignes: g.lignes.map(p => p.id), synthetique: false };
      comps.push(c);
    });
    /* base fiscale de l'enveloppe : versements cumulés connus (assurance-vie, PER, PEA, épargne salariale) répartis selon la valeur */
    const parEnv = new Map();
    comps.forEach(c => { if (!parEnv.has(c.cle)) parEnv.set(c.cle, []); parEnv.get(c.cle).push(c); });
    parEnv.forEach((cs, cle) => {
      const vc = cs[0].info && cs[0].info.versements_cumules;
      if (cle && AVEC_VC.includes(cs[0].type) && O.estNombre(vc)) {
        const tot = sum(cs, c => c.v0);
        cs.forEach(c => { c.base0 = tot > 0 ? +vc * c.v0 / tot : +vc / cs.length; c.base_inconnue = false; });
      }
    });
    /* compte courant du périmètre, créé à 0 s'il n'existe pas */
    if (!comps.some(c => c.type === "courant")) {
      comps.push({ id: "c" + comps.length, enveloppe: "Compte courant (créé à 0)", cle: "", titulaire: sc === "foyer" ? "commun" : sc, owner: sc === "foyer" ? "commun" : sc,
        type: "courant", classe: "courant", levier: null, v0: 0, base0: 0, base_inconnue: false, ter_pct: 0, frais_env_pct: 0, dispo: true, info: {}, lignes: [], synthetique: true });
    }
    /* règles fiscales de chaque compartiment */
    const couple = objet(objet(d.profil).foyer).union === "joint" && O.n0(objet(objet(d.profil).foyer).adultes) >= 2 && sc === "foyer";
    comps.forEach(c => {
      const jal = cal.jalons.filter(j => j.enveloppe === c.cle);
      const dates = { pea_5_ans: null, av_8_ans: null, pee_disponible: null };
      const j1 = jal.find(j => j.cle === "pea_5_ans"), j2 = jal.find(j => j.cle === "av_8_ans");
      if (j1) dates.pea_5_ans = j1.date;
      if (j2) dates.av_8_ans = j2.date;
      const pee = jal.filter(j => j.cle === "pee_disponible").map(j => j.date).sort();
      if (pee.length) dates.pee_disponible = pee[pee.length - 1];
      c.dates = dates;
      c.pee_disponible = c.type === "pee" ? (!!dates.pee_disponible && dates.pee_disponible <= today) : undefined;
      const primes = sum(comps.filter(x => x.titulaire === c.titulaire && F.AV.includes(x.type)), x => x.base0);
      c.fiscal = { type: c.type, valeur: c.v0, base: c.base0, base_inconnue: c.base_inconnue, classe: c.classe, date_ouverture: c.info && c.info.date_ouverture,
        versements_deduits: c.info && O.estNombre(c.info.versements_deduits) ? +c.info.versements_deduits : (c.info && O.estNombre(c.info.versements_cumules) ? +c.info.versements_cumules : undefined), dates };
      c.prep = F.preparer(c.fiscal, { reperes: ctx.R, couple, primes_titulaire: primes, tmi_pct: ctx.reglages.tmi_pct, per_versements_deduits: ctx.reglages.per_versements_deduits });
      if (["pea", "pea_pme", "pea_jeune", "assurance_vie", "capitalisation"].includes(c.type) && !c.prep.seuil && !manques.date_ouverture.includes(c.enveloppe)) manques.date_ouverture.push(c.enveloppe);
      if (c.base_inconnue && !manques.prix_revient.includes(c.enveloppe)) manques.prix_revient.push(c.enveloppe);
      if (c.type == null && !manques.type.includes(c.enveloppe)) manques.type.push(c.enveloppe);
    });
    comps.forEach(c => { if (c.type == null) c.type = "autre"; });
    const idxCourant = comps.findIndex(c => c.type === "courant");
    return { comps, idxCourant, manques, calendrier: cal, couple };
  }

  /** Sépare les compartiments dont la règle fiscale de sortie est indisponible (repère manquant, type inconnu) : leur impôt n'est jamais compté à zéro en silence.
      → { gardes, exclus: [{ enveloppe, type, valeur, manquants, mentions }] } ; les repères manquants sont consignés dans le contexte. */
  function ecarterIndisponibles(comps, ctx) {
    const gardes = [], exclus = [];
    comps.forEach(c => {
      if (c.v0 > 0 && !c.dispo && c.prep.indisponible) {
        const manquants = [...c.prep.reperes.manquants];
        manquants.forEach(k => ctx.manquant(k, "impôt de sortie de « " + c.enveloppe + " »"));
        exclus.push({ enveloppe: c.enveloppe, type: c.type, valeur: c.v0, manquants, mentions: c.prep.mentions.slice() });
      } else gardes.push(c);
    });
    return { gardes, exclus };
  }

  /* ------------------------------------------------------------------ crédits en cours (spec § 6.4) */
  /** Crédits du périmètre : [{ cle ("credit:<id>" / "bien:<id>"), id, nom, part, mensualite, crd, taux_pct, n (mensualités restantes), fin (date), mentions, taux_suppose }]. */
  function creditsExistants(ctx) {
    const d = ctx.d, sc = ctx.perimetre, today = ctx.today, prets = objet(objet(d.config).prets_infos), out = [];
    const creds = liste(d.credits).length || !objet(d.profil).credits ? liste(d.credits) : liste(objet(d.profil).credits);
    const biens = liste(d.biens).length || !objet(d.profil).biens ? liste(d.biens) : liste(objet(d.profil).biens);
    const tauxMoyen = ctx.rv("taux_credit_immo_20");
    const ajoute = (genre, x, part) => {
      if (!(part > 0)) return;
      const M = Math.max(0, O.n0(x.mensualite)), crd = Math.max(0, O.n0(x.crd));
      if (!(M > 0) && !(crd > 0)) return;
      const cle = genre + ":" + x.id, info = objet(prets[cle]), mentions = [];
      let taux = O.estNombre(info.taux_pct) ? +info.taux_pct : null, n = null, fin = O.estDate(info.date_fin) ? info.date_fin : null, suppose = false;
      const tauxDit = taux != null;
      if (fin) { n = 0; while (O.ajouterMois(today, n + 1) <= fin) n++; }
      /* Part d'assurance de la mensualité (spec § 6.4) : la mensualité de `credits` est assurance comprise ; l'amortissement du capital se fait sur le reste.
         assurance_taux_pct (par an, sur le capital initial) connu : capital initial = mensualité ÷ (annuité sur la durée totale + taux d'assurance / 12) quand
         le taux et la durée totale (duree_mois) sont connus, sinon le capital restant dû d'aujourd'hui (convention dite). Inconnu : aucune séparation, dite. */
      const a = O.estNombre(info.assurance_taux_pct) && +info.assurance_taux_pct >= 0 ? +info.assurance_taux_pct : null;
      let ass = 0, assMethode = "inconnue", capitalInitial = null;
      if (M > 0 && a === 0) assMethode = "aucune";
      else if (M > 0 && a > 0) {
        const D = Number.isInteger(+info.duree_mois) && +info.duree_mois > 0 ? +info.duree_mois : null;
        let c0, exacte = false;
        if (tauxDit && D != null) { c0 = M / (C.echeance(1, taux, D) + a / 100 / 12); exacte = true; }
        else c0 = crd;
        ass = c0 * (a / 100) / 12;
        if (exacte) capitalInitial = c0;
        if (!(ass > 0) || ass >= M) { ass = 0; capitalInitial = null; assMethode = "inconnue"; mentions.push("assurance du crédit non séparable de la mensualité (taux d'assurance incohérent avec elle) : mensualité supposée assurance comprise, capital remboursé un peu surestimé"); }
        else if (exacte) assMethode = "capital_initial";
        else { assMethode = "capital_restant_du"; mentions.push("assurance du crédit estimée sur le capital restant dû (capital initial inconnu : taux ou durée totale à compléter)"); }
      } else if (M > 0) mentions.push("assurance du crédit inconnue : mensualité supposée assurance comprise sans séparation, capital remboursé un peu surestimé");
      const Mp = Math.max(0, M - ass); /* part qui rembourse le capital et les intérêts */
      if (!(M > 0)) { mentions.push("mensualité inconnue : le capital restant dû est maintenu"); }
      else if (taux != null && n == null) { n = C.dureeRestante(crd, Mp, taux); if (n == null) { mentions.push("la mensualité ne couvre pas les intérêts"); n = 0; } }
      else if (taux == null && n != null) { taux = n > 0 ? C.tauxDeduit(crd, Mp, n) : 0; if (taux == null) { taux = 0; mentions.push("taux du crédit non déductible des données"); } else mentions.push("taux du crédit déduit de la fin et de la mensualité"); }
      else if (taux == null && n == null) {
        if (tauxMoyen === undefined) { ctx.manquant("taux_credit_immo_20", "taux supposé d'un crédit"); taux = 0; } else taux = tauxMoyen;
        suppose = true; n = C.dureeRestante(crd, Mp, taux) || 0;
        mentions.push("taux du crédit supposé, à compléter");
      }
      out.push({ cle, id: x.id, nom: String(x.nom || (genre === "bien" ? "Bien" : "Crédit")), genre, part, mensualite: M, assurance_mensuelle: ass, mensualite_hors_assurance: Mp, assurance_methode: assMethode, capital_initial: capitalInitial,
        crd, taux_pct: taux, n: n == null ? 0 : n, fin, taux_suppose: suppose, mentions });
    };
    biens.forEach(b => { if (b) ajoute("bien", b, Calc.part(sc, b.part_p1)); });
    creds.forEach(c => { if (c) ajoute("credit", c, Calc.partCredit(sc, c.owner)); });
    return out;
  }

  /** Historique compact pour le rétro-contrôle (spec § 6.9) : { points: [{ date, byBloc, net }], flux: [{ date, montant }] }.
      snapshots : photos du patrimoine financier avec leur composition, forme de l'app ({ date, foyer, byBloc }) ou ligne SQL ({ date, total, by_bloc }), by_bloc par personne
      (production) ou à plat : les poches du foyer sont lues par Calc.blocsPhoto ;
      on garde la dernière photo de chaque mois (les dates de départ sont des fins de mois ; les photos de la nuit se chevauchent). tx : transactions
      (forme de l'app ou ligne SQL) ; seuls les versements, versements programmés (entrées) et retraits (sorties) franchissent la frontière du portefeuille,
      un achat ou une vente reste interne (flux = montant du mouvement ; sans montant, le mouvement est ignoré). */
  function historiquePourRetro(snapshots, tx) {
    const parMois = new Map();
    liste(snapshots).forEach(r => {
      const date = r && String(r.date || "").slice(0, 10), byBloc = Calc.blocsPhoto(r, "foyer");
      if (!O.estDate(date) || !byBloc || !Object.keys(byBloc).length) return;
      const net = Number.isFinite(+(r.foyer != null ? r.foyer : r.total)) ? +(r.foyer != null ? r.foyer : r.total) : sum(Object.values(byBloc), x => x);
      const k = date.slice(0, 7), cur = parMois.get(k);
      if (!cur || cur.date < date) parMois.set(k, { date, byBloc, net });
    });
    const points = [...parMois.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    const flux = [];
    liste(tx).forEach(r => {
      const date = r && String(r.date || "").slice(0, 10), type = r && String(r.type || ""), m = r && +r.amount;
      if (!O.estDate(date) || !Number.isFinite(m) || !m) return;
      if (type === "versement" || type === "programme") flux.push({ date, montant: Math.abs(m) });
      else if (type === "retrait") flux.push({ date, montant: -Math.abs(m) });
    });
    flux.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { points, flux };
  }

  /** Entrée du moteur depuis l'état S du store (positions, config, profil, budget, banque, objectifs, foyer, repères, indices) ; today = AAAA-MM-JJ (jour de Paris). */
  function depuisEtat(S, today) {
    const s = objet(S), pr = objet(s.profil);
    return { today, positions: liste(s.positions), instruments: [], config: objet(s.config), profil: pr, credits: liste(pr.credits), biens: liste(pr.biens), budget: s.budget || { lignes: [] },
      banque: s.banque || null, historique: s.historique || null, objectifs: liste(s.objectifs), foyer: { evenements: liste(objet(s.foyer).evenements), variantes: liste(objet(s.foyer).variantes) },
      reperes: liste(objet(s.savoir).reperes), indices: liste(s.indices), classes: objet(s.classes), historique: historiquePourRetro(s.snapshots, s.tx) };
  }

  return { ecarterIndisponibles, depuisEtat, historiquePourRetro, CLASSES_TIREES, IDX, correlationTirees, matriceTirees, choleskyTirees, contexte, ciblesAllocation, parametresClasse, capaciteDeBase, construireCompartiments,
    creditsExistants, DISPO, TYPES_ENVELOPPE, personnesDe, objet, liste, sum };
});
