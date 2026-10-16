/* Aujourd'hui : page d'accueil du cockpit (« le board lit, l'agent écrit »).
   - Bandeau de 4 indicateurs en cartes cliquables (cartes(), boutons data-ui-carte qui ouvrent UI.panneau : 2-4 lignes + lien vers la page).
     Même squelette pour les 4 (libellé en casse normale, corps, pied), statut en puce avec son mot, aucun chiffre animé (UX2) :
     1. Patrimoine net : gros chiffre, variation (Fmt.fmtDelta : signe, flèche, période) et mini-courbe en un seul bloc ;
     2. Bonnes pratiques : anneau sur 100 (Pratiques.evaluer), chiffre en texte HTML centré, puce de statut et « N critères à compléter » ;
     3. Objectifs : anneau d'atteinte (« % » plus petit), puce « N en retard » ; les objectifs un par un sont dans le panneau de la carte ;
     4. Prochaine échéance : « 39 jours » sur une ligne, libellé (deux lignes au plus, texte complet en title) et date.
     Mobile : le patrimoine net en héros, puis 3 mini-cartes, puis « À traiter » (3 éléments), le graphe, les échéances ; ≥ 1240 px : « À traiter »
     passe en colonne de droite à côté du graphe (5 éléments).
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
   - Graphe maître (juste après le bandeau) : le composant GraphePatrimoine (graphe-patrimoine.js, données de graphe-modele.js) ; un seul axe du temps proportionnel
     (passé observé et reconstitué, projection du moteur Projection : médiane, bandes 8 chances sur 10 et 1 sur 2), une seule commande de temps (1 an · 5 ans · 10 ans ·
     20 ans · Tout, 5 ans par défaut sur mobile, 10 ans sur ordinateur), jalons (événements de vie, calendrier des enveloppes, fins de crédit), objectifs, bande de
     capacité d'épargne, plein écran. Réglages locaux (vue, euros, impôts, variante, crise, 100 avenirs, comparaison à un plan figé), jamais enregistrés. Lien profond
     #aujourdhui?graphe=plein-ecran. Les cours, transactions et opérations bancaires de la reconstitution sont lus à la demande (SerieNet.charger).
   - Boîte de réception unique (3 éléments puis « Voir les autres », 5 dans la colonne de droite) : propositions de Claude en attente (par lot), entrées du journal à relire
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
     fiche ; « Voir le détail par compte » est dans la feuille de lecture du graphe.
   Accessibilité et mouvement : cartes = vrais boutons (nom accessible complet, aria-label), jauges avec équivalent texte, statuts en mots
   (jamais la couleur seule) ; le tracé des anneaux seulement à la première apparition, jamais avec prefers-reduced-motion ; aucun
   chiffre ne défile. Textes au tutoiement ; « Faire le point avec Claude » = revue du mois de l'agent (ClaudePrompts.phrase("revue")).
   Fonctions pures exportées pour les tests (module.exports) : boite, etatRevue, echeances, calendrierDe, prochainesHtml, jalonDetail, aCompleterDetail, indicateurs, objectifs, frise, reperesJournal,
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
  const RDT = d => dep(d, "Rendement") || voisin("Rendement", "./rendement.js");
  /* Série du patrimoine net et variation : UNE définition pour toute l'app (serie-net.js), partagée avec Patrimoine › Comptes. */
  const SN = d => dep(d, "SerieNet") || voisin("SerieNet", "./serie-net.js");

  /* ---------- dates (AAAA-MM-JJ, jours calendaires) ---------- */
  const pad = n => String(n).padStart(2, "0");
  /** Date AAAA-MM-JJ. Sans argument : aujourd'hui au jour de Paris, comme le serveur et les migrations (RoutineEtat.aujParis, indépendant du
      fuseau du navigateur) ; repli sur le jour local si RoutineEtat manque. Avec un instant : sa date locale. */
  function jour(d) {
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    if (d == null) { const R = RE(), p = R && typeof R.aujParis === "function" ? R.aujParis() : null; if (isoOk(p)) return p; }
    const x = d == null ? new Date() : new Date(d);
    if (!isFinite(x)) return "";
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }
  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const utc = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  const jj = v => (v ? String(v).slice(0, 10) : "");
  const dateFr = s => (isoOk(s) ? FM().fmtDate(s) : "");
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
  /* Formats uniques (format.js, UX1) : « 193 490 € », « +9 646 € », « 5,2 % », « 14 oct. 2026 » ; global du navigateur, sinon le module voisin sous Node. */
  const FM = () => glob("Fmt") || (typeof module === "object" && module.exports && typeof require === "function" ? require("./format.js") : null);
  const nf0 = { format: v => FM().fmtNombre(v) };
  const nf1 = { format: v => FM().fmtNombre(v, { decimales: 1 }).replace(/,0$/, "") };
  const eur = v => FM().fmtEUR(v);
  const eurS = v => FM().fmtEUR(v, { signe: true });
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  const liste = xs => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " et " + xs[xs.length - 1]);
  const maj = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const extrait = (t, n) => { const s = plat(t); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const counted = p => !!p && p.status !== "à recevoir" && p.status !== "clôturé";

  /* ---------- liens ---------- */
  /* Lien profond vers une entrée du journal : la coque retient le paramètre et Agent › Journal ouvre l'entrée (app.js, journal-view.js). */
  const lienEntree = id => "agent/journal?entree=" + encodeURIComponent(String(id));
  const R = { comptes: "patrimoine/comptes", propositions: "agent/propositions", journal: "agent/journal", connexion: "compte/connexion", placements: "patrimoine/placements", budget: "patrimoine/budget", objectifs: "patrimoine/objectifs", sante: "pilotage/sante", risque: "pilotage/risque", echeances: "aujourdhui?echeances=1" };
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
    if (lotCal && lotCal.S === S && lotCal.t === t && lotCal.M === M) return lotCal.sortie;
    let sortie = null;
    try { sortie = M.calendrier(typeof M.depuisEtat === "function" ? M.depuisEtat(S) : S, t); } catch (e) { sortie = null; }
    if (lotCal) Object.assign(lotCal, { S, t, M, sortie });
    return sortie;
  }
  /* Un rendu (boîte, indicateurs, cartes) lit le calendrier 3 à 4 fois pour le même état et le même jour : dans un lot, le moteur ne tourne qu'une
     fois par (état, jour, moteur). Le lot ne vit que le temps d'un appel synchrone (aucun état partagé entre deux rendus : un état modifié
     ensuite est recalculé) ; les appels isolés (tests, autres vues) ne mémorisent rien. La sortie est lue, jamais modifiée, par les appelants. */
  let lotCal = null;
  function enLot(fn) {
    if (lotCal) return fn();
    lotCal = {};
    try { return fn(); } finally { lotCal = null; }
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
      return { type: "routine", urgence: 1, date: e.dernier || t, titre: "Revue du mois : " + pluriel(e.questions.length, "question"),
        contexte: plat(e.questions[0].question) + (ech ? " · " + ech + "." : ""), action: { label: "Répondre avec Claude", url: urlClaude(RE().phraseRoutine(e.questions)) } };
    }
    if (e.code === "a_activer") {
      return { type: "routine", urgence: 3, date: t, titre: "Active ta revue mensuelle",
        contexte: "Chaque mois, Claude fait le point sur ton patrimoine et prépare les questions à te poser. Elle s'active avec lui en une phrase.",
        action: { label: "Voir comment", route: R.connexion } };
    }
    return null;
  }

  /** Éléments bancaires de la boîte (type « banque », vers Compte › Connexion). */
  function elementsBanque(S, t) {
    const B = BE(), b = S && S.banque, out = [];
    if (!B || !b || !b.actif) return out;
    (Array.isArray(b.connexions) ? b.connexions : []).forEach(c => {
      const e = c ? B.etat(c.etat) : null;
      if (!e || !e.action) return;
      const etab = plat(c.etablissement) || "sans nom", d = jj(c.derniereSynchro);
      out.push({ type: "banque", urgence: e.urgence || 2, date: isoOk(d) ? d : t, titre: etab + " : reconnecte ta banque",
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
  function boite(S, today, deps) { return enLot(() => boiteCalcul(S, today, deps)); }
  function boiteCalcul(S, today, deps) {
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
      out.push({ type: "proposition", urgence: 1, date, titre: pluriel(ps.length, "changement") + " à valider",
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
        titre: pluriel(nRelire, "note") + " de Claude à relire",
        contexte: (titres ? titres + " : c" : "C") + "onfirme ou corrige ce que Claude a noté.",
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
        contexte: "Noté par " + plat(m.source || "Claude") + ", prévu le " + dateFr(e) + ".",
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
  const periodeTxt = p => SN().periodeTxt(p);

  /** Repères de la frise : décisions du journal non abandonnées et datées, triées par date → [{ id, date, titre, synthese, statut }]. */
  function reperesJournal(journal) {
    return (Array.isArray(journal) ? journal : [])
      .filter(e => e && e.type === "decision" && e.statut !== "abandonne" && isoOk(jj(e.dateDecision)))
      .map(e => ({ id: String(e.id), date: jj(e.dateDecision), titre: plat(e.titre), synthese: plat(e.synthese), statut: e.statut }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /** Série du passé : patrimoine net estimé (photos + point du jour, BilanCalc.evolution) fusionné avec le passé reconstitué quand
      deps.reconstitue (résultat de Historique.reconstituer) en fournit un, puis agrégé sur la période (SerieNet.serie, la même série que la
      variation de Patrimoine › Comptes), et repères des décisions du journal.
      periode = { id: 1m|3m|1a|tout|perso…, du?, au?, granularite? } →
      { points (Periodes.agreger, chacun avec sa nature observe|reconstitue), resume, bornes, granularite, historique, reperes,
        reconstitue (vrai si la période dessinée contient du reconstitué), decalage, horsFin (net − financier d'aujourd'hui), premiere (1re date de la série) } */
  function frise(S, today, periode, deps) {
    const s = S || {};
    return Object.assign(SN(deps).serie(s, jour(today), periode, deps), { reperes: reperesJournal(s.journal) });
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
  function indicateurs(S, today, periode, deps) { return enLot(() => indicateursCalcul(S, today, periode, deps)); }
  function indicateursCalcul(S, today, periode, deps) {
    const s = S || {}, t = jour(today), scope = s.scope || "foyer", positions = s.positions || [];
    const C = dep(deps, "Calc"), Pr = dep(deps, "Pratiques"), BC = dep(deps, "BilanCalc");
    // Patrimoine net (et variation sur la période du graphe) ; composition « Ce que je possède, ce que je dois » (BilanCalc.composition,
    // mêmes calculs que l'ancienne carte du Bilan) pour le panneau de la carte.
    const pat = C ? C.patrimoine(positions, s.profil || null, scope) : { financier: 0, immobilier: 0, usage: 0, entreprise: 0, dettes: 0, net: 0 };
    const f = frise(s, t, periode, deps);
    let composition = null;
    if (BC && typeof BC.composition === "function") { try { composition = BC.composition(positions, s.profil || null, scope); } catch (e) { composition = null; } }
    const courbe = f.points.map(x => x.valeur);
    /* rendement réel des placements (relevés + versements) : ton rendement, celui de tes placements ; null sans aucun relevé. Ce que le modèle en attendait vient du graphe (detail, 4e paramètre). */
    let rendement = null;
    const RD = RDT(deps);
    if (RD && typeof RD.pointsEtFlux === "function") {
      try {
        const pf = RD.pointsEtFlux(s, scope, t);
        if (pf.points.length > 1) rendement = { periodes: RD.periodes({ points: pf.points, flux: pf.flux, today: t, versementsConnus: pf.versementsConnus }), notes: pf.notes };
      } catch (e) { rendement = null; }
    }
    const net = { rendement, valeur: pat.net, financier: pat.financier, immobilier: pat.immobilier, autres: pat.usage + pat.entreprise, usage: pat.usage, entreprise: pat.entreprise,
      dettes: pat.dettes, composition,
      vide: !positions.some(counted) && !pat.immobilier && !pat.dettes && !pat.usage && !pat.entreprise,
      variation: f.historique ? f.resume.variation : null, variationPct: f.historique ? f.resume.variationPct : null,
      enAttente: !!(deps && deps.enAttente), // le passé est encore lu : la variation n'est pas définitive (squelette, jamais un chiffre provisoire)
      reconstitue: f.reconstitue && f.points.length > 0 && f.points[0].nature === "reconstitue", courbe: courbe.length > 60 ? courbe.filter((_, i) => i % Math.ceil(courbe.length / 60) === 0 || i === courbe.length - 1) : courbe };
    // Bonnes pratiques
    let r = null;
    if (Pr && typeof Pr.evaluer === "function") {
      try { r = Pr.evaluer({ positions, profil: s.profil || null, config: s.config || null, budget: s.budget || null, objectifs: s.objectifs || [], scope,
        risque: s.risque || null, classes: s.classes || {}, banque: s.banque || null, today: new Date(t + "T12:00:00") }); } catch (e) { r = null; }
    }
    const crit = r && Array.isArray(r.criteres) ? r.criteres : [];
    const totalP = r && r.total != null ? r.total : null;
    const pratiques = { total: totalP, statut: Pr && typeof Pr.statutNote === "function" ? Pr.statutNote(totalP) : null, provisoire: !!(r && r.provisoire),
      familles: r && Array.isArray(r.familles) ? r.familles.map(x => ({ titre: x.titre, total: x.total })) : [],
      aCompleter: crit.filter(c => c && c.aCompleter).length };
    // Prochaine échéance
    const ech = echeances(s, t, deps), cal = calendrierDe(s, t, deps);
    // Calendrier patrimonial : jalons à venir (5 au plus pour la carte), tous les jalons pour le panneau, données à compléter
    const venir = cal ? cal.jalons.filter(j => j.statut !== "passe") : [];
    const calendrier = { disponible: !!cal, prochains: venir.slice(0, 5), nPlus: Math.max(0, venir.length - 5), aCompleter: cal ? cal.a_completer : [], jalons: cal ? cal.jalons : [],
      seuils: cal ? cal.seuils : [], indisponibles: cal ? cal.regles_indisponibles : [] };
    return { net, pratiques, objectifs: objectifs(s, t, deps), allocation: ecartAllocation(s, deps), echeance: { prochaine: ech[0] || null, liste: ech.slice(0, 4), enveloppeALignes: ech[0] && ech[0].jalon ? enveloppeALignes(s, ech[0].jalon) : null }, calendrier, frise: f };
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

  /* ---------- cartes du bandeau : boutons data-ui-carte (UI.brancher ouvre le panneau) ----------
     Même squelette pour les 4 : en-tête (libellé en casse normale, chevron), corps (chiffre, anneau ou courbe), pied (statut en puce avec son mot).
     Aucune couleur de statut hors de la puce et de l'arc de l'anneau ; aucun chiffre animé. */
  const CHEVRON_DROITE = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';
  /** Puce de statut (même balisage que UI.puce) : bon | surveiller | travailler | completer, toujours avec son mot. */
  const puceH = (statut, texte) => '<span class="ui-puce ' + statut + '"><span class="ui-puce-point" aria-hidden="true"></span>' + esc(texte) + "</span>";
  const badge = (texte, ton) => '<span class="ui-badge ' + ({ bon: "bon", info: "info", attention: "attention", critique: "critique" }[ton] || "neutre") + '">' + esc(texte) + "</span>";
  const R_ANNEAU = 34, CIRC = 2 * Math.PI * R_ANNEAU;
  /** Jauge en anneau : l'arc est décoratif (aria-hidden) et le chiffre est du texte HTML centré au milieu (grille), jamais un <text> SVG :
      il se centre optiquement, reste en chiffres tabulaires et ne déborde pas (taille par jeton, max-width de l'anneau).
      pct 0 à 100 ou null (anneau vide) ; statut : couleur de l'arc ; fig = { n, u?, mode: "sur" (unité sous le chiffre) | "pct" (unité à côté, plus petite) }. */
  function anneau(pct, statut, fig) {
    const p = pct == null ? 0 : Math.max(0, Math.min(100, +pct)), off = CIRC * (1 - p / 100);
    const long = String(fig.n).length >= 3 ? " long" : "";
    return '<span class="aj-ring-box"><svg class="aj-ring s-' + esc(statut || "neutre") + '" viewBox="0 0 80 80" aria-hidden="true" focusable="false">' +
      '<circle class="aj-ring-fond" cx="40" cy="40" r="' + R_ANNEAU + '"/>' +
      '<circle class="aj-ring-arc" cx="40" cy="40" r="' + R_ANNEAU + '" transform="rotate(-90 40 40)" stroke-dasharray="' + CIRC.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" data-aj-off="' + off.toFixed(2) + '"/></svg>' +
      '<span class="aj-ring-fig ' + (fig.mode === "pct" ? "pct" : "sur") + long + '" aria-hidden="true"><span class="aj-ring-n">' + esc(fig.n) + "</span>" + (fig.u ? '<span class="aj-ring-u">' + esc(fig.u) + "</span>" : "") + "</span></span>";
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
  /** Variation avec signe, flèche et période (Fmt.fmtDelta) : « ▲ +9 646 € · +5,2 % » en couleur de mouvement, « sur 1 an » en muted. */
  function deltaHtml(v, pct, periode) {
    const p = periodeTxt(periode), d = FM().fmtDelta({ montant: v, pct, periode: p });
    const mouvement = d.texte.slice(0, d.texte.length - p.length).trim().replace(/^\S+\s*/, "");
    return '<span class="aj-k-delta">' + tendanceHtml(d.sens, mouvement) + '<span class="aj-k-per">' + esc(p) + "</span></span>";
  }
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
  const carteBtn = (id, cls, aria, titre, corps) => '<button type="button" class="aj-k ' + cls + '" data-ui-carte="' + id + '" aria-haspopup="dialog" aria-label="' + esc(aria) + '">' +
    '<span class="aj-k-tete"><span class="aj-k-titre">' + esc(titre) + '</span><span class="aj-k-ouvrir">' + CHEVRON_DROITE + "</span></span>" + corps + "</button>";
  /** Date courte d'une liste : « 14 oct. » dans l'année, « 1 févr. 2027 » au-delà. */
  const dateListe = (s, auj) => (isoOk(s) ? FM().fmtDate(s, { court: isoOk(auj) ? s.slice(0, 4) === auj.slice(0, 4) : false }) : "");

  /** Les 4 cartes du bandeau (patrimoine net, bonnes pratiques, objectifs, prochaine échéance). Chaque champ est échappé. */
  function cartes(ind, U, periode) {
    const n = ind.net, pr = ind.pratiques, ob = ind.objectifs || objectifs({}, TODAY_VIDE, null), ec = ind.echeance, v = n.variation;
    // 1. Patrimoine net : valeur, variation (SerieNet.variation, la même sur Patrimoine › Comptes), période, courbe : un seul bloc ; squelette tant que le passé est lu
    const attente = !!n.enAttente && !n.vide;
    const sens = attente || v == null || n.vide ? null : Math.round(v) > 0 ? "hausse" : Math.round(v) < 0 ? "baisse" : "stable";
    const sous1 = n.vide ? "Lance ton bilan avec Claude" : attente ? "" : v == null ? "Première photo cette nuit" : "";
    const c1 = carteBtn("net", "aj-k-net", "Patrimoine net : " + (n.vide ? "pas encore de données" : eur(n.valeur) + (attente ? ", variation en cours de calcul" : sens ? ", " + { hausse: "en hausse de ", baisse: "en baisse de ", stable: "stable, " }[sens] + (sens === "stable" ? "" : eur(Math.abs(v))) + " " + periodeTxt(periode) : "")), "Patrimoine net",
      '<span class="aj-k-val num">' + (n.vide ? "—" : esc(eur(n.valeur))) + "</span>" +
      '<span class="aj-k-pied">' + (attente ? '<span class="ui-skel" aria-hidden="true"></span>' : sens ? deltaHtml(v, n.variationPct, periode) : "") + (sous1 ? '<span class="aj-k-sous">' + esc(sous1) + "</span>" : "") + "</span>" +
      (n.vide || attente ? "" : '<span class="aj-k-courbe">' + spark(n.courbe) + "</span>"));
    // 2. Bonnes pratiques : anneau (note sur 100, unité sous le chiffre), puce de statut, une ligne
    // statut de la note : Pratiques.statutNote, la même règle que Santé (≥ 80 vert, 60 à 79 ocre, < 60 rouge)
    const tot = pr.total, sn = pr.statut || { statut: "completer", mot: "À compléter" }, tonP = sn.statut, motP = sn.mot;
    const sous2 = tot == null ? "Données à compléter" : pr.aCompleter ? pluriel(pr.aCompleter, "critère") + " à compléter" : "Tous les critères sont notés";
    const c2 = carteBtn("pratiques", "aj-k-pra t-" + tonP, "Bonnes pratiques : " + (tot == null ? "pas encore de note, données à compléter" : tot + " sur 100, " + motP.toLowerCase() + (pr.provisoire ? ", note provisoire" : "") + ", " + sous2.toLowerCase()), "Bonnes pratiques",
      '<span class="aj-k-corps">' + anneau(tot, tot == null ? "neutre" : tonP, { n: tot == null ? "—" : String(Math.round(tot)), u: tot == null ? "" : "/ 100", mode: "sur" }) +
      '<span class="aj-k-jauge-t">' + puceH(tonP, pr.provisoire && tot != null ? motP + " · provisoire" : motP) + '<span class="aj-k-sous">' + esc(sous2) + "</span></span></span>");
    // 3. Objectifs : anneau (avancement pondéré, « % » plus petit à côté du chiffre), puce, une ligne ; les objectifs un par un sont dans le panneau
    const motO = ob.vide ? "" : ob.retard ? ob.retard + " en retard" : ob.liste.every(x => x.statut === "atteint") ? "Tous atteints" : "Tous dans les temps";
    const stO = ob.vide ? "completer" : ob.ton === "critique" ? "travailler" : ob.retard ? "surveiller" : "bon";
    const c3 = carteBtn("objectifs", "aj-k-obj t-" + ob.ton, "Objectifs : " + (ob.vide ? "aucun objectif défini" : ob.pct + " % d'avancement pondéré, " + (ob.retard ? pluriel(ob.retard, "objectif") + " en retard" : motO.toLowerCase()) + ". " +
      ob.top.map(x => x.nom + " " + Math.round(x.progression * 100) + " %, " + x.mot).join(" ; ")), "Objectifs",
      '<span class="aj-k-corps">' + anneau(ob.pct, ob.vide ? "neutre" : stO, { n: ob.vide ? "—" : String(ob.pct), u: ob.vide ? "" : "%", mode: "pct" }) +
      '<span class="aj-k-jauge-t">' + (ob.vide ? "" : puceH(stO, motO)) + '<span class="aj-k-sous">' + esc(ob.vide ? "Fixe ton premier objectif avec Claude" : "d'avancement, selon la priorité") + "</span></span></span>");
    // 4. Prochaine échéance : « 47 jours » sur une ligne, libellé (deux lignes au plus, texte complet en title), date qui ne se coupe pas ; puce seulement si c'est proche
    const e = ec.prochaine, cr = e ? compteARebours(e.jours) : null, stE = !e ? null : e.jours <= 7 ? "travailler" : e.jours <= 30 ? "surveiller" : null, motE = e ? (e.jours <= 7 ? "Imminente" : "Proche") : "";
    const unite = cr && !cr.mot ? (cr.unite === "jours" ? '<span class="u-l"> jours</span><span class="u-c"> j</span>' : '<span> ' + esc(cr.unite) + "</span>") : "";
    const c4 = carteBtn("echeance", "aj-k-ech" + (stE ? " t-" + (stE === "travailler" ? "critique" : "attention") : ""), "Prochaine échéance : " + (e ? enToutesLettres(cr) + ", " + plat(e.titre) + ", le " + dateFr(e.date) + (stE ? ", " + motE.toLowerCase() : "") : "aucune date à venir"), "Prochaine échéance",
      '<span class="aj-k-val num">' + (!e ? '<span class="aj-k-mot">Aucune</span>' : cr.mot ? '<span class="aj-k-mot">' + esc(cr.mot) + "</span>" : '<span class="aj-k-n">' + cr.n + '</span><span class="aj-k-unit">' + unite + "</span>") + "</span>" +
      '<span class="aj-k-pied aj-k-pied-ech">' + (e ? '<span class="aj-k-lib" title="' + esc(plat(e.titre)) + '">' + esc(plat(e.titre)) + '</span><span class="aj-k-date">' + (stE ? puceH(stE, motE) : "") + "<span>" + esc(dateFr(e.date)) + "</span></span>"
        : '<span class="aj-k-sous">Aucune date à venir</span>') + "</span>");
    return c1 + c2 + c3 + c4;
  }
  const TODAY_VIDE = "2000-01-01";

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
  /** Rendement réel du panneau « Patrimoine net » : la période la plus longue mesurable parmi 1 an, 3 mois, 1 mois — ton rendement (pondéré par l'argent), celui de tes placements (pondéré par le temps) et,
      quand le graphe a calculé la projection, ce que le modèle en attendait avec la phrase « réel contre attendu ». extra : { periodes } (celles du graphe : attendu, comparaison, source). */
  function rendementPanneau(rd, extra) {
    if (!rd || !rd.periodes) return "";
    const RD = RDT(null), graphe = extra && Array.isArray(extra.periodes) ? extra.periodes : [];
    const parId = id => graphe.find(p => p.id === id) || rd.periodes.find(p => p.id === id);
    const lib = { "1a": "1 an", "3m": "3 mois", "1m": "1 mois" };
    const mesure = x => !!x && x.statut != null && x.statut !== "insuffisant";
    /* 1 an si les relevés le permettent ; sinon la période la plus longue mesurable (3 mois, 1 mois ou depuis le premier relevé) */
    const p = mesure(parId("1a")) ? parId("1a") : ["3m", "1m", "debut"].map(parId).filter(mesure).sort((a, b) => b.jours - a.jours)[0];
    const pied = '<p class="aj-det-note">Net de frais, avant impôts, sur tes placements (comptes courants exclus). Ton rendement tient compte de la date de tes versements ; celui de tes placements non : c\'est lui qui se compare à l\'attendu.</p>';
    if (!p) {
      const rien = rd.periodes.find(x => x.id === "debut") || rd.periodes[0];
      return '<p class="aj-det-note aj-det-rd">Rendement : ' + esc((rien && rien.raison) || "pas assez d'historique") + ".</p>";
    }
    const an = !!p.annualise, ap = p.statut === "approche", fmt = v => (v == null ? "—" : (ap ? "≈ " : "") + RD.pct(v, { signe: !an }) + (an ? "/an" : "")), qui = lib[p.id] || RD.dureeTxt(p.jours);
    const li = (l, v) => '<li class="aj-det-rd"><span class="aj-det-l">' + esc(l) + '</span><span class="aj-det-v">' + esc(v) + "</span></li>";
    let h = '<p class="aj-det-note aj-det-rd">' + (p.id === "debut" ? "Rendement depuis ton premier relevé (" + esc(qui) + ")" : "Rendement sur " + esc(qui)) + "</p><ul class=\"aj-det\">" + li("Ton rendement", fmt(an ? p.xirr_annuel_pct : p.xirr_periode_pct)) +
      li("Rendement de tes placements", fmt(an ? p.twr_annuel_pct : p.twr_periode_pct));
    const at = p.attendu && p.attendu.statut === "ok" ? p.attendu : null;
    if (at) h += li("Attendu par le modèle", RD.pct(at.attendu_pct, { signe: !an }) + (an ? "/an" : "")) + li("Fourchette 8 chances sur 10", RD.pct(at.p10_pct, { signe: true, dec: at.p90_pct - at.p10_pct >= 6 ? 0 : 1 }).replace(/\u00a0%$/, "") + " à " + RD.pct(at.p90_pct, { signe: true, dec: at.p90_pct - at.p10_pct >= 6 ? 0 : 1 }));
    h += "</ul>";
    const notes = (p.notes || []).map(n => n.charAt(0).toUpperCase() + n.slice(1));
    const unAn = parId("1a"), manque = p.id !== "1a" && unAn && unAn.statut === "insuffisant" ? ["Pas assez d'historique pour 1 an : la période la plus longue mesurable est de " + qui + (p.id === "debut" ? " (depuis ton premier relevé)" : "")] : [];
    if (p.comparaison && p.comparaison.phrase) h += '<p class="aj-det-note aj-det-rd">' + esc(p.comparaison.phrase + (p.source ? ". " + p.source.texte.charAt(0).toUpperCase() + p.source.texte.slice(1) + "." : ".")) + "</p>";
    if (notes.length || manque.length) h += '<p class="aj-det-note aj-det-rd">' + esc(manque.concat(notes).join(" ; ") + ".") + "</p>";
    return h + pied;
  }
  function compositionHtml(n, rendementHtml) {
    const lignes = [["Placements financiers", eur(n.financier)], ["Immobilier", eur(n.immobilier)]];
    if (n.usage > 0) lignes.push(["Biens d'usage (voiture, meubles…)", eur(n.usage)]);
    if (n.entreprise > 0) lignes.push(["Parts d'entreprise", eur(n.entreprise)]);
    lignes.push(["Dettes", eur(-n.dettes)], ["Patrimoine net", eur(n.valeur)]);
    const c = n.composition;
    const groupe = (label, ls, fiche) => '<p class="aj-det-note">' + esc(label) + '</p><ul class="aj-det">' + ls.map(l => fiche ? ligneFiche(l.label, eur(l.montant)) : ligne(l.label, eur(l.montant))).join("") + "</ul>";
    const det = c ? c.actifs.filter(b => b.lignes.length).map(b => groupe(b.label + " · " + eur(b.total), b.lignes, b.cle === "financier")).join("") +
      (c.dettes.lignes.length ? groupe("Dettes · " + eur(-c.dettes.total), c.dettes.lignes.map(l => ({ label: l.label, montant: -l.montant }))) : "") : "";
    return '<p class="aj-det-note">Ce que je possède, ce que je dois</p><ul class="aj-det">' + lignes.map(l => ligne(l[0], l[1])).join("") + "</ul>" + (rendementHtml || "") +
      (det ? accordeon("Le détail, ligne par ligne", det) : "");
  }
  /** Panneau d'une carte : { titre, contenu (HTML échappé : 2 à 4 lignes et une note), lien: { label, href } vers la page complète,
      question } — question préremplie pour « Demander à Claude » (pédagogique : expliquer, pas conseiller). */
  function detail(id, ind, periode, extra) {
    const n = ind.net, pr = ind.pratiques, ec = ind.echeance;
    let titre, lignes = [], note = "", route, label, question;
    if (id === "net") {
      titre = "Patrimoine net"; route = R.comptes; label = "Voir mes comptes";
      question = "Explique-moi la composition de mon patrimoine net dans Boussole et ce qui l'a fait varier récemment.";
      note = n.enAttente ? "La variation est en cours de calcul : Boussole lit l'historique des cours pour reconstituer le passé."
        : n.variation == null ? "La variation apparaîtra après la première photo nocturne du patrimoine."
        : "Variation " + periodeTxt(periode) + " : " + eurS(n.variation) + (n.reconstitue ? ". Le début de la période est reconstitué à partir des cours et de tes comptes, avant ta première photo." : ".") + " Estimation : placements de chaque photo, immobilier, autres biens et dettes d'aujourd'hui.";
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
      if (jal && jal.enveloppe && !/^(foyer|donation:|credit:|bien:)/.test(jal.enveloppe) && ec.enveloppeALignes !== false) { route = lienFiche({ enveloppe: plat(jal.enveloppe_nom) || plat(jal.enveloppe), titulaire: jal.titulaire }); label = "Voir l'enveloppe"; }
      question = "Passons en revue mes prochaines échéances (calendrier patrimonial, objectifs datés) dans Boussole.";
      lignes = ec.liste.slice(0, 4).map(e => [extrait(e.titre, 70), dateFr(e.date) + " · " + quand(e).toLowerCase()]);
      if (!lignes.length) lignes.push(["Échéances à venir", "aucune"]);
      if (lignes.length < 2) lignes.push(["Objectifs datés", "dans Objectifs"]);
      note = "Dates tirées du calendrier de tes enveloppes, de tes objectifs, des échéances enregistrées et des points que Claude doit reprendre avec toi.";
    }
    return { titre, contenu: (id === "net" ? compositionHtml(n, rendementPanneau(n.rendement, extra && extra.rendement)) : '<ul class="aj-det">' + lignes.slice(0, 4).map(l => ligne(l[0], l[1])).join("") + "</ul>") +
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
      const approx = j.confiance === "approchee", mot = motConfiance(j);
      // lecteur d'écran : une seule fois le mot de confiance (« Date au plus tard le … », « Date … , date exacte »)
      const lecture = approx ? "Date " + (mot === "dès cette date" ? "dès le" : mot + " le") + " " + dateNum(j.date) : "Date " + dateNum(j.date) + ", " + mot;
      const etat = (j.statut === "proche" ? puceH("surveiller", "Bientôt") : "") + (approx ? badge("approchée", "neutre") : "");
      const nom = nomEnv(j) + " · " + courtDe(j);
      return '<li class="aj-ech-it"><button type="button" class="aj-ech-l t-' + TON_ETAT[j.statut] + '" data-ech="' + esc(j.id) + '" aria-haspopup="dialog">' +
        '<span class="aj-ech-date"><time datetime="' + esc(j.date) + '">' + esc(FM().fmtDate(j.date)) + '</time><span class="aj-ech-delai">' + esc(j.delai) + "</span></span>" +
        '<span class="aj-ech-txt"><span class="aj-ech-nom" title="' + esc(nom) + '">' + esc(nom) + '</span><span class="aj-ech-eff" title="' + esc(j.effet) + '">' + esc(j.effet) + "</span></span>" +
        '<span class="aj-ech-etat">' + etat + "</span>" +
        '<span class="aj-ech-ouvrir" aria-hidden="true">' + CHEVRON_DROITE + "</span>" +
        '<span class="ui-sr">' + esc(lecture + ". Ouvre le détail.") + "</span></button></li>";
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
    return '<ol class="aj-ech-liste" role="list" aria-label="Prochaines échéances, par date">' + c.prochains.map(ligne).join("") + "</ol>" +
      (c.nPlus ? '<p class="aj-ech-note">' + esc("Et " + pluriel(c.nPlus, "autre") + " plus tard.") + "</p>" : "") + pied + dispo;
  }
  /** Vrai si l'enveloppe du jalon (nom, et titulaire s'il est connu) a au moins une ligne non clôturée dans l'état S : la fiche de
      Patrimoine › Comptes existe (même règle que ComptesView.ficheEnveloppe). */
  function enveloppeALignes(S, j) {
    const nom = plat(j.enveloppe_nom) || plat(j.enveloppe).replace(/\|p[12]$/, "");
    return (S && Array.isArray(S.positions) ? S.positions : []).some(p => p && p.status !== "clôturé" && plat(p.envelope) === nom && (!j.titulaire || p.owner === j.titulaire));
  }
  /** Panneau d'un jalon : l'effet d'abord, puis « Comment c'est calculé » (calcul, donnée et sa source, règle et sa source datée, confiance),
      la mention fixe. → { titre, contenu, lien?, question } ; contenu échappé. */
  function jalonDetail(j, S) {
    const d = j.donnee, src = j.source || {};
    const lignes = [];
    if (j.calcul) lignes.push(ligne("Calcul", j.calcul));
    lignes.push(ligne("Date", dateLongue(j.date) + " (" + motConfiance(j) + ")"));
    if (d) lignes.push(ligne("Donnée", [d.source, d.le ? "relevée le " + dateNum(d.le) : ""].filter(Boolean).join(", ") || d.champ));
    const url = httpsOk(src.url) ? '<a href="' + esc(src.url) + '" target="_blank" rel="noopener noreferrer">' + esc(src.titre || src.url) + '<span class="ui-sr"> (nouvel onglet)</span></a>' : esc(src.titre || "");
    const regle = src.titre || src.url ? '<li><span class="aj-det-l">Règle</span><span class="aj-det-v">' + url + (src.verifie_le ? "<br>vérifiée le " + esc(dateNum(src.verifie_le)) : "") + "</span></li>" : "";
    const avert = liste_a(j.avertissements);
    const calcul = '<ul class="aj-det aj-det-pile">' + lignes.join("") + regle + "</ul>" + avert;
    // « Voir l'enveloppe » seulement si l'enveloppe a des lignes (sinon la fiche répondrait « compte introuvable »). Sans état (S), on ne peut pas savoir : lien gardé.
    const environ = j.enveloppe && !/^(foyer|donation:|credit:|bien:)/.test(j.enveloppe) && (S == null || enveloppeALignes(S, j));
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
  const TYPE_TXT = { proposition: "Proposition de Claude", journal: "Note de Claude", routine: "Revue mensuelle", banque: "Banque connectée", argent: "Argent qui dort", risque: "Profil de risque", doublon: "Doublon probable", alerte: "Alerte", a_suivre: "Point à reprendre", echeance: "Échéance", cours: "Mise à jour des cours" };
  const URG_TXT = { 1: "urgent", 2: "à traiter", 3: "à surveiller" };
  const ico = t => '<svg class="aj-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICO[t] + "</svg>";

  /** Libellé visible court de l'action (« Répondre », « Voir ») : le nom accessible garde le libellé complet (aria-label). */
  function libelleCourt(label) {
    const l = plat(label).replace(/ avec Claude$/, "");
    if (/^Voir (comment|l'échéance)/.test(l) && l === "Voir comment") return l;
    if (/^Voir /.test(l)) return "Voir";
    return l.length > 14 ? l.split(" ")[0] : l;
  }
  function actionHtml(a) {
    if (!a || !a.label) return "";
    const court = libelleCourt(a.label), aria = court !== plat(a.label) ? ' aria-label="' + esc(plat(a.label)) + '"' : "";
    if (a.url) return httpsOk(a.url) ? '<a class="ui-item-action aj-act" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer"' + aria + "><span>" + esc(court) + '</span><span class="ui-sr"> (nouvel onglet)</span></a>' : "";
    return a.route ? '<a class="ui-item-action aj-act" href="#' + esc(a.route) + '" data-goto="' + esc(a.route) + '"' + aria + "><span>" + esc(court) + "</span></a>" : "";
  }
  /** Élément d'« À traiter » (grammaire de UI.aTraiter) : icône de type, titre (2 lignes au plus), raison (2 lignes au plus, texte complet au survol),
      action courte à droite. La priorité est donnée par l'ordre ; la puce « Bloquant » n'apparaît que pour une banque à reconnecter. */
  function itemHtml(x) {
    const t = TYPE_TXT[x.type] ? x.type : "alerte", u = URG_TXT[x.urgence] ? +x.urgence : 3, bloquant = t === "banque" && u === 1;
    return '<li class="aj-it ui-item' + (bloquant ? " urgent" : "") + '" data-type="' + t + '">' +
      '<span class="ui-ligne-ico aj-pic" aria-hidden="true">' + ico(t) + "</span>" +
      '<div class="ui-ligne-corps aj-txt">' + (bloquant ? '<span class="ui-item-meta">' + puceH("travailler", "Bloquant") + "</span>" : "") +
      '<p class="aj-t"><span class="ui-sr">' + esc(TYPE_TXT[t] + ", " + URG_TXT[u] + " : ") + "</span>" + esc(x.titre) + "</p>" +
      (x.contexte ? '<p class="aj-c" title="' + esc(x.contexte) + '">' + esc(x.contexte) + "</p>" : "") + "</div>" +
      actionHtml(x.action) + "</li>";
  }
  /** Phrase prête de « Faire le point avec Claude » : la revue du mois de l'agent (ClaudePrompts.phrase("revue"), via RoutineEtat). */
  function phraseRevue() { return RE().phraseRevue(); }
  /** Liste de la boîte de réception (<ul>/<li>) : 5 éléments puis « Voir plus » (UI.voirPlus, clé fixe : un bloc déplié le reste
      quand la liste change) ; vide : « Rien à traiter. » et « Faire le point avec Claude » (revue du mois). */
  function boiteHtml(items, U, n) {
    if (!items || !items.length) return '<div class="aj-vide"><p class="aj-vide-t">Rien à traiter.</p>' +
      '<p class="aj-vide-x">Aucune proposition, alerte ni échéance proche. Pour un regard d\'ensemble, fais le point avec Claude.</p>' +
      U.demanderAClaude(phraseRevue(), "Faire le point avec Claude") + "</div>";
    return U.voirPlus(items, n > 0 ? n : 3, itemHtml, "Voir les autres", "ul", "aj-boite");
  }

  /* ---------- période de la frise : mémorisée, granularité seulement si l'utilisateur l'a choisie ---------- */
  /** Période relue du stockage local (JSON ou objet) et ce qui s'enregistre : voir SerieNet (la période est partagée avec Patrimoine › Comptes). */
  const lirePeriode = brut => SN().lirePeriode(brut);
  const periodeAEnregistrer = (periode, gChoisie) => SN().periodeAEnregistrer(periode, gChoisie);

  const H = { boite, elementArgentQuiDort, etatRevue, echeances, calendrierDe, prochainesHtml, jalonDetail, aCompleterDetail, calendrierDetail, contexteACompleter, indicateurs, frise, reperesJournal, urlClaude, cartes, detail, repereDetail, boiteHtml, phraseRevue, objectifs, compteARebours, jour, delai, premiereDate,
    lirePeriode, periodeAEnregistrer };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =============================================================== vue =============================================================== */
  /* items (boîte) est calculé à chaque émission du store : headline() en dépend pour la pastille. ind (indicateurs et passé du graphe)
     ne l'est qu'au rendu, quand la vue est visible. sigX : dernier HTML écrit ; rien n'est réécrit (ni le focus perdu,
     ni un « Voir plus » replié) quand il n'a pas changé. */
  let S = null, root = null, dirty = true, items = [], ind = null;
  const sig = { boite: "", ech: "", cartes: "" };
  /* La variation de la carte « Patrimoine net » se lit sur 1 an (la période n'est plus un réglage du graphe : le graphe maître a sa propre fenêtre). */
  const periode = { id: "1a" }; let animer = true;
  SN().definirPeriode(periode);
  /* Passé reconstitué : données lues à la demande (cours, transactions, opérations bancaires) par SerieNet, dont l'état est partagé avec
     Patrimoine › Comptes (même passé, même variation, au même moment). */
  const hist = SN().hist;
  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const scopeLabel = () => {
    if (!S || !S.scope || S.scope === "foyer") return "du foyer";
    const p = (S.people || []).find(x => x.id === S.scope), C = window.Calc;
    return C && C.deNom ? C.deNom(p && p.nom, S.scope === "p2" ? 2 : 1) : "";
  };
  const reduit = () => { try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } };

  /* Éléments visibles de « À traiter » avant « Voir les autres » : 3 sur mobile, 5 dans la colonne de droite (≥ 1240 px, voir aujourdhui.css). */
  const COLONNE = "(min-width: 1240px)";
  const nBoite = () => { try { return window.matchMedia && window.matchMedia(COLONNE).matches ? 5 : 3; } catch (e) { return 3; } };

  /** Passé reconstitué pour l'état courant du store (mémorisé par SerieNet). */
  const reconstitution = () => SN().reconstitution(S, jour(), null);
  /* deps des indicateurs : passé reconstitué, et `enAttente` tant que sa lecture n'est pas finie (la variation est alors un squelette). */
  const depsVue = () => ({ reconstitue: reconstitution(), enAttente: SN().enAttente(S, null) });

  /* Lit tout le passé utile au graphe maître (cours, transactions, opérations bancaires : SerieNet.charger, période « tout », 5 ans au plus) ; la fin d'une lecture
     réaffiche la page (abonnement posé au mount). */
  function chargerHistorique() { SN().charger(S, jour(), { id: "tout" }, null); }
  /* Une lecture vient de finir : la page se redessine (ou se redessinera à l'affichage), le graphe est recalculé avec son passé. */
  function histPrete() {
    if (!root || !S) return;
    if (!root.hidden) { ind = indicateurs(S, jour(), periode, depsVue()); renderCartes(); lancerGraphe(); } else dirty = true;
  }

  function render() {
    const u = U();
    if (!root || !S || !u) return;
    ind = indicateurs(S, jour(), periode, depsVue());
    renderCartes();
    renderEcheances(u);
    // Même contenu : on ne réécrit pas la liste (une émission du store ne replie pas un « Voir plus » déplié).
    const nb = nBoite(), sg = nb + JSON.stringify(items);
    if (sg !== sig.boite) { sig.boite = sg; $("ajBoite").innerHTML = boiteHtml(items, u, nb); }
    // Nombre d'éléments pour les lecteurs d'écran seulement (règle 9 : les compteurs visibles sont dans la navigation).
    const n = items.length ? pluriel(items.length, "élément") + " à traiter" : "";
    if ($("ajBoiteN").textContent !== n) $("ajBoiteN").textContent = n;
    chargerHistorique();
    lancerGraphe();
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
  /* Première apparition des cartes : les anneaux se tracent (transition CSS du trait), c'est tout. Aucun chiffre ne défile (un chiffre qui
     compte paraît inventé) ; jamais avec prefers-reduced-motion. */
  function animerCartes() {
    const zone = $("ajCartes");
    if (reduit() || typeof requestAnimationFrame !== "function" || !zone.querySelectorAll) return;
    const arcs = Array.from(zone.querySelectorAll("[data-aj-off]"));
    arcs.forEach(a => { if (a.style) a.style.strokeDashoffset = String(CIRC); });
    if (arcs.length && arcs[0].getBoundingClientRect) arcs[0].getBoundingClientRect(); // fixe l'état de départ avant la transition
    requestAnimationFrame(() => arcs.forEach(a => { if (a.style) a.style.strokeDashoffset = a.getAttribute("data-aj-off"); }));
  }

  /* ---------- graphe maître : composant GraphePatrimoine relié au moteur par GrapheModele.brancher (un seul moteur, Projection.executer) ---------- */
  let liaison = null, pleinDemande = false;
  const GM = () => glob("GrapheModele") || voisin("GrapheModele", "./graphe-modele.js");
  /* Monte le graphe une fois ; le recalcul n'a lieu que si ce qui compte a changé (store, périmètre, passé lu, réglages) : une émission du store sans effet ne redessine rien. */
  function lancerGraphe() {
    const Mo = GM(), el = $("ajGraphe");
    if (!root || !S || !Mo || !el) return;
    if (!liaison) liaison = Mo.brancher(el, { preset: "aujourdhui", deps: { UI: U() }, today: () => jour(), perimetre: () => scopeLabel(), store: window.Store || null,
      enAttente: snap => SN().enAttente(snap, null) });
    if (!liaison) return;
    if (pleinDemande) { pleinDemande = false; liaison.pleinEcranQuandPret(); } // lien profond #aujourdhui?graphe=plein-ecran
    liaison.actualiser(S);
  }

  /* Carte → panneau de détail (le lien interne du pied ferme le panneau puis la coque suit le hash). Le focus revient à la carte,
     ou à la carte du même id si un rendu l'a remplacée entre-temps. */
  function ouvrirCarte(id, el) {
    const u = U(); if (!u || !u.panneau || !ind) return;
    const d = detail(id, ind, periode, { rendement: liaison && typeof liaison.rendement === "function" ? liaison.rendement() : null });
    u.panneau.ouvrir({ titre: d.titre, contenu: d.contenu, lien: d.lien, pied: u.demanderAClaude(d.question), retour: el,
      surFermeture: () => { if (el && !el.isConnected) { const c = root.querySelector('[data-ui-carte="' + id + '"]'); if (c) c.focus(); } } });
  }

  /* Jalon du calendrier → panneau (effet, « Comment c'est calculé », sources) ; focus rendu au bouton, ou à celui du même jalon si la carte a été redessinée. */
  function ouvrirJalon(el) {
    const u = U(); if (!u || !u.panneau || !ind || !ind.calendrier) return;
    const id = el.getAttribute("data-ech"), j = ind.calendrier.jalons.find(x => x.id === id);
    if (!j) return;
    const d = jalonDetail(j, S);
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

  function mount(r) {
    root = r;
    const u = U();
    SN().abonner(histPrete); // fin d'une lecture du passé (déclenchée ici ou par Patrimoine › Comptes)
    $("ajEch").addEventListener("click", e => {
      const t = e.target && e.target.closest ? e.target : null;
      const b = t && t.closest("[data-ech]"), c = t && t.closest("[data-ech-completer]");
      if (b) ouvrirJalon(b); else if (c) ouvrirACompleter(c);
    });
    try { const mq = window.matchMedia(COLONNE), re = () => { if (root && !root.hidden && S && ind) render(); }; if (mq.addEventListener) mq.addEventListener("change", re); } catch (e) {}
    if (u && u.brancher) u.brancher(root, { surCarte: ouvrirCarte }); // cartes et « Voir plus » de la boîte de réception
  }
  function update(snap, visible) {
    S = snap;
    enLot(() => { // boîte et indicateurs du rendu partagent un seul calcul du calendrier
      items = boite(S, jour(), { aujRevue: RE().aujParis() }); // revue au jour de Paris, comme le serveur, et le reste aussi (jour())
      dirty = true;
      if (visible) { render(); dirty = false; }
    });
  }
  function show() {
    const p = window.App && typeof App.parametres === "function" ? App.parametres() : {};
    if (p && p.echeances) ouvrirCalendrierComplet = true;
    if (p && p.graphe === "plein-ecran") pleinDemande = true;
    if (dirty) { render(); dirty = false; } else lienProfond();
  }
  /* Pastille de la navigation : nombre d'éléments de la boîte de réception (ne dépend que de `items`) ; vide quand il n'y en a pas. */
  function headline() { return items.length ? String(items.length) : ""; }

  const api = { mount, update, show, headline };
  const reg = () => App.register("aujourdhui", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
