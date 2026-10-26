/* Coque : 4 destinations (Aujourd'hui · Patrimoine · Pilotage · Agent) + Compte (menu de l'avatar), sous-vues en onglets,
   routage par hash (#destination/sous-vue), barre latérale (ordinateur) et barre basse (mobile).
   Les modules s'enregistrent via App.register(name, { mount, update(S, visible), show, headline }).
   Pour brancher un module sur une sous-vue : renseigner `module` dans SPACES et poser dans shell.html
   <section class="view" id="view-<module>" data-space="…" data-sub="…" hidden><!--@<fragment>--></section>
   à la place de la carte « Bientôt » (et ajouter le fragment à MODULES dans build.mjs). */
(function () {
  /* ---------- registre (données pures, testées par test/shell.test.mjs) ---------- */
  const SPACES = [
    { space: "aujourdhui", label: "Aujourd'hui", short: "Aujourd'hui", icon: "aujourdhui", primary: true, desc: "Ce qui demande ton attention", subs: [
      { id: "vue", label: "Aujourd'hui", module: "aujourdhui" },
    ] },
    { space: "patrimoine", label: "Patrimoine", short: "Patrimoine", icon: "patrimoine", primary: true, desc: "Ce que tu possèdes, ce que tu dois, ton budget et tes projets", subs: [
      { id: "placements", label: "Placements", module: "pilotage" },
      { id: "comptes", label: "Comptes", module: "comptes-view" },
      { id: "immobilier", label: "Immobilier et crédits", module: "bilan" },
      { id: "budget", label: "Budget", module: "plan" },
      { id: "objectifs", label: "Objectifs", module: "objectifs-view" },
    ] },
    { space: "pilotage", label: "Pilotage", short: "Pilotage", icon: "pilotage", primary: true, desc: "Ta situation est-elle saine ? Et si… ?", subs: [
      { id: "sante", label: "Santé", module: "sante" },
      { id: "risque", label: "Risque", module: "risque-view" },
      { id: "rang", label: "Rang", module: "toise" },
      /* SCN1 : la bibliothèque des scénarios ; le simulateur acheter / louer (simu) est un outil de la même section (?outil=acheter-louer, D8). */
      { id: "scenarios", label: "Scénarios", module: "scenarios-view", extras: ["simu"] },
    ] },
    /* Agent : 4 sous-vues (UX3). « Savoir » réunit les anciennes Fiches et Expertises (deux volets, modules fiches-view et expertises-view,
       montés dans la section de savoir-view : `extras`). Connexion est passée dans Compte (« Connecter Claude »). */
    { space: "agent", label: "Agent", short: "Agent", icon: "agent", primary: true, desc: "Ce que Claude a fait, sait et te propose", subs: [
      { id: "propositions", label: "À valider", module: "propositions" },
      { id: "journal", label: "Journal", module: "journal-view" },
      { id: "memoire", label: "Mémoire", module: "memoire-view" },
      { id: "savoir", label: "Savoir", module: "savoir-view", extras: ["fiches-view", "expertises-view"] },
    ] },
    { space: "compte", label: "Compte", short: "Compte", icon: "compte", primary: false, desc: "Tes données, tes règles et la connexion de Claude", subs: [
      { id: "donnees", label: "Données", module: "profil" },
      { id: "regles", label: "Règles", module: "regles" },
      { id: "connexion", label: "Connexion", module: "claude-guide" },
    ] },
  ];
  /* Correspondance des anciennes routes (spec cockpit § Navigation cible) : anciennes sous-vues, anciens espaces seuls
     et anciens onglets (App.go("plan"), data-goto-tab="profil"). Appliquée par resolve() et donc par resolveHash() :
     marque-pages, liens internes data-goto et liens des textes du connecteur continuent de marcher. */
  const LEGACY = {
    "bilan": "aujourdhui/vue", "bilan/vue": "aujourdhui/vue", "bilan/placements": "patrimoine/placements",
    "recos": "aujourdhui/vue", "recos/actions": "aujourdhui/vue", "recos/fiches": "agent/savoir",
    "diagnostic": "pilotage/sante", "diagnostic/sante": "pilotage/sante", "diagnostic/risque": "pilotage/risque", "diagnostic/rang": "pilotage/rang",
    "decisions": "pilotage/scenarios", "decisions/acheter": "pilotage/scenarios", "decisions/autres": "pilotage/scenarios",
    "avenir": "patrimoine/budget", "avenir/plan": "patrimoine/budget", "avenir/projections": "aujourdhui/vue",
    "profil": "compte/donnees", "profil/donnees": "compte/donnees", "profil/regles": "compte/regles",
    "profil/claude": "compte/connexion", "profil/memoire": "agent/memoire", "profil/propositions": "agent/propositions",
    "toise": "pilotage/rang", "simu": "pilotage/scenarios", "plan": "patrimoine/budget",
    /* UX3 : Connexion est passée d'Agent à Compte ; Fiches et Expertises sont les deux volets d'Agent › Savoir (le paramètre ?expertise=<slug> est gardé). */
    /* UX5 : l'onglet « Projections » (jamais construit) disparaît, la courbe maîtresse d'Aujourd'hui fait déjà la projection. */
    "pilotage/projections": "aujourdhui/vue",
    "agent/connexion": "compte/connexion", "agent/fiches": "agent/savoir", "agent/expertises": "agent/savoir", "fiches": "agent/savoir", "expertises": "agent/savoir",
  };
  /* Ancres de la toute première version (onglets et sous-onglets de la Toise et du Simulateur), en hash seulement :
     « #pilotage » nu garde son ancien sens dans un marque-page (Patrimoine › Placements), alors que App.go("pilotage")
     désigne la nouvelle destination. « #patrimoine » nu mène désormais à Patrimoine › Placements, première sous-vue de la
     destination (il ouvrait la Toise, onglet Patrimoine, dans la toute première version : la Toise, qui lit encore ces ancres
     au montage pour son sous-onglet, s'ouvre alors seulement par #pilotage/rang). Le Simulateur lit aussi ses ancres. */
  const LEGACY_HASHES = {
    "#pilotage": "patrimoine/placements", "#patrimoine": "patrimoine/placements",
    "#position": "pilotage/rang", "#foyer": "pilotage/rang", "#salaire": "pilotage/rang", "#emprunt": "pilotage/rang",
    "#acheter": "pilotage/scenarios", "#simulateur": "pilotage/scenarios", "#theorie": "pilotage/scenarios", "#explication": "pilotage/scenarios",
    "#budget": "patrimoine/budget", "#objectifs": "patrimoine/objectifs",
  };
  /* Paramètres d'un ancien lien du simulateur (D8, SCN1) : le simulateur acheter / louer est devenu un outil de Pilotage › Scénarios ; ses anciennes
     ancres et routes l'ouvrent toujours (#acheter, #simulateur, #theorie, #explication, #simu, decisions/acheter, App.go("simu")). La bibliothèque
     (decisions, decisions/autres) n'a pas de paramètre. */
  const OUTIL_SIMU = "outil=acheter-louer";
  const LEGACY_PARAMS = { "simu": OUTIL_SIMU, "decisions/acheter": OUTIL_SIMU, "#acheter": OUTIL_SIMU, "#simulateur": OUTIL_SIMU, "#theorie": OUTIL_SIMU, "#explication": OUTIL_SIMU };
  const DEFAULT_ROUTE = "aujourdhui/vue";
  /* Sous-vues dont les paramètres de lien profond restent dans l'URL (fiches en pleine page de Patrimoine › Comptes ; onglet et
     critère de Pilotage › Santé, #pilotage/sante?famille=<clé>&critere=<clé> : recharger la page, précédent / suivant et partager le
     lien rouvrent la même fiche ou le même critère). Ailleurs, l'URL est réécrite sans paramètres. */
  const PARAMS_DANS_URL = ["patrimoine/comptes", "pilotage/sante", "pilotage/scenarios"];
  /* Destinations où le sélecteur de périmètre (Foyer · prénoms) a un sens. */
  const SCOPED = ["aujourdhui", "patrimoine", "pilotage"];

  const spaceOf = id => SPACES.find(s => s.space === id) || null;
  /* Sous-vue par défaut d'une destination : la première qui a un module (Agent → Journal depuis CK2 ; une carte « Bientôt » n'est
     jamais la sous-vue par défaut). */
  const defSub = sp => (sp.subs.find(x => x.module) || sp.subs[0]).id;
  const subOf = (space, sub) => { const sp = spaceOf(space); return sp ? sp.subs.find(x => x.id === sub) || null : null; };
  /* « destination », « destination/sous-vue » ou ancienne route → { space, sub } ; sous-vue par défaut : dernière visitée,
     sinon la première qui a un module (defSub). Inconnu → null. */
  /* Lien profond « destination/sous-vue?cle=valeur » : sépare la route de ses paramètres → [route, "cle=valeur" | ""]. */
  function separerParametres(t) {
    const s = String(t == null ? "" : t), i = s.indexOf("?");
    return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
  }
  function resolve(target, sub, lastSubs) {
    if (target == null) return null;
    let t = separerParametres(String(target).replace(/^#/, ""))[0];
    if (!sub) {
      const old = t.split("/")[0];
      if (LEGACY[t]) t = LEGACY[t];
      else if (!spaceOf(old) && LEGACY[old]) t = LEGACY[old]; // sous-vue inconnue d'un ancien espace
    }
    let [space, s] = t.split("/");
    if (sub) s = sub;
    const sp = spaceOf(space);
    if (!sp) return null;
    if (!subOf(space, s)) s = lastSubs && subOf(space, lastSubs[space]) ? lastSubs[space] : defSub(sp);
    return { space, sub: s };
  }
  /* Hash d'URL → { space, sub, legacy } (legacy : le hash n'est pas sous forme canonique et sera réécrit).
     Hash inconnu → Aujourd'hui. Lien profond « #agent/journal?entree=<id> » : même route, plus query: "entree=<id>" ;
     legacy vrai (l'URL est réécrite sans les paramètres, que la coque retient pour la vue : App.parametres()). */
  function resolveHash(hash, lastSubs) {
    if (!hash || hash === "#") return null;
    const [h, q0] = separerParametres(hash);
    const query = q0 || LEGACY_PARAMS[h] || LEGACY_PARAMS[h.replace(/^#/, "")] || "";
    const avec = r => (query ? Object.assign(r, { query }) : r);
    if (LEGACY_HASHES[h]) return avec(Object.assign(resolve(LEGACY_HASHES[h]), { legacy: true }));
    const r = resolve(h, null, lastSubs) || resolve(DEFAULT_ROUTE);
    return avec(Object.assign(r, { legacy: hash !== hashCanonique(r, query) }));
  }
  /* Hash canonique d'une route : « #espace/sous-vue », suivi de « ?paramètres » pour les sous-vues de PARAMS_DANS_URL. */
  function hashCanonique(r, query) {
    const k = r.space + "/" + r.sub;
    return "#" + k + (query && PARAMS_DANS_URL.includes(k) ? "?" + query : "");
  }
  /* Fiche de Patrimoine › Comptes (spec CP1 § 2-3) : { enveloppe, titulaire? } | { ligne } | { courant } → route avec ses paramètres
     (« patrimoine/comptes?ligne=<id> ») ; règle unique dans comptes-view.js (ComptesView.lien). */
  const ComptesMod = () => (typeof window !== "undefined" && window.ComptesView) ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./comptes-view.js") : null);
  function lienCompte(cible) {
    const CV = ComptesMod();
    return CV && typeof CV.lien === "function" ? CV.lien(cible) : "patrimoine/comptes";
  }
  /* Focus après navigation (navigate) : sur le titre de page quand la destination change (pas pour un simple changement de
     sous-onglet, le focus reste sur l'onglet) ou quand l'élément actif a disparu (dans une vue ou un panneau masqués, ou BODY). */
  const focusApres = (avant, apres, perdu) => !!perdu || !!(avant && apres && avant.space !== apres.space);
  /* Légende de la pastille Agent pour les lecteurs d'écran (ajoutée après le nombre visible) : propositions de Claude en attente
     (p) et entrées du journal à relire (j) ; NaN compte pour 0. */
  function legendeAgent(p, j) {
    const n = v => (Number.isFinite(v) && v > 0 ? v : 0), P = n(p), Jr = n(j);
    const prop = k => k + " proposition" + (k > 1 ? "s" : "") + " de Claude à examiner", jour = k => k + " entrée" + (k > 1 ? "s" : "") + " du journal à relire";
    if (P && Jr) return " éléments à traiter : " + prop(P) + ", " + jour(Jr);
    return " " + (Jr ? jour(Jr) : prop(P)).replace(/^\d+ /, "");
  }
  /* Hash changé dans un onglet ouvert (à la main, précédent / suivant) : le navigateur émet popstate PUIS hashchange pour la même
     navigation. Sans garde, le second retraitement fermerait le panneau que la vue vient d'ouvrir (lien profond ?expertise=,
     ?entree=). doublonNavigation() → garde(e, href) : vrai pour le hashchange dont l'URL (newURL) est celle du popstate qui
     vient d'être traité (href lu avant tout replaceState) ; la garde s'efface alors, une navigation suivante est traitée. */
  function doublonNavigation() {
    let dejaVu = null; // URL d'un popstate déjà traité
    return (e, href) => {
      if (e && e.type === "hashchange" && dejaVu != null && e.newURL === dejaVu) { dejaVu = null; return true; }
      dejaVu = e && e.type === "popstate" ? href : null;
      return false;
    };
  }
  /* Retour de la page de connexion Powens (BQ1), via /powens/retour : app.html?connection_id=<chiffres> (succès) ou ?error=<code>
     (échec ou abandon), jamais error_description. → { ok, message, recherche } ou null (BanqueEtat.retourPowens, banque-etat.js) ;
     recherche = la query sans les paramètres du retour (les autres, comme demo, sont gardés). Le message est fixe, en français : la
     valeur des paramètres n'est jamais affichée ni réutilisée. auth.js retire ces paramètres de l'URL avant la création du client
     Supabase (detectSessionInUrl) et garde la query d'origine dans window.BOUSSOLE_RETOUR_BANQUE. */
  const BanqueEtatMod = () => (typeof window !== "undefined" && window.BanqueEtat) ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./banque-etat.js") : null);
  function retourBanque(search) {
    const BE = BanqueEtatMod();
    return BE && typeof BE.retourPowens === "function" ? BE.retourPowens(search) : null;
  }
  const routeOfModule = name => { for (const sp of SPACES) for (const s of sp.subs) if (s.module === name || (s.extras || []).includes(name)) return { space: sp.space, sub: s.id }; return null; };

  /* ---------- en-tête : fraîcheur, demandes à Claude, périmètre (pur, testé par test/shell.test.mjs et test/ux1-coque.test.mjs) ---------- */
  const ModOuvert = (nom, fichier) => (typeof window !== "undefined" && window[nom]) ||
    (typeof module === "object" && module.exports && typeof require === "function" ? (() => { try { return require(fichier); } catch (e) { return null; } })() : null);
  const FmtMod = () => ModOuvert("Fmt", "./format.js");
  const HEURES_VIEUX = 36;
  /* Point de fraîcheur de l'en-tête : « ok » (vert) si l'agent est passé il y a moins de 36 h, « vieux » (ambre) au-delà, « inconnu » (gris)
     sans donnée ou pendant le chargement. À défaut de passage de l'agent, la date du dernier cours sert de repère. Les lignes alimentent la
     feuille « Sources et mises à jour ». S : état du store ; now : Date ou horodatage (tests). */
  function fraicheur(S, now) {
    const F = FmtMod(), fd = (d, o) => (F ? F.fmtDate(d, o) : String(d));
    const maintenant = now == null ? new Date() : now instanceof Date ? now : new Date(now);
    S = S || {};
    if (S.dbOk === false) return { etat: "inconnu", resume: "données indisponibles", phrase: "Les données ne sont pas disponibles pour le moment.", lignes: [{ label: "Données", valeur: "indisponibles pour le moment" }] };
    if (!S.ready) return { etat: "inconnu", resume: "chargement des données", phrase: "Chargement des données en cours.", lignes: [{ label: "Données", valeur: "chargement en cours" }] };
    const cours = (S.positions || []).filter(p => p && p.mode === "market" && p.priceDate).map(p => p.priceDate).sort();
    const dernierCours = cours[cours.length - 1] || null;
    const run = S.status && S.status.lastRun ? S.status.lastRun : null;
    const tRun = run ? Date.parse(run) : NaN;
    const repere = Number.isFinite(tRun) ? tRun : dernierCours ? Date.parse(dernierCours + "T23:00:00Z") : NaN;
    const age = Number.isFinite(repere) ? (maintenant.getTime() - repere) / 36e5 : NaN;
    const etat = !Number.isFinite(age) ? "inconnu" : age > HEURES_VIEUX ? "vieux" : "ok";
    const lignes = [
      { label: "Cours des placements", valeur: dernierCours ? "au " + fd(dernierCours, { court: true }) : "pas encore mis à jour" },
      { label: "Mise à jour de nuit", valeur: Number.isFinite(tRun) ? fd(run, { maintenant }) : "pas encore faite" },
    ];
    const lr = S.status && S.status.veille && S.status.veille.lastReport, tv = lr ? Date.parse(lr) : NaN;
    lignes.push({ label: "Veille de Claude", valeur: Number.isFinite(tv) ? fd(lr, { maintenant }) : "pas encore faite" });
    const resume = etat === "ok" ? "à jour" : etat === "vieux" ? "mise à jour de plus de " + HEURES_VIEUX + " h" : "aucune mise à jour connue";
    const phrase = etat === "ok" ? "Dernière mise à jour il y a moins de " + HEURES_VIEUX + " h." : etat === "vieux" ? "Plus de " + HEURES_VIEUX + " h sans mise à jour : les cours affichés peuvent avoir bougé." : "Aucune mise à jour connue pour le moment.";
    return { etat, resume, phrase, lignes };
  }
  /* Demandes contextuelles du bouton Claude de l'en-tête (3 par destination ou sous-vue) : { label, section } ; la phrase vient de
     ClaudePrompts.phrase(section). Une seule action Claude par écran, toujours au même endroit. */
  const DEMANDES = {
    "aujourdhui": [["Faire ma revue du mois", "revue"], ["Compléter mon bilan", "bilan"], ["Enregistrer un mouvement", "mouvement"]],
    "patrimoine/placements": [["Enregistrer un mouvement", "mouvement"], ["Mettre à jour mes placements", "placements"], ["Régler mes versements programmés", "versements"]],
    "patrimoine/comptes": [["Mettre à jour mes placements", "placements"], ["Renseigner mes biens et mes crédits", "immobilier"], ["Enregistrer un mouvement", "mouvement"]],
    "patrimoine/immobilier": [["Renseigner mes biens et mes crédits", "immobilier"], ["Compléter mon bilan", "bilan"], ["Compléter mon calendrier", "calendrier"]],
    "patrimoine/budget": [["Établir mon budget", "budget"], ["Compléter mes revenus", "revenus"], ["Définir mes objectifs", "objectifs"]],
    "patrimoine/objectifs": [["Définir mes objectifs", "objectifs"], ["Établir mon budget", "budget"], ["Compléter mon bilan", "bilan"]],
    "pilotage": [["Compléter mon bilan", "bilan"], ["Remplir mon profil de risque", "risque"], ["Définir mes objectifs", "objectifs"]],
    "agent": [["Faire ma revue du mois", "revue"], ["Répondre aux questions de ma revue", "routine"], ["Consulter une expertise", "expertise"]],
    "compte/connexion": [["Compléter mon bilan", "bilan"], ["Faire ma revue du mois", "revue"], ["Répondre aux questions de ma revue", "routine"]],
    "compte": [["Compléter mon foyer", "foyer"], ["Renseigner ma protection", "protection"], ["Régler mes règles d'alerte", "regles"]],
  };
  /** Les 3 demandes de la route : celles de « destination/sous-vue » si elles existent, sinon celles de la destination. */
  function demandesClaude(space, sub) {
    return (DEMANDES[space + "/" + sub] || DEMANDES[space] || DEMANDES.aujourdhui).map(([label, section]) => ({ label, section }));
  }
  /* Entrées du sélecteur de périmètre : Foyer + une par personne, avec le patrimoine net de chacune quand le calcul est disponible. */
  function entreesPerimetre(S) {
    S = S || {};
    const C = ModOuvert("Calc", "./calc.js"), F = FmtMod();
    const ppl = Array.isArray(S.people) ? S.people : [];
    const items = [{ id: "foyer", nom: "Foyer" }].concat(ppl.map((p, i) => ({ id: p.id, nom: String(p.nom || "").trim() || (i ? "Conjoint(e)" : "Moi") })));
    return items.map(x => {
      let net = null;
      try { const r = C && typeof C.patrimoine === "function" ? C.patrimoine(S.positions || [], S.profil || null, x.id) : null; net = r && Number.isFinite(r.net) ? r.net : null; } catch (e) { net = null; }
      return { id: x.id, nom: x.nom, net, montant: net != null && F ? F.fmtEUR(net) : null, actif: x.id === (S.scope || "foyer") };
    });
  }

  /* ---------- navigateur ---------- */
  function browser() {
    const ICONS = {
      compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
      aujourdhui: '<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
      patrimoine: '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>',
      pilotage: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
      agent: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
      compte: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>',
      reglages: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    };
    const svg = (k, cls) => '<svg class="' + (cls || "ico") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[k] + "</svg>";
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const mods = {};
    const mounted = new Set();
    const lastSubs = {};
    let route = null;
    /* Paramètres d'un lien profond (#agent/journal?entree=<id>, App.go("agent/journal?entree=<id>")) : retenus pour la route
       visée, lus une fois par la vue (App.parametres()), oubliés si l'on navigue ailleurs. */
    let lien = null;
    const retenirLien = (r, query) => {
      if (!query) return;
      const params = {};
      try { new URLSearchParams(query).forEach((v, k) => { params[k] = v; }); } catch (e) { return; }
      lien = { cle: r.space + "/" + r.sub, params };
    };
    const key = r => r.space + "/" + r.sub;
    const panelOf = r => document.querySelector('section.view[data-space="' + r.space + '"][data-sub="' + r.sub + '"]');
    const isActive = name => { const r = routeOfModule(name); return !!(r && r.space === route.space && r.sub === route.sub); };

    /* Route de départ : hash (nouveau ou ancien) > dernière route mémorisée > Aujourd'hui. */
    try { const saved = resolve(localStorage.getItem("app-route")); if (saved) { route = saved; lastSubs[saved.space] = saved.sub; } } catch (e) {}
    const fromHash = resolveHash(location.hash, lastSubs);
    if (fromHash) { route = { space: fromHash.space, sub: fromHash.sub }; retenirLien(route, fromHash.query); }
    if (!route) route = resolve(DEFAULT_ROUTE);
    lastSubs[route.space] = route.sub;

    const App = {
      register(name, m) { mods[name] = m; },
      /* Module de la sous-vue active (compatibilité) ; App.route() donne { space, sub }. */
      active: () => { const s = subOf(route.space, route.sub); return s && s.module; },
      route: () => ({ space: route.space, sub: route.sub }),
      spaces: () => SPACES,
      /* App.go("patrimoine"), App.go("patrimoine", "budget"), App.go("patrimoine/budget"), ancienne route App.go("avenir/plan")
         ou ancien onglet App.go("plan"). */
      go(target, sub) {
        const r = resolve(target, sub, lastSubs);
        if (!r) return;
        const [t0, q0] = separerParametres(String(target).replace(/^#/, "")), q = sub ? "" : q0 || LEGACY_PARAMS[t0] || "";
        if (!sub) retenirLien(r, q);
        navigate(r, { push: true, scroll: true, query: q });
      },
      /* Ouvre une fiche de Patrimoine › Comptes : App.ouvrir({ enveloppe, titulaire }), App.ouvrir({ ligne }), App.ouvrir({ courant }).
         App.lienCompte(cible) → « patrimoine/comptes?… » pour un href « #… » ou un data-goto. */
      ouvrir(cible) { App.go(lienCompte(cible)); },
      lienCompte,
      /* Paramètres du lien profond qui a mené à la vue active ({ entree: "<id>" }…) ; {} sinon. Lus une seule fois. */
      parametres() {
        if (!lien || lien.cle !== key(route)) return {};
        const p = lien.params; lien = null; return p;
      },
      /* Les mêmes paramètres, sans les consommer (savoir-view choisit son volet avant que expertises-view lise le sien). */
      parametresActuels() { return lien && lien.cle === key(route) ? Object.assign({}, lien.params) : {}; },
    };
    window.App = App;
    /* Les modules chargés avant app.js ont mis leur enregistrement en attente. */
    (window.__pending || []).forEach(reg => reg());
    window.__pending = [];

    /* Élément actif perdu : BODY, ou à l'intérieur d'un élément masqué (vue quittée, panneau fermé par un lien). */
    const focusLost = () => { const a = document.activeElement; return !a || a === document.body || !!(a.closest && a.closest("[hidden]")); };
    const focusTitle = () => { const h = $("spaceTitle"); if (!h) return; try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } };
    /* o.focus === false : pas de déplacement du focus (chargement initial). */
    function navigate(r, o) {
      o = o || {};
      const changed = key(r) !== key(route), before = route;
      route = r;
      if (lien && lien.cle !== key(r)) lien = null; // paramètres d'une autre vue : oubliés
      lastSubs[r.space] = r.sub;
      try { localStorage.setItem("app-route", key(r)); } catch (e) {}
      /* Fiches de Comptes : chaque fiche (et le retour à la liste) est une entrée d'historique, même sans changer de sous-vue. */
      const h = hashCanonique(r, o.query);
      if (o.push && (changed || PARAMS_DANS_URL.includes(key(r))) && location.hash !== h) history.pushState(null, "", h);
      document.querySelectorAll("section.view[data-space]").forEach(v => { v.hidden = !(v.dataset.space === r.space && v.dataset.sub === r.sub); });
      renderChrome();
      const s = subOf(r.space, r.sub);
      [s && s.module].concat((s && s.extras) || []).filter(Boolean).forEach(nom => {
        const m = mounted.has(nom) ? mods[nom] : null;
        if (m && m.show) try { m.show(); } catch (e) { console.error(nom, e); }
      });
      refreshHeadlines();
      if (o.focus !== false && changed && focusApres(before, r, focusLost())) focusTitle();
      if (o.scroll && changed && window.scrollY > 0) window.scrollTo({ top: 0 });
    }

    /* Titres de groupe de la barre latérale (visibles à partir de 1 680 px seulement) : « Suivre » devant Aujourd'hui, « Claude » devant Agent. */
    const GROUPES_NAV = { aujourdhui: "Suivre", agent: "Claude" };
    const hrefOf = space => "#" + space + "/" + (lastSubs[space] || defSub(spaceOf(space)));
    function navItem(sp, bar) {
      return '<a class="' + (bar ? "bb-item" : "nav-item") + '" href="' + hrefOf(sp.space) + '" data-nav="' + sp.space + '">' +
        (bar ? '<span class="bb-ico">' + svg(sp.icon) + "</span>" : svg(sp.icon)) +
        '<span class="nl">' + esc(bar ? sp.short : sp.label) + "</span>" +
        (sp.space === "aujourdhui" ? '<span class="pill-count" data-today-count hidden></span>' : "") +
        (sp.space === "agent" ? '<span class="pill-dot" data-prop-count hidden></span>' : "") + "</a>";
    }
    /* Rail (ordinateur) et barre basse (mobile) : les 4 destinations primaires. Compte (non primaire) : pied du rail,
       et bouton avatar #profileBtn de l'en-tête mobile. */
    function renderNav() {
      const prim = SPACES.filter(s => s.primary), rest = SPACES.filter(s => !s.primary);
      $("sideNav").innerHTML = prim.map(s => (GROUPES_NAV[s.space] ? '<p class="nav-groupe" aria-hidden="true">' + esc(GROUPES_NAV[s.space]) + "</p>" : "") + navItem(s)).join("");
      $("sideCompte").innerHTML = rest.map(s => navItem(s)).join("");
      $("bottomBar").innerHTML = prim.map(s => navItem(s, true)).join("");
    }
    function renderChrome() {
      const sp = spaceOf(route.space);
      document.querySelectorAll("[data-nav]").forEach(a => {
        if (a.dataset.nav === route.space) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
        a.setAttribute("href", hrefOf(a.dataset.nav));
      });
      const pb = $("profileBtn"); if (route.space === "compte") pb.setAttribute("aria-current", "page"); else pb.removeAttribute("aria-current");
      $("spaceTitle").textContent = sp.label;
      $("spaceDesc").textContent = sp.desc;
      document.title = sp.label + " · Boussole";
      $("accountLinkC").hidden = route.space !== "compte" || Store.mode === "demo";
      scopeVisibility();
      const tabs = $("subTabs");
      tabs.setAttribute("aria-label", "Sous-vues : " + sp.label);
      $("tabsWrap").hidden = sp.subs.length < 2;
      tabs.innerHTML = sp.subs.map(s => {
        const on = s.id === route.sub; const p = panelOf({ space: sp.space, sub: s.id });
        return '<button type="button" role="tab" id="subtab-' + sp.space + "-" + s.id + '"' + (p && p.id ? ' aria-controls="' + p.id + '"' : "") +
          ' aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-sub="' + s.id + '"><span>' + esc(s.label) + "</span></button>";
      }).join("");
      /* Sous-onglets plus larges que l'écran (mobile) : fondu de bord (data-fade) et l'onglet actif reste visible. */
      const d = window.UI && UI.defilant ? UI.defilant(tabs) : null;
      if (d) { d.montrerActif(); d.maj(); }
    }

    /* Nombre entier renvoyé par headline() du module branché sur espace/sous-vue ; NaN sinon. */
    function countOf(space, sub) {
      const s = subOf(space, sub); const m = s && s.module ? mods[s.module] : null;
      let v = null;
      if (m && m.headline) try { v = m.headline(); } catch (e) { v = null; }
      return v == null || !/^\s*\d+\s*$/.test(String(v)) ? NaN : parseInt(v, 10);
    }
    /* Pastilles (seuls compteurs de l'interface) : Aujourd'hui (éléments de la boîte de réception, headline() du module
       aujourdhui) et Agent (propositions de Claude en attente, headline() du module propositions, + entrées du journal à relire,
       headline() du module journal-view ; à défaut, S.journalARelire du store). */
    function refreshHeadlines() {
      /* Le nombre visible, suivi de sa légende pour les lecteurs d'écran (texte .ui-sr : un aria-label sur <span> n'est pas lu). */
      const pill = (sel, n, suffix, point) => {
        const show = Number.isFinite(n) && n > 0;
        document.querySelectorAll(sel).forEach(el => {
          /* point : pastille sans chiffre (Agent) ; le nombre reste lu aux lecteurs d'écran */
          el.hidden = !show; el.textContent = show && !point ? String(n) : "";
          if (show) { const s = document.createElement("span"); s.className = "ui-sr"; s.textContent = suffix(n); el.appendChild(s); }
        });
      };
      pill("[data-today-count]", countOf("aujourdhui", "vue"), n => " élément" + (n > 1 ? "s" : "") + " à traiter");
      const p = countOf("agent", "propositions");
      let j = countOf("agent", "journal");
      if (!Number.isFinite(j)) {
        const S = window.Store && Store.get();
        j = S && Number.isFinite(S.journalARelire) ? S.journalARelire : S && Array.isArray(S.journal) ? S.journal.filter(e => e && e.statut === "a_relire").length : NaN;
      }
      pill("[data-prop-count]", Number.isFinite(p) || Number.isFinite(j) ? (Number.isFinite(p) ? p : 0) + (Number.isFinite(j) ? j : 0) : NaN, () => legendeAgent(p, j), true);
    }

    const frDate = d => new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    function header(S) {
      const mk = S.positions.filter(p => p.mode === "market" && p.priceDate).map(p => p.priceDate).sort();
      const last = mk[mk.length - 1];
      let t = S.dbOk === false ? "Données indisponibles dans cette vue" : !S.ready ? "Chargement des données…" :
        (last ? "Cours au " + frDate(last) : "Cours non encore mis à jour") + (S.status && S.status.lastRun ? " · mise à jour de nuit le " + new Date(S.status.lastRun).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
      $("fresh").textContent = t;
      majFraicheur(S);
      const b = $("dbBanner");
      if (S.dbOk === false) { b.hidden = false; b.textContent = "Connexion à ton espace impossible pour le moment. Recharge la page ; si le problème persiste, reconnecte-toi."; }
      else if (S.error) { b.hidden = false; b.textContent = "Lecture des données interrompue (" + S.error + "). Recharge la page."; }
      else b.hidden = true;
      majPerimetre(S);
      veille(S);
    }
    /* Point de fraîcheur de l'en-tête (vert, ambre au-delà de 36 h, gris sans donnée) ; sa feuille liste les sources. */
    let derniereFraicheur = null;
    function majFraicheur(S) {
      const f = derniereFraicheur = fraicheur(S);
      const b = $("freshBtn");
      b.dataset.etat = f.etat;
      b.setAttribute("aria-label", "Sources et mises à jour : " + f.resume);
    }
    /* Périmètre (chip « Foyer ▾ » de l'en-tête, global et persistant) : s'ouvre en feuille « Foyer · prénoms » avec le patrimoine net de chacun ;
       masqué s'il n'y a qu'une personne et hors des destinations SCOPED (Agent, Compte). */
    let scopeMany = false, dernierS = null;
    function scopeVisibility() {
      const on = scopeMany && SCOPED.includes(route.space);
      $("scopeBtn").hidden = !on;
    }
    function majPerimetre(S) {
      dernierS = S;
      const entrees = entreesPerimetre(S), cur = entrees.find(x => x.actif) || entrees[0];
      $("scopeNom").textContent = cur.nom;
      $("scopeBtn").setAttribute("aria-label", "Périmètre : " + cur.nom + ". Changer");
      scopeMany = (Array.isArray(S.people) ? S.people : []).length >= 2;
      scopeVisibility();
      if (window.UI && UI.panneau && UI.panneau.ouvert() && ouverte === "perimetre") ouvrirPerimetre(true);
    }
    /* Feuilles de l'en-tête : une à la fois (périmètre, Claude, sources) ; ouverte retient laquelle pour la rafraîchir. */
    let ouverte = null;
    const apresFermeture = () => { ouverte = null; };
    function ouvrirPerimetre(rafraichir) {
      const S = dernierS || Store.get(), entrees = entreesPerimetre(S);
      const lignes = entrees.map(x => UI.ligne({ id: x.id, titre: x.nom, sous: x.actif ? "Affiché maintenant" : x.id === "foyer" ? "Toutes les personnes du foyer" : "Ses comptes seulement", montant: x.montant || "", icone: x.id === "foyer" ? "maison" : "personne" }));
      const contenu = '<p class="ui-panneau-note">Le périmètre s\'applique à Aujourd\'hui, Patrimoine et Pilotage, et reste choisi d\'une visite à l\'autre.</p>' + UI.liste(lignes, { label: "Périmètre" });
      ouverte = "perimetre";
      const o = { titre: "Périmètre", contenu, retour: $("scopeBtn"), surFermeture: apresFermeture };
      if (rafraichir) UI.panneau.remplacer({ titre: o.titre, contenu }); else UI.panneau.ouvrir(o);
      document.querySelectorAll(".ui-panneau [data-ui-ligne]").forEach(b => { b.setAttribute("data-scope", b.getAttribute("data-ui-ligne")); b.setAttribute("aria-pressed", String(b.getAttribute("data-ui-ligne") === (S.scope || "foyer"))); });
    }
    function ouvrirClaude() {
      const CP = window.ClaudePrompts;
      const lignes = demandesClaude(route.space, route.sub).map(d => UI.ligne({ href: UI.urlClaude(CP && CP.phrase ? CP.phrase(d.section) : d.label), titre: d.label, icone: "etincelle", multiligne: true }));
      ouverte = "claude";
      UI.panneau.ouvrir({ titre: "Demander à Claude", retour: $("claudeBtn"), surFermeture: apresFermeture,
        contenu: '<p class="ui-panneau-note">Claude ouvre ta session Boussole et te pose les questions qui manquent, dans des formulaires. Tu valides avant tout enregistrement.</p>' + UI.liste(lignes, { label: "Demandes pour cette page" }) });
    }
    function ouvrirFraicheur() {
      const f = derniereFraicheur || fraicheur(Store.get());
      const lignes = f.lignes.map(l => UI.ligne({ titre: l.label, montant: l.valeur }));
      ouverte = "fraicheur";
      UI.panneau.ouvrir({ titre: "Sources et mises à jour", retour: $("freshBtn"), surFermeture: apresFermeture,
        contenu: '<p class="ui-panneau-note"><span class="ui-puce ' + (f.etat === "ok" ? "bon" : f.etat === "vieux" ? "surveiller" : "completer") + '"><span class="ui-puce-point" aria-hidden="true"></span>' + esc(f.etat === "ok" ? "À jour" : f.etat === "vieux" ? "À rafraîchir" : "Inconnu") + "</span> " + esc(f.phrase) + "</p>" + UI.liste(lignes, { label: "Sources" }),
        lien: { label: "Voir la connexion de Claude", href: "#compte/connexion" } });
    }
    /* État de la veille : S.status.veille.lastReport (date ISO ou horodatage) ; alerte au-delà de 8 jours. */
    function veille(S) {
      const el = $("veilleLine");
      const lr = S.status && S.status.veille && S.status.veille.lastReport;
      const t = lr ? new Date(lr).getTime() : NaN;
      if (!Number.isFinite(t)) { el.textContent = "Veille de Claude : pas encore faite"; el.classList.remove("warn"); return; }
      const d = Math.max(0, Math.floor((Date.now() - t) / 864e5));
      el.textContent = d === 0 ? "Veille de Claude : aujourd'hui" : "Veille de Claude : il y a " + d + " j";
      el.classList.toggle("warn", d > 8);
    }

    /* Précédent / suivant, hash saisi à la main ou lien <a href="#…"> : on suit le hash (forme ancienne réécrite). */
    const doublon = doublonNavigation();
    function onHash(e) {
      /* hashchange d'une navigation déjà traitée au popstate : ignoré, et caché à l'écouteur du panneau (posé après celui-ci). */
      if (doublon(e, location.href)) { e.stopImmediatePropagation(); return; }
      /* Retour arrière avec le panneau de détail ouvert : il se ferme d'abord (sans reprendre le focus), sinon le reste de la
         page est encore inerte quand navigate() pose le focus sur le titre (window appelle cet écouteur avant celui du panneau). */
      if (window.UI && UI.panneau && UI.panneau.ouvert()) UI.panneau.fermer({ focus: false });
      const r = resolveHash(location.hash, lastSubs);
      if (!r) return;
      if (r.legacy) history.replaceState(null, "", hashCanonique(r, r.query)); // paramètres gardés dans l'URL pour les sous-vues de PARAMS_DANS_URL
      retenirLien(r, r.query);
      /* Lien profond vers la vue déjà affichée : navigate() rappelle show(), qui lit les paramètres. */
      if (key(r) !== key(route) || r.query) navigate({ space: r.space, sub: r.sub }, {});
      else if (PARAMS_DANS_URL.includes(key(r))) navigate({ space: r.space, sub: r.sub }, {}); // retour d'une fiche à la liste
    }

    const ANON_KEY = "boussole.anonBanner.masque";
    function anonAccount(session) {
      const anon = !!(session && session.user && session.user.is_anonymous);
      let masked = false;
      try { masked = sessionStorage.getItem(ANON_KEY) === "1"; } catch (e) { /* stockage indisponible : bandeau affiché */ }
      const b = $("anonBanner");
      if (b) {
        b.hidden = !anon || masked;
        const x = $("anonBannerClose");
        if (x && !x.dataset.bound) {
          x.dataset.bound = "1";
          x.addEventListener("click", () => { b.hidden = true; try { sessionStorage.setItem(ANON_KEY, "1"); } catch (e) { /* rien */ } });
        }
      }
      const link = $("accountLink"), linkM = $("accountLinkM"), linkC = $("accountLinkC"); // linkM : ancien engrenage mobile, retiré de l'en-tête (le lien vit dans Compte)
      const label = anon ? "Sécuriser mon compte" : "Mon compte", labelM = anon ? "Sécuriser mon compte" : "Sécurité du compte", href = anon ? "compte.html#securiser" : "compte.html";
      if (link) { link.textContent = label; link.href = href; }
      if (linkC) { linkC.textContent = anon ? "Sécuriser mon compte (e-mail, mot de passe)" : "Mon compte : e-mail, sécurité, export"; linkC.href = href; }
      if (linkM) { linkM.href = href; linkM.setAttribute("aria-label", labelM); linkM.title = labelM; }
    }

    function boot() {
      document.querySelectorAll("[data-brand-icon]").forEach(el => { el.innerHTML = svg("compass", "brand-ico"); });
      $("profileBtn").innerHTML = '<span class="avatar">' + svg("compte") + "</span>";
      document.querySelectorAll("[data-claude-icon]").forEach(el => { el.innerHTML = svg("agent"); });
      renderNav();
      const tabs = $("subTabs");
      /* Les onglets sont redessinés à chaque navigation : le focus suit l'onglet choisi (clic comme clavier). */
      const focusTab = () => { const b = $("subtab-" + route.space + "-" + route.sub); if (b) b.focus(); };
      tabs.addEventListener("click", e => { const b = e.target.closest("[data-sub]"); if (b) { App.go(route.space, b.dataset.sub); focusTab(); } });
      tabs.addEventListener("keydown", e => {
        const subs = spaceOf(route.space).subs.map(s => s.id); let i = subs.indexOf(route.sub);
        if (e.key === "ArrowRight") i = (i + 1) % subs.length; else if (e.key === "ArrowLeft") i = (i + subs.length - 1) % subs.length;
        else if (e.key === "Home") i = 0; else if (e.key === "End") i = subs.length - 1; else return;
        e.preventDefault();
        App.go(route.space, subs[i]);
        focusTab();
      });
      document.addEventListener("click", e => {
        /* Lien interne du panneau de détail : le panneau se ferme sans rendre le focus ; s'il pointe vers la vue courante
           (pas de navigation), le focus irait sur BODY : on le pose sur le titre de page. */
        if (e.target.closest && e.target.closest('.ui-panneau a[href^="#"]')) setTimeout(() => { if (focusLost()) focusTitle(); }, 0);
        const sc = e.target.closest(".ui-panneau [data-scope]"); if (sc) { Store.setScope(sc.dataset.scope); UI.panneau.fermer(); return; }
        if (e.target.closest("#scopeBtn")) { ouvrirPerimetre(); return; }
        if (e.target.closest("#claudeBtn")) { ouvrirClaude(); return; }
        if (e.target.closest("#freshBtn")) { ouvrirFraicheur(); return; }
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const n = e.target.closest("[data-nav]"); if (n) { e.preventDefault(); App.go(n.dataset.nav); return; }
        const t = e.target.closest("[data-goto-tab]"); if (t) { e.preventDefault(); App.go(t.dataset.gotoTab); return; }
        /* [data-goto] : liens internes « espace/sous-vue » (les anciens noms d'onglets seuls passent par [data-goto-tab]) ; une valeur
           sans « / » ou inconnue est laissée au navigateur. */
        const g = e.target.closest("[data-goto]"); if (g && g.dataset.goto.includes("/") && resolve(g.dataset.goto)) { e.preventDefault(); App.go(g.dataset.goto); }
      });
      /* Montage de chaque module enregistré dont le conteneur #view-<module> existe. Le hash d'origine est encore
         intact à ce stade : la Toise (#foyer…) et le Simulateur (#theorie…) le lisent pour leur sous-onglet. */
      Object.keys(mods).forEach(k => {
        const m = mods[k]; const root = $("view-" + k); if (!root) return;
        try { if (m.mount) m.mount(root); mounted.add(k); } catch (e) { console.error(k, e); }
      });
      const demo = Store.mode === "demo";
      $("accountLink").hidden = demo;
      /* Bandeau démo : repliable pour la session de l'onglet. */
      const DEMO_KEY = "boussole.demoBanner.masque";
      let demoMasque = false;
      try { demoMasque = sessionStorage.getItem(DEMO_KEY) === "1"; } catch (e) { /* stockage indisponible : bandeau affiché */ }
      $("demoBanner").hidden = !demo || demoMasque;
      /* Une seule mention « démo » à la fois : le bandeau de la page, ou, une fois masqué, l'encart du pied de la barre latérale. */
      const mentionDemo = () => { $("sideDemo").hidden = !demo || !$("demoBanner").hidden; };
      mentionDemo();
      $("demoBannerClose").addEventListener("click", () => { $("demoBanner").hidden = true; try { sessionStorage.setItem(DEMO_KEY, "1"); } catch (e) { /* rien */ } mentionDemo(); focusTitle(); });
      /* Compte anonyme (« Commencer sans e-mail ») : bandeau #anonBanner (masquable pour la session de l'onglet)
         et « Sécuriser mon compte » à la place de « Mon compte ». Seulement en mode Supabase ; la démo ne change pas. */
      if (!demo && window.Auth && typeof Auth.session === "function") {
        Auth.session().then(anonAccount, () => {});
        if (typeof Auth.onChange === "function") Auth.onChange((ev, s) => { if (s) anonAccount(s); });
      }
      let onboardingShown = false;
      /* Accueil (accueil.js) : bienvenue, connexion de Claude, entretien, suivi et validation. Aucune saisie dans l'app :
         Boussole fonctionne avec un assistant, la seule écriture est « onboarding terminé » (Store.markOnboarded, dans l'accueil).
         Aussi rouvert depuis Compte › Connexion (« Revoir l'accueil ») par App.accueil({ etape: 1 }). */
      App.accueil = o => {
        if (!window.Accueil) return false;
        Accueil.open(Object.assign({}, o || {}));
        return true;
      };
      /* ?accueil dans l'URL : force l'ouverture (démo comprise) pour tester le parcours. */
      const forceAccueil = new URLSearchParams(location.search).has("accueil");
      /* Une fois par chargement, pour un compte réel qui n'a pas terminé l'onboarding (sauf « Reprendre plus tard »
         dans cet onglet). */
      function maybeOnboard(S) {
        if (onboardingShown || !S.ready || !window.Accueil) return;
        if (forceAccueil) { onboardingShown = true; Accueil.open({ etape: 1 }); return; }
        if (demo || !S.dbOk || S.onboardingDone) return;
        onboardingShown = true;
        if (!Accueil.reporte()) Accueil.open({});
      }
      Store.on(S => {
        maybeOnboard(S);
        header(S);
        mounted.forEach(k => { const m = mods[k]; if (m.update) try { m.update(S, isActive(k)); } catch (e) { console.error(k, e); } });
        refreshHeadlines();
      });
      /* Retour de la page Powens : message (succès ou échec), Compte › Connexion ouvert, paramètres retirés de l'URL ; en cas de
         succès, le store est relu à 5 s puis à 15 s (la synchronisation se fait côté serveur, à la réception de la notification). */
      const retour = retourBanque(window.BOUSSOLE_RETOUR_BANQUE || location.search);
      if (retour) {
        route = resolve("compte/connexion"); lastSubs.compte = "connexion"; retenirLien(route, "volet=banques");
        history.replaceState(null, "", location.pathname + retour.recherche + "#compte/connexion");
        const bb = $("banqueBanner");
        if (bb) {
          bb.setAttribute("role", retour.ok ? "status" : "alert");
          bb.classList.toggle("err", !retour.ok);
          $("banqueBannerTxt").textContent = retour.message;
          bb.hidden = false;
          $("banqueBannerClose").addEventListener("click", () => { bb.hidden = true; focusTitle(); });
        }
        if (retour.ok) [5000, 15000].forEach(ms => setTimeout(() => Store.reload(), ms));
      }
      navigate(route, { focus: false });
      /* Après le montage : l'URL prend la forme canonique, sans entrée d'historique supplémentaire. */
      const canon = hashCanonique(route, fromHash && key(fromHash) === key(route) ? fromHash.query : "");
      if (location.hash !== canon) history.replaceState(null, "", canon);
      window.addEventListener("hashchange", onHash);
      window.addEventListener("popstate", onHash);
      header(Store.get());
      Store.emit();
    }
    App.refreshHeadlines = refreshHeadlines;
    App.anonAccount = anonAccount; // bandeau compte anonyme (appelé au démarrage ; exposé pour les vérifications en console)
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
  }

  if (typeof document !== "undefined") browser();
  if (typeof module === "object" && module.exports) module.exports = { SPACES, PARAMS_DANS_URL, LEGACY_PARAMS, hashCanonique, lienCompte, LEGACY, LEGACY_HASHES, DEFAULT_ROUTE, SCOPED, resolve, resolveHash, separerParametres, routeOfModule, defSub, focusApres, legendeAgent, doublonNavigation, retourBanque, fraicheur, demandesClaude, entreesPerimetre, DEMANDES, HEURES_VIEUX };
})();
