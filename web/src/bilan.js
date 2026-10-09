/* Bilan › Vue d'ensemble : chiffres clés, composition du patrimoine, flux du mois, allocation, évolution, à traiter.
   Calculs : BilanCalc (bilan-calc.js), Plan (budget, score), Rules (alertes), Calc. Lecture seule : aucune écriture. */
(function () {
  let S = null, root = null, dirty = true, lastEvol = null, resizeTmr = null;
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const eur = v => (v == null || !isFinite(v) ? "—" : nf.format(Math.round(v)) + "\u00a0€");
  const kEur = v => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + "\u00a0M€" : nf.format(Math.round(v / 1000)) + "\u00a0k€");
  const pct = v => (v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString("fr-FR") + " %");
  const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
  const $ = id => root.querySelector("#" + id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  const frDate = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  const link = (route, txt) => '<a class="bl-link" href="#' + route + '" data-goto="' + route + '">' + esc(txt) + "</a>";

  /* Couleurs stables : une série du thème par classe d'actifs, par tranche de liquidité, par catégorie du patrimoine. */
  const CLASS_COL = { actions: "--s1", obligations: "--s2", immobilier: "--s3", fonds_euros: "--s4", monetaire: "--s5", crypto: "--s6", or: "--s9", autres: "--s8" };
  const LIQ_COL = { immediate: "--s5", jours: "--s2", semaines: "--s4", bloque: "--s3" };
  const ENV_COLS = ["--s1", "--s2", "--s4", "--s5", "--s7", "--s9", "--s6", "--s8"];
  const COMP_COL = { financier: "--s1", immobilier: "--s3", autres: "--s5", dettes: "--s6" };
  const RANK = { crit: 0, warn: 1, info: 2 };
  const LEVEL_TXT = { crit: "urgent", warn: "à traiter", info: "à surveiller", piste: "piste" };

  /* ---------- périmètre ---------- */
  const scope = () => (S && S.scope) || "foyer";
  const DEFAULT_NOMS = { p1: "Moi", p2: "Conjoint(e)" };
  function nomOf(id) { const p = ((S && S.people) || []).find(x => x.id === id); return (p && p.nom) || DEFAULT_NOMS[id] || id; }
  function duScope() { return scope() === "foyer" ? "du foyer" : window.Calc.deNom(nomOf(scope()), scope() === "p2" ? 2 : 1); }
  const lignesBudget = () => (S.budget && Array.isArray(S.budget.lignes) ? S.budget.lignes : []);
  const totaux = () => window.Plan.budgetTotaux(lignesBudget(), S.profil, scope());
  /* Budget exploitable : des revenus et au moins une dépense ou une épargne saisie (même critère que le score). */
  const budgetRempli = t => t.revenus > 0 && (t.depensesLignes > 0 || t.epargne > 0);

  /* ---------- chiffres clés ---------- */
  function renderSummary(comp, t) {
    $("blNetLabel").textContent = "Patrimoine net " + duScope();
    $("blNet").textContent = eur(comp.net);
    $("blNetSub").textContent = comp.dettes.total > 0 ? "brut " + kEur(comp.brut) + " · dettes " + kEur(comp.dettes.total) : comp.brut > 0 ? "aucune dette enregistrée" : "";

    // financier en direct, Δ depuis la photo d'au moins 28 jours
    const fin = window.Calc.financier(S.positions, scope());
    $("blFin").textContent = eur(fin);
    const snaps = (S.snapshots || []).filter(s => s && s[scope()] != null).sort((a, b) => (a.date < b.date ? -1 : 1));
    const ref = snaps.slice().reverse().find(s => daysBetween(s.date, today()) >= 28);
    const fs = $("blFinSub");
    if (ref) {
      const d = fin - +ref[scope()];
      fs.className = "small " + (d >= 0 ? "bl-up" : "bl-down");
      fs.textContent = sgn(d) + eur(Math.abs(d)) + " en " + daysBetween(ref.date, today()) + " jours";
      fs.title = "Depuis la photo du " + frDate(ref.date);
    } else { fs.className = "small muted"; fs.textContent = "historique en cours de constitution"; fs.removeAttribute("title"); }

    // épargne du mois
    if (budgetRempli(t)) {
      $("blEpargne").textContent = eur(window.Plan.capaciteEpargne(t));
      $("blEpargneSub").textContent = "par mois · taux " + pct((t.tauxEpargne || 0) * 100);
    } else {
      $("blEpargne").innerHTML = link("avenir/plan", "À renseigner");
      $("blEpargneSub").textContent = "à partir de votre budget";
    }

    // matelas : poche Épargne / dépenses mensuelles du budget
    const cush = window.Calc.poche(S.positions, scope(), "Épargne");
    if (t.depensesLignes > 0 && t.depenses > 0) {
      const mois = cush / t.depenses;
      $("blMatelas").textContent = mois.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " mois";
      $("blMatelasSub").textContent = eur(cush) + " disponibles · repère 3 à 6 mois";
    } else {
      $("blMatelas").textContent = "—";
      $("blMatelasSub").textContent = cush > 0 ? eur(cush) + " d'épargne · dépenses à renseigner" : "dépenses à renseigner";
    }

    // santé
    const el = $("blSante"), sub = $("blSanteSub");
    let sc = null;
    try { sc = window.Plan.score({ positions: S.positions, profil: S.profil, config: S.config, budget: S.budget, scope: scope(), today: new Date() }); } catch (e) { console.error("bilan score", e); }
    const complets = sc ? sc.items.filter(i => !i.aCompleter).length : 0;
    if (complets) {
      const cls = sc.total >= 80 ? "good" : sc.total >= 60 ? "warn" : "crit";
      el.innerHTML = '<span class="bl-score ' + cls + '">' + sc.total + '</span><span class="bl-sur">/100</span>';
      sub.innerHTML = '<span class="bl-verdict ' + cls + '">' + (cls === "good" ? "Solide" : cls === "warn" ? "Correct" : "À consolider") + "</span> · " + link("diagnostic/sante", "Détail");
    } else {
      el.textContent = "—";
      sub.innerHTML = link("diagnostic/sante", "Compléter pour calculer");
    }
    return sc;
  }

  /* ---------- ce que je possède, ce que je dois ---------- */
  function renderComposition(comp) {
    $("blCompScope").textContent = duScope();
    const actifs = comp.actifs.filter(a => a.total > 0);
    const brut = comp.brut, dettes = comp.dettes.total;
    const seg = (cle, v, label) => '<span style="width:' + (v / brut * 100).toFixed(3) + "%;background:var(" + COMP_COL[cle] + ')" title="' + esc(label + " : " + eur(v)) + '"></span>';
    if (brut > 0) {
      $("blCompBars").innerHTML =
        '<div class="bl-brow"><span class="bl-blbl">Actifs</span><span class="bl-stack" role="img" aria-label="' + esc("Actifs : " + actifs.map(a => a.label + " " + eur(a.total)).join(", ")) + '">' + actifs.map(a => seg(a.cle, a.total, a.label)).join("") + '</span><span class="num bl-bv">' + kEur(brut) + "</span></div>" +
        '<div class="bl-brow"><span class="bl-blbl">Dettes</span><span class="bl-stack bl-stack-d" role="img" aria-label="' + esc("Dettes : " + eur(dettes)) + '">' + (dettes > 0 ? seg("dettes", Math.min(dettes, brut), "Dettes") : "") + '</span><span class="num bl-bv">' + (dettes > 0 ? "−" + kEur(dettes) : "0 €") + "</span></div>";
      $("blCompLegend").innerHTML = actifs.map(a => '<span><i style="background:var(' + COMP_COL[a.cle] + ')"></i>' + esc(a.label) + " " + pct(a.total / brut * 100) + "</span>").join("") +
        (dettes > 0 ? '<span><i style="background:var(' + COMP_COL.dettes + ')"></i>Dettes, ' + pct(dettes / brut * 100) + " des actifs</span>" : "");
    } else {
      $("blCompBars").innerHTML = '<p class="muted small">Aucun actif enregistré pour ce périmètre.</p>';
      $("blCompLegend").innerHTML = "";
    }
    const lines = ls => ls.map(l => '<div class="bl-cl"><span>' + esc(l.label) + '</span><span class="num">' + eur(l.montant) + "</span></div>").join("");
    const grp = b => '<div class="bl-cg"><div class="bl-ch"><span>' + esc(b.label) + '</span><span class="num">' + eur(b.total) + "</span></div>" + lines(b.lignes) + "</div>";
    $("blCompTable").innerHTML =
      '<div class="bl-ccol"><h3>Actifs</h3>' + (actifs.length ? actifs.map(grp).join("") : '<p class="muted small">Aucun actif.</p>') +
      '<div class="bl-ct"><span>Total des actifs</span><span class="num">' + eur(brut) + "</span></div></div>" +
      '<div class="bl-ccol"><h3>Dettes</h3>' + (comp.dettes.lignes.length ? '<div class="bl-cg">' + lines(comp.dettes.lignes) + "</div>" : '<p class="muted small">Aucune dette enregistrée.</p>') +
      '<div class="bl-ct"><span>Total des dettes</span><span class="num">' + eur(dettes) + "</span></div></div>" +
      '<div class="bl-net"><span>Patrimoine net ' + esc(duScope()) + '</span><span class="num">' + eur(comp.net) + "</span></div>";
    const p = S.profil || {};
    $("blCompHint").hidden = (Array.isArray(p.biens) && p.biens.length > 0) || (Array.isArray(p.credits) && p.credits.length > 0);
  }

  /* ---------- flux du mois ---------- */
  function renderFlux(t) {
    const f = window.BilanCalc.flux(t);
    const el = $("blFlux");
    if (f.vide || !budgetRempli(t)) {
      $("blFluxHead").textContent = "";
      const connu = [];
      if (t.revenus > 0) connu.push("revenus " + eur(t.revenus) + "/mois");
      if (t.mensualites > 0) connu.push("crédits " + eur(t.mensualites) + "/mois");
      el.innerHTML = '<div class="bl-empty"><h3>Votre budget est à remplir</h3>' +
        "<p>Quelques lignes (logement, courses, transport, épargne…) suffisent pour voir où part chaque euro de vos revenus, " + esc(duScope()) + ".</p>" +
        (connu.length ? '<p class="small muted">Déjà connu grâce au profil : ' + esc(connu.join(", ")) + ".</p>" : "") +
        '<a class="bl-btn" href="#avenir/plan" data-goto="avenir/plan">Remplir mon budget</a></div>';
      return;
    }
    $("blFluxHead").innerHTML = 'Revenus <b class="num">' + esc(eur(f.revenus)) + "</b>/mois";
    const base = Math.max(f.revenus, 1);
    const col = s => (s.type === "epargne" ? "var(--accent)" : s.type === "reste" ? "var(--good)" : "var(--s8)");
    el.innerHTML = (f.deficit ? '<div class="bl-warn" role="status">Vos dépenses dépassent vos revenus de <b class="num">' + esc(eur(f.manque)) + "</b>/mois.</div>" : "") +
      '<div class="bl-rows">' + f.sorties.map(s =>
        '<div class="bl-row bl-row-' + s.type + '"><span class="bl-rl" title="' + esc(s.label) + '">' + esc(s.label) + '</span>' +
        '<span class="bl-track" aria-hidden="true"><span class="bl-fill" style="width:' + Math.min(100, s.montant / base * 100).toFixed(2) + "%;background:" + col(s) + '"></span></span>' +
        '<span class="num bl-rv">' + eur(s.montant) + '</span><span class="num bl-rp">' + (f.revenus ? s.pct + " %" : "—") + "</span></div>").join("") + "</div>" +
      '<p class="small muted bl-note">En pourcentage des revenus. ' + link("avenir/plan", "Modifier le budget") + "</p>";
  }

  /* ---------- allocation ---------- */
  let allocMode = "classe";
  const allocImmo = { classe: true, liquidite: true, enveloppe: false };
  try { const m = localStorage.getItem("bilan-alloc"); if (["classe", "enveloppe", "liquidite"].includes(m)) allocMode = m; } catch (e) {}
  function renderAlloc() {
    root.querySelectorAll("#blAllocSeg [data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === allocMode)));
    const hasImmo = Array.isArray(S.profil && S.profil.biens) && S.profil.biens.some(b => +b.valeur > 0);
    const chk = $("blAllocImmo");
    chk.checked = allocImmo[allocMode];
    chk.disabled = !hasImmo;
    chk.closest("label").classList.toggle("off", !hasImmo);
    const rows = window.BilanCalc.allocation(S.positions, S.profil, scope(), allocMode, { financierSeul: !allocImmo[allocMode] });
    const total = rows.reduce((a, r) => a + r.montant, 0);
    $("blAllocTotal").textContent = total > 0 ? "Total " + eur(total) : "";
    const color = (r, i) => allocMode === "classe" ? CLASS_COL[r.cle] || "--s8" : allocMode === "liquidite" ? LIQ_COL[r.cle] || "--s8" : r.cle === "__immo" ? "--s3" : ENV_COLS[i % ENV_COLS.length];
    const max = Math.max(1, ...rows.map(r => r.pct));
    $("blAlloc").innerHTML = rows.length ? rows.map((r, i) =>
      '<div class="bl-row"><span class="bl-rl" title="' + esc(r.label) + '"><i class="bl-sw" style="background:var(' + color(r, i) + ')"></i>' + esc(r.label) + "</span>" +
      '<span class="bl-track" aria-hidden="true"><span class="bl-fill" style="width:' + (r.pct / max * 100).toFixed(2) + "%;background:var(" + color(r, i) + ')"></span></span>' +
      '<span class="num bl-rv">' + eur(r.montant) + '</span><span class="num bl-rp">' + pct(r.pct) + "</span></div>").join("")
      : '<p class="muted small">Aucun placement enregistré pour ce périmètre.</p>';
    $("blAllocNote").textContent = allocMode === "liquidite" ? "Bloqué : PER, immobilier ; quelques semaines : assurance-vie."
      : allocMode === "classe" ? "Classes déduites du nom de chaque poche." : "Une enveloppe par compte ou contrat.";
  }

  /* ---------- évolution ----------
     Période (1M … Tout, ou dates libres) et pas d'agrégation via Periodes (periodes.js) ; choix mémorisés dans « bilan-evo ».
     Le net estimé ajoute aux placements de chaque photo l'immobilier, les autres biens et les dettes d'aujourd'hui :
     ses variations sont donc celles des placements. */
  function niceStep(r) { const p = Math.pow(10, Math.floor(Math.log10(r || 1))), n = r / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  const PER_COURT = { "1m": "1M", "3m": "3M", "6m": "6M", ytd: "Depuis janv.", "1a": "1 an", "3a": "3 ans", tout: "Tout", perso: "Personnalisé" };
  const MULTI = ["mois", "trimestre", "annee"];
  const evo = { periode: "tout", du: "", au: "", gran: "auto", vue: "courbe" };
  try { const s = JSON.parse(localStorage.getItem("bilan-evo") || "null"); if (s && typeof s === "object") Object.keys(evo).forEach(k => { if (typeof s[k] === "string") evo[k] = s[k]; }); } catch (e) {}
  const saveEvo = () => { try { localStorage.setItem("bilan-evo", JSON.stringify(evo)); } catch (e) {} };
  const Per = () => window.Periodes || null;
  const pctS = v => (v == null || !isFinite(v) ? "" : sgn(v) + Math.abs(v).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %");
  const eurS = v => sgn(v) + eur(Math.abs(v));
  const kEurS = v => sgn(v) + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + "\u00a0k€" : eur(Math.abs(v)));
  const isoOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !isNaN(Date.parse(s));

  function evoState(pts) {
    const P = Per();
    if (!P.PERIODES.some(p => p.id === evo.periode)) evo.periode = "tout";
    if (!P.GRANULARITES.some(g => g.id === evo.gran)) evo.gran = "auto";
    const perso = evo.periode === "perso" && isoOk(evo.du) && isoOk(evo.au);
    const b = window.Periodes.bornes(perso ? { du: evo.du, au: evo.au } : evo.periode === "perso" ? "tout" : evo.periode, today(), pts[0].date);
    return { b, gran: evo.gran === "auto" ? P.auto(b) : evo.gran };
  }
  function renderEvoCtl(st) {
    const P = Per(), per = $("blEvoPer"), gr = $("blEvoGran");
    if (!per.dataset.built) {
      per.innerHTML = P.PERIODES.map(p => '<button type="button" data-per="' + esc(p.id) + '">' + esc(PER_COURT[p.id] || p.label) + "</button>").join("");
      gr.innerHTML = P.GRANULARITES.map(g => '<option value="' + esc(g.id) + '">' + esc(g.label) + "</option>").join("");
      per.dataset.built = "1";
    }
    per.querySelectorAll("[data-per]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.per === evo.periode)));
    $("blEvoDates").hidden = evo.periode !== "perso";
    const du = $("blEvoDu"), au = $("blEvoAu");
    du.max = au.max = today();
    if (document.activeElement !== du) du.value = st.b.du;
    if (document.activeElement !== au) au.value = st.b.au;
    const gAuto = P.GRANULARITES.find(g => g.id === "auto"), gEff = P.GRANULARITES.find(g => g.id === st.gran);
    const oAuto = gr.querySelector('option[value="auto"]');
    if (oAuto && gAuto) oAuto.textContent = gAuto.label + (gEff ? " (" + gEff.label.toLowerCase() + ")" : "");
    gr.value = evo.gran;
    const multi = MULTI.includes(st.gran), vue = multi && evo.vue === "variations" ? "variations" : "courbe";
    $("blEvoVue").hidden = !multi;
    $("blEvoVue").querySelectorAll("[data-vue]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.vue === vue)));
    return vue;
  }

  function renderEvolution(pts) {
    lastEvol = pts;
    const el = $("blChart"), P = Per();
    $("blEvoCtl").hidden = !P || pts.length < 2;
    $("blEvolNote").textContent = ""; $("blEvolLegend").innerHTML = ""; $("blEvoResume").textContent = "";
    if (pts.length < 2) { el.innerHTML = '<p class="muted small bl-chart-empty">La courbe se construit chaque soir.</p>'; return; }
    const lastPt = pts[pts.length - 1];
    let rows, vue = "courbe", cat = false;
    if (P) {
      const st = evoState(pts);
      vue = renderEvoCtl(st);
      cat = MULTI.includes(st.gran); // mois, trimestre, année : une colonne par période, espacement régulier
      const n = window.Periodes.agreger(pts, st.b, st.gran, p => p.net), f = window.Periodes.agreger(pts, st.b, st.gran, p => p.financier);
      const fBy = {}; f.forEach(x => { fBy[x.cle] = x; });
      rows = n.map(x => { const y = fBy[x.cle] || {};
        return { date: x.date, label: x.label, net: x.valeur, financier: y.valeur, varNet: x.variation, varNetPct: x.variationPct, varFin: y.variation, varFinPct: y.variationPct, live: !!lastPt.live && x.date === lastPt.date }; });
      const rf = window.Periodes.resume(f, pts, st.b, p => p.financier), rn = window.Periodes.resume(n, pts, st.b, p => p.net);
      const r = $("blEvoResume");
      if (rf && rf.variation != null && isFinite(rf.variation)) {
        const pc = [rf.variationPct != null ? pctS(rf.variationPct) + " pour les placements" : "", rn && rn.variationPct != null ? pctS(rn.variationPct) + " pour le net estimé" : ""].filter(Boolean).join(", ");
        r.innerHTML = '<b class="num ' + (rf.variation >= 0 ? "bl-up" : "bl-down") + '">' + esc(eurS(rf.variation)) + "</b> sur la période" + (pc ? '<span class="muted"> : ' + esc(pc) + "</span>" : "");
      } else r.innerHTML = "";
    } else rows = pts.map(p => ({ date: p.date, label: frDate(p.date), net: p.net, financier: p.financier, live: p.live }));

    const cw = el.clientWidth || 560, narrow = cw < 480;
    const W = Math.round(Math.min(1150, Math.max(300, cw))), H = narrow ? 210 : 240, L = narrow ? 52 : 60, R = 14, T = 16, B = 28;
    const lblW = Math.max(4, ...rows.map(p => String(p.label).length)) * 6.7 + 10; // ~6,7 px par caractère (Plex Mono 11 px)
    if (vue === "variations") return drawVariations(el, rows, { W, H, L, R, T, B, lblW });
    if (rows.length < 2) { el.innerHTML = '<p class="muted small bl-chart-empty">Pas assez de points sur cette période : élargissez-la ou choisissez un pas plus fin.</p>'; return; }
    const ts = rows.map((p, i) => (cat ? i : new Date(p.date + "T12:00:00").getTime())), x0 = ts[0], x1 = ts[ts.length - 1];
    const vals = rows.flatMap(p => [p.net, p.financier]).filter(v => v != null && isFinite(v));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1000;
    const allPos = lo >= 0; lo -= pad; hi += pad; if (allPos) lo = Math.max(0, lo);
    const step = niceStep((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const X = t => L + (x1 === x0 ? 0 : (t - x0) / (x1 - x0)) * (W - L - R), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let g = "";
    for (let v = lo; v <= hi + step / 2; v += step) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + kEur(v) + "</text>";
    // libellés de période (un sur k pour rester lisible), le dernier toujours affiché
    // libellés sans chevauchement : le premier est calé à gauche, le dernier (toujours affiché) à droite, les autres centrés
    const xLast = X(ts[ts.length - 1]);
    let right = -Infinity;
    rows.forEach((p, i) => {
      const x = X(ts[i]), last = i === rows.length - 1;
      const gauche = i === 0 ? x : last ? x - lblW : x - lblW / 2, droite = i === 0 ? x + lblW : last ? x : x + lblW / 2;
      if (!last && (gauche < right + 4 || droite > xLast - lblW - 4)) return;
      right = droite;
      const a = i === 0 ? "start" : last ? "end" : "middle";
      g += '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + (H - B) + '" y2="' + (H - B + 4) + '" stroke="var(--line2)"/><text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + a + '">' + esc(p.label) + "</text>";
    });
    const real = rows.map((p, i) => ({ p, i })).filter(o => !o.p.live);
    const live = rows[rows.length - 1].live ? rows.length - 1 : -1;
    const tip = (p, key, lbl) => { const v = key === "net" ? p.varNet : p.varFin, vp = key === "net" ? p.varNetPct : p.varFinPct;
      return lbl + ", " + p.label + " : " + eur(p[key]) + (v != null && isFinite(v) ? " (" + eurS(v) + (vp != null ? ", " + pctS(vp) : "") + " sur la période)" : "") + (p.live ? " · en direct" : ""); };
    function serie(key, color, w, lbl) {
      let s = "";
      if (real.length > 1) s += '<path d="' + real.map((o, k) => (k ? "L" : "M") + X(ts[o.i]).toFixed(1) + "," + Y(o.p[key]).toFixed(1)).join("") + '" fill="none" stroke="' + color + '" stroke-width="' + w + '" stroke-linejoin="round"/>';
      if (live >= 0 && real.length) { const lr = real[real.length - 1]; s += '<line x1="' + X(ts[lr.i]).toFixed(1) + '" y1="' + Y(lr.p[key]).toFixed(1) + '" x2="' + X(ts[live]).toFixed(1) + '" y2="' + Y(rows[live][key]).toFixed(1) + '" stroke="' + color + '" stroke-width="' + w + '" stroke-dasharray="4 4"/>'; }
      s += rows.map((p, i) => { const last = i === rows.length - 1;
        return '<circle cx="' + X(ts[i]).toFixed(1) + '" cy="' + Y(p[key]).toFixed(1) + '" r="' + (last ? 4.5 : 3) + '" fill="' + (last ? color : "var(--surface)") + '" stroke="' + color + '" stroke-width="1.5"><title>' + esc(tip(p, key, lbl)) + "</title></circle>"; }).join("");
      return s;
    }
    const lp = rows[rows.length - 1];
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc("Évolution " + duScope() + " : patrimoine net estimé " + eur(lp.net) + ", placements financiers " + eur(lp.financier)) + '">' + g +
      serie("financier", "var(--muted)", 1.6, "Placements financiers") + serie("net", "var(--accent)", 2.2, "Patrimoine net estimé") +
      '<text class="bl-end" x="' + (X(ts[ts.length - 1]) - 8).toFixed(1) + '" y="' + (Y(lp.net) - 10).toFixed(1) + '" text-anchor="end">' + esc(kEur(lp.net)) + "</text></svg>";
    $("blEvolLegend").innerHTML = '<span><i class="bl-ln acc"></i>Patrimoine net estimé</span><span><i class="bl-ln mut"></i>Placements financiers</span>';
    $("blEvolLegend").title = "Net estimé : placements de chaque photo + immobilier, autres biens et dettes d'aujourd'hui.";
    if (live >= 0) $("blEvolNote").textContent = "pointillé : valeur en direct";
  }

  /* Barres de variation par période (mois, trimestre, année) : vert si hausse, rouge si baisse. */
  function drawVariations(el, rows, d) {
    const bars = rows.filter(p => p.varFin != null && isFinite(p.varFin));
    if (!bars.length) { el.innerHTML = '<p class="muted small bl-chart-empty">Aucune période précédente pour calculer une variation : élargissez la période.</p>'; return; }
    const { W, H, L, R, T, B, lblW } = d;
    let lo = Math.min(0, ...bars.map(p => p.varFin)), hi = Math.max(0, ...bars.map(p => p.varFin));
    if (lo === hi) hi = 1000;
    const step = niceStep((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B), slot = (W - L - R) / bars.length, bw = Math.max(4, Math.min(48, slot * 0.6));
    let g = "";
    for (let v = lo; v <= hi + step / 2; v += step) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + kEurS(v) + "</text>";
    g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="var(--line2)" stroke-width="1.5"/>';
    const every = Math.max(1, Math.ceil((lblW + 4) / slot));
    bars.forEach((p, i) => {
      const cx = L + slot * (i + 0.5), y = Y(Math.max(0, p.varFin)), h = Math.max(1, Math.abs(Y(p.varFin) - Y(0))), up = p.varFin >= 0;
      g += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="var(' + (up ? "--good" : "--crit") + ')"><title>' +
        esc(p.label + " : " + eurS(p.varFin) + (p.varFinPct != null ? " (" + pctS(p.varFinPct) + " des placements)" : "") + " · fin de période " + eur(p.financier) + (p.live ? " · en direct" : "")) + "</title></rect>";
      if (bars.length <= 8) g += '<text class="bl-bar-v" x="' + cx.toFixed(1) + '" y="' + (up ? y - 5 : y + h + 12).toFixed(1) + '" text-anchor="middle">' + esc(kEurS(p.varFin)) + "</text>";
      if (!(i % every)) g += '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(p.label) + "</text>";
    });
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc("Variations par période " + duScope() + " : " + bars.map(p => p.label + " " + eurS(p.varFin)).join(", ")) + '">' + g + "</svg>";
    $("blEvolLegend").innerHTML = '<span><i style="background:var(--good)"></i>hausse</span><span><i style="background:var(--crit)"></i>baisse</span><span>variation des placements, identique pour le net estimé</span>';
  }

  /* ---------- à traiter ----------
     Même liste que Recommandations › Actions : construite par Actions.construire (actions.js) sur l'état courant.
     (Actions.items() renvoie la liste calculée lors du dernier update du module Actions, qui passe après le Bilan :
     on reconstruit donc avec le même contexte pour ne jamais afficher la liste du périmètre précédent.)
     Repli sans actions.js : alertes des règles puis pistes du score, triées crit > warn > info > piste. */
  function aTraiter(sc) {
    const ctx = { positions: S.positions, config: S.config || {}, scope: scope(), people: S.people, today: today(), status: S.status, profil: S.profil, budget: S.budget };
    const A = window.Actions;
    if (A && typeof A.construire === "function") {
      try { return A.construire(ctx, window.Rules, window.Plan).filter(a => a && (RANK[a.level] != null || a.level === "piste")); }
      catch (e) { console.error("bilan actions", e); }
    } else if (A && typeof A.items === "function") return A.items();
    const out = [];
    if (window.Rules) {
      try {
        window.Rules.evaluate(ctx.config.rules || [], ctx).concat(window.Rules.builtins(ctx))
          .filter(a => a && RANK[a.level] != null)
          .forEach(a => out.push({ level: a.level, title: a.title, text: a.text }));
      } catch (e) { console.error("bilan règles", e); }
      out.sort((a, b) => RANK[a.level] - RANK[b.level]);
    }
    if (sc) sc.items.filter(i => !i.aCompleter && i.points < i.sur)
      .sort((a, b) => a.points - b.points)
      .forEach(i => out.push({ level: "piste", title: i.titre, text: i.piste }));
    return out;
  }
  function renderTodo(sc) {
    const A = aTraiter(sc), top = A.slice(0, 3);
    $("blTodoCount").textContent = A.length > 3 ? "3 sur " + A.length : "";
    $("blTodo").innerHTML = top.length ? top.map(a =>
      '<div class="bl-act ' + esc(a.level) + '"><span class="bl-pill ' + esc(a.level) + '">' + (LEVEL_TXT[a.level] || "info") + "</span>" +
      '<div class="bl-act-b"><strong>' + esc(a.title) + '</strong><div class="small">' + esc(a.text) + "</div></div>" +
      link("recos/actions", "Voir") + "</div>").join("")
      : '<div class="bl-act good"><span class="bl-pill good">ok</span><div class="bl-act-b">Rien d\'urgent.</div></div>';
  }

  /* ---------- rendu ---------- */
  function render() {
    if (!root || !S) return;
    const ready = S.ready !== false;
    $("blLoading").hidden = ready; $("blBody").hidden = !ready;
    if (!ready || !window.BilanCalc || !window.Plan || !window.Calc) return;
    const comp = window.BilanCalc.composition(S.positions, S.profil, scope());
    const t = totaux();
    const sc = renderSummary(comp, t);
    renderComposition(comp);
    renderFlux(t);
    renderAlloc();
    renderEvolution(window.BilanCalc.evolution(S.snapshots || [], S.positions, S.profil, scope(), today()));
    renderTodo(sc);
  }

  function mount(r) {
    root = r;
    $("blAllocSeg").addEventListener("click", e => {
      const b = e.target.closest("[data-mode]"); if (!b || !S) return;
      allocMode = b.dataset.mode;
      try { localStorage.setItem("bilan-alloc", allocMode); } catch (err) {}
      renderAlloc();
    });
    $("blAllocImmo").addEventListener("change", e => { allocImmo[allocMode] = e.target.checked; if (S) renderAlloc(); });
    const reEvo = () => { saveEvo(); if (S && lastEvol) renderEvolution(lastEvol); };
    $("blEvoPer").addEventListener("click", e => {
      const b = e.target.closest("[data-per]"); if (!b) return;
      if (b.dataset.per === "perso" && !(isoOk(evo.du) && isoOk(evo.au))) { evo.du = $("blEvoDu").value; evo.au = $("blEvoAu").value; }
      evo.periode = b.dataset.per; reEvo();
    });
    ["blEvoDu", "blEvoAu"].forEach(id => $(id).addEventListener("change", e => {
      if (!isoOk(e.target.value)) return;
      evo[id === "blEvoDu" ? "du" : "au"] = e.target.value;
      const other = id === "blEvoDu" ? "au" : "du"; if (!isoOk(evo[other])) evo[other] = $(id === "blEvoDu" ? "blEvoAu" : "blEvoDu").value;
      evo.periode = "perso"; reEvo();
    }));
    $("blEvoGran").addEventListener("change", e => { evo.gran = e.target.value; reEvo(); });
    $("blEvoVue").addEventListener("click", e => { const b = e.target.closest("[data-vue]"); if (b) { evo.vue = b.dataset.vue; reEvo(); } });
    window.addEventListener("resize", () => {
      clearTimeout(resizeTmr);
      resizeTmr = setTimeout(() => { if (root && !root.hidden && S && lastEvol) renderEvolution(lastEvol); }, 150);
    });
  }
  function update(snap, visible) {
    S = Object.assign({}, snap, { positions: snap.positions || [], snapshots: snap.snapshots || [], people: snap.people || [], scope: snap.scope || "foyer" });
    dirty = true;
    if (visible) { render(); dirty = false; }
  }
  function show() { if (dirty) { render(); dirty = false; } }
  function headline() {
    if (!S || !window.BilanCalc) return "–";
    const c = window.BilanCalc.composition(S.positions, S.profil, scope());
    return c.brut > 0 || c.dettes.total > 0 ? kEur(c.net) : "–";
  }

  const api = { mount, update, show, headline };
  const reg = () => App.register("bilan", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
