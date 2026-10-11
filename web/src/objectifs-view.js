/* Patrimoine › Objectifs (module « objectifs-view ») : « Vais-je atteindre mes projets ? ».
   - En-tête : verdict en une phrase (objectifs en bonne voie ou qui demandent attention), épargne mensuelle répartie par
     priorité, « Ajouter un objectif », « Demander à Claude ».
   - Une carte par objectif (ordre des priorités) : nom, échéance, cible, progression (barre), statut (atteint, en avance,
     dans les temps, en retard, hors de portée), effort mensuel requis ; 5 puis « Voir plus ».
   - Panneau (UI.panneau) : détail chiffré, poches rattachées (valeur, cascade entre objectifs), projection de l'objectif
     (rythme actuel et effort requis jusqu'à l'échéance), « Modifier » (formulaire dans le panneau), « Monter » / « Descendre »
     (priorité), « Supprimer » (confirmation). « Ajouter un objectif » : choix d'un modèle (matelas, apport, retraite, projet),
     puis le même formulaire.
   - Projection du patrimoine financier : accordéon fermé (dessinée à l'ouverture), horizon en bascule, versement « réel » ou
     « scénario » local jamais enregistré, tableau des scénarios, hypothèses de rendement. CK4 la déplacera dans Pilotage › Projections.
   Calculs inchangés (plan.js : affecterDeja, repartirEpargne, statutObjectif, projection…) ; l'épargne vient du budget enregistré.
   Écritures : Store.db.collection("objectifs").upsert(row), Store.db.doc("objectifs/<id>").delete().
   Fonctions pures exportées pour les tests : trier, analyser, resumeObjectifs, carteHtml, detailHtml, formHtml, serieObjectif,
   modele, validerObjectif, ligneObjectif, deplacer, livretA, versementReel, projectionSvg, projectionTableHtml, hypothesesHtml.
   Dépendances injectées (deps / ctx) : { Plan, Calc } ; window.* par défaut. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) && d[k] ? d[k] : glob(k));

  /* ---------- formats et dates ---------- */
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const eur = v => (v == null || !isFinite(v) ? "—" : nf.format(Math.round(v)) + " €");
  const eurM = v => eur(v) + "/mois";
  const pct = v => (v == null || !isFinite(v) ? "—" : (v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " %");
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const clone = o => JSON.parse(JSON.stringify(o));
  const kEur = v => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " M€" : nf.format(v / 1000) + " k€");
  const moisAn = d => (d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "");
  const isoToday = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); };
  /** Fin du mois, k mois après `today` (AAAA-MM-JJ). */
  const plusMois = (k, today) => { const [y, m] = String(today || isoToday()).split("-").map(Number); return new Date(Date.UTC(y, m - 1 + k + 1, 0)).toISOString().slice(0, 10); };
  const dateCible = o => (o && (o.dateCible || o.date_cible)) || null;

  /* ---------- vocabulaire ---------- */
  const OBJ_TYPES = [{ id: "matelas", label: "Matelas" }, { id: "apport", label: "Apport" }, { id: "retraite", label: "Retraite" }, { id: "projet", label: "Projet" }];
  const OBJ_LABEL = { matelas: "Matelas", apport: "Apport", retraite: "Retraite", projet: "Projet" };
  const SOURCES = [{ id: "saisi", label: "Montant saisi" }, { id: "poches", label: "Poches de vos placements" }];
  const REND_DEF = { matelas: 2.4, apport: 2.4, retraite: 5, projet: 3 };
  /* statut → [ton du badge UI, libellé] */
  const STATUTS = {
    atteint: ["bon", "atteint"], avance: ["bon", "en avance"], dans_les_temps: ["info", "dans les temps"],
    retard: ["attention", "en retard"], hors_portee: ["critique", "hors de portée"],
  };
  const ORDRE_STATUTS = ["atteint", "avance", "dans_les_temps", "retard", "hors_portee"];
  const ACTIONS = ["Monde", "Europe", "Asie", "Nasdaq 2x", "Convictions tech", "Convictions"];
  const MODELES = [
    { id: "matelas", titre: "Matelas de précaution", texte: "Six mois de dépenses de côté, disponibles à tout moment." },
    { id: "apport", titre: "Apport immobilier", texte: "La somme à réunir avant d'acheter votre logement." },
    { id: "retraite", titre: "Retraite", texte: "Un capital pour compléter vos pensions, placé sur le long terme." },
    { id: "projet", titre: "Projet", texte: "Voyage, voiture, travaux : un montant à une date." },
  ];
  const CHEVRON_D = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';

  /* =============================================================== calculs de présentation =============================================================== */
  /** Objectifs triés : priorité croissante (sans priorité à la fin), puis échéance la plus proche. */
  const trier = objs => (Array.isArray(objs) ? objs.slice() : []).filter(Boolean).sort((a, b) =>
    ((a.priorite ?? Infinity) - (b.priorite ?? Infinity)) || String(dateCible(a) || "9999").localeCompare(String(dateCible(b) || "9999")));

  /** Situation de chaque objectif, mêmes calculs qu'avant : « déjà » par la cascade des poches (Plan.affecterDeja), épargne mensuelle
      (budget enregistré, Plan.capaciteEpargne) répartie par priorité (Plan.repartirEpargne), statut (Plan.statutObjectif).
      → { liste: [{ o, st, brut, rang }], totaux, capacite } ; brut = tout ce que contiennent les poches rattachées, avant la cascade. */
  function analyser(S, deps, today) {
    const P = dep(deps, "Plan"), s = S || {}, scope = s.scope || "foyer", t0 = today || isoToday();
    const lignes = s.budget && Array.isArray(s.budget.lignes) ? s.budget.lignes : [];
    const totaux = P.budgetTotaux(lignes, s.profil || null, scope);
    const capacite = P.capaciteEpargne(totaux);
    const objs = trier(s.objectifs), positions = s.positions || [];
    const deja = P.affecterDeja(objs, positions, scope);
    const alloue = P.repartirEpargne(objs.map(o => Object.assign({}, o, { source: "saisi", deja: deja[o.id] || 0 })), capacite, { today: t0 });
    const liste = objs.map((o, i) => {
      const st = P.statutObjectif(o, { deja: deja[o.id] || 0, versementAlloue: alloue[o.id] || 0, today: t0 });
      const brut = o.source === "poches" ? P.dejaObjectif(o, positions, scope) : st.deja;
      return { o, st, brut, rang: i + 1 };
    });
    return { liste, totaux, capacite };
  }

  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  /** Verdict de la page : { n, compte: { statut: n }, verdict, detail, ton } (ton : bon | attention | critique | neutre). */
  function resumeObjectifs(liste) {
    const xs = liste || [], n = xs.length, compte = {};
    xs.forEach(x => { const k = x.st && x.st.statut; compte[k] = (compte[k] || 0) + 1; });
    const detail = ORDRE_STATUTS.filter(k => compte[k]).map(k => compte[k] + " " + STATUTS[k][1]).join(" · ");
    if (!n) return { n, compte, verdict: "Aucun objectif pour l'instant.", detail: "", ton: "neutre" };
    const alerte = (compte.retard || 0) + (compte.hors_portee || 0);
    const ton = compte.hors_portee ? "critique" : alerte ? "attention" : "bon";
    let verdict;
    if (!alerte) verdict = n === 1 ? "Votre objectif est en bonne voie." : "Vos " + n + " objectifs sont en bonne voie.";
    else if (n === 1) verdict = "Votre objectif est " + STATUTS[xs[0].st.statut][1] + ".";
    else verdict = pluriel(alerte, "objectif") + " sur " + n + (alerte > 1 ? " demandent" : " demande") + " votre attention.";
    return { n, compte, verdict, detail, ton };
  }

  /** Effort requis lisible : [montant, précision]. */
  function effortTxt(x) {
    const { o, st } = x, done = st.statut === "atteint";
    if (done) return ["—", "objectif atteint"];
    if (!dateCible(o)) return ["—", "pas d'échéance fixée"];
    if (!isFinite(st.effort)) return ["—", "échéance dépassée"];
    return [eurM(st.effort), "pendant " + st.mois + " mois, à " + String(o.rendement ?? 0).replace(".", ",") + " %/an"];
  }
  function quandTxt(x) {
    const { st } = x;
    if (st.statut === "atteint") return "Objectif atteint : la somme est déjà de côté.";
    if (st.atteinte) return "Au rythme actuel, atteint vers " + moisAn(st.atteinte) + ".";
    return st.versementAlloue > 0 ? "Pas atteint en 60 ans au rythme actuel." : "Aucune épargne n'y est affectée pour l'instant : pas atteint au rythme actuel.";
  }
  const badgeHtml = st => { const [ton, lbl] = STATUTS[st] || ["neutre", st || "—"]; return '<span class="ui-badge ' + ton + '">' + esc(lbl) + "</span>"; };

  /** Carte repliée d'un objectif (bouton data-ui-carte, ouvert en panneau par UI.brancher). n = nombre d'objectifs. */
  function carteHtml(x, n) {
    const { o, st } = x, ton = (STATUTS[st.statut] || ["neutre"])[0], eff = effortTxt(x);
    const prog = Math.max(0, Math.min(1, +st.progression || 0));
    return '<button type="button" class="ui-carte ov-carte st-' + ton + '" data-ui-carte="' + esc(o.id) + '" aria-haspopup="dialog">' +
      '<span class="ui-carte-tete"><span class="ui-carte-titre">Priorité ' + esc(x.rang || 1) + (n ? " sur " + esc(n) : "") + " · " + esc(OBJ_LABEL[o.type] || o.type || "Objectif") + "</span>" + badgeHtml(st.statut) + "</span>" +
      '<span class="ov-carte-nom">' + esc(plat(o.nom) || "Objectif sans nom") + "</span>" +
      '<span class="ov-carte-v"><span class="ov-carte-cible">' + esc(eur(o.cible)) + '</span><span class="ov-carte-date">' + esc(dateCible(o) ? moisAn(dateCible(o)) : "sans échéance") + "</span></span>" +
      '<span class="ov-barre" aria-hidden="true"><i style="width:' + (prog * 100).toFixed(1) + '%"></i></span>' +
      '<span class="ui-carte-pied"><span>' + esc(pct(prog)) + " de la cible</span><span>Effort requis : " + esc(eff[0]) + "</span></span>" +
      '<span class="ui-carte-ouvrir">' + CHEVRON_D + "</span></button>";
  }

  /** Valeur, dans le périmètre, des lignes d'une poche (key = "bloc") ou d'une enveloppe (key = "envelope"). */
  function valeurPoche(positions, scope, key, nom, Calc) {
    return (positions || []).filter(p => Calc.counted(p) && Calc.inScope(p, scope || "foyer") && p[key] === nom).reduce((a, p) => a + Calc.val(p), 0);
  }

  /** Points de la projection d'un objectif, mois 0 → échéance (ou date d'atteinte, ou 10 ans) : valeur au rythme actuel
      (versement alloué) et avec l'effort requis. → { points: [{ mois, actuel, requis | null }], cible, mois }. */
  function serieObjectif(o, st, today, Plan) {
    const P = Plan || glob("Plan"), d = dateCible(o), t0 = today || isoToday();
    let N = d ? Math.max(1, st.mois || 0) : st.atteinte ? Math.max(12, P.moisEntre(t0, st.atteinte)) : 120;
    N = Math.min(N, 600);
    const pas = Math.max(1, Math.ceil(N / 24)), ks = [];
    for (let k = 0; k < N; k += pas) ks.push(k);
    ks.push(N);
    const requisOk = !!d && isFinite(st.effort) && st.effort > 0 && st.statut !== "atteint";
    const points = ks.map(k => ({ mois: k, actuel: P.valeurFuture(st.deja, st.versementAlloue, k, o.rendement),
      requis: requisOk ? P.valeurFuture(st.deja, st.effort, k, o.rendement) : null }));
    return { points, cible: +o.cible || 0, mois: N };
  }

  /** Petite courbe de l'objectif : rythme actuel (trait plein), effort requis (pointillés), cible (ligne horizontale). */
  function serieSvg(serie, o, today) {
    const W = 420, H = 190, L = 46, R = 12, T = 14, B = 26, pts = serie.points, N = serie.mois || 1;
    const hi0 = Math.max(serie.cible, ...pts.map(p => p.actuel), ...pts.map(p => p.requis || 0), 1);
    const pasY = (() => { const r = hi0 / 4, p = Math.pow(10, Math.floor(Math.log10(r || 1))), n = r / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; })();
    const hi = Math.ceil(hi0 / pasY) * pasY;
    const X = k => L + (k / N) * (W - L - R), Y = v => T + (1 - v / hi) * (H - T - B);
    let g = "";
    for (let v = 0; v <= hi + 1; v += pasY) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="ov-g"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + esc(kEur(v)) + "</text>";
    const y0 = +String(today || isoToday()).slice(0, 4), m0 = +String(today || isoToday()).slice(5, 7) - 1;
    const an = k => String(y0 + Math.floor((m0 + k) / 12));
    g += '<text x="' + L + '" y="' + (H - 7) + '" text-anchor="start">' + esc(an(0)) + '</text><text x="' + (W - R) + '" y="' + (H - 7) + '" text-anchor="end">' + esc(an(N)) + "</text>";
    const chemin = cle => pts.map((p, i) => (i ? "L" : "M") + X(p.mois).toFixed(1) + "," + Y(p[cle]).toFixed(1)).join("");
    const fin = pts[pts.length - 1];
    const lbl = "Au rythme actuel : " + eur(fin.actuel) + " en " + an(N) + " ; cible " + eur(serie.cible) + (fin.requis != null ? " ; avec l'effort requis, la cible est atteinte à l'échéance" : "");
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(lbl) + '">' + g +
      '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(serie.cible).toFixed(1) + '" y2="' + Y(serie.cible).toFixed(1) + '" class="ov-cible"/>' +
      (fin.requis != null ? '<path d="' + chemin("requis") + '" class="ov-requis"/>' : "") +
      '<path d="' + chemin("actuel") + '" class="ov-actuel"/></svg>' +
      '<p class="ov-legende"><span><i class="ov-l-actuel"></i>au rythme actuel</span>' + (fin.requis != null ? '<span><i class="ov-l-requis"></i>avec l\'effort requis</span>' : "") + '<span><i class="ov-l-cible"></i>cible</span></p>';
  }

  const msgHtml = m => (m && m.texte ? '<p class="ov-msg ' + (m.ok ? "ok" : "err") + '" role="' + (m.ok ? "status" : "alert") + '" data-ov-msg tabindex="-1">' + esc(m.texte) + "</p>" : "");

  /** Contenu du panneau d'un objectif. ctx = { positions, scope, Calc, Plan, today, n, dbOk, confirmer, message, busy, duScope }. */
  function detailHtml(x, ctx) {
    const c = ctx || {}, { o, st } = x, C = dep(c, "Calc"), P = dep(c, "Plan"), scope = c.scope || "foyer", n = c.n || 1, r = x.rang || c.rang || 1;
    const done = st.statut === "atteint", eff = effortTxt(x), prog = Math.max(0, Math.min(1, +st.progression || 0));
    const poches = [].concat(o.poches || []), envs = [].concat(o.enveloppes || []);
    const src = o.source === "poches" ? (poches.length || envs.length ? "pris sur " + poches.concat(envs).join(", ") : "aucune poche rattachée") : "montant saisi";
    const rows = [
      ["Cible", eur(o.cible), dateCible(o) ? moisAn(dateCible(o)) : "sans échéance"],
      ["Déjà de côté", eur(st.deja), src],
      ["Effort requis", eff[0], eff[1]],
      ["Votre épargne actuelle en couvre", eurM(st.versementAlloue), done ? "plus rien à verser" : "versement alloué, par ordre de priorité"],
    ];
    const dis = c.busy || !c.dbOk ? " disabled" : "";
    const actions = c.confirmer
      ? '<div class="ov-confirm" role="group" aria-label="Confirmer la suppression"><p>Supprimer l\'objectif « ' + esc(plat(o.nom) || "sans nom") + " » ?</p>" +
        '<div class="ov-acts"><button type="button" class="ov-btn danger" data-ov-act="supprimer-oui"' + dis + '>Oui, supprimer</button><button type="button" class="ov-btn ghost" data-ov-act="supprimer-non">Non</button></div></div>'
      : '<div class="ov-acts"><button type="button" class="ov-btn" data-ov-act="modifier"' + dis + ">Modifier</button>" +
        '<button type="button" class="ov-btn ghost" data-ov-act="monter"' + (r <= 1 ? " disabled" : dis) + ' aria-label="Monter la priorité">↑ Monter</button>' +
        '<button type="button" class="ov-btn ghost" data-ov-act="descendre"' + (r >= n ? " disabled" : dis) + ' aria-label="Descendre la priorité">↓ Descendre</button>' +
        '<button type="button" class="ov-btn ghost danger" data-ov-act="supprimer"' + dis + ">Supprimer</button></div>";
    let pochesHtml;
    if (o.source === "poches") {
      const items = poches.map(p => ["Poche", p, valeurPoche(c.positions, scope, "bloc", p, C)]).concat(envs.map(e => ["Enveloppe", e, valeurPoche(c.positions, scope, "envelope", e, C)]));
      pochesHtml = (items.length ? '<ul class="ov-poches">' + items.map(([k, nom, v]) => '<li><span><span class="ov-poche-k">' + esc(k) + "</span> " + esc(nom) + '</span><b class="ov-num">' + esc(eur(v)) + "</b></li>").join("") + "</ul>"
        : '<p class="ov-note">Aucune poche rattachée : cochez-en dans « Modifier ».</p>') +
        (x.brut > st.deja + 0.5 && !done ? '<p class="ov-note">Ces poches contiennent ' + esc(eur(x.brut)) + " " + esc(c.duScope || "du foyer") + " ; " + esc(eur(x.brut - st.deja)) + " servent d'abord un objectif prioritaire.</p>" : "") +
        '<p class="ov-note">L\'argent d\'une poche sert d\'abord l\'objectif prioritaire ; le reste passe au suivant.</p>';
    } else pochesHtml = '<p class="ov-note">Montant saisi : ' + esc(eur(st.deja)) + ". Mettez-le à jour dans « Modifier », ou rattachez l'objectif à des poches de vos placements pour qu'il suive leur valeur.</p>";
    return msgHtml(c.message) +
      '<div class="ov-meta">' + badgeHtml(st.statut) + "<span>Priorité " + esc(r) + " sur " + esc(n) + " · " + esc(OBJ_LABEL[o.type] || o.type || "Objectif") + "</span></div>" +
      '<p class="ov-quand">' + esc(quandTxt(x)) + "</p>" +
      '<div class="ov-prog" role="progressbar" aria-label="Progression" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(prog * 100) + '"><i style="width:' + (prog * 100).toFixed(1) + '%"></i></div>' +
      '<p class="ov-note">' + esc(pct(prog)) + " de la cible</p>" +
      '<dl class="ov-dl">' + rows.map(([k, v, s]) => "<div><dt>" + esc(k) + "</dt><dd><b>" + esc(v) + "</b><span>" + esc(s) + "</span></dd></div>").join("") + "</dl>" +
      actions + (c.dbOk ? "" : '<p class="ov-note">Lecture seule : les objectifs ne peuvent pas être modifiés pour le moment.</p>') +
      '<section class="ov-sec"><h3 class="ov-sec-t">Poches rattachées</h3>' + pochesHtml + "</section>" +
      '<section class="ov-sec"><h3 class="ov-sec-t">Projection de l\'objectif</h3>' + serieSvg(serieObjectif(o, st, c.today, P), o, c.today) + "</section>";
  }

  /** Formulaire d'objectif (bascules branchées par la vue). ed = { nom, type, cible, dateCible, source, poches, enveloppes, deja, rendement }.
      ctx = { blocs: [[nom, valeur]], enveloppes: [[nom, valeur]], livretA, nouvelle, erreur, busy, U }. */
  function formHtml(ed, ctx) {
    const c = ctx || {}, d = ed || {}, U = c.U || null, f = "ovf-";
    const bascule = (cle, label, options, actif) => '<div class="ov-champ"><span class="ov-lab" id="' + f + cle + '-l">' + esc(label) + "</span>" +
      '<div class="ov-bascule" data-ov-bascule="' + cle + '" aria-labelledby="' + f + cle + '-l">' + (U && U.htmlBascule ? U.htmlBascule({ label, options, actif }) : "") + "</div></div>";
    const coches = (cle, liste, sel) => liste.length ? liste.map(([nom, v]) => '<label class="ov-chk"><input type="checkbox" data-ov-liste="' + cle + '" value="' + esc(nom) + '"' + (sel.includes(nom) ? " checked" : "") + "> " +
      esc(nom) + ' <span class="ov-num ov-muet">' + esc(eur(v)) + "</span></label>").join("") : '<span class="ov-note">Aucune dans vos placements.</span>';
    const avec = (liste, sel) => liste.concat(sel.filter(n => !liste.some(([x]) => x === n)).map(n => [n, 0]));
    const poches = [].concat(d.poches || []), envs = [].concat(d.enveloppes || []);
    return '<form class="ov-form" data-ov-form novalidate aria-label="' + (c.nouvelle ? "Nouvel objectif" : "Modifier l'objectif") + '">' +
      (c.erreur ? '<p class="ov-msg err" role="alert" data-ov-msg tabindex="-1">' + esc(c.erreur) + "</p>" : "") +
      '<div class="ov-champ"><label class="ov-lab" for="ovf-nom">Nom</label><input class="ov-in" id="ovf-nom" data-ov-champ="nom" autocomplete="off" value="' + esc(d.nom || "") + '" placeholder="ex. Voyage au Japon"></div>' +
      bascule("type", "Type", OBJ_TYPES, d.type || "projet") +
      '<div class="ov-ligne2"><div class="ov-champ"><label class="ov-lab" for="ovf-cible">Montant cible</label><span class="ov-money"><input id="ovf-cible" data-ov-champ="cible" type="number" inputmode="decimal" min="0" step="any" value="' + esc(d.cible ?? "") + '"><span class="ov-u">€</span></span></div>' +
      '<div class="ov-champ"><label class="ov-lab" for="ovf-date">Date visée</label><input class="ov-in" id="ovf-date" data-ov-champ="dateCible" type="date" value="' + esc(d.dateCible || "") + '"></div></div>' +
      bascule("source", "Déjà mis de côté", SOURCES, d.source === "poches" ? "poches" : "saisi") +
      (d.source === "poches"
        ? '<fieldset class="ov-coches"><legend class="ov-lab">Poches</legend>' + coches("poches", avec(c.blocs || [], poches), poches) + "</fieldset>" +
          '<fieldset class="ov-coches"><legend class="ov-lab">Enveloppes</legend>' + coches("enveloppes", avec(c.enveloppes || [], envs), envs) + "</fieldset>" +
          '<p class="ov-note">L\'argent d\'une poche sert d\'abord l\'objectif prioritaire ; le reste passe au suivant.</p>'
        : '<div class="ov-champ"><label class="ov-lab" for="ovf-deja">Montant déjà de côté</label><span class="ov-money"><input id="ovf-deja" data-ov-champ="deja" type="number" inputmode="decimal" min="0" step="any" value="' + esc(d.deja ?? 0) + '"><span class="ov-u">€</span></span></div>') +
      '<div class="ov-champ"><label class="ov-lab" for="ovf-rend">Rendement attendu</label><span class="ov-money"><input id="ovf-rend" data-ov-champ="rendement" type="number" inputmode="decimal" step="0.1" min="-50" max="50" value="' + esc(d.rendement ?? "") + '"><span class="ov-u">% / an</span></span>' +
      '<span class="ov-note">repère : Livret A ' + esc(c.livretA || "taux réglementé en vigueur") + ", fonds euros ~2,5 %, actions mondiales ~6 % sur longue période</span></div>" +
      '<div class="ov-acts"><button type="button" class="ov-btn" data-ov-act="enregistrer"' + (c.busy ? " disabled" : "") + ">" + (c.nouvelle ? "Ajouter l'objectif" : "Enregistrer l'objectif") + "</button>" +
      '<button type="button" class="ov-btn ghost" data-ov-act="annuler">Annuler</button></div></form>';
  }

  /** Modèle d'objectif (« Ajouter un objectif »). ctx = { totaux, blocs (noms de poches), age (clé de la toise), today }. */
  function modele(kind, ctx) {
    const c = ctx || {}, t = c.totaux || {}, blocs = c.blocs || [], ep = blocs.includes("Épargne"), today = c.today || isoToday();
    const k = REND_DEF[kind] != null ? kind : "projet";
    const base = { nom: "", type: k, cible: 10000, dateCible: plusMois(24, today), source: "saisi", poches: [], enveloppes: [], deja: 0, rendement: REND_DEF[k] };
    if (k === "matelas") return Object.assign(base, { nom: "Matelas de précaution", cible: t.depenses > 0 ? Math.round(6 * t.depenses / 100) * 100 : 10000, dateCible: plusMois(12, today), source: ep ? "poches" : "saisi", poches: ep ? ["Épargne"] : [] });
    if (k === "apport") return Object.assign(base, { nom: "Apport immobilier", cible: 40000, dateCible: plusMois(36, today), source: ep ? "poches" : "saisi", poches: ep ? ["Épargne"] : [] });
    if (k === "retraite") {
      const age = { u30: 25, a30: 35, a40: 45, a50: 55, a60: 62, a70: 70 }[c.age];
      const ans = Math.max(5, 64 - (age || 40)), act = blocs.filter(b => ACTIONS.includes(b));
      return Object.assign(base, { nom: "Retraite", cible: 300000, dateCible: plusMois(ans * 12, today), source: act.length ? "poches" : "saisi", poches: act });
    }
    return base;
  }

  /** Message d'erreur du formulaire, ou null. */
  function validerObjectif(d, today) {
    const t0 = today || isoToday();
    if (!plat(d.nom)) return "Donnez un nom à l'objectif.";
    if (!(+d.cible > 0)) return "Indiquez un montant cible supérieur à 0 €.";
    if (d.dateCible && !/^\d{4}-\d{2}-\d{2}$/.test(d.dateCible)) return "Date visée invalide.";
    if (d.dateCible && d.dateCible <= t0) return "La date visée doit être dans le futur.";
    if (d.source === "poches" && !(d.poches || []).length && !(d.enveloppes || []).length) return "Cochez au moins une poche ou une enveloppe, ou choisissez « Montant saisi ».";
    if (d.source !== "poches" && (d.deja === "" || d.deja == null || !(+d.deja >= 0))) return "Indiquez le montant déjà de côté (0 si rien).";
    if (d.rendement === "" || d.rendement == null || !isFinite(+d.rendement) || +d.rendement < -50 || +d.rendement > 50) return "Indiquez un rendement entre -50 et 50 % par an.";
    return null;
  }

  /** Ligne écrite par upsert : objectif existant (id) ou nouveau (priorité après la dernière). */
  function ligneObjectif(d, id, objs) {
    const poches = d.source === "poches";
    const row = { nom: plat(d.nom), type: d.type, cible: +d.cible, dateCible: d.dateCible || null, source: poches ? "poches" : "saisi",
      poches: poches ? [].concat(d.poches || []) : [], enveloppes: poches ? [].concat(d.enveloppes || []) : [], deja: poches ? 0 : +d.deja, rendement: +d.rendement };
    if (id != null) row.id = id;
    else row.priorite = (objs || []).reduce((m, o) => Math.max(m, +o.priorite || 0), 0) + 1;
    return row;
  }

  /** Priorités à réécrire pour monter (dir = -1) ou descendre (dir = 1) un objectif : [{ id, priorite }] (seules celles qui changent). */
  function deplacer(objs, id, dir) {
    const list = trier(objs), i = list.findIndex(o => o.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return [];
    const ordre = list.slice(); [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
    return ordre.map((o, k) => ({ id: o.id, priorite: k + 1 })).filter(u => list.find(o => o.id === u.id).priorite !== u.priorite);
  }

  /** Taux du Livret A lu dans les repères du savoir commun, avec sa date d'effet ; jamais de taux codé en dur. */
  function livretA(S, Reperes) {
    const R = Reperes, rl = R && S && S.savoir ? R.trouver(S.savoir.reperes, "livret_a_taux") : null;
    if (!rl) return "taux réglementé en vigueur";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(rl.dateEffet || ""));
    const d = m ? m[3] + "/" + m[2] + "/" + m[1] : (rl.dateEffet ? new Date(rl.dateEffet).toLocaleDateString("fr-FR") : "");
    return R.format(rl) + (d && d !== "Invalid Date" ? " depuis le " + d : "");
  }

  /** Versement mensuel réel de la projection : épargne du budget, sinon versements programmés du périmètre ; null si inconnu. */
  function versementReel(S, totaux, scope) {
    const s = S || {}, lignes = s.budget && Array.isArray(s.budget.lignes) ? s.budget.lignes : [];
    if (lignes.length && totaux && totaux.epargne > 0) return { v: totaux.epargne, src: "d'après l'épargne prévue au budget" };
    const rec = ((s.config && s.config.recurring) || []).filter(r => {
      const p = (s.positions || []).find(x => x.id === r.positionId);
      return (scope || "foyer") === "foyer" || (p && p.owner === scope);
    }).reduce((a, r) => a + Math.max(0, +r.amount || 0), 0);
    if (rec > 0) return { v: rec, src: "d'après vos versements programmés (budget sans épargne)" };
    return null;
  }

  /* ---------- projection du patrimoine financier (moteur Plan.projection) ---------- */
  function niceStep(r) { const p = Math.pow(10, Math.floor(Math.log10(r || 1))), n = r / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  /** Courbe : bande pessimiste–optimiste, ligne centrale ; dessinée à la largeur réelle du conteneur (cw). */
  function projectionSvg(res, N, y0, cw) {
    const narrow = cw < 520, W = Math.round(Math.min(1150, Math.max(300, cw || 640))), H = narrow ? 230 : 280, L = narrow ? 50 : 64, R = 14, T = 14, B = 28;
    let hi = Math.max(...res.optimiste, ...res.central, 1), lo = Math.min(0, ...res.pessimiste);
    const step = niceStep((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const X = i => L + (N ? i / N : 0) * (W - L - R), Y = val => T + (1 - (val - lo) / (hi - lo)) * (H - T - B);
    let g = "";
    for (let val = lo; val <= hi + 1; val += step) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(val).toFixed(1) + '" y2="' + Y(val).toFixed(1) + '" class="ov-g"/><text x="' + (L - 8) + '" y="' + (Y(val) + 4).toFixed(1) + '" text-anchor="end">' + esc(kEur(val)) + "</text>";
    const tick = N <= 5 ? 1 : N <= 10 ? 2 : 5;
    for (let i = 0; i <= N; i += tick) g += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? "start" : i === N ? "end" : "middle") + '">' + (y0 + i) + "</text>";
    const path = s => res[s].map((val, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(val).toFixed(1)).join("");
    const band = path("optimiste") + res.pessimiste.map((val, i) => "L" + X(i).toFixed(1) + "," + Y(val).toFixed(1)).reverse().join("") + "Z";
    const dots = res.central.map((val, i) => '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(val).toFixed(1) + '" r="' + (i === N ? 4.5 : 2) + '" class="' + (i === N ? "ov-pt fin" : "ov-pt") + '"><title>' + esc((y0 + i) + " : " + eur(val) + " (central ; " + eur(res.pessimiste[i]) + " à " + eur(res.optimiste[i]) + ")") + "</title></circle>").join("");
    const last = res.central[N];
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc("Projection sur " + N + " ans : " + eur(last) + " dans le scénario central, entre " + eur(res.pessimiste[N]) + " et " + eur(res.optimiste[N])) + '">' + g +
      '<path d="' + band + '" class="ov-bande"/>' +
      '<path d="' + path("optimiste") + '" class="ov-borne"/><path d="' + path("pessimiste") + '" class="ov-borne"/>' +
      '<path d="' + path("central") + '" class="ov-central"/>' + dots +
      '<text x="' + (X(N) - 8).toFixed(1) + '" y="' + (Y(last) - 10).toFixed(1) + '" text-anchor="end" class="ov-fin">' + esc(eur(last)) + "</text></svg>";
  }
  function projectionTableHtml(res, v, N, y0) {
    const verse = res.central[0] + v * 12 * N;
    const row = (s, lbl) => "<tr><td>" + lbl + '</td><td class="n">' + esc(eur(res[s][N])) + '</td><td class="n">' + esc(eur(verse)) + '</td><td class="n' + (res[s][N] - verse < 0 ? " neg" : "") + '">' + (res[s][N] - verse >= 0 ? "+" : "") + esc(eur(res[s][N] - verse)) + "</td></tr>";
    return "<thead><tr><th>Scénario</th><th>Dans " + N + " ans (" + (y0 + N) + ")</th><th>Capital et versements</th><th>Effet des marchés</th></tr></thead><tbody>" +
      row("pessimiste", "Pessimiste") + row("central", "Central") + row("optimiste", "Optimiste") + "</tbody>";
  }
  function hypothesesHtml(res, R) {
    const blocs = Object.keys(res.parBloc).sort((a, b) => res.parBloc[b].capital - res.parBloc[a].capital);
    const fr = x => String(x).replace(".", ",") + " %";
    return "<thead><tr><th>Poche</th><th>Montant</th><th>Part</th><th>Pessimiste</th><th>Central</th><th>Optimiste</th></tr></thead><tbody>" +
      blocs.map(b => { const r = R[b] || R._autre, pb = res.parBloc[b];
        return "<tr><td>" + esc(b === "_autre" ? "Autres" : b) + '</td><td class="n">' + esc(eur(pb.capital)) + '</td><td class="n">' + esc(pct(pb.poids)) + '</td><td class="n">' + esc(fr(r.pessimiste)) + '</td><td class="n">' + esc(fr(r.central)) + '</td><td class="n">' + esc(fr(r.optimiste)) + "</td></tr>"; }).join("") + "</tbody>";
  }

  const H = { trier, analyser, resumeObjectifs, carteHtml, detailHtml, formHtml, serieObjectif, modele, validerObjectif, ligneObjectif, deplacer, livretA,
    versementReel, projectionSvg, projectionTableHtml, hypothesesHtml, valeurPoche, STATUTS, OBJ_TYPES, MODELES };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =================================================================== vue =================================================================== */
  let root = null, S = null, aRendre = true, sigCartes = "", sigPanneau = "";
  /* panneau : { kind: "objectif" | "modeles" | "nouveau", id, edition, rendTouched, confirmer, message, busy, retour } */
  let pan = null, corpsPanneau = null;
  /* projection : réglages locaux, jamais enregistrés */
  let horizon = 10, versOverride = null, ctlHorizon = null;

  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const P = () => window.Plan, C = () => window.Calc;
  const deps = () => ({ Plan: P(), Calc: C() });
  const scope = () => (S && S.scope) || "foyer";
  const people = () => (S && Array.isArray(S.people) ? S.people : []);
  const nomDe = k => { const p = people().find(x => x.id === k); return (p && p.nom) || (k === "p2" ? "Conjoint(e)" : "Moi"); };
  const duScope = () => (scope() === "foyer" ? "du foyer" : C().deNom(nomDe(scope()), scope() === "p2" ? 2 : 1));
  const objectifs = () => trier(S && S.objectifs);
  const objectif = id => objectifs().find(o => String(o.id) === String(id)) || null;
  const echap = s => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"));
  const livePos = () => ((S && S.positions) || []).filter(p => C().counted(p));
  const noms = key => [...new Set(livePos().map(p => p[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const avecValeur = key => noms(key).map(n => [n, valeurPoche(S.positions, scope(), key, n, C())]);

  function dire(m, ok) { const el = $("ovMsg"); el.textContent = m || ""; el.className = "ov-page-msg " + (ok ? "ok" : "err"); el.hidden = !m; }
  function writeError(e) {
    const m = (e && e.message) || "";
    if (e && e.code === "invalid_argument" && /^Objectif/.test(m)) return m;
    if (e && e.code === "invalid_argument") return "Enregistrement refusé : vous n'avez pas les droits d'écriture sur ce tableau de bord.";
    return "Enregistrement impossible pour le moment (" + ((e && e.code) || "erreur") + "). Réessayez dans un instant.";
  }

  /* ---------- rendu de la page ---------- */
  function videHtml() {
    const u = U();
    return '<div class="ov-vide"><p class="ov-vide-t">Aucun objectif pour l\'instant.</p>' +
      "<p>Un objectif daté (matelas, apport, retraite, projet) dit combien mettre de côté chaque mois et si votre épargne actuelle suffit. Partez d'un modèle :</p>" +
      '<div class="ov-modeles">' + MODELES.map(m => '<button type="button" class="ov-modele" data-ov-modele="' + m.id + '"><b>' + esc(m.titre) + "</b><span>" + esc(m.texte) + "</span></button>").join("") + "</div>" +
      (u ? u.demanderAClaude("Aide-moi à fixer mes objectifs financiers dans Boussole : matelas de précaution, projets, retraite, avec un montant et une date.", "Fixer mes objectifs avec Claude") : "") + "</div>";
  }
  function render() {
    const u = U();
    if (!root || !S || !u) return;
    const a = analyser(S, deps(), isoToday()), r = resumeObjectifs(a.liste);
    $("ovVerdict").textContent = r.verdict + (r.detail && r.n > 1 ? " (" + r.detail + ")" : "");
    $("ovVerdict").className = "ov-verdict ton-" + r.ton;
    const partage = a.liste.filter(x => x.o.source === "poches").some((x, i, L) => L.some((y, j) => j > i &&
      ((x.o.poches || []).some(p => (y.o.poches || []).includes(p)) || (x.o.enveloppes || []).some(p => (y.o.enveloppes || []).includes(p)))));
    $("ovNote").textContent = a.liste.length ? "Épargne mensuelle répartie par priorité : " + eurM(a.capacite) + " (épargne prévue au budget et reste positif)." +
      (partage ? " Plusieurs objectifs partagent une poche : l'argent d'une poche sert d'abord l'objectif prioritaire." : "") : "";
    const h = a.liste.length ? u.voirPlus(a.liste, 5, x => carteHtml(x, a.liste.length), "Voir plus d'objectifs") : videHtml();
    if (h !== sigCartes) {
      const act = document.activeElement, porteur = act && $("ovCartes").contains(act) && act.closest ? act.closest("[data-ui-carte]") : null;
      const id = porteur ? porteur.getAttribute("data-ui-carte") : null;
      sigCartes = h; $("ovCartes").innerHTML = h;
      const n = id && $("ovCartes").querySelector('[data-ui-carte="' + echap(id) + '"]'); if (n) n.focus();
    }
    renderProjection();
    renderPanneau();
  }

  /* ---------- projection (accordéon) ---------- */
  function renderProjection(forceInput) {
    if (!root || !S) return;
    const t = analyser(S, deps(), isoToday()).totaux, real = versementReel(S, t, scope()), inp = $("ovVers");
    const v = versOverride != null ? versOverride : real ? real.v : 0;
    const res = P().projection({ positions: S.positions, scope: scope(), versementMensuel: v, annees: horizon });
    const N = horizon, y0 = new Date().getFullYear();
    $("ovProjResume").textContent = "· dans " + N + " ans : " + eur(res.central[N]) + " (central)";
    if (!$("ovProjAcc").hasAttribute("open")) return; // dessinée à l'ouverture seulement
    if (forceInput || versOverride == null || document.activeElement !== inp) inp.value = String(Math.round(v * 100) / 100);
    $("ovVersTag").innerHTML = versOverride != null ? '<button type="button" class="ov-tag scen" data-ov-vreset title="Revenir à la valeur réelle">scénario ↺</button>'
      : real ? '<span class="ov-tag reel" title="Repris de vos données">réel</span>' : "";
    $("ovVersSrc").textContent = versOverride != null ? "simulation locale, non enregistrée" + (real ? " · réel : " + eurM(real.v) : "") : real ? real.src : "aucune épargne mensuelle connue : saisissez un montant";
    $("ovProjNote").textContent = "Patrimoine financier " + duScope() + " aujourd'hui : " + eur(res.central[0]) + ".";
    $("ovChart").innerHTML = projectionSvg(res, N, y0, $("ovChart").clientWidth || 640);
    $("ovLegend").innerHTML = '<span><i class="ln"></i>scénario central</span><span><i class="bd"></i>entre pessimiste et optimiste (pointillés)</span>';
    $("ovProjTable").innerHTML = projectionTableHtml(res, v, N, y0);
    $("ovHyp").innerHTML = hypothesesHtml(res, P().RENDEMENTS);
  }

  /* ---------- panneau ---------- */
  function entree(id) { const a = analyser(S, deps(), isoToday()); return { x: a.liste.find(y => String(y.o.id) === String(id)) || null, n: a.liste.length }; }
  function contenuPanneau() {
    const u = U();
    if (pan.kind === "modeles") return '<p class="ov-note">Choisissez un point de départ ; tout se modifie ensuite.</p><div class="ov-modeles">' +
      MODELES.map(m => '<button type="button" class="ov-modele" data-ov-modele="' + m.id + '"><b>' + esc(m.titre) + "</b><span>" + esc(m.texte) + "</span></button>").join("") + "</div>";
    if (pan.edition) return formHtml(pan.edition, { blocs: avecValeur("bloc"), enveloppes: avecValeur("envelope"), livretA: livretA(S, window.Reperes || null),
      nouvelle: pan.kind === "nouveau", erreur: pan.message && !pan.message.ok ? pan.message.texte : null, busy: pan.busy, U: u });
    const { x, n } = entree(pan.id);
    return detailHtml(x, { positions: S.positions, scope: scope(), Calc: C(), Plan: P(), today: isoToday(), n, dbOk: !!(S && S.dbOk),
      confirmer: pan.confirmer, message: pan.message, busy: pan.busy, duScope: duScope() });
  }
  function optionsPanneau(h) {
    const u = U();
    let titre = "Ajouter un objectif", pied = null;
    if (pan.kind === "nouveau") titre = "Nouvel objectif";
    else if (pan.kind === "objectif") {
      const o = objectif(pan.id);
      titre = plat(o && o.nom) || "Objectif sans nom";
      if (o) pied = u.demanderAClaude("Aide-moi à atteindre mon objectif « " + titre + " » (" + eur(o.cible) + (dateCible(o) ? " d'ici " + moisAn(dateCible(o)) : "") + ") avec Boussole : quel effort, sur quels placements ?");
    }
    return { titre, contenu: h, retour: pan.retour, pied, surFermeture: fermeture };
  }
  function fermeture(o) {
    const p = pan;
    pan = null; sigPanneau = "";
    if ((o && o.focus === false) || !root || !p) return;
    if (p.retour && p.retour.isConnected) return;
    const el = p.id != null && root.querySelector('[data-ui-carte="' + echap(p.id) + '"]');
    if (el) { el.focus(); return; }
    const a = $("ovAjouter"); if (a) a.focus();
  }
  function ouvrir(p) {
    const u = U();
    if (!u) return;
    pan = Object.assign({ edition: null, rendTouched: false, confirmer: false, message: null, busy: false }, p);
    const h = contenuPanneau();
    sigPanneau = h;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(h));
    brancherPanneau(corpsPanneau);
    brancherBascules();
  }
  /* Rafraîchit le panneau ouvert ; pendant une saisie ou une écriture, seulement sur demande (force). cible : sélecteur simple ou fonction. */
  function renderPanneau(cible, force) {
    const u = U();
    if (!pan || !u || !u.panneau.ouvert()) return;
    if (pan.busy && !force) return;
    if (pan.kind === "objectif" && !objectif(pan.id)) { u.panneau.fermer({ focus: false }); return; }
    if ((pan.edition || pan.kind === "modeles") && !force && !cible) return;
    const h = contenuPanneau();
    if (h === sigPanneau && !cible && !force) return;
    sigPanneau = h;
    const y = corpsPanneau ? corpsPanneau.scrollTop : 0;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(h));
    corpsPanneau.scrollTop = y;
    brancherBascules();
    const f = typeof cible === "function" ? cible() : cible && corpsPanneau.querySelector(cible);
    if (f) f.focus();
  }
  function brancherBascules() {
    const u = U(), ed = pan && pan.edition;
    if (!u || !ed || !corpsPanneau) return;
    const b = cle => corpsPanneau.querySelector('[data-ov-bascule="' + cle + '"]');
    if (b("type")) u.bascule(b("type"), { label: "Type", options: OBJ_TYPES, actif: ed.type, surChange: id => {
      if (!pan || !pan.edition) return;
      pan.edition.type = id;
      if (!pan.rendTouched) { pan.edition.rendement = REND_DEF[id]; const ri = corpsPanneau.querySelector("#ovf-rend"); if (ri) ri.value = String(pan.edition.rendement); }
    } });
    if (b("source")) u.bascule(b("source"), { label: "Déjà mis de côté", options: SOURCES, actif: ed.source === "poches" ? "poches" : "saisi", surChange: id => {
      if (!pan || !pan.edition) return;
      pan.edition.source = id; pan.message = null;
      renderPanneau(() => { const c = corpsPanneau.querySelector('[data-ov-bascule="source"]'); return c && c.querySelector('[aria-checked="true"]'); }, true);
    } });
  }
  const branches = new WeakSet();
  function brancherPanneau(corps) {
    if (!corps || branches.has(corps)) return;
    branches.add(corps);
    corps.addEventListener("click", e => {
      const t = e.target;
      if (!t || !t.closest || !pan) return;
      const m = t.closest("[data-ov-modele]");
      if (m && corps.contains(m)) { choisirModele(m.getAttribute("data-ov-modele")); return; }
      const b = t.closest("[data-ov-act]");
      if (!b || !corps.contains(b) || b.disabled || b.hasAttribute("disabled") || pan.busy) return;
      agir(b.getAttribute("data-ov-act"));
    });
    const saisir = e => {
      const el = e.target;
      if (!el || !el.closest || !pan || !pan.edition) return;
      const f = el.closest("[data-ov-champ]");
      if (f) { const k = f.getAttribute("data-ov-champ"); pan.edition[k] = f.value; if (k === "rendement") pan.rendTouched = true; return; }
      const l = el.closest("[data-ov-liste]");
      if (l && e.type === "change") {
        const key = l.getAttribute("data-ov-liste"), cur = new Set(pan.edition[key] || []);
        if (l.checked) cur.add(l.value); else cur.delete(l.value);
        pan.edition[key] = [...cur];
      }
    };
    corps.addEventListener("input", saisir);
    corps.addEventListener("change", saisir);
    corps.addEventListener("keydown", e => {
      if (e.key === "Enter" && pan && pan.edition && e.target && e.target.localName === "input" && e.target.type !== "checkbox" && e.target.closest && e.target.closest("[data-ov-form]")) { e.preventDefault(); agir("enregistrer"); }
    });
  }

  function choisirModele(kind, retour) {
    const t = analyser(S, deps(), isoToday()).totaux;
    const ed = modele(kind, { totaux: t, blocs: noms("bloc"), age: S && S.profil && S.profil.foyer && S.profil.foyer.age, today: isoToday() });
    if (!pan) ouvrir({ kind: "nouveau", id: null, edition: ed, retour });
    else { Object.assign(pan, { kind: "nouveau", id: null, edition: ed, rendTouched: false, message: null, confirmer: false }); renderPanneau("#ovf-nom", true); }
    const n = corpsPanneau && corpsPanneau.querySelector("#ovf-nom"); if (n) n.focus();
  }

  async function agir(act) {
    if (!pan) return;
    if (act === "modifier") {
      const o = objectif(pan.id); if (!o) return;
      pan.edition = Object.assign({ deja: 0, poches: [], enveloppes: [], source: "saisi" }, clone(o), { dateCible: dateCible(o) || "" });
      pan.rendTouched = true; pan.message = null; pan.confirmer = false;
      renderPanneau("#ovf-nom", true);
    } else if (act === "annuler") {
      if (pan.kind === "nouveau") { U().panneau.fermer(); return; }
      pan.edition = null; pan.message = null; renderPanneau('[data-ov-act="modifier"]', true);
    } else if (act === "supprimer") { pan.confirmer = true; pan.message = null; renderPanneau('[data-ov-act="supprimer-non"]', true); }
    else if (act === "supprimer-non") { pan.confirmer = false; renderPanneau('[data-ov-act="supprimer"]', true); }
    else if (act === "supprimer-oui") await supprimer();
    else if (act === "enregistrer") await enregistrer();
    else if (act === "monter" || act === "descendre") await deplacerObjectif(act === "monter" ? -1 : 1);
  }

  async function enregistrer() {
    const db = window.Store && window.Store.db, ed = pan.edition;
    if (!db || !ed) return;
    const err = validerObjectif(ed, isoToday());
    if (err) { pan.message = { texte: err }; renderPanneau("[data-ov-msg]", true); return; }
    const row = ligneObjectif(ed, pan.kind === "nouveau" ? null : pan.id, objectifs());
    pan.busy = true; pan.message = null; renderPanneau(null, true);
    try {
      const r = await db.collection("objectifs").upsert(row);
      const id = row.id != null ? row.id : r && r.id;
      if (!pan) { dire("Objectif « " + row.nom + " » enregistré.", true); return; }
      pan.busy = false;
      if (id != null && objectif(id)) {
        Object.assign(pan, { kind: "objectif", id, edition: null, confirmer: false, message: { texte: "Objectif « " + row.nom + " » enregistré.", ok: true } });
        render();
        renderPanneau("[data-ov-msg]", true);
      } else { pan = null; U().panneau.fermer({ focus: false }); dire("Objectif « " + row.nom + " » enregistré.", true); render(); const a = $("ovAjouter"); if (a) a.focus(); }
    } catch (e) {
      if (!pan) { dire(writeError(e)); return; }
      pan.busy = false; pan.message = { texte: writeError(e) };
      renderPanneau("[data-ov-msg]", true);
    }
  }

  async function deplacerObjectif(dir) {
    const db = window.Store && window.Store.db, id = pan.id, ups = deplacer(S.objectifs, id, dir);
    if (!db || !ups.length) return;
    pan.busy = true; pan.message = null; renderPanneau(null, true);
    let erreur = null;
    try { for (const u of ups) await db.collection("objectifs").upsert(u); }
    catch (e) { erreur = writeError(e); }
    render();
    if (!pan) return;
    pan.busy = false;
    pan.message = erreur ? { texte: erreur } : { texte: "Priorité modifiée.", ok: true };
    const sel = '[data-ov-act="' + (dir < 0 ? "monter" : "descendre") + '"]';
    renderPanneau(() => { const b = corpsPanneau.querySelector(sel); return b && !b.hasAttribute("disabled") ? b : corpsPanneau.querySelector("[data-ov-msg]"); }, true);
  }

  async function supprimer() {
    const db = window.Store && window.Store.db, o = objectif(pan.id);
    if (!db || !o) return;
    const ids = objectifs().map(x => String(x.id)), i = ids.indexOf(String(o.id)), voisin = ids[i + 1] || ids[i - 1];
    pan.busy = true; renderPanneau(null, true);
    const id = o.id;
    try { await db.doc("objectifs/" + id).delete(); }
    catch (e) {
      if (pan) { pan.busy = false; pan.confirmer = false; pan.message = { texte: writeError(e) }; renderPanneau("[data-ov-msg]", true); } else dire(writeError(e));
      return;
    }
    if (pan) { pan = null; U().panneau.fermer({ focus: false }); }
    dire("Objectif « " + (plat(o.nom) || "sans nom") + " » supprimé.", true);
    render();
    const c = voisin && root.querySelector('[data-ui-carte="' + echap(voisin) + '"]');
    (c || $("ovAjouter")).focus();
  }

  function mount(r) {
    root = r;
    $("ovTitre").setAttribute("tabindex", "-1");
    const u = U();
    if (u) {
      $("ovClaude").innerHTML = u.demanderAClaude("Vais-je atteindre mes objectifs dans Boussole ? Passe-les en revue avec moi et dis-moi quoi ajuster.");
      u.brancher($("ovCartes"), { surCarte: (id, el) => { dire(""); ouvrir({ kind: "objectif", id, retour: el }); } });
      ctlHorizon = u.bascule($("ovHorizon"), { label: "Horizon", options: [5, 10, 20, 30].map(n => ({ id: String(n), label: n + " ans" })), actif: String(horizon),
        surChange: id => { horizon = +id; renderProjection(); } });
    }
    root.addEventListener("click", e => {
      const t = e.target;
      if (!t || !t.closest) return;
      let b;
      if ((b = t.closest("#ovAjouter"))) { dire(""); ouvrir({ kind: "modeles", id: null, retour: b }); return; }
      if ((b = t.closest("[data-ov-modele]")) && root.contains(b)) { dire(""); if (U() && U().panneau.ouvert()) U().panneau.fermer({ focus: false }); choisirModele(b.getAttribute("data-ov-modele"), b); return; }
      if (t.closest("[data-ov-vreset]")) { versOverride = null; renderProjection(true); $("ovVers").focus(); }
    });
    root.addEventListener("input", e => {
      if (e.target && e.target.id === "ovVers") { versOverride = e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0); renderProjection(); }
    });
    /* Accordéon de la projection : dessinée à l'ouverture (toggle ne remonte pas : écoute en capture). */
    root.addEventListener("toggle", e => { if (e.target && e.target.id === "ovProjAcc" && e.target.hasAttribute("open")) renderProjection(true); }, true);
    let w = 0;
    if (typeof window.addEventListener === "function") window.addEventListener("resize", () => {
      const nw = root.clientWidth; if (S && !root.hidden && Math.abs(nw - w) > 24) { w = nw; renderProjection(); }
    });
  }
  function update(snap, visible) {
    S = snap;
    if (pan && pan.kind === "objectif" && !(snap.objectifs || []).some(o => String(o.id) === String(pan.id)) && !pan.busy && U()) U().panneau.fermer({ focus: false });
    aRendre = true;
    if (visible) { render(); aRendre = false; }
  }
  function show() { if (aRendre) { render(); aRendre = false; } }
  function headline() {
    if (!S || !(S.ready || S.dbOk === false)) return "–";
    const r = resumeObjectifs(analyser(S, deps(), isoToday()).liste);
    return r.n ? r.verdict : "Objectifs à fixer";
  }

  const api = { mount, update, show, headline };
  const reg = () => App.register("objectifs-view", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
