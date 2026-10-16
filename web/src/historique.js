/* Historique du patrimoine net : reconstitution du passé, fusion avec les photos observées. Calculs purs,
   aucun accès au DOM ni au réseau (les cours, transactions, relevés et opérations sont lus par les stores et passés en paramètres).

   Reconstitution (reconstituer) : le patrimoine financier de chaque jour (pas "jour") ou de chaque fin de mois (pas "mois"), de la veille
   jusqu'au plus loin que les données permettent (5 ans en pas "jour", 20 ans en pas "mois"), puis net = financier + horsFin (immobilier,
   autres biens et dettes d'aujourd'hui, comme BilanCalc.evolution). Sortes de lignes (périmètre et statuts comme Calc.financier, plus les
   lignes clôturées qui ont des transactions) :
   - cotée : quantité × cours de clôture de la table cours (clé : ISIN, à défaut symbole). La quantité remonte le temps par les
     transactions (deltaTx : types du tableau de la spec HIS2 § 4.4 ; une transaction qui a un doublon_de est ignorée). Sans transaction
     pour la ligne : quantité actuelle (« à composition actuelle »). Avant son premier cours, le prix vient des ordres (prix d'exécution
     comme cours implicites, estimés), à défaut du premier cours. Sans cours ni ordre : constante.
   - espèces d'une enveloppe (D6) : ligne d'espèces (drapeau especes, ou nom « Espèces », « Liquidités », « Cash »), dont le solde passé se
     déduit des mouvements de l'enveloppe, recalé sur le solde d'aujourd'hui (recalageEspeces = solde avant le premier mouvement).
   - bancaire : ligne rattachée à un compte (banque_comptes.position_id, hors crédit et comptes ignorés) dont on a lu les opérations :
     solde(j) = valeur actuelle − opérations postérieures à j ; avant la fenêtre lue (90 jours), le solde importé de chaque fin de mois
     (soldesMois, relevés bancaires importés) quand il existe, interpolé entre deux fins de mois ; sinon tenu constant.
   - à relevés de valeur (assurance-vie en euros, PER) : dernier relevé connu + flux nets depuis ce relevé ; avant le premier relevé, cumul
     des flux nets depuis l'ouverture (enveloppe depuis_ouverture) ; aucun rendement inventé entre deux relevés.
   - constante : toutes les autres, à leur valeur d'aujourd'hui (liquidités saisies, parts, etc.).
   Avant le premier mouvement d'une enveloppe déclarée depuis_ouverture (depuisOuverture : { <enveloppe>: true }) : zéro.
   Chaque contribution dit sa nature (mesuree, estimee, constante) et sa source ; qualite() en tire la qualité d'une photo (spec § 7.3).
   Limites assumées : une transaction non enregistrée, un changement de composition sans transaction ou une ligne constante qui a bougé
   faussent le passé ; le résultat nomme chaque catégorie (drapeaux) pour que l'interface le dise.

   Fusion (fusionner) : l'observé (photos nocturnes + point du jour) l'emporte toujours ; le reconstitué n'est gardé que strictement
   avant la première photo, et décalé (recalage) pour rejoindre cette photo sans cassure — l'écart est rendu (decalage).
   La projection (cône pessimiste / central / optimiste) n'est plus ici : le graphe maître lit le moteur Projection (projection.js).
   Dépendance : Calc (calc.js). */
(function (root, factory) {
  const Calc = typeof module === "object" && module.exports ? require("./calc.js") : root.Calc;
  const api = factory(Calc);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Historique = api;
})(typeof self !== "undefined" ? self : this, function (Calc) {
  "use strict";
  const JOURS_MAX = 1826; // 5 ans (pas "jour")
  const JOURS_MOIS_MAX = 7305; // 20 ans (pas "mois")
  const MOIS_MAX = 240; // 20 ans, le plafond de photos_reconstituees
  const METHODE = "historique@2"; // version du moteur des photos stockées : une nouvelle version recalcule tout
  const MES = "mesuree", EST = "estimee", CST = "constante";
  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
  const jj = s => String(s == null ? "" : s).slice(0, 10);
  const fini = v => v != null && v !== "" && isFinite(+v);
  const utc = s => { const [y, m, d] = jj(s).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const plusJours = (s, k) => iso(utc(s) + k * 864e5);
  const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  function plusMois(s, k) {
    const [y, m, d] = jj(s).split("-").map(Number), t = m - 1 + k, yy = y + Math.floor(t / 12), mm = ((t % 12) + 12) % 12;
    return iso(Date.UTC(yy, mm, Math.min(d, new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate())));
  }
  /** Dernier jour du mois d'une date « AAAA-MM-JJ » ou d'un mois « AAAA-MM ». */
  const finDeMois = s => { const [y, m] = jj(s).split("-").map(Number); return iso(Date.UTC(y, m, 0)); };
  const arrondi = v => Math.round(v * 100) / 100;
  const arrondi6 = v => Math.round(v * 1e6) / 1e6;
  const liste = v => (Array.isArray(v) ? v : []);
  const plat = t => String(t == null ? "" : t).replace(/\s+/g, " ").trim();
  const sansAccent = t => plat(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const cleEnv = sansAccent;
  const camel = (o, a, b) => (o[a] !== undefined && o[a] !== null ? o[a] : o[b]);
  const ENTREES = /achat|versement|programme|apport|souscription/i, SORTIES = /vente|retrait|rachat|cession/i;
  /* Sens des types sur la quantité (spec HIS2 § 4.4, le tableau fait foi) ; un type libre plus ancien se lit encore par ses mots. */
  const TYPES_ENTREE = { achat: 1, versement: 1, programme: 1, arbitrage_entree: 1, dividende: 1, interets: 1 };
  const TYPES_SORTIE = { vente: 1, retrait: 1, rachat: 1, arbitrage_sortie: 1, frais: 1 };
  const doublon = t => camel(t, "doublonDe", "doublon_de") != null;
  /** Variation de quantité d'une transaction (+ entrée, − sortie), 0 si elle n'en dit rien. Un relevé (point de contrôle) et un solde ne sont
      jamais un mouvement ; une transaction qui a un doublon_de est ignorée ; un dividende, des intérêts ou des frais n'ont d'effet que s'ils
      sont réinvestis ou prélevés en parts (quantité renseignée). */
  function deltaTx(t) {
    if (!t || !fini(t.qty) || +t.qty === 0 || doublon(t)) return 0;
    const q = Math.abs(+t.qty), ty = String(t.type == null ? "" : t.type);
    if (ty === "releve" || ty === "solde") return 0;
    if (TYPES_ENTREE[ty]) return q;
    if (TYPES_SORTIE[ty]) return -q;
    return SORTIES.test(ty) ? -q : ENTREES.test(ty) ? q : 0;
  }
  const trier = (xs, cle) => xs.slice().sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));

  /** Transaction normalisée (null si elle ne compte pas) : { pid, date, type, qty, price, amount, frais, env, imp, src, delta }. */
  function normTx(t) {
    if (!t || !isoOk(t.date) || doublon(t)) return null;
    const pid = camel(t, "positionId", "position_id");
    return { pid: pid == null ? null : pid, date: jj(t.date), type: String(t.type == null ? "" : t.type), qty: fini(t.qty) ? +t.qty : null,
      price: fini(t.price) && +t.price > 0 ? +t.price : null, amount: fini(t.amount) ? Math.abs(+t.amount) : null, frais: fini(t.frais) ? Math.max(0, +t.frais) : 0,
      env: t.enveloppe == null || t.enveloppe === "" ? null : t.enveloppe, imp: camel(t, "importId", "import_id") || null, src: t.source || null, delta: deltaTx(t) };
  }
  const SRC_COURS = { type: "cours" }, SRC_SAISIE = { type: "saisie" }, SRC_POWENS = { type: "powens" };
  /** D'où vient la valeur portée par une transaction : l'import qui l'a apportée (ordres, versements), sinon une saisie ou la nuit. */
  const srcTx = t => (t.imp ? { type: /^(achat|vente)$/.test(t.type) || (t.type === "releve" && t.qty != null) ? "ordres" : "versements", import_id: t.imp } : SRC_SAISIE);
  /** Flux net d'une transaction sur une ligne à relevés de valeur (colonne « valeur d'une ligne manuelle » du § 4.4) : versements, achats et arbitrages en entrée,
      dividendes et intérêts capitalisés, moins retraits, rachats, ventes, arbitrages en sortie et frais. Un relevé ou un solde n'est pas un flux. */
  function fluxValeur(t) {
    const m = t.amount || 0;
    if (/^(achat|versement|programme|arbitrage_entree|dividende|interets)$/.test(t.type)) return m;
    if (/^(vente|retrait|rachat|arbitrage_sortie|frais)$/.test(t.type)) return -m;
    if (t.type === "releve" || t.type === "solde") return 0;
    return SORTIES.test(t.type) ? -m : ENTREES.test(t.type) ? m : 0;
  }
  /** Effet d'une transaction sur les espèces d'une enveloppe dont les espèces sont suivies (colonne « espèces » du § 4.4). surCaisse : la
      transaction est portée par la ligne d'espèces elle-même. Un versement, un retrait, un dividende ou des frais déjà convertis en parts
      d'une ligne cotée ne passent pas par les espèces. */
  function effetEspeces(t, surCaisse) {
    const m = t.amount || 0, f = t.frais || 0, converti = !surCaisse && t.qty != null && t.qty > 0;
    switch (t.type) {
      case "achat": return surCaisse ? 0 : -(m + f);
      case "vente": return surCaisse ? 0 : m - f;
      case "versement": case "programme": case "dividende": case "interets": return converti ? 0 : m;
      case "retrait": case "rachat": case "frais": return converti ? 0 : -m;
      default: return 0;
    }
  }
  const RE_ESPECES = /\besp[eè]ces\b|\bliquidit[eé]s?\b|\bcash\b/i;
  const ligneEspeces = p => !!p && (p.especes === true || (p.mode !== "market" && !plat(p.isin) && RE_ESPECES.test(sansAccent(p.name))));

  /* Indice du dernier élément de `xs` (triés par date) dont la date est ≤ d ; -1 s'il n'y en a pas. */
  function dernierAvant(xs, d) {
    let lo = 0, hi = xs.length - 1, r = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (xs[mid].date <= d) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }
  /** Cumul préfixe : d → somme des `f` des éléments (triés par date) dont la date est ≤ d. */
  function cumulateur(xs, f) {
    const pref = [0];
    xs.forEach(x => pref.push(pref[pref.length - 1] + f(x)));
    return d => pref[dernierAvant(xs, d) + 1];
  }

  /** Qualité d'une photo (spec § 7.3). contributions = [{ ligne, valeur, nature: mesuree|estimee|constante, source: { type, import_id? } }].
      part_estimee = (estimée + constante) ÷ total, en valeur absolue ; complet si ≤ 5 %, partiel si ≤ 30 %, estime au-delà ; sources : une part par
      origine de la valeur (type + import), parts sommant à 1, dans l'ordre d'apparition.
      → { qualite, part_estimee, sources: [{ type, import_id?, part }] } */
  function qualite(contributions) {
    let total = 0, estime = 0;
    const parSource = new Map();
    liste(contributions).forEach(c => {
      if (!c || !fini(c.valeur)) return;
      const v = Math.abs(+c.valeur);
      if (!(v > 0)) return;
      total += v;
      if (c.nature !== MES) estime += v;
      const s = c.source || SRC_SAISIE, cle = (s.type || "saisie") + "|" + (s.import_id || "");
      const x = parSource.get(cle);
      if (x) x.v += v; else parSource.set(cle, { type: s.type || "saisie", import_id: s.import_id, v });
    });
    const part = total > 0 ? estime / total : 0;
    return {
      qualite: part <= 0.05 + 1e-12 ? "complet" : part <= 0.3 + 1e-12 ? "partiel" : "estime",
      part_estimee: arrondi6(part),
      sources: [...parSource.values()].map(x => Object.assign({ type: x.type }, x.import_id ? { import_id: x.import_id } : {}, { part: arrondi6(x.v / total) })),
    };
  }

  /** Enveloppes dont un import déclare que l'historique remonte à l'ouverture : { <enveloppe>: true }. imports = lignes de historique_imports (camelCase du store ou
      snake_case de la base : id, enveloppe, resume.depuis_ouverture) ; un contrat désigné par sa ligne (enveloppe nulle) prend l'enveloppe des lignes de ses transactions. */
  function depuisOuverture(imports, tx, positions) {
    const out = {}, parId = new Map(liste(positions).filter(Boolean).map(p => [String(p.id), p]));
    const parImport = new Map();
    liste(tx).forEach(t => { const id = t && camel(t, "importId", "import_id"); if (id) (parImport.get(id) || parImport.set(id, []).get(id)).push(t); });
    liste(imports).forEach(i => {
      if (!i || !i.resume || i.resume.depuis_ouverture !== true) return;
      if (i.enveloppe) { out[i.enveloppe] = true; return; }
      (parImport.get(i.id) || []).forEach(t => {
        const pid = camel(t, "positionId", "position_id"), p = pid != null ? parId.get(String(pid)) : null, e = p ? p.envelope : t.enveloppe;
        if (e) out[e] = true;
      });
    });
    return out;
  }
  /** Soldes de fin de mois des comptes importés, rattachés à une ligne du bilan : [{ positionId, mois: "AAAA-MM", solde_debut, solde_fin, import_id }].
      comptes = historique_comptes (id, positionId, banqueCompteId), releves = historique_releves (compteId, mois, soldeDebut, soldeFin, importId), banqueComptes =
      comptes Powens (id, positionId) : un compte importé rattaché à un compte Powens prend la ligne de celui-ci quand il n'a pas la sienne. Formes camelCase ou snake_case. */
  function soldesMois(comptes, releves, banqueComptes) {
    const bq = new Map(liste(banqueComptes).filter(Boolean).map(b => [String(b.id), camel(b, "positionId", "position_id")]));
    const ligneDe = new Map();
    liste(comptes).forEach(c => {
      if (!c) return;
      let pid = camel(c, "positionId", "position_id");
      const b = camel(c, "banqueCompteId", "banque_compte_id");
      if (pid == null && b != null) pid = bq.get(String(b));
      if (pid != null) ligneDe.set(String(c.id), pid);
    });
    const out = [];
    liste(releves).forEach(r => {
      if (!r || !/^\d{4}-\d{2}/.test(String(r.mois))) return;
      const pid = ligneDe.get(String(camel(r, "compteId", "compte_id")));
      if (pid === undefined) return;
      const sd = camel(r, "soldeDebut", "solde_debut"), sf = camel(r, "soldeFin", "solde_fin");
      if (!fini(sd) && !fini(sf)) return;
      out.push({ positionId: pid, mois: String(r.mois).slice(0, 7), solde_debut: fini(sd) ? +sd : null, solde_fin: fini(sf) ? +sf : null, import_id: camel(r, "importId", "import_id") || null });
    });
    return out;
  }

  /** Reconstitue le patrimoine financier (et net) de chaque jour ou de chaque fin de mois jusqu'à la veille de `today`.
      o = { today, positions, scope = "foyer", cours: { <isin|symbole>: [{ date, cloture }] }, tx: [{ positionId, date, type, qty, price, amount, frais, enveloppe,
            importId, source, doublonDe }], comptes: [{ id, positionId, type, ignore }], operations: [{ compteId, date, montant }], operationsDepuis (1er jour lu),
            depuis (début voulu), jusqua (dernier jour voulu), horsFin = 0,
            pas = "jour" | "mois" (fin de mois, 20 ans au plus), releves: [{ positionId, date, valeur }] (relevés de valeur ; ceux des transactions de type releve
            comptent aussi), soldesMois: [{ positionId, mois: "AAAA-MM", solde_debut?, solde_fin?, import_id? }] (relevés bancaires importés),
            depuisOuverture: { <enveloppe>: true }, especesSuivies: { <enveloppe>: false } (coupe les espèces d'une enveloppe),
            qualites (défaut : vrai en pas "mois") : rend la qualité de chaque point, detailLignes : rend la valeur de chaque ligne à chaque point }
      → { points: [{ date, financier, net, nature?, detail?, lignes? }], debut, fin, drapeaux: { compositionActuelle, viaTransactions, constantes: { noms, montant },
          bancaires, courteHistoire, sansCours, cloturees, prixDesOrdres, parReleves, soldesImportes, especes }, recalageEspeces, qualites?: [{ date, qualite,
          part_estimee, sources }], raison? } ; points vides avec une `raison` quand rien ne se reconstitue.
      nature d'un point (pas "mois") : mesuree si tout est mesuré, constante si tout est tenu constant, estimee sinon. */
  function reconstituer(o) {
    const opt = o || {}, today = isoOk(opt.today) ? jj(opt.today) : iso(Date.now()), scope = opt.scope || "foyer", horsFin = fini(opt.horsFin) ? +opt.horsFin : 0;
    const mois = opt.pas === "mois";
    const vide = raison => ({ points: [], debut: null, fin: null, recalageEspeces: 0, drapeaux: { compositionActuelle: [], viaTransactions: [], constantes: { noms: [], montant: 0 },
      bancaires: [], courteHistoire: [], sansCours: [], cloturees: [], prixDesOrdres: [], parReleves: [], soldesImportes: [], especes: [] }, raison });
    const C = Calc;
    const toutes = liste(opt.positions).filter(p => p && typeof p === "object");
    const txs = liste(opt.tx).map(normTx).filter(t => t && t.date <= today);
    const txParPos = {};
    txs.forEach(t => { if (t.pid != null) (txParPos[t.pid] = txParPos[t.pid] || []).push(t); });
    /* périmètre : lignes comptées, plus les lignes clôturées qui ont des transactions (leur passé existe encore) */
    const lignes = toutes.filter(p => C.inScope(p, scope) && (C.counted(p) || (p.status === "clôturé" && (txParPos[p.id] || []).length)));
    if (!lignes.length) return vide("Aucun historique à reconstituer : aucune ligne dans ce périmètre.");
    const cours = opt.cours && typeof opt.cours === "object" ? opt.cours : {};
    const serieDe = p => {
      const cle = plat(p.isin) || plat(p.symbol);
      const pts = liste(cle ? cours[cle] : null).filter(c => c && isoOk(c.date) && fini(c.cloture) && +c.cloture > 0 && jj(c.date) < today)
        .map(c => ({ date: jj(c.date), cloture: +c.cloture }));
      return pts.every((c, i) => i === 0 || pts[i - 1].date <= c.date) ? pts : trier(pts, c => c.date); // déjà triée le plus souvent
    };
    const parId = new Map(toutes.map(p => [String(p.id), p]));
    const envDe = t => { if (t.pid != null) { const p = parId.get(String(t.pid)); if (p) return p.envelope; } return t.env; };
    /* ouvertures déclarées : zéro avant le premier mouvement de l'enveloppe */
    const depuisOuv = opt.depuisOuverture && typeof opt.depuisOuverture === "object" ? opt.depuisOuverture : {};
    const ouvKeys = new Set(Object.keys(depuisOuv).filter(k => depuisOuv[k]).map(cleEnv));
    const premierMvt = new Map();
    txs.forEach(t => {
      if (t.type === "releve" || t.type === "solde") return;
      const e = envDe(t);
      if (e == null) return;
      const k = cleEnv(e), v = premierMvt.get(k);
      if (v === undefined || t.date < v) premierMvt.set(k, t.date);
    });
    const ouvDe = p => (ouvKeys.has(cleEnv(p.envelope)) && premierMvt.has(cleEnv(p.envelope)) ? premierMvt.get(cleEnv(p.envelope)) : null);
    /* espèces suivies (D6) : une ligne d'espèces dans l'enveloppe, sauf coupure explicite */
    const suivies = opt.especesSuivies && typeof opt.especesSuivies === "object" ? opt.especesSuivies : {};
    const caisseDe = new Map();
    lignes.forEach(p => { if (ligneEspeces(p) && C.counted(p) && suivies[p.envelope] !== false && !caisseDe.has(cleEnv(p.envelope))) caisseDe.set(cleEnv(p.envelope), p); });
    /* relevés de valeur : explicites, et transactions de type releve portant une valeur */
    const relParPos = {};
    const ajouteReleve = (pid, date, valeur, imp) => { if (pid != null && isoOk(date) && fini(valeur) && jj(date) <= today) (relParPos[pid] = relParPos[pid] || []).push({ date: jj(date), valeur: +valeur, imp: imp || null }); };
    liste(opt.releves).forEach(r => { if (r) ajouteReleve(camel(r, "positionId", "position_id"), r.date, r.valeur, camel(r, "importId", "import_id")); });
    txs.forEach(t => { if (t.type === "releve" && t.amount != null && t.pid != null) ajouteReleve(t.pid, t.date, t.amount, t.imp); });
    Object.keys(relParPos).forEach(k => {
      const vus = new Set();
      relParPos[k] = trier(relParPos[k].filter(r => { const c = r.date + "|" + r.valeur; if (vus.has(c)) return false; vus.add(c); return true; }), r => r.date);
    });
    /* soldes de fin de mois importés */
    const soldesPar = {};
    liste(opt.soldesMois).forEach(s => {
      const pid = s && camel(s, "positionId", "position_id");
      if (pid == null || !/^\d{4}-\d{2}/.test(String(s.mois))) return;
      const m = String(s.mois).slice(0, 7), sd = camel(s, "soldeDebut", "solde_debut"), sf = camel(s, "soldeFin", "solde_fin"), imp = camel(s, "importId", "import_id") || null;
      const M = (soldesPar[pid] = soldesPar[pid] || new Map());
      if (fini(sf) && finDeMois(m) < today) M.set(finDeMois(m), { date: finDeMois(m), v: +sf, imp });
      if (fini(sd)) { const d0 = plusJours(m + "-01", -1); if (!M.has(d0)) M.set(d0, { date: d0, v: +sd, imp }); }
    });
    const comptesPar = {};
    liste(opt.comptes).forEach(c => { if (c && c.positionId != null && !c.ignore && c.type !== "credit") (comptesPar[c.positionId] = comptesPar[c.positionId] || []).push(c.id); });
    const opsPar = {};
    liste(opt.operations).forEach(x => { if (x && x.compteId != null && isoOk(x.date) && fini(x.montant) && jj(x.date) <= today) (opsPar[x.compteId] = opsPar[x.compteId] || []).push({ date: jj(x.date), montant: +x.montant }); });
    const opsDepuis = isoOk(opt.operationsDepuis) ? jj(opt.operationsDepuis) : null;

    const dr = vide().drapeaux, L = [], consts = [];
    let recalageEspeces = 0;
    /* ---- constructeurs de lignes : chacun rend { id, nom, premier (début des données), ev(d, out) } ; out = { v, n (nature), s (source) } ----
       ev est appelé avec des dates croissantes (les curseurs avancent), jamais deux fois la même. */
    function cotee(p, nom, s, ordres, tx) {
      const total = tx.reduce((a, t) => a + t.delta, 0), qty0 = C.counted(p) ? +p.qty : 0, ouv = ouvDe(p);
      let k = 0, c = 0, j = -1, jo = -1;
      const premierPrix = [s.length ? s[0].date : null, ordres.length ? ordres[0].date : null].filter(Boolean).sort()[0];
      return { id: p.id, nom, premier: premierPrix, premierPrix, ev(d, out) {
        while (k < tx.length && tx[k].date <= d) { c += tx[k].delta; k++; }
        if (ouv && d < ouv) { out.v = 0; out.n = MES; out.s = null; return; }
        while (j + 1 < s.length && s[j + 1].date <= d) j++;
        while (jo + 1 < ordres.length && ordres[jo + 1].date <= d) jo++;
        let prix, pn = MES;
        if (j >= 0) prix = s[j].cloture;
        else if (ordres.length) { prix = ordres[jo >= 0 ? jo : 0].price; pn = EST; } else { prix = s[0].cloture; pn = EST; }
        const qty = Math.max(0, qty0 - (total - c));
        const qn = tx.length === 0 || d < tx[0].date ? EST : MES;
        out.v = qty * prix;
        out.n = qn === MES && pn === MES ? MES : EST;
        out.s = tx.length ? srcTx(tx[k > 0 ? k - 1 : 0]) : SRC_COURS;
      } };
    }
    function especes(p, nom, rels) {
      const env = cleEnv(p.envelope), eff = [];
      txs.forEach(t => {
        const e = envDe(t);
        if (e == null || cleEnv(e) !== env || t.type === "releve") return;
        const x = effetEspeces(t, String(t.pid) === String(p.id));
        if (x !== 0) eff.push({ date: t.date, e: x, t });
      });
      const effs = trier(eff, x => x.date), cum = cumulateur(effs, x => x.e), totalEff = effs.reduce((a, x) => a + x.e, 0), ouv = ouvDe(p), v0 = C.val(p);
      recalageEspeces += v0 - totalEff;
      return { id: p.id, nom, premier: effs.length ? effs[0].date : null, ev(d, out) {
        if (ouv && d < ouv) { out.v = 0; out.n = MES; out.s = null; return; }
        const i = dernierAvant(rels, d);
        if (i >= 0) {
          out.v = rels[i].valeur + cum(d) - cum(rels[i].date); out.n = rels[i].date === d ? MES : EST;
          out.s = rels[i].imp ? { type: "versements", import_id: rels[i].imp } : SRC_SAISIE;
          return;
        }
        out.v = rels.length ? rels[0].valeur - (cum(rels[0].date) - cum(d)) : v0 - (totalEff - cum(d));
        out.n = effs.length && d >= effs[0].date ? MES : EST;
        const e = dernierAvant(effs, d);
        out.s = e >= 0 ? srcTx(effs[e].t) : effs.length ? srcTx(effs[0].t) : SRC_SAISIE;
      } };
    }
    /** Valeur interpolée entre deux ancres (fins de mois importées, puis le premier jour de la fenêtre lue ou aujourd'hui) ; avant la première : tenue. */
    function interpoler(ancres, d, out) {
      const i = dernierAvant(ancres, d);
      if (i < 0) { out.v = ancres[0].v; out.n = EST; out.s = ancres[0].src; return; }
      const a = ancres[i];
      if (a.date === d || i + 1 >= ancres.length) { out.v = a.v; out.n = a.date === d && a.mes ? MES : EST; out.s = a.src; return; }
      const b = ancres[i + 1], w = joursEntre(a.date, d) / joursEntre(a.date, b.date);
      out.v = a.v + (b.v - a.v) * w; out.n = EST; out.s = a.src;
    }
    function banque(p, nom, ops, soldes) {
      const v = C.val(p), total = ops.reduce((a, x) => a + x.montant, 0), debutOps = ops.length ? (opsDepuis ? plusJours(opsDepuis, -1) : plusJours(ops[0].date, -1)) : null;
      let ancres = null;
      if (soldes && soldes.size) {
        const borne = debutOps || today;
        ancres = trier([...soldes.values()].filter(a => a.date < borne).map(a => ({ date: a.date, v: a.v, mes: true, src: a.imp ? { type: "releves", import_id: a.imp } : SRC_SAISIE })), a => a.date);
        ancres.push(debutOps ? { date: debutOps, v: v - total, mes: true, src: SRC_POWENS } : { date: today, v, mes: false, src: SRC_SAISIE });
      }
      let j = 0, c = 0;
      return { id: p.id, nom, premier: ancres ? ancres[0].date : debutOps, ev(d, out) {
        if (ops.length && d >= debutOps) {
          while (j < ops.length && ops[j].date <= d) { c += ops[j].montant; j++; }
          out.v = v - (total - c); out.n = MES; out.s = SRC_POWENS; return;
        }
        if (ancres) { interpoler(ancres, d, out); return; }
        out.v = v - total; out.n = EST; out.s = SRC_POWENS; // avant la fenêtre lue : tenu constant, au solde du premier jour de la fenêtre
      } };
    }
    function parReleves(p, nom, tx, rels) {
      const flux = trier(tx.map(t => ({ date: t.date, f: fluxValeur(t), t })).filter(x => x.f !== 0), x => x.date);
      const cum = cumulateur(flux, x => x.f), totalFlux = flux.reduce((a, x) => a + x.f, 0), ouv = ouvDe(p), v0 = C.val(p), ouverte = ouvKeys.has(cleEnv(p.envelope));
      const premier = [flux.length ? flux[0].date : null, rels.length ? rels[0].date : null].filter(Boolean).sort()[0] || null;
      const srcF = d => { const e = dernierAvant(flux, d); return e >= 0 ? srcTx(flux[e].t) : flux.length ? srcTx(flux[0].t) : SRC_SAISIE; };
      const srcR = (r, d) => (r.imp ? { type: "versements", import_id: r.imp } : srcF(d));
      return { id: p.id, nom, premier, ev(d, out) {
        if (ouv && d < ouv) { out.v = 0; out.n = MES; out.s = null; return; }
        const i = dernierAvant(rels, d);
        if (i >= 0) { out.v = rels[i].valeur + cum(d) - cum(rels[i].date); out.n = rels[i].date === d ? MES : EST; out.s = srcR(rels[i], d); return; }
        out.n = EST;
        if (ouverte) { out.v = cum(d); out.s = srcF(d); return; }
        if (rels.length) { out.v = rels[0].valeur - (cum(rels[0].date) - cum(d)); out.s = srcR(rels[0], d); return; }
        out.v = v0 - (totalFlux - cum(d)); out.s = srcF(d);
      } };
    }

    lignes.forEach(p => {
      const nom = plat(p.name) || "Ligne sans nom", cloturee = p.status === "clôturé", tx = trier(txParPos[p.id] || [], t => t.date), rels = relParPos[p.id] || [];
      /* cotée : cours de la table, à défaut prix d'exécution des ordres */
      if (p.mode === "market" && (fini(p.qty) || cloturee)) {
        const s = serieDe(p), ordres = tx.filter(t => (t.type === "achat" || t.type === "vente") && t.price != null).map(t => ({ date: t.date, price: t.price }));
        if (s.length || ordres.length) {
          const mvts = tx.filter(t => t.delta !== 0);
          (mvts.length ? dr.viaTransactions : dr.compositionActuelle).push(nom);
          if (cloturee) dr.cloturees.push(nom);
          if (ordres.length && (!s.length || ordres[0].date < s[0].date)) dr.prixDesOrdres.push(nom);
          L.push(cotee(p, nom, s, ordres, mvts));
          return;
        }
        if (!cloturee) dr.sansCours.push(nom);
      }
      if (cloturee) return;
      const caisse = caisseDe.get(cleEnv(p.envelope));
      if (caisse === p && txs.some(t => { const e = envDe(t); return e != null && cleEnv(e) === cleEnv(p.envelope); })) { dr.especes.push(nom); L.push(especes(p, nom, rels)); return; }
      const ops = trier(liste(comptesPar[p.id]).flatMap(id => opsPar[id] || []), x => x.date), soldes = soldesPar[p.id];
      if (ops.length || (soldes && soldes.size)) {
        L.push(banque(p, nom, ops, soldes));
        if (ops.length) dr.bancaires.push(nom);
        if (soldes && soldes.size) dr.soldesImportes.push(nom);
        return;
      }
      if (rels.length || (ouvKeys.has(cleEnv(p.envelope)) && tx.some(t => fluxValeur(t) !== 0))) { dr.parReleves.push(nom); L.push(parReleves(p, nom, tx, rels)); return; }
      const v = C.val(p);
      consts.push({ nom, v });
      L.push({ id: p.id, nom, premier: null, constante: true, ev(d, out) { out.v = v; out.n = CST; out.s = SRC_SAISIE; } });
    });
    dr.constantes = { noms: consts.map(c => c.nom), montant: arrondi(consts.reduce((a, c) => a + c.v, 0)) };
    if (!L.some(l => !l.constante)) { const r = vide("Aucun historique de cours ni d'opérations bancaires pour ces lignes : rien à reconstituer."); r.drapeaux = dr; return r; }

    const plancher = plusJours(today, mois ? -JOURS_MOIS_MAX : -JOURS_MAX), voulu = isoOk(opt.depuis) ? jj(opt.depuis) : null;
    const premiers = L.map(l => l.premier).filter(Boolean);
    const premier = premiers.length ? premiers.reduce((a, b) => (a < b ? a : b)) : plancher;
    // pas "mois" avec un début voulu : on part de ce début, même avant les données (zéro avant l'ouverture, valeurs tenues sinon)
    const debut = mois && voulu ? (voulu > plancher ? voulu : plancher) : [premier, voulu || plancher, plancher].reduce((a, b) => (a > b ? a : b));
    const veille = plusJours(today, -1), fin = isoOk(opt.jusqua) && jj(opt.jusqua) < veille ? jj(opt.jusqua) : veille;
    if (debut > fin) { const r = vide("Aucun historique avant aujourd'hui."); r.drapeaux = dr; return r; }
    L.forEach(l => { if (l.premierPrix && l.premierPrix > debut) dr.courteHistoire.push(l.nom); });

    const dates = [];
    if (mois) { for (let d = finDeMois(debut); d <= fin; d = finDeMois(plusJours(d, 1))) dates.push(d); }
    else for (let d = debut; d <= fin; d = plusJours(d, 1)) dates.push(d);

    const avecQualite = opt.qualites != null ? !!opt.qualites : mois, detail = opt.detailLignes === true;
    const caisses = new Set(L.filter(l => dr.especes.includes(l.nom)).map(l => l.id)), out = { v: 0, n: MES, s: null };
    const points = [], qualites = [];
    dates.forEach(d => {
      let f = 0, caisseV = 0, nMes = 0, nEst = 0, nCst = 0;
      const contribs = avecQualite ? [] : null, lignesD = detail ? {} : null;
      L.forEach(l => {
        l.ev(d, out);
        f += out.v;
        if (out.v) {
          if (out.n === MES) nMes++; else if (out.n === CST) nCst++; else nEst++;
          if (contribs) contribs.push({ ligne: l.nom, valeur: out.v, nature: out.n, source: out.s || SRC_SAISIE });
        }
        if (caisses.has(l.id)) caisseV += out.v;
        if (lignesD) lignesD[l.id] = arrondi(out.v);
      });
      const pt = { date: d, financier: arrondi(f), net: arrondi(f + horsFin) };
      if (mois || avecQualite) pt.nature = nEst === 0 && nCst === 0 ? MES : nMes === 0 && nEst === 0 ? CST : EST;
      if (caisses.size) pt.detail = { titres: arrondi(f - caisseV), especes: arrondi(caisseV) };
      if (lignesD) pt.lignes = lignesD;
      if (contribs) { const q = qualite(contribs); qualites.push(Object.assign({ date: d }, q)); pt.qualite = q.qualite; pt.part_estimee = q.part_estimee; }
      points.push(pt);
    });
    const res = { points, debut, fin, drapeaux: dr, recalageEspeces: arrondi(recalageEspeces) };
    if (avecQualite) res.qualites = qualites;
    return res;
  }

  /** Lignes de photos_reconstituees (spec § 4.5) à partir d'un résultat de reconstituer({ pas: "mois", detailLignes: true }) et des lignes du bilan.
      o = { avant (date de la première photo observée : aucune photo à cette date ni après), horsFin, max = 240 }.
      → [{ mois (1er du mois), date, total, p1, p2, financier, net, by_bloc: { p1: {…}, p2: {…} }, by_envelope, qualite, part_estimee, sources, methode }]
      La valeur de chaque ligne est répartie par personne et par poche comme take_snapshots (SQL) le fait pour la photo du jour. */
  function photos(res, positions, o) {
    const opt = o || {}, max = fini(opt.max) ? Math.max(1, +opt.max) : MOIS_MAX, horsFin = fini(opt.horsFin) ? +opt.horsFin : 0;
    const parId = new Map(liste(positions).filter(Boolean).map(p => [String(p.id), p]));
    const qual = new Map(liste(res && res.qualites).map(q => [q.date, q]));
    const out = [];
    liste(res && res.points).forEach(pt => {
      if (!pt || !pt.lignes || (isoOk(opt.avant) && pt.date >= jj(opt.avant))) return;
      let total = 0, p1 = 0, p2 = 0;
      const byBloc = { p1: {}, p2: {} }, byEnv = {};
      Object.keys(pt.lignes).forEach(id => {
        const p = parId.get(String(id)), v = +pt.lignes[id];
        if (!p || !isFinite(v)) return;
        total += v;
        if (p.owner === "p1") { p1 += v; byBloc.p1[p.bloc] = arrondi((byBloc.p1[p.bloc] || 0) + v); }
        else if (p.owner === "p2") { p2 += v; byBloc.p2[p.bloc] = arrondi((byBloc.p2[p.bloc] || 0) + v); }
        byEnv[p.envelope] = arrondi((byEnv[p.envelope] || 0) + v);
      });
      const q = qual.get(pt.date) || qualite([]);
      let sources = q.sources;
      if (sources.length > 30) { // 30 sources au plus : les plus petites sont regroupées en « saisie »
        const tri = sources.slice().sort((a, b) => b.part - a.part), reste = tri.slice(29).reduce((a, s) => a + s.part, 0);
        sources = tri.slice(0, 29).concat([{ type: "saisie", part: arrondi6(reste) }]);
      }
      out.push({ mois: pt.date.slice(0, 8) + "01", date: pt.date, total: arrondi(total), p1: arrondi(p1), p2: arrondi(p2), financier: arrondi(total), net: arrondi(total + horsFin),
        by_bloc: byBloc, by_envelope: byEnv, qualite: q.qualite, part_estimee: q.part_estimee, sources, methode: METHODE });
    });
    return out.slice(-max);
  }

  /** Fusionne l'observé et le reconstitué. observes = [{ date, net, live? }] (photos et point du jour), reconstruits = [{ date, net }].
      L'observé gagne : le reconstitué n'est gardé que strictement avant la première date observée. recaler (défaut vrai) : le
      reconstitué est décalé de l'écart entre la première observation et le dernier point reconstitué qui la précède (ou l'égale),
      pour une courbe sans cassure.
      → { points: [{ date, net, nature: "reconstitue" | "observe", live? }] triés, decalage, premiereObservee } */
  function fusionner(observes, reconstruits, opts) {
    const o = opts || {}, obs = trier(liste(observes).filter(p => p && isoOk(p.date) && fini(p.net)).map(p => Object.assign({}, p, { date: jj(p.date), net: +p.net })), p => p.date);
    const rec = trier(liste(reconstruits).filter(p => p && isoOk(p.date) && fini(p.net)).map(p => Object.assign({ date: jj(p.date), net: +p.net }, fini(p.part_estimee) ? { part_estimee: +p.part_estimee } : {}, p.qualite ? { qualite: p.qualite } : {})), p => p.date);
    const premiere = obs.length ? obs[0].date : null;
    const avant = premiere ? rec.filter(p => p.date < premiere) : rec;
    let decalage = 0;
    if (premiere && o.recaler !== false && avant.length) {
      const jonction = rec.filter(p => p.date <= premiere).pop();
      if (jonction) decalage = arrondi(obs[0].net - jonction.net);
    }
    const points = avant.map(p => Object.assign({ date: p.date, net: arrondi(p.net + decalage), nature: "reconstitue" }, p.part_estimee != null ? { part_estimee: p.part_estimee } : {}, p.qualite ? { qualite: p.qualite } : {}))
      .concat(obs.map(p => Object.assign({}, p, { nature: "observe" })));
    return { points, decalage, premiereObservee: premiere };
  }

  return { reconstituer, fusionner, deltaTx, qualite, photos, depuisOuverture, soldesMois, plusJours, plusMois, joursEntre, finDeMois, JOURS_MAX, MOIS_MAX, METHODE };
});
