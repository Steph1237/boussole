/* Store démo : même contrat que store-supabase.js, en mémoire, sur les données de window.DEMO (demo-data.js).
   Rien n'est enregistré : les écritures de la façade `db` modifient la mémoire puis réémettent.

   Choix du mode au démarrage (pas de store.js intermédiaire) : chaque adaptateur vérifie lui-même son mode
   et seul celui qui correspond installe window.Store. Ce fichier s'installe quand l'URL contient `demo`
   (app.html?demo) ou quand window.BOUSSOLE_MODE === "demo" ; store-supabase.js s'installe dans tous les
   autres cas. L'ordre des <script> est fixé par build.mjs : config.js, supabase-js, calc, demo-data,
   store-demo, store-supabase, auth, reel, modules, app.

   Contrat : window.Store = { get(), on(fn), setScope(s), emit(), db, mode, reload() }
   S = { ready, dbOk, positions, snapshots, tx, config, status, profil, profilLoaded, scope, people, user, error } */
(function () {
  const isDemo = window.BOUSSOLE_MODE === "demo" || /[?&]demo(?:=|&|$)/.test(String((window.location && window.location.search) || ""));
  if (!isDemo) return;

  /* ---------- Alias hérités — À RETIRER EN TASK 5 ----------
     Les modules copiés de ~/Finance parlent encore couple / steph / compagne ; le store parle foyer / p1 / p2.
     Tout le pont tient dans ce bloc : vue canonique → vue héritée à la lecture (publish), inverse à l'écriture (db). */
  const SCOPE_LEGACY = { foyer: "couple", p1: "steph", p2: "compagne" };
  const SCOPE_CANON = { couple: "foyer", steph: "p1", compagne: "p2" };
  const own = k => SCOPE_LEGACY[k] || k;       // p1 → steph, p2 → compagne (commun, tolerancePts… inchangés)
  const ownBack = k => SCOPE_CANON[k] || k;    // steph → p1, compagne → p2
  const keys = (o, f) => (o && typeof o === "object" && !Array.isArray(o)) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v])) : o;
  const ifHas = (o, k, f) => (o && k in o ? { [k]: f(o[k]) } : {});
  const legacy = {
    scope: s => SCOPE_LEGACY[s] || s,
    scopeBack: s => SCOPE_CANON[s] || s,
    position: p => Object.assign({}, p, { owner: own(p.owner) }),
    positionBack: p => ("owner" in p ? Object.assign({}, p, { owner: ownBack(p.owner) }) : p),
    snapshot: s => ({ date: s.date, couple: s.total, steph: s.p1, compagne: s.p2, byBloc: s.byBloc || {}, byEnvelope: s.byEnvelope || {}, source: s.source }),
    config: c => c && Object.assign({}, c, ifHas(c, "targets", t => keys(t, own))),
    configBack: c => Object.assign({}, c, ifHas(c, "targets", t => keys(t, ownBack))),
    profil: p => p && Object.assign({}, p,
      ifHas(p, "personnes", x => keys(x, own)), ifHas(p, "autres", x => keys(x, own)),
      ifHas(p, "biens", bs => (bs || []).map(b => { const { partP1, ...r } = b; return Object.assign(r, { partSteph: partP1 }); })),
      ifHas(p, "credits", cs => (cs || []).map(c => Object.assign({}, c, { owner: own(c.owner) })))),
    profilBack: p => Object.assign({}, p,
      ifHas(p, "personnes", x => keys(x, ownBack)), ifHas(p, "autres", x => keys(x, ownBack)),
      ifHas(p, "biens", bs => (bs || []).map(b => { const { partSteph, ...r } = b; return Object.assign(r, { partP1: partSteph }); })),
      ifHas(p, "credits", cs => (cs || []).map(c => Object.assign({}, c, { owner: ownBack(c.owner) })))),
  };
  /* ---------- fin des alias hérités ---------- */

  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const D = clone(window.DEMO || {});
  // État canonique (foyer / p1 / p2). S (exposé) en est la projection héritée, reconstruite à chaque publish().
  const C = {
    ready: false, dbOk: null, positions: D.positions || [], snapshots: D.snapshots || [], tx: D.tx || [],
    config: D.config || null, status: D.status || null, profil: D.profil || null, profilLoaded: false,
    scope: "foyer", error: null, user: { id: "demo", email: null, demo: true },
  };
  try { const s = legacy.scopeBack(localStorage.getItem("scope")); if (["foyer", "p1", "p2"].includes(s)) C.scope = s; } catch (e) {}

  const people = () => {
    const ps = (C.profil && C.profil.personnes) || {};
    const out = [{ id: "p1", nom: (ps.p1 && ps.p1.nom) || "Moi" }];
    if (ps.p2) out.push({ id: "p2", nom: ps.p2.nom || "Conjoint" });
    return out;
  };

  const subs = []; let tmr = null;
  const emit = () => { clearTimeout(tmr); tmr = setTimeout(() => subs.forEach(fn => { try { fn(S); } catch (e) { console.error(e); } }), 60); };
  const S = {};
  function publish() {
    Object.assign(S, {
      ready: C.ready, dbOk: C.dbOk,
      positions: C.positions.map(p => legacy.position(clone(p))),
      snapshots: C.snapshots.map(legacy.snapshot),
      tx: clone(C.tx),
      config: legacy.config(clone(C.config)),
      status: clone(C.status),
      profil: legacy.profil(clone(C.profil)),
      profilLoaded: C.profilLoaded,
      scope: legacy.scope(C.scope),
      people: people(),
      user: clone(C.user),
      error: C.error,
    });
    emit();
  }

  /* ---------- façade db (même surface que l'ancien store : doc().update/set, collection().add) ---------- */
  const tick = () => new Promise(r => setTimeout(r, 30));
  const err = (code, message) => Object.assign(new Error(message), { code });
  const db = {
    doc(path) {
      const [col, id] = String(path).split("/");
      return {
        async update(patch) {
          await tick();
          if (col === "positions") { const p = C.positions.find(x => x.id === id); if (!p) throw err("not_found", "Position inconnue : " + id); Object.assign(p, legacy.positionBack(clone(patch))); }
          else if (col === "config") C.config = Object.assign(C.config || {}, legacy.configBack(clone(patch)));
          else if (col === "profil") C.profil = Object.assign(C.profil || {}, legacy.profilBack(clone(patch)));
          else throw err("invalid_argument", "Collection inconnue : " + col);
          publish();
        },
        async set(doc) {
          await tick();
          if (col === "positions") { const d = legacy.positionBack(Object.assign(clone(doc), { id })); const i = C.positions.findIndex(x => x.id === id); if (i >= 0) C.positions[i] = d; else C.positions.push(d); }
          else if (col === "config") C.config = legacy.configBack(clone(doc));
          else if (col === "profil") C.profil = legacy.profilBack(clone(doc));
          else throw err("invalid_argument", "Collection inconnue : " + col);
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
      };
    },
  };

  const Store = {
    mode: "demo",
    db,
    get: () => S,
    on(fn) { subs.push(fn); },
    setScope(s) {
      const c = legacy.scopeBack(s);
      if (!["foyer", "p1", "p2"].includes(c)) return;
      C.scope = c;
      try { localStorage.setItem("scope", c); } catch (e) {}
      publish();
    },
    emit,
    reload() { publish(); return Promise.resolve(); },
  };
  window.Store = Store;

  publish();
  // Un court délai pour exercer les états « Chargement… » des modules, comme avec une vraie base.
  setTimeout(() => { C.ready = true; C.dbOk = true; C.profilLoaded = true; publish(); }, 150);
})();
