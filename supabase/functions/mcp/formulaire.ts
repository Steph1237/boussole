// Formulaires dynamiques (docs/superpowers/specs/2026-10-11-saisie-par-agent.md § 1) : le LLM compose un formulaire
// (questions, ordre, formulation, aides) à partir du catalogue des champs (catalogue.gen.ts, généré depuis les sources de
// l'app) ; Claude l'affiche avec la page interactive ui://boussole/formulaire (MCP Apps, formulaire-ui.ts) ; l'utilisateur
// répond ; la page appelle soumettre_formulaire (outil réservé à la page, visibility ["app"]), qui revalide chaque réponse
// contre le catalogue et dépose les propositions en un seul lot (mêmes fonctions qu'update_profile, set_risk_answers et
// set_protection), avec un profil de risque estimé (port fidèle de Risque.evaluer, web/src/risque.js).
// Outils : formulaire (visible du LLM, lecture seule), soumettre_formulaire (page seulement) ; ressource ui://boussole/formulaire ;
// prompt completer_profil. Hôte sans MCP Apps : le résultat texte de formulaire (repli) liste les questions, les valeurs
// permises et les aides ; le LLM les pose en texte et enregistre avec les outils d'écriture habituels.
// Ce module ne dépend pas d'index.ts : utilitaires, calculs et fonctions de dépôt sont passés en paramètre (comme journal.ts).
import { z } from "zod";
import { CATALOGUE, BAREME_RISQUE } from "./catalogue.gen.ts";
import { HTML_FORMULAIRE } from "./formulaire-ui.ts";

export const RESSOURCE = "ui://boussole/formulaire";
export const MIME = "text/html;profile=mcp-app";
export const SOURCE_FORMULAIRE = "Saisi par toi dans le formulaire interactif";
export const MENTION = "Indicateur pédagogique, pas un conseil en investissement.";
export const PROPOSITIONS = "Boussole › Agent › Propositions";
export const QUESTIONS_MAX = 20;
export const SECTIONS = ["foyer", "revenus", "protection", "risque", "budget", "placements", "immobilier", "objectifs"] as const;
const TYPES = ["choix", "multi", "curseur", "montant", "date", "booleen", "texte_court"];
const TEXTE_MAX = 40;

const PAR_CHAMP = new Map<string, any>(CATALOGUE.map((c: any) => [c.champ, c]));
export const CHAMPS: string[] = CATALOGUE.map((c: any) => c.champ);
export const definition = (champ: string) => PAR_CHAMP.get(champ) ?? null;

/* ---------- champs proches (message de refus) ---------- */
function distance(a: string, b: string): number {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
/** Champs du catalogue les plus proches d'un champ inconnu (même préfixe, même fin, puis distance d'édition). */
export function champsProches(champ: string, n = 6): string[] {
  const c = String(champ ?? "").trim().toLowerCase(), tete = c.split(".")[0], queue = c.split(".").pop() ?? "";
  return CHAMPS.map((x) => {
    const l = x.toLowerCase();
    const score = distance(c, l) - (l.split(".")[0] === tete ? 4 : 0) - (l.split(".").pop() === queue ? 4 : 0) - (queue && l.includes(queue) ? 2 : 0);
    return { x, score };
  }).sort((a, b) => a.score - b.score || a.x.localeCompare(b.x)).slice(0, n).map((s) => s.x);
}

/* ---------- validation (mêmes règles que formulaire-logique.js, parité testée) ---------- */
const egal = (a: unknown, b: unknown) => a === b || (a != null && b != null && typeof a !== typeof b && String(a) === String(b));
const option = (def: any, v: unknown) => (def.valeurs ?? []).find((o: any) => egal(o.v, v)) ?? null;
function dateReelle(s: unknown): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
const nombre = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x.replace(",", ".")) : NaN);

/** Valeur brute → { valeur } normalisée (code de l'option, nombre, booléen, texte) ou { erreur } (champ en tête du message). */
export function validerValeur(def: any, brute: unknown): { valeur?: unknown; erreur?: string } {
  const L = def.champ + " : ";
  if (brute === undefined || brute === null || brute === "") return { erreur: L + "réponse vide." };
  switch (def.type) {
    case "choix": {
      const o = option(def, brute);
      return o ? { valeur: o.v } : { erreur: L + "valeur hors catalogue (valeurs possibles : " + def.valeurs.map((x: any) => x.v).join(", ") + ")." };
    }
    case "multi": {
      const l = Array.isArray(brute) ? brute : [brute];
      if (!l.length) return { erreur: L + "au moins une valeur." };
      const os = l.map((x) => option(def, x));
      if (os.some((o) => !o)) return { erreur: L + "valeur hors catalogue (valeurs possibles : " + def.valeurs.map((x: any) => x.v).join(", ") + ")." };
      const vals = os.map((o: any) => o.v);
      if (new Set(vals.map(String)).size !== vals.length) return { erreur: L + "valeur en double." };
      const excl = os.find((o: any) => o.exclusif);
      if (excl && vals.length > 1) return { erreur: L + "« " + excl.label + " » (" + excl.v + ") ne se combine pas avec d'autres réponses." };
      return { valeur: vals };
    }
    case "curseur": {
      const x = nombre(brute), min = def.min ?? 0, max = def.max ?? 100, pas = def.pas > 0 ? def.pas : 1;
      if (!isFinite(x) || x < min || x > max) return { erreur: L + "valeur entre " + min + " et " + max + " attendue." };
      if (Math.abs((x - min) / pas - Math.round((x - min) / pas)) > 1e-9) return { erreur: L + "valeur par pas de " + pas + " attendue." };
      return { valeur: x };
    }
    case "montant": {
      const x = nombre(brute);
      if (!isFinite(x)) return { erreur: L + "montant en chiffres attendu." };
      if (x < (def.min ?? 0)) return { erreur: L + "montant négatif interdit." };
      if (def.max != null && x > def.max) return { erreur: L + "montant de " + def.max + " au plus." };
      return { valeur: x };
    }
    case "date": {
      if (!dateReelle(brute)) return { erreur: L + "date AAAA-MM-JJ réelle attendue." };
      if ((def.min && String(brute) < def.min) || (def.max && String(brute) > def.max)) return { erreur: L + "date hors des bornes." };
      return { valeur: String(brute) };
    }
    case "booleen": {
      const v = brute === "true" ? true : brute === "false" ? false : brute;
      return v === true || v === false ? { valeur: v } : { erreur: L + "true ou false attendu." };
    }
    case "texte_court": {
      const t = typeof brute === "string" ? brute.trim() : "";
      const max = def.max ?? TEXTE_MAX;
      if (!t) return { erreur: L + "texte court attendu." };
      return t.length > max ? { erreur: L + max + " caractères au plus." } : { valeur: t };
    }
  }
  return { erreur: L + "type de champ inconnu." };
}

/** Réponses validées → correctifs par cible : profil { foyer, personnes, autres }, risque { id: valeur }, protection { prevoyance, emprunteur }. */
export function grouperParCible(reponses: Record<string, unknown>) {
  const out: { profil: any; risque: any; protection: any } = { profil: {}, risque: {}, protection: {} };
  for (const [champ, v] of Object.entries(reponses)) {
    const def = definition(champ);
    if (!def) continue;
    const parties = String(def.chemin).split(".");
    let o = out[def.cible as "profil" | "risque" | "protection"];
    parties.slice(0, -1).forEach((p) => { o = o[p] = o[p] ?? {}; });
    o[parties[parties.length - 1]] = v;
  }
  return out;
}

/** Valeur déjà validée dans Boussole (lignes de profiles : foyer, personnes, autres, protection, risque.reponses) pour ce
    champ, si elle est valide pour le catalogue ; undefined sinon. Jamais une valeur déduite d'une autre donnée. */
export function valeurActuelle(def: any, profil: any): unknown {
  if (!profil) return undefined;
  const base = def.cible === "risque" ? profil.risque?.reponses : def.cible === "protection" ? profil.protection : profil;
  let v: any = base;
  for (const p of String(def.chemin).split(".")) v = v && typeof v === "object" && !Array.isArray(v) ? v[p] : undefined;
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return undefined;
  if (def.cible === "protection" && typeof v !== "boolean") return undefined;
  const r = validerValeur(def, v);
  return r.erreur ? undefined : r.valeur;
}

const NOMS_PAR_DEFAUT = ["moi", "conjoint(e)", "p1", "p2"];
/** {nom} dans un libellé → prénom de la personne (personnes.pK / autres.pK), sinon « la personne 1 » / « la personne 2 ». */
export function libelleAvecNom(texte: string, champ: string, profil: any): string {
  const k = /^(?:personnes|autres)\.(p[12])\./.exec(champ)?.[1];
  if (!k || !texte.includes("{nom}")) return texte;
  const nom = String(profil?.personnes?.[k]?.nom ?? "").trim();
  return texte.replaceAll("{nom}", nom && !NOMS_PAR_DEFAUT.includes(nom.toLowerCase()) ? nom : k === "p1" ? "la personne 1" : "la personne 2");
}

/* ---------- aides calculées (données réelles, arrondies ; elles informent, elles ne recommandent jamais) ---------- */
/** Arrondi lisible : à 100 € près sous 20 000 €, à 1 000 € près au-delà. */
export const arrondiEuros = (x: number) => (Math.abs(x) < 20000 ? Math.round(x / 100) * 100 : Math.round(x / 1000) * 1000);
const euros = (x: number) => String(arrondiEuros(x)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " €";
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const moisAnnee = (d: string) => MOIS[Number(d.slice(5, 7)) - 1] + " " + d.slice(0, 4);
export type EntreesAides = { financier: number; baissePlausible: number; pireBaisse: number; partExposee: number | null;
  objectif: { nom: string; cible: number; date: string; mois: number } | null; monetaire: number; depenses: number; profilEquivalent?: string | null };

/** Aides calculées par champ (risque.perte_max, reaction, part_investie, horizon, matelas) à partir des vraies données. */
export function aidesCalculees(e: EntreesAides): Record<string, string> {
  const out: Record<string, string> = {};
  if (e.financier > 0) {
    const b = Math.round(Math.abs(e.baissePlausible)), p = Math.round(Math.abs(e.pireBaisse));
    out["risque.perte_max"] = "Repère : avec tes placements actuels, une baisse d'environ " + b + " % sur un an est plausible ; la pire baisse historique de leurs classes d'actifs, pondérée, atteint environ " + p + " %.";
    out["risque.reaction"] = "Repère : sur tes placements financiers actuels (environ " + euros(e.financier) + "), une baisse de 20 % représenterait environ " + euros(0.2 * e.financier) + ".";
    if (e.partExposee != null) out["risque.part_investie"] = "Repère : aujourd'hui, environ " + Math.round(e.partExposee) + " % de tes placements financiers sont exposés aux marchés (hors fonds euros et monétaire).";
  }
  if (e.objectif) {
    const m = e.objectif.mois, quand = m < 12 ? "environ " + Math.max(1, m) + " mois" : "environ " + Math.round(m / 12) + (Math.round(m / 12) > 1 ? " ans" : " an");
    out["risque.horizon"] = "Repère : ton objectif « " + e.objectif.nom + " » (" + euros(e.objectif.cible) + ", échéance " + moisAnnee(e.objectif.date) + ") représente l'essentiel de ton épargne actuelle ; son échéance est dans " + quand + ".";
  }
  let matelas = "« Hors placements » : l'épargne que tu ne comptes pas investir, disponible tout de suite (livrets, compte courant).";
  if (e.monetaire > 0) matelas += " Boussole compte aujourd'hui environ " + euros(e.monetaire) + " sur livrets et monétaire" +
    (e.depenses > 0 ? ", soit environ " + Math.round(e.monetaire / e.depenses) + " mois de dépenses." : ".");
  out["risque.matelas"] = matelas;
  return out;
}

/* ---------- profil estimé : port fidèle de Risque.evaluer (web/src/risque.js), barème généré ---------- */
type Profil = { id: string; label: string; perteMax: number; description?: string };
const n0 = (v: unknown) => (isFinite(+(v as number)) && v !== null && v !== "" ? +(v as number) : 0);
const somme = <T>(l: T[], f: (x: T) => number) => l.reduce((a, x) => a + f(x), 0);
function lire(q: any, brute: unknown): any {
  if (brute === undefined || brute === null || brute === "") return null;
  const max = Math.max(...q.options.map((o: any) => o.points));
  if (q.type === "multi") {
    const vals = (Array.isArray(brute) ? brute : [brute]).map(String).filter((v) => q.options.some((o: any) => o.v === v));
    if (!vals.length) return null;
    const autres = vals.filter((v) => v !== "aucun");
    const retenues = autres.length ? autres : ["aucun"];
    const total = somme(q.options.filter((o: any) => o.points > 0), (o: any) => o.points);
    const pts = somme(q.options.filter((o: any) => retenues.includes(o.v)), (o: any) => o.points);
    return { valeur: retenues, norm: total ? Math.min(1, pts / total) : 0 };
  }
  if (q.type === "nombre") {
    const x = +(brute as number);
    if (!isFinite(x) || x < 0) return null;
    const o = q.options.filter((op: any) => x >= op.min).pop();
    return { valeur: x, norm: max ? o.points / max : 0, option: o };
  }
  const o = q.options.find((op: any) => op.v === String(brute));
  return o ? { valeur: o.v, norm: max ? o.points / max : 0, option: o } : null;
}
/** Risque.evaluer sans préremplissage (comme l'app après validation : evaluer(reponses, {})). Garde-fous au tutoiement. */
export function evaluerRisque(reponses: Record<string, unknown>, PROFILS: Profil[], bareme: any[] = BAREME_RISQUE) {
  const r = reponses || {};
  const ids = PROFILS.map((p) => p.id), rang = (id: string) => ids.indexOf(id);
  const profilDuScore = (s: number) => ids[Math.min(4, Math.max(0, Math.floor(n0(s) / 20)))];
  const lues: Record<string, any> = {}, manquantes: string[] = [];
  bareme.forEach((q) => { const l = lire(q, r[q.id]); if (l) lues[q.id] = l; else manquantes.push(q.id); });
  const repondues = bareme.filter((q) => lues[q.id]);
  const poidsTotal = somme(repondues, (q: any) => q.poids);
  const details = bareme.map((q) => ({ id: q.id, valeur: lues[q.id] ? lues[q.id].valeur : null, points: lues[q.id] ? lues[q.id].norm : null, poids: q.poids }));
  const base = { complet: manquantes.length === 0, manquantes, details };
  if (!poidsTotal) return { ...base, score: null, profil: null, profilAvantGardeFous: null, gardeFous: [] as any[] };
  const score = Math.round(somme(repondues, (q: any) => q.poids * lues[q.id].norm) / poidsTotal * 100);
  const avant = profilDuScore(score);
  const candidats: { cle: string; plafond: string; texte: string }[] = [];
  if (lues.horizon && lues.horizon.valeur === "lt2")
    candidats.push({ cle: "horizon", plafond: "modere",
      texte: "Tu auras besoin de cet argent dans moins de 2 ans : l'argent nécessaire à court terme n'a pas sa place sur les marchés, qui peuvent baisser juste avant l'échéance. Profil plafonné à Modéré." });
  if (lues.matelas && lues.matelas.valeur === "non")
    candidats.push({ cle: "matelas", plafond: "modere",
      texte: "Tu n'as pas encore 3 mois de dépenses de côté : sans ce matelas, un imprévu peut obliger à vendre au plus bas. Profil plafonné à Modéré tant que le matelas n'est pas constitué." });
  if (lues.perte_max && lues.perte_max.option.perte != null) {
    const acceptee = lues.perte_max.option.perte;
    const ok = PROFILS.filter((p) => p.perteMax <= acceptee);
    const plafond = ok.length ? ok[ok.length - 1] : PROFILS[0];
    candidats.push({ cle: "perte_max", plafond: plafond.id,
      texte: "Tu acceptes une baisse de " + acceptee + " % au plus sur un an : un profil plus exposé peut perdre davantage (jusqu'à " +
        PROFILS[Math.min(4, rang(plafond.id) + 1)].perteMax + " % pour le profil suivant). Profil plafonné à " + plafond.label + ", dont la baisse tolérée est de " + plafond.perteMax + " %." });
  }
  if (lues.connaissances && !lues.connaissances.valeur.some((v: string) => v === "actions" || v === "etf"))
    candidats.push({ cle: "connaissances", plafond: "equilibre",
      texte: "Tu n'as pas indiqué connaître les actions ni les ETF : mieux vaut ne pas dépasser la moitié de son épargne sur des placements dont on ne maîtrise pas le fonctionnement. Profil plafonné à Équilibré." });
  const gardeFous = candidats.filter((g) => rang(g.plafond) < rang(avant));
  const final = gardeFous.reduce((p, g) => (rang(g.plafond) < rang(p) ? g.plafond : p), avant);
  return { ...base, score, profil: final, profilAvantGardeFous: avant, gardeFous };
}

/* ---------- repli texte ---------- */
function valeursEnClair(q: any): string {
  switch (q.type) {
    case "choix": return "Une réponse parmi : " + q.valeurs.map((o: any) => o.v + " = " + o.label).join(" ; ") + ".";
    case "multi": return "Plusieurs réponses parmi : " + q.valeurs.map((o: any) => o.v + " = " + o.label + (o.exclusif ? " (seule)" : "")).join(" ; ") + ".";
    case "curseur": return "Nombre de " + q.min + " à " + q.max + (q.unite ? " " + q.unite : "") + ", par pas de " + (q.pas ?? 1) + ".";
    case "montant": return "Montant en chiffres" + (q.unite ? " (" + q.unite + ")" : "") + ", " + (q.min ?? 0) + " ou plus.";
    case "date": return "Date AAAA-MM-JJ.";
    case "booleen": return "Oui (true) ou non (false).";
    default: return "Texte court (" + (q.max ?? TEXTE_MAX) + " caractères au plus).";
  }
}
/** Texte de repli (hôte sans MCP Apps, et contexte du modèle) : questions numérotées, valeurs permises, aides. */
export function texteRepli(f: any): string {
  const l = [
    "Formulaire « " + f.titre + " » (formulaire_id " + f.formulaire_id + ", " + f.questions.length + " question" + (f.questions.length > 1 ? "s" : "") + ").",
    "Si le formulaire interactif ne s'affiche pas chez l'utilisateur, pose-lui ces questions en texte, puis enregistre seulement ses réponses (jamais une réponse déduite) avec update_profile, set_protection ou set_risk_answers (source : « Ce que tu as dit à Claude »).",
  ];
  if (f.intro) l.push(f.intro);
  f.questions.forEach((q: any, i: number) => {
    l.push("", (i + 1) + ". [" + q.theme + "] " + q.libelle + " (champ " + q.champ + ")", "   " + valeursEnClair(q));
    if (q.aide) l.push("   Aide : " + q.aide);
    if (q.aide_donnees) l.push("   " + q.aide_donnees);
    if (q.valeur_actuelle !== undefined) l.push("   Valeur déjà validée dans Boussole : " + JSON.stringify(q.valeur_actuelle) + ".");
  });
  l.push("", MENTION);
  return l.join("\n");
}

/* ---------- résumé lisible des réponses ---------- */
function libelleValeur(def: any, v: unknown): string {
  if (def.type === "choix") return option(def, v)?.label ?? String(v);
  if (def.type === "multi") return (v as unknown[]).map((x) => option(def, x)?.label ?? String(x)).join(", ");
  if (def.type === "curseur") return def.unite === "ans" ? v + ((v as number) <= 1 ? " an" : " ans") : v + (def.unite ? " " + def.unite : "");
  if (def.type === "montant") return String(v).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " " + (def.unite ?? "€");
  if (def.type === "booleen") return v ? "Oui" : "Non";
  return String(v);
}

/* ---------- prompt completer_profil ---------- */
const CHAMPS_SECTION: Record<string, RegExp | null> = {
  foyer: /^foyer\./, revenus: /^personnes\./, protection: /^protection\./, risque: /^risque\./,
  budget: null, placements: null, immobilier: null, objectifs: null,
};
const IMPORT: Record<string, string> = {
  budget: "Propose-moi de déposer un relevé bancaire (ou un export de mes comptes) dans la conversation. Agrège les opérations en totaux mensuels par catégorie (logement, alimentation, transport, enfants, santé, loisirs, abonnements, impôts, divers), jamais les lignes brutes ; n'ajoute ni salaire ni mensualités de crédit (ils viennent du profil) ; dépose avec update_budget (mode fusionner).",
  placements: "Propose-moi de déposer mes relevés ou exports de courtier (PEA, assurance-vie, PER, compte-titres, livrets, crypto). Tires-en les soldes, les positions (ISIN et quantité pour un titre coté) et les opérations sur titres ; dépose avec upsert_positions (ou record_transaction pour un mouvement).",
  immobilier: "Propose-moi de déposer mes tableaux d'amortissement ou offres de prêt. Tires-en la valeur des biens, le capital restant dû et les mensualités ; dépose avec upsert_biens et upsert_credits ; « aucun bien ni crédit » est une réponse (update_profile, foyer.biensRenseignes = true).",
  objectifs: "Demande-moi mes projets (achat immobilier, matelas, études, retraite…), leur montant et leur échéance ; dépose avec upsert_objectifs.",
};
/** Texte du prompt completer_profil pour une section (au tutoiement, message de l'utilisateur). */
export function texteCompleter(section: string): string {
  const re = CHAMPS_SECTION[section];
  const l = ["Boussole : aide-moi à compléter " + ({ foyer: "mon foyer", revenus: "mes revenus", protection: "ma protection", risque: "mon profil de risque",
    budget: "mon budget", placements: "mes placements", immobilier: "mon immobilier et mes crédits", objectifs: "mes objectifs" } as Record<string, string>)[section] + ".",
  "Commence par demarrer_session (puis etat_du_bilan et list_propositions si besoin) : ne me repose pas une question déjà répondue ni un changement déjà proposé."];
  if (re) {
    const champs = CHAMPS.filter((c) => re.test(c));
    l.push("Utilise l'outil formulaire pour me poser d'un coup les questions manquantes de cette section, avec les champs : " + champs.join(", ") + ". " +
      "Ne réponds jamais à ma place ; les aides informent, elles ne recommandent pas. Si le formulaire ne s'affiche pas, pose les questions en texte, puis dépose mes réponses avec les outils d'écriture.");
  } else {
    l.push(IMPORT[section] + " Retire tout identifiant (IBAN, numéros de compte ou de carte) avant de récapituler ; source : « Relevé … du … que tu as déposé ». " +
      "Récapitule avant de déposer ; pour ce qui reste ambigu et figure au catalogue, utilise l'outil formulaire, sinon pose la question en texte.");
  }
  l.push("Après le dépôt, résume ce qui a été proposé et rappelle-moi de valider dans " + PROPOSITIONS + " (rien n'est appliqué avant).");
  return l.join("\n");
}

export type Calcul = {
  charger: () => Promise<{ donnees: any; objectifs: any[]; risque: any; classes: any }>;
  entreesAides: (d: any, objectifs: any[], classes: any, ref: string) => EntreesAides;
  PROFILS: Profil[];
};
export type Depots = {
  profil: (patch: any) => Promise<any[]>;
  risque: (reponses: any) => Promise<any[]>;
  protection: (patch: any) => Promise<any[]>;
  deposer: (items: any[], d: { source: string; justification?: string; lot?: string }, extra?: Record<string, unknown>) => Promise<any>;
};

export function registerFormulaire(server: any, h: { db: any; must: any; UserError: any; RO: any; RW: any; today: () => string; calcul: Calcul; depots: Depots }) {
  const { UserError, RO, RW, today, calcul, depots } = h;
  /** Résultat MCP avec contenu texte et structuredContent ; erreurs utilisateur en isError lisible. */
  const repondre = (fn: (a: any) => Promise<{ texte: string; donnees: any }>) => async (a: any) => {
    try {
      const r = await fn(a);
      return { content: [{ type: "text" as const, text: r.texte }], structuredContent: r.donnees };
    } catch (e) {
      if (e instanceof UserError) return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
      console.error("formulaire :", e);
      return { content: [{ type: "text" as const, text: "Erreur inattendue : " + (e instanceof Error ? e.message : String(e)) }], isError: true };
    }
  };
  const UI = { ui: { resourceUri: RESSOURCE, visibility: ["model", "app"] }, "ui/resourceUri": RESSOURCE };

  server.registerTool("formulaire", {
    title: "Formulaire interactif",
    description: "Affiche dans la conversation un formulaire interactif Boussole (questions une à une, réponses validées) : utilise-le dès que tu dois poser plusieurs questions à l'utilisateur (formulaire, questionnaire, données manquantes) plutôt que des questions en texte. " +
      "Tu choisis les questions (1 à " + QUESTIONS_MAX + "), leur ordre, et peux reformuler le libellé et l'aide ; les types, valeurs et bornes viennent du catalogue (aucun autre champ accepté). " +
      "Les aides calculées sur les vraies données sont ajoutées par le serveur ; seules les valeurs déjà validées dans Boussole sont préremplies. Les réponses de l'utilisateur sont déposées en propositions (un seul lot) à valider dans " + PROPOSITIONS + " ; tu reçois leur résumé. " +
      "Ne réponds jamais à la place de l'utilisateur. Champs : " + CHAMPS.join(", ") + ".",
    inputSchema: z.strictObject({
      titre: z.string().trim().min(1, { error: "titre : requis." }).max(120, { error: "titre : 120 caractères au plus." }).describe("Titre du formulaire (ex. « Ton profil de risque »)."),
      intro: z.string().trim().max(600, { error: "intro : 600 caractères au plus." }).optional().describe("Une ou deux phrases d'introduction, au tutoiement."),
      questions: z.array(z.strictObject({
        champ: z.string().trim().min(1).max(60).describe("Champ du catalogue (ex. risque.horizon, foyer.tmi, personnes.p1.salaire)."),
        libelle: z.string().trim().min(1).max(300, { error: "libelle : 300 caractères au plus." }).optional().describe("Formulation de la question (sinon celle du catalogue)."),
        aide: z.string().trim().max(600, { error: "aide : 600 caractères au plus." }).optional().describe("Aide courte, qui informe sans recommander (sinon celle du catalogue)."),
      })).min(1, { error: "questions : au moins une." }).max(QUESTIONS_MAX, { error: "questions : " + QUESTIONS_MAX + " au plus." }),
    }),
    annotations: RO,
    _meta: UI,
  }, repondre(async (a: any) => {
    const qs = Array.isArray(a?.questions) ? a.questions : [];
    if (!String(a?.titre ?? "").trim()) throw new UserError("titre : requis.");
    if (!qs.length || qs.length > QUESTIONS_MAX) throw new UserError("questions : 1 à " + QUESTIONS_MAX + ".");
    const inconnus = qs.filter((q: any) => !definition(String(q?.champ ?? "").trim()));
    if (inconnus.length) throw new UserError("Aucun formulaire affiché : champ hors catalogue.\n" + inconnus.map((q: any) =>
      "- « " + q?.champ + " » inconnu ; champs proches : " + champsProches(q?.champ).join(", ")).join("\n") + "\nChamps possibles : " + CHAMPS.join(", ") + ".");
    const vus = new Set<string>();
    for (const q of qs) { const c = String(q.champ).trim(); if (vus.has(c)) throw new UserError("Champ en double : " + c + "."); vus.add(c); }
    const { donnees, objectifs, classes } = await calcul.charger();
    const profil = donnees?.profil ?? {};
    const ref = today();
    const aides = qs.some((q: any) => String(q.champ).startsWith("risque.")) ? aidesCalculees(calcul.entreesAides(donnees, objectifs, classes, ref)) : {};
    const questions = qs.map((q: any) => {
      const def = definition(String(q.champ).trim());
      const { cible: _c, chemin: _p, libelle, aide, ...type } = def;
      const actuelle = valeurActuelle(def, profil);
      return Object.fromEntries(Object.entries({
        ...type,
        libelle: libelleAvecNom(q.libelle ? String(q.libelle) : libelle, def.champ, profil),
        aide: q.aide ? String(q.aide) : aide,
        aide_donnees: aides[def.champ],
        valeur_actuelle: actuelle,
      }).filter(([, v]) => v !== undefined));
    });
    const f = { formulaire_id: crypto.randomUUID(), titre: String(a.titre).trim(), intro: a.intro ? String(a.intro).trim() : undefined, questions, mention: MENTION,
      rappel: "Tes réponses seront proposées dans " + PROPOSITIONS + " : rien n'est appliqué sans ta validation." };
    return { texte: texteRepli(f), donnees: JSON.parse(JSON.stringify(f)) };
  }));

  server.registerTool("soumettre_formulaire", {
    title: "Envoyer les réponses du formulaire",
    description: "Réservé à la page du formulaire interactif (invisible du modèle) : revalide les réponses contre le catalogue et les dépose en propositions, en un seul lot, à valider dans " + PROPOSITIONS + ".",
    inputSchema: z.strictObject({
      formulaire_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, { error: "formulaire_id : UUID attendu." }).optional(),
      reponses: z.record(z.string().max(60), z.unknown()),
    }),
    annotations: RW,
    _meta: { ui: { resourceUri: RESSOURCE, visibility: ["app"] } },
  }, repondre(async (a: any) => {
    const brutes = a?.reponses;
    if (!brutes || typeof brutes !== "object" || Array.isArray(brutes) || !Object.keys(brutes).length) throw new UserError("Aucune réponse à envoyer.");
    if (Object.keys(brutes).length > 60) throw new UserError("Trop de réponses.");
    const id = a.formulaire_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.formulaire_id) ? a.formulaire_id : undefined;
    const erreurs: string[] = [], valides: Record<string, unknown> = {};
    for (const [champ, v] of Object.entries(brutes)) {
      const def = definition(champ);
      if (!def) { erreurs.push("- « " + champ + " » : champ hors catalogue."); continue; }
      const r = validerValeur(def, v);
      if (r.erreur) erreurs.push("- " + r.erreur); else valides[champ] = r.valeur;
    }
    if (erreurs.length) throw new UserError("Aucune proposition déposée : réponses refusées.\n" + erreurs.join("\n"));
    const g = grouperParCible(valides);
    const items = [
      ...(Object.keys(g.profil).length ? await depots.profil(g.profil) : []),
      ...(Object.keys(g.risque).length ? await depots.risque(g.risque) : []),
      ...(Object.keys(g.protection).length ? await depots.protection(g.protection) : []),
    ];
    const res = await depots.deposer(items, { source: SOURCE_FORMULAIRE, ...(id ? { lot: id } : {}) });
    const resume = Object.entries(valides).map(([champ, v]) => { const def = definition(champ); return { champ, libelle: def.libelle, valeur: libelleValeur(def, v) }; });
    let profilEstime: any = null;
    if (Object.keys(g.risque).length) {
      const { donnees, objectifs, risque, classes } = await calcul.charger();
      const actuelles = risque && typeof risque.reponses === "object" && risque.reponses ? risque.reponses : {};
      const ev = evaluerRisque({ ...actuelles, ...g.risque }, calcul.PROFILS);
      const P = (id?: string | null) => calcul.PROFILS.find((p) => p.id === id) || null;
      const eq = P(calcul.entreesAides(donnees, objectifs, classes, today()).profilEquivalent ?? null);
      const pr = P(ev.profil), rg = (x: any) => calcul.PROFILS.indexOf(x);
      const ecart = pr && eq ? rg(eq) - rg(pr) : null;
      profilEstime = {
        score: ev.score, complet: ev.complet, manquantes: ev.manquantes,
        profil: pr ? { id: pr.id, libelle: pr.label, perte_max_toleree_pct: pr.perteMax } : null,
        profil_avant_garde_fous: ev.profilAvantGardeFous, garde_fous: ev.gardeFous,
        profil_equivalent_portefeuille: eq ? { id: eq.id, libelle: eq.label } : null,
        ecart_niveaux: ecart,
        comparaison: !pr ? "Profil non estimé : aucune réponse exploitable." : !eq ? "Aucun placement à comparer pour le moment."
          : ecart === 0 ? "Ton portefeuille se comporte comme un profil " + eq.label + ", conforme à ce profil estimé."
          : "Ton portefeuille se comporte comme un profil " + eq.label + ", alors que ce profil estimé est " + pr.label + " : il prend " + ((ecart as number) > 0 ? "plus" : "moins") + " de risque.",
        base: "Réponses déjà validées dans Boussole complétées par celles du formulaire ; le profil définitif est calculé par Boussole après validation.",
        mention: MENTION,
      };
    }
    const n = (res.propositions ?? []).length;
    const pourModele = [
      "L'utilisateur a envoyé le formulaire Boussole : " + resume.map((r) => r.champ + " = " + r.valeur).join(" ; ") + ".",
      n ? n + " proposition" + (n > 1 ? "s" : "") + " déposée" + (n > 1 ? "s" : "") + " (lot " + res.lot + "), à valider dans " + PROPOSITIONS + "." : String(res.message ?? ""),
      ...(profilEstime?.profil ? ["Profil de risque estimé : " + profilEstime.profil.libelle + " (score " + profilEstime.score + "/100" + (profilEstime.garde_fous.length ? ", plafonné par " + profilEstime.garde_fous.map((x: any) => x.cle).join(", ") : "") + "). " + profilEstime.comparaison] : []),
      "Résume ce qui a été proposé" + (profilEstime ? ", puis le profil estimé, et signale tout écart avec le risque réel du portefeuille" : "") + " ; rappelle que rien n'est appliqué avant validation dans " + PROPOSITIONS + ".",
    ].join("\n");
    const donnees = JSON.parse(JSON.stringify({
      message: res.message, lot: res.lot ?? null, nombre: n, resume, avertissements: res.avertissements ?? [], profil_estime: profilEstime ?? undefined,
      rappel: "Rien n'est appliqué tant que tu n'as pas validé ces propositions dans " + PROPOSITIONS + ".", pour_le_modele: pourModele,
    }));
    return { texte: pourModele, donnees };
  }));

  server.registerResource("formulaire_boussole", RESSOURCE, {
    title: "Formulaire interactif Boussole",
    description: "Page du formulaire interactif (questions une à une, réponses validées, envoi en propositions).",
    mimeType: MIME,
    _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } },
  }, async () => ({ contents: [{ uri: RESSOURCE, mimeType: MIME, text: HTML_FORMULAIRE, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }] }));

  server.registerPrompt("completer_profil", {
    title: "Compléter mon profil",
    description: "Compléter une section du bilan avec l'agent Boussole (formulaire interactif ou import de relevés) : foyer, revenus, protection, risque, budget, placements, immobilier, objectifs.",
    argsSchema: { section: z.enum(SECTIONS, { error: "section : " + SECTIONS.join(", ") + "." }).describe("Section à compléter : " + SECTIONS.join(", ") + ".") },
  }, ({ section }: any) => {
    if (!(SECTIONS as readonly string[]).includes(section)) throw new UserError("section : " + SECTIONS.join(", ") + ".");
    return {
      description: "Compléter la section « " + section + " » avec l'agent Boussole.",
      messages: [{ role: "user" as const, content: { type: "text" as const, text: texteCompleter(section) } }],
    };
  });
}
