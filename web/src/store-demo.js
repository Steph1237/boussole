/* Store démo : même contrat que store-supabase.js, en mémoire, sur les données de window.DEMO (demo-data.js).
   Rien n'est enregistré : les écritures de la façade `db` modifient la mémoire puis réémettent.

   Choix du mode au démarrage (pas de store.js intermédiaire) : chaque adaptateur vérifie lui-même son mode
   et seul celui qui correspond installe window.Store. Ce fichier s'installe quand l'URL contient `demo`
   (app.html?demo) ou quand window.BOUSSOLE_MODE === "demo" ; store-supabase.js s'installe dans tous les
   autres cas. L'ordre des <script> est fixé par build.mjs : config.js, supabase-js, calc, demo-data,
   store-demo, store-supabase, auth, reel, modules, app.

   Contrat : window.Store = { get(), on(fn), setScope(s), emit(), db, mode, reload() }
   S = { ready, dbOk, positions, snapshots, tx, config, status, profil, profilLoaded, budget, objectifs, scope, people, user, error }
   budget = { lignes: [...] } | null ; objectifs = [{ id, nom, type, cible, dateCible, deja, source, poches, enveloppes, rendement, priorite }]
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
    scope: "foyer", error: null, user: { id: "demo", email: null, demo: true },
  };
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
  const OBJ_DEFAUT = { nom: "", type: "projet", cible: 0, dateCible: null, deja: 0, source: "saisi", poches: [], enveloppes: [], rendement: 2, priorite: 0 };
  const db = {
    doc(path) {
      const [col, id] = String(path).split("/");
      return {
        async update(patch) {
          await tick();
          if (col === "positions") { const p = C.positions.find(x => x.id === id); if (!p) throw err("not_found", "Position inconnue : " + id); Object.assign(p, clone(patch)); }
          else if (col === "config") C.config = Object.assign(C.config || {}, clone(patch));
          else if (col === "profil") C.profil = Object.assign(C.profil || {}, clone(patch));
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

  const Store = {
    mode: "demo",
    db,
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
  };
  window.Store = Store;

  publish();
  // Un court délai pour exercer les états « Chargement… » des modules, comme avec une vraie base.
  setTimeout(() => { C.ready = true; C.dbOk = true; C.profilLoaded = true; publish(); }, 150);
})();
