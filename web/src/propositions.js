/* Agent › Propositions : revue des changements déposés par Claude (connecteur MCP) avant enregistrement.
   S.propositions = [{ id, lot, cible, operation: creer|modifier|supprimer, ref, avant, apres, source, justification,
   statut: en_attente|acceptee|refusee, creeLe, decideLe }]. Rien n'est appliqué sans validation :
   Store.propositions.appliquer(ids, { [id]: apresModifie }) et Store.propositions.refuser(ids).
   Les fonctions de description (decrire, changements, sujet) sont pures et exportées pour les tests.
   Réglages (migration 0019) : cible config, apres { cushion?, recurring? } (matelas de précaution, versements programmés en liste
   complète), et clé classes du profil ({ <poche>: <classe> | null }) ; décrits en phrases (« Matelas de précaution : 6 mois de
   dépenses… », « Versement programmé de 200 € le 5 du mois sur PEA · ETF Monde », « Classe de la poche Asie : actions
   émergentes ») et corrigeables avant validation comme les autres cibles (cible du matelas, montant et jour de chaque versement
   ajouté ou modifié, classe). Frais des contrats (0026, outil regler_frais_enveloppe) : apres { frais_enveloppes: { <enveloppe>: { gestion_uc_pct?,
   gestion_euro_pct?, garde_pct?, source, le? } | null } }, décrits en phrase (« Frais du contrat « Assurance-vie » : gestion des unités de
   compte 0,6 % → 0,5 % par an (source : …) ») et corrigeables pourcentage par pourcentage (sauf nom d'enveloppe contenant un point).
   Calendrier patrimonial (0029, outils regler_infos_enveloppe, regler_infos_pret, regler_donations, regler_avis_impot) : apres { enveloppes_infos |
   prets_infos | donations | avis_impot }, décrits en phrases (« Date d'ouverture de « PEA Exemple » : 15/06/2021 (source : …) », « Prêt « Prêt auto » :
   fin le 30/04/2029 », « Donation à Enfant 1 du 01/07/2015 : 20 000 € », « Avis d'impôt (revenus 2025) : … ») ; à valider ou refuser tels quels. */
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
    config: { label: "Réglages", nouveau: "Réglages", suppr: "Retirer" },
  };
  const ORDRE_CIBLES = ["profil", "protection", "budget", "position", "bien", "credit", "objectif", "risque", "config"];
  const NOUV_BUDGET = { depense: "Nouvelle dépense", revenu: "Nouveau revenu", epargne: "Nouvelle épargne" };

  /* ---------- champs connus : libellé, genre (f), nature (k) et options ---------- */
  const OPT = {
    type: [["depense", "dépense"], ["revenu", "revenu"], ["epargne", "épargne"]],
    frequence: [["mois", "par mois"], ["an", "par an"]],
    owner: [["p1", "personne 1"], ["p2", "personne 2"], ["commun", "commun"]],
    statut: [["cadre", "cadre"], ["non-cadre", "non-cadre"]],
    usage: [["rp", "résidence principale"], ["locatif", "locatif"], ["secondaire", "résidence secondaire"]],
    /* Classes d'actifs d'une poche (liste fermée de la migration 0019, CLASSES de web/src/marche.js). */
    classe: [["actions", "actions (monde développé)"], ["small_caps", "actions de petites entreprises"], ["emergents", "actions émergentes"],
      ["levier", "produits à effet de levier"], ["obligations", "obligations"], ["immobilier", "immobilier"], ["monetaire", "monétaire et livrets"],
      ["fonds_euros", "fonds euros"], ["or", "or"], ["crypto", "cryptoactifs"], ["autres", "autres (non classé)"]],
    mode: [["amount", "en montant"], ["months", "en mois de dépenses"]],
  };
  /* Réglages (cible config) : champs de la cible du matelas, et d'un versement programmé. */
  const F_MATELAS = {
    mode: { l: "cible exprimée", f: true, k: "enum" }, min: { l: "minimum", k: "eur" }, max: { l: "maximum", k: "eur" },
    months: { l: "nombre de mois", k: "num" }, depenses: { l: "dépenses mensuelles", f: true, k: "eur" },
  };
  const F_VERSEMENT = { amount: { l: "montant", k: "eur" }, day: { l: "jour du mois", k: "num" } };
  const F_FRAIS_ENV = { gestion_uc_pct: { l: "gestion des unités de compte", k: "pct" }, gestion_euro_pct: { l: "gestion du fonds en euros", k: "pct" },
    garde_pct: { l: "droits de garde", k: "pct" } };
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
    ks.slice(0, -1).forEach(k => { if (!isObj(cur[k]) && !Array.isArray(cur[k])) cur[k] = {}; cur = cur[k]; });
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
    if (p.cible === "profil" && ks[0] === "classes" && ks.length > 1) return { l: "classe de la poche " + ks.slice(1).join("."), f: true, k: "classe", opts: OPT.classe, vide: "classe automatique" };
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
    if (vide(v)) return c && c.vide ? c.vide : c && c.f ? "non renseignée" : "non renseigné";
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
    if (p.cible === "config") return changementsConfig(p);
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
          avant: lire(b, path), apres: plat[path], avantTxt: valeurTxt(lire(b, path), c, sx), apresTxt: valeurTxt(plat[path], c, sx), vide: c.vide || null };
      });
  }

  /* ---------- réglages (cible config) : matelas de précaution et versements programmés ---------- */
  function ch_(path, base, avant, apres) {
    const c = Object.assign({}, base, base.k === "enum" ? { opts: OPT.mode } : null);
    return { path, label: c.l, kind: c.k, opts: c.opts || null, multi: false, avant, apres, avantTxt: valeurTxt(avant, c), apresTxt: valeurTxt(apres, c), vide: null };
  }
  const parId = l => new Map((Array.isArray(l) ? l : []).filter(isObj).map(r => [String(r.id), r]));
  /** Champs corrigeables d'une proposition de réglages : cible du matelas (champs qui changent), montant et jour de chaque
      versement ajouté ou modifié (les versements retirés ne se corrigent pas : refuser la proposition les garde). */
  function changementsConfig(p) {
    const a = commeObjet(p.apres), b = commeObjet(p.avant), out = [];
    if (isObj(a.cushion)) {
      const bc = isObj(b.cushion) ? b.cushion : {};
      ["mode", "min", "max", "months", "depenses"].filter(k => k in a.cushion && (p.operation === "creer" || !egal(bc[k], a.cushion[k])))
        .forEach(k => out.push(ch_("cushion." + k, F_MATELAS[k], bc[k], a.cushion[k])));
    }
    if (isObj(a.frais_enveloppes)) {
      const bf = isObj(b.frais_enveloppes) ? b.frais_enveloppes : {};
      Object.keys(a.frais_enveloppes).filter(env => isObj(a.frais_enveloppes[env]) && env.indexOf(".") < 0).forEach(env => {
        const n = a.frais_enveloppes[env], o = isObj(bf[env]) ? bf[env] : {};
        Object.keys(F_FRAIS_ENV).filter(k => k in n && (p.operation === "creer" || !egal(o[k], n[k])))
          .forEach(k => out.push(ch_("frais_enveloppes." + env + "." + k, { l: F_FRAIS_ENV[k].l + " de « " + env + " »", k: "pct" }, o[k] ?? null, n[k])));
      });
    }
    if (Array.isArray(a.recurring)) {
      const av = parId(b.recurring);
      a.recurring.forEach((r, i) => {
        if (!isObj(r)) return;
        const o = av.get(String(r.id));
        if (o && egal(versementSansSuivi(o), versementSansSuivi(r))) return;
        ["amount", "day"].forEach(k => {
          const c = Object.assign({}, F_VERSEMENT[k], { l: F_VERSEMENT[k].l + " de « " + (r.label || "versement") + " »" });
          out.push(ch_("recurring." + i + "." + k, c, o ? o[k] : null, r[k]));
        });
      });
    }
    return out;
  }
  const versementSansSuivi = r => { const o = Object.assign({}, r); delete o.lastApplied; return o; };
  const matelasRegle = c => isObj(c) && (c.mode === "months" ? +c.months > 0 && +c.depenses > 0 : +c.min > 0);
  /** Cible du matelas en clair : « 6 mois de dépenses (2 500 €/mois, soit 15 000 €) », « 15 000 € à 20 000 € », « au moins 10 000 € ». */
  function texteMatelas(c) {
    if (!matelasRegle(c)) return "aucune cible";
    const e = v => nf.format(Math.round(+v || 0)) + " €";
    if (c.mode === "months") return nf.format(+c.months) + " mois de dépenses (" + e(c.depenses) + "/mois, soit " + e(+c.months * +c.depenses) + ")";
    return c.max != null && c.max !== "" && +c.max > 0 ? e(c.min) + " à " + e(c.max) : "au moins " + e(c.min);
  }
  function ligneDe(id, ctx) {
    const x = ((ctx && ctx.positions) || []).find(q => String(q.id) === String(id));
    return x ? [x.envelope, x.name || x.nom].filter(Boolean).join(" · ") || "une ligne sans nom" : "une ligne introuvable";
  }
  const versementTxt = (r, ctx) => nf.format(+r.amount || 0) + " € le " + (+r.day === 1 ? "1er" : r.day) + " du mois sur " + ligneDe(r.positionId, ctx);
  /** Versements programmés : ajouts, modifications et retraits, comparés par identifiant. */
  function decrireVersements(av, ap, ctx) {
    const avant = parId(av), apres = Array.isArray(ap) ? ap.filter(isObj) : [], ids = new Set(apres.map(r => String(r.id)));
    const parts = [];
    apres.forEach(r => {
      const o = avant.get(String(r.id));
      if (!o) parts.push("Versement programmé de " + versementTxt(r, ctx));
      else if (!egal(versementSansSuivi(o), versementSansSuivi(r))) {
        const x = versementTxt(o, ctx), y = versementTxt(r, ctx);
        parts.push("Versement programmé « " + (r.label || o.label || "sans libellé") + " » : " + (x === y ? "libellé « " + (o.label || "") + " » → « " + (r.label || "") + " »" : x + " → " + y));
      }
    });
    avant.forEach((o, id) => { if (!ids.has(id)) parts.push("Fin du versement programmé de " + versementTxt(o, ctx)); });
    return parts.length ? parts.join(" ; ") : "Versements programmés : aucun changement";
  }
  /** Frais des contrats : une phrase par enveloppe (pourcentages, avant → après, source citée), « retirés » pour null. */
  function decrireFrais(av, ap) {
    const avant = isObj(av) ? av : {}, apres = isObj(ap) ? ap : {}, txt = v => nf.format(+v) + " %";
    const parts = Object.keys(apres).map(env => {
      const n = apres[env], o = isObj(avant[env]) ? avant[env] : {};
      if (!isObj(n)) return "Frais du contrat « " + env + " » : retirés";
      const champs = Object.keys(F_FRAIS_ENV).filter(k => n[k] != null).map(k =>
        F_FRAIS_ENV[k].l + " " + (o[k] != null && !egal(+o[k], +n[k]) ? txt(o[k]) + " → " : "") + txt(n[k]) + " par an");
      return "Frais du contrat « " + env + " » : " + (champs.join(", ") || "aucun pourcentage") + (n.source ? " (source : " + n.source + ")" : "");
    });
    return parts.length ? parts.join(" ; ") : "Frais des contrats : aucun changement";
  }
  /* ---------- calendrier patrimonial (DAT1, 0029) : informations des enveloppes et des prêts, donations, avis d'impôt ---------- */
  const dateNum = d => (/^\d{4}-\d{2}-\d{2}/.test(String(d)) ? String(d).slice(8, 10) + "/" + String(d).slice(5, 7) + "/" + String(d).slice(0, 4) : String(d));
  const eurs = v => nf.format(+v) + " €";
  const TYPES_ENV_TXT = { pea: "PEA", pea_pme: "PEA PME-ETI", pea_jeune: "PEA d'un majeur rattaché", assurance_vie: "assurance-vie", capitalisation: "contrat de capitalisation", per: "PER",
    pel: "PEL", cel: "CEL", pee: "PEE", percol: "PERCOL", compte_titres: "compte-titres", livret_a: "Livret A", ldds: "LDDS", lep: "LEP", autre: "autre enveloppe" };
  const srcTxt = n => (isObj(n) && n.source ? " (source : " + n.source + ")" : "");
  /** Informations d'enveloppes : une phrase par donnée qui change (« Date d'ouverture de « PEA Exemple » : 15/06/2021 »), « retirées » pour null. */
  function decrireInfosEnveloppes(av, ap) {
    const avant = isObj(av) ? av : {}, parts = [];
    Object.keys(isObj(ap) ? ap : {}).forEach(env => {
      const n = ap[env], o = isObj(avant[env]) ? avant[env] : {}, nom = "« " + env.replace(/\|p[12]$/, "") + " »";
      if (!isObj(n)) { parts.push("Informations de " + nom + " : retirées"); return; }
      const ch = [], diff = k => k in n && !egal(o[k], n[k]);
      if (diff("type")) ch.push("Type de " + nom + " : " + (TYPES_ENV_TXT[n.type] || n.type));
      if (diff("titulaire")) ch.push("Titulaire de " + nom + " : " + n.titulaire);
      if (diff("date_ouverture")) ch.push("Date d'ouverture de " + nom + " : " + dateNum(n.date_ouverture));
      if (diff("date_ouverture_approx")) { const a = String(n.date_ouverture_approx); ch.push("Date d'ouverture de " + nom + " : en " + (a.length === 7 ? a.slice(5) + "/" + a.slice(0, 4) : a) + " (approximative)"); }
      if (diff("date_cloture")) ch.push("Clôture de " + nom + " : " + dateNum(n.date_cloture));
      if (diff("versements_cumules")) ch.push("Versements cumulés de " + nom + " : " + eurs(n.versements_cumules));
      if (diff("versements_avant_70")) ch.push("Dont versés avant 70 ans, " + nom + " : " + eurs(n.versements_avant_70));
      if (diff("beneficiaires_revus_le")) ch.push("Clause bénéficiaire de " + nom + " revue le " + dateNum(n.beneficiaires_revus_le));
      if (diff("versements")) ch.push("Versements de " + nom + " : " + (Array.isArray(n.versements) ? n.versements.length : 0) + " ligne" + ((n.versements || []).length > 1 ? "s" : ""));
      if (diff("moins_values")) ch.push("Moins-values de " + nom + " : " + (Array.isArray(n.moins_values) ? n.moins_values.map(m => m.annee + " " + eurs(m.montant)).join(", ") : "aucune"));
      parts.push((ch.join(" ; ") || "Informations de " + nom + " : aucun changement") + srcTxt(n));
    });
    return parts.length ? parts.join(" ; ") : "Informations des enveloppes : aucun changement";
  }
  /** Informations de prêts : « Prêt « Crédit auto » : fin le 30/04/2029, 60 mois (source : …) ». */
  function decrirePrets(av, ap, ctx) {
    const avant = isObj(av) ? av : {}, pr = (ctx && ctx.profil) || {}, parts = [];
    Object.keys(isObj(ap) ? ap : {}).forEach(cle => {
      const m = /^(credit|bien):(.*)$/.exec(cle), liste = m ? (m[1] === "credit" ? pr.credits : pr.biens) || [] : [];
      const e = m ? liste.find(x => String(x.id).toLowerCase() === m[2].toLowerCase()) : null;
      const nom = "Prêt « " + ((e && e.nom) || (m && m[1] === "bien" ? "bien immobilier" : "crédit")) + " »", n = ap[cle], o = isObj(avant[cle]) ? avant[cle] : {};
      if (!isObj(n)) { parts.push(nom + " : informations retirées"); return; }
      const ch = [], diff = k => k in n && !egal(o[k], n[k]), pc = v => nf.format(+v) + " % par an";
      if (diff("date_signature")) ch.push("signé le " + dateNum(n.date_signature));
      if (diff("date_fin")) ch.push("fin le " + dateNum(n.date_fin));
      if (diff("duree_mois")) ch.push(n.duree_mois + " mois");
      if (diff("taux_pct")) ch.push("taux " + pc(n.taux_pct));
      if (diff("assurance_taux_pct")) ch.push("assurance " + pc(n.assurance_taux_pct));
      if (diff("ira_exoneration")) ch.push(n.ira_exoneration ? "sans indemnité de remboursement anticipé" : "avec indemnité de remboursement anticipé");
      parts.push(nom + " : " + (ch.join(", ") || "aucun changement") + srcTxt(n));
    });
    return parts.length ? parts.join(" ; ") : "Prêts : aucun changement";
  }
  /** Donations consenties : ajoutées ou modifiées (« Donation à Enfant 1 du 01/07/2015 : 20 000 € »), retirées. */
  function decrireDonations(av, ap) {
    const avant = parId(av), apres = Array.isArray(ap) ? ap.filter(isObj) : [], ids = new Set(apres.map(r => String(r.id))), parts = [];
    const txt = d => (d.nature === "don_argent_790g" ? "Don familial" : d.nature === "don_logement_790a_bis" ? "Don pour un logement" : "Donation") + " à " + (d.beneficiaire || "?") + " du " + dateNum(d.date) + " : " + eurs(d.montant);
    apres.forEach(d => {
      const o = avant.get(String(d.id));
      if (!o) parts.push(txt(d) + srcTxt(d));
      else if (!egal(o, d)) parts.push(txt(o) + " → " + txt(d));
    });
    avant.forEach((o, id) => { if (!ids.has(id)) parts.push(txt(o) + " : retirée"); });
    return parts.length ? parts.join(" ; ") : "Donations : aucun changement";
  }
  /** Avis d'impôt : « Avis d'impôt (revenus 2025) : revenu fiscal de référence 31 000 €, plafond épargne retraite … ». */
  function decrireAvis(av, ap) {
    if (!isObj(ap) || !Object.keys(ap).length) return "Avis d'impôt : effacé";
    const l = ["Avis d'impôt (revenus " + ap.annee_revenus + ")"], d = [];
    if (ap.rfr != null) d.push("revenu fiscal de référence " + eurs(ap.rfr));
    ["p1", "p2"].forEach(k => { if (isObj(ap.plafonds_per) && Array.isArray(ap.plafonds_per[k]) && ap.plafonds_per[k].length)
      d.push("plafond épargne retraite " + (k === "p1" ? "personne 1" : "personne 2") + " : " + ap.plafonds_per[k].map(x => x.annee + " " + eurs(x.montant)).join(", ")); });
    return l[0] + (d.length ? " : " + d.join(", ") : "") + srcTxt(ap);
  }
  function decrireConfig(p, ctx) {
    const a = commeObjet(p.apres), b = commeObjet(p.avant), parts = [];
    if ("cushion" in a) parts.push("Matelas de précaution : " + (matelasRegle(b.cushion) && !egal(b.cushion, a.cushion) ? texteMatelas(b.cushion) + " → " : "") + texteMatelas(a.cushion));
    if ("recurring" in a) parts.push(decrireVersements(b.recurring, a.recurring, ctx));
    if ("frais_enveloppes" in a) parts.push(decrireFrais(b.frais_enveloppes, a.frais_enveloppes));
    if ("enveloppes_infos" in a) parts.push(decrireInfosEnveloppes(b.enveloppes_infos, a.enveloppes_infos));
    if ("prets_infos" in a) parts.push(decrirePrets(b.prets_infos, a.prets_infos, ctx));
    if ("donations" in a) parts.push(decrireDonations(b.donations, a.donations));
    if ("avis_impot" in a) parts.push(decrireAvis(b.avis_impot, a.avis_impot));
    return parts.length ? parts.join(" ; ") : "Réglages : aucun changement";
  }

  /** Phrase en français : « PEA · Amundi MSCI World : 120 parts → 135 parts », « Nouvelle dépense : Assurance auto 45 €/mois »… */
  function decrire(p, ctx) {
    const C = CIBLES[p.cible] || { label: cap(String(p.cible || "Donnée")), nouveau: "Nouveau", suppr: "Supprimer" };
    if (p.cible === "config") return decrireConfig(p, ctx);
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
    // classe d'une poche sans correction jusqu'ici : la nouvelle classe seule (« Classe de la poche Asie : actions émergentes »)
    return ch.map(c => cap(c.label) + " : " + (c.kind === "classe" && vide(c.avant) ? "" : c.avantTxt + " → ") + c.apresTxt).join(" ; ");
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

  const H = { CIBLES, ORDRE_CIBLES, decrire, changements, sujet, valeurTxt, lireSaisie, appliquerSaisies, aplatir, texteMatelas };
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
    config: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
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
  const enListe = (p, ch) => p.cible !== "config" && ch.length > 1 && (p.operation === "modifier" || !(CIBLES[p.cible] && CIBLES[p.cible].entite));
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
        input = "<select" + att + (x.multi ? " multiple size=\"" + Math.min(6, opts.length) + "\"" : "") + ">" + (x.multi ? "" : '<option value="">' + esc(x.vide || "non renseigné") + "</option>") +
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
  /* La base fusionne les réponses au profil de risque sans recalculer le profil : on le recalcule ici avec le
     même moteur que le questionnaire, pour que le Bilan et les Bonnes pratiques ne gardent pas un profil périmé. */
  async function recalculerRisque() {
    const R = window.Risque, st = window.Store && Store.get(), rq = st && st.risque;
    if (!R || !rq || !rq.reponses) return;
    const ev = R.evaluer(rq.reponses, {});
    if (!ev || ev.profil == null || (rq.profil === ev.profil && rq.score === ev.score)) return;
    await Store.db.doc("profil/main").update({ risque: Object.assign({}, rq, { profil: ev.profil, score: ev.score, date: new Date().toISOString() }) });
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
        const touchesRisque = ((window.Store && Store.get().propositions) || []).some(x => ids.includes(x.id) && x.cible === "risque");
        const r = await api.appliquer(ids, m);
        if (touchesRisque) await recalculerRisque();
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
