/* Store Supabase : contrat identique à store-demo.js, sur les tables du projet (RLS = isolation par utilisateur).

   Choix du mode au démarrage (pas de store.js intermédiaire) : chaque adaptateur vérifie lui-même son mode
   et seul celui qui correspond installe window.Store. Ce fichier s'installe hors démo (pas de `demo` dans
   l'URL, window.BOUSSOLE_MODE ≠ "demo") ; store-demo.js s'installe sinon.

   Démarrage : attend la session via window.Auth (auth.js, chargé juste après ce fichier ; d'où le boot au
   DOMContentLoaded). Sans session → dbOk = false, ready = true (app.js affiche le bandeau) et Auth.requireSession
   redirige vers index.html#connexion. Avec session : toutes les tables sont lues en parallèle, S est construit
   à la forme canonique (foyer / p1 / p2, voir l'en-tête de store-demo.js) et exposé tel quel aux modules.
   Écritures : façade `db` (doc("positions/<id>").update/set, doc("config/main").update, doc("profil/main").set,
   doc("budget/main").set({lignes}), doc("objectifs/<id>").delete(), collection("transactions").add,
   collection("objectifs").upsert(row)) traduite en requêtes PostgREST ; après chaque écriture : reload() puis emit().
   reload() est débordé à 200 ms ; rechargement aussi au retour d'onglet (visibilitychange).
   Erreurs d'écriture : { code, message } — "invalid_argument" pour RLS / permission (les modules affichent le
   message « droits »), "network" pour un transport en échec, sinon le code Postgres (ex. 23514) tel quel.

   Contrat : window.Store = { get(), on(fn), setScope(s), emit(), db, mode, reload() }
   S = { ready, dbOk, positions, snapshots, tx, config, status, profil, profilLoaded, budget, objectifs, risque, classes, scope, people, user, error }
   positions[] : … + ter (% par an), zone, devise (exposition), annoteSource, annoteLe — annotations de l'instrument (null si inconnues).
   risque = { reponses, profil, score, date } | null (questionnaire jamais rempli) — colonne profiles.risque.
   classes = { <poche>: <classe> } — surcharges poche → classe (profiles.classes).
   profil.protection = { prevoyance, emprunteur } (booléens) ou le même objet par personne — profiles.protection.
   Écriture : db.doc("profil/main").update({ risque }) / ({ classes }) / ({ protection }) n'écrit que ces colonnes
   (biens et crédits intacts) ; les autres clés du patch passent par l'écriture complète du profil.
   budget = { lignes: [{ id, type: revenu|depense|epargne, categorie, libelle, montant, frequence: mois|an, owner? }] } | null
   objectifs = [{ id, nom, type: apport|matelas|retraite|projet, cible, dateCible, deja, source: saisi|poches, poches, enveloppes,
   rendement, priorite }] (colonne date_cible ↔ dateCible ; tri par priorité puis création). */
(function () {
  const isDemo = window.BOUSSOLE_MODE === "demo" || /[?&]demo(?:=|&|$)/.test(String((window.location && window.location.search) || ""));
  if (isDemo) return;
  const B = window.BOUSSOLE || {};

  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const num = v => (v == null || v === "" ? null : +v);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));

  // État interne ; S (exposé) en est une copie reconstruite à chaque publish().
  const C = { ready: false, dbOk: null, positions: [], snapshots: [], tx: [], config: null, status: null, profil: null, profilLoaded: false, budget: null, objectifs: [], risque: null, classes: {}, onboardingDone: true, scope: "foyer", error: null, user: null };
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
    };
  };
  const txView = r => ({ id: r.id, positionId: r.position_id, date: r.date, type: r.type, qty: num(r.qty), price: num(r.price), amount: num(r.amount), note: r.note || "", source: r.source, createdAt: r.created_at });
  const snapView = r => ({ date: r.date, foyer: num(r.total), p1: num(r.p1), p2: num(r.p2), byBloc: r.by_bloc || {}, byEnvelope: r.by_envelope || {}, source: r.source });
  const cfgView = r => ({ targets: r.targets || {}, rules: r.rules || [], cushion: r.cushion || null, recurring: r.recurring || [], todo: r.todo || [], milestones: r.milestones || [], hypotheses: r.hypotheses || [] });
  const stView = r => ({ lastRun: r.last_run, summary: r.summary || "", alerts: r.alerts || [], missingPrices: r.missing_prices || 0 });
  const profView = (p, biens, credits) => ({
    foyer: p.foyer || {}, personnes: p.personnes || {}, autres: p.autres || {}, protection: p.protection || {},
    biens: biens.map(b => ({ id: b.id, nom: b.nom, usage: b.usage, valeur: num(b.valeur), part_p1: num(b.part_p1), crd: num(b.crd), mensualite: num(b.mensualite), loyer: num(b.loyer) })),
    credits: credits.map(c => ({ id: c.id, nom: c.nom, owner: c.owner, crd: num(c.crd), mensualite: num(c.mensualite) })),
    updatedAt: p.updated_at,
  });
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
    ]);
    const [prof, biens, credits, positions, tx, snaps, config, status, budget, objectifs] = res.map(r => (r.status === "fulfilled" ? r.value : undefined));
    const failed = res.filter(r => r.status === "rejected");
    C.error = failed.length ? (failed[0].reason && failed[0].reason.code) || "erreur" : null;
    if (failed.length) console.warn("Boussole : lecture partielle", failed.map(f => f.reason));
    if (positions !== undefined) C.positions = (positions || []).map(posView);
    if (snaps !== undefined) C.snapshots = (snaps || []).map(snapView);
    if (tx !== undefined) C.tx = (tx || []).map(txView);
    if (config !== undefined) C.config = config ? cfgView(config) : null;
    if (status !== undefined) C.status = status ? stView(status) : null;
    if (budget !== undefined) C.budget = budget ? budgetView(budget) : null;
    if (objectifs !== undefined) C.objectifs = (objectifs || []).map(objView);
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

  /* ---------- écriture : vue canonique → colonnes ---------- */
  const alias = {}; // identifiant « slug » donné par le module (db.doc("positions/<slug>").set) → uuid réel
  const rid = id => alias[id] || id;
  const POS_COLS = { name: "name", envelope: "envelope", owner: "owner", bloc: "bloc", mode: "mode", isin: "isin", qty: "qty", pru: "pru", price: "price_override", priceDate: "value_date", value: "value", valueDate: "value_date", status: "status", hypothesis: "hypothesis", qtyEstimated: "qty_estimated", note: "note" };
  const NOT_NULL = ["name", "envelope", "owner", "bloc", "mode", "status", "qty_estimated"];
  function posCols(view) {
    const row = {};
    Object.keys(view).forEach(k => { const col = POS_COLS[k]; if (col) row[col] = view[k]; });
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
    const c = patch || {}, row = {};
    CFG_COLS.forEach(k => { if (k in c) row[k] = c[k]; });
    const ignored = Object.keys(c).filter(k => !CFG_COLS.includes(k));
    if (ignored.length) console.warn("Boussole : clés de config sans colonne, ignorées :", ignored.join(", "));
    if (!Object.keys(row).length) return;
    row.user_id = uid;
    await q(sb.from("config").upsert(row, { onConflict: "user_id" }));
  }
  async function setProfil(p, uid) {
    const n0 = v => (v == null || v === "" || isNaN(+v) ? 0 : Math.max(0, +v));
    const row = { user_id: uid, foyer: p.foyer || {}, personnes: p.personnes || {}, autres: p.autres || {} };
    if (p.protection !== undefined) row.protection = normDiagnostic({ protection: p.protection }).protection;
    await q(sb.from("profiles").upsert(row, { onConflict: "user_id" }));
    const biens = (p.biens || []).map(b => ({
      id: UUID.test(b.id) ? b.id : newId(), user_id: uid, nom: (b.nom || "").trim() || "Bien",
      usage: ["rp", "locatif", "secondaire"].includes(b.usage) ? b.usage : "rp",
      valeur: n0(b.valeur), part_p1: b.part_p1 == null ? 50 : Math.min(100, n0(b.part_p1)), crd: n0(b.crd), mensualite: n0(b.mensualite), loyer: n0(b.loyer),
    }));
    const credits = (p.credits || []).map(c => ({
      id: UUID.test(c.id) ? c.id : newId(), user_id: uid, nom: (c.nom || "").trim() || "Crédit",
      owner: ["p1", "p2", "commun"].includes(c.owner) ? c.owner : "commun", crd: n0(c.crd), mensualite: n0(c.mensualite),
    }));
    // Remplacement des lignes de l'utilisateur (séquentiel ; RLS borne delete et insert à son user_id).
    await q(sb.from("biens").delete().eq("user_id", uid)); if (biens.length) await q(sb.from("biens").insert(biens));
    await q(sb.from("credits").delete().eq("user_id", uid)); if (credits.length) await q(sb.from("credits").insert(credits));
  }
  /* Colonnes du Diagnostic (profiles.risque / classes / protection) : validées puis écrites seules, sans toucher
     aux biens ni aux crédits. Même validation dans store-demo.js. */
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
  async function updateProfil(patch, uid) {
    const p = patch || {}, diag = {}, reste = {};
    Object.keys(p).forEach(k => { (DIAG.includes(k) ? diag : reste)[k] = p[k]; });
    if (Object.keys(diag).length) await q(sb.from("profiles").upsert(Object.assign({ user_id: uid }, normDiagnostic(diag)), { onConflict: "user_id" }));
    if (Object.keys(reste).length) await setProfil(Object.assign({}, clone(C.profil) || {}, reste), uid);
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

  /* ---------- budget et objectifs ---------- */
  // Validation commune aux deux stores (même texte dans store-demo.js) : une valeur invalide est refusée
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
      const o = { id: l.id ? String(l.id) : newId(), type: l.type, categorie: String(l.categorie || "").trim(), libelle: String(l.libelle || "").trim(), montant, frequence };
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
  const OBJ_COLS = { nom: "nom", type: "type", cible: "cible", dateCible: "date_cible", deja: "deja", source: "source", poches: "poches", enveloppes: "enveloppes", rendement: "rendement", priorite: "priorite" };
  async function setBudget(doc, uid) {
    const lignes = normLignes(doc && doc.lignes);
    await q(sb.from("budgets").upsert({ user_id: uid, lignes }, { onConflict: "user_id" }));
  }
  async function upsertObjectif(view, uid) {
    const v = normObjectif(view), row = {};
    Object.keys(v).forEach(k => { row[OBJ_COLS[k]] = v[k]; });
    const id = view && view.id != null ? String(view.id) : "";
    if (UUID.test(id) && C.objectifs.some(o => o.id === id)) {
      if (Object.keys(row).length) {
        const data = await q(sb.from("objectifs").update(row).eq("id", id).select("id"));
        if (!data || !data.length) throw Object.assign(new Error("Objectif introuvable : " + id), { code: "not_found" });
      }
      return { id };
    }
    row.id = newId(); row.user_id = uid;
    await q(sb.from("objectifs").insert(row));
    return { id: row.id };
  }
  async function deleteObjectif(id) {
    const data = await q(sb.from("objectifs").delete().eq("id", id).select("id"));
    if (!data || !data.length) throw Object.assign(new Error("Objectif introuvable : " + id), { code: "not_found" });
  }

  /* Ajout groupé (import CSV, assistant, premiers pas) : une demande d'instrument par ISIN, une insertion, un rechargement. */
  async function addPositions(rows, uid) {
    const list = (rows || []).map(r => {
      const row = posCols(r); NOT_NULL.forEach(k => { if (row[k] == null) delete row[k]; });
      row.id = newId(); row.user_id = uid; if (!row.name) row.name = "Sans nom"; return row;
    });
    if (!list.length) return { count: 0 };
    const seen = new Set();
    for (const r of list) if (r.isin && !seen.has(r.isin)) { seen.add(r.isin); await q(sb.rpc("request_instrument", { p_isin: r.isin, p_name: r.name, p_symbol: null })); }
    await q(sb.from("positions").insert(list));
    return { count: list.length };
  }

  const db = {
    doc(path) {
      const [col, id] = String(path).split("/");
      const unknown = () => Promise.reject(Object.assign(new Error("Collection inconnue : " + col), { code: "invalid_argument" }));
      return {
        update(patch) {
          if (col === "positions") return write(() => updatePosition(id, patch));
          if (col === "config") return write(uid => updateConfig(patch, uid));
          if (col === "profil") return write(uid => updateProfil(patch, uid));
          if (col === "budget") return write(uid => setBudget(Object.assign({}, clone(C.budget) || {}, patch), uid));
          return unknown();
        },
        set(doc) {
          if (col === "positions") return write(uid => setPosition(id, doc, uid));
          if (col === "config") return write(uid => updateConfig(doc, uid));
          if (col === "profil") return write(uid => setProfil(doc, uid));
          if (col === "budget") return write(uid => setBudget(doc, uid));
          return unknown();
        },
        delete() {
          if (col === "objectifs") return write(() => deleteObjectif(id));
          return unknown();
        },
      };
    },
    collection(name) {
      const unknown = () => Promise.reject(Object.assign(new Error("Collection inconnue : " + name), { code: "invalid_argument" }));
      return {
        add(doc) { return name === "transactions" ? write(uid => addTx(doc, uid)) : unknown(); },
        addMany(rows) { return name === "positions" ? write(uid => addPositions(rows, uid)) : unknown(); },
        upsert(row) { return name === "objectifs" ? write(uid => upsertObjectif(row, uid)) : unknown(); },
      };
    },
  };

  const Store = {
    mode: "supabase",
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
    reload,
    markOnboarded() { return write(uid => q(sb.from("profiles").update({ onboarding_done: true }).eq("user_id", uid))); },
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
