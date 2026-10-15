// Fichier généré par scripts/gen-catalogue.mjs (npm run gen) : ne pas modifier à la main.
// Copie du moteur de suivi des lignes de l'app (SUIVI, docs/superpowers/specs/2026-10-15-suivi-lignes-design.md) : les modules purs de web/src
// (reperes, calendrier, calc, marche, plan, projection-outils, projection-fiscalite, risque, pratiques, suivi) recopiés tels quels, évalués dans cet ordre. Aucune modification : un écart avec l'app est un bug du générateur.
const definitions = {}, modules = {};
function def(nom, fabrique) { definitions[nom] = fabrique; }
function charger(nom) {
  if (modules[nom]) return modules[nom].exports;
  const fabrique = definitions[nom];
  if (!fabrique) throw new Error("suivi-moteur : module inconnu « " + nom + " »");
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
/* Plan : budget, objectifs et score de santé (la projection du patrimoine est dans projection.js). Calculs purs, aucun accès au DOM.
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

  return { SCORE_MIN_CRITERES, SEUIL_PROVISOIRE, REPERES_AGE, BAREMES, REPERES, STATUTS_LABELS, mensuel, budgetTotaux, capaciteEpargne, affecterDeja,
    effortMensuel, valeurFuture, moisEntre, dateAtteinte, dejaObjectif, titulaireObjectif, statutObjectif, repartirEpargne, score, coutsPrincipaux,
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

/* ---------- web/src/risque.js ---------- */
def("risque", function (module, exports, require) {
/* Risque : profil de risque déclaré (questionnaire inspiré de l'adéquation MiFID II) et risque réel du portefeuille.
   Calculs purs, aucun accès au DOM. Pédagogique : on parle de classes d'actifs et de comportements, jamais de produits.
   S'appuie sur Calc (calc.js) pour les positions et sur Marche (marche.js) pour les statistiques par classe. */
(function (root, factory) {
  const cjs = typeof module === "object" && module.exports;
  const Calc = cjs ? require("./calc.js") : root.Calc;
  const Marche = cjs ? require("./marche.js") : root.Marche;
  const api = factory(Calc, Marche);
  if (cjs) module.exports = api;
  else root.Risque = api;
})(typeof self !== "undefined" ? self : this, function (Calc, Marche) {
  const EPS = 1e-9;
  const sum = (list, f) => list.reduce((a, x, i) => a + f(x, i), 0);
  const n = v => (isFinite(+v) && v !== null && v !== "" ? +v : 0);

  /* ---------- questionnaire ---------- */
  /* Poids : fort 3, moyen 2, faible 1, garde-fou 0 (la question n'entre pas dans le score, elle ne fait que plafonner). */
  const QUESTIONS = [
    { id: "horizon", theme: "Horizon", poids: 3, type: "choix",
      texte: "Dans combien de temps auras-tu besoin de la majeure partie de cet argent ?",
      aide: "Plus l'échéance est lointaine, plus tu as le temps d'attendre qu'une baisse soit rattrapée.",
      options: [
        { v: "lt2", label: "Moins de 2 ans", points: 0 },
        { v: "2-5", label: "2 à 5 ans", points: 1 },
        { v: "5-8", label: "5 à 8 ans", points: 2 },
        { v: "8-15", label: "8 à 15 ans", points: 3 },
        { v: "gt15", label: "Plus de 15 ans", points: 4 },
      ] },
    { id: "objectif", theme: "Objectif", poids: 2, type: "choix",
      texte: "Qu'attends-tu d'abord de tes placements ?",
      options: [
        { v: "preserver", label: "Préserver ce que j'ai, sans perte", points: 0 },
        { v: "revenus", label: "Compléter mes revenus régulièrement", points: 1 },
        { v: "croissance", label: "Faire croître mon épargne à moyen terme", points: 2 },
        { v: "maximiser", label: "Obtenir le meilleur rendement à long terme, en acceptant de fortes variations", points: 3 },
      ] },
    { id: "reaction", theme: "Réaction à une baisse", poids: 3, type: "choix",
      texte: "Tes placements perdent 20 % en trois mois. Que fais-tu ?",
      aide: "Ce genre de baisse arrive en moyenne une fois tous les 5 à 10 ans sur les actions. Réponds selon ce que tu ferais vraiment.",
      options: [
        { v: "vendre_tout", label: "Je vends tout pour arrêter les pertes", points: 0 },
        { v: "vendre_partie", label: "J'en vends une partie", points: 1 },
        { v: "rien", label: "Je ne fais rien et j'attends", points: 2 },
        { v: "renforcer", label: "J'en profite pour investir davantage", points: 3 },
      ] },
    { id: "perte_max", theme: "Perte maximale", poids: 3, type: "choix",
      texte: "Quelle baisse temporaire de tes placements, sur une année, pourrais-tu supporter sans changer tes plans ?",
      aide: "Une baisse temporaire n'est une perte que si l'on vend au plus bas. Indique ce que tu supporterais sans dormir moins bien.",
      options: [
        { v: "p5", label: "5 %", points: 0, perte: 5 },
        { v: "p10", label: "10 %", points: 1, perte: 10 },
        { v: "p20", label: "20 %", points: 2, perte: 20 },
        { v: "p35", label: "35 %", points: 3, perte: 35 },
        { v: "plus", label: "Plus de 35 %", points: 4, perte: null },
      ] },
    { id: "connaissances", theme: "Connaissances", poids: 2, type: "multi",
      texte: "Quels placements connais-tu assez pour expliquer comment ils gagnent ou perdent de la valeur ?",
      aide: "Coche tout ce qui s'applique. Un ETF (ou « tracker ») est un fonds coté qui réplique un indice, par exemple les grandes entreprises mondiales. " +
        "Un produit à levier amplifie les hausses comme les baisses.",
      options: [
        { v: "livrets", label: "Livrets d'épargne", points: 0 },
        { v: "fonds_euros", label: "Fonds euros d'assurance-vie", points: 0 },
        { v: "etf", label: "ETF (fonds indiciels cotés)", points: 2 },
        { v: "actions", label: "Actions", points: 2 },
        { v: "obligations", label: "Obligations", points: 1 },
        { v: "crypto", label: "Cryptoactifs", points: 1 },
        { v: "levier", label: "Produits à effet de levier", points: 1 },
        { v: "aucun", label: "Aucun de ces placements", points: 0, exclusif: true },
      ] },
    { id: "experience", theme: "Expérience", poids: 1, type: "nombre",
      texte: "Depuis combien d'années investis-tu en bourse (actions, ETF ou fonds) ?",
      aide: "Indique 0 si tu n'as jamais investi en bourse.",
      options: [
        { v: "0", min: 0, label: "Jamais ou moins d'un an", points: 0 },
        { v: "1", min: 1, label: "1 à 2 ans", points: 1 },
        { v: "3", min: 3, label: "3 à 4 ans", points: 2 },
        { v: "5", min: 5, label: "5 à 9 ans", points: 3 },
        { v: "10", min: 10, label: "10 ans ou plus", points: 4 },
      ] },
    { id: "revenus", theme: "Stabilité des revenus", poids: 2, type: "choix",
      texte: "Comment décrirais-tu tes revenus ?",
      aide: "Des revenus stables permettent de traverser une baisse des marchés sans devoir vendre.",
      options: [
        { v: "fonctionnaire", label: "Très stables (fonctionnaire, pension de retraite)", points: 4 },
        { v: "cdi", label: "Stables (salarié en CDI)", points: 3 },
        { v: "independant", label: "Plutôt réguliers (indépendant, chef d'entreprise)", points: 2 },
        { v: "variables", label: "Variables (CDD, intérim, commissions)", points: 1 },
        { v: "sans", label: "Sans revenu d'activité", points: 0 },
      ] },
    { id: "matelas", theme: "Épargne de précaution", poids: 0, type: "choix", prerempli: "matelas",
      texte: "As-tu de côté au moins 3 mois de dépenses, disponibles tout de suite et en dehors de tes placements ?",
      aide: "C'est le matelas de sécurité (livrets, compte courant). Sans lui, un imprévu peut obliger à vendre au mauvais moment. Prérempli depuis ton patrimoine.",
      options: [
        { v: "oui", label: "Oui", points: 1 },
        { v: "non", label: "Non", points: 0 },
      ] },
    { id: "part_investie", theme: "Part exposée", poids: 2, type: "choix",
      texte: "Quelle part de ton épargne financière acceptes-tu d'exposer aux marchés (actions, obligations, immobilier coté…) ?",
      aide: "Le reste resterait sur des supports sans risque de perte : livrets, fonds euros.",
      options: [
        { v: "lt10", label: "Moins de 10 %", points: 0 },
        { v: "10-25", label: "10 à 25 %", points: 1 },
        { v: "25-50", label: "25 à 50 %", points: 2 },
        { v: "50-75", label: "50 à 75 %", points: 3 },
        { v: "gt75", label: "Plus de 75 %", points: 4 },
      ] },
    { id: "age", theme: "Âge", poids: 1, type: "choix", prerempli: "age",
      texte: "Quel est ton âge ?",
      aide: "Prérempli depuis ton profil.",
      options: [
        { v: "u30", label: "Moins de 30 ans", points: 4 },
        { v: "a30", label: "30 à 39 ans", points: 4 },
        { v: "a40", label: "40 à 49 ans", points: 3 },
        { v: "a50", label: "50 à 59 ans", points: 2 },
        { v: "a60", label: "60 à 69 ans", points: 1 },
        { v: "a70", label: "70 ans ou plus", points: 0 },
      ] },
  ];

  /* ---------- profils ---------- */
  /* Allocation cible indicative (%, bornes incluses) et perte maximale tolérée sur un an (%, en valeur absolue). */
  const PROFILS = [
    { id: "prudent", label: "Prudent", perteMax: 5,
      description: "Tu privilégies la sécurité : l'essentiel reste sur des supports sans risque de perte, une petite part cherche un peu de rendement.",
      cibles: { actions: [10, 20], obligations: [20, 30], securise: [50, 70], immobilier: [0, 10], speculatif: [0, 0] } },
    { id: "modere", label: "Modéré", perteMax: 12,
      description: "Tu acceptes de petites variations pour un rendement un peu meilleur, avec une base sécurisée importante.",
      cibles: { actions: [25, 40], obligations: [20, 30], securise: [30, 45], immobilier: [5, 15], speculatif: [0, 2] } },
    { id: "equilibre", label: "Équilibré", perteMax: 20,
      description: "Tu cherches un compromis : environ la moitié en actions pour la croissance, le reste pour amortir les baisses.",
      cibles: { actions: [45, 60], obligations: [15, 25], securise: [15, 30], immobilier: [5, 15], speculatif: [0, 5] } },
    { id: "dynamique", label: "Dynamique", perteMax: 30,
      description: "Tu vises la croissance à long terme et acceptes des baisses marquées, le temps qu'elles soient rattrapées.",
      cibles: { actions: [60, 80], obligations: [5, 15], securise: [5, 15], immobilier: [5, 15], speculatif: [0, 7] } },
    { id: "offensif", label: "Offensif", perteMax: 40,
      description: "Tu recherches le rendement maximal sur un horizon long et supportes de fortes baisses sans vendre.",
      cibles: { actions: [75, 95], obligations: [0, 10], securise: [0, 10], immobilier: [0, 10], speculatif: [0, 10] } },
  ];
  const IDS = PROFILS.map(p => p.id);
  const rang = id => IDS.indexOf(id);
  const profil = id => PROFILS.find(p => p.id === id) || null;

  /** Score (0-100) → profil : [0, 20[ prudent, [20, 40[ modéré, [40, 60[ équilibré, [60, 80[ dynamique, [80, 100] offensif. */
  function profilDuScore(score) {
    return IDS[Math.min(4, Math.max(0, Math.floor(n(score) / 20)))];
  }

  /* ---------- évaluation ---------- */
  function prerempli(q, ctx) {
    const c = ctx || {};
    if (q.prerempli === "matelas" && c.matelasMois != null && c.matelasMois !== "" && isFinite(+c.matelasMois)) return +c.matelasMois >= 3 ? "oui" : "non";
    if (q.prerempli === "age" && c.age != null) return c.age;
    return undefined;
  }
  /* Réponse valide → { valeur, norm (0-1), option(s) } ; invalide ou absente → null. */
  function lire(q, brute) {
    if (brute === undefined || brute === null || brute === "") return null;
    const max = Math.max(...q.options.map(o => o.points));
    if (q.type === "multi") {
      const vals = (Array.isArray(brute) ? brute : [brute]).map(String).filter(v => q.options.some(o => o.v === v));
      if (!vals.length) return null;
      const autres = vals.filter(v => v !== "aucun");
      const retenues = autres.length ? autres : ["aucun"]; /* « aucun » coché avec autre chose : on garde les cases précises */
      const total = sum(q.options.filter(o => o.points > 0), o => o.points);
      const pts = sum(q.options.filter(o => retenues.includes(o.v)), o => o.points);
      return { valeur: retenues, norm: total ? Math.min(1, pts / total) : 0 };
    }
    if (q.type === "nombre") {
      const x = +brute;
      if (!isFinite(x) || x < 0) return null;
      const o = q.options.filter(op => x >= op.min).pop();
      return { valeur: x, norm: max ? o.points / max : 0, option: o };
    }
    const o = q.options.find(op => op.v === String(brute));
    return o ? { valeur: o.v, norm: max ? o.points / max : 0, option: o } : null;
  }

  /** Évalue le questionnaire. ctx : { matelasMois, age } pour préremplir. Les réponses explicites l'emportent sur le prérempli. */
  function evaluer(reponses, ctx) {
    const r = reponses || {};
    const lues = {}, manquantes = [];
    QUESTIONS.forEach(q => {
      const brute = r[q.id] !== undefined && r[q.id] !== null && r[q.id] !== "" ? r[q.id] : prerempli(q, ctx);
      const l = lire(q, brute);
      if (l) lues[q.id] = l; else manquantes.push(q.id);
    });
    const repondues = QUESTIONS.filter(q => lues[q.id]);
    const poidsTotal = sum(repondues, q => q.poids);
    const details = QUESTIONS.map(q => ({ id: q.id, valeur: lues[q.id] ? lues[q.id].valeur : null, points: lues[q.id] ? lues[q.id].norm : null, poids: q.poids }));
    const base = { complet: manquantes.length === 0, manquantes, details };
    if (!poidsTotal) return { ...base, score: null, profil: null, profilAvantGardeFous: null, gardeFous: [] };

    /* Moyenne des points normalisés, pondérée par le poids des questions répondues ; arrondie avant le seuil pour que
       le score affiché et le profil restent cohérents. */
    const score = Math.round(sum(repondues, q => q.poids * lues[q.id].norm) / poidsTotal * 100);
    const avant = profilDuScore(score);

    /* Garde-fous : chacun propose un plafond ; seuls ceux qui abaissent effectivement le profil sont retenus. */
    const candidats = [];
    if (lues.horizon && lues.horizon.valeur === "lt2")
      candidats.push({ cle: "horizon", plafond: "modere",
        texte: "Tu auras besoin de cet argent dans moins de 2 ans : l'argent nécessaire à court terme n'a pas sa place sur les marchés, qui peuvent baisser juste avant l'échéance. Profil plafonné à Modéré." });
    if (lues.matelas && lues.matelas.valeur === "non")
      candidats.push({ cle: "matelas", plafond: "modere",
        texte: "Tu n'as pas encore 3 mois de dépenses de côté : sans ce matelas, un imprévu peut obliger à vendre au plus bas. Profil plafonné à Modéré tant que le matelas n'est pas constitué." });
    if (lues.perte_max && lues.perte_max.option.perte != null) {
      const acceptee = lues.perte_max.option.perte;
      const ok = PROFILS.filter(p => p.perteMax <= acceptee);
      const plafond = ok.length ? ok[ok.length - 1] : PROFILS[0];
      candidats.push({ cle: "perte_max", plafond: plafond.id,
        texte: "Tu acceptes une baisse de " + acceptee + " % au plus sur un an : un profil plus exposé peut perdre davantage (jusqu'à " +
          PROFILS[Math.min(4, rang(plafond.id) + 1)].perteMax + " % pour le profil suivant). Profil plafonné à " + plafond.label + ", dont la baisse tolérée est de " + plafond.perteMax + " %." });
    }
    if (lues.connaissances && !lues.connaissances.valeur.some(v => v === "actions" || v === "etf"))
      candidats.push({ cle: "connaissances", plafond: "equilibre",
        texte: "Tu n'as pas indiqué connaître les actions ni les ETF : mieux vaut ne pas dépasser la moitié de son épargne sur des placements dont on ne maîtrise pas le fonctionnement. Profil plafonné à Équilibré." });
    const gardeFous = candidats.filter(g => rang(g.plafond) < rang(avant));
    const final = gardeFous.reduce((p, g) => (rang(g.plafond) < rang(p) ? g.plafond : p), avant);
    return { ...base, score, profil: final, profilAvantGardeFous: avant, gardeFous };
  }

  /* ---------- allocation réelle ---------- */
  const GROUPES = ["actions", "obligations", "securise", "immobilier", "speculatif"];
  const GROUPES_LABELS = { actions: "Actions", obligations: "Obligations", securise: "Fonds euros et monétaire", immobilier: "Immobilier",
    speculatif: "Spéculatif (crypto, levier)", diversifiants: "Or et autres" };
  const GROUPE_DE = { actions: "actions", small_caps: "actions", emergents: "actions", obligations: "obligations", monetaire: "securise",
    fonds_euros: "securise", immobilier: "immobilier", crypto: "speculatif", levier: "speculatif", or: "diversifiants", autres: "diversifiants" };

  /* Montants par classe de risque (Marche.classeRisque), immobilier physique optionnel ajouté à l'immobilier.
     Les comptes courants (Calc.famille « courant ») sont exclus : ils comptent dans le patrimoine net, pas dans l'allocation ni
     le risque (spec cp1 § 1) ; même règle dans le connecteur (montantsParClasse de supabase/functions/mcp/index.ts). */
  function montantsParClasse(positions, scope, opts) {
    const o = opts || {}, sc = scope || "foyer", out = {};
    Calc.horsCourants(positions).filter(p => Calc.inScope(p, sc) && Calc.counted(p)).forEach(p => {
      const k = Marche.classeRisque(p, o.surcharge);
      out[k] = (out[k] || 0) + Calc.val(p);
    });
    const phys = Math.max(0, n(o.immobilierPhysique));
    if (phys) out.immobilier = (out.immobilier || 0) + phys;
    return out;
  }

  /** Répartition en % par grand groupe (actions, obligations, sécurisé, immobilier, spéculatif) + « diversifiants » (or, autres),
      hors comptes courants.
      opts : { surcharge, immobilierPhysique } — la valeur du bien physique est fournie par l'appelant (ex. Calc.immobilier). */
  function allocationReelle(positions, scope, opts) {
    const parClasse = montantsParClasse(positions, scope, opts);
    const montants = { actions: 0, obligations: 0, securise: 0, immobilier: 0, speculatif: 0, diversifiants: 0 };
    Object.keys(parClasse).forEach(k => { montants[GROUPE_DE[k] || "diversifiants"] += parClasse[k]; });
    const total = sum(Object.keys(montants), k => montants[k]);
    const pct = {};
    Object.keys(montants).forEach(k => { pct[k] = total > 0 ? montants[k] * 100 / total : 0; });
    return { total, montants, pct, parClasse };
  }

  /* ---------- risque réel ---------- */
  /** Risque du portefeuille réel.
      Méthode : σ (volatilité annuelle, %) = √(wᵀΣw), avec Σᵢⱼ = ρᵢⱼ σᵢ σⱼ (volatilités et corrélations simplifiées de Marche).
      Baisse plausible à un an (approximation normale simple, 99 %) : −2,33 × σ, sans compter le rendement attendu (prudent).
      La loi normale sous-estime les krachs ; on lui applique un plancher : la moitié de la pire baisse historique pondérée
      (Σ wᵢ × pire baisseᵢ) : la baisse plausible retenue est la plus grave des deux, bornée à −100 %.
      Profil équivalent : le moins risqué des profils dont la perte tolérée couvre cette baisse, sinon Offensif.
      Contributions : part de chaque classe dans la variance, wᵢ (Σw)ᵢ / σ² (la somme fait 100 %). */
  function risquePortefeuille(positions, scope, opts) {
    const parClasse = montantsParClasse(positions, scope, opts);
    const cles = Object.keys(parClasse).filter(k => parClasse[k] > 0);
    const total = sum(cles, k => parClasse[k]);
    if (!(total > 0)) return { volatilite: 0, baissePlausible: 0, pireBaisseHistorique: 0, profilEquivalent: null, contributions: [] };
    const w = cles.map(k => parClasse[k] / total);
    const stat = k => Marche.CLASSES[k] || Marche.CLASSES.autres;
    const cov = (a, b) => Marche.correlation(a, b) * stat(a).volatilite * stat(b).volatilite;
    const sw = cles.map((a, i) => sum(cles, (b, j) => w[j] * cov(a, b))); /* (Σw)ᵢ */
    const variance = sum(cles, (a, i) => w[i] * sw[i]);
    const volatilite = Math.sqrt(Math.max(0, variance));
    const pireBaisseHistorique = sum(cles, (k, i) => w[i] * stat(k).pireBaisse);
    const baissePlausible = Math.max(-100, Math.min(-2.33 * volatilite, 0.5 * pireBaisseHistorique));
    const perte = -baissePlausible;
    const eq = PROFILS.find(p => p.perteMax + EPS >= perte);
    const contributions = cles.map((k, i) => ({ classe: k, poids: parClasse[k] * 100 / total, contributionPct: variance > 0 ? w[i] * sw[i] / variance * 100 : 0 }))
      .sort((a, b) => b.contributionPct - a.contributionPct || b.poids - a.poids);
    return { volatilite, baissePlausible, pireBaisseHistorique, profilEquivalent: eq ? eq.id : "offensif", contributions };
  }

  /* ---------- écarts ---------- */
  /** Écart par groupe entre l'allocation réelle (% ou résultat d'allocationReelle) et la cible du profil.
      ecartPts : 0 dans la fourchette, réel − min (négatif) en dessous, réel − max (positif) au-dessus. */
  function ecarts(profilId, allocation) {
    const p = profil(profilId);
    if (!p) return [];
    const pct = (allocation && allocation.pct) || allocation || {};
    return GROUPES.map(g => {
      const reel = n(pct[g]), [min, max] = p.cibles[g];
      const statut = reel < min - EPS ? "sous" : reel > max + EPS ? "au-dessus" : "dans";
      return { groupe: g, label: GROUPES_LABELS[g], reel, min, max, statut, ecartPts: statut === "sous" ? reel - min : statut === "au-dessus" ? reel - max : 0 };
    });
  }

  /* ---------- synthèse ---------- */
  /** Tout ce qu'il faut à l'interface et au connecteur. ctx : { positions, scope, surcharge, immobilierPhysique, matelasMois, age }. */
  function synthese(reponses, ctx) {
    const c = ctx || {}, scope = c.scope || "foyer";
    const opts = { surcharge: c.surcharge, immobilierPhysique: c.immobilierPhysique };
    const evaluation = evaluer(reponses, c);
    const declare = profil(evaluation.profil);
    const allocation = allocationReelle(c.positions, scope, opts);
    const risque = risquePortefeuille(c.positions, scope, opts);
    const equivalent = profil(risque.profilEquivalent);
    const ecartNiveaux = declare && equivalent ? rang(equivalent.id) - rang(declare.id) : null;
    let texte;
    if (!equivalent) texte = "Aucun placement à analyser pour le moment.";
    else if (!declare) texte = "Ton portefeuille se comporte comme un profil " + equivalent.label + ". Fais ton profil de risque avec Claude pour le comparer.";
    else if (ecartNiveaux === 0) texte = "Ton portefeuille se comporte comme un profil " + equivalent.label + ", conforme à ton profil.";
    else texte = "Ton portefeuille se comporte comme un profil " + equivalent.label + ", alors que ton profil est " + declare.label + " : il prend " +
      (ecartNiveaux > 0 ? "plus de risque que tu ne le souhaites." : "moins de risque que ton profil ne le permet.");
    return {
      evaluation, profil: declare, allocation, risque,
      ecarts: declare ? ecarts(declare.id, allocation) : [],
      comparaison: { declare: declare ? declare.id : null, equivalent: equivalent ? equivalent.id : null, ecartNiveaux, texte },
    };
  }

  return { QUESTIONS, PROFILS, GROUPES, GROUPES_LABELS, GROUPE_DE, profilDuScore, evaluer, allocationReelle, risquePortefeuille, ecarts, synthese };
});
});

/* ---------- web/src/pratiques.js ---------- */
def("pratiques", function (module, exports, require) {
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
        "Demande à Claude de compléter les frais courants de tes fonds et les frais de tes contrats (assurance-vie, PER).", "compte/connexion", {
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
});

/* ---------- web/src/suivi.js ---------- */
def("suivi", function (module, exports, require) {
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
  const VERDICT_LIB = { vaut_le_cout: "Ça vaut le coût", a_peser: "À peser", ne_rien_faire: "Ne rien faire est la meilleure option ici" };
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
    const r = { sig, classe: Marche.classeRisque(p, classes), fam: Calc.famille(p, classes), nature: Pratiques.natureFrais(p, classes, ter),
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
      const valide = ROLES.includes(p.role);
      const base = p.mode === "market" && connu(p.qty) && connu(p.pru) ? +p.qty * +p.pru : null;
      const cleEnv = (p.envelope || "") + "\u0001" + (p.owner || "");
      if (!envCache.has(cleEnv)) envCache.set(cleEnv, enveloppeDe(cfg, positions, p.envelope, p.owner));
      const env = envCache.get(cleEnv);
      return { p, id: p.id, ins, ter, valeur, base, classe, nature,
        role: valide ? p.role : prop.role, roleSource: valide ? (p.role_source || "valide") : "propose", roleProp: prop.role, raison: valide ? "valide" : prop.raison,
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
    if (connu(s.plafond_satellite_pct)) plafond = +s.plafond_satellite_pct;
    else if (profil && PLAFOND_PROFIL[profil]) plafond = rep(PLAFOND_PROFIL[profil]);
    else { plafond = rep(PLAFOND_PROFIL.modere); mentions.push("profil à faire : plafond du profil Modéré en attendant"); }
    const seuilEcart = connu(s.seuil_ecart_pts) ? +s.seuil_ecart_pts : rep("suivi_seuil_ecart_pts");
    const seuilBaisse = connu(s.seuil_baisse_satellite_pct) ? +s.seuil_baisse_satellite_pct : rep("suivi_seuil_baisse_satellite_pct");
    const longMois = rep("suivi_horizon_long_ans") * 12;
    const coeurs = ctx.lignes.filter(l => roleFreq(l) === "coeur");
    const courts = coeurs.filter(l => horizonLigneMois(l.p, ctx.objectifs, today, rep).mois < longMois && !horizonLigneMois(l.p, ctx.objectifs, today, rep).suppose);
    const revueCoeur = s.revue_coeur === "annuelle" || s.revue_coeur === "semestrielle" ? s.revue_coeur : courts.length ? "semestrielle" : "annuelle";
    const passages = liste(objet(ctx.d.routines).passages).filter(estDate).sort();
    let m = connu(s.mois_revue_coeur) && +s.mois_revue_coeur >= 1 && +s.mois_revue_coeur <= 12 ? Math.round(+s.mois_revue_coeur) : passages.length ? mois2(passages[0]) : mois2(today);
    const mois = revueCoeur === "semestrielle" ? [m, ((m + 5) % 12) + 1].sort((a, b) => a - b) : [m];
    const dansConfig = ["revue_coeur", "mois_revue_coeur", "seuil_ecart_pts", "plafond_satellite_pct", "seuil_baisse_satellite_pct"].some(k => connu(s[k]) || (typeof s[k] === "string" && s[k]));
    return {
      revue: { reserve: "mensuelle", coeur: revueCoeur, satellite: "mensuelle" },
      seuils: { seuil_ecart_pts: seuilEcart, seuil_baisse_satellite_pct: seuilBaisse, ligne_satellite_max_pct: rep("suivi_ligne_satellite_max_pct"),
        societe_max_pct: rep("suivi_societe_max_pct"), frais_plancher_pct: rep("suivi_frais_plancher_pct") },
      plafond_satellite_pct: plafond, mois_revue_coeur: mois, source: dansConfig ? "config" : "defaut", profil: profil || null, mentions,
      semaine: objet(s.semaine).actif === false ? { actif: false, jour: objet(s.semaine).jour || "lundi" } : { actif: true, jour: objet(s.semaine).jour || "lundi" },
      lignes_courtes: courts.map(l => l.id), horizon_suppose: coeurs.some(l => horizonLigneMois(l.p, ctx.objectifs, today, rep).suppose),
    };
  }
  /** Prochaine revue du cœur : { date: AAAA-MM-01, mois, due (revue à faire ce mois-ci) }. */
  function prochaineRevueCoeur(ctx) {
    const pol = ctx.politique, today = ctx.today, rt = objet(ctx.d.routines);
    const derniere = estDate(rt.revue_coeur_faite_le) ? rt.revue_coeur_faite_le : null;
    const [y, m] = [+today.slice(0, 4), mois2(today)];
    const candidats = [];
    for (let k = 0; k < 14; k++) { const t = y * 12 + (m - 1) + k, yy = Math.floor(t / 12), mm = (t % 12) + 1; if (pol.mois_revue_coeur.includes(mm)) candidats.push(yy + "-" + String(mm).padStart(2, "0")); }
    const faiteCeMois = derniere && derniere.slice(0, 7) === today.slice(0, 7);
    const choix = candidats.find(c => (c === today.slice(0, 7) ? !faiteCeMois : true) && (!derniere || c > derniere.slice(0, 7))) || candidats[0];
    return { date: choix + "-01", mois: mois2(choix + "-01"), annee: +choix.slice(0, 4), due: choix === today.slice(0, 7) };
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
        pourquoi: "Pas de constat sur le coût : les frais courants du fonds ne sont pas renseignés.", source_donnees: "instruments.ter" });
      else {
        let statut;
        if (!rf) statut = r6(l.ter) <= 0.4 ? "bon" : "a_surveiller";
        else if (r6(l.ter) <= r6(rf.bas + marge)) statut = "bon";
        else if (r6(l.ter) > rf.haut && r6(l.ter) > plancher) statut = "a_travailler";
        else statut = "a_surveiller";
        const texteRepere = rf ? rf.texte : "pas de repère de frais pour cette classe : au plus « à surveiller » au-delà de 0,40 % par an";
        base("cout", statut, { mesure: { valeur: l.ter, unite: "%", texte: pct(l.ter, 2) + " de frais courants par an" + (total != null && total > l.ter ? " (" + pct(total, 2) + " avec les frais d'enveloppe)" : "") },
          repere: rf ? { texte: texteRepere, bas: rf.bas, haut: rf.haut } : { texte: texteRepere }, source_donnees: "instruments.ter, repères de frais de CP4",
          pourquoi: statut === "bon" ? "Les frais courants de la ligne sont dans le bas du repère de leur classe." : statut === "a_surveiller" ? "Les frais courants sont au-dessus du bas du repère de leur classe." : "Les frais courants dépassent le haut du repère de leur classe et 0,50 % par an.",
          calcul: ["Frais courants : " + pct(l.ter, 2), rf ? "Repère de la classe : " + frc(rf.bas, 2) + " à " + frc(rf.haut, 2) + " % par an" : "Classe sans repère de frais", "Seuil du « bon » : bas du repère + " + frc(marge, 2) + " point"],
          donnees: [donnee({ ter: l.ter })] });
      }
    }
    /* poids */
    if (l.role === "satellite") {
      const maxPct = ctx.politique.seuils.ligne_satellite_max_pct, poids = ctx.I > 0 ? l.valeur * 100 / ctx.I : 0;
      const statut = r6(poids) > maxPct ? "a_travailler" : r6(poids) >= r6(maxPct * 0.8) ? "a_surveiller" : "bon";
      base("poids", statut, { mesure: { valeur: r4(poids), unite: "%", texte: pct(poids, 1) + " de ton financier investi" }, repere: { texte: "Une ligne du satellite pèse au plus " + frc(maxPct, 0) + " % du financier investi" },
        pourquoi: statut === "a_travailler" ? "Au-dessus du repère de " + frc(maxPct, 0) + " % du financier investi." : statut === "a_surveiller" ? "Proche du repère de " + frc(maxPct, 0) + " % (de 80 à 100 %)." : "Sous le repère de " + frc(maxPct, 0) + " %.",
        calcul: [eur(l.valeur) + " ÷ " + eur(ctx.I) + " = " + pct(poids, 2)], source_donnees: "positions", donnees: [donnee({ poids_pct: r4(poids) })] });
    }
    /* chevauchement */
    if (estFonds && ctx.nbFonds >= 2) {
      const ch = chevauchementDe(ctx, l);
      if (!ch) base("chevauchement", "a_completer", { manque: ["Les 10 premières lignes de chaque fonds (données du fournisseur, à venir)"], pourquoi: "Le chevauchement avec tes autres fonds se calcule avec leur composition, pas encore disponible.", source_donnees: "instrument_expositions" });
      else {
        const sv = rep("suivi_chevauchement_surveiller_pct"), tr = rep("suivi_chevauchement_travailler_pct"), v = ch.valeur;
        const statut = r6(v) > tr ? "a_travailler" : r6(v) >= sv ? "a_surveiller" : "bon";
        base("chevauchement", statut, { mesure: { valeur: r4(v), unite: "%", texte: pct(v, 1) + " des 10 premières lignes en commun avec un autre de tes fonds" }, repere: { texte: "Moins de " + frc(sv, 0) + " % : bon ; au-delà de " + frc(tr, 0) + " % : doublon" },
          pourquoi: statut === "a_travailler" ? "Un doublon : des frais et de la complexité sans diversification en plus." : statut === "a_surveiller" ? "Une partie notable des principales lignes est la même." : "Peu de lignes en commun.",
          calcul: ["Poids communs des 10 premières lignes (minimum des deux poids) : " + frc(ch.commun, 2) + " %", "Poids des 10 premières lignes du fonds : " + frc(ch.totA, 2) + " %", "Rapport : " + pct(v, 2)], source_donnees: "instrument_expositions", donnees: [donnee()] });
      }
    }
    /* classe_risque */
    {
      const vol = (Marche.CLASSES[l.classe] || Marche.CLASSES.autres).volatilite, seuilVol = rep("suivi_volatilite_surveiller_pct");
      const levier = l.classe === "levier" || (l.ins && connu(l.ins.levier) && +l.ins.levier > 1);
      const statut = levier || l.classe === "crypto" ? "a_travailler" : vol >= seuilVol ? "a_surveiller" : "bon";
      base("classe_risque", statut, { mesure: { valeur: vol, unite: "%", texte: "Classe : " + classeLib(l.classe) + ", volatilité historique d'environ " + frc(vol, 0) + " % par an" },
        repere: { texte: "À surveiller dès " + frc(seuilVol, 0) + " % de volatilité ; levier et crypto sont des classes spéculatives" },
        pourquoi: statut === "a_travailler" ? "Classe spéculative : les pertes peuvent dépasser 50 % en quelques mois." : statut === "a_surveiller" ? "Classe plus volatile que les actions du monde développé." : "Classe sans levier ni volatilité extrême.",
        calcul: ["Volatilité historique de la classe : " + frc(vol, 0) + " % par an (marche.js)"], source_donnees: "marche.js, instruments.levier", donnees: [donnee()] });
    }
    /* solidité */
    if (estFonds) {
      const ins = l.ins || {}, enc = connu(ins.encours_eur) ? +ins.encours_eur : null, dc = ins.date_creation && estDate(ins.date_creation) ? ins.date_creation : null;
      if (enc == null && !dc) base("solidite", "a_completer", { manque: ["L'encours et la date de création du fonds (données du fournisseur, à venir)"], pourquoi: "Pas de constat sur la solidité du support : encours et ancienneté inconnus.", source_donnees: "instruments (fournisseur)" });
      else {
        const encBon = rep("suivi_encours_bon_eur"), encBas = rep("suivi_encours_bas_eur"), anc = rep("suivi_anciennete_fonds_ans");
        const ans = dc ? moisRevolus(dc, ctx.today) / 12 : null;
        const hors = (enc != null && enc < encBon) || (ans != null && ans <= anc);
        base("solidite", hors ? "a_surveiller" : "bon", { mesure: { valeur: enc, unite: "€", texte: [enc != null ? "Encours " + eur(enc) : null, ans != null ? "Ancienneté " + frc(ans, 0) + " ans" : null].filter(Boolean).join(", ") },
          repere: { texte: "Encours d'au moins " + eur(encBon) + " et plus de " + frc(anc, 0) + " ans (repères Boussole, sans source publique : jamais au-delà de « à surveiller »)" },
          pourquoi: hors ? (enc != null && enc < encBas ? "Encours bas : un petit fonds peut fermer ou fusionner." : "L'encours ou l'ancienneté sont sous les repères.") : "Encours et ancienneté au-dessus des repères.",
          calcul: ["Encours : " + (enc != null ? eur(enc) : "inconnu"), "Ancienneté : " + (ans != null ? frc(ans, 1) + " ans" : "inconnue")], source_donnees: "instruments (fournisseur)", confiance: enc != null && dc ? "complete" : "partielle", donnees: [donnee()] });
      }
    }
    /* enveloppe */
    {
      const type = l.env.type, actionsClasse = ["actions", "small_caps", "emergents"].includes(l.classe);
      const surveille = type === "compte_titres" && actionsClasse && ctx.peaDispo;
      base("enveloppe", surveille ? "a_surveiller" : "bon", { mesure: { valeur: null, texte: "Enveloppe : " + (l.enveloppe || "non précisée") },
        repere: { texte: "Une enveloppe plus favorable existe-t-elle pour cette classe ? Question posée au niveau de la classe, pas de la ligne" },
        pourquoi: surveille ? "Un PEA du foyer a encore de la place : pour les actions, il est en général plus favorable qu'un compte-titres (si la ligne est éligible au PEA)." : "Rien à dire sur l'enveloppe de cette ligne.",
        calcul: surveille ? ["Compte-titres, classe " + classeLib(l.classe) + ", et un PEA du foyer sous son plafond de versements"] : [], source_donnees: "DAT1 (enveloppes), repères fiscaux", donnees: [donnee()] });
    }
    /* devise */
    {
      const euro = l.devise === "EUR", seuil = ctx.profilRisque === "prudent" ? rep("suivi_devise_prudent_pct") : null;
      const montantDev = euro ? 0 : ctx.parDevise.get(l.devise) || 0, partDev = euro || ctx.I <= 0 ? 0 : montantDev * 100 / ctx.I;
      const surveille = !euro && seuil != null && r6(partDev) > seuil;
      base("devise", surveille ? "a_surveiller" : "bon", { mesure: { valeur: r4(partDev), unite: "%", texte: euro ? "En euros" : "En " + l.devise + " : " + pct(partDev, 1) + " de ton financier investi" },
        repere: { texte: "Information : à surveiller seulement pour un profil Prudent au-delà de " + frc(rep("suivi_devise_prudent_pct"), 0) + " % en devises" },
        pourquoi: surveille ? "Plus de " + frc(seuil, 0) + " % de ton financier investi dans une devise autre que l'euro, pour un profil Prudent." : euro ? "Ligne en euros." : "Exposition au change : une information, pas un défaut.",
        calcul: euro ? [] : [eur(montantDev) + " en " + l.devise + " ÷ " + eur(ctx.I) + " = " + pct(partDev, 1)], source_donnees: "instruments.devise", donnees: [donnee()] });
    }
    return out;
  }
  /** Météo d'une ligne : agrégation sans note (spec § 5.2). `revue` = { prochaine, meteo_figee } gèle la météo d'une ligne du cœur entre deux revues. */
  function meteo(constatsListe, role, revue, today) {
    const L = liste(constatsListe), calcules = L.filter(c => c.statut !== "a_completer");
    const couverture = { calcules: calcules.length, applicables: L.length };
    const seuil = DEFAUTS.suivi_couverture_min_pct;
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
    if (levier !== "versements_orientes") calcul.push("Montant concerné : " + eur(M));

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
    const totalV = somme(L, l => l.valeur);
    /* impôt d'une vente de `montant` sur les lignes d'une enveloppe : `rachat` = vraie sortie de l'enveloppe ; sinon arbitrage dedans */
    const sortie = (enveloppe, lignes, montant, rachat) => {
      const env = lignes[0].env, type = env.type || "compte_titres";
      if (!rachat && (CONTRAT.includes(type) || TYPES_PEA.includes(type) || ["pee", "percol"].includes(type))) return 0;
      if (type === "per") { manque.push("Un PER est bloqué jusqu'à la retraite : pas de changement d'enveloppe chiffré"); bloque = true; return 0; }
      const V = somme(lignes, l => l.valeur), part = V > 0 ? Math.min(1, montant / V) : 0;
      const baseConnue = lignes.every(l => l.base != null), base = somme(lignes, l => l.base || 0) * part;
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
      if (estMarche(envA.type)) { const t = ordresDans(A, vendu); transaction += t.cout; calcul.push("Vente dans « " + A + " » : " + eur(vendu) + " × " + frc(t.t, 2) + " % = " + eur(t.cout)); }
      else hypotheses.push("rachat d'unités de compte sans frais de vente (hypothèse) ; les frais sur versement du nouveau contrat ne sont pas comptés");
      if (envB.type && estMarche(envB.type)) { const t = ordresDans(ch.vers_enveloppe, M); transaction += t.cout; calcul.push("Achat dans « " + ch.vers_enveloppe + " » : " + eur(M) + " × " + frc(t.t, 2) + " % = " + eur(t.cout)); }
      else hypotheses.push("versement en unités de compte sans frais d'entrée (hypothèse) : les frais sur versement ne sont pas comptés");
    } else {
      /* arbitrage dans l'enveloppe : frais_classe, reequilibrer, reduire_satellite, securiser_objectif */
      for (const [e, lignes] of parEnv) {
        const V = somme(lignes, l => l.valeur), m = totalV > 0 ? M * V / totalV : 0, type = lignes[0].env.type;
        if (CONTRAT.includes(type)) { const a = arbitrage(e), c = m * a / 100; transaction += c; calcul.push("Arbitrage dans « " + e + " » : " + eur(m) + " × " + frc(a, 2) + " % = " + eur(c)); }
        else {
          const t = ordresDans(e, m), c = 2 * t.cout; transaction += c; calcul.push("Vente puis achat dans « " + (e || "enveloppe") + " » : 2 × " + eur(m) + " × " + frc(t.t, 2) + " % = " + eur(c));
          impot += sortie(e, lignes, m, false);
          if (TYPES_PEA.includes(type)) { const t2 = "vente et achat à l'intérieur du PEA : aucun impôt, le plan reste ouvert"; if (!hypotheses.includes(t2)) hypotheses.push(t2); }
        }
      }
      if (parEnv.size && [...parEnv.values()].every(ls => CONTRAT.includes(ls[0].env.type))) hypotheses.push("arbitrage à l'intérieur du contrat : aucun impôt déclenché (les frais sur versement ne sont pas comptés)");
    }
    res.cout_detail = { impot: r2(impot), transaction: r2(transaction) };
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
    if (ctx.politique.mois_revue_coeur.includes(mois2(ctx.today))) return { visible: true, raison_visibilite: "revue_du_mois" };
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
          const c = base("concentration", { portee: "ligne", classe: "actions", enveloppe: envs.length === 1 ? envs[0] : null, position_ids: s.porteurs.map(l => l.id), mesure: r4(p), seuil: S.societe_max_pct, levier: null,
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
        texte: palier ? (mesure === fen ? fen + " revues sur les " + fen + " derniers mois" : mesure + " revues sur les " + fen + " derniers mois, " + palier + " sur " + palier + " d'affilée") + " : c'est ce qui fait la différence sur 20 ans." :
          mesure + " revue" + (mesure > 1 ? "s" : "") + " sur les " + fen + " derniers mois : la revue du mois, c'est ce qui fait la différence." });
    }
    /* revue du cœur */
    {
      const pol = ctx.politique, faite = estDate(rt.revue_coeur_faite_le) ? rt.revue_coeur_faite_le : null;
      const fenetreMois = pol.revue.coeur === "semestrielle" ? 6 : 12;
      const ok = faite && moisRevolus(faite, today) < fenetreMois;
      out.push({ cle: "revue_coeur", libelle: "Revue du cœur", mesure: faite, palier: ok ? "faite" : null, prochain_palier: ok ? null : "faite",
        texte: ok ? "Revue de ton cœur faite le " + faite.split("-").reverse().join("/") + "." : "La revue de ton cœur est à faire (" + (pol.revue.coeur === "semestrielle" ? "tous les six mois" : "une fois par an") + ")." });
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
    /* tes lignes : changements de météo depuis la dernière revue, événements de lignes (famille societe et fonds) */
    {
      const mem = objet(objet(ctx.d.routines).derniere_revue), avant = objet(mem.meteo), changes = [];
      ctx.lignes.forEach(l => { const m = meteo(constatsDe(ctx, l), l.role, null, today).meteo; if (avant[l.id] && avant[l.id] !== m) changes.push({ id: l.id, avant: avant[l.id], apres: m }); });
      const deLigne = evts.filter(({ e, x }) => x.concerne && ["societe", "fonds"].includes(e.famille) && e.date >= il7 && e.date <= dans7);
      if (changes.length || deLigne.length) cartes.push({ type: "tes_lignes", titre: "Tes lignes", texte: (changes.length + deLigne.length) + " changement" + (changes.length + deLigne.length > 1 ? "s" : "") + " sur tes lignes.",
        elements: changes.map(c => Object.assign({ genre: "meteo" }, c)).concat(deLigne.map(({ e, x }) => ({ genre: "evenement", id: e.id, date: e.date, titre: e.titre || e.type, raison: x.texte }))), sources: [] });
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
      return { frequence: ctx.politique.revue.coeur, date: r.date, mois: r.mois, due: r.due, texte: r.due ? "Ton cœur est à revoir ce mois-ci (" + moisEnLettres(r.mois) + ")." : "Prochaine revue de ton cœur : " + moisEnLettres(r.mois) + "." };
    }
    return { frequence: "mensuelle", date: null, mois: null, due: true, texte: "Revue chaque mois, dans ta revue mensuelle avec Claude." };
  }
  /** Météo d'une ligne, avec le gel du cœur entre deux revues (mémoire de la dernière revue). */
  function meteoLigne(ctx, l, cs) {
    const mem = objet(objet(ctx.d.routines).derniere_revue), figee = objet(mem.meteo)[l.id];
    const rv = revueDe(ctx, l.role);
    const revue = figee && (l.role === "coeur" || l.role === null) && !rv.due ? { prochaine: rv.date, meteo_figee: figee } : null;
    return meteo(cs, l.role, revue, ctx.today);
  }
  function ligneVue(ctx, l, opts) {
    const cs = constatsDe(ctx, l), m = meteoLigne(ctx, l, cs), rv = revueDe(ctx, l.role);
    return { id: l.id, nom: l.p.name || l.p.bloc || "Ligne", enveloppe: l.enveloppe, bloc: l.p.bloc || null, classe: l.classe, classe_libelle: classeLib(l.classe), valeur: r2(l.valeur),
      poids_pct: ctx.I > 0 && l.role !== "reserve" ? r4(l.valeur * 100 / ctx.I) : null, role: l.role, role_libelle: l.role ? ROLES_LIB[l.role] : "Non classée", role_source: l.roleSource,
      role_propose: l.roleProp, raison_role: l.raison, raison_role_texte: RAISON_LIB[l.raison] || l.raison, a_confirmer: l.roleSource !== "valide", meteo: m.meteo, meteo_libelle: m.libelle,
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
  /** Ta ligne : rôle, poids, constats, prochaine revue, leviers de sa classe dans son enveloppe (avec « ça vaut le coût ? »). */
  function ligne(data, position_id, today, options) {
    const ctx = contexte(data, today), l = ligneDe(ctx, position_id), o = objet(options);
    if (!l) return null;
    const v = ligneVue(ctx, l, o);
    const leviers = declencheursCtx(ctx, o).filter(d => d.position_ids.map(String).includes(String(l.id)) || (d.cle === "ecart_cible" && d.classe === groupeAllocation(l.classe)) || d.cle === "satellite_plafond" && l.role === "satellite").map(d => ({
      cle: d.cle, titre: d.titre, pourquoi: d.pourquoi, levier: d.levier, visible: d.visible, raison_visibilite: d.raison_visibilite, mesure: d.mesure, seuil: d.seuil, verdict: d.verdict, cout: d.cout }));
    return Object.assign(v, { leviers });
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
    const etat = { le: today, revue_coeur_faite_le: o.coeur_revu ? today : estDate(rt.revue_coeur_faite_le) ? rt.revue_coeur_faite_le : null, declencheurs: decl, constats: constatsMem, meteo: meteoMem };
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
    roleParDefaut, roleEffectif, politique, systeme, constats, meteo, declencheurs, vautLeCout, habitudes, etatSuivi, routinesDe, effetRisque, exposition, maSemaine, AUCUNE_ACTION, vue, ligne, titreLevier, phraseVerdict, prochaineRevueCoeur: (data, today) => prochaineRevueCoeur(contexte(data, today)) };
});
});

export const Suivi = charger("suivi");
export const Risque = charger("risque");
export const Pratiques = charger("pratiques");
export const Calc = charger("calc");
export const Marche = charger("marche");
