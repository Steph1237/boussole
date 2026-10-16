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
