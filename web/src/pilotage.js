/* Patrimoine › Placements (module « pilotage ») — « Qu'est-ce que j'ai en placements ? ». Lecture seule : le board lit, l'agent écrit
   (docs/superpowers/specs/2026-10-11-saisie-par-agent.md). Toute saisie passe par Claude : boutons « Compléter avec Claude »,
   « Corriger avec Claude », « Enregistrer un mouvement avec Claude » (UI.demanderAClaude + ClaudePrompts.phrase, sections placements
   et mouvement, avec la ligne concernée en contexte). Aucune écriture au store depuis ce module.
   - En-tête : total financier du périmètre, variation sur la période (UI.periode, défaut 1 an ; granularité automatique tant que
     l'utilisateur ne l'a pas choisie lui-même), nombre de lignes, plus-values latentes, épargne de précaution (cible réglée dans
     Compte › Règles) ; courbe d'évolution (photos nocturnes + point du jour).
   - Bascule de regroupement (UI.bascule) : Par enveloppe · Par poche · Par titulaire · Par disponibilité (liquidité, Calc.liquidite) ;
     une carte par groupe (nom, montant, part, plus-value latente) qui se déplie en lignes compactes (5 puis « Voir plus ») ;
     une ligne ouvre UI.panneau (lecture) : cours et date, quantité, PRU, plus-value latente, poids, frais / zone / devise (avec
     source), statut, note, liens Claude. Le panneau se met à jour quand le store émet et se ferme si la ligne disparaît.
   - Accordéons fermés en bas : Allocation par poche, Ordres à passer, Versements programmés, Hypothèses à confirmer, Journal des
     mouvements (listes en 5 puis « Voir plus », dans le périmètre S.scope).
   Le score de santé est dans Pilotage › Santé, les alertes dans Aujourd'hui, les règles et la cible du matelas dans Compte › Règles.
   Fonctions pures exportées pour les tests (module.exports) : grouper, totaux, matelas, evolution, etatDonnee, detailLigne, hypotheses,
   versements, ordres, journalMouvements, allocation, phraseClaude, et les rendus HTML groupesHtml, detailHtml, courbeSvg,
   allocationHtml, ordresHtml, versementsHtml, hypothesesHtml, journalHtml (UI reçu en paramètre quand il en faut ; aucune ne touche
   au DOM). Dépendances injectées (deps) : { Calc, Periodes, ClaudePrompts }, window.* par défaut. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : glob(k));

  /* ---------- dates (AAAA-MM-JJ) ---------- */
  const pad = n => String(n).padStart(2, "0");
  function jour(d) {
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const x = d == null ? new Date() : new Date(d);
    if (!isFinite(x)) return "";
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }
  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const jj = v => (v ? String(v).slice(0, 10) : "");
  const utc = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  const dateFr = s => { const d = jj(s); return isoOk(d) ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : ""; };

  /* ---------- nombres et textes ---------- */
  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nfq = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });
  const fini = v => v != null && v !== "" && isFinite(+v);
  const eur = v => (!fini(v) ? "—" : (Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €");
  const eurS = v => (!fini(v) ? "—" : (Math.round(v) > 0 ? "+" : Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €");
  const eur2 = v => (!fini(v) ? "—" : (v < 0 ? "−" : "") + nf2.format(Math.abs(v)) + " €");
  const pct = v => (!fini(v) ? "—" : nf1.format(v) + " %");
  const pctS = v => (!fini(v) ? "—" : (v > 0.05 ? "+" : v < -0.05 ? "−" : "") + nf1.format(Math.abs(v)) + " %");
  const kEur = v => (Math.abs(v) >= 1e6 ? nf1.format(v / 1e6) + " M€" : Math.abs(v) >= 1e3 ? nf0.format(v / 1e3) + " k€" : nf0.format(v) + " €");
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  const num = v => (v == null || String(v).trim() === "" || !isFinite(+String(v).replace(",", ".")) ? null : +String(v).replace(",", "."));

  /* ---------- positions ---------- */
  const DEFAULT_NOMS = { p1: "Moi", p2: "Conjoint(e)" };
  const scopeDe = S => (S && S.scope) || "foyer";
  const nomDe = (S, id) => { const p = ((S && S.people) || []).find(x => x.id === id); return (p && p.nom) || DEFAULT_NOMS[id] || plat(id) || "—"; };
  /** Plus-value latente d'une ligne cotée avec prix de revient (null sinon). */
  const latente = p => (p && p.mode === "market" && p.pru && p.qty && p.price ? p.qty * (p.price - p.pru) : null);
  /** Lignes du périmètre, hors lignes clôturées (« à recevoir » comprises, non comptées). */
  function visibles(S, C) { const sc = scopeDe(S); return ((S && S.positions) || []).filter(p => p && C.inScope(p, sc) && p.status !== "clôturé"); }

  /* =============================================================== regroupements =============================================================== */
  const MODES = [
    { id: "enveloppe", label: "Par enveloppe", aria: "Regrouper par enveloppe" }, { id: "poche", label: "Par poche", aria: "Regrouper par poche" },
    { id: "titulaire", label: "Par titulaire", aria: "Regrouper par titulaire" }, { id: "disponibilite", label: "Par disponibilité", aria: "Regrouper par disponibilité" },
  ];
  const ORDRE_LIQ = ["immediate", "jours", "semaines", "bloque"];
  const NOTE_MODE = {
    enveloppe: "Une carte par compte ou contrat.",
    poche: "Les poches regroupent tes lignes par usage ou par thème ; l'écart aux cibles est dans « Allocation par poche ».",
    titulaire: "Une carte par personne du foyer.",
    disponibilite: "Délai pour récupérer l'argent placé, estimé d'après l'enveloppe (livrets : tout de suite ; assurance-vie : quelques semaines ; PER, SCPI : bloqué). Vue limitée aux placements financiers : ton immobilier en direct est dans Immobilier et crédits.",
  };
  /** Cibles d'allocation par poche de la personne affichée (config.targets[p]) ; null pour le foyer. */
  function ciblesPoche(S) { const t = (S && S.config && S.config.targets) || {}; const sc = scopeDe(S); return sc === "foyer" ? null : t[sc] || null; }

  /** Groupes de lignes selon le mode (enveloppe | poche | titulaire | disponibilite), dans le périmètre S.scope, hors clôturées :
      [{ cle, label, montant (lignes comptées), part (% du total compté), plusValue (null si aucune ligne cotée avec PRU),
         aRecevoir, nb, cible (% de la poche pour une personne, sinon null), lignes (valeur décroissante, « à recevoir » à la fin) }].
      Tri par montant décroissant ; par disponibilité, du plus disponible au plus bloqué. */
  function grouper(positions, mode, S, deps) {
    const C = dep(deps, "Calc"), s = S || {}, sc = scopeDe(s);
    const m = MODES.some(x => x.id === mode) ? mode : "enveloppe";
    const ps = (Array.isArray(positions) ? positions : []).filter(p => p && C.inScope(p, sc) && p.status !== "clôturé");
    const total = sum(ps.filter(C.counted), C.val);
    const cle = { enveloppe: p => plat(p.envelope) || "Sans enveloppe", poche: p => plat(p.bloc) || "Sans poche", titulaire: p => p.owner || "p1",
      disponibilite: p => C.liquidite(p.envelope) }[m];
    const lab = { enveloppe: k => k, poche: k => k, titulaire: k => nomDe(s, k), disponibilite: k => (C.LIQUIDITE_LABELS && C.LIQUIDITE_LABELS[k]) || k }[m];
    const tg = m === "poche" ? ciblesPoche(s) : null;
    const map = new Map();
    ps.forEach(p => { const k = String(cle(p)); if (!map.has(k)) map.set(k, []); map.get(k).push(p); });
    const ordreLigne = (a, b) => (C.counted(b) - C.counted(a)) || (C.val(b) - C.val(a)) || String(a.name || "").localeCompare(String(b.name || ""), "fr");
    const gs = [...map.entries()].map(([k, ls]) => {
      const lc = ls.filter(C.counted), lat = lc.map(latente).filter(v => v != null), montant = sum(lc, C.val);
      return { cle: k, label: lab(k), montant, part: total ? montant / total * 100 : 0, plusValue: lat.length ? sum(lat, v => v) : null,
        aRecevoir: sum(ls.filter(p => p.status === "à recevoir"), C.val), nb: ls.length, cible: tg && fini(tg[k]) ? +tg[k] : null,
        lignes: ls.slice().sort(ordreLigne) };
    });
    if (m === "disponibilite") return gs.sort((a, b) => ORDRE_LIQ.indexOf(a.cle) - ORDRE_LIQ.indexOf(b.cle));
    return gs.sort((a, b) => b.montant - a.montant || a.label.localeCompare(b.label, "fr"));
  }

  /** Chiffres de l'en-tête : { total, nb (lignes comptées), lignes (visibles), aRecevoir: [{ nom, montant }], plusValue, cout }. */
  function totaux(S, deps) {
    const C = dep(deps, "Calc"), ps = visibles(S, C), live = ps.filter(C.counted);
    let pl = 0, cout = 0;
    live.forEach(p => { const g = latente(p); if (g != null) { pl += g; cout += p.qty * p.pru; } });
    return { total: sum(live, C.val), nb: live.length, lignes: ps.length,
      aRecevoir: ps.filter(p => p.status === "à recevoir").map(p => ({ nom: plat(p.name), montant: C.val(p) })), plusValue: pl, cout };
  }

  /** Épargne de précaution (poche « Épargne » du périmètre) et sa cible (config.cushion, portée par le foyer) :
      { montant, aRecevoir, cible: texte }. */
  function matelas(S, deps) {
    const C = dep(deps, "Calc"), s = S || {}, sc = scopeDe(s);
    const ps = (s.positions || []).filter(p => p && p.bloc === "Épargne" && C.inScope(p, sc));
    const m = C.matelas(s.config);
    const cible = !m || !m.min ? "pas de cible définie" : (sc === "foyer" ? "cible " : "cible du foyer ") +
      (m.max != null && m.max > 0 ? eur(m.min) + " à " + eur(m.max) : eur(m.min) + (m.mode === "months" ? " (" + m.months + " mois)" : ""));
    return { montant: sum(ps.filter(C.counted), C.val), aRecevoir: sum(ps.filter(p => p.status === "à recevoir"), C.val), cible };
  }

  /* =============================================================== évolution =============================================================== */
  const PERIODES_OK = ["1m", "3m", "1a", "tout"];
  const PERIODE_TXT = { "1m": "sur 1 mois", "3m": "sur 3 mois", "1a": "sur 1 an", tout: "depuis le début du suivi" };
  const estPerso = p => !!p && p.periode === "perso" && isoOk(p.du) && isoOk(p.au);
  const periodeTxt = p => (estPerso(p) ? "du " + dateFr(p.du) + " au " + dateFr(p.au) : PERIODE_TXT[p && p.periode] || PERIODE_TXT["1a"]);

  /** Courbe des placements du périmètre : photos nocturnes (S.snapshots[scope]) + point du jour (valeur en direct), agrégées sur la
      période par Periodes. per = { periode: 1m|3m|1a|tout|perso, du?, au?, granularite? } (forme de UI.periode).
      → { serie: [{ date, valeur, label, live }], resume: { variation, variationPct } | null, bornes, granularite, historique, reconstitue } */
  function evolution(S, today, per, deps) {
    const Pe = dep(deps, "Periodes"), s = S || {}, sc = scopeDe(s), t = jour(today), p = per || {};
    const snaps = (s.snapshots || []).filter(x => x && fini(x[sc]) && isoOk(jj(x.date)))
      .map(x => ({ date: jj(x.date), v: +x[sc], src: x.source })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const pts = snaps.slice();
    const avecDirect = !pts.length || pts[pts.length - 1].date < t;
    if (avecDirect) pts.push({ date: t, v: totaux(s, deps).total, live: true });
    const base = { historique: snaps.length > 0, reconstitue: snaps.some(x => x.src === "relevés") };
    if (!Pe || typeof Pe.agreger !== "function")
      return Object.assign(base, { serie: pts.map(x => ({ date: x.date, valeur: x.v, label: dateFr(x.date), live: !!x.live })), resume: null, bornes: null, granularite: null });
    const id = estPerso(p) ? { du: p.du, au: p.au } : PERIODES_OK.includes(p.periode) ? p.periode : "1a";
    const b = Pe.bornes(id, t, pts[0].date);
    const g = p.granularite && p.granularite !== "auto" && (Pe.GRANULARITES || []).some(x => x.id === p.granularite) ? p.granularite : Pe.auto(b);
    const ag = Pe.agreger(pts, b, g, x => x.v);
    const serie = ag.map(a => ({ date: a.date, valeur: a.valeur, label: a.label, live: false }));
    if (avecDirect && serie.length && serie[serie.length - 1].date === t) serie[serie.length - 1].live = true; // la valeur en direct reste le dernier point
    const r = ag.length ? Pe.resume(ag, pts, b, x => x.v) : null;
    return Object.assign(base, { serie, resume: r && fini(r.variation) ? { variation: r.variation, variationPct: fini(r.variationPct) ? r.variationPct : null } : null, bornes: b, granularite: g });
  }

  /** Courbe SVG (ev = evolution()) ; texte d'état vide sous deux points. */
  function courbeSvg(ev, o) {
    const opt = o || {}, rows = (ev && ev.serie) || [];
    if (rows.length < 2) return '<p class="pl-vide-courbe">' + (ev && ev.historique
      ? "Pas assez de points sur cette période pour tracer une courbe : élargis la période ou choisis un pas plus fin."
      : "Pas encore d'historique : chaque nuit, Boussole prend une photo de tes placements ; la courbe se dessine au fil des jours.") + "</p>";
    const W = Math.max(300, Math.min(1000, Math.round(+opt.largeur) || 720)), H = W < 480 ? 190 : 220, L = 60, R = 14, T = 16, B = 28;
    const ts = rows.map(p => utc(p.date)), x0 = ts[0], x1 = ts[ts.length - 1];
    let lo = Math.min(...rows.map(p => p.valeur)), hi = Math.max(...rows.map(p => p.valeur));
    const marge = (hi - lo) * 0.2 || Math.abs(hi) * 0.05 || 1000;
    lo = Math.max(0, lo - marge); hi += marge;
    const X = x => L + (x1 === x0 ? 0 : (x - x0) / (x1 - x0)) * (W - L - R), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const fin1 = (hi - lo) / 3 < 2000, axe = v => (fin1 && Math.abs(v) >= 1e3 && Math.abs(v) < 1e6 ? nf1.format(v / 1e3) + " k€" : kEur(v));
    let g = "";
    for (let k = 0; k <= 3; k++) {
      const v = lo + (hi - lo) * k / 3, y = Y(v).toFixed(1);
      g += '<line class="pl-grille" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text class="pl-axe" x="' + (L - 8) + '" y="' + (+y + 4).toFixed(1) + '" text-anchor="end">' + esc(axe(v)) + "</text>";
    }
    // Largeur estimée d'une étiquette (police chiffrée de 11 px) : les étiquettes longues (« sem. du 28 sept. ») ne se chevauchent pas.
    const larg = s => Math.max(40, String(s || "").length * 6.6);
    let droite = -Infinity; const xFin = X(x1), wFin = larg(rows[rows.length - 1].label);
    rows.forEach((p, i) => {
      const x = X(ts[i]), last = i === rows.length - 1, w = larg(p.label);
      const a = i === 0 ? x : last ? x - w : x - w / 2, b = i === 0 ? x + w : last ? x : x + w / 2;
      if (!last && (a < droite + 6 || b > xFin - wFin - 6)) return;
      droite = b;
      g += '<text class="pl-axe" x="' + x.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="' + (i === 0 ? "start" : last ? "end" : "middle") + '">' + esc(p.label) + "</text>";
    });
    const fin = rows[rows.length - 1], direct = !!fin.live, reels = direct ? rows.slice(0, -1) : rows;
    const d = reels.map((p, i) => (i ? "L" : "M") + X(ts[i]).toFixed(1) + "," + Y(p.valeur).toFixed(1)).join("");
    const aire = reels.length > 1 ? d + "L" + X(ts[reels.length - 1]).toFixed(1) + "," + (H - B) + "L" + X(x0).toFixed(1) + "," + (H - B) + "Z" : "";
    const tiret = direct && reels.length ? '<line class="pl-direct" x1="' + X(ts[reels.length - 1]).toFixed(1) + '" y1="' + Y(reels[reels.length - 1].valeur).toFixed(1) +
      '" x2="' + X(x1).toFixed(1) + '" y2="' + Y(fin.valeur).toFixed(1) + '"/>' : "";
    const pts = rows.map((p, i) => { const last = i === rows.length - 1;
      return rows.length > 120 && !last ? "" : '<circle class="pl-pt' + (last ? " fin" : "") + '" cx="' + X(ts[i]).toFixed(1) + '" cy="' + Y(p.valeur).toFixed(1) + '" r="' + (last ? 4.5 : 2.6) + '">' +
        "<title>" + esc(p.label + " : " + eur(p.valeur) + (p.live ? " (en direct)" : "")) + "</title></circle>"; }).join("");
    const r = (ev && ev.resume) || {};
    const lbl = "Évolution des placements " + plat(opt.scopeLabel || "") + " : " + eur(fin.valeur) + (fini(r.variation) ? ", " + eurS(r.variation) + " sur la période" : "") + ". " +
      rows.map(p => p.label + " " + eur(p.valeur)).join(", ");
    return '<svg class="pl-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(plat(lbl)) + '">' + g +
      (aire ? '<path class="pl-aire" d="' + aire + '"/>' : "") + (d ? '<path class="pl-ligne-c" d="' + d + '"/>' : "") + tiret + pts + "</svg>";
  }

  /* =============================================================== détail d'une ligne =============================================================== */
  /** Pastilles de fraîcheur de la donnée : [{ texte, ton: neutre|bon|attention|info }]. */
  function etatDonnee(p, today) {
    const t = jour(today), out = [];
    if (!p) return out;
    if (p.status === "à recevoir") out.push({ texte: "à recevoir", ton: "neutre" });
    else if (p.mode !== "market") out.push({ texte: "manuel" + (dateFr(p.valueDate) ? " · " + dateFr(p.valueDate) : ""), ton: "neutre" });
    else if (!isoOk(jj(p.priceDate))) out.push({ texte: "cours à récupérer", ton: "attention" });
    else out.push({ texte: "cours " + dateFr(p.priceDate), ton: joursEntre(jj(p.priceDate), t) <= 4 ? "bon" : "attention" });
    if (p.qtyEstimated) out.push({ texte: "qté estimée", ton: "attention" });
    if (p.hypothesis) out.push({ texte: "hypothèse", ton: "info" });
    return out;
  }
  const STATUT_TXT = { actif: "Actif", "à recevoir": "À recevoir (non compté)", "clôturé": "Clôturé" };

  /** Détail d'une ligne pour le panneau : { titre, meta, valeur, poids, faits: [[libellé, valeur]], source, note, hypothese, chips, contexte }. */
  function detailLigne(p, S, today, deps) {
    const C = dep(deps, "Calc"), s = S || {}, x = p || {};
    const total = totaux(s, deps).total, v = C.val(x), compte = C.counted(x);
    const faits = [];
    if (x.mode === "market") {
      faits.push(["Cours", x.price != null ? eur2(x.price) + (dateFr(x.priceDate) ? " · " + dateFr(x.priceDate) : "") : "à récupérer (ce soir par l'agent)"]);
      faits.push(["Quantité", x.qty != null ? nfq.format(x.qty) + (x.qtyEstimated ? " (estimée)" : "") : "—"]);
      faits.push(["Prix de revient unitaire (PRU)", x.pru ? eur2(x.pru) : "non renseigné"]);
      const g = latente(x);
      if (g != null) {
        faits.push(["Montant investi", eur(x.qty * x.pru)]);
        faits.push(["Plus-value latente", eurS(g) + " (" + pctS((x.price / x.pru - 1) * 100) + ")"]);
      } else faits.push(["Plus-value latente", "non calculable sans prix de revient"]);
    } else {
      faits.push(["Valeur", eur(v)]);
      faits.push(["Valeur relevée le", dateFr(x.valueDate) || "—"]);
      faits.push(["Plus-value latente", "non suivie"]);
    }
    faits.push(["Poids dans les placements", compte ? pct(total ? v / total * 100 : 0) : "non compté"]);
    if (x.isin) faits.push(["ISIN", plat(x.isin)]);
    if (fini(x.ter)) faits.push(["Frais courants", nf2.format(+x.ter) + " % par an"]);
    if (x.zone) faits.push(["Zone", plat(x.zone)]);
    if (x.devise) faits.push(["Devise", plat(x.devise)]);
    if (!fini(x.ter) && !x.zone && !x.devise) faits.push(["Frais, zone, devise", "non renseignés"]);
    faits.push(["Statut", STATUT_TXT[x.status] || plat(x.status) || "Actif"]);
    faits.push(["Suivi de la valeur", x.mode === "market" ? "Cours automatique" : "Saisie à la main"]);
    const ouQui = (s.people || []).length > 1 || x.owner === "p2" ? nomDe(s, x.owner) : "";
    return { titre: plat(x.name) || "Ligne sans nom", meta: [plat(x.envelope), plat(x.bloc), ouQui].filter(Boolean).join(" · "),
      valeur: eur(v), poids: compte && total ? v / total * 100 : null, faits,
      source: x.annoteSource ? plat(x.annoteSource) + (dateFr(x.annoteLe) ? ", relevé le " + dateFr(x.annoteLe) : "") : null,
      note: plat(x.note) || null, hypothese: plat(x.hypothesis) || null, chips: etatDonnee(x, today), contexte: contexteLigne(x) };
  }


  /* =============================================================== Claude =============================================================== */
  /** Phrase prête des liens « Compléter / Corriger avec Claude » (ClaudePrompts.phrase), avec un repli si le module n'est pas chargé. */
  function phraseClaude(section, contexte, deps) {
    const P = dep(deps, "ClaudePrompts");
    if (P && typeof P.phrase === "function") return P.phrase(section, contexte);
    return "Boussole : aide-moi à mettre à jour mes placements." + (plat(contexte) ? " Concerne : " + plat(contexte) + "." : "");
  }
  /** Contexte d'une ligne pour l'agent : « la ligne « ETF Monde » (PEA Camille) ». */
  const contexteLigne = p => { const x = p || {}; return "la ligne « " + (plat(x.name) || "sans nom") + " »" + (plat(x.envelope) ? " (" + plat(x.envelope) + ")" : ""); };
  /** Lien Claude rendu par UI (rien si UI absent). */
  const lienClaude = (U, phrase, libelle) => (U && typeof U.demanderAClaude === "function" ? U.demanderAClaude(phrase, libelle) : "");

  /* =============================================================== suivi =============================================================== */
  const inScopeDe = deps => { const C = dep(deps, "Calc"); return C && typeof C.inScope === "function" ? C.inScope : (p, sc) => sc === "foyer" || (!!p && p.owner === sc); };
  /** La ligne d'identifiant id est-elle dans le périmètre ? Au foyer, tout ; pour une personne, ses lignes (une ligne introuvable n'y est pas). */
  function ligneDansScope(S, id, deps) {
    const s = S || {}, sc = scopeDe(s);
    if (sc === "foyer") return true;
    const p = (s.positions || []).find(x => x && x.id === id);
    return !!p && inScopeDe(deps)(p, sc);
  }
  /** Hypothèse de configuration : sans titulaire, elle concerne le foyer (vue Foyer seulement) ; avec, sa personne. */
  const cfgDansScope = (S, h) => scopeDe(S) === "foyer" || (!!h && h.owner === scopeDe(S));

  /** Hypothèses à confirmer du périmètre : lignes, versements programmés et config.hypotheses non confirmées → [{ kind: pos|rec|cfg, id, text }]. */
  function hypotheses(S, deps) {
    const s = S || {}, cfg = s.config || {}, sc = scopeDe(s), dans = inScopeDe(deps), H = [];
    (s.positions || []).forEach(p => { if (p && p.hypothesis && dans(p, sc)) H.push({ kind: "pos", id: p.id, text: plat(p.name) + " : " + plat(p.hypothesis) }); });
    (cfg.recurring || []).forEach((r, i) => { if (r && r.hypothesis && ligneDansScope(s, r.positionId, deps)) H.push({ kind: "rec", id: i, text: plat(r.label) + " : " + plat(r.hypothesis) }); });
    (cfg.hypotheses || []).forEach((h, i) => { if (h && !h.done && cfgDansScope(s, h)) H.push({ kind: "cfg", id: i, text: plat(h.text) }); });
    return H;
  }
  /** Versements programmés du périmètre → [{ label, enveloppe, jour, debut, dernier, montant, etat: hypothese|prevu|actif }]. */
  function versements(S, today, deps) {
    const s = S || {}, t = jour(today);
    return ((s.config && s.config.recurring) || []).filter(r => r && ligneDansScope(s, r.positionId, deps)).map(r => {
      const p = (s.positions || []).find(x => x && x.id === r.positionId), futur = isoOk(jj(r.start)) && jj(r.start) > t;
      return { label: plat(r.label), enveloppe: p ? plat(p.envelope) : "", jour: r.day, debut: futur ? jj(r.start) : null, dernier: plat(r.lastApplied) || null,
        montant: +r.amount || 0, etat: r.hypothesis ? "hypothese" : futur ? "prevu" : "actif" };
    });
  }
  /** Ordres décidés avec l'agent (config.todo, propres au foyer) → [{ text, amount, fait }]. */
  function ordres(S) {
    return ((S && S.config && S.config.todo) || []).filter(o => o && plat(o.text)).map(o => ({ text: plat(o.text), amount: plat(o.amount), fait: !!o.done }));
  }
  const TYPE_TX = { achat: "Achat", vente: "Vente", versement: "Versement", retrait: "Retrait", solde: "Nouveau solde", programme: "Versement programmé", creation: "Nouvelle ligne" };
  /** Journal des mouvements du périmètre, plus récents d'abord (date puis saisie), n au plus (50 par défaut). */
  function journalMouvements(S, n, deps) {
    const s = S || {};
    return (s.tx || []).filter(x => x && ligneDansScope(s, x.positionId, deps)).slice()
      .sort((a, b) => (String(b.date) + String(b.createdAt || "")) > (String(a.date) + String(a.createdAt || "")) ? 1 : -1)
      .slice(0, n == null ? 50 : n).map(x => {
        const p = (s.positions || []).find(y => y && y.id === x.positionId);
        return { type: TYPE_TX[x.type] || plat(x.type), ligne: p ? plat(p.name) : plat(x.positionId), date: jj(x.date), agent: x.source === "agent", note: plat(x.note),
          qty: fini(x.qty) && +x.qty ? +x.qty : null, price: fini(x.price) ? +x.price : null, montant: fini(x.amount) ? +x.amount : null };
      });
  }

  /** Allocation par poche (lignes comptées du périmètre) et cibles de la personne : [{ poche, pct, cible, ecart, ton }], { tolerance, cibles }. */
  function allocation(S, deps) {
    const C = dep(deps, "Calc"), s = S || {}, live = visibles(s, C).filter(C.counted), total = sum(live, C.val) || 1;
    const by = {}; live.forEach(p => { by[p.bloc] = (by[p.bloc] || 0) + C.val(p); });
    const tg = ciblesPoche(s) || {}, tol = (s.config && s.config.targets && fini(s.config.targets.tolerancePts)) ? +s.config.targets.tolerancePts : 3;
    const keys = [...new Set([...Object.keys(by), ...Object.keys(tg).filter(k => k !== "tolerancePts")])].sort((a, b) => (by[b] || 0) - (by[a] || 0));
    const lignes = keys.map(k => {
      const cur = (by[k] || 0) / total * 100, t = fini(tg[k]) ? +tg[k] : null, ecart = t != null ? cur - t : null;
      return { poche: k, montant: by[k] || 0, pct: cur, cible: t, ecart, ton: ecart == null ? null : Math.abs(ecart) > tol * 2 ? "critique" : Math.abs(ecart) > tol ? "attention" : "bon" };
    });
    return { lignes, tolerance: tol, cibles: !!ciblesPoche(s) };
  }

  /** Titres des accordéons du suivi : un mot d'état, pas de compteur (les compteurs vivent dans la navigation). */
  function titresSuivi(S, today, deps) {
    const ord = ordres(S), vs = versements(S, today, deps).filter(v => v.etat !== "hypothese");
    return { alloc: "Allocation par poche",
      ordres: "Ordres à passer · " + (!ord.length ? "aucun" : ord.some(o => !o.fait) ? "en attente" : "tous passés"),
      versements: "Versements programmés · " + (vs.length ? eur(sum(vs, v => v.montant)) + " par mois" : "aucun"),
      hyp: "Hypothèses à confirmer · " + (hypotheses(S, deps).length ? "à vérifier" : "toutes confirmées"),
      journal: "Journal des mouvements" + (journalMouvements(S, 1, deps).length ? "" : " · vide") };
  }

  /* =============================================================== rendus HTML =============================================================== */
  const COULEURS_POCHE = { "Nasdaq 2x": "--s6", Monde: "--s1", Europe: "--s2", "Convictions tech": "--s4", Convictions: "--s4", Asie: "--s5", Protection: "--s9", SCPI: "--s3", "Épargne": "--s8", Crypto: "--s7", Obligations: "--s2" };
  const couleurPoche = b => "var(" + (COULEURS_POCHE[b] || "--s8") + ")";
  const chip = c => '<span class="pl-chip ' + esc(c.ton) + '">' + esc(c.texte) + "</span>";

  /** Ligne compacte d'un groupe : bouton qui ouvre le panneau de la ligne. */
  function ligneHtml(p, S, total, mode, today, deps) {
    const C = dep(deps, "Calc"), s = S || {}, v = C.val(p), compte = C.counted(p);
    const sous = [mode === "enveloppe" ? plat(p.bloc) : plat(p.envelope), mode !== "poche" && mode !== "enveloppe" ? plat(p.bloc) : ""].filter(Boolean);
    if (mode !== "titulaire" && scopeDe(s) === "foyer" && (s.people || []).length > 1) sous.push(nomDe(s, p.owner));
    const g = latente(p);
    return '<li class="pl-li' + (compte ? "" : " pl-attente") + '"><button type="button" class="pl-ligne" data-pl-ligne="' + esc(p.id) + '" aria-haspopup="dialog">' +
      '<span class="pl-l-txt"><span class="pl-l-nom">' + esc(plat(p.name) || "Ligne sans nom") + "</span>" +
      '<span class="pl-l-sous">' + esc(sous.join(" · ")) + (sous.length ? " " : "") + etatDonnee(p, today).map(chip).join(" ") + "</span></span>" +
      '<span class="pl-l-chiffres"><span class="pl-l-val">' + esc(eur(v)) + "</span>" +
      '<span class="pl-l-part">' + (compte ? esc(pct(total ? v / total * 100 : 0)) : "non compté") +
      (g != null ? ' · <span class="' + (g >= 0 ? "pos" : "neg") + '">' + esc(eurS(g)) + "</span>" : "") + "</span></span>" +
      '<span class="pl-l-ouvrir" aria-hidden="true">›</span></button></li>';
  }

  /** Cartes de groupes dépliables (ouverts = Set des clés dépliées) : 5 groupes puis « Voir plus », et dans chaque groupe 5 lignes
      puis « Voir plus ». Un groupe sans ligne comptée (« à recevoir » seulement) affiche la somme attendue, marquée non comptée. */
  function groupesHtml(groupes, mode, S, U, o) {
    const opt = o || {}, ouverts = opt.ouverts || new Set(), total = sum(groupes, g => g.montant), today = opt.today;
    const carte = (g, i) => {
      const id = "pl-g-" + i, ouvert = ouverts.has(g.cle), attente = !g.montant && g.aRecevoir > 0;
      const tend = g.plusValue == null ? "" : '<span class="pl-g-tend ' + (g.plusValue >= 0 ? "pos" : "neg") + '"><span aria-hidden="true">' + (g.plusValue >= 0 ? "▲" : "▼") + "</span>" +
        '<span class="ui-sr">' + (g.plusValue >= 0 ? "Plus-value latente : " : "Moins-value latente : ") + "</span>" + esc(eurS(g.plusValue)) + '<span class="pl-g-tend-l"> latents</span></span>';
      const meta = [pluriel(g.nb, "ligne")].concat(attente ? ["à recevoir, non compté"] : [pct(total ? g.montant / total * 100 : 0)]);
      if (g.cible != null) meta.push("cible " + nf0.format(g.cible) + " %");
      if (g.aRecevoir && !attente) meta.push("+ " + eur(g.aRecevoir) + " à recevoir");
      return '<li class="pl-groupe' + (ouvert ? " ouvert" : "") + (attente ? " pl-attente" : "") + '" data-pl-groupe="' + esc(g.cle) + '">' +
        '<h3 class="pl-g-h"><button type="button" class="pl-g-btn" data-pl-groupe-btn="' + esc(g.cle) + '" aria-expanded="' + ouvert + '" aria-controls="' + id + '">' +
        (mode === "poche" ? '<span class="pl-g-sw" style="background:' + couleurPoche(g.cle) + '" aria-hidden="true"></span>' : "") +
        '<span class="pl-g-txt"><span class="pl-g-nom">' + esc(g.label) + '</span><span class="pl-g-meta">' + esc(meta.join(" · ")) + "</span></span>" +
        '<span class="pl-g-chiffres"><span class="pl-g-val">' + esc(eur(attente ? g.aRecevoir : g.montant)) + "</span>" + tend + "</span>" +
        '<span class="pl-g-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M6 9l6 6 6-6"/></svg></span>' +
        '<span class="pl-g-barre" aria-hidden="true"><span style="width:' + Math.min(100, total ? g.montant / total * 100 : 0).toFixed(1) + '%"></span></span></button></h3>' +
        '<div class="pl-g-corps" id="' + id + '"' + (ouvert ? "" : " hidden") + ' data-pl-vp="' + esc(mode + ":" + g.cle) + '">' +
        U.voirPlus(g.lignes, 5, p => ligneHtml(p, S, total, mode, today, opt.deps), "Voir plus de lignes", "ul", "pl-lignes:" + mode + ":" + g.cle) + "</div></li>";
    };
    return '<div class="pl-groupes-vp" data-pl-vp="' + esc("groupes:" + mode) + '">' + U.voirPlus(groupes, 5, carte, "Voir plus de groupes", "ul", "pl-groupes:" + mode) + "</div>";
  }

  /** Contenu du panneau d'une ligne (d = detailLigne()), en lecture : chiffres, pastilles, hypothèse, note, source, et les liens
      « Corriger avec Claude » / « Enregistrer un mouvement avec Claude » qui portent la ligne en contexte. o = { deps }. */
  function detailHtml(d, U, o) {
    const deps = (o || {}).deps;
    return '<div class="pl-d">' +
      (d.meta ? '<p class="pl-d-meta">' + esc(d.meta) + "</p>" : "") +
      '<p class="pl-d-val">' + esc(d.valeur) + (d.poids != null ? '<span class="pl-d-poids"> · ' + esc(pct(d.poids)) + " des placements</span>" : "") + "</p>" +
      '<p class="pl-d-chips">' + d.chips.map(chip).join(" ") + "</p>" +
      (d.hypothese ? '<p class="pl-d-hyp"><strong>Hypothèse à confirmer :</strong> ' + esc(d.hypothese) + "</p>" : "") +
      '<div class="pl-acts pl-d-claude">' + lienClaude(U, phraseClaude("placements", d.contexte, deps), "Corriger avec Claude") +
        lienClaude(U, phraseClaude("mouvement", d.contexte, deps), "Enregistrer un mouvement avec Claude") + "</div>" +
      '<ul class="pl-det">' + d.faits.map(f => '<li><span class="pl-det-l">' + esc(f[0]) + '</span><span class="pl-det-v">' + esc(f[1]) + "</span></li>").join("") + "</ul>" +
      (d.note ? '<p class="pl-d-note"><strong>Note :</strong> ' + esc(d.note) + "</p>" : "") +
      (d.source ? '<p class="pl-d-note">Source des frais, de la zone et de la devise : ' + esc(d.source) + ".</p>" : "") + "</div>";
  }

  function allocationHtml(S, deps) {
    const a = allocation(S, deps);
    if (!a.lignes.length) return '<p class="pl-muet">Aucune ligne comptée pour ce périmètre.</p>';
    const max = Math.max(1, ...a.lignes.map(l => Math.max(l.pct, l.cible || 0)));
    const TON = { bon: "dans la tolérance", attention: "écart à surveiller", critique: "écart important" };
    return '<div class="pl-alloc">' + a.lignes.map(l =>
      '<div class="pl-arow"><span class="pl-a-nom" title="' + esc(l.poche) + '"><span class="pl-g-sw" style="background:' + couleurPoche(l.poche) + '" aria-hidden="true"></span>' + esc(l.poche) + "</span>" +
      '<span class="pl-a-track" aria-hidden="true"><span class="pl-a-fill" style="width:' + (l.pct / max * 100).toFixed(2) + "%;background:" + couleurPoche(l.poche) + '"></span>' +
      (l.cible != null ? '<span class="pl-a-cible" style="left:calc(' + (l.cible / max * 100).toFixed(2) + '% - 1px)"></span>' : "") + "</span>" +
      '<span class="pl-a-v"><span class="pl-num">' + esc(pct(l.pct)) + "</span>" + (l.ecart != null ? ' <span class="pl-chip ' + l.ton + '">' + esc((l.ecart > 0 ? "+" : l.ecart < 0 ? "−" : "") + nf1.format(Math.abs(l.ecart))) +
        '<span class="ui-sr"> point(s) par rapport à la cible de ' + esc(pct(l.cible)) + ", " + TON[l.ton] + "</span></span>" : "") + "</span></div>").join("") + "</div>" +
      '<p class="pl-note">' + (a.cibles ? "Trait = cible de la personne · écart en points (tolérance " + nf0.format(a.tolerance) + " pts)." : "Les cibles se règlent par personne : choisis un prénom en haut de page pour les comparer.") +
      ' Le détail du risque (classes d\'actifs, profil) est dans <a href="#pilotage/risque" data-goto="pilotage/risque">Pilotage › Risque</a>.</p>';
  }
  /** Ordres à passer, en lecture (5 puis « Voir plus ») ; un ordre passé se signale à Claude. */
  function ordresHtml(S, U, deps) {
    const xs = ordres(S);
    if (!xs.length) return '<p class="pl-muet">Aucun ordre en attente. Les ordres décidés avec ton assistant apparaîtront ici.</p>';
    return U.voirPlus(xs, 5, o => '<li><span class="pl-li-t' + (o.fait ? " pl-fait" : "") + '">' + esc(o.text) + (o.amount ? ' <span class="pl-muet">· ' + esc(o.amount) + "</span>" : "") + "</span>" +
      '<span class="pl-li-v">' + chip(o.fait ? { texte: "passé", ton: "bon" } : { texte: "à passer", ton: "attention" }) + "</span></li>", "Voir plus d'ordres", "ul", "pl-ordres") +
      '<div class="pl-acts pl-suivi-claude">' + lienClaude(U, phraseClaude("mouvement", "un ordre de ma liste « Ordres à passer » que j'ai passé", deps), "Signaler un ordre passé à Claude") + "</div>";
  }
  function versementsHtml(S, today, U, deps) {
    const vs = versements(S, today, deps);
    const corriger = '<div class="pl-acts pl-suivi-claude">' + lienClaude(U, phraseClaude("placements", "mes versements programmés", deps), vs.length ? "Corriger avec Claude" : "Compléter avec Claude") + "</div>";
    if (!vs.length) return '<p class="pl-muet">Aucun versement programmé.</p>' + corriger;
    const ETAT = { hypothese: ["hypothèse", "info"], prevu: ["prévu", "neutre"], actif: ["actif", "bon"] };
    return U.voirPlus(vs, 5, v => '<li><span class="pl-li-t">' + esc(v.label) + '<span class="pl-li-s">' + esc([v.enveloppe, "le " + v.jour + " du mois",
      v.debut ? "à partir du " + dateFr(v.debut) : "", v.dernier ? "dernier : " + v.dernier : ""].filter(Boolean).join(" · ")) + "</span></span>" +
      '<span class="pl-li-v"><span class="pl-num">' + esc(eur(v.montant)) + "</span> " + chip({ texte: ETAT[v.etat][0], ton: ETAT[v.etat][1] }) + "</span></li>", "Voir plus de versements", "ul", "pl-versements") +
      '<p class="pl-note">Appliqués chaque mois par l\'agent, sans saisie de ta part.</p>' + corriger;
  }
  /** Hypothèses à confirmer : chacune se confirme (ou se corrige) avec Claude, qui dépose une proposition. */
  function hypothesesHtml(S, U, deps) {
    const H = hypotheses(S, deps);
    if (!H.length) return '<p class="pl-muet">Toutes les hypothèses sont confirmées.</p>';
    return U.voirPlus(H, 5, h => '<li><span class="pl-li-t">' + esc(h.text) + "</span>" +
      '<span class="pl-li-v pl-li-claude">' + lienClaude(U, phraseClaude("placements", "l'hypothèse « " + h.text + " » à confirmer ou corriger", deps), "Confirmer avec Claude") + "</span></li>",
      "Voir plus d'hypothèses", "ul", "pl-hypotheses");
  }
  function journalHtml(S, U, deps) {
    const xs = journalMouvements(S, 50, deps);
    const signaler = '<div class="pl-acts pl-suivi-claude">' + lienClaude(U, phraseClaude("mouvement", "", deps), "Enregistrer un mouvement avec Claude") + "</div>";
    if (!xs.length) return '<p class="pl-muet">Aucun mouvement enregistré. Les achats, ventes et versements que tu signales à Claude, ou que l\'agent applique, apparaîtront dans ce journal.</p>' + signaler;
    return U.voirPlus(xs, 5, x => '<li><span class="pl-li-t"><strong>' + esc(x.type) + "</strong> · " + esc(x.ligne) +
      '<span class="pl-li-s">' + esc([dateFr(x.date), x.agent ? "agent" : "", x.note].filter(Boolean).join(" · ")) + "</span></span>" +
      '<span class="pl-li-v pl-num">' + esc((x.qty ? nfq.format(x.qty) + " × " + eur2(x.price) + " " : "") + (x.montant != null ? eur(x.montant) : "")) + "</span></li>",
      "Voir plus de mouvements", "ul", "pl-journal") + signaler;
  }

  const H = { MODES, grouper, totaux, matelas, evolution, courbeSvg, etatDonnee, detailLigne, detailHtml, hypotheses, versements, ordres, journalMouvements, allocation,
    titresSuivi, groupesHtml, allocationHtml, ordresHtml, versementsHtml, hypothesesHtml, journalHtml, phraseClaude, periodeTxt, jour };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =============================================================== vue =============================================================== */
  const CLE_MODE = "pilotage-groupe", EVO_KEY = "pilotage-evo", GRANULARITES = ["jour", "semaine", "mois", "trimestre", "annee"];
  let S = null, root = null, dirty = true, largeur = 0, ctlPeriode = null;
  let mode = "enveloppe", periode = { periode: "1a" };
  /* Granularité : automatique (selon la période) tant que l'utilisateur ne l'a pas choisie lui-même sur la bascule ; ce choix seul
     est mémorisé (gChoisie). granEnCours vaut vrai pendant le traitement d'un clic ou d'une touche sur la bascule de granularité. */
  let granChoisie = false, granEnCours = false;
  let ouverte = null, sigPanneau = ""; // ligne affichée dans le panneau et signature de son contenu
  const ouverts = new Set(); // groupes dépliés (clé « mode:groupe »)
  const sig = {};
  try { const m = localStorage.getItem(CLE_MODE); if (MODES.some(x => x.id === m)) mode = m; } catch (e) {}
  try {
    const o = JSON.parse(localStorage.getItem(EVO_KEY) || "null");
    if (o && typeof o === "object" && ["1m", "3m", "1a", "tout", "perso"].includes(o.periode)) {
      granChoisie = o.gChoisie === true && GRANULARITES.includes(o.granularite);
      periode = { periode: o.periode, granularite: granChoisie ? o.granularite : undefined, du: o.du, au: o.au };
    }
  } catch (e) {}
  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const scopeLabel = () => (!S || scopeDe(S) === "foyer" ? "du foyer" : window.Calc.deNom(nomDe(S, S.scope), S.scope === "p2" ? 2 : 1));
  const ouvertsDuMode = () => new Set([...ouverts].filter(k => k.startsWith(mode + ":")).map(k => k.slice(mode.length + 1)));

  /* Écrit html dans el seulement s'il a changé ; garde l'état des « Voir plus » et le focus (même élément repéré par ses data-). */
  const REPERES_FOCUS = ["data-pl-ligne", "data-pl-groupe-btn", "data-ui-voirplus"];
  const vpDe = x => { const c = x && x.closest ? x.closest("[data-pl-vp]") : null; return c ? c.getAttribute("data-pl-vp") : null; };
  /* Bouton « Voir plus » propre à un bloc [data-pl-vp] (et non celui d'un bloc imbriqué) : .ui-voirplus enfant direct. */
  const boutonVp = x => { const b = Array.from(x.children).find(c => c.classList.contains("ui-voirplus")); return b ? Array.from(b.children).find(c => c.hasAttribute("data-ui-voirplus")) || null : null; };
  function ecrire(cle, el, html) {
    if (!el || sig[cle] === html) return false;
    const actif = document.activeElement, rep = actif && actif !== el && el.contains(actif) ? REPERES_FOCUS.find(a => actif.hasAttribute(a)) : null;
    const repV = rep ? actif.getAttribute(rep) : null, repVp = rep ? vpDe(actif) : null;
    const deplies = Array.from(el.querySelectorAll("[data-pl-vp]")).filter(x => { const b = boutonVp(x); return b && b.getAttribute("aria-expanded") === "true"; }).map(x => x.getAttribute("data-pl-vp"));
    sig[cle] = html; el.innerHTML = html;
    Array.from(el.querySelectorAll("[data-pl-vp]")).forEach(x => { if (deplies.includes(x.getAttribute("data-pl-vp"))) { const b = boutonVp(x); if (b && b.getAttribute("aria-expanded") !== "true") b.click(); } });
    if (rep) {
      const c = Array.from(el.querySelectorAll("[" + rep + "]")).find(x => x.getAttribute(rep) === repV && vpDe(x) === repVp);
      if (c) c.focus();
    }
    return true;
  }

  function render() {
    const u = U();
    if (!root || !S || !u) return;
    const pret = S.ready !== false, t = totaux(S);
    const vide = pret && !t.lignes;
    $("plChargement").hidden = pret;
    $("plVide").hidden = !vide;
    $("plGroupesBloc").hidden = !pret || vide;
    $("plSuivi").hidden = !pret || vide;
    $("plMvtClaude").hidden = !t.lignes;
    $("plTitre").textContent = "Placements " + scopeLabel();
    $("plTotal").textContent = pret ? eur(t.total) : "—";
    renderEvolution(t);
    if (!pret) return;
    // faits secondaires : plus-values latentes, épargne de précaution, sommes à recevoir
    const m = matelas(S);
    const faits = [];
    if (t.cout) faits.push('<li><span class="pl-fait-l">Plus-values latentes</span><span class="pl-fait-v ' + (t.plusValue >= 0 ? "pos" : "neg") + '">' + esc(eurS(t.plusValue)) + '</span><span class="pl-fait-s">lignes cotées avec prix de revient</span></li>');
    faits.push('<li><span class="pl-fait-l">Épargne de précaution</span><span class="pl-fait-v">' + esc(eur(m.montant)) + '</span><span class="pl-fait-s">' + esc(m.cible + (m.aRecevoir ? " · +" + eur(m.aRecevoir) + " à recevoir" : "")) +
      ' · <a href="#compte/regles" data-goto="compte/regles">Voir la cible</a></span></li>');
    if (t.aRecevoir.length) faits.push('<li><span class="pl-fait-l">À recevoir (non compté)</span><span class="pl-fait-v">' + esc(eur(sum(t.aRecevoir, x => x.montant))) + '</span><span class="pl-fait-s">' + esc(t.aRecevoir.map(x => x.nom).join(", ")) + "</span></li>");
    ecrire("faits", $("plFaits"), vide ? "" : faits.join(""));
    if (vide) return;
    const gs = grouper(S.positions, mode, S);
    $("plModeNote").textContent = NOTE_MODE[mode];
    ecrire("groupes", $("plGroupes"), groupesHtml(gs, mode, S, u, { ouverts: ouvertsDuMode(), today: jour() }));
    renderSuivi();
    $("plAgent").textContent = S.status && S.status.summary ? "Dernier compte rendu de l'agent : " + plat(S.status.summary) : "";
  }

  function renderEvolution(t) {
    const ev = evolution(S, jour(), periode), r = ev.resume;
    const el = $("plCourbe");
    largeur = el.clientWidth || 0;
    ecrire("courbe", el, S.ready === false ? '<p class="pl-vide-courbe">Chargement de l\'historique…</p>' : courbeSvg(ev, { largeur, scopeLabel: scopeLabel() }));
    const varTxt = r && ev.historique ? '<span class="pl-var ' + (r.variation >= 0 ? "pos" : "neg") + '"><span aria-hidden="true">' + (Math.round(r.variation) > 0 ? "▲ " : Math.round(r.variation) < 0 ? "▼ " : "") + "</span>" +
      esc(eurS(r.variation) + (r.variationPct != null ? " (" + pctS(r.variationPct) + ")" : "")) + "</span> " + esc(periodeTxt(periode)) : ev.historique ? "" : "historique en cours de constitution";
    const n = t && t.nb ? pluriel(t.nb, "ligne") : "";
    ecrire("sous", $("plSous"), [varTxt, esc(n)].filter(Boolean).join(" · "));
    $("plCourbeNote").textContent = [ev.reconstitue ? "Premiers points reconstitués depuis tes relevés." : "", ev.serie.length > 1 && ev.serie[ev.serie.length - 1].live ? "Pointillé : valeur en direct." : ""].filter(Boolean).join(" ");
  }

  function renderSuivi() {
    const u = U(), t = jour(), T = titresSuivi(S, t);
    const accs = [
      ["alloc", T.alloc, allocationHtml(S)],
      ["ordres", T.ordres, ordresHtml(S, u)],
      ["versements", T.versements, versementsHtml(S, t, u)],
      ["hyp", T.hyp, hypothesesHtml(S, u)],
      ["journal", T.journal, journalHtml(S, u)],
    ];
    // Signature du contenu seul : l'état ouvert des accordéons est relu dans le DOM et reconduit à chaque réécriture ; l'état déplié
    // des « Voir plus » est retenu par UI.voirPlus (identifiant stable par clé).
    const brut = accs.map(a => a[1] + a[2]).join("|"), el = $("plSuivi");
    if (sig.suiviBrut === brut) return;
    sig.suiviBrut = brut; sig.suivi = null;
    const ouvertsAcc = new Set(Array.from(el.querySelectorAll("[data-pl-acc]")).filter(x => { const d = x.querySelector("details"); return d && d.hasAttribute("open"); }).map(x => x.getAttribute("data-pl-acc")));
    ecrire("suivi", el, accs.map(([k, titre, contenu]) => '<div class="pl-acc" data-pl-acc="' + k + '">' + u.accordeon({ titre, contenu, ouvert: ouvertsAcc.has(k) }) + "</div>").join(""));
  }

  function surPeriode(v) {
    if (granEnCours) granChoisie = true;
    const perso = v.periode === "perso";
    periode = { periode: v.periode, granularite: granChoisie ? v.granularite : undefined, du: perso ? v.du : undefined, au: perso ? v.au : undefined };
    const memo = { periode: periode.periode, du: periode.du, au: periode.au };
    if (granChoisie) { memo.granularite = v.granularite; memo.gChoisie = true; }
    try { localStorage.setItem(EVO_KEY, JSON.stringify(memo)); } catch (e) {}
    if (S && root) renderEvolution(totaux(S));
  }

  /* ---------- panneau d'une ligne (lecture) ---------- */
  const ligneVisible = id => (S && window.Calc ? visibles(S, window.Calc).find(p => p.id === id) : null) || null;
  function optionsLigne(p, u) {
    const d = detailLigne(p, S, jour());
    const contenu = '<div class="pl-p">' + detailHtml(d, u) + "</div>";
    return { titre: d.titre, contenu, sig: d.titre + "|" + contenu,
      pied: u.demanderAClaude("Explique-moi ma ligne « " + d.titre + " »" + (d.meta ? " (" + d.meta + ")" : "") + " dans Boussole : ce qu'elle contient, ses frais et son poids dans mes placements.") };
  }
  /* Fermeture : focus rendu à la ligne d'origine, ou à la ligne du même id si un rendu l'a remplacée, sinon au titre de la page. */
  const fermeture = (el, id) => o => {
    ouverte = null; sigPanneau = "";
    if ((o && o.focus === false) || !root || (el && el.isConnected)) return;
    const c = Array.from(root.querySelectorAll("[data-pl-ligne]")).find(x => x.getAttribute("data-pl-ligne") === id);
    if (c) c.focus(); else $("plTitre").focus();
  };
  function ouvrirLigne(id, el) {
    const u = U(), p = ligneVisible(id);
    if (!u || !p) return;
    const o = optionsLigne(p, u);
    ouverte = id; sigPanneau = o.sig;
    u.panneau.ouvrir({ titre: o.titre, contenu: o.contenu, pied: o.pied, retour: el || null, surFermeture: fermeture(el, id) });
  }
  /* Le store a émis pendant l'ouverture : contenu mis à jour s'il a changé ; panneau fermé si la ligne a disparu du périmètre. */
  function rafraichirPanneau() {
    const u = U();
    if (!ouverte || !u || !u.panneau.ouvert()) return;
    const p = ligneVisible(ouverte);
    if (!p) { u.panneau.fermer(); return; }
    const o = optionsLigne(p, u);
    if (o.sig === sigPanneau) return;
    sigPanneau = o.sig;
    u.panneau.ouvrir({ titre: o.titre, contenu: o.contenu, pied: o.pied }); // sans retour ni surFermeture : ceux de l'ouverture sont gardés
  }

  function basculerGroupe(b) {
    const cle = b.getAttribute("data-pl-groupe-btn"), k = mode + ":" + cle, ouvrir = b.getAttribute("aria-expanded") !== "true";
    if (ouvrir) ouverts.add(k); else ouverts.delete(k);
    b.setAttribute("aria-expanded", String(ouvrir));
    const corps = root.querySelector("#" + b.getAttribute("aria-controls"));
    if (corps) corps.hidden = !ouvrir;
    const li = b.closest(".pl-groupe"); if (li) li.classList.toggle("ouvert", ouvrir);
    sig.groupes = null; // le prochain rendu reprendra l'état
  }

  function mount(r) {
    root = r;
    const u = U();
    if (!u) return;
    u.bascule($("plMode"), { label: "Regrouper les lignes", options: MODES.map(x => ({ id: x.id, label: x.label, aria: x.aria })), actif: mode,
      surChange: id => { mode = id; try { localStorage.setItem(CLE_MODE, id); } catch (e) {} if (S) render(); } });
    const pp = $("plPeriode");
    const surGranularite = e => !!(e.target && e.target.closest && e.target.closest(".ui-periode-g"));
    ["click", "keydown"].forEach(type => {
      pp.addEventListener(type, e => { granEnCours = surGranularite(e); }, true); // capture : avant le surChange de la bascule
      pp.addEventListener(type, () => { granEnCours = false; });
    });
    const o = { periode: periode.periode, du: periode.du, au: periode.au, label: "Période de la courbe", surChange: surPeriode };
    if (granChoisie) o.granularite = periode.granularite;
    ctlPeriode = u.periode($("plPeriode"), o);
    $("plClaude").innerHTML = u.demanderAClaude("Explique-moi simplement mes placements dans Boussole : la répartition par enveloppe et par poche, et ce qui les a fait bouger sur la dernière année.");
    $("plCompleter").innerHTML = u.demanderAClaude(phraseClaude("placements"), "Compléter avec Claude");
    $("plMvtClaude").innerHTML = u.demanderAClaude(phraseClaude("mouvement"), "Enregistrer un mouvement avec Claude");
    $("plVideClaude").innerHTML = u.demanderAClaude(phraseClaude("placements"), "Compléter avec Claude");
    u.brancher(root);
    root.addEventListener("click", e => {
      const t = e.target; if (!t || !t.closest) return;
      const g = t.closest("[data-pl-groupe-btn]"); if (g) { basculerGroupe(g); return; }
      const l = t.closest("[data-pl-ligne]"); if (l) ouvrirLigne(l.getAttribute("data-pl-ligne"), l);
    });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => {
      const w = $("plCourbe").clientWidth;
      if (S && w && Math.abs(w - largeur) > 24) renderEvolution(totaux(S));
    }).observe($("plCourbe"));
  }
  function update(snap, visible) {
    S = snap;
    if (ctlPeriode && typeof ctlPeriode.premiere === "function") {
      const sc = scopeDe(S), ds = (S.snapshots || []).filter(x => x && fini(x[sc])).map(x => jj(x.date)).filter(isoOk).sort();
      ctlPeriode.premiere(ds[0]);
    }
    dirty = true;
    if (visible) { render(); dirty = false; }
    rafraichirPanneau();
  }
  function show() { if (dirty) { render(); dirty = false; } }
  /* Chiffre clé (titres, pastilles) : le total financier du périmètre. */
  function headline() { return S && (S.positions || []).length ? eur(totaux(S).total) : "–"; }

  const api = { mount, update, show, headline };
  const reg = () => App.register("pilotage", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
