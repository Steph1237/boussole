/* Données du graphe maître (SIM2) : relie le store, le passé (photos nocturnes + reconstitution), le moteur de projection et les plans figés au composant
   GraphePatrimoine (graphe-patrimoine.js), qui ne connaît que le contrat `donnees` décrit en tête de ce fichier. Un seul moteur pour tous les écrans :
   Projection.executer (500 chemins puis 2 000, dans un Web Worker), jamais un second calcul de projection.

   Fonctions pures (testées) : passeDe (passé observé + reconstitué, en euros d'aujourd'hui avec l'indice des prix), ajustementAutresBiens, jalonsDe (dédoublonnés,
   avec leurs durées), objectifsDe, construire (résultat du moteur → donnees), reglagesParDefaut, optionsMoteur, planDe.
   Partie asynchrone : calculer(S, reglages, o) → Promise<donnees> (rappel appelé à chaque étape), calculerCapacite (IMMO1 « Ta capacité demain »), effetSurMediane
   (effet d'un événement sur la médiane à l'horizon : deux modèles, mêmes tirages).

   Conventions honnêtes :
   - Le moteur compte le patrimoine net sans les biens d'usage et d'entreprise (Calc.patrimoine.usage / .entreprise) ; la courbe reste égale au patrimoine net affiché
     partout ailleurs : ces biens sont ajoutés, maintenus à leur valeur d'aujourd'hui (comme l'ancien cône), et la feuille « Comment c'est calculé » le dit.
   - Les réglages du graphe sont locaux : rien n'est enregistré (lecture seule).
   Dépendances (deps, sinon globales ou modules voisins sous Node) : Projection, Calc, BilanCalc, Historique, SerieNet, Marche, Store. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GrapheModele = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  const glob = k => (root && root[k]) || (typeof window !== "undefined" && window[k]) || null;
  const noeud = typeof module === "object" && module.exports && typeof require === "function";
  const dep = (d, k, f) => (d && Object.prototype.hasOwnProperty.call(d, k) && d[k]) || glob(k) || (noeud && f ? require(f) : null);
  const PJ = d => dep(d, "Projection", "./projection.js");
  const CALC = d => dep(d, "Calc", "./calc.js");
  const BC = d => dep(d, "BilanCalc", "./bilan-calc.js");
  const HIST = d => dep(d, "Historique", "./historique.js");
  const SN = d => dep(d, "SerieNet", "./serie-net.js");
  const MARCHE = d => dep(d, "Marche", "./marche.js");
  const GP = d => dep(d, "GraphePatrimoine", "./graphe-patrimoine.js");

  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
  const tab = a => (Array.isArray(a) ? a : []);
  const fini = v => v != null && v !== "" && typeof v !== "boolean" && isFinite(+v);
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const msDe = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const isoDe = ms => new Date(ms).toISOString().slice(0, 10);
  const ajouterMois = (ms, k) => { const d = new Date(ms), y = d.getUTCFullYear(), m = d.getUTCMonth() + k, yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    return Date.UTC(yy, mm, Math.min(d.getUTCDate(), new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate())); };
  const HORIZON_ANS = 25, HORIZON_CAPACITE_ANS = 20;

  /* ---------- réglages ---------- */
  /** Réglages locaux par défaut (jamais enregistrés). vue : net | financier | disponible ; euros : constants | courants ; existant : null (automatique : plein écran
      seulement) | vrai | faux ; plan : id d'un plan figé ; periode : { du, au } libre. */
  function reglagesParDefaut(preset) {
    return Object.assign({ vue: "net", euros: "constants", net_impots: false, variante: null, crise: { on: false, cle: null, debut: null }, existant: null, avenirs: false, plan: null, periode: null,
      fenetre: null, duree: 25, neuf: false, primo: false }, preset || {});
  }
  /** Options du moteur depuis les réglages locaux (seuls ceux qui changent le calcul). */
  function optionsMoteur(reglages, S, extra) {
    const r = reglages || reglagesParDefaut(), sc = S && (S.scope === "p1" || S.scope === "p2") ? S.scope : "foyer";
    return Object.assign({ horizon_ans: HORIZON_ANS, perimetre: sc, vue: r.vue || "net", euros: r.euros === "courants" ? "courants" : "constants", net_impots: !!r.net_impots, variante: r.variante || null }, extra || {});
  }
  /** Empreinte des réglages qui exigent un nouveau calcul (le reste est local au composant). */
  const cleCalcul = (reglages, S) => JSON.stringify([optionsMoteur(reglages, S), reglages.crise && reglages.crise.on ? [reglages.crise.cle, reglages.crise.debut] : null, !!reglages.avenirs, reglages.plan || null, reglages.duree || null, !!reglages.neuf, !!reglages.primo]);

  /* ---------- le passé ---------- */
  /** Passé de la vue demandée : photos nocturnes (observé) + reconstitué avant la première photo (Historique.fusionner), en euros d'aujourd'hui avec l'indice des prix (Insee)
      quand l'indice couvre la date ; sinon en euros courants, et le dit (euros_constants: false). La vue « disponible » n'a pas de passé.
      → { points: [{ date, valeur, nature }], drapeaux, decalage, euros_constants, note, vide? } */
  function passeDe(S, today, o) {
    const opt = o || {}, vue = opt.vue || "net", euros = opt.euros === "courants" ? "courants" : "constants", deps = opt.deps || null;
    const vide = note => ({ points: [], drapeaux: null, decalage: 0, euros_constants: euros === "constants", note: note || "", vide: true });
    if (vue === "disponible") return vide("Le patrimoine disponible n'a pas d'historique : seule la projection est tracée.");
    const bc = BC(deps), hi = HIST(deps), sn = SN(deps), G = GP(deps);
    if (!bc || !S) return vide("");
    let pts = [];
    try { pts = bc.evolution(S.snapshots || [], S.positions || [], S.profil || null, S.scope || "foyer", today); } catch (e) { return vide(""); }
    if (!pts.length) return vide("");
    const champ = vue === "financier" ? "financier" : "net";
    const observes = pts.map(p => ({ date: p.date, net: p[champ], live: !!p.live }));
    const rec = opt.reconstitue !== undefined ? opt.reconstitue : sn && S ? sn.reconstitution(S, today, deps) : null;
    let points = observes.map(p => ({ date: p.date, valeur: p.net, nature: "observe" })), decalage = 0, drapeaux = null;
    if (rec && tab(rec.points).length && hi) {
      const fus = hi.fusionner(observes, rec.points.map(p => ({ date: p.date, net: p[champ] })));
      points = fus.points.map(p => ({ date: p.date, valeur: p.net, nature: p.nature })); decalage = fus.decalage; drapeaux = rec.drapeaux || null;
    }
    let constants = true;
    if (euros === "constants") {
      const facteurs = points.map(p => (G ? G.facteurPrix(opt.indices || S.indices || [], p.date, today) : null));
      if (facteurs.every(f => f != null) && points.length) points = points.map((p, i) => ({ date: p.date, valeur: p.valeur * facteurs[i], nature: p.nature }));
      else constants = false;
    }
    return { points, drapeaux, decalage, euros_constants: euros === "constants" ? constants : false,
      note: euros === "constants" && !constants ? "Le passé est en euros courants : l'indice des prix ne couvre pas toute la période." : "" };
  }
  /** Valeur à ajouter à toutes les séries du moteur pour qu'elles partent exactement du dernier point observé : les biens d'usage et d'entreprise, que le moteur ne compte pas
      dans le patrimoine net, maintenus à leur valeur d'aujourd'hui. 0 pour une autre vue que « net ». */
  function ajustementAutresBiens(resultat, passe, vue) {
    if (vue !== "net" || !passe || !passe.points.length || !resultat) return 0;
    const v = resultat.vues && resultat.vues[vue] ? resultat.vues[vue].p50[0] : null;
    const dernier = passe.points[passe.points.length - 1];
    if (v == null || dernier.date !== resultat.today) return 0;
    return dernier.valeur - v;
  }

  /* ---------- jalons, objectifs ---------- */
  /** Jalons du moteur, dédoublonnés (la dernière échéance d'un prêt du calendrier et la fin du même crédit n'en font qu'un) et enrichis de leur durée (fin d'un événement daté,
      durée d'un prêt immobilier). */
  function jalonsDe(resultat, S) {
    const js = tab(resultat && resultat.jalons), evts = tab(S && S.foyer && S.foyer.evenements);
    const credits = js.filter(j => j.source === "credit").map(j => msDe(j.date));
    const proches = d => credits.some(c => Math.abs(c - msDe(d)) < 100 * 864e5);
    return js.filter(j => !(j.source === "calendrier" && j.type === "pret_fin" && proches(j.date))).map(j => {
      const e = j.evenement_id ? evts.find(x => x.id === j.evenement_id) : null;
      let fin = e && isoOk(e.fin) ? e.fin : null;
      if (e && e.type === "achat_immobilier" && e.params && e.params.pret && fini(e.params.pret.duree_ans)) fin = isoDe(ajouterMois(msDe(j.date), 12 * +e.params.pret.duree_ans));
      return Object.assign({}, j, fin ? { fin } : {});
    });
  }
  /** Objectifs avec leur probabilité (moteur), leur mot et ce qui est déjà de côté (store). */
  function objectifsDe(resultat, S) {
    const bruts = tab(S && S.objectifs);
    return tab(resultat && resultat.objectifs).map(o => {
      const b = bruts.find(x => String(x.id) === String(o.id)) || {};
      return Object.assign({}, o, { deja: fini(b.deja) ? +b.deja : null, type: b.type || null });
    });
  }

  /* ---------- plans figés (« Prévu vs réel ») ---------- */
  /** Plan figé (détail du store) en série du composant : valeurs en euros courants, décalées comme la courbe (biens d'usage) ; comparaison au réel par Projection.comparerPlanReel. */
  function planDe(detail, passe, ajust, deps) {
    if (!detail || !detail.serie || !tab(detail.serie.mois).length) return null;
    const P = PJ(deps), s = detail.serie, a = ajust || 0;
    const dec = k => tab(s[k]).map(v => (v == null ? null : v + a));
    const plan = { id: detail.id, cree_le: String(detail.cree_le || "").slice(0, 10), raison: detail.raison || "manuel", serie: { mois: s.mois.slice(), p10: dec("p10"), p25: dec("p25"), p50: dec("p50"), p75: dec("p75"), p90: dec("p90") },
      vue: s.vue || "net", euros: s.euros || "courants" };
    let comparaison = null;
    if (P && typeof P.comparerPlanReel === "function" && passe && passe.points.length) {
      try {
        const reel = passe.points.filter(p => p.nature === "observe").map(p => ({ date: p.date, valeur: p.valeur }));
        const c = P.comparerPlanReel({ serie: plan.serie, parametres: detail.parametres, cree_le: detail.cree_le }, reel);
        comparaison = { n: c.n, dans_la_bande: c.dans_la_bande_p10_p90, dernier: c.dernier ? { date: c.dernier.date, plan_p50: c.dernier.plan_p50, reel: c.dernier.reel, ecart: c.dernier.ecart, ecart_pct: c.dernier.ecart_pct } : null };
      } catch (e) { comparaison = null; }
    }
    plan.comparaison = comparaison;
    return plan;
  }

  /* ---------- construction des données du composant ---------- */
  const decal = (arr, a) => (Array.isArray(arr) ? arr.map(v => (v == null ? null : v + a)) : null);
  /** donnees (contrat de graphe-patrimoine.js) depuis un résultat du moteur, le passé et le store. extra = { variante, crise, avenirs, plan, comparaisonVariante, progressif, notes }. */
  function construire(resultat, passe, S, reglages, extra) {
    const r = reglages || reglagesParDefaut(), x = extra || {}, vue = r.vue || "net";
    const base = { today: resultat ? resultat.today : (S && S.today) || new Date().toISOString().slice(0, 10), vue, euros: r.euros === "courants" ? "courants" : "constants", mode: "patrimoine", perimetre: x.perimetre || "",
      passe: passe && passe.points.length ? { points: passe.points, drapeaux: passe.drapeaux, decalage: passe.decalage, euros_constants: passe.euros_constants, note: passe.note } : passe && passe.note ? { points: [], note: passe.note } : null,
      jalons: [], objectifs: [], plans: tab(S && S.plansFiges), variantes: tab(S && S.foyer && S.foyer.variantes).map(v => ({ id: v.id, nom: v.nom })), crises: crisesDisponibles(x.deps), progressif: !!x.progressif };
    if (!resultat) return Object.assign(base, { etat: x.erreur ? "erreur" : x.calcul === false ? "vide" : "calcul", erreur: x.erreur || null });
    const a = x.ajust != null ? x.ajust : ajustementAutresBiens(resultat, passe, vue);
    const c = resultat.vues[vue];
    const futur = { mois: resultat.mois, p10: decal(c.p10, a), p25: decal(c.p25, a), p50: decal(c.p50, a), p75: decal(c.p75, a), p90: decal(c.p90, a),
      existant: resultat.existant ? { p25: decal(resultat.existant.p25, a), p50: decal(resultat.existant.p50, a), p75: decal(resultat.existant.p75, a) } : null,
      epargne_future: resultat.epargne_future ? { versements_cumules: resultat.epargne_future.versements_cumules, croissance: resultat.epargne_future.croissance, p50: resultat.epargne_future.p50 } : null };
    if (x.variante) futur.variante = { nom: x.variante.nom, p25: decal(x.variante.p25, a), p50: decal(x.variante.p50, a), p75: decal(x.variante.p75, a), comparaison: x.comparaisonVariante || null };
    if (x.crise && !x.crise.indisponible) futur.crise = { label: x.crise.label, debut: x.crise.debut, valeurs: decal(x.crise.valeurs, a) };
    if (x.avenirs) futur.avenirs = x.avenirs.map(t => decal(t, a));
    const avert = tab(resultat.avertissements).concat(tab(x.notes));
    if (a && vue === "net") avert.push("Tes biens d'usage et d'entreprise (" + Math.round(a).toLocaleString("fr-FR") + " €) sont ajoutés au patrimoine net du moteur et maintenus à leur valeur d'aujourd'hui, comme dans le patrimoine net affiché ailleurs.");
    if (x.crise && x.crise.indisponible) avert.push(...tab(x.crise.avertissements));
    return Object.assign(base, { etat: "pret", futur, jalons: jalonsDe(resultat, S), objectifs: objectifsDe(resultat, S),
      capacite: { base: resultat.capacite_base, par_periode: resultat.capacite_par_periode }, capacite_source: resultat.capacite_source, capacite_periode: resultat.capacite_periode,
      phrase: resultat.phrase, decomposition_phrase: resultat.decomposition_phrase, decomposition: resultat.decomposition, garde_fous: resultat.garde_fous,
      evenements_pris_en_compte: resultat.evenements_pris_en_compte, question_evenements: resultat.question_evenements, hypotheses: resultat.hypotheses, couverture: resultat.couverture,
      avertissements: avert, a_completer: resultat.a_completer, retro: resultat.retro, retro_raison: resultat.retro_raison, version_modele: resultat.version_modele, graine: resultat.graine, chemins: resultat.chemins,
      plan: x.plan || null, ajust: a });
  }
  function crisesDisponibles(deps) {
    const M = MARCHE(deps);
    return M && M.CRISES ? Object.keys(M.CRISES).map(cle => ({ cle, label: M.CRISES[cle].label })) : [];
  }

  /** Empreinte de ce qui change le dessin : entrée du moteur (cache de Projection.executer), réglages qui exigent un calcul, passé lu (photos, historique reconstitué).
      Deux appels de même signature donnent le même graphique : l'appelant ne relance pas le calcul. */
  function signature(S, reglages, today, deps) {
    const P = PJ(deps), sn = SN(deps), r = reglages || reglagesParDefaut(), snaps = tab(S && S.snapshots);
    const data = entree(S, today, deps), options = optionsMoteur(r, S);
    return [P.empreinte(data, options), cleCalcul(r, S), sn && sn.hist ? sn.hist.version : 0, snaps.length, snaps.length ? snaps[snaps.length - 1].date : "", (S && S.plansFiges ? S.plansFiges.length : 0)].join("|");
  }

  /* ---------- exécution ---------- */
  /** Données du moteur depuis l'état du store. */
  function entree(S, today, deps) {
    const P = PJ(deps);
    return P.depuisEtat(S, today);
  }
  /** Calcule les données du graphe pour un état du store et des réglages : le passé tout de suite (sans futur : état « calcul »), puis le moteur (500 chemins puis 2 000,
      Web Worker si disponible), les couches optionnelles (variante, crise, 100 avenirs, plan figé) quand le résultat complet est là.
      o = { today, deps, rappel(donnees, { etape }), executer? (pour les tests), indices?, reconstitue?, perimetre } → Promise<donnees> (résultat complet). */
  function calculer(S, reglages, o) {
    const opt = o || {}, deps = opt.deps || null, P = PJ(deps), r = reglages || reglagesParDefaut();
    const today = opt.today || (S && S.today) || new Date().toISOString().slice(0, 10);
    const passe = passeDe(S, today, { vue: r.vue, euros: r.euros, deps, indices: opt.indices, reconstitue: opt.reconstitue });
    const dit = (d, info) => { if (typeof opt.rappel === "function") opt.rappel(d, info); };
    const ctx = { deps, perimetre: opt.perimetre || "" };
    if (!P) { const d = construire(null, passe, S, r, Object.assign({ erreur: "Le moteur de projection n'est pas chargé." }, ctx)); dit(d, { etape: "erreur" }); return Promise.resolve(d); }
    const data = entree(S, today, deps), options = optionsMoteur(r, S, opt.chemins ? { chemins: opt.chemins } : null);
    const exec = opt.executer || P.executer;
    return Promise.resolve().then(() => exec(data, options, (res, info) => {
      const a = ajustementAutresBiens(res, passe, r.vue);
      dit(construire(res, passe, S, r, Object.assign({ progressif: info && info.etape === "apercu", ajust: a }, ctx)), info || { etape: "complet" });
    })).then(res => {
      const a = ajustementAutresBiens(res, passe, r.vue), extra = Object.assign({ ajust: a }, ctx);
      return couches(S, r, data, options, res, passe, a, opt, deps).then(c => {
        const d = construire(res, passe, S, r, Object.assign(extra, c));
        dit(d, { etape: "complet", chemins: res.chemins, couches: true });
        return d;
      });
    }).catch(e => {
      const d = construire(null, passe, S, r, Object.assign({ erreur: (e && e.message) || "Le calcul de la projection n'a pas abouti." }, ctx));
      dit(d, { etape: "erreur" });
      return d;
    });
  }
  /** Couches optionnelles (calculées sur le fil principal : un chemin, ou 100 chemins, quelques millisecondes) : variante, crise rejouée, 100 avenirs, plan figé. */
  async function couches(S, r, data, options, res, passe, a, opt, deps) {
    const P = PJ(deps), out = {};
    try {
      if (r.variante && P) {
        const M0 = P.preparer(data, Object.assign({}, options, { variante: null })), M1 = P.preparer(data, Object.assign({}, options, { variante: r.variante }));
        const v = P.simuler(M1, { chemins: res.chemins || 2000 }), vn = (tab(S.foyer && S.foyer.variantes).find(z => z.id === r.variante) || {}).nom || "Variante";
        out.variante = Object.assign({ nom: vn }, v.vues[options.vue]);
        const cmp = P.comparer(M0, M1, { chemins: 500, vue: options.vue });
        out.comparaisonVariante = { mois: cmp.mois, mediane: cmp.ecarts.p50, mieux: cmp.probabilite_mieux };
      }
      if (r.crise && r.crise.on && r.crise.cle && P) {
        const M = P.preparer(data, options), c = P.crise(M, { cle: r.crise.cle, debut: r.crise.debut || undefined });
        out.crise = c.indisponible ? c : { label: c.label, debut: c.debut, valeurs: c.valeurs[options.vue], mois: c.mois };
      }
      if (r.avenirs && P) {
        const M = P.preparer(data, options), N = M.N, marques = []; for (let t = 1; t <= N; t++) marques.push(t);
        const s = P.simuler(M, { chemins: 100, retenir: marques, graine: res.graine }), ch = s.chemins_retenus, euro = options.euros === "courants" ? () => 1 : t => 1 / M.infl[t];
        const dep0 = s.vues[options.vue].p50[0], avenirs = [];
        for (let i = 0; i < 100; i++) { const t = new Array(N + 1); t[0] = dep0; for (let k = 1; k <= N; k++) t[k] = ch[k][i] * euro(k); avenirs.push(t); }
        out.avenirs = avenirs;
      }
      if (r.plan && typeof opt.chargerPlan === "function") {
        const detail = await opt.chargerPlan(r.plan);
        out.plan = planDe(detail, passe, a, deps);
      } else if (r.plan) out.notes = ["Le plan figé n'a pas pu être chargé."];
    } catch (e) { out.notes = ["Une couche du graphique n'a pas pu être calculée : " + ((e && e.message) || "erreur")]; }
    return out;
  }

  /* ---------- IMMO1 : « Ta capacité demain » ---------- */
  /** Données du graphe en mode capacité (budget d'achat dans le temps, montant empruntable, bande de taux, jalons) à partir de Projection.capaciteDansLeTemps.
      reglages : { duree (20 | 25), neuf, primo, euros }. Calcul sur le fil principal (1 000 chemins). → donnees (mode « capacite »), ou { etat: "erreur" | "vide", … }. */
  function calculerCapacite(S, reglages, o) {
    const opt = o || {}, deps = opt.deps || null, P = PJ(deps), r = reglages || reglagesParDefaut({ vue: "financier" });
    const today = opt.today || (S && S.today) || new Date().toISOString().slice(0, 10);
    const base = { today, mode: "capacite", vue: "financier", euros: r.euros === "courants" ? "courants" : "constants", passe: null, jalons: [], objectifs: [], perimetre: opt.perimetre || "", crises: [], plans: [], variantes: [] };
    if (!P || typeof P.capaciteDansLeTemps !== "function") return Object.assign(base, { etat: "erreur", erreur: "Le moteur de projection n'est pas chargé." });
    try {
      const data = entree(S, today, deps), options = optionsMoteur(Object.assign({}, r, { vue: "financier" }), S, { horizon_ans: HORIZON_CAPACITE_ANS, variante: r.variante || null });
      const M = P.preparer(data, options);
      const c = P.capaciteDansLeTemps(M, { chemins: opt.chemins || 1000, graine: P.GRAINE }, { duree_ans: r.duree || 25, neuf: !!r.neuf, primo: !!r.primo });
      if (c.indisponible) return Object.assign(base, { etat: "vide", raison: tab(c.avertissements)[0] || "La capacité d'emprunt dans le temps n'est pas disponible.", avertissements: c.avertissements, mention: c.mention });
      const jalons = tab(c.jalons).map(j => ({ id: j.id, date: j.date, titre: j.titre, type: j.type, source: String(j.id).startsWith("credit:") ? "credit" : String(j.id).startsWith("cal:") ? "calendrier" : "evenement", icone: j.type === "fin_credit" || j.type === "pret_fin" ? "cle" : "", effet: { texte: j.effet || "", montants: {} } }));
      const d = c.serie_mensuelle;
      return Object.assign(base, { etat: "pret", jalons, capacite_demain: { mois: c.mois, montant_empruntable: c.montant_empruntable, mensualite_max: c.mensualite_max, apport: c.apport, budget_achat: c.budget_achat,
        budget_achat_par_taux: c.budget_achat_par_taux, taux: c.taux, duree_ans: c.duree_ans, phrase: c.phrase, serie_mensuelle: { mois: d.map(x => x.date), montant_empruntable: d.map(x => x.montant_empruntable) } },
        phrase: c.phrase, avertissements: c.avertissements, mention: c.mention, version_modele: c.version_modele, chemins: opt.chemins || 1000, graine: P.GRAINE });
    } catch (e) { return Object.assign(base, { etat: "erreur", erreur: (e && e.message) || "Le calcul n'a pas abouti." }); }
  }

  /* ---------- effet d'un événement sur la médiane à l'horizon ---------- */
  /** Effet d'un événement du foyer sur la médiane à l'horizon : deux modèles (avec et sans l'événement), mêmes tirages (Projection.comparer). → { montant (avec − sans), mois,
      probabilite_mieux } ou null (événement qui ne vient pas du foyer, ou calcul impossible). */
  function effetSurMediane(S, evenementId, reglages, o) {
    const opt = o || {}, deps = opt.deps || null, P = PJ(deps), r = reglages || reglagesParDefaut();
    if (!P || !evenementId) return null;
    const evts = tab(S && S.foyer && S.foyer.evenements);
    if (!evts.some(e => e.id === evenementId)) return null;
    try {
      const today = opt.today || (S && S.today) || new Date().toISOString().slice(0, 10), data = entree(S, today, deps);
      const sans = JSON.parse(JSON.stringify(data)); sans.foyer.evenements = sans.foyer.evenements.filter(e => e.id !== evenementId);
      const options = optionsMoteur(r, S, { horizon_ans: opt.horizon_ans || 10 });
      const c = P.comparer(P.preparer(sans, options), P.preparer(data, options), { chemins: opt.chemins || 500, vue: options.vue });
      return { montant: c.horizon.mediane_des_ecarts, mois: 12 * (options.horizon_ans), probabilite_mieux: c.horizon.probabilite_mieux };
    } catch (e) { return null; }
  }

  /* ---------- liaison d'un écran avec le graphe ---------- */
  /** Monte le graphe maître dans `el` et le relie au moteur : un seul code pour Aujourd'hui, Placements, Objectifs et « Ta capacité demain » (preset "capacite").
      o = { preset, S: () => état du store (ou passé à actualiser), today?: () => AAAA-MM-JJ, perimetre?: () => « du foyer », deps?: { UI, … }, objectifId?, titre?, reglages?, lienProfond?,
      claude?(question, libelle) → HTML, store?: Store (plans figés), chemins? }. → { ctl (composant), actualiser(S) (recalcule seulement si ce qui compte a changé), reglages(), pleinEcranQuandPret(), detruire() } ; null sans composant. */
  function brancher(el, o) {
    const opt = o || {}, deps = opt.deps || {}, G = GP(deps), U = deps.UI || glob("UI"), win = typeof window !== "undefined" ? window : null;
    if (!el || !G || typeof G.monter !== "function") return null;
    const capacite = opt.preset === "capacite", pre = (G.PRESETS && G.PRESETS[opt.preset]) || {};
    let S = null, sig = "", seq = 0, reglages = reglagesParDefaut(Object.assign({ vue: pre.vue || "net" }, opt.reglages));
    const jour = () => (typeof opt.today === "function" ? opt.today() : opt.today || new Date().toISOString().slice(0, 10));
    const perimetre = () => (typeof opt.perimetre === "function" ? opt.perimetre() : opt.perimetre || "");
    const store = opt.store || glob("Store");
    let ctl = null;
    function calcul(r) {
      const n = ++seq;
      if (capacite) { const d = calculerCapacite(S, r, { today: jour(), perimetre: perimetre(), deps: opt.moteurDeps || null, chemins: opt.chemins }); if (n === seq && ctl) ctl.mettreAJour(d); return Promise.resolve(d); }
      return calculer(S, r, { today: jour(), perimetre: perimetre(), deps: opt.moteurDeps || null, chargerPlan: id => (store && store.plansFiges ? store.plansFiges.detail(id) : Promise.resolve(null)),
        rappel: (d, info) => { if (n === seq && ctl) ctl.mettreAJour(d, info); } });
    }
    ctl = G.monter(el, { preset: opt.preset || "aujourdhui", objectifId: opt.objectifId, titre: opt.titre, reglages, deps: Object.assign({ UI: U, window: win }, deps), lienProfond: !!opt.lienProfond,
      claude: opt.claude || ((q, l) => (U && U.demanderAClaude ? U.demanderAClaude(q, l) : "")),
      surReglages: r => { reglages = r; sig = ""; return calcul(r); },
      impactJalon: j => new Promise(res => setTimeout(() => res(effetSurMediane(S, j.evenementId, reglages, { today: jour(), deps: opt.moteurDeps || null })), 30)),
      reessayer: () => { sig = ""; if (S) calcul(reglages); } });
    if (!ctl) return null;
    return {
      ctl, reglages: () => reglages,
      actualiser(snap) {
        if (snap) S = snap;
        if (!S) return;
        let s = "";
        try { s = signature(S, reglages, jour(), opt.moteurDeps || null) + "|" + perimetre(); } catch (e) { s = String(Date.now()); }
        if (s === sig) return;
        sig = s; calcul(reglages);
      },
      /** Change des réglages du composant de l'extérieur (ex. : durée et type de bien de la carte IMMO1) ; relance le calcul si besoin. */
      definir(patch) { if (ctl) ctl.reglagesAppliques(patch); },
      pleinEcranQuandPret: () => ctl.pleinEcranQuandPret && ctl.pleinEcranQuandPret(),
      detruire() { seq++; if (ctl && ctl.detruire) ctl.detruire(); ctl = null; },
    };
  }

  return { HORIZON_ANS, HORIZON_CAPACITE_ANS, reglagesParDefaut, optionsMoteur, cleCalcul, passeDe, ajustementAutresBiens, jalonsDe, objectifsDe, planDe, construire, entree, signature, calculer, calculerCapacite, effetSurMediane, brancher, crisesDisponibles };
});
