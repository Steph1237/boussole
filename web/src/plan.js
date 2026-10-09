/* Plan : budget, objectifs, projection et score de santé. Calculs purs, aucun accès au DOM.
   S'appuie sur Calc (calc.js) pour les positions et le profil. */
(function (root, factory) {
  const Calc = typeof module === "object" && module.exports ? require("./calc.js") : root.Calc;
  const api = factory(Calc);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Plan = api;
})(typeof self !== "undefined" ? self : this, function (Calc) {
  const n = v => (isFinite(+v) && v !== null && v !== "" ? +v : 0);
  const pos = v => Math.max(0, n(v));
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const EPS = 1e-9;

  /** Rendements annuels attendus par poche, en % : central, pessimiste, optimiste (indicatifs). */
  const RENDEMENTS = {
    "Monde": { central: 6, pessimiste: 3, optimiste: 8.5 },
    "Europe": { central: 5.5, pessimiste: 2.5, optimiste: 8 },
    "Asie": { central: 6, pessimiste: 2, optimiste: 9 },
    "Nasdaq 2x": { central: 9, pessimiste: -2, optimiste: 16 },
    "Convictions tech": { central: 7, pessimiste: 0, optimiste: 12 },
    "Crypto": { central: 5, pessimiste: -20, optimiste: 25 },
    "SCPI": { central: 4, pessimiste: 2, optimiste: 5 },
    "Protection": { central: 2.5, pessimiste: 1.5, optimiste: 3.5 },
    "Obligations": { central: 3, pessimiste: 1.5, optimiste: 4 },
    "Épargne": { central: 2.4, pessimiste: 1.7, optimiste: 3 },
    "_autre": { central: 4, pessimiste: 1.5, optimiste: 6 },
  };
  /* Alias : les données de démonstration nomment la poche « Convictions ». */
  RENDEMENTS["Convictions"] = RENDEMENTS["Convictions tech"];
  const SCENARIOS = ["central", "pessimiste", "optimiste"];

  /** Repère de patrimoine net, en années de revenus, par tranche d'âge (clés de la toise). */
  const REPERES_AGE = { u30: 0.5, a30: 1, a40: 3, a50: 6, a60: 8, a70: 10 };

  /* ---------- dates (sans fuseau : AAAA-MM-JJ) ---------- */
  function ymd(d) {
    if (d == null) d = new Date();
    if (d instanceof Date) return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
    const s = String(d).slice(0, 10).split("-").map(Number);
    return { y: s[0], m: (s[1] || 1) - 1, d: s[2] || 1 };
  }
  const dernierJour = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const tauxMensuel = tauxAnnuel => Math.pow(1 + n(tauxAnnuel) / 100, 1 / 12) - 1;

  /** Montant mensuel d'une ligne de budget (fréquence « an » ramenée au mois). */
  function mensuel(ligne) {
    const m = pos(ligne && ligne.montant);
    return ligne && ligne.frequence === "an" ? m / 12 : m;
  }

  /* Part d'une ligne de budget dans le périmètre : sans titulaire = commun (moitié pour p1 / p2). */
  const partLigne = (l, scope) => Calc.partCredit(scope, l.owner === "p1" || l.owner === "p2" ? l.owner : "commun");

  /** Totaux mensuels du budget : revenus (profil + lignes), dépenses (lignes + mensualités), épargne, reste, taux d'épargne. */
  function budgetTotaux(lignes, profil, scope) {
    const L = (Array.isArray(lignes) ? lignes : []).filter(Boolean);
    const de = type => L.filter(l => l.type === type);
    const m = l => mensuel(l) * partLigne(l, scope);
    const revenusProfil = Calc.revenusFoyer(profil, scope);
    const revenusLignes = sum(de("revenu"), m);
    const depensesLignes = sum(de("depense"), m);
    const mensualites = Calc.mensualites(profil, scope);
    const epargne = sum(de("epargne"), m);
    const revenus = revenusProfil + revenusLignes;
    const depenses = depensesLignes + mensualites;
    const reste = revenus - depenses - epargne;
    const parCategorie = {};
    de("depense").forEach(l => {
      const c = l.categorie || "Autres";
      parCategorie[c] = (parCategorie[c] || 0) + m(l);
    });
    if (mensualites > 0) parCategorie["Crédits"] = (parCategorie["Crédits"] || 0) + mensualites;
    return {
      revenusProfil, revenusLignes, revenus, depensesLignes, mensualites, depenses, epargne, reste,
      tauxEpargne: revenus > 0 ? (epargne + Math.max(0, reste)) / revenus : null,
      parCategorie,
    };
  }

  /** Versement constant de fin de mois pour passer de « deja » à « cible » en « mois » mois au taux annuel donné (%). */
  function effortMensuel(cible, deja, mois, tauxAnnuel) {
    const c = n(cible), d = n(deja), k = Math.floor(n(mois));
    if (k <= 0) return c > d ? Infinity : 0;
    const r = tauxMensuel(tauxAnnuel);
    if (Math.abs(r) < EPS) return Math.max(0, (c - d) / k);
    const f = Math.pow(1 + r, k);
    return Math.max(0, (c - d * f) * r / (f - 1));
  }

  /** Valeur capitalisée après « mois » mois : capital de départ + versements de fin de mois. */
  function valeurFuture(deja, versement, mois, tauxAnnuel) {
    const d = n(deja), v = n(versement), k = Math.max(0, Math.floor(n(mois)));
    const r = tauxMensuel(tauxAnnuel);
    if (Math.abs(r) < EPS) return d + v * k;
    const f = Math.pow(1 + r, k);
    return d * f + v * (f - 1) / r;
  }

  /** Nombre de mois entiers entre deux dates (arrondi par défaut, jamais négatif ; fin de mois = mois complet). */
  function moisEntre(dateA, dateB) {
    const a = ymd(dateA), b = ymd(dateB);
    let k = (b.y - a.y) * 12 + (b.m - a.m);
    if (b.d < a.d && b.d < dernierJour(b.y, b.m)) k -= 1;
    return Math.max(0, k);
  }

  /** Date (fin du mois) à laquelle la cible est atteinte au rythme donné ; date de départ si déjà atteinte ; null au-delà de 60 ans. */
  function dateAtteinte(cible, deja, versement, tauxAnnuel, depuis) {
    const c = n(cible), v = n(versement), r = tauxMensuel(tauxAnnuel), t = ymd(depuis);
    let val = n(deja);
    if (val >= c - EPS) return iso(t.y, t.m, t.d);
    for (let k = 1; k <= 720; k++) {
      val = val * (1 + r) + v;
      if (val >= c - 1e-6) return iso(t.y, t.m + k, dernierJour(t.y, t.m + k));
    }
    return null;
  }

  /** Montant déjà mis de côté pour un objectif : saisi, ou somme des poches / enveloppes rattachées. */
  function dejaObjectif(obj, positions, scope) {
    if (!obj) return 0;
    if (obj.source !== "poches") return pos(obj.deja);
    const poches = Array.isArray(obj.poches) ? obj.poches : [];
    const env = Array.isArray(obj.enveloppes) ? obj.enveloppes : [];
    return sum((positions || []).filter(p => Calc.inScope(p, scope || "foyer") && Calc.counted(p) &&
      (poches.includes(p.bloc) || env.includes(p.envelope))), Calc.val);
  }

  /** Capacité d'épargne mensuelle : épargne prévue + reste positif (même base que le taux d'épargne). */
  const capaciteEpargne = t => t ? pos(t.epargne) + Math.max(0, +t.reste || 0) : 0;

  /** Répartit l'argent des poches entre objectifs, en cascade par priorité : une même ligne ne finance jamais
      deux objectifs à la fois. Renvoie { [id]: montant déjà affecté }. Les objectifs « saisis » gardent leur montant. */
  function affecterDeja(objectifs, positions, scope) {
    const reste = (positions || []).filter(p => Calc.inScope(p, scope || "foyer") && Calc.counted(p)).map(p => ({ p, v: Calc.val(p) }));
    const ordre = (objectifs || []).slice().sort((a, b) =>
      ((a.priorite ?? Infinity) - (b.priorite ?? Infinity)) || String(dateCible(a) || "9999").localeCompare(String(dateCible(b) || "9999")));
    const out = {};
    ordre.forEach(o => {
      if (o.source !== "poches") { out[o.id] = pos(o.deja); return; }
      const poches = Array.isArray(o.poches) ? o.poches : [], env = Array.isArray(o.enveloppes) ? o.enveloppes : [];
      let besoin = pos(o.cible), pris = 0;
      reste.forEach(r => {
        if (besoin <= 0 || r.v <= 0 || !(poches.includes(r.p.bloc) || env.includes(r.p.envelope))) return;
        const t = Math.min(r.v, besoin); r.v -= t; besoin -= t; pris += t;
      });
      out[o.id] = Math.round(pris * 100) / 100;
    });
    return out;
  }

  /* Date cible d'un objectif : forme du store (dateCible) ou colonne SQL (date_cible). */
  const dateCible = o => o.dateCible || o.date_cible || null;

  /* Effort mensuel requis pour un objectif à une date donnée (0 si pas de date). */
  function effortObjectif(obj, deja, today) {
    if (!dateCible(obj)) return { mois: null, effort: 0 };
    const mois = moisEntre(today, dateCible(obj));
    return { mois, effort: effortMensuel(pos(obj.cible), deja, mois, obj.rendement) };
  }
  const datePassee = (date, today) => {
    const a = ymd(date), b = ymd(today);
    return iso(a.y, a.m, a.d) < iso(b.y, b.m, b.d);
  };

  /** Situation d'un objectif : progression, effort requis, date d'atteinte au versement alloué, statut. */
  function statutObjectif(obj, ctx) {
    const c = ctx || {}, today = c.today == null ? new Date() : c.today;
    const cible = pos(obj.cible);
    const deja = c.deja != null ? pos(c.deja) : dejaObjectif(obj, c.positions, c.scope);
    const versementAlloue = pos(c.versementAlloue);
    const { mois, effort } = effortObjectif(obj, deja, today);
    const atteinte = dateAtteinte(cible, deja, versementAlloue, obj.rendement, today);
    const date = dateCible(obj);
    let statut;
    if (deja >= cible) statut = "atteint";
    else if (date && (datePassee(date, today) || !isFinite(effort))) statut = "hors_portee";
    else if (!date) statut = atteinte ? "dans_les_temps" : "hors_portee";
    else if (effort <= 0 || versementAlloue >= 1.1 * effort - EPS) statut = "avance";
    else if (versementAlloue >= 0.95 * effort - EPS) statut = "dans_les_temps";
    else statut = "retard";
    return { deja, progression: cible > 0 ? Math.min(1, deja / cible) : 1, mois, effort, versementAlloue, atteinte, statut };
  }

  /** Répartit l'épargne mensuelle entre objectifs : priorité croissante, puis échéance la plus proche ; le surplus va au dernier objectif en cours. */
  function repartirEpargne(objectifs, epargneMensuelle, ctx) {
    const c = ctx || {}, today = c.today == null ? new Date() : c.today;
    const cle = o => (dateCible(o) ? String(dateCible(o)).slice(0, 10) : "9999-12-31");
    const liste = (objectifs || []).map((o, i) => {
      const deja = dejaObjectif(o, c.positions, c.scope);
      return { o, i, effort: deja >= pos(o.cible) ? 0 : effortObjectif(o, deja, today).effort };
    }).sort((a, b) => (n(a.o.priorite ?? Infinity) - n(b.o.priorite ?? Infinity)) ||
      (cle(a.o) < cle(b.o) ? -1 : cle(a.o) > cle(b.o) ? 1 : 0) || a.i - b.i);
    const out = {};
    let reste = pos(epargneMensuelle);
    liste.forEach(x => {
      const m = Math.min(x.effort, reste);
      out[x.o.id] = m;
      reste -= m;
    });
    if (reste > 0 && liste.length) {
      const enCours = liste.filter(x => x.effort > 0);
      const dernier = (enCours.length ? enCours : liste)[(enCours.length ? enCours : liste).length - 1];
      out[dernier.o.id] += reste;
    }
    return out;
  }

  /** Projection du patrimoine financier sur N années, trois scénarios, versement réparti comme le portefeuille actuel. */
  function projection(opts) {
    const o = opts || {}, scope = o.scope || "foyer", R = o.rendements || RENDEMENTS;
    const N = Math.max(0, Math.floor(o.annees == null ? 30 : n(o.annees)));
    const versement = n(o.versementMensuel);
    const capital = {};
    (o.positions || []).filter(p => Calc.inScope(p, scope) && Calc.counted(p)).forEach(p => {
      const b = p.bloc || "_autre";
      capital[b] = (capital[b] || 0) + Calc.val(p);
    });
    const total = sum(Object.values(capital), pos);
    if (total <= 0) capital._autre = capital._autre || 0;
    const blocs = Object.keys(capital);
    const poids = b => (total > 0 ? pos(capital[b]) / total : b === "_autre" ? 1 : 0);
    const taux = b => R[b] || R._autre || RENDEMENTS._autre;

    const res = { annees: Array.from({ length: N + 1 }, (_, i) => i), parBloc: {} };
    SCENARIOS.forEach(s => { res[s] = new Array(N + 1).fill(0); });
    blocs.forEach(b => {
      const pb = { capital: capital[b], poids: poids(b) };
      SCENARIOS.forEach(s => {
        const r = tauxMensuel(taux(b)[s]), v = versement * pb.poids, serie = [];
        let val = capital[b];
        serie.push(val);
        for (let k = 1; k <= N * 12; k++) {
          val = val * (1 + r) + v;
          if (k % 12 === 0) serie.push(val);
        }
        serie.forEach((x, i) => { res[s][i] += x; });
        pb[s] = serie.map(Math.round);
      });
      res.parBloc[b] = pb;
    });
    SCENARIOS.forEach(s => { res[s] = res[s].map(Math.round); });
    return res;
  }

  /* ---------- score de santé ---------- */
  /* Interpolation linéaire par morceaux, bornée aux extrémités. */
  function interp(x, pts) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return pts[pts.length - 1][1];
  }
  function fr(x, dec) {
    const s = Math.abs(x).toFixed(dec == null ? 1 : dec).replace(/\.0+$/, "").replace(".", ",");
    return (x < 0 ? "−" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  const pct = x => fr(x * 100, 0) + " %";

  function itemMatelas(positions, scope, totaux, config) {
    const epargne = Calc.poche(positions, scope, "Épargne");
    const m = Calc.matelas(config);
    const depenses = totaux.depensesLignes > 0 ? totaux.depenses : m && m.mode === "months" && m.depenses > 0 ? m.depenses : 0;
    const base = { cle: "matelas", titre: "Matelas de précaution", cible: "3 à 6 mois de dépenses" };
    if (depenses <= 0) return { ...base, valeur: null, aCompleter: true,
      texte: "Dépenses mensuelles inconnues.", piste: "Renseignez vos dépenses dans le budget pour mesurer votre réserve." };
    const mois = epargne / depenses;
    const points = mois < 1 ? 0 : mois < 3 ? interp(mois, [[1, 5], [3, 15]]) : mois <= 6 ? 20 : interp(mois, [[6, 20], [12, 15]]);
    const piste = mois < 3 ? "Visez 3 à 6 mois de dépenses sur une épargne disponible à tout moment, pour absorber un imprévu sans vendre ni emprunter."
      : mois <= 6 ? "Votre réserve couvre les imprévus courants : rien à changer de ce côté."
      : mois <= 12 ? "Au-delà de 6 mois, une partie de cette réserve pourrait être affectée à l'un de vos objectifs."
      : "Plus d'un an de dépenses dort sur des supports peu rémunérés : regardez si une partie peut servir vos objectifs.";
    return { ...base, valeur: mois, points, aCompleter: false, texte: fr(mois) + " mois de dépenses de côté.", piste };
  }

  function itemEpargne(totaux) {
    const base = { cle: "epargne", titre: "Taux d'épargne", cible: "15 % des revenus ou plus" };
    if (!(totaux.revenus > 0) || (totaux.depensesLignes <= 0 && totaux.epargne <= 0)) return { ...base, valeur: null, aCompleter: true,
      texte: "Budget incomplet.", piste: "Renseignez vos revenus et vos dépenses dans le budget pour calculer votre taux d'épargne." };
    const t = totaux.tauxEpargne;
    const points = interp(t * 100, [[0, 0], [5, 6], [10, 12], [15, 16], [20, 20]]);
    const piste = t >= 0.15 ? "Vous êtes au-dessus du repère de 15 % : de quoi alimenter vos objectifs régulièrement."
      : "Le repère courant est de 15 % des revenus. Les postes les plus lourds du budget sont le premier endroit où regarder.";
    return { ...base, valeur: t, points, aCompleter: false, texte: "Vous mettez de côté " + pct(t) + " de vos revenus.", piste };
  }

  function itemEndettement(totaux) {
    const base = { cle: "endettement", titre: "Taux d'endettement", cible: "35 % des revenus au plus" };
    if (!(totaux.revenus > 0)) return { ...base, valeur: null, aCompleter: true,
      texte: "Revenus inconnus.", piste: "Renseignez vos revenus dans le Profil ou le budget pour calculer votre taux d'endettement." };
    const t = totaux.mensualites / totaux.revenus;
    const points = interp(t * 100, [[25, 20], [35, 12], [45, 0]]);
    const texte = totaux.mensualites > 0 ? "Vos crédits représentent " + pct(t) + " de vos revenus." : "Aucune mensualité de crédit en cours.";
    const piste = t <= 0.35 ? "Vous restez sous le plafond de 35 % appliqué par les banques (norme HCSF)."
      : "Au-delà de 35 %, les banques prêtent difficilement (norme HCSF). Un remboursement anticipé ou une renégociation peuvent alléger la charge.";
    return { ...base, valeur: t, points, aCompleter: false, texte, piste };
  }

  function itemConcentration(positions, scope) {
    const base = { cle: "concentration", titre: "Diversification", cible: "aucune ligne au-delà de 20 %, au moins 3 poches" };
    const L = (positions || []).filter(p => Calc.inScope(p, scope) && Calc.counted(p) && Calc.val(p) > 0);
    const F = sum(L, Calc.val);
    if (F <= 0) return { ...base, valeur: null, aCompleter: true,
      texte: "Aucun placement enregistré.", piste: "Ajoutez vos placements dans Bilan › Placements pour mesurer leur diversification." };
    const max = Math.max(...L.map(Calc.val)) / F;
    const nb = new Set(L.map(p => p.bloc || "_autre")).size;
    const points = Math.max(0, interp(max * 100, [[10, 20], [20, 14], [40, 0]]) - (nb < 3 ? 5 : 0));
    const texte = "La plus grosse ligne pèse " + pct(max) + " du financier, réparti sur " + nb + (nb > 1 ? " poches." : " poche.");
    const piste = max <= 0.2 && nb >= 3 ? "Votre financier est bien réparti : aucune ligne ne domine."
      : "Repère : aucune ligne au-delà de 20 % du financier et au moins 3 poches, pour qu'un seul support ne pèse pas sur l'ensemble.";
    return { ...base, valeur: max, points, aCompleter: false, texte, piste };
  }

  function itemPatrimoine(positions, profil, scope, totaux) {
    const age = profil && profil.foyer && profil.foyer.age;
    const repere = REPERES_AGE[age];
    const base = { cle: "patrimoine", titre: "Patrimoine net", cible: repere ? fr(repere) + " année" + (repere > 1 ? "s" : "") + " de revenus" : "selon l'âge" };
    if (!repere) return { ...base, valeur: null, aCompleter: true,
      texte: "Âge non renseigné.", piste: "Indiquez votre tranche d'âge dans le Profil pour comparer votre patrimoine au repère." };
    if (!(totaux.revenus > 0)) return { ...base, valeur: null, aCompleter: true,
      texte: "Revenus inconnus.", piste: "Renseignez vos revenus dans le Profil pour situer votre patrimoine." };
    const net = Calc.patrimoine(positions, profil, scope).net;
    const annees = net / (totaux.revenus * 12);
    const points = clamp(annees / repere, 0, 1) * 20;
    const texte = "Patrimoine net : " + fr(Math.max(annees, 0)) + " année" + (annees >= 2 ? "s" : "") + " de revenus (repère à votre âge : " + fr(repere) + ").";
    const piste = annees >= repere ? "Vous êtes au niveau du repère de votre tranche d'âge."
      : "Le patrimoine se construit surtout par l'épargne régulière et le remboursement des crédits ; vos objectifs du Plan en donnent le rythme.";
    return { ...base, valeur: annees, points, aCompleter: false, texte, piste };
  }

  /** Score de santé sur 100 : cinq critères sur 20 ; les critères à compléter sont exclus et le total ramené sur 100. */
  function score(ctx) {
    const c = ctx || {}, scope = c.scope || "foyer", positions = c.positions || [];
    const b = c.budget;
    const lignes = Array.isArray(b) ? b : b && Array.isArray(b.lignes) ? b.lignes : [];
    const totaux = b && !Array.isArray(b) && typeof b.depenses === "number" ? b : budgetTotaux(lignes, c.profil, scope);
    const items = [
      itemMatelas(positions, scope, totaux, c.config),
      itemEpargne(totaux),
      itemEndettement(totaux),
      itemConcentration(positions, scope),
      itemPatrimoine(positions, c.profil, scope, totaux),
    ].map(i => ({ ...i, points: i.aCompleter ? 0 : Math.round(i.points), sur: 20 }));
    const complets = items.filter(i => !i.aCompleter);
    const total = complets.length ? Math.round(sum(complets, i => i.points) / (20 * complets.length) * 100) : 0;
    return { total, complet: complets.length === items.length, items };
  }

  return { RENDEMENTS, REPERES_AGE, mensuel, budgetTotaux, capaciteEpargne, affecterDeja, effortMensuel, valeurFuture, moisEntre, dateAtteinte,
    dejaObjectif, statutObjectif, repartirEpargne, projection, score };
});
