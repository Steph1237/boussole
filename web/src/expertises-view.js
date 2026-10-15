/* Agent › Savoir › Expertises : les méthodes d'analyse que le Copilote patrimonial consulte à la demande (spec
   docs/superpowers/specs/2026-10-11-ex1-copilote-expertises.md § 3), en lecture seule : transparence sur ce que sait et fait Claude.
   S.expertises = [{ slug, nom, quandConsulter, perimetre, version, misAJourLe, marches, angles }] (liste, sans détail) ;
   Store.expertises.detail(slug) → { …, methode (markdown), controles (phrases), garde_fous (markdown), format (markdown), themesSavoir,
   reperes (clés), changelog, versions: [{ version, le, resume }] } ou null, appelé à l'ouverture. En démo, seules les expertises
   COMPLETES du générateur (scripts/gen-expertises-demo.mjs) ont leur détail complet ; les autres arrivent sans méthode ni garde-fous
   (methode null) : le panneau le signale en nommant les complètes, lues dans window.DEMO (completesDemo).
   Page : introduction, cartes UI.carte (nom, quand consulter, version) ; panneau UI.panneau : version, quand consulter, périmètre,
   marchés, méthode, points de contrôle, garde-fous, forme de la réponse et historique des versions (accordéons), sources mobilisées,
   « Demander à Claude » (ClaudePrompts.phrase("expertise", nom)).
   Lien profond : #agent/expertises?expertise=<slug> (App.parametres(), lien du journal) ouvre l'expertise au show(), ou dès que la
   liste est chargée ; oublié si la vue est quittée entre-temps. Le détail arrivé remplace le contenu du panneau (UI.panneau.remplacer),
   sans reprendre le focus.
   Sécurité : rendreMarkdown délègue à UI.markdown (ui.js), qui échappe tout le HTML AVANT de reconnaître le balisage limité (titres,
   listes et sous-listes, gras, code, liens https://) ; toute autre donnée passe par esc.
   Fonctions pures exportées pour les tests : esc, rendreMarkdown, extrait, cartesHtml, panneauHtml, piedHtml, versionsDe,
   questionClaude, etatVide, completesDemo, MARCHES, THEMES. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const liste = v => (Array.isArray(v) ? v : []);

  const MARCHES = { fr: "France", eu: "Europe", us: "États-Unis", em: "Pays émergents", monde: "Monde" };
  const THEMES = {
    epargne: "Épargne", enveloppes: "Enveloppes", fiscalite: "Fiscalité", immobilier: "Immobilier", retraite: "Retraite",
    protection: "Protection", marches: "Marchés", comportement: "Comportement", credit: "Crédit",
  };
  /** Noms des expertises présentées en entier dans la démo : celles dont les données générées (demo-data.js, bloc
      @genere:expertises, liste COMPLETES de scripts/gen-expertises-demo.mjs) portent la méthode. */
  const completesDemo = D => liste(D && D.expertises).filter(e => e && plat(e.methode)).map(e => plat(e.nom));
  const CHIFFRES = ["zéro", "une", "deux", "trois", "quatre", "cinq", "six", "sept"];
  function noteDemo(noms) {
    const n = liste(noms).map(plat).filter(Boolean);
    const qui = !n.length ? "seules certaines expertises sont présentées en entier"
      : n.length === 1 ? "seule l'expertise " + n[0] + " est présentée en entier"
      : "seules " + (CHIFFRES[n.length] || n.length) + " expertises sont présentées en entier (" + n.join(", ") + ")";
    return "Démo : " + qui + ". Ici, tu vois le périmètre et les points de contrôle ; la méthode et les garde-fous complets sont dans ton espace.";
  }

  /* ---------- dates, textes ---------- */
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  /** « 11 octobre 2026 » pour une date AAAA-MM-JJ (ou un horodatage) ; la chaîne telle quelle sinon. */
  function dateFr(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ""));
    return m ? (+m[3] === 1 ? "1er" : String(+m[3])) + " " + MOIS[+m[2] - 1] + " " + m[1] : plat(d);
  }
  /** Texte ramené à n caractères au plus, coupé au dernier espace, avec « … ». */
  function extrait(t, n) {
    const s = plat(t), max = n || 160;
    if (s.length <= max) return s;
    const c = s.slice(0, max - 1), i = c.lastIndexOf(" ");
    return (i > max * 0.6 ? c.slice(0, i) : c).replace(/[\s,;:.«(–—-]+$/, "") + "…";
  }

  /* ---------- markdown limité, sûr : rendu partagé UI.markdown (ui.js), sous les titres de section du panneau (« ## » → h4) ---------- */
  const leUI = () => glob("UI") || (typeof require === "function" ? require("./ui.js") : null);
  const rendreMarkdown = md => { const u = leUI(); return u ? u.markdown(md, { niveau: 4 }) : ""; };

  /* ---------- rendus HTML ---------- */
  /** Cartes de la liste (UI.carte échappe chaque champ) ; liste vide → "". */
  function cartesHtml(xs, U) {
    const l = liste(xs).filter(e => e && e.slug);
    if (!l.length) return "";
    return '<ul class="xv-cartes">' + l.map(e => {
      const nom = plat(e.nom) || e.slug, v = "Version " + (e.version || 1), sous = extrait(e.quandConsulter, 170);
      /* nom accessible : le nom de l'expertise d'abord (la version est affichée en tête de carte) */
      return '<li class="xv-it">' + U.carte({ id: e.slug, titre: v, valeur: nom, sous, aria: nom + ", " + v.toLowerCase() + (sous ? ". " + sous : "") }) + "</li>";
    }).join("") + "</ul>";
  }

  /** Historique : versions publiées (expertises_versions) sinon journal des versions (changelog), la plus récente d'abord. */
  function versionsDe(d) {
    if (!d) return [];
    const v = liste(d.versions).length ? liste(d.versions) : liste(d.changelog);
    return v.filter(x => x && Number.isFinite(+x.version)).map(x => ({ version: +x.version, le: x.le ?? null, resume: x.resume ?? null }))
      .sort((a, b) => b.version - a.version);
  }

  /** Phrase « Demander à Claude » : active l'expertise sur la situation de l'utilisateur. */
  function questionClaude(nom, Prompts) {
    const Pr = Prompts || glob("ClaudePrompts");
    return Pr && typeof Pr.phrase === "function" ? Pr.phrase("expertise", nom)
      : "Boussole : consulte l'expertise " + plat(nom) + " sur ma situation. Commence par demarrer_session.";
  }
  /** Pied du panneau : bouton « Demander à Claude » (HTML échappé par UI.demanderAClaude). */
  const piedHtml = (resume, U, Prompts) => U.demanderAClaude(questionClaude((resume && resume.nom) || "", Prompts), "Demander à Claude");

  const section = (titre, corps, cls) => '<section class="xv-d' + (cls ? " " + cls : "") + '"><h3 class="xv-d-t">' + esc(titre) + "</h3>" + corps + "</section>";
  /* Libellés des repères (0010_savoir_reperes.sql), en repli quand S.savoir.reperes ne les contient pas (démo, lecture en échec). */
  const LIB_REPERES = {
    livret_a_taux: "Taux du Livret A", livret_a_plafond: "Plafond du Livret A", ldds_plafond: "Plafond du LDDS", lep_taux: "Taux du LEP",
    lep_plafond: "Plafond du LEP", pea_plafond: "Plafond de versements du PEA", pfu_taux: "Prélèvement forfaitaire unique",
    av_abattement_seul: "Abattement assurance-vie après 8 ans (personne seule)", av_abattement_couple: "Abattement assurance-vie après 8 ans (couple)",
    hcsf_taux_effort: "Taux d'effort maximal (HCSF)", hcsf_duree_max: "Durée maximale du crédit immobilier (HCSF)", pass: "Plafond annuel de la Sécurité sociale",
  };
  const libRepere = (cle, reperes) => { const r = liste(reperes).find(x => x && x.cle === cle); return r && r.libelle ? plat(r.libelle) : LIB_REPERES[cle] || cle; };

  /** Contenu du panneau (HTML échappé). o = { U, etat: "chargement" | "pret" | "indisponible", demo, completes (noms présentés en
      entier dans la démo, completesDemo), reperes (S.savoir.reperes) }.
      resume : l'élément de S.expertises ; detail : la réponse de Store.expertises.detail (ou null). */
  function panneauHtml(resume, detail, o) {
    const opt = o || {}, U = opt.U;
    const e = Object.assign({}, resume || {}, opt.etat === "pret" && detail ? detail : {});
    const meta = ["Version " + (e.version || 1), e.misAJourLe ? "mise à jour le " + dateFr(e.misAJourLe) : ""].filter(Boolean).join(" · ");
    let h = '<p class="xv-meta">' + esc(meta) + "</p>";
    if (plat(e.quandConsulter)) h += '<p class="xv-quand"><span class="xv-quand-l">Quand Claude la consulte</span>' + esc(e.quandConsulter) + "</p>";
    if (plat(e.perimetre)) h += section("Périmètre", "<p>" + esc(e.perimetre) + "</p>");
    const marches = liste(e.marches).filter(m => MARCHES[m]);
    if (marches.length) h += section("Marchés couverts", '<ul class="xv-puces">' + marches.map(m => "<li>" + esc(MARCHES[m]) + "</li>").join("") + "</ul>");
    if (opt.etat === "chargement") return h + '<p class="xv-charge">Chargement de la méthode…</p>';
    if (opt.etat !== "pret" || !detail) return h + '<p class="xv-erreur" role="alert">Cette expertise n\'est plus publiée ou n\'a pas pu être lue, réessaie plus tard.</p>';
    const complet = !!plat(e.methode);
    if (!complet) h += '<p class="xv-note">' + esc(opt.demo ? noteDemo(opt.completes)
      : "La méthode détaillée de cette expertise n'est pas disponible pour le moment : seuls son périmètre et ses points de contrôle sont affichés.") + "</p>";
    else h += section("Méthode", '<div class="xv-md">' + rendreMarkdown(e.methode) + "</div>");
    const ctl = liste(e.controles).map(plat).filter(Boolean);
    if (ctl.length) h += section("Points de contrôle", '<ul class="xv-ctl">' + ctl.map(c => "<li>" + esc(c) + "</li>").join("") + "</ul>");
    if (plat(e.garde_fous)) h += section("Garde-fous", '<div class="xv-md">' + rendreMarkdown(e.garde_fous) + "</div>");
    const themes = liste(e.themesSavoir).filter(Boolean), reps = liste(e.reperes).filter(Boolean);
    if (themes.length || reps.length) h += section("S'appuie sur", '<dl class="xv-src">' +
      (themes.length ? "<dt>Fiches du savoir</dt><dd>" + esc(themes.map(t => THEMES[t] || t).join(", ")) + "</dd>" : "") +
      (reps.length ? "<dt>Chiffres de référence</dt><dd>" + esc(reps.map(c => libRepere(c, opt.reperes)).join(", ")) + "</dd>" : "") + "</dl>");
    if (plat(e.format)) h += U.accordeon({ titre: "Forme de la réponse", contenu: '<div class="xv-md">' + rendreMarkdown(e.format) + "</div>" });
    const vs = versionsDe(e);
    if (vs.length) h += U.accordeon({ titre: "Historique des versions", contenu: '<ol class="xv-hist">' + vs.map(v => "<li>" +
      '<span class="xv-hist-d">' + esc("Version " + v.version + (v.le ? " · " + dateFr(v.le) : "")) + "</span>" +
      (plat(v.resume) ? '<span class="xv-hist-t">' + esc(v.resume) + "</span>" : "") + "</li>").join("") + "</ol>" });
    h += '<p class="xv-legende">Ces textes s\'adressent à Claude : « tu » désigne Claude, « l\'utilisateur », c\'est toi. Contenu pédagogique, pas un conseil en investissement.</p>';
    return h;
  }

  /** État à afficher quand la liste est vide : "chargement", "erreur" ou "vide" ; null si la liste n'est pas vide. */
  function etatVide(S, n) {
    if (n > 0) return null;
    if (!S || S.ready === false) return "chargement";
    return S.error ? "erreur" : "vide";
  }

  const H = { esc, rendreMarkdown, extrait, cartesHtml, panneauHtml, piedHtml, versionsDe, questionClaude, etatVide, completesDemo, MARCHES, THEMES };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =================================================================== vue =================================================================== */
  let S = null, root = null, dirty = true, sig = "";
  let ouvert = null, detail = null, etat = null, jeton = 0, retourCarte = null, corps = null, lien = null;
  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const expertises = () => (S && Array.isArray(S.expertises) ? S.expertises : []);
  const resumeDe = slug => expertises().find(e => e && e.slug === slug) || null;
  const carteDe = slug => (root && slug ? root.querySelector('[data-ui-carte="' + CSS.escape(String(slug)) + '"]') : null);
  const estDemo = () => !!(window.Store && Store.mode === "demo");
  const reperes = () => (S && S.savoir && Array.isArray(S.savoir.reperes) ? S.savoir.reperes : []);
  function dire(m) { const el = $("xvMsg"); el.textContent = m || ""; el.hidden = !m; }

  function render() {
    const u = U();
    if (!root || !u) return;
    const xs = expertises(), ev = etatVide(S, xs.length);
    $("xvVide").hidden = ev !== "vide";
    $("xvErr").hidden = ev !== "erreur";
    $("xvCompte").textContent = xs.length ? xs.length + " expertise" + (xs.length > 1 ? "s" : "") + " publiée" + (xs.length > 1 ? "s" : "") : "";
    const h = cartesHtml(xs, u);
    if (h !== sig) { sig = h; $("xvListe").innerHTML = h; }
    ouvrirLien();
  }

  /* Lien profond (#agent/expertises?expertise=<slug>) : ouvre l'expertise dès que la liste est chargée. */
  function ouvrirLien() {
    if (!lien || !S || S.ready === false) return;
    const slug = lien;
    lien = null;
    if (!resumeDe(slug)) {
      /* lecture en échec : le bandeau d'erreur suffit, l'expertise n'est pas forcément introuvable */
      if (!S.error) dire("Cette expertise est introuvable : elle n'est peut-être plus publiée.");
      return;
    }
    const u = U();
    if (u && u.panneau.ouvert() && ouvert !== slug) u.panneau.fermer({ focus: false });
    ouvrir(slug, carteDe(slug));
  }

  const contenu = r => panneauHtml(r, detail, { U: U(), etat, demo: estDemo(), completes: estDemo() ? completesDemo(glob("DEMO")) : [], reperes: reperes() });
  function options(r) {
    const u = U();
    return { titre: plat(r.nom) || "Expertise", contenu: contenu(r),
      retour: retourCarte, pied: piedHtml(r, u), surFermeture: fermeture };
  }
  /* Fermeture : le focus revient à la carte d'origine, ou à la carte du même slug si la liste a été redessinée entre-temps. */
  function fermeture(o) {
    const slug = ouvert, el = retourCarte;
    ouvert = null; detail = null; etat = null; retourCarte = null; corps = null; jeton++;
    if ((o && o.focus === false) || !root) return;
    if (el && el.isConnected) return; // UI.panneau lui a déjà rendu le focus
    const c = carteDe(slug);
    if (c) c.focus();
  }

  async function ouvrir(slug, el) {
    const u = U(), r = resumeDe(slug);
    if (!u || !r) return;
    dire("");
    const j = ++jeton;
    ouvert = slug; detail = null; etat = "chargement"; retourCarte = el || null;
    corps = u.panneau.ouvrir(options(r));
    let d = null;
    try {
      const api = window.Store && window.Store.expertises;
      d = api && typeof api.detail === "function" ? await window.Store.expertises.detail(slug) : null;
    } catch (e) { d = null; }
    if (j !== jeton || ouvert !== slug || !u.panneau.ouvert()) return; // panneau fermé ou autre expertise ouverte entre-temps
    detail = d; etat = d ? "pret" : "indisponible";
    /* seul le contenu change : ni focus repris par le titre, ni défilement remis à zéro */
    corps = u.panneau.remplacer({ contenu: contenu(resumeDe(slug) || r) }) || corps;
  }

  function mount(r) {
    root = r;
    $("xvTitre").setAttribute("tabindex", "-1");
    const u = U();
    if (u) u.brancher($("xvListe"), { surCarte: (slug, el) => ouvrir(slug, el) });
  }
  /* Vue masquée : un lien profond encore en attente (liste pas chargée) est oublié, il ne s'ouvrira pas sur une autre vue plus tard. */
  function update(snap, visible) { S = snap; dirty = true; if (visible) { render(); dirty = false; } else lien = null; }
  function show() {
    const p = window.App && typeof App.parametres === "function" ? App.parametres() : {};
    if (p && p.expertise) lien = String(p.expertise);
    if (dirty) { render(); dirty = false; } else ouvrirLien();
  }

  const api = { mount, update, show };
  const reg = () => App.register("expertises-view", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
