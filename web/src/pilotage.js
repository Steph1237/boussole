/* Patrimoine › Placements (module « pilotage ») — « Qu'est-ce que j'ai en placements ? ». Lecture seule : le board lit, l'agent écrit
   (docs/superpowers/specs/2026-10-11-saisie-par-agent.md). Toute saisie passe par Claude : boutons « Compléter avec Claude »,
   « Corriger avec Claude », « Enregistrer un mouvement avec Claude » (UI.demanderAClaude + ClaudePrompts.phrase, sections placements
   et mouvement, avec la ligne concernée en contexte). Aucune écriture au store depuis ce module.
   - En-tête : total financier du périmètre, variation sur 1 an (photos nocturnes + valeur en direct), nombre de lignes, ligne « Rendement réel 1 an : X % · attendu Y %/an
     (fourchette 8 sur 10 : a à b) » tirée du graphe maître (surRendement ; détail dépliable : les 4 périodes, rendementLigne / rendementHtml), plus-values
     latentes, épargne de précaution (cible réglée dans Compte › Règles) ; puis le graphe maître (GraphePatrimoine relié au moteur
     par GrapheModele.brancher, préréglage « placements » : vue financier, passé observé et reconstitué + projection du moteur sur un
     seul axe, une seule commande de temps 1 an · 5 ans · 10 ans · 20 ans · Tout, 5 ans sur mobile / 10 ans sur ordinateur, aucun
     objectif). Les réglages du graphe sont locaux, jamais enregistrés. Le passé reconstitué est lu par SerieNet.charger (période
     « tout »), comme sur Aujourd'hui ; la fin d'une lecture relance le graphe.
   - Bascule de regroupement (UI.bascule) : Par enveloppe · Par poche · Par titulaire · Par disponibilité (liquidité, Calc.liquidite) ;
     une carte par groupe (nom, montant, part, plus-value latente) qui se déplie en lignes compactes (5 puis « Voir plus ») ;
     une ligne ouvre UI.panneau (lecture) : cours et date, quantité, PRU, plus-value latente, poids, frais / zone / devise (avec
     source), statut, note, liens Claude. Le panneau se met à jour quand le store émet et se ferme si la ligne disparaît.
   - Fiches de Patrimoine › Comptes (spec CP1 § 3) : chaque groupe « Par enveloppe » a un lien « Ouvrir la fiche du compte »
     (#patrimoine/comptes?enveloppe=…) et le panneau d'une ligne un lien « Voir la fiche de la ligne » (?ligne=…), adresses de
     ComptesView.lien (comptes-view.js), comme App.ouvrir.
   - Suivi des lignes (SUIVI, suivi-view.js) : en tête de « Mes lignes », le système cœur et satellite (anneau à trois arcs, graduation du plafond
     satellite, orbite des lignes du satellite, tableau équivalent) ; sur chaque ligne, son rôle (chip neutre, « proposé » tant qu'il n'est pas confirmé
     avec Claude) et sa météo (icône et mot, jamais une note) ; « Rôle » s'ajoute aux regroupements. Le détail d'une ligne (« Ta ligne ») est sur sa fiche de
     Patrimoine › Comptes. Lecture seule : les rôles et la politique de suivi se règlent avec Claude (definir_suivi).
   - Accordéons fermés en bas : Allocation par poche, Ordres à passer, Versements programmés, Hypothèses à confirmer, Journal des
     mouvements (listes en 5 puis « Voir plus », dans le périmètre S.scope).
   Le score de santé est dans Pilotage › Santé, les alertes dans Aujourd'hui, les règles et la cible du matelas dans Compte › Règles.
   Fonctions pures exportées pour les tests (module.exports) : grouper, totaux, matelas, variation, etatDonnee, detailLigne, hypotheses,
   versements, ordres, journalMouvements, allocation, phraseClaude, et les rendus HTML groupesHtml, detailHtml,
   allocationHtml, ordresHtml, versementsHtml, hypothesesHtml, journalHtml (UI reçu en paramètre quand il en faut ; aucune ne touche
   au DOM). Dépendances injectées (deps) : { Calc, Periodes, ClaudePrompts }, window.* par défaut. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : glob(k));
  /* Adresse d'une fiche de Patrimoine › Comptes (ComptesView.lien, comptes-view.js : global du navigateur, sinon le module voisin). */
  const comptesView = () => glob("ComptesView") || (typeof module === "object" && module.exports && typeof require === "function" ? require("./comptes-view.js") : null);
  const lienFiche = cible => { const CV = comptesView(); return CV && typeof CV.lien === "function" ? CV.lien(cible) : "patrimoine/comptes"; };

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
  /* Formats uniques (format.js, UX1) : « 14 oct. 2026 », « 193 490 € », « +5,2 % » ; global du navigateur, sinon le module voisin sous Node. */
  const FM = () => (typeof globalThis !== "undefined" && globalThis.Fmt) || (typeof module === "object" && module.exports && typeof require === "function" ? require("./format.js") : null);
  const dateFr = s => { const d = jj(s); return isoOk(d) ? FM().fmtDate(d) : ""; };
  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nfq = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });
  const fini = v => v != null && v !== "" && isFinite(+v);
  const eur = v => (!fini(v) ? "—" : FM().fmtEUR(v));
  const eurS = v => (!fini(v) ? "—" : FM().fmtEUR(v, { signe: true }));
  const eur2 = v => (!fini(v) ? "—" : FM().fmtEUR(v, { decimales: 2 }));
  const pct = v => (!fini(v) ? "—" : FM().fmtPct(v));
  const pctS = v => (!fini(v) ? "—" : FM().fmtPct(v, { signe: true }));
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
    { id: "enveloppe", label: "Enveloppe", aria: "Regrouper par enveloppe" }, { id: "poche", label: "Poche", aria: "Regrouper par poche" },
    { id: "titulaire", label: "Titulaire", aria: "Regrouper par titulaire" }, { id: "disponibilite", label: "Disponibilité", aria: "Regrouper par disponibilité" },
    { id: "role", label: "Rôle", aria: "Regrouper par rôle (cœur, satellite, réserve)" },
  ];
  const ORDRE_ROLE = ["coeur", "satellite", "reserve", "nc", "hors"];
  const ORDRE_LIQ = ["immediate", "jours", "semaines", "bloque"];
  const NOTE_MODE = {
    enveloppe: "Un compte ou un contrat par ligne.",
    poche: "Les poches regroupent tes lignes par usage ou par thème ; l'écart aux cibles est dans « Allocation par poche ».",
    titulaire: "Une ligne par personne du foyer.",
    role: "Cœur, satellite ou réserve : le rôle de chaque ligne fixe sa fréquence de revue. Un rôle proposé se confirme avec Claude.",
    disponibilite: "Délai pour récupérer l'argent placé, estimé d'après l'enveloppe (livrets : tout de suite ; assurance-vie : quelques semaines ; PER, SCPI : bloqué). Vue limitée aux placements financiers : ton immobilier en direct est dans Immobilier et crédits.",
  };
  /** Cibles d'allocation par poche de la personne affichée (config.targets[p]) ; null pour le foyer. */
  function ciblesPoche(S) { const t = (S && S.config && S.config.targets) || {}; const sc = scopeDe(S); return sc === "foyer" ? null : t[sc] || null; }

  /* Suivi des lignes (SUIVI) : rendus de suivi-view.js (global du navigateur, sinon le module voisin sous Node) et rôle effectif de chaque ligne. */
  const suiviView = deps => dep(deps, "SuiviView") || (typeof module === "object" && module.exports && typeof require === "function" ? require("./suivi-view.js") : null);
  /** Vue du suivi (Suivi.vue) du périmètre affiché, ou null si le moteur manque. */
  function vueSuivi(S, today, deps) { const V = suiviView(deps); return V ? V.vue(S, today) : null; }
  /** Rôle effectif de chaque ligne du périmètre : Map id → reserve | coeur | satellite | nc. */
  function rolesDe(S, deps) {
    const v = vueSuivi(S, jour(), deps), m = new Map();
    if (v) v.lignes.forEach(l => m.set(l.id, l.role || "nc"));
    return m;
  }
  /** Groupes de lignes selon le mode (enveloppe | poche | titulaire | disponibilite), dans le périmètre S.scope, hors clôturées :
      [{ cle, label, montant (lignes comptées), part (% du total compté), plusValue (null si aucune ligne cotée avec PRU),
         aRecevoir, nb, cible (% de la poche pour une personne, sinon null), lignes (valeur décroissante, « à recevoir » à la fin) }].
      Tri par montant décroissant ; par disponibilité, du plus disponible au plus bloqué. */
  function grouper(positions, mode, S, deps) {
    const C = dep(deps, "Calc"), s = S || {}, sc = scopeDe(s);
    const m = MODES.some(x => x.id === mode) ? mode : "enveloppe";
    const ps = (Array.isArray(positions) ? positions : []).filter(p => p && C.inScope(p, sc) && p.status !== "clôturé");
    const total = sum(ps.filter(C.counted), C.val);
    const roles = m === "role" ? rolesDe(s, deps) : null;
    const cle = { enveloppe: p => plat(p.envelope) || "Sans enveloppe", poche: p => plat(p.bloc) || "Sans poche", titulaire: p => p.owner || "p1",
      disponibilite: p => C.liquidite(p.envelope), role: p => (roles && roles.get(p.id)) || "hors" }[m];
    const lab = { enveloppe: k => k, poche: k => k, titulaire: k => nomDe(s, k), disponibilite: k => (C.LIQUIDITE_LABELS && C.LIQUIDITE_LABELS[k]) || k,
      role: k => ({ coeur: "Cœur", satellite: "Satellite", reserve: "Réserve", nc: "Non classées", hors: "Hors suivi (comptes courants, à recevoir)" }[k] || k) }[m];
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
    if (m === "role") return gs.sort((a, b) => ORDRE_ROLE.indexOf(a.cle) - ORDRE_ROLE.indexOf(b.cle));
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

  /* =============================================================== variation =============================================================== */
  const PERIODE_TXT = "sur 1 an";

  /** Variation des placements du périmètre sur 1 an : photos nocturnes (S.snapshots[scope]) + point du jour (valeur en direct), agrégées par Periodes ;
      la variation part de la dernière valeur avant la période. Le tracé de la courbe n'est plus ici (graphe maître).
      → { resume: { variation, variationPct } | null, historique (au moins une photo), reconstitue (une photo vient des relevés), bornes } */
  function variation(S, today, deps) {
    const Pe = dep(deps, "Periodes"), s = S || {}, sc = scopeDe(s), t = jour(today);
    const snaps = (s.snapshots || []).filter(x => x && fini(x[sc]) && isoOk(jj(x.date)))
      .map(x => ({ date: jj(x.date), v: +x[sc], src: x.source })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const pts = snaps.slice();
    if (!pts.length || pts[pts.length - 1].date < t) pts.push({ date: t, v: totaux(s, deps).total, live: true });
    const base = { historique: snaps.length > 0, reconstitue: snaps.some(x => x.src === "relevés") };
    if (!Pe || typeof Pe.agreger !== "function") return Object.assign(base, { resume: null, bornes: null });
    const b = Pe.bornes("1a", t, pts[0].date), ag = Pe.agreger(pts, b, Pe.auto(b), x => x.v);
    const r = ag.length ? Pe.resume(ag, pts, b, x => x.v) : null;
    return Object.assign(base, { resume: r && fini(r.variation) ? { variation: r.variation, variationPct: fini(r.variationPct) ? r.variationPct : null } : null, bornes: b });
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
      faits.push(["Cours", x.price != null ? eur2(x.price) + (dateFr(x.priceDate) ? " · " + dateFr(x.priceDate) : "") : "à récupérer ce soir"]);
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
    if (fini(x.ter)) faits.push(["Frais courants", FM().fmtPct(+x.ter, { decimales: 2 }) + " par an"]);
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
  function ligneHtml(p, S, total, mode, today, deps, sv) {
    const C = dep(deps, "Calc"), s = S || {}, v = C.val(p), compte = C.counted(p), V = sv && suiviView(deps), ls = sv && sv.get(p.id);
    const sous = [mode === "enveloppe" ? plat(p.bloc) : plat(p.envelope), mode !== "poche" && mode !== "enveloppe" ? plat(p.bloc) : ""].filter(Boolean);
    if (mode !== "titulaire" && scopeDe(s) === "foyer" && (s.people || []).length > 1) sous.push(nomDe(s, p.owner));
    const g = latente(p);
    return '<li class="pl-li' + (compte ? "" : " pl-attente") + '"><button type="button" class="pl-ligne" data-pl-ligne="' + esc(p.id) + '" aria-haspopup="dialog">' +
      '<span class="pl-l-txt"><span class="pl-l-nom">' + esc(plat(p.name) || "Ligne sans nom") + "</span>" +
      '<span class="pl-l-sous">' + esc(sous.join(" · ")) + (sous.length ? " " : "") + etatDonnee(p, today).map(chip).join(" ") + "</span>" +
      (ls && V && mode !== "role" ? '<span class="pl-l-role">' + V.roleChipHtml(ls) + "</span>" : "") + "</span>" +
      '<span class="pl-l-chiffres"><span class="pl-l-val">' + esc(eur(v)) + "</span>" +
      '<span class="pl-l-part">' + (compte ? esc(pct(total ? v / total * 100 : 0)) : "non compté") +
      (g != null ? ' · <span class="' + (g >= 0 ? "pos" : "neg") + '">' + esc(eurS(g)) + "</span>" : "") + "</span>" +
      (ls && V && compte ? '<span class="pl-l-meteo">' + V.meteoHtml(ls.meteo, ls.meteo_libelle) + "</span>" : "") + "</span>" +
      '<span class="pl-l-ouvrir" aria-hidden="true">›</span></button></li>';
  }

  /** Lien vers la fiche du compte d'un groupe « Par enveloppe » (titulaire précisé quand toutes ses lignes ont le même). */
  function ficheGroupe(g, mode) {
    if (mode !== "enveloppe" || !g || !g.lignes.length || g.cle === "Sans enveloppe") return "";
    const owners = [...new Set(g.lignes.map(p => p.owner).filter(Boolean))];
    const r = lienFiche({ enveloppe: g.cle, titulaire: owners.length === 1 ? owners[0] : null });
    return '<p class="pl-g-fiche"><a href="#' + esc(r) + '" data-goto="' + esc(r) + '">Ouvrir la fiche du compte<span class="ui-sr"> ' + esc(g.label) + "</span></a></p>";
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
        '<div class="pl-g-corps" id="' + id + '"' + (ouvert ? "" : " hidden") + ' data-pl-vp="' + esc(mode + ":" + g.cle) + '">' + ficheGroupe(g, mode) +
        U.voirPlus(g.lignes, 5, p => ligneHtml(p, S, total, mode, today, opt.deps, opt.suivi), "Voir plus de lignes", "ul", "pl-lignes:" + mode + ":" + g.cle) + "</div></li>";
    };
    return '<div class="pl-groupes-vp" data-pl-vp="' + esc("groupes:" + mode) + '">' + U.voirPlus(groupes, 5, carte, "Voir plus de groupes", "ul", "pl-groupes:" + mode) + "</div>";
  }

  /** Contenu du panneau d'une ligne (d = detailLigne()), en lecture : chiffres, pastilles, hypothèse, note, source, et les liens
      « Corriger avec Claude » / « Enregistrer un mouvement avec Claude » qui portent la ligne en contexte. o = { deps }. */
  function detailHtml(d, U, o) {
    const deps = (o || {}).deps, ls = (o || {}).suivi, V = ls && suiviView(deps);
    return '<div class="pl-d">' +
      (d.meta ? '<p class="pl-d-meta">' + esc(d.meta) + "</p>" : "") +
      (ls && V ? '<p class="pl-d-suivi">' + V.roleChipHtml(ls) + " " + V.meteoHtml(ls.meteo, ls.meteo_libelle) + "</p>" +
        '<p class="pl-d-revue">' + esc(ls.revue.texte) + (ls.a_confirmer ? " Rôle proposé (" + esc(ls.raison_role_texte) + ") : confirme-le avec Claude." : "") + "</p>" : "") +
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
    if (!xs.length) return '<p class="pl-muet">Aucun ordre en attente. Les ordres décidés avec Claude apparaîtront ici.</p>';
    return U.voirPlus(xs, 5, o => '<li><span class="pl-li-t' + (o.fait ? " pl-fait" : "") + '">' + esc(o.text) + (o.amount ? ' <span class="pl-muet">· ' + esc(o.amount) + "</span>" : "") + "</span>" +
      '<span class="pl-li-v">' + chip(o.fait ? { texte: "passé", ton: "bon" } : { texte: "à passer", ton: "attention" }) + "</span></li>", "Voir plus d'ordres", "ul", "pl-ordres") +
      '<div class="pl-acts pl-suivi-claude">' + lienClaude(U, phraseClaude("mouvement", "un ordre de ma liste « Ordres à passer » que j'ai passé", deps), "Signaler un ordre passé à Claude") + "</div>";
  }
  function versementsHtml(S, today, U, deps) {
    const vs = versements(S, today, deps);
    /* Réglés avec Claude : il dépose une proposition (regler_versements, cible config, migration 0019) validée dans Agent › À valider. */
    const corriger = '<div class="pl-acts pl-suivi-claude">' + lienClaude(U, phraseClaude("versements", "", deps), "Régler avec Claude") + "</div>";
    if (!vs.length) return '<p class="pl-muet">Aucun versement programmé. Règle-les avec Claude : il dépose une proposition que tu valides dans Agent › À valider.</p>' + corriger;
    const ETAT = { hypothese: ["hypothèse", "info"], prevu: ["prévu", "neutre"], actif: ["actif", "bon"] };
    return U.voirPlus(vs, 5, v => '<li><span class="pl-li-t">' + esc(v.label) + '<span class="pl-li-s">' + esc([v.enveloppe, "le " + v.jour + " du mois",
      v.debut ? "à partir du " + dateFr(v.debut) : "", v.dernier ? "dernier : " + v.dernier : ""].filter(Boolean).join(" · ")) + "</span></span>" +
      '<span class="pl-li-v"><span class="pl-num">' + esc(eur(v.montant)) + "</span> " + chip({ texte: ETAT[v.etat][0], ton: ETAT[v.etat][1] }) + "</span></li>", "Voir plus de versements", "ul", "pl-versements") +
      '<p class="pl-note">Appliqués chaque mois par l\'agent, sans saisie de ta part. Pour en ajouter, en changer ou en arrêter, règle-les avec Claude : il dépose une proposition que tu valides dans Agent › À valider.</p>' + corriger;
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

  /* =============================================================== rendement réel =============================================================== */
  /* Ligne de l'en-tête « Rendement réel 1 an : X % · attendu Y %/an (fourchette 8 sur 10 : a à b) », avec le tableau des 4 périodes en détail. Données du graphe maître
     (GrapheModele.rendementDonnees → { projet, reel }) : mêmes chiffres que la feuille « Rendements » du graphe et que le panneau d'Aujourd'hui. X est le rendement de tes placements
     (pondéré par le temps), la mesure qui se compare à l'attendu ; le tableau donne aussi ton rendement (pondéré par l'argent). Honnêteté : moins d'un an de relevés, on prend la
     période la plus longue mesurable et on la dit (« sur 5 mois », jamais annualisée) ; mesure fragile : « ≈ » et « approché » ; trop peu de relevés : « pas assez d'historique »,
     aucun chiffre ; sans le calcul de la projection : pas d'attendu. */
  const rendementMod = deps => dep(deps, "Rendement") || (typeof module === "object" && module.exports && typeof require === "function" ? require("./rendement.js") : null);
  const maj1 = t => { const x = String(t || ""); return x.charAt(0).toUpperCase() + x.slice(1); };
  const unique = l => [...new Set(l)];
  const ptsRd = p => p && p.statut != null && p.statut !== "insuffisant";
  function rendementLigne(rd, deps) {
    const RDm = rendementMod(deps), periodes = rd && rd.reel && Array.isArray(rd.reel.periodes) ? rd.reel.periodes.filter(Boolean) : [];
    if (!RDm || !periodes.length) return null;
    const parId = id => periodes.find(p => p.id === id);
    const p = ptsRd(parId("1a")) ? parId("1a") : ["3m", "1m", "debut"].map(parId).filter(ptsRd).sort((a, b) => b.jours - a.jours)[0] || null;
    const cellule = (v, an, ap) => (!fini(v) ? "—" : (ap ? "≈ " : "") + RDm.pct(v, { signe: !an }) + (an ? "/an" : ""));
    const lignes = periodes.map(q => {
      if (!ptsRd(q)) return '<tr data-rd="' + esc(q.id) + '"><th scope="row">' + esc(q.libelle) + '</th><td colspan="3">' + esc(q.raison || "pas assez d'historique") + "</td></tr>";
      const an = !!q.annualise, ap = q.statut === "approche", at = q.attendu && q.attendu.statut === "ok" ? q.attendu : null;
      return '<tr data-rd="' + esc(q.id) + '"><th scope="row">' + esc(q.libelle) + "</th><td>" + esc(cellule(an ? q.xirr_annuel_pct : q.xirr_periode_pct, an, ap)) + "</td><td>" + esc(cellule(an ? q.twr_annuel_pct : q.twr_periode_pct, an, ap)) +
        '</td><td class="pl-rd-at">' + esc(at ? cellule(at.attendu_pct, an, false) : "—") + "</td></tr>";
    });
    const tableau = '<div class="pl-rd-wrap" tabindex="0" role="region" aria-label="Rendements obtenus sur tes placements"><table class="pl-rd-tab"><caption class="ui-sr">Rendement obtenu, par période</caption><thead><tr>' +
      '<th scope="col">Période</th><th scope="col">Ton rendement</th><th scope="col">Rendement de tes placements</th><th scope="col">Attendu</th></tr></thead><tbody>' + lignes.join("") + "</tbody></table></div>";
    const notes = [];
    let texte, approche = false, puces = null;
    if (!p) {
      const rien = parId("debut") || periodes[0], raison = String((rien && rien.raison) || "pas assez d'historique");
      texte = "Rendement réel : " + raison.replace(/^(pas assez d'historique)\s*:\s*(.*)$/, "$1 ($2)");
    } else {
      const an = !!p.annualise, ap = p.statut === "approche", qui = p.id === "1a" ? "1 an" : RDm.dureeTxt(p.jours), v = an ? p.twr_annuel_pct : p.twr_periode_pct;
      approche = ap;
      texte = (p.id === "1a" ? "Rendement réel 1 an" : "Rendement réel sur " + qui) + " : " + (fini(v) ? (ap ? "≈ " : "") + RDm.pct(v, { signe: !an }) : "non calculable") + (ap ? " (approché)" : "");
      const at = p.attendu && p.attendu.statut === "ok" ? p.attendu : null;
      // résumé en deux puces : « Rendement réel · 2 mois +12,9 % » et « attendu +0,9 % » ; la fourchette passe dans le détail ; sous 6 mois on ne compare pas une durée courte à une attente annuelle
      puces = { reel: "Rendement réel · " + qui + " " + (fini(v) ? (ap ? "≈ " : "") + RDm.pct(v, { signe: !an }) : "non calculable") + (ap ? " (approché)" : ""), attendu: null, fourchette: null, court: false };
      if (at) {
        const dec = at.p90_pct - at.p10_pct >= 6 ? 0 : 1, fourch = "Fourchette 8 sur 10 : " + RDm.pct(at.p10_pct, { signe: true, dec }).replace(/\u00a0%$/, "") + " à " + RDm.pct(at.p90_pct, { signe: true, dec });
        texte += " · attendu " + RDm.pct(at.attendu_pct, { signe: !an }) + (an ? "/an" : "") + " (fourchette 8 sur 10 : " + RDm.pct(at.p10_pct, { signe: true, dec }).replace(/\u00a0%$/, "") + " à " + RDm.pct(at.p90_pct, { signe: true, dec }) + ")";
        if (p.id !== "1a" && !an && p.jours < 180) puces.court = true;
        else { puces.attendu = "attendu " + RDm.pct(at.attendu_pct, { signe: !an }) + (an ? "/an" : ""); puces.fourchette = fourch; }
      }
      const un = parId("1a");
      if (p.id !== "1a" && un && !ptsRd(un)) notes.push("Pas assez d'historique pour 1 an : la période la plus longue mesurable est de " + qui + (p.id === "debut" ? " (depuis ton premier relevé)" : ""));
      if (p.comparaison && p.comparaison.phrase) notes.push(p.comparaison.phrase + (p.source && p.source.texte ? ". " + maj1(p.source.texte) : ""));
    }
    const fragiles = unique(periodes.filter(q => q.statut === "approche").flatMap(q => (Array.isArray(q.notes) ? q.notes : [])).concat(Array.isArray(rd.reel.notes) ? rd.reel.notes : [])).map(maj1);
    const tous = fragiles.concat(notes).map(n => (/[.!?]$/.test(n) ? n : n + "."));
    tous.push("Net de frais, avant impôts, sur tes placements (comptes courants exclus). Ton rendement tient compte de la date de tes versements ; celui de tes placements non : c'est lui qui se compare à l'attendu.");
    return { texte, puces, periode: p ? p.id : null, approche, tableau, notes: puces && puces.fourchette ? [puces.fourchette + "."].concat(tous) : tous };
  }
  const CHEVRON_RD = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';
  /** La ligne de rendement, dépliable (details fermé) : résumé = la phrase, détail = tableau des 4 périodes et notes. "" sans rendement à montrer. */
  function rendementHtml(rd, deps) {
    const l = rendementLigne(rd, deps);
    if (!l) return "";
    const pu = l.puces, resume = pu
      ? '<span class="pl-rd-chip">' + esc(pu.reel) + "</span>" + (pu.attendu ? '<span class="pl-rd-chip att">' + esc(pu.attendu) + "</span>" : "") + (pu.court ? '<span class="pl-rd-court">période trop courte pour comparer</span>' : "")
      : esc(l.texte);
    return '<details class="pl-rd-det"><summary class="pl-rd-ligne"><span class="pl-rd-txt">' + resume + '</span><span class="pl-rd-chev">' + CHEVRON_RD + "</span></summary>" +
      '<div class="pl-rd-corps">' + l.tableau + l.notes.map(n => '<p class="pl-rd-note">' + esc(n) + "</p>").join("") + "</div></details>";
  }

  const H = { MODES, lienFiche, ficheGroupe, grouper, totaux, matelas, variation, etatDonnee, detailLigne, detailHtml, hypotheses, versements, ordres, journalMouvements, allocation,
    titresSuivi, vueSuivi, rolesDe, rendementLigne, rendementHtml, groupesHtml, allocationHtml, ordresHtml, versementsHtml, hypothesesHtml, journalHtml, phraseClaude, jour };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =============================================================== vue =============================================================== */
  const CLE_MODE = "pilotage-groupe";
  let S = null, root = null, dirty = true, mode = "enveloppe";
  let ouverte = null, sigPanneau = ""; // ligne affichée dans le panneau et signature de son contenu
  let vueSv = null, orbiteOuverte = false; // vue du suivi des lignes (SUIVI) calculée au rendu ; orbite du satellite dépliée
  const ouverts = new Set(); // groupes dépliés (clé « mode:groupe »)
  const sig = {};
  try { const m = localStorage.getItem(CLE_MODE); if (MODES.some(x => x.id === m)) mode = m; } catch (e) {}
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
    if (!pret && !$("plChargement").firstChild) $("plChargement").innerHTML = u.squelette(1, "kpi") + u.squelette(1, "graphe");
    $("plVide").hidden = !vide;
    $("plGroupesBloc").hidden = !pret || vide;
    $("plSuivi").hidden = !pret || vide;
    $("plTitre").textContent = "Placements " + scopeLabel();
    $("plTotal").textContent = pret ? eur(t.total) : "—";
    renderEvolution(t);
    renderRendement();
    $("plGrapheBloc").hidden = !pret || vide; // sans placement, rien à tracer : l'état vide orienté suffit
    if (pret && !vide) { chargerHistorique(); lancerGraphe(); }
    if (!pret) return;
    // faits secondaires : plus-values latentes, épargne de précaution, sommes à recevoir
    const m = matelas(S);
    const faits = [];
    // trois tuiles (UI.tuile) ; sous 600 px elles deviennent trois lignes (libellé et montant sur une ligne, sous-ligne dessous), voir pilotage.css
    const tuile = (l, v, sous, cls, lien) => '<li class="ui-tuile"><span class="ui-tuile-l pl-fait-l">' + esc(l) + '</span><span class="ui-tuile-v pl-fait-v' + (cls ? " " + cls : "") + '">' + esc(v) + '</span><span class="ui-tuile-s pl-fait-s">' + esc(sous) + "</span>" + (lien || "") + "</li>";
    if (t.cout) faits.push(tuile("Plus-values latentes", eurS(t.plusValue), "avec prix de revient", t.plusValue >= 0 ? "pos" : "neg"));
    faits.push(tuile("Épargne de précaution", eur(m.montant), m.cible, "", '<a class="pl-fait-a" href="#compte/regles" data-goto="compte/regles">Voir la cible</a>'));
    if (t.aRecevoir.length) faits.push(tuile("À recevoir (non compté)", eur(sum(t.aRecevoir, x => x.montant)), t.aRecevoir.map(x => x.nom).join(", ")));
    ecrire("faits", $("plFaits"), vide ? "" : faits.join(""));
    if (vide) return;
    vueSv = vueSuivi(S, jour());
    const parId = vueSv ? new Map(vueSv.lignes.map(l => [l.id, l])) : null, V = suiviView();
    $("plSysteme").hidden = !vueSv || !vueSv.lignes.length;
    if (vueSv && V) ecrire("systeme", $("plSysteme"), '<h2 id="plSystemeTitre">Cœur et satellite</h2>' + V.systemeHtml(vueSv, { U: u, ouvert: orbiteOuverte }));
    const gs = grouper(S.positions, mode, S);
    $("plModeNote").textContent = NOTE_MODE[mode];
    ecrire("groupes", $("plGroupes"), groupesHtml(gs, mode, S, u, { ouverts: ouvertsDuMode(), today: jour(), suivi: parId }));
    renderSuivi();
    $("plAgent").textContent = S.status && S.status.summary ? "Dernière mise à jour de nuit : " + plat(S.status.summary) : "";
  }

  /* Sous le total : variation sur 1 an (photos nocturnes + valeur en direct) et nombre de lignes. Le tracé est celui du graphe maître. */
  function renderEvolution(t) {
    const ev = variation(S, jour()), r = ev.resume;
    const varTxt = r && ev.historique ? (() => { const d = FM().fmtDelta({ montant: r.variation, pct: r.variationPct, periode: PERIODE_TXT }), mv = d.texte.slice(0, d.texte.length - PERIODE_TXT.length).trim();
      return '<span class="pl-var ' + (d.ton === "neutre" ? "" : d.ton === "pos" ? "pos" : "neg") + '"><span aria-hidden="true">' + esc(mv.charAt(0)) + "</span> " + '<span class="ui-sr">' + esc({ hausse: "En hausse", baisse: "En baisse", stable: "Stable" }[d.sens] + " : ") + "</span>" + esc(mv.slice(1).trim()) + "</span> " + esc(PERIODE_TXT); })()
      : ev.historique ? "" : "historique en cours de constitution";
    const n = t && t.nb ? pluriel(t.nb, "ligne") : "";
    ecrire("sous", $("plSous"), [varTxt, esc(n)].filter(Boolean).join(" · "));
  }

  /* Ligne « Rendement réel » sous la variation : alimentée par le graphe maître (surRendement), à chaque dessin ; masquée tant que le graphe n'a pas calculé, sans relevé, ou quand le
     périmètre a changé depuis ce calcul. Le détail ouvert le reste tant que le texte ne change pas. */
  let rendementGraphe = null;
  function renderRendement() {
    const el = $("plRd");
    if (!el) return;
    let h = "";
    try { h = rendementGraphe && rendementGraphe.scope === scopeDe(S) ? rendementHtml(rendementGraphe.rd) : ""; } catch (e) { h = ""; }
    const ouvert = !!el.querySelector("details[open]");
    el.hidden = !h;
    if (ecrire("rd", el, h) && ouvert) { const d = el.querySelector("details"); if (d) d.setAttribute("open", ""); }
  }

  /* ---------- graphe maître : composant GraphePatrimoine relié au moteur par GrapheModele.brancher (un seul moteur, Projection.executer) ---------- */
  let liaison = null;
  const SN = () => glob("SerieNet");
  const GM = () => glob("GrapheModele");
  /* Lit tout le passé utile au graphe (cours, transactions, opérations bancaires : SerieNet.charger, période « tout », 5 ans au plus) ; la fin d'une lecture
     relance le graphe (abonnement posé au mount), comme sur Aujourd'hui. */
  function chargerHistorique() { const sn = SN(); if (sn && typeof sn.charger === "function") sn.charger(S, jour(), { id: "tout" }, null); }
  /* Monte le graphe une fois ; le recalcul n'a lieu que si ce qui compte a changé (store, périmètre, passé lu, réglages locaux) : une émission du store sans effet ne redessine rien. */
  function lancerGraphe() {
    const Mo = GM(), el = $("plGraphe"), u = U();
    if (!root || !S || S.ready === false || !Mo || !el || !u) return;
    if (!liaison) liaison = Mo.brancher(el, { preset: "placements", deps: { UI: u }, today: () => jour(), perimetre: () => scopeLabel(), store: window.Store || null,
      enAttente: snap => { const sn = SN(); return !!(sn && typeof sn.enAttente === "function" && sn.enAttente(snap, null)); },
      surRendement: rd => { rendementGraphe = rd ? { rd, scope: scopeDe(S) } : null; renderRendement(); } });
    if (liaison) liaison.actualiser(S);
  }
  /* Une lecture du passé vient de finir : le graphe est recalculé avec son passé (ou le sera à l'affichage). */
  function histPrete() {
    if (!root || !S) return;
    if (!root.hidden) { if (S.ready !== false && totaux(S).lignes) lancerGraphe(); } else dirty = true;
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

  /* ---------- panneau d'une ligne (lecture) ---------- */
  const ligneVisible = id => (S && window.Calc ? visibles(S, window.Calc).find(p => p.id === id) : null) || null;
  function optionsLigne(p, u) {
    const d = detailLigne(p, S, jour());
    const ls = vueSv ? vueSv.lignes.find(l => l.id === p.id) : null;
    const contenu = '<div class="pl-p">' + detailHtml(d, u, { suivi: ls }) + "</div>";
    return { titre: d.titre, contenu, sig: d.titre + "|" + contenu, lien: { label: "Voir la fiche de la ligne", href: "#" + lienFiche({ ligne: p.id }) },
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
    u.panneau.ouvrir({ titre: o.titre, contenu: o.contenu, lien: o.lien, pied: o.pied, retour: el || null, surFermeture: fermeture(el, id) });
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
    u.panneau.ouvrir({ titre: o.titre, contenu: o.contenu, lien: o.lien, pied: o.pied }); // sans retour ni surFermeture : ceux de l'ouverture sont gardés
  }

  /* Orbite du satellite : se déplie en 220 ms (le CSS le supprime avec prefers-reduced-motion) ; l'état est retenu pour les rendus suivants. */
  function basculerOrbite(b) {
    orbiteOuverte = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", String(orbiteOuverte));
    b.textContent = orbiteOuverte ? "Replier le satellite" : "Voir ton satellite en orbite";
    const zone = root.querySelector("[data-sv-orbite-zone]");
    if (zone) {
      if (orbiteOuverte) { zone.hidden = false; (typeof requestAnimationFrame === "function" ? requestAnimationFrame : setTimeout)(() => zone.classList.add("ouvert")); }
      else { zone.classList.remove("ouvert"); setTimeout(() => { if (!orbiteOuverte) zone.hidden = true; }, 230); }
    }
    sig.systeme = null; // le prochain rendu reprendra l'état
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

  /* « Grouper par : Enveloppe ▾ » : un bouton de 44 px ; les cinq regroupements s'ouvrent dans une feuille (jamais une bascule sur deux rangées). */
  const libelleMode = id => (MODES.find(x => x.id === id) || MODES[0]).label;
  function renderMode() {
    const el = $("plMode"); if (!el) return;
    el.innerHTML = '<button type="button" class="pl-mode-btn" data-pl-mode aria-haspopup="dialog"><span class="pl-mode-k">Grouper par</span><span class="pl-mode-v">' + esc(libelleMode(mode)) + "</span>" + CHEVRON_RD + "</button>";
  }
  function ouvrirModes(el) {
    const u = U(); if (!u || !u.panneau) return;
    const check = '<svg class="ui-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    const liste = '<div class="pl-modes" role="radiogroup" aria-label="Regrouper les lignes">' + MODES.map(x => '<button type="button" class="pl-modes-o" role="radio" aria-checked="' + (x.id === mode) + '" aria-label="' + esc(x.aria) + '" data-pl-mode-choix="' + esc(x.id) + '">' +
      '<span class="pl-modes-t">' + esc(x.label) + '</span><span class="pl-modes-c" aria-hidden="true">' + (x.id === mode ? check : "") + "</span></button>").join("") + "</div>";
    const corps = u.panneau.ouvrir({ titre: "Grouper les lignes par", contenu: liste, retour: el });
    if (corps && corps.addEventListener) corps.addEventListener("click", e => {
      const b = e.target && e.target.closest ? e.target.closest("[data-pl-mode-choix]") : null; if (!b) return;
      mode = b.getAttribute("data-pl-mode-choix"); try { localStorage.setItem(CLE_MODE, mode); } catch (er) {}
      u.panneau.fermer(); renderMode(); if (S) render();
    });
  }

  function mount(r) {
    root = r;
    const u = U();
    if (!u) return;
    renderMode();
    $("plMode").addEventListener("click", e => { const b = e.target && e.target.closest ? e.target.closest("[data-pl-mode]") : null; if (b) ouvrirModes(b); });
    const sn = SN(); if (sn && typeof sn.abonner === "function") sn.abonner(histPrete); // fin d'une lecture du passé (déclenchée ici ou ailleurs)
    // Le bouton Claude de l'en-tête couvre les demandes de la page (enregistrer un mouvement, compléter) : plus de boutons Claude empilés ; seul l'état vide garde le sien.
    $("plVideClaude").innerHTML = u.demanderAClaude(phraseClaude("placements"), "Compléter avec Claude");
    u.brancher(root);
    root.addEventListener("click", e => {
      const t = e.target; if (!t || !t.closest) return;
      const ob = t.closest("[data-sv-orbite]"); if (ob) { basculerOrbite(ob); return; }
      const g = t.closest("[data-pl-groupe-btn]"); if (g) { basculerGroupe(g); return; }
      const l = t.closest("[data-pl-ligne]"); if (l) ouvrirLigne(l.getAttribute("data-pl-ligne"), l);
    });
  }
  function update(snap, visible) {
    S = snap;
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
