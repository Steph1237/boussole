/* Bonnes pratiques notées (Pilotage › Santé) : 4 familles de critères, chacun expliqué (règle, source, piste) et justifié (contrat
   de critère, spec docs/superpowers/specs/2026-10-12-cp4-sante-design.md § 3). Calculs purs, aucun accès au DOM.

   Pratiques.evaluer(ctx, deps?) → { total (0-100 ou null), couverture, criteresNotes, criteresAttendus, couvertureTexte, provisoire,
                                     familles: [{ cle, titre, poids, total, criteres, notes, attendus, couverture, couvertureTexte }],
                                     criteres: [...], complet, couts (« ce qui te coûte le plus », Plan.coutsPrincipaux) }
     ctx  = { positions, profil, config, budget, objectifs, scope, risque (Risque.evaluer : { profil: id } ou null), today,
              classes? (surcharges poche → classe, transmises à Risque.allocationReelle et Marche.classeRisque),
              banque? (S.banque : budget réel des comptes courants, Calc.budgetReel) }
     deps = { Risque?, Marche? } : modules injectés (null = absent) ; par défaut risque.js / marche.js s'ils sont chargés.
     Sans Risque : adéquation « à compléter » (calcul indisponible), spéculatif au plafond par défaut de 5 %.
     Sans Marche : crypto et levier repérés par la classe de la poche et le libellé (« 2x », « levier »).
   Critère : { cle, famille, titre, points, sur, valeur, cible, texte, piste, regle, source, aCompleter, lien, details?, informatif? }
     + contrat (Plan.contrat) : libelle, max, statut (bon · surveiller · travailler · a_completer · information), mesure, repere
       { texte, zones }, pourquoi, calcul, donnees [{ libelle, valeur, lien? ({ ligne } | { enveloppe }) }], ameliorer
       [{ action, gain_points, gain_note }], manque, source_donnees, confiance, points_perdus ; tableau (adéquation), frais (frais).
     - omis : sans objet (pas de crédit ni d'enfant, pas d'objectif Apport…), absent de la liste ;
     - à compléter : donnée manquante, points null, exclu des totaux ;
     - informatif (devises) : affiché, sans note (points null, sur 0), exclu des totaux.
   Famille = somme des points ÷ (20 × critères notés) × 100 ; global = moyenne pondérée (30 / 25 / 30 / 15) des familles notées.
   Couverture = critères notés ÷ critères attendus (hors informatifs), par famille et au global ; sous 60 %, la note globale (si elle
   existe) est provisoire.
   Points perdus d'un critère = (20 − points) ÷ (20 × notés de sa famille) × poids de la famille ÷ poids des familles notées × 100 :
   leur somme vaut 100 − total. gain_note : même règle appliquée au gain d'une action.
   Reprend Plan.score pour matelas, épargne, endettement et concentration (mêmes barèmes et points).
   Comptes courants (Calc.famille « courant », spec cp1 § 1) : comptés dans le patrimoine net et dans le matelas au-delà d'une
   réserve (Calc.matelasDisponible), mais exclus de la famille Allocation (adéquation, diversification, géographie, spéculatif,
   devises). Dépenses de référence (matelas, argent dormant) et capacité d'épargne : budget réel des comptes courants (ctx.banque, foyer
   seulement) s'il existe, sinon budget prévu ; la capacité d'épargne réelle est (revenus − dépenses) ÷ revenus,
   l'épargne versée (versements d'épargne et d'investissement) étant affichée à part. Projets proches (objectifs à moins de 3 ans, hors objectifs de type matelas ; un objectif
   sans montant rend le critère « à compléter ») : seul l'argent disponible ET peu risqué compte (épargne, monétaire, fonds en euros,
   obligations courtes identifiées), moins le matelas visé (config.cushion), qui reste pour les imprévus. Apport : poches rattachées
   à l'objectif, « à recevoir » à part. Frais des supports : frais courants des fonds (instruments.ter, en % par an) + frais
   d'enveloppe (config.frais_enveloppes), SCPI à part (critère informatif s'il n'y a que des SCPI), note sur la part connue, à
   compléter sous 70 % de couverture ; « direct » (0 %) seulement pour une action reconnue, toute autre ligne avec ISIN est un fonds ;
   surcoût, coût « après » et projection sur les seules lignes au coût total connu.
   Même règles dans le connecteur (bonnesPratiques, supabase/functions/mcp/index.ts), parité testée. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const facultatif = nom => { try { return require(nom); } catch (e) { return null; } };
  const api = isNode
    ? factory(require("./calc.js"), require("./plan.js"), () => facultatif("./risque.js"), () => facultatif("./marche.js"))
    : factory(root.Calc, root.Plan, () => root.Risque || null, () => root.Marche || null);
  if (isNode) module.exports = api;
  else root.Pratiques = api;
})(typeof self !== "undefined" ? self : this, function (Calc, Plan, risqueAuto, marcheAuto) {
  const n = v => (v !== null && v !== "" && isFinite(+v) ? +v : 0);
  const pos = v => Math.max(0, n(v));
  const connu = v => v !== null && v !== undefined && v !== "" && isFinite(+v);
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
  const sansAccent = s => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const r1 = x => Math.round(x * 10) / 10;
  const r2 = x => Math.round(x * 100) / 100;

  const FAMILLES = [
    { cle: "securite", titre: "Sécurité", poids: 30 },
    { cle: "effort", titre: "Effort", poids: 25 },
    { cle: "allocation", titre: "Allocation", poids: 30 },
    { cle: "efficacite", titre: "Efficacité", poids: 15 },
  ];
  const PLAFOND_SPECULATIF_DEFAUT = 0.05;
  const PLAFOND_PEA_DEFAUT = 150000;
  const HORIZON_COURT = 36; // mois : projets à moins de 3 ans (spec cp4 § 1.3)
  const SEUIL_FRAIS = 0.7; // couverture minimale des frais connus pour noter
  const RENDEMENT_PROJECTION = 5; // % par an, hypothèse affichée de la projection des frais

  /* ---------- formats ---------- */
  function fr(x, dec) {
    const s = Math.abs(x).toFixed(dec == null ? 1 : dec).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(".", ",");
    return (x < 0 ? "−" : "") + s.replace(/^(\d+)/, m => m.replace(/\B(?=(\d{3})+(?!\d))/g, " "));
  }
  const pct = (x, dec) => fr(x * 100, dec == null ? 0 : dec) + " %";
  const eur = x => fr(Math.round(x), 0) + " €";
  function interp(x, pts) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return pts[pts.length - 1][1];
  }
  const gain = (f, x, points) => Math.max(0, Math.round(f(x)) - (points || 0));
  const liste = (noms, max) => { const L = noms.slice(0, max || 3).map(x => "« " + x + " »"); return L.join(", ") + (noms.length > (max || 3) ? " et " + (noms.length - (max || 3)) + " autre" + (noms.length - (max || 3) > 1 ? "s" : "") : ""); };
  const lienLigne = p => (p.id ? { ligne: p.id } : p.envelope ? { enveloppe: p.envelope } : undefined);
  const donneeLigne = (p, extra) => Object.assign({ libelle: p.name || p.bloc || "Ligne", valeur: r2(montant(p)) }, lienLigne(p) ? { lien: lienLigne(p) } : {}, extra || {});

  /* ---------- dates (AAAA-MM-JJ) ---------- */
  const dateCible = o => o.dateCible || o.date_cible || null;
  const isoJour = d => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  const plusAns = (date, ans) => { const s = isoJour(date).split("-").map(Number); return String(s[0] + ans).padStart(4, "0") + "-" + String(s[1] || 1).padStart(2, "0") + "-" + String(s[2] || 1).padStart(2, "0"); };
  const frDate = d => isoJour(d).split("-").reverse().join("/");

  /* ---------- périmètre ---------- */
  const vivantes = (positions, scope) => (positions || []).filter(p => Calc.inScope(p, scope) && Calc.counted(p));
  const montant = p => Calc.val(p);
  const classeDe = (p, classes) => Calc.classe(p.bloc, classes);

  /* Objectifs à échéance de 3 ans ou moins (échéance dépassée comprise), avec le montant déjà affecté. */
  function objectifsCourts(objectifs, deja, today) {
    return (objectifs || []).filter(o => o && dateCible(o) && Plan.moisEntre(today, dateCible(o)) <= HORIZON_COURT)
      .map(o => ({ o, cible: pos(o.cible), deja: pos(deja[o.id]) }));
  }

  /* ---------- fabrique de critères ---------- */
  function critere(famille, cle, base, champs) {
    return Object.assign({ cle, famille, titre: base.titre, points: 0, sur: 20, valeur: null, cible: base.cible, texte: "", piste: "",
      regle: base.regle, source: base.source, aCompleter: false, lien: base.lien }, champs);
  }
  /* Critère à compléter : points null ; ex = explications du contrat (manque, ameliorer, repere…). */
  const aCompleter = (famille, cle, base, texte, piste, lien, ex) => Plan.contrat(critere(famille, cle, base, { aCompleter: true, points: null, texte, piste, lien: lien || base.lien }),
    Object.assign({ pourquoi: "Pas de note : " + texte.charAt(0).toLowerCase() + texte.slice(1), ameliorer: [{ action: piste, gain_points: null }], confiance: "absente" }, ex || {}));

  /* Critères repris de Plan.score : titre, cible, texte et piste viennent de Plan ; on ajoute famille, règle, source et lien. */
  const DE_PLAN = {
    matelas: { famille: "securite", regle: "Matelas = (épargne disponible + comptes courants au-delà de la réserve) ÷ dépenses mensuelles ; réserve = 1 mois de dépenses par défaut (réglable) ; dépenses réelles des comptes courants si connues, sinon budget prévu ; repère 3 à 6 mois",
      source: "Repère courant en gestion de patrimoine", lien: "patrimoine/budget" },
    epargne: { famille: "effort", regle: "Capacité d'épargne = (revenus − dépenses) ÷ revenus d'après les comptes courants (3 derniers mois complets) si la banque est connectée, l'épargne versée étant affichée à part ; sinon (épargne prévue + reste du mois) ÷ revenus du budget ; repère 15 % ou plus",
      source: "Repère courant en gestion de patrimoine", lien: "patrimoine/budget" },
    endettement: { famille: "effort", regle: "Endettement = mensualités de crédit ÷ revenus ; plafond 35 %",
      source: "HCSF, décision D-HCSF-2021-7", lien: "compte/donnees" },
    concentration: { famille: "allocation", regle: "Poids de la plus grosse ligne dans le financier ; repère 20 % au plus et au moins 3 poches",
      source: "Principe de diversification ; repère courant en gestion de patrimoine", lien: "patrimoine/placements" },
  };
  const depuisPlan = item => Object.assign({}, item, DE_PLAN[item.cle]);

  const B = {
    protection: { titre: "Protection de la famille", cible: "prévoyance et assurance emprunteur en place",
      regle: "Avec un crédit ou des enfants à charge : prévoyance (décès, invalidité) et assurance emprunteur souscrites",
      source: "Repère courant en gestion de patrimoine ; assurance emprunteur demandée par les banques pour un crédit immobilier", lien: "compte/donnees" },
    liquidite_objectifs: { titre: "Argent disponible pour les projets proches", cible: "100 % du besoin des objectifs à moins de 3 ans",
      regle: "(Argent disponible et peu risqué − matelas visé) ÷ montant des objectifs à moins de 3 ans (hors matelas) ; argent peu risqué : épargne disponible, monétaire, fonds en euros, obligations courtes ; actions, levier, crypto et SCPI exclus ; repère 100 %",
      source: "Repère courant en gestion de patrimoine : l'argent nécessaire à moins de 3 ans reste disponible et peu risqué", lien: "patrimoine/objectifs" },
    apport: { titre: "Apport pour le projet immobilier", cible: "l'apport visé (10 % du prix + frais de notaire)",
      regle: "Apport réuni (poches et enveloppes rattachées à l'objectif ; « à recevoir » exclu) ÷ apport visé ; repère : 10 % du prix + frais de notaire (≈ 8 % dans l'ancien)",
      source: "Pratique des banques ; frais d'acquisition dans l'ancien de 7 à 8 % (Notaires de France)", lien: "patrimoine/objectifs" },
    adequation: { titre: "Adéquation au profil de risque", cible: "chaque classe dans la fourchette de ton profil",
      regle: "Somme des écarts hors fourchette, par classe d'actifs, entre ton allocation et celle de ton profil (comptes courants exclus) ; 0 point → 20, 40 points ou plus → 0 ; repère 0 point",
      source: "Questionnaire de profil inspiré de l'adéquation MiFID II ; allocations indicatives de Boussole", lien: "pilotage/risque" },
    geographie: { titre: "Diversification géographique", cible: "au moins la moitié des actions sur le monde entier",
      regle: "Part des actions investies sur le monde entier (indices Monde, ACWI) ; repère 50 % ou plus",
      source: "Principe de diversification ; biais domestique (French et Poterba, 1991)", lien: "patrimoine/placements" },
    speculatif: { titre: "Part spéculative", cible: "sous le plafond de ton profil",
      regle: "(Crypto + produits à levier) ÷ financier ; repère : sous le plafond de ton profil (5 % par défaut)",
      source: "Plafonds indicatifs par profil de Boussole ; mises en garde de l'AMF sur les crypto-actifs et les produits à effet de levier", lien: "pilotage/risque" },
    devises: { titre: "Exposition hors euro", cible: "information, sans note",
      regle: "Part du financier exposée à une autre devise que l'euro (une zone hors Europe compte hors euro) ; information",
      source: "Risque de change : information, pas un défaut", lien: "patrimoine/placements" },
    frais: { titre: "Frais des supports", cible: "0,40 % par an ou moins",
      regle: "Coût annuel estimé = frais courants des fonds + frais de l'enveloppe (assurance-vie, PER, garde), en % de l'encours investi dont les frais sont connus ; titres en direct, crypto et liquidités à 0 ; SCPI à part ; à compléter sous 70 % de couverture ; repère 0,40 % ou moins",
      source: "Documents d'informations clés des fonds et conditions des contrats ; repères de Boussole (fiche frais-et-ter)", lien: "patrimoine/placements" },
    enveloppes: { titre: "Choix des enveloppes", cible: "aucun point d'attention",
      regle: "PEA avant compte-titres pour les actions européennes · assurance-vie de plus de 8 ans pour l'abattement · PER surtout à partir de 30 % d'imposition",
      source: "Code général des impôts : art. 163 quinquies D (PEA), art. 125-0 A et 990 I (assurance-vie), art. 163 quatervicies (PER)", lien: "patrimoine/placements" },
    dormant: { titre: "Argent dormant", cible: "12 mois de dépenses au plus sur livrets",
      regle: "Livrets et monétaire au-delà de 12 mois de dépenses, hors objectifs à moins de 3 ans ; repère 12 mois au plus",
      source: "Repère courant en gestion de patrimoine", lien: "patrimoine/budget" },
  };

  /* ---------- Sécurité ---------- */
  /* Matelas (spec cp1 § 1, cp4 § 1.7) : barème et textes de Plan.score (itemMatelas), appliqués au matelas disponible
     (Calc.matelasDisponible : épargne disponible + comptes courants au-delà de la réserve) et aux dépenses de référence dep
     ({ montant, source: "reel" | "prevu", periode } ou null). Plan.score reçoit une ligne « Épargne » de ce montant et des totaux de
     budget réduits à ces dépenses : une seule copie du barème. */
  function matelas(c, positions, scope, dep) {
    const d = dep ? dep.montant : 0;
    const m = Calc.matelasDisponible(positions, scope, { config: c.config, depenses: d });
    const totaux = { revenusProfil: 0, revenusLignes: 0, revenus: 0, depensesLignes: d, mensualites: 0, depenses: d, epargne: 0, reste: 0, tauxEpargne: null, parCategorie: {} };
    const ligne = { id: "matelas", owner: "p1", bloc: "Épargne", mode: "manual", value: m.total, status: "actif" };
    const item = Plan.score({ positions: [ligne], budget: totaux, scope: "foyer" }).items.find(i => i.cle === "matelas");
    const out = depuisPlan(item);
    const donnees = vivantes(positions, scope).filter(p => ["epargne", "courant"].includes(Calc.famille(p)) && montant(p) !== 0)
      .sort((a, b) => montant(b) - montant(a)).map(p => donneeLigne(p, Calc.famille(p) === "courant" ? { note: "compte courant : seul l'excédent au-delà de la réserve compte" } : {}));
    if (!item.aCompleter) out.texte = item.texte.replace(/\.$/, "") +
      (m.courants > 0 ? " (dont " + eur(m.courantsAuDela) + " sur tes comptes courants au-delà d'une réserve de " + fr(m.reserveMois) + " mois)" : "") +
      (dep.source === "reel" ? ", d'après tes dépenses réelles." : ".");
    return Plan.contrat(out, Plan.expliqueMatelas(item.aCompleter ? { mois: null, donnees } : { mois: item.valeur, total: m.total, epargne: m.epargne, courants: m.courants,
      courantsAuDela: m.courantsAuDela, reserveMois: m.reserveMois, reserve: m.reserve, depenses: d, source: dep.source, periode: dep.periode, avecCourants: true, donnees, points: item.points }));
  }

  function protection(profil, scope) {
    const pr = profil || {}, f = pr.foyer || {};
    const credit = Calc.dettes(pr, scope) > 0 || Calc.mensualites(pr, scope) > 0;
    const enfants = n(f.enfants) > 0 || n(f.enfants14) > 0;
    if (!credit && !enfants) return null;
    const attendus = credit ? ["prevoyance", "emprunteur"] : ["prevoyance"];
    const decl = pr.protection && pr.protection[scope] && typeof pr.protection[scope] === "object" ? pr.protection[scope] : pr.protection;
    const motif = credit && enfants ? "un crédit et des enfants" : credit ? "un crédit en cours" : "des enfants à charge";
    const libelle = { prevoyance: "prévoyance", emprunteur: "assurance emprunteur" };
    const f20 = x => (x >= 100 ? 20 : x > 0 ? 8 : 0);
    const repere = { texte: "Toutes les garanties attendues en place : 20 ; une partie : 8 ; aucune : 0.", zones: Plan.zones(f20, 0, 100) };
    if (!decl || attendus.some(k => typeof decl[k] !== "boolean"))
      return aCompleter("securite", "protection", B.protection, "Protection non renseignée, alors que tu as " + motif + ".",
        "Dis à Claude si une prévoyance" + (credit ? " et une assurance emprunteur couvrent" : " couvre") + " le foyer.", null,
        { repere, manque: attendus.filter(k => !decl || typeof decl[k] !== "boolean").map(k => "Ta " + libelle[k] + " : en place ou non") });
    const ok = attendus.filter(k => decl[k]).length;
    const manque = attendus.filter(k => !decl[k]).map(k => libelle[k]);
    const points = ok === attendus.length ? 20 : ok > 0 ? 8 : 0;
    return Plan.contrat(critere("securite", "protection", B.protection, { points, valeur: ok / attendus.length,
      texte: manque.length ? "Manque : " + manque.join(" et ") + " (tu as " + motif + ")." : "Protection en place pour " + motif + ".",
      piste: manque.length ? "Un décès ou une invalidité ne doit pas mettre le foyer en difficulté : vérifie d'abord les garanties de ton employeur, puis compare les contrats."
        : "Relis les garanties à chaque changement de situation (naissance, nouveau crédit)." }), {
      repere, source_donnees: "déclaration (profil)", confiance: "complete",
      mesure: { valeur: r1(ok / attendus.length * 100), unite: "%", texte: ok + " garantie" + (ok > 1 ? "s" : "") + " sur " + attendus.length + " en place" },
      calcul: ["Tu as " + motif + " : garanties attendues : " + attendus.map(k => libelle[k]).join(" et "),
        "En place : " + attendus.map(k => libelle[k] + " (" + (decl[k] ? "oui" : "non") + ")").join(", "),
        "Barème : toutes → 20 ; une partie → 8 ; aucune → 0 → " + points + "/20"],
      donnees: attendus.map(k => ({ libelle: libelle[k].charAt(0).toUpperCase() + libelle[k].slice(1), valeur: decl[k] ? "oui" : "non" })),
      ameliorer: manque.length ? [{ action: "Mets en place : " + manque.join(" et ") + " (vérifie d'abord les garanties de ton employeur).", gain_points: 20 - points }] : [],
      pourquoi: manque.length ? "Il manque : " + manque.join(" et ") + ", alors que tu as " + motif + "." : "Les garanties attendues pour " + motif + " sont en place." });
  }

  /* Argent sans risque de baisse et disponible (spec cp4 § 1.3) : épargne disponible, monétaire et comptes courants, fonds en euros,
     obligations courtes si leur nom les identifie ; hors enveloppes bloquées (PER, épargne salariale). */
  const RE_FONDS_EUROS = /fonds (en )?euros?\b/;
  const RE_OBLIG_COURTES = /court|short|ultra|\b0 ?[-à] ?[1-3] ?ans?\b|\b1 ?[-à] ?3 ?ans?\b|\b0-[1-3]\b|\b1-3\b/;
  function sansRisque(p, classes) {
    if (Calc.liquidite(p.envelope) === "bloque") return false;
    const cl = classeDe(p, classes), nom = sansAccent(p.name);
    return cl === "monetaire" || cl === "fonds_euros" || RE_FONDS_EUROS.test(nom) || (cl === "obligations" && RE_OBLIG_COURTES.test(nom));
  }

  /* Projets proches (spec cp4 § 1.3) : objectifs à moins de 3 ans, hors objectifs de type matelas (le matelas a son critère) ; un
     objectif sans montant rend le critère « à compléter ». L'argent sûr compte moins le matelas visé (config.cushion, Calc.matelas :
     minimum, ou mois × dépenses), qui reste pour les imprévus : pas de double comptage avec le matelas. */
  function liquiditeObjectifs(positions, objectifs, deja, scope, today, classes, config) {
    const courts = objectifsCourts(objectifs, deja, today).filter(x => x.o.type !== "matelas");
    if (!courts.length) return null;
    const f = x => Math.min(1, x / 100) * 20;
    const repere = { texte: "Argent disponible et peu risqué, matelas visé mis à part, ≥ montant des objectifs à moins de 3 ans : 20 ; proportionnel en dessous. Actions, levier, crypto et SCPI ne comptent pas : une baisse juste avant l'échéance n'aurait pas le temps de se rattraper.", zones: Plan.zones(f, 0, 150) };
    const sansMontant = courts.filter(x => !(x.cible > 0)).map(x => x.o.nom || "objectif");
    if (sansMontant.length) return aCompleter("securite", "liquidite_objectifs", B.liquidite_objectifs,
      (sansMontant.length > 1 ? "Montants de " + liste(sansMontant) + " manquants." : "Montant de « " + sansMontant[0] + " » manquant."),
      "Donne à Claude le montant visé de " + liste(sansMontant) + " pour mesurer l'argent prêt pour tes projets proches.", null,
      { repere, manque: sansMontant.map(nom => "Le montant de « " + nom + " » (objectif à moins de 3 ans)") });
    const besoin = sum(courts, x => x.cible);
    /* Disponible = lignes vendables sous quelques jours, plus les supports sans risque disponibles sous quelques semaines (fonds en
       euros d'une assurance-vie) : l'argent sans risque en est toujours une partie. */
    const L = vivantes(positions, scope).filter(p => montant(p) > 0);
    const surs = L.filter(p => sansRisque(p, classes)).sort((a, b) => montant(b) - montant(a));
    const sur = sum(surs, montant);
    const dispo = sum(L.filter(p => ["immediate", "jours"].includes(Calc.liquidite(p.envelope)) || sansRisque(p, classes)), montant);
    const mat = Calc.matelas(config), vise = mat ? pos(mat.min) : 0, pourProjets = Math.max(0, sur - vise);
    const objs = courts.map(x => "« " + (x.o.nom || "objectif") + " » " + eur(x.cible) + " (échéance " + frDate(dateCible(x.o)) + ")");
    const ratio = pourProjets / besoin;
    const points = Math.round(Math.min(1, ratio) * 20);
    return Plan.contrat(critere("securite", "liquidite_objectifs", B.liquidite_objectifs, { points, valeur: ratio,
      texte: eur(dispo) + " disponibles, dont " + eur(sur) + " sans risque de baisse" + (vise > 0 ? " (" + eur(pourProjets) + " une fois ton matelas visé de " + eur(vise) + " mis à part)" : "") +
        ", pour " + eur(besoin) + " à réunir d'ici 3 ans.",
      piste: ratio >= 1 ? "L'argent de tes projets proches est accessible sans attendre ni vendre au mauvais moment."
        : "L'argent nécessaire à moins de 3 ans gagne à être disponible et peu risqué (livrets, compte courant) : une baisse des marchés juste avant l'échéance n'aurait pas le temps de se rattraper." }), {
      repere, source_donnees: "objectifs, placements et matelas visé", confiance: "complete",
      mesure: { valeur: r1(ratio * 100), unite: "%", texte: pct(Math.min(ratio, 9.99)) + " du besoin couvert sans risque de baisse" },
      calcul: ["Objectifs à moins de 3 ans (hors matelas) : " + objs.join(", "), "Montant à réunir : " + eur(besoin),
        "Disponible sous quelques jours ou semaines : " + eur(dispo) + ", dont " + eur(sur) + " sans risque de baisse (épargne disponible, monétaire, fonds en euros)",
        "Le reste (" + eur(Math.max(0, dispo - sur)) + " : actions, levier, crypto) ne compte pas pour un projet à moins de 3 ans",
        vise > 0 ? "Ton matelas visé (" + eur(vise) + ") reste pour les imprévus : " + eur(sur) + " − " + eur(vise) + " = " + eur(pourProjets) + " pour tes projets"
          : "Aucun matelas visé réglé : tout l'argent sans risque de baisse est compté pour tes projets (une cible de matelas, réglée avec Claude, en serait retirée)",
        eur(pourProjets) + " ÷ " + eur(besoin) + " = " + pct(ratio, 1), "Barème : " + pct(Math.min(ratio, 1)) + " du besoin → " + points + "/20"],
      donnees: surs.map(p => donneeLigne(p)),
      ameliorer: ratio < 1 ? [{ action: "Place " + eur(besoin - pourProjets) + " de plus sur un support disponible et peu risqué (livret, fonds en euros) d'ici l'échéance" +
        (vise > 0 ? ", en plus de ton matelas." : "."), gain_points: 20 - points }] : [],
      pourquoi: ratio >= 1 ? "L'argent sans risque de baisse" + (vise > 0 ? ", matelas visé mis à part," : "") + " couvre tes projets à moins de 3 ans."
        : "Seuls " + eur(pourProjets) + " sont à la fois disponibles et sans risque de baisse" + (vise > 0 ? " une fois ton matelas visé mis à part" : "") +
          ", pour " + eur(besoin) + " de projets à moins de 3 ans." });
  }

  /* ---------- Effort ---------- */
  /* Apport (spec cp4 § 1.4) : déjà réuni (Plan.affecterDeja : poches rattachées, « à recevoir » exclu) ;
     lignes « à recevoir » rattachées affichées à part (comptées seulement si l'objectif le demande : inclureARecevoir). */
  function apport(objectifs, deja, positions, scope) {
    const L = (objectifs || []).filter(o => o && o.type === "apport");
    if (!L.length) return null;
    const cible = sum(L, o => (pos(o.cible) > 0 ? pos(o.cible) : 0.18 * pos(o.prix)));
    const rattachees = o => {
      const poches = Array.isArray(o.poches) ? o.poches : [], env = Array.isArray(o.enveloppes) ? o.enveloppes : [], qui = Plan.titulaireObjectif(o);
      return (positions || []).filter(p => p && Calc.inScope(p, scope) && (!qui || p.owner === qui) && (poches.includes(p.bloc) || env.includes(p.envelope)));
    };
    const inclure = o => o.inclureARecevoir === true || o.inclure_a_recevoir === true;
    const aRecevoirDe = o => (o.source === "poches" ? rattachees(o).filter(p => p.status === "à recevoir") : []);
    const recus = sum(L.filter(inclure), o => sum(aRecevoirDe(o), montant));
    const attendus = sum(L.filter(o => !inclure(o)), o => sum(aRecevoirDe(o), montant));
    const reuni = sum(L, o => pos(deja[o.id])) + recus;
    const f = x => Math.min(1, x / 100) * 20;
    const repere = { texte: "Apport réuni ≥ apport visé : 20 ; proportionnel en dessous. Repère des banques : au moins 10 % du prix plus les frais de notaire (≈ 8 % dans l'ancien).", zones: Plan.zones(f, 0, 150) };
    if (cible <= 0) return aCompleter("effort", "apport", B.apport, "Montant de l'apport non renseigné.", "Donne à Claude l'apport visé pour ton objectif Apport.", null,
      { repere, manque: ["Le montant de l'apport visé (ou le prix du projet)"] });
    const ratio = reuni / cible;
    const points = Math.round(Math.min(1, ratio) * 20);
    const donnees = [];
    L.forEach(o => {
      if (o.source !== "poches") { donnees.push({ libelle: (o.nom || "Apport") + " : montant saisi", valeur: r2(pos(o.deja)) }); return; }
      rattachees(o).filter(p => Calc.counted(p) && montant(p) > 0).sort((a, b) => montant(b) - montant(a)).forEach(p => donnees.push(donneeLigne(p)));
      aRecevoirDe(o).forEach(p => donnees.push(donneeLigne(p, { note: inclure(o) ? "à recevoir, compté" : "à recevoir, non compté" })));
    });
    const qui = L.map(Plan.titulaireObjectif).filter(Boolean);
    return Plan.contrat(critere("effort", "apport", B.apport, { points, valeur: ratio,
      texte: eur(reuni) + " réunis sur " + eur(cible) + " d'apport visé (" + pct(ratio) + ")" + (attendus > 0 ? ", + " + eur(attendus) + " attendus (à recevoir, non comptés)." : "."),
      piste: ratio >= 1 ? "Ton apport est réuni : les banques regarderont aussi ton endettement après l'achat."
        : "Les banques attendent en général au moins 10 % du prix plus les frais de notaire (≈ 8 % dans l'ancien) ; Patrimoine › Objectifs indique l'effort mensuel pour y arriver." }), {
      repere, donnees, source_donnees: "objectifs et placements", confiance: "complete",
      mesure: { valeur: r1(ratio * 100), unite: "%", texte: pct(ratio) + " de l'apport visé" },
      calcul: ["Apport visé : " + eur(cible),
        "Réuni sur les poches et enveloppes rattachées à l'objectif" + (qui.length ? " (lignes de la personne de l'objectif seulement)" : "") + ", réparties en cascade avec tes autres objectifs : " + eur(reuni - recus),
        ...(recus > 0 ? ["« À recevoir » compté à ta demande : " + eur(recus)] : []),
        ...(attendus > 0 ? ["« À recevoir » non compté tant qu'il n'est pas reçu : " + eur(attendus)] : []),
        eur(reuni) + " ÷ " + eur(cible) + " = " + pct(ratio, 1), "Barème : " + pct(Math.min(ratio, 1)) + " de l'apport → " + points + "/20"],
      ameliorer: ratio < 1 ? [
        { action: "Réunis encore " + eur(cible - reuni) + " sur les poches de l'objectif (Patrimoine › Objectifs indique l'effort mensuel).", gain_points: 20 - points },
        ...(attendus > 0 ? [{ action: "Quand les " + eur(attendus) + " attendus seront reçus sur une poche de l'objectif, ton apport passera à " + pct(Math.min(1, (reuni + attendus) / cible)) + ".", gain_points: gain(f, (reuni + attendus) / cible * 100, points) }] : [])] : [],
      pourquoi: eur(reuni) + " réunis sur " + eur(cible) + " visés" + (attendus > 0 ? " ; les " + eur(attendus) + " à recevoir ne comptent pas encore." : ".") });
  }

  /** Capacité d'épargne réelle (spec cp4 § 1.2) : (revenus − dépenses) ÷ revenus des comptes courants (Calc.budgetReel :
      tauxCapacite) ; l'épargne versée est affichée à part (elle en est une partie) ; barème de Plan.score. */
  function epargneReelle(reel, periode) {
    const t = reel.tauxCapacite, points = Math.round(Plan.BAREMES.epargne(t * 100));
    return Plan.contrat(Object.assign({ cle: "epargne", titre: "Capacité d'épargne", cible: "15 % des revenus ou plus", valeur: t, points, sur: 20, aCompleter: false,
      texte: t < 0 ? "Tes dépenses dépassent tes revenus de " + eur(-reel.capacite) + " par mois, d'après tes comptes (" + periode + ")."
        : "Tu dégages " + pct(t) + " de tes revenus (revenus − dépenses), d'après tes comptes (" + periode + "), dont " + eur(reel.epargne) + " par mois versés sur ton épargne.",
      piste: t >= 0.15 ? "Tu es au-dessus du repère de 15 % : de quoi alimenter tes objectifs régulièrement."
        : t < 0 ? "Tes dépenses dépassent tes revenus : les postes les plus lourds du budget sont le premier endroit où regarder."
        : "Le repère courant est de 15 % des revenus. Les postes les plus lourds du budget sont le premier endroit où regarder." }, DE_PLAN.epargne),
    Plan.expliqueEpargne({ taux: t, revenus: reel.revenus, depenses: reel.depenses, epargne: reel.epargne, source: "reel", periode, points,
      donnees: [{ libelle: "Revenus moyens", valeur: r2(reel.revenus) }, { libelle: "Dépenses moyennes", valeur: r2(reel.depenses) },
        { libelle: "Capacité d'épargne", valeur: r2(reel.capacite) }, { libelle: "Épargne versée", valeur: r2(reel.epargne) }] }));
  }

  /* ---------- Allocation ---------- */
  /* Profil déclaré (ctx.risque.profil : identifiant, ou objet { id }) et sa fiche dans Risque.PROFILS (liste ou table). */
  function idProfil(risque) {
    const p = risque && (risque.profil && typeof risque.profil === "object" ? risque.profil.id || risque.profil.cle : risque.profil);
    return p ? String(p) : null;
  }
  function ficheProfil(R, id) {
    const P = R && R.PROFILS;
    if (!P || !id) return null;
    const L = Array.isArray(P) ? P : Object.keys(P).map(k => Object.assign({ id: k }, P[k]));
    return L.find(x => x && x.id === id) || L.find(x => x && [x.id, x.label, x.nom].some(v => v && sansAccent(v) === sansAccent(id))) || null;
  }
  const nomProfil = (R, id) => { const p = ficheProfil(R, id); return (p && (p.label || p.nom || p.titre)) || id; };
  const enFraction = v => (v >= 1 ? v / 100 : v); // bornes en % (5) ou en fraction (0,05)

  /* Écarts par classe, quelle que soit la forme renvoyée par Risque.ecarts (liste ou table ; % ou fractions) :
     [{ groupe, libelle, pct, min, max, ecart (points de %, signé), hors (valeur absolue) }]. */
  function tableauEcarts(ecarts) {
    const src = (ecarts && !Array.isArray(ecarts) && (ecarts.ecarts || ecarts.parClasse)) || ecarts;
    const L = (Array.isArray(src) ? src : src && typeof src === "object" ? Object.keys(src).map(k => Object.assign({ groupe: k }, src[k])) : []).filter(e => e && typeof e === "object");
    const bornes = L.map(e => {
      const c = Array.isArray(e.cible) ? e.cible : [];
      const reel = [e.reel, e.actuel, e.part].find(connu), min = connu(e.min) ? e.min : c[0], max = connu(e.max) ? e.max : c[1];
      return connu(reel) && connu(min) && connu(max) ? { reel: +reel, min: +min, max: +max } : null;
    });
    const avec = bornes.filter(Boolean);
    const f = avec.length && avec.every(b => b.reel <= 1 && b.max <= 1) ? 100 : 1;
    return L.map((e, i) => {
      const b = bornes[i], g = e.groupe || e.classe || e.cle || "classe", libelle = e.label || e.libelle || g;
      if (b) {
        const ecart = (b.reel < b.min ? b.reel - b.min : b.reel > b.max ? b.reel - b.max : 0) * f;
        return { groupe: g, libelle, pct: r1(b.reel * f), min: b.min * f, max: b.max * f, ecart: r1(ecart), hors: Math.abs(ecart) };
      }
      const v = [e.hors, e.horsFourchette, e.ecart].find(connu);
      return { groupe: g, libelle, pct: null, min: null, max: null, ecart: connu(v) ? r1(+v) : 0, hors: connu(v) ? Math.abs(+v) : 0 };
    });
  }
  /* Points de pourcentage hors fourchette (somme des écarts absolus). */
  const pointsHors = ecarts => sum(tableauEcarts(ecarts), e => e.hors);

  const BAREME_ADEQUATION = x => interp(x, [[0, 20], [40, 0]]);
  function adequation(ctx, positions, scope, R) { // positions : toutes (Risque.allocationReelle écarte lui-même les comptes courants)
    const id = idProfil(ctx.risque);
    const repere = { texte: "0 point hors des fourchettes de ton profil : 20 ; 40 points ou plus : 0 (linéaire). Un point = 1 % du financier au-delà de la borne la plus proche.", zones: Plan.zones(BAREME_ADEQUATION, 0, 60) };
    if (!id) return aCompleter("allocation", "adequation", B.adequation, "Profil de risque non renseigné.",
      "Fais ton profil de risque avec Claude (une dizaine de questions) pour comparer ton allocation à celle de ton profil.", null, { repere, manque: ["Ton profil de risque (questionnaire)"] });
    const indispo = () => aCompleter("allocation", "adequation", B.adequation, "Calcul de l'écart au profil indisponible pour le moment.",
      "Rouvre Pilotage › Santé : l'écart à ton profil s'affichera dès que le calcul sera chargé.", null, { repere, manque: ["Le calcul de l'allocation (module de risque)"] });
    if (!R || typeof R.allocationReelle !== "function" || typeof R.ecarts !== "function") return indispo();
    if (Calc.financier(Calc.horsCourants(positions), scope) <= 0) return aCompleter("allocation", "adequation", B.adequation, "Aucun placement enregistré.",
      "Complète tes placements avec Claude pour les comparer à ton profil.", "patrimoine/placements", { repere, manque: ["Tes placements (lignes et montants)"] });
    let tableau, alloc;
    const fiche = ficheProfil(R, id);
    try { alloc = R.allocationReelle(positions, scope, { surcharge: ctx.classes }); tableau = tableauEcarts(R.ecarts(fiche && fiche.id || id, alloc)); } catch (e) { return indispo(); }
    const hors = sum(tableau, e => e.hors);
    const nom = nomProfil(R, id);
    const points = Math.round(BAREME_ADEQUATION(hors));
    const total = alloc && connu(alloc.total) ? +alloc.total : null;
    const decrit = e => e.libelle + " : " + (e.pct == null ? "?" : fr(e.pct, 1) + " %") + (e.min == null ? "" : " pour une fourchette de " + fr(e.min, 0) + " à " + fr(e.max, 0) + " %") +
      (e.hors > 0 ? " → " + fr(e.hors, 1) + " point" + (e.hors >= 2 ? "s" : "") + (e.ecart > 0 ? " au-dessus" : " en dessous") : " → dans la fourchette");
    return Plan.contrat(critere("allocation", "adequation", B.adequation, { points, valeur: Math.round(hors * 10) / 10,
      tableau: tableau.map(e => ({ groupe: e.groupe, libelle: e.libelle, pct: e.pct, min: e.min, max: e.max, ecart: e.ecart })),
      texte: hors <= 0 ? "Ton allocation est dans les fourchettes du profil " + nom + "." : fr(hors) + " points hors des fourchettes du profil " + nom + ".",
      piste: hors <= 0 ? "Ta répartition correspond au risque que tu as dit accepter."
        : "Le détail par classe est dans Pilotage › Risque : rapproche chaque classe de sa fourchette, de préférence avec tes versements à venir." }), {
      repere, source_donnees: "placements (hors comptes courants) et profil de risque", confiance: "complete",
      mesure: { valeur: r1(hors), unite: "points", texte: fr(hors) + " point" + (hors >= 2 ? "s" : "") + " hors des fourchettes" },
      calcul: ["Profil " + nom + " ; financier comparé (hors comptes courants)" + (total != null ? " : " + eur(total) : ""), ...tableau.map(decrit),
        "Somme des écarts : " + fr(hors) + " point" + (hors >= 2 ? "s" : ""), "Barème : " + fr(hors) + " → " + points + "/20"],
      donnees: tableau.map(e => ({ libelle: e.libelle, valeur: e.pct, unite: "%" })),
      ameliorer: tableau.filter(e => e.hors > 0).sort((a, b) => b.hors - a.hors).map(e => ({
        action: "Rapproche « " + e.libelle + " » de sa fourchette (" + fr(e.hors, 1) + " point" + (e.hors >= 2 ? "s" : "") + (total ? ", ≈ " + eur(e.hors / 100 * total) : "") + "), de préférence avec tes versements à venir.",
        gain_points: gain(BAREME_ADEQUATION, hors - e.hors, points) })),
      pourquoi: hors <= 0 ? "Chaque classe d'actifs est dans la fourchette du profil " + nom + "."
        : "Ton allocation s'écarte de " + fr(hors) + " point" + (hors >= 2 ? "s" : "") + " des fourchettes du profil " + nom + "." });
  }

  const RE_MONDE = /monde|world|acwi|all.?country|global|international/;
  const libelleGeo = p => sansAccent(p.zone || (p.bloc || "") + " " + (p.name || "")); // la zone de l'instrument prime
  const BAREME_GEOGRAPHIE = x => (x >= 50 ? 20 : interp(x / 100, [[0, 8], [0.5, 20]]));
  function geographie(positions, classes) {
    const actions = positions.filter(p => classeDe(p, classes) === "actions" && montant(p) > 0);
    const total = sum(actions, montant);
    if (total <= 0) return null;
    const monde = actions.filter(p => RE_MONDE.test(libelleGeo(p)));
    const part = sum(monde, montant) / total;
    const points = Math.round(BAREME_GEOGRAPHIE(part * 100));
    return Plan.contrat(critere("allocation", "geographie", B.geographie, { points, valeur: part,
      texte: pct(part) + " de tes actions couvrent le monde entier ; le reste vise une région, un pays ou des titres en direct.",
      piste: part >= 0.5 ? "Un socle « monde » répartit le risque sur des milliers d'entreprises et plusieurs économies ; tes paris régionaux s'y ajoutent."
        : "Miser sur une région n'est pas une erreur, mais le risque est plus concentré. Le biais domestique (surpondérer son pays ou sa région) est fréquent : un socle « monde » diversifie davantage." }), {
      repere: { texte: "50 % des actions ou plus sur le monde entier : 20 ; 0 % : 8 (linéaire entre les deux).", zones: Plan.zones(BAREME_GEOGRAPHIE, 0, 100) },
      source_donnees: "placements (zone de l'instrument, sinon poche et nom)", confiance: "complete",
      mesure: { valeur: r1(part * 100), unite: "%", texte: pct(part) + " des actions sur le monde entier" },
      calcul: ["Actions (hors comptes courants) : " + eur(total), "Dont couvrant le monde entier : " + eur(sum(monde, montant)) + (monde.length ? " (" + liste(monde.map(p => p.name || p.bloc), 4) + ")" : ""),
        eur(sum(monde, montant)) + " ÷ " + eur(total) + " = " + pct(part, 1), "Barème : " + pct(part, 1) + " → " + points + "/20"],
      donnees: actions.slice().sort((a, b) => montant(b) - montant(a)).slice(0, 8).map(p => donneeLigne(p, { note: RE_MONDE.test(libelleGeo(p)) ? "monde entier" : "région, pays ou titre" })),
      ameliorer: part < 0.5 ? [{ action: "Oriente ≈ " + eur((0.5 - part) * total) + " de tes actions (ou tes prochains versements) vers un socle couvrant le monde entier.", gain_points: 20 - points }] : [],
      pourquoi: pct(part) + " de tes actions couvrent le monde entier" + (part >= 0.5 ? ", au-dessus du repère de 50 %." : ", sous le repère de 50 %.") });
  }

  const RE_LEVIER = /\b\d(?:[.,]\d)?x\b|levier|leverag/;
  function estSpeculatif(p, classes, M) {
    if (M && typeof M.classeRisque === "function") {
      try { const c = M.classeRisque(p, classes); if (c) return c === "crypto" || c === "levier"; } catch (e) { /* repli sur le libellé */ }
    }
    return classeDe(p, classes) === "crypto" || RE_LEVIER.test(sansAccent((p.bloc || "") + " " + (p.name || "")));
  }
  function speculatif(ctx, positions, scope, R, M) {
    const F = Calc.financier(positions, scope);
    if (F <= 0) return aCompleter("allocation", "speculatif", B.speculatif, "Aucun placement enregistré.",
      "Complète tes placements avec Claude pour mesurer leur part spéculative.", "patrimoine/placements", { manque: ["Tes placements (lignes et montants)"] });
    const lignes = positions.filter(p => estSpeculatif(p, ctx.classes, M) && montant(p) !== 0).sort((a, b) => montant(b) - montant(a));
    const spec = sum(lignes, montant), part = spec / F;
    const id = idProfil(ctx.risque);
    const prof = ficheProfil(R, id);
    const s = prof && prof.cibles && prof.cibles.speculatif;
    const borne = Array.isArray(s) && connu(s[1]) ? enFraction(+s[1]) : null;
    const plafond = borne == null ? PLAFOND_SPECULATIF_DEFAUT : borne;
    const de = borne == null ? "plafond par défaut de " + pct(plafond) + (id ? "" : ", profil de risque non renseigné")
      : "plafond du profil " + nomProfil(R, id) + " : " + pct(plafond);
    const bar = x => (plafond > 0 ? interp(x / 100, [[plafond, 20], [2 * plafond, 0]]) : interp(x / 100, [[0, 20], [0.01, 0]]));
    const points = Math.round(bar(part * 100));
    return Plan.contrat(critere("allocation", "speculatif", B.speculatif, { points, valeur: part, cible: pct(plafond) + " au plus",
      lien: borne == null ? "pilotage/risque" : "patrimoine/placements",
      texte: "Crypto et produits à levier : " + pct(part, 1) + " du financier (" + de + ").",
      piste: part <= plafond ? "Cette part reste dans ce que ton profil peut encaisser : elle pourrait perdre l'essentiel de sa valeur sans compromettre tes projets."
        : "Ces supports peuvent perdre 80 % ou plus en quelques mois : au-delà du plafond, une telle baisse pèserait sur l'ensemble de ton patrimoine." }), {
      repere: { texte: "Jusqu'au plafond (" + pct(plafond) + ") : 20 ; 0 au double du plafond" + (plafond > 0 ? " (" + pct(2 * plafond) + ")" : " (1 %)") + ", linéaire entre les deux.",
        zones: Plan.zones(bar, 0, Math.max(10, plafond * 300)) },
      source_donnees: "placements (hors comptes courants)" + (borne == null ? "" : " et profil de risque"), confiance: "complete",
      mesure: { valeur: r1(part * 100), unite: "%", texte: pct(part, 1) + " du financier" },
      calcul: ["Lignes spéculatives (crypto, produits à levier) : " + (lignes.length ? lignes.map(p => (p.name || p.bloc) + " " + eur(montant(p))).join(", ") : "aucune"),
        "Total : " + eur(spec) + " sur un financier de " + eur(F) + " (hors comptes courants)", eur(spec) + " ÷ " + eur(F) + " = " + pct(part, 1),
        "Plafond : " + de, "Barème : " + pct(part, 1) + " → " + points + "/20"],
      donnees: lignes.map(p => donneeLigne(p, { poids_pct: r1(montant(p) / F * 100) })),
      ameliorer: part > plafond ? [{ action: "Ramène la part spéculative à " + pct(plafond) + " du financier (≈ " + eur((part - plafond) * F) + " de moins sur la crypto et le levier).", gain_points: 20 - points }] : [],
      pourquoi: "Crypto et levier pèsent " + pct(part, 1) + " du financier, " + (part <= plafond ? "sous le " : "au-dessus du ") + de + "." });
  }

  const RE_EURO = /france|zone euro|eurozone|^eur$|^euro$/;
  function devises(positions) {
    const exposition = p => {
      const d = p.devise_expo || p.devise;
      if (d) return String(d).toUpperCase() === "EUR" ? 0 : 1;
      if (!p.zone) return null;
      const z = sansAccent(p.zone);
      return RE_EURO.test(z) ? 0 : /europe/.test(z) ? null : 1; // Europe : euro et autres devises mêlés, inconnu
    };
    const connues = positions.map(p => ({ p, e: exposition(p), v: montant(p) })).filter(x => x.e != null && x.v > 0);
    const total = sum(connues, x => x.v);
    if (total <= 0) return null;
    const hors = sum(connues, x => x.v * x.e), part = hors / total;
    const couverture = total / Math.max(total, sum(positions, montant));
    return Plan.contrat(critere("allocation", "devises", B.devises, { informatif: true, points: null, sur: 0, valeur: part,
      texte: pct(part) + " exposés à une autre devise que l'euro" + (couverture < 0.999 ? " (sur les " + pct(couverture) + " du financier dont la devise est connue)." : "."),
      piste: "Ce n'est pas un défaut : une exposition hors euro diversifie, mais les variations de change s'ajoutent à celles des marchés." }), {
      repere: { texte: "Information, sans note : une exposition hors euro diversifie, mais ajoute le risque de change.", zones: [] },
      source_donnees: "devise et zone des instruments", confiance: couverture < 0.999 ? "partielle" : "complete",
      mesure: { valeur: r1(part * 100), unite: "%", texte: pct(part) + " hors euro" },
      calcul: ["Financier dont l'exposition est connue : " + eur(total) + " (" + pct(couverture) + " du financier)", "Exposé hors euro : " + eur(hors), eur(hors) + " ÷ " + eur(total) + " = " + pct(part, 1)],
      donnees: connues.filter(x => x.e === 1).sort((a, b) => b.v - a.v).slice(0, 8).map(x => donneeLigne(x.p)),
      pourquoi: "Information : " + pct(part) + " de ton financier (dont l'exposition est connue) dépend d'une autre devise que l'euro." });
  }

  /* ---------- Efficacité ---------- */
  /* Frais des supports (spec cp4 § 2). Nature d'une ligne : scpi (à part), fonds_euros, crypto, liquidites (espèces sans ISIN hors
     contrat), fonds (ETF, OPCVM, unités de compte : toute ligne d'un contrat d'assurance-vie ou de PER hors fonds en euros, monétaire
     compris ; toute ligne manuelle avec ISIN ; toute ligne avec ISIN non reconnue comme action : fonds au TER inconnu), direct
     (action reconnue, frais courants nuls ; sans ISIN, ligne qui n'a rien d'un fonds). */
  const RE_CONTRAT = /assurance.?vie|\bav\b|capitalisation|\bper\b|\bperin\b|\bperp\b|\bperco\b|\bpercol\b|\bpereco\b|\bmadelin\b|retraite/;
  const RE_FONDS = /\betf\b|\betc\b|ucits|\bfonds\b|\bfund\b|sicav|\bfcp\b|opcvm|tracker|indiciel|\bindex\b|\bmsci\b|s&p|stoxx|nasdaq|ftse|russell|amundi|lyxor|ishares|xtrackers|\bspdr\b|vanguard|invesco|wisdomtree/;
  const RE_SCPI = /\bscpi\b|\bopci\b/;
  const RE_ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
  const RE_SYMBOLE_ACTION = /^[A-Z][A-Z0-9&]{0,9}(?:[.-][A-Z]{1,4})?$/; // ticker (ASML.AS, AI.PA, BRK-B), pas un code de fonds (0P…)
  const CLASSES_ACTION = ["actions", "small_caps", "emergents"];
  const symboleDe = p => { const s = p && (p.symbol || (p.instrument && p.instrument.symbol)); return s ? String(s).trim().toUpperCase() : null; };
  /** Action reconnue (titre en direct, frais courants nuls) : classe actions, nom sans motif de fonds, ligne cotée (mode market), ISIN
      hors IE / LU (domiciliations des fonds) et, si le symbole est connu, symbole de type action. */
  function estAction(p, classes) {
    if (!CLASSES_ACTION.includes(Calc.classe(p.bloc, classes)) || p.mode !== "market") return false;
    if (RE_FONDS.test(sansAccent(p.name)) || /^(ie|lu)/.test(sansAccent(p.isin))) return false;
    const s = symboleDe(p);
    return !s || RE_SYMBOLE_ACTION.test(s);
  }
  function natureFrais(p, classes, ter) {
    const nom = sansAccent(p.name), env = sansAccent(p.envelope), cl = Calc.classe(p.bloc, classes);
    const isin = RE_ISIN.test(String(p.isin || "").trim().toUpperCase()), contrat = RE_CONTRAT.test(env);
    if (cl === "immobilier" || RE_SCPI.test(nom) || RE_SCPI.test(sansAccent(p.bloc))) return "scpi";
    if (cl === "fonds_euros" || RE_FONDS_EUROS.test(nom)) return "fonds_euros";
    if (cl === "crypto" || /crypto|binance/.test(env)) return "crypto";
    if (cl === "monetaire" && !contrat && !isin && !RE_FONDS.test(nom) && !connu(ter)) return "liquidites";
    if (contrat || connu(ter) || RE_FONDS.test(nom)) return "fonds";
    if (estAction(p, classes)) return "direct";
    return isin ? "fonds" : "direct";
  }
  /* Frais d'une enveloppe (config.frais_enveloppes[nom], nom exact ou sans accents ni casse). */
  function fraisEnveloppe(config, env) {
    const F = config && config.frais_enveloppes;
    if (!F || typeof F !== "object" || !env) return null;
    if (F[env] && typeof F[env] === "object") return F[env];
    const k = Object.keys(F).find(x => sansAccent(x) === sansAccent(env));
    return k && F[k] && typeof F[k] === "object" ? F[k] : null;
  }
  /* Repères de classe (jamais un produit nommé) : frais courants habituels d'un fonds indiciel de la classe. */
  const REPERES_FRAIS = {
    actions: { bas: 0.1, haut: 0.3, texte: "un fonds indiciel actions (monde, Europe, États-Unis) coûte souvent 0,10 à 0,30 % par an" },
    emergents: { bas: 0.15, haut: 0.4, texte: "un fonds indiciel actions émergentes coûte souvent 0,15 à 0,40 % par an" },
    small_caps: { bas: 0.2, haut: 0.45, texte: "un fonds indiciel petites capitalisations coûte souvent 0,20 à 0,45 % par an" },
    obligations: { bas: 0.1, haut: 0.3, texte: "un fonds indiciel obligataire coûte souvent 0,10 à 0,30 % par an" },
    or: { bas: 0.12, haut: 0.3, texte: "un support or coté (ETC) coûte souvent 0,12 à 0,30 % par an" },
    levier: { bas: 0.3, haut: 0.6, texte: "un ETF à effet de levier coûte souvent 0,30 à 0,60 % par an" },
    monetaire: { bas: 0.05, haut: 0.2, texte: "un fonds monétaire coûte souvent 0,05 à 0,20 % par an" },
  };
  const RE_EMERG = /emergent|emerging|\bem\b/, RE_SMALL = /small ?caps?|petites? cap/;
  function classeFrais(p, classes, M) {
    if (M && typeof M.classeRisque === "function") { try { const c = M.classeRisque(p, classes); if (c) return c; } catch (e) { /* repli */ } }
    const nom = sansAccent((p.bloc || "") + " " + (p.name || "")), cl = Calc.classe(p.bloc, classes);
    if (RE_LEVIER.test(nom)) return "levier";
    if (cl === "actions") return RE_SMALL.test(nom) ? "small_caps" : RE_EMERG.test(nom) ? "emergents" : "actions";
    return cl;
  }
  const BAREME_FRAIS = x => (x <= 0.4 ? 20 : x <= 0.75 ? 15 : x <= 1.2 ? 10 : x <= 1.8 ? 5 : 0);
  /* Écart de capital après ans années entre un rendement brut r (%) et le même rendement diminué de f (%), intérêts composés. */
  const projete = (capital, f, ans, r) => capital * (Math.pow(1 + r / 100, ans) - Math.pow(1 + (r - f) / 100, ans));

  /** Frais des supports d'un ensemble de lignes (comptées, du périmètre). opts = { classes, config, M, ter: p => frais courants (%) }.
      → { encours, encoursConnu, couverture, cout, coutFonds, coutEnveloppes, pct, lignes, scpi, fondsSansFrais, enveloppesACompleter,
          plusCouteuses, auDessusRepere, projection }. Même calcul dans le connecteur (fraisSupports, index.ts) et l'outil analyser. */
  function fraisSupports(positions, opts) {
    const o = opts || {}, terDe = o.ter || (p => p.ter);
    const L = (positions || []).filter(p => Calc.famille(p) === "investissement" && montant(p) > 0);
    const scpi = [], lignes = [], fondsSansFrais = [], aCompleterEnv = new Set();
    L.forEach(p => {
      const ter = terDe(p), nature = natureFrais(p, o.classes, ter), v = montant(p);
      if (nature === "scpi") { scpi.push({ id: p.id, nom: p.name || "SCPI", enveloppe: p.envelope || null, valeur: r2(v) }); return; }
      const contratEnv = RE_CONTRAT.test(sansAccent(p.envelope)), fe = fraisEnveloppe(o.config, p.envelope);
      const garde = fe && connu(fe.garde_pct) ? +fe.garde_pct : 0;
      let fonds = 0, env = garde, terConnu = true, envConnu = true;
      if (nature === "fonds") {
        if (connu(ter)) fonds = +ter; else terConnu = false;
        if (contratEnv) { if (fe && connu(fe.gestion_uc_pct)) env += +fe.gestion_uc_pct; else envConnu = false; }
      } else if (nature === "fonds_euros" && contratEnv) { if (fe && connu(fe.gestion_euro_pct)) env += +fe.gestion_euro_pct; else envConnu = false; }
      if (!terConnu) fondsSansFrais.push({ id: p.id, nom: p.name || p.bloc || "Fonds", enveloppe: p.envelope || null, valeur: r2(v) });
      if (!envConnu) aCompleterEnv.add(String(p.envelope || ""));
      const estConnu = terConnu && envConnu, total = fonds + env;
      lignes.push({ id: p.id, nom: p.name || p.bloc || "Ligne", enveloppe: p.envelope || null, nature, classe: classeFrais(p, o.classes, o.M), valeur: v,
        ter: nature === "fonds" && terConnu ? fonds : null, enveloppePct: envConnu ? env : null, totalPct: estConnu ? total : null, connu: estConnu,
        cout: estConnu ? v * total / 100 : null });
    });
    const encours = sum(lignes, l => l.valeur), connues = lignes.filter(l => l.connu), encoursConnu = sum(connues, l => l.valeur);
    const cout = sum(connues, l => l.cout), coutFonds = sum(connues, l => l.valeur * (l.ter || 0) / 100);
    const r = RENDEMENT_PROJECTION;
    /* Surcoût, coût « après » et projection : seules les lignes dont le coût total (frais du fonds et de l'enveloppe) est connu. */
    const auDessus = lignes.filter(l => l.connu && l.ter != null && l.ter > 0.5 && REPERES_FRAIS[l.classe] && l.ter > REPERES_FRAIS[l.classe].haut)
      .map(l => ({ id: l.id, nom: l.nom, enveloppe: l.enveloppe, valeur: r2(l.valeur), ter: l.ter, classe: l.classe, repere: REPERES_FRAIS[l.classe],
        ecartPct: r2(l.ter - REPERES_FRAIS[l.classe].haut), surcout: r2(l.valeur * (l.ter - REPERES_FRAIS[l.classe].haut) / 100) }))
      .sort((a, b) => b.surcout - a.surcout);
    const surcout = sum(auDessus, x => x.surcout);
    return {
      encours: r2(encours), encoursConnu: r2(encoursConnu), couverture: encours > 0 ? encoursConnu / encours : 0,
      cout: r2(cout), coutFonds: r2(coutFonds), coutEnveloppes: r2(cout - coutFonds), pct: encoursConnu > 0 ? cout / encoursConnu * 100 : null,
      lignes, scpi: scpi.sort((a, b) => b.valeur - a.valeur), fondsSansFrais: fondsSansFrais.sort((a, b) => b.valeur - a.valeur), enveloppesACompleter: [...aCompleterEnv].filter(Boolean).sort(),
      plusCouteuses: connues.filter(l => l.cout > 0).sort((a, b) => b.cout - a.cout || String(a.nom).localeCompare(String(b.nom))).slice(0, 5)
        .map(l => ({ id: l.id, nom: l.nom, enveloppe: l.enveloppe, valeur: r2(l.valeur), fraisPct: r2(l.totalPct), coutAnnuel: r2(l.cout) })),
      auDessusRepere: auDessus,
      projection: { rendementPct: r,
        frais: { ans10: Math.round(sum(connues, l => projete(l.valeur, l.totalPct, 10, r))), ans20: Math.round(sum(connues, l => projete(l.valeur, l.totalPct, 20, r))) },
        ecart: { annuel: r2(surcout), ans10: Math.round(sum(auDessus, x => projete(x.valeur, x.ecartPct, 10, r))), ans20: Math.round(sum(auDessus, x => projete(x.valeur, x.ecartPct, 20, r))) } },
    };
  }

  const extraitFrais = fs => ({ encours: fs.encours, encoursConnu: fs.encoursConnu, couverture: Math.round(fs.couverture * 1000) / 1000, cout: fs.cout,
    pct: fs.pct == null ? null : r2(fs.pct), plusCouteuses: fs.plusCouteuses, auDessusRepere: fs.auDessusRepere, scpi: fs.scpi, fondsSansFrais: fs.fondsSansFrais,
    enveloppesACompleter: fs.enveloppesACompleter, projection: fs.projection });
  const texteScpi = total => "SCPI (" + eur(total) + ") à part : frais de souscription (souvent 8 à 12 % à l'entrée) et de gestion (prélevés sur les loyers), non comparables à des frais courants, hors note";
  /* Placements investis uniquement en SCPI : pas de note, mais l'information sur leurs frais reste visible (critère informatif). */
  function fraisScpiSeules(fs) {
    const total = sum(fs.scpi, x => x.valeur);
    return Plan.contrat(critere("efficacite", "frais", B.frais, { informatif: true, points: null, sur: 0, valeur: null,
      frais: extraitFrais(fs),
      texte: "Tes placements investis sont des SCPI (" + eur(total) + ") : leurs frais ne se comparent pas à des frais courants, ils sont donnés à titre d'information.",
      piste: "Les frais d'une SCPI se regardent à l'entrée (souscription) et sur les loyers (gestion) : relis-les dans sa documentation avant tout nouveau versement." }), {
      repere: { texte: "Information, sans note : les frais des SCPI (souscription, gestion) ne sont pas des frais courants.", zones: [] },
      source_donnees: "placements (SCPI)", confiance: "complete",
      mesure: { valeur: null, unite: "€", texte: eur(total) + " de SCPI" },
      calcul: [texteScpi(total)],
      donnees: fs.scpi.map(x => Object.assign({ libelle: x.nom, valeur: x.valeur }, x.id ? { lien: { ligne: x.id } } : x.enveloppe ? { lien: { enveloppe: x.enveloppe } } : {})),
      pourquoi: "Information : tes placements investis sont des SCPI, dont les frais ne se notent pas comme des frais courants." });
  }
  function frais(c, positions, M) {
    const fs = fraisSupports(positions, { classes: c.classes, config: c.config, M });
    if (fs.encours <= 0) return fs.scpi.length ? fraisScpiSeules(fs) : null;
    const repere = { texte: "0,40 % par an ou moins : 20 ; jusqu'à 0,75 % : 15 ; jusqu'à 1,20 % : 10 ; jusqu'à 1,80 % : 5 ; au-delà : 0 (repères de Boussole, fiche frais-et-ter). Repère de classe : " + REPERES_FRAIS.actions.texte + ".",
      zones: Plan.zones(BAREME_FRAIS, 0, 2.5) };
    const extrait = extraitFrais(fs);
    const pc = fs.pct, cv = fs.couverture;
    const calcul = ["Encours investi (hors SCPI, livrets et comptes courants) : " + eur(fs.encours),
      "Dont frais connus : " + eur(fs.encoursConnu) + " (" + pct(cv) + ") ; titres en direct, crypto et liquidités comptent pour 0 %",
      "Frais des fonds : " + eur(fs.coutFonds) + " par an ; frais d'enveloppe : " + eur(fs.coutEnveloppes) + " par an",
      "Coût total : " + eur(fs.cout) + (pc == null ? "" : " ÷ " + eur(fs.encoursConnu) + " = " + fr(pc, 2) + " % par an")];
    if (fs.scpi.length) calcul.push(texteScpi(sum(fs.scpi, x => x.valeur)));
    const manque = [...(fs.fondsSansFrais.length ? ["Frais courants de " + fs.fondsSansFrais.length + " fonds : " + liste(fs.fondsSansFrais.map(x => x.nom), 5)] : []),
      ...fs.enveloppesACompleter.map(e => "Frais de gestion du contrat « " + e + " » (unités de compte, fonds en euros)")];
    const donnees = [...fs.plusCouteuses.map(l => ({ libelle: l.nom + " (" + fr(l.fraisPct, 2) + " % par an)", valeur: l.coutAnnuel, unite: "€ par an", lien: l.id ? { ligne: l.id } : { enveloppe: l.enveloppe } })),
      ...fs.fondsSansFrais.slice(0, 8).map(x => ({ libelle: x.nom + " (frais inconnus)", valeur: x.valeur, lien: x.id ? { ligne: x.id } : { enveloppe: x.enveloppe } })),
      ...fs.enveloppesACompleter.map(e => ({ libelle: e + " (frais du contrat à compléter)", valeur: null, lien: { enveloppe: e } }))];
    const completer = (fs.fondsSansFrais.length ? fs.fondsSansFrais.length + " fonds (dont " + liste(fs.fondsSansFrais.map(x => x.nom), 2) + ")" : "") +
      (fs.fondsSansFrais.length && fs.enveloppesACompleter.length ? " et " : "") + (fs.enveloppesACompleter.length ? "les frais de " + liste(fs.enveloppesACompleter, 2) : "");
    if (cv < SEUIL_FRAIS) {
      calcul.push("Couverture de " + pct(cv) + ", sous le seuil de 70 % : pas de note");
      return Object.assign(aCompleter("efficacite", "frais", B.frais,
        "Frais connus sur " + pct(cv) + " de tes placements : coût partiel de " + eur(fs.cout) + " par an" + (pc == null ? "." : " (" + fr(pc, 2) + " %)."),
        "Demande à Claude de compléter les frais courants de tes fonds et les frais de tes contrats (assurance-vie, PER).", "agent/connexion", {
          repere, calcul, donnees, manque, confiance: cv > 0 ? "partielle" : "absente", source_donnees: "frais des fonds et des contrats renseignés",
          mesure: { valeur: pc == null ? null : r2(pc), unite: "% par an", texte: "coût partiel : " + eur(fs.cout) + " par an sur " + pct(cv) + " de tes placements" },
          pourquoi: "Pas encore de note : les frais ne sont connus que pour " + pct(cv) + " de tes placements (il en faut 70 %).",
          ameliorer: [{ action: "Fais compléter par Claude " + (completer || "les frais manquants") + " : la note sera calculée au-delà de 70 % de couverture.", gain_points: null }] }),
        { valeur: pc, frais: extrait });
    }
    const points = BAREME_FRAIS(pc);
    calcul.push("Barème : " + fr(pc, 2) + " % → " + points + "/20");
    if (fs.auDessusRepere.length) calcul.push("Projection de l'écart au repère de classe, à rendement brut égal de " + fr(RENDEMENT_PROJECTION, 0) + " % par an (hypothèse) : ≈ " +
      eur(fs.projection.ecart.ans10) + " sur 10 ans, " + eur(fs.projection.ecart.ans20) + " sur 20 ans");
    const apres = Math.max(0, fs.encoursConnu > 0 ? (fs.cout - fs.projection.ecart.annuel) / fs.encoursConnu * 100 : pc);
    return Plan.contrat(critere("efficacite", "frais", B.frais, { points, valeur: pc, frais: extrait,
      texte: "Coût estimé de " + fr(pc, 2) + " % par an, soit " + eur(fs.cout) + " par an" + (cv < 0.999 ? " (sur les " + pct(cv) + " de tes placements dont les frais sont connus)." : "."),
      piste: pc <= 0.4 ? "Tes frais sont bas : sur 20 ans, chaque 0,1 % économisé compte."
        : "Un écart de frais se compose : regarde d'abord les lignes qui coûtent le plus en euros et le repère de leur classe d'actifs." }), {
      repere, calcul, donnees, manque, source_donnees: "frais des fonds et des contrats renseignés", confiance: cv >= 0.999 ? "complete" : "partielle",
      mesure: { valeur: r2(pc), unite: "% par an", texte: fr(pc, 2) + " % par an, soit " + eur(fs.cout) + " par an" },
      ameliorer: [
        ...(fs.auDessusRepere.length ? [{ action: "Si " + (fs.auDessusRepere.length > 1 ? "les " + fs.auDessusRepere.length + " lignes au-dessus du repère de leur classe coûtaient" : "« " + fs.auDessusRepere[0].nom + " » coûtait") +
          " le haut de ce repère, ton coût passerait à " + fr(apres, 2) + " % par an (≈ −" + eur(fs.projection.ecart.annuel) + " par an).", gain_points: gain(BAREME_FRAIS, apres, points) }] : []),
        ...(cv < 0.999 && completer ? [{ action: "Fais compléter par Claude " + completer + " pour une note sur tous tes placements.", gain_points: null }] : [])],
      pourquoi: "Tes placements coûtent environ " + fr(pc, 2) + " % par an (" + eur(fs.cout) + "), " + (pc <= 0.4 ? "dans le repère de 0,40 %." : "au-dessus du repère de 0,40 %.") });
  }

  const RE_CTO = /\bcto\b|compte[- ]?titres?/, RE_PEA = /\bpea\b/, RE_PER = /\bper\b|\bperin\b|\bperco\b/, RE_AV = /assurance.?vie|\bav\b|capitalisation/;
  const RE_EUROPE = /europe|france|\bcac\b|stoxx|zone euro/;
  const ISIN_EEE = ["FR", "NL", "DE", "BE", "IT", "ES", "PT", "AT", "FI", "DK", "SE", "NO", "GR"]; // émetteurs éligibles au PEA (hors IE / LU, surtout des ETF)
  const estEuropeenne = (p, classes) => classeDe(p, classes) === "actions" &&
    (RE_EUROPE.test(libelleGeo(p)) || ISIN_EEE.includes(String(p.isin || "").slice(0, 2).toUpperCase()));

  /* Date d'ouverture (profil.av_ouverture : date, ou { enveloppe: date }) ou date des 8 ans (échéance « 8 ans … assurance vie »). */
  function datesAV(env, profil, config) {
    const o = profil && profil.av_ouverture;
    if (o && typeof o === "object" && o[env]) return { ouverture: o[env] };
    if (typeof o === "string" && o) return { ouverture: o };
    const titre = m => sansAccent(m.title || m.titre);
    const ms = (config && Array.isArray(config.milestones) ? config.milestones : []).find(m => m && m.date && RE_AV.test(titre(m)) && /8 ans/.test(titre(m)));
    return ms ? { huitAns: ms.date } : null;
  }

  const ACTIONS_ENVELOPPES = {
    pea: "Les actions européennes de ton compte-titres seraient éligibles au PEA, qui a encore de la place.",
    av: "Prévois l'argent de cet objectif ailleurs, ou une échéance après les 8 ans du contrat.",
    per: "Vérifie l'intérêt de tes versements sur le PER au regard de ta tranche d'imposition.",
  };
  function enveloppes(ctx, positions, deja, today) {
    const classes = ctx.classes, details = [], env = p => sansAccent(p.envelope);
    const alerts = ctx.config && ctx.config.alerts;
    const cap = alerts && connu(alerts.peaVersementsCap) ? +alerts.peaVersementsCap : PLAFOND_PEA_DEFAUT;
    /* 1. Actions européennes en compte-titres alors que le PEA du même titulaire a de la place (valeur < plafond de versements). */
    const parTitulaire = {};
    positions.filter(p => RE_CTO.test(env(p)) && estEuropeenne(p, classes)).forEach(p => { (parTitulaire[p.owner] = parTitulaire[p.owner] || []).push(p); });
    Object.keys(parTitulaire).forEach(owner => {
      const cto = parTitulaire[owner], peas = {};
      positions.filter(p => p.owner === owner && RE_PEA.test(env(p))).forEach(p => { peas[p.envelope] = (peas[p.envelope] || 0) + montant(p); });
      const libre = Object.keys(peas).find(k => peas[k] < cap);
      if (libre) details.push({ cle: "pea", statut: "probleme",
        texte: eur(sum(cto, montant)) + " d'actions européennes (" + cto.map(p => p.name).join(", ") + ") sont en compte-titres alors que le " + libre +
          " a encore de la place : dans un PEA de plus de 5 ans, les gains ne supportent que les prélèvements sociaux." });
      else details.push({ cle: "pea", statut: "ok", texte: Object.keys(peas).length
        ? "Actions européennes en compte-titres, mais le PEA du même titulaire a atteint son plafond : rien à changer."
        : "Actions européennes en compte-titres, sans PEA au nom du même titulaire." });
    });
    /* 2. Assurance-vie : abattement annuel sur les gains retirés après 8 ans. */
    [...new Set(positions.filter(p => RE_AV.test(env(p))).map(p => p.envelope))].forEach(nom => {
      const d = datesAV(nom, ctx.profil, ctx.config);
      if (!d) { details.push({ cle: "av", statut: "neutre", texte: nom + " : date d'ouverture inconnue (l'abattement sur les gains s'applique après 8 ans)." }); return; }
      const huit = d.huitAns || plusAns(d.ouverture, 8);
      if (isoJour(huit) <= isoJour(today)) { details.push({ cle: "av", statut: "ok", texte: nom + " a plus de 8 ans : abattement annuel sur les gains retirés." }); return; }
      const blocs = new Set(positions.filter(p => p.envelope === nom).map(p => p.bloc));
      const avant = (ctx.objectifs || []).find(o => o && o.source === "poches" && dateCible(o) && isoJour(dateCible(o)) < isoJour(huit) && pos(deja[o.id]) > 0 &&
        ((o.enveloppes || []).includes(nom) || (o.poches || []).some(b => blocs.has(b))));
      if (avant) details.push({ cle: "av", statut: "probleme",
        texte: nom + " aura 8 ans le " + frDate(huit) + ", après l'échéance de « " + (avant.nom || "ton objectif") + " » qu'elle finance : un retrait avant 8 ans ne profite pas de l'abattement." });
      else details.push({ cle: "av", statut: "note", texte: nom + " aura 8 ans le " + frDate(huit) + " : d'ici là, les gains retirés ne profitent pas de l'abattement annuel." });
    });
    /* 3. PER : la déduction à l'entrée vaut surtout à partir d'une tranche à 30 %. */
    if (positions.some(p => RE_PER.test(env(p)))) {
      const tmi = ctx.profil && ctx.profil.foyer && ctx.profil.foyer.tmi;
      if (!connu(tmi)) details.push({ cle: "per", statut: "neutre", texte: "Tranche d'imposition inconnue : le PER est surtout intéressant à partir de 30 %." });
      else if (+tmi < 30) details.push({ cle: "per", statut: "probleme",
        texte: "Tranche à " + fr(+tmi, 0) + " % : le PER est surtout intéressant à partir de 30 %, car la déduction à l'entrée vaut peu face à l'impôt à la sortie." });
      else details.push({ cle: "per", statut: "ok", texte: "Tranche à " + fr(+tmi, 0) + " % : les versements sur le PER réduisent nettement l'impôt." });
    }
    if (!details.length) return null;
    const pb = details.filter(d => d.statut === "probleme");
    const f = k => Math.max(0, 20 - 6 * k), points = f(pb.length);
    const envs = [...new Set(positions.filter(p => RE_CTO.test(env(p)) || RE_PEA.test(env(p)) || RE_AV.test(env(p)) || RE_PER.test(env(p))).map(p => p.envelope).filter(Boolean))].sort();
    return Plan.contrat(critere("efficacite", "enveloppes", B.enveloppes, { points, valeur: pb.length, details,
      texte: pb.length ? pb.length + " point" + (pb.length > 1 ? "s" : "") + " d'attention sur le choix des enveloppes." : "Tes enveloppes sont utilisées dans le bon ordre.",
      piste: pb.length ? pb.map(d => d.texte).join(" ") : "Rien à changer : chaque enveloppe joue son rôle fiscal." }), {
      repere: { texte: "Aucun point d'attention : 20 ; 6 points de moins par point d'attention (plancher 0).", zones: Plan.zones(f, 0, 4) },
      source_donnees: "placements, profil (tranche d'imposition, ouverture des contrats) et objectifs", confiance: details.some(d => d.statut === "neutre") ? "partielle" : "complete",
      mesure: { valeur: pb.length, unite: "points d'attention", texte: pb.length + " point" + (pb.length > 1 ? "s" : "") + " d'attention" },
      calcul: [...details.map(d => ({ probleme: "À revoir : ", ok: "Bon : ", note: "À noter : ", neutre: "Inconnu : " }[d.statut] || "") + d.texte), "Barème : 20 − 6 × " + pb.length + " → " + points + "/20"],
      donnees: envs.map(e => ({ libelle: e, valeur: r2(sum(positions.filter(p => p.envelope === e), montant)), lien: { enveloppe: e } })),
      manque: details.filter(d => d.statut === "neutre").map(d => d.texte),
      ameliorer: pb.map(d => ({ action: ACTIONS_ENVELOPPES[d.cle] || d.texte, gain_points: Math.min(6, 20 - points) })),
      pourquoi: pb.length ? pb.length + " point" + (pb.length > 1 ? "s" : "") + " d'attention : " + pb.map(d => d.texte).join(" ") : "Chaque enveloppe joue son rôle fiscal." });
  }

  const BAREME_DORMANT = m => (m <= 12 ? 20 : interp(m, [[12, 20], [24, 10], [36, 5]]));
  function dormant(ctx, positions, dep, deja, today) {
    const depenses = dep ? dep.montant : 0;
    if (!(depenses > 0)) return aCompleter("efficacite", "dormant", B.dormant, "Dépenses mensuelles inconnues.",
      "Donne tes dépenses à Claude pour mesurer l'argent qui dort.", null, { manque: ["Tes dépenses mensuelles (budget, ou banque connectée)"] });
    const L = positions.filter(p => classeDe(p, ctx.classes) === "monetaire");
    const livrets = sum(L, montant);
    /* L'argent des projets à moins de 3 ans ne dort pas ; le matelas est déjà couvert par les 12 mois tolérés. */
    const reserve = sum(objectifsCourts(ctx.objectifs, deja, today).filter(x => x.o.type !== "matelas"), x => x.cible);
    const mois = Math.max(0, livrets - reserve) / depenses;
    const points = Math.round(BAREME_DORMANT(mois));
    const src = dep.source === "reel" ? "réel" + (dep.periode ? ", " + dep.periode : "") : "budget prévu";
    return Plan.contrat(critere("efficacite", "dormant", B.dormant, { points, valeur: mois,
      texte: fr(mois) + " mois de dépenses sur livrets et monétaire" + (reserve > 0 ? ", hors " + eur(reserve) + " réservés aux projets à moins de 3 ans." : "."),
      piste: mois <= 12 ? "Ton argent disponible correspond à tes besoins : rien ne dort inutilement."
        : "Au-delà d'un an de dépenses, l'argent des livrets perd souvent face à l'inflation : une partie pourrait servir un objectif de long terme, sur un support adapté à ton profil." }), {
      repere: { texte: "12 mois de dépenses ou moins sur livrets et monétaire : 20 ; 24 mois : 10 ; 36 mois ou plus : 5.", zones: Plan.zones(BAREME_DORMANT, 0, 48) },
      source_donnees: src, confiance: "complete",
      mesure: { valeur: r1(mois), unite: "mois", texte: fr(mois) + " mois de dépenses" },
      calcul: ["Livrets, monétaire et comptes courants : " + eur(livrets), ...(reserve > 0 ? ["Réservé aux projets à moins de 3 ans (hors matelas) : " + eur(reserve)] : []),
        "Dépenses mensuelles (" + src + ") : " + eur(depenses), eur(Math.max(0, livrets - reserve)) + " ÷ " + eur(depenses) + " = " + fr(mois) + " mois",
        "Barème : " + fr(mois) + " mois → " + points + "/20"],
      donnees: L.filter(p => montant(p) > 0).sort((a, b) => montant(b) - montant(a)).map(p => donneeLigne(p)),
      ameliorer: mois > 12 ? [{ action: "Affecte ≈ " + eur((mois - 12) * depenses) + " (au-delà de 12 mois de dépenses) à un objectif de long terme, sur un support adapté à ton profil.", gain_points: 20 - points }] : [],
      pourquoi: fr(mois) + " mois de dépenses dorment sur livrets et monétaire" + (mois <= 12 ? ", dans le repère de 12 mois." : ", au-delà du repère de 12 mois.") });
  }

  /* ---------- agrégation ---------- */
  const estNote = c => !c.aCompleter && !c.informatif && c.points != null;
  function agreger(criteres) {
    const L = (criteres || []).filter(Boolean);
    const familles = FAMILLES.map(f => {
      const cs = L.filter(c => c.famille === f.cle);
      const notes = cs.filter(estNote), attendus = cs.filter(c => !c.informatif).length;
      return { cle: f.cle, titre: f.titre, poids: f.poids, criteres: cs,
        total: notes.length ? Math.round(sum(notes, c => n(c.points)) / (20 * notes.length) * 100) : null,
        notes: notes.length, attendus, couverture: attendus ? notes.length / attendus : 0, couvertureTexte: Plan.texteCouverture(notes.length, attendus) };
    });
    const notees = familles.filter(f => f.total != null);
    const W = sum(notees, f => f.poids);
    const total = W > 0 ? Math.round(sum(notees, f => f.total * f.poids) / W) : null;
    /* Points perdus et gains rapportés à la note globale (sur 100). */
    L.forEach(c => {
      const f = familles.find(x => x.cle === c.famille);
      const k = f && estNote(c) && W > 0 ? f.poids / W * 100 / (20 * f.notes) : null;
      c.points_perdus = k == null ? null : r1((20 - n(c.points)) * k);
      (Array.isArray(c.ameliorer) ? c.ameliorer : []).forEach(a => { a.gain_note = k == null || a.gain_points == null ? null : r1(a.gain_points * k); });
    });
    const attendus = L.filter(c => !c.informatif).length, notes = L.filter(estNote).length;
    // Couverture = critères notés ÷ critères attendus (hors informatifs) ; sous 60 %, une note globale est provisoire (sans note : non).
    const couverture = attendus ? notes / attendus : 0;
    const out = { total, couverture, criteresNotes: notes, criteresAttendus: attendus, couvertureTexte: Plan.texteCouverture(notes, attendus),
      provisoire: total != null && couverture < Plan.SEUIL_PROVISOIRE, familles, complet: attendus > 0 && L.filter(c => !c.informatif).every(c => !c.aCompleter) };
    out.couts = Plan.coutsPrincipaux({ criteres: L });
    return out;
  }

  /* ---------- évaluation ---------- */
  function evaluer(ctx, deps) {
    const c = ctx || {}, scope = c.scope || "foyer", today = c.today == null ? new Date() : c.today;
    const d = deps || {}, dep = (k, auto) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : auto());
    const R = dep("Risque", risqueAuto), M = dep("Marche", marcheAuto);
    const toutes = c.positions || [], positions = vivantes(toutes, scope);
    const placements = Calc.horsCourants(positions); // famille Allocation : sans les comptes courants
    const b = c.budget;
    const lignes = Array.isArray(b) ? b : b && Array.isArray(b.lignes) ? b.lignes : [];
    const totaux = b && !Array.isArray(b) && typeof b.depenses === "number" ? b : Plan.budgetTotaux(lignes, c.profil, scope);
    const mat = Calc.matelas(c.config);
    const prevu = totaux.depensesLignes > 0 ? totaux.depenses : mat && mat.mode === "months" && mat.depenses > 0 ? mat.depenses : 0;
    const reel = scope === "foyer" ? Calc.budgetReel(c.banque, isoJour(today)) : null;
    const periode = reel ? Calc.periodeReel(reel) + (reel.parCompte ? "" : ", tous comptes connectés") : "";
    const depRef = reel && reel.depenses > 0 ? { montant: reel.depenses, source: "reel", periode } : prevu > 0 ? { montant: prevu, source: "prevu" } : null;
    const deja = Plan.affecterDeja(c.objectifs || [], toutes, scope);
    const plan = {};
    Plan.score({ positions: Calc.horsCourants(toutes), profil: c.profil, config: c.config, budget: b, scope }).items.forEach(i => { if (DE_PLAN[i.cle]) plan[i.cle] = depuisPlan(i); });
    const epargne = reel && reel.revenus > 0 && reel.tauxCapacite != null ? epargneReelle(reel, periode) : plan.epargne;

    const criteres = [
      matelas(c, toutes, scope, depRef), protection(c.profil, scope), liquiditeObjectifs(toutes, c.objectifs, deja, scope, today, c.classes, c.config),
      epargne, plan.endettement, apport(c.objectifs, deja, toutes, scope),
      adequation(c, toutes, scope, R), plan.concentration, geographie(placements, c.classes), speculatif(c, placements, scope, R, M), devises(placements),
      frais(c, positions, M), enveloppes(c, positions, deja, today), dormant(c, positions, depRef, deja, today),
    ].filter(Boolean);
    return Object.assign(agreger(criteres), { criteres });
  }

  return { FAMILLES, PLAFOND_SPECULATIF_DEFAUT, PLAFOND_PEA_DEFAUT, SEUIL_FRAIS, RENDEMENT_PROJECTION, REPERES_FRAIS, BAREME_FRAIS,
    evaluer, agreger, pointsHors, tableauEcarts, fraisSupports, natureFrais, coutsPrincipaux: Plan.coutsPrincipaux };
});
