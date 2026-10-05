/* Store démo : même contrat que store-supabase.js, en mémoire, sur les données de window.DEMO (demo-data.js).
   Rien n'est enregistré : les écritures de la façade `db` modifient la mémoire puis réémettent.

   Choix du mode au démarrage (pas de store.js intermédiaire) : chaque adaptateur vérifie lui-même son mode
   et seul celui qui correspond installe window.Store. Ce fichier s'installe quand l'URL contient `demo`
   (app.html?demo) ou quand window.BOUSSOLE_MODE === "demo" ; store-supabase.js s'installe dans tous les
   autres cas. L'ordre des <script> est fixé par build.mjs : config.js, supabase-js, calc, demo-data,
   store-demo, store-supabase, auth, reel, modules, app.

   Contrat : window.Store = { get(), on(fn), setScope(s), emit(), db, mode, reload() }
   S = { ready, dbOk, positions, snapshots, tx, config, status, profil, profilLoaded, scope, people, user, error }
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
  const db = {
    doc(path) {
      const [col, id] = String(path).split("/");
      return {
        async update(patch) {
          await tick();
          if (col === "positions") { const p = C.positions.find(x => x.id === id); if (!p) throw err("not_found", "Position inconnue : " + id); Object.assign(p, clone(patch)); }
          else if (col === "config") C.config = Object.assign(C.config || {}, clone(patch));
          else if (col === "profil") C.profil = Object.assign(C.profil || {}, clone(patch));
          else throw err("invalid_argument", "Collection inconnue : " + col);
          publish();
        },
        async set(doc) {
          await tick();
          if (col === "positions") { const d = Object.assign(clone(doc), { id }); const i = C.positions.findIndex(x => x.id === id); if (i >= 0) C.positions[i] = d; else C.positions.push(d); }
          else if (col === "config") C.config = clone(doc);
          else if (col === "profil") C.profil = clone(doc);
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
    setScope(c) {
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
