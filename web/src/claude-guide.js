/* Compte › Connexion : faire son bilan en discutant avec Claude (connecteur MCP Boussole).
   Avancement par section (BilanEtat.etat), prochaines questions, ajout du connecteur (bloc partagé avec l'étape 3 de
   l'accueil : Accueil.connexion), « Revoir l'accueil » (App.accueil),
   parcours lançables (claude.ai/new?q=… ou copie de la demande), retour vers Propositions pour valider.
   Compte anonyme (mode Supabase) : « Sécurise d'abord ton compte » à la place de l'étape du connecteur.
   La saisie se fait avec Claude (formulaires interactifs, fichiers déposés dans la conversation) : la page l'explique, ainsi que la
   veille (la ligne « Veille » de la barre latérale y mène). Textes au tutoiement.
   « Ta revue mensuelle » (RT1) : état de la routine lu dans S.routines / S.routinesLues, bascule active / en pause
   (Store.routines.pause, seule écriture de la page), prompt de la tâche planifiée à copier et ses 4 étapes ; rendu par la
   fonction pure exportée routinesHtml(S, auj, U). État de la revue : RoutineEtat.etat (routine-etat.js), règle partagée avec
   Aujourd'hui, l'accueil et le connecteur.
   « Banques connectées » (BQ1, Powens) : visible seulement si S.banque.actif ; rendue par la fonction pure exportée
   banqueHtml(S, auj, U, o). Connexions avec leur état en français (BanqueEtat, mêmes libellés que le connecteur), « Reconnecter » pour
   les états qui demandent une action, comptes avec solde et sélecteur de rattachement (ligne, enveloppe et titulaire, crédit pour un
   compte de crédit seulement, aucun, ou « Ne pas suivre ce compte » : compte ignoré, affiché discrètement « Non suivi », réversible),
   « Déconnecter » confirmé dans la page (pas de confirm()). « Gérer les comptes » sur chaque connexion (page de gestion Powens :
   activer un livret, un PEA… de la même banque) ; dès qu'une banque est connectée, « Connecter une banque » passe sous la liste avec
   le rappel AIDE_GERER (une seconde connexion à la même banque serait un doublon, facturé). Écritures de contrôle :
   Store.banque.connecter et gerer (puis redirection vers la page Powens), deconnecter, rattacher, synchroniser.
   Rapprochement automatique (migration 0022) : « Synchroniser maintenant » sur chaque connexion ; connexion en double (doublonDe) :
   alerte « Connexion X en double … Déconnecte-la. » avec « Déconnecter » mis en avant ; compte en double grisé « En double », sans
   sélecteur ; rattachement posé par la synchronisation dit « Rattaché automatiquement à … » (ou « Créé automatiquement : … ») et reste
   modifiable ; suggestion (plusieurs cibles possibles) avec « Rattacher », qui appelle Store.banque.rattacher avec la cible suggérée. */
(function () {
  "use strict";
  /* Demandes pré-remplies : courtes, en langage naturel, elles invoquent le connecteur et ses outils. */
  const PARCOURS = [
    { id: "bilan_complet", titre: "Bilan complet", desc: "Tout le bilan, section par section, dans l'ordre d'un entretien.",
      prompt: "Utilise le connecteur Boussole pour faire mon bilan patrimonial complet : commence par etat_du_bilan, pose-moi les questions avec les formulaires interactifs Boussole, et dépose tes propositions dans Boussole." },
    { id: "profil_de_risque", titre: "Profil de risque", desc: "Les dix questions, expliquées une par une.",
      prompt: "Utilise le connecteur Boussole pour établir mon profil de risque : commence par etat_du_bilan, pose-moi les questions avec le formulaire interactif Boussole en m'expliquant pourquoi, puis dépose mes réponses dans Boussole pour que je les valide." },
    { id: "budget", titre: "Budget", desc: "Dépenses et épargne du mois ; un relevé bancaire déposé dans la conversation suffit.",
      prompt: "Utilise le connecteur Boussole pour compléter mon budget mensuel : commence par etat_du_bilan, demande-moi mes dépenses avec les formulaires interactifs Boussole (je peux te donner un relevé bancaire), puis dépose tes propositions dans Boussole." },
    { id: "placements", titre: "Placements", desc: "Comptes, enveloppes et soldes à jour, depuis tes relevés.",
      prompt: "Utilise le connecteur Boussole pour mettre à jour mes placements : commence par etat_du_bilan, demande-moi les soldes à jour compte par compte (je peux te donner mes relevés ou l'export de mon courtier), puis dépose tes propositions dans Boussole." },
    { id: "revue_mensuelle", titre: "Revue du mois", desc: "Ce qui a changé ce mois-ci : soldes, budget, objectifs.",
      prompt: "Utilise le connecteur Boussole pour faire ma revue du mois : commence par etat_du_bilan, vérifie avec moi ce qui a changé (soldes, budget, objectifs) avec les formulaires interactifs Boussole, et dépose tes propositions dans Boussole." },
  ];
  const lienClaude = prompt => "https://claude.ai/new?q=" + encodeURIComponent(prompt);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ICON = {
    complet: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9"/>',
    partiel: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
    vide: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    copie: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  };
  const svg = (k, cls) => '<svg class="' + (cls || "cg-ico") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICON[k] + "</svg>";

  /* ---------- Ta revue mensuelle (routine RT1, spec 2026-10-11-rt1-routines) ----------
     Lecture de S.routines (store) avec S.routinesLues et S.dbOk ; l'état vient de RoutineEtat.etat (même règle qu'Aujourd'hui et que
     le connecteur). Seule écriture de la section : la bascule active / en pause (Store.routines.pause). Le prompt de la tâche
     planifiée vient de ClaudePrompts.PROMPT_TACHE, avec un repli identique ; les 4 étapes sont mot pour mot ETAPES_TACHE de
     supabase/functions/mcp/routines.ts (test d'égalité). */
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const viaNode = f => (typeof module === "object" && module.exports && typeof require === "function" ? require(f) : null);
  const prompts = () => glob("ClaudePrompts") || viaNode("./claude-prompts.js");
  const RE = () => glob("RoutineEtat") || viaNode("./routine-etat.js");
  const PROMPT_TACHE_REPLI = "Boussole : fais ma revue mensuelle. Appelle demarrer_routine avec le type revue_mensuelle et suis la conduite qu'il renvoie.";
  const promptTache = () => { const P = prompts(); return (P && P.PROMPT_TACHE && P.PROMPT_TACHE.revue_mensuelle) || PROMPT_TACHE_REPLI; };
  const ETAPES_TACHE = [
    "Dans Claude, ouvre les tâches planifiées et crée une nouvelle tâche.",
    "Colle le prompt de ta revue tel quel, sans le modifier.",
    "Choisis la fréquence « Chaque mois » et le jour de ta revue.",
    "Vérifie que le connecteur Boussole est activé pour cette tâche, puis enregistre-la.",
  ];
  const PHRASE_ACTIVER = "Active ma revue mensuelle Boussole";
  const isoJour = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const jjmm = iso => (isoJour(iso) ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : "");
  const s_ = n => (n > 1 ? "s" : "");

  const lienBouton = (U, phrase, libelle) => U && typeof U.demanderAClaude === "function" ? U.demanderAClaude(phrase, libelle) :
    '<a class="cg-btn" href="' + esc(lienClaude(phrase)) + '" target="_blank" rel="noopener">' + svg("ext") + esc(libelle) + '<span class="cg-sr"> (nouvel onglet)</span></a>';

  /** Section « Ta revue mensuelle » (HTML, pur). S : instantané du store (S.routines) ; auj : AAAA-MM-JJ ; U : bibliothèque UI
      (facultative, pour les boutons « … avec Claude ») ; o.erreur : erreur de la bascule, affichée en ligne sous elle. */
  function routinesHtml(S, auj, U, o) {
    /* routinesLues === false (contrat du store) : la table n'a pas encore été lue, [] ne veut pas dire « aucune routine ». */
    const s = S || {}, E = RE().etat(s.routines, auj, { lues: s.routinesLues === true, dbOk: s.dbOk === true }), opt = o || {};
    let html = "";
    if (E.code === "inconnu") {
      html = '<p class="cg-rt-voyant attente"><span class="cg-rt-pt" aria-hidden="true"></span><b>' +
        (!S || S.ready === false ? "Lecture de ta routine…" : "État de ta revue mensuelle indisponible pour le moment.") + "</b></p>";
    } else if (E.code === "a_activer") {
      html = '<p class="cg-rt-voyant off"><span class="cg-rt-pt" aria-hidden="true"></span><b>Pas encore activée</b></p>' +
        '<p class="cg-rt-p">Elle s\'active à la fin de ton premier entretien avec Claude, ou demande-lui : « ' + esc(PHRASE_ACTIVER) + " ».</p>" +
        '<div class="cg-rt-act">' + lienBouton(U, PHRASE_ACTIVER, "Activer avec Claude") + "</div>";
    } else {
      const r = E.routine, on = E.code !== "pause", due = E.code === "retard", client = String(r.dernierClient || "").trim();
      html = '<div class="cg-rt-tete"><p class="cg-rt-voyant ' + (!on ? "off" : due ? "retard" : "on") + '"><span class="cg-rt-pt" aria-hidden="true"></span><b>' + (on ? "Active" : "En pause") + "</b></p>" +
        '<button type="button" class="cg-rt-switch" role="switch" aria-checked="' + (on ? "true" : "false") + '" data-cg-routine="' + esc(r.type) + '">' +
        '<span class="cg-rt-piste" aria-hidden="true"><span class="cg-rt-pouce"></span></span><span class="cg-rt-switch-t">Revue mensuelle active</span></button></div>' +
        (opt.erreur ? '<p class="cg-rt-err" role="alert">' + esc(opt.erreur) + "</p>" : "");
      const faits = [E.dernier ? "Dernière revue le " + jjmm(E.dernier) + (client ? " (par " + esc(client) + ")" : "") : "Jamais passée"];
      if (!on) faits.push("En pause : Boussole ne te réclame plus ta revue. Réactive-la avec la bascule.");
      else if (due) faits.push('<b class="cg-rt-retard">' + (E.retard > 0 ? "En retard de " + E.retard + " jour" + s_(E.retard) : "Due aujourd'hui") + "</b>");
      else if (E.prochain) faits.push("Prochaine le " + jjmm(E.prochain));
      html += '<ul class="cg-rt-faits">' + faits.map(l => "<li>" + l + "</li>").join("") + "</ul>";
      if (due) html += '<div class="cg-rt-act">' + lienBouton(U, RE().phraseRevue(), "Lancer ma revue avec Claude") + "</div>";
      const n = E.questions.length;
      if (n) html += '<div class="cg-rt-q"><p class="cg-rt-q-t"><b>' + n + " question" + s_(n) + " en attente</b> de ta réponse</p>" +
        '<ul class="cg-rt-q-l">' + E.questions.map(q => "<li><b>" + esc(q.question) + "</b>" + (q.pourquoi ? "<span>" + esc(q.pourquoi) + "</span>" : "") + "</li>").join("") + "</ul>" +
        '<div class="cg-rt-act">' + lienBouton(U, RE().phraseRoutine(E.questions), "Répondre avec Claude") + "</div></div>";
    }
    const jour = E.routine && +E.routine.jour >= 1 && +E.routine.jour <= 28 ? Math.round(+E.routine.jour) : 1;
    return html + '<div class="cg-rt-tache"><h3>La tâche planifiée dans Claude</h3>' +
      '<p class="small muted">Chaque mois, Claude prépare ta revue tout seul : une synthèse et les questions du mois, auxquelles tu réponds ensuite avec lui. Fréquence : chaque mois, le ' + (jour === 1 ? "1er" : jour) + ".</p>" +
      '<div class="cg-rt-prompt"><pre id="cgRtPrompt">' + esc(promptTache()) + "</pre>" +
      '<button type="button" class="cg-btn ghost" data-cg-copier-tache>' + svg("copie") + 'Copier<span class="cg-sr"> le prompt de la tâche planifiée</span></button></div>' +
      '<ol class="cg-rt-etapes">' + ETAPES_TACHE.map(t => "<li>" + esc(t) + "</li>").join("") + "</ol></div>";
  }

  /* ---------- Banques connectées (BQ1, Powens ; spec 2026-10-12-bq1-powens-design § 5) ---------- */
  const BE = () => glob("BanqueEtat") || viaNode("./banque-etat.js");
  function montant(v, devise) {
    if (v == null || !isFinite(+v)) return "—";
    try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: String(devise || "EUR") }).format(+v); }
    catch (e) { return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+v) + " " + String(devise || ""); }
  }
  const TITRES = ["pea", "compte_titres", "assurance_vie", "per"];
  const nomPersonne = (S, k) => { const p = ((S && S.people) || []).find(x => x && x.id === k); return (p && p.nom) || (k === "p2" ? "Conjoint(e)" : "Moi"); };
  /** Options du sélecteur de rattachement d'un compte, selon son type : [{ valeur, libelle, groupe }]. Valeurs : "" (aucun),
      "pos:<id>", "env:<p1|p2>:<enveloppe encodée>", "cre:<id>" (compte de crédit seulement), "ign" (ne pas suivre ce compte). */
  function optionsRattachement(c, S) {
    const s = S || {}, credit = c.type === "credit", out = [{ valeur: "", groupe: null,
      // seul un compte « autre » reçoit encore une proposition de ligne (courant et livret : ligne créée par la synchronisation)
      libelle: credit ? "Aucun crédit" : c.type === "autre" ? "Aucune (nouvelle ligne proposée)" : "Aucune" }];
    const ignorer = { valeur: "ign", libelle: "Ne pas suivre ce compte", groupe: null };
    if (credit) {
      (((s.profil && s.profil.credits) || [])).forEach(k => out.push({ valeur: "cre:" + k.id, libelle: String(k.nom || "Crédit"), groupe: "Crédits" }));
      return out.concat(ignorer);
    }
    const lignes = (Array.isArray(s.positions) ? s.positions : []).filter(p => p && p.status !== "clôturé");
    if (TITRES.includes(c.type)) {
      const vus = new Set();
      lignes.forEach(p => {
        if (!p.envelope || !["p1", "p2"].includes(p.owner)) return;
        const v = "env:" + p.owner + ":" + encodeURIComponent(p.envelope);
        if (vus.has(v)) return; vus.add(v);
        out.push({ valeur: v, libelle: p.envelope + " · " + nomPersonne(s, p.owner), groupe: "Enveloppes (placements suivis un par un)" });
      });
    }
    lignes.forEach(p => out.push({ valeur: "pos:" + p.id, libelle: String(p.name || "Ligne") + (p.envelope ? " · " + p.envelope : ""), groupe: "Lignes" }));
    return out.concat(ignorer);
  }
  /* Valeur courante du sélecteur ; un crédit n'est lu que sur un compte de crédit (le déclencheur de 0021 refuse les autres). */
  const valeurRattachement = c => (c.ignore === true ? "ign" : c.positionId ? "pos:" + c.positionId : c.creditId && c.type === "credit" ? "cre:" + c.creditId :
    c.enveloppe ? "env:" + c.titulaire + ":" + encodeURIComponent(c.enveloppe) : "");
  /** Valeur du sélecteur → cible de Store.banque.rattacher. */
  function cibleDe(valeur) {
    const v = String(valeur || "");
    if (!v) return { aucun: true };
    if (v === "ign") return { ignorer: true };
    if (v.startsWith("pos:")) return { positionId: v.slice(4) };
    if (v.startsWith("cre:")) return { creditId: v.slice(4) };
    const m = /^env:(p1|p2):(.*)$/.exec(v);
    if (m) { let e = m[2]; try { e = decodeURIComponent(e); } catch (x) { /* tel quel */ } return { enveloppe: e, titulaire: m[1] }; }
    return null;
  }
  function selecteurHtml(c, S, err) {
    const opts = optionsRattachement(c, S), cur = valeurRattachement(c);
    if (cur && !opts.some(o => o.valeur === cur)) opts.push({ valeur: cur, libelle: c.creditId ? "Crédit introuvable" : c.positionId ? "Ligne introuvable" : (c.enveloppe || "") + " (introuvable)", groupe: null });
    let html = "", groupe = null;
    opts.forEach(o => {
      if (o.groupe !== groupe) { if (groupe) html += "</optgroup>"; if (o.groupe) html += '<optgroup label="' + esc(o.groupe) + '">'; groupe = o.groupe; }
      html += '<option value="' + esc(o.valeur) + '"' + (o.valeur === cur ? " selected" : "") + ">" + esc(o.libelle) + "</option>";
    });
    if (groupe) html += "</optgroup>";
    const id = esc(c.id);
    return '<div class="cg-bq-ratt"><label for="cgBq-' + id + '">Rattaché à</label><select id="cgBq-' + id + '" data-cg-banque-compte="' + id + '"' +
      (err ? ' aria-describedby="cgBqErr-' + id + '"' : "") + ">" + html + "</select></div>" +
      (err ? '<p class="cg-rt-err" role="alert" id="cgBqErr-' + id + '">' + esc(err) + "</p>" : "");
  }
  /** Libellé de ce à quoi un compte est rattaché (ligne · enveloppe, enveloppe · titulaire, crédit). */
  function libelleCible(c, S) {
    const s = S || {};
    if (c.positionId) { const p = (s.positions || []).find(x => x && String(x.id) === String(c.positionId)); return p ? String(p.name || "Ligne") + (p.envelope ? " · " + p.envelope : "") : "une ligne"; }
    if (c.creditId) { const k = ((s.profil && s.profil.credits) || []).find(x => x && String(x.id) === String(c.creditId)); return k ? String(k.nom || "Crédit") : "un crédit"; }
    if (c.enveloppe) return c.enveloppe + " · " + nomPersonne(s, c.titulaire);
    return "";
  }
  function compteHtml(c, S, err) {
    const B = BE(), fait = B.rattache(c), ign = c.ignore === true, sl = /^\d{4}-\d{2}-\d{2}/.test(String(c.soldeLe || "")) ? " au " + String(c.soldeLe).slice(8, 10) + "/" + String(c.soldeLe).slice(5, 7) : "";
    const tete = cls => '<li class="cg-bq-cpt' + cls + '"><div class="cg-bq-cpt-t"><b>' + esc(c.nom || "Compte") + "</b> ";
    const sous = '<span class="cg-bq-cpt-s">' + esc(B.typeLibelle(c.type)) + ' · <span class="cg-bq-num">' + esc(montant(c.solde, c.devise)) + "</span>" + esc(sl) + "</span></div>";
    // Compte en double d'un compte d'une autre connexion du même établissement (0022) : grisé, sans rattachement.
    if (B.enDouble(c) && !ign && c.actif !== false) {
      const b = (S && S.banque) || {}, jumeau = (b.comptes || []).find(k => k && String(k.id) === String(c.doublonDe));
      const autre = jumeau ? (b.connexions || []).find(x => x && String(x.id) === String(jumeau.connexionId)) : null;
      return tete(" doublon") + '<span class="cg-bq-tag">En double</span>' + sous +
        '<p class="cg-bq-note">Déjà suivi par l\'autre connexion' + (autre && autre.etablissement ? " " + esc(autre.etablissement) : "") + " : rien à rattacher ici.</p></li>";
    }
    const etiquette = c.actif === false ? '<span class="cg-bq-tag">Compte fermé</span>' : ign ? '<span class="cg-bq-tag">Non suivi</span>' : !fait ? '<span class="cg-bq-tag a-faire">À rattacher</span>' : "";
    // Rattachement posé par la synchronisation : dit tel quel, et modifiable (sélecteur, « Ne pas suivre ce compte »).
    const auto = fait && !ign && c.rattacheAuto ? '<p class="cg-bq-auto">' + (c.creeAuto
      ? "Créé automatiquement : " + esc(libelleCible(c, S)) + ". Tu peux changer ou ne pas suivre ce compte."
      : "Rattaché automatiquement à " + esc(libelleCible(c, S)) + ". Tu peux changer ci-dessous.") + "</p>" : "";
    // Suggestion (plusieurs cibles possibles) : confirmée d'un clic.
    const sugg = !fait && !ign && c.actif !== false && B.suggestionOk(c.suggestion) ? '<div class="cg-bq-sugg"><p>Suggestion : <b>' + esc(c.suggestion.libelle) + "</b>" +
      (c.suggestion.raison ? " — " + esc(c.suggestion.raison) : "") + "</p>" +
      '<button type="button" class="cg-btn" data-cg-banque-suggestion="' + esc(c.id) + '">Rattacher<span class="cg-sr"> ' + esc(c.nom || "Compte") + "</span></button></div>" : "";
    return tete(ign ? " ignore" : "") + etiquette + sous + auto + sugg + selecteurHtml(c, S, err) + "</li>";
  }
  function synchroTxt(ts, auj) {
    const p = BE().heureParis(ts);
    if (!p) return "Pas encore synchronisée.";
    return "Dernière synchronisation " + (p.jour === auj ? "aujourd'hui" : "le " + p.jjmm) + " à " + p.heure + ".";
  }
  /** Section « Banques connectées » (HTML, pur). S : instantané du store (S.banque, S.positions, S.profil.credits, S.people) ;
      auj : AAAA-MM-JJ (jour de Paris) ; U : bibliothèque UI (facultative) ; o = { confirmer: id de la connexion à confirmer,
      erreur: erreur générale, erreurs: { <compteId>: erreur du rattachement } }. "" si l'interrupteur banque est éteint. */
  const AIDE_GERER = "Pour ajouter un compte d'une banque déjà connectée (livret, PEA…), utilise « Gérer les comptes » : ne connecte pas la même banque une deuxième fois.";
  function banqueHtml(S, auj, U, o) {
    const b = S && S.banque, B = BE(), opt = o || {};
    if (!b || !b.actif || !B) return "";
    // SEC2 : interrupteur actif mais session sans double authentification — carte bloquante, ni connexion ni liste de comptes.
    if (B.mfaRequise(b)) return B.carteMfa();
    const bouton = '<button type="button" class="cg-btn" data-cg-banque-connecter>' + svg("ext") + "Connecter une banque</button>";
    const err = opt.erreur ? '<p class="cg-rt-err" role="alert">' + esc(opt.erreur) + "</p>" : "";
    const intro = '<p class="cg-rt-p">Boussole lit tes comptes par Powens, prestataire agréé : tes identifiants bancaires se saisissent sur la page de Powens, jamais dans Boussole. ' +
      "Une fois un compte rattaché à une ligne, son solde se met à jour tout seul.</p>";
    const cxs = b.lu && Array.isArray(b.connexions) ? b.connexions : [], comptes = Array.isArray(b.comptes) ? b.comptes : [], errs = opt.erreurs || {};
    // Aucune banque (ou lecture en cours) : bouton en tête. Sinon il passe sous la liste, avec le rappel contre les doublons.
    if (!cxs.length) {
      const html = '<div class="cg-bq-tete">' + intro + bouton + "</div>" + err;
      if (!b.lu) return html + '<p class="cg-rt-voyant attente"><span class="cg-rt-pt" aria-hidden="true"></span><b>Lecture de tes banques…</b></p>';
      return html + '<p class="cg-rt-p muted">Aucune banque connectée pour le moment.</p>';
    }
    let html = '<div class="cg-bq-tete">' + intro + "</div>";
    html += '<ul class="cg-bq-cx">' + cxs.map(c => {
      const e = B.etat(c.etat), id = esc(c.id), nom = String(c.etablissement || "Banque");
      const pastille = e.aJour ? '<span class="cg-bq-pastille ok">À jour</span>' : e.action ? '<span class="cg-bq-pastille alerte">À reconnecter</span>' : '<span class="cg-bq-pastille attente">Incident passager</span>';
      const cpts = comptes.filter(k => k && String(k.connexionId) === String(c.id));
      const conf = String(opt.confirmer) === String(c.id) && opt.confirmer != null;
      // Connexion en double (0022) : alerte, et « Déconnecter » mis en avant à la place du bouton ordinaire.
      const dbl = c.doublonDe != null ? (cxs.find(x => x && String(x.id) === String(c.doublonDe)) || null) : null;
      const deconnecter = '<button type="button" class="cg-btn ' + (c.doublonDe != null ? "danger" : "ghost") + '" data-cg-banque-deconnecter="' + id + '">Déconnecter<span class="cg-sr"> ' + esc(nom) + "</span></button>";
      const alerte = c.doublonDe != null ? '<div class="cg-bq-doublon" role="note"><p>Connexion <b>' + esc(nom) + "</b> en double : elle ne contient que des comptes déjà présents dans l'autre connexion " +
        esc((dbl && dbl.etablissement) || nom) + ". Déconnecte-la.</p>" + deconnecter + "</div>" : "";
      return '<li class="cg-bq-c"><div class="cg-bq-c-tete"><h3>' + esc(nom) + "</h3>" + pastille + "</div>" +
        '<p class="cg-bq-etat">' + (e.aJour ? "" : esc(e.libelle) + ". ") + esc(synchroTxt(c.derniereSynchro, auj)) + "</p>" +
        (c.message && !e.aJour ? '<p class="cg-bq-msg">' + esc(c.message) + "</p>" : "") + alerte +
        '<div class="cg-rt-act">' + (e.action ? '<button type="button" class="cg-btn" data-cg-banque-reconnecter="' + id + '">' + svg("ext") + 'Reconnecter<span class="cg-sr"> ' + esc(nom) + "</span></button>" : "") +
        '<button type="button" class="cg-btn ghost" data-cg-banque-synchroniser="' + id + '">Synchroniser maintenant<span class="cg-sr"> ' + esc(nom) + "</span></button>" +
        '<button type="button" class="cg-btn ghost" data-cg-banque-gerer="' + id + '">' + svg("ext") + 'Gérer les comptes<span class="cg-sr"> ' + esc(nom) + "</span></button>" +
        (c.doublonDe != null ? "" : deconnecter) + "</div>" +
        (conf ? '<div class="cg-bq-conf" role="group" aria-labelledby="cgBqConf-' + id + '"><p id="cgBqConf-' + id + '">Déconnecter <b>' + esc(nom) + "</b> ? Ses comptes et ses opérations sont retirés de Boussole ; tes lignes rattachées restent, en saisie manuelle.</p>" +
          '<div class="cg-rt-act"><button type="button" class="cg-btn danger" data-cg-banque-confirmer="' + id + '">Déconnecter</button>' +
          '<button type="button" class="cg-btn ghost" data-cg-banque-annuler="' + id + '">Annuler</button></div></div>' : "") +
        (cpts.length ? '<ul class="cg-bq-comptes">' + cpts.map(k => compteHtml(k, S, errs[k.id])).join("") + "</ul>" : '<p class="cg-rt-p muted">Aucun compte lu pour le moment.</p>') +
        "</li>";
    }).join("") + "</ul>";
    return html + '<div class="cg-bq-pied">' + bouton + '<p class="cg-rt-p cg-bq-aide">' + esc(AIDE_GERER) + "</p></div>" + err;
  }

  if (typeof module === "object" && module.exports) module.exports = { PARCOURS, lienClaude, routinesHtml, ETAPES_TACHE, PHRASE_ACTIVER, PROMPT_TACHE_REPLI, banqueHtml, cibleDe, optionsRattachement };
  if (typeof document === "undefined") return;
  const STATUT_TXT = { complet: "complet", partiel: "en partie renseigné", vide: "à renseigner" };

  const B = window.BOUSSOLE || {};
  const MCP_URL = B.mcpUrl || String(B.supabaseUrl || "").replace(/\/+$/, "") + "/functions/v1/mcp";
  let S = null, root = null, dirty = true, anon = false, sigSec = "", sigRt = "", erreurRt = "", tMsgRt = 0;
  let sigBq = "", tMsgBq = 0;
  const etatBq = { confirmer: null, erreur: "", erreurs: {} }; // section « Banques connectées » : confirmation et erreurs en cours
  const ouverts = new Set(); // sections dépliées (conservées d'un rendu à l'autre)
  const $ = id => root.querySelector("#" + id);
  const demo = () => !!(window.Store && window.Store.mode === "demo");
  const etat = () => (window.BilanEtat && S && S.ready !== false ? window.BilanEtat.etat(S) : null);
  const enAttente = () => ((S && S.propositions) || []).filter(p => p.statut === "en_attente").length;

  function ring(pct) {
    const r = 34, c = 2 * Math.PI * r, f = Math.max(0, Math.min(100, pct)) / 100;
    return '<svg viewBox="0 0 80 80" aria-hidden="true" focusable="false"><circle cx="40" cy="40" r="' + r + '" class="cg-ring-bg"/>' +
      '<circle cx="40" cy="40" r="' + r + '" class="cg-ring-fg" stroke-dasharray="' + (c * f).toFixed(1) + " " + c.toFixed(1) + '" transform="rotate(-90 40 40)"/></svg>' +
      '<span class="cg-ring-v">' + pct + '<small>%</small></span>';
  }

  function render() {
    if (!root) return;
    const E = etat();
    if (E) {
      $("cgRing").innerHTML = ring(E.pourcentage);
      $("cgRing").setAttribute("aria-label", "Bilan complet à " + E.pourcentage + " %");
      const complets = E.sections.filter(s => s.statut === "complet").length;
      $("cgHeroSub").textContent = E.pourcentage >= 100 ? "Ton bilan est complet. Reviens chaque mois pour le garder à jour." :
        "Ton bilan est complet à " + E.pourcentage + " % : " + complets + " section" + (complets > 1 ? "s" : "") + " sur " + E.sections.length + " terminée" + (complets > 1 ? "s" : "") + ".";
      $("cgSecCount").textContent = complets + " sur " + E.sections.length;
      const sig = JSON.stringify(E.sections.map(s => [s.cle, s.statut, s.faits, s.total, s.manquants.map(m => m.champ)]));
      if (sig !== sigSec) {
        sigSec = sig;
        $("cgSections").innerHTML = E.sections.map(s => {
          const head = '<span class="cg-st ' + s.statut + '" title="' + STATUT_TXT[s.statut] + '">' + svg(s.statut) + '<span class="cg-sr">' + STATUT_TXT[s.statut] + "</span></span>" +
            '<span class="cg-sec-t">' + esc(s.titre) + '</span><span class="cg-sec-n">' + s.faits + " sur " + s.total + "</span>";
          if (!s.manquants.length) return '<li class="cg-sec"><div class="cg-sec-h">' + head + "</div></li>";
          return '<li class="cg-sec"><details data-sec="' + esc(s.cle) + '"' + (ouverts.has(s.cle) ? " open" : "") + '><summary class="cg-sec-h">' + head + "</summary>" +
            '<ul class="cg-miss">' + s.manquants.map(m => "<li><b>" + esc(m.question) + "</b><span>" + esc(m.pourquoi) + "</span></li>").join("") + "</ul></details></li>";
        }).join("");
      }
      $("cgNext").innerHTML = E.prochaines.map(q => {
        const sec = E.sections.find(s => s.cle === q.section);
        return '<li><span class="cg-next-s">' + esc(sec ? sec.titre : "") + "</span><b>" + esc(q.question) + '</b><span class="muted">' + esc(q.pourquoi) + "</span></li>";
      }).join("");
      $("cgNextDone").hidden = !!E.prochaines.length;
      $("cgNext").hidden = !E.prochaines.length;
    }
    const n = enAttente();
    $("cgPending").textContent = n ? n + " proposition" + (n > 1 ? "s" : "") + " en attente : examiner" : "Aucune proposition en attente pour le moment";
    $("cgPending").classList.toggle("has", n > 0);
    steps();
    routines();
    banques();
  }
  /* Ta revue mensuelle : réécrite seulement si son contenu change (le focus et le retour « Copié » survivent aux mises à jour).
     Jour de Paris, comme le serveur. */
  function routines(focusBascule) {
    const html = routinesHtml(S, RE().aujParis(), window.UI || null, { erreur: erreurRt });
    if (html !== sigRt) { sigRt = html; $("cgRoutinesCorps").innerHTML = html; }
    if (focusBascule) { const b = root.querySelector("[data-cg-routine]"); if (b) b.focus(); }
  }
  /* Seule écriture de la page : la bascule active / en pause (Store.routines.pause → { ok: true } | { erreur }).
     Le bouton est réactivé dès la réponse, avant le re-rendu et le focus ; la vue suit tout de suite, sans attendre le rechargement
     du store. Erreur : celle du store est rédigée pour l'utilisateur (affichée telle quelle) ; une exception est technique
     (message générique). La zone d'alerte est reposée à chaque échec, pour qu'une même erreur soit annoncée de nouveau. */
  async function basculerRoutine(b) {
    const type = b.dataset.cgRoutine, active = b.getAttribute("aria-checked") === "true", St = window.Store;
    const api = St && St.routines && typeof St.routines.pause === "function";
    b.disabled = true; b.setAttribute("aria-busy", "true");
    direRt("", true);
    let res;
    try { res = api ? await window.Store.routines.pause(type, active) : { erreur: "Base indisponible dans cette vue." }; }
    catch (e) { res = { erreur: "Changement impossible pour le moment. Réessaie." }; }
    b.disabled = false; b.removeAttribute("aria-busy");
    if (res && res.ok) {
      erreurRt = "";
      S = Object.assign({}, S, { routines: ((S && S.routines) || []).map(r => (r && r.type === type ? Object.assign({}, r, { active: !active }) : r)) });
      routines(true);
      direRt(active ? "Revue mensuelle mise en pause." : "Revue mensuelle réactivée.", true);
    } else {
      erreurRt = String((res && res.erreur) || "Changement impossible pour le moment. Réessaie.").trim();
      sigRt = ""; // réécrit la zone d'alerte : une erreur identique à la précédente est réannoncée
      routines(true);
    }
  }
  /* Banques connectées : réécrite seulement si son contenu change ; focus rendu à l'élément désigné (sélecteur CSS) après réécriture. */
  function banques(focus) {
    const actif = !!(S && S.banque && S.banque.actif);
    $("cgBanques").hidden = !actif;
    const html = actif ? banqueHtml(S, RE().aujParis(), window.UI || null, etatBq) : "";
    if (html !== sigBq) { sigBq = html; $("cgBanquesCorps").innerHTML = html; }
    if (focus) { const el = root.querySelector(focus); if (el) el.focus(); }
  }
  function direBq(m) {
    const el = $("cgBqMsg"); el.textContent = m;
    clearTimeout(tMsgBq);
    if (m) tMsgBq = setTimeout(() => { if (el.textContent === m) el.textContent = ""; }, 5000);
  }
  const occupe = (b, on) => { b.disabled = on; if (on) b.setAttribute("aria-busy", "true"); else b.removeAttribute("aria-busy"); };
  const ECHEC_BQ = "Connexion bancaire impossible pour le moment. Réessaie.";
  const trouver = (liste, id) => ((S && S.banque && S.banque[liste]) || []).find(x => x && String(x.id) === String(id)) || null;
  /* Connecter (sans identifiant), reconnecter une connexion ou gérer ses comptes (gerer = true) : Store.banque.connecter ou gerer →
     redirection vers la page Powens. */
  async function connecterBq(b, cx, gerer) {
    occupe(b, true);
    direBq("");
    let res;
    try { res = gerer ? await window.Store.banque.gerer(cx.id) : await window.Store.banque.connecter(...(cx ? [cx.id] : [])); }
    catch (e) { res = { erreur: ECHEC_BQ }; }
    occupe(b, false);
    if (res && res.ok && res.url) {
      etatBq.erreur = "";
      direBq(gerer ? "Ouverture de la page de gestion de Powens…" : "Ouverture de la page de connexion de Powens…");
      window.location.assign(res.url);
      return;
    }
    etatBq.erreur = String((res && res.erreur) || ECHEC_BQ).trim();
    sigBq = ""; // zone d'alerte reposée : une même erreur est réannoncée
    const idSel = cx ? String(cx.id).replace(/"/g, "") : "";
    banques(!cx ? "[data-cg-banque-connecter]" : gerer ? '[data-cg-banque-gerer="' + idSel + '"]' : '[data-cg-banque-reconnecter="' + idSel + '"]');
  }
  async function deconnecterBq(b, cx) {
    occupe(b, true);
    let res;
    try { res = await window.Store.banque.deconnecter(cx.id); }
    catch (e) { res = { erreur: ECHEC_BQ }; }
    etatBq.confirmer = null;
    if (res && res.ok) {
      etatBq.erreur = "";
      S = Object.assign({}, S, { banque: Object.assign({}, S.banque, { connexions: S.banque.connexions.filter(c => c !== cx), comptes: (S.banque.comptes || []).filter(k => String(k.connexionId) !== String(cx.id)) }) });
      banques("[data-cg-banque-connecter]");
      direBq((cx.etablissement || "Banque") + " déconnectée.");
    } else {
      etatBq.erreur = String((res && res.erreur) || ECHEC_BQ).trim();
      sigBq = "";
      banques('[data-cg-banque-deconnecter="' + String(cx.id).replace(/"/g, "") + '"]');
    }
  }
  /* « Synchroniser maintenant » : Store.banque.synchroniser(id) (relance Powens et synchronisation côté serveur ; le store recharge). */
  async function synchroniserBq(b, cx) {
    const focus = '[data-cg-banque-synchroniser="' + String(cx.id).replace(/"/g, "") + '"]', nom = cx.etablissement || "Banque";
    occupe(b, true);
    direBq("");
    let res;
    try { res = await window.Store.banque.synchroniser(cx.id); }
    catch (e) { res = { erreur: "Synchronisation impossible pour le moment. Réessaie." }; }
    occupe(b, false);
    if (res && res.ok) {
      etatBq.erreur = "";
      const r = res.rapport || {}, n = +r.comptes || 0, a = +r.rattaches_auto || 0;
      banques(focus);
      direBq(nom + " synchronisée : " + n + " compte" + (n > 1 ? "s" : "") + " lu" + (n > 1 ? "s" : "") +
        (a ? ", " + a + " rattaché" + (a > 1 ? "s" : "") + " automatiquement" : "") + "." +
        (r.relance === false ? " Ta banque n'a pas pu être relancée : ce sont les données de son dernier passage." : ""));
    } else {
      etatBq.erreur = String((res && res.erreur) || "Synchronisation impossible pour le moment. Réessaie.").trim();
      sigBq = "";
      banques(focus);
    }
  }
  /* « Rattacher » une suggestion de la synchronisation : même écriture que le sélecteur (Store.banque.rattacher). */
  async function rattacherSuggestion(b, cpt) {
    const cible = BE().cibleSuggestion(cpt.suggestion), libelle = String((cpt.suggestion && cpt.suggestion.libelle) || "la suggestion");
    if (!cible) return;
    const focus = '[data-cg-banque-compte="' + String(cpt.id).replace(/"/g, "") + '"]';
    occupe(b, true);
    let res;
    try { res = await window.Store.banque.rattacher(cpt.id, cible); }
    catch (e) { res = { erreur: "Rattachement impossible pour le moment. Réessaie." }; }
    occupe(b, false);
    if (res && res.ok) {
      delete etatBq.erreurs[cpt.id];
      const maj = { positionId: cible.positionId || null, enveloppe: cible.enveloppe || null, titulaire: cible.titulaire || null, creditId: cible.creditId || null, ignore: false, suggestion: null };
      S = Object.assign({}, S, { banque: Object.assign({}, S.banque, { comptes: S.banque.comptes.map(k => (k === cpt ? Object.assign({}, k, maj) : k)) }) });
      banques(focus);
      direBq("« " + (cpt.nom || "Compte") + " » rattaché à " + libelle + ".");
    } else {
      etatBq.erreurs[cpt.id] = String((res && res.erreur) || "Rattachement impossible pour le moment. Réessaie.").trim();
      sigBq = "";
      banques('[data-cg-banque-suggestion="' + String(cpt.id).replace(/"/g, "") + '"]');
    }
  }
  async function rattacherBq(sel) {
    const cpt = trouver("comptes", sel.dataset.cgBanqueCompte), cible = cibleDe(sel.value);
    if (!cpt || !cible) return;
    const focus = '[data-cg-banque-compte="' + String(cpt.id).replace(/"/g, "") + '"]';
    occupe(sel, true);
    let res;
    try { res = await window.Store.banque.rattacher(cpt.id, cible); }
    catch (e) { res = { erreur: "Rattachement impossible pour le moment. Réessaie." }; }
    occupe(sel, false);
    if (res && res.ok) {
      delete etatBq.erreurs[cpt.id];
      const maj = { positionId: cible.positionId || null, enveloppe: cible.enveloppe || null, titulaire: cible.titulaire || null, creditId: cible.creditId || null, ignore: cible.ignorer === true };
      S = Object.assign({}, S, { banque: Object.assign({}, S.banque, { comptes: S.banque.comptes.map(k => (k === cpt ? Object.assign({}, k, maj) : k)) }) });
      banques(focus);
      const o = cible.aucun || cible.ignorer ? null : optionsRattachement(cpt, S).find(x => x.valeur === sel.value), nomC = "« " + (cpt.nom || "Compte") + " »";
      direBq(cible.ignorer ? nomC + " n'est plus suivi : tu peux le suivre de nouveau à tout moment." : cible.aucun ? nomC + " n'est plus rattaché." : nomC + " rattaché à " + (o ? o.libelle : "ta sélection") + ".");
    } else {
      etatBq.erreurs[cpt.id] = String((res && res.erreur) || "Rattachement impossible pour le moment. Réessaie.").trim();
      sigBq = "";
      banques(focus);
    }
  }
  function steps() {
    const isDemo = demo();
    $("cgDemoNote").hidden = !isDemo;
    $("cgStep1").hidden = anon && !isDemo;
    $("cgStepAnon").hidden = !(anon && !isDemo);
  }

  /* Presse-papiers, avec repli : sélection du texte pour une copie manuelle. */
  async function copier(text, el) {
    try { if (!navigator.clipboard) throw new Error("indisponible"); await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      if (el && el.select) { el.hidden = false; el.focus(); el.select(); try { return document.execCommand("copy"); } catch (x) { return false; } }
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      return false;
    }
  }
  /* Message de la section (copie, bascule) : effacé au bout de 5 s, ou remplacé par le suivant. */
  function direRt(m, ok) {
    const el = $("cgRtMsg"); el.textContent = m; el.className = "cg-msg " + (ok ? "ok" : "err");
    clearTimeout(tMsgRt);
    if (m) tMsgRt = setTimeout(() => { if (el.textContent === m) el.textContent = ""; }, 5000);
  }
  function dire(m, ok) { const el = $("cgMsg"); el.textContent = m; el.className = "cg-msg " + (ok ? "ok" : "err"); }
  /* Retour visible sur le bouton lui-même (le message détaillé reste annoncé dans #cgMsg). */
  function flash(b, ok) {
    if (!b.dataset.html) b.dataset.html = b.innerHTML;
    b.textContent = ok ? "Copié ✓" : "Sélectionné : ⌘C ou Ctrl+C";
    clearTimeout(b._t); b._t = setTimeout(() => { b.innerHTML = b.dataset.html; delete b.dataset.html; }, 2200);
  }

  function mount(r) {
    /* « Où en est ton bilan » : déplié sur grand écran, replié sur mobile (la jauge du haut dit déjà où l'on en est). */
    const det = r.querySelector("#cgSecDet");
    if (det && typeof window !== "undefined" && window.matchMedia && window.matchMedia("(min-width:900px)").matches) det.open = true;
    root = r;
    /* Étapes de connexion : le même bloc que l'étape 3 de l'accueil (accueil.js), valeurs à copier comprises. */
    if (window.Accueil && typeof Accueil.connexion === "function") Accueil.connexion($("cgConnexion"));
    else $("cgConnexion").textContent = "Adresse du connecteur : " + MCP_URL;
    $("cgParcours").innerHTML = PARCOURS.map(p =>
      '<div class="cg-pc"><div class="cg-pc-t"><b>' + esc(p.titre) + '</b><span class="small muted">' + esc(p.desc) + "</span></div>" +
      '<div class="cg-pc-a"><a class="cg-btn" href="' + esc(lienClaude(p.prompt)) + '" target="_blank" rel="noopener" data-parcours="' + p.id + '">' + svg("ext") + "Ouvrir dans Claude<span class=\"cg-sr\"> (nouvel onglet) : " + esc(p.titre) + "</span></a>" +
      '<button type="button" class="cg-btn ghost" data-copy-prompt="' + p.id + '">' + svg("copie") + "Copier la demande</button></div>" +
      '<textarea class="cg-prompt" id="cgPrompt-' + p.id + '" readonly rows="3" hidden aria-label="Demande à copier : ' + esc(p.titre) + '">' + esc(p.prompt) + "</textarea></div>").join("");
    root.addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.cgRoutine) { if (!b.disabled) basculerRoutine(b); return; }
      if (b.hasAttribute("data-cg-banque-connecter")) { if (!b.disabled) connecterBq(b, null); return; }
      if (b.dataset.cgBanqueReconnecter) { const cx = trouver("connexions", b.dataset.cgBanqueReconnecter); if (cx && !b.disabled) connecterBq(b, cx); return; }
      if (b.dataset.cgBanqueSynchroniser) { const cx = trouver("connexions", b.dataset.cgBanqueSynchroniser); if (cx && !b.disabled) synchroniserBq(b, cx); return; }
      if (b.dataset.cgBanqueSuggestion) { const k = trouver("comptes", b.dataset.cgBanqueSuggestion); if (k && !b.disabled) rattacherSuggestion(b, k); return; }
      if (b.dataset.cgBanqueGerer) { const cx = trouver("connexions", b.dataset.cgBanqueGerer); if (cx && !b.disabled) connecterBq(b, cx, true); return; }
      if (b.dataset.cgBanqueDeconnecter) {
        const cx = trouver("connexions", b.dataset.cgBanqueDeconnecter); if (!cx) return;
        etatBq.confirmer = cx.id;
        banques('[data-cg-banque-confirmer="' + String(cx.id).replace(/"/g, "") + '"]');
        return;
      }
      if (b.dataset.cgBanqueAnnuler) {
        etatBq.confirmer = null;
        banques('[data-cg-banque-deconnecter="' + String(b.dataset.cgBanqueAnnuler).replace(/"/g, "") + '"]');
        return;
      }
      if (b.dataset.cgBanqueConfirmer) { const cx = trouver("connexions", b.dataset.cgBanqueConfirmer); if (cx && !b.disabled) deconnecterBq(b, cx); return; }
      if (b.hasAttribute("data-cg-copier-tache")) {
        const ok = await copier(promptTache(), root.querySelector("#cgRtPrompt"));
        direRt(ok ? "Prompt copié : colle-le dans une nouvelle tâche planifiée de Claude." : "Copie impossible : le prompt est sélectionné, copie-le avec Ctrl+C ou ⌘C.", ok);
        flash(b, ok);
        return;
      }
      if (b.hasAttribute("data-accueil")) {
        if (window.App && typeof App.accueil === "function") App.accueil({ etape: 1 });
      } else if (b.dataset.copyPrompt) {
        const p = PARCOURS.find(x => x.id === b.dataset.copyPrompt), ta = $("cgPrompt-" + p.id);
        const ok = await copier(p.prompt, ta);
        dire(ok ? "Demande « " + p.titre + " » copiée : colle-la dans une nouvelle conversation avec Claude." : "Copie impossible : la demande est sélectionnée ci-dessus, copie-la avec Ctrl+C ou ⌘C.", ok); flash(b, ok);
      }
    });
    root.addEventListener("change", e => { const s = e.target && e.target.closest && e.target.closest("[data-cg-banque-compte]"); if (s && !s.disabled) rattacherBq(s); });
    root.addEventListener("toggle", e => { const d = e.target; if (d.dataset && d.dataset.sec) { if (d.open) ouverts.add(d.dataset.sec); else ouverts.delete(d.dataset.sec); } }, true);
    /* Compte anonyme : uniquement en mode Supabase (la démo montre tout). */
    if (!demo() && window.Auth && typeof Auth.session === "function") {
      const set = s => { anon = typeof Auth.isAnonymous === "function" ? Auth.isAnonymous(s) : !!(s && s.user && s.user.is_anonymous); steps(); };
      Auth.session().then(set, () => {});
      if (typeof Auth.onChange === "function") Auth.onChange((ev, s) => { if (s) set(s); });
    }
    steps();
  }
  function update(snap, visible) { S = snap; dirty = true; if (visible) { render(); dirty = false; } }
  function show() { if (dirty) { render(); dirty = false; } }
  /* Chiffre clé : avancement du bilan (« 75 % »). */
  function headline() { const E = etat(); return E ? E.pourcentage + " %" : ""; }

  const api = { mount, update, show, headline };
  const reg = () => App.register("claude-guide", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
