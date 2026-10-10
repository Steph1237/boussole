/* Accueil (index.html) : panneau de connexion / inscription et état « déjà connecté ».
   Dépend de window.Auth (auth.js). `index.html#connexion` ouvre le panneau : c'est là qu'arrivent les visiteurs
   non connectés renvoyés par app.html et compte.html. `?compte-supprime` affiche la confirmation de suppression.
   Mode sans e-mail (BOUSSOLE.emails !== true) : « Commencer sans e-mail » crée un compte anonyme (Auth.signInAnon) ;
   pas de lien magique, pas de « vérifiez votre boîte mail » : l'inscription ouvre directement app.html. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const A = window.Auth || null;
  const B = window.BOUSSOLE || {};
  const dlg = $("connexion"), form = $("authForm"), email = $("authEmail"), pw = $("authPw"), msg = $("authMsg");
  const submit = $("authSubmit"), magic = $("authMagic"), google = $("authGoogle"), pwHint = $("pwHint"), hint = $("authHint");
  const anonBtn = $("anonStart"), anonMsg = $("anonMsg");
  const EMAILS = B.emails === true;
  let mode = "signin", busy = false, signedIn = false;

  /* ---------- messages d'erreur en français ---------- */
  function frError(e) {
    const code = String((e && (e.code || (e.cause && (e.cause.code || e.cause.status)))) || "");
    const m = String((e && e.message) || "");
    const is = (codes, re) => codes.includes(code) || (re && re.test(m));
    if (is(["invalid_credentials"], /invalid login credentials/i)) return "Adresse e-mail ou mot de passe incorrect.";
    if (is(["email_not_confirmed"], /email not confirmed/i)) return EMAILS
      ? "Votre adresse e-mail n'est pas encore confirmée. Cliquez sur le lien reçu à l'inscription, ou demandez un lien de connexion."
      : "Cette adresse n'a pas été confirmée et Boussole n'envoie pas d'e-mail pour le moment. Écrivez à stephane@ceres.agency.";
    if (is(["over_email_send_rate_limit", "over_request_rate_limit", "over_sms_send_rate_limit", "429"], /rate limit|too many/i)) return "Trop de tentatives en peu de temps. Patientez quelques minutes avant de réessayer.";
    if (is(["user_already_exists", "email_exists"], /already (registered|exists)/i)) return EXISTS;
    const weak = A && A.weakPasswordText ? A.weakPasswordText(e) : null;
    if (weak) return weak;
    if (is(["anonymous_provider_disabled"], /anonymous sign-ins are disabled/i)) return "Le démarrage sans e-mail est fermé pour le moment. Créez un compte avec une adresse e-mail et un mot de passe.";
    if (is(["email_address_invalid"], /invalid.*email|email.*invalid|unable to validate email/i)) return "Adresse e-mail invalide.";
    if (is(["email_address_not_authorized"], /not authorized/i)) return "L'envoi d'e-mails vers cette adresse n'est pas possible pour le moment. Réessayez plus tard.";
    if (is(["signup_disabled"], /signups? not allowed|signup.*disabled/i)) return "Les inscriptions sont fermées pour le moment.";
    if (is(["provider_disabled"], /provider is not enabled|unsupported provider/i)) return "Connexion Google indisponible pour le moment.";
    if (is(["otp_expired"], /expired/i)) return "Ce lien a expiré. Demandez-en un nouveau.";
    if (is(["network"], /fetch|network|failed to load|supabase indisponible/i)) return "Connexion au serveur impossible. Vérifiez votre connexion internet et réessayez.";
    return "Une erreur est survenue" + (m ? " (" + m + ")" : "") + ". Réessayez.";
  }

  const EXISTS = "Un compte existe déjà avec cette adresse. Connectez-vous" + (EMAILS ? ", ou demandez un lien de connexion." : ".");
  function say(text, kind) { msg.textContent = text || ""; msg.className = "msg " + (kind || "err"); msg.setAttribute("role", kind === "ok" ? "status" : "alert"); }
  function setBusy(b) { busy = b; [submit, magic, google, anonBtn].forEach(x => { if (x) x.disabled = b; }); }

  /* ---------- panneau ---------- */
  function setMode(m) {
    mode = m === "signup" ? "signup" : "signin";
    document.querySelectorAll("#connexion [role=tab]").forEach(t => {
      const on = t.dataset.tab === mode;
      t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
    });
    form.setAttribute("aria-labelledby", "tab-" + mode);
    submit.textContent = mode === "signup" ? "Créer mon compte" : "Se connecter";
    pw.autocomplete = mode === "signup" ? "new-password" : "current-password";
    pwHint.hidden = mode !== "signup";
    magic.hidden = !EMAILS || mode === "signup"; // jamais de lien magique sans service d'e-mail
    hint.hidden = mode === "signup";
    say("");
  }
  function openPanel(m) {
    if (signedIn) { location.href = "app.html"; return; }
    setMode(m || mode);
    if (!dlg.open) dlg.showModal();
    email.focus();
    if (location.hash !== "#connexion") history.replaceState(null, "", "#connexion");
  }
  dlg.addEventListener("close", () => { if (location.hash === "#connexion") history.replaceState(null, "", location.pathname + location.search); });
  dlg.addEventListener("cancel", e => { if (busy) e.preventDefault(); });
  dlg.addEventListener("click", e => { if (e.target === dlg && !busy) dlg.close(); });
  $("authClose").addEventListener("click", () => { if (!busy) dlg.close(); });

  document.querySelectorAll("#connexion [role=tab]").forEach(t => t.addEventListener("click", () => { setMode(t.dataset.tab); email.focus(); }));
  document.querySelector("#connexion [role=tablist]").addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    setMode(mode === "signin" ? "signup" : "signin"); $("tab-" + mode).focus();
  });
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-auth]");
    if (!a || signedIn) return;
    e.preventDefault(); openPanel(a.dataset.auth);
  });
  window.addEventListener("hashchange", () => { if (location.hash === "#connexion") openPanel(); });

  /* ---------- actions ---------- */
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const goApp = () => { location.href = A && A.urls ? A.urls.app() : "app.html"; };
  function checkEmail() {
    const v = email.value.trim();
    if (!EMAIL.test(v)) { say("Indiquez une adresse e-mail valide."); email.focus(); return null; }
    return v;
  }
  async function guarded(fn) {
    if (busy) return;
    if (!A || !A.client) { say(frError({ code: "network" })); return; }
    setBusy(true); say("");
    try { await fn(); } catch (e) { say(frError(e)); } finally { setBusy(false); }
  }

  form.addEventListener("submit", e => {
    e.preventDefault();
    const em = checkEmail(); if (!em) return;
    const p = pw.value;
    if (!p) { say("Indiquez votre mot de passe."); pw.focus(); return; }
    const weak = mode === "signup" && A && A.passwordProblem ? A.passwordProblem(p) : null;
    if (weak) { say(weak); pw.focus(); return; }
    guarded(async () => {
      if (mode === "signin") { await A.signInPassword(em, p); goApp(); return; }
      const data = await A.signUp(em, p);
      if (data && data.session) { goApp(); return; }
      // Adresse déjà inscrite : Supabase renvoie un utilisateur sans identité (pour ne pas révéler l'existence du compte par une erreur).
      if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setMode("signin"); say(EXISTS); return;
      }
      if (!EMAILS) {
        // Confirmations coupées : pas de session renvoyée ne devrait pas arriver ; on tente la connexion directe.
        await A.signInPassword(em, p); goApp(); return;
      }
      pw.value = "";
      say("Vérifiez votre boîte mail pour confirmer votre adresse.", "ok");
    });
  });

  if (EMAILS) {
    magic.addEventListener("click", () => {
      const em = checkEmail(); if (!em) return;
      guarded(async () => {
        await A.signInMagic(em);
        say("Un lien de connexion a été envoyé à " + em + ". Ouvrez-le depuis cet appareil.", "ok");
      });
    });
    hint.textContent = "Mot de passe oublié ? Recevez un lien de connexion, puis choisissez un nouveau mot de passe dans Mon compte.";
  }

  /* ---------- « Commencer sans e-mail » : compte anonyme ---------- */
  const ANON_LABEL = anonBtn ? anonBtn.textContent : "";
  function sayAnon(text) { if (anonMsg) anonMsg.textContent = text || ""; }
  if (anonBtn) anonBtn.addEventListener("click", async () => {
    if (busy) return;
    if (!A || !A.client) { sayAnon(frError({ code: "network" })); return; }
    setBusy(true); sayAnon(""); anonBtn.textContent = "Création de votre espace…";
    try { await A.signInAnon(); goApp(); }
    catch (e) { sayAnon(frError(e)); anonBtn.textContent = ANON_LABEL; }
    finally { setBusy(false); }
  });

  // Le fournisseur Google n'est pas forcément activé : on le vérifie avant de quitter la page.
  async function googleEnabled() {
    try {
      const r = await fetch(B.supabaseUrl + "/auth/v1/settings", { headers: { apikey: B.supabaseKey } });
      if (!r.ok) return null;
      const j = await r.json();
      return !!(j && j.external && j.external.google);
    } catch (e) { return null; }
  }
  google.addEventListener("click", () => guarded(async () => {
    if ((await googleEnabled()) === false) throw { code: "provider_disabled" };
    await A.signInGoogle(); // redirige vers Google
  }));

  /* ---------- état initial ---------- */
  function showSignedIn(on, anon) {
    signedIn = on;
    $("ctasOut").hidden = on; $("ctasIn").hidden = !on;
    const acc = $("ctaAccount");
    if (acc) { acc.textContent = anon ? "Sécuriser mon compte" : "Mon compte"; acc.href = anon ? "compte.html#securiser" : "compte.html"; }
    const top = $("topLink");
    if (on) { top.textContent = "Ouvrir mon espace"; top.href = "app.html"; top.removeAttribute("data-auth"); if (dlg.open) dlg.close(); }
    else { top.textContent = "Se connecter"; top.href = "#connexion"; top.dataset.auth = "signin"; }
  }

  const qs = new URLSearchParams(location.search);
  if (qs.has("compte-supprime")) {
    $("noticeText").textContent = "Votre compte et toutes vos données ont été supprimés. Merci d'avoir utilisé Boussole.";
    $("notice").hidden = false;
    qs.delete("compte-supprime");
    const rest = qs.toString();
    history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
  }
  $("noticeClose").addEventListener("click", () => { $("notice").hidden = true; });

  setMode("signin");
  (async () => {
    const s = A ? await A.session() : null;
    const anon = sess => !!(A && A.isAnonymous && A.isAnonymous(sess));
    showSignedIn(!!s, anon(s));
    if (!s && location.hash === "#connexion") openPanel("signin");
    if (A && A.onChange) A.onChange((ev, sess) => showSignedIn(!!sess, anon(sess)));
  })();
})();
