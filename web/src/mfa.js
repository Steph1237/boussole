/* Double authentification (SEC2, docs/superpowers/specs/2026-10-14-sec2-mfa-design.md) : code à usage unique (TOTP) de Supabase Auth.
   Module partagé par l'accueil (écran de code après la connexion), la coque (garde au démarrage de app.html, reprise de session),
   la page de consentement des connecteurs et Mon compte › Sécurité. Fonctions sans dépendance, window.Mfa dans le navigateur,
   module.exports sous Node (tests).
   - adapter(client) → api { niveau(), facteurs(), inscrire(), verifier(facteurId, code), annuler(facteurId), supprimer(facteurId) } au-dessus de
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
   - monterSecurite(conteneur, api, opts) : section Mon compte › Sécurité (appareils, inscription par QR code, second appareil, retrait).
     Avant la PREMIÈRE inscription (aucun appareil vérifié), le mot de passe est redemandé dans la page (api.reauth, opts.email) : une
     session volée ne suffit pas à enrôler le facteur de l'attaquant.
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
    return {
      client,
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
        try {
          const d = await run(mfa().listFactors());
          for (const f of (Array.isArray(d.all) ? d.all : []).filter(x => x && x.status === "unverified")) {
            try { await mfa().unenroll({ factorId: f.id }); } catch (e) { /* inscription abandonnée déjà partie */ }
          }
        } catch (e) { /* le nettoyage est facultatif */ }
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
    ".mfa-form,.mfa-bloc{display:flex;flex-direction:column;gap:12px;margin:0;color:var(--ink,#18222C);font:16px/1.5 var(--f-body,system-ui,sans-serif)}",
    ".mfa-form h2,.mfa-bloc h3{margin:0;font:700 20px/1.2 var(--f-display,system-ui,sans-serif)}",
    ".mfa-form p,.mfa-bloc p{margin:0}",
    ".mfa-muted{color:var(--muted,#5B6670);font-size:14px}",
    ".mfa-fld{display:flex;flex-direction:column;gap:5px}",
    ".mfa-fld label{font-size:13px;font-weight:600;color:var(--muted,#5B6670)}",
    ".mfa-in{font:20px var(--f-num,ui-monospace,monospace);letter-spacing:.2em;color:var(--ink,#18222C);background:var(--bg,#F5F6F3);border:1px solid var(--line,#D9DDD6);border-radius:7px;padding:10px 12px;width:100%;min-width:0;box-sizing:border-box}",
    ".mfa-in:focus{border-color:var(--accent,#1F6F5C);outline:none;box-shadow:0 0 0 3px var(--accent-soft,#DCEBE5)}",
    "select.mfa-in{font:16px var(--f-body,system-ui,sans-serif);letter-spacing:0}",
    ".mfa-btns{display:flex;flex-wrap:wrap;gap:10px}",
    ".mfa-btn{display:inline-flex;align-items:center;justify-content:center;font:600 14px/1.2 var(--f-body,system-ui,sans-serif);border-radius:7px;padding:11px 16px;border:1px solid var(--accent,#1F6F5C);background:var(--accent,#1F6F5C);color:var(--accent-ink,var(--surface,#fff));cursor:pointer;min-height:44px;text-decoration:none}",
    ".mfa-btn.ghost{background:var(--surface,#fff);color:var(--accent,#1F6F5C);border-color:var(--line2,#C6CCC3)}",
    ".mfa-btn.danger{background:var(--crit,#B42318);border-color:var(--crit,#B42318);color:var(--surface,#fff)}",
    ".mfa-btn:disabled{opacity:.5;cursor:default}",
    ".mfa-msg{padding:10px 12px;border-radius:7px;font-size:14px}.mfa-msg:empty{display:none}",
    ".mfa-msg.err{background:var(--crit-soft,#F9E0DC)}.mfa-msg.ok{background:var(--good-soft,#E3F1E8)}",
    ".mfa-liste{list-style:none;margin:0;padding:0;display:grid;gap:8px}",
    ".mfa-liste li{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid var(--line,#D9DDD6);border-radius:7px;padding:10px 12px}",
    ".mfa-etapes{margin:0;padding:0 0 0 20px;display:grid;gap:12px}",
    ".mfa-qr{display:block;width:180px;height:180px;max-width:100%;background:#fff;border:1px solid var(--line,#D9DDD6);border-radius:7px;margin-top:8px}",
    ".mfa-secret{font:500 14px var(--f-num,ui-monospace,monospace);background:var(--sunk,#ECEEEA);border-radius:4px;padding:2px 6px;overflow-wrap:anywhere;user-select:all}",
    ".mfa-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
    ".mfa-alerte{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:12px 16px;background:var(--warn-soft,#FBF0D9);color:var(--ink,#18222C);border-bottom:1px solid var(--line2,#C6CCC3);font:14px/1.5 var(--f-body,system-ui,sans-serif)}",
    ".mfa-alerte p{margin:0;flex:1 1 280px}.mfa-alerte a{color:inherit;font-weight:600}",
    ".mfa-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg,#F5F6F3)}",
    ".mfa-gate-box{width:100%;max-width:420px;background:var(--surface,#fff);border:1px solid var(--line,#D9DDD6);border-radius:10px;padding:24px 20px;box-sizing:border-box}",
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

  /** Monte l'écran « code à 6 chiffres » dans `conteneur`. → Promise résolue quand le premier affichage est prêt (appareils chargés). */
  async function monterCode(conteneur, api, opts) {
    const o = opts || {};
    injecterStyle(docDe(o));
    let facteurs = [];
    let chargeErr = null;
    try { facteurs = await api.facteurs(); } catch (e) { chargeErr = texteErreur(e); }
    // Liste des appareils illisible : pas de formulaire à moitié fonctionnel, le message et « Réessayer » (échec fermé).
    if (chargeErr) { monterErreur(conteneur, chargeErr, () => monterCode(conteneur, api, o), o); return; }
    const choix = facteurs.length > 1;
    conteneur.innerHTML =
      '<form class="mfa-form" id="mfaCodeForm" novalidate aria-labelledby="mfaCodeTitre">' +
        '<h2 id="mfaCodeTitre">Double authentification</h2>' +
        '<p id="mfaCodeAide">Ouvre ton application d\'authentification et saisis le code à 6 chiffres affiché pour Boussole.</p>' +
        (choix ? '<div class="mfa-fld"><label for="mfaFacteur">Appareil</label><select class="mfa-in" id="mfaFacteur">' +
          facteurs.map((f, i) => '<option value="' + esc(f.id) + '">Appareil ' + (i + 1) + "</option>").join("") + "</select></div>" : "") +
        '<div class="mfa-fld"><label for="mfaCode">Code à 6 chiffres</label>' +
          '<input class="mfa-in" id="mfaCode" name="code" type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="one-time-code" maxlength="7" required aria-describedby="mfaCodeAide mfaCodeMsg"></div>' +
        '<p class="mfa-msg err" id="mfaCodeMsg" role="alert">' + esc(facteurs.length ? "" : "Aucun appareil de double authentification n'a été trouvé. Reconnecte-toi.") + "</p>" +
        '<div class="mfa-btns"><button type="submit" class="mfa-btn" id="mfaCodeOk">Valider</button>' +
        (o.onQuitter ? '<button type="button" class="mfa-btn ghost" id="mfaCodeQuitter">Se déconnecter</button>' : "") + "</div>" +
      "</form>";
    const $ = id => conteneur.querySelector("#" + id);
    const dire = t => { $("mfaCodeMsg").textContent = t || ""; };
    const form = $("mfaCodeForm"), champ = $("mfaCode");
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const ok = $("mfaCodeOk");
      if (ok.disabled) return;
      const code = normaliserCode(champ.value);
      if (!codeValide(code)) { dire("Saisis les 6 chiffres affichés dans ton application."); champ.focus(); return; }
      const fac = (choix && $("mfaFacteur") && $("mfaFacteur").value) || (facteurs[0] && facteurs[0].id);
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
  const frDate = d => { try { const x = new Date(d); return isFinite(x) ? x.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : ""; } catch (e) { return ""; } };
  const QR_OK = /^data:image\/(svg\+xml|png)[;,]/;
  const SECOURS = "Boussole ne propose pas de codes de secours : ajoute un second appareil (autre téléphone ou autre application) pour ne pas perdre l'accès si tu perds le premier.";
  const MSG_ANON = "Pour activer la double authentification, sécurise d'abord ton compte avec un e-mail et un mot de passe.";

  /** Monte la section Sécurité. opts = { anonyme, doc, lienSecuriser }. → Promise résolue après le premier affichage. */
  async function monterSecurite(conteneur, api, opts) {
    const o = opts || {};
    injecterStyle(docDe(o));
    if (o.anonyme) {
      conteneur.innerHTML = '<div class="mfa-bloc"><p>' + esc(MSG_ANON) + '</p><div class="mfa-btns"><a class="mfa-btn" href="' + esc(o.lienSecuriser || "#securiser") + '">Sécuriser mon compte</a></div></div>';
      return;
    }
    const st = { facteurs: [], charge: false, inscription: null, reauth: false, confirmer: null, msg: "", ok: false, occupe: false, focus: null };
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
        '<div class="mfa-btns"><button type="button" class="mfa-btn' + (n ? " ghost" : "") + '" id="mfaAjouter" data-mfa="ajouter"' + (st.charge ? "" : " disabled") + ">" +
          (n ? "Ajouter un second appareil" : "Activer la double authentification") + "</button></div>" +
        '<p class="mfa-msg" id="mfaMsg" role="alert"></p></div>';
    }
    /* Avant la première inscription : le mot de passe est redemandé (une session volée ne suffit pas à enrôler le facteur de l'attaquant). */
    function reauthVue() {
      return '<div class="mfa-bloc"><h3 id="mfaReauthTitre">Confirme ton mot de passe</h3>' +
        "<p>Pour activer la double authentification, saisis de nouveau ton mot de passe.</p>" +
        '<form class="mfa-form" id="mfaReauthForm" novalidate aria-labelledby="mfaReauthTitre">' +
          '<div class="mfa-fld"><label for="mfaReauthPw">Mot de passe</label>' +
          '<input class="mfa-in" style="letter-spacing:0" id="mfaReauthPw" type="password" autocomplete="current-password" required aria-describedby="mfaMsg"></div>' +
          '<div class="mfa-btns"><button type="submit" class="mfa-btn" id="mfaReauthOk">Continuer</button>' +
          '<button type="button" class="mfa-btn ghost" data-mfa="annuler-reauth">Annuler</button></div></form>' +
        '<p class="mfa-msg" id="mfaMsg" role="alert"></p></div>';
    }
    function inscription() {
      const i = st.inscription, qr = QR_OK.test(i.qr) ? i.qr : "";
      return '<div class="mfa-bloc"><h3 id="mfaInscrTitre">' + (st.facteurs.length ? "Ajouter un second appareil" : "Activer la double authentification") + "</h3>" +
        '<ol class="mfa-etapes" aria-labelledby="mfaInscrTitre">' +
        "<li>Dans ton application d'authentification, ajoute un compte en scannant ce QR code." +
          (qr ? '<img class="mfa-qr" id="mfaQr" src="' + esc(qr) + '" alt="QR code à scanner avec ton application d\'authentification">' : "") + "</li>" +
        '<li>Si tu ne peux pas scanner, saisis cette clé à la main : <code class="mfa-secret" id="mfaSecret">' + esc(i.secret) + "</code></li>" +
        "<li>Saisis le code à 6 chiffres que l'application affiche maintenant.</li></ol>" +
        '<form class="mfa-form" id="mfaInscrForm" novalidate>' +
          '<div class="mfa-fld"><label for="mfaInscrCode">Code à 6 chiffres</label>' +
          '<input class="mfa-in" id="mfaInscrCode" type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="one-time-code" maxlength="7" required aria-describedby="mfaMsg"></div>' +
          '<div class="mfa-btns"><button type="submit" class="mfa-btn" id="mfaInscrOk">Vérifier et activer</button>' +
          '<button type="button" class="mfa-btn ghost" data-mfa="annuler-inscription">Annuler</button></div></form>' +
        '<p class="mfa-msg" id="mfaMsg" role="alert"></p></div>';
    }
    function rendre() {
      const vue = st.inscription ? inscription() : st.reauth ? reauthVue() : liste();
      conteneur.innerHTML = vue;
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
        // Première inscription (aucun appareil vérifié) : mot de passe redemandé dans la page, avant tout appel à enroll.
        if (!st.facteurs.length) { st.reauth = true; st.msg = ""; st.focus = "mfaReauthPw"; rendre(); return; }
        occupe(b, true); dire("");
        try { st.inscription = await api.inscrire(); st.msg = ""; st.focus = "mfaInscrCode"; rendre(); }
        catch (err) { occupe(b, false); dire(texteErreur(err)); }
      } else if (act === "annuler-reauth") {
        st.reauth = false; st.msg = ""; st.focus = "mfaAjouter"; rendre();
      } else if (act === "annuler-inscription") {
        const i = st.inscription; st.inscription = null; st.msg = ""; st.focus = "mfaAjouter";
        rendre();
        if (i) await api.annuler(i.facteurId);
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
    conteneur.addEventListener("submit", async e => {
      if (e.target && e.target.id === "mfaReauthForm") {
        e.preventDefault();
        const ok = $("mfaReauthOk"), champ = $("mfaReauthPw");
        if (ok.disabled) return;
        if (!champ.value) { dire("Saisis ton mot de passe."); champ.focus(); return; }
        if (!o.email) { dire("Adresse e-mail introuvable : reconnecte-toi, puis réessaie."); return; }
        occupe(ok, true); dire("");
        try {
          await api.reauth(o.email, champ.value);
          champ.value = "";
          st.inscription = await api.inscrire(); st.reauth = false; st.msg = ""; st.focus = "mfaInscrCode"; rendre();
        } catch (err) { occupe(ok, false); champ.value = ""; dire(texteErreur(err)); champ.focus(); }
        return;
      }
      if (!e.target || e.target.id !== "mfaInscrForm") return;
      e.preventDefault();
      const ok = $("mfaInscrOk"), champ = $("mfaInscrCode");
      if (ok.disabled) return;
      if (!codeValide(champ.value)) { dire("Saisis les 6 chiffres affichés dans ton application."); champ.focus(); return; }
      occupe(ok, true); dire("");
      try {
        await api.verifier(st.inscription.facteurId, champ.value);
      } catch (err) { occupe(ok, false); champ.value = ""; dire(texteErreur(err)); champ.focus(); return; }
      const nouveau = st.inscription.facteurId;
      st.inscription = null;
      try { st.facteurs = await api.facteurs(); } catch (err) { /* liste relue au prochain affichage */ }
      acquitter(o, [nouveau]); // cet appareil-ci vient de créer ce facteur : pas de bandeau « ajouté, ce n'est pas toi ? » pour lui
      st.focus = "mfaAjouter"; rendre();
      dire("Double authentification activée. Elle te sera demandée à chaque connexion.", true);
      if (o.onChange) o.onChange(st.facteurs);
    });
    await charger();
  }

  const Mfa = { adapter, texteErreur, normaliserCode, codeValide, besoinCode, monterCode, exiger, apresConnexion, etatConsentement, monterSecurite, monterErreur, signalerNouvelAppareil, injecterStyle, CSS };
  root.Mfa = Mfa;
  if (typeof module === "object" && module.exports) module.exports = Mfa;
})(typeof window !== "undefined" ? window : globalThis);
