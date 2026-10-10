/* Authentification Supabase (supabase-js v2, build UMD chargé par build.mjs juste après config.js).
   window.Auth = { client, emails, session(), signInPassword(email, pw), signUp(email, pw), signInMagic(email),
                   signInAnon(), isAnonymous(session), secureAccount(email, pw), passwordProblem(pw), weakPasswordText(e),
                   signInGoogle(), signOut(), onChange(fn), requireSession({ demoOk }) , urls }
   Mode sans e-mail (BOUSSOLE.emails !== true, décision du 2026-10-10) : Supabase n'envoie aucun e-mail. Inscription
   sans confirmation (session immédiate), compte anonyme « Commencer sans e-mail » (signInAnon), sécurisé ensuite par
   secureAccount (e-mail + mot de passe posés sans courrier). signInMagic reste disponible mais n'est pas proposé.
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
  const EMAILS = B.emails === true;
  const CONFIRM_REQUIRED = "Le serveur demande de confirmer cette adresse par e-mail, mais Boussole n'envoie pas d'e-mail pour le moment. " +
    "Votre compte reste utilisable sur ce navigateur. Écrivez à stephane@ceres.agency pour finaliser l'ajout de l'adresse.";

  // Règles de mot de passe du projet (supabase/config.toml) : 8 caractères minimum, lettres et chiffres.
  function passwordProblem(pw) {
    const p = String(pw || "");
    if (p.length < 8) return "Mot de passe trop court : 8 caractères minimum, avec des lettres et des chiffres.";
    if (!/[A-Za-zÀ-ÿ]/.test(p) || !/[0-9]/.test(p)) return "Le mot de passe doit contenir des lettres et des chiffres.";
    return null;
  }
  // Erreur « weak_password » de Supabase (AuthWeakPasswordError, reasons : length, characters, pwned) → français ; null sinon.
  function weakPasswordText(e) {
    const c = (e && e.cause) || e || {};
    const code = String((e && e.code) || c.code || "");
    const m = String((e && e.message) || c.message || "");
    if (code !== "weak_password" && !/password should|weak password|password is known/i.test(m)) return null;
    const r = Array.isArray(c.reasons) ? c.reasons : Array.isArray(e && e.reasons) ? e.reasons : [];
    if (r.includes("pwned") || /known to be weak|pwned|leaked/i.test(m)) return "Ce mot de passe figure dans des fuites de données connues. Choisissez-en un autre.";
    if (r.includes("length") || /at least \d+ characters/i.test(m)) return "Mot de passe trop court : 8 caractères minimum, avec des lettres et des chiffres.";
    if (r.includes("characters") || /one character of each/i.test(m)) return "Le mot de passe doit contenir des lettres et des chiffres.";
    return "Mot de passe trop faible : 8 caractères minimum, avec des lettres et des chiffres.";
  }

  const Auth = {
    client,
    isDemo,
    emails: EMAILS,
    urls: { app: () => page("app.html"), home: () => page("index.html"), connexion: () => page("index.html") + "#connexion" },
    async session() {
      if (!client) return null;
      try { const { data } = await client.auth.getSession(); return (data && data.session) || null; } catch (e) { return null; }
    },
    signInPassword: (email, password) => run(() => client.auth.signInWithPassword({ email, password })),
    signUp: (email, password) => run(() => client.auth.signUp({ email, password, options: { emailRedirectTo: page("app.html") } })),
    // Lien magique : seulement si BOUSSOLE.emails === true (aucun bouton ne l'appelle sinon).
    signInMagic: email => run(() => client.auth.signInWithOtp({ email, options: { emailRedirectTo: page("app.html") } })),
    // « Commencer sans e-mail » : compte anonyme, session immédiate, données liées à ce navigateur.
    signInAnon: () => run(() => client.auth.signInAnonymously()),
    isAnonymous: s => !!(s && s.user && s.user.is_anonymous),
    passwordProblem,
    weakPasswordText,
    // Compte anonyme → compte permanent. Confirmations coupées : l'adresse est posée sans courrier. Si le serveur
    // laisse l'adresse « en attente » (new_email), c'est qu'il exige une confirmation : on le dit en clair.
    async secureAccount(email, password) {
      need();
      let res = await client.auth.updateUser({ email, password });
      // Certaines versions refusent un mot de passe sur un compte encore anonyme : adresse d'abord, puis mot de passe.
      if (res.error && /anonymous/i.test(String(res.error.message || ""))) {
        res = await client.auth.updateUser({ email });
        if (!res.error) res = await client.auth.updateUser({ password });
      }
      if (res.error) throw asErr(res.error);
      const u = res.data && res.data.user;
      if (!u || String(u.email || "").toLowerCase() !== String(email).toLowerCase()) {
        throw Object.assign(new Error(CONFIRM_REQUIRED), { code: "email_confirmation_required" });
      }
      try { await client.auth.refreshSession(); } catch (e) { /* le jeton se renouvellera seul */ }
      return res.data;
    },
    CONFIRM_REQUIRED,
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
