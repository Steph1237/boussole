/* État du bilan : ce qui est renseigné, ce qui manque et les prochaines questions à poser, section par section,
   dans l'ordre d'un entretien. Utilisé par l'app (jauge, page « Avec Claude ») et porté dans le connecteur MCP
   (outil etat_du_bilan) pour que Claude ne repose jamais une question déjà répondue. Fonctions pures. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BilanEtat = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const has = v => v !== undefined && v !== null && v !== "";
  const num = v => (isFinite(+v) ? +v : 0);
  const jours = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const FRAICHEUR_JOURS = 90;
  /* Identifiants des questions du profil de risque (identiques à web/src/risque.js). */
  const RISQUE_IDS = ["horizon", "objectif", "reaction", "perte_max", "connaissances", "experience", "revenus", "matelas", "part_investie", "age"];
  const RISQUE_LIBELLES = {
    horizon: "Dans combien de temps aurez-vous besoin de la majeure partie de cet argent ?",
    objectif: "Que cherchez-vous d'abord : préserver, compléter vos revenus, faire croître ?",
    reaction: "Si votre portefeuille perdait 20 % en 3 mois, que feriez-vous ?",
    perte_max: "Quelle baisse temporaire sur un an pourriez-vous supporter sans vendre ?",
    connaissances: "Quels placements connaissez-vous bien (livrets, fonds euros, ETF, actions, obligations, crypto) ?",
    experience: "Depuis combien d'années investissez-vous en bourse ?",
    revenus: "Vos revenus sont-ils stables (fonctionnaire, CDI, indépendant, variables) ?",
    matelas: "Avez-vous au moins 3 mois de dépenses disponibles hors placements ?",
    part_investie: "Quelle part de votre épargne acceptez-vous d'exposer aux marchés ?",
    age: "Quelle est votre tranche d'âge ?",
  };

  const q = (champ, question, pourquoi) => ({ champ, question, pourquoi });
  const nomDe = (pr, k) => (pr && pr.personnes && pr.personnes[k] && String(pr.personnes[k].nom || "").trim()) || (k === "p1" ? "vous" : "votre conjoint(e)");

  function sections(S, today) {
    const pr = S.profil || null, f = (pr && pr.foyer) || {}, ps = (pr && pr.personnes) || {};
    const deux = num(f.adultes) >= 2;
    const out = [];

    // 1. Foyer
    const foyer = [];
    if (!has(f.adultes)) foyer.push(q("foyer.adultes", "Combien d'adultes composent votre foyer ?", "Le niveau de vie et l'impôt dépendent de la taille du foyer."));
    if (!has(f.enfants)) foyer.push(q("foyer.enfants", "Avez-vous des enfants à charge ?", "Ils comptent dans l'impôt, le budget et la protection à prévoir."));
    if (!has(f.age)) foyer.push(q("foyer.age", "Quelle est la tranche d'âge de la personne qui gagne le plus ?", "L'horizon de placement et les repères de patrimoine dépendent de l'âge."));
    if (!has(f.tmi)) foyer.push(q("foyer.tmi", "Quelle est votre tranche marginale d'imposition (0, 11, 30, 41 ou 45 %) ?", "Elle détermine l'intérêt du PER et la fiscalité de vos placements."));
    out.push({ cle: "foyer", titre: "Foyer", total: 4, manquants: foyer });

    // 2. Revenus
    const rev = [];
    ["p1"].concat(deux ? ["p2"] : []).forEach(k => {
      const p = ps[k] || {};
      if (!(num(p.salaire) > 0)) rev.push(q("personnes." + k + ".salaire", "Quel est le salaire de " + nomDe(pr, k) + " (net ou brut, par mois ou par an) ?", "C'est la base du taux d'épargne, de l'endettement et de la capacité d'emprunt."));
      if (!has(p.statut)) rev.push(q("personnes." + k + ".statut", nomDe(pr, k) + " est-il cadre ou non-cadre ?", "Utile pour convertir un salaire brut en net."));
    });
    out.push({ cle: "revenus", titre: "Revenus", total: deux ? 4 : 2, manquants: rev });

    // 3. Budget
    const lignes = (S.budget && Array.isArray(S.budget.lignes)) ? S.budget.lignes : [];
    const bud = [];
    if (!lignes.some(l => l.type === "depense")) bud.push(q("budget.depenses", "Quelles sont vos principales dépenses mensuelles (logement, courses, transport, abonnements…) ? Un relevé bancaire collé suffit.", "Sans dépenses, impossible de mesurer votre matelas en mois et votre taux d'épargne."));
    if (!lignes.some(l => l.type === "epargne")) bud.push(q("budget.epargne", "Combien mettez-vous de côté chaque mois, et où ?", "L'épargne régulière alimente vos objectifs et vos projections."));
    out.push({ cle: "budget", titre: "Budget", total: 2, manquants: bud });

    // 4. Épargne et placements
    const pos = (S.positions || []).filter(p => p.status !== "clôturé");
    const plac = [];
    if (!pos.length) plac.push(q("positions", "Quels sont vos comptes et placements (livrets, PEA, assurance-vie, PER, compte-titres, crypto) et leurs montants ?", "C'est le cœur du bilan : répartition, risque et diversification en découlent."));
    else {
      const vieux = pos.filter(p => {
        const d = p.mode === "market" ? p.priceDate : p.valueDate;
        return p.status !== "à recevoir" && (!d || jours(d, today) > FRAICHEUR_JOURS);
      });
      const envs = [...new Set(vieux.map(p => p.envelope || p.name))];
      if (envs.length) plac.push(q("positions.fraicheur", "Pouvez-vous me donner le solde à jour de : " + envs.join(", ") + " ?", "Ces montants datent de plus de " + FRAICHEUR_JOURS + " jours."));
    }
    // Deux étapes : avoir déclaré ses placements, puis des montants à jour.
    out.push({ cle: "placements", titre: "Épargne et placements", total: 2, faits: !pos.length ? 0 : plac.length ? 1 : 2, manquants: plac });

    // 5. Immobilier et crédits
    const immo = [];
    const biens = (pr && Array.isArray(pr.biens)) ? pr.biens : [];
    if (!biens.length && !(pr && pr.biensRenseignes)) immo.push(q("biens", "Êtes-vous propriétaire d'un ou plusieurs biens immobiliers ? Avez-vous des crédits en cours (immobilier, auto, conso) ?", "Patrimoine net, endettement et capacité d'emprunt en dépendent. « Aucun » est une réponse valable."));
    out.push({ cle: "immobilier", titre: "Immobilier et crédits", total: 1, manquants: immo });

    // 6. Protection
    const prot = (pr && pr.protection) || {};
    const credits = (pr && Array.isArray(pr.credits) ? pr.credits : []).length + biens.filter(b => num(b.crd) > 0).length;
    const protM = [];
    if (!has(prot.prevoyance)) protM.push(q("protection.prevoyance", "Avez-vous une prévoyance (décès, invalidité) au-delà de celle de votre employeur ?", "Protéger les revenus du foyer passe avant l'investissement."));
    if (credits > 0 && !has(prot.emprunteur)) protM.push(q("protection.emprunteur", "Vos crédits sont-ils couverts par une assurance emprunteur, et à quelle quotité ?", "Elle protège le foyer si un emprunteur ne peut plus rembourser."));
    out.push({ cle: "protection", titre: "Protection", total: credits > 0 ? 2 : 1, manquants: protM });

    // 7. Objectifs
    const objs = (S.objectifs || []);
    const objM = [];
    if (!objs.length) objM.push(q("objectifs", "Quels sont vos projets et leur échéance (achat immobilier, matelas, études, retraite…) ?", "Les projections et les recommandations se calent sur vos objectifs."));
    else if (!objs.some(o => o.dateCible || o.date_cible)) objM.push(q("objectifs.date", "Pour quand visez-vous vos objectifs ?", "Sans date, impossible de calculer l'effort mensuel."));
    out.push({ cle: "objectifs", titre: "Objectifs", total: 1, manquants: objM });

    // 8. Profil de risque
    const rep = (S.risque && S.risque.reponses) || {};
    const risqueM = RISQUE_IDS.filter(id => !has(rep[id]) || (Array.isArray(rep[id]) && !rep[id].length))
      .map(id => q("risque." + id, RISQUE_LIBELLES[id], "Le profil de risque fixe l'allocation cible et la baisse que vous pouvez traverser."));
    out.push({ cle: "risque", titre: "Profil de risque", total: RISQUE_IDS.length, manquants: risqueM });

    return out;
  }

  /** État complet : pourcentage (moyenne des sections), statut par section, 3 prochaines questions, propositions en attente. */
  function etat(S, today) {
    const t = today || new Date().toISOString().slice(0, 10);
    const secs = sections(S || {}, t).map(s => {
      const faits = s.faits != null ? s.faits : Math.max(0, s.total - s.manquants.length);
      return Object.assign(s, { faits, statut: s.manquants.length === 0 ? "complet" : faits === 0 ? "vide" : "partiel", pct: s.total ? faits / s.total : 1 });
    });
    const pourcentage = Math.round(secs.reduce((a, s) => a + s.pct, 0) / secs.length * 100);
    const prochaines = secs.flatMap(s => s.manquants.map(m => Object.assign({ section: s.cle }, m))).slice(0, 3);
    const propositionsEnAttente = ((S && S.propositions) || []).filter(p => p.statut === "en_attente").length;
    return { pourcentage, sections: secs, prochaines, propositionsEnAttente };
  }

  return { etat, RISQUE_IDS, RISQUE_LIBELLES, FRAICHEUR_JOURS };
});
