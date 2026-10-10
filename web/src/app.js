/* Coque : espaces, sous-vues, routage par hash (#espace/sous-vue), barre latérale (ordinateur) et barre basse (mobile).
   Les modules s'enregistrent via App.register(name, { mount, update(S, visible), show, headline }).
   Pour brancher un module sur une sous-vue : renseigner `module` dans SPACES et poser dans shell.html
   <section class="view" id="view-<module>" data-space="…" data-sub="…" hidden><!--@<fragment>--></section>
   à la place de la carte « Bientôt » (et ajouter le fragment à MODULES dans build.mjs). */
(function () {
  /* ---------- registre (données pures, testées par test/shell.test.mjs) ---------- */
  const SPACES = [
    { space: "bilan", label: "Bilan", short: "Bilan", icon: "bilan", primary: true, desc: "Où j'en suis aujourd'hui", subs: [
      { id: "vue", label: "Vue d'ensemble", module: "bilan" },
      { id: "placements", label: "Placements", module: "pilotage" },
    ] },
    { space: "diagnostic", label: "Diagnostic", short: "Diagnostic", icon: "diagnostic", primary: true, desc: "Est-ce que ma situation est saine ?", subs: [
      { id: "sante", label: "Santé", module: "sante" },
      { id: "risque", label: "Profil de risque", module: "risque-view" },
      { id: "rang", label: "Rang parmi les Français", module: "toise" },
    ] },
    { space: "decisions", label: "Décisions", short: "Décisions", icon: "decisions", primary: true, desc: "Que se passe-t-il si… ?", subs: [
      { id: "acheter", label: "Acheter ou louer", module: "simu" },
      { id: "autres", label: "Autres simulations", module: null },
    ] },
    { space: "avenir", label: "Avenir", short: "Avenir", icon: "avenir", primary: true, desc: "Où je vais : budget, objectifs et projections", subs: [
      { id: "plan", label: "Budget et objectifs", module: "plan" },
      { id: "projections", label: "Projections", module: null },
    ] },
    { space: "recos", label: "Recommandations", short: "Actions", icon: "recos", primary: true, desc: "Que faire maintenant ?", subs: [
      { id: "actions", label: "Actions", module: "actions" },
      { id: "fiches", label: "Fiches", module: "fiches-view" },
    ] },
    { space: "profil", label: "Profil et données", short: "Profil", icon: "profil", primary: false, desc: "Foyer, revenus, biens, crédits et règles", subs: [
      { id: "donnees", label: "Données", module: "profil" },
      { id: "regles", label: "Règles", module: "regles" },
      { id: "claude", label: "Avec Claude", module: "claude-guide" },
      { id: "memoire", label: "Mémoire de l'agent", module: "memoire-view" },
      { id: "propositions", label: "Propositions", module: "propositions" },
    ] },
  ];
  /* Anciens identifiants d'onglet (App.go("plan"), data-goto-tab="profil"…) et anciens hash. */
  const LEGACY_TABS = { pilotage: "bilan/placements", toise: "diagnostic/rang", simu: "decisions/acheter", plan: "avenir/plan", profil: "profil/donnees" };
  const LEGACY_HASHES = {
    "#pilotage": "bilan/placements",
    "#position": "diagnostic/rang", "#foyer": "diagnostic/rang", "#salaire": "diagnostic/rang", "#patrimoine": "diagnostic/rang", "#emprunt": "diagnostic/rang",
    "#acheter": "decisions/acheter", "#simulateur": "decisions/acheter", "#theorie": "decisions/acheter", "#explication": "decisions/acheter",
    "#plan": "avenir/plan", "#budget": "avenir/plan", "#objectifs": "avenir/plan",
    "#profil": "profil/donnees",
  };
  const DEFAULT_ROUTE = "bilan/vue";

  const spaceOf = id => SPACES.find(s => s.space === id) || null;
  const subOf = (space, sub) => { const sp = spaceOf(space); return sp ? sp.subs.find(x => x.id === sub) || null : null; };
  /* « espace », « espace/sous-vue » ou ancien onglet → { space, sub } ; sous-vue par défaut : dernière visitée, sinon la première. */
  function resolve(target, sub, lastSubs) {
    if (target == null) return null;
    let t = String(target).replace(/^#/, "");
    if (!sub && LEGACY_TABS[t]) t = LEGACY_TABS[t];
    let [space, s] = t.split("/");
    if (sub) s = sub;
    const sp = spaceOf(space);
    if (!sp) return null;
    if (!subOf(space, s)) s = lastSubs && subOf(space, lastSubs[space]) ? lastSubs[space] : sp.subs[0].id;
    return { space, sub: s };
  }
  /* Hash d'URL → { space, sub, legacy } (legacy : le hash n'est pas sous forme canonique). */
  function resolveHash(hash, lastSubs) {
    if (!hash || hash === "#") return null;
    if (LEGACY_HASHES[hash]) return Object.assign(resolve(LEGACY_HASHES[hash]), { legacy: true });
    const r = resolve(hash, null, lastSubs);
    return r ? Object.assign(r, { legacy: hash !== "#" + r.space + "/" + r.sub }) : null;
  }
  const routeOfModule = name => { for (const sp of SPACES) for (const s of sp.subs) if (s.module === name) return { space: sp.space, sub: s.id }; return null; };

  /* ---------- navigateur ---------- */
  function browser() {
    const ICONS = {
      compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
      bilan: '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>',
      diagnostic: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
      decisions: '<path d="M12 4v16M8 20h8M5 8h14M5 8l-2.5 6a2.5 2.5 0 0 0 5 0zM19 8l-2.5 6a2.5 2.5 0 0 0 5 0z"/>',
      avenir: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
      recos: '<path d="M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4 18l1.2 1.2L7.5 17"/>',
      profil: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>',
      compte: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    };
    const svg = (k, cls) => '<svg class="' + (cls || "ico") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[k] + "</svg>";
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const mods = {};
    const mounted = new Set();
    const lastSubs = {};
    let route = null;
    const key = r => r.space + "/" + r.sub;
    const panelOf = r => document.querySelector('section.view[data-space="' + r.space + '"][data-sub="' + r.sub + '"]');
    const isActive = name => { const r = routeOfModule(name); return !!(r && r.space === route.space && r.sub === route.sub); };

    /* Route de départ : hash (nouveau ou ancien) > dernière route mémorisée > Bilan. */
    try { const saved = resolve(localStorage.getItem("app-route")); if (saved) { route = saved; lastSubs[saved.space] = saved.sub; } } catch (e) {}
    const fromHash = resolveHash(location.hash, lastSubs);
    if (fromHash) route = { space: fromHash.space, sub: fromHash.sub };
    if (!route) route = resolve(DEFAULT_ROUTE);
    lastSubs[route.space] = route.sub;

    const App = {
      register(name, m) { mods[name] = m; },
      /* Module de la sous-vue active (compatibilité) ; App.route() donne { space, sub }. */
      active: () => { const s = subOf(route.space, route.sub); return s && s.module; },
      route: () => ({ space: route.space, sub: route.sub }),
      spaces: () => SPACES,
      /* App.go("bilan"), App.go("bilan", "placements"), App.go("bilan/placements") ou ancien onglet App.go("plan"). */
      go(target, sub) { const r = resolve(target, sub, lastSubs); if (r) navigate(r, { push: true, scroll: true }); },
    };
    window.App = App;
    /* Les modules chargés avant app.js ont mis leur enregistrement en attente. */
    (window.__pending || []).forEach(reg => reg());
    window.__pending = [];

    function navigate(r, o) {
      o = o || {};
      const changed = key(r) !== key(route);
      route = r;
      lastSubs[r.space] = r.sub;
      try { localStorage.setItem("app-route", key(r)); } catch (e) {}
      if (o.push && changed && location.hash !== "#" + key(r)) history.pushState(null, "", "#" + key(r));
      document.querySelectorAll("section.view[data-space]").forEach(v => { v.hidden = !(v.dataset.space === r.space && v.dataset.sub === r.sub); });
      renderChrome();
      const s = subOf(r.space, r.sub); const m = s && s.module && mounted.has(s.module) ? mods[s.module] : null;
      if (m && m.show) try { m.show(); } catch (e) { console.error(s.module, e); }
      refreshHeadlines();
      if (o.scroll && changed && window.scrollY > 0) window.scrollTo({ top: 0 });
    }

    const hrefOf = space => "#" + space + "/" + (lastSubs[space] || spaceOf(space).subs[0].id);
    function navItem(sp, bar) {
      return '<a class="' + (bar ? "bb-item" : "nav-item") + '" href="' + hrefOf(sp.space) + '" data-nav="' + sp.space + '">' +
        (bar ? '<span class="bb-ico">' + svg(sp.icon) + "</span>" : svg(sp.icon)) +
        '<span class="nl">' + esc(bar ? sp.short : sp.label) + "</span>" +
        (sp.space === "recos" ? '<span class="pill-count" data-recos-count hidden></span>' : "") +
        (sp.space === "profil" ? '<span class="pill-count" data-prop-count hidden></span>' : "") + "</a>";
    }
    function renderNav() {
      const prim = SPACES.filter(s => s.primary), rest = SPACES.filter(s => !s.primary);
      $("sideNav").innerHTML = prim.map(s => navItem(s)).join("") + '<div class="side-sep" role="separator"></div>' + rest.map(s => navItem(s)).join("");
      $("bottomBar").innerHTML = prim.map(s => navItem(s, true)).join("");
    }
    function renderChrome() {
      const sp = spaceOf(route.space);
      document.querySelectorAll("[data-nav]").forEach(a => {
        if (a.dataset.nav === route.space) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
        a.setAttribute("href", hrefOf(a.dataset.nav));
      });
      const pb = $("profileBtn"); if (route.space === "profil") pb.setAttribute("aria-current", "page"); else pb.removeAttribute("aria-current");
      $("spaceTitle").textContent = sp.label;
      $("spaceDesc").textContent = sp.desc;
      const tabs = $("subTabs");
      tabs.setAttribute("aria-label", "Sous-vues : " + sp.label);
      tabs.hidden = sp.subs.length < 2;
      tabs.innerHTML = sp.subs.map(s => {
        const on = s.id === route.sub; const p = panelOf({ space: sp.space, sub: s.id });
        return '<button type="button" role="tab" id="subtab-' + sp.space + "-" + s.id + '"' + (p && p.id ? ' aria-controls="' + p.id + '"' : "") +
          ' aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-sub="' + s.id + '">' + esc(s.label) + "</button>";
      }).join("");
      /* Sous-onglets plus larges que l'écran (mobile) : l'onglet actif reste visible. */
      const sel = tabs.querySelector('[aria-selected="true"]');
      if (sel && tabs.scrollWidth > tabs.clientWidth) {
        const a = tabs.getBoundingClientRect(), b = sel.getBoundingClientRect();
        tabs.scrollLeft += b.left - a.left - (a.width - b.width) / 2;
      }
    }

    /* Nombre entier renvoyé par headline() du module branché sur espace/sous-vue ; NaN sinon. */
    function countOf(space, sub) {
      const s = subOf(space, sub); const m = s && s.module ? mods[s.module] : null;
      let v = null;
      if (m && m.headline) try { v = m.headline(); } catch (e) { v = null; }
      return v == null || !/^\s*\d+\s*$/.test(String(v)) ? NaN : parseInt(v, 10);
    }
    /* Pastilles : Recommandations (actions à traiter) et Profil et données (propositions de Claude en attente) ;
       bandeau global #propBanner « Claude propose N changements », partout sauf sur la vue Propositions. */
    function refreshHeadlines() {
      const pill = (sel, n, label) => {
        const show = Number.isFinite(n) && n > 0;
        document.querySelectorAll(sel).forEach(el => {
          el.hidden = !show; el.textContent = show ? String(n) : "";
          if (show) el.setAttribute("aria-label", label(n)); else el.removeAttribute("aria-label");
        });
        return show;
      };
      pill("[data-recos-count]", countOf("recos", "actions"), n => n + " action" + (n > 1 ? "s" : "") + " à traiter");
      const np = countOf("profil", "propositions");
      const anyProp = pill("[data-prop-count]", np, n => n + " proposition" + (n > 1 ? "s" : "") + " de Claude à examiner");
      const b = $("propBanner");
      if (b) {
        b.hidden = !anyProp || (route.space === "profil" && route.sub === "propositions");
        const t = anyProp ? "Claude propose " + np + " changement" + (np > 1 ? "s" : "") + " à valider" : "";
        const el = $("propBannerTxt"); if (el && el.textContent !== t) el.textContent = t;
      }
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
      veille(S);
    }
    /* Sélecteur de périmètre (barre latérale et en-tête mobile) : « Foyer » + une entrée par personne ; masqué s'il n'y a qu'une personne. */
    function scopeSeg(S) {
      const ppl = Array.isArray(S.people) ? S.people : [];
      const items = [{ id: "foyer", nom: "Foyer" }].concat(ppl.map((p, i) => ({ id: p.id, nom: String(p.nom || "").trim() || (i ? "Conjoint(e)" : "Moi") })));
      const sig = JSON.stringify(items);
      document.querySelectorAll(".scope-seg").forEach(seg => {
        if (seg.dataset.sig !== sig) {
          seg.innerHTML = items.map(x => '<button type="button" data-scope="' + esc(x.id) + '">' + esc(x.nom) + "</button>").join("");
          seg.dataset.sig = sig;
        }
        seg.hidden = ppl.length < 2;
        seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.scope === S.scope)));
      });
    }
    /* État de la veille : S.status.veille.lastReport (date ISO ou horodatage) ; alerte au-delà de 8 jours. */
    function veille(S) {
      const el = $("veilleLine");
      const lr = S.status && S.status.veille && S.status.veille.lastReport;
      const t = lr ? new Date(lr).getTime() : NaN;
      if (!Number.isFinite(t)) { el.textContent = "Veille : jamais lancée"; el.classList.remove("warn"); return; }
      const d = Math.max(0, Math.floor((Date.now() - t) / 864e5));
      el.textContent = d === 0 ? "Veille : aujourd'hui" : "Veille : il y a " + d + " j";
      el.classList.toggle("warn", d > 8);
    }

    /* Précédent / suivant, hash saisi à la main ou lien <a href="#…"> : on suit le hash (forme ancienne réécrite). */
    function onHash() {
      const r = resolveHash(location.hash, lastSubs);
      if (!r) return;
      if (r.legacy) history.replaceState(null, "", "#" + key(r));
      if (key(r) !== key(route)) navigate({ space: r.space, sub: r.sub }, {});
    }

    const ANON_KEY = "boussole.anonBanner.masque";
    function anonAccount(session) {
      const anon = !!(session && session.user && session.user.is_anonymous);
      let masked = false;
      try { masked = sessionStorage.getItem(ANON_KEY) === "1"; } catch (e) { /* stockage indisponible : bandeau affiché */ }
      const b = $("anonBanner");
      if (b) {
        b.hidden = !anon || masked;
        const x = $("anonBannerClose");
        if (x && !x.dataset.bound) {
          x.dataset.bound = "1";
          x.addEventListener("click", () => { b.hidden = true; try { sessionStorage.setItem(ANON_KEY, "1"); } catch (e) { /* rien */ } });
        }
      }
      const link = $("accountLink"), linkM = $("accountLinkM");
      const label = anon ? "Sécuriser mon compte" : "Mon compte", href = anon ? "compte.html#securiser" : "compte.html";
      if (link) { link.textContent = label; link.href = href; }
      if (linkM) { linkM.href = href; linkM.setAttribute("aria-label", label); linkM.title = label; }
    }

    function boot() {
      document.querySelectorAll("[data-brand-icon]").forEach(el => { el.innerHTML = svg("compass", "brand-ico"); });
      $("profileBtn").innerHTML = svg("profil");
      $("accountLinkM").innerHTML = svg("compte");
      renderNav();
      const tabs = $("subTabs");
      tabs.addEventListener("click", e => { const b = e.target.closest("[data-sub]"); if (b) App.go(route.space, b.dataset.sub); });
      tabs.addEventListener("keydown", e => {
        const subs = spaceOf(route.space).subs.map(s => s.id); let i = subs.indexOf(route.sub);
        if (e.key === "ArrowRight") i = (i + 1) % subs.length; else if (e.key === "ArrowLeft") i = (i + subs.length - 1) % subs.length;
        else if (e.key === "Home") i = 0; else if (e.key === "End") i = subs.length - 1; else return;
        e.preventDefault();
        App.go(route.space, subs[i]);
        const b = $("subtab-" + route.space + "-" + route.sub); if (b) b.focus();
      });
      document.addEventListener("click", e => {
        const sc = e.target.closest(".scope-seg [data-scope]"); if (sc) { Store.setScope(sc.dataset.scope); return; }
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const n = e.target.closest("[data-nav]"); if (n) { e.preventDefault(); App.go(n.dataset.nav); return; }
        const t = e.target.closest("[data-goto-tab]"); if (t) { e.preventDefault(); App.go(t.dataset.gotoTab); return; }
        /* [data-goto] sert aussi aux sous-onglets internes de la Toise (« rev »…) : seules les routes « espace/sous-vue » sont traitées ici. */
        const g = e.target.closest("[data-goto]"); if (g && g.dataset.goto.includes("/") && resolve(g.dataset.goto)) { e.preventDefault(); App.go(g.dataset.goto); }
      });
      /* Montage de chaque module enregistré dont le conteneur #view-<module> existe. Le hash d'origine est encore
         intact à ce stade : la Toise (#foyer…) et le Simulateur (#theorie…) le lisent pour leur sous-onglet. */
      Object.keys(mods).forEach(k => {
        const m = mods[k]; const root = $("view-" + k); if (!root) return;
        try { if (m.mount) m.mount(root); mounted.add(k); } catch (e) { console.error(k, e); }
      });
      const demo = Store.mode === "demo";
      $("demoBanner").hidden = !demo;
      $("sideDemo").hidden = !demo;
      $("accountLink").hidden = demo;
      $("accountLinkM").hidden = demo;
      /* Compte anonyme (« Commencer sans e-mail ») : bandeau #anonBanner (masquable pour la session de l'onglet)
         et « Sécuriser mon compte » à la place de « Mon compte ». Seulement en mode Supabase ; la démo ne change pas. */
      if (!demo && window.Auth && typeof Auth.session === "function") {
        Auth.session().then(anonAccount, () => {});
        if (typeof Auth.onChange === "function") Auth.onChange((ev, s) => { if (s) anonAccount(s); });
      }
      let onboardingShown = false;
      /* Premiers pas en formulaires (« Je n'utilise pas d'assistant ») : écriture du profil, des placements, puis onboarding fait. */
      const formulaires = () => ({
        onSave: async (patch, rows) => {
          await Store.db.doc("profil/main").update(patch);
          if (rows && rows.length) await Store.db.collection("positions").addMany(rows);
          await Store.markOnboarded();
        },
        onSkip: () => Store.markOnboarded().catch(e => console.warn("Boussole : premiers pas non marqués", e)),
      });
      /* Accueil (accueil.js) : bienvenue, choix de l'assistant, connexion de Claude, entretien, suivi.
         Aussi rouvert depuis Avec Claude (« Revoir l'accueil ») par App.accueil({ etape: 1 }). */
      App.accueil = o => {
        if (!window.Accueil) return false;
        Accueil.open(Object.assign({ formulaires: formulaires() }, o || {}));
        return true;
      };
      /* ?accueil dans l'URL : force l'ouverture (démo comprise) pour tester le parcours. */
      const forceAccueil = new URLSearchParams(location.search).has("accueil");
      /* Une fois par chargement, pour un compte réel qui n'a pas terminé l'onboarding (sauf « Reprendre plus tard »
         dans cet onglet). Sans accueil.js, repli sur les premiers pas en formulaires. */
      function maybeOnboard(S) {
        if (onboardingShown || !S.ready) return;
        if (forceAccueil && window.Accueil) { onboardingShown = true; Accueil.open({ formulaires: formulaires(), etape: 1 }); return; }
        if (demo || !S.dbOk || S.onboardingDone) return;
        onboardingShown = true;
        if (window.Accueil) { if (!Accueil.reporte()) Accueil.open({ formulaires: formulaires() }); }
        else if (window.Onboarding) Onboarding.open(Object.assign({ profil: S.profil }, formulaires()));
      }
      Store.on(S => {
        maybeOnboard(S);
        header(S);
        mounted.forEach(k => { const m = mods[k]; if (m.update) try { m.update(S, isActive(k)); } catch (e) { console.error(k, e); } });
        refreshHeadlines();
      });
      navigate(route, {});
      /* Après le montage : l'URL prend la forme canonique, sans entrée d'historique supplémentaire. */
      if (location.hash !== "#" + key(route)) history.replaceState(null, "", "#" + key(route));
      window.addEventListener("hashchange", onHash);
      window.addEventListener("popstate", onHash);
      header(Store.get());
      Store.emit();
    }
    App.refreshHeadlines = refreshHeadlines;
    App.anonAccount = anonAccount; // bandeau compte anonyme (appelé au démarrage ; exposé pour les vérifications en console)
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
  }

  if (typeof document !== "undefined") browser();
  if (typeof module === "object" && module.exports) module.exports = { SPACES, LEGACY_TABS, LEGACY_HASHES, DEFAULT_ROUTE, resolve, resolveHash, routeOfModule };
})();
