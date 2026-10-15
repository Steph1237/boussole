/* Suivi de mes lignes — rendus HTML (SUIVI : GOV1 et SCO2, spec docs/superpowers/specs/2026-10-15-suivi-lignes-design.md § 11). Aucune écriture, aucun
   accès au DOM : fonctions pures qui reçoivent la vue calculée par Suivi (suivi.js) et renvoient du HTML déjà échappé. Global SuiviView (navigateur),
   module CommonJS sous Node. Utilisé par Patrimoine › Placements (pilotage.js : système cœur et satellite, rôle et météo de chaque ligne), par la fiche
   d'une ligne de Patrimoine › Comptes (comptes-view.js : « Ta ligne », constats, leviers et « ça vaut le coût ? ») et par Compte › Règles (regles.js :
   politique de suivi).
   Règles de présentation (spec § 9.1 et § 18.4) : sur une ligne nommée, des faits (chips factuelles : « au-dessus du repère de 5 % ») ; les jugements, les
   leviers et les verdicts portent sur une classe et une enveloppe (le titre d'un levier ne nomme jamais un instrument). La météo est un mot et une icône,
   jamais une note chiffrée ; l'état ne passe jamais par la couleur seule.
   SuiviView.vue(S, today) → Suivi.vue(Suivi.depuisEtat(S)) ; meteoHtml, roleChipHtml, systemeHtml, orbiteHtml, ligneSuiviHtml, leviersHtml, balanceHtml,
   politiqueHtml, chipConstat, phraseProposition. */
(function (root, factory) {
  const cjs = typeof module === "object" && module.exports;
  const dep = (nom, g) => (cjs ? require("./" + nom + ".js") : root[g]);
  const api = factory({ Suivi: dep("suivi", "Suivi"), Fmt: dep("format", "Fmt"), ClaudePrompts: dep("claude-prompts", "ClaudePrompts") });
  if (cjs) module.exports = api;
  else root.SuiviView = api;
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";
  const { Suivi, Fmt, ClaudePrompts } = D;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fini = v => v != null && v !== "" && isFinite(+v);
  const eur = v => (fini(v) ? Fmt.fmtEUR(v) : "—");
  const eurS = v => (fini(v) ? Fmt.fmtEUR(v, { signe: true }) : "—");
  const pct = (v, d) => (fini(v) ? Fmt.fmtPct(v, { decimales: d == null ? 0 : d }) : "—");
  const nombre = (v, d) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d == null ? 1 : d }).format(v);
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

  /** Capacité d'épargne mensuelle constatée (moteur de projection) pour chiffrer l'alternative par les versements ; null si elle n'est pas connue. */
  function capacite(S, today) {
    try {
      const P = typeof self !== "undefined" ? self.Projection : null;
      if (!P || typeof P.depuisEtat !== "function" || typeof P.capaciteDeBase !== "function") return null;
      const c = P.capaciteDeBase(P.depuisEtat(S, today), { perimetre: "foyer" });
      return c && fini(c.retenue) && +c.retenue > 0 ? +c.retenue : null;
    } catch (e) { return null; }
  }
  /** État de l'app restreint au périmètre affiché (une personne : ses lignes seulement). */
  const perimetre = S => (S.scope === "p1" || S.scope === "p2" ? Object.assign({}, S, { positions: (S.positions || []).filter(p => p && p.owner === S.scope) }) : S);
  /** Vue complète du suivi pour l'état S de l'app (ou null si le moteur manque). */
  function vue(S, today, opts) {
    if (!Suivi || !S) return null;
    try {
      const o = opts || {};
      return Suivi.vue(Suivi.depuisEtat(perimetre(S), Object.assign({ today }, o)), today, { capacite_mensuelle: o.capacite_mensuelle !== undefined ? o.capacite_mensuelle : capacite(S, today) });
    } catch (e) { return null; }
  }
  /** « Ta ligne » : rôle, constats et leviers d'une ligne (ou null). */
  function ligne(S, id, today, opts) {
    if (!Suivi || !S) return null;
    try {
      const o = opts || {};
      return Suivi.ligne(Suivi.depuisEtat(perimetre(S), Object.assign({ today }, o)), id, today, { capacite_mensuelle: o.capacite_mensuelle !== undefined ? o.capacite_mensuelle : capacite(S, today) });
    } catch (e) { return null; }
  }

  /* ================================================================== icônes (stroke currentColor, 20 px) */
  const SVG = (corps, taille) => '<svg class="sv-ico" viewBox="0 0 24 24" width="' + (taille || 20) + '" height="' + (taille || 20) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + corps + "</svg>";
  const ICONES = {
    clair: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    eclaircies: '<circle cx="8" cy="8" r="3"/><path d="M8 2v1.5M2 8h1.5M3.8 3.8l1 1M12.2 3.8l-1 1"/><path d="M8 19h9a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 12.4 3.3 3.3 0 0 0 8 19z"/>',
    a_regarder: '<path d="M7 15h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.7 8.4 3.3 3.3 0 0 0 7 15z"/><path d="M9 18.5v2M13 18.5v2M17 18.5v2"/>',
    a_completer: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 3.2"/>',
  };
  const icone = m => SVG(ICONES[m] || ICONES.a_completer);
  const PICTO_VERDICT = {
    vaut_le_cout: '<svg class="sv-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>',
    a_peser: '<svg class="sv-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>',
    ne_rien_faire: '<svg class="sv-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  };

  /** Icône et mot de la météo d'une ligne : « Au clair », « Éclaircies », « À regarder à ta revue », « À compléter ». */
  function meteoHtml(m, libelle) {
    const mot = libelle || (Suivi.METEO_LIB && Suivi.METEO_LIB[m]) || "À compléter";
    return '<span class="sv-meteo sv-m-' + esc(m) + '">' + icone(m) + '<span class="sv-meteo-mot">' + esc(mot) + "</span></span>";
  }
  /** Chip neutre du rôle ; un rôle proposé le dit. */
  function roleChipHtml(l) {
    const mot = l.role ? l.role_libelle : "Non classée";
    return '<span class="sv-role sv-r-' + esc(l.role || "nc") + (l.a_confirmer ? " propose" : "") + '">' + esc(mot) + (l.a_confirmer ? '<span class="sv-role-p">\u00a0· proposé</span>' : "") + "</span>";
  }

  /* ================================================================== chips factuelles des constats (spec § 18.4) */
  const CHIPS = {
    cout: { bon: "Dans le repère", a_surveiller: "Au-dessus du bas du repère", a_travailler: "Au-dessus du repère", a_completer: "À compléter" },
    poids: { bon: "Sous le repère", a_surveiller: "Proche du repère", a_travailler: "Au-dessus du repère", a_completer: "À compléter" },
    chevauchement: { bon: "Peu de lignes en commun", a_surveiller: "Des lignes en commun", a_travailler: "Beaucoup de lignes en commun", a_completer: "À compléter" },
    classe_risque: { bon: "Sans levier", a_surveiller: "Classe volatile", a_travailler: "Classe spéculative", a_completer: "À compléter" },
    solidite: { bon: "Au-dessus des repères", a_surveiller: "Sous un repère", a_travailler: "Sous un repère", a_completer: "À compléter" },
    enveloppe: { bon: "Rien à dire", a_surveiller: "Enveloppe à comparer", a_travailler: "Enveloppe à comparer", a_completer: "À compléter" },
    devise: { bon: "Information", a_surveiller: "Part en devises élevée", a_travailler: "Part en devises élevée", a_completer: "À compléter" },
  };
  const TON_PUCE = { bon: "bon", a_surveiller: "surveiller", a_travailler: "travailler", a_completer: "completer" };
  /** Texte factuel de la chip d'un constat : jamais « à travailler » ni un ordre. Le repère de poids est écrit avec son chiffre (« Au-dessus du repère de 5 % »). */
  function chipConstat(c) {
    const base = (CHIPS[c.cle] && CHIPS[c.cle][c.statut]) || "À compléter";
    if (c.cle === "poids" && c.repere && /(\d+) %/.test(c.repere.texte || "") && c.statut !== "a_completer") return base + " de " + /(\d+) %/.exec(c.repere.texte)[1] + " %";
    return base;
  }
  const puce = (ton, mot) => '<span class="ui-puce ' + TON_PUCE[ton] + '"><span class="ui-puce-point" aria-hidden="true"></span>' + esc(mot) + "</span>";

  /* ================================================================== phrases Claude */
  const phraseClaude = (section, contexte) => (ClaudePrompts ? ClaudePrompts.phrase(section, contexte) : "Boussole : aide-moi avec le suivi de mes lignes.");
  /** Lien « demander à Claude » (UI.demanderAClaude) ou rien si UI est absent. */
  const lienClaude = (U, phrase, libelle) => (U && typeof U.demanderAClaude === "function" ? U.demanderAClaude(phrase, libelle) : "");
  const phraseProposition = n => phraseClaude("suivi", "confirmer le rôle de " + pluriel(n, "ligne") + " (suivi_lignes, puis definir_suivi)");

  /* ================================================================== système cœur et satellite (Placements) */
  const R_ANNEAU = 62, C_ANNEAU = 2 * Math.PI * R_ANNEAU;
  /** Arc de cercle en dasharray : début et longueur en fraction de tour (0 à 1), départ à midi, sens horaire. */
  const arc = (debut, longueur, classe, extra) => {
    const l = Math.max(0, longueur) * C_ANNEAU, o = -debut * C_ANNEAU;
    return l <= 0 ? "" : '<circle class="sv-arc ' + classe + '" cx="100" cy="100" r="' + R_ANNEAU + '" transform="rotate(-90 100 100)" stroke-dasharray="' + l.toFixed(2) + " " + (C_ANNEAU - l + 0.01).toFixed(2) + '" stroke-dashoffset="' + o.toFixed(2) + '"' + (extra || "") + "/>";
  };
  /** Anneau à trois arcs proportionnels (cœur, satellite, réserve) avec la graduation du plafond satellite. v = Suivi.vue(). */
  function anneauSvg(v) {
    const sys = v.systeme, T = sys.montants.total, I = sys.montants.investi;
    if (!(T > 0)) return "";
    const part = x => x / T;
    const lignes = v.lignes;
    const somme = (role, valide) => lignes.filter(l => (role === "satellite" ? l.role === "satellite" || l.role === null : l.role === role) && l.a_confirmer !== valide).reduce((a, l) => a + l.valeur, 0);
    let pos = 0, g = "";
    const sequence = [["coeur", "sv-a-coeur"], ["satellite", "sv-a-sat"], ["reserve", "sv-a-res"]];
    const debuts = {};
    sequence.forEach(([role, cls]) => {
      const ok = somme(role, true), propose = somme(role, false), gap = 0.004;
      debuts[role] = pos;
      g += arc(pos + gap / 2, part(ok) - gap, cls);
      g += arc(pos + part(ok) + gap / 2, part(propose) - gap, cls + " sv-a-propose");
      pos += part(ok + propose);
    });
    // graduation du plafond : au bout du plafond (en % de l'investi) compté depuis le début de l'arc du satellite
    const capT = sys.plafond_satellite_pct / 100 * I / T, angle = (debuts.satellite + capT) * 2 * Math.PI - Math.PI / 2;
    const x1 = 100 + Math.cos(angle) * (R_ANNEAU - 13), y1 = 100 + Math.sin(angle) * (R_ANNEAU - 13), x2 = 100 + Math.cos(angle) * (R_ANNEAU + 13), y2 = 100 + Math.sin(angle) * (R_ANNEAU + 13);
    const tick = '<line class="sv-tick' + (sys.depasse ? " depasse" : "") + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
    return '<svg class="sv-anneau" viewBox="0 0 200 200" aria-hidden="true" focusable="false"><defs><pattern id="svHachure" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="sv-hach-fond"/><line x1="0" y1="0" x2="0" y2="6" class="sv-hach-trait"/></pattern></defs><circle class="sv-a-fond" cx="100" cy="100" r="' + R_ANNEAU + '"/>' + g + tick + "</svg>";
  }
  /** Phrase unique du système, reprise par l'aria-label et par la légende. */
  function phraseSysteme(v) {
    const s = v.systeme, p = s.parts_investi || null;
    const coeur = s.parts.coeur, sat = s.part_satellite_investi_pct, res = s.parts.reserve;
    return "Cœur " + pct(coeur) + " · Satellite " + pct(sat, sat < 10 ? 1 : 0) + " sur " + pct(s.plafond_satellite_pct) + " · Réserve " + pct(res);
  }
  /** Bloc « Cœur et satellite » : anneau, graduation, légende, orbite repliée, données en tableau. o = { U, ouvert (orbite dépliée) }. */
  function systemeHtml(v, o) {
    const opt = o || {}, s = v.systeme, T = s.montants.total;
    if (!v.lignes.length || !(T > 0)) return "";
    const phrase = phraseSysteme(v), aConfirmer = v.roles_a_confirmer.length, sats = v.lignes.filter(l => l.role === "satellite" || l.role === null);
    const coeurPart = s.parts.coeur;
    const etat = [];
    if (s.depasse) etat.push('<span class="ui-puce surveiller"><span class="ui-puce-point" aria-hidden="true"></span>À surveiller</span>');
    if (aConfirmer) etat.push(lienClaude(opt.U, phraseProposition(aConfirmer), "À confirmer avec Claude"));
    const lignesTab = [["Cœur", s.parts.coeur, s.montants.coeur], ["Satellite", s.parts.satellite, s.montants.satellite], ["Réserve", s.parts.reserve, s.montants.reserve]];
    if (s.montants.non_classees > 0) lignesTab.splice(2, 0, ["Non classées (comptées dans le satellite pour le plafond)", s.parts.non_classees, s.montants.non_classees]);
    const tableau = '<table class="sv-tab"><caption class="ui-sr">Répartition entre cœur, satellite et réserve</caption><thead><tr><th scope="col">Rôle</th><th scope="col">Part du total</th><th scope="col">Montant</th></tr></thead><tbody>' +
      lignesTab.map(r => "<tr><th scope=\"row\">" + esc(r[0]) + "</th><td>" + esc(pct(r[1], 1)) + "</td><td>" + esc(eur(r[2])) + "</td></tr>").join("") +
      '</tbody></table><p class="sv-tab-note">Plafond satellite : ' + esc(pct(s.plafond_satellite_pct)) + " de ton financier investi (" + esc(eur(s.montants.investi)) + "). Part satellite actuelle : " + esc(pct(s.part_satellite_investi_pct, 1)) +
      (s.depasse ? ", au-dessus du plafond" : "") + ".</p>";
    return '<div class="sv-systeme" data-sv-systeme>' +
      '<div class="sv-sys-visuel" role="img" aria-label="' + esc(phrase) + (s.depasse ? ". Plafond satellite dépassé" : "") + (aConfirmer ? ". Rôles à confirmer avec Claude" : "") + '">' + anneauSvg(v) +
      '<div class="sv-centre" aria-hidden="true"><span class="sv-centre-n">' + esc(pct(coeurPart)) + '</span><span class="sv-centre-l">cœur</span></div>' +
      '<span class="sv-plafond-etiq' + (s.depasse ? " depasse" : "") + '" aria-hidden="true">plafond ' + esc(pct(s.plafond_satellite_pct)) + (s.depasse ? " · dépassé" : "") + "</span></div>" +
      '<div class="sv-sys-texte"><p class="sv-sys-phrase">' + esc(phrase) + "</p>" +
      (etat.length ? '<p class="sv-sys-etat">' + etat.join(" ") + "</p>" : "") +
      (sats.length ? '<button type="button" class="sv-orbite-btn" data-sv-orbite aria-expanded="' + (opt.ouvert ? "true" : "false") + '" aria-controls="svOrbite">' + esc(opt.ouvert ? "Replier le satellite" : "Voir ton satellite en orbite") + "</button>" : "") +
      "</div>" +
      (sats.length ? '<div class="sv-orbite' + (opt.ouvert ? " ouvert" : "") + '" id="svOrbite" data-sv-orbite-zone' + (opt.ouvert ? "" : " hidden") + ">" + orbiteHtml(sats, s) + "</div>" : "") +
      '<details class="sv-donnees"><summary>Voir les données</summary>' + tableau + "</details></div>";
  }
  /** Orbite : chaque ligne du satellite est une pastille sur un cercle autour du cœur, de taille proportionnelle à son poids, avec sa météo. */
  function orbiteHtml(sats, sys) {
    const maxV = Math.max(...sats.map(l => l.valeur)), n = sats.length;
    const bulles = sats.map((l, i) => {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2, x = 50 + Math.cos(a) * 36, y = 50 + Math.sin(a) * 34, d = Math.round(44 + 28 * Math.sqrt(l.valeur / maxV));
      const mot = (Suivi.METEO_LIB && Suivi.METEO_LIB[l.meteo]) || "";
      return '<button type="button" class="sv-bulle sv-m-' + esc(l.meteo) + '" data-pl-ligne="' + esc(l.id) + '" style="left:' + x.toFixed(1) + "%;top:" + y.toFixed(1) + "%;width:" + d + "px;height:" + d + 'px" aria-haspopup="dialog" aria-label="' +
        esc(plat(l.nom) + " : " + eur(l.valeur) + (l.poids_pct != null ? ", " + pct(l.poids_pct, 1) + " du financier investi" : "") + ", météo : " + mot) + '">' + icone(l.meteo) + '<span class="sv-bulle-nom" aria-hidden="true">' + esc(plat(l.nom)) + "</span></button>";
    }).join("");
    return '<div class="sv-orbite-cadre"><span class="sv-orbite-coeur" aria-hidden="true">Cœur</span>' + bulles + '</div><p class="sv-orbite-note">La taille de chaque pastille suit le poids de la ligne ; touche une pastille pour ouvrir sa fiche.</p>';
  }

  /* ================================================================== Ta ligne : anneau segmenté, constats, leviers */
  const COULEUR_SEGMENT = { bon: "sv-seg-bon", a_surveiller: "sv-seg-surveiller", a_travailler: "sv-seg-travailler", a_completer: "sv-seg-completer" };
  const MARQUE = {
    bon: '<path d="M-3 0.5l2 2 4-4.5"/>', a_surveiller: '<path d="M-3 0h6"/>', a_travailler: '<path d="M0 -3.5v4M0 3.2v0.1"/>', a_completer: '<path d="M0 0v0.1"/>',
  };
  /** Anneau segmenté d'une ligne : un segment par constat applicable (couleur du statut et pictogramme dans le segment), la météo au centre. */
  function anneauLigneSvg(l) {
    const n = l.constats.length, R = 46, C = 2 * Math.PI * R;
    if (!n) return "";
    const gap = n > 1 ? 7 : 0, seg = (C - n * gap) / n;
    let g = "";
    l.constats.forEach((c, i) => {
      const debut = i * (seg + gap) + gap / 2, mid = (debut + seg / 2) / C * 2 * Math.PI - Math.PI / 2;
      g += '<circle class="sv-seg ' + COULEUR_SEGMENT[c.statut] + '" cx="60" cy="60" r="' + R + '" transform="rotate(-90 60 60)" stroke-dasharray="' + seg.toFixed(2) + " " + (C - seg + 0.01).toFixed(2) + '" stroke-dashoffset="' + (-debut).toFixed(2) + '"/>';
      g += '<g class="sv-marque" transform="translate(' + (60 + Math.cos(mid) * R).toFixed(1) + " " + (60 + Math.sin(mid) * R).toFixed(1) + ')">' + MARQUE[c.statut] + "</g>";
    });
    return '<svg class="sv-anneau-ligne" viewBox="0 0 120 120" aria-hidden="true" focusable="false">' + g + "</svg>";
  }
  const listeHtml = (xs, cls) => (xs && xs.length ? '<ul class="' + (cls || "sv-liste") + '">' + xs.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "");
  /** Constat en ligne de 56 px qui s'ouvre en panneau (ta situation, pourquoi, le calcul, les données, ce qui manque, demander à Claude). */
  function constatHtml(c, l, U) {
    const ctx = "le constat « " + c.libelle.toLowerCase() + " » de ma classe " + l.classe_libelle + (l.enveloppe ? " dans " + l.enveloppe : "");
    const donnees = (c.donnees || []).map(d => esc(d.libelle) + " : " + esc(d.valeur != null ? eur(d.valeur) : "")).join(" · ");
    return '<details class="sv-constat sv-c-' + esc(c.statut) + '"><summary class="sv-c-ligne"><span class="sv-c-txt"><span class="sv-c-nom">' + esc(c.libelle) + '</span><span class="sv-c-mesure">' + esc(c.mesure && c.mesure.texte ? c.mesure.texte : c.pourquoi) + "</span></span>" +
      puce(c.statut, chipConstat(c)) + '<span class="sv-c-chev" aria-hidden="true"></span></summary><div class="sv-c-corps">' +
      '<h4 class="sv-c-h">Ta situation</h4><p>' + esc(c.mesure && c.mesure.texte ? c.mesure.texte : "Pas encore de mesure.") + "</p>" +
      '<h4 class="sv-c-h">Pourquoi</h4><p>' + esc(c.pourquoi) + (c.repere && c.repere.texte ? " Repère : " + esc(c.repere.texte) + "." : "") + "</p>" +
      (c.calcul && c.calcul.length ? '<h4 class="sv-c-h">Le calcul</h4><ol class="sv-liste">' + c.calcul.map(x => "<li>" + esc(x) + "</li>").join("") + "</ol>" : "") +
      (donnees ? '<h4 class="sv-c-h">Les données</h4><p>' + donnees + (c.source_donnees ? " <span class=\"sv-muet\">(source : " + esc(c.source_donnees) + ")</span>" : "") + "</p>" : "") +
      (c.manque && c.manque.length ? '<h4 class="sv-c-h">Ce qui manque</h4>' + listeHtml(c.manque) : "") +
      '<div class="sv-c-claude">' + lienClaude(U, phraseClaude("suivi", ctx), "Demander à Claude") + "</div></div></details>";
  }

  /* ---------- leviers ---------- */
  /** Libellé du délai de retour sur investissement. */
  function rentabilise(res) {
    if (res.gain_annuel > 0 && res.point_mort_ans === 0) return "Rentabilisé tout de suite";
    if (res.point_mort_ans != null && res.gain_annuel > 0) return "Rentabilisé en " + nombre(res.point_mort_ans, res.point_mort_ans < 10 ? 1 : 0) + " an" + (res.point_mort_ans >= 2 ? "s" : "");
    return "Aucun gain certain en euros";
  }
  /** Balance : deux barres sur le même axe en euros, le gain cumulé sur l'horizon contre le coût unique, le point mort marqué sur la barre du gain. */
  function balanceHtml(res) {
    const G = res.gain_annuel || 0, C = res.cout_unique, h = res.horizon_ans || 0;
    if (C == null) return "";
    const cumul = G * h, max = Math.max(cumul, C, 1);
    const w = x => Math.min(100, Math.max(0, x / max * 100)).toFixed(1) + "%";
    const pm = res.point_mort_ans != null && G > 0 ? '<span class="sv-bal-pm" style="left:' + w(C) + '" aria-hidden="true"></span>' : "";
    const txt = "Gain cumulé sur " + nombre(h, 1) + " ans : " + eur(cumul) + ". Coût une fois : " + eur(C) + "." + (res.point_mort_ans != null && G > 0 ? " Point mort : " + nombre(res.point_mort_ans, 1) + " ans." : "");
    return '<div class="sv-balance" role="img" aria-label="' + esc(txt) + '">' +
      '<div class="sv-bal-ligne"><span class="sv-bal-l">Gain sur ' + esc(nombre(h, h < 10 ? 1 : 0)) + ' ans</span><span class="sv-bal-piste"><span class="sv-bal-barre sv-bal-gain" style="width:' + w(cumul) + '"></span>' + pm + '</span><span class="sv-bal-v">' + esc(eur(cumul)) + "</span></div>" +
      '<div class="sv-bal-ligne"><span class="sv-bal-l">Coût une fois</span><span class="sv-bal-piste"><span class="sv-bal-barre sv-bal-cout" style="width:' + w(C) + '"></span></span><span class="sv-bal-v">' + esc(eur(C)) + "</span></div></div>";
  }
  /** Une carte de levier : titre (classe et enveloppe), gain, coût, balance, verdict (mot et pictogramme), alternative, « Comment c'est calculé », « Préparer avec Claude ». */
  function carteLevierHtml(lv, o) {
    const res = lv.cout, opt = o || {}, U = opt.U;
    if (!res) return "";
    const verdict = res.verdict, libelle = verdict ? Suivi.VERDICT_LIB[verdict] : "À compléter";
    const detailCout = res.cout_detail ? [res.cout_detail.impot > 0 ? "impôt " + eur(res.cout_detail.impot) : "", res.cout_detail.transaction > 0 ? "courtage et écart " + eur(res.cout_detail.transaction) : ""].filter(Boolean).join(" + ") : "";
    const gain = res.gain_annuel > 0 ? '<p class="sv-lv-l"><span class="sv-lv-k">Gain</span><span class="sv-lv-v">+' + esc(eur(res.gain_annuel)) + ' par an</span><span class="sv-lv-s">certain : frais</span></p>' :
      '<p class="sv-lv-l"><span class="sv-lv-k">Gain</span><span class="sv-lv-v">aucun en euros</span><span class="sv-lv-s">' + (["reequilibrer", "securiser_objectif", "reduire_satellite", "versements_orientes"].includes(res.levier) ? "réduit un risque mesuré" : "frais déjà dans le repère") + "</span></p>";
    const cout = res.cout_unique == null ? '<p class="sv-lv-l"><span class="sv-lv-k">Coût</span><span class="sv-lv-v">à compléter</span><span class="sv-lv-s">' + esc((res.manque && res.manque[0]) || "") + "</span></p>" :
      '<p class="sv-lv-l"><span class="sv-lv-k">Coût</span><span class="sv-lv-v">' + esc(eur(res.cout_unique)) + (res.cout_unique > 0 ? " une fois" : "") + '</span><span class="sv-lv-s">' + esc(detailCout || (res.cout_unique === 0 ? "arbitrage interne, sans impôt" : "")) + "</span></p>";
    const alt = res.alternative ? '<p class="sv-lv-alt">Sans coût : oriente tes prochains versements pour cette classe' + (res.alternative.mois ? " (environ " + pluriel(res.alternative.mois, "mois", "mois") + " avec ton épargne constatée)" : "") + ".</p>" : "";
    const effet = opt.effet && opt.effet.objectifs && opt.effet.objectifs.length ? '<p class="sv-lv-effet">' + esc(opt.effet.objectifs.map(x => x.texte).filter(Boolean).join(" ; ")) + "</p>" : "";
    const ancienne = res.perte_anciennete ? '<p class="sv-lv-alt">' + (res.perte_anciennete.date ? "Tu repartirais de zéro pour l'ancienneté de « " + esc(res.perte_anciennete.enveloppe) + " » : " + esc(Fmt.fmtDate(res.perte_anciennete.date)) + " au plus tôt." : "Tu perdrais l'ancienneté de « " + esc(res.perte_anciennete.enveloppe) + " ».") + "</p>" : "";
    const calcul = '<details class="sv-lv-calcul"><summary>Comment c\'est calculé</summary>' + (res.calcul && res.calcul.length ? '<ol class="sv-liste">' + res.calcul.map(x => "<li>" + esc(x) + "</li>").join("") + "</ol>" : "") +
      (res.hypotheses && res.hypotheses.length ? '<h4 class="sv-c-h">Hypothèses</h4>' + listeHtml(res.hypotheses) : "") +
      (res.manque && res.manque.length ? '<h4 class="sv-c-h">Ce qui manque</h4>' + listeHtml(res.manque) : "") +
      (res.sources && res.sources.length ? '<h4 class="sv-c-h">Sources</h4>' + listeHtml(res.sources.map(s => [s.titre, s.verifie_le ? "vérifié le " + Fmt.fmtDate(s.verifie_le) : ""].filter(Boolean).join(", "))) : "") + "</details>";
    const verdictHtml = verdict ? '<p class="sv-verdict sv-v-' + esc(verdict) + '">' + PICTO_VERDICT[verdict] + '<span class="sv-verdict-mot">' + esc(libelle) + "</span></p>" : '<p class="sv-verdict sv-v-nul"><span class="sv-verdict-mot">Pas de verdict : une donnée manque</span></p>';
    const phraseL = "prépare avec moi le levier « " + res.titre + " » : lance ca_vaut_le_cout et passe en revue ses hypothèses.";
    return '<article class="sv-levier" data-sv-levier="' + esc(lv.cle) + '"><h4 class="sv-lv-titre">' + esc(lv.titre) + "</h4>" + gain + cout + balanceHtml(res) +
      '<p class="sv-lv-rent">' + esc(rentabilise(res)) + " · ton horizon : " + esc(nombre(res.horizon_ans, 1)) + " ans</p>" + verdictHtml +
      '<p class="sv-lv-phrase">' + esc(Suivi.phraseVerdict(res, opt.regardeLe)) + "</p>" + alt + ancienne + effet + calcul +
      '<div class="sv-lv-act">' + lienClaude(U, phraseClaude("suivi", phraseL), "Préparer avec Claude") + "</div></article>";
  }
  function leviersHtml(leviers, o) {
    const L = (leviers || []).filter(x => x.cout);
    if (!L.length) return '<p class="sv-muet">Rien à regarder pour cette classe aujourd\'hui : aucun seuil franchi.</p>';
    return '<div class="sv-leviers">' + L.map(lv => carteLevierHtml(lv, o)).join("") + "</div>";
  }

  /** Section « Suivi » de la fiche d'une ligne (« Ta ligne ») : l = Suivi.ligne() ; o = { U, today, effets }. */
  function ligneSuiviHtml(l, o) {
    if (!l) return "";
    const opt = o || {}, U = opt.U, meteoMot = (Suivi.METEO_LIB && Suivi.METEO_LIB[l.meteo]) || "", n = l.constats.length;
    const roleTxt = l.a_confirmer ? "Rôle proposé : " + (l.role ? l.role_libelle.toLowerCase() : "non classé") + " (" + l.raison_role_texte + "). Confirme-le avec Claude." : "Rôle : " + l.role_libelle.toLowerCase() + ", choisi avec Claude.";
    const revueTxt = l.revue && l.revue.texte ? l.revue.texte : "";
    return '<section class="sv-ligne" aria-labelledby="svLigneTitre" data-sv-ligne="' + esc(l.id) + '"><h3 class="sv-h" id="svLigneTitre">Ta ligne, en un coup d\'œil</h3>' +
      '<div class="sv-ligne-tete"><div class="sv-anneau-box" role="img" aria-label="Météo : ' + esc(meteoMot) + ", " + esc(l.couverture_texte) + '">' + anneauLigneSvg(l) + '<div class="sv-anneau-centre">' + meteoHtml(l.meteo, meteoMot) + "</div></div>" +
      '<div class="sv-ligne-txt"><p class="sv-ligne-role">' + roleChipHtml(l) + " " + (l.poids_pct != null ? "<span class=\"sv-muet\">" + esc(pct(l.poids_pct, 1)) + " de ton financier investi</span>" : "") + "</p>" +
      '<p class="sv-ligne-r">' + esc(roleTxt) + "</p><p class=\"sv-ligne-r\">" + esc(revueTxt) + "</p><p class=\"sv-muet\">" + esc(l.couverture_texte) + (l.gelee_jusquau ? " · météo figée jusqu'à la prochaine revue du cœur" : "") + "</p>" +
      (l.a_confirmer ? '<p>' + lienClaude(U, phraseProposition(1), "Confirmer avec Claude") + "</p>" : "") + "</div></div>" +
      '<h3 class="sv-h">Les constats</h3><div class="sv-constats">' + l.constats.map(c => constatHtml(c, l, U)).join("") + "</div>" +
      '<h3 class="sv-h">Les leviers de ta classe ' + esc(l.classe_libelle) + (l.enveloppe ? " dans « " + esc(l.enveloppe) + " »" : "") + "</h3>" + leviersHtml(l.leviers.map(x => Object.assign({}, x, { titre: x.cout && x.cout.titre ? x.cout.titre : x.titre })), { U, regardeLe: opt.today, effet: opt.effet }) +
      '<p class="sv-aide">Pour tout changement, Claude chiffre d\'abord « ça vaut le coût ? » : gain certain contre coût certain. Ces chiffres informent, ils ne recommandent aucun produit.</p></section>';
  }

  /* ================================================================== Compte › Règles : politique de suivi */
  /** Lignes de 56 px de la politique de suivi en vigueur ; chaque ligne affiche la valeur et « Modifier avec Claude ». */
  function politiqueHtml(pol, U) {
    const m = pol.mois_revue_coeur.map(x => MOIS[x - 1]).join(" et ");
    const lignes = [
      ["Revue du cœur", (pol.revue.coeur === "semestrielle" ? "Tous les six mois" : "Une fois par an") + ", en " + m, "la fréquence et le mois de la revue de mon cœur"],
      ["Écart d'une classe à sa cible", "Plus de " + nombre(pol.seuils.seuil_ecart_pts, 0) + " points", "le seuil d'écart d'une classe à sa cible"],
      ["Plafond de la part satellite", nombre(pol.plafond_satellite_pct, 0) + " % de ton financier investi" + (pol.mentions.length ? " (profil à faire)" : ""), "le plafond de ma part satellite"],
      ["Baisse d'une ligne satellite", "Plus de " + nombre(pol.seuils.seuil_baisse_satellite_pct, 0) + " %", "le seuil de baisse d'une ligne satellite"],
    ];
    return '<ul class="sv-regles">' + lignes.map(([nom, val, ctx]) => '<li class="sv-regle"><span class="sv-regle-txt"><span class="sv-regle-nom">' + esc(nom) + '</span><span class="sv-regle-val">' + esc(val) + "</span></span>" +
      '<span class="sv-regle-act">' + lienClaude(U, phraseClaude("suivi", ctx), "Modifier avec Claude") + "</span></li>").join("") + "</ul>" +
      '<p class="sv-muet sv-regles-src">' + (pol.source === "config" ? "Réglée avec Claude." : "Réglage par défaut selon ton profil et tes objectifs : demande à Claude de l'ajuster.") + "</p>";
  }

  return { vue, ligne, capacite, meteoHtml, roleChipHtml, chipConstat, systemeHtml, orbiteHtml, anneauSvg, anneauLigneSvg, ligneSuiviHtml, constatHtml, leviersHtml, carteLevierHtml, balanceHtml, politiqueHtml,
    phraseSysteme, phraseProposition, icone, rentabilise };
});
