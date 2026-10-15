/* Historique du patrimoine net : reconstitution du passé, fusion avec les photos observées. Calculs purs,
   aucun accès au DOM ni au réseau (les cours, transactions et opérations sont lus par les stores et passés en paramètres).

   Reconstitution (reconstituer) : le patrimoine financier de chaque jour, de la veille jusqu'au plus loin que les données permettent
   (5 ans au plus), puis net = financier + horsFin (immobilier, autres biens et dettes d'aujourd'hui, comme BilanCalc.evolution).
   Trois sortes de lignes (périmètre et statuts comme Calc.financier) :
   - cotée : quantité × cours de clôture de la table cours (clé : ISIN, à défaut symbole). La quantité remonte le temps par les
     transactions (achat, versement, programme = entrée ; vente, retrait, rachat = sortie ; les autres types sont ignorés). Sans
     transaction pour la ligne : quantité actuelle (« à composition actuelle »). Avant son premier cours, la ligne reste à la valeur de
     son premier cours (jamais zéro). Sans cours : constante.
   - bancaire : ligne rattachée à un compte (banque_comptes.position_id, hors crédit et comptes ignorés) dont on a lu les opérations :
     solde(j) = valeur actuelle − opérations postérieures à j ; avant la fenêtre lue (90 jours), le solde est tenu constant.
   - constante : toutes les autres, à leur valeur d'aujourd'hui (liquidités saisies, assurance-vie sans cours, parts, etc.).
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
  const JOURS_MAX = 1826; // 5 ans
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
  const arrondi = v => Math.round(v * 100) / 100;
  const liste = v => (Array.isArray(v) ? v : []);
  const plat = t => String(t == null ? "" : t).replace(/\s+/g, " ").trim();
  const ENTREES = /achat|versement|programme|apport|souscription/i, SORTIES = /vente|retrait|rachat|cession/i;
  /** Variation de quantité d'une transaction (+ entrée, − sortie), 0 si elle n'en dit rien. */
  function deltaTx(t) {
    if (!t || !fini(t.qty) || +t.qty === 0) return 0;
    const q = Math.abs(+t.qty), ty = String(t.type == null ? "" : t.type);
    return SORTIES.test(ty) ? -q : ENTREES.test(ty) ? q : 0;
  }
  const trier = (xs, cle) => xs.slice().sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));

  /** Reconstitue le patrimoine financier (et net) de chaque jour jusqu'à la veille de `today`.
      o = { today, positions, scope = "foyer", cours: { <isin|symbole>: [{ date, cloture }] }, tx: [{ positionId, date, type, qty }],
            comptes: [{ id, positionId, type, ignore }], operations: [{ compteId, date, montant }], operationsDepuis (1er jour lu),
            depuis (début voulu, 5 ans au plus), horsFin = 0 }
      → { points: [{ date, financier, net }], debut, fin, drapeaux: { compositionActuelle, viaTransactions, constantes: { noms, montant },
          bancaires, courteHistoire, sansCours }, raison? } ; points vides avec une `raison` quand rien ne se reconstitue. */
  function reconstituer(o) {
    const opt = o || {}, today = isoOk(opt.today) ? jj(opt.today) : iso(Date.now()), scope = opt.scope || "foyer", horsFin = fini(opt.horsFin) ? +opt.horsFin : 0;
    const vide = raison => ({ points: [], debut: null, fin: null, drapeaux: { compositionActuelle: [], viaTransactions: [], constantes: { noms: [], montant: 0 }, bancaires: [], courteHistoire: [], sansCours: [] }, raison });
    const C = Calc;
    const lignes = liste(opt.positions).filter(p => p && C.inScope(p, scope) && C.counted(p));
    if (!lignes.length) return vide("Aucun historique à reconstituer : aucune ligne dans ce périmètre.");
    const cours = opt.cours && typeof opt.cours === "object" ? opt.cours : {};
    const serieDe = p => {
      const cle = plat(p.isin) || plat(p.symbol);
      return trier(liste(cle ? cours[cle] : null).filter(c => c && isoOk(c.date) && fini(c.cloture) && +c.cloture > 0 && jj(c.date) < today)
        .map(c => ({ date: jj(c.date), cloture: +c.cloture })), c => c.date);
    };
    const txPar = {};
    liste(opt.tx).forEach(t => { if (t && t.positionId != null && isoOk(t.date) && deltaTx(t) !== 0 && jj(t.date) <= today) (txPar[t.positionId] = txPar[t.positionId] || []).push({ date: jj(t.date), delta: deltaTx(t) }); });
    const comptesPar = {};
    liste(opt.comptes).forEach(c => { if (c && c.positionId != null && !c.ignore && c.type !== "credit") (comptesPar[c.positionId] = comptesPar[c.positionId] || []).push(c.id); });
    const opsPar = {};
    liste(opt.operations).forEach(x => { if (x && x.compteId != null && isoOk(x.date) && fini(x.montant) && jj(x.date) <= today) (opsPar[x.compteId] = opsPar[x.compteId] || []).push({ date: jj(x.date), montant: +x.montant }); });
    const opsDepuis = isoOk(opt.operationsDepuis) ? jj(opt.operationsDepuis) : null;

    const dr = vide().drapeaux, cotees = [], banques = [], consts = [];
    lignes.forEach(p => {
      const nom = plat(p.name) || "Ligne sans nom", v = C.val(p), s = p.mode === "market" && fini(p.qty) ? serieDe(p) : [];
      if (s.length) {
        const tx = trier(txPar[p.id] || [], t => t.date), total = tx.reduce((a, t) => a + t.delta, 0);
        (tx.length ? dr.viaTransactions : dr.compositionActuelle).push(nom);
        cotees.push({ nom, qty: +p.qty, s, tx, total, k: 0, j: 0, c: 0 });
        return;
      }
      if (p.mode === "market" && fini(p.qty) && (plat(p.isin) || plat(p.symbol))) dr.sansCours.push(nom);
      const ops = trier(liste(comptesPar[p.id]).flatMap(id => opsPar[id] || []), x => x.date);
      if (ops.length) {
        const debutOps = opsDepuis ? plusJours(opsDepuis, -1) : plusJours(ops[0].date, -1);
        banques.push({ nom, v, ops, total: ops.reduce((a, x) => a + x.montant, 0), debutOps, j: 0, c: 0 });
        dr.bancaires.push(nom);
        return;
      }
      consts.push({ nom, v });
    });
    dr.constantes = { noms: consts.map(c => c.nom), montant: arrondi(consts.reduce((a, c) => a + c.v, 0)) };
    const constant = consts.reduce((a, c) => a + c.v, 0);
    if (!cotees.length && !banques.length) { const r = vide("Aucun historique de cours ni d'opérations bancaires pour ces lignes : rien à reconstituer."); r.drapeaux = dr; return r; }

    const plancher = plusJours(today, -JOURS_MAX), voulu = isoOk(opt.depuis) ? jj(opt.depuis) : plancher;
    const premiers = cotees.length ? cotees.map(c => c.s[0].date) : banques.map(b => b.debutOps); // les cours bornent le début ; sinon la fenêtre bancaire
    const debut = [premiers.reduce((a, b) => (a < b ? a : b)), voulu, plancher].reduce((a, b) => (a > b ? a : b));
    const fin = plusJours(today, -1);
    if (debut > fin) { const r = vide("Aucun historique avant aujourd'hui."); r.drapeaux = dr; return r; }
    cotees.forEach(c => { if (c.s[0].date > debut) dr.courteHistoire.push(c.nom); });
    const points = [];
    for (let d = debut; d <= fin; d = plusJours(d, 1)) {
      let f = constant;
      cotees.forEach(c => {
        while (c.k < c.tx.length && c.tx[c.k].date <= d) { c.c += c.tx[c.k].delta; c.k++; }
        while (c.j + 1 < c.s.length && c.s[c.j + 1].date <= d) c.j++;
        const qty = Math.max(0, c.qty - (c.total - c.c));
        f += qty * c.s[c.j].cloture;
      });
      banques.forEach(b => {
        const dd = d < b.debutOps ? b.debutOps : d;
        while (b.j < b.ops.length && b.ops[b.j].date <= dd) { b.c += b.ops[b.j].montant; b.j++; }
        f += b.v - (b.total - b.c);
      });
      points.push({ date: d, financier: arrondi(f), net: arrondi(f + horsFin) });
    }
    return { points, debut, fin, drapeaux: dr };
  }

  /** Fusionne l'observé et le reconstitué. observes = [{ date, net, live? }] (photos et point du jour), reconstruits = [{ date, net }].
      L'observé gagne : le reconstitué n'est gardé que strictement avant la première date observée. recaler (défaut vrai) : le
      reconstitué est décalé de l'écart entre la première observation et le dernier point reconstitué qui la précède (ou l'égale),
      pour une courbe sans cassure.
      → { points: [{ date, net, nature: "reconstitue" | "observe", live? }] triés, decalage, premiereObservee } */
  function fusionner(observes, reconstruits, opts) {
    const o = opts || {}, obs = trier(liste(observes).filter(p => p && isoOk(p.date) && fini(p.net)).map(p => Object.assign({}, p, { date: jj(p.date), net: +p.net })), p => p.date);
    const rec = trier(liste(reconstruits).filter(p => p && isoOk(p.date) && fini(p.net)).map(p => ({ date: jj(p.date), net: +p.net })), p => p.date);
    const premiere = obs.length ? obs[0].date : null;
    const avant = premiere ? rec.filter(p => p.date < premiere) : rec;
    let decalage = 0;
    if (premiere && o.recaler !== false && avant.length) {
      const jonction = rec.filter(p => p.date <= premiere).pop();
      if (jonction) decalage = arrondi(obs[0].net - jonction.net);
    }
    const points = avant.map(p => ({ date: p.date, net: arrondi(p.net + decalage), nature: "reconstitue" }))
      .concat(obs.map(p => Object.assign({}, p, { nature: "observe" })));
    return { points, decalage, premiereObservee: premiere };
  }

  return { reconstituer, fusionner, deltaTx, plusJours, plusMois, joursEntre, JOURS_MAX };
});
