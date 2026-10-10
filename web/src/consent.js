/* Page de consentement OAuth 2.1 (connecteurs MCP) : web/oauth/consent.html.
   Supabase Auth redirige ici avec ?authorization_id=… ; on exige une session (connexion sur place si besoin),
   on affiche le client et les droits demandés, puis on approuve ou refuse et on renvoie vers le client.
   API : supabase.auth.oauth.getAuthorizationDetails / approveAuthorization / denyAuthorization (supabase-js ≥ 2.8x).
   Sans service d'e-mail (BOUSSOLE.emails !== true) : connexion par mot de passe uniquement (pas de lien magique).
   Un compte anonyme (« Commencer sans e-mail ») ne peut pas autoriser de connecteur : il doit d'abord être sécurisé. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const cfg = window.BOUSSOLE || {};
  const authId = new URLSearchParams(location.search).get("authorization_id");
  const EMAILS = cfg.emails === true;
  const isAnon = session => !!(session && session.user && session.user.is_anonymous);
  let sb = null, state = "loading", busy = false, lastRetry = null, signingIn = false;

  /* ---------- états ---------- */
  function show(name) {
    state = name;
    document.querySelectorAll("[data-state]").forEach(s => { s.hidden = s.dataset.state !== name; });
  }
  function loading(text) { $("loadingText").textContent = text || "Vérification de la demande…"; show("loading"); }
  function fail(title, text, retry) {
    $("errTitle").textContent = title;
    $("errText").textContent = text;
    lastRetry = retry || null;
    $("retryBtn").hidden = !retry;
    show("error");
  }
  function note(el, text, kind) {
    el.textContent = text || "";
    el.className = "msg " + (kind || "err");
    el.hidden = !text;
  }
  const RELAUNCH = "Relancez la connexion de Boussole depuis votre assistant (Claude ou autre).";

  /* ---------- erreurs Supabase → français ---------- */
  function isNetwork(e) {
    return !!e && (e.name === "AuthRetryableFetchError" || e.status === 0 || /fetch|network|réseau/i.test(e.message || ""));
  }
  function isSessionError(e) {
    return !!e && (e.name === "AuthSessionMissingError" || e.code === "session_not_found" || e.code === "bad_jwt" || e.status === 401);
  }
  function explainOAuth(e) {
    if (isNetwork(e)) return ["Serveur injoignable", "Impossible de joindre Boussole. Vérifiez votre connexion puis réessayez.", true];
    if (e.code === "feature_disabled") return ["Connecteur pas encore ouvert", "Le serveur d'autorisation de Boussole n'est pas encore activé. Réessayez plus tard.", false];
    if (e.status === 404 || e.code === "oauth_authorization_not_found" || /not found|expired|expir/i.test(e.message || ""))
      return ["Demande expirée ou introuvable", "Cette demande d'autorisation n'existe plus (elle expire au bout de quelques minutes ou a déjà été traitée). " + RELAUNCH, false];
    if (e.status === 400 || e.status === 422)
      return ["Demande invalide", "La demande d'autorisation n'est pas valide ou a déjà été utilisée. " + RELAUNCH, false];
    if (e.status === 403)
      return ["Accès refusé", "Ce compte ne peut pas répondre à cette demande. Changez de compte ou " + RELAUNCH.charAt(0).toLowerCase() + RELAUNCH.slice(1), false];
    if (e.status === 429) return ["Trop de tentatives", "Patientez une minute puis réessayez.", true];
    return ["Une erreur est survenue", "Le serveur a répondu : « " + (e.message || "erreur inconnue") + " ». Réessayez ; si le problème continue, " + RELAUNCH.charAt(0).toLowerCase() + RELAUNCH.slice(1), true];
  }
  function explainSignin(e) {
    if (isNetwork(e)) return "Impossible de joindre Boussole. Vérifiez votre connexion puis réessayez.";
    switch (e.code) {
      case "invalid_credentials": return "E-mail ou mot de passe incorrect.";
      case "email_not_confirmed": return EMAILS
        ? "Adresse e-mail pas encore confirmée : ouvrez le lien reçu lors de l'inscription."
        : "Adresse e-mail pas confirmée, et Boussole n'envoie pas d'e-mail pour le moment. Écrivez à stephane@ceres.agency.";
      case "otp_disabled":
      case "signup_disabled":
      case "user_not_found": return "Aucun compte Boussole n'utilise cette adresse.";
      case "over_request_rate_limit":
      case "over_email_send_rate_limit": return "Trop de tentatives : patientez une minute avant de réessayer.";
      case "email_address_invalid": return "Adresse e-mail invalide.";
      case "user_banned": return "Ce compte est suspendu.";
    }
    if (/invalid login credentials/i.test(e.message || "")) return "E-mail ou mot de passe incorrect.";
    if (/signups not allowed/i.test(e.message || "")) return "Aucun compte Boussole n'utilise cette adresse.";
    return "Connexion impossible : " + (e.message || "erreur inconnue") + ".";
  }

  /* ---------- droits demandés ---------- */
  const SCOPES = {
    email: "connaître votre adresse e-mail",
    profile: "connaître votre nom de profil",
    openid: "vous identifier auprès de l'application (OpenID)",
    phone: "connaître votre numéro de téléphone",
  };
  const TICK = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.5 10.5 8 14l7.5-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function perm(text) {
    const li = document.createElement("li");
    li.className = "yes";
    li.innerHTML = TICK;
    const span = document.createElement("span");
    span.textContent = text;
    li.appendChild(span);
    return li;
  }
  function host(url) {
    try { return new URL(url).host || url; } catch (_) { return url || "inconnu"; }
  }

  /* ---------- affichage du consentement ---------- */
  function renderConsent(d, session) {
    const name = (d.client && d.client.name) || "Une application";
    $("clientName").textContent = name;
    document.title = "Autoriser " + name + " · Boussole";
    $("userEmail").textContent = (d.user && d.user.email) || (session && session.user && session.user.email) || "";
    const uri = d.client && d.client.uri;
    $("clientInfo").textContent = uri ? name + " (" + host(uri) + ")" : name;
    $("redirectHost").textContent = host(d.redirect_uri);
    const ul = $("perms");
    ul.textContent = "";
    ul.appendChild(perm("lire et modifier votre profil, vos placements et vos réglages Boussole ;"));
    String(d.scope || "").split(/\s+/).filter(Boolean).forEach(s => ul.appendChild(perm((SCOPES[s] || "accès « " + s + " »") + " ;")));
    const last = ul.lastElementChild && ul.lastElementChild.querySelector("span");
    if (last) last.textContent = last.textContent.replace(/ ;$/, ".");
    note($("consentMsg"), "");
    setBusy(false);
    show("consent");
    $("approveBtn").focus({ preventScroll: true });
  }
  function redirect(url, approved) {
    if (!url) return fail("Redirection impossible", "Le serveur n'a pas renvoyé d'adresse de retour. " + RELAUNCH, false);
    $("doneTitle").textContent = approved === false ? "Accès refusé" : "Accès autorisé";
    $("doneText").textContent = "Retour vers " + host(url) + "…";
    $("doneLink").href = url;
    show("done");
    location.assign(url);
  }

  /* ---------- étapes ---------- */
  async function loadDetails() {
    loading("Vérification de la demande…");
    const { data: s } = await sb.auth.getSession();
    const session = s && s.session;
    if (!session) return showSignin();
    // Compte anonyme : pas d'autorisation de connecteur tant qu'il n'a ni e-mail ni mot de passe.
    if (isAnon(session)) return show("anon");
    let res;
    try { res = await sb.auth.oauth.getAuthorizationDetails(authId); }
    catch (e) { res = { data: null, error: e }; }
    const { data, error } = res;
    if (error) {
      if (isSessionError(error) && error.code !== "feature_disabled") {
        await sb.auth.signOut({ scope: "local" }).catch(() => {});
        return showSignin("Votre session a expiré : reconnectez-vous.");
      }
      const [t, x, retry] = explainOAuth(error);
      return fail(t, x, retry ? loadDetails : null);
    }
    if (!data) return fail("Demande introuvable", RELAUNCH, false);
    // Consentement déjà donné : Supabase renvoie directement l'adresse de retour.
    if (!("authorization_id" in data)) return redirect(data.redirect_url || data.redirect_to, true);
    renderConsent(data, session);
  }

  function showSignin(message) {
    show("signin");
    setSigninBusy(false);
    note($("signinMsg"), message || "", message ? "info" : "err");
    $("email").focus({ preventScroll: true });
  }
  function setSigninBusy(b) {
    $("signinBtn").disabled = b; $("otpBtn").disabled = b;
    $("signinBtn").textContent = b ? "Connexion…" : "Se connecter";
  }
  function setBusy(b) {
    busy = b;
    $("approveBtn").disabled = b; $("denyBtn").disabled = b; $("switchBtn").disabled = b;
  }

  async function decide(approve) {
    if (busy) return;
    if (approve) {
      const { data: s } = await sb.auth.getSession().catch(() => ({ data: null }));
      if (isAnon(s && s.session)) return show("anon");
    }
    setBusy(true);
    $(approve ? "approveBtn" : "denyBtn").textContent = approve ? "Autorisation…" : "Refus…";
    let res;
    try {
      res = approve
        ? await sb.auth.oauth.approveAuthorization(authId, { skipBrowserRedirect: true })
        : await sb.auth.oauth.denyAuthorization(authId, { skipBrowserRedirect: true });
    } catch (e) { res = { data: null, error: e }; }
    $("approveBtn").textContent = "Autoriser"; $("denyBtn").textContent = "Refuser";
    const { data, error } = res;
    if (error) {
      setBusy(false);
      if (isSessionError(error)) {
        await sb.auth.signOut({ scope: "local" }).catch(() => {});
        return showSignin("Votre session a expiré : reconnectez-vous puis validez à nouveau.");
      }
      const [t, x, retry] = explainOAuth(error);
      if (retry) return note($("consentMsg"), t + " : " + x);
      return fail(t, x, null);
    }
    redirect(data && (data.redirect_url || data.redirect_to), approve);
  }

  /* ---------- démarrage ---------- */
  function init() {
    if (!authId) {
      return fail("Lien incomplet", "Cette page s'ouvre automatiquement quand vous connectez Boussole à un assistant. Il manque l'identifiant de la demande. " + RELAUNCH, null);
    }
    if (!window.supabase || !window.supabase.createClient || !cfg.supabaseUrl || !cfg.supabaseKey) {
      return fail("Chargement incomplet", "Un composant de la page n'a pas pu être chargé (bloqueur de contenu ou réseau). Rechargez la page.", () => location.reload());
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    if (!sb.auth.oauth || typeof sb.auth.oauth.getAuthorizationDetails !== "function") {
      return fail("Version incompatible", "La bibliothèque d'authentification chargée ne gère pas l'autorisation OAuth. Rechargez la page.", () => location.reload());
    }

    // Retour d'un lien de connexion (ou connexion dans un autre onglet) : on reprend là où on en était.
    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" && state === "signin" && !signingIn) setTimeout(loadDetails, 0);
    });

    $("signinForm").addEventListener("submit", async ev => {
      ev.preventDefault();
      const email = $("email").value.trim(), password = $("password").value;
      if (!email) return note($("signinMsg"), "Indiquez votre adresse e-mail.");
      if (!password) return note($("signinMsg"), EMAILS ? "Indiquez votre mot de passe, ou recevez un lien de connexion par e-mail." : "Indiquez votre mot de passe.");
      setSigninBusy(true); note($("signinMsg"), "");
      let res;
      signingIn = true;
      try { res = await sb.auth.signInWithPassword({ email, password }); } catch (e) { res = { error: e }; }
      signingIn = false;
      if (res.error) { setSigninBusy(false); return note($("signinMsg"), explainSignin(res.error)); }
      $("password").value = "";
      loadDetails();
    });

    $("otpBox").hidden = !EMAILS;
    if (EMAILS) $("otpBtn").addEventListener("click", async () => {
      const email = $("email").value.trim();
      if (!email) { note($("signinMsg"), "Indiquez d'abord votre adresse e-mail."); return $("email").focus(); }
      setSigninBusy(true); note($("signinMsg"), "");
      let res;
      try {
        res = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split("#")[0], shouldCreateUser: false } });
      } catch (e) { res = { error: e }; }
      setSigninBusy(false);
      if (res.error) return note($("signinMsg"), explainSignin(res.error));
      note($("signinMsg"), "Lien envoyé à " + email + ". Ouvrez-le sur cet appareil : vous reviendrez ici pour valider l'accès. La demande expire au bout de quelques minutes.", "ok");
    });

    $("approveBtn").addEventListener("click", () => decide(true));
    $("denyBtn").addEventListener("click", () => decide(false));
    $("switchBtn").addEventListener("click", async () => {
      await sb.auth.signOut({ scope: "local" }).catch(() => {});
      showSignin();
    });
    $("retryBtn").addEventListener("click", () => { if (lastRetry) lastRetry(); });

    loadDetails().catch(e => {
      const [t, x, retry] = explainOAuth(e || {});
      fail(t, x, retry ? loadDetails : null);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
