/* Store Supabase : contrat identique à store-demo.js, sur les tables du projet (RLS = isolation par utilisateur).

   Choix du mode au démarrage (pas de store.js intermédiaire) : chaque adaptateur vérifie lui-même son mode
   et seul celui qui correspond installe window.Store. Ce fichier s'installe hors démo (pas de `demo` dans
   l'URL, window.BOUSSOLE_MODE ≠ "demo") ; store-demo.js s'installe sinon.

   Démarrage : attend la session via window.Auth (auth.js, chargé juste après ce fichier ; d'où le boot au
   DOMContentLoaded). Sans session → dbOk = false, ready = true (app.js affiche le bandeau) et Auth.requireSession
   redirige vers index.html#connexion. Avec session : toutes les tables sont lues en parallèle, S est construit
   à la forme canonique (foyer / p1 / p2) puis exposé aux modules avec les alias hérités.
   Écritures : façade `db` (doc("positions/<id>").update/set, doc("config/main").update, doc("profil/main").set,
   collection("transactions").add) traduite en requêtes PostgREST ; après chaque écriture : reload() puis emit().
   reload() est débordé à 200 ms ; rechargement aussi au retour d'onglet (visibilitychange).
   Erreurs d'écriture : { code, message } — "invalid_argument" pour RLS / permission (les modules affichent le
   message « droits »), "network" pour un transport en échec, sinon le code Postgres (ex. 23514) tel quel.

   Contrat : window.Store = { get(), on(fn), setScope(s), emit(), db, mode, reload() }
   S = { ready, dbOk, positions, snapshots, tx, config, status, profil, profilLoaded, scope, people, user, error } */
(function () {
  const isDemo = window.BOUSSOLE_MODE === "demo" || /[?&]demo(?:=|&|$)/.test(String((window.location && window.location.search) || ""));
  if (isDemo) return;
  const B = window.BOUSSOLE || {};

  /* ---------- Alias hérités — À RETIRER EN TASK 5 ----------
     Les modules copiés de ~/Finance parlent encore couple / steph / compagne ; le store parle foyer / p1 / p2.
     Tout le pont tient dans ce bloc : vue canonique → vue héritée à la lecture (publish), inverse à l'écriture (db).
     (Même bloc que dans store-demo.js ; le test de contrat vérifie que la table SCOPE_LEGACY est identique.) */
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
  const num = v => (v == null || v === "" ? null : +v);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));

  // État canonique ; S (exposé) en est la projection héritée, reconstruite à chaque publish().
  const C = { ready: false, dbOk: null, positions: [], snapshots: [], tx: [], config: null, status: null, profil: null, profilLoaded: false, scope: "foyer", error: null, user: null };
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
    };
  };
  const txView = r => ({ id: r.id, positionId: r.position_id, date: r.date, type: r.type, qty: num(r.qty), price: num(r.price), amount: num(r.amount), note: r.note || "", source: r.source, createdAt: r.created_at });
  const snapView = r => ({ date: r.date, total: num(r.total), p1: num(r.p1), p2: num(r.p2), byBloc: r.by_bloc || {}, byEnvelope: r.by_envelope || {}, source: r.source });
  const cfgView = r => ({ targets: r.targets || {}, rules: r.rules || [], cushion: r.cushion || null, recurring: r.recurring || [], todo: r.todo || [], milestones: r.milestones || [], hypotheses: r.hypotheses || [] });
  const stView = r => ({ lastRun: r.last_run, summary: r.summary || "", alerts: r.alerts || [], missingPrices: r.missing_prices || 0 });
  const profView = (p, biens, credits) => ({
    foyer: p.foyer || {}, personnes: p.personnes || {}, autres: p.autres || {},
    biens: biens.map(b => ({ id: b.id, nom: b.nom, usage: b.usage, valeur: num(b.valeur), partP1: num(b.part_p1), crd: num(b.crd), mensualite: num(b.mensualite), loyer: num(b.loyer) })),
    credits: credits.map(c => ({ id: c.id, nom: c.nom, owner: c.owner, crd: num(c.crd), mensualite: num(c.mensualite) })),
    updatedAt: p.updated_at,
  });

  async function loadAll() {
    if (!sb || !session) return;
    const res = await Promise.allSettled([
      q(sb.from("profiles").select("*").maybeSingle()),
      q(sb.from("biens").select("*").order("created_at")),
      q(sb.from("credits").select("*").order("created_at")),
      q(sb.from("positions").select("*, instruments(price, price_date, name, symbol, currency)").order("created_at")),
      q(sb.from("transactions").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(60)),
      q(sb.from("snapshots").select("*").order("date")),
      q(sb.from("config").select("*").maybeSingle()),
      q(sb.from("status").select("*").maybeSingle()),
    ]);
    const [prof, biens, credits, positions, tx, snaps, config, status] = res.map(r => (r.status === "fulfilled" ? r.value : undefined));
    const failed = res.filter(r => r.status === "rejected");
    C.error = failed.length ? (failed[0].reason && failed[0].reason.code) || "erreur" : null;
    if (failed.length) console.warn("Boussole : lecture partielle", failed.map(f => f.reason));
    if (positions !== undefined) C.positions = (positions || []).map(posView);
    if (snaps !== undefined) C.snapshots = (snaps || []).map(snapView);
    if (tx !== undefined) C.tx = (tx || []).map(txView);
    if (config !== undefined) C.config = config ? cfgView(config) : null;
    if (status !== undefined) C.status = status ? stView(status) : null;
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

  /* ---------- écriture : vue héritée → colonnes ---------- */
  const alias = {}; // identifiant « slug » donné par le module (db.doc("positions/<slug>").set) → uuid réel
  const rid = id => alias[id] || id;
  const POS_COLS = { name: "name", envelope: "envelope", owner: "owner", bloc: "bloc", mode: "mode", isin: "isin", qty: "qty", pru: "pru", price: "price_override", priceDate: "value_date", value: "value", valueDate: "value_date", status: "status", hypothesis: "hypothesis", qtyEstimated: "qty_estimated", note: "note" };
  const NOT_NULL = ["name", "envelope", "owner", "bloc", "mode", "status", "qty_estimated"];
  function posCols(view) {
    const canon = legacy.positionBack(view), row = {};
    Object.keys(canon).forEach(k => { const col = POS_COLS[k]; if (col) row[col] = canon[k]; });
    if ("isin" in row) row.isin = row.isin ? String(row.isin).trim().toUpperCase() : null;
    return row;
  }
  const guard = () => { if (!sb || !session) throw Object.assign(new Error("Base indisponible : aucune session."), { code: C.dbOk === false ? "network" : "invalid_argument" }); };
  async function write(fn) {
    guard();
    let out;
    try { out = await fn(session.user.id); } catch (e) { throw asErr(e); }
    await reload();
    return out;
  }

  async function updatePosition(id, patch) {
    const row = posCols(patch); if (!Object.keys(row).length) return;
    const data = await q(sb.from("positions").update(row).eq("id", rid(id)).select("id"));
    if (!data || !data.length) throw Object.assign(new Error("Position introuvable : " + id), { code: "not_found" });
  }
  async function setPosition(id, doc, uid) {
    const d = Object.assign({}, doc); delete d.id;
    const row = posCols(d);
    NOT_NULL.forEach(k => { if (row[k] == null) delete row[k]; }); // valeurs par défaut SQL
    if (!row.name) row.name = "Sans nom";
    const real = UUID.test(id) ? id : alias[id] || newId();
    if (!UUID.test(id)) alias[id] = real;
    row.id = real; row.user_id = uid;
    if (row.isin) await q(sb.rpc("request_instrument", { p_isin: row.isin, p_name: row.name, p_symbol: null }));
    await q(sb.from("positions").upsert(row, { onConflict: "id" }));
  }
  const CFG_COLS = ["targets", "rules", "cushion", "recurring", "todo", "milestones", "hypotheses"];
  async function updateConfig(patch, uid) {
    const c = legacy.configBack(patch), row = {};
    CFG_COLS.forEach(k => { if (k in c) row[k] = c[k]; });
    const ignored = Object.keys(c).filter(k => !CFG_COLS.includes(k));
    if (ignored.length) console.warn("Boussole : clés de config sans colonne, ignorées :", ignored.join(", "));
    if (!Object.keys(row).length) return;
    row.user_id = uid;
    await q(sb.from("config").upsert(row, { onConflict: "user_id" }));
  }
  async function setProfil(view, uid) {
    const p = legacy.profilBack(view);
    const n0 = v => (v == null || v === "" || isNaN(+v) ? 0 : Math.max(0, +v));
    await q(sb.from("profiles").upsert({ user_id: uid, foyer: p.foyer || {}, personnes: p.personnes || {}, autres: p.autres || {} }, { onConflict: "user_id" }));
    const biens = (p.biens || []).map(b => ({
      id: UUID.test(b.id) ? b.id : newId(), user_id: uid, nom: (b.nom || "").trim() || "Bien",
      usage: ["rp", "locatif", "secondaire"].includes(b.usage) ? b.usage : "rp",
      valeur: n0(b.valeur), part_p1: b.partP1 == null ? 50 : Math.min(100, n0(b.partP1)), crd: n0(b.crd), mensualite: n0(b.mensualite), loyer: n0(b.loyer),
    }));
    const credits = (p.credits || []).map(c => ({
      id: UUID.test(c.id) ? c.id : newId(), user_id: uid, nom: (c.nom || "").trim() || "Crédit",
      owner: ["p1", "p2", "commun"].includes(c.owner) ? c.owner : "commun", crd: n0(c.crd), mensualite: n0(c.mensualite),
    }));
    // Remplacement des lignes de l'utilisateur (séquentiel ; RLS borne delete et insert à son user_id).
    await q(sb.from("biens").delete().eq("user_id", uid)); if (biens.length) await q(sb.from("biens").insert(biens));
    await q(sb.from("credits").delete().eq("user_id", uid)); if (credits.length) await q(sb.from("credits").insert(credits));
  }
  async function addTx(doc, uid) {
    const pid = doc.positionId != null ? rid(String(doc.positionId)) : null;
    if (pid && !UUID.test(pid)) console.warn("Boussole : positionId inconnu, transaction enregistrée sans lien :", pid);
    const row = {
      user_id: uid, position_id: pid && UUID.test(pid) ? pid : null,
      date: doc.date || new Date().toISOString().slice(0, 10), type: doc.type || "autre",
      qty: num(doc.qty), price: num(doc.price), amount: num(doc.amount), note: doc.note || null, source: doc.source || "manuel",
    };
    const data = await q(sb.from("transactions").insert(row).select("id").single());
    return { id: data.id };
  }

  const db = {
    doc(path) {
      const [col, id] = String(path).split("/");
      const unknown = () => Promise.reject(Object.assign(new Error("Collection inconnue : " + col), { code: "invalid_argument" }));
      return {
        update(patch) {
          if (col === "positions") return write(() => updatePosition(id, patch));
          if (col === "config") return write(uid => updateConfig(patch, uid));
          if (col === "profil") return write(uid => setProfil(Object.assign({}, legacy.profil(C.profil) || {}, patch), uid));
          return unknown();
        },
        set(doc) {
          if (col === "positions") return write(uid => setPosition(id, doc, uid));
          if (col === "config") return write(uid => updateConfig(doc, uid));
          if (col === "profil") return write(uid => setProfil(doc, uid));
          return unknown();
        },
      };
    },
    collection(name) {
      return { add(doc) { return name === "transactions" ? write(uid => addTx(doc, uid)) : Promise.reject(Object.assign(new Error("Collection inconnue : " + name), { code: "invalid_argument" })); } };
    },
  };

  const Store = {
    mode: "supabase",
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
    reload,
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
