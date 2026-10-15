/* Accueil : assistant de bienvenue en 4 étapes, ouvert par l'app à la première connexion (tant que l'onboarding
   n'est pas terminé) et à tout moment depuis Compte › Connexion (« Revoir l'accueil »). Boussole fonctionne avec un assistant
   (Claude disponible, ChatGPT bientôt) : aucun formulaire de saisie ici, la seule écriture est « onboarding terminé ».
   1. Bienvenue (promesses, assistants)  2. Connecter Claude (voyant en direct)  3. Lancer l'entretien  4. Suivre et valider
   (avec le voyant de la revue mensuelle : « Revue mensuelle active — prochaine le JJ/MM », « en pause » ou « en retard de N jours »,
   lu dans Store.get().routines, état par RoutineEtat.etat ; voyantRoutine est pur et testé).

   window.Accueil = { open({ onDone, etape }), connexion(el), reporte(), estConnecte(…), voyantRoutine(routines, auj?), lienClaude, ETAPES }
   - onDone() après « Terminer » (étape 4, qui marque l'onboarding fait par Store.markOnboarded()).
   - etape : étape de départ (1 à 4) ; par défaut, celle mémorisée dans localStorage « accueil-etape-v2 »
     (« accueil-etape-v2-demo » en démo, pour ne pas mélanger la démo et le compte réel).
   - connexion(el) : bloc « Connecter Claude » (onglets claude.ai / Claude Code, valeurs à copier, pièges), sans le voyant,
     réutilisé par la page Compte › Connexion.
   Voyant : Store.surveillerConnexions(true) tant que l'étape 2 est affichée, false en la quittant ; « Claude est connecté »
   dès que S.connexions = [{ clientId, clientNom, premierLe, dernierLe, appels }] contient un client. Sans ce contrat
   (store plus ancien), un bouton « J'ai terminé » le remplace. Échap ou « Reprendre plus tard » ferme sans rien marquer. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Accueil = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  const ETAPES = ["Bienvenue", "Connecter Claude", "Lancer l'entretien", "Suivre et valider"];
  const N = ETAPES.length, CONNEXION = 2, ENTRETIEN = 3, SUIVI = 4;
  /* Une seule phrase : celle qui s'affiche à copier (étape 3) est exactement celle que « Ouvrir Claude » envoie. */
  const PROMPT_CLAUDE = "Utilise le connecteur Boussole : lance l'onboarding avec l'outil demarrer_onboarding.";
  const lienClaude = prompt => "https://claude.ai/new?q=" + encodeURIComponent(prompt);
  /* « -v2 » : l'ancienne clé numérotait 5 étapes (avec le choix de l'assistant). */
  const CLE_ETAPE = "accueil-etape-v2", CLE_ETAPE_DEMO = CLE_ETAPE + "-demo", CLE_ANCIENNE = "accueil-etape", CLE_REPORT = "accueil-plus-tard";

  /* Connecté : une connexion vue depuis l'ouverture de l'assistant (marge d'une minute pour l'écart d'horloge),
     ou n'importe laquelle si l'utilisateur était déjà connecté avant d'ouvrir l'assistant. Pur, testé. */
  function estConnecte(connexions, ouvertLe, auDepart) {
    const c = Array.isArray(connexions) ? connexions : [];
    if (!c.length) return null;
    const tri = c.slice().sort((a, b) => (Date.parse(b.dernierLe) || 0) - (Date.parse(a.dernierLe) || 0));
    if (auDepart) return tri[0];
    return tri.find(x => (Date.parse(x.dernierLe) || 0) >= (ouvertLe || 0) - 60e3) || null;
  }

  const config = () => {
    const B = (root && root.BOUSSOLE) || {};
    return { url: B.mcpUrl || "", clientId: (B.claude && B.claude.clientId) || "" };
  };
  const store = () => (root && root.Store) || null;
  const lire = k => { try { return root.localStorage.getItem(k); } catch (e) { return null; } };
  const ecrire = (k, v) => { try { if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, String(v)); } catch (e) { /* stockage indisponible */ } };
  /* « Reprendre plus tard » : pas de réouverture automatique pendant la session de l'onglet. */
  function reporte() { try { return root.sessionStorage.getItem(CLE_REPORT) === "1"; } catch (e) { return false; } }
  const reporter = () => { try { root.sessionStorage.setItem(CLE_REPORT, "1"); } catch (e) { /* rien */ } };

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ICON = {
    bilan: '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>',
    diag: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
    simu: '<path d="M12 4v16M8 20h8M5 8h14M5 8l-2.5 6a2.5 2.5 0 0 0 5 0zM19 8l-2.5 6a2.5 2.5 0 0 0 5 0z"/>',
    livre: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20"/><path d="M8 7h8M8 11h6"/>',
    cadenas: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    main: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    copie: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alerte: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/>',
    claude: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
    bulle: '<path d="M4 5h16v11H9l-5 4z"/>',
    agenda: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  };
  const svg = (k, cls) => '<svg class="' + (cls || "ac-ico") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICON[k] + "</svg>";

  /* Voyant de la revue mensuelle (étape 4), lu dans Store.get().routines (undefined = pas encore lu). État par RoutineEtat.etat
     (routine-etat.js, chargé avant ce fichier ; module voisin sous Node), au jour de Paris par défaut. Pur, testé.
     → { actif, code, texte } ; code = celui de RoutineEtat (retard : « en retard de N jours » / « due aujourd'hui »). */
  const RE = () => (root && root.RoutineEtat) ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./routine-etat.js") : null);
  const jjmm = iso => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : "");
  function voyantRoutine(routines, auj) {
    const E = RE().etat(routines, auj == null ? RE().aujParis() : auj), code = E.code;
    if (code === "retard") return { actif: true, code, texte: E.retard > 0 ? "Revue mensuelle en retard de " + E.retard + " jour" + (E.retard > 1 ? "s" : "") : "Revue mensuelle due aujourd'hui" };
    if (code === "a_jour" || code === "prete") return { actif: true, code, texte: "Revue mensuelle active" + (jjmm(E.prochain) ? " — prochaine le " + jjmm(E.prochain) : "") };
    if (code === "pause") return { actif: false, code, texte: "Revue mensuelle en pause : tu peux la réactiver dans Compte › Connexion." };
    return { actif: false, code, texte: "Ta revue mensuelle s'activera à la fin de ton entretien avec Claude." };
  }
  /* Signature de la zone annoncée (role=status) : réécrite seulement quand elle change (comparer innerHTML ne marche pas : le
     navigateur resérialise le SVG autrement, la zone serait réécrite et réannoncée à chaque publication du store). */
  const sigRevue = v => v.actif + "|" + v.texte;
  function revueHtml(routines) {
    const v = voyantRoutine(routines);
    if (v.code === "retard") return svg("alerte", "ac-ico lg") + "<p><b>" + esc(v.texte) + "</b><span>Lance-la avec Claude depuis Aujourd'hui ou Compte › Connexion.</span></p>";
    return svg(v.actif ? "main" : "agenda", "ac-ico lg") + "<p>" + (v.actif ? "<b>" + esc(v.texte) + "</b><span>Claude prépare ta revue chaque mois ; tu réponds ensuite à ses questions.</span>"
      : "<b>Revue mensuelle</b><span>" + esc(v.texte) + "</span>") + "</p>";
  }
  const classeRevue = v => (v.code === "retard" ? " retard" : v.actif ? " on" : "");

  async function copier(text, el) {
    try { if (!navigator.clipboard) throw new Error("indisponible"); await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); try { return document.execCommand("copy"); } catch (x) { return false; } }
      return false;
    }
  }
  function flash(b, ok) {
    if (!b.dataset.html) b.dataset.html = b.innerHTML;
    b.textContent = ok ? "Copié ✓" : "Sélectionné : ⌘C ou Ctrl+C";
    clearTimeout(b._t); b._t = setTimeout(() => { b.innerHTML = b.dataset.html; delete b.dataset.html; }, 2000);
  }
  let seq = 0;
  /* Valeur à copier : libellé, valeur affichée (code), bouton. */
  const champ = (id, label, valeur, note) =>
    '<div class="ac-champ"><span class="ac-champ-l" id="' + id + '-l">' + label + "</span>" +
    '<div class="ac-copyline"><code class="ac-val" id="' + id + '">' + esc(valeur) + "</code>" +
    '<button type="button" class="ac-btn ghost sm" data-copie="' + id + '" aria-describedby="' + id + '-l">' + svg("copie") + "Copier</button></div>" +
    (note ? '<span class="ac-champ-n">' + note + "</span>" : "") + "</div>";

  /* ---------- bloc « Connecter Claude » (partagé avec la page Compte › Connexion) ---------- */
  function connexionHtml(id) {
    const c = config();
    const tab = (k, t, on) => '<button type="button" role="tab" id="' + id + "-t-" + k + '" aria-controls="' + id + "-p-" + k + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-onglet="' + k + '">' + t + "</button>";
    return '<div class="ac-cx">' +
      '<div class="ac-tabs" role="tablist" aria-label="Où utilises-tu Claude ?">' + tab("web", "claude.ai / Desktop", true) + tab("code", "Claude Code", false) + "</div>" +
      '<div class="ac-panel" role="tabpanel" id="' + id + '-p-web" aria-labelledby="' + id + '-t-web">' +
        '<ol class="ac-steps">' +
          "<li><b>Ouvre Claude</b> sur claude.ai ou dans l'application, puis va dans " +
            '<span class="ac-path"><kbd>Paramètres</kbd> → <kbd>Connecteurs</kbd> → <kbd>Ajouter</kbd> → <kbd>Ajouter un connecteur personnalisé</kbd></span>.</li>' +
          "<li><b>Remplis le formulaire de Claude</b> avec ces valeurs :" +
            champ(id + "-nom", "Nom", "Boussole") +
            champ(id + "-url", "URL", c.url) + "</li>" +
          /* Libellés entre <kbd> : ceux de l'interface de Claude, cités tels quels (« Utiliser votre propre client OAuth » compris). */
          "<li><b>Choisis</b> :" +
            '<ul class="ac-choix"><li>Authentification : <kbd>Se connecter maintenant</kbd></li><li>Client OAuth : <kbd>Utiliser votre propre client OAuth</kbd></li></ul>' +
            champ(id + "-cid", "Identifiant client", c.clientId, "Laisse le secret vide.") + "</li>" +
          "<li><b>Valide</b> : clique <kbd>Ajouter</kbd>, puis <kbd>Se connecter</kbd>.</li>" +
          "<li><b>Autorise</b> : la page de Boussole s'ouvre ; vérifie ton compte et clique <kbd>Autoriser</kbd>.</li>" +
        "</ol>" +
        '<div class="ac-pieges" role="note"><p class="ac-pieges-t">' + svg("alerte") + "Pièges fréquents</p><ul>" +
          "<li>Ne mets pas ton e-mail comme identifiant : colle l'identifiant client ci-dessus.</li>" +
          "<li>Laisse le champ secret vide.</li>" +
          "<li>Si Claude affiche « A cessé de fonctionner », clique <kbd>Se reconnecter</kbd>.</li>" +
        "</ul></div>" +
      "</div>" +
      '<div class="ac-panel" role="tabpanel" id="' + id + '-p-code" aria-labelledby="' + id + '-t-code" hidden>' +
        '<ol class="ac-steps">' +
          "<li><b>Dans un terminal</b>, ajoute le connecteur :" + champ(id + "-cmd", "Commande", "claude mcp add boussole -t http " + c.url) + "</li>" +
          "<li><b>Dans Claude Code</b>, tape <kbd>/mcp</kbd>, choisis <kbd>boussole</kbd> puis authentifie-toi et autorise l'accès." +
            champ(id + "-cid2", "Identifiant client", c.clientId, "Si Claude Code le demande, colle le même identifiant ; laisse le secret vide.") + "</li>" +
        "</ol>" +
      "</div>" +
    "</div>";
  }
  /* Comportements du bloc : onglets (clic, flèches) et boutons de copie. */
  function lierConnexion(box, annoncer) {
    const choisir = (k, focus) => {
      box.querySelectorAll("[data-onglet]").forEach(t => { const on = t.dataset.onglet === k; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
      box.querySelectorAll(".ac-panel").forEach(p => { p.hidden = !p.id.endsWith("-p-" + k); });
    };
    box.addEventListener("click", async e => {
      const t = e.target.closest("[data-onglet]"); if (t) { choisir(t.dataset.onglet); return; }
      const b = e.target.closest("[data-copie]"); if (!b) return;
      const el = box.querySelector("#" + b.dataset.copie) || (box.ownerDocument || document).getElementById(b.dataset.copie);
      const ok = await copier(el ? el.textContent : "", el);
      flash(b, ok);
      if (annoncer) annoncer(ok ? "Copié dans le presse-papiers." : "Copie impossible : le texte est sélectionné, copie-le avec Ctrl+C ou ⌘C.");
    });
    box.addEventListener("keydown", e => {
      const t = e.target.closest("[data-onglet]"); if (!t) return;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      choisir(t.dataset.onglet === "web" ? "code" : "web", true);
    });
  }
  function connexion(el) {
    if (!el) return;
    const id = "acx" + (++seq);
    el.classList.add("accueil");
    el.innerHTML = connexionHtml(id) + '<p class="ac-sr" role="status" aria-live="polite"></p>';
    const live = el.querySelector(".ac-sr[role=status]");
    lierConnexion(el, m => { live.textContent = m; });
  }

  /* ---------- assistant ---------- */
  let courant = null, abonne = false;
  function abonner() {
    const St = store();
    if (abonne || !St || typeof St.on !== "function") return;
    abonne = true;
    St.on(S => { if (courant) courant.maj(S); });
  }

  function open(opts) {
    const o = opts || {};
    if (courant && courant.api.dialog.open && courant.api.dialog.isConnected) { courant.focus(); return courant.api; }
    const id = "ac" + (++seq);
    const ouvertLe = Date.now();
    const St = store();
    const S0 = St && St.get ? St.get() : {};
    const surveillable = !!(St && typeof St.surveillerConnexions === "function");
    const auDepart = Array.isArray(S0.connexions) && S0.connexions.length > 0;
    const demo = !!(St && St.mode === "demo");
    /* Étape mémorisée : clé distincte en démo, pour que la démo ne fasse pas reprendre le vrai compte à l'étape 3 ou 4. */
    const cleEtape = demo ? CLE_ETAPE_DEMO : CLE_ETAPE;
    /* Élément qui avait le focus à l'ouverture (ex. « Revoir l'accueil ») : on le lui rend à la fermeture. */
    const origine = document.activeElement;
    ecrire(CLE_ANCIENNE, null);
    let etape = Math.min(N, Math.max(1, parseInt(o.etape || lire(cleEtape), 10) || 1));
    let S = S0, connecte = null, manuel = false, anon = false, surveille = false, fini = false;

    const dlg = document.createElement("dialog");
    dlg.className = "accueil";
    dlg.setAttribute("aria-labelledby", id + "-h");
    document.body.appendChild(dlg);
    const $ = s => dlg.querySelector(s);

    /* ---- étapes ---- */
    function e1() {
      const promesse = (ic, t, d) => '<li class="ac-promesse">' + svg(ic, "ac-ico lg") + "<div><b>" + t + "</b><span>" + d + "</span></div></li>";
      const benef = (ic, t) => "<li>" + svg(ic) + "<span>" + t + "</span></li>";
      const assistant = (ic, nom, badge, d, dispo) => '<li class="ac-assistant' + (dispo ? " reco" : " off") + '">' + svg(ic, "ac-ico xl") +
        '<span class="ac-card-t"><b>' + nom + '</b><span class="ac-badge' + (dispo ? " ok" : "") + '">' + badge + "</span></span>" +
        '<span class="ac-card-d">' + d + "</span></li>";
      return '<p class="ac-lead">Boussole rassemble ton patrimoine en un seul endroit et t\'aide à y voir clair.</p>' +
        '<ul class="ac-benefs">' +
          benef("bilan", "<b>Un bilan réel</b> : tes comptes, biens, crédits et placements, à jour.") +
          benef("diag", "<b>Un diagnostic</b> : est-ce que ta situation est saine, et pourquoi.") +
          benef("simu", "<b>Des simulations</b> : acheter, épargner, anticiper, chiffres à l'appui.") +
        "</ul>" +
        '<ul class="ac-promesses">' +
          promesse("livre", "Pédagogique", "Boussole explique ; ce n'est pas du conseil en investissement réglementé.") +
          promesse("cadenas", "Privé", "Tes données ne sont visibles que par toi.") +
          promesse("main", "Tu valides", "Claude propose, tu valides.") +
          promesse("pause", "Interruptible", "Environ 15 minutes, reprends quand tu veux.") +
        "</ul>" +
        '<h3 class="ac-sous-titre">Boussole fonctionne avec Claude</h3>' +
        '<p class="ac-fine">Claude te pose les questions, lit les relevés que tu lui donnes et prépare ton bilan ; Boussole l\'affiche et te fait valider chaque changement.</p>' +
        '<ul class="ac-assistants" aria-label="Compatibles avec Boussole">' +
          assistant("claude", "Claude", "Disponible", "Connexion sécurisée en quelques minutes, à l'étape suivante.", true) +
          assistant("bulle", "ChatGPT", "Bientôt", "La connexion sécurisée pour ChatGPT arrive prochainement.", false) +
        "</ul>" +
        '<p class="ac-fine">Tes réponses transitent par Claude, selon ses propres conditions d\'utilisation.</p>';
    }
    function e2() {
      if (anon) {
        return '<div class="ac-anon"><h3>Sécurise d\'abord ton compte</h3>' +
          "<p>Ton compte n'a pas encore d'e-mail : pour brancher Claude, ajoute d'abord un e-mail et un mot de passe. Tes données sont conservées.</p>" +
          '<a class="ac-btn" href="compte.html#securiser">Sécuriser mon compte</a></div>';
      }
      return '<p class="ac-lead">Une seule fois. Claude n\'accède qu\'à ton compte, après ton accord ; il ne peut ni exporter tes données ni supprimer ton compte.</p>' +
        (demo ? '<p class="ac-note">Tu es en démo : le connecteur fonctionne avec un vrai compte. ' + (surveillable ? "Ici, la connexion est simulée." : "") + "</p>" : "") +
        connexionHtml(id) +
        '<div class="ac-voyant" id="' + id + '-voyant"><div class="ac-voyant-etat" role="status" aria-live="polite"></div><div class="ac-voyant-act"></div></div>';
    }
    let cleVoyant = "";
    function voyant() {
      const v = $("#" + id + "-voyant"); if (!v) return;
      const cle = connecte ? "c" + connecte.dernierLe : manuel ? "m" : surveillable && Array.isArray(S.connexions) ? "w" : "x";
      if (v.querySelector(".ac-voyant-etat").firstChild && cle === cleVoyant) return;
      cleVoyant = cle;
      const heure = d => { const t = Date.parse(d); return Number.isFinite(t) ? new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""; };
      let etat, action = "";
      if (connecte || manuel) {
        const h = connecte ? heure(connecte.dernierLe) : "";
        etat = '<p class="ac-etat ok">' + svg("ok", "ac-ico ok") +
          "<span><b>" + (connecte ? "Claude est connecté" : "C'est noté") + "</b>" +
          (connecte ? (h ? '<span class="ac-etat-d">Dernier échange à ' + h + (connecte.clientNom && !/claude/i.test(connecte.clientNom) ? " · " + esc(connecte.clientNom) : "") + "</span>" : "")
            : '<span class="ac-etat-d">Passe à l\'étape suivante.</span>') + "</span></p>";
      } else if (surveillable && Array.isArray(S.connexions)) {
        etat = '<p class="ac-etat attente"><span class="ac-pulse" aria-hidden="true"></span>' +
          "<span><b>En attente de la connexion de Claude…</b>" +
          '<span class="ac-etat-d">Ce voyant passe au vert dès que Claude se connecte.</span></span></p>';
        action = '<button type="button" class="ac-link" data-act="manuel">Continuer sans attendre</button>';
      } else {
        etat = '<p class="ac-etat"><span><b>Une fois l\'accès autorisé, reviens ici.</b></span></p>';
        action = '<button type="button" class="ac-btn ghost" data-act="manuel">' + svg("ok") + "J'ai terminé</button>";
      }
      /* La zone annoncée (role=status) reste en place ; seul son contenu change. */
      v.querySelector(".ac-voyant-etat").innerHTML = etat;
      v.querySelector(".ac-voyant-act").innerHTML = action;
      pied();
    }
    function e3() {
      return '<p class="ac-lead">Claude va te poser les questions dans des formulaires interactifs et déposer ses propositions dans Boussole à la fin de chaque thème. Tu les valides ensuite ici.</p>' +
        '<ol class="ac-steps compact">' +
          "<li>Ouvre une nouvelle conversation avec Claude.</li>" +
          "<li>Écris ou colle cette phrase :" + champ(id + "-phrase", "Phrase", PROMPT_CLAUDE) + "</li>" +
          "<li>Réponds à ton rythme ; tu peux aussi déposer tes relevés bancaires ou l'export de ton courtier dans la conversation, t'arrêter et reprendre plus tard.</li>" +
        "</ol>" +
        '<div class="ac-cta"><a class="ac-btn lg" id="' + id + '-ouvrir" href="' + esc(lienClaude(PROMPT_CLAUDE)) + '" target="_blank" rel="noopener" data-act="ouvrir">' +
          svg("ext") + 'Ouvrir Claude<span class="ac-sr"> (nouvel onglet)</span></a>' +
          '<button type="button" class="ac-link" data-act="plus-tard">Je préfère commencer plus tard</button></div>';
    }
    function e4() {
      const vr = voyantRoutine(S && S.routines);
      return '<p class="ac-lead">Pendant l\'entretien, ton bilan se remplit ici. Rien n\'est enregistré sans ton accord.</p>' +
        '<div class="ac-suivi">' +
          '<div class="ac-jauge" id="' + id + '-jauge" role="img"></div>' +
          '<div class="ac-suivi-t"><p class="ac-suivi-l" id="' + id + '-jauge-t" aria-live="polite"></p>' +
          '<p class="ac-pending" id="' + id + '-pending" aria-live="polite"></p>' +
          '<button type="button" class="ac-btn ghost" data-act="examiner">Examiner les propositions</button></div>' +
        "</div>" +
        '<div class="ac-revue' + classeRevue(vr) + '" id="' + id + '-revue" data-sig="' + esc(sigRevue(vr)) + '" role="status" aria-live="polite">' + revueHtml(S && S.routines) + "</div>" +
        '<p class="ac-fine">Tu pourras relancer Claude à tout moment depuis Compte › Connexion.</p>';
    }
    function suivi() {
      const j = $("#" + id + "-jauge"); if (!j) return;
      const E = root.BilanEtat && S && S.ready !== false ? root.BilanEtat.etat(S) : null;
      const pct = E ? E.pourcentage : 0;
      const r = 34, c = 2 * Math.PI * r, f = Math.max(0, Math.min(100, pct)) / 100;
      j.innerHTML = '<svg viewBox="0 0 80 80" aria-hidden="true" focusable="false"><circle cx="40" cy="40" r="' + r + '" class="ac-ring-bg"/>' +
        '<circle cx="40" cy="40" r="' + r + '" class="ac-ring-fg" stroke-dasharray="' + (c * f).toFixed(1) + " " + c.toFixed(1) + '" transform="rotate(-90 40 40)"/></svg>' +
        '<span class="ac-ring-v">' + pct + "<small>%</small></span>";
      j.setAttribute("aria-label", "Bilan complet à " + pct + " %");
      $("#" + id + "-jauge-t").textContent = pct >= 100 ? "Ton bilan est complet." : "Ton bilan est complet à " + pct + " %.";
      const n = ((S && S.propositions) || []).filter(p => p.statut === "en_attente").length;
      const pe = $("#" + id + "-pending");
      pe.textContent = n ? n + " proposition" + (n > 1 ? "s" : "") + " de Claude en attente de ton accord" : "Aucune proposition en attente pour le moment.";
      pe.classList.toggle("has", n > 0);
      const rv = $("#" + id + "-revue");
      if (rv) {
        const v = voyantRoutine(S && S.routines), sig = sigRevue(v);
        if (rv.dataset.sig !== sig) { rv.dataset.sig = sig; rv.innerHTML = revueHtml(S && S.routines); }
        rv.classList.toggle("on", classeRevue(v) === " on"); rv.classList.toggle("retard", v.code === "retard");
      }
    }

    /* ---- rendu ---- */
    function pied() {
      const f = $(".ac-foot"); if (!f) return;
      const suiv = $('[data-act="suivant"]');
      if (suiv) suiv.disabled = etape === CONNEXION && (anon || !(connecte || manuel));
    }
    function surveiller(on) {
      if (!surveillable || on === surveille) return;
      surveille = on;
      try { St.surveillerConnexions(on); } catch (e) { console.warn("Boussole : surveillance des connexions", e); }
    }
    function render(focus) {
      ecrire(cleEtape, etape);
      const corps = [e1, e2, e3, e4][etape - 1]();
      const libSuiv = etape === 1 ? "Commencer" : etape === N ? "Terminer" : "Continuer";
      dlg.innerHTML =
        '<div class="ac-box">' +
        '<header class="ac-head">' +
          '<div class="ac-head-l"><p class="ac-kicker">Bienvenue sur Boussole</p>' +
          '<p class="ac-progress">Étape ' + etape + " sur " + N + "</p></div>" +
          '<button type="button" class="ac-later" data-act="fermer">Reprendre plus tard</button>' +
          '<ol class="ac-bar" aria-label="Progression">' + ETAPES.map((t, i) =>
            '<li class="' + (i + 1 < etape ? "fait" : i + 1 === etape ? "on" : "") + '"' + (i + 1 === etape ? ' aria-current="step"' : "") + '><i></i><span>' + t + "</span></li>").join("") + "</ol>" +
        "</header>" +
        '<div class="ac-body"><h2 id="' + id + '-h" tabindex="-1">' + (etape === 1 ? "Bienvenue dans Boussole" : ETAPES[etape - 1]) + "</h2>" + corps + "</div>" +
        '<footer class="ac-foot"><span class="ac-msg" role="status" aria-live="polite"></span>' +
          (etape > 1 ? '<button type="button" class="ac-btn ghost" data-act="retour">Retour</button>' : "") +
          '<button type="button" class="ac-btn' + (etape === ENTRETIEN ? " ghost" : "") + '" data-act="suivant">' + libSuiv + "</button>" +
        "</footer></div>";
      if (etape === CONNEXION && !anon) { lierConnexion($(".ac-cx"), m => { $(".ac-msg").textContent = m; }); voyant(); }
      if (etape === SUIVI) suivi();
      surveiller(etape === CONNEXION && !anon);
      pied();
      if (focus) { const h = $("#" + id + "-h"); if (h) h.focus(); }
    }
    function aller(n) { etape = Math.min(N, Math.max(1, n)); render(true); }

    /* Fermeture et nettoyage synchrones (l'évènement close peut arriver tard, onglet en arrière-plan). */
    let nettoye = false;
    function nettoyer() {
      if (nettoye) return;
      nettoye = true;
      surveiller(false);
      if (courant === inst) courant = null;
      if (dlg.open) dlg.close();
      dlg.remove();
      rendreFocus();
    }
    /* Focus de retour : l'élément d'origine s'il est encore là et visible, sinon le titre de la page (#spaceTitle),
       jamais <body>. */
    function rendreFocus() {
      const ok = el => !!el && el !== document.body && el.isConnected !== false && typeof el.focus === "function" && !(el.closest && el.closest("[hidden]"));
      const cible = ok(origine) ? origine : document.getElementById("spaceTitle");
      if (!cible || typeof cible.focus !== "function") return;
      try { cible.focus({ preventScroll: true }); } catch (e) { try { cible.focus(); } catch (e2) { /* rien */ } }
    }
    function fermer(motif) {
      if (fini) return;
      if (motif === "plus-tard") reporter();
      fini = true;
      nettoyer();
    }
    async function terminer() {
      const b = $('[data-act="suivant"]'); if (b) b.disabled = true;
      $(".ac-msg").textContent = "Enregistrement…";
      try {
        if (St && typeof St.markOnboarded === "function") await St.markOnboarded();
        ecrire(cleEtape, null);
        fini = true; nettoyer();
        if (typeof o.onDone === "function") o.onDone();
      } catch (err) {
        if (b) b.disabled = false;
        $(".ac-msg").textContent = "Enregistrement impossible : " + ((err && err.message) || err) + ". Réessaie.";
      }
    }

    dlg.addEventListener("click", e => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      const act = b.dataset.act;
      if (act === "ouvrir") { setTimeout(() => aller(SUIVI), 300); return; } // le lien s'ouvre dans un nouvel onglet
      e.preventDefault();
      if (act === "suivant") { if (b.disabled) return; if (etape === N) terminer(); else aller(etape + 1); }
      else if (act === "retour") aller(etape - 1);
      else if (act === "fermer" || act === "plus-tard") fermer("plus-tard");
      else if (act === "manuel") { manuel = true; voyant(); const s = $('[data-act="suivant"]'); if (s) s.focus(); }
      else if (act === "examiner") {
        fermer("plus-tard");
        if (root.App && typeof root.App.go === "function") root.App.go("agent/propositions");
      }
    });
    /* Échap = « Reprendre plus tard » (l'étape reste mémorisée). */
    dlg.addEventListener("cancel", e => { e.preventDefault(); fermer("plus-tard"); });
    dlg.addEventListener("close", nettoyer);

    const inst = {
      maj(snap) {
        S = snap || S;
        if (etape === CONNEXION && !connecte) {
          const c = estConnecte(S.connexions, ouvertLe, auDepart);
          if (c) connecte = c;
          voyant();
        }
        if (etape === SUIVI) suivi();
      },
      focus() { const h = $("#" + id + "-h"); if (h) h.focus(); },
      api: { close: () => fermer("plus-tard"), dialog: dlg, etape: () => etape },
    };
    courant = inst;
    abonner();
    connecte = estConnecte(S0.connexions, ouvertLe, auDepart);

    /* Compte anonyme (mode Supabase seulement) : l'étape 2 devient « Sécurise d'abord ton compte ». */
    const A = root.Auth;
    if (!demo && A && typeof A.session === "function") {
      A.session().then(s => {
        const a = typeof A.isAnonymous === "function" ? A.isAnonymous(s) : !!(s && s.user && s.user.is_anonymous);
        if (a !== anon) { anon = a; if (etape === CONNEXION && dlg.open) render(); }
      }, () => {});
    }

    render();
    dlg.showModal();
    inst.focus();
    return inst.api;
  }

  return { open, connexion, reporte, estConnecte, voyantRoutine, lienClaude, ETAPES, PHRASE: PROMPT_CLAUDE, PROMPT_CLAUDE };
});
