/* Série du patrimoine net : UNE définition de « la variation du patrimoine net » pour toute l'app (Aujourd'hui, Patrimoine › Comptes).
   Définition : valeur du patrimoine net aujourd'hui moins sa valeur au début de la période choisie (1 an par défaut), en euros et en %
   de la valeur de départ. La valeur de départ vient des photos nocturnes (observé) ; avant la première photo, du passé reconstitué
   (Historique.reconstituer : cours × quantités, soldes bancaires, autres lignes constantes). L'observé gagne toujours
   (Historique.fusionner). La période est celle d'Aujourd'hui, mémorisée (aujourdhui-periode) et partagée avec Patrimoine › Comptes :
   le même chiffre, avec la même période écrite à côté, sur chaque écran.

   Partie pure (testée) : PERIODE_TXT, estPerso, periodeTxt, serie (courbe observée + reconstituée, agrégée sur la période),
   variation (montant, %, début), lirePeriode, periodeAEnregistrer.
   Partie état (navigateur) : le passé reconstitué se lit à la demande (cours, transactions, dont les mouvements et relevés importés de HIS2, opérations
   bancaires du Store ; soldes de fin de mois des relevés importés et enveloppes « depuis l'ouverture » lus dans S) ; au-delà de la fenêtre calculée
   à la volée (5 ans), les photos reconstituées stockées par la nuit (S.photosReconstituees) prolongent le passé jusqu'à 20 ans ; l'état de
   cette lecture est PARTAGÉ entre les vues (hist) pour qu'elles affichent le même chiffre au même moment : tant que la lecture n'est pas
   finie (enAttente), une vue montre un squelette, jamais un chiffre provisoire qui changerait ensuite. abonner(fn) prévient les vues à
   la fin d'une lecture.
   Dépendances (deps, sinon globales ou modules voisins sous Node) : BilanCalc, Periodes, Historique, Calc, Store (état). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SerieNet = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  const glob = k => (root && root[k]) || (typeof window !== "undefined" && window[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : glob(k));
  const voisin = (k, f) => glob(k) || (typeof module === "object" && module.exports && typeof require === "function" ? require(f) : null);
  const HIST = d => dep(d, "Historique") || voisin("Historique", "./historique.js");
  const BC = d => dep(d, "BilanCalc") || voisin("BilanCalc", "./bilan-calc.js");
  const PE = d => dep(d, "Periodes") || voisin("Periodes", "./periodes.js");
  const CALC = d => dep(d, "Calc") || voisin("Calc", "./calc.js");

  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const jj = v => (v ? String(v).slice(0, 10) : "");
  const dateFr = s => (isoOk(s) ? new Date(s + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");
  const counted = p => !!p && p.status !== "à recevoir" && p.status !== "clôturé";

  /* ---------- période ---------- */
  const CLE = "aujourdhui-periode";
  const PERIODE_TXT = { "1m": "sur 1 mois", "3m": "sur 3 mois", "6m": "sur 6 mois", ytd: "depuis janvier", "1a": "sur 1 an", "3a": "sur 3 ans", tout: "depuis le début de l'historique" };
  const estPerso = p => !!p && /^perso/.test(String(p.id)) && isoOk(p.du) && isoOk(p.au);
  /** « sur 1 an », « du 1 janv. 2026 au 31 mars 2026 » : la période écrite à côté de chaque variation. */
  const periodeTxt = p => (estPerso(p) ? "du " + dateFr(p.du) + " au " + dateFr(p.au) : PERIODE_TXT[p && p.id] || PERIODE_TXT["1a"]);
  /** Période relue du stockage local (JSON ou objet) → { periode: { id, du?, au?, granularite? }, gChoisie }. La granularité n'est
      reprise que si l'utilisateur l'avait choisie lui-même (gChoisie) ; sinon elle reste automatique (Periodes.auto selon la
      période). Les anciennes valeurs sans gChoisie (granularité « mois » enregistrée d'office) repassent donc en automatique. */
  function lirePeriode(brut) {
    let p = brut;
    if (typeof brut === "string") { try { p = JSON.parse(brut); } catch (e) { p = null; } }
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !p.id) return { periode: { id: "1a" }, gChoisie: false };
    const gChoisie = p.gChoisie === true && typeof p.granularite === "string" && !!p.granularite;
    const periode = { id: p.id };
    if (isoOk(p.du)) periode.du = p.du;
    if (isoOk(p.au)) periode.au = p.au;
    if (gChoisie) periode.granularite = p.granularite;
    return { periode, gChoisie };
  }
  /** Ce qui s'enregistre : la période (et ses dates si elle est personnalisée) ; la granularité et gChoisie seulement après un choix
      de l'utilisateur. */
  function periodeAEnregistrer(periode, gChoisie) {
    const p = periode || {}, out = { id: String(p.id || "1a") };
    if (/^perso/.test(out.id) && isoOk(p.du) && isoOk(p.au)) { out.du = p.du; out.au = p.au; }
    if (gChoisie && p.granularite) { out.granularite = String(p.granularite); out.gChoisie = true; }
    return out;
  }
  /* Période partagée : lue une fois du stockage local, puis tenue à jour par Aujourd'hui (seul écran qui la change). */
  let periodeCourante = { id: "1a" };
  try { periodeCourante = lirePeriode(root.localStorage.getItem(CLE)).periode; } catch (e) { /* pas de stockage : 1 an */ }
  const periode = () => periodeCourante;
  function definirPeriode(p) { periodeCourante = p && typeof p === "object" && p.id ? p : { id: "1a" }; }

  /* ---------- série et variation (pures) ---------- */
  /** Série du patrimoine net : photos + point du jour (BilanCalc.evolution) fusionnées avec le passé reconstitué quand deps.reconstitue
      (résultat de Historique.reconstituer) en fournit un, puis agrégées sur la période. L'observé gagne toujours ; le reconstitué n'existe
      qu'avant la première photo et rejoint celle-ci (Historique.fusionner).
      periode = { id: 1m|3m|1a|tout|perso…, du?, au?, granularite? } →
      { points (Periodes.agreger, chacun avec sa nature observe|reconstitue), resume, bornes, granularite, historique, reconstitue (vrai si la
        période dessinée contient du reconstitué), decalage, horsFin (net − financier d'aujourd'hui), premiere (1re date de la série) } */
  function serie(S, today, periodeVoulue, deps) {
    const Bc = BC(deps), Pe = PE(deps), s = S || {}, p = periodeVoulue || {};
    const vide = { points: [], resume: { debut: null, fin: null, variation: null, variationPct: null }, bornes: null, granularite: p.granularite || "mois", historique: false,
      reconstitue: false, decalage: 0, horsFin: 0, premiere: null };
    if (!Bc || !Pe) return vide;
    let pts = [];
    try { pts = Bc.evolution(s.snapshots || [], s.positions || [], s.profil || null, s.scope || "foyer", today); } catch (e) { return vide; }
    if (!pts.length) return vide;
    const live = pts[pts.length - 1], horsFin = live && isFinite(live.net) && isFinite(live.financier) ? live.net - live.financier : 0;
    let points = pts.map(x => ({ date: x.date, net: x.net, live: !!x.live, nature: "observe" })), decalage = 0;
    const rec = dep(deps, "reconstitue"), Hi = rec && Array.isArray(rec.points) && rec.points.length ? HIST(deps) : null;
    if (Hi) {
      const fus = Hi.fusionner(points, rec.points);
      points = fus.points; decalage = fus.decalage;
    }
    const id = estPerso(p) ? { du: p.du, au: p.au } : PERIODE_TXT[p.id] ? p.id : "1a";
    const b = Pe.bornes(id, today, points[0].date);
    const g = !p.granularite || p.granularite === "auto" || !Pe.GRANULARITES.some(x => x.id === p.granularite) ? Pe.auto(b) : p.granularite;
    const nature = new Map(points.map(x => [x.date, x.nature]));
    const ag = Pe.agreger(points, b, g, x => x.net).map(x => Object.assign(x, { nature: nature.get(x.date) || "observe" }));
    return { points: ag, resume: Pe.resume(ag, points, b, x => x.net), bornes: b, granularite: g, historique: points.some(x => !x.live), reconstitue: ag.some(x => x.nature === "reconstitue"),
      decalage, horsFin, premiere: points[0].date };
  }

  /** LA variation du patrimoine net, la même sur tous les écrans : { montant, pct, debut (début de la période), texte (« sur 1 an »),
      reconstitue (le début est reconstitué), enAttente (le passé est encore lu : ne pas afficher de chiffre) } ou null sans historique
      (première photo pas encore prise). Période par défaut : celle d'Aujourd'hui (1 an). */
  function variation(S, today, periodeVoulue, deps) {
    const p = periodeVoulue || periodeCourante, f = serie(S, today, p, deps);
    const enAttente = !!(deps && deps.enAttente);
    if (!f.historique || f.resume.variation == null) return null;
    return { montant: f.resume.variation, pct: f.resume.variationPct, debut: f.bornes ? f.bornes.du : null, texte: periodeTxt(p),
      reconstitue: f.reconstitue && f.points.length > 0 && f.points[0].nature === "reconstitue", enAttente };
  }

  /* ---------- lecture du passé (état partagé entre les vues) ---------- */
  const hist = { cle: "", depuis: null, depuisTx: null, isins: "", comptes: "", imports: "", cours: {}, tx: null, ops: [], opsDepuis: null, version: 0, etat: "rien", seq: 0, enCours: "", memo: null };
  const abonnes = new Set();
  const abonner = fn => { abonnes.add(fn); return () => abonnes.delete(fn); };
  const prevenir = () => abonnes.forEach(fn => { try { fn(); } catch (e) { /* une vue ne bloque pas les autres */ } });
  function reinitialiser() {
    Object.assign(hist, { cle: "", depuis: null, depuisTx: null, isins: "", comptes: "", imports: "", cours: {}, tx: null, ops: [], opsDepuis: null, version: 0, etat: "rien", seq: 0, enCours: "", memo: null });
    abonnes.clear();
    periodeCourante = { id: "1a" };
  }

  /** La lecture est possible : état du store prêt, base joignable, Store et Historique présents. */
  const possible = (S, deps) => !!S && S.ready !== false && S.dbOk !== false && !!dep(deps, "Store") && !!HIST(deps);
  /** Le chiffre n'est pas définitif : le store n'est pas prêt, ou la lecture du passé n'a pas fini (première lecture, ou période qui
      remonte plus loin). Une vue montre alors un squelette. Faux quand la lecture est impossible ou terminée (échec compris). */
  function enAttente(S, deps) {
    if (S && S.ready === false) return true;
    if (!possible(S, deps)) return false;
    return hist.etat === "rien" || hist.etat === "charge" || hist.enCours !== "";
  }

  /** Soldes de fin de mois des comptes importés, lus dans l'état du store (S.relevesBancaires, comptes Powens de S.banque pour le rattachement). */
  function soldesMois(S, deps) {
    const Hi = HIST(deps), rb = S && S.relevesBancaires;
    return Hi && Hi.soldesMois && rb && Array.isArray(rb.comptes) ? Hi.soldesMois(rb.comptes, rb.releves, S.banque && S.banque.comptes) : [];
  }
  /** Photos reconstituées stockées (écrites par la nuit) plus anciennes que `avant`, en points { date, financier, net } : le net est refait avec les biens
      hors placements d'aujourd'hui (horsFin), comme pour le passé calculé à la volée. */
  function photosAvant(S, avant, horsFin) {
    return (S && Array.isArray(S.photosReconstituees) ? S.photosReconstituees : []).filter(p => p && isoOk(jj(p.date)) && p.financier != null && isFinite(+p.financier) && (!avant || jj(p.date) < avant))
      .map(p => ({ date: jj(p.date), financier: +p.financier, net: +p.financier + horsFin, nature: "photo" })).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /** Passé reconstitué pour l'état courant du store (mémorisé tant que le store, le périmètre, le jour et les données lues ne changent pas). Les photos
      stockées prolongent le passé calculé à la volée (5 ans) vers le plus ancien. */
  function reconstitution(S, today, deps) {
    const Hi = HIST(deps), C = CALC(deps);
    if (!Hi || !C || !S || hist.etat === "rien" || hist.etat === "charge" && !hist.version) return null;
    const cle = [today, S.scope, hist.version].join("|");
    if (hist.memo && hist.memo.S === S && hist.memo.cle === cle) return hist.memo.res;
    let res = null;
    try {
      const pat = C.patrimoine(S.positions || [], S.profil || null, S.scope || "foyer"), horsFin = pat.net - pat.financier, tx = hist.tx || S.tx || [];
      res = Hi.reconstituer({ today, positions: S.positions || [], scope: S.scope || "foyer", cours: hist.cours, tx,
        comptes: S.banque && S.banque.comptes ? S.banque.comptes : [], operations: hist.ops, operationsDepuis: hist.opsDepuis, depuis: hist.depuis, horsFin,
        soldesMois: soldesMois(S, deps), depuisOuverture: Hi.depuisOuverture ? Hi.depuisOuverture(S.historiqueImports, tx, S.positions) : {} });
      const anciennes = (S.scope || "foyer") === "foyer" ? photosAvant(S, res && res.points.length ? res.points[0].date : null, horsFin) : [];
      if (anciennes.length) {
        const points = anciennes.concat(res ? res.points : []);
        res = Object.assign({}, res || { drapeaux: null, fin: null }, { points, debut: points[0].date, photos: anciennes.length });
        delete res.raison;
      }
    } catch (e) { res = null; }
    hist.memo = { S, cle, res };
    return res;
  }

  /** Début de la période voulue, moins quelques jours (variation sur la période) : jusqu'où lire l'historique. */
  function depuisVoulu(today, p, deps) {
    const Hi = HIST(deps), Pe = PE(deps);
    if (!Hi) return today;
    if (p.id === "tout") return Hi.plusJours(today, -Hi.JOURS_MAX);
    const b = Pe ? Pe.bornes(estPerso(p) ? { du: p.du, au: p.au } : PERIODE_TXT[p.id] ? p.id : "1a", today) : { du: Hi.plusJours(today, -365) };
    const d = Hi.plusJours(b.du, -10), plancher = Hi.plusJours(today, -Hi.JOURS_MAX);
    return d < plancher ? plancher : d;
  }

  /** Lit les cours, les transactions et les opérations bancaires nécessaires à la reconstitution (une seule lecture à la fois ; refaite si
      la période remonte plus loin, ou si les lignes cotées ou les comptes rattachés changent). Une lecture en échec laisse le reste : le
      passé est alors reconstitué avec ce qui est lu, et le dit. Prévient les vues abonnées à la fin d'une lecture. */
  async function charger(S, today, periodeVoulue, deps) {
    const st = dep(deps, "Store"), Hi = HIST(deps);
    if (!S || !S.ready || S.dbOk === false || !st || !Hi) return;
    const p = periodeVoulue || periodeCourante, depuis = depuisVoulu(today, p, deps);
    const isins = [...new Set((S.positions || []).filter(x => counted(x) && x.mode === "market" && x.isin).map(x => String(x.isin)))].sort().join(",");
    const comptes = (S.banque && S.banque.actif && !S.banque.mfaRequise && Array.isArray(S.banque.comptes) ? S.banque.comptes : [])
      .filter(c => c && c.positionId != null && !c.ignore && c.type !== "credit").map(c => c.id).sort().join(",");
    /* HIS2 : les mouvements et relevés importés remontent plus loin que la fenêtre : les transactions sont lues depuis le début des imports (20 ans au plus) */
    const imps = Array.isArray(S.historiqueImports) ? S.historiqueImports : [];
    const imports = imps.map(i => i.id).sort().join(",");
    const premierImport = imps.map(i => jj(i.periodeDu)).filter(isoOk).sort()[0], plancherTx = Hi.plusJours(today, -7305);
    const depuisTx = premierImport && premierImport < depuis ? (premierImport < plancherTx ? plancherTx : premierImport) : depuis;
    if (hist.etat !== "rien" && hist.depuis <= depuis && hist.depuisTx <= depuisTx && hist.isins === isins && hist.comptes === comptes && hist.imports === imports) return;
    const cle = depuis + "|" + depuisTx + "|" + isins + "|" + comptes + "|" + imports;
    if (hist.enCours === cle) return;
    /* une lecture plus longue (même contenu, début plus ancien) est déjà en route : elle couvre aussi celle-ci (Aujourd'hui lit 5 ans, Comptes 1 an) */
    if (hist.enCours && hist.enCoursDepuis <= depuis && hist.enCoursDepuisTx <= depuisTx && hist.enCoursDe === isins + "|" + comptes + "|" + imports) return;
    hist.enCours = cle; hist.enCoursDepuis = depuis; hist.enCoursDepuisTx = depuisTx; hist.enCoursDe = isins + "|" + comptes + "|" + imports; const seq = ++hist.seq; hist.etat = hist.version ? hist.etat : "charge";
    const tolerant = f => Promise.resolve().then(f).catch(() => null);
    const [cours, tx, ops] = await Promise.all([
      isins && typeof st.cours === "function" ? tolerant(() => st.cours(isins.split(","), depuis)) : {},
      typeof st.transactions === "function" ? tolerant(() => st.transactions(depuisTx)) : null,
      comptes && st.banque && typeof st.banque.operations === "function" ? tolerant(() => st.banque.operations(comptes.split(",").map(x => (/^\d+$/.test(x) ? +x : x)), Hi.plusJours(today, -90))) : [],
    ]);
    if (seq !== hist.seq) return;
    Object.assign(hist, { cle, depuis, depuisTx, isins, comptes, imports, cours: cours || {}, tx: Array.isArray(tx) ? tx : null, ops: Array.isArray(ops) ? ops : [], opsDepuis: Hi.plusJours(today, -90),
      version: hist.version + 1, etat: cours === null ? "echec" : "pret", enCours: "", memo: null });
    prevenir();
  }

  return { CLE, PERIODE_TXT, estPerso, periodeTxt, lirePeriode, periodeAEnregistrer, periode, definirPeriode, serie, variation,
    hist, abonner, reinitialiser, possible, enAttente, reconstitution, soldesMois, photosAvant, depuisVoulu, charger };
});
