/* Bibliothèque de composants d'interface commune (global UI) : « le board lit, l'agent écrit ».
   Sans dépendance. Styles dans ui.css (classes préfixées .ui-, couleurs de theme.css, clair et sombre).
   Deux familles de fonctions :
   - les fonctions de RENDU renvoient une chaîne HTML dont chaque donnée est échappée (UI.esc) ;
   - les fonctions de BRANCHEMENT rendent dans une racine et y posent les écouteurs (rappeler sur la même racine remplace
     les écouteurs précédents, sans doublon).
   Les contenus HTML passés à UI.panneau.ouvrir et UI.accordeon sont insérés tels quels : ils doivent être DÉJÀ échappés.

   UI.esc(s) → chaîne
     Échappe & < > " ' ; null/undefined → "".
     Exemple : UI.esc(position.nom)

   UI.carte({ id, titre, valeur, sous?, tendance?, badge? }) → HTML
     Carte repliée : <button class="ui-carte" data-ui-carte="<id>">, à ouvrir en panneau (voir UI.brancher).
     tendance = { sens: "hausse" | "baisse" | "stable", texte?, ton?: "pos" | "neg" | "neutre" } : ▲ / ▼ / – ; le ton par défaut
     suit le sens (hausse → pos), à forcer pour une dette (baisse → pos). Le sens est lu en clair aux lecteurs d'écran.
     badge = "Provisoire" | { texte, ton: "neutre" | "info" | "bon" | "attention" | "critique" }. Valeur absente → « — ».
     Grille conseillée : <div class="ui-cartes">…</div> (4 colonnes sur ordinateur, 2 sur mobile).
     Exemple : UI.carte({ id: "net", titre: "Patrimoine net", valeur: "512 300 €", sous: "sur 1 an",
                          tendance: { sens: "hausse", texte: "+3,2 %" }, badge: "Provisoire" })

   UI.panneau.ouvrir({ titre, contenu, lien?, pied?, retour?, surFermeture? }) → élément de contenu (.ui-panneau-corps)
   UI.panneau.fermer()   UI.panneau.ouvert() → booléen
     Panneau de détail unique (role="dialog", aria-modal="true", aria-labelledby sur le titre), créé dans document.body à la
     première ouverture : volet latéral droit de 420 px à partir de 900 px, feuille du bas (85 vh max) en dessous. Fond voilé,
     reste de la page inerte, focus piégé (Tab / Maj+Tab), fermeture par Échap, clic sur le voile, bouton « Fermer » ou lien
     interne (#…) cliqué dans le panneau ; le focus revient à `retour` ou, à défaut, à l'élément actif avant l'ouverture.
     titre : texte (posé en textContent). contenu : HTML déjà échappé, ou un nœud DOM. lien = { label, href } (href « #… »
     ou « https://… » seulement) affiché en pied ; pied : HTML déjà échappé ajouté au pied (ex. UI.demanderAClaude(…)).
     Rouvrir pendant que le panneau est ouvert remplace son contenu.
     Exemple : const corps = UI.panneau.ouvrir({ titre: "Patrimoine net", contenu: "<p>" + UI.esc(detail) + "</p>",
                                                 lien: { label: "Voir les placements", href: "#patrimoine/placements" } });

   UI.onglets(racine, { onglets: [{ id, label, controle? }], actif, surChange?(id), label? }) → { actif(), choisir(id) }
     Rend un role="tablist" dans `racine` (aria-selected, tabindex itinérant, aria-controls = controle). Clic ou ←/→ (avec
     retour au début), Début/Fin : l'onglet sous le focus est choisi (activation automatique) et surChange(id) est appelé.
     choisir(id) change l'onglet par programme, sans surChange. Les panneaux d'onglets restent à la charge de l'appelant.
     Exemple : UI.onglets($("vues"), { label: "Vues", onglets: [{ id: "liste", label: "Liste" }, { id: "carte", label: "Carte" }],
                                       actif: "liste", surChange: id => afficher(id) })

   UI.bascule(racine, { options: [{ id, label, aria? }], actif, surChange?(id), label }) → { actif(), choisir(id) }
     Boutons segmentés pour 2 à 5 options : role="radiogroup" (nommé par `label`), role="radio" + aria-checked.
     ←/→/↑/↓, Début/Fin ; `aria` = nom complet lu à la place d'un libellé abrégé (« 1 m » → « 1 mois »).
     Exemple : UI.bascule($("mode"), { label: "Affichage", options: [{ id: "eur", label: "€" }, { id: "pct", label: "%" }],
                                       actif: "eur", surChange: id => (mode = id, rendre()) })

   UI.accordeon({ titre, contenu, ouvert? }) → HTML
     <details class="ui-acc"> fermé par défaut, pour hypothèses, méthode et sources. contenu : HTML déjà échappé.
     Exemple : UI.accordeon({ titre: "Méthode", contenu: "<p>" + UI.esc(methode) + "</p>" })

   UI.voirPlus(liste, n = 5, rendu?(x, i) → HTML, libelle = "Voir plus") → HTML
     Les n premiers éléments, puis les autres dans un bloc caché et un bouton « Voir plus (k) » (data-ui-voirplus,
     aria-expanded) que UI.brancher fait déplier / replier. Sans rendu, chaque élément est échappé tel quel.
     Exemple : $("boite").innerHTML = UI.voirPlus(elements, 5, e => "<div class=\"it\">" + UI.esc(e.titre) + "</div>");
               UI.brancher($("boite"));

   UI.brancher(racine, { surCarte?(id, element) }?) → racine
     Délégation de clics sur `racine` : boutons « Voir plus » et cartes (surCarte reçoit data-ui-carte et le bouton).
     Exemple : UI.brancher(root, { surCarte: id => UI.panneau.ouvrir(detail(id)) })

   UI.periode(racine, { periode?, granularite?, du?, au?, premiere?, today?, label?, surChange?(etat) }) → { valeur() }
     Sélecteur de période (1 m · 3 m · 1 an · Tout · Personnalisée) et de granularité (jour → année), deux bascules.
     « Personnalisée » affiche deux champs date (Du, Au). etat = { periode, granularite, du, au } : bornes calculées par
     window.Periodes (web/src/periodes.js) s'il est chargé (null sinon, hors période personnalisée). Sans granularité donnée,
     elle suit Periodes.auto(bornes) (« mois » sans Periodes) jusqu'à ce que l'utilisateur en choisisse une.
     premiere = date de la première donnée (pour « Tout »). Défaut : 1 an.
     Exemple : UI.periode($("frisePeriode"), { periode: "1a", granularite: "mois", premiere: snaps[0].date,
                                               surChange: e => dessiner(Periodes.agreger(snaps, e, e.granularite, s => s.net)) })

   UI.demanderAClaude(question, libelle = "Demander à Claude") → HTML
   UI.urlClaude(question) → "https://claude.ai/new?q=<question encodée>"
     Lien qui ouvre l'assistant dans un nouvel onglet avec une question préremplie (target="_blank" rel="noopener noreferrer").
     Exemple : UI.demanderAClaude("Explique-moi l'écart de mon allocation à mon profil de risque")

   Exportées en plus pour les tests : htmlOnglets(o), htmlBascule(o), cibleClavier(touche, index, nombre, vertical?). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UI = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let compteur = 0;
  const uid = p => "ui-" + p + "-" + (++compteur);
  const sr = t => '<span class="ui-sr">' + esc(t) + "</span>";
  const vide = v => v == null || v === "";
  const pad = n => String(n).padStart(2, "0");
  // Jour local (AAAA-MM-JJ), comme le reste de l'application.
  const aujourdhui = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  const leDocument = () => (typeof document !== "undefined" ? document : null);
  const lesPeriodes = () => (typeof globalThis !== "undefined" && globalThis.Periodes) || null;

  const svg = (d, extra) => '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"' + (extra || "") + '><path d="' + d + '"/></svg>';
  const CHEVRON_DROITE = svg("M9 6l6 6-6 6");
  const CHEVRON_BAS = svg("M6 9l6 6 6-6");
  const CROIX = svg("M6 6l12 12M18 6L6 18");
  const ETINCELLE = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2.5l1.9 5.6a3 3 0 0 0 1.9 1.9l5.7 2-5.7 2a3 3 0 0 0-1.9 1.9L12 21.5l-1.9-5.6a3 3 0 0 0-1.9-1.9L2.5 12l5.7-2a3 3 0 0 0 1.9-1.9z"/></svg>';

  /* ============================================================ carte ============================================================ */
  const SENS = {
    hausse: { fleche: "▲", lu: "En hausse", ton: "pos" },
    baisse: { fleche: "▼", lu: "En baisse", ton: "neg" },
    stable: { fleche: "–", lu: "Stable", ton: "neutre" },
  };
  const TONS_TENDANCE = ["pos", "neg", "neutre"];
  const TONS_BADGE = ["neutre", "info", "bon", "attention", "critique"];

  function htmlTendance(t) {
    if (!t || typeof t !== "object") return "";
    const s = SENS[t.sens] || SENS.stable;
    const ton = TONS_TENDANCE.includes(t.ton) ? t.ton : s.ton;
    return '<span class="ui-tendance ' + ton + '"><span class="ui-tendance-fleche" aria-hidden="true">' + s.fleche + "</span>" +
      sr(s.lu + (vide(t.texte) ? "" : " : ")) + esc(t.texte) + "</span>";
  }
  function htmlBadge(b) {
    if (vide(b)) return "";
    const o = typeof b === "object" ? b : { texte: b };
    if (vide(o.texte)) return "";
    return '<span class="ui-badge ' + (TONS_BADGE.includes(o.ton) ? o.ton : "neutre") + '">' + esc(o.texte) + "</span>";
  }
  function carte(o) {
    o = o || {};
    const pied = htmlTendance(o.tendance) + (vide(o.sous) ? "" : '<span class="ui-carte-sous">' + esc(o.sous) + "</span>");
    return '<button type="button" class="ui-carte" data-ui-carte="' + esc(o.id) + '" aria-haspopup="dialog">' +
      '<span class="ui-carte-tete"><span class="ui-carte-titre">' + esc(o.titre) + "</span>" + htmlBadge(o.badge) + "</span>" +
      '<span class="ui-carte-valeur">' + (vide(o.valeur) ? "—" : esc(o.valeur)) + "</span>" +
      (pied ? '<span class="ui-carte-pied">' + pied + "</span>" : "") +
      '<span class="ui-carte-ouvrir">' + CHEVRON_DROITE + "</span></button>";
  }

  /* ============================================================ onglets et bascule ============================================================ */
  /** Index à atteindre pour une touche dans un groupe de `n` éléments (null : touche non gérée). ←/→ bouclent ; ↑/↓ seulement si `vertical`. */
  function cibleClavier(touche, i, n, vertical) {
    if (!(n > 0)) return null;
    if (touche === "ArrowRight" || (vertical && touche === "ArrowDown")) return (i + 1) % n;
    if (touche === "ArrowLeft" || (vertical && touche === "ArrowUp")) return (i - 1 + n) % n;
    if (touche === "Home") return 0;
    if (touche === "End") return n - 1;
    return null;
  }
  const idActif = (liste, actif) => (liste.some(x => String(x.id) === String(actif)) ? String(actif) : liste.length ? String(liste[0].id) : null);

  function htmlOnglets(o) {
    o = o || {};
    const liste = Array.isArray(o.onglets) ? o.onglets : [];
    const actif = idActif(liste, o.actif);
    return '<div class="ui-onglets" role="tablist"' + (vide(o.label) ? "" : ' aria-label="' + esc(o.label) + '"') + ">" +
      liste.map(x => {
        const on = String(x.id) === actif;
        return '<button type="button" class="ui-onglet" role="tab" data-ui-id="' + esc(x.id) + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '"' +
          (vide(x.controle) ? "" : ' aria-controls="' + esc(x.controle) + '"') + ">" + esc(x.label) + "</button>";
      }).join("") + "</div>";
  }
  function htmlBascule(o) {
    o = o || {};
    const liste = Array.isArray(o.options) ? o.options : [];
    const actif = idActif(liste, o.actif);
    return '<div class="ui-bascule" role="radiogroup"' + (vide(o.label) ? "" : ' aria-label="' + esc(o.label) + '"') + ">" +
      liste.map(x => {
        const on = String(x.id) === actif;
        return '<button type="button" class="ui-bascule-option" role="radio" data-ui-id="' + esc(x.id) + '" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '"' +
          (vide(x.aria) ? "" : ' aria-label="' + esc(x.aria) + '"') + ">" + esc(x.label) + "</button>";
      }).join("") + "</div>";
  }

  const ecouteurs = new WeakMap(); // racine → fonction qui retire les écouteurs posés par onglets / bascule / periode
  function nettoyer(racine) { const f = ecouteurs.get(racine); if (f) { f(); ecouteurs.delete(racine); } }

  /** Groupe à sélection unique (onglets ou bascule) : rendu, clic, clavier, tabindex itinérant. */
  function groupe(racine, o, cfg) {
    if (!racine) return null;
    o = o || {};
    nettoyer(racine);
    const liste = (Array.isArray(o[cfg.cle]) ? o[cfg.cle] : []).filter(x => x && x.id != null);
    let actif = idActif(liste, o.actif);
    const htmlGroupe = cfg.html;
    racine.innerHTML = htmlGroupe(Object.assign({}, o, { actif }));
    const sel = '[role="' + cfg.role + '"]';
    const elements = () => Array.from(racine.querySelectorAll(sel));
    const original = id => { const x = liste.find(y => String(y.id) === id); return x ? x.id : id; };
    function maj() {
      elements().forEach(el => {
        const on = el.getAttribute("data-ui-id") === actif;
        el.setAttribute(cfg.etat, String(on));
        el.setAttribute("tabindex", on ? "0" : "-1");
      });
    }
    function choisir(id, notifier) {
      const s = String(id);
      if (!liste.some(x => String(x.id) === s)) return;
      const change = s !== actif;
      actif = s;
      maj();
      if (change && notifier && typeof o.surChange === "function") o.surChange(original(s));
    }
    const cible = e => { const el = e.target && e.target.closest ? e.target.closest(sel) : null; return el && racine.contains(el) ? el : null; };
    const clic = e => { const el = cible(e); if (el) choisir(el.getAttribute("data-ui-id"), true); };
    const clavier = e => {
      const el = cible(e);
      if (!el) return;
      const els = elements();
      const j = cibleClavier(e.key, els.indexOf(el), els.length, cfg.vertical);
      if (j == null) return;
      e.preventDefault();
      els[j].focus();
      choisir(els[j].getAttribute("data-ui-id"), true);
    };
    racine.addEventListener("click", clic);
    racine.addEventListener("keydown", clavier);
    ecouteurs.set(racine, () => { racine.removeEventListener("click", clic); racine.removeEventListener("keydown", clavier); });
    return { actif: () => original(actif), choisir: id => choisir(id, false) };
  }
  const onglets = (racine, o) => groupe(racine, o, { cle: "onglets", html: htmlOnglets, role: "tab", etat: "aria-selected", vertical: false });
  const bascule = (racine, o) => groupe(racine, o, { cle: "options", html: htmlBascule, role: "radio", etat: "aria-checked", vertical: true });

  /* ============================================================ accordéon, voir plus ============================================================ */
  function accordeon(o) {
    o = o || {};
    return '<details class="ui-acc"' + (o.ouvert ? " open" : "") + '><summary class="ui-acc-titre"><span>' + esc(o.titre) + "</span>" +
      '<span class="ui-acc-chevron">' + CHEVRON_BAS + '</span></summary><div class="ui-acc-corps">' + (o.contenu == null ? "" : String(o.contenu)) + "</div></details>";
  }

  function voirPlus(liste, n, rendu, libelle) {
    const xs = Array.isArray(liste) ? liste : [];
    const k = n == null || !isFinite(+n) ? 5 : Math.max(0, Math.floor(+n));
    const r = typeof rendu === "function" ? rendu : x => esc(x);
    const tete = xs.slice(0, k).map((x, i) => r(x, i)).join("");
    const reste = xs.slice(k);
    if (!reste.length) return '<div class="ui-voirplus"><div class="ui-voirplus-liste">' + tete + "</div></div>";
    const id = uid("reste"), lib = vide(libelle) ? "Voir plus" : String(libelle);
    return '<div class="ui-voirplus"><div class="ui-voirplus-liste">' + tete + "</div>" +
      '<div class="ui-voirplus-liste ui-voirplus-reste" id="' + id + '" hidden>' + reste.map((x, i) => r(x, i + k)).join("") + "</div>" +
      '<button type="button" class="ui-voirplus-btn" data-ui-voirplus data-ui-libelle="' + esc(lib) + '" data-ui-nombre="' + reste.length + '" aria-expanded="false" aria-controls="' + id + '">' +
      esc(lib) + " (" + reste.length + ")</button></div>";
  }
  function basculerVoirPlus(btn) {
    const bloc = btn.closest(".ui-voirplus");
    const reste = bloc && Array.from(bloc.children).find(c => c.classList.contains("ui-voirplus-reste"));
    if (!reste) return;
    const deplier = reste.hidden;
    reste.hidden = !deplier;
    btn.setAttribute("aria-expanded", String(deplier));
    btn.textContent = deplier ? "Voir moins" : btn.getAttribute("data-ui-libelle") + " (" + btn.getAttribute("data-ui-nombre") + ")";
  }

  const branches = new WeakMap(); // racine → options courantes de brancher (un seul écouteur par racine)
  function brancher(racine, o) {
    if (!racine) return racine;
    const deja = branches.has(racine);
    branches.set(racine, o || {});
    if (deja) return racine;
    racine.addEventListener("click", e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const vp = t.closest("[data-ui-voirplus]");
      if (vp && racine.contains(vp)) { basculerVoirPlus(vp); return; }
      const c = t.closest("[data-ui-carte]");
      const opts = branches.get(racine) || {};
      if (c && racine.contains(c) && typeof opts.surCarte === "function") opts.surCarte(c.getAttribute("data-ui-carte"), c);
    });
    return racine;
  }

  /* ============================================================ période ============================================================ */
  const PERIODES = [
    { id: "1m", label: "1 m", aria: "1 mois" }, { id: "3m", label: "3 m", aria: "3 mois" }, { id: "1a", label: "1 an" },
    { id: "tout", label: "Tout" }, { id: "perso", label: "Personnalisée" },
  ];
  const GRANULARITES = [
    { id: "jour", label: "Jour" }, { id: "semaine", label: "Semaine" }, { id: "mois", label: "Mois" },
    { id: "trimestre", label: "Trimestre" }, { id: "annee", label: "Année" },
  ];
  const htmlPeriode = (o, perso) =>
    '<div class="ui-periode"><div class="ui-periode-p"></div><div class="ui-periode-g"></div>' +
    '<div class="ui-periode-dates"' + (perso ? "" : " hidden") + ">" +
    '<label class="ui-champ"><span>Du</span><input type="date" class="ui-date" data-ui-du value="' + esc(o.du) + '"></label>' +
    '<label class="ui-champ"><span>Au</span><input type="date" class="ui-date" data-ui-au value="' + esc(o.au) + '"></label></div></div>';

  function periode(racine, o) {
    if (!racine) return null;
    o = o || {};
    nettoyer(racine);
    const today = o.today || aujourdhui();
    const valide = (liste, id) => liste.some(x => x.id === id);
    let p = valide(PERIODES, o.periode) ? o.periode : "1a";
    let du = o.du || "", au = o.au || "";
    let gChoisie = valide(GRANULARITES, o.granularite);
    const bornes = () => {
      const P = lesPeriodes();
      if (p === "perso") {
        if (!du || !au) return null;
        return P ? P.bornes({ du, au }, today, o.premiere) : du <= au ? { du, au } : { du: au, au: du };
      }
      return P ? P.bornes(p, today, o.premiere) : null;
    };
    const auto = () => { const P = lesPeriodes(), b = bornes(); const g = P && b ? P.auto(b) : "mois"; return valide(GRANULARITES, g) ? g : "mois"; };
    let g = gChoisie ? o.granularite : auto();
    const valeur = () => { const b = bornes(); return { periode: p, granularite: g, du: b ? b.du : null, au: b ? b.au : null }; };
    const notifier = () => { if (typeof o.surChange === "function") o.surChange(valeur()); };

    racine.innerHTML = htmlPeriode({ du, au }, p === "perso");
    const dates = racine.querySelector(".ui-periode-dates");
    const champDu = racine.querySelector("[data-ui-du]"), champAu = racine.querySelector("[data-ui-au]");
    const cg = bascule(racine.querySelector(".ui-periode-g"), {
      label: "Granularité", options: GRANULARITES, actif: g,
      surChange: id => { g = id; gChoisie = true; notifier(); },
    });
    bascule(racine.querySelector(".ui-periode-p"), {
      label: o.label || "Période", options: PERIODES, actif: p,
      surChange: id => {
        const avant = bornes();
        p = id;
        if (p === "perso") {
          if (!du) du = avant ? avant.du : "";
          if (!au) au = avant ? avant.au : today;
          champDu.value = du; champAu.value = au;
        }
        dates.hidden = p !== "perso";
        if (!gChoisie) { g = auto(); cg.choisir(g); }
        notifier();
      },
    });
    const surDate = () => {
      du = champDu.value || ""; au = champAu.value || "";
      if (du && au && du > au) { const t = du; du = au; au = t; champDu.value = du; champAu.value = au; }
      if (!gChoisie) { g = auto(); cg.choisir(g); }
      if (du && au) notifier();
    };
    dates.addEventListener("change", surDate);
    ecouteurs.set(racine, () => dates.removeEventListener("change", surDate));
    return { valeur };
  }

  /* ============================================================ Demander à Claude ============================================================ */
  const urlClaude = question => "https://claude.ai/new?q=" + encodeURIComponent(String(question ?? ""));
  function demanderAClaude(question, libelle) {
    return '<a class="ui-claude" href="' + esc(urlClaude(question)) + '" target="_blank" rel="noopener noreferrer">' + ETINCELLE +
      "<span>" + esc(vide(libelle) ? "Demander à Claude" : libelle) + "</span>" + sr(" (nouvel onglet)") + "</a>";
  }

  /* ============================================================ panneau ============================================================ */
  const lienSur = h => (typeof h === "string" && (/^#[^\s"'<>]*$/.test(h) || /^https:\/\/[^\s"'<>]+$/.test(h)) ? h : null);
  const htmlPied = (lien, pied) => {
    const h = lien && lienSur(lien.href);
    return (h ? '<a class="ui-panneau-lien" href="' + esc(h) + '"' + (h[0] === "#" ? "" : ' target="_blank" rel="noopener noreferrer"') + "><span>" +
      esc(lien.label || "Voir le détail") + "</span>" + CHEVRON_DROITE + "</a>" : "") + (pied == null ? "" : String(pied));
  };
  const PANNEAU_HTML =
    '<div class="ui-panneau-poignee" aria-hidden="true"></div>' +
    '<div class="ui-panneau-tete"><h2 class="ui-panneau-titre" id="ui-panneau-titre" tabindex="-1"></h2>' +
    '<button type="button" class="ui-panneau-fermer" aria-label="Fermer" title="Fermer (Échap)">' + CROIX + "</button></div>" +
    '<div class="ui-panneau-corps"></div><div class="ui-panneau-pied" hidden></div>';
  const SEL_FOCALISABLES = "a[href],button,input,select,textarea,summary,[tabindex]";
  const visible = el => !el.closest("[hidden]") && (typeof el.getClientRects !== "function" || el.getClientRects().length > 0);
  const focalisables = c => Array.from(c.querySelectorAll(SEL_FOCALISABLES))
    .filter(el => !el.hasAttribute("disabled") && el.getAttribute("tabindex") !== "-1" && el.getAttribute("type") !== "hidden" && visible(el));

  const panneau = (function () {
    let el = null, voile = null, titreEl = null, corps = null, piedEl = null;
    let estOuvert = false, retourEl = null, inertes = [], surFermeture = null;

    function construire(d) {
      voile = d.createElement("div");
      voile.className = "ui-voile";
      voile.hidden = true;
      el = d.createElement("div");
      el.className = "ui-panneau";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-labelledby", "ui-panneau-titre");
      el.hidden = true;
      el.innerHTML = PANNEAU_HTML;
      titreEl = el.querySelector(".ui-panneau-titre");
      corps = el.querySelector(".ui-panneau-corps");
      piedEl = el.querySelector(".ui-panneau-pied");
      voile.addEventListener("click", () => fermer());
      el.querySelector(".ui-panneau-fermer").addEventListener("click", () => fermer());
      el.addEventListener("keydown", pieger);
      // un lien interne mène à une autre vue : on ferme d'abord (le focus suivra la navigation)
      el.addEventListener("click", e => {
        const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
        if (a && el.contains(a)) fermer({ focus: false });
      });
      d.body.appendChild(voile);
      d.body.appendChild(el);
    }
    function pieger(e) {
      if (e.key !== "Tab" || !estOuvert) return;
      const f = focalisables(el);
      const actif = leDocument().activeElement;
      if (!f.length) { e.preventDefault(); titreEl.focus(); return; }
      const premier = f[0], dernier = f[f.length - 1];
      if (e.shiftKey && (actif === premier || actif === titreEl || actif === el || !el.contains(actif))) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && (actif === dernier || !el.contains(actif))) { e.preventDefault(); premier.focus(); }
    }
    function surTouche(e) {
      if (estOuvert && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fermer(); }
    }
    function surFocus(e) {
      if (estOuvert && el && e.target && !el.contains(e.target)) titreEl.focus();
    }
    function ouvrir(o) {
      const d = leDocument();
      if (!d) return null;
      o = o || {};
      if (!el || !el.parentNode) construire(d);
      if (!estOuvert) retourEl = o.retour || d.activeElement;
      else if (o.retour) retourEl = o.retour;
      titreEl.textContent = o.titre == null ? "" : String(o.titre);
      if (o.contenu && typeof o.contenu === "object" && o.contenu.nodeType) { corps.textContent = ""; corps.appendChild(o.contenu); }
      else { const contenuHtml = o.contenu == null ? "" : String(o.contenu); corps.innerHTML = contenuHtml; }
      piedEl.innerHTML = htmlPied(o.lien, o.pied);
      piedEl.hidden = !piedEl.querySelector("a,button") && !o.pied;
      surFermeture = typeof o.surFermeture === "function" ? o.surFermeture : null;
      if (!estOuvert) {
        estOuvert = true;
        inertes = Array.from(d.body.children).filter(c => c !== el && c !== voile && !c.inert);
        inertes.forEach(c => { c.inert = true; });
        voile.hidden = false;
        el.hidden = false;
        d.documentElement.classList.add("ui-bloque");
        d.addEventListener("keydown", surTouche, true);
        d.addEventListener("focusin", surFocus, true);
      }
      corps.scrollTop = 0;
      titreEl.focus();
      return corps;
    }
    function fermer(opts) {
      if (!estOuvert) return;
      const d = leDocument();
      estOuvert = false;
      d.removeEventListener("keydown", surTouche, true);
      d.removeEventListener("focusin", surFocus, true);
      inertes.forEach(c => { c.inert = false; });
      inertes = [];
      el.hidden = true;
      voile.hidden = true;
      d.documentElement.classList.remove("ui-bloque");
      const r = retourEl, f = surFermeture;
      retourEl = null; surFermeture = null;
      if (!(opts && opts.focus === false) && r && r !== d.body && typeof r.focus === "function") r.focus();
      if (f) f();
    }
    return { ouvrir, fermer: () => fermer(), ouvert: () => estOuvert };
  })();

  return {
    esc, carte, panneau, onglets, bascule, accordeon, voirPlus, brancher, periode, demanderAClaude, urlClaude,
    htmlOnglets, htmlBascule, cibleClavier, PERIODES, GRANULARITES,
  };
});
