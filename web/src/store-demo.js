/* Store démo : même contrat que store-supabase.js, en mémoire, sur les données de window.DEMO (demo-data.js).
   Rien n'est enregistré : les écritures de contrôle (propositions, journal, mémoire, bascule des routines, règles, profil de risque recalculé)
   modifient la mémoire puis réémettent ; comme store-supabase.js, la façade `db` refuse toute autre écriture (lecture seule).

   Choix du mode au démarrage (pas de store.js intermédiaire) : chaque adaptateur vérifie lui-même son mode
   et seul celui qui correspond installe window.Store. Ce fichier s'installe quand l'URL contient `demo`
   (app.html?demo ; app.html?demo=vide pour un foyer sans aucune donnée) ou quand window.BOUSSOLE_MODE === "demo" ; store-supabase.js s'installe dans tous les
   autres cas. L'ordre des <script> est fixé par build.mjs : config.js, supabase-js, calc, demo-data,
   sensible, routine-etat, banque-etat, store-demo, store-supabase, auth, reel, modules, app.

   Contrat : window.Store = { get(), on(fn), setScope(s), emit(), db, mode, reload(), propositions, memoire, savoir, expertises, journal, routines, plansFiges, surveillerConnexions(on), cours(isins, depuis), transactions(depuis), markOnboarded(), banque, historique, scenarios }
   db = { doc("config/main").update({ rules }), doc("profil/main").update({ risque }) } : seules écritures hors API dédiées (lecture seule).
   S = { ready, dbOk, positions, snapshots, tx, config, status, profil, profilLoaded, budget, objectifs, risque, classes, propositions, connexions, memoire, savoir, expertises, journal, journalARelire, journalConsentement, routines, routinesLues, banque, scope, people, user, error, scenarios }
   budget = { lignes: [...] } | null ; objectifs = [{ id, nom, type, cible, dateCible, deja, source, poches, enveloppes, rendement, priorite }]
   risque = { reponses, profil, score, date } | null ; classes = { <poche>: <classe> } ; profil.protection = { prevoyance, emprunteur } ;
   positions[] portent ter, zone, devise, annoteSource, annoteLe (annotations de l'instrument) et symbol (null en démo) ;
   config.frais_enveloppes = frais des contrats (0026 ; {} par défaut), réglés par proposition (cible config, mêmes règles qu'en base) ;
   config.suivi = politique de suivi des lignes (0032 ; {} par défaut), position.role / roleSource = rôle de la ligne (réserve, cœur, satellite ; null = proposé par Suivi) ;
  config.enveloppes_infos, prets_infos, donations, avis_impot (0029, calendrier patrimonial : {}, {}, [], {} par défaut), même principe.
   propositions = [{ id, lot, cible, operation, ref, avant, apres, source, justification, statut, creeLe, decideLe }] (toutes, les plus
   récentes d'abord) ; Store.propositions.appliquer(ids, modifications) / refuser(ids) les décident en mémoire (même effet que la
   fonction SQL appliquer_propositions, voir l'en-tête de store-supabase.js), réglages compris (0019 : cible config, matelas et
   versements programmés ; clé classes du profil → S.classes).
   db.doc("profil/main").update({ risque }) ne touche que cette clé ; db.doc("config/main").update({ rules }) que les règles.
   connexions = [{ clientId, clientNom, premierLe, dernierLe, appels }] (vide au départ : aucun assistant connecté) ;
   Store.surveillerConnexions(true) simule la connexion de Claude 4 s plus tard (pour montrer le voyant de l'onboarding),
   surveillerConnexions(false) annule la simulation en attente.
   memoire = [{ id, categorie, contenu, echeance, epingle, source, creeLe, majLe }] (DEMO.memoire) ; Store.memoire.modifier(id, patch) /
   supprimer(ids) / toutEffacer() → { ok: true } ou { erreur }, en mémoire. savoir = { fiches (sans contenu), reperes } (DEMO.savoir,
   repères d'exemple) ; Store.savoir.fiche(slug) → la fiche d'exemple avec son contenu, ou null.
   expertises = [{ slug, nom, quandConsulter, perimetre, version, misAJourLe, marches, angles }] (D.expertises : les 8 expertises v1
   publiées, triées par nom, sans leur détail) ; Store.expertises.detail(slug) → { …, methode, controles, garde_fous, format,
   themesSavoir, reperes, changelog, versions: [{ version, le, resume }] } (copie), ou null : détail complet pour allocation-risque
   et etf-fonds, détail court (methode, garde_fous et format à null) pour les autres ; versions = journal des versions (changelog),
   le plus récent d'abord, comme l'historique public expertises_versions.
   journal = [{ id, type, titre, synthese, raisonnement, options, statut, dateDecision, revueLe, liens, etat, source, historique, creeLe, majLe }]
   (D.journal, plus récentes d'abord), journalARelire (nombre d'entrées « à relire », calculé comme le count de store-supabase.js)
   et journalConsentement = "demander" ; Store.journal.confirmer(ids) / modifier(id, patch) / supprimer(ids) /
   consentement(mode) → { ok: true } ou { erreur }, en mémoire, avec le même historique que le déclencheur SQL journal_historique.
   routines = [{ type, jour, active, consentementJournal, dernierPassage, dernierClient, prochainPassage, questions: [{ question, pourquoi,
   champ }], synthese }] (D.routines : la revue mensuelle de la démo, prête avec deux questions) ; routinesLues = true une fois prêt.
   Store.routines.pause(type, enPause) → { ok: true } ou { erreur }, en mémoire ; la réactivation recalcule le prochain passage
   comme le déclencheur routines_maj (premier jour `jour` d'un mois au plus tôt dans 7 jours, date de Paris).
   banque = { actif, lu, connexions, comptes, mois } (D.banque : interrupteur actif, 2 connexions dont une SCARequired, 6 comptes dont un
   non rattaché et un ignoré, 6 mois de totaux). Store.banque.synchroniser(id) → { ok: true, rapport } (date de synchronisation mise à jour en mémoire). Store.banque.connecter() → { erreur: « Indisponible en démonstration… » } (aucune page Powens en
   démo), de même pour gerer(id) ; deconnecter(id) retire la connexion et ses comptes, rattacher(id, cible) pose les 5 colonnes, en mémoire, avec la validation
   de store-supabase.js (BanqueEtat.normRattachement). Store.banque.operations(compteIds, depuis) → Promise<[{ id, compteId, date, montant,
   libelle, categorie }]> : opérations de démonstration (D.operationsBancaires), les plus récentes d'abord.
   Historique importé (HIS2, mêmes formes que store-supabase.js) : S.relevesBancaires { lu, mfaRequise, comptes, releves, banqueMois }, S.historiqueImports, S.photosReconstituees (vide) ;
   la démo porte un ancien compte courant de Sam (14 mois importés, un mois manquant, tous antérieurs aux 12 mois du budget réel), trois ordres importés sur le PEA de Camille et
   deux propositions décidées (un import accepté, un import retiré). Store.historique.retirer(importId) → { ok: true } | { erreur } : retire l'import en mémoire.
   Store.transactions(depuis) → Promise<[{ id, positionId, date, type, qty, price, amount, note, source, createdAt }]> : transactions depuis
   `depuis` (AAAA-MM-JJ ; absente : toutes), les plus récentes d'abord (S.tx n'en garde que les 60 dernières côté Supabase ; la
   reconstitution du passé d'Aujourd'hui, historique.js, remonte les quantités par toutes les transactions de la période).
   Store.cours(isins, depuis) → Promise<{ <isin>: [{ date, cloture }] }> : cours de clôture quotidiens (jours ouvrés, du plus ancien au plus
   récent, depuis `depuis` jusqu'à la veille du cours du jour), générés de façon déterministe à partir du prix courant de la ligne de démo
   (marche aléatoire reproductible propre à chaque ISIN, qui finit au cours du jour), 5 ans au plus ; ISIN inconnu ou sans cours : absent.
   (formes détaillées dans l'en-tête de store-supabase.js).
   Vocabulaire canonique : scope ∈ foyer | p1 | p2 ; positions.owner ∈ p1 | p2 ; snapshots { date, foyer, p1, p2,
   byBloc (par personne : { p1: { poche: valeur }, p2: { … } }, comme take_snapshots ; à lire par Calc.blocsPhoto), byEnvelope (à plat), source } ; config.targets { p1, p2, tolerancePts } ; profil.personnes / autres { p1, p2 },
   biens[].part_p1, credits[].owner ∈ p1 | p2 | commun ; people = [{ id: "p1", nom }, { id: "p2", nom }?]. */
(function () {
  const isDemo = window.BOUSSOLE_MODE === "demo" || /[?&]demo(?:=|&|$)/.test(String((window.location && window.location.search) || ""));
  if (!isDemo) return;

  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const D = clone(window.DEMO || {});
  /* app.html?demo=vide : foyer démo VIDE (comme un compte qui vient d'être créé : ni compte, ni ligne, ni objectif, ni budget, ni mémoire, ni journal,
     ni proposition, ni projection figée ; config, profil et statut absents). Sert à vérifier les états vides des vues et à les capturer
     (UX5 G5). Le catalogue de savoir et les expertises ne sont pas des données du foyer : ils restent. */
  const VIDE = /[?&]demo=vide(?:&|$)/.test(String((window.location && window.location.search) || ""));
  if (VIDE) Object.assign(D, { positions: [], snapshots: [], tx: [], config: null, status: null, profil: null, budget: null, objectifs: [], risque: null, classes: {},
    propositions: [], connexions: [], memoire: [], journal: [], routines: [], banque: null, operationsBancaires: [], foyer: null, plansFiges: [], scenariosJoues: [] });
  // État interne ; S (exposé) en est une copie reconstruite à chaque publish().
  const C = {
    ready: false, dbOk: null, positions: (D.positions || []).map(p => Object.assign({}, p, { symbol: p.symbol || null })), snapshots: D.snapshots || [], tx: D.tx || [],
    config: D.config ? Object.assign({}, D.config, { frais_enveloppes: D.config.frais_enveloppes || {}, enveloppes_infos: D.config.enveloppes_infos || {}, prets_infos: D.config.prets_infos || {}, donations: D.config.donations || [], avis_impot: D.config.avis_impot || {}, suivi: D.config.suivi || {} }) : null, status: D.status || null, profil: D.profil || null, profilLoaded: false,
    budget: D.budget || null, objectifs: D.objectifs || [],
    risque: D.risque || null, classes: D.classes || {}, propositions: D.propositions || [], connexions: D.connexions || [],
    memoire: [], savoir: { fiches: [], reperes: [] }, expertises: [], journal: [], journalARelire: 0, journalConsentement: "demander",
    routines: D.routines || [], routinesLues: false,
    banque: D.banque || { actif: false, lu: true, connexions: [], comptes: [], mois: [] },
    relevesBancaires: D.relevesBancaires || { lu: true, mfaRequise: false, comptes: [], releves: [], banqueMois: [] }, historiqueImports: D.historiqueImports || [], photosReconstituees: D.photosReconstituees || [],
    scope: "foyer", error: null, user: { id: "demo", email: null, demo: true },
    foyer: { evenements: ((D.foyer && D.foyer.evenements) || []).slice(), variantes: ((D.foyer && D.foyer.variantes) || []).slice() }, indices: D.indices || [], plansFiges: (D.plansFiges || []).slice(),
  };
  // Fiches : S n'expose que les résumés (comme store-supabase.js) ; le contenu reste ici pour Store.savoir.fiche(slug).
  const FICHES = (D.savoir && D.savoir.fiches) || [];
  C.memoire = D.memoire || [];
  C.journal = (D.journal || []).slice().sort((a, b) => String(b.creeLe).localeCompare(String(a.creeLe))).slice(0, 500);
  C.savoir = { fiches: FICHES.map(f => { const o = Object.assign({}, f); delete o.contenu; return o; }), reperes: (D.savoir && D.savoir.reperes) || [] };
  /* Scénarios (SCN1) : catalogue publié embarqué (window.ScenariosCatalogue, scenarios-catalogue.gen.js) et parties jouées de la démo (D.scenariosJoues) ;
     les repères que lisent les scénarios sont ajoutés à ceux de la démo s'ils n'y sont pas déjà (les valeurs de la démo restent). Fichier absent : catalogue vide. */
  const CAT = window.ScenariosCatalogue && Array.isArray(window.ScenariosCatalogue.catalogue) ? window.ScenariosCatalogue : { catalogue: [], reperes: [], reperes_scenarios: [] };
  {
    const deja = new Set(C.savoir.reperes.map(r => r && r.cle)), lus = new Set(CAT.reperes_scenarios || []);
    C.savoir.reperes = C.savoir.reperes.concat((CAT.reperes || []).filter(r => r && lus.has(r.cle) && !deja.has(r.cle)).map(r => clone(r)));
  }
  C.scenarios = { catalogue: clone(CAT.catalogue), joues: clone(Array.isArray(D.scenariosJoues) ? D.scenariosJoues : []), source: "demo", lu: true, mfaRequise: false };
  // Expertises : S n'expose que la liste (comme store-supabase.js) ; le détail reste ici pour Store.expertises.detail(slug).
  const EXPERTISES = Array.isArray(D.expertises) ? D.expertises : [];
  const EXP_LISTE = ["slug", "nom", "quandConsulter", "perimetre", "version", "misAJourLe", "marches", "angles"];
  C.expertises = EXPERTISES.map(e => Object.fromEntries(EXP_LISTE.map(k => [k, e[k]]))).sort((a, b) => String(a.nom).localeCompare(String(b.nom), "fr"));
  try { const s = localStorage.getItem("scope"); if (["foyer", "p1", "p2"].includes(s)) C.scope = s; } catch (e) {}

  // Deuxième personne : si le foyer compte au moins deux adultes (ou, taille inconnue, si elle est renseignée).
  const people = () => {
    const pr = C.profil || {}, ps = pr.personnes || {}, f = pr.foyer || {};
    const out = [{ id: "p1", nom: String((ps.p1 && ps.p1.nom) || "").trim() || "Moi" }];
    const two = f.adultes != null && f.adultes !== "" ? +f.adultes >= 2 : !!ps.p2;
    if (two) out.push({ id: "p2", nom: String((ps.p2 && ps.p2.nom) || "").trim() || "Conjoint(e)" });
    return out;
  };

  // « Aucun bien ni crédit » : réponse enregistrée dans foyer.biensRenseignes, exposée en profil.biensRenseignes (bilan-etat.js).
  const avecBiensRenseignes = p => { if (p && p.foyer && p.foyer.biensRenseignes) p.biensRenseignes = true; return p; };

  const subs = []; let tmr = null;
  const emit = () => { clearTimeout(tmr); tmr = setTimeout(() => subs.forEach(fn => { try { fn(S); } catch (e) { console.error(e); } }), 60); };
  /* PROJ : deux plans figés (revues mensuelles passées, il y a 62 et 31 jours). La liste (id, date, raison, horizon) est immédiate ; le calcul de la série et des
     paramètres (moteur de projection, 500 chemins) se fait à la demande, dans Store.plansFiges.detail(id), puis reste en mémoire. */
  if (!VIDE && !C.plansFiges.length) C.plansFiges = [62, 31].map(n => ({ id: "plan-demo-" + n, cree_le: new Date(Date.now() - n * 864e5).toISOString().slice(0, 10) + "T20:00:00.000Z", raison: "revue_mensuelle", horizon_mois: 120, _jours: n }));
  function plansFigesDemo() { return C.plansFiges; }
  function completerPlan(r) {
    if (!r || r.serie || !r._jours) return r;
    const Pj = window.Projection;
    if (!Pj || !Pj.figerPlan) return r;
    const jour = new Date(Date.now() - r._jours * 864e5).toISOString().slice(0, 10);
    const data = Pj.depuisEtat(clone({ positions: C.positions, config: C.config, profil: C.profil, budget: C.budget, banque: C.banque, objectifs: C.objectifs, foyer: C.foyer, savoir: C.savoir, indices: C.indices, classes: C.classes }), jour);
    const options = { horizon_ans: 10, vue: "net", euros: "courants" };
    const ligne = Pj.figerPlan({ data, options }, Pj.simuler(Pj.preparer(data, options), { chemins: 500 }), "revue_mensuelle");
    Object.assign(r, { parametres: ligne.parametres, serie: ligne.serie, horizon_mois: ligne.horizon_mois });
    return r;
  }
  const S = {};
  function publish() {
    const ppl = people();
    Object.assign(S, {
      ready: C.ready, dbOk: C.dbOk,
      positions: clone(C.positions),
      snapshots: clone(C.snapshots),
      tx: clone(C.tx),
      config: clone(C.config),
      status: clone(C.status),
      profil: avecBiensRenseignes(clone(C.profil)),
      profilLoaded: C.profilLoaded,
      budget: clone(C.budget),
      objectifs: clone(C.objectifs),
      risque: clone(C.risque),
      classes: clone(C.classes) || {},
      propositions: clone(C.propositions),
      connexions: clone(C.connexions),
      memoire: clone(C.memoire),
      savoir: clone(C.savoir),
      expertises: clone(C.expertises),
      scenarios: clone(C.scenarios),
      journal: clone(C.journal),
      journalARelire: C.journal.filter(e => e && e.statut === "a_relire").length,
      journalConsentement: C.journalConsentement,
      routines: clone(C.routines),
      routinesLues: C.routinesLues,
      banque: clone(C.banque),
      relevesBancaires: clone(C.relevesBancaires), historiqueImports: clone(C.historiqueImports), photosReconstituees: clone(C.photosReconstituees),
      foyer: clone(C.foyer), indices: clone(C.indices), plansFiges: plansFigesDemo().map(r => ({ id: r.id, cree_le: r.cree_le, raison: r.raison, horizon_mois: r.horizon_mois })),
      onboardingDone: true, // la démo ne propose jamais les premiers pas
      scope: ppl.some(p => p.id === C.scope) ? C.scope : "foyer", // une seule personne : toujours le foyer
      people: ppl,
      user: clone(C.user),
      error: C.error,
    });
    emit();
  }

  /* ---------- validation (application des propositions) et façade db de contrôle ---------- */
  const tick = () => new Promise(r => setTimeout(r, 30));
  const newId = p => p + "-" + Math.random().toString(36).slice(2, 9);
  // Une valeur invalide est refusée (code invalid_argument, message en français), jamais corrigée en silence.
  // normLignes / normObjectif servent à l'application des propositions en mémoire (rôle de appliquer_propositions côté SQL).
  const bad = m => Object.assign(new Error(m), { code: "invalid_argument" });
  const TYPES_LIGNE = ["revenu", "depense", "epargne"], FREQS = ["mois", "an"], OWNERS = ["p1", "p2", "commun"];
  function normLignes(lignes) {
    if (!Array.isArray(lignes)) throw bad("Budget invalide : « lignes » doit être une liste.");
    return lignes.map((l, i) => {
      const L = "Budget, ligne " + (i + 1) + " : ";
      if (!l || typeof l !== "object") throw bad(L + "ligne invalide.");
      if (!TYPES_LIGNE.includes(l.type)) throw bad(L + "type « " + (l.type ?? "") + " » inconnu (revenu, depense ou epargne).");
      const montant = l.montant === "" || l.montant == null ? NaN : +l.montant;
      if (!isFinite(montant) || montant < 0) throw bad(L + "montant invalide (nombre positif attendu).");
      const frequence = l.frequence == null || l.frequence === "" ? "mois" : l.frequence;
      if (!FREQS.includes(frequence)) throw bad(L + "fréquence « " + frequence + " » inconnue (mois ou an).");
      const o = { id: l.id ? String(l.id) : newId("bl"), type: l.type, categorie: String(l.categorie || "").trim(), libelle: String(l.libelle || "").trim(), montant, frequence };
      if (l.owner != null && l.owner !== "") { if (!OWNERS.includes(l.owner)) throw bad(L + "titulaire « " + l.owner + " » inconnu (p1, p2 ou commun)."); o.owner = l.owner; }
      return o;
    });
  }
  const OBJ_TYPES = ["apport", "matelas", "retraite", "projet"], OBJ_SOURCES = ["saisi", "poches"];
  // Objectif partiel (vue camelCase) → objectif partiel validé ; seules les clés présentes sont reprises.
  function normObjectif(o) {
    if (!o || typeof o !== "object") throw bad("Objectif invalide.");
    const out = {}, has = k => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
    const montant = (k, label) => { const v = o[k] === "" || o[k] == null ? NaN : +o[k]; if (!isFinite(v) || v < 0) throw bad("Objectif : " + label + " invalide (nombre positif attendu)."); out[k] = v; };
    const liste = k => { if (!Array.isArray(o[k]) || o[k].some(x => typeof x !== "string")) throw bad("Objectif : « " + k + " » doit être une liste de noms."); out[k] = o[k].map(x => x.trim()).filter(Boolean); };
    if (has("nom")) out.nom = String(o.nom == null ? "" : o.nom).trim();
    if (has("type")) { if (!OBJ_TYPES.includes(o.type)) throw bad("Objectif : type « " + o.type + " » inconnu (apport, matelas, retraite ou projet)."); out.type = o.type; }
    if (has("cible")) montant("cible", "montant cible");
    if (has("deja")) montant("deja", "montant déjà mis de côté");
    if (has("dateCible")) {
      if (o.dateCible == null || o.dateCible === "") out.dateCible = null;
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.dateCible)) || isNaN(Date.parse(o.dateCible))) throw bad("Objectif : date cible « " + o.dateCible + " » invalide (format AAAA-MM-JJ).");
      else out.dateCible = String(o.dateCible);
    }
    if (has("source")) { if (!OBJ_SOURCES.includes(o.source)) throw bad("Objectif : source « " + o.source + " » inconnue (saisi ou poches)."); out.source = o.source; }
    if (has("poches")) liste("poches");
    if (has("enveloppes")) liste("enveloppes");
    if (has("rendement")) { const v = o.rendement === "" || o.rendement == null ? NaN : +o.rendement; if (!isFinite(v) || v < -50 || v > 50) throw bad("Objectif : rendement invalide (entre -50 et 50 % par an)."); out.rendement = v; }
    if (has("priorite")) { const v = +o.priorite; if (!Number.isInteger(v)) throw bad("Objectif : priorité invalide (nombre entier attendu)."); out.priorite = v; }
    return out;
  }
  const objet = v => v != null && typeof v === "object" && !Array.isArray(v);
  const OBJ_DEFAUT = { nom: "", type: "projet", cible: 0, dateCible: null, deja: 0, source: "saisi", poches: [], enveloppes: [], rendement: 2, priorite: 0 };
  /* Seules les écritures de contrôle passent (même texte et même validation que store-supabase.js). */
  const LECTURE_SEULE = "Écriture non disponible dans l'app : complète ou corrige avec Claude, puis valide sa proposition.";
  function seulement(patch, cles) {
    if (!objet(patch)) throw bad("Modification invalide : objet attendu.");
    const autres = Object.keys(patch).filter(k => !cles.includes(k));
    if (autres.length || !Object.keys(patch).length) throw bad(LECTURE_SEULE);
  }
  function normRegles(rules) {
    if (!Array.isArray(rules) || rules.some(r => !objet(r) || typeof r.type !== "string")) throw bad("Règles invalides : liste de règles { type, … } attendue.");
    return rules;
  }
  function normRisque(patch) {
    seulement(patch, ["risque"]);
    if (patch.risque !== null && !objet(patch.risque)) throw bad("Profil de risque invalide : objet { reponses, profil, score, date } ou null attendu.");
    return patch.risque;
  }
  const db = {
    doc(path) {
      const [col] = String(path).split("/");
      return {
        async update(patch) {
          await tick();
          const p = clone(patch);
          if (col === "config") { seulement(p, ["rules"]); C.config = Object.assign(C.config || {}, { rules: normRegles(p.rules) }); }
          else if (col === "profil") C.risque = normRisque(p);
          else throw bad(LECTURE_SEULE);
          publish();
        },
      };
    },
  };

  /* ---------- propositions de Claude (même effet que appliquer_propositions, en mémoire) ---------- */
  const QUESTIONS_RISQUE = ["horizon", "objectif", "reaction", "perte_max", "connaissances", "experience", "revenus", "matelas", "part_investie", "age"];
  const sansNull = o => { const r = {}; Object.keys(o || {}).forEach(k => { if (o[k] !== null && o[k] !== undefined) r[k] = o[k]; }); return r; };
  const POS_VUE = { value_date: "valueDate", qty_estimated: "qtyEstimated", price_override: "price", role_source: "roleSource" };
  /* role et role_source (0032) : valeurs bornées, null les retire. */
  function controleRole(vue) {
    if ("role" in vue && vue.role !== null && !["reserve", "coeur", "satellite"].includes(vue.role)) throw bad("role invalide (reserve, coeur ou satellite attendu)");
    if ("roleSource" in vue && vue.roleSource !== null && !["propose", "valide"].includes(vue.roleSource)) throw bad("role_source invalide (propose ou valide attendu)");
  }
  function versVuePosition(v) {
    const o = {};
    Object.keys(v).forEach(k => { if (k !== "transaction") o[POS_VUE[k] || k] = v[k]; });
    if ("isin" in o) o.isin = o.isin ? String(o.isin).replace(/\s/g, "").toUpperCase() : null;
    if ("price" in o && o.price != null) o.priceDate = o.valueDate || new Date().toISOString().slice(0, 10);
    if ("value" in o && !("valueDate" in o)) o.valueDate = new Date().toISOString().slice(0, 10);
    return o;
  }
  const versVueObjectif = v => { const o = Object.assign({}, v); if ("date_cible" in o) { o.dateCible = o.date_cible; delete o.date_cible; } return o; };
  function introuvable(quoi, ref) { throw bad(quoi + " « " + ref + " » introuvable."); }
  /* Réglages (migration 0019) : mêmes règles et mêmes messages que appliquer_propositions. */
  const CLASSES = ["actions", "small_caps", "emergents", "levier", "obligations", "immobilier", "monetaire", "fonds_euros", "or", "crypto", "autres"];
  const num = x => (x === "" || x == null || typeof x === "boolean" ? NaN : +x);
  function fusionClasses(cl) {
    if (!objet(cl)) throw bad("classes : objet { poche: classe } attendu.");
    const out = Object.assign({}, C.classes);
    Object.keys(cl).forEach(k => {
      if (!k.trim() || k.length > 60) throw bad("classes : nom de poche invalide (1 à 60 caractères).");
      if (cl[k] === null) { delete out[k]; return; }
      if (!CLASSES.includes(cl[k])) throw bad("classe « " + cl[k] + " » inconnue pour la poche « " + k + " » (" + CLASSES.slice(0, -1).join(", ") + " ou autres).");
      out[k] = cl[k];
    });
    return out;
  }
  function normMatelas(c) {
    if (!objet(c)) throw bad("cushion : objet attendu.");
    const champs = c.mode === "months" ? ["mode", "months", "depenses"] : ["mode", "min", "max"];
    if (c.mode === "months" || c.mode === "amount") { const k = Object.keys(c).find(x => !champs.includes(x)); if (k) throw bad("cushion : champ « " + k + " » inconnu (" + champs.join(", ") + ")."); }
    if (c.mode === "months") {
      const m = num(c.months), d = num(c.depenses);
      if (!(m > 0 && m <= 120)) throw bad("cushion.months invalide (nombre de mois entre 0 et 120 attendu).");
      if (!(d > 0)) throw bad("cushion.depenses invalide (dépenses mensuelles positives attendues).");
      return { mode: "months", months: m, depenses: d };
    }
    if (c.mode === "amount") {
      const min = num(c.min), max = c.max == null ? null : num(c.max);
      if (!(min >= 0)) throw bad("cushion.min invalide (montant positif attendu).");
      if (max !== null && !(max >= min)) throw bad("cushion.max invalide (montant au moins égal au minimum, ou null).");
      return { mode: "amount", min, max };
    }
    throw bad("cushion.mode « " + (c.mode ?? "") + " » inconnu (amount ou months).");
  }
  /* Frais des contrats (0026 + 0027) : fusion par enveloppe (une enveloppe fournie remplace l'existante en entier, null la retire),
     pourcentages par an de 0 à 5 (au moins un), source obligatoire (1 à 300 caractères), le en AAAA-MM-JJ (date du jour par défaut,
     jamais dans le futur), 30 enveloppes au plus, avant comme après la fusion. */
  const CHAMPS_FRAIS = ["gestion_uc_pct", "gestion_euro_pct", "garde_pct", "arbitrage_pct", "courtage_pct"];
  /* Aujourd'hui au jour de Paris (RoutineEtat.aujParis, comme la base : « le » ne peut pas être dans le futur de Paris), repli sur le jour local. */
  const jourIso = () => {
    const R = (typeof window !== "undefined" && window.RoutineEtat) || (typeof module === "object" && module.exports && typeof require === "function" ? require("./routine-etat.js") : null);
    const p = R && typeof R.aujParis === "function" ? R.aujParis() : null;
    if (typeof p === "string" && ISO10.test(p)) return p;
    const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  /* config.suivi (0032) : politique de suivi des lignes, fusionnée champ par champ ; null retire un champ ; une semaine fournie remplace l'entrée en entier. */
  const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  function fusionSuivi(v, existant) {
    if (!objet(v)) throw bad("suivi : objet attendu.");
    if (!Object.keys(v).some(k => k !== "source" && k !== "le")) throw bad("suivi : au moins un réglage attendu.");
    const source = typeof v.source === "string" ? v.source.trim().replace(/\s+/g, " ") : "";
    if (!source || source.length > 300) throw bad("suivi : source obligatoire (1 à 300 caractères).");
    const out = Object.assign({}, objet(existant) ? existant : {});
    const ENT = (x, min, max) => { const n = num(x); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
    Object.keys(v).forEach(k => {
      const x = v[k];
      if (!["revue_coeur", "mois_revue_coeur", "seuil_ecart_pts", "plafond_satellite_pct", "seuil_baisse_satellite_pct", "semaine", "source", "le"].includes(k))
        throw bad("suivi : champ « " + k + " » inconnu (revue_coeur, mois_revue_coeur, seuil_ecart_pts, plafond_satellite_pct, seuil_baisse_satellite_pct, semaine, source, le).");
      if (x === null) { delete out[k]; return; }
      if (k === "revue_coeur") { if (x !== "annuelle" && x !== "semestrielle") throw bad("suivi : revue_coeur invalide (annuelle ou semestrielle attendu)."); out[k] = x; }
      else if (k === "mois_revue_coeur") { const n = ENT(x, 1, 12); if (n == null || n !== Math.trunc(n)) throw bad("suivi : mois_revue_coeur invalide (mois de 1 à 12 attendu)."); out[k] = n; }
      else if (k === "seuil_ecart_pts") { const n = ENT(x, 3, 10); if (n == null) throw bad("suivi : seuil_ecart_pts invalide (écart de 3 à 10 points attendu)."); out[k] = n; }
      else if (k === "plafond_satellite_pct") { const n = ENT(x, 0, 30); if (n == null) throw bad("suivi : plafond_satellite_pct invalide (pourcentage de 0 à 30 attendu)."); out[k] = n; }
      else if (k === "seuil_baisse_satellite_pct") { const n = ENT(x, 10, 50); if (n == null) throw bad("suivi : seuil_baisse_satellite_pct invalide (pourcentage de 10 à 50 attendu)."); out[k] = n; }
      else if (k === "semaine") {
        if (!objet(x)) throw bad("suivi : semaine invalide (objet { actif, jour } attendu).");
        const inconnu = Object.keys(x).find(c => c !== "actif" && c !== "jour");
        if (inconnu) throw bad("suivi.semaine : champ « " + inconnu + " » inconnu (actif, jour).");
        if (typeof x.actif !== "boolean") throw bad("suivi.semaine : actif invalide (vrai ou faux attendu).");
        if (x.jour != null && !JOURS.includes(x.jour)) throw bad("suivi.semaine : jour invalide (lundi, mardi, mercredi, jeudi, vendredi, samedi ou dimanche attendu).");
        out[k] = x.jour != null ? { actif: x.actif, jour: x.jour } : { actif: x.actif };
      } else if (k === "source") out[k] = source;
      else {
        if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x) || isNaN(Date.parse(x))) throw bad("suivi : date (le) invalide (AAAA-MM-JJ).");
        if (x > jourIso()) throw bad("suivi : date (le) dans le futur (la date du document consulté est attendue).");
        out[k] = x;
      }
    });
    if (v.le == null) out.le = jourIso();
    return out;
  }
  function fusionFraisEnveloppes(v, existants) {
    if (!objet(v)) throw bad("frais_enveloppes : objet { enveloppe: frais } attendu.");
    if (Object.keys(v).length > 30) throw bad("frais_enveloppes : 30 enveloppes au plus.");
    const out = Object.assign({}, objet(existants) ? existants : {});
    Object.keys(v).forEach(k => {
      const env = k.trim(), f = v[k];
      if (!env || env.length > 80) throw bad("frais_enveloppes : nom d'enveloppe invalide (1 à 80 caractères).");
      if (f === null) { delete out[env]; return; }
      if (!objet(f)) throw bad("frais_enveloppes « " + env + " » : objet ou null attendu.");
      const inconnu = Object.keys(f).find(x => ![...CHAMPS_FRAIS, "source", "le"].includes(x));
      if (inconnu) throw bad("frais_enveloppes « " + env + " » : champ « " + inconnu + " » inconnu (gestion_uc_pct, gestion_euro_pct, garde_pct, arbitrage_pct, courtage_pct, source, le).");
      const ligne = {};
      CHAMPS_FRAIS.forEach(c => {
        if (f[c] == null) return;
        const x = typeof f[c] === "number" || typeof f[c] === "string" ? num(f[c]) : NaN;
        if (!(x >= 0 && x <= 5)) throw bad("frais_enveloppes « " + env + " » : " + c + " invalide (pourcentage par an entre 0 et 5 attendu).");
        ligne[c] = x;
      });
      if (!Object.keys(ligne).length) throw bad("frais_enveloppes « " + env + " » : au moins un pourcentage attendu (gestion_uc_pct, gestion_euro_pct, garde_pct, arbitrage_pct ou courtage_pct).");
      const source = typeof f.source === "string" ? f.source.trim() : "";
      if (!source || source.length > 300) throw bad("frais_enveloppes « " + env + " » : source obligatoire (1 à 300 caractères).");
      let le = jourIso();
      if (f.le != null) {
        if (typeof f.le !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.le) || isNaN(Date.parse(f.le))) throw bad("frais_enveloppes « " + env + " » : date (le) invalide (AAAA-MM-JJ).");
        if (f.le > jourIso()) throw bad("frais_enveloppes « " + env + " » : date (le) dans le futur (la date du document consulté est attendue).");
        le = f.le;
      }
      out[env] = Object.assign(ligne, { source, le });
    });
    if (Object.keys(out).length > 30) throw bad("frais_enveloppes : 30 enveloppes au plus (" + Object.keys(out).length + " après fusion).");
    return out;
  }

  /* ---------- DAT1 (0029) : informations des enveloppes et des prêts, donations, avis d'impôt, naissance ----------
     Mêmes contrôles et mêmes messages que appliquer_propositions de la migration 0029 (test/store-contract.test.mjs en compare 10 cas). */
  const TYPES_ENV = ["pea", "pea_pme", "pea_jeune", "assurance_vie", "capitalisation", "per", "pel", "cel", "pee", "percol", "compte_titres", "livret_a", "ldds", "lep", "autre"];
  const ORIGINES_PEE = ["versement", "abondement", "participation", "interessement"];
  const ISO10 = /^\d{4}-\d{2}-\d{2}$/;
  const jourReel = s => { if (typeof s !== "string" || !ISO10.test(s)) return null; const [y, m, d] = s.split("-").map(Number), x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? s : null; };
  const nombreStrict = v => ((typeof v === "number" && isFinite(v)) || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) ? +v : null);
  const nonVide = v => v !== undefined && v !== null;
  const ecrit = s => (typeof s === "string" ? s.trim() : "");
  /** « le » (date du document consulté) : défaut aujourd'hui, jamais dans le futur. */
  function dateLe(v, prefixe) {
    if (!nonVide(v)) return jourIso();
    const d = jourReel(v);
    if (!d) throw bad(prefixe + " : date (le) invalide (AAAA-MM-JJ).");
    if (d > jourIso()) throw bad(prefixe + " : date (le) dans le futur (la date du document consulté est attendue).");
    return d;
  }
  const sourceObl = (f, prefixe) => { const s = ecrit(f.source); if (!s || s.length > 300) throw bad(prefixe + " : source obligatoire (1 à 300 caractères)."); return s; };
  function fusionEnveloppesInfos(v, existants) {
    if (!objet(v)) throw bad("enveloppes_infos : objet { enveloppe: informations } attendu.");
    if (Object.keys(v).length > 30) throw bad("enveloppes_infos : 30 enveloppes au plus.");
    const out = Object.assign({}, objet(existants) ? existants : {}), auj = jourIso();
    Object.keys(v).forEach(k => {
      const env = k.trim(), f = v[k], nom = env.replace(/\|p[12]$/, "");
      if (!nom || nom !== nom.trim() || nom.length > 80) throw bad("enveloppes_infos : nom d'enveloppe invalide (1 à 80 caractères).");
      if (f === null) { delete out[env]; return; }
      const P = "enveloppes_infos « " + env + " »";
      if (!objet(f)) throw bad(P + " : objet ou null attendu.");
      const champs = ["type", "titulaire", "date_ouverture", "date_ouverture_approx", "date_cloture", "versements_cumules", "versements_avant_70", "beneficiaires_revus_le", "versements", "moins_values", "source", "le"];
      const inconnu = Object.keys(f).find(x => !champs.includes(x));
      if (inconnu) throw bad(P + " : champ « " + inconnu + " » inconnu (" + champs.join(", ") + ").");
      if (!TYPES_ENV.includes(f.type)) throw bad(P + " : type invalide (" + TYPES_ENV.slice(0, -1).join(", ") + " ou autre attendu).");
      if (!["p1", "p2"].includes(f.titulaire)) throw bad(P + " : titulaire invalide (p1 ou p2 attendu).");
      const sfx = (/\|(p[12])$/.exec(env) || [])[1];
      if (sfx && sfx !== f.titulaire) throw bad(P + " : la clé se termine par |" + sfx + " mais le titulaire est " + f.titulaire + ".");
      const ligne = { type: f.type, titulaire: f.titulaire };
      ["date_ouverture", "date_cloture", "beneficiaires_revus_le"].forEach(c => {
        if (!nonVide(f[c])) return;
        const d = jourReel(f[c]);
        if (!d) throw bad(P + " : " + c + " invalide (AAAA-MM-JJ).");
        if (d > auj) throw bad(P + " : " + c + " dans le futur.");
        if (d < "1950-01-01") throw bad(P + " : " + c + " antérieure à 1950.");
        ligne[c] = d;
      });
      if (nonVide(f.date_ouverture_approx)) {
        if ("date_ouverture" in ligne) throw bad(P + " : date_ouverture et date_ouverture_approx ne vont pas ensemble.");
        const a = f.date_ouverture_approx, d = typeof a === "string" && /^\d{4}(-\d{2})?$/.test(a) ? jourReel(a.length === 4 ? a + "-01-01" : a + "-01") : null;
        if (!d) throw bad(P + " : date_ouverture_approx invalide (AAAA ou AAAA-MM).");
        if (d > auj) throw bad(P + " : date_ouverture_approx dans le futur.");
        if (d < "1950-01-01") throw bad(P + " : date_ouverture_approx antérieure à 1950.");
        ligne.date_ouverture_approx = a;
      }
      if (ligne.date_cloture && ligne.date_ouverture && ligne.date_cloture < ligne.date_ouverture) throw bad(P + " : date_cloture avant date_ouverture.");
      ["versements_cumules", "versements_avant_70"].forEach(c => {
        if (!nonVide(f[c])) return;
        const x = nombreStrict(f[c]);
        if (x === null || x < 0) throw bad(P + " : " + c + " invalide (montant positif ou nul attendu).");
        ligne[c] = x;
      });
      if ("versements_avant_70" in ligne && "versements_cumules" in ligne && ligne.versements_avant_70 > ligne.versements_cumules) throw bad(P + " : versements_avant_70 supérieur à versements_cumules.");
      if (nonVide(f.versements)) {
        if (!["pee", "percol"].includes(f.type)) throw bad(P + " : versements réservés aux types pee et percol.");
        if (!Array.isArray(f.versements)) throw bad(P + " : versements : liste attendue.");
        if (f.versements.length > 120) throw bad(P + " : versements : 120 au plus.");
        const liste = f.versements.map((it, i) => {
          const n = i + 1, Q = P + " : versement " + n;
          if (!objet(it)) throw bad(Q + " : objet attendu.");
          const x = Object.keys(it).find(c => !["le", "montant", "origine", "disponible_le"].includes(c));
          if (x) throw bad(Q + " : champ « " + x + " » inconnu (le, montant, origine, disponible_le).");
          const d = jourReel(it.le);
          if (!d) throw bad(Q + " : date (le) invalide (AAAA-MM-JJ).");
          if (d > auj) throw bad(Q + " : date (le) dans le futur.");
          if (d < "1950-01-01") throw bad(Q + " : date (le) antérieure à 1950.");
          const m = nombreStrict(it.montant);
          if (m === null || m < 0) throw bad(Q + " : montant invalide (montant positif ou nul attendu).");
          if (!ORIGINES_PEE.includes(it.origine)) throw bad(Q + " : origine invalide (versement, abondement, participation ou interessement attendu).");
          const r = { le: d, montant: m, origine: it.origine };
          if (nonVide(it.disponible_le)) {
            const d2 = jourReel(it.disponible_le);
            if (!d2) throw bad(Q + " : disponible_le invalide (AAAA-MM-JJ).");
            if (d2 < d) throw bad(Q + " : disponible_le avant la date du versement.");
            r.disponible_le = d2;
          }
          return r;
        });
        if (liste.length) ligne.versements = liste;
      }
      if (nonVide(f.moins_values)) {
        if (f.type !== "compte_titres") throw bad(P + " : moins_values réservées au type compte_titres.");
        if (!Array.isArray(f.moins_values)) throw bad(P + " : moins_values : liste attendue.");
        if (f.moins_values.length > 15) throw bad(P + " : moins_values : 15 au plus.");
        const liste = f.moins_values.map((it, i) => {
          const Q = P + " : moins-value " + (i + 1);
          if (!objet(it)) throw bad(Q + " : objet attendu.");
          const x = Object.keys(it).find(c => !["annee", "montant"].includes(c));
          if (x) throw bad(Q + " : champ « " + x + " » inconnu (annee, montant).");
          const a = typeof it.annee === "number" || (typeof it.annee === "string" && /^\d{4}$/.test(it.annee)) ? +it.annee : null;
          if (a === null || a !== Math.trunc(a) || a < 2000 || a > +auj.slice(0, 4)) throw bad(Q + " : annee invalide (entier de 2000 à l'année en cours attendu).");
          const m = nombreStrict(it.montant);
          if (m === null || m <= 0) throw bad(Q + " : montant invalide (montant strictement positif attendu).");
          return { annee: a, montant: m };
        });
        if (liste.length) ligne.moins_values = liste;
      }
      out[env] = Object.assign(ligne, { source: sourceObl(f, P), le: dateLe(f.le, P) });
    });
    if (Object.keys(out).length > 30) throw bad("enveloppes_infos : 30 enveloppes au plus (" + Object.keys(out).length + " après fusion).");
    return out;
  }
  function fusionPretsInfos(v, existants) {
    if (!objet(v)) throw bad("prets_infos : objet { prêt: informations } attendu.");
    if (Object.keys(v).length > 50) throw bad("prets_infos : 50 prêts au plus.");
    const out = Object.assign({}, objet(existants) ? existants : {}), auj = jourIso(), pr = C.profil || {};
    Object.keys(v).forEach(k => {
      const env = k.trim().toLowerCase(), f = v[k];
      const m = /^(credit|bien):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(env);
      if (!m) throw bad("prets_infos : clé « " + k + " » invalide (credit:<identifiant> ou bien:<identifiant> attendu).");
      if (f === null) { delete out[env]; return; }
      const P = "prets_infos « " + env + " »";
      if (!objet(f)) throw bad(P + " : objet ou null attendu.");
      const liste = m[1] === "credit" ? pr.credits : pr.biens;
      if (!(Array.isArray(liste) ? liste : []).some(x => String(x.id).toLowerCase() === m[2])) throw bad(P + " : " + (m[1] === "credit" ? "crédit" : "bien") + " introuvable.");
      const champs = ["date_signature", "date_fin", "duree_mois", "taux_pct", "assurance_taux_pct", "ira_exoneration", "source", "le"];
      const inconnu = Object.keys(f).find(x => !champs.includes(x));
      if (inconnu) throw bad(P + " : champ « " + inconnu + " » inconnu (" + champs.join(", ") + ").");
      const ligne = {};
      ["date_signature", "date_fin"].forEach(c => {
        if (!nonVide(f[c])) return;
        const d = jourReel(f[c]);
        if (!d) throw bad(P + " : " + c + " invalide (AAAA-MM-JJ).");
        if (c === "date_signature" && d > auj) throw bad(P + " : date_signature dans le futur.");
        if (d < "1950-01-01") throw bad(P + " : " + c + " antérieure à 1950.");
        ligne[c] = d;
      });
      if (ligne.date_signature && ligne.date_fin && ligne.date_fin <= ligne.date_signature) throw bad(P + " : date_fin à placer après date_signature.");
      [["duree_mois", 1, 480, "entier de 1 à 480 attendu"], ["taux_pct", 0, 20, "pourcentage par an entre 0 et 20 attendu"], ["assurance_taux_pct", 0, 5, "pourcentage par an entre 0 et 5 attendu"]].forEach(([c, lo, hi, txt]) => {
        if (!nonVide(f[c])) return;
        const x = nombreStrict(f[c]);
        if (x === null || x < lo || x > hi || (c === "duree_mois" && x !== Math.trunc(x))) throw bad(P + " : " + c + " invalide (" + txt + ").");
        ligne[c] = x;
      });
      if (nonVide(f.ira_exoneration)) {
        if (typeof f.ira_exoneration !== "boolean") throw bad(P + " : ira_exoneration invalide (true ou false attendu).");
        ligne.ira_exoneration = f.ira_exoneration;
      }
      if (!Object.keys(ligne).length) throw bad(P + " : au moins une information attendue (date_signature, date_fin, duree_mois, taux_pct, assurance_taux_pct ou ira_exoneration).");
      out[env] = Object.assign(ligne, { source: sourceObl(f, P), le: dateLe(f.le, P) });
    });
    if (Object.keys(out).length > 50) throw bad("prets_infos : 50 prêts au plus (" + Object.keys(out).length + " après fusion).");
    return out;
  }
  function remplacerDonations(v) {
    if (!Array.isArray(v)) throw bad("donations : liste de donations attendue.");
    if (v.length > 100) throw bad("donations : 100 donations au plus.");
    const ids = [], auj = jourIso();
    return v.map((it, i) => {
      const n = i + 1;
      if (!objet(it)) throw bad("donation " + n + " : objet attendu.");
      const id = ecrit(it.id);
      if (!id || id.length > 64) throw bad("donation " + n + " : identifiant (id) manquant ou trop long (1 à 64 caractères).");
      if (ids.includes(id)) throw bad("donation " + n + " : identifiant « " + id + " » en double.");
      ids.push(id);
      const P = "donations « " + id + " »";
      const inconnu = Object.keys(it).find(x => !["id", "date", "montant", "donateur", "lien", "beneficiaire", "nature", "source", "le"].includes(x));
      if (inconnu) throw bad(P + " : champ « " + inconnu + " » inconnu (id, date, montant, donateur, lien, beneficiaire, nature, source, le).");
      const d = jourReel(it.date);
      if (!d) throw bad(P + " : date invalide (AAAA-MM-JJ).");
      if (d > auj) throw bad(P + " : date dans le futur.");
      const m = nombreStrict(it.montant);
      if (m === null || m <= 0) throw bad(P + " : montant invalide (montant strictement positif attendu).");
      if (!["p1", "p2"].includes(it.donateur)) throw bad(P + " : donateur invalide (p1 ou p2 attendu).");
      if (!["enfant", "petit_enfant", "arriere_petit_enfant", "autre"].includes(it.lien)) throw bad(P + " : lien invalide (enfant, petit_enfant, arriere_petit_enfant ou autre attendu).");
      const b = ecrit(it.beneficiaire);
      if (!b || b.length > 40) throw bad(P + " : bénéficiaire (beneficiaire) obligatoire (1 à 40 caractères).");
      if (!["donation", "don_argent_790g", "don_logement_790a_bis"].includes(it.nature)) throw bad(P + " : nature invalide (donation, don_argent_790g ou don_logement_790a_bis attendu).");
      return { id, date: d, montant: m, donateur: it.donateur, lien: it.lien, beneficiaire: b, nature: it.nature, source: sourceObl(it, P), le: dateLe(it.le, P) };
    });
  }
  function remplacerAvisImpot(v) {
    if (!objet(v)) throw bad("avis_impot : objet attendu.");
    if (!Object.keys(v).length) return {};
    const an = +jourIso().slice(0, 4);
    const inconnu = Object.keys(v).find(x => !["annee_revenus", "rfr", "plafonds_per", "source", "le"].includes(x));
    if (inconnu) throw bad("avis_impot : champ « " + inconnu + " » inconnu (annee_revenus, rfr, plafonds_per, source, le).");
    const annee = x => (typeof x === "number" || (typeof x === "string" && /^\d{4}$/.test(x)) ? +x : null);
    const a = annee(v.annee_revenus);
    if (a === null || a !== Math.trunc(a) || a < 2000 || a > an) throw bad("avis_impot : annee_revenus invalide (entier de 2000 à l'année en cours attendu).");
    const avis = { annee_revenus: a };
    if (nonVide(v.rfr)) {
      const r = nombreStrict(v.rfr);
      if (r === null || r < 0) throw bad("avis_impot : rfr invalide (montant positif ou nul attendu).");
      avis.rfr = r;
    }
    if (nonVide(v.plafonds_per)) {
      if (!objet(v.plafonds_per)) throw bad("avis_impot : plafonds_per : objet { p1, p2 } attendu.");
      const autre = Object.keys(v.plafonds_per).find(x => !["p1", "p2"].includes(x));
      if (autre) throw bad("avis_impot : plafonds_per : personne « " + autre + " » inconnue (p1 ou p2).");
      const pl = {};
      ["p1", "p2"].forEach(p => {
        const l = v.plafonds_per[p];
        if (!nonVide(l)) return;
        if (!Array.isArray(l)) throw bad("avis_impot : plafonds_per." + p + " : liste attendue.");
        if (l.length > 6) throw bad("avis_impot : plafonds_per." + p + " : 6 lignes au plus.");
        const vus = [], lignes = l.map((it, i) => {
          const Q = "avis_impot : plafonds_per." + p + " : ligne " + (i + 1);
          if (!objet(it)) throw bad(Q + " : objet attendu.");
          const x = Object.keys(it).find(c => !["annee", "montant"].includes(c));
          if (x) throw bad(Q + " : champ « " + x + " » inconnu (annee, montant).");
          const y = annee(it.annee);
          if (y === null || y !== Math.trunc(y) || y < 2000 || y > an + 1) throw bad(Q + " : annee invalide (entier de 2000 à l'année en cours + 1 attendu).");
          if (vus.includes(y)) throw bad("avis_impot : plafonds_per." + p + " : annee " + y + " en double.");
          vus.push(y);
          const m = nombreStrict(it.montant);
          if (m === null || m <= 0) throw bad(Q + " : montant invalide (montant strictement positif attendu).");
          return { annee: y, montant: m };
        });
        if (lignes.length) pl[p] = lignes;
      });
      if (Object.keys(pl).length) avis.plafonds_per = pl;
    }
    return Object.assign(avis, { source: sourceObl(v, "avis_impot"), le: dateLe(v.le, "avis_impot") });
  }
  /** personnes.<p1|p2>.naissance : AAAA-MM-JJ ou AAAA-MM, date réelle, pas dans le futur, pas avant 1900 (null la retire). */
  function controlerNaissance(cle, val) {
    if (!nonVide(val)) return;
    const d = typeof val === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(val) ? jourReel(val.length === 7 ? val + "-01" : val) : null;
    if (!d) throw bad("personnes." + cle + " : naissance invalide (AAAA-MM-JJ ou AAAA-MM).");
    if (d > jourIso()) throw bad("personnes." + cle + " : naissance dans le futur.");
    if (d < "1900-01-01") throw bad("personnes." + cle + " : naissance antérieure à 1900.");
  }
  function normVersements(liste, existants) {
    if (!Array.isArray(liste)) throw bad("recurring : liste de versements attendue.");
    if (liste.length > 50) throw bad("recurring : 50 versements au plus.");
    const avant = Array.isArray(existants) ? existants : [], vus = [];
    return liste.map((r, i) => {
      const n = i + 1;
      if (!objet(r)) throw bad("versement " + n + " : objet attendu.");
      const id = String(r.id ?? "").trim();
      if (!id || id.length > 64) throw bad("versement " + n + " : identifiant (id) manquant ou trop long.");
      if (vus.includes(id)) throw bad("versement " + n + " : identifiant « " + id + " » en double.");
      vus.push(id);
      const label = String(r.label ?? "").trim();
      if (!label || label.length > 80) throw bad("versement " + n + " : libellé (label) manquant ou trop long (80 caractères au plus).");
      if (!C.positions.some(x => String(x.id) === String(r.positionId) && x.status !== "clôturé")) throw bad("versement « " + label + " » : ligne « " + (r.positionId ?? "") + " » introuvable ou clôturée.");
      const amount = num(r.amount), day = num(r.day);
      if (!(amount > 0)) throw bad("versement « " + label + " » : montant (amount) invalide (nombre strictement positif attendu).");
      if (!(Number.isInteger(day) && day >= 1 && day <= 28)) throw bad("versement « " + label + " » : jour (day) invalide (entier de 1 à 28).");
      if (r.start != null && (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.start)) || isNaN(Date.parse(r.start)))) throw bad("versement « " + label + " » : date de début (start) invalide (AAAA-MM-JJ).");
      const o = Object.assign({}, r, { id, label, amount, day });
      delete o.lastApplied; // tenu par l'agent nocturne : repris de l'existant, jamais de la proposition
      const ex = avant.find(x => x && String(x.id) === id);
      if (ex && typeof ex.lastApplied === "string") o.lastApplied = ex.lastApplied;
      return o;
    });
  }
  function appliquerUne(p, v) {
    const objetAttendu = () => { if (p.operation !== "supprimer" && !objet(v)) throw bad("valeur proposée invalide (objet attendu)."); };
    objetAttendu();
    const pr = C.profil = C.profil || { foyer: {}, personnes: { p1: { nom: "Moi" } }, autres: {}, biens: [], credits: [], protection: {} };
    const ligne = (liste, quoi) => { const i = liste.findIndex(x => x.id === p.ref); if (i < 0) introuvable(quoi, p.ref); return i; };
    switch (p.cible) {
      case "profil": {
        if ("foyer" in v) { if (!objet(v.foyer)) throw bad("foyer : objet attendu."); pr.foyer = sansNull(Object.assign({}, pr.foyer, v.foyer)); }
        if ("classes" in v) C.classes = fusionClasses(v.classes);
        ["personnes", "autres"].forEach(cle => {
          if (!(cle in v)) return;
          if (!objet(v[cle])) throw bad(cle + " : objet attendu.");
          const cur = Object.assign({}, pr[cle]);
          Object.keys(v[cle]).forEach(k => {
            if (!["p1", "p2"].includes(k)) throw bad(cle + " : personne « " + k + " » inconnue (p1 ou p2).");
            if (v[cle][k] === null && cle === "personnes") { if (k === "p1") throw bad("la première personne du foyer ne peut pas être retirée."); delete cur[k]; }
            else if (objet(v[cle][k])) { if (cle === "personnes") controlerNaissance(k, v[cle][k].naissance); cur[k] = sansNull(Object.assign({}, cur[k], v[cle][k])); }
            else throw bad(cle + "." + k + " : objet attendu.");
          });
          pr[cle] = cur;
        });
        break;
      }
      case "budget": {
        const lignes = (C.budget && C.budget.lignes) || [];
        if (p.operation === "supprimer") { lignes.splice(ligne(lignes, "ligne de budget"), 1); C.budget = { lignes }; break; }
        if (p.operation === "creer") {
          const n = normLignes([sansNull(v)])[0];
          if (lignes.some(l => l.id === n.id)) throw bad("une ligne de budget porte déjà l'identifiant « " + n.id + " ».");
          C.budget = { lignes: lignes.concat([n]) };
        } else {
          const i = ligne(lignes, "ligne de budget");
          lignes[i] = normLignes([sansNull(Object.assign({}, lignes[i], v, { id: p.ref }))])[0];
          C.budget = { lignes };
        }
        break;
      }
      case "position": {
        let id = p.ref;
        if (p.operation === "supprimer") { C.positions.splice(ligne(C.positions, "ligne"), 1); break; }
        if (p.operation === "creer") {
          const vue = versVuePosition(v);
          if (vue.owner && !["p1", "p2"].includes(vue.owner)) throw bad("titulaire « " + vue.owner + " » inconnu (p1 ou p2).");
          controleRole(vue);
          if (vue.roleSource != null && vue.role == null) throw bad("role_source sans role (le rôle de la ligne est attendu avec sa source)");
          id = newId("pos");
          C.positions.push(Object.assign({ id, name: "Sans nom", envelope: "", owner: "p1", bloc: "", mode: vue.isin && vue.qty != null ? "market" : "manual", isin: null, qty: null, pru: null,
            price: null, priceDate: null, value: null, valueDate: null, status: "actif", hypothesis: null, qtyEstimated: false, note: null,
            ter: null, zone: null, devise: null, annoteSource: null, annoteLe: null, symbol: null, role: null, roleSource: null }, vue));
        } else {
          const vue = versVuePosition(v);
          if (vue.owner && !["p1", "p2"].includes(vue.owner)) throw bad("titulaire « " + vue.owner + " » inconnu (p1 ou p2).");
          controleRole(vue);
          const cible = C.positions[ligne(C.positions, "ligne")];
          if ("role" in vue && vue.role == null && !("roleSource" in vue)) vue.roleSource = null; // retirer le rôle retire sa source
          Object.assign(cible, vue);
        }
        if (objet(v.transaction)) {
          const t = v.transaction;
          C.tx.unshift({ id: newId("tx"), positionId: id, date: t.date || new Date().toISOString().slice(0, 10), type: t.type || "autre",
            qty: t.qty ?? null, price: t.price ?? null, amount: t.amount ?? null, note: t.note || "", source: t.source || "mcp", createdAt: new Date().toISOString() });
        }
        break;
      }
      case "bien": case "credit": {
        const cle = p.cible === "bien" ? "biens" : "credits", quoi = p.cible === "bien" ? "bien" : "crédit";
        const liste = pr[cle] = pr[cle] || [];
        if (p.cible === "bien" && v && v.usage != null && !["rp", "locatif", "secondaire"].includes(v.usage)) throw bad("usage « " + v.usage + " » inconnu (rp, locatif ou secondaire).");
        if (p.cible === "credit" && v && v.owner != null && !OWNERS.includes(v.owner)) throw bad("titulaire « " + v.owner + " » inconnu (p1, p2 ou commun).");
        if (p.operation === "supprimer") liste.splice(ligne(liste, quoi), 1);
        else if (p.operation === "creer") liste.push(Object.assign(p.cible === "bien" ? { nom: "", usage: "rp", valeur: 0, part_p1: 100, crd: 0, mensualite: 0, loyer: 0 } : { nom: "", owner: "commun", crd: 0, mensualite: 0 }, v, { id: newId(p.cible) }));
        else Object.assign(liste[ligne(liste, quoi)], v);
        break;
      }
      case "objectif": {
        if (p.operation === "supprimer") { C.objectifs.splice(ligne(C.objectifs, "objectif"), 1); break; }
        const n = normObjectif(versVueObjectif(v));
        if (p.operation === "creer") C.objectifs.push(Object.assign(clone(OBJ_DEFAUT), n, { id: newId("obj") }));
        else Object.assign(C.objectifs[ligne(C.objectifs, "objectif")], n);
        C.objectifs.sort((x, y) => x.priorite - y.priorite);
        break;
      }
      case "risque": {
        const rep = objet(v.reponses) ? v.reponses : v;
        const inconnue = Object.keys(rep).find(k => !QUESTIONS_RISQUE.includes(k));
        if (inconnue) throw bad("question « " + inconnue + " » inconnue.");
        const cur = objet(C.risque) ? C.risque : {};
        C.risque = Object.assign({}, cur, { reponses: Object.assign({}, objet(cur.reponses) ? cur.reponses : {}, rep) });
        break;
      }
      case "protection":
        pr.protection = sansNull(Object.assign({}, pr.protection, v));
        break;
      case "evenement": case "variante": case "plan_fige": {
        const Ev = window.ProjectionEvenements, rogner = x => String(x == null ? "" : x).trim().replace(/\s+/g, " "), present = x => x !== undefined && x !== null && x !== "";
        const octets = x => unescape(encodeURIComponent(JSON.stringify(x))).length;
        const uuid = () => "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
        const maintenant = new Date().toISOString();
        if (p.cible === "evenement") {
          const liste = C.foyer.evenements;
          if (p.operation === "supprimer") { const i = liste.findIndex(x => x.id === p.ref); if (i < 0) throw bad("événement « " + p.ref + " » introuvable"); liste.splice(i, 1); break; }
          const inconnu = Object.keys(v).find(k => !["type", "personne", "libelle", "date", "fin", "params", "source", "variante_id"].includes(k));
          if (inconnu) throw bad("événement : champ « " + inconnu + " » inconnu (type, personne, libelle, date, fin, params, source, variante_id)");
          let ev = v, cible = null;
          if (p.operation === "modifier") { cible = liste.find(x => x.id === p.ref); if (!cible) throw bad("événement « " + p.ref + " » introuvable"); ev = Object.assign({}, cible, v); }
          const msg = Ev.validerEvenement(ev, { today: jourIso(), credits: (C.profil && C.profil.credits) || [], biens: (C.profil && C.profil.biens) || [] });
          if (msg) throw bad(msg);
          let vid = null;
          if (present(ev.variante_id)) {
            vid = String(ev.variante_id);
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vid)) throw bad("événement : variante_id invalide (identifiant de variante attendu)");
            if (!C.foyer.variantes.some(x => x.id === vid)) throw bad("variante « " + vid + " » introuvable");
          }
          const ligne = { variante_id: vid, type: ev.type, personne: ev.personne, libelle: rogner(ev.libelle), date: ev.date, fin: present(ev.fin) ? ev.fin : null, params: ev.params === undefined ? {} : clone(ev.params), source: rogner(ev.source) };
          if (p.operation === "creer") {
            if (liste.length >= 100) throw bad("Limite atteinte : 100 événements au plus. Supprime un événement avant d'en ajouter un.");
            liste.push(Object.assign({ id: uuid(), created_at: maintenant, updated_at: maintenant }, ligne));
          } else Object.assign(cible, ligne, { updated_at: maintenant });
        } else if (p.cible === "variante") {
          const liste = C.foyer.variantes;
          if (p.operation === "supprimer") {
            const i = liste.findIndex(x => x.id === p.ref); if (i < 0) throw bad("variante « " + p.ref + " » introuvable");
            liste.splice(i, 1); C.foyer.evenements = C.foyer.evenements.filter(x => x.variante_id !== p.ref); break;
          }
          const inconnu = Object.keys(v).find(k => !["nom", "description", "retire", "hypotheses"].includes(k));
          if (inconnu) throw bad("variante : champ « " + inconnu + " » inconnu (nom, description, retire, hypotheses)");
          let ev = v, cible = null;
          if (p.operation === "modifier") { cible = liste.find(x => x.id === p.ref); if (!cible) throw bad("variante « " + p.ref + " » introuvable"); ev = Object.assign({ nom: cible.nom, description: cible.description, retire: cible.retire, hypotheses: cible.hypotheses }, v); }
          const msg = Ev.validerVariante(ev);
          if (msg) throw bad(msg);
          const ligne = { nom: rogner(ev.nom), description: present(ev.description) ? ev.description : "", retire: present(ev.retire) ? clone(ev.retire) : [], hypotheses: objet(ev.hypotheses) ? clone(ev.hypotheses) : {} };
          if (p.operation === "creer") {
            if (liste.length >= 10) throw bad("Limite atteinte : 10 variantes au plus. Supprime une variante avant d'en ajouter une.");
            liste.push(Object.assign({ id: uuid(), created_at: maintenant, updated_at: maintenant }, ligne));
          } else Object.assign(cible, ligne, { updated_at: maintenant });
        } else {
          const liste = C.plansFiges;
          if (p.operation === "modifier") throw bad("plan figé : seules la création et la suppression sont possibles");
          if (p.operation === "supprimer") { const i = liste.findIndex(x => x.id === p.ref); if (i < 0) throw bad("plan figé « " + p.ref + " » introuvable"); liste.splice(i, 1); break; }
          const inconnu = Object.keys(v).find(k => !["raison", "horizon_mois", "parametres", "serie"].includes(k));
          if (inconnu) throw bad("plan figé : champ « " + inconnu + " » inconnu (raison, horizon_mois, parametres, serie)");
          if (!["revue_mensuelle", "objectif", "manuel"].includes(v.raison)) throw bad("plan figé : raison invalide (revue_mensuelle, objectif ou manuel attendu)");
          const h = typeof v.horizon_mois === "number" || (typeof v.horizon_mois === "string" && v.horizon_mois.trim() !== "") ? +v.horizon_mois : NaN;
          if (!(Number.isInteger(h) && h >= 1 && h <= 300)) throw bad("plan figé : horizon_mois invalide (entier de 1 à 300 attendu)");
          if (!objet(v.parametres)) throw bad("plan figé : parametres : objet attendu");
          if (!objet(v.serie)) throw bad("plan figé : serie : objet attendu");
          if (octets(v.parametres) > 100000) throw bad("plan figé : parametres : 100 000 octets au plus");
          if (octets(v.serie) > 250000) throw bad("plan figé : serie : 250 000 octets au plus");
          if (liste.length >= 60) throw bad("Limite atteinte : 60 plans figés au plus. Supprime un plan figé avant d'en ajouter un.");
          liste.push({ id: uuid(), cree_le: maintenant, raison: v.raison, horizon_mois: h, parametres: clone(v.parametres), serie: clone(v.serie) });
        }
        break;
      }
      case "config": {
        if (p.operation !== "modifier") throw bad("réglages : seule la modification est possible.");
        const CLES_CFG = ["cushion", "recurring", "frais_enveloppes", "enveloppes_infos", "prets_infos", "donations", "avis_impot", "projection", "suivi", "partage", "budget_cible", "budget_preferences"];
        const autre = Object.keys(v).find(k => !CLES_CFG.includes(k));
        if (autre) throw bad("réglage « " + autre + " » non modifiable par proposition (cushion, recurring, frais_enveloppes, enveloppes_infos, prets_infos, donations, avis_impot, projection, suivi, partage, budget_cible ou budget_preferences seulement).");
        if (!CLES_CFG.some(k => k in v)) throw bad("réglages : cushion ou recurring attendu (ou frais_enveloppes, enveloppes_infos, prets_infos, donations, avis_impot, projection, suivi, partage, budget_cible ou budget_preferences).");
        /* BUD1 (0035) : le partage, la cible et les préférences du budget se valident dans la base ; la démonstration n'a pas de connecteur qui les propose (tâche « stores et démo » de BUD1) */
        const budget = ["partage", "budget_cible", "budget_preferences"].find(k => k in v);
        if (budget) throw bad("réglage « " + budget + " » indisponible dans la démonstration.");
        const cfg = Object.assign({}, C.config || {});
        if ("cushion" in v) cfg.cushion = normMatelas(v.cushion);
        if ("recurring" in v) cfg.recurring = normVersements(v.recurring, cfg.recurring);
        if ("frais_enveloppes" in v) cfg.frais_enveloppes = fusionFraisEnveloppes(v.frais_enveloppes, cfg.frais_enveloppes);
        if ("enveloppes_infos" in v) cfg.enveloppes_infos = fusionEnveloppesInfos(v.enveloppes_infos, cfg.enveloppes_infos);
        if ("prets_infos" in v) cfg.prets_infos = fusionPretsInfos(v.prets_infos, cfg.prets_infos);
        if ("donations" in v) cfg.donations = remplacerDonations(v.donations);
        if ("avis_impot" in v) cfg.avis_impot = remplacerAvisImpot(v.avis_impot);
        if ("projection" in v) { /* PROJ : réglages de projection, mêmes règles et messages que la base (0031) */
          const r = window.ProjectionEvenements.fusionnerReglagesProjection(cfg.projection, v.projection, { today: jourIso(), biens: (C.profil && C.profil.biens) || [] });
          if (r.erreur) throw bad(r.erreur);
          cfg.projection = r.projection;
        }
        if ("suivi" in v) cfg.suivi = fusionSuivi(v.suivi, cfg.suivi); /* SUIVI : politique de suivi des lignes, mêmes règles et messages que la base (0032) */
        C.config = cfg;
        break;
      }
      default:
        throw bad("cible « " + p.cible + " » inconnue.");
    }
  }
  const LIBELLES_CIBLE = { profil: "profil", budget: "ligne de budget", position: "placement", bien: "bien immobilier", credit: "crédit", objectif: "objectif", risque: "profil de risque", protection: "protection", config: "réglages", evenement: "événement", variante: "variante", plan_fige: "plan figé" };
  const propositions = {
    async appliquer(ids, modifications = {}) {
      await tick();
      const mods = modifications == null ? {} : modifications;
      if (!objet(mods)) throw bad("Modifications invalides : objet { identifiant: valeur } attendu.");
      const liste = (Array.isArray(ids) ? ids : []).map(String);
      const cibles = C.propositions.filter(p => liste.includes(String(p.id)) && p.statut === "en_attente")
        .sort((a, b) => String(a.creeLe).localeCompare(String(b.creeLe)));
      const sauvegarde = clone({ positions: C.positions, tx: C.tx, profil: C.profil, budget: C.budget, objectifs: C.objectifs, risque: C.risque, classes: C.classes, config: C.config, propositions: C.propositions });
      try {
        const now = new Date().toISOString();
        cibles.forEach(p => {
          const v = Object.prototype.hasOwnProperty.call(mods, p.id) ? clone(mods[p.id]) : clone(p.apres);
          try { appliquerUne(p, v); } catch (e) { throw bad("Proposition non appliquée (" + LIBELLES_CIBLE[p.cible] + ", " + p.operation + ") : " + String(e.message || e).replace(/\.$/, "") + "."); }
          p.statut = "acceptee"; p.decideLe = now; if (p.operation !== "supprimer") p.apres = v;
        });
      } catch (e) {
        Object.assign(C, sauvegarde);
        throw e;
      }
      publish();
      return { appliquees: cibles.length };
    },
    async refuser(ids) {
      await tick();
      const liste = (Array.isArray(ids) ? ids : []).map(String), now = new Date().toISOString();
      let n = 0;
      C.propositions.forEach(p => { if (liste.includes(String(p.id)) && p.statut === "en_attente") { p.statut = "refusee"; p.decideLe = now; n++; } });
      publish();
      return { refusees: n };
    },
  };

  /* ---------- mémoire de l'agent et savoir commun (en mémoire) ---------- */
  // Même validation que store-supabase.js (et que la base : 1 à 500 caractères, pas de contenu sensible, échéance pour « à suivre »).
  // Le filtre sensible est le module partagé web/src/sensible.js (mêmes motifs que la contrainte SQL contenu_sensible).
  const estSensible = t => !!(window.Sensible && window.Sensible.estSensible(t));
  const MSG_SENSIBLE = "Ce souvenir contient une information sensible (numéro de compte ou de carte, identifiant, mot de passe) : il n'est pas enregistré.";
  function normSouvenir(patch, m) {
    const p = patch || {}, out = {};
    if ("contenu" in p) {
      const t = String(p.contenu == null ? "" : p.contenu).trim();
      if (!t || t.length > 500) throw bad("Un souvenir compte de 1 à 500 caractères.");
      if (estSensible(t)) throw bad(MSG_SENSIBLE);
      out.contenu = t;
    }
    if ("epingle" in p) out.epingle = !!p.epingle;
    if ("echeance" in p) {
      const e = p.echeance == null || p.echeance === "" ? null : String(p.echeance);
      if (e && (!/^\d{4}-\d{2}-\d{2}$/.test(e) || isNaN(Date.parse(e)))) throw bad("Échéance « " + e + " » invalide (format AAAA-MM-JJ).");
      if (e && m && m.categorie !== "a_suivre") throw bad("Seul un point « à suivre » porte une échéance.");
      out.echeance = e;
    }
    return out;
  }
  const memoire = {
    async modifier(id, patch) {
      await tick();
      try {
        const m = C.memoire.find(x => x.id === id);
        if (!m) throw bad("Souvenir introuvable.");
        const v = normSouvenir(clone(patch), m);
        if (Object.keys(v).length) { Object.assign(m, v, { majLe: new Date().toISOString() }); publish(); }
        return { ok: true };
      } catch (e) { return { erreur: e.message || String(e) }; }
    },
    async supprimer(ids) {
      await tick();
      const liste = (Array.isArray(ids) ? ids : []).map(String);
      C.memoire = C.memoire.filter(m => !liste.includes(String(m.id)));
      publish();
      return { ok: true };
    },
    async toutEffacer() {
      await tick();
      C.memoire = [];
      publish();
      return { ok: true };
    },
  };
  /* ---------- journal des décisions (en mémoire ; même validation que store-supabase.js, même historique que la base) ---------- */
  const J_STATUTS = ["actif", "realise", "abandonne", "archive"], J_CONSENTEMENTS = ["demander", "prevenir", "jamais"];
  const MSG_SENSIBLE_J = "Cette entrée contient une information sensible (numéro de compte ou de carte, identifiant, mot de passe) : elle n'est pas enregistrée.";
  const J_COLS = { titre: "titre", synthese: "synthese", statut: "statut", revueLe: "revue_le", dateDecision: "date_decision" };
  /* Ordre des champs du déclencheur journal_historique (type, titre, synthese, raisonnement, statut, date_decision, revue_le,
     options, liens) restreint aux champs modifiables ici : l'historique de la démo s'écrit dans le même ordre que la base. */
  const J_ORDRE = ["titre", "synthese", "statut", "dateDecision", "revueLe"];
  /* Plafond de l'historique (0014_journal_durcissement.sql) : les 20 premières entrées et les 180 dernières. */
  const plafondHistorique = h => (h.length > 200 ? h.slice(0, 20).concat(h.slice(-180)) : h);
  function normEntree(patch) {
    const p = patch || {}, out = {}, has = k => Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined;
    const texte = (k, min, max, quoi) => {
      const t = String(p[k] == null ? "" : p[k]).trim();
      if (t.length < min || t.length > max) throw bad(quoi + " compte de " + min + " à " + max + " caractères.");
      if (estSensible(t)) throw bad(MSG_SENSIBLE_J);
      out[k] = t;
    };
    const date = (k, alias, quoi) => {
      const cle = has(k) ? k : has(alias) ? alias : null; if (!cle) return;
      const v = p[cle] == null || p[cle] === "" ? null : String(p[cle]);
      if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v)) || new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v)) throw bad(quoi + " « " + v + " » invalide (format AAAA-MM-JJ).");
      out[k] = v;
    };
    if (has("titre")) texte("titre", 3, 120, "Un titre");
    if (has("synthese")) texte("synthese", 1, 600, "Une synthèse");
    if (has("statut")) { if (!J_STATUTS.includes(p.statut)) throw bad("Statut « " + p.statut + " » inconnu (actif, realise, abandonne ou archive)."); out.statut = p.statut; }
    date("revueLe", "revue_le", "Date de revue");
    date("dateDecision", "date_decision", "Date de décision");
    return out;
  }
  const journal = {
    async confirmer(ids) {
      await tick();
      const liste = (Array.isArray(ids) ? ids : []).map(String), now = new Date().toISOString();
      let n = 0;
      // Première confirmation (a_relire → actif) : non historisée, comme le déclencheur journal_historique.
      C.journal.forEach(e => { if (liste.includes(String(e.id)) && e.statut === "a_relire") { e.statut = "actif"; e.majLe = now; n++; } });
      if (n) publish();
      return { ok: true };
    },
    async modifier(id, patch) {
      await tick();
      try {
        const e = C.journal.find(x => x.id === id);
        if (!e) throw bad("Entrée du journal introuvable.");
        const v = normEntree(clone(patch));
        const champs = J_ORDRE.filter(k => k in v && v[k] !== e[k]);
        if (!champs.length) return { ok: true };
        const now = new Date().toISOString();
        // Historique dès que l'entrée a été confirmée (statut ≠ a_relire ou historique déjà commencé) ; 20 premières + 180 dernières.
        if (e.statut !== "a_relire" || e.historique.length) {
          champs.forEach(k => e.historique.push({ le: now, champ: J_COLS[k], avant: e[k] ?? null, apres: v[k] ?? null }));
          e.historique = plafondHistorique(e.historique);
        }
        champs.forEach(k => { e[k] = v[k]; });
        e.majLe = now;
        publish();
        return { ok: true };
      } catch (err) { return { erreur: err.message || String(err) }; }
    },
    async supprimer(ids) {
      await tick();
      const liste = (Array.isArray(ids) ? ids : []).map(String);
      C.journal = C.journal.filter(e => !liste.includes(String(e.id)));
      publish();
      return { ok: true };
    },
    async consentement(mode) {
      await tick();
      if (!J_CONSENTEMENTS.includes(mode)) return { erreur: "Choix « " + mode + " » inconnu (demander, prevenir ou jamais)." };
      C.journalConsentement = mode;
      publish();
      return { ok: true };
    },
  };

  /* ---------- routines de l'agent (en mémoire ; même validation que store-supabase.js, même recalcul que routines_maj) ---------- */
  const ROUTINE_TYPES = ["revue_mensuelle"];
  /* Date de Paris et routine_date de 0020 : RoutineEtat (routine-etat.js, chargé avant ce fichier par build.mjs), seule copie côté app. */
  const RE = () => (typeof window !== "undefined" && window.RoutineEtat) ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./routine-etat.js") : null);
  const routines = {
    async pause(type, enPause) {
      await tick();
      if (!ROUTINE_TYPES.includes(type)) return { erreur: "Routine « " + type + " » inconnue (revue_mensuelle)." };
      if (typeof enPause !== "boolean") return { erreur: "Pause invalide : vrai (en pause) ou faux (active) attendu." };
      const r = C.routines.find(x => x.type === type);
      if (!r) return { erreur: "Routine introuvable : demande à Claude de l'activer." };
      if (r.active === !enPause) return { ok: true };
      r.active = !enPause;
      if (r.active) r.prochainPassage = RE().routineDate(r.jour, RE().aujParis(), 7); // pause → active : comme le déclencheur routines_maj
      publish();
      return { ok: true };
    },
  };

  /* ---------- banques connectées (BQ1) : pas de page Powens en démo ; déconnexion et rattachement en mémoire ---------- */
  const BE = () => (typeof window !== "undefined" && window.BanqueEtat) ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./banque-etat.js") : null);
  const banque = {
    async connecter() {
      await tick();
      return { erreur: "Indisponible en démonstration : la connexion bancaire fonctionne avec ton propre compte." };
    },
    async gerer() {
      await tick();
      return { erreur: "Indisponible en démonstration : la gestion des comptes bancaires fonctionne avec ton propre compte." };
    },
    /* « Synchroniser maintenant » : en démo, seule la date de synchronisation change. */
    async synchroniser(connectionId) {
      await tick();
      const id = String(connectionId);
      const cx = C.banque.connexions.find(c => String(c.id) === id);
      if (!cx) return { erreur: "Connexion introuvable." };
      C.banque = Object.assign({}, C.banque, { connexions: C.banque.connexions.map(c => (c === cx ? Object.assign({}, c, { derniereSynchro: new Date().toISOString() }) : c)) });
      publish();
      const comptes = C.banque.comptes.filter(c => String(c.connexionId) === id).length;
      return { ok: true, rapport: { ok: true, sautee: false, relance: true, etat: cx.etat ?? null, comptes, operations: 0, rattaches_auto: 0, crees_auto: 0, suggestions: 0,
        comptes_en_double: 0, doublon_de: null, positions_creees: 0, lignes_adoptees: 0, propositions: 0, erreurs: 0 } };
    },
    async deconnecter(connectionId) {
      await tick();
      const id = String(connectionId);
      if (!C.banque.connexions.some(c => String(c.id) === id)) return { erreur: "Connexion introuvable." };
      C.banque = Object.assign({}, C.banque, { connexions: C.banque.connexions.filter(c => String(c.id) !== id), comptes: C.banque.comptes.filter(c => String(c.connexionId) !== id) });
      publish();
      return { ok: true };
    },
    /* Opérations des comptes demandés depuis `depuis` (D.operationsBancaires : 100 jours du compte joint), les plus récentes d'abord. */
    async operations(compteIds, depuis) {
      await tick();
      const ids = new Set((Array.isArray(compteIds) ? compteIds : []).map(String)), d0 = String(depuis || "").slice(0, 10);
      return clone((D.operationsBancaires || []).filter(o => ids.has(String(o.compteId)) && (!d0 || o.date >= d0)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)));
    },
    async rattacher(compteId, cible) {
      await tick();
      try {
        const cpt = C.banque.comptes.find(c => String(c.id) === String(compteId));
        if (!cpt) throw bad("Compte introuvable.");
        const row = BE().normRattachement(clone(cible), { compte: cpt, positions: C.positions, credits: (C.profil && C.profil.credits) || [] });
        Object.assign(cpt, { positionId: row.position_id, enveloppe: row.enveloppe, titulaire: row.titulaire, creditId: row.credit_id, ignore: row.ignore });
        publish();
        return { ok: true };
      } catch (e) { return { erreur: e.message || String(e) }; }
    },
  };

  const savoir = {
    async fiche(slug) {
      await tick();
      const f = FICHES.find(x => x.slug === slug);
      return f ? clone(f) : null;
    },
  };

  const expertises = {
    /* Détail d'une expertise (copie) ; versions reprises du journal des versions, la plus récente d'abord. */
    async detail(slug) {
      await tick();
      const e = EXPERTISES.find(x => x.slug === slug);
      if (!e) return null;
      const d = clone(e);
      d.versions = (Array.isArray(d.changelog) ? d.changelog : []).map(v => ({ version: v.version, le: v.le, resume: v.resume })).sort((a, b) => b.version - a.version);
      return d;
    },
  };

  /* ---------- connexions : simulation de la connexion de Claude (onboarding en démo) ---------- */
  const CLAUDE_ID = (window.BOUSSOLE && window.BOUSSOLE.claude && window.BOUSSOLE.claude.clientId) || "30351516-1e76-4884-8fb2-ae856799a723";
  const DELAI_CONNEXION_DEMO = 4000;
  let connTimer = null;
  function surveillerConnexions(on) {
    if (!on) { clearTimeout(connTimer); connTimer = null; return; }
    if (connTimer || C.connexions.some(c => c.clientId === CLAUDE_ID)) return;
    connTimer = setTimeout(() => {
      connTimer = null;
      const now = new Date().toISOString();
      C.connexions.push({ clientId: CLAUDE_ID, clientNom: "Claude", premierLe: now, dernierLe: now, appels: 1 });
      publish();
    }, DELAI_CONNEXION_DEMO);
  }

  /* ---------- cours historiques (CP1 § 4) : séries de démonstration, déterministes ---------- */
  const SERIES = {};
  /* Graine 32 bits d'un texte, puis générateur mulberry32 : la même série à chaque chargement. */
  const graine = t => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const mulberry = a => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const DAY_MS = 864e5;
  /* 5 ans de jours ouvrés avant le cours du jour (exclu), en remontant le temps depuis le prix courant : volatilité et tendance selon
     la ligne (crypto, action, fonds), arrondi au centime. */
  function serieDemo(p) {
    const fin = String(p.priceDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const crypto = /^X-/.test(p.isin) || p.bloc === "Crypto", fonds = /ETF|fonds/i.test(p.name || "") || /^(IE|LU)/.test(p.isin);
    const vol = crypto ? 0.032 : fonds ? 0.009 : 0.014, tendance = crypto ? 0.0009 : fonds ? 0.00035 : 0.0003;
    const alea = mulberry(graine(String(p.isin))), normale = () => Math.sqrt(-2 * Math.log(alea() || 1e-9)) * Math.cos(2 * Math.PI * alea());
    const out = []; let prix = +p.price, t = Date.parse(fin + "T12:00:00Z");
    for (let n = 0; n < 1305; ) {
      t -= DAY_MS;
      const j = new Date(t).getUTCDay();
      if (j === 0 || j === 6) continue;
      prix = prix / Math.exp(tendance + vol * normale());
      out.push({ date: new Date(t).toISOString().slice(0, 10), cloture: Math.round(prix * 100) / 100 });
      n++;
    }
    return out.reverse();
  }
  async function cours(isins, depuis) {
    await tick();
    const d0 = String(depuis || "").slice(0, 10), out = {};
    (Array.isArray(isins) ? isins : []).forEach(i => {
      const isin = String(i || ""), p = C.positions.find(x => x && x.isin === isin && x.mode === "market" && x.price != null);
      if (!p) return;
      if (!SERIES[isin]) SERIES[isin] = serieDemo(p);
      out[isin] = clone(SERIES[isin].filter(c => !d0 || c.date >= d0));
    });
    return out;
  }

  /* Transactions depuis `depuis`, les plus récentes d'abord (copie). */
  async function transactions(depuis) {
    await tick();
    const d0 = String(depuis == null ? "" : depuis).slice(0, 10);
    return clone(C.tx.filter(t => !/^\d{4}-\d{2}-\d{2}$/.test(d0) || String(t.date).slice(0, 10) >= d0)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)));
  }

  /* Historique importé (HIS2) : « Retirer cet import » en mémoire, comme retirer_import (0034) : les mois, les mouvements et les comptes sans plus aucun mois disparaissent avec l'import ;
     une transaction qu'il avait remplacée (doublonDe) revient. */
  const historique = {
    async retirer(importId) {
      await tick();
      const id = String(importId == null ? "" : importId);
      const imp = C.historiqueImports.find(i => i.id === id);
      if (!imp) return { erreur: "Import introuvable." };
      const ids = new Set(C.tx.filter(t => t.importId === id).map(t => t.id));
      const rel = C.relevesBancaires;
      const releves = rel.releves.filter(r => r.importId !== id);
      const retires = rel.releves.filter(r => r.importId === id);
      const cle = r => r.compteId + "|" + r.mois;
      const sorts = new Set(retires.map(cle));
      C.tx = C.tx.filter(t => t.importId !== id).map(t => (t.doublonDe && ids.has(t.doublonDe) ? Object.assign({}, t, { doublonDe: null }) : t));
      C.relevesBancaires = Object.assign({}, rel, { releves, banqueMois: rel.banqueMois.filter(l => !sorts.has(cle(l))), comptes: rel.comptes.filter(c => releves.some(r => r.compteId === c.id)) });
      C.historiqueImports = C.historiqueImports.filter(i => i.id !== id);
      publish();
      return { ok: true };
    },
  };

  const Store = {
    mode: "demo",
    db,
    propositions,
    memoire,
    savoir,
    expertises,
    /* Scénarios (lecture) : catalogue publié (copie) ; S.scenarios = { catalogue, joues, source } porte aussi les parties jouées. */
    scenarios: { catalogue: () => clone(C.scenarios.catalogue) },
    journal,
    routines,
    plansFiges: { detail(id) { const r = completerPlan(C.plansFiges.find(x => x.id === id)); if (!r) return Promise.resolve(null); const o = clone(r); delete o._jours; return Promise.resolve(o); } },
    get: () => S,
    on(fn) { subs.push(fn); },
    setScope(c) {
      if (!["foyer", "p1", "p2"].includes(c)) return;
      C.scope = c;
      try { localStorage.setItem("scope", c); } catch (e) {}
      publish();
    },
    emit,
    reload() { publish(); return Promise.resolve(); },
    markOnboarded() { return Promise.resolve(); },
    surveillerConnexions,
    cours,
    transactions,
    banque,
    historique,
  };
  window.Store = Store;

  publish();
  // Un court délai pour exercer les états « Chargement… » des modules, comme avec une vraie base.
  setTimeout(() => { C.ready = true; C.dbOk = true; C.profilLoaded = true; C.routinesLues = true; publish(); }, 150);
})();
