// Fichier généré par scripts/gen-catalogue.mjs (npm run gen) : ne pas modifier à la main.
// Copie du moteur de reconstitution du passé de l'app (HIS2, docs/superpowers/specs/2026-10-16-his2-historique-design.md § 7) : les modules purs de web/src
// (reperes, calendrier, calc, historique) recopiés tels quels, évalués dans cet ordre. Aucune modification : un écart avec l'app est un bug du générateur.
const definitions = {}, modules = {};
function def(nom, fabrique) { definitions[nom] = fabrique; }
function charger(nom) {
  if (modules[nom]) return modules[nom].exports;
  const fabrique = definitions[nom];
  if (!fabrique) throw new Error("historique-nuit : module inconnu « " + nom + " »");
  const module = modules[nom] = { exports: {} };
  fabrique.call(globalThis, module, module.exports, chemin => charger(chemin.replace(/^.*\//, "").replace(/\.js$/, "")));
  return module.exports;
}

/* ---------- web/src/reperes.js ---------- */
def("reperes", function (module, exports, require) {
/* Repères chiffrés du savoir commun (table reperes) : lecture avec valeur de secours, ancienneté, format français.
   Pur, sans DOM. S.savoir.reperes = [{ cle, libelle, valeur, unite, dateEffet, dateFin, sourceTitre, sourceUrl, verifieLe, mode }]
   (dateFin : fin d'un dispositif ou d'une période, null si aucune). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Reperes = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const A_VERIFIER_JOURS = 180;
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const trouver = (liste, cle) => (Array.isArray(liste) ? liste.find(r => r && r.cle === cle) : null) || null;
  /** Valeur du repère `cle`, ou `defaut` s'il est absent (table injoignable, démo sans repère). */
  function valeur(liste, cle, defaut) { const r = trouver(liste, cle); return r && isFinite(+r.valeur) ? +r.valeur : defaut; }
  /** Vrai si la dernière vérification date de plus de 180 jours. */
  function aVerifier(r, today) {
    if (!r || !r.verifieLe) return true;
    return (Date.parse(today || new Date().toISOString().slice(0, 10)) - Date.parse(r.verifieLe)) / 864e5 > A_VERIFIER_JOURS;
  }
  function format(r) { return r ? nf.format(+r.valeur) + " " + r.unite : ""; }
  function depuisLignes(rows) {
    return (rows || []).map(x => ({ cle: x.cle, libelle: x.libelle, valeur: +x.valeur, unite: x.unite, dateEffet: x.date_effet,
      dateFin: x.date_fin || null, sourceTitre: x.source_titre, sourceUrl: x.source_url, verifieLe: x.verifie_le, mode: x.mode }));
  }
  return { valeur, aVerifier, format, depuisLignes, trouver, A_VERIFIER_JOURS };
});
});

/* ---------- web/src/calendrier.js ---------- */
def("calendrier", function (module, exports, require) {
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
   data = { positions, config, profil, credits, biens, reperes } (formes de l'app ; Calendrier.depuisEtat(S) la construit depuis le store) ; today = AAAA-MM-JJ (date de Paris) ;
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
      effet: "Un retrait partiel ne clôture plus le plan et {qui} peut continuer à verser. Les gains sont exonérés d'impôt sur le revenu ; les prélèvements sociaux restent dus. Avant cette date, un retrait clôture le plan, sauf cas prévus par la loi (licenciement, invalidité, mise à la retraite anticipée…).",
      effetPasse: "Les {pea_duree_ans} sont révolus : un retrait partiel ne clôture plus le plan et {qui} peut continuer à verser. Les gains sont exonérés d'impôt sur le revenu ; les prélèvements sociaux restent dus." },
    { cle: "av_8_ans", types: ["assurance_vie", "capitalisation"], ancre: "date_ouverture",
      reperes: ["av_duree_ans", "av_abattement_seul", "av_abattement_couple", "av_seuil_versements"], fiche: "assurance-vie",
      titre: "{env} : {av_duree_ans} révolus",
      effet: "Les gains retirés bénéficient chaque année d'un abattement de {av_abattement_seul} ({av_abattement_couple} pour un couple soumis à imposition commune), tous contrats confondus. Au-delà, ils sont taxés à un taux réduit tant que les versements nets (tous contrats confondus) restent sous {av_seuil_versements} ; au-dessus, ce taux ne s'applique qu'au prorata. L'abattement ne joue que sur l'impôt sur le revenu : les prélèvements sociaux restent dus sur la totalité des gains.",
      effetPasse: "Les {av_duree_ans} sont révolus : les gains retirés bénéficient chaque année d'un abattement de {av_abattement_seul} ({av_abattement_couple} pour un couple soumis à imposition commune), tous contrats confondus. Au-delà, ils sont taxés à un taux réduit tant que les versements nets (tous contrats confondus) restent sous {av_seuil_versements} ; au-dessus, ce taux ne s'applique qu'au prorata. L'abattement ne joue que sur l'impôt sur le revenu : les prélèvements sociaux restent dus sur la totalité des gains." },
    { cle: "av_70_ans", types: ["assurance_vie"], ancre: "naissance", reperes: ["av_age_seuil", "av_990i_abattement", "av_757b_abattement"], fiche: "assurance-vie",
      titre: "{env} : {av_age_seuil} de l'assuré",
      effet: "Les versements faits avant cette date relèvent, au décès de l'assuré, d'un abattement de {av_990i_abattement} par bénéficiaire. Ceux faits ensuite relèvent d'un abattement global de {av_757b_abattement}, tous contrats et bénéficiaires confondus ; seuls ces versements sont comptés, pas les gains qu'ils ont produits.",
      effetPasse: "L'assuré a passé les {av_age_seuil} : les versements faits avant relèvent, à son décès, d'un abattement de {av_990i_abattement} par bénéficiaire. Ceux faits depuis relèvent d'un abattement global de {av_757b_abattement}, tous contrats et bénéficiaires confondus ; seuls ces versements sont comptés, pas les gains qu'ils ont produits." },
    { cle: "pel_2_ans", types: ["pel"], ancre: "date_ouverture", reperes: ["pel_retrait_min_ans"], fiche: null,
      titre: "{env} : {pel_retrait_min_ans} révolus",
      effet: "Un retrait, à tout moment, clôture le PEL. Avant cette date, ses intérêts sont alors recalculés au taux du CEL et tu perds le droit au prêt.",
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
      effet: "Les intérêts acquis à partir de cette date sont soumis à l'impôt sur le revenu (ceux acquis pendant les {pel_exoneration_ir_ans} qui précèdent en sont exonérés ; les prélèvements sociaux restent dus).",
      effetPasse: "Les intérêts acquis depuis cette date sont soumis à l'impôt sur le revenu (ceux acquis pendant les {pel_exoneration_ir_ans} qui précédaient en étaient exonérés ; les prélèvements sociaux restent dus)." },
    { cle: "pee_disponible", types: ["pee"], ancre: "versements", reperes: ["pee_blocage_ans"], fiche: null,
      titre: "{env} : avoirs disponibles",
      effet: "{montant} deviennent disponibles sans motif.",
      effetPasse: "{montant} sont disponibles sans motif.",
      variantes: { au_plus_tot: {
        effet: "{montant} deviennent disponibles sans motif, au plus tôt à cette date : le règlement du plan peut en fixer une plus tardive, ton relevé l'indique.",
        effetPasse: "{montant} sont disponibles sans motif, au plus tôt depuis cette date : le règlement du plan peut en fixer une plus tardive, ton relevé l'indique." } } },
    { cle: "per_70_ans", types: ["per"], ancre: "naissance", reperes: ["per_age_fin_deduction"], fiche: "per",
      titre: "{env} : {per_age_fin_deduction}, fin de la déduction",
      effet: "À partir de cette date, {qui} ne peut plus déduire de son revenu imposable ses versements sur un PER.",
      effetPasse: "Depuis cette date, les versements sur un PER ne sont plus déductibles du revenu imposable." },
    { cle: "per_plafond_expire", types: [], ancre: "avis_impot", reperes: ["per_report_ans", "per_report_ans_ancien"], fiche: "per",
      titre: "Plafond épargne retraite {annee} : dernier jour pour l'utiliser",
      effet: "Dernier jour pour verser sur un PER en utilisant ce reste de plafond ({montant}) ; il ne peut plus servir ensuite.",
      effetPasse: "Ce reste de plafond ({montant}) ne pouvait plus servir après cette date." },
    { cle: "per_fin_annee", types: [], ancre: "annee", reperes: ["per_report_ans"], fiche: "per",
      titre: "Épargne retraite de l'année",
      effet: "Les versements déductibles comptent pour l'année où ils sont faits. Ton plafond disponible est sur ton avis d'impôt.",
      effetPasse: "Les versements déductibles comptent pour l'année où ils sont faits." },
    { cle: "av_abattement_annee", types: [], ancre: "annee", reperes: ["av_abattement_seul", "av_abattement_couple"], fiche: "assurance-vie",
      titre: "Abattement assurance-vie",
      effet: "L'abattement sur les gains retirés est annuel : celui de cette année ne se reporte pas sur la suivante.",
      effetPasse: "L'abattement sur les gains retirés est annuel : celui de l'année ne se reporte pas sur la suivante." },
    { cle: "donation_15_ans", types: [], ancre: "donations", reperes: ["donation_rappel_ans", "donation_abattement_enfant", "don_familial_argent"], fiche: null,
      titre: "Donation à {beneficiaire} : {donation_rappel_ans} révolus",
      effet: "La donation du {date} à {beneficiaire} n'est plus rappelée : l'abattement de {donation_abattement_enfant} entre ce parent et cet enfant est de nouveau entier.",
      effetPasse: "La donation du {date} à {beneficiaire} n'est plus rappelée : l'abattement de {donation_abattement_enfant} entre ce parent et cet enfant est de nouveau entier.",
      variantes: {
        reconstitue: { reperes: ["donation_rappel_ans", "donation_abattement_enfant"],
          effet: "La donation du {date} n'est plus rappelée : l'abattement se reconstitue de son montant ({montant}).",
          effetPasse: "La donation du {date} n'est plus rappelée : l'abattement se reconstitue de son montant ({montant})." },
        don_argent: { reperes: ["donation_rappel_ans", "don_familial_argent"],
          effet: "Le don familial de sommes d'argent ({don_familial_argent}) est de nouveau possible entre {donateur} et {beneficiaire}, si les conditions d'âge sont remplies.",
          effetPasse: "Le don familial de sommes d'argent ({don_familial_argent}) est de nouveau possible entre {donateur} et {beneficiaire}, si les conditions d'âge sont remplies." },
        autre: { reperes: ["donation_rappel_ans"],
          effet: "La donation du {date} à {beneficiaire} n'est plus rappelée lors d'une nouvelle donation à la même personne.",
          effetPasse: "La donation du {date} à {beneficiaire} n'est plus rappelée lors d'une nouvelle donation à la même personne." } } },
    { cle: "mv_expire", types: ["compte_titres"], ancre: "moins_values", reperes: ["mv_report_ans"], fiche: "compte-titres-fiscalite",
      titre: "{env} : moins-value {annee} à imputer avant cette date",
      effet: "Dernier jour pour imputer la moins-value de {annee} ({montant}) sur des plus-values de même nature ; elle est perdue ensuite.",
      effetPasse: "La moins-value de {annee} ({montant}) ne peut plus être imputée sur des plus-values de même nature." },
    { cle: "taux_reglementes", types: ["livret_a", "ldds", "lep"], ancre: "reperes", reperes: ["livret_a_taux", "lep_taux"], fiche: "livrets-reglementes",
      titre: "Taux des livrets réglementés",
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
    // une clé sans suffixe existe pour l'autre titulaire : celle-ci ne doit pas être écrasée
    if (PERSONNES.includes(titulaire) && Object.keys(inf).some(k => norm(k) === n && objet(inf[k]).titulaire && objet(inf[k]).titulaire !== titulaire)) return String(nom).trim() + "|" + titulaire;
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
      const ctx = Object.assign({ env: o.nom || "", pel_prolongation: "", qui: nomPersonne(o.titulaire) || "le titulaire" }, o.ctx || {});
      if (o.cle === "pel_10_ans" && !o.variante) ctx.pel_prolongation = R.format({ valeur: val("pel_duree_vie_ans") - val("pel_duree_max_ans"), unite: "ans" });
      const modele = (v && v.effet) || regle.effet, modelePasse = (v && v.effetPasse) || regle.effetPasse;
      jalons.push({
        id: o.cle + ":" + o.enveloppe + ":" + o.date, date: o.date, enveloppe: o.enveloppe, enveloppe_nom: o.nom || null,
        titulaire: o.titulaire || null, type: o.type, cle: o.cle, titre: remplir(regle.titre, ctx, reperes),
        effet: remplir(statut === "passe" ? modelePasse : modele, ctx, reperes), calcul: o.calcul || "", statut, jours, delai: texteDelai(jours),
        source: o.source || sourceDe(cles), confiance: o.confiance, donnee: o.donnee || null, avertissements: avertissementsDe(cles),
      });
    }
    function aCompl(inst, regleCle, champ, titre, pourquoi, document, idUnique) {
      const id = idUnique || champ + ":" + inst.cle;
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
            "Elle fixe le " + R.format(rep("av_age_seuil")).replace(" ans", "ᵉ anniversaire") + " de l'assuré, qui change l'abattement applicable aux versements à son décès.", DOCUMENTS.naissance, "naissance:" + inst.titulaire);
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
            "Elle fixe le " + R.format(rep("per_age_fin_deduction")).replace(" ans", "ᵉ anniversaire") + ", à partir duquel les versements ne sont plus déductibles.", DOCUMENTS.naissance, "naissance:" + inst.titulaire);
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
          const cheval = (borne) => a.min < borne && a.max >= borne;
          if (ouvert && a.confiance === "approchee" && (cheval("2011-03-01") || cheval("1992-04-01")))
            demanderOuverture("pel_10_ans", "Elle n'est connue qu'à l'année près et la génération du plan en dépend : durée maximale, fin du plan et exonération d'impôt ne sont pas les mêmes selon la date d'ouverture exacte.");
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
      let variante = dn.nature === "don_argent_790g" ? "don_argent" : dn.lien === "enfant" ? null : "autre";
      const v = variante && REGLE.donation_15_ans.variantes[variante];
      const requis = v ? v.reperes : REGLE.donation_15_ans.reperes.slice(0, 2);
      if (manquants("donation_15_ans", requis)) return;
      const expire = ajouterAns(dn.date, val("donation_rappel_ans")), date = lendemain(expire);
      // une autre donation des mêmes donateur et bénéficiaire encore dans le rappel à cette date : l'abattement ne redevient pas « entier »
      const garde = o => o && o !== dn && typeof o === "object" && estDate(o.date) && o.date <= date && ajouterAns(o.date, val("donation_rappel_ans")) >= date
        && o.nature !== "don_argent_790g" && o.nature !== "don_logement_790a_bis" && o.donateur === dn.donateur && norm(o.beneficiaire) === norm(dn.beneficiaire);
      const montant = nombre(dn.montant);
      if (!variante && montant > 0 && typeof dn.donateur === "string" && norm(dn.beneficiaire) && liste(cfg.donations).some(garde)) variante = "reconstitue";
      jalon({ cle: "donation_15_ans", enveloppe: "donation:" + dn.id, nom: dn.beneficiaire || "le bénéficiaire", titulaire: PERSONNES.includes(dn.donateur) ? dn.donateur : null, type: "donation",
        date, confiance: "sure", reperes: requis, variante, ctx: { beneficiaire: dn.beneficiaire || "le bénéficiaire", date: dateFr(dn.date), donateur: nomPersonne(dn.donateur) || "le donateur",
          montant: eur(variante === "reconstitue" ? Math.min(montant, val("donation_abattement_enfant")) : montant || 0) },
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

  /** Entrée du moteur depuis l'état S du store (S.positions, S.config, S.profil, S.savoir.reperes) : crédits et biens sont ceux du profil. */
  function depuisEtat(S) {
    const s = objet(S), pr = objet(s.profil);
    return { positions: liste(s.positions), config: objet(s.config), profil: pr, credits: liste(pr.credits), biens: liste(pr.biens), reperes: liste(objet(s.savoir).reperes) };
  }

  return { depuisEtat, calendrier, REGLES, TYPES, typeDeduit, cleEnveloppe, ajouterAns, ajouterMois, lendemain, joursEntre, estDate, texteDelai, dateFr, PROCHE_JOURS, DOCUMENTS };
});
});

/* ---------- web/src/calc.js ---------- */
def("calc", function (module, exports, require) {
/* Calculs patrimoniaux purs, partagés par tous les onglets. Aucun accès au DOM. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  const n = v => (isFinite(+v) ? +v : 0);
  const pos = v => Math.max(0, n(v));

  /* ---------- positions du Pilotage ---------- */
  function val(p) {
    if (p.mode === "market" && p.qty != null && p.price != null) return p.qty * p.price;
    return n(p.value);
  }
  const counted = p => p.status !== "à recevoir" && p.status !== "clôturé";
  const inScope = (p, scope) => scope === "foyer" || p.owner === scope;
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

  function financier(positions, scope) {
    return sum((positions || []).filter(p => inScope(p, scope) && counted(p)), val);
  }
  function poche(positions, scope, bloc) {
    return sum((positions || []).filter(p => inScope(p, scope) && counted(p) && p.bloc === bloc), val);
  }
  function aRecevoir(positions, scope) {
    return sum((positions || []).filter(p => inScope(p, scope) && p.status === "à recevoir"), val);
  }

  /* ---------- classes d'actifs et liquidité ---------- */
  const sansAccent = s => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  /* Poche (libellé libre) → classe d'actifs. Table par défaut, surchargeable par l'utilisateur. */
  const CLASSES = {
    monde: "actions", europe: "actions", asie: "actions", "nasdaq 2x": "actions", nasdaq: "actions", "convictions tech": "actions", convictions: "actions",
    actions: "actions", "etats-unis": "actions", usa: "actions", emergents: "actions", "small caps": "actions",
    obligations: "obligations", oblig: "obligations",
    scpi: "immobilier", immobilier: "immobilier", sci: "immobilier", opci: "immobilier",
    epargne: "monetaire", livrets: "monetaire", monetaire: "monetaire", cash: "monetaire", liquidites: "monetaire",
    "comptes courants": "monetaire", "compte courant": "monetaire",
    protection: "fonds_euros", "fonds euros": "fonds_euros", "fonds euro": "fonds_euros",
    or: "or", "metaux precieux": "or", crypto: "crypto", cryptos: "crypto",
  };
  const CLASSES_LABELS = { actions: "Actions", obligations: "Obligations", immobilier: "Immobilier", monetaire: "Monétaire et livrets", fonds_euros: "Fonds euros", or: "Or", crypto: "Crypto", autres: "Autres" };
  function classe(bloc, surcharge) {
    if (surcharge && bloc in surcharge) return surcharge[bloc];
    return CLASSES[sansAccent(bloc)] || "autres";
  }
  /* Enveloppe → délai pour récupérer l'argent : immediate, jours (titres cotés), semaines (assurance-vie), bloque (PER, immobilier).
     « compte » non suivi de « titres » (un compte-titres se vend en quelques jours) ; « PERin » bloqué. Même règle que liquidite() du connecteur. */
  const LIQUIDITE_LABELS = { immediate: "Disponible tout de suite", jours: "Sous quelques jours", semaines: "Sous quelques semaines", bloque: "Bloqué ou peu liquide" };
  function liquidite(envelope) {
    const e = sansAccent(envelope);
    if (/\bper\b|\bperin\b|perco|pee|retraite|scpi|immobilier/.test(e)) return "bloque";
    if (/livret|ldds|lep|\bcomptes?\b(?![- ]?titres?)|cash|especes|courant/.test(e)) return "immediate";
    if (/\bav\b|assurance|vie|capitalisation/.test(e)) return "semaines";
    return "jours";
  }
  function grouper(positions, scope, cle) {
    const out = {};
    (positions || []).filter(p => inScope(p, scope) && counted(p)).forEach(p => { const k = cle(p); out[k] = (out[k] || 0) + val(p); });
    return out;
  }

  /* ---------- familles de comptes (spec 2026-10-12-cp1, § 1) ---------- */
  /* Chaque ligne appartient à une famille, déduite de son enveloppe et de son bloc :
     - courant : bloc ou enveloppe « Compte(s) courant(s) » (bloc créé par la synchronisation bancaire) ou « Compte joint » ;
     - investissement : enveloppe PEA, PEA-PME, compte-titres (CTO), assurance-vie (AV), capitalisation, PER (PERin, PERP, PERCO,
       PERCOL, PERECO), Madelin, PEE / épargne salariale, « Plan d'épargne en actions / retraite / entreprise / avenir » en toutes
       lettres, crypto (Binance), SCPI / OPCI / SCI — l'enveloppe d'investissement prime sur la poche (un fonds
       monétaire dans un compte-titres reste de l'investissement) ;
     - epargne : enveloppe livret (Livret A, LDDS, LEP, CEL, PEL, CSL), compte à terme, compte épargne, monétaire, cash, espèces ;
     - repli (enveloppe muette, ex. « Banque ») : la classe de la poche (Calc.classe, surcharge comprise) ; monétaire → epargne,
       tout le reste → investissement.
     Les dettes ne sont pas des lignes : elles viennent des biens (capital restant dû) et des crédits du profil (Calc.dettes).
     Même fonction dans le connecteur (supabase/functions/mcp/index.ts, famille), parité testée sur une liste de libellés. */
  const FAMILLES_LABELS = { courant: "Comptes courants", epargne: "Épargne disponible", investissement: "Investissement", dettes: "Dettes" };
  const RE_COURANT = /\bcomptes? courants?\b|\bcomptes? joints?\b/;
  const RE_INVEST = /\bpea\b|\bcto\b|\bcomptes?[- ]?titres?\b|assurance.?vie|\bav\b|capitalisation|\bper\b|\bperin\b|\bperp\b|\bperco\b|\bpercol\b|\bpereco\b|\bpee\b|\bmadelin\b|plans? (d.)?epargne (en actions|(pour la )?retraite|(d.)?entreprise|avenir)|epargne salariale|crypto|binance|\bscpi\b|\bopci\b|\bsci\b/;
  const RE_EPARGNE = /livret|\bldds\b|\blep\b|\bcel\b|\bpel\b|\bcsl\b|compte a terme|epargne|monetaire|\bcash\b|especes/;
  function famille(position, surcharge) {
    const p = position || {}, env = sansAccent(p.envelope), bloc = sansAccent(p.bloc);
    if (RE_COURANT.test(bloc) || RE_COURANT.test(env)) return "courant";
    if (RE_INVEST.test(env)) return "investissement";
    if (RE_EPARGNE.test(env)) return "epargne";
    return classe(p.bloc, surcharge) === "monetaire" ? "epargne" : "investissement";
  }
  const estCourant = p => famille(p) === "courant";
  /** Lignes hors comptes courants : base de l'allocation, du risque et de la diversification (le patrimoine net garde tout). */
  const horsCourants = positions => (positions || []).filter(p => p && !estCourant(p));

  const parClasse = (positions, scope, surcharge) => grouper(horsCourants(positions), scope, p => classe(p.bloc, surcharge));
  const parLiquidite = (positions, scope) => grouper(positions, scope, p => liquidite(p.envelope));

  /* ---------- profil ---------- */
  /* Quote-part d'un bien : part_p1 (0-100) appartient à la personne 1, le complément à la personne 2. */
  function part(scope, partP1) {
    const s = Math.min(100, Math.max(0, partP1 == null ? 50 : n(partP1))) / 100;
    return scope === "foyer" ? 1 : scope === "p1" ? s : 1 - s;
  }
  function partCredit(scope, owner) {
    if (scope === "foyer") return 1;
    if (owner === "commun") return 0.5;
    return owner === scope ? 1 : 0;
  }
  const biens = pr => (pr && Array.isArray(pr.biens) ? pr.biens : []);
  const credits = pr => (pr && Array.isArray(pr.credits) ? pr.credits : []);
  const scopePeople = scope => (scope === "foyer" ? ["p1", "p2"] : [scope]);

  function immobilier(profil, scope) {
    return sum(biens(profil), b => pos(b.valeur) * part(scope, b.part_p1));
  }
  function dettes(profil, scope) {
    return sum(biens(profil), b => pos(b.crd) * part(scope, b.part_p1)) +
      sum(credits(profil), c => pos(c.crd) * partCredit(scope, c.owner));
  }
  /** Crédits en cours du foyer (avant partage par personne), UNE définition pour Patrimoine › Immobilier et crédits, Compte › Données et la
      protection du bilan : les prêts rattachés aux biens (reste dû ou mensualité positifs), puis chaque crédit déclaré (auto, consommation,
      travaux). → [{ kind: "pret" | "credit", nom, crd, mensualite }]. Leur somme est Calc.dettes / Calc.mensualites du foyer. */
  function creditsEnCours(profil) {
    const out = [];
    biens(profil).forEach(b => { if (b && (pos(b.crd) > 0 || pos(b.mensualite) > 0)) out.push({ kind: "pret", nom: String(b.nom || "").trim() || "Bien", crd: pos(b.crd), mensualite: pos(b.mensualite) }); });
    credits(profil).forEach(c => { if (c) out.push({ kind: "credit", nom: String(c.nom || "").trim() || "Crédit", crd: pos(c.crd), mensualite: pos(c.mensualite) }); });
    return out;
  }
  function mensualites(profil, scope) {
    return sum(biens(profil), b => pos(b.mensualite) * part(scope, b.part_p1)) +
      sum(credits(profil), c => pos(c.mensualite) * partCredit(scope, c.owner));
  }
  function autresActifs(profil, scope) {
    const a = (profil && profil.autres) || {};
    return scopePeople(scope).reduce((o, k) => {
      o.usage += pos(a[k] && a[k].usage);
      o.entreprise += pos(a[k] && a[k].entreprise);
      return o;
    }, { usage: 0, entreprise: 0 });
  }
  function patrimoine(positions, profil, scope) {
    const f = financier(positions, scope), i = immobilier(profil, scope), a = autresActifs(profil, scope), d = dettes(profil, scope);
    const brut = f + i + a.usage + a.entreprise;
    return { financier: f, immobilier: i, usage: a.usage, entreprise: a.entreprise, dettes: d, brut, net: brut - d };
  }

  /* Taux brut → net de la toise : 0,75 cadre, 0,78 non-cadre. */
  const brutRate = statut => (statut === "cadre" ? 0.75 : 0.78);
  function salaireNetMensuel(p) {
    if (!p) return 0;
    const v = pos(p.salaire), r = brutRate(p.statut);
    switch (p.salaireUnite) {
      case "na": return v / 12;
      case "bm": return v * r;
      case "ba": return v * r / 12;
      default: return v;
    }
  }
  function revenusFoyer(profil, scope) {
    const ps = (profil && profil.personnes) || {};
    const sal = sum(scopePeople(scope), k => salaireNetMensuel(ps[k]) + pos(ps[k] && ps[k].autresRevenus));
    return sal + sum(biens(profil), b => pos(b.loyer) * part(scope, b.part_p1));
  }

  /* Matelas de précaution (config.cushion) : { mode: "amount", min, max } ou { mode: "months", months, depenses }
     (cible = months × depenses, sans plafond). Ancienne forme sans mode = montant. null si non défini. */
  function matelas(config) {
    const c = config && config.cushion;
    if (!c || typeof c !== "object") return null;
    if (c.mode === "months") return { mode: "months", min: pos(c.months) * pos(c.depenses), max: null, months: pos(c.months), depenses: pos(c.depenses) };
    return { mode: "amount", min: pos(c.min), max: c.max == null || c.max === "" ? null : pos(c.max) };
  }

  /* ---------- budget réel (banques connectées, spec cp1 § 5) ---------- */
  /* banque = S.banque { actif?, comptes, mois } (ou la même forme lue en SQL par le connecteur : doublon_de, compte_id).
     Comptes courants suivis : type « courant », non ignorés, pas en double, actifs. */
  const doublonDe = c => (c.doublonDe !== undefined ? c.doublonDe : c.doublon_de);
  function comptesCourants(banque) {
    const L = banque && Array.isArray(banque.comptes) ? banque.comptes : [];
    return L.filter(c => c && c.type === "courant" && c.ignore !== true && doublonDe(c) == null && c.actif !== false);
  }
  /* Compte d'une ligne de banque_mois : compteId (store) ou compte_id (SQL) ; 0 (valeur par défaut de la migration 0025) = totaux par
     utilisateur, comme une ligne sans compte. */
  const idCompte = r => { const v = r.compteId != null ? r.compteId : r.compte_id; return v == null || v === "" || +v === 0 ? null : v; };
  const moisIso = d => { const s = d instanceof Date ? d.toISOString() : String(d == null ? "" : d); return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null; };
  const lignesMois = banque => (banque && Array.isArray(banque.mois) ? banque.mois : []).filter(Boolean);
  /** Mois (AAAA-MM) détaillés par compte : au moins une ligne porte un compte. */
  const moisDetailles = banque => new Set(lignesMois(banque).filter(r => idCompte(r) != null).map(r => moisIso(r.mois)));
  /** Lignes de banque_mois des comptes courants, mois par mois : un mois détaillé par compte (compteId / compte_id) ne garde que les
      lignes des comptes courants suivis (ses éventuels totaux agrégés sont écartés) ; un mois sans détail (totaux par utilisateur, BQ1)
      garde ses lignes telles quelles. */
  function moisCourants(banque) {
    const L = lignesMois(banque), det = moisDetailles(banque);
    if (!det.size) return L;
    const ids = new Set(comptesCourants(banque).map(c => String(c.id)));
    return L.filter(r => (det.has(moisIso(r.mois)) ? idCompte(r) != null && ids.has(String(idCompte(r))) : true));
  }
  const RE_INTERNE = /^virements?[_ ]internes?$|^interne$/;

  /* ---------- série fusionnée des mois bancaires (HIS2, spec 2026-10-16-his2-historique-design.md § 6.1) ---------- */
  const liste = v => (Array.isArray(v) ? v.filter(Boolean) : []);
  const cleCompte = v => (v == null || v === "" ? null : String(v));
  const compteBanqueDe = hc => { const v = hc.banqueCompteId !== undefined ? hc.banqueCompteId : hc.banque_compte_id; return v == null || v === "" || +v === 0 ? null : v; };
  const compteImporteDe = r => (r.compteId != null ? r.compteId : r.compte_id);
  const importDe = r => (r.importId !== undefined ? r.importId : r.import_id);
  /** Ligne de totaux d'un mois importé, dans la forme d'une ligne de banque_mois (mois au 1er du mois, compte, catégorie large, sous-catégorie). */
  const ligneImportee = (r, mois, compte) => ({ mois: mois + "-01", compte_id: compte, categorie: r.categorie, sous_categorie: r.sous_categorie == null ? "" : r.sous_categorie,
    entrees: n(r.entrees), sorties: n(r.sorties), nombre: n(r.nombre) });
  /** Série des mois bancaires par compte et par mois, UNE fonction pour la synchronisation (Powens) et les relevés importés (HIS2) : jamais deux fois
      le même euro. Consommée par budgetReel (donc la projection et la santé), par le connecteur et par l'écran de couverture.
      banque = S.banque { comptes, mois } ; historique = { comptes, releves, banqueMois } (historique_comptes, historique_releves,
      historique_banque_mois ; champs en snake_case de la base ou en camelCase du store) ; auj = date du jour (les mois importés après le mois en
      cours sont ignorés). Règles : un compte importé rattaché à un compte Powens (banque_compte_id) prend Powens pour un mois que banque_mois
      couvre, sauf le premier mois du compte dans banque_mois (réputé entamé : la synchronisation a commencé en cours de mois) où l'import l'emporte ;
      un compte importé non rattaché : l'import ; un compte Powens sans import : Powens pour tous ses mois, premier mois compris. Une carte à débit
      différé importée compte si le courant importé du même établissement et du même titulaire porte ce mois-là une ligne « releve_carte » (hors budget),
      ou si aucun courant de cet établissement et de ce titulaire n'est importé ce mois-là ; sinon elle est écartée (son relevé, compté sur le courant, ne
      doit pas l'être deux fois).
      → [{ compte, mois: "AAAA-MM", source: "powens" | "import" | null, type?, categories: [lignes de banque_mois], releve?, import_id?, ecarte? }], triée par
      mois puis par compte (en texte). compte = banque_compte_id si le compte importé est rattaché ou si c'est un compte Powens (null pour des
      totaux sans compte), sinon "h:" + id du compte importé ; releve = en-tête du mois importé { complet, solde_debut, solde_fin, total_entrees,
      total_sorties, nombre } ; ecarte = [{ source, import_id?, raison }] avec raison couvert_par_powens | premier_mois | carte_comptee_sur_courant
      (ce qui a été mis de côté reste visible dans la couverture). Même calcul dans le connecteur (parité testée). */
  function moisBancaires(banque, historique, auj) {
    const courant = moisIso(auj == null ? new Date() : auj);
    const H = historique || {};
    const hComptes = liste(H.comptes), hReleves = liste(H.releves), hLignes = liste(H.banqueMois);
    // Powens : lignes par (compte, mois) et premier mois de chaque compte
    const powens = new Map(), premier = {};
    lignesMois(banque).forEach(r => {
      const m = moisIso(r.mois);
      if (!m) return;
      const c = idCompte(r), k = cleCompte(c) + "|" + m;
      if (!powens.has(k)) powens.set(k, { compte: c, mois: m, lignes: [] });
      powens.get(k).lignes.push(r);
      if (c != null && (premier[String(c)] === undefined || m < premier[String(c)])) premier[String(c)] = m;
    });
    // Relevés importés : lignes par (compte importé, mois)
    const compteH = new Map(hComptes.map(c => [String(c.id), c]));
    const lignesH = new Map();
    hLignes.forEach(r => {
      const m = moisIso(r.mois), c = cleCompte(compteImporteDe(r));
      if (!m || c == null) return;
      const k = c + "|" + m;
      if (!lignesH.has(k)) lignesH.set(k, []);
      lignesH.get(k).push(r);
    });
    const importes = hReleves.map(r => ({ r, hc: compteH.get(String(compteImporteDe(r))), mois: moisIso(r.mois) }))
      .filter(x => x.hc && x.mois && (!courant || x.mois <= courant));
    const courants = (hc, mois) => importes.filter(x => x.mois === mois && x.hc.type === "courant" && x.hc.etablissement === hc.etablissement && x.hc.titulaire === hc.titulaire);
    const aReleveCarte = x => (lignesH.get(String(x.hc.id) + "|" + x.mois) || []).some(l => l.sous_categorie === "releve_carte");
    const sortie = [], prises = new Set();
    importes.forEach(x => {
      const { r, hc, mois } = x, rattache = compteBanqueDe(hc), compte = rattache != null ? rattache : "h:" + hc.id;
      const lignes = (lignesH.get(String(hc.id) + "|" + mois) || []).map(l => ligneImportee(l, mois, compte));
      const releve = { complet: r.complet !== false, solde_debut: r.solde_debut == null ? null : n(r.solde_debut), solde_fin: r.solde_fin == null ? null : n(r.solde_fin),
        total_entrees: n(r.total_entrees), total_sorties: n(r.total_sorties), nombre: n(r.nombre) };
      const imp = importDe(r), base = { compte, mois, type: hc.type, categories: lignes, releve };
      if (imp != null) base.import_id = imp;
      const kp = cleCompte(rattache) + "|" + mois, p = rattache != null ? powens.get(kp) : null;
      if (p) {
        prises.add(kp);
        if (mois === premier[String(rattache)]) { sortie.push({ ...base, source: "import", ecarte: [{ source: "powens", raison: "premier_mois" }] }); return; }
        const e = { source: "import", raison: "couvert_par_powens" };
        if (imp != null) e.import_id = imp;
        sortie.push({ compte, mois, source: "powens", type: hc.type, categories: p.lignes, ecarte: [e] });
        return;
      }
      if (hc.type === "carte_differe") {
        const cc = courants(hc, mois);
        if (cc.length && !cc.some(aReleveCarte)) {
          const e = { source: "import", raison: "carte_comptee_sur_courant" };
          if (imp != null) e.import_id = imp;
          sortie.push({ compte, mois, source: null, type: hc.type, categories: [], ecarte: [e] });
          return;
        }
      }
      sortie.push({ ...base, source: "import" });
    });
    powens.forEach((p, k) => { if (!prises.has(k)) sortie.push({ compte: p.compte, mois: p.mois, source: "powens", categories: p.lignes }); });
    return sortie.sort((a, b) => (a.mois < b.mois ? -1 : a.mois > b.mois ? 1 : String(a.compte) < String(b.compte) ? -1 : String(a.compte) > String(b.compte) ? 1 : 0));
  }
  /** Lignes des relevés importés qui comptent au budget : source « import », mois complet, compte courant ou joint (une carte à débit différé
      déjà décidée par moisBancaires). Les livrets et autres comptes importés ne servent qu'à la couverture. */
  const importeAuBudget = e => e.source === "import" && e.releve && e.releve.complet !== false && (e.type === "courant" || e.type === "joint" || e.type === "carte_differe");
  /** Budget réel moyen des nb (3) derniers mois complets (mois en cours exclu), comptes courants seulement :
      revenus = entrées − sorties de « revenus » ; épargne = sorties − entrées de « epargne » (virements vers l'épargne et
      l'investissement) ; dépenses = sorties − entrées de toutes les autres catégories ; virements internes exclus.
      tauxEpargne = « Épargne versée » : versements d'épargne et d'investissement ÷ revenus (moyennes de la période ; même chiffre que lire_banque, banque.ts). « Capacité d'épargne » réelle
      (spec cp4 § 1.2, critère « Capacité d'épargne » de Santé) : capacite = revenus − dépenses, tauxCapacite = capacite ÷ revenus (l'épargne
      versée en est une partie, affichée à part). parCompte : vrai si chaque mois retenu est détaillé par compte
      (chiffres des seuls comptes courants) ; faux sinon (totaux de tous les comptes connectés : libellé « tous comptes connectés »).
      historique (facultatif, HIS2) : relevés importés { comptes, releves, banqueMois } ; le calcul porte alors sur la série de moisBancaires
      (Powens et import, jamais les deux pour le même compte et le même mois) ; sans lui, comportement inchangé. Un mois importé non complet n'y entre jamais.
      → { n, du, au, revenus, depenses, epargne, tauxEpargne, capacite, tauxCapacite, parCompte, moisImportes? (avec relevés importés : mois retenus qui en viennent) } ou null (interrupteur éteint et aucun relevé importé,
      aucun mois complet). Même calcul dans le connecteur (budgetReel, index.ts). */
  function budgetReel(banque, auj, nb, historique) {
    const actif = !!banque && banque.actif !== false;
    const utileH = !!historique && (liste(historique.releves).length > 0);
    if (!actif && !utileH) return null;
    const b = actif ? banque : { mois: [], comptes: [] };
    const k = Number.isInteger(nb) && nb > 0 ? nb : 3;
    const courant = moisIso(auj == null ? new Date() : auj);
    let L0 = moisCourants(b), importees = [];
    if (utileH) {
      const serie = moisBancaires(b, historique, auj);
      const remplaces = new Set(serie.filter(e => e.source !== "powens" && (e.ecarte || []).some(x => x.source === "powens")).map(e => cleCompte(e.compte) + "|" + e.mois));
      L0 = L0.filter(r => !remplaces.has(cleCompte(idCompte(r)) + "|" + moisIso(r.mois)));
      importees = serie.filter(importeAuBudget);
      importees.forEach(e => e.categories.forEach(l => L0.push(l)));
    }
    const L = L0.filter(r => moisIso(r.mois) && moisIso(r.mois) < courant && !RE_INTERNE.test(sansAccent(r.categorie)));
    const retenus = [...new Set(L.map(r => moisIso(r.mois)))].sort().slice(-k);
    if (!retenus.length) return null;
    let rev = 0, dep = 0, ep = 0;
    L.filter(r => retenus.includes(moisIso(r.mois))).forEach(r => {
      const e = n(r.entrees), s = n(r.sorties), c = sansAccent(r.categorie);
      if (c === "revenus") rev += e - s; else if (c === "epargne") ep += s - e; else dep += s - e;
    });
    const det = moisDetailles(b);
    importees.forEach(e => det.add(e.mois));
    const m = retenus.length, revenus = pos(rev) / m, depenses = pos(dep) / m, epargne = pos(ep) / m;
    const res = { n: m, du: retenus[0] + "-01", au: retenus[m - 1] + "-01", revenus, depenses, epargne, tauxEpargne: revenus > 0 ? epargne / revenus : null,
      capacite: revenus - depenses, tauxCapacite: revenus > 0 ? (revenus - depenses) / revenus : null, parCompte: retenus.every(x => det.has(x)) };
    // avec des relevés importés : combien des mois retenus viennent d'eux (au moins un compte importé ce mois-là)
    if (utileH) res.moisImportes = retenus.filter(x => importees.some(e => e.mois === x)).length;
    return res;
  }
  /** Période d'un budget réel en clair (spec cp4 § 1) : « juillet à septembre 2026 », « novembre 2025 à janvier 2026 », « septembre 2026 ».
      r = { du, au } (AAAA-MM-JJ) ; "" si r est absent. Même fonction dans le connecteur (periodeReel, index.ts). */
  const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  function periodeReel(r) {
    const a = r && moisIso(r.du), b = r && moisIso(r.au);
    if (!a || !b) return "";
    const nom = m => MOIS_FR[+m.slice(5, 7) - 1], an = m => m.slice(0, 4);
    if (a === b) return nom(b) + " " + an(b);
    return an(a) === an(b) ? nom(a) + " à " + nom(b) + " " + an(b) : nom(a) + " " + an(a) + " à " + nom(b) + " " + an(b);
  }
  /** Dépenses mensuelles du budget prévu (mêmes règles que Plan.budgetTotaux : lignes de dépense × part du périmètre + mensualités
      de crédit, si au moins une ligne de dépense ; sinon les dépenses saisies du matelas en mois ; sinon 0). */
  function depensesPrevues(budget, profil, config, scope) {
    const sc = scope || "foyer";
    const L = Array.isArray(budget) ? budget : budget && Array.isArray(budget.lignes) ? budget.lignes : [];
    const lignes = sum(L.filter(l => l && l.type === "depense"), l =>
      (l.frequence === "an" ? pos(l.montant) / 12 : pos(l.montant)) * partCredit(sc, l.owner === "p1" || l.owner === "p2" ? l.owner : "commun"));
    if (lignes > 0) return lignes + mensualites(profil, sc);
    const m = matelas(config);
    return m && m.mode === "months" && m.depenses > 0 ? m.depenses : 0;
  }
  /** Dépenses mensuelles de référence : budget réel (foyer seulement : les comptes ne sont pas répartis par personne) s'il existe,
      sinon budget prévu. ctx = { banque, relevesBancaires (relevés importés, facultatif), budget, profil, config, scope, auj } → { montant, source: "reel" | "prevu", reel? } ou null. */
  function depensesMensuelles(ctx) {
    const c = ctx || {}, sc = c.scope || "foyer";
    const r = sc === "foyer" ? budgetReel(c.banque, c.auj, undefined, c.relevesBancaires) : null;
    if (r && r.depenses > 0) return { montant: r.depenses, source: "reel", reel: r };
    const p = depensesPrevues(c.budget, c.profil, c.config, sc);
    return p > 0 ? { montant: p, source: "prevu" } : null;
  }

  /* ---------- matelas disponible (spec cp1 § 1) ---------- */
  /** Réserve de fonctionnement laissée sur les comptes courants, en mois de dépenses : config.cushion.reserve_mois (facultatif,
      à côté des formes amount / months), 1 par défaut. */
  function reserveMois(config) {
    const c = config && config.cushion, v = c && typeof c === "object" ? c.reserve_mois : undefined;
    return v !== null && v !== undefined && v !== "" && isFinite(+v) && +v >= 0 ? +v : 1;
  }
  /** Matelas = épargne disponible + max(0, soldes courants − réserve), réserve = reserveMois × dépenses mensuelles.
      opts = { config, depenses } → { epargne, courants, reserveMois, depenses, reserve, courantsAuDela, total }. */
  function matelasDisponible(positions, scope, opts) {
    const o = opts || {}, sc = scope || "foyer";
    const L = (positions || []).filter(p => p && inScope(p, sc) && counted(p));
    const epargne = sum(L.filter(p => famille(p) === "epargne"), val);
    const courants = sum(L.filter(estCourant), val);
    const rm = reserveMois(o.config), depenses = pos(o.depenses), reserve = rm * depenses;
    const courantsAuDela = Math.max(0, courants - reserve);
    return { epargne, courants, reserveMois: rm, depenses, reserve, courantsAuDela, total: epargne + courantsAuDela };
  }

  /* ---------- poches d'une photo (snapshots.by_bloc) ---------- */
  const objetSimple = v => !!v && typeof v === "object" && !Array.isArray(v);
  const nombreOk = v => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && isFinite(+v);
  /** Poches d'une photo du patrimoine, à plat : { poche: valeur } pour un périmètre (foyer | p1 | p2). Lecteur UNIQUE de snapshots.by_bloc, utilisé par
      l'app et par le connecteur (copies générées de ce module) : la fonction nocturne (take_snapshots, migration 0003) l'écrit PAR PERSONNE,
      { p1: { poche: valeur }, p2: { … } } (forme de production) ; l'ancienne forme de la démo et des lignes migrées est à plat, { poche: valeur }.
      Photo en forme de l'app ({ byBloc }) ou ligne SQL ({ by_bloc }). Foyer = somme de toutes les personnes (p1, p2, et « commun » s'il existe) ;
      p1 / p2 = la leur ; une photo à plat ne se découpe pas par personne (null pour p1 / p2). Valeurs non numériques écartées ; la photo n'est
      jamais modifiée. → objet (éventuellement vide) ou null si la photo n'a pas de poches lisibles. */
  function blocsPhoto(photo, perimetre) {
    const bb = photo && (photo.byBloc || photo.by_bloc), scope = perimetre || "foyer";
    if (!objetSimple(bb)) return null;
    const cles = Object.keys(bb);
    if (!cles.length) return null;
    const out = {};
    const ajoute = m => Object.keys(m).forEach(k => { if (nombreOk(m[k])) out[k] = (out[k] || 0) + +m[k]; });
    if (cles.every(k => objetSimple(bb[k]))) {
      if (scope === "foyer") cles.forEach(o => ajoute(bb[o]));
      else if (objetSimple(bb[scope])) ajoute(bb[scope]);
    } else if (scope === "foyer") ajoute(bb);
    else return null;
    return out;
  }

  /* ---------- argent qui dort (spec cp1 § 1) ---------- */
  const SEUIL_DORT = 1.5;
  const moisAvant = (m, k) => { const [y, mo] = m.split("-").map(Number), t = y * 12 + (mo - 1) - k; return Math.floor(t / 12) + "-" + String(t % 12 + 1).padStart(2, "0"); };
  /** Soldes des comptes courants supérieurs à 1,5 mois de dépenses deux mois de suite (foyer).
      Points mesurés, du plus récent au plus ancien : fins des mois complets d'après les photos (dernière photo de chaque mois), sur les
      seules lignes des comptes courants : poches courantes (byBloc : une poche « Comptes courants » ne contient que des comptes courants)
      et enveloppes courantes (byEnvelope, pour les comptes courants reconnus à leur enveloppe, « Compte joint » par exemple, quand
      aucune de leurs lignes n'est dans une poche courante — sans quoi l'enveloppe est laissée de côté plutôt que comptée deux fois) ;
      jamais une enveloppe mixte (« Boursorama » avec un compte courant et un PEA). À défaut de photo deux mois en arrière : solde
      actuel de ces mêmes lignes puis fin du mois précédent. Dépenses : Calc.depensesMensuelles (réel, sinon prévu).
      → { montant (dépassement le plus faible des deux derniers points, arrondi), mois (mois de suite au-dessus du seuil, ≥ 2), solde
      (point le plus récent), seuil, depenses, source } ou null. Pour Aujourd'hui et la revue mensuelle. */
  function argentQuiDort(S, auj) {
    const s = S || {}, jour = auj == null ? new Date() : auj;
    const courants = (s.positions || []).filter(p => p && counted(p) && estCourant(p));
    if (!courants.length) return null;
    const d = depensesMensuelles({ banque: s.banque, relevesBancaires: s.relevesBancaires, budget: s.budget, profil: s.profil, config: s.config, scope: "foyer", auj: jour });
    if (!d) return null;
    const seuil = SEUIL_DORT * d.montant, m0 = moisIso(jour);
    const blocCourant = p => RE_COURANT.test(sansAccent(p.bloc));
    const blocs = [...new Set(courants.filter(blocCourant).map(p => p.bloc))];
    const envsMelees = new Set(courants.filter(blocCourant).map(p => p.envelope));
    const envs = [...new Set(courants.filter(p => !blocCourant(p) && p.envelope && !envsMelees.has(p.envelope)).map(p => p.envelope))];
    const mesurees = courants.filter(p => blocs.includes(p.bloc) || envs.includes(p.envelope));
    if (!mesurees.length) return null;
    const parBloc = x => blocsPhoto(x, "foyer"), parEnv = x => x && (x.byEnvelope || x.by_envelope);
    const a = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
    const photos = {};
    (Array.isArray(s.snapshots) ? s.snapshots : []).forEach(x => {
      const m = x && moisIso(x.date);
      if (!m || m >= m0 || !(blocs.some(b => a(parBloc(x), b)) || envs.some(e => a(parEnv(x), e)))) return;
      if (!photos[m] || String(x.date) > String(photos[m].date)) photos[m] = x;
    });
    const solde = x => sum(blocs, b => n((parBloc(x) || {})[b])) + sum(envs, e => n((parEnv(x) || {})[e]));
    const points = [];
    if (photos[moisAvant(m0, 1)] && photos[moisAvant(m0, 2)]) {
      for (let k = 1; photos[moisAvant(m0, k)]; k++) points.push(solde(photos[moisAvant(m0, k)]));
    } else if (photos[moisAvant(m0, 1)]) points.push(sum(mesurees, val), solde(photos[moisAvant(m0, 1)]));
    let mois = 0;
    while (mois < points.length && points[mois] > seuil) mois++;
    if (mois < 2) return null;
    return { montant: Math.round(Math.min(points[0], points[1]) - seuil), mois, solde: points[0], seuil, depenses: d.montant, source: d.source };
  }

  /* ---------- doublons probables (revue CP1) ---------- */
  const TOLERANCE_DOUBLON = 0.03;
  /** Lignes qui recopient probablement le total de leur enveloppe (ex. ligne « PEA DUPONT » créée en validant une proposition « créer
      une ligne » alors que les titres du PEA sont déjà suivis : le PEA compte deux fois). Dans une même enveloppe et un même titulaire,
      une ligne manuelle sans ISIN, comptée, dont la valeur est à ±3 % de la somme des autres lignes comptées (au moins 2 autres).
      → [{ ligne (id), nom, enveloppe, titulaire, valeur, sommeAutres }]. Même règle dans le connecteur (doublonsProbables, index.ts). */
  function doublonsProbables(positions) {
    const L = (positions || []).filter(p => p && counted(p) && String(p.envelope || "").trim());
    const groupes = new Map();
    L.forEach(p => { const k = String(p.envelope).trim() + "|" + (p.owner || ""); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(p); });
    const out = [];
    groupes.forEach(g => {
      if (g.length < 3) return;
      const total = sum(g, val);
      g.forEach(p => {
        if (p.mode === "market" || String(p.isin || "").trim()) return;
        const v = val(p), autres = total - v;
        if (v > 0 && autres > 0 && Math.abs(v - autres) <= TOLERANCE_DOUBLON * autres)
          out.push({ ligne: p.id, nom: p.name || "", enveloppe: String(p.envelope).trim(), titulaire: p.owner || null, valeur: v, sommeAutres: autres });
      });
    });
    return out;
  }

  /* Apport : épargne au-delà du matelas (porté par la personne 1 et le foyer), + part des placements, + « à recevoir » en option. */
  function apportDisponible(positions, config, scope, opts) {
    const o = opts || {};
    const epargne = poche(positions, scope, "Épargne");
    const m = matelas(config);
    const matelas_ = scope === "p2" || !m ? 0 : m.min;
    const libre = Math.max(0, epargne - matelas_);
    const autres = financier(positions, scope) - epargne;
    const placements = Math.max(0, autres) * Math.min(100, Math.max(0, n(o.partPlacements))) / 100;
    const rec = o.inclureARecevoir ? aRecevoir(positions, scope) : 0;
    return { epargne, matelas: matelas_, libre, placements, aRecevoir: rec, total: libre + placements + rec };
  }

  /* ---------- noms et validation (la complétude du bilan est dans bilan-etat.js : une seule fonction) ---------- */
  /* « de Camille », « d'Alex » ; sans prénom (ou prénom par défaut) : « de la personne 1 ». */
  const NOMS_PAR_DEFAUT = ["", "moi", "conjoint", "conjoint(e)", "conjointe"];
  function deNom(nom, rang) {
    const s = String(nom == null ? "" : nom).trim();
    if (NOMS_PAR_DEFAUT.includes(s.toLowerCase())) return "de la personne " + (rang || 1);
    return (/^[aeiouyhàâäéèêëîïôöûüÿæœ]/i.test(s) ? "d'" : "de ") + s;
  }
  function valider(profil) {
    const erreurs = [], avertissements = [];
    biens(profil).forEach(b => {
      const nom = b.nom || "Bien sans nom";
      if (n(b.part_p1) < 0 || n(b.part_p1) > 100) erreurs.push(nom + " : la quote-part doit être comprise entre 0 et 100 %.");
      ["valeur", "crd", "mensualite", "loyer"].forEach(k => { if (n(b[k]) < 0) erreurs.push(nom + " : les montants ne peuvent pas être négatifs."); });
      if (pos(b.crd) > pos(b.valeur) && pos(b.valeur) > 0) avertissements.push(nom + " : le capital restant dû dépasse la valeur du bien.");
    });
    credits(profil).forEach(c => {
      if (n(c.crd) < 0 || n(c.mensualite) < 0) erreurs.push((c.nom || "Crédit sans nom") + " : les montants ne peuvent pas être négatifs.");
    });
    return { erreurs: [...new Set(erreurs)], avertissements };
  }

  /* Calendrier patrimonial (DAT1) : délégation à Calendrier.calendrier (web/src/calendrier.js), la même fonction sous Node. */
  const calendrier = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./calendrier.js").calendrier
    : (data, today, options) => root.Calendrier.calendrier(data, today, options);

  return { calendrier, CLASSES_LABELS, LIQUIDITE_LABELS, FAMILLES_LABELS, classe, liquidite, famille, horsCourants, parClasse, parLiquidite,
    comptesCourants, moisCourants, moisBancaires, budgetReel, periodeReel, doublonsProbables, depensesPrevues, depensesMensuelles, reserveMois, matelasDisponible, argentQuiDort, blocsPhoto,
    val, counted, inScope, financier, poche, aRecevoir, part, partCredit, immobilier, dettes, mensualites, creditsEnCours,
    autresActifs, patrimoine, brutRate, salaireNetMensuel, revenusFoyer, matelas, apportDisponible, deNom, valider };
});
});

/* ---------- web/src/historique.js ---------- */
def("historique", function (module, exports, require) {
/* Historique du patrimoine net : reconstitution du passé, fusion avec les photos observées. Calculs purs,
   aucun accès au DOM ni au réseau (les cours, transactions, relevés et opérations sont lus par les stores et passés en paramètres).

   Reconstitution (reconstituer) : le patrimoine financier de chaque jour (pas "jour") ou de chaque fin de mois (pas "mois"), de la veille
   jusqu'au plus loin que les données permettent (5 ans en pas "jour", 20 ans en pas "mois"), puis net = financier + horsFin (immobilier,
   autres biens et dettes d'aujourd'hui, comme BilanCalc.evolution). Sortes de lignes (périmètre et statuts comme Calc.financier, plus les
   lignes clôturées qui ont des transactions) :
   - cotée : quantité × cours de clôture de la table cours (clé : ISIN, à défaut symbole). La quantité remonte le temps par les
     transactions (deltaTx : types du tableau de la spec HIS2 § 4.4 ; une transaction qui a un doublon_de est ignorée). Sans transaction
     pour la ligne : quantité actuelle (« à composition actuelle »). Avant son premier cours, le prix vient des ordres (prix d'exécution
     comme cours implicites, estimés), à défaut du premier cours. Sans cours ni ordre : constante.
   - espèces d'une enveloppe (D6) : ligne d'espèces (drapeau especes, ou nom « Espèces », « Liquidités », « Cash »), dont le solde passé se
     déduit des mouvements de l'enveloppe, recalé sur le solde d'aujourd'hui (recalageEspeces = solde avant le premier mouvement).
   - bancaire : ligne rattachée à un compte (banque_comptes.position_id, hors crédit et comptes ignorés) dont on a lu les opérations :
     solde(j) = valeur actuelle − opérations postérieures à j ; avant la fenêtre lue (90 jours), le solde importé de chaque fin de mois
     (soldesMois, relevés bancaires importés) quand il existe, interpolé entre deux fins de mois ; sinon tenu constant.
   - à relevés de valeur (assurance-vie en euros, PER) : dernier relevé connu + flux nets depuis ce relevé ; avant le premier relevé, cumul
     des flux nets depuis l'ouverture (enveloppe depuis_ouverture) ; aucun rendement inventé entre deux relevés.
   - constante : toutes les autres, à leur valeur d'aujourd'hui (liquidités saisies, parts, etc.).
   Avant le premier mouvement d'une enveloppe déclarée depuis_ouverture (depuisOuverture : { <enveloppe>: true }) : zéro.
   Chaque contribution dit sa nature (mesuree, estimee, constante) et sa source ; qualite() en tire la qualité d'une photo (spec § 7.3).
   Limites assumées : une transaction non enregistrée, un changement de composition sans transaction ou une ligne constante qui a bougé
   faussent le passé ; le résultat nomme chaque catégorie (drapeaux) pour que l'interface le dise.

   Fusion (fusionner) : l'observé (photos nocturnes + point du jour) l'emporte toujours ; le reconstitué n'est gardé que strictement
   avant la première photo, et décalé (recalage) pour rejoindre cette photo sans cassure — l'écart est rendu (decalage).
   La projection (cône pessimiste / central / optimiste) n'est plus ici : le graphe maître lit le moteur Projection (projection.js).
   Dépendance : Calc (calc.js). */
(function (root, factory) {
  const Calc = typeof module === "object" && module.exports ? require("./calc.js") : root.Calc;
  const api = factory(Calc);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Historique = api;
})(typeof self !== "undefined" ? self : this, function (Calc) {
  "use strict";
  const JOURS_MAX = 1826; // 5 ans (pas "jour")
  const JOURS_MOIS_MAX = 7305; // 20 ans (pas "mois")
  const MOIS_MAX = 240; // 20 ans, le plafond de photos_reconstituees
  const METHODE = "historique@2"; // version du moteur des photos stockées : une nouvelle version recalcule tout
  const MES = "mesuree", EST = "estimee", CST = "constante";
  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
  const jj = s => String(s == null ? "" : s).slice(0, 10);
  const fini = v => v != null && v !== "" && isFinite(+v);
  const utc = s => { const [y, m, d] = jj(s).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const plusJours = (s, k) => iso(utc(s) + k * 864e5);
  const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  function plusMois(s, k) {
    const [y, m, d] = jj(s).split("-").map(Number), t = m - 1 + k, yy = y + Math.floor(t / 12), mm = ((t % 12) + 12) % 12;
    return iso(Date.UTC(yy, mm, Math.min(d, new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate())));
  }
  /** Dernier jour du mois d'une date « AAAA-MM-JJ » ou d'un mois « AAAA-MM ». */
  const finDeMois = s => { const [y, m] = jj(s).split("-").map(Number); return iso(Date.UTC(y, m, 0)); };
  const arrondi = v => Math.round(v * 100) / 100;
  const arrondi6 = v => Math.round(v * 1e6) / 1e6;
  const liste = v => (Array.isArray(v) ? v : []);
  const plat = t => String(t == null ? "" : t).replace(/\s+/g, " ").trim();
  const sansAccent = t => plat(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const cleEnv = sansAccent;
  const camel = (o, a, b) => (o[a] !== undefined && o[a] !== null ? o[a] : o[b]);
  const ENTREES = /achat|versement|programme|apport|souscription/i, SORTIES = /vente|retrait|rachat|cession/i;
  /* Sens des types sur la quantité (spec HIS2 § 4.4, le tableau fait foi) ; un type libre plus ancien se lit encore par ses mots. */
  const TYPES_ENTREE = { achat: 1, versement: 1, programme: 1, arbitrage_entree: 1, dividende: 1, interets: 1 };
  const TYPES_SORTIE = { vente: 1, retrait: 1, rachat: 1, arbitrage_sortie: 1, frais: 1 };
  const doublon = t => camel(t, "doublonDe", "doublon_de") != null;
  /** Variation de quantité d'une transaction (+ entrée, − sortie), 0 si elle n'en dit rien. Un relevé (point de contrôle) et un solde ne sont
      jamais un mouvement ; une transaction qui a un doublon_de est ignorée ; un dividende, des intérêts ou des frais n'ont d'effet que s'ils
      sont réinvestis ou prélevés en parts (quantité renseignée). */
  function deltaTx(t) {
    if (!t || !fini(t.qty) || +t.qty === 0 || doublon(t)) return 0;
    const q = Math.abs(+t.qty), ty = String(t.type == null ? "" : t.type);
    if (ty === "releve" || ty === "solde") return 0;
    if (TYPES_ENTREE[ty]) return q;
    if (TYPES_SORTIE[ty]) return -q;
    return SORTIES.test(ty) ? -q : ENTREES.test(ty) ? q : 0;
  }
  const trier = (xs, cle) => xs.slice().sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));

  /** Transaction normalisée (null si elle ne compte pas) : { pid, date, type, qty, price, amount, frais, env, imp, src, delta }. */
  function normTx(t) {
    if (!t || !isoOk(t.date) || doublon(t)) return null;
    const pid = camel(t, "positionId", "position_id");
    return { pid: pid == null ? null : pid, date: jj(t.date), type: String(t.type == null ? "" : t.type), qty: fini(t.qty) ? +t.qty : null,
      price: fini(t.price) && +t.price > 0 ? +t.price : null, amount: fini(t.amount) ? Math.abs(+t.amount) : null, frais: fini(t.frais) ? Math.max(0, +t.frais) : 0,
      env: t.enveloppe == null || t.enveloppe === "" ? null : t.enveloppe, imp: camel(t, "importId", "import_id") || null, src: t.source || null, delta: deltaTx(t) };
  }
  const SRC_COURS = { type: "cours" }, SRC_SAISIE = { type: "saisie" }, SRC_POWENS = { type: "powens" };
  /** D'où vient la valeur portée par une transaction : l'import qui l'a apportée (ordres, versements), sinon une saisie ou la nuit. */
  const srcTx = t => (t.imp ? { type: /^(achat|vente)$/.test(t.type) || (t.type === "releve" && t.qty != null) ? "ordres" : "versements", import_id: t.imp } : SRC_SAISIE);
  /** Flux net d'une transaction sur une ligne à relevés de valeur (colonne « valeur d'une ligne manuelle » du § 4.4) : versements, achats et arbitrages en entrée,
      dividendes et intérêts capitalisés, moins retraits, rachats, ventes, arbitrages en sortie et frais. Un relevé ou un solde n'est pas un flux. */
  function fluxValeur(t) {
    const m = t.amount || 0;
    if (/^(achat|versement|programme|arbitrage_entree|dividende|interets)$/.test(t.type)) return m;
    if (/^(vente|retrait|rachat|arbitrage_sortie|frais)$/.test(t.type)) return -m;
    if (t.type === "releve" || t.type === "solde") return 0;
    return SORTIES.test(t.type) ? -m : ENTREES.test(t.type) ? m : 0;
  }
  /** Effet d'une transaction sur les espèces d'une enveloppe dont les espèces sont suivies (colonne « espèces » du § 4.4). surCaisse : la
      transaction est portée par la ligne d'espèces elle-même. Un versement, un retrait, un dividende ou des frais déjà convertis en parts
      d'une ligne cotée ne passent pas par les espèces. */
  function effetEspeces(t, surCaisse) {
    const m = t.amount || 0, f = t.frais || 0, converti = !surCaisse && t.qty != null && t.qty > 0;
    switch (t.type) {
      case "achat": return surCaisse ? 0 : -(m + f);
      case "vente": return surCaisse ? 0 : m - f;
      case "versement": case "programme": case "dividende": case "interets": return converti ? 0 : m;
      case "retrait": case "rachat": case "frais": return converti ? 0 : -m;
      default: return 0;
    }
  }
  const RE_ESPECES = /\besp[eè]ces\b|\bliquidit[eé]s?\b|\bcash\b/i;
  const ligneEspeces = p => !!p && (p.especes === true || (p.mode !== "market" && !plat(p.isin) && RE_ESPECES.test(sansAccent(p.name))));

  /* Indice du dernier élément de `xs` (triés par date) dont la date est ≤ d ; -1 s'il n'y en a pas. */
  function dernierAvant(xs, d) {
    let lo = 0, hi = xs.length - 1, r = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (xs[mid].date <= d) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }
  /** Cumul préfixe : d → somme des `f` des éléments (triés par date) dont la date est ≤ d. */
  function cumulateur(xs, f) {
    const pref = [0];
    xs.forEach(x => pref.push(pref[pref.length - 1] + f(x)));
    return d => pref[dernierAvant(xs, d) + 1];
  }

  /** Qualité d'une photo (spec § 7.3). contributions = [{ ligne, valeur, nature: mesuree|estimee|constante, source: { type, import_id? } }].
      part_estimee = (estimée + constante) ÷ total, en valeur absolue ; complet si ≤ 5 %, partiel si ≤ 30 %, estime au-delà ; sources : une part par
      origine de la valeur (type + import), parts sommant à 1, dans l'ordre d'apparition.
      → { qualite, part_estimee, sources: [{ type, import_id?, part }] } */
  function qualite(contributions) {
    let total = 0, estime = 0;
    const parSource = new Map();
    liste(contributions).forEach(c => {
      if (!c || !fini(c.valeur)) return;
      const v = Math.abs(+c.valeur);
      if (!(v > 0)) return;
      total += v;
      if (c.nature !== MES) estime += v;
      const s = c.source || SRC_SAISIE, cle = (s.type || "saisie") + "|" + (s.import_id || "");
      const x = parSource.get(cle);
      if (x) x.v += v; else parSource.set(cle, { type: s.type || "saisie", import_id: s.import_id, v });
    });
    const part = total > 0 ? estime / total : 0;
    return {
      qualite: part <= 0.05 + 1e-12 ? "complet" : part <= 0.3 + 1e-12 ? "partiel" : "estime",
      part_estimee: arrondi6(part),
      sources: [...parSource.values()].map(x => Object.assign({ type: x.type }, x.import_id ? { import_id: x.import_id } : {}, { part: arrondi6(x.v / total) })),
    };
  }

  /** Enveloppes dont un import déclare que l'historique remonte à l'ouverture : { <enveloppe>: true }. imports = lignes de historique_imports (camelCase du store ou
      snake_case de la base : id, enveloppe, resume.depuis_ouverture) ; un contrat désigné par sa ligne (enveloppe nulle) prend l'enveloppe des lignes de ses transactions. */
  function depuisOuverture(imports, tx, positions) {
    const out = {}, parId = new Map(liste(positions).filter(Boolean).map(p => [String(p.id), p]));
    const parImport = new Map();
    liste(tx).forEach(t => { const id = t && camel(t, "importId", "import_id"); if (id) (parImport.get(id) || parImport.set(id, []).get(id)).push(t); });
    liste(imports).forEach(i => {
      if (!i || !i.resume || i.resume.depuis_ouverture !== true) return;
      if (i.enveloppe) { out[i.enveloppe] = true; return; }
      (parImport.get(i.id) || []).forEach(t => {
        const pid = camel(t, "positionId", "position_id"), p = pid != null ? parId.get(String(pid)) : null, e = p ? p.envelope : t.enveloppe;
        if (e) out[e] = true;
      });
    });
    return out;
  }
  /** Soldes de fin de mois des comptes importés, rattachés à une ligne du bilan : [{ positionId, mois: "AAAA-MM", solde_debut, solde_fin, import_id }].
      comptes = historique_comptes (id, positionId, banqueCompteId), releves = historique_releves (compteId, mois, soldeDebut, soldeFin, importId), banqueComptes =
      comptes Powens (id, positionId) : un compte importé rattaché à un compte Powens prend la ligne de celui-ci quand il n'a pas la sienne. Formes camelCase ou snake_case. */
  function soldesMois(comptes, releves, banqueComptes) {
    const bq = new Map(liste(banqueComptes).filter(Boolean).map(b => [String(b.id), camel(b, "positionId", "position_id")]));
    const ligneDe = new Map();
    liste(comptes).forEach(c => {
      if (!c) return;
      let pid = camel(c, "positionId", "position_id");
      const b = camel(c, "banqueCompteId", "banque_compte_id");
      if (pid == null && b != null) pid = bq.get(String(b));
      if (pid != null) ligneDe.set(String(c.id), pid);
    });
    const out = [];
    liste(releves).forEach(r => {
      if (!r || !/^\d{4}-\d{2}/.test(String(r.mois))) return;
      const pid = ligneDe.get(String(camel(r, "compteId", "compte_id")));
      if (pid === undefined) return;
      const sd = camel(r, "soldeDebut", "solde_debut"), sf = camel(r, "soldeFin", "solde_fin");
      if (!fini(sd) && !fini(sf)) return;
      out.push({ positionId: pid, mois: String(r.mois).slice(0, 7), solde_debut: fini(sd) ? +sd : null, solde_fin: fini(sf) ? +sf : null, import_id: camel(r, "importId", "import_id") || null });
    });
    return out;
  }

  /** Reconstitue le patrimoine financier (et net) de chaque jour ou de chaque fin de mois jusqu'à la veille de `today`.
      o = { today, positions, scope = "foyer", cours: { <isin|symbole>: [{ date, cloture }] }, tx: [{ positionId, date, type, qty, price, amount, frais, enveloppe,
            importId, source, doublonDe }], comptes: [{ id, positionId, type, ignore }], operations: [{ compteId, date, montant }], operationsDepuis (1er jour lu),
            depuis (début voulu), jusqua (dernier jour voulu), horsFin = 0,
            pas = "jour" | "mois" (fin de mois, 20 ans au plus), releves: [{ positionId, date, valeur }] (relevés de valeur ; ceux des transactions de type releve
            comptent aussi), soldesMois: [{ positionId, mois: "AAAA-MM", solde_debut?, solde_fin?, import_id? }] (relevés bancaires importés),
            depuisOuverture: { <enveloppe>: true }, especesSuivies: { <enveloppe>: false } (coupe les espèces d'une enveloppe),
            qualites (défaut : vrai en pas "mois") : rend la qualité de chaque point, detailLignes : rend la valeur de chaque ligne à chaque point }
      → { points: [{ date, financier, net, nature?, detail?, lignes? }], debut, fin, drapeaux: { compositionActuelle, viaTransactions, constantes: { noms, montant },
          bancaires, courteHistoire, sansCours, cloturees, prixDesOrdres, parReleves, soldesImportes, especes }, recalageEspeces, qualites?: [{ date, qualite,
          part_estimee, sources }], raison? } ; points vides avec une `raison` quand rien ne se reconstitue.
      nature d'un point (pas "mois") : mesuree si tout est mesuré, constante si tout est tenu constant, estimee sinon. */
  function reconstituer(o) {
    const opt = o || {}, today = isoOk(opt.today) ? jj(opt.today) : iso(Date.now()), scope = opt.scope || "foyer", horsFin = fini(opt.horsFin) ? +opt.horsFin : 0;
    const mois = opt.pas === "mois";
    const vide = raison => ({ points: [], debut: null, fin: null, recalageEspeces: 0, drapeaux: { compositionActuelle: [], viaTransactions: [], constantes: { noms: [], montant: 0 },
      bancaires: [], courteHistoire: [], sansCours: [], cloturees: [], prixDesOrdres: [], parReleves: [], soldesImportes: [], especes: [] }, raison });
    const C = Calc;
    const toutes = liste(opt.positions).filter(p => p && typeof p === "object");
    const txs = liste(opt.tx).map(normTx).filter(t => t && t.date <= today);
    const txParPos = {};
    txs.forEach(t => { if (t.pid != null) (txParPos[t.pid] = txParPos[t.pid] || []).push(t); });
    /* périmètre : lignes comptées, plus les lignes clôturées qui ont des transactions (leur passé existe encore) */
    const lignes = toutes.filter(p => C.inScope(p, scope) && (C.counted(p) || (p.status === "clôturé" && (txParPos[p.id] || []).length)));
    if (!lignes.length) return vide("Aucun historique à reconstituer : aucune ligne dans ce périmètre.");
    const cours = opt.cours && typeof opt.cours === "object" ? opt.cours : {};
    const serieDe = p => {
      const cle = plat(p.isin) || plat(p.symbol);
      const pts = liste(cle ? cours[cle] : null).filter(c => c && isoOk(c.date) && fini(c.cloture) && +c.cloture > 0 && jj(c.date) < today)
        .map(c => ({ date: jj(c.date), cloture: +c.cloture }));
      return pts.every((c, i) => i === 0 || pts[i - 1].date <= c.date) ? pts : trier(pts, c => c.date); // déjà triée le plus souvent
    };
    const parId = new Map(toutes.map(p => [String(p.id), p]));
    const envDe = t => { if (t.pid != null) { const p = parId.get(String(t.pid)); if (p) return p.envelope; } return t.env; };
    /* ouvertures déclarées : zéro avant le premier mouvement de l'enveloppe */
    const depuisOuv = opt.depuisOuverture && typeof opt.depuisOuverture === "object" ? opt.depuisOuverture : {};
    const ouvKeys = new Set(Object.keys(depuisOuv).filter(k => depuisOuv[k]).map(cleEnv));
    const premierMvt = new Map();
    txs.forEach(t => {
      if (t.type === "releve" || t.type === "solde") return;
      const e = envDe(t);
      if (e == null) return;
      const k = cleEnv(e), v = premierMvt.get(k);
      if (v === undefined || t.date < v) premierMvt.set(k, t.date);
    });
    const ouvDe = p => (ouvKeys.has(cleEnv(p.envelope)) && premierMvt.has(cleEnv(p.envelope)) ? premierMvt.get(cleEnv(p.envelope)) : null);
    /* espèces suivies (D6) : une ligne d'espèces dans l'enveloppe, sauf coupure explicite */
    const suivies = opt.especesSuivies && typeof opt.especesSuivies === "object" ? opt.especesSuivies : {};
    const caisseDe = new Map();
    lignes.forEach(p => { if (ligneEspeces(p) && C.counted(p) && suivies[p.envelope] !== false && !caisseDe.has(cleEnv(p.envelope))) caisseDe.set(cleEnv(p.envelope), p); });
    /* relevés de valeur : explicites, et transactions de type releve portant une valeur */
    const relParPos = {};
    const ajouteReleve = (pid, date, valeur, imp) => { if (pid != null && isoOk(date) && fini(valeur) && jj(date) <= today) (relParPos[pid] = relParPos[pid] || []).push({ date: jj(date), valeur: +valeur, imp: imp || null }); };
    liste(opt.releves).forEach(r => { if (r) ajouteReleve(camel(r, "positionId", "position_id"), r.date, r.valeur, camel(r, "importId", "import_id")); });
    txs.forEach(t => { if (t.type === "releve" && t.amount != null && t.pid != null) ajouteReleve(t.pid, t.date, t.amount, t.imp); });
    Object.keys(relParPos).forEach(k => {
      const vus = new Set();
      relParPos[k] = trier(relParPos[k].filter(r => { const c = r.date + "|" + r.valeur; if (vus.has(c)) return false; vus.add(c); return true; }), r => r.date);
    });
    /* soldes de fin de mois importés */
    const soldesPar = {};
    liste(opt.soldesMois).forEach(s => {
      const pid = s && camel(s, "positionId", "position_id");
      if (pid == null || !/^\d{4}-\d{2}/.test(String(s.mois))) return;
      const m = String(s.mois).slice(0, 7), sd = camel(s, "soldeDebut", "solde_debut"), sf = camel(s, "soldeFin", "solde_fin"), imp = camel(s, "importId", "import_id") || null;
      const M = (soldesPar[pid] = soldesPar[pid] || new Map());
      if (fini(sf) && finDeMois(m) < today) M.set(finDeMois(m), { date: finDeMois(m), v: +sf, imp });
      if (fini(sd)) { const d0 = plusJours(m + "-01", -1); if (!M.has(d0)) M.set(d0, { date: d0, v: +sd, imp }); }
    });
    const comptesPar = {};
    liste(opt.comptes).forEach(c => { if (c && c.positionId != null && !c.ignore && c.type !== "credit") (comptesPar[c.positionId] = comptesPar[c.positionId] || []).push(c.id); });
    const opsPar = {};
    liste(opt.operations).forEach(x => { if (x && x.compteId != null && isoOk(x.date) && fini(x.montant) && jj(x.date) <= today) (opsPar[x.compteId] = opsPar[x.compteId] || []).push({ date: jj(x.date), montant: +x.montant }); });
    const opsDepuis = isoOk(opt.operationsDepuis) ? jj(opt.operationsDepuis) : null;

    const dr = vide().drapeaux, L = [], consts = [];
    let recalageEspeces = 0;
    /* ---- constructeurs de lignes : chacun rend { id, nom, premier (début des données), ev(d, out) } ; out = { v, n (nature), s (source) } ----
       ev est appelé avec des dates croissantes (les curseurs avancent), jamais deux fois la même. */
    function cotee(p, nom, s, ordres, tx) {
      const total = tx.reduce((a, t) => a + t.delta, 0), qty0 = C.counted(p) ? +p.qty : 0, ouv = ouvDe(p);
      let k = 0, c = 0, j = -1, jo = -1;
      const premierPrix = [s.length ? s[0].date : null, ordres.length ? ordres[0].date : null].filter(Boolean).sort()[0];
      return { id: p.id, nom, premier: premierPrix, premierPrix, ev(d, out) {
        while (k < tx.length && tx[k].date <= d) { c += tx[k].delta; k++; }
        if (ouv && d < ouv) { out.v = 0; out.n = MES; out.s = null; return; }
        while (j + 1 < s.length && s[j + 1].date <= d) j++;
        while (jo + 1 < ordres.length && ordres[jo + 1].date <= d) jo++;
        let prix, pn = MES;
        if (j >= 0) prix = s[j].cloture;
        else if (ordres.length) { prix = ordres[jo >= 0 ? jo : 0].price; pn = EST; } else { prix = s[0].cloture; pn = EST; }
        const qty = Math.max(0, qty0 - (total - c));
        const qn = tx.length === 0 || d < tx[0].date ? EST : MES;
        out.v = qty * prix;
        out.n = qn === MES && pn === MES ? MES : EST;
        out.s = tx.length ? srcTx(tx[k > 0 ? k - 1 : 0]) : SRC_COURS;
      } };
    }
    function especes(p, nom, rels) {
      const env = cleEnv(p.envelope), eff = [];
      txs.forEach(t => {
        const e = envDe(t);
        if (e == null || cleEnv(e) !== env || t.type === "releve") return;
        const x = effetEspeces(t, String(t.pid) === String(p.id));
        if (x !== 0) eff.push({ date: t.date, e: x, t });
      });
      const effs = trier(eff, x => x.date), cum = cumulateur(effs, x => x.e), totalEff = effs.reduce((a, x) => a + x.e, 0), ouv = ouvDe(p), v0 = C.val(p);
      recalageEspeces += v0 - totalEff;
      return { id: p.id, nom, premier: effs.length ? effs[0].date : null, ev(d, out) {
        if (ouv && d < ouv) { out.v = 0; out.n = MES; out.s = null; return; }
        const i = dernierAvant(rels, d);
        if (i >= 0) {
          out.v = rels[i].valeur + cum(d) - cum(rels[i].date); out.n = rels[i].date === d ? MES : EST;
          out.s = rels[i].imp ? { type: "versements", import_id: rels[i].imp } : SRC_SAISIE;
          return;
        }
        out.v = rels.length ? rels[0].valeur - (cum(rels[0].date) - cum(d)) : v0 - (totalEff - cum(d));
        out.n = effs.length && d >= effs[0].date ? MES : EST;
        const e = dernierAvant(effs, d);
        out.s = e >= 0 ? srcTx(effs[e].t) : effs.length ? srcTx(effs[0].t) : SRC_SAISIE;
      } };
    }
    /** Valeur interpolée entre deux ancres (fins de mois importées, puis le premier jour de la fenêtre lue ou aujourd'hui) ; avant la première : tenue. */
    function interpoler(ancres, d, out) {
      const i = dernierAvant(ancres, d);
      if (i < 0) { out.v = ancres[0].v; out.n = EST; out.s = ancres[0].src; return; }
      const a = ancres[i];
      if (a.date === d || i + 1 >= ancres.length) { out.v = a.v; out.n = a.date === d && a.mes ? MES : EST; out.s = a.src; return; }
      const b = ancres[i + 1], w = joursEntre(a.date, d) / joursEntre(a.date, b.date);
      out.v = a.v + (b.v - a.v) * w; out.n = EST; out.s = a.src;
    }
    function banque(p, nom, ops, soldes) {
      const v = C.val(p), total = ops.reduce((a, x) => a + x.montant, 0), debutOps = ops.length ? (opsDepuis ? plusJours(opsDepuis, -1) : plusJours(ops[0].date, -1)) : null;
      let ancres = null;
      if (soldes && soldes.size) {
        const borne = debutOps || today;
        ancres = trier([...soldes.values()].filter(a => a.date < borne).map(a => ({ date: a.date, v: a.v, mes: true, src: a.imp ? { type: "releves", import_id: a.imp } : SRC_SAISIE })), a => a.date);
        ancres.push(debutOps ? { date: debutOps, v: v - total, mes: true, src: SRC_POWENS } : { date: today, v, mes: false, src: SRC_SAISIE });
      }
      let j = 0, c = 0;
      return { id: p.id, nom, premier: ancres ? ancres[0].date : debutOps, ev(d, out) {
        if (ops.length && d >= debutOps) {
          while (j < ops.length && ops[j].date <= d) { c += ops[j].montant; j++; }
          out.v = v - (total - c); out.n = MES; out.s = SRC_POWENS; return;
        }
        if (ancres) { interpoler(ancres, d, out); return; }
        out.v = v - total; out.n = EST; out.s = SRC_POWENS; // avant la fenêtre lue : tenu constant, au solde du premier jour de la fenêtre
      } };
    }
    function parReleves(p, nom, tx, rels) {
      const flux = trier(tx.map(t => ({ date: t.date, f: fluxValeur(t), t })).filter(x => x.f !== 0), x => x.date);
      const cum = cumulateur(flux, x => x.f), totalFlux = flux.reduce((a, x) => a + x.f, 0), ouv = ouvDe(p), v0 = C.val(p), ouverte = ouvKeys.has(cleEnv(p.envelope));
      const premier = [flux.length ? flux[0].date : null, rels.length ? rels[0].date : null].filter(Boolean).sort()[0] || null;
      const srcF = d => { const e = dernierAvant(flux, d); return e >= 0 ? srcTx(flux[e].t) : flux.length ? srcTx(flux[0].t) : SRC_SAISIE; };
      const srcR = (r, d) => (r.imp ? { type: "versements", import_id: r.imp } : srcF(d));
      return { id: p.id, nom, premier, ev(d, out) {
        if (ouv && d < ouv) { out.v = 0; out.n = MES; out.s = null; return; }
        const i = dernierAvant(rels, d);
        if (i >= 0) { out.v = rels[i].valeur + cum(d) - cum(rels[i].date); out.n = rels[i].date === d ? MES : EST; out.s = srcR(rels[i], d); return; }
        out.n = EST;
        if (ouverte) { out.v = cum(d); out.s = srcF(d); return; }
        if (rels.length) { out.v = rels[0].valeur - (cum(rels[0].date) - cum(d)); out.s = srcR(rels[0], d); return; }
        out.v = v0 - (totalFlux - cum(d)); out.s = srcF(d);
      } };
    }

    lignes.forEach(p => {
      const nom = plat(p.name) || "Ligne sans nom", cloturee = p.status === "clôturé", tx = trier(txParPos[p.id] || [], t => t.date), rels = relParPos[p.id] || [];
      /* cotée : cours de la table, à défaut prix d'exécution des ordres */
      if (p.mode === "market" && (fini(p.qty) || cloturee)) {
        const s = serieDe(p), ordres = tx.filter(t => (t.type === "achat" || t.type === "vente") && t.price != null).map(t => ({ date: t.date, price: t.price }));
        if (s.length || ordres.length) {
          const mvts = tx.filter(t => t.delta !== 0);
          (mvts.length ? dr.viaTransactions : dr.compositionActuelle).push(nom);
          if (cloturee) dr.cloturees.push(nom);
          if (ordres.length && (!s.length || ordres[0].date < s[0].date)) dr.prixDesOrdres.push(nom);
          L.push(cotee(p, nom, s, ordres, mvts));
          return;
        }
        if (!cloturee) dr.sansCours.push(nom);
      }
      if (cloturee) return;
      const caisse = caisseDe.get(cleEnv(p.envelope));
      if (caisse === p && txs.some(t => { const e = envDe(t); return e != null && cleEnv(e) === cleEnv(p.envelope); })) { dr.especes.push(nom); L.push(especes(p, nom, rels)); return; }
      const ops = trier(liste(comptesPar[p.id]).flatMap(id => opsPar[id] || []), x => x.date), soldes = soldesPar[p.id];
      if (ops.length || (soldes && soldes.size)) {
        L.push(banque(p, nom, ops, soldes));
        if (ops.length) dr.bancaires.push(nom);
        if (soldes && soldes.size) dr.soldesImportes.push(nom);
        return;
      }
      if (rels.length || (ouvKeys.has(cleEnv(p.envelope)) && tx.some(t => fluxValeur(t) !== 0))) { dr.parReleves.push(nom); L.push(parReleves(p, nom, tx, rels)); return; }
      const v = C.val(p);
      consts.push({ nom, v });
      L.push({ id: p.id, nom, premier: null, constante: true, ev(d, out) { out.v = v; out.n = CST; out.s = SRC_SAISIE; } });
    });
    dr.constantes = { noms: consts.map(c => c.nom), montant: arrondi(consts.reduce((a, c) => a + c.v, 0)) };
    if (!L.some(l => !l.constante)) { const r = vide("Aucun historique de cours ni d'opérations bancaires pour ces lignes : rien à reconstituer."); r.drapeaux = dr; return r; }

    const plancher = plusJours(today, mois ? -JOURS_MOIS_MAX : -JOURS_MAX), voulu = isoOk(opt.depuis) ? jj(opt.depuis) : null;
    const premiers = L.map(l => l.premier).filter(Boolean);
    const premier = premiers.length ? premiers.reduce((a, b) => (a < b ? a : b)) : plancher;
    // pas "mois" avec un début voulu : on part de ce début, même avant les données (zéro avant l'ouverture, valeurs tenues sinon)
    const debut = mois && voulu ? (voulu > plancher ? voulu : plancher) : [premier, voulu || plancher, plancher].reduce((a, b) => (a > b ? a : b));
    const veille = plusJours(today, -1), fin = isoOk(opt.jusqua) && jj(opt.jusqua) < veille ? jj(opt.jusqua) : veille;
    if (debut > fin) { const r = vide("Aucun historique avant aujourd'hui."); r.drapeaux = dr; return r; }
    L.forEach(l => { if (l.premierPrix && l.premierPrix > debut) dr.courteHistoire.push(l.nom); });

    const dates = [];
    if (mois) { for (let d = finDeMois(debut); d <= fin; d = finDeMois(plusJours(d, 1))) dates.push(d); }
    else for (let d = debut; d <= fin; d = plusJours(d, 1)) dates.push(d);

    const avecQualite = opt.qualites != null ? !!opt.qualites : mois, detail = opt.detailLignes === true;
    const caisses = new Set(L.filter(l => dr.especes.includes(l.nom)).map(l => l.id)), out = { v: 0, n: MES, s: null };
    const points = [], qualites = [];
    dates.forEach(d => {
      let f = 0, caisseV = 0, nMes = 0, nEst = 0, nCst = 0;
      const contribs = avecQualite ? [] : null, lignesD = detail ? {} : null;
      L.forEach(l => {
        l.ev(d, out);
        f += out.v;
        if (out.v) {
          if (out.n === MES) nMes++; else if (out.n === CST) nCst++; else nEst++;
          if (contribs) contribs.push({ ligne: l.nom, valeur: out.v, nature: out.n, source: out.s || SRC_SAISIE });
        }
        if (caisses.has(l.id)) caisseV += out.v;
        if (lignesD) lignesD[l.id] = arrondi(out.v);
      });
      const pt = { date: d, financier: arrondi(f), net: arrondi(f + horsFin) };
      if (mois || avecQualite) pt.nature = nEst === 0 && nCst === 0 ? MES : nMes === 0 && nEst === 0 ? CST : EST;
      if (caisses.size) pt.detail = { titres: arrondi(f - caisseV), especes: arrondi(caisseV) };
      if (lignesD) pt.lignes = lignesD;
      if (contribs) qualites.push(Object.assign({ date: d }, qualite(contribs)));
      points.push(pt);
    });
    const res = { points, debut, fin, drapeaux: dr, recalageEspeces: arrondi(recalageEspeces) };
    if (avecQualite) res.qualites = qualites;
    return res;
  }

  /** Lignes de photos_reconstituees (spec § 4.5) à partir d'un résultat de reconstituer({ pas: "mois", detailLignes: true }) et des lignes du bilan.
      o = { avant (date de la première photo observée : aucune photo à cette date ni après), horsFin, max = 240 }.
      → [{ mois (1er du mois), date, total, p1, p2, financier, net, by_bloc: { p1: {…}, p2: {…} }, by_envelope, qualite, part_estimee, sources, methode }]
      La valeur de chaque ligne est répartie par personne et par poche comme take_snapshots (SQL) le fait pour la photo du jour. */
  function photos(res, positions, o) {
    const opt = o || {}, max = fini(opt.max) ? Math.max(1, +opt.max) : MOIS_MAX, horsFin = fini(opt.horsFin) ? +opt.horsFin : 0;
    const parId = new Map(liste(positions).filter(Boolean).map(p => [String(p.id), p]));
    const qual = new Map(liste(res && res.qualites).map(q => [q.date, q]));
    const out = [];
    liste(res && res.points).forEach(pt => {
      if (!pt || !pt.lignes || (isoOk(opt.avant) && pt.date >= jj(opt.avant))) return;
      let total = 0, p1 = 0, p2 = 0;
      const byBloc = { p1: {}, p2: {} }, byEnv = {};
      Object.keys(pt.lignes).forEach(id => {
        const p = parId.get(String(id)), v = +pt.lignes[id];
        if (!p || !isFinite(v)) return;
        total += v;
        if (p.owner === "p1") { p1 += v; byBloc.p1[p.bloc] = arrondi((byBloc.p1[p.bloc] || 0) + v); }
        else if (p.owner === "p2") { p2 += v; byBloc.p2[p.bloc] = arrondi((byBloc.p2[p.bloc] || 0) + v); }
        byEnv[p.envelope] = arrondi((byEnv[p.envelope] || 0) + v);
      });
      const q = qual.get(pt.date) || qualite([]);
      let sources = q.sources;
      if (sources.length > 30) { // 30 sources au plus : les plus petites sont regroupées en « saisie »
        const tri = sources.slice().sort((a, b) => b.part - a.part), reste = tri.slice(29).reduce((a, s) => a + s.part, 0);
        sources = tri.slice(0, 29).concat([{ type: "saisie", part: arrondi6(reste) }]);
      }
      out.push({ mois: pt.date.slice(0, 8) + "01", date: pt.date, total: arrondi(total), p1: arrondi(p1), p2: arrondi(p2), financier: arrondi(total), net: arrondi(total + horsFin),
        by_bloc: byBloc, by_envelope: byEnv, qualite: q.qualite, part_estimee: q.part_estimee, sources, methode: METHODE });
    });
    return out.slice(-max);
  }

  /** Fusionne l'observé et le reconstitué. observes = [{ date, net, live? }] (photos et point du jour), reconstruits = [{ date, net }].
      L'observé gagne : le reconstitué n'est gardé que strictement avant la première date observée. recaler (défaut vrai) : le
      reconstitué est décalé de l'écart entre la première observation et le dernier point reconstitué qui la précède (ou l'égale),
      pour une courbe sans cassure.
      → { points: [{ date, net, nature: "reconstitue" | "observe", live? }] triés, decalage, premiereObservee } */
  function fusionner(observes, reconstruits, opts) {
    const o = opts || {}, obs = trier(liste(observes).filter(p => p && isoOk(p.date) && fini(p.net)).map(p => Object.assign({}, p, { date: jj(p.date), net: +p.net })), p => p.date);
    const rec = trier(liste(reconstruits).filter(p => p && isoOk(p.date) && fini(p.net)).map(p => ({ date: jj(p.date), net: +p.net })), p => p.date);
    const premiere = obs.length ? obs[0].date : null;
    const avant = premiere ? rec.filter(p => p.date < premiere) : rec;
    let decalage = 0;
    if (premiere && o.recaler !== false && avant.length) {
      const jonction = rec.filter(p => p.date <= premiere).pop();
      if (jonction) decalage = arrondi(obs[0].net - jonction.net);
    }
    const points = avant.map(p => ({ date: p.date, net: arrondi(p.net + decalage), nature: "reconstitue" }))
      .concat(obs.map(p => Object.assign({}, p, { nature: "observe" })));
    return { points, decalage, premiereObservee: premiere };
  }

  return { reconstituer, fusionner, deltaTx, qualite, photos, depuisOuverture, soldesMois, plusJours, plusMois, joursEntre, finDeMois, JOURS_MAX, MOIS_MAX, METHODE };
});
});

export const Historique = charger("historique");
export const Calc = charger("calc");
