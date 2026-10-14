/* Calendrier patrimonial (DAT1, docs/superpowers/specs/2026-10-14-dat1-calendrier-design.md) : les dates qui font courir les délais
   fiscaux de chaque enveloppe (PEA à 5 ans, assurance-vie à 8 ans et au 70ᵉ anniversaire, PEL, épargne salariale, donations à 15 ans,
   moins-values à 10 ans, plafond épargne retraite, 31 décembre, révision des livrets, fin des prêts). Pur, sans DOM, au tutoiement.
   Jamais une date sans donnée : une donnée manquante devient « à compléter » ; un repère manquant rend la règle « indisponible ».
   Les durées, âges et montants viennent des repères sourcés (table reperes, S.savoir.reperes) ; ce fichier ne contient que la logique
   (quelle date part de quelle donnée). Porté à l'identique dans supabase/functions/mcp/calendrier.ts (parité testée sur
   test/fixtures/calendrier-cas.json).

   Calendrier.calendrier(data, today, options?) → {
     jalons: [{ id, date, enveloppe, enveloppe_nom, titulaire, type, cle, titre, effet, calcul, statut: passe|proche|futur, jours, delai,
                source: { titre, url, verifie_le, reperes }, confiance: sure|approchee|calculee, donnee: { champ, source, le } | null,
                avertissements: [texte] }],
     a_completer: [{ id, enveloppe, enveloppe_nom, titulaire, type, cle, champ, titre, pourquoi, document }],
     seuils: [{ id, enveloppe, enveloppe_nom, cle, titre, verse, plafond, reste, source, donnee }],
     regles_indisponibles: [{ cle, reperes_manquants: [cle] }],
     prochains: [3 premiers jalons non passés], dans_3_mois: [jalons proches] }
   data = { positions, config, profil, credits, biens, reperes } (formes de l'app) ; today = AAAA-MM-JJ (date de Paris) ;
   options = { horizonAns = 40 }. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Calendrier = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  const R = (root && root.Reperes) || (typeof require === "function" ? require("./reperes.js") : null);
  const PROCHE_JOURS = 92;
  const HORIZON_DEFAUT = 40;

  /** Types d'enveloppe et leur libellé. */
  const TYPES = {
    pea: "PEA", pea_pme: "PEA PME-ETI", pea_jeune: "PEA d'un majeur rattaché", assurance_vie: "Assurance-vie", capitalisation: "Contrat de capitalisation",
    per: "PER", pel: "PEL", cel: "CEL", pee: "PEE", percol: "PERCOL", compte_titres: "Compte-titres", livret_a: "Livret A", ldds: "LDDS", lep: "LEP", autre: "Autre",
  };

  /* ------------------------------------------------------------------ dates */
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const pad = (n, l) => String(n).padStart(l || 2, "0");
  const dernierJour = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (y, m, d) => pad(y, 4) + "-" + pad(m) + "-" + pad(d);
  const morceaux = s => s.split("-").map(Number);
  /** Vrai pour une date réelle au format AAAA-MM-JJ (2026-02-30 est refusée). */
  function estDate(s) {
    if (typeof s !== "string" || !ISO.test(s)) return false;
    const [y, m, d] = morceaux(s);
    return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= dernierJour(y, m);
  }
  const utc = s => { const [y, m, d] = morceaux(s); return Date.UTC(y, m - 1, d); };
  /** Ajoute n mois au même quantième, ou au dernier jour du mois s'il n'existe pas (art. 641 du code de procédure civile). */
  function ajouterMois(s, n) {
    const [y, m, d] = morceaux(s), t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = t - ny * 12 + 1;
    return iso(ny, nm, Math.min(d, dernierJour(ny, nm)));
  }
  const ajouterAns = (s, n) => ajouterMois(s, n * 12);
  function lendemain(s) { const t = new Date(utc(s) + 864e5); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  /** Écart signé en jours entre deux dates (calcul en UTC : aucune dérive d'heure d'été). */
  const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  const annee = s => +s.slice(0, 4);
  const dateFr = s => (estDate(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : String(s == null ? "" : s));
  /** Date approchée « AAAA » ou « AAAA-MM » → { min, max } (premier et dernier jour possibles), ou null. */
  function approx(s) {
    const m = typeof s === "string" ? /^(\d{4})(?:-(\d{2}))?$/.exec(s) : null;
    if (!m) return null;
    const y = +m[1];
    if (m[2] == null) return { min: iso(y, 1, 1), max: iso(y, 12, 31) };
    const mo = +m[2];
    return mo >= 1 && mo <= 12 ? { min: iso(y, mo, 1), max: iso(y, mo, dernierJour(y, mo)) } : null;
  }
  const statutDe = jours => (jours < 0 ? "passe" : jours <= PROCHE_JOURS ? "proche" : "futur");

  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const eur = v => nf.format(+v) + " €";
  /** « dans 1 an et 4 mois », « dans 12 jours », « aujourd'hui », « il y a 3 mois ». */
  function texteDelai(jours) {
    const j = Math.round(+jours);
    if (!isFinite(j)) return "";
    if (j === 0) return "aujourd'hui";
    const a = Math.abs(j);
    let t;
    if (a < 60) t = a + (a > 1 ? " jours" : " jour");
    else {
      const mois = Math.max(2, Math.round(a / 30.4375)), ans = Math.floor(mois / 12), reste = mois % 12;
      t = mois < 12 ? mois + " mois" : ans + (ans > 1 ? " ans" : " an") + (reste ? " et " + reste + " mois" : "");
    }
    return j > 0 ? "dans " + t : "il y a " + t;
  }

  /* ------------------------------------------------------------------ types déduits du nom */
  const sansAccent = s => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const mots = s => sansAccent(s).split(/[^a-z0-9]+/).filter(Boolean);
  const contient = (ts, suite) => ts.some((_, i) => suite.every((m, k) => ts[i + k] === m));
  /** Type d'une enveloppe d'après son nom (mêmes motifs que pratiques.js et powens/synchro.ts), ou null si le nom ne dit rien. */
  function typeDeduit(nom) {
    const ts = mots(nom);
    if (!ts.length) return null;
    if (ts.includes("pea") || ts[0].startsWith("pea")) return ts.includes("pme") || ts.includes("eti") ? "pea_pme" : ts.includes("jeune") ? "pea_jeune" : "pea";
    if (ts.includes("cto") || contient(ts, ["compte", "titres"]) || contient(ts, ["compte", "titre"]) || contient(ts, ["comptes", "titres"])) return "compte_titres";
    if (ts.includes("capitalisation")) return "capitalisation";
    if (contient(ts, ["assurance", "vie"]) || ts.includes("av")) return "assurance_vie";
    if (ts.includes("percol") || ts.includes("perco")) return "percol";
    if (ts.includes("per") || ts.includes("perin")) return "per";
    if (ts.includes("pel")) return "pel";
    if (ts.includes("cel")) return "cel";
    if (ts.includes("pee")) return "pee";
    if (ts.includes("ldds")) return "ldds";
    if (ts.includes("lep")) return "lep";
    if (contient(ts, ["livret", "a"])) return "livret_a";
    return null;
  }
  const LIVRETS = ["livret_a", "ldds", "lep"];

  /* ------------------------------------------------------------------ catalogue des règles (spec § 3.1) */
  /* Chaque règle : clé, types concernés, ancre (la donnée dont part la date), repères (durées, âges et montants), fiche du savoir,
     titre et effet (gabarits : {env}, {montant}, {annee}, {beneficiaire}, {date}, {mensualite}, {taux}, ou la clé d'un repère, rendue
     au format français). `effetPasse` : même effet une fois la date passée. `variantes` : effets propres à un cas (génération du plan,
     lien ou nature de la donation). Aucun produit ni établissement nommé ; les effets sont décrits, jamais recommandés. */
  const REGLES = [
    { cle: "pea_5_ans", types: ["pea", "pea_pme", "pea_jeune"], ancre: "date_ouverture", reperes: ["pea_duree_ans"], fiche: "pea",
      titre: "{env} : {pea_duree_ans} révolus",
      effet: "Un retrait partiel ne clôture plus le plan et tu peux continuer à verser. Les gains sont exonérés d'impôt sur le revenu ; les prélèvements sociaux restent dus. Avant cette date, un retrait clôture le plan, sauf cas prévus par la loi (licenciement, invalidité, mise à la retraite anticipée…).",
      effetPasse: "Les {pea_duree_ans} sont révolus : un retrait partiel ne clôture plus le plan et tu peux continuer à verser. Les gains sont exonérés d'impôt sur le revenu ; les prélèvements sociaux restent dus." },
    { cle: "av_8_ans", types: ["assurance_vie", "capitalisation"], ancre: "date_ouverture",
      reperes: ["av_duree_ans", "av_abattement_seul", "av_abattement_couple", "av_seuil_versements"], fiche: "assurance-vie",
      titre: "{env} : {av_duree_ans} révolus",
      effet: "Les gains retirés bénéficient chaque année d'un abattement de {av_abattement_seul} ({av_abattement_couple} pour un couple soumis à imposition commune), tous contrats confondus. Au-delà, ils sont taxés à un taux réduit tant que tes versements nets restent sous {av_seuil_versements}. L'abattement ne joue que sur l'impôt sur le revenu : les prélèvements sociaux restent dus sur la totalité des gains.",
      effetPasse: "Les {av_duree_ans} sont révolus : les gains retirés bénéficient chaque année d'un abattement de {av_abattement_seul} ({av_abattement_couple} pour un couple soumis à imposition commune), tous contrats confondus. Au-delà, ils sont taxés à un taux réduit tant que tes versements nets restent sous {av_seuil_versements}. L'abattement ne joue que sur l'impôt sur le revenu : les prélèvements sociaux restent dus sur la totalité des gains." },
    { cle: "av_70_ans", types: ["assurance_vie"], ancre: "naissance", reperes: ["av_age_seuil", "av_990i_abattement", "av_757b_abattement"], fiche: "assurance-vie",
      titre: "{env} : {av_age_seuil} de l'assuré",
      effet: "Les versements faits avant cette date relèvent, au décès de l'assuré, d'un abattement de {av_990i_abattement} par bénéficiaire. Ceux faits ensuite relèvent d'un abattement global de {av_757b_abattement}, tous contrats et bénéficiaires confondus ; seuls ces versements sont comptés, pas les gains qu'ils ont produits.",
      effetPasse: "L'assuré a passé les {av_age_seuil} : les versements faits avant relèvent, à son décès, d'un abattement de {av_990i_abattement} par bénéficiaire. Ceux faits depuis relèvent d'un abattement global de {av_757b_abattement}, tous contrats et bénéficiaires confondus ; seuls ces versements sont comptés, pas les gains qu'ils ont produits." },
    { cle: "pel_2_ans", types: ["pel"], ancre: "date_ouverture", reperes: ["pel_retrait_min_ans"], fiche: null,
      titre: "{env} : {pel_retrait_min_ans} révolus",
      effet: "Avant cette date, un retrait clôture le PEL : ses intérêts sont recalculés au taux du CEL et tu perds le droit au prêt.",
      effetPasse: "Les {pel_retrait_min_ans} sont révolus : clôturer le PEL ne fait plus recalculer ses intérêts au taux du CEL." },
    { cle: "pel_4_ans", types: ["pel"], ancre: "date_ouverture", reperes: ["pel_duree_min_ans", "pel_duree_max_ans"], fiche: null,
      titre: "{env} : {pel_duree_min_ans} révolus",
      effet: "Durée minimale du plan atteinte. Il peut être prolongé jusqu'à {pel_duree_max_ans}.",
      effetPasse: "Durée minimale du plan atteinte ({pel_duree_min_ans}). Il peut être prolongé jusqu'à {pel_duree_max_ans}." },
    { cle: "pel_10_ans", types: ["pel"], ancre: "date_ouverture", reperes: ["pel_duree_max_ans", "pel_duree_vie_ans"], fiche: null,
      titre: "{env} : {pel_duree_max_ans}, fin des versements",
      effet: "Fin des versements : le plan ne reçoit plus d'argent, ses intérêts continuent de courir pendant {pel_prolongation} au plus.",
      effetPasse: "Fin des versements : le plan ne reçoit plus d'argent, ses intérêts continuent de courir pendant {pel_prolongation} au plus.",
      variantes: { avant_2011: {
        reperes: ["pel_duree_max_ans"],
        effet: "Fin des versements : le plan ne reçoit plus d'argent ; ses intérêts continuent de courir au taux du contrat, sans limite de durée.",
        effetPasse: "Fin des versements : le plan ne reçoit plus d'argent ; ses intérêts continuent de courir au taux du contrat, sans limite de durée." } } },
    { cle: "pel_15_ans", types: ["pel"], ancre: "date_ouverture", reperes: ["pel_duree_vie_ans"], fiche: null,
      titre: "{env} : {pel_duree_vie_ans}, fin du plan",
      effet: "Le plan devient un livret d'épargne ordinaire : son taux et sa fiscalité changent.",
      effetPasse: "Le plan est devenu un livret d'épargne ordinaire : son taux et sa fiscalité ont changé." },
    { cle: "pel_12_ans", types: ["pel"], ancre: "date_ouverture", reperes: ["pel_exoneration_ir_ans"], fiche: null,
      titre: "{env} : {pel_exoneration_ir_ans}, fin de l'exonération d'impôt",
      effet: "Les intérêts acquis à partir de cette date sont soumis à l'impôt sur le revenu (ceux des {pel_exoneration_ir_ans} premières années en sont exonérés ; les prélèvements sociaux restent dus).",
      effetPasse: "Les intérêts acquis depuis cette date sont soumis à l'impôt sur le revenu (ceux des {pel_exoneration_ir_ans} premières années en étaient exonérés ; les prélèvements sociaux restent dus)." },
    { cle: "pee_disponible", types: ["pee"], ancre: "versements", reperes: ["pee_blocage_ans"], fiche: null,
      titre: "{env} : avoirs disponibles",
      effet: "{montant} deviennent disponibles sans motif.",
      effetPasse: "{montant} sont disponibles sans motif.",
      variantes: { au_plus_tot: {
        effet: "{montant} deviennent disponibles sans motif, au plus tôt à cette date : le règlement du plan peut en fixer une plus tardive, ton relevé l'indique.",
        effetPasse: "{montant} sont disponibles sans motif, au plus tôt depuis cette date : le règlement du plan peut en fixer une plus tardive, ton relevé l'indique." } } },
    { cle: "per_70_ans", types: ["per"], ancre: "naissance", reperes: ["per_age_fin_deduction"], fiche: "per",
      titre: "{env} : {per_age_fin_deduction}, fin de la déduction",
      effet: "À partir de cette date, tes versements sur un PER ne sont plus déductibles de ton revenu imposable.",
      effetPasse: "Depuis cette date, les versements sur un PER ne sont plus déductibles du revenu imposable." },
    { cle: "per_plafond_expire", types: [], ancre: "avis_impot", reperes: ["per_report_ans", "per_report_ans_ancien"], fiche: "per",
      titre: "Plafond épargne retraite {annee} : dernier jour pour l'utiliser",
      effet: "Dernier jour pour verser sur un PER en utilisant ce reste de plafond ({montant}) ; il ne peut plus servir ensuite.",
      effetPasse: "Ce reste de plafond ({montant}) ne pouvait plus servir après cette date." },
    { cle: "per_fin_annee", types: [], ancre: "annee", reperes: ["per_report_ans"], fiche: "per",
      titre: "Épargne retraite : dernier jour de l'année pour les versements",
      effet: "Les versements déductibles comptent pour l'année où ils sont faits. Ton plafond disponible est sur ton avis d'impôt.",
      effetPasse: "Les versements déductibles comptent pour l'année où ils sont faits." },
    { cle: "av_abattement_annee", types: [], ancre: "annee", reperes: ["av_abattement_seul", "av_abattement_couple"], fiche: "assurance-vie",
      titre: "Assurance-vie : dernier jour de l'année pour l'abattement",
      effet: "L'abattement sur les gains retirés est annuel : celui de cette année ne se reporte pas sur la suivante.",
      effetPasse: "L'abattement sur les gains retirés est annuel : celui de l'année ne se reporte pas sur la suivante." },
    { cle: "donation_15_ans", types: [], ancre: "donations", reperes: ["donation_rappel_ans", "donation_abattement_enfant", "don_familial_argent"], fiche: null,
      titre: "Donation à {beneficiaire} : {donation_rappel_ans} révolus",
      effet: "La donation du {date} à {beneficiaire} n'est plus rappelée : l'abattement de {donation_abattement_enfant} entre ce parent et cet enfant est de nouveau entier.",
      effetPasse: "La donation du {date} à {beneficiaire} n'est plus rappelée : l'abattement de {donation_abattement_enfant} entre ce parent et cet enfant est de nouveau entier.",
      variantes: {
        don_argent: { reperes: ["donation_rappel_ans", "don_familial_argent"],
          effet: "Le don familial de sommes d'argent ({don_familial_argent}) est de nouveau possible entre toi et {beneficiaire}, si les conditions d'âge sont remplies.",
          effetPasse: "Le don familial de sommes d'argent ({don_familial_argent}) est de nouveau possible entre toi et {beneficiaire}, si les conditions d'âge sont remplies." },
        autre: { reperes: ["donation_rappel_ans"],
          effet: "La donation du {date} à {beneficiaire} n'est plus rappelée lors d'une nouvelle donation à la même personne.",
          effetPasse: "La donation du {date} à {beneficiaire} n'est plus rappelée lors d'une nouvelle donation à la même personne." } } },
    { cle: "mv_expire", types: ["compte_titres"], ancre: "moins_values", reperes: ["mv_report_ans"], fiche: "compte-titres-fiscalite",
      titre: "{env} : moins-value {annee} à imputer avant cette date",
      effet: "Dernier jour pour imputer la moins-value de {annee} ({montant}) sur des plus-values de même nature ; elle est perdue ensuite.",
      effetPasse: "La moins-value de {annee} ({montant}) ne peut plus être imputée sur des plus-values de même nature." },
    { cle: "taux_reglementes", types: ["livret_a", "ldds", "lep"], ancre: "reperes", reperes: ["livret_a_taux", "lep_taux"], fiche: "livrets-reglementes",
      titre: "Livrets réglementés : fin de la période du taux actuel",
      effet: "Fin de la période du taux actuel ({taux}) : un nouveau taux peut s'appliquer à partir de cette date.",
      effetPasse: "La période du taux indiqué ({taux}) est terminée : un nouveau taux s'applique." },
    { cle: "pret_fin", types: [], ancre: "prets_infos", reperes: [], fiche: null,
      titre: "{env} : dernière échéance",
      effet: "Dernière échéance du prêt : sa mensualité ({mensualite}) se libère ensuite.",
      effetPasse: "Dernière échéance du prêt passée : sa mensualité ({mensualite}) est libérée.",
      variantes: { sans_mensualite: { effet: "Dernière échéance du prêt.", effetPasse: "Dernière échéance du prêt passée." } } },
  ];
  const REGLE = Object.fromEntries(REGLES.map(r => [r.cle, r]));

  /** Où trouver chaque donnée (spec § 6.2). */
  const DOCUMENTS = {
    date_ouverture: {
      pea: "le relevé annuel du PEA, ou l'attestation d'ouverture", pea_pme: "le relevé annuel du PEA, ou l'attestation d'ouverture",
      pea_jeune: "le relevé annuel du PEA, ou l'attestation d'ouverture", assurance_vie: "les conditions particulières ou le relevé annuel d'information",
      capitalisation: "les conditions particulières ou le relevé annuel d'information", pel: "le contrat ou le relevé annuel du PEL",
    },
    naissance: "la date de naissance de la personne concernée (profil du foyer)",
    versements: "le relevé de l'épargne salariale : il indique la date de disponibilité de chaque avoir",
    avis_impot: "ton avis d'impôt (rubrique « plafond épargne retraite »)",
    date_fin: "l'offre de prêt ou le tableau d'amortissement",
  };

  /* ------------------------------------------------------------------ gabarits */
  function remplir(modele, ctx, reperes) {
    return String(modele).replace(/\{([a-z0-9_]+)\}/g, (tout, k) => {
      if (ctx && ctx[k] != null) return String(ctx[k]);
      const r = R.trouver(reperes, k);
      return r && isFinite(+r.valeur) ? R.format(r) : tout;
    });
  }

  /* ------------------------------------------------------------------ moteur */
  const objet = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const liste = v => (Array.isArray(v) ? v : []);
  const norm = s => sansAccent(String(s == null ? "" : s)).replace(/\s+/g, " ").trim();
  const nombre = v => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? +v : NaN);
  const PERSONNES = ["p1", "p2"];
  const SUFFIXE = /\|p[12]$/;

  /** Clé d'une enveloppe : son nom, ou « <nom>|p1 » / « <nom>|p2 » quand les deux titulaires ont une enveloppe de ce nom. Une clé
      déjà présente dans enveloppes_infos (infos) l'emporte. */
  function cleEnveloppe(nom, titulaire, positions, infos) {
    const n = norm(nom), inf = objet(infos);
    const direct = Object.keys(inf).find(k => norm(k) === norm(nom + "|" + titulaire));
    if (direct) return direct;
    const nu = Object.keys(inf).find(k => norm(k) === n && (!objet(inf[k]).titulaire || objet(inf[k]).titulaire === titulaire));
    if (nu) return nu;
    const proprietaires = new Set(liste(positions).filter(p => p && norm(p.envelope) === n).map(p => p.owner));
    return proprietaires.size > 1 && PERSONNES.includes(titulaire) ? String(nom).trim() + "|" + titulaire : String(nom).trim();
  }

  /** Enveloppes du calendrier : union des clés de enveloppes_infos et des enveloppes des lignes (spec § 4, étape 1). */
  function enveloppes(positions, infos, today) {
    const inf = objet(infos), out = [], prises = new Set();
    const lignes = liste(positions).filter(p => p && typeof p.envelope === "string" && p.envelope.trim());
    const groupes = new Map();
    lignes.forEach(p => {
      const k = norm(p.envelope) + "\u0001" + p.owner;
      if (!groupes.has(k)) groupes.set(k, { nom: p.envelope.trim(), owner: p.owner, lignes: [] });
      groupes.get(k).lignes.push(p);
    });
    const cles = Object.keys(inf).filter(k => inf[k] && typeof inf[k] === "object" && !Array.isArray(inf[k]));
    const creer = (cle, nom, owner, lg) => {
      const i = cles.includes(cle) ? objet(inf[cle]) : null;
      const declare = i && typeof i.type === "string" && TYPES[i.type] ? i.type : null;
      const type = declare || typeDeduit(nom);
      const titulaire = i && PERSONNES.includes(i.titulaire) ? i.titulaire : PERSONNES.includes(owner) ? owner : null;
      let cloture = null;
      if (i && estDate(i.date_cloture)) cloture = { date: i.date_cloture, confiance: "sure" };
      else if (lg.length && lg.every(p => p.status === "clôturé")) cloture = { date: today, confiance: "calculee" };
      out.push({ cle, nom, type, type_deduit: !declare, titulaire, infos: i, lignes: lg, cloture });
    };
    groupes.forEach(g => {
      const cle = cleEnveloppe(g.nom, g.owner, lignes, inf);
      const connue = cles.includes(cle);
      if (!connue && g.lignes.every(p => p.status === "clôturé")) return; // enveloppe sans information et sans ligne active : hors calendrier
      prises.add(cle);
      creer(cle, connue ? cle.replace(SUFFIXE, "") : g.nom, g.owner, g.lignes);
    });
    cles.forEach(k => { if (!prises.has(k)) creer(k, k.replace(SUFFIXE, ""), null, []); });
    return out.sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
  }

  function calendrier(data, today, options) {
    const d = objet(data), cfg = objet(d.config), profil = objet(d.profil), opt = objet(options);
    const vide = { jalons: [], a_completer: [], seuils: [], regles_indisponibles: [], prochains: [], dans_3_mois: [] };
    if (!estDate(today)) return vide;
    const reperes = liste(d.reperes);
    const horizon = opt.horizonAns > 0 ? +opt.horizonAns : HORIZON_DEFAUT;
    const finHorizon = ajouterAns(today, horizon);
    const personnes = objet(profil.personnes);
    const credits = liste(d.credits).length || !profil.credits ? liste(d.credits) : liste(profil.credits);
    const biens = liste(d.biens).length || !profil.biens ? liste(d.biens) : liste(profil.biens);
    const jalons = [], aCompleter = [], seuils = [], indispo = new Map();
    const dejaDemande = new Set();

    const rep = cle => { const r = R.trouver(reperes, cle); return r && isFinite(+r.valeur) ? r : null; };
    const val = cle => +rep(cle).valeur;
    /** Repères manquants parmi `cles` ; les consigne comme règle indisponible. */
    function manquants(regle, cles) {
      const m = cles.filter(c => !rep(c));
      if (m.length) {
        const prev = indispo.get(regle) || new Set();
        m.forEach(c => prev.add(c));
        indispo.set(regle, prev);
      }
      return m.length > 0;
    }
    const nomPersonne = p => (personnes[p] && typeof personnes[p].nom === "string" && personnes[p].nom.trim()) || null;

    function sourceDe(cles, secours) {
      const r = cles.map(rep).find(Boolean);
      if (r) return { titre: r.sourceTitre || null, url: r.sourceUrl || null, verifie_le: r.verifieLe || null, reperes: cles.filter(c => rep(c)) };
      return secours || { titre: null, url: null, verifie_le: null, reperes: [] };
    }
    const IGNORER_FIN = ["per_report_ans_ancien"]; // dispositif terminé mais toujours valable pour les années qu'il couvre
    function avertissementsDe(cles) {
      const out = [];
      cles.map(rep).filter(Boolean).forEach(r => {
        if (R.aVerifier(r, today)) out.push(r.libelle + " : chiffre vérifié le " + dateFr(r.verifieLe) + ", à revérifier.");
        if (r.dateFin && estDate(r.dateFin) && r.dateFin < today && !IGNORER_FIN.includes(r.cle)) out.push(r.libelle + " : dispositif terminé le " + dateFr(r.dateFin) + ".");
      });
      return out;
    }

    /** Ajoute un jalon (sauf après la clôture de l'enveloppe ou au-delà de l'horizon). */
    function jalon(o) {
      const regle = REGLE[o.cle], v = o.variante && regle.variantes && regle.variantes[o.variante];
      const cles = o.reperes || (v && v.reperes) || regle.reperes;
      if (o.inst && o.inst.cloture && !o.ignorerCloture && o.date > o.inst.cloture.date) return;
      if (o.date > finHorizon) return;
      const jours = joursEntre(today, o.date), statut = statutDe(jours);
      const ctx = Object.assign({ env: o.nom || "", pel_prolongation: "" }, o.ctx || {});
      if (o.cle === "pel_10_ans" && !o.variante) ctx.pel_prolongation = R.format({ valeur: val("pel_duree_vie_ans") - val("pel_duree_max_ans"), unite: "ans" });
      const modele = (v && v.effet) || regle.effet, modelePasse = (v && v.effetPasse) || regle.effetPasse;
      jalons.push({
        id: o.cle + ":" + o.enveloppe + ":" + o.date, date: o.date, enveloppe: o.enveloppe, enveloppe_nom: o.nom || null,
        titulaire: o.titulaire || null, type: o.type, cle: o.cle, titre: remplir(regle.titre, ctx, reperes),
        effet: remplir(statut === "passe" ? modelePasse : modele, ctx, reperes), calcul: o.calcul || "", statut, jours, delai: texteDelai(jours),
        source: o.source || sourceDe(cles), confiance: o.confiance, donnee: o.donnee || null, avertissements: avertissementsDe(cles),
      });
    }
    function aCompl(inst, regleCle, champ, titre, pourquoi, document) {
      const id = champ + ":" + inst.cle;
      if (dejaDemande.has(id)) return;
      dejaDemande.add(id);
      aCompleter.push({ id, enveloppe: inst.cle, enveloppe_nom: inst.nom || null, titulaire: inst.titulaire || null, type: inst.type, cle: regleCle, champ, titre, pourquoi, document });
    }
    const donneeDe = (inst, champ) => ({ champ, source: inst.infos && inst.infos.source != null ? String(inst.infos.source) : null, le: inst.infos && inst.infos.le != null ? String(inst.infos.le) : null });

    /** Ancre « date d'ouverture » : exacte, ou approchée (au plus tard). */
    function ancreOuverture(inst) {
      const i = inst.infos;
      if (!i) return null;
      if (estDate(i.date_ouverture)) return { date: i.date_ouverture, min: i.date_ouverture, max: i.date_ouverture, confiance: "sure", champ: "date_ouverture" };
      const a = approx(i.date_ouverture_approx);
      return a ? { date: a.max, min: a.min, max: a.max, confiance: "approchee", champ: "date_ouverture_approx", approx: i.date_ouverture_approx } : null;
    }
    /** Ancre « naissance » du titulaire : jour exact, ou mois (1er du mois : la limite d'âge n'est jamais crue plus lointaine). */
    function ancreNaissance(inst) {
      const n = inst.titulaire && personnes[inst.titulaire] ? personnes[inst.titulaire].naissance : null;
      const champ = { champ: "naissance", source: "date de naissance du profil", le: null };
      if (estDate(n)) return { date: n, confiance: "sure", donnee: champ };
      const a = approx(n);
      return a && typeof n === "string" && n.length === 7 ? { date: a.min, confiance: "approchee", donnee: champ, mois: n } : null;
    }
    function calculDuree(libelle, a, nTxt, expire, final) {
      const debut = a.approx ? libelle + " connu à " + (a.approx.length === 4 ? "l'année" : "au mois") + " près : au plus tard le " + dateFr(a.date) : libelle + " le " + dateFr(a.date);
      return debut + " + " + nTxt + " → " + dateFr(expire) + (final !== expire ? ", révolus le " + dateFr(final) : "");
    }

    const ens = enveloppes(d.positions, cfg.enveloppes_infos, today);
    const ouverts = ens.filter(e => !e.cloture);
    const PEA = ["pea", "pea_pme", "pea_jeune"], AV = ["assurance_vie", "capitalisation"];

    /* ---- règles des enveloppes ---- */
    ens.forEach(inst => {
      const t = inst.type, ouvert = !inst.cloture;
      if (!t) return;
      const base = { inst, enveloppe: inst.cle, nom: inst.nom, titulaire: inst.titulaire, type: t };
      /* durée à partir de la date d'ouverture */
      const duree = (cleRegle, repereDuree, o) => {
        const requis = o.requis || REGLE[cleRegle].reperes;
        if (manquants(cleRegle, requis)) return false;
        const a = ancreOuverture(inst);
        if (!a) return "manque";
        const n = val(repereDuree), expire = ajouterAns(a.date, n), final = o.jourMeme ? expire : lendemain(expire);
        jalon(Object.assign({}, base, { cle: cleRegle, date: final, confiance: a.confiance, reperes: requis, variante: o.variante,
          donnee: donneeDe(inst, a.champ), calcul: calculDuree(o.ancre, a, R.format(rep(repereDuree)), expire, final) }));
        return true;
      };
      const demanderOuverture = (regleCle, pourquoi) => aCompl(inst, regleCle, "date_ouverture", "Date d'ouverture de « " + inst.nom + " »", pourquoi, DOCUMENTS.date_ouverture[t]);

      if (PEA.includes(t)) {
        const r = duree("pea_5_ans", "pea_duree_ans", { ancre: "premier versement" });
        if (r === "manque" && ouvert) demanderOuverture("pea_5_ans", "Elle fait courir le délai de " + R.format(rep("pea_duree_ans")) + " du PEA, après lequel un retrait ne clôture plus le plan.");
      }
      if (AV.includes(t)) {
        const r = duree("av_8_ans", "av_duree_ans", { ancre: "premier versement" });
        if (r === "manque" && ouvert) demanderOuverture("av_8_ans", "Elle fait courir les " + R.format(rep("av_duree_ans")) + " après lesquels les gains retirés bénéficient de l'abattement annuel.");
      }
      if (t === "assurance_vie" && !manquants("av_70_ans", REGLE.av_70_ans.reperes) && inst.titulaire) {
        const n = ancreNaissance(inst);
        if (!n) {
          if (ouvert) aCompl(inst, "av_70_ans", "naissance", "Date de naissance " + (nomPersonne(inst.titulaire) ? "de " + nomPersonne(inst.titulaire) : "de l'assuré"),
            "Elle fixe le " + R.format(rep("av_age_seuil")).replace(" ans", "ᵉ anniversaire") + " de l'assuré, qui change l'abattement applicable aux versements à son décès.", DOCUMENTS.naissance);
        } else {
          const age = val("av_age_seuil"), date = ajouterAns(n.date, age);
          jalon(Object.assign({}, base, { cle: "av_70_ans", date, confiance: n.confiance, donnee: n.donnee,
            calcul: (n.mois ? "naissance en " + n.mois.slice(5) + "/" + n.mois.slice(0, 4) + " (1er du mois, la date la plus précoce)" : "naissance le " + dateFr(n.date)) + " + " + R.format(rep("av_age_seuil")) + " → " + dateFr(date) }));
        }
      }
      if (t === "per" && !manquants("per_70_ans", REGLE.per_70_ans.reperes) && inst.titulaire) {
        const n = ancreNaissance(inst);
        if (!n) {
          if (ouvert) aCompl(inst, "per_70_ans", "naissance", "Date de naissance " + (nomPersonne(inst.titulaire) ? "de " + nomPersonne(inst.titulaire) : "du titulaire"),
            "Elle fixe le " + R.format(rep("per_age_fin_deduction")).replace(" ans", "ᵉ anniversaire") + ", à partir duquel les versements ne sont plus déductibles.", DOCUMENTS.naissance);
        } else {
          const age = val("per_age_fin_deduction"), date = ajouterAns(n.date, age);
          jalon(Object.assign({}, base, { cle: "per_70_ans", date, confiance: n.confiance, donnee: n.donnee,
            calcul: (n.mois ? "naissance en " + n.mois.slice(5) + "/" + n.mois.slice(0, 4) + " (1er du mois, la date la plus précoce)" : "naissance le " + dateFr(n.date)) + " + " + R.format(rep("per_age_fin_deduction")) + " → " + dateFr(date) }));
        }
      }
      if (t === "pel") {
        const a = ancreOuverture(inst);
        if (!a) {
          if (ouvert) {
            const ok = !["pel_2_ans", "pel_4_ans", "pel_10_ans", "pel_15_ans", "pel_12_ans"].every(c => manquants(c, REGLE[c].reperes));
            if (ok) demanderOuverture("pel_2_ans", "Elle fixe les étapes du plan : retrait sans pénalité, durée minimale, fin des versements et, pour un plan d'avant 2018, fin de l'exonération d'impôt.");
          }
        } else {
          const depuis2011 = a.min >= "2011-03-01", avant2011 = a.max < "2011-03-01", depuis1992 = a.min >= "1992-04-01";
          const plan = (c, rd, o) => duree(c, rd, Object.assign({ ancre: "versement initial" }, o));
          plan("pel_2_ans", "pel_retrait_min_ans", {});
          if (depuis1992) plan("pel_4_ans", "pel_duree_min_ans", {});
          if (depuis2011) plan("pel_10_ans", "pel_duree_max_ans", {});
          else if (avant2011) plan("pel_10_ans", "pel_duree_max_ans", { variante: "avant_2011", requis: REGLE.pel_10_ans.variantes.avant_2011.reperes });
          if (depuis2011) plan("pel_15_ans", "pel_duree_vie_ans", {});
          if (depuis1992 && a.max <= "2017-12-31") plan("pel_12_ans", "pel_exoneration_ir_ans", { jourMeme: true });
        }
      }
      if (t === "pee") {
        const vs = liste(inst.infos && inst.infos.versements).filter(v => v && typeof v === "object" && estDate(v.le) && nombre(v.montant) > 0);
        if (!vs.length) {
          if (ouvert && !manquants("pee_disponible", REGLE.pee_disponible.reperes))
            aCompl(inst, "pee_disponible", "versements", "Versements de « " + inst.nom + " »",
              "Chaque versement devient disponible sans motif au bout de " + R.format(rep("pee_blocage_ans")) + " ; le relevé indique la date exacte.", DOCUMENTS.versements);
        } else if (!manquants("pee_disponible", REGLE.pee_disponible.reperes)) {
          const groupes = new Map();
          vs.forEach(v => {
            const sure = estDate(v.disponible_le), date = sure ? v.disponible_le : lendemain(ajouterAns(v.le, val("pee_blocage_ans")));
            const k = date + "|" + (sure ? "sure" : "approchee");
            if (!groupes.has(k)) groupes.set(k, { date, sure, montant: 0, les: [] });
            const g = groupes.get(k);
            g.montant += +v.montant;
            g.les.push(v.le);
          });
          groupes.forEach(g => jalon(Object.assign({}, base, { cle: "pee_disponible", date: g.date, confiance: g.sure ? "sure" : "approchee",
            variante: g.sure ? null : "au_plus_tot", ctx: { montant: eur(g.montant) }, donnee: donneeDe(inst, g.sure ? "versements.disponible_le" : "versements"),
            calcul: g.sure ? "date de disponibilité du relevé : " + dateFr(g.date)
              : "versement" + (g.les.length > 1 ? "s" : "") + " du " + g.les.map(dateFr).join(", ") + " + " + R.format(rep("pee_blocage_ans")) + " → au plus tôt le " + dateFr(g.date) })));
        }
      }
      if (t === "compte_titres" && inst.infos && !manquants("mv_expire", REGLE.mv_expire.reperes)) {
        const parDate = new Map();
        liste(inst.infos.moins_values).filter(m => m && typeof m === "object" && Number.isInteger(+m.annee) && nombre(m.montant) > 0).forEach(m => {
          const date = (+m.annee + val("mv_report_ans")) + "-12-31", g = parDate.get(date) || { annee: +m.annee, montant: 0 };
          g.montant += +m.montant;
          parDate.set(date, g);
        });
        parDate.forEach((g, date) => jalon(Object.assign({}, base, { cle: "mv_expire", date, confiance: "sure", ignorerCloture: true, ctx: { annee: g.annee, montant: eur(g.montant) },
          donnee: donneeDe(inst, "moins_values"), calcul: "moins-value de " + g.annee + " + " + R.format(rep("mv_report_ans")) + " → dernier jour le " + dateFr(date) })));
      }
    });

    /* ---- règles du foyer ---- */
    const annee0 = annee(today), finAnnee = annee0 + "-12-31";
    // abattement annuel de l'assurance-vie : un seul jalon dès qu'un contrat ouvert a passé ses 8 ans
    const avPasse = ouverts.some(inst => AV.includes(inst.type) && !manquants("av_8_ans", REGLE.av_8_ans.reperes) && (a => a && lendemain(ajouterAns(a.date, val("av_duree_ans"))) < today)(ancreOuverture(inst)));
    if (avPasse && !manquants("av_abattement_annee", REGLE.av_abattement_annee.reperes))
      jalon({ cle: "av_abattement_annee", enveloppe: "foyer", nom: "Foyer", titulaire: null, type: "foyer", date: finAnnee, confiance: "sure", donnee: null,
        calcul: "dernier jour de l'année " + annee0 });
    // épargne retraite : plafond de l'avis d'impôt, ou 31 décembre quand il manque
    const avis = objet(cfg.avis_impot), avisPresent = Number.isInteger(avis.annee_revenus);
    if (ouverts.some(inst => inst.type === "per") && !avisPresent && !manquants("per_fin_annee", REGLE.per_fin_annee.reperes)) {
      jalon({ cle: "per_fin_annee", enveloppe: "foyer", nom: "Foyer", titulaire: null, type: "foyer", date: finAnnee, confiance: "sure", donnee: null,
        calcul: "dernier jour de l'année " + annee0 });
      const id = "avis_impot:foyer";
      if (!dejaDemande.has(id)) {
        dejaDemande.add(id);
        aCompleter.push({ id, enveloppe: "foyer", enveloppe_nom: "Foyer", titulaire: null, type: "foyer", cle: "per_fin_annee", champ: "avis_impot", titre: "Avis d'impôt (plafond épargne retraite)",
          pourquoi: "Il donne ton plafond de versement sur un PER et la date où chaque part non utilisée s'éteint.", document: DOCUMENTS.avis_impot });
      }
    }
    if (avisPresent) {
      const pl = objet(avis.plafonds_per);
      const parts = PERSONNES.some(p => liste(pl[p]).some(l => l && Number.isInteger(+l.annee) && nombre(l.montant) > 0));
      PERSONNES.forEach(p => parts && !manquants("per_plafond_expire", ["per_report_ans"]) && liste(pl[p]).forEach(l => {
        if (!l || !Number.isInteger(+l.annee) || !(nombre(l.montant) > 0)) return;
        const nouveau = +l.annee >= annee(rep("per_report_ans").dateEffet);
        const cle = nouveau ? "per_report_ans" : "per_report_ans_ancien";
        if (manquants("per_plafond_expire", [cle])) return;
        const date = (+l.annee + val(cle)) + "-12-31";
        if (date < today) return; // part déjà éteinte : plus rien à faire
        jalon({ cle: "per_plafond_expire", enveloppe: "foyer|" + p, nom: nomPersonne(p) || p, titulaire: p, type: "foyer", date, confiance: "sure", reperes: [cle],
          ctx: { annee: +l.annee, montant: eur(l.montant) }, variante: null,
          donnee: { champ: "avis_impot.plafonds_per." + p, source: avis.source != null ? String(avis.source) : null, le: avis.le != null ? String(avis.le) : null },
          calcul: "plafond " + l.annee + " + " + R.format(rep(cle)) + " de report → dernier jour le " + dateFr(date) });
      }));
    }
    // donations consenties : rappel fiscal à 15 ans
    liste(cfg.donations).forEach(dn => {
      if (!dn || typeof dn !== "object" || !estDate(dn.date) || dn.nature === "don_logement_790a_bis" || typeof dn.id !== "string" || !dn.id) return;
      const variante = dn.nature === "don_argent_790g" ? "don_argent" : dn.lien === "enfant" ? null : "autre";
      const v = variante && REGLE.donation_15_ans.variantes[variante];
      const requis = v ? v.reperes : REGLE.donation_15_ans.reperes.slice(0, 2);
      if (manquants("donation_15_ans", requis)) return;
      const expire = ajouterAns(dn.date, val("donation_rappel_ans")), date = lendemain(expire);
      jalon({ cle: "donation_15_ans", enveloppe: "donation:" + dn.id, nom: dn.beneficiaire || "le bénéficiaire", titulaire: PERSONNES.includes(dn.donateur) ? dn.donateur : null, type: "donation",
        date, confiance: "sure", reperes: requis, variante, ctx: { beneficiaire: dn.beneficiaire || "le bénéficiaire", date: dateFr(dn.date) },
        donnee: { champ: "donations", source: dn.source != null ? String(dn.source) : null, le: dn.le != null ? String(dn.le) : null },
        calcul: "donation du " + dateFr(dn.date) + " + " + R.format(rep("donation_rappel_ans")) + " → " + dateFr(expire) + ", rappel écarté dès le " + dateFr(date) });
    });
    // révision des livrets réglementés : lendemain de la fin de période du repère du taux
    const lignesLivret = ens.filter(e => !e.cloture && !e.type);
    const detenus = new Set(ouverts.map(e => e.type).filter(t => LIVRETS.includes(t)));
    lignesLivret.forEach(e => e.lignes.forEach(p => { const t = typeDeduit(p.name); if (LIVRETS.includes(t)) detenus.add(t); }));
    if (detenus.size) {
      const lot = [];
      if (detenus.has("livret_a") || detenus.has("ldds")) lot.push({ cle: "livret_a_taux", noms: ["livret_a", "ldds"].filter(x => detenus.has(x)).map(x => (x === "livret_a" ? "Livret A" : "LDDS")).join(" et ") });
      if (detenus.has("lep")) lot.push({ cle: "lep_taux", noms: "LEP" });
      const manque = lot.filter(l => manquants("taux_reglementes", [l.cle]));
      const parFin = new Map();
      lot.filter(l => !manque.includes(l)).forEach(l => {
        const r = rep(l.cle);
        if (!r.dateFin || !estDate(r.dateFin)) return;
        const date = lendemain(r.dateFin), g = parFin.get(date) || { date, lots: [] };
        g.lots.push(l);
        parFin.set(date, g);
      });
      parFin.forEach(g => jalon({ cle: "taux_reglementes", enveloppe: "foyer", nom: "Foyer", titulaire: null, type: "foyer", date: g.date, confiance: "sure", reperes: g.lots.map(l => l.cle),
        ctx: { taux: g.lots.map(l => l.noms + " : " + R.format(rep(l.cle))).join(" ; ") },
        source: sourceDe(g.lots.map(l => l.cle)), donnee: null,
        calcul: "fin de la période du taux (" + dateFr(rep(g.lots[0].cle).dateFin) + ") → révision possible dès le " + dateFr(g.date) }));
    }
    // prêts : dernière échéance
    const prets = objet(cfg.prets_infos);
    [["credit", credits], ["bien", biens]].forEach(([genre, elems]) => elems.forEach(el => {
      if (!el || typeof el !== "object" || typeof el.id !== "string" || !el.id) return;
      const cle = genre + ":" + el.id, i = prets[cle] && typeof prets[cle] === "object" ? prets[cle] : null;
      const nom = el.nom || (genre === "credit" ? "Crédit" : "Bien"), titulaire = PERSONNES.includes(el.owner) ? el.owner : null;
      let date = null, confiance = null, champ = null, calcul = "";
      if (i && estDate(i.date_fin)) { date = i.date_fin; confiance = "sure"; champ = "date_fin"; calcul = "date de fin du prêt : " + dateFr(date); }
      else if (i && estDate(i.date_signature) && Number.isInteger(+i.duree_mois) && +i.duree_mois > 0) {
        date = ajouterMois(i.date_signature, +i.duree_mois); confiance = "calculee"; champ = "date_signature+duree_mois";
        calcul = "signature le " + dateFr(i.date_signature) + " + " + i.duree_mois + " mois → " + dateFr(date);
      }
      if (date) {
        const mens = nombre(el.mensualite);
        jalon({ cle: "pret_fin", enveloppe: cle, nom, titulaire, type: genre, date, confiance, variante: mens > 0 ? null : "sans_mensualite", ctx: { mensualite: eur(mens) },
          source: { titre: i.source != null ? String(i.source) : "Offre de prêt", url: null, verifie_le: null, reperes: [] },
          donnee: { champ, source: i.source != null ? String(i.source) : null, le: i.le != null ? String(i.le) : null }, calcul });
      } else if (nombre(el.crd) > 0) {
        const id = "date_fin:" + cle;
        if (!dejaDemande.has(id)) {
          dejaDemande.add(id);
          aCompleter.push({ id, enveloppe: cle, enveloppe_nom: nom, titulaire, type: genre, cle: "pret_fin", champ: "date_fin", titre: "Date de fin du prêt « " + nom + " »",
            pourquoi: "Elle dit quand la mensualité se libère.", document: DOCUMENTS.date_fin });
        }
      }
    }));

    /* ---- seuils ---- */
    const vc = inst => (inst.infos && nombre(inst.infos.versements_cumules) >= 0 ? +inst.infos.versements_cumules : null);
    const seuil = (inst, cle, titre, verse, plafond, reste, cles) => seuils.push({ id: cle + ":" + inst.cle, enveloppe: inst.cle, enveloppe_nom: inst.nom, cle, titre, verse, plafond,
      reste: Math.max(0, reste), source: sourceDe(cles), donnee: donneeDe(inst, "versements_cumules") });
    ouverts.filter(e => PEA.includes(e.type) && vc(e) != null).forEach(inst => {
      const cles = inst.type === "pea" ? ["pea_plafond"] : inst.type === "pea_jeune" ? ["pea_jeune_plafond"] : ["pea_pme_plafond_global"];
      if (manquants("pea_plafond", cles)) return;
      const memeTitulaire = e => e.titulaire === inst.titulaire && inst.titulaire != null;
      if (inst.type === "pea_pme") {
        const peas = ouverts.filter(e => e.type === "pea" && memeTitulaire(e));
        if (peas.some(e => vc(e) == null)) return; // total du titulaire inconnu : pas de plafond global fiable
        const verse = vc(inst) + peas.reduce((s, e) => s + vc(e), 0);
        seuil(inst, "pea_plafond", "Plafond cumulé du PEA et du PEA PME-ETI", verse, val(cles[0]), val(cles[0]) - verse, cles);
      } else if (inst.type === "pea") {
        let reste = val(cles[0]) - vc(inst);
        const pmes = ouverts.filter(e => e.type === "pea_pme" && memeTitulaire(e));
        if (pmes.length && pmes.every(e => vc(e) != null) && rep("pea_pme_plafond_global")) reste = Math.min(reste, val("pea_pme_plafond_global") - vc(inst) - pmes.reduce((s, e) => s + vc(e), 0));
        seuil(inst, "pea_plafond", "Plafond de versements du PEA", vc(inst), val(cles[0]), reste, cles.concat(pmes.length ? ["pea_pme_plafond_global"] : []));
      } else seuil(inst, "pea_plafond", "Plafond de versements du PEA d'un majeur rattaché", vc(inst), val(cles[0]), val(cles[0]) - vc(inst), cles);
    });
    ouverts.filter(e => AV.includes(e.type) && e.titulaire && vc(e) != null).forEach(inst => {
      if (manquants("av_seuil_versements", ["av_seuil_versements"])) return;
      const freres = ouverts.filter(e => AV.includes(e.type) && e.titulaire === inst.titulaire);
      if (freres.some(e => vc(e) == null)) return;
      const verse = freres.reduce((s, e) => s + vc(e), 0);
      seuil(inst, "av_seuil_versements", "Seuil de versements du taux réduit (à titre indicatif)", verse, val("av_seuil_versements"), val("av_seuil_versements") - verse, ["av_seuil_versements"]);
    });

    /* ---- sortie ---- */
    const ordre = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    jalons.sort((a, b) => ordre(a.date, b.date) || ordre(a.cle, b.cle) || ordre(a.enveloppe, b.enveloppe));
    aCompleter.sort((a, b) => ordre(a.enveloppe, b.enveloppe) || ordre(a.champ, b.champ));
    seuils.sort((a, b) => ordre(a.enveloppe, b.enveloppe) || ordre(a.cle, b.cle));
    const regles_indisponibles = [...indispo.entries()].map(([cle, m]) => ({ cle, reperes_manquants: [...m].sort() })).sort((a, b) => ordre(a.cle, b.cle));
    return {
      jalons, a_completer: aCompleter, seuils, regles_indisponibles,
      prochains: jalons.filter(j => j.statut !== "passe").slice(0, 3), dans_3_mois: jalons.filter(j => j.statut === "proche"),
    };
  }

  return { calendrier, REGLES, TYPES, typeDeduit, cleEnveloppe, ajouterAns, ajouterMois, lendemain, joursEntre, estDate, texteDelai, dateFr, PROCHE_JOURS, DOCUMENTS };
});
