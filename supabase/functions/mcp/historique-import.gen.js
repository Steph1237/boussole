// Fichier généré par scripts/gen-catalogue.mjs (npm run gen) : ne pas modifier à la main.
// Copie du module d'import de l'historique de l'app (HIS2, docs/superpowers/specs/2026-10-16-his2-historique-design.md) : les modules purs de web/src
// (sensible, historique-import) recopiés tels quels, évalués dans cet ordre. Aucune modification : un écart avec l'app est un bug du générateur.
const definitions = {}, modules = {};
function def(nom, fabrique) { definitions[nom] = fabrique; }
function charger(nom) {
  if (modules[nom]) return modules[nom].exports;
  const fabrique = definitions[nom];
  if (!fabrique) throw new Error("historique-import : module inconnu « " + nom + " »");
  const module = modules[nom] = { exports: {} };
  fabrique.call(globalThis, module, module.exports, chemin => charger(chemin.replace(/^.*\//, "").replace(/\.js$/, "")));
  return module.exports;
}

/* ---------- web/src/sensible.js ---------- */
def("sensible", function (module, exports, require) {
/* Filtre de contenu sensible de la mémoire de l'agent : mêmes motifs que public.contenu_sensible
   (supabase/migrations/0009_savoir_memoire.sql) et que SENSIBLE dans supabase/functions/mcp/memoire.ts.
   - IBAN : pays + clé + 11 à 30 caractères, refusé seulement si la correspondance contient au moins IBAN_CHIFFRES_MIN chiffres
     (un ISIN « IE00B4L5Y983 » suivi d'un libellé n'en a que 7) ;
   - carte : trois groupes de 4 chiffres puis 1 à 7 chiffres, espaces seulement, bornés par des non-chiffres ;
   - mots interdits, insensible à la casse.
   Pur, sans DOM. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Sensible = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const SENSIBLE = [
    "[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]){11,30}",
    "(?<![0-9])[0-9]{4} ?[0-9]{4} ?[0-9]{4} ?[0-9]{1,7}(?![0-9])",
    "mot de passe|password|code secret|code pin|identifiant de connexion",
  ];
  /* le motif partagé avec le SQL et le connecteur reste identique (lookbehind) ; côté navigateur il est lu sans lookbehind (Safari < 16.4 refuse la syntaxe) : « pas de chiffre juste avant » devient « début ou non-chiffre » */
  const IBAN_CHIFFRES_MIN = 12;
  const RE_IBAN = new RegExp(SENSIBLE[0], "g"), RE_CARTE = new RegExp(SENSIBLE[1].replace("(?<![0-9])", "(?:^|[^0-9])")), RE_MOTS = new RegExp(SENSIBLE[2], "i");
  const chiffres = s => s.replace(/[^0-9]/g, "").length;
  /** Vrai si le texte ressemble à un IBAN, un numéro de carte ou contient un mot interdit. */
  function estSensible(t) {
    const s = String(t == null ? "" : t);
    for (const m of s.matchAll(RE_IBAN)) if (chiffres(m[0]) >= IBAN_CHIFFRES_MIN) return true;
    return RE_CARTE.test(s) || RE_MOTS.test(s);
  }
  return { SENSIBLE, IBAN_CHIFFRES_MIN, estSensible };
});
});

/* ---------- web/src/historique-import.js ---------- */
def("historique-import", function (module, exports, require) {
/* HIS2 : import de l'historique réel (docs/superpowers/specs/2026-10-16-his2-historique-design.md § 5 et § 6.3).
   Module pur (UMD, global HistoriqueImport, aucun DOM, aucun réseau) : le connecteur l'exécute avant de déposer une proposition (copie
   générée supabase/functions/mcp/historique-import.gen.js, parité testée) ; appliquer_propositions (migration 0034) répète en SQL les
   contrôles bloquants.

     normaliser(type, entree, contexte?)  → { contenu, erreurs: [{ chemin, message }] }   forme, bornes, textes, clés de catégorie, lignes du bilan
     controler(type, contenu, contexte)   → { bloquants, avertissements, quantites, remplaces, nouveaux, ignores, doublons }
     verifier(type, entree, contexte)     → normaliser, puis controler, empreinte et résumé (une erreur de normalisation est un bloquant)
     empreinte(type, contenu)             → Promise<hex64> (SHA-256 de la forme canonique, § 5.4) ; empreinteSync en est la version immédiate
     clesNaturelles(mouvements)           → mouvements avec cle_import et rang
     doublons(mouvements, transactions, positions?) → [{ transaction_id, mouvement, mouvement_cle, ecart_jours, ecart_eur }]
     resume(type, contenu, controles)     → { texte, … }
     versApres(type, contenu, extras)     → l'objet `apres` de la proposition (contrat de l'en-tête de la migration 0034)
     decouper(type, contenu, max?)        → contenus plus petits quand la proposition dépasse 100 000 octets (par année, puis par 200 mouvements)
     LIMITES, TYPES_MOUVEMENT, TYPES_IMPORT, CATEGORIES_LARGES

   contexte = { today, comptes, releves, banque, imports, positions, transactions, cours, reperes, enveloppes, taxonomie }
   - comptes / releves : lignes de historique_comptes et historique_releves (snake_case ou camelCase) ; imports : [{ id, type, empreinte, importe_le }] ;
   - positions : lignes du bilan { id, name, isin, envelope, owner, mode, qty, status, especes? } ; transactions : { id, positionId, date, type, qty,
     price, amount, frais, enveloppe, source, doublonDe, cleImport, importId } ; cours : { isin: [{ date, cloture }] } ; reperes : [{ cle, valeur }].
   - taxonomie : INTÉGRATION BUD1. Une ligne de relevé est désignée par une clé de la taxonomie de BUD1 (BudgetCategories.largeDe(cle) → catégorie
     large | null). Tant que web/src/budget-categories.js n'est pas dans le dépôt (branche bud1), seules les 12 catégories larges sont admises, stockées avec
     une sous-catégorie vide (spec § 4.3) : contexte.taxonomie = "large". Quand le module sera là, il suffira de le charger avant ce fichier (le global
     BudgetCategories est alors pris tel quel) ou de passer contexte.taxonomie = BudgetCategories ; rien d'autre ne change ici. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HistoriqueImport = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  const Sensible = typeof module === "object" && module.exports && typeof require === "function" ? require("./sensible.js") : root.Sensible;

  /* ---------- limites et listes (spec § 5.3, § 4.4) ---------- */
  const LIMITES = Object.freeze({
    MOIS_PAR_APPEL: 60, LIGNES_PAR_MOIS: 30, MOIS_PAR_COMPTE: 240, COMPTES: 40, IMPORTS: 300,
    ORDRES_PAR_APPEL: 400, LIGNES_PAR_APPEL: 50, QUANTITES_INITIALES: 50, RELEVES_TITRES: 20,
    MOUVEMENTS_PAR_APPEL: 300, RELEVES_VALEUR_PAR_APPEL: 120, SUPPORTS_PAR_RELEVE: 20, MOUVEMENTS_PAR_PROPOSITION: 600,
    TRANSACTIONS_IMPORTEES: 50000, PROPOSITION_OCTETS: 100000, MOUVEMENTS_PAR_LOT: 200, APPELS_PAR_JOUR: 60,
    MONTANT_MAX: 10000000, NOMBRE_MAX: 5000, LIBELLE_COMPTE: 40, LIBELLE_TITRE: 60, LIBELLE_ENVELOPPE: 100, NOTE: 200, SOURCE: 200,
    JUSTIFICATION: 200, NOM_FICHIER: 80, CHIFFRES_COMPTE: 6, CHIFFRES_TITRE: 8,
  });
  const TYPES_MOUVEMENT = ["achat", "vente", "versement", "programme", "retrait", "rachat", "arbitrage_entree", "arbitrage_sortie", "dividende", "interets", "frais", "releve", "solde"];
  const TYPES_IMPORT = { ordres: ["achat", "vente", "releve"], versements: ["versement", "retrait", "rachat", "arbitrage_entree", "arbitrage_sortie", "dividende", "interets", "frais", "releve"] };
  const CATEGORIES_LARGES = ["logement", "alimentation", "transport", "enfants", "sante", "loisirs", "abonnements", "impots", "divers", "revenus", "epargne", "virement_interne"];
  const ETABLISSEMENTS = ["lcl", "boursobank", "revolut", "n26", "linxea", "autre"];
  const TYPES_COMPTE = ["courant", "joint", "livret", "carte_differe", "autre"];
  const TITULAIRES = ["p1", "p2", "commun"];
  const FORMATS = ["csv", "pdf", "ofx", "qif", "xlsx", "autre"];
  const TYPES_ENVELOPPE = ["pea", "pea_pme", "cto"];
  const TYPES_CONTRAT = ["assurance_vie", "per", "pea", "pea_pme", "cto", "livret"];
  /** Sens d'un type de transaction (§ 4.4) pour le contrôle des quantités et la recherche de doublons. */
  const ENTREE = ["achat", "versement", "programme", "arbitrage_entree", "dividende", "interets"];
  const SORTIE = ["vente", "retrait", "rachat", "arbitrage_sortie", "frais"];
  const POUR_DOUBLON_ENTREE = ["achat", "versement", "programme", "arbitrage_entree"];
  const POUR_DOUBLON_SORTIE = ["vente", "retrait", "rachat", "arbitrage_sortie"];
  const SOURCES_REMPLACABLES = ["nightly", "mcp", "manuel"];
  const TOL_QTE = 0.0001;

  /* ---------- outils ---------- */
  const objet = v => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
  const liste = v => (Array.isArray(v) ? v : []);
  const estNombre = v => typeof v === "number" && isFinite(v);
  const r2 = x => Math.round(x * 100 + (x >= 0 ? 1e-9 : -1e-9)) / 100;
  const r8 = x => Math.round(x * 1e8 + (x >= 0 ? 1e-7 : -1e-7)) / 1e8;
  const sansAccent = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "");
  /** Libellé normalisé (clé de compte, d'enveloppe) : minuscules, sans accents, espaces réduits et rognés. */
  const normLibelle = s => sansAccent(s).toLowerCase().replace(/\s+/g, " ").trim();
  const NBSP = "\u00a0", NNBSP = "\u202f";
  const INVISIBLES = /[\u200B-\u200F\u2060\uFEFF]/g;
  const ESPACES_UNICODE = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\t\n\r\f\v]/g;
  const isoOk = s => {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  };
  const moisOk = s => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  const jours = iso => Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);
  const jourIso = n => new Date(n * 86400000).toISOString().slice(0, 10);
  const moisSuivant = m => { const [a, b] = m.split("-").map(Number), t = a * 12 + b; return Math.floor(t / 12) + "-" + String(t % 12 + 1).padStart(2, "0"); };
  const dernierJour = m => { const [a, b] = m.split("-").map(Number); return new Date(Date.UTC(a, b, 0)).toISOString().slice(0, 10); };
  const aujourdhui = ctx => {
    const t = ctx && ctx.today;
    if (t instanceof Date) return t.toISOString().slice(0, 10);
    if (typeof t === "string" && /^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    return new Date().toISOString().slice(0, 10);
  };
  const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const moisFr = m => MOIS_FR[+m.slice(5, 7) - 1] + " " + m.slice(0, 4);
  const moisCourt = m => MOIS_COURT[+m.slice(5, 7) - 1] + " " + m.slice(0, 4);
  const jourFr = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
  function nombreFr(n, decimales) {
    const neg = n < 0, a = Math.abs(n);
    const s = a.toFixed(decimales == null ? (Number.isInteger(r2(a)) ? 0 : 2) : decimales);
    const parts = s.split("."), ent = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
    return (neg ? "−" : "") + ent + (parts[1] ? "," + parts[1] : "");
  }
  const eur = n => nombreFr(r2(n)) + NBSP + "€";
  const partsFr = n => {
    const a = r8(Math.abs(n)), s = a.toFixed(8).replace(/\.?0+$/, "").replace(".", ",");
    return s + " part" + (a >= 2 ? "s" : "");
  };
  const pluriel = (n, un, plusieurs) => n + " " + (n > 1 ? plusieurs : un);
  const mediane = v => { const s = v.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  /* SHA-256 synchrone (UTF-8) : même résultat dans le navigateur, sous Node et sous Deno ; le contenu hashé est toujours petit. */
  const K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    const e = unescape(encodeURIComponent(s)), out = new Uint8Array(e.length);
    for (let i = 0; i < e.length; i++) out[i] = e.charCodeAt(i);
    return out;
  }
  function sha256Hex(texte) {
    const m = utf8(String(texte)), l = m.length, n = ((l + 9 + 63) >> 6) << 6, b = new Uint8Array(n);
    b.set(m); b[l] = 0x80;
    const dv = new DataView(b.buffer);
    dv.setUint32(n - 8, Math.floor(l / 0x20000000)); dv.setUint32(n - 4, (l << 3) >>> 0);
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Array(64);
    const rr = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b2, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & b2) ^ (a & c) ^ (b2 & c), t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b2; b2 = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b2) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
  /** JSON.stringify d'un objet aux clés triées à tous les niveaux (forme canonique des empreintes, § 5.4). */
  function canonique(v) {
    if (Array.isArray(v)) return "[" + v.map(canonique).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canonique(v[k])).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  const octets = v => utf8(JSON.stringify(v)).length;

  /* ---------- ISIN (même algorithme que public.historique_isin_valide) ---------- */
  function isinValide(p) {
    if (typeof p !== "string") return false;
    if (/^X-[A-Za-z0-9._=-]{1,30}$/.test(p)) return true;
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(p)) return false;
    let s = "";
    for (const c of p) s += /[0-9]/.test(c) ? c : String(c.charCodeAt(0) - 55);
    let somme = 0, dbl = false;
    for (let i = s.length - 1; i >= 0; i--) {
      let d = +s[i];
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      somme += d; dbl = !dbl;
    }
    return somme % 10 === 0;
  }
  const isinNorm = v => (typeof v === "string" ? v.replace(/\s+/g, "").toUpperCase() : null);

  /* ---------- textes et nombres bornés (mêmes règles que historique_texte et historique_nombre) ---------- */
  const rogner = s => s.replace(INVISIBLES, "").replace(/\s+/g, " ").trim();
  /** Vrai si le texte ressemble à un IBAN, un numéro de carte ou contient un mot interdit (public.historique_sensible). */
  function sensible(t, separateurs) {
    const s = String(t == null ? "" : t), e = s.replace(INVISIBLES, "").replace(ESPACES_UNICODE, " ");
    if (Sensible.estSensible(s) || Sensible.estSensible(e)) return true;
    return separateurs !== false && Sensible.estSensible(e.replace(/([0-9A-Za-z])[-./_]+(?=[0-9])/g, "$1 "));
  }
  const MSG_SENSIBLE = " : contenu sensible refusé (numéro de compte ou de carte, mot de passe) ; retire-le et garde seulement un nom court.";
  /** Texte rogné ou null ; pousse une erreur { chemin, message } sinon. opts = { requis, chiffres }. */
  function texte(v, chemin, max, opts, err) {
    const o = opts || {};
    if (v === undefined || v === null) { if (o.requis) err.push({ chemin, message: chemin + " : texte attendu." }); return null; }
    if (typeof v !== "string") { err.push({ chemin, message: chemin + " : texte attendu." }); return null; }
    const t = rogner(v);
    if (t === "") { if (o.requis) err.push({ chemin, message: chemin + " : texte attendu." }); return null; }
    if (t.length > max) { err.push({ chemin, message: chemin + " : " + max + " caractères au plus (" + t.length + " donnés)." }); return null; }
    if (sensible(t)) { err.push({ chemin, message: chemin + MSG_SENSIBLE }); return null; }
    if (o.chiffres && new RegExp("[0-9]{" + o.chiffres + ",}").test(t.replace(INVISIBLES, ""))) {
      err.push({ chemin, message: chemin + " : une suite de " + o.chiffres + " chiffres ou plus est refusée (pas de numéro dans un libellé)." });
      return null;
    }
    return t;
  }
  /** Nombre fini borné ou undefined ; pousse une erreur sinon. */
  function nombre(v, chemin, min, max, requis, err) {
    if (v === undefined || v === null) { if (requis) err.push({ chemin, message: chemin + " : nombre attendu." }); return undefined; }
    if (!estNombre(v)) { err.push({ chemin, message: chemin + " : nombre attendu (pas une chaîne)." }); return undefined; }
    if (v < min || v > max) {
      err.push({ chemin, message: chemin + " : " + nombreFr(v) + " est hors limites (de " + nombreFr(min) + " à " + nombreFr(max) + ")." });
      return undefined;
    }
    return v;
  }
  const enumeration = (v, liste_, chemin, err, message) => {
    if (typeof v === "string" && liste_.includes(v)) return v;
    err.push({ chemin, message: chemin + " : " + (message || "valeur invalide (" + liste_.join(", ") + ")") + "." });
    return null;
  };
  /** Nom de fichier : toute suite de 8 chiffres ou plus masquée (•••), 80 caractères au plus. */
  function nomFichier(v, chemin, err) {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string") { err.push({ chemin, message: chemin + " : texte attendu." }); return null; }
    const t = rogner(v).replace(/[0-9]{8,}/g, "•••").slice(0, LIMITES.NOM_FICHIER);
    if (sensible(t)) { err.push({ chemin, message: chemin + MSG_SENSIBLE }); return null; }
    return t || null;
  }
  function fichier(v, err) {
    const o = objet(v);
    if (!o) { err.push({ chemin: "fichier", message: "fichier : objet attendu ({ format, periode, nom?, lignes?, octets?, sha256? })." }); return { format: "autre" }; }
    const out = { format: enumeration(o.format, FORMATS, "fichier.format", err) || "autre" };
    const nom = nomFichier(o.nom, "fichier.nom", err);
    if (nom) out.nom = nom;
    const lignes = nombre(o.lignes, "fichier.lignes", 0, 1000000, false, err);
    if (lignes !== undefined) out.lignes = lignes;
    const oct = nombre(o.octets, "fichier.octets", 0, 1000000000, false, err);
    if (oct !== undefined) out.octets = oct;
    if (o.sha256 !== undefined && o.sha256 !== null) {
      if (typeof o.sha256 === "string" && /^[0-9a-f]{64}$/.test(o.sha256)) out.sha256 = o.sha256;
      else err.push({ chemin: "fichier.sha256", message: "fichier.sha256 : SHA-256 en hexadécimal (64 caractères) attendu." });
    }
    const p = objet(o.periode);
    if (p) {
      if (isoOk(p.du) && isoOk(p.au)) out.periode = { du: p.du, au: p.au };
      else err.push({ chemin: "fichier.periode", message: "fichier.periode : { du, au } attendu (AAAA-MM-JJ)." });
    }
    return out;
  }
  const textesCommuns = (e, err) => {
    const out = { source: texte(e.source, "source", LIMITES.SOURCE, { requis: true, chiffres: 8 }, err) };
    const j = texte(e.justification, "justification", LIMITES.JUSTIFICATION, { chiffres: 8 }, err);
    if (j) out.justification = j;
    if (e.accord_utilisateur !== true) err.push({ chemin: "accord_utilisateur", message: "accord_utilisateur : true attendu, une fois le récapitulatif montré et accepté par l'utilisateur." });
    return out;
  };

  /* ---------- taxonomie des catégories (INTÉGRATION BUD1) ---------- */
  function taxonomie(ctx) {
    const t = ctx && ctx.taxonomie;
    if (t === "large") return null;
    if (t && typeof t.largeDe === "function") return t;
    const g = typeof globalThis !== "undefined" ? globalThis.BudgetCategories : null; // chargé avant ce fichier quand BUD1 est là
    return g && typeof g.largeDe === "function" ? g : null;
  }
  function resoudreCle(cle, taxo) {
    if (typeof cle !== "string") return { erreur: "clé de catégorie : texte attendu." };
    if (!taxo) {
      if (CATEGORIES_LARGES.includes(cle)) return { categorie: cle, sous_categorie: "" };
      return { erreur: "la clé « " + cle + " » n'est pas une des 12 catégories larges (" + CATEGORIES_LARGES.join(", ") + ") ; les sous-catégories arrivent avec le budget détaillé." };
    }
    const large = taxo.largeDe(cle);
    if (large) return { categorie: large, sous_categorie: cle };
    return { erreur: "la clé « " + cle + " » n'est pas une sous-catégorie du budget" + (CATEGORIES_LARGES.includes(cle) ? " (une catégorie large seule est refusée : choisis la sous-catégorie)" : "") + "." };
  }

  /* ---------- clés de compte, d'enveloppe, de contrat ---------- */
  const cleCompte = (etab, type, libelle, titulaire) => [etab, type, normLibelle(libelle), titulaire].join("|");
  const camel = (o, a, b) => (o[a] !== undefined ? o[a] : o[b]);
  const posId = p => p.id;
  const sameEnv = (a, b) => normLibelle(a) === normLibelle(b);
  function ligneDe(positions, isin, envelope, owner) {
    const L = liste(positions).filter(p => p && p.isin === isin && sameEnv(p.envelope, envelope) && p.owner === owner && p.status !== "à recevoir");
    return L.find(p => p.status !== "clôturé") || L[0] || null;
  }
  const RE_ESPECES = /\besp[eè]ces\b|\bliquidit[eé]s?\b|\bcash\b/i;
  /** Ligne d'espèces d'une enveloppe (D6) : ligne marquée especes, ou ligne manuelle de la même enveloppe et du même titulaire nommée « espèces ». */
  function ligneEspeces(positions, envelope, owner) {
    return liste(positions).find(p => p && sameEnv(p.envelope, envelope) && p.owner === owner && p.status !== "à recevoir"
      && (p.especes === true || (!p.isin && p.mode === "manual" && RE_ESPECES.test(sansAccent(p.name || ""))))) || null;
  }

  /* ---------- quantités : sens des types, simulation d'une ligne ---------- */
  const deltaQte = (type, qty) => (ENTREE.includes(type) ? (qty || 0) : SORTIE.includes(type) ? -(qty || 0) : 0);
  /** Évolution de la quantité d'une ligne. evts = [{ date, type, qty, ordre (rang de saisie), chemin? }] ; un relevé (quantité initiale, relevé de titres) ne fait que
      relever la quantité (jamais la baisser), comme le contrôle SQL ; les relevés d'une date passent après ses mouvements, les ventes après les achats.
      → { finale, premiere (date du premier mouvement), negatif: { date, chemin } | null, a(date) → quantité à la fin de cette date }. */
  function simuler(evts, seulementInitiales) {
    const tri = evts.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.type === "releve") - (b.type === "releve")
      || SORTIE.includes(a.type) - SORTIE.includes(b.type) || (a.ordre || 0) - (b.ordre || 0));
    let run = 0, negatif = null;
    const pas = [];
    tri.forEach(ev => {
      if (ev.type === "releve") { if (ev.qty != null && ev.qty > run && (!seulementInitiales || ev.initiale)) run = ev.qty; }
      else {
        run += deltaQte(ev.type, ev.qty);
        if (run < -TOL_QTE && !negatif) negatif = { date: ev.date, chemin: ev.chemin };
      }
      pas.push([ev.date, run]);
    });
    return { finale: run, premiere: tri.length ? tri[0].date : null, negatif,
      a: d => { let q = 0; for (const [dt, v] of pas) { if (dt <= d) q = v; else break; } return q; } };
  }

  /* ---------- clés naturelles des mouvements (§ 5.4) ---------- */
  const fmtNb = v => (v == null ? "" : String(v));
  function cleDe(m, rang) {
    const porteur = m.isin || (m.position_id ? m.position_id : "");
    return sha256Hex([m.enveloppe_cle || "", m.titulaire || "", porteur, m.date, m.type, fmtNb(m.quantite == null ? null : r8(m.quantite)),
      fmtNb(m.prix == null ? null : r8(m.prix)), fmtNb(m.montant == null ? null : r2(m.montant)), rang].join("|")).slice(0, 32);
  }
  /** Mouvements avec cle_import et rang : rang = indice parmi les mouvements identiques sur tous les autres champs, dans l'ordre de saisie. */
  function clesNaturelles(mouvements) {
    const vus = {};
    return mouvements.map(m => {
      const base = [m.enveloppe_cle || "", m.titulaire || "", m.isin || m.position_id || "", m.date, m.type, fmtNb(m.quantite == null ? null : r8(m.quantite)),
        fmtNb(m.prix == null ? null : r8(m.prix)), fmtNb(m.montant == null ? null : r2(m.montant))].join("|");
      const rang = vus[base] || 0;
      vus[base] = rang + 1;
      return Object.assign({}, m, { rang, cle_import: cleDe(m, rang) });
    });
  }
  /** Sépare les mouvements déjà présents (clé connue parmi les transactions) des nouveaux. */
  function classerParCle(mouvements, transactions) {
    const connues = new Set(liste(transactions).map(t => camel(t, "cleImport", "cle_import")).filter(Boolean));
    let nouveaux = 0, ignores = 0;
    mouvements.forEach(m => { if (connues.has(m.cle_import)) ignores++; else nouveaux++; });
    return { nouveaux, ignores };
  }

  /* ---------- doublons avec la nuit et les saisies (§ 6.3) ---------- */
  const argentEngage = m => {
    const mt = Math.abs(m.montant || 0), f = m.frais || 0;
    return m.type === "achat" ? mt + f : m.type === "vente" ? mt - f : mt;
  };
  /** Mouvements importés qui doublent une transaction existante de source nightly (programme), mcp ou manuel : même ligne (un mouvement d'enveloppe sans ligne
      ne se compare qu'aux transactions de la même enveloppe sans ligne, ou de sa ligne d'espèces si positions est donné), même sens, 7 jours au plus,
      max(2 € ; 2 %) près de l'argent engagé ; chaque transaction n'est appariée qu'une fois (le plus proche en jours, puis en euros). */
  function doublons(mouvements, transactions, positions) {
    const T = liste(transactions).filter(t => t && camel(t, "doublonDe", "doublon_de") == null && camel(t, "importId", "import_id") == null && SOURCES_REMPLACABLES.includes(t.source));
    const paires = [];
    mouvements.forEach((m, i) => {
      const entree = POUR_DOUBLON_ENTREE.includes(m.type), sortie = POUR_DOUBLON_SORTIE.includes(m.type);
      if (!entree && !sortie) return;
      const engage = argentEngage(m), tol = Math.max(2, 0.02 * engage);
      const esp = !m.position_id && m.enveloppe_nom ? ligneEspeces(positions, m.enveloppe_nom, m.titulaire) : null;
      T.forEach(t => {
        const sensT = POUR_DOUBLON_ENTREE.includes(t.type) ? "e" : POUR_DOUBLON_SORTIE.includes(t.type) ? "s" : null;
        if (sensT !== (entree ? "e" : "s")) return;
        const tp = camel(t, "positionId", "position_id");
        if (m.position_id) { if (tp !== m.position_id) return; }
        else if (!((tp == null && t.enveloppe && sameEnv(t.enveloppe, m.enveloppe_nom || m.enveloppe_cle)) || (esp && tp === posId(esp)))) return;
        const dj = Math.abs(jours(t.date.slice(0, 10)) - jours(m.date)), de = Math.abs(engage - Math.abs(+t.amount || 0));
        if (dj <= 7 && de <= tol + 1e-9) paires.push({ i, t, dj, de });
      });
    });
    paires.sort((a, b) => a.dj - b.dj || a.de - b.de || a.i - b.i);
    const tPris = new Set(), mPris = new Set(), out = [];
    paires.forEach(p => {
      if (tPris.has(p.t.id) || mPris.has(p.i)) return;
      tPris.add(p.t.id); mPris.add(p.i);
      out.push({ transaction_id: p.t.id, mouvement: p.i, mouvement_cle: mouvements[p.i].cle_import, ecart_jours: p.dj, ecart_eur: r2(p.de) });
    });
    return out.sort((a, b) => a.mouvement - b.mouvement);
  }

  /* ---------- normalisation ---------- */
  const ouvreEnveloppe = (e, chemin, err) => {
    const o = objet(e);
    if (!o) { err.push({ chemin, message: chemin + " : objet attendu." }); return null; }
    return o;
  };
  function etablissement(o, chemin, err) {
    const etab = enumeration(o.etablissement, ETABLISSEMENTS, chemin + ".etablissement", err);
    const libre = texte(o.etablissement_libre, chemin + ".etablissement_libre", 40, { chiffres: 6 }, err);
    if (libre && etab !== "autre") err.push({ chemin: chemin + ".etablissement_libre", message: chemin + ".etablissement_libre : seulement pour l'établissement « autre »." });
    return { etablissement: etab, etablissement_libre: libre && etab === "autre" ? libre : undefined };
  }

  function normaliserReleves(e, ctx, err) {
    const taxo = taxonomie(ctx), contenu = { type: "releves" };
    // compte : par identifiant (compte déjà connu) ou par description
    const c = ouvreEnveloppe(e.compte, "compte", err) || {};
    const rattaches = {};
    if (c.banque_compte_id !== undefined && c.banque_compte_id !== null) {
      const b = nombre(c.banque_compte_id, "compte.banque_compte_id", 1, 9007199254740991, true, err);
      if (b !== undefined && !Number.isInteger(b)) err.push({ chemin: "compte.banque_compte_id", message: "compte.banque_compte_id : entier attendu." });
      else if (b !== undefined) rattaches.banque_compte_id = b;
    }
    if (c.position_id !== undefined && c.position_id !== null) {
      if (typeof c.position_id === "string" && c.position_id.length >= 1 && c.position_id.length <= 64) rattaches.position_id = c.position_id;
      else err.push({ chemin: "compte.position_id", message: "compte.position_id : identifiant de ligne attendu." });
    }
    if (c.id !== undefined && c.id !== null) {
      const connu = liste(ctx && ctx.comptes).find(x => x && String(x.id) === String(c.id));
      if (!connu) err.push({ chemin: "compte.id", message: "compte.id : compte « " + c.id + " » introuvable parmi tes comptes importés (décris-le avec libelle, etablissement, type et titulaire)." });
      else {
        contenu.compte = Object.assign({ id: String(connu.id), libelle: connu.libelle, etablissement: connu.etablissement, type: connu.type, titulaire: connu.titulaire,
          cle: connu.cle || cleCompte(connu.etablissement, connu.type, connu.libelle, connu.titulaire) }, connu.etablissement_libre ? { etablissement_libre: connu.etablissement_libre } : {}, rattaches);
      }
      ["libelle", "type", "titulaire"].forEach(k => { if (c[k] !== undefined) err.push({ chemin: "compte." + k, message: "compte." + k + " : avec un identifiant, seuls banque_compte_id et position_id peuvent suivre." }); });
    } else {
      const libelle = texte(c.libelle, "compte.libelle", LIMITES.LIBELLE_COMPTE, { requis: true, chiffres: LIMITES.CHIFFRES_COMPTE }, err);
      if (libelle && libelle.length < 2) err.push({ chemin: "compte.libelle", message: "compte.libelle : 2 caractères au moins." });
      const etab = etablissement(c, "compte", err);
      const type = enumeration(c.type, TYPES_COMPTE, "compte.type", err);
      const tit = enumeration(c.titulaire, TITULAIRES, "compte.titulaire", err);
      if (libelle && etab.etablissement && type && tit) {
        contenu.compte = Object.assign({ libelle, etablissement: etab.etablissement, type, titulaire: tit, cle: cleCompte(etab.etablissement, type, libelle, tit) },
          etab.etablissement_libre ? { etablissement_libre: etab.etablissement_libre } : {}, rattaches);
      }
    }
    contenu.fichier = fichier(e.fichier, err);
    Object.assign(contenu, textesCommuns(e, err));
    // mois
    const M = e.mois;
    contenu.mois = [];
    if (!Array.isArray(M) || M.length === 0) err.push({ chemin: "mois", message: "mois : 1 à " + LIMITES.MOIS_PAR_APPEL + " mois attendus." });
    else if (M.length > LIMITES.MOIS_PAR_APPEL) err.push({ chemin: "mois", message: "mois : " + LIMITES.MOIS_PAR_APPEL + " mois au plus par appel (" + M.length + " donnés) ; découpe par année et fais un appel par année." });
    else {
      M.forEach((m, i) => {
        const ch = "mois[" + i + "]", o = objet(m);
        if (!o) { err.push({ chemin: ch, message: ch + " : objet attendu." }); return; }
        if (!moisOk(o.mois)) { err.push({ chemin: ch + ".mois", message: ch + ".mois : « " + (o.mois == null ? "" : o.mois) + " » invalide (AAAA-MM attendu)." }); return; }
        const compl = typeof o.complet === "boolean" ? o.complet : (err.push({ chemin: ch + ".complet", message: ch + ".complet : vrai ou faux attendu (le relevé couvre-t-il le mois entier ?)." }), true);
        const ct = objet(o.controle);
        if (!ct) { err.push({ chemin: ch + ".controle", message: ch + ".controle : objet attendu ({ total_entrees, total_sorties, solde_debut?, solde_fin? })." }); return; }
        const controle = {
          total_entrees: nombre(ct.total_entrees, ch + ".controle.total_entrees", 0, LIMITES.MONTANT_MAX, true, err),
          total_sorties: nombre(ct.total_sorties, ch + ".controle.total_sorties", 0, LIMITES.MONTANT_MAX, true, err),
        };
        const sd = nombre(ct.solde_debut, ch + ".controle.solde_debut", -LIMITES.MONTANT_MAX, LIMITES.MONTANT_MAX, false, err);
        const sf = nombre(ct.solde_fin, ch + ".controle.solde_fin", -LIMITES.MONTANT_MAX, LIMITES.MONTANT_MAX, false, err);
        if (sd !== undefined) controle.solde_debut = r2(sd);
        if (sf !== undefined) controle.solde_fin = r2(sf);
        if (controle.total_entrees !== undefined) controle.total_entrees = r2(controle.total_entrees);
        if (controle.total_sorties !== undefined) controle.total_sorties = r2(controle.total_sorties);
        const nbc = nombre(ct.nombre, ch + ".controle.nombre", 0, LIMITES.NOMBRE_MAX, false, err);
        if (nbc !== undefined) { if (!Number.isInteger(nbc)) err.push({ chemin: ch + ".controle.nombre", message: ch + ".controle.nombre : entier attendu." }); else controle.nombre = nbc; }
        const S = o.sous_categories, categories = [];
        if (!Array.isArray(S)) err.push({ chemin: ch + ".sous_categories", message: ch + ".sous_categories : tableau attendu." });
        else if (S.length > LIMITES.LIGNES_PAR_MOIS) err.push({ chemin: ch + ".sous_categories", message: ch + ".sous_categories : " + LIMITES.LIGNES_PAR_MOIS + " lignes au plus par mois (" + S.length + " données) ; regroupe les catégories proches." });
        else {
          const vus = new Set();
          S.forEach((l, j) => {
            const cl = ch + ".sous_categories[" + j + "]", ol = objet(l);
            if (!ol) { err.push({ chemin: cl, message: cl + " : objet attendu." }); return; }
            const r = resoudreCle(ol.cle, taxo);
            if (r.erreur) { err.push({ chemin: cl + ".cle", message: cl + ".cle : " + r.erreur }); return; }
            const k = r.categorie + "|" + r.sous_categorie;
            if (vus.has(k)) { err.push({ chemin: cl + ".cle", message: cl + ".cle : plusieurs lignes pour « " + ol.cle + " » dans " + o.mois + " ; additionne-les avant d'importer." }); return; }
            vus.add(k);
            const ent = nombre(ol.entrees, cl + ".entrees", 0, LIMITES.MONTANT_MAX, true, err), sor = nombre(ol.sorties, cl + ".sorties", 0, LIMITES.MONTANT_MAX, true, err);
            const nb = ol.nombre === undefined || ol.nombre === null ? 0 : nombre(ol.nombre, cl + ".nombre", 0, LIMITES.NOMBRE_MAX, true, err);
            if (nb !== undefined && !Number.isInteger(nb)) { err.push({ chemin: cl + ".nombre", message: cl + ".nombre : entier attendu." }); return; }
            if (ent === undefined || sor === undefined || nb === undefined) return;
            categories.push({ categorie: r.categorie, sous_categorie: r.sous_categorie, entrees: r2(ent), sorties: r2(sor), nombre: nb });
          });
        }
        contenu.mois.push({ mois: o.mois, complet: compl, controle, categories });
      });
    }
    return contenu;
  }

  /** Lignes du bilan d'une enveloppe, pour résoudre un ISIN ou un support. */
  function ligneAvecId(positions, id) { return liste(positions).find(p => p && String(p.id) === String(id)) || null; }

  function normaliserOrdres(e, ctx, err) {
    const contenu = { type: "ordres" };
    const env = ouvreEnveloppe(e.enveloppe, "enveloppe", err) || {};
    const libelle = texte(env.libelle, "enveloppe.libelle", LIMITES.LIBELLE_ENVELOPPE, { requis: true, chiffres: LIMITES.CHIFFRES_TITRE }, err);
    const type = enumeration(env.type, TYPES_ENVELOPPE, "enveloppe.type", err);
    const tit = enumeration(env.titulaire, ["p1", "p2"], "enveloppe.titulaire", err);
    const etab = etablissement(env, "enveloppe", err);
    if (libelle && type && tit && etab.etablissement) {
      contenu.enveloppe = Object.assign({ libelle, type, titulaire: tit, etablissement: etab.etablissement, cle: [etab.etablissement, type, normLibelle(libelle), tit].join("|") },
        etab.etablissement_libre ? { etablissement_libre: etab.etablissement_libre } : {});
    }
    contenu.fichier = fichier(e.fichier, err);
    Object.assign(contenu, textesCommuns(e, err));
    contenu.depuis_ouverture = e.depuis_ouverture === true;
    if (e.depuis_ouverture !== undefined && typeof e.depuis_ouverture !== "boolean") err.push({ chemin: "depuis_ouverture", message: "depuis_ouverture : vrai ou faux attendu." });
    const saisie = { ordres: [], quantites_initiales: [], releves_titres: [] };
    const O = e.ordres;
    if (!Array.isArray(O) || O.length === 0) err.push({ chemin: "ordres", message: "ordres : 1 à " + LIMITES.ORDRES_PAR_APPEL + " ordres attendus." });
    else if (O.length > LIMITES.ORDRES_PAR_APPEL) err.push({ chemin: "ordres", message: "ordres : " + LIMITES.ORDRES_PAR_APPEL + " ordres au plus par appel (" + O.length + " donnés) ; découpe par année et fais un appel par année." });
    else {
      O.forEach((o, i) => {
        const ch = "ordres[" + i + "]", x = objet(o);
        if (!x) { err.push({ chemin: ch, message: ch + " : objet attendu." }); return; }
        if (!isoOk(x.date)) { err.push({ chemin: ch + ".date", message: ch + ".date : « " + (x.date == null ? "" : x.date) + " » invalide (AAAA-MM-JJ attendu)." }); return; }
        const isin = isinNorm(x.isin);
        if (!isinValide(isin)) { err.push({ chemin: ch + ".isin", message: ch + ".isin : « " + (x.isin == null ? "" : x.isin) + " » n'est pas un ISIN valide (format ou clé de contrôle) : relis le code sur l'avis d'opéré." }); return; }
        const sens = enumeration(x.sens, ["achat", "vente"], ch + ".sens", err);
        const q = nombre(x.quantite, ch + ".quantite", 0, 1000000000, true, err), p = nombre(x.prix, ch + ".prix", 0, 1000000000, true, err);
        if (q !== undefined && !(q > 0)) err.push({ chemin: ch + ".quantite", message: ch + ".quantite : supérieure à 0 attendue." });
        if (p !== undefined && !(p > 0)) err.push({ chemin: ch + ".prix", message: ch + ".prix : supérieur à 0 attendu." });
        const frais = nombre(x.frais, ch + ".frais", 0, 10000000, false, err);
        let mt = nombre(x.montant, ch + ".montant", 0, 1000000000, false, err);
        if (x.devise !== undefined && x.devise !== null && (typeof x.devise !== "string" || x.devise.toUpperCase() !== "EUR"))
          err.push({ chemin: ch + ".devise", message: ch + ".devise : seul l'euro est accepté pour l'instant (convertis au taux du jour de l'ordre et dis-le)." });
        const titre = texte(x.libelle_titre, ch + ".libelle_titre", LIMITES.LIBELLE_TITRE, { chiffres: LIMITES.CHIFFRES_TITRE }, err);
        if (!sens || !(q > 0) || !(p > 0)) return;
        const calc = q * p;
        if (mt === undefined) mt = r2(calc);
        else if (Math.abs(mt - calc) > Math.max(1, 0.005 * calc))
          err.push({ chemin: ch + ".montant", message: ch + ".montant : " + eur(mt) + " ne correspond pas à quantité × prix (" + eur(calc) + "), tolérance max(1 € ; 0,5 %)." });
        saisie.ordres.push(Object.assign({ date: x.date, isin, sens, quantite: r8(q), prix: r8(p), montant: r2(mt), frais: r2(frais || 0), i }, titre ? { libelle_titre: titre } : {}));
      });
    }
    const QI = e.quantites_initiales;
    if (QI !== undefined && QI !== null) {
      if (!Array.isArray(QI) || QI.length > LIMITES.QUANTITES_INITIALES) err.push({ chemin: "quantites_initiales", message: "quantites_initiales : " + LIMITES.QUANTITES_INITIALES + " lignes au plus." });
      else QI.forEach((o, i) => {
        const ch = "quantites_initiales[" + i + "]", x = objet(o) || {}, isin = isinNorm(x.isin);
        if (!isinValide(isin)) { err.push({ chemin: ch + ".isin", message: ch + ".isin : « " + (x.isin == null ? "" : x.isin) + " » n'est pas un ISIN valide." }); return; }
        if (!isoOk(x.date)) { err.push({ chemin: ch + ".date", message: ch + ".date : AAAA-MM-JJ attendu." }); return; }
        const q = nombre(x.quantite, ch + ".quantite", 0, 1000000000, true, err);
        if (q === undefined) return;
        saisie.quantites_initiales.push({ isin, quantite: r8(q), date: x.date });
      });
    }
    const RT = e.releves_titres;
    if (RT !== undefined && RT !== null) {
      if (!Array.isArray(RT) || RT.length > LIMITES.RELEVES_TITRES) err.push({ chemin: "releves_titres", message: "releves_titres : " + LIMITES.RELEVES_TITRES + " relevés au plus par appel." });
      else RT.forEach((o, i) => {
        const ch = "releves_titres[" + i + "]", x = objet(o) || {};
        if (!isoOk(x.date)) { err.push({ chemin: ch + ".date", message: ch + ".date : AAAA-MM-JJ attendu." }); return; }
        if (!Array.isArray(x.lignes) || x.lignes.length === 0 || x.lignes.length > LIMITES.LIGNES_PAR_APPEL) { err.push({ chemin: ch + ".lignes", message: ch + ".lignes : 1 à " + LIMITES.LIGNES_PAR_APPEL + " lignes attendues." }); return; }
        const lignes = [];
        x.lignes.forEach((l, j) => {
          const cl = ch + ".lignes[" + j + "]", xl = objet(l) || {}, isin = isinNorm(xl.isin);
          if (!isinValide(isin)) { err.push({ chemin: cl + ".isin", message: cl + ".isin : « " + (xl.isin == null ? "" : xl.isin) + " » n'est pas un ISIN valide." }); return; }
          const q = nombre(xl.quantite, cl + ".quantite", 0, 1000000000, true, err);
          if (q !== undefined) lignes.push({ isin, quantite: r8(q) });
        });
        saisie.releves_titres.push({ date: x.date, lignes });
      });
    }
    contenu.saisie = saisie;
    contenu.mouvements = [];
    contenu.lignes_a_creer = [];
    if (!contenu.enveloppe) return contenu;
    const E = contenu.enveloppe, base = { enveloppe_cle: normLibelle(E.libelle), enveloppe_nom: E.libelle, titulaire: E.titulaire };
    const positions = ctx && ctx.positions;
    const lignes = {};
    const ligneIsin = isin => { if (!(isin in lignes)) lignes[isin] = positions ? ligneDe(positions, isin, E.libelle, E.titulaire) : null; return lignes[isin]; };
    const brut = [];
    saisie.ordres.forEach(o => brut.push(Object.assign({}, base, { type: o.sens, date: o.date, isin: o.isin, quantite: o.quantite, prix: o.prix, montant: o.montant, frais: o.frais, libelle_titre: o.libelle_titre,
      chemin: "ordres[" + o.i + "]", ordre: o.i })));
    saisie.quantites_initiales.forEach((q, i) => brut.push(Object.assign({}, base, { type: "releve", date: q.date, isin: q.isin, quantite: q.quantite, note: "quantité initiale", initiale: true, ordre: 100000 + i })));
    saisie.releves_titres.forEach((r, i) => r.lignes.forEach((l, j) => brut.push(Object.assign({}, base, { type: "releve", date: r.date, isin: l.isin, quantite: l.quantite, note: "relevé de titres", ordre: 200000 + i * 1000 + j }))));
    if (brut.length > LIMITES.MOUVEMENTS_PAR_PROPOSITION) {
      err.push({ chemin: "ordres", message: "ordres : " + brut.length + " mouvements (ordres, quantités initiales et relevés de titres) ; " + LIMITES.MOUVEMENTS_PAR_PROPOSITION + " au plus par import, découpe par année." });
      return contenu;
    }
    // quantité nette par ISIN (quantités initiales comprises) : une ligne absente du bilan et à zéro est une ligne clôturée à créer
    const parIsin = {};
    brut.forEach(m => { (parIsin[m.isin] = parIsin[m.isin] || []).push({ date: m.date, type: m.type, qty: m.quantite, ordre: m.ordre, initiale: m.initiale }); });
    const noms = {};
    brut.forEach(m => { if (m.libelle_titre && !noms[m.isin]) noms[m.isin] = m.libelle_titre; });
    Object.keys(parIsin).forEach(isin => {
      const lg = ligneIsin(isin);
      if (!lg && positions && Math.abs(simuler(parIsin[isin], true).finale) <= TOL_QTE) {
        contenu.lignes_a_creer.push({ isin, name: noms[isin] || "Titre clôturé " + isin.slice(-4), envelope: E.libelle, owner: E.titulaire, mode: "market", qty: 0, status: "clôturé" });
      }
    });
    const creer = new Set(contenu.lignes_a_creer.map(l => l.isin));
    contenu.mouvements = clesNaturelles(brut.map(m => {
      const lg = ligneIsin(m.isin);
      return Object.assign(m, { position_id: lg ? posId(lg) : null, a_creer: creer.has(m.isin) });
    }));
    return contenu;
  }

  function normaliserVersements(e, ctx, err) {
    const contenu = { type: "versements" };
    const c = ouvreEnveloppe(e.contrat, "contrat", err) || {};
    const positions = ctx && ctx.positions;
    const type = enumeration(c.type, TYPES_CONTRAT, "contrat.type", err);
    const tit = enumeration(c.titulaire, TITULAIRES, "contrat.titulaire", err);
    const etab = etablissement(c, "contrat", err);
    let envelope = texte(c.enveloppe, "contrat.enveloppe", LIMITES.LIBELLE_ENVELOPPE, { chiffres: LIMITES.CHIFFRES_TITRE }, err);
    let ligne = null;
    if (c.position_id !== undefined && c.position_id !== null) {
      if (typeof c.position_id !== "string" || !c.position_id) err.push({ chemin: "contrat.position_id", message: "contrat.position_id : identifiant de ligne attendu." });
      else if (positions) {
        ligne = ligneAvecId(positions, c.position_id);
        if (!ligne) err.push({ chemin: "contrat.position_id", message: "contrat.position_id : ligne « " + c.position_id + " » introuvable dans ton bilan." });
        else envelope = ligne.envelope || envelope;
      }
    }
    if (!envelope && !ligne && !(c.position_id)) err.push({ chemin: "contrat", message: "contrat : position_id ou enveloppe attendu." });
    if (!envelope && c.position_id && !ligne && !positions) envelope = null;
    if (type && tit && etab.etablissement && (envelope || c.position_id)) {
      contenu.contrat = Object.assign({ type, titulaire: tit, etablissement: etab.etablissement, enveloppe: envelope || null },
        c.position_id ? { position_id: String(c.position_id) } : {}, etab.etablissement_libre ? { etablissement_libre: etab.etablissement_libre } : {});
      contenu.contrat.cle = c.position_id ? [etab.etablissement, type, c.position_id, tit].join("|") : [etab.etablissement, type, normLibelle(envelope), tit].join("|");
    }
    contenu.fichier = fichier(e.fichier, err);
    Object.assign(contenu, textesCommuns(e, err));
    contenu.depuis_ouverture = e.depuis_ouverture === true;
    if (e.depuis_ouverture !== undefined && typeof e.depuis_ouverture !== "boolean") err.push({ chemin: "depuis_ouverture", message: "depuis_ouverture : vrai ou faux attendu." });
    const saisie = { mouvements: [], releves: [] };
    const supportNorm = (s, ch) => {
      const o = objet(s);
      if (!o) { err.push({ chemin: ch, message: ch + " : objet attendu ({ isin?, libelle?, position_id?, quantite? })." }); return null; }
      const out = {};
      if (o.isin !== undefined && o.isin !== null) {
        const isin = isinNorm(o.isin);
        if (!isinValide(isin)) { err.push({ chemin: ch + ".isin", message: ch + ".isin : « " + o.isin + " » n'est pas un ISIN valide." }); return null; }
        out.isin = isin;
      }
      if (o.position_id !== undefined && o.position_id !== null) {
        if (typeof o.position_id !== "string" || !o.position_id) { err.push({ chemin: ch + ".position_id", message: ch + ".position_id : identifiant de ligne attendu." }); return null; }
        out.position_id = o.position_id;
      }
      const lib = texte(o.libelle, ch + ".libelle", LIMITES.LIBELLE_TITRE, { chiffres: LIMITES.CHIFFRES_TITRE }, err);
      if (lib) out.libelle = lib;
      const q = nombre(o.quantite, ch + ".quantite", 0, 1000000000, false, err);
      if (q !== undefined) out.quantite = r8(q);
      return out;
    };
    const MV = e.mouvements;
    if (!Array.isArray(MV) || MV.length === 0) err.push({ chemin: "mouvements", message: "mouvements : 1 à " + LIMITES.MOUVEMENTS_PAR_APPEL + " mouvements attendus." });
    else if (MV.length > LIMITES.MOUVEMENTS_PAR_APPEL) err.push({ chemin: "mouvements", message: "mouvements : " + LIMITES.MOUVEMENTS_PAR_APPEL + " mouvements au plus par appel (" + MV.length + " donnés) ; découpe par année et fais un appel par année." });
    else {
      MV.forEach((m, i) => {
        const ch = "mouvements[" + i + "]", x = objet(m);
        if (!x) { err.push({ chemin: ch, message: ch + " : objet attendu." }); return; }
        if (!isoOk(x.date)) { err.push({ chemin: ch + ".date", message: ch + ".date : « " + (x.date == null ? "" : x.date) + " » invalide (AAAA-MM-JJ attendu)." }); return; }
        const t = enumeration(x.type, TYPES_IMPORT.versements.filter(k => k !== "releve"), ch + ".type", err, "type non admis pour cet import (" + TYPES_IMPORT.versements.filter(k => k !== "releve").join(", ") + " ; les relevés vont dans releves, programme est réservé à la nuit)");
        const mt = nombre(x.montant, ch + ".montant", 0, 1000000000, true, err);
        if (mt !== undefined && !(mt > 0)) err.push({ chemin: ch + ".montant", message: ch + ".montant : supérieur à 0 attendu." });
        const frais = nombre(x.frais, ch + ".frais", 0, 10000000, false, err);
        const sup = x.support === undefined || x.support === null ? undefined : supportNorm(x.support, ch + ".support");
        if (!t || !(mt > 0) || sup === null) return;
        saisie.mouvements.push(Object.assign({ date: x.date, type: t, montant: r2(mt), i }, frais ? { frais: r2(frais) } : {}, sup ? { support: sup } : {}));
      });
    }
    const RV = e.releves;
    if (RV !== undefined && RV !== null) {
      if (!Array.isArray(RV) || RV.length > LIMITES.RELEVES_VALEUR_PAR_APPEL) err.push({ chemin: "releves", message: "releves : " + LIMITES.RELEVES_VALEUR_PAR_APPEL + " relevés au plus par appel." });
      else RV.forEach((r, i) => {
        const ch = "releves[" + i + "]", x = objet(r);
        if (!x) { err.push({ chemin: ch, message: ch + " : objet attendu." }); return; }
        if (!isoOk(x.date)) { err.push({ chemin: ch + ".date", message: ch + ".date : AAAA-MM-JJ attendu." }); return; }
        const v = nombre(x.valeur, ch + ".valeur", 0, 1000000000, true, err);
        const cumul = nombre(x.cumul_versements, ch + ".cumul_versements", 0, 1000000000, false, err);
        const esp = nombre(x.especes, ch + ".especes", 0, 1000000000, false, err);
        const supports = [];
        if (x.supports !== undefined && x.supports !== null) {
          if (!Array.isArray(x.supports) || x.supports.length > LIMITES.SUPPORTS_PAR_RELEVE) err.push({ chemin: ch + ".supports", message: ch + ".supports : " + LIMITES.SUPPORTS_PAR_RELEVE + " supports au plus." });
          else x.supports.forEach((s, j) => {
            const cs = ch + ".supports[" + j + "]", sn = supportNorm(s, cs), vs = nombre(objet(s) && s.valeur, cs + ".valeur", 0, 1000000000, true, err);
            if (sn && vs !== undefined) supports.push(Object.assign(sn, { valeur: r2(vs) }));
          });
        }
        if (v === undefined) return;
        saisie.releves.push(Object.assign({ date: x.date, valeur: r2(v) }, cumul !== undefined ? { cumul_versements: r2(cumul) } : {}, esp !== undefined ? { especes: r2(esp) } : {}, supports.length ? { supports } : {}));
      });
    }
    contenu.saisie = saisie;
    contenu.mouvements = [];
    if (!contenu.contrat) return contenu;
    const C = contenu.contrat, envNom = C.enveloppe;
    const base = { enveloppe_cle: normLibelle(envNom || ""), enveloppe_nom: envNom, titulaire: C.titulaire };
    const esp = positions && envNom ? ligneEspeces(positions, envNom, C.titulaire) : null;
    // la ligne d'un mouvement : support désigné, sinon la ligne du contrat, sinon la ligne d'espèces de l'enveloppe, sinon aucune (mouvement d'enveloppe)
    const resoudre = (support, ch) => {
      if (support && support.position_id) {
        if (positions && !ligneAvecId(positions, support.position_id)) { err.push({ chemin: ch, message: ch + " : ligne « " + support.position_id + " » introuvable dans ton bilan." }); return undefined; }
        return support.position_id;
      }
      if (support && support.isin) {
        const lg = positions && envNom ? ligneDe(positions, support.isin, envNom, C.titulaire) : null;
        if (!lg) { err.push({ chemin: ch, message: ch + " : aucune ligne de ton bilan pour ce support dans « " + envNom + " » ; propose-la d'abord avec upsert_positions." }); return undefined; }
        return posId(lg);
      }
      if (C.position_id) return C.position_id;
      return esp ? posId(esp) : null;
    };
    const brut = [];
    saisie.mouvements.forEach(m => {
      const pid = resoudre(m.support, "mouvements[" + m.i + "].support");
      if (pid === undefined) return;
      brut.push(Object.assign({}, base, { type: m.type, date: m.date, position_id: pid, montant: m.montant, chemin: "mouvements[" + m.i + "]", ordre: m.i },
        m.frais ? { frais: m.frais } : {}, m.support && m.support.isin ? { isin: m.support.isin } : {}, m.support && m.support.quantite ? { quantite: m.support.quantite } : {}));
    });
    saisie.releves.forEach((r, i) => {
      const ch = "releves[" + i + "]";
      if (r.supports && r.supports.length) {
        r.supports.forEach((s, j) => {
          const pid = resoudre(s, ch + ".supports[" + j + "]");
          if (pid === undefined) return;
          brut.push(Object.assign({}, base, { type: "releve", date: r.date, position_id: pid, montant: s.valeur, note: "relevé de valeur", ordre: 1000 + i * 100 + j },
            s.isin ? { isin: s.isin } : {}, s.quantite != null ? { quantite: s.quantite } : {}));
        });
      } else {
        brut.push(Object.assign({}, base, { type: "releve", date: r.date, position_id: C.position_id || null, montant: r.valeur, note: "relevé de valeur", ordre: 1000 + i * 100 }));
      }
      if (r.especes !== undefined) brut.push(Object.assign({}, base, { type: "releve", date: r.date, position_id: esp ? posId(esp) : null, montant: r.especes, note: "especes", ordre: 1000 + i * 100 + 99 }));
    });
    if (brut.length > LIMITES.MOUVEMENTS_PAR_PROPOSITION) {
      err.push({ chemin: "mouvements", message: "mouvements : " + brut.length + " mouvements (relevés de valeur compris) ; " + LIMITES.MOUVEMENTS_PAR_PROPOSITION + " au plus par import, découpe par année." });
      return contenu;
    }
    contenu.mouvements = clesNaturelles(brut.map(m => (m.position_id ? m : Object.assign(m, { enveloppe: m.enveloppe_nom }))));
    return contenu;
  }

  /** Normalise une entrée d'outil (forme de l'outil) en contenu interne ; erreurs de forme, de bornes et de textes avec leur chemin dans l'entrée. */
  function normaliser(type, entree, contexte) {
    const err = [], e = objet(entree);
    if (!e) return { contenu: null, erreurs: [{ chemin: "", message: "contenu : objet attendu." }] };
    let contenu = null;
    if (type === "releves") contenu = normaliserReleves(e, contexte, err);
    else if (type === "ordres") contenu = normaliserOrdres(e, contexte, err);
    else if (type === "versements") contenu = normaliserVersements(e, contexte, err);
    else err.push({ chemin: "type", message: "type d'import inconnu : « " + type + " » (releves, ordres ou versements)." });
    return { contenu, erreurs: err };
  }

  /* ---------- empreinte (§ 5.4) ---------- */
  function formeCanonique(type, c) {
    const nb2 = v => (v == null ? null : r2(v)), nb8 = v => (v == null ? null : r8(v));
    if (type === "releves") {
      return { type, cle: c.compte.cle, contenu: { mois: c.mois.slice().sort((a, b) => (a.mois < b.mois ? -1 : a.mois > b.mois ? 1 : 0)).map(m => ({ mois: m.mois, complet: m.complet,
        controle: { total_entrees: nb2(m.controle.total_entrees), total_sorties: nb2(m.controle.total_sorties), solde_debut: nb2(m.controle.solde_debut), solde_fin: nb2(m.controle.solde_fin), nombre: m.controle.nombre == null ? null : m.controle.nombre },
        lignes: m.categories.slice().sort((a, b) => (a.categorie + "|" + a.sous_categorie < b.categorie + "|" + b.sous_categorie ? -1 : 1)).map(l => ({ categorie: l.categorie, sous_categorie: l.sous_categorie, entrees: nb2(l.entrees), sorties: nb2(l.sorties), nombre: l.nombre })) })) } };
    }
    const cmp = (...cles) => (a, b) => { for (const k of cles) { const x = a[k] == null ? "" : a[k], y = b[k] == null ? "" : b[k]; if (x < y) return -1; if (x > y) return 1; } return 0; };
    if (c.partie && type === "ordres") return { type, cle: c.enveloppe.cle, contenu: { depuis_ouverture: !!c.depuis_ouverture, partie: c.partie.slice().sort() } };
    if (type === "ordres") {
      const S = c.saisie;
      return { type, cle: c.enveloppe.cle, contenu: { depuis_ouverture: !!c.depuis_ouverture,
        ordres: S.ordres.slice().sort(cmp("date", "isin", "sens", "quantite", "prix", "montant", "frais")).map(o => ({ date: o.date, isin: o.isin, sens: o.sens, quantite: nb8(o.quantite), prix: nb8(o.prix), montant: nb2(o.montant), frais: nb2(o.frais) })),
        quantites_initiales: S.quantites_initiales.slice().sort(cmp("date", "isin")).map(q => ({ date: q.date, isin: q.isin, quantite: nb8(q.quantite) })),
        releves_titres: S.releves_titres.slice().sort(cmp("date")).map(r => ({ date: r.date, lignes: r.lignes.slice().sort(cmp("isin")).map(l => ({ isin: l.isin, quantite: nb8(l.quantite) })) })) } };
    }
    if (c.partie) return { type, cle: type === "ordres" ? c.enveloppe.cle : c.contrat.cle, contenu: { depuis_ouverture: !!c.depuis_ouverture, partie: c.partie.slice().sort() } };
    const S = c.saisie, sup = s => (s ? { isin: s.isin || null, position_id: s.position_id || null, libelle: s.libelle || null, quantite: nb8(s.quantite) } : null);
    return { type, cle: c.contrat.cle, contenu: { depuis_ouverture: !!c.depuis_ouverture,
      mouvements: S.mouvements.slice().sort(cmp("date", "type", "montant")).map(m => ({ date: m.date, type: m.type, montant: nb2(m.montant), frais: nb2(m.frais || 0), support: sup(m.support) })),
      releves: S.releves.slice().sort(cmp("date")).map(r => ({ date: r.date, valeur: nb2(r.valeur), cumul_versements: nb2(r.cumul_versements), especes: nb2(r.especes),
        supports: liste(r.supports).map(s => Object.assign(sup(s), { valeur: nb2(s.valeur) })).sort(cmp("isin", "position_id", "libelle")) })) } };
  }
  /** SHA-256 hexadécimal de la forme canonique du contenu normalisé : le même contenu relu donne la même empreinte, quels que soient l'ordre de présentation,
      les arrondis (centime, 10⁻⁸), la casse du libellé de compte ; le nom du fichier, la source et la justification n'y entrent pas. */
  function empreinteSync(type, contenu) { return sha256Hex(canonique(formeCanonique(type, contenu))); }
  function empreinte(type, contenu) { return Promise.resolve().then(() => empreinteSync(type, contenu)); }

  /* ---------- contrôles ---------- */
  const bloq = (chemin, message) => ({ chemin, message });
  const mouvementsDe = contenu => liste(contenu && contenu.mouvements);
  const repere = (ctx, cle) => { const r = liste(ctx && ctx.reperes).find(x => x && x.cle === cle); return r && isFinite(+r.valeur) ? +r.valeur : null; };

  /** Mois déjà importés du compte (en-têtes de historique_releves) : { mois: { solde_debut, solde_fin, total_sorties, complet, import_id } } ; compte retrouvé par id, sinon par clé. */
  function moisConnus(contenu, ctx) {
    const c = contenu.compte || {};
    const compte = liste(ctx && ctx.comptes).find(x => x && ((c.id && String(x.id) === String(c.id)) || (!c.id && c.cle && (x.cle || cleCompte(x.etablissement, x.type, x.libelle, x.titulaire)) === c.cle)));
    const out = {};
    if (!compte) return out;
    liste(ctx && ctx.releves).forEach(r => {
      if (!r || String(camel(r, "compteId", "compte_id")) !== String(compte.id)) return;
      const m = String(r.mois).slice(0, 7);
      out[m] = { solde_debut: r.solde_debut == null ? null : +r.solde_debut, solde_fin: r.solde_fin == null ? null : +r.solde_fin, total_sorties: +r.total_sorties || 0,
        complet: r.complet !== false, import_id: camel(r, "importId", "import_id") };
    });
    return out;
  }
  function dejaImporte(type, contenu, ctx) {
    const emp = empreinteSync(type, contenu);
    const i = liste(ctx && ctx.imports).find(x => x && x.empreinte === emp);
    return i ? { empreinte: emp, importe_le: String(i.importe_le || i.importeLe || "").slice(0, 10) } : { empreinte: emp };
  }

  function controlerReleves(contenu, ctx, out) {
    const auj = aujourdhui(ctx), courant = auj.slice(0, 7), vus = new Set();
    contenu.mois.forEach((m, i) => {
      const ch = "mois[" + i + "]", nom = moisFr(m.mois), ct = m.controle;
      if (m.mois < "2000-01" || m.mois > courant) out.bloquants.push(bloq(ch + ".mois", ch + ".mois : " + m.mois + " est hors de la période admise (de 2000-01 au mois en cours)."));
      if (vus.has(m.mois)) out.bloquants.push(bloq(ch + ".mois", ch + ".mois : " + m.mois + " figure deux fois dans l'appel ; regroupe-le en un seul mois."));
      vus.add(m.mois);
      if (m.mois === courant && m.complet) out.bloquants.push(bloq(ch + ".complet", ch + ".complet : " + nom + " est le mois en cours, il ne peut pas être complet (mets complet: false)."));
      if (ct.total_entrees === undefined || ct.total_sorties === undefined) return;
      const se = r2(m.categories.reduce((a, l) => a + l.entrees, 0)), ss = r2(m.categories.reduce((a, l) => a + l.sorties, 0));
      if (Math.abs(se - ct.total_entrees) > 1) out.bloquants.push(bloq(ch, nom + " : les catégories totalisent " + eur(se) + " d'entrées, le relevé en annonce " + eur(ct.total_entrees) + " (écart de plus de 1 €) ; relis les montants ou le total."));
      if (Math.abs(ss - ct.total_sorties) > 1) out.bloquants.push(bloq(ch, nom + " : les catégories totalisent " + eur(ss) + " de sorties, le relevé en annonce " + eur(ct.total_sorties) + " (écart de plus de 1 €) ; relis les montants ou le total."));
      if (ct.solde_debut !== undefined && ct.solde_fin !== undefined) {
        const attendu = r2(ct.solde_debut + ct.total_entrees - ct.total_sorties);
        if (Math.abs(ct.solde_fin - attendu) > 1) out.bloquants.push(bloq(ch, nom + " : le solde de fin (" + eur(ct.solde_fin) + ") ne correspond pas au solde de début (" + eur(ct.solde_debut) + ") plus les entrées (" + eur(ct.total_entrees) + ") moins les sorties (" + eur(ct.total_sorties) + "), soit " + eur(attendu) + " (à 1 € près)."));
      }
    });
    // mois connus du compte : ceux de l'appel remplacent ceux de l'import précédent
    const connus = moisConnus(contenu, ctx), appel = {};
    contenu.mois.forEach(m => { appel[m.mois] = m; });
    out.remplaces = contenu.mois.filter(m => connus[m.mois]).map(m => ({ mois: m.mois, import_id: connus[m.mois].import_id })).sort((a, b) => (a.mois < b.mois ? -1 : 1));
    const tous = {};
    Object.keys(connus).forEach(m => { tous[m] = connus[m]; });
    contenu.mois.forEach(m => { tous[m.mois] = { solde_debut: m.controle.solde_debut == null ? null : m.controle.solde_debut, solde_fin: m.controle.solde_fin == null ? null : m.controle.solde_fin, total_sorties: m.controle.total_sorties, complet: m.complet }; });
    const ordre = Object.keys(tous).sort();
    // continuité des soldes
    for (let k = 0; k + 1 < ordre.length; k++) {
      const a = ordre[k], b = ordre[k + 1];
      if (b !== moisSuivant(a) || !(appel[a] || appel[b])) continue;
      if (tous[a].solde_fin == null || tous[b].solde_debut == null) continue;
      const ecart = r2(Math.abs(tous[b].solde_debut - tous[a].solde_fin));
      if (ecart > 1) out.avertissements.push({ cle: "continuite_soldes", message: "Écart de " + eur(ecart) + " entre la fin de " + MOIS_FR[+a.slice(5, 7) - 1] + " et le début de " + MOIS_FR[+b.slice(5, 7) - 1] + " : un relevé ou une opération manque-t-il ?", donnees: { avant: a, apres: b, ecart } });
    }
    // trous
    if (ordre.length) {
      const manquants = [];
      for (let m = ordre[0]; m < ordre[ordre.length - 1]; m = moisSuivant(m)) if (!tous[m]) manquants.push(m);
      if (manquants.length) out.avertissements.push({ cle: "trous", message: pluriel(manquants.length, "Un mois manque", "Des mois manquent") + " entre le premier et le dernier mois connus de ce compte : " + manquants.map(moisFr).join(", ") + ".", donnees: { mois: manquants } });
    }
    // mois aberrant
    const complets = ordre.filter(m => tous[m].complet);
    if (complets.length >= 4) {
      const med = mediane(complets.map(m => tous[m].total_sorties));
      contenu.mois.forEach(m => {
        if (m.complet && m.controle.total_sorties > 3 * med && med > 0) {
          out.avertissements.push({ cle: "mois_aberrant", message: "Vérifie " + MOIS_FR[+m.mois.slice(5, 7) - 1] + " : " + eur(m.controle.total_sorties) + " de sorties, pour une médiane de " + eur(med) + " sur les mois connus.", donnees: { mois: m.mois, sorties: m.controle.total_sorties, mediane: r2(med) } });
        }
      });
    }
    // mois que la banque connectée couvre déjà
    const cp = contenu.compte || {}, connu = liste(ctx && ctx.comptes).find(x => x && cp.id && String(x.id) === String(cp.id));
    const bc = cp.banque_compte_id != null ? cp.banque_compte_id : connu && camel(connu, "banqueCompteId", "banque_compte_id");
    if (bc != null && ctx && ctx.banque) {
      const ms = liste(ctx.banque.mois).filter(r => r && String(camel(r, "compteId", "compte_id")) === String(bc)).map(r => String(r.mois).slice(0, 7));
      const premier = ms.slice().sort()[0], couverts = contenu.mois.map(m => m.mois).filter(m => ms.includes(m) && m !== premier);
      if (couverts.length) out.avertissements.push({ cle: "chevauchement_powens", message: pluriel(couverts.length, "Un mois est déjà couvert", "Des mois sont déjà couverts") + " par ta banque connectée (" + couverts.map(moisFr).join(", ") + ") : ils sont importés mais ne seront pas comptés deux fois.", donnees: { mois: couverts } });
    }
  }

  /** Événements d'une ligne : transactions du contexte (hors doublons et hors mouvements déjà importés de cet appel) puis mouvements de l'appel. */
  function evenementsLigne(pid, mouvements, ctx, clesAppel, seulementImportees) {
    const evts = [];
    liste(ctx && ctx.transactions).forEach(t => {
      if (!t || camel(t, "positionId", "position_id") !== pid || camel(t, "doublonDe", "doublon_de") != null) return;
      if (clesAppel.has(camel(t, "cleImport", "cle_import"))) return;
      if (seulementImportees && camel(t, "importId", "import_id") == null && t.source !== "import") return;
      evts.push({ date: String(t.date).slice(0, 10), type: t.type, qty: t.qty == null ? null : +t.qty, ordre: -1 });
    });
    mouvements.forEach(m => { if (m.position_id === pid) evts.push({ date: m.date, type: m.type, qty: m.quantite == null ? null : m.quantite, ordre: m.ordre, chemin: m.chemin, initiale: m.initiale }); });
    return evts;
  }

  function controlerMouvements(type, contenu, ctx, out) {
    const auj = aujourdhui(ctx), M = mouvementsDe(contenu), clesAppel = new Set(M.map(m => m.cle_import));
    const src = type === "ordres" ? contenu.saisie.ordres : contenu.saisie.mouvements;
    const nomsLigne = pid => { const p = ligneAvecId(ctx && ctx.positions, pid); return p ? p.name : "cette ligne"; };
    // dates
    M.forEach(m => {
      if (m.chemin && (m.date < "1990-01-01" || m.date > auj)) out.bloquants.push(bloq(m.chemin + ".date", m.chemin + ".date : " + jourFr(m.date) + " est hors de la période admise (du 01/01/1990 à aujourd'hui)."));
    });
    if (type === "ordres") {
      contenu.saisie.quantites_initiales.forEach((q, i) => { if (q.date < "1990-01-01" || q.date > auj) out.bloquants.push(bloq("quantites_initiales[" + i + "].date", "quantites_initiales[" + i + "].date : " + jourFr(q.date) + " est hors de la période admise.")); });
      contenu.saisie.releves_titres.forEach((r, i) => { if (r.date < "1990-01-01" || r.date > auj) out.bloquants.push(bloq("releves_titres[" + i + "].date", "releves_titres[" + i + "].date : " + jourFr(r.date) + " est hors de la période admise.")); });
    } else {
      contenu.saisie.releves.forEach((r, i) => { if (r.date < "1990-01-01" || r.date > auj) out.bloquants.push(bloq("releves[" + i + "].date", "releves[" + i + "].date : " + jourFr(r.date) + " est hors de la période admise.")); });
    }
    // quantités : jamais négatives, expliquées, relevés de titres
    out.quantites = [];
    const isins = [...new Set(M.filter(m => m.isin && (m.type !== "releve" || type === "ordres")).map(m => m.isin))];
    const lignesCreer = new Set(liste(contenu.lignes_a_creer).map(l => l.isin));
    isins.forEach(isin => {
      const mv = M.filter(m => m.isin === isin);
      const pid = mv[0].position_id, aCreer = lignesCreer.has(isin);
      if (!pid && !aCreer) {
        const net = simuler(mv.map(m => ({ date: m.date, type: m.type, qty: m.quantite, ordre: m.ordre, initiale: m.initiale })), true).finale;
        const nom = (mv.find(m => m.libelle_titre) || {}).libelle_titre;
        out.avertissements.push({ cle: "ligne_absente", message: "Ligne absente de ton bilan pour " + (nom ? "« " + nom + " »" : "l'ISIN " + isin) + " (" + partsFr(net) + " d'après l'historique) : propose-la d'abord avec upsert_positions ou synchronise ta banque, puis relance l'import.", donnees: { isin, quantite: r8(net) } });
        return;
      }
      const evts = pid ? evenementsLigne(pid, mv, ctx, clesAppel, false) : mv.map(m => ({ date: m.date, type: m.type, qty: m.quantite, ordre: m.ordre, chemin: m.chemin, initiale: m.initiale }));
      const sim = simuler(evts, false);
      if (sim.negatif) {
        out.bloquants.push(bloq(sim.negatif.chemin || "ordres", (sim.negatif.chemin || "ordres") + " : quantité négative le " + jourFr(sim.negatif.date) + " pour " + (pid ? nomsLigne(pid) : (mv.find(m => m.libelle_titre) || {}).libelle_titre || "ce titre") + " : il manque des achats ou une quantité initiale (début de l'historique) ; ajoute-la dans quantites_initiales ou demande les ordres antérieurs."));
      }
      // quantité importée : imports précédents de la ligne + cet appel, quantités initiales comprises
      const importee = simuler(evenementsLigne(pid || "?", pid ? mv : [], ctx, clesAppel, true).concat(pid ? [] : mv.map(m => ({ date: m.date, type: m.type, qty: m.quantite, ordre: m.ordre, initiale: m.initiale }))), true).finale;
      const bilan = pid ? ligneAvecId(ctx && ctx.positions, pid) : null;
      const aujourd = bilan ? +bilan.qty || 0 : 0;
      const ecart = r8(aujourd - importee);
      out.quantites.push({ isin, aujourdhui: r8(aujourd), importee: r8(importee), ecart });
      if (Math.abs(ecart) > TOL_QTE) {
        const premiere = mv.map(m => m.date).sort()[0];
        out.avertissements.push({ cle: "quantite_inexpliquee", donnees: { isin, ecart },
          message: ecart > 0 ? partsFr(ecart) + " sans historique pour " + (bilan ? bilan.name : "ce titre") + " : ordres avant le " + jourFr(premiere) + ", ou transfert ? Donne une quantité initiale ou les ordres manquants."
            : "L'historique compte " + partsFr(-ecart) + " de plus qu'aujourd'hui pour " + (bilan ? bilan.name : "ce titre") + " : une vente manque-t-elle ?" });
      }
      // relevés de titres
      mv.filter(m => m.type === "releve" && !m.initiale && m.note === "relevé de titres").forEach(r => {
        const reco = simuler(evts.filter(ev => !(ev.type === "releve" && !ev.initiale)), true).a(r.date);
        if (Math.abs(reco - r.quantite) > TOL_QTE) out.avertissements.push({ cle: "releve_titres", message: "Le relevé de titres du " + jourFr(r.date) + " indique " + partsFr(r.quantite) + " pour " + (bilan ? bilan.name : "ce titre") + ", l'historique en reconstitue " + partsFr(reco) + " : un ordre manque-t-il ou est-il faux ?",
          donnees: { date: r.date, isin, releve: r.quantite, reconstitue: r8(reco) } });
      });
    });
    // prix éloigné du cours du jour
    if (type === "ordres" && ctx && ctx.cours) {
      src.forEach(o => {
        const serie = liste(ctx.cours[o.isin]).filter(c => c && c.cloture > 0 && c.date <= o.date && jours(o.date) - jours(c.date) <= 7).sort((a, b) => (a.date < b.date ? 1 : -1));
        const c = serie[0];
        if (!c) return;
        const ecart = Math.abs(o.prix - c.cloture) / c.cloture;
        if (ecart > 0.2) out.avertissements.push({ cle: "prix_eloigne", message: "Le prix de l'ordre du " + jourFr(o.date) + " (" + eur(o.prix) + ") est éloigné de " + Math.round(ecart * 100) + NBSP + "% du cours (" + eur(c.cloture) + ") : erreur de virgule, de devise ou de ligne ?",
          donnees: { date: o.date, isin: o.isin, prix: o.prix, cours: c.cloture, ecart_pct: Math.round(ecart * 100) } });
      });
    }
    // versements : plafonds, cumul déclaré
    if (type === "versements") {
      const C = contenu.contrat;
      const verse = (t, cles) => (t.type === "versement" || t.type === "programme") && !cles.has(camel(t, "cleImport", "cle_import")) && camel(t, "doublonDe", "doublon_de") == null;
      const deLEnveloppe = (t, env) => {
        if (t.enveloppe && sameEnv(t.enveloppe, env)) return true;
        const p = ligneAvecId(ctx && ctx.positions, camel(t, "positionId", "position_id"));
        return !!p && sameEnv(p.envelope, env);
      };
      const cumulEnv = env => liste(ctx && ctx.transactions).filter(t => t && verse(t, clesAppel) && deLEnveloppe(t, env)).reduce((a, t) => a + Math.abs(+t.amount || 0), 0);
      if (C.type === "pea" || C.type === "pea_pme") {
        const versesAppel = M.filter(m => m.type === "versement").reduce((a, m) => a + m.montant, 0);
        const plafond = repere(ctx, "pea_plafond"), global = repere(ctx, "pea_pme_plafond_global");
        const cumul = r2(versesAppel + cumulEnv(C.enveloppe));
        if (C.type === "pea" && plafond != null && cumul > plafond) out.avertissements.push({ cle: "plafond_pea", message: "Les versements cumulés de cette enveloppe font " + eur(cumul) + ", au-delà du plafond du PEA (" + eur(plafond) + ") : souvent une erreur de lecture ou un doublon.", donnees: { cumul, plafond } });
        if (global != null) {
          const autres = liste(ctx && ctx.enveloppes).filter(x => x && x.titulaire === C.titulaire && (x.type === "pea" || x.type === "pea_pme") && !sameEnv(x.nom, C.enveloppe));
          const total = r2(cumul + autres.reduce((a, x) => a + cumulEnv(x.nom), 0));
          if (total > global && (autres.length || C.type === "pea_pme")) out.avertissements.push({ cle: "plafond_pea_pme", message: "Les versements cumulés " + (autres.length ? "du PEA et du PEA-PME" : "du PEA-PME") + " font " + eur(total) + ", au-delà du plafond de " + eur(global) + " : souvent une erreur de lecture.", donnees: { cumul: total, plafond: global } });
        }
      }
      contenu.saisie.releves.forEach(r => {
        if (r.cumul_versements === undefined) return;
        const net = (list_ => list_.reduce((a, m) => a + (m.type === "versement" ? m.montant : (m.type === "retrait" || m.type === "rachat") ? -m.montant : 0), 0))(M.filter(m => m.type !== "releve" && m.date <= r.date));
        const autres = liste(ctx && ctx.transactions).filter(t => t && camel(t, "importId", "import_id") != null && !clesAppel.has(camel(t, "cleImport", "cle_import")) && camel(t, "doublonDe", "doublon_de") == null
          && String(t.date).slice(0, 10) <= r.date && ((C.position_id && camel(t, "positionId", "position_id") === C.position_id) || (C.enveloppe && t.enveloppe && sameEnv(t.enveloppe, C.enveloppe))))
          .reduce((a, t) => a + (t.type === "versement" ? +t.amount : (t.type === "retrait" || t.type === "rachat") ? -t.amount : 0), 0);
        const importe = r2(net + autres), ecart = r2(r.cumul_versements - importe);
        if (Math.abs(ecart) > 1) out.avertissements.push({ cle: "cumul_declare", message: "Le relevé du " + jourFr(r.date) + " annonce " + eur(r.cumul_versements) + " de versements cumulés, l'import en compte " + eur(importe) + " : un versement manque-t-il ?", donnees: { date: r.date, declare: r.cumul_versements, importe, ecart } });
      });
    }
    // lignes à créer mais sans info : rien ; doublons avec la nuit et les saisies
    const d = doublons(M, ctx && ctx.transactions, ctx && ctx.positions);
    out.doublons = d;
    d.forEach(x => out.avertissements.push({ cle: "doublon_probable", message: "Le mouvement du " + jourFr(M[x.mouvement].date) + " ressemble à une transaction déjà présente (" + pluriel(x.ecart_jours, "jour", "jours") + " d'écart, " + eur(x.ecart_eur) + " d'écart) : elle sera remplacée par le mouvement réel à la validation.",
      donnees: { transaction_id: x.transaction_id, mouvement_cle: x.mouvement_cle, ecart_jours: x.ecart_jours, ecart_eur: x.ecart_eur } }));
    const cl = classerParCle(M, ctx && ctx.transactions);
    out.nouveaux = cl.nouveaux; out.ignores = cl.ignores;
  }

  /** Contrôles bloquants et avertissements d'un contenu normalisé (§ 5.1, § 5.2). contexte voir l'en-tête. */
  function controler(type, contenu, contexte) {
    const out = { bloquants: [], avertissements: [], quantites: [], remplaces: [], doublons: [], nouveaux: 0, ignores: 0 };
    if (!contenu) { out.bloquants.push(bloq("", "contenu vide.")); return out; }
    const dej = dejaImporte(type, contenu, contexte);
    if (dej.importe_le) out.bloquants.push(bloq("", "Contenu déjà importé le " + (isoOk(dej.importe_le) ? jourFr(dej.importe_le) : dej.importe_le) + " : rien à refaire."));
    if (type === "releves") controlerReleves(contenu, contexte, out);
    else controlerMouvements(type, contenu, contexte, out);
    return out;
  }

  /* ---------- résumé lisible (tutoiement) ---------- */
  const budgetDuMois = m => {
    let rev = 0, dep = 0, ep = 0;
    m.categories.forEach(l => {
      if (l.categorie === "virement_interne") return;
      if (l.categorie === "revenus") rev += l.entrees - l.sorties; else if (l.categorie === "epargne") ep += l.sorties - l.entrees; else dep += l.sorties - l.entrees;
    });
    return { mois: m.mois, revenus: r2(rev), depenses: r2(dep), epargne: r2(ep), capacite: r2(rev - dep) };
  };
  function resume(type, contenu, controles) {
    const ctl = controles || {}, nAvert = liste(ctl.avertissements).length;
    const fin = nAvert ? " ; " + pluriel(nAvert, "avertissement", "avertissements") : "";
    if (type === "releves") {
      const mois = contenu.mois.slice().sort((a, b) => (a.mois < b.mois ? -1 : 1)), remplaces = liste(ctl.remplaces);
      const entrees = r2(mois.reduce((a, m) => a + (m.controle.total_entrees || 0), 0)), sorties = r2(mois.reduce((a, m) => a + (m.controle.total_sorties || 0), 0));
      const du = mois[0] && mois[0].mois, au = mois[mois.length - 1] && mois[mois.length - 1].mois;
      const partiels = mois.filter(m => !m.complet).map(m => m.mois);
      const texte_ = "Relevés de " + contenu.compte.libelle + " : " + mois.length + " mois" + (du ? ", de " + moisCourt(du) + " à " + moisCourt(au) : "") + " ; entrées " + eur(entrees) + ", sorties " + eur(sorties)
        + (remplaces.length ? " ; " + remplaces.length + " mois remplacé" + (remplaces.length > 1 ? "s" : "") + " (ils écrasent ceux d'un import précédent)" : "") + fin + ".";
      return { texte: texte_, mois: mois.length, du, au, entrees, sorties, partiels, remplaces: remplaces, par_mois: mois.map(budgetDuMois) };
    }
    const M = mouvementsDe(contenu), reels = M.filter(m => m.type !== "releve"), dates = M.map(m => m.date).sort();
    const du = dates[0], au = dates[dates.length - 1];
    if (type === "ordres") {
      const lignes = new Set(M.map(m => m.isin)).size, nouveaux = ctl.nouveaux != null ? ctl.nouveaux : M.length, ignores = ctl.ignores || 0;
      const texte_ = "Ordres de " + contenu.enveloppe.libelle + " : " + pluriel(M.length, "mouvement", "mouvements") + " sur " + pluriel(lignes, "ligne", "lignes") + (du ? ", du " + jourFr(du) + " au " + jourFr(au) : "")
        + (ignores ? " ; " + pluriel(ignores, "déjà connu, ignoré", "déjà connus, ignorés") : "") + (liste(contenu.lignes_a_creer).length ? " ; " + pluriel(contenu.lignes_a_creer.length, "ligne clôturée créée", "lignes clôturées créées") : "") + fin + ".";
      return { texte: texte_, mouvements: M.length, nouveaux, ignores, lignes, du, au, depuis_ouverture: !!contenu.depuis_ouverture };
    }
    const sum = ts => r2(M.filter(m => ts.includes(m.type)).reduce((a, m) => a + (m.montant || 0), 0));
    const versements = sum(["versement"]), retraits = sum(["retrait", "rachat"]), frais = sum(["frais"]);
    const nbReleves = contenu.saisie.releves.length;
    const texte_ = "Versements de " + (contenu.contrat.enveloppe || "ce contrat") + " : " + pluriel(contenu.saisie.mouvements.length, "mouvement", "mouvements") + (nbReleves ? " et " + pluriel(nbReleves, "relevé de valeur", "relevés de valeur") : "")
      + (du ? ", du " + jourFr(du) + " au " + jourFr(au) : "") + " ; versements " + eur(versements) + ", retraits " + eur(retraits) + (frais ? ", frais " + eur(frais) : "") + fin + ".";
    return { texte: texte_, mouvements: contenu.saisie.mouvements.length, releves: nbReleves, versements, retraits, frais, du, au, depuis_ouverture: !!contenu.depuis_ouverture };
  }

  /* ---------- vérification complète et construction de la proposition ---------- */
  /** normaliser, puis controler, empreinte et résumé. Une erreur de normalisation est un bloquant (et arrête les contrôles qui en dépendent). */
  function verifier(type, entree, contexte) {
    const n = normaliser(type, entree, contexte);
    if (n.erreurs.length || !n.contenu) return { contenu: n.contenu, bloquants: n.erreurs, avertissements: [], quantites: [], remplaces: [], doublons: [], nouveaux: 0, ignores: 0, empreinte: null, resume: null };
    const c = controler(type, n.contenu, contexte);
    const res = { contenu: n.contenu, bloquants: c.bloquants, avertissements: c.avertissements, quantites: c.quantites, remplaces: c.remplaces, doublons: c.doublons, nouveaux: c.nouveaux, ignores: c.ignores };
    res.empreinte = empreinteSync(type, n.contenu);
    res.resume = resume(type, n.contenu, res);
    return res;
  }

  const sansUndef = o => { const out = {}; Object.keys(o).forEach(k => { if (o[k] !== undefined && o[k] !== null) out[k] = o[k]; }); return out; };
  function periodeDe(type, contenu, auj) {
    let du, au;
    if (type === "releves") {
      const ms = contenu.mois.map(m => m.mois).sort();
      du = ms[0] + "-01"; au = dernierJour(ms[ms.length - 1]);
    } else {
      const ds = mouvementsDe(contenu).map(m => m.date).sort();
      du = ds[0]; au = ds[ds.length - 1];
    }
    if (au > auj) au = auj;
    if (du > au) du = au;
    return { du, au };
  }
  /** Mouvement au format des transactions de la proposition (contrat de l'en-tête de la migration 0034). */
  function mouvementApres(m) {
    const o = { cle_import: m.cle_import, date: m.date, type: m.type };
    if (m.position_id) o.position_id = m.position_id;
    else if (m.a_creer && m.isin) o.isin = m.isin;
    else if (m.enveloppe_nom) o.enveloppe = m.enveloppe_nom;
    if (m.quantite != null) o.qty = m.quantite;
    if (m.prix != null) o.price = m.prix;
    if (m.montant != null) o.amount = m.montant;
    if (m.frais) o.frais = m.frais;
    if (m.estime) o.estime = true;
    if (m.note) o.note = m.note;
    return o;
  }
  /** Résumé et avertissements tels que la base les garde ensemble (resume jsonb de 4 000 octets au plus, avertissements compris) : ce qui est volumineux est réduit
      (remplacements : les mois seuls ; détail par mois au-delà de 12 mois : omis ; données d'un avertissement : omises au-delà de 400 octets), les avertissements sont
      rognés à 200 caractères et, s'ils ne tiennent pas, les derniers sont résumés par un seul (« + n autres avertissements »). */
  function compacter(resume, avertissements) {
    const res = sansUndef(Object.assign({}, resume || {}));
    if (Array.isArray(res.remplaces)) res.remplaces = res.remplaces.map(r => (r && r.mois) || r);
    if (Array.isArray(res.par_mois) && res.par_mois.length > 12) delete res.par_mois;
    if (Array.isArray(res.partiels) && res.partiels.length > 12) res.partiels = res.partiels.slice(0, 12);
    if (res.texte && res.texte.length > 400) res.texte = res.texte.slice(0, 399) + "…";
    const BUDGET = 3500, avert = [];
    let taille = octets(res) + 120;
    const toutes = liste(avertissements).slice(0, 50);
    for (let i = 0; i < toutes.length; i++) {
      const a = toutes[i];
      let d = a.donnees;
      if (d && octets(d) > 400) d = undefined;
      const x = sansUndef({ cle: a.cle, message: String(a.message || "").slice(0, 200), donnees: d }), t = octets(x) + 1;
      const reste = toutes.length - i;
      if (taille + t > BUDGET - (reste > 1 ? 120 : 0)) {
        if (taille + 120 <= BUDGET + 200) avert.push({ cle: "autres", message: "+ " + reste + " autre" + (reste > 1 ? "s" : "") + " avertissement" + (reste > 1 ? "s" : "") });
        break;
      }
      avert.push(x); taille += t;
    }
    return { res, avert };
  }
  /** L'objet `apres` d'une proposition d'import (opération creer). extras = { empreinte, doublons, resume, avertissements, today } ; resume est le résumé structuré de resume(). */
  function versApres(type, contenu, extras) {
    const x = extras || {}, auj = aujourdhui(x);
    const emp = x.empreinte || empreinteSync(type, contenu);
    const fich = sansUndef(Object.assign({}, contenu.fichier));
    const { res, avert } = compacter(x.resume, x.avertissements);
    const base = { type, empreinte: emp, fichier: fich, periode: periodeDe(type, contenu, auj), resume: res, avertissements: avert };
    if (type === "releves") {
      const c = contenu.compte, compteApres = c.id ? sansUndef({ id: c.id, banque_compte_id: c.banque_compte_id, position_id: c.position_id })
        : sansUndef({ libelle: c.libelle, type: c.type, titulaire: c.titulaire, cle: c.cle, banque_compte_id: c.banque_compte_id, position_id: c.position_id });
      const mois = contenu.mois.slice().sort((a, b) => (a.mois < b.mois ? -1 : 1)).map(m => ({ mois: m.mois, complet: m.complet,
        controle: sansUndef({ total_entrees: m.controle.total_entrees, total_sorties: m.controle.total_sorties, solde_debut: m.controle.solde_debut, solde_fin: m.controle.solde_fin, nombre: m.controle.nombre }),
        categories: m.categories.map(l => ({ categorie: l.categorie, sous_categorie: l.sous_categorie, entrees: l.entrees, sorties: l.sorties, nombre: l.nombre })) }));
      return Object.assign(base, sansUndef({ etablissement: c.etablissement, etablissement_libre: c.etablissement_libre }), { compte: compteApres, donnees: { mois } });
    }
    const E = type === "ordres" ? contenu.enveloppe : contenu.contrat;
    const out = Object.assign(base, sansUndef({ etablissement: E.etablissement, etablissement_libre: E.etablissement_libre }), { enveloppe: type === "ordres" ? E.libelle : E.enveloppe,
      donnees: { mouvements: mouvementsDe(contenu).map(mouvementApres) } });
    if (liste(contenu.lignes_a_creer).length) out.lignes_a_creer = contenu.lignes_a_creer.map(l => ({ isin: l.isin, name: l.name, envelope: l.envelope, owner: l.owner }));
    if (liste(x.doublons).length) out.doublons = x.doublons.map(d => ({ transaction_id: d.transaction_id, mouvement_cle: d.mouvement_cle }));
    return out;
  }

  /* ---------- découpage au-delà de 100 000 octets (§ 4.6) ---------- */
  /** Sépare un contenu normalisé en plusieurs contenus qui tiennent chacun dans une proposition : par année, puis par 200 mouvements (ou par 12 mois,
      puis par mois). Rend [contenu] quand tout tient déjà. La taille est celle de l'objet `apres` (JSON, UTF-8). */
  function decouper(type, contenu, max) {
    const plafond = max || LIMITES.PROPOSITION_OCTETS;
    const tient = c => octets(versApres(type, c, { empreinte: "0".repeat(64), resume: {}, today: "9999-12-31" })) <= plafond;
    if (tient(contenu)) return [contenu];
    if (type === "releves") {
      const parAn = {};
      contenu.mois.forEach(m => { (parAn[m.mois.slice(0, 4)] = parAn[m.mois.slice(0, 4)] || []).push(m); });
      const out = [];
      Object.keys(parAn).sort().forEach(an => {
        const c = Object.assign({}, contenu, { mois: parAn[an] });
        if (tient(c)) out.push(c);
        else parAn[an].forEach(m => out.push(Object.assign({}, contenu, { mois: [m] })));
      });
      return out;
    }
    const M = mouvementsDe(contenu), parAn = {};
    M.forEach(m => { (parAn[m.date.slice(0, 4)] = parAn[m.date.slice(0, 4)] || []).push(m); });
    const out = [];
    // chaque morceau garde la liste des clés de ses mouvements : c'est elle qui fonde son empreinte (le même fichier redécoupé donne les mêmes empreintes)
    const part = (L) => Object.assign({}, contenu, { mouvements: L, partie: L.map(m => m.cle_import), lignes_a_creer: liste(contenu.lignes_a_creer).filter(l => L.some(m => m.isin === l.isin)) });
    Object.keys(parAn).sort().forEach(an => {
      const c = part(parAn[an]);
      if (parAn[an].length <= LIMITES.MOUVEMENTS_PAR_LOT && tient(c)) out.push(c);
      else for (let i = 0; i < parAn[an].length; i += LIMITES.MOUVEMENTS_PAR_LOT) out.push(part(parAn[an].slice(i, i + LIMITES.MOUVEMENTS_PAR_LOT)));
    });
    return out;
  }

  return { LIMITES, TYPES_MOUVEMENT, TYPES_IMPORT, CATEGORIES_LARGES, normaliser, controler, verifier, empreinte, empreinteSync, clesNaturelles, classerParCle, doublons, resume, versApres,
    decouper, compacter, isinValide, sensible, sha256Hex, simuler, ligneEspeces, normLibelle, cleCompte };
});
});

export const HistoriqueImport = charger("historique-import");
