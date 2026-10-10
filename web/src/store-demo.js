/* Store démo : même contrat que store-supabase.js, en mémoire, sur les données de window.DEMO (demo-data.js).
   Rien n'est enregistré : les écritures de la façade `db` modifient la mémoire puis réémettent.

   Choix du mode au démarrage (pas de store.js intermédiaire) : chaque adaptateur vérifie lui-même son mode
   et seul celui qui correspond installe window.Store. Ce fichier s'installe quand l'URL contient `demo`
   (app.html?demo) ou quand window.BOUSSOLE_MODE === "demo" ; store-supabase.js s'installe dans tous les
   autres cas. L'ordre des <script> est fixé par build.mjs : config.js, supabase-js, calc, demo-data,
   store-demo, store-supabase, auth, reel, modules, app.

   Contrat : window.Store = { get(), on(fn), setScope(s), emit(), db, mode, reload(), propositions, memoire, savoir, surveillerConnexions(on) }
   S = { ready, dbOk, positions, snapshots, tx, config, status, profil, profilLoaded, budget, objectifs, risque, classes, propositions, connexions, memoire, savoir, scope, people, user, error }
   budget = { lignes: [...] } | null ; objectifs = [{ id, nom, type, cible, dateCible, deja, source, poches, enveloppes, rendement, priorite }]
   risque = { reponses, profil, score, date } | null ; classes = { <poche>: <classe> } ; profil.protection = { prevoyance, emprunteur } ;
   positions[] portent ter, zone, devise, annoteSource, annoteLe (annotations de l'instrument).
   propositions = [{ id, lot, cible, operation, ref, avant, apres, source, justification, statut, creeLe, decideLe }] (toutes, les plus
   récentes d'abord) ; Store.propositions.appliquer(ids, modifications) / refuser(ids) les décident en mémoire (même effet que la
   fonction SQL appliquer_propositions, voir l'en-tête de store-supabase.js).
   db.doc("profil/main").update({ risque }) / ({ classes }) / ({ protection }) ne touche que ces clés.
   connexions = [{ clientId, clientNom, premierLe, dernierLe, appels }] (vide au départ : aucun assistant connecté) ;
   Store.surveillerConnexions(true) simule la connexion de Claude 4 s plus tard (pour montrer le voyant de l'onboarding),
   surveillerConnexions(false) annule la simulation en attente.
   memoire = [{ id, categorie, contenu, echeance, epingle, source, creeLe, majLe }] (DEMO.memoire) ; Store.memoire.modifier(id, patch) /
   supprimer(ids) / toutEffacer() → { ok: true } ou { erreur }, en mémoire. savoir = { fiches (sans contenu), reperes } (DEMO.savoir,
   repères d'exemple) ; Store.savoir.fiche(slug) → la fiche d'exemple avec son contenu, ou null.
   (formes détaillées dans l'en-tête de store-supabase.js).
   Vocabulaire canonique : scope ∈ foyer | p1 | p2 ; positions.owner ∈ p1 | p2 ; snapshots { date, foyer, p1, p2,
   byBloc, byEnvelope, source } ; config.targets { p1, p2, tolerancePts } ; profil.personnes / autres { p1, p2 },
   biens[].part_p1, credits[].owner ∈ p1 | p2 | commun ; people = [{ id: "p1", nom }, { id: "p2", nom }?]. */
(function () {
  const isDemo = window.BOUSSOLE_MODE === "demo" || /[?&]demo(?:=|&|$)/.test(String((window.location && window.location.search) || ""));
  if (!isDemo) return;

  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const D = clone(window.DEMO || {});
  // État interne ; S (exposé) en est une copie reconstruite à chaque publish().
  const C = {
    ready: false, dbOk: null, positions: D.positions || [], snapshots: D.snapshots || [], tx: D.tx || [],
    config: D.config || null, status: D.status || null, profil: D.profil || null, profilLoaded: false,
    budget: D.budget || null, objectifs: D.objectifs || [],
    risque: D.risque || null, classes: D.classes || {}, propositions: D.propositions || [], connexions: D.connexions || [],
    memoire: [], savoir: { fiches: [], reperes: [] },
    scope: "foyer", error: null, user: { id: "demo", email: null, demo: true },
  };
  // Fiches : S n'expose que les résumés (comme store-supabase.js) ; le contenu reste ici pour Store.savoir.fiche(slug).
  const FICHES = (D.savoir && D.savoir.fiches) || [];
  C.memoire = D.memoire || [];
  C.savoir = { fiches: FICHES.map(f => { const o = Object.assign({}, f); delete o.contenu; return o; }), reperes: (D.savoir && D.savoir.reperes) || [] };
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
      onboardingDone: true, // la démo ne propose jamais les premiers pas
      scope: ppl.some(p => p.id === C.scope) ? C.scope : "foyer", // une seule personne : toujours le foyer
      people: ppl,
      user: clone(C.user),
      error: C.error,
    });
    emit();
  }

  /* ---------- façade db (même surface que l'ancien store : doc().update/set, collection().add) ---------- */
  const tick = () => new Promise(r => setTimeout(r, 30));
  const err = (code, message) => Object.assign(new Error(message), { code });
  const newId = p => p + "-" + Math.random().toString(36).slice(2, 9);
  // Validation commune aux deux stores (même texte dans store-supabase.js) : une valeur invalide est refusée
  // (code invalid_argument, message en français), jamais corrigée en silence.
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
  /* Colonnes du Diagnostic (même validation que store-supabase.js). */
  const DIAG = ["risque", "classes", "protection"];
  const objet = v => v != null && typeof v === "object" && !Array.isArray(v);
  function normDiagnostic(patch) {
    const out = {};
    if ("risque" in patch) {
      if (patch.risque !== null && !objet(patch.risque)) throw bad("Profil de risque invalide : objet { reponses, profil, score, date } ou null attendu.");
      out.risque = patch.risque;
    }
    if ("classes" in patch) {
      const c = patch.classes == null ? {} : patch.classes;
      if (!objet(c) || Object.keys(c).some(k => typeof c[k] !== "string" || !c[k])) throw bad("Classes invalides : objet { poche: classe } attendu.");
      out.classes = c;
    }
    if ("protection" in patch) {
      const pr = patch.protection == null ? {} : patch.protection;
      if (!objet(pr)) throw bad("Protection invalide : objet { prevoyance, emprunteur } attendu.");
      out.protection = pr;
    }
    return out;
  }
  function updateProfil(patch) {
    const p = clone(patch) || {}, diag = {}, reste = {};
    Object.keys(p).forEach(k => { (DIAG.includes(k) ? diag : reste)[k] = p[k]; });
    const d = normDiagnostic(diag);
    if ("risque" in d) C.risque = d.risque;
    if ("classes" in d) C.classes = d.classes;
    C.profil = Object.assign(C.profil || {}, reste, "protection" in d ? { protection: d.protection } : {});
  }
  const OBJ_DEFAUT = { nom: "", type: "projet", cible: 0, dateCible: null, deja: 0, source: "saisi", poches: [], enveloppes: [], rendement: 2, priorite: 0 };
  const db = {
    doc(path) {
      const [col, id] = String(path).split("/");
      return {
        async update(patch) {
          await tick();
          if (col === "positions") { const p = C.positions.find(x => x.id === id); if (!p) throw err("not_found", "Position inconnue : " + id); Object.assign(p, clone(patch)); }
          else if (col === "config") C.config = Object.assign(C.config || {}, clone(patch));
          else if (col === "profil") updateProfil(patch);
          else if (col === "budget") C.budget = { lignes: normLignes(Object.assign({}, C.budget || {}, clone(patch)).lignes) };
          else throw err("invalid_argument", "Collection inconnue : " + col);
          publish();
        },
        async set(doc) {
          await tick();
          if (col === "positions") { const d = Object.assign(clone(doc), { id }); const i = C.positions.findIndex(x => x.id === id); if (i >= 0) C.positions[i] = d; else C.positions.push(d); }
          else if (col === "config") C.config = clone(doc);
          else if (col === "profil") C.profil = clone(doc);
          else if (col === "budget") C.budget = { lignes: normLignes(clone(doc || {}).lignes) };
          else throw err("invalid_argument", "Collection inconnue : " + col);
          publish();
        },
        async delete() {
          await tick();
          if (col !== "objectifs") throw err("invalid_argument", "Collection inconnue : " + col);
          const i = C.objectifs.findIndex(o => o.id === id);
          if (i < 0) throw err("not_found", "Objectif introuvable : " + id);
          C.objectifs.splice(i, 1);
          publish();
        },
      };
    },
    collection(name) {
      return {
        async add(doc) {
          await tick();
          if (name !== "transactions") throw err("invalid_argument", "Collection inconnue : " + name);
          const row = Object.assign({ id: "tx-" + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString() }, clone(doc));
          C.tx.unshift(row);
          publish();
          return { id: row.id };
        },
        async addMany(rows) {
          await tick();
          if (name !== "positions") throw err("invalid_argument", "Collection inconnue : " + name);
          (rows || []).forEach(r => C.positions.push(Object.assign({ id: "pos-" + Math.random().toString(36).slice(2, 9), status: "actif" }, clone(r))));
          publish();
          return { count: (rows || []).length };
        },
        async upsert(row) {
          await tick();
          if (name !== "objectifs") throw err("invalid_argument", "Collection inconnue : " + name);
          const v = normObjectif(clone(row));
          const id = row && row.id != null ? String(row.id) : "";
          const cur = id && C.objectifs.find(o => o.id === id);
          const out = cur ? Object.assign(cur, v) : Object.assign(clone(OBJ_DEFAUT), v, { id: newId("obj") });
          if (!cur) C.objectifs.push(out);
          C.objectifs.sort((x, y) => x.priorite - y.priorite); // tri stable : priorité puis ordre de création
          publish();
          return { id: out.id };
        },
      };
    },
  };


  /* ---------- propositions de Claude (même effet que appliquer_propositions, en mémoire) ---------- */
  const QUESTIONS_RISQUE = ["horizon", "objectif", "reaction", "perte_max", "connaissances", "experience", "revenus", "matelas", "part_investie", "age"];
  const sansNull = o => { const r = {}; Object.keys(o || {}).forEach(k => { if (o[k] !== null && o[k] !== undefined) r[k] = o[k]; }); return r; };
  const POS_VUE = { value_date: "valueDate", qty_estimated: "qtyEstimated", price_override: "price" };
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
  function appliquerUne(p, v) {
    const objetAttendu = () => { if (p.operation !== "supprimer" && !objet(v)) throw bad("valeur proposée invalide (objet attendu)."); };
    objetAttendu();
    const pr = C.profil = C.profil || { foyer: {}, personnes: { p1: { nom: "Moi" } }, autres: {}, biens: [], credits: [], protection: {} };
    const ligne = (liste, quoi) => { const i = liste.findIndex(x => x.id === p.ref); if (i < 0) introuvable(quoi, p.ref); return i; };
    switch (p.cible) {
      case "profil": {
        if ("foyer" in v) { if (!objet(v.foyer)) throw bad("foyer : objet attendu."); pr.foyer = sansNull(Object.assign({}, pr.foyer, v.foyer)); }
        ["personnes", "autres"].forEach(cle => {
          if (!(cle in v)) return;
          if (!objet(v[cle])) throw bad(cle + " : objet attendu.");
          const cur = Object.assign({}, pr[cle]);
          Object.keys(v[cle]).forEach(k => {
            if (!["p1", "p2"].includes(k)) throw bad(cle + " : personne « " + k + " » inconnue (p1 ou p2).");
            if (v[cle][k] === null && cle === "personnes") { if (k === "p1") throw bad("la première personne du foyer ne peut pas être retirée."); delete cur[k]; }
            else if (objet(v[cle][k])) cur[k] = sansNull(Object.assign({}, cur[k], v[cle][k]));
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
          id = newId("pos");
          C.positions.push(Object.assign({ id, name: "Sans nom", envelope: "", owner: "p1", bloc: "", mode: vue.isin && vue.qty != null ? "market" : "manual", isin: null, qty: null, pru: null,
            price: null, priceDate: null, value: null, valueDate: null, status: "actif", hypothesis: null, qtyEstimated: false, note: null,
            ter: null, zone: null, devise: null, annoteSource: null, annoteLe: null }, vue));
        } else {
          const vue = versVuePosition(v);
          if (vue.owner && !["p1", "p2"].includes(vue.owner)) throw bad("titulaire « " + vue.owner + " » inconnu (p1 ou p2).");
          Object.assign(C.positions[ligne(C.positions, "ligne")], vue);
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
      default:
        throw bad("cible « " + p.cible + " » inconnue.");
    }
  }
  const LIBELLES_CIBLE = { profil: "profil", budget: "ligne de budget", position: "placement", bien: "bien immobilier", credit: "crédit", objectif: "objectif", risque: "profil de risque", protection: "protection" };
  const propositions = {
    async appliquer(ids, modifications = {}) {
      await tick();
      const mods = modifications == null ? {} : modifications;
      if (!objet(mods)) throw bad("Modifications invalides : objet { identifiant: valeur } attendu.");
      const liste = (Array.isArray(ids) ? ids : []).map(String);
      const cibles = C.propositions.filter(p => liste.includes(String(p.id)) && p.statut === "en_attente")
        .sort((a, b) => String(a.creeLe).localeCompare(String(b.creeLe)));
      const sauvegarde = clone({ positions: C.positions, tx: C.tx, profil: C.profil, budget: C.budget, objectifs: C.objectifs, risque: C.risque, propositions: C.propositions });
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
  const SENSIBLE = [/[A-Z]{2}[0-9]{2}( ?[A-Z0-9]){11,30}/, /([0-9][ -]?){12,18}[0-9]/, /(mot de passe|password|code secret|code pin|identifiant de connexion)/i];
  const MSG_SENSIBLE = "Ce souvenir contient une information sensible (numéro de compte ou de carte, identifiant, mot de passe) : il n'est pas enregistré.";
  function normSouvenir(patch, m) {
    const p = patch || {}, out = {};
    if ("contenu" in p) {
      const t = String(p.contenu == null ? "" : p.contenu).trim();
      if (!t || t.length > 500) throw bad("Un souvenir compte de 1 à 500 caractères.");
      if (SENSIBLE.some(re => re.test(t))) throw bad(MSG_SENSIBLE);
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
  const savoir = {
    async fiche(slug) {
      await tick();
      const f = FICHES.find(x => x.slug === slug);
      return f ? clone(f) : null;
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

  const Store = {
    mode: "demo",
    db,
    propositions,
    memoire,
    savoir,
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
  };
  window.Store = Store;

  publish();
  // Un court délai pour exercer les états « Chargement… » des modules, comme avec une vraie base.
  setTimeout(() => { C.ready = true; C.dbOk = true; C.profilLoaded = true; publish(); }, 150);
})();
