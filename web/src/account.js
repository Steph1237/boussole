/* Page « Mon compte » (compte.html) : e-mail, mot de passe, connecteurs d'assistant, export, suppression.
   Dépend de window.Auth (auth.js). Toutes les lectures passent par le client de la session : RLS borne tout
   au compte courant. Suppression : RPC delete_me() (security definer, supprime auth.users → cascade). */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const A = window.Auth || null;
  let client = null, user = null, people = {};

  /* ---------- messages ---------- */
  function frError(e) {
    const code = String((e && (e.code || (e.cause && (e.cause.code || e.cause.status)) || e.status)) || "");
    const m = String((e && e.message) || "");
    const is = (codes, re) => codes.includes(code) || (re && re.test(m));
    if (is(["same_password"], /different from the old/i)) return "Le nouveau mot de passe doit être différent de l'ancien.";
    if (is(["weak_password"], /password should|weak password/i)) return "Mot de passe trop faible : 8 caractères au moins, avec des lettres et des chiffres.";
    if (is(["reauthentication_needed"], /reauthentic/i)) return "Pour des raisons de sécurité, déconnectez-vous puis reconnectez-vous avant de changer de mot de passe.";
    if (is(["email_exists", "user_already_exists"], /already (registered|been registered|exists)/i)) return "Cette adresse est déjà utilisée par un autre compte.";
    if (is(["email_address_invalid"], /invalid.*email|email.*invalid|unable to validate email/i)) return "Adresse e-mail invalide.";
    if (is(["over_email_send_rate_limit", "over_request_rate_limit", "429"], /rate limit|too many/i)) return "Trop de demandes en peu de temps. Patientez quelques minutes avant de réessayer.";
    if (is(["session_not_found", "bad_jwt", "401", "403"], /jwt|session/i)) return "Votre session a expiré. Reconnectez-vous.";
    if (is(["network"], /fetch|network|failed to load/i)) return "Connexion au serveur impossible. Vérifiez votre connexion internet et réessayez.";
    return "Une erreur est survenue" + (m ? " (" + m + ")" : "") + ". Réessayez.";
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
    if (!EMAIL.test(v)) { say("emailMsg", "Indiquez une adresse e-mail valide."); return; }
    if (user && v.toLowerCase() === String(user.email || "").toLowerCase()) { say("emailMsg", "C'est déjà votre adresse actuelle."); return; }
    busy(e.submitter || $("emailForm").querySelector("button"), async () => {
      try {
        await run(client.auth.updateUser({ email: v }, { emailRedirectTo: location.href.split("#")[0] }));
        say("emailMsg", "Un lien de confirmation a été envoyé à " + v + ". Le changement prend effet quand vous l'ouvrez (un second lien peut aussi être envoyé à votre adresse actuelle).", "ok");
        $("newEmail").value = "";
      } catch (err) { say("emailMsg", frError(err)); }
    });
  });

  /* ---------- mot de passe ---------- */
  $("pwForm").addEventListener("submit", e => {
    e.preventDefault();
    const a = $("pw1").value, b = $("pw2").value;
    if (a.length < 8) { say("pwMsg", "Choisissez un mot de passe d'au moins 8 caractères."); return; }
    if (a !== b) { say("pwMsg", "Les deux mots de passe ne sont pas identiques."); return; }
    busy(e.submitter || $("pwForm").querySelector("button"), async () => {
      try {
        await run(client.auth.updateUser({ password: a }));
        $("pw1").value = ""; $("pw2").value = "";
        say("pwMsg", "Mot de passe modifié.", "ok");
      } catch (err) { say("pwMsg", frError(err)); }
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
    say("copyMsg", ok ? "Copié dans le presse-papiers." : "Copie impossible : sélectionnez le texte et copiez-le (Ctrl+C ou ⌘C).", ok ? "ok" : "err");
  });

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const frDate = d => { try { return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return ""; } };

  // API OAuth serveur de supabase-js (récente) : auth.oauth.listGrants / revokeGrant. Absente des anciennes versions.
  const oauth = () => (client && client.auth && client.auth.oauth) || null;
  async function loadGrants() {
    const box = $("grants"), oa = oauth();
    if (!oa || typeof oa.listGrants !== "function") {
      box.innerHTML = '<p class="muted small">La liste des applications autorisées arrive bientôt. En attendant, vous pouvez retirer un connecteur depuis les réglages de Claude, ou changer de mot de passe pour couper tous les accès.</p>';
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
        say("grantMsg", "Accès retiré à " + b.dataset.name + ".", "ok");
        await loadGrants();
      } catch (err) { say("grantMsg", frError(err)); }
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
  const matches = () => !!user && $("delConfirm").value.trim().toLowerCase() === String(user.email || "").toLowerCase();
  $("delConfirm").addEventListener("input", () => { $("delBtn").disabled = !matches(); });
  $("delForm").addEventListener("submit", e => {
    e.preventDefault();
    if (!matches()) return;
    const btn = $("delBtn");
    btn.disabled = true; btn.textContent = "Suppression…";
    (async () => {
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
    if (!A || !A.client) { $("who").textContent = "Connexion au serveur impossible. Rechargez la page dans un instant."; return; }
    const s = await A.requireSession({ demoOk: false });
    if (!s) return; // redirection vers index.html#connexion en cours
    client = A.client; user = s.user;
    $("who").textContent = "Connecté avec " + (user.email || "votre compte") + ".";
    $("curEmail").textContent = user.email || "—";
    $("pwUser").value = user.email || "";
    $("main").hidden = false;
    A.onChange((ev, sess) => {
      if (!sess) { location.replace(A.urls.connexion()); return; }
      user = sess.user; $("curEmail").textContent = user.email || "—"; $("delBtn").disabled = !matches();
    });
    loadGrants();
    try { const p = await run(client.from("profiles").select("personnes").maybeSingle()); people = (p && p.personnes) || {}; } catch (e) { people = {}; }
  })();
})();
