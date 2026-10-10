/* Recommandations › Fiches : le savoir sur lequel s'appuie l'agent (fiches pédagogiques sourcées et repères chiffrés).
   S.savoir = { fiches: [{ slug, theme, titre, resume, motsCles, sources: [{ titre, url, consulte_le }], version, misAJourLe }],
   reperes: [{ cle, libelle, valeur, unite, dateEffet, sourceTitre, sourceUrl, verifieLe, mode }] } : les fiches arrivent sans
   leur contenu ; Store.savoir.fiche(slug) → la fiche avec `contenu` (markdown) ou null, appelé à l'ouverture.
   Sécurité : rendreMarkdown échappe tout le HTML AVANT de reconnaître le balisage limité (titres, listes, gras, liens https://) ;
   toute autre donnée passe par esc, et seules les URL https:// deviennent des liens (lienSur).
   Fonctions pures exportées pour les tests : rendreMarkdown, filtrer, normaliser, lienSur, themesPresents, THEMES. */
(function () {
  "use strict";
  // Échappement HTML, puis espaces insécables typographiques (« 35 % », « 150 000 € ») pour éviter les coupures de ligne.
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
    .replace(/(\d) (?=[%€]|\d{3}\b)/g, "$1\u00a0");

  const THEMES = {
    epargne: "Épargne", enveloppes: "Enveloppes", fiscalite: "Fiscalité", immobilier: "Immobilier", retraite: "Retraite",
    protection: "Protection", marches: "Marchés", comportement: "Comportement", credit: "Crédit",
  };
  const libTheme = t => THEMES[t] || String(t || "");

  /** Minuscules sans accents (recherche insensible à la casse et aux accents). */
  const normaliser = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  /** Fiches dont le titre, le résumé ou les mots-clés contiennent tous les mots de `texte`, restreintes au thème s'il est donné. */
  function filtrer(fiches, texte, theme) {
    const mots = normaliser(texte).split(/\s+/).filter(Boolean);
    return (Array.isArray(fiches) ? fiches : []).filter(f => {
      if (!f || (theme && f.theme !== theme)) return false;
      if (!mots.length) return true;
      const h = normaliser([f.titre, f.resume].concat(Array.isArray(f.motsCles) ? f.motsCles : []).join(" "));
      return mots.every(m => h.includes(m));
    });
  }

  /** Thèmes présents dans les fiches, dans l'ordre de THEMES (thèmes inconnus à la fin). */
  function themesPresents(fiches) {
    const there = new Set((Array.isArray(fiches) ? fiches : []).map(f => f && f.theme).filter(Boolean));
    return Object.keys(THEMES).filter(t => there.has(t)).concat([...there].filter(t => !THEMES[t]));
  }

  /** L'URL si elle est en https://, sinon null (jamais de javascript:, data:, http:…). */
  const lienSur = u => (typeof u === "string" && /^https:\/\/[^\s]+$/.test(u) ? u : null);

  /* ---------- markdown limité, sûr ---------- */
  const gras = t => t.replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  /* `t` est déjà échappé : l'URL capturée ne contient ni guillemet ni chevron. */
  function enLigne(t) {
    const re = /\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(t))) {
      out += gras(t.slice(last, m.index)) + '<a href="' + m[2] + '" target="_blank" rel="noopener noreferrer">' + gras(m[1]) + '<span class="fv-sr"> (nouvel onglet)</span></a>';
      last = re.lastIndex;
    }
    return out + gras(t.slice(last));
  }
  /** Markdown limité → HTML : « ## » → h3, « ### » → h4, « - » → liste à puces, « 1. » → liste numérotée, **gras**,
      [texte](https://…), paragraphes séparés par une ligne vide. Tout le HTML d'origine est échappé d'abord ; aucun autre
      balisage n'est produit. */
  function rendreMarkdown(md) {
    if (md == null) return "";
    const lignes = esc(String(md)).replace(/\r\n?/g, "\n").split("\n");
    let out = "", para = [], liste = [], typeListe = "ul";
    const finPara = () => { if (para.length) out += "<p>" + enLigne(para.join(" ")) + "</p>"; para = []; };
    const finListe = () => { if (liste.length) out += "<" + typeListe + ">" + liste.map(x => "<li>" + enLigne(x) + "</li>").join("") + "</" + typeListe + ">"; liste = []; };
    const item = (type, texte) => { finPara(); if (typeListe !== type) { finListe(); typeListe = type; } liste.push(texte); };
    for (const brute of lignes) {
      const l = brute.trim();
      let m;
      if (!l) { finPara(); finListe(); continue; }
      if ((m = /^###\s+(.+)$/.exec(l))) { finPara(); finListe(); out += "<h4>" + enLigne(m[1]) + "</h4>"; continue; }
      if ((m = /^##\s+(.+)$/.exec(l))) { finPara(); finListe(); out += "<h3>" + enLigne(m[1]) + "</h3>"; continue; }
      if ((m = /^-\s+(.+)$/.exec(l))) { item("ul", m[1]); continue; }
      if ((m = /^\d+\.\s+(.+)$/.exec(l))) { item("ol", m[1]); continue; }
      finListe(); para.push(l);
    }
    finPara(); finListe();
    return out;
  }

  /** État à afficher quand la liste est vide : "chargement" (store pas prêt), "erreur" (lecture impossible) ou "vide" ; null si la liste n'est pas vide. */
  function etatVide(S, n) {
    if (n > 0) return null;
    if (!S || S.ready === false) return "chargement";
    return S.error ? "erreur" : "vide";
  }

  const H = { rendreMarkdown, filtrer, normaliser, lienSur, themesPresents, etatVide, THEMES };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =================================================================== vue =================================================================== */
  let S = null, root = null, dirty = true, sig = "";
  let q = "", theme = "";          // recherche et thème choisis
  let ouverte = null, derniere = null, jeton = 0; // fiche affichée, dernière ouverte (retour du focus), garde contre les réponses tardives
  const $ = id => root.querySelector("#" + id);
  const savoir = () => (S && S.savoir) || { fiches: [], reperes: [] };
  const fiches = () => (Array.isArray(savoir().fiches) ? savoir().fiches : []);
  const reperes = () => (Array.isArray(savoir().reperes) ? savoir().reperes : []);
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  const dateFr = d => {
    if (!d) return "";
    const t = Date.parse(String(d).length === 10 ? d + "T12:00:00" : d);
    return isFinite(t) ? new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : String(d);
  };
  const lienHtml = (url, texte) => {
    const u = lienSur(url);
    return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(texte || u) + '<span class="fv-sr"> (nouvel onglet)</span></a>' : esc(texte || "");
  };
  // Jour local (AAAA-MM-JJ), pas UTC : l'utilisateur français change de jour à minuit à Paris, comme le connecteur.
  const pad = n => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };

  function render(force) {
    if (!root) return;
    const s = JSON.stringify([S && S.ready, S && S.error, fiches(), reperes()]);
    if (!force && s === sig) return;
    sig = s;
    renderReperes();
    renderListe();
  }

  function renderReperes() {
    const R = window.Reperes, reps = reperes();
    $("fvReperes").hidden = !reps.length;
    let ancien = false;
    $("fvRepCorps").innerHTML = reps.map(r => {
      const av = R ? Reperes.aVerifier(r, today()) : false;
      if (av) ancien = true;
      const val = R ? Reperes.format(r) : String(r.valeur ?? "") + " " + (r.unite || "");
      return '<tr><th scope="row" class="fv-r-lib">' + esc(r.libelle) + "</th>" +
        '<td class="fv-r-val"><span class="fv-num">' + esc(val) + "</span>" + (av ? ' <span class="fv-badge">à vérifier</span>' : "") + "</td>" +
        '<td class="fv-r-date">' + (r.dateEffet ? "depuis le " + esc(dateFr(r.dateEffet)) : "") + "</td>" +
        '<td class="fv-r-src">' + lienHtml(r.sourceUrl, r.sourceTitre) + "</td></tr>";
    }).join("");
    $("fvRepNote").hidden = !ancien;
  }

  function renderListe(focusTheme) {
    const fs = fiches(), ev = etatVide(S, fs.length);
    if (!fs.length) {
      $("fvOutils").hidden = true;
      $("fvCartes").innerHTML = "";
      $("fvCompte").textContent = "";
      $("fvVide").hidden = ev !== "vide"; // pas d'état vide pendant le chargement ni quand la lecture a échoué
      $("fvErr").hidden = ev !== "erreur";
      return;
    }
    $("fvVide").hidden = true;
    $("fvErr").hidden = true;
    $("fvOutils").hidden = false;
    const ths = themesPresents(fs);
    if (theme && !ths.includes(theme)) theme = "";
    $("fvThemes").innerHTML = [""].concat(ths).map(t =>
      '<button type="button" class="fv-puce" data-theme="' + esc(t) + '" aria-pressed="' + (t === theme) + '">' + esc(t ? libTheme(t) : "Tous") + "</button>").join("");
    const res = filtrer(fs, q, theme);
    $("fvCompte").textContent = res.length === fs.length ? pluriel(fs.length, "fiche") : pluriel(res.length, "fiche") + " sur " + fs.length;
    $("fvCartes").innerHTML = res.length ? res.map(f =>
      '<li><button type="button" class="fv-carte" data-slug="' + esc(f.slug) + '">' +
        '<span class="fv-theme">' + esc(libTheme(f.theme)) + "</span>" +
        '<span class="fv-c-titre">' + esc(f.titre) + "</span>" +
        '<span class="fv-c-resume">' + esc(f.resume) + "</span>" +
        (f.misAJourLe ? '<span class="fv-c-date">Mise à jour le ' + esc(dateFr(f.misAJourLe)) + "</span>" : "") +
      "</button></li>").join("")
      : '<li class="fv-aucune">Aucune fiche ne correspond à votre recherche. <button type="button" class="fv-lnk" data-raz>Tout afficher</button></li>';
    if (focusTheme != null) { const b = root.querySelector('.fv-puce[data-theme="' + CSS.escape(focusTheme) + '"]'); if (b) b.focus(); }
  }

  /* ---------- détail d'une fiche ---------- */
  function remplir(f) {
    $("fvDTheme").textContent = libTheme(f.theme);
    $("fvDTitre").textContent = f.titre || "";
    $("fvDContenu").innerHTML = rendreMarkdown(f.contenu);
    const src = (Array.isArray(f.sources) ? f.sources : []).filter(s => s && (s.titre || s.url));
    $("fvDSrc").hidden = !src.length;
    $("fvDSources").innerHTML = src.map(s => "<li>" + lienHtml(s.url, s.titre) +
      (s.consulte_le ? ' <span class="fv-d-consulte">· consultée le ' + esc(dateFr(s.consulte_le)) + "</span>" : "") + "</li>").join("");
    $("fvDMeta").textContent = ["Version " + (f.version || 1), f.misAJourLe ? "mise à jour le " + dateFr(f.misAJourLe) : ""].filter(Boolean).join(" · ");
  }

  async function ouvrir(slug) {
    const resume = fiches().find(x => x.slug === slug) || { slug };
    const j = ++jeton;
    ouverte = slug; derniere = slug;
    $("fvListe").hidden = true;
    $("fvDetail").hidden = false;
    $("fvDTheme").textContent = libTheme(resume.theme);
    $("fvDTitre").textContent = resume.titre || "Fiche";
    $("fvDContenu").setAttribute("aria-busy", "true");
    $("fvDContenu").innerHTML = '<p class="fv-charge">Chargement de la fiche…</p>';
    $("fvDSrc").hidden = true;
    $("fvDSources").innerHTML = "";
    $("fvDMeta").textContent = "";
    const t = $("fvDTitre");
    t.focus({ preventScroll: true });
    const top = $("fvDetail").getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight - 80) $("fvDetail").scrollIntoView({ block: "start" });
    let d = null;
    try {
      const api = window.Store && window.Store.savoir;
      d = api && api.fiche ? await window.Store.savoir.fiche(slug) : null;
    } catch (e) { d = null; }
    if (j !== jeton || ouverte !== slug) return; // l'utilisateur est revenu à la liste ou a ouvert une autre fiche
    $("fvDContenu").removeAttribute("aria-busy");
    const titre = resume.titre || (d && d.titre) || "Fiche";
    if (!d || !d.contenu) {
      remplir(Object.assign({}, resume, { contenu: "" }));
      $("fvDContenu").innerHTML = '<p class="fv-erreur">Le contenu de cette fiche n\'est pas disponible pour le moment. Réessayez dans quelques instants.</p>' +
        (resume.resume ? "<p>" + esc(resume.resume) + "</p>" : "");
      $("fvDStatut").textContent = "Fiche indisponible : " + titre;
      return;
    }
    remplir(Object.assign({}, resume, d));
    // Annonce courte aux lecteurs d'écran (zone de statut), plutôt que tout le contenu de la fiche.
    $("fvDStatut").textContent = "Fiche ouverte : " + titre;
  }

  function retour() {
    ouverte = null; jeton++;
    $("fvDStatut").textContent = "";
    $("fvDetail").hidden = true;
    $("fvListe").hidden = false;
    if (dirty) { render(); dirty = false; }
    const carte = derniere ? root.querySelector('.fv-carte[data-slug="' + CSS.escape(derniere) + '"]') : null;
    if (carte) carte.focus(); else if (!$("fvOutils").hidden) $("fvQ").focus();
  }

  function mount(r) {
    root = r;
    $("fvQ").addEventListener("input", e => { q = e.target.value; renderListe(); });
    root.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b || !root.contains(b)) return;
      if (b.classList.contains("fv-carte")) { ouvrir(b.dataset.slug); return; }
      if (b.classList.contains("fv-puce")) { theme = b.dataset.theme || ""; renderListe(theme); return; }
      if (b.hasAttribute("data-raz")) { q = ""; theme = ""; $("fvQ").value = ""; renderListe(); $("fvQ").focus(); return; }
      if (b.id === "fvRetour") retour();
    });
    $("fvDetail").addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); retour(); } });
  }
  function update(snap, visible) { S = snap; dirty = true; if (visible) { render(); dirty = false; } }
  function show() { if (dirty) { render(); dirty = false; } }

  const api = { mount, update, show };
  const reg = () => App.register("fiches-view", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
