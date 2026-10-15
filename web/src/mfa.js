/* Double authentification (SEC2, docs/superpowers/specs/2026-10-14-sec2-mfa-design.md) : code à usage unique (TOTP) de Supabase Auth.
   Module partagé par l'accueil (écran de code après la connexion), la coque (garde au démarrage de app.html, reprise de session),
   la page de consentement des connecteurs et Mon compte › Sécurité. Fonctions sans dépendance, window.Mfa dans le navigateur,
   module.exports sous Node (tests).
   - adapter(client) → api { niveau(), reauth(), facteurs(), inscrire(), verifier(facteurId, code), annuler(facteurId), nettoyer(), supprimer(facteurId) } au-dessus de
     client.auth.mfa de supabase-js (enroll / challenge / verify / unenroll / listFactors / getAuthenticatorAssuranceLevel). Les erreurs
     sont relancées avec un `code` (celui de Supabase : mfa_verification_failed, insufficient_aal…). Supabase n'a pas de codes de
     récupération : l'app conseille un second appareil.
   - texteErreur(e) : erreur → phrase française ; normaliserCode(s) : « 123 456 » → "123456" ; besoinCode({ current, next }) : l'utilisateur
     a un facteur vérifié (next = aal2) mais la session est encore aal1.
   - monterCode(conteneur, api, opts) : écran « code à 6 chiffres » (challenge + verify). opts = { onVerifie, onQuitter, doc }.
   - exiger(api, opts) : garde plein écran (dialog modal) tant que la session n'est pas aal2 ; résout true une fois le code validé (ou si
     rien n'est à faire). opts = { onQuitter, doc }. ÉCHEC FERMÉ : si le niveau de la session est illisible (réseau, serveur), la garde reste
     affichée avec le message d'erreur et un bouton « Réessayer » ; elle ne résout jamais true sans avoir lu le niveau. Seul cas qui rend
     false : aucun document (tests, hors navigateur) et niveau illisible.
   - apresConnexion(api, conteneur, opts) : après la connexion par mot de passe, écran de code si nécessaire, sinon opts.onPret() tout de suite.
     Niveau illisible : message + « Réessayer » dans le conteneur, onPret n'est PAS appelé (échec fermé).
   - etatConsentement(api) → "code" (code à valider avant d'autoriser) | "sans_facteur" (aucune double authentification) | "ok".
     Niveau illisible : l'erreur est relancée (à l'appelant d'afficher monterErreur), jamais « ok » par défaut.
   - monterErreur(conteneur, message, onReessayer, opts) : message d'erreur et bouton « Réessayer » (et « Se déconnecter » si opts.onQuitter).
   - monterSecurite(conteneur, api, opts) : section Mon compte › Sécurité (liste des appareils, retrait ; « Activer » / « second appareil »
     ouvrent l'assistant ci-dessous).
   - ouvrirActivation(api, opts) → Promise<boolean> : assistant d'activation, boîte de dialogue modale en 4 étapes (pourquoi + mot de passe,
     QR code ou lien otpauth:// sur petit écran, code à 6 chiffres avec envoi automatique, confirmation). Avant la PREMIÈRE inscription
     (aucun appareil vérifié), le mot de passe est redemandé (api.reauth, opts.email) : une session volée ne suffit pas à enrôler le facteur
     de l'attaquant. Fermer en cours de route retire l'inscription non vérifiée (api.nettoyer). Accessible : focus piégé puis rendu, Échap.
   - installerOuverture(doc, opts) : le bouton de la carte « Active la double authentification » (data-mfa-activer) ouvre l'assistant sur place.
   - signalerNouvelAppareil(api, opts) : à chaque démarrage de l'app, bandeau « Un appareil de double authentification a été ajouté le … —
     ce n'est pas toi ? » pour tout appareil vérifié que cet appareil-ci n'a pas encore acquitté (identifiants dans localStorage).
   Le style est injecté une fois (classes mfa-*), avec les variables de couleur des pages et des valeurs de repli. */
(function (root) {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- erreurs ---------- */
  const enErreur = e => {
    const x = e || {};
    return Object.assign(new Error(x.message || "Erreur d'authentification"), { code: x.code || (x.status != null ? String(x.status) : "network"), status: x.status, cause: e });
  };
  function texteErreur(e) {
    const code = String((e && (e.code || (e.cause && e.cause.code) || e.status)) || "");
    const m = String((e && e.message) || "");
    const est = (codes, re) => codes.includes(code) || (re && re.test(m));
    if (est(["mfa_verification_failed", "mfa_verification_rejected"], /invalid totp|invalid.*code|verification failed/i)) return "Code incorrect. Vérifie le code affiché dans ton application (il change toutes les 30 secondes), puis réessaie.";
    if (est(["mfa_challenge_expired"], /challenge.*expired|expired/i)) return "Ce code a expiré. Saisis le nouveau code affiché dans ton application.";
    if (est(["insufficient_aal"], /aal2|assurance level/i)) return "Pour faire cela, valide d'abord ton code de double authentification.";
    if (est(["too_many_enrolled_mfa_factors"], /too many.*factors|maximum.*factors/i)) return "Tu as déjà le nombre maximal d'appareils. Retire-en un avant d'en ajouter un autre.";
    if (est(["mfa_factor_name_conflict"], /friendly name/i)) return "Un appareil porte déjà ce nom. Réessaie dans une minute.";
    if (est(["mfa_factor_not_found"], /factor.*not found/i)) return "Cet appareil n'existe plus. Recharge la page.";
    if (est(["over_request_rate_limit", "over_email_send_rate_limit", "429"], /rate limit|too many/i)) return "Trop de tentatives en peu de temps. Patiente une minute avant de réessayer.";
    if (est(["invalid_credentials"], /invalid login credentials/i)) return "Mot de passe incorrect.";
    if (est(["session_not_found", "bad_jwt", "401"], /jwt|session/i)) return "Ta session a expiré. Reconnecte-toi.";
    if (est(["network"], /fetch|network|failed to load|indisponible/i)) return "Connexion au serveur impossible. Vérifie ta connexion internet et réessaie.";
    return "Une erreur est survenue" + (m ? " (" + m + ")" : "") + ". Réessaie.";
  }
  /** « 123 456 », « 123-456 » → "123456" ; tout autre caractère est écarté. */
  const normaliserCode = s => String(s == null ? "" : s).replace(/[\s-]/g, "");
  const codeValide = s => /^\d{6}$/.test(normaliserCode(s));
  const besoinCode = n => !!(n && n.next === "aal2" && n.current !== "aal2");

  /* ---------- adaptateur supabase-js ---------- */
  function adapter(client) {
    const mfa = () => {
      if (!client || !client.auth || !client.auth.mfa) throw Object.assign(new Error("Supabase indisponible."), { code: "network" });
      return client.auth.mfa;
    };
    const run = async p => { const { data, error } = await p; if (error) throw enErreur(error); return data || {}; };
    const vue = f => ({ id: f.id, nom: f.friendly_name || "", cree: f.created_at || "", statut: f.status || "verified" });
    /** Retire les inscriptions abandonnées (facteurs non vérifiés) : listFactors puis unenroll de chacun. Ne lève jamais. */
    async function nettoyer() {
      try {
        const d = await run(mfa().listFactors());
        for (const f of (Array.isArray(d.all) ? d.all : []).filter(x => x && x.status === "unverified")) {
          try { await mfa().unenroll({ factorId: f.id }); } catch (e) { /* inscription abandonnée déjà partie */ }
        }
      } catch (e) { /* le nettoyage est facultatif */ }
    }
    return {
      client,
      nettoyer,
      /** Niveau de la session : { current: "aal1" | "aal2" | null, next }. next = aal2 : au moins un facteur vérifié. */
      async niveau() {
        const d = await run(mfa().getAuthenticatorAssuranceLevel());
        return { current: d.currentLevel || null, next: d.nextLevel || null };
      },
      /** Nouvelle preuve du mot de passe (avant la première inscription) : signInWithPassword sur l'e-mail courant. Erreur relancée avec son code. */
      async reauth(email, motDePasse) {
        if (!client || !client.auth || typeof client.auth.signInWithPassword !== "function") throw Object.assign(new Error("Supabase indisponible."), { code: "network" });
        const { error } = await client.auth.signInWithPassword({ email: String(email || ""), password: String(motDePasse || "") });
        if (error) throw enErreur(error);
        return true;
      },
      /** Appareils (TOTP) vérifiés, du plus ancien au plus récent. */
      async facteurs() {
        const d = await run(mfa().listFactors());
        return (Array.isArray(d.totp) ? d.totp : []).filter(f => !f.status || f.status === "verified").map(vue)
          .sort((a, b) => String(a.cree).localeCompare(String(b.cree)));
      },
      /** Nouvelle inscription : retire d'abord les inscriptions abandonnées (non vérifiées), puis enroll TOTP. → { facteurId, qr, secret, uri }. */
      async inscrire() {
        await nettoyer();
        const nom = "Appareil " + new Date().toISOString().slice(0, 16).replace("T", " ");
        const d = await run(mfa().enroll({ factorType: "totp", friendlyName: nom }));
        const t = d.totp || {};
        return { facteurId: d.id, qr: t.qr_code || "", secret: t.secret || "", uri: t.uri || "" };
      },
      /** challenge puis verify avec le code à 6 chiffres ; la session passe à aal2. */
      async verifier(facteurId, code) {
        const c = await run(mfa().challenge({ factorId: facteurId }));
        await run(mfa().verify({ factorId: facteurId, challengeId: c.id, code: normaliserCode(code) }));
        return true;
      },
      /** Abandon d'une inscription non vérifiée (sans erreur si elle n'existe plus). */
      async annuler(facteurId) { try { await mfa().unenroll({ factorId: facteurId }); } catch (e) { /* rien */ } },
      /** Retrait d'un appareil (exige une session aal2), puis session renouvelée pour que le niveau suive. */
      async supprimer(facteurId) {
        await run(mfa().unenroll({ factorId: facteurId }));
        try { await client.auth.refreshSession(); } catch (e) { /* le jeton se renouvellera seul */ }
        return true;
      },
    };
  }

  /* ---------- style ---------- */
  const CSS = [
    ".mfa-form,.mfa-bloc{display:flex;flex-direction:column;gap:12px;margin:0;color:var(--ink,#18222C);font:var(--t-h3,16px)/1.5 var(--f-body,system-ui,sans-serif)}",
    ".mfa-form h2,.mfa-bloc h3{margin:0;font:700 var(--t-h2,20px)/1.2 var(--f-display,system-ui,sans-serif)}",
    ".mfa-form p,.mfa-bloc p{margin:0}",
    ".mfa-muted{color:var(--muted,#5B6670);font-size:var(--t-body,14px)}",
    ".mfa-fld{display:flex;flex-direction:column;gap:5px}",
    ".mfa-fld label{font-size:var(--t-small,13px);font-weight:600;color:var(--muted,#5B6670)}",
    ".mfa-in{font:var(--t-h2,20px) var(--f-num,ui-monospace,monospace);letter-spacing:.2em;color:var(--ink,#18222C);background:var(--bg,#F5F6F3);border:1px solid var(--line,#D9DDD6);border-radius:7px;padding:10px 12px;width:100%;min-width:0;box-sizing:border-box}",
    ".mfa-in:focus{border-color:var(--accent,#16585E);outline:none;box-shadow:0 0 0 3px var(--accent-soft,#E3ECEC)}",
    "select.mfa-in{font:var(--t-h3,16px) var(--f-body,system-ui,sans-serif);letter-spacing:0}",
    ".mfa-btns{display:flex;flex-wrap:wrap;gap:10px}",
    ".mfa-btn{display:inline-flex;align-items:center;justify-content:center;font:600 var(--t-body,14px)/1.2 var(--f-body,system-ui,sans-serif);border-radius:7px;padding:11px 16px;border:1px solid var(--accent,#16585E);background:var(--accent,#16585E);color:var(--accent-ink,var(--surface,#fff));cursor:pointer;min-height:44px;text-decoration:none}",
    ".mfa-btn.ghost{background:var(--surface,#fff);color:var(--accent,#16585E);border-color:var(--line2,#C6CCC3)}",
    ".mfa-btn.danger{background:var(--crit,#B42318);border-color:var(--crit,#B42318);color:var(--surface,#fff)}",
    ".mfa-btn:disabled{opacity:.5;cursor:default}",
    ".mfa-msg{padding:10px 12px;border-radius:7px;font-size:var(--t-body,14px)}.mfa-msg:empty{display:none}",
    ".mfa-msg.err{background:var(--crit-soft,#F9E0DC)}.mfa-msg.ok{background:var(--good-soft,#E3F1E8)}",
    ".mfa-liste{list-style:none;margin:0;padding:0;display:grid;gap:8px}",
    ".mfa-liste li{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid var(--line,#D9DDD6);border-radius:7px;padding:10px 12px}",
    ".mfa-etapes{margin:0;padding:0 0 0 20px;display:grid;gap:12px}",
    ".mfa-qr{display:block;width:180px;height:180px;max-width:100%;background:#fff;border:1px solid var(--line,#D9DDD6);border-radius:7px;margin-top:8px}",
    ".mfa-secret{font:500 var(--t-body,14px) var(--f-num,ui-monospace,monospace);background:var(--sunk,#ECEEEA);border-radius:4px;padding:2px 6px;overflow-wrap:anywhere;user-select:all}",
    ".mfa-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
    ".mfa-alerte{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:12px 16px;background:var(--warn-soft,#FBF0D9);color:var(--ink,#18222C);border-bottom:1px solid var(--line2,#C6CCC3);font:var(--t-body,14px)/1.5 var(--f-body,system-ui,sans-serif)}",
    ".mfa-alerte p{margin:0;flex:1 1 280px}.mfa-alerte a{color:inherit;font-weight:600}",
    ".mfa-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg,#F5F6F3)}",
    ".mfa-gate-box{width:100%;max-width:420px;background:var(--surface,#fff);border:1px solid var(--line,#D9DDD6);border-radius:10px;padding:24px 20px;box-sizing:border-box}",
    /* assistant d'activation (dialogue en 4 étapes) : feuille plein écran sur téléphone */
    ".mfa-ass-ouvert{overflow:hidden}",
    ".mfa-ass-fond{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(10,16,22,.6);overflow:auto}",
    ".mfa-ass-box{position:relative;width:100%;max-width:480px;max-height:100%;overflow:auto;display:flex;flex-direction:column;gap:14px;box-sizing:border-box;padding:18px 22px 24px;color:var(--ink,#18222C);background:var(--surface,#fff);border:1px solid var(--line,#D9DDD6);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.3);font:var(--t-h3,16px)/1.5 var(--f-body,system-ui,sans-serif)}",
    ".mfa-ass-box p{margin:0}",
    ".mfa-ass-box h2{margin:0;font:700 var(--t-kpi,22px)/1.2 var(--f-display,system-ui,sans-serif)}",
    ".mfa-ass-box h2:focus{outline:none}",
    ".mfa-ass-tete{display:flex;justify-content:space-between;align-items:center;gap:12px}",
    ".mfa-etape{font:600 var(--t-small,13px)/1.2 var(--f-body,system-ui,sans-serif);color:var(--muted,#5B6670);letter-spacing:.02em}",
    ".mfa-ass-x{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;margin:-8px -10px -8px 0;font:400 var(--t-kpi,26px)/1 var(--f-body,system-ui,sans-serif);color:var(--muted,#5B6670);background:transparent;border:0;border-radius:7px;cursor:pointer}",
    ".mfa-ass-x:hover{color:var(--ink,#18222C);background:var(--sunk,#ECEEEA)}",
    ".mfa-prog{display:flex;gap:6px}.mfa-prog i{flex:1;height:4px;border-radius:2px;background:var(--line2,#C6CCC3)}.mfa-prog i.on{background:var(--accent,#16585E)}",
    ".mfa-ass-corps{display:flex;flex-direction:column;gap:14px}",
    ".mfa-ass-box .mfa-qr{align-self:center;width:200px;height:200px;margin:0;padding:8px;box-sizing:border-box}",
    ".mfa-ouvrir{width:100%;box-sizing:border-box}",
    ".mfa-lien{align-self:flex-start;min-height:44px;padding:0 2px;font:600 var(--t-body,14px)/1.2 var(--f-body,system-ui,sans-serif);color:var(--accent,#16585E);background:transparent;border:0;text-decoration:underline;text-underline-offset:3px;cursor:pointer}",
    ".mfa-cle{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--line,#D9DDD6);border-radius:8px;background:var(--bg,#F5F6F3)}.mfa-cle[hidden]{display:none}",
    ".mfa-cle .mfa-secret{align-self:flex-start;padding:8px 10px;font-size:var(--t-h3,16px);letter-spacing:.06em}",
    ".mfa-btn:focus-visible,.mfa-lien:focus-visible,.mfa-ass-x:focus-visible,.mfa-secret:focus-visible{outline:2px solid var(--ink,#18222C);outline-offset:2px}",
    "@media (max-width:640px){.mfa-ass-fond{padding:0;align-items:stretch}.mfa-ass-box{max-width:none;max-height:none;min-height:100%;border:0;border-radius:0;box-shadow:none;padding:16px 16px calc(24px + env(safe-area-inset-bottom,0px))}.mfa-ass-box .mfa-btns{flex-direction:column}.mfa-ass-box .mfa-btn{width:100%;box-sizing:border-box}.mfa-ass-box .mfa-qr{width:min(220px,70vw);height:auto;aspect-ratio:1}}",
    "@media (prefers-reduced-motion:no-preference){.mfa-ass-box{animation:mfa-entree .18s ease-out}@keyframes mfa-entree{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}}",
  ].join("\n");
  function injecterStyle(doc) {
    try {
      if (!doc || !doc.createElement) return;
      const tete = doc.head || doc.documentElement || doc.body;
      if (!tete || (doc.getElementById && doc.getElementById("mfa-css"))) return;
      const s = doc.createElement("style");
      s.id = "mfa-css"; s.textContent = CSS;
      tete.appendChild(s);
    } catch (e) { /* style facultatif */ }
  }
  const docDe = o => (o && o.doc) || (typeof document !== "undefined" ? document : null);

  /* ---------- écran de code (connexion, reprise de session, consentement) ---------- */
  const occupe = (b, on) => { if (!b) return; b.disabled = on; if (on) b.setAttribute("aria-busy", "true"); else b.removeAttribute("aria-busy"); };
  /** Écran d'erreur d'une vérification de sécurité (échec fermé) : le message, un bouton « Réessayer » (onReessayer, appelé une fois le bouton
      rendu inactif ; une nouvelle erreur doit être remontée par un nouvel appel à monterErreur) et, si opts.onQuitter, « Se déconnecter ». */
  function monterErreur(conteneur, message, onReessayer, opts) {
    const o = opts || {};
    injecterStyle(docDe(o));
    conteneur.innerHTML =
      '<div class="mfa-form" id="mfaErreurBox" aria-labelledby="mfaCodeTitre">' +
        '<h2 id="mfaCodeTitre">Double authentification</h2>' +
        '<p class="mfa-msg err" id="mfaErreurMsg" role="alert">' + esc(message) + "</p>" +
        '<div class="mfa-btns"><button type="button" class="mfa-btn" id="mfaReessayer">Réessayer</button>' +
        (o.onQuitter ? '<button type="button" class="mfa-btn ghost" id="mfaErreurQuitter">Se déconnecter</button>' : "") + "</div></div>";
    const bouton = conteneur.querySelector("#mfaReessayer");
    bouton.addEventListener("click", () => { if (bouton.disabled) return; occupe(bouton, true); if (onReessayer) onReessayer(); });
    if (o.onQuitter) conteneur.querySelector("#mfaErreurQuitter").addEventListener("click", () => o.onQuitter());
    if (bouton.focus) bouton.focus();
  }

  /** Saisie d'un code à 6 chiffres : envoi automatique dès que le 6e chiffre est là (frappe, saisie automatique du téléphone, collage) et
      collage tolérant (« 123 456 », « Code : 123456 » → chiffres seuls). onComplet() ne reçoit rien : il relit le champ. */
  function lierSaisieCode(champ, onComplet) {
    champ.addEventListener("input", () => { if (codeValide(champ.value)) onComplet(); });
    champ.addEventListener("paste", e => {
      const presse = e && e.clipboardData;
      const brut = presse && typeof presse.getData === "function" ? presse.getData("text") : null;
      if (brut == null) return; // collage non lisible : le navigateur remplit le champ, puis l'événement input prend le relais
      e.preventDefault();
      const chiffres = String(brut).replace(/\D/g, "").slice(0, 6);
      champ.value = chiffres;
      if (chiffres.length === 6) onComplet();
    });
  }

  /** Monte l'écran « code à 6 chiffres » dans `conteneur` : une seule étape, le champ du code au premier plan. Plusieurs appareils :
      le premier est proposé, « Utiliser un autre appareil » passe au suivant. → Promise résolue quand le premier affichage est prêt. */
  async function monterCode(conteneur, api, opts) {
    const o = opts || {};
    injecterStyle(docDe(o));
    let facteurs = [];
    let chargeErr = null;
    try { facteurs = await api.facteurs(); } catch (e) { chargeErr = texteErreur(e); }
    // Liste des appareils illisible : pas de formulaire à moitié fonctionnel, le message et « Réessayer » (échec fermé).
    if (chargeErr) { monterErreur(conteneur, chargeErr, () => monterCode(conteneur, api, o), o); return; }
    const choix = facteurs.length > 1;
    let idx = 0;
    const appareil = () => {
      const f = facteurs[idx], quand = f ? frDate(f.cree) : "";
      return "Appareil " + (idx + 1) + " sur " + facteurs.length + (quand ? ", ajouté le " + quand : "") + ".";
    };
    conteneur.innerHTML =
      '<form class="mfa-form" id="mfaCodeForm" novalidate aria-labelledby="mfaCodeTitre">' +
        '<h2 id="mfaCodeTitre">Double authentification</h2>' +
        '<p id="mfaCodeAide">Ouvre ton application d\'authentification et saisis le code à 6 chiffres affiché pour Boussole.</p>' +
        (choix ? '<p class="mfa-muted" id="mfaAppareil" aria-live="polite">' + esc(appareil()) + "</p>" : "") +
        '<div class="mfa-fld"><label for="mfaCode">Code à 6 chiffres</label>' +
          '<input class="mfa-in" id="mfaCode" name="code" type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="one-time-code" maxlength="7" required aria-describedby="mfaCodeAide mfaCodeMsg"></div>' +
        '<p class="mfa-msg err" id="mfaCodeMsg" role="alert">' + esc(facteurs.length ? "" : "Aucun appareil de double authentification n'a été trouvé. Reconnecte-toi.") + "</p>" +
        '<div class="mfa-btns"><button type="submit" class="mfa-btn" id="mfaCodeOk">Valider</button>' +
        (choix ? '<button type="button" class="mfa-btn ghost" id="mfaAutre">Utiliser un autre appareil</button>' : "") +
        (o.onQuitter ? '<button type="button" class="mfa-btn ghost" id="mfaCodeQuitter">Se déconnecter</button>' : "") + "</div>" +
      "</form>";
    const $ = id => conteneur.querySelector("#" + id);
    const dire = t => { $("mfaCodeMsg").textContent = t || ""; };
    const form = $("mfaCodeForm"), champ = $("mfaCode");
    async function envoyer() {
      const ok = $("mfaCodeOk");
      if (ok.disabled) return;
      const code = normaliserCode(champ.value);
      if (!codeValide(code)) { dire("Saisis les 6 chiffres affichés dans ton application."); champ.focus(); return; }
      const fac = facteurs[idx] && facteurs[idx].id;
      if (!fac) { dire("Aucun appareil de double authentification n'a été trouvé. Reconnecte-toi."); return; }
      occupe(ok, true); dire("");
      try {
        await api.verifier(fac, code);
      } catch (err) {
        occupe(ok, false); champ.value = ""; dire(texteErreur(err)); champ.focus();
        return;
      }
      occupe(ok, false);
      if (o.onVerifie) o.onVerifie();
    }
    form.addEventListener("submit", e => { e.preventDefault(); envoyer(); });
    lierSaisieCode(champ, envoyer);
    if (choix) $("mfaAutre").addEventListener("click", () => {
      if ($("mfaCodeOk").disabled) return;
      idx = (idx + 1) % facteurs.length;
      $("mfaAppareil").textContent = appareil(); champ.value = ""; dire(""); champ.focus();
    });
    if (o.onQuitter) $("mfaCodeQuitter").addEventListener("click", () => o.onQuitter());
    champ.focus();
  }

  /** Garde plein écran : si la session est aal1 avec un facteur vérifié, affiche l'écran de code par-dessus la page et attend la validation.
      ÉCHEC FERMÉ : si le niveau n'a pas pu être lu, la garde reste affichée avec le message et « Réessayer » jusqu'à une lecture réussie.
      → Promise<boolean> : true quand la session est aal2 (ou n'a rien à valider) ; false seulement sans document (hors navigateur). */
  async function exiger(api, opts) {
    const o = opts || {};
    const doc = docDe(o);
    const lire = async () => { try { return { n: await api.niveau() }; } catch (e) { return { e }; } };
    let r = await lire();
    if (!r.e && (!besoinCode(r.n) || !doc)) return true;
    if (r.e && !doc) return false;
    injecterStyle(doc);
    const fond = doc.createElement("div");
    fond.className = "mfa-gate";
    fond.setAttribute("role", "dialog");
    fond.setAttribute("aria-modal", "true");
    fond.setAttribute("aria-labelledby", "mfaCodeTitre");
    const boite = doc.createElement("div");
    boite.className = "mfa-gate-box";
    fond.appendChild(boite);
    doc.body.appendChild(fond);
    const app = doc.querySelectorAll ? doc.querySelectorAll(".app, .page") : [];
    app.forEach(x => { x.inert = true; x.setAttribute("aria-hidden", "true"); });
    const lever = () => { fond.remove(); app.forEach(x => { x.inert = false; x.removeAttribute("aria-hidden"); }); };
    while (r.e) {
      const err = r.e;
      r = await new Promise(resolve => monterErreur(boite, texteErreur(err), async () => resolve(await lire()), { doc, onQuitter: o.onQuitter }));
    }
    if (!besoinCode(r.n)) { lever(); return true; }
    return new Promise(resolve => {
      monterCode(boite, api, { doc, onVerifie: () => { lever(); resolve(true); }, onQuitter: o.onQuitter });
    });
  }

  /** Après une connexion par mot de passe : si un code est à valider, affiche l'écran de code dans `conteneur` (onPret une fois validé),
      sinon appelle onPret tout de suite. Niveau illisible : message + « Réessayer » dans `conteneur`, onPret n'est PAS appelé (échec fermé).
      → Promise<boolean> : true si un écran (code ou erreur) a été affiché. opts = { onPret, onCode (appelé juste avant l'affichage : rendre le panneau visible), onQuitter, doc }. */
  async function apresConnexion(api, conteneur, opts) {
    const o = opts || {};
    let n = null;
    try { n = await api.niveau(); } catch (e) {
      if (o.onCode) o.onCode();
      monterErreur(conteneur, texteErreur(e), () => apresConnexion(api, conteneur, o), { doc: o.doc, onQuitter: o.onQuitter });
      return true;
    }
    if (!besoinCode(n)) { if (o.onPret) o.onPret(); return false; }
    if (o.onCode) o.onCode();
    await monterCode(conteneur, api, { doc: o.doc, onVerifie: o.onPret, onQuitter: o.onQuitter });
    return true;
  }

  /** Page de consentement : "code" (facteur vérifié, session encore aal1), "sans_facteur" (pas de double authentification), "ok".
      Niveau illisible : l'erreur est relancée (jamais « ok » par défaut) ; l'appelant affiche monterErreur avec « Réessayer ». */
  async function etatConsentement(api) {
    const n = await api.niveau();
    if (besoinCode(n)) return "code";
    return n && n.next === "aal2" ? "ok" : "sans_facteur";
  }

  /* ---------- bandeau « un appareil a été ajouté » ---------- */
  /* Identifiants des appareils déjà vus sur CET appareil-ci (navigateur), dans localStorage. Toute lecture ou écriture est protégée :
     stockage bloqué ou absent → liste vide (le bandeau reparaît à chaque démarrage, par prudence), jamais d'exception. */
  const CLE_VUS = "boussole.mfa.vus";
  const stockageDe = o => { try { return (o && o.storage) || (typeof localStorage !== "undefined" ? localStorage : null); } catch (e) { return null; } };
  function lireVus(o) {
    try { const st = stockageDe(o); const v = st ? JSON.parse(st.getItem(CLE_VUS) || "[]") : []; return Array.isArray(v) ? v.map(String) : []; } catch (e) { return []; }
  }
  function acquitter(o, ids) {
    try {
      const st = stockageDe(o); if (!st) return;
      const vus = lireVus(o);
      for (const id of ids || []) if (id != null && !vus.includes(String(id))) vus.push(String(id));
      st.setItem(CLE_VUS, JSON.stringify(vus.slice(-50)));
    } catch (e) { /* stockage indisponible : le bandeau reviendra */ }
  }
  /** Adresse d'assistance (mentions légales) à qui écrire si l'appareil ajouté n'est pas celui de l'utilisateur. */
  const CONTACT = "stephane@ceres.agency";
  /** À chaque démarrage de l'app (après la garde) : si un appareil vérifié n'a pas encore été acquitté sur ce navigateur, bandeau d'alerte avec
      le plus récent, « C'est moi » l'acquitte (tous les appareils actuels). Information, pas une barrière : toute erreur est ignorée.
      → Promise<boolean> : true si le bandeau a été posé. opts = { doc, storage }. */
  async function signalerNouvelAppareil(api, opts) {
    const o = opts || {};
    const doc = docDe(o);
    if (!doc || !doc.body) return false;
    let liste;
    try { liste = await api.facteurs(); } catch (e) { return false; }
    const vus = lireVus(o);
    const nouveaux = liste.filter(f => !vus.includes(String(f.id)));
    if (!nouveaux.length) return false;
    const recent = nouveaux.slice().sort((a, b) => String(b.cree).localeCompare(String(a.cree)))[0];
    injecterStyle(doc);
    const quand = frDate(recent.cree);
    const bandeau = doc.createElement("div");
    bandeau.className = "mfa-alerte"; bandeau.id = "mfaAlerte";
    bandeau.setAttribute("role", "alert");
    bandeau.innerHTML = "<p>Un appareil de double authentification a été ajouté" + (quand ? " le " + esc(quand) : "") + " — ce n'est pas toi ? Écris à " +
      '<a href="mailto:' + esc(CONTACT) + '">' + esc(CONTACT) + "</a>.</p>" +
      '<button type="button" class="mfa-btn ghost" id="mfaAlerteOk">C\'est moi</button>';
    if (doc.body.insertBefore && doc.body.firstChild) doc.body.insertBefore(bandeau, doc.body.firstChild); else doc.body.appendChild(bandeau);
    bandeau.querySelector("#mfaAlerteOk").addEventListener("click", () => { acquitter(o, liste.map(f => f.id)); bandeau.remove(); });
    return true;
  }

  /* ---------- Mon compte › Sécurité ---------- */
  const frDate = d => { try { const x = new Date(d); return isFinite(x) ? x.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }) : ""; } catch (e) { return ""; } };
  const QR_OK = /^data:image\/(svg\+xml|png)[;,]/;
  const SECOURS = "Boussole ne propose pas de codes de secours : ajoute un second appareil (autre téléphone ou autre application) pour ne pas perdre l'accès si tu perds le premier.";
  const MSG_ANON = "Pour activer la double authentification, sécurise d'abord ton compte avec un e-mail et un mot de passe.";

  /* ---------- assistant d'activation (dialogue en 4 étapes) ---------- */
  const ETAPES = 4;
  const TITRES = { 1: "Pourquoi un code ?", 2: "Ajoute Boussole à ton application", 3: "Saisis le code", 4: "C'est activé" };
  const OTPAUTH = /^otpauth:\/\/totp\/[^\s"<>]*$/i; // seule forme de lien ouverte dans une application : jamais un autre schéma
  const MQ_PETIT = "(max-width: 640px)";
  const FOCALISABLES = "button, a[href], input, select, textarea, [tabindex]";
  const estFocalisable = el => !el.disabled && !el.hidden && el.getAttribute("tabindex") !== "-1" && !(el.closest && el.closest("[hidden]"));

  /** Ouvre l'assistant d'activation de la double authentification : boîte de dialogue modale en 4 étapes (pourquoi + mot de passe,
      ajout dans l'application avec QR code, code à 6 chiffres, confirmation). Premier appareil : le mot de passe est redemandé avant tout
      appel à enroll. Fermer en cours de route (Échap, « Annuler », ×) retire l'inscription non vérifiée (api.nettoyer), sauf appareil déjà activé.
      opts = { doc, email, storage, petitEcran, clipboard, retour (élément ou fonction : focus rendu à la fermeture), onChange(facteurs) }.
      → Promise<boolean> résolue à la fermeture : true si au moins un appareil a été activé pendant l'assistant. */
  function ouvrirActivation(api, opts) {
    const o = opts || {};
    const doc = docDe(o);
    if (!doc || !doc.body) return Promise.resolve(false);
    if (typeof o.premiere === "boolean") return monterAssistant(api, o, doc, o.premiere);
    // Premier appareil ? Lu avant d'ouvrir (jamais un champ qui change sous les doigts). Illisible : par prudence, mot de passe demandé.
    const retour = o.retour || doc.activeElement;
    return api.facteurs().then(l => !l.length, () => true).then(premiere => monterAssistant(api, Object.assign({}, o, { retour }), doc, premiere));
  }
  function monterAssistant(api, o, doc, premiere) {
    injecterStyle(doc);
    const retourEl = typeof o.retour === "function" ? o.retour() : (o.retour || doc.activeElement);
    const st = { etape: 1, premiere,  reauthFait: false, inscription: null, enCours: false, active: 0, msg: "", copie: "", cleVisible: false, occupe: false, ferme: false, nouvelAppareil: null };
    const mq = o.petitEcran == null && root.matchMedia ? (() => { try { return root.matchMedia(MQ_PETIT); } catch (e) { return null; } })() : null;
    const petit = () => (o.petitEcran != null ? !!o.petitEcran : !!(mq && mq.matches));

    const fond = doc.createElement("div");
    fond.className = "mfa-ass-fond";
    const boite = doc.createElement("div");
    boite.className = "mfa-ass-box"; boite.id = "mfaAss";
    boite.setAttribute("role", "dialog"); boite.setAttribute("aria-modal", "true"); boite.setAttribute("aria-labelledby", "mfaAssTitre");
    fond.appendChild(boite);
    const $ = id => boite.querySelector("#" + id);
    const dire = (t, ok) => { st.msg = t || ""; const m = $("mfaAssMsg"); if (m) { m.textContent = st.msg; m.className = "mfa-msg" + (st.msg ? (ok ? " ok" : " err") : ""); m.setAttribute("role", ok ? "status" : "alert"); } };

    /* --- contenu des étapes --- */
    const msg = '<p class="mfa-msg" id="mfaAssMsg" role="alert"></p>';
    function corps() {
      if (st.etape === 1) {
        return (st.premiere
          ? "<p>Un code à 6 chiffres, affiché par une application sur ton téléphone, s'ajoute à ton mot de passe. Même si quelqu'un trouve ton mot de passe, il ne pourra ni voir tes données ni connecter ta banque sans ce code.</p>"
          : "<p>Tu ajoutes un second appareil de double authentification. Si tu perds le premier, celui-ci te permet de garder l'accès à ton compte.</p>") +
          '<p class="mfa-muted">Il te faut une application d\'authentification (Google Authenticator, Authy, 1Password…) sur ton téléphone.</p>' +
          '<form class="mfa-form" id="mfaAssForm1" novalidate>' +
          (st.premiere && !st.reauthFait ? '<div class="mfa-fld"><label for="mfaAssPw">Pour continuer, confirme ton mot de passe</label>' +
            '<input class="mfa-in" style="letter-spacing:0" id="mfaAssPw" type="password" autocomplete="current-password" required aria-describedby="mfaAssMsg"></div>' : "") +
          msg + '<div class="mfa-btns"><button type="submit" class="mfa-btn" id="mfaAssSuite">Continuer</button>' +
          '<button type="button" class="mfa-btn ghost" data-ass="annuler">Annuler</button></div></form>';
      }
      if (st.etape === 2) {
        const i = st.inscription || {}, qr = QR_OK.test(i.qr || "") ? i.qr : "", lien = OTPAUTH.test(i.uri || "") ? i.uri : "";
        const bouton = lien && petit() ? '<a class="mfa-btn mfa-ouvrir" id="mfaOuvrir" href="' + esc(lien) + '">Ouvrir dans mon application d\'authentification</a>' +
          '<p class="mfa-muted">Sur ce téléphone, un QR code ne peut pas être scanné : ce bouton ajoute Boussole directement. Si rien ne s\'ouvre, utilise « Je ne peux pas scanner ».</p>' : "";
        const code = qr ? '<img class="mfa-qr" id="mfaQr" src="' + esc(qr) + '" alt="QR code à scanner avec ton application d\'authentification">' : "";
        return "<p>" + (petit() && lien ? "Ajoute un compte pour Boussole dans ton application d'authentification." : "Dans ton application d'authentification, ajoute un compte en scannant ce QR code.") + "</p>" +
          (petit() ? bouton + (code ? '<p class="mfa-muted">Ou scanne ce QR code avec un autre appareil.</p>' : "") + code : code) +
          '<button type="button" class="mfa-lien" id="mfaPasScanner" data-ass="cle" aria-expanded="' + st.cleVisible + '" aria-controls="mfaCle">Je ne peux pas scanner</button>' +
          '<div class="mfa-cle" id="mfaCle"' + (st.cleVisible ? "" : " hidden") + ">" +
            "<p>Saisis cette clé à la main dans ton application (type « basé sur l'heure ») :</p>" +
            '<code class="mfa-secret" id="mfaSecret" tabindex="0">' + esc(i.secret || "") + "</code>" +
            '<div class="mfa-btns"><button type="button" class="mfa-btn ghost" id="mfaCopier" data-ass="copier">Copier</button></div>' +
            '<p class="mfa-msg ok" id="mfaCopieMsg" role="status">' + esc(st.copie) + "</p></div>" +
          msg + '<div class="mfa-btns"><button type="button" class="mfa-btn" id="mfaAssSuite" data-ass="suite">J\'ai ajouté Boussole</button>' +
          '<button type="button" class="mfa-btn ghost" data-ass="retour">Retour</button></div>';
      }
      if (st.etape === 3) {
        return '<form class="mfa-form" id="mfaAssForm" novalidate>' +
          '<p id="mfaAssAide">Saisis le code à 6 chiffres que ton application affiche maintenant pour Boussole.</p>' +
          '<div class="mfa-fld"><label for="mfaAssCode">Code à 6 chiffres</label>' +
          '<input class="mfa-in" id="mfaAssCode" type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="one-time-code" maxlength="7" required aria-describedby="mfaAssAide mfaAssMsg"></div>' +
          msg + '<div class="mfa-btns"><button type="submit" class="mfa-btn" id="mfaAssOk">Vérifier et activer</button>' +
          '<button type="button" class="mfa-btn ghost" data-ass="retour">Retour</button>' +
          '<button type="button" class="mfa-btn ghost" data-ass="annuler">Annuler</button></div></form>';
      }
      return '<p class="mfa-msg ok" role="status" id="mfaAssFait">La double authentification est activée. Elle te sera demandée à chaque connexion.</p>' +
        "<p>" + esc(SECOURS) + "</p>" + msg +
        '<div class="mfa-btns"><button type="button" class="mfa-btn" id="mfaAssFin" data-ass="terminer">Terminer</button>' +
        '<button type="button" class="mfa-btn ghost" id="mfaAssSecond" data-ass="second">Ajouter un second appareil</button></div>';
    }
    function rendre() {
      const barre = []; for (let k = 1; k <= ETAPES; k++) barre.push("<i" + (k <= st.etape ? ' class="on"' : "") + "></i>");
      boite.innerHTML = '<div class="mfa-ass-tete"><p class="mfa-etape" id="mfaEtape">Étape ' + st.etape + " sur " + ETAPES + "</p>" +
        '<button type="button" class="mfa-ass-x" data-ass="fermer" aria-label="Fermer">×</button></div>' +
        '<div class="mfa-prog" aria-hidden="true">' + barre.join("") + "</div>" +
        '<h2 id="mfaAssTitre" tabindex="-1">' + esc(TITRES[st.etape]) + '</h2><div class="mfa-ass-corps">' + corps() + "</div>";
      if (st.msg && st.etape !== 4) dire(st.msg);
    }
    function placerFocus() {
      const cible = (st.etape === 1 && $("mfaAssPw")) || (st.etape === 3 && $("mfaAssCode")) || $("mfaAssTitre");
      if (cible && cible.focus) cible.focus();
    }
    function aller(n, message) { st.etape = n; st.msg = message || ""; st.copie = ""; st.cleVisible = false; rendre(); placerFocus(); }

    /* --- inscription et nettoyage --- */
    async function demarrer() {
      st.occupe = true; st.enCours = true; dire("");
      const b = $("mfaAssSuite"); occupe(b, true);
      let r;
      try { r = await api.inscrire(); } catch (err) { st.occupe = false; st.enCours = false; occupe(b, false); dire(texteErreur(err)); return false; }
      st.occupe = false;
      if (st.ferme) { try { await api.annuler(r.facteurId); } catch (e) { /* rien */ } return false; }
      st.inscription = r;
      aller(2);
      return true;
    }
    async function nettoyerInscription() {
      const avait = st.inscription || st.enCours;
      st.inscription = null; st.enCours = false;
      if (avait) { try { await api.nettoyer(); } catch (e) { /* rien */ } }
    }

    /* --- verrouillage de la page derrière le dialogue --- */
    const rendus = [];
    Array.from(doc.body.children || []).forEach(x => {
      if (x === fond || /^(script|style|link)$/i.test(x.localName || "")) return;
      rendus.push({ x, inert: !!x.inert, aria: x.getAttribute("aria-hidden") });
      x.inert = true; x.setAttribute("aria-hidden", "true");
    });
    try { doc.documentElement.classList.add("mfa-ass-ouvert"); } catch (e) { /* défilement non verrouillé */ }

    let fin;
    const fini = new Promise(r => { fin = r; });
    async function fermer() {
      if (st.ferme) return;
      st.ferme = true;
      doc.removeEventListener("keydown", clavier, true);
      doc.removeEventListener("focusin", garde);
      if (mq && mq.removeEventListener) { try { mq.removeEventListener("change", changement); } catch (e) { /* rien */ } }
      fond.remove();
      rendus.forEach(r => { r.x.inert = r.inert; if (r.aria == null) r.x.removeAttribute("aria-hidden"); else r.x.setAttribute("aria-hidden", r.aria); });
      try { doc.documentElement.classList.remove("mfa-ass-ouvert"); } catch (e) { /* rien */ }
      const cible = typeof o.retour === "function" ? o.retour() : retourEl;
      if (cible && cible.focus && cible.isConnected !== false) cible.focus();
      await nettoyerInscription(); // l'inscription non vérifiée disparaît côté serveur : une nouvelle tentative repart proprement
      fin(st.active > 0);
    }

    /* --- clavier : Échap ferme, Tab reste dans la boîte --- */
    function clavier(e) {
      if (!e || st.ferme) return;
      if (e.key === "Escape") { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); fermer(); return; }
      if (e.key !== "Tab") return;
      const liste = Array.from(boite.querySelectorAll(FOCALISABLES)).filter(estFocalisable);
      if (!liste.length) { if (e.preventDefault) e.preventDefault(); return; }
      const premier = liste[0], dernier = liste[liste.length - 1], actif = doc.activeElement;
      const dedans = boite.contains(actif);
      if (e.shiftKey && (!dedans || actif === premier || actif === $("mfaAssTitre"))) { if (e.preventDefault) e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && (!dedans || actif === dernier)) { if (e.preventDefault) e.preventDefault(); premier.focus(); }
    }
    function garde(e) { if (!st.ferme && e && e.target && !boite.contains(e.target)) placerFocus(); }
    function changement() { if (!st.ferme && st.etape === 2) { const ouvert = st.cleVisible; rendre(); st.cleVisible = ouvert; } }
    doc.addEventListener("keydown", clavier, true);
    doc.addEventListener("focusin", garde);
    if (mq && mq.addEventListener) { try { mq.addEventListener("change", changement); } catch (e) { /* rien */ } }

    /* --- actions --- */
    async function copier() {
      const texte = (st.inscription && st.inscription.secret) || "";
      const presse = o.clipboard !== undefined ? o.clipboard : (typeof navigator !== "undefined" ? navigator.clipboard : null);
      let ok = false;
      try { await presse.writeText(texte); ok = true; } catch (e) { ok = false; }
      let dit;
      if (ok) dit = "Clé copiée.";
      else {
        const el = $("mfaSecret");
        try {
          const d = el.ownerDocument || doc, sel = (d.defaultView || root).getSelection(), r = d.createRange();
          r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r);
        } catch (e) { /* sélection impossible : la clé reste focalisable et lisible */ }
        try { el.focus(); } catch (e) { /* rien */ }
        dit = "Copie automatique impossible : la clé est sélectionnée, copie-la avec ton clavier (Ctrl+C ou Cmd+C).";
      }
      st.copie = dit;
      const m = $("mfaCopieMsg"); if (m) { m.textContent = dit; m.className = "mfa-msg " + (ok ? "ok" : "err"); }
    }
    async function verifier() {
      const champ = $("mfaAssCode"), ok = $("mfaAssOk");
      if (!champ || !ok || ok.disabled) return;
      if (!codeValide(champ.value)) { dire("Saisis les 6 chiffres affichés dans ton application."); champ.focus(); return; }
      const i = st.inscription;
      if (!i) return;
      occupe(ok, true); dire("");
      try {
        await api.verifier(i.facteurId, champ.value);
      } catch (err) { occupe(ok, false); champ.value = ""; dire(texteErreur(err)); champ.focus(); return; }
      if (st.ferme) return;
      st.active++;
      st.nouvelAppareil = i.facteurId;
      st.inscription = null; st.enCours = false;
      acquitter(o, [i.facteurId]); // cet appareil-ci vient de créer ce facteur : pas de bandeau « ajouté, ce n'est pas toi ? » pour lui
      aller(4);
      if (o.onChange) { try { o.onChange(await api.facteurs()); } catch (e) { /* liste relue à la fermeture */ } }
    }
    async function continuer() {
      if (st.occupe) return;
      if (st.premiere && !st.reauthFait) {
        const champ = $("mfaAssPw"), b = $("mfaAssSuite");
        if (!champ.value) { dire("Saisis ton mot de passe."); champ.focus(); return; }
        if (!o.email) { dire("Adresse e-mail introuvable : reconnecte-toi, puis réessaie."); return; }
        st.occupe = true; occupe(b, true); dire("");
        try { await api.reauth(o.email, champ.value); }
        catch (err) { st.occupe = false; occupe(b, false); champ.value = ""; dire(texteErreur(err)); champ.focus(); return; }
        champ.value = ""; st.reauthFait = true; st.occupe = false;
        if (st.ferme) return;
      }
      await demarrer();
    }
    boite.addEventListener("click", async e => {
      const b = e.target && e.target.closest ? e.target.closest("[data-ass]") : null;
      if (!b || b.disabled) return;
      const act = b.getAttribute("data-ass");
      if (act === "fermer" || act === "annuler" || act === "terminer") fermer();
      else if (act === "cle") {
        st.cleVisible = !st.cleVisible;
        b.setAttribute("aria-expanded", String(st.cleVisible));
        const c = $("mfaCle"); if (c) c.hidden = !st.cleVisible;
        if (st.cleVisible) { const s = $("mfaSecret"); if (s && s.focus) s.focus(); }
      }
      else if (act === "copier") await copier();
      else if (act === "suite") aller(3);
      else if (act === "retour") {
        if (st.etape === 3) aller(2);
        else { await nettoyerInscription(); aller(1); } // retour avant l'étape 3 : l'inscription est retirée, une nouvelle sera créée
      }
      else if (act === "second") { if (!st.occupe) { st.premiere = false; await demarrer(); } }
    });
    boite.addEventListener("submit", e => {
      if (!e.target) return;
      if (e.target.id === "mfaAssForm1") { e.preventDefault(); continuer(); }
      else if (e.target.id === "mfaAssForm") { e.preventDefault(); verifier(); }
    });
    // Saisie du code : envoi automatique au 6e chiffre. Le champ est recréé à chaque étape : on se branche sur le conteneur.
    boite.addEventListener("input", e => { if (e.target && e.target.id === "mfaAssCode" && codeValide(e.target.value)) verifier(); });
    boite.addEventListener("paste", e => {
      if (!e.target || e.target.id !== "mfaAssCode") return;
      const presse = e.clipboardData, brut = presse && typeof presse.getData === "function" ? presse.getData("text") : null;
      if (brut == null) return;
      e.preventDefault();
      const chiffres = String(brut).replace(/\D/g, "").slice(0, 6);
      e.target.value = chiffres;
      if (chiffres.length === 6) verifier();
    });

    /* --- affichage --- */
    rendre();
    doc.body.appendChild(fond);
    placerFocus();
    return fini;
  }

  /** Monte la section Sécurité. opts = { anonyme, doc, lienSecuriser, email, storage, onChange, petitEcran, clipboard }. → Promise résolue après le premier affichage. */
  async function monterSecurite(conteneur, api, opts) {
    const o = opts || {};
    injecterStyle(docDe(o));
    if (o.anonyme) {
      conteneur.innerHTML = '<div class="mfa-bloc"><p>' + esc(MSG_ANON) + '</p><div class="mfa-btns"><a class="mfa-btn" href="' + esc(o.lienSecuriser || "#securiser") + '">Sécuriser mon compte</a></div></div>';
      return;
    }
    const st = { facteurs: [], charge: false, confirmer: null, msg: "", ok: false, focus: null };
    const $ = id => conteneur.querySelector("#" + id);
    const dire = (t, ok) => { st.msg = t || ""; st.ok = !!ok; const m = $("mfaMsg"); if (m) { m.textContent = st.msg; m.className = "mfa-msg " + (st.ok ? "ok" : "err"); m.setAttribute("role", st.ok ? "status" : "alert"); } };
    function liste() {
      const n = st.facteurs.length;
      const items = st.facteurs.map((f, i) => {
        const nom = "Appareil " + (i + 1), quand = frDate(f.cree);
        if (st.confirmer === f.id) {
          return '<li><div role="group" aria-labelledby="mfaConf-' + esc(f.id) + '"><p id="mfaConf-' + esc(f.id) + '">Retirer <b>' + esc(nom) + "</b> ? " +
            (n === 1 ? "Sans double authentification, tes comptes bancaires ne s'afficheront plus." : "Tes autres appareils restent valables.") + '</p>' +
            '<div class="mfa-btns"><button type="button" class="mfa-btn danger" data-mfa="confirmer-retrait" data-id="' + esc(f.id) + '">Confirmer le retrait</button>' +
            '<button type="button" class="mfa-btn ghost" data-mfa="annuler-retrait">Annuler</button></div></div></li>';
        }
        return "<li><span><b>" + esc(nom) + "</b>" + (quand ? '<br><span class="mfa-muted">Ajouté le ' + esc(quand) + "</span>" : "") + "</span>" +
          '<button type="button" class="mfa-btn ghost" data-mfa="retirer" data-id="' + esc(f.id) + '">Retirer<span class="mfa-sr"> ' + esc(nom) + "</span></button></li>";
      }).join("");
      return '<div class="mfa-bloc">' +
        "<p>Un code à 6 chiffres, affiché par une application d'authentification (Google Authenticator, Authy, 1Password…), s'ajoute à ton mot de passe. " +
          "Sans lui, le détail bancaire (opérations, budget réel) reste masqué ; une fois activé, il est demandé pour accéder à toutes tes données dans Boussole.</p>" +
        (st.charge ? (n ? '<ul class="mfa-liste" aria-label="Appareils enregistrés">' + items + "</ul>"
          : '<p class="mfa-muted" id="mfaVide">La double authentification n\'est pas activée.</p>') : '<p class="mfa-muted" role="status">Chargement…</p>') +
        (n ? '<p class="mfa-muted" id="mfaSecours">' + esc(SECOURS) + "</p>" : "") +
        '<div class="mfa-btns"><button type="button" class="mfa-btn' + (n ? " ghost" : "") + '" id="mfaAjouter" data-mfa="ajouter" aria-haspopup="dialog"' + (st.charge ? "" : " disabled") + ">" +
          (n ? "Ajouter un second appareil" : "Activer la double authentification") + "</button></div>" +
        '<p class="mfa-msg" id="mfaMsg" role="alert"></p></div>';
    }
    function rendre() {
      conteneur.innerHTML = liste();
      if (st.msg) dire(st.msg, st.ok);
      const f = st.focus; st.focus = null;
      const cible = f ? $(f) : null;
      if (cible) cible.focus();
    }
    async function charger() {
      try { st.facteurs = await api.facteurs(); st.charge = true; }
      catch (e) { st.charge = true; st.msg = texteErreur(e); st.ok = false; }
      rendre();
    }
    conteneur.addEventListener("click", async e => {
      const b = e.target && e.target.closest ? e.target.closest("[data-mfa]") : null;
      if (!b || b.disabled) return;
      const act = b.getAttribute("data-mfa"), id = b.getAttribute("data-id");
      if (act === "ajouter") {
        // Assistant en dialogue : mot de passe redemandé avant tout appel à enroll (premier appareil), nettoyage si on ferme en cours de route.
        const active = await ouvrirActivation(api, { doc: o.doc, email: o.email, premiere: !st.facteurs.length, storage: o.storage, petitEcran: o.petitEcran, clipboard: o.clipboard,
          retour: () => $("mfaAjouter"), onChange: l => { if (o.onChange) o.onChange(l); } });
        try { st.facteurs = await api.facteurs(); st.charge = true; } catch (err) { /* liste relue au prochain affichage */ }
        st.confirmer = null; st.focus = "mfaAjouter"; st.msg = active ? "Double authentification activée. Elle te sera demandée à chaque connexion." : ""; st.ok = !!active;
        rendre();
      } else if (act === "retirer") { st.confirmer = id; st.msg = ""; rendre(); const c = conteneur.querySelector('[data-mfa="annuler-retrait"]'); if (c) c.focus(); }
      else if (act === "annuler-retrait") { st.confirmer = null; st.focus = "mfaAjouter"; rendre(); }
      else if (act === "confirmer-retrait") {
        occupe(b, true);
        try {
          await api.supprimer(id);
          st.confirmer = null; st.facteurs = await api.facteurs(); st.focus = "mfaAjouter"; rendre();
          dire("Appareil retiré.", true);
          if (o.onChange) o.onChange(st.facteurs);
        } catch (err) { occupe(b, false); dire(texteErreur(err)); }
      }
    });
    await charger();
  }

  /* ---------- ouverture depuis la carte « Active la double authentification » ---------- */
  /** Le bouton de la carte bloquante (BanqueEtat.carteMfa, attribut data-mfa-activer) ouvre l'assistant sur place au lieu de quitter la page ;
      sans Auth.mfa (page sans client), le lien normal vers Compte › Sécurité fonctionne. Compte anonyme : lien vers Compte (il faut d'abord
      sécuriser le compte). Une fois activé, apres() recharge les données (Store.reload, sinon la page). opts = { doc, auth, aller, apres, petitEcran }. */
  function installerOuverture(doc, opts) {
    const o = opts || {};
    if (!doc || !doc.addEventListener) return;
    doc.addEventListener("click", async e => {
      const lien = e && e.target && e.target.closest ? e.target.closest("[data-mfa-activer]") : null;
      if (!lien) return;
      const A = o.auth || root.Auth;
      if (!A || !A.mfa || typeof A.session !== "function") return; // pas de client : le lien est suivi normalement
      e.preventDefault();
      const href = lien.getAttribute("href") || "compte.html#securite";
      const aller = u => { if (o.aller) o.aller(u); else if (root.location) root.location.href = u; };
      let email = "", anonyme = false;
      try { const s = await A.session(); email = (s && s.user && s.user.email) || ""; anonyme = !!(s && (typeof A.isAnonymous === "function" ? A.isAnonymous(s) : s.user && s.user.is_anonymous)); } catch (err) { aller(href); return; }
      if (anonyme) { aller(href); return; }
      const active = await ouvrirActivation(A.mfa, { doc, email, petitEcran: o.petitEcran, retour: lien });
      if (!active) return;
      if (o.apres) { o.apres(); return; }
      try { if (root.Store && typeof root.Store.reload === "function") root.Store.reload(); else if (root.location) root.location.reload(); }
      catch (err) { if (root.location) root.location.reload(); }
    });
  }
  if (typeof document !== "undefined") installerOuverture(document);

  const Mfa = { adapter, texteErreur, normaliserCode, codeValide, besoinCode, monterCode, exiger, apresConnexion, etatConsentement, monterSecurite, ouvrirActivation, installerOuverture, monterErreur, signalerNouvelAppareil, injecterStyle, CSS };
  root.Mfa = Mfa;
  if (typeof module === "object" && module.exports) module.exports = Mfa;
})(typeof window !== "undefined" ? window : globalThis);
