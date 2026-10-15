/* Rendement réel de tes placements, et ce que le modèle en attendait (RDT). Pur, sans DOM ni réseau. Global Rendement ; module sous Node ; copié tel quel dans le connecteur (npm run gen).

   Deux mesures, deux questions :
   - « Ton rendement » (XIRR, rendement pondéré par l'argent) : ce que TU as obtenu, versements et retraits compris. Un versement juste avant une baisse la rend plus mauvaise.
   - « Rendement de tes placements » (TWR, rendement pondéré par le temps) : ce que les placements ont fait, sans l'effet de tes versements ni de tes retraits. C'est la mesure qui se
     compare à ce que le modèle attendait.
   Les deux sont calculées sur des valeurs de marché (relevés de la nuit) : les frais de gestion sont déjà dedans, donc « net de frais » par construction. Avant impôts.
   Périmètre : les placements (livrets, assurance-vie, PEA, compte-titres…), sans les comptes courants : une dépense ne doit pas passer pour une perte.

   Conventions :
   - Un versement (ou retrait) daté d'un jour est compris dans le relevé de ce jour (relevé de nuit) : il est compté en fin de journée. Entre deux relevés espacés, la méthode de Dietz modifiée
     pondère le versement par le nombre de jours restants. flux : [{ date, montant }], montant > 0 = argent ajouté aux placements, < 0 = argent retiré.
   - XIRR : base 365 jours (comme les tableurs). Annualisé seulement à partir d'un an (358 jours, à la tolérance des relevés près) ; en dessous, « sur la période » :
     (1 + taux annuel)^(jours / 365) − 1. Jamais de taux annualisé sur un mois.
   - Honnêteté : historique trop court → statut « insuffisant » et la durée disponible ; versements inconnus (aucune transaction suivie), relevés espacés de plus de 40 jours ou saut de
     plus de 20 % non expliqué par un versement → statut « approche » et la raison. Jamais un chiffre inventé.
   - Les pourcentages sont des nombres en % (4,5 = 4,5 %).

   Rendement attendu : à partir des hypothèses de classe (rendement central, volatilité, frais) et de l'allocation de départ. Attendu = moyenne pondérée des rendements nets de frais des classes
   (la même que la garde-fou « rendement implicite » du moteur). Bande « 8 chances sur 10 » (P10 à P90) : le portefeuille acheté et conservé est approché par une loi log-normale de même moyenne et
   de même variance (Fenton-Wilkinson) ; pour une seule classe, c'est exactement la loi du moteur. Les frais de la période sont ceux d'aujourd'hui. Une approximation, dite à l'écran. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Rendement = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  const noeud = typeof module === "object" && module.exports && typeof require === "function";
  const glob = k => (root && root[k]) || (typeof window !== "undefined" && window[k]) || null;
  const CALC = () => glob("Calc") || (noeud ? require("./calc.js") : null);
  const MARCHE = () => glob("Marche") || (noeud ? require("./marche.js") : null);

  const NB = " ", MOINS = "−";
  const MS_JOUR = 864e5;
  /** Au moins 358 jours (un an, à la tolérance des relevés près) : annualisé. En dessous : « sur la période ». */
  const SEUIL_ANNUALISATION_JOURS = 358;
  const Z80 = 1.2815515655446004; /* quantile à 90 % de la loi normale : 8 chances sur 10 entre P10 et P90 */
  const PERIODES = [
    { id: "1m", libelle: "1 mois", mois: 1, tolerance: 5, minJours: 25 },
    { id: "3m", libelle: "3 mois", mois: 3, tolerance: 10, minJours: 80 },
    { id: "1a", libelle: "1 an", mois: 12, tolerance: 15, minJours: 350 },
    { id: "debut", libelle: "Depuis le début", mois: null, tolerance: 0, minJours: 30 },
  ];
  const MIN_JOURS_DEPUIS = 30, TOLERANCE_DEPUIS = 5, DERNIER_RELEVE_MAX_JOURS = 7, ECART_RELEVES_MAX_JOURS = 40, SAUT_MAX = 0.2, SAUT_JOURS_MAX = 10;

  const fini = v => v != null && v !== "" && typeof v !== "boolean" && isFinite(+v);
  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
  const msDe = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const isoDe = ms => new Date(ms).toISOString().slice(0, 10);
  const jours = (a, b) => Math.round((msDe(b) - msDe(a)) / MS_JOUR);
  const ajouterMois = (iso, k) => {
    const d = new Date(msDe(iso)), y = d.getUTCFullYear(), m = d.getUTCMonth() + k, yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    return isoDe(Date.UTC(yy, mm, Math.min(d.getUTCDate(), new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate())));
  };
  const MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  /** « 1er sept. 2026 », « 14 oct. 2026 ». */
  const dateTxt = iso => { const d = new Date(msDe(iso)); return d.getUTCDate() + (d.getUTCDate() === 1 ? "er" : "") + " " + MOIS_COURT[d.getUTCMonth()] + " " + d.getUTCFullYear(); };
  /** « 3 mois », « 45 jours », « 1 an et 2 mois » (durée d'une période). */
  function dureeTxt(nbJours) {
    if (nbJours < 60) return nbJours + (nbJours > 1 ? " jours" : " jour");
    const m = Math.round(nbJours / 30.4375);
    if (m < 12) return m + " mois";
    const y = Math.floor(m / 12), r = m % 12;
    return y + (y > 1 ? " ans" : " an") + (r ? " et " + r + " mois" : "");
  }
  /** « 4,8 % » ; signe: « +4,8 % » ; dec: décimales (1 par défaut). Le moins est typographique. */
  function pct(x, o) {
    const opt = o || {}, d = opt.dec == null ? 1 : opt.dec;
    if (!fini(x)) return "—";
    const r = Math.round(Math.abs(x) * Math.pow(10, d) + 1e-9) / Math.pow(10, d), neg = x < 0 && r !== 0;
    return (neg ? MOINS : opt.signe && r !== 0 ? "+" : "") + r.toFixed(d).replace(".", ",") + NB + "%";
  }

  /* ================================================================== XIRR */
  /** Taux annuel (fraction) qui annule la valeur actuelle nette des flux datés, base 365 jours. flux : [{ date, montant }] du point de vue de l'investisseur (argent versé < 0, argent
      reçu ou valeur finale > 0). null s'il n'existe pas : moins de deux flux, tous du même signe, tous le même jour. */
  function xirr(flux) {
    const cf = (Array.isArray(flux) ? flux : []).filter(f => f && isoOk(f.date) && fini(f.montant) && +f.montant !== 0).map(f => ({ t: msDe(f.date), c: +f.montant })).sort((a, b) => a.t - b.t);
    if (cf.length < 2) return null;
    if (!cf.some(f => f.c > 0) || !cf.some(f => f.c < 0)) return null;
    const t0 = cf[0].t, T = cf.map(f => (f.t - t0) / MS_JOUR / 365);
    if (T[T.length - 1] === 0) return null;
    const npv = y => { let s = 0; for (let i = 0; i < cf.length; i++) s += cf[i].c * Math.exp(-T[i] * y); return s; };
    let lo = Math.log(1e-9), hi = Math.log(2), flo = npv(lo), fhi = npv(hi);
    for (let k = 0; k < 60 && flo * fhi > 0 && hi < 40; k++) { hi += 1; fhi = npv(hi); }
    if (!(flo * fhi <= 0)) return null;
    if (flo === 0) return Math.exp(lo) - 1;
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (fm === 0) { lo = hi = mid; break; }
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return Math.exp((lo + hi) / 2) - 1;
  }

  /* ================================================================== TWR */
  const pointsPropres = pts => {
    const m = new Map();
    (Array.isArray(pts) ? pts : []).forEach(p => { if (p && isoOk(p.date) && fini(p.valeur)) m.set(String(p.date).slice(0, 10), { date: String(p.date).slice(0, 10), valeur: +p.valeur }); });
    return [...m.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  };
  const fluxPropres = f => (Array.isArray(f) ? f : []).filter(x => x && isoOk(x.date) && fini(x.montant) && +x.montant !== 0).map(x => ({ date: String(x.date).slice(0, 10), montant: +x.montant }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  /** Rendement pondéré par le temps (fraction) des relevés `points` ([{ date, valeur }]) corrigé des flux : chaîne des rendements entre relevés, chacun net du versement qu'il contient
      (Dietz modifié, versement pondéré par les jours restants). La mesure commence au premier relevé positif. → { cumule, sous_periodes, plus_gros_mouvement, ecart_max_jours } ou null. */
  function twr(points, flux) {
    const pts = pointsPropres(points), fl = fluxPropres(flux);
    let i0 = pts.findIndex(p => p.valeur > 0);
    if (i0 < 0 || pts.length - i0 < 2) return null;
    let prod = 1, n = 0, gros = 0, ecart = 0;
    for (let k = i0 + 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], j = Math.max(1, jours(a.date, b.date));
      let F = 0, W = 0;
      fl.forEach(x => { if (x.date > a.date && x.date <= b.date) { F += x.montant; W += x.montant * jours(x.date, b.date) / j; } });
      const den = a.valeur + W;
      ecart = Math.max(ecart, j);
      if (!(den > 1e-9)) continue;
      const r = (b.valeur - a.valeur - F) / den;
      prod *= 1 + r; n++;
      if (j <= SAUT_JOURS_MAX && Math.abs(r) > Math.abs(gros)) gros = r;
    }
    if (!n) return null;
    return { cumule: prod - 1, sous_periodes: n, plus_gros_mouvement: gros, ecart_max_jours: ecart };
  }

  /* ================================================================== une période */
  const NOTE_INCONNUS = "versements inconnus : rendement approché";
  /** Mesure d'une période [debut, fin] (dates de relevés) : TWR et XIRR, gain, versements nets, statut et notes. versementsConnus faux : les flux sont ignorés (rendement simple de la valeur). */
  function mesurer(o) {
    const opt = o || {}, debut = String(opt.debut).slice(0, 10), fin = String(opt.fin).slice(0, 10), connus = opt.versementsConnus !== false;
    const pts = pointsPropres(opt.points).filter(p => p.date >= debut && p.date <= fin);
    const fl = connus ? fluxPropres(opt.flux).filter(x => x.date > debut && x.date <= fin) : [];
    const nj = jours(debut, fin), annualise = nj >= SEUIL_ANNUALISATION_JOURS;
    const out = { debut, fin, jours: nj, annualise, statut: "ok", notes: [], valeur_debut: null, valeur_fin: null, versements_nets: null, gain: null,
      twr_periode_pct: null, twr_annuel_pct: null, xirr_periode_pct: null, xirr_annuel_pct: null };
    const t = twr(pts, fl);
    if (!t || !pts.length) { out.statut = "insuffisant"; out.raison = "pas assez d'historique : aucune valeur positive à mesurer"; return out; }
    out.valeur_debut = pts[0].valeur; out.valeur_fin = pts[pts.length - 1].valeur;
    out.versements_nets = fl.reduce((s, x) => s + x.montant, 0);
    out.gain = out.valeur_fin - out.valeur_debut - out.versements_nets;
    out.twr_periode_pct = t.cumule * 100;
    out.twr_annuel_pct = annualise ? (Math.pow(1 + t.cumule, 365 / nj) - 1) * 100 : null;
    const cf = [{ date: pts[0].date, montant: -out.valeur_debut }].concat(fl.map(x => ({ date: x.date, montant: -x.montant })), [{ date: fin, montant: out.valeur_fin }]);
    const r = xirr(cf);
    if (r != null) {
      out.xirr_periode_pct = (Math.pow(1 + r, nj / 365) - 1) * 100;
      out.xirr_annuel_pct = annualise ? r * 100 : null;
    }
    if (!connus) out.notes.push(NOTE_INCONNUS);
    if (Math.abs(t.plus_gros_mouvement) >= SAUT_MAX) out.notes.push("un mouvement de plus de 20 % entre deux relevés n'est pas expliqué par tes versements (une ligne ajoutée sans versement ?) : rendement approché");
    if (t.ecart_max_jours > ECART_RELEVES_MAX_JOURS) out.notes.push("relevés espacés (jusqu'à " + t.ecart_max_jours + " jours) : rendement approché");
    if (out.notes.length) out.statut = "approche";
    return out;
  }

  /** Relevé le plus proche d'une date cible (≤ tolérance jours), en excluant le dernier ; égalité : le plus ancien. → index ou -1. */
  function plusProche(pts, cible, tolerance, avant) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (avant != null && pts[i].date >= avant) break;
      const d = Math.abs(jours(pts[i].date, cible));
      if (d < bd) { bd = d; best = i; }
    }
    return best >= 0 && bd <= tolerance ? best : -1;
  }

  /** Les quatre périodes (1 mois, 3 mois, 1 an, depuis le début) à la date `today` : [{ id, libelle, …mesure }] ; statut « insuffisant » (avec raison) quand les relevés ne remontent pas assez loin.
      o = { points, flux, today, versementsConnus? (défaut : il existe au moins un flux) }. */
  function periodes(o) {
    const opt = o || {}, pts = pointsPropres(opt.points), fl = fluxPropres(opt.flux), connus = opt.versementsConnus != null ? !!opt.versementsConnus : fl.length > 0;
    const sans = (def, raison) => ({ id: def.id, libelle: def.libelle, debut: null, fin: null, jours: null, annualise: false, statut: "insuffisant", raison, notes: [],
      valeur_debut: null, valeur_fin: null, versements_nets: null, gain: null, twr_periode_pct: null, twr_annuel_pct: null, xirr_periode_pct: null, xirr_annuel_pct: null });
    if (!pts.length) return PERIODES.map(d => sans(d, "pas assez d'historique : aucun relevé"));
    const dernier = pts[pts.length - 1], premierPositif = pts.findIndex(p => p.valeur > 0);
    const recent = !opt.today || jours(dernier.date, String(opt.today).slice(0, 10)) <= DERNIER_RELEVE_MAX_JOURS;
    return PERIODES.map(def => {
      if (!recent) return sans(def, "pas assez d'historique récent : le dernier relevé date du " + dateTxt(dernier.date));
      const dispo = premierPositif >= 0 ? jours(pts[premierPositif].date, dernier.date) : 0;
      const manque = "pas assez d'historique : " + dureeTxt(dispo).replace(/^(\d+) (jour|jours)$/, "$1 $2") + " de relevés" + (def.mois ? " pour " + def.libelle.toLowerCase() : "");
      let i;
      if (def.id === "debut") i = premierPositif;
      else i = plusProche(pts, ajouterMois(dernier.date, -def.mois), def.tolerance, dernier.date);
      if (i < 0 || (def.id === "debut" && premierPositif < 0)) return sans(def, manque);
      const m = mesurer({ points: pts, flux: fl, debut: pts[i].date, fin: dernier.date, versementsConnus: connus });
      if (m.jours < def.minJours) return sans(def, manque);
      return Object.assign({ id: def.id, libelle: def.libelle }, m);
    });
  }

  /** Phrase d'une période : « Ton rendement : +4,5 % sur 3 mois », « Rendement de tes placements : 11,6 %/an ». mesure : "xirr" | "twr". */
  function phrasePeriode(p, mesure) {
    const nom = mesure === "xirr" ? "Ton rendement" : "Rendement de tes placements";
    if (!p || p.statut === "insuffisant" || p.statut == null) return nom + " : " + ((p && p.raison) || "pas assez d'historique");
    const v = mesure === "xirr" ? (p.annualise ? p.xirr_annuel_pct : p.xirr_periode_pct) : (p.annualise ? p.twr_annuel_pct : p.twr_periode_pct);
    if (v == null) return nom + " : non calculable";
    const corps = p.annualise ? pct(v) + "/an" : pct(v, { signe: true }) + " sur " + (p.id === "1m" ? "1 mois" : p.id === "3m" ? "3 mois" : dureeTxt(p.jours));
    return nom + " : " + corps + (p.statut === "approche" ? " (approché" + (p.notes.some(n => n === NOTE_INCONNUS) ? " : versements inconnus" : "") + ")" : "");
  }

  /* ================================================================== depuis l'état du store */
  const NUM = x => (x != null && isFinite(+x) ? +x : 0);
  const estCourantBloc = (nom, classes) => { const C = CALC(); return !!(C && C.famille && C.famille({ bloc: nom, envelope: "" }, classes) === "courant"); };
  /** Poches d'un relevé : { poche: montant } pour un périmètre, par l'unique lecteur de snapshots.by_bloc (Calc.blocsPhoto : { p1: {…}, p2: {…} } de la
      nuit, ou à plat, foyer seulement). null si absent ou illisible. */
  function pochesDe(snap, scope) {
    const C = CALC();
    return C && C.blocsPhoto ? C.blocsPhoto(snap, scope) : null;
  }
  /** Relevés des placements, flux et allocations d'un état du store (S.snapshots, S.positions, S.tx, S.classes), pour un périmètre (foyer | p1 | p2).
      Valeur d'un relevé = valeur du périmètre − poches « comptes courants » ; point du jour = lignes vivantes hors comptes courants. flux : versements, versements programmés (entrées),
      retraits et rachats (sorties) des lignes de placement ; un achat ou une vente est un flux (+ montant + frais, − [montant − frais]) seulement sur une ligne cotée dont l'enveloppe n'a pas de ligne
      d'espèces (les titres seuls sont mesurés), sinon interne ; un nouveau solde, un relevé, des frais, un dividende : jamais ; une transaction qui a un doublon_de est ignorée. → { points, flux, versementsConnus, allocations: [{ date, poche }], notes }. */
  function pointsEtFlux(S, scope, today) {
    const s = S || {}, sc = scope || s.scope || "foyer", C = CALC(), classes = s.classes || {};
    const out = { points: [], flux: [], versementsConnus: false, allocations: [], notes: [] };
    if (!C || !isoOk(today)) return out;
    const positions = Array.isArray(s.positions) ? s.positions : [];
    const courante = p => C.famille(p, classes) === "courant";
    let sansPoches = false;
    (Array.isArray(s.snapshots) ? s.snapshots : []).forEach(r => {
      if (!r || !isoOk(r.date) || String(r.date).slice(0, 10) >= today) return;
      const total = sc === "foyer" ? r.foyer != null ? r.foyer : r.total : r[sc];
      if (!fini(total)) return;
      const date = String(r.date).slice(0, 10), poches = pochesDe(r, sc);
      let valeur = +total;
      if (poches) {
        const placements = {};
        let courants = 0;
        Object.keys(poches).forEach(k => { if (estCourantBloc(k, classes)) courants += poches[k]; else placements[k] = poches[k]; });
        valeur = Math.max(0, valeur - courants);
        if (Object.keys(placements).length) out.allocations.push({ date, poche: placements });
      } else sansPoches = true;
      out.points.push({ date, valeur });
    });
    const vivantes = positions.filter(p => p && C.counted(p) && C.inScope(p, sc) && !courante(p));
    if (vivantes.length || out.points.length) out.points.push({ date: today, valeur: vivantes.reduce((a, p) => a + C.val(p), 0) });
    if (sansPoches) out.notes.push("composition des relevés inconnue : les comptes courants n'ont pas pu être retirés des anciens relevés");
    const parId = new Map(positions.map(p => [p && p.id, p]));
    const tx = Array.isArray(s.tx) ? s.tx : [];
    /* Espèces d'une enveloppe « suivies » = une ligne d'espèces (drapeau especes, ou nom « Espèces », « Liquidités », « Cash ») parmi les placements ; le périmètre mesure alors titres + espèces
       et un achat reste interne. Sinon (défaut, D6) il ne mesure que les titres : un achat y fait entrer de l'argent (+ montant + frais), une vente en fait sortir (− [montant − frais]) ;
       un versement ou un retrait d'espèces sur l'enveloppe, lui, n'entre pas dans la mesure. owner null : toute personne du périmètre. */
    const ligneEspeces = p => p.especes === true || /\b(especes|liquidites?|cash)\b/.test(String(p.name == null ? "" : p.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
    const especesSuivies = (env, owner) => positions.some(q => q && q.envelope === env && (owner == null || q.owner === owner) && C.inScope(q, sc) && C.counted(q) && !courante(q) && ligneEspeces(q));
    tx.forEach(t => {
      if (!t || !isoOk(t.date) || !fini(t.amount) || +t.amount === 0) return;
      if ((t.doublonDe != null ? t.doublonDe : t.doublon_de) != null) return; /* remplacée par un import : ignorée partout (spec § 4.4) */
      const m = Math.abs(+t.amount), frais = fini(t.frais) ? Math.max(0, +t.frais) : 0, type = t.type;
      const entree = type === "versement" || type === "programme", sortie = type === "retrait" || type === "rachat";
      const p = parId.get(t.positionId);
      let montant = 0;
      if (p) {
        if (!C.inScope(p, sc) || courante(p)) return;
        if (entree) montant = m;
        else if (sortie) montant = -m;
        else if (p.mode === "market" && !especesSuivies(p.envelope, p.owner)) montant = type === "achat" ? m + frais : type === "vente" ? -(m - frais) : 0;
      } else if (t.enveloppe != null && t.enveloppe !== "") {
        /* mouvement d'enveloppe sans ligne (versement d'espèces) : flux seulement si les espèces sont suivies */
        if (!especesSuivies(t.enveloppe, null)) return;
        montant = entree ? m : sortie ? -m : 0;
      } else {
        if (sc !== "foyer") return;
        montant = entree ? m : type === "retrait" ? -m : 0;
      }
      if (montant) out.flux.push({ date: String(t.date).slice(0, 10), montant });
    });
    out.flux.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    out.versementsConnus = tx.length > 0;
    return out;
  }
  /** Poches d'un relevé → poids par classe (somme 1) : classeDePoche(poche) → classe ou null. Les poches sans classe sont dites (inconnues) et ne comptent pas. → [{ date, poids, inconnues }]. */
  function classer(allocations, classeDePoche) {
    const out = [];
    (Array.isArray(allocations) ? allocations : []).forEach(a => {
      const poids = {}, inconnues = [];
      let tot = 0;
      Object.keys((a && a.poche) || {}).forEach(k => {
        const m = NUM(a.poche[k]);
        if (!(m > 0)) return;
        const c = typeof classeDePoche === "function" ? classeDePoche(k) : null;
        if (!c) { inconnues.push(k); return; }
        poids[c] = (poids[c] || 0) + m; tot += m;
      });
      if (!(tot > 0)) return;
      Object.keys(poids).forEach(c => { poids[c] /= tot; });
      out.push({ date: a.date, poids, inconnues });
    });
    return out;
  }

  /* ================================================================== rendement attendu d'une allocation */
  /** Rendement attendu d'une allocation sur `mois` mois : attendu (moyenne pondérée des rendements nets de frais) et bande P10-P50-P90, annualisés à partir de 12 mois, sinon cumulés.
      o = { poids: { classe: poids }, classes: { classe: { rendement (% par an, médian), volatilite (% par an), frais_pct? } }, mois, frais_pct? (frais annuels par défaut, jamais pour « courant »),
      correlation?: (a, b) → ρ (défaut : Marche.correlation), annualise? (force) }. Une classe sans hypothèse : statut « indisponible » et la raison. */
  function attenduPeriode(o) {
    const opt = o || {}, indispo = raison => ({ statut: "indisponible", raison, attendu_pct: null, p10_pct: null, p50_pct: null, p90_pct: null, annualise: false, mois: opt.mois || null });
    const D = +opt.mois;
    if (!(D > 0)) return indispo("durée nulle");
    const bruts = Object.keys(opt.poids || {}).filter(k => NUM(opt.poids[k]) > 0), tot = bruts.reduce((s, k) => s + NUM(opt.poids[k]), 0);
    if (!bruts.length || !(tot > 0)) return indispo("allocation inconnue");
    const cl = opt.classes || {}, manque = bruts.filter(k => !(cl[k] && fini(cl[k].rendement)));
    if (manque.length) return indispo("hypothèse de rendement manquante pour « " + manque.join(" », « ") + " »");
    const M = MARCHE(), rho = typeof opt.correlation === "function" ? opt.correlation : (a, b) => (a === b ? 1 : a === "courant" || b === "courant" || !M ? 0 : M.correlation(a, b));
    const w = bruts.map(k => NUM(opt.poids[k]) / tot);
    const fee = k => (k === "courant" ? 0 : (fini(cl[k].frais_pct) ? +cl[k].frais_pct : NUM(opt.frais_pct)) / 100);
    const net = bruts.map(k => (1 + +cl[k].rendement / 100) * (1 - fee(k)) - 1);
    const attenduAn = bruts.reduce((s, k, i) => s + w[i] * net[i], 0);
    const mu = net.map(r => Math.log(1 + r) * D / 12), s2 = bruts.map(k => Math.pow(NUM(cl[k].volatilite) / 100, 2) * D / 12);
    const m1 = w.reduce((s, wi, i) => s + wi * Math.exp(mu[i] + s2[i] / 2), 0);
    let e2 = 0;
    for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) e2 += w[i] * w[j] * Math.exp(mu[i] + mu[j] + (s2[i] + s2[j] + 2 * (i === j ? 1 : rho(bruts[i], bruts[j])) * Math.sqrt(s2[i] * s2[j])) / 2);
    const s = Math.sqrt(Math.max(0, Math.log(e2 / (m1 * m1)))), m = Math.log(m1) - s * s / 2;
    const annualise = opt.annualise != null ? !!opt.annualise : D >= 12;
    const quant = z => { const cum = Math.exp(m + z * s) - 1; return (annualise ? Math.pow(1 + cum, 12 / D) - 1 : cum) * 100; };
    return { statut: "ok", mois: D, annualise, attendu_pct: (annualise ? attenduAn : Math.pow(1 + attenduAn, D / 12) - 1) * 100,
      p10_pct: quant(-Z80), p50_pct: quant(0), p90_pct: quant(Z80), frais_pct: NUM(opt.frais_pct) };
  }

  /* ================================================================== réel contre attendu */
  /** « Réel 6,2 %/an contre 4,9 % attendu (fourchette 8 sur 10 : −3 % à +12 %) — dans la fourchette ». reel = { valeur_pct, annualise, libelle? } ; att = sortie d'attenduPeriode.
      → { verdict: "dans" | "au_dessus" | "en_dessous" | null, phrase, raison? }. Aucun jugement : la fourchette dit seulement si le résultat est ordinaire ou rare. */
  function comparer(reel, att) {
    if (!reel || !fini(reel.valeur_pct)) return { verdict: null, phrase: null, raison: "rendement réel absent" };
    if (!att || att.statut !== "ok") return { verdict: null, phrase: null, raison: (att && att.raison) || "attendu indisponible" };
    const v = reel.valeur_pct, large = att.p90_pct - att.p10_pct >= 6, dec = large ? 0 : 1, an = !!reel.annualise;
    const verdict = v > att.p90_pct ? "au_dessus" : v < att.p10_pct ? "en_dessous" : "dans";
    const lib = reel.libelle ? "sur " + reel.libelle : "sur la période";
    const phrase = "Réel " + (an ? pct(v) + "/an" : pct(v, { signe: true }) + " " + lib) + " contre " + (an ? pct(att.attendu_pct) : pct(att.attendu_pct, { signe: true })) + " attendu (fourchette 8 sur 10 : " +
      pct(att.p10_pct, { signe: true, dec }) + " à " + pct(att.p90_pct, { signe: true, dec }) + ") — " + (verdict === "dans" ? "dans la fourchette" : verdict === "au_dessus" ? "au-dessus de la fourchette" : "sous la fourchette");
    return { verdict, phrase };
  }

  /** Rendement réel depuis une date jusqu'à aujourd'hui et ce que le modèle en attendait pour l'allocation de départ, pour la lecture du graphe à une date passée.
      dr = { points, flux, versementsConnus, allocations: [{ date, poids }] } ; hyp = { courantes: { classes, frais_pct?, correlation? }, plans: [{ id, cree_le, classes }] }.
      Plan figé : le plus récent créé au plus tard à la date de départ (les hypothèses du moment) ; sinon les hypothèses d'aujourd'hui appliquées à l'allocation de départ (approximation dite). */
  function depuis(dr, debut, today, o) { /* o = { hypotheses, libelle? (durée écrite : « 3 mois ») } */
    const opt = o || {}, hyp = opt.hypotheses || null, d = dr || {};
    const pts = pointsPropres(d.points), insuffisant = raison => ({ statut: "insuffisant", raison, reel: null, attendu: null, comparaison: null, source: null });
    if (!pts.length || !isoOk(debut) || !isoOk(today)) return insuffisant("pas assez d'historique : aucun relevé");
    const dernier = pts[pts.length - 1];
    if (jours(dernier.date, today) > DERNIER_RELEVE_MAX_JOURS) return insuffisant("pas assez d'historique récent");
    const i = plusProche(pts, debut, TOLERANCE_DEPUIS, dernier.date);
    if (i < 0) return insuffisant("pas de relevé à cette date");
    const nj = jours(pts[i].date, dernier.date);
    if (nj < MIN_JOURS_DEPUIS) return insuffisant("moins d'un mois d'écart");
    const m = mesurer({ points: pts, flux: d.flux, debut: pts[i].date, fin: dernier.date, versementsConnus: d.versementsConnus });
    if (m.statut === "insuffisant") return insuffisant(m.raison);
    const reel = Object.assign({}, m, { valeur_pct: m.annualise ? m.twr_annuel_pct : m.twr_periode_pct, libelle: opt.libelle || dureeTxt(nj) });
    const res = { statut: m.statut, debut: m.debut, fin: m.fin, jours: nj, annualise: m.annualise, reel, attendu: null, comparaison: null, source: null, notes: m.notes };
    const alloc = (Array.isArray(d.allocations) ? d.allocations : []).filter(a => a && a.date <= m.debut).pop();
    if (!hyp || !hyp.courantes || !alloc) { if (hyp && !alloc) res.raison_attendu = "allocation de départ inconnue"; return res; }
    const plan = (Array.isArray(hyp.plans) ? hyp.plans : []).filter(p => p && isoOk(p.cree_le) && String(p.cree_le).slice(0, 10) <= m.debut).sort((a, b) => (a.cree_le < b.cree_le ? -1 : 1)).pop();
    const classes = Object.assign({}, hyp.courantes.classes, plan ? plan.classes : {});
    res.attendu = attenduPeriode({ poids: alloc.poids, classes, mois: nj / 30.4375, frais_pct: hyp.courantes.frais_pct, correlation: hyp.courantes.correlation, annualise: m.annualise });
    res.source = plan ? { type: "plan_fige", id: plan.id, date: String(plan.cree_le).slice(0, 10), texte: "attendu d'après ton plan figé du " + dateTxt(String(plan.cree_le).slice(0, 10)) }
      : { type: "hypotheses_actuelles", date: alloc.date, texte: "hypothèses d'aujourd'hui appliquées à ton allocation du " + dateTxt(alloc.date) + " (approximation)" };
    res.comparaison = comparer(reel, res.attendu);
    return res;
  }

  return { PERIODES, SEUIL_ANNUALISATION_JOURS, xirr, twr, mesurer, periodes, phrasePeriode, pointsEtFlux, classer, attenduPeriode, comparer, depuis, pct, dateTxt, dureeTxt, ajouterMois, jours };
});
