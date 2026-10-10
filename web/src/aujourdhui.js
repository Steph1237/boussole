/* Aujourd'hui : page d'accueil du cockpit (« le board lit, l'agent écrit »).
   - Bandeau de 4 indicateurs en cartes (UI.carte) : patrimoine net et variation sur la période de la frise, bonnes pratiques,
     écart d'allocation au profil de risque, prochaine échéance ; chaque carte ouvre UI.panneau (2-4 lignes + lien vers la page).
   - Boîte de réception unique (5 éléments puis « Voir plus ») : propositions de Claude en attente (par lot), entrées du journal à relire
     (CK2), alertes des règles (rules.js), points « à suivre » échus de la mémoire de l'agent, échéances à 30 jours, cours manquants /
     photo nocturne en retard.
   - Frise : patrimoine net estimé (BilanCalc.evolution sur S.snapshots) agrégé par Periodes, avec UI.periode (défaut 1 an, au mois) ;
     repères verticaux aux dates des décisions du journal (titre au survol, clic ou Entrée → UI.panneau avec la synthèse).
   Fonctions pures exportées pour les tests (module.exports) : boite, echeances, indicateurs, frise, reperesJournal, urlClaude, delai, et les
   rendus HTML cartes, detail, repereDetail, boiteHtml, friseSvg (qui reçoivent UI en paramètre quand ils en ont besoin ; aucune ne touche
   au DOM).
   Dépendances injectées (deps) : { Rules, Calc, BilanCalc, Pratiques, Risque, Periodes } ; window.* par défaut. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : glob(k));

  /* ---------- dates (AAAA-MM-JJ, jours calendaires) ---------- */
  const pad = n => String(n).padStart(2, "0");
  /** Date locale AAAA-MM-JJ (aujourd'hui par défaut). */
  function jour(d) {
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const x = d == null ? new Date() : new Date(d);
    if (!isFinite(x)) return "";
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }
  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const utc = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  const jj = v => (v ? String(v).slice(0, 10) : "");
  const dateFr = s => (isoOk(s) ? new Date(s + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");
  /** Délai lisible jusqu'à une date à `jours` jours : « aujourd'hui », « demain », « dans N jours » (jusqu'à 60 jours),
      « dans N mois » (jusqu'à 24 mois), puis « dans N ans ». court : « dans N j » au lieu de « dans N jours ». */
  function delai(jours, court) {
    const d = Math.max(0, Math.round(+jours || 0));
    if (d === 0) return "aujourd'hui";
    if (d === 1) return "demain";
    if (d <= 60) return "dans " + d + (court ? " j" : " jours");
    const mois = Math.round(d / 30.4375);
    if (mois <= 24) return "dans " + mois + " mois";
    return "dans " + Math.round(d / 365.25) + " ans";
  }

  /* ---------- nombres et textes ---------- */
  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  const eur = v => (Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €";
  const eurS = v => (Math.round(v) > 0 ? "+" : Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €";
  const kEur = v => (Math.abs(v) >= 1e6 ? nf1.format(v / 1e6) + " M€" : Math.abs(v) >= 1e3 ? nf0.format(v / 1e3) + " k€" : nf0.format(v) + " €");
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  const liste = xs => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " et " + xs[xs.length - 1]);
  const maj = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const extrait = (t, n) => { const s = plat(t); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const counted = p => !!p && p.status !== "à recevoir" && p.status !== "clôturé";

  /* ---------- liens ---------- */
  const R = { propositions: "agent/propositions", journal: "agent/journal", placements: "patrimoine/placements", budget: "patrimoine/budget", sante: "pilotage/sante", risque: "pilotage/risque" };
  /** Lien vers une nouvelle conversation Claude, question préremplie (même forme que UI.demanderAClaude). */
  function urlClaude(question) { return "https://claude.ai/new?q=" + encodeURIComponent(String(question ?? "")); }
  const httpsOk = u => /^https:\/\//.test(String(u || ""));

  /* =============================================================== boîte de réception =============================================================== */
  const CIBLES = { protection: "protection de la famille", position: "placements", bien: "biens immobiliers", credit: "crédits", budget: "budget",
    objectif: "objectifs", risque: "profil de risque", profil: "profil" };
  const URGENCE = { crit: 1, warn: 2, info: 3 };
  /* Contrôles intégrés déjà présents sous une autre forme, reconnus par leur `kind` (rules.js) : échéances de config.milestones
     (type « echeance ») et mise à jour nocturne (type « cours »). */
  const estJalon = a => !a.rule && a.kind === "jalon";
  const estNocturne = a => !a.rule && a.kind === "nocturne";
  function lienAlerte(a) {
    if (!a.rule && a.kind === "matelas") return { label: "Voir le budget", route: R.budget };
    return { label: "Voir les placements", route: R.placements }; // règles de l'utilisateur, écarts aux cibles, signaux de la nuit
  }

  /** Échéances à venir (aujourd'hui compris), triées : jalons de config, objectifs datés, points « à suivre » de la mémoire.
      → [{ source: jalon|objectif|a_suivre, date, jours, titre, texte, cible? }] */
  function echeances(S, today) {
    const s = S || {}, t = jour(today), out = [];
    const add = (source, date, titre, texte, extra) => {
      if (!isoOk(date)) return;
      const d = joursEntre(t, date); if (d < 0) return;
      out.push(Object.assign({ source, date, jours: d, titre: plat(titre), texte: plat(texte) }, extra || {}));
    };
    const ms = s.config && Array.isArray(s.config.milestones) ? s.config.milestones : [];
    ms.forEach(m => { if (m && m.date) add("jalon", jj(m.date), m.title || "Échéance", m.text || ""); });
    (Array.isArray(s.objectifs) ? s.objectifs : []).forEach(o => {
      if (o && o.dateCible) add("objectif", jj(o.dateCible), "Objectif « " + plat(o.nom || "sans nom") + " »", "", { cible: +o.cible || 0 });
    });
    (Array.isArray(s.memoire) ? s.memoire : []).forEach(m => {
      if (m && m.categorie === "a_suivre" && m.echeance) add("a_suivre", jj(m.echeance), "À reprendre : " + extrait(m.contenu, 90), "");
    });
    return out.map((x, i) => ({ x, i })).sort((a, b) => a.x.jours - b.x.jours || a.i - b.i).map(o => o.x);
  }

  /** Tout ce qui demande une action, trié par urgence (1 haute … 3) puis date (la plus ancienne d'abord).
      → [{ type: proposition|journal|alerte|a_suivre|echeance|cours, urgence, date, titre, contexte, action: { label, route } | { label, url } }]
      Textes bruts : l'échappement se fait au rendu. deps = { Rules } (window.Rules par défaut). */
  function boite(S, today, deps) {
    if (!S || S.ready === false) return [];
    const t = jour(today), out = [];
    const Rules = dep(deps, "Rules");

    // 1. Propositions de Claude en attente, une entrée par lot.
    const lots = new Map();
    (Array.isArray(S.propositions) ? S.propositions : []).filter(p => p && p.statut === "en_attente").forEach(p => {
      const k = p.lot ? "lot:" + p.lot : "id:" + p.id;
      if (!lots.has(k)) lots.set(k, []);
      lots.get(k).push(p);
    });
    lots.forEach(ps => {
      const cibles = [...new Set(ps.map(p => CIBLES[p.cible] || plat(p.cible || "données")))];
      const date = ps.map(p => jj(p.creeLe)).filter(isoOk).sort().pop() || t;
      out.push({ type: "proposition", urgence: 1, date, titre: "Claude propose " + pluriel(ps.length, "changement"),
        contexte: maj(liste(cibles)) + " : rien n'est enregistré sans votre accord.",
        action: { label: "Examiner", route: R.propositions } });
    });

    // 1 bis. Entrées du journal à relire (écrites par l'agent, à confirmer ou corriger), un seul élément.
    const aRelire = (Array.isArray(S.journal) ? S.journal : []).filter(e => e && e.statut === "a_relire");
    if (aRelire.length) {
      const titres = aRelire.slice(0, 2).map(e => "« " + extrait(e.titre, 60) + " »").join(", ") + (aRelire.length > 2 ? "…" : "");
      out.push({ type: "journal", urgence: 1, date: aRelire.map(e => jj(e.creeLe)).filter(isoOk).sort().pop() || t,
        titre: pluriel(aRelire.length, "entrée") + " du journal à relire",
        contexte: titres + " : confirmez ou corrigez ce que l'agent a noté.",
        action: { label: "Relire", route: R.journal } });
    }

    // 2. Alertes des règles de l'utilisateur et des contrôles intégrés (même contexte que Recommandations › Actions).
    if (Rules) {
      const ctx = { positions: S.positions || [], config: S.config || {}, scope: S.scope || "foyer", people: S.people || [], today: t, status: S.status || null };
      let A = [];
      try { A = Rules.evaluate(ctx.config.rules || [], ctx).concat(Rules.builtins(ctx)); }
      catch (e) { if (typeof console !== "undefined") console.error("alertes", e); }
      A.filter(a => a && !estJalon(a) && !estNocturne(a)).forEach(a => out.push({ type: "alerte", urgence: URGENCE[a.level] || 3, date: t,
        titre: plat(a.title || "Alerte"), contexte: plat(a.text), action: lienAlerte(a) }));
    }

    // 3. Points « à suivre » échus de la mémoire de l'agent.
    (Array.isArray(S.memoire) ? S.memoire : []).forEach(m => {
      const e = m && m.categorie === "a_suivre" ? jj(m.echeance) : "";
      if (!isoOk(e) || e > t) return;
      const contenu = plat(m.contenu);
      out.push({ type: "a_suivre", urgence: 2, date: e, titre: "À reprendre : " + contenu,
        contexte: "Noté par " + plat(m.source || "l'agent") + ", prévu le " + dateFr(e) + ".",
        action: { label: "Reprendre avec Claude", url: urlClaude("Reprenons ce point noté dans ma mémoire Boussole : « " + contenu + " ». Où en est-on ?") } });
    });

    // 4. Échéances à 30 jours au plus (jalons de config, objectifs datés).
    echeances(S, t).filter(e => e.source !== "a_suivre" && e.jours <= 30).forEach(e => out.push({ type: "echeance", urgence: e.jours <= 7 ? 2 : 3, date: e.date,
      titre: e.titre, contexte: "Le " + dateFr(e.date) + " (" + delai(e.jours) + ")." + (e.texte ? " " + e.texte : "") + (e.cible ? " Cible : " + eur(e.cible) + "." : ""),
      action: { label: "Voir budget et objectifs", route: R.budget } }));

    // 5. Cours manquants et photo nocturne en retard (fraîcheur de l'en-tête : positions cotées, S.status).
    const sans = (S.positions || []).filter(p => counted(p) && p.mode === "market" && p.price == null);
    const st = S.status || null, manquants = Math.max(sans.length, (st && +st.missingPrices) || 0);
    if (manquants > 0) out.push({ type: "cours", urgence: 3, date: t, titre: pluriel(manquants, "cours manquant"),
      contexte: (sans.length ? "Sans cours : " + extrait(sans.slice(0, 3).map(p => p.name).join(", ") + (sans.length > 3 ? "…" : ""), 80) + ". " : "") +
        "Leur valeur n'est pas à jour dans le patrimoine.",
      action: { label: "Voir les placements", route: R.placements } });
    const lr = st && jj(st.lastRun);
    if (isoOk(lr) && joursEntre(lr, t) > 2) out.push({ type: "cours", urgence: 3, date: lr, titre: "Mise à jour nocturne en retard",
      contexte: "Dernier passage le " + dateFr(lr) + " : les cours et la photo du patrimoine ne sont plus à jour.",
      action: { label: "Voir les placements", route: R.placements } });

    return out.map((x, i) => ({ x, i })).sort((a, b) => a.x.urgence - b.x.urgence || (a.x.date < b.x.date ? -1 : a.x.date > b.x.date ? 1 : a.i - b.i)).map(o => o.x);
  }

  /* =============================================================== indicateurs =============================================================== */
  const PERIODE_TXT = { "1m": "sur 1 mois", "3m": "sur 3 mois", "6m": "sur 6 mois", ytd: "depuis janvier", "1a": "sur 1 an", "3a": "sur 3 ans", tout: "depuis la première photo" };
  const estPerso = p => !!p && /^perso/.test(String(p.id)) && isoOk(p.du) && isoOk(p.au);
  const periodeTxt = p => (estPerso(p) ? "du " + dateFr(p.du) + " au " + dateFr(p.au) : PERIODE_TXT[p && p.id] || PERIODE_TXT["1a"]);

  /** Repères de la frise : décisions du journal non abandonnées et datées, triées par date → [{ id, date, titre, synthese, statut }]. */
  function reperesJournal(journal) {
    return (Array.isArray(journal) ? journal : [])
      .filter(e => e && e.type === "decision" && e.statut !== "abandonne" && isoOk(jj(e.dateDecision)))
      .map(e => ({ id: String(e.id), date: jj(e.dateDecision), titre: plat(e.titre), synthese: plat(e.synthese), statut: e.statut }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /** Série de la frise : patrimoine net estimé (photos + point du jour) agrégé sur la période, et repères des décisions du journal.
      periode = { id: 1m|3m|1a|tout|perso…, du?, au?, granularite? } → { points (Periodes.agreger), resume, bornes, granularite, historique, reperes } */
  function frise(S, today, periode, deps) {
    const BC = dep(deps, "BilanCalc"), Pe = dep(deps, "Periodes"), t = jour(today), s = S || {}, p = periode || {};
    const vide = { points: [], resume: { debut: null, fin: null, variation: null, variationPct: null }, bornes: null, granularite: p.granularite || "mois", historique: false,
      reperes: reperesJournal(s.journal) };
    if (!BC || !Pe) return vide;
    let pts = [];
    try { pts = BC.evolution(s.snapshots || [], s.positions || [], s.profil || null, s.scope || "foyer", t); } catch (e) { return vide; }
    if (!pts.length) return vide;
    const id = estPerso(p) ? { du: p.du, au: p.au } : PERIODE_TXT[p.id] ? p.id : "1a";
    const b = Pe.bornes(id, t, pts[0].date);
    const g = !p.granularite || p.granularite === "auto" || !Pe.GRANULARITES.some(x => x.id === p.granularite) ? Pe.auto(b) : p.granularite;
    const ag = Pe.agreger(pts, b, g, x => x.net);
    return { points: ag, resume: Pe.resume(ag, pts, b, x => x.net), bornes: b, granularite: g, historique: pts.some(x => !x.live), reperes: vide.reperes };
  }

  /** Les 4 indicateurs du bandeau (périmètre S.scope), en valeurs brutes ; le texte est composé par cartes() et detail(). */
  function indicateurs(S, today, periode, deps) {
    const s = S || {}, t = jour(today), scope = s.scope || "foyer", positions = s.positions || [];
    const C = dep(deps, "Calc"), Pr = dep(deps, "Pratiques"), Ri = dep(deps, "Risque");
    // Patrimoine net (et variation sur la période de la frise)
    const pat = C ? C.patrimoine(positions, s.profil || null, scope) : { financier: 0, immobilier: 0, usage: 0, entreprise: 0, dettes: 0, net: 0 };
    const f = frise(s, t, periode, deps);
    const net = { valeur: pat.net, financier: pat.financier, immobilier: pat.immobilier, autres: pat.usage + pat.entreprise, dettes: pat.dettes,
      vide: !positions.some(counted) && !pat.immobilier && !pat.dettes && !pat.usage && !pat.entreprise,
      variation: f.historique ? f.resume.variation : null, variationPct: f.historique ? f.resume.variationPct : null };
    // Bonnes pratiques
    let r = null;
    if (Pr && typeof Pr.evaluer === "function") {
      try { r = Pr.evaluer({ positions, profil: s.profil || null, config: s.config || null, budget: s.budget || null, objectifs: s.objectifs || [], scope,
        risque: s.risque || null, classes: s.classes || {}, today: new Date(t + "T12:00:00") }); } catch (e) { r = null; }
    }
    const crit = r && Array.isArray(r.criteres) ? r.criteres : [];
    const pratiques = { total: r && r.total != null ? r.total : null, provisoire: !!(r && r.provisoire),
      familles: r && Array.isArray(r.familles) ? r.familles.map(x => ({ titre: x.titre, total: x.total })) : [],
      aCompleter: crit.filter(c => c && c.aCompleter).length };
    // Écart d'allocation au profil de risque (actifs financiers, comme Pilotage › Risque et la bonne pratique « adéquation »)
    const idp = s.risque && s.risque.profil ? (typeof s.risque.profil === "object" ? s.risque.profil.id : String(s.risque.profil)) : null;
    const fiche = idp && Ri && Array.isArray(Ri.PROFILS) ? Ri.PROFILS.find(p => p.id === idp) : null;
    const allocation = { profil: fiche ? fiche.label : null, points: null, hors: [], placements: C ? C.financier(positions, scope) > 0 : positions.some(counted) };
    if (fiche && allocation.placements) {
      try {
        const ec = Ri.ecarts(fiche.id, Ri.allocationReelle(positions, scope, { surcharge: s.classes || {} }));
        allocation.points = ec.reduce((a, e) => a + Math.abs(+e.ecartPts || 0), 0);
        allocation.hors = ec.filter(e => e.statut !== "dans").map(e => ({ label: e.label, reel: e.reel, min: e.min, max: e.max, statut: e.statut, ecartPts: e.ecartPts }));
      } catch (e) { allocation.points = null; }
    }
    // Prochaine échéance
    const ech = echeances(s, t);
    return { net, pratiques, allocation, echeance: { prochaine: ech[0] || null, liste: ech.slice(0, 4) }, frise: f };
  }

  /** Date (AAAA-MM-JJ) de la première photo de S.snapshots, pour la période « Tout » ; undefined sans photo. */
  function premiereDate(snapshots) {
    let p;
    (Array.isArray(snapshots) ? snapshots : []).forEach(x => { const d = x && jj(x.date); if (isoOk(d) && (!p || d < p)) p = d; });
    return p;
  }

  /* =============================================================== rendus HTML =============================================================== */
  const fpts = v => nf1.format(Math.abs(v)) + (Math.abs(v) >= 2 ? " pts" : " pt");
  const fpct = v => nf0.format(v) + " %";
  const quand = e => maj(delai(e.jours, true));

  /** Les 4 cartes du bandeau (UI.carte échappe chaque champ). */
  function cartes(ind, U, periode) {
    const n = ind.net, pr = ind.pratiques, al = ind.allocation, ec = ind.echeance, v = n.variation;
    const tend = v == null || n.vide ? null : { sens: Math.round(v) > 0 ? "hausse" : Math.round(v) < 0 ? "baisse" : "stable", texte: eurS(v) };
    return [
      { id: "net", titre: "Patrimoine net", valeur: n.vide ? "—" : eur(n.valeur), tendance: tend,
        sous: n.vide ? "Lancez votre bilan avec Claude" : v == null ? "Première photo cette nuit" : periodeTxt(periode) },
      { id: "pratiques", titre: "Bonnes pratiques", valeur: pr.total == null ? "—" : pr.total + " / 100", badge: pr.total != null && pr.provisoire ? "Provisoire" : null,
        sous: pr.total == null ? "Données à compléter" : pr.aCompleter ? pluriel(pr.aCompleter, "critère") + " à compléter" : "Tous les critères sont notés" },
      { id: "allocation", titre: "Écart au profil de risque", valeur: !al.profil ? "Profil à faire" : al.points == null ? "—" : fpts(al.points),
        sous: !al.profil ? "Répondez au questionnaire" : !al.placements ? "Aucun placement à comparer" : al.points ? "Hors des fourchettes du profil " + al.profil : "Dans les fourchettes du profil " + al.profil },
      { id: "echeance", titre: "Prochaine échéance", valeur: ec.prochaine ? quand(ec.prochaine) : "Aucune",
        sous: ec.prochaine ? extrait(ec.prochaine.titre, 60) + " · " + dateFr(ec.prochaine.date) : "Aucune date à venir" },
    ].map(o => U.carte(o)).join("");
  }

  const ligne = (label, valeur) => '<li><span class="aj-det-l">' + esc(label) + '</span><span class="aj-det-v">' + esc(valeur) + "</span></li>";
  /** Panneau d'une carte : { titre, contenu (HTML échappé : 2 à 4 lignes et une note), lien: { label, href } vers la page complète,
      question } — question préremplie pour « Demander à Claude » (pédagogique : expliquer, pas conseiller). */
  function detail(id, ind, periode) {
    const n = ind.net, pr = ind.pratiques, al = ind.allocation, ec = ind.echeance;
    let titre, lignes = [], note = "", route, label, question;
    if (id === "net") {
      titre = "Patrimoine net"; route = R.placements; label = "Voir les placements";
      question = "Explique-moi la composition de mon patrimoine net dans Boussole et ce qui l'a fait varier récemment.";
      lignes = [["Placements financiers", eur(n.financier)], ["Immobilier", eur(n.immobilier)]];
      if (n.autres) lignes.push(["Autres biens", eur(n.autres)]);
      lignes.push(["Dettes", eur(-n.dettes)]);
      note = n.variation == null ? "La variation apparaîtra après la première photo nocturne du patrimoine."
        : "Variation " + periodeTxt(periode) + " : " + eurS(n.variation) + ". Estimation : placements de chaque photo, immobilier, autres biens et dettes d'aujourd'hui.";
    } else if (id === "pratiques") {
      titre = "Bonnes pratiques"; route = R.sante; label = "Voir le détail des critères";
      question = "Explique-moi ma note de bonnes pratiques dans Boussole, famille par famille, et ce que mesure chaque critère.";
      lignes = pr.familles.slice(0, 4).map(f => [f.titre, f.total == null ? "à compléter" : f.total + " / 100"]);
      if (lignes.length < 2) lignes = [["Note globale", pr.total == null ? "—" : pr.total + " / 100"], ["Critères à compléter", String(pr.aCompleter)]];
      note = pr.total == null ? "Complétez vos données, seul ou avec Claude, pour obtenir une note."
        : pr.provisoire ? "Note provisoire : moins de la moitié des critères peuvent être notés avec vos données actuelles."
        : "Une note pédagogique, pas un conseil : chaque critère explique sa règle et sa source.";
    } else if (id === "allocation") {
      titre = "Écart au profil de risque"; route = R.risque; label = al.profil ? "Voir le profil de risque" : "Faire le questionnaire";
      question = al.profil ? "Explique-moi l'écart entre ma répartition réelle et les fourchettes de mon profil de risque dans Boussole."
        : "Aide-moi à remplir le questionnaire de profil de risque de Boussole, question par question.";
      if (!al.profil) {
        lignes = [["Profil de risque", "non renseigné"], ["Questionnaire", "une dizaine de questions"]];
        note = "Le questionnaire situe le risque que vous acceptez ; Boussole compare ensuite votre répartition réelle aux fourchettes de ce profil.";
      } else {
        lignes = [["Profil", al.profil], ["Points hors fourchette", al.points == null ? "—" : fpts(al.points)]];
        al.hors.slice(0, 2).forEach(e => lignes.push([e.label, fpct(e.reel) + " (fourchette " + e.min + " à " + e.max + " %)"]));
        note = al.points ? "Chaque point mesure l'écart d'une classe d'actifs à la borne la plus proche de sa fourchette." : "Chaque classe d'actifs est dans la fourchette de votre profil.";
      }
    } else {
      titre = "Prochaines échéances"; route = R.budget; label = "Voir budget et objectifs";
      question = "Passons en revue mes prochaines échéances et mes objectifs datés dans Boussole.";
      lignes = ec.liste.slice(0, 4).map(e => [extrait(e.titre, 70), dateFr(e.date) + " · " + quand(e).toLowerCase()]);
      if (!lignes.length) lignes.push(["Échéances à venir", "aucune"]);
      if (lignes.length < 2) lignes.push(["Objectifs datés", "dans Budget et objectifs"]);
      note = "Dates tirées de vos objectifs, des échéances enregistrées et des points que l'agent doit reprendre avec vous.";
    }
    return { titre, contenu: '<ul class="aj-det">' + lignes.slice(0, 4).map(l => ligne(l[0], l[1])).join("") + "</ul>" +
      '<p class="aj-det-note">' + esc(note) + "</p>", lien: { label, href: "#" + route }, question };
  }

  const STATUT_TXT = { a_relire: "À relire", actif: "En cours", realise: "Réalisée", abandonne: "Abandonnée", archive: "Archivée" };
  /** Panneau d'un repère de la frise (r = élément de reperesJournal) : { titre, contenu (HTML échappé), lien vers Agent › Journal }. */
  function repereDetail(r) {
    const x = r || {};
    return { titre: plat(x.titre) || "Décision",
      contenu: '<ul class="aj-det">' + ligne("Décision du", dateFr(x.date) || "—") + ligne("Statut", STATUT_TXT[x.statut] || plat(x.statut) || "—") + "</ul>" +
        '<p class="aj-det-note">' + esc(x.synthese) + "</p>",
      lien: { label: "Ouvrir le journal", href: "#" + R.journal } };
  }

  const ICO = {
    journal: '<path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z"/><path d="M6 3.5v17M9.5 8h5.5M9.5 11.5h5.5"/>',
    proposition: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/>',
    alerte: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    a_suivre: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/><path d="M12 8v4.5l3 1.8"/>',
    echeance: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    cours: '<path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/>',
  };
  const TYPE_TXT = { proposition: "Proposition de Claude", journal: "Journal de l'agent", alerte: "Alerte", a_suivre: "Point à reprendre", echeance: "Échéance", cours: "Mise à jour des cours" };
  const URG_TXT = { 1: "urgent", 2: "à traiter", 3: "à surveiller" };
  const ico = t => '<svg class="aj-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICO[t] + "</svg>";

  function actionHtml(a) {
    if (!a || !a.label) return "";
    if (a.url) return httpsOk(a.url) ? '<a class="aj-act" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">' + esc(a.label) + '<span class="ui-sr"> (nouvel onglet)</span></a>' : "";
    return a.route ? '<a class="aj-act" href="#' + esc(a.route) + '" data-goto="' + esc(a.route) + '">' + esc(a.label) + "</a>" : "";
  }
  function itemHtml(x) {
    const t = TYPE_TXT[x.type] ? x.type : "alerte", u = URG_TXT[x.urgence] ? +x.urgence : 3;
    return '<li class="aj-it u' + u + '" data-type="' + t + '">' +
      '<span class="aj-pic">' + ico(t) + "</span>" +
      '<div class="aj-txt"><p class="aj-t"><span class="ui-sr">' + esc(TYPE_TXT[t] + ", " + URG_TXT[u] + " : ") + "</span>" + esc(x.titre) + "</p>" +
      (x.contexte ? '<p class="aj-c">' + esc(x.contexte) + "</p>" : "") + "</div>" +
      actionHtml(x.action) + "</li>";
  }
  /** Liste de la boîte de réception (<ul>/<li>) : 5 éléments puis « Voir plus » (UI.voirPlus) ; vide : « Rien à traiter. » et « Faire le point avec Claude ». */
  function boiteHtml(items, U) {
    if (!items || !items.length) return '<div class="aj-vide"><p class="aj-vide-t">Rien à traiter.</p>' +
      '<p class="aj-vide-x">Aucune proposition, alerte ni échéance proche. Pour un regard d\'ensemble, faites le point avec votre assistant.</p>' +
      U.demanderAClaude("Fais le point sur ma situation avec Boussole", "Faire le point avec Claude") + "</div>";
    return U.voirPlus(items, 5, itemHtml, "Voir plus", "ul");
  }

  /** Courbe SVG du patrimoine net agrégé (f = frise()) ; texte d'état vide si moins de deux points. */
  function friseSvg(f, o) {
    const opt = o || {}, rows = (f && f.points) || [];
    if (rows.length < 2) return '<p class="aj-frise-vide">' + (f && f.historique
      ? "Pas assez de points sur cette période : élargissez-la ou choisissez un pas plus fin."
      : "Pas encore d'historique : Boussole prend chaque nuit une photo de votre patrimoine, la courbe se dessine au fil des jours.") + "</p>";
    const W = Math.max(300, Math.min(1000, Math.round(+opt.largeur) || 720)), H = W < 480 ? 200 : 220, L = 62, Rt = 14, T = 14, B = 28;
    const ts = rows.map(p => utc(p.date)), x0 = ts[0], x1 = ts[ts.length - 1];
    const vals = rows.map(p => p.valeur);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const marge = (hi - lo) * 0.2 || Math.abs(hi) * 0.05 || 1000;
    lo -= marge; hi += marge;
    const X = t => L + (x1 === x0 ? 0 : (t - x0) / (x1 - x0)) * (W - L - Rt), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let g = "";
    // graduations : une décimale en k€ quand l'écart est faible, pour ne pas répéter la même étiquette
    const fin1 = (hi - lo) / 3 < 2000, axe = v => (fin1 && Math.abs(v) >= 1e3 && Math.abs(v) < 1e6 ? nf1.format(v / 1e3) + " k€" : kEur(v));
    for (let k = 0; k <= 3; k++) {
      const v = lo + (hi - lo) * k / 3, y = Y(v);
      g += '<line class="aj-grid" x1="' + L + '" x2="' + (W - Rt) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="aj-ax" x="' + (L - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + esc(axe(v)) + "</text>";
    }
    // libellés de période : le premier calé à gauche, le dernier à droite, les autres centrés s'ils ne se chevauchent pas
    let droite = -Infinity;
    const xFin = X(x1);
    rows.forEach((p, i) => {
      const x = X(ts[i]), last = i === rows.length - 1, w = 64;
      const a = i === 0 ? x : last ? x - w : x - w / 2, b = i === 0 ? x + w : last ? x : x + w / 2;
      if (!last && (a < droite + 6 || b > xFin - w - 6)) return;
      droite = b;
      g += '<text class="aj-ax" x="' + x.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="' + (i === 0 ? "start" : last ? "end" : "middle") + '">' + esc(p.label) + "</text>";
    });
    const d = rows.map((p, i) => (i ? "L" : "M") + X(ts[i]).toFixed(1) + "," + Y(p.valeur).toFixed(1)).join("");
    // Repères des décisions du journal dans la période dessinée : trait vertical, titre au survol, focalisables (clic / Entrée → panneau).
    const reps = (Array.isArray(f.reperes) ? f.reperes : []).filter(r => r && isoOk(r.date) && utc(r.date) >= x0 && utc(r.date) <= x1);
    const repSvg = reps.map(r => {
      const x = X(utc(r.date)).toFixed(1), nom = "Décision du " + dateFr(r.date) + " : " + plat(r.titre);
      return '<g class="aj-rep" data-journal="' + esc(r.id) + '" tabindex="0" role="button" aria-label="' + esc(nom) + '" style="cursor:pointer">' +
        "<title>" + esc(nom) + "</title>" +
        '<line x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (H - B) + '" style="stroke:transparent;stroke-width:14"/>' +
        '<line x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (H - B) + '" style="stroke:var(--muted);stroke-width:1.3;stroke-dasharray:3 3"/>' +
        '<path d="M' + x + "," + (T - 6) + "l5,6l-5,6l-5,-6z" + '" style="fill:var(--accent);stroke:var(--surface);stroke-width:1.5"/></g>';
    }).join("");
    const aire = d + "L" + xFin.toFixed(1) + "," + (H - B) + "L" + X(x0).toFixed(1) + "," + (H - B) + "Z";
    const pts = rows.map((p, i) => { const last = i === rows.length - 1;
      return '<circle class="aj-pt' + (last ? " fin" : "") + '" cx="' + X(ts[i]).toFixed(1) + '" cy="' + Y(p.valeur).toFixed(1) + '" r="' + (last ? 4.5 : 3) + '">' +
        "<title>" + esc(p.label + " : " + eur(p.valeur) + (p.variation != null ? " (" + eurS(p.variation) + ")" : "")) + "</title></circle>"; }).join("");
    const fin = rows[rows.length - 1], r = f.resume || {};
    const lbl = "Patrimoine net estimé " + (opt.scopeLabel || "") + " : " + eur(fin.valeur) + (r.variation != null ? ", " + eurS(r.variation) + " sur la période" : "") + ". " +
      rows.map(p => p.label + " " + eur(p.valeur)).join(", ");
    const lblRep = reps.length ? ". " + pluriel(reps.length, "décision") + " du journal sur la période (repères verticaux)." : "";
    // Avec des repères interactifs, le graphique est un groupe (role="img" rendrait ses enfants inaccessibles).
    return '<svg class="aj-svg" viewBox="0 0 ' + W + " " + H + '" role="' + (reps.length ? "group" : "img") + '" aria-label="' + esc(plat(lbl + lblRep)) + '">' + g +
      '<path class="aj-aire" d="' + aire + '"/><path class="aj-ligne" d="' + d + '"/>' + repSvg + pts + "</svg>";
  }

  const H = { boite, echeances, indicateurs, frise, reperesJournal, urlClaude, cartes, detail, repereDetail, boiteHtml, friseSvg, jour, delai, premiereDate };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =============================================================== vue =============================================================== */
  const CLE = "aujourdhui-periode";
  /* items (boîte) est calculé à chaque émission du store : headline() en dépend pour la pastille. ind (indicateurs et frise)
     ne l'est qu'au rendu, quand la vue est visible. sigX : dernier HTML écrit ; rien n'est réécrit (ni le focus perdu,
     ni un « Voir plus » replié) quand il n'a pas changé. */
  let S = null, root = null, dirty = true, items = [], ind = null, largeur = 0, sigBoite = "", sigCartes = "", sigFrise = "", ctlPeriode = null; // largeur : celle du dernier dessin de la frise
  let periode = { id: "1a", granularite: "mois" };
  try { const p = JSON.parse(localStorage.getItem(CLE) || "null"); if (p && typeof p.id === "string") periode = { id: p.id, granularite: String(p.granularite || "mois"), du: p.du, au: p.au }; } catch (e) {}
  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const scopeLabel = () => {
    if (!S || !S.scope || S.scope === "foyer") return "du foyer";
    const p = (S.people || []).find(x => x.id === S.scope), C = window.Calc;
    return C && C.deNom ? C.deNom(p && p.nom, S.scope === "p2" ? 2 : 1) : "";
  };

  function render() {
    const u = U();
    if (!root || !S || !u) return;
    ind = indicateurs(S, jour(), periode);
    renderCartes();
    // Même contenu : on ne réécrit pas la liste (une émission du store ne replie pas un « Voir plus » déplié).
    const sig = JSON.stringify(items);
    if (sig !== sigBoite) { sigBoite = sig; $("ajBoite").innerHTML = boiteHtml(items, u); }
    // Nombre d'éléments pour les lecteurs d'écran seulement (règle 9 : les compteurs visibles sont dans la navigation).
    const n = items.length ? pluriel(items.length, "élément") + " à traiter" : "";
    if ($("ajBoiteN").textContent !== n) $("ajBoiteN").textContent = n;
    renderFrise();
  }
  function renderCartes() {
    const h = cartes(ind, U(), periode);
    if (h !== sigCartes) { sigCartes = h; $("ajCartes").innerHTML = h; }
  }
  function renderFrise() {
    const f = ind.frise, r = f.resume || {};
    const el = $("ajFrise");
    largeur = el.clientWidth || 0;
    const h = friseSvg(f, { scopeLabel: scopeLabel(), largeur });
    if (h !== sigFrise) { sigFrise = h; el.innerHTML = h; }
    const t = f.points.length > 1 && r.variation != null
      ? eurS(r.variation) + " " + periodeTxt(periode) + (r.variationPct != null ? " (" + (r.variationPct < 0 ? "−" : "+") + nf1.format(Math.abs(r.variationPct)) + " %)" : "") : "";
    if ($("ajFriseResume").textContent !== t) $("ajFriseResume").textContent = t;
  }
  /* Période ou granularité changée (UI.periode) : la frise et la variation de la carte « Patrimoine net » suivent. */
  function surPeriode(o) {
    const x = o && typeof o === "object" ? o : { periode: o };
    periode = { id: String(x.periode || x.id || periode.id), granularite: String(x.granularite || periode.granularite || "mois"), du: x.du || undefined, au: x.au || undefined };
    try { localStorage.setItem(CLE, JSON.stringify(periode)); } catch (e) {}
    if (!S || !U() || !root) return;
    ind = indicateurs(S, jour(), periode);
    renderCartes();
    renderFrise();
  }
  /* Carte → panneau de détail (le lien interne du pied ferme le panneau puis la coque suit le hash). Le focus revient à la carte,
     ou à la carte du même id si un rendu l'a remplacée entre-temps. */
  function ouvrirCarte(id, el) {
    const u = U(); if (!u || !u.panneau || !ind) return;
    const d = detail(id, ind, periode);
    u.panneau.ouvrir({ titre: d.titre, contenu: d.contenu, lien: d.lien, pied: u.demanderAClaude(d.question), retour: el,
      surFermeture: () => { if (el && !el.isConnected) { const c = root.querySelector('[data-ui-carte="' + id + '"]'); if (c) c.focus(); } } });
  }

  /* Repère de décision de la frise → panneau (synthèse, date, statut, lien vers Agent › Journal) ; focus rendu au repère, ou au repère
     du même id si la frise a été redessinée entre-temps. */
  function ouvrirRepere(el) {
    const u = U(); if (!u || !u.panneau || !ind) return;
    const id = el.getAttribute("data-journal"), r = (ind.frise.reperes || []).find(x => x.id === id);
    if (!r) return;
    const d = repereDetail(r);
    u.panneau.ouvrir({ titre: d.titre, contenu: d.contenu, lien: d.lien, retour: el,
      surFermeture: () => { if (!el.isConnected) { const c = Array.from(root.querySelectorAll("[data-journal]")).find(x => x.getAttribute("data-journal") === id); if (c) c.focus(); } } });
  }

  function mount(r) {
    root = r;
    const u = U();
    const fr = $("ajFrise");
    fr.addEventListener("click", e => { const el = e.target && e.target.closest ? e.target.closest("[data-journal]") : null; if (el) ouvrirRepere(el); });
    fr.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = e.target && e.target.closest ? e.target.closest("[data-journal]") : null;
      if (el) { e.preventDefault(); ouvrirRepere(el); }
    });
    if (u && u.periode) ctlPeriode = u.periode($("ajPeriode"), { periode: periode.id, granularite: periode.granularite, du: periode.du, au: periode.au,
      premiere: S ? premiereDate(S.snapshots) : undefined, surChange: surPeriode });
    $("ajClaude").innerHTML = u && u.demanderAClaude
      ? u.demanderAClaude("Explique-moi simplement l'évolution de mon patrimoine net dans Boussole sur la dernière année : qu'est-ce qui l'a fait bouger ?", "Commenter avec Claude") : "";
    if (u && u.brancher) u.brancher(root, { surCarte: ouvrirCarte }); // cartes et « Voir plus » de la boîte de réception
    /* La frise est dessinée à la largeur réelle (textes lisibles sur mobile) : redessin quand la largeur change nettement. */
    if (typeof ResizeObserver === "function") new ResizeObserver(() => {
      const w = $("ajFrise").clientWidth;
      if (ind && w && Math.abs(w - largeur) > 24) renderFrise();
    }).observe($("ajFrise"));
  }
  function update(snap, visible) {
    S = snap;
    items = boite(S, jour());
    if (ctlPeriode && typeof ctlPeriode.premiere === "function") ctlPeriode.premiere(S ? premiereDate(S.snapshots) : undefined); // « Tout » part de la première photo
    dirty = true;
    if (visible) { render(); dirty = false; }
  }
  function show() { if (dirty) { render(); dirty = false; } }
  /* Pastille de la navigation : nombre d'éléments de la boîte de réception (ne dépend que de `items`) ; vide quand il n'y en a pas. */
  function headline() { return items.length ? String(items.length) : ""; }

  const api = { mount, update, show, headline };
  const reg = () => App.register("aujourdhui", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
