/* Moteur du budget (BUD1) : cible en vigueur, note du mois, détections et pistes, cible proposée. Module pur, sans DOM, au tutoiement.
   Spec : docs/superpowers/specs/2026-10-16-bud1-budget-design.md (§ 6, § 7, § 8) ; cas de référence : test/fixtures/budget-cas.json (la fixture fait foi :
   score S1 à S15, cible_en_vigueur, cible T1 à T5, reperes). Global Budget (navigateur), module CommonJS sous Node, copie générée dans le connecteur
   (supabase/functions/mcp/budget.gen.js, npm run gen) : une seule logique pour l'app et pour Claude.

   Livré (tâches 8, 9 et 10 du plan) :
   Budget.cibleEnVigueur(config, perimetre, mois) → cible | null                       // § 7.5 : la cible validée s'applique au mois suivant
   Budget.score(M, cible, opts?) → { score, mot, provisoire, raisons_provisoire, raison_absence, termes, points, texte, … }   // § 7
   Budget.detections(data, opts?) → { recurrents, doublons, frais, petits_achats, energie, fragilite }               // § 6.4
   Budget.pistes(data, opts?) → [piste]                                                                              // § 8.2
   Budget.proposerCible(data, entree) → { options, retenue, cible, controles, … }                                    // § 8.3
   Budget.plancherResteAVivre(foyer, reperes) → { repere, valeur } | null ; Budget.comparerInsee(reference, reperes, opts?) → comparaison (T5)

   Livré (tâche 7) : le moteur du mois, qui lit les mois bancaires fusionnés par Calc.moisBancaires (HIS2) :
   Budget.donnees(S, { aujourdhui }) → data                                            // comptes du budget, mois (Powens et import), partage, préférences, cible, repères
   Budget.mois(data, { vue: "tout" | "commun" | "perso", personne?, mois }) → M       // § 6.1 : revenus, blocs, hors budget, capacité, épargne, lissage, couverture
   Budget.serie(data, { vue, personne?, du, au, granularite: "mois" | "trimestre" | "annee" }) → [M]
   Budget.reference(data, { vue, personne?, mois_ref? }) → référence | null            // § 6.2 : médianes lissées sur 12 mois (6 au moins, sinon 3 : période courte)
   Budget.depensesAnnuelles(data, { vue, personne, part }) → [dépense annuelle]        // § 6.3
   Livré (tâche 9b, § 6.5, D15 et D18 ; règles et arrondis : `conventions_recurrents` de la fixture) : le récurrent, lu sur les agrégats par marchand (data.marchands)
   Budget.recurrents(data, { vue, personne?, mois? }) → { disponible, mois_couverts, recurrents: [ligne], synthese } | { disponible: false, raison, mois_couverts }
   Budget.variations(data, { vue, personne?, mois, niveau: "sous_categorie" | "cle", sous_categorie? | compte_id + cle_marchand })   // effet volume et effet prix
   Budget.inhabituel(data, { vue, personne?, mois }) → { disponible, mois, depenses }
   Ces trois fonctions lisent { aujourdhui, comptes: [{ id, type, titulaire }], partage, marchands } ; Budget.pistes en tire les pistes liées (hausse de prix, abonnement arrêté
   prélevé ailleurs, habitude en hausse). Fréquence, panier et seuils lisent `nombre_sorties` (sorties seules), à défaut `nombre` (qui compte aussi les entrées).
   Les fonctions de note, de détection et de pistes lisent les formes que ces fonctions produisent (data.mois, data.reference…).

   Formes lues :
   M (mois, § 6.1) : { revenus, blocs: { essentiels, envies, epargne }, a_classer, lisse?: { annuelles: [{ sous_categorie, montant_mois, provision }], essentiels_lisses?,
       envies_lisses? }, couverture?: { a_classer_part?, comptes_observes?, mois_complet?, sans_detail?, import_incomplet?, en_partie_importe? } }
   cible : { revenus_ref, blocs: { essentiels, envies, epargne } } (ou à plat : { revenus_ref, essentiels, envies, epargne }), valide_du?
   reference : { revenus, essentiels: { cle: montant }, envies: { cle: montant }, epargne?: { cle: montant } } (montants mensuels lissés, § 6.2) ou
       { revenus, par_sous_categorie: { cle: montant } } (le bloc de chaque clé vient de la taxonomie et des préférences)
   data (détections et pistes) : { aujourdhui: 'AAAA-MM-JJ', reference, marchands: [lignes de banque_marchands_mois], operations: [{ date, montant, libelle,
       compte_id, sous_categorie, cle_marchand, type_powens? }] (90 jours), comptes: [{ id, type, solde, titulaire?, pret? }], mois: [{ mois, capacite }]
       (capacités des derniers mois), preferences: config.budget_preferences, reperes: [{ cle, valeur }] (conventions budget_*) }
   Tout est déterministe : mêmes entrées, mêmes sorties. Les pourcentages et seuils sont des conventions de Boussole (repères budget_*, statut CONV),
   lues dans data.reperes quand ils y sont. Aucune piste ne vise une sous-catégorie protégée ; aucun fournisseur n'est nommé ni recommandé : une piste
   désigne une sous-catégorie ou une famille, jamais une marque. */
(function (root, factory) {
  const cjs = typeof module === "object" && module.exports;
  const dep = (nom, global) => (cjs ? require("./" + nom + ".js") : root[global]);
  const api = factory({ BudgetCategories: dep("budget-categories", "BudgetCategories"), Calc: dep("calc", "Calc"), Periodes: dep("periodes", "Periodes") });
  if (cjs) module.exports = api;
  else root.Budget = api;
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";
  const { BudgetCategories: BC } = D;

  /* ================================================================== conventions (repères budget_*, § 12) */
  /** Valeurs de départ des conventions ; data.reperes (clé → valeur) les remplace. Statut CONV, revues après 3 mois d'usage (D4, D15). */
  const CONVENTIONS = {
    budget_score_poids_epargne: 3, budget_score_poids_envies: 2, budget_score_poids_essentiels: 1, budget_score_franchise_pct: 1,
    budget_score_seuil_tenu: 85, budget_score_seuil_presque: 60, budget_score_a_classer_provisoire_pct: 15, budget_score_a_classer_sans_note_pct: 30,
    budget_score_revenus_incomplets_pct: 50,
    budget_piste_contrats_pct: 10, budget_piste_envies_pct: 10, budget_piste_envies_fort_pct: 25, budget_piste_petits_achats_pct: 50,
    budget_piste_petit_achat_seuil: 15, budget_piste_petits_achats_nombre: 8, budget_piste_frais_cotisation_laissee: 5, budget_piste_habitude_tendance_pct: 15,
    budget_essentiel_plancher_pct: 90, budget_annuelle_seuil: 150, budget_recurrent_tolerance_pct: 10, budget_matelas_reconstitution_mois: 12,
  };
  /** Convention `cle` : repère de data.reperes (tableau de { cle, valeur } ou objet cle → valeur) s'il y est, sinon valeur de départ. */
  function convention(reperes, cle) {
    let v;
    if (Array.isArray(reperes)) { const r = reperes.find(x => x && x.cle === cle); v = r && r.valeur; }
    else if (reperes && typeof reperes === "object") v = reperes[cle];
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return typeof n === "number" && isFinite(n) ? n : CONVENTIONS[cle];
  }

  /* ================================================================== outils */
  const nombre = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const n0 = v => nombre(v) || 0;
  /** Arrondi à l'entier, 0,5 vers le haut (montants positifs), tolérant aux erreurs de virgule flottante. */
  const arrondi = x => Math.floor(x + 0.5 + 1e-9);
  const dixieme = x => Math.round(x * 10 + 1e-9) / 10;
  const centieme = x => Math.round(x * 100 + 1e-9) / 100;
  const mois7 = d => (typeof d === "string" && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null);
  /** Mois AAAA-MM décalé de k mois. */
  function decale(m, k) { const [a, b] = m.split("-").map(Number); const t = a * 12 + (b - 1) + k; return String(Math.floor(t / 12)).padStart(4, "0") + "-" + String(t % 12 + 1).padStart(2, "0"); }
  const prix = x => String(Math.round(Math.abs(x) * 100) / 100).replace(".", ",") + " €";
  const moisFr = m => ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"][+m.slice(5, 7) - 1] + " " + m.slice(0, 4);
  const euros = x => { const r = arrondi(Math.abs(x)); return String(r).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " €"; };
  const mediane = xs => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
  const somme = xs => xs.reduce((t, x) => t + x, 0);
  const ORDRE_TAXONOMIE = new Map(BC.TAXONOMIE.map((t, i) => [t.cle, i]));
  const blocDe = (cle, preferences) => BC.blocDe(cle, preferences);

  /* ================================================================== cible en vigueur (§ 7.5) */
  /** Cible en vigueur pour un périmètre ("foyer", "p1", "p2") et un mois AAAA-MM : la cible validée la plus récente dont `valide_du` n'est pas après ce mois
      (une cible validée en septembre s'applique en octobre : le mois en cours garde l'ancienne). Cherche dans config.budget_cible.historique
      ([{ perimetre, valide_du, cible }]) puis dans perimetres[périmètre] ; { ...cible, valide_du } ou null. */
  function cibleEnVigueur(config, perimetre, mois) {
    const bc = config && (config.budget_cible || config);
    const m = mois7(mois);
    if (!bc || typeof bc !== "object" || !m) return null;
    const per = perimetre || "foyer";
    const entrees = [];
    for (const h of Array.isArray(bc.historique) ? bc.historique : []) {
      if (h && (h.perimetre || "foyer") === per && mois7(h.valide_du) && h.cible && typeof h.cible === "object") entrees.push({ valide_du: mois7(h.valide_du), cible: h.cible });
    }
    const courante = bc.perimetres && bc.perimetres[per];
    if (courante && mois7(courante.valide_du) && !entrees.some(e => e.valide_du === mois7(courante.valide_du))) entrees.push({ valide_du: mois7(courante.valide_du), cible: courante });
    const valides = entrees.filter(e => e.valide_du <= m).sort((a, b) => (a.valide_du < b.valide_du ? -1 : a.valide_du > b.valide_du ? 1 : 0));
    const e = valides[valides.length - 1];
    return e ? { ...e.cible, valide_du: e.valide_du } : null;
  }

  /* ================================================================== note du mois (§ 7) */
  const MOTS = { tenu: "tenu", presque: "presque", a_revoir: "à revoir" };
  const BLOCS_CIBLE = c => (c && c.blocs && typeof c.blocs === "object" ? c.blocs : c) || {};
  /** Montants lissés d'un mois (§ 6.3) : dépenses annuelles ramenées à leur provision (1/12), ailleurs le réel du mois. */
  function lisses(M, preferences) {
    const bl = (M && M.blocs) || {}, l = (M && M.lisse) || {};
    let ess = n0(bl.essentiels), env = n0(bl.envies);
    if (nombre(l.essentiels_lisses) !== null && nombre(l.envies_lisses) !== null) return { essentiels: l.essentiels_lisses, envies: l.envies_lisses };
    for (const a of Array.isArray(l.annuelles) ? l.annuelles : []) {
      const delta = n0(a.provision) - n0(a.montant_mois);
      if (blocDe(a.sous_categorie, preferences) === "envies") env += delta; else if (blocDe(a.sous_categorie, preferences) === "essentiels") ess += delta;
    }
    return { essentiels: ess, envies: env };
  }
  /** Note de respect du budget d'un mois complet par rapport à la cible en vigueur (§ 7). `M` : le mois (forme du § 6.1), `cible` : cible en vigueur ou null,
      `opts` : { reperes, preferences }. Jamais de série, de record ni de récompense : un nombre, un mot, les points perdus par terme et une phrase. */
  function score(M, cible, opts) {
    const o = opts || {}, K = c => convention(o.reperes, c);
    const cv = (M && M.couverture) || {};
    const absent = raison => ({ score: null, mot: null, provisoire: false, raisons_provisoire: [], raison_provisoire: null, raison_absence: raison, termes: null, points: null,
      part_a_classer: partAClasser, texte: texteAbsence(raison, partAClasser) });
    const bl = (M && M.blocs) || {};
    const Ac = n0(M && M.a_classer);
    const depBrutes = n0(bl.essentiels) + n0(bl.envies) + Ac;
    const partExacte = nombre(cv.a_classer_part) !== null ? cv.a_classer_part : depBrutes > 0 ? Ac / depBrutes : 0;
    const partAClasser = Math.round(partExacte * 10000) / 10000;   // affichée ; les seuils se lisent sur la part exacte
    const B = BLOCS_CIBLE(cible), Rstar = nombre(cible && cible.revenus_ref);
    if (!cible || !Rstar || Rstar <= 0 || nombre(B.essentiels) === null || nombre(B.envies) === null || nombre(B.epargne) === null) return absent("sans_cible");
    if (cv.mois_complet === false || (M && M.mois_complet === false)) return absent("mois_en_cours");
    if (cv.import_incomplet === true) return absent("import_incomplet");
    if (cv.comptes_observes === 0) return absent("aucun_compte");
    if (cv.sans_detail === true) return absent("sans_detail");
    if (partExacte * 100 > K("budget_score_a_classer_sans_note_pct") + 1e-9) return absent("a_classer");
    const R = n0(M.revenus), L = lisses(M, o.preferences);
    const Ess = L.essentiels, Env = L.envies;
    const Dep = Ess + Env + Ac, DepStar = n0(B.essentiels) + n0(B.envies), Sstar = n0(B.epargne);
    const dS = Math.max(0, Dep - Math.max(DepStar, R - Sstar)), dEnv = Math.max(0, Env - n0(B.envies)), dEss = Math.max(0, Ess - n0(B.essentiels));
    const f = K("budget_score_franchise_pct") / 100 * Rstar;
    const poids = { epargne: K("budget_score_poids_epargne"), envies: K("budget_score_poids_envies"), essentiels: K("budget_score_poids_essentiels") };
    const ecart = { epargne: dS, envies: dEnv, essentiels: dEss };
    const num = {}, pts = {};
    let total = 0;
    for (const t of ["epargne", "envies", "essentiels"]) {
      num[t] = poids[t] * Math.max(0, ecart[t] - f);
      total += num[t];
      pts[t] = arrondi(100 * num[t] / Rstar);
    }
    const brut = 100 - 100 * total / Rstar;
    const borne = brut <= 0;
    const sc = borne ? 0 : Math.min(100, arrondi(brut));
    const mot = sc >= K("budget_score_seuil_tenu") ? MOTS.tenu : sc >= K("budget_score_seuil_presque") ? MOTS.presque : MOTS.a_revoir;
    const points = { epargne: pts.epargne, envies: pts.envies, essentiels: pts.essentiels };
    const ecartArrondi = (100 - sc) - (pts.epargne + pts.envies + pts.essentiels);
    if (!borne && ecartArrondi !== 0) points.arrondi = ecartArrondi;
    const raisons = [];
    if (R < K("budget_score_revenus_incomplets_pct") / 100 * Rstar) raisons.push("revenus_incomplets");
    if (partExacte * 100 >= K("budget_score_a_classer_provisoire_pct") - 1e-9) raisons.push("a_classer");
    if (cv.en_partie_importe === true) raisons.push("mois_en_partie_importe");
    const ecartRevenus = R - Rstar;
    const phrase = !(pts.epargne || pts.envies || pts.essentiels) && ecartRevenus < -f ? "revenus_plus_bas" : null;
    const annuelles = Array.isArray(M.lisse && M.lisse.annuelles) ? M.lisse.annuelles : [];
    const res = {
      score: sc, mot, provisoire: raisons.length > 0, raisons_provisoire: raisons, raison_provisoire: raisons[0] || null, raison_absence: null,
      termes: { epargne: { ecart: dS, poids: poids.epargne, points: pts.epargne }, envies: { ecart: dEnv, poids: poids.envies, points: pts.envies },
        essentiels: { ecart: dEss, poids: poids.essentiels, points: pts.essentiels } },
      points, part_a_classer: partAClasser, essentiels_lisses: Ess, envies_lisses: Env, franchise: f, ecart_revenus: ecartRevenus, phrase,
      capacite_reelle: R - n0(bl.essentiels) - n0(bl.envies) - Ac,
      repere: annuelles.length ? "depense_annuelle_lissee" : null,
    };
    res.texte = texteScore(res);
    return res;
  }
  function texteAbsence(raison, part) {
    const t = {
      sans_cible: "Pas de note : aucune cible n'est validée pour ce mois.",
      mois_en_cours: "Pas de note : le mois n'est pas terminé.",
      import_incomplet: "Pas de note : le relevé importé de ce mois est incomplet.",
      aucun_compte: "Pas de note : aucun compte n'est observé ce mois-ci.",
      sans_detail: "Pas de note : ce mois n'a pas de détail par sous-catégorie.",
      a_classer: "Pas de note : " + Math.round((part || 0) * 100) + " % de tes dépenses sont encore à classer. Classe d'abord ces opérations avec Claude.",
    };
    return t[raison] || "Pas de note.";
  }
  function texteScore(r) {
    const morceaux = [];
    if (r.termes.essentiels.points) morceaux.push("tes essentiels ont dépassé de " + euros(r.termes.essentiels.ecart) + " (−" + r.termes.essentiels.points + " points)");
    if (r.termes.envies.points) morceaux.push("tes envies ont dépassé de " + euros(r.termes.envies.ecart) + " (−" + r.termes.envies.points + " points)");
    if (r.termes.epargne.points) morceaux.push("ton épargne est " + euros(r.termes.epargne.ecart) + " sous ta cible (−" + r.termes.epargne.points + " points)");
    let corps;
    if (morceaux.length) {
      const phrase = morceaux.length > 1 ? morceaux.slice(0, -1).join(", ") + " et " + morceaux[morceaux.length - 1] : morceaux[0];
      corps = phrase.charAt(0).toUpperCase() + phrase.slice(1) + ".";
    } else if (r.phrase === "revenus_plus_bas") {
      corps = "Tes revenus étaient plus bas de " + euros(r.ecart_revenus) + " : ta cible d'épargne du mois baisse d'autant, et tu as tenu tes dépenses.";
    } else corps = "Tes dépenses sont à ta cible.";
    const mention = r.provisoire ? " Note provisoire : " + ({ revenus_incomplets: "les revenus du mois sont incomplets ou en retard, la note ne regarde que tes dépenses", a_classer: "une partie de tes opérations reste à classer",
      mois_en_partie_importe: "une partie du mois vient d'un import" }[r.raison_provisoire] || "elle peut encore bouger") + "." : "";
    const lisse = r.repere === "depense_annuelle_lissee" ? " Les dépenses annuelles sont lissées sur l'année." : "";
    return r.score + " · " + r.mot + ". " + corps + lisse + mention;
  }

  /* ================================================================== référence normalisée */
  /** Référence → { revenus, essentiels: Map, envies: Map, epargne: Map } (clés rangées dans leur bloc d'après la taxonomie et les préférences). */
  function normaliserReference(ref, preferences) {
    const r = ref || {}, out = { revenus: n0(r.revenus), essentiels: new Map(), envies: new Map(), epargne: new Map() };
    const range = (cle, m, bloc) => { const v = nombre(m); if (v !== null && v > 0) out[bloc].set(cle, v); };
    if (r.essentiels && typeof r.essentiels === "object" && !nombre(r.essentiels)) {
      for (const [k, m] of Object.entries(r.essentiels)) range(k, m, "essentiels");
      for (const [k, m] of Object.entries(r.envies || {})) range(k, m, "envies");
      for (const [k, m] of Object.entries(r.epargne || {})) range(k, m, "epargne");
    } else {
      for (const [k, m] of Object.entries(r.par_sous_categorie || {})) {
        const b = blocDe(k, preferences);
        if (b === "essentiels" || b === "envies" || b === "epargne") range(k, m, b);
      }
    }
    return out;
  }
  const trier = cles => [...cles].sort((a, b) => (ORDRE_TAXONOMIE.get(a) ?? 99) - (ORDRE_TAXONOMIE.get(b) ?? 99));
  const sommeMap = m => somme([...m.values()]);

  /* ================================================================== détections (§ 6.4) */
  const SORTIES_EXCLUES = ["virement_interne", "apport_commun", "transfert_foyer", "releve_carte", "epargne_precaution", "investissement", "projets", "salaires", "revenus_autres"];
  const FAMILLES_DOUBLON = ["video", "musique"];
  /** Mots de libellé qui ne désignent aucun payeur (« PRLV », « CB », « SEPA »…) : ignorés pour savoir si deux clés se recouvrent. */
  const MOTS_GENERIQUES = new Set(["prlv", "prelevement", "prelevements", "sepa", "cb", "carte", "vir", "virement", "paiement", "par", "de", "du", "la", "le", "les", "des", "facture", "pour", "et", "com", "fr"]);
  const MOTS_CARTE = ["card", "deferred_card", "summary_card"];
  const motsDe = t => String(t || "").split(" ").filter(Boolean);
  function contient(ts, seq) {
    if (!seq.length || seq.length > ts.length) return false;
    for (let i = 0; i + seq.length <= ts.length; i++) { let ok = true; for (let j = 0; j < seq.length; j++) if (ts[i + j] !== seq[j]) { ok = false; break; } if (ok) return true; }
    return false;
  }
  /** Famille d'un abonnement (vidéo, musique, presse, logiciel, sport…) d'après la table des marchands (suite de mots entière, la plus longue) ; null sinon. */
  function familleDe(cle) {
    const ts = motsDe(cle);
    let best = null;
    for (const e of BC.MARCHANDS) {
      if (!e.famille) continue;
      const seq = motsDe(e.motif);
      if (contient(ts, seq) && (!best || e.motif.length > best.motif.length)) best = e;
    }
    return best ? best.famille : null;
  }
  /** Mois complets (AAAA-MM) qui précèdent le mois de `aujourdhui`, du plus ancien au plus récent : `n` au plus. */
  function derniersMois(aujourdhui, n) {
    const cour = mois7(aujourdhui);
    const out = [];
    if (!cour) return out;
    for (let k = n; k >= 1; k--) out.push(decale(cour, -k));
    return out;
  }
  const lignesSorties = (data, comptes) => (Array.isArray(data && data.marchands) ? data.marchands : [])
    .filter(l => l && mois7(l.mois) && n0(l.sorties) > 0 && !SORTIES_EXCLUES.includes(l.sous_categorie) && (!comptes || comptes.includes(String(l.compte_id))));

  /** Récurrents (§ 6.4) : même clé de marchand, sorties seulement. Mensuel : présent dans 3 des 4 derniers mois complets (ou 5 des 6), montants à ±tolérance de la
      médiane ; annuel (§ 6.3) : une seule fois sur 12 mois, dans une sous-catégorie « annuelle probable » ou à partir du seuil, confirmé s'il revient 11 à 13 mois plus
      tôt (sinon « probable »). → [{ cle_marchand, sous_categorie, famille, rythme, montant_mensuel, montant, mois_presents, confirme }]. */
  function recurrentsMensuels(data, opts) {
    const o = opts || {}, reperes = data && data.reperes;
    const tol = convention(reperes, "budget_recurrent_tolerance_pct") / 100, seuil = convention(reperes, "budget_annuelle_seuil");
    const dernier = derniersMois(data.aujourdhui, 13);                 // 13 mois complets au plus
    const m4 = dernier.slice(-4), m6 = dernier.slice(-6), m12 = dernier.slice(-12);
    const groupes = new Map();
    for (const l of lignesSorties(data, o.comptes)) {
      const m = mois7(l.mois);
      if (!dernier.includes(m)) continue;
      const k = l.cle_marchand || "";
      if (!k) continue;
      if (!groupes.has(k)) groupes.set(k, { sous: new Map(), mois: new Map() });
      const g = groupes.get(k);
      g.mois.set(m, (g.mois.get(m) || 0) + n0(l.sorties) - n0(l.entrees));
      g.sous.set(l.sous_categorie, (g.sous.get(l.sous_categorie) || 0) + n0(l.sorties));
    }
    const out = [];
    for (const [cle, g] of groupes) {
      const montants = new Map([...g.mois].filter(([, v]) => v > 0));
      const sous = [...g.sous].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
      const dans = (liste) => liste.filter(m => montants.has(m));
      const stable = ms => { const v = ms.map(m => montants.get(m)), med = mediane(v); return med > 0 && v.every(x => Math.abs(x - med) <= med * tol + 1e-9); };
      const p4 = dans(m4), p6 = dans(m6);
      let rythme = null, presents = [];
      if (p4.length >= 3 && stable(p4)) { rythme = "mensuel"; presents = p4; }
      else if (p6.length >= 5 && stable(p6)) { rythme = "mensuel"; presents = p6; }
      if (rythme === "mensuel") {
        const montant = centieme(mediane(presents.map(m => montants.get(m))));
        out.push({ cle_marchand: cle, sous_categorie: sous, famille: familleDe(cle), rythme, montant_mensuel: montant, montant, mois_presents: presents, confirme: true });
        continue;
      }
      // annuel : une seule présence sur les 12 derniers mois
      const p12 = dans(m12);
      const taxo = BC.TAXONOMIE.find(t => t.cle === sous);
      if (p12.length === 1) {
        const m = p12[0], montant = montants.get(m);
        if (montant >= seuil || (taxo && taxo.annuelle_probable)) {
          const avant = [decale(m, -13), decale(m, -12), decale(m, -11)].filter(x => montants.has(x));
          const historique = dernier.includes(decale(m, -12)) || dernier.includes(decale(m, -13)) || dernier.includes(decale(m, -11));
          out.push({ cle_marchand: cle, sous_categorie: sous, famille: familleDe(cle), rythme: "annuel", montant_mensuel: centieme(montant / 12), montant: centieme(montant),
            mois_presents: [m], confirme: avant.length > 0 || false, historique_suffisant: historique });
        }
      }
    }
    return out.sort((a, b) => (a.cle_marchand < b.cle_marchand ? -1 : a.cle_marchand > b.cle_marchand ? 1 : 0));
  }

  /** Détections (§ 6.4). `data` : voir l'en-tête ; `opts` : { comptes: [id] } (seuls ces comptes comptent). */
  function detections(data, opts) {
    const o = opts || {}, reperes = data && data.reperes;
    const rec = recurrentsMensuels(data, o);
    // doublons possibles
    const doublons = [];
    const assurances = rec.filter(r => r.sous_categorie === "assurances");
    const clesDe = r => new Set(motsDe(r.cle_marchand).filter(m => !MOTS_GENERIQUES.has(m)));
    const sansRecouvrement = (a, b) => { const A = clesDe(a); return ![...clesDe(b)].some(m => A.has(m)); };
    if (assurances.length >= 2) {
      const paires = [];
      for (let i = 0; i < assurances.length; i++) for (let j = i + 1; j < assurances.length; j++) if (sansRecouvrement(assurances[i], assurances[j])) paires.push([assurances[i], assurances[j]]);
      if (paires.length) {
        const concernes = [...new Set(paires.flat().map(r => r.cle_marchand))];
        const lignes = rec.filter(r => concernes.includes(r.cle_marchand));
        doublons.push({ type: "assurances", famille: null, cles_marchand: concernes.sort(), montant_mensuel_min: Math.min(...lignes.map(r => r.montant_mensuel)) });
      }
    }
    for (const fam of FAMILLES_DOUBLON) {
      const l = rec.filter(r => r.sous_categorie === "abonnements" && r.famille === fam);
      if (l.length >= 2) doublons.push({ type: "abonnements", famille: fam, cles_marchand: l.map(r => r.cle_marchand).sort(), montant_mensuel_min: Math.min(...l.map(r => r.montant_mensuel)) });
    }
    // frais bancaires sur 12 mois
    const m12 = derniersMois(data.aujourdhui, 12);
    const fr = lignesSorties(data, o.comptes).filter(l => l.sous_categorie === "frais_bancaires" && m12.includes(mois7(l.mois)));
    const frais = { total_12_mois: centieme(somme(fr.map(l => n0(l.sorties) - n0(l.entrees)))), commissions: somme(fr.map(l => (nombre(l.nombre_sorties) !== null ? n0(l.nombre_sorties) : n0(l.nombre)))), mois: [...new Set(fr.map(l => mois7(l.mois)))].length };
    // petits achats récurrents
    const seuilPA = convention(reperes, "budget_piste_petit_achat_seuil"), nbPA = convention(reperes, "budget_piste_petits_achats_nombre");
    const protegees = new Set((data.preferences && data.preferences.protegees) || []);
    const ops = (Array.isArray(data.operations) ? data.operations : []).filter(x => x && n0(x.montant) < 0 && -n0(x.montant) < seuilPA
      && ["restaurants", "shopping", "loisirs"].includes(x.sous_categorie) && !protegees.has(x.sous_categorie) && (!o.comptes || o.comptes.includes(String(x.compte_id)))
      && (MOTS_CARTE.includes(String(x.type_powens || "").toLowerCase()) || motsDe(String(x.libelle || "").toLowerCase().replace(/[^a-z]+/g, " ").trim())[0] === "cb"));
    const moisOps = Math.max(1, nombre(data.mois_detail) || 3);
    const petits = { nombre: ops.length, par_mois: centieme(ops.length / moisOps), total_mensuel: centieme(somme(ops.map(x => -n0(x.montant))) / moisOps), seuil: seuilPA, recurrent: ops.length / moisOps > nbPA };
    // énergie
    const en = lignesSorties(data, o.comptes).filter(l => l.sous_categorie === "energie" && m12.includes(mois7(l.mois)));
    const parMois = {};
    for (const l of en) parMois[mois7(l.mois)] = centieme((parMois[mois7(l.mois)] || 0) + n0(l.sorties) - n0(l.entrees));
    const valeurs = Object.entries(parMois);
    const energie = { total_12_mois: centieme(somme(valeurs.map(([, v]) => v))), par_mois: parMois,
      plus_cher: valeurs.length ? valeurs.slice().sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0] : null,
      moins_cher: valeurs.length ? valeurs.slice().sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))[0][0] : null };
    return { recurrents: rec, doublons, frais, petits_achats: petits, energie, fragilite: fragilite(data, o) };
  }

  /** Signaux de fragilité (§ 6.4) : solde d'un courant négatif plus de 5 jours dans le mois sur 2 des 3 derniers mois, agios ou commissions d'intervention
      récurrents, crédit renouvelable, capacité négative 3 mois de suite. Aucun signal ne dit « mal » : il oriente (étape 4 de l'expertise). */
  function fragilite(data, opts) {
    const o = opts || {};
    const m3 = derniersMois(data.aujourdhui, 3);
    // solde du jour reconstitué à rebours à partir du solde actuel, pour chaque courant suivi
    const comptes = (Array.isArray(data.comptes) ? data.comptes : []).filter(c => c && c.type === "courant" && nombre(c.solde) !== null && (!o.comptes || o.comptes.includes(String(c.id))));
    const joursNegatifs = new Map(m3.map(m => [m, 0]));
    const ops = Array.isArray(data.operations) ? data.operations : [];
    const jourDe = d => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);
    const hier = d => new Date(Date.parse(d + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
    for (const c of comptes) {
      const mvts = new Map();
      for (const x of ops) if (String(x.compte_id) === String(c.id) && jourDe(x.date)) mvts.set(jourDe(x.date), (mvts.get(jourDe(x.date)) || 0) + n0(x.montant));
      // fin de journée d'aujourd'hui = solde actuel ; la veille = solde − mouvements du jour ; sans mouvement connu, le solde ne bouge pas jusqu'au début de la
      // fenêtre de détail (90 jours)
      let solde = nombre(c.solde), d = jourDe(data.aujourdhui);
      if (!d) continue;
      const debut = new Date(Date.parse(d + "T12:00:00Z") - 90 * 864e5).toISOString().slice(0, 10);
      for (; d >= debut; d = hier(d)) {
        const m = mois7(d);
        if (solde < 0 && joursNegatifs.has(m)) joursNegatifs.set(m, joursNegatifs.get(m) + 1);
        solde -= mvts.get(d) || 0;
      }
    }
    const moisNegatifs = m3.filter(m => joursNegatifs.get(m) > 5);
    const decouvert = moisNegatifs.length >= 2;
    const mf = (Array.isArray(data.marchands) ? data.marchands : []).filter(l => l && l.sous_categorie === "frais_bancaires" && m3.includes(mois7(l.mois)) && n0(l.sorties) > 0
      && /\b(agios?|commission intervention|interv)\b/.test(String(l.cle_marchand || "")));
    const agios = [...new Set(mf.map(l => mois7(l.mois)))].length >= 2;
    const renouvelable = (Array.isArray(data.comptes) ? data.comptes : []).some(c => c && c.pret && /revolving/i.test(String(c.pret.type || "")));
    const caps = (Array.isArray(data.mois) ? data.mois : []).filter(x => x && mois7(x.mois)).sort((a, b) => (mois7(a.mois) < mois7(b.mois) ? -1 : 1)).slice(-3);
    const capacite = caps.length === 3 && caps.every(x => n0(x.capacite) < 0) && caps.every((x, i) => i === 0 || mois7(x.mois) === decale(mois7(caps[i - 1].mois), 1));
    return { decouvert, jours_negatifs: Object.fromEntries(joursNegatifs), agios, renouvelable, capacite_negative: capacite, fragile: decouvert || agios || renouvelable || capacite };
  }

  /* ================================================================== pistes (§ 8.2) */
  const DIFFICULTES = ["facile", "moyen", "vrai_changement"];
  const rang = d => DIFFICULTES.indexOf(d);
  /** Pistes d'économie, déterministes, triées par difficulté puis par économie. Chaque piste : { cle, poste, titre, pourquoi, economie_mensuelle: { min, max, retenue },
      difficulte, question, donnees: { cles_marchand, montant_annuel, nombre }, source }. La fourchette est celle de la convention : égale au montant pour une économie
      qui vient d'une ligne précise (abonnement, doublon, frais), de la moitié à une fois et demie la retenue pour une économie estimée en pourcentage. */
  function pistes(data, opts) {
    const o = opts || {}, reperes = data && data.reperes;
    const prefs = data.preferences || {};
    const protegees = new Set(Array.isArray(prefs.protegees) ? prefs.protegees : []);
    const ref = normaliserReference(data.reference, prefs);
    const det = detections(data, o);
    const liste = [];
    const ajoute = p => { if (!protegees.has(p.poste)) liste.push(p); };
    const fourchette = r => ({ min: arrondi(r / 2), max: arrondi(r * 1.5), retenue: r });
    const exacte = r => ({ min: r, max: r, retenue: r });
    const SOURCE = "Calcul de Boussole sur tes relevés (convention, pas une promesse)";
    // 1. abonnement que tu n'utilises plus (réponse au questionnaire)
    const inutilises = new Set(Array.isArray(prefs.abonnements_inutilises) ? prefs.abonnements_inutilises : []);
    const abos = det.recurrents.filter(r => inutilises.has(r.cle_marchand) && r.sous_categorie === "abonnements");
    if (abos.length) {
      const r = arrondi(somme(abos.map(a => a.montant_mensuel)));
      if (r > 0) ajoute({ cle: "abonnement_inutilise", poste: "abonnements", titre: abos.length > 1 ? "Des abonnements que tu n'utilises plus" : "Un abonnement que tu n'utilises plus",
        pourquoi: "Tu as dit ne plus l'utiliser ; il revient chaque mois.", economie_mensuelle: exacte(r), difficulte: "facile", question: "Veux-tu le résilier ou le mettre en pause ?",
        donnees: { cles_marchand: abos.map(a => a.cle_marchand), montant_annuel: centieme(r * 12), nombre: abos.length }, source: SOURCE });
    }
    // 2. doublons de même famille
    for (const d of det.doublons.filter(x => x.type === "abonnements")) {
      const r = arrondi(d.montant_mensuel_min);
      if (r > 0) ajoute({ cle: "doublon_abonnements_" + d.famille, poste: "abonnements", titre: "Deux abonnements de la même famille (" + ({ video: "vidéo", musique: "musique" }[d.famille] || d.famille) + ")",
        pourquoi: "Deux paiements récurrents semblent faire le même usage.", economie_mensuelle: exacte(r), difficulte: "facile", question: "Utilises-tu vraiment les deux ?",
        donnees: { cles_marchand: d.cles_marchand, montant_annuel: centieme(r * 12), nombre: d.cles_marchand.length }, source: SOURCE });
    }
    // 3. frais bancaires
    const laissee = convention(reperes, "budget_piste_frais_cotisation_laissee");
    if (det.frais.mois > 0) {
      const r = arrondi(det.frais.total_12_mois / 12 - laissee);
      if (r > 0) ajoute({ cle: "frais_bancaires", poste: "frais_bancaires", titre: "Des frais bancaires à regarder",
        pourquoi: "Tes frais bancaires font " + euros(det.frais.total_12_mois) + " sur 12 mois (" + det.frais.commissions + " opération" + (det.frais.commissions > 1 ? "s" : "") + "), dont une cotisation de " + euros(laissee) + " par mois laissée.",
        economie_mensuelle: exacte(r), difficulte: "facile", question: "Veux-tu qu'on regarde ensemble ce que ton offre comprend, et tes droits (plafonds de commissions) ?",
        donnees: { cles_marchand: [], montant_annuel: det.frais.total_12_mois, nombre: det.frais.commissions }, source: SOURCE });
    }
    // 4. assurances en double possible
    for (const d of det.doublons.filter(x => x.type === "assurances")) {
      const r = arrondi(d.montant_mensuel_min);
      if (r > 0) ajoute({ cle: "assurances_en_double", poste: "assurances", titre: "Des assurances qui font peut-être double emploi",
        pourquoi: "Plusieurs assurances reviennent chaque mois sans lien visible entre elles : c'est à vérifier sur tes contrats, rien n'est affirmé.",
        economie_mensuelle: exacte(r), difficulte: "moyen", question: "Peux-tu relire tes garanties pour voir si deux contrats couvrent la même chose ?",
        donnees: { cles_marchand: d.cles_marchand, montant_annuel: centieme(r * 12), nombre: d.cles_marchand.length }, source: SOURCE });
    }
    // 5. revoir les contrats : assurances, énergie, télécoms (trois pistes distinctes)
    const pct = convention(reperes, "budget_piste_contrats_pct") / 100;
    for (const cle of ["assurances", "energie", "telecom"]) {
      const m = ref.essentiels.get(cle) || 0;
      const r = arrondi(m * pct);
      if (r > 0) ajoute({ cle: "contrats_" + cle, poste: cle, titre: { assurances: "Revoir tes contrats d'assurance", energie: "Revoir tes contrats d'énergie", telecom: "Revoir ton forfait internet et mobile" }[cle],
        pourquoi: "Un contrat se renégocie ou se revoit sans changer d'usage (garanties, franchises, engagement, prix après promotion).", economie_mensuelle: fourchette(r), difficulte: "moyen",
        question: "Veux-tu qu'on compare tes garanties actuelles à ce dont tu as besoin ?", donnees: { cles_marchand: det.recurrents.filter(x => x.sous_categorie === cle).map(x => x.cle_marchand), montant_annuel: centieme(m * 12), nombre: 1 }, source: SOURCE });
    }
    // 6. envies modulables (hors protégées, hors abonnements)
    const modulables = trier(ref.envies.keys()).filter(k => !protegees.has(k) && k !== "abonnements");
    const base = somme(modulables.map(k => ref.envies.get(k)));
    const pe = convention(reperes, "budget_piste_envies_pct") / 100, pf = convention(reperes, "budget_piste_envies_fort_pct") / 100;
    const r10 = arrondi(base * pe), r25 = arrondi(base * pf);
    if (r10 > 0) liste.push({ cle: "envies_modulables", poste: "envies", titre: "Un peu moins sur les envies que tu gardes modulables", pourquoi: "Sans toucher à ce que tu protèges ni à tes abonnements.",
      economie_mensuelle: fourchette(r10), difficulte: "moyen", question: "Quelles envies te tiennent le moins à cœur ce trimestre ?", donnees: { cles_marchand: [], montant_annuel: centieme(base * 12), nombre: modulables.length }, source: SOURCE, sous_categories: modulables });
    if (r25 > 0) liste.push({ cle: "envies_modulables_fort", poste: "envies", titre: "Un vrai changement sur les envies modulables", pourquoi: "Un effort plus marqué, à choisir en connaissance de cause.",
      economie_mensuelle: fourchette(r25), difficulte: "vrai_changement", question: "Est-ce un effort que tu veux faire pour atteindre tes objectifs plus tôt ?", donnees: { cles_marchand: [], montant_annuel: centieme(base * 12), nombre: modulables.length }, source: SOURCE, sous_categories: modulables });
    // 7. petits achats récurrents
    if (det.petits_achats.recurrent) {
      const r = arrondi(det.petits_achats.total_mensuel * convention(reperes, "budget_piste_petits_achats_pct") / 100);
      if (r > 0) liste.push({ cle: "petits_achats", poste: "envies", titre: "Les petits achats de carte qui s'additionnent", pourquoi: "Plus de " + convention(reperes, "budget_piste_petits_achats_nombre") + " achats de moins de " + euros(det.petits_achats.seuil) + " par mois en moyenne.",
        economie_mensuelle: fourchette(r), difficulte: "moyen", question: "Y a-t-il des habitudes que tu veux garder, et d'autres que tu lâcherais sans regret ?",
        donnees: { cles_marchand: [], montant_annuel: centieme(det.petits_achats.total_mensuel * 12), nombre: det.petits_achats.nombre }, source: SOURCE });
    }
    // 8. le récurrent (§ 6.5) : hausse de prix, abonnement arrêté mais prélevé ailleurs, habitude en hausse
    const rec = recurrentsVue(data, { vue: o.vue, personne: o.personne });
    if (rec.disponible) {
      const lignes = rec.recurrents.filter(r => !Array.isArray(o.comptes) || o.comptes.includes(String(r.compte_id)));
      for (const r of lignes.filter(x => x.hausse && x.famille !== "habitude")) {
        const e = arrondi(r.hausse.nouveau - r.hausse.ancien);
        if (e > 0) ajoute({ cle: "hausse_prix_" + r.compte_id + "_" + r.cle_marchand, poste: r.sous_categorie,
          titre: r.famille === "abonnement" ? "Un abonnement a augmenté" : "Un contrat a augmenté",
          pourquoi: "Son prix est passé de " + prix(r.hausse.ancien) + " à " + prix(r.hausse.nouveau) + " depuis " + moisFr(r.hausse.depuis) + ".",
          economie_mensuelle: exacte(e), difficulte: r.famille === "abonnement" ? "facile" : "moyen",
          question: "Veux-tu le renégocier, ou regarder tes droits de résiliation (vérifiés sur ton contrat) ?",
          donnees: { cles_marchand: [r.cle_marchand], montant_annuel: centieme((r.hausse.nouveau - r.hausse.ancien) * 12), nombre: 1 }, source: SOURCE });
      }
      for (const r of lignes.filter(x => x.famille === "abonnement" && x.statuts.includes("arrete"))) {
        const autre = lignes.find(x => x.cle_marchand === r.cle_marchand && String(x.compte_id) !== String(r.compte_id) && x.famille !== "habitude" && !x.statuts.includes("arrete"));
        const e = autre ? arrondi(autre.montant_habituel) : 0;
        if (e > 0) ajoute({ cle: "abonnement_arrete_ailleurs_" + r.cle_marchand, poste: r.sous_categorie, titre: "Un abonnement qui passe encore sur un autre compte",
          pourquoi: "Il ne passe plus sur l'un de tes comptes (arrêté ?), mais il est prélevé " + prix(autre.montant_habituel) + " par mois sur un autre.",
          economie_mensuelle: exacte(e), difficulte: "facile", question: "Est-ce le même abonnement qui a changé de compte, et le veux-tu encore ?",
          donnees: { cles_marchand: [r.cle_marchand], montant_annuel: centieme(autre.montant_habituel * 12), nombre: 2 }, source: SOURCE });
      }
      const seuilHabitude = convention(reperes, "budget_piste_habitude_tendance_pct");
      for (const r of lignes.filter(x => x.famille === "habitude" && x.tendance !== null && x.tendance > seuilHabitude + 1e-9)) {
        const e = arrondi(r.total_mensuel * r.tendance / (100 + r.tendance));
        if (e > 0) ajoute({ cle: "habitude_en_hausse_" + r.compte_id + "_" + r.cle_marchand, poste: r.sous_categorie, titre: "Une habitude qui prend de la place",
          pourquoi: "Elle pèse " + prix(r.total_mensuel) + " par mois, " + String(r.tendance).replace(".", ",") + " % de plus que les trois mois d'avant.",
          economie_mensuelle: fourchette(e), difficulte: "moyen", question: "Veux-tu la garder au même rythme, ou en changer un peu ?",
          donnees: { cles_marchand: [r.cle_marchand], montant_annuel: centieme(r.total_mensuel * 12), nombre: Math.round(r.frequence) }, source: SOURCE });
      }
    }
    // logement et voiture : jamais chiffrés par Boussole (le coach en parle si tu le demandes)
    return liste.sort((a, b) => rang(a.difficulte) - rang(b.difficulte) || b.economie_mensuelle.retenue - a.economie_mensuelle.retenue || (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
  }

  /* ================================================================== plancher et repères Insee (§ 8.3, T4, T5) */
  /** Repère du reste à vivre minimal du foyer (RSA forfaitaire) : { repere, valeur } d'après sa composition ({ adultes, enfants }), null si le repère manque. */
  function plancherResteAVivre(foyer, reperes) {
    const f = foyer || {}, adultes = Math.max(1, Math.trunc(n0(f.adultes) || 1)), enfants = Math.max(0, Math.trunc(n0(f.enfants)));
    const val = cle => { const r = (Array.isArray(reperes) ? reperes : []).find(x => x && x.cle === cle); const v = r && nombre(r.valeur); return v === null || v === undefined ? null : v; };
    const jusque2 = Math.min(enfants, 2);
    const cle = (adultes === 1 ? "rsa_forfaitaire_seul" : "rsa_forfaitaire_couple") + (jusque2 ? "_" + jusque2 + (jusque2 > 1 ? "_enfants" : "_enfant") : "");
    const base = val(cle);
    if (base === null) return null;
    const plus = Math.max(0, enfants - 2), supp = val("rsa_forfaitaire_personne_supplementaire");
    if (plus > 0 && supp === null) return null;
    return { repere: cle, valeur: centieme(base + plus * (supp || 0)), personnes_en_plus: plus };
  }
  /** Part du logement (loyer, charges, énergie) dans la consommation (essentiels + envies, hors crédits et impôts) comparée au repère Insee 2017 du ménage (T5) ;
      « au-dessus du repère » n'est jamais une contrainte. `opts` : { logement: "locataire" | "proprietaire", menage: "personne_seule" | … }. */
  function comparerInsee(reference, reperes, opts) {
    const o = opts || {}, ref = normaliserReference(reference, o.preferences);
    const g = (m, k) => m.get(k) || 0;
    const logement = g(ref.essentiels, "loyer") + g(ref.essentiels, "charges_logement") + g(ref.essentiels, "energie");
    const conso = sommeMap(ref.essentiels) + sommeMap(ref.envies) - g(ref.essentiels, "autres_credits") - g(ref.essentiels, "credit_logement") - g(ref.essentiels, "impots");
    if (!(conso > 0)) return null;
    const part = dixieme(logement / conso * 100);
    const cle = o.logement === "proprietaire" ? "insee_bdf2017_logement_proprietaires" : o.logement === "locataire" ? "insee_bdf2017_logement_locataires"
      : "insee_bdf2017_logement_" + (o.menage || "ensemble");
    const val = k => { const r = (Array.isArray(reperes) ? reperes : []).find(x => x && x.cle === k); return r ? nombre(r.valeur) : null; };
    const v = val(cle);
    if (v === null) return null;
    const bornes = o.logement === "locataire" ? [v, val("insee_bdf2017_logement_locataires_q1"), val("insee_bdf2017_logement_locataires_q5")].filter(x => x !== null) : [v];
    const bas = Math.min(...bornes), haut = Math.max(...bornes);
    const lecture = part > haut + 1e-9 ? "au_dessus_du_repere" : part < bas - 1e-9 ? "sous_le_repere" : "dans_le_repere";
    return { logement: arrondi(logement), consommation: arrondi(conso), part, repere: cle, repere_valeur: v, fourchette: bornes.length > 1 ? [bas, haut] : null, lecture,
      texte: "Ton logement pèse " + String(part).replace(".", ",") + " % de ta consommation, contre " + String(v).replace(".", ",") + " % en moyenne" +
        ({ locataire: " pour les locataires", proprietaire: " pour les propriétaires" }[o.logement] || "") + " (Insee, enquête 2017) : " +
        ({ au_dessus_du_repere: "au-dessus de ce repère", sous_le_repere: "sous ce repère", dans_le_repere: "dans ce repère" })[lecture] + ". C'est un point de comparaison, jamais une contrainte." };
  }

  /* ================================================================== cible proposée (§ 8.3) */
  const LEVIERS = ["repousser_date", "baisser_montant", "accepter_moins_de_chances", "revenus"];
  /** Répartition d'un total entre des clés au prorata de leurs références, en euros entiers par la méthode du plus fort reste : planchers, puis +1 € aux plus
      forts restes, à reste égal selon l'ordre de la taxonomie. La somme est exacte. */
  function repartir(total, refs) {
    const cles = trier(refs.keys()), base = somme(cles.map(k => refs.get(k)));
    const out = new Map();
    if (!cles.length) return out;
    if (!(base > 0)) { cles.forEach(k => out.set(k, 0)); return out; }
    const bruts = cles.map(k => ({ k, x: total * refs.get(k) / base }));
    bruts.forEach(b => out.set(b.k, Math.floor(b.x + 1e-9)));
    let reste = Math.round(total) - somme(cles.map(k => out.get(k)));
    const ordre = bruts.map((b, i) => ({ ...b, i, f: b.x - Math.floor(b.x + 1e-9) })).sort((a, b) => (Math.abs(a.f - b.f) < 1e-9 ? a.i - b.i : b.f - a.f));
    for (let j = 0; j < ordre.length && reste > 0; j++, reste--) out.set(ordre[j].k, out.get(ordre[j].k) + 1);
    return out;
  }
  const tauxPct = (m, R) => (R > 0 ? dixieme(m / R * 100) : 0);
  /** Options et cible proposée. `entree` : { reference, capacite_constatee, epargne_necessaire (ou null), matelas_mensuel, pistes, protegees, choix_pistes?, niveau?,
      plancher?: { repere, valeur }, preferences?, reperes?, objectifs?, evaluer?: (épargne mensuelle) → [{ id, probabilite_avant, probabilite_apres }] }.
      → { options: { tenable, equilibree, ambitieuse }, necessaire, retenue, niveau, cible, controles, limite_par_plancher, orientation, atteignable_8_sur_10, leviers, couverture }.
      Contrôles bloquants : controles.somme, controles.protegees, controles.plancher et montants_positifs (aucun bloc ni sous-catégorie négatif : sinon la base refuse
      la cible) ; controles.essentiels_90 est un garde-fou affiché. */
  function proposerCible(data, entree) {
    const e = entree || {}, d = data || {};
    const prefs = e.preferences || d.preferences || {}, reperes = e.reperes || d.reperes;
    const protegees = new Set(Array.isArray(e.protegees) ? e.protegees : Array.isArray(prefs.protegees) ? prefs.protegees : []);
    const ref = normaliserReference(e.reference || d.reference, prefs);
    const R = ref.revenus;
    const C = nombre(e.capacite_constatee) !== null ? e.capacite_constatee : R - sommeMap(ref.essentiels) - sommeMap(ref.envies);
    const N = nombre(e.epargne_necessaire);
    const matelas = n0(e.matelas_mensuel);
    const choix = Array.isArray(e.choix_pistes) ? new Set(e.choix_pistes) : null;
    const toutes = (Array.isArray(e.pistes) ? e.pistes : []).filter(p => p && (p.economie_mensuelle || nombre(p.retenue) !== null) && !protegees.has(p.poste) && (!choix || choix.has(p.cle)));
    const val = p => arrondi(n0(p.economie_mensuelle ? p.economie_mensuelle.retenue : p.retenue));
    const envMod = p => p.cle === "envies_modulables", envFort = p => p.cle === "envies_modulables_fort";
    const faciles = toutes.filter(p => p.difficulte === "facile"), moyennes = toutes.filter(p => p.difficulte === "moyen");
    const hors = moyennes.filter(p => !envMod(p)), fort = toutes.find(envFort), moyenne10 = moyennes.find(envMod);
    const tenable = C + somme(faciles.map(val));
    const equilibree = tenable + somme(moyennes.map(val));
    const ambitieuse = tenable + somme(hors.map(val)) + (fort ? val(fort) : moyenne10 ? val(moyenne10) : 0);
    const options = { tenable: montantOption(tenable, R, "léger"), equilibree: montantOption(equilibree, R, "moyen"), ambitieuse: montantOption(ambitieuse, R, "soutenu") };
    const necessaire = N === null ? null : N + matelas;
    // montant retenu
    let niveau, S;
    if (e.niveau === "tenable" || e.niveau === "equilibree" || e.niveau === "ambitieuse") { niveau = e.niveau; S = { tenable, equilibree, ambitieuse }[niveau]; }
    else if (e.niveau === "necessaire" && necessaire !== null) { niveau = "necessaire"; S = Math.max(tenable, Math.min(necessaire, ambitieuse)); }
    else if (necessaire === null) { niveau = "equilibree"; S = equilibree; }
    else {
      S = Math.max(tenable, Math.min(necessaire, ambitieuse));
      niveau = necessaire >= ambitieuse ? "ambitieuse" : necessaire <= tenable ? "tenable" : "necessaire";
    }
    S = arrondi(S);
    // plancher de reste à vivre
    const plancher = e.plancher && nombre(e.plancher.valeur) !== null ? e.plancher : null;
    let limite = false;
    if (plancher && R - S < plancher.valeur) { S = Math.max(0, Math.floor(R - plancher.valeur + 1e-9)); limite = true; niveau = "personnalisee"; }
    // répartition de l'écart par rapport à la référence : faciles, autres moyennes (contrats…), puis le complément sur les envies modulables
    const refEss = ref.essentiels, refEnv = ref.envies;
    const Cref = R - sommeMap(refEss) - sommeMap(refEnv);
    let reste = S - Cref;
    const prises = [], reductions = new Map();
    let poolEnvies = 0;   // part des économies qui vient des envies modulables (pistes sur « envies » en général, puis le complément)
    const prend = p => {
      const v = Math.min(val(p), Math.max(0, reste));
      if (v <= 0) return;
      prises.push({ cle: p.cle, poste: p.poste, montant: v });
      if (p.poste === "envies") poolEnvies += v; else reductions.set(p.poste, (reductions.get(p.poste) || 0) + v);
      reste -= v;
    };
    faciles.forEach(prend);
    hors.filter(p => p.poste !== "envies").forEach(prend);
    hors.filter(p => p.poste === "envies").forEach(prend);
    const couverture = { faciles: somme(prises.filter(x => faciles.some(p => p.cle === x.cle)).map(x => x.montant)), contrats: somme(prises.filter(x => hors.some(p => p.cle === x.cle)).map(x => x.montant)) };
    const plafondEnvies = fort ? val(fort) : moyenne10 ? val(moyenne10) : 0;
    const complement = poolEnvies + (reste >= 0 ? Math.min(reste, plafondEnvies || reste) : reste);
    couverture.envies = Math.max(0, complement);
    // sous-catégories finales
    const sous = new Map();
    for (const k of trier(refEss.keys())) sous.set(k, refEss.get(k) - (reductions.get(k) || 0));
    for (const k of trier(refEnv.keys())) if (k !== "envies") sous.set(k, refEnv.get(k) - (reductions.get(k) || 0));
    const modulables = trier(refEnv.keys()).filter(k => !protegees.has(k) && k !== "abonnements");
    const poolRefs = new Map(modulables.map(k => [k, refEnv.get(k)]));
    if (modulables.length && complement !== 0) {
      const finalPool = somme(modulables.map(k => poolRefs.get(k))) - complement;
      const rep = repartir(Math.max(0, finalPool), poolRefs);
      for (const k of modulables) sous.set(k, rep.get(k));
    }
    // arrondi des sous-catégories réduites par piste (entiers)
    for (const [k, v] of sous) sous.set(k, arrondi(v));
    const Ess = somme([...refEss.keys()].map(k => sous.get(k))), EnvSous = somme([...refEnv.keys()].map(k => sous.get(k)));
    const Env = R - Ess - S;
    const sousObj = {};
    for (const k of trier(sous.keys())) sousObj[k] = sous.get(k);
    // contrôles
    const plancherEss = convention(reperes, "budget_essentiel_plancher_pct") / 100;
    const controles = {
      somme: Math.abs(Ess + Env + S - R) <= 1 && Math.abs(Ess + EnvSous - (R - S)) <= 1,
      protegees: [...protegees].every(k => !sous.has(k) || sous.get(k) >= (refEss.get(k) ?? refEnv.get(k) ?? 0) - 1e-9),
      plancher: !plancher || (R - S) >= plancher.valeur - 1e-9,
      essentiels_90: [...refEss.keys()].every(k => sous.get(k) >= plancherEss * refEss.get(k) - 1e-9 || prises.some(x => x.poste === k)),
    };
    // bloquant (hors `controles`, dont la forme est celle de la fixture) : une cible n'a jamais de bloc ni de sous-catégorie négatifs (la base les refuse) ;
    // faux quand la capacité constatée est négative ou que les essentiels de référence dépassent les revenus moins l'épargne : la fragilité passe avant la cible
    // (étape 4 de l'expertise), rien n'est à proposer tel quel
    const montantsPositifs = S >= 0 && Ess >= -1e-9 && Env >= -1e-9 && [...sous.values()].every(v => v >= 0);
    const atteignable = necessaire === null ? null : S >= necessaire - 1e-9;
    const cible = { revenus_ref: R, blocs: { essentiels: Ess, envies: Env, epargne: S }, sous_categories: sousObj, protegees: [...protegees], niveau,
      taux_epargne: R > 0 ? centieme(S / R * 100) : 0, source: "Proposée par Claude à partir de tes relevés et de tes objectifs", version_taxonomie: BC.VERSION_TAXONOMIE };
    if (typeof e.evaluer === "function") cible.objectifs = e.evaluer(S);
    else if (Array.isArray(e.objectifs)) cible.objectifs = e.objectifs;
    return { options, necessaire, retenue: S, niveau, taux: cible.taux_epargne, cible, blocs: cible.blocs, sous_categories: sousObj, controles, montants_positifs: montantsPositifs, couverture,
      limite_par_plancher: limite, orientation: limite, atteignable_8_sur_10: atteignable, leviers: atteignable === false ? LEVIERS.slice() : [], pistes_retenues: prises,
      capacite_taux: R > 0 ? dixieme(C / R * 100) : 0 };
  }
  function montantOption(m, R, effort) { return { montant: arrondi(m), taux: tauxPct(arrondi(m), R), effort }; }

  /* ================================================================== le moteur du mois (tâche 7, § 5 et § 6) */
  const r6 = x => (Math.round(x * 1e6) / 1e6) || 0;
  const sansAccent = s => String(s == null ? "" : s).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const jourDe = d => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : d instanceof Date && isFinite(d) ? d.toISOString().slice(0, 10) : null);
  const COMPTES_BUDGET = ["courant", "joint"];
  const HORS_BUDGET_CLES = ["virement_interne", "apport_commun", "transfert_foyer", "releve_carte"];
  /** Part de p1 dans le commun (config.partage : égal, apports ou fixe → toujours `p1`, 0,5 par défaut). */
  function partageDe(config) {
    const p = config && typeof config.partage === "object" && config.partage ? config.partage : {};
    const p1 = nombre(p.p1);
    return { mode: p.mode === "apports" || p.mode === "fixe" ? p.mode : "egal", p1: p1 !== null && p1 >= 0 && p1 <= 1 ? p1 : 0.5 };
  }
  /** Mois bancaires lus par l'app → données du moteur. `S` : le store (banque, relevesBancaires, config, savoir…) ; `opts.aujourdhui` : date du jour (AAAA-MM-JJ).
      Les mois viennent de `Calc.moisBancaires` (Powens et relevés importés de HIS2, jamais les deux pour un compte et un mois) ; ne restent que les comptes du budget
      (courant ou joint, ni ignoré ni en double, actif) et les cartes à débit différé importées que moisBancaires retient. Un mois importé `complet: false` n'entre jamais
      au budget (il est listé dans `incomplets`, ce qui rend le mois « sans note »).
      → { aujourdhui, comptes: [{ id, libelle, type, titulaire, origine, solde? }], releves: [{ compte, mois, source, categories: [{ sous, categorie, entrees, sorties, nombre,
      sans_detail }], ecarte }], incomplets: [{ compte, mois }], ecartes, partage, preferences, regles, cible, reperes, marchands, operations, mois, reference }. */
  function donnees(S, opts) {
    const o = opts || {}, s = S || {}, Calc = D.Calc;
    const aujourdhui = jourDe(o.aujourdhui) || jourDe(s.aujourdhui) || jourDe(s.today) || new Date().toISOString().slice(0, 10);
    const banque = s.banque && typeof s.banque === "object" ? s.banque : null;
    const b = banque && banque.actif !== false ? banque : { mois: [], comptes: [] };
    const hist = s.relevesBancaires && typeof s.relevesBancaires === "object" ? s.relevesBancaires : null;
    const serie = Calc.moisBancaires(b, hist, aujourdhui);
    const doublon = c => (c.doublonDe !== undefined ? c.doublonDe : c.doublon_de);
    const powens = new Map((Array.isArray(b.comptes) ? b.comptes : []).filter(c => c && c.id != null).map(c => [String(c.id), c]));
    const importes = new Map((hist && Array.isArray(hist.comptes) ? hist.comptes : []).filter(Boolean).map(c => [String(c.id), c]));
    const rattaches = new Map([...importes.values()].filter(c => (c.banqueCompteId ?? c.banque_compte_id) != null).map(c => [String(c.banqueCompteId ?? c.banque_compte_id), c]));
    const detaille = new Set(serie.filter(e => e.compte != null).map(e => e.mois));
    const comptes = new Map(), releves = [], incomplets = [], ecartes = [];
    for (const e of serie) {
      if (e.compte == null && detaille.has(e.mois)) continue;   // totaux par utilisateur d'un mois détaillé par compte : écartés (comme Calc.moisCourants)
      const cle = e.compte == null ? "tous" : String(e.compte);
      const h = cle.startsWith("h:") ? importes.get(cle.slice(2)) : rattaches.get(cle), p = powens.get(cle);
      const type = e.type || (p && p.type) || (h && h.type) || "courant";
      if (!COMPTES_BUDGET.includes(type) && type !== "carte_differe") continue;
      if (p && (p.ignore === true || doublon(p) != null || p.actif === false)) continue;
      if (e.ecarte && e.ecarte.length) for (const x of e.ecarte) ecartes.push({ compte: cle, mois: e.mois, ...x });
      if (e.source !== null && comptes.has(cle)) delete comptes.get(cle).ecartee;
      if (!comptes.has(cle)) {
        const titulaire = (p && p.titulaire) || (h && h.titulaire) || null;
        const c = { id: cle, libelle: (p && (p.nom || p.libelle)) || (h && h.libelle) || (cle === "tous" ? "Tous les comptes connectés" : "Compte"), type, titulaire,
          origine: p ? "banque" : "import" };
        if (p && nombre(p.solde) !== null) c.solde = nombre(p.solde);
        if (p && p.pret) c.pret = p.pret;
        if (p && p.debit_differe === true) c.debit_differe = true;
        if (e.source === null) c.ecartee = true;                 // carte comptée sur le courant : écartée par moisBancaires, jamais « absente »
        comptes.set(cle, c);
      }
      if (e.source === null) continue;
      if (e.source === "import" && e.releve && e.releve.complet === false) { incomplets.push({ compte: cle, mois: e.mois }); continue; }
      const categories = (Array.isArray(e.categories) ? e.categories : []).filter(Boolean).map(l => {
        const valide = BC.estSousCategorie(l.sous_categorie);
        return { sous: valide ? l.sous_categorie : BC.parDefautDe(sansAccent(l.categorie)), categorie: l.categorie, entrees: n0(l.entrees), sorties: n0(l.sorties),
          nombre: n0(l.nombre), sans_detail: !valide };
      });
      releves.push({ compte: cle, mois: e.mois, source: e.source, categories, ecarte: e.ecarte || [] });
    }
    // comptes du budget connus sans mois (ils comptent dans « comptes absents ») : les comptes courants de la banque et des relevés
    for (const [id, p] of powens) {
      if (comptes.has(id) || !COMPTES_BUDGET.includes(p.type) || p.ignore === true || doublon(p) != null || p.actif === false) continue;
      const c = { id, libelle: p.nom || p.libelle || "Compte", type: p.type, titulaire: p.titulaire || null, origine: "banque" };
      if (nombre(p.solde) !== null) c.solde = nombre(p.solde);
      if (p.pret) c.pret = p.pret;
      if (p.debit_differe === true) c.debit_differe = true;
      comptes.set(id, c);
    }
    const config = s.config && typeof s.config === "object" ? s.config : {};
    const savoir = s.savoir && Array.isArray(s.savoir.reperes) ? s.savoir.reperes : Array.isArray(s.reperes) ? s.reperes : [];
    const data = { aujourdhui, comptes: [...comptes.values()], releves, incomplets, ecartes, partage: partageDe(config), preferences: config.budget_preferences || {},
      regles: Array.isArray(s.regles) ? s.regles : Array.isArray(s.budgetRegles) ? s.budgetRegles : [], cible: config.budget_cible || null, reperes: savoir,
      marchands: Array.isArray(b.marchands) ? b.marchands : Array.isArray(s.marchands) ? s.marchands : [], operations: Array.isArray(b.operations) ? b.operations : [] };
    // formes que lisent `detections` et `pistes` (§ 6.4, § 8.2) : capacités des 6 derniers mois complets et référence du foyer
    const courant = mois7(aujourdhui);
    data.mois = Array.from({ length: 6 }, (_, i) => decale(courant, i - 6)).map(m => ({ m, M: mois(data, { vue: "tout", mois: m }) }))
      .filter(x => x.M.couverture.comptes_observes > 0).map(x => ({ mois: x.m, capacite: x.M.capacite }));
    data.reference = reference(data, { vue: "tout" });
    return data;
  }

  const titulaireDe = (data, id) => { const c = data.comptes.find(x => x.id === String(id)); return c ? c.titulaire : null; };
  /** Poids d'un compte dans une vue : Tout, tous à 100 % ; Commun, les comptes communs à 100 % ; Perso, les comptes de la personne à 100 % et les comptes communs
      à sa part (un compte sans titulaire n'est que dans Tout). */
  function poidsDe(titulaire, vue, personne, part) {
    if (vue === "commun") return titulaire === "commun" ? 1 : 0;
    if (vue === "perso") return titulaire === personne ? 1 : titulaire === "commun" ? part : 0;
    return 1;
  }
  const VUES = ["tout", "commun", "perso"];
  function lectureVue(data, o) {
    const vue = VUES.includes(o && o.vue) ? o.vue : "tout";
    const personne = vue === "perso" ? (o.personne === "p2" ? "p2" : "p1") : null;
    const p1 = (data.partage && data.partage.p1) ?? 0.5;
    return { vue, personne, part: personne === "p2" ? 1 - p1 : p1 };
  }

  /** Le mois `M` d'une vue (§ 6.1) : revenus, blocs, hors budget, sous-catégories, capacité, épargne, lissage des dépenses annuelles et couverture.
      `opts` : { vue: "tout" | "commun" | "perso", personne?: "p1" | "p2", mois: "AAAA-MM" }. Les montants sont en euros exacts (arrondis seulement à l'affichage). */
  function mois(data, opts) {
    const o = opts || {}, d = data || {}, m = mois7(o.mois);
    const { vue, personne, part } = lectureVue(d, o);
    const courant = mois7(d.aujourdhui);
    const comptes = (d.comptes || []).filter(c => poidsDe(c.titulaire, vue, personne, part) > 0);
    const rel = (d.releves || []).filter(r => r.mois === m && poidsDe(titulaireDe(d, r.compte), vue, personne, part) > 0);
    const base = {
      mois: m, vue, personne, en_cours: !!courant && m === courant, mois_complet: !!courant && !!m && m < courant, revenus: 0,
      blocs: { essentiels: 0, envies: 0, epargne: 0 }, a_classer: 0, depenses: 0, hors_budget: { virement_interne: 0, apport_commun: 0, transfert_foyer: 0, releve_carte: 0 },
      par_sous_categorie: {}, revenus_detail: {}, capacite: 0, epargne_versee: 0, epargne_restee: 0, puise: 0, sources: [],
      lisse: { annuelles: [], essentiels_lisses: 0, envies_lisses: 0 }, mentions: [],
    };
    const couv = { a_classer_part: 0, comptes_observes: 0, comptes_absents: [], mois_complet: base.mois_complet, sans_detail: false, import_incomplet: false, en_partie_importe: false, ecartes: [] };
    if (vue === "perso" && !(d.comptes || []).some(c => c.titulaire === personne)) return { ...base, vide: "aucun_compte_personne", couverture: { ...couv, comptes_absents: comptes.map(c => c.id) } };
    const communObserve = rel.some(r => titulaireDe(d, r.compte) === "commun");
    const acc = new Map(), hb = new Map(HORS_BUDGET_CLES.map(k => [k, { sorties: 0, entrees: 0 }])), rev = new Map();
    let revenus = 0, apportsRecusCommun = 0, apportsVersesPerso = 0, nonDetaille = false;
    const ajoute = (sous, w, l) => { const a = acc.get(sous) || { sorties: 0, entrees: 0, nombre: 0 }; a.sorties += w * l.sorties; a.entrees += w * l.entrees; a.nombre += l.nombre; acc.set(sous, a); };
    for (const r of rel) {
      const t = titulaireDe(d, r.compte), w = poidsDe(t, vue, personne, part), commun = t === "commun";
      for (const l of r.categories) {
        const bloc = blocDe(l.sous, d.preferences);
        if (l.sous === "apport_commun") {
          // apports nets : un virement du commun vers un compte personnel (sortie côté commun, entrée côté perso) diminue les apports
          if (commun) apportsRecusCommun += l.entrees - l.sorties; else apportsVersesPerso += l.sorties - l.entrees;
          if (vue === "perso" && commun) continue;                 // remplacé par ta part des dépenses du commun
          if (vue === "commun") { if (commun) revenus += l.entrees - l.sorties; continue; }
          if (!communObserve && !commun) { ajoute("commun_non_detaille", w, l); nonDetaille = true; continue; }
          const h = hb.get("apport_commun"); h.sorties += w * l.sorties; h.entrees += w * l.entrees; continue;
        }
        if (l.sous === "transfert_foyer") {
          if (vue === "commun" || (vue === "perso" && commun)) continue;
          const h = hb.get("transfert_foyer"); h.sorties += w * l.sorties; h.entrees += w * l.entrees;
          if (vue === "perso") revenus += w * (l.entrees - l.sorties);
          continue;
        }
        if (bloc === "hors_budget") { const h = hb.get(l.sous); if (h) { h.sorties += w * l.sorties; h.entrees += w * l.entrees; } continue; }
        if (bloc === "revenus") { const v = w * (l.entrees - l.sorties); revenus += v; rev.set(l.sous, (rev.get(l.sous) || 0) + v); continue; }
        ajoute(l.sous, w, l);
      }
    }
    // apports reçus sur le commun depuis un compte non observé : revenus de l'ensemble du foyer (Tout), pas de la personne
    let externes = 0;
    if (vue === "tout" && communObserve) { externes = Math.max(0, apportsRecusCommun - apportsVersesPerso); revenus += externes; }
    const par = {}, bl = { essentiels: 0, envies: 0, epargne: 0, a_classer: 0 };
    for (const sous of trier(acc.keys())) {
      const a = acc.get(sous), net = r6(a.sorties - a.entrees);
      par[sous] = { sorties: r6(a.sorties), entrees: r6(a.entrees), net, nombre: a.nombre };
      bl[blocDe(sous, d.preferences)] = (bl[blocDe(sous, d.preferences)] || 0) + net;
    }
    const hors = {};
    for (const [k, h] of hb) hors[k] = r6(h.sorties > 0 ? h.sorties : h.entrees);
    const depenses = r6(bl.essentiels + bl.envies + bl.a_classer), capacite = r6(revenus - depenses), versee = r6(bl.epargne);
    // part « à classer » (§ 7.3) lue sur les sorties brutes : une entrée inconnue (virement reçu d'un proche, vente) range en « à classer » et diminue son net,
    // elle ne doit pas masquer des sorties qui restent à classer (ni rendre la part négative)
    let sortiesDepenses = 0;
    for (const [sous, a] of acc) { const b = blocDe(sous, d.preferences); if (b === "essentiels" || b === "envies" || b === "a_classer") sortiesDepenses += a.sorties; }
    const sortiesAClasser = acc.has("a_classer") ? acc.get("a_classer").sorties : 0;
    const sources = rel.map(r => ({ compte: r.compte, origine: r.source === "import" ? "import" : "banque", titulaire: titulaireDe(d, r.compte) }));
    const incompl = (d.incomplets || []).some(x => x.mois === m && poidsDe(titulaireDe(d, x.compte), vue, personne, part) > 0);
    const observes = new Set(rel.map(r => r.compte));
    const res = { ...base, revenus: r6(revenus), blocs: { essentiels: r6(bl.essentiels), envies: r6(bl.envies), epargne: versee }, a_classer: r6(bl.a_classer), depenses,
      hors_budget: hors, par_sous_categorie: par, revenus_detail: Object.fromEntries([...rev].map(([k, v]) => [k, r6(v)])), capacite, epargne_versee: versee,
      epargne_restee: r6(capacite - versee), puise: r6(Math.max(0, -capacite)), sources };
    if (nonDetaille) res.mentions.push("commun_non_connecte");
    if (externes > 0) res.mentions.push("apports_externes");
    if (rel.some(r => r.categories.some(l => l.sans_detail))) res.mentions.push("mois_sans_detail");
    // carte à débit différé sans détail ce mois-ci alors que le mois compte des opérations à classer : le relevé n'a pas pu être identifié (§ 4.5)
    if (res.a_classer > 0 && comptes.some(c => c.debit_differe === true && !observes.has(c.id))) res.mentions.push("detail_carte_indisponible");
    res.couverture = { ...couv, a_classer_part: sortiesDepenses > 0 ? r6(sortiesAClasser / sortiesDepenses) : 0, comptes_observes: observes.size,
      comptes_absents: comptes.filter(c => !observes.has(c.id) && c.ecartee !== true).map(c => c.id), sans_detail: res.mentions.includes("mois_sans_detail"), import_incomplet: incompl,
      en_partie_importe: sources.some(x => x.origine === "import") && sources.some(x => x.origine !== "import"), apports_externes: r6(externes),
      ecartes: (d.ecartes || []).filter(x => x.mois === m && poidsDe(titulaireDe(d, x.compte), vue, personne, part) > 0) };
    res.lisse = lissage(d, { vue, personne, part }, m, res);
    return res;
  }

  /* ================================================================== dépenses annuelles et lissage (§ 6.3) */
  /** Dépenses annuelles de la vue, d'après les agrégats par marchand : une règle `annuelle: true`, ou une clé qui n'apparaît qu'une fois sur les 13 mois (ou deux fois à
      11 à 13 mois d'écart, « confirmée ») avec une sous-catégorie « annuelle probable » ou un montant d'au moins `budget_annuelle_seuil`. Seules les dépenses des blocs
      essentiels et envies se lissent. → [{ compte_id, cle_marchand, sous_categorie, regle_id, confirmee, paiements: [{ mois, montant }] }] (montants à 100 %). */
  function annuelles(data, v) {
    const d = data || {}, seuil = convention(d.reperes, "budget_annuelle_seuil"), regles = (d.regles || []).filter(r => r && r.annuelle === true && r.active !== false);
    const groupes = new Map();
    for (const l of Array.isArray(d.marchands) ? d.marchands : []) {
      if (!l || !mois7(l.mois) || !(n0(l.sorties) > 0) || !l.cle_marchand) continue;
      if (poidsDe(titulaireDe(d, l.compte_id), v.vue, v.personne, v.part) <= 0) continue;
      const bloc = blocDe(l.sous_categorie, d.preferences);
      if (bloc !== "essentiels" && bloc !== "envies") continue;
      const k = [String(l.compte_id), l.cle_marchand, l.sous_categorie].join("|");
      if (!groupes.has(k)) groupes.set(k, { compte_id: String(l.compte_id), cle_marchand: l.cle_marchand, sous_categorie: l.sous_categorie, par_mois: new Map(), max: 0 });
      const g = groupes.get(k), m = mois7(l.mois);
      g.par_mois.set(m, (g.par_mois.get(m) || 0) + n0(l.sorties));
      g.max = Math.max(g.max, nombre(l.montant_max) ?? n0(l.sorties));
    }
    const sorties = [];
    for (const g of groupes.values()) {
      const paiements = [...g.par_mois].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([mo, montant]) => ({ mois: mo, montant: r6(montant) }));
      const regle = regles.find(r => r.sous_categorie === g.sous_categorie && BC.correspond(r, { libelle: g.cle_marchand, montant: -g.max, compte_id: g.compte_id }));
      const taxo = BC.TAXONOMIE.find(t => t.cle === g.sous_categorie);
      let annuelle = false, confirmee = false;
      if (regle) annuelle = confirmee = true;
      else {
        const gros = paiements.every(p => p.montant >= seuil) || !!(taxo && taxo.annuelle_probable);
        if (paiements.length === 1 && gros) annuelle = true;
        else if (paiements.length === 2 && gros) {
          const ecart = (+paiements[1].mois.slice(0, 4) * 12 + +paiements[1].mois.slice(5)) - (+paiements[0].mois.slice(0, 4) * 12 + +paiements[0].mois.slice(5));
          if (ecart >= 11 && ecart <= 13) annuelle = confirmee = true;
        }
      }
      if (annuelle) sorties.push({ compte_id: g.compte_id, cle_marchand: g.cle_marchand, sous_categorie: g.sous_categorie, regle_id: regle ? regle.id ?? null : null, confirmee, paiements });
    }
    return sorties.sort((a, b) => (a.cle_marchand < b.cle_marchand ? -1 : a.cle_marchand > b.cle_marchand ? 1 : a.compte_id < b.compte_id ? -1 : 1));
  }
  /** Lissage du mois `m` : chaque dépense annuelle compte pour 1/12 de son dernier montant les 12 mois qui suivent son paiement (provision) ; le mois du paiement garde
      le réel dans `blocs` (graphiques) et la note lit `essentiels_lisses` / `envies_lisses`. */
  function lissage(data, v, m, M) {
    const items = [];
    let ess = M.blocs.essentiels, env = M.blocs.envies;
    for (const a of annuelles(data, v)) {
      const w = poidsDe(titulaireDe(data, a.compte_id), v.vue, v.personne, v.part);
      const reel = a.paiements.filter(p => p.mois === m).reduce((t, p) => t + p.montant, 0);
      const dernier = a.paiements.filter(p => p.mois <= m).pop();
      const age = dernier ? (+m.slice(0, 4) * 12 + +m.slice(5)) - (+dernier.mois.slice(0, 4) * 12 + +dernier.mois.slice(5)) : null;
      const provision = dernier && age <= 11 ? dernier.montant / 12 : 0;
      if (!(reel > 0) && !(provision > 0)) continue;
      const montant_mois = r6(reel * w), prov = r6(provision * w);
      items.push({ sous_categorie: a.sous_categorie, compte_id: a.compte_id, cle_marchand: a.cle_marchand, regle_id: a.regle_id, confirmee: a.confirmee, montant_mois, provision: prov });
      const delta = prov - montant_mois;
      if (blocDe(a.sous_categorie, data.preferences) === "envies") env += delta; else ess += delta;
    }
    return { annuelles: items, essentiels_lisses: r6(ess), envies_lisses: r6(env) };
  }

  /* ================================================================== série, agrégation et référence */
  /** Mois AAAA-MM de `du` à `au` (inclus). */
  function moisDe(du, au) {
    const a = mois7(du), b = mois7(au), out = [];
    if (!a || !b) return out;
    for (let m = a; m <= b && out.length < 600; m = decale(m, 1)) out.push(m);
    return out;
  }
  const GRANULARITES_BUDGET = ["mois", "trimestre", "annee"];
  function agreger(ms, cle, granularite) {
    const somme_ = f => r6(somme(ms.map(f)));
    const par = {};
    for (const M of ms) for (const [k, a] of Object.entries(M.par_sous_categorie)) {
      const t = par[k] || (par[k] = { sorties: 0, entrees: 0, net: 0, nombre: 0 });
      t.sorties = r6(t.sorties + a.sorties); t.entrees = r6(t.entrees + a.entrees); t.net = r6(t.net + a.net); t.nombre += a.nombre;
    }
    const hors = {};
    for (const k of HORS_BUDGET_CLES) hors[k] = somme_(M => M.hors_budget[k]);
    const capacite = somme_(M => M.capacite), versee = somme_(M => M.epargne_versee), depenses = somme_(M => M.depenses), ac = somme_(M => M.a_classer);
    const premier = ms[0] || {};
    return { mois: cle, granularite, vue: premier.vue, personne: premier.personne, mois_inclus: ms.map(M => M.mois), en_cours: ms.some(M => M.en_cours), mois_complet: ms.length > 0 && ms.every(M => M.mois_complet),
      revenus: somme_(M => M.revenus), blocs: { essentiels: somme_(M => M.blocs.essentiels), envies: somme_(M => M.blocs.envies), epargne: versee }, a_classer: ac, depenses,
      hors_budget: hors, par_sous_categorie: par, capacite, epargne_versee: versee, epargne_restee: r6(capacite - versee), puise: r6(Math.max(0, -capacite)),
      sources: [], mentions: [...new Set(ms.flatMap(M => M.mentions))],
      lisse: { annuelles: ms.flatMap(M => M.lisse.annuelles), essentiels_lisses: somme_(M => M.lisse.essentiels_lisses), envies_lisses: somme_(M => M.lisse.envies_lisses) },
      couverture: { a_classer_part: depenses > 0 ? r6(ac / depenses) : 0, comptes_observes: Math.max(0, ...ms.map(M => M.couverture.comptes_observes)),
        comptes_absents: [...new Set(ms.flatMap(M => M.couverture.comptes_absents))], mois_complet: ms.length > 0 && ms.every(M => M.mois_complet), sans_detail: ms.some(M => M.couverture.sans_detail),
        import_incomplet: ms.some(M => M.couverture.import_incomplet), en_partie_importe: ms.some(M => M.couverture.en_partie_importe), ecartes: ms.flatMap(M => M.couverture.ecartes) } };
  }
  /** Série de mois, de trimestres ou d'années entre `du` et `au` (AAAA-MM ou AAAA-MM-JJ) : un `M` par période (les périodes sans compte observé gardent des zéros et
      `couverture.comptes_observes: 0`). `opts` : { vue, personne?, du, au, granularite: "mois" | "trimestre" | "annee" }. */
  function serie(data, opts) {
    const o = opts || {}, g = GRANULARITES_BUDGET.includes(o.granularite) ? o.granularite : "mois";
    const ms = moisDe(o.du, o.au).map(m => mois(data, { vue: o.vue, personne: o.personne, mois: m }));
    if (g === "mois") return ms;
    const groupes = new Map();
    for (const M of ms) { const k = D.Periodes.cle(M.mois + "-01", g); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(M); }
    return [...groupes].map(([k, l]) => agreger(l, k, g));
  }

  /** Référence (§ 6.2) : ce que tu dépenses d'habitude. Médiane mensuelle de chaque sous-catégorie sur les `mois_ref` (12) derniers mois complets quand ils existent (au moins 6,
      sinon 3 à 5 avec `periode_courte: true` ; moins de 3 : null). Les dépenses annuelles sont lissées (total ÷ 12) avant la médiane ; un mois importé incomplet ou sans détail n'y entre
      jamais. → { vue, personne, du, au, n, periode_courte, revenus, essentiels, envies, epargne, a_classer, par_sous_categorie, totaux, annuelles } ou null. */
  function reference(data, opts) {
    const o = opts || {}, d = data || {}, courant = mois7(d.aujourdhui);
    if (!courant) return null;
    const k = Math.max(3, Math.min(24, Math.trunc(nombre(o.mois_ref) || 12)));
    const candidats = Array.from({ length: k }, (_, i) => decale(courant, i - k)).map(m => mois(d, { vue: o.vue, personne: o.personne, mois: m }))
      .filter(M => M.couverture.comptes_observes > 0 && !M.couverture.import_incomplet && !M.couverture.sans_detail);
    const n = candidats.length;
    if (n < 3) return null;
    const lisseDe = (M, sous) => {
      const reel = M.par_sous_categorie[sous] ? M.par_sous_categorie[sous].net : 0;
      return reel + somme(M.lisse.annuelles.filter(a => a.sous_categorie === sous).map(a => a.provision - a.montant_mois));
    };
    const cles = new Set(); candidats.forEach(M => { Object.keys(M.par_sous_categorie).forEach(c => cles.add(c)); M.lisse.annuelles.forEach(a => cles.add(a.sous_categorie)); });
    const par = {}, blocs = { essentiels: {}, envies: {}, epargne: {}, a_classer: {} };
    for (const c of trier(cles)) {
      const med = r6(mediane(candidats.map(M => lisseDe(M, c))));
      if (!(med > 0)) continue;
      par[c] = med;
      const b = blocDe(c, d.preferences);
      if (blocs[b]) blocs[b][c] = med;
    }
    const v = lectureVue(d, o);
    const vues = { vue: v.vue, personne: v.personne };
    const annuellesVue = annuelles(d, v).map(a => { const dernier = a.paiements[a.paiements.length - 1]; return { sous_categorie: a.sous_categorie, cle_marchand: a.cle_marchand, compte_id: a.compte_id,
      montant_annuel: dernier.montant, mensuel: r6(dernier.montant / 12), confirmee: a.confirmee }; });
    return { ...vues, du: candidats[0].mois, au: candidats[n - 1].mois, n, periode_courte: n < 6, revenus: r6(mediane(candidats.map(M => M.revenus))), essentiels: blocs.essentiels,
      envies: blocs.envies, epargne: blocs.epargne, a_classer: blocs.a_classer.a_classer || 0, par_sous_categorie: par,
      totaux: { essentiels: r6(somme(Object.values(blocs.essentiels))), envies: r6(somme(Object.values(blocs.envies))), epargne: r6(somme(Object.values(blocs.epargne))) },
      annuelles: annuellesVue };
  }

  /* ================================================================== le récurrent (§ 6.5, tâche 9b) */
  /* Règles exactes : `conventions_recurrents` et cas R1 à R8 de test/fixtures/budget-cas.json (D18). Calculs en centimes (entiers ou demi-centimes), arrondis à la sortie
     seulement (demi-centime vers l'extérieur, pourcentages et fréquences au dixième). */
  const SOUS_ENGAGEMENT = ["loyer", "credit_logement", "autres_credits", "assurances", "telecom", "energie", "charges_logement", "enfants", "impots"];
  const SOUS_ABONNEMENT = ["abonnements", "sport"];
  const BLOCS_EXCLUS = ["hors_budget", "epargne", "revenus"];
  const PERIODES_RYTHME = { mensuel: { mois: 1, jours: 30, cout: 12 }, trimestriel: { mois: 3, jours: 91, cout: 4 }, annuel: { mois: 12, jours: 365, cout: 1 } };
  const cts = x => Math.round(n0(x) * 100);
  const arrondiExt = x => (x < 0 ? -1 : 1) * Math.floor(Math.abs(x) + 0.5 + 1e-7);
  const euroC = (c, part) => arrondiExt(c * (part === undefined ? 1 : part)) / 100;
  const dixiemeExt = x => arrondiExt(x * 10) / 10;
  const ecartMois = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  const joursEntre = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
  /** Date AAAA-MM-JJ décalée de k mois, le jour ramené au dernier jour du mois quand il n'existe pas (31 août + 3 mois = 30 novembre). */
  function plusMois(date, k) {
    const m = decale(date.slice(0, 7), k), dernier = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
    return m + "-" + String(Math.min(+date.slice(8, 10), dernier)).padStart(2, "0");
  }
  /** Paliers d'une suite de montants (centimes) : un montant rejoint le palier courant s'il est à ±10 % de sa médiane (bornes comprises), sinon il en ouvre un. */
  function paliersDe(montants, tol) {
    const t = tol === undefined ? 0.1 : tol, P = [];
    for (const a of montants) {
      const cur = P[P.length - 1], med = cur ? mediane(cur) : 0;
      if (cur && Math.abs(a - med) <= med * t + 1e-9) cur.push(a); else P.push([a]);
    }
    return P;
  }
  const suiteDeMots = (a, b) => contient(motsDe(a), motsDe(b)) || contient(motsDe(b), motsDe(a));

  /** Lecture commune du récurrent, des variations et de l'inhabituel : lignes de `banque_marchands_mois` de la vue, de m0 − 12 à m0, regroupées par
      (compte, clé, sous-catégorie) ; flux exclus (hors budget, épargne, revenus) et lignes sans sortie ignorés ; premier mois des données de la vue. */
  function lectureRecurrent(data, opts) {
    const d = data || {}, o = opts || {}, v = lectureVue(d, o), m0 = mois7(d.aujourdhui);
    if (!m0) return null;
    const debut = decale(m0, -12), connus = new Map((Array.isArray(d.comptes) ? d.comptes : []).filter(c => c && c.id != null).map(c => [String(c.id), c]));
    const poids = id => {
      const c = connus.get(String(id));
      if (!c) return v.vue === "tout" ? 1 : 0;                      // compte inconnu : compté dans Tout seulement
      if (!COMPTES_BUDGET.includes(c.type) && !(c.type === "carte_differe")) return 0;
      return poidsDe(c.titulaire, v.vue, v.personne, v.part);
    };
    const seuil = convention(d.reperes, "budget_annuelle_seuil");
    const groupes = new Map();
    let premier = null;
    for (const l of Array.isArray(d.marchands) ? d.marchands : []) {
      const m = l && mois7(l.mois);
      if (!m || m < debut || m > m0) continue;
      const w = poids(l.compte_id);
      if (!(w > 0)) continue;
      if (premier === null || m < premier) premier = m;
      const sous = l.sous_categorie, bloc = BC.estSousCategorie(sous) ? blocDe(sous, d.preferences) : "a_classer";
      if (BLOCS_EXCLUS.includes(bloc) || !(n0(l.sorties) > 0)) continue;
      const cle = l.cle_marchand == null ? "" : String(l.cle_marchand);
      const k = [String(l.compte_id), cle, sous].join("\u0001");
      if (!groupes.has(k)) groupes.set(k, { compte_id: l.compte_id, cle, sous, w, mois: new Map() });
      const g = groupes.get(k), s = cts(l.sorties), cur = g.mois.get(m) || { s: 0, n: 0, max: 0, jour: null };
      cur.s += s; cur.n += nombre(l.nombre_sorties) !== null ? n0(l.nombre_sorties) : n0(l.nombre);
      cur.max = Math.max(cur.max, nombre(l.montant_max) !== null ? cts(l.montant_max) : s);
      if (nombre(l.dernier_jour) !== null) cur.jour = Math.max(cur.jour || 0, nombre(l.dernier_jour));
      g.mois.set(m, cur);
    }
    return { d, v, m0, debut, premier, groupes: [...groupes.values()], seuil, aujourdhui: jourDe(d.aujourdhui), couverts: premier === null ? 0 : Math.max(0, ecartMois(premier, m0)) };
  }
  const indisponible = (mois_couverts) => ({ disponible: false, raison: "moins_de_3_mois", mois_couverts });

  /** Rythme, paliers, famille et statuts d'un groupe (lu à sa dernière présence). */
  function analyserGroupe(g, ctx) {
    const { m0, seuil, premier } = ctx;
    const pres = [...g.mois.keys()].filter(m => g.mois.get(m).s > 0).sort();
    const ancre = pres[pres.length - 1], complet = m => m < m0, S = m => (g.mois.has(m) ? g.mois.get(m).s : 0), N = m => (g.mois.has(m) ? g.mois.get(m).n : 0);
    const mois3 = [decale(m0, -3), decale(m0, -2), decale(m0, -1)], mois3avant = [decale(m0, -6), decale(m0, -5), decale(m0, -4)];
    const dans = (fin, k) => pres.filter(m => ecartMois(m, fin) >= 0 && ecartMois(m, fin) < k);
    let rythme = null, annuel = null, fenetre = [];
    if (dans(ancre, 4).length >= 3) { rythme = "mensuel"; fenetre = Array.from({ length: 4 }, (_, i) => decale(ancre, i - 3)); }
    else if (dans(ancre, 6).length >= 5) { rythme = "mensuel"; fenetre = Array.from({ length: 6 }, (_, i) => decale(ancre, i - 5)); }
    else if (pres.length >= 3 && [ecartMois(pres[pres.length - 3], pres[pres.length - 2]), ecartMois(pres[pres.length - 2], pres[pres.length - 1])].every(e => e >= 2 && e <= 4)) {
      rythme = "trimestriel"; fenetre = pres.slice(-3);
    } else if (pres.length === 2 && ecartMois(pres[0], pres[1]) >= 11 && ecartMois(pres[0], pres[1]) <= 13) { rythme = "annuel"; annuel = "confirme"; fenetre = pres.slice(); }
    else if (pres.length === 1 && complet(pres[0]) && (((BC.TAXONOMIE.find(t => t.cle === g.sous) || {}).annuelle_probable === true) || S(pres[0]) >= seuil * 100)) { rythme = "annuel"; annuel = "probable"; fenetre = pres.slice(); }
    const presFenetre = pres.filter(m => fenetre.includes(m));
    const montants = presFenetre.filter(complet).map(S), P = paliersDe(montants);
    const stable = montants.length >= 1 && P.length <= 2, nombreOk = presFenetre.every(m => N(m) <= 2);
    const famMarchand = familleDe(g.cle);
    // habitude : fréquence, ou montant variable sur les 4 derniers mois complets
    const somS = somme(mois3.map(S)), somN = somme(mois3.map(N));
    const m4 = [decale(m0, -4), ...mois3].filter(m => pres.includes(m));
    const habitude = somN >= 12 || (m4.length >= 3 && paliersDe(m4.map(S)).length >= 2);
    let famille = "ponctuel";
    if (g.cle !== "" && rythme !== null && stable && nombreOk) famille = SOUS_ENGAGEMENT.includes(g.sous) ? "engagement" : (SOUS_ABONNEMENT.includes(g.sous) || famMarchand) ? "abonnement" : "ponctuel";
    if (famille === "ponctuel" && g.cle !== "" && habitude) famille = "habitude";
    const r = { g, pres, ancre, rythme, annuel, famille, famMarchand, fenetre, montants, paliers: P, somS, somN, hausse: null, arrete: false, nouveau: false, statuts: [] };
    if (famille === "ponctuel") return r;
    const j = g.mois.get(ancre).jour;
    r.derniere = j === null ? null : ancre + "-" + String(j).padStart(2, "0");
    if (famille === "habitude") {
      r.habituel = mediane(mois3.map(S)); r.total = somS / 3; r.cout = somS * 4; r.frequence = somN / 3; r.panier = somN > 0 ? somS / somN : null;
      const couvert = mois3avant.every(m => premier !== null && m >= premier), base = somme(mois3avant.map(S));
      r.tendance = couvert && base > 0 ? (somS - base) / base * 100 : null;
    } else {
      const per = PERIODES_RYTHME[rythme], dernierPalier = P[P.length - 1];
      r.habituel = mediane(dernierPalier); r.cout = r.habituel * per.cout;
      if (pres.length >= 4) {
        const ref = mediane(pres.slice(-4, -1).map(S)), cond = a => a * 100 > ref * 105 + 1e-9 && a - ref >= 100 - 1e-9;
        if (cond(S(ancre))) {
          let i = pres.length - 1;
          while (i >= 0 && cond(S(pres[i]))) i--;
          r.hausse = { ancien: ref, nouveau: S(ancre), depuis: pres[i + 1] };
        }
      }
      r.arrete = r.derniere !== null && rythme !== "annuel" && joursEntre(r.derniere, ctx.aujourdhui) > 1.5 * per.jours + 1e-9;
      r.prochaine = r.derniere !== null && !r.arrete ? plusMois(r.derniere, per.mois) : null;
    }
    r.nouveau = [decale(m0, -2), decale(m0, -1), m0].includes(pres[0]);
    return r;
  }

  const LIBELLES_STATUTS = ["nouveau", "hausse_de_prix", "arrete", "doublon_possible"];
  /** Le récurrent d'une vue (§ 6.5) : engagements (contraint), abonnements et habitudes (pilotables), avec synthèse du mois et « reste à prélever ».
      `opts` : { vue, personne?, mois? }. → { disponible, mois_couverts, recurrents: [ligne], synthese } ou { disponible: false, raison: "moins_de_3_mois", mois_couverts }. */
  function recurrentsVue(data, opts) {
    const ctx = lectureRecurrent(data, opts);
    if (!ctx) return indisponible(0);
    if (ctx.couverts < 3) return indisponible(ctx.couverts);
    const mo = mois7(opts && opts.mois) || ctx.m0;
    const analyses = ctx.groupes.map(g => analyserGroupe(g, ctx));
    const lignes = analyses.filter(a => a.famille !== "ponctuel");
    // statuts : nouveau, hausse de prix, arrêté ?, doublon possible
    const actifs = lignes.filter(a => a.famille !== "habitude" && !a.arrete);
    const assurances = actifs.filter(a => a.g.sous === "assurances");
    const doublons = new Set();
    for (const a of assurances) for (const b of assurances) if (a !== b && !suiteDeMots(a.g.cle, b.g.cle)) doublons.add(a);
    for (const fam of FAMILLES_DOUBLON) {
      const l = actifs.filter(a => a.famille === "abonnement" && a.famMarchand === fam);
      if (l.length >= 2) l.forEach(a => doublons.add(a));
    }
    for (const a of lignes) {
      if (a.nouveau) a.statuts.push("nouveau");
      if (a.hausse) a.statuts.push("hausse_de_prix");
      if (a.arrete) a.statuts.push("arrete");
      if (doublons.has(a)) a.statuts.push("doublon_possible");
    }
    const ORDRE = { engagement: 0, abonnement: 1, habitude: 2 };
    const rendu = a => euroC(a.cout, a.g.w);
    lignes.sort((a, b) => ORDRE[a.famille] - ORDRE[b.famille] || rendu(b) - rendu(a) || (a.g.cle < b.g.cle ? -1 : a.g.cle > b.g.cle ? 1 : String(a.g.compte_id) < String(b.g.compte_id) ? -1 : String(a.g.compte_id) > String(b.g.compte_id) ? 1 : 0));
    const rows = lignes.map(a => {
      const w = a.g.w, hab = a.famille === "habitude";
      return { compte_id: a.g.compte_id, cle_marchand: a.g.cle, sous_categorie: a.g.sous, part: w, famille: a.famille, famille_marchand: a.famMarchand, rythme: a.rythme, annuel: a.annuel,
        montant_habituel: euroC(a.habituel, w), cout_12_mois: euroC(a.cout, w), derniere_date: a.derniere, prochaine_date: hab ? null : a.prochaine,
        frequence: hab ? dixiemeExt(a.frequence) : null, panier_moyen: hab && a.panier !== null ? euroC(a.panier, w) : null, total_mensuel: hab ? euroC(a.total, w) : null,
        tendance: hab && a.tendance !== null ? dixiemeExt(a.tendance) : null,
        hausse: a.hausse ? { ancien: euroC(a.hausse.ancien, w), nouveau: euroC(a.hausse.nouveau, w), depuis: a.hausse.depuis } : null, statuts: a.statuts.slice() };
    });
    // synthèse du mois : sorties brutes de chaque groupe, ventilées selon sa famille (calculée aujourd'hui)
    const parFamille = { engagement: 0, abonnement: 0, habitude: 0, ponctuel: 0 };
    for (const a of analyses) { const m = a.g.mois.get(mo); if (m && m.s > 0) parFamille[a.famille] += m.s * a.g.w; }
    const total = parFamille.engagement + parFamille.abonnement + parFamille.habitude + parFamille.ponctuel;
    const pct = x => (total > 0 ? dixiemeExt(x / total * 100) : null);
    const enCours = mo === ctx.m0;
    let attendus = null, reste = null, prochain = null;
    if (enCours) {
      attendus = lignes.filter(a => a.famille !== "habitude" && a.prochaine && a.prochaine.slice(0, 7) === ctx.m0).map(a => ({ compte_id: a.g.compte_id, cle_marchand: a.g.cle, date: a.prochaine,
        montant: euroC(a.g.mois.get(a.ancre).s, a.g.w), en_retard: joursEntre(a.prochaine, ctx.aujourdhui) > 3, _c: a.g.mois.get(a.ancre).s * a.g.w }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.cle_marchand < b.cle_marchand ? -1 : a.cle_marchand > b.cle_marchand ? 1 : String(a.compte_id) < String(b.compte_id) ? -1 : 1));
      reste = euroC(somme(attendus.map(x => x._c)));
      attendus.forEach(x => delete x._c);
      const venir = attendus.filter(x => x.date >= ctx.aujourdhui);
      prochain = venir.length ? venir[0].date : null;
    }
    const synthese = { mois: mo, en_cours: enCours, engagements: euroC(parFamille.engagement), abonnements: euroC(parFamille.abonnement), habitudes: euroC(parFamille.habitude), ponctuel: euroC(parFamille.ponctuel),
      total: euroC(total), parts: total > 0 ? { engagements: pct(parFamille.engagement), abonnements: pct(parFamille.abonnement), habitudes: pct(parFamille.habitude), ponctuel: pct(parFamille.ponctuel) } : null,
      reste_a_prelever: reste, attendus, prochain_prelevement: prochain,
      cout_annuel_abonnements: euroC(somme(lignes.filter(a => a.famille === "abonnement" && !a.arrete).map(a => a.cout * a.g.w))) };
    return { disponible: true, mois_couverts: ctx.couverts, recurrents: rows, synthese };
  }

  /** Mois de référence d'une analyse (variations, inhabituel) : mois complets avant `mo`, 12 au plus (m0 − 12 au plus loin), couverts par les données. */
  function moisReference(ctx, mo) {
    if (!mo || mo > ctx.m0 || ctx.premier === null) return [];
    const debut = ctx.premier > ctx.debut ? ctx.premier : ctx.debut, out = [];
    for (let m = debut; m < mo; m = decale(m, 1)) out.push(m);
    return out;
  }
  /** Pourquoi une dépense a bougé (§ 6.5) : écart entre le mois et sa référence (médianes), effet volume et effet prix, et les clés qui l'expliquent.
      `opts` : { vue, personne?, mois, niveau: "sous_categorie" | "cle", sous_categorie? | compte_id + cle_marchand }. */
  function variations(data, opts) {
    const o = opts || {}, ctx = lectureRecurrent(data, o), mo = mois7(o.mois);
    if (!ctx) return indisponible(0);
    const niveau = o.niveau === "cle" ? "cle" : "sous_categorie", refs = moisReference(ctx, mo);
    if (refs.length < 3) return indisponible(refs.length);
    const choisis = ctx.groupes.filter(g => (niveau === "cle" ? String(g.compte_id) === String(o.compte_id) && g.cle === String(o.cle_marchand) : g.sous === o.sous_categorie));
    const serie = (liste, f, mois) => mois.map(m => somme(liste.map(g => (g.mois.has(m) ? f(g.mois.get(m)) * g.w : 0))));
    const S0 = mediane(serie(choisis, x => x.s, refs)), N0 = mediane(choisis.length ? refs.map(m => somme(choisis.map(g => (g.mois.has(m) ? g.mois.get(m).n : 0)))) : refs.map(() => 0));
    const S1 = serie(choisis, x => x.s, [mo])[0], N1 = somme(choisis.map(g => (g.mois.has(mo) ? g.mois.get(mo).n : 0)));
    const ecart = S1 - S0;
    const volume = N0 === 0 ? ecart : N1 === 0 ? ecart : (N1 - N0) * S0 / N0, prix = ecart - volume;
    let cles = null;
    if (niveau === "sous_categorie") {
      const parCle = new Map();
      for (const g of choisis) {
        if (g.cle === "") continue;
        const k = String(g.compte_id) + "\u0001" + g.cle;
        if (!parCle.has(k)) parCle.set(k, []);
        parCle.get(k).push(g);
      }
      const sg = ecart > 0 ? 1 : ecart < 0 ? -1 : 0;
      const liste = [...parCle.values()].map(gs => ({ compte_id: gs[0].compte_id, cle_marchand: gs[0].cle, e: serie(gs, x => x.s, [mo])[0] - mediane(serie(gs, x => x.s, refs)) }))
        .filter(x => sg !== 0 && Math.abs(x.e) > 1e-9 && Math.sign(x.e) === sg)
        .sort((a, b) => Math.abs(b.e) - Math.abs(a.e) || (a.cle_marchand < b.cle_marchand ? -1 : a.cle_marchand > b.cle_marchand ? 1 : String(a.compte_id) < String(b.compte_id) ? -1 : 1));
      cles = liste.slice(0, 3).map(x => ({ compte_id: x.compte_id, cle_marchand: x.cle_marchand, ecart: euroC(x.e) }));
    }
    const panier = (s, n) => (n > 0 ? euroC(s / n) : null);
    const res = { disponible: true, mois: mo, niveau };
    if (niveau === "cle") { res.compte_id = o.compte_id; res.cle_marchand = String(o.cle_marchand); } else res.sous_categorie = o.sous_categorie;
    return { ...res, reference: { du: refs[0], au: refs[refs.length - 1], n: refs.length, periode_courte: refs.length < 6, montant: euroC(S0), nombre: N0, panier: panier(S0, N0) },
      mois_analyse: { montant: euroC(S1), nombre: N1, panier: panier(S1, N1) }, ecart: euroC(ecart), delta_nombre: N1 - N0, effet_volume: euroC(volume), effet_prix: euroC(prix), cles };
  }

  /** Dépenses inhabituelles du mois (§ 6.5) : une clé jamais vue sur les mois de référence et d'au moins 50 €, ou une sortie supérieure à 3 fois le panier médian de sa clé.
      `opts` : { vue, personne?, mois }. → { disponible, mois, depenses: [{ compte_id, cle_marchand, sous_categorie, montant, montant_max, raison, mediane_panier }] }. */
  function inhabituel(data, opts) {
    const o = opts || {}, ctx = lectureRecurrent(data, o), mo = mois7(o.mois);
    if (!ctx) return indisponible(0);
    const refs = moisReference(ctx, mo);
    if (refs.length < 3) return indisponible(refs.length);
    const parCle = new Map();
    for (const g of ctx.groupes) { if (g.cle === "") continue; if (!parCle.has(g.cle)) parCle.set(g.cle, []); parCle.get(g.cle).push(g); }
    const sortie = [];
    for (const g of ctx.groupes) {
      if (g.cle === "" || !g.mois.has(mo) || !(g.mois.get(mo).s > 0)) continue;
      const m = g.mois.get(mo), memes = parCle.get(g.cle);
      const vus = refs.filter(r => memes.some(x => x.mois.has(r) && x.mois.get(r).s > 0));
      let raison = null, med = null;
      if (!vus.length) { if (m.s >= 5000) raison = "nouvelle_cle"; }
      else {
        med = mediane(vus.map(r => { const s = somme(memes.map(x => (x.mois.has(r) ? x.mois.get(r).s : 0))), nn = somme(memes.map(x => (x.mois.has(r) ? x.mois.get(r).n : 0))); return nn > 0 ? s / nn : s; }));
        if (m.max > 3 * med + 1e-9) raison = "montant_eleve";
      }
      if (raison) sortie.push({ g, raison, m, med: raison === "montant_eleve" ? med : null });
    }
    sortie.sort((a, b) => b.m.s - a.m.s || (a.g.cle < b.g.cle ? -1 : a.g.cle > b.g.cle ? 1 : String(a.g.compte_id) < String(b.g.compte_id) ? -1 : 1));
    return { disponible: true, mois: mo, depenses: sortie.map(x => ({ compte_id: x.g.compte_id, cle_marchand: x.g.cle, sous_categorie: x.g.sous, montant: euroC(x.m.s, x.g.w),
      montant_max: euroC(x.m.max, x.g.w), raison: x.raison, mediane_panier: x.med === null ? null : euroC(x.med, x.g.w) })) };
  }

  /* ================================================================== export */
  return { CONVENTIONS, convention, cibleEnVigueur, donnees, mois, serie, reference, depensesAnnuelles: annuelles, score, recurrents: recurrentsVue, variations, inhabituel, detections, fragilite, pistes, plancherResteAVivre, comparerInsee, proposerCible, repartir, familleDe, normaliserReference };
});
