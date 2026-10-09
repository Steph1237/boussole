/* Routage des onglets, en-tête commun et chiffres clés. Les modules s'enregistrent via App.register. */
(function () {
  const ORDER = ["pilotage", "toise", "simu", "plan", "profil"];
  const LABELS = { pilotage: "Pilotage", toise: "Ma position", simu: "Acheter ou placer", plan: "Plan", profil: "Profil" };
  const mods = {};
  let active = "pilotage";
  try { const t = localStorage.getItem("app-tab"); if (ORDER.includes(t)) active = t; } catch (e) {}
  const H = { "#pilotage": "pilotage", "#position": "toise", "#foyer": "toise", "#salaire": "toise", "#patrimoine": "toise", "#emprunt": "toise", "#acheter": "simu", "#simulateur": "simu", "#plan": "plan", "#budget": "plan", "#objectifs": "plan", "#profil": "profil" };
  if (H[location.hash]) active = H[location.hash];

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const App = {
    register(name, m) { mods[name] = m; },
    active: () => active,
    go(name) {
      if (!ORDER.includes(name)) return;
      active = name;
      try { localStorage.setItem("app-tab", name); } catch (e) {}
      ORDER.forEach(k => { const v = $("view-" + k); if (v) v.hidden = k !== active; const b = $("tab-" + k); if (b) { b.setAttribute("aria-selected", String(k === active)); b.tabIndex = k === active ? 0 : -1; } });
      const m = mods[active]; if (m && m.show) try { m.show(); } catch (e) { console.error(e); }
      refreshHeadlines();
      const bar = document.querySelector(".app-tabs"); const y = bar.getBoundingClientRect().top + window.scrollY - 8;
      if (window.scrollY > y) window.scrollTo({ top: y });
    },
  };
  window.App = App;
  /* Les modules chargés avant app.js ont mis leur enregistrement en attente. */
  (window.__pending || []).forEach(reg => reg());
  window.__pending = [];

  function refreshHeadlines() {
    ORDER.forEach(k => { const el = $("tv-" + k); const m = mods[k]; if (!el || !m || !m.headline) return; let v = "–"; try { v = m.headline() || "–"; } catch (e) {} el.textContent = v; });
  }
  const frDate = d => new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  function header(S) {
    const mk = S.positions.filter(p => p.mode === "market" && p.priceDate).map(p => p.priceDate).sort();
    const last = mk[mk.length - 1];
    let t = S.dbOk === false ? "Données indisponibles dans cette vue" : !S.ready ? "Chargement des données…" :
      (last ? "Cours au " + frDate(last) : "Cours non encore mis à jour") + (S.status && S.status.lastRun ? " · agent passé le " + new Date(S.status.lastRun).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
    $("fresh").textContent = t;
    const b = $("dbBanner");
    if (S.dbOk === false) { b.hidden = false; b.textContent = "Connexion à votre espace impossible pour le moment. Rechargez la page ; si le problème persiste, reconnectez-vous."; }
    else if (S.error) { b.hidden = false; b.textContent = "Lecture des données interrompue (" + S.error + "). Rechargez la page."; }
    else b.hidden = true;
    scopeSeg(S);
  }
  /* Sélecteur de périmètre : « Foyer » + une entrée par personne ; masqué s'il n'y a qu'une personne. */
  function scopeSeg(S) {
    const seg = $("scopeSeg"); if (!seg) return;
    const ppl = Array.isArray(S.people) ? S.people : [];
    const items = [{ id: "foyer", nom: "Foyer" }].concat(ppl.map((p, i) => ({ id: p.id, nom: String(p.nom || "").trim() || (i ? "Conjoint(e)" : "Moi") })));
    const sig = JSON.stringify(items);
    if (seg.dataset.sig !== sig) {
      seg.innerHTML = items.map(x => '<button type="button" data-scope="' + esc(x.id) + '">' + esc(x.nom) + "</button>").join("");
      seg.dataset.sig = sig;
    }
    seg.hidden = ppl.length < 2;
    seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.scope === S.scope)));
  }

  function boot() {
    const tabs = document.querySelector(".app-tabs");
    tabs.innerHTML = ORDER.map(k => '<button type="button" role="tab" id="tab-' + k + '" aria-controls="view-' + k + '" data-app-tab="' + k + '"><span class="t-l">' + LABELS[k] + '</span><span class="t-v" id="tv-' + k + '">–</span></button>').join("");
    tabs.addEventListener("click", e => { const b = e.target.closest("[data-app-tab]"); if (b) App.go(b.dataset.appTab); });
    tabs.addEventListener("keydown", e => { if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; const i = ORDER.indexOf(active); App.go(ORDER[(i + (e.key === "ArrowRight" ? 1 : ORDER.length - 1)) % ORDER.length]); $("tab-" + active).focus(); });
    $("scopeSeg").addEventListener("click", e => { const b = e.target.closest("[data-scope]"); if (b) Store.setScope(b.dataset.scope); });
    document.addEventListener("click", e => {
      const g = e.target.closest("[data-goto-tab]"); if (g) { e.preventDefault(); App.go(g.dataset.gotoTab); }
    });
    ORDER.forEach(k => { const m = mods[k]; const root = $("view-" + k); if (m && m.mount && root) try { m.mount(root); } catch (e) { console.error(k, e); } });
    const demo = Store.mode === "demo";
    $("demoBanner").hidden = !demo;
    $("accountLink").hidden = demo;
    let onboardingShown = false;
    /* Premiers pas : une fois par chargement, pour un compte réel qui ne les a ni faits ni passés. */
    function maybeOnboard(S) {
      if (onboardingShown || demo || !window.Onboarding || !S.ready || !S.dbOk || S.onboardingDone) return;
      onboardingShown = true;
      Onboarding.open({
        profil: S.profil,
        onSave: async (patch, rows) => {
          await Store.db.doc("profil/main").update(patch);
          if (rows && rows.length) await Store.db.collection("positions").addMany(rows);
          await Store.markOnboarded();
        },
        onSkip: () => Store.markOnboarded().catch(e => console.warn("Boussole : premiers pas non marqués", e)),
      });
    }
    Store.on(S => {
      maybeOnboard(S);
      header(S);
      ORDER.forEach(k => { const m = mods[k]; if (m && m.update) try { m.update(S, k === active); } catch (e) { console.error(k, e); } });
      refreshHeadlines();
    });
    App.go(active);
    header(Store.get());
    Store.emit();
  }
  App.refreshHeadlines = refreshHeadlines;
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();
