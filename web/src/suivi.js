/* Suivi de mes lignes (SUIVI : GOV1 rôles et politique de suivi, SCO2 météo de chaque ligne). Module pur, sans DOM, au tutoiement.
   Spec : docs/superpowers/specs/2026-10-15-suivi-lignes-design.md (§ 4, § 5, résolutions R1 à R18 du § 18) ; cas de référence :
   test/fixtures/suivi-cas.json (la fixture fait foi). Global Suivi (navigateur), module CommonJS sous Node, copie générée dans le
   connecteur (supabase/functions/mcp/suivi.gen.js, npm run gen) : une seule logique pour l'app et pour Claude.

   Suivi.roleParDefaut(ligne, instrument, objectifs, today, opts?) → { role: reserve|coeur|satellite|null, raison }
   Suivi.roleEffectif(data, position_id, today) → rôle validé, sinon proposé (null = non classé : cœur pour la fréquence, satellite pour le plafond)
   Suivi.politique(data, today) → { revue, seuils, plafond_satellite_pct, mois_revue_coeur, source, mentions, … }
   Suivi.systeme(data, today) → { parts, part_satellite_investi_pct, plafond_satellite_pct, depasse, lignes_satellite, lignes_non_classees, … }
   Suivi.constats(data, position_id, today?) → [{ cle, statut, mesure, repere, pourquoi, calcul, donnees, manque, source_donnees, confiance }]
   Suivi.meteo(constats, role, revue?, today?) → { meteo: clair|eclaircies|a_regarder|a_completer, couverture, gelee_jusquau? }
   Suivi.declencheurs(data, today, options?) → [{ cle, portee, classe?, enveloppe?, objectif?, constat?, position_ids, mesure, seuil, montant?, titre,
        pourquoi, source, levier, visible, raison_visibilite, verdict }]
   Suivi.vautLeCout(changement, data, options?) → { verdict, gain_annuel, cout_unique, cout_detail, point_mort_ans, horizon_ans, … }
   Suivi.habitudes(data, today) → [{ cle, mesure, palier, prochain_palier, texte }]
   Suivi.vue(data, today, options?) et Suivi.ligne(data, position_id, today, options?) : les vues de l'app et du connecteur (tout ce qui précède, assemblé).

   data = { positions, instruments, expositions?, config: { enveloppes_infos, frais_enveloppes, suivi }, profil, objectifs, risque: { profil }, routines:
   { passages, revue_coeur_faite_le, derniere_revue }, cours?, sante?, reperes?, classes? } (formes de l'app) ; today = AAAA-MM-JJ (Paris).
   Règle de présentation (spec § 9.1) : tout titre affiché nomme une classe et une enveloppe (ou un objectif), jamais un instrument ; les
   instruments ne figurent que dans position_ids et donnees. Les repères de suivi (CONV) ont une valeur de secours ; les repères fiscaux
   n'en ont jamais (ProjectionFiscalite : repère manquant = pas de verdict). */
(function (root, factory) {
  const cjs = typeof module === "object" && module.exports;
  const dep = (nom, global) => (cjs ? require("./" + nom + ".js") : root[global]);
  const api = factory({
    Calc: dep("calc", "Calc"), Marche: dep("marche", "Marche"), Risque: dep("risque", "Risque"), Pratiques: dep("pratiques", "Pratiques"),
    F: dep("projection-fiscalite", "ProjectionFiscalite"), O: dep("projection-outils", "ProjectionOutils"), Calendrier: dep("calendrier", "Calendrier"),
    Reperes: dep("reperes", "Reperes"),
  });
  if (cjs) module.exports = api;
  else root.Suivi = api;
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";
  const { Calc, Marche, Risque, Pratiques, F, O, Calendrier, Reperes } = D;

  /* ================================================================== outils */
  const objet = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const liste = v => (Array.isArray(v) ? v : []);
  const connu = v => v !== null && v !== undefined && v !== "" && isFinite(+v);
  const somme = (L, f) => L.reduce((a, x) => a + f(x), 0);
  const r2 = x => Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;
  const r4 = x => Math.round((x + Number.EPSILON * Math.sign(x)) * 10000) / 10000;
  const r6 = x => Math.round(x * 1e6) / 1e6;
  const sansAccent = s => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const estDate = s => O.estDate(s);
  const dateCible = o => (o && (o.dateCible || o.date_cible)) || null;
  const mois2 = s => +String(s).slice(5, 7);
  /** Mois révolus entre deux dates AAAA-MM-JJ (convention de la fixture : le mois n'est compté que si le quantième est atteint). */
  function moisRevolus(a, b) {
    const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
    return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  }
  const frc = (x, d) => O.frc(x, d == null ? 0 : d);
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  const eur = (x, d) => O.eur(x, d == null ? 0 : d);
  const pct = (x, d) => O.frc(x, d == null ? 1 : d) + " %";
  const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const moisEnLettres = m => NOMS_MOIS[(m - 1 + 12) % 12];
  const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const dateCourte = d => (estDate(d) ? (+d.slice(8, 10) === 1 ? "1er" : +d.slice(8, 10)) + " " + MOIS_COURTS[mois2(d) - 1] : String(d || ""));

  /* ================================================================== repères (valeurs de secours = conventions Boussole de la fixture) */
  const DEFAUTS = {
    suivi_plafond_satellite_prudent: 5, suivi_plafond_satellite_modere: 10, suivi_plafond_satellite_equilibre: 15, suivi_plafond_satellite_dynamique: 20,
    suivi_plafond_satellite_offensif: 25, suivi_seuil_ecart_pts: 5, suivi_horizon_long_ans: 8, suivi_horizon_reserve_ans: 3, suivi_horizon_suppose_ans: 10,
    suivi_seuil_baisse_satellite_pct: 25, suivi_ligne_satellite_max_pct: 5, suivi_societe_max_pct: 10, suivi_frais_plancher_pct: 0.5, suivi_cout_bon_marge_pct: 0.1,
    suivi_volatilite_surveiller_pct: 20, suivi_devise_info_pct: 50, suivi_devise_prudent_pct: 30, suivi_encours_bon_eur: 100000000, suivi_encours_bas_eur: 20000000,
    suivi_anciennete_fonds_ans: 3, suivi_chevauchement_surveiller_pct: 30, suivi_chevauchement_travailler_pct: 60, suivi_croisement_exposition_pct: 5,
    suivi_croisement_societe_pct: 1, suivi_couverture_min_pct: 60, suivi_point_mort_max_ans: 3, suivi_point_mort_part_horizon_pct: 50, suivi_aggravation_pct: 50,
    courtage_banque_reseau_pct: 0.65, courtage_en_ligne_pct: 0.45, courtage_neo_courtier_pct: 0.15, suivi_demi_ecart_cote_pct: 0.1, suivi_arbitrage_av_defaut_pct: 1,
  };
  const PLAFOND_PROFIL = { prudent: "suivi_plafond_satellite_prudent", modere: "suivi_plafond_satellite_modere", equilibre: "suivi_plafond_satellite_equilibre",
    dynamique: "suivi_plafond_satellite_dynamique", offensif: "suivi_plafond_satellite_offensif" };
  const SOURCE_AMF = { titre: "AMF, « Les frais des placements financiers continuent de baisser » (27 avril 2026)", url: "https://www.amf-france.org/fr/actualites-publications/actualites/les-frais-des-placements-financiers-continuent-de-baisser-en-particulier-ceux-des-fonds" };

  /* ================================================================== libellés (français, tutoiement) */
  const ROLES = ["reserve", "coeur", "satellite"];
  const ROLES_LIB = { reserve: "Réserve", coeur: "Cœur", satellite: "Satellite" };
  const METEOS = ["clair", "eclaircies", "a_regarder", "a_completer"];
  const METEO_LIB = { clair: "Au clair", eclaircies: "Éclaircies", a_regarder: "À regarder à ta revue", a_completer: "À compléter" };
  const STATUT_LIB = { bon: "Bon", a_surveiller: "À surveiller", a_travailler: "Au-dessus du repère", a_completer: "À compléter" };
  const CONSTATS_LIB = { cout: "Coût", poids: "Poids", chevauchement: "Chevauchement", classe_risque: "Classe de risque", solidite: "Solidité du support", enveloppe: "Enveloppe", devise: "Devise" };
  const VERDICT_LIB = { vaut_le_cout: "Ça vaut le coût", a_peser: "À peser", ne_rien_faire: "Ne rien changer à cette classe" };
  const CLASSE_LIB = { actions: "Actions", small_caps: "Petites capitalisations", emergents: "Actions émergentes", levier: "Produits à effet de levier", obligations: "Obligations",
    immobilier: "Immobilier", monetaire: "Monétaire et livrets", fonds_euros: "Fonds euros", or: "Or", crypto: "Crypto", autres: "Autres actifs",
    securise: "Fonds euros et monétaire", speculatif: "Crypto et levier", diversifiants: "Or et autres" };
  const classeLib = c => CLASSE_LIB[c] || Risque.GROUPES_LABELS[c] || String(c || "");
  const LEVIERS = {
    versements_orientes: { cle: "versements_orientes", libelle: "Orienter tes prochains versements" },
    reequilibrer: { cle: "reequilibrer", libelle: "Ramener la classe vers sa cible" },
    frais_classe: { cle: "frais_classe", libelle: "Réduire les frais de la classe" },
    reduire_satellite: { cle: "reduire_satellite", libelle: "Revenir sous le plafond satellite" },
    securiser_objectif: { cle: "securiser_objectif", libelle: "Sécuriser l'argent d'un objectif proche" },
    fonds_ferme: { cle: "fonds_ferme", libelle: "Comprendre la fermeture d'un fonds" },
    changer_enveloppe: { cle: "changer_enveloppe", libelle: "Changer d'enveloppe pour une classe" },
  };

  /* ================================================================== lecture des données */
  function lecteurReperes(d) {
    const L = liste(d.reperes);
    return cle => Reperes.valeur(L, cle, DEFAUTS[cle]);
  }
  /** Enveloppe (infos DAT1) d'une ligne : { cle, nom, type, infos }. */
  function enveloppeDe(cfg, positions, nom, owner) {
    const inf = objet(cfg.enveloppes_infos);
    const cle = nom ? Calendrier.cleEnveloppe(nom, owner, positions, inf) : null;
    const infos = cle ? objet(inf[cle]) : {};
    const declare = typeof infos.type === "string" && Calendrier.TYPES[infos.type] ? infos.type : null;
    return { cle, nom: nom || null, type: declare || (nom ? Calendrier.typeDeduit(nom) : null), infos };
  }
  /** Frais d'une enveloppe (config.frais_enveloppes), nom exact ou sans accents ni casse. */
  function fraisEnveloppe(cfg, nom) {
    const Fr = objet(cfg.frais_enveloppes);
    if (!nom) return {};
    if (Fr[nom] && typeof Fr[nom] === "object") return Fr[nom];
    const k = Object.keys(Fr).find(x => sansAccent(x).trim() === sansAccent(nom).trim());
    return k && typeof Fr[k] === "object" ? Fr[k] : {};
  }
  const TYPES_CONTRAT = ["assurance_vie", "capitalisation", "per", "percol", "pee"];
  const TYPES_PEA = ["pea", "pea_pme", "pea_jeune"];

  /** Objectifs à échéance future auxquels une ligne est rattachée (poche ou enveloppe). */
  function objectifsDe(p, objectifs, today) {
    return objectifs.filter(o => o && dateCible(o) && estDate(dateCible(o)) && dateCible(o) >= today &&
      (liste(o.poches).includes(p.bloc) || (p.envelope && liste(o.enveloppes).includes(p.envelope))));
  }
  /** Horizon (mois) d'une ligne : l'objectif rattaché le plus proche, sinon le plus lointain du foyer, sinon l'horizon supposé. */
  function horizonLigneMois(p, objectifs, today, rep) {
    const mois = o => moisRevolus(today, dateCible(o));
    const siens = objectifsDe(p, objectifs, today);
    if (siens.length) return { mois: Math.min(...siens.map(mois)), suppose: false };
    return horizonFoyerMois(objectifs, today, rep);
  }
  function horizonFoyerMois(objectifs, today, rep) {
    const futurs = objectifs.filter(o => o && dateCible(o) && estDate(dateCible(o)) && dateCible(o) >= today);
    if (futurs.length) return { mois: Math.max(...futurs.map(o => moisRevolus(today, dateCible(o)))), suppose: false };
    return { mois: rep("suivi_horizon_suppose_ans") * 12, suppose: true };
  }

  /* ---------- rôle proposé ---------- */
  const MOTIFS = {
    thematique: /\b(eau|water|climat|clean|energies? (propres?|renouvelables?)|sante|health|biotech|technologi|tech|semi.?conducteurs?|robot|intelligence artificielle|ia|ai|cyber|luxe|defense|hydrogene|uranium|lithium|batteries?|banques?|or minier|gold miners?)\b/,
    pays_unique: /\b(inde|india|chine|china|japon|japan|bresil|brazil|coree|korea|taiwan|vietnam|mexique|mexico|turquie|turkey|suisse|switzerland|royaume.?uni|united kingdom|canada|australie|australia|afrique du sud|south africa|indonesie|indonesia|arabie saoudite|saudi)\b/,
  };
  const CLASSES_ACTIONS = ["actions", "small_caps", "emergents"];
  const RE_NOM_FONDS = /\betf\b|\betc\b|ucits|\bfonds\b|\bfund\b|sicav|\bfcp\b|opcvm|tracker|indiciel|\bindex\b|\bmsci\b|s&p|stoxx|nasdaq|ftse|amundi|lyxor|ishares|xtrackers|vanguard/;
  const CLASSES_RISQUEES = ["actions", "small_caps", "emergents", "levier", "crypto"];
  /** Rôle proposé pour une ligne (déterministe, spec § 4.1 et résolutions R2, R3) ; `today` sert à l'échéance proche de la réserve. */
  function roleParDefaut(ligne, instrument, objectifs, today, opts) {
    const p = objet(ligne), ins = objet(instrument), o = objet(opts);
    const ter = connu(ins.ter) ? +ins.ter : connu(p.ter) ? +p.ter : null;
    const a = analyse(p, ter, o.classes, o.classes ? JSON.stringify(o.classes) : "", ins);
    return roleDefaut(p, ins, ter, a.classe, a.fam, a.nature, a.motif, objectifs, today, o.rep || lecteurReperes({ reperes: o.reperes }));
  }
  function roleDefaut(p, ins, ter, classe, fam, nature, motif, objectifs, today, rep) {
    const aujourdhui = today && estDate(today) ? today : new Date().toISOString().slice(0, 10);
    if (fam === "courant") return { role: "reserve", raison: "famille_courant" };
    if (fam === "epargne") return { role: "reserve", raison: "famille_epargne" };
    if (classe === "monetaire" || classe === "fonds_euros") {
      const seuil = rep("suivi_horizon_reserve_ans") * 12;
      const proche = liste(objectifs).some(ob => ob && (ob.type === "matelas" || (dateCible(ob) && estDate(dateCible(ob)) && dateCible(ob) >= aujourdhui && moisRevolus(aujourdhui, dateCible(ob)) < seuil)) &&
        (liste(ob.poches).includes(p.bloc) || (p.envelope && liste(ob.enveloppes).includes(p.envelope))) && (ob.type === "matelas" || (dateCible(ob) >= aujourdhui)));
      if (proche) return { role: "reserve", raison: "objectif_proche" };
    }
    if (ins.type_support === "action" || (nature === "direct" && CLASSES_ACTIONS.includes(classe))) return { role: "satellite", raison: "action_directe" };
    if (ins.type_support === "crypto" || classe === "crypto") return { role: "satellite", raison: "crypto" };
    if ((connu(ins.levier) && +ins.levier > 1) || classe === "levier") return { role: "satellite", raison: "levier" };
    if (classe === "small_caps") return { role: "satellite", raison: "small_caps" };
    if (motif) return { role: "satellite", raison: motif };
    if (classe === "autres" && ter == null && !ins.type_support) return { role: null, raison: "nature_inconnue" };
    return { role: "coeur", raison: "par_defaut" };
  }
  const RAISON_LIB = {
    famille_courant: "compte courant", famille_epargne: "épargne disponible", objectif_proche: "argent d'un projet à moins de 3 ans", action_directe: "action en direct",
    crypto: "crypto", levier: "produit à effet de levier", small_caps: "petites capitalisations", thematique: "fonds thématique ou sectoriel",
    pays_unique: "fonds d'un seul pays", nature_inconnue: "nature de la ligne inconnue", par_defaut: "placement diversifié", valide: "choisi avec Claude",
  };

  /* Analyse d'une ligne (classe de risque, famille, nature des frais, motif de satellite), mémorisée par objet de position tant que ses champs
     ne changent pas : l'état de l'app garde les mêmes objets d'un appel à l'autre. */
  const MEMO = new WeakMap();
  function analyse(p, ter, classes, sigClasses, ins) {
    const sig = [p.name, p.envelope, p.bloc, p.mode, p.isin, p.symbol, ter, sigClasses, ins && ins.categorie, ins && ins.indice].join("\u0001");
    const m = MEMO.get(p);
    if (m && m.sig === sig) return m;
    const texte = sansAccent([p.name, p.bloc, ins && ins.categorie, ins && ins.indice].filter(Boolean).join(" "));
    const classe = Marche.classeRisque(p, classes);
    let nature = Pratiques.natureFrais(p, classes, ter);
    /* une action annotée « frais courants 0 » (titre en direct) n'est pas un fonds : pas de constat de coût ni de solidité, rôle de satellite */
    if (nature === "fonds" && ter === 0 && p.mode === "market" && CLASSES_ACTIONS.includes(classe) && !RE_NOM_FONDS.test(sansAccent(p.name))) nature = "direct";
    const r = { sig, classe, fam: Calc.famille(p, classes), nature,
      motif: MOTIFS.thematique.test(texte) ? "thematique" : MOTIFS.pays_unique.test(texte) ? "pays_unique" : null };
    MEMO.set(p, r);
    return r;
  }

  /* ================================================================== contexte commun (calculé une fois par data et today) */
  const contexte = (data, today) => construire(objet(data), today || (data && data.today) || new Date().toISOString().slice(0, 10));
  function construire(d, today) {
    const cfg = objet(d.config), rep = lecteurReperes(d), objectifs = liste(d.objectifs), classes = d.classes || cfg.classes || undefined;
    const positions = liste(d.positions).filter(p => p && Calc.counted(p));
    const insts = new Map(liste(d.instruments).filter(Boolean).map(i => [i.isin, i]));
    const expos = liste(d.expositions), envCache = new Map();
    const sigClasses = classes ? JSON.stringify(classes) : "";
    const lignes = positions.map(p => {
      const ins = (p.isin && insts.get(p.isin)) || null;
      const ter = ins && connu(ins.ter) ? +ins.ter : connu(p.ter) ? +p.ter : null;
      const a = analyse(p, ter, classes, sigClasses, ins);
      return a.fam === "courant" ? null : { p, ins, ter, a };
    }).filter(Boolean).map(({ p, ins, ter, a }) => {
      const valeur = Calc.val(p), classe = a.classe, nature = a.nature;
      const prop = roleDefaut(p, ins || {}, ter, classe, a.fam, nature, a.motif, objectifs, today, rep);
      const valide = ROLES.includes(p.role), srcRole = p.roleSource || p.role_source || "valide"; // le store de l'app écrit roleSource, le connecteur role_source
      const base = p.mode === "market" && connu(p.qty) && connu(p.pru) ? +p.qty * +p.pru : null;
      const cleEnv = (p.envelope || "") + "\u0001" + (p.owner || "");
      if (!envCache.has(cleEnv)) envCache.set(cleEnv, enveloppeDe(cfg, positions, p.envelope, p.owner));
      const env = envCache.get(cleEnv);
      return { p, id: p.id, ins, ter, valeur, base, classe, nature,
        role: valide ? p.role : prop.role, roleSource: valide && srcRole !== "propose" ? "valide" : "propose", roleProp: prop.role, raison: valide && srcRole !== "propose" ? "valide" : prop.raison,
        enveloppe: p.envelope || null, env, devise: String((ins && ins.devise) || p.devise || "EUR").toUpperCase() };
    });
    const T = somme(lignes, l => l.valeur);
    const R = somme(lignes.filter(l => l.role === "reserve"), l => l.valeur);
    const ctx = { d, cfg, rep, objectifs, classes, positions, insts, expos, lignes, T, R, I: T - R, today,
      parId: new Map(lignes.map(l => [String(l.id), l])), profilRisque: objet(d.risque).profil || null };
    /* agrégats partagés par les constats (évite de les recalculer ligne par ligne) */
    ctx.parDevise = new Map();
    lignes.filter(l => l.role !== "reserve").forEach(l => ctx.parDevise.set(l.devise, (ctx.parDevise.get(l.devise) || 0) + l.valeur));
    const plafondPea = Reperes.valeur(liste(d.reperes), "pea_plafond", null);
    ctx.peaDispo = plafondPea != null && Object.keys(objet(cfg.enveloppes_infos)).some(k => { const i = objet(cfg.enveloppes_infos[k]); return i.type === "pea" && connu(i.versements_cumules) && +i.versements_cumules < plafondPea; });
    ctx.nbFonds = lignes.filter(l => l.nature === "fonds").length;
    ctx.politique = calculerPolitique(ctx);
    return ctx;
  }
  const ligneDe = (ctx, id) => ctx.parId.get(String(id)) || null;
  const roleFreq = l => (l.role === null ? "coeur" : l.role);
  const roleBase = l => (l.role === null ? "satellite" : l.role); // plafond : une ligne non classée compte dans le satellite

  /* ================================================================== politique de suivi (GOV1, § 4.2) */
  function calculerPolitique(ctx) {
    const { cfg, rep, today } = ctx, s = objet(cfg.suivi), mentions = [];
    const profil = ctx.profilRisque;
    let plafond;
    if (connu(s.plafond_satellite_pct) && +s.plafond_satellite_pct >= 0 && +s.plafond_satellite_pct <= 30) plafond = +s.plafond_satellite_pct;
    else if (profil && PLAFOND_PROFIL[profil]) plafond = rep(PLAFOND_PROFIL[profil]);
    else { plafond = rep(PLAFOND_PROFIL.modere); mentions.push("profil à faire : plafond du profil Modéré en attendant"); }
    /* bornes de la migration 0032 : une valeur hors bornes (écrite à la main en base) est ignorée, le défaut s'applique */
    const dans = (v, min, max) => connu(v) && +v >= min && +v <= max;
    const seuilEcart = dans(s.seuil_ecart_pts, 3, 10) ? +s.seuil_ecart_pts : rep("suivi_seuil_ecart_pts");
    const seuilBaisse = dans(s.seuil_baisse_satellite_pct, 10, 50) ? +s.seuil_baisse_satellite_pct : rep("suivi_seuil_baisse_satellite_pct");
    const longMois = rep("suivi_horizon_long_ans") * 12;
    const coeurs = ctx.lignes.filter(l => roleFreq(l) === "coeur");
    const courts = coeurs.filter(l => horizonLigneMois(l.p, ctx.objectifs, today, rep).mois < longMois && !horizonLigneMois(l.p, ctx.objectifs, today, rep).suppose);
    const revueCoeur = s.revue_coeur === "annuelle" || s.revue_coeur === "semestrielle" ? s.revue_coeur : courts.length ? "semestrielle" : "annuelle";
    const passages = liste(objet(ctx.d.routines).passages).filter(estDate).sort();
    /* Mois de la revue du cœur : choisi avec Claude (config.suivi), sinon celui retenu à la première clôture (routines.etat_suivi, jamais recalculé : le journal
       ne garde que les dernières revues), sinon, avant toute clôture enregistrée, celui de la plus ancienne revue connue, sinon le mois courant. */
    const moisValide = v => connu(v) && +v >= 1 && +v <= 12 && Math.round(+v) === +v;
    const memoire = objet(objet(ctx.d.routines).derniere_revue).mois_revue_coeur;
    let m = moisValide(s.mois_revue_coeur) ? +s.mois_revue_coeur : moisValide(memoire) ? +memoire : passages.length ? mois2(passages[0]) : mois2(today);
    const mois = revueCoeur === "semestrielle" ? [m, ((m + 5) % 12) + 1].sort((a, b) => a - b) : [m];
    const dansConfig = ["revue_coeur", "mois_revue_coeur", "seuil_ecart_pts", "plafond_satellite_pct", "seuil_baisse_satellite_pct"].some(k => connu(s[k]) || (typeof s[k] === "string" && s[k]));
    return {
      revue: { reserve: "mensuelle", coeur: revueCoeur, satellite: "mensuelle" },
      seuils: { seuil_ecart_pts: seuilEcart, seuil_baisse_satellite_pct: seuilBaisse, ligne_satellite_max_pct: rep("suivi_ligne_satellite_max_pct"),
        societe_max_pct: rep("suivi_societe_max_pct"), frais_plancher_pct: rep("suivi_frais_plancher_pct") },
      plafond_satellite_pct: plafond, mois_revue_coeur: mois, mois_base: m, source: dansConfig ? "config" : "defaut", profil: profil || null, mentions,
      semaine: objet(s.semaine).actif === false ? { actif: false, jour: objet(s.semaine).jour || "lundi" } : { actif: true, jour: objet(s.semaine).jour || "lundi" },
      lignes_courtes: courts.map(l => l.id), horizon_suppose: coeurs.some(l => horizonLigneMois(l.p, ctx.objectifs, today, rep).suppose),
    };
  }
  /** Prochaine revue du cœur : { date: AAAA-MM-01, mois, annee, due (à faire : ce mois-ci, ou en retard), en_retard, derniere_programmee }.
      En retard : la revue a déjà été faite au moins une fois, mais pas à son dernier mois programmé (une revue manquée n'est jamais effacée par le calendrier). */
  function prochaineRevueCoeur(ctx) {
    if (ctx.revueCoeur) return ctx.revueCoeur;
    const pol = ctx.politique, today = ctx.today, rt = objet(ctx.d.routines);
    const derniere = estDate(rt.revue_coeur_faite_le) ? rt.revue_coeur_faite_le : null, faiteMois = derniere ? derniere.slice(0, 7) : null;
    const [y, m] = [+today.slice(0, 4), mois2(today)], cm = today.slice(0, 7);
    const ym = t => Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0");
    let programmee = null;
    for (let k = 0; k <= 12 && !programmee; k++) { const t = y * 12 + (m - 1) - k; if (pol.mois_revue_coeur.includes((t % 12) + 1)) programmee = ym(t); }
    const candidats = [];
    for (let k = 0; k < 14; k++) { const t = y * 12 + (m - 1) + k; if (pol.mois_revue_coeur.includes((t % 12) + 1)) candidats.push(ym(t)); }
    const faiteCeMois = faiteMois === cm;
    let r;
    if (programmee && programmee < cm && faiteMois && faiteMois < programmee) r = { date: programmee + "-01", mois: mois2(programmee + "-01"), annee: +programmee.slice(0, 4), due: true, en_retard: true };
    else {
      const choix = candidats.find(c => (c === cm ? !faiteCeMois : true) && (!derniere || c > faiteMois)) || candidats[0];
      r = { date: choix + "-01", mois: mois2(choix + "-01"), annee: +choix.slice(0, 4), due: choix === cm, en_retard: false };
    }
    r.derniere_programmee = programmee;
    ctx.revueCoeur = r;
    return r;
  }

  function politique(data, today) { return contexte(data, today).politique; }
  function roleEffectif(data, position_id, today) { const l = ligneDe(contexte(data, today), position_id); return l ? l.role : null; }

  /* ================================================================== système cœur et satellite (R1) */
  function systeme(data, today) { return systemeCtx(contexte(data, today)); }
  function systemeCtx(ctx) {
    const { lignes, T, I } = ctx, pol = ctx.politique;
    const val = L => somme(L, l => l.valeur);
    const reserve = lignes.filter(l => l.role === "reserve"), coeur = lignes.filter(l => l.role === "coeur"), sat = lignes.filter(l => l.role === "satellite"),
      nc = lignes.filter(l => l.role === null);
    const part = x => (T > 0 ? r4(x * 100 / T) : 0);
    const satInvesti = val(sat) + val(nc), partInvesti = I > 0 ? satInvesti * 100 / I : 0;
    return {
      parts: { reserve: part(val(reserve)), coeur: part(val(coeur)), satellite: part(val(sat)), non_classees: part(val(nc)) },
      montants: { reserve: r2(val(reserve)), coeur: r2(val(coeur)), satellite: r2(val(sat)), non_classees: r2(val(nc)), total: r2(T), investi: r2(I) },
      part_satellite_investi_pct: r4(partInvesti), plafond_satellite_pct: pol.plafond_satellite_pct, depasse: r6(partInvesti) > pol.plafond_satellite_pct,
      lignes_satellite: sat.map(l => l.id), lignes_non_classees: nc.map(l => l.id), lignes_coeur: coeur.map(l => l.id), lignes_reserve: reserve.map(l => l.id),
      roles_a_confirmer: lignes.filter(l => l.roleSource !== "valide").map(l => l.id),
      profil_a_faire: pol.mentions.length > 0,
    };
  }

  /* ================================================================== constats et météo (SCO2, § 5) */
  const REPERE_CLASSE = c => Pratiques.REPERES_FRAIS[c] || null;
  function fraisTotal(ctx, l) {
    const fe = fraisEnveloppe(ctx.cfg, l.enveloppe);
    return (connu(fe.garde_pct) ? +fe.garde_pct : 0) + (TYPES_CONTRAT.includes(l.env.type) && connu(fe.gestion_uc_pct) ? +fe.gestion_uc_pct : 0);
  }
  function chevauchementDe(ctx, l) {
    const fonds = ctx.lignes.filter(x => x.nature === "fonds" && x.p.isin);
    const exp = isin => ctx.expos.filter(e => e && e.isin === isin && e.axe === "ligne" && connu(e.poids_pct)).sort((a, b) => +b.poids_pct - +a.poids_pct || (a.cle < b.cle ? -1 : 1)).slice(0, 10);
    const A = exp(l.p.isin);
    if (!A.length) return null;
    const totA = somme(A, e => +e.poids_pct);
    let meilleur = null;
    for (const f of fonds) {
      if (f.id === l.id || f.p.isin === l.p.isin) continue;
      const B = exp(f.p.isin);
      if (!B.length) continue;
      const wB = new Map(B.map(e => [e.cle, +e.poids_pct]));
      const commun = somme(A.filter(e => wB.has(e.cle)), e => Math.min(+e.poids_pct, wB.get(e.cle)));
      const valeur = totA > 0 ? commun * 100 / totA : 0;
      if (!meilleur || valeur > meilleur.valeur) meilleur = { valeur, avec: f.id, commun, totA };
    }
    return meilleur;
  }
  /** Constats d'une ligne (contrat de critère de CP4, sans points) : seuls les constats applicables figurent dans la liste. */
  function constats(data, position_id, today) {
    const ctx = contexte(data, today || (data && data.today) || new Date().toISOString().slice(0, 10)), l = ligneDe(ctx, position_id);
    if (!l) return [];
    return constatsDe(ctx, l);
  }
  function constatsDe(ctx, l) {
    const { rep } = ctx, out = [];
    const donnee = (extra) => Object.assign({ libelle: l.p.name || l.p.bloc || "Ligne", valeur: r2(l.valeur), lien: { ligne: l.id } }, extra || {});
    const base = (cle, statut, o) => out.push(Object.assign({ cle, statut, libelle: CONSTATS_LIB[cle], mesure: null, repere: null, pourquoi: "", calcul: [], donnees: [], manque: [], source_donnees: "", confiance: statut === "a_completer" ? "absente" : "complete" }, o));
    const estFonds = l.nature === "fonds";
    const marge = rep("suivi_cout_bon_marge_pct"), plancher = rep("suivi_frais_plancher_pct");
    /* cout */
    if (estFonds) {
      const rf = REPERE_CLASSE(l.classe), total = l.ter != null ? l.ter + fraisTotal(ctx, l) : null;
      if (l.ter == null) base("cout", "a_completer", { repere: rf ? { texte: rf.texte, bas: rf.bas, haut: rf.haut } : null, manque: ["Les frais courants de ce fonds (DIC)"],
        pourquoi: "Pas de constat sur le coût : les frais courants du fonds ne sont pas renseignés.", source_donnees: "frais courants du fonds (DIC)" });
      else {
        let statut;
        if (!rf) statut = r6(l.ter) <= 0.4 ? "bon" : "a_surveiller";
        else if (r6(l.ter) <= r6(rf.bas + marge)) statut = "bon";
        else if (r6(l.ter) > rf.haut && r6(l.ter) > plancher) statut = "a_travailler";
        else statut = "a_surveiller";
        const texteRepere = rf ? rf.texte : "pas de repère de frais pour cette classe : au plus « à surveiller » au-delà de 0,40 % par an";
        base("cout", statut, { mesure: { valeur: l.ter, unite: "%", texte: pct(l.ter, 2) + " de frais courants par an" + (total != null && total > l.ter ? " (" + pct(total, 2) + " avec les frais d'enveloppe)" : "") },
          repere: rf ? { texte: texteRepere, bas: rf.bas, haut: rf.haut } : { texte: texteRepere }, source_donnees: "frais courants du fonds (DIC), repères de frais de classe",
          pourquoi: statut === "bon" ? "Les frais courants de la ligne sont dans le bas du repère de leur classe." : statut === "a_surveiller" ? "Les frais courants sont au-dessus du bas du repère de leur classe." : "Les frais courants dépassent le haut du repère de leur classe et 0,50 % par an.",
          calcul: ["Frais courants : " + pct(l.ter, 2), rf ? "Repère de la classe : " + frc(rf.bas, 2) + " à " + frc(rf.haut, 2) + " % par an" : "Classe sans repère de frais", "Seuil du « bon » : bas du repère + " + frc(marge, 2) + " point"],
          donnees: [donnee({ ter: l.ter })] });
      }
    }
    /* poids */
    if (l.role === "satellite") {
      const maxPct = ctx.politique.seuils.ligne_satellite_max_pct, poids = ctx.I > 0 ? l.valeur * 100 / ctx.I : 0;
      const statut = r6(poids) > maxPct ? "a_travailler" : r6(poids) >= r6(maxPct * 0.8) ? "a_surveiller" : "bon";
      base("poids", statut, { mesure: { valeur: r4(poids), unite: "%", texte: pct(poids, 1) + " de ton financier investi" }, repere: { texte: "Une ligne du satellite pèse au plus " + frc(maxPct, 0) + " % du financier investi", max: maxPct, unite: "%" },
        pourquoi: statut === "a_travailler" ? "Au-dessus du repère de " + frc(maxPct, 0) + " % du financier investi." : statut === "a_surveiller" ? "Proche du repère de " + frc(maxPct, 0) + " % (de 80 à 100 %)." : "Sous le repère de " + frc(maxPct, 0) + " %.",
        calcul: [eur(l.valeur) + " ÷ " + eur(ctx.I) + " = " + pct(poids, 2)], source_donnees: "tes lignes", donnees: [donnee({ poids_pct: r4(poids) })] });
    }
    /* chevauchement */
    if (estFonds && ctx.nbFonds >= 2) {
      const ch = chevauchementDe(ctx, l);
      if (!ch) base("chevauchement", "a_completer", { manque: ["Les 10 premières lignes de chaque fonds (pas encore disponibles)"], pourquoi: "Le chevauchement avec tes autres fonds se calcule avec leur composition, pas encore disponible.", source_donnees: "composition des fonds" });
      else {
        const sv = rep("suivi_chevauchement_surveiller_pct"), tr = rep("suivi_chevauchement_travailler_pct"), v = ch.valeur;
        const statut = r6(v) > tr ? "a_travailler" : r6(v) >= sv ? "a_surveiller" : "bon";
        base("chevauchement", statut, { mesure: { valeur: r4(v), unite: "%", texte: pct(v, 1) + " des 10 premières lignes en commun avec un autre de tes fonds" }, repere: { texte: "Moins de " + frc(sv, 0) + " % : bon ; au-delà de " + frc(tr, 0) + " % : doublon", surveiller: sv, travailler: tr, unite: "%" },
          pourquoi: statut === "a_travailler" ? "Un doublon : des frais et de la complexité sans diversification en plus." : statut === "a_surveiller" ? "Une partie notable des principales lignes est la même." : "Peu de lignes en commun.",
          calcul: ["Poids communs des 10 premières lignes (minimum des deux poids) : " + frc(ch.commun, 2) + " %", "Poids des 10 premières lignes du fonds : " + frc(ch.totA, 2) + " %", "Rapport : " + pct(v, 2)], source_donnees: "composition des fonds", donnees: [donnee()] });
      }
    }
    /* classe_risque */
    {
      const vol = (Marche.CLASSES[l.classe] || Marche.CLASSES.autres).volatilite, seuilVol = rep("suivi_volatilite_surveiller_pct");
      const levier = l.classe === "levier" || (l.ins && connu(l.ins.levier) && +l.ins.levier > 1);
      const statut = levier || l.classe === "crypto" ? "a_travailler" : vol >= seuilVol ? "a_surveiller" : "bon";
      base("classe_risque", statut, { mesure: { valeur: vol, unite: "%", texte: "Classe : " + classeLib(l.classe) + ", volatilité historique d'environ " + frc(vol, 0) + " % par an" },
        repere: { texte: "À surveiller dès " + frc(seuilVol, 0) + " % de volatilité ; levier et crypto sont des classes spéculatives", surveiller: seuilVol, unite: "%" },
        pourquoi: statut === "a_travailler" ? "Classe spéculative : les pertes peuvent dépasser 50 % en quelques mois." : statut === "a_surveiller" ? "Classe plus volatile que les actions du monde développé." : "Classe sans levier ni volatilité extrême.",
        calcul: ["Volatilité historique de la classe : " + frc(vol, 0) + " % par an (marche.js)"], source_donnees: "statistiques historiques de la classe", donnees: [donnee()] });
    }
    /* solidité */
    if (estFonds) {
      const ins = l.ins || {}, enc = connu(ins.encours_eur) ? +ins.encours_eur : null, dc = ins.date_creation && estDate(ins.date_creation) ? ins.date_creation : null;
      if (enc == null && !dc) base("solidite", "a_completer", { manque: ["L'encours et la date de création du fonds (pas encore disponibles)"], pourquoi: "Pas de constat sur la solidité du support : encours et ancienneté inconnus.", source_donnees: "données du fonds (encours, ancienneté)" });
      else {
        const encBon = rep("suivi_encours_bon_eur"), encBas = rep("suivi_encours_bas_eur"), anc = rep("suivi_anciennete_fonds_ans");
        const ans = dc ? moisRevolus(dc, ctx.today) / 12 : null;
        const hors = (enc != null && enc < encBon) || (ans != null && ans <= anc);
        base("solidite", hors ? "a_surveiller" : "bon", { mesure: { valeur: enc, unite: "€", anciennete_ans: ans != null ? r2(ans) : null, texte: [enc != null ? "Encours " + eur(enc) : null, ans != null ? "Ancienneté " + frc(ans, 0) + " ans" : null].filter(Boolean).join(", ") },
          repere: { texte: "Encours d'au moins " + eur(encBon) + " et plus de " + frc(anc, 0) + " ans (repères Boussole, sans source publique : jamais au-delà de « à surveiller »)", encours_min: encBon, anciennete_min_ans: anc },
          pourquoi: hors ? (enc != null && enc < encBas ? "Encours bas : un petit fonds peut fermer ou fusionner." : "L'encours ou l'ancienneté sont sous les repères.") : "Encours et ancienneté au-dessus des repères.",
          calcul: ["Encours : " + (enc != null ? eur(enc) : "inconnu"), "Ancienneté : " + (ans != null ? frc(ans, 1) + " ans" : "inconnue")], source_donnees: "données du fonds (encours, ancienneté)", confiance: enc != null && dc ? "complete" : "partielle", donnees: [donnee()] });
      }
    }
    /* enveloppe */
    {
      const type = l.env.type, actionsClasse = ["actions", "small_caps", "emergents"].includes(l.classe);
      const surveille = type === "compte_titres" && actionsClasse && ctx.peaDispo;
      base("enveloppe", surveille ? "a_surveiller" : "bon", { mesure: { valeur: null, texte: "Enveloppe : " + (l.enveloppe || "non précisée") },
        repere: { texte: "Une enveloppe plus favorable existe-t-elle pour cette classe ? Question posée au niveau de la classe, pas de la ligne" },
        pourquoi: surveille ? "Un PEA du foyer a encore de la place : pour les actions, il est en général plus favorable qu'un compte-titres (si la ligne est éligible au PEA)." : "Rien à dire sur l'enveloppe de cette ligne.",
        calcul: surveille ? ["Compte-titres, classe " + classeLib(l.classe) + ", et un PEA du foyer sous son plafond de versements"] : [], source_donnees: "calendrier de tes enveloppes, repères fiscaux", donnees: [donnee()] });
    }
    /* devise */
    {
      const euro = l.devise === "EUR", seuil = ctx.profilRisque === "prudent" ? rep("suivi_devise_prudent_pct") : null;
      const montantDev = euro ? 0 : ctx.parDevise.get(l.devise) || 0, partDev = euro || ctx.I <= 0 ? 0 : montantDev * 100 / ctx.I;
      const surveille = !euro && seuil != null && r6(partDev) > seuil;
      base("devise", surveille ? "a_surveiller" : "bon", { mesure: { valeur: r4(partDev), unite: "%", devise: l.devise, texte: euro ? "En euros" : "En " + l.devise + " : " + pct(partDev, 1) + " de ton financier investi" },
        repere: { texte: "Information : à surveiller seulement pour un profil Prudent au-delà de " + frc(rep("suivi_devise_prudent_pct"), 0) + " % en devises", max: rep("suivi_devise_prudent_pct"), unite: "%" },
        pourquoi: surveille ? "Plus de " + frc(seuil, 0) + " % de ton financier investi dans une devise autre que l'euro, pour un profil Prudent." : euro ? "Ligne en euros." : "Exposition au change : une information, pas un défaut.",
        calcul: euro ? [] : [eur(montantDev) + " en " + l.devise + " ÷ " + eur(ctx.I) + " = " + pct(partDev, 1)], source_donnees: "devise du support", donnees: [donnee()] });
    }
    return out;
  }
  /** Météo d'une ligne : agrégation sans note (spec § 5.2). `revue` = { prochaine, meteo_figee } gèle la météo d'une ligne du cœur entre deux revues. */
  function meteo(constatsListe, role, revue, today, seuilPct) {
    const L = liste(constatsListe), calcules = L.filter(c => c.statut !== "a_completer");
    const couverture = { calcules: calcules.length, applicables: L.length };
    const seuil = connu(seuilPct) ? +seuilPct : DEFAUTS.suivi_couverture_min_pct; // repère « suivi_couverture_min_pct » (60 %)
    let m;
    if (!L.length || calcules.length * 100 < L.length * seuil) m = "a_completer";
    else if (calcules.some(c => c.statut === "a_travailler")) m = "a_regarder";
    else if (calcules.some(c => c.statut === "a_surveiller")) m = "eclaircies";
    else m = "clair";
    const out = { meteo: m, libelle: METEO_LIB[m], couverture, couverture_texte: calcules.length + " constat" + (calcules.length > 1 ? "s" : "") + " sur " + L.length };
    const r = revue || null, aujourdhui = today || new Date().toISOString().slice(0, 10);
    if ((role === "coeur" || role === null || role === undefined) && r && r.prochaine && r.meteo_figee && METEOS.includes(r.meteo_figee) && aujourdhui < r.prochaine && !r.evenement_fonds) {
      out.meteo = r.meteo_figee; out.libelle = METEO_LIB[r.meteo_figee]; out.gelee_jusquau = r.prochaine;
    }
    return out;
  }

  /* ================================================================== « ça vaut le coût ? » (§ 4.4) */
  const PEA_TYPES = TYPES_PEA, CONTRAT = ["assurance_vie", "capitalisation", "per"];
  const estMarche = type => !CONTRAT.includes(type) && !["pee", "percol"].includes(type);

  function groupeAllocation(classe) { return Risque.GROUPES.includes(classe) ? classe : Risque.GROUPE_DE[classe] || "diversifiants"; }
  const allocationDe = ctx => ctx.alloc || (ctx.alloc = Risque.allocationReelle(ctx.positions, "foyer", { surcharge: ctx.classes }));
  /** Versements à orienter pour ramener un groupe dans sa fourchette : { montant, sens } ou null. */
  function ecartGroupe(ctx, groupe) {
    const prof = Risque.PROFILS.find(p => p.id === ctx.profilRisque);
    if (!prof || !prof.cibles[groupe]) return null;
    const alloc = allocationDe(ctx);
    const T = alloc.total, x = alloc.montants[groupe] || 0, [min, max] = prof.cibles[groupe];
    if (!(T > 0)) return null;
    const part = x * 100 / T;
    if (r6(part) > max) return { montant: max > 0 ? x / (max / 100) - T : x, sens: "au_dessus", part, min, max, total: T, valeur: x };
    if (r6(part) < min) return { montant: ((min / 100) * T - x) / (1 - min / 100), sens: "sous", part, min, max, total: T, valeur: x };
    return { montant: 0, sens: "dans", part, min, max, total: T, valeur: x };
  }

  /** Calcule le coût d'un changement : { gain_annuel, cout_unique, … } puis le verdict. changement = { levier, classe?, enveloppe?, vers_enveloppe?, objectif?, position_ids?, montant? }. */
  function vautLeCout(changement, data, options) {
    const o = objet(options), today = o.today || (data && data.today) || new Date().toISOString().slice(0, 10);
    return vautLeCoutCtx(objet(changement), contexte(data, today), o);
  }
  function vautLeCoutCtx(ch, ctx, o) {
    const { rep, cfg, today } = ctx, levier = ch.levier;
    const calcul = [], hypotheses = [], manque = [], sources = [];
    const res = { levier, classe: ch.classe || null, enveloppe: ch.enveloppe || null, verdict: null, gain_annuel: 0, cout_unique: null, cout_detail: { impot: 0, transaction: 0 }, point_mort_ans: null,
      horizon_ans: null, calcul, hypotheses, manque, sources };
    if (ch.vers_enveloppe) res.vers_enveloppe = ch.vers_enveloppe;

    /* lignes concernées */
    let L = liste(ch.position_ids).map(id => ligneDe(ctx, id)).filter(Boolean);
    if (!L.length && levier !== "versements_orientes") {
      L = ctx.lignes.filter(l => (!ch.classe || l.classe === ch.classe || groupeAllocation(l.classe) === ch.classe) && (!ch.enveloppe || l.enveloppe === ch.enveloppe) &&
        (levier !== "securiser_objectif" || (CLASSES_RISQUEES.includes(l.classe) && (!ch.objectif || objectifsDe(l.p, ctx.objectifs, today).some(ob => ob.id === ch.objectif)))));
    }
    /* horizon */
    const objectif = ch.objectif ? ctx.objectifs.find(ob => ob && ob.id === ch.objectif) : null;
    let hz;
    if (objectif && dateCible(objectif) && estDate(dateCible(objectif))) hz = { mois: moisRevolus(today, dateCible(objectif)), suppose: false };
    else if (L.length) {
      const hs = L.map(l => horizonLigneMois(l.p, ctx.objectifs, today, rep));
      hz = { mois: Math.min(...hs.map(h => h.mois)), suppose: hs.every(h => h.suppose) };
    } else hz = horizonFoyerMois(ctx.objectifs, today, rep);
    const horizon = hz.mois / 12;
    res.horizon_ans = r4(horizon);
    if (hz.suppose) hypotheses.push("horizon supposé de " + frc(horizon, 0) + " ans (aucun objectif rattaché à ces lignes) ; dis-le-moi pour l'affiner");
    calcul.push("Ton horizon : " + frc(hz.mois) + " mois révolus, soit " + frc(horizon, 1) + " an" + (horizon >= 2 ? "s" : ""));

    const M = connu(ch.montant) ? +ch.montant : somme(L, l => l.valeur);
    if (levier !== "versements_orientes") { calcul.push("Montant concerné : " + eur(M)); res.montant = r2(M); }

    /* versements orientés : aucun coût, un délai */
    if (levier === "versements_orientes") {
      const groupe = groupeAllocation(ch.classe), ecart = ecartGroupe(ctx, groupe);
      res.cout_unique = 0; res.cout_detail = { impot: 0, transaction: 0 };
      if (!ecart) { manque.push("Ton profil de risque (la fourchette cible de la classe)"); res.montant_a_orienter = null; res.mois_pour_combler = null; return conclure(res, ctx, o, null); }
      res.montant_a_orienter = r2(Math.max(0, ecart.montant));
      const cap = connu(o.capacite_mensuelle) ? +o.capacite_mensuelle : null;
      res.mois_pour_combler = cap && cap > 0 && ecart.montant > 0 ? Math.ceil(r6(ecart.montant / cap)) : null;
      calcul.push("Ta classe pèse " + pct(ecart.part, 1) + " pour une fourchette de " + frc(ecart.min, 0) + " à " + frc(ecart.max, 0) + " %");
      if (ecart.montant > 0) calcul.push((ecart.sens === "au_dessus" ? "Montant à orienter hors de cette classe" : "Montant à orienter vers cette classe") + " : " + eur(ecart.montant));
      if (!(cap > 0)) hypotheses.push("capacité d'épargne à constater avec Claude pour chiffrer le délai");
      else calcul.push("Avec " + eur(cap) + " d'épargne par mois : " + (res.mois_pour_combler || 0) + " mois pour combler l'écart");
      res.alternative = null;
      res.verdict = ecart.montant > 0 ? "vaut_le_cout" : null;
      if (ecart.montant <= 0) calcul.push("La classe est dans sa fourchette : rien à orienter");
      return res;
    }
    if (!L.length) { manque.push("Les lignes concernées"); return conclure(res, ctx, o, null); }

    /* gain annuel certain G (frais) */
    let G = 0;
    const repHaut = ch.classe && REPERE_CLASSE(ch.classe) ? REPERE_CLASSE(ch.classe).haut : null;
    const terPond = (() => { const ok = L.filter(l => l.ter != null); const v = somme(ok, l => l.valeur); return ok.length === L.length && v > 0 ? somme(ok, l => l.ter * l.valeur) / v : null; })();
    if (levier === "frais_classe" || levier === "changer_enveloppe") {
      if (terPond == null) manque.push("Les frais courants des fonds concernés");
      else if (repHaut == null) manque.push("Un repère de frais pour cette classe");
      else {
        const fraisA = levier === "changer_enveloppe" ? somme(L, l => l.valeur * fraisTotal(ctx, l)) / Math.max(1, somme(L, l => l.valeur)) : 0;
        const envB = levier === "changer_enveloppe" ? enveloppeDe(cfg, ctx.positions, ch.vers_enveloppe, L[0].p.owner) : null;
        const feB = envB ? fraisEnveloppe(cfg, ch.vers_enveloppe) : {};
        const fraisB = envB ? (connu(feB.garde_pct) ? +feB.garde_pct : 0) + (TYPES_CONTRAT.includes(envB.type) && connu(feB.gestion_uc_pct) ? +feB.gestion_uc_pct : 0) : 0;
        if (levier === "changer_enveloppe") {
          G = M * Math.max(0, (terPond + fraisA) - (repHaut + fraisB)) / 100;
          calcul.push("Gain par an = " + eur(M) + " × ((" + frc(terPond, 2) + " + " + frc(fraisA, 2) + " de frais d'enveloppe) − (" + frc(repHaut, 2) + " + " + frc(fraisB, 2) + ")) % = " + eur(G));
        } else {
          G = M * Math.max(0, terPond - repHaut) / 100;
          calcul.push("Gain par an = " + eur(M) + " × (" + frc(terPond, 2) + " % − " + frc(repHaut, 2) + " %) = " + eur(G) + " (haut du repère de la classe, les frais d'enveloppe ne changent pas)");
        }
        sources.push({ titre: "Repères de frais de classe (Pratiques, CP4)", url: null });
      }
    }
    res.gain_annuel = r2(G);

    /* coût certain C */
    let impot = 0, transaction = 0, bloque = false;
    const taux = e => {
      const fe = fraisEnveloppe(cfg, e);
      const c = connu(fe.courtage_pct) ? +fe.courtage_pct : null;
      if (c == null) { const t = "courtage de " + frc(rep("courtage_banque_reseau_pct"), 2) + " % (moyenne la plus élevée relevée par l'AMF, janvier 2026) faute de ton courtage réel : donne-le à Claude pour affiner"; if (!hypotheses.includes(t)) hypotheses.push(t); if (!sources.some(s => s.url === SOURCE_AMF.url)) sources.push(SOURCE_AMF); }
      return (c == null ? rep("courtage_banque_reseau_pct") : c) + rep("suivi_demi_ecart_cote_pct");
    };
    const arbitrage = e => {
      const fe = fraisEnveloppe(cfg, e);
      if (connu(fe.arbitrage_pct)) return +fe.arbitrage_pct;
      const t = "frais d'arbitrage de " + frc(rep("suivi_arbitrage_av_defaut_pct"), 0) + " % supposés faute de ceux de ton contrat (convention prudente) : donne-les à Claude (arbitrage_pct)";
      if (!hypotheses.includes(t)) hypotheses.push(t);
      return rep("suivi_arbitrage_av_defaut_pct");
    };
    const couple = objet(objet(ctx.d.profil).foyer).union === "joint" && (+objet(objet(ctx.d.profil).foyer).adultes || 0) >= 2;
    /* part vendue par enveloppe */
    const parEnv = new Map();
    L.forEach(l => { const k = l.enveloppe || ""; if (!parEnv.has(k)) parEnv.set(k, []); parEnv.get(k).push(l); });
    const totalV = somme(L, l => l.valeur), natures = new Set();
    /* impôt d'une vente de `montant` sur les lignes d'une enveloppe : `rachat` = vraie sortie de l'enveloppe ; sinon arbitrage dedans */
    const sortie = (enveloppe, lignes, montant, rachat) => {
      const env = lignes[0].env, type = env.type || "compte_titres";
      if (!rachat && (CONTRAT.includes(type) || TYPES_PEA.includes(type) || ["pee", "percol"].includes(type))) return 0;
      if (type === "per") { manque.push("Un PER est bloqué jusqu'à la retraite : pas de changement d'enveloppe chiffré"); bloque = true; return 0; }
      const V = somme(lignes, l => l.valeur), part = V > 0 ? Math.min(1, montant / V) : 0;
      let baseConnue = lignes.every(l => l.base != null), base = somme(lignes, l => l.base || 0) * part;
      /* assurance-vie et capitalisation : la fiscalité du rachat se calcule par contrat (primes versées contre valeur du contrat), pas ligne par ligne */
      if (rachat && AV_OU_CAPI(type)) {
        const versements = connu(objet(env.infos).versements_cumules) ? +env.infos.versements_cumules : null;
        const Vc = somme(ctx.lignes.filter(l => l.enveloppe === lignes[0].enveloppe), l => l.valeur);
        if (versements != null && Vc > 0) {
          base = versements * Math.min(1, montant / Vc); baseConnue = true;
          hypotheses.push("base fiscale du contrat « " + (enveloppe || "assurance-vie") + " » : primes versées " + eur(versements) + ", rachat de " + pct(Math.min(1, montant / Vc) * 100, 0) + " de la valeur du contrat (la fiscalité d'un rachat se calcule par contrat)");
        } else hypotheses.push("base fiscale estimée d'après le prix de revient des lignes : la base légale est celle du contrat (primes versées), à donner à Claude (versements_cumules) pour affiner");
      }
      const ouverture = estDate(objet(env.infos).date_ouverture) ? env.infos.date_ouverture : null;
      if (!baseConnue) { manque.push("Le prix de revient des lignes vendues dans « " + (enveloppe || "l'enveloppe") + " » : pas de verdict sans lui, l'impôt en est la part principale"); bloque = true; return 0; }
      const c = { type: type === "autre" ? "compte_titres" : type, valeur: montant, base, classe: lignes[0].classe === "crypto" ? "crypto" : lignes[0].classe, date_ouverture: ouverture };
      const prep = F.preparer(c, { reperes: ctx.d.reperes, couple, primes_titulaire: connu(objet(env.infos).versements_cumules) ? +env.infos.versements_cumules : undefined });
      if (prep.indisponible) { manque.push("Un repère fiscal manquant (" + ([...prep.reperes.manquants].join(", ") || "type de l'enveloppe") + ") : pas de verdict, jamais un coût supposé nul"); bloque = true; return 0; }
      const r = prep.calculer(c.valeur, c.base, today);
      if (montant < base) hypotheses.push("moins-value latente de " + eur(base - montant) + " sur les lignes vendues : aucun impôt, la moins-value n'est pas comptée comme un gain");
      F.sourcesDe(prep).forEach(s => { if (!sources.some(x => x.cle === s.cle)) sources.push(s); });
      return r.ir + r.ps;
    };
    const ordresDans = (e, montant) => { const t = taux(e); const c = montant * t / 100; return { cout: c, t }; };

    if (levier === "changer_enveloppe") {
      const A = ch.enveloppe || L[0].enveloppe, envA = L[0].env, envB = enveloppeDe(cfg, ctx.positions, ch.vers_enveloppe, L[0].p.owner);
      const toutePEA = TYPES_PEA.includes(envA.type);
      const jalons = Calendrier.calendrier({ positions: ctx.positions, config: cfg, profil: ctx.d.profil, reperes: liste(ctx.d.reperes) }, today).jalons;
      const jalonDe = cle => jalons.find(j => j.cle === cle && (j.enveloppe_nom === A || j.enveloppe === envA.cle));
      let vendu = M, lignesVendues = L;
      let cloture = false;
      if (toutePEA) {
        const j = jalonDe("pea_5_ans");
        const apres5 = j ? j.date <= today : null;
        if (apres5 === false || apres5 === null) {
          cloture = true;
          lignesVendues = ctx.lignes.filter(l => l.enveloppe === A);
          vendu = somme(lignesVendues, l => l.valeur);
          res.cloture = true;
          hypotheses.push("clôture du PEA : un retrait avant ses 5 ans clôture le plan, donc tout le plan est vendu et l'impôt porte sur tout le gain" + (apres5 === null ? " (date d'ouverture inconnue : fiscalité d'avant 5 ans appliquée)" : ""));
          calcul.push("Le retrait clôture le PEA : " + eur(vendu) + " vendus au lieu de " + eur(M));
        }
        res.perte_anciennete = { enveloppe: A, date: j && j.date > today ? j.date : null };
      } else if (AV_OU_CAPI(envA.type)) {
        const j = jalonDe("av_8_ans");
        res.perte_anciennete = { enveloppe: A, date: j && j.date > today ? j.date : null };
      }
      /* impôt : sortie de l'enveloppe source */
      impot = sortie(A, lignesVendues, vendu, true);
      /* transactions : vente dans A (marché), achat dans B (marché) ; rachat d'UC et versement en UC sans frais (hypothèse) */
      if (estMarche(envA.type)) { const t = ordresDans(A, vendu); transaction += t.cout; natures.add("courtage"); calcul.push("Vente dans « " + A + " » : " + eur(vendu) + " × " + frc(t.t, 2) + " % = " + eur(t.cout)); }
      else hypotheses.push("rachat d'unités de compte sans frais de vente (hypothèse) ; les frais sur versement du nouveau contrat ne sont pas comptés");
      if (envB.type && estMarche(envB.type)) { const t = ordresDans(ch.vers_enveloppe, M); transaction += t.cout; natures.add("courtage"); calcul.push("Achat dans « " + ch.vers_enveloppe + " » : " + eur(M) + " × " + frc(t.t, 2) + " % = " + eur(t.cout)); }
      else hypotheses.push("versement en unités de compte sans frais d'entrée (hypothèse) : les frais sur versement ne sont pas comptés");
    } else {
      /* arbitrage dans l'enveloppe : frais_classe, reequilibrer, reduire_satellite, securiser_objectif */
      for (const [e, lignes] of parEnv) {
        const V = somme(lignes, l => l.valeur), m = totalV > 0 ? M * V / totalV : 0, type = lignes[0].env.type;
        if (CONTRAT.includes(type)) { const a = arbitrage(e), c = m * a / 100; transaction += c; natures.add("arbitrage"); calcul.push("Arbitrage dans « " + e + " » : " + eur(m) + " × " + frc(a, 2) + " % = " + eur(c)); }
        else {
          const t = ordresDans(e, m), c = 2 * t.cout; transaction += c; natures.add("courtage"); calcul.push("Vente puis achat dans « " + (e || "enveloppe") + " » : 2 × " + eur(m) + " × " + frc(t.t, 2) + " % = " + eur(c));
          impot += sortie(e, lignes, m, false);
          if (TYPES_PEA.includes(type)) { const t2 = "vente et achat à l'intérieur du PEA : aucun impôt, le plan reste ouvert"; if (!hypotheses.includes(t2)) hypotheses.push(t2); }
        }
      }
      if (parEnv.size && [...parEnv.values()].every(ls => CONTRAT.includes(ls[0].env.type))) hypotheses.push("arbitrage à l'intérieur du contrat : aucun impôt déclenché (les frais sur versement ne sont pas comptés)");
    }
    res.cout_detail = { impot: r2(impot), transaction: r2(transaction) };
    res.transaction_libelle = natures.size === 1 ? (natures.has("arbitrage") ? "frais d'arbitrage" : "courtage et écart") : "frais de transaction";
    if (bloque) { res.cout_unique = null; res.cout_detail = { impot: null, transaction: r2(transaction) }; return conclure(res, ctx, o, null); }
    res.cout_unique = r2(impot + transaction);
    if (impot > 0) calcul.push("Impôt déclenché : " + eur(impot));
    return conclure(res, ctx, o, { G, C: impot + transaction, horizon });
  }
  const AV_OU_CAPI = t => t === "assurance_vie" || t === "capitalisation";

  /** Verdict, point mort, alternative par les versements. */
  function conclure(res, ctx, o, v) {
    const { rep } = ctx, levier = res.levier;
    if (!v) { res.verdict = levier === "versements_orientes" ? res.verdict : null; res.point_mort_ans = null; alternative(res, ctx, o); return finir(res); }
    const { G, C, horizon } = v;
    const risque = ["reequilibrer", "securiser_objectif", "reduire_satellite"].includes(levier);
    if (risque) {
      res.verdict = r6(C) === 0 ? "vaut_le_cout" : "a_peser"; res.point_mort_ans = null;
      res.calcul.push("Ce levier réduit un risque mesuré : pas de gain en euros, " + (r6(C) === 0 ? "et il ne coûte rien" : "à peser selon l'effet sur le risque et le coût de " + eur(C)));
    } else {
      const N = G > 0 ? C / G : null, S = Math.min(rep("suivi_point_mort_max_ans"), horizon * rep("suivi_point_mort_part_horizon_pct") / 100);
      res.point_mort_ans = N == null ? null : r4(N);
      if (N == null) res.verdict = "ne_rien_faire";
      else if (r6(N) <= r6(S)) res.verdict = "vaut_le_cout";
      else if (r6(N) <= r6(horizon)) res.verdict = "a_peser";
      else res.verdict = "ne_rien_faire";
      res.calcul.push(N == null ? "Aucun gain certain : le changement ne réduit pas un risque mesuré" : "Point mort = " + eur(C) + " ÷ " + eur(G) + " par an = " + frc(N, 1) + " an" + (N >= 2 ? "s" : "") +
        " (seuil « ça vaut le coût » : " + frc(S, 1) + " an" + (S >= 2 ? "s" : "") + ", ton horizon : " + frc(horizon, 1) + ")");
    }
    alternative(res, ctx, o);
    return finir(res);
  }
  function alternative(res, ctx, o) {
    if (res.levier === "versements_orientes") return;
    if (res.verdict === "vaut_le_cout") { res.alternative = null; return; }
    let mois = null;
    if (res.levier === "reequilibrer" || res.levier === "reduire_satellite" || res.levier === "securiser_objectif") {
      if (res.levier === "reequilibrer" && res.classe) {
        const ecart = ecartGroupe(ctx, groupeAllocation(res.classe)), cap = connu(o.capacite_mensuelle) ? +o.capacite_mensuelle : null;
        if (ecart && ecart.montant > 0 && cap > 0) mois = Math.ceil(r6(ecart.montant / cap));
      }
    }
    if (res.verdict === null && res.levier !== "reequilibrer") { res.alternative = null; return; }
    res.alternative = { levier: "versements_orientes", mois };
  }
  function finir(res) {
    res.verdict_libelle = res.verdict ? VERDICT_LIB[res.verdict] : null;
    res.titre = titreLevier(res.levier, res);
    return res;
  }

  /* ---------- titres des leviers (classe et enveloppe, jamais un instrument) ---------- */
  function titreLevier(levier, o) {
    const c = classeLib(o.classe), e = o.enveloppe ? "« " + o.enveloppe + " »" : "ton portefeuille";
    switch (levier) {
      case "frais_classe": return "Réduire les frais de la classe " + c + " dans " + e;
      case "reequilibrer": return "Ramener la classe " + c + " vers sa cible, d'abord à l'intérieur de " + e;
      case "versements_orientes": return "Orienter tes prochains versements pour la classe " + c;
      case "reduire_satellite": return "Revenir sous ton plafond satellite" + (o.enveloppe ? " (classe " + c + " dans " + e + ")" : "");
      case "securiser_objectif": return "Sécuriser l'argent de ton objectif « " + (o.objectif_nom || "à venir") + " »";
      case "changer_enveloppe": return "Placer la classe " + c + " de " + e + " dans « " + (o.vers_enveloppe || "une autre enveloppe") + " »";
      case "fonds_ferme": return "Comprendre ce que change la fermeture d'un fonds de la classe " + c + " dans " + e;
      default: return LEVIERS[levier] ? LEVIERS[levier].libelle : "Levier";
    }
  }

  /* ================================================================== déclencheurs de revue (§ 4.3) */
  const DATES = ["objectif_risque", "evenement_fonds", "operation_titre"];
  function cibleMemoire(d) {
    switch (d.cle) {
      case "frais_eleves": return d.classe + "|" + d.enveloppe;
      case "ecart_cible": return d.classe;
      case "satellite_plafond": return "portefeuille";
      case "concentration": case "baisse_satellite": return d.position_ids[0];
      case "objectif_risque": return d.objectif;
      case "sante_degradee": return d.position_ids[0] + "|" + d.constat;
      default: return d.cle;
    }
  }
  /** Visibilité (R13) : { visible, raison_visibilite }. */
  function visibilite(ctx, d, roleDeclencheur) {
    if (DATES.includes(d.cle)) return { visible: true, raison_visibilite: "date" };
    if (roleDeclencheur !== "coeur") return { visible: true, raison_visibilite: "revue_du_mois" };
    if (ctx.politique.mois_revue_coeur.includes(mois2(ctx.today)) || prochaineRevueCoeur(ctx).en_retard) return { visible: true, raison_visibilite: "revue_du_mois" };
    const mem = objet(objet(ctx.d.routines).derniere_revue);
    if (!Object.keys(mem).length) return { visible: false, raison_visibilite: "hors_revue" };
    const vu = liste(mem.declencheurs).find(x => x && x.cle === d.cle && x.cible === d.cible);
    if (!vu) return { visible: true, raison_visibilite: "seuil_franchi" };
    if (connu(vu.mesure) && Math.abs(d.mesure) > (1 + ctx.rep("suivi_aggravation_pct") / 100) * Math.abs(+vu.mesure)) return { visible: true, raison_visibilite: "aggravation" };
    return { visible: false, raison_visibilite: "deja_vu" };
  }
  function declencheurs(data, today, options) {
    const ctx = contexte(data, today), o = objet(options);
    return declencheursCtx(ctx, o);
  }
  function declencheursCtx(ctx, o) {
    const { rep, lignes, today, I } = ctx, pol = ctx.politique, S = pol.seuils, out = [];
    const ajouter = (d, role) => {
      d.cible = cibleMemoire(d);
      Object.assign(d, visibilite(ctx, d, role));
      d.role = role;
      if (d.levier) {
        const ch = { levier: d.levier, classe: d.classe, enveloppe: d.enveloppe, position_ids: d.levier === "versements_orientes" ? [] : d.position_ids, montant: d.montant, objectif: d.objectif };
        const v = vautLeCoutCtx(ch, ctx, Object.assign({}, o, { today }));
        d.verdict = v.verdict; d.cout = v;
      } else { d.verdict = null; d.cout = null; }
      out.push(d);
    };
    const base = (cle, extra) => Object.assign({ cle, portee: "ligne", position_ids: [], levier: null, source: "Spec SUIVI § 4.3, repères Boussole" }, extra);

    /* frais_eleves : TER d'un fonds au-dessus du haut du repère de sa classe et de 0,50 % (R5) */
    {
      const groupes = new Map();
      lignes.filter(l => l.nature === "fonds" && l.ter != null).forEach(l => {
        const rf = REPERE_CLASSE(l.classe);
        if (!rf || !(r6(l.ter) > rf.haut && r6(l.ter) > S.frais_plancher_pct)) return;
        const k = l.classe + "|" + (l.enveloppe || "") + "|" + roleFreq(l);
        if (!groupes.has(k)) groupes.set(k, { classe: l.classe, enveloppe: l.enveloppe, role: roleFreq(l), lignes: [], haut: rf.haut });
        groupes.get(k).lignes.push(l);
      });
      groupes.forEach(g => {
        const v = somme(g.lignes, l => l.valeur), ter = v > 0 ? somme(g.lignes, l => l.ter * l.valeur) / v : g.lignes[0].ter;
        ajouter(base("frais_eleves", { portee: "ligne", classe: g.classe, enveloppe: g.enveloppe, position_ids: g.lignes.map(l => l.id), mesure: r4(ter), seuil: g.haut, levier: "frais_classe", montant: r2(v),
          titre: "La classe " + classeLib(g.classe) + " dans « " + g.enveloppe + " » coûte " + pct(ter, 2) + " par an", pourquoi: "Les frais courants (" + pct(ter, 2) + ") dépassent le haut du repère de la classe (" + pct(g.haut, 2) + ") et 0,50 % par an. Un fonds indiciel de cette classe coûte souvent " + frc(REPERE_CLASSE(g.classe).bas, 2) + " à " + frc(g.haut, 2) + " %.",
          source: "Frais courants du DIC, repères de frais de classe (CP4)" }), g.role);
      });
    }
    /* ecart_cible : une classe à plus de seuil_ecart_pts de la borne la plus proche de sa fourchette */
    if (ctx.profilRisque) {
      const alloc = allocationDe(ctx);
      Risque.ecarts(ctx.profilRisque, alloc).filter(e => e.groupe !== "speculatif" && r6(Math.abs(e.ecartPts)) > S.seuil_ecart_pts).forEach(e => {
        const ids = lignes.filter(l => groupeAllocation(l.classe) === e.groupe).map(l => l.id);
        const mes = r4(Math.abs(e.ecartPts));
        ajouter(base("ecart_cible", { portee: "classe", classe: e.groupe, enveloppe: null, position_ids: ids, mesure: mes, seuil: S.seuil_ecart_pts, levier: "versements_orientes",
          titre: "Ta classe " + classeLib(e.groupe) + " est à " + pct(e.reel, 0) + " pour une fourchette de " + frc(e.min, 0) + " à " + frc(e.max, 0) + " %",
          pourquoi: "Elle s'écarte de " + frc(mes, 1) + " points de la borne la plus proche de la fourchette de ton profil (seuil : " + frc(S.seuil_ecart_pts, 0) + " points).", source: "Fourchettes du profil de risque, Vanguard 2010 (seuil de rééquilibrage)" }), "coeur");
      });
    }
    /* satellite_plafond */
    {
      const sys = systemeCtx(ctx);
      if (sys.depasse) {
        const sat = lignes.filter(l => l.role === "satellite" || l.role === null), Sv = somme(sat, l => l.valeur);
        ajouter(base("satellite_plafond", { portee: "portefeuille", position_ids: sat.map(l => l.id), mesure: sys.part_satellite_investi_pct, seuil: pol.plafond_satellite_pct, levier: "reduire_satellite",
          montant: r2(Sv - pol.plafond_satellite_pct / 100 * I), classe: null, enveloppe: null,
          titre: "Ta part satellite est à " + pct(sys.part_satellite_investi_pct, 1) + " pour un plafond de " + frc(pol.plafond_satellite_pct, 0) + " %",
          pourquoi: "Le satellite (convictions, thématiques, levier, crypto) dépasse le plafond que tu as choisi avec ton profil ; l'excès est de " + eur(Sv - pol.plafond_satellite_pct / 100 * I) + ".", source: "Plafond satellite du profil (repère Boussole)" }), "satellite");
      }
    }
    /* concentration : une ligne du satellite > 5 % ; une société > 10 % (direct et transparence) */
    {
      const dejaSat = new Set();
      lignes.filter(l => l.role === "satellite" && I > 0).forEach(l => {
        const p = l.valeur * 100 / I;
        if (r6(p) > S.ligne_satellite_max_pct) {
          dejaSat.add(String(l.id));
          ajouter(base("concentration", { portee: "ligne", classe: l.classe, enveloppe: l.enveloppe, position_ids: [l.id], mesure: r4(p), seuil: S.ligne_satellite_max_pct, levier: "reduire_satellite", montant: r2(l.valeur - S.ligne_satellite_max_pct / 100 * I),
            titre: "Une ligne de ta classe " + classeLib(l.classe) + " dans « " + l.enveloppe + " » pèse " + pct(p, 1) + " de ton financier investi",
            pourquoi: "Une ligne du satellite pèse " + pct(p, 1) + " du financier investi, au-dessus du repère de " + frc(S.ligne_satellite_max_pct, 0) + " %.", source: "Repère Boussole (directive OPCVM, art. 52)" }), "satellite");
        }
      });
      const soc = new Map();
      lignes.filter(l => l.nature === "direct" && l.role !== "reserve").forEach(l => { const k = l.p.isin || "id:" + l.id; const s = soc.get(k) || { montant: 0, porteurs: [] }; s.montant += l.valeur; s.porteurs.push(l); soc.set(k, s); });
      lignes.filter(l => l.nature === "fonds" && l.p.isin).forEach(l => ctx.expos.filter(e => e && e.isin === l.p.isin && e.axe === "ligne" && connu(e.poids_pct)).forEach(e => {
        const s = soc.get(e.cle) || { montant: 0, porteurs: [] }; s.montant += l.valeur * +e.poids_pct / 100; if (!s.porteurs.includes(l)) s.porteurs.push(l); soc.set(e.cle, s);
      }));
      soc.forEach((s, cle) => {
        if (I <= 0 || s.porteurs.every(l => dejaSat.has(String(l.id)))) return;
        const p = s.montant * 100 / I;
        if (r6(p) > S.societe_max_pct) {
          const envs = [...new Set(s.porteurs.map(l => l.enveloppe))], l0 = s.porteurs[0];
          const c = base("concentration", { portee: "ligne", classe: "actions", enveloppe: envs.length === 1 ? envs[0] : null, position_ids: s.porteurs.map(l => l.id), mesure: r4(p), seuil: S.societe_max_pct, levier: "reduire_satellite",
            montant: r2(s.montant - S.societe_max_pct / 100 * I),
            titre: "Une même société pèse " + pct(p, 1) + " de ton financier investi" + (envs.length === 1 && envs[0] ? ", dans « " + envs[0] + " »" : ""),
            pourquoi: "Une société (en direct et par les fonds que tu détiens) dépasse " + frc(S.societe_max_pct, 0) + " % du financier investi.", source: "Repère Boussole (directive OPCVM, art. 52)" });
          c.cible_societe = cle;
          ajouter(c, roleFreq(l0));
        }
      });
    }
    /* baisse_satellite */
    {
      const seuil = S.seuil_baisse_satellite_pct, ilYaUnAn = O.ajouterAns(today, -1);
      lignes.filter(l => l.role === "satellite").forEach(l => {
        const mesures = [];
        const pru = connu(l.p.pru) ? +l.p.pru : null, prix = l.p.mode === "market" && connu(l.p.price) ? +l.p.price : null;
        if (pru && prix != null && pru > 0) mesures.push((pru - prix) / pru * 100);
        if (prix != null && l.p.isin) {
          const cours = liste(ctx.d.cours).filter(c => c && c.isin === l.p.isin && estDate(c.date) && c.date <= ilYaUnAn && connu(c.close)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
          if (cours && +cours.close > 0) mesures.push((+cours.close - prix) / +cours.close * 100);
        }
        const m = mesures.length ? Math.max(...mesures) : null;
        if (m != null && r6(m) > seuil) {
          ajouter(base("baisse_satellite", { portee: "ligne", classe: l.classe, enveloppe: l.enveloppe, position_ids: [l.id], mesure: r4(m), seuil, levier: null,
            titre: "Une ligne de ta classe " + classeLib(l.classe) + " dans « " + l.enveloppe + " » a baissé de " + pct(m, 1),
            pourquoi: "La baisse dépasse " + frc(seuil, 0) + " % depuis le prix de revient ou sur 12 mois. Ta raison de détenir cette ligne tient-elle toujours ? Claude peut la relire avec toi et la noter au journal de décision.", source: "Repère Boussole (seuil de baisse du satellite)" }), "satellite");
        }
      });
    }
    /* objectif_risque : un objectif à moins de 36 mois couvert par des classes risquées */
    ctx.objectifs.filter(ob => ob && dateCible(ob) && estDate(dateCible(ob)) && dateCible(ob) >= today && moisRevolus(today, dateCible(ob)) < rep("suivi_horizon_reserve_ans") * 12).forEach(ob => {
      const exp = lignes.filter(l => CLASSES_RISQUEES.includes(l.classe) && objectifsDe(l.p, [ob], today).length);
      if (!exp.length) return;
      const montant = somme(exp, l => l.valeur), envs = [...new Set(exp.map(l => l.enveloppe))];
      ajouter(base("objectif_risque", { portee: "objectif", objectif: ob.id, objectif_nom: ob.nom, classe: exp[0].classe, enveloppe: envs.length === 1 ? envs[0] : null, position_ids: exp.map(l => l.id), mesure: r2(montant), seuil: 0, levier: "securiser_objectif", montant: r2(montant),
        titre: "Ton objectif « " + (ob.nom || "à venir") + " » arrive dans " + moisRevolus(today, dateCible(ob)) + " mois et " + eur(montant) + " sont placés en actions, levier ou crypto",
        pourquoi: "L'argent d'un objectif à moins de 3 ans peut passer progressivement sur des supports sans risque de baisse ; une baisse juste avant l'échéance ne se rattrape pas.", source: "Repère CP4 (projets à moins de 3 ans)" }), roleFreq(exp[0]));
    });
    /* sante_degradee : un constat passé de bon ou à surveiller à à travailler, sans déclencheur propre */
    {
      const mem = objet(objet(ctx.d.routines).derniere_revue), constatsMem = objet(mem.constats), meteoMem = objet(mem.meteo);
      lignes.forEach(l => {
        /* la ligne figurait à la dernière revue : un constat absent de la mémoire y était « bon » (la mémoire ne garde que les écarts) */
        if (!(l.id in constatsMem) && !(l.id in meteoMem)) return;
        const avant = objet(constatsMem[l.id]);
        constatsDe(ctx, l).filter(c => !["cout", "poids"].includes(c.cle) && c.statut === "a_travailler" && ["bon", "a_surveiller"].includes(avant[c.cle] || "bon")).forEach(c => {
          const mes = c.mesure && c.mesure.valeur != null ? c.mesure.valeur : null;
          const seuil = c.cle === "chevauchement" ? rep("suivi_chevauchement_travailler_pct") : c.cle === "classe_risque" ? rep("suivi_volatilite_surveiller_pct") : null;
          ajouter(base("sante_degradee", { portee: "ligne", classe: l.classe, enveloppe: l.enveloppe, constat: c.cle, position_ids: [l.id], mesure: mes, seuil, levier: c.cle === "classe_risque" && l.role === "satellite" ? "reduire_satellite" : null,
            montant: c.cle === "classe_risque" && l.role === "satellite" ? r2(l.valeur) : undefined,
            titre: "Ta classe " + classeLib(l.classe) + " dans « " + l.enveloppe + " » : le constat « " + (CONSTATS_LIB[c.cle] || c.cle).toLowerCase() + " » est passé de « " + (STATUT_LIB[avant[c.cle] || "bon"] || avant[c.cle]).toLowerCase() + " » à « au-dessus du repère »",
            pourquoi: c.pourquoi, source: "Constats de santé (SCO2)" }), roleFreq(l));
        });
      });
    }
    return out;
  }

  /* ================================================================== habitudes (§ 11.7, R16) */
  const mensuel = (d) => d.slice(0, 7);
  function habitudes(data, today) { return habitudesCtx(contexte(data, today)); }
  function habitudesCtx(ctx) {
    const today = ctx.today, rt = objet(ctx.d.routines), sante = objet(ctx.d.sante), out = [];
    /* revue faite */
    {
      const passages = new Set(liste(rt.passages).filter(estDate).map(mensuel));
      const ref = passages.has(today.slice(0, 7)) ? today.slice(0, 7) : O.ajouterMois(today.slice(0, 7) + "-01", -1).slice(0, 7);
      const fenetre = n => { const m = []; for (let k = 0; k < n; k++) m.push(O.ajouterMois(ref + "-01", -k).slice(0, 7)); return m; };
      const compte = n => fenetre(n).filter(m => passages.has(m)).length;
      const PALIERS = [3, 6, 12];
      const palier = PALIERS.filter(n => compte(n) === n).pop() || null;
      const prochain = palier ? PALIERS[PALIERS.indexOf(palier) + 1] || null : PALIERS[0];
      const fen = prochain || palier || PALIERS[0], mesure = compte(fen);
      out.push({ cle: "revue_faite", libelle: "Revue faite", mesure, palier, prochain_palier: prochain, fenetre: fen,
        texte: palier ? mesure + " revue" + (mesure > 1 ? "s" : "") + " sur les " + fen + " derniers mois" + " : c'est ce qui fait la différence sur 20 ans." :
          mesure + " revue" + (mesure > 1 ? "s" : "") + " sur les " + fen + " derniers mois : la revue du mois, c'est ce qui fait la différence." });
    }
    /* revue du cœur : faite à son dernier mois programmé (sinon en retard) */
    {
      const pol = ctx.politique, faite = estDate(rt.revue_coeur_faite_le) ? rt.revue_coeur_faite_le : null, pr = prochaineRevueCoeur(ctx);
      const ok = !!faite && !pr.en_retard && (pr.derniere_programmee ? faite.slice(0, 7) >= pr.derniere_programmee : moisRevolus(faite, today) < (pol.revue.coeur === "semestrielle" ? 6 : 12));
      out.push({ cle: "revue_coeur", libelle: "Revue du cœur", mesure: faite, palier: ok ? "faite" : null, prochain_palier: ok ? null : "faite", en_retard: pr.en_retard,
        texte: ok ? "Revue de ton cœur faite le " + faite.split("-").reverse().join("/") + "." : pr.en_retard ? "La revue de ton cœur de " + moisEnLettres(pr.mois) + " n'a pas été faite : elle est à faire." :
          "La revue de ton cœur est à faire (" + (pol.revue.coeur === "semestrielle" ? "tous les six mois" : "une fois par an") + ")." });
    }
    /* matelas */
    if (connu(sante.matelas_mois)) {
      const v = +sante.matelas_mois, P = [1, 3, 6], palier = P.filter(n => v >= n).pop() || null, prochain = palier ? P[P.indexOf(palier) + 1] || null : P[0];
      out.push({ cle: "matelas", libelle: "Matelas", mesure: v, palier, prochain_palier: prochain, texte: frc(v, 1) + " mois de dépenses en réserve" + (prochain ? " ; prochain repère : " + prochain + " mois" : " : le repère le plus haut est atteint") + "." });
    }
    /* frais maîtrisés */
    if (connu(sante.frais_pct)) {
      const v = +sante.frais_pct, palier = v <= 0.4 ? 2 : v <= 0.75 ? 1 : null, prochain = palier === 2 ? null : palier === 1 ? 2 : 1;
      out.push({ cle: "frais_maitrises", libelle: "Frais maîtrisés", mesure: v, palier, prochain_palier: prochain, texte: "Coût total de " + frc(v, 2) + " % par an" + (prochain ? " ; repère suivant : " + (prochain === 2 ? "0,40" : "0,75") + " %" : " : sous le repère le plus bas") + "." });
    }
    /* dates connues */
    {
      const infos = objet(ctx.cfg.enveloppes_infos), TYPES = ["pea", "pea_pme", "pea_jeune", "assurance_vie", "capitalisation", "per", "pee", "percol", "pel", "cel"];
      const envs = new Map();
      Object.keys(infos).forEach(k => { const i = objet(infos[k]); const t = TYPES.includes(i.type) ? i.type : null; if (t) envs.set(k, estDate(i.date_ouverture)); });
      ctx.positions.forEach(p => {
        if (!p.envelope) return;
        const e = enveloppeDe(ctx.cfg, ctx.positions, p.envelope, p.owner);
        if (!envs.has(e.cle) && TYPES.includes(e.type)) envs.set(e.cle, estDate(objet(e.infos).date_ouverture));
      });
      const manquantes = [...envs.entries()].filter(([, ok]) => !ok).map(([k]) => k.replace(/\|p[12]$/, ""));
      const toutes = envs.size > 0 && !manquantes.length;
      out.push({ cle: "dates_connues", libelle: "Dates connues", mesure: envs.size - manquantes.length, palier: toutes ? "toutes" : null, prochain_palier: toutes ? null : "toutes", manquantes,
        texte: toutes ? "La date d'ouverture de toutes tes enveloppes est connue." : envs.size ? "Il manque la date d'ouverture de " + manquantes.length + " enveloppe" + (manquantes.length > 1 ? "s" : "") + " : elle fait courir les seuils fiscaux." : "Aucune enveloppe à dater pour l'instant." });
    }
    /* diversification */
    {
      const sys = systemeCtx(ctx), pol = ctx.politique;
      const soc = new Map();
      ctx.lignes.filter(l => l.nature === "direct" && l.role !== "reserve").forEach(l => soc.set(l.p.isin || "id:" + l.id, (soc.get(l.p.isin || "id:" + l.id) || 0) + l.valeur));
      ctx.lignes.filter(l => l.nature === "fonds" && l.p.isin).forEach(l => ctx.expos.filter(e => e && e.isin === l.p.isin && e.axe === "ligne" && connu(e.poids_pct)).forEach(e => soc.set(e.cle, (soc.get(e.cle) || 0) + l.valeur * +e.poids_pct / 100)));
      const maxSoc = ctx.I > 0 ? Math.max(0, ...[...soc.values()].map(v => v * 100 / ctx.I)) : 0;
      const atteint = ctx.lignes.length > 0 && !sys.depasse && r6(maxSoc) <= pol.seuils.societe_max_pct;
      out.push({ cle: "diversification", libelle: "Diversification", mesure: r4(maxSoc), palier: atteint ? "atteint" : null, prochain_palier: atteint ? null : "atteint",
        texte: atteint ? "Aucune société au-dessus de " + frc(pol.seuils.societe_max_pct, 0) + " % et un satellite sous son plafond." : "Pas encore : " + (sys.depasse ? "le satellite dépasse son plafond" : "une société dépasse " + frc(pol.seuils.societe_max_pct, 0) + " % de ton financier investi") + "." });
    }
    return out;
  }

  /* ================================================================== effet d'un levier sur le risque (PROJ), hors du chemin synchrone */
  /** Probabilité d'atteindre chaque objectif avant et après un levier de risque (reequilibrer, securiser_objectif, reduire_satellite), sur les MÊMES tirages
      (graine fixe), jamais convertie en euros. `Projection` est le moteur PROJ (global de l'app, copie du connecteur ou ce que le worker expose) ;
      `entree` est l'entrée complète de Projection.preparer (positions, instruments, config, profil, budget, objectifs, reperes…) ;
      changement = { levier, position_ids, montant?, vers_bloc? } ; options = { chemins (1 000), graine, projection } (projection : options de preparer).
      La variante déplace `montant` des lignes concernées vers un support de destination de la même enveloppe : fonds euros pour sécuriser un objectif,
      actions du cœur pour revenir sous le plafond satellite, obligations pour rééquilibrer. Renvoie null si le moteur ne peut pas comparer. */
  function effetRisque(Projection, entree, changement, options) {
    const ch = objet(changement), o = objet(options);
    if (!Projection || typeof Projection.preparer !== "function" || !ch.levier) return null;
    const J = v => JSON.parse(JSON.stringify(v));
    const base = J(entree), ids = liste(ch.position_ids).map(String);
    const sources = liste(base.positions).filter(p => p && ids.includes(String(p.id)));
    const total = somme(sources, p => Calc.val(p));
    if (!(total > 0)) return null;
    const M = Math.min(total, connu(ch.montant) ? +ch.montant : total), ratio = M / total;
    const vers = ch.vers_bloc || (ch.levier === "securiser_objectif" ? "Fonds euros" : ch.levier === "reduire_satellite" ? "Monde" : "Obligations");
    const variante = J(base);
    variante.positions = variante.positions.map(p => {
      if (!p || !ids.includes(String(p.id))) return p;
      const q = Object.assign({}, p);
      if (q.mode === "market" && connu(q.qty)) q.qty = +q.qty * (1 - ratio); else q.value = Calc.val(p) * (1 - ratio);
      return q;
    });
    /* les objectifs qui comptaient les lignes d'origine (par poche) comptent aussi le support de destination */
    const blocs = new Set(sources.map(p => p.bloc));
    variante.objectifs = liste(variante.objectifs).map(ob => (ob && liste(ob.poches).some(b => blocs.has(b)) ? Object.assign({}, ob, { poches: liste(ob.poches).concat([vers]) }) : ob));
    variante.positions.push({ id: "var-destination", name: "Support de destination", envelope: sources[0].envelope, owner: sources[0].owner, bloc: vers, mode: "manual", value: M, status: "actif" });
    const popt = Object.assign({}, o.projection), chemins = o.chemins > 0 ? o.chemins : 1000, graine = o.graine == null ? 20261014 : o.graine;
    let ra, rb;
    try {
      ra = Projection.simuler(Projection.preparer(base, popt), { chemins, graine });
      rb = Projection.simuler(Projection.preparer(variante, popt), { chemins, graine });
    } catch (e) { return null; }
    const texte = p => (Projection.texteProbabilite ? Projection.texteProbabilite(p) : Math.round(p * 10) + " chances sur 10");
    const objectifs = liste(ra.objectifs).map((a, i) => {
      const b = liste(rb.objectifs)[i] || {};
      const avant = a.probabilite, apres = b.probabilite;
      return { id: a.id, nom: a.nom, avant, apres, texte: avant == null || apres == null ? null : (Math.round(avant * 10) === Math.round(apres * 10) ? "Même chance d'atteindre « " + a.nom + " » : " + texte(avant) :
        texte(avant) + " → " + texte(apres) + " d'atteindre « " + a.nom + " »") };
    });
    return { levier: ch.levier, montant: r2(M), vers_bloc: vers, objectifs, chemins, graine, mention: "Même tirages avant et après (graine fixe) ; une projection n'est pas une promesse. Cet effet n'est jamais converti en euros." };
  }

  /* ================================================================== croisement d'un événement avec le portefeuille (§ 7.3, phase 4) */
  /** Parts de l'investi (en %) par devise, pays, société : par la transparence des fonds quand elle existe, sinon par l'instrument. */
  function expositionsPar(ctx, axe, cles) {
    const out = { montant: 0, via: [] };
    ctx.lignes.filter(l => l.role !== "reserve").forEach(l => {
      const rows = ctx.expos.filter(e => e && e.isin && e.isin === l.p.isin && e.axe === axe && connu(e.poids_pct));
      let m = 0;
      if (axe === "ligne") m = rows.filter(e => cles.includes(e.cle)).reduce((a, e) => a + l.valeur * +e.poids_pct / 100, 0) + (cles.includes(l.p.isin) && l.nature === "direct" ? l.valeur : 0);
      else if (rows.length) m = rows.filter(e => cles.includes(e.cle)).reduce((a, e) => a + l.valeur * +e.poids_pct / 100, 0);
      else if (axe === "devise" && cles.includes(l.devise)) m = l.valeur;
      if (m > 0) { out.montant += m; out.via.push(l.id); }
    });
    return out;
  }
  function exposition(data, evenement, today) { return expositionCtx(contexte(data, today), evenement); }
  function expositionCtx(ctx, evenement) {
    const ev = objet(evenement), por = objet(ev.portee), I = ctx.I, rep = ctx.rep;
    const part = m => (I > 0 ? m * 100 / I : 0);
    const res = (concerne, p, raison, via, texte) => ({ concerne, part_pct: r4(p), raison: concerne ? raison : null, via, texte: texte || "" });
    const seuilExpo = rep("suivi_croisement_exposition_pct"), seuilSoc = rep("suivi_croisement_societe_pct");
    const nommer = ids => ids.map(id => (ligneDe(ctx, id) || {}).p).filter(Boolean).map(p => p.name).slice(0, 2).join(", ");
    if (ev.famille === "banque_centrale") {
      const e = expositionsPar(ctx, "devise", liste(por.devises)), p = part(e.montant);
      if (r6(p) >= seuilExpo) return res(true, p, "devise", e.via, pct(p, 0) + " de tes placements sont dans la devise de cette banque centrale");
      const apport = ctx.objectifs.some(o => o && o.type === "apport" && dateCible(o) && estDate(dateCible(o)) && dateCible(o) >= ctx.today && moisRevolus(ctx.today, dateCible(o)) < rep("suivi_horizon_reserve_ans") * 12);
      if (apport) return res(true, p, "objectif_immobilier", [], "Les décisions de cette banque pèsent sur les taux de crédit : tu as un apport immobilier dans les 3 ans");
      return res(false, p, null, e.via);
    }
    if (ev.famille === "macro" || ev.famille === "election") {
      const pays = liste(por.pays);
      let e = pays.length ? expositionsPar(ctx, "pays", pays) : { montant: 0, via: [] }, approx = false;
      if (!e.montant && (liste(por.zones).includes("EA") || pays.length)) { e = expositionsPar(ctx, "devise", ["EUR"]); approx = true; }
      const p = part(e.montant);
      return r6(p) >= seuilExpo ? res(true, p, approx ? "zone_euro" : "pays", e.via, pct(p, 0) + " de tes placements sont exposés à cette zone" + (approx ? " (approximation par la devise euro)" : "")) : res(false, p, null, e.via);
    }
    if (ev.famille === "societe") {
      const isins = liste(por.isin);
      const direct = ctx.lignes.filter(l => l.nature === "direct" && isins.includes(l.p.isin));
      if (direct.length) { const m = somme(direct, l => l.valeur), p = part(m); return res(true, p, "direct", direct.map(l => l.id), "Tu détiens cette société en direct : " + pct(p, 1) + " de tes placements"); }
      const e = expositionsPar(ctx, "ligne", isins), p = part(e.montant);
      return r6(p) >= seuilSoc ? res(true, p, "transparence", e.via, "Cette société pèse " + pct(p, 1) + " de tes placements, via " + nommer(e.via)) : res(false, p, null, e.via);
    }
    if (ev.famille === "fonds") {
      const l = ctx.lignes.filter(x => liste(por.isin).includes(x.p.isin));
      return l.length ? res(true, part(somme(l, x => x.valeur)), "detenu", l.map(x => x.id), "Tu détiens ce fonds") : res(false, 0, null, []);
    }
    return res(false, 0, null, []);
  }

  /* ================================================================== « Ta semaine » (§ 11.6, phase 6) */
  const AUCUNE_ACTION = "Rien à faire cette semaine. C'est souvent la meilleure stratégie.";
  const LEVIERS_RISQUE = ["reequilibrer", "securiser_objectif", "reduire_satellite", "versements_orientes"];
  function maSemaine(data, evenements, today, options) {
    const ctx = contexte(data, today), o = objet(options), pol = ctx.politique;
    const dans7 = O.ajouterJours(today, 7), il7 = O.ajouterJours(today, -7);
    const cartes = [];
    const evts = liste(evenements).filter(e => e && estDate(e.date)).map(e => ({ e, x: expositionCtx(ctx, e) }));
    const horizon = horizonFoyerMois(ctx.objectifs, today, ctx.rep);
    cartes.push({ type: "en_une_phrase", titre: "Cette semaine, en une phrase", chiffre: eur(ctx.T), texte: "Tes placements pèsent " + eur(ctx.T) + ". Sur ton horizon de " + frc(horizon.mois / 12, 0) + " ans, une semaine compte peu.", elements: [], sources: [] });
    const arrive = evts.filter(({ e, x }) => x.concerne && e.date > today && e.date <= dans7 && e.statut !== "annule");
    if (arrive.length) cartes.push({ type: "ce_qui_arrive", titre: "Ce qui arrive", texte: arrive.slice(0, 3).length + " échéance" + (arrive.slice(0, 3).length > 1 ? "s" : "") + " à venir qui te concerne" + (arrive.slice(0, 3).length > 1 ? "nt" : "") + ".", elements: arrive.slice(0, 3).map(({ e, x }) => ({ id: e.id, date: e.date, titre: e.titre || e.type, raison: x.texte })), sources: arrive.map(({ e }) => e.source).filter(Boolean) });
    const passe = evts.filter(({ e, x }) => x.concerne && e.date >= il7 && e.date < today && e.statut === "passe");
    if (passe.length) cartes.push({ type: "ce_qui_s_est_passe", titre: "Ce qui s'est passé", texte: passe.length + " événement" + (passe.length > 1 ? "s" : "") + " qui te concernait" + (passe.length > 1 ? "ent" : "") + ".", elements: passe.map(({ e, x }) => ({ id: e.id, date: e.date, titre: e.titre || e.type, raison: x.texte, faits: e.faits || null })), sources: passe.map(({ e }) => e.source).filter(Boolean) });
    /* tes lignes : des faits seulement (événements de tes lignes) ; les changements de météo ne sont jamais nommés dans ce message hebdomadaire (§ 18.4) :
       un simple compte renvoie vers les fiches des lignes */
    {
      const mem = objet(objet(ctx.d.routines).derniere_revue), avant = objet(mem.meteo);
      let nb = 0;
      ctx.lignes.forEach(l => { const m = meteo(constatsDe(ctx, l), l.role, null, today, ctx.rep("suivi_couverture_min_pct")).meteo; if (avant[l.id] && avant[l.id] !== m) nb++; });
      const deLigne = evts.filter(({ e, x }) => x.concerne && ["societe", "fonds"].includes(e.famille) && e.date >= il7 && e.date <= dans7);
      if (nb || deLigne.length) cartes.push({ type: "tes_lignes", titre: "Tes lignes", texte: [deLigne.length ? pluriel(deLigne.length, "événement") + " sur tes lignes" : "", nb ? "la météo de " + pluriel(nb, "ligne") + " a changé depuis ta dernière revue : le détail est sur leur fiche" : ""].filter(Boolean).join(" ; ") + ".",
        elements: deLigne.map(({ e, x }) => ({ genre: "evenement", id: e.id, date: e.date, titre: e.titre || e.type, raison: x.texte })), meteo_changee: nb, sources: [] });
    }
    const faire = declencheursCtx(ctx, o).filter(d => d.visible && (d.verdict === "vaut_le_cout" || (d.verdict === "a_peser" && LEVIERS_RISQUE.includes(d.levier))));
    cartes.push({ type: "a_faire", titre: "À faire, ou pas", texte: faire.length ? faire.length + (faire.length > 1 ? " sujets passent le test du coût." : " sujet passe le test du coût.") : AUCUNE_ACTION,
      elements: faire.map(d => ({ cle: d.cle, titre: d.titre, verdict: d.verdict, levier: d.levier, pourquoi: d.pourquoi })), sources: [] });
    const hab = habitudesCtx(ctx);
    cartes.push({ type: "habitudes", titre: "Tes bonnes habitudes", texte: hab.filter(h => h.palier).length + " habitude" + (hab.filter(h => h.palier).length > 1 ? "s" : "") + " en place sur " + hab.length + ".", elements: hab, sources: [] });
    cartes.push({ type: "demander_claude", titre: "Demander à Claude", texte: "Pose ta question à Claude.", elements: ["Que change la prochaine décision de la BCE pour moi ?", "Explique-moi le dernier changement sur mes lignes", "Prépare ma revue"], sources: [] });
    return { today, semaine: { du: il7, au: dans7 }, cartes, a_faire_texte: faire.length ? null : AUCUNE_ACTION, politique_semaine: pol.semaine };
  }

  /* ================================================================== vues assemblées (app et connecteur) */
  /** Prochaine revue selon le rôle : { date, texte }. */
  function revueDe(ctx, role) {
    if (role === "coeur" || role === null || role === undefined) {
      const r = prochaineRevueCoeur(ctx);
      return { frequence: ctx.politique.revue.coeur, date: r.date, mois: r.mois, due: r.due, en_retard: r.en_retard, texte: r.en_retard ? "La revue de ton cœur de " + moisEnLettres(r.mois) + " n'a pas été faite : elle est à faire." :
        r.due ? "Ton cœur est à revoir ce mois-ci (" + moisEnLettres(r.mois) + ")." : "Prochaine revue de ton cœur : " + moisEnLettres(r.mois) + "." };
    }
    return { frequence: "mensuelle", date: null, mois: null, due: true, texte: "Revue chaque mois, dans ta revue mensuelle avec Claude." };
  }
  /** Météo d'une ligne, avec le gel du cœur entre deux revues (mémoire de la dernière revue). */
  function meteoLigne(ctx, l, cs) {
    const mem = objet(objet(ctx.d.routines).derniere_revue), figee = objet(mem.meteo)[l.id];
    const rv = revueDe(ctx, l.role);
    const revue = figee && (l.role === "coeur" || l.role === null) && !rv.due ? { prochaine: rv.date, meteo_figee: figee } : null;
    return meteo(cs, l.role, revue, ctx.today, ctx.rep("suivi_couverture_min_pct"));
  }
  /** Raison du rôle proposé en mots ; une action « en direct » déduite du nom seul le dit (limite connue : un fonds sans frais renseignés peut être pris pour une action). */
  function raisonTexte(l) {
    const t = RAISON_LIB[l.raison] || l.raison;
    return l.raison === "action_directe" && l.ter == null && !(l.ins && l.ins.type_support) && l.roleSource !== "valide" ? t + " (déduite du nom et de l'ISIN : si c'est un fonds, dis-le à Claude)" : t;
  }
  function ligneVue(ctx, l, opts) {
    const cs = constatsDe(ctx, l), m = meteoLigne(ctx, l, cs), rv = revueDe(ctx, l.role);
    return { id: l.id, nom: l.p.name || l.p.bloc || "Ligne", enveloppe: l.enveloppe, bloc: l.p.bloc || null, classe: l.classe, classe_libelle: classeLib(l.classe), valeur: r2(l.valeur),
      poids_pct: ctx.I > 0 && l.role !== "reserve" ? r4(l.valeur * 100 / ctx.I) : null, role: l.role, role_libelle: l.role ? ROLES_LIB[l.role] : "Non classée", role_source: l.roleSource,
      role_propose: l.roleProp, raison_role: l.raison, raison_role_texte: raisonTexte(l), a_confirmer: l.roleSource !== "valide", meteo: m.meteo, meteo_libelle: m.libelle,
      couverture: m.couverture, couverture_texte: m.couverture_texte, gelee_jusquau: m.gelee_jusquau || null, constats: cs, revue: rv };
  }
  /** Vue d'ensemble : politique, système, lignes (rôle, météo), déclencheurs, habitudes. */
  function vue(data, today, options) {
    const ctx = contexte(data, today), o = objet(options);
    const lignes = ctx.lignes.map(l => ligneVue(ctx, l, o));
    const decl = declencheursCtx(ctx, o);
    return { today, politique: ctx.politique, systeme: systemeCtx(ctx), lignes, declencheurs: decl, habitudes: habitudesCtx(ctx),
      prochaine_revue_coeur: prochaineRevueCoeur(ctx), roles_a_confirmer: lignes.filter(l => l.a_confirmer).map(l => l.id) };
  }
  /** Regroupe les leviers qui poursuivent le même but : un seul par type de levier (« revenir sous le plafond satellite » vient à la fois du plafond du
      portefeuille et du poids de la ligne, « versements orientés » de l'écart de classe). On garde celui dont les données sont les mieux connues (verdict
      chiffré d'abord, puis portée la plus étroite : la ligne avant le portefeuille) ; les autres restent dans `fusionnes` (titre, mesure, seuil, ce qui manque)
      pour que rien ne se perde. Un déclencheur sans levier (baisse du satellite) reste seul. */
  function fusionnerLeviers(leviers) {
    const groupes = new Map();
    liste(leviers).forEach((x, i) => {
      const k = x.levier || "cle:" + x.cle;
      if (!groupes.has(k)) groupes.set(k, []);
      groupes.get(k).push({ x, i });
    });
    const rang = ({ x, i }) => [x.cout && x.cout.verdict ? 0 : x.cout && connu(x.cout.cout_unique) ? 1 : 2, liste(x.position_ids).length || 1e9, i];
    const avant = (a, b) => { for (let j = 0; j < 3; j++) if (a[j] !== b[j]) return a[j] - b[j]; return 0; };
    const out = [];
    groupes.forEach(g => {
      const tries = g.slice().sort((a, b) => avant(rang(a), rang(b))), garde = tries[0], autres = tries.slice(1);
      const lev = Object.assign({}, garde.x);
      if (autres.length) lev.fusionnes = autres.map(({ x }) => ({ cle: x.cle, titre: x.titre, pourquoi: x.pourquoi, mesure: x.mesure, seuil: x.seuil, verdict: x.verdict, manque: liste(x.cout && x.cout.manque) }));
      out.push({ i: garde.i, lev });
    });
    return out.sort((a, b) => a.i - b.i).map(o => o.lev);
  }
  /** Ta ligne : rôle, poids, constats, prochaine revue, leviers de sa classe dans son enveloppe (avec « ça vaut le coût ? »), un seul par but (fusionnerLeviers). */
  function ligne(data, position_id, today, options) {
    const ctx = contexte(data, today), l = ligneDe(ctx, position_id), o = objet(options);
    if (!l) return null;
    const v = ligneVue(ctx, l, o);
    const leviers = declencheursCtx(ctx, o).filter(d => d.position_ids.map(String).includes(String(l.id)) || (d.cle === "ecart_cible" && d.classe === groupeAllocation(l.classe)) || d.cle === "satellite_plafond" && l.role === "satellite").map(d => ({
      cle: d.cle, titre: d.titre, pourquoi: d.pourquoi, levier: d.levier, visible: d.visible, raison_visibilite: d.raison_visibilite, mesure: d.mesure, seuil: d.seuil, verdict: d.verdict, cout: d.cout,
      portee: d.portee, position_ids: d.position_ids, montant: d.montant == null ? null : d.montant }));
    return Object.assign(v, { leviers: fusionnerLeviers(leviers) });
  }

  /* ================================================================== mémoire de la revue (routines.etat_suivi, écrite par cloturer_routine) */
  const TAILLE_ETAT_MAX = 19000;
  /** État figé à la clôture d'une revue : déclencheurs existants (vus ou non), constats qui comptent pour « sante_degradee » (les écarts seulement : un constat
      absent était « bon »), météo de chaque ligne, date de la revue du cœur. Aucun texte libre ; 20 Ko au plus (les constats puis la météo « au clair »
      sont abandonnés les premiers au-delà de 19 000 octets). opts.coeur_revu : la revue du cœur vient d'être faite. */
  function etatSuivi(data, today, opts) {
    const ctx = contexte(data, today), o = objet(opts);
    const decl = declencheursCtx(ctx, {}).map(d => ({ cle: d.cle, cible: d.cible, mesure: d.mesure == null ? null : r4(+d.mesure) }));
    const constatsMem = {}, meteoMem = {};
    ctx.lignes.forEach(l => {
      const cs = constatsDe(ctx, l);
      const ecarts = {};
      cs.filter(c => ["chevauchement", "classe_risque"].includes(c.cle) && c.statut !== "bon" && c.statut !== "a_completer").forEach(c => { ecarts[c.cle] = c.statut; });
      if (Object.keys(ecarts).length) constatsMem[l.id] = ecarts;
      meteoMem[l.id] = meteoLigne(ctx, l, cs).meteo;
    });
    const rt = objet(ctx.d.routines);
    /* la revue du cœur n'est comptée faite que si elle était due (ce mois-ci ou en retard), quoi que dise l'appelant ; le mois de revue est retenu à la première clôture */
    const coeurFait = !!o.coeur_revu && prochaineRevueCoeur(ctx).due;
    const etat = { le: today, mois_revue_coeur: ctx.politique.mois_base, revue_coeur_faite_le: coeurFait ? today : estDate(rt.revue_coeur_faite_le) ? rt.revue_coeur_faite_le : null, declencheurs: decl, constats: constatsMem, meteo: meteoMem };
    const taille = () => JSON.stringify(etat).length;
    if (taille() > TAILLE_ETAT_MAX) etat.constats = {};
    if (taille() > TAILLE_ETAT_MAX) Object.keys(etat.meteo).forEach(id => { if (etat.meteo[id] === "clair") delete etat.meteo[id]; });
    if (taille() > TAILLE_ETAT_MAX) etat.declencheurs = etat.declencheurs.slice(0, 40);
    return etat;
  }
  /** Mémoire d'une revue (routines.etat_suivi) → routines de data : { passages, revue_coeur_faite_le, derniere_revue }. */
  function routinesDe(etat, passages) {
    const e = etat && typeof etat === "object" && !Array.isArray(etat) && estDate(etat.le) ? etat : null;
    return { passages: liste(passages).filter(estDate), revue_coeur_faite_le: e && estDate(e.revue_coeur_faite_le) ? e.revue_coeur_faite_le : null, derniere_revue: e };
  }

  /* ================================================================== adaptateur : état de l'app → data */
  /** Matelas (mois de dépenses) et coût total des supports (% par an) d'après les bonnes pratiques de l'app, pour les habitudes ; {} si le calcul échoue. */
  function santeDe(s, today) {
    try {
      const r = Pratiques.evaluer({ positions: s.positions, profil: s.profil, config: s.config, budget: s.budget, objectifs: s.objectifs, scope: "foyer", risque: s.risque, classes: s.classes, banque: s.banque || null, relevesBancaires: s.relevesBancaires || null, today: new Date(today + "T12:00:00Z") });
      const m = r.criteres.find(c => c.cle === "matelas"), f = r.criteres.find(c => c.cle === "frais");
      return { matelas_mois: m && !m.aCompleter && connu(m.valeur) ? +m.valeur : null, frais_pct: f && !f.aCompleter && f.frais && connu(f.frais.pct) ? +f.frais.pct : null };
    } catch (e) { return {}; }
  }
  /** État S du store de l'app (positions, config, profil, objectifs, risque, routines, journal, savoir.reperes, classes) → data du moteur. opts : { today, sante?, cours?, expositions? }. */
  function depuisEtat(S, opts) {
    const s = objet(S), o = objet(opts), today = o.today && estDate(o.today) ? o.today : new Date().toISOString().slice(0, 10);
    const rt = liste(s.routines).find(r => r && r.type === "revue_mensuelle") || null;
    const passages = liste(s.journal).filter(e => e && e.type === "revue" && e.creeLe).map(e => String(e.creeLe).slice(0, 10)).concat(rt && rt.dernierPassage ? [String(rt.dernierPassage).slice(0, 10)] : []).filter(estDate);
    return { today, positions: liste(s.positions), instruments: [], expositions: liste(o.expositions), config: objet(s.config), profil: objet(s.profil), objectifs: liste(s.objectifs),
      risque: { profil: (s.risque && s.risque.profil) || null }, routines: routinesDe(rt && rt.etatSuivi, passages), reperes: liste(objet(s.savoir).reperes), classes: objet(s.classes),
      cours: liste(o.cours), sante: o.sante || santeDe(s, today) };
  }

  /* ================================================================== phrases affichées (règles de présentation du § 18.4) */
  /** Phrase sur le verdict d'un levier : toujours sous le titre de la classe et de l'enveloppe, formulée sur le levier, jamais sur une ligne. */
  function phraseVerdict(res, quand) {
    if (!res || !res.verdict) return "Il manque une donnée pour chiffrer ce changement" + (res && res.manque && res.manque.length ? " : " + res.manque[0] + "." : ".");
    const regarde = quand ? "regardée le " + dateCourte(quand) : "regardée";
    const sujet = res.classe ? "Classe " + classeLib(res.classe) + (res.enveloppe ? " dans « " + res.enveloppe + " »" : "") : res.levier === "reduire_satellite" ? "Ta part satellite" : res.levier === "securiser_objectif" ? "L'argent de cet objectif" : "Ce levier";
    if (res.verdict === "vaut_le_cout") return sujet + ", " + regarde + " : le changement ne coûte " + (res.cout_unique > 0 ? "que " + eur(res.cout_unique) + " pour " + eur(res.gain_annuel) + " par an" : "rien") + " ; ça vaut le coût sur ton horizon.";
    if (res.verdict === "a_peser") return sujet + ", " + regarde + " : à peser, le changement coûte " + eur(res.cout_unique) + (res.gain_annuel > 0 ? " pour " + eur(res.gain_annuel) + " par an" : "") + ".";
    return sujet + ", " + regarde + " : la changer coûterait " + eur(res.cout_unique) + (res.gain_annuel > 0 ? " pour " + eur(res.gain_annuel) + " par an" : "") + " ; sur ton horizon, ne rien changer à cette classe est l'option la moins coûteuse.";
  }

  return { ROLES, ROLES_LIB, METEOS, METEO_LIB, STATUT_LIB, CONSTATS_LIB, VERDICT_LIB, CLASSE_LIB, LEVIERS, RAISON_LIB, DEFAUTS, classeLib, moisRevolus,
    roleParDefaut, roleEffectif, politique, systeme, constats, meteo, declencheurs, vautLeCout, habitudes, santeDe, etatSuivi, routinesDe, depuisEtat, effetRisque, exposition, maSemaine, AUCUNE_ACTION, vue, ligne, fusionnerLeviers, titreLevier, phraseVerdict, prochaineRevueCoeur: (data, today) => prochaineRevueCoeur(contexte(data, today)) };
});
