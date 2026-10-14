/* Aujourd'hui : page d'accueil du cockpit (« le board lit, l'agent écrit »).
   - Bandeau de 4 indicateurs en cartes cliquables (cartes(), boutons data-ui-carte qui ouvrent UI.panneau : 2-4 lignes + lien vers la page) :
     1. Patrimoine net : gros chiffre (décompte à la première apparition), variation sur la période du graphe, mini-courbe ;
     2. Bonnes pratiques : jauge en anneau sur 100 (Pratiques.evaluer) et « N critères à compléter » ;
     3. Objectifs : jauge d'atteinte et rappel des 3 objectifs prioritaires (nom, barre, échéance, statut en toutes lettres) ;
     4. Prochaine échéance : compte à rebours en jours et libellé.
     L'écart au profil de risque a quitté le bandeau : il reste dans Pilotage › Risque et dans la boîte « À traiter » (élément « Allocation
     hors des fourchettes de ton profil », urgence 3, quand le profil est renseigné et qu'une classe est hors fourchette).
   - Calendrier patrimonial (DAT1, calendrier.js) : echeances() ajoute les jalons à venir du calendrier (source « calendrier ») aux jalons,
     objectifs datés et points à reprendre ; la carte « Prochaine échéance » prend la plus proche. Sous le bandeau, la carte « Prochaines
     échéances » (prochainesHtml : 5 jalons au plus, date, délai en mots, enveloppe, effet en une ligne, mot d'état) mène au panneau de chaque
     jalon (jalonDetail : effet, « Comment c'est calculé », donnée et source, règle et source datée) et au panneau des informations à compléter
     (aCompleterDetail, « Compléter avec Claude »). Jamais une date sans donnée : l'état vide dit ce qui manque. Un jalon à 30 jours ou moins
     entre dans la boîte (urgence 3, 2 à 7 jours) ; la revue mensuelle ajoute « N échéances dans les 3 prochains mois ». Lien profond :
     #aujourdhui?echeances=1 ouvre le panneau complet.
   - Jauge d'objectifs (indicateurs().objectifs) : moyenne des avancements pondérée par la priorité, sur les objectifs de
     ObjectifsView.analyser (moteur Plan : affecterDeja, repartirEpargne, statutObjectif) :
         jauge = Σ poids × min(avancement, 1) / Σ poids,  avancement = déjà de côté / cible,  poids = N − rang + 1
     (N objectifs ; le rang 1, le plus prioritaire, pèse N ; le dernier pèse 1). Sans objectif : pas de jauge (« — »). Le panneau de la carte
     détaille le calcul objectif par objectif. Statut en toutes lettres : atteint, en avance, dans les temps, en retard, hors de portée.
   - Graphe maître « Évolution et projection du patrimoine net » (juste après le bandeau) : passé observé (photos nocturnes, trait plein)
     et reconstitué (Historique.reconstituer, pointillés : cours × quantités, soldes bancaires, autres lignes constantes), puis cône de
     projection (Historique.projeter : trois scénarios du moteur Plan, versements compris, horizon 1 · 5 · 10 · 20 ans), « Aujourd'hui »
     en trait vertical, infobulle (date, valeur, nature), tableau des données (« Voir les données ») et panneau « Comment c'est calculé »
     (graphe-patrimoine.js). Le passé suit la période et la granularité de UI.periode (défaut 1 an, granularité automatique selon la période
     sauf si l'utilisateur la choisit : elle est alors mémorisée) ; l'horizon suit ses propres boutons. Les cours, transactions et opérations
     bancaires de la reconstitution sont lus à la demande (Store.cours, Store.transactions, Store.banque.operations) ; repères verticaux aux
     dates des décisions du journal (titre au survol, clic ou Entrée → UI.panneau avec la synthèse).
   - Boîte de réception unique (5 éléments puis « Voir plus ») : propositions de Claude en attente (par lot), entrées du journal à relire
     (CK2), revue mensuelle (routine de l'agent, RT1 : en retard, prête ou à activer), alertes des règles (rules.js), points « à suivre »
     échus de la mémoire de l'agent, échéances à 30 jours, cours manquants / photo nocturne en retard, banques connectées (BQ1 : connexion
     à refaire, urgence 1 pour SCARequired, wrongpass, webauthRequired, passwordExpired, 2 pour les autres états qui demandent une action,
     rien pour un incident passager ; « N comptes à rattacher », urgence 2 ; « Connexion X en double », urgence 2, vers « Déconnecter » ; règles de BanqueEtat, banque-etat.js),
     écart au profil de risque (urgence 3, vers Pilotage › Risque).
   - Argent qui dort (CP1 § 1) : Calc.argentQuiDort(S, auj) (calc.js) s'il existe → élément « Argent qui dort sur tes comptes courants »
     (urgence 3, vers Patrimoine › Comptes) ; fonction absente ou en échec : rien.
   - Doublons probables (revue CP1) : Calc.doublonsProbables(positions) → un élément urgent (1) par ligne saisie qui recopie le total
     de son enveloppe (patrimoine compté deux fois), vers la fiche de l'enveloppe.
   - Fiches de Patrimoine › Comptes (CP1 § 3) : la carte « Patrimoine net » mène à Comptes et chaque enveloppe de son détail ouvre sa
     fiche ; sous le graphe, « Voir le détail par compte ».
   Accessibilité et mouvement : cartes = vrais boutons (nom accessible complet, aria-label), jauges avec équivalent texte, statuts en mots
   (jamais la couleur seule) ; décompte des chiffres et remplissage des jauges seulement à la première apparition, jamais avec
   prefers-reduced-motion. Textes au tutoiement ; « Faire le point avec Claude » = revue du mois de l'agent (ClaudePrompts.phrase("revue")).
   Fonctions pures exportées pour les tests (module.exports) : boite, etatRevue, echeances, calendrierDe, prochainesHtml, jalonDetail, aCompleterDetail, indicateurs, objectifs, frise, evolution, reperesJournal,
   urlClaude, delai, lirePeriode, periodeAEnregistrer, phraseRevue, et les rendus HTML cartes, detail, repereDetail, boiteHtml (qui reçoivent
   UI en paramètre quand ils en ont besoin ; aucune ne touche au DOM).
   Dépendances injectées (deps) : { Rules, Calc, BilanCalc, Pratiques, Risque, Periodes, Plan, Historique, ObjectifsView, reconstitue? } ;
   window.* par défaut (reconstitue : résultat de Historique.reconstituer à fusionner dans le passé). boite accepte aussi
   deps.aujRevue : jour de Paris pour la revue mensuelle (RoutineEtat.aujParis() dans la vue), le reste de la boîte restant au jour local. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : glob(k));
  /* Phrases « … avec Claude » (ClaudePrompts) : global du navigateur, sinon le module voisin sous Node (tests). */
  const prompts = () => glob("ClaudePrompts") ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./claude-prompts.js") : null);
  /* État de la revue mensuelle (RoutineEtat, routine-etat.js) : seule copie de la règle côté app ; global du navigateur, sinon le module
     voisin sous Node (tests). */
  const RE = () => glob("RoutineEtat") ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./routine-etat.js") : null);
  /* Adresse d'une fiche de Patrimoine › Comptes (ComptesView.lien, comptes-view.js). */
  const comptesView = () => glob("ComptesView") ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./comptes-view.js") : null);
  const lienFiche = cible => { const CV = comptesView(); return CV && typeof CV.lien === "function" ? CV.lien(cible) : "patrimoine/comptes"; };
  /* Banques connectées (BanqueEtat, banque-etat.js) : absent → aucun élément bancaire. */
  const BE = () => glob("BanqueEtat") ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./banque-etat.js") : null);

  /* Historique (reconstitution, fusion, cône), graphe maître et objectifs : modules voisins, globaux du navigateur ou require sous Node. */
  const voisin = (k, f) => glob(k) || (typeof module === "object" && module.exports && typeof require === "function" ? require(f) : null);
  const HIST = d => dep(d, "Historique") || voisin("Historique", "./historique.js");
  const GRAPHE = () => voisin("GraphePatrimoine", "./graphe-patrimoine.js");
  const OBJV = d => dep(d, "ObjectifsView") || voisin("ObjectifsView", "./objectifs-view.js");

  /* ---------- dates (AAAA-MM-JJ, jours calendaires) ---------- */
  const pad = n => String(n).padStart(2, "0");
  /** Date locale AAAA-MM-JJ (aujourd'hui par défaut). */
  function jour(d) {
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const x = d == null ? new Date() : new Date(d);
    if (!isFinite(x)) return "";
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }
  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const utc = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  const jj = v => (v ? String(v).slice(0, 10) : "");
  const dateFr = s => (isoOk(s) ? new Date(s + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");
  /** Délai lisible jusqu'à une date à `jours` jours : « aujourd'hui », « demain », « dans N jours » (jusqu'à 60 jours),
      « dans N mois » (jusqu'à 24 mois), puis « dans N ans ». court : « dans N j » au lieu de « dans N jours ». */
  function delai(jours, court) {
    const d = Math.max(0, Math.round(+jours || 0));
    if (d === 0) return "aujourd'hui";
    if (d === 1) return "demain";
    if (d <= 60) return "dans " + d + (court ? " j" : " jours");
    const mois = Math.round(d / 30.4375);
    if (mois <= 24) return "dans " + mois + " mois";
    return "dans " + Math.round(d / 365.25) + " ans";
  }

  /* ---------- nombres et textes ---------- */
  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  const eur = v => (Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €";
  const eurS = v => (Math.round(v) > 0 ? "+" : Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €";
  const kEur = v => (Math.abs(v) >= 1e6 ? nf1.format(v / 1e6) + " M€" : Math.abs(v) >= 1e3 ? nf0.format(v / 1e3) + " k€" : nf0.format(v) + " €");
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  const liste = xs => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " et " + xs[xs.length - 1]);
  const maj = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const extrait = (t, n) => { const s = plat(t); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const counted = p => !!p && p.status !== "à recevoir" && p.status !== "clôturé";

  /* ---------- liens ---------- */
  /* Lien profond vers une entrée du journal : la coque retient le paramètre et Agent › Journal ouvre l'entrée (app.js, journal-view.js). */
  const lienEntree = id => "agent/journal?entree=" + encodeURIComponent(String(id));
  const R = { comptes: "patrimoine/comptes", propositions: "agent/propositions", journal: "agent/journal", connexion: "agent/connexion", placements: "patrimoine/placements", budget: "patrimoine/budget", objectifs: "patrimoine/objectifs", sante: "pilotage/sante", risque: "pilotage/risque", echeances: "aujourdhui?echeances=1" };
  /** Lien vers une nouvelle conversation Claude, question préremplie (même forme que UI.demanderAClaude). */
  function urlClaude(question) { return "https://claude.ai/new?q=" + encodeURIComponent(String(question ?? "")); }
  const httpsOk = u => /^https:\/\//.test(String(u || ""));

  /* =============================================================== boîte de réception =============================================================== */
  const CIBLES = { protection: "protection de la famille", position: "placements", bien: "biens immobiliers", credit: "crédits", budget: "budget",
    objectif: "objectifs", risque: "profil de risque", profil: "profil" };
  const URGENCE = { crit: 1, warn: 2, info: 3 };
  /* Contrôles intégrés déjà présents sous une autre forme, reconnus par leur `kind` (rules.js) : échéances de config.milestones
     (type « echeance ») et mise à jour nocturne (type « cours »). */
  const estJalon = a => !a.rule && a.kind === "jalon";
  const estNocturne = a => !a.rule && a.kind === "nocturne";
  function lienAlerte(a) {
    if (!a.rule && a.kind === "matelas") return { label: "Voir le budget", route: R.budget };
    return { label: "Voir les placements", route: R.placements }; // règles de l'utilisateur, écarts aux cibles, signaux de la nuit
  }

  /* Calendrier patrimonial (Calendrier, calendrier.js) : global du navigateur, sinon le module voisin sous Node. */
  const CAL = d => (d && Object.prototype.hasOwnProperty.call(d, "Calendrier") ? d.Calendrier : glob("Calendrier") || voisin("Calendrier", "./calendrier.js"));
  /** Sortie du moteur du calendrier pour l'état S au jour `today` (jalons, a_completer, seuils, regles_indisponibles, prochains,
      dans_3_mois), ou null si le moteur manque ou échoue. */
  function calendrierDe(S, today, deps) {
    const M = CAL(deps), t = jour(today);
    if (!M || typeof M.calendrier !== "function" || !S || !isoOk(t)) return null;
    try { return M.calendrier(typeof M.depuisEtat === "function" ? M.depuisEtat(S) : S, t); } catch (e) { return null; }
  }
  /** Échéances à venir (aujourd'hui compris), triées : jalons de config, objectifs datés, points « à suivre » de la mémoire, jalons du
      calendrier patrimonial (jalon = le jalon du moteur).
      → [{ source: jalon|objectif|a_suivre|calendrier, date, jours, titre, texte, cible?, jalon? }] */
  function echeances(S, today, deps) {
    const s = S || {}, t = jour(today), out = [];
    const add = (source, date, titre, texte, extra) => {
      if (!isoOk(date)) return;
      const d = joursEntre(t, date); if (d < 0) return;
      out.push(Object.assign({ source, date, jours: d, titre: plat(titre), texte: plat(texte) }, extra || {}));
    };
    const ms = s.config && Array.isArray(s.config.milestones) ? s.config.milestones : [];
    ms.forEach(m => { if (m && m.date) add("jalon", jj(m.date), m.title || "Échéance", m.text || ""); });
    (Array.isArray(s.objectifs) ? s.objectifs : []).forEach(o => {
      if (o && o.dateCible) add("objectif", jj(o.dateCible), "Objectif « " + plat(o.nom || "sans nom") + " »", "", { cible: +o.cible || 0 });
    });
    (Array.isArray(s.memoire) ? s.memoire : []).forEach(m => {
      if (m && m.categorie === "a_suivre" && m.echeance) add("a_suivre", jj(m.echeance), "À reprendre : " + extrait(m.contenu, 90), "");
    });
    const cal = calendrierDe(s, t, deps);
    if (cal) cal.jalons.filter(j => j.statut !== "passe").forEach(j => add("calendrier", j.date, j.titre, j.effet, { jalon: j }));
    return out.map((x, i) => ({ x, i })).sort((a, b) => a.x.jours - b.x.jours || a.i - b.i).map(o => o.x);
  }

  /* ---------- revue mensuelle (routine de l'agent, RT1 ; règle unique : RoutineEtat.etat) ---------- */
  /** État de la revue mensuelle à la date `today` (date de Paris) : RoutineEtat.etat(S.routines, today, { lues, dbOk }) →
      { code: inconnu|a_activer|pause|retard|prete|a_jour, routine, retard, questions, prochain, dernier }. « a_activer » seulement si
      la base est là (S.dbOk) et la table lue (S.routinesLues). */
  function etatRevue(S, today) {
    const s = S || {};
    return RE().etat(s.routines, jour(today), { lues: s.routinesLues === true, dbOk: s.dbOk === true });
  }
  /** « 2 échéances dans les 3 prochains mois » (calendrier patrimonial), ou "" s'il n'y en a pas. */
  function phraseEcheances3Mois(S, t, deps) {
    const cal = calendrierDe(S, t, deps), n = cal ? cal.dans_3_mois.length : 0;
    return n ? pluriel(n, "échéance") + " dans les 3 prochains mois" : "";
  }
  /** Élément de la boîte pour la revue mensuelle, ou null (en pause, à jour, état inconnu). */
  function elementRevue(S, t, deps) {
    const e = etatRevue(S, t), ech = e.code === "retard" || e.code === "prete" ? phraseEcheances3Mois(S, t, deps) : "";
    if (e.code === "retard") {
      const n = e.questions.length;
      return { type: "routine", urgence: 2, date: e.prochain,
        titre: e.retard > 0 ? "Revue mensuelle en retard de " + pluriel(e.retard, "jour") : "Revue mensuelle due aujourd'hui",
        contexte: "Prévue le " + dateFr(e.prochain) + " : Claude fait le point du mois et prépare les questions à te poser." +
          (n ? " " + pluriel(n, "question") + " du mois précédent " + (n > 1 ? "attendent" : "attend") + " encore ta réponse." : "") + (ech ? " " + ech + "." : ""),
        action: { label: "Lancer ma revue avec Claude", url: urlClaude(phraseRevue()) } };
    }
    if (e.code === "prete") {
      return { type: "routine", urgence: 1, date: e.dernier || t, titre: "Ta revue du mois est prête : " + pluriel(e.questions.length, "question"),
        contexte: plat(e.questions[0].question) + (ech ? " · " + ech + "." : ""), action: { label: "Répondre avec Claude", url: urlClaude(RE().phraseRoutine(e.questions)) } };
    }
    if (e.code === "a_activer") {
      return { type: "routine", urgence: 3, date: t, titre: "Active ta revue mensuelle",
        contexte: "Chaque mois, Claude fait le point sur ton patrimoine et prépare les questions à te poser. Elle s'active avec lui en une phrase.",
        action: { label: "Voir comment", route: R.connexion } };
    }
    return null;
  }

  /** Éléments bancaires de la boîte (type « banque », vers Agent › Connexion). */
  function elementsBanque(S, t) {
    const B = BE(), b = S && S.banque, out = [];
    if (!B || !b || !b.actif) return out;
    (Array.isArray(b.connexions) ? b.connexions : []).forEach(c => {
      const e = c ? B.etat(c.etat) : null;
      if (!e || !e.action) return;
      const etab = plat(c.etablissement) || "sans nom", d = jj(c.derniereSynchro);
      out.push({ type: "banque", urgence: e.urgence || 2, date: isoOk(d) ? d : t, titre: "Ta banque " + etab + " demande une reconnexion",
        contexte: e.libelle + "." + (isoOk(d) ? " Dernière synchronisation le " + dateFr(d) + " : soldes et dépenses ne sont plus à jour." : ""),
        action: { label: "Reconnecter", route: R.connexion } });
    });
    // Connexion en double (migration 0022) : tous ses comptes sont déjà dans l'autre connexion du même établissement.
    (typeof B.connexionsEnDouble === "function" ? B.connexionsEnDouble(b) : []).forEach(({ connexion, autre }) => {
      const etab = plat(connexion.etablissement) || "sans nom", etabAutre = plat(autre && autre.etablissement) || etab;
      out.push({ type: "banque", urgence: 2, date: t, titre: "Connexion " + etab + " en double",
        contexte: "Elle ne contient que des comptes déjà présents dans l'autre connexion " + etabAutre + " : déconnecte-la.",
        action: { label: "Déconnecter", route: R.connexion } });
    });
    const libres = B.comptesARattacher(b);
    if (libres.length) out.push({ type: "banque", urgence: 2, date: t, titre: pluriel(libres.length, "compte") + " à rattacher",
      contexte: extrait(libres.map(c => plat(c.nom) || "Compte").join(", "), 80) + " : relie " + (libres.length > 1 ? "ces comptes" : "ce compte") +
        " à tes lignes pour que les soldes se mettent à jour seuls.",
      action: { label: "Rattacher", route: R.connexion } });
    return out;
  }

  /** « Argent qui dort » (spec CP1 § 1) : soldes des comptes courants au-dessus de 1,5 mois de dépenses deux mois de suite, d'après
      Calc.argentQuiDort(S, auj) → { montant, mois, solde, seuil, depenses, source } | null. Fonction absente, en échec ou réponse
      inattendue : null. */
  function elementArgentQuiDort(S, t, deps) {
    const C = dep(deps, "Calc");
    if (!C || typeof C.argentQuiDort !== "function") return null;
    let r = null;
    try { r = C.argentQuiDort(S, t); } catch (e) { return null; }
    if (!r || typeof r !== "object" || !(+r.montant > 0)) return null;
    const mois = Number.isFinite(+r.mois) && +r.mois >= 2 ? +r.mois : 2;
    return { type: "argent", urgence: 3, date: t, titre: "Argent qui dort sur tes comptes courants",
      contexte: eur(+r.montant) + " au-delà de 1,5 mois de dépenses depuis " + mois + " mois" +
        (Number.isFinite(+r.solde) && Number.isFinite(+r.seuil) ? " (solde " + eur(+r.solde) + ", seuil " + eur(+r.seuil) + ")" : "") +
        " : cet argent ne te rapporte rien.",
      action: { label: "Voir mes comptes", route: R.comptes } };
  }

  /** Doublons probables (Calc.doublonsProbables) : une ligne saisie qui recopie le total de son enveloppe, patrimoine compté deux
      fois → un élément urgent par ligne, vers la fiche de l'enveloppe (où « Demander à Claude » propose la clôture). */
  function elementsDoublons(S, t, deps) {
    const C = dep(deps, "Calc");
    if (!C || typeof C.doublonsProbables !== "function") return [];
    let L = [];
    try { L = C.doublonsProbables(S.positions || []); } catch (e) { return []; }
    return (Array.isArray(L) ? L : []).map(x => ({ type: "doublon", urgence: 1, date: t, titre: "Ligne « " + extrait(x.nom || "sans nom", 60) + " » comptée deux fois ?",
      contexte: "Elle semble recopier le total de ton enveloppe " + plat(x.enveloppe) + " (" + eur(+x.valeur) + " pour " + eur(+x.sommeAutres) +
        " de lignes) : ton patrimoine est peut-être compté deux fois. Demande à Claude de la clôturer.",
      action: { label: "Voir l'enveloppe", route: lienFiche({ enveloppe: x.enveloppe, titulaire: x.titulaire }) } }));
  }

  /** Tout ce qui demande une action, trié par urgence (1 haute … 3) puis date (la plus ancienne d'abord).
      → [{ type: proposition|journal|routine|banque|doublon|argent|alerte|a_suivre|echeance|cours, urgence, date, titre, contexte, action: { label, route } | { label, url } }]
      Textes bruts : l'échappement se fait au rendu. deps = { Rules } (window.Rules par défaut). */
  function boite(S, today, deps) {
    if (!S || S.ready === false) return [];
    const t = jour(today), out = [];
    const Rules = dep(deps, "Rules");

    // 1. Propositions de Claude en attente, une entrée par lot.
    const lots = new Map();
    (Array.isArray(S.propositions) ? S.propositions : []).filter(p => p && p.statut === "en_attente").forEach(p => {
      const k = p.lot ? "lot:" + p.lot : "id:" + p.id;
      if (!lots.has(k)) lots.set(k, []);
      lots.get(k).push(p);
    });
    lots.forEach(ps => {
      const cibles = [...new Set(ps.map(p => CIBLES[p.cible] || plat(p.cible || "données")))];
      const date = ps.map(p => jj(p.creeLe)).filter(isoOk).sort().pop() || t;
      out.push({ type: "proposition", urgence: 1, date, titre: "Claude propose " + pluriel(ps.length, "changement"),
        contexte: maj(liste(cibles)) + " : rien n'est enregistré sans ton accord.",
        action: { label: "Examiner", route: R.propositions } });
    });

    // 1 bis. Entrées du journal à relire (écrites par l'agent, à confirmer ou corriger), un seul élément. Nombre exact :
    // S.journalARelire (comptage du store, au-delà des entrées lues) ; à défaut, les entrées lues. Une seule entrée : lien
    // profond qui l'ouvre directement (#agent/journal?entree=<id>).
    const aRelire = (Array.isArray(S.journal) ? S.journal : []).filter(e => e && e.statut === "a_relire");
    const nRelire = Number.isFinite(S.journalARelire) && S.journalARelire >= 0 ? S.journalARelire : aRelire.length;
    if (nRelire) {
      const titres = aRelire.slice(0, 2).map(e => "« " + extrait(e.titre, 60) + " »").join(", ") + (nRelire > 2 ? "…" : "");
      out.push({ type: "journal", urgence: 1, date: aRelire.map(e => jj(e.creeLe)).filter(isoOk).sort().pop() || t,
        titre: pluriel(nRelire, "entrée") + " du journal à relire",
        contexte: (titres ? titres + " : c" : "C") + "onfirme ou corrige ce que l'agent a noté.",
        action: { label: "Relire", route: nRelire === 1 && aRelire.length === 1 ? lienEntree(aRelire[0].id) : R.journal } });
    }

    // 1 ter. Revue mensuelle (routine de l'agent) : en retard (urgence 2, prioritaire sur « prête »), prête (urgence 1, questions du
    // mois en attente), à activer (urgence 3, aucune routine) ; rien si elle est en pause ou à jour.
    const rv = elementRevue(S, deps && deps.aujRevue ? jour(deps.aujRevue) : t, deps);
    if (rv) out.push(rv);

    // 1 quater. Banques connectées (BQ1) : connexion à refaire (seulement les états qui demandent une action de l'utilisateur) et
    // comptes à rattacher. Rien si l'interrupteur est éteint.
    out.push(...elementsBanque(S, t));

    // 1 quater bis. Doublons probables (ligne qui recopie le total de son enveloppe), urgence 1.
    out.push(...elementsDoublons(S, t, deps));

    // 1 quinquies. Argent qui dort sur les comptes courants (Calc.argentQuiDort, si elle existe), urgence 3.
    const dort = elementArgentQuiDort(S, t, deps);
    if (dort) out.push(dort);

    // 1 sexies. Écart au profil de risque (profil renseigné et une classe d'actifs hors fourchette), urgence 3.
    const risque = elementRisque(S, t, deps);
    if (risque) out.push(risque);

    // 2. Alertes des règles de l'utilisateur et des contrôles intégrés (même contexte que Recommandations › Actions).
    if (Rules) {
      const ctx = { positions: S.positions || [], config: S.config || {}, scope: S.scope || "foyer", people: S.people || [], today: t, status: S.status || null };
      let A = [];
      try { A = Rules.evaluate(ctx.config.rules || [], ctx).concat(Rules.builtins(ctx)); }
      catch (e) { if (typeof console !== "undefined") console.error("alertes", e); }
      A.filter(a => a && !estJalon(a) && !estNocturne(a)).forEach(a => out.push({ type: "alerte", urgence: URGENCE[a.level] || 3, date: t,
        titre: plat(a.title || "Alerte"), contexte: plat(a.text), action: lienAlerte(a) }));
    }

    // 3. Points « à suivre » échus de la mémoire de l'agent.
    (Array.isArray(S.memoire) ? S.memoire : []).forEach(m => {
      const e = m && m.categorie === "a_suivre" ? jj(m.echeance) : "";
      if (!isoOk(e) || e > t) return;
      const contenu = plat(m.contenu);
      out.push({ type: "a_suivre", urgence: 2, date: e, titre: "À reprendre : " + contenu,
        contexte: "Noté par " + plat(m.source || "l'agent") + ", prévu le " + dateFr(e) + ".",
        action: { label: "Reprendre avec Claude", url: urlClaude("Reprenons ce point noté dans ma mémoire Boussole : « " + contenu + " ». Où en est-on ?") } });
    });

    // 4. Échéances à 30 jours au plus (jalons de config, objectifs datés).
    echeances(S, t, deps).filter(e => e.source !== "a_suivre" && e.jours <= 30).forEach(e => out.push({ type: "echeance", urgence: e.jours <= 7 ? 2 : 3, date: e.date,
      titre: e.titre, contexte: "Le " + dateFr(e.date) + " (" + delai(e.jours) + ")." + (e.texte ? " " + e.texte : "") + (e.cible ? " Cible : " + eur(e.cible) + "." : ""),
      action: e.source === "calendrier" ? { label: "Voir l'échéance", route: R.echeances } : { label: "Voir les objectifs", route: R.objectifs } }));

    // 5. Cours manquants et photo nocturne en retard (fraîcheur de l'en-tête : positions cotées, S.status).
    const sans = (S.positions || []).filter(p => counted(p) && p.mode === "market" && p.price == null);
    const st = S.status || null, manquants = Math.max(sans.length, (st && +st.missingPrices) || 0);
    if (manquants > 0) out.push({ type: "cours", urgence: 3, date: t, titre: pluriel(manquants, "cours manquant"),
      contexte: (sans.length ? "Sans cours : " + extrait(sans.slice(0, 3).map(p => p.name).join(", ") + (sans.length > 3 ? "…" : ""), 80) + ". " : "") +
        "Leur valeur n'est pas à jour dans le patrimoine.",
      action: { label: "Voir les placements", route: R.placements } });
    const lr = st && jj(st.lastRun);
    if (isoOk(lr) && joursEntre(lr, t) > 2) out.push({ type: "cours", urgence: 3, date: lr, titre: "Mise à jour nocturne en retard",
      contexte: "Dernier passage le " + dateFr(lr) + " : les cours et la photo du patrimoine ne sont plus à jour.",
      action: { label: "Voir les placements", route: R.placements } });

    return out.map((x, i) => ({ x, i })).sort((a, b) => a.x.urgence - b.x.urgence || (a.x.date < b.x.date ? -1 : a.x.date > b.x.date ? 1 : a.i - b.i)).map(o => o.x);
  }

  /* =============================================================== indicateurs =============================================================== */
  const PERIODE_TXT = { "1m": "sur 1 mois", "3m": "sur 3 mois", "6m": "sur 6 mois", ytd: "depuis janvier", "1a": "sur 1 an", "3a": "sur 3 ans", tout: "depuis le début de l'historique" };
  const estPerso = p => !!p && /^perso/.test(String(p.id)) && isoOk(p.du) && isoOk(p.au);
  const periodeTxt = p => (estPerso(p) ? "du " + dateFr(p.du) + " au " + dateFr(p.au) : PERIODE_TXT[p && p.id] || PERIODE_TXT["1a"]);

  /** Repères de la frise : décisions du journal non abandonnées et datées, triées par date → [{ id, date, titre, synthese, statut }]. */
  function reperesJournal(journal) {
    return (Array.isArray(journal) ? journal : [])
      .filter(e => e && e.type === "decision" && e.statut !== "abandonne" && isoOk(jj(e.dateDecision)))
      .map(e => ({ id: String(e.id), date: jj(e.dateDecision), titre: plat(e.titre), synthese: plat(e.synthese), statut: e.statut }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /** Série du passé : patrimoine net estimé (photos + point du jour, BilanCalc.evolution) fusionné avec le passé reconstitué quand
      deps.reconstitue (résultat de Historique.reconstituer) en fournit un, puis agrégé sur la période, et repères des décisions du journal.
      L'observé gagne toujours ; le reconstitué n'existe qu'avant la première photo et rejoint celle-ci (Historique.fusionner).
      periode = { id: 1m|3m|1a|tout|perso…, du?, au?, granularite? } →
      { points (Periodes.agreger, chacun avec sa nature observe|reconstitue), resume, bornes, granularite, historique, reperes,
        reconstitue (vrai si la période dessinée contient du reconstitué), decalage, horsFin (net − financier d'aujourd'hui), premiere (1re date de la série) } */
  function frise(S, today, periode, deps) {
    const BC = dep(deps, "BilanCalc"), Pe = dep(deps, "Periodes"), t = jour(today), s = S || {}, p = periode || {};
    const vide = { points: [], resume: { debut: null, fin: null, variation: null, variationPct: null }, bornes: null, granularite: p.granularite || "mois", historique: false,
      reperes: reperesJournal(s.journal), reconstitue: false, decalage: 0, horsFin: 0, premiere: null };
    if (!BC || !Pe) return vide;
    let pts = [];
    try { pts = BC.evolution(s.snapshots || [], s.positions || [], s.profil || null, s.scope || "foyer", t); } catch (e) { return vide; }
    if (!pts.length) return vide;
    const live = pts[pts.length - 1], horsFin = live && isFinite(live.net) && isFinite(live.financier) ? live.net - live.financier : 0;
    let serie = pts.map(x => ({ date: x.date, net: x.net, live: !!x.live, nature: "observe" })), decalage = 0;
    const rec = dep(deps, "reconstitue"), Hi = rec && Array.isArray(rec.points) && rec.points.length ? HIST(deps) : null;
    if (Hi) {
      const fus = Hi.fusionner(serie, rec.points);
      serie = fus.points; decalage = fus.decalage;
    }
    const id = estPerso(p) ? { du: p.du, au: p.au } : PERIODE_TXT[p.id] ? p.id : "1a";
    const b = Pe.bornes(id, t, serie[0].date);
    const g = !p.granularite || p.granularite === "auto" || !Pe.GRANULARITES.some(x => x.id === p.granularite) ? Pe.auto(b) : p.granularite;
    const nature = new Map(serie.map(x => [x.date, x.nature]));
    const ag = Pe.agreger(serie, b, g, x => x.net).map(x => Object.assign(x, { nature: nature.get(x.date) || "observe" }));
    return { points: ag, resume: Pe.resume(ag, serie, b, x => x.net), bornes: b, granularite: g, historique: serie.some(x => !x.live), reperes: vide.reperes,
      reconstitue: ag.some(x => x.nature === "reconstitue"), decalage, horsFin, premiere: serie[0].date };
  }

  /** Écart d'allocation au profil de risque (actifs financiers, comme Pilotage › Risque et la bonne pratique « adéquation ») →
      { profil, points, hors: [{ label, reel, min, max, statut, ecartPts }], placements }. points null sans profil ou sans placement. */
  function ecartAllocation(s, deps) {
    const scope = s.scope || "foyer", positions = s.positions || [], C = dep(deps, "Calc"), Ri = dep(deps, "Risque");
    const idp = s.risque && s.risque.profil ? (typeof s.risque.profil === "object" ? s.risque.profil.id : String(s.risque.profil)) : null;
    const fiche = idp && Ri && Array.isArray(Ri.PROFILS) ? Ri.PROFILS.find(p => p.id === idp) : null;
    const allocation = { profil: fiche ? fiche.label : null, points: null, hors: [], placements: C ? C.financier(positions, scope) > 0 : positions.some(counted) };
    if (fiche && allocation.placements) {
      try {
        const ec = Ri.ecarts(fiche.id, Ri.allocationReelle(positions, scope, { surcharge: s.classes || {} }));
        allocation.points = ec.reduce((a, e) => a + Math.abs(+e.ecartPts || 0), 0);
        allocation.hors = ec.filter(e => e.statut !== "dans").map(e => ({ label: e.label, reel: e.reel, min: e.min, max: e.max, statut: e.statut, ecartPts: e.ecartPts }));
      } catch (e) { allocation.points = null; }
    }
    return allocation;
  }

  /** Élément de la boîte « À traiter » pour l'écart au profil de risque : seulement si le profil est renseigné et qu'une classe est hors fourchette
      (urgence 3, vers Pilotage › Risque). */
  function elementRisque(S, t, deps) {
    const al = ecartAllocation(S || {}, deps);
    if (!al.profil || !al.placements || !(al.points > 0) || !al.hors.length) return null;
    return { type: "risque", urgence: 3, date: t, titre: "Allocation hors des fourchettes de ton profil " + al.profil,
      contexte: pluriel(al.hors.length, "classe") + " d'actifs " + (al.hors.length > 1 ? "sortent" : "sort") + " de la fourchette (" + fpts(al.points) + " d'écart au total) : " +
        extrait(al.hors.slice(0, 2).map(e => e.label + " " + nf0.format(e.reel) + " % pour " + e.min + " à " + e.max + " %").join(" ; "), 110) + ".",
      action: { label: "Voir le profil de risque", route: R.risque } };
  }

  /* ---------- objectifs : jauge d'atteinte et rappel des 3 premiers ---------- */
  /* statut du moteur Plan → ton (classes ui-badge) et mots ; « en retard » regroupe retard et hors de portée. */
  const OBJ_TON = { atteint: "bon", avance: "bon", dans_les_temps: "info", retard: "attention", hors_portee: "critique" };
  const OBJ_MOT = { atteint: "atteint", avance: "en avance", dans_les_temps: "dans les temps", retard: "en retard", hors_portee: "hors de portée" };
  const enRetard = st => st === "retard" || st === "hors_portee";
  /** Objectifs de l'utilisateur pour la carte « Objectifs » : { n, jauge (0 à 1 | null), pct (0 à 100 | null), ton, retard (nombre en retard), liste,
      top (3 premiers par priorité), vide }. liste[i] = { id, nom, rang, poids, progression (0 à 1), deja, cible, dateCible, statut, mot, ton, enRetard }.
      jauge = Σ poids × min(avancement, 1) / Σ poids, poids = N − rang + 1 (voir l'en-tête). Moteur : ObjectifsView.analyser (Plan). */
  function objectifs(S, today, deps) {
    const s = S || {}, t = jour(today), OV = OBJV(deps), P = dep(deps, "Plan"), C = dep(deps, "Calc");
    const sortie = { n: 0, jauge: null, pct: null, ton: "neutre", retard: 0, liste: [], top: [], vide: true, somme: 0, poidsTotal: 0 };
    if (!OV || !P || !Array.isArray(s.objectifs) || !s.objectifs.length) return sortie;
    let a;
    try { a = OV.analyser(s, { Plan: P, Calc: C }, t); } catch (e) { return sortie; }
    const n = a.liste.length;
    if (!n) return sortie;
    const liste = a.liste.map((x, i) => {
      const prog = Math.max(0, Math.min(1, +x.st.progression || 0)), statut = x.st.statut, poids = n - (i + 1) + 1;
      return { id: String(x.o.id), nom: plat(x.o.nom) || "Objectif sans nom", rang: i + 1, poids, progression: prog, deja: x.st.deja, cible: +x.o.cible || 0,
        dateCible: jj(x.o.dateCible || x.o.date_cible) || null, statut, mot: OBJ_MOT[statut] || statut, ton: OBJ_TON[statut] || "neutre", enRetard: enRetard(statut) };
    });
    const poidsTotal = liste.reduce((q, x) => q + x.poids, 0), somme = liste.reduce((q, x) => q + x.poids * x.progression, 0), retard = liste.filter(x => x.enRetard).length;
    const jauge = poidsTotal > 0 ? somme / poidsTotal : null;
    return { n, jauge, pct: jauge == null ? null : Math.round(jauge * 100), ton: liste.some(x => x.statut === "hors_portee") ? "critique" : retard ? "attention" : "bon",
      retard, liste, top: liste.slice(0, 3), vide: false, somme, poidsTotal };
  }

  /** Les 4 indicateurs du bandeau (périmètre S.scope), en valeurs brutes ; le texte est composé par cartes() et detail().
      L'écart au profil de risque (allocation) n'est plus affiché dans le bandeau : il alimente la boîte « À traiter » (elementRisque). */
  function indicateurs(S, today, periode, deps) {
    const s = S || {}, t = jour(today), scope = s.scope || "foyer", positions = s.positions || [];
    const C = dep(deps, "Calc"), Pr = dep(deps, "Pratiques"), BC = dep(deps, "BilanCalc");
    // Patrimoine net (et variation sur la période du graphe) ; composition « Ce que je possède, ce que je dois » (BilanCalc.composition,
    // mêmes calculs que l'ancienne carte du Bilan) pour le panneau de la carte.
    const pat = C ? C.patrimoine(positions, s.profil || null, scope) : { financier: 0, immobilier: 0, usage: 0, entreprise: 0, dettes: 0, net: 0 };
    const f = frise(s, t, periode, deps);
    let composition = null;
    if (BC && typeof BC.composition === "function") { try { composition = BC.composition(positions, s.profil || null, scope); } catch (e) { composition = null; } }
    const courbe = f.points.map(x => x.valeur);
    const net = { valeur: pat.net, financier: pat.financier, immobilier: pat.immobilier, autres: pat.usage + pat.entreprise, usage: pat.usage, entreprise: pat.entreprise,
      dettes: pat.dettes, composition,
      vide: !positions.some(counted) && !pat.immobilier && !pat.dettes && !pat.usage && !pat.entreprise,
      variation: f.historique ? f.resume.variation : null, variationPct: f.historique ? f.resume.variationPct : null,
      reconstitue: f.reconstitue && f.points.length > 0 && f.points[0].nature === "reconstitue", courbe: courbe.length > 60 ? courbe.filter((_, i) => i % Math.ceil(courbe.length / 60) === 0 || i === courbe.length - 1) : courbe };
    // Bonnes pratiques
    let r = null;
    if (Pr && typeof Pr.evaluer === "function") {
      try { r = Pr.evaluer({ positions, profil: s.profil || null, config: s.config || null, budget: s.budget || null, objectifs: s.objectifs || [], scope,
        risque: s.risque || null, classes: s.classes || {}, banque: s.banque || null, today: new Date(t + "T12:00:00") }); } catch (e) { r = null; }
    }
    const crit = r && Array.isArray(r.criteres) ? r.criteres : [];
    const pratiques = { total: r && r.total != null ? r.total : null, provisoire: !!(r && r.provisoire),
      familles: r && Array.isArray(r.familles) ? r.familles.map(x => ({ titre: x.titre, total: x.total })) : [],
      aCompleter: crit.filter(c => c && c.aCompleter).length };
    // Prochaine échéance
    const ech = echeances(s, t, deps), cal = calendrierDe(s, t, deps);
    // Calendrier patrimonial : jalons à venir (5 au plus pour la carte), tous les jalons pour le panneau, données à compléter
    const venir = cal ? cal.jalons.filter(j => j.statut !== "passe") : [];
    const calendrier = { disponible: !!cal, prochains: venir.slice(0, 5), nPlus: Math.max(0, venir.length - 5), aCompleter: cal ? cal.a_completer : [], jalons: cal ? cal.jalons : [],
      seuils: cal ? cal.seuils : [], indisponibles: cal ? cal.regles_indisponibles : [] };
    return { net, pratiques, objectifs: objectifs(s, t, deps), allocation: ecartAllocation(s, deps), echeance: { prochaine: ech[0] || null, liste: ech.slice(0, 4) }, calendrier, frise: f };
  }

  /** Cône de projection du net (Historique.projeter : moteur Plan, trois scénarios) sur `annees` ans, avec le versement mensuel de la page
      Objectifs (ObjectifsView.versementReel : épargne prévue au budget, sinon versements programmés). f = frise() (horsFin : immobilier, autres
      biens et dettes d'aujourd'hui, maintenus). → { points, versement, annees, parBloc, rendements, versementSource } | null sans moteur. */
  function projection(S, today, annees, f, deps) {
    const Hi = HIST(deps), P = dep(deps, "Plan"), OV = OBJV(deps), s = S || {}, scope = s.scope || "foyer";
    if (!Hi || !P) return null;
    let reel = null;
    try {
      const lignes = s.budget && Array.isArray(s.budget.lignes) ? s.budget.lignes : [];
      reel = OV && typeof OV.versementReel === "function" ? OV.versementReel(s, P.budgetTotaux(lignes, s.profil || null, scope), scope) : null;
    } catch (e) { reel = null; }
    const r = Hi.projeter({ today: jour(today), positions: s.positions || [], scope, versementMensuel: reel ? reel.v : 0, annees, horsFin: f ? f.horsFin : 0, Plan: P });
    return Object.assign(r, { versementSource: reel ? reel.src : null });
  }

  /** Modèle du graphe maître : le passé (frise) et le futur (projection) quand la période va jusqu'à aujourd'hui. */
  function evolution(S, today, periode, annees, deps) {
    const t = jour(today), passe = frise(S, t, periode, deps);
    const futur = passe.bornes && passe.bornes.au >= t && passe.points.length ? projection(S, t, annees, passe, deps) : null;
    return { passe, futur: futur && futur.points.length ? futur : null, today: t };
  }

  /** Date (AAAA-MM-JJ) de la première photo de S.snapshots, pour la période « Tout » ; undefined sans photo. */
  function premiereDate(snapshots) {
    let p;
    (Array.isArray(snapshots) ? snapshots : []).forEach(x => { const d = x && jj(x.date); if (isoOk(d) && (!p || d < p)) p = d; });
    return p;
  }

  /* =============================================================== rendus HTML =============================================================== */
  const fpts = v => nf1.format(Math.abs(v)) + (Math.abs(v) >= 2 ? " pts" : " pt");
  const quand = e => maj(delai(e.jours, true));

  /* ---------- cartes du bandeau : boutons data-ui-carte (UI.brancher ouvre le panneau), figures en grand, jauges, mini-courbe ---------- */
  const CHEVRON_DROITE = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';
  const TON_BADGE = { bon: "bon", info: "info", attention: "attention", critique: "critique", neutre: "neutre" };
  const badge = (texte, ton) => '<span class="ui-badge ' + (TON_BADGE[ton] || "neutre") + '">' + esc(texte) + "</span>";
  const R_ANNEAU = 34, CIRC = 2 * Math.PI * R_ANNEAU;
  /** Jauge en anneau (décorative : le texte équivalent est dans la carte). pct 0 à 100 ou null (anneau vide) ; centre : valeur écrite au milieu. */
  function anneau(pct, ton, centre, sous) {
    const p = pct == null ? 0 : Math.max(0, Math.min(100, +pct)), off = CIRC * (1 - p / 100);
    return '<svg class="aj-ring t-' + (TON_BADGE[ton] || "neutre") + '" viewBox="0 0 80 80" aria-hidden="true" focusable="false">' +
      '<circle class="aj-ring-fond" cx="40" cy="40" r="' + R_ANNEAU + '"/>' +
      '<circle class="aj-ring-arc" cx="40" cy="40" r="' + R_ANNEAU + '" transform="rotate(-90 40 40)" stroke-dasharray="' + CIRC.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" data-aj-off="' + off.toFixed(2) + '"/>' +
      '<text class="aj-ring-v" x="40" y="' + (sous ? 41 : 46) + '" text-anchor="middle"' + (pct != null ? ' data-aj-count="' + Math.round(+pct) + '" data-aj-fmt="int"' : "") + ">" + esc(centre) + "</text>" +
      (sous ? '<text class="aj-ring-s" x="40" y="54" text-anchor="middle">' + esc(sous) + "</text>" : "") + "</svg>";
  }
  /** Mini-courbe du patrimoine net sur la période (décorative). */
  function spark(vals) {
    const v = (vals || []).filter(x => isFinite(x));
    if (v.length < 2) return "";
    const W = 120, H = 36, lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    const pts = v.map((x, i) => [(i / (v.length - 1)) * W, 4 + (1 - (x - lo) / span) * (H - 8)]);
    const d = pts.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + "," + q[1].toFixed(1)).join("");
    return '<svg class="aj-spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="aj-spark-aire" d="' + d + "L" + W + "," + H + "L0," + H + 'Z"/><path class="aj-spark-l" d="' + d + '"/></svg>';
  }
  const tendanceHtml = (sens, texte) => {
    const lu = { hausse: "En hausse", baisse: "En baisse", stable: "Stable" }[sens], fl = { hausse: "▲", baisse: "▼", stable: "–" }[sens], ton = { hausse: "pos", baisse: "neg", stable: "neutre" }[sens];
    return '<span class="ui-tendance ' + ton + '"><span class="ui-tendance-fleche" aria-hidden="true">' + fl + '</span><span class="ui-sr">' + lu + " : </span>" + esc(texte) + "</span>";
  };
  /** Compte à rebours lisible : { mot } (« Aujourd'hui », « Demain ») ou { n, unite } (jours jusqu'à 60, puis mois jusqu'à 24, puis ans). */
  function compteARebours(jours) {
    const d = Math.max(0, Math.round(+jours || 0));
    if (d === 0) return { mot: "Aujourd'hui" };
    if (d === 1) return { mot: "Demain" };
    if (d <= 60) return { n: d, unite: "jours" };
    const mois = Math.round(d / 30.4375);
    return mois <= 24 ? { n: mois, unite: "mois" } : { n: Math.round(d / 365.25), unite: "ans" };
  }
  const enToutesLettres = c => (c.mot ? c.mot.toLowerCase() : "dans " + c.n + " " + c.unite);
  const carteBtn = (id, cls, aria, corps) => '<button type="button" class="aj-k ' + cls + '" data-ui-carte="' + id + '" aria-haspopup="dialog" aria-label="' + esc(aria) + '">' + corps +
    '<span class="aj-k-ouvrir">' + CHEVRON_DROITE + "</span></button>";
  const teteHtml = (titre, b) => '<span class="aj-k-tete"><span class="aj-k-titre">' + esc(titre) + "</span>" + (b || "") + "</span>";

  /** Les 4 cartes du bandeau (patrimoine net, bonnes pratiques, objectifs, prochaine échéance). Chaque champ est échappé. */
  function cartes(ind, U, periode) {
    const n = ind.net, pr = ind.pratiques, ob = ind.objectifs || objectifs({}, TODAY_VIDE, null), ec = ind.echeance, v = n.variation;
    // 1. Patrimoine net
    const sens = v == null || n.vide ? null : Math.round(v) > 0 ? "hausse" : Math.round(v) < 0 ? "baisse" : "stable";
    const sous1 = n.vide ? "Lance ton bilan avec Claude" : v == null ? "Première photo cette nuit" : periodeTxt(periode) + (n.reconstitue ? " · début reconstitué" : "");
    const c1 = carteBtn("net", "aj-k-net", "Patrimoine net : " + (n.vide ? "pas encore de données" : eur(n.valeur) + (sens ? ", " + { hausse: "en hausse de ", baisse: "en baisse de ", stable: "stable, " }[sens] + (sens === "stable" ? "" : eur(Math.abs(v))) + " " + periodeTxt(periode) : "")),
      teteHtml("Patrimoine net") + '<span class="aj-k-val' + (!n.vide && eur(n.valeur).length > 10 ? " aj-k-long" : "") + '"' + (n.vide ? "" : ' data-aj-count="' + Math.round(n.valeur) + '" data-aj-fmt="eur"') + ">" + (n.vide ? "—" : esc(eur(n.valeur))) + "</span>" +
      '<span class="aj-k-pied">' + (sens ? tendanceHtml(sens, eurS(v) + (n.variationPct != null ? " (" + (n.variationPct < 0 ? "−" : "+") + nf1.format(Math.abs(n.variationPct)) + " %)" : "")) : "") + '<span class="aj-k-sous">' + esc(sous1) + "</span></span>" +
      (n.vide ? "" : spark(n.courbe)));
    // 2. Bonnes pratiques
    const tot = pr.total, tonP = tot == null ? "neutre" : tot >= 80 ? "bon" : tot >= 60 ? "info" : "attention", motP = tot == null ? "À compléter" : tot >= 80 ? "Solide" : tot >= 60 ? "Correct" : "À consolider";
    const sous2 = tot == null ? "Données à compléter" : pr.aCompleter ? pluriel(pr.aCompleter, "critère") + " à compléter" : "Tous les critères sont notés";
    const c2 = carteBtn("pratiques", "aj-k-pra t-" + tonP, "Bonnes pratiques : " + (tot == null ? "pas encore de note, données à compléter" : tot + " sur 100, " + motP.toLowerCase() + (pr.provisoire ? ", note provisoire" : "") + ", " + sous2.toLowerCase()),
      teteHtml("Bonnes pratiques", tot != null && pr.provisoire ? badge("Provisoire", "neutre") : "") +
      '<span class="aj-k-jauge">' + anneau(tot, tonP, tot == null ? "—" : String(Math.round(tot)), tot == null ? "" : "/ 100") +
      '<span class="aj-k-jauge-t">' + (tot == null ? "" : badge(motP, tonP)) + '<span class="aj-k-sous">' + esc(sous2) + "</span></span></span>" +
      (tot != null && pr.familles.length > 1 ? '<ul class="aj-suite aj-fam">' + pr.familles.slice(0, 4).map(f => "<li><span>" + esc(extrait(f.titre, 30)) + "</span><span>" + (f.total == null ? "à compléter" : esc(Math.round(f.total) + " / 100")) + "</span></li>").join("") + "</ul>" : ""));
    // 3. Objectifs
    const motO = ob.vide ? "" : ob.retard ? ob.retard + " en retard" : ob.liste.every(x => x.statut === "atteint") ? "Tous atteints" : "Tous dans les temps";
    const ligneO = x => '<li class="aj-ob t-' + x.ton + '"><span class="aj-ob-nom">' + esc(extrait(x.nom, 34)) + "</span>" + badge(x.mot, x.ton) +
      '<span class="aj-ob-barre" aria-hidden="true"><i style="width:' + (x.progression * 100).toFixed(1) + '%"></i></span>' +
      '<span class="aj-ob-pied">' + esc(Math.round(x.progression * 100) + " %") + (x.dateCible ? " · " + esc(dateCourte(x.dateCible)) : "") + "</span></li>";
    const c3 = carteBtn("objectifs", "aj-k-obj t-" + ob.ton, "Objectifs : " + (ob.vide ? "aucun objectif défini" : ob.pct + " % d'avancement pondéré, " + (ob.retard ? pluriel(ob.retard, "objectif") + " en retard" : motO.toLowerCase()) + ". " +
      ob.top.map(x => x.nom + " " + Math.round(x.progression * 100) + " %, " + x.mot).join(" ; ")),
      teteHtml("Objectifs") + '<span class="aj-k-jauge">' + anneau(ob.pct, ob.vide ? "neutre" : ob.ton, ob.vide ? "—" : ob.pct + " %") +
      '<span class="aj-k-jauge-t">' + (ob.vide ? "" : badge(motO, ob.retard ? ob.ton : "bon")) + '<span class="aj-k-sous">' + esc(ob.vide ? "Fixe ton premier objectif avec Claude" : "d'avancement, selon la priorité") + "</span></span></span>" +
      (ob.vide ? "" : '<ul class="aj-obs">' + ob.top.map(ligneO).join("") + "</ul>"));
    // 4. Prochaine échéance
    const e = ec.prochaine, cr = e ? compteARebours(e.jours) : null, tonE = !e ? "neutre" : e.jours <= 7 ? "attention" : e.jours <= 30 ? "info" : "neutre", motE = !e ? "" : e.jours <= 7 ? "Imminente" : e.jours <= 30 ? "Proche" : "À venir";
    const suite = (ec.liste || []).slice(1, 3);
    const c4 = carteBtn("echeance", "aj-k-ech t-" + tonE, "Prochaine échéance : " + (e ? enToutesLettres(cr) + ", " + extrait(e.titre, 70) + ", le " + dateFr(e.date) + ", " + motE.toLowerCase() : "aucune date à venir"),
      teteHtml("Prochaine échéance", e ? badge(motE, tonE) : "") +
      '<span class="aj-k-val">' + (!e ? "Aucune" : cr.mot ? esc(cr.mot) : '<span data-aj-count="' + cr.n + '" data-aj-fmt="int">' + cr.n + '</span><span class="aj-k-unit"> ' + cr.unite + "</span>") + "</span>" +
      '<span class="aj-k-pied"><span class="aj-k-sous">' + esc(e ? extrait(e.titre, 60) + " · " + dateFr(e.date) : "Aucune date à venir") + "</span></span>" +
      (suite.length ? '<ul class="aj-suite">' + suite.map(x => "<li><span>" + esc(extrait(x.titre.replace(/^Objectif « (.*) »$/, "$1"), 28)) + "</span><span>" + esc(quand(x)) + "</span></li>").join("") + "</ul>" : ""));
    return c1 + c2 + c3 + c4;
  }
  const TODAY_VIDE = "2000-01-01";
  const dateCourte = s => (isoOk(s) ? new Date(s + "T12:00:00").toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "");

  const ligne = (label, valeur) => '<li><span class="aj-det-l">' + esc(label) + '</span><span class="aj-det-v">' + esc(valeur) + "</span></li>";
  /** Ligne d'une enveloppe : son nom ouvre sa fiche de Patrimoine › Comptes (le panneau se ferme, la coque suit le lien). */
  const ligneFiche = (enveloppe, valeur) => {
    const r = lienFiche({ enveloppe });
    return '<li><a class="aj-det-l aj-det-fiche" href="#' + esc(r) + '" data-goto="' + esc(r) + '">' + esc(enveloppe) + '</a><span class="aj-det-v">' + esc(valeur) + "</span></li>";
  };
  const CHEVRON_BAS = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';
  /** Accordéon fermé (même balisage que UI.accordeon) ; contenu déjà échappé. */
  const accordeon = (titre, contenu) => '<details class="ui-acc"><summary class="ui-acc-titre"><span>' + esc(titre) + '</span><span class="ui-acc-chevron">' + CHEVRON_BAS +
    '</span></summary><div class="ui-acc-corps">' + contenu + "</div></details>";
  /** « Ce que je possède, ce que je dois » (panneau de la carte Patrimoine net) : financier, immobilier, biens d'usage, parts d'entreprise,
      dettes, net ; puis le détail ligne par ligne de BilanCalc.composition (enveloppes, biens, autres biens, dettes) en accordéon fermé. */
  function compositionHtml(n) {
    const lignes = [["Placements financiers", eur(n.financier)], ["Immobilier", eur(n.immobilier)]];
    if (n.usage > 0) lignes.push(["Biens d'usage (voiture, meubles…)", eur(n.usage)]);
    if (n.entreprise > 0) lignes.push(["Parts d'entreprise", eur(n.entreprise)]);
    lignes.push(["Dettes", eur(-n.dettes)], ["Patrimoine net", eur(n.valeur)]);
    const c = n.composition;
    const groupe = (label, ls, fiche) => '<p class="aj-det-note">' + esc(label) + '</p><ul class="aj-det">' + ls.map(l => fiche ? ligneFiche(l.label, eur(l.montant)) : ligne(l.label, eur(l.montant))).join("") + "</ul>";
    const det = c ? c.actifs.filter(b => b.lignes.length).map(b => groupe(b.label + " · " + eur(b.total), b.lignes, b.cle === "financier")).join("") +
      (c.dettes.lignes.length ? groupe("Dettes · " + eur(-c.dettes.total), c.dettes.lignes.map(l => ({ label: l.label, montant: -l.montant }))) : "") : "";
    return '<p class="aj-det-note">Ce que je possède, ce que je dois</p><ul class="aj-det">' + lignes.map(l => ligne(l[0], l[1])).join("") + "</ul>" +
      (det ? accordeon("Le détail, ligne par ligne", det) : "");
  }
  /** Panneau d'une carte : { titre, contenu (HTML échappé : 2 à 4 lignes et une note), lien: { label, href } vers la page complète,
      question } — question préremplie pour « Demander à Claude » (pédagogique : expliquer, pas conseiller). */
  function detail(id, ind, periode) {
    const n = ind.net, pr = ind.pratiques, ec = ind.echeance;
    let titre, lignes = [], note = "", route, label, question;
    if (id === "net") {
      titre = "Patrimoine net"; route = R.comptes; label = "Voir mes comptes";
      question = "Explique-moi la composition de mon patrimoine net dans Boussole et ce qui l'a fait varier récemment.";
      note = n.variation == null ? "La variation apparaîtra après la première photo nocturne du patrimoine."
        : "Variation " + periodeTxt(periode) + " : " + eurS(n.variation) + ". Estimation : placements de chaque photo, immobilier, autres biens et dettes d'aujourd'hui.";
    } else if (id === "pratiques") {
      titre = "Bonnes pratiques"; route = R.sante; label = "Voir le détail des critères";
      question = "Explique-moi ma note de bonnes pratiques dans Boussole, famille par famille, et ce que mesure chaque critère.";
      lignes = pr.familles.slice(0, 4).map(f => [f.titre, f.total == null ? "à compléter" : f.total + " / 100"]);
      if (lignes.length < 2) lignes = [["Note globale", pr.total == null ? "—" : pr.total + " / 100"], ["Critères à compléter", String(pr.aCompleter)]];
      note = pr.total == null ? "Complète tes données avec Claude pour obtenir une note."
        : pr.provisoire ? "Note provisoire : moins de la moitié des critères peuvent être notés avec tes données actuelles."
        : "Une note pédagogique, pas un conseil : chaque critère explique sa règle et sa source.";
    } else if (id === "objectifs") {
      const ob = ind.objectifs || objectifs({}, TODAY_VIDE, null);
      titre = "Objectifs"; route = R.objectifs; label = "Voir les objectifs";
      question = "Vais-je atteindre mes objectifs dans Boussole ? Passe-les en revue avec moi et dis-moi quoi ajuster.";
      if (ob.vide) {
        lignes = [["Objectifs", "aucun pour l'instant"], ["Jauge d'atteinte", "—"]];
        note = "Un objectif daté (matelas, apport, retraite, projet) dit combien mettre de côté chaque mois. Claude t'aide à les définir ; tu valides ses propositions.";
      } else {
        lignes = [["Jauge d'atteinte", ob.pct + " %"]].concat(ob.liste.slice(0, 3).map(x => [extrait(x.nom, 40), Math.round(x.progression * 100) + " % · " + x.mot]));
        note = ob.retard ? pluriel(ob.retard, "objectif") + " en retard ou hors de portée : le détail est dans Objectifs." : "Tous tes objectifs sont atteints ou dans les temps.";
        const dec = v => nf1.format(Math.round(v * 100) / 100);
        const calcul = '<p class="aj-det-note">Jauge = Σ (poids × avancement) ÷ Σ poids. L\'avancement est la somme déjà de côté divisée par la cible, plafonné à 100 %. Le poids est le nombre d\'objectifs moins le rang de priorité plus 1 : l\'objectif prioritaire compte le plus.</p>' +
          '<ul class="aj-det">' + ob.liste.map(x => ligne(extrait(x.nom, 36) + " (rang " + x.rang + ")", "poids " + x.poids + " × " + Math.round(x.progression * 100) + " % = " + dec(x.poids * x.progression))).join("") +
          ligne("Jauge", "(" + ob.liste.map(x => dec(x.poids * x.progression)).join(" + ") + ") ÷ " + ob.poidsTotal + " = " + ob.pct + " %") + "</ul>";
        return { titre, contenu: '<ul class="aj-det">' + lignes.map(l => ligne(l[0], l[1])).join("") + '</ul><p class="aj-det-note">' + esc(note) + "</p>" + accordeon("Calcul", calcul),
          lien: { label, href: "#" + route }, question };
      }
    } else {
      titre = "Prochaines échéances"; route = R.objectifs; label = "Voir les objectifs";
      const jal = ec.prochaine && ec.prochaine.jalon;
      if (jal && jal.enveloppe && !/^(foyer|donation:|credit:|bien:)/.test(jal.enveloppe)) { route = lienFiche({ enveloppe: plat(jal.enveloppe_nom) || plat(jal.enveloppe), titulaire: jal.titulaire }); label = "Voir l'enveloppe"; }
      question = "Passons en revue mes prochaines échéances (calendrier patrimonial, objectifs datés) dans Boussole.";
      lignes = ec.liste.slice(0, 4).map(e => [extrait(e.titre, 70), dateFr(e.date) + " · " + quand(e).toLowerCase()]);
      if (!lignes.length) lignes.push(["Échéances à venir", "aucune"]);
      if (lignes.length < 2) lignes.push(["Objectifs datés", "dans Objectifs"]);
      note = "Dates tirées du calendrier de tes enveloppes, de tes objectifs, des échéances enregistrées et des points que l'agent doit reprendre avec toi.";
    }
    return { titre, contenu: (id === "net" ? compositionHtml(n) : '<ul class="aj-det">' + lignes.slice(0, 4).map(l => ligne(l[0], l[1])).join("") + "</ul>") +
      '<p class="aj-det-note">' + esc(note) + "</p>", lien: { label, href: "#" + route }, question };
  }


  /* ---------- carte « Prochaines échéances » et panneaux du calendrier patrimonial (DAT1) ---------- */
  const dateLongue = s => (isoOk(s) ? new Date(s + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");
  const dateNum = s => (isoOk(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "");
  const MOT_ETAT = { passe: "passé", proche: "bientôt", futur: "à venir" };
  const TON_ETAT = { passe: "neutre", proche: "attention", futur: "info" };
  /** Mot de confiance d'un jalon (« date exacte », « au plus tard », « dès », « au plus tôt », « calculée »). */
  function motConfiance(j) {
    if (j.confiance === "sure") return "date exacte";
    if (j.confiance === "calculee") return "date calculée";
    return j.cle === "av_70_ans" || j.cle === "per_70_ans" ? "dès cette date" : j.cle === "pee_disponible" ? "au plus tôt" : "au plus tard";
  }
  /** Phrase d'un jalon sans l'enveloppe : « 5 ans révolus · dans 4 mois ». */
  const courtDe = j => plat(j.titre).replace(/^[^:]*:\s*/, "");
  const nomEnv = j => plat(j.enveloppe_nom) || (j.enveloppe === "foyer" ? "Foyer" : plat(j.enveloppe));
  /** Phrase de la donnée à compléter pour « Compléter avec Claude » : « la date d'ouverture de mon PEA Exemple ». */
  function contexteACompleter(a) {
    const nom = plat(a.enveloppe_nom) || plat(a.enveloppe);
    if (a.champ === "date_ouverture") return "la date d'ouverture de mon " + nom;
    if (a.champ === "naissance") return plat(a.titre).replace(/^Date/, "la date");
    if (a.champ === "versements") return "les versements de mon " + nom;
    if (a.champ === "avis_impot") return "mon avis d'impôt (plafond épargne retraite)";
    if (a.champ === "date_fin") return "la date de fin de mon prêt « " + nom + " »";
    return plat(a.titre);
  }
  const phraseACompleter = a => prompts().phrase("calendrier", contexteACompleter(a));
  /** Pied de la carte : « Aucune échéance connue pour l'instant. Il manque la date d'ouverture de 2 enveloppes. » */
  function ilManque(liste) {
    const n = champ => liste.filter(a => a.champ === champ).length, parts = [];
    if (n("date_ouverture")) parts.push("la date d'ouverture de " + pluriel(n("date_ouverture"), "enveloppe"));
    if (n("naissance")) parts.push(n("naissance") > 1 ? "des dates de naissance" : "une date de naissance");
    if (n("versements")) parts.push("les versements de " + pluriel(n("versements"), "plan d'épargne salariale", "plans d'épargne salariale"));
    if (n("avis_impot")) parts.push("ton avis d'impôt");
    if (n("date_fin")) parts.push("la date de fin de " + pluriel(n("date_fin"), "prêt"));
    return parts.length ? "Il manque " + liste_(parts) + "." : "";
  }
  const liste_ = liste;
  /** Carte « Prochaines échéances » : liste ordonnée (<ol>) de 5 jalons au plus, boutons ouvrant le panneau du jalon ; pied « N informations à
      compléter » ; état vide honnête. cal = indicateurs().calendrier. Chaque champ est échappé. */
  function prochainesHtml(cal, U) {
    const c = cal || { disponible: false, prochains: [], nPlus: 0, aCompleter: [], indisponibles: [] };
    if (!c.disponible) return '<p class="aj-vide-x">Le calendrier n\'est pas disponible pour l\'instant.</p>';
    const ligne = j => {
      const approx = j.confiance === "approchee", date = (approx ? motConfiance(j) + " le " : "") + dateNum(j.date);
      return '<li class="aj-ech-it"><button type="button" class="aj-ech-l t-' + TON_ETAT[j.statut] + '" data-ech="' + esc(j.id) + '" aria-haspopup="dialog">' +
        '<span class="aj-ech-date"><time datetime="' + esc(j.date) + '">' + esc(dateLongue(j.date)) + '</time><span class="aj-ech-delai">' + esc(j.delai) + "</span></span>" +
        '<span class="aj-ech-txt"><span class="aj-ech-nom">' + esc(nomEnv(j)) + " · " + esc(courtDe(j)) + '</span><span class="aj-ech-eff">' + esc(j.effet) + "</span></span>" +
        '<span class="aj-ech-etat">' + badge(MOT_ETAT[j.statut], TON_ETAT[j.statut]) + (approx ? badge("approchée", "neutre") : "") + "</span>" +
        '<span class="ui-sr">' + esc("Date " + date + ", " + motConfiance(j) + ". Ouvre le détail.") + "</span></button></li>";
    };
    const n = c.aCompleter.length;
    const pied = n ? '<p class="aj-ech-pied"><button type="button" class="aj-ech-completer" data-ech-completer aria-haspopup="dialog">' + esc(pluriel(n, "information") + " à compléter") + "</button>" +
      '<span class="aj-ech-pied-t"> pour dater plus de délais.</span></p>' : "";
    const dispo = c.indisponibles && c.indisponibles.length ? '<p class="aj-ech-note">' + esc(pluriel(c.indisponibles.length, "règle") + " indisponible" + (c.indisponibles.length > 1 ? "s" : "") + " : un repère chiffré manque, aucune valeur n'est inventée.") + "</p>" : "";
    if (!c.prochains.length) {
      const manque = ilManque(c.aCompleter);
      return '<div class="aj-vide"><p class="aj-vide-t">Aucune échéance connue pour l\'instant.</p>' +
        '<p class="aj-vide-x">' + esc(manque || "Aucune date n'est enregistrée : Claude les relève dans tes documents (relevés, contrats, avis d'impôt).") + "</p>" +
        U.demanderAClaude(prompts().phrase("calendrier"), "Compléter avec Claude") + "</div>" + dispo;
    }
    return '<ol class="aj-ech-liste" aria-label="Prochaines échéances, par date">' + c.prochains.map(ligne).join("") + "</ol>" +
      (c.nPlus ? '<p class="aj-ech-note">' + esc("Et " + pluriel(c.nPlus, "autre") + " plus tard.") + "</p>" : "") + pied + dispo;
  }
  /** Panneau d'un jalon : l'effet d'abord, puis « Comment c'est calculé » (calcul, donnée et sa source, règle et sa source datée, confiance),
      la mention fixe. → { titre, contenu, lien?, question } ; contenu échappé. */
  function jalonDetail(j) {
    const d = j.donnee, src = j.source || {};
    const lignes = [];
    if (j.calcul) lignes.push(ligne("Calcul", j.calcul));
    lignes.push(ligne("Date", dateLongue(j.date) + " (" + motConfiance(j) + ")"));
    if (d) lignes.push(ligne("Donnée", [d.source, d.le ? "relevée le " + dateNum(d.le) : ""].filter(Boolean).join(", ") || d.champ));
    const url = httpsOk(src.url) ? '<a href="' + esc(src.url) + '" target="_blank" rel="noopener noreferrer">' + esc(src.titre || src.url) + '<span class="ui-sr"> (nouvel onglet)</span></a>' : esc(src.titre || "");
    const regle = src.titre || src.url ? '<li><span class="aj-det-l">Règle</span><span class="aj-det-v">' + url + (src.verifie_le ? "<br>vérifiée le " + esc(dateNum(src.verifie_le)) : "") + "</span></li>" : "";
    const avert = liste_a(j.avertissements);
    const calcul = '<ul class="aj-det aj-det-pile">' + lignes.join("") + regle + "</ul>" + avert;
    const environ = j.enveloppe && !/^(foyer|donation:|credit:|bien:)/.test(j.enveloppe);
    return { titre: plat(j.titre), contenu: '<p class="aj-det-effet">' + esc(j.effet) + "</p>" + accordeon("Comment c'est calculé", calcul) +
      '<p class="aj-det-note">Information générale sur la règle, pas une recommandation. Vérifie auprès de ton établissement avant une opération proche de la date.</p>',
      lien: environ ? { label: "Voir l'enveloppe", href: "#" + lienFiche({ enveloppe: plat(j.enveloppe_nom) || plat(j.enveloppe).replace(/\|p[12]$/, ""), titulaire: j.titulaire }) } : undefined,
      question: "Explique-moi cette échéance de mon calendrier patrimonial dans Boussole : « " + plat(j.titre) + " » le " + dateNum(j.date) + ". Consulte l'expertise fiscalite-enveloppes, décris l'effet et ce qu'il faut vérifier auprès de mon établissement." };
  }
  const liste_a = av => (Array.isArray(av) && av.length ? '<ul class="aj-liste">' + av.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "");
  /** Panneau des informations à compléter : chaque donnée, pourquoi, où la trouver, et « Compléter avec Claude ». */
  function aCompleterDetail(liste, U) {
    const l = Array.isArray(liste) ? liste : [];
    const items = l.map(a => '<li class="aj-cmp"><p class="aj-cmp-t">' + esc(a.titre) + '</p><p class="aj-cmp-p">' + esc(a.pourquoi) + "</p>" +
      (a.document ? '<p class="aj-cmp-d">Où la trouver : ' + esc(a.document) + ".</p>" : "") + U.demanderAClaude(phraseACompleter(a), "Compléter avec Claude") + "</li>").join("");
    return { titre: pluriel(l.length, "information") + " à compléter",
      contenu: '<p class="aj-det-note">Boussole ne date rien sans donnée : chaque information ci-dessous fait courir un délai. Claude la lit dans ton document, sinon te la demande une seule fois.</p>' +
        '<ul class="aj-cmps">' + items + "</ul>" };
  }

  /** Panneau du calendrier complet (lien profond #aujourdhui?echeances=1) : jalons à venir par date, jalons déjà passés repliés, données à compléter. */
  function calendrierDetail(cal, U) {
    const c = cal || { prochains: [], jalons: [], aCompleter: [] };
    const venir = c.jalons.filter(j => j.statut !== "passe"), passes = c.jalons.filter(j => j.statut === "passe");
    const li = j => '<li><span class="aj-det-l"><time datetime="' + esc(j.date) + '">' + esc(dateLongue(j.date)) + "</time> · " + esc(nomEnv(j)) + " · " + esc(courtDe(j)) + (j.confiance === "approchee" ? " (" + esc(motConfiance(j)) + ")" : "") +
      '</span><span class="aj-det-v">' + esc(j.delai) + " · " + esc(MOT_ETAT[j.statut]) + "</span></li>";
    const n = c.aCompleter.length;
    return { titre: "Calendrier patrimonial",
      contenu: (venir.length ? '<ol class="aj-det aj-det-ol aj-det-pile">' + venir.map(li).join("") + "</ol>" : '<p class="aj-det-note">Aucune échéance à venir pour l\'instant.</p>') +
        (passes.length ? accordeon("Déjà passées (" + passes.length + ")", '<ol class="aj-det aj-det-ol aj-det-pile">' + passes.map(li).join("") + "</ol>") : "") +
        (n ? '<p class="aj-sec-t">' + esc(pluriel(n, "information") + " à compléter") + '</p><ul class="aj-cmps">' + c.aCompleter.map(a => '<li class="aj-cmp"><p class="aj-cmp-t">' + esc(a.titre) + "</p>" +
          (a.document ? '<p class="aj-cmp-d">Où la trouver : ' + esc(a.document) + ".</p>" : "") + U.demanderAClaude(phraseACompleter(a), "Compléter avec Claude") + "</li>").join("") + "</ul>" : "") +
        '<p class="aj-det-note">Information générale sur les règles, pas une recommandation. Chaque date vient d\'un document que tu as donné, jamais d\'une estimation.</p>' };
  }

  const STATUT_TXT = { a_relire: "À relire", actif: "En cours", realise: "Réalisée", abandonne: "Abandonnée", archive: "Archivée" };
  /** Panneau d'un repère de la frise (r = élément de reperesJournal) : { titre, contenu (HTML échappé), lien vers Agent › Journal }. */
  function repereDetail(r) {
    const x = r || {};
    return { titre: plat(x.titre) || "Décision",
      contenu: '<ul class="aj-det">' + ligne("Décision du", dateFr(x.date) || "—") + ligne("Statut", STATUT_TXT[x.statut] || plat(x.statut) || "—") + "</ul>" +
        '<p class="aj-det-note">' + esc(x.synthese) + "</p>",
      lien: { label: "Ouvrir dans le journal", href: "#" + (x.id != null && x.id !== "" ? lienEntree(x.id) : R.journal) } };
  }

  const ICO = {
    journal: '<path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z"/><path d="M6 3.5v17M9.5 8h5.5M9.5 11.5h5.5"/>',
    proposition: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/>',
    alerte: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    doublon: '<rect x="3.5" y="3.5" width="11" height="11" rx="1.5"/><rect x="9.5" y="9.5" width="11" height="11" rx="1.5"/>',
    a_suivre: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/><path d="M12 8v4.5l3 1.8"/>',
    echeance: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    cours: '<path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/>',
    routine: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/><path d="M8.5 12.2l2.4 2.4 4.6-4.6"/>',
    banque: '<path d="M3.5 9.5L12 4l8.5 5.5"/><path d="M5 20h14M6 10.5v7M10 10.5v7M14 10.5v7M18 10.5v7"/>',
    risque: '<path d="M12 3.5v17M5 8l7-4.5L19 8"/><path d="M5 8l-2.5 6a3 3 0 0 0 5 0zM19 8l-2.5 6a3 3 0 0 0 5 0z"/>',
    argent: '<path d="M4 7.5h16v11H4z"/><path d="M4 11h16"/><path d="M8 4.5h8"/><path d="M15.5 15h1.5"/>',
  };
  const TYPE_TXT = { proposition: "Proposition de Claude", journal: "Journal de l'agent", routine: "Revue mensuelle", banque: "Banque connectée", argent: "Argent qui dort", risque: "Profil de risque", doublon: "Doublon probable", alerte: "Alerte", a_suivre: "Point à reprendre", echeance: "Échéance", cours: "Mise à jour des cours" };
  const URG_TXT = { 1: "urgent", 2: "à traiter", 3: "à surveiller" };
  const ico = t => '<svg class="aj-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICO[t] + "</svg>";

  function actionHtml(a) {
    if (!a || !a.label) return "";
    if (a.url) return httpsOk(a.url) ? '<a class="aj-act" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">' + esc(a.label) + '<span class="ui-sr"> (nouvel onglet)</span></a>' : "";
    return a.route ? '<a class="aj-act" href="#' + esc(a.route) + '" data-goto="' + esc(a.route) + '">' + esc(a.label) + "</a>" : "";
  }
  function itemHtml(x) {
    const t = TYPE_TXT[x.type] ? x.type : "alerte", u = URG_TXT[x.urgence] ? +x.urgence : 3;
    return '<li class="aj-it u' + u + '" data-type="' + t + '">' +
      '<span class="aj-pic">' + ico(t) + "</span>" +
      '<div class="aj-txt"><p class="aj-t"><span class="ui-sr">' + esc(TYPE_TXT[t] + ", " + URG_TXT[u] + " : ") + "</span>" + esc(x.titre) + "</p>" +
      (x.contexte ? '<p class="aj-c">' + esc(x.contexte) + "</p>" : "") + "</div>" +
      actionHtml(x.action) + "</li>";
  }
  /** Phrase prête de « Faire le point avec Claude » : la revue du mois de l'agent (ClaudePrompts.phrase("revue"), via RoutineEtat). */
  function phraseRevue() { return RE().phraseRevue(); }
  /** Liste de la boîte de réception (<ul>/<li>) : 5 éléments puis « Voir plus » (UI.voirPlus, clé fixe : un bloc déplié le reste
      quand la liste change) ; vide : « Rien à traiter. » et « Faire le point avec Claude » (revue du mois). */
  function boiteHtml(items, U) {
    if (!items || !items.length) return '<div class="aj-vide"><p class="aj-vide-t">Rien à traiter.</p>' +
      '<p class="aj-vide-x">Aucune proposition, alerte ni échéance proche. Pour un regard d\'ensemble, fais le point avec Claude.</p>' +
      U.demanderAClaude(phraseRevue(), "Faire le point avec Claude") + "</div>";
    return U.voirPlus(items, 5, itemHtml, "Voir plus", "ul", "aj-boite");
  }

  /* ---------- période de la frise : mémorisée, granularité seulement si l'utilisateur l'a choisie ---------- */
  /** Période relue du stockage local (JSON ou objet) → { periode: { id, du?, au?, granularite? }, gChoisie }. La granularité n'est
      reprise que si l'utilisateur l'avait choisie lui-même (gChoisie) ; sinon elle reste automatique (Periodes.auto selon la
      période). Les anciennes valeurs sans gChoisie (granularité « mois » enregistrée d'office) repassent donc en automatique. */
  function lirePeriode(brut) {
    let p = brut;
    if (typeof brut === "string") { try { p = JSON.parse(brut); } catch (e) { p = null; } }
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !p.id) return { periode: { id: "1a" }, gChoisie: false };
    const gChoisie = p.gChoisie === true && typeof p.granularite === "string" && !!p.granularite;
    const periode = { id: p.id };
    if (isoOk(p.du)) periode.du = p.du;
    if (isoOk(p.au)) periode.au = p.au;
    if (gChoisie) periode.granularite = p.granularite;
    return { periode, gChoisie };
  }
  /** Ce qui s'enregistre : la période (et ses dates si elle est personnalisée) ; la granularité et gChoisie seulement après un choix
      de l'utilisateur. */
  function periodeAEnregistrer(periode, gChoisie) {
    const p = periode || {}, out = { id: String(p.id || "1a") };
    if (/^perso/.test(out.id) && isoOk(p.du) && isoOk(p.au)) { out.du = p.du; out.au = p.au; }
    if (gChoisie && p.granularite) { out.granularite = String(p.granularite); out.gChoisie = true; }
    return out;
  }

  const H = { boite, elementArgentQuiDort, etatRevue, echeances, calendrierDe, prochainesHtml, jalonDetail, aCompleterDetail, calendrierDetail, contexteACompleter, indicateurs, frise, reperesJournal, urlClaude, cartes, detail, repereDetail, boiteHtml, phraseRevue, objectifs, evolution, projection, compteARebours, jour, delai, premiereDate,
    lirePeriode, periodeAEnregistrer };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =============================================================== vue =============================================================== */
  const CLE = "aujourdhui-periode", CLE_H = "aujourdhui-horizon", HORIZONS = [1, 5, 10, 20];
  /* items (boîte) est calculé à chaque émission du store : headline() en dépend pour la pastille. ind (indicateurs et passé du graphe)
     ne l'est qu'au rendu, quand la vue est visible. sigX : dernier HTML écrit ; rien n'est réécrit (ni le focus perdu,
     ni un « Voir plus » replié) quand il n'a pas changé. */
  let S = null, root = null, dirty = true, items = [], ind = null, largeur = 0, ctlPeriode = null; // largeur : celle du dernier dessin du graphe
  const sig = { boite: "", ech: "", cartes: "", graphe: "", legende: "", table: "", etat: "", resume: "" };
  /* periode.granularite : celle du dessin (choisie, ou automatique selon la période) ; gChoisie : l'utilisateur l'a choisie lui-même
     (seul cas où elle est passée à UI.periode et enregistrée) ; gClic : vrai pendant le traitement d'un clic ou d'une touche sur la
     bascule de granularité (posé à la capture, effacé au retour de l'événement). */
  let periode = { id: "1a" }, gChoisie = false, gClic = false, horizon = 5, animer = true, modele = null, geo = null;
  try { const l = lirePeriode(localStorage.getItem(CLE)); periode = l.periode; gChoisie = l.gChoisie; } catch (e) {}
  try { const h = +localStorage.getItem(CLE_H); if (HORIZONS.includes(h)) horizon = h; } catch (e) {}
  /* Passé reconstitué : données lues à la demande (cours, transactions, opérations bancaires), puis calcul mémorisé. */
  const hist = { cle: "", depuis: null, isins: "", comptes: "", cours: {}, tx: null, ops: [], opsDepuis: null, version: 0, etat: "rien", seq: 0, enCours: "", memo: null };
  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const scopeLabel = () => {
    if (!S || !S.scope || S.scope === "foyer") return "du foyer";
    const p = (S.people || []).find(x => x.id === S.scope), C = window.Calc;
    return C && C.deNom ? C.deNom(p && p.nom, S.scope === "p2" ? 2 : 1) : "";
  };
  const reduit = () => { try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } };

  /** Passé reconstitué pour l'état courant du store (mémorisé tant que le store, le périmètre, le jour et les données lues ne changent pas). */
  function reconstitution() {
    const Hi = HIST(null), C = window.Calc;
    if (!Hi || !C || !S || hist.etat === "rien" || hist.etat === "charge" && !hist.version) return null;
    const t = jour(), cle = [t, S.scope, hist.version].join("|");
    if (hist.memo && hist.memo.S === S && hist.memo.cle === cle) return hist.memo.res;
    let res = null;
    try {
      const pat = C.patrimoine(S.positions || [], S.profil || null, S.scope || "foyer");
      res = Hi.reconstituer({ today: t, positions: S.positions || [], scope: S.scope || "foyer", cours: hist.cours, tx: hist.tx || S.tx || [],
        comptes: S.banque && S.banque.comptes ? S.banque.comptes : [], operations: hist.ops, operationsDepuis: hist.opsDepuis, depuis: hist.depuis, horsFin: pat.net - pat.financier });
    } catch (e) { res = null; }
    hist.memo = { S, cle, res };
    return res;
  }
  const depsVue = () => ({ reconstitue: reconstitution() });

  /* Début de la période voulue pour le graphe, moins quelques jours (variation sur la période) : jusqu'où lire l'historique. */
  function depuisVoulu() {
    const Hi = HIST(null), Pe = window.Periodes, t = jour();
    if (!Hi) return t;
    if (periode.id === "tout") return Hi.plusJours(t, -Hi.JOURS_MAX);
    const b = Pe ? Pe.bornes(estPerso(periode) ? { du: periode.du, au: periode.au } : PERIODE_TXT[periode.id] ? periode.id : "1a", t) : { du: Hi.plusJours(t, -365) };
    const d = Hi.plusJours(b.du, -10), plancher = Hi.plusJours(t, -Hi.JOURS_MAX);
    return d < plancher ? plancher : d;
  }
  /* Lit les cours, les transactions et les opérations bancaires nécessaires à la reconstitution (une seule lecture à la fois ; refaite si la
     période remonte plus loin, ou si les lignes cotées ou les comptes rattachés changent). Une lecture en échec laisse le reste : le
     passé est alors reconstitué avec ce qui est lu, et le dit. */
  async function chargerHistorique() {
    const st = window.Store, Hi = HIST(null);
    if (!S || !S.ready || S.dbOk === false || !st || !Hi) return;
    const t = jour(), depuis = depuisVoulu();
    const isins = [...new Set((S.positions || []).filter(p => counted(p) && p.mode === "market" && p.isin).map(p => String(p.isin)))].sort().join(",");
    const comptes = (S.banque && S.banque.actif && !S.banque.mfaRequise && Array.isArray(S.banque.comptes) ? S.banque.comptes : [])
      .filter(c => c && c.positionId != null && !c.ignore && c.type !== "credit").map(c => c.id).sort().join(",");
    if (hist.etat !== "rien" && hist.depuis <= depuis && hist.isins === isins && hist.comptes === comptes) return;
    const cle = depuis + "|" + isins + "|" + comptes;
    if (hist.enCours === cle) return;
    hist.enCours = cle; const seq = ++hist.seq; hist.etat = hist.version ? hist.etat : "charge";
    if (!hist.version) majEtat();
    const tolerant = f => Promise.resolve().then(f).catch(() => null);
    const [cours, tx, ops] = await Promise.all([
      isins && typeof st.cours === "function" ? tolerant(() => st.cours(isins.split(","), depuis)) : {},
      typeof st.transactions === "function" ? tolerant(() => st.transactions(depuis)) : null,
      comptes && st.banque && typeof st.banque.operations === "function" ? tolerant(() => st.banque.operations(comptes.split(",").map(x => (/^\d+$/.test(x) ? +x : x)), Hi.plusJours(t, -90))) : [],
    ]);
    if (seq !== hist.seq) return;
    Object.assign(hist, { cle, depuis, isins, comptes, cours: cours || {}, tx: Array.isArray(tx) ? tx : null, ops: Array.isArray(ops) ? ops : [], opsDepuis: Hi.plusJours(t, -90),
      version: hist.version + 1, etat: cours === null ? "echec" : "pret", enCours: "", memo: null });
    if (root && S) { ctlPremiere(); if (!root.hidden) { ind = indicateurs(S, jour(), periode, depsVue()); renderCartes(); renderGraphe(); } else dirty = true; }
  }
  /* « Tout » part de la première donnée : première photo, ou début du passé reconstitué s'il est plus ancien. */
  function premiereGlobale() {
    const p = S ? premiereDate(S.snapshots) : undefined, r = hist.memo && hist.memo.res && hist.memo.res.points && hist.memo.res.points.length ? hist.memo.res.debut : null;
    return r && (!p || r < p) ? r : p;
  }
  function ctlPremiere() { if (ctlPeriode && typeof ctlPeriode.premiere === "function") ctlPeriode.premiere(premiereGlobale()); }

  function render() {
    const u = U();
    if (!root || !S || !u) return;
    ind = indicateurs(S, jour(), periode, depsVue());
    renderCartes();
    renderEcheances(u);
    // Même contenu : on ne réécrit pas la liste (une émission du store ne replie pas un « Voir plus » déplié).
    const sg = JSON.stringify(items);
    if (sg !== sig.boite) { sig.boite = sg; $("ajBoite").innerHTML = boiteHtml(items, u); }
    // Nombre d'éléments pour les lecteurs d'écran seulement (règle 9 : les compteurs visibles sont dans la navigation).
    const n = items.length ? pluriel(items.length, "élément") + " à traiter" : "";
    if ($("ajBoiteN").textContent !== n) $("ajBoiteN").textContent = n;
    renderGraphe();
    chargerHistorique();
    lienProfond();
  }
  /* Carte « Prochaines échéances » : réécrite seulement si son HTML change (le focus d'un bouton n'est pas perdu à chaque émission du store). */
  function renderEcheances(u) {
    const h = prochainesHtml(ind && ind.calendrier, u), el = $("ajEch");
    if (!el || h === sig.ech) return;
    sig.ech = h; el.innerHTML = h;
    const n = ind && ind.calendrier ? ind.calendrier.prochains.length : 0, sr = $("ajEchN");
    if (sr) sr.textContent = n ? pluriel(n, "échéance") + " à venir" : "";
  }
  function renderCartes() {
    const h = cartes(ind, U(), periode);
    if (h === sig.cartes) return;
    sig.cartes = h; $("ajCartes").innerHTML = h;
    if (animer && S && S.ready) { animer = false; animerCartes(); }
  }
  /* Première apparition des cartes : chiffres comptés de 0 à leur valeur, jauges remplies. Jamais avec prefers-reduced-motion. */
  function animerCartes() {
    const zone = $("ajCartes");
    if (reduit() || typeof requestAnimationFrame !== "function" || !zone.querySelectorAll) return;
    const arcs = Array.from(zone.querySelectorAll("[data-aj-off]"));
    arcs.forEach(a => { if (a.style) a.style.strokeDashoffset = String(CIRC); });
    if (arcs.length && arcs[0].getBoundingClientRect) arcs[0].getBoundingClientRect(); // fixe l'état de départ avant la transition
    requestAnimationFrame(() => arcs.forEach(a => { if (a.style) a.style.strokeDashoffset = a.getAttribute("data-aj-off"); }));
    const nums = Array.from(zone.querySelectorAll("[data-aj-count]")).map(el => ({ el, cible: +el.getAttribute("data-aj-count"), fmt: el.getAttribute("data-aj-fmt"), final: el.textContent }));
    if (!nums.length) return;
    const duree = 850, t0 = (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
    const ecrire = (o, v) => { o.el.textContent = o.fmt === "eur" ? eur(v) : String(Math.round(v)); };
    nums.forEach(o => ecrire(o, 0));
    const pas = now => {
      const k = Math.min(1, ((now || Date.now()) - t0) / duree), e = 1 - Math.pow(1 - k, 3);
      nums.forEach(o => { if (k < 1) ecrire(o, o.cible * e); else o.el.textContent = o.final; });
      if (k < 1) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
  }

  /* ---------- graphe maître ---------- */
  const poser = (cle, el, h) => { if (sig[cle] === h) return false; sig[cle] = h; el.innerHTML = h; return true; };
  function majEtat() {
    if (!root) return;
    const res = hist.memo && hist.memo.res, rec = modele && modele.passe && modele.passe.reconstitue;
    let t = "";
    if (hist.etat === "charge") t = "Reconstitution du passé en cours…";
    else if (rec && res) {
      const prem = S ? premiereDate(S.snapshots) : null;
      t = "Avant ta première photo" + (prem ? " (" + dateFr(prem) + ")" : "") + ", le passé est reconstitué à partir des cours, de tes transactions et des soldes bancaires : une estimation, moins fiable qu'une photo.";
    }
    else if (hist.etat === "echec") t = "Les cours n'ont pas pu être lus : le passé n'est pas reconstitué.";
    else if (hist.etat === "pret" && res && !res.points.length && res.raison) t = res.raison;
    const g = geo && geo.deformee ? " L'échelle de temps du passé et du futur diffère : le trait « Aujourd'hui » les sépare." : "";
    t = (t + g).trim();
    if (sig.etat !== t) { sig.etat = t; $("ajEtat").textContent = t; $("ajEtat").hidden = !t; }
  }
  function renderGraphe() {
    const G = GRAPHE();
    if (!G || !ind) return;
    modele = evolution(S, jour(), periode, horizon, depsVue());
    const el = $("ajFrise"), f = modele.passe, r = f.resume || {};
    largeur = el.clientWidth || 0;
    const gr = G.construire(f, modele.futur, { largeur, today: modele.today, scopeLabel: scopeLabel() });
    geo = gr.geo; pointsGraphe = gr.points;
    const vide = f.points.length < 2 && !modele.futur
      ? '<p class="aj-frise-vide">' + (f.historique ? "Pas assez de points sur cette période : élargis-la ou choisis un pas plus fin."
        : "Pas encore d'historique : Boussole prend chaque nuit une photo de ton patrimoine, la courbe se dessine au fil des jours.") + "</p>" : "";
    poser("graphe", el, gr.svg || vide);
    poser("legende", $("ajLegende"), gr.svg ? G.legendeHtml(f, modele.futur) : "");
    poser("table", $("ajTable"), gr.svg ? G.tableauHtml(f, modele.futur, { scopeLabel: scopeLabel() }) : "");
    const t = f.points.length > 1 && r.variation != null
      ? eurS(r.variation) + " " + periodeTxt(periode) + (r.variationPct != null ? " (" + (r.variationPct < 0 ? "−" : "+") + nf1.format(Math.abs(r.variationPct)) + " %)" : "") : "";
    if (sig.resume !== t) { sig.resume = t; $("ajFriseResume").textContent = t; }
    const promesse = $("ajPromesse"); if (promesse) promesse.hidden = !modele.futur;
    const hz = $("ajHorizonZone"); if (hz) hz.hidden = !modele.futur; // pas de futur : période terminée avant aujourd'hui, ou aucune donnée
    majEtat();
  }
  let pointsGraphe = [];
  /* Infobulle au survol (souris, doigt) : point le plus proche en abscisse ; ne touche qu'aux éléments du curseur et à l'infobulle. */
  function survol(e) {
    const zone = $("ajFrise"), svg = zone.querySelector ? zone.querySelector("svg") : null, tip = $("ajTip");
    if (!svg || !geo || !pointsGraphe.length || !svg.getBoundingClientRect) return;
    const rect = svg.getBoundingClientRect(), k = geo.W / (rect.width || geo.W), x = (e.clientX - rect.left) * k;
    if (x < geo.L - 6 || x > geo.W - geo.R + 6) { masquerSurvol(); return; }
    let p = pointsGraphe[0];
    for (const q of pointsGraphe) if (Math.abs(q.x - x) < Math.abs(p.x - x)) p = q;
    const ligne = svg.querySelector(".aj-cur-l"), pt = svg.querySelector(".aj-cur-d");
    if (ligne) { ligne.setAttribute("x1", p.x.toFixed(1)); ligne.setAttribute("x2", p.x.toFixed(1)); ligne.setAttribute("class", "aj-cur-l on"); }
    if (pt) { pt.setAttribute("cx", p.x.toFixed(1)); pt.setAttribute("cy", p.y.toFixed(1)); pt.setAttribute("class", "aj-cur-d on n-" + p.nature); }
    tip.innerHTML = tipHtml(p);
    tip.hidden = false;
    const w = tip.offsetWidth || 170, gauche = p.x / k;
    tip.style.left = Math.max(4, Math.min((rect.width || geo.W) - w - 4, gauche - w / 2)) + "px";
    tip.style.top = Math.max(0, p.y / k - (tip.offsetHeight || 60) - 14) + "px";
  }
  function masquerSurvol() {
    const zone = $("ajFrise"), svg = zone.querySelector ? zone.querySelector("svg") : null, tip = $("ajTip");
    if (tip) tip.hidden = true;
    if (!svg) return;
    const l = svg.querySelector(".aj-cur-l"), d = svg.querySelector(".aj-cur-d");
    if (l) l.setAttribute("class", "aj-cur-l"); if (d) d.setAttribute("class", "aj-cur-d");
  }
  /** Contenu de l'infobulle : date, valeur, nature du point (mots, pas seulement un style de trait). */
  function tipHtml(p) {
    const res = hist.memo && hist.memo.res, d = res && res.drapeaux;
    const note = p.nature === "reconstitue" && d ? [d.compositionActuelle.length ? "à composition actuelle" : "", d.constantes.noms.length ? "autres lignes tenues constantes" : ""].filter(Boolean).join(" · ") : "";
    return '<span class="aj-tip-d">' + esc(p.nature === "projete" ? dateFr(p.date) : p.label && p.label !== dateFr(p.date) ? p.label + " · " + dateFr(p.date) : dateFr(p.date)) + "</span>" +
      '<span class="aj-tip-v">' + esc(eur(p.valeur)) + (p.nature === "projete" ? '<span class="aj-tip-c"> au centre</span>' : "") + "</span>" +
      (p.nature === "projete" ? '<span class="aj-tip-f">entre ' + esc(eur(p.min)) + " et " + esc(eur(p.max)) + "</span>" : "") +
      '<span class="aj-tip-n n-' + p.nature + '">' + { observe: "observé", reconstitue: "reconstitué", projete: "projeté, pas une promesse" }[p.nature] + "</span>" +
      (note ? '<span class="aj-tip-f">' + esc(note) + "</span>" : "");
  }

  /* Panneau « Comment c'est calculé » : natures du passé, hypothèses de la projection, repères publics. */
  function ouvrirCalcul(el) {
    const u = U(), G = GRAPHE();
    if (!u || !u.panneau || !G || !modele) return;
    const Rp = glob("Reperes") || voisin("Reperes", "./reperes.js"), rep = S && S.savoir && Array.isArray(S.savoir.reperes) ? S.savoir.reperes : [];
    const sources = [];
    [["livret_a_taux", "Taux du Livret A (repère pour les poches d'épargne)"], ["pfu_taux", "Prélèvement forfaitaire unique, non déduit de la projection"]].forEach(([cle, libelle]) => {
      const r = Rp && Rp.trouver ? Rp.trouver(rep, cle) : null;
      if (r) sources.push({ libelle, valeur: Rp.format(r), dateEffet: r.dateEffet, sourceTitre: r.sourceTitre, sourceUrl: r.sourceUrl });
    });
    const f = modele.futur, res = hist.memo && hist.memo.res;
    const contenu = G.calculHtml({ rec: res && res.points && res.points.length ? res : null, decalage: modele.passe.decalage, fut: f, rendements: f ? f.rendements : null, parBloc: f ? f.parBloc : null,
      versementSource: f ? f.versementSource : null, sources, deformee: !!(geo && geo.deformee), scopeLabel: scopeLabel() });
    u.panneau.ouvrir({ titre: "Comment c'est calculé", contenu, retour: el,
      pied: u.demanderAClaude("Explique-moi simplement comment Boussole calcule la courbe d'évolution et la projection de mon patrimoine net, et ce que je dois en retenir.") });
  }

  /* Période ou granularité changée (UI.periode) : le graphe et la variation de la carte « Patrimoine net » suivent ; l'historique est relu si besoin. */
  function surPeriode(o) {
    const x = o && typeof o === "object" ? o : { periode: o };
    if (gClic) gChoisie = true; // la granularité vient d'être choisie sur sa bascule : elle ne suit plus la période
    periode = { id: String(x.periode || x.id || periode.id), granularite: x.granularite ? String(x.granularite) : periode.granularite, du: x.du || undefined, au: x.au || undefined };
    try { localStorage.setItem(CLE, JSON.stringify(periodeAEnregistrer(periode, gChoisie))); } catch (e) {}
    if (!S || !U() || !root) return;
    ind = indicateurs(S, jour(), periode, depsVue());
    renderCartes();
    renderGraphe();
    chargerHistorique();
  }
  /* Carte → panneau de détail (le lien interne du pied ferme le panneau puis la coque suit le hash). Le focus revient à la carte,
     ou à la carte du même id si un rendu l'a remplacée entre-temps. */
  function ouvrirCarte(id, el) {
    const u = U(); if (!u || !u.panneau || !ind) return;
    const d = detail(id, ind, periode);
    u.panneau.ouvrir({ titre: d.titre, contenu: d.contenu, lien: d.lien, pied: u.demanderAClaude(d.question), retour: el,
      surFermeture: () => { if (el && !el.isConnected) { const c = root.querySelector('[data-ui-carte="' + id + '"]'); if (c) c.focus(); } } });
  }

  /* Jalon du calendrier → panneau (effet, « Comment c'est calculé », sources) ; focus rendu au bouton, ou à celui du même jalon si la carte a été redessinée. */
  function ouvrirJalon(el) {
    const u = U(); if (!u || !u.panneau || !ind || !ind.calendrier) return;
    const id = el.getAttribute("data-ech"), j = ind.calendrier.jalons.find(x => x.id === id);
    if (!j) return;
    const d = jalonDetail(j);
    u.panneau.ouvrir({ titre: d.titre, contenu: d.contenu, lien: d.lien, pied: u.demanderAClaude(d.question, "Demander à Claude"), retour: el,
      surFermeture: () => { if (!el.isConnected) { const c = Array.from(root.querySelectorAll("[data-ech]")).find(x => x.getAttribute("data-ech") === id); if (c) c.focus(); } } });
  }
  function ouvrirACompleter(el) {
    const u = U(); if (!u || !u.panneau || !ind || !ind.calendrier) return;
    const d = aCompleterDetail(ind.calendrier.aCompleter, u);
    u.panneau.ouvrir({ titre: d.titre, contenu: d.contenu, retour: el,
      surFermeture: () => { if (!el.isConnected) { const c = root.querySelector("[data-ech-completer]"); if (c) c.focus(); } } });
  }
  /* Lien profond #aujourdhui?echeances=1 : ouvre le calendrier complet une fois les données prêtes. */
  let ouvrirCalendrierComplet = false;
  function lienProfond() {
    const u = U();
    if (!ouvrirCalendrierComplet || !u || !u.panneau || !ind || !ind.calendrier) return;
    ouvrirCalendrierComplet = false;
    const d = calendrierDetail(ind.calendrier, u);
    u.panneau.ouvrir({ titre: d.titre, contenu: d.contenu, retour: root.querySelector("[data-ech]") || undefined });
  }

  /* Repère de décision du graphe → panneau (synthèse, date, statut, lien vers Agent › Journal) ; focus rendu au repère, ou au repère
     du même id si le graphe a été redessiné entre-temps. */
  function ouvrirRepere(el) {
    const u = U(); if (!u || !u.panneau || !ind) return;
    const id = el.getAttribute("data-journal"), r = (ind.frise.reperes || []).find(x => x.id === id);
    if (!r) return;
    const d = repereDetail(r);
    u.panneau.ouvrir({ titre: d.titre, contenu: d.contenu, lien: d.lien, retour: el,
      surFermeture: () => { if (!el.isConnected) { const c = Array.from(root.querySelectorAll("[data-journal]")).find(x => x.getAttribute("data-journal") === id); if (c) c.focus(); } } });
  }

  function mount(r) {
    root = r;
    const u = U();
    const fr = $("ajFrise");
    fr.addEventListener("click", e => { const el = e.target && e.target.closest ? e.target.closest("[data-journal]") : null; if (el) ouvrirRepere(el); });
    fr.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = e.target && e.target.closest ? e.target.closest("[data-journal]") : null;
      if (el) { e.preventDefault(); ouvrirRepere(el); }
    });
    fr.addEventListener("pointermove", survol);
    fr.addEventListener("pointerdown", survol);
    fr.addEventListener("pointerleave", masquerSurvol);
    const zone = $("ajPeriode");
    const marquer = e => { gClic = !!(e.target && e.target.closest && e.target.closest(".ui-periode-g")); };
    const effacer = () => { gClic = false; };
    ["click", "keydown"].forEach(t => { zone.addEventListener(t, marquer, true); zone.addEventListener(t, effacer); });
    if (u && u.periode) {
      const o = { periode: periode.id, du: periode.du, au: periode.au, premiere: S ? premiereDate(S.snapshots) : undefined, surChange: surPeriode };
      if (gChoisie && periode.granularite) o.granularite = periode.granularite; // sinon UI.periode la règle selon la période
      ctlPeriode = u.periode(zone, o);
    }
    if (u && u.bascule) u.bascule($("ajHorizon"), { label: "Horizon de la projection", actif: String(horizon),
      options: HORIZONS.map(n => ({ id: String(n), label: n + (n > 1 ? " ans" : " an"), aria: n + (n > 1 ? " ans" : " an") })),
      surChange: id => { horizon = +id; try { localStorage.setItem(CLE_H, String(horizon)); } catch (e) {} if (S && ind) renderGraphe(); } });
    $("ajEch").addEventListener("click", e => {
      const t = e.target && e.target.closest ? e.target : null;
      const b = t && t.closest("[data-ech]"), c = t && t.closest("[data-ech-completer]");
      if (b) ouvrirJalon(b); else if (c) ouvrirACompleter(c);
    });
    const bc = $("ajCalcul"); if (bc) bc.addEventListener("click", () => ouvrirCalcul(bc));
    $("ajClaude").innerHTML = u && u.demanderAClaude
      ? u.demanderAClaude("Explique-moi simplement l'évolution de mon patrimoine net dans Boussole sur la dernière année : qu'est-ce qui l'a fait bouger ?", "Commenter avec Claude") : "";
    if (u && u.brancher) u.brancher(root, { surCarte: ouvrirCarte }); // cartes et « Voir plus » de la boîte de réception
    /* Le graphe est dessiné à la largeur réelle (textes lisibles sur mobile) : redessin quand la largeur change nettement. */
    if (typeof ResizeObserver === "function") new ResizeObserver(() => {
      const w = $("ajFrise").clientWidth;
      if (ind && w && Math.abs(w - largeur) > 24) renderGraphe();
    }).observe($("ajFrise"));
  }
  function update(snap, visible) {
    S = snap;
    items = boite(S, jour(), { aujRevue: RE().aujParis() }); // revue au jour de Paris, comme le serveur ; le reste au jour local
    ctlPremiere(); // « Tout » part de la première donnée
    dirty = true;
    if (visible) { render(); dirty = false; }
  }
  function show() {
    const p = window.App && typeof App.parametres === "function" ? App.parametres() : {};
    if (p && p.echeances) ouvrirCalendrierComplet = true;
    if (dirty) { render(); dirty = false; } else lienProfond();
  }
  /* Pastille de la navigation : nombre d'éléments de la boîte de réception (ne dépend que de `items`) ; vide quand il n'y en a pas. */
  function headline() { return items.length ? String(items.length) : ""; }

  const api = { mount, update, show, headline };
  const reg = () => App.register("aujourdhui", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
