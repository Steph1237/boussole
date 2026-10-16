/* Moteur de projection de Boussole (PROJ, docs/superpowers/specs/2026-10-14-proj-projection-design.md) : flux du foyer mois par mois,
   Monte-Carlo à graine fixe et tirages communs, crises rejouées, euros constants, toujours net de frais, net d'impôts en option,
   événements de vie, capacité d'emprunt. Un seul moteur pour l'app et le Copilote (copie générée dans le connecteur : npm run gen).
   Pur, sans DOM, au tutoiement. Global Projection. Une projection n'est pas une promesse.

   Découpage : projection-outils (dates, générateur, centiles), projection-fiscalite (impôts de sortie, ordre de retrait),
   projection-evenements (catalogue et validation), projection-credit (amortissement, code de la Toise), projection-donnees (repères,
   compartiments, capacité de base, crédits), projection-immo (capacité d'emprunt) ; ce fichier assemble : préparation, simulation,
   crises, comparaison, garde-fous, rétro-contrôle.

   Contrat : Projection.preparer(data, options) → modele ; Projection.simuler(modele, { chemins, graine, volatilite }) → resultat ;
   Projection.crise(modele, { cle, debut }) ; Projection.comparer(modeleA, modeleB, opts) ; spec § 3.
   data = { today, positions, instruments, config, profil, credits, biens, budget, banque, objectifs, foyer: { evenements, variantes },
   reperes, indices, classes?, calendrier? } (formes de l'app). Un repère manquant rend la règle indisponible : jamais de valeur de secours. */
(function (root, factory) {
  const noeud = typeof module === "object" && module.exports;
  const dep = (global, chemin) => (noeud ? require(chemin) : root[global]);
  const api = factory({
    O: dep("ProjectionOutils", "./projection-outils.js"), F: dep("ProjectionFiscalite", "./projection-fiscalite.js"),
    E: dep("ProjectionEvenements", "./projection-evenements.js"), C: dep("ProjectionCredit", "./projection-credit.js"),
    Dn: dep("ProjectionDonnees", "./projection-donnees.js"),
    /* projection-immo est chargé après ce fichier dans l'app : résolu à l'usage */ get Immo() { return dep("ProjectionImmo", "./projection-immo.js"); },
    Marche: dep("Marche", "./marche.js"), Calc: dep("Calc", "./calc.js"), Plan: dep("Plan", "./plan.js"), Calendrier: dep("Calendrier", "./calendrier.js"),
  });
  if (noeud) module.exports = api;
  else root.Projection = api;
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";
  const { O, F, E, C, Dn, Marche, Calc, Plan, Calendrier } = D;

  const GRAINE = 20261014;
  /** BUD1 (spec § 10) : probabilité visée d'un objectif (8 chances sur 10), pas de la recherche (€/mois), plafond de l'épargne en plus (€/mois), nombre de simulations. */
  const SEUIL_OBJECTIF = 0.8, PAS_EPARGNE = 25, EPARGNE_MAX = 10000, SIMULATIONS_MAX = 16, CHEMINS_EPARGNE = 500, ID_VARIANTE_EPARGNE = "_epargne_necessaire";
  /** Incrémentée à chaque changement de calcul ; rendue avec chaque résultat (rejouer une projection passée). */
  const versionModele = "proj-1.2.0";
  const CLASSES_TIREES = Dn.CLASSES_TIREES, NB_TIRAGES = CLASSES_TIREES.length, IDX = Dn.IDX;
  const PERCENTILES = { p10: 0.1, p25: 0.25, p50: 0.5, p75: 0.75, p90: 0.9 };
  const NOMS_P = Object.keys(PERCENTILES);
  const VUES = ["net", "financier", "disponible"];
  const objet = Dn.objet, liste = Dn.liste, sum = Dn.sum;
  const frc = O.frc, eur = O.eur, eurS = O.eurSigne;
  const minuscule1 = s => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

  /** Repères lus par le moteur (test : chacun existe dans une migration ; sinon le moteur marque la règle indisponible, jamais de valeur de secours). */
  const HYPOTHESES = {
    reperes: ["inflation_hypothese", "salaire_croissance_reelle", "uc_adulte_supplementaire", "uc_enfant_moins_14", "uc_age_seuil", "enfant_fin_charge_age",
      "creche_psu_taux_1_enfant", "creche_psu_taux_2_enfants", "creche_psu_taux_3_enfants", "creche_psu_taux_4_7_enfants", "creche_psu_taux_8_enfants",
      "creche_psu_plancher", "creche_psu_plafond", "creche_heures_mois", "ecole_obligatoire_age", "prepare_taux_plein", "prepare_mi_temps",
      "prepare_temps_partiel", "prepare_duree_premier_enfant_mois", "qf_plafond_demi_part", "ir_taux_forfaitaire", "av_taux_ir_reduit", "ps_taux_general",
      "ps_taux_av_epargne_logement", "ps_taux_actifs_numeriques", "ps_taux_epargne_salariale", "pv_immo_ir_taux", "pv_immo_ps_taux", "pv_immo_surtaxe_seuil",
      "ps_taux_foncier", "taux_credit_immo_15", "taux_credit_immo_20", "taux_credit_immo_25", "taux_usure_moins_10", "taux_usure_10_20", "taux_usure_20_plus",
      "hcsf_taux_effort", "hcsf_duree_max", "hcsf_duree_max_differe", "hcsf_travaux_seuil_pct", "revenus_locatifs_ponderation", "frais_acquisition_ancien_pct",
      "frais_acquisition_primo_pct", "frais_acquisition_neuf_pct", "garantie_pct", "frais_dossier", "assurance_emprunteur_defaut_pct", "immo_revalorisation_reelle",
      "immo_volatilite", "estr_taux", "nasdaq100_volatilite", "scpi_taux_distribution", "inflation_fr_1973", "inflation_fr_1974", "livret_a_taux", "lep_taux",
      "pea_duree_ans", "pea_plafond", "av_duree_ans", "av_seuil_versements", "av_abattement_seul", "av_abattement_couple", "pel_exoneration_ir_ans",
      "garde_fou_croissance_annuelle", "garde_fou_ecart_capacite", "garde_fou_rendement_marge", "retro_min_origines"]
      .concat(Marche.CLES.filter(k => k !== "levier").map(k => "rendement_central_" + k)),
    manquants_assumes: [],
  };
  const EVENEMENTS = E.ENTREES;

  /* ================================================================== préparation */
  /** Prépare le modèle d'une entrée : compartiments, flux du foyer, événements, crédits, objectifs. Pur et déterministe ; l'entrée n'est pas modifiée.
      options : { horizon_ans (10), perimetre, vue, euros, net_impots, variante, hypotheses_classes?, capacite_mensuelle?, reste_capacite?, base_capacite? }. */
  function preparer(data, options) {
    const o = options || {}, d = data || {};
    const ctx = Dn.contexte(d, { perimetre: o.perimetre || "foyer", variante: o.variante || null, hypotheses_classes: o.hypotheses_classes, capacite_mensuelle: o.capacite_mensuelle,
      reste_capacite: o.reste_capacite, base_capacite: o.base_capacite, reequilibrage: o.reequilibrage });
    const today = ctx.today, sc = ctx.perimetre, rv = ctx.rv, pi = ctx.pi, rg = ctx.reglages;
    /* repères propres à la projection : lus et, s'ils manquent, déclarés ici (et non par la capacité d'emprunt) */
    rv("inflation_hypothese"); rv("salaire_croissance_reelle");
    if (ctx.inflationManquante) ctx.manquant("inflation_hypothese", "inflation : la projection est faite en euros courants");
    if (ctx.salaireManquant) ctx.manquant("salaire_croissance_reelle", "hausse réelle des salaires : supposée nulle");
    const horizon = o.horizon_ans > 0 ? Math.round(+o.horizon_ans) : 10, N = 12 * horizon;
    const avertissements = [];
    const dates = new Array(N + 2);
    for (let t = 0; t <= N + 1; t++) dates[t] = O.ajouterMois(today, t);
    const infl = new Float64Array(N + 2);
    for (let t = 0; t <= N + 1; t++) infl[t] = Math.pow(1 + pi, t / 12);
    const M = { version_modele: versionModele, ctx, reglages: rg, data: d, options: { horizon_ans: horizon, perimetre: sc, vue: o.vue || "net", euros: o.euros || "constants",
      net_impots: !!o.net_impots, variante: o.variante || null }, today, N, horizon, pi, dates, infl, avertissements, jalons: [], composants: [], persons: Dn.personnesDe(sc) };

    /* ---- événements retenus (situation actuelle + variante) ---- */
    const evAll = liste(objet(d.foyer).evenements).filter(e => e && typeof e === "object");
    const vId = e => (e.variante_id !== undefined ? e.variante_id : e.varianteId) || null;
    const retire = ctx.variante ? liste(ctx.variante.retire) : [];
    let evts = evAll.filter(e => (!vId(e) && !retire.includes(e.id)) || (ctx.variante && vId(e) === ctx.variante.id));
    const credList = liste(d.credits).length || !objet(d.profil).credits ? liste(d.credits) : liste(objet(d.profil).credits);
    const bienList = liste(d.biens).length || !objet(d.profil).biens ? liste(d.biens) : liste(objet(d.profil).biens);
    evts = evts.filter(e => {
      const msg = E.validerEvenement(e, { today, credits: credList, biens: bienList });
      if (msg) { avertissements.push("événement ignoré (« " + (e.libelle || e.type) + " ») : " + msg); return false; }
      return true;
    });
    evts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    M.evenements = evts;
    M.evenements_pris_en_compte = [];

    /* ---- compartiments ---- */
    const cc = Dn.construireCompartiments(ctx);
    const comps = cc.comps;
    M.calendrier = cc.calendrier;
    M.manques = cc.manques;
    M.idxCourant = cc.idxCourant;
    const pcCache = {};
    const pc = k => (pcCache[k] || (pcCache[k] = Dn.parametresClasse(k, ctx)));
    const estrPct = rv("estr_taux");
    const livretTaux = { livret_a: "livret_a_taux", ldds: "livret_a_taux", lep: "lep_taux" };
    const centralCtx = Object.assign({}, ctx, { hypClasses: {}, manquant: () => {} });
    const pcCentral = k => Dn.parametresClasse(k, centralCtx);
    /* lecture sans trace : les classes que le foyer ne détient pas ne sont pas ajoutées aux repères « utilisés » */
    const lectureCtx = Object.assign({}, ctx, { manquant: () => {}, rv: cle => { const r = ctx.R[cle]; return r ? +r.valeur : undefined; } });
    const pcLecture = k => Dn.parametresClasse(k, lectureCtx);
    const finaliser = c => {
      c.feeAnn = (O.n0(c.ter_pct) + O.n0(c.frais_env_pct)) / 100;
      c.feeM = Math.pow(1 - c.feeAnn, 1 / 12);
      c.attendu_net_pct = ((1 + c.attendu_pct / 100) * (1 - c.feeAnn) - 1) * 100;
    };
    comps.forEach(c => {
      c.kz = -1; c.a = 0; c.s = 0; c.aSerie = null; c.attendu_pct = 0;
      if (c.type === "courant") { /* 0 % : un compte courant n'est pas rémunéré */ }
      else if (livretTaux[c.type]) {
        const r = ctx.R[livretTaux[c.type]], central = pc("monetaire");
        const ac = Math.log(1 + central.rendement / 100) / 12;
        if (!r) { ctx.manquant(livretTaux[c.type], "taux réglementé : le rendement central du monétaire est pris"); c.a = ac; c.attendu_pct = central.rendement; }
        else {
          rv(livretTaux[c.type]);
          const ar = Math.log(1 + +r.valeur / 100) / 12, fin = r.dateFin;
          c.aSerie = new Float64Array(N + 2);
          for (let t = 0; t <= N + 1; t++) c.aSerie[t] = !fin || dates[t] <= fin ? ar : ac;
          c.a = ar; c.attendu_pct = +r.valeur;
        }
      } else if (c.classe === "levier") {
        const u = c.levier.sous_jacent, pu = pc(u), L = c.levier.multiple;
        const mu = Math.log(1 + pu.rendement / 100) / 12, sig = pu.volatilite / 100;
        let rfin = 0;
        if (estrPct === undefined) ctx.manquant("estr_taux", "coût de financement du levier non pris en compte : la perte due au levier est sous-estimée"); else rfin = estrPct / 100;
        c.a = L * mu - (L - 1) * rfin / 12 - L * (L - 1) * sig * sig / 24;
        c.s = L * sig / Math.sqrt(12);
        c.kz = IDX[u];
        const pcu = pcCentral(u), muC = Math.log(1 + pcu.rendement / 100) / 12, sigC = pcu.volatilite / 100;
        c.attendu_pct = (Math.exp(12 * (L * muC - (L - 1) * rfin / 12 - L * (L - 1) * sigC * sigC / 24)) - 1) * 100;
      } else {
        const p = pc(c.classe);
        c.a = Math.log(1 + p.rendement / 100) / 12;
        c.s = p.volatilite / 100 / Math.sqrt(12);
        c.kz = IDX[c.classe] != null ? IDX[c.classe] : -1;
        c.attendu_pct = pcCentral(c.classe).rendement;
      }
      finaliser(c);
    });
    M.hypotheses_modifiees = Object.keys(ctx.hypClasses).length > 0;

    /* ---- biens existants ---- */
    const bienPart = b => Calc.part(sc, b.part_p1);
    M.bien0 = sum(bienList, b => O.n0(b.valeur) * bienPart(b));
    /* biens d'usage et d'entreprise du profil : comptés dans le net, à valeur constante en euros d'aujourd'hui (aucune hypothèse de rendement ni de dépréciation) */
    { const au = Calc.autresActifs(d.profil, sc); M.autres0 = au.usage + au.entreprise; }
    const pb = Dn.parametresClasse("immobilier_physique", ctx);
    M.bienRend = { a: Math.log(1 + pb.rendement / 100) / 12, s: pb.volatilite / 100 / Math.sqrt(12), kz: IDX.immobilier_physique };
    M.biensTaxables = [];
    bienList.forEach(b => {
      if (!b || b.usage === "rp" || b.usage === "residence_principale" || !(O.n0(b.valeur) > 0)) return;
      const inf = objet(rg.biens["bien:" + b.id]);
      M.biensTaxables.push({ id: b.id, nom: b.nom, valeur0: O.n0(b.valeur) * bienPart(b), prix_achat: O.estNombre(inf.prix_achat) ? +inf.prix_achat * bienPart(b) : null, date_achat: inf.date_achat || null });
    });

    /* ---- crédits en cours ---- */
    const credits = Dn.creditsExistants(ctx);
    M.credits = credits;
    M.mensExist = new Float64Array(N + 2);
    M.detteExist = new Float64Array(N + 2);
    M.dette0 = 0;
    M.mens0 = 0;
    const fcr = {};
    evts.filter(e => e.type === "fin_credit").forEach(e => { fcr[e.params.credit] = e; });
    credits.forEach(c => {
      const fe = fcr[c.cle];
      let n = c.n;
      if (fe && fe.params.date_fin && O.estDate(fe.params.date_fin)) { n = 0; while (O.ajouterMois(today, n + 1) <= fe.params.date_fin) n++; }
      c.n = n; c.fin_date = n > 0 ? O.ajouterMois(today, n) : null;
      c.part_reaffectee = fe && O.estNombre(fe.params.part_reaffectee_epargne_pct) ? +fe.params.part_reaffectee_epargne_pct : rg.part_reaffectee_epargne_pct;
      c.fin_credit_evenement = fe ? fe.id : null;
      const i = (c.taux_pct || 0) / 100 / 12, part = c.part;
      M.dette0 += c.crd * part;
      M.detteExist[0] += c.crd * part;
      let crd = c.crd;
      for (let t = 1; t <= N + 1; t++) {
        if (t <= n && c.mensualite > 0) {
          M.mensExist[t] += c.mensualite * part;
          crd = t === n ? 0 : Math.max(0, crd * (1 + i) - c.mensualite_hors_assurance); /* l'assurance ne rembourse pas le capital */
        } else if (c.mensualite > 0 && t > n) crd = 0;
        M.detteExist[t] += crd * part;
      }
      if (n >= 1) M.mens0 += c.mensualite * part;
      c.mentions.forEach(m => avertissements.push(c.nom + " : " + m));
    });

    M.mensExist[0] = M.mens0;
    /* ---- capacité de départ ---- */
    const cb = Dn.capaciteDeBase(d, { perimetre: sc, base_capacite: o.base_capacite, capacite_mensuelle: o.capacite_mensuelle });
    M.capacite_base = cb;
    cb.mentions.forEach(m => avertissements.push(m));
    M.depenses0 = cb.source === "reel" && cb.constatee_detail ? Math.max(0, cb.constatee_detail.depenses - M.mens0) : cb.depenses_prevues;
    M.reelBase = cb.retenue + M.mens0 + rg.epargne_delta_mensuel;
    M.reelDelta = new Float64Array(N + 2);
    M.nomDelta = new Float64Array(N + 2);

    /* ---- composants de capacité : une marche = un composant (id, fenêtre, effet, raison) ---- */
    const mois = dt => O.moisDe(today, dt, N + 1);
    const addComposant = c => {
      c.t1 = Math.min(c.t1 == null ? N + 1 : c.t1, N + 1);
      if (c.t0 == null || c.t0 > N || c.t1 <= c.t0) return;
      for (let t = c.t0; t < c.t1; t++) {
        if (c.reel) M.reelDelta[t] += typeof c.reel === "function" ? c.reel(t) : c.reel;
        if (c.nom) M.nomDelta[t] += typeof c.nom === "function" ? c.nom(t) : c.nom;
      }
      M.composants.push(c);
    };
    M.addComposant = addComposant;
    const facteur = e => {
      const p = ["changement_emploi", "conge_parental", "hausse_revenu"].includes(e.type) ? (e.params.personne || e.personne) : e.personne;
      if (sc === "foyer" || p === sc) return 1;
      return p === "foyer" ? 0.5 : 0;
    };
    const pers = objet(objet(d.profil).personnes);
    const salaireProfil = k => Calc.salaireNetMensuel(pers[k]);
    const emplois = evts.filter(e => e.type === "changement_emploi"), hausses = evts.filter(e => e.type === "hausse_revenu"), conges = evts.filter(e => e.type === "conge_parental");
    const personneDe = e => e.params.personne || e.personne;
    const quotiteConge = e => (O.estNombre(e.params.quotite_pct) ? +e.params.quotite_pct : e.params.activite === "arret" ? 0 : e.params.activite === "mi_temps" ? 50 : 80);
    /** Salaire net mensuel (€ d'aujourd'hui) d'une personne à une date, hors congé : profil, changements d'emploi, variations de revenu. */
    function salaireSansConge(k, date, sauf) {
      let s = salaireProfil(k);
      emplois.filter(e => e.id !== sauf && personneDe(e) === k && e.date <= date && (!e.fin || date < e.fin)).forEach(e => { s = O.n0(e.params.salaire_net_mensuel); });
      hausses.filter(e => e.id !== sauf && personneDe(e) === k && e.date <= date && (!e.fin || date < e.fin)).forEach(e => {
        s += O.estNombre(e.params.delta_mensuel) ? +e.params.delta_mensuel : s * O.n0(e.params.delta_pct) / 100;
      });
      return Math.max(0, s);
    }
    function salaireEn(k, date) {
      let s = salaireSansConge(k, date);
      conges.filter(e => personneDe(e) === k && e.date <= date && date < e.fin).forEach(() => { /* une seule quotité à la fois */ });
      const c = conges.find(e => personneDe(e) === k && e.date <= date && date < e.fin);
      if (c) s *= quotiteConge(c) / 100;
      return s;
    }
    M.salaireEn = salaireEn;
    const totauxFoyer = Plan.budgetTotaux(d.budget && d.budget.lignes || [], d.profil, "foyer");
    const autresRevenusFoyer = totauxFoyer.revenus - sum(["p1", "p2"], salaireProfil);
    /** Ressources mensuelles du foyer à une date (€ d'aujourd'hui), pour le barème de la crèche. */
    const ressourcesEn = date => autresRevenusFoyer + sum(["p1", "p2"], k => salaireEn(k, date));
    const fy = objet(objet(d.profil).foyer);
    const ucAdulte = rv("uc_adulte_supplementaire"), ucEnfant = rv("uc_enfant_moins_14"), ucSeuil = rv("uc_age_seuil");
    const adultes = Math.max(1, O.n0(fy.adultes) || 1), enf = O.n0(fy.enfants), enf14 = Math.min(enf, O.n0(fy.enfants14));
    const ucAujourdhui = ucAdulte !== undefined && ucEnfant !== undefined ? 1 + ucAdulte * (adultes - 1) + ucAdulte * enf14 + ucEnfant * (enf - enf14) : null;
    /* le coût d'un enfant se calcule sur les dépenses du FOYER : la part de la personne vient du facteur de l'événement (0,5 pour un événement du foyer) ;
       partir de la part d'une personne comptait la moitié deux fois */
    let depensesFoyer0 = M.depenses0;
    if (sc !== "foyer") {
      const cbF = Dn.capaciteDeBase(d, { perimetre: "foyer", base_capacite: o.base_capacite });
      depensesFoyer0 = cbF.source === "reel" && cbF.constatee_detail ? Math.max(0, cbF.constatee_detail.depenses - Calc.mensualites(d.profil, "foyer")) : cbF.depenses_prevues;
    }
    const depParUC = ucAujourdhui ? depensesFoyer0 / ucAujourdhui : null;
    const naissances = evts.filter(e => e.type === "naissance");
    const jalon = (e, titre, icone, texte, montants, extra) => M.jalons.push(Object.assign({ id: "ev:" + e.id, date: e.date, type: e.type, titre, icone, effet: { texte, montants: montants || {} }, source: "evenement", evenement_id: e.id }, extra || {}));
    const nomEv = e => minuscule1(e.libelle);
    const pris = e => { if (!M.evenements_pris_en_compte.includes(e.libelle)) M.evenements_pris_en_compte.push(e.libelle); };

    evts.forEach(e => {
      const f = facteur(e);
      if (f === 0 || e.type === "fin_credit" || e.type === "crise" || e.type === "achat_immobilier" || e.type === "retrait") return;
      const p = e.params, t0 = mois(e.date), tFin = e.fin ? mois(e.fin) : null;
      pris(e);
      if (e.type === "naissance") {
        const montant = p.cout_mode === "montant";
        if (!montant && depParUC == null) { avertissements.push("coût de l'enfant non estimé (repères des unités de consommation manquants)"); jalon(e, e.libelle, "enfant", "coût non estimé", {}); return; }
        if (!montant && !(depensesFoyer0 > 0)) avertissements.push("dépenses courantes inconnues : le coût de « " + p.enfant + " » n'est pas estimé");
        const finAge = O.estNombre(p.fin_age) ? +p.fin_age : rv("enfant_fin_charge_age");
        if (finAge === undefined) { avertissements.push("âge de fin de charge manquant : coût de « " + p.enfant + " » non estimé"); return; }
        const seuil = ucSeuil !== undefined ? ucSeuil : 14;
        const coefAt = ag => (ag < seuil ? ucEnfant : ucAdulte);
        const cout = date => {
          if (date < e.date) return 0;
          const ag = O.age(e.date, date);
          if (ag >= finAge) return 0;
          return montant ? O.n0(p.cout_mensuel) : coefAt(ag) * depParUC;
        };
        const deja = e.date <= today ? cout(today) : 0;
        const phases = [];
        let run = null;
        const cl = () => { if (run && Math.abs(run.v) > 1e-9) { phases.push(run); addComposant({ id: e.id + ":" + run.t0, evenement_id: e.id, type: "naissance", libelle: e.libelle, t0: run.t0, t1: run.t1, reel: -run.v * f, raison: run.raison, raisonFin: null }); } run = null; };
        for (let t = 1; t <= N; t++) {
          const v = cout(dates[t]) - deja;
          if (run && Math.abs(run.v - v) < 1e-9) { run.t1 = t + 1; continue; }
          cl();
          const ag = O.age(e.date, dates[t]);
          const corps = montant ? "" : frc(coefAt(ag), 1) + " UC × " + eur(depParUC) + " = ";
          run = { t0: t, t1: t + 1, v, ag, raison: (p.enfant || e.libelle) + " : " + corps + "−" + eur(Math.abs(v) * f) + "/mois" + (e.date <= today && ag >= seuil && v !== 0 ? " (passage à " + seuil + " ans)" : "") };
        }
        cl();
        const dejaNe = e.date <= today;
        const txt = phases.map((r, k) => (r.v > 0 ? "−" : "+") + eur(Math.abs(r.v * f)) + "/mois" + (k > 0 || dejaNe ? " à partir de " + (r.ag >= seuil && r.ag < finAge ? seuil : r.ag) + " ans" : "")).join(", ");
        jalon(e, e.libelle, "enfant", txt || "déjà compris dans tes dépenses d'aujourd'hui", { mensuel: phases.length ? -phases[0].v * f : 0, mensuel_14_ans: phases[1] ? -phases[1].v * f : null },
          { quotient_familial: "non modélisé : une demi-part de plus réduit l'impôt d'au plus " + (rv("qf_plafond_demi_part") !== undefined ? eur(rv("qf_plafond_demi_part")) : "un plafond") + " par an" });
        return;
      }
      if (e.type === "creche") {
        if (t0 == null) return;
        const mode = p.mode || "psu";
        let cout = null, raison = "", mention = null;
        if (mode === "psu") {
          const dateDebut = dates[t0], nb = Math.max(1, enf + naissances.filter(n => n.date <= dateDebut).length);
          const cleT = nb >= 8 ? "creche_psu_taux_8_enfants" : nb >= 4 ? "creche_psu_taux_4_7_enfants" : nb === 3 ? "creche_psu_taux_3_enfants" : nb === 2 ? "creche_psu_taux_2_enfants" : "creche_psu_taux_1_enfant";
          const tx = rv(cleT), plancher = rv("creche_psu_plancher"), plafond = rv("creche_psu_plafond"), heures = O.estNombre(p.heures_mois) ? +p.heures_mois : rv("creche_heures_mois");
          if (tx === undefined || plancher === undefined || plafond === undefined || heures === undefined) { avertissements.push("barème de la crèche indisponible (repère manquant) : « " + e.libelle + " » non chiffrée"); jalon(e, e.libelle, "enfant", "coût non chiffré (barème indisponible)", {}); return; }
          const res = O.estNombre(p.ressources_mensuelles) ? +p.ressources_mensuelles : ressourcesEn(dateDebut);
          const bornees = Math.min(plafond, Math.max(plancher, res));
          cout = tx / 100 * bornees * heures;
          raison = "crèche (PSU) : " + frc(tx, 4) + " % × " + eur(bornees) + " × " + frc(heures) + " h = −" + eur(cout, 2) + "/mois";
        } else if (mode === "assistante_maternelle") {
          cout = O.n0(p.cout_mensuel) - O.n0(p.cmg_mensuel);
          raison = "garde par une assistante maternelle : −" + eur(cout) + "/mois";
          if (!O.estNombre(p.cmg_mensuel)) { mention = "aide de la Caf non déduite : coût surestimé"; avertissements.push("« " + e.libelle + " » : " + mention); }
        } else { cout = O.n0(p.cout_mensuel); raison = "garde : −" + eur(cout) + "/mois"; }
        const nai = naissances.find(n => n.params.enfant === p.enfant), age3 = rv("ecole_obligatoire_age");
        const finDefaut = nai && age3 !== undefined ? (+nai.date.slice(0, 4) + age3) + "-09-01" : null;
        let tf = tFin, suffixe = "";
        if (!e.fin) {
          if (finDefaut) { tf = mois(finDefaut); suffixe = " (instruction obligatoire à 3 ans)"; } else avertissements.push("« " + e.libelle + " » : date de fin inconnue, la garde est comptée jusqu'à la fin de l'horizon");
        } else if (finDefaut && e.fin === finDefaut) suffixe = " (instruction obligatoire à 3 ans)";
        const tfEff = tf == null ? N + 1 : tf;
        addComposant({ id: e.id, evenement_id: e.id, type: "creche", libelle: e.libelle, t0, t1: tfEff, reel: -cout * f, raison, raisonFin: "fin de la crèche" + suffixe });
        const duree = Math.max(0, Math.min(tfEff, N + 1) - t0);
        jalon(e, e.libelle, "enfant", "−" + eur(cout * f) + "/mois pendant " + duree + " mois", { mensuel: -cout * f, mois: duree, total: -cout * f * duree }, mention ? { avertissements: [mention] } : {});
        return;
      }
      if (e.type === "scolarite_privee") {
        if (t0 == null) return;
        const cout = O.n0(p.frais_annuels) / 12 * f;
        addComposant({ id: e.id, evenement_id: e.id, type: "scolarite_privee", libelle: e.libelle, t0, t1: tFin == null ? N + 1 : tFin, reel: -cout, raison: e.libelle + " : −" + eur(cout) + "/mois", raisonFin: "fin de " + nomEv(e) });
        jalon(e, e.libelle, "ecole", "−" + eur(cout) + "/mois, " + eur(O.n0(p.frais_annuels) * f) + " par an", { mensuel: -cout });
        return;
      }
      if (e.type === "changement_emploi" || e.type === "hausse_revenu") {
        if (t0 == null) return;
        const k = personneDe(e), part = O.estNombre(p.part_epargnee_pct) ? +p.part_epargnee_pct : 50;
        let delta;
        if (e.type === "changement_emploi") {
          const ref = O.estNombre(p.revenu_reference_mensuel) ? +p.revenu_reference_mensuel : salaireProfil(k);
          if (!O.estNombre(p.revenu_reference_mensuel)) avertissements.push("« " + e.libelle + " » : revenu de référence supposé égal au salaire du profil");
          delta = O.n0(p.salaire_net_mensuel) - ref;
        } else delta = O.estNombre(p.delta_mensuel) ? +p.delta_mensuel : salaireSansConge(k, e.date, e.id) * O.n0(p.delta_pct) / 100;
        const eff = (delta > 0 ? delta * part / 100 : delta) * f;
        const moitie = part === 50 ? "moitié épargnée" : frc(part) + " % épargnés";
        const raison = nomEv(e) + " : " + eurS(delta * f) + "/mois de revenus" + (delta > 0 ? ", " + moitie + " (" + eurS(eff) + ")" : "");
        addComposant({ id: e.id, evenement_id: e.id, type: e.type, libelle: e.libelle, t0, t1: tFin == null ? N + 1 : tFin, reel: eff, raison, raisonFin: "fin de " + nomEv(e) });
        jalon(e, e.libelle, "emploi", eurS(eff) + "/mois d'épargne", { revenus: delta * f, epargne: eff, part_epargnee_pct: part });
        return;
      }
      if (e.type === "conge_parental") {
        if (t0 == null) return;
        const k = personneDe(e), q = quotiteConge(e) / 100, sal = salaireSansConge(k, e.date);
        const perte = sal * (1 - q) * f, tf = tFin == null ? N + 1 : tFin;
        const cleP = e.params.activite === "arret" ? "prepare_taux_plein" : e.params.activite === "mi_temps" ? "prepare_mi_temps" : "prepare_temps_partiel";
        const prepare = rv(cleP), dureeP = rv("prepare_duree_premier_enfant_mois");
        addComposant({ id: e.id, evenement_id: e.id, type: "conge_parental", libelle: e.libelle, t0, t1: tf, reel: -perte,
          raison: nomEv(e) + " : −" + eur(perte) + " de salaire" + (prepare !== undefined ? ", +" + O.eurFixe(prepare * f, 2) + " de PreParE" : ""), raisonFin: "fin du congé parental" });
        let net = -perte;
        if (prepare === undefined || dureeP === undefined) avertissements.push("PreParE non comptée (repère manquant)");
        else {
          addComposant({ id: e.id + ":prepare", evenement_id: e.id, type: "conge_parental", libelle: e.libelle, t0, t1: Math.min(tf, t0 + dureeP), reel: prepare * f, raison: null, raisonFin: "fin de la PreParE" });
          net += prepare * f;
          if (O.n0(p.rang_enfant) > 1) avertissements.push("PreParE à partir du 2ᵉ enfant : durée non vérifiée, " + dureeP + " mois comptés");
        }
        jalon(e, e.libelle, "conge", "−" + eur(-net) + "/mois pendant " + Math.max(0, Math.min(tf, N + 1) - t0) + " mois", { mensuel: net, salaire: -perte, prepare: prepare !== undefined ? prepare * f : 0 });
      }
    });

    /* ---- crédits : la fin d'un crédit est une marche de la capacité ---- */
    credits.forEach(c => {
      if (!(c.mensualite > 0) || c.n < 1) return;
      const montant = c.mensualite * c.part, nom = minuscule1(c.nom), libere = montant * (c.part_reaffectee / 100);
      addComposant({ id: c.cle, type: "credit", libelle: c.nom, t0: 1, t1: c.n + 1, raison: null,
        raisonFin: "fin du " + nom + " : " + eurS(libere) + "/mois" + (c.part_reaffectee < 100 ? " (" + (c.part_reaffectee === 50 ? "moitié" : frc(c.part_reaffectee) + " %") + " réaffectée à l'épargne)" : "") });
      if (c.part_reaffectee < 100 && c.n + 1 <= N) addComposant({ id: c.cle + ":apres", type: "credit", libelle: c.nom, t0: c.n + 1, t1: N + 1, nom: -montant * (1 - c.part_reaffectee / 100), raison: null, raisonFin: null });
      M.jalons.push({ id: "credit:" + c.cle, date: c.fin_date, type: "fin_credit", titre: "Fin du " + minuscule1(c.nom), icone: "cle", effet: { texte: eurS(libere) + "/mois d'épargne en plus", montants: { mensualite: montant, reaffectee: libere } },
        source: "credit", evenement_id: c.fin_credit_evenement });
    });
    /* ---- tendance des salaires ---- */
    const g = rg.salaire_croissance_reelle_pct / 100, partTend = rg.part_hausse_epargnee_pct / 100;
    if (Math.abs(g) > 1e-12) {
      addComposant({ id: "tendance", type: "tendance", libelle: "Hausse tendancielle des salaires", t0: 1, t1: N + 1,
        reel: t => sum(M.persons, k => salaireSansConge(k, dates[t])) * (Math.pow(1 + g, t / 12) - 1) * partTend, raison: "hausse tendancielle des salaires", raisonFin: null });
    }
    /* ---- événements d'état : achat, retrait, crise ---- */
    M.evtParMois = {};
    M.crise_evenement = null;
    evts.forEach(e => {
      const f = facteur(e);
      if (e.type === "crise") { M.crise_evenement = { cle: e.params.cle, date: e.date }; pris(e); return; }
      if (f === 0 || !(e.type === "retrait" || e.type === "achat_immobilier")) return;
      const t0 = mois(e.date);
      if (t0 == null || t0 > N) return;
      (M.evtParMois[t0] = M.evtParMois[t0] || []).push({ t: t0, e, f });
      pris(e);
    });
    M.achats = [];
    M.retraits = [];
    M.detteNew = new Float64Array(N + 2);
    /* ---- versements programmés ---- */
    M.prog = [];
    liste(objet(d.config).recurring).forEach(r => {
      if (!r || !(+r.amount > 0)) return;
      const p = liste(d.positions).find(x => x && x.id === r.positionId);
      if (!p || !Calc.inScope(p, sc) || !Calc.counted(p)) return;
      const b = comps.findIndex(c => c.lignes.includes(p.id));
      if (b >= 0) M.prog.push({ b, montant: +r.amount, debut: r.start || null });
    });
    /* ---- destination du reste (allocation cible) ---- */
    const PREF = { actions: ["pea", "pea_pme", "assurance_vie", "capitalisation", "compte_titres"], obligations: ["assurance_vie", "capitalisation", "compte_titres"],
      immobilier: ["assurance_vie", "capitalisation", "compte_titres"], or: ["compte_titres"], autres: ["assurance_vie", "capitalisation", "compte_titres"], crypto: ["compte_titres"],
      fonds_euros: ["assurance_vie", "capitalisation"], monetaire: [] };
    PREF.small_caps = PREF.actions; PREF.emergents = PREF.actions;
    const ensure = (modele, classe) => {
      const deja = comps.findIndex(c => c.cle === modele.cle && c.enveloppe === modele.enveloppe && c.titulaire === modele.titulaire && c.classe === classe && !c.levier);
      if (deja >= 0) return deja;
      const c = Object.assign({}, modele, { id: "c" + comps.length, classe, levier: null, v0: 0, base0: 0, base_inconnue: false, lignes: [], ter_pct: 0, synthetique: true });
      const p = pc(classe);
      c.kz = IDX[classe] != null ? IDX[classe] : -1; c.a = Math.log(1 + p.rendement / 100) / 12; c.s = p.volatilite / 100 / Math.sqrt(12); c.aSerie = null;
      c.attendu_pct = pcCentral(classe).rendement;
      finaliser(c);
      comps.push(c);
      return comps.length - 1;
    };
    M.cible = null;
    if (rg.reste_capacite === "cible" && ctx.cibles) {
      const proprietaires = Dn.personnesDe(sc).concat(["commun"]);
      M.cible = Object.keys(ctx.cibles).map(k => {
        const candidats = [];
        (PREF[k] || []).forEach(tp => {
          const modele = comps.find(c => c.type === tp && !c.levier && proprietaires.includes(c.titulaire));
          if (modele) { const b = ensure(modele, k); if (!candidats.includes(b)) candidats.push(b); }
        });
        return { classe: k, poids: ctx.cibles[k], candidats };
      });
    }
    M.peaPlafond = rv("pea_plafond");
    M.peaVerse0 = {};
    comps.forEach(c => { if (F.PEA.includes(c.type) && M.peaVerse0[c.cle] == null) M.peaVerse0[c.cle] = O.estNombre(objet(c.info).versements_cumules) ? +c.info.versements_cumules : sum(comps.filter(x => x.cle === c.cle), x => x.base0); });
    /* ---- objectifs ---- */
    M.objs = [];
    liste(d.objectifs).forEach(ob => {
      if (!ob || !(+ob.cible > 0)) return;
      const dc = ob.dateCible || ob.date_cible;
      if (!O.estDate(dc)) return;
      const tObj = O.moisEntre(today, dc), poches = liste(ob.poches), envs = liste(ob.enveloppes);
      const refPos = liste(d.positions).filter(p => p && Calc.counted(p) && Calc.inScope(p, sc) && (poches.includes(p.bloc) || envs.includes(p.envelope)));
      let ref = ob.source === "poches" && refPos.length ? comps.map((c, b) => (c.lignes.some(id => refPos.some(p => p.id === id)) ? b : -1)).filter(b => b >= 0) : [];
      const saisi = !ref.length;
      if (saisi) ref = comps.map((c, b) => (c.dispo ? b : -1)).filter(b => b >= 0);
      const v0 = sum(ref, b => comps[b].v0), dejaV = ob.source === "poches" && !saisi ? v0 : O.n0(ob.deja);
      const dest = ref.slice().sort((a, b) => comps[b].v0 - comps[a].v0)[0];
      const att = v0 > 0 ? sum(ref, b => comps[b].v0 * comps[b].attendu_net_pct) / v0 : 0;
      const cibleNom = +ob.cible * Math.pow(1 + pi, Math.max(1, tObj) / 12);
      const eff = tObj >= 1 ? Plan.effortMensuel(cibleNom, dejaV, tObj, att) : 0;
      M.objs.push({ id: ob.id, nom: ob.nom, type: ob.type, cible: +ob.cible, date: dc, t: tObj, ref, dest, saisi, priorite: ob.priorite == null ? Infinity : +ob.priorite,
        effort: isFinite(eff) ? eff : 0, deja: dejaV, attendu_pct: att });
    });
    M.objs.sort((a, b) => (a.priorite - b.priorite) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    /* ---- matelas, abattement de l'assurance-vie ---- */
    const mat = Calc.matelas(objet(d.config));
    M.matelas0 = (mat ? mat.min : 0) / (sc === "foyer" ? 1 : 2);
    const ab = rv(cc.couple ? "av_abattement_couple" : "av_abattement_seul");
    M.abatAnnuel = ab === undefined ? 0 : ab;
    M.couple = cc.couple;
    M.comps = comps;
    M.B = comps.length;
    M.rendementInfo = infosRendement(M, comps, pcLecture);
    M.scpiDistribution = rv("scpi_taux_distribution") === undefined ? null : rv("scpi_taux_distribution") / 100;
    /* SCPI détenues en direct (spec § 5.3) : une part du rendement de la classe est distribuée chaque mois au compte courant, après impôt au barème (TMI) et
       prélèvements sociaux fonciers ; le reste du rendement reste dans la part. Sans l'un des repères, rien n'est distribué (limite dite, jamais une valeur de secours). */
    M.scpiB = []; M.scpiNet = null;
    comps.forEach((c, b) => { if (c.type === "scpi_direct") M.scpiB.push(b); });
    if (M.scpiB.length) {
      const psFoncier = rv("ps_taux_foncier");
      if (M.scpiDistribution == null) ctx.manquant("scpi_taux_distribution", "distribution des SCPI : toute leur performance reste dans la part, aucun revenu n'est versé");
      else if (psFoncier === undefined) ctx.manquant("ps_taux_foncier", "prélèvements sociaux sur les revenus fonciers : les distributions des SCPI ne sont pas versées, toute leur performance reste dans la part");
      else {
        let tmi = rg.tmi_pct;
        if (tmi == null || !isFinite(+tmi)) { tmi = 30; avertissements.push("taux marginal supposé de 30 % pour l'impôt sur les loyers des SCPI, à confirmer avec Claude"); }
        M.scpiNet = 1 - (+tmi + psFoncier) / 100;
      }
    }
    M.det = null;
    return M;
  }

  /* ================================================================== simulation (cœur) */
  const DEUX_PI = 2 * Math.PI;
  const rangs = P => NOMS_P.map(k => Math.min(P, Math.max(1, Math.ceil(PERCENTILES[k] * P - 1e-9))) - 1);
  /** Valeurs de rangs donnés (indices triés croissants) d'un tableau de nombres, par sélection (Hoare, pivot médian de trois) au lieu d'un tri complet : même résultat que a.sort()[rang], en
      une fraction du temps. Réordonne `a`. Utilisé chaque mois pour les centiles du rendement (2 000 chemins). */
  function selectionnerRangs(a, rs, out) {
    const pas = (lo, hi, i0, i1) => {
      if (i0 > i1 || lo >= hi) { for (let i = i0; i <= i1; i++) out[i] = a[rs[i]]; return; }
      const mid = (i0 + i1) >> 1, r = rs[mid];
      let l = lo, h = hi;
      while (l < h) {
        const x = a[l], y = a[(l + h) >> 1], z = a[h], pivot = x < y ? (y < z ? y : x < z ? z : x) : (x < z ? x : y < z ? z : y);
        let i = l, j = h;
        while (i <= j) {
          while (a[i] < pivot) i++;
          while (a[j] > pivot) j--;
          if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
        }
        if (r <= j) h = j; else if (r >= i) l = i; else break;
      }
      out[mid] = a[r];
      pas(lo, r - 1, i0, mid - 1);
      pas(r + 1, hi, mid + 1, i1);
    };
    pas(0, a.length - 1, 0, rs.length - 1);
    return out;
  }

  /** Un calcul : P chemins (1 en mode déterministe), mois à l'extérieur, chemins à l'intérieur. Voir la spec § 4, § 6, § 9.
      o : { P, graine, det, plan (vrai : la passe déterministe construit les achats et les composants), trace, vue, net_impots, infl, crise, retenir, marques }. */
  function derouler(M, o) {
    const P = o.P, B = M.B, N = M.N, det = !!o.det, comps = M.comps, dates = M.dates, infl = o.infl || M.infl;
    const trace = !!o.trace, planifier = !!o.plan;
    const vue = o.vue || "financier", netImp = !!o.net_impots;
    /* rendement des placements (TWR) : par chemin, le facteur de croissance cumulé (produit des rendements de chaque mois), mesuré au moment de la croissance (avant les flux du mois, qui tombent en fin de mois),
       sur les compartiments hors comptes courants ; les frais sont déjà dans la croissance (feeM) */
    const rend = !!o.rend, fac = rend ? new Float64Array(P).fill(1) : null, facPrec = rend ? new Float64Array(P).fill(1) : null, masqueP = Float64Array.from(comps, c => (c.type === "courant" ? 0 : 1));
    const V = new Float64Array(P * B), Bs = new Float64Array(P * B), Vx = new Float64Array(P * B);
    for (let i = 0; i < P; i++) for (let b = 0; b < B; b++) { V[i * B + b] = comps[b].v0; Bs[i * B + b] = comps[b].base0; Vx[i * B + b] = comps[b].v0; }
    const bien = new Float64Array(P).fill(M.bien0), bienX = new Float64Array(P).fill(M.bien0);
    const abat = new Float64Array(P).fill(M.abatAnnuel);
    const manque = new Int16Array(P);
    const peaSlot = new Int16Array(B).fill(-1), peaCles = [];
    if (M.cible) M.cible.forEach(c => c.candidats.forEach(b => { if (F.PEA.includes(comps[b].type)) { let s = peaCles.indexOf(comps[b].cle); if (s < 0) { peaCles.push(comps[b].cle); s = peaCles.length - 1; } peaSlot[b] = s; } }));
    const peaV = new Float64Array(P * Math.max(1, peaCles.length));
    for (let i = 0; i < P; i++) peaCles.forEach((cle, s) => { peaV[i * peaCles.length + s] = M.peaVerse0[cle] || 0; });
    const dispoIdx = comps.map((c, b) => (c.dispo ? b : -1)).filter(b => b >= 0).sort((a, b) => (comps[a].type === "courant" ? 0 : 1) - (comps[b].type === "courant" ? 0 : 1) || a - b);
    const iC = M.idxCourant;
    /* ---- tirages : générateur par chemin, classes utiles ---- */
    const st = new Uint32Array(4 * P);
    const graine = o.graine == null ? GRAINE : o.graine;
    for (let i = 0; i < P; i++) O.initialiserEtat(st, i, graine);
    const Lc = Dn.choleskyTirees().L, K = NB_TIRAGES;
    const grpCle = new Map(), groupes = [];
    const stochBien = !det && M.bienRend.s > 0 && (M.bien0 > 0 || Object.values(M.evtParMois).some(l => l.some(x => x.e.type === "achat_immobilier")));
    if (!det) comps.forEach((c, b) => {
      if (!(c.s > 0) || c.kz < 0 || c.aSerie) return;
      const cle = c.kz + "|" + c.a + "|" + c.s;
      if (!grpCle.has(cle)) { grpCle.set(cle, groupes.length); groupes.push({ kz: c.kz, a: c.a, s: c.s, membres: [] }); }
      groupes[grpCle.get(cle)].membres.push(b);
    });
    const grpDe = new Int16Array(B).fill(-1);
    groupes.forEach((g, k) => g.membres.forEach(b => { grpDe[b] = k; }));
    const needK = new Set(groupes.map(g => g.kz));
    if (stochBien) needK.add(M.bienRend.kz);
    const needKList = [...needK].sort((a, b) => a - b), needEps = new Uint8Array(K);
    needKList.forEach(k => { for (let j = 0; j <= k; j++) if (Math.abs(Lc[k * K + j]) > 1e-15) needEps[j] = 1; });
    const needKArr = Int16Array.from(needKList), nK = needKArr.length;
    const needPair = [0, 1, 2, 3, 4, 5].map(q => (needEps[2 * q] || needEps[2 * q + 1] ? 1 : 0));
    const eps = new Float64Array(K), z = new Float64Array(K);
    /* ---- sorties ---- */
    const rg = rangs(P), nv = vue === "net" ? 1 : 0;
    const centiles = {}; NOMS_P.forEach(k => { centiles[k] = new Float64Array(N + 1); });
    const exis = {}, ecart = {};
    NOMS_P.forEach(k => { exis[k] = new Float64Array(N + 1).fill(NaN); ecart[k] = new Float64Array(N + 1).fill(NaN); });
    const probEcart = new Float64Array(N + 1).fill(NaN);
    const cumLog = {}, anLog = {}, triR = rend ? new Float64Array(P) : null, anP = rend ? new Float64Array(P) : null, rv5 = new Float64Array(NOMS_P.length);
    if (rend) NOMS_P.forEach(k => { cumLog[k] = new Float64Array(N + 1); anLog[k] = new Float64Array(Math.floor(N / 12) + 1); });
    const tot = new Float64Array(P), tri = new Float64Array(P), totX = new Float64Array(P), triX = new Float64Array(P), diff = new Float64Array(P);
    const marquesSet = new Set(o.marques || []);
    const retenir = {}; (o.retenir || []).forEach(t => { retenir[t] = new Float64Array(P); });
    const objCompte = M.objs.map(() => 0);
    /* BUD1 (spec § 10.2) : un compteur par objectif et par mois (chemins dont la valeur de référence atteint la cible, en euros constants), dans la boucle existante */
    const objMois = o.datesAtteinte ? M.objs.map(() => new Int32Array(N + 1)) : null;
    const apportMois = new Set(o.apportMois || []), apportRes = {}; apportMois.forEach(t => { apportRes[t] = new Float64Array(P); });
    const tr = trace ? {
      fin: new Float64Array(N + 1), dispo: new Float64Array(N + 1), net: new Float64Array(N + 1), bien: new Float64Array(N + 1), dette: new Float64Array(N + 1),
      cap: new Float64Array(N + 1), flux: new Float64Array(N + 1), impots: new Float64Array(N + 1), gain: new Float64Array(N + 1), frais: new Float64Array(N + 1),
      finX: new Float64Array(N + 1), valeurs: new Float64Array((N + 1) * B), retraits: [], depotsProg: new Float64Array(N + 1),
    } : null;
    let srcs = null;
    const dernier = N;
    /* ---- fonctions de travail ---- */
    const depose = (off, b, x) => { V[off + b] += x; Bs[off + b] += x; };
    const prepDe = b => comps[b].prep;
    const log = (b, niveau, brut, net, ir, ps, extra) => { if (srcs) srcs.push(Object.assign({ b, enveloppe: comps[b].enveloppe, type: comps[b].type, niveau, brut, net, impot_revenu: ir, prelevements_sociaux: ps, impots: ir + ps }, extra || {})); };
    let impotsMois = 0;
    /** Prélève `net` dans le compartiment b du chemin (valeurs de `off`) ; renvoie le net obtenu. */
    function prendre(i, off, b, net, niveau, tout, t) {
      const v = V[off + b];
      if (!(v > 1e-9) || !(net > 0)) return 0;
      const prep = prepDe(b), base = Bs[off + b], date = dates[t];
      const pleine = prep.calculer(v, base, date, abat[i]);
      let brut = tout || v - pleine.ir - pleine.ps <= net + 1e-9 ? v : F.brutPourNet(prep, { valeur: v, base }, net, date, abat[i]);
      const f = brut / v, tx = brut === v ? pleine : prep.calculer(brut, base * f, date, abat[i]);
      const obtenu = brut - tx.ir - tx.ps;
      abat[i] = Math.max(0, abat[i] - (tx.abat_utilise || 0));
      impotsMois += tx.ir + tx.ps;
      log(b, niveau, brut, obtenu, tx.ir, tx.ps, tout && niveau === 6 ? { cloture: true } : null);
      Bs[off + b] = base - base * f; V[off + b] = v - brut;
      if (V[off + b] < 1e-9) { V[off + b] = 0; Bs[off + b] = 0; }
      return obtenu;
    }
    const cand = new Int16Array(B), candCout = new Float64Array(B);
    /** Retire `need` (net) dans l'ordre du § 6.3 ; renvoie ce qui n'a pas pu être couvert. flags : { rp, autoriser_cloture_pea, niveau_max, exclure_indisponibles (apport : les enveloppes dont l'impôt de sortie est inconnu ne sont pas comptées) }. */
    function retirer(i, t, need, flags, matelasNom) {
      const off = i * B, date = dates[t], max = flags.niveau_max || 6;
      let reste = need, dispoTot = 0;
      for (const b of dispoIdx) dispoTot += V[off + b];
      let autorise = Math.max(0, dispoTot - matelasNom);
      for (const b of dispoIdx) {
        if (!(reste > 1e-9) || !(autorise > 1e-9)) break;
        const prise = Math.min(reste, autorise, Math.max(0, V[off + b]));
        if (prise > 0) { V[off + b] -= prise; reste -= prise; autorise -= prise; log(b, 1, prise, prise, 0, 0); }
      }
      for (let niveau = 2; niveau <= 4; niveau++) {
        if (niveau > max || !(reste > 1e-9)) continue;
        let nc = 0;
        for (let b = 0; b < B; b++) {
          if (comps[b].dispo || !(V[off + b] > 1e-9) || F.niveauRetrait(comps[b], date, flags) !== niveau) continue;
          if (flags.exclure_indisponibles && comps[b].prep.indisponible) continue; /* apport : impôt de sortie inconnu, part non comptée (comme capaciteEmprunt) */
          const g = Math.min(V[off + b], reste), fr = g / V[off + b];
          const tx = comps[b].prep.calculer(g, Bs[off + b] * fr, date, abat[i]);
          candCout[nc] = (tx.ir + tx.ps) / Math.max(1e-9, g - tx.ir - tx.ps); cand[nc++] = b;
        }
        for (let a = 1; a < nc; a++) { const cb = cand[a], cc = candCout[a]; let k = a - 1; while (k >= 0 && candCout[k] > cc) { cand[k + 1] = cand[k]; candCout[k + 1] = candCout[k]; k--; } cand[k + 1] = cb; candCout[k + 1] = cc; }
        for (let a = 0; a < nc && reste > 1e-9; a++) reste -= prendre(i, off, cand[a], reste, niveau, false, t);
      }
      if (max >= 5 && reste > 1e-9) {
        for (const b of dispoIdx) {
          if (!(reste > 1e-9)) break;
          const prise = Math.min(reste, Math.max(0, V[off + b]));
          if (prise > 0) { V[off + b] -= prise; reste -= prise; log(b, 5, prise, prise, 0, 0); }
        }
      }
      if (max >= 6 && reste > 1e-9 && flags.autoriser_cloture_pea) {
        for (let b = 0; b < B && reste > 1e-9; b++) {
          if (comps[b].dispo || !(V[off + b] > 1e-9) || F.niveauRetrait(comps[b], date, flags) !== 6) continue;
          const net = prendre(i, off, b, reste, 6, true, t), utile = Math.min(net, reste);
          reste -= utile;
          if (net > utile) depose(off, iC, net - utile);
        }
      }
      return Math.max(0, reste);
    }
    /** Dépose un montant selon l'allocation cible (PEA : plafond de versements ; sans candidat : le compte courant). */
    function deposerCible(i, off, x) {
      for (const c of M.cible) {
        let part = x * c.poids;
        if (!c.candidats.length) { depose(off, iC, part); continue; }
        for (let k = 0; k < c.candidats.length && part > 1e-12; k++) {
          const b = c.candidats[k], dernierCand = k === c.candidats.length - 1, s = peaSlot[b];
          if (s >= 0 && M.peaPlafond !== undefined) {
            const room = Math.max(0, M.peaPlafond - peaV[i * peaCles.length + s]);
            const mis = dernierCand ? part : Math.min(part, room);
            if (dernierCand && mis > room + 1e-9) M.plafondDepasse = true;
            if (mis > 0) { depose(off, b, mis); peaV[i * peaCles.length + s] += mis; part -= mis; }
          } else { depose(off, b, part); part = 0; }
        }
      }
    }
    const dispoSomme = off => { let s = 0; for (const b of dispoIdx) s += V[off + b]; return s; };
    const vueComps = nom => (nom === "disponible" ? dispoIdx : null);
    function totalVue(arr, off, t, i, nomVue, bi, dette, base) {
      let s = 0;
      if (nomVue === "disponible") { for (const b of dispoIdx) s += arr[off + b]; return s; }
      for (let b = 0; b < B; b++) s += arr[off + b];
      if (nomVue === "net") s += bi - dette + M.autres0 * infl[t];
      return s;
    }
    const prepBiens = M.biensTaxables.map(x => ({ x, prep: x.prix_achat != null ? F.preparer({ type: "bien_autre", valeur: x.valeur0, base: x.prix_achat, date_achat: x.date_achat, classe: "immobilier" }, { reperes: M.ctx.R }) : null }));
    if (netImp) M.biensTaxables.forEach(x => { if (x.prix_achat == null && !M.avertissements.includes("prix d'achat à compléter pour « " + x.nom + " » : plus-value non déduite")) M.avertissements.push("prix d'achat à compléter pour « " + x.nom + " » : plus-value non déduite"); });
    /** Valeur après impôts « si tu retirais tout » (spec § 5.2) : compartiments (abattement de l'assurance-vie partagé) et biens taxables. */
    function apresImpots(arr, off, baseArr, boff, t, nomVue, bi, dette) {
      const date = dates[t];
      let s = 0, pot = M.abatAnnuel;
      const liste_ = nomVue === "disponible" ? dispoIdx : comps.map((c, b) => b);
      for (const b of liste_) {
        const v = arr[off + b];
        if (!(v > 0)) { s += v; continue; }
        const prep = comps[b].prep;
        if (prep.indisponible) { s += v; continue; }
        const tx = prep.calculer(v, baseArr[boff + b], date, pot);
        pot = Math.max(0, pot - (tx.abat_utilise || 0));
        s += v - tx.ir - tx.ps;
      }
      if (nomVue === "net") {
        let biensNets = bi;
        if (M.bien0 > 0) prepBiens.forEach(({ x, prep }) => { if (prep) { const v = x.valeur0 * bi / M.bien0, tx = prep.calculer(v, x.prix_achat, date, 0); biensNets -= tx.ir + tx.ps; } });
        s += biensNets - dette + M.autres0 * infl[t];
      }
      return s;
    }
    const base0Arr = Float64Array.from(comps, c => c.base0);
    const crisePar = o.crise || null;
    const aMois = new Float64Array(B), gDet = new Float64Array(B), gGrp = new Float64Array(groupes.length);
    const progTot = sum(M.prog, x => x.montant);
    const anneeDe = t => +dates[t].slice(0, 4);

    /* ---- mois 0 ---- */
    function releve(t) {
      const dette = M.detteExist[t] + M.detteNew[t], dnom = infl[t];
      for (let i = 0; i < P; i++) {
        const off = i * B;
        tot[i] = netImp ? apresImpots(V, off, Bs, off, t, vue, bien[i], dette) : totalVue(V, off, t, i, vue, bien[i], dette);
      }
      tri.set(tot); tri.sort();
      NOMS_P.forEach((k, j) => { centiles[k][t] = tri[rg[j]]; });
      if (rend) {
        triR.set(fac); selectionnerRangs(triR, rg, rv5);
        NOMS_P.forEach((k, j) => { cumLog[k][t] = Math.log(rv5[j]); });
        if (t > 0 && (t % 12 === 0 || t === N)) {
          for (let i = 0; i < P; i++) anP[i] = fac[i] / facPrec[i];
          selectionnerRangs(anP, rg, rv5);
          NOMS_P.forEach((k, j) => { anLog[k][Math.ceil(t / 12)] = Math.log(rv5[j]); });
          facPrec.set(fac);
        }
      }
      if (retenir[t]) retenir[t].set(tot);
      if (o.couches && (t % 12 === 0 || t === N || marquesSet.has(t))) {
        const detteX = M.detteExist[0];
        for (let i = 0; i < P; i++) {
          const off = i * B;
          totX[i] = netImp ? apresImpots(Vx, off, base0Arr, 0, t, vue, bienX[i], detteX) : totalVue(Vx, off, t, i, vue, bienX[i], detteX);
          diff[i] = tot[i] - totX[i];
        }
        triX.set(totX); triX.sort();
        NOMS_P.forEach((k, j) => { exis[k][t] = triX[rg[j]]; });
        const d2 = Float64Array.from(diff); d2.sort();
        NOMS_P.forEach((k, j) => { ecart[k][t] = d2[rg[j]]; });
        let mieux = 0; for (let i = 0; i < P; i++) if (diff[i] >= 0) mieux++;
        probEcart[t] = mieux / P;
      }
      M.objs.forEach((ob, j) => {
        if (ob.t !== t && !objMois) return;
        let n = 0;
        for (let i = 0; i < P; i++) { let s = 0; const off = i * B; for (const b of ob.ref) s += V[off + b]; if (s >= ob.cible * infl[t] - 1e-9) n++; }
        if (ob.t === t) objCompte[j] += n;
        if (objMois) objMois[j][t] = n;
      });
      if (trace) {
        const off = 0;
        let f = 0, dsp = 0;
        for (let b = 0; b < B; b++) { f += V[b]; tr.valeurs[t * B + b] = V[b]; }
        for (const b of dispoIdx) dsp += V[b];
        tr.fin[t] = f; tr.dispo[t] = dsp; tr.bien[t] = bien[0]; tr.dette[t] = dette; tr.net[t] = f + bien[0] - dette + M.autres0 * infl[t];
        let fx = 0; for (let b = 0; b < B; b++) fx += Vx[b]; tr.finX[t] = fx;
      }
    }
    releve(0);
    if (o.couches && o.couches !== true) { /* réservé */ }

    /* ---- boucle des mois ---- */
    for (let t = 1; t <= N; t++) {
      const inflT = infl[t], matelasNom = M.matelas0 * inflT;
      const nouvelleAnnee = anneeDe(t) !== anneeDe(t - 1);
      if (nouvelleAnnee) abat.fill(M.abatAnnuel);
      /* rendement du mois par compartiment : déterministe (g) ou tiré (groupes) */
      const dansCrise = crisePar && t >= crisePar.t0 && t < crisePar.t1;
      for (let b = 0; b < B; b++) {
        const c = comps[b];
        let a = c.aSerie ? c.aSerie[t] : c.a;
        if (dansCrise) { const choc = crisePar.chocs[c.type === "courant" ? "monetaire" : c.classe]; a = c.type === "courant" ? 0 : Math.log(1 + (choc || 0) / 100) / crisePar.duree; }
        aMois[b] = a;
        gDet[b] = Math.exp(a) * c.feeM;
      }
      const aBien = dansCrise ? Math.log(1 + (crisePar.chocs.immobilier || 0) / 100) / crisePar.duree : M.bienRend.a;
      const gBienDet = Math.exp(aBien);
      for (let i = 0; i < P; i++) {
        const off = i * B;
        if (!det) {
          const so = 4 * i;
          for (let q = 0; q < 6; q++) {
            const u1 = O.uniforme(st, so), u2 = O.uniforme(st, so);
            if (needPair[q]) { const r = Math.sqrt(-2 * Math.log(u1)), c = Math.cos(DEUX_PI * u2), sn = Math.sqrt(1 - c * c); eps[2 * q] = r * c; eps[2 * q + 1] = u2 < 0.5 ? r * sn : -r * sn; }
          }
          for (let a = 0; a < nK; a++) { const k = needKArr[a]; let s = 0; for (let j = 0; j <= k; j++) s += Lc[k * K + j] * eps[j]; z[k] = s; }
          for (let g = 0; g < groupes.length; g++) gGrp[g] = Math.exp(groupes[g].a + groupes[g].s * z[groupes[g].kz]);
        }
        if (trace) {
          for (let b = 0; b < B; b++) { const gg = grpDe[b] >= 0 ? gGrp[grpDe[b]] : Math.exp(aMois[b]); const v = V[off + b]; tr.gain[t] += v * (gg - 1); tr.frais[t] += v * gg * (1 - comps[b].feeM); }
        }
        if (rend) {
          let avantP = 0, apresP = 0;
          for (let b = 0; b < B; b++) {
            const f = (grpDe[b] >= 0 ? gGrp[grpDe[b]] * comps[b].feeM : gDet[b]), v = V[off + b], nv = v * f, mk = masqueP[b];
            V[off + b] = nv; Vx[off + b] *= f; avantP += v * mk; apresP += nv * mk;
          }
          if (avantP > 1e-6 && apresP > 0) fac[i] *= apresP / avantP;
        } else {
          for (let b = 0; b < B; b++) {
            const f = (grpDe[b] >= 0 ? gGrp[grpDe[b]] * comps[b].feeM : gDet[b]);
            V[off + b] *= f; Vx[off + b] *= f;
          }
        }
        if (M.scpiNet != null) for (const b of M.scpiB) {
          const dist = V[off + b] * M.scpiDistribution / 12, distX = Vx[off + b] * M.scpiDistribution / 12;
          if (dist > 0) { V[off + b] -= dist; depose(off, iC, dist * M.scpiNet); }
          if (distX > 0) { Vx[off + b] -= distX; Vx[off + iC] += distX * M.scpiNet; }
        }
        const gB = stochBien ? Math.exp(aBien + M.bienRend.s * z[M.bienRend.kz]) : gBienDet;
        bien[i] *= gB; bienX[i] *= gB;
        /* flux du foyer */
        const cap = infl_cap(t, inflT);
        impotsMois = 0;
        if (trace) { srcs = []; tr.cap[t] = cap; }
        let reste = cap;
        const progNom = progTot;
        for (const pg of M.prog) { if (pg.debut && pg.debut > dates[t]) continue; depose(off, pg.b, pg.montant); reste -= pg.montant; if (trace && i === 0) tr.depotsProg[t] += pg.montant; }
        if (reste >= 0) {
          const gap = Math.max(0, matelasNom - dispoSomme(off));
          const m = Math.min(reste, gap);
          if (m > 0) { depose(off, iC, m); reste -= m; }
          for (const ob of M.objs) {
            if (!(reste > 1e-9)) break;
            if (t > ob.t || !(ob.effort > 0)) continue;
            const e = Math.min(reste, ob.effort);
            depose(off, ob.dest, e); reste -= e;
          }
          if (reste > 0) { if (M.cible) deposerCible(i, off, reste); else depose(off, iC, reste); }
        } else {
          const manquant = retirer(i, t, -reste, {}, matelasNom);
          if (manquant > 1e-6) { V[off + iC] -= manquant; if (!manque[i]) manque[i] = t; }
        }
        /* événements datés du mois */
        const evs = M.evtParMois[t];
        let fluxEv = 0;
        if (evs) for (const x of evs) fluxEv += evenement(i, off, t, x, matelasNom);
        const impots = impotsMois;
        if (trace && i === 0) { tr.impots[t] = impots; tr.flux[t] = cap + fluxEv; if (srcs.length) tr.retraits.push({ t, sources: srcs }); }
        /* rééquilibrage annuel (option) */
        if (M.reglages.reequilibrage === "annuel" && dates[t].slice(5, 7) === "01" && M.cible) reequilibrer(off);
      }
      releve(t);
      if (apportMois.has(t)) {
        const matelasNom = M.matelas0 * infl[t], sauveSrcs = srcs, imp = impotsMois;
        for (let i = 0; i < P; i++) {
          const off = i * B, sv = V.slice(off, off + B), sb = Bs.slice(off, off + B), sa = abat[i];
          srcs = [];
          retirer(i, t, 1e15, { niveau_max: 4, rp: true, exclure_indisponibles: true }, matelasNom);
          apportRes[t][i] = srcs.reduce((a, y) => a + y.net, 0);
          V.set(sv, off); Bs.set(sb, off); abat[i] = sa;
        }
        srcs = sauveSrcs; impotsMois = imp;
      }
    }
    function infl_cap(t, inflT) { return inflT * (M.reelBase + M.reelDelta[t]) + M.nomDelta[t] - M.mensExist[t]; }
    function reequilibrer(off) {
      const parEnv = new Map();
      comps.forEach((c, b) => { if (c.dispo || c.type === "compte_titres" || c.levier) return; const k = c.cle + "|" + c.titulaire; if (!parEnv.has(k)) parEnv.set(k, []); parEnv.get(k).push(b); });
      parEnv.forEach(bs => {
        const poids = bs.map(b => { const c = M.cible.find(x => x.classe === comps[b].classe); return c ? c.poids : 0; });
        const sp = poids.reduce((a, x) => a + x, 0);
        if (!(sp > 0)) return;
        const totV = bs.reduce((a, b) => a + V[off + b], 0), totB = bs.reduce((a, b) => a + Bs[off + b], 0);
        bs.forEach((b, k) => { V[off + b] = totV * poids[k] / sp; Bs[off + b] = totB * poids[k] / sp; });
      });
    }
    /** Achat ou retrait ponctuel du mois ; renvoie le flux net sorti du patrimoine financier (pour la décomposition). */
    function evenement(i, off, t, x, matelasNom) {
      const e = x.e, p = e.params, inflT = infl[t];
      if (e.type === "retrait") {
        const montant = O.n0(p.montant) * x.f * inflT;
        const flags = { autoriser_cloture_pea: !!p.autoriser_cloture_pea };
        const manquant = retirer(i, t, montant, flags, matelasNom);
        if (manquant > 1e-6) { V[off + iC] -= manquant; if (!manque[i]) manque[i] = t; }
        if (planifier && i === 0) M.retraits.push({ t, date: dates[t], evenement_id: e.id, libelle: e.libelle, montant, manque: manquant, sources: srcs ? srcs.slice() : [] });
        return -montant;
      }
      /* achat immobilier */
      let a = M.achats.find(y => y.evenement_id === e.id);
      if (planifier && i === 0 && !a) a = planAchat(x, t, i, off, matelasNom);
      if (!a || a.indisponible) return 0;
      const flags = { rp: a.usage === "rp", autoriser_cloture_pea: !!p.autoriser_cloture_pea };
      const avant = srcs ? srcs.length : 0;
      const manquant = retirer(i, t, a.apport, flags, matelasNom);
      if (manquant > 1e-6) { V[off + iC] -= manquant; if (!manque[i]) manque[i] = t; }
      bien[i] += a.prix;
      if (planifier && i === 0) { a.apport_sources = srcs.slice(avant).map(s => ({ enveloppe: s.enveloppe, brut: s.brut, impots: s.impots, niveau: s.niveau })); a.impots = srcs.slice(avant).reduce((s, y) => s + y.impots, 0); a.manque = manquant; }
      return -a.apport;
    }
    /** Résout un achat dans la passe déterministe : apport (« max » = tout le mobilisable au-dessus du matelas), crédit, composants de capacité. */
    function planAchat(x, t, i, off, matelasNom) {
      const e = x.e, p = e.params, f = x.f, inflT = infl[t], rv = M.ctx.rv;
      const usage = p.usage || "rp", pret = objet(p.pret);
      const cle = p.neuf ? "frais_acquisition_neuf_pct" : p.primo ? "frais_acquisition_primo_pct" : "frais_acquisition_ancien_pct";
      const fa = rv(cle);
      const indispo = pourquoi => { M.avertissements.push("achat « " + e.libelle + " » non chiffré : " + pourquoi); const a = { evenement_id: e.id, t, indisponible: true }; M.achats.push(a); return a; };
      if (fa === undefined) { M.ctx.manquant(cle, "frais d'acquisition"); return indispo("repère manquant (" + cle + ")"); }
      const nearest = [15, 20, 25].sort((u, v) => Math.abs(u - pret.duree_ans) - Math.abs(v - pret.duree_ans) || u - v)[0];
      let taux = O.estNombre(pret.taux_pct) ? +pret.taux_pct : rv("taux_credit_immo_" + nearest);
      if (taux === undefined) { M.ctx.manquant("taux_credit_immo_" + nearest, "taux du jour"); return indispo("taux du jour indisponible (repère manquant)"); }
      let ass = O.estNombre(pret.assurance_pct) ? +pret.assurance_pct : M.reglages.assurance_pct;
      if (ass == null) { ass = rv("assurance_emprunteur_defaut_pct"); if (ass === undefined) return indispo("repère manquant (assurance_emprunteur_defaut_pct)"); M.avertissements.push("achat « " + e.libelle + " » : assurance emprunteur supposée à " + frc(ass, 2) + " % (hypothèse)"); }
      if (!O.estNombre(pret.taux_pct)) M.avertissements.push("achat « " + e.libelle + " » : taux du jour du repère (" + frc(taux, 2) + " %) pris pour " + pret.duree_ans + " ans");
      const prix = O.n0(p.prix) * f * inflT, fraisAcq = prix * fa / 100, cout = prix + fraisAcq;
      const flags = { rp: usage === "rp", autoriser_cloture_pea: !!p.autoriser_cloture_pea };
      let apport;
      if (p.apport === "max") {
        const sv = V.slice(off, off + B), sb = Bs.slice(off, off + B), sa = abat[i], savedSrcs = srcs, savedImp = impotsMois;
        srcs = [];
        retirer(i, t, 1e15, Object.assign({ niveau_max: 4, exclure_indisponibles: true }, flags), matelasNom);
        apport = Math.min(cout, srcs.reduce((a, y) => a + y.net, 0));
        M.comps.filter(c => c.v0 > 0 && !c.dispo && c.prep.indisponible).forEach(c => { const m = "achat « " + e.libelle + " » : « " + c.enveloppe + " » n'est pas comptée dans l'apport, son impôt de sortie est inconnu"; if (!M.avertissements.includes(m)) M.avertissements.push(m); });
        V.set(sv, off); Bs.set(sb, off); abat[i] = sa; srcs = savedSrcs; impotsMois = savedImp;
      } else apport = Math.min(cout, O.n0(p.apport) * f * inflT);
      const emprunt = Math.max(0, cout - apport), n = Math.round(O.n0(pret.duree_ans) * 12);
      const ech = emprunt > 0 ? C.echeance(emprunt, taux, n) : 0, assM = emprunt * ass / 100 / 12;
      /* dette et mensualités du nouveau crédit */
      if (emprunt > 0) {
        const am = C.amortissement({ capital: emprunt, taux_pct: taux, duree_mois: n, assurance_pct: ass });
        M.detteNew[t] += emprunt;
        for (let k = 1; k <= n && t + k <= N + 1; k++) M.detteNew[t + k] += am[k - 1].crd;
      }
      /* loyer remplacé : ligne « loyer » du budget à défaut */
      let loyerRemplace = O.estNombre(p.loyer_remplace) ? +p.loyer_remplace : null;
      if (loyerRemplace == null && usage === "rp") {
        const L = liste(objet(M.data.budget).lignes).filter(l => l && l.type === "depense" && /loyer/i.test(String(l.libelle || "")));
        loyerRemplace = sum(L, l => Plan.mensuel(l) * Calc.partCredit(M.options.perimetre, l.owner === "p1" || l.owner === "p2" ? l.owner : "commun")) / (M.options.perimetre === "foyer" ? 1 : 1);
        if (L.length) M.avertissements.push("achat « " + e.libelle + " » : loyer remplacé pris dans ton budget (" + eur(loyerRemplace) + ")");
      }
      const reel = (usage === "rp" ? (loyerRemplace || 0) * (O.estNombre(p.loyer_remplace) ? f : 1) : 0) - O.n0(p.charges_mensuelles) * f + (usage === "locatif" ? O.n0(p.loyer_percu) * f : 0);
      const mens = ech + assM;
      M.addComposant({ id: e.id, evenement_id: e.id, type: "achat_immobilier", libelle: e.libelle, t0: t + 1, t1: emprunt > 0 ? Math.min(N + 1, t + n + 1) : N + 1, reel, nom: -mens,
        raison: minuscule1(e.libelle) + " : mensualité −" + eur(mens, 2) + "/mois, charges −" + eur(O.n0(p.charges_mensuelles) * f) + (usage === "rp" && loyerRemplace ? ", loyer remplacé +" + eur(loyerRemplace * (O.estNombre(p.loyer_remplace) ? f : 1)) : ""), raisonFin: "fin du crédit de " + minuscule1(e.libelle) });
      if (emprunt > 0 && t + n + 1 <= N && reel !== 0) M.addComposant({ id: e.id + ":apres", evenement_id: e.id, type: "achat_immobilier", libelle: e.libelle, t0: t + n + 1, t1: N + 1, reel, raison: null, raisonFin: null });
      const a = { evenement_id: e.id, id: e.id, t, date: dates[t], usage, prix, frais_acquisition: fraisAcq, apport, emprunt, taux_pct: taux, assurance_pct: ass, duree_mois: n,
        mensualite: mens, echeance_hors_assurance: ech, assurance_mensuelle: assM, premiere_echeance_t: t + 1, charges: O.n0(p.charges_mensuelles) * f, loyer_remplace: loyerRemplace, apport_sources: [], impots: 0 };
      M.achats.push(a);
      M.jalons.push({ id: "ev:" + e.id, date: e.date, type: "achat_immobilier", titre: e.libelle, icone: "maison", source: "evenement", evenement_id: e.id, effet: { texte: "", montants: {} }, achat: a });
      return a;
    }

    /* ---- sortie ---- */
    return { P, B, N, graine, apport: apportRes, centiles, existant: exis, ecart, probEcart, manque, objCompte, objMois, retenir, trace: tr, V, Vx, Bs, vue, infl, groupes: groupes.length, needPairs: needPair.reduce((a, x) => a + x, 0),
      rendement: rend ? { cum: cumLog, annee: anLog } : null };
  }

  /* ================================================================== résultats */
  const AUTRES_BIENS = v => "Tes biens d'usage et d'entreprise (" + eur(v) + ") sont comptés dans le patrimoine net, à valeur constante en euros d'aujourd'hui : aucune dépréciation ni rendement supposé.";
  /** « 8 chances sur 10 » ; dès 95 %, « plus de 9 chances sur 10 » (jamais « 10 chances sur 10 » : rien n'est certain) ; sous 5 %, « moins de 1 chance sur 10 ». */
  function texteProbabilite(p) {
    const n = Math.round(p * 10);
    if (p >= 0.95) return "plus de 9 chances sur 10";
    if (n <= 0) return "moins de 1 chance sur 10";
    return n + (n === 1 ? " chance" : " chances") + " sur 10";
  }
  /** « 120 k€ », « 1,2 M€ » à deux chiffres significatifs, espaces simples. */
  function kEur(x) {
    const a = Math.abs(x), s = x < 0 ? "−" : "";
    if (a >= 1e6) return s + frc(Math.round(a / 1e5) / 10, 1) + " M€";
    if (a >= 1000) { const k = a / 1000, d = k >= 100 ? 10 : k >= 10 ? 1 : 0.1; return s + frc(Math.round(k / d) * d, k >= 10 ? 0 : 1) + " k€"; }
    return s + frc(Math.round(a)) + " €";
  }
  const cleMoisFin = (M, t) => M.dates[t];

  /** Passe déterministe (un chemin, z = 0) : construit les achats, les composants et les séries de référence. Mémorisée dans le modèle. */
  function assurerDet(M) {
    if (M.det) return M.det;
    const run = derouler(M, { P: 1, det: true, plan: true, trace: true, vue: M.options.vue, couches: true, net_impots: false });
    M.det = { run, tr: run.trace };
    M.planFait = true;
    return M.det;
  }
  const echelle = (M, euros, infl) => t => (euros === "courants" ? 1 : 1 / (infl || M.infl)[t]);
  const versArray = (f, N, k) => { const out = new Array(N + 1); for (let t = 0; t <= N; t++) out[t] = f(t, k); return out; };

  /** Découpe la capacité mensuelle (€ d'aujourd'hui) en périodes constantes, chacune avec sa raison et sa source (spec § 6.7). */
  function capaciteParPeriode(M, tr) {
    const N = M.N, comp = M.composants, out = [];
    const sig = t => comp.filter(c => c.t0 <= t && t < c.t1).map(c => c.id).join("|");
    const cb = M.capacite_base;
    const baseTxt = cb.source === "reel" ? "capacité constatée (" + cb.constatee_detail.mois + " mois)" : cb.source === "montant" ? "capacité fixée à " + eur(cb.retenue) + " par mois" : cb.prevue_source === "cible" ? "capacité prévue par " + cb.prevue_libelle : "capacité prévue au budget";
    let debut = 1, signature = sig(1);
    const fermer = (fin, raison, source, evId, finsTxt) => {
      const t = debut, montant = tr.cap[t] / M.infl[t];
      out.push({ debut_t: debut, fin_t: fin, debut: M.dates[debut], fin: M.dates[fin], montant_mensuel: montant, raison, raisons_fin: finsTxt || [], source, evenement_id: evId || null });
    };
    let raisonsFin = [], raison = baseTxt, source = cb.source === "reel" ? "constatee" : cb.source === "montant" ? "montant" : "prevue", evId = null;
    for (let t = 2; t <= N; t++) {
      const s = sig(t);
      if (s === signature) continue;
      fermer(t - 1, raison, source, evId, raisonsFin);
      debut = t; signature = s;
      const debuts = comp.filter(c => c.t0 === t && c.raison), fins = comp.filter(c => c.t1 === t && c.raisonFin);
      const textes = debuts.length ? debuts.map(c => c.raison) : fins.map(c => c.raisonFin);
      raison = textes.length ? textes.join(" ; ") : "évolution des revenus et des dépenses";
      raisonsFin = debuts.length ? fins.map(c => c.raisonFin) : [];
      const prem = debuts[0] || fins[0];
      source = prem ? (prem.type === "credit" ? "credit" : "evenement") : "evenement";
      evId = prem ? prem.evenement_id || null : null;
    }
    fermer(N, raison, source, evId, raisonsFin);
    return out;
  }

  /** Décomposition du patrimoine à chaque anniversaire, sur le chemin déterministe, en euros d'aujourd'hui (spec § 6.8). */
  function decomposer(M, tr) {
    const N = M.N, out = [];
    let vers = 0, gains = 0, frais = 0, impots = 0;
    const D = t => 1 / M.infl[t];
    for (let t = 1; t <= N; t++) {
      vers += tr.flux[t] * D(t); gains += tr.gain[t] * D(t); frais += tr.frais[t] * D(t); impots += tr.impots[t] * D(t);
      if (t % 12 === 0 || t === N) {
        const total = tr.fin[t] * D(t), depart = tr.fin[0];
        const ligne = { date: M.dates[t], t, depart, versements: vers, marches: total - depart - vers + frais + impots, frais, impots, total };
        if (M.options.vue === "net") ligne.biens_dettes = (tr.net[t] - tr.fin[t]) * D(t) - (tr.net[0] - tr.fin[0]);
        out.push(ligne);
      }
    }
    return out;
  }

  /** Rendement attendu (% par an, nominal, net de frais) d'un ensemble de compartiments préparés, pondéré par leur valeur d'aujourd'hui. */
  function rendementAttendu(compartiments) {
    const L = liste(compartiments).filter(c => c && c.v0 > 0), v = sum(L, c => c.v0);
    return v > 0 ? sum(L, c => c.v0 * c.attendu_net_pct) / v : 0;
  }

  /** Hypothèses de rendement lues par le moteur pour comparer le réel au modèle : rendement central et volatilité de chaque classe (celles du calcul : surcharges de variante comprises),
      rendement attendu net de frais (celui du calcul : exp(12 a) × (1 − frais) − 1 par compartiment) et frais moyens des placements (comptes courants exclus, pondérés par la valeur d'aujourd'hui).
      La lecture des repères n'est pas consignée (la liste « hypothèses » reste celle du calcul). */
  function infosRendement(M, comps, pcCentral) {
    const L = comps.filter(c => c && c.type !== "courant" && c.v0 > 0), v = sum(L, c => c.v0);
    const classes = {};
    Marche.CLES.filter(k => k !== "levier").forEach(k => { const p = pcCentral(k); classes[k] = { rendement: p.rendement, volatilite: p.volatilite }; });
    classes.courant = { rendement: 0, volatilite: 0 };
    const lev = L.find(c => c.classe === "levier");
    if (lev) classes.levier = { rendement: lev.attendu_pct, volatilite: lev.s * Math.sqrt(12) * 100 };
    const net = c => (Math.exp(12 * c.a) * (1 - c.feeAnn) - 1) * 100;
    return { disponible: v > 0, classes, nominal_pct: v > 0 ? sum(L, c => c.v0 * net(c)) / v : null, frais_pct: v > 0 ? sum(L, c => c.v0 * c.feeAnn) / v * 100 : null };
  }
  /** Rendement annualisé des placements (TWR) : centiles par mois (cumulé et annualisé) et par année, en nominal et en euros d'aujourd'hui (réel), plus le rendement attendu de l'allocation
      actuelle. Net de frais (la croissance des compartiments les contient), avant impôts, sans l'effet des versements ni des retraits, comptes courants exclus. Pourcentages. */
  function rendementDe(M, run) {
    const info = M.rendementInfo, N = M.N, H = M.horizon, pi = M.pi, lnPi = Math.log(1 + pi);
    const nul = { p10: null, p25: null, p50: null, p75: null, p90: null };
    const base = { methode: "twr_net_de_frais", unite: "pct_par_an", avant_impots: true, perimetre: "placements (livrets, assurance-vie, PEA, compte-titres…), comptes courants exclus",
      inflation_pct: pi * 100, mois: M.dates.slice(0, N + 1), classes: info.classes };
    if (!info.disponible || !run.rendement) {
      return Object.assign(base, { disponible: false, raison: "aucun placement à mesurer (les comptes courants ne sont pas des placements)", attendu: { nominal_pct: null, reel_pct: null, frais_pct: null },
        horizon: { ans: H, nominal: nul, reel: nul }, cumule: null, annualise: null, par_annee: null });
    }
    const R = run.rendement, tab = (f, n) => { const o = {}; NOMS_P.forEach(k => { o[k] = f(k); }); void n; return o; };
    const lnInfl = t => t * lnPi / 12;
    const cumule = { nominal: tab(k => versArray(t => (Math.exp(R.cum[k][t]) - 1) * 100, N)), reel: tab(k => versArray(t => (Math.exp(R.cum[k][t] - lnInfl(t)) - 1) * 100, N)) };
    const annualise = { nominal: tab(k => versArray(t => (t > 0 ? (Math.exp(R.cum[k][t] * 12 / t) - 1) * 100 : null), N)), reel: tab(k => versArray(t => (t > 0 ? (Math.exp((R.cum[k][t] - lnInfl(t)) * 12 / t) - 1) * 100 : null), N)) };
    const horizon = { ans: H, nominal: tab(k => annualise.nominal[k][N]), reel: tab(k => annualise.reel[k][N]) };
    const annees = Array.from({ length: H }, (_, i) => i + 1);
    const parAnnee = { annees, dates: annees.map(y => M.dates[12 * y]), nominal: tab(k => annees.map(y => (Math.exp(R.annee[k][y]) - 1) * 100)), reel: tab(k => annees.map(y => (Math.exp(R.annee[k][y] - lnPi) - 1) * 100)) };
    return Object.assign(base, { disponible: true, attendu: { nominal_pct: info.nominal_pct, reel_pct: ((1 + info.nominal_pct / 100) / (1 + pi) - 1) * 100, frais_pct: info.frais_pct },
      horizon, cumule, annualise, par_annee: parAnnee });
  }

  /** Garde-fous de vraisemblance (spec § 6.8). */
  function garde_fous(M, run, tr, cap) {
    const out = [], cb = M.capacite_base, rv = M.ctx.rv, N = M.N;
    if (cb.signale && cb.source === "reel") {
      out.push({ cle: "ecart_capacite", niveau: "info", valeurs: { constatee: cb.constatee, prevue: cb.prevue, programmee: cb.programmee, periode: cb.periode },
        texte: "Ta capacité d'épargne constatée sur tes comptes est de " + eur(cb.constatee) + " par mois" + (cb.periode ? " (" + cb.periode + ")" : "") + ", contre " + eur(cb.prevue) +
          " prévus par " + (cb.prevue_libelle || "ton budget") + (cb.programmee > 0 ? " et " + eur(cb.programmee) + " de versements programmés" : "") + " : la projection part de la capacité constatée." });
    }
    if (cb.constatee != null && cb.source !== "reel") {
      const moy = sum(Array.from({ length: Math.min(12, N) }, (_, k) => k + 1), t => tr.cap[t] / M.infl[t]) / Math.min(12, N);
      if (moy > cb.constatee + Math.max(100, 0.3 * Math.abs(cb.constatee))) {
        out.push({ cle: "versements_superieurs_capacite_constatee", niveau: "alerte", valeurs: { projetee: moy, constatee: cb.constatee, periode: cb.periode },
          texte: "La projection suppose " + eur(moy) + " d'épargne par mois ; tes comptes montrent " + eur(cb.constatee) + " par mois" + (cb.periode ? " (" + cb.periode + ")" : "") + "." });
      }
    }
    const marge = rv("garde_fou_rendement_marge"), croiss = rv("garde_fou_croissance_annuelle");
    let croissanceDejaCouverte = false; /* l'alerte du rendement implicite couvre déjà une croissance trop forte due aux hypothèses modifiées (cas G-3) */
    if (M.hypotheses_modifiees && marge !== undefined && N >= 12) {
      const T = Math.min(5, M.horizon), t = 12 * T, v0 = tr.fin[0];
      if (v0 > 0 && tr.finX[t] > 0) {
        const implicite = (Math.pow(tr.finX[t] / v0, 1 / T) - 1) * 100, attendu = rendementAttendu(M.comps);
        if (implicite > attendu + marge) {
          croissanceDejaCouverte = true;
          out.push({ cle: "rendement_implicite", niveau: "alerte", valeurs: { implicite, attendu },
            texte: "Avec ces hypothèses, ton patrimoine actuel rapporterait " + frc(implicite, 1) + " % par an en médiane, contre " + frc(attendu, 1) + " % attendus pour ton profil : hypothèse très optimiste." });
        }
      }
    }
    if (croiss !== undefined && N >= 60 && !croissanceDejaCouverte) {
      let versements = 0;
      for (let t = 1; t <= 60; t++) versements += Math.max(0, tr.cap[t]);
      /* même vue des deux côtés : le patrimoine financier du scénario central (tr.fin), jamais la vue affichée (net avec la résidence et les dettes, ou après impôts) */
      const ratio = tr.fin[60] / (tr.fin[0] + versements), borne = Math.pow(1 + croiss / 100, 5);
      if (tr.fin[0] + versements > 0 && ratio > borne) {
        out.push({ cle: "croissance_5_ans", niveau: "alerte", valeurs: { ratio, borne },
          texte: "Plus de " + frc(croiss) + " % par an sur 5 ans dans ton scénario central : hypothèse très optimiste." });
      }
    }
    return out;
  }

  /** Données utiles et présentes (spec § 6.6) : couverture et liste « à compléter ». */
  function evaluerCouverture(M) {
    const items = [], manquants = [];
    const compte = (cle, present, titre, effet, phrase) => { items.push({ cle, present }); if (!present) manquants.push({ cle, titre, effet, phrase_claude: phrase }); };
    const vus = new Set();
    M.comps.filter(c => !c.dispo && c.v0 > 0 && c.type !== "autre").forEach(c => {
      const k = "prix_revient:" + c.enveloppe;
      if (!vus.has(k)) { vus.add(k); compte(k, !c.base_inconnue, "Prix de revient de « " + c.enveloppe + " »", "sans lui, l'impôt à la sortie est sous-estimé", "Aide-moi à renseigner le prix de revient (ou les versements cumulés) de « " + c.enveloppe + " »."); }
    });
    M.comps.filter(c => ["pea", "pea_pme", "pea_jeune", "assurance_vie", "capitalisation"].includes(c.type) && c.v0 > 0).forEach(c => {
      const k = "date_ouverture:" + c.cle;
      if (!vus.has(k)) { vus.add(k); compte(k, !!c.prep.seuil, "Date d'ouverture de « " + c.enveloppe + " »", "sans elle, la règle fiscale la plus prudente est appliquée", "Aide-moi à renseigner la date d'ouverture de « " + c.enveloppe + " »."); }
    });
    M.credits.forEach(c => compte("taux:" + c.cle, !c.taux_suppose, "Taux du crédit « " + c.nom + " »", "sans lui, un taux moyen est supposé", "Aide-moi à renseigner le taux et la date de fin de « " + c.nom + " »."));
    M.manques.frais_enveloppe.forEach(nom => compte("frais:" + nom, false, "Frais de l'enveloppe « " + nom + " »", "sans eux, la projection est un peu optimiste", "Aide-moi à renseigner les frais de « " + nom + " »."));
    M.biensTaxables.forEach(b => compte("bien:" + b.id, b.prix_achat != null, "Prix d'achat de « " + b.nom + " »", "sans lui, la plus-value n'est pas calculée", "Aide-moi à renseigner le prix et la date d'achat de « " + b.nom + " »."));
    if (M.comps.some(c => c.type === "per" && c.v0 > 0)) compte("tmi", M.reglages.tmi_pct != null, "Ton taux marginal d'imposition", "sans lui, 30 % sont supposés pour le PER", "Aide-moi à renseigner mon taux marginal d'imposition.");
    const cb = M.capacite_base;
    compte("capacite", cb.source !== "prevu" || cb.revenus_prevus > 0, "Tes revenus et dépenses", "sans eux, la capacité d'épargne est inconnue", "Aide-moi à compléter mes revenus et mes dépenses.");
    const presents = items.filter(i => i.present).length;
    return { couverture: items.length ? presents / items.length : 1, a_completer: manquants, n_utiles: items.length, n_presentes: presents };
  }

  /** Hypothèses utilisées, avec leur source et leur statut. */
  function lister(M) {
    const out = [], today = M.today;
    M.ctx.utilises.forEach((r, cle) => {
      let statut = "ok";
      if (r.dateFin && r.dateFin < today) statut = "a_actualiser";
      else if (!r.verifieLe || (Date.parse(today) - Date.parse(r.verifieLe)) / 864e5 > 180) statut = "a_verifier";
      else if (/convention/i.test(r.libelle || "")) statut = "convention";
      out.push({ cle, libelle: r.libelle || cle, valeur: +r.valeur, unite: r.unite, source_titre: r.sourceTitre || null, source_url: r.sourceUrl || null, verifie_le: r.verifieLe || null, date_effet: r.dateEffet || null, date_fin: r.dateFin || null, statut });
    });
    return out;
  }
  const CONVENTION_BIEN_CRISE = "Convention : l'immobilier physique (résidence, biens loués) subit le choc de la classe « immobilier » de la crise, mesuré sur les SCPI (IEIF), faute de série dédiée ; le prix des logements varie en réalité plus lentement.";
  function classesUtilisees(M) {
    const vus = new Map();
    M.comps.forEach(c => {
      const k = c.levier ? c.levier.sous_jacent : c.classe;
      if (c.type === "courant" || vus.has(k) || k === "courant") return;
      const p = Dn.parametresClasse(k, M.ctx), cl = Marche.CLASSES[k === "actions_nasdaq100" ? "actions" : k];
      vus.set(k, { classe: k, rendement_central: p.rendement, rendement_historique: cl ? cl.rendementLong : null, volatilite: p.volatilite, source_historique: cl ? cl.source : null,
        sous_historique: !!(cl && p.rendement < cl.rendementLong - 1e-9), repli_historique: p.repli, surcharge: p.surcharge });
    });
    if (M.bien0 > 0 || M.achats.some(x => !x.indisponible)) {
      const pb = Dn.parametresClasse("immobilier_physique", M.ctx);
      vus.set("immobilier_physique", { classe: "immobilier_physique", rendement_central: pb.rendement, rendement_historique: null, volatilite: pb.volatilite, source_historique: null, sous_historique: false,
        repli_historique: pb.repli, surcharge: pb.surcharge, convention: CONVENTION_BIEN_CRISE });
    }
    return [...vus.values()];
  }

  /** BUD1 (spec § 10.2) : premier mois où au moins 80 % des chemins ont la valeur de référence de l'objectif au-dessus de sa cible (euros constants), ou null avant
      la fin de l'horizon ; null aussi pour un objectif déjà atteint, hors de portée ou hors horizon (son statut le dit). */
  function dateAtteinte80(M, run, j, P, statut) {
    if (!run.objMois || statut === "atteint" || statut === "hors_portee") return null;
    const compteur = run.objMois[j];
    for (let t = 1; t <= M.N; t++) if (compteur[t] >= SEUIL_OBJECTIF * P - 1e-9) return M.dates[t];
    return null;
  }

  /** Simulation : Monte-Carlo (2 000 chemins, graine fixe, tirages communs) ou déterministe (volatilite: 0). → résultat de la spec § 3. */
  function simuler(M, opts) {
    const o = opts || {}, N = M.N;
    assurerDet(M);
    const vue = o.vue || M.options.vue, euros = o.euros || M.options.euros, netImp = o.net_impots != null ? !!o.net_impots : M.options.net_impots;
    const deterministe = o.volatilite === 0;
    const P = deterministe ? 1 : (o.chemins > 0 ? Math.round(o.chemins) : 2000);
    const graine = o.graine == null ? GRAINE : o.graine;
    const run = derouler(M, { P, graine, det: deterministe, trace: deterministe, vue, net_impots: netImp, couches: true, retenir: o.retenir, rend: true, datesAtteinte: !!o.dates_atteinte });
    const det = M.det.tr, fx = echelle(M, euros);
    const sortie = tab => { const r = {}; NOMS_P.forEach(k => { r[k] = versArray(t => tab[k][t] * fx(t), N); }); return r; };
    const nul = tab => { const r = {}; NOMS_P.forEach(k => { r[k] = versArray(t => (isNaN(tab[k][t]) ? null : tab[k][t] * fx(t)), N); }); return r; };
    const vues = {}; vues[vue] = sortie(run.centiles);
    const existant = nul(run.existant), futur = nul(run.ecart);
    const versCum = versArray(t => { let s = 0; for (let u = 1; u <= t; u++) s += det.flux[u] * fx(u); return s; }, N);
    futur.versements_cumules = versCum;
    futur.croissance = versArray(t => (futur.p50[t] == null ? null : futur.p50[t] - versCum[t]), N);
    const cpp = capaciteParPeriode(M, det);
    const dec = decomposer(M, det);
    const cap = deterministe ? null : run.centiles;
    const gf = garde_fous(M, run, det, cap);
    const couv = evaluerCouverture(M);
    /* objectifs */
    const objectifs = M.objs.map((ob, j) => {
      const prob = ob.t >= 1 && ob.t <= N ? run.objCompte[j] / P : null;
      let detV = null;
      if (ob.t >= 1 && ob.t <= N) detV = sum(ob.ref, b => det.valeurs[ob.t * M.B + b]) / M.infl[ob.t];
      const statut = ob.deja >= ob.cible ? "atteint" : ob.date < M.today ? "hors_portee" : prob == null ? "hors_horizon" : detV >= ob.cible * 1.1 ? "avance" : detV >= ob.cible * 0.95 ? "dans_les_temps" : "retard";
      const mot = prob == null ? null : prob >= 0.8 ? "probable" : prob >= 0.5 ? "incertain" : "peu probable";
      const res = { id: ob.id, nom: ob.nom, cible: ob.cible, date: ob.date, probabilite: prob, mot, statut, valeur_deterministe: detV };
      if (o.dates_atteinte) res.date_8_sur_10 = dateAtteinte80(M, run, j, P, statut);
      return res;
    });
    /* manquer d'argent */
    const premiers = Array.from(run.manque).filter(x => x > 0).sort((a, b) => a - b);
    const seuil10 = Math.ceil(0.1 * P - 1e-9);
    const manquer = { probabilite: premiers.length / P, date_p10: premiers.length >= seuil10 && seuil10 > 0 ? M.dates[premiers[seuil10 - 1]] : null };
    /* jalons */
    const jalons = M.jalons.map(j => {
      if (j.achat) {
        const a = j.achat, srcTxt = a.apport_sources.map(s => s.enveloppe).filter((x, k, l) => l.indexOf(x) === k).join(", ");
        return Object.assign({}, j, { effet: { texte: "apport −" + kEur(a.apport) + (srcTxt ? " pris sur " + srcTxt : "") + (a.impots > 0 ? ", impôts " + eur(a.impots) : "") + ", mensualité −" + eur(a.mensualite) + "/mois",
          montants: { apport: -a.apport, impots: a.impots, frais_acquisition: a.frais_acquisition, emprunt: a.emprunt, mensualite: -a.mensualite, sources: a.apport_sources } } });
      }
      return j;
    });
    (M.calendrier.jalons || []).filter(j => j.statut !== "passe" && j.date <= M.dates[N]).forEach(j => jalons.push({ id: "cal:" + j.id, date: j.date, type: j.cle, titre: j.titre, icone: "calendrier",
      effet: { texte: j.effet, montants: {} }, source: "calendrier", enveloppe: j.enveloppe_nom || null }));
    objectifs.forEach(ob => { if (ob.date <= M.dates[N] && ob.date >= M.today) jalons.push({ id: "objectif:" + ob.id, date: ob.date, type: "objectif", titre: ob.nom || "Objectif", icone: "drapeau",
      effet: { texte: ob.probabilite == null ? "" : "cible de " + kEur(ob.cible) + " : " + texteProbabilite(ob.probabilite), montants: { cible: ob.cible, probabilite: ob.probabilite } }, source: "objectif" }); });
    jalons.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    const avert = M.avertissements.slice();
    M.ctx.manquants.forEach((pourquoi, cle) => avert.push("repère manquant (" + cle + ") : " + pourquoi));
    M.comps.filter(c => c.v0 > 0 && !c.dispo && c.prep.indisponible).forEach(c => avert.push("impôt de sortie de « " + c.enveloppe + " » non calculé (" + (c.prep.mentions[0] || "règle indisponible") + ") : ses retraits et sa valeur nette sont comptés sans impôt"));
    if (vue === "net" && M.autres0 > 0) avert.push(AUTRES_BIENS(M.autres0));
    if (M.plafondDepasse) avert.push("le plafond de versements du PEA est dépassé : les versements suivants y sont maintenus faute d'autre enveloppe ouverte");
    const resume = vueTitre(M, vues[vue], euros, vue, couv.couverture, existant, futur);
    const retroRes = retroDuModele(M, o);
    return {
      version_modele: versionModele, graine, chemins: P, deterministe, today: M.today, mois: M.dates.slice(0, N + 1), euros, vue, net_impots: netImp, horizon_ans: M.horizon,
      vues, objectifs, manquer_argent: manquer, jalons, phrase: resume.phrase, decomposition_phrase: resume.decomposition, capacite_source: M.capacite_base.source, capacite_periode: M.capacite_base.periode,
      rendement: Object.assign(rendementDe(M, run), { euros }),
      hypotheses: lister(M), hypotheses_classes: classesUtilisees(M), a_completer: couv.a_completer, couverture: couv.couverture, avertissements: avert,
      existant, epargne_future: futur, capacite_base: M.capacite_base, capacite_par_periode: cpp, decomposition: dec, garde_fous: gf,
      evenements_pris_en_compte: M.evenements_pris_en_compte.slice(), question_evenements: M.evenements_pris_en_compte.length ? null : "Aucun événement renseigné — as-tu des changements prévus ? Un enfant, un changement d'emploi, un déménagement, un achat ?",
      chemins_retenus: o.retenir ? run.retenir : undefined, retro: retroRes.retro, retro_raison: retroRes.retro_raison, achats: M.achats.map(a => Object.assign({}, a)), retraits: M.retraits.slice(),
      deterministe_detail: { courants: { financier: Array.from(det.fin), disponible: Array.from(det.dispo), net: Array.from(det.net) },
        constants: { financier: Array.from(det.fin, (x, t) => x / M.infl[t]), disponible: Array.from(det.dispo, (x, t) => x / M.infl[t]), net: Array.from(det.net, (x, t) => x / M.infl[t]) },
        capacite_nominale: Array.from(det.cap), valeurs_par_compartiment: det.valeurs, retraits_detail: det.retraits, compartiments: M.comps.map(c => ({ id: c.id, enveloppe: c.enveloppe, type: c.type, classe: c.classe })) },
    };
  }
  function vueTitre(M, v, euros, vue, couverture, existant, futur) {
    const N = M.N, T = M.horizon, p50 = v.p50, f = euros === "courants" ? "" : ", en euros d'aujourd'hui";
    const v0 = p50[0], prov = couverture < 0.6 ? " (provisoire)" : "";
    const phrase = "Aujourd'hui : " + kEur(v0) + " · dans " + T + " an" + (T > 1 ? "s" : "") + " : médiane " + kEur(p50[N]) + " (" + kEur(v.p10[N]) + " à " + kEur(v.p90[N]) + ")" + f + prov + ".";
    let decomposition = null;
    if (existant.p50[N] != null && futur.p50[N] != null) decomposition = "Dont " + kEur(existant.p50[N]) + " de ton patrimoine actuel et " + kEur(futur.p50[N]) + " de ton épargne future et de tes projets.";
    return { phrase, decomposition };
  }

  /** Crise rejouée à une date choisie : un seul chemin, rendements attendus sauf pendant la fenêtre de la crise (spec § 4.6). opts : { cle, debut (mois ≥ 1 ou date) }. */
  function crise(M, opts) {
    const o = opts || {}, cr = Marche.CRISES[o.cle];
    if (!cr) return { indisponible: true, avertissements: ["crise inconnue : « " + o.cle + " »"] };
    assurerDet(M);
    const duree = Math.max(1, O.moisEntre(cr.debut + "-01", cr.fin + "-01"));
    /* début : mois (entier de 1 à N) ou date de aujourd'hui à la fin de l'horizon ; absent : dans un an (ou le dernier mois) ; jamais ramené au mois 1 en silence */
    const dd = o.debut_t != null ? o.debut_t : o.debut;
    let t0;
    if (dd === undefined) t0 = Math.min(13, M.N);
    else if (typeof dd === "number") t0 = Number.isInteger(dd) ? dd : null;
    else if (typeof dd === "string" && O.estDate(dd) && dd >= M.today) t0 = O.moisDe(M.today, dd, M.N);
    else t0 = null;
    if (t0 == null || t0 < 1 || t0 > M.N) {
      const fr = x => x.slice(8, 10) + "/" + x.slice(5, 7) + "/" + x.slice(0, 4);
      return { indisponible: true, avertissements: ["date de début de la crise absente ou hors de l'horizon : choisis une date entre le " + fr(M.today) + " et le " + fr(M.dates[M.N]) + "."] };
    }
    const infl = Float64Array.from(M.infl);
    const avert = [];
    if (o.cle === "inflation_1973") {
      const a = M.ctx.rv("inflation_fr_1973"), b = M.ctx.rv("inflation_fr_1974");
      if (a === undefined || b === undefined) return { indisponible: true, avertissements: ["scénario indisponible : repères d'inflation de 1973 et 1974 manquants"] };
      for (let t = 1; t < infl.length; t++) {
        const dansFenetre = t >= t0 && t < t0 + duree;
        const taux = dansFenetre ? (t - t0 < 12 ? a : b) / 100 : M.pi;
        infl[t] = infl[t - 1] * Math.pow(1 + taux, 1 / 12);
      }
    }
    const run = derouler(M, { P: 1, det: true, trace: true, vue: M.options.vue, infl, crise: { t0, t1: t0 + duree, duree, chocs: cr.chocs } });
    const tr = run.trace, euros = M.options.euros, fx = echelle(M, euros, infl);
    avert.push("Après la crise, la projection reprend les rendements moyens ; dans l'histoire, les marchés sont remontés plus vite.");
    if (M.bien0 > 0 || M.achats.some(x => !x.indisponible)) avert.push(CONVENTION_BIEN_CRISE);
    return { cle: o.cle, label: cr.label, debut_t: t0, debut: M.dates[t0], fenetre_mois: duree, mois: M.dates.slice(0, M.N + 1), euros, version_modele: versionModele,
      valeurs: { financier: versArray(t => tr.fin[t] * fx(t), M.N), disponible: versArray(t => tr.dispo[t] * fx(t), M.N), net: versArray(t => tr.net[t] * fx(t), M.N) },
      nominal: { financier: Array.from(tr.fin), net: Array.from(tr.net) }, log_rendement_mensuel_fenetre: Math.log(1 + (cr.chocs.actions) / 100) / duree, avertissements: avert, source: cr.source };
  }

  /** Comparaison de deux modèles sur les mêmes tirages : écart chemin par chemin, centiles de l'écart, probabilité que B fasse mieux que A. */
  function comparer(MA, MB, opts) {
    const o = opts || {};
    if (MA.N !== MB.N) return { erreur: "les deux modèles n'ont pas le même horizon" };
    assurerDet(MA); assurerDet(MB);
    const P = o.chemins > 0 ? Math.round(o.chemins) : 2000, N = MA.N, vue = o.vue || MA.options.vue, graine = o.graine == null ? GRAINE : o.graine;
    const marques = []; for (let t = 12; t <= N; t += 12) marques.push(t); if (marques[marques.length - 1] !== N) marques.push(N);
    const a = derouler(MA, { P, graine, vue, retenir: marques }), b = derouler(MB, { P, graine, vue, retenir: marques });
    const euros = o.euros || MA.options.euros, fx = echelle(MA, euros), rg = rangs(P);
    const ecarts = {}; NOMS_P.forEach(k => { ecarts[k] = []; });
    const probMieux = [], chaque = [];
    marques.forEach(t => {
      const d = new Float64Array(P);
      let mieux = 0, plancher = Infinity;
      for (let i = 0; i < P; i++) { d[i] = b.retenir[t][i] - a.retenir[t][i]; if (d[i] > 0) mieux++; if (d[i] < plancher) plancher = d[i]; }
      d.sort();
      NOMS_P.forEach((k, j) => ecarts[k].push(d[rg[j]] * fx(t)));
      probMieux.push(mieux / P); chaque.push(plancher >= -1e-9);
    });
    const dernier = marques.length - 1;
    return { version_modele: versionModele, graine, chemins: P, vue, euros, mois: marques.map(t => MA.dates[t]), ecarts, probabilite_mieux: probMieux, chaque_chemin_superieur_ou_egal: chaque,
      horizon: { mediane_des_ecarts: ecarts.p50[dernier], probabilite_mieux: probMieux[dernier], p10: ecarts.p10[dernier], p90: ecarts.p90[dernier] } };
  }

  /** Valeur capitalisée après `mois` mois : capital de départ et versements de fin de mois, taux annuel géométrique en % (primitive pure, partagée). */
  function capitaliser(v0, versement, mois, tauxPct) { return Plan.valeurFuture(v0, versement, mois, tauxPct); }

  /* ================================================================== tirages, corrélations, rétro-contrôle */
  /** Normales corrélées des 12 classes tirées pour `chemins` chemins et `mois` mois (mêmes tirages que le moteur) : { classe: Float64Array(chemins × mois) },
      indexées chemin × mois + (t − 1). `classes` limite les classes rendues (les 12 sont toujours tirées : nombres aléatoires communs). */
  function tirages(opts) {
    const o = opts || {}, P = o.chemins || 2000, T = o.mois || 120, graine = o.graine == null ? GRAINE : o.graine, K = NB_TIRAGES, L = Dn.choleskyTirees().L;
    const st = new Uint32Array(4 * P), eps = new Float64Array(K), voulues = (o.classes || CLASSES_TIREES).filter(k => IDX[k] != null);
    const out = {}; voulues.forEach(k => { out[k] = new Float64Array(P * T); });
    for (let i = 0; i < P; i++) O.initialiserEtat(st, i, graine);
    for (let t = 0; t < T; t++) for (let i = 0; i < P; i++) {
      for (let q = 0; q < 6; q++) {
        const u1 = O.uniforme(st, 4 * i), u2 = O.uniforme(st, 4 * i), r = Math.sqrt(-2 * Math.log(u1)), c = Math.cos(DEUX_PI * u2), sn = Math.sqrt(1 - c * c);
        eps[2 * q] = r * c; eps[2 * q + 1] = u2 < 0.5 ? r * sn : -r * sn;
      }
      voulues.forEach(k => { const kk = IDX[k]; let s = 0; for (let j = 0; j <= kk; j++) s += L[kk * K + j] * eps[j]; out[k][i * T + t] = s; });
    }
    return out;
  }
  /** Matrice de corrélation des classes tirées : classes, matrice, plus petite valeur propre, correction éventuelle (Higham). */
  function correlations() {
    const A = Dn.matriceTirees(), ch = Dn.choleskyTirees();
    return { classes: CLASSES_TIREES.slice(), matrice: A, plus_petite_valeur_propre: O.valeursPropres(A)[0], correction: ch.correction };
  }
  /** Couverture des bandes par la valeur réelle (spec § 6.9) : origines = [{ p10, p25, p50, p75, p90, realise }], bornes incluses.
      opts : { min (nombre minimal de dates), reperes }. → { n, dans_p10_p90, taux_p10_p90, dans_p25_p75, taux_p25_p75, sous_p10, au_dessus_p90, affichable, attendu_p10_p90 }. */
  function couverture(origines, opts) {
    const o = opts || {}, L = liste(origines), n = L.length;
    const dans = (x, a, b) => x >= a && x <= b;
    const c1 = L.filter(x => dans(x.realise, x.p10, x.p90)).length, c2 = L.filter(x => dans(x.realise, x.p25, x.p75)).length;
    let min = O.estNombre(o.min) ? +o.min : null;
    if (min == null) { const r = O.indexReperes(o.reperes).retro_min_origines; min = r ? +r.valeur : null; }
    return { n, dans_p10_p90: c1, taux_p10_p90: n ? c1 / n : null, dans_p25_p75: c2, taux_p25_p75: n ? c2 / n : null, sous_p10: L.filter(x => x.realise < x.p10).length,
      au_dessus_p90: L.filter(x => x.realise > x.p90).length, affichable: min != null && n >= min, minimum: min, attendu_p10_p90: 0.8, attendu_p25_p75: 0.5 };
  }
  /** Phrase du rétro-contrôle pour « Comment c'est calculé » (spec § 6.9). */
  function phraseRetro(c) {
    if (!c || !c.affichable) return "Pas encore assez d'historique pour vérifier la projection.";
    const sur10 = c.taux_p10_p90 >= 0.95 ? "plus de 9" : Math.round(c.taux_p10_p90 * 10) <= 0 ? "moins d'une" : String(Math.round(c.taux_p10_p90 * 10)); // jamais « 10 fois sur 10 » : rien n'est certain
    let t = "Rejouée depuis " + c.n + " dates passées, la projection à 1 an a encadré la valeur réelle " + sur10 + " fois sur 10 (attendu : 8 sur 10). Les dates se chevauchent : c'est indicatif.";
    if (c.taux_p10_p90 < 0.65) t += " Les bandes ont été trop étroites sur ton historique.";
    return t;
  }
  /** Rétro-contrôle : rejoue le moteur depuis des dates passées de l'historique et compare les bandes à la valeur réelle 12 mois plus tard.
      historique = { points: [{ date, byBloc?, net }] } (sortie de Historique.fusionner, photos observées avec leur composition par poche) ; opts : { horizon_mois (12),
      chemins (2000), flux: [{ date, montant }] (versements nets observés), reperes, classes }. Seules les photos avec composition servent d'origine. */
  function retroControle(data, historique, opts) {
    const o = opts || {}, h = o.horizon_mois || 12, P = o.chemins || 2000, d = data || {};
    const pts = liste(objet(historique).points).filter(p => p && O.estDate(p.date) && p.byBloc && Object.keys(p.byBloc).length).sort((a, b) => (a.date < b.date ? -1 : 1));
    const flux = liste(o.flux), origines = [];
    /* dates de départ = fins de mois (la dernière photo de chaque mois) : des photos de la nuit rapprochées ne seraient qu'une seule date, répétée */
    const departs = [...new Map(pts.map(p => [p.date.slice(0, 7), p])).values()];
    for (const p of departs) {
      const fin = O.ajouterMois(p.date, h);
      const cible = pts.filter(q => Math.abs(O.joursEntre(q.date, fin)) <= 20).sort((a, b) => Math.abs(O.joursEntre(a.date, fin)) - Math.abs(O.joursEntre(b.date, fin)))[0];
      if (!cible) continue;
      const realise = sum(Object.values(cible.byBloc), x => O.n0(x));
      const positions = Object.keys(p.byBloc).map((bloc, k) => ({ id: "r" + k, name: bloc, envelope: "Rétro-contrôle", owner: "commun", bloc, mode: "manual", value: O.n0(p.byBloc[bloc]), status: "actif" }));
      const apport = sum(flux.filter(f => f.date > p.date && f.date <= fin), f => O.n0(f.montant));
      const entree = { today: p.date, positions, instruments: [], config: { enveloppes_infos: {}, cushion: { mode: "amount", min: 0 }, projection: { reste_capacite: "disponible", salaire_croissance_reelle_pct: 0 } },
        profil: { foyer: { adultes: 1 }, personnes: {}, credits: [], biens: [] }, credits: [], biens: [], budget: { lignes: [] }, banque: null, objectifs: [], foyer: { evenements: [], variantes: [] },
        reperes: d.reperes, classes: o.classes || d.classes };
      const M = preparer(entree, { horizon_ans: Math.max(1, Math.ceil(h / 12)), vue: "financier", capacite_mensuelle: apport / h, euros: "courants" });
      const run = derouler(M, { P, graine: o.graine, vue: "financier", trace: false });
      const t = Math.min(h, M.N);
      origines.push({ date: p.date, fin, p10: run.centiles.p10[t], p25: run.centiles.p25[t], p50: run.centiles.p50[t], p75: run.centiles.p75[t], p90: run.centiles.p90[t], realise, apport });
    }
    const c = couverture(origines, { reperes: d.reperes, min: o.min });
    return { origines, couverture: c, phrase: phraseRetro(c) };
  }

  /** Rétro-contrôle du résultat d'une projection (spec § 6.9, décision 15) : { retro, retro_raison }. L'historique est celui de `data.historique`
      (Dn.historiquePourRetro : une photo par mois avec sa composition, flux observés) ; le modèle de marché est celui des repères et des classes de `data`.
      `retro` n'est donné que s'il y a au moins `retro_min_origines` (24) dates de départ avec une valeur réelle 12 mois plus tard ; sinon null et la raison est
      dite. Indépendant du scénario (événements, variante) : mis en cache par empreinte de l'historique et du modèle de marché. */
  const retroCache = new Map();
  const LIMITES_RETRO = ["Les périodes de 12 mois se chevauchent : les résultats ne sont pas indépendants, c'est indicatif.",
    "L'historique est court et sa composition par poche vient des photos de Boussole ; avant la première photo, rien n'est reconstitué.",
    "Seuls les versements et retraits enregistrés sont comptés comme flux ; un salaire versé sur un compte suivi n'en est pas un."];
  function retroDuModele(M, o) {
    const d = M.data, h = objet(d.historique);
    if (o && o.retro === false) return { retro: null, retro_raison: "rétro-contrôle non demandé" };
    if (M.options.perimetre !== "foyer") return { retro: null, retro_raison: "Le rétro-contrôle porte sur le foyer entier : les photos du patrimoine ne sont pas tenues par personne." };
    const pts = liste(h.points);
    if (h.erreur) return { retro: null, retro_raison: "L'historique du patrimoine n'a pas pu être lu (" + h.erreur + ") : pas de vérification de la projection sur le passé." };
    if (!pts.length) return { retro: null, retro_raison: "Aucune photo du patrimoine avec sa composition : pas encore assez d'historique pour vérifier la projection." };
    const minR = O.indexReperes(d.reperes).retro_min_origines;
    if (!minR) return { retro: null, retro_raison: "repère manquant (retro_min_origines) : seuil du rétro-contrôle indisponible" };
    const cle = versionModele + ":" + hacher(JSON.stringify([h, d.reperes, d.classes]));
    let r = retroCache.get(cle);
    if (!r) {
      r = retroControle(d, h, { horizon_mois: 12, chemins: 2000, flux: h.flux, min: +minR.valeur });
      retroCache.set(cle, r); while (retroCache.size > 4) retroCache.delete(retroCache.keys().next().value);
    }
    const c = r.couverture;
    if (!c.affichable) return { retro: null, retro_raison: c.n + " date" + (c.n > 1 ? "s" : "") + " de départ avec une valeur réelle 12 mois plus tard sur " + c.minimum + " nécessaires : pas encore assez d'historique pour vérifier la projection." };
    return { retro: { n: c.n, horizon_mois: 12, premiere_date: r.origines[0].date, derniere_date: r.origines[r.origines.length - 1].date,
      dans_p10_p90: c.dans_p10_p90, taux_p10_p90: c.taux_p10_p90, attendu_p10_p90: c.attendu_p10_p90, dans_p25_p75: c.dans_p25_p75, taux_p25_p75: c.taux_p25_p75, attendu_p25_p75: c.attendu_p25_p75,
      sous_p10: c.sous_p10, au_dessus_p90: c.au_dessus_p90, bandes_trop_etroites: c.taux_p10_p90 < 0.65, affichable: true, minimum: c.minimum, phrase: r.phrase, limites: LIMITES_RETRO.slice() }, retro_raison: null };
  }

  /* ================================================================== retrait, capacité d'emprunt dans le temps, plans figés */
  /** Retrait net d'un montant dans l'ordre du § 6.3, aujourd'hui. options : { montant_net, motif, usage, autoriser_cloture_pea, tmi_pct, perimetre }. */
  function retrait(data, options) {
    const o = options || {}, d = data || {}, sc = o.perimetre || "foyer";
    const ctx = Dn.contexte(d, { perimetre: sc });
    if (o.tmi_pct != null) ctx.reglages.tmi_pct = o.tmi_pct;
    const cc = Dn.construireCompartiments(ctx), today = ctx.today, date = O.estDate(o.date) ? o.date : today;
    const mat = Calc.matelas(objet(d.config)), matelas = (mat ? mat.min : 0) / (sc === "foyer" ? 1 : 2);
    const { gardes, exclus } = Dn.ecarterIndisponibles(cc.comps, ctx);
    const entree = gardes.filter(c => c.v0 > 0).map(c => ({ id: c.id, enveloppe: c.enveloppe, type: c.type, valeur: c.v0, base: c.base0, dispo: c.dispo, prep: c.prep, pee_disponible: c.pee_disponible }));
    const flags = { date, matelas, rp: (o.usage || o.motif_usage || "rp") === "rp", autoriser_cloture_pea: !!o.autoriser_cloture_pea };
    const plan = F.planRetrait(entree, +o.montant_net, flags);
    const mob = F.planRetrait(entree, Infinity, Object.assign({}, flags, { niveau_max: o.autoriser_cloture_pea ? 6 : 5 }));
    const sources = plan.sources.map(s => ({ enveloppe: s.enveloppe, type: (entree.find(c => c.id === s.id) || {}).type, niveau: s.niveau, brut: s.brut, net: s.net, gain: s.gain, impot_revenu: s.impot_revenu,
      prelevements_sociaux: s.prelevements_sociaux, impots: s.impots, cloture: !!s.cloture }));
    const avertissements = exclus.map(x => "« " + x.enveloppe + " » n'est pas comptée : " + (x.mentions[0] || "règle fiscale indisponible"));
    if (plan.manque > 0.5) avertissements.push("apport insuffisant : il manque " + eur(plan.manque));
    const parEnv = {}; sources.forEach(s => { parEnv[s.enveloppe] = s; });
    return { date, montant_net: +o.montant_net, sources, impots: plan.impots, manque: plan.manque, mobilisable: mob.net_obtenu, excedent_au_disponible: plan.excedent_au_disponible,
      matelas_utilise: plan.matelas_utilise, pea_intact: !sources.some(s => ["pea", "pea_pme", "pea_jeune"].includes(s.type)),
      ordre_niveau_2: sources.filter(s => s.niveau === 2).map(s => s.enveloppe), besoin_couvert_par_pea: Math.min(sum(sources.filter(s => s.cloture), s => s.net), Math.max(0, +o.montant_net - sum(sources.filter(s => !s.cloture), s => s.net))),
      per: sources.find(s => s.type === "per") || null, exclus, manquants: [...ctx.manquants.keys()], avertissements };
  }

  /** Capacité d'emprunt dans le temps (IMMO1, spec § 8.2) : mensualité maximale et montant empruntable mois par mois (déterministes en revenus), apport mobilisable
      et budget d'achat en P10 / P50 / P90 (mêmes chemins que la projection), taux du jour et ±1 point. opts : { duree_ans, date, scenario ("p10"|"p50"|"p90"), chemins, graine, neuf, primo }. */
  function capaciteDansLeTemps(M, resultat, opts) {
    const o = opts || {}, N = M.N, rv = M.ctx.rv, d = M.data;
    assurerDet(M);
    const effort = rv("hcsf_taux_effort"), dureeMax = rv("hcsf_duree_max");
    const vide = pourquoi => ({ indisponible: true, avertissements: [pourquoi], mention: D.Immo.MENTION });
    if (o.date != null && !(typeof o.date === "string" && O.estDate(o.date) && o.date >= M.today && O.moisDe(M.today, o.date, N) != null)) {
      const fr = x => x.slice(8, 10) + "/" + x.slice(5, 7) + "/" + x.slice(0, 4);
      return vide("date de l'achat envisagé absente ou hors de l'horizon : choisis une date entre le " + fr(M.today) + " et le " + fr(M.dates[N]) + ".");
    }
    if (effort === undefined) return vide("repère manquant (hcsf_taux_effort) : plafond d'endettement indisponible");
    const duree = o.duree_ans != null ? Math.min(+o.duree_ans, dureeMax != null ? Math.max(dureeMax, 0) : +o.duree_ans) : dureeMax;
    if (!(duree > 0)) return vide("repère manquant (hcsf_duree_max)");
    const proche = [15, 20, 25].sort((a, b) => Math.abs(a - duree) - Math.abs(b - duree) || a - b)[0];
    const tauxCentral = rv("taux_credit_immo_" + proche);
    if (tauxCentral === undefined) return vide("repère manquant (taux_credit_immo_" + proche + ") : taux du jour indisponible");
    const assPct = M.reglages.assurance_pct != null ? M.reglages.assurance_pct : rv("assurance_emprunteur_defaut_pct");
    const fa = { ancien: rv("frais_acquisition_ancien_pct"), primo: rv("frais_acquisition_primo_pct"), neuf: rv("frais_acquisition_neuf_pct") }, gar = rv("garantie_pct"), dos = rv("frais_dossier");
    if (assPct === undefined || Object.values(fa).some(x => x === undefined) || gar === undefined || dos === undefined) return vide("repère manquant (frais d'acquisition, garantie, frais de dossier ou assurance) : budget d'achat indisponible");
    const type = o.neuf ? "neuf" : o.primo ? "primo" : "ancien";
    const pond = rv("revenus_locatifs_ponderation"), sc = M.options.perimetre;
    const biens = liste(d.biens).length || !objet(d.profil).biens ? liste(d.biens) : liste(objet(d.profil).biens);
    const loyers = sum(biens, b => O.n0(b.loyer) * Calc.part(sc, b.part_p1)) * (pond !== undefined ? pond / 100 : 0);
    const autres = sum(M.persons, k => O.n0(objet(objet(objet(d.profil).personnes)[k]).autresRevenus));
    const R = t => (sum(M.persons, k => M.salaireEn(k, M.dates[t])) + autres + loyers) * M.infl[t];
    const mensAchats = t => sum(M.achats.filter(a => !a.indisponible), a => (t > a.t && t <= a.t + a.duree_mois ? a.mensualite : 0));
    const Ch = t => (M.mensExist[t] || 0) + mensAchats(t);
    const mensMax = t => Math.max(0, effort / 100 * R(t) - Ch(t));
    const k = C.annuite(tauxCentral, duree) + assPct / 100 / 12;
    const marques = []; for (let t = 12; t <= N; t += 12) marques.push(t);
    const P = (resultat && resultat.chemins) || o.chemins || 2000, graine = resultat && resultat.graine != null ? resultat.graine : (o.graine == null ? GRAINE : o.graine);
    const run = derouler(M, { P, graine, vue: "financier", apportMois: [0].concat(marques).filter(t => t > 0) });
    const apport0 = D.Immo.capaciteEmprunt(d, { perimetre: sc, duree_ans: duree, taux_pct: tauxCentral, neuf: o.neuf, primo: o.primo }).apport;
    const mois = [], mensualite_max = [], montant_empruntable = [], app = { p10: [], p50: [], p90: [] }, bud = { p10: [], p50: [], p90: [] };
    const fx = t => (M.options.euros === "courants" ? 1 : 1 / M.infl[t]);
    const rg = rangs(P).filter((_, j) => ["p10", "p50", "p90"].includes(NOMS_P[j]));
    const budgetDe = (C0, A, t) => Math.max(0, (C0 + A - C0 * gar / 100 - (C0 > 0 ? dos * M.infl[t] : 0)) / (1 + fa[type] / 100));
    const pointsT = [0].concat(marques);
    const parTaux = { central: [], bas: [], haut: [] };
    pointsT.forEach(t => {
      mois.push(M.dates[t]);
      const mm = mensMax(t), emprunt = mm / k;
      mensualite_max.push(mm * fx(t)); montant_empruntable.push(emprunt * fx(t));
      let A;
      if (t === 0) { A = new Float64Array(1).fill(apport0 ? apport0.total : 0); }
      else A = Float64Array.from(run.apport[t]);
      const S = Float64Array.from(A).sort(), Bd = Float64Array.from(A, a => budgetDe(emprunt, a, t)).sort();
      const n = S.length, ix = q => Math.min(n - 1, Math.max(0, Math.ceil(q * n - 1e-9) - 1));
      app.p10.push(S[ix(0.1)] * fx(t)); app.p50.push(S[ix(0.5)] * fx(t)); app.p90.push(S[ix(0.9)] * fx(t));
      bud.p10.push(Bd[ix(0.1)] * fx(t)); bud.p50.push(Bd[ix(0.5)] * fx(t)); bud.p90.push(Bd[ix(0.9)] * fx(t));
      [["bas", -1], ["central", 0], ["haut", 1]].forEach(([nom, dt]) => {
        const kk = C.annuite(Math.max(0.05, tauxCentral + dt), duree) + assPct / 100 / 12, e = mm / kk, med = Bd.length ? 0 : 0;
        const Am = S[ix(0.5)];
        parTaux[nom].push(budgetDe(e, Am, t) * fx(t));
      });
    });
    /* série mensuelle déterministe de la mensualité maximale (cas I-5) */
    const serie = []; for (let t = 0; t <= N; t++) serie.push({ t, date: M.dates[t], mensualite_max: mensMax(t) * fx(t), montant_empruntable: mensMax(t) / k * fx(t) });
    const phraseT = Math.min(N, o.date && O.estDate(o.date) ? O.moisDe(M.today, o.date, N) || 36 : 36), iT = pointsT.indexOf(Math.round(phraseT / 12) * 12) >= 0 ? pointsT.indexOf(Math.round(phraseT / 12) * 12) : 0;
    const tp = pointsT[iT], an = M.dates[tp].slice(0, 4);
    const phrase = "En " + an + ", budget d'achat médian " + kEur(bud.p50[iT]) + " avec " + kEur(app.p50[iT]) + " d'apport (9 chances sur 10 d'avoir au moins " + kEur(app.p10[iT]) + ").";
    const jalons = M.jalons.filter(j => j.source !== "calendrier" || ["pret_fin"].includes(j.type)).map(j => ({ id: j.id, date: j.date, titre: j.titre, type: j.type, effet: j.effet.texte }));
    let point = null;
    if (o.date && O.estDate(o.date)) {
      const t = O.moisDe(M.today, o.date, N) || N, q = o.scenario === "p10" ? "p10" : o.scenario === "p90" ? "p90" : "p50", i = pointsT.reduce((best, x, ix) => (Math.abs(x - t) < Math.abs(pointsT[best] - t) ? ix : best), 0);
      point = { date: mois[i], scenario: q, mensualite_max: mensualite_max[i], montant_empruntable: montant_empruntable[i], apport: app[q][i], budget_achat: bud[q][i] };
    }
    return { duree_ans: duree, type_frais: type, mois, mensualite_max, montant_empruntable, apport: app, budget_achat: bud, budget_achat_par_taux: parTaux,
      taux: { central: tauxCentral, bas: Math.max(0.05, tauxCentral - 1), haut: tauxCentral + 1 }, serie_mensuelle: serie, jalons, phrase, point, euros: M.options.euros, version_modele: versionModele,
      avertissements: ["Le taux du jour est supposé constant : aucun modèle des taux en V1 (lignes à ±1 point).", "Estimation selon les règles du HCSF, chaque banque décide."], mention: D.Immo.MENTION };
  }

  /* ---- plans figés (CK5) : de quoi rejouer une projection passée et la comparer au réel ---- */
  /* Limites de la base (appliquer_propositions, cible plan_fige), mesurées comme elle en octets de jsonb::text (octet_length) ; marge de 2 % pour les écarts de format des nombres */
  const PLAN_MAX_OCTETS = 250000, PLAN_PARAMETRES_MAX_OCTETS = 100000, PLAN_TOTAL_MAX_OCTETS = 400000;
  const PLAN_MARGE = 0.98;
  /** Ce que le plan attendait du rendement des placements, rangé avec lui : de quoi comparer plus tard le rendement réel à ce que le modèle en disait (hypothèses de classe du moment, attendu net
      de frais, rendement annualisé médian et bande sur l'horizon). null sans rendement mesurable. */
  function resumeRendementPlan(rd) {
    if (!rd || !rd.disponible) return null;
    const r4 = x => (x == null || !Number.isFinite(+x) ? null : Math.round(+x * 1e4) / 1e4), bande = o => ({ p10: r4(o.p10), p50: r4(o.p50), p90: r4(o.p90) });
    const classes = {};
    Object.keys(rd.classes || {}).forEach(k => { classes[k] = { rendement: r4(rd.classes[k].rendement), volatilite: r4(rd.classes[k].volatilite) }; });
    return { attendu_nominal_pct: r4(rd.attendu.nominal_pct), attendu_reel_pct: r4(rd.attendu.reel_pct), frais_pct: r4(rd.attendu.frais_pct), inflation_pct: r4(rd.inflation_pct), classes,
      horizon_ans: rd.horizon.ans, horizon_nominal: bande(rd.horizon.nominal), horizon_reel: bande(rd.horizon.reel) };
  }
  /** Ligne à ranger dans plans_figes : { raison, horizon_mois, parametres, serie }. entree = { data, options } ; sortie = résultat de simuler (même entrée). La série est
      mensuelle (patrimoine net en euros courants : P10 à P90, couche « existant » aux années, versements cumulés) ; les paramètres suffisent à rejouer le calcul plus tard.
      Les tailles sont tenues sous les limites de la base : paramètres réduits par étapes (dites dans parametres.reductions), série espacée (serie.pas_mois). */
  function figerPlan(entree, sortie, raison) {
    const e = entree || {}, d = e.data || {}, o = e.options || {}, s = sortie || {};
    const r = raison || "manuel";
    const vue = s.vues && (s.vues.net ? "net" : Object.keys(s.vues)[0]), cent = vue ? s.vues[vue] : null;
    const N = s.mois ? s.mois.length - 1 : 0;
    const arr = a => (a || []).map(x => (x == null ? null : Math.round(x * 100) / 100));
    const serie = { vue, euros: s.euros, mois: s.mois, p10: arr(cent && cent.p10), p25: arr(cent && cent.p25), p50: arr(cent && cent.p50), p75: arr(cent && cent.p75), p90: arr(cent && cent.p90),
      existant_p50: arr(s.existant && s.existant.p50), versements_cumules: arr(s.epargne_future && s.epargne_future.versements_cumules), objectifs: (s.objectifs || []).map(x => ({ id: x.id, cible: x.cible, date: x.date, probabilite: x.probabilite })) };
    const reperesUtilises = (s.hypotheses || []).map(h => ({ cle: h.cle, valeur: h.valeur, verifie_le: h.verifie_le, date_effet: h.date_effet, date_fin: h.date_fin }));
    /* paramètres des événements : seulement les clés connues de leur type (jamais un objet libre de l'utilisateur) */
    const cles = t => (E.ENTREES[t] && E.ENTREES[t].parametres) || [];
    const paramsConnus = x => { const out = {}, p = objet(x.params); cles(x.type).forEach(k => { if (p[k] !== undefined) out[k] = p[k]; }); return out; };
    const reglages = objet(d.config && d.config.projection);
    const parametres = {
      version_modele: s.version_modele || versionModele, graine: s.graine, chemins: s.chemins, today: s.today || d.today, options: { horizon_ans: o.horizon_ans, perimetre: o.perimetre || "foyer", vue: o.vue, euros: o.euros, net_impots: !!o.net_impots, variante: o.variante || null },
      capacite: { base: s.capacite_base ? { retenue: s.capacite_base.retenue, source: s.capacite_base.source, constatee: s.capacite_base.constatee, prevue: s.capacite_base.prevue, programmee: s.capacite_base.programmee, periode: s.capacite_base.periode } : null,
        par_periode: s.capacite_par_periode, versements_mensuels_initiaux: s.capacite_par_periode && s.capacite_par_periode[0] ? s.capacite_par_periode[0].montant_mensuel : null },
      allocation: { classes: s.hypotheses_classes, reste_capacite: reglages.reste_capacite, cibles: d.config && d.config.targets },
      rendement: resumeRendementPlan(s.rendement),
      evenements: (d.foyer && d.foyer.evenements || []).map(x => ({ id: x.id, type: x.type, personne: x.personne, libelle: x.libelle, date: x.date, fin: x.fin || null, params: paramsConnus(x), variante_id: x.variante_id || null })),
      variantes: (d.foyer && d.foyer.variantes || []).map(x => ({ id: x.id, nom: x.nom, retire: x.retire, hypotheses: x.hypotheses })),
      hypotheses: { reperes: reperesUtilises, classes: s.hypotheses_classes, reglages },
      positions: (d.positions || []).filter(p => p && p.status !== "clôturé").map(p => ({ id: p.id, envelope: p.envelope, owner: p.owner, bloc: p.bloc, value: p.value, qty: p.qty, price: p.price, pru: p.pru, isin: p.isin })),
      credits: (d.credits || d.profil && d.profil.credits || []).map(c => ({ id: c.id, crd: c.crd, mensualite: c.mensualite, owner: c.owner })),
    };
    /* réduction par étapes jusqu'à tenir sous la limite des paramètres ; chaque étape appliquée est dite */
    const limP = Math.floor(PLAN_PARAMETRES_MAX_OCTETS * PLAN_MARGE), taillePar = () => O.octetsJsonb(parametres), reductions = [];
    const etapes = [
      ["positions_reduites", () => { parametres.positions = parametres.positions.map(p => ({ id: p.id, value: p.value })); }],
      ["reperes_reduits", () => { parametres.hypotheses.reperes = parametres.hypotheses.reperes.map(h => ({ cle: h.cle, valeur: h.valeur })); }],
      ["variantes_reduites", () => { parametres.variantes = parametres.variantes.map(v => ({ id: v.id, nom: v.nom, retire: liste(v.retire).slice(0, 20) })); }],
      ["biens_des_reglages_retires", () => { const { biens: _b, ...reste } = parametres.hypotheses.reglages; parametres.hypotheses.reglages = reste; }],
      ["periodes_de_capacite_abregees", () => { if (parametres.capacite.par_periode) parametres.capacite.par_periode = parametres.capacite.par_periode.slice(0, 40).map(x => ({ debut_t: x.debut_t, fin_t: x.fin_t, montant_mensuel: x.montant_mensuel, source: x.source })); }],
      ["parametres_des_evenements_retires", () => { parametres.evenements = parametres.evenements.map(x => ({ id: x.id, type: x.type, personne: x.personne, libelle: x.libelle, date: x.date, fin: x.fin, variante_id: x.variante_id })); }],
      ["credits_retires", () => { parametres.credits = []; }],
      ["periodes_de_capacite_retirees", () => { if (parametres.capacite.par_periode) parametres.capacite.par_periode = []; }],
      ["positions_retirees", () => { parametres.positions = []; }],
      ["variantes_retirees", () => { parametres.variantes = []; }],
      ["evenements_retires", () => { parametres.evenements = []; }],
      ["reperes_retires", () => { parametres.hypotheses.reperes = []; }],
      ["rendement_retire", () => { parametres.rendement = null; }],
    ];
    for (const [nom, f] of etapes) {
      if (taillePar() <= limP) break;
      f(); reductions.push(nom);
    }
    if (reductions.length) parametres.reductions = reductions;
    /* série : espacée (un point sur 3, puis sur 6, 12…) jusqu'à tenir sous la limite */
    const limS = Math.floor(PLAN_MAX_OCTETS * PLAN_MARGE), CHAMPS_SERIE = ["mois", "p10", "p25", "p50", "p75", "p90", "existant_p50", "versements_cumules"];
    const brute = {}; CHAMPS_SERIE.forEach(k => { brute[k] = serie[k] || []; });
    for (let pas = 3; O.octetsJsonb(serie) > limS && pas <= 120; pas *= 2) {
      CHAMPS_SERIE.forEach(k => { serie[k] = brute[k].filter((_, i) => i % pas === 0 || i === brute[k].length - 1); });
      serie.pas_mois = pas;
    }
    const ligne = { raison: ["revue_mensuelle", "objectif", "manuel"].includes(r) ? r : "manuel", horizon_mois: N, parametres, serie };
    ligne.taille_octets = O.octetsJsonb({ raison: ligne.raison, horizon_mois: N, parametres, serie });
    return ligne;
  }
  /** Compare un plan figé à la série réelle ([{ date, valeur }] en euros courants) : par mois, médiane et bande du plan, valeur réelle, écart en € et en %. */
  function comparerPlanReel(planFige, serieReelle) {
    const p = planFige || {}, s = p.serie || {}, mois = s.mois || [];
    const reel = new Map(liste(serieReelle).filter(x => x && O.estDate(x.date)).map(x => [x.date.slice(0, 7), +x.valeur]));
    const lignes = [];
    mois.forEach((date, i) => {
      const r = reel.get(date.slice(0, 7));
      if (r == null || !isFinite(r)) return;
      const p50 = s.p50[i], ecart = r - p50;
      lignes.push({ date, plan_p50: p50, plan_p10: s.p10[i], plan_p25: s.p25 ? s.p25[i] : null, plan_p75: s.p75 ? s.p75[i] : null, plan_p90: s.p90[i], reel: r, ecart, ecart_pct: p50 ? ecart / p50 * 100 : null,
        dans_la_bande_p10_p90: r >= s.p10[i] && r <= s.p90[i], dans_la_bande_p25_p75: s.p25 && s.p75 ? r >= s.p25[i] && r <= s.p75[i] : null });
    });
    const dernier = lignes[lignes.length - 1] || null;
    return { cree_le: p.cree_le || null, version_modele: p.parametres && p.parametres.version_modele, lignes, n: lignes.length, dernier,
      dans_la_bande_p10_p90: lignes.filter(l => l.dans_la_bande_p10_p90).length };
  }

  /* ================================================================== exécution progressive, worker et cache (spec § 9) */
  const cache = new Map(), CACHE_MAX = 8;
  /** Empreinte de l'entrée : données, options (hors réglages d'exécution) et version du modèle. */
  function empreinte(data, options) {
    const o = Object.assign({}, options); delete o.worker; delete o.WorkerClass; delete o.urlWorker; delete o.progressif;
    return versionModele + ":" + hacher(JSON.stringify([versionModele, data, o]));
  }
  /** Empreinte courte d'un texte (deux sommes de contrôle 32 bits et la longueur). */
  function hacher(s) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0; h2 ^= h2 >>> 13; }
    return h1.toString(36) + h2.toString(36) + ":" + s.length;
  }
  /** Calcule `etapes` (nombres de chemins croissants, même graine : les premiers chemins sont communs) ; rend un résultat par étape. */
  function calculerEtapes(data, options, etapes) {
    const o = Object.assign({}, options), M = preparer(data, o);
    return etapes.map(n => simuler(M, { chemins: n, graine: o.graine, volatilite: o.volatilite }));
  }
  /** Exécute une projection : d'abord 500 chemins (aperçu), puis 2 000, dans un Web Worker si disponible, sinon sur le fil principal.
      Résultats mis en cache par empreinte (données + options + version du modèle). rappel(resultat, { etape: "apercu" | "complet", chemins, cache? }).
      options : { …options de preparer, chemins (2000), graine, volatilite, worker (false : fil principal), WorkerClass, urlWorker, progressif (false : une seule étape) }. → Promise du résultat complet. */
  /** Exécutions en vol, par empreinte : une demande identique rejoint le calcul en cours (aperçu déjà obtenu rejoué) au lieu d'en lancer un second. */
  const enVol = new Map();
  function executer(data, options, rappel) {
    const o = options || {}, cle = empreinte(data, o);
    if (cache.has(cle)) { const r = cache.get(cle); cache.delete(cle); cache.set(cle, r); if (typeof rappel === "function") rappel(r, { etape: "complet", chemins: r.chemins, cache: true }); return Promise.resolve(r); }
    const deja = enVol.get(cle);
    if (deja) {
      if (typeof rappel === "function") { deja.abonnes.push(rappel); if (deja.apercu) rappel(deja.apercu.r, deja.apercu.info); }
      return deja.promesse;
    }
    const e = { abonnes: typeof rappel === "function" ? [rappel] : [], apercu: null, promesse: null };
    enVol.set(cle, e);
    const diffuse = (r, info) => { if (info && info.etape === "apercu") e.apercu = { r, info }; e.abonnes.slice().forEach(f => f(r, info)); };
    try { e.promesse = lancerExecution(data, o, cle, diffuse); } catch (err) { enVol.delete(cle); throw err; }
    e.promesse.then(() => enVol.delete(cle), () => enVol.delete(cle));
    return e.promesse;
  }
  function lancerExecution(data, o, cle, dit) {
    const final = o.chemins > 0 ? Math.round(o.chemins) : 2000;
    const etapes = o.progressif === false || final <= 500 || o.volatilite === 0 ? [final] : [500, final];
    const garder = r => { cache.set(cle, r); while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); return r; };
    const W = o.worker === false ? null : o.WorkerClass || (typeof Worker !== "undefined" ? Worker : null);
    if (W) {
      return new Promise((resolve, reject) => {
        let w;
        try { w = new W(o.urlWorker || "app/projection-worker.js"); } catch (e) { w = null; }
        if (!w) { resolve(executerSurLeFilPrincipal()); return; }
        const opt = Object.assign({}, o); delete opt.WorkerClass; delete opt.worker; delete opt.urlWorker;
        w.onmessage = ev => {
          const m = ev.data || {};
          if (m.erreur) { try { w.terminate(); } catch (e) { /* rien */ } reject(new Error(m.erreur)); return; }
          const dernier = m.etape === etapes.length - 1;
          dit(m.resultat, { etape: dernier ? "complet" : "apercu", chemins: m.resultat.chemins });
          if (dernier) { try { w.terminate(); } catch (e) { /* rien */ } resolve(garder(m.resultat)); }
        };
        w.onerror = e => { try { w.terminate(); } catch (x) { /* rien */ } reject(new Error((e && e.message) || "calcul de la projection interrompu")); };
        w.postMessage({ data, options: opt, etapes });
      });
    }
    function executerSurLeFilPrincipal() {
      const M = preparer(data, o);
      return new Promise((resolve, reject) => {
        let k = 0;
        const pas = () => {
          try {
            const r = simuler(M, { chemins: etapes[k], graine: o.graine, volatilite: o.volatilite });
            const dernier = k === etapes.length - 1;
            dit(r, { etape: dernier ? "complet" : "apercu", chemins: r.chemins });
            if (dernier) { resolve(garder(r)); return; }
            k++;
            setTimeout(pas, 0);
          } catch (e) { reject(e); }
        };
        pas();
      });
    }
    return executerSurLeFilPrincipal();
  }
  /* ================================================================== épargne nécessaire (BUD1, spec § 10.1) */
  /** Pour chaque objectif en cours (ni atteint, ni hors de portée, ni hors horizon), la plus petite épargne mensuelle en plus (d, €/mois, par pas de 25) qui porte sa
      probabilité à sa date à 8 chances sur 10, et d* pour tous ensemble (le plus grand des d). Le calcul inverse du moteur : une variante transitoire
      (`hypotheses.epargne_delta_mensuel`), 500 chemins, la même graine donc les mêmes tirages pour tous les essais ; chaque simulation donne toutes les probabilités
      d'un coup et son résultat est gardé ; recherche exponentielle (100, 200, 400… jusqu'à 10 000 €) puis dichotomie à 25 € près, 16 simulations au plus (au-delà
      la précision est dite, `precision`). Un objectif déjà à 8 chances sur 10 sans effort supplémentaire reçoit un d négatif : ce qu'il pourrait épargner de moins
      (jusqu'à sa capacité retenue). La monotonie des probabilités sur la grille parcourue est vérifiée ; un écart est signalé (`monotone: false`) et la plus petite valeur
      de la grille qui passe est rendue. `atteignable: false` quand 10 000 €/mois ne suffisent pas. options : celles de preparer (horizon_ans, perimetre, vue, variante…),
      plus { chemins (500), graine }. Pur, déterministe ; l'entrée n'est pas modifiée.
      → { par_objectif: [{ id, nom, d, probabilite_a_0, probabilite_a_d, atteignable, monotone, precision }], exclus: [{ id, nom, raison }], ensemble: { d, atteignable },
      chemins, graine, simulations, monotone, capacite_retenue, version_modele }. */
  function epargneNecessaire(data, options) {
    const o = options || {}, d0 = data || {};
    const P = o.chemins > 0 ? Math.round(o.chemins) : CHEMINS_EPARGNE, graine = o.graine == null ? GRAINE : o.graine;
    const base = Object.assign({}, o); delete base.chemins; delete base.graine;
    const variantes = liste(objet(d0.foyer).variantes);
    const varBase = base.variante ? variantes.find(v => v && v.id === base.variante) || null : null;
    const deltaBase = varBase ? +objet(varBase.hypotheses).epargne_delta_mensuel || 0 : 0;
    /* les événements propres à la variante de base (variante_id) suivent la variante transitoire : sans cela, ils seraient retirés du calcul inverse */
    const vIdEv = e => (e.variante_id !== undefined ? e.variante_id : e.varianteId) || null;
    const evenements = varBase ? liste(objet(d0.foyer).evenements).map(e => {
      if (!e || typeof e !== "object" || vIdEv(e) !== varBase.id) return e;
      const c = Object.assign({}, e, { variante_id: ID_VARIANTE_EPARGNE }); delete c.varianteId; return c;
    }) : objet(d0.foyer).evenements;
    const donnees = delta => Object.assign({}, d0, { foyer: Object.assign({}, objet(d0.foyer), varBase ? { evenements } : {}, { variantes: variantes.filter(v => !v || v.id !== ID_VARIANTE_EPARGNE).concat([{
      id: ID_VARIANTE_EPARGNE, nom: "Épargne nécessaire", retire: varBase ? liste(varBase.retire) : [], hypotheses: Object.assign({}, varBase ? objet(varBase.hypotheses) : {}, { epargne_delta_mensuel: deltaBase + delta }) }]) }) });
    const cache = new Map();
    let simulations = 0, ctx0 = null;
    const evaluer = delta => {
      if (cache.has(delta)) return cache.get(delta);
      simulations++;
      const M = preparer(donnees(delta), Object.assign({}, base, { variante: ID_VARIANTE_EPARGNE }));
      assurerDet(M);
      const run = derouler(M, { P, graine, det: false, vue: M.options.vue, net_impots: M.options.net_impots, couches: false });
      const objs = M.objs.map((ob, j) => {
        const statut = ob.deja >= ob.cible ? "atteint" : ob.date < M.today ? "hors_portee" : ob.t < 1 || ob.t > M.N ? "hors_horizon" : "en_cours";
        return { id: ob.id, nom: ob.nom, statut, p: statut === "en_cours" ? run.objCompte[j] / P : null };
      });
      if (!ctx0) ctx0 = M;
      const r = { delta, objs };
      cache.set(delta, r);
      return r;
    };
    const r0 = evaluer(0);
    const cap = Math.max(0, Math.round(ctx0.capacite_base.retenue || 0));
    const idx = r0.objs.map((x, i) => (x.statut === "en_cours" ? i : -1)).filter(i => i >= 0);
    const passe = (delta, i) => cache.get(delta).objs[i].p >= SEUIL_OBJECTIF - 1e-9;
    const bornes = i => {
      const ds = [...cache.keys()].sort((a, b) => a - b);
      const hi = ds.find(x => passe(x, i));
      const echecs = ds.filter(x => !passe(x, i) && (hi === undefined || x < hi));
      return { hi: hi === undefined ? null : hi, lo: echecs.length ? echecs[echecs.length - 1] : null };
    };
    // 1. positifs : 100, 200, 400… jusqu'à ce que tous les objectifs sous la barre à 0 la passent, ou 10 000
    const aPasser = () => idx.filter(i => bornes(i).hi === null);
    for (let pas = 100; aPasser().length && pas / 2 < EPARGNE_MAX && simulations < SIMULATIONS_MAX; pas *= 2) evaluer(Math.min(pas, EPARGNE_MAX));
    // 2. négatifs : ce qu'on pourrait épargner de moins, jusqu'à la capacité retenue (par pas de 25)
    const bas = -Math.floor(cap / PAS_EPARGNE) * PAS_EPARGNE;
    if (idx.some(i => passe(0, i)) && bas < 0 && simulations < SIMULATIONS_MAX) evaluer(bas);
    // 3. dichotomie à 25 € près, en commençant par la fourchette la plus large ; chaque simulation précise toutes les fourchettes
    while (simulations < SIMULATIONS_MAX) {
      let pire = null, largeur = PAS_EPARGNE;
      for (const i of idx) {
        const b = bornes(i);
        if (b.hi !== null && b.lo !== null && b.hi - b.lo > largeur) { largeur = b.hi - b.lo; pire = b; }
      }
      if (!pire) break;
      evaluer(pire.lo + PAS_EPARGNE * Math.max(1, Math.floor((pire.hi - pire.lo) / (2 * PAS_EPARGNE))));
    }
    const grille = [...cache.keys()].sort((a, b) => a - b);
    const parObjectif = idx.map(i => {
      const b = bornes(i), x = r0.objs[i];
      let monotone = true;
      for (let k = 1; k < grille.length; k++) if (cache.get(grille[k]).objs[i].p < cache.get(grille[k - 1]).objs[i].p - 1e-12) monotone = false;
      const atteignable = b.hi !== null;
      return { id: x.id, nom: x.nom, d: atteignable ? b.hi : null, probabilite_a_0: x.p, probabilite_a_d: atteignable ? cache.get(b.hi).objs[i].p : cache.get(grille[grille.length - 1]).objs[i].p, atteignable, monotone,
        precision: atteignable ? (b.lo === null ? 0 : b.hi - b.lo) : null };
    });
    const ok = parObjectif.filter(x => x.atteignable);
    return { par_objectif: parObjectif, exclus: r0.objs.filter(x => x.statut !== "en_cours").map(x => ({ id: x.id, nom: x.nom, raison: x.statut })),
      ensemble: { d: parObjectif.length && ok.length === parObjectif.length ? Math.max(...ok.map(x => x.d)) : null, atteignable: parObjectif.length ? ok.length === parObjectif.length : null },
      chemins: P, graine, simulations, monotone: parObjectif.every(x => x.monotone), capacite_retenue: cap, version_modele: versionModele };
  }

  /** Vide le cache des résultats (tests). */
  function viderCache() { cache.clear(); retroCache.clear(); }

  /** Normales corrélées d'un chemin donné : outil de test. */
  const _executer = derouler;

  return {
    GRAINE, versionModele, CLASSES_TIREES, HYPOTHESES, EVENEMENTS, PERCENTILES, PLAN_MAX_OCTETS, PLAN_PARAMETRES_MAX_OCTETS, PLAN_TOTAL_MAX_OCTETS, octetsJsonb: O.octetsJsonb,
    preparer, simuler, crise, comparer, epargneNecessaire, executer, calculerEtapes, empreinte, viderCache, kEur, tirages, correlations, couverture, retroControle, retroDuModele, texteProbabilite, historiquePourRetro: Dn.historiquePourRetro, phraseRetro, retrait, capaciteDansLeTemps, figerPlan, comparerPlanReel,
    fiscaliteSortie: F.fiscaliteSortie, amortissement: C.amortissement, annuite: C.annuite, planPret: C.planPret, ptz: C.ptz, taeg: C.taeg,
    capaciteEmprunt: (data, opts) => D.Immo.capaciteEmprunt(data, opts), capaciteDeBase: Dn.capaciteDeBase, depuisEtat: Dn.depuisEtat, validerEvenement: E.validerEvenement, validerVariante: E.validerVariante,
    rendementAttendu, capitaliser, centile: O.centile, _executer, _selectionnerRangs: selectionnerRangs,
  };
});
