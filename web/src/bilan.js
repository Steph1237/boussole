/* Patrimoine › Immobilier et crédits (module « bilan ») : « Qu'est-ce que je possède en immobilier et que dois-je ? ».
   - En-tête : verdict en une phrase, « Demander à Claude » ; quatre tuiles : immobilier (valeur), reste à rembourser (dettes),
     mensualités, taux d'endettement (mensualités ÷ revenus, lien vers Pilotage › Rang pour la capacité d'emprunt).
   - Une carte par bien (usage, valeur, part de l'immobilier, déjà à vous, reste dû, mensualité, loyer) et une carte par crédit
     (prêt rattaché à un bien ou autre crédit : reste dû, mensualité, titulaire) ; 5 puis « Voir plus » ; une carte ouvre un
     panneau (UI.panneau) : détail, « Modifier dans Compte › Données » (#compte/donnees?section=biens|credits, la page Compte ouvre
     la section demandée via App.parametres()), « Demander à Claude ». « Ajouter un bien » / « Ajouter un crédit » : même ancre.
   - État vide orienté agent (« Dites à Claude si vous êtes propriétaire ou si vous avez des crédits ») ; chargement, données
     indisponibles. Méthode en accordéon fermé.
   Respecte le périmètre (Foyer / personne) : Calc.part (quote-part d'un bien) et Calc.partCredit. Aucun calcul nouveau : totaux de
   Calc.immobilier / dettes / mensualites, revenus de Plan.budgetTotaux (même taux d'endettement que Pilotage › Santé).
   Lecture seule : les saisies vivent dans Compte › Données. La composition « Ce que je possède, ce que je dois » est dans le panneau
   de la carte Patrimoine net d'Aujourd'hui ; la vue par disponibilité dans Patrimoine › Placements ; « à traiter » dans Aujourd'hui.
   Fonctions pures exportées pour les tests (module.exports) : analyser, verdict, tuilesHtml, carteBienHtml, carteCreditHtml,
   detailBienHtml, detailCreditHtml, lienModifier, questionPage, questionBien, questionCredit, videHtml, headlineDe.
   Dépendances injectées (deps) : { Calc, Plan } ; window.* par défaut. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) && d[k] ? d[k] : glob(k));

  /* ---------- formats ---------- */
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const num = v => (isFinite(+v) ? +v : 0);
  const pos = v => Math.max(0, num(v));
  const eur = v => (v == null || !isFinite(v) ? "—" : (Math.round(v) < 0 ? "−" : "") + nf.format(Math.abs(Math.round(v))) + "\u00a0€");
  const eurM = v => eur(v) + "/mois";
  const kEur = v => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + "\u00a0M€" : nf.format(Math.round(v / 1000)) + "\u00a0k€");
  const pct = v => (v == null || !isFinite(v) ? "—" : Math.round(v * 100).toLocaleString("fr-FR") + "\u00a0%");
  const plat = t => String(t ?? "").replace(/\s+/g, " ").trim();
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  const PLAFOND = 0.35;

  /* ---------- vocabulaire ---------- */
  const USAGES = { rp: "Résidence principale", locatif: "Locatif", secondaire: "Résidence secondaire" };
  const SECTION = { bien: "biens", pret: "biens", credit: "credits" };
  const CHEVRON_D = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';

  /* =============================================================== calculs de présentation =============================================================== */
  const DEFAULT_NOMS = { p1: "Personne 1", p2: "Personne 2" };
  /** Prénom d'une personne : S.people, puis profil.personnes, puis « Personne 1 / 2 ». */
  function nomDe(S, id) {
    const p = ((S && S.people) || []).find(x => x && x.id === id);
    const pr = S && S.profil && S.profil.personnes && S.profil.personnes[id];
    return plat((p && p.nom) || (pr && pr.nom)) || DEFAULT_NOMS[id] || id;
  }
  /** « du foyer », « de Camille », « d'Alex ». */
  function duScope(S, Calc) {
    const sc = (S && S.scope) || "foyer";
    if (sc === "foyer") return "du foyer";
    return Calc && Calc.deNom ? Calc.deNom(nomDe(S, sc), sc === "p2" ? 2 : 1) : "de " + nomDe(S, sc);
  }
  const cle = (prefixe, x, i) => prefixe + ":" + (x && x.id != null && String(x.id) !== "" ? String(x.id) : "i" + i);

  /** Biens et crédits du profil dans le périmètre, totaux et taux d'endettement.
      → { scope, duScope, renseigne, vide, biens: [{ key, index, nom, usage, usageLabel, valeur, valeurTotale, part, partP1, crd, mensualite, loyer,
          net, poids, alerte }], credits: [{ key, kind: pret|credit, nom, titulaire, owner, crd, mensualite, part, bienKey, bienNom }],
          immobilier, dettes, mensualites, loyers, revenus, taux, nbBiens, nbCredits, deuxAdultes }
      Un bien ou un crédit qui ne compte pas dans le périmètre (quote-part nulle) est écarté. Les prêts des biens (crd ou mensualité)
      rejoignent la liste des crédits, en tête. deps = { Calc, Plan }. */
  function analyser(S, deps) {
    const s = S || {}, Calc = dep(deps, "Calc"), Plan = dep(deps, "Plan");
    const scope = s.scope || "foyer", profil = s.profil || null;
    const B = profil && Array.isArray(profil.biens) ? profil.biens : [], C = profil && Array.isArray(profil.credits) ? profil.credits : [];
    const deuxAdultes = num(profil && profil.foyer && profil.foyer.adultes) >= 2;
    const biens = [], credits = [], prets = [];
    B.forEach((b, i) => {
      if (!b) return;
      const part = Calc.part(scope, b.part_p1), valeurTotale = pos(b.valeur);
      if (!(part > 0)) return;
      const key = cle("bien", b, i), nom = plat(b.nom) || "Bien";
      const x = { key, index: i, nom, usage: b.usage || "", usageLabel: USAGES[b.usage] || "Bien immobilier", valeurTotale, part,
        partP1: b.part_p1 == null || b.part_p1 === "" ? 50 : Math.min(100, Math.max(0, num(b.part_p1))),
        valeur: valeurTotale * part, crd: pos(b.crd) * part, mensualite: pos(b.mensualite) * part, loyer: pos(b.loyer) * part };
      x.net = x.valeur - x.crd;
      x.alerte = pos(b.crd) > valeurTotale && valeurTotale > 0;
      biens.push(x);
      if (x.crd > 0 || x.mensualite > 0) prets.push({ key: cle("pret", b, i), kind: "pret", nom: "Prêt immobilier · " + nom, titulaire: "", owner: "",
        crd: x.crd, mensualite: x.mensualite, part, bienKey: key, bienNom: nom });
    });
    C.forEach((c, i) => {
      if (!c) return;
      const part = Calc.partCredit(scope, c.owner);
      if (!(part > 0)) return;
      const owner = c.owner === "p1" || c.owner === "p2" ? c.owner : "commun";
      credits.push({ key: cle("credit", c, i), kind: "credit", nom: plat(c.nom) || "Crédit", owner, titulaire: owner === "commun" ? "Commun" : nomDe(s, owner),
        crd: pos(c.crd) * part, mensualite: pos(c.mensualite) * part, part, bienKey: null, bienNom: "" });
    });
    const immobilier = Calc.immobilier(profil, scope), dettes = Calc.dettes(profil, scope), mensualites = Calc.mensualites(profil, scope);
    biens.forEach(b => { b.poids = immobilier > 0 ? b.valeur / immobilier : 0; });
    biens.sort((a, b) => b.valeur - a.valeur || a.index - b.index);
    let revenus = 0;
    try { revenus = Plan ? Plan.budgetTotaux(s.budget && Array.isArray(s.budget.lignes) ? s.budget.lignes : [], profil, scope).revenus : Calc.revenusFoyer(profil, scope); }
    catch (e) { revenus = 0; }
    const tout = prets.sort((a, b) => b.crd - a.crd).concat(credits.sort((a, b) => b.crd - a.crd));
    return { scope, duScope: duScope(s, Calc), renseigne: !!profil && (Array.isArray(profil.biens) || Array.isArray(profil.credits) || !!profil.biensRenseignes),
      vide: !biens.length && !tout.length, biens, credits: tout, immobilier, dettes, mensualites, loyers: biens.reduce((a, b) => a + b.loyer, 0),
      revenus, taux: revenus > 0 ? mensualites / revenus : null, nbBiens: biens.length, nbCredits: tout.length, deuxAdultes };
  }

  /** Verdict de la page, en une phrase : { phrase, ton } (ton : bon | attention | critique | neutre). */
  function verdict(a) {
    if (!a || a.vide) return { phrase: a && a.renseigne ? "Aucun bien immobilier ni crédit enregistré " + a.duScope + "."
      : "Pas encore de bien ni de crédit enregistré : dites à Claude si vous êtes propriétaire ou si vous avez des crédits.", ton: "neutre" };
    const morceaux = [];
    if (a.immobilier > 0) morceaux.push(eur(a.immobilier) + " d'immobilier");
    morceaux.push(a.dettes > 0 ? eur(a.dettes) + " restant à rembourser" : "aucun crédit en cours");
    let phrase = "Immobilier et crédits " + a.duScope + " : " + morceaux.join(", ") + ".";
    let ton = "neutre";
    if (a.taux != null && a.mensualites > 0) {
      ton = a.taux <= PLAFOND ? "bon" : "critique";
      phrase += " Vos mensualités pèsent " + pct(a.taux) + " de vos revenus" + (a.taux <= PLAFOND ? ", sous le plafond de 35 % des banques." : ", au-delà du plafond de 35 % des banques.");
    } else if (a.mensualites > 0) phrase += " Renseignez vos revenus pour connaître votre taux d'endettement.";
    return { phrase, ton };
  }

  /** Les quatre tuiles de l'en-tête (texte échappé ; liens internes vers Pilotage › Rang ou Compte › Données). */
  function tuilesHtml(a) {
    const t = (id, label, valeur, sous, ton) => '<div class="bl-tuile' + (ton ? " " + ton : "") + '" data-bl-tuile="' + id + '"><span class="bl-tuile-l">' + esc(label) + "</span>" +
      '<span class="bl-tuile-v">' + esc(valeur) + '</span><span class="bl-tuile-s">' + sous + "</span></div>";
    const tauxTon = a.taux == null ? "" : a.mensualites <= 0 ? "" : a.taux <= PLAFOND ? "bon" : "critique";
    const tauxSous = a.taux == null
      ? 'revenus à renseigner · <a href="#compte/donnees?section=revenus" data-goto="compte/donnees?section=revenus">Compte › Données</a>'
      : esc(a.taux <= PLAFOND ? "plafond des banques : 35 %" : "au-delà du plafond de 35 %") + ' · <a href="#pilotage/rang" data-goto="pilotage/rang">Ma capacité d\'emprunt</a>';
    return t("immobilier", "Immobilier", eur(a.immobilier), esc(a.nbBiens ? pluriel(a.nbBiens, "bien") + (a.loyers > 0 ? " · loyers " + eurM(a.loyers) : "") : "aucun bien")) +
      t("dettes", "Reste à rembourser", eur(a.dettes), esc(a.nbCredits ? pluriel(a.nbCredits, "crédit") : "aucun crédit")) +
      t("mensualites", "Mensualités", eurM(a.mensualites), esc(a.mensualites > 0 ? "tous crédits confondus" : "aucune mensualité")) +
      t("taux", "Taux d'endettement", a.taux == null ? "—" : pct(a.taux), tauxSous, tauxTon);
  }

  /** Carte repliée d'un bien (bouton data-ui-carte, ouvert en panneau par UI.brancher). */
  function carteBienHtml(b) {
    const deja = b.valeur > 0 ? Math.max(0, Math.min(1, b.net / b.valeur)) : 0;
    const pied = [pct(b.poids) + " de l'immobilier", b.crd > 0 ? "reste dû " + eur(b.crd) : "sans crédit"]
      .concat(b.mensualite > 0 ? [eurM(b.mensualite)] : [], b.loyer > 0 ? ["loyer " + eurM(b.loyer)] : []);
    return '<button type="button" class="ui-carte bl-carte" data-ui-carte="' + esc(b.key) + '" aria-haspopup="dialog">' +
      '<span class="ui-carte-tete"><span class="ui-carte-titre">' + esc(b.usageLabel) + "</span>" + (b.alerte ? '<span class="ui-badge attention">À vérifier</span>' : "") + "</span>" +
      '<span class="bl-carte-nom">' + esc(b.nom) + "</span>" +
      '<span class="ui-carte-valeur">' + esc(eur(b.valeur)) + "</span>" +
      (b.crd > 0 ? '<span class="bl-barre" aria-hidden="true"><i style="width:' + (deja * 100).toFixed(1) + '%"></i></span><span class="bl-carte-deja">' + esc("Déjà à vous : " + eur(b.net) + " (" + pct(deja) + ")") + "</span>" : "") +
      '<span class="ui-carte-pied">' + pied.map(p => "<span>" + esc(p) + "</span>").join("") + "</span>" +
      '<span class="ui-carte-ouvrir">' + CHEVRON_D + "</span></button>";
  }

  /** Carte repliée d'un crédit (prêt d'un bien ou autre crédit). */
  function carteCreditHtml(c) {
    const titre = c.kind === "pret" ? "Prêt immobilier" : "Crédit · " + c.titulaire;
    const nom = c.kind === "pret" ? c.bienNom : c.nom;
    return '<button type="button" class="ui-carte bl-carte bl-credit" data-ui-carte="' + esc(c.key) + '" aria-haspopup="dialog">' +
      '<span class="ui-carte-tete"><span class="ui-carte-titre">' + esc(titre) + "</span></span>" +
      '<span class="bl-carte-nom">' + esc(nom) + "</span>" +
      '<span class="ui-carte-valeur">' + esc(eur(c.crd)) + "</span>" +
      '<span class="ui-carte-pied"><span>reste à rembourser</span>' + (c.mensualite > 0 ? "<span>" + esc(eurM(c.mensualite)) + "</span>" : "") + "</span>" +
      '<span class="ui-carte-ouvrir">' + CHEVRON_D + "</span></button>";
  }

  /** Lien « Modifier » du panneau : Compte › Données, section concernée dépliée (biens pour un bien et son prêt, credits sinon). */
  function lienModifier(kind) {
    const section = SECTION[kind] || "biens";
    return { label: "Modifier dans Compte › Données", href: "#compte/donnees?section=" + section };
  }

  const dl = lignes => '<dl class="bl-d-dl">' + lignes.filter(Boolean).map(l => "<dt>" + esc(l[0]) + "</dt><dd>" + esc(l[1]) + "</dd>").join("") + "</dl>";
  /** Contenu du panneau d'un bien (HTML échappé). ctx = { scope, nomP1, nomP2, deuxAdultes }. */
  function detailBienHtml(b, ctx) {
    const c = ctx || {}, foyer = !c.scope || c.scope === "foyer";
    const partLigne = foyer
      ? (c.deuxAdultes || b.partP1 !== 100 ? ["Répartition", (c.nomP1 || "Personne 1") + " " + b.partP1 + " % · " + (c.nomP2 || "Personne 2") + " " + (100 - b.partP1) + " %"] : null)
      : ["Votre part", pct(b.part) + " de " + eur(b.valeurTotale)];
    const lignes = [["Usage", b.usageLabel], ["Valeur" + (foyer ? "" : " (votre part)"), eur(b.valeur)], partLigne,
      ["Reste à rembourser", b.crd > 0 ? eur(b.crd) : "aucun crédit"], ["Déjà à vous", eur(b.net) + (b.valeur > 0 ? " (" + pct(Math.max(0, b.net) / b.valeur) + ")" : "")],
      ["Mensualité", b.mensualite > 0 ? eurM(b.mensualite) : "—"], ["Loyer perçu", b.loyer > 0 ? eurM(b.loyer) : "—"],
      b.loyer > 0 && b.mensualite > 0 ? ["Loyer moins mensualité", (b.loyer - b.mensualite >= 0 ? "+" : "") + eurM(b.loyer - b.mensualite)] : null,
      ["Part de l'immobilier", pct(b.poids)]];
    return dl(lignes) +
      (b.alerte ? '<p class="bl-d-alerte" role="note">Le reste à rembourser dépasse la valeur du bien : vérifiez les deux montants.</p>' : "") +
      '<p class="bl-d-note">Montants déclarés dans Compte › Données ; Boussole ne réévalue pas la valeur du bien.</p>';
  }
  /** Contenu du panneau d'un crédit (HTML échappé). ctx = { scope }. */
  function detailCreditHtml(c, ctx) {
    const foyer = !(ctx && ctx.scope) || ctx.scope === "foyer";
    const lignes = [["Type", c.kind === "pret" ? "Prêt immobilier" : "Crédit"], c.kind === "pret" ? ["Bien financé", c.bienNom] : ["Titulaire", c.titulaire],
      ["Reste à rembourser" + (foyer ? "" : " (votre part)"), eur(c.crd)], ["Mensualité" + (foyer ? "" : " (votre part)"), c.mensualite > 0 ? eurM(c.mensualite) : "—"],
      !foyer && c.part < 1 ? ["Part comptée", pct(c.part)] : null];
    return dl(lignes) + '<p class="bl-d-note">' + esc(c.kind === "pret"
      ? "Ce prêt est saisi avec le bien « " + c.bienNom + " » dans Compte › Données (reste à rembourser et mensualité du bien)."
      : "Montants déclarés dans Compte › Données. Un crédit commun compte pour moitié à chacun.") + "</p>";
  }

  /** Questions préremplies de « Demander à Claude » (espaces simples). */
  const nbsp = s => String(s).replace(/[\u00a0\u202f]/g, " ");
  function questionPage(a) {
    if (!a || a.vide) return "Aide-moi à renseigner dans Boussole mes biens immobiliers et mes crédits : pose-moi les questions une à une (propriétaire ou locataire, valeur, reste à rembourser, mensualités).";
    return nbsp("Explique-moi mon immobilier et mes crédits dans Boussole : ce que je possède, ce qu'il me reste à rembourser et ce que pèsent mes mensualités" +
      (a.taux != null ? " (" + pct(a.taux) + " de mes revenus)" : "") + ".");
  }
  function questionBien(b) {
    return nbsp("Dans Boussole, mon bien « " + b.nom + " » (" + b.usageLabel.toLowerCase() + ") vaut " + eur(b.valeur) +
      (b.crd > 0 ? " avec " + eur(b.crd) + " restant à rembourser" : " sans crédit") + (b.loyer > 0 ? " et rapporte " + eurM(b.loyer) : "") +
      ". Explique-moi ce que ces chiffres veulent dire pour moi.");
  }
  function questionCredit(c) {
    return nbsp("Dans Boussole, mon " + (c.kind === "pret" ? "prêt immobilier pour « " + c.bienNom + " »" : "crédit « " + c.nom + " »") + " : " + eur(c.crd) + " restant à rembourser" +
      (c.mensualite > 0 ? ", " + eurM(c.mensualite) : "") + ". Explique-moi son poids dans mon budget et les questions à me poser (remboursement anticipé, renégociation).");
  }

  /** État vide orienté agent : « Dites à Claude… », puis ajout à la main. */
  function videHtml(a, U) {
    const titre = a && a.renseigne ? "Vous n'avez déclaré ni bien immobilier ni crédit." : "Aucun bien ni crédit enregistré pour l'instant.";
    return '<p class="bl-vide-t">' + esc(titre) + "</p>" +
      "<p>Dites à Claude si vous êtes propriétaire ou si vous avez des crédits (immobilier, auto, consommation) : il les enregistre avec votre accord, et Boussole en tire votre patrimoine net et votre taux d'endettement.</p>" +
      '<div class="bl-vide-act">' + (U && U.demanderAClaude ? U.demanderAClaude(questionPage(a), "Le dire à Claude") : "") +
      '<a class="bl-lien" href="#compte/donnees?section=biens" data-goto="compte/donnees?section=biens">Ajouter à la main</a></div>';
  }

  /** Chiffre clé de la sous-vue : valeur de l'immobilier, sinon reste à rembourser, sinon « – ». */
  function headlineDe(a) {
    if (!a || a.vide) return "–";
    return a.immobilier > 0 ? kEur(a.immobilier) : kEur(a.dettes) + " dus";
  }

  const H = { analyser, verdict, tuilesHtml, carteBienHtml, carteCreditHtml, detailBienHtml, detailCreditHtml, lienModifier, questionPage, questionBien, questionCredit,
    videHtml, headlineDe, USAGES };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =================================================================== vue =================================================================== */
  let S = null, root = null, dirty = true, last = null, ouvert = null, retour = null;
  const sig = { tuiles: "", biens: "", credits: "", vide: "", claude: "", panneau: "" };
  const $ = id => root.querySelector("#" + id);
  const U = () => window.UI || null;
  const calculable = () => !!(window.Calc && S);
  const echap = s => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"));
  /* Rien n'est réécrit (ni focus perdu, ni « Voir plus » replié) quand le HTML n'a pas changé. */
  const ecrire = (id, k, h) => { if (sig[k] !== h) { sig[k] = h; $(id).innerHTML = h; } };

  function render() {
    if (!root || !S) return;
    const u = U(), charge = S.ready !== false, indispo = S.dbOk === false;
    const etat = !charge ? "Chargement des données…" : indispo && !S.profil ? "Données indisponibles pour le moment : rechargez la page ou reconnectez-vous." : "";
    $("blEtat").textContent = etat; $("blEtat").hidden = !etat;
    $("blCorps").hidden = !!etat || !calculable();
    if (etat || !calculable() || !u) { $("blVerdict").textContent = etat || "Chargement…"; $("blVerdict").className = "bl-verdict"; return; }
    const a = last = analyser(S);
    const v = verdict(a);
    $("blVerdict").textContent = v.phrase;
    $("blVerdict").className = "bl-verdict ton-" + v.ton;
    ecrire("blDemander", "claude", u.demanderAClaude(questionPage(a)));
    ecrire("blTuiles", "tuiles", tuilesHtml(a));
    $("blVide").hidden = !a.vide;
    ecrire("blVide", "vide", a.vide ? videHtml(a, u) : "");
    $("blBiensSec").hidden = a.vide; $("blCreditsSec").hidden = a.vide;
    ecrireCartes("blBiens", "biens", a.biens.length ? u.voirPlus(a.biens, 5, carteBienHtml, "Voir plus de biens")
      : '<p class="bl-aucun">Aucun bien immobilier ' + esc(a.duScope) + '. <a href="#compte/donnees?section=biens" data-goto="compte/donnees?section=biens">Ajouter un bien</a></p>');
    ecrireCartes("blCredits", "credits", a.credits.length ? u.voirPlus(a.credits, 5, carteCreditHtml, "Voir plus de crédits")
      : '<p class="bl-aucun">Aucun crédit en cours ' + esc(a.duScope) + ".</p>");
    rafraichirPanneau();
  }
  /* Cartes réécrites : le focus reste sur la carte du même bien ou crédit. */
  function ecrireCartes(id, k, h) {
    if (sig[k] === h) return;
    const act = document.activeElement, porteur = act && $(id).contains(act) && act.closest ? act.closest("[data-ui-carte]") : null;
    const cleF = porteur ? porteur.getAttribute("data-ui-carte") : null;
    sig[k] = h; $(id).innerHTML = h;
    const n = cleF && $(id).querySelector('[data-ui-carte="' + echap(cleF) + '"]'); if (n) n.focus();
  }

  /* ---------- panneau d'un bien ou d'un crédit ---------- */
  const element = key => (last ? last.biens.find(b => b.key === key) || last.credits.find(c => c.key === key) : null) || null;
  function options(key, u) {
    const x = element(key);
    if (!x) return null;
    const bien = key.indexOf("bien:") === 0;
    const ctx = { scope: last.scope, nomP1: nomDe(S, "p1"), nomP2: nomDe(S, "p2"), deuxAdultes: last.deuxAdultes };
    return { titre: bien ? x.nom : x.kind === "pret" ? "Prêt · " + x.bienNom : x.nom, contenu: bien ? detailBienHtml(x, ctx) : detailCreditHtml(x, ctx),
      lien: lienModifier(bien ? "bien" : x.kind), pied: u.demanderAClaude(bien ? questionBien(x) : questionCredit(x)) };
  }
  function ouvrir(key, el) {
    const u = U(); if (!u) return;
    const o = options(key, u); if (!o) return;
    ouvert = key; retour = el || null; sig.panneau = o.titre + "|" + o.contenu;
    u.panneau.ouvrir(Object.assign(o, { retour, surFermeture: fermeture }));
  }
  /* Le store a émis pendant l'ouverture : contenu mis à jour s'il a changé, panneau fermé si l'élément a disparu. */
  function rafraichirPanneau() {
    const u = U();
    if (!ouvert || !u || !u.panneau.ouvert()) return;
    const o = options(ouvert, u);
    if (!o) { u.panneau.fermer({ focus: false }); return; }
    const s = o.titre + "|" + o.contenu;
    if (s === sig.panneau) return;
    sig.panneau = s; u.panneau.ouvrir(o);
  }
  /* Fermeture : focus rendu à la carte d'origine ; si la page a été redessinée, à la carte du même élément, sinon au titre. */
  function fermeture(o) {
    const key = ouvert, el = retour;
    ouvert = null; retour = null; sig.panneau = "";
    if ((o && o.focus === false) || !root) return;
    if (el && el.isConnected) return;
    const c = key && root.querySelector('[data-ui-carte="' + echap(key) + '"]');
    if (c) c.focus(); else $("blTitre").focus();
  }

  function mount(r) {
    root = r;
    const u = U();
    if (u) u.brancher(root, { surCarte: (id, el) => ouvrir(id, el) });
  }
  function update(snap, visible) {
    S = Object.assign({}, snap, { scope: snap.scope || "foyer", people: snap.people || [] });
    dirty = true;
    if (visible) { render(); dirty = false; }
    else if (ouvert && U() && U().panneau.ouvert() && window.Calc) { last = analyser(S); rafraichirPanneau(); }
  }
  function show() { if (dirty) { render(); dirty = false; } }
  function headline() {
    if (!S || S.ready === false || !window.Calc) return "–";
    try { return headlineDe(analyser(S)); } catch (e) { return "–"; }
  }

  const api = { mount, update, show, headline };
  const reg = () => App.register("bilan", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
