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

   UI.carte({ id, titre, valeur, sous?, tendance?, badge?, aria? }) → HTML
     Carte repliée : <button class="ui-carte" data-ui-carte="<id>">, à ouvrir en panneau (voir UI.brancher).
     aria = nom accessible complet (aria-label), quand le texte lu dans l'ordre (titre, badge, valeur, pied) ne commence pas par
     l'essentiel : il remplace tout le texte de la carte pour les lecteurs d'écran, il doit donc le reprendre.
     tendance = { sens: "hausse" | "baisse" | "stable", texte?, ton?: "pos" | "neg" | "neutre" } : ▲ / ▼ / – ; le ton par défaut
     suit le sens (hausse → pos), à forcer pour une dette (baisse → pos). Le sens est lu en clair aux lecteurs d'écran.
     badge = "Provisoire" | { texte, ton: "neutre" | "info" | "bon" | "attention" | "critique" }. Valeur absente → « — ».
     Grille conseillée : <div class="ui-cartes">…</div> (4 colonnes sur ordinateur, 2 sur mobile).
     Exemple : UI.carte({ id: "net", titre: "Patrimoine net", valeur: "512 300 €", sous: "sur 1 an",
                          tendance: { sens: "hausse", texte: "+3,2 %" }, badge: "Provisoire" })

   UI.puce(statut | { statut, texte? }) → HTML
     Chip de statut : point de 8 px et libellé en toutes lettres (12 px, 600). 4 statuts, jamais une couleur de texte courant :
     "bon" (Bon), "surveiller" (À surveiller), "travailler" (À travailler), "completer" (À compléter : neutre, contour pointillé, une
     donnée manquante n'est pas une faute). `texte` remplace le libellé (« Correct »). Statut inconnu → "".
     Exemple : UI.puce("surveiller")  ·  UI.puce({ statut: "bon", texte: "Correct" })

   UI.carte : variantes (UX1) — `variante: "heros"` (chiffre de 36 px, 44 sur ordinateur), `"compacte"` (104 px au moins, valeur de 22 px, sans
     chevron : rangée de 3 dans <div class="ui-cartes compactes">) ; `statut` = argument de UI.puce, affiché sous la valeur.
     Exemple : UI.carte({ id: "bp", titre: "Bonnes pratiques", valeur: "79", variante: "compacte", statut: "bon" })

   UI.ligne({ titre, sous?, montant?, delta?: { texte, ton }, icone?, id? | href?, barre?, aria?, multiligne? }) → HTML
     Ligne de liste : 56 px (64 avec sous-libellé), toute la ligne cliquable (<button data-ui-ligne> avec `id`, <a> avec `href` « #… » ou
     « https://… », sinon <div> sans chevron), icône de 32 px (clé de UI.ICONES : alerte, banque, calendrier, check, maison, graphe,
     document, personne, etincelle), montant à droite en chiffres tabulaires, delta en dessous (ton pos | neg | neutre), barre de part de 4 px
     (0 à 100). multiligne : le titre passe à la ligne au lieu d'être tronqué.
     Exemple : UI.ligne({ id: "pea", titre: "PEA Camille", sous: "3 lignes · 26,8 %", montant: UI.fmtEUR(24380), barre: 26.8 })
     etat? = argument de UI.puce (« bon », ou { statut, texte }) : puce de statut dans une colonne propre, avant le montant ; etat: "" réserve la colonne
     vide (à poser sur les lignes sans état d'une liste dont d'autres lignes en ont un, pour que montant et chevron restent alignés).
   UI.tuile({ libelle, valeur, sous? }) → HTML
     Chiffre secondaire posé dans une carte (fond --sunk, jamais une carte dans une carte). Grille conseillée : <div class="ui-tuiles">…</div>.
     Exemple : UI.tuile({ libelle: "Plus-values latentes", valeur: "+4 210 €", sous: "sur 3 lignes" })
   UI.vide({ texte, icone?, action?: { texte, id | href } }) → HTML
     État vide : icône de 24 px, une phrase (ce qui manque et pourquoi ça compte), une action (« Compléter avec Claude »). À poser dans la carte
     qui aurait reçu le contenu, jamais en page entière. icone : clé de UI.ICONES (défaut « document »).
     Exemple : UI.vide({ texte: "Aucun objectif pour l'instant : fixe le premier pour voir ta trajectoire.", action: { texte: "Compléter avec Claude", href: UI.urlClaude("Aide-moi à fixer mon premier objectif") } })
   UI.squelette(n, forme) → HTML
     Place réservée pendant le chargement (S.ready faux) : n blocs de la forme « kpi » (96 px), « ligne » (56 px) ou « graphe » (220 px, 320 sur ordinateur),
     à la hauteur du contenu final (aucun saut). Annoncé « chargement » aux lecteurs d'écran ; la pulsation est coupée en mouvement réduit.
     Exemple : UI.squelette(4, "kpi") + UI.squelette(1, "graphe")
   UI.liste(lignes, { label? }) → HTML
     <ul class="ui-liste"> : séparateurs internes, sans carte par ligne. `lignes` : HTML de UI.ligne ou UI.aTraiter.
     Exemple : UI.liste(comptes.map(c => UI.ligne({ id: c.id, titre: c.nom, montant: UI.fmtEUR(c.solde) })), { label: "Comptes" })

   UI.aTraiter({ titre, raison?, icone?, urgent?, action?: { texte, id | href, aria? } }) → HTML
     Élément d'« À traiter » : icône de type, titre (2 lignes au plus), une ligne de raison, action à droite (36 px visuels, zone de 44 px).
     La priorité vient de l'ordre ; `urgent` (true → « Urgent », ou un texte comme « Bloquant ») ajoute la chip seulement si le délai
     ou le blocage est réel.
     Exemple : UI.aTraiter({ titre: "5 changements à valider", raison: "Proposés par Claude", icone: "etincelle", action: { texte: "Examiner", href: "#agent/propositions" } })

   UI.bouton({ texte, variante?: "primaire" | "secondaire" | "tertiaire", href? | id?, pleineLargeur? }) → HTML
     Primaire (plein, marque : un par écran au plus), secondaire (contour), tertiaire (texte souligné) ; 44 px de haut sur mobile, 40 sur ordinateur.
     Exemple : UI.bouton({ texte: "Valider la sélection", id: "valider" })

   UI.defilant(racine) → { maj(), montrerActif() }
     Fondu de bord d'un conteneur qui défile horizontalement (chips, onglets) : pose data-fade = none | start | end | both (CSS : fondu de 24 à
     28 px) et le met à jour au défilement et au redimensionnement ; rappeler renvoie la même instance. UI.onglets l'applique tout seul.
     montrerActif() recentre l'élément actif ([aria-selected="true"] ou [aria-pressed="true"]). UI.etatFondu(gauche, largeur, total) est la règle pure.
     Exemple : const d = UI.defilant($("subTabs")); d.montrerActif()

   Formats : UI.fmtEUR, UI.fmtPct, UI.fmtDate, UI.fmtDelta, UI.fmtNombre, UI.fmtAxe, UI.graduations, UI.classeMontant sont ceux de format.js (voir son en-tête).
     Exemple : UI.fmtEUR(193490, { compact: "kpi" }) → « 193 k€ »  ·  UI.fmtDelta({ montant: 9646, pct: 5.2 }).texte → « ▲ +9 646 € · +5,2 % sur 1 an »

   UI.decisionGlisse(dy, dt) → booléen : règle du glisser vers le bas qui ferme la feuille (dy px en dt ms : au moins 96 px, ou 24 px à 0,6 px/ms).

   UI.panneau.ouvrir({ titre, contenu, lien?, pied?, retour?, surFermeture? }) → élément de contenu (.ui-panneau-corps)
   UI.panneau.fermer({ focus? }?)   UI.panneau.ouvert() → booléen
   UI.panneau.remplacer({ titre?, contenu?, lien?, pied? }) → élément de contenu, ou null si le panneau est fermé
     Panneau de détail unique (role="dialog", aria-modal="true", aria-labelledby sur le titre), créé dans document.body à la
     première ouverture : volet latéral droit de 480 px à partir de 900 px, feuille du bas (92 vh max, poignée, titre collant, glisser vers le bas pour fermer) en dessous ;
     ouverture 220 ms, fermeture 180 ms (sans animation si le mouvement est réduit). Fond voilé,
     reste de la page inerte, focus piégé (Tab / Maj+Tab), fermeture par Échap, clic sur le voile, bouton « Fermer » ou lien
     interne (#…) cliqué dans le panneau ; le focus revient à `retour` ou, à défaut, à l'élément actif avant l'ouverture.
     Retour arrière du navigateur (popstate) ou hash changé pendant l'ouverture : le panneau se ferme sans reprendre le
     focus (la coque le pose sur la vue atteinte) ; ces écouteurs de window ne sont posés que tant que le panneau est ouvert.
     Un écouteur posé avant eux (la coque) peut fermer le panneau lui-même avant de naviguer : fermer({ focus: false }).
     titre : texte (posé en textContent). contenu : HTML déjà échappé, ou un nœud DOM. lien = { label, href } (href « #… »
     ou « https://… » seulement) affiché en pied ; pied : HTML déjà échappé ajouté au pied (ex. UI.demanderAClaude(…)).
     Rouvrir pendant que le panneau est ouvert remplace son contenu. Si ce nouvel appel ne fournit ni `retour` ni
     `surFermeture` (simple rafraîchissement du contenu), les précédents sont conservés : le focus reviendra au même endroit
     et le même rappel sera appelé ; s'il en fournit un, `retour` fourni remplace l'ancien et `surFermeture` est remplacé
     (absent = plus de rappel). surFermeture({ focus }) est appelé après la fermeture ; focus vaut false quand le panneau a
     été fermé sans reprise du focus (fermer({ focus: false }), retour arrière, lien interne).
     Exemple : const corps = UI.panneau.ouvrir({ titre: "Patrimoine net", contenu: "<p>" + UI.esc(detail) + "</p>",
                                                 lien: { label: "Voir les placements", href: "#patrimoine/placements" } });
     remplacer : mise à jour d'un panneau ouvert (détail arrivé après l'ouverture, rafraîchissement) sans toucher au focus ni au
     défilement, ni au retour et au rappel de fermeture ; seuls les champs fournis changent (lien et pied vont ensemble). Si
     l'élément qui avait le focus disparaît avec l'ancien contenu, le focus revient au titre du panneau.
     Exemple : UI.panneau.remplacer({ contenu: "<p>" + UI.esc(detailComplet) + "</p>" })

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

   UI.voirPlus(liste, n = 5, rendu?(x, i) → HTML, libelle = "Voir plus", balise = "div", cle?) → HTML
     Id stable (dérivé de cle, sinon du libellé et du début de la liste) : deux rendus identiques donnent le même HTML, et un
     bloc déplié le reste au rendu suivant.
     Les n premiers éléments, puis les autres dans un bloc caché et un bouton « Voir plus (k) » (data-ui-voirplus,
     aria-expanded) que UI.brancher fait déplier / replier. Sans rendu, chaque élément est échappé tel quel.
     balise = "ul" ou "ol" : les deux blocs sont des listes (le rendu doit alors renvoyer des <li>) ; "div" par défaut.
     Exemple : $("boite").innerHTML = UI.voirPlus(elements, 5, e => "<div class=\"it\">" + UI.esc(e.titre) + "</div>");
               UI.brancher($("boite"));

   UI.brancher(racine, { surCarte?(id, element) }?) → racine
     Délégation de clics sur `racine` : boutons « Voir plus » et cartes (surCarte reçoit data-ui-carte et le bouton).
     Exemple : UI.brancher(root, { surCarte: id => UI.panneau.ouvrir(detail(id)) })

   UI.periode(racine, { periode?, granularite?, du?, au?, premiere?, today?, label?, surChange?(etat) }) → { valeur(), premiere(date) }
     Sélecteur de période (1 m · 3 m · 1 an · Tout · Personnalisée) et de granularité (jour → année), deux bascules.
     « Personnalisée » affiche deux champs date (Du, Au). etat = { periode, granularite, du, au } : bornes calculées par
     window.Periodes (web/src/periodes.js) s'il est chargé (null sinon, hors période personnalisée). Sans granularité donnée,
     elle suit Periodes.auto(bornes) (« mois » sans Periodes) jusqu'à ce que l'utilisateur en choisisse une.
     premiere = date de la première donnée (pour « Tout ») ; premiere(date) la met à jour quand les données arrivent après
     la création (sans notifier, sauf si « Tout » est actif et que sa granularité automatique change). Passer de « Tout »
     (ou d'une période sans durée) à « Personnalisée » préremplit les dates avec la période précédente, sinon avec 1 an.
     Défaut : 1 an.
     Exemple : UI.periode($("frisePeriode"), { periode: "1a", granularite: "mois", premiere: snaps[0].date,
                                               surChange: e => dessiner(Periodes.agreger(snaps, e, e.granularite, s => s.net)) })

   UI.markdown(md, { niveau = 3 }?) → HTML
     Markdown limité et sûr, pour les textes écrits par l'agent ou publiés (fiches, journal, expertises) : tout le HTML d'origine
     est échappé AVANT de reconnaître le balisage. « # » et « ## » → h<niveau>, « ### » → h<niveau+1>… (plafond h6) ; « - » et
     « 1. » → listes, une ligne de liste indentée (2 espaces ou plus) sous un item → sous-liste dans cet item, la numérotation
     continuant ensuite ; ligne indentée sans marque → suite de l'item ; **gras**, `code`, [texte](https://…) (seul https://, nouvel
     onglet, rel="noopener noreferrer") ; paragraphes séparés par une ligne vide ; espaces insécables avant % et € et dans les
     milliers. Aucun autre balisage n'est produit.
     Exemple : corps.innerHTML = UI.markdown(fiche.contenu, { niveau: 4 })

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

  /* Formats uniques (format.js, global Fmt) : alias UI.fmtEUR, UI.fmtPct… ; absents si format.js n'est pas chargé (tests isolés de ui.js). */
  const F = (typeof globalThis !== "undefined" && globalThis.Fmt) || (typeof module === "object" && module.exports && typeof require === "function" ? (() => { try { return require("./format.js"); } catch (e) { return null; } })() : null);

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
  /* Statuts : 4 valeurs, toujours avec un libellé (point de couleur + texte), jamais une couleur de texte courant. */
  const STATUTS = {
    bon: { classe: "bon", libelle: "Bon" },
    surveiller: { classe: "surveiller", libelle: "À surveiller" },
    travailler: { classe: "travailler", libelle: "À travailler" },
    completer: { classe: "completer", libelle: "À compléter" },
  };
  function puce(o) {
    const x = typeof o === "string" ? { statut: o } : o || {};
    const st = STATUTS[x.statut];
    if (!st) return "";
    return '<span class="ui-puce ' + st.classe + '"><span class="ui-puce-point" aria-hidden="true"></span>' + esc(vide(x.texte) ? st.libelle : x.texte) + "</span>";
  }
  const VARIANTES_CARTE = ["heros", "compacte"];
  function carte(o) {
    o = o || {};
    const pied = htmlTendance(o.tendance) + (vide(o.sous) ? "" : '<span class="ui-carte-sous">' + esc(o.sous) + "</span>");
    const variante = VARIANTES_CARTE.includes(o.variante) ? " " + o.variante : "";
    return '<button type="button" class="ui-carte' + variante + '" data-ui-carte="' + esc(o.id) + '" aria-haspopup="dialog"' +
      (vide(o.aria) ? "" : ' aria-label="' + esc(o.aria) + '"') + ">" +
      '<span class="ui-carte-tete"><span class="ui-carte-titre">' + esc(o.titre) + "</span>" + htmlBadge(o.badge) + "</span>" +
      '<span class="ui-carte-valeur">' + (vide(o.valeur) ? "—" : esc(o.valeur)) + "</span>" +
      (vide(o.statut) ? "" : '<span class="ui-carte-statut">' + puce(o.statut) + "</span>") +
      (pied ? '<span class="ui-carte-pied">' + pied + "</span>" : "") +
      '<span class="ui-carte-ouvrir">' + CHEVRON_DROITE + "</span></button>";
  }

  /* ============================================================ ligne de liste, élément à traiter, bouton ============================================================ */
  const ICONES = {
    alerte: "M12 3l9.5 17h-19zM12 10v4.5M12 17.5v.5",
    banque: "M3 10l9-6 9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18",
    calendrier: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
    check: "M5 12.5l4.5 4.5L19 7.5",
    maison: "M3.5 11L12 4l8.5 7M5.5 9.5V20h13V9.5",
    graphe: "M4 20V11M10 20V5M16 20v-6M21 20H3",
    document: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
    personne: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5",
  };
  const icone = k => (ICONES[k] ? '<span class="ui-ligne-ico" aria-hidden="true">' + svg(ICONES[k]) + "</span>" : k === "etincelle" ? '<span class="ui-ligne-ico" aria-hidden="true">' + ETINCELLE + "</span>" : "");
  const TONS_MONTANT = ["pos", "neg", "neutre"];
  /* Lien de ligne ou d'action : « #… » ou « https://… » (un « ' » est admis : encodeURIComponent le laisse, esc() le protège dans l'attribut). */
  const lienLigne = h => (typeof h === "string" && (/^#\S*$/.test(h) || /^https:\/\/\S+$/.test(h)) ? h : null);

  /** Ligne de liste : 56 px (64 avec sous-libellé), toute la ligne cliquable, montant à droite en chiffres tabulaires. */
  function ligne(o) {
    o = o || {};
    const href = lienLigne(o.href), actif = href || !vide(o.id);
    const balise = href ? "a" : actif ? "button" : "div";
    const attrs = href ? ' href="' + esc(href) + '"' + (/^https:/.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "") : actif ? ' type="button" data-ui-ligne="' + esc(o.id) + '"' : "";
    const d = o.delta && typeof o.delta === "object" ? o.delta : null;
    const barre = Number.isFinite(+o.barre) && o.barre !== null && o.barre !== "" ? Math.max(0, Math.min(100, +o.barre)) : null;
    return "<" + balise + ' class="ui-ligne' + (actif ? " actif" : "") + (o.multiligne ? " multi" : "") + (vide(o.sous) ? "" : " avec-sous") + (barre != null ? " avec-barre" : "") + '"' + attrs + (vide(o.aria) ? "" : ' aria-label="' + esc(o.aria) + '"') + ">" +
      icone(o.icone) +
      '<span class="ui-ligne-corps"><span class="ui-ligne-titre">' + esc(o.titre) + "</span>" +
      (vide(o.sous) ? "" : '<span class="ui-ligne-sous">' + esc(o.sous) + "</span>") + "</span>" +
      (o.etat == null ? "" : '<span class="ui-ligne-etat">' + (o.etat === "" ? "" : puce(o.etat)) + "</span>") +
      (vide(o.montant) && !d ? "" : '<span class="ui-ligne-montant"><span class="ui-ligne-valeur num">' + esc(o.montant) + "</span>" +
        (d ? '<span class="ui-ligne-delta num ' + (TONS_MONTANT.includes(d.ton) ? d.ton : "neutre") + '">' + esc(d.texte) + "</span>" : "") + "</span>") +
      (actif ? '<span class="ui-ligne-chevron" aria-hidden="true">' + CHEVRON_DROITE + "</span>" : "") +
      (barre != null ? '<span class="ui-ligne-barre" aria-hidden="true"><span style="width:' + barre.toFixed(1) + '%"></span></span>' : "") +
      "</" + balise + ">";
  }
  /** Liste de lignes : séparateurs internes, pas de carte par ligne. `lignes` : HTML de UI.ligne / UI.aTraiter. */
  function liste(lignes, o) {
    o = o || {};
    const xs = Array.isArray(lignes) ? lignes : [];
    return '<ul class="ui-liste"' + (vide(o.label) ? "" : ' aria-label="' + esc(o.label) + '"') + ">" + xs.map(h => "<li>" + h + "</li>").join("") + "</ul>";
  }
  /** Élément d'« À traiter » : icône de type, titre, une ligne de raison, une action à droite (zone de 44 px), « Urgent » seulement si le délai ou le blocage est réel. */
  function aTraiter(o) {
    o = o || {};
    const a = o.action && typeof o.action === "object" ? o.action : null;
    const href = a ? lienLigne(a.href) : null;
    const act = !a ? "" : (href ? '<a class="ui-item-action" href="' + esc(href) + '"' : '<button type="button" class="ui-item-action" data-ui-action="' + esc(a.id) + '"') +
      (vide(a.aria) ? "" : ' aria-label="' + esc(a.aria) + '"') + "><span>" + esc(a.texte) + "</span>" + (href ? "</a>" : "</button>");
    const urgent = o.urgent ? '<span class="ui-item-meta">' + puce({ statut: "travailler", texte: typeof o.urgent === "string" ? o.urgent : "Urgent" }) + "</span>" : "";
    return '<div class="ui-item' + (o.urgent ? " urgent" : "") + '">' + (icone(o.icone) || '<span class="ui-ligne-ico" aria-hidden="true"></span>') +
      '<span class="ui-ligne-corps">' + urgent + '<span class="ui-ligne-titre">' + esc(o.titre) + "</span>" +
      (vide(o.raison) ? "" : '<span class="ui-ligne-sous">' + esc(o.raison) + "</span>") + "</span>" + act + "</div>";
  }
  /** Tuile : chiffre secondaire dans une carte (libellé, valeur, sous-ligne facultative). */
  function tuile(o) {
    o = o || {};
    return '<div class="ui-tuile"><span class="ui-tuile-l">' + esc(o.libelle) + '</span><span class="ui-tuile-v num">' + (vide(o.valeur) ? "—" : esc(o.valeur)) + "</span>" +
      (vide(o.sous) ? "" : '<span class="ui-tuile-s">' + esc(o.sous) + "</span>") + "</div>";
  }
  /** État vide : icône, phrase, action. */
  function videEtat(o) {
    o = o || {};
    const a = o.action && typeof o.action === "object" && !vide(o.action.texte) ? o.action : null;
    const act = !a ? "" : '<span class="ui-vide-action">' + bouton({ texte: a.texte, variante: "secondaire", href: a.href, id: a.id }) + "</span>";
    return '<div class="ui-vide"><span class="ui-vide-ico" aria-hidden="true">' + svg(ICONES[o.icone] || ICONES.document) + '</span><p class="ui-vide-texte">' + esc(o.texte) + "</p>" + act + "</div>";
  }
  const FORMES_SQUELETTE = ["kpi", "ligne", "graphe"];
  /** Squelette de chargement : n blocs (1 à 24) de la forme donnée. */
  function squelette(n, forme) {
    const f = FORMES_SQUELETTE.includes(forme) ? forme : "ligne";
    const k = Math.max(1, Math.min(24, Math.floor(+n) || 1));
    return '<div class="ui-squelette" role="status" aria-busy="true" aria-label="Chargement en cours">' + ('<span class="ui-skel-bloc ' + f + '" aria-hidden="true"></span>').repeat(k) + "</div>";
  }
  const VARIANTES_BOUTON = { primaire: "", secondaire: " secondaire", tertiaire: " tertiaire" };
  /** Bouton : primaire (plein, marque ; un seul par écran au plus), secondaire (contour), tertiaire (texte souligné) ; 44 px sur mobile, 40 sur ordinateur. */
  function bouton(o) {
    o = o || {};
    const classe = "ui-btn" + (VARIANTES_BOUTON[o.variante] || "") + (o.pleineLargeur ? " plein" : "");
    const href = lienLigne(o.href);
    return href
      ? '<a class="' + classe + '" href="' + esc(href) + '">' + esc(o.texte) + "</a>"
      : '<button type="button" class="' + classe + '"' + (vide(o.id) ? "" : ' data-ui-bouton="' + esc(o.id) + '"') + ">" + esc(o.texte) + "</button>";
  }

  /* ============================================================ défilement : fondu de bord ============================================================ */
  /** État du fondu d'un conteneur à défilement horizontal : "none" (rien ne déborde), "end" (suite à droite), "start" (suite à gauche), "both". */
  function etatFondu(gauche, largeur, total) {
    if (!(total > largeur + 1)) return "none";
    const debut = gauche > 1, fin = gauche + largeur < total - 1;
    return debut && fin ? "both" : fin ? "end" : debut ? "start" : "none";
  }
  const defilants = new WeakMap();
  /** Pose data-fade (none | start | end | both) sur un conteneur qui défile horizontalement (onglets, chips) ; rappeler renvoie la même instance.
      { maj() } recalcule (après un nouveau rendu) ; { montrerActif() } fait défiler pour que l'élément actif reste visible. */
  function defilant(racine) {
    if (!racine || typeof racine.addEventListener !== "function") return null;
    if (defilants.has(racine)) return defilants.get(racine);
    const maj = () => racine.setAttribute("data-fade", etatFondu(racine.scrollLeft, racine.clientWidth, racine.scrollWidth));
    const montrerActif = () => {
      const el = racine.querySelector('[aria-selected="true"],[aria-pressed="true"],[aria-current]');
      if (!el || !(racine.scrollWidth > racine.clientWidth) || typeof el.getBoundingClientRect !== "function") return;
      const a = racine.getBoundingClientRect(), b = el.getBoundingClientRect();
      racine.scrollLeft += b.left - a.left - (a.width - b.width) / 2;
    };
    racine.addEventListener("scroll", maj, { passive: true });
    const w = typeof window !== "undefined" ? window : null;
    if (w && typeof w.addEventListener === "function") w.addEventListener("resize", maj);
    if (typeof ResizeObserver !== "undefined") { try { new ResizeObserver(maj).observe(racine); } catch (e) { /* sans observateur : scroll et resize suffisent */ } }
    const ctl = { maj, montrerActif };
    defilants.set(racine, ctl);
    maj();
    return ctl;
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
    if (cfg.cle === "onglets") { const d = defilant(racine.querySelector(".ui-onglets")); if (d) d.montrerActif(); }
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

  /* Identifiant stable d'un « Voir plus » : même contenu → même id, pour que les signatures de HTML (anti-redessin) restent
     égales d'un rendu à l'autre ; l'état déplié est retenu par clé et restauré au rendu suivant. */
  const deplies = new Set();
  function hacher(t) { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function voirPlus(liste, n, rendu, libelle, balise, cle) {
    const xs = Array.isArray(liste) ? liste : [];
    const b = balise === "ul" || balise === "ol" ? balise : "div";
    const k = n == null || !isFinite(+n) ? 5 : Math.max(0, Math.floor(+n));
    const r = typeof rendu === "function" ? rendu : x => esc(x);
    const tete = xs.slice(0, k).map((x, i) => r(x, i)).join("");
    const reste = xs.slice(k);
    if (!reste.length) return '<div class="ui-voirplus"><' + b + ' class="ui-voirplus-liste">' + tete + "</" + b + "></div>";
    const lib = vide(libelle) ? "Voir plus" : String(libelle);
    const corps = reste.map((x, i) => r(x, i + k)).join("");
    const id = "ui-reste-" + hacher(vide(cle) ? lib + "|" + tete.slice(0, 200) : String(cle));
    const ouvert = deplies.has(id);
    return '<div class="ui-voirplus"><' + b + ' class="ui-voirplus-liste">' + tete + "</" + b + ">" +
      "<" + b + ' class="ui-voirplus-liste ui-voirplus-reste" id="' + id + '"' + (ouvert ? "" : " hidden") + ">" + corps + "</" + b + ">" +
      '<button type="button" class="ui-voirplus-btn" data-ui-voirplus data-ui-libelle="' + esc(lib) + '" data-ui-nombre="' + reste.length + '" aria-expanded="' + ouvert + '" aria-controls="' + id + '">' +
      (ouvert ? "Voir moins" : esc(lib) + " (" + reste.length + ")") + "</button></div>";
  }
  function basculerVoirPlus(btn) {
    const bloc = btn.closest(".ui-voirplus");
    const reste = bloc && Array.from(bloc.children).find(c => c.classList.contains("ui-voirplus-reste"));
    if (!reste) return;
    const deplier = reste.hidden;
    reste.hidden = !deplier;
    if (reste.id) { if (deplier) deplies.add(reste.id); else deplies.delete(reste.id); }
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
    { id: "1m", label: "1 M", aria: "1 mois" }, { id: "3m", label: "3 M", aria: "3 mois" }, { id: "1a", label: "1 A", aria: "1 an" }, // mêmes segments que comptes-view (1 M · 3 M · 1 A · 3 A · 5 A)
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
    let prem = o.premiere || undefined;
    const valide = (liste, id) => liste.some(x => x.id === id);
    let p = valide(PERIODES, o.periode) ? o.periode : "1a";
    let du = o.du || "", au = o.au || "";
    let gChoisie = valide(GRANULARITES, o.granularite);
    const bornes = () => {
      const P = lesPeriodes();
      if (p === "perso") {
        if (!du || !au) return null;
        return P ? P.bornes({ du, au }, today, prem) : du <= au ? { du, au } : { du: au, au: du };
      }
      return P ? P.bornes(p, today, prem) : null;
    };
    /* Un an jusqu'à aujourd'hui : repli de « Personnalisée » quand la période précédente n'a pas de durée (« Tout » sans données). */
    const unAn = () => {
      const P = lesPeriodes();
      if (P) return P.bornes("1a", today);
      const [y, m, j] = today.split("-").map(Number), d = new Date(Date.UTC(y - 1, m - 1, j));
      return { du: d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()), au: today };
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
          const b = avant && avant.du && avant.au && avant.du !== avant.au ? avant : unAn();
          if (!du) du = b.du;
          if (!au) au = b.au;
          if (du === au) { const a = unAn(); du = a.du; au = a.au; }
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
    function premiere(date) {
      const n = typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : undefined;
      if (n === prem) return;
      prem = n;
      if (p === "tout" && !gChoisie) { const g2 = auto(); if (g2 !== g) { g = g2; cg.choisir(g); notifier(); } }
    }
    return { valeur, premiere };
  }

  /* ============================================================ markdown ============================================================ */
  /* Le texte est échappé d'abord (esc) : les captures ci-dessous (URL, code) ne contiennent ni guillemet ni chevron. */
  const typo = t => t.replace(/(\d) (?=[%€]|\d{3}\b)/g, "$1\u00a0");
  const gras = t => typo(t).replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  function liens(t) {
    const re = /\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(t))) {
      out += gras(t.slice(last, m.index)) + '<a href="' + m[2] + '" target="_blank" rel="noopener noreferrer">' + gras(m[1]) + sr(" (nouvel onglet)") + "</a>";
      last = re.lastIndex;
    }
    return out + gras(t.slice(last));
  }
  /* En ligne : `code` d'abord (rien n'est interprété dedans), puis liens et gras dans le reste. */
  const enLigne = t => t.split(/(`[^`\n]+`)/).map((x, i) => (i % 2 ? "<code>" + x.slice(1, -1) + "</code>" : liens(x))).join("");
  const retrait = l => { let n = 0; for (const c of l) { if (c === " ") n++; else if (c === "\t") n += 4; else break; } return n; };

  function markdown(md, o) {
    if (md == null) return "";
    const v = o && Number(o.niveau), base = Number.isInteger(v) && v >= 1 ? Math.min(v, 6) : 3;
    const lignes = esc(String(md)).replace(/\r\n?/g, "\n").split("\n");
    let out = "", para = [];
    /* Pile des listes ouvertes : { type: "ul" | "ol", retrait, texte (texte de l'item courant pas encore écrit, ou null) }. */
    const pile = [];
    const haut = () => pile[pile.length - 1];
    const finPara = () => { if (para.length) out += "<p>" + enLigne(para.join(" ")) + "</p>"; para = []; };
    const ecrire = niv => { if (niv.texte != null) { out += enLigne(niv.texte); niv.texte = null; } };
    const ouvrirListe = (type, r, texte) => { if (pile.length) ecrire(haut()); out += "<" + type + "><li>"; pile.push({ type, retrait: r, texte }); };
    const fermerListe = () => { const n = pile.pop(); ecrire(n); out += "</li></" + n.type + ">"; };
    const fermerListes = () => { while (pile.length) fermerListe(); };
    function item(type, r, texte) {
      finPara();
      if (!pile.length || r >= haut().retrait + 2) { ouvrirListe(type, r, texte); return; } // première liste, ou sous-liste de l'item courant
      while (pile.length > 1 && r <= pile[pile.length - 2].retrait) fermerListe(); // remonte au niveau de cet item
      const n = haut();
      if (n.type === type) { ecrire(n); out += "</li><li>"; n.texte = texte; return; }
      const r0 = n.retrait;
      fermerListe(); // autre type au même niveau : nouvelle liste (dans l'item parent s'il y en a un)
      ouvrirListe(type, r0, texte);
    }
    for (const brute of lignes) {
      const l = brute.trim(), r = retrait(brute);
      let m;
      if (!l) { finPara(); fermerListes(); continue; }
      if ((m = /^(#{1,6})\s+(.+)$/.exec(l))) {
        finPara(); fermerListes();
        const h = "h" + Math.min(6, base + Math.max(0, m[1].length - 2));
        out += "<" + h + ">" + enLigne(m[2]) + "</" + h + ">";
        continue;
      }
      if ((m = /^-\s+(.+)$/.exec(l))) { item("ul", r, m[1]); continue; }
      if ((m = /^\d+\.\s+(.+)$/.exec(l))) { item("ol", r, m[1]); continue; }
      if (pile.length && r > 0) { const n = haut(); if (n.texte != null) n.texte += " " + l; else out += " " + enLigne(l); continue; } // suite de l'item
      fermerListes(); para.push(l);
    }
    finPara(); fermerListes();
    return out;
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

  /** Glisser vers le bas pour fermer la feuille : fermer si le déplacement dépasse 96 px, ou 24 px avec une vitesse d'au moins 0,6 px/ms. */
  function decisionGlisse(dy, dt) {
    if (!(dy > 0)) return false;
    return dy >= 96 || (dy >= 24 && dt > 0 && dy / dt >= 0.6);
  }

  const panneau = (function () {
    let el = null, voile = null, titreEl = null, corps = null, piedEl = null;
    let estOuvert = false, retourEl = null, inertes = [], surFermeture = null, minuterie = null;

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
      glisser(el.querySelector(".ui-panneau-poignee"), el.querySelector(".ui-panneau-tete"));
      el.addEventListener("keydown", pieger);
      // un lien interne mène à une autre vue : on ferme d'abord (le focus suivra la navigation)
      el.addEventListener("click", e => {
        const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
        if (a && el.contains(a)) fermer({ focus: false });
      });
      d.body.appendChild(voile);
      d.body.appendChild(el);
    }
    /* Feuille du bas (mobile) : la poignée et l'en-tête se tirent vers le bas ; relâcher au-delà du seuil ferme, sinon la feuille revient. */
    function glisser(...zones) {
      const w = fenetre();
      if (!w || typeof w.matchMedia !== "function") return;
      let y0 = null, t0 = 0, dy = 0;
      const feuille = () => w.matchMedia("(max-width: 899.98px)").matches;
      const fin = e => {
        if (y0 == null) return;
        const d = dy, dt = Math.max(1, (e && e.timeStamp ? e.timeStamp : Date.now()) - t0);
        y0 = null; dy = 0;
        reposer();
        if (decisionGlisse(d, dt)) fermer();
      };
      zones.forEach(z => {
        if (!z || typeof z.addEventListener !== "function") return;
        z.addEventListener("pointerdown", e => {
          if (!feuille() || (e.button != null && e.button !== 0) || (e.target.closest && e.target.closest("button"))) return;
          y0 = e.clientY; t0 = e.timeStamp || Date.now(); dy = 0;
          try { z.setPointerCapture(e.pointerId); } catch (x) { /* capture facultative */ }
        });
        z.addEventListener("pointermove", e => {
          if (y0 == null) return;
          dy = Math.max(0, e.clientY - y0);
          if (el.style) { el.style.transition = "none"; el.style.transform = "translateY(" + dy + "px)"; }
        });
        z.addEventListener("pointerup", fin);
        z.addEventListener("pointercancel", fin);
      });
    }
    const reposer = () => { if (el && el.style) { el.style.transition = ""; el.style.transform = ""; } };
    /* Fermeture animée (180 ms) seulement dans un navigateur qui anime ; sans animation (mouvement réduit, tests), le panneau se masque aussitôt. */
    const anime = () => { const w = fenetre(); return !!(w && typeof w.matchMedia === "function" && !w.matchMedia("(prefers-reduced-motion: reduce)").matches); };
    function masquer() {
      if (minuterie) { clearTimeout(minuterie); minuterie = null; }
      if (el) { el.hidden = true; el.classList.remove("sort"); }
      if (voile) { voile.hidden = true; voile.classList.remove("sort"); }
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
    /* Retour arrière / hash changé pendant l'ouverture : fermeture sans reprise du focus (la vue atteinte le gère). */
    const fenetre = () => (typeof window !== "undefined" && window && typeof window.addEventListener === "function" ? window : null);
    function surHistorique() { fermer({ focus: false }); }
    function ouvrir(o) {
      const d = leDocument();
      if (!d) return null;
      o = o || {};
      if (!el || !el.parentNode) construire(d);
      // Rafraîchissement d'un panneau ouvert sans retour ni surFermeture : on garde les précédents (sinon le focus se perd).
      const garder = estOuvert && !o.retour && typeof o.surFermeture !== "function";
      if (!estOuvert) retourEl = o.retour || d.activeElement;
      else if (o.retour) retourEl = o.retour;
      titreEl.textContent = o.titre == null ? "" : String(o.titre);
      if (o.contenu && typeof o.contenu === "object" && o.contenu.nodeType) { corps.textContent = ""; corps.appendChild(o.contenu); }
      else { const contenuHtml = o.contenu == null ? "" : String(o.contenu); corps.innerHTML = contenuHtml; }
      piedEl.innerHTML = htmlPied(o.lien, o.pied);
      piedEl.hidden = !piedEl.querySelector("a,button") && !o.pied;
      if (!garder) surFermeture = typeof o.surFermeture === "function" ? o.surFermeture : null;
      if (!estOuvert) {
        masquer(); // une fermeture animée encore en cours est terminée avant de rouvrir
        reposer();
        estOuvert = true;
        inertes = Array.from(d.body.children).filter(c => c !== el && c !== voile && !c.inert);
        inertes.forEach(c => { c.inert = true; });
        voile.hidden = false;
        el.hidden = false;
        d.documentElement.classList.add("ui-bloque");
        d.addEventListener("keydown", surTouche, true);
        d.addEventListener("focusin", surFocus, true);
        const w = fenetre();
        if (w) { w.addEventListener("hashchange", surHistorique); w.addEventListener("popstate", surHistorique); }
      }
      corps.scrollTop = 0;
      titreEl.focus();
      return corps;
    }
    /* Mise à jour d'un panneau ouvert sans reprise du focus (sauf s'il disparaît avec l'ancien contenu) ni remise à zéro du défilement. */
    function remplacer(o) {
      if (!estOuvert) return null;
      o = o || {};
      const d = leDocument(), actif = d.activeElement;
      if (o.titre !== undefined) titreEl.textContent = o.titre == null ? "" : String(o.titre);
      if (o.contenu !== undefined) {
        if (o.contenu && typeof o.contenu === "object" && o.contenu.nodeType) { corps.textContent = ""; corps.appendChild(o.contenu); }
        else { const contenuHtml = o.contenu == null ? "" : String(o.contenu); corps.innerHTML = contenuHtml; }
      }
      if (o.lien !== undefined || o.pied !== undefined) {
        piedEl.innerHTML = htmlPied(o.lien, o.pied);
        piedEl.hidden = !piedEl.querySelector("a,button") && !o.pied;
      }
      if (actif && actif !== d.body && !actif.isConnected) titreEl.focus();
      return corps;
    }
    function fermer(opts) {
      if (!estOuvert) return;
      const d = leDocument();
      estOuvert = false;
      d.removeEventListener("keydown", surTouche, true);
      d.removeEventListener("focusin", surFocus, true);
      const w = fenetre();
      if (w) { w.removeEventListener("hashchange", surHistorique); w.removeEventListener("popstate", surHistorique); }
      inertes.forEach(c => { c.inert = false; });
      inertes = [];
      if (anime()) {
        el.classList.add("sort"); voile.classList.add("sort");
        minuterie = setTimeout(masquer, 200);
      } else masquer();
      d.documentElement.classList.remove("ui-bloque");
      const r = retourEl, f = surFermeture, focus = !(opts && opts.focus === false);
      retourEl = null; surFermeture = null;
      if (focus && r && r !== d.body && typeof r.focus === "function") r.focus();
      if (f) f({ focus });
    }
    return { ouvrir, remplacer, fermer: o => fermer(o && o.focus === false ? { focus: false } : null), ouvert: () => estOuvert };
  })();

  return {
    esc, carte, panneau, onglets, bascule, accordeon, voirPlus, brancher, periode, demanderAClaude, urlClaude, markdown,
    puce, ligne, liste, tuile, vide: videEtat, squelette, aTraiter, bouton, defilant, etatFondu, decisionGlisse, ICONES, STATUTS,
    htmlOnglets, htmlBascule, cibleClavier, PERIODES, GRANULARITES,
    fmtNombre: F && F.fmtNombre, fmtEUR: F && F.fmtEUR, fmtPct: F && F.fmtPct, fmtDate: F && F.fmtDate, fmtDelta: F && F.fmtDelta,
    classeMontant: F && F.classeMontant, graduations: F && F.graduations, fmtAxe: F && F.fmtAxe,
  };
});
