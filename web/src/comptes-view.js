/* Patrimoine › Comptes (module « comptes-view », spec docs/superpowers/specs/2026-10-12-cp1-comptes-performance-design.md § 2-4) :
   tous les comptes du foyer en un coup d'œil, puis une fiche en pleine page par compte. Lecture seule : le board lit, l'agent écrit.
   - En-tête : patrimoine net, financier, immobilier, dettes (Calc.patrimoine, périmètre S.scope) et variation sur 1 mois tirée des photos
     quotidiennes (S.snapshots : dernière photo vieille d'au moins 30 jours, comparée à la valeur du jour).
   - Quatre familles en blocs repliables (Comptes courants, Épargne disponible, Investissement, Dettes) : Calc.famille(position)
     (calc.js, même règle que le connecteur). Dans chaque bloc, les comptes sont groupés par établissement : compte bancaire rattaché (S.banque.comptes → connexion
     Powens), sinon mot-clé de l'enveloppe (Linxea, Binance…), sinon « Saisi à la main ». Une carte par enveloppe (épargne,
     investissement), par ligne (comptes courants) ou par crédit (dettes) : nom, solde, part du financier (ou des dettes), plus-value
     latente (qty × cours − qty × PRU) et pastille de source (« Synchronisé le JJ/MM » : position.sourceAuto powens / binance et
     sourceAutoLe, ou compte bancaire rattaché ; sinon « Saisi le JJ/MM » d'après valueDate). Chaque carte est un lien (lignes sans
     enveloppe : une seule → sa fiche ligne, plusieurs → carte sans lien). Doublon probable (Calc.doublonsProbables : ligne saisie qui
     recopie le total de son enveloppe) : alerte sous la carte et en tête de la fiche enveloppe, « Demander à Claude » de la clôturer.
   - Fiches en pleine page dans la même vue, avec fil d'Ariane et adresse profonde (la coque garde les paramètres dans l'URL,
     PARAMS_DANS_URL d'app.js) : #patrimoine/comptes?enveloppe=<nom>&titulaire=<p1|p2>, ?ligne=<id>, ?courant=<id de ligne>.
     · enveloppe : courbe « valeur de tes lignes actuelles » (quantités actuelles × cours historiques, liquidités et lignes saisies à
       valeur constante ; jamais remplie avant le premier cours connu, historique plus court que la période signalé) sur 1 M · 3 M ·
       1 A · 3 A · 5 A, plus-value latente et prix de revient totaux, répartition par classe, lignes triées par poids avec leur
       performance sur la période, et « Vraie performance » (corrigée des versements ; création, achat et vente comptés comme flux sans
       ligne de liquidités) : indisponible pour une enveloppe synchronisée (versements non suivis) ou partagée entre titulaires, en
       construction tant qu'il y a moins de 90 jours de photos (disponible le jour de la première photo + 90 jours).
     · ligne : courbe du cours avec le prix de revient en ligne horizontale, quantité, valeur, plus-value, frais / zone / devise,
       mouvements connus (S.tx), source et date, « Demander à Claude » vers l'expertise adaptée (actions, ETF et fonds, crypto).
     · compte courant : solde, entrées et sorties du mois et moyenne sur 6 mois du compte (S.banque.mois par compteId ; sans détail par
       compte : tous comptes connectés confondus, signalé), plus bas solde sur 90 jours reconstitué depuis le solde actuel et les
       opérations (Store.banque.operations, lues à l'ouverture), prélèvements récurrents détectés dans ces opérations (même libellé
       nettoyé, au moins deux mois) — « aucun » seulement avec au moins deux mois d'opérations — et graphique des entrées et sorties.
   - Cours historiques : Store.cours(isins, depuis) → { <isin>: [{ date, cloture }] }, lus à l'ouverture d'une fiche pour la période
     choisie d'abord (une période plus longue relit depuis son début) ; échec → phrase et « Réessayer » (rien de mémorisé) ; plafond
     du store → « historique tronqué » ; absents (table pas encore créée, démo sans série) → courbe remplacée par une phrase.
   Graphiques en SVG maison (style de pilotage.js et aujourdhui.js) : role="img", <title> et <desc> reliés par aria-labelledby /
   aria-describedby, et tableau des données dans un accordéon fermé.
   Fonctions pures exportées (module.exports, et window.ComptesView dans le navigateur pour app.js, pilotage.js et aujourdhui.js) :
   FAMILLES, PERIODES, famille, doublonsDe, plusBasSolde, prelevementsRecurrents, lien, lireCible, etablissement, sourceDe, comptes, entete, debutPeriode, serieEnveloppe,
   perfDepuis, vraiePerformance, expertiseDe, ficheEnveloppe, ficheLigne, ficheCourant, fluxMois, et les rendus HTML enteteHtml,
   famillesHtml, arianeHtml, ficheEnveloppeHtml, grapheEnveloppeHtml, ficheLigneHtml, grapheLigneHtml, ficheCourantHtml, courbeSvg,
   barresSvg, donneesHtml (UI reçu en paramètre quand il en faut ; aucune ne touche au DOM). Dépendances injectées (deps) :
   { Calc, ClaudePrompts }, window.* par défaut. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : glob(k));
  const voisin = f => (typeof module === "object" && module.exports && typeof require === "function" ? require(f) : null);
  const calcDe = deps => dep(deps, "Calc") || voisin("./calc.js");
  const promptsDe = deps => dep(deps, "ClaudePrompts") || voisin("./claude-prompts.js");

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
  const isoUtc = t => new Date(t).toISOString().slice(0, 10);
  const plusJours = (s, n) => isoUtc(utc(s) + n * 864e5);
  const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  /** s moins n mois (jour ramené au dernier jour du mois s'il n'existe pas). */
  function moinsMois(s, n) {
    const [y, m, d] = s.split("-").map(Number), t = new Date(Date.UTC(y, m - 1 - n, 1));
    const fin = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(d, fin));
    return isoUtc(t.getTime());
  }
  const dateFr = s => { const d = jj(s); return isoOk(d) ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : ""; };
  const dateCourte = s => { const d = jj(s); return isoOk(d) ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""; };
  /** « JJ/MM » d'une date ou d'un horodatage (heure locale pour un horodatage). */
  function jjmm(v) {
    if (!v) return "";
    const s = String(v);
    if (isoOk(s)) return s.slice(8, 10) + "/" + s.slice(5, 7);
    const x = new Date(s);
    return isFinite(x) ? pad(x.getDate()) + "/" + pad(x.getMonth() + 1) : "";
  }
  /** Jour local (AAAA-MM-JJ) d'une date ou d'un horodatage. */
  const jourDe = v => { const s = String(v || ""); return isoOk(s) ? s : s ? jour(s) : ""; };
  const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const moisLabel = s => { const d = jj(s); return isoOk(d) ? MOIS_COURTS[+d.slice(5, 7) - 1] + " " + d.slice(0, 4) : ""; };

  /* ---------- nombres et textes ---------- */
  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nfq = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 });
  const fini = v => v != null && v !== "" && isFinite(+v);
  const eur = v => (!fini(v) ? "—" : (Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €");
  const eurS = v => (!fini(v) ? "—" : (Math.round(v) > 0 ? "+" : Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €");
  const eur2 = v => (!fini(v) ? "—" : (v < 0 ? "−" : "") + nf2.format(Math.abs(v)) + " €");
  const pct = v => (!fini(v) ? "—" : nf1.format(v) + " %");
  const pctS = v => (!fini(v) ? "—" : (v > 0.05 ? "+" : v < -0.05 ? "−" : "") + nf1.format(Math.abs(v)) + " %");
  const pct0 = v => (!fini(v) ? "—" : (v > 0 && v < 1 ? "< 1" : nf0.format(v)) + " %");
  const kEur = v => (Math.abs(v) >= 1e6 ? nf1.format(v / 1e6) + " M€" : Math.abs(v) >= 1e3 ? nf0.format(v / 1e3) + " k€" : nf0.format(v) + " €");
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  const sansAccent = s => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const liste = v => (Array.isArray(v) ? v : []);

  /* ---------- personnes et positions ---------- */
  const DEFAULT_NOMS = { p1: "Moi", p2: "Conjoint(e)" };
  const scopeDe = S => (S && S.scope) || "foyer";
  const nomDe = (S, id) => { const p = liste(S && S.people).find(x => x.id === id); return (p && plat(p.nom)) || DEFAULT_NOMS[id] || plat(id) || ""; };
  const deuxPersonnes = S => liste(S && S.people).length > 1;
  const compte = p => !!p && p.status !== "à recevoir" && p.status !== "clôturé";
  const valeur = (p, C) => (C && typeof C.val === "function" ? C.val(p) : p.mode === "market" && p.qty != null && p.price != null ? p.qty * p.price : +(p.value || 0));
  const dansScope = (p, sc, C) => (C && typeof C.inScope === "function" ? C.inScope(p, sc) : sc === "foyer" || p.owner === sc);
  /** Plus-value latente d'une ligne cotée avec prix de revient : qty × cours − qty × PRU (null sinon). */
  const latente = p => (p && p.mode === "market" && fini(p.pru) && +p.pru > 0 && fini(p.qty) && fini(p.price) ? p.qty * p.price - p.qty * p.pru : null);
  const coutDe = p => (latente(p) != null ? p.qty * p.pru : null);

  /* ============================================================ familles ============================================================ */
  const FAMILLES = [
    { id: "courant", label: "Comptes courants", vide: "Aucun compte courant suivi." },
    { id: "epargne", label: "Épargne disponible", vide: "Aucun livret ni fonds monétaire." },
    { id: "investissement", label: "Investissement", vide: "Aucun placement d'investissement." },
    { id: "dettes", label: "Dettes", vide: "Aucun crédit en cours." },
  ];
  /** Famille d'une position : Calc.famille (calc.js, même règle que le connecteur) → courant | epargne | investissement. */
  function famille(p, deps) {
    const C = calcDe(deps);
    let f = null;
    try { f = C && typeof C.famille === "function" ? C.famille(p) : null; } catch (e) { f = null; }
    return f === "courant" || f === "epargne" ? f : "investissement";
  }

  /* ============================================================ liens ============================================================ */
  const ROUTE = "patrimoine/comptes";
  const titulaireOk = t => (t === "p1" || t === "p2" ? t : null);
  /** Fiche → route avec ses paramètres : { enveloppe, titulaire? } | { ligne } | { courant } → « patrimoine/comptes?… » ; autre → la liste. */
  function lien(cible) {
    const c = cible || {}, enc = encodeURIComponent;
    if (c.ligne != null && String(c.ligne) !== "") return ROUTE + "?ligne=" + enc(String(c.ligne));
    if (c.courant != null && String(c.courant) !== "") return ROUTE + "?courant=" + enc(String(c.courant));
    if (plat(c.enveloppe)) return ROUTE + "?enveloppe=" + enc(plat(c.enveloppe)) + (titulaireOk(c.titulaire) ? "&titulaire=" + c.titulaire : "");
    return ROUTE;
  }
  /** Paramètres du lien profond ({ enveloppe, titulaire } | { ligne } | { courant }, objet ou chaîne « a=b&… ») → vue
      { type: liste | enveloppe | ligne | courant, … }. Paramètres inconnus ou vides : la liste. */
  function lireCible(params) {
    let p = params || {};
    if (typeof p === "string") { const o = {}; try { new URLSearchParams(p).forEach((v, k) => { o[k] = v; }); } catch (e) { /* liste */ } p = o; }
    const v = k => (p[k] == null ? "" : String(p[k]));
    if (v("ligne")) return { type: "ligne", id: v("ligne") };
    if (v("courant")) return { type: "courant", id: v("courant") };
    if (plat(v("enveloppe"))) return { type: "enveloppe", enveloppe: plat(v("enveloppe")), titulaire: titulaireOk(v("titulaire")) };
    return { type: "liste" };
  }
  const cleVue = v => (!v || v.type === "liste" ? "liste" : v.type === "enveloppe" ? "enveloppe:" + v.enveloppe + ":" + (v.titulaire || "") : v.type + ":" + v.id);

  /* ============================================================ établissements et sources ============================================================ */
  /* Mots-clés d'établissement reconnus dans le nom d'une enveloppe (« PEA Boursorama », « Crypto (Binance) »). */
  const ETABLISSEMENTS = ["Linxea", "Binance", "Boursorama", "Fortuneo", "Revolut", "Trade Republic", "Degiro", "Bourse Direct", "Saxo", "Interactive Brokers",
    "Yomoni", "Nalo", "Ramify", "Goodvest", "Spirica", "Suravenir", "Generali", "Lucya", "Placement-direct", "Crédit Agricole", "BNP Paribas", "Société Générale",
    "LCL", "Caisse d'Épargne", "Banque Populaire", "Crédit Mutuel", "CIC", "La Banque Postale", "Hello bank", "BoursoBank", "ING", "Monabanq", "N26", "Shine", "Qonto",
    "Lydia", "Sumeria", "Coinbase", "Kraken", "Bitstack", "Bitpanda", "Natixis", "Amundi", "Epsor"];
  const RE_MOT = m => new RegExp("(^|[^a-z0-9])" + sansAccent(m).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ -]?") + "($|[^a-z0-9])");
  const banqueDe = S => (S && S.banque && S.banque.actif !== false ? S.banque : null);
  const MANUEL = "Saisi à la main";
  /** Comptes bancaires (S.banque.comptes, non ignorés) rattachés à une position : par sa ligne (positionId), sinon par son enveloppe et
      son titulaire. */
  function comptesBanque(p, S) {
    const b = banqueDe(S);
    if (!b || !p) return [];
    const cs = liste(b.comptes).filter(c => c && !c.ignore);
    const direct = cs.filter(c => c.positionId != null && String(c.positionId) === String(p.id));
    return direct.length ? direct : cs.filter(c => plat(c.enveloppe) && plat(c.enveloppe) === plat(p.envelope) && (!c.titulaire || c.titulaire === p.owner));
  }
  const connexionDe = (S, c) => { const b = banqueDe(S); return b && c ? liste(b.connexions).find(x => x && String(x.id) === String(c.connexionId)) || null : null; };
  /** Établissement d'une position (ou d'un groupe de positions) : compte bancaire rattaché → nom de sa connexion Powens ; sinon
      mot-clé de l'enveloppe ; sinon « Saisi à la main ». → { nom, origine: banque | mot_cle | manuel } */
  function etablissement(p, S) {
    const xs = Array.isArray(p) ? p : [p];
    for (const x of xs) for (const c of comptesBanque(x, S)) { const cx = connexionDe(S, c); if (cx && plat(cx.etablissement)) return { nom: plat(cx.etablissement), origine: "banque" }; }
    for (const x of xs) {
      const e = sansAccent(x && x.envelope);
      const m = ETABLISSEMENTS.find(k => RE_MOT(k).test(e));
      if (m) return { nom: m, origine: "mot_cle" };
    }
    return { nom: MANUEL, origine: "manuel" };
  }
  const SOURCES_AUTO = { powens: "Powens", binance: "Binance" };
  /** Pastille de source d'un groupe de lignes : synchronisé (sourceAuto powens / binance, date sourceAutoLe ; ou compte bancaire
      rattaché, date de dernière synchronisation de sa connexion), sinon saisi (date de valeur la plus récente).
      → { texte, ton: bon | neutre, date, origine: powens | binance | manuel } */
  function sourceDe(lignes, S) {
    const xs = liste(lignes).filter(Boolean);
    const auto = xs.filter(p => SOURCES_AUTO[p.sourceAuto]);
    if (auto.length) {
      const d = auto.map(p => String(p.sourceAutoLe || "")).filter(Boolean).sort().pop() || "";
      return { texte: "Synchronisé" + (jjmm(d) ? " le " + jjmm(d) : ""), ton: "bon", date: jourDe(d), origine: auto[auto.length - 1].sourceAuto };
    }
    const cxs = xs.flatMap(p => comptesBanque(p, S)).map(c => connexionDe(S, c)).filter(Boolean);
    if (cxs.length) {
      const d = cxs.map(c => String(c.derniereSynchro || "")).filter(Boolean).sort().pop() || "";
      return { texte: "Synchronisé" + (jjmm(d) ? " le " + jjmm(d) : ""), ton: "bon", date: jourDe(d), origine: "powens" };
    }
    const d = xs.map(p => jj(p.valueDate)).filter(isoOk).sort().pop() || "";
    return { texte: d ? "Saisi le " + jjmm(d) : MANUEL, ton: "neutre", date: d, origine: "manuel" };
  }

  /* ============================================================ doublons probables ============================================================ */
  /** Lignes qui recopient probablement le total de leur enveloppe (Calc.doublonsProbables, toutes les lignes du foyer) ; [] sans Calc. */
  function doublonsDe(S, deps) {
    const C = calcDe(deps);
    try { return C && typeof C.doublonsProbables === "function" ? liste(C.doublonsProbables(liste(S && S.positions))) : []; } catch (e) { return []; }
  }
  /** Phrase « Demander à Claude » pour clôturer une ligne en doublon (ClaudePrompts, section placements). */
  function phraseDoublon(d) {
    const P = promptsDe(), ctx = "clôturer la ligne « " + d.nom + " » de mon enveloppe " + d.enveloppe + ", qui semble recopier son total";
    return P && typeof P.phrase === "function" ? P.phrase("placements", ctx) : "Boussole : aide-moi à " + ctx + ".";
  }
  const texteDoublon = d => "La ligne « " + d.nom + " » semble recopier le total de ton enveloppe : ton patrimoine est peut-être compté deux fois. Demande à Claude de la clôturer.";

  /* ============================================================ comptes (liste) ============================================================ */
  /** Comptes du périmètre, par famille puis par établissement.
      → { familles: [{ id, label, vide, total, part, etablissements: [{ nom, origine, comptes: [carte] }], nb }], financier, dettes }
      carte = { cle, type: enveloppe | courant | dette, nom, sous, solde, part, plusValue, cout, source, href, nb, titulaire } */
  function comptes(S, today, deps) {
    const C = calcDe(deps), s = S || {}, sc = scopeDe(s);
    const ps = liste(s.positions).filter(p => p && compte(p) && dansScope(p, sc, C));
    const financier = sum(ps, p => valeur(p, C));
    const cartes = { courant: [], epargne: [], investissement: [], dettes: [] };
    const groupes = new Map();
    ps.forEach(p => {
      const f = famille(p, deps);
      if (f === "courant") { cartes.courant.push({ type: "courant", lignes: [p] }); return; }
      const k = f + "|" + plat(p.envelope) + "|" + (p.owner || "");
      if (!groupes.has(k)) { groupes.set(k, { type: "enveloppe", famille: f, lignes: [] }); cartes[f].push(groupes.get(k)); }
      groupes.get(k).lignes.push(p);
    });
    const avecNom = deuxPersonnes(s) && sc === "foyer";
    const dbl = doublonsDe(s, deps);
    const carte = g => {
      const p0 = g.lignes[0], solde = sum(g.lignes, p => valeur(p, C)), lat = g.lignes.map(latente).filter(v => v != null);
      const sansEnv = !plat(p0.envelope), env = plat(p0.envelope) || "Sans enveloppe";
      const nom = g.type === "courant" ? plat(p0.name) || env : env;
      const sous = [g.type === "courant" && env !== nom ? env : g.type === "enveloppe" ? pluriel(g.lignes.length, "ligne") : "", avecNom ? nomDe(s, p0.owner) : ""].filter(Boolean).join(" · ");
      // Lignes sans enveloppe : pas de fiche « Sans enveloppe » (elle n'existe pas) ; une seule ligne → sa fiche, plusieurs → pas de lien.
      const cible = g.type === "courant" ? { courant: p0.id } : sansEnv ? (g.lignes.length === 1 ? { ligne: p0.id } : null) : { enveloppe: env, titulaire: p0.owner };
      const doublons = sansEnv ? [] : dbl.filter(d => g.lignes.some(p => String(p.id) === String(d.ligne))).map(d => ({ ligne: d.ligne, nom: plat(d.nom) || "sans nom", enveloppe: d.enveloppe }));
      return { cle: g.type === "courant" ? "courant:" + p0.id : "enveloppe:" + env + ":" + (p0.owner || ""), type: g.type, nom, sous, solde,
        part: financier ? solde / financier * 100 : 0, plusValue: lat.length ? sum(lat, v => v) : null, cout: lat.length ? sum(g.lignes.map(coutDe).filter(v => v != null), v => v) : null,
        source: sourceDe(g.lignes, s), href: cible ? "#" + lien(cible) : null, nb: g.lignes.length, titulaire: p0.owner || null, etablissement: etablissement(g.lignes, s), doublons };
    };
    // Dettes : crédits immobiliers (capital restant dû des biens) et autres crédits du profil, à la quote-part du périmètre.
    const pr = s.profil || {}, part = (sc2, x) => (C && typeof C.part === "function" ? C.part(sc2, x) : 1), partCr = (sc2, o) => (C && typeof C.partCredit === "function" ? C.partCredit(sc2, o) : 1);
    const dettes = [];
    liste(pr.biens).forEach(b => { const m = (+b.crd || 0) * part(sc, b.part_p1); if (m > 0) dettes.push({ id: b.id, nom: "Prêt · " + (plat(b.nom) || "Bien"), montant: m, credit: null }); });
    liste(pr.credits).forEach(c => { const m = (+c.crd || 0) * partCr(sc, c.owner); if (m > 0) dettes.push({ id: c.id, nom: plat(c.nom) || "Crédit", montant: m, credit: c }); });
    const totalDettes = sum(dettes, d => d.montant);
    const b = banqueDe(s);
    const carteDette = d => {
      const cpt = b && d.id != null ? liste(b.comptes).find(c => c && !c.ignore && c.creditId != null && String(c.creditId) === String(d.id)) : null;
      const cx = cpt ? connexionDe(s, cpt) : null, dt = cx && cx.derniereSynchro;
      return { cle: "dette:" + d.id, type: "dette", nom: d.nom, sous: d.credit && avecNom ? (d.credit.owner === "commun" ? "Commun" : nomDe(s, d.credit.owner)) : "",
        solde: -d.montant, part: totalDettes ? d.montant / totalDettes * 100 : 0, plusValue: null, cout: null,
        source: cx ? { texte: "Synchronisé" + (jjmm(dt) ? " le " + jjmm(dt) : ""), ton: "bon", date: jourDe(dt), origine: "powens" } : { texte: MANUEL, ton: "neutre", date: "", origine: "manuel" },
        href: "#patrimoine/immobilier", nb: 1, titulaire: null, etablissement: cx && plat(cx.etablissement) ? { nom: plat(cx.etablissement), origine: "banque" } : { nom: MANUEL, origine: "manuel" }, doublons: [] };
    };
    const familles = FAMILLES.map(F => {
      const cs = F.id === "dettes" ? dettes.map(carteDette) : cartes[F.id].map(carte);
      cs.sort((a, b2) => Math.abs(b2.solde) - Math.abs(a.solde) || a.nom.localeCompare(b2.nom, "fr"));
      const etabs = new Map();
      cs.forEach(c => { const k = c.etablissement.nom; if (!etabs.has(k)) etabs.set(k, { nom: k, origine: c.etablissement.origine, comptes: [] }); etabs.get(k).comptes.push(c); });
      const es = [...etabs.values()].sort((a, b2) => (a.nom === MANUEL) - (b2.nom === MANUEL) || Math.abs(sum(b2.comptes, c => c.solde)) - Math.abs(sum(a.comptes, c => c.solde)));
      const total = sum(cs, c => c.solde);
      return Object.assign({}, F, { total, part: F.id === "dettes" ? null : financier ? total / financier * 100 : 0, etablissements: es, nb: cs.length });
    });
    return { familles, financier, dettes: totalDettes };
  }

  /** En-tête : { net, financier, immobilier, dettes, autres, variation: { montant, pct, depuis } | null } (Calc.patrimoine du périmètre ;
      variation = valeur du jour − dernière photo vieille d'au moins 30 jours, immobilier et dettes supposés inchangés). */
  function entete(S, today, deps) {
    const C = calcDe(deps), s = S || {}, sc = scopeDe(s), t = jour(today);
    const pat = C && typeof C.patrimoine === "function" ? C.patrimoine(liste(s.positions), s.profil || null, sc)
      : { financier: sum(liste(s.positions).filter(p => compte(p) && dansScope(p, sc, C)), p => valeur(p, C)), immobilier: 0, usage: 0, entreprise: 0, dettes: 0, net: 0 };
    const limite = plusJours(t, -30);
    const ref = liste(s.snapshots).filter(x => x && fini(x[sc]) && isoOk(jj(x.date)) && jj(x.date) <= limite).sort((a, b) => (jj(a.date) < jj(b.date) ? -1 : 1)).pop();
    const variation = ref ? { montant: pat.financier - +ref[sc], pct: +ref[sc] ? (pat.financier - +ref[sc]) / +ref[sc] * 100 : null, depuis: jj(ref.date) } : null;
    return { net: pat.net, financier: pat.financier, immobilier: pat.immobilier, autres: (pat.usage || 0) + (pat.entreprise || 0), dettes: pat.dettes, variation };
  }

  /* ============================================================ séries et performances ============================================================ */
  const PERIODES = [
    { id: "1m", label: "1 M", aria: "1 mois", mois: 1, txt: "sur 1 mois" },
    { id: "3m", label: "3 M", aria: "3 mois", mois: 3, txt: "sur 3 mois" },
    { id: "1a", label: "1 A", aria: "1 an", mois: 12, txt: "sur 1 an" },
    { id: "3a", label: "3 A", aria: "3 ans", mois: 36, txt: "sur 3 ans" },
    { id: "5a", label: "5 A", aria: "5 ans", mois: 60, txt: "sur 5 ans" },
  ];
  const periodeDe = id => PERIODES.find(p => p.id === id) || PERIODES[2];
  /** Premier jour de la période (1m | 3m | 1a | 3a | 5a) qui finit aujourd'hui. */
  const debutPeriode = (id, today) => moinsMois(jour(today), periodeDe(id).mois);
  /** Cours connus d'un ISIN, triés et valides. */
  const coursDe = (cours, isin) => liste(cours && isin ? cours[isin] : null).filter(c => c && isoOk(jj(c.date)) && fini(c.cloture) && +c.cloture > 0)
    .map(c => ({ date: jj(c.date), cloture: +c.cloture })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  /** Ne garde qu'au plus n points (premier et dernier compris), à pas régulier. */
  function echantillon(pts, n) {
    if (pts.length <= n) return pts;
    const pas = (pts.length - 1) / (n - 1), out = [];
    for (let i = 0; i < n; i++) out.push(pts[Math.round(i * pas)]);
    return out;
  }
  /** Valeur des lignes actuelles d'une enveloppe dans le passé : Σ quantité actuelle × cours historique (dernier cours connu à la date)
      + lignes saisies et lignes cotées sans historique à leur valeur du jour (constante). Un point par jour de cotation dans
      [debut, today], à partir du jour où toutes les lignes historisées ont un cours (jamais de remplissage avant le premier cours
      connu d'une ligne), plus le point du jour (valeurs du jour). partiel : l'historique commence plus d'une semaine après le début
      de la période (à signaler : la courbe est plus courte que la période).
      → { points: [{ date, valeur }], constantes, sansHistorique: [noms], historiqueDepuis (AAAA-MM-JJ | null), partiel } */
  function serieEnveloppe(lignes, cours, debut, today, deps) {
    const C = calcDe(deps), t = jour(today), d0 = jj(debut);
    const ls = liste(lignes).filter(compte);
    const cotees = ls.filter(p => p.mode === "market" && fini(p.qty) && p.isin).map(p => ({ p, h: coutsFiltres(coursDe(cours, p.isin), t) }));
    const avec = cotees.filter(x => x.h.length), sans = cotees.filter(x => !x.h.length);
    const constantes = sum(ls.filter(p => !avec.some(x => x.p === p)), p => valeur(p, C));
    const out = { points: [], constantes, sansHistorique: sans.map(x => plat(x.p.name)), historiqueDepuis: null, partiel: false };
    if (!avec.length) return out;
    const connu = avec.map(x => x.h[0].date).sort().pop(); // premier jour où toutes les lignes historisées ont un cours
    out.historiqueDepuis = connu;
    out.partiel = isoOk(d0) && connu > plusJours(d0, 7);
    const dates = [...new Set(avec.flatMap(x => x.h.map(c => c.date)).filter(d => d >= d0 && d >= connu && d < t))].sort();
    const idx = avec.map(() => 0);
    dates.forEach(d => {
      let v = constantes;
      avec.forEach((x, k) => {
        while (idx[k] + 1 < x.h.length && x.h[idx[k] + 1].date <= d) idx[k]++;
        v += x.p.qty * x.h[idx[k]].cloture;
      });
      out.points.push({ date: d, valeur: v });
    });
    out.points.push({ date: t, valeur: sum(ls, p => valeur(p, C)), live: true });
    return out;
  }
  const coutsFiltres = (h, t) => h.filter(c => c.date <= t);
  /** Performance d'un cours depuis `debut` jusqu'au prix du jour : dernier cours connu au début de la période (sinon le premier de la
      période) → prix ; en %, ou null sans historique. */
  function perfDepuis(cours, isin, debut, prix) {
    const h = coursDe(cours, isin), d0 = jj(debut);
    if (!h.length || !fini(prix) || +prix <= 0) return null;
    const avant = h.filter(c => c.date <= d0).pop(), base = avant || h.find(c => c.date >= d0);
    return base ? (+prix / base.cloture - 1) * 100 : null;
  }

  /** « Vraie performance » d'une enveloppe, corrigée des versements (Dietz modifié sur les photos quotidiennes by_envelope et les
      mouvements S.tx). Flux : versements et versements programmés entrent, retraits sortent ; si l'enveloppe n'a pas de ligne de
      liquidités (poche monétaire, ou ligne « Espèces » / « Liquidités » / « Cash »), les créations de ligne et les achats entrent aussi
      et les ventes sortent (l'argent ne transite par aucune ligne suivie).
      Indisponible : enveloppe synchronisée (une ligne source_auto : ses versements ne sont pas des mouvements Boussole) → non_suivi ;
      plusieurs titulaires pour ce nom d'enveloppe (by_envelope mélange leurs lignes) → titulaires. Moins de 90 jours de photos →
      en construction.
      → { etat: non_suivi } | { etat: titulaires } | { etat: construction, dispoLe } | { etat: indisponible } | { etat: ok, gain, pct, depuis, jusquA, flux } */
  function vraiePerformance(S, nomEnv, lignes, today, deps) {
    const s = S || {}, t = jour(today), env = plat(nomEnv), C = calcDe(deps), ls = liste(lignes).filter(Boolean);
    if (ls.some(p => SOURCES_AUTO[p.sourceAuto])) return { etat: "non_suivi" };
    const titulaires = new Set(liste(s.positions).filter(p => p && plat(p.envelope) === env).map(p => p.owner || ""));
    if (titulaires.size > 1) return { etat: "titulaires" };
    const snaps = liste(s.snapshots).filter(x => x && isoOk(jj(x.date))).sort((a, b) => (jj(a.date) < jj(b.date) ? -1 : 1));
    if (!snaps.length) return { etat: "construction", dispoLe: plusJours(t, 90) };
    const dispoLe = plusJours(jj(snaps[0].date), 90);
    if (t < dispoLe) return { etat: "construction", dispoLe };
    const avecEnv = snaps.filter(x => x.byEnvelope && fini(x.byEnvelope[env]));
    if (avecEnv.length < 2) return { etat: "indisponible" };
    const a = avecEnv[0], z = avecEnv[avecEnv.length - 1], d0 = jj(a.date), d1 = jj(z.date), duree = joursEntre(d0, d1);
    if (duree <= 0) return { etat: "indisponible" };
    const ids = new Set(ls.map(p => String(p.id)));
    const estLiquidite = p => p.status !== "clôturé" && ((C && typeof C.classe === "function" && C.classe(p.bloc, s.classes || undefined) === "monetaire") ||
      /liquidites?|especes|\bcash\b/.test(sansAccent(p.name)));
    const SIGNE = ls.some(estLiquidite) ? { versement: 1, programme: 1, retrait: -1 } : { versement: 1, programme: 1, retrait: -1, creation: 1, achat: 1, vente: -1 };
    const montant = x => (fini(x.amount) && +x.amount ? Math.abs(+x.amount) : fini(x.qty) && fini(x.price) ? Math.abs(x.qty * x.price) : null);
    const flux = liste(s.tx).filter(x => x && ids.has(String(x.positionId)) && SIGNE[x.type] && montant(x) != null && jj(x.date) > d0 && jj(x.date) <= d1)
      .map(x => ({ montant: SIGNE[x.type] * montant(x), poids: joursEntre(jj(x.date), d1) / duree }));
    const v0 = +a.byEnvelope[env], v1 = +z.byEnvelope[env], net = sum(flux, f => f.montant);
    const gain = v1 - v0 - net, base = v0 + sum(flux, f => f.montant * f.poids);
    return { etat: "ok", gain, pct: base > 0 ? gain / base * 100 : null, depuis: d0, jusquA: d1, flux: net };
  }

  /* ============================================================ fiches ============================================================ */
  const EXPERTISES = { actions: "Actions et marchés", "etf-fonds": "ETF et fonds", crypto: "Crypto-actifs", "taux-obligations": "Taux, obligations et fonds euros" };
  /** Expertise adaptée à une ligne : crypto (classe crypto ou ISIN X-…), ETF et fonds (nom de fonds, ISIN IE / LU, ligne saisie hors
      fonds euros), taux et fonds euros (fonds en euros, obligations), sinon actions. → { slug, nom } (nom publié lu dans S.expertises). */
  function expertiseDe(p, S, deps) {
    const C = calcDe(deps), x = p || {}, n = sansAccent(x.name), cl = C && typeof C.classe === "function" ? C.classe(x.bloc, (S && S.classes) || undefined) : "";
    let slug = "actions";
    if (cl === "crypto" || /^X-/i.test(String(x.isin || ""))) slug = "crypto";
    else if (/fonds (en )?euros?/.test(n) || cl === "fonds_euros" || cl === "obligations") slug = "taux-obligations";
    else if (/\betf\b|tracker|fonds|fund|sicav|fcp|opcvm|ucits|index/.test(n) || /^(IE|LU)/i.test(String(x.isin || "")) || x.mode !== "market") slug = "etf-fonds";
    const pub = liste(S && S.expertises).find(e => e && e.slug === slug);
    return { slug, nom: (pub && plat(pub.nom)) || EXPERTISES[slug] };
  }

  const repartition = (lignes, S, deps) => {
    const C = calcDe(deps), by = {}, total = sum(lignes, p => valeur(p, C)) || 1;
    lignes.forEach(p => { const k = C && typeof C.classe === "function" ? C.classe(p.bloc, (S && S.classes) || undefined) : "autres"; by[k] = (by[k] || 0) + valeur(p, C); });
    const L = (C && C.CLASSES_LABELS) || {};
    return Object.keys(by).map(k => ({ cle: k, label: L[k] || k, montant: by[k], pct: by[k] / total * 100 })).sort((a, b) => b.montant - a.montant);
  };
  const lignesEnveloppe = (S, env, titulaire) => liste(S && S.positions).filter(p => p && p.status !== "clôturé" && plat(p.envelope) === plat(env) && (!titulaire || p.owner === titulaire));

  /** Fiche enveloppe : { trouvee, nom, titulaire, sous, lignes (triées par poids : { p, valeur, poids, plusValue, plusValuePct, href }),
      total, plusValue, cout, repartition, source, etablissement, isins, vraie } */
  function ficheEnveloppe(S, cible, today, deps) {
    const C = calcDe(deps), s = S || {}, c = cible || {}, t = jour(today);
    const toutes = lignesEnveloppe(s, c.enveloppe, c.titulaire), ls = toutes.filter(compte);
    if (!toutes.length) return { trouvee: false, nom: plat(c.enveloppe) };
    const total = sum(ls, p => valeur(p, C));
    const lignes = ls.map(p => { const g = latente(p); return { p, valeur: valeur(p, C), poids: total ? valeur(p, C) / total * 100 : 0, plusValue: g, plusValuePct: g != null ? (p.price / p.pru - 1) * 100 : null, href: "#" + lien({ ligne: p.id }) }; })
      .sort((a, b) => b.valeur - a.valeur || plat(a.p.name).localeCompare(plat(b.p.name), "fr"));
    const lat = ls.map(latente).filter(v => v != null);
    const owners = [...new Set(toutes.map(p => p.owner).filter(Boolean))];
    return { trouvee: true, nom: plat(c.enveloppe), titulaire: c.titulaire || (owners.length === 1 ? owners[0] : null),
      sous: [famLabel(famille(toutes[0], deps)), (c.titulaire || owners.length === 1) && deuxPersonnes(s) ? nomDe(s, c.titulaire || owners[0]) : ""].filter(Boolean).join(" · "),
      lignes, total, plusValue: lat.length ? sum(lat, v => v) : null, cout: lat.length ? sum(ls.map(coutDe).filter(v => v != null), v => v) : null,
      repartition: repartition(ls, s, deps), source: sourceDe(toutes, s), etablissement: etablissement(toutes, s),
      isins: [...new Set(ls.filter(p => p.mode === "market" && p.isin).map(p => String(p.isin)))], aRecevoir: toutes.filter(p => p.status === "à recevoir").map(p => plat(p.name)),
      vraie: vraiePerformance(s, c.enveloppe, toutes, t, deps),
      doublons: doublonsDe(s, deps).filter(d => toutes.some(p => String(p.id) === String(d.ligne))).map(d => ({ ligne: d.ligne, nom: plat(d.nom) || "sans nom", enveloppe: d.enveloppe })) };
  }
  const famLabel = id => (FAMILLES.find(f => f.id === id) || {}).label || "";

  const TYPE_TX = { achat: "Achat", vente: "Vente", versement: "Versement", retrait: "Retrait", solde: "Nouveau solde", programme: "Versement programmé", creation: "Nouvelle ligne" };
  /** Fiche ligne : { trouvee, p, nom, sous, valeur, poidsEnveloppe, plusValue, plusValuePct, cout, faits: [[l, v]], mouvements, source,
      expertise, enveloppeHref, isin } */
  function ficheLigne(S, id, today, deps) {
    const C = calcDe(deps), s = S || {}, p = liste(s.positions).find(x => x && String(x.id) === String(id));
    if (!p) return { trouvee: false };
    const v = valeur(p, C), env = plat(p.envelope), freres = lignesEnveloppe(s, env, p.owner).filter(compte), tot = sum(freres, x => valeur(x, C));
    const g = latente(p), faits = [];
    if (p.mode === "market") {
      faits.push(["Cours", fini(p.price) ? eur2(+p.price) + (dateFr(p.priceDate) ? " · " + dateFr(p.priceDate) : "") : "à récupérer (ce soir par l'agent)"]);
      faits.push(["Quantité", fini(p.qty) ? nfq.format(+p.qty) + (p.qtyEstimated ? " (estimée)" : "") : "—"]);
      faits.push(["Prix de revient unitaire (PRU)", fini(p.pru) && +p.pru > 0 ? eur2(+p.pru) : "non renseigné"]);
      if (g != null) faits.push(["Prix de revient total", eur(p.qty * p.pru)]);
    } else {
      faits.push(["Valeur saisie", eur(v)]);
      faits.push(["Valeur relevée le", dateFr(p.valueDate) || "—"]);
    }
    faits.push(["Frais courants", fini(p.ter) ? nf2.format(+p.ter) + " % par an" : "non renseignés"]);
    faits.push(["Zone", plat(p.zone) || "non renseignée"]);
    faits.push(["Devise", plat(p.devise) || "non renseignée"]);
    if (p.isin) faits.push(["ISIN", plat(p.isin)]);
    if (p.annoteSource) faits.push(["Source des frais, de la zone et de la devise", plat(p.annoteSource) + (dateFr(p.annoteLe) ? ", relevé le " + dateFr(p.annoteLe) : "")]);
    const mouvements = liste(s.tx).filter(x => x && String(x.positionId) === String(p.id)).slice()
      .sort((a, b) => (String(b.date) + String(b.createdAt || "")) > (String(a.date) + String(a.createdAt || "")) ? 1 : -1)
      .map(x => ({ type: TYPE_TX[x.type] || plat(x.type), date: jj(x.date), qty: fini(x.qty) && +x.qty ? +x.qty : null, price: fini(x.price) ? +x.price : null,
        montant: fini(x.amount) ? +x.amount : null, note: plat(x.note), agent: x.source === "agent" || x.source === "nightly" }));
    return { trouvee: true, p, nom: plat(p.name) || "Ligne sans nom", sous: [env, plat(p.bloc), deuxPersonnes(s) ? nomDe(s, p.owner) : ""].filter(Boolean).join(" · "),
      valeur: v, poidsEnveloppe: tot && compte(p) ? v / tot * 100 : null, plusValue: g, plusValuePct: g != null ? (p.price / p.pru - 1) * 100 : null, cout: coutDe(p),
      faits, mouvements, source: sourceDe([p], s), expertise: expertiseDe(p, s, deps), enveloppe: env, titulaire: p.owner || null,
      enveloppeHref: "#" + lien({ enveloppe: env, titulaire: p.owner }), isin: p.mode === "market" && p.isin ? String(p.isin) : null, statut: p.status };
  }

  /* Compte d'une ligne de banque_mois (compteId ; 0 = totaux par utilisateur, comme sans compte). */
  const idMois = m => (m && m.compteId != null && +m.compteId !== 0 ? String(m.compteId) : null);
  /** Flux par mois (S.banque.mois, toutes catégories) → [{ mois: AAAA-MM-01, entrees, sorties }], du plus ancien. compteIds (facultatif) :
      seules les lignes de ces comptes (banque_mois détaillé par compte) ; absent : toutes les lignes. */
  function fluxMois(S, compteIds) {
    const b = banqueDe(S), by = new Map(), ids = Array.isArray(compteIds) ? new Set(compteIds.map(String)) : null;
    liste(b && b.mois).forEach(m => {
      const k = jj(m && m.mois).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(k) || (ids && !ids.has(idMois(m)))) return;
      const x = by.get(k) || { mois: k + "-01", entrees: 0, sorties: 0 };
      x.entrees += +m.entrees || 0; x.sorties += +m.sorties || 0;
      by.set(k, x);
    });
    return [...by.values()].sort((a, c) => (a.mois < c.mois ? -1 : 1));
  }

  /** Libellé nettoyé d'une opération (même règle que cleLibelle du connecteur, banque.ts) : minuscules, sans accents, sans chiffres
      ni ponctuation, espaces réduits. */
  const cleLibelle = t => sansAccent(t).replace(/[^a-z]+/g, " ").trim();
  const JOURS_HISTO = 90, LIBELLE_MAX = 40;
  /** Plus bas solde de fin de journée sur les 90 derniers jours, reconstitué à rebours depuis le solde actuel et les opérations
      (solde de la veille = solde du jour − opérations du jour). → { montant, date, depuis, complet } ; complet : les opérations couvrent
      la fenêtre (première opération dans les 10 premiers jours) ; null sans opération. */
  function plusBasSolde(solde, ops, today) {
    const t = jour(today), debut = plusJours(t, -JOURS_HISTO);
    const L = liste(ops).filter(o => o && isoOk(jj(o.date)) && fini(o.montant) && jj(o.date) <= t);
    if (!L.length || !fini(solde)) return null;
    const parJour = new Map();
    L.forEach(o => { const d = jj(o.date); parJour.set(d, (parJour.get(d) || 0) + +o.montant); });
    const premiere = L.map(o => jj(o.date)).sort()[0], depuis = premiere > debut ? plusJours(premiere, -1) : debut;
    let b = +solde, min = { montant: b, date: t };
    for (let d = t; d > depuis; d = plusJours(d, -1)) {
      b -= parJour.get(d) || 0; // solde à la fin de la veille
      if (b < min.montant - 1e-9) min = { montant: b, date: plusJours(d, -1) };
    }
    return { montant: Math.round(min.montant * 100) / 100, date: min.date, depuis, complet: premiere <= plusJours(debut, 10) };
  }
  /** Prélèvements récurrents détectés dans les opérations (90 jours) : débits de même libellé nettoyé, présents au moins 2 mois
      distincts, au plus 2 fois par mois en moyenne et de montants proches (le plus fort ≤ 1,5 × le plus faible) — les paiements par carte
      répétés chez un même commerçant ne sont pas des prélèvements. → [{ libelle, montant (moyen, positif), jour (du dernier), mois }] triés
      par montant décroissant. */
  function prelevementsRecurrents(ops, today) {
    const t = jour(today), debut = plusJours(t, -JOURS_HISTO), g = new Map();
    liste(ops).filter(o => o && isoOk(jj(o.date)) && jj(o.date) > debut && jj(o.date) <= t && fini(o.montant) && +o.montant < 0 && cleLibelle(o.libelle))
      .forEach(o => { const k = cleLibelle(o.libelle); if (!g.has(k)) g.set(k, []); g.get(k).push(o); });
    const out = [];
    g.forEach((L, k) => {
      const mois = new Set(L.map(o => jj(o.date).slice(0, 7))).size, m = L.map(o => Math.abs(+o.montant));
      if (mois < 2 || L.length > 2 * mois || Math.max(...m) > 1.5 * Math.min(...m)) return;
      const dernier = L.map(o => jj(o.date)).sort().pop();
      out.push({ libelle: k.slice(0, LIBELLE_MAX).trim(), montant: sum(m, v => v) / m.length, jour: +dernier.slice(8, 10), mois });
    });
    return out.sort((a, b) => b.montant - a.montant || a.libelle.localeCompare(b.libelle, "fr"));
  }
  /** Fiche compte courant. ops : opérations des comptes bancaires rattachés (Store.banque.operations) — tableau une fois lues, "chargement"
      pendant la lecture, "indisponible" en échec, undefined si rien n'est demandé.
      → { trouvee, p, nom, sous, solde, source, etablissement, connecte, banqueActive, compteIds, portee: compte | tous | aucun,
          flux: { mois, enCours, moyenne: { entrees, sorties, n } }, operations: ok | chargement | indisponible | aucune,
          plusBas: { montant, date, depuis, complet } | null, prelevements: [...], historiqueCourt } */
  function ficheCourant(S, id, today, deps, ops) {
    const C = calcDe(deps), s = S || {}, p = liste(s.positions).find(x => x && String(x.id) === String(id));
    if (!p) return { trouvee: false };
    const t = jour(today), mm = t.slice(0, 7), b = banqueDe(s), cpts = comptesBanque(p, s), compteIds = cpts.map(c => String(c.id));
    // banque_mois détaillé par compte (0025) : flux de ce compte seulement ; sinon totaux de tous les comptes connectés (signalé).
    const parCompte = liste(b && b.mois).some(m => idMois(m) != null);
    const portee = !parCompte ? "tous" : cpts.length ? "compte" : "aucun";
    const fs = portee === "tous" ? fluxMois(s) : fluxMois(s, portee === "compte" ? compteIds : []);
    const enCours = fs.find(f => f.mois.slice(0, 7) === mm) || null;
    const complets = fs.filter(f => f.mois.slice(0, 7) < mm).slice(-6);
    const moyenne = complets.length ? { entrees: sum(complets, f => f.entrees) / complets.length, sorties: sum(complets, f => f.sorties) / complets.length, n: complets.length } : null;
    const soldes = cpts.map(c => c.solde), solde = valeur(p, C);
    const soldeBanque = soldes.length && soldes.every(fini) ? sum(soldes, v => +v) : solde;
    const etatOps = !cpts.length ? "aucune" : Array.isArray(ops) ? "ok" : ops === "indisponible" ? "indisponible" : "chargement";
    const L = Array.isArray(ops) ? ops.filter(o => o && compteIds.includes(String(o.compteId))) : [];
    const premiere = L.map(o => jj(o.date)).filter(isoOk).sort()[0] || null;
    const court = etatOps === "ok" && (!premiere || premiere > plusJours(t, -55)); // moins de deux mois d'opérations : rien de fiable
    return { trouvee: true, p, nom: plat(p.name) || "Compte courant", sous: [plat(p.envelope), deuxPersonnes(s) ? nomDe(s, p.owner) : ""].filter(Boolean).join(" · "),
      solde, source: sourceDe([p], s), etablissement: etablissement(p, s), connecte: !!(b && b.actif && cpts.length), banqueActive: !!(b && b.actif), compteIds, portee,
      flux: { mois: fs.slice(-6), enCours, moyenne }, operations: etatOps,
      plusBas: etatOps === "ok" ? plusBasSolde(soldeBanque, L, t) : null,
      prelevements: etatOps === "ok" && !court ? prelevementsRecurrents(L, t) : [], historiqueCourt: court };
  }

  /* ============================================================ graphiques SVG ============================================================ */
  const larg = s => Math.max(40, Math.ceil(String(s ?? "").length * 6.8));
  /** Courbe SVG accessible. points = [{ date, valeur, live? }] ; o = { id, titre, desc, largeur, format(v) → texte d'axe, formatPoint(v),
      ref: { valeur, label } (ligne horizontale) }. Moins de deux points → null. */
  function courbeSvg(points, o) {
    const opt = o || {}, rows = liste(points).filter(p => p && isoOk(p.date) && fini(p.valeur));
    if (rows.length < 2) return null;
    const fp = opt.formatPoint || eur, id = esc(opt.id || "cv-g");
    const W = Math.max(300, Math.min(1000, Math.round(+opt.largeur) || 720)), H = W < 480 ? 190 : 220, L = 62, R = 14, T = 16, B = 28;
    const ts = rows.map(p => utc(p.date)), x0 = ts[0], x1 = ts[ts.length - 1];
    const vals = rows.map(p => p.valeur).concat(opt.ref && fini(opt.ref.valeur) ? [+opt.ref.valeur] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const marge = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
    lo = lo >= 0 ? Math.max(0, lo - marge) : lo - marge; hi += marge;
    const X = x => L + (x1 === x0 ? 0 : (x - x0) / (x1 - x0)) * (W - L - R), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    // graduations : une décimale en k€ quand l'écart est faible, pour ne pas répéter la même étiquette (comme pilotage.js)
    const fin1 = (hi - lo) / 3 < 2000, fmt = opt.format || (v => (fin1 && Math.abs(v) >= 1e3 && Math.abs(v) < 1e6 ? nf1.format(v / 1e3) + " k€" : kEur(v)));
    let g = "";
    for (let k = 0; k <= 3; k++) {
      const v = lo + (hi - lo) * k / 3, y = Y(v).toFixed(1);
      g += '<line class="cv-grille" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text class="cv-axe" x="' + (L - 8) + '" y="' + (+y + 4).toFixed(1) + '" text-anchor="end">' + esc(fmt(v)) + "</text>";
    }
    const lab = p => dateCourte(p.date) + (joursEntre(rows[0].date, rows[rows.length - 1].date) > 300 ? " " + p.date.slice(2, 4) : "");
    let droite = -Infinity; const xFin = X(x1), wFin = larg(lab(rows[rows.length - 1]));
    const pas = Math.max(1, Math.floor(rows.length / 8));
    rows.forEach((p, i) => {
      const last = i === rows.length - 1;
      if (!last && i % pas) return;
      const x = X(ts[i]), w = larg(lab(p)), a = i === 0 ? x : last ? x - w : x - w / 2, b = i === 0 ? x + w : last ? x : x + w / 2;
      if (!last && (a < droite + 6 || b > xFin - wFin - 6)) return;
      droite = b;
      g += '<text class="cv-axe" x="' + x.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="' + (i === 0 ? "start" : last ? "end" : "middle") + '">' + esc(lab(p)) + "</text>";
    });
    const d = rows.map((p, i) => (i ? "L" : "M") + X(ts[i]).toFixed(1) + "," + Y(p.valeur).toFixed(1)).join("");
    const aire = d + "L" + xFin.toFixed(1) + "," + (H - B) + "L" + X(x0).toFixed(1) + "," + (H - B) + "Z";
    const ref = opt.ref && fini(opt.ref.valeur) ? '<line class="cv-ref" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(+opt.ref.valeur).toFixed(1) + '" y2="' + Y(+opt.ref.valeur).toFixed(1) + '"/>' +
      '<text class="cv-ref-t" x="' + (W - R) + '" y="' + (Y(+opt.ref.valeur) - 5).toFixed(1) + '" text-anchor="end">' + esc(opt.ref.label || "") + "</text>" : "";
    const fin = rows[rows.length - 1];
    const pts = rows.length > 90 ? "" : rows.slice(0, -1).map((p, i) => '<circle class="cv-pt" cx="' + X(ts[i]).toFixed(1) + '" cy="' + Y(p.valeur).toFixed(1) + '" r="2.4"><title>' + esc(dateFr(p.date) + " : " + fp(p.valeur)) + "</title></circle>").join("");
    const dernier = '<circle class="cv-pt fin" cx="' + xFin.toFixed(1) + '" cy="' + Y(fin.valeur).toFixed(1) + '" r="4.2"><title>' + esc(dateFr(fin.date) + " : " + fp(fin.valeur) + (fin.live ? " (aujourd'hui)" : "")) + "</title></circle>";
    return '<svg class="cv-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-labelledby="' + id + '-t" aria-describedby="' + id + '-d" focusable="false">' +
      '<title id="' + id + '-t">' + esc(plat(opt.titre || "Graphique")) + '</title><desc id="' + id + '-d">' + esc(plat(opt.desc || "")) + "</desc>" + g +
      '<path class="cv-aire" d="' + aire + '"/>' + ref + '<path class="cv-trace" d="' + d + '"/>' + pts + dernier + "</svg>";
  }
  /** Barres groupées entrées / sorties par mois. mois = [{ mois, entrees, sorties }] ; o = { id, titre, desc, largeur }. Vide → null. */
  function barresSvg(mois, o) {
    const opt = o || {}, rows = liste(mois).filter(m => m && isoOk(jj(m.mois)));
    if (!rows.length) return null;
    const id = esc(opt.id || "cv-b");
    const W = Math.max(300, Math.min(1000, Math.round(+opt.largeur) || 720)), H = W < 480 ? 190 : 220, L = 62, R = 14, T = 14, B = 28;
    const hi = Math.max(1, ...rows.map(m => Math.max(+m.entrees || 0, +m.sorties || 0))) * 1.12;
    const Y = v => T + (1 - v / hi) * (H - T - B), bande = (W - L - R) / rows.length, bw = Math.max(4, Math.min(26, bande * 0.32));
    let g = "";
    for (let k = 0; k <= 3; k++) { const v = hi * k / 3, y = Y(v).toFixed(1); g += '<line class="cv-grille" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text class="cv-axe" x="' + (L - 8) + '" y="' + (+y + 4).toFixed(1) + '" text-anchor="end">' + esc(kEur(v)) + "</text>"; }
    rows.forEach((m, i) => {
      const cx = L + bande * (i + 0.5), e = +m.entrees || 0, s = +m.sorties || 0, lb = moisLabel(m.mois);
      g += '<rect class="cv-b-ent" x="' + (cx - bw - 1).toFixed(1) + '" y="' + Y(e).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (H - B - Y(e)).toFixed(1) + '"><title>' + esc(lb + " : entrées " + eur(e)) + "</title></rect>";
      g += '<rect class="cv-b-sor" x="' + (cx + 1).toFixed(1) + '" y="' + Y(s).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (H - B - Y(s)).toFixed(1) + '"><title>' + esc(lb + " : sorties " + eur(s)) + "</title></rect>";
      g += '<text class="cv-axe" x="' + cx.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(MOIS_COURTS[+jj(m.mois).slice(5, 7) - 1]) + "</text>";
    });
    return '<svg class="cv-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-labelledby="' + id + '-t" aria-describedby="' + id + '-d" focusable="false">' +
      '<title id="' + id + '-t">' + esc(plat(opt.titre || "Graphique")) + '</title><desc id="' + id + '-d">' + esc(plat(opt.desc || "")) + "</desc>" + g + "</svg>";
  }
  /** Tableau des données d'un graphique, dans un accordéon fermé (UI.accordeon). colonnes = [en-têtes] ; lignes = [[cellules texte]]. */
  function donneesHtml(U, legende, colonnes, lignes) {
    const t = '<div class="cv-table-defile"><table class="cv-table"><caption class="ui-sr">' + esc(legende) + "</caption><thead><tr>" +
      colonnes.map((c, i) => '<th scope="col"' + (i ? ' class="cv-num"' : "") + ">" + esc(c) + "</th>").join("") + "</tr></thead><tbody>" +
      lignes.map(l => "<tr>" + l.map((c, i) => (i ? '<td class="cv-num">' : '<th scope="row">') + esc(c) + (i ? "</td>" : "</th>")).join("") + "</tr>").join("") + "</tbody></table></div>";
    return U && typeof U.accordeon === "function" ? U.accordeon({ titre: "Voir les données du graphique", contenu: t }) : t;
  }

  /* ============================================================ rendus HTML ============================================================ */
  const chip = c => '<span class="cv-chip ' + esc(c.ton || "neutre") + '">' + esc(c.texte) + "</span>";
  const tendance = (v, suffixe) => (v == null ? "" : '<span class="cv-pv ' + (v >= 0 ? "pos" : "neg") + '"><span aria-hidden="true">' + (Math.round(v) > 0 ? "▲ " : Math.round(v) < 0 ? "▼ " : "") + "</span>" +
    '<span class="ui-sr">' + (v >= 0 ? "Plus-value latente : " : "Moins-value latente : ") + "</span>" + esc(eurS(v)) + (suffixe ? '<span class="cv-pv-l"> ' + esc(suffixe) + "</span>" : "") + "</span>");

  /** En-tête de la liste (e = entete()). */
  function enteteHtml(e) {
    const v = e.variation;
    const varTxt = v ? '<span class="cv-var ' + (v.montant >= 0 ? "pos" : "neg") + '"><span aria-hidden="true">' + (Math.round(v.montant) > 0 ? "▲ " : Math.round(v.montant) < 0 ? "▼ " : "") + "</span>" +
      esc(eurS(v.montant) + (v.pct != null ? " (" + pctS(v.pct) + ")" : "")) + "</span> " + esc("depuis le " + dateFr(v.depuis)) : esc("Variation sur 1 mois disponible après un mois de photos quotidiennes.");
    const fait = (l, val, s, cls) => '<li><span class="cv-fait-l">' + esc(l) + '</span><span class="cv-fait-v' + (cls ? " " + cls : "") + '">' + esc(val) + "</span>" + (s ? '<span class="cv-fait-s">' + esc(s) + "</span>" : "") + "</li>";
    return '<p class="cv-total">' + esc(eur(e.net)) + '</p><p class="cv-sous">' + varTxt + "</p>" +
      '<ul class="cv-faits">' + fait("Financier", eur(e.financier), "comptes et placements") + fait("Immobilier", eur(e.immobilier), e.autres ? "+ " + eur(e.autres) + " d'autres biens" : "") +
      fait("Dettes", eur(-e.dettes), "capital restant dû", e.dettes ? "neg" : "") + "</ul>";
  }

  /** Alerte « doublon probable » (texte, puis « Demander à Claude » de clôturer la ligne si U est fourni). */
  const alerteDoublonHtml = (d, U) => '<p class="cv-alerte" role="note"><span>' + esc(texteDoublon(d)) + "</span>" + lienClaude(U, phraseDoublon(d), "Demander à Claude") + "</p>";
  /** Carte d'un compte : lien vers sa fiche (ou vers Immobilier et crédits pour une dette) ; sans fiche (plusieurs lignes sans
      enveloppe) : carte non cliquable. Doublon probable : alerte sous la carte (U : bouton « Demander à Claude »). */
  function carteHtml(c, U) {
    const fiche = c.type !== "dette", lienOk = !!c.href, route = lienOk ? c.href.replace(/^#/, "") : "";
    const lu = [c.nom, c.sous, (c.type === "dette" ? "reste dû " + eur(-c.solde) : "solde " + eur(c.solde)), pct0(c.part) + (c.type === "dette" ? " des dettes" : " du financier"),
      c.plusValue != null ? (c.plusValue >= 0 ? "plus-value latente " : "moins-value latente ") + eurS(c.plusValue) : "", c.source.texte,
      liste(c.doublons).length ? "doublon probable" : "", !lienOk ? "" : fiche ? "ouvrir la fiche" : "voir Immobilier et crédits"].filter(Boolean).join(", ");
    const corps = '<span class="cv-c-haut"><span class="cv-c-nom">' + esc(c.nom) + "</span>" + '<span class="cv-c-solde">' + esc(eur(c.solde)) + "</span></span>" +
      '<span class="cv-c-bas"><span class="cv-c-sous">' + esc([c.sous, pct0(c.part) + (c.type === "dette" ? " des dettes" : " du financier")].filter(Boolean).join(" · ")) + "</span>" +
      (c.plusValue != null ? tendance(c.plusValue, "latents") : "") + "</span>" +
      '<span class="cv-c-pied">' + chip(c.source) + (lienOk ? '<span class="cv-c-ouvrir" aria-hidden="true">›</span>' : "") + "</span>";
    const cls = "cv-carte" + (c.type === "dette" ? " dette" : "") + (liste(c.doublons).length ? " doublon" : "");
    return '<li class="cv-li">' + (lienOk
      ? '<a class="' + cls + '" href="' + esc(c.href) + '" data-goto="' + esc(route) + '" data-cv-cle="' + esc(c.cle) + '" aria-label="' + esc(lu) + '">' + corps + "</a>"
      : '<div class="' + cls + ' fixe" role="group" aria-label="' + esc(lu) + '">' + corps + "</div>") +
      liste(c.doublons).map(d => alerteDoublonHtml(d, U)).join("") + "</li>";
  }
  /** Blocs repliables des quatre familles (fermes = Set des familles repliées ; U facultatif : boutons « Demander à Claude »). */
  function famillesHtml(L, fermes, U) {
    const f = fermes || new Set();
    return L.familles.map(F => {
      const ouvert = !f.has(F.id), corps = "cv-fam-" + F.id;
      const meta = [pluriel(F.nb, "compte"), F.part != null && F.nb ? pct0(F.part) + " du financier" : ""].filter(Boolean).join(" · ");
      return '<section class="cv-fam' + (ouvert ? " ouvert" : "") + '" data-cv-fam="' + F.id + '" aria-labelledby="' + corps + '-h">' +
        '<h3 class="cv-fam-h" id="' + corps + '-h"><button type="button" class="cv-fam-btn" data-cv-fam-btn="' + F.id + '" aria-expanded="' + ouvert + '" aria-controls="' + corps + '">' +
        '<span class="cv-fam-txt"><span class="cv-fam-nom">' + esc(F.label) + '</span><span class="cv-fam-meta">' + esc(meta) + "</span></span>" +
        '<span class="cv-fam-val' + (F.id === "dettes" && F.total ? " neg" : "") + '">' + esc(eur(F.total)) + "</span>" +
        '<span class="cv-fam-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M6 9l6 6 6-6"/></svg></span>' +
        "</button></h3>" +
        '<div class="cv-fam-corps" id="' + corps + '"' + (ouvert ? "" : " hidden") + ">" +
        (F.nb ? F.etablissements.map(E => '<div class="cv-etab"><h4 class="cv-etab-h">' + esc(E.nom) + '</h4><ul class="cv-cartes">' + E.comptes.map(c => carteHtml(c, U)).join("") + "</ul></div>").join("")
          : '<p class="cv-muet">' + esc(F.vide) + "</p>") +
        "</div></section>";
    }).join("");
  }

  /** Fil d'Ariane : [{ label, href? }] — le dernier élément est la page courante (aria-current). */
  function arianeHtml(items) {
    return '<nav class="cv-ariane" aria-label="Fil d\'Ariane"><ol>' + items.map((it, i) => {
      const last = i === items.length - 1;
      return "<li>" + (last || !it.href ? '<span aria-current="page">' + esc(it.label) + "</span>" : '<a href="' + esc(it.href) + '" data-goto="' + esc(it.href.replace(/^#/, "")) + '">' + esc(it.label) + "</a>") + "</li>";
    }).join("") + "</ol></nav>";
  }
  const titreFiche = (titre, sous, droite) => '<header class="cv-f-tete"><div class="cv-f-tete-txt"><h2 class="cv-f-titre" id="cvFicheTitre" tabindex="-1">' + esc(titre) + "</h2>" +
    (sous ? '<p class="cv-f-sous">' + esc(sous) + "</p>" : "") + "</div>" + (droite || "") + "</header>";
  const faitsHtml = fs => '<ul class="cv-det">' + fs.map(f => '<li><span class="cv-det-l">' + esc(f[0]) + '</span><span class="cv-det-v' + (f[2] ? " " + f[2] : "") + '">' + esc(f[1]) + "</span></li>").join("") + "</ul>";
  const lienClaude = (U, q, lib) => (U && typeof U.demanderAClaude === "function" ? U.demanderAClaude(q, lib) : "");
  const RETOUR = { label: "Comptes", href: "#" + ROUTE };
  const introuvable = (quoi, U) => arianeHtml([RETOUR, { label: "Introuvable" }]) + titreFiche(quoi + " introuvable", "") +
    '<section class="panel cv-f-bloc"><p>Ce compte n\'existe plus ou a été renommé. Reviens à la liste de tes comptes.</p><p><a class="cv-lien" href="#' + ROUTE + '" data-goto="' + ROUTE + '">Voir tous mes comptes</a></p></section>';

  /** Fiche enveloppe (f = ficheEnveloppe()) : squelette ; la courbe et les lignes vont dans #cvGraphe et #cvLignesFiche
      (grapheEnveloppeHtml), redessinés au changement de période sans toucher au sélecteur. */
  function ficheEnveloppeHtml(f, U) {
    if (!f.trouvee) return introuvable("Compte « " + f.nom + " »", U);
    const resume = [["Valeur", eur(f.total)], ["Plus-value latente", f.plusValue != null ? eurS(f.plusValue) + (f.cout ? " (" + pctS(f.plusValue / f.cout * 100) + ")" : "") : "non calculable sans prix de revient", f.plusValue != null ? (f.plusValue >= 0 ? "pos" : "neg") : ""],
      ["Prix de revient total", f.cout != null ? eur(f.cout) : "—"], ["Établissement", f.etablissement.nom], ["Source", f.source.texte]];
    const rep = f.repartition.length ? '<ul class="cv-rep">' + f.repartition.map(r => '<li><span class="cv-rep-l">' + esc(r.label) + '</span><span class="cv-rep-barre" aria-hidden="true"><span style="width:' + Math.max(1, Math.min(100, r.pct)).toFixed(1) + '%"></span></span><span class="cv-rep-v">' + esc(pct(r.pct)) + " · " + esc(eur(r.montant)) + "</span></li>").join("") + "</ul>" : '<p class="cv-muet">Aucune ligne comptée.</p>';
    const vp = f.vraie, vraie = vp.etat === "non_suivi" ? '<p class="cv-muet">Indisponible : les versements de ce compte ne sont pas suivis. Il est synchronisé avec ta banque : Boussole voit sa valeur, pas l\'argent que tu y verses ou en retires.</p>'
      : vp.etat === "titulaires" ? '<p class="cv-muet">Indisponible : plusieurs titulaires ont une enveloppe de ce nom, et les photos quotidiennes ne les distinguent pas.</p>'
      : vp.etat === "construction" ? '<p class="cv-construction"><strong>En construction :</strong> disponible à partir du ' + esc(dateFr(vp.dispoLe)) + ". Boussole a besoin de 90 jours de photos quotidiennes pour corriger la performance de tes versements.</p>"
      : vp.etat === "ok" ? faitsHtml([["Gain hors versements", eurS(vp.gain), vp.gain >= 0 ? "pos" : "neg"], ["Performance", vp.pct != null ? pctS(vp.pct) : "—"], ["Période", "du " + dateFr(vp.depuis) + " au " + dateFr(vp.jusquA)], ["Versements nets", eurS(vp.flux)]]) +
        '<p class="cv-note">Calcul : variation de valeur moins les versements et retraits enregistrés, rapportée au capital moyen engagé.</p>'
      : '<p class="cv-muet">Pas encore assez de photos de cette enveloppe pour la calculer.</p>';
    return arianeHtml([RETOUR, { label: f.nom }]) + titreFiche(f.nom, f.sous, '<p class="cv-f-total">' + esc(eur(f.total)) + "</p>") +
      liste(f.doublons).map(d => alerteDoublonHtml(d, U)).join("") +
      '<section class="panel cv-f-bloc" aria-labelledby="cvGrapheTitre"><div class="cv-f-head"><h3 id="cvGrapheTitre">Valeur de tes lignes actuelles</h3><div class="cv-periode" id="cvPeriode"></div></div>' +
      '<div id="cvGraphe" aria-live="polite"></div></section>' +
      '<section class="panel cv-f-bloc" aria-labelledby="cvResumeTitre"><h3 id="cvResumeTitre">En bref</h3>' + faitsHtml(resume) +
      (f.aRecevoir.length ? '<p class="cv-note">À recevoir, non compté : ' + esc(f.aRecevoir.join(", ")) + ".</p>" : "") + "</section>" +
      '<section class="panel cv-f-bloc" aria-labelledby="cvRepTitre"><h3 id="cvRepTitre">Répartition par classe</h3>' + rep + "</section>" +
      '<section class="panel cv-f-bloc" aria-labelledby="cvLignesTitre"><h3 id="cvLignesTitre">Lignes, par poids</h3><div id="cvLignesFiche"></div></section>' +
      '<section class="panel cv-f-bloc" aria-labelledby="cvVraieTitre"><h3 id="cvVraieTitre">Vraie performance</h3>' + vraie + "</section>" +
      '<div class="cv-acts">' + lienClaude(U, "Explique-moi mon enveloppe « " + f.nom + " » dans Boussole : sa composition, sa plus-value latente et ce qui l'a fait bouger.", "Demander à Claude") + "</div>";
  }
  /** Courbe et lignes d'une fiche enveloppe pour la période choisie. etat = { cours, charge: chargement | pret, periode, largeur }. */
  function grapheEnveloppeHtml(f, etat, U, deps) {
    const e = etat || {}, t = jour(e.today), per = periodeDe(e.periode), d0 = debutPeriode(per.id, t), cours = e.cours || {};
    let graphe;
    if (!f.isins.length) graphe = '<p class="cv-muet">Toutes les lignes de ce compte sont saisies à la main : leur valeur ne suit pas de cours, il n\'y a donc pas de courbe. Elle apparaîtra pour les lignes cotées.</p>';
    else if (e.charge === "echec") graphe = echecCoursHtml();
    else if (e.charge !== "pret") graphe = '<p class="cv-muet" role="status">Chargement des cours…</p>';
    else {
      const sr = serieEnveloppe(f.lignes.map(l => l.p), cours, d0, t, deps), pts = echantillon(sr.points, 260);
      const svg = courbeSvg(pts, { id: "cvCourbeEnv", largeur: e.largeur, titre: "Valeur de tes lignes actuelles, " + per.txt,
        desc: pts.length > 1 ? "De " + eur(pts[0].valeur) + " le " + dateFr(pts[0].date) + " à " + eur(pts[pts.length - 1].valeur) + " aujourd'hui (" + eurS(pts[pts.length - 1].valeur - pts[0].valeur) + ")." : "" });
      graphe = svg ? svg + '<p class="cv-note">Quantités d\'aujourd\'hui × cours passés' + (sr.constantes ? " ; " + esc(eur(sr.constantes)) + " de liquidités et de lignes saisies comptés à valeur constante" : "") +
        (sr.sansHistorique.length ? " ; sans historique de cours : " + esc(sr.sansHistorique.join(", ")) : "") + ". Ce n'est pas ta performance réelle : elle ignore tes achats, ventes et versements.</p>" +
        (sr.partiel ? partielHtml(sr.historiqueDepuis, per) : "") + plafondHtml(e.plafond, f.isins) +
        donneesHtml(U, "Valeur de tes lignes actuelles, " + per.txt, ["Date", "Valeur"], echantillon(pts, 40).map(p => [dateFr(p.date), eur(p.valeur)]))
        : '<p class="cv-muet">Historique des cours pas encore disponible pour ces lignes : Boussole le récupère la nuit, la courbe apparaîtra bientôt.</p>';
    }
    const perf = l => (e.charge === "pret" && l.p.mode === "market" ? perfDepuis(cours, l.p.isin, d0, l.p.price) : null);
    const lignes = '<ul class="cv-lignes">' + f.lignes.map(l => {
      const pf = perf(l), pv = l.plusValue;
      return '<li><a class="cv-ligne" href="' + esc(l.href) + '" data-goto="' + esc(l.href.replace(/^#/, "")) + '">' +
        '<span class="cv-l-txt"><span class="cv-l-nom">' + esc(plat(l.p.name) || "Ligne sans nom") + '</span><span class="cv-l-sous">' + esc(pct(l.poids) + " du compte" + (plat(l.p.bloc) ? " · " + plat(l.p.bloc) : "")) + "</span></span>" +
        '<span class="cv-l-chiffres"><span class="cv-l-val">' + esc(eur(l.valeur)) + "</span>" +
        '<span class="cv-l-pv">' + (pv != null ? '<span class="' + (pv >= 0 ? "pos" : "neg") + '">' + esc(eurS(pv) + " (" + pctS(l.plusValuePct) + ")") + "</span>" : esc(l.p.mode === "market" ? "PRU non renseigné" : "valeur saisie")) + "</span>" +
        '<span class="cv-l-perf">' + esc(per.label.replace(" ", "\u00a0")) + " : " + (pf != null ? '<span class="' + (pf >= 0 ? "pos" : "neg") + '">' + esc(pctS(pf)) + "</span>" : "—") + "</span></span>" +
        '<span class="cv-l-ouvrir" aria-hidden="true">›</span></a></li>';
    }).join("") + "</ul>" + '<p class="cv-note">Plus-value latente = quantité × (cours − prix de revient). Performance de la période : évolution du cours sur ' + esc(per.aria) + ".</p>";
    return { graphe, lignes };
  }

  /** Fiche ligne (f = ficheLigne()). */
  function ficheLigneHtml(f, U) {
    if (!f.trouvee) return introuvable("Ligne", U);
    const P = promptsDe();
    const q = P && typeof P.phrase === "function" ? P.phrase("expertise", f.expertise.nom) : "Boussole : consulte l'expertise " + f.expertise.nom + " sur ma situation.";
    const chiffres = [["Valeur", eur(f.valeur)], ["Plus-value latente", f.plusValue != null ? eurS(f.plusValue) + " (" + pctS(f.plusValuePct) + ")" : "non calculable sans prix de revient", f.plusValue != null ? (f.plusValue >= 0 ? "pos" : "neg") : ""],
      ["Poids dans le compte", f.poidsEnveloppe != null ? pct(f.poidsEnveloppe) : "non compté"], ["Source", f.source.texte + (f.source.origine === "manuel" ? "" : " (" + (SOURCES_AUTO[f.source.origine] || "banque") + ")")]];
    const mvts = f.mouvements.length ? '<ul class="cv-mvts">' + f.mouvements.map(x => '<li><span class="cv-m-t"><strong>' + esc(x.type) + "</strong>" + '<span class="cv-m-s">' + esc([dateFr(x.date), x.agent ? "agent" : "", x.note].filter(Boolean).join(" · ")) + "</span></span>" +
      '<span class="cv-m-v">' + esc((x.qty ? nfq.format(x.qty) + " × " + eur2(x.price) + " " : "") + (x.montant != null ? eur(x.montant) : "")) + "</span></li>").join("") + "</ul>"
      : '<p class="cv-muet">Aucun mouvement connu. Les achats, ventes et versements que tu signales à Claude apparaîtront ici.</p>';
    return arianeHtml([RETOUR, { label: f.enveloppe || "Compte", href: f.enveloppeHref }, { label: f.nom }]) +
      titreFiche(f.nom, f.sous, '<p class="cv-f-total">' + esc(eur(f.valeur)) + "</p>") +
      (f.isin ? '<section class="panel cv-f-bloc" aria-labelledby="cvGrapheTitre"><div class="cv-f-head"><h3 id="cvGrapheTitre">Cours</h3><div class="cv-periode" id="cvPeriode"></div></div><div id="cvGraphe" aria-live="polite"></div></section>' : "") +
      '<section class="panel cv-f-bloc" aria-labelledby="cvResumeTitre"><h3 id="cvResumeTitre">En bref</h3>' + faitsHtml(chiffres) + "</section>" +
      '<section class="panel cv-f-bloc" aria-labelledby="cvDetailTitre"><h3 id="cvDetailTitre">Détail</h3>' + faitsHtml(f.faits) + "</section>" +
      '<section class="panel cv-f-bloc" aria-labelledby="cvMvtsTitre"><h3 id="cvMvtsTitre">Mouvements connus</h3>' + mvts + "</section>" +
      '<div class="cv-acts">' + lienClaude(U, q, "Demander à Claude") + '<span class="cv-note">Active l\'expertise ' + esc(f.expertise.nom) + ".</span></div>";
  }
  /* Historique plus court que la période, plafond de lecture atteint, lecture en échec (bouton « Réessayer », data-cv-reessayer). */
  const partielHtml = (depuis, per) => '<p class="cv-note">Historique des cours disponible depuis le ' + esc(dateFr(depuis)) + " seulement : la courbe commence à cette date, pas au début de la période (" + esc(per.txt) + ").</p>";
  const plafondHtml = (plafond, isins) => (liste(plafond).some(i => liste(isins).includes(i)) ? '<p class="cv-note">Historique tronqué : seuls les cours les plus récents ont été chargés.</p>' : "");
  const echecCoursHtml = () => '<p class="cv-muet" role="status">Les cours n\'ont pas pu être chargés. <button type="button" class="cv-lien-btn" data-cv-reessayer>Réessayer</button></p>';
  /** Courbe du cours d'une ligne avec son prix de revient. */
  function grapheLigneHtml(f, etat, U) {
    const e = etat || {}, t = jour(e.today), per = periodeDe(e.periode), d0 = debutPeriode(per.id, t);
    if (e.charge === "echec") return echecCoursHtml();
    if (e.charge !== "pret") return '<p class="cv-muet" role="status">Chargement des cours…</p>';
    const h = coursDe(e.cours, f.isin).filter(c => c.date >= d0 && c.date < t).map(c => ({ date: c.date, valeur: c.cloture }));
    const partiel = h.length && h[0].date > plusJours(d0, 7) ? partielHtml(h[0].date, per) : "";
    if (fini(f.p.price)) h.push({ date: t, valeur: +f.p.price, live: true });
    const pts = echantillon(h, 260), pru = fini(f.p.pru) && +f.p.pru > 0 ? +f.p.pru : null;
    const svg = courbeSvg(pts, { id: "cvCourbeLigne", largeur: e.largeur, format: v => (Math.abs(v) >= 1e4 ? kEur(v) : eur2(v)), formatPoint: eur2,
      ref: pru ? { valeur: pru, label: "PRU " + eur2(pru) } : null, titre: "Cours de " + f.nom + ", " + per.txt,
      desc: pts.length > 1 ? "De " + eur2(pts[0].valeur) + " le " + dateFr(pts[0].date) + " à " + eur2(pts[pts.length - 1].valeur) + " aujourd'hui" + (pru ? " ; prix de revient " + eur2(pru) + " (ligne horizontale)" : "") + "." : "" });
    if (!svg) return '<p class="cv-muet">Historique du cours pas encore disponible : Boussole le récupère la nuit, la courbe apparaîtra bientôt.</p>';
    const perf = pts.length > 1 ? (pts[pts.length - 1].valeur / pts[0].valeur - 1) * 100 : null;
    return '<p class="cv-perf">' + esc(per.txt.charAt(0).toUpperCase() + per.txt.slice(1)) + " : " + (perf != null ? '<span class="' + (perf >= 0 ? "pos" : "neg") + '">' + esc(pctS(perf)) + "</span>" : "—") + "</p>" + svg +
      (pru ? '<p class="cv-note">Trait pointillé : ton prix de revient unitaire (' + esc(eur2(pru)) + ").</p>" : "") + partiel + plafondHtml(e.plafond, [f.isin]) +
      donneesHtml(U, "Cours de " + f.nom + ", " + per.txt, ["Date", "Cours"], echantillon(pts, 40).map(p => [dateFr(p.date), eur2(p.valeur)]));
  }

  /** Fiche compte courant (f = ficheCourant()). */
  function ficheCourantHtml(f, U, o) {
    if (!f.trouvee) return introuvable("Compte courant", U);
    const opt = o || {}, fl = f.flux, ec = fl.enCours, moy = fl.moyenne;
    const portee = f.portee === "compte" ? "de ce compte" : "de tous tes comptes connectés confondus";
    const pb = f.plusBas;
    const plusBas = !f.connecte ? (f.banqueActive ? "rattache ce compte à un compte bancaire synchronisé pour le calculer" : "connecte ta banque pour le calculer")
      : f.operations === "chargement" ? "chargement des opérations…" : f.operations === "indisponible" ? "opérations indisponibles pour le moment"
      : !pb ? "pas encore d'opérations synchronisées"
      : eur(pb.montant) + " le " + dateFr(pb.date) + (pb.complet ? "" : " (d'après les opérations depuis le " + dateFr(pb.depuis) + ")");
    const chiffres = [["Solde", eur(f.solde)], ["Établissement", f.etablissement.nom], ["Source", f.source.texte],
      ["Plus bas solde sur 90 jours", plusBas, pb && pb.montant < 0 ? "neg" : ""]];
    const flux = !f.banqueActive || !fl.mois.length
      ? '<p class="cv-muet">' + esc(!f.banqueActive ? "Connecte ta banque dans Agent › Connexion pour suivre les entrées et sorties de ce compte."
        : f.portee === "aucun" ? "Rattache ce compte à un compte bancaire synchronisé (Agent › Connexion) pour suivre ses entrées et sorties."
        : "Pas encore d'opérations synchronisées.") + "</p>"
      : faitsHtml([["Entrées du mois en cours", ec ? eur(ec.entrees) : "—", "pos"], ["Sorties du mois en cours", ec ? eur(ec.sorties) : "—", "neg"],
        ["Entrées par mois (moyenne)", moy ? eur(moy.entrees) + " sur " + pluriel(moy.n, "mois", "mois") : "—"], ["Sorties par mois (moyenne)", moy ? eur(moy.sorties) + " sur " + pluriel(moy.n, "mois", "mois") : "—"]]) +
        '<p class="cv-note">' + esc(f.portee === "compte" ? "Totaux de ce compte, virements entre tes comptes compris." : "Totaux de tous tes comptes connectés confondus : le détail par compte n'est pas encore disponible.") + "</p>";
    const svg = f.banqueActive && fl.mois.length ? barresSvg(fl.mois, { id: "cvBarresFlux", largeur: opt.largeur, titre: "Entrées et sorties par mois, " + portee,
      desc: fl.mois.map(m => moisLabel(m.mois) + " : entrées " + eur(m.entrees) + ", sorties " + eur(m.sorties)).join(" ; ") + "." }) : null;
    const prel = !f.connecte ? '<p class="cv-muet">' + esc(f.banqueActive ? "Rattache ce compte à un compte bancaire synchronisé pour repérer ses prélèvements récurrents." : "Connecte ta banque pour repérer les prélèvements récurrents de ce compte.") + "</p>"
      : f.operations === "chargement" ? '<p class="cv-muet" role="status">Chargement des opérations…</p>'
      : f.operations === "indisponible" ? '<p class="cv-muet">Opérations indisponibles pour le moment : les prélèvements récurrents s\'afficheront au prochain chargement.</p>'
      : f.historiqueCourt ? '<p class="cv-muet">Pas encore assez d\'opérations (moins de deux mois) pour repérer les prélèvements récurrents.</p>'
      : f.prelevements.length ? '<ul class="cv-mvts">' + f.prelevements.map(x => '<li><span class="cv-m-t">' + esc(x.libelle) + (x.jour ? '<span class="cv-m-s">vers le ' + esc(x.jour === 1 ? "1er" : String(x.jour)) + " du mois · " + esc(pluriel(x.mois, "mois", "mois")) + "</span>" : "") + '</span><span class="cv-m-v">' + esc(eur(x.montant)) + "</span></li>").join("") + "</ul>" +
        '<p class="cv-note">Débits de même libellé au moins deux mois sur les 90 derniers jours, de montants proches.</p>'
      : '<p class="cv-muet">Aucun prélèvement récurrent détecté sur les 90 derniers jours.</p>';
    return arianeHtml([RETOUR, { label: f.nom }]) + titreFiche(f.nom, f.sous, '<p class="cv-f-total">' + esc(eur(f.solde)) + "</p>") +
      '<section class="panel cv-f-bloc" aria-labelledby="cvResumeTitre"><h3 id="cvResumeTitre">En bref</h3>' + faitsHtml(chiffres) + "</section>" +
      '<section class="panel cv-f-bloc" aria-labelledby="cvFluxTitre"><h3 id="cvFluxTitre">Entrées et sorties</h3>' + flux +
      (svg ? '<div class="cv-legende" aria-hidden="true"><span class="cv-leg ent">Entrées</span><span class="cv-leg sor">Sorties</span></div>' + svg +
        donneesHtml(U, "Entrées et sorties par mois", ["Mois", "Entrées", "Sorties"], fl.mois.map(m => [moisLabel(m.mois), eur(m.entrees), eur(m.sorties)])) : "") + "</section>" +
      '<section class="panel cv-f-bloc" aria-labelledby="cvPrelTitre"><h3 id="cvPrelTitre">Prélèvements récurrents</h3>' + prel + "</section>" +
      '<div class="cv-acts">' + lienClaude(U, "Regarde avec moi les entrées et sorties de mon compte courant dans Boussole : y a-t-il de l'argent qui dort ou des dépenses qui dérapent ?", "Demander à Claude") + "</div>";
  }

  const H = { FAMILLES, PERIODES, famille, doublonsDe, plusBasSolde, prelevementsRecurrents, lien, lireCible, cleVue, etablissement, comptesBanque, sourceDe, comptes, entete, debutPeriode, serieEnveloppe, perfDepuis,
    vraiePerformance, expertiseDe, ficheEnveloppe, ficheLigne, ficheCourant, fluxMois, echantillon, enteteHtml, famillesHtml, carteHtml, arianeHtml, ficheEnveloppeHtml,
    grapheEnveloppeHtml, ficheLigneHtml, grapheLigneHtml, ficheCourantHtml, courbeSvg, barresSvg, donneesHtml, jour };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof window !== "undefined") window.ComptesView = H;
  if (typeof document === "undefined") return;

  /* ============================================================ vue ============================================================ */
  const CLE_PERIODE = "comptes-periode", CLE_FERMES = "comptes-fermes";
  let S = null, root = null, dirty = true, vue = { type: "liste" }, largeur = 0;
  let periode = "1a", ctlPeriode = null, sigListe = "", sigFiche = "", origine = null; // origine : clé de la carte qui a ouvert la fiche
  const fermes = new Set();
  /* Cours par ISIN : coursCache[isin] = série lue ; couverts[isin] = première date demandée (la série couvre [couverts, aujourd'hui]) ;
     enCours[isin] = date demandée par la lecture en cours ; echecs = ISIN dont la dernière lecture a échoué (rien de mémorisé :
     « Réessayer ») ; plafonds = ISIN dont l'historique a été tronqué par le store. */
  const coursCache = {}, couverts = {}, enCours = {}, echecs = new Set(), plafonds = new Set();
  /* Opérations des comptes bancaires d'une fiche compte courant : ops[clé des comptes] = tableau | "chargement" | "indisponible". */
  const ops = {};
  let bootFini = false;
  try { const p = localStorage.getItem(CLE_PERIODE); if (PERIODES.some(x => x.id === p)) periode = p; } catch (e) { /* défaut */ }
  try { JSON.parse(localStorage.getItem(CLE_FERMES) || "[]").forEach(k => { if (FAMILLES.some(f => f.id === k)) fermes.add(k); }); } catch (e) { /* tout ouvert */ }
  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const pret = () => !!S && S.ready !== false;

  function render() {
    if (!root || !S) return;
    const u = U(), liste_ = vue.type === "liste";
    $("cvListeVue").hidden = !liste_;
    $("cvFiche").hidden = liste_;
    if (liste_) renderListe(u); else renderFiche(u);
  }
  function renderListe(u) {
    $("cvChargement").hidden = pret();
    if (!pret()) return;
    const L = comptes(S, jour()), e = entete(S, jour());
    const vide = !L.familles.some(F => F.nb);
    $("cvVide").hidden = !vide;
    $("cvTitre").textContent = "Patrimoine net " + (scopeDe(S) === "foyer" ? "du foyer" : (window.Calc && window.Calc.deNom ? window.Calc.deNom(nomDe(S, S.scope), S.scope === "p2" ? 2 : 1) : ""));
    const h = enteteHtml(e) + "\u0000" + (vide ? "" : famillesHtml(L, fermes, u));
    if (h === sigListe) return;
    sigListe = h;
    const [tete, fams] = h.split("\u0000");
    $("cvTete").innerHTML = tete;
    $("cvFamilles").innerHTML = fams;
  }

  const debutVoulu = () => debutPeriode(periode, jour());
  const couvert = i => couverts[i] != null && couverts[i] <= debutVoulu();
  function etatGraphe() {
    const is = liste(vue.isins);
    const charge = is.every(couvert) ? "pret" : is.some(i => echecs.has(i) && !enCours[i]) ? "echec" : "chargement";
    return { cours: coursCache, charge, periode, today: jour(), largeur, plafond: [...plafonds] };
  }
  function renderFiche(u) {
    const zone = $("cvFiche");
    if (!pret()) { if (sigFiche !== "chargement") { sigFiche = "chargement"; zone.innerHTML = '<p class="cv-chargement" role="status">Chargement du compte…</p>'; } return; }
    let html, f = null;
    if (vue.type === "enveloppe") { f = ficheEnveloppe(S, vue, jour()); html = ficheEnveloppeHtml(f, u); vue.isins = f.trouvee ? f.isins : []; }
    else if (vue.type === "ligne") { f = ficheLigne(S, vue.id, jour()); html = ficheLigneHtml(f, u); vue.isins = f.trouvee && f.isin ? [f.isin] : []; }
    else {
      const f0 = ficheCourant(S, vue.id, jour());
      f = f0.trouvee && f0.compteIds.length ? ficheCourant(S, vue.id, jour(), undefined, ops[f0.compteIds.join(",")]) : f0;
      largeur = zone.clientWidth || largeur; html = ficheCourantHtml(f, u, { largeur: largeur - 34 }); vue.isins = [];
      if (f.trouvee && f.connecte) chargerOperations(f.compteIds);
    }
    vue.fiche = f;
    if (html !== sigFiche) {
      sigFiche = html;
      zone.innerHTML = html;
      ctlPeriode = null;
      const zp = $("cvPeriode");
      if (zp && u && typeof u.bascule === "function") ctlPeriode = u.bascule(zp, { label: "Période", options: PERIODES.map(p => ({ id: p.id, label: p.label, aria: p.aria })), actif: periode,
        surChange: id => { periode = id; try { localStorage.setItem(CLE_PERIODE, id); } catch (e) { /* rien */ } rendreGraphe(); chargerCours(vue.isins); } });
    }
    rendreGraphe();
    chargerCours(vue.isins);
  }
  /* Courbe et lignes de la fiche pour la période choisie (le sélecteur de période n'est pas redessiné : il garde le focus). */
  function rendreGraphe() {
    const g = $("cvGraphe"), u = U(), f = vue.fiche;
    if (!f || !f.trouvee) return;
    largeur = (g && g.clientWidth) || largeur;
    const e = etatGraphe();
    if (vue.type === "enveloppe") {
      const r = grapheEnveloppeHtml(f, e, u);
      if (g && g.dataset.sig !== r.graphe) { g.dataset.sig = r.graphe; g.innerHTML = r.graphe; }
      const l = $("cvLignesFiche");
      if (l && l.dataset.sig !== r.lignes) { l.dataset.sig = r.lignes; l.innerHTML = r.lignes; }
    } else if (vue.type === "ligne" && g) {
      const h = grapheLigneHtml(f, e, u);
      if (g.dataset.sig !== h) { g.dataset.sig = h; g.innerHTML = h; }
    }
  }
  /* Cours historiques des ISIN de la fiche pour la période choisie (Store.cours(isins, début de la période)) : la période affichée
     d'abord, une période plus longue relit depuis son début. Lecture en échec : rien n'est mémorisé, phrase et « Réessayer » ;
     plafond du store (historique tronqué) : signalé sous la courbe. */
  async function chargerCours(isins) {
    const d0 = debutVoulu();
    const manquants = liste(isins).filter(i => !couvert(i) && !(enCours[i] && enCours[i] <= d0) && !echecs.has(i));
    if (!manquants.length) return;
    manquants.forEach(i => { enCours[i] = d0; });
    let r = null;
    try {
      const st = window.Store;
      r = st && typeof st.cours === "function" ? (await st.cours(manquants, d0)) || {} : {};
    } catch (e) { r = null; }
    manquants.forEach(i => {
      if (enCours[i] !== d0) return; // une lecture plus longue a pris le relais
      delete enCours[i];
      if (!r) { echecs.add(i); return; }
      echecs.delete(i);
      coursCache[i] = liste(r[i]); couverts[i] = d0;
      if (liste(r.plafond).includes(i)) plafonds.add(i); else plafonds.delete(i);
    });
    if (root && vue.type !== "liste") rendreGraphe();
  }
  /* Opérations des 90 derniers jours des comptes bancaires d'une fiche compte courant (Store.banque.operations), lues une fois par
     ouverture ; en échec : « indisponible », relues à la prochaine ouverture. */
  async function chargerOperations(ids) {
    const cle = liste(ids).join(",");
    if (!cle || ops[cle] !== undefined) return;
    ops[cle] = "chargement";
    await Promise.resolve(); // jamais pendant le rendu en cours
    const st = window.Store, B = st && st.banque;
    let r;
    try { r = B && typeof B.operations === "function" ? await B.operations(ids, plusJours(jour(), -JOURS_HISTO)) : "indisponible"; } catch (e) { r = "indisponible"; }
    ops[cle] = Array.isArray(r) ? r : "indisponible";
    if (root && vue.type === "courant") { sigFiche = ""; renderFiche(U()); }
  }

  /* Vue demandée par le lien profond (App.parametres(), lus au show()) : la fiche s'ouvre, le focus va sur son titre (sauf au premier
     affichage, chargement de la page) ; retour à la liste : focus sur la carte d'origine. */
  function changerVue(v) {
    const avant = vue, cle = cleVue(v);
    if (cleVue(avant) === cle) return false;
    if (avant.type === "liste" && v.type !== "liste" && document.activeElement && document.activeElement.hasAttribute && document.activeElement.hasAttribute("data-cv-cle"))
      origine = document.activeElement.getAttribute("data-cv-cle");
    vue = v; sigFiche = "";
    return true;
  }
  /* Après la coque (qui pose le focus sur le titre de page quand la destination change) : d'où le délai. */
  function focusApres(v) {
    if (!bootFini) return;
    setTimeout(() => {
      if (!root || cleVue(vue) !== cleVue(v)) return;
      if (v.type !== "liste") {
        const h = $("cvFicheTitre");
        if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
        const top = typeof root.getBoundingClientRect === "function" ? root.getBoundingClientRect().top + (window.scrollY || 0) - 80 : 0;
        if (window.scrollY > top && typeof window.scrollTo === "function") window.scrollTo({ top: Math.max(0, top) });
        return;
      }
      const c = origine ? Array.from(root.querySelectorAll("[data-cv-cle]")).find(x => x.getAttribute("data-cv-cle") === origine) : null;
      const cible = c || $("cvTitre");
      if (cible) cible.focus();
    }, 0);
  }

  function basculerFamille(b) {
    const id = b.getAttribute("data-cv-fam-btn"), ouvrir = b.getAttribute("aria-expanded") !== "true";
    if (ouvrir) fermes.delete(id); else fermes.add(id);
    try { localStorage.setItem(CLE_FERMES, JSON.stringify([...fermes])); } catch (e) { /* rien */ }
    b.setAttribute("aria-expanded", String(ouvrir));
    const corps = root.querySelector("#" + b.getAttribute("aria-controls"));
    if (corps) corps.hidden = !ouvrir;
    const sec = b.closest(".cv-fam"); if (sec) sec.classList.toggle("ouvert", ouvrir);
    sigListe = ""; // le prochain rendu reprend l'état
  }

  function mount(r) {
    root = r;
    setTimeout(() => { bootFini = true; }, 0); // l'affichage du chargement de la page ne déplace pas le focus
    $("cvTitre").setAttribute("tabindex", "-1");
    const u = U();
    if (u && typeof u.demanderAClaude === "function") {
      const P = window.ClaudePrompts;
      $("cvVideClaude").innerHTML = u.demanderAClaude(P && P.phrase ? P.phrase("placements") : "Boussole : aide-moi à mettre à jour mes placements.", "Compléter avec Claude");
    }
    root.addEventListener("click", e => {
      const t = e.target; if (!t || !t.closest) return;
      const b = t.closest("[data-cv-fam-btn]"); if (b) { basculerFamille(b); return; }
      if (t.closest("[data-cv-reessayer]")) { liste(vue.isins).forEach(i => echecs.delete(i)); rendreGraphe(); chargerCours(vue.isins); return; }
      const c = t.closest("[data-cv-cle]"); if (c) origine = c.getAttribute("data-cv-cle"); // carte qui retrouvera le focus au retour
    });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => {
      const w = $("cvFiche").clientWidth;
      if (S && vue.type !== "liste" && w && Math.abs(w - largeur) > 24) { largeur = w; if (vue.type === "courant") { sigFiche = ""; renderFiche(U()); } else rendreGraphe(); }
    }).observe($("cvFiche"));
  }
  function update(snap, visible) { S = snap; dirty = true; if (visible) { render(); dirty = false; } }
  function show() {
    const p = window.App && typeof App.parametres === "function" ? App.parametres() : {};
    const v = lireCible(p), change = changerVue(v);
    if (change) { echecs.clear(); Object.keys(ops).forEach(k => { if (ops[k] === "indisponible") delete ops[k]; }); }
    render(); dirty = false;
    if (change) focusApres(v);
  }

  const api = { mount, update, show };
  const reg = () => App.register("comptes-view", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
