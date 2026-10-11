/* Logique du formulaire interactif Boussole (page ui://boussole/formulaire) : navigation, validation, exclusivité, bornes du
   curseur, construction des réponses. Pure (aucun accès au DOM), UMD : testée sous Node (test/formulaire.test.mjs) et injectée
   telle quelle dans la page par formulaire-ui.ts (via formulaire-logique.gen.ts, npm run gen). Textes au tutoiement.
   Une question = un champ complété par l'outil formulaire : { champ, theme, type: choix|multi|curseur|montant|date|booleen|
   texte_court, libelle, aide?, aide_donnees?, valeurs?: [{ v, label, exclusif? }], min?, max?, pas?, unite?, reperes?,
   valeur_actuelle? }. Les mêmes règles sont revérifiées côté serveur par soumettre_formulaire (formulaire.ts, parité testée). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FormulaireLogique = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const TYPES = ["choix", "multi", "curseur", "montant", "date", "booleen", "texte_court"];
  const TEXTE_MAX = 40;
  const egal = (a, b) => a === b || (a != null && b != null && typeof a !== typeof b && String(a) === String(b));
  const option = (q, v) => (q.valeurs || []).find(o => egal(o.v, v)) || null;
  const nombre = x => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN);

  /** Montant saisi en français (« 2 500,50 », « 2500.5 € ») → nombre ; NaN si illisible. */
  function lireMontant(texte) {
    if (typeof texte === "number") return texte;
    const t = String(texte == null ? "" : texte).replace(/[\s  €]/g, "").replace(",", ".");
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  }
  /** Vraie date du calendrier AAAA-MM-JJ. */
  function dateReelle(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  const bornesCurseur = q => ({ min: q.min != null ? +q.min : 0, max: q.max != null ? +q.max : 100, pas: q.pas > 0 ? +q.pas : 1 });

  /** Valeur ramenée dans les bornes du curseur et sur son pas. */
  function borner(q, x) {
    const b = bornesCurseur(q), n = nombre(x);
    if (!isFinite(n)) return b.min;
    const pasee = b.min + Math.round((n - b.min) / b.pas) * b.pas;
    return Math.min(b.max, Math.max(b.min, Math.round(pasee * 1e6) / 1e6));
  }
  /** « 3 ans », « 1 an », « 0 an » (unité « ans ») ; sinon valeur + unité. */
  function formaterCurseur(q, x) {
    const n = borner(q, x);
    if (q.unite === "ans") return n + (n <= 1 ? " an" : " ans");
    return n + (q.unite ? " " + q.unite : "");
  }
  /** Libellé du repère atteint par la valeur du curseur (« 5 à 9 ans »), ou null. */
  function repereCurseur(q, x) {
    const n = borner(q, x);
    const r = (q.reperes || []).filter(p => n >= p.min).pop();
    return r ? r.label : null;
  }

  /** Choix multiple : coche ou décoche v. Une option exclusive cochée remplace tout ; une autre option retire l'exclusive. */
  function basculerMulti(q, actuelles, v) {
    const cur = (Array.isArray(actuelles) ? actuelles : []).slice();
    const o = option(q, v);
    if (!o) return cur;
    if (cur.some(x => egal(x, o.v))) return cur.filter(x => !egal(x, o.v));
    if (o.exclusif) return [o.v];
    return cur.filter(x => { const ox = option(q, x); return !(ox && ox.exclusif); }).concat([o.v]);
  }

  const estVide = (q, v) => v === undefined || v === null || v === "" || (q.type === "multi" && Array.isArray(v) && v.length === 0);

  /** Valeur saisie → valeur normalisée (code de l'option, nombre, booléen, texte nettoyé) ; ne valide pas. */
  function normaliser(q, v) {
    if (estVide(q, v)) return undefined;
    switch (q.type) {
      case "choix": { const o = option(q, v); return o ? o.v : v; }
      case "multi": return (Array.isArray(v) ? v : [v]).map(x => { const o = option(q, x); return o ? o.v : x; });
      case "curseur": { const n = nombre(v); return isFinite(n) ? n : v; }
      case "montant": { const n = lireMontant(v); return isFinite(n) ? n : v; }
      case "booleen": return v === "true" ? true : v === "false" ? false : v;
      case "texte_court": return typeof v === "string" ? v.trim() : v;
      default: return v;
    }
  }

  /** Message d'erreur (tutoiement) ou null si la valeur (non vide) est valide pour la question. */
  function valider(q, brute) {
    if (!q || TYPES.indexOf(q.type) < 0) return "Question inconnue.";
    const v = normaliser(q, brute);
    if (estVide(q, v)) return "Choisis une réponse, ou passe la question.";
    switch (q.type) {
      case "choix": return option(q, v) ? null : "Choisis une des réponses proposées.";
      case "multi": {
        if (!Array.isArray(v) || !v.length) return "Coche au moins une réponse.";
        if (v.some(x => !option(q, x))) return "Coche seulement des réponses proposées.";
        if (new Set(v.map(String)).size !== v.length) return "Chaque réponse ne compte qu'une fois.";
        const excl = v.map(x => option(q, x)).filter(o => o.exclusif);
        if (excl.length && v.length > 1) return "« " + excl[0].label + " » ne se combine pas avec d'autres réponses.";
        return null;
      }
      case "curseur": {
        const b = bornesCurseur(q);
        if (typeof v !== "number" || !isFinite(v) || v < b.min || v > b.max) return "Choisis une valeur entre " + formaterCurseur(q, b.min) + " et " + formaterCurseur(q, b.max) + ".";
        if (Math.abs((v - b.min) / b.pas - Math.round((v - b.min) / b.pas)) > 1e-9) return "Choisis une valeur par pas de " + b.pas + ".";
        return null;
      }
      case "montant": {
        if (typeof v !== "number" || !isFinite(v)) return "Indique un montant en chiffres (par exemple 2 500).";
        if (v < (q.min != null ? q.min : 0)) return "Indique un montant positif.";
        if (q.max != null && v > q.max) return "Indique un montant de " + q.max + " au plus.";
        return null;
      }
      case "date": {
        if (!dateReelle(v)) return "Indique une date valide (jour, mois, année).";
        if (q.min && v < q.min) return "Indique une date à partir du " + q.min.split("-").reverse().join("/") + ".";
        if (q.max && v > q.max) return "Indique une date jusqu'au " + q.max.split("-").reverse().join("/") + ".";
        return null;
      }
      case "booleen": return v === true || v === false ? null : "Réponds par oui ou par non.";
      case "texte_court": {
        const max = q.max != null ? +q.max : TEXTE_MAX;
        if (typeof v !== "string" || !v.length) return "Écris une réponse courte.";
        return v.length > max ? "Écris " + max + " caractères au plus." : null;
      }
    }
    return null;
  }

  /* ---------- état du stepper ---------- */
  /** État initial : réponses préremplies avec les seules valeurs actuelles valides (déjà validées dans Boussole). */
  function creer(formulaire) {
    const f = formulaire || {};
    const questions = Array.isArray(f.questions) ? f.questions.filter(q => q && TYPES.indexOf(q.type) >= 0) : [];
    const reponses = {};
    questions.forEach(q => { if (!estVide(q, q.valeur_actuelle) && !valider(q, q.valeur_actuelle)) reponses[q.champ] = normaliser(q, q.valeur_actuelle); });
    return { formulaire: f, questions, index: 0, reponses, passees: {}, erreur: null };
  }
  const question = e => e.questions[e.index] || null;
  const dernier = e => e.index >= e.questions.length - 1;
  function progression(e) {
    const total = e.questions.length, numero = Math.min(total, e.index + 1);
    return { numero, total, pct: total ? Math.round(numero / total * 100) : 0, texte: "Question " + numero + " sur " + total };
  }
  /** Enregistre la réponse à la question courante (efface l'erreur et le « passé »). */
  function repondre(e, valeur) {
    const q = question(e);
    if (!q) return e;
    const v = normaliser(q, valeur);
    if (estVide(q, v)) delete e.reponses[q.champ]; else e.reponses[q.champ] = v;
    delete e.passees[q.champ];
    e.erreur = null;
    return e;
  }
  /** Erreur de la question courante, ou null (une question passée est valide). */
  function erreurCourante(e) {
    const q = question(e);
    if (!q || e.passees[q.champ]) return null;
    return valider(q, e.reponses[q.champ]);
  }
  /** Question suivante si la courante est valide ; sinon l'erreur reste affichée et l'on ne bouge pas. Le bouton n'est jamais bloqué. */
  function suivante(e) {
    e.erreur = erreurCourante(e);
    if (!e.erreur && !dernier(e)) e.index += 1;
    return e;
  }
  function precedente(e) { e.erreur = null; if (e.index > 0) e.index -= 1; return e; }
  /** Passe la question courante sans y répondre (rien n'est envoyé pour elle). */
  function passer(e) {
    const q = question(e);
    if (!q) return e;
    delete e.reponses[q.champ];
    e.passees[q.champ] = true;
    e.erreur = null;
    if (!dernier(e)) e.index += 1;
    return e;
  }
  /** Réponses à envoyer : questions répondues, non passées, valides ; valeurs normalisées. */
  function construireReponses(e) {
    const out = {};
    e.questions.forEach(q => {
      const v = e.reponses[q.champ];
      if (e.passees[q.champ] || estVide(q, v) || valider(q, v)) return;
      out[q.champ] = normaliser(q, v);
    });
    return out;
  }
  /** Contrôle avant envoi : question courante valide (ou passée), au moins une réponse. */
  function envoyable(e) {
    const err = erreurCourante(e);
    if (err) { e.erreur = err; return { ok: false, erreur: err }; }
    const reponses = construireReponses(e);
    if (!Object.keys(reponses).length) { e.erreur = "Réponds à au moins une question avant d'envoyer."; return { ok: false, erreur: e.erreur }; }
    e.erreur = null;
    return { ok: true, reponses };
  }
  /** Libellé lisible d'une valeur (récapitulatif). */
  function libelleValeur(q, v) {
    if (estVide(q, v)) return "—";
    switch (q.type) {
      case "choix": { const o = option(q, v); return o ? o.label : String(v); }
      case "multi": return (Array.isArray(v) ? v : [v]).map(x => { const o = option(q, x); return o ? o.label : String(x); }).join(", ");
      case "curseur": return formaterCurseur(q, v);
      case "montant": return String(Math.round(+v * 100) / 100).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (q.unite ? " " + q.unite : " €");
      case "date": return String(v).split("-").reverse().join("/");
      case "booleen": return v === true ? "Oui" : v === false ? "Non" : String(v);
      default: return String(v);
    }
  }
  function resume(e) {
    const r = construireReponses(e);
    return e.questions.filter(q => q.champ in r).map(q => ({ champ: q.champ, libelle: q.libelle, valeur: libelleValeur(q, r[q.champ]) }));
  }

  return { TYPES, TEXTE_MAX, lireMontant, dateReelle, borner, formaterCurseur, repereCurseur, basculerMulti, estVide, normaliser, valider,
    creer, question, dernier, progression, repondre, erreurCourante, suivante, precedente, passer, construireReponses, envoyable, libelleValeur, resume };
});
