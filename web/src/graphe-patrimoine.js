/* Graphe maître d'Aujourd'hui : « Évolution et projection du patrimoine net ». Rendus purs (chaînes HTML / SVG), aucun accès au DOM.
   - Passé : points agrégés par Periodes (période et granularité de l'utilisateur), chacun avec sa nature, « observe » (photos
     nocturnes et point du jour : trait plein) ou « reconstitue » (Historique.reconstituer : trait pointillé, confiance moindre).
   - Futur : cône de Historique.projeter (pessimiste / central / optimiste, versements compris) : bande entre pessimiste et optimiste,
     ligne centrale. « Aujourd'hui » marqué par un trait vertical. L'échelle de temps du passé et celle du futur sont distinctes
     (chacune proportionnelle à sa durée, le passé garde entre 30 et 60 % de la largeur) : le trait « Aujourd'hui » les sépare, et
     une note le dit quand les proportions sont modifiées.
   - Infobulle (le navigateur la pilote avec pointsGraphe) : date, valeur, nature du point ; équivalent accessible : tableau des
     données (tableauHtml) ; hypothèses et sources : calculHtml (panneau « Comment c'est calculé »).
   Fonctions : construire(f, fut, opt) → { svg, points, geo } ; legendeHtml, tableauHtml, calculHtml, infobulle(point) → texte.
   f = { points: [{ date, label, valeur, variation, nature }], reperes?, resume? } ; fut = { points: [{ date, mois, pessimiste, central,
   optimiste }], versement, annees } | null. Tous les textes sont au tutoiement ; toute donnée est échappée. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GraphePatrimoine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
  const utc = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  const eur = v => (Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €";
  const eurS = v => (Math.round(v) > 0 ? "+" : Math.round(v) < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(v))) + " €";
  const dateFr = s => (isoOk(s) ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  const NATURE = { observe: "observé", reconstitue: "reconstitué", projete: "projeté" };

  /* Graduations « rondes » de l'axe vertical : [{ v, label }] et bornes élargies. */
  function niceStep(r) { const p = Math.pow(10, Math.floor(Math.log10(r || 1))), n = r / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function graduations(lo, hi, n) {
    const step = niceStep((hi - lo) / (n || 4) || 1000), a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
    for (let v = a; v <= b + step / 2; v += step) out.push(v);
    const lab = v => (step >= 1e6 ? nf1.format(v / 1e6) + " M€" : step >= 1e3 ? (step % 1e3 === 0 ? nf0.format(v / 1e3) : nf1.format(v / 1e3)) + " k€" : nf0.format(v) + " €");
    return { lo: a, hi: b, ticks: out.map(v => ({ v, label: lab(v) })) };
  }

  /** Infobulle d'un point : « 14 oct. 2026 · 312 400 € · observé » (projeté : valeur centrale et fourchette). */
  function infobulle(p) {
    if (!p) return "";
    const base = dateFr(p.date) + " : " + eur(p.valeur) + " (" + (NATURE[p.nature] || p.nature) + ")";
    if (p.nature === "projete") return dateFr(p.date) + " : " + eur(p.valeur) + " au centre, entre " + eur(p.min) + " et " + eur(p.max) + " (projeté, pas une promesse)";
    if (p.nature === "reconstitue") return base + " : estimation, " + (p.note || "moins fiable qu'une photo");
    return base;
  }

  /** Dessine le graphe. opt = { largeur, today, scopeLabel, noteReconstitue }.
      → { svg, points: [{ x, y, date, label, valeur, nature, min?, max? }] (triés par x), geo: { W, H, L, R, T, B, xAuj, deformee } } */
  function construire(f, fut, opt) {
    const o = opt || {}, rows = ((f && f.points) || []).filter(p => p && isoOk(p.date) && isFinite(p.valeur));
    const cone = fut && Array.isArray(fut.points) && fut.points.length > 1 ? fut.points : [];
    if (rows.length < 2 && !cone.length) return { svg: "", points: [], geo: null };
    const W = Math.max(300, Math.min(1100, Math.round(+o.largeur) || 720)), H = W < 480 ? 250 : 300, L = W < 480 ? 54 : 62, R = 14, T = 22, B = 30, PW = W - L - R, PH = H - T - B;
    const today = isoOk(o.today) ? String(o.today).slice(0, 10) : rows[rows.length - 1].date;
    const t0 = utc(today);
    let x0 = rows.length ? utc(rows[0].date) : t0 - 30 * 864e5;
    if (x0 >= t0) x0 = t0 - 30 * 864e5;
    const t1 = cone.length ? utc(cone[cone.length - 1].date) : t0;
    const spanP = t0 - x0, spanF = t1 - t0, brut = cone.length ? spanP / (spanP + spanF) : 1;
    const fp = cone.length ? Math.min(0.6, Math.max(0.3, brut)) : 1, deformee = cone.length > 0 && Math.abs(fp - brut) > 0.02;
    const xAuj = L + fp * PW;
    const X = t => (t <= t0 ? L + Math.max(0, (t - x0) / spanP) * fp * PW : xAuj + Math.min(1, (t - t0) / (spanF || 1)) * (1 - fp) * PW);
    const vals = rows.map(p => p.valeur).concat(cone.flatMap(p => [p.pessimiste, p.optimiste, p.central]));
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    const marge = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1000;
    const g = graduations(lo - marge, hi + marge, 4);
    lo = g.lo; hi = g.hi;
    const Y = v => T + (1 - (v - lo) / (hi - lo)) * PH;
    const f1 = n => n.toFixed(1);
    let s = "";
    g.ticks.forEach(k => {
      const y = Y(k.v);
      s += '<line class="aj-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + f1(y) + '" y2="' + f1(y) + '"/><text class="aj-ax" x="' + (L - 8) + '" y="' + f1(y + 4) + '" text-anchor="end">' + esc(k.label) + "</text>";
    });
    /* Étiquettes du passé : la première calée à gauche, la dernière à droite de la zone passée, les autres centrées si elles ne se chevauchent pas. */
    const larg = t => Math.max(40, Math.ceil(String(t ?? "").length * 6.8));
    let droite = -Infinity;
    const xFinPasse = X(t0), dernier = rows.length - 1, wFin = rows.length && !cone.length ? larg(rows[dernier].label) : 0; // avec un futur, le dernier libellé passé est porté par « Aujourd'hui »
    rows.forEach((p, i) => {
      const x = X(utc(p.date)), last = i === dernier, w = larg(p.label);
      const a = i === 0 ? x : last ? x - w : x - w / 2, b = i === 0 ? x + w : last ? x : x + w / 2;
      if (!last && (a < droite + 6 || b > xFinPasse - wFin - 6)) return;
      if (cone.length && last && x > xAuj - 4) { /* le dernier libellé passé est « aujourd'hui » : porté par le trait vertical */ return; }
      droite = b;
      s += '<text class="aj-ax" x="' + f1(x) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? "start" : last ? "end" : "middle") + '">' + esc(p.label) + "</text>";
    });
    /* Années du futur : un libellé tous les 1, 2 ou 5 ans selon l'horizon, sans chevauchement (on part de l'horizon et on remonte). */
    if (cone.length) {
      const N = Math.round(cone[cone.length - 1].mois / 12), pas = N <= 5 ? 1 : N <= 10 ? 2 : 5, an0 = +today.slice(0, 4);
      let xPrec = Infinity;
      for (let k = N; k >= pas; k -= pas) {
        const x = X(utc(cone[Math.min(cone.length - 1, k * 12)].date));
        if (xPrec - x < 40 && k !== N) continue;
        xPrec = x;
        s += '<text class="aj-ax" x="' + f1(x) + '" y="' + (H - 8) + '" text-anchor="' + (k === N ? "end" : "middle") + '">' + (an0 + k) + "</text>";
      }
    }
    /* Courbes. */
    const obs = rows.filter(p => p.nature !== "reconstitue"), rec = rows.filter(p => p.nature === "reconstitue");
    const chemin = ps => ps.map((p, i) => (i ? "L" : "M") + f1(X(utc(p.date))) + "," + f1(Y(p.valeur))).join("");
    let aire = "", cour = "";
    if (obs.length > 1) {
      const d = chemin(obs);
      aire = '<path class="aj-aire" d="' + d + "L" + f1(X(utc(obs[obs.length - 1].date))) + "," + (H - B) + "L" + f1(X(utc(obs[0].date))) + "," + (H - B) + 'Z"/>';
    }
    if (rec.length) cour += '<path class="aj-ligne-rec" d="' + chemin(rec.concat(obs.slice(0, 1))) + '"/>';
    if (obs.length > 1) cour += '<path class="aj-ligne" d="' + chemin(obs) + '"/>';
    let proj = "";
    if (cone.length) {
      const c = k => f1(X(utc(cone[k].date))) + ",";
      const haut = cone.map((p, k) => (k ? "L" : "M") + c(k) + f1(Y(p.optimiste))).join("");
      const bas = cone.map((p, k) => "L" + c(k) + f1(Y(p.pessimiste))).reverse().join("");
      const ligne = cle => cone.map((p, k) => (k ? "L" : "M") + c(k) + f1(Y(p[cle]))).join("");
      proj = '<path class="aj-bande" d="' + haut + bas + 'Z"/><path class="aj-borne" d="' + ligne("optimiste") + '"/><path class="aj-borne" d="' + ligne("pessimiste") + '"/><path class="aj-proj" d="' + ligne("central") + '"/>';
      const fin = cone[cone.length - 1], yf = Y(fin.central);
      proj += '<text class="aj-fin" x="' + f1(W - R - 2) + '" y="' + f1(Math.max(T + 10, yf - 9)) + '" text-anchor="end">' + esc(eur(fin.central)) + "</text>";
    }
    /* « Aujourd'hui ». */
    const auj = '<line class="aj-auj" x1="' + f1(xAuj) + '" x2="' + f1(xAuj) + '" y1="' + (T - 8) + '" y2="' + (H - B) + '"/>' +
      (cone.length ? '<text class="aj-auj-t" x="' + f1(xAuj) + '" y="' + (T - 11) + '" text-anchor="middle">Aujourd\'hui</text>' : "");
    /* Repères des décisions du journal (passé seulement) : traits verticaux focalisables. */
    const x1p = rows.length ? utc(rows[dernier].date) : t0;
    const reps = (Array.isArray(f && f.reperes) ? f.reperes : []).filter(r => r && isoOk(r.date) && rows.length > 1 && utc(r.date) >= x0 && utc(r.date) <= x1p);
    const repSvg = reps.map(r => {
      const x = f1(X(utc(r.date))), nom = "Décision du " + dateFr(r.date) + " : " + plat(r.titre);
      return '<g class="aj-rep" data-journal="' + esc(r.id) + '" tabindex="0" role="button" aria-label="' + esc(nom) + '" style="cursor:pointer"><title>' + esc(nom) + "</title>" +
        '<line x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (H - B) + '" style="stroke:transparent;stroke-width:14"/>' +
        '<line x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (H - B) + '" style="stroke:var(--muted);stroke-width:1.3;stroke-dasharray:3 3"/>' +
        '<path d="M' + x + "," + (T - 6) + "l5,6l-5,6l-5,-6z" + '" style="fill:var(--accent);stroke:var(--surface);stroke-width:1.5"/></g>';
    }).join("");
    /* Points interactifs (infobulle) et point du jour. */
    const pts = rows.map(p => ({ x: X(utc(p.date)), y: Y(p.valeur), date: String(p.date).slice(0, 10), label: p.label, valeur: p.valeur, nature: p.nature === "reconstitue" ? "reconstitue" : "observe", variation: p.variation }));
    cone.forEach(p => { if (p.mois > 0) pts.push({ x: X(utc(p.date)), y: Y(p.central), date: p.date, label: dateFr(p.date), valeur: p.central, nature: "projete", min: p.pessimiste, max: p.optimiste }); });
    pts.sort((a, b) => a.x - b.x);
    const fin = rows.length ? rows[dernier] : null;
    const pj = fin && utc(fin.date) === t0 ? '<circle class="aj-pt fin" cx="' + f1(xAuj) + '" cy="' + f1(Y(fin.valeur)) + '" r="4.5"/>' : "";
    const dernierC = cone.length ? cone[cone.length - 1] : null;
    const lbl = "Patrimoine net estimé " + (o.scopeLabel || "") + (fin ? " : " + eur(fin.valeur) + " aujourd'hui" : "") +
      (dernierC ? ". Projection à " + pluriel(Math.round(dernierC.mois / 12), "an") + " : " + eur(dernierC.central) + " au centre, entre " + eur(dernierC.pessimiste) + " et " + eur(dernierC.optimiste) + ", ce n'est pas une promesse" : "") +
      (rec.length ? ". Le passé avant la première photo est reconstitué (estimation)" : "") + (reps.length ? ". " + pluriel(reps.length, "décision") + " du journal (repères verticaux)" : "") + ". Les données sont dans le tableau sous le graphique.";
    const svg = '<svg class="aj-svg" viewBox="0 0 ' + W + " " + H + '" role="' + (reps.length ? "group" : "img") + '" aria-label="' + esc(plat(lbl)) + '">' + s + aire + proj + cour + auj + repSvg + pj +
      '<line class="aj-cur-l" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '"/><circle class="aj-cur-d" cx="0" cy="0" r="5.5"/></svg>';
    return { svg, points: pts, geo: { W, H, L, R, T, B, xAuj, deformee } };
  }

  /** Légende (≥ 2 séries : toujours présente) : un trait par nature, pas la seule couleur. */
  function legendeHtml(f, fut) {
    const rows = (f && f.points) || [], rec = rows.some(p => p.nature === "reconstitue"), obs = rows.some(p => p.nature !== "reconstitue");
    const sw = (cls, dash) => '<svg class="aj-sw" viewBox="0 0 28 10" aria-hidden="true" focusable="false"><path class="' + cls + '" d="M1,5H27"' + (dash ? ' stroke-dasharray="' + dash + '"' : "") + "/></svg>";
    const it = (svg, t, plus) => '<li class="aj-lg">' + svg + "<span>" + esc(t) + (plus ? '<span class="aj-lg-plus"> ' + esc(plus) + "</span>" : "") + "</span></li>";
    const out = [];
    if (obs) out.push(it(sw("aj-ligne"), "Observé", "photos du patrimoine"));
    if (rec) out.push(it(sw("aj-ligne-rec"), "Reconstitué", "estimation, moins fiable"));
    if (fut && fut.points && fut.points.length) {
      out.push(it(sw("aj-proj"), "Projection centrale"));
      out.push(it('<svg class="aj-sw" viewBox="0 0 28 10" aria-hidden="true" focusable="false"><rect class="aj-bande" x="1" y="1" width="26" height="8" rx="2"/></svg>', "Entre pessimiste et optimiste"));
    }
    return out.length ? '<ul class="aj-legende" aria-label="Légende du graphique">' + out.join("") + "</ul>" : "";
  }

  /** Tableau des données (équivalent accessible du graphe) : passé agrégé, puis projection année par année. */
  function tableauHtml(f, fut, opt) {
    const rows = (f && f.points) || [], cone = fut && fut.points ? fut.points : [], o = opt || {};
    if (!rows.length && !cone.length) return "";
    const th = ["Date", "Valeur", "Pessimiste", "Optimiste", "Nature"].map(t => '<th scope="col">' + t + "</th>").join("");
    const passe = rows.map(p => "<tr><th scope=\"row\">" + esc(p.label || dateFr(p.date)) + '</th><td class="n">' + esc(eur(p.valeur)) + '</td><td class="n">—</td><td class="n">—</td><td>' + esc(NATURE[p.nature] || "observé") + "</td></tr>");
    const futur = cone.filter(p => p.mois > 0 && p.mois % 12 === 0).map(p => "<tr><th scope=\"row\">" + esc(dateFr(p.date)) + '</th><td class="n">' + esc(eur(p.central)) + '</td><td class="n">' + esc(eur(p.pessimiste)) + '</td><td class="n">' + esc(eur(p.optimiste)) + "</td><td>projeté (valeur centrale)</td></tr>");
    return '<div class="aj-tab-wrap" tabindex="0" role="region" aria-label="Données du graphique"><table class="aj-tab"><caption class="ui-sr">Patrimoine net ' + esc(o.scopeLabel || "") + " : passé observé ou reconstitué, puis projection année par année</caption><thead><tr>" + th + "</tr></thead><tbody>" + passe.concat(futur).join("") + "</tbody></table></div>";
  }

  /** Contenu du panneau « Comment c'est calculé ». ctx = { rec, decalage, fut, rendements, parBloc, versementSource, sources, deformee, scopeLabel }.
      Toutes les valeurs sont échappées ; sources : [{ libelle, valeur, dateEffet, sourceTitre, sourceUrl }] tirées des repères. */
  function calculHtml(ctx) {
    const c = ctx || {}, r = c.rec || null, d = r && r.drapeaux ? r.drapeaux : null;
    const li = t => "<li>" + t + "</li>";
    let h = '<p class="aj-det-note">Une courbe, trois natures de points. Seul le trait plein est une mesure ; le reste est une estimation.</p>';
    h += '<h3 class="aj-sec-t">Observé</h3><p class="aj-det-note">Chaque nuit, Boussole photographie la valeur de tes placements ; à cette valeur s\'ajoutent l\'immobilier, les autres biens et les dettes d\'aujourd\'hui. Le point du jour utilise les cours les plus récents.</p>';
    if (r && r.points && r.points.length) {
      h += '<h3 class="aj-sec-t">Reconstitué (pointillés)</h3><p class="aj-det-note">Avant ta première photo, Boussole refait le calcul à rebours, du plus loin que ses données le permettent, ici depuis le ' + esc(dateFr(r.debut)) + " :</p><ul class=\"aj-liste\">" +
        li("<strong>lignes cotées</strong> : quantité × cours de clôture du jour" + (d.viaTransactions.length ? " ; les quantités remontent le temps par tes transactions (" + esc(d.viaTransactions.join(", ")) + ")" : "") +
          (d.compositionActuelle.length ? " ; sans transaction, la quantité d'aujourd'hui est utilisée, « à composition actuelle » (" + esc(d.compositionActuelle.join(", ")) + ")" : "")) +
        (d.bancaires.length ? li("<strong>comptes bancaires connectés</strong> : solde d'aujourd'hui moins les opérations postérieures, sur les 90 derniers jours seulement (" + esc(d.bancaires.join(", ")) + "), puis solde tenu constant") : "") +
        li("<strong>toutes les autres lignes</strong> : tenues à leur valeur d'aujourd'hui" + (d.constantes.noms.length ? " (" + esc(d.constantes.noms.join(", ")) + " : " + esc(eur(d.constantes.montant)) + ")" : "") + ", comme l'immobilier et les dettes") +
        (d.courteHistoire.length ? li("historique de cours plus court que la courbe : " + esc(d.courteHistoire.join(", ")) + " (valeur de leur premier cours avant)") : "") +
        "</ul><p class=\"aj-det-note\">Quand une photo existe, elle l'emporte toujours sur le reconstitué de la même date" + (c.decalage ? " ; le reconstitué est décalé de " + esc(eurS(c.decalage)) + " pour rejoindre ta première photo sans cassure" : "") + ". Un achat non enregistré ou une composition qui a changé sans transaction faussent le passé.</p>";
    }
    const f = c.fut;
    if (f && f.points && f.points.length) {
      h += '<h3 class="aj-sec-t">Projection (zone colorée)</h3><p class="aj-det-note"><strong>Projection, pas une promesse.</strong> Chaque poche de ton patrimoine financier grandit à un rendement annuel hypothétique, selon trois scénarios, ' +
        (f.versement > 0 ? "avec " + esc(eur(f.versement)) + " versés chaque mois (" + esc(c.versementSource || "versement mensuel") + "), répartis comme ton portefeuille actuel" : "sans versement mensuel (aucune épargne mensuelle connue)") +
        ". L'immobilier, les autres biens et les dettes restent à leur valeur d'aujourd'hui. Impôts, frais, inflation et aléas de marché ne sont pas pris en compte.</p>";
      const bl = c.parBloc ? Object.keys(c.parBloc).sort((a, b) => c.parBloc[b].capital - c.parBloc[a].capital) : [], R = c.rendements || {};
      const fr = x => String(x).replace(".", ",") + " %";
      if (bl.length) h += '<div class="aj-tab-wrap" tabindex="0" role="region" aria-label="Hypothèses de rendement"><table class="aj-tab"><caption class="ui-sr">Rendements annuels supposés par poche</caption><thead><tr><th scope="col">Poche</th><th scope="col">Montant</th><th scope="col">Pessimiste</th><th scope="col">Central</th><th scope="col">Optimiste</th></tr></thead><tbody>' +
        bl.map(b => { const t = R[b] || R._autre || { pessimiste: 0, central: 0, optimiste: 0 };
          return '<tr><th scope="row">' + esc(b === "_autre" ? "Autres" : b) + '</th><td class="n">' + esc(eur(c.parBloc[b].capital)) + '</td><td class="n">' + esc(fr(t.pessimiste)) + '</td><td class="n">' + esc(fr(t.central)) + '</td><td class="n">' + esc(fr(t.optimiste)) + "</td></tr>"; }).join("") + "</tbody></table></div>";
      h += '<p class="aj-det-note">Ces rendements sont des hypothèses indicatives de Boussole, pas des prévisions.</p>';
    }
    const src = Array.isArray(c.sources) ? c.sources.filter(x => x && x.libelle) : [];
    if (src.length) {
      h += '<h3 class="aj-sec-t">Repères publics</h3><ul class="aj-liste">' + src.map(x => li(esc(x.libelle) + " : <strong>" + esc(x.valeur) + "</strong>" + (x.dateEffet ? " depuis le " + esc(dateFr(x.dateEffet)) : "") +
        (x.sourceTitre ? " · " + (/^https:\/\//.test(String(x.sourceUrl || "")) ? '<a href="' + esc(x.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(x.sourceTitre) + '<span class="ui-sr"> (nouvel onglet)</span></a>' : esc(x.sourceTitre)) : ""))).join("") + "</ul>";
    }
    if (c.deformee) h += '<p class="aj-det-note">Échelle : le passé et le futur n\'ont pas la même échelle de temps (chacun est proportionnel à sa durée, le trait « Aujourd\'hui » les sépare).</p>';
    return h;
  }

  return { construire, legendeHtml, tableauHtml, calculHtml, infobulle, graduations, NATURE };
});
