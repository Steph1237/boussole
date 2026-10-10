/* Bonnes pratiques notées (Diagnostic) : 4 familles de critères, chacun expliqué (règle, source, piste). Calculs purs, aucun accès au DOM.

   Pratiques.evaluer(ctx, deps?) → { total (0-100), familles: [{ cle, titre, poids, total, criteres }], criteres: [...], complet }
     ctx  = { positions, profil, config, budget, objectifs, scope, risque (Risque.evaluer : { profil: id } ou null), today,
              classes? (surcharges poche → classe, transmises à Risque.allocationReelle et Marche.classeRisque) }
     deps = { Risque?, Marche? } : modules injectés (null = absent) ; par défaut risque.js / marche.js s'ils sont chargés.
     Sans Risque : adéquation « à compléter » (calcul indisponible), spéculatif au plafond par défaut de 5 %.
     Sans Marche : crypto et levier repérés par la classe de la poche et le libellé (« 2x », « levier »).
   Critère : { cle, famille, titre, points, sur, valeur, cible, texte, piste, regle, source, aCompleter, lien, details?, informatif? }
     - omis : sans objet (pas de crédit ni d'enfant, pas d'objectif Apport…), absent de la liste ;
     - à compléter : donnée manquante, 0 point, exclu des totaux ;
     - informatif (devises) : affiché, sans note (points null, sur 0), exclu des totaux.
   Famille = somme des points ÷ (20 × critères notés) × 100 ; global = moyenne pondérée (30 / 25 / 30 / 15) des familles notées.
   Reprend Plan.score pour matelas, épargne, endettement et concentration (mêmes valeurs et points). */
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

  const FAMILLES = [
    { cle: "securite", titre: "Sécurité", poids: 30 },
    { cle: "effort", titre: "Effort", poids: 25 },
    { cle: "allocation", titre: "Allocation", poids: 30 },
    { cle: "efficacite", titre: "Efficacité", poids: 15 },
  ];
  const PLAFOND_SPECULATIF_DEFAUT = 0.05;
  const PLAFOND_PEA_DEFAUT = 150000;
  const HORIZON_COURT = 24; // mois

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

  /* ---------- dates (AAAA-MM-JJ) ---------- */
  const dateCible = o => o.dateCible || o.date_cible || null;
  const isoJour = d => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  const plusAns = (date, ans) => { const s = isoJour(date).split("-").map(Number); return String(s[0] + ans).padStart(4, "0") + "-" + String(s[1] || 1).padStart(2, "0") + "-" + String(s[2] || 1).padStart(2, "0"); };
  const frDate = d => isoJour(d).split("-").reverse().join("/");

  /* ---------- périmètre ---------- */
  const vivantes = (positions, scope) => (positions || []).filter(p => Calc.inScope(p, scope) && Calc.counted(p));
  const montant = p => Calc.val(p);
  const classeDe = (p, classes) => Calc.classe(p.bloc, classes);

  /* Objectifs à échéance de 2 ans ou moins (échéance dépassée comprise), avec le montant déjà affecté. */
  function objectifsCourts(objectifs, deja, today) {
    return (objectifs || []).filter(o => o && dateCible(o) && Plan.moisEntre(today, dateCible(o)) <= HORIZON_COURT)
      .map(o => ({ o, cible: pos(o.cible), deja: pos(deja[o.id]) }));
  }

  /* ---------- fabrique de critères ---------- */
  function critere(famille, cle, base, champs) {
    return Object.assign({ cle, famille, titre: base.titre, points: 0, sur: 20, valeur: null, cible: base.cible, texte: "", piste: "",
      regle: base.regle, source: base.source, aCompleter: false, lien: base.lien }, champs);
  }
  const aCompleter = (famille, cle, base, texte, piste, lien) => critere(famille, cle, base, { aCompleter: true, texte, piste, lien: lien || base.lien });

  /* Critères repris de Plan.score : titre, cible, texte et piste viennent de Plan ; on ajoute famille, règle, source et lien. */
  const DE_PLAN = {
    matelas: { famille: "securite", regle: "Matelas = épargne disponible ÷ dépenses mensuelles ; repère 3 à 6 mois",
      source: "Repère usuel des conseillers en gestion de patrimoine", lien: "avenir/plan" },
    epargne: { famille: "effort", regle: "Taux d'épargne = (épargne prévue + reste du mois) ÷ revenus ; repère 15 % ou plus",
      source: "Repère usuel des conseillers en gestion de patrimoine", lien: "avenir/plan" },
    endettement: { famille: "effort", regle: "Endettement = mensualités de crédit ÷ revenus ; plafond 35 %",
      source: "HCSF, décision D-HCSF-2021-7", lien: "profil/donnees" },
    concentration: { famille: "allocation", regle: "Poids de la plus grosse ligne dans le financier ; repère 20 % au plus et au moins 3 poches",
      source: "Principe de diversification ; repère usuel des conseillers en gestion de patrimoine", lien: "bilan/placements" },
  };
  const depuisPlan = item => Object.assign({}, item, DE_PLAN[item.cle]);

  const B = {
    protection: { titre: "Protection de la famille", cible: "prévoyance et assurance emprunteur en place",
      regle: "Avec un crédit ou des enfants à charge : prévoyance (décès, invalidité) et assurance emprunteur souscrites",
      source: "Repère usuel des conseillers en gestion de patrimoine ; assurance emprunteur demandée par les banques pour un crédit immobilier", lien: "profil/donnees" },
    liquidite_objectifs: { titre: "Argent disponible pour les projets proches", cible: "100 % du besoin des objectifs à moins de 2 ans",
      regle: "Argent disponible sous quelques jours ÷ montant restant à réunir pour les objectifs à moins de 2 ans ; repère 100 %",
      source: "Repère usuel des conseillers : l'argent nécessaire à moins de 2 ans reste disponible et peu risqué", lien: "avenir/plan" },
    apport: { titre: "Apport pour le projet immobilier", cible: "l'apport visé (10 % du prix + frais de notaire)",
      regle: "Apport réuni ÷ apport visé ; repère : 10 % du prix + frais de notaire (≈ 8 % dans l'ancien)",
      source: "Pratique des banques ; frais d'acquisition dans l'ancien de 7 à 8 % (Notaires de France)", lien: "avenir/plan" },
    adequation: { titre: "Adéquation au profil de risque", cible: "chaque classe dans la fourchette de votre profil",
      regle: "Somme des écarts hors fourchette, par classe d'actifs, entre votre allocation et celle de votre profil ; repère 0 point",
      source: "Questionnaire de profil inspiré de l'adéquation MiFID II ; allocations indicatives de Boussole", lien: "diagnostic/risque" },
    geographie: { titre: "Diversification géographique", cible: "au moins la moitié des actions sur le monde entier",
      regle: "Part des actions investies sur le monde entier (indices Monde, ACWI) ; repère 50 % ou plus",
      source: "Principe de diversification ; biais domestique (French et Poterba, 1991)", lien: "bilan/placements" },
    speculatif: { titre: "Part spéculative", cible: "sous le plafond de votre profil",
      regle: "(Crypto + produits à levier) ÷ financier ; repère : sous le plafond de votre profil (5 % par défaut)",
      source: "Plafonds indicatifs par profil de Boussole ; mises en garde de l'AMF sur les crypto-actifs et les produits à effet de levier", lien: "diagnostic/risque" },
    devises: { titre: "Exposition hors euro", cible: "information, sans note",
      regle: "Part du financier exposée à une autre devise que l'euro (une zone hors Europe compte hors euro) ; information",
      source: "Risque de change : information, pas un défaut", lien: "bilan/placements" },
    frais: { titre: "Frais des fonds", cible: "0,3 % par an ou moins",
      regle: "Frais courants (TER) moyens, pondérés par les montants, des lignes cotées ; repère 0,3 % ou moins",
      source: "Documents d'informations clés des fonds ; ETF indiciels ≈ 0,1 à 0,3 %, fonds gérés ≈ 1,5 à 2 %", lien: "bilan/placements" },
    enveloppes: { titre: "Choix des enveloppes", cible: "aucun point d'attention",
      regle: "PEA avant compte-titres pour les actions européennes · assurance-vie de plus de 8 ans pour l'abattement · PER surtout à partir de 30 % d'imposition",
      source: "Code général des impôts : art. 163 quinquies D (PEA), art. 125-0 A et 990 I (assurance-vie), art. 163 quatervicies (PER)", lien: "bilan/placements" },
    dormant: { titre: "Argent dormant", cible: "12 mois de dépenses au plus sur livrets",
      regle: "Livrets et monétaire au-delà de 12 mois de dépenses, hors objectifs à moins de 2 ans ; repère 12 mois au plus",
      source: "Repère usuel des conseillers en gestion de patrimoine", lien: "avenir/plan" },
  };

  /* ---------- Sécurité ---------- */
  function protection(profil, scope) {
    const pr = profil || {}, f = pr.foyer || {};
    const credit = Calc.dettes(pr, scope) > 0 || Calc.mensualites(pr, scope) > 0;
    const enfants = n(f.enfants) > 0 || n(f.enfants14) > 0;
    if (!credit && !enfants) return null;
    const attendus = credit ? ["prevoyance", "emprunteur"] : ["prevoyance"];
    const decl = pr.protection && pr.protection[scope] && typeof pr.protection[scope] === "object" ? pr.protection[scope] : pr.protection;
    const motif = credit && enfants ? "un crédit et des enfants" : credit ? "un crédit en cours" : "des enfants à charge";
    if (!decl || attendus.some(k => typeof decl[k] !== "boolean"))
      return aCompleter("securite", "protection", B.protection, "Protection non renseignée, alors que vous avez " + motif + ".",
        "Indiquez dans le Profil si une prévoyance" + (credit ? " et une assurance emprunteur couvrent" : " couvre") + " le foyer.");
    const ok = attendus.filter(k => decl[k]).length;
    const libelle = { prevoyance: "prévoyance", emprunteur: "assurance emprunteur" };
    const manque = attendus.filter(k => !decl[k]).map(k => libelle[k]);
    return critere("securite", "protection", B.protection, { points: ok === attendus.length ? 20 : ok > 0 ? 8 : 0, valeur: ok / attendus.length,
      texte: manque.length ? "Manque : " + manque.join(" et ") + " (vous avez " + motif + ")." : "Protection en place pour " + motif + ".",
      piste: manque.length ? "Un décès ou une invalidité ne doit pas mettre le foyer en difficulté : vérifiez d'abord les garanties de votre employeur, puis comparez les contrats."
        : "Relisez les garanties à chaque changement de situation (naissance, nouveau crédit)." });
  }

  function liquiditeObjectifs(positions, objectifs, deja, scope, today) {
    const courts = objectifsCourts(objectifs, deja, today);
    if (!courts.length) return null;
    const besoin = sum(courts, x => Math.max(0, x.cible - x.deja));
    const liq = Calc.parLiquidite(positions, scope);
    const dispo = pos(liq.immediate) + pos(liq.jours);
    if (besoin <= 0) return critere("securite", "liquidite_objectifs", B.liquidite_objectifs, { points: 20,
      texte: "Vos objectifs à moins de 2 ans sont déjà financés.", piste: "Gardez cet argent sur des supports disponibles jusqu'à l'échéance." });
    const ratio = dispo / besoin;
    return critere("securite", "liquidite_objectifs", B.liquidite_objectifs, { points: Math.round(Math.min(1, ratio) * 20), valeur: ratio,
      texte: eur(dispo) + " disponibles sous quelques jours pour " + eur(besoin) + " encore à réunir d'ici 2 ans.",
      piste: ratio >= 1 ? "L'argent de vos projets proches est accessible sans attendre ni vendre au mauvais moment."
        : "L'argent nécessaire à moins de 2 ans gagne à être disponible et peu risqué (livrets, compte courant) : une baisse des marchés juste avant l'échéance n'aurait pas le temps de se rattraper." });
  }

  /* ---------- Effort ---------- */
  function apport(objectifs, deja) {
    const L = (objectifs || []).filter(o => o && o.type === "apport");
    if (!L.length) return null;
    const cible = sum(L, o => (pos(o.cible) > 0 ? pos(o.cible) : 0.18 * pos(o.prix)));
    const reuni = sum(L, o => pos(deja[o.id]));
    if (cible <= 0) return aCompleter("effort", "apport", B.apport, "Montant de l'apport non renseigné.", "Indiquez l'apport visé dans l'objectif Apport du Plan.");
    const ratio = reuni / cible;
    return critere("effort", "apport", B.apport, { points: Math.round(Math.min(1, ratio) * 20), valeur: ratio,
      texte: eur(reuni) + " réunis sur " + eur(cible) + " d'apport visé (" + pct(ratio) + ").",
      piste: ratio >= 1 ? "Votre apport est réuni : les banques regarderont aussi votre endettement après l'achat."
        : "Les banques attendent en général au moins 10 % du prix plus les frais de notaire (≈ 8 % dans l'ancien) ; le Plan indique l'effort mensuel pour y arriver." });
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

  /* Points de pourcentage hors fourchette, quelle que soit la forme renvoyée par Risque.ecarts (liste ou table ; % ou fractions). */
  function pointsHors(ecarts) {
    const src = (ecarts && !Array.isArray(ecarts) && (ecarts.ecarts || ecarts.parClasse)) || ecarts;
    const L = (Array.isArray(src) ? src : src && typeof src === "object" ? Object.values(src) : []).filter(e => e && typeof e === "object");
    const bornes = L.map(e => {
      const c = Array.isArray(e.cible) ? e.cible : [];
      const reel = [e.reel, e.actuel, e.part].find(connu), min = connu(e.min) ? e.min : c[0], max = connu(e.max) ? e.max : c[1];
      return connu(reel) && connu(min) && connu(max) ? { reel: +reel, min: +min, max: +max } : null;
    });
    const avec = bornes.filter(Boolean);
    const f = avec.length && avec.every(b => b.reel <= 1 && b.max <= 1) ? 100 : 1;
    return sum(L.map((e, i) => [e, bornes[i]]), ([e, b]) => {
      if (b) return (b.reel < b.min ? b.min - b.reel : b.reel > b.max ? b.reel - b.max : 0) * f;
      const v = [e.hors, e.horsFourchette, e.ecart].find(connu);
      return connu(v) ? Math.abs(+v) : 0;
    });
  }

  function adequation(ctx, positions, scope, R) {
    const id = idProfil(ctx.risque);
    if (!id) return aCompleter("allocation", "adequation", B.adequation, "Profil de risque non renseigné.",
      "Répondez au questionnaire (une dizaine de questions) pour comparer votre allocation à celle de votre profil.");
    const indispo = () => aCompleter("allocation", "adequation", B.adequation, "Calcul de l'écart au profil indisponible pour le moment.",
      "Rouvrez le Diagnostic : l'écart à votre profil s'affichera dès que le calcul sera chargé.");
    if (!R || typeof R.allocationReelle !== "function" || typeof R.ecarts !== "function") return indispo();
    if (Calc.financier(positions, scope) <= 0) return aCompleter("allocation", "adequation", B.adequation, "Aucun placement enregistré.",
      "Ajoutez vos placements dans Bilan › Placements pour les comparer à votre profil.", "bilan/placements");
    let hors;
    const fiche = ficheProfil(R, id);
    try { hors = pointsHors(R.ecarts(fiche && fiche.id || id, R.allocationReelle(positions, scope, { surcharge: ctx.classes }))); } catch (e) { return indispo(); }
    const nom = nomProfil(R, id);
    return critere("allocation", "adequation", B.adequation, { points: Math.round(interp(hors, [[0, 20], [40, 0]])), valeur: Math.round(hors * 10) / 10,
      texte: hors <= 0 ? "Votre allocation est dans les fourchettes du profil " + nom + "." : fr(hors) + " points hors des fourchettes du profil " + nom + ".",
      piste: hors <= 0 ? "Votre répartition correspond au risque que vous avez dit accepter."
        : "Le détail par classe est dans Diagnostic › Profil de risque : rapprochez chaque classe de sa fourchette, de préférence avec vos versements à venir." });
  }

  const RE_MONDE = /monde|world|acwi|all.?country|global|international/;
  const libelleGeo = p => sansAccent(p.zone || (p.bloc || "") + " " + (p.name || "")); // la zone de l'instrument prime
  function geographie(positions, classes) {
    const actions = positions.filter(p => classeDe(p, classes) === "actions" && montant(p) > 0);
    const total = sum(actions, montant);
    if (total <= 0) return null;
    const part = sum(actions.filter(p => RE_MONDE.test(libelleGeo(p))), montant) / total;
    return critere("allocation", "geographie", B.geographie, { points: Math.round(part >= 0.5 ? 20 : interp(part, [[0, 8], [0.5, 20]])), valeur: part,
      texte: pct(part) + " de vos actions couvrent le monde entier ; le reste vise une région, un pays ou des titres en direct.",
      piste: part >= 0.5 ? "Un socle « monde » répartit le risque sur des milliers d'entreprises et plusieurs économies ; vos paris régionaux s'y ajoutent."
        : "Miser sur une région n'est pas une erreur, mais le risque est plus concentré. Le biais domestique (surpondérer son pays ou sa région) est fréquent : un socle « monde » diversifie davantage." });
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
      "Ajoutez vos placements dans Bilan › Placements pour mesurer leur part spéculative.", "bilan/placements");
    const part = sum(positions.filter(p => estSpeculatif(p, ctx.classes, M)), montant) / F;
    const id = idProfil(ctx.risque);
    const prof = ficheProfil(R, id);
    const s = prof && prof.cibles && prof.cibles.speculatif;
    const borne = Array.isArray(s) && connu(s[1]) ? enFraction(+s[1]) : null;
    const plafond = borne == null ? PLAFOND_SPECULATIF_DEFAUT : borne;
    const de = borne == null ? "plafond par défaut de " + pct(plafond) + (id ? "" : ", profil de risque non renseigné")
      : "plafond du profil " + nomProfil(R, id) + " : " + pct(plafond);
    const points = Math.round(plafond > 0 ? interp(part, [[plafond, 20], [2 * plafond, 0]]) : interp(part, [[0, 20], [0.01, 0]]));
    return critere("allocation", "speculatif", B.speculatif, { points, valeur: part, cible: pct(plafond) + " au plus",
      lien: borne == null ? "diagnostic/risque" : "bilan/placements",
      texte: "Crypto et produits à levier : " + pct(part, 1) + " du financier (" + de + ").",
      piste: part <= plafond ? "Cette part reste dans ce que votre profil peut encaisser : elle pourrait perdre l'essentiel de sa valeur sans compromettre vos projets."
        : "Ces supports peuvent perdre 80 % ou plus en quelques mois : au-delà du plafond, une telle baisse pèserait sur l'ensemble de votre patrimoine." });
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
    const connues = positions.map(p => ({ e: exposition(p), v: montant(p) })).filter(x => x.e != null && x.v > 0);
    const total = sum(connues, x => x.v);
    if (total <= 0) return null;
    const part = sum(connues, x => x.v * x.e) / total;
    const couverture = total / Math.max(total, sum(positions, montant));
    return critere("allocation", "devises", B.devises, { informatif: true, points: null, sur: 0, valeur: part,
      texte: pct(part) + " exposés à une autre devise que l'euro" + (couverture < 0.999 ? " (sur les " + pct(couverture) + " du financier dont la devise est connue)." : "."),
      piste: "Ce n'est pas un défaut : une exposition hors euro diversifie, mais les variations de change s'ajoutent à celles des marchés." });
  }

  /* ---------- Efficacité ---------- */
  function frais(positions) {
    const cotees = positions.filter(p => p.mode === "market" && montant(p) > 0);
    const total = sum(cotees, montant);
    if (total <= 0) return null;
    const avec = cotees.filter(p => connu(p.ter));
    const couvert = sum(avec, montant);
    if (couvert / total < 0.5) return aCompleter("efficacite", "frais", B.frais, "Frais inconnus : votre assistant peut les renseigner.",
      "Demandez à votre assistant de compléter les frais courants (TER) de vos fonds via le connecteur.", "recos/actions");
    const ter = sum(avec, p => montant(p) * +p.ter) / couvert;
    return critere("efficacite", "frais", B.frais, { points: Math.round(interp(ter, [[0.3, 20], [1, 10], [2, 0]])), valeur: ter,
      texte: "Frais moyens de " + fr(ter, 2) + " % par an" + (couvert < total ? " (sur " + pct(couvert / total) + " des lignes cotées)." : "."),
      piste: ter <= 0.3 ? "Vos frais sont bas : sur 20 ans, chaque 0,1 % économisé compte."
        : "1 % de frais par an coûte environ 18 % du capital sur 20 ans : regardez quelles lignes pèsent le plus ; des fonds indiciels équivalents existent souvent." });
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
        texte: nom + " aura 8 ans le " + frDate(huit) + ", après l'échéance de « " + (avant.nom || "votre objectif") + " » qu'elle finance : un retrait avant 8 ans ne profite pas de l'abattement." });
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
    return critere("efficacite", "enveloppes", B.enveloppes, { points: Math.max(0, 20 - 6 * pb.length), valeur: pb.length, details,
      texte: pb.length ? pb.length + " point" + (pb.length > 1 ? "s" : "") + " d'attention sur le choix des enveloppes." : "Vos enveloppes sont utilisées dans le bon ordre.",
      piste: pb.length ? pb.map(d => d.texte).join(" ") : "Rien à changer : chaque enveloppe joue son rôle fiscal." });
  }

  function dormant(ctx, positions, depenses, deja, today) {
    if (!(depenses > 0)) return aCompleter("efficacite", "dormant", B.dormant, "Dépenses mensuelles inconnues.",
      "Renseignez vos dépenses dans le budget pour mesurer l'argent qui dort.");
    const livrets = sum(positions.filter(p => classeDe(p, ctx.classes) === "monetaire"), montant);
    /* L'argent des projets à moins de 2 ans ne dort pas ; le matelas est déjà couvert par les 12 mois tolérés. */
    const reserve = sum(objectifsCourts(ctx.objectifs, deja, today).filter(x => x.o.type !== "matelas"), x => x.cible);
    const mois = Math.max(0, livrets - reserve) / depenses;
    return critere("efficacite", "dormant", B.dormant, { points: Math.round(mois <= 12 ? 20 : interp(mois, [[12, 20], [24, 10], [36, 5]])), valeur: mois,
      texte: fr(mois) + " mois de dépenses sur livrets et monétaire" + (reserve > 0 ? ", hors " + eur(reserve) + " réservés aux projets à moins de 2 ans." : "."),
      piste: mois <= 12 ? "Votre argent disponible correspond à vos besoins : rien ne dort inutilement."
        : "Au-delà d'un an de dépenses, l'argent des livrets perd souvent face à l'inflation : une partie pourrait servir un objectif de long terme, sur un support adapté à votre profil." });
  }

  /* ---------- agrégation ---------- */
  function agreger(criteres) {
    const L = (criteres || []).filter(Boolean);
    const familles = FAMILLES.map(f => {
      const cs = L.filter(c => c.famille === f.cle);
      const notes = cs.filter(c => !c.aCompleter && !c.informatif);
      return { cle: f.cle, titre: f.titre, poids: f.poids, criteres: cs,
        total: notes.length ? Math.round(sum(notes, c => n(c.points)) / (20 * notes.length) * 100) : null };
    });
    const notees = familles.filter(f => f.total != null);
    const poids = sum(notees, f => f.poids);
    const comptes = L.filter(c => !c.informatif);
    return { total: poids > 0 ? Math.round(sum(notees, f => f.total * f.poids) / poids) : 0, familles,
      complet: comptes.length > 0 && comptes.every(c => !c.aCompleter) };
  }

  /* ---------- évaluation ---------- */
  function evaluer(ctx, deps) {
    const c = ctx || {}, scope = c.scope || "foyer", today = c.today == null ? new Date() : c.today;
    const d = deps || {}, dep = (k, auto) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : auto());
    const R = dep("Risque", risqueAuto), M = dep("Marche", marcheAuto);
    const toutes = c.positions || [], positions = vivantes(toutes, scope);
    const b = c.budget;
    const lignes = Array.isArray(b) ? b : b && Array.isArray(b.lignes) ? b.lignes : [];
    const totaux = b && !Array.isArray(b) && typeof b.depenses === "number" ? b : Plan.budgetTotaux(lignes, c.profil, scope);
    const mat = Calc.matelas(c.config);
    const depenses = totaux.depensesLignes > 0 ? totaux.depenses : mat && mat.mode === "months" && mat.depenses > 0 ? mat.depenses : 0;
    const deja = Plan.affecterDeja(c.objectifs || [], toutes, scope);
    const plan = {};
    Plan.score({ positions: toutes, profil: c.profil, config: c.config, budget: b, scope }).items.forEach(i => { if (DE_PLAN[i.cle]) plan[i.cle] = depuisPlan(i); });

    const criteres = [
      plan.matelas, protection(c.profil, scope), liquiditeObjectifs(toutes, c.objectifs, deja, scope, today),
      plan.epargne, plan.endettement, apport(c.objectifs, deja),
      adequation(c, toutes, scope, R), plan.concentration, geographie(positions, c.classes), speculatif(c, positions, scope, R, M), devises(positions),
      frais(positions), enveloppes(c, positions, deja, today), dormant(c, positions, depenses, deja, today),
    ].filter(Boolean);
    return Object.assign(agreger(criteres), { criteres });
  }

  return { FAMILLES, PLAFOND_SPECULATIF_DEFAUT, PLAFOND_PEA_DEFAUT, evaluer, agreger, pointsHors };
});
