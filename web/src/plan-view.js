/* Patrimoine › Budget (module « plan ») : « Où va mon argent chaque mois ? ».
   - En-tête : revenus, dépenses, épargne, reste en cartes (UI.carte → panneau de détail), bascule Par mois · Par an
     (UI.bascule ; montants ×12 par an, le taux d'épargne ne change pas), barre empilée des dépenses par catégorie.
   - Une carte par catégorie (montant, part du total du type) qui se déplie en lignes (<details>, état ouvert conservé au
     redessin) ; dépenses : 5 catégories puis « Voir plus ». Lignes reprises de Compte › Données (salaires, loyers, prêts) en
     lecture seule, avec le lien pour les modifier.
   - Une ligne ouvre un panneau (UI.panneau) : détail, « Modifier à la main » (formulaire dans le panneau, bascules type,
     fréquence, titulaire), « Supprimer » (confirmation). « Ajouter une ligne » (et « Ajouter une ligne ici » dans une catégorie)
     ouvre le même formulaire. Chaque enregistrement du panneau écrit tout le budget (Store.db.doc("budget/main").set).
   - « Remplir avec mon assistant » : dialogue inchangé (le message à copier, la réponse collée, aperçu des changements) ; le
     résultat va dans le brouillon, enregistré par la barre « Enregistrer le budget » (avec détection d'une modification ailleurs).
   Les objectifs et la projection vivent dans Patrimoine › Objectifs (objectifs-view.js). Calculs : plan.js (Plan) et calc.js (Calc).
   Fonctions pures exportées pour les tests : lignesProfil, regrouper, resume, barre, validerLigne, lignesAEnregistrer, cartesHtml,
   barreHtml, groupesHtml, ligneDetailHtml, ligneFormHtml, resumeDetailHtml. Dépendances injectées (ctx) : { Plan, Calc } ;
   window.* par défaut. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) && d[k] ? d[k] : glob(k));

  /* ---------- formats ---------- */
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const eur = v => (v == null || !isFinite(v) ? "—" : nf.format(Math.round(v)) + " €");
  const pct = v => (v == null || !isFinite(v) ? "—" : (v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " %");
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- vocabulaire ---------- */
  const TYPES = [{ id: "depense", label: "Dépense" }, { id: "revenu", label: "Revenu" }, { id: "epargne", label: "Épargne" }];
  const TYPE_LABEL = { depense: "Dépense", revenu: "Revenu", epargne: "Épargne" };
  const FREQUENCES = [{ id: "mois", label: "Par mois" }, { id: "an", label: "Par an" }];
  const MODES = {
    mois: { facteur: 1, suffixe: "/mois", unite: "par mois", label: "Par mois" },
    an: { facteur: 12, suffixe: "/an", unite: "par an", label: "Par an" },
  };
  const CAT_ORDER = ["Logement", "Alimentation", "Transport", "Enfants", "Santé", "Loisirs", "Abonnements", "Impôts", "Divers", "Autres"];
  const CATS_SUGGEREES = ["Logement", "Alimentation", "Transport", "Enfants", "Santé", "Loisirs", "Abonnements", "Impôts", "Divers", "Épargne", "Revenus"];
  const defCat = t => (t === "epargne" ? "Épargne" : t === "revenu" ? "Revenus" : "");
  const REPERES_TAUX = { bon: "au-dessus du repère", attention: "sous le repère", critique: "très bas" };
  const CHEVRON = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';

  /* ---------- personnes ---------- */
  const nomDe = (k, people) => { const p = (people || []).find(x => x && x.id === k); return (p && p.nom) || (k === "p2" ? "Conjoint(e)" : "Moi"); };
  const partDe = (l, scope, Calc) => Calc.partCredit(scope || "foyer", l && (l.owner === "p1" || l.owner === "p2") ? l.owner : "commun");
  const mode0 = m => MODES[m] || MODES.mois;

  /* =============================================================== calculs de présentation =============================================================== */
  /** Lignes reprises de Compte › Données (lecture seule) pour le périmètre : { rev: [[libellé, mensuel]], dep: [[libellé, mensuel]] }. */
  function lignesProfil(profil, scope, people, Calc) {
    const pr = profil || {}, ps = pr.personnes || {}, sc = scope || "foyer", two = (people || []).length > 1;
    const who = sc === "foyer" ? ["p1"].concat(two ? ["p2"] : []) : [sc];
    const rev = [], dep = [];
    if (!profil) return { rev, dep };
    who.forEach(k => {
      const de = Calc.deNom(nomDe(k, people), k === "p2" ? 2 : 1);
      const sal = Calc.salaireNetMensuel(ps[k]);
      if (sal > 0) rev.push(["Salaire net " + de, sal]);
      const autres = Math.max(0, +(ps[k] && ps[k].autresRevenus) || 0);
      if (autres > 0) rev.push(["Autres revenus " + de, autres]);
    });
    (pr.biens || []).forEach(b => {
      const p = Calc.part(sc, b.part_p1);
      if (+b.loyer > 0 && p > 0) rev.push(["Loyer perçu · " + (b.nom || "Bien"), +b.loyer * p]);
      if (+b.mensualite > 0 && p > 0) dep.push(["Prêt · " + (b.nom || "Bien"), +b.mensualite * p]);
    });
    (pr.credits || []).forEach(c => {
      const p = Calc.partCredit(sc, c.owner);
      if (+c.mensualite > 0 && p > 0) dep.push([(c.nom || "Crédit") + (c.owner === "commun" && sc !== "foyer" ? " (moitié)" : ""), +c.mensualite * p]);
    });
    return { rev, dep };
  }

  /** Catégorie affichée d'une ligne : la sienne, sinon « Autres » (dépense) ou la catégorie par défaut du type. */
  const normLigne = l => Object.assign({}, l, { categorie: plat(l.categorie) || (l.type === "depense" ? "Autres" : defCat(l.type)) });
  const rang = c => { const i = CAT_ORDER.indexOf(c); return i < 0 ? CAT_ORDER.length - 1.5 : i; };

  /** Groupes du budget par type puis catégorie. ctx = { profil, scope, people, Plan, Calc }.
      → { totaux (Plan.budgetTotaux), groupes: { revenu, depense, epargne } } ; chaque groupe
      { cle: "type:catégorie", type, titre, mensuel, part, lignes: [{ id, libelle, mensuel, brut, part, ligne }], profil: [{ libelle, mensuel }] }.
      mensuel = montant mensuel dans le périmètre (part du titulaire) ; part = part du total du type ; groupes et lignes triés par
      montant décroissant. Les prêts et crédits de Compte › Données forment la catégorie « Crédits », salaires et loyers « Revenus ». */
  function regrouper(lignes, ctx) {
    const c = ctx || {}, P = dep(c, "Plan"), C = dep(c, "Calc"), scope = c.scope || "foyer";
    const L = (Array.isArray(lignes) ? lignes : []).filter(Boolean).map(normLigne);
    const totaux = P.budgetTotaux(L, c.profil || null, scope);
    const pr = lignesProfil(c.profil, scope, c.people, C);
    const groupes = { revenu: [], depense: [], epargne: [] };
    const groupe = (type, titre) => {
      let g = groupes[type].find(x => x.titre === titre);
      if (!g) { g = { cle: type + ":" + titre, type, titre, mensuel: 0, part: 0, lignes: [], profil: [] }; groupes[type].push(g); }
      return g;
    };
    L.forEach(l => {
      if (!groupes[l.type]) return;
      const g = groupe(l.type, l.categorie), brut = P.mensuel(l), p = partDe(l, scope, C), m = brut * p;
      g.lignes.push({ id: l.id, libelle: plat(l.libelle) || "sans libellé", mensuel: m, brut, part: p, ligne: l });
      g.mensuel += m;
    });
    pr.rev.forEach(([lib, v]) => { const g = groupe("revenu", "Revenus"); g.profil.push({ libelle: lib, mensuel: v }); g.mensuel += v; });
    pr.dep.forEach(([lib, v]) => { const g = groupe("depense", "Crédits"); g.profil.push({ libelle: lib, mensuel: v }); g.mensuel += v; });
    const total = { revenu: totaux.revenus, depense: totaux.depenses, epargne: totaux.epargne };
    Object.keys(groupes).forEach(type => {
      groupes[type].forEach(g => {
        g.part = total[type] > 0 ? g.mensuel / total[type] : 0;
        g.lignes.sort((a, b) => b.mensuel - a.mensuel || b.brut - a.brut || a.libelle.localeCompare(b.libelle, "fr"));
      });
      groupes[type].sort((a, b) => b.mensuel - a.mensuel || rang(a.titre) - rang(b.titre) || a.titre.localeCompare(b.titre, "fr"));
    });
    return { totaux, groupes };
  }

  /** Résumé de l'en-tête dans le mode choisi (« mois » ×1, « an » ×12). aLignes : le budget a au moins une ligne (sinon reste inconnu).
      → { mode, facteur, suffixe, unite, revenus, revenusProfil, depenses, mensualites, epargne, reste, taux, ton, repere, negatif }. */
  function resume(t, mode, aLignes) {
    const m = mode0(mode), f = m.facteur, x = v => (+v || 0) * f;
    const taux = t && t.tauxEpargne != null && isFinite(t.tauxEpargne) ? t.tauxEpargne : null;
    const ton = taux == null ? null : taux >= 0.15 ? "bon" : taux >= 0.05 ? "attention" : "critique";
    return {
      mode: mode === "an" ? "an" : "mois", facteur: f, suffixe: m.suffixe, unite: m.unite,
      revenus: x(t.revenus), revenusProfil: x(t.revenusProfil), depenses: x(t.depenses), mensualites: x(t.mensualites), epargne: x(t.epargne),
      reste: aLignes ? x(t.reste) : null, taux, ton, repere: ton ? REPERES_TAUX[ton] : null, negatif: !!aLignes && t.reste < 0,
    };
  }

  /** Barre empilée des dépenses par catégorie (crédits compris) : [{ categorie, mensuel, part }], montant décroissant. */
  function barre(t) {
    const cats = Object.entries((t && t.parCategorie) || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const tot = cats.reduce((a, [, v]) => a + v, 0);
    return tot > 0 ? cats.map(([categorie, mensuel]) => ({ categorie, mensuel, part: mensuel / tot })) : [];
  }

  /** Message d'erreur d'une ligne (montant obligatoire, positif), ou null. */
  function validerLigne(l) {
    const lib = plat(l && l.libelle), nom = lib ? "« " + lib + " »" : "Cette ligne";
    const m = l ? l.montant : null;
    if (m == null || m === "" || !isFinite(+m)) return nom + " : indiquez un montant.";
    if (+m < 0) return nom + " : le montant ne peut pas être négatif.";
    return null;
  }

  /** Lignes telles qu'enregistrées dans budget/main : catégorie et libellé par défaut, montant numérique, fréquence mois|an,
      titulaire seulement s'il y a deux personnes. */
  function lignesAEnregistrer(lignes, two) {
    return (lignes || []).map(l => {
      const cat = plat(l.categorie) || defCat(l.type) || "Divers";
      const o = { id: l.id, type: l.type, categorie: cat, libelle: plat(l.libelle) || cat, montant: +l.montant, frequence: l.frequence === "an" ? "an" : "mois" };
      if (two && l.owner) o.owner = l.owner;
      return o;
    });
  }

  /* =============================================================== rendus HTML =============================================================== */
  /** Quatre cartes de l'en-tête (UI.carte) : revenus, dépenses, épargne (taux d'épargne en badge), reste. o = { duScope }. */
  function cartesHtml(r, U, o) {
    const u = r.unite;
    const sous = (...xs) => xs.filter(Boolean).join(" · ");
    return U.carte({ id: "revenu", titre: "Revenus " + ((o && o.duScope) || "du foyer"), valeur: eur(r.revenus),
        sous: sous(u, r.revenusProfil > 0 ? "dont " + eur(r.revenusProfil) + " repris de Compte › Données" : "renseignez vos salaires dans Compte › Données") }) +
      U.carte({ id: "depense", titre: "Dépenses", valeur: eur(r.depenses), sous: sous(u, r.mensualites > 0 ? "dont " + eur(r.mensualites) + " de crédits" : "crédits compris") }) +
      U.carte({ id: "epargne", titre: "Épargne", valeur: eur(r.epargne), sous: sous(u, r.taux != null ? "Taux d'épargne " + pct(r.taux) : "taux d'épargne inconnu"),
        badge: r.ton ? { texte: r.repere, ton: r.ton } : null }) +
      U.carte({ id: "reste", titre: "Reste", valeur: r.reste == null ? "—" : eur(r.reste),
        sous: r.reste == null ? "une fois le budget rempli" : r.negatif ? sous(u, "le budget dépense plus qu'il ne reçoit") : sous(u, "après dépenses et épargne"),
        badge: r.negatif ? { texte: "Négatif", ton: "critique" } : null });
  }

  /** Barre empilée (role="img", libellé lu) et légende ; couleurs de la série du thème (--s1…--s9). */
  function barreHtml(cats, mode) {
    if (!cats || !cats.length) return '<p class="pv-muet">Aucune dépense saisie.</p>';
    const f = mode0(mode).facteur, col = i => "var(--s" + ((i % 9) + 1) + ")";
    return '<div class="pv-stack" role="img" aria-label="' + esc(cats.map(c => c.categorie + " " + pct(c.part)).join(", ")) + '">' +
      cats.map((c, i) => '<span style="width:' + (c.part * 100).toFixed(2) + "%;background:" + col(i) + '" title="' + esc(c.categorie + " : " + eur(c.mensuel * f) + mode0(mode).suffixe) + '"></span>').join("") + "</div>" +
      '<ul class="pv-leg">' + cats.map((c, i) => '<li><span class="pv-sw" style="background:' + col(i) + '"></span>' + esc(c.categorie) +
        ' <b>' + esc(eur(c.mensuel * f)) + '</b> <span class="pv-muet">' + esc(pct(c.part)) + "</span></li>").join("") + "</ul>";
  }

  const roRow = (r, m) => '<li><span>' + esc(r.libelle) + ' <span class="pv-tag" title="Repris de Compte › Données">réel</span></span><span class="pv-num">' +
    esc(eur(r.mensuel * m.facteur) + m.suffixe) + "</span></li>";
  const lienProfil = '<a class="pv-link" href="#compte/donnees" data-goto="compte/donnees">Modifier dans Compte › Données</a>';

  function ligneHtml(x, m) {
    const l = x.ligne, notes = [];
    if (l.frequence === "an" && m.facteur === 1) notes.push("saisi : " + eur(+l.montant) + "/an");
    if (l.frequence !== "an" && m.facteur === 12) notes.push("saisi : " + eur(+l.montant) + "/mois");
    if (x.part === 0) notes.push("hors de cette vue");
    else if (x.part > 0 && x.part < 1) notes.push("votre part (moitié)");
    return '<li><button type="button" class="pv-ligne" data-pv-ligne="' + esc(x.id) + '" aria-haspopup="dialog">' +
      '<span class="pv-ligne-lib">' + esc(x.libelle) + '</span><span class="pv-ligne-mt pv-num">' + esc(eur(x.mensuel * m.facteur) + m.suffixe) + "</span>" +
      (notes.length ? '<span class="pv-ligne-note">' + esc(notes.join(" · ")) + "</span>" : "") + "</button></li>";
  }

  /** Une catégorie : carte dépliable (<details>) avec montant et part ; lignes reprises de Compte › Données, lignes du budget
      (boutons qui ouvrent le panneau), « Ajouter une ligne ici ». */
  function groupeHtml(g, m, ouverts) {
    const ouvert = ouverts && ouverts.has(g.cle);
    const seulProfil = !g.lignes.length && g.profil.length;
    return '<details class="ui-acc pv-cat" data-pv-cat="' + esc(g.cle) + '"' + (ouvert ? " open" : "") + ">" +
      '<summary class="ui-acc-titre pv-cat-t"><span class="pv-cat-nom">' + esc(g.titre) + '</span><span class="pv-cat-v">' +
      '<b class="pv-num">' + esc(eur(g.mensuel * m.facteur) + m.suffixe) + '</b><span class="pv-cat-part"><span class="ui-sr">, soit </span>' + esc(pct(g.part)) + "</span></span>" +
      '<span class="ui-acc-chevron">' + CHEVRON + "</span></summary>" +
      '<div class="ui-acc-corps pv-cat-corps">' +
      (g.profil.length ? '<div class="pv-ros"><p class="pv-ros-t">Repris de Compte › Données</p><ul class="pv-ro">' + g.profil.map(r => roRow(r, m)).join("") + "</ul>" + lienProfil + "</div>" : "") +
      (g.lignes.length ? '<ul class="pv-lignes">' + g.lignes.map(x => ligneHtml(x, m)).join("") + "</ul>" : "") +
      (seulProfil ? "" : '<button type="button" class="pv-ajout" data-pv-ajout="' + esc(g.type) + '" data-pv-ajout-cat="' + esc(g.titre) + '">Ajouter une ligne ici</button>') +
      "</div></details>";
  }

  const SECTIONS = [
    { type: "revenu", titre: "Revenus", vide: "Aucun revenu connu.", ajout: "Ajouter un revenu" },
    { type: "depense", titre: "Dépenses", vide: "Aucune dépense saisie.", ajout: "Ajouter une dépense" },
    { type: "epargne", titre: "Épargne", vide: "Aucune épargne prévue au budget.", ajout: "Ajouter une épargne" },
  ];
  /** Les trois sections (Revenus, Dépenses, Épargne) et leurs catégories. o = { mode, ouverts: Set de clés, two, U }. */
  function groupesHtml(groupes, o) {
    const opt = o || {}, m = mode0(opt.mode), U = opt.U || glob("UI");
    return SECTIONS.map(s => {
      const gs = (groupes && groupes[s.type]) || [];
      const total = gs.reduce((a, g) => a + g.mensuel, 0);
      const corps = gs.length
        ? (U && typeof U.voirPlus === "function" ? U.voirPlus(gs, 5, g => groupeHtml(g, m, opt.ouverts), "Voir plus de catégories") : gs.map(g => groupeHtml(g, m, opt.ouverts)).join(""))
        : '<p class="pv-muet">' + esc(s.vide) + ' <button type="button" class="pv-ajout" data-pv-ajout="' + s.type + '">' + esc(s.ajout) + "</button></p>";
      return '<section class="pv-sec" aria-labelledby="pv-sec-' + s.type + '"><div class="pv-sec-h"><h3 id="pv-sec-' + s.type + '">' + esc(s.titre) + "</h3>" +
        '<span class="pv-num pv-sec-t">' + esc(eur(total * m.facteur) + m.suffixe) + "</span></div>" + corps + "</section>";
    }).join("");
  }

  const msgHtml = m => (m && m.texte ? '<p class="pv-msg ' + (m.ok ? "ok" : "err") + '" role="' + (m.ok ? "status" : "alert") + '" data-pv-msg tabindex="-1">' + esc(m.texte) + "</p>" : "");
  const dl = rows => '<dl class="pv-dl">' + rows.map(([k, v]) => "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>").join("") + "</dl>";

  /** Détail d'une ligne dans le panneau. o = { scope, people, Calc, Plan, dbOk, confirmer, message, busy }. */
  function ligneDetailHtml(l, o) {
    const opt = o || {}, C = dep(opt, "Calc"), P = dep(opt, "Plan"), scope = opt.scope || "foyer", people = opt.people || [];
    const an = l.frequence === "an", m = +l.montant || 0, brut = P.mensuel(l), p = partDe(l, scope, C);
    const rows = [["Type", TYPE_LABEL[l.type] || l.type], ["Catégorie", plat(l.categorie) || (l.type === "depense" ? "Autres" : defCat(l.type))],
      ["Montant saisi", eur(m) + (an ? "/an" : "/mois")], [an ? "Soit par mois" : "Soit par an", an ? eur(brut) + "/mois" : eur(brut * 12) + "/an"]];
    if (people.length > 1) rows.push(["Titulaire", l.owner === "p1" || l.owner === "p2" ? nomDe(l.owner, people) : "Commun"]);
    if (scope !== "foyer") rows.push(["Dans cette vue", p === 0 ? "hors de cette vue" : pct(p) + " · " + eur(brut * p) + "/mois"]);
    const dis = opt.busy || !opt.dbOk ? " disabled" : "";
    const actions = opt.confirmer
      ? '<div class="pv-confirm" role="group" aria-label="Confirmer la suppression"><p>Supprimer « ' + esc(plat(l.libelle) || "cette ligne") + " » du budget ?</p>" +
        '<div class="pv-acts"><button type="button" class="pv-btn danger" data-pv-act="supprimer-oui"' + dis + '>Oui, supprimer</button>' +
        '<button type="button" class="pv-btn ghost" data-pv-act="supprimer-non">Non</button></div></div>'
      : '<div class="pv-acts"><button type="button" class="pv-btn" data-pv-act="modifier"' + dis + ">Modifier à la main</button>" +
        '<button type="button" class="pv-btn ghost danger" data-pv-act="supprimer"' + dis + ">Supprimer</button></div>";
    return msgHtml(opt.message) + dl(rows) + actions +
      (opt.dbOk ? "" : '<p class="pv-note">Lecture seule : le budget ne peut pas être modifié pour le moment.</p>');
  }

  /** Formulaire d'une ligne dans le panneau (bascules branchées par la vue). ed = { type, categorie, libelle, montant, frequence, owner }.
      o = { two, nouvelle, erreur, enAttente, busy, U }. */
  function ligneFormHtml(ed, o) {
    const opt = o || {}, U = opt.U || null, d = ed || {};
    const bascule = (cle, label, options, actif) => '<div class="pv-champ"><span class="pv-lab" id="pvf-' + cle + '-l">' + esc(label) + "</span>" +
      '<div class="pv-bascule" data-pv-bascule="' + cle + '" aria-labelledby="pvf-' + cle + '-l">' + (U && U.htmlBascule ? U.htmlBascule({ label, options, actif }) : "") + "</div></div>";
    const owners = [{ id: "commun", label: "Commun" }, { id: "p1", label: nomDe("p1", opt.people) }, { id: "p2", label: nomDe("p2", opt.people) }];
    return '<form class="pv-form" data-pv-form novalidate aria-label="' + (opt.nouvelle ? "Nouvelle ligne du budget" : "Modifier la ligne") + '">' +
      (opt.erreur ? '<p class="pv-msg err" role="alert" data-pv-msg tabindex="-1">' + esc(opt.erreur) + "</p>" : "") +
      bascule("type", "Type", TYPES, d.type || "depense") +
      '<div class="pv-champ"><label class="pv-lab" for="pvf-categorie">Catégorie</label><input class="pv-in" id="pvf-categorie" data-pv-champ="categorie" list="pvf-cats" autocomplete="off" value="' + esc(d.categorie || "") + '" placeholder="ex. Logement">' +
      '<datalist id="pvf-cats">' + CATS_SUGGEREES.map(c => '<option value="' + esc(c) + '"></option>').join("") + "</datalist></div>" +
      '<div class="pv-champ"><label class="pv-lab" for="pvf-libelle">Libellé</label><input class="pv-in" id="pvf-libelle" data-pv-champ="libelle" autocomplete="off" value="' + esc(d.libelle || "") + '" placeholder="ex. Courses"></div>' +
      '<div class="pv-champ"><label class="pv-lab" for="pvf-montant">Montant</label><span class="pv-money"><input id="pvf-montant" data-pv-champ="montant" type="number" inputmode="decimal" min="0" step="any" value="' + (d.montant == null ? "" : esc(d.montant)) + '"><span class="pv-u">€</span></span></div>' +
      bascule("frequence", "Fréquence", FREQUENCES, d.frequence === "an" ? "an" : "mois") +
      (opt.two ? bascule("owner", "Titulaire", owners, d.owner || "commun") : "") +
      (opt.enAttente ? '<p class="pv-note">Les autres changements en attente du budget seront enregistrés en même temps.</p>' : "") +
      '<div class="pv-acts"><button type="button" class="pv-btn" data-pv-act="enregistrer"' + (opt.busy ? " disabled" : "") + ">" + (opt.nouvelle ? "Ajouter la ligne" : "Enregistrer") + "</button>" +
      '<button type="button" class="pv-btn ghost" data-pv-act="annuler">Annuler</button></div></form>';
  }

  /** Détail d'une carte de l'en-tête : catégories du type (avec leurs lignes pour revenus et épargne), taux d'épargne, calcul du reste. */
  function resumeDetailHtml(type, groupes, r) {
    const m = mode0(r && r.mode), gs = (groupes && groupes[type]) || [];
    const liste = gs.length ? '<ul class="pv-det">' + gs.map(g => {
      const sous = type === "depense" ? [] : g.profil.map(x => [x.libelle, x.mensuel]).concat(g.lignes.map(x => [x.libelle, x.mensuel]));
      return '<li><div class="pv-det-l"><span>' + esc(g.titre) + '</span><b class="pv-num">' + esc(eur(g.mensuel * m.facteur) + m.suffixe) + "</b></div>" +
        (sous.length ? '<ul class="pv-det-sous">' + sous.map(([lib, v]) => "<li><span>" + esc(lib) + '</span><span class="pv-num">' + esc(eur(v * m.facteur)) + "</span></li>").join("") + "</ul>" : "") + "</li>";
    }).join("") + "</ul>" : "";
    if (type === "revenu") return (liste || '<p class="pv-note">Aucun revenu connu : renseignez vos salaires dans Compte › Données.</p>') +
      '<p class="pv-note">Salaires et loyers viennent de Compte › Données ; les autres revenus sont des lignes du budget.</p>';
    if (type === "depense") return (liste || '<p class="pv-note">Aucune dépense saisie.</p>') +
      '<p class="pv-note">Les mensualités de vos prêts et crédits viennent de Compte › Données.</p>';
    if (type === "epargne") return (liste || '<p class="pv-note">Aucune épargne prévue au budget.</p>') +
      '<p class="pv-note">Taux d\'épargne : ' + esc(r && r.taux != null ? pct(r.taux) + (r.repere ? " (" + r.repere + ")" : "") : "inconnu") +
      ". C'est l'épargne prévue et le reste positif, rapportés aux revenus ; repère 15 %.</p>";
    return dl([["Revenus", eur(r.revenus) + m.suffixe], ["Dépenses", eur(r.depenses) + m.suffixe], ["Épargne", eur(r.epargne) + m.suffixe],
      ["Reste", r.reste == null ? "—" : eur(r.reste) + m.suffixe]]) +
      '<p class="pv-note">Reste = revenus − dépenses − épargne. ' + (r.reste == null ? "Il se calcule une fois le budget rempli." : r.negatif ? "Il est négatif : le budget dépense plus qu'il ne reçoit." : "C'est la marge qui reste chaque mois après vos dépenses et votre épargne prévue.") + "</p>";
  }

  const H = { lignesProfil, regrouper, resume, barre, validerLigne, lignesAEnregistrer, cartesHtml, barreHtml, groupesHtml, ligneDetailHtml, ligneFormHtml,
    resumeDetailHtml, MODES, TYPES };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =================================================================== vue =================================================================== */
  let root = null, S = null, aRendre = true;
  /* budget : brouillon de lignes, dernière version reçue du store, signature de la version de base */
  let draft = [], remote = [], baseSig = null, dirty = false, saving = false, remoteChanged = false, showErrs = false, msg = null;
  /* affichage : mode (mois | an), catégories ouvertes, signatures des derniers contenus écrits */
  let mode = "mois", ctlMode = null;
  const ouverts = new Set();
  let sigCartes = "", sigBar = "", sigBudget = "", sigPanneau = "";
  /* panneau : { kind: "ligne" | "nouvelle" | "resume", id, edition, confirmer, message, retour, busy } */
  let pan = null, corpsPanneau = null;

  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const P = () => window.Plan, C = () => window.Calc;
  const uid = () => "bl-" + Math.random().toString(36).slice(2, 9);
  const people = () => (S && Array.isArray(S.people) ? S.people : []);
  const two = () => people().length > 1;
  const scope = () => (S && S.scope) || "foyer";
  const duScope = () => (scope() === "foyer" ? "du foyer" : C().deNom(nomDe(scope(), people()), scope() === "p2" ? 2 : 1));
  const ctxCalc = () => ({ profil: S && S.profil, scope: scope(), people: people(), Plan: P(), Calc: C() });
  const totaux = () => P().budgetTotaux(draft.map(normLigne), S && S.profil, scope());
  const SIG_KEYS = ["id", "type", "categorie", "libelle", "montant", "frequence", "owner"];
  const sig = lignes => JSON.stringify((lignes || []).map(l => SIG_KEYS.map(k => (l[k] == null ? null : l[k]))));
  const ligne = id => draft.find(l => String(l.id) === String(id)) || null;
  const echap = s => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"));

  function dire(m, ok) { const el = $("pvMsg"); el.textContent = m || ""; el.className = "pv-page-msg " + (ok ? "ok" : "err"); el.hidden = !m; }

  /* Réécrit un conteneur ; le focus revient à l'élément du même rôle (ligne, catégorie, carte) s'il était dedans. */
  const ATTRS_FOCUS = ["data-pv-ligne", "data-pv-cat", "data-ui-carte", "data-pv-ajout-cat"];
  function ecrire(el, h) {
    const a = document.activeElement;
    let cle = null;
    if (a && a !== el && el.contains(a)) {
      const porteur = a.closest ? (a.closest("[data-pv-ligne]") || a.closest("[data-pv-cat]") || a.closest("[data-ui-carte]") || a) : a;
      for (const at of ATTRS_FOCUS) if (porteur.hasAttribute && porteur.hasAttribute(at)) { cle = [at, porteur.getAttribute(at), a.localName === "summary"]; break; }
    }
    el.innerHTML = h;
    if (!cle) return;
    const n = el.querySelector("[" + cle[0] + '="' + echap(cle[1]) + '"]');
    const cible = n && cle[2] ? n.querySelector("summary") || n : n;
    if (cible && typeof cible.focus === "function") cible.focus();
  }

  /* ---------- rendu ---------- */
  function videHtml() {
    const pr = lignesProfil(S && S.profil, scope(), people(), C()), connus = pr.rev.map(([l, v]) => ({ libelle: l, mensuel: v })).concat(pr.dep.map(([l, v]) => ({ libelle: l, mensuel: v })));
    const u = U();
    return '<div class="pv-vide"><h3>Votre budget est vide</h3>' +
      "<p>En quelques lignes (logement, courses, transport, épargne…), le budget donne trois repères que le reste de Boussole ne peut pas deviner :</p>" +
      "<ul><li><b>votre taux d'épargne</b>, la part des revenus mise de côté chaque mois ;</li>" +
      "<li><b>votre matelas en mois de dépenses</b>, pour savoir combien de temps vous tiendriez sans revenu ;</li>" +
      "<li><b>votre score de santé</b> financière, affiché dans Pilotage › Santé.</li></ul>" +
      '<div class="pv-vide-act"><button type="button" class="pv-btn" data-pv-assist>Remplir avec mon assistant</button>' +
      '<button type="button" class="pv-btn ghost" data-pv-ajout="depense">Ajouter à la main</button>' +
      (u ? u.demanderAClaude("Aide-moi à construire mon budget mensuel dans Boussole : revenus, dépenses par catégorie et épargne.", "Construire mon budget avec Claude") : "") + "</div>" +
      (connus.length ? '<div class="pv-ros"><p class="pv-ros-t">Déjà connu grâce à Compte › Données</p><ul class="pv-ro">' + connus.map(r => roRow(r, MODES.mois)).join("") + "</ul>" + lienProfil + "</div>" : "") +
      "</div>";
  }

  function render() {
    const u = U();
    if (!root || !S || !u) return;
    const t = totaux(), has = draft.length > 0;
    const r = resume(t, mode, has);
    $("pvTitre").textContent = "Où va mon argent " + (mode === "an" ? "chaque année" : "chaque mois") + " ?";
    $("pvBudgetNote").textContent = scope() === "foyer" ? "Montants du foyer, " + MODES[mode].unite + "." : "Vue " + duScope() + " : ses lignes, et la moitié des lignes communes.";
    const hc = cartesHtml(r, u, { duScope: duScope() });
    if (hc !== sigCartes) { sigCartes = hc; ecrire($("pvCartes"), hc); }
    const hb = has ? barreHtml(barre(t), mode) : "";
    $("pvBarBloc").hidden = !has;
    if (hb !== sigBar) { sigBar = hb; $("pvBar").innerHTML = hb; }
    const hg = has ? groupesHtml(regrouper(draft, ctxCalc()).groupes, { mode, ouverts, two: two(), U: u }) : videHtml();
    if (hg !== sigBudget) { sigBudget = hg; ecrire($("pvBudget"), hg); }
    renderSaveBar();
    renderPanneau();
  }

  /* ---------- barre d'enregistrement (brouillon rempli par l'assistant) ---------- */
  function erreurs() {
    const out = [];
    draft.forEach((l, i) => { const e = validerLigne(l); if (e) out.push(plat(l.libelle) ? e : e.replace("Cette ligne", "Ligne " + (i + 1) + " (sans libellé)")); });
    return out;
  }
  function renderSaveBar() {
    const errs = showErrs ? erreurs() : [], out = [];
    errs.forEach(e => out.push(["err", e]));
    if (remoteChanged && dirty) out.push(["warn", "Le budget a été modifié ailleurs pendant votre saisie. Enregistrer remplacera cette version."]);
    if (msg) out.push(msg);
    if (!out.length && dirty) out.push(["", "Modifications non enregistrées."]);
    $("pvSave").hidden = !dirty && !msg;
    $("pvMsgs").innerHTML = out.map(([c, t]) => '<span class="' + c + '">' + esc(t) + "</span>").join("");
    $("pvSubmit").disabled = saving || !dirty || !(S && S.dbOk);
    $("pvCancel").hidden = !dirty;
  }

  function writeError(e) {
    const m = (e && e.message) || "";
    if (e && e.code === "invalid_argument" && /^Budget/.test(m)) return m;
    if (e && e.code === "invalid_argument") return "Enregistrement refusé : vous n'avez pas les droits d'écriture sur ce tableau de bord.";
    return "Enregistrement impossible pour le moment (" + ((e && e.code) || "erreur") + "). Votre saisie est conservée : réessayez dans un instant.";
  }

  /** Écrit tout le brouillon dans budget/main. depuisBarre : message de réussite dans la barre. → { ok } ou { erreur }. */
  async function saveBudget(depuisBarre) {
    const db = window.Store && window.Store.db;
    if (!db || !(S && S.dbOk)) return { erreur: "Lecture seule : le budget ne peut pas être modifié pour le moment." };
    const errs = erreurs();
    if (errs.length) { showErrs = true; renderSaveBar(); return { erreur: errs.join(" ") }; }
    const lignes = lignesAEnregistrer(draft, two());
    saving = true; msg = depuisBarre ? ["", "Enregistrement…"] : null; renderSaveBar();
    try {
      await db.doc("budget/main").set({ lignes });
      saving = false; dirty = false; remoteChanged = false; showErrs = false;
      draft = clone(lignes); remote = clone(lignes); baseSig = sig(lignes);
      msg = depuisBarre ? ["ok", "Budget enregistré. Le taux d'épargne et vos objectifs sont à jour."] : null;
      render();
      return { ok: true };
    } catch (e) {
      saving = false;
      const m = writeError(e);
      msg = depuisBarre ? ["err", m] : null;
      renderSaveBar();
      return { erreur: m };
    }
  }

  /* ---------- remplissage par assistant : le résultat va dans le brouillon, jamais directement en base ---------- */
  function mountAssistant() {
    const A = window.Assistant, dlg = $("pvAssist");
    if (!A || !dlg || !dlg.showModal) { $("pvAssistBtn").hidden = true; return; }
    let pending = null;
    const open = () => {
      if (U() && U().panneau.ouvert()) U().panneau.fermer({ focus: false });
      $("pvPrompt").value = A.prompt("budget"); $("pvPaste").value = ""; $("pvPreview").innerHTML = ""; $("pvApply").disabled = true; pending = null;
      dlg.showModal();
    };
    $("pvAssistBtn").addEventListener("click", open);
    root.addEventListener("click", e => { if (e.target.closest && e.target.closest("[data-pv-assist]")) open(); });
    $("pvCopy").addEventListener("click", async () => {
      const b = $("pvCopy");
      try { await navigator.clipboard.writeText($("pvPrompt").value); b.textContent = "Message copié"; }
      catch (e) { $("pvPrompt").select(); b.textContent = "Sélectionné : copiez avec Ctrl+C / ⌘C"; }
      setTimeout(() => { b.textContent = "Copier le message"; }, 2500);
    });
    const TL = { revenu: "Revenu", depense: "Dépense", epargne: "Épargne" };
    const freq = f => (f === "an" ? "/an" : "/mois");
    $("pvRead").addEventListener("click", () => {
      const r = A.parse($("pvPaste").value, "budget"), out = [];
      r.erreurs.forEach(e => out.push('<p class="err">' + esc(e) + "</p>"));
      r.avertissements.forEach(w => out.push('<p class="warn">' + esc(w) + "</p>"));
      pending = null;
      if (r.data && r.data.length && !r.erreurs.length) {
        const next = clone(draft), changes = [];
        r.data.forEach(d => {
          const key = String(d.libelle || "").trim().toLowerCase();
          const hit = next.find(l => String(l.libelle || "").trim().toLowerCase() === key);
          if (hit) {
            if (+hit.montant !== +d.montant || (hit.frequence || "mois") !== d.frequence) {
              changes.push("<tr><td>" + esc(hit.libelle) + '</td><td class="n">' + esc(eur(hit.montant) + freq(hit.frequence)) + '</td><td class="n">→ ' + esc(eur(d.montant) + freq(d.frequence)) + "</td></tr>");
              hit.montant = d.montant; hit.frequence = d.frequence;
            }
          } else {
            const l = { id: uid(), type: d.type, categorie: d.categorie || defCat(d.type), libelle: d.libelle, montant: d.montant, frequence: d.frequence };
            if (two()) l.owner = d.owner === "p1" || d.owner === "p2" ? d.owner : "commun";
            next.push(l);
            changes.push('<tr><td class="add">+ ' + esc(TL[d.type] + " · " + (l.categorie ? l.categorie + " · " : "") + d.libelle) + '</td><td></td><td class="n">' + esc(eur(d.montant) + freq(d.frequence)) + "</td></tr>");
          }
        });
        if (!changes.length) out.push("<p>La réponse ne change rien à votre budget.</p>");
        else {
          pending = next;
          out.push("<p><b>" + changes.length + " changement" + (changes.length > 1 ? "s" : "") + "</b> à appliquer :</p><div class=\"pv-scroll\"><table>" + changes.join("") + "</table></div>");
        }
      }
      $("pvPreview").innerHTML = out.join("");
      $("pvApply").disabled = !pending;
    });
    $("pvApply").addEventListener("click", () => {
      if (!pending) return;
      draft = pending; pending = null; dlg.close();
      dirty = true;
      msg = ["warn", "Réponse appliquée au budget. Vérifiez, puis cliquez sur « Enregistrer le budget »."];
      render();
    });
  }

  /* ---------- panneau ---------- */
  const TITRES_RESUME = { revenu: "Revenus", depense: "Dépenses", epargne: "Épargne", reste: "Reste" };
  const QUESTIONS_RESUME = {
    revenu: "Mes revenus dans Boussole sont-ils complets ? Aide-moi à vérifier ce qui manque.",
    depense: "Analyse mes dépenses par catégorie dans Boussole : où puis-je économiser sans me priver ?",
    epargne: "Mon taux d'épargne dans Boussole est-il suffisant, et comment l'améliorer ?",
    reste: "Que faire du reste de mon budget chaque mois dans Boussole : épargne de précaution, objectifs, placements ?",
  };
  function contenuPanneau() {
    const u = U();
    if (pan.kind === "resume") {
      const { groupes, totaux: t } = regrouper(draft, ctxCalc());
      return resumeDetailHtml(pan.id, groupes, resume(t, mode, draft.length > 0));
    }
    if (pan.edition) return ligneFormHtml(pan.edition, { two: two(), people: people(), nouvelle: pan.kind === "nouvelle", erreur: pan.message && !pan.message.ok ? pan.message.texte : null,
      enAttente: dirty, busy: pan.busy, U: u });
    const l = ligne(pan.id);
    return ligneDetailHtml(l, { scope: scope(), people: people(), Calc: C(), Plan: P(), dbOk: !!(S && S.dbOk), confirmer: pan.confirmer, message: pan.message, busy: pan.busy });
  }
  function optionsPanneau(h) {
    const u = U();
    let titre = "Nouvelle ligne", pied = null, lien = null;
    if (pan.kind === "resume") {
      titre = TITRES_RESUME[pan.id] || "Budget";
      pied = u.demanderAClaude(QUESTIONS_RESUME[pan.id] || QUESTIONS_RESUME.depense);
      if (pan.id === "revenu") lien = { label: "Modifier mes revenus dans Compte › Données", href: "#compte/donnees" };
    } else if (pan.kind === "ligne") {
      const l = ligne(pan.id);
      titre = plat(l && l.libelle) || "Ligne sans libellé";
      if (l) pied = u.demanderAClaude("Dans mon budget Boussole, la ligne « " + titre + " » (" + eur(+l.montant) + (l.frequence === "an" ? " par an" : " par mois") + ") est-elle cohérente, et comment la réduire si besoin ?");
    }
    return { titre, contenu: h, retour: pan.retour, pied, lien, surFermeture: fermeture };
  }
  /* Fermeture : focus rendu à l'élément d'origine ; s'il a été redessiné, à la ligne (ou carte) du même id, sinon au titre. */
  function fermeture(o) {
    const p = pan;
    pan = null; sigPanneau = "";
    if ((o && o.focus === false) || !root || !p) return;
    if (p.retour && p.retour.isConnected) return;
    const sel = p.kind === "resume" ? '[data-ui-carte="' + echap(p.id) + '"]' : p.kind === "ligne" ? '[data-pv-ligne="' + echap(p.id) + '"]' : null;
    const el = sel && root.querySelector(sel);
    if (el) { el.focus(); return; }
    const a = $("pvAjouter"); if (a) a.focus();
  }
  function ouvrir(p) {
    const u = U();
    if (!u) return;
    pan = Object.assign({ edition: null, confirmer: false, message: null, busy: false }, p);
    const h = contenuPanneau();
    sigPanneau = h;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(h));
    brancherPanneau(corpsPanneau);
    brancherBascules();
  }
  /* Rafraîchit le panneau ouvert (action, émission du store) ; pendant une saisie, seulement sur demande (force). cible : sélecteur simple à focaliser. */
  function renderPanneau(cible, force) {
    const u = U();
    if (!pan || !u || !u.panneau.ouvert()) return;
    if (pan.busy && !force) return; // écriture en cours : l'issue rafraîchit le panneau
    if (pan.kind === "ligne" && !ligne(pan.id)) { u.panneau.fermer({ focus: false }); return; }
    if (pan.edition && !force && !cible) return;
    const h = contenuPanneau();
    if (h === sigPanneau && !cible && !force) return;
    sigPanneau = h;
    const y = corpsPanneau ? corpsPanneau.scrollTop : 0;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(h));
    corpsPanneau.scrollTop = y;
    brancherBascules();
    const f = cible && corpsPanneau.querySelector(cible);
    if (f) f.focus();
  }
  function brancherBascules() {
    const u = U(), ed = pan && pan.edition;
    if (!u || !ed || !corpsPanneau) return;
    const b = cle => corpsPanneau.querySelector('[data-pv-bascule="' + cle + '"]');
    if (b("type")) u.bascule(b("type"), { label: "Type", options: TYPES, actif: ed.type, surChange: id => {
      if (!pan || !pan.edition) return;
      const e = pan.edition;
      if (!plat(e.categorie) || e.categorie === defCat(e.type)) {
        e.categorie = defCat(id);
        const c = corpsPanneau.querySelector("#pvf-categorie"); if (c) c.value = e.categorie;
      }
      e.type = id;
    } });
    if (b("frequence")) u.bascule(b("frequence"), { label: "Fréquence", options: FREQUENCES, actif: ed.frequence === "an" ? "an" : "mois", surChange: id => { if (pan && pan.edition) pan.edition.frequence = id; } });
    if (b("owner")) u.bascule(b("owner"), { label: "Titulaire", options: [{ id: "commun", label: "Commun" }, { id: "p1", label: nomDe("p1", people()) }, { id: "p2", label: nomDe("p2", people()) }],
      actif: ed.owner || "commun", surChange: id => { if (pan && pan.edition) pan.edition.owner = id; } });
  }
  const branches = new WeakSet();
  function brancherPanneau(corps) {
    if (!corps || branches.has(corps)) return;
    branches.add(corps);
    corps.addEventListener("click", e => {
      const b = e.target && e.target.closest ? e.target.closest("[data-pv-act]") : null;
      if (!b || !pan || !corps.contains(b) || b.disabled || pan.busy) return;
      agir(b.getAttribute("data-pv-act"));
    });
    /* Brouillon du formulaire conservé à chaque saisie : un rafraîchissement ne perd pas la saisie. */
    const saisir = e => { const f = e.target && e.target.closest ? e.target.closest("[data-pv-champ]") : null; if (f && pan && pan.edition) pan.edition[f.getAttribute("data-pv-champ")] = f.value; };
    corps.addEventListener("input", saisir);
    corps.addEventListener("change", saisir);
    corps.addEventListener("keydown", e => {
      if (e.key === "Enter" && pan && pan.edition && e.target && e.target.localName === "input" && e.target.closest && e.target.closest("[data-pv-form]")) { e.preventDefault(); agir("enregistrer"); }
    });
  }

  function edition(l) {
    return { type: l.type || "depense", categorie: l.categorie || "", libelle: l.libelle || "", montant: l.montant == null ? "" : String(l.montant), frequence: l.frequence === "an" ? "an" : "mois", owner: l.owner || (two() ? "commun" : null) };
  }
  async function agir(act) {
    if (!pan) return;
    if (act === "modifier") { const l = ligne(pan.id); if (!l) return; pan.edition = edition(l); pan.message = null; pan.confirmer = false; renderPanneau("#pvf-montant", true); }
    else if (act === "annuler") {
      if (pan.kind === "nouvelle") { U().panneau.fermer(); return; }
      pan.edition = null; pan.message = null; renderPanneau('[data-pv-act="modifier"]', true);
    }
    else if (act === "supprimer") { pan.confirmer = true; pan.message = null; renderPanneau('[data-pv-act="supprimer-non"]', true); }
    else if (act === "supprimer-non") { pan.confirmer = false; renderPanneau('[data-pv-act="supprimer"]', true); }
    else if (act === "supprimer-oui") await supprimer();
    else if (act === "enregistrer") await enregistrer();
  }

  async function enregistrer() {
    const ed = pan.edition, nouvelle = pan.kind === "nouvelle";
    if (!ed) return;
    const montant = ed.montant === "" || ed.montant == null ? null : +ed.montant;
    const l = Object.assign(nouvelle ? {} : clone(ligne(pan.id) || {}), { id: nouvelle ? uid() : pan.id, type: ed.type, categorie: plat(ed.categorie) || defCat(ed.type),
      libelle: plat(ed.libelle), montant, frequence: ed.frequence === "an" ? "an" : "mois" });
    if (two()) l.owner = ed.owner || "commun"; else delete l.owner;
    const err = validerLigne(l);
    if (err) { pan.message = { texte: err }; renderPanneau("[data-pv-msg]", true); return; }
    const avant = clone(draft), avantDirty = dirty;
    if (nouvelle) draft.push(l); else draft = draft.map(x => (String(x.id) === String(l.id) ? l : x));
    dirty = true; msg = null;
    pan.busy = true; pan.message = null; renderPanneau(null, true);
    const r = await saveBudget(false);
    if (!pan) return;
    pan.busy = false;
    if (r.ok) {
      Object.assign(pan, { kind: "ligne", id: l.id, edition: null, confirmer: false, message: { texte: nouvelle ? "Ligne ajoutée au budget." : "Ligne enregistrée.", ok: true } });
      if (nouvelle) { ouverts.add(l.type + ":" + (plat(l.categorie) || defCat(l.type))); render(); }
      renderPanneau("[data-pv-msg]", true);
    } else {
      draft = avant; dirty = avantDirty;
      pan.message = { texte: r.erreur };
      render();
      renderPanneau("[data-pv-msg]", true);
    }
  }

  async function supprimer() {
    const l = ligne(pan.id);
    if (!l) return;
    const avant = clone(draft), avantDirty = dirty, cat = l.type + ":" + (plat(l.categorie) || (l.type === "depense" ? "Autres" : defCat(l.type)));
    draft = draft.filter(x => String(x.id) !== String(l.id));
    dirty = true; msg = null;
    pan.busy = true; renderPanneau(null, true);
    const r = await saveBudget(false);
    if (!r.ok) {
      draft = avant; dirty = avantDirty; render();
      if (pan) { pan.busy = false; pan.confirmer = false; pan.message = { texte: r.erreur }; renderPanneau("[data-pv-msg]", true); }
      else dire(r.erreur);
      return;
    }
    if (pan) { pan = null; U().panneau.fermer({ focus: false }); }
    dire("Ligne « " + (plat(l.libelle) || "sans libellé") + " » supprimée du budget.", true);
    render();
    const det = root.querySelector('[data-pv-cat="' + echap(cat) + '"]');
    const f = (det && det.querySelector("summary")) || $("pvAjouter");
    if (f) f.focus();
  }

  function ouvrirNouvelle(type, categorie, el) {
    dire("");
    const t = TYPE_LABEL[type] ? type : "depense";
    ouvrir({ kind: "nouvelle", id: null, retour: el, edition: { type: t, categorie: categorie || defCat(t), libelle: "", montant: "", frequence: "mois", owner: two() ? "commun" : null } });
    const f = corpsPanneau && corpsPanneau.querySelector(categorie ? "#pvf-libelle" : "#pvf-categorie");
    if (f) f.focus();
  }

  function mount(r) {
    root = r;
    $("pvTitre").setAttribute("tabindex", "-1");
    const u = U();
    if (u) {
      ctlMode = u.bascule($("pvMode"), { label: "Montants", options: [{ id: "mois", label: "Par mois" }, { id: "an", label: "Par an" }], actif: mode,
        surChange: id => { mode = id === "an" ? "an" : "mois"; render(); } });
      $("pvClaude").innerHTML = u.demanderAClaude("Analyse mon budget dans Boussole : où va mon argent chaque mois, et où puis-je dégager de l'épargne ?");
      u.brancher($("pvCartes"), { surCarte: (id, el) => { dire(""); ouvrir({ kind: "resume", id, retour: el }); } });
      u.brancher($("pvBudget"));
    }
    root.addEventListener("click", e => {
      const t = e.target;
      if (!t || !t.closest) return;
      let b;
      if ((b = t.closest("[data-pv-ligne]")) && root.contains(b)) { dire(""); ouvrir({ kind: "ligne", id: b.getAttribute("data-pv-ligne"), retour: b }); return; }
      if ((b = t.closest("[data-pv-ajout]")) && root.contains(b)) { ouvrirNouvelle(b.getAttribute("data-pv-ajout"), b.getAttribute("data-pv-ajout-cat") || "", b); return; }
      if ((b = t.closest("#pvAjouter"))) { ouvrirNouvelle("depense", "", b); return; }
    });
    /* Catégorie dépliée ou repliée : retenue pour le prochain redessin (toggle ne remonte pas : écoute en capture). */
    root.addEventListener("toggle", e => {
      const d = e.target;
      if (!d || !d.getAttribute || !d.hasAttribute("data-pv-cat")) return;
      const cle = d.getAttribute("data-pv-cat");
      if (d.hasAttribute("open")) ouverts.add(cle); else ouverts.delete(cle);
    }, true);
    $("pvCancel").addEventListener("click", () => {
      draft = clone(remote); baseSig = sig(remote); dirty = false; remoteChanged = false; showErrs = false; msg = null; render();
    });
    $("pvSubmit").addEventListener("click", () => saveBudget(true));
    mountAssistant();
  }

  function update(snap, visible) {
    S = snap;
    if (snap.ready || snap.dbOk === false) {
      const lignes = snap.budget && Array.isArray(snap.budget.lignes) ? snap.budget.lignes : [];
      remote = clone(lignes);
      const s = sig(lignes);
      if (s !== baseSig) {
        if (dirty && baseSig != null) remoteChanged = true;
        else { draft = clone(lignes); baseSig = s; }
      }
    }
    aRendre = true;
    if (visible) { render(); aRendre = false; }
  }
  function show() { if (aRendre) { render(); aRendre = false; } }
  function headline() {
    if (!S || !(S.ready || S.dbOk === false)) return "–";
    const lignes = S.budget && Array.isArray(S.budget.lignes) ? S.budget.lignes : [];
    if (!lignes.length) return "Budget à remplir";
    const t = window.Plan.budgetTotaux(lignes, S.profil, S.scope).tauxEpargne;
    return t == null ? "Budget à remplir" : Math.round(t * 100) + " % épargnés";
  }

  const api = { mount, update, show, headline };
  const reg = () => App.register("plan", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
