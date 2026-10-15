/* Patrimoine › Objectifs (module « objectifs-view ») : « Vais-je atteindre mes projets ? ». Lecture seule : la saisie passe par
   Claude (spec docs/superpowers/specs/2026-10-11-saisie-par-agent.md) ; ce module n'écrit jamais dans le store.
   - En-tête : verdict en une phrase (objectifs en bonne voie ou qui demandent attention), épargne mensuelle répartie par
     priorité (même source que la projection, spec PROJ § 13.2), « Compléter avec Claude », « Demander à Claude ».
   - Bandeau unique, fermable et mémorisé (localStorage) : « tes cibles sont lues en euros d'aujourd'hui » (spec § 13.3).
   - Une carte par objectif (ordre des priorités) : nom, échéance, cible, progression (barre), statut (atteint, en avance,
     dans les temps, en retard, hors de portée), PROBABILITÉ du moteur à côté (mot ET couleur : probable ≥ 80 %, incertain
     50 à 80 %, peu probable < 50 %, « 8 chances sur 10 »), effort mensuel requis ; 5 puis « Voir plus ». Un objectif dont
     l'échéance dépasse l'horizon de la projection (25 ans, statut moteur hors_horizon) n'a « pas de verdict » ni probabilité.
     Tant que le moteur n'a pas répondu (résultat complet, 2 000 chemins) : aucune probabilité, aucun chiffre provisoire.
   - Panneau (UI.panneau, lecture) : détail chiffré, phrase de probabilité, rendement attendu (repère Livret A), poches
     rattachées (valeur, cascade entre objectifs ; une enveloppe rattachée mène à sa fiche de Patrimoine › Comptes), le graphe
     maître (préréglage « objectifs » avec objectifId, monté dans le contenu du panneau et détruit à sa fermeture), « Corriger
     avec Claude ». Le moteur ne fournit pas encore la bande des poches de l'objectif : le graphe montre le patrimoine
     financier du périmètre avec l'objectif marqué, et le panneau le dit (besoin moteur : objectifs[].serie p10/p50/p90).
   - Projection du patrimoine financier : accordéon fermé ; le graphe maître (GrapheModele.brancher, préréglage « objectifs »,
     vue financier, 10 ans sur ordinateur) est monté à la première ouverture. Plus de simulateur local ni de versement saisi.
     CK4 la déplacera dans Pilotage › Projections.
   Probabilités : UN seul moteur (Projection.executer, via GrapheModele.calculer). La vue lance son propre calcul (réglages
   par défaut de la vue financier, rappel de GrapheModele.calculer) ; il est gratuit quand le graphe de l'accordéon a la même
   entrée, car le moteur met ses résultats en cache par empreinte (GrapheModele.signature). Le résultat complet fournit les
   probabilités (donnees.objectifs), la ligne de source de l'épargne (GraphePatrimoine.capaciteSourceTxt) et la capacité
   retenue, qui sert alors à répartir l'épargne par priorité : statuts, note et projection parlent de la même épargne.
   Avant la réponse du moteur (ou s'il échoue), la répartition utilise l'épargne prévue au budget (Plan.capaciteEpargne).
   Calculs de plan.js (affecterDeja, repartirEpargne, statutObjectif) faits une fois par émission du store.
   Fonctions pures exportées pour les tests (et window.ObjectifsView, lu par Aujourd'hui) : trier, analyser, resumeObjectifs,
   carteHtml, detailHtml, livretA, probabilites, probaInfo, probaHtml, probaPhrase, capaciteDe, noteRepartition, bandeauVu, bandeauFerme,
   valeurPoche, boutonClaude (le versement de la projection est celui du moteur : capacité d'épargne constatée ou prévue).
   Dépendances injectées (deps / ctx) : { Plan, Calc } ; window.* par défaut (ClaudePrompts, GrapheModele compris). */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) && d[k] ? d[k] : glob(k));
  /* Phrases « Compléter avec Claude » : global du navigateur, sinon le module voisin sous Node (tests). */
  const prompts = () => glob("ClaudePrompts") ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./claude-prompts.js") : null);

  const noeud = () => typeof module === "object" && module.exports && typeof require === "function";
  /* Composant et liaison du graphe maître : global du navigateur, sinon le module voisin sous Node (tests). */
  const GP = () => glob("GraphePatrimoine") || (noeud() ? require("./graphe-patrimoine.js") : null);
  const GM = () => glob("GrapheModele") || (noeud() ? require("./graphe-modele.js") : null);

  /* ---------- formats et dates ---------- */
  /* Formats uniques (format.js, UX1) ; global du navigateur, sinon le module voisin sous Node. */
  const FM = () => (typeof globalThis !== "undefined" && globalThis.Fmt) || (typeof module === "object" && module.exports && typeof require === "function" ? require("./format.js") : null);
  const nf = { format: v => FM().fmtNombre(v) };
  const eur = v => (v == null || !isFinite(v) ? "—" : FM().fmtEUR(v));
  const eurM = v => eur(v) + "/mois";
  const pct = v => (v == null || !isFinite(v) ? "—" : FM().fmtPct(v * 100, { decimales: 0 }));
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const MOIS_LONGS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const moisAn = d => { const m = /^(\d{4})-(\d{2})/.exec(String(d || "")); return m ? MOIS_LONGS[+m[2] - 1] + " " + m[1] : ""; };
  const isoToday = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); };
  const dateCible = o => (o && (o.dateCible || o.date_cible)) || null;

  /* ---------- vocabulaire ---------- */
  const OBJ_LABEL = { matelas: "Matelas", apport: "Apport", retraite: "Retraite", projet: "Projet" };
  /* statut → [ton du badge UI, libellé] */
  const STATUTS = {
    atteint: ["bon", "atteint"], avance: ["bon", "en avance"], dans_les_temps: ["info", "dans les temps"],
    retard: ["attention", "en retard"], hors_portee: ["critique", "hors de portée"],
  };
  const ORDRE_STATUTS = ["atteint", "avance", "dans_les_temps", "retard", "hors_portee"];
  /* probabilité : mot du moteur → [ton de la puce (ui-puce), classe de ton de la carte] ; le mot ET la couleur disent la même chose */
  const TON_PROBA = { "probable": "bon", "incertain": "surveiller", "peu probable": "travailler" };
  const CHEVRON_D = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';

  /** Bouton « Compléter avec Claude » (ou libellé contextuel) : ouvre Claude avec la phrase prête de la section. */
  function boutonClaude(U, section, contexte, libelle) {
    const u = U || glob("UI"), CP = prompts();
    if (!u || typeof u.demanderAClaude !== "function") return "";
    const q = CP ? CP.phrase(section, contexte) : "Boussole : aide-moi à définir ou mettre à jour mes objectifs." + (contexte ? " Concerne : " + contexte + "." : "");
    return u.demanderAClaude(q, libelle || "Compléter avec Claude");
  }

  /* =============================================================== calculs de présentation =============================================================== */
  /** Objectifs triés : priorité croissante (sans priorité à la fin), puis échéance la plus proche. */
  const trier = objs => (Array.isArray(objs) ? objs.slice() : []).filter(Boolean).sort((a, b) =>
    ((a.priorite ?? Infinity) - (b.priorite ?? Infinity)) || String(dateCible(a) || "9999").localeCompare(String(dateCible(b) || "9999")));

  /** Situation de chaque objectif : « déjà » par la cascade des poches (Plan.affecterDeja), épargne mensuelle (budget enregistré,
      Plan.capaciteEpargne) répartie par priorité (Plan.repartirEpargne), statut (Plan.statutObjectif).
      → { liste: [{ o, st, brut, rang }], totaux, capacite } ; brut = tout ce que contiennent les poches rattachées, avant la cascade.
      opt.capacite : épargne mensuelle retenue par le moteur de projection (capaciteDe), qui remplace alors celle du budget : les statuts,
      la note de répartition et la projection parlent de la même épargne. */
  function analyser(S, deps, today, opt) {
    const P = dep(deps, "Plan"), s = S || {}, scope = s.scope || "foyer", t0 = today || isoToday();
    const lignes = s.budget && Array.isArray(s.budget.lignes) ? s.budget.lignes : [];
    const totaux = P.budgetTotaux(lignes, s.profil || null, scope);
    const capacite = opt && fini(opt.capacite) ? Math.max(0, +opt.capacite) : P.capaciteEpargne(totaux);
    const objs = trier(s.objectifs), positions = s.positions || [];
    const deja = P.affecterDeja(objs, positions, scope);
    const alloue = P.repartirEpargne(objs.map(o => Object.assign({}, o, { source: "saisi", deja: deja[o.id] || 0 })), capacite, { today: t0 });
    const liste = objs.map((o, i) => {
      const st = P.statutObjectif(o, { deja: deja[o.id] || 0, versementAlloue: alloue[o.id] || 0, today: t0 });
      const brut = o.source === "poches" ? P.dejaObjectif(o, positions, scope) : st.deja;
      return { o, st, brut, rang: i + 1 };
    });
    return { liste, totaux, capacite };
  }

  const fini = v => v != null && v !== "" && typeof v !== "boolean" && isFinite(+v);
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  /** Verdict de la page : { n, compte: { statut: n }, sans, verdict, detail, ton } (ton : bon | attention | critique | neutre).
      Les objectifs sans verdict (échéance au-delà de la projection, x.proba.horsHorizon) ne comptent ni en bien ni en mal : ils sont dits à part. */
  function resumeObjectifs(liste) {
    const tous = liste || [], sans = tous.filter(x => x.proba && x.proba.horsHorizon).length;
    const xs = tous.filter(x => !(x.proba && x.proba.horsHorizon)), n = xs.length, compte = {};
    xs.forEach(x => { const k = x.st && x.st.statut; compte[k] = (compte[k] || 0) + 1; });
    const detail = ORDRE_STATUTS.filter(k => compte[k]).map(k => compte[k] + " " + STATUTS[k][1]).join(" · ") + (sans && n ? " · " + sans + " sans verdict" : "");
    if (!tous.length) return { n: 0, compte, sans, verdict: "Aucun objectif pour l'instant.", detail: "", ton: "neutre" };
    if (!n) return { n: tous.length, compte, sans, verdict: (sans > 1 ? "Tes " + sans + " objectifs sont" : "Ton objectif est") + " au-delà de l'horizon de la projection : pas de verdict.", detail: "", ton: "neutre" };
    const alerte = (compte.retard || 0) + (compte.hors_portee || 0);
    const ton = compte.hors_portee ? "critique" : alerte ? "attention" : "bon";
    let verdict;
    if (!alerte) verdict = n === 1 ? "Ton objectif est en bonne voie." : "Tes " + n + " objectifs sont en bonne voie.";
    else if (n === 1) verdict = "Ton objectif est " + STATUTS[xs[0].st.statut][1] + ".";
    else verdict = pluriel(alerte, "objectif") + " sur " + n + (alerte > 1 ? " demandent" : " demande") + " ton attention.";
    return { n: tous.length, compte, sans, verdict, detail, ton };
  }

  /* ---------- probabilité du moteur (Projection, via GrapheModele.calculer) ---------- */
  /** Probabilité de chaque objectif depuis les données complètes du graphe (donnees.objectifs) : { [id]: info } ; {} sans données prêtes.
      info = { id, probabilite, mot, chances, ton, verdict: "probabilite" | "aucun", horsHorizon } ; mot : « probable » (≥ 80 %), « incertain », « peu probable » ;
      chances : « 8 chances sur 10 » ; ton : bon | surveiller | travailler (puce) ; verdict « aucun » : pas de probabilité (statut moteur hors_horizon, ou échéance déjà passée). */
  function probabilites(donnees) {
    const out = {}, G = GP();
    if (!donnees || donnees.etat !== "pret" || !G) return out;
    (Array.isArray(donnees.objectifs) ? donnees.objectifs : []).forEach(o => {
      if (!o || o.id == null) return;
      const p = o.statut === "hors_horizon" ? null : o.probabilite, ok = fini(p);
      const mot = ok ? G.motProba(+p) : null;
      out[String(o.id)] = { id: String(o.id), probabilite: ok ? +p : null, mot, chances: ok ? G.chancesTxt(+p) : null, ton: mot ? TON_PROBA[mot] : "neutre",
        verdict: ok ? "probabilite" : "aucun", horsHorizon: o.statut === "hors_horizon" };
    });
    return out;
  }
  /** Probabilité d'un objectif de la liste (ou null) : ignorée pour un objectif déjà atteint (la somme est réunie). */
  const probaInfo = (probas, x) => (probas && x && x.o && x.st && x.st.statut !== "atteint" && probas[String(x.o.id)]) || null;
  /** Puce « mot + couleur » et chances sur 10 ; « pas de verdict » sans probabilité. */
  function probaHtml(info) {
    if (!info) return "";
    if (info.horsHorizon) return '<span class="ov-proba aucun"><span class="ov-proba-n">Pas de verdict : échéance au-delà de la projection (25 ans)</span></span>';
    if (info.verdict !== "probabilite") return "";
    return '<span class="ov-proba"><span class="ui-puce ' + esc(info.ton) + '"><span class="ui-puce-point" aria-hidden="true"></span>' + esc(info.mot) + '</span><span class="ov-proba-n">' + esc(info.chances) + " d'y arriver</span></span>";
  }
  /** Phrase du panneau d'un objectif. etat : "calcul" | "pret" | "erreur" | "absent" (état du calcul du moteur). */
  function probaPhrase(x, info, etat) {
    const o = x.o, d = dateCible(o);
    if (x.st.statut === "atteint") return "La somme est déjà réunie : il n'y a pas de probabilité à calculer.";
    if (info && info.horsHorizon) return "L'échéance (" + (d ? moisAn(d) : "—") + ") est au-delà de l'horizon de la projection (25 ans) : pas de verdict, aucune probabilité calculée.";
    if (info && info.verdict === "probabilite") return info.chances.charAt(0).toUpperCase() + info.chances.slice(1) + " d'atteindre la cible à l'échéance" + (d ? " (" + moisAn(d) + ")" : "") + " : " + info.mot + ". Cible lue en euros d'aujourd'hui.";
    if (etat === "calcul") return "Probabilité en cours de calcul…";
    if (etat === "pret") return "Pas de probabilité calculée pour cet objectif" + (d ? "" : " (sans échéance)") + ".";
    return "La probabilité n'est pas disponible pour l'instant.";
  }
  /** Épargne mensuelle retenue par le moteur (€/mois) depuis ses données prêtes ; null sans données (le budget sert alors). */
  function capaciteDe(donnees) {
    if (!donnees || donnees.etat !== "pret") return null;
    if (donnees.capacite_source == null) return 0; // « Pas encore de capacité d'épargne connue : la projection suppose 0 € par mois »
    const cb = donnees.capacite && donnees.capacite.base;
    return cb && fini(cb.retenue) ? +cb.retenue : null;
  }
  /** Note d'en-tête : « Épargne mensuelle répartie par priorité : 300 € — <même source que la ligne de la projection> ».
      donnees : données prêtes du moteur (source = GraphePatrimoine.capaciteSourceTxt) ; sans elles et sans calcul en cours (budgetEpargne : €/mois), l'épargne prévue au budget. */
  function noteRepartition(donnees, budgetEpargne, calcul) {
    const G = GP();
    if (donnees && donnees.etat === "pret" && G) {
      const t = G.capaciteSourceTxt(donnees);
      return /^Épargne mensuelle projetée/.test(t) ? t.replace("Épargne mensuelle projetée", "Épargne mensuelle répartie par priorité") : t + " Aucune épargne n'est répartie entre tes objectifs.";
    }
    if (calcul) return "";
    return "Épargne mensuelle répartie par priorité : " + eurM(budgetEpargne) + " — ta capacité d'épargne prévue au budget.";
  }

  /** Effort requis lisible : [montant, précision]. */
  function effortTxt(x) {
    const { o, st } = x, done = st.statut === "atteint";
    if (done) return ["—", "objectif atteint"];
    if (!dateCible(o)) return ["—", "pas d'échéance fixée"];
    if (!isFinite(st.effort)) return ["—", "échéance dépassée"];
    return [eurM(st.effort), "pendant " + st.mois + " mois, à " + String(o.rendement ?? 0).replace(".", ",") + " %/an"];
  }
  function quandTxt(x) {
    const { st } = x;
    if (st.statut === "atteint") return "Objectif atteint : la somme est déjà de côté.";
    if (st.atteinte) return "Au rythme actuel, atteint vers " + moisAn(st.atteinte) + ".";
    return st.versementAlloue > 0 ? "Pas atteint en 60 ans au rythme actuel." : "Aucune épargne n'y est affectée pour l'instant : pas atteint au rythme actuel.";
  }
  const badgeHtml = st => { const [ton, lbl] = STATUTS[st] || ["neutre", st || "—"]; return '<span class="ui-badge ' + ton + '">' + esc(lbl) + "</span>"; };

  /** Carte repliée d'un objectif (bouton data-ui-carte, ouvert en panneau par UI.brancher). n = nombre d'objectifs.
      proba : probabilité du moteur (probaInfo) ou null/absente : rien tant que le moteur n'a pas répondu ; « pas de verdict » (hors_horizon) remplace le statut. */
  function carteHtml(x, n, proba) {
    const { o, st } = x, sans = !!(proba && proba.horsHorizon), ton = sans ? "neutre" : (STATUTS[st.statut] || ["neutre"])[0], eff = effortTxt(x);
    const prog = Math.max(0, Math.min(1, +st.progression || 0));
    return '<button type="button" class="ui-carte ov-carte st-' + ton + '" data-ui-carte="' + esc(o.id) + '" aria-haspopup="dialog">' +
      '<span class="ui-carte-tete"><span class="ui-carte-titre">Priorité ' + esc(x.rang || 1) + (n ? " sur " + esc(n) : "") + " · " + esc(OBJ_LABEL[o.type] || o.type || "Objectif") + "</span>" +
        (sans ? '<span class="ui-badge">pas de verdict</span>' : badgeHtml(st.statut)) + "</span>" +
      '<span class="ov-carte-nom">' + esc(plat(o.nom) || "Objectif sans nom") + "</span>" +
      '<span class="ov-carte-v"><span class="ov-carte-cible">' + esc(eur(o.cible)) + '</span><span class="ov-carte-date">' + esc(dateCible(o) ? moisAn(dateCible(o)) : "sans échéance") + "</span></span>" +
      '<span class="ov-barre" aria-hidden="true"><i style="width:' + (prog * 100).toFixed(1) + '%"></i></span>' +
      probaHtml(proba) +
      '<span class="ui-carte-pied"><span>' + esc(pct(prog)) + " de la cible</span><span>Effort requis : " + esc(eff[0]) + "</span></span>" +
      '<span class="ui-carte-ouvrir">' + CHEVRON_D + "</span></button>";
  }


  /** Valeur, dans le périmètre, des lignes d'une poche (key = "bloc") ou d'une enveloppe (key = "envelope"). */
  function valeurPoche(positions, scope, key, nom, Calc) {
    return (positions || []).filter(p => Calc.counted(p) && Calc.inScope(p, scope || "foyer") && p[key] === nom).reduce((a, p) => a + Calc.val(p), 0);
  }

  /** Fiche d'une enveloppe dans Patrimoine › Comptes, même adresse qu'App.ouvrir({ enveloppe, titulaire }) (App.lienCompte, sinon
      ComptesView.lien) ; titulaire : celui de la vue personnelle, sinon le seul titulaire des lignes de l'enveloppe. */
  function lienEnveloppe(positions, scope, nom) {
    const own = scope === "p1" || scope === "p2" ? scope : (() => { const o = [...new Set((positions || []).filter(p => p && p.envelope === nom).map(p => p.owner).filter(Boolean))]; return o.length === 1 ? o[0] : null; })();
    const cible = { enveloppe: nom, titulaire: own }, A = glob("App"), CV = glob("ComptesView") ||
      (typeof module === "object" && module.exports && typeof require === "function" ? require("./comptes-view.js") : null);
    if (A && typeof A.lienCompte === "function") return A.lienCompte(cible);
    if (CV && typeof CV.lien === "function") return CV.lien(cible);
    return "patrimoine/comptes?enveloppe=" + encodeURIComponent(nom) + (own ? "&titulaire=" + own : "");
  }

  /** Contenu du panneau d'un objectif (lecture) et « Corriger avec Claude » pour cet objectif.
      ctx = { positions, scope, Calc, Plan, n, duScope, livretA, U, proba, etatProba } ; proba : probaInfo de l'objectif (phrase de probabilité, posée aussi à la place par la vue). */
  function detailHtml(x, ctx) {
    const c = ctx || {}, { o, st } = x, C = dep(c, "Calc"), scope = c.scope || "foyer", n = c.n || 1, r = x.rang || c.rang || 1;
    const done = st.statut === "atteint", eff = effortTxt(x), prog = Math.max(0, Math.min(1, +st.progression || 0));
    const poches = [].concat(o.poches || []), envs = [].concat(o.enveloppes || []);
    const src = o.source === "poches" ? (poches.length || envs.length ? "pris sur " + poches.concat(envs).join(", ") : "aucune poche rattachée") : "montant saisi";
    const nom = plat(o.nom) || "sans nom";
    const rows = [
      ["Cible", eur(o.cible), dateCible(o) ? moisAn(dateCible(o)) : "sans échéance"],
      ["Déjà de côté", eur(st.deja), src],
      ["Effort requis", eff[0], eff[1]],
      ["Ton épargne actuelle en couvre", eurM(st.versementAlloue), done ? "plus rien à verser" : "versement alloué, par ordre de priorité"],
      ["Rendement attendu", o.rendement == null || o.rendement === "" ? "—" : String(o.rendement).replace(".", ",") + " %/an", "repère : Livret A " + (c.livretA || "taux réglementé en vigueur")],
    ];
    const ctxClaude = "l'objectif « " + nom + " » (" + eur(o.cible) + (dateCible(o) ? " d'ici " + moisAn(dateCible(o)) : "") + ", priorité " + r + " sur " + n + ")";
    let pochesHtml;
    if (o.source === "poches") {
      const items = poches.map(p => ["Poche", p, valeurPoche(c.positions, scope, "bloc", p, C), null])
        .concat(envs.map(e => ["Enveloppe", e, valeurPoche(c.positions, scope, "envelope", e, C), lienEnveloppe(c.positions, scope, e)]));
      pochesHtml = (items.length ? '<ul class="ov-poches">' + items.map(([k, nm, v, r]) => '<li><span><span class="ov-poche-k">' + esc(k) + "</span> " +
        (r ? '<a href="#' + esc(r) + '" data-goto="' + esc(r) + '">' + esc(nm) + "</a>" : esc(nm)) + '</span><b class="ov-num">' + esc(eur(v)) + "</b></li>").join("") + "</ul>"
        : '<p class="ov-note">Aucune poche rattachée : demande à Claude d\'en rattacher une.</p>') +
        (x.brut > st.deja + 0.5 && !done ? '<p class="ov-note">Ces poches contiennent ' + esc(eur(x.brut)) + " " + esc(c.duScope || "du foyer") + " ; " + esc(eur(x.brut - st.deja)) + " servent d'abord un objectif prioritaire.</p>" : "") +
        '<p class="ov-note">L\'argent d\'une poche sert d\'abord l\'objectif prioritaire ; le reste passe au suivant.</p>';
    } else pochesHtml = '<p class="ov-note">Montant saisi : ' + esc(eur(st.deja)) + ". Pour le mettre à jour, ou pour rattacher l'objectif à des poches de tes placements (il suivra alors leur valeur), passe par Claude.</p>";
    return '<div class="ov-meta">' + (c.proba && c.proba.horsHorizon ? '<span class="ui-badge">pas de verdict</span>' : badgeHtml(st.statut)) + "<span>Priorité " + esc(r) + " sur " + esc(n) + " · " + esc(OBJ_LABEL[o.type] || o.type || "Objectif") + "</span></div>" +
      '<p class="ov-quand">' + esc(quandTxt(x)) + "</p>" +
      '<p class="ov-proba-phrase" data-ov-proba data-ton="' + esc(c.proba ? c.proba.ton : "neutre") + '">' + esc(probaPhrase(x, c.proba || null, c.etatProba || "calcul")) + "</p>" +
      '<div class="ov-prog" role="progressbar" aria-label="Progression" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(prog * 100) + '"><i style="width:' + (prog * 100).toFixed(1) + '%"></i></div>' +
      '<p class="ov-note">' + esc(pct(prog)) + " de la cible</p>" +
      '<dl class="ov-dl">' + rows.map(([k, v, s]) => "<div><dt>" + esc(k) + "</dt><dd><b>" + esc(v) + "</b><span>" + esc(s) + "</span></dd></div>").join("") + "</dl>" +
      '<div class="ov-acts">' + boutonClaude(c.U, "objectifs", ctxClaude, "Corriger avec Claude") + "</div>" +
      '<p class="ov-note">Cible, échéance, priorité ou poches : demande à Claude de les corriger, puis valide sa proposition dans Agent › Propositions.</p>' +
      '<section class="ov-sec"><h3 class="ov-sec-t">Poches rattachées</h3>' + pochesHtml + "</section>" +
      '<section class="ov-sec"><h3 class="ov-sec-t">Projection de l\'objectif</h3>' +
      '<div class="ov-graphe" data-ov-graphe></div>' +
      '<p class="ov-note">Ce graphe montre le patrimoine financier ' + esc(c.duScope || "du foyer") + ' avec cet objectif marqué à son échéance, en euros d\'aujourd\'hui. Ce n\'est pas la trajectoire des seules poches de l\'objectif : le moteur ne la calcule pas encore.</p></section>';
  }

  /** Taux du Livret A lu dans les repères du savoir commun, avec sa date d'effet ; jamais de taux codé en dur. */
  function livretA(S, Reperes) {
    const R = Reperes, rl = R && S && S.savoir ? R.trouver(S.savoir.reperes, "livret_a_taux") : null;
    if (!rl) return "taux réglementé en vigueur";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(rl.dateEffet || ""));
    const d = m ? m[3] + "/" + m[2] + "/" + m[1] : (rl.dateEffet ? new Date(rl.dateEffet).toLocaleDateString("fr-FR") : "");
    return R.format(rl) + (d && d !== "Invalid Date" ? " depuis le " + d : "");
  }

  /* ---------- bandeau « cibles en euros d'aujourd'hui » (changement de sens annoncé une fois, spec PROJ § 13.3) ---------- */
  const CLE_BANDEAU = "boussole.objectifs.cibles-euros-aujourdhui";
  /** Bandeau déjà fermé ? Lecture du stockage local protégée (stockage indisponible : on le montre). */
  function bandeauVu(stockage) { try { return !!stockage && stockage.getItem(CLE_BANDEAU) === "1"; } catch (e) { return false; } }
  /** Mémorise la fermeture du bandeau ; faux si le stockage est indisponible (la vue le garde alors en mémoire pour la session). */
  function bandeauFerme(stockage) { try { stockage.setItem(CLE_BANDEAU, "1"); return true; } catch (e) { return false; } }

  const H = { trier, analyser, resumeObjectifs, carteHtml, detailHtml, livretA, probabilites, probaInfo, probaHtml, probaPhrase, capaciteDe, noteRepartition, bandeauVu, bandeauFerme,
    valeurPoche, boutonClaude, STATUTS };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof window !== "undefined") window.ObjectifsView = H; // pour Aujourd'hui (jauge d'objectifs, versement de la projection)
  if (typeof document === "undefined") return;

  /* =================================================================== vue =================================================================== */
  let root = null, S = null, aRendre = true;
  /* anti-redessin : signatures des derniers contenus écrits ; analyse mémorisée pour l'émission courante du store et la réponse du moteur */
  let sigCartes = "", sigPanneau = "", cache = null;
  /* panneau : { id, retour } ; liaison du graphe monté dans son contenu */
  let pan = null, corpsPanneau = null, liaisonPan = null;
  /* graphe de l'accordéon : monté à la première ouverture (fermé, il n'a pas de largeur à mesurer) */
  let liaison = null;
  /* moteur : probabilités et épargne retenue. sig = empreinte de l'entrée du calcul en cours ou terminé ; etat : absent | calcul | pret | erreur */
  let moteur = { sig: "", perim: "", etat: "absent", donnees: null, probas: {} }, seqMoteur = 0;
  let bandeauMem = false;

  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const P = () => window.Plan, C = () => window.Calc;
  const deps = () => ({ Plan: P(), Calc: C() });
  const scope = () => (S && S.scope) || "foyer";
  const people = () => (S && Array.isArray(S.people) ? S.people : []);
  const nomDe = k => { const p = people().find(x => x.id === k); return (p && p.nom) || (k === "p2" ? "Conjoint(e)" : "Moi"); };
  const duScope = () => (scope() === "foyer" ? "du foyer" : C().deNom(nomDe(scope()), scope() === "p2" ? 2 : 1));
  const echap = s => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"));
  const stockage = () => { try { return window.localStorage || null; } catch (e) { return null; } };
  /** Analyse de l'émission courante : calculée une fois (update et la réponse du moteur l'invalident), partagée par les cartes, le panneau
      et le titre de navigation. L'épargne retenue par le moteur remplace celle du budget dès qu'elle est connue. */
  function analyse() {
    const j = isoToday(), cap = capaciteDe(moteur.donnees), k = String(cap);
    if (!cache || cache.S !== S || cache.jour !== j || cache.cap !== k) cache = { S, jour: j, cap: k, a: analyser(S, deps(), j, cap == null ? null : { capacite: cap }) };
    return cache.a;
  }
  /** Liste d'objectifs avec leur probabilité (rien tant que le moteur n'a pas répondu). */
  const listeAvecProba = () => analyse().liste.map(x => Object.assign({}, x, { proba: probaInfo(moteur.probas, x) }));
  const entree = id => { const L = listeAvecProba(); return { x: L.find(y => String(y.o.id) === String(id)) || null, n: L.length }; };

  /* ---------- moteur : un seul calcul, le même que celui du graphe (cache par empreinte de Projection) ---------- */
  const MOTEUR_VIDE = { sig: "", perim: "", etat: "absent", donnees: null, probas: {} };
  function demanderMoteur() {
    const Mo = GM();
    if (!S || !Mo || typeof Mo.calculer !== "function") { moteur = MOTEUR_VIDE; return; }
    const r = Mo.reglagesParDefaut({ vue: "financier" }), jour = isoToday(), perim = scope() + "|" + duScope();
    let sig = "";
    try { sig = Mo.signature(S, r, jour) + "|" + perim; } catch (e) { moteur = Object.assign({}, MOTEUR_VIDE, { etat: "erreur" }); return; }
    if (sig === moteur.sig) return;
    const n = ++seqMoteur;
    // Un nouveau calcul du même périmètre garde la réponse précédente jusqu'à la suivante (pas de clignotement) ; un autre périmètre repart de rien.
    const garde = moteur.perim === perim && moteur.donnees;
    moteur = { sig, perim, etat: "calcul", donnees: garde ? moteur.donnees : null, probas: garde ? moteur.probas : {} };
    Mo.calculer(S, r, { today: jour, perimetre: duScope(), rappel: d => {
      if (n !== seqMoteur || !d) return;
      if (d.etat === "erreur") moteur = { sig, perim, etat: "erreur", donnees: null, probas: {} };
      else if (d.etat === "pret" && !d.progressif) moteur = { sig, perim, etat: "pret", donnees: d, probas: probabilites(d) };
      else return;
      surMoteur();
    } }).catch(() => { if (n === seqMoteur) { moteur = { sig, perim, etat: "erreur", donnees: null, probas: {} }; surMoteur(); } });
  }
  /* Le moteur a répondu : les cartes, la note et le panneau se redessinent (cette fois avec la probabilité et l'épargne retenue). */
  function surMoteur() {
    cache = null; aRendre = true;
    if (root && !root.hidden && S) { render(); aRendre = false; }
  }

  /* ---------- rendu de la page ---------- */
  function videHtml() {
    return '<div class="ov-vide"><p class="ov-vide-t">Aucun objectif pour l\'instant.</p>' +
      "<p>Un objectif daté (matelas de précaution, apport immobilier, retraite, projet) dit combien mettre de côté chaque mois et si ton épargne actuelle suffit. " +
      "Claude t'aide à les définir ; tu valides ensuite ses propositions.</p>" +
      '<div class="ov-vide-act">' + boutonClaude(U(), "objectifs", "", "Compléter avec Claude") + "</div></div>";
  }
  /* Bandeau « euros d'aujourd'hui » : montré tant qu'il n'a pas été fermé (mémorisé ; stockage indisponible : fermé pour la session). */
  function renderBandeau(avecObjectifs) {
    const b = $("ovBandeau"), voir = avecObjectifs && !bandeauMem && !bandeauVu(stockage());
    if (b.hidden === voir) b.hidden = !voir;
  }
  function render() {
    const u = U();
    if (!root || !S || !u) return;
    demanderMoteur();
    const L = listeAvecProba(), a = analyse(), r = resumeObjectifs(L);
    // Réponse en encre (jamais une phrase colorée), le statut dans une puce avec son mot.
    const st = { bon: ["bon", "Bon"], attention: ["surveiller", "À surveiller"], critique: ["travailler", "À travailler"] }[r.ton];
    $("ovVerdict").innerHTML = esc(r.verdict + (r.detail && r.n > 1 ? " (" + r.detail + ")" : "")) +
      (st ? ' <span class="ui-puce ' + st[0] + '"><span class="ui-puce-point" aria-hidden="true"></span>' + st[1] + "</span>" : "");
    $("ovVerdict").className = "ov-verdict ton-" + r.ton;
    const partage = a.liste.filter(x => x.o.source === "poches").some((x, i, Q) => Q.some((y, j) => j > i &&
      ((x.o.poches || []).some(p => (y.o.poches || []).includes(p)) || (x.o.enveloppes || []).some(p => (y.o.enveloppes || []).includes(p)))));
    const note = a.liste.length ? (noteRepartition(moteur.donnees, a.capacite, moteur.etat === "calcul" && !moteur.donnees) +
      (partage ? " Plusieurs objectifs partagent une poche : l'argent d'une poche sert d'abord l'objectif prioritaire." : "")).trim() : "";
    if ($("ovNote").textContent !== note) $("ovNote").textContent = note;
    renderBandeau(a.liste.length > 0);
    const h = L.length ? u.voirPlus(L, 5, x => carteHtml(x, L.length, x.proba), "Voir plus d'objectifs", "div", "ov-objectifs") : videHtml();
    if (h !== sigCartes) {
      const act = document.activeElement, dedans = act && $("ovCartes").contains(act) && act.closest;
      const porteur = dedans ? act.closest("[data-ui-carte]") || act.closest("[data-ui-voirplus]") : null;
      const sel = !porteur ? null : porteur.hasAttribute("data-ui-carte") ? '[data-ui-carte="' + echap(porteur.getAttribute("data-ui-carte")) + '"]'
        : '[aria-controls="' + echap(porteur.getAttribute("aria-controls")) + '"]';
      sigCartes = h; $("ovCartes").innerHTML = h;
      const n = sel && $("ovCartes").querySelector(sel); if (n) n.focus();
    }
    renderProjection();
    renderPanneau();
  }

  /* ---------- projection (accordéon) : le graphe maître, préréglage « objectifs » ---------- */
  function renderProjection() {
    if (!root || !S) return;
    const src = $("ovCapSrc"), G = GP();
    const t = moteur.donnees && moteur.donnees.etat === "pret" && G ? G.capaciteSourceTxt(moteur.donnees) : "";
    if (src.textContent !== t) src.textContent = t;
    src.hidden = !t;
    if ($("ovProjAcc").hasAttribute("open")) monterGraphe();
  }
  /* Le graphe est monté une fois (à la première ouverture) ; ensuite il ne se recalcule que si ce qui compte a changé (GrapheModele.actualiser). */
  function monterGraphe() {
    const Mo = GM(), el = $("ovGraphe");
    if (!root || !S || !Mo || !el) return;
    if (!liaison) liaison = Mo.brancher(el, { preset: "objectifs", deps: { UI: U() }, today: isoToday, perimetre: duScope, store: window.Store || null });
    if (liaison) liaison.actualiser(S);
  }

  /* ---------- panneau (lecture) ---------- */
  function ctxPanneau(n, x) {
    return { positions: S.positions, scope: scope(), Calc: C(), Plan: P(), n, duScope: duScope(), livretA: livretA(S, window.Reperes || null), U: U(),
      proba: x.proba, etatProba: moteur.etat };
  }
  /* Contenu du panneau et sa signature : sans la phrase de probabilité, qui arrive plus tard et se pose sur place (le graphe monté dedans ne doit pas être recréé). */
  function contenuPanneau() {
    const { x, n } = entree(pan.id);
    return { html: detailHtml(x, ctxPanneau(n, x)), sig: detailHtml(x, Object.assign(ctxPanneau(n, x), { proba: null, etatProba: "" })), x };
  }
  function optionsPanneau(h) {
    const u = U(), { x } = entree(pan.id), o = x && x.o;
    const titre = plat(o && o.nom) || "Objectif sans nom";
    const pied = o ? u.demanderAClaude("Aide-moi à atteindre mon objectif « " + titre + " » (" + eur(o.cible) + (dateCible(o) ? " d'ici " + moisAn(dateCible(o)) : "") + ") avec Boussole : quel effort, sur quels placements ?") : null;
    return { titre, contenu: h, retour: pan.retour, pied, surFermeture: fermeture };
  }
  /* UI donnée au graphe du panneau : ses feuilles (réglages, jalons, lecture, « comment c'est calculé ») passent par le même panneau unique et
     remplaceraient celui de l'objectif ; à leur fermeture, on revient à l'objectif (sauf navigation : le panneau reste alors fermé). */
  function uiDuPanneau() {
    const u = U();
    if (!u || !u.panneau) return u;
    return Object.assign({}, u, { panneau: Object.assign({}, u.panneau, { ouvrir: o => {
      const p = pan, sur = o && o.surFermeture;
      return u.panneau.ouvrir(Object.assign({}, o, { surFermeture: r => {
        if (typeof sur === "function") sur(r);
        if (!p || pan !== p) return;
        if (r && r.focus === false) fermeture({ focus: false }); else rouvrirObjectif();
      } }));
    } }) });
  }
  function rouvrirObjectif() {
    const u = U();
    if (!u || !pan || !entree(pan.id).x) { fermeture({ focus: false }); return; }
    const c = contenuPanneau();
    sigPanneau = c.sig;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(c.html));
    monterGraphePanneau();
  }
  function detruireGraphePanneau() { if (liaisonPan) { liaisonPan.detruire(); liaisonPan = null; } }
  /* Graphe de l'objectif : monté dans le contenu du panneau (rouvrir le panneau remplace son contenu : l'ancien graphe est détruit d'abord). */
  function monterGraphePanneau() {
    detruireGraphePanneau();
    const Mo = GM(), el = corpsPanneau && corpsPanneau.querySelector("[data-ov-graphe]");
    if (!Mo || !el || !pan) return;
    liaisonPan = Mo.brancher(el, { preset: "objectifs", objectifId: pan.id, titre: "Patrimoine financier", deps: { UI: uiDuPanneau() }, today: isoToday, perimetre: duScope, store: window.Store || null });
    if (liaisonPan) liaisonPan.actualiser(S);
  }
  function fermeture(o) {
    const p = pan;
    pan = null; sigPanneau = ""; corpsPanneau = null;
    detruireGraphePanneau();
    if ((o && o.focus === false) || !root || !p) return;
    if (p.retour && p.retour.isConnected) return;
    const el = p.id != null && root.querySelector('[data-ui-carte="' + echap(p.id) + '"]');
    (el || $("ovTitre")).focus();
  }
  function ouvrir(p) {
    if (!U() || !entree(p.id).x) return;
    pan = Object.assign({}, p);
    rouvrirObjectif();
  }
  /* Rafraîchit le panneau ouvert quand ses données changent ; la probabilité seule se pose sur place. */
  function renderPanneau() {
    const u = U();
    if (!pan || !u || !u.panneau.ouvert()) return;
    if (!entree(pan.id).x) { u.panneau.fermer({ focus: false }); return; }
    if (liaisonPan && corpsPanneau && !corpsPanneau.contains(liaisonPan.el)) return; // une feuille du graphe occupe le panneau : on y revient à sa fermeture
    const c = contenuPanneau();
    if (c.sig === sigPanneau) {
      const ph = corpsPanneau && corpsPanneau.querySelector("[data-ov-proba]"), t = probaPhrase(c.x, c.x.proba, moteur.etat), ton = c.x.proba ? c.x.proba.ton : "neutre";
      if (ph && ph.textContent !== t) ph.textContent = t;
      if (ph && ph.getAttribute("data-ton") !== ton) ph.setAttribute("data-ton", ton);
      if (liaisonPan) liaisonPan.actualiser(S);
      return;
    }
    sigPanneau = c.sig;
    const y = corpsPanneau ? corpsPanneau.scrollTop : 0;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(c.html));
    corpsPanneau.scrollTop = y;
    monterGraphePanneau();
  }

  function mount(r) {
    root = r;
    $("ovTitre").setAttribute("tabindex", "-1");
    const u = U();
    if (u) {
      // Le bouton Claude de l'en-tête couvre « Définir mes objectifs » : plus de boutons Claude empilés sous le titre.
      u.brancher($("ovCartes"), { surCarte: (id, el) => ouvrir({ id, retour: el }) });
    }
    root.addEventListener("click", e => {
      const t = e.target;
      if (t && t.closest && t.closest("[data-ov-bandeau-x]")) {
        if (!bandeauFerme(stockage())) bandeauMem = true;
        $("ovBandeau").hidden = true;
        $("ovTitre").focus();
      }
    });
    /* Accordéon de la projection : graphe monté à l'ouverture (toggle ne remonte pas : écoute en capture). */
    root.addEventListener("toggle", e => { if (e.target && e.target.id === "ovProjAcc" && e.target.hasAttribute("open")) monterGraphe(); }, true);
  }
  function update(snap, visible) {
    S = snap; cache = null;
    if (pan && !(snap.objectifs || []).some(o => String(o.id) === String(pan.id)) && U()) U().panneau.fermer({ focus: false });
    aRendre = true;
    if (visible) { render(); aRendre = false; }
  }
  function show() { if (aRendre) { render(); aRendre = false; } }
  function headline() {
    if (!S || !(S.ready || S.dbOk === false)) return "–";
    const r = resumeObjectifs(listeAvecProba());
    return r.n ? r.verdict : "Objectifs à fixer";
  }

  const api = { mount, update, show, headline };
  const reg = () => App.register("objectifs-view", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
