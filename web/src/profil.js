/* Compte › Données (module « profil ») : le profil du foyer en LECTURE SEULE (spec 2026-10-11-saisie-par-agent). La saisie se
   fait avec Claude (formulaires interactifs, documents déposés dans la conversation) ; Boussole affiche et fait valider les
   propositions dans Agent › Propositions. Aucune écriture au store ici.
   En tête : taux de remplissage du bilan (BilanEtat, protection comprise), ce qui manque, récapitulatif, « Compléter avec Claude » (bilan).
   Puis six sections en accordéons fermés (Foyer, Revenus, Biens immobiliers, Crédits, Protection, Autres biens), chacune avec une
   ligne de résumé dans son titre (« 2 adultes, 1 enfant, TMI 30 % »), son contenu en lecture (valeurs renseignées, « non
   renseigné » sinon) et son « Compléter avec Claude » (UI.demanderAClaude + ClaudePrompts.phrase, section de l'agent).
   La protection se lit sous ses deux formes : celle du foyer { prevoyance, emprunteur } et celle par personne
   { p1: { prevoyance, emprunteur }, p2: … } (comme web/src/pratiques.js).
   Lien profond : #compte/donnees?section=foyer|revenus|biens|credits|protection|autres (la coque retient le paramètre,
   App.parametres(), lu une fois au show()) : la section s'ouvre, défile en vue et son titre reçoit le focus.
   Fonctions pures exportées pour les tests (module.exports) : SECTIONS, sectionDemandee, aCredit, protectionLue, resumeFoyer,
   resumeRevenus, resumeBiens, resumeCredits, resumeProtection, resumeAutres, resumes, phraseSection, sectionHtml, claudeHtml. */
(function () {
  "use strict";
  const glob = k => (typeof window !== "undefined" && window[k]) || (typeof self !== "undefined" && self[k]) || null;
  /* Phrases « Compléter avec Claude » : global du navigateur, sinon le module voisin sous Node (tests). */
  const prompts = () => glob("ClaudePrompts") ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./claude-prompts.js") : null);

  /* Complétude : la fonction du bilan (BilanEtat, bilan-etat.js), la même que Compte › Connecter Claude et l'outil etat_du_bilan du connecteur. */
  const bilanEtat = () => glob("BilanEtat") ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./bilan-etat.js") : null);

  /* Crédits en cours (Calc.creditsEnCours, la définition de Patrimoine › Immobilier et crédits) : global du navigateur, sinon le module voisin. */
  const calc = () => glob("Calc") || (typeof module === "object" && module.exports && typeof require === "function" ? require("./calc.js") : null);

  /* ---------- logique pure ---------- */
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const eur = v => nf.format(Math.round(v || 0)) + " €";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => (v == null || v === "" || !isFinite(+v) ? 0 : +v);
  const vide = v => v == null || v === "";
  const s_ = k => (k > 1 ? "s" : "");
  const objet = v => v != null && typeof v === "object" && !Array.isArray(v);
  const NR = "non renseigné";

  const DEFAULT_NOMS = { p1: "Moi", p2: "Conjoint(e)" };
  const SECTIONS = [
    { id: "foyer", titre: "Foyer", claude: "foyer" },
    { id: "revenus", titre: "Revenus", claude: "revenus" },
    { id: "biens", titre: "Biens immobiliers", claude: "immobilier", contexte: "mes biens immobiliers et leurs prêts" },
    { id: "credits", titre: "Crédits", claude: "immobilier", contexte: "mes crédits (prêts immobiliers, auto, consommation, travaux)" },
    { id: "protection", titre: "Protection", claude: "protection" },
    { id: "autres", titre: "Autres biens", claude: "bilan", contexte: "mes autres biens (voiture, meubles, parts d'entreprise)" },
  ];
  const ALIAS = { immobilier: "biens", bien: "biens", credit: "credits", personnes: "revenus", salaires: "revenus", prevoyance: "protection" };
  /** Section demandée par le lien profond ({ section: "biens" } → "biens") ; inconnue ou absente → null. */
  function sectionDemandee(params) {
    const s = String((params && params.section) || "").trim().toLowerCase();
    if (!s) return null;
    const id = ALIAS[s] || s;
    return SECTIONS.some(x => x.id === id) ? id : null;
  }

  const deuxAdultes = pr => num(pr && pr.foyer && pr.foyer.adultes) >= 2;
  const personnesDe = pr => (deuxAdultes(pr) ? ["p1", "p2"] : ["p1"]);
  const nomDe = (pr, k) => String((pr && pr.personnes && pr.personnes[k] && pr.personnes[k].nom) || "").trim() || DEFAULT_NOMS[k];
  /** Crédits en cours : prêts immobiliers des biens et autres crédits, comme Patrimoine › Immobilier et crédits (Calc.creditsEnCours). */
  const creditsDe = pr => { const C = calc(); return C && typeof C.creditsEnCours === "function" ? C.creditsEnCours(pr) : []; };
  /** Un crédit est en cours (prêt immobilier sur un bien ou autre crédit). */
  const aCredit = pr => creditsDe(pr).length > 0;

  /** Complétude du bilan : { pourcentage, incompletes: [titre de section, …] } d'après BilanEtat.etat (foyer, revenus, budget, placements,
      immobilier et crédits, protection, objectifs, profil de risque), une seule définition pour Compte › Données, Compte › Connecter Claude et le
      connecteur. S = état du store ; today = jour (AAAA-MM-JJ, défaut : aujourd'hui). Sans le module : { pourcentage: 0, incompletes: [] }. */
  function completude(S, today) {
    const B = bilanEtat();
    if (!B || !S) return { pourcentage: 0, incompletes: [] };
    const e = B.etat(S, today);
    return { pourcentage: e.pourcentage, incompletes: e.sections.filter(s => s.statut !== "complet").map(s => s.titre) };
  }

  /** « 2 adultes, 1 enfant, TMI 30 % ». */
  function resumeFoyer(pr) {
    const f = (pr && pr.foyer) || {}, a = num(f.adultes), e = num(f.enfants);
    return [
      vide(f.adultes) ? "taille du foyer à renseigner" : a >= 3 ? "3 adultes ou plus" : a + " adulte" + s_(a),
      e <= 0 ? "sans enfant" : e >= 4 ? "4 enfants ou plus" : e + " enfant" + s_(e),
      vide(f.tmi) ? "TMI à renseigner" : "TMI " + num(f.tmi) + " %",
    ].join(", ");
  }
  /** « 5 100 €/mois nets » (revenus du foyer de Calc.revenusFoyer, loyers compris), et le salaire qui manque s'il y en a un. */
  function resumeRevenus(pr, C) {
    const ks = personnesDe(pr), ps = (pr && pr.personnes) || {};
    const manquent = ks.filter(k => !(num(ps[k] && ps[k].salaire) > 0));
    if (manquent.length === ks.length) return ks.length > 1 ? "salaires à renseigner" : "salaire à renseigner";
    const tot = C && typeof C.revenusFoyer === "function" ? C.revenusFoyer(pr, "foyer") : 0;
    const k = manquent[0];
    return eur(tot) + "/mois nets" + (k ? " · salaire " + (C ? C.deNom(nomDe(pr, k), k === "p2" ? 2 : 1) : "") + " à renseigner" : "");
  }
  /** « 1 bien, 320 000 € » (valeurs additionnées) ou « aucun ». */
  function resumeBiens(pr) {
    const L = ((pr && pr.biens) || []).filter(Boolean);
    if (!L.length) return "aucun";
    return L.length + " bien" + s_(L.length) + ", " + eur(L.reduce((a, b) => a + num(b.valeur), 0));
  }
  /** « 2 crédits, dont 1 prêt immobilier, 156 500 € restants, 1 030 €/mois » : tous les crédits en cours (prêts des biens compris), le
      même compte que Patrimoine › Immobilier et crédits ; « aucun » sans crédit. */
  function resumeCredits(pr) {
    const L = creditsDe(pr);
    if (!L.length) return "aucun";
    const prets = L.filter(c => c.kind === "pret").length, crd = L.reduce((a, c) => a + c.crd, 0), m = L.reduce((a, c) => a + c.mensualite, 0);
    return L.length + " crédit" + s_(L.length) + (prets ? ", dont " + prets + (prets > 1 ? " prêts immobiliers" : " prêt immobilier") : "") + ", " + eur(crd) + " restant" + s_(crd) + ", " + eur(m) + "/mois";
  }

  /** Déclaration de protection lue sous ses deux formes (comme pratiques.js) :
      - foyer : protection = { prevoyance, emprunteur } → { forme: "foyer", decl: { prevoyance, emprunteur } } ;
      - par personne : protection = { p1: {…}, p2: {…} } → { forme: "personnes", parPersonne: { p1: decl, p2: decl } } pour les
        personnes du foyer ; une clé du foyer (prevoyance / emprunteur) sert de valeur par défaut à chaque personne.
      Valeurs : true, false, ou null (non déclarée). */
  function protectionLue(pr) {
    const d = objet(pr && pr.protection) ? pr.protection : {};
    const garde = o => ({ prevoyance: typeof o.prevoyance === "boolean" ? o.prevoyance : null, emprunteur: typeof o.emprunteur === "boolean" ? o.emprunteur : null });
    const foyer = garde(d);
    if (!objet(d.p1) && !objet(d.p2)) return { forme: "foyer", decl: foyer };
    const parPersonne = {};
    personnesDe(pr).forEach(k => {
      const p = objet(d[k]) ? garde(d[k]) : { prevoyance: null, emprunteur: null };
      parPersonne[k] = { prevoyance: p.prevoyance != null ? p.prevoyance : foyer.prevoyance, emprunteur: p.emprunteur != null ? p.emprunteur : foyer.emprunteur };
    });
    return { forme: "personnes", parPersonne };
  }
  /* Résumé d'une déclaration { prevoyance, emprunteur } : l'assurance emprunteur n'est citée qu'avec un crédit ou si elle est déclarée. */
  function resumeDecl(decl, credit) {
    const lu = (v, oui, non) => (v === true ? oui : v === false ? non : null);
    const p = lu(decl.prevoyance, "prévoyance en place", "sans prévoyance"), e = lu(decl.emprunteur, "assurance emprunteur en place", "sans assurance emprunteur");
    if (p == null && e == null) return "non renseignée";
    const out = [p || "prévoyance à renseigner"];
    if (e || credit) out.push(e || "assurance emprunteur à renseigner");
    return out.join(", ");
  }
  /** « prévoyance en place, sans assurance emprunteur », « non renseignée » ; par personne : « Camille : … · Sam : … » (une seule
      phrase quand les personnes sont dans la même situation, ou quand le foyer n'a qu'un adulte). */
  function resumeProtection(pr) {
    const l = protectionLue(pr), credit = aCredit(pr);
    if (l.forme === "foyer") return resumeDecl(l.decl, credit);
    const ks = Object.keys(l.parPersonne), txt = ks.map(k => resumeDecl(l.parPersonne[k], credit));
    if (ks.length < 2 || txt.every(t => t === txt[0])) return txt[0];
    return ks.map((k, i) => nomDe(pr, k) + " : " + txt[i]).join(" · ");
  }
  /** Voiture, meubles et parts d'entreprise des personnes du foyer : « 15 000 € » ou « aucun ». */
  function resumeAutres(pr) {
    const a = (pr && pr.autres) || {};
    const tot = personnesDe(pr).reduce((s, k) => s + num(a[k] && a[k].usage) + num(a[k] && a[k].entreprise), 0);
    return tot > 0 ? eur(tot) : "aucun";
  }
  /** Les six résumés de titre, par section. */
  const resumes = (pr, C) => ({ foyer: resumeFoyer(pr), revenus: resumeRevenus(pr, C), biens: resumeBiens(pr), credits: resumeCredits(pr),
    protection: resumeProtection(pr), autres: resumeAutres(pr) });

  /* ---------- contenu en lecture des sections ---------- */
  const ADULTES = { 1: "1", 2: "2", 3: "3 ou plus" };
  const AGES = { u30: "moins de 30 ans", a30: "30 à 39 ans", a40: "40 à 49 ans", a50: "50 à 59 ans", a60: "60 à 69 ans", a70: "70 ans ou plus" };
  const UNIONS = { joint: "marié ou pacsé", sep: "en union libre" };
  /* Codes du profil (mêmes valeurs que le catalogue des formulaires de l'agent, scripts/gen-catalogue.mjs) → libellés lus. */
  const UNITS = [["nm", "net / mois"], ["na", "net / an"], ["bm", "brut / mois"], ["ba", "brut / an"]];
  const TMI = [[0, "0 %"], [11, "11 %"], [30, "30 %"], [41, "41 %"], [45, "45 %"]];
  const UNITES = Object.fromEntries(UNITS);
  const STATUTS = { cadre: "cadre", nc: "non-cadre" };
  const CSP = { cadre: "Cadre", inter: "Profession intermédiaire", empl: "Employé", ouv: "Ouvrier", indep: "Artisan, commerçant, chef d'entreprise",
    liber: "Profession libérale", agri: "Agriculteur", inact: "Autre inactif" };
  const USAGES = { rp: "Résidence principale", locatif: "Locatif", secondaire: "Secondaire" };
  const ouiNon = v => (v === true ? "oui" : v === false ? "non" : NR);
  const lib = (dico, v) => (vide(v) ? NR : dico[v] || String(v));
  const montant = (v, suffixe) => (vide(v) || !isFinite(+v) ? NR : eur(+v) + (suffixe || ""));
  /* Montant où 0 se lit « aucun » (autres revenus, biens d'usage, reste dû…). */
  const montant0 = (v, suffixe) => (vide(v) || !isFinite(+v) ? NR : +v > 0 ? eur(+v) + (suffixe || "") : "aucun");

  /* Liste de définitions : lignes [libellé, valeur] ; une valeur « non renseigné » est atténuée. */
  const dl = lignes => '<dl class="pf-dl">' + lignes.map(([l, v]) =>
    '<div class="pf-dl-l"><dt>' + esc(l) + "</dt><dd" + (v === NR ? ' class="pf-nr"' : "") + ">" + esc(v) + "</dd></div>").join("") + "</dl>";
  const bloc = (titre, lignes) => '<div class="pf-bloc"><h3 class="pf-bloc-t">' + esc(titre) + "</h3>" + dl(lignes) + "</div>";
  const groupe = blocs => '<div class="pf-blocs">' + blocs.join("") + "</div>";
  const aucun = t => '<p class="pf-aucun">' + esc(t) + "</p>";

  /** Contenu en lecture d'une section (HTML échappé) à partir du profil du store (null → rien de renseigné). */
  function sectionHtml(id, pr0, C) {
    const pr = pr0 || {}, f = pr.foyer || {}, ps = pr.personnes || {}, ks = personnesDe(pr);
    const de = k => (C && typeof C.deNom === "function" ? C.deNom(nomDe(pr, k), k === "p2" ? 2 : 1) : nomDe(pr, k));
    if (id === "foyer") {
      const L = [["Adultes", vide(f.adultes) ? NR : ADULTES[Math.min(3, num(f.adultes))] || String(f.adultes)],
        ["Enfants", vide(f.enfants) ? NR : num(f.enfants) >= 4 ? "4 ou plus" : String(num(f.enfants))]];
      if (num(f.enfants) > 0) L.push(["Dont 14 ans ou plus", vide(f.enfants14) ? NR : String(num(f.enfants14))]);
      if (deuxAdultes(pr)) L.push(["Le couple est", lib(UNIONS, f.union)]);
      L.push(["Âge de la personne qui gagne le plus", lib(AGES, f.age)], ["Tranche marginale d'imposition", vide(f.tmi) ? NR : (TMI.find(([v]) => v === num(f.tmi)) || [0, num(f.tmi) + " %"])[1]]);
      return dl(L);
    }
    if (id === "revenus") return groupe(ks.map(k => {
      const p = ps[k] || {};
      return bloc(nomDe(pr, k), [
        ["Salaire", num(p.salaire) > 0 ? eur(+p.salaire) + " " + (UNITES[p.salaireUnite] || UNITES.nm) : NR],
        ["Statut", lib(STATUTS, p.statut)], ["Catégorie professionnelle", lib(CSP, p.csp)],
        ["En période d'essai", ouiNon(p.essai)], ["Autres revenus imposables", montant0(p.autresRevenus, "/mois")]]);
    }));
    if (id === "biens") {
      const L = (pr.biens || []).filter(Boolean);
      if (!L.length) return aucun(Array.isArray(pr.biens) ? "Aucun bien immobilier." : "Aucun bien immobilier renseigné.");
      return groupe(L.map(b => bloc(String(b.nom || "").trim() || "Bien", [["Usage", lib(USAGES, b.usage)], ["Valeur estimée", montant(b.valeur)]]
        .concat(deuxAdultes(pr) ? [["Part " + de("p1"), vide(b.part_p1) ? NR : num(b.part_p1) + " %"]] : [],
          [["Reste à rembourser", montant0(b.crd)], ["Mensualité", montant0(b.mensualite, "/mois")], ["Loyer perçu", montant0(b.loyer, "/mois")]]))));
    }
    if (id === "credits") {
      const prets = (pr.biens || []).filter(b => b && (num(b.crd) > 0 || num(b.mensualite) > 0));
      const L = (pr.credits || []).filter(Boolean);
      if (!prets.length && !L.length) return aucun(Array.isArray(pr.credits) ? "Aucun crédit." : "Aucun crédit renseigné.");
      const titulaire = o => (o === "p1" || o === "p2" ? nomDe(pr, o) : o === "commun" ? "Commun" : NR);
      return groupe(prets.map(b => bloc("Prêt immobilier · " + (String(b.nom || "").trim() || "Bien"), [["Reste à rembourser", montant0(b.crd)], ["Mensualité", montant0(b.mensualite, "/mois")]]))
        .concat(L.map(c => bloc(String(c.nom || "").trim() || "Crédit", [["Titulaire", titulaire(c.owner)], ["Reste à rembourser", montant(c.crd)],
          ["Mensualité", montant(c.mensualite, "/mois")]]))));
    }
    if (id === "protection") {
      const l = protectionLue(pr);
      const lignes = d => [["Prévoyance (décès, invalidité) au-delà de celle de l'employeur", ouiNon(d.prevoyance)], ["Assurance emprunteur sur les crédits", ouiNon(d.emprunteur)]];
      if (l.forme === "foyer") return dl(lignes(l.decl));
      return groupe(Object.keys(l.parPersonne).map(k => bloc(nomDe(pr, k), lignes(l.parPersonne[k]))));
    }
    if (id === "autres") {
      const a = pr.autres || {};
      return groupe(ks.map(k => bloc(nomDe(pr, k), [["Voiture, meubles…", montant0(a[k] && a[k].usage)], ["Parts d'entreprise", montant0(a[k] && a[k].entreprise)]])));
    }
    return "";
  }

  /** Phrase prête du « Compléter avec Claude » d'une section (ClaudePrompts.phrase), section « bilan » pour l'en-tête (id absent). */
  function phraseSection(id) {
    const P = prompts(), s = SECTIONS.find(x => x.id === id);
    const section = s ? s.claude : "bilan", contexte = s ? s.contexte : undefined;
    return P ? P.phrase(section, contexte) : "Boussole : aide-moi à compléter mon profil" + (s ? " (" + s.titre.toLowerCase() + ")" : "") + ".";
  }
  /** Bouton « Compléter avec Claude » d'une section (ou de l'en-tête, id absent). U = UI. */
  const claudeHtml = (id, U) => (U && typeof U.demanderAClaude === "function" ? U.demanderAClaude(phraseSection(id), "Compléter avec Claude") : "");

  const PURE = { completude, SECTIONS, sectionDemandee, aCredit, protectionLue, resumeFoyer, resumeRevenus, resumeBiens, resumeCredits, resumeProtection, resumeAutres,
    resumes, phraseSection, sectionHtml, claudeHtml };
  if (typeof module === "object" && module.exports) module.exports = PURE;
  if (typeof document === "undefined") return;

  /* ---------- vue ---------- */
  let root = null, S = null, dirty = true;
  const sig = {}; // dernier HTML écrit par emplacement : rien n'est réécrit (ni le focus perdu) quand il n'a pas changé
  const $ = id => root.querySelector("#" + id);
  const CLES = { foyer: "Foyer", revenus: "Revenus", biens: "Biens", credits: "Credits", protection: "Protection", autres: "Autres" };
  const ecrire = (id, h) => { const el = $(id); if (el && sig[id] !== h) { sig[id] = h; el.innerHTML = h; } };
  const texte = (id, t) => { const el = $(id); if (el && el.textContent !== t) el.textContent = t; };
  const pret = () => !!S && (S.profilLoaded || S.dbOk === false);

  function render() {
    if (!root || !S) return;
    const C = window.Calc, U = window.UI, pr = S.profil || null, prC = pr || {};
    const cp = completude(S), pct = cp.pourcentage;
    texte("pfPct", pct + " %");
    $("pfBar").setAttribute("style", "width:" + pct + "%");
    texte("pfMissing", !pret() ? "" : cp.incompletes.length ? "À compléter : " + cp.incompletes.map(m => m.charAt(0).toLowerCase() + m.slice(1)).join(", ") + "."
      : "Tout est renseigné. Aujourd'hui, Patrimoine, Pilotage et les simulations utilisent ces chiffres.");
    const pat = C.patrimoine(S.positions || [], prC, "foyer"), rev = C.revenusFoyer(prC, "foyer"), mens = C.mensualites(prC, "foyer");
    ecrire("pfRecap", [
      ["Patrimoine net du foyer", eur(pat.net), "dont " + eur(pat.financier) + " suivis dans tes placements"],
      ["Revenus du foyer", eur(rev) + "/mois", "nets avant impôt, loyers compris"],
      ["Mensualités de crédit", eur(mens) + "/mois", rev > 0 ? Math.round(mens / rev * 100) + " % des revenus" : "—"],
    ].map(([l, v, s]) => '<div class="pf-kpi"><span>' + esc(l) + "</span><b>" + esc(v) + "</b><em>" + esc(s) + "</em></div>").join(""));
    ecrire("pfClaude", claudeHtml(null, U));
    const r = resumes(pr, C);
    SECTIONS.forEach(s => {
      const k = CLES[s.id];
      texte("pfRes" + k, r[s.id]);
      ecrire("pfLu" + k, sectionHtml(s.id, pr, C));
      ecrire("pfClaude" + k, claudeHtml(s.id, U));
    });
  }

  /* ---------- ouverture d'une section (lien profond) ---------- */
  function ouvrirSection(id) {
    const d = $("pf-sec-" + id);
    if (!d) return;
    d.setAttribute("open", "");
    const s = d.querySelector("summary");
    if (typeof d.scrollIntoView === "function") d.scrollIntoView({ block: "start" });
    if (s) { try { s.focus({ preventScroll: true }); } catch (e) { s.focus(); } }
  }

  function mount(r) { root = r; }
  function update(snap, visible) { S = snap; dirty = true; if (visible) { render(); dirty = false; } }
  /* La coque appelle show() puis pose éventuellement le focus sur le titre de page et remonte en haut : la section demandée
     est donc ouverte au tour suivant, pour garder le défilement et le focus sur elle. */
  function show() {
    if (dirty) { render(); dirty = false; }
    const p = window.App && typeof App.parametres === "function" ? App.parametres() : {};
    const sec = sectionDemandee(p);
    if (sec) setTimeout(() => ouvrirSection(sec), 0);
  }
  function headline() {
    if (!S || !(S.profilLoaded || S.dbOk === false)) return "–";
    return S.profil ? completude(S).pourcentage + " % rempli" : "À remplir";
  }
  const api = { mount, update, show, headline };
  const reg = () => App.register("profil", api); if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
