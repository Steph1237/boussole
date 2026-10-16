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

   POINT D'INTÉGRATION DE LA TÂCHE 7 (non livré ici : dépend de Calc.moisBancaires, fourni par HIS2 sur une autre branche) :
   Budget.donnees(S), Budget.mois(data, { vue, personne, mois }), Budget.serie(...), Budget.reference(...) viendront s'ajouter à l'objet exporté en bas de ce
   fichier. Les fonctions ci-dessous n'en dépendent pas : elles lisent des formes simples, décrites ci-dessous, que ces fonctions produiront.

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
  const api = factory({ BudgetCategories: dep("budget-categories", "BudgetCategories") });
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
    budget_piste_petit_achat_seuil: 15, budget_piste_petits_achats_nombre: 8, budget_piste_frais_cotisation_laissee: 5,
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
  function recurrents(data, opts) {
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
    const rec = recurrents(data, o);
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
    const frais = { total_12_mois: centieme(somme(fr.map(l => n0(l.sorties) - n0(l.entrees)))), commissions: somme(fr.map(l => n0(l.nombre))), mois: [...new Set(fr.map(l => mois7(l.mois)))].length };
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
      texte: "Ton logement pèse " + String(part).replace(".", ",") + " % de ta consommation, contre " + String(v).replace(".", ",") + " % en moyenne (Insee, enquête 2017) : " +
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
      → { options: { tenable, equilibree, ambitieuse }, necessaire, retenue, niveau, cible, controles, limite_par_plancher, orientation, atteignable_8_sur_10, leviers, couverture }. */
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
    const atteignable = necessaire === null ? null : S >= necessaire - 1e-9;
    const cible = { revenus_ref: R, blocs: { essentiels: Ess, envies: Env, epargne: S }, sous_categories: sousObj, protegees: [...protegees], niveau,
      taux_epargne: R > 0 ? centieme(S / R * 100) : 0, source: "Proposée par Claude à partir de tes relevés et de tes objectifs", version_taxonomie: BC.VERSION_TAXONOMIE };
    if (typeof e.evaluer === "function") cible.objectifs = e.evaluer(S);
    else if (Array.isArray(e.objectifs)) cible.objectifs = e.objectifs;
    return { options, necessaire, retenue: S, niveau, taux: cible.taux_epargne, cible, blocs: cible.blocs, sous_categories: sousObj, controles, couverture,
      limite_par_plancher: limite, orientation: limite, atteignable_8_sur_10: atteignable, leviers: atteignable === false ? LEVIERS.slice() : [], pistes_retenues: prises,
      capacite_taux: R > 0 ? dixieme(C / R * 100) : 0 };
  }
  function montantOption(m, R, effort) { return { montant: arrondi(m), taux: tauxPct(arrondi(m), R), effort }; }

  /* ================================================================== export */
  return { CONVENTIONS, convention, cibleEnVigueur, score, recurrents, detections, fragilite, pistes, plancherResteAVivre, comparerInsee, proposerCible, repartir, familleDe, normaliserReference };
});
