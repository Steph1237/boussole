/* Store Supabase : contrat identique à store-demo.js, sur les tables du projet (RLS = isolation par utilisateur).

   Choix du mode au démarrage (pas de store.js intermédiaire) : chaque adaptateur vérifie lui-même son mode
   et seul celui qui correspond installe window.Store. Ce fichier s'installe hors démo (pas de `demo` dans
   l'URL, window.BOUSSOLE_MODE ≠ "demo") ; store-demo.js s'installe sinon.

   Démarrage : attend la session via window.Auth (auth.js, chargé juste après ce fichier ; d'où le boot au
   DOMContentLoaded). Sans session → dbOk = false, ready = true (app.js affiche le bandeau) et Auth.requireSession
   redirige vers index.html#connexion. Avec session : toutes les tables sont lues en parallèle, S est construit
   à la forme canonique (foyer / p1 / p2, voir l'en-tête de store-demo.js) et exposé tel quel aux modules.
   Lecture seule (spec docs/superpowers/specs/2026-10-11-saisie-par-agent.md § 2) : la saisie passe par l'assistant, qui dépose
   des propositions. Seules restent les écritures de contrôle : propositions (appliquer, refuser, corriger à l'application),
   journal (confirmer, modifier, statuts, supprimer, consentement), mémoire (modifier, supprimer, tout effacer), routines (bascule
   active / en pause : Store.routines.pause), règles
   (bascule actif : db.doc("config/main").update({ rules })), profil de risque recalculé après application de propositions
   (db.doc("profil/main").update({ risque })) et compte (markOnboarded). Toute autre écriture de la façade `db` est refusée
   (invalid_argument). Après chaque écriture : reload() puis emit().
   reload() est débordé à 200 ms ; rechargement aussi au retour d'onglet (visibilitychange).
   Erreurs d'écriture : { code, message } — "invalid_argument" pour RLS / permission (les modules affichent le
   message « droits »), "network" pour un transport en échec, sinon le code Postgres (ex. 23514) tel quel.

   Contrat : window.Store = { get(), on(fn), setScope(s), emit(), db, mode, reload(), propositions, memoire, savoir, expertises, journal, routines, surveillerConnexions(on), cours(isins, depuis), transactions(depuis), markOnboarded(), banque }
   db = { doc("config/main").update({ rules }), doc("profil/main").update({ risque }) } : seules écritures hors API dédiées (lecture seule).
   S = { ready, dbOk, positions, snapshots, tx, config, status, profil, profilLoaded, budget, objectifs, risque, classes, propositions, connexions, memoire, savoir, expertises, journal, journalARelire, journalConsentement, routines, routinesLues, banque, scope, people, user, error }
   positions[] : … + ter (% par an), zone, devise (exposition), annoteSource, annoteLe — annotations de l'instrument (null si inconnues),
   symbol (symbole Yahoo de l'instrument ou null) ; config.frais_enveloppes = frais des contrats (0026, {} par défaut) ;
   sourceAuto ("powens" | "binance" | null) et sourceAutoLe (horodatage | null) : ligne alimentée par une synchronisation (0021, 0023).
   Store.transactions(depuis) → Promise<[{ id, positionId, date, type, qty, price, amount, note, source, createdAt }]> : transactions depuis
   `depuis` (AAAA-MM-JJ ; absente : toutes), les plus récentes d'abord, par pages de 1 000, 3 pages au plus (S.tx n'en garde que les 60
   dernières) ; lues à la demande par la reconstitution du passé d'Aujourd'hui (historique.js) ; erreur → promesse rejetée.
   Store.cours(isins, depuis) → Promise<{ <isin>: [{ date, cloture }] }> : cours de clôture quotidiens de la table publique cours (CP1 § 4,
   migration 0023), du plus ancien au plus récent, à partir de `depuis` (AAAA-MM-JJ) ; lus à la demande (ouverture d'une fiche de
   Patrimoine › Comptes, période choisie d'abord), une requête par ISIN, au plus 6 en parallèle, par pages de 1 000 lignes des plus
   récentes aux plus anciennes, 3 pages au plus par ISIN : un ISIN qui atteint ce plafond est listé dans la propriété non énumérable
   `plafond` du résultat (historique tronqué côté ancien). ISIN sans cours : absent. Table absente (migration non appliquée) : {} sans
   erreur (avertissement en console) et plus aucune lecture jusqu'au rechargement de la page ; toute autre erreur : la promesse est
   rejetée (rien à mémoriser : la vue peut réessayer).
   risque = { reponses, profil, score, date } | null (questionnaire jamais rempli) — colonne profiles.risque.
   classes = { <poche>: <classe> } — surcharges poche → classe (profiles.classes).
   profil.protection = { prevoyance, emprunteur } (booléens) ou le même objet par personne — profiles.protection.
   Écriture : db.doc("profil/main").update({ risque }) n'écrit que cette colonne (le reste du profil est intact).
   budget = { lignes: [{ id, type: revenu|depense|epargne, categorie, libelle, montant, frequence: mois|an, owner? }] } | null
   objectifs = [{ id, nom, type: apport|matelas|retraite|projet, cible, dateCible, deja, source: saisi|poches, poches, enveloppes,
   rendement, priorite }] (colonne date_cible ↔ dateCible ; tri par priorité puis création).
   propositions = [{ id, lot, cible: profil|budget|position|bien|credit|objectif|risque|protection, operation: creer|modifier|supprimer,
   ref, avant, apres, source, justification, statut: en_attente|acceptee|refusee, creeLe, decideLe }] : les 200 dernières, les plus
   récentes d'abord (table propositions, déposées par le connecteur MCP). `apres` / `avant` suivent les noms des colonnes SQL
   (positions : name, envelope, owner, bloc, mode, isin, qty, pru, value, value_date, price_override, status, note, transaction? ;
   biens : nom, usage, valeur, part_p1, crd, mensualite, loyer ; credits : nom, owner, crd, mensualite ; objectifs : nom, type, cible,
   date_cible, deja, source, poches, enveloppes, rendement, priorite ; budget : une ligne ; profil : { foyer?, personnes?, autres? } ;
   risque : réponses { horizon, reaction, … } ; protection : { prevoyance, emprunteur }) — détail dans supabase/migrations/0007.
   Store.propositions.appliquer(ids, modifications = { <id>: apresModifie }) → { appliquees } (RPC appliquer_propositions, tout ou
   rien) ; Store.propositions.refuser(ids) → { refusees } (RPC refuser_propositions) ; rechargement puis émission ; erreur
   { code: "invalid_argument", message } en français si une cible est invalide.
   profil.biensRenseignes = true quand foyer.biensRenseignes l'est (« aucun bien ni crédit » est une réponse, bilan-etat.js).
   connexions = [{ clientId, clientNom, premierLe, dernierLe, appels }] : assistants qui ont appelé le connecteur MCP (table
   connexions_assistant, écrite par le connecteur au plus toutes les 5 minutes par client ; clientId "session" pour un jeton de
   session ordinaire), dans l'ordre de première connexion. Lue avec le reste par loadAll ; Store.surveillerConnexions(true)
   relit cette seule table toutes les 5 s (voyant « Claude est connecté » de l'onboarding) et n'émet que si elle a changé ;
   surveillerConnexions(false) arrête. Aucune surveillance tant qu'aucun module ne la demande.
   memoire = [{ id, categorie: contexte|preference|projet|decision|explique|a_suivre, contenu, echeance, epingle, source, creeLe, majLe }] :
   ce que l'agent retient de l'utilisateur (table privée memoire_agent, écrite par le connecteur MCP), les plus récents d'abord.
   Store.memoire.modifier(id, { contenu?, epingle?, echeance? }) / supprimer(ids) / toutEffacer() → { ok: true } ou { erreur } (message
   en français, celui de la base remonté tel quel, ex. « Mémoire pleine… ») ; rechargement puis émission.
   savoir = { fiches: [{ slug, theme, titre, resume, motsCles, sources: [{ titre, url, consulte_le }], version, misAJourLe }],
   reperes: [{ cle, libelle, valeur, unite, dateEffet, sourceTitre, sourceUrl, verifieLe, mode }] } : savoir commun (tables publiques
   savoir_fiches, reperes). Les fiches sont chargées sans leur contenu ; Store.savoir.fiche(slug) → la fiche avec `contenu` (markdown)
   ou null. Ces trois lectures rejoignent loadAll : une table absente (migration non appliquée) laisse la valeur précédente.
   expertises = [{ slug, nom, quandConsulter, perimetre, version, misAJourLe, marches, angles }] : expertises du Copilote patrimonial
   (table publique expertises, 0016 ; seules les lignes au statut « publie » sont lisibles), triées par nom, sans leur détail ; lues
   par loadAll (table absente ou lecture en échec → valeur précédente). Store.expertises.detail(slug) → { …, methode (markdown),
   controles (phrases), garde_fous (markdown), format (markdown), themesSavoir, reperes (clés), changelog: [{ version, le, resume }],
   versions: [{ version, le, resume }] } ou null (inconnue, non publiée ou lecture en échec) : détail lu à l'ouverture ; versions =
   historique public expertises_versions (copies publiées, la plus récente d'abord), à défaut le journal des versions (changelog).
   journal = [{ id, type: avis|decision|scenario|revue|hypothese|evenement, titre, synthese, raisonnement (markdown | null),
   options: [{ titre, retenue, pourquoi }], statut: a_relire|actif|realise|abandonne|archive, dateDecision, revueLe (AAAA-MM-JJ | null),
   liens: { objectifs?, positions?, biens?, credits? } (identifiants), etat (état figé par le connecteur), source, historique:
   [{ le, champ, avant, apres } | { le, champ: "raisonnement", ajout }] (tenu par le déclencheur journal_historique), creeLe, majLe }] :
   journal des décisions (table privée journal, 0013), les 500 plus récentes d'abord ; table absente → valeur précédente.
   journalARelire = nombre exact d'entrées « à relire » (requête count, head: true ; au-delà des 500 lues), pour les pastilles ;
     requête en échec → compte fait sur journal.
   journalConsentement = profiles.journal_consentement : "demander" (défaut) | "prevenir" | "jamais".
   Store.journal.confirmer(ids) (a_relire → actif) / modifier(id, { titre?, synthese?, statut? (actif|realise|abandonne|archive),
   revueLe? | revue_le?, dateDecision? | date_decision? }) (autres clés ignorées) / supprimer(ids) / consentement(mode) → { ok: true }
   ou { erreur } (message en français ; refus de la contrainte journal_contenu_sensible → « information sensible ») ; rechargement
   puis émission.
   routines = [{ type: revue_mensuelle, jour (1-28), active, consentementJournal, dernierPassage (horodatage | null), dernierClient,
   prochainPassage (AAAA-MM-JJ | null), questions: [{ question, pourquoi (| null), champ (| null) }], synthese (| null) }] : routines de
   l'agent (table privée routines, 0020 ; une ligne par type), triées par type ; lues avec le reste par loadAll ; table absente →
   valeur précédente ([] au départ). routinesLues = true dès qu'une lecture de la table a réussi (Aujourd'hui ne propose
   « Active ta revue mensuelle » qu'à cette condition). Store.routines.pause(type, enPause) → { ok: true } ou { erreur } : seule
   écriture, update routines set active = !enPause where type = … (le déclencheur routines_maj recalcule le prochain passage à la
   réactivation) ; rechargement puis émission.
   banque = { actif, lu, connexions: [{ id, etablissement, etat, message, derniereSynchro, doublonDe }], comptes: [{ id, connexionId, nom, type, solde,
   devise, soldeLe, actif, positionId, enveloppe, titulaire, creditId, ignore, doublonDe, rattacheAuto, creeAuto, suggestion }], mois: [{ mois,
   compteId, categorie, entrees, sorties, nombre }] } (compteId : banque_mois.compte_id, migration 0025 ; 0 ou colonne absente → null,
   totaux par utilisateur ; colonne absente : relecture sans elle) (doublonDe, rattacheAuto, creeAuto, suggestion : migration 0022, écrits par la synchronisation ;
   suggestion de forme inconnue → null) : banques
   connectées par Powens (BQ1, migration 0021, tables écrites par la fonction powens). L'interrupteur (fonctionnalites, cle « banque »)
   est lu avec le reste par loadAll ; éteint (ou table absente) : { actif: false } et rien d'autre n'est lu. Allumé : connexions, comptes
   et les 6 derniers mois de banque_mois (mois en cours compris), lus ensuite ; lu = true quand ces lectures ont réussi (en échec : valeurs
   précédentes). etat : null (à jour) ou l'état Powens (libellés : banque-etat.js). Les ids Powens restent tels que lus (nombres).
   SEC2 (migration 0028) : les tables banque_* exigent une session aal2 (double authentification). Interrupteur allumé mais session aal1
   (aucun facteur activé) : rien n'est lu, S.banque = { actif: true, lu: true, mfaRequise: true, connexions: [], comptes: [], mois: [] }
   (clé absente sinon), les vues montrent la carte « Active la double authentification » (BanqueEtat.carteMfa) et connecter / gerer
   répondent { erreur } sans appel réseau. Au démarrage, Mfa.exiger (mfa.js) pose l'écran de code plein écran tant qu'une session aal1
   a un facteur vérifié : rien n'est lu avant la validation.
   Store.banque.connecter(connectionId?) → { ok: true, url } | { erreur } : POST <supabaseUrl>/functions/v1/powens/connecter avec le JWT
   de la session (corps { connection_id } pour une reconnexion) ; l'URL renvoyée n'est acceptée qu'en https chez Powens
   (BanqueEtat.urlPowensOk) ; la vue redirige. Store.banque.gerer(connectionId) → { ok: true, url } | { erreur } : même appel avec
   { connection_id, mode: "gerer" } (page de gestion Powens de cette connexion : activer un autre compte de la même banque, sans
   seconde connexion), même vérification de l'URL. Store.banque.synchroniser(connectionId) → { ok: true, rapport } | { erreur } : POST
   /powens/synchroniser { connection_id } (relance Powens et synchronisation côté serveur), puis rechargement. Store.banque.deconnecter(connectionId) → { ok: true } | { erreur } : POST /powens/deconnecter
   puis rechargement. Store.banque.rattacher(compteId, { positionId } | { enveloppe, titulaire } | { creditId } | { aucun: true } |
   { ignorer: true }) → { ok: true } | { erreur } : update banque_comptes des 5 colonnes de rattachement (position_id, enveloppe,
   titulaire, credit_id, ignore ; seule écriture permise par 0021 ; ignorer → ignore = true et les 4 autres à null), validée d'abord
   par BanqueEtat.normRattachement (même règle que store-demo.js) ; rechargement puis émission.
   Store.banque.operations(compteIds, depuis) → Promise<[{ id, compteId, date, montant, libelle, categorie }]> : opérations des comptes
   demandés depuis `depuis` (table banque_operations, lisible par l'utilisateur), les plus récentes d'abord, 5 000 au plus ; lue à la
   demande (fiche d'un compte courant : plus bas solde, prélèvements récurrents) ; erreur → promesse rejetée. */
(function () {
  const isDemo = window.BOUSSOLE_MODE === "demo" || /[?&]demo(?:=|&|$)/.test(String((window.location && window.location.search) || ""));
  if (isDemo) return;
  const B = window.BOUSSOLE || {};

  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const num = v => (v == null || v === "" ? null : +v);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // État interne ; S (exposé) en est une copie reconstruite à chaque publish().
  const C = { ready: false, dbOk: null, positions: [], snapshots: [], tx: [], config: null, status: null, profil: null, profilLoaded: false, budget: null, objectifs: [], risque: null, classes: {}, propositions: [], connexions: [], memoire: [], savoir: { fiches: [], reperes: [] }, expertises: [], journal: [], journalARelire: 0, journalConsentement: "demander", routines: [], routinesLues: false, banque: { actif: false, lu: false, connexions: [], comptes: [], mois: [] }, onboardingDone: true, scope: "foyer", error: null, user: null };
  try { const s = localStorage.getItem("scope"); if (["foyer", "p1", "p2"].includes(s)) C.scope = s; } catch (e) {}

  // Deuxième personne : si le foyer compte au moins deux adultes (ou, taille inconnue, si elle est renseignée).
  const people = () => {
    const pr = C.profil || {}, ps = pr.personnes || {}, f = pr.foyer || {};
    const out = [{ id: "p1", nom: String((ps.p1 && ps.p1.nom) || "").trim() || "Moi" }];
    const two = f.adultes != null && f.adultes !== "" ? +f.adultes >= 2 : !!ps.p2;
    if (two) out.push({ id: "p2", nom: String((ps.p2 && ps.p2.nom) || "").trim() || "Conjoint(e)" });
    return out;
  };

  const subs = []; let tmr = null;
  const emit = () => { clearTimeout(tmr); tmr = setTimeout(() => subs.forEach(fn => { try { fn(S); } catch (e) { console.error(e); } }), 60); };
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
      profil: clone(C.profil),
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
      journal: clone(C.journal),
      journalARelire: C.journalARelire,
      journalConsentement: C.journalConsentement,
      routines: clone(C.routines),
      routinesLues: C.routinesLues,
      banque: clone(C.banque),
      onboardingDone: C.onboardingDone,
      scope: ppl.some(p => p.id === C.scope) ? C.scope : "foyer", // une seule personne : toujours le foyer
      people: ppl,
      user: clone(C.user),
      error: C.error,
    });
    emit();
  }

  /* ---------- erreurs ---------- */
  const PERM = new Set(["42501", "PGRST301", "PGRST302", "PGRST303", "401", "403"]);
  function asErr(e) {
    if (!e) return Object.assign(new Error("Erreur inconnue"), { code: "network" });
    if (e instanceof Error && ["invalid_argument", "network", "not_found"].includes(e.code)) return e;
    const code = e.code != null ? String(e.code) : e.status != null ? String(e.status) : "";
    const msg = e.message || String(e);
    const out = Object.assign(new Error(msg), { cause: e });
    if (PERM.has(code) || /row-level security|permission denied|jwt/i.test(msg)) out.code = "invalid_argument";
    else if (!code || /fetch|network/i.test(msg)) out.code = "network";
    else out.code = code;
    return out;
  }
  const q = async pr => { const { data, error } = await pr; if (error) throw asErr(error); return data; };
  /* Comptage exact sans lire les lignes (select(…, { count: "exact", head: true })). */
  const qCompte = async pr => { const { count, error } = await pr; if (error) throw asErr(error); return Number.isFinite(count) ? count : 0; };

  /* ---------- lecture : lignes SQL → vue canonique ---------- */
  let sb = null, session = null;
  // Prix : le cours de l'instrument (mis à jour la nuit), sauf si l'utilisateur a saisi un prix
  // (price_override) au moins aussi récent (value_date ≥ price_date de l'instrument).
  const posView = r => {
    const ins = r.instruments || null, insDate = (ins && ins.price_date) || null;
    const useOv = r.price_override != null && (!insDate || !r.value_date || r.value_date >= insDate);
    return {
      id: r.id, name: r.name, envelope: r.envelope, owner: r.owner, bloc: r.bloc, mode: r.mode, isin: r.isin || null,
      qty: num(r.qty), pru: num(r.pru),
      price: useOv ? +r.price_override : ins && ins.price != null ? +ins.price : null,
      priceDate: useOv ? r.value_date : insDate,
      value: num(r.value), valueDate: r.value_date || null,
      status: r.status, hypothesis: r.hypothesis || null, qtyEstimated: !!r.qty_estimated, note: r.note || null,
      // Annotations de l'instrument (outil annotate_instrument du connecteur) : frais courants, zone, devise d'exposition.
      ter: ins && ins.ter != null ? +ins.ter : null, zone: (ins && ins.zone) || null, devise: (ins && ins.devise) || null,
      annoteSource: (ins && ins.annote_source) || null, annoteLe: (ins && ins.annote_le) || null,
      // Symbole Yahoo de l'instrument (ticker d'action, code de fonds…) : aide à reconnaître une action en direct (frais des supports).
      symbol: (ins && ins.symbol) || null,
      // Synchronisation (Powens, Binance) : la ligne est alimentée automatiquement, à cette date.
      sourceAuto: r.source_auto || null, sourceAutoLe: r.source_auto_le || null,
    };
  };
  const txView = r => ({ id: r.id, positionId: r.position_id, date: r.date, type: r.type, qty: num(r.qty), price: num(r.price), amount: num(r.amount), note: r.note || "", source: r.source, createdAt: r.created_at });
  const snapView = r => ({ date: r.date, foyer: num(r.total), p1: num(r.p1), p2: num(r.p2), byBloc: r.by_bloc || {}, byEnvelope: r.by_envelope || {}, source: r.source });
  // frais_enveloppes (0026) : frais des contrats { "<enveloppe>": { gestion_uc_pct?, gestion_euro_pct?, garde_pct?, source, le } }, {} par défaut.
  const objetOu = v => (v != null && typeof v === "object" && !Array.isArray(v) ? v : {});
  const cfgView = r => ({ targets: r.targets || {}, rules: r.rules || [], cushion: r.cushion || null, recurring: r.recurring || [], todo: r.todo || [], milestones: r.milestones || [], hypotheses: r.hypotheses || [],
    frais_enveloppes: objetOu(r.frais_enveloppes) });
  const stView = r => ({ lastRun: r.last_run, summary: r.summary || "", alerts: r.alerts || [], missingPrices: r.missing_prices || 0 });
  const profView = (p, biens, credits) => ({
    foyer: p.foyer || {}, personnes: p.personnes || {}, autres: p.autres || {}, protection: p.protection || {},
    biens: biens.map(b => ({ id: b.id, nom: b.nom, usage: b.usage, valeur: num(b.valeur), part_p1: num(b.part_p1), crd: num(b.crd), mensualite: num(b.mensualite), loyer: num(b.loyer) })),
    credits: credits.map(c => ({ id: c.id, nom: c.nom, owner: c.owner, crd: num(c.crd), mensualite: num(c.mensualite) })),
    updatedAt: p.updated_at,
    ...(p.foyer && p.foyer.biensRenseignes ? { biensRenseignes: true } : {}),
  });
  const propView = r => ({
    id: r.id, lot: r.lot, cible: r.cible, operation: r.operation, ref: r.ref ?? null, avant: r.avant ?? null, apres: r.apres ?? null,
    source: r.source, justification: r.justification ?? null, statut: r.statut, creeLe: r.cree_le, decideLe: r.decide_le ?? null,
  });
  const connView = r => ({ clientId: r.client_id, clientNom: r.client_nom || null, premierLe: r.premier_le, dernierLe: r.dernier_le, appels: r.appels == null ? 0 : +r.appels });
  const CONN_SELECT = "client_id, client_nom, premier_le, dernier_le, appels";
  const memView = r => ({ id: r.id, categorie: r.categorie, contenu: r.contenu, echeance: r.echeance ?? null, epingle: !!r.epingle, source: r.source ?? null, creeLe: r.cree_le, majLe: r.maj_le });
  const ficheView = r => ({ slug: r.slug, theme: r.theme, titre: r.titre, resume: r.resume, motsCles: r.mots_cles || [], sources: r.sources || [], version: r.version == null ? 1 : +r.version, misAJourLe: r.mis_a_jour_le });
  // Repères : module pur reperes.js s'il est chargé, sinon la même correspondance.
  const repView = rows => (window.Reperes && window.Reperes.depuisLignes ? window.Reperes.depuisLignes(rows) : (rows || []).map(x => ({
    cle: x.cle, libelle: x.libelle, valeur: +x.valeur, unite: x.unite, dateEffet: x.date_effet, sourceTitre: x.source_titre, sourceUrl: x.source_url, verifieLe: x.verifie_le, mode: x.mode })));
  const tableau = v => (Array.isArray(v) ? v : []);
  const expView = r => ({ slug: r.slug, nom: r.nom, quandConsulter: r.quand_consulter, perimetre: r.perimetre, version: r.version == null ? 1 : +r.version,
    misAJourLe: r.mis_a_jour_le, marches: tableau(r.marches), angles: tableau(r.angles) });
  const versionView = v => ({ version: +v.version, le: v.le ?? v.mis_a_jour_le ?? null, resume: v.resume ?? null });
  const objOu = (v, d) => (v != null && typeof v === "object" && !Array.isArray(v) ? v : d);
  const journalView = r => ({
    id: r.id, type: r.type, titre: r.titre, synthese: r.synthese, raisonnement: r.raisonnement ?? null, options: Array.isArray(r.options) ? r.options : [],
    statut: r.statut, dateDecision: r.date_decision ?? null, revueLe: r.revue_le ?? null, liens: objOu(r.liens, {}), etat: objOu(r.etat, {}),
    source: r.source ?? null, historique: Array.isArray(r.historique) ? r.historique : [], creeLe: r.cree_le, majLe: r.maj_le,
  });
  const CONSENTEMENTS = ["demander", "prevenir", "jamais"];
  const ROUTINE_SELECT = "type, jour, active, consentement_journal, dernier_passage, dernier_client, prochain_passage, questions, synthese";
  const questionView = x => ({ question: String((x && x.question) || ""), pourquoi: (x && x.pourquoi) || null, champ: (x && x.champ) || null });
  const routineView = r => ({
    type: r.type, jour: r.jour == null ? 1 : +r.jour, active: !!r.active, consentementJournal: !!r.consentement_journal,
    dernierPassage: r.dernier_passage ?? null, dernierClient: r.dernier_client ?? null, prochainPassage: r.prochain_passage ?? null,
    questions: Array.isArray(r.questions) ? r.questions.filter(x => x && typeof x === "object").map(questionView) : [], synthese: r.synthese ?? null,
  });
  /* Banques connectées (BQ1) : colonnes lues et vues canoniques ; BanqueEtat (banque-etat.js) chargé avant ce fichier par build.mjs. */
  const BE = () => window.BanqueEtat;
  const BQ_CX = "id, etablissement, etat, message, derniere_synchro, doublon_de";
  const BQ_CPT = "id, connexion_id, nom, type, solde, devise, solde_le, actif, position_id, enveloppe, titulaire, credit_id, ignore, doublon_de, rattache_auto, cree_auto, suggestion";
  const BQ_MOIS = "mois, categorie, entrees, sorties, nombre";
  const bqCxView = r => ({ id: r.id, etablissement: r.etablissement || "", etat: r.etat ?? null, message: r.message ?? null, derniereSynchro: r.derniere_synchro ?? null,
    doublonDe: r.doublon_de ?? null });
  const bqCptView = r => ({ id: r.id, connexionId: r.connexion_id, nom: r.nom || "", type: r.type || "autre", solde: num(r.solde), devise: r.devise || "EUR",
    soldeLe: r.solde_le ?? null, actif: r.actif !== false, positionId: r.position_id ?? null, enveloppe: r.enveloppe ?? null, titulaire: r.titulaire ?? null, creditId: r.credit_id ?? null, ignore: r.ignore === true,
    doublonDe: r.doublon_de ?? null, rattacheAuto: r.rattache_auto ?? null, creeAuto: r.cree_auto === true, suggestion: BE().suggestionOk(r.suggestion) ? r.suggestion : null });
  const bqMoisView = r => ({ mois: String(r.mois).slice(0, 10), compteId: r.compte_id == null || +r.compte_id === 0 ? null : r.compte_id, categorie: r.categorie, entrees: num(r.entrees) || 0, sorties: num(r.sorties) || 0, nombre: r.nombre == null ? 0 : +r.nombre });
  const BANQUE_ETEINTE = () => ({ actif: false, lu: true, connexions: [], comptes: [], mois: [] });
  /* Interrupteur actif mais session sans double authentification (aal1) : aucune donnée bancaire n'est lisible (RLS, migration 0028). */
  const BANQUE_MFA = () => ({ actif: true, lu: true, mfaRequise: true, connexions: [], comptes: [], mois: [] });
  /* La session a-t-elle franchi la double authentification ? Auth.mfa (auth.js) absent (démo, tests anciens) → oui ; niveau illisible → non. */
  async function sessionAal2() {
    const A = window.Auth;
    if (!A || !A.mfa || typeof A.mfa.niveau !== "function") return true;
    try { const n = await A.mfa.niveau(); return !!n && n.current === "aal2"; } catch (e) { return false; }
  }
  /* 1er du mois, 5 mois avant le mois en cours : 6 mois de totaux (le mois en cours compris). */
  const debutSixMois = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() - 5, 1)).toISOString().slice(0, 10); };
  /* banque_mois avec compte_id (0025) ; colonne absente (42703, migration pas encore appliquée) : relecture sans elle. */
  async function lireMoisBanque() {
    const lire = cols => q(sb.from("banque_mois").select(cols).gte("mois", debutSixMois()).order("mois"));
    try { return await lire(BQ_MOIS + ", compte_id"); } catch (e) { if (e && e.code === "42703") return lire(BQ_MOIS); throw e; }
  }
  async function lireBanque() {
    const res = await Promise.allSettled([
      q(sb.from("banque_connexions").select(BQ_CX).order("etablissement")),
      q(sb.from("banque_comptes").select(BQ_CPT).order("nom")),
      lireMoisBanque(),
    ]);
    if (res.some(r => r.status === "rejected")) {
      console.warn("Boussole : lecture des banques partielle", res.filter(r => r.status === "rejected").map(r => r.reason));
      C.banque = Object.assign({}, C.banque, { actif: true });
      return;
    }
    const [cx, cpt, mois] = res.map(r => r.value || []);
    C.banque = { actif: true, lu: true, connexions: cx.map(bqCxView), comptes: cpt.map(bqCptView), mois: mois.map(bqMoisView) };
  }
  const budgetView = r => ({ lignes: Array.isArray(r.lignes) ? r.lignes.map(l => Object.assign({}, l, { montant: num(l.montant) })) : [] });
  const objView = r => ({
    id: r.id, nom: r.nom || "", type: r.type, cible: num(r.cible), dateCible: r.date_cible || null, deja: num(r.deja),
    source: r.source, poches: r.poches || [], enveloppes: r.enveloppes || [], rendement: num(r.rendement), priorite: r.priorite == null ? 0 : +r.priorite,
  });

  async function loadAll() {
    if (!sb || !session) return;
    const res = await Promise.allSettled([
      q(sb.from("profiles").select("*").maybeSingle()),
      q(sb.from("biens").select("*").order("created_at")),
      q(sb.from("credits").select("*").order("created_at")),
      q(sb.from("positions").select("*, instruments(price, price_date, name, symbol, currency, ter, zone, devise, annote_source, annote_le)").order("created_at")),
      q(sb.from("transactions").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(60)),
      q(sb.from("snapshots").select("*").order("date")),
      q(sb.from("config").select("*").maybeSingle()),
      q(sb.from("status").select("*").maybeSingle()),
      q(sb.from("budgets").select("*").maybeSingle()),
      q(sb.from("objectifs").select("*").order("priorite").order("created_at")),
      q(sb.from("propositions").select("*").order("cree_le", { ascending: false }).limit(200)),
      q(sb.from("connexions_assistant").select(CONN_SELECT).order("premier_le")),
      q(sb.from("memoire_agent").select("id, categorie, contenu, echeance, epingle, source, cree_le, maj_le").order("cree_le", { ascending: false })),
      q(sb.from("savoir_fiches").select("slug, theme, titre, resume, mots_cles, sources, version, mis_a_jour_le").order("mis_a_jour_le", { ascending: false }).order("titre")),
      q(sb.from("reperes").select("cle, libelle, valeur, unite, date_effet, source_titre, source_url, verifie_le, mode").order("cle")),
      q(sb.from("expertises").select("slug, nom, quand_consulter, perimetre, version, mis_a_jour_le, marches, angles").eq("statut", "publie").order("nom")),
      q(sb.from("journal").select("id, type, titre, synthese, raisonnement, options, statut, date_decision, revue_le, liens, etat, source, historique, cree_le, maj_le").order("cree_le", { ascending: false }).limit(500)),
      qCompte(sb.from("journal").select("id", { count: "exact", head: true }).eq("statut", "a_relire")),
      q(sb.from("routines").select(ROUTINE_SELECT).order("type")),
      q(sb.from("fonctionnalites").select("cle, active").eq("cle", "banque").maybeSingle()),
    ]);
    const [prof, biens, credits, positions, tx, snaps, config, status, budget, objectifs, propositions, connexions, memoire, fiches, reperes, expertises, journal, nARelire, routines, banque] = res.map(r => (r.status === "fulfilled" ? r.value : undefined));
    const failed = res.filter((r, i) => r.status === "rejected" && i !== res.length - 1); // interrupteur banque (0021) absent : pas une erreur de lecture
    C.error = failed.length ? (failed[0].reason && failed[0].reason.code) || "erreur" : null;
    if (failed.length) console.warn("Boussole : lecture partielle", failed.map(f => f.reason));
    if (positions !== undefined) C.positions = (positions || []).map(posView);
    if (snaps !== undefined) C.snapshots = (snaps || []).map(snapView);
    if (tx !== undefined) C.tx = (tx || []).map(txView);
    if (config !== undefined) C.config = config ? cfgView(config) : null;
    if (status !== undefined) C.status = status ? stView(status) : null;
    if (budget !== undefined) C.budget = budget ? budgetView(budget) : null;
    if (objectifs !== undefined) C.objectifs = (objectifs || []).map(objView);
    if (propositions !== undefined) C.propositions = (propositions || []).map(propView);
    if (connexions !== undefined) C.connexions = (connexions || []).map(connView);
    if (memoire !== undefined) C.memoire = (memoire || []).map(memView);
    if (fiches !== undefined) C.savoir = Object.assign({}, C.savoir, { fiches: (fiches || []).map(ficheView) });
    if (reperes !== undefined) C.savoir = Object.assign({}, C.savoir, { reperes: repView(reperes || []) });
    if (expertises !== undefined) C.expertises = (expertises || []).map(expView);
    if (journal !== undefined) C.journal = (journal || []).map(journalView);
    // Pastille « à relire » : compte exact ; à défaut, compte fait sur les entrées lues.
    C.journalARelire = nARelire !== undefined ? nARelire : C.journal.filter(e => e && e.statut === "a_relire").length;
    // Routines (0020) : table absente → valeur précédente, comme le journal ; routinesLues reste vrai après une première lecture.
    if (routines !== undefined) { C.routines = (routines || []).map(routineView); C.routinesLues = true; }
    // Banques (0021) : interrupteur éteint → { actif: false }, rien d'autre n'est lu ; lecture en échec ou table absente → valeur précédente.
    // SEC2 (0028) : les tables banque_* exigent une session aal2 (RLS) ; sans elle, rien n'est lu et S.banque.mfaRequise est vrai (carte
    // « Active la double authentification » dans les vues, connexion d'une banque refusée).
    if (banque !== undefined) {
      if (!banque || !banque.active) C.banque = BANQUE_ETEINTE();
      else if (!(await sessionAal2())) C.banque = BANQUE_MFA();
      else await lireBanque();
    }
    // Colonne absente (migration 0013 non appliquée) ou valeur inconnue : « demander », comme le connecteur.
    if (prof !== undefined) C.journalConsentement = prof && CONSENTEMENTS.includes(prof.journal_consentement) ? prof.journal_consentement : "demander";
    if (prof !== undefined) C.onboardingDone = !!(prof && prof.onboarding_done);
    if (prof !== undefined) { C.risque = (prof && prof.risque) || null; C.classes = (prof && prof.classes) || {}; }
    if (prof !== undefined && biens !== undefined && credits !== undefined) C.profil = prof ? profView(prof, biens || [], credits || []) : null;
    C.profilLoaded = true;
    C.user = { id: session.user.id, email: session.user.email || null };
    C.ready = true;
  }

  let reloadTimer = null, reloadWaiters = [];
  function reload() {
    return new Promise(resolve => {
      reloadWaiters.push(resolve);
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        const waiters = reloadWaiters; reloadWaiters = [];
        try { await loadAll(); } catch (e) { C.error = asErr(e).code; }
        publish();
        waiters.forEach(r => r());
      }, 200);
    });
  }

  /* ---------- écritures de contrôle ---------- */
  const guard = () => { if (!sb || !session) throw Object.assign(new Error("Base indisponible : aucune session."), { code: C.dbOk === false ? "network" : "invalid_argument" }); };
  async function write(fn) {
    guard();
    let out;
    try { out = await fn(session.user.id); } catch (e) { throw asErr(e); }
    await reload();
    return out;
  }
  // Validation commune aux deux stores (même texte dans store-demo.js) : une valeur invalide est refusée
  // (code invalid_argument, message en français), jamais corrigée en silence.
  const bad = m => Object.assign(new Error(m), { code: "invalid_argument" });
  const objet = v => v != null && typeof v === "object" && !Array.isArray(v);
  /* Seules les écritures de contrôle passent ; le reste se complète avec l'assistant (propositions). */
  const LECTURE_SEULE = "Écriture non disponible dans l'app : complète ou corrige avec Claude, puis valide sa proposition.";
  function seulement(patch, cles) {
    if (!objet(patch)) throw bad("Modification invalide : objet attendu.");
    const autres = Object.keys(patch).filter(k => !cles.includes(k));
    if (autres.length || !Object.keys(patch).length) throw bad(LECTURE_SEULE);
  }
  /* Règles d'alerte : seule la liste (bascule actif / inactif faite par regles.js) est écrite. Même validation dans store-demo.js. */
  function normRegles(rules) {
    if (!Array.isArray(rules) || rules.some(r => !objet(r) || typeof r.type !== "string")) throw bad("Règles invalides : liste de règles { type, … } attendue.");
    return rules;
  }
  async function updateRegles(patch, uid) {
    seulement(patch, ["rules"]);
    await q(sb.from("config").upsert({ user_id: uid, rules: normRegles(patch.rules) }, { onConflict: "user_id" }));
  }
  /* Profil de risque recalculé (propositions.js, après application de réponses) : colonne profiles.risque seule. */
  function normRisque(patch) {
    seulement(patch, ["risque"]);
    if (patch.risque !== null && !objet(patch.risque)) throw bad("Profil de risque invalide : objet { reponses, profil, score, date } ou null attendu.");
    return patch.risque;
  }
  async function updateRisque(patch, uid) {
    await q(sb.from("profiles").upsert({ user_id: uid, risque: normRisque(patch) }, { onConflict: "user_id" }));
  }

  const db = {
    doc(path) {
      const [col] = String(path).split("/");
      return {
        update(patch) {
          if (col === "config") return write(uid => updateRegles(patch, uid));
          if (col === "profil") return write(uid => updateRisque(patch, uid));
          return Promise.reject(bad(LECTURE_SEULE));
        },
      };
    },
  };

  /* ---------- propositions de Claude : décision par les RPC security invoker (RLS) ---------- */
  const idsValides = ids => [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(id => UUID.test(id)))];
  const decision = e => { const x = asErr(e); if (x.code === "22023" || x.code === "P0001") x.code = "invalid_argument"; return x; };
  const propositions = {
    async appliquer(ids, modifications = {}) {
      const p_ids = idsValides(ids);
      const mods = modifications == null ? {} : modifications;
      if (typeof mods !== "object" || Array.isArray(mods)) throw bad("Modifications invalides : objet { identifiant: valeur } attendu.");
      if (!p_ids.length) return { appliquees: 0 };
      try { return await write(async () => ({ appliquees: +(await q(sb.rpc("appliquer_propositions", { p_ids, p_modifications: mods }))) || 0 })); }
      catch (e) { throw decision(e); }
    },
    async refuser(ids) {
      const p_ids = idsValides(ids);
      if (!p_ids.length) return { refusees: 0 };
      try { return await write(async () => ({ refusees: +(await q(sb.rpc("refuser_propositions", { p_ids }))) || 0 })); }
      catch (e) { throw decision(e); }
    },
  };

  /* ---------- mémoire de l'agent (table privée, RLS) et savoir commun ---------- */
  // Même validation que store-demo.js (et que la base : 1 à 500 caractères, pas de contenu sensible, échéance pour « à suivre »).
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
  // Seule la contrainte contenu_sensible (code 23514, nommée dans le message) est traduite ; toute autre erreur garde son message.
  const echec = e => { const x = asErr(e); return { erreur: x.code === "23514" && /contenu_sensible/.test(String(x.message || "")) ? MSG_SENSIBLE : x.message || String(e) }; };
  const memoire = {
    async modifier(id, patch) {
      try {
        const m = C.memoire.find(x => x.id === id);
        if (!m) throw bad("Souvenir introuvable.");
        const row = normSouvenir(patch, m);
        if (!Object.keys(row).length) return { ok: true };
        const rows = await write(async () => q(sb.from("memoire_agent").update(row).eq("id", id).select("id")));
        if (!Array.isArray(rows) || !rows.length) return { erreur: "Souvenir introuvable." }; // effacé entre-temps (aucune ligne visible)
        return { ok: true };
      } catch (e) { return echec(e); }
    },
    async supprimer(ids) {
      const liste = idsValides(ids);
      if (!liste.length) return { ok: true };
      try { await write(async () => q(sb.from("memoire_agent").delete().in("id", liste))); return { ok: true }; }
      catch (e) { return echec(e); }
    },
    async toutEffacer() {
      try { await write(async uid => q(sb.from("memoire_agent").delete().eq("user_id", uid))); return { ok: true }; }
      catch (e) { return echec(e); }
    },
  };
  /* ---------- journal des décisions (table privée journal, RLS ; historique tenu par le déclencheur journal_historique) ---------- */
  // Même validation que store-demo.js et que la base : titre 3-120, synthèse 1-600, statut hors a_relire, dates AAAA-MM-JJ, pas de contenu sensible.
  const J_STATUTS = ["actif", "realise", "abandonne", "archive"];
  const MSG_SENSIBLE_J = "Cette entrée contient une information sensible (numéro de compte ou de carte, identifiant, mot de passe) : elle n'est pas enregistrée.";
  function normEntree(patch) {
    const p = patch || {}, out = {}, has = k => Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined;
    const texte = (k, min, max, quoi) => {
      const t = String(p[k] == null ? "" : p[k]).trim();
      if (t.length < min || t.length > max) throw bad(quoi + " compte de " + min + " à " + max + " caractères.");
      if (estSensible(t)) throw bad(MSG_SENSIBLE_J);
      out[k] = t;
    };
    const date = (k, col, quoi) => {
      const cle = has(k) ? k : has(col) ? col : null; if (!cle) return;
      const v = p[cle] == null || p[cle] === "" ? null : String(p[cle]);
      if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v)) || new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v)) throw bad(quoi + " « " + v + " » invalide (format AAAA-MM-JJ).");
      out[col] = v;
    };
    if (has("titre")) texte("titre", 3, 120, "Un titre");
    if (has("synthese")) texte("synthese", 1, 600, "Une synthèse");
    if (has("statut")) { if (!J_STATUTS.includes(p.statut)) throw bad("Statut « " + p.statut + " » inconnu (actif, realise, abandonne ou archive)."); out.statut = p.statut; }
    date("revueLe", "revue_le", "Date de revue");
    date("dateDecision", "date_decision", "Date de décision");
    return out;
  }
  // Seule la contrainte journal_contenu_sensible (23514, nommée dans le message) devient « information sensible » ; le reste garde son message.
  const echecJ = e => { const x = asErr(e); return { erreur: x.code === "23514" && /journal_contenu_sensible/.test(String(x.message || "")) ? MSG_SENSIBLE_J : x.message || String(e) }; };
  const journal = {
    async confirmer(ids) {
      const liste = idsValides(ids);
      if (!liste.length) return { ok: true };
      try { await write(async () => q(sb.from("journal").update({ statut: "actif" }).in("id", liste).eq("statut", "a_relire"))); return { ok: true }; }
      catch (e) { return echecJ(e); }
    },
    async modifier(id, patch) {
      try {
        if (!C.journal.some(x => x.id === id)) throw bad("Entrée du journal introuvable.");
        const row = normEntree(patch);
        if (!Object.keys(row).length) return { ok: true };
        const rows = await write(async () => q(sb.from("journal").update(row).eq("id", id).select("id")));
        if (!Array.isArray(rows) || !rows.length) return { erreur: "Entrée du journal introuvable." }; // supprimée entre-temps
        return { ok: true };
      } catch (e) { return echecJ(e); }
    },
    async supprimer(ids) {
      const liste = idsValides(ids);
      if (!liste.length) return { ok: true };
      try { await write(async () => q(sb.from("journal").delete().in("id", liste))); return { ok: true }; }
      catch (e) { return echecJ(e); }
    },
    /* Ce que l'agent peut enregistrer : même écriture que les colonnes du Diagnostic (upsert sur user_id, RLS de profiles). */
    async consentement(mode) {
      if (!CONSENTEMENTS.includes(mode)) return { erreur: "Choix « " + mode + " » inconnu (demander, prevenir ou jamais)." };
      try { await write(async uid => q(sb.from("profiles").upsert({ user_id: uid, journal_consentement: mode }, { onConflict: "user_id" }))); return { ok: true }; }
      catch (e) { return echecJ(e); }
    },
  };

  /* ---------- routines de l'agent (table privée routines, RLS) : seule la bascule active / en pause s'écrit ici ---------- */
  const ROUTINE_TYPES = ["revue_mensuelle"];
  const routines = {
    async pause(type, enPause) {
      if (!ROUTINE_TYPES.includes(type)) return { erreur: "Routine « " + type + " » inconnue (revue_mensuelle)." };
      if (typeof enPause !== "boolean") return { erreur: "Pause invalide : vrai (en pause) ou faux (active) attendu." };
      try {
        const rows = await write(async () => q(sb.from("routines").update({ active: !enPause }).eq("type", type).select("type")));
        if (!Array.isArray(rows) || !rows.length) return { erreur: "Routine introuvable : demande à Claude de l'activer." };
        return { ok: true };
      } catch (e) { const x = asErr(e); return { erreur: x.message || String(e) }; }
    },
  };

  /* ---------- banques connectées (BQ1) : fonction powens (connexion, déconnexion) et rattachement des comptes ---------- */
  const POWENS_URL = B.powensUrl || String(B.supabaseUrl || "").replace(/\/+$/, "") + "/functions/v1/powens";
  const idPowens = v => (v != null && /^\d{1,15}$/.test(String(v)) ? Number(v) : null);
  /* POST <POWENS_URL>/<route> avec le JWT de la session (rafraîchi par Auth.session()) → { ok: true, data } | { erreur }. */
  async function appelPowens(route, corps) {
    if (!sb || !session) return { erreur: "Base indisponible : reconnecte-toi." };
    let s = session;
    try { const A = window.Auth, f = A && typeof A.session === "function" ? await A.session() : null; if (f && f.access_token) s = f; } catch (e) { /* session courante */ }
    let r;
    try {
      r = await fetch(POWENS_URL + "/" + route, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.access_token }, body: JSON.stringify(corps || {}) });
    } catch (e) { return { erreur: BE().MSG_RESEAU }; }
    let d = null;
    try { d = await r.json(); } catch (e) { d = null; }
    if (!r.ok) return { erreur: BE().messageErreur(r.status, d) };
    return { ok: true, data: d && typeof d === "object" ? d : {} };
  }
  /* POST /powens/connecter → { ok: true, url } seulement pour une adresse https chez Powens (BanqueEtat.urlPowensOk). */
  async function pagePowens(corps) {
    const r = await appelPowens("connecter", corps);
    if (r.erreur) return r;
    if (!BE().urlPowensOk(r.data.url)) return { erreur: "Adresse de connexion inattendue : rien n'a été ouvert. Réessaie dans un instant." };
    return { ok: true, url: r.data.url };
  }
  const MSG_MFA_BANQUE = "Active la double authentification (Mon compte › Sécurité) et valide ton code pour connecter ta banque.";
  const banqueApi = {
    async connecter(connectionId) {
      if (C.banque.mfaRequise) return { erreur: MSG_MFA_BANQUE };
      const corps = {};
      if (connectionId != null) {
        const id = idPowens(connectionId);
        if (id == null || !C.banque.connexions.some(c => String(c.id) === String(id))) return { erreur: "Connexion introuvable." };
        corps.connection_id = id;
      }
      return pagePowens(corps);
    },
    /* Gérer les comptes d'une connexion existante (webview Manage) : jamais une seconde connexion à la même banque. */
    async gerer(connectionId) {
      if (C.banque.mfaRequise) return { erreur: MSG_MFA_BANQUE };
      const id = idPowens(connectionId);
      if (id == null || !C.banque.connexions.some(c => String(c.id) === String(id))) return { erreur: "Connexion introuvable." };
      return pagePowens({ connection_id: id, mode: "gerer" });
    },
    /* « Synchroniser maintenant » : relance chez Powens et synchronisation côté serveur, puis rechargement → { ok: true, rapport }. */
    async synchroniser(connectionId) {
      const id = idPowens(connectionId);
      if (id == null || !C.banque.connexions.some(c => String(c.id) === String(id))) return { erreur: "Connexion introuvable." };
      const r = await appelPowens("synchroniser", { connection_id: id });
      if (r.erreur) return r;
      await reload();
      return { ok: true, rapport: r.data.rapport && typeof r.data.rapport === "object" ? r.data.rapport : {} };
    },
    async deconnecter(connectionId) {
      const id = idPowens(connectionId);
      if (id == null || !C.banque.connexions.some(c => String(c.id) === String(id))) return { erreur: "Connexion introuvable." };
      const r = await appelPowens("deconnecter", { connection_id: id });
      if (r.erreur) return r;
      await reload();
      return { ok: true };
    },
    async operations(compteIds, depuis) {
      const ids = [...new Set((Array.isArray(compteIds) ? compteIds : []).map(idPowens).filter(v => v != null))];
      const d0 = String(depuis == null ? "" : depuis).slice(0, 10);
      if (!ids.length || !sb) return [];
      let rq = sb.from("banque_operations").select("id, compte_id, date, montant, libelle, categorie").in("compte_id", ids);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d0)) rq = rq.gte("date", d0);
      const rows = await q(rq.order("date", { ascending: false }).range(0, 4999));
      return (Array.isArray(rows) ? rows : []).map(r => ({ id: r.id, compteId: r.compte_id, date: String(r.date).slice(0, 10), montant: num(r.montant) || 0,
        libelle: r.libelle || "", categorie: r.categorie ?? null }));
    },
    async rattacher(compteId, cible) {
      try {
        const cpt = C.banque.comptes.find(c => String(c.id) === String(compteId));
        if (!cpt) throw bad("Compte introuvable.");
        const row = BE().normRattachement(cible, { compte: cpt, positions: C.positions, credits: (C.profil && C.profil.credits) || [] });
        const rows = await write(async () => q(sb.from("banque_comptes").update(row).eq("id", cpt.id).select("id")));
        if (!Array.isArray(rows) || !rows.length) return { erreur: "Compte introuvable." };
        return { ok: true };
      } catch (e) { const x = asErr(e); return { erreur: x.message || "Rattachement impossible pour le moment. Réessaie." }; }
    },
  };

  const savoir = {
    /* Fiche complète (avec son contenu markdown), lue à l'ouverture ; null si elle n'existe pas ou si la lecture échoue. */
    async fiche(slug) {
      if (!sb) return null;
      try {
        const r = await q(sb.from("savoir_fiches").select("slug, theme, titre, resume, contenu, mots_cles, sources, version, mis_a_jour_le").eq("slug", slug).maybeSingle());
        return r ? Object.assign(ficheView(r), { contenu: r.contenu }) : null;
      } catch (e) { console.warn("Boussole : lecture de la fiche impossible", e); return null; }
    },
  };

  const expertises = {
    /* Détail d'une expertise publiée, lu à l'ouverture ; historique des versions lu en parallèle (en échec : journal des versions).
       null si elle n'existe pas, n'est pas publiée ou si la lecture échoue. */
    async detail(slug) {
      if (!sb) return null;
      try {
        const [r, h] = await Promise.allSettled([
          q(sb.from("expertises").select("slug, nom, quand_consulter, perimetre, methode, controles, garde_fous, format, themes_savoir, reperes, angles, marches, version, changelog, mis_a_jour_le").eq("slug", slug).eq("statut", "publie").maybeSingle()),
          q(sb.from("expertises_versions").select("version, resume, mis_a_jour_le").eq("slug", slug).eq("statut", "publie").order("version", { ascending: false })),
        ]);
        if (r.status !== "fulfilled") throw r.reason;
        const e = r.value;
        if (!e) return null;
        const changelog = tableau(e.changelog).filter(v => v && typeof v === "object").map(versionView);
        const versions = h.status === "fulfilled" && tableau(h.value).length ? tableau(h.value).map(versionView)
          : changelog.slice().sort((a, b) => b.version - a.version);
        return Object.assign(expView(e), { methode: e.methode ?? null, controles: tableau(e.controles).filter(c => typeof c === "string"),
          garde_fous: e.garde_fous ?? null, format: e.format ?? null, themesSavoir: tableau(e.themes_savoir), reperes: tableau(e.reperes), changelog, versions });
      } catch (x) { console.warn("Boussole : lecture de l'expertise impossible", x); return null; }
    },
  };

  /* ---------- connexions de l'assistant : surveillance à la demande (onboarding) ---------- */
  const CONN_INTERVALLE = 5000;
  let connTimer = null, connEnCours = false;
  async function lireConnexions() {
    if (connEnCours || !sb || !session) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return; // onglet caché : pas de requête
    connEnCours = true;
    try {
      const rows = await q(sb.from("connexions_assistant").select(CONN_SELECT).order("premier_le"));
      const next = (rows || []).map(connView);
      if (JSON.stringify(next) !== JSON.stringify(C.connexions)) { C.connexions = next; publish(); }
    } catch (e) {
      console.warn("Boussole : lecture des connexions impossible", e);
    } finally { connEnCours = false; }
  }
  function surveillerConnexions(on) {
    if (on) {
      if (connTimer) return;
      connTimer = setInterval(lireConnexions, CONN_INTERVALLE);
      lireConnexions();
    } else if (connTimer) {
      clearInterval(connTimer); connTimer = null;
    }
  }

  /* ---------- cours historiques (CP1 § 4 : table publique cours, migration 0023) ---------- */
  const COURS_PAGE = 1000, COURS_PAGES_MAX = 3, COURS_PARALLELE = 6;
  let coursAbsents = false; // table pas encore créée : plus de requête jusqu'au rechargement
  /* Cours d'un ISIN depuis d0, des plus récents aux plus anciens, COURS_PAGES_MAX pages au plus → { serie (triée), plafond }. */
  async function coursIsin(isin, d0) {
    const serie = [];
    for (let page = 0; page < COURS_PAGES_MAX; page++) {
      let rq = sb.from("cours").select("isin, date, cloture").eq("isin", isin);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d0)) rq = rq.gte("date", d0);
      const rows = await q(rq.order("date", { ascending: false }).range(page * COURS_PAGE, (page + 1) * COURS_PAGE - 1));
      (Array.isArray(rows) ? rows : []).forEach(r => {
        const c = num(r && r.cloture);
        if (!r || !r.date || !(c > 0)) return;
        serie.push({ date: String(r.date).slice(0, 10), cloture: c });
      });
      if (!Array.isArray(rows) || rows.length < COURS_PAGE) return { serie: serie.reverse(), plafond: false };
    }
    return { serie: serie.reverse(), plafond: true };
  }
  async function cours(isins, depuis) {
    const ids = [...new Set((Array.isArray(isins) ? isins : []).map(x => String(x == null ? "" : x).trim()).filter(Boolean))];
    const d0 = String(depuis == null ? "" : depuis).slice(0, 10), out = {}, plafond = [];
    if (!ids.length || !sb || coursAbsents) return out;
    let i = 0, echec = null;
    const ouvrier = async () => {
      while (i < ids.length && !echec) {
        const isin = ids[i++];
        try {
          const r = await coursIsin(isin, d0);
          if (r.serie.length) out[isin] = r.serie.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
          if (r.plafond) plafond.push(isin);
        } catch (e) { echec = echec || e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(COURS_PARALLELE, ids.length) }, ouvrier));
    if (echec) {
      console.warn("Boussole : lecture des cours historiques impossible", echec && echec.code);
      if (["42P01", "PGRST205", "PGRST200"].includes(echec.code)) { coursAbsents = true; return {}; }
      throw echec;
    }
    Object.defineProperty(out, "plafond", { value: plafond, enumerable: false });
    return out;
  }

  /* Transactions depuis d0, des plus récentes aux plus anciennes, COURS_PAGES_MAX pages de 1 000 au plus. */
  async function transactions(depuis) {
    const d0 = String(depuis == null ? "" : depuis).slice(0, 10), out = [];
    if (!sb) return out;
    for (let page = 0; page < COURS_PAGES_MAX; page++) {
      let rq = sb.from("transactions").select("*");
      if (/^\d{4}-\d{2}-\d{2}$/.test(d0)) rq = rq.gte("date", d0);
      const rows = await q(rq.order("date", { ascending: false }).order("created_at", { ascending: false }).range(page * COURS_PAGE, (page + 1) * COURS_PAGE - 1));
      (Array.isArray(rows) ? rows : []).forEach(r => out.push(txView(r)));
      if (!Array.isArray(rows) || rows.length < COURS_PAGE) break;
    }
    return out;
  }

  const Store = {
    mode: "supabase",
    db,
    propositions,
    memoire,
    savoir,
    expertises,
    journal,
    routines,
    get: () => S,
    on(fn) { subs.push(fn); },
    setScope(c) {
      if (!["foyer", "p1", "p2"].includes(c)) return;
      C.scope = c;
      try { localStorage.setItem("scope", c); } catch (e) {}
      publish();
    },
    emit,
    reload,
    markOnboarded() { return write(uid => q(sb.from("profiles").update({ onboarding_done: true }).eq("user_id", uid))); },
    surveillerConnexions,
    cours,
    transactions,
    banque: banqueApi,
  };
  window.Store = Store;
  publish();

  /* ---------- démarrage ---------- */
  async function boot() {
    const A = window.Auth;
    if (!(window.supabase && window.supabase.createClient) || !B.supabaseUrl || !B.supabaseKey) {
      C.dbOk = false; C.error = window.supabase ? "config" : "cdn"; C.ready = true; publish(); return;
    }
    sb = (A && A.client) || window.supabase.createClient(B.supabaseUrl, B.supabaseKey);
    try { session = A ? await A.session() : (await sb.auth.getSession()).data.session || null; } catch (e) { session = null; }
    if (!session) {
      C.dbOk = false; C.ready = true; publish();
      if (A && A.requireSession) A.requireSession({ demoOk: true });
      return;
    }
    // SEC2 : session aal1 avec un second facteur activé → écran de code (mfa.js) avant toute lecture ; reprise de session comprise.
    // Échec fermé : niveau illisible → la garde reste affichée (message + « Réessayer ») ; sans document pour l'afficher (false), rien n'est lu.
    if (A && A.mfa && window.Mfa && typeof window.Mfa.exiger === "function") {
      const passe = await window.Mfa.exiger(A.mfa, { onQuitter: async () => { try { await A.signOut(); } catch (e) { try { await sb.auth.signOut({ scope: "local" }); } catch (x) { /* rien */ } } if (A.urls) location.replace(A.urls.connexion()); } });
      if (passe === false) { C.dbOk = false; C.error = "mfa"; C.ready = true; publish(); return; }
      // Appareil de double authentification ajouté depuis la dernière visite de ce navigateur : bandeau d'alerte (information, jamais bloquant).
      if (typeof window.Mfa.signalerNouvelAppareil === "function") window.Mfa.signalerNouvelAppareil(A.mfa, {}).catch(() => {});
    }
    C.dbOk = true;
    try { await loadAll(); } catch (e) { C.error = asErr(e).code; C.ready = true; }
    publish();
    if (A && A.onChange) A.onChange((event, s) => {
      session = s || null;
      if (!s) { C.dbOk = false; publish(); if (A.requireSession) A.requireSession({ demoOk: true }); }
      else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") { C.dbOk = true; reload(); }
    });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && C.dbOk && session) reload(); });
  }
  const start = () => { boot().catch(e => { console.error(e); C.error = asErr(e).code; C.ready = true; publish(); }); };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})();
