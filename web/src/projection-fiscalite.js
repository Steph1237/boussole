/* Fiscalité de sortie du moteur de projection (PROJ, spec § 5.2 et § 6.3) : « net d'impôts si tu retirais tout à cette date »,
   règles par type d'enveloppe, taux lus dans les repères sourcés (jamais de valeur de secours : un repère manquant rend la règle
   indisponible et le compartiment reste en brut, avec la mention). Pur, sans DOM, au tutoiement. Global ProjectionFiscalite.
   Un compartiment fiscal : { type, valeur, base, classe, date_ouverture?, date_achat?, versements_deduits?, dates?, base_inconnue? }
   (dates : { pea_5_ans, av_8_ans, pee_disponible } issues de Calendrier.calendrier, sinon calculées depuis date_ouverture).
   ctx : { reperes (liste ou index), couple, abattement_restant, primes_titulaire, tmi_pct, per_versements_deduits }. */
(function (root, factory) {
  const O = typeof module === "object" && module.exports ? require("./projection-outils.js") : root.ProjectionOutils;
  const api = factory(O);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ProjectionFiscalite = api;
})(typeof self !== "undefined" ? self : this, function (O) {
  "use strict";

  const PEA = ["pea", "pea_pme", "pea_jeune"], AV = ["assurance_vie", "capitalisation"], LIVRETS = ["livret_a", "ldds", "lep"];
  const MENTION_SCPI = "parts de SCPI : régime des plus-values immobilières (CGI art. 150 UB et 239 septies), à confirmer";

  /** Index des repères d'un contexte (liste ou index déjà fait). */
  const indexDe = r => (Array.isArray(r) ? O.indexReperes(r) : r || {});

  /** Lecteur de repères : v(cle) → nombre ou undefined, et la liste des repères utilisés / manquants. */
  function lecteur(reperes) {
    const idx = indexDe(reperes), utilises = new Map(), manquants = new Set();
    const lire = cle => {
      const r = idx[cle];
      if (!r) { manquants.add(cle); return undefined; }
      utilises.set(cle, r);
      return +r.valeur;
    };
    return { lire, utilises, manquants, idx };
  }

  /* ------------------------------------------------------------------ abattements des plus-values immobilières (service-public F10864) */
  /** Années pleines de détention entre deux dates. */
  const anneesPleines = (achat, date) => O.age(achat, date);
  function abattementIR(ans) { // 6 % par an de la 6e à la 21e année, 4 % la 22e
    if (ans < 6) return 0;
    if (ans >= 22) return 1;
    return Math.min(1, 0.06 * (Math.min(ans, 21) - 5));
  }
  function abattementPS(ans) { // 1,65 % par an de la 6e à la 21e, 1,60 % la 22e, 9 % par an de la 23e à la 30e
    if (ans < 6) return 0;
    if (ans >= 30) return 1;
    let a = 0.0165 * (Math.min(ans, 21) - 5);
    if (ans >= 22) a += 0.016;
    if (ans >= 23) a += 0.09 * (Math.min(ans, 30) - 22);
    return Math.min(1, a);
  }

  /* ------------------------------------------------------------------ dates des seuils d'une enveloppe */
  /** Dates à partir desquelles la règle « après » s'applique : { pea_5_ans, av_8_ans, pee_disponible } (ISO) ou null si inconnue. */
  function datesSeuils(c, lire) {
    const out = { pea_5_ans: null, av_8_ans: null, pee_disponible: null };
    const d = c.dates || {};
    out.pea_5_ans = d.pea_5_ans || null;
    out.av_8_ans = d.av_8_ans || null;
    out.pee_disponible = d.pee_disponible || null;
    const ouverture = c.date_ouverture && O.estDate(c.date_ouverture) ? c.date_ouverture : null;
    if (!out.pea_5_ans && ouverture && PEA.includes(c.type)) {
      const n = lire("pea_duree_ans");
      if (n != null) out.pea_5_ans = O.ajouterJours(O.ajouterAns(ouverture, n), 1);
    }
    if (!out.av_8_ans && ouverture && AV.includes(c.type)) {
      const n = lire("av_duree_ans");
      if (n != null) out.av_8_ans = O.ajouterJours(O.ajouterAns(ouverture, n), 1);
    }
    return out;
  }

  /* ------------------------------------------------------------------ règles */
  /** Prépare les paramètres fiscaux statiques d'un compartiment : { regle, indisponible, mentions, sources, calculer(valeur, base, date, abat) }.
      `calculer` renvoie { ir, ps, abat_utilise } pour une sortie totale de `valeur` (base `base`) à `date`, avec `abat` = abattement
      annuel restant de l'assurance-vie. Les parts proportionnelles sont recalculées à chaque appel, pour les retraits partiels. */
  function preparer(c, ctx) {
    const x = ctx || {}, L = lecteur(x.reperes), lire = L.lire;
    const mentions = [];
    const res = { type: c.type, regle: null, indisponible: false, confiance: "sure", mentions, disponible: true, proportionnel: true, calculer: null, reperes: L };
    const indispo = (pourquoi, cles) => {
      res.indisponible = true; res.regle = "indisponible";
      mentions.push("repère manquant" + (cles && cles.length ? " (" + cles.join(", ") + ")" : "") + " : " + pourquoi + " ; montant laissé en brut");
      res.calculer = (v) => ({ ir: 0, ps: 0, abat_utilise: 0 });
      return res;
    };
    const exig = (...cles) => { const v = cles.map(lire); return v.some(z => z === undefined) ? null : v; };
    const gainDe = (v, b) => (c.base_inconnue ? 0 : Math.max(0, v - b));
    if (c.base_inconnue && !["courant", ...LIVRETS].includes(c.type)) mentions.push("prix de revient à compléter : aucun gain supposé, l'impôt est sous-estimé");
    const t = c.type, classe = c.classe;

    if (t === "courant") { res.regle = "sans_gain"; res.calculer = () => ({ ir: 0, ps: 0, abat_utilise: 0 }); return res; }
    if (LIVRETS.includes(t)) { res.regle = "exonere"; res.calculer = () => ({ ir: 0, ps: 0, abat_utilise: 0 }); return res; }

    if (t === "pel" || t === "cel") {
      const r = exig("ir_taux_forfaitaire", "ps_taux_av_epargne_logement");
      if (!r) return indispo("taux de l'épargne logement", ["ir_taux_forfaitaire", "ps_taux_av_epargne_logement"].filter(k => !L.idx[k]));
      const [ir, ps] = r;
      res.regle = "epargne_logement";
      const ouv = c.date_ouverture && O.estDate(c.date_ouverture) ? c.date_ouverture : null;
      res.calculer = (v, b, date) => {
        const g = gainDe(v, b);
        let irTaux = ir;
        if (t === "pel" && ouv && ouv < "2018-01-01") { const n = lire("pel_exoneration_ir_ans"); if (n != null && date < O.ajouterAns(ouv, n)) irTaux = 0; }
        return { ir: g * irTaux / 100, ps: g * ps / 100, abat_utilise: 0 };
      };
      return res;
    }

    if (PEA.includes(t)) {
      const r = exig("ir_taux_forfaitaire", "ps_taux_general", "pea_duree_ans");
      if (!r) return indispo("règles du PEA", ["ir_taux_forfaitaire", "ps_taux_general", "pea_duree_ans"].filter(k => !L.idx[k]));
      const [ir, ps] = r, seuil = datesSeuils(c, lire).pea_5_ans;
      res.seuil = seuil;
      if (!seuil) { mentions.push("date d'ouverture à compléter : fiscalité d'avant 5 ans appliquée"); res.confiance = "probable"; }
      res.regle = "pea_avant_5_ans";
      res.calculer = (v, b, date) => {
        const g = gainDe(v, b), apres = seuil && date >= seuil;
        return { ir: apres ? 0 : g * ir / 100, ps: g * ps / 100, abat_utilise: 0, apres };
      };
      res.regleA = date => (seuil && date >= seuil ? "pea_apres_5_ans" : "pea_avant_5_ans");
      res.clotureAvant = true;
      return res;
    }

    if (AV.includes(t)) {
      const r = exig("ir_taux_forfaitaire", "ps_taux_av_epargne_logement", "av_duree_ans", "av_taux_ir_reduit", "av_seuil_versements", "av_abattement_seul", "av_abattement_couple");
      if (!r) return indispo("règles de l'assurance-vie", ["ir_taux_forfaitaire", "ps_taux_av_epargne_logement", "av_duree_ans", "av_taux_ir_reduit", "av_seuil_versements", "av_abattement_seul", "av_abattement_couple"].filter(k => !L.idx[k]));
      const [ir, ps, , irRed, seuilPrimes, abSeul, abCouple] = r, seuil = datesSeuils(c, lire).av_8_ans;
      res.seuil = seuil; res.proportionnel = false;
      if (!seuil) { mentions.push("date d'ouverture à compléter : fiscalité d'avant 8 ans appliquée"); res.confiance = "probable"; }
      const primes = x.primes_titulaire != null ? +x.primes_titulaire : c.base;
      res.abattementAnnuel = x.couple ? abCouple : abSeul;
      res.regle = "av_avant_8_ans";
      res.calculer = (v, b, date, abat) => {
        const g = gainDe(v, b), apres = seuil && date >= seuil;
        if (!apres) return { ir: g * ir / 100, ps: g * ps / 100, abat_utilise: 0, apres: false };
        const frac = primes > seuilPrimes ? seuilPrimes / primes : 1;
        const g75 = g * frac, g128 = g - g75;
        let reste = abat != null ? Math.max(0, abat) : res.abattementAnnuel;
        const a75 = Math.min(g75, reste); reste -= a75;
        const a128 = Math.min(g128, reste);
        return { ir: (g75 - a75) * irRed / 100 + (g128 - a128) * ir / 100, ps: g * ps / 100, abat_utilise: a75 + a128, apres: true, fraction_7_5: frac };
      };
      res.regleA = date => (seuil && date >= seuil ? "av_apres_8_ans" : "av_avant_8_ans");
      return res;
    }

    if (t === "per") {
      const r = exig("ir_taux_forfaitaire", "ps_taux_general");
      if (!r) return indispo("règles du PER", ["ir_taux_forfaitaire", "ps_taux_general"].filter(k => !L.idx[k]));
      const [ir, ps] = r;
      let tmi = x.tmi_pct;
      if (tmi == null || !isFinite(+tmi)) { tmi = 30; mentions.push("taux marginal supposé de 30 %, à confirmer avec Claude"); res.confiance = "probable"; }
      const deduit = x.per_versements_deduits === false ? 0 : (c.versements_deduits != null ? +c.versements_deduits : c.base);
      res.regle = "per_capital"; res.disponible = false;
      mentions.push("bloqué jusqu'à la retraite, sauf achat de la résidence principale");
      res.calculer = (v, b) => {
        const d = Math.min(v, deduit * (c.base > 0 ? Math.min(1, b / c.base) : 1)), g = gainDe(v, b);
        return { ir: d * tmi / 100 + g * ir / 100, ps: g * ps / 100, abat_utilise: 0 };
      };
      return res;
    }

    if (t === "pee" || t === "percol") {
      const r = exig("ps_taux_epargne_salariale");
      if (!r) return indispo("prélèvements sociaux de l'épargne salariale", ["ps_taux_epargne_salariale"]);
      res.regle = "epargne_salariale"; res.disponible = t === "pee";
      res.calculer = (v, b) => ({ ir: 0, ps: gainDe(v, b) * r[0] / 100, abat_utilise: 0 });
      return res;
    }

    if (t === "scpi_direct" || t === "bien_autre") {
      const r = exig("pv_immo_ir_taux", "pv_immo_ps_taux");
      if (!r) return indispo("plus-values immobilières", ["pv_immo_ir_taux", "pv_immo_ps_taux"].filter(k => !L.idx[k]));
      const [ir, ps] = r, achat = c.date_achat && O.estDate(c.date_achat) ? c.date_achat : null;
      res.regle = "pv_immobiliere";
      if (t === "scpi_direct") { res.confiance = "probable"; mentions.push(MENTION_SCPI); }
      if (!achat) mentions.push("date d'achat à compléter : aucun abattement pour durée de détention");
      const seuilSurtaxe = lire("pv_immo_surtaxe_seuil");
      res.calculer = (v, b, date) => {
        const g = gainDe(v, b), ans = achat ? anneesPleines(achat, date) : 0;
        const out = { ir: g * (1 - abattementIR(ans)) * ir / 100, ps: g * (1 - abattementPS(ans)) * ps / 100, abat_utilise: 0 };
        if (seuilSurtaxe != null && g * (1 - abattementIR(ans)) > seuilSurtaxe) out.surtaxe = true;
        return out;
      };
      res.disponible = t !== "scpi_direct";
      res.nonRetirable = true;
      return res;
    }

    if (t === "compte_titres" || t == null || t === "autre") {
      if (classe === "crypto") {
        const r = exig("ir_taux_forfaitaire", "ps_taux_actifs_numeriques");
        if (!r) return indispo("règles des actifs numériques", ["ir_taux_forfaitaire", "ps_taux_actifs_numeriques"].filter(k => !L.idx[k]));
        res.regle = "actifs_numeriques";
        res.calculer = (v, b) => { const g = gainDe(v, b); return { ir: g * r[0] / 100, ps: g * r[1] / 100, abat_utilise: 0 }; };
        return res;
      }
      if (t === "compte_titres") {
        const r = exig("ir_taux_forfaitaire", "ps_taux_general");
        if (!r) return indispo("règles du compte-titres", ["ir_taux_forfaitaire", "ps_taux_general"].filter(k => !L.idx[k]));
        res.regle = "pfu";
        res.calculer = (v, b) => { const g = gainDe(v, b); return { ir: g * r[0] / 100, ps: g * r[1] / 100, abat_utilise: 0 }; };
        return res;
      }
      return indispo("type d'enveloppe à compléter", []);
    }
    return indispo("type d'enveloppe non géré (" + t + ")", []);
  }

  /** Sources (titre, URL, vérifié le) des repères utilisés par une préparation. */
  function sourcesDe(prep) {
    return [...prep.reperes.utilises.entries()].map(([cle, r]) => ({ cle, titre: r.sourceTitre || null, url: r.sourceUrl || null, verifie_le: r.verifieLe || null }));
  }

  /** Fiscalité d'une sortie totale du compartiment à `date`.
      → { brut, impot_revenu, prelevements_sociaux, total, net, regle, disponible, sources, confiance, avertissements, abattement_utilise }.
      Repère manquant : net null, brut inchangé, regle « indisponible », jamais une valeur de secours. */
  function fiscaliteSortie(c, date, ctx) {
    const x = ctx || {}, prep = preparer(c, x), v = +c.valeur || 0, b = c.base != null ? +c.base : v;
    const o = prep.calculer(v, b, date, x.abattement_restant);
    const regle = prep.regleA ? prep.regleA(date) : prep.regle;
    const out = { brut: v, impot_revenu: O.arrondi2(o.ir), prelevements_sociaux: O.arrondi2(o.ps), total: O.arrondi2(o.ir + o.ps), net: null, regle,
      disponible: prep.disponible, sources: sourcesDe(prep), confiance: prep.indisponible ? "indisponible" : prep.confiance,
      avertissements: prep.mentions.slice(), abattement_utilise: o.abat_utilise || 0 };
    if (!prep.indisponible) out.net = O.arrondi2(v - o.ir - o.ps);
    if (o.fraction_7_5 != null) out.fraction_7_5 = o.fraction_7_5;
    if (o.surtaxe) out.avertissements.push("surtaxe sur les plus-values immobilières élevées : non calculée");
    return out;
  }

  /** Brut à retirer pour obtenir `net` (≤ net de la sortie totale), par résolution exacte pour les règles proportionnelles, dichotomie sinon. */
  function brutPourNet(prep, c, net, date, abat) {
    const v = +c.valeur, b = c.base != null ? +c.base : v;
    const tot = prep.calculer(v, b, date, abat);
    if (v - tot.ir - tot.ps <= net + 1e-9) return v;
    if (prep.proportionnel) return net / (1 - (tot.ir + tot.ps) / v);
    let lo = 0, hi = v;
    for (let k = 0; k < 60; k++) {
      const m = (lo + hi) / 2, f = m / v, o = prep.calculer(m, b * f, date, abat);
      if (m - o.ir - o.ps < net) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  /* ------------------------------------------------------------------ ordre de retrait (spec § 6.3) */
  const NIVEAU_JAMAIS = 99;
  /** Niveau de retrait d'un compartiment à `date` : 1 disponible au-dessus du matelas, 2 compte-titres / assurance-vie après 8 ans / PEA après 5 ans /
      épargne salariale disponible, 3 assurance-vie avant 8 ans, 4 PER (résidence principale seulement), 5 matelas (traité à part), 6 PEA avant 5 ans
      (si la clôture est autorisée), 99 jamais (bien immobilier, SCPI en direct, PERCOL, PER hors résidence principale). */
  function niveauRetrait(c, date, opts) {
    const o = opts || {}, p = c.prep, t = c.type;
    if (c.dispo) return 1;
    if (AV.includes(t)) return p.seuil && date >= p.seuil ? 2 : 3;
    if (PEA.includes(t)) return p.seuil && date >= p.seuil ? 2 : o.autoriser_cloture_pea ? 6 : NIVEAU_JAMAIS;
    if (t === "per") return o.rp ? 4 : NIVEAU_JAMAIS;
    if (t === "pee") return c.pee_disponible === false ? NIVEAU_JAMAIS : 2;
    if (t === "percol" || t === "scpi_direct" || t === "bien_autre" || p.nonRetirable) return NIVEAU_JAMAIS;
    return 2;
  }
  /** Retire `besoinNet` (net d'impôts) des compartiments dans l'ordre du § 6.3. comps : [{ id, enveloppe, type, valeur, base, dispo, prep }] (non modifiés).
      opts : { date, matelas, rp, autoriser_cloture_pea, abattement (restant de l'année), niveau_max (défaut 6) }. besoinNet peut être Infinity (mobilisable).
      → { sources: [{ id, enveloppe, niveau, brut, net, gain, impot_revenu, prelevements_sociaux, impots, cloture? }], net_obtenu, impots, manque, excedent_au_disponible, abattement_utilise, matelas_utilise }. */
  function planRetrait(comps, besoinNet, opts) {
    const o = opts || {}, date = o.date, max = o.niveau_max || 6;
    const L = comps.map(c => ({ c, v: +c.valeur || 0, b: c.base != null ? +c.base : +c.valeur || 0 }));
    const out = { sources: [], net_obtenu: 0, impots: 0, manque: 0, excedent_au_disponible: 0, abattement_utilise: 0, matelas_utilise: 0 };
    let abat = o.abattement != null ? o.abattement : null, reste = besoinNet;
    const ajoute = (x, niveau, brut, net, t, extra) => {
      const gain = x.v > 0 ? Math.max(0, x.v - x.b) * brut / x.v : 0;
      const ligne = out.sources.find(s => s.id === x.c.id && s.niveau === niveau);
      if (ligne) { ligne.brut += brut; ligne.net += net; ligne.gain += gain; ligne.impot_revenu += t.ir; ligne.prelevements_sociaux += t.ps; ligne.impots += t.ir + t.ps; return; }
      out.sources.push(Object.assign({ id: x.c.id, enveloppe: x.c.enveloppe, niveau, brut, net, gain, impot_revenu: t.ir, prelevements_sociaux: t.ps, impots: t.ir + t.ps }, extra || {}));
    };
    /* retire jusqu'à `net` du compartiment x ; renvoie le net obtenu */
    function prendre(x, net, niveau, tout) {
      if (!(x.v > 1e-9) || !(net > 0)) return 0;
      const prep = x.c.prep, vide = { ir: 0, ps: 0, abat_utilise: 0 };
      const pleine = prep.calculer(x.v, x.b, date, abat);
      let brut = tout || x.v - pleine.ir - pleine.ps <= net + 1e-9 ? x.v : brutPourNet(prep, { valeur: x.v, base: x.b }, net, date, abat);
      const f = brut / x.v, t = brut === x.v ? pleine : prep.calculer(brut, x.b * f, date, abat);
      const obtenu = brut - t.ir - t.ps;
      if (abat != null) abat -= t.abat_utilise || 0;
      out.abattement_utilise += t.abat_utilise || 0;
      ajoute(x, niveau, brut, obtenu, t, tout && niveau === 6 ? { cloture: true } : null);
      x.b -= x.b * f; x.v -= brut;
      if (x.v < 1e-9) { x.v = 0; x.b = 0; }
      return obtenu;
    }
    const coutDe = x => {
      const g = Math.min(x.v, isFinite(reste) ? Math.max(reste, 1) : x.v);
      if (!(g > 0)) return Infinity;
      const t = x.c.prep.calculer(g, x.b * g / x.v, date, abat);
      return (t.ir + t.ps) / Math.max(1e-9, g - t.ir - t.ps);
    };
    const dispos = L.filter(x => x.c.dispo);
    const dispoTotal = () => dispos.reduce((a, x) => a + x.v, 0);
    const M = Math.max(0, +o.matelas || 0);
    /* niveau 1 : disponible au-dessus du matelas */
    let autorise = Math.max(0, dispoTotal() - M);
    for (const x of dispos) {
      if (!(reste > 0) || !(autorise > 0)) break;
      const prise = Math.min(reste, autorise, Math.max(0, x.v));
      if (prise > 0) { x.v -= prise; ajoute(x, 1, prise, prise, { ir: 0, ps: 0 }); reste -= prise; autorise -= prise; out.net_obtenu += prise; }
    }
    for (const niveau of [2, 3, 4]) {
      if (niveau > max || !(reste > 0)) continue;
      const cand = L.filter(x => !x.c.dispo && x.v > 0 && niveauRetrait(x.c, date, o) === niveau).map((x, k) => ({ x, k, cout: coutDe(x) }))
        .sort((a, b) => a.cout - b.cout || a.k - b.k);
      for (const { x } of cand) { if (!(reste > 0)) break; const net = prendre(x, reste, niveau, false); out.net_obtenu += net; reste -= net; }
    }
    /* niveau 5 : matelas */
    if (max >= 5 && reste > 0) {
      for (const x of dispos) {
        if (!(reste > 0)) break;
        const prise = Math.min(reste, Math.max(0, x.v));
        if (prise > 0) { x.v -= prise; ajoute(x, 5, prise, prise, { ir: 0, ps: 0 }); reste -= prise; out.net_obtenu += prise; out.matelas_utilise += prise; }
      }
    }
    /* niveau 6 : PEA avant 5 ans, clôture autorisée : tout le plan est liquidé */
    if (max >= 6 && reste > 0) {
      const cand = L.filter(x => x.v > 0 && niveauRetrait(x.c, date, o) === 6);
      for (const x of cand) {
        if (!(reste > 0)) break;
        const net = prendre(x, reste, 6, true);
        out.net_obtenu += net;
        const utile = Math.min(net, reste);
        reste -= utile;
        out.excedent_au_disponible += net - utile;
      }
    }
    out.manque = isFinite(reste) ? Math.max(0, reste) : 0;
    out.impots = out.sources.reduce((a, s) => a + s.impots, 0);
    out.restes = L.map(x => ({ id: x.c.id, valeur: x.v, base: x.b }));
    return out;
  }

  return { PEA, AV, LIVRETS, MENTION_SCPI, lecteur, abattementIR, abattementPS, datesSeuils, preparer, sourcesDe, fiscaliteSortie, brutPourNet, niveauRetrait, planRetrait, NIVEAU_JAMAIS };
});
