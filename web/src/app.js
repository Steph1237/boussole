/* Routage des onglets, en-tête commun et chiffres clés. Les modules s'enregistrent via App.register. */
(function () {
  const ORDER = ["pilotage", "toise", "simu", "profil"];
  const LABELS = { pilotage: "Pilotage", toise: "Ma position", simu: "Acheter ou placer", profil: "Profil" };
  const mods = {};
  let active = "pilotage";
  try { const t = localStorage.getItem("app-tab"); if (ORDER.includes(t)) active = t; } catch (e) {}
  const H = { "#pilotage": "pilotage", "#position": "toise", "#foyer": "toise", "#salaire": "toise", "#patrimoine": "toise", "#emprunt": "toise", "#acheter": "simu", "#simulateur": "simu", "#profil": "profil" };
  if (H[location.hash]) active = H[location.hash];

  const $ = id => document.getElementById(id);
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
    if (S.dbOk === false) { b.hidden = false; b.textContent = "Les données du tableau de bord ne sont pas accessibles dans cette vue. Ouvrez-le depuis votre compte Claude. Ma position et Acheter ou placer fonctionnent avec des valeurs d'exemple."; }
    else if (S.error) { b.hidden = false; b.textContent = "Lecture des données interrompue (" + S.error + "). Rechargez la page."; }
    else b.hidden = true;
    document.querySelectorAll("#scopeSeg button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.scope === S.scope)));
  }

  function boot() {
    const tabs = document.querySelector(".app-tabs");
    tabs.innerHTML = ORDER.map(k => '<button type="button" role="tab" id="tab-' + k + '" aria-controls="view-' + k + '" data-app-tab="' + k + '"><span class="t-l">' + LABELS[k] + '</span><span class="t-v" id="tv-' + k + '">–</span></button>').join("");
    tabs.addEventListener("click", e => { const b = e.target.closest("[data-app-tab]"); if (b) App.go(b.dataset.appTab); });
    tabs.addEventListener("keydown", e => { if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; const i = ORDER.indexOf(active); App.go(ORDER[(i + (e.key === "ArrowRight" ? 1 : ORDER.length - 1)) % ORDER.length]); $("tab-" + active).focus(); });
    document.querySelectorAll("#scopeSeg button").forEach(b => b.addEventListener("click", () => Store.setScope(b.dataset.scope)));
    document.addEventListener("click", e => {
      const g = e.target.closest("[data-goto-tab]"); if (g) { e.preventDefault(); App.go(g.dataset.gotoTab); }
    });
    ORDER.forEach(k => { const m = mods[k]; const root = $("view-" + k); if (m && m.mount && root) try { m.mount(root); } catch (e) { console.error(k, e); } });
    Store.on(S => {
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
