/* Agent › Journal : l'historique des décisions du foyer (« le board lit, l'agent écrit »).
   S.journal = [{ id, type: avis|decision|scenario|revue|hypothese|evenement, titre, synthese, raisonnement (markdown),
     options: [{ titre, retenue, pourquoi }], statut: a_relire|actif|realise|abandonne|archive, dateDecision, revueLe,
     liens: { objectifs, positions, biens, credits }, etat (état du patrimoine figé à l'écriture, ou { date, indisponible: true }),
     source, historique: [{ le, champ, avant, apres } | { le, champ: "raisonnement", ajout }], creeLe, majLe }] (plus récentes d'abord) ;
   S.journalConsentement = demander | prevenir | jamais ; S.journalARelire = nombre exact d'entrées à relire (pastille).
   Lien profond : #agent/journal?entree=<id> (la coque retient le paramètre, App.parametres()) ouvre l'entrée au show().
   Actions : Store.journal.confirmer(ids), .modifier(id, patch), .supprimer(ids), .consentement(mode) → { ok: true } ou { erreur }.
   Page : consentement (bascule + phrase), filtres (statut, type), liste groupée par mois en cartes UI.carte (5 par mois puis
   « Voir plus »), panneau de détail UI.panneau (synthèse, raisonnement, options, « au moment / aujourd'hui », liens, historique,
   actions selon le statut, « Reprendre avec Claude »).
   Fonctions pures exportées pour les tests : filtrer, grouperParMois, comparaison, libelleHistorique, rendreMarkdown, listeHtml,
   detailHtml, actionsPour, questionClaude, patchCorrection, nARelire, statutParDefaut, typesPresents, optionsStatut, CONSENTEMENTS.
   Dépendances de calcul injectées (deps) : { Calc, Pratiques, Risque } ; window.* par défaut. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : glob(k));

  /* ---------- libellés ---------- */
  const TYPES = { decision: "Décision", avis: "Avis", scenario: "Scénario", revue: "Revue", hypothese: "Hypothèse", evenement: "Événement" };
  const TYPES_PL = { decision: "Décisions", avis: "Avis", scenario: "Scénarios", revue: "Revues", hypothese: "Hypothèses", evenement: "Événements" };
  const ORDRE_TYPES = ["decision", "avis", "scenario", "revue", "hypothese", "evenement"];
  const STATUTS = { a_relire: "À relire", actif: "En cours", realise: "Réalisé", abandonne: "Abandonné", archive: "Archivé" };
  const TON_STATUT = { a_relire: "attention", actif: "info", realise: "bon", abandonne: "neutre", archive: "neutre" };
  const CONSENTEMENTS = [
    { id: "demander", label: "Me demander",
      texte: "Avant d'enregistrer quoi que ce soit, l'agent te demande ton accord dans la conversation. Chaque entrée arrive ici « à relire »." },
    { id: "prevenir", label: "Enregistrer et me prévenir",
      texte: "L'agent enregistre ses avis et tes décisions sans t'interrompre, puis te le dit. Chaque entrée arrive ici « à relire »." },
    { id: "jamais", label: "Jamais",
      texte: "L'agent n'enregistre plus rien dans ton journal. Les entrées déjà écrites restent ici, consultables et modifiables." },
  ];
  const CHAMPS = { type: "Type", titre: "Titre", synthese: "Synthèse", raisonnement: "Raisonnement", statut: "Statut",
    date_decision: "Date de décision", revue_le: "Date de revue", options: "Options", liens: "Liens" };
  const LIENS = [
    { cle: "objectifs", label: "Objectif", route: "patrimoine/objectifs", liste: S => S.objectifs, nom: x => x.nom },
    { cle: "positions", label: "Placement", route: "patrimoine/placements", liste: S => S.positions, nom: x => x.name || x.nom },
    { cle: "biens", label: "Bien", route: "patrimoine/immobilier", liste: S => S.profil && S.profil.biens, nom: x => x.nom },
    { cle: "credits", label: "Crédit", route: "patrimoine/immobilier", liste: S => S.profil && S.profil.credits, nom: x => x.nom },
  ];
  const REPERES = { livret_a_taux: "Taux du Livret A", pfu_taux: "Prélèvement forfaitaire unique" };
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

  /* ---------- dates, nombres, textes ---------- */
  const pad = n => String(n).padStart(2, "0");
  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  /** Date locale AAAA-MM-JJ ; une date seule passe telle quelle, un horodatage est lu en heure locale ; "" si illisible. */
  function jour(d) {
    if (d == null || d === "") return "";
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const x = new Date(d);
    if (!isFinite(x)) return "";
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }
  const aujourdhui = () => jour(new Date());
  const dateFr = s => { const j = jour(s); return j ? new Date(j + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : ""; };
  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const fini = v => v != null && v !== "" && isFinite(+v);
  const eur = v => (Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €";
  const eurS = v => (Math.round(v) > 0 ? "+" : Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €";
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const extrait = (t, n) => { const s = plat(t); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const maj = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const objet = v => !!v && typeof v === "object" && !Array.isArray(v);

  /* =============================================================== filtres et groupes =============================================================== */
  /** Entrées du type et du statut demandés ("tout" ou vide : sans filtre ; "en_cours" = "actif"), dans l'ordre reçu. */
  function filtrer(journal, type, statut) {
    const t = !type || type === "tout" ? null : type;
    const s = !statut || statut === "tout" ? null : statut === "en_cours" ? "actif" : statut;
    return (Array.isArray(journal) ? journal : []).filter(e => e && (!t || e.type === t) && (!s || e.statut === s));
  }
  const nARelire = journal => filtrer(journal, "tout", "a_relire").length;
  /** Filtre de statut par défaut : « À relire » s'il y en a, sinon « Tout ». */
  const statutParDefaut = journal => (nARelire(journal) ? "a_relire" : "tout");

  /** Date de référence d'une entrée : date de décision, sinon jour d'écriture ("" si aucune). */
  const dateRef = e => (isoOk(e && e.dateDecision) ? e.dateDecision : jour(e && e.creeLe));

  /** Groupes par mois, les plus récents d'abord : [{ cle: "2026-10", titre: "Octobre 2026", entrees }] ; entrées sans date à la fin. */
  function grouperParMois(journal) {
    const xs = (Array.isArray(journal) ? journal : []).filter(Boolean).map((e, i) => ({ e, i, d: dateRef(e), c: String(e.creeLe || "") }));
    xs.sort((a, b) => (a.d === b.d ? (a.c === b.c ? a.i - b.i : a.c < b.c ? 1 : -1) : !a.d ? 1 : !b.d ? -1 : a.d < b.d ? 1 : -1));
    const groupes = [];
    xs.forEach(x => {
      const cle = x.d ? x.d.slice(0, 7) : "sans-date";
      let g = groupes[groupes.length - 1];
      if (!g || g.cle !== cle) {
        g = { cle, titre: x.d ? maj(MOIS[+x.d.slice(5, 7) - 1]) + " " + x.d.slice(0, 4) : "Sans date", entrees: [] };
        groupes.push(g);
      }
      g.entrees.push(x.e);
    });
    return groupes;
  }

  /* =============================================================== comparaison =============================================================== */
  const idProfil = p => (p == null ? null : typeof p === "object" ? p.id || null : String(p));
  const fPratiques = bp => (objet(bp) && fini(bp.total) ? Math.round(+bp.total) + " / 100" + (bp.provisoire ? " (provisoire)" : "") : "—");
  const fPts = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v) + (Math.abs(v) >= 2 ? " pts" : " pt");

  /** Lignes « Au moment de la décision / Aujourd'hui » : patrimoine net, bonnes pratiques, profil déclaré, profil équivalent du
      portefeuille (s'il est connu), repères chiffrés (Livret A, PFU). Valeurs déjà formatées ; null = inconnue.
      → { disponible, date, lignes: [{ cle, label, moment, aujourdhui, ecart, change }] }. Périmètre : foyer (comme l'état figé). */
  function comparaison(etat, S, deps) {
    const s = S || {}, et = objet(etat) ? etat : {};
    const disponible = !et.indisponible && Object.keys(et).some(k => k !== "date");
    const m = disponible ? et : {};
    const C = dep(deps, "Calc"), Pr = dep(deps, "Pratiques"), Ri = dep(deps, "Risque");
    const positions = Array.isArray(s.positions) ? s.positions : [];
    const lignes = [];
    const ligne = (cle, label, moment, auj, ecart) => lignes.push({ cle, label, moment, aujourdhui: auj, ecart: ecart == null ? null : ecart,
      change: moment != null && auj != null && moment !== auj });

    // Patrimoine net (Calc.patrimoine, comme Aujourd'hui)
    let net = null;
    if (C && typeof C.patrimoine === "function") { try { const p = C.patrimoine(positions, s.profil || null, "foyer"); net = p && fini(p.net) ? +p.net : null; } catch (e) { net = null; } }
    const netM = fini(m.patrimoine_net) ? +m.patrimoine_net : null;
    ligne("net", "Patrimoine net", netM == null ? null : eur(netM), net == null ? null : eur(net), netM != null && net != null && Math.round(net - netM) !== 0 ? eurS(net - netM) : null);

    // Bonnes pratiques (Pratiques.evaluer, comme Aujourd'hui)
    let bp = null;
    if (Pr && typeof Pr.evaluer === "function") {
      try { bp = Pr.evaluer({ positions, profil: s.profil || null, config: s.config || null, budget: s.budget || null, objectifs: s.objectifs || [], scope: "foyer",
        risque: s.risque || null, classes: s.classes || {}, today: new Date(aujourdhui() + "T12:00:00") }); } catch (e) { bp = null; }
    }
    const bpM = disponible ? fPratiques(m.bonnes_pratiques) : null;
    const bpA = bp ? fPratiques(bp) : null;
    const ecBp = objet(m.bonnes_pratiques) && fini(m.bonnes_pratiques.total) && bp && fini(bp.total) ? Math.round(+bp.total) - Math.round(+m.bonnes_pratiques.total) : null;
    ligne("pratiques", "Bonnes pratiques", bpM, bpA, !ecBp ? null : fPts(ecBp));

    // Profil de risque déclaré (S.risque) et profil équivalent du portefeuille (Risque.risquePortefeuille)
    const profils = Ri && Array.isArray(Ri.PROFILS) ? Ri.PROFILS : [];
    const lib = id => { const p = profils.find(x => x.id === id); return p ? p.label : null; };
    const libM = p => (objet(p) ? p.libelle || lib(p.id) || p.id || "non renseigné" : "non renseigné");
    const idDecl = s.risque ? idProfil(s.risque.profil) : null;
    ligne("profil", "Profil de risque", disponible ? libM(m.profil_declare) : null, idDecl ? lib(idDecl) || idDecl : Ri ? "non renseigné" : null);
    let eq = null;
    if (Ri && typeof Ri.risquePortefeuille === "function" && positions.length) {
      try { eq = lib(Ri.risquePortefeuille(positions, "foyer", { surcharge: s.classes || {} }).profilEquivalent); } catch (e) { eq = null; }
    }
    if (objet(m.profil_equivalent) || eq) ligne("equivalent", "Profil équivalent du portefeuille", disponible ? libM(m.profil_equivalent) : null, eq);

    // Repères chiffrés : ceux figés dans l'état et ceux connus aujourd'hui (S.savoir.reperes)
    const reps = s.savoir && Array.isArray(s.savoir.reperes) ? s.savoir.reperes : [];
    const repM = objet(m.reperes) ? m.reperes : {};
    Object.keys(REPERES).concat(Object.keys(repM).filter(k => !REPERES[k])).forEach(cle => {
      const r = reps.find(x => x && x.cle === cle) || null, rm = objet(repM[cle]) ? repM[cle] : null;
      if (!r && !rm) return;
      const unite = r && r.unite ? r.unite : "%";
      const f = v => (fini(v) ? nf2.format(+v) + " " + unite : null);
      ligne(cle, r && r.libelle ? r.libelle : REPERES[cle] || cle, rm ? f(rm.valeur) : null, r ? f(r.valeur) : null);
    });

    return { disponible, date: isoOk(et.date) ? et.date : jour(et.date) || null, lignes };
  }

  /* =============================================================== historique =============================================================== */
  const valeurHist = (champ, v) => {
    if (champ === "statut") return STATUTS[v] || plat(v) || "aucun";
    if (champ === "type") return TYPES[v] || plat(v) || "aucun";
    if (champ === "date_decision" || champ === "revue_le") return v ? dateFr(v) || plat(v) : "aucune";
    return v == null || plat(v) === "" ? "vide" : "« " + extrait(v, 80) + " »";
  };
  /** Une modification de l'historique en clair : { date: « 8 oct. 2026 », texte: « Statut : En cours → Réalisé » }. */
  function libelleHistorique(h) {
    if (!objet(h)) return { date: "", texte: "Modification" };
    const date = dateFr(h.le);
    const champ = String(h.champ || "");
    if (champ === "raisonnement" && h.ajout != null) return { date, texte: "Note ajoutée au raisonnement : « " + extrait(h.ajout, 160) + " »" };
    if (champ === "raisonnement") return { date, texte: "Raisonnement réécrit" };
    if (champ === "options") return { date, texte: "Options modifiées" };
    if (champ === "liens") return { date, texte: "Liens modifiés" };
    if (!CHAMPS[champ]) return { date, texte: "Champ « " + (champ || "inconnu") + " » modifié" };
    return { date, texte: CHAMPS[champ] + " : " + valeurHist(champ, h.avant) + " → " + valeurHist(champ, h.apres) };
  }

  /* =============================================================== markdown limité, sûr =============================================================== */
  /* Même balisage que Fiches (fiches-view.js, non exposé globalement) : tout le HTML est échappé AVANT de reconnaître
     « ## », « ### », listes « - » et « 1. », **gras**, [texte](https://…) ; aucun autre balisage n'est produit. */
  const gras = t => t.replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  function enLigne(t) { // t est déjà échappé : l'URL capturée ne contient ni guillemet ni chevron
    const re = /\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(t))) {
      out += gras(t.slice(last, m.index)) + '<a href="' + m[2] + '" target="_blank" rel="noopener noreferrer">' + gras(m[1]) + '<span class="ui-sr"> (nouvel onglet)</span></a>';
      last = re.lastIndex;
    }
    return out + gras(t.slice(last));
  }
  function rendreMarkdown(md) {
    if (md == null) return "";
    const lignes = esc(String(md)).replace(/\r\n?/g, "\n").split("\n");
    let out = "", para = [], liste = [], typeListe = "ul";
    const finPara = () => { if (para.length) out += "<p>" + enLigne(para.join(" ")) + "</p>"; para = []; };
    const finListe = () => { if (liste.length) out += "<" + typeListe + ">" + liste.map(x => "<li>" + enLigne(x) + "</li>").join("") + "</" + typeListe + ">"; liste = []; };
    const item = (type, texte) => { finPara(); if (typeListe !== type) { finListe(); typeListe = type; } liste.push(texte); };
    for (const brute of lignes) {
      const l = brute.trim();
      let m;
      if (!l) { finPara(); finListe(); continue; }
      if ((m = /^###\s+(.+)$/.exec(l))) { finPara(); finListe(); out += "<h4>" + enLigne(m[1]) + "</h4>"; continue; }
      if ((m = /^##\s+(.+)$/.exec(l))) { finPara(); finListe(); out += "<h3>" + enLigne(m[1]) + "</h3>"; continue; }
      if ((m = /^-\s+(.+)$/.exec(l))) { item("ul", m[1]); continue; }
      if ((m = /^\d+\.\s+(.+)$/.exec(l))) { item("ol", m[1]); continue; }
      finListe(); para.push(l);
    }
    finPara(); finListe();
    return out;
  }

  /* =============================================================== rendus HTML =============================================================== */
  const typeTxt = e => TYPES[e && e.type] || "Entrée";
  const quandTxt = e => (isoOk(e.dateDecision) ? "décidé le " + dateFr(e.dateDecision) : e.creeLe ? "écrit le " + dateFr(e.creeLe) : "");
  const badgeStatut = st => ({ texte: STATUTS[st] || plat(st) || "—", ton: TON_STATUT[st] || "neutre" });

  /** Une carte d'entrée (UI.carte échappe chaque champ) dans un <li> de la frise ; « à relire » mis en évidence. */
  function carteHtml(e, U) {
    const d = dateRef(e);
    return '<li class="jv-it' + (e.statut === "a_relire" ? " is-relire" : "") + '" data-jv-entree="' + esc(e.id) + '">' +
      U.carte({ id: e.id, titre: typeTxt(e) + (d ? " · " + dateFr(d) : ""), valeur: plat(e.titre) || "Sans titre", sous: extrait(e.synthese, 150), badge: badgeStatut(e.statut) }) +
      "</li>";
  }
  /** Liste groupée par mois : un en-tête par mois, puis 5 cartes et « Voir plus ». */
  function listeHtml(groupes, U) {
    return (groupes || []).map(g => '<section class="jv-mois" aria-labelledby="jv-m-' + esc(g.cle) + '">' +
      '<h3 class="jv-mois-t" id="jv-m-' + esc(g.cle) + '">' + esc(g.titre) + "</h3>" +
      U.voirPlus(g.entrees, 5, e => carteHtml(e, U), "Voir plus", "ul", "jv-" + g.cle) + "</section>").join("");
  }

  const ACTIONS = {
    a_relire: ["confirmer", "corriger", "supprimer"],
    actif: ["realise", "abandonner", "corriger", "archiver", "supprimer"],
    realise: ["archiver", "corriger", "supprimer"],
    abandonne: ["archiver", "corriger", "supprimer"],
    archive: ["corriger", "supprimer"],
  };
  const LIB_ACTIONS = { confirmer: "Confirmer", corriger: "Corriger", realise: "Marquer réalisé", abandonner: "Abandonner", archiver: "Archiver", supprimer: "Supprimer" };
  /** Actions proposées selon le statut ; « Confirmer » seulement pour une entrée à relire. */
  const actionsPour = st => (ACTIONS[st] || ["corriger", "supprimer"]).slice();

  /** Question préremplie de « Reprendre avec Claude » : cite le titre de l'entrée. */
  function questionClaude(e) {
    const d = dateRef(e);
    return "Reprenons l'entrée « " + plat(e && e.titre) + " » de mon journal Boussole (" + typeTxt(e).toLowerCase() + (d ? " du " + dateFr(d) : "") +
      ") : qu'est-ce qui a changé depuis, et où en est-on ?";
  }

  /** Objets liés à l'entrée, noms résolus depuis S : [{ label, nom, route | null }] (objet disparu : « élément supprimé », sans lien). */
  function liensDe(e, S) {
    const l = objet(e && e.liens) ? e.liens : {}, s = S || {}, out = [];
    LIENS.forEach(d => {
      const ids = Array.isArray(l[d.cle]) ? l[d.cle] : [];
      const liste = d.liste(s);
      ids.forEach(id => {
        const x = Array.isArray(liste) ? liste.find(o => o && String(o.id) === String(id)) : null;
        out.push(x ? { label: d.label, nom: plat(d.nom(x)) || "sans nom", route: d.route } : { label: d.label, nom: "élément supprimé", route: null });
      });
    });
    return out;
  }

  const blocTitre = t => '<h3 class="jv-d-t">' + esc(t) + "</h3>";
  function comparaisonHtml(c) {
    const date = c.date ? dateFr(c.date) : "";
    const lignes = c.lignes.map(l => '<tr' + (l.change ? ' class="is-change"' : "") + '><th scope="row">' + esc(l.label) + "</th>" +
      "<td>" + esc(l.moment == null ? "—" : l.moment) + "</td>" +
      "<td>" + esc(l.aujourdhui == null ? "—" : l.aujourdhui) + (l.ecart ? ' <span class="jv-ecart">' + esc(l.ecart) + "</span>" : "") + "</td></tr>").join("");
    return '<section class="jv-d jv-comp">' + blocTitre("Au moment de la décision et aujourd'hui") +
      (c.disponible ? "" : '<p class="jv-note">L\'état du patrimoine n\'a pas pu être figé au moment de l\'écriture : seules les valeurs d\'aujourd\'hui sont connues.</p>') +
      '<div class="jv-table-wrap"><table class="jv-table"><thead><tr><th scope="col"><span class="ui-sr">Indicateur</span></th>' +
      '<th scope="col">Au moment' + (date ? '<span class="jv-th-date">' + esc(date) + "</span>" : "") + '</th><th scope="col">Aujourd\'hui</th></tr></thead>' +
      "<tbody>" + lignes + "</tbody></table></div>" +
      '<p class="jv-note">Patrimoine du foyer. Les écarts décrivent ce qui a changé, sans jugement : à relire avec le raisonnement de l\'époque.</p></section>';
  }

  /** Statuts proposés dans « Corriger » : « À relire » seulement pour une entrée encore à relire (une entrée confirmée n'y revient pas). */
  const optionsStatut = actuel => Object.keys(STATUTS).filter(k => k !== "a_relire" || actuel === "a_relire").map(k => ({ id: k, label: STATUTS[k] }));
  /* Choix du statut : boutons segmentés UI.bascule (HTML rendu par UI.htmlBascule, comportement branché par la vue). */
  function statutHtml(ed, actuel, U) {
    const o = { label: "Statut", options: optionsStatut(actuel), actif: ed.statut };
    return U && typeof U.htmlBascule === "function" ? U.htmlBascule(o)
      : o.options.map(x => '<button type="button" role="radio" data-ui-id="' + esc(x.id) + '" aria-checked="' + (x.id === ed.statut) + '">' + esc(x.label) + "</button>").join("");
  }
  function formHtml(ed, actuel, U) {
    /* Groupe de champs (pas de <form> : rien n'est envoyé, « Enregistrer » appelle Store.journal.modifier). */
    return '<div class="jv-form" role="group" data-jv-form aria-labelledby="jv-f-t">' +
      '<h3 class="jv-d-t" id="jv-f-t">Corriger l\'entrée</h3>' +
      '<label class="jv-lab" for="jv-f-titre">Titre</label>' +
      '<input class="jv-in" id="jv-f-titre" data-jv-champ="titre" type="text" maxlength="120" required value="' + esc(ed.titre) + '">' +
      '<label class="jv-lab" for="jv-f-synthese">Synthèse</label>' +
      '<textarea class="jv-in jv-ta" id="jv-f-synthese" data-jv-champ="synthese" maxlength="600" rows="4" required>' + esc(ed.synthese) + "</textarea>" +
      '<div class="jv-f-ligne"><div class="jv-f-col jv-f-col-statut"><p class="jv-lab" id="jv-f-statut-l">Statut</p>' +
      '<div class="jv-f-statut" id="jv-f-statut" data-jv-statut role="group" aria-labelledby="jv-f-statut-l">' + statutHtml(ed, actuel, U) + "</div></div>" +
      '<div class="jv-f-col"><label class="jv-lab" for="jv-f-revue">Date de revue <span class="jv-fac">(facultative)</span></label>' +
      '<input class="jv-in" type="date" id="jv-f-revue" data-jv-champ="revueLe" value="' + esc(ed.revueLe) + '"></div></div>' +
      '<p class="jv-note">Une fois l\'entrée confirmée, chaque correction est tracée dans son historique.</p>' +
      '<div class="jv-acts"><button type="button" class="jv-btn" data-jv-act="enregistrer">Enregistrer</button>' +
      '<button type="button" class="jv-btn ghost" data-jv-act="annuler">Annuler</button></div></div>';
  }

  function actionsHtml(e, busy) {
    const acts = actionsPour(e.statut), dis = busy ? " disabled" : "";
    const principal = acts[0] === "confirmer" || acts[0] === "realise" ? acts[0] : null;
    return '<div class="jv-acts" role="group" aria-label="Actions sur l\'entrée">' + acts.map(a =>
      '<button type="button" class="jv-btn' + (a === principal ? "" : a === "supprimer" ? " danger" : " ghost") + '" data-jv-act="' + a + '"' + dis + ">" + esc(LIB_ACTIONS[a]) + "</button>").join("") + "</div>";
  }

  /** Contenu du panneau de détail (HTML échappé). o = { deps, edition: { titre, synthese, statut, revueLe } | null, busy, message: { texte, ok } | null }. */
  function detailHtml(e, S, U, o) {
    const opt = o || {};
    const hist = Array.isArray(e.historique) ? e.historique : [];
    const ops = Array.isArray(e.options) ? e.options.filter(objet) : [];
    const liens = liensDe(e, S);
    const meta = [typeTxt(e), quandTxt(e), e.source ? "par " + plat(e.source) : "", e.revueLe ? "revue prévue le " + dateFr(e.revueLe) : ""].filter(Boolean).join(" · ");
    const b = badgeStatut(e.statut);
    let h = '<div class="jv-d-meta"><span class="ui-badge ' + esc(b.ton) + '">' + esc(b.texte) + '</span><span>' + esc(meta) + "</span></div>";
    if (e.statut === "a_relire") h += '<p class="jv-relire">Écrite par ' + esc(plat(e.source) || "l'agent") + " : relis-la. Confirme-la si elle reflète bien ce qui a été dit, corrige-la sinon.</p>";
    h += '<p class="jv-synthese">' + esc(e.synthese) + "</p>";
    if (opt.message && opt.message.texte) h += '<p class="jv-msg ' + (opt.message.ok ? "ok" : "err") + '" data-jv-msg tabindex="-1" role="' + (opt.message.ok ? "status" : "alert") + '">' + esc(opt.message.texte) + "</p>";
    h += opt.edition ? formHtml(opt.edition, e.statut, U) : actionsHtml(e, opt.busy);
    if (plat(e.raisonnement)) h += '<section class="jv-d">' + blocTitre("Raisonnement") + '<div class="jv-md">' + rendreMarkdown(e.raisonnement) + "</div></section>";
    if (ops.length) h += '<section class="jv-d">' + blocTitre("Options comparées") + '<ul class="jv-opts">' + ops.map(x =>
      '<li class="jv-opt' + (x.retenue ? " is-retenue" : "") + '"><p class="jv-opt-t">' + esc(plat(x.titre) || "Option") +
      (x.retenue ? ' <span class="ui-badge bon">Retenue</span>' : "") + "</p>" + (plat(x.pourquoi) ? '<p class="jv-opt-p">' + esc(x.pourquoi) + "</p>" : "") + "</li>").join("") + "</ul></section>";
    h += comparaisonHtml(comparaison(e.etat, S, opt.deps));
    if (liens.length) h += '<section class="jv-d">' + blocTitre("Lié à") + '<ul class="jv-liens">' + liens.map(l =>
      "<li><span class=\"jv-lien-l\">" + esc(l.label) + "</span>" + (l.route ? '<a href="#' + esc(l.route) + '" data-goto="' + esc(l.route) + '">' + esc(l.nom) + "</a>" : '<span class="jv-muet">' + esc(l.nom) + "</span>") + "</li>").join("") + "</ul></section>";
    if (hist.length) h += U.accordeon({ titre: "Historique des modifications",
      contenu: '<ol class="jv-hist">' + hist.slice().reverse().map(x => { const l = libelleHistorique(x);
        return "<li>" + (l.date ? '<span class="jv-hist-d">' + esc(l.date) + "</span>" : "") + '<span class="jv-hist-t">' + esc(l.texte) + "</span></li>"; }).join("") + "</ol>" });
    else if (e.statut !== "a_relire") h += '<p class="jv-note">Aucune modification depuis la confirmation.</p>';
    return h;
  }

  /** Correction → { patch } (seuls les champs changés ; revue vide → null) ou { erreur } (longueurs et statut vérifiés comme en base). */
  function patchCorrection(e, ed) {
    const titre = plat(ed.titre), synthese = String(ed.synthese ?? "").trim(), revue = ed.revueLe ? String(ed.revueLe) : "";
    if (titre.length < 3 || titre.length > 120) return { erreur: "Le titre doit compter de 3 à 120 caractères." };
    if (!synthese) return { erreur: "La synthèse ne peut pas être vide." };
    if (synthese.length > 600) return { erreur: "La synthèse ne peut pas dépasser 600 caractères." };
    if (!STATUTS[ed.statut] || (ed.statut === "a_relire" && e.statut !== "a_relire")) return { erreur: "Statut inconnu : choisis-en un dans la liste." };
    if (revue && !isoOk(revue)) return { erreur: "Date de revue illisible : utilise le format jour/mois/année." };
    const patch = {};
    if (titre !== plat(e.titre)) patch.titre = titre;
    if (synthese !== String(e.synthese ?? "").trim()) patch.synthese = synthese;
    if (ed.statut !== e.statut) patch.statut = ed.statut;
    if ((revue || null) !== (e.revueLe ? jour(e.revueLe) : null)) patch.revueLe = revue || null;
    return { patch };
  }

  /** Types présents (ordre d'affichage) parmi les entrées du statut choisi : le filtre de type ne propose que ce qui existe
      dans la liste déjà filtrée par statut. */
  const typesPresents = (journal, statut) => { const f = filtrer(journal, "tout", statut); return ORDRE_TYPES.filter(t => f.some(e => e.type === t)); };

  /** État à afficher quand le journal est vide : "chargement", "erreur" ou "vide" ; null s'il n'est pas vide. */
  function etatVide(S, n) {
    if (n > 0) return null;
    if (!S || S.ready === false) return "chargement";
    return S.error ? "erreur" : "vide";
  }

  const H = { filtrer, grouperParMois, comparaison, libelleHistorique, rendreMarkdown, listeHtml, detailHtml, actionsPour, questionClaude,
    patchCorrection, liensDe, nARelire, statutParDefaut, typesPresents, optionsStatut, etatVide, CONSENTEMENTS, TYPES, STATUTS };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =================================================================== vue =================================================================== */
  /* sigX : dernier contenu écrit ; rien n'est réécrit (ni focus perdu, ni « Voir plus » replié) quand il n'a pas changé. */
  let S = null, root = null, dirty = true, busy = false;
  let sigListe = "", sigTypes = "", sigPanneau = "";
  let type = "tout", statutChoisi = null, ctlType = null, ctlStatut = null, ctlConsent = null, consentAffiche = null;
  let ouvertId = null, edition = null, msgPanneau = null, corpsPanneau = null, retourCarte = null, lienEntree = null;
  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const API = () => (window.Store && window.Store.journal) || null;
  const journal = () => (S && Array.isArray(S.journal) ? S.journal : []);
  const entree = id => journal().find(e => e && String(e.id) === String(id)) || null;
  const statutEffectif = () => statutChoisi || statutParDefaut(journal());
  const modeConsent = () => (S && CONSENTEMENTS.some(c => c.id === S.journalConsentement) ? S.journalConsentement : "demander");

  function dire(el, m, ok) { el.textContent = m || ""; el.className = "jv-msg " + (ok ? "ok" : "err"); el.hidden = !m; }

  let reglagesTouches = false;
  function renderConsent() {
    const u = U(), mode = modeConsent();
    if (!u) return;
    if (!ctlConsent) {
      ctlConsent = u.bascule($("jvConsent"), { label: "Ce que l'agent peut enregistrer", options: CONSENTEMENTS.map(c => ({ id: c.id, label: c.label })),
        actif: mode, surChange: changerConsent });
      consentAffiche = mode;
    } else if (mode !== consentAffiche && !busy) { ctlConsent.choisir(mode); consentAffiche = mode; }
    const c = CONSENTEMENTS.find(x => x.id === consentAffiche) || CONSENTEMENTS[0];
    if ($("jvConsentX").textContent !== c.texte) $("jvConsentX").textContent = c.texte;
    if ($("jvConsentResume").textContent !== c.label) $("jvConsentResume").textContent = c.label;
  }
  async function changerConsent(mode) {
    const api = API(), avant = consentAffiche;
    dire($("jvConsentErr"), "");
    consentAffiche = mode;
    $("jvConsentX").textContent = (CONSENTEMENTS.find(c => c.id === mode) || CONSENTEMENTS[0]).texte;
    $("jvConsentResume").textContent = (CONSENTEMENTS.find(c => c.id === mode) || CONSENTEMENTS[0]).label;
    let erreur = null;
    if (!api || typeof api.consentement !== "function") erreur = "Le réglage du journal n'est pas disponible dans cette vue.";
    else {
      try { const r = await api.consentement(mode); if (r && r.erreur) erreur = String(r.erreur); }
      catch (e) { erreur = "Réglage impossible : " + String((e && e.message) || "erreur").replace(/\.\s*$/, "") + "."; }
    }
    if (erreur) {
      consentAffiche = avant;
      if (ctlConsent) ctlConsent.choisir(avant);
      $("jvConsentX").textContent = (CONSENTEMENTS.find(c => c.id === avant) || CONSENTEMENTS[0]).texte;
      $("jvConsentResume").textContent = (CONSENTEMENTS.find(c => c.id === avant) || CONSENTEMENTS[0]).label;
      dire($("jvConsentErr"), erreur + " Le réglage précédent est conservé.");
    }
    if (window.Store && Store.get) S = Store.get();
  }

  function renderFiltres(liste) {
    const u = U();
    // Type : « Tout » + types présents dans la liste filtrée par statut (filtre caché s'il n'y en a qu'un) ; recréé
    // seulement si les types présents changent.
    const presents = typesPresents(liste, statutEffectif());
    if (!presents.includes(type)) type = "tout";
    const sigT = presents.join(",");
    if (sigT !== sigTypes || !ctlType) {
      sigTypes = sigT;
      ctlType = u.bascule($("jvFiltreType"), { label: "Type d'entrée", options: [{ id: "tout", label: "Tout" }].concat(presents.map(t => ({ id: t, label: TYPES_PL[t] }))),
        actif: type, surChange: id => { type = id; render(); } });
    }
    $("jvFiltreType").hidden = presents.length < 2;
    const eff = statutEffectif();
    if (!ctlStatut) ctlStatut = u.bascule($("jvFiltreStatut"), { label: "Statut", actif: eff,
      options: [{ id: "a_relire", label: "À relire" }, { id: "actif", label: "En cours" }, { id: "tout", label: "Tout" }],
      surChange: id => { statutChoisi = id; render(); } });
    else if (ctlStatut.actif() !== eff) ctlStatut.choisir(eff);
  }

  function render() {
    const u = U();
    if (!root || !u) return;
    renderConsent();
    const liste = journal(), n = liste.length, ev = etatVide(S, n);
    $("jvVide").hidden = ev !== "vide";
    // Explication et réglage dépliés tant que le journal est vide, repliés ensuite (rien d'affiché d'un coup).
    if (!reglagesTouches) $("jvReglages").open = !journal().length;
    $("jvErr").hidden = ev !== "erreur";
    $("jvCorps").hidden = !n;
    if (n) {
      renderFiltres(liste);
      const eff = statutEffectif(), f = filtrer(liste, type, eff);
      const h = f.length ? listeHtml(grouperParMois(f), u)
        : '<p class="jv-aucune">' + esc(eff === "a_relire" ? "Plus rien à relire : toutes les entrées ont été relues." : eff === "actif" ? "Aucune entrée en cours." : "Aucune entrée de ce type.") + "</p>";
      if (h !== sigListe) { sigListe = h; $("jvListe").innerHTML = h; }
    }
    renderPanneau();
    ouvrirLien();
  }

  /* Lien profond (#agent/journal?entree=<id>) : ouvre l'entrée dès qu'elle est chargée ; filtres élargis si elle n'est pas visible. */
  function ouvrirLien() {
    if (!lienEntree || !S || S.ready === false) return;
    const id = lienEntree, e = entree(id);
    lienEntree = null;
    if (!e) { dire($("jvMsg"), "Cette entrée n'est plus dans le journal : elle a peut-être été supprimée."); return; }
    if (!filtrer(journal(), type, statutEffectif()).includes(e)) { statutChoisi = "tout"; type = "tout"; render(); }
    const u = U();
    if (u && u.panneau.ouvert() && ouvertId !== String(id)) u.panneau.fermer({ focus: false });
    ouvrir(id, carteDe(id));
  }

  /* ---------- panneau de détail ---------- */
  const carteDe = id => (root && id != null ? root.querySelector('[data-ui-carte="' + CSS.escape(String(id)) + '"]') : null);
  function contenuPanneau(e) { return detailHtml(e, S, U(), { edition, busy, message: msgPanneau }); }
  /* Options d'ouverture du panneau, identiques à la première ouverture et à chaque rafraîchissement : même retour, même
     rappel de fermeture (sinon UI.panneau oublierait où rendre le focus). */
  function optionsPanneau(e, h) {
    const u = U();
    return { titre: plat(e.titre) || "Entrée du journal", contenu: h, retour: retourCarte,
      pied: u.demanderAClaude(questionClaude(e), "Reprendre avec Claude"), surFermeture: fermeture };
  }
  /* Fermeture : le focus revient à la carte d'origine ; si la liste a été redessinée entre-temps (action, émission du store),
     à la carte du même id dans la liste redessinée, sinon au titre de la page. Rien si la fermeture ne reprend pas le focus. */
  function fermeture(o) {
    const fid = ouvertId, el = retourCarte;
    ouvertId = null; edition = null; msgPanneau = null; retourCarte = null;
    if ((o && o.focus === false) || !root) return;
    if (el && el.isConnected) return; // UI.panneau lui a déjà rendu le focus
    const c = carteDe(fid);
    if (c) { c.focus(); return; }
    const t = $(journal().length ? "jvTitre" : "jvVideTitre");
    if (t) t.focus();
  }
  function ouvrir(id, el) {
    const u = U(), e = entree(id);
    if (!u || !e) return;
    ouvertId = String(id); edition = null; msgPanneau = null; retourCarte = el || null;
    const h = contenuPanneau(e);
    sigPanneau = h + "|" + e.titre;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(e, h));
    brancherPanneau(corpsPanneau);
    brancherStatut(e);
  }
  /* Rafraîchit le panneau ouvert si son contenu a changé (action, émission du store) ; garde le défilement ; `cible` reçoit le focus. */
  function renderPanneau(cible) {
    const u = U();
    if (!ouvertId || !u || !u.panneau.ouvert()) return;
    const e = entree(ouvertId);
    if (!e) { u.panneau.fermer({ focus: false }); return; }
    const h = contenuPanneau(e), sig = h + "|" + e.titre;
    if (sig === sigPanneau && !cible) return;
    sigPanneau = sig;
    const y = corpsPanneau ? corpsPanneau.scrollTop : 0;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(e, h));
    corpsPanneau.scrollTop = y;
    brancherStatut(e);
    const f = cible && corpsPanneau.querySelector(cible);
    if (f) f.focus();
  }

  /* Statut de la correction : UI.bascule (clavier, aria-checked) ; le choix est gardé dans le brouillon sans redessiner. */
  function brancherStatut(e) {
    const u = U(), b = edition && corpsPanneau ? corpsPanneau.querySelector("[data-jv-statut]") : null;
    if (!u || !b) return;
    u.bascule(b, { label: "Statut", options: optionsStatut(e.statut), actif: edition.statut,
      surChange: id => { if (!edition) return; edition.statut = id; sigPanneau = contenuPanneau(e) + "|" + e.titre; } });
  }

  const branches = new WeakSet();
  function brancherPanneau(corps) {
    if (!corps || branches.has(corps)) return;
    branches.add(corps);
    corps.addEventListener("click", e => {
      const b = e.target && e.target.closest ? e.target.closest("[data-jv-act]") : null;
      if (!b || !corps.contains(b) || b.disabled || busy || !ouvertId) return;
      agir(b.getAttribute("data-jv-act"));
    });
    /* Brouillon conservé à chaque saisie : un rafraîchissement ne perd pas la correction. */
    const saisir = e => { const f = e.target && e.target.closest ? e.target.closest("[data-jv-champ]") : null; if (f && edition) edition[f.getAttribute("data-jv-champ")] = f.value; };
    corps.addEventListener("input", saisir);
    corps.addEventListener("change", saisir);
    corps.addEventListener("keydown", e => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && edition && e.target.closest && e.target.closest("[data-jv-form]")) { e.preventDefault(); agir("enregistrer"); }
    });
  }

  /* Appel au store : occupe la vue, remonte l'erreur telle quelle ; renvoie vrai si l'opération a réussi. */
  async function appel(fn, succes) {
    const api = API();
    if (!api) { msgPanneau = { texte: "Le journal n'est pas disponible dans cette vue." }; renderPanneau("[data-jv-msg]"); return false; }
    busy = true; renderPanneau();
    let ok = false;
    try {
      const r = await fn(api);
      if (r && r.erreur) msgPanneau = { texte: String(r.erreur) };
      else { msgPanneau = { texte: succes, ok: true }; ok = true; }
    } catch (e) {
      msgPanneau = { texte: "Opération impossible : " + String((e && e.message) || "erreur").replace(/\.\s*$/, "") + ". Rien n'a été modifié." };
    } finally {
      busy = false;
      if (window.Store && Store.get) S = Store.get();
      if (window.App && App.refreshHeadlines) App.refreshHeadlines();
    }
    return ok;
  }

  async function agir(act) {
    const id = ouvertId, e = entree(id);
    if (!e) return;
    const statut = (st, txt) => appel(api => api.modifier(id, { statut: st }), txt).then(() => { render(); renderPanneau("[data-jv-msg]"); });
    if (act === "confirmer") {
      await appel(api => api.confirmer([id]), "Entrée confirmée : elle passe « En cours ». Toute modification sera désormais tracée.");
      render(); renderPanneau("[data-jv-msg]");
    } else if (act === "realise") await statut("realise", "Entrée marquée réalisée.");
    else if (act === "abandonner") await statut("abandonne", "Entrée marquée abandonnée : elle reste dans le journal.");
    else if (act === "archiver") await statut("archive", "Entrée archivée : elle reste visible avec le filtre « Tout ».");
    else if (act === "corriger") {
      edition = { titre: String(e.titre || ""), synthese: String(e.synthese || ""), statut: STATUTS[e.statut] ? e.statut : "actif", revueLe: e.revueLe ? jour(e.revueLe) : "" };
      msgPanneau = null; renderPanneau("#jv-f-titre");
    } else if (act === "annuler") { edition = null; msgPanneau = null; renderPanneau('[data-jv-act="corriger"]'); }
    else if (act === "enregistrer") {
      const r = patchCorrection(e, edition || {});
      if (r.erreur) { msgPanneau = { texte: r.erreur }; renderPanneau("[data-jv-msg]"); return; }
      if (!Object.keys(r.patch).length) { edition = null; msgPanneau = { texte: "Aucun changement.", ok: true }; renderPanneau("[data-jv-msg]"); return; }
      const ok = await appel(api => api.modifier(id, r.patch), e.statut === "a_relire" ? "Entrée corrigée." : "Entrée corrigée : la modification est tracée dans l'historique.");
      if (ok) edition = null;
      render(); renderPanneau("[data-jv-msg]");
    } else if (act === "supprimer") await supprimer(e);
  }

  async function supprimer(e) {
    const q = "Supprimer « " + extrait(e.titre, 80) + " » du journal ? Cette action est définitive.";
    if (!confirm(q)) return;
    const ids = [...root.querySelectorAll("[data-jv-entree]")].map(li => li.getAttribute("data-jv-entree"));
    const i = ids.indexOf(String(e.id)), voisin = ids[i + 1] || ids[i - 1];
    const ok = await appel(api => api.supprimer([e.id]), "");
    if (!ok) { render(); renderPanneau("[data-jv-msg]"); return; }
    const u = U();
    ouvertId = null;
    if (u && u.panneau.ouvert()) u.panneau.fermer({ focus: false });
    dire($("jvMsg"), "Entrée supprimée du journal.", true);
    render();
    const c = voisin && root.querySelector('[data-ui-carte="' + CSS.escape(voisin) + '"]');
    if (c) c.focus(); else { const t = $(journal().length ? "jvTitre" : "jvVideTitre"); if (t) t.focus(); }
  }

  function mount(r) {
    root = r;
    $("jvTitre").setAttribute("tabindex", "-1");
    $("jvVideTitre").setAttribute("tabindex", "-1");
    // Dès que l'utilisateur ouvre ou ferme les réglages, on respecte son choix.
    $("jvReglages").querySelector("summary").addEventListener("click", () => { reglagesTouches = true; });
    const u = U();
    if (u) {
      $("jvVideClaude").innerHTML = u.demanderAClaude("Faisons le point sur ma situation et enregistre nos décisions dans mon journal Boussole", "Faire le point avec Claude");
      u.brancher($("jvListe"), { surCarte: (id, el) => { dire($("jvMsg"), ""); ouvrir(id, el); } });
    }
  }
  function update(snap, visible) { S = snap; dirty = true; if (visible) { render(); dirty = false; } }
  function show() {
    const p = window.App && typeof App.parametres === "function" ? App.parametres() : {};
    if (p && p.entree) lienEntree = String(p.entree);
    if (dirty) { render(); dirty = false; } else ouvrirLien();
  }
  /* Pastille : nombre exact d'entrées à relire (S.journalARelire, comptage du store) ; à défaut, entrées lues ; "" sinon. */
  function headline() { const n = S && Number.isFinite(S.journalARelire) ? S.journalARelire : nARelire(journal()); return n > 0 ? String(n) : ""; }

  const api = { mount, update, show, headline };
  const reg = () => App.register("journal-view", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
