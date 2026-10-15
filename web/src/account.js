/* Page « Mon compte » (compte.html) : e-mail, mot de passe, connecteurs d'assistant, export, suppression.
   Dépend de window.Auth (auth.js). Toutes les lectures passent par le client de la session : RLS borne tout
   au compte courant. Suppression : RPC delete_me() (security definer, supprime auth.users → cascade).
   Compte anonyme (« Commencer sans e-mail ») : section #securiser (Auth.secureAccount) à la place des sections
   e-mail et mot de passe ; suppression confirmée par « SUPPRIMER ». Sans service d'e-mail (BOUSSOLE.emails !== true),
   le changement d'adresse est immédiat (aucun courrier de confirmation).
   Double authentification (SEC2) : section #securite (Mfa.monterSecurite, mfa.js) ; avant d'afficher la page, Mfa.exiger demande le code si le compte
   en a un et que la session est encore aal1.
   Accès des connecteurs protégés par le code (migration 0033) : #accords liste les lignes de connecteurs_autorises encore actives ou
   expirées (lecture par son propriétaire, colonnes accordées à authenticated) ; « Retirer » appelle la RPC revoquer_connecteur(client_id).
   Retirer une application chez Supabase (revokeGrant) retire aussi son accès. Table absente ou rien à montrer : section masquée.
   Banques connectées (BQ1) : l'utilisateur Powens est toujours supprimé AVANT delete_me (POST <supabaseUrl>/functions/v1/powens/supprimer,
   JWT de la session), sans condition sur l'interrupteur banque : la fonction répond { ok: true } quand il n'y a rien à supprimer (jamais
   connecté, ou déjà supprimé chez Powens). Tout échec (réseau, 5xx, autre refus) bloque la suppression avec un message ; 401 ou session
   absente → session expirée. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const A = window.Auth || null;
  const EMAILS = !!(window.BOUSSOLE && window.BOUSSOLE.emails === true);
  const B = window.BOUSSOLE || {};
  const POWENS_URL = B.powensUrl || String(B.supabaseUrl || "").replace(/\/+$/, "") + "/functions/v1/powens";
  let client = null, user = null, people = {}, anon = false;

  /* ---------- messages ---------- */
  function frError(e) {
    const code = String((e && (e.code || (e.cause && (e.cause.code || e.cause.status)) || e.status)) || "");
    const m = String((e && e.message) || "");
    const is = (codes, re) => codes.includes(code) || (re && re.test(m));
    if (is(["same_password"], /different from the old/i)) return "Le nouveau mot de passe doit être différent de l'ancien.";
    if (is(["email_confirmation_required"])) return m;
    const weak = A && A.weakPasswordText ? A.weakPasswordText(e) : null;
    if (weak) return weak;
    if (is(["weak_password"], /password should|weak password/i)) return "Mot de passe trop faible : 8 caractères minimum, avec des lettres et des chiffres.";
    if (is(["reauthentication_needed"], /reauthentic/i)) return "Pour des raisons de sécurité, déconnecte-toi puis reconnecte-toi avant de changer de mot de passe.";
    if (is(["email_exists", "user_already_exists"], /already (registered|been registered|exists)/i)) return "Cette adresse est déjà utilisée par un autre compte.";
    if (is(["email_address_invalid"], /invalid.*email|email.*invalid|unable to validate email/i)) return "Adresse e-mail invalide.";
    if (is(["over_email_send_rate_limit", "over_request_rate_limit", "429"], /rate limit|too many/i)) return "Trop de demandes en peu de temps. Patiente quelques minutes avant de réessayer.";
    if (is(["session_not_found", "bad_jwt", "401", "403"], /jwt|session/i)) return "Ta session a expiré. Reconnecte-toi.";
    if (is(["network"], /fetch|network|failed to load/i)) return "Connexion au serveur impossible. Vérifie ta connexion internet et réessaie.";
    return "Une erreur est survenue" + (m ? " (" + m + ")" : "") + ". Réessaie.";
  }
  const say = (id, text, kind) => { const el = $(id); el.textContent = text || ""; el.className = "msg " + (kind || "err"); };
  const run = async pr => { const { data, error } = await pr; if (error) throw error; return data; };
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const today = () => new Date().toISOString().slice(0, 10);

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function busy(btn, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  }

  /* ---------- e-mail ---------- */
  $("emailForm").addEventListener("submit", e => {
    e.preventDefault();
    const v = $("newEmail").value.trim();
    if (!EMAIL.test(v)) { say("emailMsg", "Indique une adresse e-mail valide."); return; }
    if (user && v.toLowerCase() === String(user.email || "").toLowerCase()) { say("emailMsg", "C'est déjà ton adresse actuelle."); return; }
    busy(e.submitter || $("emailForm").querySelector("button"), async () => {
      try {
        if (EMAILS) {
          await run(client.auth.updateUser({ email: v }, { emailRedirectTo: location.href.split("#")[0] }));
          say("emailMsg", "Un lien de confirmation a été envoyé à " + v + ". Le changement prend effet quand tu l'ouvres (un second lien peut aussi être envoyé à ton adresse actuelle).", "ok");
          $("newEmail").value = "";
          return;
        }
        // Sans service d'e-mail : changement immédiat. Si le serveur laisse l'adresse « en attente », il exige une confirmation.
        const data = await run(client.auth.updateUser({ email: v }));
        const u = data && data.user;
        if (u && String(u.email || "").toLowerCase() === v.toLowerCase()) {
          user = u; $("curEmail").textContent = u.email; $("pwUser").value = u.email; $("newEmail").value = "";
          $("who").textContent = "Connecté avec " + u.email + ".";
          say("emailMsg", "Adresse modifiée : connecte-toi désormais avec " + u.email + ".", "ok");
        } else {
          say("emailMsg", "Le serveur demande de confirmer la nouvelle adresse par e-mail, mais Boussole n'envoie pas d'e-mail pour le moment. Ton adresse actuelle reste valable. Écris à stephane@ceres.agency pour la changer.");
        }
      } catch (err) { say("emailMsg", frError(err)); }
    });
  });

  /* ---------- mot de passe ---------- */
  $("pwForm").addEventListener("submit", e => {
    e.preventDefault();
    const a = $("pw1").value, b = $("pw2").value;
    const weak = A.passwordProblem(a);
    if (weak) { say("pwMsg", weak); return; }
    if (a !== b) { say("pwMsg", "Les deux mots de passe ne sont pas identiques."); return; }
    busy(e.submitter || $("pwForm").querySelector("button"), async () => {
      try {
        await run(client.auth.updateUser({ password: a }));
        $("pw1").value = ""; $("pw2").value = "";
        say("pwMsg", "Mot de passe modifié.", "ok");
      } catch (err) { say("pwMsg", frError(err)); }
    });
  });

  /* ---------- compte anonyme → compte permanent ---------- */
  $("secForm").addEventListener("submit", e => {
    e.preventDefault();
    const em = $("secEmail").value.trim(), a = $("secPw1").value, b = $("secPw2").value;
    if (!EMAIL.test(em)) { say("secMsg", "Indique une adresse e-mail valide."); $("secEmail").focus(); return; }
    const weak = A.passwordProblem(a);
    if (weak) { say("secMsg", weak); $("secPw1").focus(); return; }
    if (a !== b) { say("secMsg", "Les deux mots de passe ne sont pas identiques."); $("secPw2").focus(); return; }
    busy($("secBtn"), async () => {
      try {
        await A.secureAccount(em, a);
        $("secPw1").value = ""; $("secPw2").value = "";
        say("secMsg", "Compte sécurisé. Tu peux maintenant te connecter avec " + em + " sur n'importe quel appareil.", "ok");
        // La page se recharge en compte normal (sections e-mail et mot de passe).
        setTimeout(() => location.replace(location.pathname + location.search), 1800);
      } catch (err) { say("secMsg", frError(err)); }
    });
  });

  /* ---------- connecteurs ---------- */
  async function copy(text, input) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      if (input && input.select) { input.focus(); input.select(); try { return document.execCommand("copy"); } catch (x) { return false; } }
      return false;
    }
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-copy]"); if (!b) return;
    const el = $(b.dataset.copy);
    const ok = await copy(el.value != null ? el.value : el.textContent, el.value != null ? el : null);
    say("copyMsg", ok ? "Copié dans le presse-papiers." : "Copie impossible : sélectionne le texte et copie-le (Ctrl+C ou ⌘C).", ok ? "ok" : "err");
  });

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const frDate = d => { try { return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return ""; } };

  // API OAuth serveur de supabase-js (récente) : auth.oauth.listGrants / revokeGrant. Absente des anciennes versions.
  const oauth = () => (client && client.auth && client.auth.oauth) || null;
  async function loadGrants() {
    const box = $("grants"), oa = oauth();
    if (!oa || typeof oa.listGrants !== "function") {
      box.innerHTML = '<p class="muted small">La liste des applications autorisées arrive bientôt. En attendant, tu peux retirer un connecteur depuis les réglages de Claude, ou changer de mot de passe pour couper tous les accès.</p>';
      return;
    }
    try {
      const data = await run(oa.listGrants());
      const list = Array.isArray(data) ? data : (data && (data.grants || data.items)) || [];
      if (!list.length) { box.innerHTML = '<p class="muted small">Aucune application autorisée pour le moment.</p>'; return; }
      box.innerHTML = '<ul class="grants">' + list.map(g => {
        const c = g.client || {};
        const id = c.id || c.client_id || g.client_id || "";
        const name = c.name || c.client_name || g.client_name || id || "Application";
        const when = g.granted_at || g.created_at || g.updated_at;
        const scopes = Array.isArray(g.scopes) ? g.scopes.join(", ") : g.scope || "";
        return "<li><span><b>" + esc(name) + "</b>" + (when ? '<br><span class="muted small">Autorisée le ' + esc(frDate(when)) + (scopes ? " · " + esc(scopes) : "") + "</span>" : "") + "</span>" +
          (typeof oa.revokeGrant === "function" && id ? '<button type="button" class="btn ghost" data-revoke="' + esc(id) + '" data-name="' + esc(name) + '">Révoquer</button>' : "") + "</li>";
      }).join("") + "</ul>";
    } catch (err) {
      box.innerHTML = "";
      say("grantMsg", "Liste des applications indisponible : " + frError(err));
    }
  }
  $("grants").addEventListener("click", e => {
    const b = e.target.closest("[data-revoke]"); if (!b) return;
    busy(b, async () => {
      try {
        await run(oauth().revokeGrant({ clientId: b.dataset.revoke }));
        // l'accès protégé par le code de ce client (0033) part avec lui ; sans effet s'il n'y en a pas
        try { await run(client.rpc("revoquer_connecteur", { p_client_id: b.dataset.revoke })); } catch (x) { /* table absente : rien à retirer */ }
        say("grantMsg", "Accès retiré à " + b.dataset.name + ".", "ok");
        await loadGrants();
        await loadAccords();
      } catch (err) { say("grantMsg", frError(err)); }
    });
  });

  /* ---------- accès des connecteurs protégés par le code (0033) ---------- */
  const ACCORDS_SELECT = "id, client_id, client_nom, accorde_le, expire_le, lie_le, dernier_usage, revoque_le";
  async function loadAccords() {
    const box = $("accords");
    let rows;
    try { rows = await run(client.from("connecteurs_autorises").select(ACCORDS_SELECT).order("accorde_le", { ascending: false })); }
    catch (err) { box.hidden = true; box.innerHTML = ""; return; } // table absente (0033 non appliquée) : rien à montrer
    const liste = (Array.isArray(rows) ? rows : []).filter(r => r && !r.revoque_le);
    if (!liste.length) { box.hidden = true; box.innerHTML = ""; return; }
    const maintenant = Date.now();
    box.innerHTML = '<h3 style="margin:14px 0 6px;font:700 15px var(--f-display)">Accès protégés par ton code</h3>' +
      '<p class="muted small">Accordés sur la page d\'autorisation après ton code à 6 chiffres. Le connecteur lit aussi tes comptes bancaires, sans pouvoir les modifier.</p>' +
      '<ul class="grants">' + liste.map(r => {
        const name = r.client_nom || "Application";
        const expire = new Date(r.expire_le).getTime() <= maintenant;
        const etat = expire
          ? "expiré le " + frDate(r.expire_le) + " : reconnecte le connecteur et saisis ton code pour le rouvrir"
          : "autorisé le " + frDate(r.accorde_le) + " · valable jusqu'au " + frDate(r.expire_le) + (r.dernier_usage ? " · dernier usage le " + frDate(r.dernier_usage) : "");
        return "<li><span><b>" + esc(name) + '</b><br><span class="muted small">' + esc(etat) + "</span></span>" +
          (expire ? "" : '<button type="button" class="btn ghost" data-retirer="' + esc(r.client_id) + '" data-name="' + esc(name) + '">Retirer</button>') + "</li>";
      }).join("") + "</ul>";
    box.hidden = false;
  }
  $("accords").addEventListener("click", e => {
    const b = e.target.closest("[data-retirer]"); if (!b) return;
    busy(b, async () => {
      try {
        await run(client.rpc("revoquer_connecteur", { p_client_id: b.dataset.retirer }));
        say("accordMsg", "Accès retiré à " + b.dataset.name + ". Pour le rouvrir, reconnecte le connecteur dans Claude et saisis ton code.", "ok");
        await loadAccords();
      } catch (err) { say("accordMsg", frError(err)); }
    });
  });

  /* ---------- export ---------- */
  $("exportJson").addEventListener("click", e => busy(e.currentTarget, async () => {
    try {
      const data = await run(client.rpc("export_all"));
      download("boussole-export-" + today() + ".json", JSON.stringify(data, null, 2), "application/json");
      say("dataMsg", "Export téléchargé.", "ok");
    } catch (err) { say("dataMsg", frError(err)); }
  }));

  // CSV au format de l'import : séparateur « ; », virgule décimale, titulaire par prénom, BOM pour Excel.
  const dec = v => (v == null || v === "" || !isFinite(+v) ? "" : String(Math.round(+v * 1e6) / 1e6).replace(".", ","));
  const cell = v => { const s = String(v ?? ""); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  $("exportCsv").addEventListener("click", e => busy(e.currentTarget, async () => {
    try {
      const rows = await run(client.from("positions").select("name, isin, envelope, owner, bloc, mode, qty, pru, price_override, value, value_date, status, note, instruments(price, price_date)").order("created_at"));
      const head = ["nom", "isin", "enveloppe", "titulaire", "poche", "quantite", "pru", "valeur", "statut", "cours", "date_cours", "note"];
      const lines = (rows || []).map(r => {
        const ins = r.instruments || {};
        // Même règle que store-supabase.js : le prix saisi l'emporte s'il est au moins aussi récent que le cours.
        const useOv = r.price_override != null && (!ins.price_date || !r.value_date || r.value_date >= ins.price_date);
        const price = useOv ? r.price_override : ins.price, priceDate = useOv ? r.value_date : ins.price_date;
        const valeur = r.mode === "market" ? (r.qty != null && price != null ? Math.round(r.qty * price * 100) / 100 : null) : r.value;
        const who = (people[r.owner] && people[r.owner].nom) || r.owner;
        return [r.name, r.isin || "", r.envelope, who, r.bloc, dec(r.mode === "market" ? r.qty : null), dec(r.mode === "market" ? r.pru : null), dec(valeur), r.status,
          r.mode === "market" ? dec(price) : "", r.mode === "market" ? priceDate || "" : r.value_date || "", r.note || ""].map(cell).join(";");
      });
      download("boussole-placements-" + today() + ".csv", "﻿" + [head.join(";"), ...lines].join("\r\n") + "\r\n", "text/csv;charset=utf-8");
      say("dataMsg", (rows || []).length ? "Fichier de " + rows.length + " placement" + (rows.length > 1 ? "s" : "") + " téléchargé." : "Aucun placement : le fichier ne contient que l'en-tête.", "ok");
    } catch (err) { say("dataMsg", frError(err)); }
  }));

  /* ---------- suppression ---------- */
  const SUPPR_SESSION = "Ta session a expiré. Reconnecte-toi, puis recommence la suppression. Ton compte est conservé.";
  const SUPPR_RESEAU = "Suppression impossible : connexion au serveur impossible. Ton compte est conservé. Vérifie ta connexion internet et réessaie.";
  const SUPPR_POWENS = "Suppression impossible : la déconnexion de tes banques (Powens) n'a pas abouti, ton compte est conservé. Réessaie dans un instant.";
  /* Supprime l'utilisateur Powens (et ses connexions) → null si c'est fait (ou s'il n'y avait rien), sinon le message qui bloque. */
  async function supprimerBanque() {
    let s = null;
    try { s = A && typeof A.session === "function" ? await A.session() : null; } catch (e) { s = null; }
    const jeton = s && s.access_token;
    if (!jeton) return SUPPR_SESSION;
    let r;
    try {
      r = await fetch(POWENS_URL + "/supprimer", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + jeton }, body: "{}" });
    } catch (e) { return SUPPR_RESEAU; }
    if (r.status === 401) return SUPPR_SESSION;
    return r.ok ? null : SUPPR_POWENS;
  }
  // Compte anonyme : pas d'adresse à retaper, on demande « SUPPRIMER ».
  const matches = () => !!user && (anon
    ? $("delConfirm").value.trim().toUpperCase() === "SUPPRIMER"
    : $("delConfirm").value.trim().toLowerCase() === String(user.email || "").toLowerCase());
  $("delConfirm").addEventListener("input", () => { $("delBtn").disabled = !matches(); });
  $("delForm").addEventListener("submit", e => {
    e.preventDefault();
    if (!matches()) return;
    const btn = $("delBtn");
    btn.disabled = true; btn.textContent = "Suppression…";
    (async () => {
      // Banques connectées d'abord, toujours : sans cela, l'utilisateur Powens et ses connexions survivraient au compte.
      const bloque = await supprimerBanque();
      if (bloque) {
        btn.textContent = "Supprimer définitivement"; btn.disabled = !matches();
        say("delMsg", bloque);
        return;
      }
      try {
        await run(client.rpc("delete_me"));
      } catch (err) {
        btn.textContent = "Supprimer définitivement"; btn.disabled = !matches();
        say("delMsg", "Suppression impossible : " + frError(err));
        return;
      }
      // Le compte n'existe plus : la déconnexion serveur peut échouer, on vide au moins la session locale.
      try { await A.signOut(); } catch (x) { try { await client.auth.signOut({ scope: "local" }); } catch (y) { /* rien */ } }
      location.replace(A.urls.home() + "?compte-supprime");
    })();
  });

  /* ---------- déconnexion ---------- */
  $("signOut").addEventListener("click", e => busy(e.currentTarget, async () => {
    try { await A.signOut(); } catch (err) { try { await client.auth.signOut({ scope: "local" }); } catch (x) { /* rien */ } }
    location.href = A.urls.home();
  }));

  /* ---------- démarrage ---------- */
  (async () => {
    if (!A || !A.client) { $("who").textContent = "Connexion au serveur impossible. Recharge la page dans un instant."; return; }
    const s = await A.requireSession({ demoOk: false });
    if (!s) return; // redirection vers index.html#connexion en cours
    client = A.client; user = s.user;
    anon = A.isAnonymous(s);
    // SEC2 : un compte qui a activé la double authentification valide son code avant d'accéder à cette page (retirer un appareil exige aal2).
    // Échec fermé : niveau illisible → la garde reste affichée (message + « Réessayer ») ; sans moyen de l'afficher (false), la page ne s'ouvre pas.
    if (A.mfa && window.Mfa) {
      const passe = await window.Mfa.exiger(A.mfa, { onQuitter: async () => { try { await A.signOut(); } catch (e) { try { await client.auth.signOut({ scope: "local" }); } catch (x) { /* rien */ } } location.href = A.urls.home(); } });
      if (passe === false) { $("who").textContent = "Impossible de vérifier ta double authentification. Recharge la page."; return; }
    }
    $("who").textContent = anon ? "Compte sans e-mail, lié à ce navigateur." : "Connecté avec " + (user.email || "ton compte") + ".";
    $("securiser").hidden = !anon;
    $("cardEmail").hidden = anon; $("cardPw").hidden = anon;
    $("mcpAnon").hidden = !anon;
    if (EMAILS) $("emailNote").hidden = true;
    if (anon) {
      $("delLabel").textContent = "Tape SUPPRIMER pour confirmer";
      $("delConfirm").type = "text";
    }
    $("curEmail").textContent = user.email || "—";
    $("pwUser").value = user.email || "";
    $("main").hidden = false;
    // Section Double authentification : appareils, inscription par QR code, second appareil. Compte anonyme : phrase et lien « sécuriser » seulement.
    if (A.mfa && window.Mfa) window.Mfa.monterSecurite($("mfaBox"), A.mfa, { anonyme: anon, lienSecuriser: "#securiser", email: user.email || "" });
    else $("securite").hidden = true;
    if (location.hash === "#securite" && $("securite").scrollIntoView) $("securite").scrollIntoView();
    if (anon && location.hash === "#securiser") $("secEmail").focus();
    A.onChange((ev, sess) => {
      if (!sess) { location.replace(A.urls.connexion()); return; }
      user = sess.user; $("curEmail").textContent = user.email || "—"; $("delBtn").disabled = !matches();
    });
    loadGrants();
    loadAccords();
    try { const p = await run(client.from("profiles").select("personnes").maybeSingle()); people = (p && p.personnes) || {}; } catch (e) { people = {}; }
  })();
})();
