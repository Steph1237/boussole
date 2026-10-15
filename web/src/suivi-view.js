/* Suivi de mes lignes — rendus HTML (SUIVI : GOV1 et SCO2, spec docs/superpowers/specs/2026-10-15-suivi-lignes-design.md § 11). Aucune écriture, aucun
   accès au DOM : fonctions pures qui reçoivent la vue calculée par Suivi (suivi.js) et renvoient du HTML déjà échappé. Global SuiviView (navigateur),
   module CommonJS sous Node. Utilisé par Patrimoine › Placements (pilotage.js : système cœur et satellite, rôle et météo de chaque ligne), par la fiche
   d'une ligne de Patrimoine › Comptes (comptes-view.js : « Ta ligne », constats, leviers et « ça vaut le coût ? ») et par Compte › Règles (regles.js :
   politique de suivi).
   Règles de présentation (spec § 9.1 et § 18.4) : sur une ligne nommée, des faits (chips factuelles : « au-dessus du repère de 5 % ») ; les jugements, les
   leviers et les verdicts portent sur une classe et une enveloppe (le titre d'un levier ne nomme jamais un instrument). La météo est un mot et une icône,
   jamais une note chiffrée ; l'état ne passe jamais par la couleur seule.
   SuiviView.vue(S, today) → Suivi.vue(Suivi.depuisEtat(S)) ; meteoHtml, roleChipHtml, systemeHtml, orbiteHtml, ligneSuiviHtml (verdict, constats triés, « Que faire ? »,
   « Pour compléter le diagnostic »), balanceHtml, politiqueHtml, chipConstat, phraseProposition, aller. */
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

  /* ================================================================== phrases Claude */
  const phraseClaude = (section, contexte) => (ClaudePrompts ? ClaudePrompts.phrase(section, contexte) : "Boussole : aide-moi avec le suivi de mes lignes.");
  /** Lien « demander à Claude » (UI.demanderAClaude) ou rien si UI est absent. */
  const lienClaude = (U, phrase, libelle, variante) => {
    const h = U && typeof U.demanderAClaude === "function" ? U.demanderAClaude(phrase, libelle) : "";
    return variante && h ? h.replace('class="ui-claude"', 'class="ui-claude sv-claude-' + variante + '"') : h; // primaire, secondaire ou texte : un seul bouton principal par écran
  };
  const phraseProposition = n => phraseClaude("suivi", "confirmer le rôle de " + pluriel(n, "ligne") + " (suivi_lignes, puis definir_suivi)");

  /* ================================================================== système cœur et satellite (Placements) */
  const R_ANNEAU = 62, C_ANNEAU = 2 * Math.PI * R_ANNEAU;
  /** Arc de cercle en dasharray : début et longueur en fraction de tour (0 à 1), départ à midi, sens horaire. */
  const arc = (debut, longueur, classe, extra) => {
    const l = Math.max(0, longueur) * C_ANNEAU, o = -debut * C_ANNEAU;
    if (l <= 0) return "";
    // arc pointillé (rôle proposé, pas encore confirmé) : traits de 4 séparés de 3, ce qui ne repose pas que sur l'opacité
    let da = l.toFixed(2) + " " + (C_ANNEAU - l + 0.01).toFixed(2);
    if (/\bsv-a-propose\b/.test(classe)) {
      const seg = []; let reste = l;
      while (reste > 0.05) { const t = Math.min(4, reste); seg.push(t.toFixed(2)); reste -= t; if (reste > 0.05) { const v = Math.min(3, reste); seg.push(v.toFixed(2)); reste -= v; } }
      if (seg.length % 2 === 0) seg.pop();
      seg.push((C_ANNEAU - l + 0.01).toFixed(2));
      da = seg.length % 2 ? seg.join(" ") + " 0" : seg.join(" ");
    }
    return '<circle class="sv-arc ' + classe + '" cx="100" cy="100" r="' + R_ANNEAU + '" transform="rotate(-90 100 100)" stroke-dasharray="' + da + '" stroke-dashoffset="' + o.toFixed(2) + '"' + (extra || "") + "/>";
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

  /* ================================================================== Ta ligne : verdict, constats triés, que faire, ce qui manque */
  const NB = " ";
  /** Nombre en pourcents, décimales utiles seulement (0,6 % ; 0,35 % ; 16,8 % ; 45 %). */
  const P = (v, d) => (fini(v) ? nombre(+v, d == null ? 1 : d) + NB + "%" : "—");
  const PAN = (v, d) => P(v, d) + "/an";

  /* ---------- niveaux de gravité : alerte, à surveiller, à compléter, OK (et info) ---------- */
  const NIVEAUX = ["alerte", "surveiller", "completer", "ok"];
  const NIV = {
    alerte: { chip: "Alerte", ton: "travailler", un: "alerte", plusieurs: "alertes" },
    surveiller: { chip: "À surveiller", ton: "surveiller", un: "à surveiller", plusieurs: "à surveiller" },
    completer: { chip: "Manque une donnée", ton: "completer", un: "à compléter", plusieurs: "à compléter" },
    ok: { chip: "OK", ton: "bon", un: "OK", plusieurs: "OK" },
    info: { chip: "Info", ton: "bon", un: "OK", plusieurs: "OK" },
  };
  /** Niveau d'un constat : un constat « bon » sur la devise d'une ligne hors euro n'est qu'une information. */
  function niveauConstat(c) {
    if (c.statut === "a_travailler") return "alerte";
    if (c.statut === "a_surveiller") return "surveiller";
    if (c.statut === "a_completer") return "completer";
    return c.cle === "devise" && c.mesure && c.mesure.devise && c.mesure.devise !== "EUR" ? "info" : "ok";
  }
  const groupeNiveau = n => (n === "info" ? "ok" : n);
  /** Texte de la chip d'un constat : Alerte, À surveiller, OK, Manque une donnée, Info (jamais un ordre, jamais « à travailler »). */
  const chipConstat = c => NIV[niveauConstat(c)].chip;
  const puce = (niv, mot) => '<span class="ui-puce ' + NIV[niv].ton + '"><span class="ui-puce-point" aria-hidden="true"></span>' + esc(mot || NIV[niv].chip) + "</span>";
  /** Constats triés du plus grave au moins grave (alerte, à surveiller, à compléter, OK et info) ; l'ordre d'origine est gardé à gravité égale. */
  const trier = cs => cs.map((c, i) => ({ c, i, r: NIVEAUX.indexOf(groupeNiveau(niveauConstat(c))) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.c);
  const comptes = cs => { const n = { alerte: 0, surveiller: 0, completer: 0, ok: 0 }; cs.forEach(c => { n[groupeNiveau(niveauConstat(c))]++; }); return n; };

  /* ---------- le chiffre contre son repère, en mots simples ---------- */
  const minus = t => t.charAt(0).toLowerCase() + t.slice(1);
  const roleDe = l => (l.role === "satellite" || l.role === null ? "un satellite" : l.role === "coeur" ? "le cœur" : "la réserve");
  function maxRepere(c) {
    const r = c.repere || {};
    if (fini(r.max)) return +r.max;
    const m = /(\d+(?:,\d+)?) %/.exec(r.texte || "");
    return m ? +m[1].replace(",", ".") : null;
  }
  /** { valeur, repere, jauge } d'un constat : « 16,8 % » et « repère ≤ 5 % pour un satellite » ; valeur seule quand rien ne se compare. */
  function chiffreConstat(c, l) {
    const m = c.mesure || {}, r = c.repere || {};
    if (c.statut === "a_completer") return { valeur: "", repere: c.manque && c.manque[0] ? "Il manque : " + minus(String(c.manque[0]).split(" : ")[0]) : "Pas encore de mesure" };
    switch (c.cle) {
      case "poids": return { valeur: P(m.valeur, 1), repere: "repère ≤ " + P(maxRepere(c), 0) + " pour " + roleDe(l) };
      case "cout": {
        const fourch = fini(r.bas) && fini(r.haut) ? "fourchette repère " + nombre(+r.bas, 2) + " à " + P(r.haut, 2) + "/an pour cette classe" : "repère : au plus " + P(0.4, 2) + "/an";
        return { valeur: PAN(m.valeur, 2), repere: fourch };
      }
      case "classe_risque": return { valeur: "Volatilité ≈" + NB + P(m.valeur, 0) + "/an", repere: fini(r.surveiller) ? "repère : à surveiller dès " + P(r.surveiller, 0) + (l.classe === "levier" || l.classe === "crypto" ? " ; levier et crypto sont spéculatifs" : "") : "" };
      case "chevauchement": return { valeur: P(m.valeur, 0) + " en commun", repere: fini(r.surveiller) && fini(r.travailler) ? "repère : sous " + P(r.surveiller, 0) + ", doublon au-delà de " + P(r.travailler, 0) : "" };
      case "solidite": {
        const v = [fini(m.valeur) ? "Encours " + eur(m.valeur) : "", fini(m.anciennete_ans) ? nombre(m.anciennete_ans, 0) + " ans d'ancienneté" : ""].filter(Boolean).join(", ");
        return { valeur: v, repere: fini(r.encours_min) ? "repère : au moins " + eur(r.encours_min) + " et plus de " + nombre(r.anciennete_min_ans, 0) + " ans" : "" };
      }
      case "enveloppe": return { valeur: l.enveloppe || "Enveloppe non précisée", repere: c.statut === "bon" ? "rien d'anormal pour cette classe" : "un PEA du foyer a encore de la place" };
      case "devise": return { valeur: m.devise && m.devise !== "EUR" ? "En " + m.devise + " : " + P(m.valeur, 0) : "En euros", repere: m.devise && m.devise !== "EUR" ? "information ; à surveiller dès " + P(r.max, 0) + " pour un profil Prudent" : "pas de risque de change" };
      default: return { valeur: m.texte || "", repere: r.texte || "" };
    }
  }

  /* ---------- mini-jauge : la valeur contre son repère (poids, coût, volatilité, chevauchement, devise) ---------- */
  function jaugeSpec(c) {
    const m = c.mesure || {}, r = c.repere || {}, v = +m.valeur;
    if (c.statut === "a_completer" || !fini(m.valeur)) return null;
    if (c.cle === "poids" && maxRepere(c)) return { v, marques: [{ x: maxRepere(c), l: "repère " + P(maxRepere(c), 0) }], fin: Math.max(v, maxRepere(c)) * 1.3, fmt: x => P(x, 1) };
    if (c.cle === "cout" && fini(r.bas) && fini(r.haut)) return { v, zone: [+r.bas, +r.haut], marques: [], zl: "repère " + nombre(+r.bas, 2) + " à " + P(r.haut, 2), fin: Math.max(v, +r.haut) * 1.35, fmt: x => P(x, 2) + "/an" };
    if (c.cle === "classe_risque" && fini(r.surveiller)) return { v, marques: [{ x: +r.surveiller, l: "dès " + P(r.surveiller, 0) }], fin: Math.max(v, +r.surveiller) * 1.25, fmt: x => P(x, 0) + "/an" };
    if (c.cle === "chevauchement" && fini(r.surveiller) && fini(r.travailler)) return { v, marques: [{ x: +r.surveiller, l: P(r.surveiller, 0) }, { x: +r.travailler, l: P(r.travailler, 0) }], fin: Math.min(100, Math.max(v, +r.travailler) * 1.2), fmt: x => P(x, 0) };
    if (c.cle === "devise" && fini(r.max) && m.devise && m.devise !== "EUR") return { v, marques: [{ x: +r.max, l: P(r.max, 0) }], fin: Math.max(v, +r.max) * 1.3, fmt: x => P(x, 0) };
    return null;
  }
  /** Piste, barre de la valeur, repère(s) en tirets ; la valeur et le repère sont aussi écrits en toutes lettres (aria-label et ligne de chiffres). */
  function jaugeHtml(c) {
    const g = jaugeSpec(c);
    if (!g || !(g.fin > 0)) return "";
    const w = x => Math.min(100, Math.max(0, x / g.fin * 100));
    const pos = x => w(x).toFixed(1) + "%";
    const zone = g.zone ? '<span class="sv-j-zone" style="left:' + pos(g.zone[0]) + ";width:" + (w(g.zone[1]) - w(g.zone[0])).toFixed(1) + '%"></span>' : "";
    const traits = g.marques.map(k => '<span class="sv-j-rep" style="left:' + pos(k.x) + '"></span>').join("");
    const leg = (g.marques.map(k => ({ x: k.x, l: k.l })).concat(g.zone ? [{ x: (g.zone[0] + g.zone[1]) / 2, l: g.zl }] : [])).map(k => {
      const p = w(k.x), cote = p > 72 ? " d" : p < 14 ? " g" : "";
      return '<span class="sv-j-leg' + cote + '" style="left:' + p.toFixed(1) + '%">' + esc(k.l) + "</span>";
    }).join("");
    const lu = g.fmt(g.v) + (g.marques.length ? ", repère " + g.marques.map(k => k.l.replace(/^repère |^dès /, "")).join(" et ") : g.zone ? ", " + g.zl : "");
    return '<span class="sv-jauge" role="img" aria-label="' + esc(lu) + '"><span class="sv-j-piste">' + zone + '<span class="sv-j-barre" style="width:' + pos(g.v) + '"></span>' + traits + '</span><span class="sv-j-legendes" aria-hidden="true">' + leg + "</span></span>";
  }

  /* ---------- verdict : la phrase tirée des constats les plus graves ---------- */
  /** Deux formes par constat : `debut` (« Cette ligne … ») et `suite` (« …, et … »). null si le constat n'a pas de chiffre à dire. */
  function clauseConstat(c, l) {
    const m = c.mesure || {}, r = c.repere || {}, niv = niveauConstat(c);
    if (niv !== "alerte" && niv !== "surveiller") return null;
    switch (c.cle) {
      case "poids": {
        const lien = niv === "alerte" ? "alors que ton repère pour " + roleDe(l) + " est " + P(maxRepere(c), 0) : "tout près de ton repère pour " + roleDe(l) + " (" + P(maxRepere(c), 0) + ")";
        return { debut: "pèse " + P(m.valeur, 1) + " de ton financier investi " + lien, suite: "elle pèse " + P(m.valeur, 1) + " de ton financier investi " + lien };
      }
      case "classe_risque": {
        const vol = "(volatilité ≈" + NB + P(m.valeur, 0) + "/an)";
        if (niv === "alerte") { const q = l.classe === "crypto" ? "de la crypto" : "un produit à effet de levier"; return { debut: "est " + q + " " + vol, suite: "c'est " + q + " " + vol }; }
        return { debut: "est dans une classe plus volatile que les actions du monde développé " + vol, suite: "sa classe est plus volatile que les actions du monde développé " + vol };
      }
      case "cout": {
        const ref = niv === "alerte" ? "au-dessus du haut du repère de sa classe" + (fini(r.haut) ? " (" + PAN(r.haut, 2) + ")" : "") : "au-dessus du bas du repère de sa classe" + (fini(r.bas) ? " (" + PAN(r.bas, 2) + ")" : "");
        return { debut: "a des frais courants de " + PAN(m.valeur, 2) + ", " + ref, suite: "ses frais courants sont de " + PAN(m.valeur, 2) + ", " + ref };
      }
      case "chevauchement": return niv === "alerte" ? { debut: "double " + P(m.valeur, 0) + " des principales lignes d'un autre de tes fonds", suite: "elle double " + P(m.valeur, 0) + " des principales lignes d'un autre de tes fonds" } :
        { debut: "partage " + P(m.valeur, 0) + " de ses principales lignes avec un autre de tes fonds", suite: "elle partage " + P(m.valeur, 0) + " de ses principales lignes avec un autre de tes fonds" };
      case "solidite": return { debut: "repose sur un fonds encore petit ou récent (" + chiffreConstat(c, l).valeur.toLowerCase() + ")", suite: "son fonds est encore petit ou récent (" + chiffreConstat(c, l).valeur.toLowerCase() + ")" };
      case "enveloppe": return { debut: "est dans un compte-titres alors qu'un PEA de ton foyer a encore de la place", suite: "un PEA de ton foyer a encore de la place pour cette classe" };
      case "devise": return { debut: "est en " + (m.devise || "devise") + " : " + P(m.valeur, 0) + " de ton financier investi, pour un profil Prudent", suite: "elle est en " + (m.devise || "devise") + " : " + P(m.valeur, 0) + " de ton financier investi" };
      default: return null;
    }
  }
  /** Niveau global : Alerte, À surveiller, Diagnostic incomplet ou Tout va bien. Une alerte passe avant un manque de données. */
  function niveauLigne(l) {
    const n = comptes(l.constats);
    if (n.alerte) return "alerte";
    if (n.surveiller) return "surveiller";
    if (n.completer && l.meteo === "a_completer") return "incomplet";
    return "ok";
  }
  const PILULE = { alerte: { mot: "Alerte", ton: "alerte" }, surveiller: { mot: "À surveiller", ton: "surveiller" }, incomplet: { mot: "Diagnostic incomplet", ton: "incomplet" }, ok: { mot: "Tout va bien", ton: "ok" } };
  /** Une phrase, avec ses chiffres, bâtie sur les un ou deux constats les plus graves. */
  function phraseVerdictLigne(l) {
    const niv = niveauLigne(l), n = comptes(l.constats), cl = trier(l.constats).filter(c => ["alerte", "surveiller"].includes(niveauConstat(c))).map(c => clauseConstat(c, l)).filter(Boolean);
    if (cl.length) return "Cette ligne " + cl[0].debut + (cl[1] ? ", et " + cl[1].suite : "") + ".";
    const cv = l.couverture || { calcules: 0, applicables: l.constats.length };
    if (niv === "incomplet") return "Il manque trop de données pour juger cette ligne : " + cv.calcules + " point" + (cv.calcules > 1 ? "s" : "") + " sur " + cv.applicables + " seulement " + (cv.calcules > 1 ? "sont calculés" : "est calculé") + ".";
    return "Rien à signaler : " + (n.ok > 1 ? "les " + n.ok + " points calculés sont" : "le point calculé est") + " dans les repères." + (n.completer ? " " + (n.completer > 1 ? n.completer + " restent" : "1 reste") + " à compléter pour un diagnostic complet." : "");
  }

  /* ---------- icônes de la pilule et du bilan ---------- */
  const ICO_PILULE = {
    alerte: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4v.1"/>',
    surveiller: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    incomplet: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3.2"/><path d="M8.5 12h.1M12 12h.1M15.5 12h.1"/>',
    ok: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.4l2.7 2.7 4.9-5.5"/>',
  };

  /* ---------- une ligne de constat, qui s'ouvre en détail ---------- */
  const listeHtml = (xs, cls) => (xs && xs.length ? '<ul class="' + (cls || "sv-liste") + '">' + xs.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "");
  /** Constat : nom, chiffre contre repère, chip de gravité, mini-jauge ; le détail (situation, pourquoi, calcul, données, ce qui manque) s'ouvre dessous. */
  function constatHtml(c, l) {
    const niv = niveauConstat(c), ch = chiffreConstat(c, l);
    const donnees = (c.donnees || []).map(d => esc(d.libelle) + " : " + esc(d.valeur != null ? eur(d.valeur) : "")).join(" · ");
    return '<details class="sv-constat sv-n-' + groupeNiveau(niv) + '" data-sv-niveau="' + groupeNiveau(niv) + '"><summary class="sv-c-ligne"><span class="sv-c-nom">' + esc(c.libelle) + "</span>" + puce(niv) + '<span class="sv-c-chev" aria-hidden="true"></span>' +
      '<span class="sv-c-chiffre">' + (ch.valeur ? '<strong class="sv-c-val">' + esc(ch.valeur) + "</strong>" : "") + (ch.repere ? '<span class="sv-c-rep">' + (ch.valeur ? " · " : "") + esc(ch.repere) + "</span>" : "") + "</span>" +
      jaugeHtml(c) + '</summary><div class="sv-c-corps">' +
      '<h4 class="sv-c-h">Ta situation</h4><p>' + esc(c.mesure && c.mesure.texte ? c.mesure.texte : "Pas encore de mesure.") + "</p>" +
      '<h4 class="sv-c-h">Pourquoi</h4><p>' + esc(c.pourquoi) + (c.repere && c.repere.texte ? " Repère : " + esc(c.repere.texte) + "." : "") + "</p>" +
      (c.calcul && c.calcul.length ? '<h4 class="sv-c-h">Le calcul</h4><ol class="sv-liste">' + c.calcul.map(x => "<li>" + esc(x) + "</li>").join("") + "</ol>" : "") +
      (donnees ? '<h4 class="sv-c-h">Les données</h4><p>' + donnees + (c.source_donnees ? ' <span class="sv-muet">(source : ' + esc(c.source_donnees) + ")</span>" : "") + "</p>" : "") +
      (c.manque && c.manque.length ? '<h4 class="sv-c-h">Ce qui manque</h4>' + listeHtml(c.manque) : "") + "</div></details>";
  }
  /** Les constats, du plus grave au moins grave ; les « OK » et « Info » sont repliés sous « N points sans problème ». */
  function constatsHtml(l) {
    const tries = trier(l.constats), pb = tries.filter(c => groupeNiveau(niveauConstat(c)) !== "ok"), ok = tries.filter(c => groupeNiveau(niveauConstat(c)) === "ok");
    const groupe = ok.length ? '<details class="sv-ok-groupe"' + (pb.length ? "" : " open") + '><summary class="sv-ok-resume"><span>' + esc(pluriel(ok.length, "point") + " sans problème") + '</span><span class="sv-c-chev" aria-hidden="true"></span></summary>' + ok.map(c => constatHtml(c, l)).join("") + "</details>" : "";
    return '<div class="sv-constats">' + pb.map(c => constatHtml(c, l)).join("") + groupe + "</div>";
  }

  /* ---------- leviers : « Que faire ? » ---------- */
  const LEVIERS_RISQUE = ["reequilibrer", "securiser_objectif", "reduire_satellite"];
  /** Libellé du délai de retour sur investissement. */
  function rentabilise(res) {
    if (res.gain_annuel > 0 && res.point_mort_ans === 0) return "Rentabilisé tout de suite";
    if (res.point_mort_ans != null && res.gain_annuel > 0) return "Rentabilisé en " + nombre(res.point_mort_ans, res.point_mort_ans < 10 ? 1 : 0) + " an" + (res.point_mort_ans >= 2 ? "s" : "");
    return "Aucun gain certain en euros";
  }
  /** Balance : deux barres sur le même axe en euros, le gain cumulé sur l'horizon contre le coût unique ; seulement quand le gain se chiffre. */
  function balanceHtml(res) {
    const G = res.gain_annuel || 0, C = res.cout_unique, h = res.horizon_ans || 0;
    if (C == null || !(G > 0)) return "";
    const cumul = G * h, max = Math.max(cumul, C, 1);
    const w = x => Math.min(100, Math.max(0, x / max * 100)).toFixed(1) + "%";
    const pm = res.point_mort_ans != null ? '<span class="sv-bal-pm" style="left:' + w(C) + '" aria-hidden="true"></span>' : "";
    const txt = "Gain cumulé sur " + nombre(h, 1) + " ans : " + eur(cumul) + ". Coût une fois : " + eur(C) + "." + (res.point_mort_ans != null ? " Point mort : " + nombre(res.point_mort_ans, 1) + " ans." : "");
    return '<div class="sv-balance" role="img" aria-label="' + esc(txt) + '">' +
      '<div class="sv-bal-ligne"><span class="sv-bal-l">Gain sur ' + esc(nombre(h, h < 10 ? 1 : 0)) + ' ans</span><span class="sv-bal-piste"><span class="sv-bal-barre sv-bal-gain" style="width:' + w(cumul) + '"></span>' + pm + '</span><span class="sv-bal-v">' + esc(eur(cumul)) + "</span></div>" +
      '<div class="sv-bal-ligne"><span class="sv-bal-l">Coût une fois</span><span class="sv-bal-piste"><span class="sv-bal-barre sv-bal-cout" style="width:' + w(C) + '"></span></span><span class="sv-bal-v">' + esc(eur(C)) + "</span></div></div>";
  }
  const VERDICT_PUCE = {
    vaut_le_cout: { mot: "Ça vaut le coût", cls: "vaut_le_cout" }, a_peser: { mot: "À peser", cls: "a_peser" }, ne_rien_faire: { mot: "Pas rentable", cls: "ne_rien_faire" }, manque: { mot: "Il manque une donnée", cls: "nul" },
  };
  /** Ce que tu fais, en une phrase, selon le type de levier (une classe et une enveloppe, jamais un instrument). */
  function actionLevier(lv, res) {
    const m = fini(res.montant) ? res.montant : fini(lv.montant) ? lv.montant : null, env = res.enveloppe ? " dans « " + res.enveloppe + " »" : "";
    switch (res.levier) {
      case "reduire_satellite": return "Réduire d'environ " + (m != null ? eur(m) : "la part excédentaire") + " ta classe " + Suivi.classeLib(res.classe) + env + " et replacer cet argent sur une autre classe.";
      case "frais_classe": return "Remplacer les fonds de la classe " + Suivi.classeLib(res.classe) + env + " par des fonds moins chers" + (m != null ? " (" + eur(m) + " concernés)" : "") + ".";
      case "reequilibrer": return "Déplacer environ " + (m != null ? eur(m) : "l'écart") + " de la classe " + Suivi.classeLib(res.classe) + " vers celles sous leur fourchette, d'abord à l'intérieur de" + (res.enveloppe ? " « " + res.enveloppe + " »" : " ton enveloppe") + ".";
      case "securiser_objectif": return "Passer progressivement " + (m != null ? "environ " + eur(m) : "cet argent") + " sur des supports sans risque de baisse avant l'échéance de ton objectif.";
      case "changer_enveloppe": return "Placer la classe " + Suivi.classeLib(res.classe) + " de « " + (res.enveloppe || "ton enveloppe") + " » dans « " + (res.vers_enveloppe || "une autre enveloppe") + " »" + (m != null ? " (" + eur(m) + ")" : "") + ".";
      default: return res.titre || lv.titre || "";
    }
  }
  const NOM_LEVIER = { reduire_satellite: "Revenir sous ton plafond satellite", frais_classe: "Réduire les frais de la classe", reequilibrer: "Ramener la classe vers sa cible", securiser_objectif: "Sécuriser l'argent d'un objectif proche",
    changer_enveloppe: "Changer d'enveloppe pour cette classe", fonds_ferme: "Comprendre la fermeture d'un fonds" };
  /** Une option avec un coût : ce que tu fais, coût certain, gain attendu, verdict (mot et pictogramme), « Comment c'est calculé ». */
  function optionHtml(lv, o) {
    const res = lv.cout, opt = o || {};
    if (!res) return "";
    const verdict = res.verdict, vp = VERDICT_PUCE[verdict || "manque"];
    const detail = res.cout_detail ? [res.cout_detail.impot > 0 ? "impôt " + eur(res.cout_detail.impot) : "", res.cout_detail.transaction > 0 ? (res.transaction_libelle || "frais de transaction") + " " + eur(res.cout_detail.transaction) : ""].filter(Boolean).join(" + ") : "";
    const gain = res.gain_annuel > 0 ? "<strong>+" + esc(eur(res.gain_annuel)) + " par an</strong> <span class=\"sv-muet\">certain : frais économisés</span>" :
      LEVIERS_RISQUE.includes(res.levier) ? "<strong>Pas de gain chiffrable</strong> <span class=\"sv-muet\">réduit un risque</span>" : "<strong>Pas de gain certain</strong> <span class=\"sv-muet\">tes frais sont déjà dans le repère</span>";
    const cout = res.cout_unique == null ? "<strong>À chiffrer</strong> <span class=\"sv-muet\">il manque une donnée (voir plus bas)</span>" :
      "<strong>" + esc(eur(res.cout_unique)) + (res.cout_unique > 0 ? " une fois" : "") + "</strong> <span class=\"sv-muet\">" + esc(detail || (res.cout_unique === 0 ? "arbitrage interne, sans impôt" : "")) + "</span>";
    const effet = opt.effet && opt.effet.objectifs && opt.effet.objectifs.length ? '<p class="sv-o-note">' + esc(opt.effet.objectifs.map(x => x.texte).filter(Boolean).join(" ; ")) + "</p>" : "";
    const ancienne = res.perte_anciennete ? '<p class="sv-o-note">' + (res.perte_anciennete.date ? "Tu repartirais de zéro pour l'ancienneté de « " + esc(res.perte_anciennete.enveloppe) + " » : " + esc(Fmt.fmtDate(res.perte_anciennete.date)) + " au plus tôt." : "Tu perdrais l'ancienneté de « " + esc(res.perte_anciennete.enveloppe) + " ».") + "</p>" : "";
    const aussi = lv.fusionnes && lv.fusionnes.length ? '<p class="sv-o-note">Répond aussi à : ' + lv.fusionnes.map(f => esc(f.titre) + (f.verdict == null && f.manque && f.manque.length ? " (chiffrage de l'ensemble : il manque une donnée)" : "")).join(" ; ") + ".</p>" : "";
    const calcul = '<details class="sv-lv-calcul"><summary>Comment c\'est calculé</summary>' + (res.calcul && res.calcul.length ? '<ol class="sv-liste">' + res.calcul.map(x => "<li>" + esc(x) + "</li>").join("") + "</ol>" : "") +
      (res.hypotheses && res.hypotheses.length ? '<h4 class="sv-c-h">Hypothèses</h4>' + listeHtml(res.hypotheses) : "") +
      (res.manque && res.manque.length ? '<h4 class="sv-c-h">Ce qui manque</h4>' + listeHtml(res.manque) : "") +
      (res.sources && res.sources.length ? '<h4 class="sv-c-h">Sources</h4>' + listeHtml(res.sources.map(s => [s.titre, s.verifie_le ? "vérifié le " + Fmt.fmtDate(s.verifie_le) : ""].filter(Boolean).join(", "))) : "") + "</details>";
    const portee = [res.classe ? "Classe " + Suivi.classeLib(res.classe) : "", res.enveloppe ? "dans « " + res.enveloppe + " »" : ""].filter(Boolean).join(" ");
    return '<article class="sv-option" data-sv-levier="' + esc(lv.cle) + '"><h4 class="sv-o-titre">' + esc(NOM_LEVIER[res.levier] || res.titre || lv.titre) + "</h4>" + (portee ? '<p class="sv-o-portee">' + esc(portee) + "</p>" : "") +
      '<p class="sv-o-action">' + esc(actionLevier(lv, res)) + "</p>" +
      '<dl class="sv-o-faits"><div><dt>Coût certain</dt><dd>' + cout + "</dd></div><div><dt>Gain attendu</dt><dd>" + gain + "</dd></div></dl>" + balanceHtml(res) +
      (res.gain_annuel > 0 ? '<p class="sv-o-note">' + esc(rentabilise(res)) + " · ton horizon : " + esc(nombre(res.horizon_ans, 1)) + " ans</p>" : "") +
      '<p class="sv-verdict sv-v-' + vp.cls + '">' + (verdict ? PICTO_VERDICT[verdict] : icone("a_completer")) + '<span class="sv-verdict-mot">' + esc(vp.mot) + "</span></p>" +
      '<p class="sv-o-phrase">' + esc(Suivi.phraseVerdict(res, opt.regardeLe)) + "</p>" + ancienne + effet + aussi + calcul + "</article>";
  }
  /** Option sans coût : orienter les prochains versements (le levier lui-même, ou l'alternative d'un levier qui coûte). */
  function optionGratuite(leviers) {
    const vers = leviers.find(x => x.levier === "versements_orientes" && x.cout), alt = leviers.map(x => x.cout && x.cout.alternative).find(Boolean);
    if (!vers && !alt) return null;
    const mois = vers && vers.cout && vers.cout.mois_pour_combler ? vers.cout.mois_pour_combler : alt && alt.mois ? alt.mois : null;
    const montant = vers && vers.cout && (vers.cout.calcul || []).find(x => /^Montant à orienter/.test(x));
    return { mois, montant: montant || null };
  }
  /** « Que faire ? » : l'option sans coût d'abord, puis chaque option avec son coût certain, son gain et son verdict ; un seul bouton Claude. */
  function faireHtml(l, o) {
    const opt = o || {}, U = opt.U, L = (l.leviers || []).filter(x => x.cout), payantes = L.filter(x => x.levier !== "versements_orientes"), libre = optionGratuite(L);
    const cible = l.classe_libelle + (l.enveloppe ? " dans « " + l.enveloppe + " »" : "");
    let corps;
    if (!libre && !payantes.length) corps = '<p class="sv-f-vide">Rien à faire pour l\'instant : aucun seuil de ta classe ' + esc(cible) + " n'est franchi.</p>";
    else {
      const gratuite = libre ? '<article class="sv-option sv-gratuite"><h4 class="sv-o-titre">Sans coût <span class="ui-puce bon"><span class="ui-puce-point" aria-hidden="true"></span>0 €</span></h4>' +
        '<p class="sv-o-action">Oriente tes prochains versements vers d\'autres classes. Aucune vente, donc rien à payer ; le poids de cette classe baisse peu à peu.</p>' +
        (libre.mois ? '<p class="sv-o-note">Environ ' + esc(pluriel(libre.mois, "mois", "mois")) + " avec ton épargne constatée.</p>" : "") + (libre.montant ? '<p class="sv-o-note">' + esc(libre.montant) + ".</p>" : "") + "</article>" : "";
      corps = gratuite + (payantes.length ? '<p class="sv-f-sous">' + esc(payantes.length > 1 ? "Si tu veux agir plus vite, ces options ont un coût :" : "Si tu veux agir plus vite, cette option a un coût :") + "</p>" : "") + payantes.map(lv => optionHtml(lv, opt)).join("");
    }
    const phraseL = payantes.length === 1 ? "prépare avec moi le levier « " + (payantes[0].cout.titre || payantes[0].titre) + " » : lance ca_vaut_le_cout et passe en revue ses hypothèses." :
      payantes.length ? "prépare avec moi les options de ma ligne : lance ca_vaut_le_cout sur chacune et passe en revue leurs hypothèses." : "prépare avec moi l'orientation de mes prochains versements pour cette classe.";
    return '<section class="sv-faire" aria-labelledby="svFaireTitre"><h3 class="sv-h" id="svFaireTitre">Que faire ?</h3><p class="sv-f-cible">Pour ta classe ' + esc(cible) + "</p>" + corps +
      ((libre || payantes.length) ? '<div class="sv-f-act">' + lienClaude(U, phraseClaude("suivi", phraseL), "Préparer avec Claude", "primaire") + "</div>" : "") + "</section>";
  }

  /* ---------- ce qui manque, en un seul bloc ---------- */
  /** Données à compléter : celles des constats « manque une donnée » et celles des leviers sans verdict, dédoublonnées. */
  function manquesDe(l) {
    const vus = new Map();
    const ajouter = (txt, pour) => {
      const t = String(txt || "").trim();
      if (!t) return;
      const [quoi, ...reste] = t.split(" : "), cle = quoi.toLowerCase();
      if (!vus.has(cle)) vus.set(cle, { quoi, pourquoi: reste.join(" : "), pour: [] });
      if (pour && !vus.get(cle).pour.includes(pour)) vus.get(cle).pour.push(pour);
    };
    (l.constats || []).filter(c => c.statut === "a_completer").forEach(c => (c.manque && c.manque.length ? c.manque : [c.pourquoi]).forEach(m => ajouter(m, c.libelle)));
    (l.leviers || []).forEach(lv => {
      (lv.cout && lv.cout.manque || []).forEach(m => ajouter(m, "le chiffrage d'un levier"));
      (lv.fusionnes || []).forEach(f => (f.manque || []).forEach(m => ajouter(m, "le chiffrage d'un levier")));
    });
    return [...vus.values()];
  }
  function completerHtml(l, o) {
    const M = manquesDe(l), U = (o || {}).U;
    if (!M.length) return "";
    const maj = s => s.charAt(0).toUpperCase() + s.slice(1);
    const items = M.map(m => '<li class="sv-m-item"><span class="sv-m-quoi">' + esc(maj(m.quoi)) + '</span><span class="sv-m-pour">' + esc((m.pourquoi ? maj(m.pourquoi) + ". " : "") + "Sert à : " + m.pour.join(", ")) + ".</span></li>").join("");
    const phrase = phraseClaude("suivi", "compléter le diagnostic de ma ligne : " + M.map(m => m.quoi.charAt(0).toLowerCase() + m.quoi.slice(1)).join(" ; "));
    return '<section class="sv-manque" aria-labelledby="svManqueTitre"><h3 class="sv-h" id="svManqueTitre">Pour compléter le diagnostic</h3><ul class="sv-m-liste">' + items + "</ul>" +
      '<div class="sv-m-act">' + lienClaude(U, phrase, "Compléter avec Claude", "secondaire") + "</div></section>";
  }

  /* ---------- en-tête : verdict, résumé par gravité, rôle et revue ---------- */
  function resumeHtml(l) {
    const n = comptes(l.constats), cv = l.couverture || { calcules: 0, applicables: l.constats.length };
    const bouts = NIVEAUX.filter(k => n[k] > 0).map(k => '<li><button type="button" class="sv-bilan-btn" data-sv-aller="' + k + '" aria-label="' + esc(n[k] + " " + (n[k] > 1 ? NIV[k].plusieurs : NIV[k].un) + " : aller aux constats") + '"><span class="sv-dot sv-dot-' + k + '" aria-hidden="true"></span>' +
      '<span class="sv-bilan-n">' + n[k] + "</span><span>" + esc(n[k] > 1 ? NIV[k].plusieurs : NIV[k].un) + "</span></button></li>").join("");
    return '<ul class="sv-bilan" aria-label="Constats par niveau">' + bouts + "</ul>" + '<p class="sv-vt-couv">' + esc(cv.calcules + " constat" + (cv.calcules > 1 ? "s" : "") + " calculé" + (cv.calcules > 1 ? "s" : "") + " sur " + cv.applicables) + "</p>";
  }
  function teteHtml(l, o) {
    const U = (o || {}).U, niv = niveauLigne(l), pil = PILULE[niv];
    const role = l.a_confirmer ? "Rôle proposé : " + (l.role ? l.role_libelle.toLowerCase() : "non classé") + " — à confirmer" : "Rôle : " + l.role_libelle.toLowerCase() + ", choisi avec Claude";
    const raison = l.a_confirmer && l.raison_role_texte ? " (" + l.raison_role_texte + ")" : "";
    const cites = trier(l.constats).filter(c => ["alerte", "surveiller"].includes(niveauConstat(c))).slice(0, 2).map(c => c.cle);
    const poids = l.poids_pct != null && !cites.includes("poids") ? '<span class="sv-vt-poids">Poids : ' + esc(P(l.poids_pct, 1)) + " de ton financier investi</span>" : "";
    return '<header class="sv-tete sv-t-' + pil.ton + '"><div class="sv-vt-haut"><span class="sv-pilule sv-p-' + pil.ton + '">' + SVG(ICO_PILULE[niv], 18) + "<span>" + esc(pil.mot) + '</span></span><h3 class="sv-vt-titre" id="svLigneTitre">Diagnostic de la ligne</h3></div>' +
      '<p class="sv-vt-phrase">' + esc(phraseVerdictLigne(l)) + "</p>" + resumeHtml(l) +
      '<p class="sv-vt-role"><span>' + esc(role + raison) + "</span>" + (l.a_confirmer ? lienClaude(U, phraseProposition(1), "Confirmer avec Claude", "texte") : "") + poids + "</p>" +
      '<p class="sv-vt-revue">' + esc((l.revue && l.revue.texte) || "") + (l.gelee_jusquau ? " Météo figée jusqu'à la prochaine revue du cœur." : "") + "</p></header>";
  }

  /** Section « Suivi » de la fiche d'une ligne (« Ta ligne ») : l = Suivi.ligne() ; o = { U, today, effet }. Diagnostic (verdict, constats triés, données manquantes) à gauche,
      « Que faire ? » à droite quand la place le permet (requête de conteneur) ; un seul bouton Claude principal (« Préparer avec Claude »). */
  function ligneSuiviHtml(l, o) {
    if (!l) return "";
    const opt = o || {}, o2 = { U: opt.U, regardeLe: opt.today, effet: opt.effet };
    return '<section class="sv-ligne" aria-labelledby="svLigneTitre" data-sv-ligne="' + esc(l.id) + '"><div class="sv-grille">' + teteHtml(l, opt) +
      '<div class="sv-zone-constats"><h3 class="sv-h">Les constats</h3><p class="sv-aide sv-h-sous">Du plus important au moins important ; touche une ligne pour voir le calcul.</p>' + constatsHtml(l) + "</div>" +
      faireHtml(l, o2) + '<div class="sv-zone-manque">' + completerHtml(l, opt) + "</div>" +
      '<p class="sv-pied">Pour tout changement, Claude chiffre d\'abord « ça vaut le coût ? » : gain certain contre coût certain. Ces chiffres informent, ils ne recommandent aucun produit.</p></div></section>';
  }
  /** Va aux constats d'un niveau (bouton du bilan) : déplie « points sans problème » si besoin, fait défiler et met le focus sur la première ligne. */
  function aller(bouton) {
    const racine = bouton && bouton.closest ? bouton.closest("[data-sv-ligne]") : null, niv = bouton && bouton.getAttribute && bouton.getAttribute("data-sv-aller");
    const cible = racine && niv ? racine.querySelector('[data-sv-niveau="' + niv + '"]') : null;
    if (!cible) return false;
    const g = cible.closest("details.sv-ok-groupe");
    if (g) g.open = true;
    const resume = cible.querySelector("summary"), reduit = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof cible.scrollIntoView === "function") cible.scrollIntoView({ block: "center", behavior: reduit ? "auto" : "smooth" });
    if (resume && typeof resume.focus === "function") resume.focus({ preventScroll: true });
    cible.classList.add("sv-flash");
    setTimeout(() => cible.classList.remove("sv-flash"), 1600);
    return true;
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

  return { vue, ligne, capacite, meteoHtml, roleChipHtml, chipConstat, niveauConstat, niveauLigne, phraseVerdictLigne, chiffreConstat, jaugeHtml, systemeHtml, orbiteHtml, anneauSvg, ligneSuiviHtml,
    constatHtml, constatsHtml, faireHtml, optionHtml, completerHtml, manquesDe, balanceHtml, politiqueHtml, aller, phraseSysteme, phraseProposition, icone, rentabilise };
});
