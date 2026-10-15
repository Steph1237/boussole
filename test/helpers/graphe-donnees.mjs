// Données fictives et bancs d'essai du graphe maître (web/src/graphe-patrimoine.js) : un jeu de `donnees` au contrat du composant (passé observé et reconstitué,
// projection P10 à P90, couche « existant » calculée aux anniversaires seulement, jalons dont 4 en 10 mois, 3 objectifs, capacité par période, garde-fous),
// un faux UI.panneau, et le montage du composant dans le mini-DOM. Aucune donnée réelle.
import { createRequire } from "node:module";
import { miniDom } from "./mini-dom.mjs";
const require = createRequire(import.meta.url);
export const G = require("../../web/src/graphe-patrimoine.js");

export const AUJ = "2026-10-14";
const ms = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = t => new Date(t).toISOString().slice(0, 10);
const plusMois = (s, k) => { const d = new Date(ms(s)), y = d.getUTCFullYear(), m = d.getUTCMonth() + k; const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; return iso(Date.UTC(yy, mm, Math.min(d.getUTCDate(), new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()))); };
export { plusMois };

/** Jeu de données complet. opts : { passeMois (36), derniereValeur (193490), horizonMois (120), sansPasse, sansFutur, sansEvenement, existantNegatif, capaciteNegative, medianeSousExistant }. */
export function donnees(opts) {
  const o = Object.assign({ passeMois: 36, derniereValeur: 193490, horizonMois: 120 }, opts || {});
  const V0 = o.derniereValeur, passe = [];
  if (!o.sansPasse) {
    for (let k = -o.passeMois; k <= 0; k++) {
      const v = V0 * Math.pow(1.004, k) - Math.max(0, (k + 12)) * 0;
      passe.push({ date: k === 0 ? AUJ : plusMois(AUJ, k), valeur: Math.round(v * 100) / 100, nature: k <= -6 ? "reconstitue" : "observe" });
    }
  }
  const N = o.horizonMois, mois = [], p = { p10: [], p25: [], p50: [], p75: [], p90: [] }, ex = { p25: [], p50: [], p75: [] }, vers = [], crois = [], epf = [];
  const Z = { p10: -1.2816, p25: -0.6745, p75: 0.6745, p90: 1.2816 };
  for (let t = 0; t <= N; t++) {
    mois.push(plusMois(AUJ, t));
    const base = V0 * Math.pow(1.0045, t) + 700 * t, sg = 0.075 * Math.sqrt(t / 12);
    p.p50.push(Math.round(base)); ["p10", "p25", "p75", "p90"].forEach(k => p[k].push(Math.round(base * Math.exp(Z[k] * sg))));
    const ann = t % 12 === 0, e = V0 * Math.pow(1.0035, t);
    ex.p50.push(ann ? Math.round(e) : null); ex.p25.push(ann ? Math.round(e * Math.exp(-0.6745 * sg)) : null); ex.p75.push(ann ? Math.round(e * Math.exp(0.6745 * sg)) : null);
    epf.push(ann ? Math.round(base - e) : null); vers.push(700 * t); crois.push(ann ? Math.round(base - e - 700 * t) : null);
  }
  const jalons = o.sansEvenement ? [] : [
    { id: "ev:emploi", date: plusMois(AUJ, 2), titre: "Nouvel emploi de Sam", type: "changement_emploi", source: "evenement", icone: "emploi", evenement_id: "e-emploi", effet: { texte: "+450 €/mois d'épargne", montants: { epargne: 450 } } },
    { id: "ev:naissance", date: plusMois(AUJ, 6), titre: "Naissance", type: "naissance", source: "evenement", icone: "enfant", evenement_id: "e-naissance", effet: { texte: "−250 €/mois", montants: { mensuel: -250 } } },
    { id: "credit:pret", date: plusMois(AUJ, 8), titre: "Fin du prêt étudiant", type: "fin_credit", source: "credit", icone: "cle", effet: { texte: "+210 €/mois d'épargne en plus", montants: { mensualite: 210 } } },
    { id: "ev:creche", date: plusMois(AUJ, 9), fin: plusMois(AUJ, 46), titre: "Crèche", type: "creche", source: "evenement", icone: "enfant", evenement_id: "e-creche", effet: { texte: "−380 €/mois", montants: { mensuel: -380 } } },
    { id: "cal:pea", date: plusMois(AUJ, 14), titre: "PEA : 5 ans révolus", type: "pea_5_ans", source: "calendrier", icone: "calendrier", effet: { texte: "Retrait partiel sans clôture du plan.", montants: {} } },
    { id: "objectif:matelas", date: plusMois(AUJ, 20), titre: "Matelas de 6 mois", type: "objectif", source: "objectif", icone: "drapeau", effet: { texte: "cible de 17 k€ : 9 chances sur 10", montants: { cible: 17400, probabilite: 0.9 } } },
    { id: "objectif:voiture", date: plusMois(AUJ, 23), titre: "Voiture 12 k€", type: "objectif", source: "objectif", icone: "drapeau", effet: { texte: "", montants: { cible: 12000, probabilite: 0.3 } } },
    { id: "ev:achat", date: plusMois(AUJ, 32), titre: "Achat de la résidence principale", type: "achat_immobilier", source: "evenement", icone: "maison", evenement_id: "e-achat", effet: { texte: "apport −60 k€", montants: { frais_acquisition: 24000, apport: -60000 } } },
    { id: "objectif:apport", date: plusMois(AUJ, 32), titre: "Apport de 60 k€", type: "objectif", source: "objectif", icone: "drapeau", effet: { texte: "", montants: { cible: 60000, probabilite: 0.7 } } },
  ];
  const objectifs = o.sansEvenement ? [] : [
    { id: "matelas", nom: "Matelas de 6 mois", cible: 17400, date: plusMois(AUJ, 20), probabilite: 0.9, mot: "probable", statut: "avance", valeur_deterministe: 19000, deja: 11200 },
    { id: "voiture", nom: "Voiture 12 k€", cible: 12000, date: plusMois(AUJ, 23), probabilite: 0.3, mot: "peu probable", statut: "retard", valeur_deterministe: 9000, deja: 2000, leviers: [{ titre: "+140 €/mois", detail: "à l'échéance, au rythme médian", question: "Et si j'épargnais 140 € de plus par mois pour la voiture ?" }] },
    { id: "apport", nom: "Apport de 60 k€", cible: 60000, date: plusMois(AUJ, 32), probabilite: 0.7, mot: "incertain", statut: "dans_les_temps", valeur_deterministe: 61000, deja: 30000 },
  ];
  const periodes = [{ debut: plusMois(AUJ, 1), fin: plusMois(AUJ, 2), montant_mensuel: 950, raison: "capacité constatée (12 mois)", source: "constatee" },
    { debut: plusMois(AUJ, 3), fin: plusMois(AUJ, 7), montant_mensuel: 1400, raison: "nouvel emploi de Sam : +450 €/mois d'épargne", source: "evenement", evenement_id: "e-emploi" },
    { debut: plusMois(AUJ, 8), fin: plusMois(AUJ, 9), montant_mensuel: 1150, raison: "naissance : −250 €/mois", source: "evenement", evenement_id: "e-naissance" },
    { debut: plusMois(AUJ, 10), fin: plusMois(AUJ, N), montant_mensuel: 1360, raison: "fin du prêt étudiant : +210 €/mois", source: "credit" }];
  if (o.medianeSousExistant) { for (let t = 0; t <= N; t++) { p.p50[t] = Math.round(V0 * Math.pow(1.0045, t) - 900 * t); ["p10", "p25", "p75", "p90"].forEach(k => { p[k][t] = Math.round(p.p50[t] * Math.exp(Z[k] * 0.075 * Math.sqrt(t / 12))); }); } }
  return {
    today: AUJ, vue: "net", euros: "constants", mode: "patrimoine", etat: "pret", perimetre: "du foyer",
    passe: o.sansPasse ? null : { points: passe, drapeaux: { viaTransactions: ["ETF Monde"], compositionActuelle: [], bancaires: [], constantes: { noms: ["Livret A"], montant: 12000 }, courteHistoire: [] }, decalage: -1500, euros_constants: true },
    futur: o.sansFutur ? null : { mois, p10: p.p10, p25: p.p25, p50: p.p50, p75: p.p75, p90: p.p90, existant: { p25: ex.p25, p50: ex.p50, p75: ex.p75 }, epargne_future: { versements_cumules: vers, croissance: crois, p50: epf } },
    jalons, objectifs, capacite: { base: o.capaciteNegative ? { retenue: -420, source: "reel", constatee: -420, prevue: 1500, periode: "octobre 2025 à septembre 2026", constatee_detail: { montant: -420, mois: 12, revenus: 300, depenses: 1120, periode: "octobre 2025 à septembre 2026" } } : { retenue: 950, source: "reel", constatee: 950, prevue: 1500, periode: "avril à septembre 2026" },
      par_periode: o.capaciteNegative ? periodes.map((p, i) => (i === 0 ? Object.assign({}, p, { montant_mensuel: -420 }) : p)) : periodes,
      passe: Array.from({ length: 12 }, (_, k) => ({ debut: plusMois(AUJ.slice(0, 8) + "01", k - 12), montant: o.capaciteNegative ? -380 - 10 * k : 800 + 25 * k })) }, capacite_source: "reel", capacite_periode: "avril à septembre 2026",
    phrase: "Aujourd'hui : 193 k€", decomposition: [{ date: plusMois(AUJ, 120), frais: 20000, total: 400000, depart: V0, versements: 84000, marches: 120000, impots: 0 }],
    garde_fous: [{ cle: "ecart_capacite", niveau: "info", texte: "Ta capacité d'épargne constatée est de 950 € par mois (avril à septembre 2026), contre 1 500 € prévus au budget : la projection part de la capacité constatée." }],
    evenements_pris_en_compte: o.sansEvenement ? [] : ["Nouvel emploi de Sam", "Naissance", "Crèche", "Achat de la résidence principale"],
    question_evenements: "Aucun événement renseigné — as-tu des changements prévus ? Un enfant, un changement d'emploi, un déménagement, un achat ?",
    hypotheses: [{ cle: "inflation_hypothese", libelle: "Inflation supposée", valeur: 2, unite: "%", source_titre: "BCE", source_url: "https://www.ecb.europa.eu/mopo/strategy/pricestab/html/index.fr.html", verifie_le: "2026-09-25", statut: "ok" }],
    couverture: 0.8, avertissements: [], a_completer: [{ cle: "prix_revient:PER", titre: "Prix de revient de « PER »", effet: "sans lui, l'impôt à la sortie est sous-estimé", phrase_claude: "Aide-moi à renseigner le prix de revient de mon PER." }],
    retro: null, version_modele: "proj-1.0.0", graine: 20261014, chemins: 2000, progressif: false,
    plans: [{ id: "plan-1", cree_le: plusMois(AUJ, -9) + "T20:00:00.000Z", raison: "revue_mensuelle", horizon_mois: 120 }], variantes: [{ id: "v-enfant", nom: "2ᵉ enfant" }], crises: [{ cle: "gfc_2008", label: "Crise financière (2007-2009)" }],
  };
}

/** Faux UI : un panneau qui enregistre ce qu'on lui ouvre. */
export function fauxUI(doc) {
  const st = { ouvert: false, appels: [], corps: null, titre: "", pied: "" };
  const U = {
    st,
    panneau: {
      ouvrir(o) { st.ouvert = true; st.appels.push(o); st.titre = o.titre; st.pied = o.pied || ""; st.retour = o.retour || st.retour; st.surFermeture = o.surFermeture;
        if (!st.corps) st.corps = doc.createElement("div"); st.corps.innerHTML = String(o.contenu || ""); if (!st.corps.isConnected) doc.body.appendChild(st.corps); return st.corps; },
      remplacer(o) { if (!st.ouvert) return null; if (o.contenu !== undefined) st.corps.innerHTML = String(o.contenu); return st.corps; },
      fermer(o) { if (!st.ouvert) return; st.ouvert = false; const r = st.retour; st.retour = null; if (!(o && o.focus === false) && r && r.focus) r.focus(); },
      ouvert: () => st.ouvert,
    },
    demanderAClaude: (q, l) => '<a class="ui-claude" href="https://claude.ai/new?q=' + encodeURIComponent(q) + '" target="_blank" rel="noopener noreferrer">' + (l || "Demander à Claude") + "</a>",
  };
  return U;
}

/** Monte le composant dans le mini-DOM, avec géométrie simulée (largeur de la carte, rectangle du calque de lecture). opts : { donnees, preset, largeur (358), fenetre, window, reglages, surReglages, … }. */
export function monter(opts) {
  const o = opts || {};
  const { doc, Ev, touche } = miniDom();
  const proto = Object.getPrototypeOf(doc.createElement("div"));
  const W = o.largeur || 358;
  if (!proto.__gpPatch) {
    Object.defineProperty(proto, "clientWidth", { get() { return this.getAttribute("class") && /gp-cadre/.test(this.getAttribute("class")) ? (proto.__W || 358) : 0; }, configurable: true });
    Object.defineProperty(proto, "clientHeight", { get() { return 400; }, configurable: true });
    proto.getBoundingClientRect = function () { const c = this.getAttribute("class") || "", st = this.getAttribute("style") || ""; const w = /gp-hit/.test(c) ? (proto.__W || 358) - (proto.__G || 50) : /gp-b-svg/.test(c) ? (proto.__W || 358) : 100; return { left: 0, top: 0, width: w, height: 100, right: w, bottom: 100 }; };
    proto.__gpPatch = true;
  }
  proto.__W = W; proto.__G = 50;
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const UI = fauxUI(doc);
  const stockage = new Map();
  const win = o.window === undefined ? { innerWidth: 390, innerHeight: 800, matchMedia: q => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { hash: o.hash || "", pathname: "/app.html", search: "" }, history: { state: null, replaceState(s, t, u) { win.location.hash = u.includes("#") ? u.slice(u.indexOf("#")) : ""; win.__remplace = u; } } } : o.window;
  const deps = { document: doc, window: win, UI, localStorage: { getItem: k => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, String(v)), removeItem: k => stockage.delete(k) }, mesurer: (t, p) => String(t).length * (p >= 600 ? 6.9 : 6.4) };
  const calculs = [];
  const api = G.monter(host, Object.assign({ preset: "aujourdhui", donnees: o.donnees === undefined ? donnees() : o.donnees, deps, surReglages: r => { calculs.push(r); return Promise.resolve(o.donneesApres || null); }, claude: UI.demanderAClaude }, o.opt || {}, o.fenetre ? { fenetre: o.fenetre } : {}));
  return { api, doc, Ev, touche, host, UI, win, deps, calculs, stockage, q: s => host.querySelector(s), qa: s => host.querySelectorAll(s), texte: s => (host.querySelector(s) ? host.querySelector(s).textContent : null) };
}
