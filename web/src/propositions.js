/* Profil et données › Propositions : revue des changements déposés par Claude (connecteur MCP) avant enregistrement.
   S.propositions = [{ id, lot, cible, operation: creer|modifier|supprimer, ref, avant, apres, source, justification,
   statut: en_attente|acceptee|refusee, creeLe, decideLe }]. Rien n'est appliqué sans validation :
   Store.propositions.appliquer(ids, { [id]: apresModifie }) et Store.propositions.refuser(ids).
   Les fonctions de description (decrire, changements, sujet) sont pures et exportées pour les tests. */
(function () {
  "use strict";
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const isObj = v => v != null && typeof v === "object" && !Array.isArray(v);
  const vide = v => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

  /* ---------- cibles ---------- */
  const CIBLES = {
    profil: { label: "Profil du foyer", nouveau: "Nouvelle information", suppr: "Retirer" },
    protection: { label: "Protection", nouveau: "Protection", suppr: "Retirer" },
    budget: { label: "Budget", nouveau: "Nouvelle ligne de budget", suppr: "Supprimer la ligne de budget", entite: true },
    position: { label: "Placements", nouveau: "Nouveau placement", suppr: "Supprimer le placement", entite: true },
    bien: { label: "Biens immobiliers", nouveau: "Nouveau bien", suppr: "Supprimer le bien", entite: true },
    credit: { label: "Crédits", nouveau: "Nouveau crédit", suppr: "Supprimer le crédit", entite: true },
    objectif: { label: "Objectifs", nouveau: "Nouvel objectif", suppr: "Supprimer l'objectif", entite: true },
    risque: { label: "Profil de risque", nouveau: "Profil de risque", suppr: "Retirer" },
  };
  const ORDRE_CIBLES = ["profil", "protection", "budget", "position", "bien", "credit", "objectif", "risque"];
  const NOUV_BUDGET = { depense: "Nouvelle dépense", revenu: "Nouveau revenu", epargne: "Nouvelle épargne" };

  /* ---------- champs connus : libellé, genre (f), nature (k) et options ---------- */
  const OPT = {
    type: [["depense", "dépense"], ["revenu", "revenu"], ["epargne", "épargne"]],
    frequence: [["mois", "par mois"], ["an", "par an"]],
    owner: [["p1", "personne 1"], ["p2", "personne 2"], ["commun", "commun"]],
    statut: [["cadre", "cadre"], ["non-cadre", "non-cadre"]],
    usage: [["rp", "résidence principale"], ["locatif", "locatif"], ["secondaire", "résidence secondaire"]],
  };
  const F = {
    qty: { l: "parts", f: true, k: "qty" }, value: { l: "valeur", f: true, k: "eur" }, valeur: { l: "valeur", f: true, k: "eur" },
    price: { l: "cours", k: "eur" }, pru: { l: "prix de revient", k: "eur" }, crd: { l: "reste à rembourser", k: "eur" },
    mensualite: { l: "mensualité", f: true, k: "eur" }, loyer: { l: "loyer", k: "eur" }, montant: { l: "montant", k: "eur" },
    salaire: { l: "salaire", k: "eur" }, cible: { l: "montant visé", k: "eur" }, deja: { l: "déjà épargné", k: "eur" },
    capital: { l: "capital", k: "eur" }, revenus: { l: "revenus", k: "eur" },
    part_p1: { l: "part de la personne 1", f: true, k: "pct" }, tmi: { l: "tranche marginale d'imposition", f: true, k: "pct" },
    rendement: { l: "rendement", k: "pct" }, quotite: { l: "quotité", f: true, k: "pct" }, taux: { l: "taux", k: "pct" },
    adultes: { l: "adultes", k: "num" }, enfants: { l: "enfants à charge", k: "num" }, age: { l: "tranche d'âge", f: true },
    nom: { l: "nom" }, name: { l: "nom" }, libelle: { l: "libellé" }, categorie: { l: "catégorie", f: true },
    envelope: { l: "enveloppe", f: true }, bloc: { l: "poche", f: true }, isin: { l: "code ISIN" }, ticker: { l: "symbole" },
    type: { l: "type", k: "enum" }, frequence: { l: "fréquence", f: true, k: "enum" }, owner: { l: "titulaire", k: "enum" },
    statut: { l: "statut", k: "enum" }, usage: { l: "usage", k: "enum" },
    prevoyance: { l: "assurance prévoyance", f: true, k: "bool" }, emprunteur: { l: "assurance emprunteur", f: true },
    dateCible: { l: "date visée", f: true, k: "date" }, date_cible: { l: "date visée", f: true, k: "date" },
    valueDate: { l: "date du solde", f: true, k: "date" }, priceDate: { l: "date du cours", f: true, k: "date" },
    priorite: { l: "priorité", f: true, k: "num" }, mode: { l: "mode de suivi" },
  };
  /* Profil de risque : thème court par question (mêmes identifiants que web/src/risque.js). */
  const RISQUE_THEMES = {
    horizon: "horizon de placement", objectif: "objectif des placements", reaction: "réaction à une baisse", perte_max: "baisse supportable",
    connaissances: "connaissances", experience: "expérience", revenus: "stabilité des revenus", matelas: "épargne de précaution",
    part_investie: "part exposée aux marchés", age: "tranche d'âge",
  };
  const TECH = new Set(["id", "user_id", "created_at", "updated_at", "cree_le", "maj_le"]);

  /* ---------- chemins ---------- */
  function aplatir(o, pre, out) {
    out = out || {};
    Object.keys(o || {}).forEach(k => {
      const v = o[k], p = pre ? pre + "." + k : k;
      if (isObj(v) && Object.keys(v).length) aplatir(v, p, out); else out[p] = v;
    });
    return out;
  }
  const lire = (o, path) => path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
  function poser(o, path, v) {
    const ks = path.split("."); let cur = o;
    ks.slice(0, -1).forEach(k => { if (!isObj(cur[k])) cur[k] = {}; cur = cur[k]; });
    cur[ks[ks.length - 1]] = v;
    return o;
  }
  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const egal = (a, b) => (vide(a) && vide(b)) || JSON.stringify(a) === JSON.stringify(b);
  /* apres/avant scalaires (rare) : traités comme { valeur }. */
  const commeObjet = v => (isObj(v) ? v : v == null ? {} : { valeur: v });

  /* ---------- contexte (noms des personnes, entités existantes, questions du risque) ---------- */
  const questionsDe = ctx => (ctx && ctx.questions) || (typeof window !== "undefined" && window.Risque && window.Risque.QUESTIONS) || [];
  function nomPersonne(ctx, k) {
    const ppl = (ctx && ctx.people) || [];
    const p = ppl.find(x => x.id === k);
    const n = (p && p.nom) || (ctx && ctx.profil && ctx.profil.personnes && ctx.profil.personnes[k] && ctx.profil.personnes[k].nom);
    return String(n || "").trim() || (k === "p2" ? "la personne 2" : "la personne 1");
  }
  const de = n => (/^[aeiouyhéèêàâîôûAEIOUYHÉÈÊÀÂÎÔÛ]/.test(n) ? "d'" : "de ") + n;

  function champ(path, p, ctx) {
    const ks = path.split("."), last = ks[ks.length - 1];
    if (p.cible === "risque" && RISQUE_THEMES[last]) {
      const q = questionsDe(ctx).find(x => x.id === last);
      return { l: RISQUE_THEMES[last], f: /^(réaction|baisse|stabilité|épargne|part|tranche|expérience)/.test(RISQUE_THEMES[last]), k: "risque", q, multi: !!(q && q.type === "multi") };
    }
    const base = F[last] || { l: last.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() };
    const c = Object.assign({}, base);
    if (c.k === "enum") c.opts = OPT[last] || [];
    if (last === "owner") c.opts = OPT.owner.map(([v, t]) => [v, v === "commun" ? t : nomPersonne(ctx, v)]);
    if ((ks[0] === "personnes" || ks[0] === "autres") && /^p[12]$/.test(ks[1] || "") && ks.length > 2) c.l = c.l + " " + de(nomPersonne(ctx, ks[1]));
    if (last === "part_p1") c.l = "part " + de(nomPersonne(ctx, "p1"));
    return c;
  }

  const frDate = d => { const t = Date.parse(String(d).length === 10 ? d + "T12:00:00" : d); return isFinite(t) ? new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : String(d); };
  /* Valeur → texte : euros, parts, %, oui/non, dates, options. */
  function valeurTxt(v, c, suffixe) {
    if (vide(v)) return c && c.f ? "non renseignée" : "non renseigné";
    if (typeof v === "boolean") return v ? "oui" : "non";
    if (c && c.k === "risque" && c.q) {
      const lab = x => { const o = (c.q.options || []).find(o => o.v === x); return o ? o.label : String(x); };
      return Array.isArray(v) ? v.map(lab).join(", ") : lab(v);
    }
    if (Array.isArray(v)) return v.map(x => valeurTxt(x, null)).join(", ");
    if (isObj(v)) return Object.keys(v).filter(k => !TECH.has(k)).map(k => champ(k, {}, null).l + " " + valeurTxt(v[k], champ(k, {}, null))).join(", ");
    const k = c && c.k;
    const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : null);
    if (k === "eur" && n != null) return nf.format(n) + " €" + (suffixe || "");
    if (k === "qty" && n != null) return nf.format(n) + (Math.abs(n) > 1 ? " parts" : " part");
    if (k === "pct" && n != null) return nf.format(n) + " %";
    if (k === "date") return frDate(v);
    if (c && c.opts) { const o = c.opts.find(o => o[0] === v); if (o) return o[1]; }
    if (n != null && typeof v === "number") return nf.format(n);
    return String(v);
  }

  /* Entité visée : dans apres, avant, ou les données existantes (ref). */
  function entite(p, ctx) {
    const a = commeObjet(p.apres), b = commeObjet(p.avant), ref = p.ref;
    const pr = (ctx && ctx.profil) || {};
    const listes = {
      position: (ctx && ctx.positions) || [], bien: pr.biens || [], credit: pr.credits || [],
      objectif: (ctx && ctx.objectifs) || [], budget: (ctx && ctx.budget && ctx.budget.lignes) || [],
    };
    const ex = ref != null ? (listes[p.cible] || []).find(x => String(x.id) === String(ref)) : null;
    return Object.assign({}, ex || {}, b, a);
  }
  /** Libellé de l'entité visée (« PEA · Amundi MSCI World », « Prêt auto »), null pour profil, protection et risque. */
  function sujet(p, ctx) {
    if (!CIBLES[p.cible] || !CIBLES[p.cible].entite) return null;
    const e = entite(p, ctx);
    if (p.cible === "position") return [e.envelope, e.name || e.nom].filter(Boolean).join(" · ") || "Placement";
    if (p.cible === "budget") return e.libelle || e.categorie || "Ligne de budget";
    return e.nom || e.name || e.libelle || CIBLES[p.cible].label;
  }

  /** Champs modifiés (modifier), ou renseignés (creer), avec libellés et valeurs mises en forme. */
  function changements(p, ctx) {
    if (p.operation === "supprimer") return [];
    const a = commeObjet(p.apres), b = commeObjet(p.avant);
    const plat = aplatir(a, "");
    const e = p.cible === "budget" ? entite(p, ctx) : null;
    const suf = e ? (e.frequence === "an" ? "/an" : "/mois") : "";
    return Object.keys(plat).filter(path => !TECH.has(path.split(".").pop()))
      .filter(path => p.operation === "creer" ? !vide(plat[path]) : !egal(lire(b, path), plat[path]))
      .map(path => {
        const c = champ(path, p, ctx);
        const sx = c.k === "eur" && path === "montant" ? suf : "";
        return { path, label: c.l, kind: c.k || (typeof plat[path] === "boolean" ? "bool" : typeof plat[path] === "number" ? "num" : "text"), opts: c.opts || (c.q ? (c.q.options || []).map(o => [o.v, o.label]) : null), multi: !!c.multi,
          avant: lire(b, path), apres: plat[path], avantTxt: valeurTxt(lire(b, path), c, sx), apresTxt: valeurTxt(plat[path], c, sx) };
      });
  }

  /** Phrase en français : « PEA · Amundi MSCI World : 120 parts → 135 parts », « Nouvelle dépense : Assurance auto 45 €/mois »… */
  function decrire(p, ctx) {
    const C = CIBLES[p.cible] || { label: cap(String(p.cible || "Donnée")), nouveau: "Nouveau", suppr: "Supprimer" };
    const suj = sujet(p, ctx);
    if (p.operation === "supprimer") return C.suppr + " : " + (suj || C.label);
    const ch = changements(p, ctx);
    if (p.operation === "creer" && C.entite) {
      if (p.cible === "budget") {
        const e = entite(p, ctx);
        const m = ch.find(c => c.path === "montant");
        return (NOUV_BUDGET[e.type] || C.nouveau) + " : " + (e.libelle || e.categorie || "sans libellé") + (m ? " " + m.apresTxt : "");
      }
      const NOMS = new Set(["nom", "name", "libelle", "envelope", "type"]);
      const det = ch.filter(c => !NOMS.has(c.path)).slice(0, 3).map(c => c.kind === "qty" ? c.apresTxt : c.label + " " + c.apresTxt);
      return C.nouveau + " : " + suj + (det.length ? ", " + det.join(", ") : "");
    }
    if (!ch.length) return (suj || C.label) + " : aucun changement";
    if (suj) return suj + " : " + ch.map(c => (c.kind === "qty" ? "" : c.label + " ") + c.avantTxt + " → " + c.apresTxt).join(" ; ");
    return ch.map(c => cap(c.label) + " : " + c.avantTxt + " → " + c.apresTxt).join(" ; ");
  }

  /* ---------- saisie d'une valeur modifiée ---------- */
  const brut = (v, kind) => (vide(v) ? "" : kind === "bool" ? (v ? "oui" : "non") : Array.isArray(v) ? v.join(", ") : String(v));
  /** Texte saisi → valeur typée ; { erreur } si invalide. */
  function lireSaisie(raw, ch) {
    if (Array.isArray(raw)) return { v: raw };
    const s = String(raw ?? "").trim();
    if (s === "") return { v: null };
    if (ch.kind === "bool") return { v: s === "oui" };
    if (["eur", "qty", "pct", "num"].includes(ch.kind) || (ch.kind === "text" && typeof ch.apres === "number")) {
      const n = Number(s.replace(/[\s  €%]/g, "").replace(",", "."));
      return isFinite(n) ? { v: n } : { erreur: "« " + s + " » n'est pas un nombre (" + ch.label + ")." };
    }
    return { v: s };
  }
  /** apres + valeurs saisies ({ path: brut }) → apres modifié ; { erreur } au premier champ invalide. */
  function appliquerSaisies(p, saisies, ctx) {
    const ch = changements(p, ctx);
    const scalaire = !isObj(p.apres) && p.apres != null;
    const out = clone(commeObjet(p.apres));
    for (const c of ch) {
      if (!saisies || !(c.path in saisies)) continue;
      const r = lireSaisie(saisies[c.path], c);
      if (r.erreur) return { erreur: r.erreur };
      poser(out, c.path, r.v);
    }
    return { apres: scalaire ? out.valeur : out };
  }

  const H = { CIBLES, ORDRE_CIBLES, decrire, changements, sujet, valeurTxt, lireSaisie, appliquerSaisies, aplatir };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =================================================================== vue =================================================================== */
  const ICONS = {
    profil: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>',
    protection: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/>',
    budget: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/>',
    position: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    bien: '<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5"/>',
    credit: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    objectif: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    risque: '<path d="M4 17a8 8 0 0 1 16 0M12 17l4.5-5"/>',
    source: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
  };
  const svg = k => '<svg class="pp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[k] || ICONS.profil) + "</svg>";

  let S = null, root = null, dirty = true, sig = "", busy = false;
  const sel = new Map();       // id → coché
  const saisies = {};          // id → { path: brut }
  const edition = new Set();   // ids dont la valeur est en cours de modification
  const $ = id => root.querySelector("#" + id);
  const P = () => (window.Store && window.Store.propositions) || null;
  const toutes = () => (P() && S && Array.isArray(S.propositions) ? S.propositions : []); // sans Store.propositions : état vide
  const enAttente = () => toutes().filter(p => p.statut === "en_attente");
  const ctx = () => ({ people: S && S.people, profil: S && S.profil, positions: S && S.positions, objectifs: S && S.objectifs, budget: S && S.budget });
  const quand = d => { const t = Date.parse(d); if (!isFinite(t)) return ""; const x = new Date(t); return x.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + ", " + x.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);

  function lots() {
    const m = new Map();
    enAttente().forEach(p => { const k = p.lot || "sans-lot"; if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
    return [...m.entries()].map(([lot, ps]) => ({ lot, ps, date: ps.map(p => p.creeLe).filter(Boolean).sort()[0] || "" }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  const selection = () => enAttente().filter(p => sel.get(p.id) !== false).map(p => p.id);

  /* Plusieurs champs changés (ou renseignés hors entité : protection, risque, profil) : liste champ par champ. */
  const enListe = (p, ch) => ch.length > 1 && (p.operation === "modifier" || !(CIBLES[p.cible] && CIBLES[p.cible].entite));
  function rowHtml(p) {
    const c = ctx(), ch = changements(p, c), ed = edition.has(p.id), mod = saisies[p.id] && Object.keys(saisies[p.id]).length;
    const vue = mod ? Object.assign({}, p, { apres: appliquerSaisies(p, saisies[p.id], c).apres ?? p.apres }) : p;
    const desc = decrire(vue, c);
    const plusieurs = enListe(p, ch);
    const diff = plusieurs ? '<dl class="pp-diff">' + changements(vue, c).map(x => "<div><dt>" + esc(cap(x.label)) + "</dt><dd>" + esc(x.avantTxt) + ' <span aria-hidden="true">→</span><span class="sr"> devient </span> <b>' + esc(x.apresTxt) + "</b></dd></div>").join("") + "</dl>" : "";
    const champs = ed ? '<div class="pp-edit" role="group" aria-label="Corriger la proposition">' + ch.map(x => {
      const v = saisies[p.id] && x.path in saisies[p.id] ? saisies[p.id][x.path] : x.multi ? (Array.isArray(x.apres) ? x.apres : []) : brut(x.apres, x.kind);
      const att = ' data-edit-id="' + esc(p.id) + '" data-path="' + esc(x.path) + '"';
      let input;
      if (x.kind === "bool") input = "<select" + att + ">" + [["", "non renseigné"], ["oui", "oui"], ["non", "non"]].map(([o, t]) => '<option value="' + o + '"' + (o === v ? " selected" : "") + ">" + t + "</option>").join("") + "</select>";
      else if (x.opts && x.opts.length) {
        const opts = x.opts.slice(); if (!x.multi && v !== "" && !opts.some(o => o[0] === v)) opts.unshift([v, v]);
        input = "<select" + att + (x.multi ? " multiple size=\"" + Math.min(6, opts.length) + "\"" : "") + ">" + (x.multi ? "" : '<option value="">non renseigné</option>') +
          opts.map(([o, t]) => '<option value="' + esc(o) + '"' + ((x.multi ? v.includes(o) : o === v) ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select>";
      } else if (x.kind === "date") input = '<input type="date"' + att + ' value="' + esc(String(v).slice(0, 10)) + '">';
      else if (["eur", "qty", "pct", "num"].includes(x.kind) || typeof x.apres === "number") input = '<input type="text" inputmode="decimal"' + att + ' value="' + esc(v) + '">';
      else input = '<input type="text"' + att + ' value="' + esc(v) + '">';
      const unit = x.kind === "eur" ? "€" : x.kind === "pct" ? "%" : "";
      return "<label><span>" + (x.kind === "qty" ? "Nombre de parts" : esc(cap(x.label)) + (unit ? " (" + unit + ")" : "")) + "</span>" + input + "</label>";
    }).join("") + '<div class="pp-edit-act"><button type="button" class="pp-lnk" data-edit-done="' + esc(p.id) + '">Terminer</button>' + (mod ? '<button type="button" class="pp-lnk" data-edit-reset="' + esc(p.id) + '">Revenir à la proposition</button>' : "") + "</div></div>" : "";
    const editable = p.operation !== "supprimer" && ch.length;
    return '<li class="pp-row' + (mod ? " is-mod" : "") + '" data-id="' + esc(p.id) + '">' +
      '<input type="checkbox" class="pp-chk" data-sel="' + esc(p.id) + '"' + (sel.get(p.id) !== false ? " checked" : "") + ' aria-label="Sélectionner : ' + esc(desc) + '">' +
      '<div class="pp-body">' +
        '<p class="pp-desc">' + (p.operation === "supprimer" ? '<span class="pp-op del">suppression</span> ' : p.operation === "creer" && CIBLES[p.cible] && CIBLES[p.cible].entite ? '<span class="pp-op add">ajout</span> ' : "") +
          '<span class="pp-txt">' + esc(plusieurs ? (sujet(p, c) || (p.cible === "risque" ? ch.length + " réponses au questionnaire" : ch.length + " informations")) : desc) + "</span>" + (mod ? ' <span class="pp-op mod">corrigé</span>' : "") + "</p>" +
        diff + champs +
        '<p class="pp-src">' + svg("source") + "<span>" + esc(p.source || "source non précisée") + "</span></p>" +
        (p.justification ? '<details class="pp-why"><summary>Pourquoi ce changement</summary><p>' + esc(p.justification) + "</p></details>" : "") +
        (editable && !ed ? '<button type="button" class="pp-lnk pp-edit-btn" data-edit="' + esc(p.id) + '">Modifier</button>' : "") +
      "</div></li>";
  }

  function render(force) {
    if (!root) return;
    const pend = enAttente(), hist = toutes().filter(p => p.statut !== "en_attente");
    pend.forEach(p => { if (!sel.has(p.id)) sel.set(p.id, true); });
    const s = JSON.stringify([S && S.ready, pend.map(p => [p.id, p.apres, p.avant]), hist.map(p => [p.id, p.statut]), S && S.people]);
    if (force || s !== sig) {
      sig = s;
      $("ppEmpty").hidden = !!pend.length || !S || S.ready === false; // pas d'état vide pendant le chargement
      $("ppIntro").hidden = !pend.length;
      $("ppLots").innerHTML = lots().map(L => {
        const groupes = ORDRE_CIBLES.concat([...new Set(L.ps.map(p => p.cible))].filter(c => !ORDRE_CIBLES.includes(c)))
          .map(c => ({ c, ps: L.ps.filter(p => p.cible === c) })).filter(g => g.ps.length);
        return '<section class="panel pp-lot" aria-label="Session du ' + esc(quand(L.date)) + '"><div class="pp-lot-head"><h2>Session du ' + esc(quand(L.date) || "—") + ' <span class="muted">· ' + pluriel(L.ps.length, "proposition") + "</span></h2>" +
          '<button type="button" class="pp-btn ghost" data-lot="' + esc(L.lot) + '">Tout valider</button></div>' +
          groupes.map(g => '<div class="pp-grp"><h3>' + svg(g.c) + "<span>" + esc((CIBLES[g.c] || { label: g.c }).label) + '</span></h3><ul class="pp-list">' + g.ps.map(rowHtml).join("") + "</ul></div>").join("") + "</section>";
      }).join("");
      $("ppHist").hidden = !hist.length;
      $("ppHistN").textContent = hist.length ? "(" + hist.length + ")" : "";
      $("ppHistList").innerHTML = hist.slice().sort((a, b) => ((a.decideLe || a.creeLe || "") < (b.decideLe || b.creeLe || "") ? 1 : -1)).slice(0, 100).map(p =>
        '<li><span class="pp-pill ' + (p.statut === "acceptee" ? "ok" : "no") + '">' + (p.statut === "acceptee" ? "acceptée" : "refusée") + '</span><span class="pp-h-txt">' + esc(decrire(p, ctx())) + '</span><span class="muted small">' + esc(quand(p.decideLe || p.creeLe)) + "</span></li>").join("");
    }
    barre();
  }
  function barre() {
    const n = selection().length, pend = enAttente().length;
    $("ppBar").hidden = !pend;
    $("ppOk").textContent = "Valider la sélection (" + n + ")";
    $("ppOk").disabled = busy || !n || !P();
    $("ppNo").disabled = busy || !n || !P();
    root.querySelectorAll("[data-lot]").forEach(b => { b.disabled = busy || !P(); });
  }
  function dire(m, ok) { const el = $("ppMsg"); el.textContent = m; el.className = "pp-msg " + (ok ? "ok" : "err"); el.hidden = !m; }

  function modifications(ids) {
    const out = {}, c = ctx();
    for (const id of ids) {
      const s = saisies[id]; if (!s || !Object.keys(s).length) continue;
      const p = toutes().find(x => x.id === id); if (!p) continue;
      const r = appliquerSaisies(p, s, c);
      if (r.erreur) return { erreur: r.erreur };
      out[id] = r.apres;
    }
    return { mods: out };
  }
  async function agir(kind, ids) {
    const api = P();
    if (!api) return dire("Les propositions ne sont pas disponibles dans cette vue.");
    if (!ids.length) return;
    let m = {};
    if (kind === "ok") { const r = modifications(ids); if (r.erreur) return dire(r.erreur); m = r.mods; }
    busy = true; barre();
    try {
      if (kind === "ok") {
        const r = await api.appliquer(ids, m);
        const n = r && r.appliquees != null ? (Array.isArray(r.appliquees) ? r.appliquees.length : +r.appliquees) : ids.length;
        dire(pluriel(n, "changement enregistré", "changements enregistrés") + ".", true);
      } else {
        const r = await api.refuser(ids);
        const n = r && r.refusees != null ? (Array.isArray(r.refusees) ? r.refusees.length : +r.refusees) : ids.length;
        dire(pluriel(n, "proposition refusée", "propositions refusées") + " : rien n'a été modifié.", true);
      }
      ids.forEach(id => { sel.delete(id); delete saisies[id]; edition.delete(id); });
    } catch (e) {
      dire((kind === "ok" ? "Validation impossible" : "Refus impossible") + " : " + String((e && e.message) || "erreur").replace(/\.\s*$/, "") + ". Rien n'a été modifié.");
    } finally {
      busy = false;
      render(true);
      if (window.App && App.refreshHeadlines) App.refreshHeadlines();
    }
  }

  function majLigne(id) {
    const li = root.querySelector('.pp-row[data-id="' + CSS.escape(id) + '"]'); if (!li) return;
    const p = toutes().find(x => x.id === id); if (!p) return;
    const r = appliquerSaisies(p, saisies[id], ctx());
    const t = li.querySelector(".pp-txt");
    const plusieurs = enListe(p, changements(p, ctx()));
    if (t && !plusieurs && !r.erreur) t.textContent = decrire(Object.assign({}, p, { apres: r.apres }), ctx());
  }

  function mount(r) {
    root = r;
    root.addEventListener("change", e => {
      const c = e.target.closest("[data-sel]");
      if (c) { sel.set(c.dataset.sel, c.checked); barre(); return; }
      const f = e.target.closest("[data-edit-id]"); if (f) saisir(f);
    });
    root.addEventListener("input", e => { const f = e.target.closest("[data-edit-id]"); if (f) saisir(f); });
    function saisir(f) {
      const id = f.dataset.editId;
      saisies[id] = saisies[id] || {};
      saisies[id][f.dataset.path] = f.multiple ? [...f.selectedOptions].map(o => o.value) : f.value;
      majLigne(id);
    }
    root.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      if (b.dataset.edit) { edition.add(b.dataset.edit); render(true); const i = root.querySelector('[data-edit-id="' + CSS.escape(b.dataset.edit) + '"]'); if (i) i.focus(); return; }
      if (b.dataset.editDone) {
        const id = b.dataset.editDone, p = toutes().find(x => x.id === id);
        const rr = p && saisies[id] ? appliquerSaisies(p, saisies[id], ctx()) : {};
        if (rr.erreur) return dire(rr.erreur);
        // valeurs identiques à la proposition : pas de correction
        if (p && saisies[id] && JSON.stringify(rr.apres) === JSON.stringify(p.apres)) delete saisies[id];
        edition.delete(id); dire(""); render(true);
        const btn = root.querySelector('[data-edit="' + CSS.escape(id) + '"]'); if (btn) btn.focus();
        return;
      }
      if (b.dataset.editReset) { delete saisies[b.dataset.editReset]; edition.delete(b.dataset.editReset); render(true); return; }
      if (b.dataset.lot) { agir("ok", enAttente().filter(p => (p.lot || "sans-lot") === b.dataset.lot).map(p => p.id)); return; }
      if (b.id === "ppOk") { agir("ok", selection()); return; }
      if (b.id === "ppNo") { agir("no", selection()); return; }
    });
  }
  function update(snap, visible) { S = snap; dirty = true; if (visible) { render(); dirty = false; } }
  function show() { if (dirty) { render(); dirty = false; } }
  /* Chiffre clé : nombre de propositions en attente (pastille de navigation et bandeau global), "" s'il n'y en a pas. */
  function headline() { const n = enAttente().length; return n ? String(n) : ""; }

  const api = { mount, update, show, headline };
  const reg = () => App.register("propositions", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
