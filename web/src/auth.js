/* Authentification Supabase (supabase-js v2, build UMD chargé par build.mjs juste après config.js).
   window.Auth = { client, session(), signInPassword(email, pw), signUp(email, pw), signInMagic(email),
                   signInGoogle(), signOut(), onChange(fn), requireSession({ demoOk }) , urls }
   Un seul client GoTrue par page : store-supabase.js réutilise Auth.client. En démo (?demo ou
   BOUSSOLE_MODE = "demo") aucun client n'est créé et requireSession() résout null.
   Les URL de redirection sont calculées depuis location : l'app fonctionne sous /boussole/ comme à la racine. */
(function () {
  const B = window.BOUSSOLE || {};
  const isDemo = window.BOUSSOLE_MODE === "demo" || /[?&]demo(?:=|&|$)/.test(String((window.location && window.location.search) || ""));

  // Page voisine (index.html, app.html…) dans le dossier courant, sans query ni hash.
  const page = name => { const u = new URL(location.href); u.search = ""; u.hash = ""; return new URL((B.base || "./") + name, u).href; };

  const ready = !isDemo && !!(window.supabase && window.supabase.createClient && B.supabaseUrl && B.supabaseKey);
  const client = ready ? window.supabase.createClient(B.supabaseUrl, B.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

  const asErr = e => Object.assign(new Error((e && e.message) || "Erreur d'authentification"), { code: e && (e.code || (e.status != null ? String(e.status) : null)) || "network", cause: e });
  const need = () => { if (!client) throw Object.assign(new Error(isDemo ? "Mode démo : pas de compte." : "Supabase indisponible (script non chargé ou config.js absent)."), { code: "network" }); };
  const run = async fn => { need(); const { data, error } = await fn(); if (error) throw asErr(error); return data; };

  const Auth = {
    client,
    isDemo,
    urls: { app: () => page("app.html"), home: () => page("index.html"), connexion: () => page("index.html") + "#connexion" },
    async session() {
      if (!client) return null;
      try { const { data } = await client.auth.getSession(); return (data && data.session) || null; } catch (e) { return null; }
    },
    signInPassword: (email, password) => run(() => client.auth.signInWithPassword({ email, password })),
    signUp: (email, password) => run(() => client.auth.signUp({ email, password, options: { emailRedirectTo: page("app.html") } })),
    signInMagic: email => run(() => client.auth.signInWithOtp({ email, options: { emailRedirectTo: page("app.html") } })),
    signInGoogle: () => run(() => client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: page("app.html") } })),
    async signOut() { if (!client) return; const { error } = await client.auth.signOut(); if (error) throw asErr(error); },
    onChange(fn) {
      if (!client) return () => {};
      const { data } = client.auth.onAuthStateChange((event, session) => { try { fn(event, session || null); } catch (e) { console.error(e); } });
      return () => data.subscription.unsubscribe();
    },
    // Garde d'app.html : en démo → null ; sinon la session, ou redirection vers index.html#connexion.
    async requireSession(opts) {
      const o = opts || {};
      if (isDemo && o.demoOk !== false) return null;
      const s = await Auth.session();
      if (s) return s;
      location.replace(Auth.urls.connexion());
      return null;
    },
  };
  window.Auth = Auth;
})();
