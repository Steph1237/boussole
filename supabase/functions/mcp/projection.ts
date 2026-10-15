// Projection du patrimoine (PROJ, docs/superpowers/specs/2026-10-14-proj-projection-design.md § 3, § 7, § 8) : outils MCP du Copilote.
//   decrire_foyer       → propositions : événements de vie (cible evenement), variantes (variante) et réglages de projection (config.projection) ;
//   lire_foyer          → lecture : événements, variantes, réglages, plans figés, catalogue des types et valeurs par défaut sourcées ;
//   projeter            → lecture : résumé de la projection du moteur de l'app (jamais les chemins) ;
//   figer_projection    → proposition plan_fige : la projection rangée avec de quoi la rejouer, à comparer plus tard à la réalité ;
//   comparer_variantes  → lecture : écart chemin par chemin entre la situation actuelle (ou une variante) et une variante ;
//   capacite_emprunt    → lecture : capacité d'emprunt d'aujourd'hui (IMMO1) et, au choix, dans le temps.
// Le calcul est celui de l'app : projection-moteur.gen.js est une copie des modules purs de web/src (npm run gen), jamais un portage. Ce
// module convertit les lignes SQL en formes de l'app (comme calendrier.ts), appelle le moteur et résume. Il ne dépend pas d'index.ts :
// les utilitaires du serveur (wrap, must, UserError, DEPOT, deposer, today, banque) sont passés en paramètre.
// Jamais un chiffre inventé : un repère manquant rend la règle indisponible (le moteur le dit), une donnée manquante est dite à compléter.
import { z } from "zod";
import { Projection, Evenements, Marche, Reperes } from "./projection-moteur.gen.js";

export const HORIZONS = [5, 10, 15, 20, 25];
export const PERIMETRES = ["foyer", "p1", "p2"];
export const VUES = ["net", "financier", "disponible"];
export const PLANS_FIGES_MAX = 60;
export const PLAN_MAX_OCTETS = 400000, PLAN_PARAMETRES_MAX_OCTETS = 100000, PLAN_SERIE_MAX_OCTETS = 250000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POS_SELECT = "*, instrument:instruments(price, price_date, ter, zone, devise)";
const QUESTION_EVENEMENTS = "Aucun événement renseigné — as-tu des changements prévus ? Un enfant, un changement d'emploi, un déménagement, un achat ?";

/** Conduite du Copilote pour les projections (spec § 7.3), renvoyée par projeter et lire_foyer et reprise dans les INSTRUCTIONS. */
export const CONDUITE_PROJECTION = [
  "1. Pars des valeurs par défaut sourcées (valeurs_par_defaut de decrire_foyer, hypotheses de projeter) et dis-les. Ne demande que ce qui change notablement le résultat : la date et le prix d'un achat, les frais d'une école, les charges d'un bien.",
  "2. Pour un enfant, demande seulement la date (réelle ou prévue) et un libellé court ; jamais de prénom.",
  "3. Propose les événements avec decrire_foyer, ne les écris jamais : l'utilisateur valide dans Boussole › Agent › À valider.",
  "4. Une projection n'est pas une promesse. Donne des ordres de grandeur arrondis, toujours avec la bande (P10 à P90), en euros d'aujourd'hui.",
  "5. Quand l'utilisateur retient un scénario, consigne-le au journal (journaliser) avec version_modele ; pour pouvoir le comparer plus tard à la réalité, propose de figer la projection (figer_projection, qu'il valide dans Boussole).",
  "6. Ne recommande jamais un produit ; parle d'enveloppes, de classes d'actifs et de leviers.",
  "7. Avant de montrer une projection, regarde les événements enregistrés (lire_foyer ; projeter les rend dans evenements_pris_en_compte). S'il n'y en a aucun, demande une fois : « Tu as des changements prévus ? Un enfant, un changement d'emploi, un déménagement, un achat ? » ; ne redemande pas dans la même session.",
  "8. Quand la capacité d'épargne prévue et la constatée diffèrent (garde-fou ecart_capacite), demande pourquoi avant de proposer de changer la base : période sans revenu, dépense exceptionnelle, nouvel emploi (à décrire en changement_emploi).",
];
export const CONDUITE_IMMO = [
  "Présente la capacité d'emprunt comme une estimation selon les règles du HCSF : chaque banque décide. Dis le taux utilisé avec sa date et sa source (taux.source, taux.date_effet), et ce qui manque (manquants, avertissements).",
  "Si des revenus, des primes, le taux d'un crédit ou l'apport manquent, demande-les (un seul à la fois) plutôt que de les supposer.",
  "Ne recommande ni établissement, ni produit, ni montant à emprunter : décris ce que les règles permettent.",
];

/** Date AAAA-MM-JJ réelle (le 30 février n'existe pas). */
export const dateReelle = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const nombre = (v: any) => (v == null || v === "" ? null : +v);
const r0 = (x: any) => (x == null || !isFinite(+x) ? null : Math.round(+x));
const r2 = (x: any) => (x == null || !isFinite(+x) ? null : Math.round(+x * 100) / 100);
const jour = (v: any) => (v == null ? null : String(v).slice(0, 10));
/** Égalité structurelle (clés dans n'importe quel ordre). */
export function pareil(a: any, b: any): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x: any, i: number) => pareil(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => pareil(a[k], b[k]));
  }
  return false;
}

/* ---------- lignes SQL → formes de l'app (mêmes correspondances que web/src/store-supabase.js) ---------- */
export function positionEnApp(r: any) {
  const ins = r.instrument ?? r.instruments ?? null, insDate = ins?.price_date ?? null;
  const useOv = r.price_override != null && (!insDate || !r.value_date || r.value_date >= insDate);
  return {
    id: r.id, name: r.name, envelope: r.envelope, owner: r.owner, bloc: r.bloc, mode: r.mode, isin: r.isin || null, qty: nombre(r.qty), pru: nombre(r.pru),
    price: useOv ? +r.price_override : ins && ins.price != null ? +ins.price : null, priceDate: useOv ? r.value_date : insDate,
    value: nombre(r.value), valueDate: r.value_date || null, status: r.status, hypothesis: r.hypothesis || null, qtyEstimated: !!r.qty_estimated, note: r.note || null,
    ter: ins && ins.ter != null ? +ins.ter : null, zone: ins?.zone || null, devise: ins?.devise || null,
  };
}
export function profilEnApp(p: any, biens: any[], credits: any[]) {
  return {
    foyer: p?.foyer || {}, personnes: p?.personnes || {}, autres: p?.autres || {}, protection: p?.protection || {},
    biens: (biens ?? []).map((b: any) => ({ id: b.id, nom: b.nom, usage: b.usage, valeur: nombre(b.valeur), part_p1: nombre(b.part_p1), crd: nombre(b.crd), mensualite: nombre(b.mensualite), loyer: nombre(b.loyer) })),
    credits: (credits ?? []).map((c: any) => ({ id: c.id, nom: c.nom, owner: c.owner, crd: nombre(c.crd), mensualite: nombre(c.mensualite) })),
    ...(p?.foyer?.biensRenseignes ? { biensRenseignes: true } : {}),
  };
}
export const objectifEnApp = (r: any) => ({
  id: r.id, nom: r.nom || "", type: r.type, cible: nombre(r.cible), dateCible: r.date_cible || null, deja: nombre(r.deja), source: r.source, poches: r.poches || [],
  enveloppes: r.enveloppes || [], rendement: nombre(r.rendement), priorite: r.priorite == null ? 0 : +r.priorite,
});
export const evenementEnApp = (r: any) => ({
  id: r.id, variante_id: r.variante_id || null, type: r.type, personne: r.personne, libelle: r.libelle, date: String(r.date).slice(0, 10), fin: r.fin ? String(r.fin).slice(0, 10) : null,
  params: isObj(r.params) ? r.params : {}, source: r.source,
});
export const varianteEnApp = (r: any) => ({
  id: r.id, nom: r.nom, description: r.description || "", retire: Array.isArray(r.retire) ? r.retire : [], hypotheses: isObj(r.hypotheses) ? r.hypotheses : {},
});
export const indiceEnApp = (r: any) => ({ serie: r.serie, mois: String(r.mois).slice(0, 10), valeur: +r.valeur, source_titre: r.source_titre, source_url: r.source_url, verifie_le: r.verifie_le });

/** Table pas encore créée (migration non appliquée) ou introuvable : lecture vide plutôt qu'un échec. */
const tableAbsente = (e: any) => !!e && e.code !== "42703" && (e.code === "42P01" || e.code === "PGRST205" || (!e.code && /relation .* does not exist|schema cache/i.test(String(e.message ?? ""))));
async function lireOptionnelle(req: any, table: string, must: any): Promise<any[]> {
  const r = await req;
  if (r?.error && tableAbsente(r.error)) return [];
  return (must(table, r) as any[]) ?? [];
}

/** Lignes du foyer nécessaires au moteur → entrée du moteur (formes de l'app). `banque` : chargeur facultatif de { comptes, mois } (lignes SQL ; null si
    l'interrupteur est éteint ou la double authentification absente). Une erreur de lecture lève (les appelants décident). */
export async function lireDonneesProjection(db: any, must: any, auj: string, banque?: () => Promise<any>, opts: { historique?: boolean } = {}) {
  const banqueP = banque ? Promise.resolve().then(banque).catch(() => null) : Promise.resolve(null);
  const historiqueP = opts.historique ? lireHistorique(db, must, auj) : Promise.resolve(undefined);
  const [po, cf, pr, bi, cr, bu, ob, ev, va, rp, ix] = await Promise.all([
    db.from("positions").select(POS_SELECT).order("created_at"),
    db.from("config").select("*").maybeSingle(),
    db.from("profiles").select("*").maybeSingle(),
    db.from("biens").select("*").order("created_at"),
    db.from("credits").select("*").order("created_at"),
    db.from("budgets").select("lignes").maybeSingle(),
    db.from("objectifs").select("*").order("priorite").order("created_at"),
    db.from("foyer_evenements").select("id, variante_id, type, personne, libelle, date, fin, params, source, created_at, updated_at").order("date").order("created_at"),
    db.from("foyer_variantes").select("id, nom, description, retire, hypotheses, created_at, updated_at").order("created_at"),
    db.from("reperes").select("cle, libelle, valeur, unite, date_effet, date_fin, source_titre, source_url, verifie_le, mode").order("cle"),
    db.from("indices_mensuels").select("serie, mois, valeur, source_titre, source_url, verifie_le").eq("serie", "ipc_insee").order("mois"),
  ]);
  const profilLu = must("profiles", pr) as any;
  const config = (must("config", cf) as any) ?? {};
  const profil = profilEnApp(profilLu, (must("biens", bi) as any[]) ?? [], (must("credits", cr) as any[]) ?? []);
  const budget = must("budgets", bu) as any;
  const bq = await banqueP;
  const evenements = (await lireOptionnelle(Promise.resolve(ev), "foyer_evenements", must)).map(evenementEnApp);
  const variantes = (await lireOptionnelle(Promise.resolve(va), "foyer_variantes", must)).map(varianteEnApp);
  const indices = (await lireOptionnelle(Promise.resolve(ix), "indices_mensuels", must)).map(indiceEnApp);
  const historique = await historiqueP;
  return {
    today: auj, positions: ((must("positions", po) as any[]) ?? []).map(positionEnApp), instruments: [], config: { ...config, projection: isObj(config.projection) ? config.projection : {} },
    profil, credits: profil.credits, biens: profil.biens, budget: { lignes: Array.isArray(budget?.lignes) ? budget.lignes.map((l: any) => ({ ...l, montant: nombre(l.montant) })) : [] },
    banque: bq ? { actif: true, comptes: bq.comptes ?? [], mois: bq.mois ?? [] } : null, objectifs: ((must("objectifs", ob) as any[]) ?? []).map(objectifEnApp),
    foyer: { evenements, variantes }, reperes: Reperes.depuisLignes((must("reperes", rp) as any[]) ?? []), indices, classes: isObj(profilLu?.classes) ? profilLu.classes : {},
    ...(historique ? { historique } : {}),
  };
}

const PAGE = 1000;
/** Toutes les lignes d'une requête paginée (2 pages au plus : 2 000 lignes, soit plus de cinq ans de photos quotidiennes). */
async function lirePages(requete: (de: number, a: number) => any, table: string, must: any): Promise<any[]> {
  const out: any[] = [];
  for (let page = 0; page < 2; page++) {
    const lignes = await lireOptionnelle(Promise.resolve(requete(page * PAGE, page * PAGE + PAGE - 1)), table, must);
    out.push(...lignes);
    if (lignes.length < PAGE) break;
  }
  return out;
}
/** Historique du rétro-contrôle (spec § 6.9) : photos du patrimoine avec leur composition (une par mois) et flux observés (versements, retraits), cinq ans au plus.
    Une lecture impossible ne fait pas échouer la projection : le rétro-contrôle le dit (erreur). */
export async function lireHistorique(db: any, must: any, auj: string) {
  const d = new Date(auj + "T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() - 5);
  const depuis = d.toISOString().slice(0, 10);
  try {
    const [photos, tx] = await Promise.all([
      lirePages((de, a) => db.from("snapshots").select("date, total, by_bloc").gte("date", depuis).order("date").range(de, a), "snapshots", must),
      lirePages((de, a) => db.from("transactions").select("date, type, amount").in("type", ["versement", "programme", "retrait"]).gte("date", depuis).order("date").range(de, a), "transactions", must),
    ]);
    return Projection.historiquePourRetro(photos, tx);
  } catch (_e) {
    return { points: [], flux: [], erreur: "lecture impossible" };
  }
}

/* ---------- options et calculs ---------- */
export function optionsDe(a: any) {
  const o: Record<string, unknown> = { horizon_ans: a?.horizon_ans ?? 10, perimetre: a?.perimetre ?? "foyer", vue: a?.vue ?? "net", euros: a?.euros ?? "constants", net_impots: a?.net_impots === true };
  if (a?.variante) o.variante = a.variante;
  return o;
}
const cherche = (data: any, id: string) => (data.foyer.variantes as any[]).find((v) => v.id === id) ?? null;
function exigerVariante(data: any, id: any, UserError: any) {
  if (id && !cherche(data, id)) throw new UserError(`variante : « ${id} » introuvable (lire_foyer donne les variantes et leurs identifiants).`);
}
const bandeRd = (o: any) => (o ? { p10: r2(o.p10), p50: r2(o.p50), p90: r2(o.p90) } : null);
/** Rendement annualisé des placements (TWR : sans l'effet des versements, net de frais, avant impôts, comptes courants exclus) : rendement attendu de l'allocation actuelle (moyenne
    pondérée des hypothèses de classe, nette de frais), médiane simulée et bande P10 à P90 sur tout l'horizon et à quelques anniversaires, année par année (10 premières), en nominal
    et en euros d'aujourd'hui (réel, inflation supposée retirée). Pourcentages. null si la sortie n'en porte pas ; disponible: false sans placement. */
export function resumeRendement(rd: any) {
  if (!rd) return null;
  const tete = { methode: rd.methode, unite: rd.unite, avant_impots: rd.avant_impots, perimetre: rd.perimetre, inflation_pct: r2(rd.inflation_pct) };
  if (!rd.disponible) return { ...tete, disponible: false, raison: rd.raison };
  const H = rd.horizon.ans, at = (a: any, t: number) => bandeRd(a ? { p10: a.p10[t], p50: a.p50[t], p90: a.p90[t] } : null);
  const ancres = [1, 3, 5, 10, 15, 20, 25].filter((y) => y < H).concat([H]);
  const k = Math.min(H, 10);
  return {
    ...tete, disponible: true,
    a_dire: "Dis toujours « net de frais, avant impôts, sur les placements (comptes courants exclus) ». L'attendu est la moyenne pondérée des hypothèses de classe de l'allocation actuelle ; le médian simulé et la bande P10 à P90 sont ceux de la projection. Cite le réel (après inflation, en euros d'aujourd'hui) sauf si l'utilisateur parle en nominal. Une fourchette, jamais une promesse.",
    attendu: { nominal_pct: r2(rd.attendu.nominal_pct), reel_pct: r2(rd.attendu.reel_pct), frais_moyens_pct: r2(rd.attendu.frais_pct) },
    horizon: { annees: H, nominal: bandeRd(rd.horizon.nominal), reel: bandeRd(rd.horizon.reel) },
    annualise_a_l_anniversaire: ancres.map((y) => ({ annees: y, nominal: at(rd.annualise.nominal, 12 * y), reel: at(rd.annualise.reel, 12 * y) })),
    par_annee: Array.from({ length: k }, (_, i) => ({ annee: i + 1, date: rd.par_annee.dates[i], nominal: at(rd.par_annee.nominal, i), reel: at(rd.par_annee.reel, i) })),
    hypotheses_de_classe: Object.fromEntries(Object.entries(rd.classes ?? {}).map(([c, v]: [string, any]) => [c, { rendement_pct: r2(v.rendement), volatilite_pct: r2(v.volatilite) }])),
  };
}
/** Valeurs d'une série mensuelle aux années pleines (0, 12, 24…) : [{ annee, date, p10, p25, p50, p75, p90 }], arrondies à l'euro. */
export function serieAnnuelle(sortie: any, vue: string) {
  const c = sortie.vues?.[vue] ?? sortie.vues?.[Object.keys(sortie.vues ?? {})[0]];
  if (!c) return [];
  const out: any[] = [];
  for (let t = 0; t < sortie.mois.length; t += 12) out.push({ annee: t / 12, date: sortie.mois[t], p10: r0(c.p10[t]), p25: r0(c.p25[t]), p50: r0(c.p50[t]), p75: r0(c.p75[t]), p90: r0(c.p90[t]) });
  return out;
}
const aLHorizon = (c: any, t: number) => (c && c.p50 && c.p50[t] != null ? { p10: r0(c.p10[t]), p50: r0(c.p50[t]), p90: r0(c.p90[t]) } : null);
/** Résumé de la sortie de Projection.simuler pour le Copilote : bande par année, couches existant / épargne future, capacité, garde-fous, événements, jalons,
    objectifs, hypothèses sourcées. Jamais les chemins ni les séries mensuelles. */
export function resumeProjection(sortie: any) {
  const N = sortie.mois.length - 1;
  const vue = sortie.vue;
  return {
    version_modele: sortie.version_modele, graine: sortie.graine, chemins: sortie.chemins, today: sortie.today, horizon_ans: sortie.horizon_ans, vue, euros: sortie.euros, net_impots: sortie.net_impots,
    phrase: sortie.phrase, decomposition_phrase: sortie.decomposition_phrase ?? null,
    serie_annuelle: serieAnnuelle(sortie, vue),
    couches_a_l_horizon: { existant: aLHorizon(sortie.existant, N), epargne_future: aLHorizon(sortie.epargne_future, N), versements_cumules: r0(sortie.epargne_future?.versements_cumules?.[N]) },
    capacite_base: sortie.capacite_base, capacite_par_periode: sortie.capacite_par_periode, decomposition: sortie.decomposition,
    garde_fous: sortie.garde_fous, evenements_pris_en_compte: sortie.evenements_pris_en_compte, question_evenements: sortie.question_evenements ?? null,
    objectifs: (sortie.objectifs ?? []).map((o: any) => ({ id: o.id, nom: o.nom, cible: r0(o.cible), date: o.date, probabilite: o.probabilite == null ? null : r2(o.probabilite), mot: o.mot, statut: o.statut })),
    manquer_argent: sortie.manquer_argent ? { probabilite: r2(sortie.manquer_argent.probabilite), date_p10: sortie.manquer_argent.date_p10 } : null,
    jalons: (sortie.jalons ?? []).slice(0, 15).map((j: any) => ({ date: j.date, titre: j.titre, type: j.type, effet: j.effet?.texte ?? "" })),
    jalons_omis: Math.max(0, (sortie.jalons ?? []).length - 15),
    hypotheses: (sortie.hypotheses ?? []).map((h: any) => ({ cle: h.cle, valeur: h.valeur, unite: h.unite, source: h.source_titre, url: h.source_url, verifie_le: h.verifie_le, statut: h.statut })),
    hypotheses_classes: sortie.hypotheses_classes, a_completer: sortie.a_completer, couverture: r2(sortie.couverture), avertissements: sortie.avertissements,
    rendement: resumeRendement(sortie.rendement),
    ...resumeRetro(sortie),
  };
}
/** Rétro-contrôle (spec § 6.9) : la projection rejouée depuis des dates passées, et la part des valeurs réelles à 12 mois que ses bandes ont encadrées. `retro` n'existe
    qu'avec au moins 24 dates de départ ; sinon null et retro_raison dit pourquoi. */
export function resumeRetro(sortie: any) {
  const r = sortie.retro;
  if (!r) return { retro: null, retro_raison: sortie.retro_raison ?? "rétro-contrôle indisponible" };
  return {
    retro: {
      n: r.n, horizon_mois: r.horizon_mois, premiere_date: r.premiere_date, derniere_date: r.derniere_date,
      p10_p90: { dans: r.dans_p10_p90, taux: r2(r.taux_p10_p90), attendu: r.attendu_p10_p90 }, p25_p75: { dans: r.dans_p25_p75, taux: r2(r.taux_p25_p75), attendu: r.attendu_p25_p75 },
      sous_p10: r.sous_p10, au_dessus_p90: r.au_dessus_p90, bandes_trop_etroites: r.bandes_trop_etroites, phrase: r.phrase, limites: r.limites,
    },
    retro_raison: null,
  };
}
/** Une crise rejouée : valeurs annuelles avec la crise et sans (rendements attendus), écart final. */
export function resumeCrise(crise: any, sortie: any) {
  if (crise.indisponible) return { indisponible: true, avertissements: crise.avertissements };
  const vue = sortie.vue, base = sortie.deterministe_detail?.[sortie.euros === "courants" ? "courants" : "constants"]?.[vue] ?? [];
  const annees: any[] = [];
  for (let t = 0; t < crise.mois.length; t += 12) annees.push({ annee: t / 12, date: crise.mois[t], avec_la_crise: r0(crise.valeurs[vue][t]), sans_la_crise: r0(base[t]) });
  const N = crise.mois.length - 1;
  return { cle: crise.cle, label: crise.label, debut: crise.debut, fenetre_mois: crise.fenetre_mois, annees, ecart_final: r0(crise.valeurs[vue][N] - (base[N] ?? 0)),
    avertissements: crise.avertissements, source: crise.source };
}

/* ---------- événements de vie et variantes : validation et propositions ---------- */
const CHAMPS_EVENEMENT = ["type", "personne", "libelle", "date", "fin", "params", "source", "variante_id"];
const CHAMPS_VARIANTE = ["nom", "description", "retire", "hypotheses"];
const retirer = (o: any, cles: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => cles.includes(k)));
const sansUndef = (o: any) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
/** Texte lisible d'un événement : « Naissance (Enfant 2) le 01/03/2027 ». */
export function texteEvenement(e: any): string {
  const t = Evenements.ENTREES?.[e.type]?.titre ?? e.type;
  const d = String(e.date ?? "").split("-").reverse().join("/");
  return `${t} « ${e.libelle} »${d ? " le " + d : ""}${e.fin ? " jusqu'au " + String(e.fin).split("-").reverse().join("/") : ""} (${e.personne})`;
}
/** Événement existant + champs fournis (null retire fin ou variante_id, params remplacé en bloc) → événement résultant. */
function fusionEvenement(existant: any, a: any) {
  const base = retirer(existant, CHAMPS_EVENEMENT);
  const out: any = { ...base };
  for (const k of CHAMPS_EVENEMENT) if (a[k] !== undefined) out[k] = a[k];
  for (const k of ["fin", "variante_id"]) if (out[k] === null) delete out[k];
  return out;
}
const apresEvenement = (ev: any, sourceParDefaut: string) => sansUndef({
  type: ev.type, personne: ev.personne, libelle: typeof ev.libelle === "string" ? ev.libelle.trim() : ev.libelle, date: ev.date, fin: ev.fin ?? undefined,
  params: ev.params ?? {}, source: ev.source ?? sourceParDefaut, variante_id: ev.variante_id ?? undefined,
});
/** Écart entre deux versions complètes (champs de la liste) : { avant, apres } réduits à ce qui change, ou null. */
function ecartChamps(a: any, b: any, champs: string[]) {
  const avant: any = {}, apres: any = {};
  for (const k of champs) {
    const x = a?.[k] ?? null, y = b?.[k] ?? null;
    if (pareil(x, y)) continue;
    avant[k] = x; apres[k] = y;
  }
  return Object.keys(apres).length ? { avant, apres } : null;
}

/** Propositions d'un appel de decrire_foyer : { items, erreurs, avertissements, textes, defauts }. Pur (les données sont lues avant). */
export function propositionsFoyer(a: any, ctx: { evenements: any[]; variantes: any[]; credits: any[]; biens: any[]; reglages: any; reperes: any[]; today: string; source: string }) {
  const erreurs: string[] = [], avertissements: string[] = [], items: any[] = [], textes: string[] = [], defauts: any[] = [];
  const evs = ctx.evenements, vars = ctx.variantes;
  const limiteEv = Evenements.LIMITE_EVENEMENTS, limiteVar = Evenements.LIMITE_VARIANTES, parAppel = Evenements.LIMITE_PAR_APPEL;
  const lEv = Array.isArray(a.evenements) ? a.evenements : [], lVar = Array.isArray(a.variantes) ? a.variantes : [];
  if (lEv.length > parAppel) erreurs.push(`evenements : ${parAppel} événements au plus par appel.`);
  if (lVar.length > parAppel) erreurs.push(`variantes : ${parAppel} variantes au plus par appel.`);
  let creesEv = 0, supprEv = 0, creesVar = 0, supprVar = 0;
  const vus = new Set<string>();
  lEv.forEach((x: any, i: number) => {
    const L = `Événement ${i + 1}${x?.libelle ? " (" + x.libelle + ")" : ""}`;
    if (!isObj(x)) { erreurs.push(`${L} : objet attendu.`); return; }
    if (x.id != null) {
      if (vus.has(x.id)) { erreurs.push(`${L} : identifiant ${x.id} en double dans l'appel.`); return; }
      vus.add(x.id);
    }
    if (x.id != null && !UUID_RE.test(String(x.id))) { erreurs.push(`${L} : id invalide (identifiant d'un événement de lire_foyer).`); return; }
    const existant = x.id ? evs.find((e: any) => e.id === x.id) : null;
    if (x.id && !existant) { erreurs.push(`${L} : événement ${x.id} introuvable (lire_foyer).`); return; }
    if (x.supprimer === true) {
      if (!existant) { erreurs.push(`${L} : supprimer demande l'id de l'événement.`); return; }
      items.push({ cible: "evenement", operation: "supprimer", ref: existant.id, avant: apresEvenement(existant, ctx.source), apres: null });
      textes.push("Supprimer : " + texteEvenement(existant)); supprEv++;
      return;
    }
    const ev = existant ? fusionEvenement(existant, x) : fusionEvenement({}, x);
    if (ev.source == null || ev.source === "") ev.source = ctx.source.slice(0, 300);
    if (ev.variante_id && !vars.some((v: any) => v.id === ev.variante_id)) { erreurs.push(`${L} : variante ${ev.variante_id} introuvable (lire_foyer).`); return; }
    const msg = Evenements.validerEvenement(ev, { today: ctx.today, credits: ctx.credits, biens: ctx.biens });
    if (msg) { erreurs.push(`${L} : ${msg}`); return; }
    const complet = apresEvenement(ev, ctx.source);
    if (existant) {
      const ec = ecartChamps(apresEvenement(existant, ctx.source), complet, CHAMPS_EVENEMENT);
      if (!ec) return;
      items.push({ cible: "evenement", operation: "modifier", ref: existant.id, avant: ec.avant, apres: ec.apres });
      textes.push("Modifier : " + texteEvenement(complet));
    } else {
      items.push({ cible: "evenement", operation: "creer", apres: complet });
      textes.push("Ajouter : " + texteEvenement(complet)); creesEv++;
    }
    const d = Evenements.defautsDe(complet, ctx.reperes);
    if (d.length) defauts.push({ evenement: complet.libelle, type: complet.type, valeurs: d });
  });
  if (evs.length + creesEv - supprEv > limiteEv) erreurs.push(`Limite atteinte : ${limiteEv} événements au plus. Supprime un événement avant d'en ajouter un.`);
  lVar.forEach((x: any, i: number) => {
    const L = `Variante ${i + 1}${x?.nom ? " (" + x.nom + ")" : ""}`;
    if (!isObj(x)) { erreurs.push(`${L} : objet attendu.`); return; }
    if (x.id != null && !UUID_RE.test(String(x.id))) { erreurs.push(`${L} : id invalide (identifiant d'une variante de lire_foyer).`); return; }
    const existante = x.id ? vars.find((v: any) => v.id === x.id) : null;
    if (x.id && !existante) { erreurs.push(`${L} : variante ${x.id} introuvable (lire_foyer).`); return; }
    if (x.supprimer === true) {
      if (!existante) { erreurs.push(`${L} : supprimer demande l'id de la variante.`); return; }
      items.push({ cible: "variante", operation: "supprimer", ref: existante.id, avant: retirer(existante, CHAMPS_VARIANTE), apres: null });
      textes.push(`Supprimer la variante « ${existante.nom} »`); supprVar++;
      return;
    }
    const v: any = { ...retirer(existante ?? {}, CHAMPS_VARIANTE) };
    for (const k of CHAMPS_VARIANTE) if (x[k] !== undefined && x[k] !== null) v[k] = x[k];
    const msg = Evenements.validerVariante(v);
    if (msg) { erreurs.push(`${L} : ${msg}`); return; }
    const inconnus = (Array.isArray(v.retire) ? v.retire : []).filter((id: string) => !evs.some((e: any) => e.id === id));
    if (inconnus.length) { erreurs.push(`${L} : retire : événement${inconnus.length > 1 ? "s" : ""} introuvable${inconnus.length > 1 ? "s" : ""} (${inconnus.join(", ")}).`); return; }
    const complet = sansUndef({ nom: String(v.nom).trim(), description: v.description ?? "", retire: v.retire ?? [], hypotheses: v.hypotheses ?? {} });
    if (existante) {
      const ec = ecartChamps(retirer(existante, CHAMPS_VARIANTE), complet, CHAMPS_VARIANTE);
      if (!ec) return;
      items.push({ cible: "variante", operation: "modifier", ref: existante.id, avant: ec.avant, apres: ec.apres });
      textes.push(`Modifier la variante « ${complet.nom} »`);
    } else {
      items.push({ cible: "variante", operation: "creer", apres: complet });
      textes.push(`Ajouter la variante « ${complet.nom} »`); creesVar++;
    }
  });
  if (vars.length + creesVar - supprVar > limiteVar) erreurs.push(`Limite atteinte : ${limiteVar} variantes au plus. Supprime une variante avant d'en ajouter une.`);
  if (a.reglages !== undefined && a.reglages !== null) {
    const r = Evenements.fusionnerReglagesProjection(ctx.reglages, a.reglages, { today: ctx.today, biens: ctx.biens });
    if (r.erreur) erreurs.push(r.erreur);
    else {
      const cles = Object.keys(a.reglages);
      const avant: any = {}, apres: any = {};
      for (const k of cles) {
        if (k === "biens") {
          const cur = isObj(ctx.reglages?.biens) ? ctx.reglages.biens : {}, nouveau = isObj(r.projection.biens) ? r.projection.biens : {};
          const b: any = {}, bAvant: any = {};
          for (const bk of Object.keys(a.reglages.biens ?? {})) {
            if (pareil(cur[bk] ?? null, nouveau[bk] ?? null)) continue;
            b[bk] = nouveau[bk] ?? null; bAvant[bk] = cur[bk] ?? null;
          }
          if (Object.keys(b).length) { apres.biens = b; avant.biens = bAvant; }
        } else if (!pareil(ctx.reglages?.[k] ?? null, r.projection[k] ?? null)) { apres[k] = r.projection[k] ?? null; avant[k] = ctx.reglages?.[k] ?? null; }
      }
      if (typeof a.reglages.source === "string" && !("le" in a.reglages) && r.projection.le !== (ctx.reglages?.le ?? null)) { apres.le = r.projection.le; avant.le = ctx.reglages?.le ?? null; }
      if (Object.keys(apres).length) {
        items.push({ cible: "config", operation: "modifier", avant: { projection: avant }, apres: { projection: apres } });
        textes.push("Réglages de projection : " + Object.keys(apres).filter((k) => k !== "le").join(", "));
      }
    }
  }
  if (!lEv.length && !lVar.length && (a.reglages === undefined || a.reglages === null)) erreurs.push("Rien à proposer : fournis evenements, variantes et/ou reglages.");
  return { items, erreurs, avertissements, textes, defauts };
}

/** Catalogue des types d'événements pour lire_foyer : titre, paramètres connus et valeurs par défaut (repère ou hypothèse dite comme telle). */
export function catalogueEvenements() {
  const E = Evenements.ENTREES ?? {};
  return Object.values(E).map((e: any) => ({ type: e.type, titre: e.titre, parametres: e.parametres, defauts: (e.defauts ?? []).map((d: any) => ({ cle: d.cle, ...(d.repere ? { repere: d.repere } : { valeur: d.valeur }) })) }));
}

/* ---------- lecture pour demarrer_session ---------- */
/** Pour demarrer_session : événements à venir, variantes et plans figés ; null si la lecture échoue (ne lève jamais). */
export async function projectionDeSession(db: any, must: any, auj: string) {
  try {
    const [ev, va, pf] = await Promise.all([
      db.from("foyer_evenements").select("id, type, libelle, date, variante_id").order("date"),
      db.from("foyer_variantes").select("id"),
      db.from("plans_figes").select("id, cree_le, raison").order("cree_le", { ascending: false }).limit(60),
    ]);
    const evenements = ((must("foyer_evenements", ev) as any[]) ?? []).filter((e: any) => !e.variante_id);
    const variantes = (must("foyer_variantes", va) as any[]) ?? [];
    const plans = (must("plans_figes", pf) as any[]) ?? [];
    return {
      evenements: { nombre: evenements.length, a_venir: evenements.filter((e: any) => String(e.date).slice(0, 10) >= auj).slice(0, 3).map((e: any) => ({ date: jour(e.date), type: e.type, libelle: e.libelle })),
        question: evenements.length ? null : QUESTION_EVENEMENTS },
      variantes: variantes.length,
      plans_figes: { nombre: plans.length, dernier: plans[0] ? { id: plans[0].id, cree_le: plans[0].cree_le, raison: plans[0].raison } : null },
      version_modele: Projection.versionModele,
    };
  } catch (e) {
    console.warn("projection (session) :", (e as Error)?.message ?? e);
    return null;
  }
}

/** Probabilité d'atteindre chaque objectif daté (moteur de projection, 2 000 chemins) : Map id → { probabilite, mot } ; null si le calcul échoue (ne lève jamais). */
export async function probabilitesObjectifs(db: any, must: any, auj: string, banque?: () => Promise<any>) {
  try {
    const data = await lireDonneesProjection(db, must, auj, banque);
    /* seules les échéances à venir dans les 25 ans fixent l'horizon : au-delà, l'objectif est hors horizon (probabilité nulle) et ne ralentit pas le calcul des autres */
    const limite = `${+auj.slice(0, 4) + 25}${auj.slice(4)}`;
    const dates = data.objectifs.map((o: any) => o.dateCible).filter((d: any) => typeof d === "string" && d > auj && d <= limite);
    if (!dates.length) return new Map();
    const mois = Math.max(...dates.map((d: string) => (+d.slice(0, 4) - +auj.slice(0, 4)) * 12 + (+d.slice(5, 7) - +auj.slice(5, 7))));
    const horizon = HORIZONS.find((h) => h * 12 >= mois) ?? HORIZONS[HORIZONS.length - 1];
    const M = Projection.preparer(data, { horizon_ans: horizon, perimetre: "foyer", vue: "financier", euros: "constants" });
    const s = Projection.simuler(M, {});
    return new Map<string, any>((s.objectifs ?? []).map((o: any) => [o.id, { probabilite: o.probabilite == null ? null : r2(o.probabilite), mot: o.mot }]));
  } catch (e) {
    console.warn("projection (objectifs) :", (e as Error)?.message ?? e);
    return null;
  }
}

/** Résumé d'une comparaison de deux modèles (mêmes tirages) : écarts par année, probabilité que B fasse mieux, phrase. */
export function resumeComparaison(c: any, nomA: string, nomB: string) {
  const ecarts = c.mois.map((m: string, i: number) => ({ date: m, p10: r0(c.ecarts.p10[i]), p50: r0(c.ecarts.p50[i]), p90: r0(c.ecarts.p90[i]), probabilite_mieux: r2(c.probabilite_mieux[i]) }));
  const h = c.horizon;
  const k = (x: number) => (x < 0 ? "−" : "") + (Math.abs(x) >= 1000 ? Math.round(Math.abs(x) / 1000) + " k€" : Math.round(Math.abs(x)) + " €"); // signe « − » typographique
  const n10 = Math.round(h.probabilite_mieux * 10);
  const sur10 = h.probabilite_mieux >= 0.95 ? "plus de 9" : n10 <= 0 ? "moins de 1" : String(n10); // jamais « 10 cas sur 10 » : rien n'est certain
  const phrase = `À l'horizon, « ${nomB} » fait ${h.mediane_des_ecarts >= 0 ? "mieux" : "moins bien"} que « ${nomA} » de ${k(Math.abs(h.mediane_des_ecarts))} en médiane (de ${k(h.p10)} à ${k(h.p90)}), et fait mieux dans ${sur10} cas sur 10.`;
  return { version_modele: c.version_modele, graine: c.graine, chemins: c.chemins, vue: c.vue, euros: c.euros, a: nomA, b: nomB, ecarts_par_annee: ecarts,
    a_l_horizon: { mediane_des_ecarts: r0(h.mediane_des_ecarts), p10: r0(h.p10), p90: r0(h.p90), probabilite_mieux: r2(h.probabilite_mieux) },
    chaque_chemin_superieur_ou_egal: c.chaque_chemin_superieur_ou_egal[c.chaque_chemin_superieur_ou_egal.length - 1] === true, phrase };
}

/** Capacité d'emprunt dans le temps : points annuels (mensualité max, montant empruntable, apport et budget d'achat P10 / P50 / P90), phrase, jalons. */
export function resumeCapaciteTemps(c: any) {
  if (c.indisponible) return { indisponible: true, avertissements: c.avertissements, mention: c.mention };
  const points = c.mois.map((m: string, i: number) => ({ date: m, mensualite_max: r0(c.mensualite_max[i]), montant_empruntable: r0(c.montant_empruntable[i]),
    apport: { p10: r0(c.apport.p10[i]), p50: r0(c.apport.p50[i]), p90: r0(c.apport.p90[i]) }, budget_achat: { p10: r0(c.budget_achat.p10[i]), p50: r0(c.budget_achat.p50[i]), p90: r0(c.budget_achat.p90[i]) } }));
  return { duree_ans: c.duree_ans, type_frais: c.type_frais, points, taux: c.taux, phrase: c.phrase, point: c.point, jalons: c.jalons, avertissements: c.avertissements, mention: c.mention, version_modele: c.version_modele };
}

export type ProjectionDeps = {
  db: any; wrap: any; must: any; UserError: any; RO: any; RW: any; DEPOT: Record<string, any>;
  deposer: (items: any[], d: { source: string; justification?: string; lot?: string }, extra?: Record<string, unknown>) => Promise<any>;
  today: () => string;
  /** Chargeur de { comptes, mois } de la banque connectée (lignes SQL), null si elle est éteinte ; absent : budget prévu seulement. */
  banque?: () => Promise<any>;
};

export function registerProjection(server: any, h: ProjectionDeps) {
  const { db, wrap, must, UserError, RO, RW, DEPOT, deposer } = h;
  const lire = () => lireDonneesProjection(db, must, h.today(), h.banque);
  const CRISES = Object.keys(Marche?.CRISES ?? {});
  const Perimetre = z.enum(["foyer", "p1", "p2"], { error: "perimetre : foyer, p1 ou p2." }).optional().describe("Périmètre : foyer (défaut), p1 ou p2.");
  const Horizon = z.number({ error: "horizon_ans : 5, 10, 15, 20 ou 25." }).refine((x: number) => HORIZONS.includes(x), { error: "horizon_ans : 5, 10, 15, 20 ou 25." }).optional()
    .describe("Horizon en années : 5, 10 (défaut), 15, 20 ou 25.");
  const Vue = z.enum(["net", "financier", "disponible"], { error: "vue : net, financier ou disponible." }).optional()
    .describe("net (défaut : tout le patrimoine, immobilier moins dettes), financier (placements seuls) ou disponible (épargne disponible).");
  const Euros = z.enum(["constants", "courants"], { error: "euros : constants ou courants." }).optional().describe("constants (défaut : euros d'aujourd'hui) ou courants.");
  const Variante = z.string().regex(UUID_RE, { error: "variante : identifiant d'une variante (lire_foyer)." }).optional().describe("Identifiant d'une variante de lire_foyer ; absent : la situation actuelle.");
  const optionnel = (k: string) => (DEPOT[k] ? DEPOT[k].optional() : z.any().optional());

  /* ---------- decrire_foyer ---------- */
  const Evenement = z.looseObject({
    id: z.string().optional().describe("Identifiant d'un événement existant (lire_foyer) pour le modifier ou le supprimer ; absent : nouvel événement."),
    supprimer: z.boolean().optional().describe("true (avec id) : supprimer l'événement."),
    type: z.string().optional().describe("Type : naissance, creche, scolarite_privee, achat_immobilier, retrait, hausse_revenu, fin_credit, crise, changement_emploi, conge_parental (lire_foyer donne les paramètres de chacun)."),
    personne: z.string().optional().describe("p1, p2 ou foyer."),
    libelle: z.string().optional().describe("Libellé court (1 à 60 caractères), par exemple « Enfant 2 » : jamais de prénom d'enfant."),
    date: z.string().optional().describe("Date de l'événement, AAAA-MM-JJ (réelle ou prévue), entre 1950 et dans 40 ans."),
    fin: z.string().nullable().optional().describe("Date de fin, AAAA-MM-JJ, quand l'événement dure (garde, congé, école) ; null la retire."),
    params: z.record(z.string(), z.unknown()).optional().describe("Paramètres propres au type (lire_foyer, catalogue) ; remplacent ceux de l'événement existant."),
    variante_id: z.string().nullable().optional().describe("Identifiant d'une variante : l'événement n'existe alors que dans cette variante ; null le rend à la situation actuelle."),
  });
  const VarianteDef = z.looseObject({
    id: z.string().optional().describe("Identifiant d'une variante existante (lire_foyer) pour la modifier ou la supprimer ; absent : nouvelle variante."),
    supprimer: z.boolean().optional().describe("true (avec id) : supprimer la variante."),
    nom: z.string().optional().describe("Nom (1 à 40 caractères), par exemple « 2ᵉ enfant »."),
    description: z.string().optional().describe("Description (300 caractères au plus)."),
    retire: z.array(z.string()).optional().describe("Identifiants d'événements de la situation actuelle que la variante retire."),
    hypotheses: z.record(z.string(), z.unknown()).optional().describe("Hypothèses modifiées : epargne_delta_mensuel, reste_capacite, reequilibrage, part_reaffectee_epargne_pct, part_hausse_epargnee_pct, salaire_croissance_reelle_pct."),
  });
  server.registerTool("decrire_foyer", {
    title: "Proposer des événements de vie, des variantes et des réglages de projection",
    description: "Propose les changements prévus du foyer que la projection prend en compte : événements de vie (naissance, garde du jeune enfant, école privée, achat immobilier, retrait ponctuel, hausse de revenu, fin de crédit, crise, changement d'emploi, congé parental), variantes (« 2ᵉ enfant », « achat en 2028 » : la situation actuelle + ses événements − ceux qu'elle retire + des hypothèses modifiées) et réglages de projection (reglages : base_capacite, capacite_mensuelle, reste_capacite, reequilibrage, part_reaffectee_epargne_pct, part_hausse_epargnee_pct, salaire_croissance_reelle_pct, tmi_pct, per_versements_deduits, assurance_pct, biens). 10 événements et 10 variantes au plus par appel, 100 événements et 10 variantes au total. Les valeurs non fournies prennent des valeurs par défaut sourcées, renvoyées dans valeurs_par_defaut : dis-les. Les types réservés (chômage, séparation, invalidité, retraite, héritage, temps partiel, déménagement) sont refusés. Rien n'est écrit directement : chaque changement est une proposition que l'utilisateur valide dans Boussole › Agent › À valider ; aucune proposition si rien ne change. Lis d'abord lire_foyer.",
    inputSchema: z.strictObject({
      evenements: z.array(Evenement).max(10, { error: "evenements : 10 événements au plus par appel." }).optional().describe("Événements à créer (sans id), modifier (avec id) ou supprimer (id et supprimer: true)."),
      variantes: z.array(VarianteDef).max(10, { error: "variantes : 10 variantes au plus par appel." }).optional().describe("Variantes à créer, modifier ou supprimer."),
      reglages: z.record(z.string(), z.unknown()).optional().describe("Réglages de projection à changer (clé à null : retirer le réglage). biens : { \"bien:<id>\": { prix_achat, date_achat, source, le } }."),
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    const [ev, va, cr, bi, cf] = await Promise.all([
      db.from("foyer_evenements").select("id, variante_id, type, personne, libelle, date, fin, params, source"),
      db.from("foyer_variantes").select("id, nom, description, retire, hypotheses"),
      db.from("credits").select("id"), db.from("biens").select("id"), db.from("config").select("projection").maybeSingle(),
    ]);
    const evenements = (await lireOptionnelle(Promise.resolve(ev), "foyer_evenements", must)).map(evenementEnApp);
    const variantes = (await lireOptionnelle(Promise.resolve(va), "foyer_variantes", must)).map(varianteEnApp);
    const reperes = Reperes.depuisLignes((must("reperes", await db.from("reperes").select("cle, libelle, valeur, unite, date_effet, date_fin, source_titre, source_url, verifie_le")) as any[]) ?? []);
    const r = propositionsFoyer(a, {
      evenements, variantes, credits: (must("credits", cr) as any[]) ?? [], biens: (must("biens", bi) as any[]) ?? [],
      reglages: isObj((must("config", cf) as any)?.projection) ? (must("config", cf) as any).projection : {}, reperes, today: h.today(), source: String(a.source ?? ""),
    });
    if (r.erreurs.length) throw new UserError("Aucune proposition déposée :\n- " + r.erreurs.join("\n- "));
    return deposer(r.items, a, { avertissements: r.avertissements, propose: r.textes, valeurs_par_defaut: r.defauts,
      rappel: "Rien n'est appliqué tant que l'utilisateur n'a pas validé ; la projection les prendra en compte ensuite (projeter)." });
  }));

  /* ---------- lire_foyer ---------- */
  server.registerTool("lire_foyer", {
    title: "Événements de vie, variantes et réglages de projection",
    description: "Ce que la projection prend en compte pour le foyer : événements de vie enregistrés (identifiant, type, personne, libellé, date, fin, paramètres, variante), variantes (nom, événements retirés, hypothèses), réglages de projection (config.projection), plans figés (identifiant, date, raison, horizon), le catalogue des types d'événements avec leurs paramètres et valeurs par défaut sourcées, et les limites. À appeler avant de montrer une projection : s'il n'y a aucun événement, demande une fois à l'utilisateur s'il a des changements prévus (question). Lecture seule ; les changements passent par decrire_foyer.",
    inputSchema: z.strictObject({}),
    annotations: RO,
  }, wrap(async () => {
    const [ev, va, pf, cf] = await Promise.all([
      db.from("foyer_evenements").select("id, variante_id, type, personne, libelle, date, fin, params, source").order("date").order("created_at"),
      db.from("foyer_variantes").select("id, nom, description, retire, hypotheses").order("created_at"),
      db.from("plans_figes").select("id, cree_le, raison, horizon_mois").order("cree_le", { ascending: false }).limit(PLANS_FIGES_MAX),
      db.from("config").select("projection").maybeSingle(),
    ]);
    const evenements = (await lireOptionnelle(Promise.resolve(ev), "foyer_evenements", must)).map(evenementEnApp);
    const variantes = (await lireOptionnelle(Promise.resolve(va), "foyer_variantes", must)).map(varianteEnApp);
    const plans = await lireOptionnelle(Promise.resolve(pf), "plans_figes", must);
    const cfg = must("config", cf) as any;
    return {
      date: h.today(), evenements, variantes, reglages: isObj(cfg?.projection) ? cfg.projection : {},
      plans_figes: plans.map((p: any) => ({ id: p.id, cree_le: p.cree_le, raison: p.raison, horizon_mois: p.horizon_mois })),
      question: evenements.filter((e: any) => !e.variante_id).length ? null : QUESTION_EVENEMENTS,
      types: catalogueEvenements(), types_reserves: Evenements.TYPES_RESERVES,
      limites: { evenements: Evenements.LIMITE_EVENEMENTS, variantes: Evenements.LIMITE_VARIANTES, par_appel: Evenements.LIMITE_PAR_APPEL, plans_figes: PLANS_FIGES_MAX },
      champs_reglages: Evenements.CHAMPS_PROJECTION, hypotheses_variante: Evenements.HYPOTHESES_VARIANTE,
      conduite: CONDUITE_PROJECTION,
    };
  }));

  const auj = h.today();
  const DateReelle = (champ: string, plancher?: string) => {
    let t: any = z.string({ error: `${champ} : date AAAA-MM-JJ.` }).refine((x: string) => dateReelle(x), { error: `${champ} : date réelle AAAA-MM-JJ (le 30 février n'existe pas).` });
    if (plancher) t = t.refine((x: string) => x >= plancher, { error: `${champ} : pas avant aujourd'hui (${plancher}).` });
    return t;
  };
  /* ---------- projeter ---------- */
  const OptionsProjection = {
    horizon_ans: Horizon, perimetre: Perimetre, vue: Vue, euros: Euros, net_impots: z.boolean({ error: "net_impots : true ou false." }).optional().describe("true : valeur nette d'impôts si tout était retiré à la date (défaut false)."),
    variante: Variante,
  };
  /** Calcul commun à projeter et figer_projection : données, modèle, simulation à 2 000 chemins. */
  async function calculer(a: any, historique = false) {
    const data = historique ? await lireDonneesProjection(db, must, h.today(), h.banque, { historique: true }) : await lire();
    exigerVariante(data, a.variante, UserError);
    const options = optionsDe(a);
    const M = Projection.preparer(data, options);
    return { data, options, M, sortie: Projection.simuler(M, {}) };
  }
  server.registerTool("projeter", {
    title: "Projeter le patrimoine",
    description: "Projection du patrimoine du foyer par le moteur de Boussole (le même que celui de l'app) : flux du foyer mois par mois, 2 000 trajectoires à graine fixe, toujours net de frais, euros d'aujourd'hui par défaut, événements de vie et variante pris en compte. Renvoie un résumé (jamais les trajectoires) : phrase, bande P10 à P90 par année, couches « patrimoine actuel sans nouveau versement » (existant) et « épargne future », capacité d'épargne retenue et par période, décomposition, garde-fous de vraisemblance, evenements_pris_en_compte (et question_evenements si aucun), objectifs avec leur probabilité, jalons, hypotheses sourcées (valeur, source, date, statut), données à compléter, avertissements, rendement (rendement annualisé des placements, net de frais, avant impôts, comptes courants exclus : attendu de l'allocation actuelle, médiane simulée et bande P10 à P90 sur l'horizon, à quelques anniversaires et année par année, en nominal et en euros d'aujourd'hui), retro (rétro-contrôle : part des valeurs réelles à 12 mois encadrées par les bandes P10 à P90 et P25 à P75 quand la projection est rejouée depuis au moins 24 dates passées ; null avec retro_raison sinon, jamais de chiffre inventé) et conduite. net_impots: true donne la valeur nette d'impôts si tout était retiré à chaque date. crise rejoue une crise historique à la date debut (entre aujourd'hui et la fin de l'horizon). Lecture seule : pour garder la projection et la comparer plus tard à la réalité, utilise figer_projection. Une projection n'est pas une promesse : donne des ordres de grandeur arrondis, toujours avec la bande. Information générale, pas une recommandation.",
    inputSchema: z.strictObject({
      ...OptionsProjection,
      crise: z.object({
        cle: (CRISES.length ? z.enum(CRISES as [string, ...string[]], { error: "crise.cle : " + CRISES.join(", ") + "." }) : z.string()).describe("Crise historique à rejouer : " + CRISES.join(", ") + "."),
        debut: DateReelle("crise.debut", auj).optional().describe("Date de début de la crise, entre aujourd'hui et la fin de l'horizon (défaut : dans un an)."),
      }).optional().describe("Rejoue une crise à une date choisie (un seul chemin, rendements attendus hors de la crise)."),
    }),
    annotations: RO,
  }, wrap(async (a: any) => {
    const { M, sortie } = await calculer(a, true);
    const sortieRes: any = { date: h.today(), ...resumeProjection(sortie) };
    if (a.crise) {
      const c = Projection.crise(M, { cle: a.crise.cle, debut: a.crise.debut });
      if (c.indisponible) throw new UserError("crise.debut : " + (c.avertissements?.[0] ?? "date hors de l'horizon."));
      sortieRes.crise = resumeCrise(c, sortie);
    }
    sortieRes.conduite = CONDUITE_PROJECTION;
    return sortieRes;
  }));

  /* ---------- figer_projection ---------- */
  server.registerTool("figer_projection", {
    title: "Figer une projection pour la comparer plus tard à la réalité",
    description: "Dépose une proposition « plan figé » : la projection d'aujourd'hui (mêmes options que projeter, 2 000 trajectoires à graine fixe) est rangée avec de quoi la rejouer (graine, version du modèle, hypothèses sourcées, événements) et sa série P10 à P90, pour être comparée plus tard à la valeur réelle. Rien n'est écrit sans la validation de l'utilisateur dans Boussole › Agent › À valider (60 plans figés au plus). Source obligatoire ; raison : revue_mensuelle, objectif ou manuel. Le plan n'est pas renvoyé, seulement la proposition déposée. À proposer quand l'utilisateur retient un scénario ou à la revue mensuelle.",
    inputSchema: z.strictObject({
      ...OptionsProjection,
      raison: z.enum(["revue_mensuelle", "objectif", "manuel"], { error: "raison : revue_mensuelle, objectif ou manuel." }).optional().describe("Pourquoi le plan est figé (défaut manuel)."),
      ...DEPOT,
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    if (!String(a.source ?? "").trim()) throw new UserError("source : obligatoire pour figer la projection (par exemple « Ce que tu as dit à Claude »).");
    const plans = await lireOptionnelle(Promise.resolve(db.from("plans_figes").select("id")), "plans_figes", must);
    if (plans.length >= PLANS_FIGES_MAX) throw new UserError(`Limite atteinte : ${PLANS_FIGES_MAX} plans figés au plus. Supprime un plan figé avant d'en ajouter un.`);
    const { data, options, sortie } = await calculer(a);
    const { taille_octets: _t, ...apres } = Projection.figerPlan({ data, options }, sortie, a.raison ?? "manuel");
    /* tailles mesurées comme la base (octet_length(jsonb::text)) : le moteur réduit déjà ce qu'il peut, ce contrôle protège d'un refus à la validation */
    const op = Projection.octetsJsonb(apres.parametres), os = Projection.octetsJsonb(apres.serie), ot = Projection.octetsJsonb(apres);
    if (op > PLAN_PARAMETRES_MAX_OCTETS || os > PLAN_SERIE_MAX_OCTETS || ot > PLAN_MAX_OCTETS)
      throw new UserError(`Le plan figé dépasse la taille acceptée par la base malgré la réduction automatique (paramètres ${op} octets pour ${PLAN_PARAMETRES_MAX_OCTETS} au plus, série ${os} pour ${PLAN_SERIE_MAX_OCTETS}, total ${ot} pour ${PLAN_MAX_OCTETS}) : dis-le à l'utilisateur, rien n'est déposé.`);
    const depot = await deposer([{ cible: "plan_fige", operation: "creer", apres }], { source: String(a.source), justification: a.justification, lot: a.lot });
    return { date: h.today(), version_modele: sortie.version_modele, phrase: sortie.phrase, ...depot, propositions: (depot.propositions ?? []).map(({ apres: _a, ...p }: any) => p),
      rappel: "Rien n'est enregistré tant que l'utilisateur n'a pas validé la proposition dans Boussole › Agent › À valider." };
  }));

  /* ---------- comparer_variantes ---------- */
  server.registerTool("comparer_variantes", {
    title: "Comparer deux variantes",
    description: "Compare, sur les mêmes tirages aléatoires, la situation actuelle (ou une variante) à une variante : écart chemin par chemin, centiles de l'écart par année, probabilité que la variante fasse mieux et phrase prête à dire. Les variantes se lisent avec lire_foyer et se décrivent avec decrire_foyer. Lecture seule. Une comparaison n'est pas une promesse : donne l'écart médian arrondi avec sa bande.",
    inputSchema: z.strictObject({
      variante: z.string().regex(UUID_RE, { error: "variante : identifiant d'une variante (lire_foyer)." }).describe("Variante à comparer."),
      reference: z.string().regex(UUID_RE, { error: "reference : identifiant d'une variante (lire_foyer)." }).optional().describe("Variante de référence ; absente : la situation actuelle."),
      horizon_ans: Horizon, perimetre: Perimetre, vue: Vue, euros: Euros, net_impots: z.boolean({ error: "net_impots : true ou false." }).optional().describe("true : valeurs nettes d'impôts (défaut false)."),
    }),
    annotations: RO,
  }, wrap(async (a: any) => {
    const data = await lire();
    exigerVariante(data, a.variante, UserError);
    exigerVariante(data, a.reference, UserError);
    if (a.reference && a.reference === a.variante) throw new UserError("variante et reference désignent la même variante : choisis-en deux différentes.");
    const base = optionsDe({ ...a, variante: a.reference ?? null });
    const MA = Projection.preparer(data, base), MB = Projection.preparer(data, { ...base, variante: a.variante });
    const c = Projection.comparer(MA, MB, {});
    if (c.erreur) throw new UserError(c.erreur);
    const nomA = a.reference ? cherche(data, a.reference).nom : "situation actuelle", nomB = cherche(data, a.variante).nom;
    return { date: h.today(), ...resumeComparaison(c, nomA, nomB), evenements_a: MA.evenements_pris_en_compte, evenements_b: MB.evenements_pris_en_compte, conduite: CONDUITE_PROJECTION };
  }));

  /* ---------- capacite_emprunt ---------- */
  server.registerTool("capacite_emprunt", {
    title: "Capacité d'emprunt immobilier",
    description: "Capacité d'emprunt immobilier d'aujourd'hui selon les règles du HCSF (35 % d'endettement, durée maximale), calculée par le moteur de Boussole : revenus retenus, charges, mensualité maximale, montant empruntable, apport mobilisable par enveloppe (PER à part, impôts de sortie, matelas exclu), budget d'achat, reste à vivre, sensibilité au taux (±1 point), taux utilisé avec sa source et sa date, avertissements et repères manquants (jamais de valeur inventée). dans_le_temps: true ajoute la capacité année par année (revenus, événements de vie, crédits qui finissent, apport en P10 / P50 / P90). Estimation selon les règles du HCSF : chaque banque décide. Lecture seule ; ne recommande ni établissement ni montant.",
    inputSchema: z.strictObject({
      perimetre: Perimetre,
      duree_ans: z.number({ error: "duree_ans : nombre d'années (1 à 40)." }).min(1, { error: "duree_ans : au moins 1 an." }).max(40, { error: "duree_ans : 40 ans au plus." }).optional().describe("Durée du prêt en années ; absente : le maximum du HCSF."),
      taux_pct: z.number({ error: "taux_pct : taux annuel en %." }).min(0, { error: "taux_pct : 0 ou plus." }).max(25, { error: "taux_pct : 25 % au plus." }).optional().describe("Taux annuel hors assurance, en % ; absent : le taux du jour des repères (avec sa source)."),
      neuf: z.boolean({ error: "neuf : true ou false." }).optional().describe("true : logement neuf (frais d'acquisition réduits)."),
      primo: z.boolean({ error: "primo : true ou false." }).optional().describe("true : primo-accédant (frais d'acquisition du primo-accédant)."),
      dans_le_temps: z.boolean({ error: "dans_le_temps : true ou false." }).optional().describe("true : ajoute la capacité année par année sur horizon_ans."),
      horizon_ans: Horizon, date: DateReelle("date", auj).optional().describe("Avec dans_le_temps : date de l'achat envisagé (point précis), entre aujourd'hui et la fin de l'horizon."),
      scenario: z.enum(["p10", "p50", "p90"], { error: "scenario : p10, p50 ou p90." }).optional().describe("Avec dans_le_temps et date : trajectoire d'apport retenue (défaut p50)."),
    }),
    annotations: RO,
  }, wrap(async (a: any) => {
    if (a.date && a.dans_le_temps !== true) throw new UserError("date : à utiliser avec dans_le_temps: true (point précis de la capacité dans le temps).");
    const data = await lire();
    const opts = sansUndef({ perimetre: a.perimetre ?? "foyer", duree_ans: a.duree_ans, taux_pct: a.taux_pct, neuf: a.neuf, primo: a.primo });
    const capacite = Projection.capaciteEmprunt(data, opts);
    const sortie: any = { date: h.today(), version_modele: Projection.versionModele, ...capacite };
    if (a.dans_le_temps === true) {
      const M = Projection.preparer(data, { horizon_ans: a.horizon_ans ?? 10, perimetre: a.perimetre ?? "foyer", vue: "financier", euros: "constants" });
      const resultat = Projection.simuler(M, {});
      const c = Projection.capaciteDansLeTemps(M, resultat, sansUndef({ duree_ans: a.duree_ans, date: a.date, scenario: a.scenario, neuf: a.neuf, primo: a.primo }));
      if (c.indisponible && a.date && /date de l'achat envisagé/.test(c.avertissements?.[0] ?? "")) throw new UserError("date : " + c.avertissements[0]);
      sortie.dans_le_temps = resumeCapaciteTemps(c);
    }
    sortie.conduite = CONDUITE_IMMO;
    return sortie;
  }));
}
