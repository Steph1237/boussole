/* IMMO1 : capacité d'emprunt aujourd'hui (PROJ, spec § 8.1) — revenus retenus comme le font les banques (net avant impôt, loyers pondérés),
   plafond d'endettement du HCSF, taux du jour sourcé et daté, taux d'usure, apport réellement mobilisable (net d'impôts, matelas exclu),
   reste à vivre, sensibilité aux taux et aux durées. Pur, sans DOM, au tutoiement. Global ProjectionImmo ; copié tel quel dans le connecteur.
   « Estimation selon les règles du HCSF, chaque banque décide » : jamais une offre de prêt. Aucune valeur de secours : un repère manquant
   rend le calcul indisponible et le dit. La trajectoire dans le temps (capaciteDansLeTemps) est dans projection.js, qui a besoin du moteur. */
(function (root, factory) {
  const noeud = typeof module === "object" && module.exports;
  const dep = (global, chemin) => (noeud ? require(chemin) : root[global]);
  const api = factory({ O: dep("ProjectionOutils", "./projection-outils.js"), F: dep("ProjectionFiscalite", "./projection-fiscalite.js"),
    C: dep("ProjectionCredit", "./projection-credit.js"), Dn: dep("ProjectionDonnees", "./projection-donnees.js"), Calc: dep("Calc", "./calc.js"), Plan: dep("Plan", "./plan.js") });
  if (noeud) module.exports = api;
  else root.ProjectionImmo = api;
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";
  const { O, F, C, Dn, Calc, Plan } = D;
  const objet = Dn.objet, liste = Dn.liste;

  const MENTION = "Estimation selon les règles du HCSF, chaque banque décide. Ce n'est pas une offre de prêt.";
  const DUREES_TAUX = [15, 20, 25];

  /** Tranche du taux d'usure (Banque de France) d'une durée : moins de 10 ans, 10 à 20 ans (exclu), 20 ans et plus. */
  const trancheUsure = ans => (ans < 10 ? "moins_10" : ans < 20 ? "10_20" : "20_plus");

  /** Revenus retenus par les banques : salaires nets, autres revenus nets, primes moyennées sur 3 ans si le profil les porte, loyers pondérés. */
  function revenusRetenus(d, sc, ctx) {
    const pr = objet(d.profil), ps = objet(pr.personnes), detail = [], mentions = [];
    Dn.personnesDe(sc).forEach(k => {
      const p = objet(ps[k]), nom = (typeof p.nom === "string" && p.nom.trim()) || (k === "p1" ? "personne 1" : "personne 2");
      const sal = Calc.salaireNetMensuel(p);
      if (sal > 0) detail.push({ libelle: "Salaire net de " + nom, montant: sal });
      if (O.n0(p.autresRevenus) > 0) detail.push({ libelle: "Autres revenus nets de " + nom, montant: O.n0(p.autresRevenus) });
      const pa = p.primes_annuelles;
      const annees = Array.isArray(pa) ? pa.filter(x => O.estNombre(x)).map(Number).slice(-3) : O.estNombre(pa) ? [+pa] : [];
      if (annees.length) {
        const moy = annees.reduce((a, x) => a + x, 0) / annees.length / 12;
        detail.push({ libelle: "Primes de " + nom + " (moyenne de " + annees.length + " an" + (annees.length > 1 ? "s" : "") + ")", montant: moy });
      } else mentions.push("primes et variable de " + nom + " non comptés : ils ne figurent pas dans ton profil");
    });
    const biens = liste(d.biens).length || !pr.biens ? liste(d.biens) : liste(pr.biens);
    const loyers = biens.reduce((a, b) => a + (b ? O.n0(b.loyer) * Calc.part(sc, b.part_p1) : 0), 0);
    if (loyers > 0) {
      const pond = ctx.rv("revenus_locatifs_ponderation");
      if (pond === undefined) { ctx.manquant("revenus_locatifs_ponderation", "loyers non comptés"); mentions.push("loyers non comptés : pondération des loyers indisponible"); }
      else detail.push({ libelle: "Loyers perçus (" + O.frc(pond) + " % retenus, convention bancaire)", montant: loyers * pond / 100, brut: loyers, note: "convention" });
    }
    return { total: detail.reduce((a, x) => a + x.montant, 0), detail, mentions };
  }

  /** Dépenses courantes mensuelles hors logement du budget (catégories dont le nom n'est pas « Logement »), au prorata du périmètre ; null sans ligne. */
  function depensesHorsLogement(d, sc) {
    const L = d.budget && Array.isArray(d.budget.lignes) ? d.budget.lignes : [];
    const dep = L.filter(l => l && l.type === "depense" && !/logement/i.test(String(l.categorie || "")));
    if (!dep.length) return null;
    return dep.reduce((a, l) => a + Plan.mensuel(l) * Calc.partCredit(sc, l.owner === "p1" || l.owner === "p2" ? l.owner : "commun"), 0);
  }

  /** Taux du jour pour une durée : repère taux_credit_immo_<15|20|25> (le plus proche), avec sa source, sa date et « à actualiser » après sa date de fin. */
  function tauxDuJour(duree, ctx, today) {
    const proche = DUREES_TAUX.slice().sort((a, b) => Math.abs(a - duree) - Math.abs(b - duree) || a - b)[0];
    const cle = "taux_credit_immo_" + proche, r = ctx.R[cle];
    if (!r) { ctx.manquant(cle, "taux du jour"); return null; }
    ctx.rv(cle);
    return { valeur: +r.valeur, cle, duree_reference: proche, libelle: r.libelle, source: r.sourceTitre || null, url: r.sourceUrl || null, date_effet: r.dateEffet || null, date_fin: r.dateFin || null,
      a_actualiser: !!(r.dateFin && r.dateFin < today), verifie_le: r.verifieLe || null };
  }

  /** Montant empruntable et budget d'achat pour un taux, une durée d'amortissement et un apport donnés. */
  function calculer(p) {
    const a = C.annuite(p.taux_pct, p.duree_ans), ass = p.assurance_pct / 100 / 12;
    const emprunt = p.mensualite_max > 0 ? p.mensualite_max / (a + ass) : 0;
    const garantie = emprunt > 0 ? emprunt * p.garantie_pct / 100 : 0, dossier = emprunt > 0 ? p.frais_dossier : 0;
    const budget = {};
    for (const [type, pct] of Object.entries(p.frais_acquisition)) budget[type] = Math.max(0, (emprunt + p.apport - garantie - dossier) / (1 + pct / 100));
    return { emprunt, echeance: emprunt * a, assurance_mensuelle: emprunt * ass, garantie, dossier, budget };
  }

  /** Capacité d'emprunt aujourd'hui. opts : { perimetre ("foyer"|"p1"|"p2"), duree_ans, taux_pct, assurance_pct, neuf, primo, usage ("rp"…),
      apport (montant imposé, sinon l'apport mobilisable), type_projet ("vefa"|"ccmi"|"promotion"|"ancien_travaux"), travaux_pct }.
      → voir la spec § 8.1 ; `indisponible: true` avec les repères manquants quand le calcul n'est pas possible. */
  function capaciteEmprunt(data, opts) {
    const d = data || {}, o = opts || {}, sc = o.perimetre || "foyer", today = d.today;
    const ctx = Dn.contexte(d, { perimetre: sc });
    const avertissements = [], sources = new Map();
    const sortieVide = pourquoi => ({ perimetre: sc, indisponible: true, avertissements: [pourquoi].concat(avertissements), mention: MENTION, manquants: [...ctx.manquants.keys()] });
    const effort = ctx.rv("hcsf_taux_effort"), dureeMax = ctx.rv("hcsf_duree_max");
    if (effort === undefined) { ctx.manquant("hcsf_taux_effort", "plafond d'endettement"); return sortieVide("repère manquant (hcsf_taux_effort) : plafond d'endettement du HCSF indisponible"); }
    if (dureeMax === undefined) { ctx.manquant("hcsf_duree_max", "durée maximale du crédit"); return sortieVide("repère manquant (hcsf_duree_max) : durée maximale du HCSF indisponible, aucune durée n'est supposée"); }
    const rev = revenusRetenus(d, sc, ctx);
    rev.mentions.forEach(m => avertissements.push(m));
    const charges = Calc.mensualites(d.profil, sc);
    const mensMax = Math.max(0, effort / 100 * rev.total - charges);
    /* durée : plafond HCSF, 27 ans seulement avec différé dans les cas prévus */
    let duree = o.duree_ans != null ? +o.duree_ans : dureeMax;
    if (!(duree > 0)) return sortieVide("la durée du crédit doit être strictement positive");
    let differe = 0, dureeAmort = duree;
    if (duree > dureeMax) {
      const max27 = ctx.rv("hcsf_duree_max_differe"), seuilTravaux = ctx.rv("hcsf_travaux_seuil_pct");
      const eligible = ["vefa", "ccmi", "promotion"].includes(o.type_projet) || (o.type_projet === "ancien_travaux" && seuilTravaux !== undefined && O.n0(o.travaux_pct) >= seuilTravaux);
      if (max27 !== undefined && eligible && duree <= max27) {
        differe = duree - dureeMax; dureeAmort = dureeMax;
        avertissements.push("durée de " + duree + " ans avec un différé de " + differe + " an" + (differe > 1 ? "s" : "") + " : l'amortissement reste limité à " + dureeMax + " ans (décision du HCSF)");
      } else { avertissements.push("durée ramenée à " + dureeMax + " ans : le HCSF ne va au-delà que pour une vente en l'état futur d'achèvement, une construction de maison individuelle, un contrat de promotion ou l'ancien avec au moins " + (seuilTravaux !== undefined ? O.frc(seuilTravaux) + " %" : "10 %") + " de travaux"); duree = dureeMax; dureeAmort = dureeMax; }
    }
    /* taux et assurance */
    const tj = o.taux_pct != null ? null : tauxDuJour(dureeAmort, ctx, today);
    if (o.taux_pct == null && !tj) return sortieVide("repère manquant (taux_credit_immo_*) : taux du jour indisponible");
    const taux = o.taux_pct != null ? { valeur: +o.taux_pct, source: "taux fixé pour le calcul", date_effet: null, a_actualiser: false } : tj;
    if (tj && tj.duree_reference !== dureeAmort) avertissements.push("taux de la durée de " + tj.duree_reference + " ans utilisé pour " + dureeAmort + " ans");
    if (tj && tj.a_actualiser) avertissements.push("taux à actualiser : le repère (" + (tj.date_effet || "") + ") a dépassé sa date de fin");
    let assPct = o.assurance_pct != null ? +o.assurance_pct : ctx.reglages.assurance_pct;
    if (assPct == null) { assPct = ctx.rv("assurance_emprunteur_defaut_pct"); if (assPct === undefined) { ctx.manquant("assurance_emprunteur_defaut_pct", "assurance emprunteur"); return sortieVide("repère manquant (assurance_emprunteur_defaut_pct) : taux d'assurance indisponible"); } avertissements.push("assurance emprunteur supposée à " + O.frc(assPct, 2) + " % (hypothèse), à confirmer"); }
    /* frais d'acquisition, garantie, dossier */
    const fa = { ancien: ctx.rv("frais_acquisition_ancien_pct"), primo: ctx.rv("frais_acquisition_primo_pct"), neuf: ctx.rv("frais_acquisition_neuf_pct") };
    const gar = ctx.rv("garantie_pct"), dos = ctx.rv("frais_dossier");
    const manqueFrais = Object.keys(fa).filter(k => fa[k] === undefined).map(k => "frais_acquisition_" + k + "_pct").concat(gar === undefined ? ["garantie_pct"] : [], dos === undefined ? ["frais_dossier"] : []);
    manqueFrais.forEach(k => ctx.manquant(k, "frais d'acquisition"));
    if (manqueFrais.length) return sortieVide("repère manquant (" + manqueFrais.join(", ") + ") : budget d'achat indisponible");
    /* apport */
    const matelasCfg = Calc.matelas(objet(d.config)), matelasFoyer = matelasCfg ? matelasCfg.min : 0;
    const matelas = sc === "foyer" ? matelasFoyer : matelasFoyer / 2;
    let apport;
    if (o.apport != null) apport = { total: +o.apport, sans_per: +o.apport, per: 0, detail: [], impots: 0, matelas_exclu: matelas, impose: true };
    else {
      const cc = Dn.construireCompartiments(ctx);
      const sep = Dn.ecarterIndisponibles(cc.comps, ctx);
      sep.exclus.forEach(x => avertissements.push("apport : « " + x.enveloppe + " » (" + O.eur(x.valeur) + ") n'est pas compté, son impôt de sortie est inconnu" + (x.manquants.length ? " — repère manquant (" + x.manquants.join(", ") + ")" : " — " + (x.mentions[0] || "règle fiscale indisponible"))));
      const comps = sep.gardes.filter(c => c.v0 > 0).map(c => ({ id: c.id, enveloppe: c.enveloppe, type: c.type, valeur: c.v0, base: c.base0, dispo: c.dispo, prep: c.prep, pee_disponible: c.pee_disponible }));
      const plan = F.planRetrait(comps, Infinity, { date: today, matelas, rp: (o.usage || "rp") === "rp", niveau_max: 4 });
      const detail = plan.sources.map(s => ({ enveloppe: s.enveloppe, brut: s.brut, net: s.net, impots: s.impots, type: (comps.find(c => c.id === s.id) || {}).type }));
      const per = detail.filter(x => x.type === "per").reduce((a, x) => a + x.net, 0);
      apport = { total: plan.net_obtenu, sans_per: plan.net_obtenu - per, per, detail, impots: plan.impots, matelas_exclu: matelas, impose: false, exclus: sep.exclus };
      if (per > 0) avertissements.push("le PER (" + O.eur(per) + ") n'est mobilisable que pour l'achat de la résidence principale (déblocage anticipé) : il est indiqué à part");
      sep.gardes.filter(c => c.type === "pea" && c.v0 > 0 && c.prep.seuil && today < c.prep.seuil).forEach(c => avertissements.push("le PEA « " + c.enveloppe + " » a moins de 5 ans : il n'est pas compté (un retrait clôturerait le plan)"));
    }
    const fraisAcq = o.neuf ? "neuf" : o.primo ? "primo" : "ancien";
    const base = { mensualite_max: mensMax, duree_ans: dureeAmort, taux_pct: taux.valeur, assurance_pct: assPct, apport: apport.total, garantie_pct: gar, frais_dossier: dos, frais_acquisition: fa };
    const cal = calculer(base);
    /* reste à vivre */
    const mensNouvelle = cal.echeance + cal.assurance_mensuelle;
    const resteAVivre = rev.total - charges - mensNouvelle, hors = depensesHorsLogement(d, sc);
    /* sensibilité : taux du jour −1 / 0 / +1 point × 20 et 25 ans */
    const sensibilite = [];
    for (const ans of [20, 25]) for (const delta of [-1, 0, 1]) {
      const tp = Math.max(0.05, taux.valeur + delta), r = calculer(Object.assign({}, base, { duree_ans: ans, taux_pct: tp }));
      sensibilite.push({ duree_ans: ans, delta_pt: delta, taux_pct: tp, montant_empruntable: r.emprunt, budget_achat: r.budget[fraisAcq], budget_achat_par_type: r.budget });
    }
    /* TAEG estimé et taux d'usure */
    const n = dureeAmort * 12, taeg = C.taeg(cal.emprunt, cal.garantie + cal.dossier, mensNouvelle, n);
    const tr = trancheUsure(duree), u = ctx.rv("taux_usure_" + tr);
    const usure = u === undefined ? { valeur: null, tranche: tr, indisponible: true } : { valeur: u, tranche: tr, depasse: taeg > u + 1e-9, date_effet: (ctx.R["taux_usure_" + tr] || {}).dateEffet || null };
    if (u === undefined) { ctx.manquant("taux_usure_" + tr, "taux d'usure"); avertissements.push("taux d'usure indisponible (repère manquant) : TAEG non comparé"); }
    else if (usure.depasse) avertissements.push("le TAEG estimé (" + O.frc(taeg, 2) + " %) dépasse le taux d'usure (" + O.frc(u, 2) + " %) : la banque ne pourrait pas accorder ce prêt");
    ctx.utilises.forEach((r, cle) => sources.set(cle, { cle, titre: r.sourceTitre || null, url: r.sourceUrl || null, verifie_le: r.verifieLe || null }));
    return {
      perimetre: sc, revenus_retenus: { total: rev.total, detail: rev.detail }, charges, taux_effort_pct: effort, mensualite_max: mensMax, duree_ans: duree, duree_amortissement_ans: dureeAmort, differe_ans: differe,
      taux: taux, assurance_pct: assPct, montant_empruntable: cal.emprunt, echeance: cal.echeance, assurance_mensuelle: cal.assurance_mensuelle,
      apport, frais: { acquisition_type: fraisAcq, acquisition_pct: fa[fraisAcq], garantie: cal.garantie, dossier: cal.dossier },
      budget_achat: cal.budget[fraisAcq], budget_achat_par_type: cal.budget, reste_a_vivre: resteAVivre, mensualite_nouvelle: mensNouvelle, depenses_hors_logement: hors,
      sensibilite, taeg_estime: taeg, usure, avertissements, mention: MENTION, sources: [...sources.values()], manquants: [...ctx.manquants.keys()],
    };
  }

  return { MENTION, trancheUsure, tauxDuJour, revenusRetenus, depensesHorsLogement, capaciteEmprunt };
});
