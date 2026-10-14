/* Banques connectées (BQ1, Powens ; spec docs/superpowers/specs/2026-10-12-bq1-powens-design.md) : seule copie côté app des règles
   partagées par les deux stores (validation du rattachement, adresse de redirection) et par les vues (Agent › Connexion, Aujourd'hui,
   Patrimoine › Budget). Fonctions pures, sans DOM ; window.BanqueEtat dans le navigateur (chargé par build.mjs avant les stores),
   module.exports sous Node (tests).
   - ETATS : états Powens d'une connexion → { libelle (ETATS_LIBELLES du connecteur), action (ETATS_RECONNEXION : l'utilisateur doit
     refaire la connexion), urgence (Aujourd'hui : 1 pour SCARequired, wrongpass, webauthRequired, passwordExpired ; 2 pour les autres
     états à reconnecter ; null pour les incidents passagers) } ; etat(code) ; null = à jour.
   - comptesARattacher(banque) : comptes actifs, suivis (ignore faux), pas en double (doublonDe nul), sans ligne, enveloppe ni crédit
     (interrupteur éteint : aucun).
   - connexionsEnDouble(banque) → [{ connexion, autre }] : connexions dont tous les comptes sont déjà dans une autre connexion du même
     établissement (doublonDe, posé par la synchronisation, migration 0022) ; autre = la connexion qu'elle double (ou null).
   - cibleSuggestion(suggestion) : suggestion de rattachement (banque_comptes.suggestion { type: ligne|enveloppe|credit, id?, enveloppe?,
     titulaire?, libelle, raison }) → cible de Store.banque.rattacher ({ positionId } | { enveloppe, titulaire } | { creditId }), null si
     sa forme est inconnue. suggestionOk(s) : forme valide (lue par les stores).
   - reelMoyen(mois, auj, n = 3) : moyenne mensuelle par catégorie des n derniers mois complets de banque_mois (mois en cours exclu),
     en montant positif : dépenses = sorties − entrées (remboursements déduits), revenus = entrées − sorties, épargne = sorties − entrées.
   - categoriePourTitre(titre) : catégorie Boussole d'un titre de catégorie du budget (accents et casse ignorés, « Autres » → divers).
   - normRattachement(cible, { compte, positions, credits }) → les 5 colonnes modifiables de banque_comptes (position_id, enveloppe,
     titulaire, credit_id, ignore), toujours toutes écrites ; { ignorer: true } (« Ne pas suivre ce compte ») → ignore = true et les 4
     autres à null, comme l'impose le déclencheur de 0021 ; tout autre rattachement → ignore = false. Crédit seulement pour un compte de
     type credit (même règle que le déclencheur). Refus en français (code invalid_argument).
   - urlPowensOk(url) : redirection acceptée seulement en https vers webview.powens.com ou un domaine *.biapi.pro / *.powens.com.
   - messageErreur(statut, corps) : réponse en échec de la fonction powens → message pour l'utilisateur.
   - retourPowens(search) : retour de la page Powens, filtré par /powens/retour (app.html?connection_id=<chiffres> ou ?error=<code
     [a-z_]>, jamais error_description) → { ok, message (fixe, en français, jamais le code), recherche (query sans ces paramètres) } ;
     null sinon, en particulier pour un retour d'authentification Supabase (error_description, error_code, access_token : laissé à
     supabase-js). Lu par auth.js (URL nettoyée avant la création du client) et app.js (bandeau).
   - mfaRequise(banque) / carteMfa() (SEC2, migration 0028) : les tables banque_* exigent la double authentification (aal2). Store : S.banque.mfaRequise
     vrai quand l'interrupteur est actif mais la session n'a pas franchi le second facteur ; les vues de données bancaires (Patrimoine › Comptes,
     Agent › Connexion) montrent alors la carte bloquante « Active la double authentification pour voir tes comptes bancaires » (HTML pur,
     bouton vers Mon compte › Sécurité) à la place des comptes.
   - heureParis(horodatage) : { jour, jjmm, heure } à l'heure de Paris (dernière synchronisation d'une connexion). */
(function (root) {
  "use strict";
  /* Libellés repris mot pour mot de ETATS_LIBELLES (supabase/functions/mcp/banque.ts), première lettre en majuscule (test d'égalité) ;
     action = ETATS_RECONNEXION du connecteur : l'utilisateur doit refaire la connexion (bouton « Reconnecter », élément d'Aujourd'hui).
     Les autres états sont des incidents passagers : Powens réessaie seul, l'état est seulement affiché. */
  const ETATS = {
    SCARequired: { libelle: "Validation forte demandée par la banque", action: true, urgence: 1 },
    webauthRequired: { libelle: "Reconnexion sur le site de la banque demandée", action: true, urgence: 1 },
    additionalInformationNeeded: { libelle: "Information complémentaire demandée par la banque", action: true, urgence: 2 },
    wrongpass: { libelle: "Identifiants refusés par la banque", action: true, urgence: 1 },
    decoupled: { libelle: "Validation en attente dans l'application de la banque", action: true, urgence: 2 },
    actionNeeded: { libelle: "Action demandée sur le site de la banque", action: true, urgence: 2 },
    passwordExpired: { libelle: "Mot de passe bancaire expiré", action: true, urgence: 1 },
    validating: { libelle: "Synchronisation en cours", action: false, urgence: null },
    rateLimiting: { libelle: "Banque momentanément saturée, nouvel essai automatique", action: false, urgence: null },
    websiteUnavailable: { libelle: "Site de la banque indisponible, nouvel essai automatique", action: false, urgence: null },
    bug: { libelle: "Incident technique de synchronisation, nouvel essai automatique", action: false, urgence: null },
  };
  /** État d'une connexion : { code, aJour, connu, libelle, action, urgence } (urgence null quand elle est à jour). */
  function etat(code) {
    if (code == null || code === "") return { code: null, aJour: true, connu: true, libelle: "À jour", action: false, urgence: null };
    const e = Object.prototype.hasOwnProperty.call(ETATS, code) ? ETATS[code] : null;
    if (e) return { code, aJour: false, connu: true, libelle: e.libelle, action: e.action, urgence: e.urgence };
    return { code: String(code), aJour: false, connu: false, libelle: "État inconnu (" + String(code) + ")", action: false, urgence: null };
  }

  const TYPES = { courant: "Compte courant", livret: "Livret", pea: "PEA", compte_titres: "Compte-titres", assurance_vie: "Assurance vie", per: "PER", credit: "Crédit", autre: "Autre compte" };
  const typeLibelle = t => TYPES[t] || TYPES.autre;

  const actif = b => !!(b && b.actif);
  const rattache = c => !!(c && (c.positionId || c.enveloppe || c.creditId));
  const ignore = c => !!(c && c.ignore === true);
  const enDouble = c => !!(c && c.doublonDe != null);
  function comptesARattacher(banque) {
    if (!actif(banque)) return [];
    return (Array.isArray(banque.comptes) ? banque.comptes : []).filter(c => c && c.actif !== false && !ignore(c) && !enDouble(c) && !rattache(c));
  }
  function connexionsEnDouble(banque) {
    if (!actif(banque)) return [];
    const cxs = Array.isArray(banque.connexions) ? banque.connexions : [];
    return cxs.filter(c => c && c.doublonDe != null).map(c => ({ connexion: c, autre: cxs.find(x => x && String(x.id) === String(c.doublonDe)) || null }));
  }
  /* ---------- suggestion de rattachement (synchronisation, 0022) ---------- */
  const texteOk = v => typeof v === "string" && v.trim() !== "";
  function cibleSuggestion(s) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    if (s.type === "ligne" && texteOk(s.id)) return { positionId: s.id };
    if (s.type === "credit" && texteOk(s.id)) return { creditId: s.id };
    if (s.type === "enveloppe" && texteOk(s.enveloppe) && ["p1", "p2"].includes(s.titulaire)) return { enveloppe: s.enveloppe, titulaire: s.titulaire };
    return null;
  }
  const suggestionOk = s => !!cibleSuggestion(s) && texteOk(s.libelle);

  /* ---------- catégories (supabase/functions/powens/categories.ts) et réel moyen ---------- */
  const CATEGORIES = [
    { cle: "logement", libelle: "Logement", sens: "depense" }, { cle: "alimentation", libelle: "Alimentation", sens: "depense" },
    { cle: "transport", libelle: "Transport", sens: "depense" }, { cle: "enfants", libelle: "Enfants", sens: "depense" },
    { cle: "sante", libelle: "Santé", sens: "depense" }, { cle: "loisirs", libelle: "Loisirs", sens: "depense" },
    { cle: "abonnements", libelle: "Abonnements", sens: "depense" }, { cle: "impots", libelle: "Impôts", sens: "depense" },
    { cle: "divers", libelle: "Divers", sens: "depense" }, { cle: "revenus", libelle: "Revenus", sens: "revenu" },
    { cle: "epargne", libelle: "Épargne", sens: "epargne" },
  ];
  const sansAccents = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const ALIAS = { autres: "divers", "autres depenses": "divers", impot: "impots", "impots et taxes": "impots", revenu: "revenus" };
  function categoriePourTitre(titre) {
    const t = sansAccents(titre);
    const c = CATEGORIES.find(x => x.cle === t || sansAccents(x.libelle) === t);
    return c ? c.cle : ALIAS[t] || null;
  }
  const categorie = cle => CATEGORIES.find(c => c.cle === cle) || null;
  const isoMois = s => (typeof s === "string" && /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) + "-01" : null);
  function reelMoyen(mois, auj, n) {
    const nb = Number.isInteger(n) && n > 0 ? n : 3;
    const courant = isoMois(auj) || isoMois(new Date().toISOString());
    const lignes = (Array.isArray(mois) ? mois : []).filter(m => m && isoMois(m.mois) && isoMois(m.mois) < courant);
    const retenus = [...new Set(lignes.map(m => isoMois(m.mois)))].sort().slice(-nb);
    if (!retenus.length) return null;
    const tot = {};
    lignes.filter(m => retenus.includes(isoMois(m.mois))).forEach(m => {
      const c = categorie(m.categorie), e = +m.entrees || 0, s = +m.sorties || 0;
      if (!c) return;
      tot[c.cle] = (tot[c.cle] || 0) + (c.sens === "revenu" ? e - s : s - e);
    });
    const parCategorie = {};
    Object.keys(tot).forEach(k => { parCategorie[k] = Math.max(0, tot[k]) / retenus.length; });
    return { n: retenus.length, du: retenus[0], au: retenus[retenus.length - 1], parCategorie };
  }

  /* ---------- rattachement (seule écriture de l'utilisateur sur banque_comptes) ---------- */
  const bad = m => Object.assign(new Error(m), { code: "invalid_argument" });
  const rempli = v => v != null && v !== "";
  function normRattachement(cible, ctx) {
    const x = ctx || {}, compte = x.compte || {}, c = cible && typeof cible === "object" && !Array.isArray(cible) ? cible : null;
    const vide = { position_id: null, enveloppe: null, titulaire: null, credit_id: null, ignore: false };
    if (!c) throw bad("Rattachement invalide : choisis une ligne, une enveloppe et son titulaire, un crédit, ou aucun.");
    const cibles = [rempli(c.positionId), rempli(c.enveloppe) || rempli(c.titulaire), rempli(c.creditId)].filter(Boolean).length;
    if (c.ignorer === true) {
      if (cibles || c.aucun === true) throw bad("Rattachement invalide : « Ne pas suivre ce compte » se choisit seul, sans ligne, enveloppe ni crédit.");
      return Object.assign(vide, { ignore: true });
    }
    if (c.aucun === true && !cibles) return vide;
    if (cibles > 1) throw bad("Rattachement invalide : un compte se rattache à une ligne ou à une enveloppe, pas aux deux.");
    if (!cibles) throw bad("Rattachement invalide : choisis une ligne, une enveloppe et son titulaire, un crédit, ou aucun.");
    const credit = compte.type === "credit";
    if (rempli(c.creditId)) {
      if (!credit) throw bad("Seul un compte de crédit se rattache à un crédit.");
      if (!(Array.isArray(x.credits) ? x.credits : []).some(k => k && String(k.id) === String(c.creditId))) throw bad("Crédit introuvable : choisis un de tes crédits.");
      return Object.assign(vide, { credit_id: String(c.creditId) });
    }
    if (credit) throw bad("Un compte de crédit se rattache à un crédit (Compte › Données), pas à une ligne de placement.");
    if (rempli(c.positionId)) {
      const p = (Array.isArray(x.positions) ? x.positions : []).find(q => q && String(q.id) === String(c.positionId));
      if (!p || p.status === "clôturé") throw bad("Ligne introuvable : choisis une de tes lignes.");
      return Object.assign(vide, { position_id: String(p.id) });
    }
    const env = String(c.enveloppe == null ? "" : c.enveloppe).replace(/\s+/g, " ").trim();
    if (!env || env.length > 80) throw bad("Enveloppe invalide : son nom compte de 1 à 80 caractères.");
    if (!["p1", "p2"].includes(c.titulaire)) throw bad("Titulaire « " + (c.titulaire ?? "") + " » inconnu (p1 ou p2).");
    return Object.assign(vide, { enveloppe: env, titulaire: c.titulaire });
  }

  /* ---------- heure de Paris (dernière synchronisation) ---------- */
  let PARIS_HM = null;
  try { PARIS_HM = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); } catch (e) { PARIS_HM = null; }
  /** Horodatage → { jour: AAAA-MM-JJ, jjmm: JJ/MM, heure: HH:MM } à l'heure de Paris, ou null. */
  function heureParis(ts) {
    const d = ts ? new Date(ts) : null;
    if (!d || !isFinite(d) || !PARIS_HM) return null;
    const p = {}; PARIS_HM.formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return { jour: p.year + "-" + p.month + "-" + p.day, jjmm: p.day + "/" + p.month, heure: p.hour + ":" + p.minute };
  }

  /* ---------- double authentification obligatoire (SEC2) ---------- */
  const mfaRequise = b => !!(b && b.actif && b.mfaRequise === true);
  const LIEN_SECURITE = "compte.html#securite";
  function carteMfa() {
    return '<section class="bq-mfa" role="note" aria-labelledby="bqMfaTitre"><h3 id="bqMfaTitre">Active la double authentification pour voir tes comptes bancaires</h3>' +
      "<p>Tes comptes bancaires sont des données sensibles : Boussole ne les affiche qu'avec un code à 6 chiffres, en plus de ton mot de passe. L'activation prend deux minutes.</p>" +
      '<a class="bq-mfa-btn" href="' + LIEN_SECURITE + '">Activer la double authentification</a></section>';
  }

  /* ---------- appels à la fonction powens ---------- */
  /* Analyse par expression (sans dépendre de URL, absent de certains contextes) : https, pas d'identifiants dans l'autorité. */
  function urlPowensOk(url) {
    const m = /^https:\/\/([a-z0-9.-]+)(?::\d{1,5})?(?:[\/?#]|$)/i.exec(String(url || ""));
    if (!m) return false;
    const h = m[1].toLowerCase();
    return h === "webview.powens.com" || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(biapi\.pro|powens\.com)$/.test(h);
  }
  function messageErreur(statut, corps) {
    const m = corps && typeof corps === "object" ? [corps.erreur, corps.error, corps.message].find(v => typeof v === "string" && v.trim()) : null;
    if (statut === 401) return "Ta session a expiré. Reconnecte-toi.";
    if (m && m.trim().length <= 300 && statut < 500) return m.trim();
    if (statut === 403) return "La connexion bancaire n'est pas encore ouverte pour ton compte.";
    if (statut === 503) return "Connexion bancaire indisponible pour le moment. Réessaie plus tard.";
    return "La connexion bancaire n'a pas répondu (erreur " + statut + "). Réessaie dans un instant.";
  }
  const MSG_RESEAU = "Connexion au serveur impossible. Vérifie ta connexion internet et réessaie.";

  /* ---------- retour de la page Powens (/powens/retour → app.html) ---------- */
  const MSG_RETOUR_ECHEC = "La connexion à ta banque n'a pas abouti. Réessaie depuis Agent › Connexion.";
  const MSG_RETOUR = {
    access_denied: "Connexion annulée.",
    wrongpass: "Identifiants refusés par ta banque. Réessaie depuis Agent › Connexion.",
    server_error: "Powens est momentanément indisponible. Réessaie dans un instant depuis Agent › Connexion.",
    temporarily_unavailable: "Powens est momentanément indisponible. Réessaie dans un instant depuis Agent › Connexion.",
  };
  const PARAMS_RETOUR = ["connection_id", "error"];
  function retourPowens(search) {
    let p;
    try { p = new URLSearchParams(String(search || "")); } catch (e) { return null; }
    if (["error_description", "error_code", "access_token"].some(k => p.has(k))) return null; // retour d'authentification Supabase
    const id = p.get("connection_id"), err = p.get("error");
    const idOk = id != null && /^\d{1,15}$/.test(id), errOk = err != null && /^[a-z_]{1,64}$/.test(err);
    if (!idOk && !errOk) return null;
    const reste = new URLSearchParams();
    p.forEach((v, k) => { if (!PARAMS_RETOUR.includes(k)) reste.append(k, v); });
    const recherche = reste.toString() ? "?" + reste.toString() : "";
    if (err != null) return { ok: false, message: errOk && Object.prototype.hasOwnProperty.call(MSG_RETOUR, err) ? MSG_RETOUR[err] : MSG_RETOUR_ECHEC, recherche };
    return { ok: true, message: "Connexion enregistrée, synchronisation en cours.", recherche };
  }

  const BanqueEtat = { ETATS, etat, heureParis, TYPES, typeLibelle, comptesARattacher, rattache, ignore, enDouble, connexionsEnDouble, cibleSuggestion, suggestionOk, CATEGORIES, categoriePourTitre, reelMoyen, normRattachement, urlPowensOk, messageErreur, MSG_RESEAU, retourPowens, mfaRequise, carteMfa, LIEN_SECURITE };
  root.BanqueEtat = BanqueEtat;
  if (typeof module === "object" && module.exports) module.exports = BanqueEtat;
})(typeof window !== "undefined" ? window : globalThis);
