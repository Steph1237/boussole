/* Compte › Données (module « profil ») : la saisie à la main, alternative à l'agent (revenus, foyer, immobilier, crédits,
   protection, autres biens). On édite un brouillon ; « Enregistrer le profil » l'écrit dans profil/main (même écriture
   complète qu'avant : db.doc("profil/main").set(data), la protection { prevoyance, emprunteur } y voyage avec le reste).
   En tête : taux de remplissage, ce qui manque, « Remplir avec mon assistant », « Demander à Claude », récapitulatif.
   Puis six sections en accordéons fermés (Foyer, Revenus, Biens immobiliers, Crédits, Protection, Autres biens), chacune avec une
   ligne de résumé dans son titre (« 2 adultes, 1 enfant, TMI 30 % »), tenue à jour pendant la saisie.
   Lien profond : #compte/donnees?section=foyer|revenus|biens|credits|protection|autres (la coque retient le paramètre,
   App.parametres(), lu une fois au show()) : la section s'ouvre, défile en vue et son titre reçoit le focus.
   Fonctions pures exportées pour les tests (module.exports) : SECTIONS, sectionDemandee, valeurSeg, normalize, aCredit,
   resumeFoyer, resumeRevenus, resumeBiens, resumeCredits, resumeProtection, resumeAutres, resumes. */
(function () {
  "use strict";

  /* ---------- logique pure ---------- */
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const eur = v => nf.format(Math.round(v || 0)) + " €";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const num = v => (v == null || v === "" || !isFinite(+v) ? 0 : +v);
  const vide = v => v == null || v === "";
  const s_ = k => (k > 1 ? "s" : "");
  const objet = v => v != null && typeof v === "object" && !Array.isArray(v);

  const EMPTY = {
    foyer: { adultes: 2, enfants: 0, enfants14: 0, union: "joint", age: null, tmi: null },
    personnes: {
      p1: { nom: "Moi", salaire: null, salaireUnite: "nm", statut: null, csp: "", essai: false, autresRevenus: 0 },
      p2: { nom: "Conjoint(e)", salaire: null, salaireUnite: "nm", statut: null, csp: "", essai: false, autresRevenus: 0 },
    },
    biens: [], credits: [],
    autres: { p1: { usage: 0, entreprise: 0 }, p2: { usage: 0, entreprise: 0 } },
    protection: {},
  };
  const DEFAULT_NOMS = { p1: "Moi", p2: "Conjoint(e)" };

  /** Brouillon de saisie à partir du profil du store (null → profil vide). La protection est conservée telle quelle. */
  function normalize(p) {
    const d = clone(EMPTY);
    if (!p) return d;
    Object.assign(d.foyer, p.foyer || {});
    ["p1", "p2"].forEach(k => { Object.assign(d.personnes[k], (p.personnes || {})[k] || {}); Object.assign(d.autres[k], (p.autres || {})[k] || {}); });
    d.biens = clone(p.biens || []); d.credits = clone(p.credits || []);
    d.protection = objet(p.protection) ? clone(p.protection) : {};
    if (p.updatedAt) d.updatedAt = p.updatedAt;
    d.__saved = true;
    return d;
  }

  const SECTIONS = [
    { id: "foyer", titre: "Foyer" }, { id: "revenus", titre: "Revenus" }, { id: "biens", titre: "Biens immobiliers" },
    { id: "credits", titre: "Crédits" }, { id: "protection", titre: "Protection" }, { id: "autres", titre: "Autres biens" },
  ];
  const ALIAS = { immobilier: "biens", bien: "biens", credit: "credits", personnes: "revenus", salaires: "revenus", prevoyance: "protection" };
  /** Section demandée par le lien profond ({ section: "biens" } → "biens") ; inconnue ou absente → null. */
  function sectionDemandee(params) {
    const s = String((params && params.section) || "").trim().toLowerCase();
    if (!s) return null;
    const id = ALIAS[s] || s;
    return SECTIONS.some(x => x.id === id) ? id : null;
  }
  /** Valeur d'un bouton segmenté : "true" / "false" → booléen, nombre → nombre, sinon le texte. */
  const valeurSeg = raw => (raw === "true" ? true : raw === "false" ? false : /^-?\d+(\.\d+)?$/.test(raw) ? +raw : raw);

  const deuxAdultes = pr => num(pr && pr.foyer && pr.foyer.adultes) >= 2;
  const personnesDe = pr => (deuxAdultes(pr) ? ["p1", "p2"] : ["p1"]);
  const nomDe = (pr, k) => String((pr && pr.personnes && pr.personnes[k] && pr.personnes[k].nom) || "").trim() || DEFAULT_NOMS[k];
  /** Un crédit est en cours (prêt immobilier sur un bien ou autre crédit) : reste dû ou mensualité positifs. */
  const aCredit = pr => [].concat((pr && pr.biens) || [], (pr && pr.credits) || []).some(x => x && (num(x.crd) > 0 || num(x.mensualite) > 0));

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
  /** « 1 crédit, 6 500 € restants, 210 €/mois » ; « aucun » (ou « aucun en dehors des prêts immobiliers »). */
  function resumeCredits(pr) {
    const L = ((pr && pr.credits) || []).filter(Boolean);
    if (!L.length) return ((pr && pr.biens) || []).some(b => b && (num(b.crd) > 0 || num(b.mensualite) > 0)) ? "aucun en dehors des prêts immobiliers" : "aucun";
    const crd = L.reduce((a, c) => a + num(c.crd), 0), m = L.reduce((a, c) => a + num(c.mensualite), 0);
    return L.length + " crédit" + s_(L.length) + ", " + eur(crd) + " restant" + s_(crd) + ", " + eur(m) + "/mois";
  }
  /** Déclaration du foyer (profil.protection.prevoyance / emprunteur, booléens) : « prévoyance en place, sans assurance emprunteur »,
      « non renseignée » ; l'assurance emprunteur n'est citée qu'avec un crédit ou si elle est déclarée. */
  function resumeProtection(pr) {
    const d = objet(pr && pr.protection) ? pr.protection : {};
    const lu = (v, oui, non) => (v === true ? oui : v === false ? non : null);
    const p = lu(d.prevoyance, "prévoyance en place", "sans prévoyance"), e = lu(d.emprunteur, "assurance emprunteur en place", "sans assurance emprunteur");
    if (p == null && e == null) return "non renseignée";
    const out = [p || "prévoyance à renseigner"];
    if (e || aCredit(pr)) out.push(e || "assurance emprunteur à renseigner");
    return out.join(", ");
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

  const PURE = { SECTIONS, sectionDemandee, valeurSeg, normalize, aCredit, resumeFoyer, resumeRevenus, resumeBiens, resumeCredits, resumeProtection, resumeAutres, resumes };
  if (typeof module === "object" && module.exports) module.exports = PURE;
  if (typeof document === "undefined") return;

  /* ---------- vue ---------- */
  let root = null, S = null, draft = null, base = null, dirty = false, saving = false, remoteChanged = false, formStale = true;
  const $ = id => root.querySelector("#" + id);
  const attr = (el, n) => (el && el.getAttribute ? el.getAttribute(n) : null);
  const nomOf = k => nomDe(draft, k);
  const deOf = k => window.Calc.deNom(nomOf(k), k === "p2" ? 2 : 1);

  /* ---------- chemins « a.b.0.c » ---------- */
  const getP = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
  function setP(o, path, v) { const ks = path.split("."); let a = o; ks.slice(0, -1).forEach(k => { if (a[k] == null) a[k] = {}; a = a[k]; }); a[ks[ks.length - 1]] = v; }

  /* ---------- briques de formulaire (libellés internes, données échappées) ---------- */
  const seg = (path, opts, label) => {
    const cur = getP(draft, path);
    return '<div class="pf-field"><span class="lbl">' + label + '</span><div class="seg" role="group" aria-label="' + esc(label) + '">' +
      opts.map(([v, t]) => '<button type="button" data-seg="' + path + '" data-v="' + esc(v) + '" aria-pressed="' + String(cur != null && String(cur) === String(v)) + '">' + t + "</button>").join("") + "</div></div>";
  };
  const money = (path, label, unit, extra) => {
    const v = getP(draft, path); const id = "pf-" + path.replace(/\./g, "-");
    return '<div class="pf-field' + (extra || "") + '"><label class="lbl" for="' + id + '">' + label + '</label><div class="money"><input id="' + id + '" data-f="' + path + '" data-t="num" type="number" inputmode="decimal" min="0" step="any" value="' + (vide(v) ? "" : esc(v)) + '"><span class="u">' + unit + "</span></div></div>";
  };
  const text = (path, label, ph, extra) => {
    const id = "pf-" + path.replace(/\./g, "-");
    return '<div class="pf-field' + (extra || "") + '"><label class="lbl" for="' + id + '">' + label + '</label><input class="plain" id="' + id + '" data-f="' + path + '" type="text" value="' + esc(getP(draft, path) || "") + '" placeholder="' + esc(ph || "") + '"></div>';
  };
  const select = (path, label, opts, extra, attrs) => {
    const id = "pf-" + path.replace(/\./g, "-"), cur = getP(draft, path) ?? "";
    return '<div class="pf-field' + (extra || "") + '"><label class="lbl" for="' + id + '">' + label + '</label><select class="plain" id="' + id + '" data-f="' + path + '"' + (attrs || "") + ">" +
      opts.map(([v, t]) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select></div>";
  };

  const CSP = [["", "Non précisée"], ["cadre", "Cadre"], ["inter", "Profession intermédiaire"], ["empl", "Employé"], ["ouv", "Ouvrier"], ["indep", "Artisan, commerçant, chef d'entreprise"], ["liber", "Profession libérale"], ["agri", "Agriculteur"], ["inact", "Autre inactif"]];
  const UNITS = [["nm", "net / mois"], ["na", "net / an"], ["bm", "brut / mois"], ["ba", "brut / an"]];
  const OUI_NON = [["true", "oui"], ["false", "non"]];

  function renderForm() {
    const f = draft.foyer, kids = +f.enfants || 0;
    $("pfFoyer").innerHTML =
      seg("foyer.adultes", [[1, "1"], [2, "2"], [3, "3 +"]], "Adultes") +
      seg("foyer.enfants", [[0, "0"], [1, "1"], [2, "2"], [3, "3"], [4, "4 +"]], "Enfants") +
      (kids > 0 ? seg("foyer.enfants14", Array.from({ length: kids + 1 }, (_, i) => [i, String(i)]), "Dont 14 ans ou plus") : "") +
      (+f.adultes >= 2 ? seg("foyer.union", [["joint", "marié ou pacsé"], ["sep", "union libre"]], "Le couple est") : "") +
      seg("foyer.age", [["u30", "&lt; 30"], ["a30", "30-39"], ["a40", "40-49"], ["a50", "50-59"], ["a60", "60-69"], ["a70", "70 +"]], "Âge de la personne qui gagne le plus") +
      seg("foyer.tmi", [[0, "0 %"], [11, "11 %"], [30, "30 %"], [41, "41 %"], [45, "45 %"]], "Tranche marginale d'imposition");

    const two = +f.adultes >= 2;
    const people = two ? ["p1", "p2"] : ["p1"];
    $("pfPeople").innerHTML = people.map(k => {
      const p = "personnes." + k, u = getP(draft, p + ".salaireUnite") || "nm";
      return '<div class="pf-person"><h3 data-nom="' + k + '">' + esc(nomOf(k)) + "</h3>" +
        text(p + ".nom", "Prénom", DEFAULT_NOMS[k]) +
        '<div class="pf-field"><label class="lbl" for="pf-' + k + '-sal">Salaire</label><div class="money"><input id="pf-' + k + '-sal" data-f="' + p + '.salaire" data-t="num" type="number" inputmode="decimal" min="0" step="any" value="' + esc(getP(draft, p + ".salaire") ?? "") + '">' +
        '<select data-f="' + p + '.salaireUnite" aria-label="Unité du salaire">' + UNITS.map(([v, t]) => '<option value="' + v + '"' + (v === u ? " selected" : "") + ">" + t + "</option>").join("") + "</select></div></div>" +
        seg(p + ".statut", [["cadre", "cadre"], ["nc", "non-cadre"]], "Statut") +
        select(p + ".csp", "Catégorie professionnelle", CSP) +
        '<label class="chk"><input type="checkbox" data-f="' + p + '.essai"' + (getP(draft, p + ".essai") ? " checked" : "") + "> En période d'essai</label>" +
        money(p + ".autresRevenus", "Autres revenus imposables", "€ / mois") + "</div>";
    }).join("");

    renderBiensNote();
    const BI = draft.biens;
    $("pfBiens").innerHTML = BI.length ? BI.map((b, i) => {
      const p = "biens." + i, warn = +b.crd > +b.valeur && +b.valeur > 0;
      return '<div class="pf-row" data-row="biens" data-i="' + i + '">' + text(p + ".nom", "Nom", "ex. Studio Lyon 7e", " pf-wide") +
        select(p + ".usage", "Usage", [["rp", "Résidence principale"], ["locatif", "Locatif"], ["secondaire", "Secondaire"]]) +
        money(p + ".valeur", "Valeur", "€") + (two ? money(p + ".part_p1", 'Part <span data-de="p1">' + esc(deOf("p1")) + "</span>", "%") : "") + money(p + ".crd", "Reste à rembourser", "€") +
        money(p + ".mensualite", "Mensualité", "€/mois") + money(p + ".loyer", "Loyer perçu", "€/mois") +
        '<button type="button" class="del" data-pf-del="biens" data-i="' + i + '">Retirer</button>' +
        (warn ? '<div class="pf-note">Le reste à rembourser dépasse la valeur du bien.</div>' : "") + "</div>";
    }).join("") : '<div class="pf-empty">Aucun bien. Si vous êtes locataires, laissez vide : le profil est quand même considéré comme renseigné une fois enregistré.</div>';

    const CR = draft.credits;
    $("pfCredits").innerHTML = CR.length ? CR.map((c, i) => {
      const p = "credits." + i;
      return '<div class="pf-row" data-row="credits" data-i="' + i + '">' + text(p + ".nom", "Nom", "ex. Prêt auto", " pf-wide") +
        select(p + ".owner", "Titulaire", [["p1", nomOf("p1")]].concat(two || c.owner === "p2" ? [["p2", nomOf("p2")]] : [], [["commun", "Commun"]]), "", " data-pf-owner") +
        money(p + ".crd", "Reste à rembourser", "€") + money(p + ".mensualite", "Mensualité", "€/mois") +
        '<button type="button" class="del" data-pf-del="credits" data-i="' + i + '">Retirer</button></div>';
    }).join("") : '<div class="pf-empty">Aucun autre crédit.</div>';

    $("pfProtection").innerHTML =
      seg("protection.prevoyance", OUI_NON, "Une prévoyance (décès, invalidité) au-delà de celle de l'employeur") +
      seg("protection.emprunteur", OUI_NON, "Une assurance emprunteur sur les crédits");

    $("pfAutres").innerHTML = people.map(k => {
      const a = "autres." + k;
      return '<div class="pf-person"><h3 data-nom="' + k + '">' + esc(nomOf(k)) + "</h3>" +
        '<div class="pf-2">' + money(a + ".usage", "Voiture, meubles…", "€") + money(a + ".entreprise", "Parts d'entreprise", "€") + "</div></div>";
    }).join("");
  }

  function renderBiensNote() {
    $("pfBiensNote").textContent = "Valeur estimée aujourd'hui" + (+draft.foyer.adultes >= 2 ? " · la part " + deOf("p2") + " est le complément à 100 %" : "");
  }

  /* ---------- état, récapitulatif et résumés des sections ---------- */
  const RES_IDS = { foyer: "pfResFoyer", revenus: "pfResRevenus", biens: "pfResBiens", credits: "pfResCredits", protection: "pfResProtection", autres: "pfResAutres" };
  function renderResumes() {
    const r = resumes(forCalc(), window.Calc);
    Object.keys(RES_IDS).forEach(k => { const el = $(RES_IDS[k]); if (el && el.textContent !== r[k]) el.textContent = r[k]; });
  }
  function renderStatus() {
    const C = window.Calc, pr = forCalc();
    const pct = draft.__saved || dirty ? C.completude(pr) : 0;
    $("pfPct").textContent = pct + " %";
    $("pfBar").setAttribute("style", "width:" + pct + "%");
    const miss = C.manquants(pr);
    $("pfMissing").textContent = miss.length ? "À compléter : " + miss.map(m => m.charAt(0).toLowerCase() + m.slice(1)).join(", ") + "." : "Tout est renseigné. Aujourd'hui, Patrimoine, Pilotage et les simulations utilisent ces chiffres.";
    const pos = S ? S.positions || [] : [];
    const pat = C.patrimoine(pos, pr, "foyer"), rev = C.revenusFoyer(pr, "foyer"), mens = C.mensualites(pr, "foyer");
    $("pfRecap").innerHTML = [
      ["Patrimoine net du foyer", eur(pat.net), "dont " + eur(pat.financier) + " suivis dans vos placements"],
      ["Revenus du foyer", eur(rev) + "/mois", "nets avant impôt, loyers compris"],
      ["Mensualités de crédit", eur(mens) + "/mois", rev > 0 ? Math.round(mens / rev * 100) + " % des revenus" : "—"],
    ].map(([l, v, s]) => '<div class="pf-kpi"><span>' + esc(l) + "</span><b>" + esc(v) + "</b><em>" + esc(s) + "</em></div>").join("");
    renderResumes();
    renderMsgs();
  }
  function forCalc() { const p = clone(draft); delete p.__saved; return p; }

  function renderMsgs(extra) {
    const v = window.Calc.valider(forCalc()), out = [];
    v.erreurs.forEach(e => out.push(["err", e]));
    v.avertissements.forEach(w => out.push(["warn", w]));
    if (remoteChanged && dirty) out.push(["warn", "Le profil a été modifié ailleurs pendant votre saisie. Enregistrer remplacera cette version."]);
    if (extra) out.push(extra);
    if (!out.length) out.push(dirty ? ["", "Modifications non enregistrées."] : [draft.updatedAt ? "ok" : "", draft.updatedAt ? "Enregistré le " + new Date(draft.updatedAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + "." : "Rien n'est encore enregistré."]);
    $("pfMsgs").innerHTML = out.map(([c, t]) => '<span class="' + c + '">' + esc(t) + "</span>").join("");
    $("pfSubmit").disabled = saving || !!v.erreurs.length || !(S && S.dbOk);
    $("pfCancel").hidden = !dirty;
  }

  function touch() { dirty = true; renderStatus(); }

  /* ---------- ouverture d'une section (lien profond) ---------- */
  function ouvrirSection(id) {
    const d = $("pf-sec-" + id);
    if (!d) return;
    d.setAttribute("open", "");
    const s = d.querySelector("summary");
    if (typeof d.scrollIntoView === "function") d.scrollIntoView({ block: "start" });
    if (s) { try { s.focus({ preventScroll: true }); } catch (e) { s.focus(); } }
  }

  /* ---------- interactions ---------- */
  function mount(r) {
    root = r;
    draft = normalize(null); base = null;
    const u = window.UI;
    if (u) $("pfClaude").innerHTML = u.demanderAClaude("Aide-moi à compléter mes données dans Boussole (foyer, revenus, biens immobiliers, crédits, protection) : pose-moi les questions qui manquent.");
    root.addEventListener("input", e => {
      const el = e.target && e.target.closest ? e.target.closest("[data-f]") : null; if (!el) return;
      const path = attr(el, "data-f");
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (attr(el, "data-t") === "num") v = v === "" ? null : Math.max(0, +v);
      setP(draft, path, v);
      const nm = /^personnes\.(p[12])\.nom$/.exec(path);
      if (nm) { // le prénom se répercute sans reconstruire le formulaire (le champ garde le focus)
        const k = nm[1];
        root.querySelectorAll('[data-nom="' + k + '"]').forEach(x => { x.textContent = nomOf(k); });
        root.querySelectorAll('[data-de="' + k + '"]').forEach(x => { x.textContent = deOf(k); });
        root.querySelectorAll("select[data-pf-owner]").forEach(s => s.querySelectorAll('option[value="' + k + '"]').forEach(x => { x.textContent = nomOf(k); }));
        if (k === "p2") renderBiensNote();
      }
      if (/^biens\.\d+\.(crd|valeur)$/.test(path)) { const row = el.closest(".pf-row"); const b = getP(draft, path.replace(/\.(crd|valeur)$/, "")); let n = row.querySelector(".pf-note"); const warn = +b.crd > +b.valeur && +b.valeur > 0; if (warn && !n) { n = document.createElement("div"); n.className = "pf-note"; n.textContent = "Le reste à rembourser dépasse la valeur du bien."; row.appendChild(n); } else if (!warn && n) n.remove(); }
      touch();
    });
    root.addEventListener("click", e => {
      const t = e.target; if (!t || !t.closest) return;
      const s = t.closest("[data-seg]");
      if (s) {
        const path = attr(s, "data-seg"), raw = attr(s, "data-v");
        setP(draft, path, valeurSeg(raw));
        if (path === "foyer.enfants" && +draft.foyer.enfants14 > +draft.foyer.enfants) draft.foyer.enfants14 = +draft.foyer.enfants;
        renderForm(); touch();
        // le formulaire est reconstruit : le focus revient au bouton choisi
        const again = Array.from(root.querySelectorAll('[data-seg="' + path + '"]')).find(x => attr(x, "data-v") === raw);
        if (again) again.focus();
        return;
      }
      const add = t.closest("[data-pf-add]");
      if (add) {
        const k = attr(add, "data-pf-add");
        draft[k].push(k === "biens" ? { id: uid(), nom: "", usage: "rp", valeur: null, part_p1: +draft.foyer.adultes >= 2 ? 50 : 100, crd: 0, mensualite: 0, loyer: 0 } : { id: uid(), nom: "", owner: "commun", crd: null, mensualite: null });
        renderForm(); touch();
        const rows = $(k === "biens" ? "pfBiens" : "pfCredits").querySelectorAll(".pf-row"); const last = rows[rows.length - 1];
        const champ = last && last.querySelector("input"); if (champ) champ.focus();
        return;
      }
      const del = t.closest("[data-pf-del]");
      if (del) {
        const k = attr(del, "data-pf-del");
        draft[k].splice(+attr(del, "data-i"), 1); renderForm(); touch();
        const b = root.querySelector('[data-pf-add="' + k + '"]'); if (b) b.focus();
      }
    });
    // Les <select> et cases à cocher déclenchent « change » ; on les traite comme une saisie.
    root.addEventListener("change", e => {
      const el = e.target; if (!el || !el.matches || !el.matches("select[data-f],input[type=checkbox][data-f]")) return;
      setP(draft, attr(el, "data-f"), el.type === "checkbox" ? el.checked : el.value); touch();
    });
    $("pfCancel").addEventListener("click", () => { draft = normalize(base); dirty = false; remoteChanged = false; renderForm(); renderStatus(); });
    $("pfSubmit").addEventListener("click", save);
    mountAssistant();
  }
  const uid = () => Math.random().toString(36).slice(2, 9);

  /* ---------- remplissage par assistant : le résultat va dans le brouillon, jamais directement en base ---------- */
  function mountAssistant() {
    const A = window.Assistant, dlg = $("pfAssist");
    if (!A || !dlg || !dlg.showModal) { const b = $("pfAssistBtn"); if (b) b.hidden = true; return; }
    let pending = null;
    const fmtV = v => v == null ? "—" : typeof v === "number" ? nf.format(v) : typeof v === "boolean" ? (v ? "oui" : "non") : typeof v === "object" ? "" : String(v);
    const UNIT = { nm: "net / mois", na: "net / an", bm: "brut / mois", ba: "brut / an" };
    const show = v => UNIT[v] || fmtV(v);
    $("pfAssistBtn").addEventListener("click", () => {
      $("pfPrompt").value = A.prompt("profil"); $("pfPaste").value = ""; $("pfPreview").innerHTML = ""; $("pfApply").disabled = true; pending = null;
      dlg.showModal();
    });
    $("pfCopy").addEventListener("click", async () => {
      const b = $("pfCopy");
      try { await navigator.clipboard.writeText($("pfPrompt").value); b.textContent = "Message copié"; }
      catch (e) { $("pfPrompt").select(); b.textContent = "Sélectionné : copiez avec Ctrl+C / ⌘C"; }
      setTimeout(() => { b.textContent = "Copier le message"; }, 2500);
    });
    $("pfRead").addEventListener("click", () => {
      const r = A.parse($("pfPaste").value, "profil");
      const out = [];
      r.erreurs.forEach(e => out.push('<p class="err">' + esc(e) + "</p>"));
      r.avertissements.forEach(w => out.push('<p class="warn">' + esc(w) + "</p>"));
      pending = null;
      if (r.data && !r.erreurs.length) {
        const m = A.merge(forCalc(), r.data);
        if (!m.changes.length) out.push("<p>La réponse ne change rien à votre profil.</p>");
        else {
          pending = m.profil;
          out.push("<p><b>" + m.changes.length + " changement" + (m.changes.length > 1 ? "s" : "") + "</b> à appliquer :</p><table>" +
            m.changes.map(c => c.kind === "ajout"
              ? '<tr><td class="add" colspan="3">+ ' + esc(c.label) + "</td></tr>"
              : "<tr><td>" + esc(c.label) + '</td><td class="n">' + esc(show(c.avant)) + '</td><td class="n">→ ' + esc(show(c.apres)) + "</td></tr>").join("") + "</table>");
        }
      }
      $("pfPreview").innerHTML = out.join("");
      $("pfApply").disabled = !pending;
    });
    $("pfApply").addEventListener("click", () => {
      if (!pending) return;
      const saved = draft.__saved; draft = pending; if (saved) draft.__saved = saved;
      pending = null; dlg.close(); renderForm(); touch();
      renderMsgs(["warn", "Réponse appliquée au formulaire. Vérifiez, puis cliquez sur « Enregistrer le profil »."]);
    });
  }

  async function save() {
    const db = window.Store.db; if (!db) return;
    const data = forCalc();
    const v = window.Calc.valider(data); if (v.erreurs.length) { renderMsgs(); return; }
    ["biens", "credits"].forEach(k => data[k] = data[k].map(x => Object.assign({}, x, { nom: (x.nom || "").trim() || (k === "biens" ? "Bien" : "Crédit") })));
    data.updatedAt = new Date().toISOString();
    saving = true; renderMsgs(["", "Enregistrement…"]);
    try {
      await db.doc("profil/main").set(data);
      dirty = false; remoteChanged = false; draft = normalize(data); base = clone(data);
      saving = false; renderForm(); renderStatus(); renderMsgs(["ok", "Données enregistrées. Aujourd'hui, Patrimoine, Pilotage et les simulations sont à jour."]);
    } catch (e) {
      saving = false;
      renderMsgs(["err", e && e.code === "invalid_argument" ? "Enregistrement refusé : vous n'avez pas les droits d'écriture sur ce tableau de bord." : "Enregistrement impossible pour le moment (" + (e && e.code || "erreur") + "). Votre saisie est conservée : réessayez dans un instant."]);
    }
  }

  function update(snap, visible) {
    const prev = S; S = snap;
    if (snap.profilLoaded || snap.dbOk === false) {
      const changed = JSON.stringify(snap.profil) !== JSON.stringify(base);
      if (changed) {
        if (dirty && prev) remoteChanged = true;
        else { draft = normalize(snap.profil); base = snap.profil ? clone(snap.profil) : null; if (visible) renderForm(); else formStale = true; }
      }
    }
    if (visible) { if (formStale) { renderForm(); formStale = false; } renderStatus(); }
  }
  /* La coque appelle show() puis pose éventuellement le focus sur le titre de page et remonte en haut : la section demandée
     est donc ouverte au tour suivant, pour garder le défilement et le focus sur elle. */
  function show() {
    if (formStale) { renderForm(); formStale = false; }
    renderStatus();
    const p = window.App && typeof App.parametres === "function" ? App.parametres() : {};
    const sec = sectionDemandee(p);
    if (sec) setTimeout(() => ouvrirSection(sec), 0);
  }
  function headline() {
    if (!S || !(S.profilLoaded || S.dbOk === false)) return "–";
    return S.profil ? window.Calc.completude(S.profil) + " % rempli" : "À remplir";
  }
  const api = { mount, update, show, headline };
  const reg = () => App.register("profil", api); if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
