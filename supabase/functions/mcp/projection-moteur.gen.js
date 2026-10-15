// Fichier généré par scripts/gen-catalogue.mjs (npm run gen) : ne pas modifier à la main.
// Copie du moteur de projection de l'app (PROJ, docs/superpowers/specs/2026-10-14-proj-projection-design.md) : les modules purs de web/src
// (reperes, calendrier, calc, marche, plan, projection-outils, projection-fiscalite, projection-evenements, projection-credit, projection-donnees, projection-immo, projection) recopiés tels quels, évalués dans cet ordre. Aucune modification : un écart avec l'app est un bug du générateur.
const definitions = {}, modules = {};
function def(nom, fabrique) { definitions[nom] = fabrique; }
function charger(nom) {
  if (modules[nom]) return modules[nom].exports;
  const fabrique = definitions[nom];
  if (!fabrique) throw new Error("projection-moteur : module inconnu « " + nom + " »");
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
  /** Budget réel moyen des nb (3) derniers mois complets (mois en cours exclu), comptes courants seulement :
      revenus = entrées − sorties de « revenus » ; épargne = sorties − entrées de « epargne » (virements vers l'épargne et
      l'investissement) ; dépenses = sorties − entrées de toutes les autres catégories ; virements internes exclus.
      tauxEpargne = « Épargne versée » : versements d'épargne et d'investissement ÷ revenus (moyennes de la période ; même chiffre que lire_banque, banque.ts). « Capacité d'épargne » réelle
      (spec cp4 § 1.2, critère « Capacité d'épargne » de Santé) : capacite = revenus − dépenses, tauxCapacite = capacite ÷ revenus (l'épargne
      versée en est une partie, affichée à part). parCompte : vrai si chaque mois retenu est détaillé par compte
      (chiffres des seuls comptes courants) ; faux sinon (totaux de tous les comptes connectés : libellé « tous comptes connectés »).
      → { n, du, au, revenus, depenses, epargne, tauxEpargne, capacite, tauxCapacite, parCompte } ou null (interrupteur éteint, aucun mois
      complet). Même calcul dans le connecteur (budgetReel, index.ts). */
  function budgetReel(banque, auj, nb) {
    if (!banque || banque.actif === false) return null;
    const k = Number.isInteger(nb) && nb > 0 ? nb : 3;
    const courant = moisIso(auj == null ? new Date() : auj);
    const L = moisCourants(banque).filter(r => moisIso(r.mois) && moisIso(r.mois) < courant && !RE_INTERNE.test(sansAccent(r.categorie)));
    const retenus = [...new Set(L.map(r => moisIso(r.mois)))].sort().slice(-k);
    if (!retenus.length) return null;
    let rev = 0, dep = 0, ep = 0;
    L.filter(r => retenus.includes(moisIso(r.mois))).forEach(r => {
      const e = n(r.entrees), s = n(r.sorties), c = sansAccent(r.categorie);
      if (c === "revenus") rev += e - s; else if (c === "epargne") ep += s - e; else dep += s - e;
    });
    const det = moisDetailles(banque);
    const m = retenus.length, revenus = pos(rev) / m, depenses = pos(dep) / m, epargne = pos(ep) / m;
    return { n: m, du: retenus[0] + "-01", au: retenus[m - 1] + "-01", revenus, depenses, epargne, tauxEpargne: revenus > 0 ? epargne / revenus : null,
      capacite: revenus - depenses, tauxCapacite: revenus > 0 ? (revenus - depenses) / revenus : null, parCompte: retenus.every(x => det.has(x)) };
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
      sinon budget prévu. ctx = { banque, budget, profil, config, scope, auj } → { montant, source: "reel" | "prevu", reel? } ou null. */
  function depensesMensuelles(ctx) {
    const c = ctx || {}, sc = c.scope || "foyer";
    const r = sc === "foyer" ? budgetReel(c.banque, c.auj) : null;
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
    const d = depensesMensuelles({ banque: s.banque, budget: s.budget, profil: s.profil, config: s.config, scope: "foyer", auj: jour });
    if (!d) return null;
    const seuil = SEUIL_DORT * d.montant, m0 = moisIso(jour);
    const blocCourant = p => RE_COURANT.test(sansAccent(p.bloc));
    const blocs = [...new Set(courants.filter(blocCourant).map(p => p.bloc))];
    const envsMelees = new Set(courants.filter(blocCourant).map(p => p.envelope));
    const envs = [...new Set(courants.filter(p => !blocCourant(p) && p.envelope && !envsMelees.has(p.envelope)).map(p => p.envelope))];
    const mesurees = courants.filter(p => blocs.includes(p.bloc) || envs.includes(p.envelope));
    if (!mesurees.length) return null;
    const parBloc = x => x && (x.byBloc || x.by_bloc), parEnv = x => x && (x.byEnvelope || x.by_envelope);
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
    comptesCourants, moisCourants, budgetReel, periodeReel, doublonsProbables, depensesPrevues, depensesMensuelles, reserveMois, matelasDisponible, argentQuiDort,
    val, counted, inScope, financier, poche, aRecevoir, part, partCredit, immobilier, dettes, mensualites, creditsEnCours,
    autresActifs, patrimoine, brutRate, salaireNetMensuel, revenusFoyer, matelas, apportDisponible, deNom, valider };
});
});

/* ---------- web/src/marche.js ---------- */
def("marche", function (module, exports, require) {
/* Marché : statistiques historiques de référence par classe d'actifs, corrélations simplifiées et crises de référence.
   Données embarquées et sourcées (pas de recherche en direct). Chiffres nominaux en euros, arrondis, volontairement prudents :
   ce sont des ordres de grandeur pédagogiques, pas des prévisions. Aucun accès au DOM.
   S'appuie sur Calc (calc.js) pour le rattachement poche → classe. */
(function (root, factory) {
  const Calc = typeof module === "object" && module.exports ? require("./calc.js") : root.Calc;
  const api = factory(Calc);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Marche = api;
})(typeof self !== "undefined" ? self : this, function (Calc) {
  /* Pour chaque classe : periode (années couvertes par les statistiques, null si non précisée) et verifie_le (null : pas de revérification datée), rendementLong (% nominal par an, longue période), volatilite (% annualisée),
     pireBaisse (% du sommet au creux, négatif), episodePireBaisse, pireAnnee (% sur une année civile), anneePire, source. */
  const CLASSES = {
    actions: {
      label: "Actions (monde développé)",
      rendementLong: 7, volatilite: 15, pireBaisse: -55, episodePireBaisse: "2007-2009", pireAnnee: -38, anneePire: 2008,
      source: "MSCI World NR EUR 1970-2025, MSCI ; Jordà et al., « The Rate of Return on Everything », QJE 2019 ; 2008 : −38 %",
      periode: "1970-2025", verifie_le: null, /* période de calcul des statistiques ; verifie_le : non revérifié depuis SP2 (PROJ tâche 2), valeurs inchangées */
    },
    small_caps: {
      label: "Actions de petites entreprises (small caps)",
      rendementLong: 7.5, volatilite: 20, pireBaisse: -60, episodePireBaisse: "2007-2009", pireAnnee: -40, anneePire: 2008,
      source: "MSCI World Small Cap NR 2001-2025, MSCI ; Fama et French (prime de taille, États-Unis 1926-2024)",
      periode: "2001-2025", verifie_le: null, /* période de calcul des statistiques ; verifie_le : non revérifié depuis SP2 (PROJ tâche 2), valeurs inchangées */
    },
    emergents: {
      label: "Actions des pays émergents",
      rendementLong: 6.5, volatilite: 20, pireBaisse: -60, episodePireBaisse: "2007-2009", pireAnnee: -50, anneePire: 2008,
      source: "MSCI Emerging Markets NR 1988-2025, MSCI ; 2008 : environ −50 % en euros",
      periode: "1988-2025", verifie_le: null, /* période de calcul des statistiques ; verifie_le : non revérifié depuis SP2 (PROJ tâche 2), valeurs inchangées */
    },
    levier: {
      label: "Produits à effet de levier (ETF ×2 quotidien)",
      rendementLong: 9, volatilite: 45, pireBaisse: -85, episodePireBaisse: "2000-2002 (reconstitution)", pireAnnee: -60, anneePire: 2022,
      source: "Nasdaq-100 levier ×2 quotidien : reconstitutions −85 % à −95 % sur 2000-2002, environ −60 % en 2022 (ProShares Ultra QQQ) ; " +
        "volatilité ≈ 2 × celle de l'indice, avec l'effet de recalibrage quotidien qui érode la performance en marché agité",
      periode: "2000-2022 (reconstitutions)", verifie_le: null, /* période de calcul des statistiques ; verifie_le : non revérifié depuis SP2 (PROJ tâche 2), valeurs inchangées */
    },
    obligations: {
      label: "Obligations (zone euro)",
      rendementLong: 3.5, volatilite: 5, pireBaisse: -17, episodePireBaisse: "2021-2022", pireAnnee: -17, anneePire: 2022,
      source: "Indice obligataire euro agrégé, Bloomberg Euro Aggregate, 1999-2025 ; 2022 : −17 % (remontée des taux)",
      periode: "1999-2025", verifie_le: null, /* période de calcul des statistiques ; verifie_le : non revérifié depuis SP2 (PROJ tâche 2), valeurs inchangées */
    },
    immobilier: {
      label: "Immobilier (SCPI, pierre)",
      rendementLong: 4.5, volatilite: 6, pireBaisse: -20, episodePireBaisse: "1991-1997 et 2023-2024", pireAnnee: -10, anneePire: 2024,
      source: "IEIF pour les SCPI : pire baisse du prix de part ≈ −20 % (1991-1997 et 2023-2024) ; ASPIM ; Notaires de France / INSEE pour la pierre. " +
        "Volatilité lissée par la valorisation par expertise, le risque réel est plus élevé que le chiffre affiché",
      periode: "1991-2024", verifie_le: null, /* période de calcul des statistiques ; verifie_le : non revérifié depuis SP2 (PROJ tâche 2), valeurs inchangées */
    },
    monetaire: {
      label: "Monétaire et livrets",
      rendementLong: 1.5, volatilite: 0.5, pireBaisse: 0, episodePireBaisse: "aucune baisse nominale (érosion par l'inflation possible)", pireAnnee: 0, anneePire: null,
      source: "Livret A : Banque de France (taux réglementé 0,5 % à 3 %, 2015-2025) ; €STR / Eonia, BCE, 1999-2025",
      periode: "1999-2025", verifie_le: null, /* période de calcul des statistiques ; verifie_le : non revérifié depuis SP2 (PROJ tâche 2), valeurs inchangées */
    },
    fonds_euros: {
      label: "Fonds euros",
      rendementLong: 2.5, volatilite: 0.5, pireBaisse: 0, episodePireBaisse: "aucune baisse (capital garanti par l'assureur)", pireAnnee: 0, anneePire: null,
      source: "Fonds euros : ACPR / France Assureurs, rendement moyen 1,3–2,5 % sur 2015-2024, capital garanti",
      periode: "2015-2024", verifie_le: null, /* période de calcul des statistiques ; verifie_le : non revérifié depuis SP2 (PROJ tâche 2), valeurs inchangées */
    },
    or: {
      label: "Or",
      rendementLong: 4, volatilite: 15, pireBaisse: -45, episodePireBaisse: "1980-1985", pireAnnee: -30, anneePire: 2013,
      source: "Or en euros : LBMA (cours de référence), −45 % sur 1980-1985 ; 2013 : environ −30 % en euros",
      periode: null, verifie_le: null, /* période de calcul des statistiques ; verifie_le : non revérifié depuis SP2 (PROJ tâche 2), valeurs inchangées */
    },
    crypto: {
      label: "Cryptoactifs",
      rendementLong: 10, volatilite: 70, pireBaisse: -80, episodePireBaisse: "2017-2018 et 2021-2022", pireAnnee: -73, anneePire: 2018,
      source: "Bitcoin : −84 % en 2017-2018, −77 % en 2021-2022 (CoinMarketCap) ; 2018 : −73 %. Historique court (depuis 2010), " +
        "rendement long très incertain : hypothèse prudente",
      periode: "depuis 2010", verifie_le: null, /* période de calcul des statistiques ; verifie_le : non revérifié depuis SP2 (PROJ tâche 2), valeurs inchangées */
    },
    autres: {
      label: "Autres (non classé)",
      rendementLong: 4, volatilite: 12, pireBaisse: -35, episodePireBaisse: "2007-2009 (hypothèse)", pireAnnee: -20, anneePire: 2008,
      source: "Hypothèse prudente Boussole pour un actif non classé, calée sur un fonds diversifié (mi-actions, mi-obligations) : " +
        "Morningstar, catégorie « allocation flexible EUR », 2008",
      periode: null, verifie_le: null, /* période de calcul des statistiques ; verifie_le : non revérifié depuis SP2 (PROJ tâche 2), valeurs inchangées */
    },
  };
  const CLES = Object.keys(CLASSES);

  /* Corrélations simplifiées entre classes (une seule valeur par paire, symétrique, diagonale à 1) :
     - famille actions (actions, small caps, émergents, levier) très corrélée entre elle (0,8 à 0,95) ;
     - obligations et or peu corrélés aux actions (0,1) ; crypto moyennement (0,4) ; immobilier à moitié (0,5) ;
     - monétaire et fonds euros : 0 avec tout (valeur quasi constante) ;
     - « autres » traité comme un fonds diversifié (0,5 avec les actions).
     Ordres de grandeur sur 2000-2025 (rendements mensuels en euros), arrondis ; la matrice reste semi-définie positive. */
  const PAIRES = {
    "actions|small_caps": 0.9, "actions|emergents": 0.85, "actions|levier": 0.9,
    "small_caps|emergents": 0.8, "small_caps|levier": 0.85, "emergents|levier": 0.8,
    "actions|obligations": 0.1, "small_caps|obligations": 0.1, "emergents|obligations": 0.1, "levier|obligations": 0.1,
    "actions|or": 0.1, "small_caps|or": 0.1, "emergents|or": 0.1, "levier|or": 0.1,
    "actions|crypto": 0.4, "small_caps|crypto": 0.4, "emergents|crypto": 0.4, "levier|crypto": 0.4,
    "actions|immobilier": 0.5, "small_caps|immobilier": 0.5, "emergents|immobilier": 0.5, "levier|immobilier": 0.5,
    "actions|autres": 0.5, "small_caps|autres": 0.5, "emergents|autres": 0.5, "levier|autres": 0.5,
    "obligations|immobilier": 0.3, "obligations|or": 0.2, "obligations|crypto": 0, "obligations|autres": 0.3,
    "immobilier|or": 0.1, "immobilier|crypto": 0.2, "immobilier|autres": 0.3,
    "or|crypto": 0.1, "or|autres": 0.1, "crypto|autres": 0.2,
  };
  function correlation(a, b) {
    if (a === b) return 1;
    const v = PAIRES[a + "|" + b];
    if (v != null) return v;
    const w = PAIRES[b + "|" + a];
    return w != null ? w : 0; /* monétaire et fonds euros : 0 avec tout */
  }
  const CORRELATIONS = {};
  CLES.forEach(a => { CORRELATIONS[a] = {}; CLES.forEach(b => { CORRELATIONS[a][b] = correlation(a, b); }); });

  /* Crises de référence (utilisées par le sous-projet Avenir) : choc nominal cumulé approximatif par classe, en %, du sommet au creux
     des actions, en euros. Le rendement perçu pendant la crise par le monétaire et les fonds euros est négligé (0).
     proxy : classe qui n'existait pas (ou sans indice) à l'époque, remplacée par une hypothèse prudente. */
  const SOURCE_CRISES = "MSCI World / Small Cap / Emerging Markets NR EUR (MSCI) ; Bloomberg Euro Aggregate ; LBMA (or) ; IEIF (SCPI) ; " +
    "CoinMarketCap (bitcoin) ; reconstitutions Boussole pour le levier ×2 quotidien";
  const CRISES = {
    dotcom_2000: {
      label: "Bulle internet (2000-2002)", debut: "2000-03", fin: "2002-10",
      description: "Éclatement de la bulle technologique : les actions mondiales perdent plus de la moitié, le Nasdaq plus de 80 %.",
      chocs: { actions: -55, small_caps: -30, emergents: -45, levier: -95, obligations: 15, immobilier: 10, monetaire: 0, fonds_euros: 0, or: 5, crypto: -70, autres: -30 },
      proxy: { crypto: true }, source: SOURCE_CRISES,
    },
    gfc_2008: {
      label: "Crise financière (2007-2009)", debut: "2007-10", fin: "2009-03",
      description: "Crise des subprimes puis faillite de Lehman Brothers : les actions mondiales perdent environ 55 % en 17 mois.",
      chocs: { actions: -55, small_caps: -60, emergents: -60, levier: -85, obligations: 5, immobilier: -15, monetaire: 0, fonds_euros: 0, or: 15, crypto: -70, autres: -35 },
      proxy: { crypto: true }, source: SOURCE_CRISES,
    },
    covid_2020: {
      label: "Covid (2020)", debut: "2020-02", fin: "2020-03",
      description: "Krach éclair du confinement : un tiers de baisse en cinq semaines, effacée en quelques mois.",
      chocs: { actions: -34, small_caps: -40, emergents: -32, levier: -50, obligations: -3, immobilier: -5, monetaire: 0, fonds_euros: 0, or: -3, crypto: -50, autres: -20 },
      proxy: {}, source: SOURCE_CRISES,
    },
    taux_2022: {
      label: "Remontée des taux (2022)", debut: "2022-01", fin: "2022-10",
      description: "Retour de l'inflation et hausse rapide des taux : actions et obligations baissent ensemble, cas rare.",
      chocs: { actions: -20, small_caps: -25, emergents: -25, levier: -60, obligations: -17, immobilier: -5, monetaire: 0, fonds_euros: 0, or: 5, crypto: -65, autres: -15 },
      proxy: {}, source: SOURCE_CRISES,
    },
    inflation_1973: {
      label: "Choc pétrolier et inflation (1973-1974)", debut: "1973-01", fin: "1974-12",
      description: "Premier choc pétrolier : actions en forte baisse, inflation à deux chiffres qui ronge aussi l'épargne sans risque (perte réelle).",
      chocs: { actions: -45, small_caps: -55, emergents: -50, levier: -80, obligations: -10, immobilier: -10, monetaire: 0, fonds_euros: 0, or: 100, crypto: -70, autres: -30 },
      proxy: { crypto: true, emergents: true, levier: true }, source: SOURCE_CRISES + " ; Dimson, Marsh et Staunton (1973-1974)",
    },
  };

  /* ---------- rattachement d'une position à une classe de risque ---------- */
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  /* « 2x », « x2 », « ×3 », « levier », « leveraged », « daily 2x »… */
  const LEVIER = /(^|[^a-z0-9])([23] ?[x×]|[x×] ?[23])([^a-z0-9]|$)|levier|leverag/;
  const SMALL = /small ?caps?|petites? cap|russell 2000/;
  const EMERG = /emergent|emerging|\bem\b|msci em\b/;

  /** Classe de risque d'une position : `levier` si le nom ou la poche l'indique, sinon la classe de Calc
      (surcharge comprise), affinée en small caps ou émergents pour les actions.
      Une surcharge explicite de la poche l'emporte sur la détection faite sur la poche ; le levier écrit dans le nom
      de la ligne reste prioritaire (c'est une propriété du produit, pas de la poche). */
  function classeRisque(position, surcharge) {
    const p = position || {}, bloc = p.bloc, nom = norm(p.name), poche = norm(bloc);
    if (LEVIER.test(nom)) return "levier";
    const surchargee = surcharge && bloc in surcharge;
    if (!surchargee && LEVIER.test(poche)) return "levier";
    const base = Calc.classe(bloc, surcharge);
    if (surchargee && CLASSES[base] && base !== "actions") return base;
    if (base === "actions") {
      const txt = poche + " " + nom;
      if (SMALL.test(txt)) return "small_caps";
      if (EMERG.test(txt)) return "emergents";
    }
    return CLASSES[base] ? base : "autres";
  }

  return { CLASSES, CLES, CORRELATIONS, correlation, CRISES, classeRisque };
});
});

/* ---------- web/src/plan.js ---------- */
def("plan", function (module, exports, require) {
/* Plan : budget, objectifs, projection et score de santé. Calculs purs, aucun accès au DOM.
   S'appuie sur Calc (calc.js) pour les positions et le profil. */
(function (root, factory) {
  const Calc = typeof module === "object" && module.exports ? require("./calc.js") : root.Calc;
  const api = factory(Calc);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Plan = api;
})(typeof self !== "undefined" ? self : this, function (Calc) {
  const n = v => (isFinite(+v) && v !== null && v !== "" ? +v : 0);
  const pos = v => Math.max(0, n(v));
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const EPS = 1e-9;

  /** Rendements annuels attendus par poche, en % : central, pessimiste, optimiste (indicatifs). */
  const RENDEMENTS = {
    "Monde": { central: 6, pessimiste: 3, optimiste: 8.5 },
    "Europe": { central: 5.5, pessimiste: 2.5, optimiste: 8 },
    "Asie": { central: 6, pessimiste: 2, optimiste: 9 },
    "Nasdaq 2x": { central: 9, pessimiste: -2, optimiste: 16 },
    "Convictions tech": { central: 7, pessimiste: 0, optimiste: 12 },
    "Crypto": { central: 5, pessimiste: -20, optimiste: 25 },
    "SCPI": { central: 4, pessimiste: 2, optimiste: 5 },
    "Protection": { central: 2.5, pessimiste: 1.5, optimiste: 3.5 },
    "Obligations": { central: 3, pessimiste: 1.5, optimiste: 4 },
    "Épargne": { central: 2.4, pessimiste: 1.7, optimiste: 3 },
    "_autre": { central: 4, pessimiste: 1.5, optimiste: 6 },
  };
  /* Alias : les données de démonstration nomment la poche « Convictions ». */
  RENDEMENTS["Convictions"] = RENDEMENTS["Convictions tech"];
  const SCENARIOS = ["central", "pessimiste", "optimiste"];

  /** Repère de patrimoine net, en années de revenus, par tranche d'âge (clés de la toise). */
  const REPERES_AGE = { u30: 0.5, a30: 1, a40: 3, a50: 6, a60: 8, a70: 10 };

  /* ---------- dates (sans fuseau : AAAA-MM-JJ) ---------- */
  function ymd(d) {
    if (d == null) d = new Date();
    if (d instanceof Date) return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
    const s = String(d).slice(0, 10).split("-").map(Number);
    return { y: s[0], m: (s[1] || 1) - 1, d: s[2] || 1 };
  }
  const dernierJour = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const tauxMensuel = tauxAnnuel => Math.pow(1 + n(tauxAnnuel) / 100, 1 / 12) - 1;

  /** Montant mensuel d'une ligne de budget (fréquence « an » ramenée au mois). */
  function mensuel(ligne) {
    const m = pos(ligne && ligne.montant);
    return ligne && ligne.frequence === "an" ? m / 12 : m;
  }

  /* Part d'une ligne de budget dans le périmètre : sans titulaire = commun (moitié pour p1 / p2). */
  const partLigne = (l, scope) => Calc.partCredit(scope, l.owner === "p1" || l.owner === "p2" ? l.owner : "commun");

  /** Totaux mensuels du budget : revenus (profil + lignes), dépenses (lignes + mensualités), épargne, reste, capacité d'épargne (tauxEpargne : même base que Plan.capaciteEpargne). */
  function budgetTotaux(lignes, profil, scope) {
    const L = (Array.isArray(lignes) ? lignes : []).filter(Boolean);
    const de = type => L.filter(l => l.type === type);
    const m = l => mensuel(l) * partLigne(l, scope);
    const revenusProfil = Calc.revenusFoyer(profil, scope);
    const revenusLignes = sum(de("revenu"), m);
    const depensesLignes = sum(de("depense"), m);
    const mensualites = Calc.mensualites(profil, scope);
    const epargne = sum(de("epargne"), m);
    const revenus = revenusProfil + revenusLignes;
    const depenses = depensesLignes + mensualites;
    const reste = revenus - depenses - epargne;
    const parCategorie = {};
    de("depense").forEach(l => {
      const c = l.categorie || "Autres";
      parCategorie[c] = (parCategorie[c] || 0) + m(l);
    });
    if (mensualites > 0) parCategorie["Crédits"] = (parCategorie["Crédits"] || 0) + mensualites;
    return {
      revenusProfil, revenusLignes, revenus, depensesLignes, mensualites, depenses, epargne, reste,
      tauxEpargne: revenus > 0 ? (epargne + Math.max(0, reste)) / revenus : null,
      parCategorie,
    };
  }

  /** Versement constant de fin de mois pour passer de « deja » à « cible » en « mois » mois au taux annuel donné (%). */
  function effortMensuel(cible, deja, mois, tauxAnnuel) {
    const c = n(cible), d = n(deja), k = Math.floor(n(mois));
    if (k <= 0) return c > d ? Infinity : 0;
    const r = tauxMensuel(tauxAnnuel);
    if (Math.abs(r) < EPS) return Math.max(0, (c - d) / k);
    const f = Math.pow(1 + r, k);
    return Math.max(0, (c - d * f) * r / (f - 1));
  }

  /** Valeur capitalisée après « mois » mois : capital de départ + versements de fin de mois. */
  function valeurFuture(deja, versement, mois, tauxAnnuel) {
    const d = n(deja), v = n(versement), k = Math.max(0, Math.floor(n(mois)));
    const r = tauxMensuel(tauxAnnuel);
    if (Math.abs(r) < EPS) return d + v * k;
    const f = Math.pow(1 + r, k);
    return d * f + v * (f - 1) / r;
  }

  /** Nombre de mois entiers entre deux dates (arrondi par défaut, jamais négatif ; fin de mois = mois complet). */
  function moisEntre(dateA, dateB) {
    const a = ymd(dateA), b = ymd(dateB);
    let k = (b.y - a.y) * 12 + (b.m - a.m);
    if (b.d < a.d && b.d < dernierJour(b.y, b.m)) k -= 1;
    return Math.max(0, k);
  }

  /** Date (fin du mois) à laquelle la cible est atteinte au rythme donné ; date de départ si déjà atteinte ; null au-delà de 60 ans. */
  function dateAtteinte(cible, deja, versement, tauxAnnuel, depuis) {
    const c = n(cible), v = n(versement), r = tauxMensuel(tauxAnnuel), t = ymd(depuis);
    let val = n(deja);
    if (val >= c - EPS) return iso(t.y, t.m, t.d);
    for (let k = 1; k <= 720; k++) {
      val = val * (1 + r) + v;
      if (val >= c - 1e-6) return iso(t.y, t.m + k, dernierJour(t.y, t.m + k));
    }
    return null;
  }

  /** Montant déjà mis de côté pour un objectif : saisi, ou somme des poches / enveloppes rattachées. */
  function dejaObjectif(obj, positions, scope) {
    if (!obj) return 0;
    if (obj.source !== "poches") return pos(obj.deja);
    const poches = Array.isArray(obj.poches) ? obj.poches : [];
    const env = Array.isArray(obj.enveloppes) ? obj.enveloppes : [];
    const qui = titulaireObjectif(obj);
    return sum((positions || []).filter(p => Calc.inScope(p, scope || "foyer") && Calc.counted(p) && (!qui || p.owner === qui) &&
      (poches.includes(p.bloc) || env.includes(p.envelope))), Calc.val);
  }

  const SCORE_MIN_CRITERES = 3;

  /** Capacité d'épargne mensuelle : épargne prévue + reste positif (même base que tauxEpargne de budgetTotaux). */
  const capaciteEpargne = t => t ? pos(t.epargne) + Math.max(0, +t.reste || 0) : 0;

  /** Répartit l'argent des poches entre objectifs, en cascade par priorité : une même ligne ne finance jamais
      deux objectifs à la fois. Renvoie { [id]: montant déjà affecté }. Les objectifs « saisis » gardent leur montant. */
  function affecterDeja(objectifs, positions, scope) {
    const reste = (positions || []).filter(p => Calc.inScope(p, scope || "foyer") && Calc.counted(p)).map(p => ({ p, v: Calc.val(p) }));
    const ordre = (objectifs || []).slice().sort((a, b) =>
      ((a.priorite ?? Infinity) - (b.priorite ?? Infinity)) || String(dateCible(a) || "9999").localeCompare(String(dateCible(b) || "9999")));
    const out = {};
    ordre.forEach(o => {
      if (o.source !== "poches") { out[o.id] = pos(o.deja); return; }
      const poches = Array.isArray(o.poches) ? o.poches : [], env = Array.isArray(o.enveloppes) ? o.enveloppes : [], qui = titulaireObjectif(o);
      let besoin = pos(o.cible), pris = 0;
      reste.forEach(r => {
        if (besoin <= 0 || r.v <= 0 || !(poches.includes(r.p.bloc) || env.includes(r.p.envelope)) || (qui && r.p.owner !== qui)) return;
        const t = Math.min(r.v, besoin); r.v -= t; besoin -= t; pris += t;
      });
      out[o.id] = Math.round(pris * 100) / 100;
    });
    return out;
  }

  /** Personne d'un objectif (titulaire, owner ou personne : p1 / p2), ou null pour le foyer. La table objectifs n'a pas de colonne
      titulaire : aujourd'hui tout objectif est celui du foyer ; la lecture reste tolérante si un champ de ce nom apparaît. Même règle
      dans le connecteur (titulaireObjectif, index.ts). */
  const titulaireObjectif = o => { const v = o && (o.titulaire || o.owner || o.personne); return v === "p1" || v === "p2" ? v : null; };

  /* Date cible d'un objectif : forme du store (dateCible) ou colonne SQL (date_cible). */
  const dateCible = o => o.dateCible || o.date_cible || null;

  /* Effort mensuel requis pour un objectif à une date donnée (0 si pas de date). */
  function effortObjectif(obj, deja, today) {
    if (!dateCible(obj)) return { mois: null, effort: 0 };
    const mois = moisEntre(today, dateCible(obj));
    return { mois, effort: effortMensuel(pos(obj.cible), deja, mois, obj.rendement) };
  }
  const datePassee = (date, today) => {
    const a = ymd(date), b = ymd(today);
    return iso(a.y, a.m, a.d) < iso(b.y, b.m, b.d);
  };

  /** Situation d'un objectif : progression, effort requis, date d'atteinte au versement alloué, statut. */
  function statutObjectif(obj, ctx) {
    const c = ctx || {}, today = c.today == null ? new Date() : c.today;
    const cible = pos(obj.cible);
    const deja = c.deja != null ? pos(c.deja) : dejaObjectif(obj, c.positions, c.scope);
    const versementAlloue = pos(c.versementAlloue);
    const { mois, effort } = effortObjectif(obj, deja, today);
    const atteinte = dateAtteinte(cible, deja, versementAlloue, obj.rendement, today);
    const date = dateCible(obj);
    let statut;
    if (deja >= cible) statut = "atteint";
    else if (date && (datePassee(date, today) || !isFinite(effort))) statut = "hors_portee";
    else if (!date) statut = atteinte ? "dans_les_temps" : "hors_portee";
    else if (effort <= 0 || versementAlloue >= 1.1 * effort - EPS) statut = "avance";
    else if (versementAlloue >= 0.95 * effort - EPS) statut = "dans_les_temps";
    else statut = "retard";
    return { deja, progression: cible > 0 ? Math.min(1, deja / cible) : 1, mois, effort, versementAlloue, atteinte, statut };
  }

  /** Répartit l'épargne mensuelle entre objectifs : priorité croissante, puis échéance la plus proche ; le surplus va au dernier objectif en cours. */
  function repartirEpargne(objectifs, epargneMensuelle, ctx) {
    const c = ctx || {}, today = c.today == null ? new Date() : c.today;
    const cle = o => (dateCible(o) ? String(dateCible(o)).slice(0, 10) : "9999-12-31");
    const liste = (objectifs || []).map((o, i) => {
      const deja = dejaObjectif(o, c.positions, c.scope);
      return { o, i, effort: deja >= pos(o.cible) ? 0 : effortObjectif(o, deja, today).effort };
    }).sort((a, b) => (n(a.o.priorite ?? Infinity) - n(b.o.priorite ?? Infinity)) ||
      (cle(a.o) < cle(b.o) ? -1 : cle(a.o) > cle(b.o) ? 1 : 0) || a.i - b.i);
    const out = {};
    let reste = pos(epargneMensuelle);
    liste.forEach(x => {
      const m = Math.min(x.effort, reste);
      out[x.o.id] = m;
      reste -= m;
    });
    if (reste > 0 && liste.length) {
      const enCours = liste.filter(x => x.effort > 0);
      const dernier = (enCours.length ? enCours : liste)[(enCours.length ? enCours : liste).length - 1];
      out[dernier.o.id] += reste;
    }
    return out;
  }

  /** Projection du patrimoine financier sur N années, trois scénarios, versement réparti comme le portefeuille actuel.
      Un point par année (annees, central, pessimiste, optimiste, parBloc). Option `mensuel: true` : ajoute `mensuel` = { central,
      pessimiste, optimiste }, une valeur par mois de 0 à 12 × N (le mois 12 k est le point annuel k), pour les courbes lisses. */
  function projection(opts) {
    const o = opts || {}, scope = o.scope || "foyer", R = o.rendements || RENDEMENTS;
    const N = Math.max(0, Math.floor(o.annees == null ? 30 : n(o.annees)));
    const versement = n(o.versementMensuel);
    const capital = {};
    (o.positions || []).filter(p => Calc.inScope(p, scope) && Calc.counted(p)).forEach(p => {
      const b = p.bloc || "_autre";
      capital[b] = (capital[b] || 0) + Calc.val(p);
    });
    const total = sum(Object.values(capital), pos);
    if (total <= 0) capital._autre = capital._autre || 0;
    const blocs = Object.keys(capital);
    const poids = b => (total > 0 ? pos(capital[b]) / total : b === "_autre" ? 1 : 0);
    const taux = b => R[b] || R._autre || RENDEMENTS._autre;

    const res = { annees: Array.from({ length: N + 1 }, (_, i) => i), parBloc: {} };
    SCENARIOS.forEach(s => { res[s] = new Array(N + 1).fill(0); });
    if (o.mensuel === true) { res.mensuel = {}; SCENARIOS.forEach(s => { res.mensuel[s] = new Array(N * 12 + 1).fill(0); }); }
    blocs.forEach(b => {
      const pb = { capital: capital[b], poids: poids(b) };
      SCENARIOS.forEach(s => {
        const r = tauxMensuel(taux(b)[s]), v = versement * pb.poids, serie = [];
        let val = capital[b];
        serie.push(val);
        if (res.mensuel) res.mensuel[s][0] += val;
        for (let k = 1; k <= N * 12; k++) {
          val = val * (1 + r) + v;
          if (k % 12 === 0) serie.push(val);
          if (res.mensuel) res.mensuel[s][k] += val;
        }
        serie.forEach((x, i) => { res[s][i] += x; });
        pb[s] = serie.map(Math.round);
      });
      res.parBloc[b] = pb;
    });
    SCENARIOS.forEach(s => { res[s] = res[s].map(Math.round); if (res.mensuel) res.mensuel[s] = res.mensuel[s].map(Math.round); });
    return res;
  }

  /* ---------- score de santé ---------- */
  /* Interpolation linéaire par morceaux, bornée aux extrémités. */
  function interp(x, pts) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return pts[pts.length - 1][1];
  }
  function fr(x, dec) {
    const s = Math.abs(x).toFixed(dec == null ? 1 : dec).replace(/\.0+$/, "").replace(".", ",");
    return (x < 0 ? "−" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  const pct = x => fr(x * 100, 0) + " %";

  /* ---------- contrat de critère (spec cp4 § 3) ----------
     Chaque critère garde ses champs (cle, titre, points, sur, valeur, cible, texte, piste, aCompleter) et reçoit :
       libelle, max (20), statut (bon · surveiller · travailler · a_completer ; « information » pour un critère informatif),
       points null quand il est à compléter, mesure { valeur, unite, texte }, repere { texte, zones: [{ jusqua, statut }] },
       pourquoi, calcul (étapes avec les chiffres), donnees [{ libelle, valeur, lien? ({ ligne } ou { enveloppe }) }],
       ameliorer [{ action, gain_points }] (gain obtenu en rejouant le barème), manque, source_donnees, confiance
       (complete · partielle · absente). Mêmes fonctions et mêmes textes dans le connecteur (index.ts), parité testée. */
  /* Formats des explications (identiques à pratiques.js et au connecteur) : zéros finaux retirés, milliers séparés par une espace. */
  function frc(x, dec) {
    const s = Math.abs(x).toFixed(dec == null ? 1 : dec).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(".", ",");
    return (x < 0 ? "−" : "") + s.replace(/^(\d+)/, m => m.replace(/\B(?=(\d{3})+(?!\d))/g, " "));
  }
  const pctc = (x, dec) => frc(x * 100, dec == null ? 0 : dec) + " %";
  const eurc = x => frc(Math.round(x), 0) + " €";
  const r1 = x => Math.round(x * 10) / 10;
  const r2 = x => Math.round(x * 100) / 100;

  /** Statut d'une note sur 20 : 16 et plus bon, 10 et plus à surveiller, en dessous à travailler ; null : à compléter. */
  function statutDe(points) {
    if (points == null || !isFinite(+points)) return "a_completer";
    return points >= 16 ? "bon" : points >= 10 ? "surveiller" : "travailler";
  }
  const STATUTS_LABELS = { bon: "bon", surveiller: "à surveiller", travailler: "à travailler", a_completer: "à compléter", information: "information" };

  /** Zones d'une jauge : statut de la note (arrondie) le long de la mesure, de min à max (même unité que mesure.valeur).
      Frontières trouvées par dichotomie, à 0,01 près ; la dernière zone n'a pas de borne (jusqua null). */
  function zones(f, min, max) {
    const st = x => statutDe(Math.round(f(x))), N = 600, out = [];
    let prev = st(min), xa = min;
    for (let i = 1; i <= N; i++) {
      const x = min + (max - min) * i / N, s = st(x);
      if (s !== prev) {
        let a = xa, b = x;
        for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (st(m) === prev) a = m; else b = m; }
        out.push({ jusqua: r2(a), statut: prev });
        prev = s;
      }
      xa = x;
    }
    out.push({ jusqua: null, statut: prev });
    return out;
  }
  /** Points gagnés si la mesure passait à x (barème rejoué, notes arrondies), jamais négatif. */
  const gain = (f, x, points) => Math.max(0, Math.round(f(x)) - (points || 0));

  /** Barèmes du score (points sur 20), en fonction de la mesure dans son unité d'affichage. */
  const BAREMES = {
    matelas: mois => (mois < 1 ? 0 : mois < 3 ? interp(mois, [[1, 5], [3, 15]]) : mois <= 6 ? 20 : interp(mois, [[6, 20], [12, 15]])),
    epargne: tauxPct => interp(tauxPct, [[0, 0], [5, 6], [10, 12], [15, 16], [20, 20]]),
    endettement: tauxPct => interp(tauxPct, [[25, 20], [35, 12], [45, 0]]),
    concentration: (maxPct, nb) => Math.max(0, interp(maxPct, [[10, 20], [20, 14], [40, 0]]) - (nb < 3 ? 5 : 0)),
    patrimoine: ratio => clamp(ratio, 0, 1) * 20,
  };
  const REPERES = {
    matelas: "3 à 6 mois de dépenses : 20/20 ; de 1 à 3 mois : de 5 à 15 ; moins d'un mois : 0 ; au-delà de 6 mois, la note redescend jusqu'à 15 à 12 mois.",
    epargne: "0 % des revenus : 0 ; 5 % : 6 ; 10 % : 12 ; 15 % : 16 ; 20 % ou plus : 20 (linéaire entre ces repères).",
    endettement: "25 % des revenus ou moins : 20 ; 35 % (plafond appliqué par les banques) : 12 ; 45 % ou plus : 0 (linéaire entre ces repères).",
    concentration: "plus grosse ligne à 10 % du financier ou moins : 20 ; 20 % : 14 ; 40 % ou plus : 0 ; 5 points de moins sous 3 poches.",
    patrimoine: "au niveau du repère de ta tranche d'âge (en années de revenus) : 20 ; proportionnel en dessous.",
  };

  /** Ajoute les champs du contrat à un critère (objet modifié et renvoyé). ex : explications (mesure, repere, pourquoi, calcul,
      donnees, ameliorer, manque, source_donnees, confiance). Un critère à compléter a des points null ; un informatif aussi. */
  function contrat(c, ex) {
    const e = ex || {}, ac = !!c.aCompleter, info = !!c.informatif;
    const points = ac || info || c.points == null ? null : c.points;
    return Object.assign(c, {
      libelle: c.titre, max: info ? null : 20, points,
      statut: info ? "information" : ac ? "a_completer" : statutDe(points),
      mesure: e.mesure || null, repere: e.repere || null, pourquoi: e.pourquoi || "", calcul: e.calcul || [], donnees: e.donnees || [],
      ameliorer: e.ameliorer || [], manque: e.manque || [], source_donnees: e.source_donnees || null,
      confiance: e.confiance || (ac ? "absente" : "complete"),
    });
  }
  const sourceBudget = (source, periode) => (source === "reel" ? "réel" + (periode ? ", " + periode : "") : "budget prévu");

  /** Matelas. o = { mois (ou null), total, epargne, courants, courantsAuDela, reserveMois, reserve, depenses, source, periode,
      avecCourants (faux pour Plan.score : seule la poche Épargne compte), donnees, points }. */
  function expliqueMatelas(o) {
    const f = BAREMES.matelas, repere = { texte: REPERES.matelas, zones: zones(f, 0, 15) };
    if (o.mois == null) return { repere, donnees: o.donnees || [], confiance: "absente",
      pourquoi: "Pas de note : il faut tes dépenses mensuelles pour savoir combien de mois ta réserve couvre.",
      manque: ["Tes dépenses mensuelles (budget, ou banque connectée)"],
      ameliorer: [{ action: "Donne tes dépenses mensuelles à Claude (ou connecte ta banque) pour mesurer ta réserve.", gain_points: null }] };
    const mois = o.mois, pts = o.points, dep = o.depenses;
    const calcul = [o.avecCourants ? "Épargne disponible (livrets, comptes d'épargne) : " + eurc(o.epargne) : "Poche Épargne : " + eurc(o.epargne)];
    if (o.avecCourants) calcul.push("Comptes courants : " + eurc(o.courants) + " ; une réserve de fonctionnement de " + frc(o.reserveMois) +
      " mois de dépenses (" + eurc(o.reserve) + ") y reste pour les dépenses courantes, seul l'excédent compte : " + eurc(o.courantsAuDela));
    calcul.push("Matelas : " + eurc(o.total), "Dépenses mensuelles (" + sourceBudget(o.source, o.periode) + ") : " + eurc(dep),
      eurc(o.total) + " ÷ " + eurc(dep) + " = " + frc(mois) + " mois", "Barème : " + frc(mois) + " mois → " + pts + "/20");
    const ameliorer = [];
    if (mois < 3) ameliorer.push({ action: "Porte ton matelas à 3 mois de dépenses (≈ +" + eurc((3 - mois) * dep) + ") sur une épargne disponible à tout moment.", gain_points: gain(f, 3, pts) });
    else if (mois > 6) ameliorer.push({ action: "Garde 6 mois de dépenses de côté et affecte l'excédent (≈ " + eurc((mois - 6) * dep) + ") à l'un de tes objectifs.", gain_points: gain(f, 6, pts) });
    return { repere, calcul, ameliorer, donnees: o.donnees || [], source_donnees: sourceBudget(o.source, o.periode), confiance: "complete",
      mesure: { valeur: r1(mois), unite: "mois", texte: frc(mois) + " mois de dépenses" },
      pourquoi: mois < 1 ? "Ta réserve couvre moins d'un mois de dépenses : un imprévu t'obligerait à vendre ou à emprunter."
        : mois < 3 ? "Ta réserve couvre " + frc(mois) + " mois de dépenses, sous le repère de 3 mois."
        : mois <= 6 ? "Ta réserve couvre " + frc(mois) + " mois de dépenses, dans le repère de 3 à 6 mois."
        : "Ta réserve couvre " + frc(mois) + " mois de dépenses : au-delà de 6 mois, une partie pourrait servir un objectif." };
  }

  /** Capacité d'épargne. o = { taux (fraction ou null), revenus, epargne (mensuelle : prévue, ou versée pour le réel), reste (prévu),
      depenses (réel), source, periode, points, manque? }. Réel (spec cp4 § 1.2) : taux = capacité d'épargne = (revenus − dépenses) ÷ revenus,
      l'épargne versée étant affichée à part (elle en est une partie ; le reste demeure sur les comptes courants). */
  function expliqueEpargne(o) {
    const f = BAREMES.epargne, repere = { texte: REPERES.epargne, zones: zones(f, 0, 30) };
    if (o.taux == null) return { repere, confiance: "absente",
      pourquoi: "Pas de note : il faut tes revenus et tes dépenses (ou ton épargne) pour calculer ta capacité d'épargne.",
      manque: o.manque || ["Tes revenus et tes dépenses mensuels (budget, ou banque connectée)"],
      ameliorer: [{ action: "Donne tes revenus et tes dépenses à Claude (ou connecte ta banque) pour calculer ta capacité d'épargne.", gain_points: null }] };
    const t = o.taux, pts = o.points, src = sourceBudget(o.source, o.periode), reel = o.source === "reel";
    const capacite = reel ? o.revenus - o.depenses : 0, reste = capacite - o.epargne;
    const calcul = reel
      ? ["Revenus moyens (" + src + ") : " + eurc(o.revenus) + " par mois",
        "Dépenses moyennes (hors épargne et virements internes) : " + eurc(o.depenses) + " par mois",
        "Capacité d'épargne : " + eurc(o.revenus) + " − " + eurc(o.depenses) + " = " + eurc(capacite) + " par mois",
        eurc(capacite) + " ÷ " + eurc(o.revenus) + " = " + pctc(t, 1),
        "Dont épargne versée (virements vers l'épargne et les placements) : " + eurc(o.epargne) + " par mois ; " +
          (reste >= 0 ? "le reste (" + eurc(reste) + ") reste sur tes comptes courants" : "c'est " + eurc(-reste) + " de plus que ta capacité : la différence a été prise sur tes comptes courants")]
      : ["Revenus du budget : " + eurc(o.revenus) + " par mois", "Épargne prévue : " + eurc(o.epargne) + " par mois",
        "Reste du mois (revenus − dépenses − épargne), compté s'il est positif : " + eurc(Math.max(0, o.reste || 0)),
        "(" + eurc(o.epargne) + " + " + eurc(Math.max(0, o.reste || 0)) + ") ÷ " + eurc(o.revenus) + " = " + pctc(t, 1)];
    calcul.push("Barème : " + pctc(t, 1) + " → " + pts + "/20");
    const ameliorer = [15, 20].filter(c => t * 100 < c).map(c => ({
      action: (reel ? "Dégage " + eurc((c / 100 - t) * o.revenus) + " de plus par mois (dépenses en moins ou revenus en plus) pour atteindre "
        : "Mets de côté " + eurc((c / 100 - t) * o.revenus) + " de plus par mois pour atteindre ") + c + " % de tes revenus.", gain_points: gain(f, c, pts) }));
    return { repere, calcul, ameliorer: ameliorer.slice(0, 2), donnees: o.donnees || [], source_donnees: src, confiance: "complete",
      mesure: { valeur: r1(t * 100), unite: "%", texte: pctc(t, 1) + " des revenus" },
      pourquoi: reel ? (t < 0 ? "Tes dépenses dépassent tes revenus (" + src + ") : ta capacité d'épargne est négative."
          : "Tu dégages " + pctc(t, 1) + " de tes revenus (" + src + "), " + (t >= 0.15 ? "au-dessus du" : "sous le") + " repère de 15 %.")
        : "Tu mets de côté " + pctc(t, 1) + " de tes revenus (" + src + "), " + (t >= 0.15 ? "au-dessus du" : "sous le") + " repère de 15 %." };
  }

  /** Endettement. o = { taux (ou null), revenus, mensualites, donnees, points }. */
  function expliqueEndettement(o) {
    const f = BAREMES.endettement, repere = { texte: REPERES.endettement, zones: zones(f, 0, 60) };
    if (o.taux == null) return { repere, confiance: "absente", pourquoi: "Pas de note : il faut tes revenus pour calculer ton taux d'endettement.",
      manque: ["Tes revenus mensuels"], ameliorer: [{ action: "Donne tes revenus à Claude pour calculer ton taux d'endettement.", gain_points: null }] };
    const t = o.taux, pts = o.points;
    const ameliorer = t > 0.35 ? [{ action: "Ramène tes mensualités à 35 % de tes revenus (≈ −" + eurc((t - 0.35) * o.revenus) + " par mois, par remboursement anticipé ou renégociation).",
      gain_points: gain(f, 35, pts) }] : t > 0.25 ? [{ action: "Sous 25 % de tes revenus (≈ −" + eurc((t - 0.25) * o.revenus) + " de mensualités), la note est pleine.", gain_points: gain(f, 25, pts) }] : [];
    return { repere, ameliorer, donnees: o.donnees || [], source_donnees: "profil (crédits et biens)", confiance: "complete",
      calcul: ["Mensualités de crédit : " + eurc(o.mensualites) + " par mois", "Revenus : " + eurc(o.revenus) + " par mois",
        eurc(o.mensualites) + " ÷ " + eurc(o.revenus) + " = " + pctc(t, 1), "Barème : " + pctc(t, 1) + " → " + pts + "/20"],
      mesure: { valeur: r1(t * 100), unite: "%", texte: pctc(t, 1) + " des revenus" },
      pourquoi: o.mensualites > 0 ? "Tes crédits prennent " + pctc(t, 1) + " de tes revenus, " + (t <= 0.35 ? "sous le" : "au-dessus du") + " plafond de 35 %."
        : "Tu n'as aucune mensualité de crédit en cours." };
  }

  /** Diversification. o = { lignes [{ id, nom, valeur }] triées (plus grosses d'abord), total, nb (poches), points }. */
  function expliqueConcentration(o) {
    const nb = o.nb || 0, f = x => BAREMES.concentration(x, nb), repere = { texte: REPERES.concentration, zones: zones(f, 0, 60) };
    if (!(o.total > 0)) return { repere, confiance: "absente", pourquoi: "Pas de note : aucun placement enregistré.",
      manque: ["Tes placements (lignes et montants)"], ameliorer: [{ action: "Complète tes placements avec Claude pour mesurer leur diversification.", gain_points: null }] };
    const L = o.lignes || [], top = L[0], max = top.valeur / o.total, pts = o.points;
    const ameliorer = [];
    const second = L[1] ? L[1].valeur / o.total : 0, cibleMax = max > 0.2 ? 0.2 : 0.1;
    if (max > 0.1) ameliorer.push({ action: "Ramène « " + top.nom + " » à " + (cibleMax * 100) + " % du financier (≈ " + eurc(top.valeur - cibleMax * o.total) + " à répartir sur d'autres lignes).",
      gain_points: gain(f, Math.max(cibleMax, second) * 100, pts) });
    if (nb < 3) ameliorer.push({ action: "Répartis ton financier sur au moins 3 poches (tu en as " + nb + ").", gain_points: gain(x => BAREMES.concentration(x, 3), max * 100, pts) });
    return { repere, ameliorer, source_donnees: "placements", confiance: "complete",
      donnees: L.slice(0, 5).map(l => ({ libelle: l.nom, valeur: r2(l.valeur), poids_pct: r1(l.valeur / o.total * 100), lien: { ligne: l.id } })),
      calcul: ["Financier compté : " + eurc(o.total), "Plus grosse ligne : « " + top.nom + " », " + eurc(top.valeur),
        eurc(top.valeur) + " ÷ " + eurc(o.total) + " = " + pctc(max, 1), "Poches différentes : " + nb + (nb < 3 ? " (moins de 3 : 5 points de moins)" : ""),
        "Barème : " + pctc(max, 1) + (nb < 3 ? ", " + nb + " poche" + (nb > 1 ? "s" : "") : "") + " → " + pts + "/20"],
      mesure: { valeur: r1(max * 100), unite: "%", texte: "plus grosse ligne : " + pctc(max, 1) + " du financier" },
      pourquoi: "« " + top.nom + " » pèse " + pctc(max, 1) + " du financier" + (max <= 0.2 ? ", sous le repère de 20 %" : ", au-dessus du repère de 20 %") +
        (nb < 3 ? ", réparti sur seulement " + nb + " poche" + (nb > 1 ? "s" : "") + "." : ".") };
  }

  /** Patrimoine net (Plan.score seulement). o = { annees, repere, net, revenus, points, manque? }. */
  function expliquePatrimoine(o) {
    /* Jauge dans l'unité de mesure.valeur (% du repère) : le barème est rejoué sur x ÷ 100. */
    const f = r => BAREMES.patrimoine(r), repere = { texte: REPERES.patrimoine, zones: zones(x => f(x / 100), 0, 150) };
    if (o.annees == null) return { repere, confiance: "absente", pourquoi: "Pas de note : il faut ta tranche d'âge et tes revenus pour situer ton patrimoine.",
      manque: o.manque || [], ameliorer: [{ action: "Donne ta tranche d'âge et tes revenus à Claude pour situer ton patrimoine.", gain_points: null }] };
    const ratio = o.annees / o.repere, pts = o.points;
    return { repere: { texte: REPERES.patrimoine + " Repère à ton âge : " + frc(o.repere) + " année" + (o.repere > 1 ? "s" : "") + " de revenus.", zones: repere.zones },
      source_donnees: "bilan et profil", confiance: "complete",
      calcul: ["Patrimoine net : " + eurc(o.net), "Revenus annuels : " + eurc(o.revenus * 12), eurc(o.net) + " ÷ " + eurc(o.revenus * 12) + " = " + frc(Math.max(0, o.annees)) + " année(s) de revenus",
        "Repère à ton âge : " + frc(o.repere) + " ; " + frc(Math.max(0, o.annees)) + " ÷ " + frc(o.repere) + " = " + pctc(clamp(ratio, 0, 1)) + " du repère → " + pts + "/20"],
      ameliorer: ratio < 1 ? [{ action: "Atteindre le repère de ton âge : patrimoine net de " + eurc(o.repere * o.revenus * 12) + " (≈ +" + eurc(o.repere * o.revenus * 12 - o.net) + "), par l'épargne régulière et le remboursement des crédits.",
        gain_points: gain(f, 1, pts) }] : [],
      mesure: { valeur: r1(ratio * 100), unite: "% du repère", texte: frc(Math.max(0, o.annees)) + " année(s) de revenus" },
      pourquoi: ratio >= 1 ? "Ton patrimoine net atteint le repère de ta tranche d'âge." : "Ton patrimoine net représente " + pctc(clamp(ratio, 0, 1)) + " du repère de ta tranche d'âge." };
  }

  function itemMatelas(positions, scope, totaux, config) {
    const L = (positions || []).filter(p => Calc.inScope(p, scope) && Calc.counted(p) && p.bloc === "Épargne");
    const epargne = sum(L, Calc.val);
    const m = Calc.matelas(config);
    const depenses = totaux.depensesLignes > 0 ? totaux.depenses : m && m.mode === "months" && m.depenses > 0 ? m.depenses : 0;
    const base = { cle: "matelas", titre: "Matelas de précaution", cible: "3 à 6 mois de dépenses" };
    const donnees = L.map(p => ({ libelle: p.name || p.envelope || "Épargne", valeur: r2(Calc.val(p)), lien: p.id ? { ligne: p.id } : { enveloppe: p.envelope } }));
    if (depenses <= 0) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Dépenses mensuelles inconnues.", piste: "Donne tes dépenses à Claude pour mesurer ta réserve." }, expliqueMatelas({ mois: null, donnees }));
    const mois = epargne / depenses;
    const points = Math.round(BAREMES.matelas(mois));
    const piste = mois < 3 ? "Vise 3 à 6 mois de dépenses sur une épargne disponible à tout moment, pour absorber un imprévu sans vendre ni emprunter."
      : mois <= 6 ? "Ta réserve couvre les imprévus courants : rien à changer de ce côté."
      : mois <= 12 ? "Au-delà de 6 mois, une partie de cette réserve pourrait être affectée à l'un de tes objectifs."
      : "Plus d'un an de dépenses dort sur des supports peu rémunérés : regarde si une partie peut servir tes objectifs.";
    return contrat({ ...base, valeur: mois, points, aCompleter: false, texte: fr(mois) + " mois de dépenses de côté.", piste },
      expliqueMatelas({ mois, total: epargne, epargne, depenses, source: "prevu", avecCourants: false, donnees, points }));
  }

  function itemEpargne(totaux) {
    const base = { cle: "epargne", titre: "Capacité d'épargne", cible: "15 % des revenus ou plus" };
    if (!(totaux.revenus > 0) || (totaux.depensesLignes <= 0 && totaux.epargne <= 0)) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Budget incomplet.", piste: "Donne tes revenus et tes dépenses à Claude pour calculer ta capacité d'épargne." }, expliqueEpargne({ taux: null }));
    const t = totaux.tauxEpargne;
    const points = Math.round(BAREMES.epargne(t * 100));
    const piste = t >= 0.15 ? "Tu es au-dessus du repère de 15 % : de quoi alimenter tes objectifs régulièrement."
      : "Le repère courant est de 15 % des revenus. Les postes les plus lourds du budget sont le premier endroit où regarder.";
    return contrat({ ...base, valeur: t, points, aCompleter: false, texte: "Tu mets de côté " + pct(t) + " de tes revenus.", piste },
      expliqueEpargne({ taux: t, revenus: totaux.revenus, epargne: totaux.epargne, reste: totaux.reste, source: "prevu", points,
        donnees: [{ libelle: "Revenus mensuels", valeur: r2(totaux.revenus) }, { libelle: "Dépenses mensuelles", valeur: r2(totaux.depenses) }, { libelle: "Épargne prévue", valeur: r2(totaux.epargne) }] }));
  }

  /* Crédits et biens à mensualité du périmètre : données de l'endettement. */
  function lignesCredits(profil, scope) {
    const pr = profil || {};
    return [...(Array.isArray(pr.biens) ? pr.biens : []).filter(b => pos(b.mensualite) > 0).map(b => ({ libelle: (b.nom || "Bien") + " (mensualité)", valeur: r2(pos(b.mensualite) * Calc.part(scope, b.part_p1)) })),
      ...(Array.isArray(pr.credits) ? pr.credits : []).filter(c => pos(c.mensualite) > 0).map(c => ({ libelle: (c.nom || "Crédit") + " (mensualité)", valeur: r2(pos(c.mensualite) * Calc.partCredit(scope, c.owner)) }))]
      .filter(x => x.valeur > 0);
  }

  function itemEndettement(totaux, profil, scope) {
    const base = { cle: "endettement", titre: "Taux d'endettement", cible: "35 % des revenus au plus" };
    if (!(totaux.revenus > 0)) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Revenus inconnus.", piste: "Donne tes revenus à Claude pour calculer ton taux d'endettement." }, expliqueEndettement({ taux: null }));
    const t = totaux.mensualites / totaux.revenus;
    const points = Math.round(BAREMES.endettement(t * 100));
    const texte = totaux.mensualites > 0 ? "Tes crédits représentent " + pct(t) + " de tes revenus." : "Aucune mensualité de crédit en cours.";
    const piste = t <= 0.35 ? "Tu restes sous le plafond de 35 % appliqué par les banques (norme HCSF)."
      : "Au-delà de 35 %, les banques prêtent difficilement (norme HCSF). Un remboursement anticipé ou une renégociation peuvent alléger la charge.";
    return contrat({ ...base, valeur: t, points, aCompleter: false, texte, piste },
      expliqueEndettement({ taux: t, revenus: totaux.revenus, mensualites: totaux.mensualites, points, donnees: lignesCredits(profil, scope) }));
  }

  function itemConcentration(positions, scope) {
    const base = { cle: "concentration", titre: "Diversification", cible: "aucune ligne au-delà de 20 %, au moins 3 poches" };
    const L = (positions || []).filter(p => Calc.inScope(p, scope) && Calc.counted(p) && Calc.val(p) > 0);
    const F = sum(L, Calc.val);
    if (F <= 0) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Aucun placement enregistré.", piste: "Complète tes placements avec Claude pour mesurer leur diversification." }, expliqueConcentration({ total: 0 }));
    const max = Math.max(...L.map(Calc.val)) / F;
    const nb = new Set(L.map(p => p.bloc || "_autre")).size;
    const points = Math.round(BAREMES.concentration(max * 100, nb));
    const texte = "La plus grosse ligne pèse " + pct(max) + " du financier, réparti sur " + nb + (nb > 1 ? " poches." : " poche.");
    const piste = max <= 0.2 && nb >= 3 ? "Ton financier est bien réparti : aucune ligne ne domine."
      : "Repère : aucune ligne au-delà de 20 % du financier et au moins 3 poches, pour qu'un seul support ne pèse pas sur l'ensemble.";
    const lignes = L.map(p => ({ id: p.id, nom: p.name || p.bloc || "Ligne", valeur: Calc.val(p) })).sort((a, b) => b.valeur - a.valeur);
    return contrat({ ...base, valeur: max, points, aCompleter: false, texte, piste }, expliqueConcentration({ lignes, total: F, nb, points }));
  }

  function itemPatrimoine(positions, profil, scope, totaux) {
    const age = profil && profil.foyer && profil.foyer.age;
    const repere = REPERES_AGE[age];
    const base = { cle: "patrimoine", titre: "Patrimoine net", cible: repere ? fr(repere) + " année" + (repere > 1 ? "s" : "") + " de revenus" : "selon l'âge" };
    if (!repere) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Âge non renseigné.", piste: "Donne ta tranche d'âge à Claude pour comparer ton patrimoine au repère." }, expliquePatrimoine({ annees: null, manque: ["Ta tranche d'âge"] }));
    if (!(totaux.revenus > 0)) return contrat({ ...base, valeur: null, aCompleter: true,
      texte: "Revenus inconnus.", piste: "Donne tes revenus à Claude pour situer ton patrimoine." }, expliquePatrimoine({ annees: null, manque: ["Tes revenus mensuels"] }));
    const net = Calc.patrimoine(positions, profil, scope).net;
    const annees = net / (totaux.revenus * 12);
    const points = Math.round(clamp(annees / repere, 0, 1) * 20); // BAREMES.patrimoine
    const texte = "Patrimoine net : " + fr(Math.max(annees, 0)) + " année" + (annees >= 2 ? "s" : "") + " de revenus (repère à ton âge : " + fr(repere) + ").";
    const piste = annees >= repere ? "Tu es au niveau du repère de ta tranche d'âge."
      : "Le patrimoine se construit surtout par l'épargne régulière et le remboursement des crédits ; tes objectifs (Patrimoine › Objectifs) en donnent le rythme.";
    return contrat({ ...base, valeur: annees, points, aCompleter: false, texte, piste }, expliquePatrimoine({ annees, repere, net, revenus: totaux.revenus, points }));
  }

  /** Seuil de couverture sous lequel une note globale est « provisoire » (spec cp4 § 1). */
  const SEUIL_PROVISOIRE = 0.6;
  const notes = L => L.filter(c => c && !c.aCompleter && !c.informatif && c.points != null);
  /** Texte de couverture : « calculée sur 3 critères sur 5 ». */
  const texteCouverture = (k, n) => "calculée sur " + k + " critère" + (k > 1 ? "s" : "") + " sur " + n;

  /** Score de santé sur 100 : cinq critères sur 20 ; les critères à compléter (points null) sont exclus et le total ramené sur 100 ;
      couverture = critères notés ÷ critères, provisoire sous 60 % ; points perdus par critère = (20 − points) ÷ (20 × notés) × 100. */
  function score(ctx) {
    const c = ctx || {}, scope = c.scope || "foyer", positions = c.positions || [];
    const b = c.budget;
    const lignes = Array.isArray(b) ? b : b && Array.isArray(b.lignes) ? b.lignes : [];
    const totaux = b && !Array.isArray(b) && typeof b.depenses === "number" ? b : budgetTotaux(lignes, c.profil, scope);
    const items = [
      itemMatelas(positions, scope, totaux, c.config),
      itemEpargne(totaux),
      itemEndettement(totaux, c.profil, scope),
      itemConcentration(positions, scope),
      itemPatrimoine(positions, c.profil, scope, totaux),
    ].map(i => Object.assign(i, { sur: 20 }));
    const complets = notes(items);
    // Pas de note globale sur moins de 3 critères : un 100/100 calculé sur un seul critère serait trompeur.
    const total = complets.length >= SCORE_MIN_CRITERES ? Math.round(sum(complets, i => i.points) / (20 * complets.length) * 100) : null;
    items.forEach(i => { i.points_perdus = i.points == null || total == null ? null : r1((20 - i.points) / (20 * complets.length) * 100); });
    const couverture = complets.length / items.length;
    return { total, complet: complets.length === items.length, calcules: complets.length, items,
      couverture, couvertureTexte: texteCouverture(complets.length, items.length), provisoire: total != null && couverture < SEUIL_PROVISOIRE };
  }

  /** « Ce qui te coûte le plus » : les n (3) critères notés aux points perdus les plus élevés, avec la première action chiffrée.
      Accepte Plan.score (items) comme Pratiques.evaluer (criteres). → [{ cle, famille, libelle, points, points_perdus, action, gain_points }]. */
  function coutsPrincipaux(res, nb) {
    const L = ((res && (res.criteres || res.items)) || []).filter(x => x && x.points_perdus != null && x.points_perdus > 0);
    return L.slice().sort((a, b) => b.points_perdus - a.points_perdus || (a.points || 0) - (b.points || 0)).slice(0, nb == null ? 3 : nb).map(x => {
      const a = (x.ameliorer || []).find(y => y && y.gain_points) || (x.ameliorer || [])[0] || null;
      return { cle: x.cle, famille: x.famille || null, libelle: x.libelle || x.titre, points: x.points, points_perdus: x.points_perdus,
        action: a ? a.action : x.piste || "", gain_points: a ? a.gain_points : null, gain_note: a && a.gain_note != null ? a.gain_note : null };
    });
  }

  return { SCORE_MIN_CRITERES, SEUIL_PROVISOIRE, RENDEMENTS, REPERES_AGE, BAREMES, REPERES, STATUTS_LABELS, mensuel, budgetTotaux, capaciteEpargne, affecterDeja,
    effortMensuel, valeurFuture, moisEntre, dateAtteinte, dejaObjectif, titulaireObjectif, statutObjectif, repartirEpargne, projection, score, coutsPrincipaux,
    statutDe, zones, contrat, texteCouverture, expliqueMatelas, expliqueEpargne, expliqueEndettement, expliqueConcentration, frc, eurc, pctc };
});
});

/* ---------- web/src/projection-outils.js ---------- */
def("projection-outils", function (module, exports, require) {
/* Outils communs du moteur de projection (PROJ) : dates, générateur pseudo-aléatoire à graine fixe, normales, factorisation de
   Cholesky, centiles, lecture des repères, formats français. Pur, sans DOM ; aucune valeur chiffrée de la finance ici.
   Global ProjectionOutils (navigateur et worker) ; module CommonJS sous Node ; copié tel quel dans le connecteur (npm run gen). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ProjectionOutils = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ dates (AAAA-MM-JJ, sans fuseau) */
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
  /** Ajoute n mois au même quantième, ou au dernier jour du mois s'il n'existe pas. */
  function ajouterMois(s, n) {
    const [y, m, d] = morceaux(s), t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = t - ny * 12 + 1;
    return iso(ny, nm, Math.min(d, dernierJour(ny, nm)));
  }
  const ajouterAns = (s, n) => ajouterMois(s, n * 12);
  const utc = s => { const [y, m, d] = morceaux(s); return Date.UTC(y, m - 1, d); };
  const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  /** Mois entiers entre deux dates (a ≤ b) : le mois n'est compté que si le quantième de b atteint celui de a. */
  function moisEntre(a, b) {
    const [y1, m1, d1] = morceaux(a), [y2, m2, d2] = morceaux(b);
    let k = (y2 - y1) * 12 + (m2 - m1);
    if (d2 < d1 && d2 < dernierJour(y2, m2)) k -= 1;
    return k;
  }
  const annee = s => +s.slice(0, 4);
  /** Premier mois t ≥ 1 tel que date(t) ≥ d (date(t) = today + t mois) ; null si la date dépasse `max` mois. Une date passée donne 1. */
  function moisDe(today, d, max) {
    if (!estDate(d)) return null;
    let t = Math.max(0, moisEntre(today, d) - 1);
    if (t < 0) t = 0;
    while (ajouterMois(today, t) < d) t += 1;
    while (t > 0 && ajouterMois(today, t - 1) >= d) t -= 1;
    t = Math.max(1, t);
    return max != null && t > max ? null : t;
  }
  /** Mois d'une date de fin exclue : premier t ≥ 1 tel que date(t) ≥ fin (le mois t n'est plus concerné). */
  const moisFin = moisDe;
  /** Date + n jours. */
  function ajouterJours(s, n) { const t = new Date(utc(s) + n * 864e5); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  /** Âge révolu à une date, depuis une date de naissance. */
  function age(naissance, date) {
    const [y1, m1, d1] = morceaux(naissance), [y2, m2, d2] = morceaux(date);
    let a = y2 - y1;
    if (m2 < m1 || (m2 === m1 && d2 < d1)) a -= 1;
    return a;
  }

  /* ------------------------------------------------------------------ taille d'un document JSON comme la base la mesure */
  /** Octets de `jsonb::text` (octet_length(v::jsonb::text) de PostgreSQL) : un espace après « : » et « , », texte en UTF-8, valeurs indéfinies absentes (objets)
      ou nulles (tableaux). Sert à tenir les plans figés sous les limites de la base (paramètres 100 000 octets, série 250 000, proposition 400 000). */
  function octetsJsonb(v) {
    const enc = s => { let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3; } return n; };
    const rec = x => {
      if (x === null || x === undefined) return 4;
      if (typeof x === "number") return isFinite(x) ? String(x).length : 4;
      if (typeof x === "boolean") return x ? 4 : 5;
      if (typeof x === "string") return enc(JSON.stringify(x));
      if (Array.isArray(x)) { if (!x.length) return 2; let n = 2 + 2 * (x.length - 1); for (const y of x) n += rec(y); return n; }
      const ks = Object.keys(x).filter(k => x[k] !== undefined);
      if (!ks.length) return 2;
      let n = 2 + 2 * (ks.length - 1);
      for (const k of ks) n += enc(JSON.stringify(k)) + 2 + rec(x[k]);
      return n;
    };
    return rec(v);
  }

  /* ------------------------------------------------------------------ nombres et formats français (espaces simples, « − » typographique) */
  const n0 = v => (typeof v === "number" ? (isFinite(v) ? v : 0) : typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : 0);
  const estNombre = v => (typeof v === "number" && isFinite(v)) || (typeof v === "string" && v.trim() !== "" && isFinite(+v));
  const arrondi2 = x => Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;
  function frc(x, dec) {
    const d = dec == null ? 0 : dec;
    const s = Math.abs(x).toFixed(d).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(".", ",");
    const neg = x < 0 && Number(Math.abs(x).toFixed(d)) !== 0;
    return (neg ? "−" : "") + s.replace(/^(\d+)/, m => m.replace(/\B(?=(\d{3})+(?!\d))/g, " "));
  }
  /** Nombre à `dec` décimales fixes (zéros finaux conservés) : « 459,70 ». */
  function frcFixe(x, dec) { const s = Math.abs(x).toFixed(dec).replace(".", ",").replace(/^(\d+)/, m => m.replace(/\B(?=(\d{3})+(?!\d))/g, " ")); return (x < 0 && Number(Math.abs(x).toFixed(dec)) !== 0 ? "−" : "") + s; }
  const eurFixe = (x, dec) => frcFixe(x, dec == null ? 2 : dec) + " €";
  const eur = (x, dec) => frc(x, dec == null ? 0 : dec) + " €";
  /** Montant avec signe : « +400 € », « −1 020 € ». */
  const eurSigne = (x, dec) => (x >= 0 ? "+" : "") + eur(x, dec);
  const pct = (x, dec) => frc(x, dec == null ? 0 : dec) + " %";

  /* ------------------------------------------------------------------ repères */
  const estRepere = r => r && isFinite(+r.valeur);
  /** Index { cle: repère } d'une liste de repères (le premier de chaque clé l'emporte). */
  function indexReperes(liste) {
    const out = Object.create(null);
    (Array.isArray(liste) ? liste : []).forEach(r => { if (r && r.cle && estRepere(r) && !(r.cle in out)) out[r.cle] = r; });
    return out;
  }

  /* ------------------------------------------------------------------ générateur à graine fixe */
  /** splitmix32 : suite de mots de 32 bits à partir d'une graine de 32 bits. */
  function splitmix32(graine) {
    let a = graine >>> 0;
    return function () {
      a = (a + 0x9E3779B9) | 0;
      let t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21F0AAAD);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735A2D97);
      return ((t = t ^ (t >>> 15)) >>> 0);
    };
  }
  /** Initialise l'état xoshiro128** du chemin i (4 mots) dans s[4i .. 4i+3], à partir de la graine du calcul (jamais tout à zéro). */
  function initialiserEtat(s, i, graine) {
    const sm = splitmix32(((graine >>> 0) ^ Math.imul(i, 0x9E3779B9)) >>> 0);
    const o = 4 * i;
    s[o] = sm(); s[o + 1] = sm(); s[o + 2] = sm(); s[o + 3] = sm();
    if ((s[o] | s[o + 1] | s[o + 2] | s[o + 3]) === 0) s[o] = 1;
  }
  const TWO32 = 4294967296;
  /** Tirage xoshiro128** du chemin d'offset o dans s : uniforme dans ]0, 1[ (jamais 0 : le logarithme de Box-Muller est sûr). */
  function uniforme(s, o) {
    const r = s[o + 1] * 5;
    const resultat = Math.imul((r << 7) | (r >>> 25), 9) >>> 0;
    const t = s[o + 1] << 9;
    s[o + 2] ^= s[o];
    s[o + 3] ^= s[o + 1];
    s[o + 1] ^= s[o + 2];
    s[o] ^= s[o + 3];
    s[o + 2] ^= t;
    s[o + 3] = (s[o + 3] << 11) | (s[o + 3] >>> 21);
    return (resultat + 0.5) / TWO32;
  }

  /* ------------------------------------------------------------------ algèbre */
  /** Facteur de Cholesky L (triangulaire inférieure, tableau plat n × n) de la matrice symétrique A (tableau de tableaux) ; null si A n'est pas définie positive. */
  function cholesky(A) {
    const n = A.length, L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let somme = A[i][j];
        for (let k = 0; k < j; k++) somme -= L[i * n + k] * L[j * n + k];
        if (i === j) { if (somme <= 1e-12) return null; L[i * n + i] = Math.sqrt(somme); } else L[i * n + j] = somme / L[j * n + j];
      }
    }
    return L;
  }
  /** Valeurs propres d'une matrice symétrique (Jacobi cyclique), triées croissantes. */
  function valeursPropres(A) {
    const n = A.length, M = A.map(l => l.slice());
    for (let balayage = 0; balayage < 100; balayage++) {
      let hors = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) hors += M[i][j] * M[i][j];
      if (hors < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(M[p][q]) < 1e-18) continue;
        const theta = (M[q][q] - M[p][p]) / (2 * M[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const a = M[k][p], b = M[k][q]; M[k][p] = c * a - s * b; M[k][q] = s * a + c * b; }
        for (let k = 0; k < n; k++) { const a = M[p][k], b = M[q][k]; M[p][k] = c * a - s * b; M[q][k] = s * a + c * b; }
      }
    }
    return M.map((l, i) => l[i]).sort((a, b) => a - b);
  }
  /** Matrice de corrélation définie positive la plus proche (Higham, projections alternées) : renvoie { matrice, ecartMax, corrigee }. */
  function pluProcheDefiniePositive(A) {
    if (cholesky(A)) return { matrice: A, ecartMax: 0, corrigee: false };
    const n = A.length;
    let Y = A.map(l => l.slice()), dS = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let it = 0; it < 200; it++) {
      const R = Y.map((l, i) => l.map((v, j) => v - dS[i][j]));
      /* projection sur les semi-définies positives : décomposition spectrale par Jacobi avec vecteurs */
      const X = projeterSDP(R);
      dS = X.map((l, i) => l.map((v, j) => v - R[i][j]));
      Y = X.map(l => l.slice());
      for (let i = 0; i < n; i++) Y[i][i] = 1;
    }
    /* léger décalage de la diagonale pour garantir la stricte positivité */
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Y[i][j] = i === j ? 1 : Y[i][j] * 0.9999;
    let ecartMax = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) ecartMax = Math.max(ecartMax, Math.abs(Y[i][j] - A[i][j]));
    return { matrice: Y, ecartMax, corrigee: true };
  }
  function projeterSDP(A) {
    const n = A.length, M = A.map(l => l.slice()), V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    for (let balayage = 0; balayage < 100; balayage++) {
      let hors = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) hors += M[i][j] * M[i][j];
      if (hors < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(M[p][q]) < 1e-18) continue;
        const theta = (M[q][q] - M[p][p]) / (2 * M[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const a = M[k][p], b = M[k][q]; M[k][p] = c * a - s * b; M[k][q] = s * a + c * b; }
        for (let k = 0; k < n; k++) { const a = M[p][k], b = M[q][k]; M[p][k] = c * a - s * b; M[q][k] = s * a + c * b; }
        for (let k = 0; k < n; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - s * b; V[k][q] = s * a + c * b; }
      }
    }
    const out = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let k = 0; k < n; k++) {
      const lambda = Math.max(M[k][k], 1e-9);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i][j] += lambda * V[i][k] * V[j][k];
    }
    return out;
  }

  /* ------------------------------------------------------------------ centiles */
  /** Centile de rang ⌈p × N⌉ (1-indexé) des valeurs triées (p entre 0 et 1) ; `triees` : tableau déjà trié croissant. */
  function centileTrie(triees, p) {
    const N = triees.length;
    if (!N) return NaN;
    const rang = Math.min(N, Math.max(1, Math.ceil(p * N - 1e-9)));
    return triees[rang - 1];
  }
  /** Centile d'une liste quelconque (copie triée). */
  function centile(valeurs, p) {
    const t = Float64Array.from(valeurs);
    t.sort();
    return centileTrie(t, p);
  }

  return { octetsJsonb, ISO, pad, dernierJour, iso, estDate, ajouterMois, ajouterAns, ajouterJours, joursEntre, moisEntre, moisDe, moisFin, annee, age,
    n0, estNombre, arrondi2, frc, frcFixe, eurFixe, eur, eurSigne, pct, indexReperes, splitmix32, initialiserEtat, uniforme, cholesky, valeursPropres,
    pluProcheDefiniePositive, centileTrie, centile };
});
});

/* ---------- web/src/projection-fiscalite.js ---------- */
def("projection-fiscalite", function (module, exports, require) {
/* Fiscalité de sortie du moteur de projection (PROJ, spec § 5.2 et § 6.3) : « net d'impôts si tu retirais tout à cette date »,
   règles par type d'enveloppe, taux lus dans les repères sourcés (jamais de valeur de secours : un repère manquant rend la règle
   indisponible et le compartiment reste en brut, avec la mention). Pur, sans DOM, au tutoiement. Global ProjectionFiscalite.
   Un compartiment fiscal : { type, valeur, base, classe, date_ouverture?, date_achat?, versements_deduits?, dates?, base_inconnue? }
   (dates : { pea_5_ans, av_8_ans, pee_disponible } issues de Calendrier.calendrier, sinon calculées depuis date_ouverture).
   ctx : { reperes (liste ou index), couple, abattement_restant, primes_titulaire, tmi_pct, per_versements_deduits }. */
(function (root, factory) {
  const O = typeof module === "object" && module.exports ? require("./projection-outils.js") : root.ProjectionOutils;
  const api = factory(O);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ProjectionFiscalite = api;
})(typeof self !== "undefined" ? self : this, function (O) {
  "use strict";

  const PEA = ["pea", "pea_pme", "pea_jeune"], AV = ["assurance_vie", "capitalisation"], LIVRETS = ["livret_a", "ldds", "lep"];
  const MENTION_SCPI = "parts de SCPI : régime des plus-values immobilières (CGI art. 150 UB et 239 septies), à confirmer";

  /** Index des repères d'un contexte (liste ou index déjà fait). */
  const indexDe = r => (Array.isArray(r) ? O.indexReperes(r) : r || {});

  /** Lecteur de repères : v(cle) → nombre ou undefined, et la liste des repères utilisés / manquants. */
  function lecteur(reperes) {
    const idx = indexDe(reperes), utilises = new Map(), manquants = new Set();
    const lire = cle => {
      const r = idx[cle];
      if (!r) { manquants.add(cle); return undefined; }
      utilises.set(cle, r);
      return +r.valeur;
    };
    return { lire, utilises, manquants, idx };
  }

  /* ------------------------------------------------------------------ abattements des plus-values immobilières (service-public F10864) */
  /** Années pleines de détention entre deux dates. */
  const anneesPleines = (achat, date) => O.age(achat, date);
  function abattementIR(ans) { // 6 % par an de la 6e à la 21e année, 4 % la 22e
    if (ans < 6) return 0;
    if (ans >= 22) return 1;
    return Math.min(1, 0.06 * (Math.min(ans, 21) - 5));
  }
  function abattementPS(ans) { // 1,65 % par an de la 6e à la 21e, 1,60 % la 22e, 9 % par an de la 23e à la 30e
    if (ans < 6) return 0;
    if (ans >= 30) return 1;
    let a = 0.0165 * (Math.min(ans, 21) - 5);
    if (ans >= 22) a += 0.016;
    if (ans >= 23) a += 0.09 * (Math.min(ans, 30) - 22);
    return Math.min(1, a);
  }

  /* ------------------------------------------------------------------ dates des seuils d'une enveloppe */
  /** Dates à partir desquelles la règle « après » s'applique : { pea_5_ans, av_8_ans, pee_disponible } (ISO) ou null si inconnue. */
  function datesSeuils(c, lire) {
    const out = { pea_5_ans: null, av_8_ans: null, pee_disponible: null };
    const d = c.dates || {};
    out.pea_5_ans = d.pea_5_ans || null;
    out.av_8_ans = d.av_8_ans || null;
    out.pee_disponible = d.pee_disponible || null;
    const ouverture = c.date_ouverture && O.estDate(c.date_ouverture) ? c.date_ouverture : null;
    if (!out.pea_5_ans && ouverture && PEA.includes(c.type)) {
      const n = lire("pea_duree_ans");
      if (n != null) out.pea_5_ans = O.ajouterJours(O.ajouterAns(ouverture, n), 1);
    }
    if (!out.av_8_ans && ouverture && AV.includes(c.type)) {
      const n = lire("av_duree_ans");
      if (n != null) out.av_8_ans = O.ajouterJours(O.ajouterAns(ouverture, n), 1);
    }
    return out;
  }

  /* ------------------------------------------------------------------ règles */
  /** Prépare les paramètres fiscaux statiques d'un compartiment : { regle, indisponible, mentions, sources, calculer(valeur, base, date, abat) }.
      `calculer` renvoie { ir, ps, abat_utilise } pour une sortie totale de `valeur` (base `base`) à `date`, avec `abat` = abattement
      annuel restant de l'assurance-vie. Les parts proportionnelles sont recalculées à chaque appel, pour les retraits partiels. */
  function preparer(c, ctx) {
    const x = ctx || {}, L = lecteur(x.reperes), lire = L.lire;
    const mentions = [];
    const res = { type: c.type, regle: null, indisponible: false, confiance: "sure", mentions, disponible: true, proportionnel: true, calculer: null, reperes: L };
    const indispo = (pourquoi, cles) => {
      res.indisponible = true; res.regle = "indisponible";
      mentions.push("repère manquant" + (cles && cles.length ? " (" + cles.join(", ") + ")" : "") + " : " + pourquoi + " ; montant laissé en brut");
      res.calculer = (v) => ({ ir: 0, ps: 0, abat_utilise: 0 });
      return res;
    };
    const exig = (...cles) => { const v = cles.map(lire); return v.some(z => z === undefined) ? null : v; };
    const gainDe = (v, b) => (c.base_inconnue ? 0 : Math.max(0, v - b));
    if (c.base_inconnue && !["courant", ...LIVRETS].includes(c.type)) mentions.push("prix de revient à compléter : aucun gain supposé, l'impôt est sous-estimé");
    const t = c.type, classe = c.classe;

    if (t === "courant") { res.regle = "sans_gain"; res.calculer = () => ({ ir: 0, ps: 0, abat_utilise: 0 }); return res; }
    if (LIVRETS.includes(t)) { res.regle = "exonere"; res.calculer = () => ({ ir: 0, ps: 0, abat_utilise: 0 }); return res; }

    if (t === "pel" || t === "cel") {
      const r = exig("ir_taux_forfaitaire", "ps_taux_av_epargne_logement");
      if (!r) return indispo("taux de l'épargne logement", ["ir_taux_forfaitaire", "ps_taux_av_epargne_logement"].filter(k => !L.idx[k]));
      const [ir, ps] = r;
      res.regle = "epargne_logement";
      const ouv = c.date_ouverture && O.estDate(c.date_ouverture) ? c.date_ouverture : null;
      res.calculer = (v, b, date) => {
        const g = gainDe(v, b);
        let irTaux = ir;
        if (t === "pel" && ouv && ouv < "2018-01-01") { const n = lire("pel_exoneration_ir_ans"); if (n != null && date < O.ajouterAns(ouv, n)) irTaux = 0; }
        return { ir: g * irTaux / 100, ps: g * ps / 100, abat_utilise: 0 };
      };
      return res;
    }

    if (PEA.includes(t)) {
      const r = exig("ir_taux_forfaitaire", "ps_taux_general", "pea_duree_ans");
      if (!r) return indispo("règles du PEA", ["ir_taux_forfaitaire", "ps_taux_general", "pea_duree_ans"].filter(k => !L.idx[k]));
      const [ir, ps] = r, seuil = datesSeuils(c, lire).pea_5_ans;
      res.seuil = seuil;
      if (!seuil) { mentions.push("date d'ouverture à compléter : fiscalité d'avant 5 ans appliquée"); res.confiance = "probable"; }
      res.regle = "pea_avant_5_ans";
      res.calculer = (v, b, date) => {
        const g = gainDe(v, b), apres = seuil && date >= seuil;
        return { ir: apres ? 0 : g * ir / 100, ps: g * ps / 100, abat_utilise: 0, apres };
      };
      res.regleA = date => (seuil && date >= seuil ? "pea_apres_5_ans" : "pea_avant_5_ans");
      res.clotureAvant = true;
      return res;
    }

    if (AV.includes(t)) {
      const r = exig("ir_taux_forfaitaire", "ps_taux_av_epargne_logement", "av_duree_ans", "av_taux_ir_reduit", "av_seuil_versements", "av_abattement_seul", "av_abattement_couple");
      if (!r) return indispo("règles de l'assurance-vie", ["ir_taux_forfaitaire", "ps_taux_av_epargne_logement", "av_duree_ans", "av_taux_ir_reduit", "av_seuil_versements", "av_abattement_seul", "av_abattement_couple"].filter(k => !L.idx[k]));
      const [ir, ps, , irRed, seuilPrimes, abSeul, abCouple] = r, seuil = datesSeuils(c, lire).av_8_ans;
      res.seuil = seuil; res.proportionnel = false;
      if (!seuil) { mentions.push("date d'ouverture à compléter : fiscalité d'avant 8 ans appliquée"); res.confiance = "probable"; }
      const primes = x.primes_titulaire != null ? +x.primes_titulaire : c.base;
      res.abattementAnnuel = x.couple ? abCouple : abSeul;
      res.regle = "av_avant_8_ans";
      res.calculer = (v, b, date, abat) => {
        const g = gainDe(v, b), apres = seuil && date >= seuil;
        if (!apres) return { ir: g * ir / 100, ps: g * ps / 100, abat_utilise: 0, apres: false };
        const frac = primes > seuilPrimes ? seuilPrimes / primes : 1;
        const g75 = g * frac, g128 = g - g75;
        let reste = abat != null ? Math.max(0, abat) : res.abattementAnnuel;
        const a75 = Math.min(g75, reste); reste -= a75;
        const a128 = Math.min(g128, reste);
        return { ir: (g75 - a75) * irRed / 100 + (g128 - a128) * ir / 100, ps: g * ps / 100, abat_utilise: a75 + a128, apres: true, fraction_7_5: frac };
      };
      res.regleA = date => (seuil && date >= seuil ? "av_apres_8_ans" : "av_avant_8_ans");
      return res;
    }

    if (t === "per") {
      const r = exig("ir_taux_forfaitaire", "ps_taux_general");
      if (!r) return indispo("règles du PER", ["ir_taux_forfaitaire", "ps_taux_general"].filter(k => !L.idx[k]));
      const [ir, ps] = r;
      let tmi = x.tmi_pct;
      if (tmi == null || !isFinite(+tmi)) { tmi = 30; mentions.push("taux marginal supposé de 30 %, à confirmer avec Claude"); res.confiance = "probable"; }
      const deduit = x.per_versements_deduits === false ? 0 : (c.versements_deduits != null ? +c.versements_deduits : c.base);
      res.regle = "per_capital"; res.disponible = false;
      mentions.push("bloqué jusqu'à la retraite, sauf achat de la résidence principale");
      res.calculer = (v, b) => {
        const d = Math.min(v, deduit * (c.base > 0 ? Math.min(1, b / c.base) : 1)), g = gainDe(v, b);
        return { ir: d * tmi / 100 + g * ir / 100, ps: g * ps / 100, abat_utilise: 0 };
      };
      return res;
    }

    if (t === "pee" || t === "percol") {
      const r = exig("ps_taux_epargne_salariale");
      if (!r) return indispo("prélèvements sociaux de l'épargne salariale", ["ps_taux_epargne_salariale"]);
      res.regle = "epargne_salariale"; res.disponible = t === "pee";
      res.calculer = (v, b) => ({ ir: 0, ps: gainDe(v, b) * r[0] / 100, abat_utilise: 0 });
      return res;
    }

    if (t === "scpi_direct" || t === "bien_autre") {
      const r = exig("pv_immo_ir_taux", "pv_immo_ps_taux");
      if (!r) return indispo("plus-values immobilières", ["pv_immo_ir_taux", "pv_immo_ps_taux"].filter(k => !L.idx[k]));
      const [ir, ps] = r, achat = c.date_achat && O.estDate(c.date_achat) ? c.date_achat : null;
      res.regle = "pv_immobiliere";
      if (t === "scpi_direct") { res.confiance = "probable"; mentions.push(MENTION_SCPI); }
      if (!achat) mentions.push("date d'achat à compléter : aucun abattement pour durée de détention");
      const seuilSurtaxe = lire("pv_immo_surtaxe_seuil");
      res.calculer = (v, b, date) => {
        const g = gainDe(v, b), ans = achat ? anneesPleines(achat, date) : 0;
        const out = { ir: g * (1 - abattementIR(ans)) * ir / 100, ps: g * (1 - abattementPS(ans)) * ps / 100, abat_utilise: 0 };
        if (seuilSurtaxe != null && g * (1 - abattementIR(ans)) > seuilSurtaxe) out.surtaxe = true;
        return out;
      };
      res.disponible = t !== "scpi_direct";
      res.nonRetirable = true;
      return res;
    }

    if (t === "compte_titres" || t == null || t === "autre") {
      if (classe === "crypto") {
        const r = exig("ir_taux_forfaitaire", "ps_taux_actifs_numeriques");
        if (!r) return indispo("règles des actifs numériques", ["ir_taux_forfaitaire", "ps_taux_actifs_numeriques"].filter(k => !L.idx[k]));
        res.regle = "actifs_numeriques";
        res.calculer = (v, b) => { const g = gainDe(v, b); return { ir: g * r[0] / 100, ps: g * r[1] / 100, abat_utilise: 0 }; };
        return res;
      }
      if (t === "compte_titres") {
        const r = exig("ir_taux_forfaitaire", "ps_taux_general");
        if (!r) return indispo("règles du compte-titres", ["ir_taux_forfaitaire", "ps_taux_general"].filter(k => !L.idx[k]));
        res.regle = "pfu";
        res.calculer = (v, b) => { const g = gainDe(v, b); return { ir: g * r[0] / 100, ps: g * r[1] / 100, abat_utilise: 0 }; };
        return res;
      }
      return indispo("type d'enveloppe à compléter", []);
    }
    return indispo("type d'enveloppe non géré (" + t + ")", []);
  }

  /** Sources (titre, URL, vérifié le) des repères utilisés par une préparation. */
  function sourcesDe(prep) {
    return [...prep.reperes.utilises.entries()].map(([cle, r]) => ({ cle, titre: r.sourceTitre || null, url: r.sourceUrl || null, verifie_le: r.verifieLe || null }));
  }

  /** Fiscalité d'une sortie totale du compartiment à `date`.
      → { brut, impot_revenu, prelevements_sociaux, total, net, regle, disponible, sources, confiance, avertissements, abattement_utilise }.
      Repère manquant : net null, brut inchangé, regle « indisponible », jamais une valeur de secours. */
  function fiscaliteSortie(c, date, ctx) {
    const x = ctx || {}, prep = preparer(c, x), v = +c.valeur || 0, b = c.base != null ? +c.base : v;
    const o = prep.calculer(v, b, date, x.abattement_restant);
    const regle = prep.regleA ? prep.regleA(date) : prep.regle;
    const out = { brut: v, impot_revenu: O.arrondi2(o.ir), prelevements_sociaux: O.arrondi2(o.ps), total: O.arrondi2(o.ir + o.ps), net: null, regle,
      disponible: prep.disponible, sources: sourcesDe(prep), confiance: prep.indisponible ? "indisponible" : prep.confiance,
      avertissements: prep.mentions.slice(), abattement_utilise: o.abat_utilise || 0 };
    if (!prep.indisponible) out.net = O.arrondi2(v - o.ir - o.ps);
    if (o.fraction_7_5 != null) out.fraction_7_5 = o.fraction_7_5;
    if (o.surtaxe) out.avertissements.push("surtaxe sur les plus-values immobilières élevées : non calculée");
    return out;
  }

  /** Brut à retirer pour obtenir `net` (≤ net de la sortie totale), par résolution exacte pour les règles proportionnelles, dichotomie sinon. */
  function brutPourNet(prep, c, net, date, abat) {
    const v = +c.valeur, b = c.base != null ? +c.base : v;
    const tot = prep.calculer(v, b, date, abat);
    if (v - tot.ir - tot.ps <= net + 1e-9) return v;
    if (prep.proportionnel) return net / (1 - (tot.ir + tot.ps) / v);
    let lo = 0, hi = v;
    for (let k = 0; k < 60; k++) {
      const m = (lo + hi) / 2, f = m / v, o = prep.calculer(m, b * f, date, abat);
      if (m - o.ir - o.ps < net) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  /* ------------------------------------------------------------------ ordre de retrait (spec § 6.3) */
  const NIVEAU_JAMAIS = 99;
  /** Niveau de retrait d'un compartiment à `date` : 1 disponible au-dessus du matelas, 2 compte-titres / assurance-vie après 8 ans / PEA après 5 ans /
      épargne salariale disponible, 3 assurance-vie avant 8 ans, 4 PER (résidence principale seulement), 5 matelas (traité à part), 6 PEA avant 5 ans
      (si la clôture est autorisée), 99 jamais (bien immobilier, SCPI en direct, PERCOL, PER hors résidence principale). */
  function niveauRetrait(c, date, opts) {
    const o = opts || {}, p = c.prep, t = c.type;
    if (c.dispo) return 1;
    if (AV.includes(t)) return p.seuil && date >= p.seuil ? 2 : 3;
    if (PEA.includes(t)) return p.seuil && date >= p.seuil ? 2 : o.autoriser_cloture_pea ? 6 : NIVEAU_JAMAIS;
    if (t === "per") return o.rp ? 4 : NIVEAU_JAMAIS;
    if (t === "pee") return c.pee_disponible === false ? NIVEAU_JAMAIS : 2;
    if (t === "percol" || t === "scpi_direct" || t === "bien_autre" || p.nonRetirable) return NIVEAU_JAMAIS;
    return 2;
  }
  /** Retire `besoinNet` (net d'impôts) des compartiments dans l'ordre du § 6.3. comps : [{ id, enveloppe, type, valeur, base, dispo, prep }] (non modifiés).
      opts : { date, matelas, rp, autoriser_cloture_pea, abattement (restant de l'année), niveau_max (défaut 6) }. besoinNet peut être Infinity (mobilisable).
      → { sources: [{ id, enveloppe, niveau, brut, net, gain, impot_revenu, prelevements_sociaux, impots, cloture? }], net_obtenu, impots, manque, excedent_au_disponible, abattement_utilise, matelas_utilise }. */
  function planRetrait(comps, besoinNet, opts) {
    const o = opts || {}, date = o.date, max = o.niveau_max || 6;
    const L = comps.map(c => ({ c, v: +c.valeur || 0, b: c.base != null ? +c.base : +c.valeur || 0 }));
    const out = { sources: [], net_obtenu: 0, impots: 0, manque: 0, excedent_au_disponible: 0, abattement_utilise: 0, matelas_utilise: 0 };
    let abat = o.abattement != null ? o.abattement : null, reste = besoinNet;
    const ajoute = (x, niveau, brut, net, t, extra) => {
      const gain = x.v > 0 ? Math.max(0, x.v - x.b) * brut / x.v : 0;
      const ligne = out.sources.find(s => s.id === x.c.id && s.niveau === niveau);
      if (ligne) { ligne.brut += brut; ligne.net += net; ligne.gain += gain; ligne.impot_revenu += t.ir; ligne.prelevements_sociaux += t.ps; ligne.impots += t.ir + t.ps; return; }
      out.sources.push(Object.assign({ id: x.c.id, enveloppe: x.c.enveloppe, niveau, brut, net, gain, impot_revenu: t.ir, prelevements_sociaux: t.ps, impots: t.ir + t.ps }, extra || {}));
    };
    /* retire jusqu'à `net` du compartiment x ; renvoie le net obtenu */
    function prendre(x, net, niveau, tout) {
      if (!(x.v > 1e-9) || !(net > 0)) return 0;
      const prep = x.c.prep, vide = { ir: 0, ps: 0, abat_utilise: 0 };
      const pleine = prep.calculer(x.v, x.b, date, abat);
      let brut = tout || x.v - pleine.ir - pleine.ps <= net + 1e-9 ? x.v : brutPourNet(prep, { valeur: x.v, base: x.b }, net, date, abat);
      const f = brut / x.v, t = brut === x.v ? pleine : prep.calculer(brut, x.b * f, date, abat);
      const obtenu = brut - t.ir - t.ps;
      if (abat != null) abat -= t.abat_utilise || 0;
      out.abattement_utilise += t.abat_utilise || 0;
      ajoute(x, niveau, brut, obtenu, t, tout && niveau === 6 ? { cloture: true } : null);
      x.b -= x.b * f; x.v -= brut;
      if (x.v < 1e-9) { x.v = 0; x.b = 0; }
      return obtenu;
    }
    const coutDe = x => {
      const g = Math.min(x.v, isFinite(reste) ? Math.max(reste, 1) : x.v);
      if (!(g > 0)) return Infinity;
      const t = x.c.prep.calculer(g, x.b * g / x.v, date, abat);
      return (t.ir + t.ps) / Math.max(1e-9, g - t.ir - t.ps);
    };
    const dispos = L.filter(x => x.c.dispo);
    const dispoTotal = () => dispos.reduce((a, x) => a + x.v, 0);
    const M = Math.max(0, +o.matelas || 0);
    /* niveau 1 : disponible au-dessus du matelas */
    let autorise = Math.max(0, dispoTotal() - M);
    for (const x of dispos) {
      if (!(reste > 0) || !(autorise > 0)) break;
      const prise = Math.min(reste, autorise, Math.max(0, x.v));
      if (prise > 0) { x.v -= prise; ajoute(x, 1, prise, prise, { ir: 0, ps: 0 }); reste -= prise; autorise -= prise; out.net_obtenu += prise; }
    }
    for (const niveau of [2, 3, 4]) {
      if (niveau > max || !(reste > 0)) continue;
      const cand = L.filter(x => !x.c.dispo && x.v > 0 && niveauRetrait(x.c, date, o) === niveau).map((x, k) => ({ x, k, cout: coutDe(x) }))
        .sort((a, b) => a.cout - b.cout || a.k - b.k);
      for (const { x } of cand) { if (!(reste > 0)) break; const net = prendre(x, reste, niveau, false); out.net_obtenu += net; reste -= net; }
    }
    /* niveau 5 : matelas */
    if (max >= 5 && reste > 0) {
      for (const x of dispos) {
        if (!(reste > 0)) break;
        const prise = Math.min(reste, Math.max(0, x.v));
        if (prise > 0) { x.v -= prise; ajoute(x, 5, prise, prise, { ir: 0, ps: 0 }); reste -= prise; out.net_obtenu += prise; out.matelas_utilise += prise; }
      }
    }
    /* niveau 6 : PEA avant 5 ans, clôture autorisée : tout le plan est liquidé */
    if (max >= 6 && reste > 0) {
      const cand = L.filter(x => x.v > 0 && niveauRetrait(x.c, date, o) === 6);
      for (const x of cand) {
        if (!(reste > 0)) break;
        const net = prendre(x, reste, 6, true);
        out.net_obtenu += net;
        const utile = Math.min(net, reste);
        reste -= utile;
        out.excedent_au_disponible += net - utile;
      }
    }
    out.manque = isFinite(reste) ? Math.max(0, reste) : 0;
    out.impots = out.sources.reduce((a, s) => a + s.impots, 0);
    out.restes = L.map(x => ({ id: x.c.id, valeur: x.v, base: x.b }));
    return out;
  }

  return { PEA, AV, LIVRETS, MENTION_SCPI, lecteur, abattementIR, abattementPS, datesSeuils, preparer, sourcesDe, fiscaliteSortie, brutPourNet, niveauRetrait, planRetrait, NIVEAU_JAMAIS };
});
});

/* ---------- web/src/projection-evenements.js ---------- */
def("projection-evenements", function (module, exports, require) {
/* Événements de vie du moteur de projection (PROJ, spec § 7) : catalogue des types, validation (mêmes règles et mêmes messages que la
   base — appliquer_propositions, migration 0030 —, le store démo et l'outil decrire_foyer) et valeurs par défaut sourcées.
   Pur, sans DOM, au tutoiement. Global ProjectionEvenements ; copié tel quel dans le connecteur (npm run gen).
   Les effets chiffrés des événements (revenus, dépenses, apport, crédit) sont dans projection.js, qui lit ce catalogue. */
(function (root, factory) {
  const O = typeof module === "object" && module.exports ? require("./projection-outils.js") : root.ProjectionOutils;
  const Marche = typeof module === "object" && module.exports ? require("./marche.js") : root.Marche;
  const api = factory(O, Marche);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ProjectionEvenements = api;
})(typeof self !== "undefined" ? self : this, function (O, Marche) {
  "use strict";

  const TYPES_V1 = ["naissance", "creche", "scolarite_privee", "achat_immobilier", "retrait", "hausse_revenu", "fin_credit", "crise", "changement_emploi", "conge_parental"];
  const TYPES_RESERVES = ["chomage", "separation", "invalidite", "retraite", "heritage", "temps_partiel", "demenagement"];
  const PERSONNES = ["p1", "p2", "foyer"];
  const MODES_CRECHE = ["psu", "assistante_maternelle", "montant"];
  const NIVEAUX = ["maternelle", "elementaire", "college", "lycee", "superieur"];
  const USAGES = ["rp", "locatif", "secondaire"];
  const ACTIVITES = ["arret", "mi_temps", "temps_partiel"];
  const DATE_MIN = "1950-01-01";
  const LIMITE_EVENEMENTS = 100, LIMITE_VARIANTES = 10, LIMITE_PAR_APPEL = 10;

  const M = {
    type_reserve: "Ce type d'événement n'est pas encore pris en compte par la projection.",
    personne: "La personne doit être p1, p2 ou foyer.",
    libelle: "Le libellé doit faire de 1 à 60 caractères.",
    date: "La date doit être comprise entre le 1er janvier 1950 et dans 40 ans.",
    fin: "La date de fin doit être postérieure ou égale à la date de début.",
    source: "Indique la source de l'information (1 à 300 caractères).",
    params: "Les paramètres de l'événement doivent former un objet.",
    montants: "Les montants doivent être positifs ou nuls.",
    enfant: "Donne un libellé court pour l'enfant (1 à 40 caractères), par exemple « Enfant 2 ».",
    pct: "Les pourcentages doivent être compris entre 0 et 100.",
    p1p2: "Indique la personne concernée : p1 ou p2.",
  };
  M.type_inconnu = "Type d'événement inconnu : choisis parmi " + TYPES_V1.join(", ") + ".";

  const estObjet = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const liste = v => (Array.isArray(v) ? v : []);
  const nombre = v => O.estNombre(v);
  const present = v => v !== undefined && v !== null && v !== "";
  /** Message de la base de la même règle ; null si tout va bien. */
  const dansLeTexte = (v, a, b) => typeof v === "string" && v.trim().length >= a && v.trim().length <= b;

  /** Valide un événement { type, personne, libelle, date, fin?, params, source } ; contexte = { today?, credits?, biens? } (crédits et biens
      de l'utilisateur, pour fin_credit). → null si valide, sinon le message (français, tutoiement). */
  function validerEvenement(ev, contexte) {
    const c = contexte || {};
    if (!estObjet(ev)) return "L'événement doit être un objet.";
    if (TYPES_RESERVES.includes(ev.type)) return M.type_reserve;
    if (!TYPES_V1.includes(ev.type)) return M.type_inconnu;
    if (!PERSONNES.includes(ev.personne)) return M.personne;
    if (!dansLeTexte(ev.libelle, 1, 60)) return M.libelle;
    const today = O.estDate(c.today) ? c.today : new Date().toISOString().slice(0, 10);
    const max = O.ajouterAns(today, 40);
    if (!O.estDate(ev.date) || ev.date < DATE_MIN || ev.date > max) return M.date;
    if (present(ev.fin)) {
      if (!O.estDate(ev.fin) || ev.fin > max) return M.date;
      if (ev.fin < ev.date) return M.fin;
    }
    if (!dansLeTexte(ev.source, 1, 300)) return M.source;
    const p = ev.params === undefined ? {} : ev.params;
    if (!estObjet(p)) return M.params;
    return ENTREES[ev.type].valider(ev, p, c);
  }

  /* -------- règles communes -------- */
  const positifOuNul = (p, cles) => cles.every(k => !present(p[k]) || (nombre(p[k]) && +p[k] >= 0));
  const entre0et100 = v => !present(v) || (nombre(v) && +v >= 0 && +v <= 100);
  function enfantOk(p) { return dansLeTexte(p.enfant, 1, 40); }
  const personneParams = (ev, p) => (present(p.personne) ? p.personne : ev.personne);
  const personneUnique = (ev, p) => { const x = personneParams(ev, p); return x === "p1" || x === "p2"; };

  /* -------- catalogue : un type = une entrée { type, parametres, valider, titre, icone, defauts } -------- */
  const ENTREES = {
    naissance: {
      type: "naissance", icone: "enfant", titre: "Naissance",
      parametres: ["enfant", "cout_mode", "cout_mensuel", "fin_age"],
      defauts: [{ cle: "cout_mode", valeur: "uc" }, { cle: "fin_age", repere: "enfant_fin_charge_age" }],
      valider(ev, p) {
        if (!enfantOk(p)) return M.enfant;
        const mode = present(p.cout_mode) ? p.cout_mode : "uc";
        if (mode !== "uc" && mode !== "montant") return "Choisis le mode de coût : « uc » (échelle de l'Insee) ou « montant ».";
        if (!positifOuNul(p, ["cout_mensuel"])) return M.montants;
        if (mode === "montant" && !present(p.cout_mensuel)) return "Indique le coût mensuel de l'enfant.";
        if (present(p.fin_age) && !(nombre(p.fin_age) && +p.fin_age >= 1 && +p.fin_age <= 30)) return "L'âge de fin de charge doit être compris entre 1 et 30 ans.";
        return null;
      },
    },
    creche: {
      type: "creche", icone: "enfant", titre: "Garde du jeune enfant",
      parametres: ["enfant", "mode", "heures_mois", "ressources_mensuelles", "cout_mensuel", "cmg_mensuel"],
      defauts: [{ cle: "mode", valeur: "psu" }, { cle: "heures_mois", repere: "creche_heures_mois" }],
      valider(ev, p) {
        if (!enfantOk(p)) return M.enfant;
        const mode = present(p.mode) ? p.mode : "psu";
        if (!MODES_CRECHE.includes(mode)) return "Choisis le mode de garde : « psu » (crèche), « assistante_maternelle » ou « montant ».";
        if (!positifOuNul(p, ["heures_mois", "ressources_mensuelles", "cout_mensuel", "cmg_mensuel"])) return M.montants;
        if (mode === "assistante_maternelle" && !present(p.cout_mensuel)) return "Indique le coût mensuel de l'assistante maternelle (salaire et indemnités), avant l'aide de la Caf.";
        if (mode === "montant" && !present(p.cout_mensuel)) return "Indique le coût mensuel de la garde.";
        return null;
      },
    },
    scolarite_privee: {
      type: "scolarite_privee", icone: "ecole", titre: "École privée",
      parametres: ["enfant", "niveau", "frais_annuels"], defauts: [],
      valider(ev, p) {
        if (!enfantOk(p)) return M.enfant;
        if (!NIVEAUX.includes(p.niveau)) return "Choisis le niveau : « maternelle », « elementaire », « college », « lycee » ou « superieur ».";
        if (!positifOuNul(p, ["frais_annuels"])) return M.montants;
        if (!present(p.frais_annuels)) return "Indique les frais annuels de l'établissement : il n'existe pas de moyenne officielle.";
        return null;
      },
    },
    achat_immobilier: {
      type: "achat_immobilier", icone: "maison", titre: "Achat immobilier",
      parametres: ["prix", "usage", "neuf", "primo", "apport", "autoriser_cloture_pea", "pret", "loyer_remplace", "charges_mensuelles", "loyer_percu", "libelle"],
      defauts: [{ cle: "usage", valeur: "rp" }, { cle: "assurance_pct", repere: "assurance_emprunteur_defaut_pct" }, { cle: "taux_pct", repere: "taux_credit_immo_<durée>" },
        { cle: "frais_acquisition_pct", repere: "frais_acquisition_<ancien|primo|neuf>_pct" }],
      valider(ev, p) {
        const pret = estObjet(p.pret) ? p.pret : {};
        if (!positifOuNul(p, ["prix", "loyer_remplace", "charges_mensuelles", "loyer_percu"]) || (nombre(p.apport) && +p.apport < 0) ||
          !positifOuNul(pret, ["taux_pct", "assurance_pct"])) return M.montants;
        if (!present(p.prix) || !nombre(p.prix)) return "Indique le prix du bien.";
        if (present(p.usage) && !USAGES.includes(p.usage)) return "Choisis l'usage du bien : « rp », « locatif » ou « secondaire ».";
        if (!(p.apport === "max" || nombre(p.apport))) return "Indique l'apport : un montant, ou « max » pour tout le disponible au-dessus du matelas.";
        if (!(nombre(pret.duree_ans) && +pret.duree_ans >= 1 && +pret.duree_ans <= 40)) return "Indique la durée du prêt en années (de 1 à 40).";
        if (!present(p.charges_mensuelles)) return "Indique les charges mensuelles du bien (taxe foncière, copropriété, entretien).";
        return null;
      },
    },
    retrait: {
      type: "retrait", icone: "retrait", titre: "Retrait ponctuel",
      parametres: ["montant", "libelle", "autoriser_cloture_pea"], defauts: [],
      valider(ev, p) {
        if (!positifOuNul(p, ["montant"])) return M.montants;
        if (!present(p.montant)) return "Indique le montant du retrait.";
        return null;
      },
    },
    hausse_revenu: {
      type: "hausse_revenu", icone: "emploi", titre: "Variation de revenu",
      parametres: ["personne", "delta_mensuel", "delta_pct", "part_epargnee_pct"], defauts: [{ cle: "part_epargnee_pct", valeur: 50 }],
      valider(ev, p) {
        if (!personneUnique(ev, p)) return M.p1p2;
        if (!(nombre(p.delta_mensuel) || nombre(p.delta_pct))) return "Indique la variation du revenu : delta_mensuel (€ par mois, net) ou delta_pct.";
        if (!entre0et100(p.part_epargnee_pct)) return M.pct;
        return null;
      },
    },
    fin_credit: {
      type: "fin_credit", icone: "cle", titre: "Fin de crédit",
      parametres: ["credit", "part_reaffectee_epargne_pct", "date_fin"], defauts: [{ cle: "part_reaffectee_epargne_pct", valeur: 100 }],
      valider(ev, p, c) {
        const m = typeof p.credit === "string" ? /^(credit|bien):(.+)$/.exec(p.credit) : null;
        const liste = m ? (m[1] === "credit" ? c.credits : c.biens) : null;
        if (!m || !Array.isArray(liste) || !liste.some(x => x && String(x.id) === m[2])) return "Ce crédit n'existe pas dans tes données.";
        if (!entre0et100(p.part_reaffectee_epargne_pct)) return M.pct;
        if (present(p.date_fin) && !O.estDate(p.date_fin)) return M.date;
        return null;
      },
    },
    crise: {
      type: "crise", icone: "crise", titre: "Crise rejouée",
      parametres: ["cle"], defauts: [],
      valider(ev, p) {
        const cles = Object.keys(Marche.CRISES);
        if (!cles.includes(p.cle)) return "Crise inconnue : choisis parmi " + cles.join(", ") + ".";
        return null;
      },
    },
    changement_emploi: {
      type: "changement_emploi", icone: "emploi", titre: "Changement d'emploi",
      parametres: ["personne", "salaire_net_mensuel", "revenu_reference_mensuel", "part_epargnee_pct"],
      defauts: [{ cle: "part_epargnee_pct", valeur: 50 }, { cle: "revenu_reference_mensuel", valeur: "salaire du profil" }],
      valider(ev, p) {
        if (!personneUnique(ev, p)) return M.p1p2;
        if (!positifOuNul(p, ["salaire_net_mensuel", "revenu_reference_mensuel"])) return M.montants;
        if (!present(p.salaire_net_mensuel)) return "Indique le salaire net mensuel du nouvel emploi (0 pour une période sans revenu).";
        if (!entre0et100(p.part_epargnee_pct)) return M.pct;
        return null;
      },
    },
    conge_parental: {
      type: "conge_parental", icone: "enfant", titre: "Congé parental",
      parametres: ["personne", "activite", "quotite_pct", "enfant", "rang_enfant"],
      defauts: [{ cle: "quotite_pct", valeur: "0 % (arrêt), 50 % (mi-temps) ou 80 % (temps partiel)" }, { cle: "prepare", repere: "prepare_taux_plein" }],
      valider(ev, p) {
        if (!personneUnique(ev, p)) return M.p1p2;
        if (!ACTIVITES.includes(p.activite)) return "Choisis l'activité pendant le congé : « arret », « mi_temps » (50 % au plus) ou « temps_partiel » (de 50 à 80 %).";
        if (!present(ev.fin)) return "Indique la date de fin du congé parental.";
        if (!entre0et100(p.quotite_pct)) return M.pct;
        if (present(p.rang_enfant) && !(nombre(p.rang_enfant) && +p.rang_enfant >= 1 && Number.isInteger(+p.rang_enfant))) return "Le rang de l'enfant doit être un entier supérieur ou égal à 1.";
        return null;
      },
    },
  };

  /* -------- variantes -------- */
  const HYPOTHESES_VARIANTE = ["epargne_delta_mensuel", "reste_capacite", "reequilibrage", "part_reaffectee_epargne_pct", "part_hausse_epargnee_pct",
    "salaire_croissance_reelle_pct", "hypotheses_classes"];
  const CLASSES_HYPOTHESES = () => Marche.CLES.filter(k => k !== "levier").concat(["actions_nasdaq100", "immobilier_physique"]);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /** Valide une variante { nom, description?, retire?, hypotheses? } → null ou message. */
  function validerVariante(v) {
    if (!estObjet(v)) return "La variante doit être un objet.";
    if (!dansLeTexte(v.nom, 1, 40)) return "Le nom de la variante doit faire de 1 à 40 caractères.";
    if (present(v.description) && !(typeof v.description === "string" && v.description.length <= 300)) return "La description de la variante doit faire 300 caractères au plus.";
    if (present(v.retire) && !(Array.isArray(v.retire) && v.retire.every(x => typeof x === "string" && UUID.test(x)))) return "« retire » doit être une liste d'identifiants d'événements.";
    const h = v.hypotheses === undefined || v.hypotheses === null ? {} : v.hypotheses;
    if (!estObjet(h)) return "Les hypothèses de la variante doivent former un objet.";
    const inconnue = Object.keys(h).find(k => !HYPOTHESES_VARIANTE.includes(k));
    if (inconnue) return "Hypothèse inconnue : « " + inconnue + " ». Choisis parmi " + HYPOTHESES_VARIANTE.join(", ") + ".";
    if (present(h.epargne_delta_mensuel) && !(nombre(h.epargne_delta_mensuel) && Math.abs(+h.epargne_delta_mensuel) <= 100000)) return "La variation d'épargne mensuelle doit être comprise entre −100 000 et 100 000 €.";
    if (present(h.reste_capacite) && !["cible", "disponible"].includes(h.reste_capacite)) return "« reste_capacite » vaut « cible » ou « disponible ».";
    if (present(h.reequilibrage) && !["aucun", "annuel"].includes(h.reequilibrage)) return "« reequilibrage » vaut « aucun » ou « annuel ».";
    if (!entre0et100(h.part_reaffectee_epargne_pct) || !entre0et100(h.part_hausse_epargnee_pct)) return M.pct;
    if (present(h.salaire_croissance_reelle_pct) && !(nombre(h.salaire_croissance_reelle_pct) && Math.abs(+h.salaire_croissance_reelle_pct) <= 10)) return "La hausse réelle des salaires doit être comprise entre −10 et 10 % par an.";
    if (present(h.hypotheses_classes)) {
      if (!estObjet(h.hypotheses_classes)) return "« hypotheses_classes » doit être un objet { classe: { rendement, volatilite } }.";
      for (const [k, x] of Object.entries(h.hypotheses_classes)) {
        if (!CLASSES_HYPOTHESES().includes(k)) return "Classe inconnue : « " + k + " ».";
        if (!estObjet(x)) return "Chaque classe attend { rendement?, volatilite? }.";
        if (present(x.rendement) && !(nombre(x.rendement) && +x.rendement >= -50 && +x.rendement <= 100)) return "Le rendement doit être compris entre −50 et 100 % par an.";
        if (present(x.volatilite) && !(nombre(x.volatilite) && +x.volatilite >= 0 && +x.volatilite <= 200)) return "La volatilité doit être comprise entre 0 et 200 % par an.";
      }
    }
    return null;
  }

  /** Valeurs par défaut sourcées d'un événement, pour que le Copilote les dise : [{ cle, valeur, source?, verifie_le? }]. reperes : index ou liste. */
  function defautsDe(ev, reperes) {
    const idx = Array.isArray(reperes) ? O.indexReperes(reperes) : reperes || {};
    const entree = ENTREES[ev && ev.type];
    if (!entree) return [];
    const p = (ev && ev.params) || {};
    return entree.defauts.filter(d => !present(p[d.cle])).map(d => {
      if (d.repere && idx[d.repere]) { const r = idx[d.repere]; return { cle: d.cle, valeur: +r.valeur, unite: r.unite, source: r.sourceTitre || null, verifie_le: r.verifieLe || null, repere: d.repere }; }
      if (d.repere) return { cle: d.cle, valeur: null, repere: d.repere, manquant: true };
      return { cle: d.cle, valeur: d.valeur, source: "hypothèse de Boussole, dite comme telle" };
    });
  }


  /* -------- réglages de projection du foyer (config.projection, proposition de la cible config) : mêmes règles et messages que la migration 0031 -------- */
  const CHAMPS_PROJECTION = ["base_capacite", "capacite_mensuelle", "reste_capacite", "reequilibrage", "part_reaffectee_epargne_pct", "part_hausse_epargnee_pct",
    "salaire_croissance_reelle_pct", "tmi_pct", "per_versements_deduits", "assurance_pct", "biens", "source", "le"];
  /** Fusionne `v` (la clé « projection » d'une proposition de réglages) dans `actuel` (config.projection) champ par champ ; null retire un champ.
      contexte : { today (AAAA-MM-JJ), biens (liste des biens de l'utilisateur, avec id) }. → { projection } ou { erreur: message }. */
  function fusionnerReglagesProjection(actuel, v, contexte) {
    const c = contexte || {}, auj = O.estDate(c.today) ? c.today : new Date().toISOString().slice(0, 10);
    if (!estObjet(v)) return { erreur: "projection : objet attendu" };
    if (!Object.keys(v).length) return { erreur: "projection : au moins un réglage attendu" };
    const proj = estObjet(actuel) ? JSON.parse(JSON.stringify(actuel)) : {};
    const nb = x => (O.estNombre(x) && typeof x !== "boolean" ? +x : null);
    const texte = x => (typeof x === "string" ? x.trim().replace(/\s+/g, " ") : "");
    for (const [k, val] of Object.entries(v)) {
      if (!CHAMPS_PROJECTION.includes(k)) return { erreur: "projection : champ « " + k + " » inconnu (" + CHAMPS_PROJECTION.join(", ") + ")" };
      if (val === null) { delete proj[k]; continue; }
      if (k === "base_capacite") { if (!["reel", "prevu", "montant"].includes(val)) return { erreur: "projection : base_capacite invalide (reel, prevu ou montant attendu)" }; proj[k] = val; }
      else if (k === "reste_capacite") { if (!["cible", "disponible"].includes(val)) return { erreur: "projection : reste_capacite invalide (cible ou disponible attendu)" }; proj[k] = val; }
      else if (k === "reequilibrage") { if (!["aucun", "annuel"].includes(val)) return { erreur: "projection : reequilibrage invalide (aucun ou annuel attendu)" }; proj[k] = val; }
      else if (k === "capacite_mensuelle") { const n = nb(val); if (n === null || n < -100000 || n > 100000) return { erreur: "projection : capacite_mensuelle invalide (montant de −100 000 à 100 000 € attendu)" }; proj[k] = n; }
      else if (["part_reaffectee_epargne_pct", "part_hausse_epargnee_pct", "assurance_pct"].includes(k)) { const n = nb(val); if (n === null || n < 0 || n > 100) return { erreur: "projection : " + k + " invalide (pourcentage de 0 à 100 attendu)" }; proj[k] = n; }
      else if (k === "salaire_croissance_reelle_pct") { const n = nb(val); if (n === null || n < -10 || n > 10) return { erreur: "projection : salaire_croissance_reelle_pct invalide (de −10 à 10 % par an attendu)" }; proj[k] = n; }
      else if (k === "tmi_pct") { const n = nb(val); if (n === null || ![0, 11, 30, 41, 45].includes(n)) return { erreur: "projection : tmi_pct invalide (0, 11, 30, 41 ou 45 attendu)" }; proj[k] = n; }
      else if (k === "per_versements_deduits") { if (typeof val !== "boolean") return { erreur: "projection : per_versements_deduits invalide (vrai ou faux attendu)" }; proj[k] = val; }
      else if (k === "source") { const t = texte(val); if (!t || t.length > 300) return { erreur: "projection : source invalide (1 à 300 caractères attendus)" }; proj[k] = t; }
      else if (k === "le") { if (!O.estDate(val)) return { erreur: "projection : date (le) invalide (AAAA-MM-JJ)" }; if (val > auj) return { erreur: "projection : date (le) dans le futur (la date du document consulté est attendue)" }; proj[k] = val; }
      else {
        if (!estObjet(val)) return { erreur: "projection.biens : objet { bien:<identifiant>: informations } attendu" };
        if (Object.keys(val).length > 50) return { erreur: "projection.biens : 50 biens au plus" };
        const row = estObjet(proj.biens) ? proj.biens : {};
        for (const [cle, item] of Object.entries(val)) {
          if (!/^bien:.+$/.test(cle)) return { erreur: "projection.biens : clé « " + cle + " » invalide (bien:<identifiant> attendu)" };
          if (item === null) { delete row[cle]; continue; }
          if (!liste(c.biens).some(b => b && "bien:" + b.id === cle)) return { erreur: "projection.biens : bien « " + cle + " » introuvable" };
          if (!estObjet(item)) return { erreur: "projection.biens « " + cle + " » : objet ou null attendu" };
          const inconnu = Object.keys(item).find(x => !["prix_achat", "date_achat", "source", "le"].includes(x));
          if (inconnu) return { erreur: "projection.biens « " + cle + " » : champ « " + inconnu + " » inconnu (prix_achat, date_achat, source, le)" };
          const prix = nb(item.prix_achat);
          if (prix === null || prix <= 0) return { erreur: "projection.biens « " + cle + " » : prix_achat invalide (montant strictement positif attendu)" };
          if (!O.estDate(item.date_achat)) return { erreur: "projection.biens « " + cle + " » : date_achat invalide (AAAA-MM-JJ)" };
          if (item.date_achat < "1900-01-01") return { erreur: "projection.biens « " + cle + " » : date_achat antérieure à 1900" };
          if (item.date_achat > auj) return { erreur: "projection.biens « " + cle + " » : date_achat dans le futur" };
          const src = texte(item.source);
          if (!src || src.length > 300) return { erreur: "projection.biens « " + cle + " » : source obligatoire (1 à 300 caractères)" };
          let le = auj;
          if (item.le !== undefined && item.le !== null) {
            if (!O.estDate(item.le)) return { erreur: "projection.biens « " + cle + " » : date (le) invalide (AAAA-MM-JJ)" };
            if (item.le > auj) return { erreur: "projection.biens « " + cle + " » : date (le) dans le futur (la date du document consulté est attendue)" };
            le = item.le;
          }
          row[cle] = { prix_achat: prix, date_achat: item.date_achat, source: src, le };
        }
        if (Object.keys(row).length > 50) return { erreur: "projection.biens : 50 biens au plus (" + Object.keys(row).length + " après fusion)" };
        if (Object.keys(row).length === 0) delete proj.biens; else proj.biens = row;
      }
    }
    if (typeof v.source === "string" && !("le" in v)) proj.le = auj;
    return { projection: proj };
  }

  return { CHAMPS_PROJECTION, fusionnerReglagesProjection, TYPES_V1, TYPES_RESERVES, PERSONNES, MODES_CRECHE, NIVEAUX, USAGES, ACTIVITES, MESSAGES: M, LIMITE_EVENEMENTS, LIMITE_VARIANTES, LIMITE_PAR_APPEL,
    HYPOTHESES_VARIANTE, ENTREES, validerEvenement, validerVariante, defautsDe };
});
});

/* ---------- web/src/projection-credit.js ---------- */
def("projection-credit", function (module, exports, require) {
/* Crédits du moteur de projection (PROJ, spec § 6.4 et § 8) : annuité, tableau d'amortissement mensuel (taux nominal proportionnel,
   échéance constante, assurance sur le capital initial), durée et taux déduits d'un crédit en cours. La capacité d'emprunt (IMMO1)
   et le code de crédit de la Toise (planPret, ptz, taeg) sont ajoutés dans ce fichier à la tâche 7.
   Pur, sans DOM. Global ProjectionCredit ; copié tel quel dans le connecteur (npm run gen). */
(function (root, factory) {
  const O = typeof module === "object" && module.exports ? require("./projection-outils.js") : root.ProjectionOutils;
  const api = factory(O);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ProjectionCredit = api;
})(typeof self !== "undefined" ? self : this, function (O) {
  "use strict";

  /** Annuité (part du capital emprunté) d'un prêt à taux nominal annuel `tauxPct` sur `annees` ans : i / (1 − (1 + i)^−n), i = taux / 12. */
  function annuite(tauxPct, annees) {
    const i = tauxPct / 100 / 12, n = annees * 12;
    return i === 0 ? 1 / n : i / (1 - Math.pow(1 + i, -n));
  }
  /** Échéance mensuelle (hors assurance) d'un capital sur `dureeMois` mois. */
  function echeance(capital, tauxPct, dureeMois) {
    const i = tauxPct / 100 / 12;
    return i === 0 ? capital / dureeMois : capital * i / (1 - Math.pow(1 + i, -dureeMois));
  }

  /** Tableau d'amortissement mensuel. → [{ mois (1…n), date, interets, capital, assurance, echeance (hors assurance), crd }].
      `debut` = date de la première échéance ; date(k) = debut + (k − 1) mois. */
  function amortissement(p) {
    const C = +p.capital, n = Math.round(+p.duree_mois), i = (+p.taux_pct || 0) / 100 / 12;
    if (!(C > 0) || !(n > 0)) return [];
    const ech = echeance(C, +p.taux_pct || 0, n), ass = C * ((+p.assurance_pct || 0) / 100) / 12;
    const out = [];
    let crd = C;
    for (let k = 1; k <= n; k++) {
      const interets = crd * i, cap = k === n ? crd : ech - interets;
      crd = k === n ? 0 : crd - cap;
      out.push({ mois: k, date: p.debut ? O.ajouterMois(p.debut, k - 1) : null, interets, capital: cap, assurance: ass, echeance: ech, crd: Math.max(0, crd) });
    }
    return out;
  }

  /** Nombre de mensualités `m` restant à payer pour solder `crd` à `tauxPct` (CRD d'aujourd'hui, première échéance dans un mois) ;
      null si la mensualité ne couvre pas les intérêts. */
  function dureeRestante(crd, mensualite, tauxPct) {
    if (!(crd > 0)) return 0;
    if (!(mensualite > 0)) return null;
    const i = tauxPct / 100 / 12;
    if (i === 0) return Math.ceil(crd / mensualite - 1e-9);
    if (mensualite <= crd * i) return null;
    return Math.ceil(-Math.log(1 - crd * i / mensualite) / Math.log(1 + i) - 1e-9);
  }
  /** Taux nominal annuel (%) qui solde `crd` en `n` échéances de `mensualite` (dichotomie) ; null si impossible. */
  function tauxDeduit(crd, mensualite, n) {
    if (!(crd > 0) || !(mensualite > 0) || !(n > 0)) return null;
    if (mensualite * n < crd - 1e-6) return null;
    const pv = i => (i === 0 ? mensualite * n : mensualite * (1 - Math.pow(1 + i, -n)) / i);
    let lo = 0, hi = 0.05; // mensuel (60 % par an)
    if (pv(0) <= crd) return 0;
    for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (pv(m) > crd) lo = m; else hi = m; }
    return ((lo + hi) / 2) * 12 * 100;
  }


  /* ------------------------------------------------------------------ code de crédit de la Toise (Pilotage › Rang), déplacé ici sans changer les calculs
     (spec PROJ § 8.3). Les constantes LOAN viennent des repères datés (constantesPret) ; toise.js appelle ces fonctions. */
  const PTZ={res:{A:[49000,73500,88200,102900,117600,132300,147000,161700],B1:[34500,51750,62100,72450,82800,93150,103500,113850],B2:[31500,47250,56700,66150,75600,85050,94500,103950],C:[28500,42750,51300,59850,68400,76950,85500,94050]},
    op:{A:[150000,225000,270000,315000,360000],B1:[135000,202500,243000,283500,324000],B2:[110000,165000,198000,231000,264000],C:[100000,150000,180000,210000,240000]},
    coef:[1,1.5,1.8,2.1,2.4],tr:{A:[25000,31000,37000,49000],B1:[21500,26000,30000,34500],B2:[18000,22500,27000,31500],C:[15000,19500,24000,28500]},
    quot:{coll:[.5,.4,.4,.2],indiv:[.3,.2,.2,.1]},rep:[[10,15],[8,12],[2,13],[0,10]]};
  function ptzInfo(o,eur){
    eur=eur||(v=>Math.round(v)+' €');
    if(!o.primo)return{ok:false,why:'réservé aux personnes qui achètent leur première résidence principale'};
    if(o.bien==='ancien'&&!(o.zone==='B2'||o.zone==='C'))return{ok:false,why:'dans l\'ancien, seulement en zone B2 ou C'};
    if(o.bien==='ancien'&&!o.travaux)return{ok:false,why:'dans l\'ancien, il faut au moins 25 % de travaux'};
    const n=Math.max(1,Math.min(8,o.persons)),n5=Math.min(5,n),res=Math.max(o.rfr,o.cost/9),plaf=PTZ.res[o.zone][n-1];
    if(res>plaf)return{ok:false,why:'revenus retenus ('+eur(res)+') au-dessus du plafond ('+eur(plaf)+')',res,plaf};
    let t=PTZ.tr[o.zone].findIndex(x=>res/PTZ.coef[n5-1]<=x);if(t<0)t=3;
    const quot=(o.bien==='neuf'&&o.type==='indiv'?PTZ.quot.indiv:PTZ.quot.coll)[t],opCap=PTZ.op[o.zone][n5-1];
    const amt=Math.max(0,Math.min(Math.min(o.cost,opCap)*quot,(t===0?1.25:1)*Math.max(0,o.mainLoan)));
    const[diff,remb]=PTZ.rep[t],rembY=Math.max(1,Math.min(remb,o.years-diff));
    return{ok:true,tranche:t+1,amt,diff,rembY,monthly:amt/(rembY*12),quot,opCap,res,plaf};
  }
  function taeg(C,fees,monthly,n){
    if(!(C>fees)||!(monthly>0))return 0;const net=C-fees;let lo=0,hi=.05;
    for(let k=0;k<80;k++){const r=(lo+hi)/2,pv=r===0?monthly*n:monthly*(1-Math.pow(1+r,-n))/r;if(pv>net)lo=r;else hi=r}
    return (Math.pow(1+(lo+hi)/2,12)-1)*100;
  }
  function planPret(o,LOAN,eur){
    const R=Math.max(0,o.incM)+LOAN.rentShare*Math.max(0,o.rentM||0),credits=Math.max(0,o.creditsM||0),Mmax=Math.max(0,LOAN.dti*R-credits);
    const a=annuite(o.ratePct,o.years),ins=o.insPct/100/12,g=LOAN.guarantee,dossier=LOAN.dossier,apport=Math.max(0,o.apport);
    const notary=o.bien==='neuf'?LOAN.notaryNeuf:o.primo?LOAN.notaryPrimo:LOAN.notaryAncien;
    let ptz={ok:false,amt:0,monthly:0},C=0,price=0,guar=0;
    const ptzFor=(cost,main)=>o.ptz?ptzInfo(Object.assign({},o.ptz,{cost,mainLoan:main,bien:o.bien,primo:o.primo,years:o.years}),eur):{ok:false,amt:0,monthly:0,why:'non simulé'};
    if(o.price==null){
      let amt=0;
      for(let it=0;it<80;it++){
        const info=amt>0?ptzFor(price,C):null,monthlyPtz=info&&info.ok?amt/(info.rembY*12):0;
        C=R>0?Math.max(0,Mmax-monthlyPtz)/(a+ins):0;guar=C>0?C*g+dossier:0;
        price=Math.max(0,(C+amt+apport-guar)/(1+notary));
        const nx=ptzFor(price,C),target=nx.ok?nx.amt:0;
        if(Math.abs(target-amt)<.5){ptz=nx.ok?Object.assign(nx,{amt,monthly:amt/(nx.rembY*12)}):Object.assign(nx,{amt:0,monthly:0});break}
        amt=amt+(target-amt)*.5;ptz=nx.ok?Object.assign(nx,{amt,monthly:amt/(nx.rembY*12)}):Object.assign(nx,{amt:0,monthly:0});
      }
      if(ptz.amt>0){C=R>0?Math.max(0,Mmax-ptz.monthly)/(a+ins):0;guar=C>0?C*g+dossier:0;price=Math.max(0,(C+ptz.amt+apport-guar)/(1+notary))}
    }else{
      price=Math.max(0,o.price);let amt=0;
      for(let it=0;it<80;it++){
        C=apport+amt>=price*(1+notary)?0:Math.max(0,(price*(1+notary)+dossier-apport-amt)/(1-g));
        const nx=ptzFor(price,C),target=nx.ok?nx.amt:0;
        if(Math.abs(target-amt)<.5){ptz=nx.ok?Object.assign(nx,{amt,monthly:amt/(nx.rembY*12)}):Object.assign(nx,{amt:0,monthly:0});break}
        amt=amt+(target-amt)*.5;ptz=nx.ok?Object.assign(nx,{amt,monthly:amt/(nx.rembY*12)}):Object.assign(nx,{amt:0,monthly:0});
      }
      C=apport+ptz.amt>=price*(1+notary)?0:Math.max(0,(price*(1+notary)+dossier-apport-ptz.amt)/(1-g));
      guar=C>0?C*g+dossier:0;
    }
    const n=o.years*12,mens=C*a,insM=C*ins,monthly=mens+insM+ptz.monthly;
    const dti=R>0?(credits+monthly)/R:Infinity;
    return{R,Mmax,C,mens,insM,monthly,dti,interest:mens*n-C,insTotal:insM*n,notary,notaryEur:price*notary,guar,price,fees:price*notary+guar,
      rav:R-credits-monthly,ptz,taeg:taeg(C,guar,mens+insM,n),usure:LOAN.usure[o.years],total:price*(1+notary)+guar};
  }
  function amortissementAnnuel(L,o){
    const i=o.ratePct/100/12,n=o.years*12,rows=[];let crd=L.C,cumI=0;
    for(let y=0;y<=o.years;y++){
      let ptzCrd=0;if(L.ptz.amt>0){const p=L.ptz;ptzCrd=y<=p.diff?p.amt:Math.max(0,p.amt-p.monthly*12*(y-p.diff))}
      rows.push({y,crd:Math.max(0,crd),ptz:ptzCrd,interest:cumI});
      for(let m=0;m<12&&y<o.years;m++){const int=crd*i;cumI+=int;crd-=L.mens-int}
    }
    return rows;
  }

  /** Constantes de crédit lues dans les repères (liste ou index) : taux du jour par durée (15, 20, 25 ans), taux d'usure par durée, frais d'acquisition,
      garantie, frais de dossier, pondération des loyers, dates. Une valeur absente vaut null (jamais une valeur de secours). */
  function constantesPret(reperes) {
    const idx = Array.isArray(reperes) ? O.indexReperes(reperes) : reperes || {};
    const v = c => (idx[c] ? +idx[c].valeur : null), pct = c => (idx[c] ? +idx[c].valeur / 100 : null);
    const date = c => (idx[c] ? { effet: idx[c].dateEffet || null, fin: idx[c].dateFin || null, titre: idx[c].sourceTitre || null } : null);
    return {
      rates: { 15: v("taux_credit_immo_15"), 20: v("taux_credit_immo_20"), 25: v("taux_credit_immo_25") },
      usure: { 15: v("taux_usure_10_20"), 20: v("taux_usure_20_plus"), 25: v("taux_usure_20_plus") },
      notaryAncien: pct("frais_acquisition_ancien_pct"), notaryPrimo: pct("frais_acquisition_primo_pct"), notaryNeuf: pct("frais_acquisition_neuf_pct"),
      guarantee: pct("garantie_pct"), dossier: v("frais_dossier"), rentShare: pct("revenus_locatifs_ponderation"),
      sources: { taux: date("taux_credit_immo_25"), usure: date("taux_usure_20_plus") },
    };
  }

  return { annuite, echeance, amortissement, dureeRestante, tauxDeduit, PTZ, ptz: ptzInfo, taeg, planPret, amortissementAnnuel, constantesPret };
});
});

/* ---------- web/src/projection-donnees.js ---------- */
def("projection-donnees", function (module, exports, require) {
/* Données du moteur de projection (PROJ) : lecture des repères avec suivi des manques, hypothèses par classe d'actifs, compartiments
   (enveloppe × titulaire × classe) construits depuis les positions, capacité d'épargne de départ (constatée, prévue, programmée),
   crédits en cours. Pur, sans DOM. Global ProjectionDonnees ; copié tel quel dans le connecteur (npm run gen).
   Entrée : data = { today, positions, instruments, config, profil, credits, biens, budget, banque, objectifs, foyer, reperes, classes?, calendrier? }. */
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
    if (sc === "foyer" && d.banque) {
      let r = Calc.budgetReel(d.banque, today, 12), courte = false;
      if (!(r && r.n >= 6)) { r = Calc.budgetReel(d.banque, today, 3); courte = !!r; }
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

  /** Entrée du moteur depuis l'état S du store (positions, config, profil, budget, banque, objectifs, foyer, repères, indices) ; today = AAAA-MM-JJ (jour de Paris). */
  function depuisEtat(S, today) {
    const s = objet(S), pr = objet(s.profil);
    return { today, positions: liste(s.positions), instruments: [], config: objet(s.config), profil: pr, credits: liste(pr.credits), biens: liste(pr.biens), budget: s.budget || { lignes: [] },
      banque: s.banque || null, objectifs: liste(s.objectifs), foyer: { evenements: liste(objet(s.foyer).evenements), variantes: liste(objet(s.foyer).variantes) },
      reperes: liste(objet(s.savoir).reperes), indices: liste(s.indices), classes: objet(s.classes) };
  }

  return { ecarterIndisponibles, depuisEtat, CLASSES_TIREES, IDX, correlationTirees, matriceTirees, choleskyTirees, contexte, ciblesAllocation, parametresClasse, capaciteDeBase, construireCompartiments,
    creditsExistants, DISPO, TYPES_ENVELOPPE, personnesDe, objet, liste, sum };
});
});

/* ---------- web/src/projection-immo.js ---------- */
def("projection-immo", function (module, exports, require) {
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
      const LIB_PEA = { pea: "PEA", pea_pme: "PEA PME-ETI", pea_jeune: "PEA d'un majeur rattaché" };
      sep.gardes.filter(c => LIB_PEA[c.type] && c.v0 > 0 && c.prep.seuil && today < c.prep.seuil).forEach(c => avertissements.push("le " + LIB_PEA[c.type] + " « " + c.enveloppe + " » a moins de 5 ans : il n'est pas compté (un retrait clôturerait le plan)"));
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
});

/* ---------- web/src/projection.js ---------- */
def("projection", function (module, exports, require) {
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
  /** Incrémentée à chaque changement de calcul ; rendue avec chaque résultat (rejouer une projection passée). */
  const versionModele = "proj-1.0.0";
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
        const txt = phases.map((r, k) => "−" + eur(r.v * f) + "/mois" + (k > 0 ? " à partir de " + (r.ag >= seuil ? seuil : r.ag) + " ans" : "")).join(", ");
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

  /** Un calcul : P chemins (1 en mode déterministe), mois à l'extérieur, chemins à l'intérieur. Voir la spec § 4, § 6, § 9.
      o : { P, graine, det, plan (vrai : la passe déterministe construit les achats et les composants), trace, vue, net_impots, infl, crise, retenir, marques }. */
  function derouler(M, o) {
    const P = o.P, B = M.B, N = M.N, det = !!o.det, comps = M.comps, dates = M.dates, infl = o.infl || M.infl;
    const trace = !!o.trace, planifier = !!o.plan;
    const vue = o.vue || "financier", netImp = !!o.net_impots;
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
    const tot = new Float64Array(P), tri = new Float64Array(P), totX = new Float64Array(P), triX = new Float64Array(P), diff = new Float64Array(P);
    const marquesSet = new Set(o.marques || []);
    const retenir = {}; (o.retenir || []).forEach(t => { retenir[t] = new Float64Array(P); });
    const objCompte = M.objs.map(() => 0);
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
      if (nomVue === "net") s += bi - dette;
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
        s += biensNets - dette;
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
        if (ob.t !== t) return;
        for (let i = 0; i < P; i++) { let s = 0; const off = i * B; for (const b of ob.ref) s += V[off + b]; if (s >= ob.cible * infl[t] - 1e-9) objCompte[j]++; }
      });
      if (trace) {
        const off = 0;
        let f = 0, dsp = 0;
        for (let b = 0; b < B; b++) { f += V[b]; tr.valeurs[t * B + b] = V[b]; }
        for (const b of dispoIdx) dsp += V[b];
        tr.fin[t] = f; tr.dispo[t] = dsp; tr.bien[t] = bien[0]; tr.dette[t] = dette; tr.net[t] = f + bien[0] - dette;
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
        for (let b = 0; b < B; b++) {
          const f = (grpDe[b] >= 0 ? gGrp[grpDe[b]] * comps[b].feeM : gDet[b]);
          V[off + b] *= f; Vx[off + b] *= f;
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
    return { P, B, N, graine, apport: apportRes, centiles, existant: exis, ecart, probEcart, manque, objCompte, retenir, trace: tr, V, Vx, Bs, vue, infl, groupes: groupes.length, needPairs: needPair.reduce((a, x) => a + x, 0) };
  }

  /* ================================================================== résultats */
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
    const baseTxt = cb.source === "reel" ? "capacité constatée (" + cb.constatee_detail.mois + " mois)" : cb.source === "montant" ? "capacité fixée à " + eur(cb.retenue) + " par mois" : "capacité prévue au budget";
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

  /** Garde-fous de vraisemblance (spec § 6.8). */
  function garde_fous(M, run, tr, cap) {
    const out = [], cb = M.capacite_base, rv = M.ctx.rv, N = M.N;
    if (cb.signale && cb.source === "reel") {
      out.push({ cle: "ecart_capacite", niveau: "info", valeurs: { constatee: cb.constatee, prevue: cb.prevue, programmee: cb.programmee, periode: cb.periode },
        texte: "Ta capacité d'épargne constatée sur tes comptes est de " + eur(cb.constatee) + " par mois" + (cb.periode ? " (" + cb.periode + ")" : "") + ", contre " + eur(cb.prevue) +
          " prévus au budget" + (cb.programmee > 0 ? " et " + eur(cb.programmee) + " de versements programmés" : "") + " : la projection part de la capacité constatée." });
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

  /** Simulation : Monte-Carlo (2 000 chemins, graine fixe, tirages communs) ou déterministe (volatilite: 0). → résultat de la spec § 3. */
  function simuler(M, opts) {
    const o = opts || {}, N = M.N;
    assurerDet(M);
    const vue = o.vue || M.options.vue, euros = o.euros || M.options.euros, netImp = o.net_impots != null ? !!o.net_impots : M.options.net_impots;
    const deterministe = o.volatilite === 0;
    const P = deterministe ? 1 : (o.chemins > 0 ? Math.round(o.chemins) : 2000);
    const graine = o.graine == null ? GRAINE : o.graine;
    const run = derouler(M, { P, graine, det: deterministe, trace: deterministe, vue, net_impots: netImp, couches: true, retenir: o.retenir });
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
      return { id: ob.id, nom: ob.nom, cible: ob.cible, date: ob.date, probabilite: prob, mot, statut, valeur_deterministe: detV };
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
      effet: { texte: ob.probabilite == null ? "" : "cible de " + kEur(ob.cible) + " : " + Math.round(ob.probabilite * 10) + " chances sur 10", montants: { cible: ob.cible, probabilite: ob.probabilite } }, source: "objectif" }); });
    jalons.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    const avert = M.avertissements.slice();
    M.ctx.manquants.forEach((pourquoi, cle) => avert.push("repère manquant (" + cle + ") : " + pourquoi));
    M.comps.filter(c => c.v0 > 0 && !c.dispo && c.prep.indisponible).forEach(c => avert.push("impôt de sortie de « " + c.enveloppe + " » non calculé (" + (c.prep.mentions[0] || "règle indisponible") + ") : ses retraits et sa valeur nette sont comptés sans impôt"));
    if (M.plafondDepasse) avert.push("le plafond de versements du PEA est dépassé : les versements suivants y sont maintenus faute d'autre enveloppe ouverte");
    const resume = vueTitre(M, vues[vue], euros, vue, couv.couverture, existant, futur);
    return {
      version_modele: versionModele, graine, chemins: P, deterministe, today: M.today, mois: M.dates.slice(0, N + 1), euros, vue, net_impots: netImp, horizon_ans: M.horizon,
      vues, objectifs, manquer_argent: manquer, jalons, phrase: resume.phrase, decomposition_phrase: resume.decomposition, capacite_source: M.capacite_base.source, capacite_periode: M.capacite_base.periode,
      hypotheses: lister(M), hypotheses_classes: classesUtilisees(M), a_completer: couv.a_completer, couverture: couv.couverture, avertissements: avert,
      existant, epargne_future: futur, capacite_base: M.capacite_base, capacite_par_periode: cpp, decomposition: dec, garde_fous: gf,
      evenements_pris_en_compte: M.evenements_pris_en_compte.slice(), question_evenements: M.evenements_pris_en_compte.length ? null : "Aucun événement renseigné — as-tu des changements prévus ? Un enfant, un changement d'emploi, un déménagement, un achat ?",
      chemins_retenus: o.retenir ? run.retenir : undefined, retro: null, achats: M.achats.map(a => Object.assign({}, a)), retraits: M.retraits.slice(),
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
    const sur10 = Math.round(c.taux_p10_p90 * 10);
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
    for (const p of pts) {
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
    const s = JSON.stringify([versionModele, data, o]);
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0; h2 ^= h2 >>> 13; }
    return versionModele + ":" + h1.toString(36) + h2.toString(36) + ":" + s.length;
  }
  /** Calcule `etapes` (nombres de chemins croissants, même graine : les premiers chemins sont communs) ; rend un résultat par étape. */
  function calculerEtapes(data, options, etapes) {
    const o = Object.assign({}, options), M = preparer(data, o);
    return etapes.map(n => simuler(M, { chemins: n, graine: o.graine, volatilite: o.volatilite }));
  }
  /** Exécute une projection : d'abord 500 chemins (aperçu), puis 2 000, dans un Web Worker si disponible, sinon sur le fil principal.
      Résultats mis en cache par empreinte (données + options + version du modèle). rappel(resultat, { etape: "apercu" | "complet", chemins, cache? }).
      options : { …options de preparer, chemins (2000), graine, volatilite, worker (false : fil principal), WorkerClass, urlWorker, progressif (false : une seule étape) }. → Promise du résultat complet. */
  function executer(data, options, rappel) {
    const o = options || {}, cle = empreinte(data, o), final = o.chemins > 0 ? Math.round(o.chemins) : 2000;
    const dit = (r, info) => { if (typeof rappel === "function") rappel(r, info); };
    if (cache.has(cle)) { const r = cache.get(cle); cache.delete(cle); cache.set(cle, r); dit(r, { etape: "complet", chemins: r.chemins, cache: true }); return Promise.resolve(r); }
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
  /** Vide le cache des résultats (tests). */
  function viderCache() { cache.clear(); }

  /** Normales corrélées d'un chemin donné : outil de test. */
  const _executer = derouler;

  return {
    GRAINE, versionModele, CLASSES_TIREES, HYPOTHESES, EVENEMENTS, PERCENTILES, PLAN_MAX_OCTETS, PLAN_PARAMETRES_MAX_OCTETS, PLAN_TOTAL_MAX_OCTETS, octetsJsonb: O.octetsJsonb,
    preparer, simuler, crise, comparer, executer, calculerEtapes, empreinte, viderCache, kEur, tirages, correlations, couverture, retroControle, phraseRetro, retrait, capaciteDansLeTemps, figerPlan, comparerPlanReel,
    fiscaliteSortie: F.fiscaliteSortie, amortissement: C.amortissement, annuite: C.annuite, planPret: C.planPret, ptz: C.ptz, taeg: C.taeg,
    capaciteEmprunt: (data, opts) => D.Immo.capaciteEmprunt(data, opts), capaciteDeBase: Dn.capaciteDeBase, depuisEtat: Dn.depuisEtat, validerEvenement: E.validerEvenement, validerVariante: E.validerVariante,
    rendementAttendu, capitaliser, centile: O.centile, _executer,
  };
});
});

export const Reperes = charger("reperes");
export const Calendrier = charger("calendrier");
export const Calc = charger("calc");
export const Marche = charger("marche");
export const Plan = charger("plan");
export const Evenements = charger("projection-evenements");
export const Projection = charger("projection");
