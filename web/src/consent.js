/* Page de consentement OAuth 2.1 (connecteurs MCP) : web/oauth/consent.html.
   Supabase Auth redirige ici avec ?authorization_id=… ; on exige une session (connexion sur place si besoin),
   on affiche le client et les droits demandés, puis on approuve ou refuse et on renvoie vers le client.
   API : supabase.auth.oauth.getAuthorizationDetails / approveAuthorization / denyAuthorization (supabase-js ≥ 2.8x).
   Sans service d'e-mail (BOUSSOLE.emails !== true) : connexion par mot de passe uniquement (pas de lien magique).
   Un compte anonyme (« Commencer sans e-mail ») ne peut pas autoriser de connecteur : il doit d'abord être sécurisé.
   Double authentification (SEC2, mfa.js) : si le compte a un facteur vérifié et que la session est encore aal1, l'état « mfa » demande le code
   avant d'afficher la demande, et de nouveau avant d'approuver (session retombée à aal1) : seule une session aal2 approuve (et enregistre
   l'autorisation du connecteur, voir plus bas). Sans double authentification, la demande reste possible mais un avertissement dit que
   le connecteur ne lira pas les comptes bancaires.
   Constat de la préproduction (SEC5 § 3.12) : le jeton OAuth émis est toujours aal1, quel que soit le niveau de la session qui approuve.
   D'où la migration 0033 : avec un facteur vérifié, « Autoriser » appelle d'abord la RPC autoriser_connecteur(authorization_id) avec la
   session aal2 (la base vérifie l'aal2 et lit le client dans la demande de GoTrue), puis approuve ; sans autorisation enregistrée, rien
   n'est approuvé. Même chose quand le consentement est déjà mémorisé (Supabase renvoie directement le retour) : code, autorisation, puis
   redirection. Le connecteur lie ensuite l'autorisation à la session OAuth née de l'échange du code (lier_connecteur). Durée : 90 jours.
   Code frais : la base exige un code de moins de 10 minutes (revendication amr) ; la page le redemande au-delà de 8 minutes, même en
   aal2, et de nouveau si la base répond BOU02. Client non déclaré par Boussole (inscription dynamique) : BOU01, refus net. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const cfg = window.BOUSSOLE || {};
  const authId = new URLSearchParams(location.search).get("authorization_id");
  const EMAILS = cfg.emails === true;
  const isAnon = session => !!(session && session.user && session.user.is_anonymous);
  let sb = null, mfaApi = null, state = "loading", busy = false, lastRetry = null, signingIn = false;

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
  const RELAUNCH = "Relance la connexion de Boussole depuis Claude.";
  /* Durée d'une autorisation de connecteur (autoriser_connecteur, migration 0033 ; un test vérifie l'égalité). */
  const DUREE_AUTORISATION_JOURS = 90;
  /* La base exige un code de moins de 10 minutes pour autoriser un connecteur (0033) : au-delà de 8 minutes, la page le redemande. */
  const FRAICHEUR_CODE_S = 480;
  let accord = null; // réponse d'autoriser_connecteur : { id, client_id, client_nom, accorde_le, expire_le, duree_jours }
  function frDate(d) {
    try { return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }); } catch (_) { return ""; }
  }

  /* ---------- erreurs Supabase → français ---------- */
  function isNetwork(e) {
    return !!e && (e.name === "AuthRetryableFetchError" || e.status === 0 || /fetch|network|réseau/i.test(e.message || ""));
  }
  function isSessionError(e) {
    return !!e && (e.name === "AuthSessionMissingError" || e.code === "session_not_found" || e.code === "bad_jwt" || e.status === 401);
  }
  function explainOAuth(e) {
    if (isNetwork(e)) return ["Serveur injoignable", "Impossible de joindre Boussole. Vérifie ta connexion puis réessaie.", true];
    if (e.code === "feature_disabled") return ["Connecteur pas encore ouvert", "Le serveur d'autorisation de Boussole n'est pas encore activé. Réessaie plus tard.", false];
    if (e.status === 404 || e.code === "oauth_authorization_not_found" || /not found|expired|expir/i.test(e.message || ""))
      return ["Demande expirée ou introuvable", "Cette demande d'autorisation n'existe plus (elle expire au bout de quelques minutes ou a déjà été traitée). " + RELAUNCH, false];
    if (e.status === 400 || e.status === 422)
      return ["Demande invalide", "La demande d'autorisation n'est pas valide ou a déjà été utilisée. " + RELAUNCH, false];
    if (e.status === 403)
      return ["Accès refusé", "Ce compte ne peut pas répondre à cette demande. Change de compte ou " + RELAUNCH.charAt(0).toLowerCase() + RELAUNCH.slice(1), false];
    if (e.status === 429) return ["Trop de tentatives", "Patiente une minute puis réessaie.", true];
    return ["Une erreur est survenue", "Le serveur a répondu : « " + (e.message || "erreur inconnue") + " ». Réessaie ; si le problème continue, " + RELAUNCH.charAt(0).toLowerCase() + RELAUNCH.slice(1), true];
  }
  function explainSignin(e) {
    if (isNetwork(e)) return "Impossible de joindre Boussole. Vérifie ta connexion puis réessaie.";
    switch (e.code) {
      case "invalid_credentials": return "E-mail ou mot de passe incorrect.";
      case "email_not_confirmed": return EMAILS
        ? "Adresse e-mail pas encore confirmée : ouvre le lien reçu lors de l'inscription."
        : "Adresse e-mail pas confirmée, et Boussole n'envoie pas d'e-mail pour le moment. Écris à stephane@ceres.agency.";
      case "otp_disabled":
      case "signup_disabled":
      case "user_not_found": return "Aucun compte Boussole n'utilise cette adresse.";
      case "over_request_rate_limit":
      case "over_email_send_rate_limit": return "Trop de tentatives : patiente une minute avant de réessayer.";
      case "email_address_invalid": return "Adresse e-mail invalide.";
      case "user_banned": return "Ce compte est suspendu.";
    }
    if (/invalid login credentials/i.test(e.message || "")) return "E-mail ou mot de passe incorrect.";
    if (/signups not allowed/i.test(e.message || "")) return "Aucun compte Boussole n'utilise cette adresse.";
    return "Connexion impossible : " + (e.message || "erreur inconnue") + ".";
  }

  /* ---------- autorisation du connecteur liée au second facteur (0033) ---------- */
  function explainAccord(e) {
    if (isNetwork(e)) return ["Serveur injoignable", "Impossible de joindre Boussole. Vérifie ta connexion puis réessaie.", true];
    if (e.code === "P0002") return ["Demande expirée ou introuvable", "Cette demande d'autorisation n'existe plus (elle expire au bout de quelques minutes). " + RELAUNCH, false];
    if (e.code === "42501") return ["Code à valider de nouveau", "Ta session ne porte plus ton code de double authentification. Recharge la page, valide ton code, puis autorise.", true];
    if (e.code === "BOU01") return ["Application non reconnue", "Cette application n'est pas un connecteur déclaré par Boussole : elle ne peut pas recevoir un accès protégé par ton code. N'autorise que Claude, ajouté depuis ses réglages avec l'adresse indiquée dans Mon compte.", false];
    if (e.code === "54000") return ["Trop de connecteurs autorisés", e.message || "Retire un connecteur dans Mon compte › Connexion de Claude, puis réessaie.", false];
    if (e.code === "PGRST202") return ["Autorisation impossible", "Le serveur de Boussole n'est pas encore prêt pour les comptes à double authentification. Réessaie plus tard.", false];
    return ["Autorisation impossible", "Le serveur a répondu : « " + (e.message || "erreur inconnue") + " ». Réessaie ; si le problème continue, " + RELAUNCH.charAt(0).toLowerCase() + RELAUNCH.slice(1), true];
  }
  /* Enregistre l'autorisation (session aal2 exigée par la base) → null si c'est fait, sinon l'erreur. */
  async function autoriser() {
    let res;
    try { res = await sb.rpc("autoriser_connecteur", { p_autorisation_id: authId }); } catch (e) { res = { data: null, error: e }; }
    if (res && res.error) return res.error;
    accord = (res && res.data) || {};
    return null;
  }

  /* ---------- droits demandés ---------- */
  const SCOPES = {
    email: "connaître ton adresse e-mail",
    profile: "connaître ton nom de profil",
    openid: "t'identifier auprès de l'application (OpenID)",
    phone: "connaître ton numéro de téléphone",
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
  function renderConsent(d, session, mfa) {
    const name = (d.client && d.client.name) || "Une application";
    $("clientName").textContent = name;
    document.title = "Autoriser " + name + " · Boussole";
    $("userEmail").textContent = (d.user && d.user.email) || (session && session.user && session.user.email) || "";
    const uri = d.client && d.client.uri;
    $("clientInfo").textContent = uri ? name + " (" + host(uri) + ")" : name;
    $("redirectHost").textContent = host(d.redirect_uri);
    const ul = $("perms");
    ul.textContent = "";
    ul.appendChild(perm("lire et modifier ton profil, tes placements et tes réglages Boussole ;"));
    String(d.scope || "").split(/\s+/).filter(Boolean).forEach(s => ul.appendChild(perm((SCOPES[s] || "accès « " + s + " »") + " ;")));
    const last = ul.lastElementChild && ul.lastElementChild.querySelector("span");
    if (last) last.textContent = last.textContent.replace(/ ;$/, ".");
    note($("consentMsg"), "");
    $("mfaNote").hidden = mfa !== "sans_facteur";
    $("grantNote").hidden = mfa !== "ok";
    $("grantJusquau").textContent = frDate(Date.now() + DUREE_AUTORISATION_JOURS * 864e5);
    setBusy(false);
    show("consent");
    $("approveBtn").focus({ preventScroll: true });
  }
  function redirect(url, approved) {
    if (!url) return fail("Redirection impossible", "Le serveur n'a pas renvoyé d'adresse de retour. " + RELAUNCH, false);
    $("doneTitle").textContent = approved === false ? "Accès refusé" : "Accès autorisé";
    $("doneText").textContent = "Retour vers " + host(url) + "…" +
      (approved !== false && accord && accord.expire_le ? " Accès valable " + (accord.duree_jours || DUREE_AUTORISATION_JOURS) + " jours, jusqu'au " + frDate(accord.expire_le) + "." : "");
    $("doneLink").href = url;
    show("done");
    location.assign(url);
  }

  /* ---------- double authentification ---------- */
  /* "code" : l'écran de code est affiché (loadDetails reprend une fois le code validé) ; "sans_facteur" | "ok" : rien à valider.
     Avec un facteur, un code de plus de FRAICHEUR_CODE_S secondes est redemandé même si la session est aal2 ; `forcer` : toujours. */
  async function exigerCode(forcer) {
    let etat;
    try { etat = forcer ? "code" : await window.Mfa.etatConsentement(mfaApi, { fraicheurS: FRAICHEUR_CODE_S }); }
    catch (e) {
      // Échec fermé : niveau illisible → ni demande affichée ni approbation ; le message et « Réessayer » reprennent depuis le début.
      show("mfa");
      $("mfaBox").textContent = "";
      window.Mfa.monterErreur($("mfaBox"), window.Mfa.texteErreur(e), () => { loadDetails().catch(x => { const [t, y, retry] = explainOAuth(x || {}); fail(t, y, retry ? loadDetails : null); }); },
        { onQuitter: async () => { await sb.auth.signOut({ scope: "local" }).catch(() => {}); showSignin(); } });
      return "code";
    }
    if (etat !== "code") return etat;
    show("mfa");
    $("mfaBox").textContent = "";
    await window.Mfa.monterCode($("mfaBox"), mfaApi, {
      onVerifie: () => { loadDetails().catch(e => { const [t, x, retry] = explainOAuth(e || {}); fail(t, x, retry ? loadDetails : null); }); },
      onQuitter: async () => { await sb.auth.signOut({ scope: "local" }).catch(() => {}); showSignin(); },
    });
    return "code";
  }

  /* ---------- étapes ---------- */
  async function loadDetails() {
    loading("Vérification de la demande…");
    const { data: s } = await sb.auth.getSession();
    const session = s && s.session;
    if (!session) return showSignin();
    // Compte anonyme : pas d'autorisation de connecteur tant qu'il n'a ni e-mail ni mot de passe.
    if (isAnon(session)) return show("anon");
    const mfa = await exigerCode();
    if (mfa === "code") return;
    let res;
    try { res = await sb.auth.oauth.getAuthorizationDetails(authId); }
    catch (e) { res = { data: null, error: e }; }
    const { data, error } = res;
    if (error) {
      if (isSessionError(error) && error.code !== "feature_disabled") {
        await sb.auth.signOut({ scope: "local" }).catch(() => {});
        return showSignin("Ta session a expiré : reconnecte-toi.");
      }
      const [t, x, retry] = explainOAuth(error);
      return fail(t, x, retry ? loadDetails : null);
    }
    if (!data) return fail("Demande introuvable", RELAUNCH, false);
    // Consentement déjà donné : Supabase renvoie directement l'adresse de retour. Avec un facteur vérifié, l'autorisation du connecteur
    // (0033) est enregistrée avant de rendre le code au client ; sans elle, pas de redirection (le jeton ne lirait rien).
    if (!("authorization_id" in data)) {
      if (mfa === "ok") {
        const err = await autoriser();
        if (err && err.code === "BOU02") return exigerCode(true);
        if (err) { const [t, x, retry] = explainAccord(err); return fail(t, x, retry ? loadDetails : null); }
      }
      return redirect(data.redirect_url || data.redirect_to, true);
    }
    renderConsent(data, session, mfa);
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
    let mfa = null;
    if (approve) {
      const { data: s } = await sb.auth.getSession().catch(() => ({ data: null }));
      if (isAnon(s && s.session)) return show("anon");
      // La session peut être retombée à aal1 depuis l'affichage : le code est redemandé, rien n'est approuvé.
      mfa = await exigerCode();
      if (mfa === "code") return;
    }
    setBusy(true);
    $(approve ? "approveBtn" : "denyBtn").textContent = approve ? "Autorisation…" : "Refus…";
    // 0033 : compte à double authentification → autorisation du connecteur enregistrée (session aal2) AVANT l'approbation ; sinon rien.
    if (approve && mfa === "ok") {
      const err = await autoriser();
      if (err) {
        setBusy(false);
        $("approveBtn").textContent = "Autoriser";
        if (err.code === "BOU02") return exigerCode(true); // code jugé trop ancien par la base : on le redemande, rien n'est approuvé
        const [t, x, retry] = explainAccord(err);
        if (retry) return note($("consentMsg"), t + " : " + x);
        return fail(t, x, null);
      }
    }
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
        return showSignin("Ta session a expiré : reconnecte-toi puis valide à nouveau.");
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
      return fail("Lien incomplet", "Cette page s'ouvre automatiquement quand tu connectes Boussole à Claude. Il manque l'identifiant de la demande. " + RELAUNCH, null);
    }
    if (!window.supabase || !window.supabase.createClient || !cfg.supabaseUrl || !cfg.supabaseKey) {
      return fail("Chargement incomplet", "Un composant de la page n'a pas pu être chargé (bloqueur de contenu ou réseau). Recharge la page.", () => location.reload());
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    if (!window.Mfa) {
      return fail("Chargement incomplet", "Un composant de la page n'a pas pu être chargé (bloqueur de contenu ou réseau). Recharge la page.", () => location.reload());
    }
    mfaApi = window.Mfa.adapter(sb);
    if (!sb.auth.oauth || typeof sb.auth.oauth.getAuthorizationDetails !== "function") {
      return fail("Version incompatible", "La bibliothèque d'authentification chargée ne gère pas l'autorisation OAuth. Recharge la page.", () => location.reload());
    }

    // Retour d'un lien de connexion (ou connexion dans un autre onglet) : on reprend là où on en était.
    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" && state === "signin" && !signingIn) setTimeout(loadDetails, 0);
    });

    $("signinForm").addEventListener("submit", async ev => {
      ev.preventDefault();
      const email = $("email").value.trim(), password = $("password").value;
      if (!email) return note($("signinMsg"), "Indique ton adresse e-mail.");
      if (!password) return note($("signinMsg"), EMAILS ? "Indique ton mot de passe, ou reçois un lien de connexion par e-mail." : "Indique ton mot de passe.");
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
      if (!email) { note($("signinMsg"), "Indique d'abord ton adresse e-mail."); return $("email").focus(); }
      setSigninBusy(true); note($("signinMsg"), "");
      let res;
      try {
        res = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split("#")[0], shouldCreateUser: false } });
      } catch (e) { res = { error: e }; }
      setSigninBusy(false);
      if (res.error) return note($("signinMsg"), explainSignin(res.error));
      note($("signinMsg"), "Lien envoyé à " + email + ". Ouvre-le sur cet appareil : tu reviendras ici pour valider l'accès. La demande expire au bout de quelques minutes.", "ok");
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
