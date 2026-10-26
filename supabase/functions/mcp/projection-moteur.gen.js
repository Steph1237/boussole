// Fichier généré par scripts/gen-catalogue.mjs (npm run gen) : ne pas modifier à la main.
// Copie du moteur de projection de l'app (PROJ, docs/superpowers/specs/2026-10-14-proj-projection-design.md) : les modules purs de web/src
// (reperes, calendrier, calc, marche, plan, projection-outils, projection-fiscalite, projection-evenements, projection-credit, projection-donnees, projection-immo, projection, scenarios) recopiés tels quels, évalués dans cet ordre. Aucune modification : un écart avec l'app est un bug du générateur.
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
    "salaire_croissance_reelle_pct", "hypotheses_classes", "enveloppe_scenario"];
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
    if (present(h.enveloppe_scenario)) { const m = validerEnveloppeScenario(h.enveloppe_scenario); if (m) return m; }
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

  /* -------- enveloppe d'un scénario retenu (SCN1, hypothèse de variante « enveloppe_scenario », spec § 6.6) --------
     Les messages de ce bloc sont écrits entre accents graves : ils ont leur propre test de parité avec la migration 0038 (foyer_valider_variante étendue),
     pas avec 0031 (test/projection-pglite.test.mjs ne lit que les phrases entre guillemets). Une seule enveloppe par variante en V1. */
  const TYPES_ENVELOPPE_SCENARIO = ["pea", "assurance_vie", "per", "compte_titres", "livret_a", "ldds", "lep"];
  const CHAMPS_ENVELOPPE_SCENARIO = ["scenario", "version_calcul", "type", "titulaire", "ouverture", "allocation", "ter_pct", "frais_enveloppe_pct", "initial", "mensuel", "debut",
    "plafond_versements", "debordement", "per", "transferts"];
  const TMI_SCENARIO = [0, 11, 30, 41, 45];
  const bornes = (v, a, b) => nombre(v) && typeof v !== "boolean" && +v >= a && +v <= b;
  /** Valide l'enveloppe d'un scénario retenu → null ou message (français, tutoiement). */
  function validerEnveloppeScenario(es) {
    const P_ = "« enveloppe_scenario";
    if (!estObjet(es)) return `${P_} » doit être un objet.`;
    const inconnu = Object.keys(es).find(k => !CHAMPS_ENVELOPPE_SCENARIO.includes(k));
    if (inconnu) return `${P_} » : champ « ${inconnu} » inconnu. Champs admis : ${CHAMPS_ENVELOPPE_SCENARIO.join(", ")}.`;
    if (!(typeof es.scenario === "string" && /^[a-z0-9_]{3,40}$/.test(es.scenario))) return `${P_}.scenario » : identifiant du scénario attendu (minuscules, chiffres et _, de 3 à 40 caractères).`;
    if (present(es.version_calcul) && !(typeof es.version_calcul === "string" && /^scn-\d+\.\d+\.\d+$/.test(es.version_calcul))) return `${P_}.version_calcul » : version du calcul attendue, de la forme scn-1.0.0.`;
    if (!TYPES_ENVELOPPE_SCENARIO.includes(es.type)) return `${P_}.type » : choisis parmi ${TYPES_ENVELOPPE_SCENARIO.join(", ")}.`;
    if (!["p1", "p2"].includes(es.titulaire)) return `${P_}.titulaire » : p1 ou p2 attendu.`;
    const datee = d => O.estDate(d) && d >= "1950-01-01" && d <= "2100-12-31";
    if (!datee(es.ouverture)) return `${P_}.ouverture » : date AAAA-MM-JJ attendue.`;
    const livret = ["livret_a", "ldds", "lep"].includes(es.type);
    if (!livret || present(es.allocation)) {
      if (!estObjet(es.allocation) || !Object.keys(es.allocation).length) return `${P_}.allocation » : objet { classe: pourcentage } attendu, de somme 100 %.`;
      const classes = Marche.CLES.filter(k => k !== "levier");
      const k = Object.keys(es.allocation).find(x => !classes.includes(x));
      if (k) return `${P_}.allocation » : classe inconnue « ${k} ».`;
      if (!Object.values(es.allocation).every(v => bornes(v, 0, 100))) return `${P_}.allocation » : pourcentages de 0 à 100 attendus.`;
      if (Math.abs(Object.values(es.allocation).reduce((a, v) => a + +v, 0) - 100) > 0.01) return `${P_}.allocation » : la somme des pourcentages doit faire 100 %.`;
    }
    if (present(es.ter_pct) && !bornes(es.ter_pct, 0, 3)) return `${P_}.ter_pct » : de 0 à 3 % par an attendu.`;
    if (present(es.frais_enveloppe_pct) && !bornes(es.frais_enveloppe_pct, 0, 3)) return `${P_}.frais_enveloppe_pct » : de 0 à 3 % par an attendu.`;
    const seulement = (o, cles) => Object.keys(o).every(k => cles.includes(k));
    if (present(es.initial)) {
      if (!estObjet(es.initial) || !seulement(es.initial, ["montant", "depuis"]) || !bornes(es.initial.montant, 0, 1000000) || (present(es.initial.depuis) && es.initial.depuis !== "disponible")) return `${P_}.initial » : { montant de 0 à 1 000 000 €, depuis: « disponible » } attendu.`;
    }
    if (present(es.mensuel)) {
      if (!estObjet(es.mensuel) || !seulement(es.mensuel, ["montant", "depuis"]) || !bornes(es.mensuel.montant, 0, 100000) || (present(es.mensuel.depuis) && !["capacite", "en_plus"].includes(es.mensuel.depuis))) return `${P_}.mensuel » : { montant de 0 à 100 000 €, depuis: « capacite » ou « en_plus » } attendu.`;
    }
    if (present(es.debut) && (!datee(es.debut) || es.debut < es.ouverture)) return `${P_}.debut » : date AAAA-MM-JJ, postérieure ou égale à l'ouverture, attendue.`;
    if (present(es.plafond_versements) && !bornes(es.plafond_versements, 0, 10000000)) return `${P_}.plafond_versements » : montant de 0 à 10 000 000 € attendu.`;
    if (present(es.debordement) && !["compte_titres", "disponible"].includes(es.debordement)) return `${P_}.debordement » : « compte_titres » ou « disponible » attendu.`;
    if (present(es.per)) {
      if (es.type !== "per") return `${P_}.per » : réservé au type per.`;
      const p = es.per;
      if (!estObjet(p) || !seulement(p, ["deduit", "tmi_retraite_pct", "tmi_actuelle_pct", "economie"])) return `${P_}.per » : objet { deduit, tmi_retraite_pct, tmi_actuelle_pct, economie } attendu.`;
      if (present(p.deduit) && typeof p.deduit !== "boolean") return `${P_}.per.deduit » : vrai ou faux attendu.`;
      if (present(p.tmi_retraite_pct) && !(nombre(p.tmi_retraite_pct) && TMI_SCENARIO.includes(+p.tmi_retraite_pct))) return `${P_}.per.tmi_retraite_pct » : 0, 11, 30, 41 ou 45 attendu.`;
      if (present(p.tmi_actuelle_pct) && !(nombre(p.tmi_actuelle_pct) && TMI_SCENARIO.includes(+p.tmi_actuelle_pct))) return `${P_}.per.tmi_actuelle_pct » : 0, 11, 30, 41 ou 45 attendu.`;
      if (present(p.economie) && !["reinvestie", "depensee"].includes(p.economie)) return `${P_}.per.economie » : « reinvestie » ou « depensee » attendu.`;
    }
    if (present(es.transferts)) {
      if (!Array.isArray(es.transferts) || es.transferts.length > 5 || !es.transferts.every(t => estObjet(t) && seulement(t, ["de", "montant"]) && ["livret_a", "ldds", "courant"].includes(t.de) && bornes(t.montant, 0.01, 1000000)))
        return `${P_}.transferts » : 5 transferts au plus, chacun { de: « livret_a », « ldds » ou « courant », montant de 0,01 à 1 000 000 € }.`;
    }
    return null;
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
    HYPOTHESES_VARIANTE, ENTREES, validerEvenement, validerVariante, validerEnveloppeScenario, TYPES_ENVELOPPE_SCENARIO, defautsDe };
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
   Entrée : data = { today, positions, instruments, config, profil, credits, biens, budget, banque, relevesBancaires?, objectifs, foyer, reperes, classes?, calendrier? }. */
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
  /** Cible de budget en vigueur (BUD1 § 7.5, D12) : la plus récente dont `valide_du` (AAAA-MM) n'est pas après le mois de `today`, pour le périmètre ("foyer", "p1", "p2") ;
      { epargne, valide_du, validee_le } ou null. Même règle que Budget.cibleEnVigueur (parité testée) : config.budget_cible.historique puis perimetres[périmètre]. */
  function cibleEnVigueur(bc, perimetre, today) {
    const m = typeof today === "string" && /^\d{4}-\d{2}/.test(today) ? today.slice(0, 7) : null;
    if (!bc || typeof bc !== "object" || !m) return null;
    const mois = v => (typeof v === "string" && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null);
    const entrees = [];
    for (const h of liste(bc.historique)) if (h && (h.perimetre || "foyer") === perimetre && mois(h.valide_du) && h.cible && typeof h.cible === "object") entrees.push({ valide_du: mois(h.valide_du), cible: h.cible, propose_le: h.propose_le });
    const courante = objet(bc.perimetres)[perimetre];
    if (courante && mois(courante.valide_du) && !entrees.some(e => e.valide_du === mois(courante.valide_du))) entrees.push({ valide_du: mois(courante.valide_du), cible: courante });
    const e = entrees.filter(x => x.valide_du <= m).sort((a, b) => (a.valide_du < b.valide_du ? -1 : a.valide_du > b.valide_du ? 1 : 0)).pop();
    if (!e) return null;
    const bl = objet(e.cible.blocs !== undefined ? e.cible.blocs : e.cible), ep = +bl.epargne;
    return isFinite(ep) && bl.epargne !== null && bl.epargne !== "" ? { epargne: ep, valide_du: e.valide_du, validee_le: typeof e.propose_le === "string" ? e.propose_le : null } : null;
  }
  /** Capacité de base : constatée (comptes), prévue (budget), programmée (virements), retenue et sa source. options : { perimetre, base_capacite, capacite_mensuelle }. */
  function capaciteDeBase(data, options) {
    const d = data || {}, o = options || {}, sc = o.perimetre || "foyer", cfgp = objet(objet(d.config).projection);
    const R = O.indexReperes(d.reperes), today = d.today;
    const lignes = d.budget && Array.isArray(d.budget.lignes) ? d.budget.lignes : [];
    const totaux = Plan.budgetTotaux(lignes, d.profil, sc);
    /* BUD1 (spec § 8.5) : quand une cible validée du périmètre est en vigueur ce mois-ci, le budget prévu est l'épargne de cette cible (source « ta cible de budget,
       validée le JJ/MM »), au lieu de la capacité des lignes du budget déclaré. La constatée reste retenue par défaut. */
    const cibleBudget = cibleEnVigueur(objet(d.config).budget_cible, sc, today);
    const prevue = cibleBudget ? cibleBudget.epargne : Plan.capaciteEpargne(totaux);
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
    if (sc === "foyer" && (d.banque || liste(objet(d.relevesBancaires).releves).length)) {
      let r = Calc.budgetReel(d.banque, today, 12, d.relevesBancaires), courte = false;
      if (!(r && r.n >= 6)) { r = Calc.budgetReel(d.banque, today, 3, d.relevesBancaires); courte = !!r; }
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
    const prevueSource = cibleBudget ? "cible" : "budget";
    const prevueLibelle = cibleBudget ? "ta cible de budget" + (cibleBudget.validee_le ? ", validée le " + cibleBudget.validee_le.slice(8, 10) + "/" + cibleBudget.validee_le.slice(5, 7) : "") : "ton budget";
    return { constatee, prevue, prevue_source: prevueSource, prevue_libelle: prevueLibelle, programmee, retenue, source, ecart_pct: ecart == null ? null : ecart * 100, signale, periode: detail ? detail.periode : null,
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
      banque: s.banque || null, relevesBancaires: s.relevesBancaires || null, objectifs: liste(s.objectifs), foyer: { evenements: liste(objet(s.foyer).evenements), variantes: liste(objet(s.foyer).variantes) },
      reperes: liste(objet(s.savoir).reperes), indices: liste(s.indices), classes: objet(s.classes), historique: historiquePourRetro(s.snapshots, s.tx) };
  }

  return { cibleEnVigueur, ecarterIndisponibles, depuisEtat, historiquePourRetro, CLASSES_TIREES, IDX, correlationTirees, matriceTirees, choleskyTirees, contexte, ciblesAllocation, parametresClasse, capaciteDeBase, construireCompartiments,
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
  /** BUD1 (spec § 10) : probabilité visée d'un objectif (8 chances sur 10), pas de la recherche (€/mois), plafond de l'épargne en plus (€/mois), nombre de simulations. */
  const SEUIL_OBJECTIF = 0.8, PAS_EPARGNE = 25, EPARGNE_MAX = 10000, SIMULATIONS_MAX = 16, CHEMINS_EPARGNE = 500, ID_VARIANTE_EPARGNE = "_epargne_necessaire";
  /** Incrémentée à chaque changement de calcul ; rendue avec chaque résultat (rejouer une projection passée). */
  const versionModele = "proj-1.4.0";
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
    /* ---- enveloppe d'un scénario retenu (SCN1, hypothèse de variante enveloppe_scenario) : compartiments synthétiques, ajoutés avant le calcul des rendements ---- */
    M.scn = ctx.variante && objet(ctx.variante.hypotheses).enveloppe_scenario ? enveloppeScenario(M, ctx, comps, cc, objet(ctx.variante.hypotheses).enveloppe_scenario) : null;
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
    /* économie d'impôt du PER d'un scénario retenu : une marche d'un mois, en septembre de l'année suivante (régularisation de l'impôt) */
    if (M.scn) M.scn.economies.forEach(x => addComposant({ id: "scenario:per:" + x.annee, type: "scenario", libelle: "Économie d'impôt du PER", t0: x.t, t1: x.t + 1, nom: x.montant,
      raison: "économie d'impôt du PER (scénario « " + M.scn.cle + " ») : +" + eur(x.montant) + " en " + dates[x.t].slice(0, 7), raisonFin: null }));
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
          const modele = comps.find(c => c.type === tp && !c.levier && !c.scenario && proprietaires.includes(c.titulaire));
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


  /* ================================================================== enveloppe d'un scénario retenu (SCN1, spec § 6.6) */
  /** Compartiments synthétiques de l'hypothèse enveloppe_scenario d'une variante : un par classe de l'allocation, de valeur 0, ouverts à leur date (les dates de 5 et 8 ans
      courent depuis l'ouverture, comme le calendrier), plus le plan de dépôt lu par derouler (versement de départ au niveau 1 de l'ordre de retrait, versement mensuel
      prélevé comme un versement programmé, débordement au plafond, transferts depuis un livret) et l'économie d'impôt du PER. Ajoute les compartiments à `comps`.
      Rend null si l'enveloppe n'est pas dans le périmètre (l'autre personne). Sans cette hypothèse, rien de ceci ne s'exécute : proj-1.2.0 est inchangé. */
  function enveloppeScenario(M, ctx, comps, cc, es) {
    const N = M.N, today = M.today, dates = M.dates, rg = ctx.reglages, sc = ctx.perimetre;
    if (sc !== "foyer" && sc !== es.titulaire) return null;
    const type = es.type, livret = F.LIVRETS.includes(type), per = type === "per";
    const alloc = livret || !es.allocation ? { monetaire: 100 } : es.allocation;
    const total = sum(Object.values(alloc), x => +x || 0), ter = O.n0(es.ter_pct), fenv = O.n0(es.frais_enveloppe_pct);
    const tInit = Math.max(1, O.moisEntre(today, es.ouverture)), t0 = Math.max(tInit, O.moisEntre(today, es.debut || es.ouverture));   // départ à l'ouverture, versements mensuels à partir du début
    const initial = es.initial ? O.n0(es.initial.montant) : 0, mensuel = es.mensuel ? O.n0(es.mensuel.montant) : 0, enPlus = !!(es.mensuel && es.mensuel.depuis === "en_plus");
    const plafond = es.plafond_versements != null && !per ? +es.plafond_versements : null;
    /* dépôts prévus mois par mois (le versement de départ est supposé complet) : base fiscale, primes et versements déduits */
    const deposes = new Float64Array(N + 2);
    for (let t = t0; t <= N; t++) deposes[t] = mensuel;
    if (tInit <= N) deposes[tInit] += initial;
    let verse = 0, dedTotal = 0;
    const parAnnee = {};
    for (let t = tInit; t <= N; t++) { verse += deposes[t]; const y = +dates[t].slice(0, 4); parAnnee[y] = (parAnnee[y] || 0) + deposes[t]; }
    const deduit = per && !(es.per && es.per.deduit === false);
    const economies = [];
    /* TMI de l'économie d'impôt : celle du scénario retenu (per.tmi_actuelle_pct), sinon le réglage du foyer, sinon 30 % (dit) */
    let tmi = per && es.per && es.per.tmi_actuelle_pct != null ? +es.per.tmi_actuelle_pct : rg.tmi_pct;
    if (per && deduit) {
      if (tmi == null || !isFinite(+tmi)) { tmi = 30; M.avertissements.push("taux marginal supposé de 30 % pour l'économie d'impôt du PER, à confirmer avec Claude"); }
      Object.keys(parAnnee).map(Number).sort((a, b) => a - b).forEach(y => {
        const ded = es.plafond_versements != null ? Math.min(parAnnee[y], +es.plafond_versements) : parAnnee[y];
        dedTotal += ded;
        if (es.per && es.per.economie === "depensee") return;
        const t = dates.findIndex((d, k) => k >= 1 && k <= N && d.slice(0, 7) === (y + 1) + "-09");
        if (t > 0 && ded * tmi / 100 > 0) economies.push({ annee: y, t, montant: ded * tmi / 100 });
      });
    }
    const tmiRetraite = per && es.per && es.per.tmi_retraite_pct != null ? +es.per.tmi_retraite_pct : (per ? (rg.tmi_pct != null ? +rg.tmi_pct : 30) : undefined);
    const primes = sum(comps.filter(x => x.titulaire === es.titulaire && F.AV.includes(x.type)), x => x.base0) + (F.AV.includes(type) ? Math.min(verse, plafond == null ? Infinity : plafond) : 0);
    const nom = "Scénario « " + es.scenario + " »";
    const creer = (typeC, classe, poids, nomEnv, cle) => {
      const fiscal = { type: typeC, valeur: 0, base: verse * poids, classe, date_ouverture: typeC === type ? es.ouverture : undefined, versements_deduits: typeC === "per" ? (deduit ? dedTotal * poids : 0) : undefined, dates: {} };
      const c = { id: "c" + comps.length, enveloppe: nomEnv, cle, titulaire: es.titulaire, owner: es.titulaire, type: typeC, classe, levier: null, v0: 0, base0: 0, base_inconnue: false,
        ter_pct: classe === "fonds_euros" || livret ? 0 : ter, frais_env_pct: fenv, dispo: F.LIVRETS.includes(typeC), info: { date_ouverture: typeC === type ? es.ouverture : undefined }, lignes: [], synthetique: true,
        scenario: true, dates: { pea_5_ans: null, av_8_ans: null, pee_disponible: null }, fiscal };
      c.prep = F.preparer(fiscal, { reperes: ctx.R, couple: cc.couple, primes_titulaire: F.AV.includes(typeC) ? primes : undefined, tmi_pct: typeC === "per" ? tmiRetraite : rg.tmi_pct,
        per_versements_deduits: typeC === "per" ? deduit : rg.per_versements_deduits });
      if (c.prep.indisponible) M.avertissements.push("impôt de sortie de l'enveloppe du scénario non calculé (" + c.prep.mentions[0] + ")");
      comps.push(c);
      return comps.length - 1;
    };
    const classes = Object.keys(alloc).filter(k => +alloc[k] > 0);
    const b = classes.map(k => creer(type, k, alloc[k] / total, nom, "scenario:" + es.scenario)), w = classes.map(k => alloc[k] / total);
    let bDeb = null, wDeb = null;
    if (plafond != null && es.debordement === "compte_titres" && type !== "compte_titres") {
      bDeb = classes.map(k => creer("compte_titres", k, 1 / classes.length, nom + " (débordement)", "scenario:" + es.scenario + ":debordement")); wDeb = w;
    }
    return { cle: es.scenario, type, titulaire: es.titulaire, b, w, bDeb, wDeb, plafond, tInit, tDeb: t0, initial, mensuel, enPlus, transferts: liste(es.transferts).map(x => ({ de: x.de, montant: +x.montant })), economies, per: per ? { deduit, tmi_retraite_pct: tmiRetraite } : null };
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
    /* ---- enveloppe d'un scénario retenu : versements cumulés par chemin (plafond) et dépôt ---- */
    const scnVerse = M.scn ? new Float64Array(P) : null;
    function deposerScenario(i, off, x) {
      const s = M.scn;
      if (!(x > 0)) return;
      let dedans = x, dehors = 0;
      if (s.plafond != null) { dedans = Math.min(x, Math.max(0, s.plafond - scnVerse[i])); dehors = x - dedans; }
      scnVerse[i] += dedans;
      if (dedans > 0) s.b.forEach((b, k) => depose(off, b, dedans * s.w[k]));
      if (dehors > 1e-12) { if (s.bDeb) s.bDeb.forEach((b, k) => depose(off, b, dehors * s.wDeb[k])); else depose(off, iC, dehors); }
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
        if (M.scn && t >= M.scn.tInit) {
          const sn = M.scn;
          if (t === sn.tInit) {
            /* versement de départ : pris sur le disponible au-dessus du matelas (niveau 1 de l'ordre de retrait) ; transferts depuis un livret ou le courant */
            if (sn.initial > 0) deposerScenario(i, off, sn.initial - retirer(i, t, sn.initial, { niveau_max: 1 }, matelasNom));
            for (const tf of sn.transferts) {
              let restant = tf.montant, pris = 0;
              for (let k = 0; k < B && restant > 1e-9; k++) {
                if (comps[k].scenario || comps[k].type !== tf.de) continue;
                const x = Math.min(Math.max(0, V[off + k]), restant);
                V[off + k] -= x; restant -= x; pris += x;
              }
              deposerScenario(i, off, pris);
            }
          }
          if (sn.mensuel > 0 && t >= sn.tDeb) { deposerScenario(i, off, sn.mensuel); if (!sn.enPlus) reste -= sn.mensuel; if (trace && i === 0) tr.depotsProg[t] += sn.mensuel; }
        }
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
      comps.forEach((c, b) => { if (c.dispo || c.type === "compte_titres" || c.levier || c.scenario) return; const k = c.cle + "|" + c.titulaire; if (!parEnv.has(k)) parEnv.set(k, []); parEnv.get(k).push(b); });
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
          (cb.prevue_source === "cible" ? " prévus par " + cb.prevue_libelle : " prévus au budget") + (cb.programmee > 0 ? " et " + eur(cb.programmee) + " de versements programmés" : "") + " : la projection part de la capacité constatée." });
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

  /** Comparaison de deux modèles sur les mêmes tirages : écart chemin par chemin, centiles de l'écart, probabilité que B fasse mieux que A.
      opts.net_impots === true : écart après les impôts de sortie (« si tu retirais tout »), indispensable pour une variante qui ne change que l'enveloppe
      (scénario retenu, SCN1) ; sans cette option, l'écart est brut, comme avant proj-1.3.0 (aucune sortie existante ne change). */
  function comparer(MA, MB, opts) {
    const o = opts || {};
    if (MA.N !== MB.N) return { erreur: "les deux modèles n'ont pas le même horizon" };
    assurerDet(MA); assurerDet(MB);
    const P = o.chemins > 0 ? Math.round(o.chemins) : 2000, N = MA.N, vue = o.vue || MA.options.vue, graine = o.graine == null ? GRAINE : o.graine, netImp = o.net_impots === true;
    const marques = []; for (let t = 12; t <= N; t += 12) marques.push(t); if (marques[marques.length - 1] !== N) marques.push(N);
    const a = derouler(MA, { P, graine, vue, net_impots: netImp, retenir: marques }), b = derouler(MB, { P, graine, vue, net_impots: netImp, retenir: marques });
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
    const out = { version_modele: versionModele, graine, chemins: P, vue, euros, mois: marques.map(t => MA.dates[t]), ecarts, probabilite_mieux: probMieux, chaque_chemin_superieur_ou_egal: chaque,
      horizon: { mediane_des_ecarts: ecarts.p50[dernier], probabilite_mieux: probMieux[dernier], p10: ecarts.p10[dernier], p90: ecarts.p90[dernier] } };
    if (netImp) out.net_impots = true;
    return out;
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
});

/* ---------- web/src/scenarios.js ---------- */
def("scenarios", function (module, exports, require) {
/* Scénarios de décision patrimoniale (SCN1 V1) : le calcul des cinq scénarios du premier lot, leur pertinence, leur enjeu et le tri « pour toi ».
   Module pur, sans DOM, au tutoiement. Spec : docs/superpowers/specs/2026-10-17-scn1-scenarios-design.md (§ 6 et § 7) ; cas de référence :
   test/fixtures/scenarios-cas.json (la fixture fait foi). Global Scenarios (navigateur), module CommonJS sous Node, copie générée dans le
   connecteur avec le moteur de projection (supabase/functions/mcp/projection-moteur.gen.js, npm run gen, décision D14) : un seul calcul
   pour l'app et pour Claude. Aucun texte ne vient du LLM : les phrases sont des gabarits de ce module.

   Scenarios.VERSION_CALCUL, CALCULS, THEMES
   Scenarios.simulerEnveloppes(data, plan, opts)            socle : des enveloppes « à la marge » sur les tirages du moteur PROJ (§ 6.2)
   Scenarios.pertinence(entree, data, today)                → { pertinent, personnes, raisons, manquants }
   Scenarios.enjeu(entree, data, today, { chemins })        → { p10, p50, p90, unite, statut, raison? }
   Scenarios.lister(catalogue, data, joues, today, opts)    → { pour_toi, par_theme, cartes, message }
   Scenarios.jouer(entree, data, reponses, today, opts)     → résultat (§ 6.7)
   Scenarios.varianteRetenue(entree, resultat, option_id)   → { nom, description, hypotheses: { enveloppe_scenario } } (variante figée, rejouée par le moteur proj-1.3.0)
   Scenarios.reponsesValides(entree, reponses)              → null | [message]
   Scenarios.preremplir(entree, data, today)                → { id_question: valeur } (jamais par le LLM)
   Scenarios.pourToi(cartes, seuil)                         → { cles, message }

   data = forme de Projection.preparer ({ today, positions, instruments, config, profil, budget, objectifs, risque, reperes, … }) ;
   entree = ligne du catalogue (forme de l'app) ; reponses = { id de question: valeur } (nombres, booléens, dates ISO, options : jamais de texte libre).
   opts (tous facultatifs) : { chemins (2 000 par défaut ; 500 pour les cartes), graine, volatilite: 0 (mode déterministe des cas chiffrés à la main),
   frais, allocation, plafondPerAnnuel, budgetReference, hypotheses_classes } : les cinq derniers sont des points d'entrée des tests et des hypothèses
   dites (frais des enveloppes quand l'utilisateur ne les a pas renseignés, allocation, plafond de déduction du PER, dépenses essentielles de BUD1). */
(function (root, factory) {
  const cjs = typeof module === "object" && module.exports;
  const dep = (nom, global) => (cjs ? require("./" + nom + ".js") : root[global]);
  /* BUD1 (Budget.reference) n'existe pas encore : lecture facultative, jamais bloquante (voir lireEssentiels, point d'intégration). */
  const facultatif = (nom, global) => { try { return cjs ? require("./" + nom + ".js") : root[global]; } catch (e) { return undefined; } };
  const api = factory({
    O: dep("projection-outils", "ProjectionOutils"), F: dep("projection-fiscalite", "ProjectionFiscalite"), D: dep("projection-donnees", "ProjectionDonnees"),
    Proj: dep("projection", "Projection"), Calendrier: dep("calendrier", "Calendrier"), Calc: dep("calc", "Calc"),
    Reperes: dep("reperes", "Reperes"), E: dep("projection-evenements", "ProjectionEvenements"), Budget: facultatif("budget", "Budget"),
    PC: dep("projection-credit", "ProjectionCredit"),
  });
  if (cjs) module.exports = api;
  else root.Scenarios = api;
})(typeof self !== "undefined" ? self : this, function (X) {
  "use strict";
  const { O, F, D, Proj, Calendrier, Calc, Reperes, E, PC } = X;

  const VERSION_CALCUL = "scn-1.0.0";
  /** Thèmes, dans l'ordre d'affichage de l'onglet « Pour toi ». */
  const THEMES = ["epargne", "placements", "retraite", "banque", "immobilier", "famille"];
  const RAPPEL = "Une projection n'est pas une promesse. Boussole n'exécute rien : c'est toi qui décides et qui fais.";
  const MESSAGE_RIEN_URGENT = "Rien d'urgent ici. Parcours les thèmes si une question te parle.";
  const UNITE_ENJEU = "€/an d'aujourd'hui";
  /** Repères propres aux scénarios (conventions) : valeurs de secours seulement pour le seuil d'affichage, jamais pour un calcul fiscal. */
  const SEUIL_ENJEU_DEFAUT = 30;
  const EPS = 1e-9;

  const objet = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const liste = v => (Array.isArray(v) ? v : []);
  const somme = (l, f) => l.reduce((a, x) => a + f(x), 0);
  const p3 = x => Math.round(x * 1000) / 1000;
  const r2 = x => (x == null || !isFinite(x) ? x : O.arrondi2(x));
  const nombre = v => (typeof v === "number" && isFinite(v)) || (typeof v === "string" && v.trim() !== "" && isFinite(+v));
  const copie = v => JSON.parse(JSON.stringify(v));

  /* ================================================================== repères */
  /** Lecteur de repères d'une entrée : v(cle) → valeur ou undefined ; trace les repères lus. */
  function lecteur(d) {
    const idx = O.indexReperes(d.reperes), lus = new Map();
    const v = cle => { const r = idx[cle]; if (!r) return undefined; lus.set(cle, r); return +r.valeur; };
    return { v, idx, lus };
  }
  /** Statut d'un repère à la date du jour : « a_reverifier » (fin de période passée ou vérifié il y a plus de 180 jours), « convention » ou « verifie ». */
  function statutRepere(r, today) {
    if ((r.dateFin && r.dateFin < today) || Reperes.aVerifier(r, today)) return "a_reverifier";
    return /^scn_|^suivi_/.test(r.cle) || /^Convention Boussole/.test(r.sourceTitre || "") ? "convention" : "verifie";
  }
  const hypotheseDe = (r, today) => ({ cle: r.cle, libelle: r.libelle, valeur: +r.valeur, unite: r.unite, statut: statutRepere(r, today),
    source: { titre: r.sourceTitre || null, url: r.sourceUrl || null, verifie_le: r.verifieLe || null }, date_effet: r.dateEffet || null, date_fin: r.dateFin || null });

  /* ================================================================== le foyer */
  /** Enveloppes du foyer { cle, nom, type, titulaire, infos } d'après les lignes ouvertes et enveloppes_infos (types déclarés, sinon déduits du nom, comme le calendrier). */
  function lesEnveloppes(d) {
    const inf = objet(objet(d.config).enveloppes_infos), vues = new Map(), pos = liste(d.positions);
    pos.filter(p => p && typeof p.envelope === "string" && p.envelope.trim() && p.status !== "clôturé").forEach(p => {
      const cle = Calendrier.cleEnveloppe(p.envelope, p.owner, pos, inf);
      if (vues.has(cle)) return;
      const i = objet(inf[cle]), type = typeof i.type === "string" ? i.type : Calendrier.typeDeduit(p.envelope);
      vues.set(cle, { cle, nom: p.envelope.trim(), type, titulaire: ["p1", "p2", "commun"].includes(i.titulaire) ? i.titulaire : p.owner, infos: i });
    });
    Object.keys(inf).filter(k => !vues.has(k) && inf[k] && typeof inf[k] === "object").forEach(k => {
      const i = inf[k];
      if (i.date_cloture) return;
      vues.set(k, { cle: k, nom: k.replace(/\|p[12]$/, ""), type: typeof i.type === "string" ? i.type : Calendrier.typeDeduit(k), titulaire: ["p1", "p2", "commun"].includes(i.titulaire) ? i.titulaire : null, infos: i });
    });
    return [...vues.values()];
  }
  /** Personnes du foyer { id, nom, naissance, salaire }, périmètre fiscal (couple à imposition commune), enveloppes par personne. */
  function foyer(d, today) {
    const profil = objet(d.profil), pers = objet(profil.personnes), f = objet(profil.foyer);
    const ids = ["p1", "p2"].filter(k => pers[k] && typeof pers[k] === "object");
    const personnes = ids.map(k => ({ id: k, nom: pers[k].nom || (k === "p1" ? "Personne 1" : "Personne 2"), naissance: pers[k].naissance || null,
      salaire: pers[k].salaire != null ? +pers[k].salaire : null, age: pers[k].naissance && O.estDate(pers[k].naissance) ? O.age(pers[k].naissance, today) : null }));
    const adultes = f.adultes != null ? +f.adultes : personnes.length;
    const couple = f.union === "joint" && adultes >= 2 && personnes.length >= 2;
    const enveloppes = lesEnveloppes(d);
    return { personnes, adultes, enfants: +f.enfants || 0, couple, enveloppes };
  }
  /** La personne détient-elle une enveloppe de l'une de ces familles de types ? (une enveloppe commune compte pour les deux) */
  const detient = (fo, personne, types) => fo.enveloppes.some(e => types.includes(e.type) && (e.titulaire === personne || e.titulaire === "commun" || !e.titulaire));
  const TYPES_PEA = F.PEA, TYPES_AV = F.AV;
  const famillesTypes = { pea: TYPES_PEA, assurance_vie: TYPES_AV, per: ["per"], compte_titres: ["compte_titres"], lep: ["lep"], livret_a: ["livret_a"], ldds: ["ldds"] };
  const nomEnveloppe = { pea: "PEA", assurance_vie: "assurance-vie", per: "PER", compte_titres: "compte-titres", lep: "LEP", livret_a: "Livret A", ldds: "LDDS" };

  /** TMI du foyer (%), ou null si elle est inconnue. */
  function tmiDe(d) {
    const v = objet(objet(d.config).projection).tmi_pct != null ? objet(objet(d.config).projection).tmi_pct : objet(objet(d.profil).foyer).tmi;
    return v == null || v === "" || !isFinite(+v) ? null : +v;
  }
  const capaciteDe = d => D.capaciteDeBase(d, {}).retenue;

  /* ================================================================== dépenses de référence et matelas (§ 7.4) */
  /* POINT D'INTÉGRATION BUD1 : nom du champ « dépenses essentielles » de Budget.reference (BUD1 tâche 7). Tant que BUD1 n'est pas en ligne,
     lireEssentiels rend null (ou le bouchon des tests, opts.budgetReference) et le calcul se replie sur le budget prévu, en le disant. */
  const CHAMP_ESSENTIELS = "essentiels";
  function lireEssentiels(d, today, opts) {
    const o = opts || {};
    let ref = null;
    try {
      if (o.budgetReference !== undefined) ref = typeof o.budgetReference === "function" ? o.budgetReference(d, { vue: "tout" }) : o.budgetReference;
      else if (X.Budget && typeof X.Budget.reference === "function") ref = X.Budget.reference(d, { vue: "tout" });
    } catch (e) { ref = null; }
    const v = ref && ref[CHAMP_ESSENTIELS];
    return nombre(v) && +v > 0 ? { montant: +v, source: "budget_reference", detail: ref.source || null } : null;
  }
  /** Dépenses mensuelles de référence : Budget.reference → budget prévu hors épargne → dépenses saisies du matelas → null. */
  function depensesReference(d, today, opts) {
    const e = lireEssentiels(d, today, opts);
    if (e) return e;
    const lignes = liste(objet(d.budget).lignes || d.budget);
    const prevues = Calc.depensesPrevues(d.budget, d.profil, d.config, "foyer");
    if (prevues > 0) return { montant: prevues, source: lignes.some(l => l && l.type === "depense") ? "budget_prevu" : "matelas_saisi", detail: null };
    return null;
  }
  /** Nombre de mois de la convention (§ 8.4) : 9 indépendant ou sans revenu d'activité, 6 un seul revenu, enfants ou revenus variables, sinon 3. */
  function moisConvention(d, fo, lire) {
    const rev = objet(objet(d.risque).reponses).revenus;
    if (rev === "independant" || rev === "sans") return { mois: lire("scn_matelas_mois_independant"), cle: "scn_matelas_mois_independant" };
    const actifs = fo.personnes.filter(p => p.salaire > 0).length;
    if (rev === "variables" || actifs < 2 || fo.enfants > 0) return { mois: lire("scn_matelas_mois_fragile"), cle: "scn_matelas_mois_fragile" };
    return { mois: lire("scn_matelas_mois_stable"), cle: "scn_matelas_mois_stable" };
  }
  /** Plafond de revenu fiscal de référence du LEP pour un nombre de parts : 1 part + n demi-parts + au plus un quart de part. */
  function plafondRfrLep(parts, lire) {
    const base = lire("lep_rfr_1_part"), demi = lire("lep_rfr_demi_part_sup"), quart = lire("lep_rfr_quart_part_sup");
    if ([base, demi, quart].some(v => v === undefined) || !(parts >= 1)) return null;
    const sup = Math.round((parts - 1) * 4) / 4, nDemi = Math.floor(sup / 0.5 + 1e-9), nQuart = sup - nDemi * 0.5 > 1e-9 ? 1 : 0;
    return base + nDemi * demi + nQuart * quart;
  }
  /** Éligibilité au LEP d'après l'avis d'impôt (revenu fiscal de référence de l'année N − 1 ou N − 2) et le nombre de parts (réponse, sinon l'avis).
      → { eligible: vrai | faux | null, plafond_rfr, rfr, parts, avis_trop_ancien }. */
  function eligibiliteLep(d, today, lire, partsReponse) {
    const avis = objet(objet(d.config).avis_impot), parts = nombre(partsReponse) ? +partsReponse : nombre(avis.parts) ? +avis.parts : null, rfr0 = nombre(avis.rfr) ? +avis.rfr : null;
    const annee = nombre(avis.annee_revenus) ? +avis.annee_revenus : null, tropAncien = annee != null && annee < +today.slice(0, 4) - 2, rfr = tropAncien ? null : rfr0;
    const plafond = parts != null ? plafondRfrLep(parts, lire) : null;
    return { eligible: plafond != null && rfr != null ? rfr <= plafond : null, plafond_rfr: plafond, rfr, parts, avis_trop_ancien: tropAncien ? annee : null };
  }
  /** État du matelas du foyer : dépenses, mois, cible, actuel, surplus, manque ; null si les dépenses sont inconnues. */
  function etatMatelas(d, today, lire, opts, rep) {
    const fo = foyer(d, today), dep = depensesReference(d, today, opts);
    if (!dep) return { dep: null, fo };
    const conv = moisConvention(d, fo, lire), mois = rep && nombre(rep.mois) ? +rep.mois : conv.mois, prevue = rep && nombre(rep.depense_prevue) ? +rep.depense_prevue : 0;
    const cible = mois * dep.montant + prevue;
    const dispo = Calc.matelasDisponible(d.positions, "foyer", { config: d.config, depenses: dep.montant });
    return { fo, dep, mois, convention: conv, prevue, cible, actuel: dispo.total, dispo, surplus: Math.max(0, dispo.total - cible), manque: Math.max(0, cible - dispo.total) };
  }

  /* ================================================================== questions : préremplissage, validité, manquants */
  /** Poids de l'allocation cible (somme 1) : opts.allocation (en %) → config.targets → null. */
  function allocationDe(d, opts) {
    const a = opts && opts.allocation;
    if (a && typeof a === "object") {
      const t = somme(Object.values(a), x => +x || 0);
      if (t > 0) return Object.fromEntries(Object.keys(a).filter(k => +a[k] > 0).map(k => [k, +a[k] / t]));
    }
    return D.ciblesAllocation(d, "foyer");
  }
  const ESTACTIONS = k => /^actions/.test(k);
  const partActions = alloc => (alloc ? somme(Object.keys(alloc).filter(ESTACTIONS), k => alloc[k]) : 0);

  /** Objectifs à venir, du plus proche : { id, date, mois }. */
  function objectifsAVenir(d, today) {
    return liste(d.objectifs).map(o => ({ o, date: o && (o.dateCible || o.date_cible) })).filter(x => x.date && O.estDate(x.date) && x.date > today)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  const anneesEntre = (today, date) => Math.max(1, Math.round(O.moisEntre(today, date) / 12));

  /** Préremplissage des questions depuis les données de Boussole (§ 9.4) : { id: valeur } pour celles qu'on sait remplir. */
  function preremplir(entree, data, today, opts) {
    const d = Object.assign({}, data, { today }), fo = foyer(d, today), L = lecteur(d), out = {};
    const alloc = allocationDe(d, opts), cap = capaciteDe(d), suivi = L.v("suivi_horizon_suppose_ans");
    const prochain = objectifsAVenir(d, today)[0];
    const val = {
      zero: () => 0,
      capacite: () => (cap > 0 ? Math.round(cap) : undefined),
      capacite_x_part_actions: () => (cap > 0 && alloc && partActions(alloc) > 0 ? Math.round(cap * partActions(alloc)) : undefined),
      horizon_objectif: () => (prochain ? anneesEntre(today, prochain.date) : suivi),
      horizon_objectif_actions: () => (prochain ? anneesEntre(today, prochain.date) : suivi),
      destination_actions: () => "compte_titres",
      tmi: () => { const t = tmiDe(d); return t == null ? undefined : t; },
      objectif_rp: () => false,
      statut_risque: () => (objet(objet(d.risque).reponses).revenus === "independant" ? "independant" : "salarie"),
      mois_convention: () => moisConvention(d, fo, L.v).mois,
      cinq: () => 5,
      compte_titres: () => "compte_titres",
      part_fonds_euros_cible: () => (alloc ? Math.round((alloc.fonds_euros || 0) * 100) : undefined),
      maintenant: () => "maintenant",
      non: () => false,
      oui: () => true,
      vingt: () => 20,
      regime_lmnp_reel: () => "lmnp_reel",
      repere_vacance: () => L.v("scn_locatif_vacance_mois"),
      repere_taux_credit_20: () => L.v("taux_credit_immo_20"),
      repere_frais_souscription_scpi: () => L.v("scn_scpi_frais_souscription_pct"),
      repere_distribution_scpi: () => L.v("scpi_taux_distribution"),
      repere_prix_part_scpi: () => { const t = L.v("rendement_central_immobilier"), dd = L.v("scpi_taux_distribution"); return t === undefined || dd === undefined ? undefined : Math.round((t - dd) * 100) / 100; },
      frais_av_renseignes: () => { const f = fraisDe(d, opts, null); return f.inconnus.includes("assurance_vie_pct") ? undefined : f.assurance_vie_pct; },
    };
    liste(entree.questions).forEach(q => { if (q.prerempli && val[q.prerempli]) { const v = val[q.prerempli](); if (v !== undefined && v !== null) out[q.id] = v; } });
    return out;
  }

  /** Contrôle strict des réponses d'après les questions du catalogue : clé inconnue, type, borne, option, texte libre. → null si tout va bien, sinon la liste des messages. */
  function reponsesValides(entree, reponses) {
    const qs = Object.fromEntries(liste(entree.questions).map(q => [q.id, q])), r = objet(reponses), msgs = [];
    Object.keys(r).forEach(k => {
      const q = qs[k], v = r[k];
      if (!q) { msgs.push("« " + k + " » n'est pas une question de ce scénario"); return; }
      if (v === null || v === undefined) return;
      const hors = () => msgs.push("« " + k + " » : valeur hors des bornes");
      switch (q.type) {
        case "montant_eur": case "entier": case "pourcentage":
          if (typeof v !== "number" || !isFinite(v)) { msgs.push("« " + k + " » doit être un nombre"); break; }
          if (q.type === "entier" && !Number.isFinite(v)) { msgs.push("« " + k + " » doit être un nombre"); break; }
          if ((q.min != null && v < q.min) || (q.max != null && v > q.max)) hors();
          break;
        case "booleen": if (typeof v !== "boolean") msgs.push("« " + k + " » doit être oui ou non"); break;
        case "date": if (typeof v !== "string" || !O.estDate(v)) msgs.push("« " + k + " » doit être une date AAAA-MM-JJ"); break;
        case "choix": if (!liste(q.options).some(o => o === v)) msgs.push("« " + k + " » : choix inconnu"); break;
        default: msgs.push("« " + k + " » : type de question inconnu");
      }
    });
    return msgs.length ? msgs : null;
  }

  /* ================================================================== tirages (mêmes nombres aléatoires que le moteur) */
  let cacheTirages = null;
  /** Normales corrélées par classe, mises en cache : même (chemins, graine) → mêmes tirages, étendus si besoin (le préfixe de mois est identique). */
  function tirer(P, T, graine, classes) {
    const c = cacheTirages, memeChemins = c && c.P === P && c.graine === graine;
    if (memeChemins && c.T >= T && classes.every(k => c.z[k])) return c;
    const T2 = Math.max(T, memeChemins ? c.T : 0), cl = [...new Set(classes.concat(memeChemins && c.T >= T2 ? Object.keys(c.z) : []))];
    cacheTirages = { P, graine, T: T2, z: Proj.tirages({ chemins: P, mois: T2, graine, classes: cl }) };
    return cacheTirages;
  }
  const quantile = (a, p) => O.centile(Array.from(a), p);
  const bande = a => { const t = Float64Array.from(a).sort(); return { p10: O.centileTrie(t, 0.1), p50: O.centileTrie(t, 0.5), p90: O.centileTrie(t, 0.9) }; };
  const bandeR = (a, f) => { const b = bande(a), g = f || (x => x); return { p10: r2(g(b.p10)), p50: r2(g(b.p50)), p90: r2(g(b.p90)) }; };

  /* ================================================================== le socle : simulerEnveloppes (§ 6.2) */
  const LIVRETS = F.LIVRETS.concat(["courant"]);
  const REPERE_LIVRET = { livret_a: "livret_a_taux", ldds: "livret_a_taux", lep: "lep_taux" };

  /** Versement brut mensuel du PER à effort net égal : v = m / (1 − TMI) tant que tout est déductible, sinon m + TMI × plafond / 12 (seul le plafond est déduit).
      → { v, deduit } par mois. plafond null ou undefined : aucun plafond. */
  function versementPer(effort, tmiPct, plafondAnnuel) {
    const t = tmiPct / 100;
    const v = effort / (1 - t);
    if (plafondAnnuel == null || 12 * v <= plafondAnnuel + EPS) return { v, deduit: v };
    return { v: effort + t * plafondAnnuel / 12, deduit: plafondAnnuel / 12 };
  }

  /** Simule des enveloppes pour chaque option d'un plan de flux, chemin par chemin, sur les tirages du moteur (§ 6.2). Retourne :
      { P, T, Tmax, graine, deterministe, today, options: { id: { net (€ d'aujourd'hui), courants, brut, impots, base, deduits } }, netA(id, t, sur) → sorties au mois t,
        ecart(a, b, t?), bascule(a, b), reperes, indisponible? }.
      plan = { T, couple, options: { id: [enveloppe] }, comparer?, reference?, v_min? } ; enveloppe = { type, ouverture_t, date_ouverture?, poches: [{ classe, part, frais_pct }],
      flux: [{ de, a, montant | effort_net, deduit? }], tmi_pct?, tmi_retraite_pct?, plafond_annuel?, plafond_premiere_annee? } ; un flux versé au mois t l'est en fin de mois t
      (t = 0 : aujourd'hui) ; un flux qui court jusqu'à T se prolonge jusqu'à opts.horizon_max (courbe selon la date de retrait). */
  function simulerEnveloppes(data, plan, opts) {
    const o = opts || {}, d = data || {}, today = d.today;
    const det = o.volatilite === 0, P = det ? 1 : Math.max(1, Math.round(o.chemins || 2000));
    const T = plan.T, Tmax = Math.max(T, Math.round(o.horizon_max || T)), graine = o.graine == null ? Proj.GRAINE : o.graine;
    const ctx = D.contexte(d, { hypotheses_classes: o.hypotheses_classes }), pi = ctx.pi, date = t => O.ajouterMois(today, t);
    const defl = t => Math.pow(1 + pi, t / 12);
    const ids = Object.keys(plan.options), manquants = new Set(), mentions = [], avApres = { vu: false };
    const paramsClasse = {}, pc = k => (paramsClasse[k] || (paramsClasse[k] = D.parametresClasse(k, ctx)));
    const classes = new Set();
    ids.forEach(id => plan.options[id].forEach(e => liste(e.poches).forEach(p => { if (!LIVRETS.includes(e.type) && p.classe) classes.add(p.classe); })));
    const Z = det ? null : tirer(P, Tmax, graine, [...classes].filter(k => D.IDX[k] != null));
    const W = Tmax + 1;
    const envs = [], parOption = {};
    ids.forEach(id => {
      parOption[id] = plan.options[id].map(e => {
        /* flux mensuels de l'enveloppe (versements bruts) et part déductible (PER) */
        const m = new Float64Array(W), ded = new Float64Array(W);
        liste(e.flux).forEach(s => {
          const a = s.a >= T ? Tmax : s.a;
          for (let t = Math.max(0, s.de); t <= Math.min(a, Tmax); t++) {
            if (s.effort_net != null) {
              const cap = e.plafond_premiere_annee != null && t < s.de + 12 ? e.plafond_premiere_annee : e.plafond_annuel;
              const x = versementPer(s.effort_net, e.tmi_pct || 0, cap);
              m[t] += x.v; ded[t] += x.deduit;
            } else { m[t] += s.montant; ded[t] += s.deduit != null ? s.deduit : (e.type === "per" ? s.montant : 0); }
          }
        });
        const base = new Float64Array(W), dedCum = new Float64Array(W);
        for (let t = 0; t < W; t++) { base[t] = (t ? base[t - 1] : 0) + m[t]; dedCum[t] = (t ? dedCum[t - 1] : 0) + ded[t]; }
        const dateOuv = e.date_ouverture !== undefined ? e.date_ouverture : date(e.ouverture_t || 0);
        /* règle fiscale (une fois par enveloppe) */
        const primes = e.type && F.AV.includes(e.type) ? base[T] + (e.primes_existantes || 0) : undefined;
        const fiscal = { type: e.type, valeur: 0, base: base[T], classe: "actions", date_ouverture: dateOuv, versements_deduits: e.type === "per" ? dedCum[T] : undefined };
        const ctxF = { reperes: d.reperes, couple: !!plan.couple, primes_titulaire: primes, tmi_pct: e.type === "per" ? e.tmi_retraite_pct : e.tmi_pct };
        const prep = F.preparer(fiscal, ctxF);
        if (prep.indisponible) prep.reperes.manquants.forEach(k => manquants.add(k));
        /* mentions de la règle fiscale (date d'ouverture inconnue : règle d'avant 5 ou 8 ans appliquée) : rendues au résultat, jamais tues */
        prep.mentions.filter(t => !/^bloqué/.test(t)).forEach(t => { if (!mentions.some(x => x.texte === t && x.type === e.type)) mentions.push({ type: e.type, libelle: e.libelle || null, texte: t }); });
        /* croissance des poches */
        const E = new Float64Array(P * W), fraisT = new Float64Array(P);
        if (LIVRETS.includes(e.type)) {
          const cle = REPERE_LIVRET[e.type], r = cle ? ctx.R[cle] : null, central = pc("monetaire"), ac = Math.log(1 + central.rendement / 100) / 12;
          const ar = r ? Math.log(1 + +r.valeur / 100) / 12 : e.type === "courant" ? 0 : ac, fin = r && r.dateFin;
          if (r) ctx.rv(cle);
          const g = new Float64Array(W);
          for (let t = 1; t < W; t++) g[t] = Math.exp(!fin || date(t) <= fin ? ar : ac);
          for (let i = 0; i < P; i++) { let v = m[0]; E[i * W] = v; for (let t = 1; t < W; t++) { v = v * g[t] + m[t]; E[i * W + t] = v; } }
        } else {
          liste(e.poches).forEach(p => {
            const par = pc(p.classe), a = Math.log(1 + par.rendement / 100) / 12, s = det ? 0 : par.volatilite / 100 / Math.sqrt(12);
            const feeM = Math.pow(1 - (p.frais_pct || 0) / 100, 1 / 12), z = s > 0 && Z ? Z.z[p.classe] : null, Tz = Z ? Z.T : 0;
            for (let i = 0; i < P; i++) {
              let v = p.part * m[0]; E[i * W] += v;
              for (let t = 1; t < W; t++) {
                const g = z ? Math.exp(a + s * z[i * Tz + (t - 1)]) : Math.exp(a);
                const av = v * g;
                v = av * feeM + p.part * m[t]; E[i * W + t] += v;
                if (t <= T) fraisT[i] += av * (1 - feeM);
              }
            }
          });
        }
        const env = { e, type: e.type, E, fraisT, base, dedCum, prep, dateOuv, ouv_t: e.ouverture_t || 0, ctxF, preps: new Map() };
        envs.push(env);
        return env;
      });
    });
    if (manquants.size) return { indisponible: true, reperes_manquants: [...manquants], P, T, Tmax, graine, deterministe: det };
    /* sorties d'une option à un mois de sortie t (t ≥ ouverture) ; `sur` = { tmi_per } remplace la TMI de retraite du PER */
    function netA(id, t, sur) {
      const courants = new Float64Array(P), brut = new Float64Array(P), impots = new Float64Array(P), ps = new Float64Array(P);
      const dt = date(t);
      parOption[id].forEach(env => {
        let prep = env.prep;
        if (sur && sur.tmi_per != null && env.type === "per") {
          if (!env.preps.has(sur.tmi_per)) env.preps.set(sur.tmi_per, F.preparer({ type: "per", valeur: 0, base: env.base[T], classe: "actions", date_ouverture: env.dateOuv, versements_deduits: env.dedCum[T] },
            Object.assign({}, env.ctxF, { tmi_pct: sur.tmi_per })));
          prep = env.preps.get(sur.tmi_per);
        }
        const b = env.base[t];
        for (let i = 0; i < P; i++) {
          const v = env.E[i * W + t], x = prep.calculer(v, b, dt, undefined);
          if (x.apres && x.abat_utilise > 0 && t === T) avApres.vu = true;
          brut[i] += v; impots[i] += x.ir + x.ps; ps[i] += x.ps; courants[i] += v - x.ir - x.ps;
        }
      });
      const f = 1 / defl(t), auj = new Float64Array(P);
      for (let i = 0; i < P; i++) auj[i] = courants[i] * f;
      const frais = new Float64Array(P);
      parOption[id].forEach(env => { for (let i = 0; i < P; i++) frais[i] += env.fraisT[i]; });
      return { courants, net: auj, brut, impots, ps, frais, base: somme(parOption[id], env => env.base[t]), deduits: somme(parOption[id], env => env.dedCum[t]), t };
    }
    const options = {};
    ids.forEach(id => { options[id] = netA(id, T); });
    const ecart = (a, b, t) => {
      const A = t == null ? options[a] : netA(a, t), B = t == null ? options[b] : netA(b, t), dl = new Float64Array(P), dc = new Float64Array(P);
      let mieux = 0;
      for (let i = 0; i < P; i++) { dl[i] = A.net[i] - B.net[i]; dc[i] = A.courants[i] - B.courants[i]; if (dl[i] > 1e-7) mieux++; }
      return { delta: dl, courants: dc, p10: quantile(dl, 0.1), p50: quantile(dl, 0.5), p90: quantile(dl, 0.9), probabilite_mieux: mieux / P };
    };
    /* date de bascule : premier mois de sortie à partir duquel l'écart médian reste > 0 jusqu'à T (grille mensuelle) */
    const bascule = (a, b) => {
      let premier = null;
      for (let t = T; t >= 1; t--) {
        if (t < Math.max(...parOption[a].concat(parOption[b]).map(env => env.ouv_t))) break;
        const m = quantile(ecart(a, b, t).courants, 0.5);
        if (m > 1e-6) premier = t; else break;
      }
      return premier == null ? null : { t: premier, date: date(premier) };
    };
    /* le petit versement de « prendre date » : même enveloppe que la première option comparée, compté à part */
    let v_min = null;
    if (plan.v_min && plan.comparer) {
      const env0 = parOption[plan.comparer[0]][0], vm = plan.v_min, tt = vm.t || 1;
      const poches = (env0.e.poches || []), brut = new Float64Array(P), sansFrais = new Float64Array(P), net = new Float64Array(P);
      poches.forEach(p => {
        const par = pc(p.classe), a = Math.log(1 + par.rendement / 100) / 12, s = det ? 0 : par.volatilite / 100 / Math.sqrt(12);
        const feeM = Math.pow(1 - (p.frais_pct || 0) / 100, 1 / 12), z = s > 0 && Z ? Z.z[p.classe] : null, Tz = Z ? Z.T : 0;
        for (let i = 0; i < P; i++) {
          let v = p.part * vm.montant, w = v;
          for (let t = tt + 1; t <= T; t++) { const g = z ? Math.exp(a + s * z[i * Tz + (t - 1)]) : Math.exp(a); v *= g * feeM; w *= g; }
          brut[i] += v; sansFrais[i] += w;
        }
      });
      const prep = F.preparer({ type: env0.type, valeur: 0, base: vm.montant, classe: "actions", date_ouverture: env0.dateOuv }, { reperes: d.reperes, couple: !!plan.couple });
      for (let i = 0; i < P; i++) { const x = prep.calculer(brut[i], vm.montant, date(T), undefined); net[i] = brut[i] - x.ir - x.ps; }
      v_min = { brut, net, frais: sansFrais.map((w, i) => w - brut[i]) };
    }
    return { P, T, Tmax, graine, deterministe: det, today, options, netA, ecart, bascule, v_min, date, defl, envs, parOption, reperes: ctx.utilises, ctx, mentions, abattement_av_utilise: avApres.vu };
  }

  /** Cherche x dans [lo, hi] tel que f(x) = 0, f décroissante, par dichotomie (12 itérations au plus). → { x, etat: "ok" | "aucun" (f(lo) ≤ 0) | "au_dela" (f(hi) > 0) }. */
  function seuilDichotomie(f, lo, hi, n) {
    if (!(f(lo) > 0)) return { x: null, etat: "aucun" };
    if (f(hi) > 0) return { x: null, etat: "au_dela" };
    let a = lo, b = hi;
    for (let k = 0; k < (n || 12); k++) { const m = (a + b) / 2; if (f(m) > 0) a = m; else b = m; }
    return { x: (a + b) / 2, etat: "ok" };
  }

  /* ================================================================== textes et formats */
  const eur0 = x => O.eur(Math.round(x / 10) * 10);          // arrondi à la dizaine d'euros pour l'affichage
  const dateFr = iso => Calendrier.dateFr(iso);
  /** « que » élidé devant une voyelle : « qu'un compte-titres », « que ton assurance-vie ». */
  const que = t => (/^[aeiouyéèêh]/i.test(t) ? "qu'" : "que ") + t;
  const ans = h => (Math.abs(h - Math.round(h)) < 0.05 ? String(Math.round(h)) : O.frc(h, 1)) + (Math.round(h) > 1 || h >= 2 ? " ans" : " an");

  /* ================================================================== frais (hypothèses dites) */
  /** Frais annuels par enveloppe, en % : opts.frais d'abord, puis les frais renseignés (config.frais_enveloppes), sinon 0 — dit dans les avertissements. */
  function fraisDe(d, opts, rep) {
    const o = objet(opts && opts.frais), cfg = objet(objet(d.config).frais_enveloppes), inconnus = [];
    const parType = (types, cle) => { const e = Object.keys(cfg).find(k => types.includes(objet(objet(objet(d.config).enveloppes_infos)[k]).type || Calendrier.typeDeduit(k))); return e && cfg[e][cle] != null ? +cfg[e][cle] : undefined; };
    const lu = (cle, repli) => { if (o[cle] != null) return +o[cle]; if (repli !== undefined) return repli; inconnus.push(cle); return 0; };
    const ter = o.ter_pct != null ? +o.ter_pct : (inconnus.push("ter_pct"), 0);
    return {
      ter_pct: ter,
      pea_pct: rep && nombre(rep.frais_pea_pct) ? +rep.frais_pea_pct : lu("pea_pct", parType(TYPES_PEA, "garde_pct")),
      compte_titres_pct: lu("compte_titres_pct", parType(["compte_titres"], "garde_pct")),
      assurance_vie_pct: rep && nombre(rep.frais_contrat_pct) ? +rep.frais_contrat_pct : lu("assurance_vie_pct", parType(TYPES_AV, "gestion_uc_pct")),
      fonds_euros_pct: rep && nombre(rep.frais_contrat_pct) ? +rep.frais_contrat_pct : lu("fonds_euros_pct", parType(TYPES_AV, "gestion_euro_pct")),
      per_pct: lu("per_pct", parType(["per"], "gestion_uc_pct")),
      inconnus: [...new Set(inconnus)],
    };
  }
  /** Poches d'une enveloppe selon l'allocation : fonds euros = frais de gestion du contrat seulement (pas de TER), autres classes = TER + frais d'enveloppe. */
  function poches(alloc, frais, fraisEnveloppe, fraisEuro) {
    return Object.keys(alloc).map(k => ({ classe: k, part: alloc[k], frais_pct: k === "fonds_euros" ? fraisEuro : frais.ter_pct + fraisEnveloppe }));
  }
  /** Répartit des flux mensuels entre une enveloppe plafonnée et son débordement : le versement qui dépasse le plafond (cumul) va au débordement. → { dedans, debordement, plafond_atteint_t }. */
  function repartirPlafond(flux, plafond) {
    const dedans = [], deborde = [];
    let cumul = 0, atteint = null;
    flux.forEach(s => {
      for (let t = s.de; t <= s.a; t++) {
        const libre = Math.max(0, plafond - cumul), vers = Math.min(libre, s.montant), reste = s.montant - vers;
        cumul += vers;
        if (vers > 0) dedans.push({ de: t, a: t, montant: vers });
        if (reste > EPS) deborde.push({ de: t, a: t, montant: reste });
        if (atteint == null && plafond - cumul <= EPS) atteint = t;
      }
    });
    const fusion = l => l.reduce((out, s) => { const p = out[out.length - 1]; if (p && p.a + 1 === s.de && Math.abs(p.montant - s.montant) < 1e-9) p.a = s.a; else out.push({ de: s.de, a: s.a, montant: s.montant }); return out; }, []);
    return { dedans: fusion(dedans), debordement: fusion(deborde), plafond_atteint_t: atteint, verse_dedans: cumul };
  }
  /** Flux d'un versement de départ et d'un versement mensuel : le tout au mois 1, puis le mensuel jusqu'au mois T. */
  function fluxDepart(V0, m, de, T) {
    const out = [];
    if (de > T) return out;
    if (V0 > 0) { out.push({ de, a: de, montant: V0 + m }); if (de + 1 <= T) out.push({ de: de + 1, a: T, montant: m }); }
    else out.push({ de, a: T, montant: m });
    return out.filter(s => s.montant > 0);
  }


  /* ================================================================== sorties communes */
  const ecartBandes = e => ({ p10: r2(e.p10), p50: r2(e.p50), p90: r2(e.p90) });
  const parAn = (b, H) => ({ p10: r2(b.p10 / H), p50: r2(b.p50 / H), p90: r2(b.p90 / H) });
  /** Option du résultat (§ 6.7) à partir des sorties du socle pour un mois de sortie. */
  function sortieOption(id, libelle, types, x, extras) {
    return Object.assign({ id, libelle, enveloppes: types, net: bandeR(x.net), verse: r2(x.base), brut_p50: r2(quantile(x.brut, 0.5)), impots_p50: r2(quantile(x.impots, 0.5)),
      prelevements_sociaux_p50: r2(quantile(x.ps, 0.5)), net_courants_p50: r2(quantile(x.courants, 0.5)), frais_p50: r2(quantile(x.frais, 0.5)), disponible: true, contraintes: [], exclue: null }, extras || {});
  }
  const optionExclue = (id, libelle, types, code, texte) => ({ id, libelle, enveloppes: types, net: null, verse: null, brut_p50: null, impots_p50: null, prelevements_sociaux_p50: null,
    net_courants_p50: null, frais_p50: null, disponible: false, contraintes: [texte], exclue: code });
  const ligne = (hypothese, valeur_retenue, seuil, effet, phrase) => ({ hypothese, valeur_retenue, seuil, effet, phrase });
  /** Date de sortie (mois t) d'après la date d'aujourd'hui. */
  const dateDe = (today, t) => O.ajouterMois(today, t);
  const seuilAnnees = (ouverture, n) => O.ajouterJours(O.ajouterAns(ouverture, n), 1);        // règle DAT1 : le lendemain de l'anniversaire

  /** Destination actuelle des versements (point de comparaison) : { type, libelle, frais_pct, ouverture_t, date_ouverture? }. */
  function referenceDe(destination, frais, fo) {
    const ter = frais.ter_pct;
    if (destination === "assurance_vie") {
      const dates = fo.enveloppes.filter(e => TYPES_AV.includes(e.type) && e.infos && O.estDate(e.infos.date_ouverture)).map(e => e.infos.date_ouverture).sort();
      return { type: "assurance_vie", libelle: "ton assurance-vie", frais_pct: ter + frais.assurance_vie_pct, ouverture_t: 0, date_ouverture: dates[0] || null };
    }
    if (destination === "livret") return { type: "livret_a", libelle: "un livret", frais_pct: 0, ouverture_t: 0 };
    if (destination === "courant") return { type: "courant", libelle: "ton compte courant", frais_pct: 0, ouverture_t: 0 };
    return { type: "compte_titres", libelle: "un compte-titres", frais_pct: ter + frais.compte_titres_pct, ouverture_t: 0 };
  }
  const envReference = (ref, flux) => {
    const e = { type: ref.type, libelle: ref.libelle, ouverture_t: ref.ouverture_t, poches: [{ classe: LIVRETS.includes(ref.type) ? "monetaire" : "actions", part: 1, frais_pct: ref.frais_pct }], flux };
    if (ref.date_ouverture !== undefined) e.date_ouverture = ref.date_ouverture;
    return e;
  };
  const simOptsDe = o => ({ chemins: o.chemins, graine: o.graine, volatilite: o.volatilite, hypotheses_classes: o.hypotheses_classes });
  const LIB_FRAIS = { ter_pct: "frais des fonds", pea_pct: "frais du PEA", compte_titres_pct: "frais du compte-titres", assurance_vie_pct: "frais de l'assurance-vie",
    fonds_euros_pct: "frais du fonds euros", per_pct: "frais du PER" };
  /** Phrase d'avertissement quand des frais du scénario (cles) ne sont pas renseignés : ils sont comptés à 0 %, et c'est dit, y compris quand cela avantage une option. */
  function avertFrais(f, cles) {
    const pert = cles || Object.keys(LIB_FRAIS), inc = pert.filter(k => f.inconnus.includes(k));
    if (!inc.length) return [];
    const noms = inc.map(k => LIB_FRAIS[k]).join(", "), incEnv = inc.filter(k => k !== "ter_pct"), connus = pert.filter(k => k !== "ter_pct" && !inc.includes(k));
    return [incEnv.length && connus.length
      ? "Frais non renseignés (" + noms + ") : comptés à 0 %, ce qui avantage ces enveloppes face à celles dont tu as donné les frais ; renseigne-les pour un chiffre complet."
      : "Frais non renseignés (" + noms + ") : comptés à 0 % pour toutes les options" + (incEnv.length ? ", la comparaison est alors seulement fiscale" : "") + " ; renseigne-les pour un chiffre complet."];
  }
  const cleFraisDe = type => (type === "compte_titres" ? "compte_titres_pct" : TYPES_AV.includes(type) ? "assurance_vie_pct" : TYPES_PEA.includes(type) ? "pea_pct" : type === "per" ? "per_pct" : null);


  /* ================================================================== variante retenue : hypothèse enveloppe_scenario (§ 6.6) */
  /** Allocation en pourcentages arrondis à 0,01 dont la somme fait exactement 100. */
  function allocationPct(alloc) {
    const ks = Object.keys(alloc).filter(k => alloc[k] > 0), t = somme(ks, k => alloc[k]);
    const out = Object.fromEntries(ks.map(k => [k, Math.round(alloc[k] / t * 10000) / 100]));
    const ecart = Math.round((100 - somme(ks, k => out[k])) * 100) / 100;
    if (ks.length && ecart) { const g = ks.slice().sort((a, b) => out[b] - out[a])[0]; out[g] = Math.round((out[g] + ecart) * 100) / 100; }
    return out;
  }
  /** Hypothèse enveloppe_scenario d'une option retenable (le moteur la rejoue : Projection, proj-1.3.0). p = { type, ouverture, allocation (poids), fraisEnveloppe, initial, mensuel, debut,
      plafond, debordement, per, transferts, titulaire }. */
  function hypotheseEnveloppe(c, p) {
    const livret = F.LIVRETS.includes(p.type), es = { scenario: c.entree.cle, version_calcul: c.entree.version_calcul || VERSION_CALCUL, type: p.type, titulaire: p.titulaire === "p2" ? "p2" : "p1", ouverture: p.ouverture };
    if (!livret) es.allocation = allocationPct(p.allocation);
    es.ter_pct = r2(c.frais.ter_pct); es.frais_enveloppe_pct = r2(p.fraisEnveloppe || 0);
    if (p.initial > 0) es.initial = { montant: r2(p.initial), depuis: "disponible" };
    if (p.mensuel > 0) es.mensuel = { montant: r2(p.mensuel), depuis: "capacite" };
    if (p.debut) es.debut = p.debut;
    if (p.plafond != null) { es.plafond_versements = r2(p.plafond); if (p.type !== "per") es.debordement = p.debordement || "compte_titres"; }
    if (p.per) es.per = p.per;
    if (p.transferts && p.transferts.length) es.transferts = p.transferts.map(x => ({ de: x.de, montant: r2(x.montant) }));
    const msg = E.validerEnveloppeScenario(es);
    return msg ? { erreur: msg } : { hypothese: es };
  }
  const NON_RETENABLE_REFERENCE = "C'est ce que tu fais déjà : il n'y a rien à retenir.";
  const NON_RETENABLE_MULTI = "Cette option répartit ton versement entre plusieurs enveloppes : une variante n'en porte qu'une pour l'instant.";

  /* ================================================================== n° 1 : faut-il ouvrir un PEA ? (§ 7.1) */
  function ouvrirPea(c) {
    const { d, today, rep, L, o, fo } = c;
    const T = Math.max(1, Math.round(rep.horizon_ans * 12)), H = T / 12, delai = L.v("scn_delai_ouverture_mois"), plafond = L.v("pea_plafond"), duree = L.v("pea_duree_ans");
    const frais = c.frais, ter = frais.ter_pct, V0 = +rep.versement_initial || 0, m = +rep.versement_mensuel || 0, fPea = ter + frais.pea_pct;
    const ref = referenceDe(rep.destination_actuelle || "compte_titres", frais, fo), pre = simOptsDe(o), plusTard = rep.debut === "plus_tard";
    const peaEnv = (ouv, flux, fp) => ({ type: "pea", ouverture_t: ouv, poches: [{ classe: "actions", part: 1, frais_pct: fp }], flux });
    const avert = avertFrais(frais, ["ter_pct", "pea_pct"].concat(plusTard ? [] : [cleFraisDe(ref.type)].filter(Boolean))), ctq = [];
    if (detient(fo, c.titulaire, TYPES_PEA)) avert.push("Tu as déjà un PEA, et on ne peut en avoir qu'un : ce calcul compare un PEA neuf, pour information seulement.");
    let plan, tete, refId, libTete, libRef, P0 = null, Tmax = T;
    if (!plusTard) {
      const flux = fluxDepart(V0, m, delai, T), rp = repartirPlafond(flux, plafond);
      const A = [peaEnv(delai, rp.dedans, fPea)];
      if (rp.debordement.length) A.push({ type: "compte_titres", ouverture_t: 0, poches: [{ classe: "actions", part: 1, frais_pct: ter + frais.compte_titres_pct }], flux: rp.debordement });
      plan = { T, couple: fo.couple, options: { A, R: [envReference(ref, flux)] }, comparer: ["A", "R"], reference: "R", plafond_pea: plafond };
      tete = "A"; refId = "R"; libTete = "PEA ouvert dans " + delai + " mois"; libRef = ref.libelle;
      if (rp.debordement.length) avert.push("Ton PEA atteint son plafond de " + O.eur(plafond) + " de versements : le surplus est placé en compte-titres, dans le calcul.");
    } else {
      P0 = Math.max(delai, O.moisEntre(today, rep.debut_date));
      const flux = [{ de: P0, a: T, montant: m }];
      Tmax = Math.max(T, P0 + duree * 12 + 12);
      plan = { T, couple: fo.couple, options: { A_prime: [peaEnv(delai, flux, fPea)], C: [peaEnv(P0, flux, fPea)] }, comparer: ["A_prime", "C"], reference: "C", v_min: { montant: V0, t: delai } };
      tete = "A_prime"; refId = "C"; libTete = "PEA ouvert maintenant avec un petit versement"; libRef = "PEA ouvert au début des versements";
    }
    const sim = simulerEnveloppes(d, plan, Object.assign({ horizon_max: Tmax }, pre));
    if (sim.indisponible) return { statut: "indisponible", reperes_manquants: sim.reperes_manquants };
    const e = sim.ecart(tete, refId), dateOuv = dateDe(today, delai), seuil5 = seuilAnnees(dateOuv, duree), enjeu = parAn(e, H);
    const opts = Object.keys(plan.options).map(id => sortieOption(id, id === tete ? libTete : libRef, plan.options[id].map(x => x.type), sim.options[id], { versements_pea: id === tete ? r2(somme(plan.options[id].filter(x => x.type === "pea"), x => somme(x.flux, s => s.montant * (s.a - s.de + 1)))) : undefined }));
    let bascule = null, seuilFrais = null, courbe = null, fenetre = null, anteriorite = null, vmin = null;
    if (!plusTard) {
      const b = sim.bascule(tete, refId); bascule = b && b.date;
      seuilFrais = seuilDichotomie(x => {
        const A2 = plan.options.A.map(env => (env.type === "pea" ? Object.assign({}, env, { poches: [{ classe: "actions", part: 1, frais_pct: ter + x }] }) : env));
        const s2 = simulerEnveloppes(d, { T, couple: fo.couple, options: { A: A2 } }, pre), n2 = s2.options.A.courants, nr = sim.options[refId].courants;
        return quantile(Array.from(n2, (v, i) => v - nr[i]), 0.5);
      }, 0, 2, 12);
      ctq.push(ligne("pea_5_ans", dateFr(dateDe(today, T)), dateFr(seuil5), "Avant cette date, le PEA ne te rapporte rien de plus",
        "Si tu as besoin de cet argent avant le " + dateFr(seuil5) + ", le PEA ne t'apporte rien : avant 5 ans, un retrait le clôture et le gain est imposé comme sur un compte-titres."));
      if (seuilFrais.etat === "ok") ctq.push(ligne("frais_pea", O.frc(fPea - ter, 2) + " %", O.frc(seuilFrais.x, 2) + " %", "Au-delà, le PEA passe derrière " + libRef,
        "Si les frais annuels du PEA dépassent " + O.frc(seuilFrais.x, 2) + " % (en plus des frais des fonds), il passe derrière " + libRef + "."));
    } else {
      const ecartsT = []; let premier = null, dernier = null;
      for (let t = delai; t <= Tmax; t++) {
        const x = sim.ecart(tete, refId, t), b = bandeR(x.delta);
        ecartsT.push({ t, date: sim.date(t), p10: b.p10, p50: b.p50, p90: b.p90, courants_p50: r2(quantile(x.courants, 0.5)) });
        if (quantile(x.courants, 0.5) > 1e-6) { if (premier == null) premier = sim.date(t); dernier = sim.date(t); }
      }
      courbe = { abscisse: "date_sortie", points: ecartsT }; fenetre = premier ? { du: premier, au: dernier } : null;
      anteriorite = { courants: r2(quantile(e.courants, 0.5)), auj: r2(e.p50) };
      if (sim.v_min) vmin = { brut: r2(quantile(sim.v_min.brut, 0.5)), net: r2(quantile(sim.v_min.net, 0.5)), frais: r2(quantile(sim.v_min.frais, 0.5)) };
      ctq.push(ligne("pea_5_ans", dateFr(dateDe(today, P0)), dateFr(seuil5), "L'avance prise compte pour une sortie entre deux dates",
        "Ouvrir maintenant ne compte que si tu retires entre le " + dateFr(fenetre ? fenetre.du : seuil5) + " et le " + dateFr(fenetre ? fenetre.au : seuil5) + " : avant, aucun écart ; après, les deux PEA ont plus de 5 ans."));
    }
    ctq.push(ligne("titres_eligibles", "non calculé", null, "Seuls certains titres sont acceptés dans un PEA",
      "Le PEA n'accepte que certains titres ; la liste des titres éligibles est fixée par la loi, et ce calcul ne la vérifie pas."));
    const enTete = Math.abs(e.p50) < 0.005 ? "egalite" : e.p50 > 0 ? tete : refId;
    const meilleur = courbe ? Math.max(0, ...courbe.points.map(x => x.p50)) : 0;
    const phrase = plusTard
      ? (fenetre ? "Ouvrir un PEA maintenant avec " + O.eur(V0) + " te ferait gagner jusqu'à environ " + eur0(meilleur) + " (en euros d'aujourd'hui) si tu retires entre le " + dateFr(fenetre.du) + " et le " + dateFr(fenetre.au) + " ; en dehors de ces dates, aucun écart."
        : "Ouvrir un PEA maintenant avec " + O.eur(V0) + " ne change rien dans cet horizon : l'avance de 5 ans ne compte pour aucune date de retrait.")
      : e.p50 > 0.005 ? "Avec " + O.eur(m) + "/mois sur " + ans(H) + ", un PEA te laisserait environ " + eur0(e.p50) + " de plus " + que(libRef) + ", en euros d'aujourd'hui."
        : dateDe(today, T) < seuil5 ? "Sur " + ans(H) + ", le PEA ne change rien par rapport à " + libRef + " : avant 5 ans, un retrait clôture le plan et le gain est imposé pareil."
          : "Sur " + ans(H) + ", un PEA ne ferait pas mieux " + que(libRef) + " avec ces hypothèses" + (e.p50 < -0.005 ? " : environ " + eur0(-e.p50) + " de moins, en euros d'aujourd'hui." : ".");
    const reponse = { phrase, option_en_tete: enTete, reference: refId, ecart: ecartBandes(e), ecart_annuel: enjeu, probabilite_mieux: p3(e.probabilite_mieux), date_bascule: bascule };
    const ecartsAnnuels = [];
    if (!plusTard) for (let t = 12; t <= T; t += 12) if (t >= delai) ecartsAnnuels.push({ t, date: sim.date(t), p50_courants: r2(quantile(sim.ecart(tete, refId, t).courants, 0.5)) });
    return {
      options: opts, reponse, courbe: courbe || undefined, ce_qui_changerait: ctq, avertissements: avert,
      enjeu_annuel: { p10: Math.min(enjeu.p10, enjeu.p50), p50: Math.max(0, enjeu.p50), p90: Math.max(enjeu.p90, enjeu.p50) }, sim,
      detail: { T, mode: plusTard ? "plus_tard" : "maintenant", seuil_5_ans: seuil5, frais_seuil_pct: seuilFrais && seuilFrais.etat === "ok" ? r2(seuilFrais.x * 1000) / 1000 : null, frais_seuil_etat: seuilFrais ? seuilFrais.etat : null,
        ecart_courants: r2(quantile(e.courants, 0.5)), ecarts_annuels: ecartsAnnuels, anteriorite, v_min: vmin, fenetre, plafond_utilise: plan.plafond_pea && plan.options.A ? r2(somme(plan.options.A.filter(x => x.type === "pea"), x => somme(x.flux, s => s.montant * (s.a - s.de + 1)))) : null },
      plan: { tete, reference: refId, plan, titulaire: c.titulaire },
      retenables: retenablesPea(c, plusTard, tete, refId, { V0, m, delai, P0, plafond, fPea, today }),
    };
  }
  /** Options retenables du n° 1 : le PEA ouvert maintenant (ou « avec un petit versement »). */
  function retenablesPea(c, plusTard, tete, refId, x) {
    const h = hypotheseEnveloppe(c, { type: "pea", titulaire: c.titulaire, ouverture: dateDe(x.today, x.delai), allocation: { actions: 1 }, fraisEnveloppe: c.frais.pea_pct, initial: x.V0, mensuel: x.m,
      debut: plusTard ? dateDe(x.today, x.P0) : null, plafond: x.plafond, debordement: "compte_titres" });
    return { options: { [tete]: h }, non: { [refId]: plusTard ? "Cette option sert de point de comparaison : ouvrir plus tard est ce qui se passe si tu ne fais rien maintenant." : NON_RETENABLE_REFERENCE } };
  }

  /* ================================================================== PER : plafond de déduction (§ 7.3) */
  /** Imputation d'un versement sur les plafonds de l'avis (F14709) : le plafond de l'année d'abord, puis les reportés du plus ancien au plus récent.
      lignes = [{ annee, montant }] ; un plafond de l'année Y se reporte jusqu'à la fin de Y + n (n = per_report_ans depuis 2026, per_report_ans_ancien avant).
      → { imputation: { annee: montant }, perdu: { date, montant } | null, total_disponible, non_deduit }. */
  function imputerPlafondsPer(lignes, versement, anneeVersement, reports) {
    const r = reports || {}, expire = a => a + (a >= 2026 ? r.recent : r.ancien);
    const utilisables = liste(lignes).filter(l => l && nombre(l.annee) && nombre(l.montant) && (r.recent == null || r.ancien == null || expire(+l.annee) >= anneeVersement))
      .map(l => ({ annee: +l.annee, reste: +l.montant, montant: +l.montant }));
    const ordre = utilisables.slice().sort((a, b) => (a.annee === anneeVersement ? -1 : b.annee === anneeVersement ? 1 : a.annee - b.annee));
    let reste = versement; const imputation = {};
    ordre.forEach(l => { const x = Math.min(reste, l.reste); imputation[l.annee] = x; l.reste -= x; reste -= x; });
    const perdus = r.recent == null ? [] : utilisables.filter(l => expire(l.annee) === anneeVersement && l.reste > EPS);
    return { imputation, perdu: perdus.length ? { date: anneeVersement + "-12-31", montant: r2(somme(perdus, l => l.reste)) } : null,
      total_disponible: r2(somme(utilisables, l => l.montant)), non_deduit: r2(Math.max(0, reste)) };
  }
  /** Économie d'impôt d'une déduction de `versement` sur un revenu net imposable `rni` de `parts` parts : chaque tranche du barème que la déduction traverse compte à son taux
      (décote et plafonnement du quotient familial non calculés). seuils = { 11, 30, 41, 45 } : début de chaque tranche, par part. */
  function economiePer(rni, parts, versement, seuils) {
    const tr = [[0, 0], [seuils[11], 0.11], [seuils[30], 0.3], [seuils[41], 0.41], [seuils[45], 0.45]];
    const haut = rni / parts, bas = Math.max(0, rni - versement) / parts, parTranche = {};
    let eco = 0;
    for (let k = 0; k < tr.length; k++) {
      const a = tr[k][0], b = k + 1 < tr.length ? tr[k + 1][0] : Infinity, part = Math.max(0, Math.min(haut, b) - Math.max(bas, a)) * parts;
      if (part > 0) { eco += part * tr[k][1]; parTranche[Math.round(tr[k][1] * 100)] = r2(part); }
    }
    const marginal = tr.reduce((t, x) => (haut > x[0] ? x[1] : t), 0);
    return { economie: r2(eco), economie_au_taux_marginal: r2(versement * marginal), part_par_taux: parTranche, bas_de_tranche: Math.abs(eco - versement * marginal) > 0.005 };
  }
  /** Plafond de déduction du PER pour le scénario : { annuel, premiere_annee, source, personne, texte }. Réglage de test > avis d'impôt de la personne la mieux dotée > plancher (estimation). */
  function plafondPer(d, today, L, fo, o) {
    if (o.plafondPerAnnuel != null) return { annuel: +o.plafondPerAnnuel, premiere_annee: +o.plafondPerAnnuel, source: "reglage", personne: null, texte: null };
    const pl = objet(objet(objet(d.config).avis_impot).plafonds_per), an = +today.slice(0, 4), reports = { recent: L.v("per_report_ans"), ancien: L.v("per_report_ans_ancien") };
    const limite = L.v("per_age_fin_deduction");
    const cand = fo.personnes.filter(p => limite == null || p.age == null || p.age < limite).map(p => {
      const lg = liste(pl[p.id]).filter(l => l && nombre(l.annee) && nombre(l.montant));
      const utiles = lg.filter(l => reports.recent == null || reports.ancien == null || (+l.annee + (+l.annee >= 2026 ? reports.recent : reports.ancien)) >= an);
      const dernier = lg.slice().sort((a, b) => b.annee - a.annee)[0];
      return { p, annuel: dernier ? +dernier.montant : null, total: somme(utiles, l => +l.montant) };
    }).filter(x => x.annuel != null).sort((a, b) => b.annuel - a.annuel);
    if (cand.length) return { annuel: cand[0].annuel, premiere_annee: Math.max(cand[0].annuel, cand[0].total), source: "avis", personne: cand[0].p.id, texte: null };
    const plancher = L.v("per_plafond_plancher");
    return { annuel: plancher, premiere_annee: plancher, source: "estimation", personne: null,
      texte: "Estimation : ton plafond exact est sur ton avis d'impôt (au minimum " + O.eur(plancher) + " par an pour un salarié, ou 10 % de tes revenus d'activité nets de frais)." };
  }

  /* ================================================================== n° 2 : où mettre le prochain euro ? (§ 7.2) */
  /** Enveloppe déjà détenue dans le foyer d'une famille de types : la plus ancienne dont la date d'ouverture est connue, sinon la première.
      → { cle, nom, type, titulaire, date_ouverture (null si inconnue), versements (versements cumulés connus ou null) } ou null. */
  function existante(fo, types) {
    const l = fo.enveloppes.filter(e => types.includes(e.type));
    if (!l.length) return null;
    const dt = e => (e.infos && O.estDate(e.infos.date_ouverture) ? e.infos.date_ouverture : "9999-12-31");
    const x = l.slice().sort((a, b) => (dt(a) < dt(b) ? -1 : dt(a) > dt(b) ? 1 : 0))[0];
    return { cle: x.cle, nom: x.nom, type: x.type, titulaire: ["p1", "p2"].includes(x.titulaire) ? x.titulaire : null, date_ouverture: dt(x) === "9999-12-31" ? null : dt(x),
      versements: x.infos && nombre(x.infos.versements_cumules) ? +x.infos.versements_cumules : null };
  }
  /** Première lettre en minuscule, sauf un sigle (PEA, PER) : pour un libellé au milieu d'une phrase. */
  const minus = t => (/^[A-ZÉ]{2,}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
  /** Avertissements communs du PER (sortie en capital, avance de trésorerie, économie à la TMI). */
  function avertPer(tmi, tmiRet, ecartMensuel, parTranches) {
    const out = ["La sortie en capital est calculée en une fois, à ta tranche de " + tmiRet + " % : ajoutée à tes revenus de l'année, elle peut te faire passer dans une tranche plus haute ; une sortie étalée sur plusieurs années limite cet effet."];
    if (ecartMensuel > 0.5) out.push("L'économie d'impôt arrive l'année suivante, avec la régularisation de ton impôt : en attendant, tu avances environ " + O.eur(Math.round(ecartMensuel)) + " par mois ; ce décalage n'est pas compté (léger avantage au PER).");
    if (!parTranches && tmi > 0) out.push("L'économie d'impôt est comptée à ta tranche de " + tmi + " % sur tout le versement : près du bas de la tranche, elle peut être plus faible (ton revenu net imposable et ton nombre de parts permettraient de le vérifier).");
    return out;
  }
  const normaliser = (alloc, pred) => { const ks = Object.keys(alloc).filter(pred), t = somme(ks, k => alloc[k]); return { ks, t, parts: Object.fromEntries(ks.map(k => [k, t > 0 ? alloc[k] / t : 0])) }; };
  const echelle = (flux, f) => flux.map(s => Object.assign({}, s, { montant: s.montant * f }));

  function prochainEuro(c) {
    const { d, today, rep, L, o, fo } = c;
    const T = Math.max(1, Math.round(rep.horizon_ans * 12)), H = T / 12, delai = L.v("scn_delai_ouverture_mois");
    const V0 = +rep.versement_initial || 0, m = +rep.versement_mensuel || 0, frais = c.frais, ter = frais.ter_pct, avert = [], ctq = [];
    const alloc0 = allocationDe(d, o), alloc = alloc0 || { actions: 1 };
    if (!alloc0) avert.push("Aucune allocation cible renseignée : la comparaison suppose 100 % actions.");
    const dureePea = L.v("pea_duree_ans");
    /* un PEA ou une assurance-vie déjà détenus servent tels quels (un seul PEA par personne ; l'ancienneté d'un contrat compte) : leur date d'ouverture et leurs versements */
    const peaEx = existante(fo, ["pea"]), avEx = existante(fo, TYPES_AV);
    const ouvPea = peaEx ? { ouverture_t: 0, date_ouverture: peaEx.date_ouverture } : { ouverture_t: delai };
    const ouvAv = avEx ? { ouverture_t: 0, date_ouverture: avEx.date_ouverture, primes_existantes: avEx.versements || 0 } : { ouverture_t: delai };
    let plafondPea = L.v("pea_plafond");
    if (peaEx && peaEx.versements != null) plafondPea = Math.max(0, plafondPea - peaEx.versements);
    else if (peaEx) avert.push("Les versements déjà faits sur ton PEA ne sont pas connus : son plafond de " + O.eur(plafondPea) + " est supposé entier.");
    const nomAv = avEx ? "ton assurance-vie" : "assurance-vie";
    const flux = fluxDepart(V0, m, delai, T);
    const act = normaliser(alloc, ESTACTIONS), reste = normaliser(alloc, k => !ESTACTIONS(k)), peaPart = act.t, resteAv = 1 - peaPart;
    const pochesAv = (norm) => norm.ks.map(k => ({ classe: k, part: norm.parts[k], frais_pct: k === "fonds_euros" ? frais.fonds_euros_pct : ter + frais.assurance_vie_pct }));
    const pochesActions = fe => act.ks.map(k => ({ classe: k, part: act.parts[k], frais_pct: ter + fe }));
    const options = {}, libelles = {}, exclues = {};
    const tousAv = normaliser(alloc, () => true);
    /* AV seule */
    options.av = [Object.assign({ type: "assurance_vie", libelle: nomAv, poches: pochesAv(tousAv), flux }, ouvAv)]; libelles.av = avEx ? "Ton assurance-vie" : "Assurance-vie";
    /* PEA (+ AV pour ce qui n'est pas éligible) : écarté si le plan n'a pas 5 ans à la date de sortie */
    const datePea = peaEx ? peaEx.date_ouverture : dateDe(today, delai), pea5 = datePea ? seuilAnnees(datePea, dureePea) : null;
    if (peaEx && !datePea) exclues["pea+av"] = ["date_ouverture_pea_manquante", "La date d'ouverture de ton PEA n'est pas connue : sans elle, on ne sait pas s'il aura 5 ans à ta date de retrait."];
    else if (pea5 > dateDe(today, T)) exclues["pea+av"] = ["horizon_moins_5_ans", peaEx ? "Ton PEA n'aura pas 5 ans à cette date (le " + dateFr(pea5) + ") : avant, un retrait le clôture et le gain est imposé comme sur un compte-titres."
      : "Un PEA gagne à être gardé 5 ans : sous cet horizon, un retrait clôture le plan et le gain est imposé comme sur un compte-titres."];
    else if (peaPart <= 0) exclues["pea+av"] = ["aucune_action", "Ton allocation ne contient pas d'actions : le PEA n'a rien à recevoir."];
    else {
      const rp = repartirPlafond(echelle(flux, peaPart), plafondPea), env = [Object.assign({ type: "pea", libelle: peaEx ? "ton PEA" : "PEA", poches: pochesActions(frais.pea_pct), flux: rp.dedans }, ouvPea)];
      if (rp.debordement.length) {
        env.push({ type: "compte_titres", ouverture_t: 0, poches: pochesActions(frais.compte_titres_pct), flux: rp.debordement, debordement: true });
        avert.push("Le PEA atteint son plafond de versements (" + O.eur(L.v("pea_plafond")) + ") : ce qui dépasse est placé en compte-titres, dans le calcul.");
      }
      if (resteAv > EPS) env.push(Object.assign({ type: "assurance_vie", libelle: nomAv, poches: pochesAv(reste), flux: echelle(flux, resteAv) }, ouvAv));
      options["pea+av"] = env; libelles["pea+av"] = (peaEx ? "Ton PEA" : "PEA") + (resteAv > EPS ? " + " + nomAv : "");
    }
    /* PER */
    const dateRet = rep.date_retraite, tmiR = rep.tmi_retraite_pct, tmi = tmiDe(d), plafond = plafondPer(d, today, L, fo, o);
    if (rep.retrait_avant === true) exclues.per = ["retrait_avant", "Un PER est bloqué jusqu'à la retraite (sauf achat de la résidence principale) : tu as besoin de pouvoir retirer avant."];
    else if (!dateRet) { exclues.per = ["date_retraite_manquante", "Sans ta date de départ à la retraite, la sortie du PER ne peut pas être calculée."]; avert.push("Le PER n'est pas compté dans cette comparaison : il manque ta date de départ à la retraite."); }
    else if (tmi == null) { exclues.per = ["tmi_manquante", "Sans ta tranche d'imposition, l'économie d'impôt du PER ne peut pas être calculée."]; avert.push("Le PER n'est pas compté dans cette comparaison : il manque ta tranche d'imposition."); }
    else if (T < O.moisEntre(today, dateRet)) exclues.per = ["avant_retraite", "Ton horizon est avant ta retraite : l'argent d'un PER n'est pas disponible avant."];
    else {
      const tmiRet = tmiR === "ne_sait_pas" || tmiR == null ? tmi : +tmiR;
      if (tmiR === "ne_sait_pas") avert.push("Tranche d'imposition à la retraite inconnue : la tranche d'aujourd'hui (" + tmi + " %) est supposée pour le PER.");
      const fl = [{ de: delai, a: T, effort_net: m }];
      if (V0 > 0) { fl.splice(0, 1, { de: delai, a: delai, montant: V0, deduit: 0 }, { de: delai, a: T, effort_net: m }); avert.push("Le versement de départ n'est pas déduit dans le PER (hypothèse prudente)."); }
      options.per = [{ type: "per", ouverture_t: delai, poches: tousAv.ks.map(k => ({ classe: k, part: tousAv.parts[k], frais_pct: k === "fonds_euros" ? frais.per_pct : ter + frais.per_pct })), flux: fl,
        tmi_pct: tmi, tmi_retraite_pct: tmiRet, plafond_annuel: plafond.annuel, plafond_premiere_annee: plafond.premiere_annee }];
      libelles.per = "PER";
      if (plafond.texte) avert.push(plafond.texte);
      const vp = versementPer(m, tmi, plafond.annuel);
      avertPer(tmi, tmiRet, vp.v - m, false).forEach(x => avert.push(x));
    }
    /* compte-titres (référence), complété par l'assurance-vie pour la part qui n'est pas en actions */
    const refId = resteAv > EPS ? (peaPart > 0 ? "cto+av" : "av") : "cto";
    if (refId !== "av") {
      options[refId] = [{ type: "compte_titres", ouverture_t: 0, poches: pochesActions(frais.compte_titres_pct), flux: echelle(flux, peaPart) }];
      if (resteAv > EPS) options[refId].push(Object.assign({ type: "assurance_vie", libelle: nomAv, poches: pochesAv(reste), flux: echelle(flux, resteAv) }, ouvAv));
      libelles[refId] = resteAv > EPS ? "Compte-titres + " + nomAv : "Compte-titres";
    }
    const plan = { T, couple: fo.couple, options, reference: refId };
    const sim = simulerEnveloppes(d, plan, simOptsDe(o));
    if (sim.indisponible) return { statut: "indisponible", reperes_manquants: sim.reperes_manquants };
    const ids = Object.keys(options), p50 = id => quantile(sim.options[id].net, 0.5);
    const classement = ids.slice().sort((a, b) => p50(b) - p50(a) || (a === refId ? -1 : b === refId ? 1 : 0));
    const tete = classement[0], eRef = tete === refId ? null : sim.ecart(tete, refId), nul = { delta: [0], courants: [0], p10: 0, p50: 0, p90: 0, probabilite_mieux: 0 };
    const e = eRef || nul, enjeu = parAn(e, H);
    const opts = ids.map(id => {
      const x = sortieOption(id, libelles[id], options[id].map(s => s.type), sim.options[id]);
      if (id === "per") { x.versement_mensuel = r2(versementPer(m, tmi, plafond.annuel).v); x.deduit_annuel = r2(12 * versementPer(m, tmi, plafond.annuel).deduit); x.contraintes.push("Bloqué jusqu'à la retraite, sauf achat de la résidence principale."); x.disponible = false; }
      return x;
    }).concat(Object.keys(exclues).map(id => optionExclue(id, id === "per" ? "PER" : "PEA + assurance-vie", id === "per" ? ["per"] : ["pea", "assurance_vie"], exclues[id][0], exclues[id][1])));
    /* ce qui changerait */
    let fraisSeuil = null;
    if (options.av && tete !== "av" && tousAv.ks.some(k => k !== "fonds_euros")) {
      const cible = sim.options[tete].courants;
      fraisSeuil = seuilDichotomie(x => {
        const av2 = [Object.assign({}, options.av[0], { poches: options.av[0].poches.map(p => (p.classe === "fonds_euros" ? p : Object.assign({}, p, { frais_pct: x }))) })];
        const s2 = simulerEnveloppes(d, { T, couple: fo.couple, options: { av: av2 } }, simOptsDe(o));
        return quantile(Array.from(s2.options.av.courants, (v, i) => v - cible[i]), 0.5);
      }, 0, 3, 12);
      if (fraisSeuil.etat === "ok") ctq.push(ligne("frais_assurance_vie", O.frc(frais.assurance_vie_pct + ter, 2) + " %", O.frc(fraisSeuil.x, 2) + " %", "En dessous, l'assurance-vie rejoint " + minus(libelles[tete]),
        "Si les frais annuels de " + (avEx ? "ton assurance-vie" : "l'assurance-vie") + " (contrat et fonds) tombaient à " + O.frc(fraisSeuil.x, 2) + " %, elle rejoindrait " + minus(libelles[tete]) + "."));
    }
    let tStar = null;
    if (options.per && tete !== "per" || (options.per && classement.length > 1)) {
      const autre = classement.find(id => id !== "per"), per0 = sim.netA("per", T, { tmi_per: 0 }).courants, ded = sim.options.per.deduits, cn = sim.options[autre].courants;
      const x = Array.from(per0, (v, i) => v - cn[i]), q50 = quantile(x, 0.5);
      tStar = ded > 0 && q50 > 0 ? q50 / ded * 100 : null;
      const tmiRetenue = options.per[0].tmi_retraite_pct, perDevant = quantile(sim.options.per.net, 0.5) > quantile(sim.options[autre].net, 0.5);
      if (tStar != null && tStar < 100) ctq.push(ligne("tmi_retraite", tmiRetenue + " %", O.frc(tStar, 1) + " %", perDevant ? "Au-delà, le PER passe derrière " + minus(libelles[autre]) : "En dessous, le PER passe devant " + minus(libelles[autre]),
        perDevant ? "Le PER reste devant " + minus(libelles[autre]) + " tant que ta tranche d'imposition à la retraite reste sous " + O.frc(tStar, 1) + " %."
          : "Le PER ne passerait devant " + minus(libelles[autre]) + " que si ta tranche d'imposition à la retraite était sous " + O.frc(tStar, 1) + " %."));
    }
    if (exclues.per && exclues.per[0] === "retrait_avant") ctq.push(ligne("retrait_avant", "oui", "non", "Le PER entrerait dans la comparaison", "Si tu n'as pas besoin de retirer cet argent avant ta retraite, le PER entre dans la comparaison."));
    if (options["pea+av"]) ctq.push(peaEx ? ligne("pea_5_ans", dateFr(dateDe(today, T)), dateFr(pea5), "Avant cette date, le PEA sort de la comparaison", "Si tu retires avant le " + dateFr(pea5) + " (les 5 ans de ton PEA), il sort de la comparaison : un retrait le clôture.")
      : ligne("pea_5_ans", ans(H), ans(dureePea), "Sous 5 ans, le PEA sort de la comparaison", "Si tu retires avant 5 ans, le PEA sort de la comparaison : un retrait le clôture."));
    ctq.push(ligne("transmission", rep.transmission === true ? "oui" : "non précisé", null, "Information, sans calcul", "La transmission (clause bénéficiaire, abattement par bénéficiaire) peut compter : pour un cas particulier, un notaire."));
    const phrase = tete === refId ? "Sur " + ans(H) + ", " + minus(libelles[refId]) + " reste en tête : aucune des autres enveloppes ne fait mieux sur ces hypothèses."
      : "Sur " + ans(H) + ", " + minus(libelles[tete]) + " arrive en tête, environ " + eur0(e.p50) + " de plus " + que(minus(libelles[refId])) + ", en euros d'aujourd'hui.";
    avert.unshift(...avertFrais(frais, ["ter_pct", "pea_pct", "compte_titres_pct", "assurance_vie_pct"].concat(tousAv.ks.includes("fonds_euros") ? ["fonds_euros_pct"] : [], options.per ? ["per_pct"] : [])));
    const reponse = { phrase, option_en_tete: tete, reference: refId, ecart: ecartBandes(e), ecart_annuel: enjeu, probabilite_mieux: p3(e.probabilite_mieux), date_bascule: null };
    /* enjeu de la carte (décision du 2026-10-16, option A) : contre la meilleure option dont le foyer détient déjà toutes les enveloppes (rien à ouvrir) ; nul si c'est l'option
       en tête ; sans enveloppe détenue, contre la référence (compte-titres). La réponse garde la référence. Jamais un enjeu plus grand que ce que la décision change. */
    const tient = id => options[id].filter(x => !x.debordement).every(x => fo.enveloppes.some(y => (famillesTypes[x.type] || [x.type]).includes(y.type)));
    const refEnjeu = classement.find(tient) || refId, zero = { p10: 0, p50: 0, p90: 0 };
    const enjeuCarte = refEnjeu === tete ? zero : refEnjeu === refId ? enjeu : parAn(sim.ecart(tete, refEnjeu), H);
    if (refEnjeu !== refId) avert.push(refEnjeu === tete ? "Tu détiens déjà les enveloppes de l'option en tête (" + minus(libelles[tete]) + ") : l'enjeu de cette question est donc nul ; l'écart avec " + minus(libelles[refId]) + " reste montré pour information."
      : "L'enjeu de cette question compare " + minus(libelles[tete]) + " à " + minus(libelles[refEnjeu]) + ", que tu as déjà : c'est ce que changerait le choix.");
    /* classes que l'enveloppe ne peut pas recevoir : dites (répartition propre au lot 2) */
    const horsEnveloppe = tousAv.ks.filter(k => ["crypto", "levier"].includes(k));
    if (horsEnveloppe.length) avert.push("Ton allocation contient " + horsEnveloppe.map(k => (k === "crypto" ? "des crypto-actifs" : "des fonds à effet de levier")).join(" et ") + " : une assurance-vie ou un PER ne peut pas les recevoir ; le calcul les y place quand même, ce qui rend cette comparaison approximative.");
    return { options: opts, reponse, ce_qui_changerait: ctq, avertissements: avert, enjeu_annuel: enjeuCarte, sim,
      detail: { T, classement, reference_enjeu: refEnjeu, ecart_tete_moins_reference: r2(quantile(e.courants, 0.5)), frais_seuil_av_uc_pct: fraisSeuil && fraisSeuil.etat === "ok" ? r2(fraisSeuil.x * 1000) / 1000 : null,
        exclues: Object.fromEntries(Object.keys(exclues).map(k => [k, exclues[k][0]])), t_star_pct: tStar == null ? null : r2(tStar * 100) / 100, plafond_per: plafond },
      plan: { tete, reference: refId, plan, titulaire: plafond.personne || c.titulaire },
      retenables: retenablesEuro(c, { options, refId, ids, tousAv, act, plafond, tmi, rep, T, V0, m, delai, dateRet, peaEx, avEx, plafondPea }) };
  }
  /** Options retenables du n° 2 : une seule enveloppe par variante (assurance-vie, PER, PEA sans reste) ; le compte-titres est la référence. */
  function retenablesEuro(c, x) {
    const out = { options: {}, non: {} }, { today } = c, ouverture = dateDe(today, x.delai), tit = x.plafond.personne || c.titulaire, fr = c.frais;
    const un = (id, p) => { const h = hypotheseEnveloppe(c, Object.assign({ ouverture, titulaire: tit }, p)); out.options[id] = h; };
    /* une enveloppe déjà détenue : la variante la reprend à sa date d'ouverture (inconnue : l'option ne se retient pas) et pour son titulaire */
    const deja = (ex, nom) => (!ex ? {} : ex.date_ouverture ? { ouverture: ex.date_ouverture, titulaire: ex.titulaire || tit } : { manque: "La date d'ouverture de " + nom + " n'est pas connue : donne-la pour retenir cette option." });
    x.ids.forEach(id => {
      if (id === x.refId) { out.non[id] = NON_RETENABLE_REFERENCE; return; }
      const envs = x.options[id].filter(e => !e.debordement);             // le débordement au plafond (compte-titres) fait partie de l'enveloppe : le moteur le rejoue
      if (envs.length !== 1) { out.non[id] = NON_RETENABLE_MULTI; return; }
      if (id === "av") {
        const dj = deja(x.avEx, "ton assurance-vie");
        if (dj.manque) { out.non[id] = dj.manque; return; }
        un(id, Object.assign({ type: "assurance_vie", allocation: x.tousAv.parts, fraisEnveloppe: fr.assurance_vie_pct, initial: x.V0, mensuel: x.m }, dj));
      } else if (id === "pea+av") {
        const dj = deja(x.peaEx, "ton PEA");
        if (dj.manque) { out.non[id] = dj.manque; return; }
        un(id, Object.assign({ type: "pea", allocation: x.act.parts, fraisEnveloppe: fr.pea_pct, initial: x.V0, mensuel: x.m, plafond: x.plafondPea, debordement: "compte_titres" }, dj));
      } else if (id === "per") {
        if (x.V0 > 0) { out.non[id] = "Le versement de départ n'est pas déduit dans ce calcul du PER : mets-le à 0 pour retenir cette option."; return; }
        const tmiRet = x.rep.tmi_retraite_pct === "ne_sait_pas" || x.rep.tmi_retraite_pct == null ? x.tmi : +x.rep.tmi_retraite_pct;
        un(id, { type: "per", allocation: x.tousAv.parts, fraisEnveloppe: fr.per_pct, mensuel: versementPer(x.m, x.tmi, x.plafond.annuel).v, plafond: x.plafond.annuel,
          per: Object.assign({ deduit: true, tmi_retraite_pct: tmiRet, economie: "reinvestie" }, TMI_ADMISES.includes(x.tmi) ? { tmi_actuelle_pct: x.tmi } : {}) });
      } else out.non[id] = NON_RETENABLE_MULTI;
    });
    return out;
  }

  /* ================================================================== n° 3 : le PER est-il intéressant pour moi ? (§ 7.3) */
  function perInteret(c) {
    const { d, today, rep, L, o, fo } = c;
    const tmi = +rep.tmi_pct, tmiRep = rep.tmi_retraite_pct, tmiR = tmiRep === "ne_sait_pas" ? tmi : +tmiRep, m = +rep.versement_mensuel || 0, delai = L.v("scn_delai_ouverture_mois");
    const T = O.moisEntre(today, rep.date_retraite);
    const frais = c.frais, ter = frais.ter_pct, avert = [], ctq = [];
    if (tmiRep === "ne_sait_pas") avert.push("Tranche d'imposition à la retraite inconnue : la tranche d'aujourd'hui (" + tmi + " %) est supposée ; le tableau montre les autres.");
    if (!(T >= 12)) return { statut: "a_completer", manquants: [{ champ: "date_retraite", question_id: "date_retraite", libelle: "Une date de départ à la retraite dans au moins un an", comment: "Donne la date à laquelle tu penses partir à la retraite." }] };
    const H = T / 12, alloc0 = allocationDe(d, o), alloc = alloc0 || { actions: 1 }, tous = normaliser(alloc, () => true);
    if (tous.ks.some(k => ["crypto", "levier"].includes(k))) avert.push("Ton allocation contient des crypto-actifs ou des fonds à effet de levier : un PER ou une assurance-vie ne peut pas les recevoir ; le calcul les y place quand même, ce qui rend cette comparaison approximative.");
    avert.unshift(...avertFrais(frais, ["ter_pct", "per_pct", "assurance_vie_pct"].concat(tous.ks.includes("fonds_euros") ? ["fonds_euros_pct"] : [])));
    if (!alloc0) avert.push("Aucune allocation cible renseignée : la comparaison suppose 100 % actions.");
    const plafond = plafondPer(d, today, L, fo, o);
    if (plafond.texte) avert.push(plafond.texte);
    if (rep.statut === "independant") avert.push("Indépendant : le plafond de déduction est différent et n'est pas calculé ici ; le plafond de ton avis d'impôt, ou l'estimation, est utilisé.");
    /* effort net égal : v = m + économie / 12 ; économie à la TMI, ou par tranches si le revenu net imposable et le nombre de parts sont connus */
    const avis = objet(objet(d.config).avis_impot), rni = o.revenu_net_imposable != null ? +o.revenu_net_imposable : (nombre(avis.revenu_net_imposable) ? +avis.revenu_net_imposable : null);
    const parts = o.parts != null ? +o.parts : (nombre(avis.parts) ? +avis.parts : null);
    const seuilsIr = { 11: L.v("ir_bareme_11_seuil"), 30: L.v("ir_bareme_30_seuil"), 41: L.v("ir_bareme_41_seuil"), 45: L.v("ir_bareme_45_seuil") };
    const parTranches = rni != null && parts != null && Object.values(seuilsIr).every(v => v !== undefined);
    const bloc = cap => {
      if (!parTranches) { const x = versementPer(m, tmi, cap); return { v: x.v, deduit: x.deduit, eco: x.deduit * 12 * tmi / 100 }; }
      /* v tel que v − économie(min(12 v, plafond)) / 12 = m : la fonction est croissante, dichotomie */
      const f = v => v - economiePer(rni, parts, Math.min(12 * v, cap == null ? Infinity : cap), seuilsIr).economie / 12 - m;
      let lo = m, hi = m * 2 + (cap == null ? 0 : cap / 12) + 1;
      for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
      const v = (lo + hi) / 2, dd = Math.min(12 * v, cap == null ? Infinity : cap);
      return { v, deduit: dd / 12, eco: economiePer(rni, parts, dd, seuilsIr).economie };
    };
    const b1 = bloc(plafond.premiere_annee), b2 = bloc(plafond.annuel);
    const flPer = b1.v === b2.v && b1.deduit === b2.deduit ? [{ de: delai, a: T, montant: b2.v, deduit: b2.deduit }]
      : [{ de: delai, a: Math.min(T, delai + 11), montant: b1.v, deduit: b1.deduit }, { de: delai + 12, a: T, montant: b2.v, deduit: b2.deduit }].filter(s => s.de <= s.a);
    const per = { type: "per", ouverture_t: delai, poches: tous.ks.map(k => ({ classe: k, part: tous.parts[k], frais_pct: k === "fonds_euros" ? frais.per_pct : ter + frais.per_pct })), flux: flPer, tmi_pct: tmi, tmi_retraite_pct: tmiR };
    const av = { type: "assurance_vie", ouverture_t: delai, poches: tous.ks.map(k => ({ classe: k, part: tous.parts[k], frais_pct: k === "fonds_euros" ? frais.fonds_euros_pct : ter + frais.assurance_vie_pct })), flux: [{ de: delai, a: T, montant: m }] };
    const plan = { T, couple: fo.couple, options: { per: [per], av: [av] }, comparer: ["per", "av"], reference: "av" };
    const sim = simulerEnveloppes(d, plan, simOptsDe(o));
    if (sim.indisponible) return { statut: "indisponible", reperes_manquants: sim.reperes_manquants };
    const P_ = sim.options.per, A_ = sim.options.av, e = sim.ecart("per", "av"), q50 = a => quantile(a, 0.5);
    const table = {}; [0, 11, 30, 41].forEach(t => { table[t] = r2(q50(sim.netA("per", T, { tmi_per: t }).courants)); });
    const ded = P_.deduits, x0 = Array.from(sim.netA("per", T, { tmi_per: 0 }).courants, (v, i) => v - A_.courants[i]), tBrut = ded > 0 ? q50(x0) / ded * 100 : null;
    const tStar = tBrut != null && tBrut > 0 ? tBrut : null;
    const perEnTete = e.p50 > 0, enjeu = perEnTete ? parAn(e, H) : { p10: 0, p50: 0, p90: 0 };
    const dedAn = 12 * b2.deduit, nonDed = 12 * b2.v - dedAn;
    if (tStar != null) ctq.push(ligne("tmi_retraite", tmiR + " %", O.frc(tStar, 2) + " %", perEnTete ? "Au-delà, l'assurance-vie fait mieux" : "En dessous, le PER fait mieux",
      perEnTete ? "Le PER reste devant l'assurance-vie tant que ta tranche d'imposition à la retraite reste sous " + O.frc(tStar, 1) + " %."
        : "Le PER ne passerait devant l'assurance-vie que si ta tranche d'imposition à la retraite était sous " + O.frc(tStar, 1) + " %."));
    else ctq.push(ligne("tmi_retraite", tmiR + " %", null, "Aucun seuil : l'assurance-vie fait mieux à toute tranche", "Avec ces chiffres, l'assurance-vie fait mieux à n'importe quelle tranche d'imposition à la retraite."));
    if (dedAn >= plafond.annuel - 0.005 && isFinite(plafond.annuel)) ctq.push(ligne("plafond_per", O.eur(plafond.annuel), O.eur(12 * m), "Au-delà du plafond, les versements ne sont plus déduits", "Ton plafond de déduction est atteint : la partie de ton versement au-delà de " + O.eur(plafond.annuel) + " par an n'est pas déduite."));
    if (rep.achat_rp === true) ctq.push(ligne("achat_residence_principale", "oui", null, "Le PER peut être débloqué pour cet achat", "Tu pourrais le débloquer pour l'achat de ta résidence principale : la part des versements déduits est imposée comme une sortie en capital."));
    if (parTranches) avert.push("Près du bas d'une tranche, l'économie d'impôt peut être plus faible : la décote et le plafonnement du quotient familial ne sont pas calculés.");
    avertPer(tmi, tmiR, b2.v - m, parTranches).forEach(x => avert.push(x));
    ctq.push(ligne("sortie_en_rente", "non calculé", null, "Seule la sortie en capital est calculée", "La sortie en rente est imposée comme une pension ; elle n'est pas calculée ici."));
    const opts = [sortieOption("per", "PER", ["per"], P_, { versement_mensuel: r2(b2.v), deduit_annuel: r2(dedAn), non_deduit_annuel: r2(nonDed), disponible: false, contraintes: ["Bloqué jusqu'à la retraite, sauf achat de la résidence principale."] }),
      sortieOption("av", "Assurance-vie", ["assurance_vie"], A_)];
    const phrase = perEnTete ? "À effort égal de " + O.eur(m) + " par mois jusqu'à ta retraite, un PER te laisserait environ " + eur0(e.p50) + " de plus qu'une assurance-vie, en euros d'aujourd'hui, avec ta tranche d'imposition à la retraite de " + tmiR + " %."
      : "À effort égal de " + O.eur(m) + " par mois, l'assurance-vie fait mieux que le PER avec ces hypothèses (tranche d'imposition à la retraite de " + tmiR + " %).";
    const reponse = { phrase, option_en_tete: perEnTete ? "per" : "av", reference: "av", ecart: ecartBandes(e), ecart_annuel: parAn(e, H), probabilite_mieux: p3(e.probabilite_mieux), date_bascule: null };
    return { options: opts, reponse, ce_qui_changerait: ctq, avertissements: avert, enjeu_annuel: enjeu, sim,
      detail: { T, v_mensuel: r2(b2.v), v_mensuel_premiere_annee: r2(b1.v), economie_annuelle: r2(b2.eco), deduit_annuel: r2(dedAn), non_deduit_annuel: r2(nonDed), deduits: r2(P_.deduits), versements_per: r2(P_.base),
        V_per: r2(q50(P_.brut)), gain_per: r2(q50(P_.brut) - P_.base), net_per: r2(q50(P_.courants)), V_av: r2(q50(A_.brut)), gain_av: r2(q50(A_.brut) - A_.base),
        impot_av: r2(q50(Array.from(A_.impots, (v, i) => v - A_.ps[i]))), prelevements_av: r2(q50(A_.ps)), net_av: r2(q50(A_.courants)), net_av_auj: r2(q50(A_.net)),
        ecart_courants: r2(q50(e.courants)), table_net_per: table, t_star_pct: tStar == null ? null : r2(tStar * 10000) / 10000, t_star_brut_pct: tBrut == null ? null : r2(tBrut * 100) / 100,
        phrase_seuil: tStar == null ? "aucun_seuil" : "seuil", net_per_auj: bandeR(P_.net), net_av_auj_bande: bandeR(A_.net), plafond_per: plafond, par_tranches: parTranches },
      plan: { tete: perEnTete ? "per" : "av", reference: "av", plan, titulaire: plafond.personne || c.titulaire },
      retenables: (() => {
        const h = hypotheseEnveloppe(c, { type: "per", titulaire: plafond.personne || c.titulaire, ouverture: dateDe(today, delai), allocation: tous.parts, fraisEnveloppe: frais.per_pct, mensuel: b2.v,
          plafond: isFinite(plafond.annuel) ? plafond.annuel : null, per: Object.assign({ deduit: true, tmi_retraite_pct: TMI_ADMISES.includes(tmiR) ? tmiR : tmi, economie: "reinvestie" },
            TMI_ADMISES.includes(tmi) ? { tmi_actuelle_pct: tmi } : {}) });
        return { options: { per: h }, non: { av: NON_RETENABLE_REFERENCE } };
      })() };
  }
  const TMI_ADMISES = [0, 11, 30, 41, 45];

  /* ================================================================== n° 6 : combien garder de côté, et où ? (§ 7.4) */
  function matelas(c) {
    const { d, today, rep, L, o, fo } = c;
    const E = etatMatelas(d, today, L.v, o, rep), avert = [], ctq = [];
    const capacite = capaciteDe(d), H = Math.max(1, +rep.horizon_ans || 5), T = Math.round(H * 12);
    const lepPlafond = L.v("lep_plafond"), laPlafond = L.v("livret_a_plafond"), ldPlafond = L.v("ldds_plafond");
    const tauxLep = L.v("lep_taux"), tauxLa = L.v("livret_a_taux");
    const el = eligibiliteLep(d, today, L.v, rep.parts_fiscales), lep = { eligible: el.eligible, plafond_rfr: el.plafond_rfr, rfr: el.rfr, parts: el.parts };
    const parts = lep.parts, rfr = lep.rfr, plafondRfr = lep.plafond_rfr;
    if (el.avis_trop_ancien != null) avert.push("Ton avis d'impôt porte sur les revenus de " + el.avis_trop_ancien + " : pour un LEP, c'est celui des revenus de " + (+today.slice(0, 4) - 1) + " (ou " + (+today.slice(0, 4) - 2) + ") qui compte ; la possibilité d'en ouvrir un n'est pas évaluée.");
    else if (lep.eligible == null) avert.push("Le nombre de parts ou le revenu fiscal de référence de ton avis d'impôt manque : la possibilité d'ouvrir un LEP n'est pas évaluée.");
    /* répartition de la cible : LEP de chaque adulte du foyer fiscal (les deux seulement s'ils sont imposés ensemble : l'avis saisi n'en couvre qu'un sinon), puis Livret A, puis LDDS */
    const titulaires = fo.personnes.map(p => p.id), tit = titulaires.length ? titulaires : ["p1"], titLep = fo.couple ? tit : tit.slice(0, 1);
    if (lep.eligible && titLep.length < tit.length) avert.push("Sans imposition commune, chacun a son propre avis d'impôt : un seul LEP est compté, celui de " + (fo.personnes[0] ? fo.personnes[0].nom : "la personne de l'avis") + ".");
    const slots = [];
    if (lep.eligible) titLep.forEach(t => slots.push({ vers: "lep", titulaire: t, plafond: lepPlafond, taux: tauxLep }));
    tit.forEach(t => slots.push({ vers: "livret_a", titulaire: t, plafond: laPlafond, taux: tauxLa }));
    tit.forEach(t => slots.push({ vers: "ldds", titulaire: t, plafond: ldPlafond, taux: tauxLa }));
    let aPlacer = E.cible; const ordre = [];
    slots.forEach(s => { const x = Math.min(aPlacer, s.plafond); if (x > EPS) ordre.push({ vers: s.vers, titulaire: s.titulaire, montant: r2(x), taux: s.taux }); aPlacer -= Math.max(0, x); });
    if (aPlacer > EPS) avert.push("La cible dépasse les plafonds cumulés des livrets de ton foyer : " + O.eur(aPlacer) + " restent à placer ailleurs.");
    /* gain de l'ordre : l'argent déjà détenu qui change de livret, aux taux d'aujourd'hui */
    const infos = objet(objet(d.config).enveloppes_infos), parType = { lep: 0, livret_a: 0, ldds: 0 }, sansType = new Set();
    liste(d.positions).filter(p => p && Calc.counted(p) && Calc.famille(p, d.classes) === "epargne").forEach(p => {
      const cle = Calendrier.cleEnveloppe(p.envelope, p.owner, d.positions, infos), t = objet(infos[cle]).type || Calendrier.typeDeduit(p.envelope);
      if (t in parType) parType[t] += Calc.val(p); else if (Calc.val(p) > 0) sansType.add(String(p.envelope || p.name || "").trim());
    });
    const connu = parType.lep + parType.livret_a + parType.ldds + Math.max(0, E.dispo.courantsAuDela || 0), inconnu = Math.max(0, E.actuel - connu);
    const taux = { lep: tauxLep, livret_a: tauxLa, ldds: tauxLa }, detenu = Object.assign({}, parType);
    let pool = Math.min(E.actuel - inconnu, E.cible), gain = 0;
    const restePool = Object.assign({}, parType, { courant: E.dispo.courantsAuDela });
    ordre.forEach(s => { s.reste = s.montant; });
    ordre.forEach(s => { const reste = Math.min(s.reste, detenu[s.vers] || 0); if (reste > 0) { detenu[s.vers] -= reste; s.reste -= reste; pool -= reste; restePool[s.vers] -= reste; } });
    const totalRestant = somme(Object.values(restePool), x => Math.max(0, x)), tauxMoyen = totalRestant > 0 ? (restePool.lep * tauxLep + restePool.livret_a * tauxLa + restePool.ldds * tauxLa) / totalRestant : 0;
    ordre.forEach(s => { const x = Math.min(s.reste, Math.max(0, pool)); if (x > 0) { gain += x * (s.taux - tauxMoyen) / 100; pool -= x; } });
    const gainOrdre = Math.max(0, gain);
    if (inconnu > EPS && ordre.length) avert.push("Le taux de " + ([...sansType].filter(Boolean).map(n => "« " + n + " »").join(", ") || "certains de tes livrets") + " n'est pas connu (type de livret non précisé, ou PEL) : cet argent n'entre pas dans le gain du rangement ; précise le type (Livret A, LDDS, LEP) pour un chiffre complet.");
    const nomsOrdre = [...new Set(ordre.map(s => nomEnveloppe[s.vers]))], rangement = nomsOrdre.length > 1 ? "dans l'ordre " + nomsOrdre.join(", ") : "sur " + (nomsOrdre[0] === "Livret A" ? "un Livret A" : nomsOrdre[0] === "LEP" ? "un LEP" : "un " + (nomsOrdre[0] || "livret"));
    /* surplus : le placer au mois 0 contre le laisser sur livret */
    let simS = null, eS = null, cto = null, livret = null, enjeuSurplus = { p10: 0, p50: 0, p90: 0 }, tauxSeuil = null, bandeV = null;
    if (E.surplus > EPS) {
      const dest = rep.destination_surplus || "compte_titres", frais = c.frais, ter = frais.ter_pct;
      const fd = dest === "assurance_vie" ? frais.assurance_vie_pct : dest === "pea" ? frais.pea_pct : frais.compte_titres_pct;
      avertFrais(frais, ["ter_pct", cleFraisDe(dest)]).forEach(x => avert.push(x));
      const delai = dest === "compte_titres" ? 0 : L.v("scn_delai_ouverture_mois");
      const placement = { type: dest, ouverture_t: delai, poches: [{ classe: "actions", part: 1, frais_pct: ter + fd }], flux: [{ de: delai, a: delai, montant: E.surplus }] };
      const liv = { type: "livret_a", ouverture_t: 0, poches: [{ classe: "monetaire", part: 1, frais_pct: 0 }], flux: [{ de: 0, a: 0, montant: E.surplus }] };
      simS = simulerEnveloppes(d, { T, couple: fo.couple, options: { placement: [placement], livret: [liv] }, comparer: ["placement", "livret"], reference: "livret" }, simOptsDe(o));
      if (simS.indisponible) return { statut: "indisponible", reperes_manquants: simS.reperes_manquants };
      eS = simS.ecart("placement", "livret");
      enjeuSurplus = parAn(eS, H);
      const pl = simS.options.placement;
      cto = { V: r2(quantile(pl.brut, 0.5)), gain: r2(quantile(pl.brut, 0.5) - pl.base), impots: r2(quantile(pl.impots, 0.5)), net: r2(quantile(pl.courants, 0.5)) };
      bandeV = bandeR(pl.brut);
      livret = r2(quantile(simS.options.livret.courants, 0.5));
      tauxSeuil = r2((Math.pow(quantile(pl.courants, 0.5) / E.surplus, 1 / H) - 1) * 100 * 100) / 100;
      if (eS.p10 < 0) ctq.push(ligne("risque_surplus", "1 chance sur 10", r2(eS.p10), "Le surplus placé peut faire moins bien que le livret", "1 chance sur 10 de faire moins bien que le livret de plus de " + eur0(-eS.p10) + " sur " + ans(H) + "."));
    }
    const enjeuP50 = gainOrdre + Math.max(0, enjeuSurplus.p50);
    const enjeu = { p10: r2(gainOrdre + (enjeuSurplus.p50 > 0 ? enjeuSurplus.p10 : 0)), p50: r2(enjeuP50), p90: r2(gainOrdre + Math.max(0, enjeuSurplus.p90)) };
    if (E.manque > EPS) avert.push("Il te manque " + O.eur(E.manque) + (capacite > 0 ? ", soit environ " + Math.ceil(E.manque / capacite) + " mois à ton rythme d'épargne." : "."));
    const revenus = Calc.revenusFoyer(d.profil, "foyer") || somme(liste(objet(d.budget).lignes).filter(l => l && l.type === "revenu"), l => (l.frequence === "an" ? +l.montant / 12 : +l.montant));
    const k3 = L.v("scn_matelas_mois_stable");
    ctq.push(ligne("mois_matelas", E.mois + " mois", E.convention.mois + " mois", "La cible suit le nombre de mois choisi", "Chaque mois de plus ou de moins déplace la cible de " + O.eur(E.dep.montant) + "."));
    if (lep.eligible === false && parts != null) ctq.push(ligne("lep_rfr", O.eur(rfr), O.eur(plafondRfr), "Sous ce revenu fiscal de référence, un LEP devient possible", "Un LEP est possible si ton revenu fiscal de référence ne dépasse pas " + O.eur(plafondRfr) + " pour " + parts + " parts."));
    ctq.push(ligne("taux_livret", O.frc(tauxLa, 2) + " %", tauxSeuil == null ? null : O.frc(tauxSeuil, 2) + " %", "Au-dessus de ce taux, le livret ferait mieux que le placement", tauxSeuil == null ? "Pas de surplus à placer." : "Le livret ferait aussi bien que le placement avec un taux de " + O.frc(tauxSeuil, 2) + " % par an."));
    const ranger = gainOrdre > 0 ? "Les ranger " + rangement + " te rapporterait environ " + eur0(gainOrdre) + " de plus par an." : "";
    const phrase = E.surplus > EPS ? "Ta cible est de " + eur0(E.cible) + " (" + E.mois + " mois de dépenses) ; tu as environ " + eur0(E.surplus) + " au-delà." + (ranger ? " " + ranger : "")
      : E.manque > EPS ? "Ta cible est de " + eur0(E.cible) + " (" + E.mois + " mois de dépenses) ; il te manque environ " + eur0(E.manque) + "." + (ranger ? " " + ranger : "")
        : "Ta cible est de " + eur0(E.cible) + " (" + E.mois + " mois de dépenses) et tu y es." + (ranger ? " " + ranger : "");
    const opts = [{ id: "ordre", libelle: "Ranger la cible : " + (nomsOrdre.join(", ") || "livrets"), enveloppes: [...new Set(ordre.map(s => s.vers))], net: null, verse: r2(E.cible), disponible: true, contraintes: [], exclue: null }];
    if (cto) opts.push({ id: "placement", libelle: "Surplus placé", enveloppes: [rep.destination_surplus || "compte_titres"], net: bandeR(simS.options.placement.net), verse: r2(E.surplus), disponible: true, contraintes: [], exclue: null },
      { id: "livret", libelle: "Surplus laissé sur livret", enveloppes: ["livret_a"], net: bandeR(simS.options.livret.net), verse: r2(E.surplus), disponible: true, contraintes: [], exclue: null });
    const reponse = { phrase, option_en_tete: E.surplus > EPS && enjeuSurplus.p50 > 0 ? "placement" : "ordre", reference: "livret", ecart: eS ? ecartBandes(eS) : { p10: 0, p50: 0, p90: 0 }, ecart_annuel: enjeuSurplus, probabilite_mieux: eS ? p3(eS.probabilite_mieux) : null, date_bascule: null };
    return { options: opts, reponse, ce_qui_changerait: ctq, avertissements: avert, enjeu_annuel: enjeu, sim: simS,
      detail: { depenses_reference: r2(E.dep.montant), source_depenses: E.dep.source, mois: E.mois, mois_convention: E.convention.mois, cible: r2(E.cible), actuel: r2(E.actuel), surplus: r2(E.surplus), manque: r2(E.manque),
        mois_pour_combler: E.manque > EPS && capacite > 0 ? Math.ceil(E.manque / capacite - 1e-9) : (E.manque > EPS ? null : 0), lep, ordre: ordre.map(s => ({ vers: s.vers, titulaire: s.titulaire, montant: s.montant })), gain_ordre_annuel: r2(gainOrdre),
        surplus_cto: cto ? Object.assign({ bande_V: bandeV }, cto) : null, surplus_livret: livret, ecart_courants: eS ? r2(quantile(eS.courants, 0.5)) : 0, ecart_auj: eS ? r2(eS.p50) : 0, enjeu_surplus_annuel: enjeuSurplus,
        taux_livret_seuil_pct: tauxSeuil, cible_en_revenus_3_mois: r2(k3 * revenus), perte_p10: eS ? r2(eS.p10) : null },
      plan: { tete: "ordre", reference: "livret", plan: null, titulaire: null },
      retenables: (() => {
        const out = { options: {}, non: { ordre: "L'ordre des livrets n'est pas une variante de projection : il se règle chez toi, livret par livret.", livret: NON_RETENABLE_REFERENCE } };
        if (cto) {
          const dest = rep.destination_surplus || "compte_titres", frais = c.frais, fd = dest === "assurance_vie" ? frais.assurance_vie_pct : dest === "pea" ? frais.pea_pct : frais.compte_titres_pct;
          /* le surplus est pris là où il est : compte courant au-delà de la réserve, puis LDDS, puis Livret A (jamais le LEP), dans les enveloppes dont le type est connu (le moteur ne sait rien prendre ailleurs) */
          const sources = [["courant", Math.max(0, E.dispo.courantsAuDela || 0)], ["ldds", parType.ldds], ["livret_a", parType.livret_a]], transferts = [];
          let aPrendre = E.surplus;
          sources.forEach(([de, dispo]) => { const x = Math.min(aPrendre, dispo); if (x >= 0.01) { transferts.push({ de, montant: x }); aPrendre -= x; } });
          if (aPrendre > 0.5) out.non.placement = "Une partie de ton surplus est sur des comptes que la projection ne sait pas encore vider (" + ([...sansType].filter(Boolean).map(n => "« " + n + " »").join(", ") || "livrets") + ") : précise s'il s'agit d'un Livret A ou d'un LDDS pour retenir cette option.";
          else out.options.placement = hypotheseEnveloppe(c, { type: dest, titulaire: c.titulaire, ouverture: dateDe(today, dest === "compte_titres" ? 0 : L.v("scn_delai_ouverture_mois")), allocation: { actions: 1 },
            fraisEnveloppe: fd, transferts });
        }
        return out;
      })() };
  }

  /* ================================================================== n° 12 : ouvrir une assurance-vie maintenant ? (§ 7.5) */
  function avMaintenant(c) {
    const { d, today, rep, L, o, fo } = c;
    const delai = L.v("scn_delai_ouverture_mois"), duree = L.v("av_duree_ans"), frais = c.frais, ter = frais.ter_pct, ctq = [];
    const vmin = +rep.versement_initial || 0, m = +rep.versement_mensuel || 0, fe = Math.min(100, Math.max(0, +rep.part_fonds_euros_pct || 0)) / 100;
    const avert = avertFrais(frais, (fe < 1 ? ["ter_pct", "assurance_vie_pct"] : []).concat(fe > 0 ? ["fonds_euros_pct"] : []));
    const P0 = Math.max(delai, O.moisEntre(today, rep.debut_date));
    const sansDate = !nombre(rep.retrait_ans);
    const T = sansDate ? Math.max(P0 + 12, 120) : Math.round(rep.retrait_ans * 12), H = T / 12;
    if (sansDate) avert.push("Pas de date de retrait : " + ans(H) + " supposés pour le chiffre ; la courbe montre les autres dates.");
    if (P0 >= T) return { statut: "a_completer", manquants: [{ champ: "debut_date", question_id: "debut_date", libelle: "Une date de début des versements avant celle du retrait", comment: "Donne une date de début antérieure à ton retrait." }] };
    const poches = [];
    if (fe < 1) poches.push({ classe: "actions", part: 1 - fe, frais_pct: ter + frais.assurance_vie_pct });
    if (fe > 0) poches.push({ classe: "fonds_euros", part: fe, frais_pct: frais.fonds_euros_pct });
    const flux = [{ de: P0, a: T, montant: m }], Tmax = Math.max(T, P0 + duree * 12 + 12, sansDate ? 240 : 0);
    const plan = { T, couple: fo.couple, options: { A: [{ type: "assurance_vie", ouverture_t: delai, poches, flux }], B: [{ type: "assurance_vie", ouverture_t: P0, poches, flux }] }, comparer: ["A", "B"], reference: "B", v_min: { montant: vmin, t: delai } };
    const sim = simulerEnveloppes(d, plan, Object.assign({ horizon_max: Tmax }, simOptsDe(o)));
    if (sim.indisponible) return { statut: "indisponible", reperes_manquants: sim.reperes_manquants };
    const e = sim.ecart("A", "B"), enjeu = parAn(e, H), ouvA = dateDe(today, delai), ouvB = dateDe(today, P0), seuilA = seuilAnnees(ouvA, duree), seuilB = seuilAnnees(ouvB, duree);
    const A_ = sim.options.A, B_ = sim.options.B, q50 = a => quantile(a, 0.5), dateT = sim.date(T);
    const pts = []; for (let t = delai; t <= Tmax; t++) { const x = sim.ecart("A", "B", t), b = bandeR(x.delta); pts.push({ t, date: sim.date(t), p10: b.p10, p50: b.p50, p90: b.p90, courants_p50: r2(q50(x.courants)) }); }
    const fenetre = { du: seuilA, au: O.ajouterJours(seuilB, -1) };
    ctq.push(ligne("av_8_ans", dateFr(dateT), dateFr(seuilA) + " au " + dateFr(fenetre.au), "L'avance compte pour un retrait dans cette fenêtre", "Ouvrir maintenant ne change rien si tu retires avant le " + dateFr(seuilA) + " ou à partir du " + dateFr(seuilB) + " : entre les deux, le contrat ouvert maintenant a plus de 8 ans et l'autre non."));
    ctq.push(ligne("transfert", "non calculé", null, "Un ancien contrat peut être transformé chez le même assureur sans perdre son ancienneté", "Un contrat peut être transformé, par avenant ou par un nouveau contrat, auprès du même assureur sans les conséquences fiscales d'un dénouement ; rien n'est dit d'un autre assureur."));
    ctq.push(ligne("clause_beneficiaire", "non calculé", null, "La clause bénéficiaire compte pour la transmission", "La clause bénéficiaire règle la transmission : pour un cas particulier, un notaire."));
    const gainAnt = r2(q50(e.courants));
    const phrase = e.p50 > 0.005 ? "Ouvrir une assurance-vie maintenant, même avec " + O.eur(vmin) + ", te ferait gagner environ " + eur0(e.p50) + " en euros d'aujourd'hui si tu retires à " + ans(H) + ", parce que ses 8 ans seraient atteints plus tôt."
      : "Si tu retires à " + ans(H) + ", ouvrir maintenant ne change rien : " + (dateT < seuilA ? "les deux contrats seraient imposés pareil (aucun n'a encore 8 ans)." : dateT >= seuilB ? "les deux contrats seraient imposés pareil (les deux ont plus de 8 ans)."
        : "le gain médian serait nul ou négatif, donc sans impôt d'un côté comme de l'autre.");
    const opts = [sortieOption("A", "Contrat ouvert maintenant", ["assurance_vie"], A_), sortieOption("B", "Contrat ouvert au début des versements", ["assurance_vie"], B_)];
    const reponse = { phrase, option_en_tete: Math.abs(e.p50) < 0.005 ? "egalite" : "A", reference: "B", ecart: ecartBandes(e), ecart_annuel: enjeu, probabilite_mieux: p3(e.probabilite_mieux), date_bascule: e.p50 > 0.005 ? seuilA : null };
    const fv = sim.v_min;
    return { options: opts, reponse, courbe: { abscisse: "date_sortie", points: pts }, ce_qui_changerait: ctq, avertissements: avert, enjeu_annuel: { p10: Math.min(enjeu.p10, enjeu.p50), p50: Math.max(0, enjeu.p50), p90: Math.max(enjeu.p90, enjeu.p50) }, sim,
      detail: { T, V: r2(q50(A_.brut)), versements: r2(A_.base), gain: r2(q50(A_.brut) - A_.base), impot_A: r2(q50(Array.from(A_.impots, (v, i) => v - A_.ps[i]))), impot_B: r2(q50(Array.from(B_.impots, (v, i) => v - B_.ps[i]))),
        prelevements: r2(q50(A_.ps)), A_apres_8_ans: dateT >= seuilA, B_apres_8_ans: dateT >= seuilB, gain_anteriorite: gainAnt, gain_anteriorite_auj: r2(e.p50), seuil_A: seuilA, seuil_B: seuilB, fenetre,
        v_min_brut: r2(q50(fv.brut)), v_min_net: r2(q50(fv.net)), v_min_frais: r2(q50(fv.frais)), gain_bande: bandeR(e.delta) },
      plan: { tete: "A", reference: "B", plan, titulaire: c.titulaire },
      retenables: (() => {
        const al = {}; if (fe < 1) al.actions = 1 - fe; if (fe > 0) al.fonds_euros = fe;
        return { options: { A: hypotheseEnveloppe(c, { type: "assurance_vie", titulaire: c.titulaire, ouverture: ouvA, allocation: al, fraisEnveloppe: frais.assurance_vie_pct, initial: vmin, mensuel: m, debut: dateDe(today, P0) }) },
          non: { B: "Cette option sert de point de comparaison : ouvrir plus tard est ce qui se passe si tu ne fais rien maintenant." } };
      })() };
  }

  /* ================================================================== n° 20 : un bien locatif ou des SCPI ? (spec 2026-10-26-scn-locatif-scpi-design.md) */
  const REGIMES_LOCATIF = { lmnp_reel: "meublé au réel", lmnp_micro: "meublé au micro-BIC", nu_reel: "location nue au réel", nu_micro: "location nue au micro-foncier" };
  const LIB_LS = { L: "Bien locatif", S: "SCPI en direct", AV: "SCPI en assurance-vie", SC: "SCPI à crédit" };
  /** Libellés dans une phrase (sujet ou complément), accords compris. */
  const PH_LS = { L: "le bien locatif", S: "les SCPI en direct", AV: "les SCPI en assurance-vie", SC: "les SCPI à crédit" };
  const NON_RETENABLE_IMMO = "Une variante de projection ne sait pas encore porter un bien ou des parts de SCPI : demande à Claude d'ajouter l'achat comme événement de vie.";

  /** Paramètres du calcul à partir des réponses et des repères (§ 2 et § 3 de la spec). Les surcharges `sur` servent aux seuils de « ce qui changerait ». */
  function parametresLocatif(c, sur) {
    const { rep, L } = c, s = sur || {};
    const meuble = /^lmnp/.test(rep.regime), neuf = rep.neuf === true;
    const p = {
      prix: +rep.prix, neuf, travaux: +rep.travaux || 0, mobilier: meuble ? +rep.mobilier || 0 : 0, apport: +rep.apport, regime: rep.regime, meuble,
      duree: Math.round(+rep.duree_credit_ans), taux: +rep.taux_credit_pct, loyer: +rep.loyer_mensuel, vacance: s.vacance != null ? s.vacance : +rep.vacance_mois,
      charges: +rep.charges_annuelles, gestion: (+rep.gestion_pct || 0) / 100, T: Math.round(+rep.horizon_ans) * 12, H: Math.round(+rep.horizon_ans), tmi: +rep.tmi / 100,
      fs: +rep.scpi_frais_souscription_pct / 100, dist: (s.dist != null ? s.dist : +rep.scpi_taux_distribution_pct) / 100, prixPart: +rep.scpi_prix_part_pct / 100,
      reinvestir: rep.scpi_reinvestir !== false, fav: (nombre(rep.frais_av_pct) ? +rep.frais_av_pct : c.frais.assurance_vie_pct) / 100, credit: rep.scpi_credit === true,
      fa_pct: L.v(neuf ? "frais_acquisition_neuf_pct" : "frais_acquisition_ancien_pct") / 100, garantie: L.v("garantie_pct") / 100, dossier: L.v("frais_dossier"),
      assurance: L.v("assurance_emprunteur_defaut_pct"), psF: L.v("ps_taux_foncier") / 100, psG: L.v("ps_taux_general") / 100,
      pvIr: L.v("pv_immo_ir_taux") / 100, pvPs: L.v("pv_immo_ps_taux") / 100, surtaxe: L.v("pv_immo_surtaxe_seuil"),
      mfPlafond: L.v("micro_foncier_plafond"), mfAbat: L.v("micro_foncier_abattement_pct") / 100, mbPlafond: L.v("micro_bic_plafond"), mbAbat: L.v("micro_bic_abattement_pct") / 100,
      defPlafond: L.v("deficit_foncier_plafond"), defFoncierAns: L.v("deficit_foncier_report_ans"), defBicAns: L.v("deficit_bic_report_ans"),
      terrain: L.v("scn_lmnp_part_terrain_pct") / 100, dBati: L.v("scn_lmnp_duree_bati_ans"), dTrav: L.v("scn_lmnp_duree_travaux_ans"), dMob: L.v("scn_lmnp_duree_mobilier_ans"),
      revente: L.v("scn_immo_frais_revente_pct") / 100, dj: L.v("scn_scpi_delai_jouissance_mois"),
    };
    p.FA = p.prix * p.fa_pct;
    p.K = p.prix + p.FA + p.travaux + p.mobilier;
    const besoin = Math.max(0, p.K - p.apport);
    p.A0 = Math.min(p.apport, p.K);
    p.C = besoin > 0 ? (besoin + p.dossier) / (1 - p.garantie) : 0;
    p.fraisEmprunt = p.C > 0 ? p.dossier + p.C * p.garantie : 0;
    return p;
  }

  /** Le bien, mois par mois (déterministe, § 3.1 à 3.3) : loyers, charges, crédit, impôt de l'année par douzièmes, cash-flow, amortissements déduits. */
  function exploitationLocatif(p, pi) {
    const T = p.T, W = T + 1, tab = PC.amortissement({ capital: p.C, taux_pct: p.taux, duree_mois: p.duree * 12, assurance_pct: p.assurance });
    const ech = new Float64Array(W), ass = new Float64Array(W), inter = new Float64Array(W), crd = new Float64Array(W);
    crd[0] = p.C;
    for (let t = 1; t < W; t++) { const r = tab[t - 1]; if (r) { ech[t] = r.echeance; ass[t] = r.assurance; inter[t] = r.interets; crd[t] = r.crd; } else crd[t] = 0; }
    const loyer = new Float64Array(W), charges = new Float64Array(W), gestion = new Float64Array(W), impot = new Float64Array(W), cf = new Float64Array(W);
    for (let t = 1; t < W; t++) {
      const y = Math.ceil(t / 12), idx = Math.pow(1 + pi, y - 1);
      loyer[t] = p.loyer * idx * (12 - p.vacance) / 12; charges[t] = p.charges / 12 * idx; gestion[t] = p.gestion * loyer[t];
    }
    const H = T / 12, annees = [], avert = new Set();
    /* régime micro au-delà de son plafond : réel pour toute la durée (dit) */
    let regime = p.regime;
    const recettes = y => somme([...Array(12).keys()], k => loyer[12 * (y - 1) + k + 1]);
    if (regime === "nu_micro" && [...Array(H).keys()].some(k => recettes(k + 1) > p.mfPlafond + EPS)) { regime = "nu_reel"; avert.add("Tes loyers dépassent " + O.eur(p.mfPlafond) + " par an : le micro-foncier n'est pas possible, le calcul passe au réel."); }
    if (regime === "lmnp_micro" && [...Array(H).keys()].some(k => recettes(k + 1) > p.mbPlafond + EPS)) { regime = "lmnp_reel"; avert.add("Tes loyers dépassent " + O.eur(p.mbPlafond) + " par an : le micro-BIC n'est pas possible, le calcul passe au réel."); }
    let carry = [];                                                  // déficits reportés { montant, fin (dernière année d'imputation) }
    const stock = [0, 0, 0];                                         // amortissements non déduits : bâti, travaux, mobilier
    let amortNM = 0;                                                 // amortissements de bâti et de travaux déduits (réintégrés dans la plus-value)
    const amortNMfin = new Float64Array(H + 1), impotsCum = new Float64Array(H + 1);
    const imputer = (r, y) => { carry = carry.filter(x => x.fin >= y); for (const x of carry) { const u = Math.min(x.montant, r); x.montant -= u; r -= u; if (r <= EPS) break; } carry = carry.filter(x => x.montant > EPS); return Math.max(0, r); };
    for (let y = 1; y <= H; y++) {
      let R = 0, Dc = 0, J = 0;
      for (let t = 12 * (y - 1) + 1; t <= 12 * y; t++) { R += loyer[t]; Dc += charges[t] + gestion[t]; J += inter[t] + ass[t]; }
      const E1 = y === 1 ? p.fraisEmprunt : 0;
      let base = 0, imp = 0, imputeGlobal = 0, amortDeduit = 0, resultat = null;
      if (regime === "nu_micro") { base = R * (1 - p.mfAbat); imp = base * (p.tmi + p.psF); }
      else if (regime === "lmnp_micro") { base = R * (1 - p.mbAbat); imp = base * (p.tmi + p.psG); }
      else if (regime === "nu_reel") {
        const tr = y === 1 ? p.travaux : 0, r = R - Dc - J - E1 - tr;
        resultat = r;
        if (r >= 0) { base = imputer(r, y); imp = base * (p.tmi + p.psF); }
        else {
          const hors = R - Dc - tr, h = Math.max(0, -hors);
          imputeGlobal = Math.min(h, p.defPlafond, -r);
          imp = -imputeGlobal * p.tmi;
          const reste = -r - imputeGlobal;
          if (reste > EPS) carry.push({ montant: reste, fin: y + p.defFoncierAns });
        }
      } else {
        const r = R - Dc - J - E1 - (y === 1 ? p.FA : 0);
        resultat = r;
        const dot = [y <= p.dBati ? p.prix * (1 - p.terrain) / p.dBati : 0, y <= p.dTrav ? p.travaux / p.dTrav : 0, y <= p.dMob ? p.mobilier / p.dMob : 0];
        let reste;
        if (r < 0) { carry.push({ montant: -r, fin: y + p.defBicAns }); reste = 0; dot.forEach((v, k) => { stock[k] += v; }); }
        else {
          reste = imputer(r, y);
          for (let k = 0; k < 3; k++) {
            const dispo = dot[k] + stock[k], u = Math.min(dispo, reste);
            reste -= u; amortDeduit += u; if (k < 2) amortNM += u;
            stock[k] = dispo - u;
          }
        }
        base = reste; imp = base * (p.tmi + p.psG);
      }
      for (let t = 12 * (y - 1) + 1; t <= 12 * y; t++) impot[t] = imp / 12;
      amortNMfin[y] = amortNM; impotsCum[y] = impotsCum[y - 1] + imp;
      annees.push({ annee: y, loyers: r2(R), charges: r2(Dc), credit: r2(somme([...Array(12).keys()], k => ech[12 * (y - 1) + k + 1] + ass[12 * (y - 1) + k + 1])), interets: r2(J), resultat: resultat == null ? null : r2(resultat),
        base_imposable: r2(base), impot: r2(imp), impute_revenu_global: r2(imputeGlobal), amortissements_deduits: r2(amortDeduit) });
    }
    for (let t = 1; t < W; t++) cf[t] = loyer[t] - charges[t] - gestion[t] - ech[t] - ass[t] - impot[t];
    annees.forEach(a => { a.cash_flow = r2(somme([...Array(12).keys()], k => cf[12 * (a.annee - 1) + k + 1])); });
    return { ech, ass, inter, crd, loyer, charges, gestion, impot, cf, annees, regime, amortNMfin, impotsCum, avertissements: [...avert], stock_amortissements: r2(stock[0] + stock[1] + stock[2]) };
  }

  /** Impôt de plus-value immobilière d'un gain après `ans` années pleines (abattements du moteur) → { impot, surtaxe }. */
  function impotPvImmo(gain, ans, p) {
    if (!(gain > 0)) return { impot: 0, surtaxe: false };
    const ir = gain * (1 - F.abattementIR(ans)), ps = gain * (1 - F.abattementPS(ans));
    return { impot: ir * p.pvIr + ps * p.pvPs, surtaxe: p.surtaxe != null && ir > p.surtaxe };
  }

  /** Les quatre options, chemin par chemin, sur les tirages du moteur (§ 3.4 à 3.6). opts.fin_seule : seulement la sortie à T (seuils). → { P, T, points: [k], net: { id: [Float64Array(P) par k] } (€ d'aujourd'hui), courants, … }. */
  function simulerLocatifScpi(c, p, opts) {
    const { d, today } = c, o = opts || {}, det = o.volatilite === 0, PZ = det ? 1 : Math.max(1, Math.round(o.chemins || 2000)), T = p.T, H = T / 12;
    /* sous_chemins : les N premiers chemins des mêmes tirages (seuils de « ce qui changerait », plus rapides, sans changer de tirages) */
    const P = o.sous_chemins ? Math.min(PZ, o.sous_chemins) : PZ;
    const graine = o.graine == null ? Proj.GRAINE : o.graine;
    const ctx = D.contexte(d, { hypotheses_classes: Object.assign({}, objet(o.hypotheses_classes), objet(o.sur_classes)) }), pi = ctx.pi;
    const bien = D.parametresClasse("immobilier_physique", ctx), scpi = D.parametresClasse("immobilier", ctx), mone = D.parametresClasse("monetaire", ctx);
    const aB = Math.log(1 + bien.rendement / 100) / 12, sB = det ? 0 : bien.volatilite / 100 / Math.sqrt(12);
    const aP = Math.log(1 + p.prixPart) / 12, sP = det ? 0 : scpi.volatilite / 100 / Math.sqrt(12);
    const Z = det ? null : tirer(PZ, T, graine, ["immobilier_physique", "immobilier"]), Tz = Z ? Z.T : 0;
    const zB = Z ? Z.z.immobilier_physique : null, zS = Z ? Z.z.immobilier : null;
    /* livret : taux du repère jusqu'à sa date de fin, puis le monétaire central (règle du socle) */
    const rl = ctx.R.livret_a_taux, gl = new Float64Array(T + 1);
    if (rl) ctx.rv("livret_a_taux");
    for (let t = 1; t <= T; t++) gl[t] = rl && (!rl.dateFin || O.ajouterMois(today, t) <= rl.dateFin) ? Math.pow(1 + +rl.valeur / 100, 1 / 12) : Math.pow(1 + mone.rendement / 100, 1 / 12);
    const loc = exploitationLocatif(p, pi);
    const sc = p.credit && p.C > 0, ids = ["L", "S", "AV"].concat(sc ? ["SC"] : []);
    const lnSC = sc ? PC.amortissement({ capital: p.C, taux_pct: p.taux, duree_mois: p.duree * 12, assurance_pct: p.assurance }) : [];
    const points = o.fin_seule ? [H] : [...Array(H).keys()].map(k => k + 1);
    const net = {}, cour = {}, verse = {}, impots = {}, frais = {};
    ids.forEach(id => { net[id] = points.map(() => new Float64Array(P)); cour[id] = points.map(() => new Float64Array(P)); impots[id] = new Float64Array(P); frais[id] = new Float64Array(P); });
    const budgetCum = points.map(() => new Float64Array(P)), budgetMois = new Float64Array(T + 1);
    const effL = t => Math.max(0, -loc.cf[t]), surL = t => Math.max(0, loc.cf[t]);
    const feeM = 1 - Math.pow(1 - p.fav, 1 / 12);
    /* une règle de sortie de l'assurance-vie par anniversaire : primes versées à cette date (déterministes : A0 + efforts du locatif), pour la part au-delà de 150 000 € */
    const primesA = t => p.A0 + somme([...Array(t).keys()], m => effL(m + 1));
    const prepsAV = new Map(points.map(k => [k, F.preparer({ type: "assurance_vie", valeur: 0, base: primesA(12 * k), classe: "immobilier", date_ouverture: today },
      { reperes: d.reperes, couple: !!c.fo.couple, primes_titulaire: primesA(12 * k) })]));
    const datesK = new Map(points.map(k => [k, O.ajouterMois(today, 12 * k)])), dateT = k => datesK.get(k);
    const PrA = new Float64Array(T + 1);                              // prix de part à chaque souscription (plus-value par souscription)
    let surtaxe = false, budgetP50Base = null;
    const Xs = new Float64Array(T + 1), Ns = new Float64Array(T + 1), Nav = new Float64Array(T + 1);
    for (let i = 0; i < P; i++) {
      let Vb = p.prix, Pr = 1, potL = 0, potS = 0, potAV = 0, potSC = 0, cum = p.A0, impS = 0, impSC = 0, fraisS = 0, fraisAV = 0;
      Xs.fill(0); Ns.fill(0); Nav.fill(0);
      Xs[0] = p.A0; Ns[0] = p.A0; Nav[0] = p.A0; PrA[0] = 1;
      let minPrA = 1; fraisS += p.A0 * p.fs; fraisAV += p.A0 * p.fs;
      let jouS = 0, jouAV = 0, unitsAV = p.A0, baseAV = p.A0, Fav = 1, sumNs = p.A0;
      const XSC = p.A0 + p.C, NSC = XSC; let carrySC = [];
      const fraisSC0 = XSC * p.fs + p.fraisEmprunt;
      let ki = 0;
      for (let t = 1; t <= T; t++) {
        const zb = zB ? zB[i * Tz + (t - 1)] : 0, zs = zS ? zS[i * Tz + (t - 1)] : 0;
        Vb *= Math.exp(aB + sB * zb);
        const Prev = Pr; Pr *= Math.exp(aP + sP * zs);
        const u = t - p.dj - 1;
        if (u >= 0) { jouS += Ns[u]; jouAV += Nav[u]; }
        const eL = effL(t);
        /* S : SCPI en direct au comptant */
        const distS = jouS * Prev * p.dist / 12, taxS = distS * (p.tmi + p.psF), ndS = distS - taxS;
        impS += taxS;
        const XS = eL + (p.reinvestir ? ndS : 0);
        Xs[t] = XS; Ns[t] = XS / Pr; PrA[t] = Pr; fraisS += XS * p.fs; sumNs += Ns[t];
        if (XS > 0 && Pr < minPrA) minPrA = Pr;
        /* AV : parts dans l'assurance-vie (en parts « normalisées » : parts réelles = normalisées × Fav, Fav = facteur cumulé des frais de gestion),
           distribution réinvestie sans frais d'entrée, frais de gestion prélevés chaque mois sur toutes les parts */
        const distAV = jouAV * Fav * Prev * p.dist / 12;
        fraisAV += unitsAV * Fav * Pr * (1 - p.fs) * feeM + eL * p.fs;
        Fav *= 1 - feeM;
        const nouv = (eL / Pr + distAV / (Pr * (1 - p.fs))) / Fav;
        unitsAV += nouv; Nav[t] = nouv; baseAV += eL;
        /* SC : SCPI à crédit, intérêts déductibles mois par mois (déficit reporté 10 ans), distribution qui rembourse l'échéance */
        let eSC = 0, surSC = 0;
        if (sc) {
          const r = lnSC[t - 1], distSC = (t > p.dj ? NSC : 0) * Prev * p.dist / 12, I = r ? r.interets + r.assurance : 0, y = Math.ceil(t / 12);
          let res = distSC - I, taxSC = 0;
          carrySC = carrySC.filter(x => x.fin >= y);
          if (res < 0) carrySC.push({ montant: -res, fin: y + p.defFoncierAns });
          else { for (const x of carrySC) { const v = Math.min(x.montant, res); x.montant -= v; res -= v; if (res <= EPS) break; } carrySC = carrySC.filter(x => x.montant > EPS); taxSC = Math.max(0, res) * (p.tmi + p.psF); }
          impSC += taxSC;
          const cfSC = distSC - taxSC - (r ? r.echeance + r.assurance : 0);
          eSC = Math.max(0, -cfSC); surSC = Math.max(0, cfSC);
        }
        const b = Math.max(eL, eSC);
        cum += b; budgetMois[t] += b / P;
        potL = potL * gl[t] + (b - eL) + surL(t);
        potS = potS * gl[t] + (b - eL) + (p.reinvestir ? 0 : ndS);
        potAV = potAV * gl[t] + (b - eL);
        if (sc) potSC = potSC * gl[t] + (b - eSC) + surSC;
        if (ki < points.length && t === 12 * points[ki]) {
          const k = points[ki], defl = 1 / Math.pow(1 + pi, t / 12);
          /* L */
          const cession = Vb * (1 - p.revente), anc = k;
          const faPart = loc.regime === "lmnp_reel" ? 0.075 * p.prix : Math.max(p.FA, 0.075 * p.prix);
          let travPart = loc.regime === "nu_reel" ? 0 : p.travaux;
          if (anc > 5) travPart = Math.max(travPart, 0.15 * p.prix);
          const reint = loc.regime === "lmnp_reel" ? loc.amortNMfin[k] : 0;
          const pvL = impotPvImmo(cession - (p.prix + faPart + travPart) + reint, anc, p);
          if (pvL.surtaxe) surtaxe = true;
          const nL = cession - loc.crd[t] - pvL.impot + potL;
          /* S et SC : plus-value par souscription */
          const retS = sumNs * Pr * (1 - p.fs);
          let pvS = 0;
          if (Pr * (1 - p.fs) > minPrA) for (let v = 0; v <= t; v++) { if (!Ns[v] || Pr * (1 - p.fs) <= PrA[v]) continue; pvS += impotPvImmo(Ns[v] * Pr * (1 - p.fs) - Xs[v], Math.floor((t - v) / 12), p).impot; }
          const nS = retS - pvS + potS;
          const vAV = unitsAV * Fav * Pr * (1 - p.fs), xAV = prepsAV.get(k).calculer(vAV, baseAV, dateT(k), undefined), nAV = vAV - xAV.ir - xAV.ps + potAV;
          cour.L[ki][i] = nL; cour.S[ki][i] = nS; cour.AV[ki][i] = nAV;
          net.L[ki][i] = nL * defl; net.S[ki][i] = nS * defl; net.AV[ki][i] = nAV * defl;
          if (sc) {
            const valSC = NSC * Pr * (1 - p.fs), pvSC = impotPvImmo(valSC - XSC, k, p).impot, nSC = valSC - lnCrd(lnSC, t) - pvSC + potSC;
            cour.SC[ki][i] = nSC; net.SC[ki][i] = nSC * defl;
            if (k === points[points.length - 1]) { impots.SC[i] = impSC + pvSC; frais.SC[i] = fraisSC0; }
          }
          budgetCum[ki][i] = cum;
          if (k === points[points.length - 1]) {
            impots.L[i] = loc.impotsCum[k] + pvL.impot; frais.L[i] = p.FA + p.fraisEmprunt + somme([...Array(t).keys()], m => loc.gestion[m + 1]) + Vb * p.revente;
            impots.S[i] = impS + pvS; frais.S[i] = fraisS; impots.AV[i] = xAV.ir + xAV.ps; frais.AV[i] = fraisAV;
          }
          ki++;
        }
      }
    }
    return { P, T, H, points, net, cour, budgetCum, budgetMois, impots, frais, ids, loc, pi, surtaxe, deterministe: det, graine, ctx, bien, scpi, sc };
  }
  const lnCrd = (tab, t) => (t <= 0 ? (tab[0] ? tab[0].crd + tab[0].capital : 0) : tab[t - 1] ? tab[t - 1].crd : 0);

  /** Taux annuel qui égalise des versements mensuels (flux[0..T], négatifs) et une valeur finale à T → % ou null. */
  function triAnnuel(flux, finale) {
    const T = flux.length - 1, f = r => { let s = 0; for (let t = 0; t <= T; t++) s += flux[t] / Math.pow(1 + r, t); return s + finale / Math.pow(1 + r, T); };
    let lo = -0.04, hi = 0.04, a = f(lo), b = f(hi);
    if (!(a * b < 0)) return null;
    for (let k = 0; k < 100; k++) { const m = (lo + hi) / 2, v = f(m); if (v * a > 0) { lo = m; a = v; } else hi = m; }
    return r2((Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100);
  }

  function locatifScpi(c) {
    const { today, o, rep } = c;
    const p = parametresLocatif(c), pre = { chemins: o.chemins, graine: o.graine, volatilite: o.volatilite, hypotheses_classes: o.hypotheses_classes };
    const sim = simulerLocatifScpi(c, p, pre), H = sim.H, kT = sim.points.length - 1;
    const libL = LIB_LS.L + " (" + REGIMES_LOCATIF[sim.loc.regime] + ")", lib = id => (id === "L" ? libL : LIB_LS[id]);
    const q50 = a => quantile(a, 0.5);
    /* options au mois T */
    const options = sim.ids.map(id => Object.assign(sortieOption(id, lib(id), id === "L" ? ["bien_locatif"] : id === "AV" ? ["assurance_vie"] : ["scpi_direct"], {
      net: sim.net[id][kT], courants: sim.cour[id][kT], brut: sim.cour[id][kT], impots: sim.impots[id], ps: new Float64Array(sim.P), frais: sim.frais[id], base: q50(sim.budgetCum[kT]) }), { role: id === "L" ? "locatif" : "scpi" }));
    const p50 = id => q50(sim.net[id][kT]), ordre = sim.ids.slice().sort((a, b) => p50(b) - p50(a)), tete = ordre[0], second = ordre[1];
    const ecartK = (a, b, k) => { const A = sim.net[a][k], B = sim.net[b][k], dl = new Float64Array(sim.P), dc = new Float64Array(sim.P); let mieux = 0;
      for (let i = 0; i < sim.P; i++) { dl[i] = A[i] - B[i]; dc[i] = sim.cour[a][k][i] - sim.cour[b][k][i]; if (dl[i] > 1e-7) mieux++; }
      return { delta: dl, courants: dc, p10: quantile(dl, 0.1), p50: quantile(dl, 0.5), p90: quantile(dl, 0.9), probabilite_mieux: mieux / sim.P }; };
    const e = ecartK(tete, second, kT), enjeu = parAn(e, H);
    /* date de bascule : premier anniversaire à partir duquel la médiane de l'écart reste positive */
    let bascule = null;
    for (let k = kT; k >= 0; k--) { if (quantile(ecartK(tete, second, k).courants, 0.5) > 1e-6) bascule = O.ajouterMois(today, 12 * sim.points[k]); else break; }
    /* TRI médian : budget médian versé chaque mois, patrimoine net médian à la sortie */
    const flux = [-p.A0].concat([...Array(sim.T).keys()].map(t => -sim.budgetMois[t + 1]));
    const tri = Object.fromEntries(sim.ids.map(id => [id, triAnnuel(flux, q50(sim.cour[id][kT]))]));
    /* patrimoine par anniversaire (graphique) */
    const patrimoine = { points: sim.points.map((k, j) => ({ t: 12 * k, date: O.ajouterMois(today, 12 * k), options: Object.fromEntries(sim.ids.map(id => [id, bandeR(sim.net[id][j])])) })) };
    const courbe = { abscisse: "date_sortie", points: sim.points.map((k, j) => { const x = ecartK(tete, second, j), b = bandeR(x.delta); return { t: 12 * k, date: O.ajouterMois(today, 12 * k), p10: b.p10, p50: b.p50, p90: b.p90, courants_p50: r2(quantile(x.courants, 0.5)) }; }) };
    /* ce qui changerait la réponse (mêmes tirages, sortie à T seulement) */
    const ctq = [], avert = sim.loc.avertissements.slice();
    const meilleureScpi = sim.ids.filter(id => id !== "L").sort((a, b) => p50(b) - p50(a))[0];
    const ecartLs = (sur, surClasses) => { const s2 = simulerLocatifScpi(c, parametresLocatif(c, sur), Object.assign({}, pre, { fin_seule: true, sur_classes: surClasses, sous_chemins: 500 })); return quantile(Array.from(s2.net.L[0], (v, i) => v - s2.net[meilleureScpi][0][i]), 0.5); };
    const locDevant = q50(sim.net.L[kT]) >= p50(meilleureScpi), libS = PH_LS[meilleureScpi];
    if (!o.enjeu) {
      const pi = sim.pi, reval = c.L.v("immo_revalorisation_reelle");
      const fr = x => ecartLs(null, { immobilier_physique: { rendement: ((1 + pi) * (1 + x / 100) - 1) * 100 } });
      const sr = seuilDichotomie(x => -fr(x), -3, 3, 12);
      if (sr.etat === "ok") ctq.push(ligne("revalorisation_bien", O.frc(reval || 0, 1) + " %/an au-delà de l'inflation", O.frc(sr.x, 2) + " %/an", locDevant ? "En dessous, " + libS + " passent devant" : "Au-dessus, le bien locatif passe devant",
        (locDevant ? "Si le prix du bien progresse de moins de " : "Si le prix du bien progresse de plus de ") + O.frc(sr.x, 2) + " % par an au-delà de l'inflation, " + (locDevant ? libS + " font mieux" : "le bien locatif fait mieux") + " (les autres hypothèses restent les mêmes)."));
      const sd = seuilDichotomie(x => ecartLs({ dist: x }), 0, 10, 12);
      if (sd.etat === "ok") ctq.push(ligne("taux_distribution", O.frc(p.dist * 100, 2) + " %", O.frc(sd.x, 2) + " %", locDevant ? "Au-dessus, les SCPI passent devant" : "En dessous, le bien locatif passe devant",
        (locDevant ? "Si les SCPI distribuent plus de " : "Si les SCPI distribuent moins de ") + O.frc(sd.x, 2) + " % par an, " + (locDevant ? "elles font mieux que le bien locatif." : "le bien locatif fait mieux.")));
      const sv = seuilDichotomie(x => ecartLs({ vacance: x }), 0, 6, 12);
      if (sv.etat === "ok") ctq.push(ligne("vacance", O.frc(p.vacance, 1) + " mois/an", O.frc(sv.x, 1) + " mois/an", locDevant ? "Au-delà, le bien locatif passe derrière" : "En dessous, le bien locatif passe devant",
        (locDevant ? "Si ton bien reste vide plus de " : "Si ton bien reste vide moins de ") + O.frc(sv.x, 1) + " mois par an en moyenne, " + (locDevant ? libS + " font mieux." : "le bien locatif fait mieux.")));
      if (bascule && bascule > today) ctq.push(ligne("horizon", ans(H), dateFr(bascule), "Avant cette date, l'ordre s'inverse",
        "Si tu revends ou retires avant le " + dateFr(bascule) + ", " + PH_LS[tete] + (tete === "L" ? " ne fait" : " ne font") + " pas mieux " + que(PH_LS[second]) + " : les frais d'entrée ne sont pas encore amortis."));
    }
    /* avertissements dits */
    if (p.meuble && !(p.mobilier > 0)) avert.push("En meublé, le mobilier est à compter (souvent quelques milliers d'euros) : il est à 0 dans ce calcul.");
    if (!p.meuble && +rep.mobilier > 0) avert.push("En location nue, le mobilier n'est pas compté.");
    if (sim.loc.regime === "nu_reel" && sim.loc.annees.some(a => a.impute_revenu_global > 0)) avert.push("Le déficit foncier imputé sur ton revenu global suppose que le bien reste loué jusqu'au 31 décembre de la 3ᵉ année qui suit.");
    if (sim.loc.regime === "lmnp_reel") avert.push("À la revente, les amortissements du bâti et des travaux déduits sont ajoutés à la plus-value (cessions depuis le 15/02/2025), sauf pour certaines résidences de services (étudiants, seniors).");
    if (sim.surtaxe) avert.push("Ta plus-value immobilière dépasse " + O.eur(p.surtaxe) + " : une surtaxe s'ajoute, elle n'est pas calculée ici.");
    avert.push("SCPI : les revenus étrangers ne sont pas distingués (tout est imposé comme des revenus fonciers français, ce qui pénalise un peu les SCPI) ; plus-value des parts : " + F.MENTION_SCPI + ".");
    avert.push("Les travaux ne sont pas ajoutés à la valeur du bien (prudent) ; les loyers et les charges suivent l'inflation supposée.");
    if (c.frais.inconnus.includes("assurance_vie_pct") && !nombre(rep.frais_av_pct)) avert.push("Frais de l'assurance-vie non renseignés : comptés à 0 %, ce qui avantage l'option en assurance-vie ; renseigne-les pour un chiffre complet.");
    const enTete = Math.abs(e.p50) < 0.005 ? "egalite" : tete;
    const phrase = Math.abs(e.p50) < 0.005 ? "Sur " + ans(H) + ", à effort égal, " + PH_LS[tete] + " et " + PH_LS[second] + " font jeu égal avec ces hypothèses."
      : (tete === "L" ? "Sur " + ans(H) + ", à effort égal, le bien locatif (" + REGIMES_LOCATIF[sim.loc.regime] + ") te laisserait environ "
        : "Sur " + ans(H) + ", à effort égal, " + PH_LS[tete] + " te laisseraient environ ") + eur0(e.p50) + " de plus " + que(PH_LS[second]) + ", en euros d'aujourd'hui.";
    const reponse = { phrase, option_en_tete: enTete, reference: second, ecart: ecartBandes(e), ecart_annuel: enjeu, probabilite_mieux: p3(e.probabilite_mieux), date_bascule: bascule };
    return {
      options, reponse, courbe, ce_qui_changerait: ctq, avertissements: avert,
      enjeu_annuel: { p10: Math.min(enjeu.p10, enjeu.p50), p50: Math.max(0, enjeu.p50), p90: Math.max(enjeu.p90, enjeu.p50) }, sim: null,
      detail: { T: sim.T, regime: sim.loc.regime, credit: { capital: r2(p.C), mensualite: r2(sim.loc.ech[1] + sim.loc.ass[1]), duree_ans: p.duree, taux_pct: p.taux, frais_emprunt: r2(p.fraisEmprunt) },
        cout_total: r2(p.K), apport_utilise: r2(p.A0), frais_acquisition: r2(p.FA), effort_mensuel_an1: r2(somme([...Array(12).keys()], k => Math.max(0, -sim.loc.cf[k + 1])) / 12),
        locatif_annees: sim.loc.annees, stock_amortissements: sim.loc.stock_amortissements, tri, patrimoine, verse_p50: r2(quantile(sim.budgetCum[kT], 0.5)), ecart_courants: r2(quantile(e.courants, 0.5)) },
      plan: { tete, reference: second, plan: null, titulaire: c.titulaire },
      retenables: { options: {}, non: Object.fromEntries(sim.ids.map(id => [id, NON_RETENABLE_IMMO])) },
    };
  }

  const CALCULS = { ouvrirPea, prochainEuro, perInteret, matelas, avMaintenant, locatifScpi };
  /** Repères lus par un calcul en plus de ceux que déclare l'entrée du catalogue : un repère absent rend le scénario indisponible (jamais NaN, jamais de valeur de secours). */
  const REPERES_CALCUL = {
    ouvrirPea: ["scn_delai_ouverture_mois", "pea_plafond", "pea_duree_ans"],
    prochainEuro: ["scn_delai_ouverture_mois", "pea_plafond", "pea_duree_ans", "per_plafond_plancher"],
    perInteret: ["scn_delai_ouverture_mois", "per_plafond_plancher"],
    matelas: ["scn_delai_ouverture_mois", "scn_matelas_mois_stable", "scn_matelas_mois_fragile", "scn_matelas_mois_independant", "lep_plafond", "livret_a_plafond", "ldds_plafond", "lep_taux", "livret_a_taux"],
    avMaintenant: ["scn_delai_ouverture_mois", "av_duree_ans"],
    locatifScpi: ["frais_acquisition_ancien_pct", "frais_acquisition_neuf_pct", "garantie_pct", "frais_dossier", "assurance_emprunteur_defaut_pct", "ps_taux_foncier", "ps_taux_general",
      "pv_immo_ir_taux", "pv_immo_ps_taux", "pv_immo_surtaxe_seuil", "micro_foncier_plafond", "micro_foncier_abattement_pct", "micro_bic_plafond", "micro_bic_abattement_pct",
      "deficit_foncier_plafond", "deficit_foncier_report_ans", "deficit_bic_report_ans", "scn_lmnp_part_terrain_pct", "scn_lmnp_duree_bati_ans", "scn_lmnp_duree_travaux_ans",
      "scn_lmnp_duree_mobilier_ans", "scn_immo_frais_revente_pct", "scn_scpi_delai_jouissance_mois", "inflation_hypothese", "immo_revalorisation_reelle", "immo_volatilite",
      "rendement_central_monetaire", "rendement_central_immobilier", "scpi_taux_distribution", "ir_taux_forfaitaire", "ps_taux_av_epargne_logement", "av_duree_ans",
      "av_taux_ir_reduit", "av_seuil_versements", "av_abattement_seul", "av_abattement_couple"],
  };
  const reperesRequis = entree => [...new Set(liste(entree.reperes).concat(REPERES_CALCUL[entree.calcul] || []))];

  /* ================================================================== pertinence (§ 6.4) */
  const deNom = n => (/^[aeiouyéèh]/i.test(n) ? "d'" : "de ") + n;
  /** Évalue les règles de pertinence d'une entrée du catalogue pour une personne : { ok, raisons, manquants }. Une clé inconnue lève une erreur (test du catalogue). */
  function evaluerRegles(regles, k, p) {
    const out = { ok: true, raisons: [], manquants: [] };
    const ilA = (neg, quoi) => (k.fo.personnes.length <= 1 ? (neg ? "Tu n'as pas " : "Tu as ") : p.nom + (neg ? " n'a pas " : " a ")) + quoi;
    const non = (raison) => { out.ok = false; if (raison) out.raisons = []; };
    const oui = raison => { if (raison) out.raisons.push(raison); };
    Object.keys(objet(regles)).forEach(cle => {
      if (!out.ok) return;
      const v = regles[cle];
      switch (cle) {
        case "toujours": if (v !== true) non(); break;
        case "sans_enveloppe": {
          const manque = liste(v).filter(t => !detient(k.fo, p.id, famillesTypes[t] || [t]));
          if (manque.length === liste(v).length) manque.forEach(t => oui(ilA(true, deNom(nomEnveloppe[t] || t)))); else non();
          break;
        }
        case "avec_enveloppe": {
          const ont = liste(v).filter(t => detient(k.fo, p.id, famillesTypes[t] || [t]));
          if (ont.length) ont.forEach(t => oui(ilA(false, "un " + (nomEnveloppe[t] || t)))); else non();
          break;
        }
        case "capacite_min": if (k.cap >= v) oui("Environ " + O.eur(Math.round(k.cap)) + " par mois de capacité d'épargne"); else non(); break;
        case "tmi_min":
          if (k.tmi == null) { out.manquants.push({ champ: "tmi", libelle: "Ta tranche d'imposition", comment: "Elle figure sur ton avis d'impôt." }); oui("Ta tranche d'imposition n'est pas encore connue"); }
          else if (k.tmi >= v) oui("Tranche d'imposition de " + k.tmi + " %"); else non();
          break;
        case "age_min": case "age_max":
          if (p.age == null) { out.manquants.push({ champ: "naissance", libelle: "Ta date de naissance", comment: "Elle sert à l'âge exigé." }); break; }
          if ((cle === "age_min" && p.age < v) || (cle === "age_max" && p.age > v)) non(); break;
        case "age_sous_repere": {
          const limite = k.L.v(v);
          if (limite === undefined) { non(); break; }
          if (p.age == null) { out.manquants.push({ champ: "naissance", libelle: "Ta date de naissance", comment: "Elle sert à l'âge exigé." }); break; }
          if (p.age >= limite) non(); break;
        }
        case "revenus_activite": {
          const a = k.fo.personnes.some(x => x.salaire != null), rev = objet(objet(k.d.risque).reponses).revenus;
          const actif = a ? p.salaire > 0 : (rev != null && rev !== "sans");
          if (actif) oui("Un revenu d'activité"); else non();
          break;
        }
        case "surplus_matelas": { const E = k.matelas(); if (E.dep && E.surplus > EPS) oui("Environ " + eur0(E.surplus) + " au-delà de ta cible de précaution"); else non(); break; }
        case "matelas_ecart_pct": {
          const E = k.matelas();
          if (!E.dep) { out.manquants.push({ champ: "depenses_essentielles", libelle: "Tes dépenses essentielles", comment: "Elles viennent de ton budget." }); non(); break; }
          const sous = E.actuel < E.cible * (1 - v / 100), sur = E.actuel > E.cible * (1 + v / 100);
          if (sous) oui("Ton épargne de précaution est sous ta cible de " + eur0(E.cible)); else if (sur) oui("Ton épargne de précaution dépasse ta cible de " + eur0(E.cible)); else non();
          break;
        }
        case "lep_possible_non_detenu": {
          const lep = k.lep();
          if (lep.eligible === true && !k.fo.enveloppes.some(e => e.type === "lep")) oui("Tu peux ouvrir un LEP, plus rémunéré qu'un Livret A"); else non();
          break;
        }
        case "un_de": {
          const sous = liste(v).map(r => evaluerRegles(r, k, p)), ok = sous.find(x => x.ok);
          if (ok) { ok.raisons.forEach(r => oui(r)); ok.manquants.forEach(m => out.manquants.push(m)); } else non();
          break;
        }
        case "pour_toi_si": break;                       // lu par lister, pas par la pertinence
        default: throw new Error("règle de pertinence inconnue : « " + cle + " »");
      }
    });
    if (!out.ok) { out.raisons = []; }
    return out;
  }
  /** Pertinence d'un scénario pour le foyer : → { pertinent, personnes, raisons, manquants }. */
  function pertinence(entree, data, today, opts) {
    const d = Object.assign({}, data, { today }), L = lecteur(d), fo = foyer(d, today), o = opts || {};
    let memoE = null, memoL = null;
    const k = { d, L, fo, tmi: tmiDe(d), cap: capaciteDe(d),
      matelas: () => memoE || (memoE = etatMatelas(d, today, L.v, o, null)),
      lep: () => memoL || (memoL = eligibiliteLep(d, today, L.v, null)) };
    const pers = fo.personnes.length ? fo.personnes : [{ id: "p1", nom: "Toi", age: null, salaire: null }];
    const raisons = [], manquants = [], ok = [];
    pers.forEach(p => {
      const r = evaluerRegles(entree.pertinence, k, p);
      if (!r.ok) return;
      ok.push(p.id);
      r.raisons.forEach(x => { if (!raisons.includes(x)) raisons.push(x); });
      r.manquants.forEach(m => { if (!manquants.some(y => y.champ === m.champ)) manquants.push(m); });
    });
    return { pertinent: ok.length > 0, personnes: ok, raisons: ok.length ? raisons : [], manquants: ok.length ? manquants : [] };
  }
  /** Le scénario entre-t-il dans « Pour toi » ? (règle pour_toi_si du catalogue ; absente : oui) */
  function pourToiSi(entree, data, today, opts) {
    const r = objet(entree.pertinence).pour_toi_si;
    if (!r) return true;
    const d = Object.assign({}, data, { today }), L = lecteur(d), fo = foyer(d, today), o = opts || {};
    let memoE = null;
    const k = { d, L, fo, tmi: tmiDe(d), cap: capaciteDe(d), matelas: () => memoE || (memoE = etatMatelas(d, today, L.v, o, null)),
      lep: () => eligibiliteLep(d, today, L.v, null) };
    const p = fo.personnes[0] || { id: "p1", nom: "Toi", age: null, salaire: null };
    return evaluerRegles(r, k, p).ok;
  }

  /* ================================================================== jouer, enjeu, lister */
  /** Questions obligatoires selon les réponses : celles du catalogue, plus celles que le scénario rend nécessaires. */
  function questionsRequises(entree, rep, o) {
    const ids = liste(entree.questions).filter(q => q.obligatoire).map(q => q.id);
    if (entree.calcul === "ouvrirPea" && rep.debut === "plus_tard") ids.push("debut_date");
    if (entree.calcul === "prochainEuro" && rep.retrait_avant === false && !o.enjeu) ids.push("tmi_retraite_pct", "date_retraite");
    return [...new Set(ids)];
  }
  const manquantQuestion = q => ({ champ: q.id, question_id: q.id, libelle: q.libelle, comment: q.aide || "Réponds à cette question." });

  /** Joue un scénario : calcule la réponse sur les données et les réponses (le serveur recalcule tout, jamais de chiffre venu du LLM). → résultat (§ 6.7). */
  function jouer(entree, data, reponses, today, opts) {
    const o = opts || {}, d = Object.assign({}, data, { today }), L = lecteur(d), det = o.volatilite === 0;
    const base = { cle: entree.cle, version: entree.version == null ? null : entree.version, version_calcul: entree.version_calcul || VERSION_CALCUL, version_modele: Proj.versionModele,
      graine: o.graine == null ? Proj.GRAINE : o.graine, chemins: det ? 1 : Math.round(o.chemins || 2000), date: today, rappel: RAPPEL };
    const requis = reperesRequis(entree);
    const hypotheses = () => requis.filter(cle => L.idx[cle]).map(cle => hypotheseDe(L.idx[cle], today));
    const absents = requis.filter(cle => !L.idx[cle]);
    if (absents.length) return Object.assign(base, { statut: "indisponible", reperes_manquants: absents, manquants: [], hypotheses: hypotheses(),
      avertissements: ["Un repère nécessaire à ce calcul manque (" + absents.join(", ") + ") : aucun chiffre n'est donné plutôt qu'une valeur de remplacement."] });
    const erreurs = reponsesValides(entree, reponses);
    if (erreurs) throw new Error("réponses invalides : " + erreurs.join(" ; "));
    const donnees = Object.fromEntries(Object.entries(objet(reponses)).filter(([, v]) => v !== null && v !== undefined));
    const rep = Object.assign({}, preremplir(entree, d, today, o), donnees);
    const qs = Object.fromEntries(liste(entree.questions).map(q => [q.id, q]));
    const manquants = questionsRequises(entree, rep, o).filter(id => rep[id] === undefined).map(id => manquantQuestion(qs[id]));
    if (manquants.length) return Object.assign(base, { statut: "a_completer", manquants, hypotheses: hypotheses(), avertissements: [] });
    const calc = CALCULS[entree.calcul];
    if (!calc) throw new Error("calcul inconnu : « " + entree.calcul + " »");
    const fo = foyer(d, today), frais = fraisDe(d, o, rep), pe = pertinence(entree, d, today, o);
    if (entree.calcul === "matelas" && !depensesReference(d, today, o)) {
      return Object.assign(base, { statut: "a_completer", manquants: [{ champ: "depenses_essentielles", libelle: "Tes dépenses essentielles", comment: "Elles viennent de ton budget : demande à Claude de le compléter." }], hypotheses: hypotheses(), avertissements: [] });
    }
    const r = calc({ entree, d, today, rep, L, o, fo, frais, titulaire: pe.personnes[0] || "p1" });
    if (r.statut === "indisponible") return Object.assign(base, { statut: "indisponible", reperes_manquants: r.reperes_manquants, manquants: [], hypotheses: hypotheses(), avertissements: ["Un repère nécessaire à ce calcul manque (" + r.reperes_manquants.join(", ") + ") : aucun chiffre n'est donné plutôt qu'une valeur de remplacement."] });
    if (r.statut === "a_completer") return Object.assign(base, { statut: "a_completer", manquants: r.manquants, hypotheses: hypotheses(), avertissements: [] });
    const hyp = hypotheses(), avert = r.avertissements.slice();
    /* règles fiscales appliquées faute de donnée (date d'ouverture d'une enveloppe existante) : dites, jamais tues */
    liste(r.sim && r.sim.mentions).forEach(x => {
      const qui = x.libelle || nomEnveloppe[x.type === "capitalisation" ? "assurance_vie" : x.type] || x.type, t = qui.charAt(0).toUpperCase() + qui.slice(1) + " : " + x.texte + ".";
      if (!avert.includes(t)) avert.push(t);
    });
    /* l'abattement de l'assurance-vie après 8 ans est compté en entier pour cet argent (hypothèse du calcul « à la marge ») : dit */
    if (r.sim && r.sim.abattement_av_utilise) {
      const ab = fo.couple ? L.v("av_abattement_couple") : L.v("av_abattement_seul");
      avert.push("L'abattement annuel de l'assurance-vie (" + O.eur(ab) + (fo.couple ? " pour un couple imposé ensemble" : "") + ") est compté en entier pour cet argent : il vaut pour l'ensemble de tes contrats, donc il est plus faible si tu retires aussi d'un autre contrat la même année.");
    }
    hyp.filter(h => h.statut === "a_reverifier").forEach(h => avert.push("Le repère « " + h.libelle + " » est à revérifier" + (h.date_fin && h.date_fin < today ? " (la période s'est terminée le " + dateFr(h.date_fin) + ")" : " (vérifié le " + dateFr(h.source.verifie_le) + ")") + " : le chiffre est donné avec cette valeur."));
    const utilisees = liste(entree.questions).filter(q => rep[q.id] !== undefined).map(q => ({ champ: q.id, libelle: q.libelle, valeur: rep[q.id], origine: donnees[q.id] !== undefined ? "reponse" : "boussole", le: today }));
    const opts_ = r.options.map(o => {
      const rt = r.retenables || { options: {}, non: {} }, h = rt.options[o.id];
      if (h && h.hypothese) return Object.assign({}, o, { retenable: true, enveloppe_scenario: h.hypothese });
      return Object.assign({}, o, { retenable: false, raison_non_retenable: h ? h.erreur : (rt.non[o.id] || (o.exclue ? "Cette option est écartée pour ta situation." : "Cette option ne se retient pas.")) });
    });
    const out = Object.assign(base, { statut: "ok", manquants: [], reponse: r.reponse, options: opts_, ce_qui_changerait: r.ce_qui_changerait, hypotheses: hyp, donnees_utilisees: utilisees,
      avertissements: avert, enjeu_annuel: r.enjeu_annuel, detail: r.detail, titulaire: r.plan && r.plan.titulaire || null });
    if (r.courbe) out.courbe = r.courbe;
    Object.defineProperty(out, "_calcul", { value: { sim: r.sim, plan: r.plan, rep }, enumerable: false });
    return out;
  }

  /** Variante figée d'une option retenue : { nom, description, hypotheses: { enveloppe_scenario } }, de la forme validée par Evenements.validerVariante (le moteur la rejoue, proj-1.3.0).
      Lève une erreur claire si l'option ne se retient pas (référence, plusieurs enveloppes, écartée). */
  function varianteRetenue(entree, resultat, option_id) {
    const o = liste(resultat && resultat.options).find(x => x.id === option_id);
    if (!o) throw new Error("option inconnue : « " + option_id + " »");
    if (!o.retenable || !o.enveloppe_scenario) throw new Error("cette option ne se retient pas : " + (o.raison_non_retenable || "elle n'est pas une variante de projection"));
    const coupe = (t, n) => (t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…");
    const nom = coupe("Scénario " + (entree.numero != null ? entree.numero : entree.cle) + " : " + o.libelle, 40);
    const description = coupe("Retenu depuis « " + entree.question + " » le " + dateFr(resultat.date) + " (calcul " + resultat.version_calcul + "). " + (resultat.reponse ? resultat.reponse.phrase : ""), 300);
    const v = { nom, description, hypotheses: { enveloppe_scenario: copie(o.enveloppe_scenario) } };
    const msg = E.validerVariante(v);
    if (msg) throw new Error("variante invalide : " + msg);
    return v;
  }

  /** Enjeu annuel d'un scénario pour la personne, sur ses seules données (réponses préremplies) : { p10, p50, p90, unite, statut, raison? }. */
  function enjeu(entree, data, today, opts) {
    const o = Object.assign({}, opts || {}), reponses = o.reponses || {};
    delete o.reponses;
    const r = jouer(entree, data, reponses, today, Object.assign({ chemins: 500 }, o, { enjeu: true }));
    if (r.statut === "ok") return { p10: r.enjeu_annuel.p10, p50: r.enjeu_annuel.p50, p90: r.enjeu_annuel.p90, unite: UNITE_ENJEU, statut: "ok", avertissements: r.avertissements.slice() };
    const vide = { p10: null, p50: null, p90: null, unite: UNITE_ENJEU };
    if (r.statut === "a_completer") return Object.assign(vide, { statut: "a_completer", raison: "Il manque : " + r.manquants.map(m => m.libelle.toLowerCase()).join(", ") });
    return Object.assign(vide, { statut: "indisponible", raison: r.avertissements[0] });
  }

  /** Les cartes qui entrent dans « Pour toi » : pertinentes, non écartées, au-dessus du seuil d'enjeu, par enjeu décroissant, trois au plus. */
  function pourToi(cartes, seuil) {
    const s = seuil == null ? SEUIL_ENJEU_DEFAUT : seuil;
    const ok = liste(cartes).filter(c => c.pertinent && c.etat !== "ecarte" && c.pour_toi_si !== false && nombre(c.enjeu_p50) && c.enjeu_p50 >= s).sort((a, b) => b.enjeu_p50 - a.enjeu_p50).slice(0, 3);
    return { cles: ok.map(c => c.cle), message: ok.length ? null : MESSAGE_RIEN_URGENT };
  }

  /** Cartes du catalogue pour la personne, tri « pour toi » et regroupement par thème.
      joues = [{ scenario_cle, etat, joue_le }] (parties de la personne) ; opts.reponses_par_cle = { cle: réponses } pour calculer l'enjeu sur des réponses données. */
  function lister(catalogue, data, joues, today, opts) {
    const o = opts || {}, L = lecteur(Object.assign({}, data, { today })), seuil = L.v("scn_enjeu_min_eur_an");
    const derniere = {};
    liste(joues).forEach(j => { if (!derniere[j.scenario_cle] || String(j.joue_le || "") >= String(derniere[j.scenario_cle].joue_le || "")) derniere[j.scenario_cle] = j; });
    const cartes = liste(catalogue).map(e => {
      const pe = pertinence(e, data, today, o), j = derniere[e.cle];
      const carte = { cle: e.cle, numero: e.numero, theme: e.theme, question: e.question, pertinent: pe.pertinent, pourquoi: pe.raisons, manquants: pe.manquants.slice(), enjeu: null, enjeu_p50: null, enjeu_statut: pe.pertinent ? "a_completer" : null,
        etat: j ? j.etat : "a_explorer", joue_le: j ? j.joue_le || null : null, version: e.version == null ? null : e.version, reperes_a_reverifier: [], pour_toi_si: true, avertissements: [] };
      if (!pe.pertinent) return carte;
      const ej = enjeu(e, data, today, Object.assign({}, o, { reponses: objet(o.reponses_par_cle)[e.cle] }));
      carte.enjeu_statut = ej.statut;
      if (ej.statut === "ok") { carte.enjeu = { p10: ej.p10, p50: ej.p50, p90: ej.p90 }; carte.enjeu_p50 = ej.p50; carte.avertissements = ej.avertissements; }
      else if (ej.raison) carte.raison_enjeu = ej.raison;
      carte.reperes_a_reverifier = reperesRequis(e).filter(cle => L.idx[cle] && statutRepere(L.idx[cle], today) === "a_reverifier");
      carte.pour_toi_si = pourToiSi(e, data, today, o);
      return carte;
    });
    const choix = pourToi(cartes, seuil === undefined ? SEUIL_ENJEU_DEFAUT : seuil);
    const parTheme = {};
    THEMES.forEach(t => {
      const l = cartes.filter(c => c.theme === t);
      if (l.length) parTheme[t] = l.slice().sort((a, b) => (a.etat === "ecarte") - (b.etat === "ecarte") || (b.enjeu_p50 == null ? -1 : b.enjeu_p50) - (a.enjeu_p50 == null ? -1 : a.enjeu_p50) || a.numero - b.numero);
    });
    return { pour_toi: choix.cles, message: choix.message, par_theme: parTheme, cartes };
  }

  return {
    VERSION_CALCUL, THEMES, CALCULS, RAPPEL, MESSAGE_RIEN_URGENT, UNITE_ENJEU,
    simulerEnveloppes, jouer, enjeu, lister, pertinence, pourToi, pourToiSi, reponsesValides, preremplir, varianteRetenue,
    seuilDichotomie, versementPer, repartirPlafond, plafondRfrLep, imputerPlafondsPer, economiePer, plafondPer,
    tirer, bande, statutRepere, lireEssentiels, CHAMP_ESSENTIELS,
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
export const Scenarios = charger("scenarios");
