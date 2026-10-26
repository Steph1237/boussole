/* Pilotage › Scénarios (module « scenarios-view », SCN1, spec docs/superpowers/specs/2026-10-17-scn1-scenarios-design.md § 10) : la bibliothèque
   « Et si… ? » des scénarios de décision, calculés sur la situation de la personne, en lecture seule (rien n'est enregistré, rien n'est exécuté).
   - Liste : en-tête, « Pour toi » (3 cartes au plus, Scenarios.lister(...).pour_toi), puis les thèmes dans l'ordre Scenarios.THEMES (un thème sans
     scénario n'apparaît pas ; Immobilier porte en plus la carte-outil du simulateur acheter / louer), puis la ligne « D'autres questions arrivent ».
   - Carte (lien entier vers ?scenario=<cle>) : puce de thème, question (h3), pourquoi (raisons[0]), enjeu « ≈ X €/an » et sa bande, ou « Enjeu à
     calculer », ou « calcul… » (jamais un faux chiffre), questions manquantes (2 au plus, « + n »), état (À explorer, Joué le jj/mm, Retenu, Écarté),
     « Chiffres à revérifier ».
   - Détail (§ 10.3, toujours dans cet ordre) : 1 la réponse, 2 la comparaison (barres d'intervalle P10–P90, « Voir les chiffres », courbe « gain selon la
     date de retrait » si `courbe`, patrimoine par année si `detail.patrimoine`), 3 ce qui changerait la réponse, 4 hypothèses et sources, 5 tes données
     utilisées, 6 « Ajuster les hypothèses » (les questions du catalogue, préremplies, « Recalculer » : calcul local, aucune écriture ; mis en avant
     quand il manque des réponses), 7 « Explorer avec Claude » (texte prêt à copier), puis le pied.
   - Mise en page (§ 10.4) : page dédiée sous 900 px (route ?scenario=, retour en haut à gauche), panneau latéral de 900 à 1 439 px (UI.panneau,
     560 px, Échap ferme, focus rendu à la carte), maître-détail à partir de 1 440 px, trois zones (liste, détail, hypothèses) à partir de 1 680 px.
   - L'outil « Acheter ou louer » (module simu, inchangé) s'ouvre par ?outil=acheter-louer, avec un lien de retour (D8).
   - Calcul : Web Worker (app/scenarios-worker.js), sinon sur le fil principal en différé (window.ScenariosCalcul) ; cartes à 500 chemins, détail à
     500 puis 2 000 chemins (mêmes tirages) ; résultats gardés en mémoire par (clé, réponses, données).
   - Données : S.scenarios = { catalogue, joues, source } (store-demo.js, store-supabase.js ; repli : ScenariosCatalogue) ; foyer :
     ProjectionDonnees.depuisEtat(S, today) + S.risque.
   L'onglet « Mes variantes » (§ 10.5) n'est pas encore construit : la section ne montre que la bibliothèque.
   Fonctions pures exportées sous Node pour les tests : voir module.exports en bas de la partie pure. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const noeud = typeof module === "object" && module.exports && typeof require === "function";
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const mod = (g, f) => glob(g) || (noeud ? (() => { try { return require(f); } catch (e) { return null; } })() : null);
  const Sc = () => mod("Scenarios", "./scenarios.js");
  const Fm = () => mod("Fmt", "./format.js");
  const CP = () => mod("ClaudePrompts", "./claude-prompts.js");
  const CatalogueEmbarque = () => mod("ScenariosCatalogue", "./scenarios-catalogue.gen.js");
  const liste = v => (Array.isArray(v) ? v : []);
  const objet = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const fini = v => typeof v === "number" && isFinite(v);

  /* ================================================================== textes */
  const OUTIL = "acheter-louer";
  const ROUTE = "pilotage/scenarios";
  const THEMES = { epargne: "Épargne", placements: "Placements", retraite: "Retraite", banque: "Banque", immobilier: "Immobilier", famille: "Famille" };
  const ORDRE_THEMES = ["epargne", "placements", "retraite", "banque", "immobilier", "famille"];
  const EN_TETE = "Les questions que tout le monde se pose, calculées sur ta situation. Rien n'est fait à ta place.";
  const RIEN_URGENT = "Rien d'urgent ici. Parcours les thèmes si une question te parle.";
  const AUTRES = "D'autres questions arrivent : frais de ta banque, acheter ou louer, rembourser ou placer…";
  const MSG_INDISPO = "Chiffres pas encore disponibles : un repère manque.";
  const PIED = "Un calcul sur tes données, pas une recommandation de produit. Une projection n'est pas une promesse. Boussole n'exécute rien : c'est toi qui décides et qui fais.";
  const OUTIL_CARTE = { titre: "Acheter ou louer : le simulateur simple", texte: "Calcul simplifié, sans tirages : acheter et y vivre, louer et placer, louer et investir, comparés sur la durée." };
  const STATUTS_HYP = { verifie: "Vérifié", convention: "Convention Boussole", donnee: "Ta donnée", reponse: "Ta réponse", a_reverifier: "À revérifier" };
  const ORIGINES = { reponse: "ta réponse", boussole: "Boussole", donnee: "ta donnée" };
  /** Libellés lisibles des choix du catalogue (repli : la valeur brute, joliment formatée). */
  const LIBELLES_CHOIX = {
    compte_titres: "Compte-titres", assurance_vie: "Assurance-vie", pea: "PEA", per: "PER", livret: "Livret", livret_a: "Livret A", ldds: "LDDS", lep: "LEP",
    courant: "Compte courant", maintenant: "Maintenant", plus_tard: "Plus tard", ne_sait_pas: "Je ne sais pas", salarie: "Salarié", independant: "Indépendant",
    lmnp_reel: "Meublé (LMNP) au réel", lmnp_micro: "Meublé, micro-BIC", nu_reel: "Location nue au réel", nu_micro: "Location nue, micro-foncier",
    scpi: "SCPI", scpi_av: "SCPI en assurance-vie", locatif: "Bien locatif",
  };

  /* ================================================================== formats */
  const arr10 = v => (fini(v) ? Math.round(v / 10) * 10 + 0 : null);
  function eur(v, o) {
    const x = arr10(v), F = Fm();
    if (x == null) return "—";
    return F ? F.fmtEUR(x, o) : (o && o.signe && x > 0 ? "+" : "") + String(x) + " €";
  }
  function nombre(v, dec) {
    const F = Fm();
    if (!fini(v)) return "—";
    return F ? F.fmtNombre(v, { decimales: dec || 0 }) : String(v);
  }
  function pct(v) { const F = Fm(); return !fini(v) ? "—" : F ? F.fmtPct(v) : String(v) + " %"; }
  const pad = n => String(n).padStart(2, "0");
  const estDate = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);
  const jjmm = d => (estDate(d) ? d.slice(8, 10) + "/" + d.slice(5, 7) : "");
  const jjmmaaaa = d => (estDate(d) ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "");
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const moisAnnee = d => (estDate(d) ? MOIS[+d.slice(5, 7) - 1] + " " + d.slice(0, 4) : "");
  /** « 8 chances sur 10 » (règle de Projection.texteProbabilite). */
  function chances(p) {
    if (!fini(p)) return "";
    const n = Math.round(p * 10);
    if (p >= 0.95) return "plus de 9 chances sur 10";
    if (n <= 0) return "moins de 1 chance sur 10";
    return n + (n === 1 ? " chance" : " chances") + " sur 10";
  }
  const capitale = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
  /** Libellé lisible d'un choix d'une question : dictionnaire, nombres (avec % pour une tranche ou un pourcentage, « part » pour les parts), sinon la valeur
      brute sans tirets bas. */
  function libelleChoix(q, v) {
    if (v === true) return "Oui";
    if (v === false) return "Non";
    if (typeof v === "number") {
      const id = String((q && q.id) || "");
      if (/tmi|_pct$|taux/.test(id)) return nombre(v, v % 1 ? 2 : 0) + "\u00a0%";
      if (/parts?/.test(id)) return nombre(v, v % 1 ? 2 : 0).replace(/,(\d)0$/, ",$1") + (v > 1 ? " parts" : " part");
      return nombre(v, v % 1 ? 2 : 0);
    }
    const s = String(v == null ? "" : v);
    return LIBELLES_CHOIX[s] || capitale(s.replace(/_/g, " "));
  }
  /** Valeur lisible d'une réponse, selon le type de sa question. */
  function valeurLisible(q, v) {
    if (v === null || v === undefined || v === "") return "—";
    const t = q && q.type;
    if (t === "montant_eur") return eur(v);
    if (t === "pourcentage") return pct(v);
    if (t === "entier") return nombre(v) + (/ans$|_ans|horizon/.test((q && q.id) || "") ? " ans" : /mois/.test((q && q.id) || "") ? " mois" : "");
    if (t === "date") return jjmmaaaa(v) || String(v);
    if (t === "booleen") return v ? "Oui" : "Non";
    return libelleChoix(q, v);
  }
  const libelleTheme = t => THEMES[t] || capitale(String(t || "").replace(/_/g, " "));

  /* ================================================================== disposition (§ 10.4) */
  /** Disposition selon la largeur de la fenêtre : page (< 900), panneau (900 à 1 439), maitre (1 440 à 1 679), trois (≥ 1 680). */
  function disposition(largeur) {
    const w = +largeur;
    if (!(w >= 900)) return "page";
    if (w < 1440) return "panneau";
    if (w < 1680) return "maitre";
    return "trois";
  }
  /** Paramètres du lien profond → vue : { vue: "liste" | "detail" | "outil", cle }. */
  function vueDe(params) {
    const p = objet(params);
    if (p.outil === OUTIL) return { vue: "outil", cle: null };
    if (typeof p.scenario === "string" && /^[a-z0-9_]{1,64}$/.test(p.scenario)) return { vue: "detail", cle: p.scenario };
    return { vue: "liste", cle: null };
  }
  const lienScenario = cle => "#" + ROUTE + "?scenario=" + encodeURIComponent(cle);
  const LIEN_OUTIL = "#" + ROUTE + "?outil=" + OUTIL;
  const LIEN_LISTE = "#" + ROUTE;

  /* ================================================================== cartes */
  /** Partie jouée la plus récente d'un scénario, ou null. */
  function derniereJouee(joues, cle) {
    let d = null;
    liste(joues).forEach(j => { if (j && j.scenario_cle === cle && (!d || String(j.joue_le || "") >= String(d.joue_le || ""))) d = j; });
    return d;
  }
  /** Cartes de base, avant tout calcul d'enjeu (pertinence seulement, rapide) : la liste s'affiche aussitôt, les enjeux disent « calcul… ». */
  function cartesDeBase(catalogue, data, joues, today) {
    const S = Sc();
    return liste(catalogue).map(e => {
      let pe = { pertinent: true, raisons: [], manquants: [] };
      try { if (S) pe = S.pertinence(e, data, today); } catch (err) { /* pertinence illisible : la carte reste, sans raison */ }
      const j = derniereJouee(joues, e.cle);
      return { cle: e.cle, numero: e.numero, theme: e.theme, question: e.question, pertinent: pe.pertinent, pourquoi: pe.raisons || [], manquants: pe.manquants || [],
        enjeu: null, enjeu_p50: null, enjeu_statut: pe.pertinent ? "calcul" : null, etat: j ? j.etat : "a_explorer", joue_le: j ? j.joue_le || null : null, reperes_a_reverifier: [] };
    });
  }
  /** Enjeu affiché d'une carte : { etat, principal, bande }. Jamais un chiffre pendant le calcul ni sans données. */
  function enjeuCarte(c) {
    if (!c.pertinent) return { etat: "hors", principal: "Pas de raison particulière pour toi aujourd'hui", bande: "" };
    if (c.enjeu_statut === "calcul") return { etat: "calcul", principal: "calcul…", bande: "" };
    if (c.enjeu_statut === "ok" && c.enjeu && fini(c.enjeu.p50)) {
      const b = c.enjeu, bande = fini(b.p10) && fini(b.p90) && arr10(b.p10) !== arr10(b.p90) ? "de " + nombre(arr10(b.p10)) + " à " + eur(b.p90) + "/an, 8 chances sur 10" : "";
      return { etat: "ok", principal: "≈ " + eur(b.p50) + "/an", bande };
    }
    if (c.enjeu_statut === "indisponible") return { etat: "indisponible", principal: MSG_INDISPO, bande: "" };
    return { etat: "a_completer", principal: "Enjeu à calculer", bande: "" };
  }
  /** Puce d'état : À explorer (neutre), Joué le jj/mm (information), Retenu (bon), Écarté (atténuée) ; le texte porte le sens. */
  function etatHtml(c) {
    if (c.etat === "retenu") return '<span class="ui-badge bon scn-etat">Retenu</span>';
    if (c.etat === "ecarte") return '<span class="ui-badge neutre scn-etat ecarte">Écarté</span>';
    if (c.etat === "joue") return '<span class="ui-badge info scn-etat">Joué' + (c.joue_le ? " le " + esc(jjmm(c.joue_le)) : "") + "</span>";
    return '<span class="ui-badge neutre scn-etat">À explorer</span>';
  }
  const CHEVRON = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';
  const RETOUR = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 6l-6 6 6 6"/></svg>';
  /** Questions manquantes d'une carte (libellés), 2 au plus puis « + n ». */
  function manquantsHtml(c) {
    const l = liste(c.manquants_questions && c.manquants_questions.length ? c.manquants_questions : liste(c.manquants).map(m => m && m.libelle)).filter(Boolean);
    if (!l.length || !c.pertinent) return "";
    const vus = l.slice(0, 2).map(t => '<span class="ui-puce completer"><span class="ui-puce-point" aria-hidden="true"></span>' + esc(t) + "</span>");
    if (l.length > 2) vus.push('<span class="scn-plus">+ ' + (l.length - 2) + "</span>");
    return '<span class="scn-carte-manquants"><span class="ui-sr">Il manque : </span>' + vus.join("") + "</span>";
  }
  /** Carte d'un scénario : un lien entier vers son détail (44 px au moins, focus visible). zone : « pourtoi » ou le thème. */
  function carteHtml(c, zone, actif) {
    const ej = enjeuCarte(c), pourquoi = c.pertinent && c.pourquoi && c.pourquoi[0] ? c.pourquoi[0] : "";
    const rev = liste(c.reperes_a_reverifier).length ? '<span class="ui-puce surveiller scn-reverifier"><span class="ui-puce-point" aria-hidden="true"></span>Chiffres à revérifier</span>' : "";
    return '<a class="ui-carte scn-carte' + (c.etat === "ecarte" ? " ecarte" : "") + '" href="' + esc(lienScenario(c.cle)) + '" data-scn-cle="' + esc(c.cle) + '" data-scn-zone="' + esc(zone) + '"' + (actif === c.cle ? ' aria-current="true"' : "") + ">" +
      '<span class="scn-carte-tete"><span class="ui-badge neutre scn-theme-puce">' + esc(libelleTheme(c.theme)) + "</span>" + etatHtml(c) + "</span>" +
      '<h3 class="scn-carte-q">' + esc(c.question) + "</h3>" +
      (pourquoi ? '<span class="scn-carte-pourquoi">' + esc(pourquoi) + "</span>" : "") +
      '<span class="scn-carte-enjeu ' + ej.etat + '"' + (ej.etat === "calcul" ? ' aria-busy="true"' : "") + '><span class="scn-carte-ej num">' + esc(ej.principal) + "</span>" +
      (ej.bande ? '<span class="scn-carte-bande num">' + esc(ej.bande) + "</span>" : "") + "</span>" +
      manquantsHtml(c) + (rev ? '<span class="scn-carte-pied">' + rev + "</span>" : "") +
      '<span class="scn-carte-ouvrir">' + CHEVRON + "</span></a>";
  }
  /** Carte-outil du simulateur acheter / louer (thème Immobilier, D8). */
  function carteOutilHtml() {
    return '<a class="ui-carte scn-carte scn-carte-outil" href="' + LIEN_OUTIL + '" data-scn-outil-lien>' +
      '<span class="scn-carte-tete"><span class="ui-badge neutre scn-theme-puce">Immobilier</span><span class="ui-badge info scn-etat">Outil</span></span>' +
      '<h3 class="scn-carte-q">' + esc(OUTIL_CARTE.titre) + "</h3>" +
      '<span class="scn-carte-pourquoi">' + esc(OUTIL_CARTE.texte) + "</span>" +
      '<span class="scn-carte-enjeu hors"><span class="scn-carte-ej">calcul simplifié, sans tirages</span></span>' +
      '<span class="scn-carte-ouvrir">' + CHEVRON + "</span></a>";
  }

  /* ================================================================== la liste */
  /** HTML de la liste : en-tête, « Pour toi », thèmes, ligne finale. o = { pret, cartes, pour_toi (clés) | null pendant le calcul, ouverts (Set des thèmes
      dépliés, disposition « page ») , disposition }. */
  function listeHtml(o) {
    const opt = o || {}, U = glob("UI");
    const tete = '<header class="scn-tete"><h2 id="scnTitre" tabindex="-1">Et si… ?</h2><p class="scn-sous">' + esc(EN_TETE) + "</p></header>";
    const skel = n => (U && U.squelette ? U.squelette(n, "kpi") : '<div class="ui-squelette" role="status" aria-busy="true" aria-label="Chargement en cours"></div>');
    if (!opt.pret) {
      return tete + '<section class="scn-pourtoi" aria-labelledby="scnPourToiT"><h3 class="scn-sec-t" id="scnPourToiT">Pour toi</h3>' + skel(3) + "</section>";
    }
    const cartes = liste(opt.cartes), parCle = Object.fromEntries(cartes.map(c => [c.cle, c]));
    let pourToi;
    if (opt.pour_toi == null) pourToi = '<p class="scn-note" role="status">Calcul des enjeux sur ta situation…</p>' + skel(3);
    else {
      const l = liste(opt.pour_toi).map(k => parCle[k]).filter(Boolean);
      /* 600 à 899 px : 2 par rangée, la 3ᵉ en pleine largeur ; à partir de 900 px : 3 par rangée (une seule carte : pleine largeur) */
      const cols = l.length === 1 ? ["col-sm-12 col-12"] : l.length === 2 ? ["col-sm-6 col-6", "col-sm-6 col-6"] : ["col-sm-6 col-4", "col-sm-6 col-4", "col-sm-12 col-4"];
      pourToi = l.length ? '<ul class="scn-cartes scn-cartes-pourtoi grid-12" role="list">' + l.map((c, i) => '<li class="' + cols[i] + '">' + carteHtml(c, "pourtoi", opt.actif) + "</li>").join("") + "</ul>"
        : '<p class="scn-vide">' + esc(RIEN_URGENT) + "</p>";
    }
    const ordre = (Sc() && Array.isArray(Sc().THEMES) ? Sc().THEMES : ORDRE_THEMES);
    const compact = !!opt.compact, choix = opt.ouverts instanceof Map ? opt.ouverts : new Map();
    const themes = ordre.map(t => {
      const l = cartes.filter(c => c.theme === t).sort((a, b) => (a.etat === "ecarte") - (b.etat === "ecarte") || (b.enjeu_p50 == null ? -1 : b.enjeu_p50) - (a.enjeu_p50 == null ? -1 : a.enjeu_p50) || (a.numero || 0) - (b.numero || 0));
      const outil = t === "immobilier";
      if (!l.length && !outil) return "";
      const items = l.map(c => "<li>" + carteHtml(c, t, opt.actif) + "</li>").concat(outil ? ["<li>" + carteOutilHtml() + "</li>"] : []).join("");
      const n = l.length + (outil ? 1 : 0);
      const ouvert = choix.has(t) ? !!choix.get(t) : !compact; // replié par défaut sous 600 px (accordéons de lignes compactes), ouvert au-delà ; le choix de la personne est gardé
      return '<details class="ui-acc scn-theme" data-scn-theme="' + esc(t) + '"' + (ouvert ? " open" : "") + '><summary class="ui-acc-titre"><span class="scn-theme-t">' + esc(libelleTheme(t)) +
        '</span><span class="scn-theme-n">' + n + (n > 1 ? " questions" : " question") + '</span><span class="ui-acc-chevron" aria-hidden="true"><svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M6 9l6 6 6-6"/></svg></span></summary>' +
        '<div class="ui-acc-corps"><ul class="scn-cartes grid-fit" role="list">' + items + "</ul></div></details>";
    }).join("");
    return tete +
      '<section class="scn-pourtoi" aria-labelledby="scnPourToiT"><h3 class="scn-sec-t" id="scnPourToiT">Pour toi</h3>' + pourToi + "</section>" +
      (opt.noteMfa ? '<p class="scn-note">Tes parties jouées s\'affichent une fois la double authentification passée ; les scénarios restent calculés sur ta situation.</p>' : "") +
      '<section class="scn-themes" aria-labelledby="scnThemesT"><h3 class="scn-sec-t" id="scnThemesT">Par thème</h3>' + themes + "</section>" +
      '<p class="scn-autres">' + esc(AUTRES) + "</p>";
  }

  /* ================================================================== le détail : graphiques */
  /** Barres d'intervalle horizontales (une rangée par option : trait P10–P90, point P50 et sa valeur, ligne de la référence ; option exclue grisée
      avec sa raison), role="img" et phrase équivalente. → HTML. */
  function intervallesHtml(r) {
    const opts = liste(r && r.options), rep = objet(r && r.reponse);
    const chiffrees = opts.filter(o => !o.exclue && o.net && fini(o.net.p50));
    if (!chiffrees.length) return "";
    let lo = Math.min(...chiffrees.map(o => (fini(o.net.p10) ? o.net.p10 : o.net.p50))), hi = Math.max(...chiffrees.map(o => (fini(o.net.p90) ? o.net.p90 : o.net.p50)));
    if (lo > 0 && lo < hi * 0.5) lo = 0;
    if (!(hi > lo)) { hi = lo + Math.max(1, Math.abs(lo) * 0.1); lo = lo - Math.max(1, Math.abs(lo) * 0.1); }
    const marge = (hi - lo) * 0.03;
    lo -= marge; hi += marge;
    const pos = v => (((v - lo) / (hi - lo)) * 100).toFixed(2);
    const ref = opts.find(o => o.id === rep.reference && o.net && fini(o.net.p50)) || null;
    const phrases = [];
    const lignes = opts.map(o => {
      const tete = o.id === rep.option_en_tete, estRef = ref && o.id === ref.id;
      if (o.exclue || !o.net || !fini(o.net.p50)) {
        const raison = o.exclue ? (liste(o.contraintes)[0] || "Écartée pour ta situation.") : (liste(o.contraintes)[0] || "Sans montant à comparer.");
        phrases.push(o.libelle + (o.exclue ? ", écartée : " : " : ") + raison.replace(/\.$/, ""));
        return '<li class="scn-iv-ligne' + (o.exclue ? " exclue" : " sans") + '"><span class="scn-iv-nom">' + esc(o.libelle) + '</span><span class="scn-iv-raison">' + esc(raison) + "</span></li>";
      }
      const n = o.net, a = fini(n.p10) ? n.p10 : n.p50, b = fini(n.p90) ? n.p90 : n.p50;
      phrases.push(o.libelle + " : environ " + eur(n.p50) + ", entre " + eur(a) + " et " + eur(b));
      return '<li class="scn-iv-ligne' + (tete ? " tete" : estRef ? " ref" : "") + '"><span class="scn-iv-nom">' + esc(o.libelle) + (tete ? ' <span class="scn-iv-mot">en tête</span>' : estRef ? ' <span class="scn-iv-mot">référence</span>' : "") + "</span>" +
        '<span class="scn-iv-val num">' + esc(eur(n.p50)) + "</span>" +
        '<span class="scn-iv-piste" aria-hidden="true">' + (ref ? '<span class="scn-iv-ref" style="left:' + pos(ref.net.p50) + '%"></span>' : "") +
        '<span class="scn-iv-trait" style="left:' + pos(a) + "%;width:" + Math.max(0.5, pos(b) - pos(a)).toFixed(2) + '%"></span><span class="scn-iv-point" style="left:' + pos(n.p50) + '%"></span></span></li>';
    }).join("");
    const phrase = "Comparaison, patrimoine net à la sortie en euros d'aujourd'hui, 8 chances sur 10 entre les deux bornes : " + phrases.join(" ; ") + ".";
    return '<div class="scn-iv" role="img" aria-label="' + esc(phrase) + '"><ul class="scn-iv-liste" aria-hidden="true">' + lignes + "</ul></div>" +
      '<p class="scn-note">Net de frais et d\'impôts de sortie, en euros d\'aujourd\'hui : le trait va de 1 chance sur 10 à 9 chances sur 10, le point est la médiane' + (ref ? ", la ligne pointillée la référence" : "") + ".</p>";
  }
  /** Tableau « Voir les chiffres » : P10, P50, P90, versé, impôts, frais, et le rendement annuel équivalent médian si le résultat le donne. */
  function tableauHtml(r) {
    const tri = r && r.detail && r.detail.tri && typeof r.detail.tri === "object" ? r.detail.tri : null;
    const tete = ["Option", "P10", "Médiane", "P90", "Versé", "Impôts (médiane)", "Frais (médiane)"].concat(tri ? ["Rendement annuel médian"] : []);
    const lignes = liste(r && r.options).map(o => {
      const n = o.net || {}, cell = v => '<td class="num">' + esc(eur(v)) + "</td>";
      return "<tr><th scope=\"row\">" + esc(o.libelle) + (o.exclue ? ' <span class="scn-iv-mot">écartée</span>' : "") + "</th>" + cell(n.p10) + cell(n.p50) + cell(n.p90) + cell(o.verse) + cell(o.impots_p50) + cell(o.frais_p50) +
        (tri ? '<td class="num">' + esc(fini(tri[o.id]) ? pct(tri[o.id]) : "—") + "</td>" : "") + "</tr>";
    }).join("");
    return '<div class="scn-table-wrap"><table class="scn-table"><caption class="ui-sr">Chiffres de la comparaison, en euros d\'aujourd\'hui</caption><thead><tr>' +
      tete.map(t => '<th scope="col">' + esc(t) + "</th>").join("") + "</tr></thead><tbody>" + lignes + "</tbody></table></div>";
  }
  /** Repère vertical de la courbe : date des 5 ans du PEA ou des 8 ans de l'assurance-vie, quand le résultat la donne. */
  function repereCourbe(r) {
    const d = objet(r && r.detail);
    if (estDate(d.seuil_5_ans)) return { date: d.seuil_5_ans, libelle: "5 ans" };
    if (estDate(d.seuil_A)) return { date: d.seuil_A, libelle: "8 ans" };
    return null;
  }
  /** Graduations et libellés de l'axe des montants. */
  function axeY(lo, hi) {
    const F = Fm();
    const g = F && F.graduations ? F.graduations(lo, hi, 4) : [lo, hi];
    const l = F && F.fmtAxe ? F.fmtAxe(g) : g.map(String);
    return { g, l };
  }
  const moisDe = d => +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1);
  /** Abscisses des années (au plus 5 graduations) entre deux dates. */
  function anneesAxe(d0, d1) {
    const a0 = +d0.slice(0, 4), a1 = +d1.slice(0, 4), n = a1 - a0, pas = Math.max(1, Math.ceil((n + 1) / 5));
    const out = [];
    for (let a = a0 + (d0.slice(5) === "01-01" ? 0 : 1); a <= a1; a += pas) out.push(a);
    return out;
  }
  /** Cadre commun des graphiques de lignes : dimensions, échelles, axes. → { W, H, x(date), y(v), axes } */
  function cadre(largeur, d0, d1, lo, hi) {
    const W = Math.max(280, Math.min(Math.round(+largeur || 600), 960)), H = W < 480 ? 200 : 240, ml = 60, mr = 14, mt = 12, mb = 28, pw = W - ml - mr, ph = H - mt - mb;
    const ax = axeY(lo, hi), ymin = Math.min(lo, ax.g[0]), ymax = Math.max(hi, ax.g[ax.g.length - 1]);
    const m0 = moisDe(d0), m1 = Math.max(moisDe(d1), m0 + 1);
    const x = d => ml + ((moisDe(d) + (+d.slice(8, 10) - 1) / 31 - m0) / (m1 - m0)) * pw;
    const y = v => mt + ph - ((v - ymin) / (ymax - ymin || 1)) * ph;
    let axes = ax.g.map((v, i) => '<line class="scn-g-grille" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
      '<text class="scn-g-axe" x="' + (ml - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + esc(ax.l[i]) + "</text>").join("");
    axes += anneesAxe(d0, d1).map(a => { const xx = x(a + "-01-01"); return xx < ml || xx > W - mr ? "" : '<text class="scn-g-axe" x="' + xx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + a + "</text>"; }).join("");
    if (ymin < 0 && ymax > 0) axes += '<line class="scn-g-zero" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>';
    return { W, H, x, y, axes, ml, mr, mt, mb };
  }
  const chemin = (pts, x, y, k) => pts.map((p, i) => (i ? "L" : "M") + x(p.date).toFixed(1) + " " + y(p[k]).toFixed(1)).join("");
  const bandeChemin = (pts, x, y, a, b) => pts.map((p, i) => (i ? "L" : "M") + x(p.date).toFixed(1) + " " + y(p[b]).toFixed(1)).join("") +
    pts.slice().reverse().map(p => "L" + x(p.date).toFixed(1) + " " + y(p[a]).toFixed(1)).join("") + "Z";
  /** Courbe « gain selon la date de retrait » (médiane et bande P10–P90, temps proportionnel, repère 5 / 8 ans). → { svg, phrase } ou null. */
  function courbeSvg(r, largeur) {
    const pts = liste(r && r.courbe && r.courbe.points).filter(p => p && estDate(p.date) && fini(p.p50));
    if (pts.length < 2) return null;
    pts.forEach(p => { if (!fini(p.p10)) p.p10 = p.p50; if (!fini(p.p90)) p.p90 = p.p50; });
    const lo = Math.min(0, ...pts.map(p => p.p10)), hi = Math.max(0, ...pts.map(p => p.p90));
    const c = cadre(largeur, pts[0].date, pts[pts.length - 1].date, lo, hi === lo ? lo + 10 : hi);
    const rp = repereCourbe(r);
    let marque = "";
    if (rp && rp.date >= pts[0].date && rp.date <= pts[pts.length - 1].date) {
      const xx = c.x(rp.date).toFixed(1);
      marque = '<line class="scn-g-repere" x1="' + xx + '" x2="' + xx + '" y1="' + c.mt + '" y2="' + (c.H - c.mb) + '"/><text class="scn-g-axe scn-g-repere-t" x="' + (+xx + 4) + '" y="' + (c.mt + 12) + '">' + esc(rp.libelle) + "</text>";
    }
    const svg = '<svg class="scn-g" viewBox="0 0 ' + c.W + " " + c.H + '" width="' + c.W + '" height="' + c.H + '" aria-hidden="true" focusable="false">' + c.axes +
      '<path class="scn-g-bande" d="' + bandeChemin(pts, c.x, c.y, "p10", "p90") + '"/><path class="scn-g-mediane" d="' + chemin(pts, c.x, c.y, "p50") + '"/>' + marque + "</svg>";
    const fin = pts[pts.length - 1], max = pts.reduce((a, p) => (p.p50 > a.p50 ? p : a), pts[0]);
    const phrase = "Gain selon la date de retrait, en euros d'aujourd'hui : au plus haut, environ " + eur(max.p50) + " pour un retrait en " + moisAnnee(max.date) +
      " ; pour un retrait en " + moisAnnee(fin.date) + ", environ " + eur(fin.p50) + ", entre " + eur(fin.p10) + " et " + eur(fin.p90) + " (8 chances sur 10)" + (rp ? " ; le trait vertical marque les " + rp.libelle : "") + ".";
    return { svg, phrase };
  }
  const SERIES = ["c1", "c2", "c3", "c4", "c5", "c6"];
  /** Patrimoine net par année de sortie (detail.patrimoine), une ligne médiane par option, bande P10–P90 pâle de l'option en tête, légende. → { svg, legende, phrase } ou null. */
  function patrimoineSvg(r, largeur) {
    const pts = liste(r && r.detail && r.detail.patrimoine && r.detail.patrimoine.points).filter(p => p && estDate(p.date) && p.options && typeof p.options === "object");
    if (pts.length < 2) return null;
    const opts = liste(r.options).filter(o => pts.every(p => p.options[o.id] && fini(p.options[o.id].p50)));
    if (!opts.length) return null;
    const dernier = pts[pts.length - 1];
    const teteId = opts.some(o => o.id === objet(r.reponse).option_en_tete) ? r.reponse.option_en_tete : opts.reduce((a, o) => (dernier.options[o.id].p50 > dernier.options[a.id].p50 ? o : a), opts[0]).id;
    const ordre = [opts.find(o => o.id === teteId)].concat(opts.filter(o => o.id !== teteId));
    const val = (p, id, k) => { const b = p.options[id]; return fini(b[k]) ? b[k] : b.p50; };
    const lo = Math.min(0, ...pts.map(p => Math.min(val(p, teteId, "p10"), ...ordre.map(o => val(p, o.id, "p50"))))), hi = Math.max(...pts.map(p => Math.max(val(p, teteId, "p90"), ...ordre.map(o => val(p, o.id, "p50")))));
    const c = cadre(largeur, pts[0].date, dernier.date, lo, hi === lo ? lo + 10 : hi);
    const serie = (id, k) => pts.map(p => ({ date: p.date, v: val(p, id, k) }));
    const ch = s => s.map((p, i) => (i ? "L" : "M") + c.x(p.date).toFixed(1) + " " + c.y(p.v).toFixed(1)).join("");
    const b10 = serie(teteId, "p10"), b90 = serie(teteId, "p90");
    const bande = b90.map((p, i) => (i ? "L" : "M") + c.x(p.date).toFixed(1) + " " + c.y(p.v).toFixed(1)).join("") + b10.slice().reverse().map(p => "L" + c.x(p.date).toFixed(1) + " " + c.y(p.v).toFixed(1)).join("") + "Z";
    const lignes = ordre.map((o, i) => '<path class="scn-g-ligne ' + SERIES[i % SERIES.length] + '" d="' + ch(serie(o.id, "p50")) + '"/>').join("");
    const svg = '<svg class="scn-g" viewBox="0 0 ' + c.W + " " + c.H + '" width="' + c.W + '" height="' + c.H + '" aria-hidden="true" focusable="false">' + c.axes +
      '<path class="scn-g-bande-tete" d="' + bande + '"/>' + lignes + "</svg>";
    const legende = '<ul class="scn-legende" aria-hidden="true">' + ordre.map((o, i) => '<li><span class="scn-leg-c ' + SERIES[i % SERIES.length] + '"></span>' + esc(o.libelle) + (i === 0 ? " (bande : 8 chances sur 10)" : "") + "</li>").join("") + "</ul>";
    const phrase = "Patrimoine net selon l'année de sortie, en euros d'aujourd'hui, médiane par option : en " + moisAnnee(dernier.date) + ", " +
      ordre.map(o => o.libelle + " environ " + eur(val(dernier, o.id, "p50"))).join(", ") + " ; pour " + ordre[0].libelle + ", entre " + eur(val(dernier, teteId, "p10")) + " et " + eur(val(dernier, teteId, "p90")) + " (8 chances sur 10).";
    return { svg, legende, phrase };
  }

  /* ================================================================== le formulaire « Ajuster les hypothèses » */
  const UNITES = { montant_eur: "€", pourcentage: "%" };
  const idChamp = (cle, q) => "scn-q-" + String(cle).replace(/[^\w-]/g, "") + "-" + String(q.id).replace(/[^\w-]/g, "");
  /** Texte d'une valeur dans un champ (virgule décimale). */
  function texteChamp(q, v) {
    if (v === null || v === undefined) return "";
    if (q.type === "booleen") return v === true ? "oui" : v === false ? "non" : "";
    if (q.type === "choix") { const i = liste(q.options).findIndex(o => o === v); return i < 0 ? "" : String(i); }
    if (typeof v === "number") return String(v).replace(".", ",");
    return String(v);
  }
  /** Bornes dites dans l'aide (« Entre 0 et 150 000 €. »). */
  function bornesTexte(q) {
    if (!["montant_eur", "entier", "pourcentage"].includes(q.type) || (q.min == null && q.max == null)) return "";
    const f = v => (q.type === "montant_eur" ? eur(v) : q.type === "pourcentage" ? pct(v) : nombre(v));
    if (q.min != null && q.max != null) return "Entre " + f(q.min) + " et " + f(q.max) + ".";
    return q.min != null ? "Au moins " + f(q.min) + "." : "Au plus " + f(q.max) + ".";
  }
  /** Un champ du formulaire (libellé, aide, saisie, message d'erreur), sans <form> : l'app ne soumet rien. */
  function champHtml(cle, q, texte, erreur, manquant, modifie) {
    const id = idChamp(cle, q), aide = [q.aide, bornesTexte(q)].filter(Boolean).join(" ");
    const desc = (aide ? id + "-aide " : "") + id + "-err";
    /* data-scn-init : la valeur affichée au rendu (une valeur non modifiée est relue telle quelle, jamais réinterprétée) */
    const attrs = ' id="' + id + '" data-scn-q="' + esc(q.id) + '" data-scn-init="' + esc(texte) + '"' + (modifie ? " data-scn-modifie" : "") + ' aria-describedby="' + desc + '"' + (erreur ? ' aria-invalid="true"' : "");
    let ctl;
    if (q.type === "booleen") {
      ctl = '<select class="scn-select"' + attrs + '><option value=""' + (texte === "" ? " selected" : "") + ">—</option><option value=\"oui\"" + (texte === "oui" ? " selected" : "") + ">Oui</option><option value=\"non\"" + (texte === "non" ? " selected" : "") + ">Non</option></select>";
    } else if (q.type === "choix") {
      ctl = '<select class="scn-select"' + attrs + '><option value=""' + (texte === "" ? " selected" : "") + ">—</option>" +
        liste(q.options).map((o, i) => '<option value="' + i + '"' + (texte === String(i) ? " selected" : "") + ">" + esc(libelleChoix(q, o)) + "</option>").join("") + "</select>";
    } else if (q.type === "date") {
      ctl = '<input class="scn-input" type="date"' + attrs + ' value="' + esc(texte) + '">';
    } else {
      const u = UNITES[q.type];
      ctl = '<span class="scn-saisie"><input class="scn-input num" type="text" inputmode="' + (q.type === "entier" ? "numeric" : "decimal") + '" autocomplete="off"' + attrs + ' value="' + esc(texte) + '">' +
        (u ? '<span class="scn-unite" aria-hidden="true">' + u + "</span>" : "") + "</span>";
    }
    const unite = UNITES[q.type] ? '<span class="ui-sr"> (en ' + (q.type === "montant_eur" ? "euros" : "pour cent") + ")</span>" : "";
    return '<div class="scn-champ' + (manquant ? " manquant" : "") + (erreur ? " erreur" : "") + '" data-scn-champ="' + esc(q.id) + '"><label class="scn-champ-l" for="' + id + '">' + esc(q.libelle) + unite +
      (q.obligatoire ? "" : ' <span class="scn-facultatif">facultatif</span>') + (manquant ? ' <span class="ui-puce completer"><span class="ui-puce-point" aria-hidden="true"></span>À compléter</span>' : "") + "</label>" +
      (aide ? '<p class="scn-champ-aide" id="' + id + '-aide">' + esc(aide) + "</p>" : "") + ctl +
      '<p class="scn-champ-err" id="' + id + '-err"' + (erreur ? "" : " hidden") + ">" + esc(erreur || "") + "</p></div>";
  }
  /** Formulaire « Ajuster les hypothèses » : les questions du catalogue, préremplies (Scenarios.preremplir, puis les réponses en cours, puis la saisie
      gardée) ; les manquantes d'abord quand il manque des réponses. o = { prerempli, reponses, saisie, erreurs, manquants (ids), ouvert, resume }. */
  function formulaireHtml(entree, o) {
    const opt = o || {}, qs = liste(entree && entree.questions), manq = liste(opt.manquants), err = objet(opt.erreurs), saisie = objet(opt.saisie);
    const ordre = qs.filter(q => manq.includes(q.id)).concat(qs.filter(q => !manq.includes(q.id)));
    const valeur = q => (Object.prototype.hasOwnProperty.call(saisie, q.id) ? saisie[q.id] : texteChamp(q, Object.prototype.hasOwnProperty.call(objet(opt.reponses), q.id) ? opt.reponses[q.id] : objet(opt.prerempli)[q.id]));
    const resume = err._resume || "";
    return '<details class="ui-acc scn-bloc scn-ajuster" data-scn-bloc="ajuster"' + (opt.ouvert ? " open" : "") + ">" +
      '<summary class="ui-acc-titre"><span>' + (manq.length ? "Réponds à ces questions pour calculer" : "Ajuster les hypothèses") + '</span><span class="ui-acc-chevron" aria-hidden="true"><svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M6 9l6 6 6-6"/></svg></span></summary>' +
      '<div class="ui-acc-corps scn-form" data-scn-form="' + esc(entree.cle) + '">' +
      '<p class="scn-note">Le calcul se refait ici, sur ton appareil, avec tes réponses : rien n\'est enregistré dans Boussole.</p>' +
      '<p class="scn-form-err" role="alert" data-scn-form-err' + (resume ? "" : " hidden") + ">" + esc(resume) + "</p>" +
      ordre.map(q => champHtml(entree.cle, q, valeur(q), err[q.id], manq.includes(q.id), Object.prototype.hasOwnProperty.call(saisie, q.id))).join("") +
      '<div class="scn-form-actions"><button type="button" class="ui-btn" data-scn-recalculer>Recalculer</button>' +
      (Object.keys(objet(opt.reponses)).length ? '<button type="button" class="ui-btn secondaire" data-scn-reinit>Revenir à tes données</button>' : "") + "</div>" +
      "</div></details>";
  }
  /** Saisie brute { id: texte } → { reponses, erreurs } : nombres (virgule acceptée), entiers, oui / non, choix, dates ; une valeur vide n'est pas une
      réponse ; une valeur égale au préremplissage n'en est pas une non plus (la donnée de Boussole reste « Boussole ») ; contrôle final par
      Scenarios.reponsesValides, messages rattachés aux champs. erreurs = { id: message, _resume } ou null. */
  function lireSaisie(entree, brut, prerempli) {
    const qs = liste(entree && entree.questions), b = objet(brut), pre = objet(prerempli), reponses = {}, erreurs = {};
    qs.forEach(q => {
      if (!Object.prototype.hasOwnProperty.call(b, q.id)) return;
      const t = String(b[q.id] == null ? "" : b[q.id]).trim();
      if (t === "") return;
      let v;
      if (q.type === "montant_eur" || q.type === "entier" || q.type === "pourcentage") {
        const s = t.replace(/[\s\u00a0\u202f]/g, "").replace(/€|%/g, "").replace("\u2212", "-").replace(",", ".");
        if (!/^[-+]?\d+(\.\d+)?$/.test(s)) { erreurs[q.id] = "Entre un nombre."; return; }
        v = +s;
        if (q.type === "entier" && !Number.isInteger(v)) { erreurs[q.id] = "Entre un nombre entier."; return; }
      } else if (q.type === "booleen") {
        if (t !== "oui" && t !== "non") { erreurs[q.id] = "Choisis oui ou non."; return; }
        v = t === "oui";
      } else if (q.type === "choix") {
        const o = liste(q.options)[+t];
        if (!/^\d+$/.test(t) || o === undefined) { erreurs[q.id] = "Choisis une des réponses proposées."; return; }
        v = o;
      } else if (q.type === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) { erreurs[q.id] = "Entre une date (jour, mois, année)."; return; }
        v = t;
      } else return;
      if (Object.prototype.hasOwnProperty.call(pre, q.id) && pre[q.id] === v) return;
      reponses[q.id] = v;
    });
    const S = Sc(), msgs = S && typeof S.reponsesValides === "function" ? S.reponsesValides(entree, reponses) : null;
    liste(msgs).forEach(m => {
      const id = (/^« ([^»]+) »/.exec(m) || [])[1], q = qs.find(x => x.id === id);
      if (!q) { erreurs._autre = m; return; }
      erreurs[id] = /hors des bornes/.test(m) ? (bornesTexte(q) || "Valeur hors des bornes.") : /nombre/.test(m) ? "Entre un nombre." : /date/.test(m) ? "Entre une date (jour, mois, année)." : "Valeur non acceptée.";
      delete reponses[id];
    });
    const n = Object.keys(erreurs).filter(k => !k.startsWith("_")).length;
    if (n || erreurs._autre) erreurs._resume = n ? (n > 1 ? n + " réponses sont à corriger." : "Une réponse est à corriger.") + " Le calcul n'a pas été refait." : erreurs._autre;
    return { reponses, erreurs: Object.keys(erreurs).length ? erreurs : null };
  }

  /* ================================================================== le détail : blocs */
  const titreBloc = (id, t) => '<h3 class="scn-bloc-t" id="' + id + '">' + esc(t) + "</h3>";
  /** Bloc 1 : la réponse (phrase, écart P50 en grand, bande, date de bascule, date du calcul, partie déjà jouée, avertissements). */
  function reponseHtml(entree, r, o) {
    const rep = objet(r.reponse), e = objet(rep.ecart), tete = liste(r.options).find(x => x.id === rep.option_en_tete);
    const opt = o || {}, j = opt.partie;
    const bande = fini(e.p10) && fini(e.p90) && arr10(e.p10) !== arr10(e.p90) ? "Entre " + eur(e.p10, { signe: true }) + " et " + eur(e.p90, { signe: true }) + ", 8 chances sur 10" : "";
    const mieux = fini(rep.probabilite_mieux) && tete ? capitale(chances(rep.probabilite_mieux)) + " que « " + tete.libelle + " » fasse mieux." : "";
    const calcul = (opt.final ? "Calculé aujourd'hui avec tes données" : "Premier calcul, en cours d'affinage") + " · calcul " + esc(r.version_calcul || "") + " · " + nombre(r.chemins) + " tirages";
    let jouee = "";
    if (j) {
      const ancien = objet(objet(j.resultat).reponse);
      const etat = j.etat === "retenu" ? "retenu" : j.etat === "ecarte" ? "écarté" : "joué";
      jouee = '<p class="scn-jouee">Tu as joué ce scénario le ' + esc(jjmmaaaa(j.joue_le) || jjmm(j.joue_le)) + (j.version_calcul ? " (calcul " + esc(j.version_calcul) + ")" : "") + " : " + etat + "." +
        (ancien.phrase ? " Réponse d'alors : « " + esc(ancien.phrase) + " »" : "") + "</p>";
      const a = objet(ancien.ecart).p50;
      if (fini(a) && fini(e.p50) && Math.abs(a) > 0 && Math.abs(e.p50 - a) / Math.abs(a) > 0.1) jouee += '<p class="scn-jouee ecart">L\'écart du calcul du jour diffère de plus de 10 % de celui d\'alors : tes données ou les repères ont changé depuis.</p>';
    }
    const avert = liste(r.avertissements);
    return '<section class="scn-bloc scn-reponse" data-scn-bloc="reponse" aria-labelledby="scnRepT-' + esc(entree.cle) + '">' + titreBloc("scnRepT-" + esc(entree.cle), "La réponse") +
      '<p class="scn-phrase">' + esc(rep.phrase || "") + "</p>" +
      (fini(e.p50) && rep.option_en_tete !== "egalite" ? '<p class="scn-ecart"><span class="scn-ecart-v num">' + esc(eur(e.p50, { signe: true })) + '</span><span class="scn-ecart-u">en euros d\'aujourd\'hui' + (tete ? ", pour « " + esc(tete.libelle) + " »" : "") + "</span></p>" : "") +
      (bande ? '<p class="scn-ecart-bande num">' + esc(bande) + "</p>" : "") +
      (mieux ? '<p class="scn-mieux">' + esc(mieux) + "</p>" : "") +
      (estDate(rep.date_bascule) ? '<p class="scn-bascule">À partir de ' + esc(moisAnnee(rep.date_bascule)) + "</p>" : "") +
      '<p class="scn-calcule">' + calcul + "</p>" + jouee +
      (avert.length ? '<div class="scn-avert"><p class="scn-avert-t">À savoir</p><ul>' + avert.map(t => "<li>" + esc(t) + "</li>").join("") + "</ul></div>" : "") +
      "</section>";
  }
  /** Bloc 2 : la comparaison (barres d'intervalle, « Voir les chiffres », courbe et patrimoine dessinés après insertion, à la largeur du conteneur). */
  function comparaisonHtml(entree, r, o) {
    const opt = o || {}, k = esc(entree.cle), ouvert = !!opt.chiffresOuverts;
    const courbe = liste(r.courbe && r.courbe.points).length >= 2, patri = liste(r.detail && r.detail.patrimoine && r.detail.patrimoine.points).length >= 2;
    return '<section class="scn-bloc scn-comparaison" data-scn-bloc="comparaison" aria-labelledby="scnCmpT-' + k + '">' + titreBloc("scnCmpT-" + k, "La comparaison") +
      intervallesHtml(r) +
      '<button type="button" class="ui-btn tertiaire scn-chiffres-btn" data-scn-chiffres aria-expanded="' + ouvert + '" aria-controls="scnChiffres-' + k + '">' + (ouvert ? "Masquer les chiffres" : "Voir les chiffres") + "</button>" +
      '<div class="scn-chiffres" id="scnChiffres-' + k + '"' + (ouvert ? "" : " hidden") + ">" + tableauHtml(r) + "</div>" +
      (courbe ? '<figure class="scn-figure"><figcaption class="scn-fig-t">Gain selon la date de retrait</figcaption><div class="scn-graphe" data-scn-graphe="courbe" role="img"></div></figure>' : "") +
      (patri ? '<figure class="scn-figure"><figcaption class="scn-fig-t">Patrimoine net selon l\'année de sortie</figcaption><div class="scn-graphe" data-scn-graphe="patrimoine" role="img"></div></figure>' : "") +
      "</section>";
  }
  /** Bloc 3 : ce qui changerait la réponse (2 à 4 lignes, chacune avec son seuil). */
  function changeraitHtml(entree, r) {
    const l = liste(r.ce_qui_changerait);
    if (!l.length) return "";
    const k = esc(entree.cle);
    return '<section class="scn-bloc scn-changerait" data-scn-bloc="changerait" aria-labelledby="scnChgT-' + k + '">' + titreBloc("scnChgT-" + k, "Ce qui changerait la réponse") +
      '<ul class="scn-liste-l">' + l.map(x => "<li><p>" + esc(x.phrase || x.effet || "") + "</p>" +
        (x.seuil != null && x.seuil !== "" ? '<p class="scn-seuil">Seuil : <b class="num">' + esc(x.seuil) + "</b>" + (x.valeur_retenue != null && x.valeur_retenue !== "" ? " · retenu : " + esc(x.valeur_retenue) : "") + "</p>" : "") + "</li>").join("") + "</ul></section>";
  }
  const lienSur = u => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);
  /** Bloc 4 : hypothèses et sources (replié sous 1 440 px, ouvert au-delà). */
  function hypothesesHtml(entree, r, o) {
    const l = liste(r && r.hypotheses), opt = o || {};
    if (!l.length) return "";
    const items = l.map(h => {
      const s = objet(h.source), u = lienSur(s.url), st = STATUTS_HYP[h.statut] || "Vérifié";
      const val = fini(h.valeur) ? nombre(h.valeur, h.valeur % 1 ? 2 : 0).replace(/(,\d*?)0+$/, "$1").replace(/,$/, "") + (h.unite ? "\u00a0" + h.unite : "") : String(h.valeur == null ? "—" : h.valeur);
      return '<li class="scn-hyp"><span class="scn-hyp-l">' + esc(h.libelle || h.cle) + '</span><span class="scn-hyp-v num">' + esc(val) + "</span>" +
        '<span class="scn-hyp-meta"><span class="ui-badge ' + (h.statut === "a_reverifier" ? "attention" : h.statut === "convention" ? "neutre" : "info") + '">' + esc(st) + "</span>" +
        (u ? ' <a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(s.titre || "Source") + '<span class="ui-sr"> (nouvel onglet)</span></a>' : s.titre ? " " + esc(s.titre) : "") +
        (s.verifie_le ? ' <span class="scn-hyp-date">vérifié le ' + esc(jjmmaaaa(s.verifie_le)) + "</span>" : "") + "</span></li>";
    }).join("");
    return '<details class="ui-acc scn-bloc scn-hypotheses" data-scn-bloc="hypotheses"' + (opt.ouvert ? " open" : "") + '><summary class="ui-acc-titre"><span>Hypothèses et sources (' + l.length + ')</span><span class="ui-acc-chevron" aria-hidden="true"><svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M6 9l6 6 6-6"/></svg></span></summary>' +
      '<div class="ui-acc-corps"><ul class="scn-hyps">' + items + "</ul></div></details>";
  }
  /** Bloc 5 : tes données utilisées (champ, valeur, origine, date) et « Compléter avec Claude ». */
  function donneesHtml(entree, r) {
    const l = liste(r && r.donnees_utilisees), qs = Object.fromEntries(liste(entree.questions).map(q => [q.id, q])), k = esc(entree.cle), U = glob("UI"), P = CP();
    const lien = U && U.demanderAClaude ? U.demanderAClaude(P && P.phrase ? P.phrase("bilan", "les données du scénario « " + entree.question + " »") : "Boussole : aide-moi à compléter mon bilan.", "Compléter avec Claude") : "";
    return '<section class="scn-bloc scn-donnees" data-scn-bloc="donnees" aria-labelledby="scnDonT-' + k + '">' + titreBloc("scnDonT-" + k, "Tes données utilisées") +
      (l.length ? '<ul class="scn-donnees-l">' + l.map(d => '<li><span class="scn-don-l">' + esc(d.libelle || d.champ) + '</span><span class="scn-don-v num">' + esc(valeurLisible(qs[d.champ], d.valeur)) + '</span><span class="scn-don-o">' +
        esc(ORIGINES[d.origine] || d.origine || "") + (d.le ? ", " + esc(jjmm(d.le)) : "") + "</span></li>").join("") + "</ul>" : '<p class="scn-note">Aucune donnée encore utilisée : réponds aux questions ci-dessous.</p>') +
      '<p class="scn-donnees-claude">Une donnée manque ou n\'est plus à jour ? ' + lien + "</p></section>";
  }
  /** Bloc 7 : « Explorer avec Claude » (texte prêt à copier, bouton Copier avec repli par sélection, lien qui ouvre Claude). */
  function claudeHtml(entree) {
    const P = CP(), U = glob("UI"), k = esc(entree.cle);
    const texte = P && P.phrase ? P.phrase("scenario", entree.question) : "Boussole : joue avec moi le scénario « " + entree.question + " » de Boussole.";
    return '<section class="scn-bloc scn-claude" data-scn-bloc="claude" aria-labelledby="scnClT-' + k + '">' + titreBloc("scnClT-" + k, "Explorer avec Claude") +
      '<p class="scn-note">Claude rejoue ce scénario avec toi, sur tes données, et te demande ce qui manque. Tu décides de ce qui est enregistré.</p>' +
      '<label class="ui-sr" for="scnTexte-' + k + '">Texte à coller dans Claude</label><textarea class="scn-texte" id="scnTexte-' + k + '" data-scn-texte readonly rows="3">' + esc(texte) + "</textarea>" +
      '<div class="scn-claude-actions"><button type="button" class="ui-btn secondaire" data-scn-copier>Copier le texte</button>' + (U && U.demanderAClaude ? U.demanderAClaude(texte, "Ouvrir dans Claude") : "") + "</div>" +
      '<p class="scn-copie-msg" role="status" aria-live="polite" data-scn-copie-msg></p></section>';
  }
  const piedHtml = () => '<p class="scn-pied" data-scn-bloc="pied">' + esc(PIED) + "</p>";

  /** Détail complet d'un scénario, blocs dans l'ordre du § 10.3. o = { etat: "calcul" | "pret" | "erreur", resultat, final, partie, prerempli, reponses, saisie,
      erreurs, chiffresOuverts, hypoOuvertes, hypoSeparees (≥ 1 680 px : la colonne à part reçoit les hypothèses), formOuvert, titre (h2 dans la page), retour }. */
  function detailHtml(entree, o) {
    const opt = o || {}, r = opt.resultat, k = esc(entree.cle);
    const entete = opt.titre ? '<header class="scn-detail-tete">' + (opt.retour ? '<a class="scn-retour" href="' + LIEN_LISTE + '" data-scn-retour>' + RETOUR + "<span>Tous les scénarios</span></a>" : "") +
      '<span class="ui-badge neutre scn-theme-puce">' + esc(libelleTheme(entree.theme)) + '</span><h2 class="scn-detail-titre" id="scnDetailTitre" tabindex="-1">' + esc(entree.question) + "</h2></header>" : "";
    const form = manquants => formulaireHtml(entree, { prerempli: opt.prerempli, reponses: opt.reponses, saisie: opt.saisie, erreurs: opt.erreurs, manquants, ouvert: manquants.length > 0 || !!opt.formOuvert || !!opt.erreurs });
    const hyp = r ? hypothesesHtml(entree, r, { ouvert: opt.hypoOuvertes }) : "";
    const hypDansDetail = opt.hypoSeparees ? "" : hyp;
    let corps;
    if (opt.etat === "erreur") {
      corps = '<section class="scn-bloc scn-reponse" data-scn-bloc="reponse"><p class="scn-phrase" role="alert">Le calcul n\'a pas abouti. Recharge la page ; si le problème persiste, demande à Claude de jouer ce scénario.</p></section>' + claudeHtml(entree);
    } else if (!r) {
      const U = glob("UI");
      corps = '<section class="scn-bloc scn-reponse" data-scn-bloc="reponse" aria-busy="true"><p class="scn-phrase" role="status">Calcul en cours sur ta situation…</p>' + (U && U.squelette ? U.squelette(1, "graphe") : "") + "</section>";
    } else if (r.statut === "indisponible") {
      corps = '<section class="scn-bloc scn-reponse indisponible" data-scn-bloc="reponse" aria-labelledby="scnRepT-' + k + '">' + titreBloc("scnRepT-" + k, "La réponse") + '<p class="scn-phrase">' + esc(MSG_INDISPO) + "</p>" +
        '<p class="scn-note">Boussole ne donne aucun chiffre plutôt qu\'une valeur de remplacement : le calcul reviendra dès que le repère sera publié.</p>' +
        (liste(r.avertissements).length ? '<ul class="scn-avert-l">' + liste(r.avertissements).map(t => "<li>" + esc(t) + "</li>").join("") + "</ul>" : "") + "</section>" +
        hypDansDetail + claudeHtml(entree);
    } else if (r.statut === "a_completer") {
      const ids = liste(r.manquants).map(m => m.question_id).filter(Boolean), autres = liste(r.manquants).filter(m => !m.question_id);
      corps = '<section class="scn-bloc scn-reponse a-completer" data-scn-bloc="reponse" aria-labelledby="scnRepT-' + k + '">' + titreBloc("scnRepT-" + k, "La réponse") +
        '<p class="scn-phrase">Il manque ' + (liste(r.manquants).length > 1 ? "quelques réponses" : "une réponse") + " pour calculer : " + esc(liste(r.manquants).map(m => m.libelle).join(", ")) + ".</p>" +
        (autres.length ? '<p class="scn-note">' + esc(autres.map(m => m.comment).filter(Boolean).join(" ")) + "</p>" : "") + "</section>" +
        form(ids) + hypDansDetail + donneesHtml(entree, r) + claudeHtml(entree);
    } else {
      corps = reponseHtml(entree, r, opt) + comparaisonHtml(entree, r, opt) + changeraitHtml(entree, r) + hypDansDetail + donneesHtml(entree, r) + form([]) + claudeHtml(entree);
    }
    return '<div class="scn-detail-corps" data-scn-detail="' + k + '">' + entete + corps + piedHtml() +
      (opt.retour ? '<div class="scn-collant"><button type="button" class="ui-claude" data-scn-vers-claude aria-controls="scnTexte-' + k + '"><span>Explorer avec Claude</span></button></div>' : "") + "</div>";
  }

  const H = { THEMES, ORDRE_THEMES, OUTIL, ROUTE, EN_TETE, RIEN_URGENT, AUTRES, MSG_INDISPO, PIED, LIBELLES_CHOIX, STATUTS_HYP, LIEN_OUTIL, LIEN_LISTE,
    disposition, vueDe, lienScenario, derniereJouee, cartesDeBase, enjeuCarte, etatHtml, carteHtml, carteOutilHtml, listeHtml, intervallesHtml, tableauHtml,
    courbeSvg, patrimoineSvg, formulaireHtml, champHtml, lireSaisie, texteChamp, libelleChoix, valeurLisible, reponseHtml, comparaisonHtml, changeraitHtml,
    hypothesesHtml, donneesHtml, claudeHtml, detailHtml, chances, eur, arr10, moisAnnee };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* ================================================================== navigateur */
  let root = null, S = null, visible = false, bootFini = false;
  const $ = id => root.querySelector("#" + id);
  const vue = { vue: "liste", cle: null };
  let origine = null; // { cle, zone } : carte qui retrouvera le focus
  let dispo = "page";
  const themesOuverts = new Map(); // thème → ouvert (choix de la personne)
  /* calculs */
  let donnees = null, sigDonnees = "", aujourdhui = "";
  let cartes = null, pourToi = null, sigCartes = "", annulerCartes = null;
  const reponsesEnCours = {}, saisies = {}, erreurs = {}, chiffresOuverts = new Set(), formsOuverts = new Set(), hyposOuvertes = new Set();
  const cache = new Map(); // clé de calcul → { resultat, chemins, final }
  let detailCalc = null; // { cle, cleCalcul, annuler }
  let detailEtat = null; // { cle, cleCalcul, etat, resultat, final }
  let panneauCle = null, fermetureVolontaire = false;
  let dernierListe = "", dernierDetail = "";

  const fenetre = () => (typeof window !== "undefined" ? window : null);
  const largeur = () => { const w = fenetre(); return w && typeof w.innerWidth === "number" ? w.innerWidth : 390; };
  function jour() {
    const R = glob("RoutineEtat");
    try { if (R && typeof R.aujParis === "function") return R.aujParis(); } catch (e) { /* repli */ }
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  const catalogueDe = s => { const sc = s && s.scenarios; if (sc && Array.isArray(sc.catalogue)) return sc.catalogue; const C = CatalogueEmbarque(); return C && Array.isArray(C.catalogue) ? C.catalogue : []; };
  const jouesDe = s => liste(s && s.scenarios && s.scenarios.joues);
  const entreeDe = cle => catalogueDe(S).find(e => e && e.cle === cle) || null;
  /** Données du foyer pour le calcul (forme de Projection.preparer), sans l'historique (inutile ici et lourd à transmettre au worker). */
  function preparerDonnees() {
    const P = glob("ProjectionDonnees");
    if (!P || typeof P.depuisEtat !== "function" || !S) return null;
    const d = P.depuisEtat(S, aujourdhui);
    d.risque = S.risque || null;
    delete d.historique;
    return d;
  }
  function signature(d) {
    const Pj = glob("Projection");
    try { if (Pj && typeof Pj.empreinte === "function") return Pj.empreinte(d, {}); } catch (e) { /* repli */ }
    const t = JSON.stringify(d);
    let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return t.length + ":" + (h >>> 0).toString(36);
  }
  const cleReponses = r => JSON.stringify(Object.keys(objet(r)).sort().map(k => [k, r[k]]));

  /* ---------- calcul : Web Worker, sinon fil principal en différé ---------- */
  function lancer(msg, rappel) {
    let fini_ = false, w = null;
    const arreter = () => { fini_ = true; if (w) { try { w.terminate(); } catch (e) { /* rien */ } w = null; } };
    const W = typeof Worker !== "undefined" ? Worker : null;
    if (W) { try { w = new W("app/scenarios-worker.js"); } catch (e) { w = null; } }
    function surFil() {
      const C = glob("ScenariosCalcul");
      if (!C) { setTimeout(() => { if (!fini_) rappel({ erreur: "calcul indisponible" }); }, 0); return; }
      const etapes = msg.type === "jouer" ? liste(msg.etapes) : [null];
      let k = 0;
      const pas = () => {
        if (fini_) return;
        let stop = false;
        const m = msg.type === "jouer" ? Object.assign({}, msg, { etapes: [etapes[k]] }) : msg;
        C.traiter(m, rep => {
          if (fini_) return;
          const x = rep.type === "jouer" ? Object.assign({}, rep, { etape: k, dernier: k === etapes.length - 1 || !rep.resultat || rep.resultat.statut !== "ok" }) : rep;
          rappel(x);
          if (x.erreur || x.dernier) stop = true;
        });
        k++;
        if (!stop && k < etapes.length) setTimeout(pas, 0); else fini_ = true;
      };
      setTimeout(pas, 0);
    }
    if (w) {
      w.onmessage = ev => { if (fini_) return; const m = ev.data || {}; rappel(m); if (m.erreur || m.dernier) arreter(); };
      w.onerror = () => { if (fini_) return; try { w.terminate(); } catch (e) { /* rien */ } w = null; surFil(); };
      try { w.postMessage(msg); } catch (e) { try { w.terminate(); } catch (x) { /* rien */ } w = null; surFil(); }
    } else surFil();
    return arreter;
  }

  /** Cartes : base immédiate (pertinence), puis enjeux calculés hors du fil principal ; relancé quand les données ou les réponses changent. */
  function calculerCartes() {
    const cat = catalogueDe(S), joues = jouesDe(S);
    const sig = sigDonnees + "|" + cleReponses(Object.fromEntries(Object.keys(reponsesEnCours).map(k => [k, cleReponses(reponsesEnCours[k])]))) + "|" + JSON.stringify(joues.map(j => [j.scenario_cle, j.etat, j.joue_le])) + "|" + cat.map(e => e.cle + ":" + e.version).join(",");
    if (sig === sigCartes) return;
    sigCartes = sig;
    if (annulerCartes) annulerCartes();
    cartes = cartesDeBase(cat, donnees, joues, aujourdhui);
    pourToi = null;
    annulerCartes = lancer({ type: "cartes", catalogue: cat, data: donnees, joues, today: aujourdhui, opts: { reponses_par_cle: reponsesEnCours } }, m => {
      if (m.erreur) { cartes = cartes.map(c => Object.assign({}, c, { enjeu_statut: c.pertinent ? "indisponible" : null })); pourToi = []; }
      else if (m.resultat) { cartes = m.resultat.cartes; pourToi = m.resultat.pour_toi; }
      annulerCartes = null;
      rendreListe();
    });
  }

  /** Détail : résultat en cache, sinon calcul à 500 puis 2 000 chemins (les cartes, elles, restent à 500). */
  function calculerDetail(cle) {
    const e = entreeDe(cle);
    if (!e) return;
    const rep = objet(reponsesEnCours[cle]), cc = cle + "|" + cleReponses(rep) + "|" + sigDonnees;
    if (detailEtat && detailEtat.cleCalcul === cc) return;
    if (detailCalc && detailCalc.cleCalcul === cc) return;
    if (detailCalc) { detailCalc.annuler(); detailCalc = null; }
    const c = cache.get(cc);
    if (c) { detailEtat = { cle, cleCalcul: cc, etat: "pret", resultat: c.resultat, final: true }; return; }
    detailEtat = { cle, cleCalcul: cc, etat: "calcul", resultat: detailEtat && detailEtat.cle === cle ? detailEtat.resultat : null, final: false };
    const annuler = lancer({ type: "jouer", entree: e, data: donnees, reponses: rep, today: aujourdhui, etapes: [500, 2000] }, m => {
      if (!detailEtat || detailEtat.cleCalcul !== cc) return;
      if (m.erreur) { detailEtat = { cle, cleCalcul: cc, etat: "erreur", resultat: null, final: true }; detailCalc = null; rendreDetail(); return; }
      detailEtat = { cle, cleCalcul: cc, etat: m.dernier ? "pret" : "calcul", resultat: m.resultat, final: !!m.dernier };
      if (m.dernier) {
        cache.set(cc, { resultat: m.resultat });
        while (cache.size > 24) cache.delete(cache.keys().next().value);
        detailCalc = null;
      }
      rendreDetail();
    });
    detailCalc = { cle, cleCalcul: cc, annuler };
  }

  /* ---------- rendu ---------- */
  function majDonnees() {
    aujourdhui = jour();
    const d = preparerDonnees();
    if (!d) { donnees = null; sigDonnees = ""; return; }
    donnees = d;
    sigDonnees = signature(d);
  }
  function rendreListe() {
    if (!root) return;
    const pret = !!(S && S.ready && donnees);
    const html = S && S.dbOk === false ? '<header class="scn-tete"><h2 id="scnTitre" tabindex="-1">Et si… ?</h2><p class="scn-sous">' + esc(EN_TETE) + '</p></header><p class="scn-vide" role="status">Les données ne sont pas disponibles pour le moment : les scénarios se calculent sur ta situation.</p>'
      : listeHtml({ pret, cartes, pour_toi: pourToi, compact: largeur() < 600, ouverts: themesOuverts, actif: vue.vue === "detail" && (dispo === "maitre" || dispo === "trois") ? vue.cle : null,
        noteMfa: !!(S && S.scenarios && S.scenarios.mfaRequise) });
    const L = $("scnListe");
    if (html !== dernierListe) {
      const actif = typeof document !== "undefined" ? document.activeElement : null, dedans = actif && actif.getAttribute && L.contains(actif);
      const focusCarte = dedans && actif.getAttribute("data-scn-cle") ? { cle: actif.getAttribute("data-scn-cle"), zone: actif.getAttribute("data-scn-zone") } : null;
      const th = dedans && !focusCarte && actif.localName === "summary" && actif.parentNode && actif.parentNode.getAttribute ? actif.parentNode.getAttribute("data-scn-theme") : null;
      L.innerHTML = html;
      dernierListe = html;
      if (focusCarte) focaliserCarte(focusCarte);
      else if (th) { const d = Array.from(L.querySelectorAll("[data-scn-theme]")).find(x => x.getAttribute("data-scn-theme") === th); const sm = d && d.querySelector("summary"); if (sm) sm.focus(); }
    }
  }
  function focaliserCarte(o) {
    if (!o || !root) return false;
    const l = Array.from(root.querySelectorAll("[data-scn-cle]")).filter(x => x.getAttribute("data-scn-cle") === o.cle);
    const c = l.find(x => x.getAttribute("data-scn-zone") === o.zone) || l[0];
    if (c) { c.focus(); return true; }
    return false;
  }
  /** Garde la saisie en cours du formulaire (et le champ qui a le focus) avant de redessiner. */
  let oublierSaisie = null; // « Revenir à tes données » : la saisie affichée n'est pas reprise au rendu suivant
  function capturer(conteneur, cle) {
    if (!conteneur || !cle) return null;
    const f = oublierSaisie === cle ? null : conteneur.querySelector('[data-scn-form="' + cle + '"]');
    if (oublierSaisie === cle) { delete saisies[cle]; oublierSaisie = null; }
    let focus = null;
    if (f) {
      /* seuls les champs modifiés par la personne sont gardés : les autres suivent ses données (préremplissage) au rendu suivant */
      const brut = Object.assign({}, saisies[cle]);
      f.querySelectorAll("[data-scn-q]").forEach(el => { if (el.hasAttribute("data-scn-modifie")) brut[el.getAttribute("data-scn-q")] = el.value; });
      if (Object.keys(brut).length) saisies[cle] = brut; else delete saisies[cle];
      const d = f.closest("details");
      if (d) { if (d.hasAttribute("open")) formsOuverts.add(cle); else formsOuverts.delete(cle); }
    }
    const doc = typeof document !== "undefined" ? document : null, a = doc && doc.activeElement;
    if (a && conteneur.contains(a)) focus = a.getAttribute("data-scn-q") ? '[data-scn-q="' + a.getAttribute("data-scn-q") + '"]' : a.hasAttribute("data-scn-recalculer") ? "[data-scn-recalculer]" :
      a.hasAttribute("data-scn-chiffres") ? "[data-scn-chiffres]" : a.getAttribute("data-scn-bloc") ? '[data-scn-bloc="' + a.getAttribute("data-scn-bloc") + '"]' : a.id === "scnDetailTitre" ? "#scnDetailTitre" : null;
    const h = conteneur.querySelector('[data-scn-bloc="hypotheses"]');
    if (h && !conteneur.classList.contains("scn-hypo-col")) { if (h.hasAttribute("open")) hyposOuvertes.add(cle); else hyposOuvertes.delete(cle); }
    return { focus };
  }
  function restaurer(conteneur, etat) {
    if (!etat || !conteneur) return;
    if (etat.focus) { const el = conteneur.querySelector(etat.focus); if (el) { if (/^\[data-scn-bloc/.test(etat.focus)) el.setAttribute("tabindex", "-1"); el.focus(); } }
  }
  /** HTML du détail courant (selon la disposition). */
  function detailCourant(dansPage) {
    const cle = vue.cle, e = entreeDe(cle);
    if (!e) return null;
    let pre = {};
    try { pre = Sc() && donnees ? Sc().preremplir(e, donnees, aujourdhui) : {}; } catch (x) { pre = {}; }
    const d = detailEtat && detailEtat.cle === cle ? detailEtat : { etat: "calcul", resultat: null, final: false };
    return { e, html: detailHtml(e, { etat: d.etat, resultat: d.resultat, final: d.final, partie: derniereJouee(jouesDe(S), cle), prerempli: pre, reponses: reponsesEnCours[cle] || {},
      saisie: saisies[cle], erreurs: erreurs[cle], chiffresOuverts: chiffresOuverts.has(cle), formOuvert: formsOuverts.has(cle), hypoOuvertes: dispo === "maitre" || dispo === "trois" || hyposOuvertes.has(cle),
      hypoSeparees: dispo === "trois", titre: dansPage, retour: dansPage && dispo === "page" }), resultat: d.resultat };
  }
  /** Dessine les graphiques (courbe, patrimoine) à la largeur réelle de leur conteneur. */
  function dessiner(conteneur, r) {
    if (!conteneur || !r) return;
    conteneur.querySelectorAll("[data-scn-graphe]").forEach(el => {
      const w = el.clientWidth || (el.parentNode && el.parentNode.clientWidth) || 600;
      const g = el.getAttribute("data-scn-graphe") === "courbe" ? courbeSvg(r, w) : patrimoineSvg(r, w);
      if (!g) { el.innerHTML = ""; return; }
      el.innerHTML = g.svg + (g.legende || "");
      el.setAttribute("aria-label", g.phrase);
    });
  }
  function rendreDetail() {
    if (!root) return;
    const D = $("scnDetail"), Hc = $("scnHypoCol");
    const inline = vue.vue === "detail" && dispo !== "panneau";
    if (vue.vue !== "detail") {
      if (panneauCle) fermerPanneau(false);
      D.hidden = !(dispo === "maitre" || dispo === "trois");
      const vide = '<div class="scn-detail-vide"><p class="scn-note">Choisis une question à gauche : la réponse, la comparaison et ce qui la changerait s\'affichent ici.</p></div>';
      if (dernierDetail !== vide) { D.innerHTML = vide; dernierDetail = vide; }
      Hc.hidden = true; Hc.innerHTML = "";
      return;
    }
    /* la saisie en cours (et le focus) est gardée AVANT de recalculer le HTML : une mise à jour du store n'efface jamais ce qui est tapé */
    const etat = capturer(panneauCle ? corpsPanneau : D, vue.cle);
    const x = detailCourant(inline);
    if (!x) {
      const html = '<div class="scn-detail-corps"><p class="scn-vide" role="status">Ce scénario n\'est plus dans le catalogue.</p><p><a class="scn-retour" href="' + LIEN_LISTE + '" data-scn-retour>' + RETOUR + "<span>Tous les scénarios</span></a></p></div>";
      if (panneauCle) fermerPanneau(false);
      D.hidden = false; D.innerHTML = html; dernierDetail = html; Hc.hidden = true;
      return;
    }
    if (inline) {
      if (panneauCle) fermerPanneau(false);
      D.hidden = false;
      if (x.html !== dernierDetail) {
        D.innerHTML = x.html;
        dernierDetail = x.html;
        dessiner(D, x.resultat);
        restaurer(D, etat);
      }
      const hyp = dispo === "trois" && x.resultat ? hypothesesHtml(x.e, x.resultat, { ouvert: true }) : "";
      Hc.hidden = !hyp;
      if (Hc.innerHTML !== hyp) Hc.innerHTML = hyp;
    } else {
      D.hidden = true; Hc.hidden = true;
      ouvrirPanneau(x, etat);
    }
  }
  /* ---------- panneau latéral (900 à 1 439 px) ---------- */
  const corpsBranches = new WeakSet();
  function ouvrirPanneau(x, etat) {
    const U = glob("UI");
    if (!U || !U.panneau) return;
    if (panneauCle === vue.cle && U.panneau.ouvert()) {
      if (x.html === dernierDetail) return;
      const c = U.panneau.remplacer({ titre: x.e.question, contenu: x.html });
      dernierDetail = x.html;
      if (c) { dessiner(c, x.resultat); restaurer(c, etat); }
      return;
    }
    const retour = origine ? Array.from(root.querySelectorAll("[data-scn-cle]")).find(el => el.getAttribute("data-scn-cle") === origine.cle && el.getAttribute("data-scn-zone") === origine.zone) ||
      Array.from(root.querySelectorAll("[data-scn-cle]")).find(el => el.getAttribute("data-scn-cle") === origine.cle) : null;
    const cle = vue.cle;
    const c = U.panneau.ouvrir({ titre: x.e.question, contenu: x.html, retour: retour || undefined, surFermeture: f => surFermeturePanneau(cle, f) });
    panneauCle = cle;
    dernierDetail = x.html;
    corpsPanneau = c;
    if (c) {
      const p = c.closest ? c.closest(".ui-panneau") : null;
      if (p) p.classList.add("scn-panneau");
      if (!corpsBranches.has(c)) { corpsBranches.add(c); c.addEventListener("click", ev => surClic(ev, c)); c.addEventListener("toggle", ev => surBascule(ev), true); ["input", "change"].forEach(t => c.addEventListener(t, surSaisie, true)); }
      dessiner(c, x.resultat);
    }
  }
  let corpsPanneau = null;
  function fermerPanneau(focus) {
    const U = glob("UI");
    fermetureVolontaire = true;
    if (U && U.panneau && U.panneau.ouvert()) U.panneau.fermer(focus === false ? { focus: false } : undefined);
    fermetureVolontaire = false;
    panneauCle = null;
  }
  function surFermeturePanneau(cle, f) {
    const p = corpsPanneau && corpsPanneau.closest ? corpsPanneau.closest(".ui-panneau") : null;
    if (p) p.classList.remove("scn-panneau");
    if (corpsPanneau) capturer(corpsPanneau, cle);
    panneauCle = null;
    dernierDetail = "";
    if (fermetureVolontaire) return;
    /* fermé par la personne (Échap, « Fermer », voile) : retour à la liste (une entrée d'historique, comme les fiches de Comptes) ; fermé par la navigation
       (retour arrière, lien interne) : la coque s'en charge */
    if (f && f.focus === false) return;
    const o = origine || { cle };
    vue.vue = "liste"; vue.cle = null;
    if (glob("App") && typeof App.go === "function") App.go(ROUTE);
    if (!focaliserCarte(o)) { const t = $("scnTitre"); if (t) t.focus(); }
  }

  function render() {
    if (!root) return;
    dispo = disposition(largeur());
    root.querySelector(".scn").setAttribute("data-disposition", dispo);
    root.querySelector(".scn").setAttribute("data-vue", vue.vue);
    const outil = vue.vue === "outil";
    $("scnBiblio").hidden = outil;
    const O = root.querySelector("[data-scn-outil]");
    if (O) O.hidden = !outil;
    if (outil) { if (panneauCle) fermerPanneau(false); return; }
    majDonnees();
    if (S && S.ready && donnees) {
      calculerCartes();
      if (vue.vue === "detail" && entreeDe(vue.cle)) calculerDetail(vue.cle);
    }
    /* sous 900 px, le détail remplace la liste (page dédiée) */
    $("scnListe").hidden = vue.vue === "detail" && dispo === "page";
    rendreListe();
    rendreDetail();
  }

  /* ---------- événements ---------- */
  async function copier(conteneur) {
    const ta = conteneur.querySelector("[data-scn-texte]"), msg = conteneur.querySelector("[data-scn-copie-msg]");
    if (!ta) return;
    const texte = ta.value || ta.textContent || "";
    const dire = t => { if (msg) msg.textContent = t; };
    try {
      const nav = typeof navigator !== "undefined" ? navigator : null;
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") { await nav.clipboard.writeText(texte); dire("Texte copié : colle-le dans Claude."); return; }
      throw new Error("presse-papiers indisponible");
    } catch (e) {
      try { ta.focus(); if (typeof ta.select === "function") ta.select(); } catch (x) { /* rien */ }
      dire("Le texte est sélectionné : copie-le (Ctrl + C ou appui long), puis colle-le dans Claude.");
    }
  }
  function recalculer(conteneur) {
    const cle = vue.cle, e = entreeDe(cle);
    if (!e) return;
    const f = conteneur.querySelector('[data-scn-form="' + cle + '"]');
    if (!f) return;
    const brut = {};
    f.querySelectorAll("[data-scn-q]").forEach(el => { brut[el.getAttribute("data-scn-q")] = el.hasAttribute("data-scn-modifie") ? el.value : el.getAttribute("data-scn-init") || ""; });
    let pre = {};
    try { pre = Sc().preremplir(e, donnees, aujourdhui); } catch (x) { pre = {}; }
    const lu = lireSaisie(e, brut, pre);
    formsOuverts.add(cle);
    if (lu.erreurs) {
      saisies[cle] = brut;
      erreurs[cle] = lu.erreurs;
      rendreDetail();
      const c = vue.vue === "detail" && dispo === "panneau" ? corpsPanneau : $("scnDetail");
      const premier = c && Object.keys(lu.erreurs).find(k => !k.startsWith("_"));
      const el = premier ? c.querySelector('[data-scn-q="' + premier + '"]') : c && c.querySelector("[data-scn-form-err]");
      if (el) { if (!el.hasAttribute("tabindex") && !el.getAttribute("data-scn-q")) el.setAttribute("tabindex", "-1"); el.focus(); }
      return;
    }
    delete erreurs[cle];
    delete saisies[cle];
    reponsesEnCours[cle] = lu.reponses;
    if (!Object.keys(lu.reponses).length) delete reponsesEnCours[cle];
    detailEtat = null;
    render();
    const c = dispo === "panneau" ? corpsPanneau : $("scnDetail");
    const t = c && c.querySelector('[data-scn-bloc="reponse"]');
    if (t) { t.setAttribute("tabindex", "-1"); t.focus(); }
  }
  function surClic(ev, conteneur) {
    const t = ev.target;
    if (!t || !t.closest) return;
    const carte = t.closest("[data-scn-cle]");
    if (carte && root.contains(carte)) { origine = { cle: carte.getAttribute("data-scn-cle"), zone: carte.getAttribute("data-scn-zone") }; return; }
    if (t.closest("[data-scn-recalculer]")) { recalculer(conteneur); return; }
    if (t.closest("[data-scn-reinit]")) { const cle = vue.cle; delete reponsesEnCours[cle]; delete erreurs[cle]; oublierSaisie = cle; detailEtat = null; render(); return; }
    if (t.closest("[data-scn-copier]")) { copier(conteneur); return; }
    const b = t.closest("[data-scn-chiffres]");
    if (b) {
      const cle = vue.cle, ouvrir = b.getAttribute("aria-expanded") !== "true";
      if (ouvrir) chiffresOuverts.add(cle); else chiffresOuverts.delete(cle);
      b.setAttribute("aria-expanded", String(ouvrir));
      b.textContent = ouvrir ? "Masquer les chiffres" : "Voir les chiffres";
      const z = conteneur.querySelector("#" + b.getAttribute("aria-controls"));
      if (z) z.hidden = !ouvrir;
      return;
    }
    const v = t.closest("[data-scn-vers-claude]");
    if (v) { ev.preventDefault(); const ta = conteneur.querySelector("[data-scn-texte]"); if (ta) { try { ta.scrollIntoView({ block: "center" }); } catch (e) { /* rien */ } ta.focus(); } }
  }
  function surSaisie(ev) {
    const el = ev.target;
    if (el && el.getAttribute && el.getAttribute("data-scn-q")) el.setAttribute("data-scn-modifie", "");
  }
  function surBascule(ev) {
    const d = ev.target;
    if (!d || !d.getAttribute) return;
    const th = d.getAttribute("data-scn-theme");
    if (th) themesOuverts.set(th, d.hasAttribute("open"));
  }

  function mount(r) {
    root = r;
    setTimeout(() => { bootFini = true; }, 0);
    root.addEventListener("click", ev => surClic(ev, $("scnDetail")));
    root.addEventListener("toggle", surBascule, true);
    ["input", "change"].forEach(t => root.addEventListener(t, surSaisie, true));
    const w = fenetre();
    if (w && typeof w.addEventListener === "function") {
      let tm = null;
      w.addEventListener("resize", () => {
        clearTimeout(tm);
        tm = setTimeout(() => {
          if (!root || !visible) return;
          const avant = dispo, apres = disposition(largeur());
          if (avant !== apres) { dernierDetail = ""; dernierListe = ""; render(); }
          else { const c = panneauCle ? corpsPanneau : $("scnDetail"); dessiner(c, detailEtat && detailEtat.resultat); }
        }, 150);
      });
    }
  }
  function update(snap, vis) {
    S = snap; visible = !!vis;
    if (visible) render();
  }
  function show() {
    const p = glob("App") && typeof App.parametres === "function" ? App.parametres() : {};
    const avant = { vue: vue.vue, cle: vue.cle }, v = vueDe(p);
    if (v.vue === "detail" && avant.vue !== "detail" && !origine) origine = { cle: v.cle, zone: "pourtoi" };
    vue.vue = v.vue; vue.cle = v.cle;
    visible = true;
    render();
    const change = avant.vue !== v.vue || avant.cle !== v.cle;
    if (!change || !bootFini) return;
    /* après la coque (qui pose le focus sur le titre de page quand la destination change) */
    setTimeout(() => {
      if (!root || vue.vue !== v.vue || vue.cle !== v.cle) return;
      if (v.vue === "detail" && dispo !== "panneau") { const h = $("scnDetail").querySelector("#scnDetailTitre") || $("scnDetail").querySelector('[data-scn-bloc="reponse"]'); if (h) { if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1"); h.focus(); } }
      else if (v.vue === "liste" && avant.vue === "detail") { if (!focaliserCarte(origine || { cle: avant.cle })) { const t = $("scnTitre"); if (t) t.focus(); } }
      else if (v.vue === "outil") { const a = root.querySelector("[data-scn-outil-retour]"); if (a) a.focus(); }
      else if (v.vue === "liste" && avant.vue === "outil") { const a = root.querySelector("[data-scn-outil-lien]"); if (a) a.focus(); }
    }, 0);
  }

  const api = { mount, update, show };
  const reg = () => App.register("scenarios-view", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
