/* Patrimoine › Objectifs (module « objectifs-view ») : « Vais-je atteindre mes projets ? ». Lecture seule : la saisie passe par
   Claude (spec docs/superpowers/specs/2026-10-11-saisie-par-agent.md) ; ce module n'écrit jamais dans le store.
   - En-tête : verdict en une phrase (objectifs en bonne voie ou qui demandent attention), épargne mensuelle répartie par
     priorité, « Compléter avec Claude », « Demander à Claude ».
   - Une carte par objectif (ordre des priorités) : nom, échéance, cible, progression (barre), statut (atteint, en avance,
     dans les temps, en retard, hors de portée), effort mensuel requis ; 5 puis « Voir plus ».
   - Panneau (UI.panneau, lecture) : détail chiffré, rendement attendu (repère Livret A), poches rattachées (valeur, cascade
     entre objectifs), projection de l'objectif (rythme actuel et effort requis jusqu'à l'échéance), « Corriger avec Claude ».
   - Projection du patrimoine financier : accordéon fermé (dessinée à l'ouverture, redessinée seulement si ses données
     changent), horizon en bascule, versement « réel » ou « scénario » : paramètre d'exploration local, jamais enregistré
     (simulateur). CK4 la déplacera dans Pilotage › Projections.
   Calculs inchangés (plan.js : affecterDeja, repartirEpargne, statutObjectif, projection…), faits une fois par émission du
   store ; l'épargne vient du budget enregistré.
   Fonctions pures exportées pour les tests : trier, analyser, resumeObjectifs, carteHtml, detailHtml, serieObjectif, livretA,
   versementReel, projectionSvg, projectionTableHtml, hypothesesHtml, valeurPoche, boutonClaude.
   Dépendances injectées (deps / ctx) : { Plan, Calc } ; window.* par défaut (ClaudePrompts compris). */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) && d[k] ? d[k] : glob(k));
  /* Phrases « Compléter avec Claude » : global du navigateur, sinon le module voisin sous Node (tests). */
  const prompts = () => glob("ClaudePrompts") ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./claude-prompts.js") : null);

  /* ---------- formats et dates ---------- */
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const eur = v => (v == null || !isFinite(v) ? "—" : nf.format(Math.round(v)) + " €");
  const eurM = v => eur(v) + "/mois";
  const pct = v => (v == null || !isFinite(v) ? "—" : (v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " %");
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const kEur = v => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " M€" : nf.format(v / 1000) + " k€");
  const moisAn = d => (d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "");
  const isoToday = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); };
  const dateCible = o => (o && (o.dateCible || o.date_cible)) || null;

  /* ---------- vocabulaire ---------- */
  const OBJ_LABEL = { matelas: "Matelas", apport: "Apport", retraite: "Retraite", projet: "Projet" };
  /* statut → [ton du badge UI, libellé] */
  const STATUTS = {
    atteint: ["bon", "atteint"], avance: ["bon", "en avance"], dans_les_temps: ["info", "dans les temps"],
    retard: ["attention", "en retard"], hors_portee: ["critique", "hors de portée"],
  };
  const ORDRE_STATUTS = ["atteint", "avance", "dans_les_temps", "retard", "hors_portee"];
  const CHEVRON_D = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';

  /** Bouton « Compléter avec Claude » (ou libellé contextuel) : ouvre Claude avec la phrase prête de la section. */
  function boutonClaude(U, section, contexte, libelle) {
    const u = U || glob("UI"), CP = prompts();
    if (!u || typeof u.demanderAClaude !== "function") return "";
    const q = CP ? CP.phrase(section, contexte) : "Boussole : aide-moi à définir ou mettre à jour mes objectifs." + (contexte ? " Concerne : " + contexte + "." : "");
    return u.demanderAClaude(q, libelle || "Compléter avec Claude");
  }

  /* =============================================================== calculs de présentation =============================================================== */
  /** Objectifs triés : priorité croissante (sans priorité à la fin), puis échéance la plus proche. */
  const trier = objs => (Array.isArray(objs) ? objs.slice() : []).filter(Boolean).sort((a, b) =>
    ((a.priorite ?? Infinity) - (b.priorite ?? Infinity)) || String(dateCible(a) || "9999").localeCompare(String(dateCible(b) || "9999")));

  /** Situation de chaque objectif : « déjà » par la cascade des poches (Plan.affecterDeja), épargne mensuelle (budget enregistré,
      Plan.capaciteEpargne) répartie par priorité (Plan.repartirEpargne), statut (Plan.statutObjectif).
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
    if (!alerte) verdict = n === 1 ? "Ton objectif est en bonne voie." : "Tes " + n + " objectifs sont en bonne voie.";
    else if (n === 1) verdict = "Ton objectif est " + STATUTS[xs[0].st.statut][1] + ".";
    else verdict = pluriel(alerte, "objectif") + " sur " + n + (alerte > 1 ? " demandent" : " demande") + " ton attention.";
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

  /** Contenu du panneau d'un objectif (lecture) et « Corriger avec Claude » pour cet objectif.
      ctx = { positions, scope, Calc, Plan, today, n, duScope, livretA, U }. */
  function detailHtml(x, ctx) {
    const c = ctx || {}, { o, st } = x, C = dep(c, "Calc"), P = dep(c, "Plan"), scope = c.scope || "foyer", n = c.n || 1, r = x.rang || c.rang || 1;
    const done = st.statut === "atteint", eff = effortTxt(x), prog = Math.max(0, Math.min(1, +st.progression || 0));
    const poches = [].concat(o.poches || []), envs = [].concat(o.enveloppes || []);
    const src = o.source === "poches" ? (poches.length || envs.length ? "pris sur " + poches.concat(envs).join(", ") : "aucune poche rattachée") : "montant saisi";
    const nom = plat(o.nom) || "sans nom";
    const rows = [
      ["Cible", eur(o.cible), dateCible(o) ? moisAn(dateCible(o)) : "sans échéance"],
      ["Déjà de côté", eur(st.deja), src],
      ["Effort requis", eff[0], eff[1]],
      ["Ton épargne actuelle en couvre", eurM(st.versementAlloue), done ? "plus rien à verser" : "versement alloué, par ordre de priorité"],
      ["Rendement attendu", o.rendement == null || o.rendement === "" ? "—" : String(o.rendement).replace(".", ",") + " %/an", "repère : Livret A " + (c.livretA || "taux réglementé en vigueur")],
    ];
    const ctxClaude = "l'objectif « " + nom + " » (" + eur(o.cible) + (dateCible(o) ? " d'ici " + moisAn(dateCible(o)) : "") + ", priorité " + r + " sur " + n + ")";
    let pochesHtml;
    if (o.source === "poches") {
      const items = poches.map(p => ["Poche", p, valeurPoche(c.positions, scope, "bloc", p, C)]).concat(envs.map(e => ["Enveloppe", e, valeurPoche(c.positions, scope, "envelope", e, C)]));
      pochesHtml = (items.length ? '<ul class="ov-poches">' + items.map(([k, nm, v]) => '<li><span><span class="ov-poche-k">' + esc(k) + "</span> " + esc(nm) + '</span><b class="ov-num">' + esc(eur(v)) + "</b></li>").join("") + "</ul>"
        : '<p class="ov-note">Aucune poche rattachée : demande à Claude d\'en rattacher une.</p>') +
        (x.brut > st.deja + 0.5 && !done ? '<p class="ov-note">Ces poches contiennent ' + esc(eur(x.brut)) + " " + esc(c.duScope || "du foyer") + " ; " + esc(eur(x.brut - st.deja)) + " servent d'abord un objectif prioritaire.</p>" : "") +
        '<p class="ov-note">L\'argent d\'une poche sert d\'abord l\'objectif prioritaire ; le reste passe au suivant.</p>';
    } else pochesHtml = '<p class="ov-note">Montant saisi : ' + esc(eur(st.deja)) + ". Pour le mettre à jour, ou pour rattacher l'objectif à des poches de tes placements (il suivra alors leur valeur), passe par Claude.</p>";
    return '<div class="ov-meta">' + badgeHtml(st.statut) + "<span>Priorité " + esc(r) + " sur " + esc(n) + " · " + esc(OBJ_LABEL[o.type] || o.type || "Objectif") + "</span></div>" +
      '<p class="ov-quand">' + esc(quandTxt(x)) + "</p>" +
      '<div class="ov-prog" role="progressbar" aria-label="Progression" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(prog * 100) + '"><i style="width:' + (prog * 100).toFixed(1) + '%"></i></div>' +
      '<p class="ov-note">' + esc(pct(prog)) + " de la cible</p>" +
      '<dl class="ov-dl">' + rows.map(([k, v, s]) => "<div><dt>" + esc(k) + "</dt><dd><b>" + esc(v) + "</b><span>" + esc(s) + "</span></dd></div>").join("") + "</dl>" +
      '<div class="ov-acts">' + boutonClaude(c.U, "objectifs", ctxClaude, "Corriger avec Claude") + "</div>" +
      '<p class="ov-note">Cible, échéance, priorité ou poches : demande à Claude de les corriger, puis valide sa proposition dans Agent › Propositions.</p>' +
      '<section class="ov-sec"><h3 class="ov-sec-t">Poches rattachées</h3>' + pochesHtml + "</section>" +
      '<section class="ov-sec"><h3 class="ov-sec-t">Projection de l\'objectif</h3>' + serieSvg(serieObjectif(o, st, c.today, P), o, c.today) + "</section>";
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
    if (rec > 0) return { v: rec, src: "d'après tes versements programmés (budget sans épargne)" };
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

  const H = { trier, analyser, resumeObjectifs, carteHtml, detailHtml, serieObjectif, livretA, versementReel, projectionSvg, projectionTableHtml,
    hypothesesHtml, valeurPoche, boutonClaude, STATUTS };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =================================================================== vue =================================================================== */
  let root = null, S = null, aRendre = true;
  /* anti-redessin : signatures des derniers contenus écrits ; analyse mémorisée pour l'émission courante du store */
  let sigCartes = "", sigPanneau = "", cache = null;
  const sigProj = { resume: "", chart: "", legende: "", table: "", hyp: "", tag: "", src: "", note: "" };
  /* panneau : { id, retour } */
  let pan = null, corpsPanneau = null;
  /* projection : paramètres d'exploration locaux, jamais enregistrés */
  let horizon = 10, versOverride = null;

  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const P = () => window.Plan, C = () => window.Calc;
  const deps = () => ({ Plan: P(), Calc: C() });
  const scope = () => (S && S.scope) || "foyer";
  const people = () => (S && Array.isArray(S.people) ? S.people : []);
  const nomDe = k => { const p = people().find(x => x.id === k); return (p && p.nom) || (k === "p2" ? "Conjoint(e)" : "Moi"); };
  const duScope = () => (scope() === "foyer" ? "du foyer" : C().deNom(nomDe(scope()), scope() === "p2" ? 2 : 1));
  const echap = s => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"));
  /** Analyse de l'émission courante : calculée une fois (update l'invalide), partagée par les cartes, la projection, le panneau
      et le titre de navigation. */
  function analyse() {
    const j = isoToday();
    if (!cache || cache.S !== S || cache.jour !== j) cache = { S, jour: j, a: analyser(S, deps(), j) };
    return cache.a;
  }
  const entree = id => { const a = analyse(); return { x: a.liste.find(y => String(y.o.id) === String(id)) || null, n: a.liste.length }; };
  /* Écrit seulement si le contenu a changé (cle : entrée de sigProj). */
  const poser = (cle, el, h, texte) => { if (sigProj[cle] === h) return; sigProj[cle] = h; if (texte) el.textContent = h; else el.innerHTML = h; };

  /* ---------- rendu de la page ---------- */
  function videHtml() {
    return '<div class="ov-vide"><p class="ov-vide-t">Aucun objectif pour l\'instant.</p>' +
      "<p>Un objectif daté (matelas de précaution, apport immobilier, retraite, projet) dit combien mettre de côté chaque mois et si ton épargne actuelle suffit. " +
      "Claude t'aide à les définir ; tu valides ensuite ses propositions.</p>" +
      '<div class="ov-vide-act">' + boutonClaude(U(), "objectifs", "", "Compléter avec Claude") + "</div></div>";
  }
  function render() {
    const u = U();
    if (!root || !S || !u) return;
    const a = analyse(), r = resumeObjectifs(a.liste);
    $("ovVerdict").textContent = r.verdict + (r.detail && r.n > 1 ? " (" + r.detail + ")" : "");
    $("ovVerdict").className = "ov-verdict ton-" + r.ton;
    const partage = a.liste.filter(x => x.o.source === "poches").some((x, i, L) => L.some((y, j) => j > i &&
      ((x.o.poches || []).some(p => (y.o.poches || []).includes(p)) || (x.o.enveloppes || []).some(p => (y.o.enveloppes || []).includes(p)))));
    $("ovNote").textContent = a.liste.length ? "Épargne mensuelle répartie par priorité : " + eurM(a.capacite) + " (épargne prévue au budget et reste positif)." +
      (partage ? " Plusieurs objectifs partagent une poche : l'argent d'une poche sert d'abord l'objectif prioritaire." : "") : "";
    const h = a.liste.length ? u.voirPlus(a.liste, 5, x => carteHtml(x, a.liste.length), "Voir plus d'objectifs", "div", "ov-objectifs") : videHtml();
    if (h !== sigCartes) {
      const act = document.activeElement, dedans = act && $("ovCartes").contains(act) && act.closest;
      const porteur = dedans ? act.closest("[data-ui-carte]") || act.closest("[data-ui-voirplus]") : null;
      const sel = !porteur ? null : porteur.hasAttribute("data-ui-carte") ? '[data-ui-carte="' + echap(porteur.getAttribute("data-ui-carte")) + '"]'
        : '[aria-controls="' + echap(porteur.getAttribute("aria-controls")) + '"]';
      sigCartes = h; $("ovCartes").innerHTML = h;
      const n = sel && $("ovCartes").querySelector(sel); if (n) n.focus();
    }
    renderProjection();
    renderPanneau();
  }

  /* ---------- projection (accordéon, simulateur local) ---------- */
  function renderProjection(forceInput) {
    if (!root || !S) return;
    const t = analyse().totaux, real = versementReel(S, t, scope()), inp = $("ovVers");
    const v = versOverride != null ? versOverride : real ? real.v : 0;
    const res = P().projection({ positions: S.positions, scope: scope(), versementMensuel: v, annees: horizon });
    const N = horizon, y0 = new Date().getFullYear();
    poser("resume", $("ovProjResume"), "· dans " + N + " ans : " + eur(res.central[N]) + " (central)", true);
    if (!$("ovProjAcc").hasAttribute("open")) return; // dessinée à l'ouverture seulement
    if (forceInput || versOverride == null || document.activeElement !== inp) {
      const val = String(Math.round(v * 100) / 100);
      if (inp.value !== val) inp.value = val;
    }
    poser("tag", $("ovVersTag"), versOverride != null ? '<button type="button" class="ov-tag scen" data-ov-vreset title="Revenir à la valeur réelle">scénario ↺</button>'
      : real ? '<span class="ov-tag reel" title="Repris de tes données">réel</span>' : "");
    poser("src", $("ovVersSrc"), versOverride != null ? "simulation locale, non enregistrée" + (real ? " · réel : " + eurM(real.v) : "") : real ? real.src : "aucune épargne mensuelle connue : essaie un montant", true);
    poser("note", $("ovProjNote"), "Patrimoine financier " + duScope() + " aujourd'hui : " + eur(res.central[0]) + ".", true);
    poser("chart", $("ovChart"), projectionSvg(res, N, y0, $("ovChart").clientWidth || 640));
    poser("legende", $("ovLegend"), '<span><i class="ln"></i>scénario central</span><span><i class="bd"></i>entre pessimiste et optimiste (pointillés)</span>');
    poser("table", $("ovProjTable"), projectionTableHtml(res, v, N, y0));
    poser("hyp", $("ovHyp"), hypothesesHtml(res, P().RENDEMENTS));
  }

  /* ---------- panneau (lecture) ---------- */
  function contenuPanneau() {
    const { x, n } = entree(pan.id);
    return detailHtml(x, { positions: S.positions, scope: scope(), Calc: C(), Plan: P(), today: isoToday(), n, duScope: duScope(),
      livretA: livretA(S, window.Reperes || null), U: U() });
  }
  function optionsPanneau(h) {
    const u = U(), { x } = entree(pan.id), o = x && x.o;
    const titre = plat(o && o.nom) || "Objectif sans nom";
    const pied = o ? u.demanderAClaude("Aide-moi à atteindre mon objectif « " + titre + " » (" + eur(o.cible) + (dateCible(o) ? " d'ici " + moisAn(dateCible(o)) : "") + ") avec Boussole : quel effort, sur quels placements ?") : null;
    return { titre, contenu: h, retour: pan.retour, pied, surFermeture: fermeture };
  }
  function fermeture(o) {
    const p = pan;
    pan = null; sigPanneau = "";
    if ((o && o.focus === false) || !root || !p) return;
    if (p.retour && p.retour.isConnected) return;
    const el = p.id != null && root.querySelector('[data-ui-carte="' + echap(p.id) + '"]');
    (el || $("ovTitre")).focus();
  }
  function ouvrir(p) {
    const u = U();
    if (!u || !entree(p.id).x) return;
    pan = Object.assign({}, p);
    const h = contenuPanneau();
    sigPanneau = h;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(h));
  }
  /* Rafraîchit le panneau ouvert quand ses données changent. */
  function renderPanneau() {
    const u = U();
    if (!pan || !u || !u.panneau.ouvert()) return;
    if (!entree(pan.id).x) { u.panneau.fermer({ focus: false }); return; }
    const h = contenuPanneau();
    if (h === sigPanneau) return;
    sigPanneau = h;
    const y = corpsPanneau ? corpsPanneau.scrollTop : 0;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(h));
    corpsPanneau.scrollTop = y;
  }

  function mount(r) {
    root = r;
    $("ovTitre").setAttribute("tabindex", "-1");
    const u = U();
    if (u) {
      $("ovCompleter").innerHTML = boutonClaude(u, "objectifs", "", "Compléter avec Claude");
      $("ovClaude").innerHTML = u.demanderAClaude("Vais-je atteindre mes objectifs dans Boussole ? Passe-les en revue avec moi et dis-moi quoi ajuster.");
      u.brancher($("ovCartes"), { surCarte: (id, el) => ouvrir({ id, retour: el }) });
      u.bascule($("ovHorizon"), { label: "Horizon", options: [5, 10, 20, 30].map(n => ({ id: String(n), label: n + " ans" })), actif: String(horizon),
        surChange: id => { horizon = +id; renderProjection(); } });
    }
    root.addEventListener("click", e => {
      const t = e.target;
      if (t && t.closest && t.closest("[data-ov-vreset]")) { versOverride = null; renderProjection(true); $("ovVers").focus(); }
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
    S = snap; cache = null;
    if (pan && !(snap.objectifs || []).some(o => String(o.id) === String(pan.id)) && U()) U().panneau.fermer({ focus: false });
    aRendre = true;
    if (visible) { render(); aRendre = false; }
  }
  function show() { if (aRendre) { render(); aRendre = false; } }
  function headline() {
    if (!S || !(S.ready || S.dbOk === false)) return "–";
    const r = resumeObjectifs(analyse().liste);
    return r.n ? r.verdict : "Objectifs à fixer";
  }

  const api = { mount, update, show, headline };
  const reg = () => App.register("objectifs-view", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
