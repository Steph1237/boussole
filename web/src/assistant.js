/* Remplissage par assistant : prompts à copier dans Claude (ou tout autre assistant) et lecture tolérante
   de la réponse collée. Aucune écriture ici : `parse` renvoie des données normalisées + erreurs + avertissements,
   l'interface décide ensuite d'appliquer. Vocabulaire canonique : p1 / p2 (personnes du foyer). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Assistant = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- nombres « 1 234,56 € », « 1,234.56 », « 30 % » ---------- */
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    let s = String(v).replace(/[\s  ]/g, "").replace(/[€$£%]|eur(os?)?/gi, "");
    if (!/^[-+]?[\d.,]+$/.test(s)) return null;
    const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (lc >= 0) s = s.replace(/,/g, (m, i) => (i === lc ? "." : ""));
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  /* ---------- extraction du premier bloc JSON d'une réponse ---------- */
  function balancedEnd(t, start) {
    const open = t[start], close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") { depth--; if (depth === 0) return c === close ? i : -1; }
    }
    return -1;
  }
  function extract(text) {
    const t = String(text || "");
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const src = fence ? fence[1] : t;
    const i = src.search(/[{[]/);
    if (i < 0) throw new Error("Aucun JSON trouvé dans la réponse. Demandez à l'assistant de répondre avec un bloc ```json.");
    const end = balancedEnd(src, i);
    const chunk = end > 0 ? src.slice(i, end + 1) : src.slice(i);
    try { return JSON.parse(chunk); }
    catch (e) { throw new Error("JSON illisible : " + e.message + ". Recopiez toute la réponse, ou demandez à l'assistant de corriger son JSON."); }
  }

  /* ---------- vocabulaire ---------- */
  const low = v => String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const bool = v => typeof v === "boolean" ? v : ["oui", "yes", "true", "vrai", "1"].includes(low(v)) ? true : ["non", "no", "false", "faux", "0", ""].includes(low(v)) ? false : null;
  function unite(v) {
    const s = low(v).replace(/\s+/g, "");
    if (["nm", "na", "bm", "ba"].includes(s)) return s;
    const brut = /brut/.test(s), an = /an|annuel|year/.test(s);
    if (!s) return null;
    return (brut ? "b" : "n") + (an ? "a" : "m");
  }
  const statut = v => { const s = low(v); if (!s) return null; return /non|nc|employ|ouvri/.test(s) ? "nc" : /cadre/.test(s) ? "cadre" : null; };
  const union = v => { const s = low(v); if (!s) return null; return /libre|concubin|sep|non mari/.test(s) ? "sep" : /mari|pacs|joint/.test(s) ? "joint" : null; };
  function age(v) {
    const s = low(v);
    if (["u30", "a30", "a40", "a50", "a60", "a70"].includes(s)) return s;
    const n = num(String(v).replace(/ans?/i, "").split(/[-–à]/)[0]);
    if (n == null) return null;
    return n < 30 ? "u30" : n < 40 ? "a30" : n < 50 ? "a40" : n < 60 ? "a50" : n < 70 ? "a60" : "a70";
  }
  const usage = v => { const s = low(v); return /loc/.test(s) ? "locatif" : /second/.test(s) ? "secondaire" : "rp"; };
  const person = v => { const s = low(v); return /^p?2$|conjoint|partenaire|compagn|mari|femme/.test(s) ? "p2" : /commun|joint|les deux|deux/.test(s) ? "commun" : "p1"; };
  const statusPos = v => { const s = low(v); return /recevoir|attente/.test(s) ? "à recevoir" : /clotur|vendu|ferme/.test(s) ? "clôturé" : "actif"; };
  const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
  const TMI = [0, 11, 30, 41, 45];
  const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] !== undefined) return o[k]; return undefined; };

  /* ---------- profil ---------- */
  function parseProfil(raw) {
    const erreurs = [], avertissements = [];
    const f = raw.foyer || {}, P = raw.personnes || {};
    const foyer = {};
    const ad = num(f.adultes); if (ad != null) foyer.adultes = Math.min(3, Math.max(1, Math.round(ad)));
    const en = num(f.enfants); if (en != null) foyer.enfants = Math.max(0, Math.round(en));
    const e14 = num(pick(f, "enfants14", "enfants_14", "ados")); if (e14 != null) foyer.enfants14 = Math.max(0, Math.min(foyer.enfants ?? e14, Math.round(e14)));
    const u = union(f.union); if (u) foyer.union = u;
    const a = age(f.age); if (a) foyer.age = a;
    const t = num(f.tmi);
    if (t != null) { if (TMI.includes(t)) foyer.tmi = t; else erreurs.push("Tranche marginale d'imposition " + t + " % inconnue : valeurs possibles 0, 11, 30, 41 ou 45 %."); }

    const personnes = {};
    ["p1", "p2"].forEach(k => {
      const p = P[k]; if (!p) return;
      const o = {};
      if (p.nom) o.nom = String(p.nom).slice(0, 40);
      const s = num(p.salaire); if (s != null) { if (s < 0) erreurs.push("Salaire négatif pour " + (o.nom || k) + "."); else o.salaire = s; }
      const un = unite(pick(p, "salaireUnite", "unite", "salaire_unite")); if (un) o.salaireUnite = un;
      const st = statut(p.statut); if (st) o.statut = st;
      if (p.csp) o.csp = String(p.csp);
      const es = bool(p.essai); if (es != null) o.essai = es;
      const ar = num(pick(p, "autresRevenus", "autres_revenus")); if (ar != null) o.autresRevenus = Math.max(0, ar);
      personnes[k] = o;
    });

    /* Un champ absent de la réponse reste absent (null) : la fusion ne l'écrase pas. Les valeurs par défaut
       ne s'appliquent qu'à la création d'une ligne (voir merge). */
    const biens = (Array.isArray(raw.biens) ? raw.biens : []).map((b, i) => {
      const nom = String(b.nom || "Bien " + (i + 1)).slice(0, 60);
      const o = { nom, usage: b.usage != null ? usage(b.usage) : null, valeur: num(b.valeur), part_p1: num(pick(b, "part_p1", "partP1", "quote_part")),
        crd: num(pick(b, "crd", "reste_du", "capital_restant")), mensualite: num(b.mensualite), loyer: num(b.loyer) };
      if (o.part_p1 != null && (o.part_p1 < 0 || o.part_p1 > 100)) erreurs.push(nom + " : la quote-part doit être comprise entre 0 et 100 %.");
      ["valeur", "crd", "mensualite", "loyer"].forEach(k => { if (o[k] != null && o[k] < 0) erreurs.push(nom + " : montant négatif (" + k + ")."); });
      if (o.crd != null && o.valeur != null && o.crd > o.valeur && o.valeur > 0) avertissements.push(nom + " : le reste à rembourser dépasse la valeur du bien.");
      return o;
    });
    const credits = (Array.isArray(raw.credits) ? raw.credits : []).map((c, i) => {
      const nom = String(c.nom || "Crédit " + (i + 1)).slice(0, 60);
      const ow = pick(c, "owner", "titulaire");
      const o = { nom, owner: ow != null ? person(ow) : null, crd: num(pick(c, "crd", "reste_du")), mensualite: num(c.mensualite) };
      if ((o.crd != null && o.crd < 0) || (o.mensualite != null && o.mensualite < 0)) erreurs.push(nom + " : montant négatif.");
      return o;
    });
    const data = { foyer, personnes };
    if (Array.isArray(raw.biens)) data.biens = biens;
    if (Array.isArray(raw.credits)) data.credits = credits;
    return { data, erreurs, avertissements };
  }

  /* ---------- positions ---------- */
  function parsePositions(raw) {
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw.positions) ? raw.positions : [];
    const erreurs = [], avertissements = [], data = [];
    if (!rows.length) erreurs.push("Aucune position trouvée : la réponse doit contenir une liste « positions ».");
    rows.forEach((r, i) => {
      const L = "Ligne " + (i + 1) + " : ";
      const nom = String(pick(r, "nom", "name") || "").trim();
      const isinRaw = String(r.isin || "").trim().toUpperCase().replace(/\s/g, "");
      const qty = num(pick(r, "quantite", "qty", "parts")), pru = num(pick(r, "pru", "prix_revient")), value = num(pick(r, "valeur", "value", "montant"));
      const errs = [];
      if (!nom) errs.push("nom manquant");
      if (isinRaw && !ISIN.test(isinRaw)) errs.push("ISIN « " + isinRaw + " » invalide");
      if (qty == null && value == null) errs.push("indiquez une quantité (titre coté) ou une valeur (livret, fonds euros…)");
      if ((qty != null && qty < 0) || (value != null && value < 0)) errs.push("montant négatif");
      if (errs.length) { erreurs.push(L + errs.join(", ") + "."); return; }
      const market = !!isinRaw && qty != null;
      if (isinRaw && qty == null) avertissements.push(L + nom + " a un ISIN mais pas de quantité : suivi en valeur manuelle.");
      data.push({ name: nom, isin: isinRaw || null, envelope: String(pick(r, "enveloppe", "envelope") || "").trim(), owner: person(pick(r, "titulaire", "owner")) === "p2" ? "p2" : "p1",
        bloc: String(pick(r, "poche", "bloc", "classe") || "").trim(), mode: market ? "market" : "manual",
        qty: market ? qty : null, pru: market ? pru : null, value: market ? null : value, status: statusPos(r.statut) });
    });
    return { data, erreurs, avertissements };
  }

  /* ---------- budget ---------- */
  const TYPES_BUDGET = { revenu: "revenu", revenus: "revenu", depense: "depense", depenses: "depense", charge: "depense", charges: "depense", epargne: "epargne", placement: "epargne" };
  function parseBudget(raw) {
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw.lignes) ? raw.lignes : [];
    const erreurs = [], avertissements = [], data = [];
    if (!rows.length) erreurs.push("Aucune ligne trouvée : la réponse doit contenir une liste « lignes ».");
    rows.forEach((r, i) => {
      const L = "Ligne " + (i + 1) + " : ";
      const type = TYPES_BUDGET[low(r.type).replace(/s$/, "")] || TYPES_BUDGET[low(r.type)];
      const libelle = String(pick(r, "libelle", "nom", "label") || "").trim();
      const montant = num(pick(r, "montant", "amount"));
      const errs = [];
      if (!type) errs.push("type « " + (r.type ?? "") + " » inconnu (revenu, depense ou epargne)");
      if (!libelle) errs.push("libellé manquant");
      if (montant == null) errs.push("montant manquant");
      else if (montant < 0) errs.push("montant négatif");
      if (errs.length) { erreurs.push(L + errs.join(", ") + "."); return; }
      const f = low(pick(r, "frequence", "periodicite"));
      const o = { type, categorie: String(r.categorie || (type === "epargne" ? "Épargne" : type === "revenu" ? "Revenus" : "Divers")).trim(), libelle, montant,
        frequence: /an|annuel|year/.test(f) ? "an" : "mois" };
      const ow = pick(r, "titulaire", "owner");
      if (ow != null) o.owner = person(ow);
      data.push(o);
    });
    return { data, erreurs, avertissements };
  }

  function parse(text, kind) {
    let raw;
    try { raw = extract(text); } catch (e) { return { data: null, erreurs: [e.message], avertissements: [] }; }
    if (kind === "positions") return parsePositions(raw);
    if (kind === "budget") return parseBudget(raw);
    if (Array.isArray(raw)) return { data: null, erreurs: ["La réponse est une liste : attendu un objet profil avec « foyer », « personnes », « biens », « credits »."], avertissements: [] };
    return parseProfil(raw);
  }


  /* ---------- fusion d'une réponse dans un profil existant ---------- */
  const LABELS = { adultes: "Adultes", enfants: "Enfants", enfants14: "Enfants de 14 ans ou plus", union: "Situation du couple", age: "Âge", tmi: "Tranche d'imposition",
    nom: "prénom", salaire: "salaire", salaireUnite: "unité du salaire", statut: "statut", csp: "catégorie", essai: "période d'essai", autresRevenus: "autres revenus",
    usage: "usage", valeur: "valeur", part_p1: "quote-part", crd: "reste à rembourser", mensualite: "mensualité", loyer: "loyer", owner: "titulaire" };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const rid = () => Math.random().toString(36).slice(2, 10);
  function merge(current, data) {
    const out = JSON.parse(JSON.stringify(current || {})), changes = [];
    out.foyer = out.foyer || {}; out.personnes = out.personnes || {}; out.biens = out.biens || []; out.credits = out.credits || [];
    const put = (obj, k, v, label) => { if (v == null || same(obj[k], v)) return; changes.push({ kind: "modif", label, avant: obj[k] ?? null, apres: v }); obj[k] = v; };
    Object.entries((data && data.foyer) || {}).forEach(([k, v]) => put(out.foyer, k, v, LABELS[k] || k));
    Object.entries((data && data.personnes) || {}).forEach(([pk, pv]) => {
      const p = out.personnes[pk] = out.personnes[pk] || {};
      const who = p.nom || pv.nom || (pk === "p1" ? "Personne 1" : "Personne 2");
      Object.entries(pv || {}).forEach(([k, v]) => put(p, k, v, who + " : " + (LABELS[k] || k)));
    });
    const lines = (key, defaults) => {
      const rows = data && data[key]; if (!Array.isArray(rows)) return;
      rows.forEach(r => {
        const hit = out[key].find(x => low(x.nom) === low(r.nom));
        if (hit) Object.entries(r).forEach(([k, v]) => { if (k !== "nom") put(hit, k, v, hit.nom + " : " + (LABELS[k] || k)); });
        else {
          const row = Object.assign({ id: rid() }, defaults);
          Object.entries(r).forEach(([k, v]) => { if (v != null) row[k] = v; });
          out[key].push(row); changes.push({ kind: "ajout", label: (key === "biens" ? "Nouveau bien : " : "Nouveau crédit : ") + row.nom, avant: null, apres: row });
        }
      });
    };
    lines("biens", { usage: "rp", valeur: 0, part_p1: +out.foyer.adultes >= 2 ? 50 : 100, crd: 0, mensualite: 0, loyer: 0 });
    lines("credits", { owner: "commun", crd: 0, mensualite: 0 });
    return { profil: out, changes };
  }

  /* ---------- prompts ---------- */
  const COMMON = "Règles : n'invente aucune valeur. Si tu ne connais pas une information, demande-la-moi d'abord ou mets null. " +
    "Les montants sont en euros, sans symbole. Réponds avec UN SEUL bloc ```json, sans commentaire à l'intérieur.";
  const PROMPTS = {
    profil: "Aide-moi à remplir mon profil dans Boussole, mon outil de suivi de patrimoine. " +
      "Utilise ce que tu sais déjà de moi et pose-moi les questions manquantes avant de répondre.\n\n" + COMMON + "\n\n" +
      "Format attendu :\n```json\n" + JSON.stringify({
        foyer: { adultes: 2, enfants: 0, enfants14: 0, union: "joint | sep", age: 35, tmi: "0 | 11 | 30 | 41 | 45" },
        personnes: {
          p1: { nom: "Prénom", salaire: 3000, salaireUnite: "nm | na | bm | ba (net/brut, mois/an)", statut: "cadre | nc", essai: false, autresRevenus: 0 },
          p2: { nom: "Prénom du conjoint (supprime p2 si seul)", salaire: 2500, salaireUnite: "nm", statut: "nc", essai: false, autresRevenus: 0 },
        },
        biens: [{ nom: "Appartement", usage: "rp | locatif | secondaire", valeur: 250000, part_p1: 50, crd: 150000, mensualite: 900, loyer: 0 }],
        credits: [{ nom: "Prêt auto", titulaire: "p1 | p2 | commun", crd: 8000, mensualite: 250 }],
      }, null, 2) + "\n```",
    positions: "Aide-moi à lister mes placements pour Boussole, mon outil de suivi de patrimoine. " +
      "Je peux te coller mes relevés (PEA, assurance-vie, livrets, crypto…) ; extrais-en chaque ligne.\n\n" + COMMON + "\n" +
      "Pour un titre coté (ETF, action), donne l'ISIN et la quantité ; pour un livret, un fonds euros ou une SCPI, donne la valeur.\n\n" +
      "Format attendu :\n```json\n" + JSON.stringify({
        positions: [
          { nom: "Amundi MSCI World", isin: "FR0011869353", enveloppe: "PEA", titulaire: "p1 | p2", poche: "Monde", quantite: 12, pru: 4.8, statut: "actif | à recevoir" },
          { nom: "Livret A", enveloppe: "Livrets", titulaire: "p1", poche: "Épargne", valeur: 12000 },
        ],
      }, null, 2) + "\n```",
  };
  PROMPTS.budget = "Aide-moi à établir mon budget mensuel pour Boussole, mon outil de suivi de patrimoine. " +
    "Je peux te coller mes relevés bancaires des derniers mois : regroupe les dépenses par catégorie et fais la moyenne mensuelle. " +
    "Ne mets pas mon salaire ni mes mensualités de crédit immobilier : l'outil les connaît déjà.\n\n" + COMMON + "\n\n" +
    "Format attendu :\n```json\n" + JSON.stringify({
      lignes: [
        { type: "depense | revenu | epargne", categorie: "Logement", libelle: "Charges de copropriété", montant: 180, frequence: "mois | an", titulaire: "p1 | p2 | commun" },
        { type: "depense", categorie: "Impôts", libelle: "Taxe foncière", montant: 1100, frequence: "an" },
        { type: "epargne", categorie: "Épargne", libelle: "Virement Livret A", montant: 300, frequence: "mois" },
      ],
    }, null, 2) + "\n```\nCatégories conseillées : Logement, Alimentation, Transport, Enfants, Santé, Loisirs, Abonnements, Impôts, Divers.";
  const prompt = kind => PROMPTS[kind] || PROMPTS.profil;

  return { num, extract, parse, merge, prompt };
});
