/* Patrimoine › Budget (module « plan ») : « Où va mon argent chaque mois ? ». Lecture seule : la saisie passe par Claude
   (spec docs/superpowers/specs/2026-10-11-saisie-par-agent.md) ; ce module n'écrit jamais dans le store.
   - En-tête : revenus, dépenses, épargne, reste en cartes (UI.carte → panneau de détail), bascule Par mois · Par an
     (UI.bascule ; montants ×12 par an, la capacité d'épargne ne change pas), « Compléter avec Claude », « Demander à Claude ».
   - Barre empilée des dépenses par catégorie (8 couleurs distinctes au plus, le reste regroupé en « Autres catégories » à
     motif) ; légende en 5 puis « Voir plus ».
   - Une carte par catégorie (montant, part du total du type) qui se déplie en lignes (<details>, état ouvert conservé au
     redessin) ; 5 catégories puis « Voir plus » ; « Compléter avec Claude » contextuel. Lignes reprises de Compte › Données
     (salaires, loyers, prêts) en lecture seule, avec « Corriger avec Claude ».
   - Une ligne ouvre un panneau (UI.panneau) : détail chiffré et « Corriger avec Claude » pour cette ligne.
   Totaux des sections et des cartes : Plan.budgetTotaux (une seule source). Les objectifs et la projection vivent dans
   Patrimoine › Objectifs (objectifs-view.js). Calculs : plan.js (Plan) et calc.js (Calc).
   - Banques connectées (BQ1) : à côté du prévu, chaque catégorie affiche son « réel » (moyenne des 3 derniers mois complets de
     S.banque.mois, BanqueEtat.reelMoyen), et les dépenses réelles d'une catégorie absente du budget sont listées sous les dépenses.
     Seulement pour le foyer (les comptes ne sont pas répartis par personne) et quand l'interrupteur banque est actif.
   - Budget réel sur les comptes courants (spec cp1 § 5) : si S.banque.mois est détaillé par compte (compteId), seules les lignes
     des comptes courants suivis comptent (Calc.moisCourants : type courant, ni ignorés ni en double) ; sinon les totaux tels quels.
     Lignes « Capacité d'épargne » ((revenus − dépenses) ÷ revenus) et « Épargne versée » (épargne et investissement ÷ revenus) dans la
     section Épargne (Calc.budgetReel : tauxCapacite puis tauxEpargne, 3 derniers mois complets) et
     mention « Virements entre tes comptes exclus » à côté de la note du réel.
   Fonctions pures exportées pour les tests : lignesProfil, regrouper, resume, barre, segments, cartesHtml, barreHtml,
   groupesHtml, ligneDetailHtml, resumeDetailHtml, boutonClaude, reelDe, noteReel, budgetReelDe, tauxReelHtml. Dépendances injectées
   (ctx) : { Plan, Calc } ; window.* par défaut (ClaudePrompts compris). */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) && d[k] ? d[k] : glob(k));
  /* Phrases « Compléter avec Claude » : global du navigateur, sinon le module voisin sous Node (tests). */
  const prompts = () => glob("ClaudePrompts") ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./claude-prompts.js") : null);

  /* Banques connectées (banque-etat.js) : absent → pas de colonne « réel ». */
  const BE = () => glob("BanqueEtat") ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./banque-etat.js") : null);
  /* Calculs (calc.js) : comptes courants et budget réel. */
  const CA = () => glob("Calc") ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./calc.js") : null);

  /* ---------- formats ---------- */
  /* Formats uniques (format.js, UX1) ; global du navigateur, sinon le module voisin sous Node. */
  const FM = () => (typeof globalThis !== "undefined" && globalThis.Fmt) || (typeof module === "object" && module.exports && typeof require === "function" ? require("./format.js") : null);
  const eur = v => (v == null || !isFinite(v) ? "—" : FM().fmtEUR(v));
  const pct = v => (v == null || !isFinite(v) ? "—" : FM().fmtPct(v * 100, { decimales: 0 }));
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();

  /* ---------- vocabulaire ---------- */
  const TYPE_LABEL = { depense: "Dépense", revenu: "Revenu", epargne: "Épargne" };
  const MODES = {
    mois: { facteur: 1, suffixe: "/mois", unite: "par mois", label: "Par mois" },
    an: { facteur: 12, suffixe: "/an", unite: "par an", label: "Par an" },
  };
  const CAT_ORDER = ["Logement", "Alimentation", "Transport", "Enfants", "Santé", "Loisirs", "Abonnements", "Impôts", "Divers", "Autres"];
  const defCat = t => (t === "epargne" ? "Épargne" : t === "revenu" ? "Revenus" : "");
  const REPERES_TAUX = { bon: "au-dessus du repère", attention: "sous le repère", critique: "très bas" };
  const SANS_TAUX = "remplis ton budget avec Claude pour le calculer";
  /* Palette de la barre : 8 couleurs de série distinctes (le gris --s8 est réservé au regroupement « Autres catégories »). */
  const PALETTE = [1, 2, 3, 4, 5, 6, 7, 9].map(i => "var(--s" + i + ")");
  const COULEUR_AUTRES = "var(--s8)";
  const CHEVRON = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';

  /* ---------- personnes ---------- */
  const nomDe = (k, people) => { const p = (people || []).find(x => x && x.id === k); return (p && p.nom) || (k === "p2" ? "Conjoint(e)" : "Moi"); };
  const partDe = (l, scope, Calc) => Calc.partCredit(scope || "foyer", l && (l.owner === "p1" || l.owner === "p2") ? l.owner : "commun");
  const mode0 = m => MODES[m] || MODES.mois;

  /** Bouton « Compléter avec Claude » (ou libellé contextuel) : ouvre Claude avec la phrase prête de la section. */
  function boutonClaude(U, section, contexte, libelle) {
    const u = U || glob("UI"), CP = prompts();
    if (!u || typeof u.demanderAClaude !== "function") return "";
    const q = CP ? CP.phrase(section, contexte) : "Boussole : aide-moi à compléter mon budget." + (contexte ? " Concerne : " + contexte + "." : "");
    return u.demanderAClaude(q, libelle || "Compléter avec Claude");
  }

  /* =============================================================== calculs de présentation =============================================================== */
  /** Lignes reprises de Compte › Données (lecture seule) pour le périmètre : { rev: [[libellé, mensuel]], dep: [[libellé, mensuel]] }.
      Mêmes personnes que Plan.budgetTotaux (le foyer compte p1 et p2) : une seconde personne n'apparaît que si elle a des revenus. */
  function lignesProfil(profil, scope, people, Calc) {
    const pr = profil || {}, ps = pr.personnes || {}, sc = scope || "foyer";
    const who = sc === "foyer" ? ["p1", "p2"] : [sc];
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

  /** Résumé de l'en-tête dans le mode choisi (« mois » ×1, « an » ×12). aLignes : le budget a au moins une ligne (sinon reste
      et capacité d'épargne inconnus : les seuls revenus de Compte › Données donneraient un taux trompeur : tout le reste compté comme épargne).
      → { mode, facteur, suffixe, unite, aLignes, revenus, revenusProfil, depenses, mensualites, epargne, reste, taux, ton, repere, negatif }. */
  function resume(t, mode, aLignes) {
    const m = mode0(mode), f = m.facteur, x = v => (+v || 0) * f, tt = t || {};
    const taux = aLignes && t && t.tauxEpargne != null && isFinite(t.tauxEpargne) ? t.tauxEpargne : null;
    const ton = taux == null ? null : taux >= 0.15 ? "bon" : taux >= 0.05 ? "attention" : "critique";
    return {
      mode: mode === "an" ? "an" : "mois", facteur: f, suffixe: m.suffixe, unite: m.unite, aLignes: !!aLignes,
      revenus: x(tt.revenus), revenusProfil: x(tt.revenusProfil), depenses: x(tt.depenses), mensualites: x(tt.mensualites), epargne: x(tt.epargne),
      reste: aLignes ? x(tt.reste) : null, taux, ton, repere: ton ? REPERES_TAUX[ton] : null, negatif: !!aLignes && tt.reste < 0,
    };
  }

  /** Dépenses par catégorie (crédits compris) : [{ categorie, mensuel, part }], montant décroissant. */
  function barre(t) {
    const cats = Object.entries((t && t.parCategorie) || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const tot = cats.reduce((a, [, v]) => a + v, 0);
    return tot > 0 ? cats.map(([categorie, mensuel]) => ({ categorie, mensuel, part: mensuel / tot })) : [];
  }

  /** Segments de la barre : une couleur distincte par catégorie (8 au plus) ; au-delà, les plus petites sont regroupées en
      « Autres catégories » (gris à motif, détail listé). → [{ categorie, mensuel, part, couleur, motif?, detail? }]. */
  function segments(cats) {
    const xs = cats || [];
    if (xs.length <= PALETTE.length) return xs.map((c, i) => Object.assign({}, c, { couleur: PALETTE[i] }));
    const tete = xs.slice(0, PALETTE.length - 1), reste = xs.slice(PALETTE.length - 1);
    return tete.map((c, i) => Object.assign({}, c, { couleur: PALETTE[i] })).concat([{
      categorie: "Autres catégories", mensuel: reste.reduce((a, c) => a + c.mensuel, 0), part: reste.reduce((a, c) => a + c.part, 0),
      couleur: COULEUR_AUTRES, motif: true, detail: reste.map(c => c.categorie),
    }]);
  }

  /* =============================================================== rendus HTML =============================================================== */
  /* Une capacité d'épargne = (revenus − dépenses) ÷ revenus, mais deux mesures sur cet écran : celle du budget (prévue) et celle des comptes
     (réelle). Chacune porte son qualificatif, jamais deux nombres différents sous le même nom. */
  const LIBELLE_PREVUE = "Capacité d'épargne prévue au budget";
  const libelleReelle = n => "Capacité d'épargne réelle, " + (n > 1 ? n + " derniers mois" : "dernier mois");
  /** Quatre cartes de l'en-tête (UI.carte) : revenus, dépenses, épargne (capacité d'épargne en badge), reste. o = { duScope }. */
  function cartesHtml(r, U, o) {
    const u = r.unite;
    const sous = (...xs) => xs.filter(Boolean).join(" · ");
    const sousTaux = r.taux != null ? LIBELLE_PREVUE + " " + pct(r.taux) : !r.aLignes ? SANS_TAUX : "capacité d'épargne inconnue";
    return U.carte({ id: "revenu", titre: "Revenus " + ((o && o.duScope) || "du foyer"), valeur: eur(r.revenus),
        sous: sous(u, r.revenusProfil > 0 ? "dont " + eur(r.revenusProfil) + " repris de Compte › Données" : "salaires à compléter avec Claude") }) +
      U.carte({ id: "depense", titre: "Dépenses", valeur: eur(r.depenses), sous: sous(u, r.mensualites > 0 ? "dont " + eur(r.mensualites) + " de crédits" : "crédits compris") }) +
      U.carte({ id: "epargne", titre: "Épargne", valeur: eur(r.epargne), sous: sous(u, sousTaux), badge: r.ton ? { texte: r.repere, ton: r.ton } : null }) +
      U.carte({ id: "reste", titre: "Reste", valeur: r.reste == null ? "—" : eur(r.reste),
        sous: r.reste == null ? "une fois le budget rempli" : r.negatif ? sous(u, "le budget dépense plus qu'il ne reçoit") : sous(u, "après dépenses et épargne"),
        badge: r.negatif ? { texte: "Négatif", ton: "critique" } : null });
  }

  /** Barre empilée (role="img", libellé lu avec toutes les catégories) et légende en 5 puis « Voir plus » ; couleurs de la série
      du thème, sans répétition (segments). */
  function barreHtml(cats, mode, U) {
    if (!cats || !cats.length) return '<p class="pv-muet">Aucune dépense dans ton budget.</p>';
    const m = mode0(mode), f = m.facteur, u = U || glob("UI"), segs = segments(cats);
    const sw = s => '<span class="pv-sw' + (s.motif ? " pv-motif" : "") + '" style="background-color:' + s.couleur + '"></span>';
    const li = s => '<li>' + sw(s) + esc(s.categorie) + ' <b>' + esc(eur(s.mensuel * f)) + '</b> <span class="pv-muet">' + esc(pct(s.part)) + "</span>" +
      (s.detail ? ' <span class="pv-leg-det">(' + esc(s.detail.join(", ")) + ")</span>" : "") + "</li>";
    const legende = u && typeof u.voirPlus === "function" ? u.voirPlus(segs, 5, li, "Voir plus de catégories", "ul", "pv-leg")
      : '<ul class="ui-voirplus-liste">' + segs.map(li).join("") + "</ul>";
    return '<div class="pv-stack" role="img" aria-label="' + esc(cats.map(c => c.categorie + " " + pct(c.part)).join(", ")) + '">' +
      segs.map(s => '<span' + (s.motif ? ' class="pv-motif"' : "") + ' style="width:' + (s.part * 100).toFixed(2) + "%;background-color:" + s.couleur + '" title="' +
        esc(s.categorie + " : " + eur(s.mensuel * f) + m.suffixe) + '"></span>').join("") + "</div>" +
      '<div class="pv-leg">' + legende + "</div>";
  }

  const roRow = (r, m) => '<li><span>' + esc(r.libelle) + ' <span class="pv-tag" title="Repris de Compte › Données">réel</span></span><span class="pv-num">' +
    esc(eur(r.mensuel * m.facteur) + m.suffixe) + "</span></li>";
  const lienProfil = '<a class="pv-link" href="#compte/donnees" data-goto="compte/donnees">Voir dans Compte › Données</a>';

  function ligneHtml(x, m) {
    const l = x.ligne, notes = [];
    if (l.frequence === "an" && m.facteur === 1) notes.push("saisi : " + eur(+l.montant) + "/an");
    if (l.frequence !== "an" && m.facteur === 12) notes.push("saisi : " + eur(+l.montant) + "/mois");
    if (x.part === 0) notes.push("hors de cette vue");
    else if (x.part > 0 && x.part < 1) notes.push("ligne commune, comptée pour moitié");
    return '<li><button type="button" class="pv-ligne" data-pv-ligne="' + esc(x.id) + '" aria-haspopup="dialog">' +
      '<span class="pv-ligne-lib">' + esc(x.libelle) + '</span><span class="pv-ligne-mt pv-num">' + esc(eur(x.mensuel * m.facteur) + m.suffixe) + "</span>" +
      (notes.length ? '<span class="pv-ligne-note">' + esc(notes.join(" · ")) + "</span>" : "") + "</button></li>";
  }

  /* ---------- réel (banques connectées) ---------- */
  /** Réel moyen des 3 derniers mois complets (BanqueEtat.reelMoyen sur S.banque.mois) → { n, du, au, parCategorie } ou null
      (interrupteur éteint, vue d'une personne, aucun mois complet). */
  function reelDe(S, today) {
    const B = BE(), C = CA(), b = S && S.banque;
    if (!B || !b || !b.actif || (S.scope || "foyer") !== "foyer") return null;
    return B.reelMoyen(C && typeof C.moisCourants === "function" ? C.moisCourants(b) : b.mois, today);
  }
  /** Budget réel des comptes courants (Calc.budgetReel) → { n, du, au, revenus, depenses, epargne, tauxEpargne, capacite, tauxCapacite, parCompte } ou null
      (interrupteur éteint, vue d'une personne, aucun mois complet). */
  function budgetReelDe(S, today) {
    const C = CA(), b = S && S.banque, h = S && S.relevesBancaires;
    // HIS2 : la série fusionnée (banque connectée et relevés importés) ; des relevés importés suffisent, même sans banque connectée
    if (!C || typeof C.budgetReel !== "function" || (S.scope || "foyer") !== "foyer") return null;
    if (!(b && b.actif) && !(h && Array.isArray(h.releves) && h.releves.length)) return null;
    return C.budgetReel(b && b.actif ? b : null, today, undefined, h);
  }
  const MOIS_NOMS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const moisNom = (iso, an) => MOIS_NOMS[+iso.slice(5, 7) - 1] + (an ? " " + iso.slice(0, 4) : "");
  /** Période couverte : « septembre 2026 » ou « moyenne de juillet à septembre 2026 ». */
  function periodeReel(r) {
    if (r.du === r.au) return moisNom(r.du, true);
    const de = /^[aeiouyéè]/.test(moisNom(r.du)) ? "d'" : "de ";
    return "moyenne " + de + moisNom(r.du, r.du.slice(0, 4) !== r.au.slice(0, 4)) + " à " + moisNom(r.au, true);
  }
  /** Phrase d'explication de la colonne « réel » (période couverte). */
  function noteReel(r) {
    if (!r || !r.du || !r.au) return "";
    return "« Réel » : " + periodeReel(r) + ", d'après tes comptes connectés.";
  }
  const MENTION_VIREMENTS = "Virements entre tes comptes exclus.";
  /** Deux lignes sous la section Épargne, chacune avec sa formule d'une ligne (même vocabulaire que Santé et le connecteur) :
      « Capacité d'épargne réelle, N derniers mois » = (revenus − dépenses) ÷ revenus (br.tauxCapacite, peut être négative) puis « Épargne versée » =
      versements d'épargne et d'investissement ÷ revenus (br.tauxEpargne) ; 3 derniers mois complets, « sur tes comptes courants » si
      chaque mois est détaillé par compte (br.parCompte), sinon « sur tous tes comptes connectés » ; vide sans taux. */
  function tauxReelHtml(br) {
    if (!br || br.tauxEpargne == null || !isFinite(br.tauxEpargne) || br.tauxCapacite == null || !isFinite(br.tauxCapacite) || !br.du || !br.au) return "";
    const ligne = (titre, v, formule) => '<p class="pv-reel-taux"><span class="pv-reel-taux-l">' + titre + '</span> <b class="pv-num">' + esc(pct(v)) + "</b> " +
      '<span class="pv-muet">' + formule + "</span></p>";
    return ligne(libelleReelle(br.n), br.tauxCapacite, "(revenus − dépenses) ÷ revenus.") + "\n" +
      ligne("Épargne versée", br.tauxEpargne, "versements d'épargne et d'investissement ÷ revenus.") +
      '\n<p class="pv-reel-taux"><span class="pv-muet">' + esc(periodeReel(br)) + (br.parCompte ? ", sur tes comptes courants. " : ", sur tous tes comptes connectés (le détail par compte n'est pas encore disponible). ") +
      (br.moisImportes ? "Dont " + br.moisImportes + " mois tirés de relevés que tu as déposés dans la conversation. " : "") + MENTION_VIREMENTS + "</span></p>";
  }
  /** Réel mensuel d'un groupe du budget (catégorie reconnue et de même sens), ou null. */
  function reelGroupe(g, reel) {
    const B = BE();
    if (!reel || !B) return null;
    const cle = B.categoriePourTitre(g.titre), cat = B.CATEGORIES.find(c => c.cle === cle);
    return cat && cat.sens === g.type ? +(reel.parCategorie[cle] || 0) : null;
  }

  const NOM_TYPE = { revenu: "revenus", depense: "dépenses", epargne: "épargne" };
  /** Une catégorie : carte dépliable (<details>) avec montant et part (lue aussi sur mobile, ui-sr) ; lignes reprises de
      Compte › Données (« Corriger avec Claude »), lignes du budget (boutons qui ouvrent le panneau), « Compléter avec Claude ». */
  function groupeHtml(g, m, ouverts, U, reel) {
    const ouvert = ouverts && ouverts.has(g.cle), rv = reelGroupe(g, reel);
    const reelHtml = rv == null ? "" : '<span class="pv-cat-reel" aria-hidden="true"><span class="pv-reel-l">réel</span> ' + esc(eur(rv * m.facteur) + m.suffixe) + "</span>" +
      '<span class="ui-sr">, réel moyen sur ' + reel.n + " mois : " + esc(eur(rv * m.facteur) + m.suffixe) + "</span>";
    const seulProfil = !g.lignes.length && g.profil.length;
    const secProfil = g.type === "revenu" ? "revenus" : "immobilier";
    return '<details class="ui-acc pv-cat" data-pv-cat="' + esc(g.cle) + '"' + (ouvert ? " open" : "") + ">" +
      '<summary class="ui-acc-titre pv-cat-t"><span class="pv-cat-nom">' + esc(g.titre) + '</span><span class="pv-cat-v">' +
      '<b class="pv-num">' + esc(eur(g.mensuel * m.facteur) + m.suffixe) + '</b><span class="pv-cat-part" aria-hidden="true">' + esc(pct(g.part)) + "</span>" +
      '<span class="ui-sr">, soit ' + esc(pct(g.part)) + " des " + esc(NOM_TYPE[g.type] || "montants") + "</span>" + reelHtml + "</span>" +
      '<span class="ui-acc-chevron">' + CHEVRON + "</span></summary>" +
      '<div class="ui-acc-corps pv-cat-corps">' +
      (g.profil.length ? '<div class="pv-ros"><p class="pv-ros-t">Repris de Compte › Données</p><ul class="pv-ro">' + g.profil.map(r => roRow(r, m)).join("") + "</ul>" +
        '<div class="pv-ros-act">' + lienProfil + boutonClaude(U, secProfil, g.type === "revenu" ? "mes salaires et loyers" : "mes prêts et crédits", "Corriger avec Claude") + "</div></div>" : "") +
      (g.lignes.length ? '<ul class="pv-lignes">' + g.lignes.map(x => ligneHtml(x, m)).join("") + "</ul>" : "") +
      (seulProfil ? "" : '<div class="pv-cat-act">' + boutonClaude(U, "budget", "la catégorie « " + g.titre + " » (" + (NOM_TYPE[g.type] || g.type) + ")", "Compléter avec Claude") + "</div>") +
      "</div></details>";
  }

  const SECTIONS = [
    { type: "revenu", titre: "Revenus", vide: "Aucun revenu connu." },
    { type: "depense", titre: "Dépenses", vide: "Aucune dépense dans ton budget." },
    { type: "epargne", titre: "Épargne", vide: "Aucune épargne prévue dans ton budget." },
  ];
  const TOTAL_DE = { revenu: "revenus", depense: "depenses", epargne: "epargne" };
  /** Dépenses réelles des catégories absentes du budget (« Dans tes comptes, hors budget : … »). */
  function horsBudgetHtml(gs, reel, m) {
    const B = BE();
    if (!reel || !B) return "";
    const vues = new Set(gs.map(g => B.categoriePourTitre(g.titre)).filter(Boolean));
    const hors = B.CATEGORIES.filter(c => c.sens === "depense" && !vues.has(c.cle) && (reel.parCategorie[c.cle] || 0) >= 1)
      .sort((a, b) => reel.parCategorie[b.cle] - reel.parCategorie[a.cle]);
    if (!hors.length) return "";
    return '<p class="pv-reel-hors">Dans tes comptes, hors budget : ' + hors.map(c => esc(c.libelle) + " (réel " + esc(eur(reel.parCategorie[c.cle] * m.facteur) + m.suffixe) + ")").join(", ") +
      ". " + boutonClaude(glob("UI"), "budget", "les dépenses réelles hors budget (" + hors.map(c => c.libelle).join(", ") + ")", "Ajouter avec Claude") + "</p>";
  }
  /** Les trois sections (Revenus, Dépenses, Épargne) et leurs catégories ; total de section = totaux de Plan.budgetTotaux
      (le même que les cartes). o = { mode, ouverts: Set de clés, totaux, U, reel (reelDe, facultatif), budgetReel (budgetReelDe,
      facultatif : lignes « Capacité d'épargne » et « Épargne versée » en fin de section Épargne) }. */
  function groupesHtml(groupes, o) {
    const opt = o || {}, m = mode0(opt.mode), U = opt.U || glob("UI"), reel = opt.reel || null;
    return SECTIONS.map(s => {
      const gs = (groupes && groupes[s.type]) || [];
      const tv = opt.totaux && opt.totaux[TOTAL_DE[s.type]];
      const total = tv != null && isFinite(tv) ? +tv : gs.reduce((a, g) => a + g.mensuel, 0);
      const corps = gs.length
        ? (U && typeof U.voirPlus === "function" ? U.voirPlus(gs, 5, g => groupeHtml(g, m, opt.ouverts, U, reel), "Voir plus de catégories", "div", "pv-cat-" + s.type) : gs.map(g => groupeHtml(g, m, opt.ouverts, U, reel)).join(""))
        : '<div class="pv-sec-vide"><p class="pv-muet">' + esc(s.vide) + "</p>" +
          boutonClaude(U, s.type === "revenu" ? "revenus" : "budget", s.type === "revenu" ? "" : "les " + NOM_TYPE[s.type] + " du budget", "Compléter avec Claude") + "</div>";
      return '<section class="pv-sec" aria-labelledby="pv-sec-' + s.type + '"><div class="pv-sec-h"><h3 id="pv-sec-' + s.type + '">' + esc(s.titre) + "</h3>" +
        '<span class="pv-num pv-sec-t">' + esc(eur(total * m.facteur) + m.suffixe) + "</span></div>" + corps +
        (s.type === "depense" ? horsBudgetHtml(gs, reel, m) : "") + (s.type === "epargne" ? tauxReelHtml(opt.budgetReel) : "") + "</section>";
    }).join("");
  }

  const dl = rows => '<dl class="pv-dl">' + rows.map(([k, v]) => "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>").join("") + "</dl>";

  /** Détail d'une ligne dans le panneau (lecture) et « Corriger avec Claude » pour cette ligne. o = { scope, people, Calc, Plan, U }. */
  function ligneDetailHtml(l, o) {
    const opt = o || {}, C = dep(opt, "Calc"), P = dep(opt, "Plan"), scope = opt.scope || "foyer", people = opt.people || [];
    const an = l.frequence === "an", m = +l.montant || 0, brut = P.mensuel(l), p = partDe(l, scope, C);
    const cat = plat(l.categorie) || (l.type === "depense" ? "Autres" : defCat(l.type));
    const rows = [["Type", TYPE_LABEL[l.type] || l.type], ["Catégorie", cat],
      ["Montant saisi", eur(m) + (an ? "/an" : "/mois")], [an ? "Soit par mois" : "Soit par an", an ? eur(brut) + "/mois" : eur(brut * 12) + "/an"]];
    if (people.length > 1) rows.push(["Titulaire", l.owner === "p1" || l.owner === "p2" ? nomDe(l.owner, people) : "Commun"]);
    if (scope !== "foyer") rows.push(["Dans cette vue", p === 0 ? "hors de cette vue" : pct(p) + " · " + eur(brut * p) + "/mois"]);
    const ctx = "la ligne « " + (plat(l.libelle) || "sans libellé") + " » (" + cat + ", " + eur(m) + (an ? "/an" : "/mois") + ")";
    return dl(rows) + '<div class="pv-acts">' + boutonClaude(opt.U, "budget", ctx, "Corriger avec Claude") + "</div>" +
      '<p class="pv-note">Pour modifier ou retirer cette ligne, passe par Claude : il te propose le changement, que tu valides dans Agent › À valider.</p>';
  }

  /** Détail d'une carte de l'en-tête : catégories du type (avec leurs lignes pour revenus et épargne ; dépenses en 5 puis
      « Voir plus »), capacité d'épargne, calcul du reste, et « Compléter avec Claude ». */
  function resumeDetailHtml(type, groupes, r, U) {
    const m = mode0(r && r.mode), gs = (groupes && groupes[type]) || [], u = U || glob("UI");
    const item = g => {
      const sous = type === "depense" ? [] : g.profil.map(x => [x.libelle, x.mensuel]).concat(g.lignes.map(x => [x.libelle, x.mensuel]));
      return '<li class="pv-det-i"><div class="pv-det-l"><span>' + esc(g.titre) + '</span><b class="pv-num">' + esc(eur(g.mensuel * m.facteur) + m.suffixe) + "</b></div>" +
        (sous.length ? '<ul class="pv-det-sous">' + sous.map(([lib, v]) => "<li><span>" + esc(lib) + '</span><span class="pv-num">' + esc(eur(v * m.facteur)) + "</span></li>").join("") + "</ul>" : "") + "</li>";
    };
    const liste = !gs.length ? "" : '<div class="pv-det">' + (type === "depense" && u && typeof u.voirPlus === "function"
      ? u.voirPlus(gs, 5, item, "Voir plus de catégories", "ul", "pv-det-depense") : '<ul class="ui-voirplus-liste">' + gs.map(item).join("") + "</ul>") + "</div>";
    const acts = (section, ctx) => '<div class="pv-acts">' + boutonClaude(u, section, ctx, "Compléter avec Claude") + "</div>";
    if (type === "revenu") return (liste || '<p class="pv-note">Aucun revenu connu pour l\'instant.</p>') +
      '<p class="pv-note">Salaires et loyers viennent de Compte › Données ; les autres revenus sont des lignes du budget.</p>' + acts("revenus", "");
    if (type === "depense") return (liste || '<p class="pv-note">Aucune dépense dans ton budget.</p>') +
      '<p class="pv-note">Les mensualités de tes prêts et crédits viennent de Compte › Données.</p>' + acts("budget", "les dépenses");
    if (type === "epargne") return (liste || '<p class="pv-note">Aucune épargne prévue dans ton budget.</p>') +
      '<p class="pv-note">Capacité d\'épargne prévue : ' + esc(r && r.taux != null ? pct(r.taux) + (r.repere ? " (" + r.repere + ")" : "") : r && !r.aLignes ? SANS_TAUX : "inconnu") +
      ". C'est l'épargne prévue et le reste positif, rapportés aux revenus (revenus − dépenses, au moins l'épargne prévue) ; repère 15 %.</p>" + acts("budget", "l'épargne prévue");
    return dl([["Revenus", eur(r.revenus) + m.suffixe], ["Dépenses", eur(r.depenses) + m.suffixe], ["Épargne", eur(r.epargne) + m.suffixe],
      ["Reste", r.reste == null ? "—" : eur(r.reste) + m.suffixe]]) +
      '<p class="pv-note">Reste = revenus − dépenses − épargne. ' + (r.reste == null ? "Il se calcule une fois le budget rempli." : r.negatif ? "Il est négatif : le budget dépense plus qu'il ne reçoit." : "C'est la marge qui te reste chaque mois après tes dépenses et ton épargne prévue.") + "</p>" +
      acts("budget", "");
  }

  const H = { lignesProfil, regrouper, resume, barre, segments, cartesHtml, barreHtml, groupesHtml, ligneDetailHtml, resumeDetailHtml, boutonClaude, reelDe, noteReel,
    budgetReelDe, tauxReelHtml, MODES, PALETTE };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =================================================================== vue =================================================================== */
  let root = null, S = null, aRendre = true;
  /* affichage : mode (mois | an), catégories ouvertes, signatures des derniers contenus écrits (anti-redessin) */
  let mode = "mois";
  const ouverts = new Set();
  let sigCartes = "", sigBar = "", sigBudget = "", sigPanneau = "";
  /* panneau : { kind: "ligne" | "resume", id, retour } */
  let pan = null, corpsPanneau = null;

  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const P = () => window.Plan, C = () => window.Calc;
  const people = () => (S && Array.isArray(S.people) ? S.people : []);
  const scope = () => (S && S.scope) || "foyer";
  const duScope = () => (scope() === "foyer" ? "du foyer" : C().deNom(nomDe(scope(), people()), scope() === "p2" ? 2 : 1));
  const ctxCalc = () => ({ profil: S && S.profil, scope: scope(), people: people(), Plan: P(), Calc: C() });
  const jourLocal = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
  const lignes = () => (S && S.budget && Array.isArray(S.budget.lignes) ? S.budget.lignes : []);
  const ligne = id => lignes().find(l => l && String(l.id) === String(id)) || null;
  const echap = s => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"));

  /* Réécrit un conteneur ; le focus revient à l'élément du même rôle (ligne, catégorie, carte, « Voir plus ») s'il était dedans. */
  const ATTRS_FOCUS = ["data-pv-ligne", "data-pv-cat", "data-ui-carte", "aria-controls"];
  function ecrire(el, h) {
    const a = document.activeElement;
    let cle = null;
    if (a && a !== el && el.contains(a)) {
      const porteur = a.closest ? (a.closest("[data-pv-ligne]") || a.closest("[data-ui-voirplus]") || a.closest("[data-pv-cat]") || a.closest("[data-ui-carte]") || a) : a;
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
    return '<div class="pv-vide"><h3>Ton budget est vide</h3>' +
      "<p>En quelques lignes (logement, courses, transport, épargne…), le budget donne trois repères que le reste de Boussole ne peut pas deviner :</p>" +
      "<ul><li><b>ta capacité d'épargne</b>, la part de tes revenus qui reste après les dépenses chaque mois ;</li>" +
      "<li><b>ton matelas en mois de dépenses</b>, pour savoir combien de temps tu tiendrais sans revenu ;</li>" +
      "<li><b>ton score de santé</b> financière, affiché dans Pilotage › Santé.</li></ul>" +
      "<p>Claude le remplit avec toi, à partir de tes réponses ou d'un relevé bancaire ; tu valides ensuite ses propositions.</p>" +
      '<div class="pv-vide-act">' + boutonClaude(U(), "budget", "", "Compléter avec Claude") + "</div>" +
      (connus.length ? '<div class="pv-ros"><p class="pv-ros-t">Déjà connu grâce à Compte › Données</p><ul class="pv-ro">' + connus.map(r => roRow(r, MODES.mois)).join("") + "</ul>" + lienProfil + "</div>" : "") +
      "</div>";
  }

  function render() {
    const u = U();
    if (!root || !S || !u) return;
    const L = lignes(), has = L.length > 0;
    const g = regrouper(L, ctxCalc()), t = g.totaux;
    const r = resume(t, mode, has);
    $("pvTitre").textContent = "Budget " + duScope();
    const reel = has ? reelDe(S, jourLocal()) : null, budgetReel = has ? budgetReelDe(S, jourLocal()) : null;
    $("pvBudgetNote").textContent = (scope() === "foyer" ? "Montants du foyer, " + MODES[mode].unite + "." : "Vue " + duScope() + " : ses lignes, et la moitié des lignes communes.") +
      (reel ? " " + noteReel(reel) + " " + MENTION_VIREMENTS : "");
    const hc = cartesHtml(r, u, { duScope: duScope() });
    if (hc !== sigCartes) { sigCartes = hc; ecrire($("pvCartes"), hc); }
    const hb = has ? barreHtml(barre(t), mode, u) : "";
    $("pvBarBloc").hidden = !has;
    if (hb !== sigBar) { sigBar = hb; ecrire($("pvBar"), hb); }
    const hg = has ? groupesHtml(g.groupes, { mode, ouverts, totaux: t, U: u, reel, budgetReel }) : videHtml();
    if (hg !== sigBudget) { sigBudget = hg; ecrire($("pvBudget"), hg); }
    renderPanneau(g, r);
  }

  /* ---------- panneau (lecture) ---------- */
  const TITRES_RESUME = { revenu: "Revenus", depense: "Dépenses", epargne: "Épargne", reste: "Reste" };
  const QUESTIONS_RESUME = {
    revenu: "Mes revenus dans Boussole sont-ils complets ? Aide-moi à vérifier ce qui manque.",
    depense: "Analyse mes dépenses par catégorie dans Boussole : où puis-je économiser sans me priver ?",
    epargne: "Ma capacité d'épargne dans Boussole est-elle suffisante, et comment l'améliorer ?",
    reste: "Que faire du reste de mon budget chaque mois dans Boussole : épargne de précaution, objectifs, placements ?",
  };
  function contenuPanneau(g, r) {
    const u = U();
    if (pan.kind === "resume") {
      const gg = g || regrouper(lignes(), ctxCalc());
      return resumeDetailHtml(pan.id, gg.groupes, r || resume(gg.totaux, mode, lignes().length > 0), u);
    }
    return ligneDetailHtml(ligne(pan.id), { scope: scope(), people: people(), Calc: C(), Plan: P(), U: u });
  }
  function optionsPanneau(h) {
    const u = U();
    let titre = "Budget", pied = null, lien = null;
    if (pan.kind === "resume") {
      titre = TITRES_RESUME[pan.id] || "Budget";
      pied = u.demanderAClaude(QUESTIONS_RESUME[pan.id] || QUESTIONS_RESUME.depense);
      if (pan.id === "revenu") lien = { label: "Voir mes revenus dans Compte › Données", href: "#compte/donnees" };
    } else {
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
    const sel = p.kind === "resume" ? '[data-ui-carte="' + echap(p.id) + '"]' : '[data-pv-ligne="' + echap(p.id) + '"]';
    const el = root.querySelector(sel);
    (el || $("pvTitre")).focus();
  }
  function ouvrir(p) {
    const u = U();
    if (!u) return;
    pan = Object.assign({}, p);
    const h = contenuPanneau();
    sigPanneau = h;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(h));
    u.brancher(corpsPanneau);
  }
  /* Rafraîchit le panneau ouvert quand ses données changent (émission du store, bascule de mode). */
  function renderPanneau(g, r) {
    const u = U();
    if (!pan || !u || !u.panneau.ouvert()) return;
    if (pan.kind === "ligne" && !ligne(pan.id)) { u.panneau.fermer({ focus: false }); return; }
    const h = contenuPanneau(g, r);
    if (h === sigPanneau) return;
    sigPanneau = h;
    const y = corpsPanneau ? corpsPanneau.scrollTop : 0;
    corpsPanneau = u.panneau.ouvrir(optionsPanneau(h));
    corpsPanneau.scrollTop = y;
    u.brancher(corpsPanneau);
  }

  function mount(r) {
    root = r;
    $("pvTitre").setAttribute("tabindex", "-1");
    const u = U();
    if (u) {
      u.bascule($("pvMode"), { label: "Montants", options: [{ id: "mois", label: "Par mois" }, { id: "an", label: "Par an" }], actif: mode,
        surChange: id => { mode = id === "an" ? "an" : "mois"; render(); } });
      // Le bouton Claude de l'en-tête couvre « Établir mon budget », « Compléter mes revenus » : plus de boutons Claude empilés sous le titre.
      u.brancher($("pvCartes"), { surCarte: (id, el) => ouvrir({ kind: "resume", id, retour: el }) });
      u.brancher($("pvBar"));
      u.brancher($("pvBudget"));
    }
    root.addEventListener("click", e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const b = t.closest("[data-pv-ligne]");
      if (b && root.contains(b)) ouvrir({ kind: "ligne", id: b.getAttribute("data-pv-ligne"), retour: b });
    });
    /* Catégorie dépliée ou repliée : retenue pour le prochain redessin (toggle ne remonte pas : écoute en capture). */
    root.addEventListener("toggle", e => {
      const d = e.target;
      if (!d || !d.getAttribute || !d.hasAttribute("data-pv-cat")) return;
      const cle = d.getAttribute("data-pv-cat");
      if (d.hasAttribute("open")) ouverts.add(cle); else ouverts.delete(cle);
    }, true);
  }

  function update(snap, visible) {
    S = snap;
    aRendre = true;
    if (visible) { render(); aRendre = false; }
  }
  function show() { if (aRendre) { render(); aRendre = false; } }
  function headline() {
    if (!S || !(S.ready || S.dbOk === false)) return "–";
    const L = lignes();
    if (!L.length) return "Budget à remplir";
    const t = window.Plan.budgetTotaux(L, S.profil, S.scope).tauxEpargne;
    return t == null ? "Budget à remplir" : Math.round(t * 100) + " % de capacité prévue au budget";
  }

  const api = { mount, update, show, headline };
  const reg = () => App.register("plan", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
