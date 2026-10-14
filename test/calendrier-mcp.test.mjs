// DAT1 : portage TypeScript du calendrier (supabase/functions/mcp/calendrier.ts) et ses outils MCP.
// Parité avec le moteur de l'app (web/src/calendrier.js) champ par champ sur les cas de référence et sur la démo ; outils exécutés dans
// un contexte vm (types retirés, zod simulé, base factice), sur le modèle de test/routines-mcp.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import vm from "node:vm";
import { FIXTURE, entreeDe } from "./helpers/calendrier-cas.mjs";

const require = createRequire(import.meta.url);
const path = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
const lire = rel => readFileSync(path(rel), "utf8");
const Cal = require("../web/src/calendrier.js");
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const J = v => JSON.parse(JSON.stringify(v));
const TODAY = "2026-10-14";

class UserErrorT extends Error {}
const fauxZ = () => { const f = new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : f), apply: () => f }); return f; };
function chargerModule(source, globaux = {}) {
  const noms = [...source.matchAll(/^export (?:const|function|async function) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`,
    { z: fauxZ(), RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console, isFinite, isNaN, Infinity, Intl, Error, TextEncoder, crypto: globalThis.crypto, ...globaux });
}
const M = SANS_STRIP ? null : chargerModule(lire("supabase/functions/mcp/calendrier.ts"));

/** Repères de l'app (camelCase) → lignes de la table reperes (snake_case). */
const enLignesReperes = L => L.map(r => ({ cle: r.cle, libelle: r.libelle, valeur: r.valeur, unite: r.unite, date_effet: r.dateEffet, date_fin: r.dateFin ?? null,
  source_titre: r.sourceTitre, source_url: r.sourceUrl, verifie_le: r.verifieLe }));
const enSql = e => ({ ...e, reperes: enLignesReperes(e.reperes) });

test("parité : tous les cas de référence, sortie complète identique (jalons, à compléter, seuils, règles, prochains)", { skip: SANS_STRIP }, () => {
  for (const c of FIXTURE.cas) {
    const e = entreeDe(c);
    assert.deepEqual(J(M.calendrier(enSql(e), c.today)), J(Cal.calendrier(e, c.today)), c.nom);
  }
});
test("parité : le portage accepte aussi des repères déjà en camelCase", { skip: SANS_STRIP }, () => {
  const c = FIXTURE.cas[0], e = entreeDe(c);
  assert.deepEqual(J(M.calendrier(e, c.today)), J(Cal.calendrier(e, c.today)));
});
test("parité : options (horizonAns) et entrées vides", { skip: SANS_STRIP }, () => {
  const c = FIXTURE.cas.find(x => x.nom.startsWith("Horizon de 40 ans")), e = entreeDe(c);
  assert.deepEqual(J(M.calendrier(enSql(e), c.today, { horizonAns: 50 })), J(Cal.calendrier(e, c.today, { horizonAns: 50 })));
  for (const d of [undefined, null, {}]) assert.deepEqual(J(M.calendrier(d, TODAY)), J(Cal.calendrier(d, TODAY)));
  assert.deepEqual(J(M.calendrier({}, "n'importe quoi")), J(Cal.calendrier({}, "n'importe quoi")));
});
test("parité : catalogue REGLES, TYPES, DOCUMENTS, fonctions de date et textes", { skip: SANS_STRIP }, () => {
  assert.deepEqual(J(M.REGLES), J(Cal.REGLES));
  assert.deepEqual(J(M.TYPES), J(Cal.TYPES));
  assert.deepEqual(J(M.DOCUMENTS), J(Cal.DOCUMENTS));
  assert.equal(M.PROCHE_JOURS, Cal.PROCHE_JOURS);
  for (const [a, n] of [["2024-02-29", 5], ["2026-01-31", 1], ["2022-04-15", 84], ["2026-12-31", 0]]) {
    assert.equal(M.ajouterMois(a, n), Cal.ajouterMois(a, n));
    assert.equal(M.ajouterAns(a, n), Cal.ajouterAns(a, n));
  }
  for (const d of ["2026-12-31", "2028-02-28", "2029-02-28"]) assert.equal(M.lendemain(d), Cal.lendemain(d));
  assert.equal(M.joursEntre("2026-10-14", "2027-01-01"), Cal.joursEntre("2026-10-14", "2027-01-01"));
  for (const j of [0, 1, 12, 59, 60, 92, 365, 488, 1100, -1, -92, -5]) assert.equal(M.texteDelai(j), Cal.texteDelai(j));
  for (const n of ["PEA Exemple", "PEA-PME Alex", "Assurance vie Sam", "AV", "Contrat de capitalisation", "PER", "PEL", "PEE", "CTO Sam", "Livret A", "LDDS", "LEP", "Coffre", "Livrets Camille", ""])
    assert.equal(M.typeDeduit(n), Cal.typeDeduit(n), n);
  const pos = [{ envelope: "PEA", owner: "p1" }, { envelope: "PEA", owner: "p2" }];
  assert.equal(M.cleEnveloppe("PEA", "p2", pos), Cal.cleEnveloppe("PEA", "p2", pos));
  assert.equal(M.cleEnveloppe("pea", "p1", pos, { PEA: { titulaire: "p1" } }), Cal.cleEnveloppe("pea", "p1", pos, { PEA: { titulaire: "p1" } }));
});
test("parité : la démo de l'app (foyer fictif) donne la même sortie dans les deux moteurs", { skip: SANS_STRIP }, () => {
  const D = require("../web/src/demo-data.js");
  const entree = { positions: D.positions, config: D.config, profil: D.profil, credits: D.profil.credits, biens: D.profil.biens, reperes: D.savoir.reperes };
  const app = Cal.calendrier(entree, TODAY);
  assert.deepEqual(J(M.calendrier(enSql(entree), TODAY)), J(app));
  assert.ok(app.jalons.length > 0, "la démo montre des échéances");
  assert.deepEqual(app.regles_indisponibles, [], "la démo porte tous les repères nécessaires");
});
test("le portage ne dépend pas d'index.ts ; tutoiement, aucun « conseiller », aucun produit nommé", () => {
  const src = lire("supabase/functions/mcp/calendrier.ts");
  assert.doesNotMatch(src, /from "\.\/index\.ts"/);
  const sans = src.replace(/^\s*\/\/.*$/gm, "");
  assert.equal((sans.match(/(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu) || [])[0], undefined);
  assert.equal((sans.match(/conseill?er|conseillère/i) || [])[0], undefined);
  assert.equal((sans.match(/boursorama|linxea|spirica|fortuneo|credit agricole|bnp|axa|generali|amundi|ishares|vanguard/i) || [])[0], undefined);
});

/* ====================================================================================================================
   Outils MCP : calendrier (lecture), regler_infos_enveloppe, regler_infos_pret, regler_donations, regler_avis_impot (propositions)
   ==================================================================================================================== */
const srcReglages = lire("supabase/functions/mcp/reglages.ts");
const srcRoutines = lire("supabase/functions/mcp/routines.ts");
const srcIndex = lire("supabase/functions/mcp/index.ts");
const must = (t, r) => { if (r.error) throw new UserErrorT(`Erreur base de données (${t}) : ${r.error.message}`); return r.data; };
function fauxDb(reponse) {
  const appels = [];
  const from = table => {
    const r = { table, ops: [] }; appels.push(r);
    const p = new Proxy({}, { get: (_, k) => (k === "then" ? (ok, ko) => Promise.resolve(reponse(r)).then(ok, ko) : (...a) => { r.ops.push([k, ...a]); return p; }) });
    return p;
  };
  return { appels, from, rpc: async (nom, args) => { const r = { rpc: nom, args, ops: [] }; appels.push(r); return reponse(r); } };
}
function serveur(register, db, extra = {}) {
  const outils = {};
  const h = { db, UserError: UserErrorT, RO: { readOnlyHint: true }, RW: { readOnlyHint: false }, must, today: () => TODAY,
    wrap: fn => async a => { try { return { ok: await fn(a) }; } catch (e) { if (e instanceof UserErrorT) return { erreur: e.message }; throw e; } }, ...extra };
  register({ registerTool: (nom, def, handler) => { outils[nom] = { def, handler }; } }, h);
  return outils;
}
const eq = (a, b, m) => assert.deepEqual(J(a), J(b), m);
const SRC = { source: "relevé annuel 2025 (exemple)" };
const REP_SQL = enLignesReperes(FIXTURE.reperes);
const POS = [
  { envelope: "PEA Exemple", owner: "p1", status: "actif" }, { envelope: "PEA Exemple", owner: "p1", status: "actif" },
  { envelope: "Assurance vie Exemple", owner: "p2", status: "actif" }, { envelope: "PEE Exemple", owner: "p1", status: "actif" },
  { envelope: "PEA", owner: "p1", status: "actif" }, { envelope: "PEA", owner: "p2", status: "actif" },
  { envelope: "Ancien CTO", owner: "p1", status: "clôturé" },
];
const CREDIT = "6f1c2a9e-0000-4000-8000-000000000001", BIEN = "6f1c2a9e-0000-4000-8000-000000000002", ETRANGER = "6f1c2a9e-0000-4000-8000-0000000000ff";
const CFG = { enveloppes_infos: {}, prets_infos: {}, donations: [], avis_impot: {} };
function baseCal({ config = CFG, positions = POS, personnes = { p1: { nom: "Alex", naissance: "1980-06-15" }, p2: { nom: "Charlie", naissance: "1975-08-30" } }, credits = [{ id: CREDIT, nom: "Crédit Exemple", owner: "p1", crd: 12000, mensualite: 250 }],
  biens = [{ id: BIEN, nom: "Logement Exemple", crd: 123400, mensualite: 900 }], reperes = REP_SQL, erreur = null } = {}) {
  return fauxDb(r => {
    if (erreur) return { data: null, error: { message: erreur } };
    switch (r.table) {
      case "config": return { data: config, error: null };
      case "positions": return { data: positions, error: null };
      case "profiles": return { data: { personnes }, error: null };
      case "credits": { const id = r.ops.find(o => o[0] === "eq" && o[1] === "id"); return { data: id ? (credits.find(c => c.id === id[2]) ? { id: id[2] } : null) : credits, error: null }; }
      case "biens": { const id = r.ops.find(o => o[0] === "eq" && o[1] === "id"); return { data: id ? (biens.find(c => c.id === id[2]) ? { id: id[2] } : null) : biens, error: null }; }
      case "reperes": return { data: reperes, error: null };
      default: return { data: null, error: null };
    }
  });
}
const depots = [];
const deposer = async (items, d, extra) => { depots.push({ items: J(items), d, extra: J(extra) }); return { items: J(items), extra: J(extra) }; };
const R = SANS_STRIP ? null : chargerModule(srcReglages, { Intl, Map });
const outilsReglages = (db, extra = {}) => serveur(R.registerReglages, db, { DEPOT: {}, deposer, depensesMensuelles: async () => 0, calendrier: { typeDeduit: M.typeDeduit, cleEnveloppe: M.cleEnveloppe }, ...extra });

/* ---------------------------------------------------------------- validations pures (mêmes règles que la migration 0029) */
const ev = (a, actuel) => R.infosEnveloppeDe({ type: "pea", titulaire: "p1", enveloppe: "PEA Exemple", ...SRC, ...a }, TODAY, actuel);
const refus = (r, motif, c) => { assert.ok(r.erreurs.length, c + " : refus attendu"); assert.match(r.erreurs.join("\n"), motif, c); };

test("infosEnveloppeDe : une enveloppe valide, le par défaut, source obligatoire (1 à 300 caractères)", { skip: SANS_STRIP }, () => {
  let r = ev({ date_ouverture: "2021-06-15", versements_cumules: "92 000".replace(" ", "") });
  eq(J(r.erreurs), []);
  eq(J(r.infos), { type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", versements_cumules: 92000, source: SRC.source, le: TODAY });
  assert.equal(r.nom, "PEA Exemple");
  refus(ev({ source: "" }), /source/, "source vide");
  refus(ev({ source: "x".repeat(301) }), /source/, "source trop longue");
  eq(ev({ source: "x".repeat(300), date_ouverture: "2021-06-15" }).erreurs, []);
  assert.equal(ev({ date_ouverture: "2021-06-15", le: "2026-02-12" }).infos.le, "2026-02-12");
});
test("infosEnveloppeDe : types, titulaire, dates réelles, futur, exclusivité, clôture, montants", { skip: SANS_STRIP }, () => {
  refus(ev({ type: "plan_inconnu" }), /type :/, "type");
  refus(ev({ titulaire: "p3" }), /titulaire/, "titulaire");
  refus(ev({ enveloppe: "PEA Exemple|p2" }), /suffixe/, "suffixe qui ne correspond pas au titulaire");
  eq(J(ev({ enveloppe: "PEA|p1", date_ouverture: "2021-06-15" }).erreurs), []);
  assert.equal(ev({ enveloppe: "PEA|p1", date_ouverture: "2021-06-15" }).suffixe, "p1");
  refus(ev({ date_ouverture: "2026-02-30" }), /date_ouverture : date AAAA-MM-JJ réelle/, "date impossible");
  refus(ev({ date_ouverture: "2026-10-15" }), /date_ouverture : pas dans le futur/, "demain");
  eq(J(ev({ date_ouverture: TODAY }).erreurs), []);
  refus(ev({ date_ouverture: "1949-12-31" }), /pas avant le 01\/01\/1950/, "avant 1950");
  refus(ev({ date_ouverture: "2021-06-15", date_ouverture_approx: "2021" }), /ne vont pas ensemble/, "date et approximation");
  refus(ev({ date_ouverture_approx: "2021-13" }), /AAAA ou AAAA-MM/, "mois 13");
  refus(ev({ date_ouverture_approx: "2027" }), /pas dans le futur/, "année future");
  eq(J(ev({ date_ouverture_approx: "2019" }).erreurs), []);
  refus(ev({ date_ouverture: "2021-06-15", date_cloture: "2020-01-01" }), /date_cloture : après la date d'ouverture/, "clôture avant ouverture");
  refus(ev({ versements_cumules: -1 }), /versements_cumules/, "montant négatif");
  refus(ev({ versements_cumules: "beaucoup" }), /versements_cumules/, "montant non numérique");
  refus(ev({ versements_cumules: 1000, versements_avant_70: 2000, type: "assurance_vie" }), /versements_avant_70 : au plus égal/, "avant 70 ans trop grand");
  refus(ev({ beneficiaires_revus_le: "2027-01-01" }), /beneficiaires_revus_le : pas dans le futur/, "revue future");
});
test("infosEnveloppeDe : versements (pee, percol), moins-values (compte-titres), limites", { skip: SANS_STRIP }, () => {
  const v = { le: "2022-03-15", montant: 1000, origine: "versement", disponible_le: "2027-06-01" };
  eq(J(ev({ type: "pee", versements: [v] }).erreurs), []);
  refus(ev({ type: "pea", versements: [v] }), /versements : réservés aux types pee et percol/, "versements sur un PEA");
  refus(ev({ type: "pee", versements: [{ ...v, origine: "prime" }] }), /origine/, "origine inconnue");
  refus(ev({ type: "pee", versements: [{ ...v, disponible_le: "2022-01-01" }] }), /disponible_le avant la date du versement/, "disponible avant");
  refus(ev({ type: "pee", versements: [{ ...v, le: "2026-12-01" }] }), /pas dans le futur/, "versement futur");
  refus(ev({ type: "pee", versements: Array(121).fill(v) }), /120 au plus/, "121 versements");
  const m = { annee: 2017, montant: 1234 };
  eq(J(ev({ type: "compte_titres", moins_values: [m] }).erreurs), []);
  refus(ev({ type: "pea", moins_values: [m] }), /réservées au type compte_titres/, "moins-values sur un PEA");
  refus(ev({ type: "compte_titres", moins_values: [{ ...m, annee: 1999 }] }), /annee, entier de 2000 à 2026/, "année 1999");
  refus(ev({ type: "compte_titres", moins_values: [{ ...m, annee: 2027 }] }), /annee, entier de 2000 à 2026/, "année 2027");
  refus(ev({ type: "compte_titres", moins_values: [{ ...m, montant: 0 }] }), /montant strictement positif/, "montant nul");
  refus(ev({ type: "compte_titres", moins_values: Array(16).fill(m) }), /15 au plus/, "16 moins-values");
});
test("infosEnveloppeDe : fusion avec l'existant (champs repris, null retire, la date exacte remplace l'approchée)", { skip: SANS_STRIP }, () => {
  const actuel = { type: "pea", titulaire: "p1", date_ouverture_approx: "2019", versements_cumules: 50000, source: "ancien", le: "2025-01-01" };
  let r = ev({ date_ouverture: "2019-04-03" }, actuel);
  eq(J(r.infos), { type: "pea", titulaire: "p1", date_ouverture: "2019-04-03", versements_cumules: 50000, source: SRC.source, le: TODAY });
  r = ev({ versements_cumules: null }, actuel);
  eq(J(r.infos), { type: "pea", titulaire: "p1", date_ouverture_approx: "2019", source: SRC.source, le: TODAY });
  r = ev({ date_ouverture_approx: "2020-05" }, { ...actuel, date_ouverture: "2020-05-12", date_ouverture_approx: undefined });
  assert.equal(r.infos.date_ouverture, undefined);
  assert.equal(r.infos.date_ouverture_approx, "2020-05");
});
test("infosPretDe : clé credit:/bien:, dates, durée, taux, au moins une information", { skip: SANS_STRIP }, () => {
  const p = (a, actuel) => R.infosPretDe({ pret: "credit:" + CREDIT, ...SRC, ...a }, TODAY, actuel);
  eq(J(p({ date_signature: "2022-04-15", duree_mois: 84, taux_pct: "3,5", ira_exoneration: true }).infos),
    { date_signature: "2022-04-15", duree_mois: 84, taux_pct: 3.5, ira_exoneration: true, source: SRC.source, le: TODAY });
  refus(p({ pret: "pret:1", date_fin: "2029-04-15" }), /credit:<identifiant> ou bien:<identifiant>/, "clé");
  refus(p({}), /au moins une information/, "rien");
  refus(p({ date_signature: "2022-04-15", date_fin: "2022-04-15" }), /date_fin : après date_signature/, "fin = signature");
  refus(p({ date_signature: "2027-01-01" }), /date_signature : pas dans le futur/, "signature future");
  eq(J(p({ date_fin: "2041-06-30" }).erreurs), [], "date de fin dans le futur : normal");
  refus(p({ duree_mois: 0 }), /duree_mois/, "durée 0");
  refus(p({ duree_mois: 481 }), /duree_mois/, "durée 481");
  refus(p({ taux_pct: 20.5 }), /taux_pct/, "taux > 20");
  refus(p({ assurance_taux_pct: 5.1 }), /assurance_taux_pct/, "assurance > 5");
  refus(p({ ira_exoneration: "oui" }), /ira_exoneration/, "booléen");
  refus(p({ date_fin: "2029-04-15", source: "" }), /source/, "source");
  eq(J(p({ date_fin: "2029-04-15" }, { date_signature: "2022-04-15", duree_mois: 84, source: "x", le: "2025-01-01" }).infos),
    { date_signature: "2022-04-15", date_fin: "2029-04-15", duree_mois: 84, source: SRC.source, le: TODAY });
  refus(p({ date_fin: "2021-01-01" }, { date_signature: "2022-04-15" }), /date_fin : après date_signature/, "fin avant la signature existante");
});
test("donationsDe : liste complète, identifiants générés et uniques, listes fermées, retraits signalés", { skip: SANS_STRIP }, () => {
  const d1 = { date: "2015-07-01", montant: 20000, donateur: "p1", lien: "enfant", beneficiaire: "Enfant 1", nature: "donation" };
  let n = 0;
  const f = (donations, ex = []) => R.donationsDe({ donations, ...SRC }, ex, TODAY, () => "don-n" + (++n));
  let r = f([d1]);
  eq(J(r.erreurs), []);
  eq(J(r.donations), [{ id: "don-n1", ...d1, source: SRC.source, le: TODAY }]);
  const ex = [{ id: "don-1", ...d1, source: "acte (exemple)", le: "2026-02-12" }, { id: "don-2", ...d1, date: "2020-03-01", source: "acte (exemple)", le: "2026-02-12" }];
  r = f([{ id: "don-1", ...d1 }], ex);
  assert.equal(r.donations[0].source, "acte (exemple)", "donation inchangée : source d'origine");
  eq(r.retires.map(x => x.id), ["don-2"]);
  r = f([{ id: "don-1", ...d1, montant: 25000 }], ex);
  assert.equal(r.donations[0].source, SRC.source, "donation modifiée : nouvelle source");
  refus(f([{ ...d1, id: "a" }, { ...d1, id: "a" }]), /en double/, "id en double");
  refus(f([{ ...d1, nature: "cadeau" }]), /nature/, "nature");
  refus(f([{ ...d1, lien: "ami" }]), /lien/, "lien");
  refus(f([{ ...d1, donateur: "p3" }]), /donateur/, "donateur");
  refus(f([{ ...d1, beneficiaire: "x".repeat(41) }]), /beneficiaire/, "libellé trop long");
  refus(f([{ ...d1, montant: 0 }]), /montant strictement positif/, "montant");
  refus(f([{ ...d1, date: "2027-01-01" }]), /pas dans le futur/, "date future");
  refus(f(Array(101).fill(d1).map((x, i) => ({ ...x, id: "i" + i }))), /100 au plus/, "101 donations");
  refus(R.donationsDe({ donations: "x", ...SRC }, [], TODAY, () => "x"), /liste attendue/, "pas une liste");
});
test("avisImpotDe : année des revenus, plafonds par personne, avertissement hors fourchette", { skip: SANS_STRIP }, () => {
  const v = (a) => R.avisImpotDe({ annee_revenus: 2025, ...SRC, ...a }, TODAY);
  let r = v({ rfr: 31000, plafonds_per: { p1: [{ annee: 2023, montant: 1234 }, { annee: 2026, montant: 4321 }] } });
  eq(J(r.erreurs), []);
  eq(J(r.avis), { annee_revenus: 2025, rfr: 31000, plafonds_per: { p1: [{ annee: 2023, montant: 1234 }, { annee: 2026, montant: 4321 }] }, source: SRC.source, le: TODAY });
  eq(r.avertissements, []);
  r = v({ plafonds_per: { p1: [{ annee: 2019, montant: 100 }] } });
  eq(J(r.erreurs), []);
  assert.match(r.avertissements[0], /l'année 2019 sort de 2021 à 2026/);
  refus(v({ annee_revenus: 1999 }), /annee_revenus/, "1999");
  refus(v({ annee_revenus: 2027 }), /annee_revenus/, "2027");
  refus(v({ rfr: -5 }), /rfr/, "rfr");
  refus(v({ plafonds_per: { p3: [] } }), /personne « p3 » inconnue/, "personne");
  refus(v({ plafonds_per: { p1: [{ annee: 2024, montant: 0 }] } }), /montant strictement positif/, "montant");
  refus(v({ plafonds_per: { p1: [{ annee: 2024, montant: 1 }, { annee: 2024, montant: 2 }] } }), /en double/, "année en double");
  refus(v({ plafonds_per: { p1: Array(7).fill(0).map((_, i) => ({ annee: 2020 + i, montant: 1 })) } }), /6 lignes au plus/, "7 lignes");
  refus(v({ source: "" }), /source/, "source");
});

/* ---------------------------------------------------------------- outils de proposition */
test("regler_infos_enveloppe : annotations RW, nom aligné, clé simple, aucune écriture directe, avertissements", { skip: SANS_STRIP }, async () => {
  const db = baseCal();
  const T = outilsReglages(db);
  eq(Object.keys(T).sort(), ["corriger_classe", "regler_avis_impot", "regler_donations", "regler_frais_enveloppe", "regler_infos_enveloppe", "regler_infos_pret", "regler_matelas", "regler_versements"]);
  for (const n of ["regler_infos_enveloppe", "regler_infos_pret", "regler_donations", "regler_avis_impot"]) assert.equal(T[n].def.annotations.readOnlyHint, false, n);
  depots.length = 0;
  const r = await T.regler_infos_enveloppe.handler({ enveloppe: "pea exemple", type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", ...SRC });
  eq(r.ok.items, [{ cible: "config", operation: "modifier", avant: { enveloppes_infos: { "PEA Exemple": null } },
    apres: { enveloppes_infos: { "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", source: SRC.source, le: TODAY } } } }]);
  eq(r.ok.extra.avertissements, []);
  assert.match(r.ok.extra.infos_proposees, /PEA, ouverte le 15\/06\/2021/);
  assert.equal(depots[0].d.source, SRC.source);
  assert.equal(db.appels.filter(a => a.ops.some(o => ["insert", "update", "upsert", "delete"].includes(o[0]))).length, 0, "aucune écriture directe");
});
test("regler_infos_enveloppe : deux titulaires avec le même nom → clé |p2 choisie seule ; aucun changement → aucune proposition", { skip: SANS_STRIP }, async () => {
  const T = outilsReglages(baseCal());
  let r = await T.regler_infos_enveloppe.handler({ enveloppe: "PEA", type: "pea", titulaire: "p2", date_ouverture: "2023-01-10", ...SRC });
  eq(Object.keys(r.ok.items[0].apres.enveloppes_infos), ["PEA|p2"]);
  r = await T.regler_infos_enveloppe.handler({ enveloppe: "PEA", type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", ...SRC });
  eq(Object.keys(r.ok.items[0].apres.enveloppes_infos), ["PEA|p1"]);
  const infos = { type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", source: SRC.source, le: TODAY };
  const T2 = outilsReglages(baseCal({ config: { ...CFG, enveloppes_infos: { "PEA Exemple": infos } } }));
  r = await T2.regler_infos_enveloppe.handler({ enveloppe: "PEA Exemple", type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", ...SRC });
  eq(r.ok.items, [], "identique : rien à proposer");
});
test("regler_infos_enveloppe : une clé « PEA » sans suffixe déjà prise par p1 → la proposition de p2 va sur PEA|p2 et n'écrase pas p1", { skip: SANS_STRIP }, async () => {
  const infosP1 = { type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", source: SRC.source, le: TODAY };
  const T = outilsReglages(baseCal({ config: { ...CFG, enveloppes_infos: { PEA: infosP1 } }, positions: [{ envelope: "PEA", owner: "p2", status: "actif" }] }));
  const r = await T.regler_infos_enveloppe.handler({ enveloppe: "PEA", type: "pea", titulaire: "p2", date_ouverture: "2023-01-10", ...SRC });
  eq(Object.keys(r.ok.items[0].apres.enveloppes_infos), ["PEA|p2"]);
  eq(r.ok.items[0].avant, { enveloppes_infos: { "PEA|p2": null } });
  assert.ok(r.ok.extra.avertissements.some(x => /« PEA » existe déjà pour p1/.test(x) && /« PEA\|p2 »/.test(x)), "avertit qu'une entrée distincte est créée");
  const meme = await T.regler_infos_enveloppe.handler({ enveloppe: "PEA", type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", ...SRC });
  eq(meme.ok.items, [], "p1 retrouve sa clé sans suffixe");
  assert.equal(M.cleEnveloppe("PEA", "p2", [{ envelope: "PEA", owner: "p2" }], { PEA: { titulaire: "p1" } }), Cal.cleEnveloppe("PEA", "p2", [{ envelope: "PEA", owner: "p2" }], { PEA: { titulaire: "p1" } }));
});
test("regler_infos_enveloppe : champs non fournis repris de l'existant ; avertissements (aucune ligne, type déduit différent, titulaire)", { skip: SANS_STRIP }, async () => {
  const actuel = { type: "assurance_vie", titulaire: "p2", date_ouverture: "2018-03-01", source: "ancien", le: "2025-01-01" };
  const T = outilsReglages(baseCal({ config: { ...CFG, enveloppes_infos: { "Assurance vie Exemple": actuel } } }));
  let r = await T.regler_infos_enveloppe.handler({ enveloppe: "assurance vie exemple", type: "assurance_vie", titulaire: "p2", versements_cumules: 40000, ...SRC });
  eq(r.ok.items[0].apres.enveloppes_infos["Assurance vie Exemple"],
    { type: "assurance_vie", titulaire: "p2", date_ouverture: "2018-03-01", versements_cumules: 40000, source: SRC.source, le: TODAY });
  eq(r.ok.items[0].avant.enveloppes_infos["Assurance vie Exemple"], actuel);
  r = await T.regler_infos_enveloppe.handler({ enveloppe: "Coffre inconnu", type: "pel", titulaire: "p1", date_ouverture: "2016-05-10", ...SRC });
  assert.match(r.ok.extra.avertissements[0], /Aucune ligne dans l'enveloppe « Coffre inconnu »/);
  r = await T.regler_infos_enveloppe.handler({ enveloppe: "PEA Exemple", type: "assurance_vie", titulaire: "p1", date_ouverture: "2016-05-10", ...SRC });
  assert.ok(r.ok.extra.avertissements.some(x => /évoque le type pea, tu proposes assurance_vie/.test(x)));
  r = await T.regler_infos_enveloppe.handler({ enveloppe: "Assurance vie Exemple", type: "assurance_vie", titulaire: "p1", date_ouverture: "2016-05-10", ...SRC });
  assert.ok(r.ok.extra.avertissements.some(x => /appartiennent à p2, pas à p1/.test(x)));
  depots.length = 0;
  r = await T.regler_infos_enveloppe.handler({ enveloppe: "PEA Exemple", type: "pea", titulaire: "p1", date_ouverture: "2026-02-30", ...SRC });
  assert.match(r.erreur, /^Aucune proposition déposée :/);
  assert.equal(depots.length, 0, "aucun dépôt après un refus");
});
test("regler_infos_pret : crédit ou bien de l'utilisateur, clé inconnue refusée, fusion avec l'existant", { skip: SANS_STRIP }, async () => {
  const T = outilsReglages(baseCal());
  let r = await T.regler_infos_pret.handler({ pret: "credit:" + CREDIT, date_signature: "2022-04-15", duree_mois: 84, ...SRC });
  eq(r.ok.items[0].apres, { prets_infos: { ["credit:" + CREDIT]: { date_signature: "2022-04-15", duree_mois: 84, source: SRC.source, le: TODAY } } });
  eq(r.ok.items[0].avant, { prets_infos: { ["credit:" + CREDIT]: null } });
  r = await T.regler_infos_pret.handler({ pret: "bien:" + BIEN, date_fin: "2041-06-30", ...SRC });
  eq(Object.keys(r.ok.items[0].apres.prets_infos), ["bien:" + BIEN]);
  r = await T.regler_infos_pret.handler({ pret: "credit:" + ETRANGER, date_fin: "2041-06-30", ...SRC });
  assert.match(r.erreur, /crédit inconnu/);
  r = await T.regler_infos_pret.handler({ pret: "bien:" + CREDIT, date_fin: "2041-06-30", ...SRC });
  assert.match(r.erreur, /bien inconnu/, "un identifiant de crédit n'est pas un bien");
  const T2 = outilsReglages(baseCal({ config: { ...CFG, prets_infos: { ["credit:" + CREDIT]: { date_signature: "2022-04-15", source: "offre", le: "2025-01-01" } } } }));
  r = await T2.regler_infos_pret.handler({ pret: "credit:" + CREDIT, taux_pct: 3.5, ...SRC });
  eq(r.ok.items[0].apres.prets_infos["credit:" + CREDIT], { date_signature: "2022-04-15", taux_pct: 3.5, source: SRC.source, le: TODAY });
});
test("regler_donations : liste complète, identifiants générés, avertissement pour chaque donation retirée", { skip: SANS_STRIP }, async () => {
  const d1 = { id: "don-1", date: "2015-07-01", montant: 20000, donateur: "p1", lien: "enfant", beneficiaire: "Enfant 1", nature: "donation", source: "acte (exemple)", le: "2026-02-12" };
  const d2 = { ...d1, id: "don-2", date: "2020-03-01", nature: "don_argent_790g" };
  const T = outilsReglages(baseCal({ config: { ...CFG, donations: [d1, d2] } }));
  const nouvelle = { date: "2024-05-05", montant: 5000, donateur: "p2", lien: "petit_enfant", beneficiaire: "Petit-enfant 1", nature: "donation" };
  let r = await T.regler_donations.handler({ mode: "remplacer", donations: [{ id: "don-1", ...d1 }, nouvelle], ...SRC });
  assert.equal(r.ok.items[0].apres.donations.length, 2);
  assert.match(r.ok.items[0].apres.donations[1].id, /^don-/);
  eq(J(r.ok.items[0].avant), { donations: [d1, d2] });
  assert.equal(r.ok.extra.avertissements.length, 1);
  assert.match(r.ok.extra.avertissements[0], /Supprimée si l'utilisateur valide : Don familial à Enfant 1 du 01\/03\/2020/);
  r = await T.regler_donations.handler({ mode: "remplacer", donations: [d1, d2], ...SRC });
  eq(r.ok.items, [], "identique : rien à proposer");
  r = await T.regler_donations.handler({ mode: "ajouter", donations: [d1], ...SRC });
  assert.match(r.erreur, /mode : remplacer/);
});
test("regler_avis_impot : avis remplacé en entier, avertissement hors fourchette, aucune écriture directe", { skip: SANS_STRIP }, async () => {
  const db = baseCal();
  const T = outilsReglages(db);
  const r = await T.regler_avis_impot.handler({ annee_revenus: 2025, rfr: 31000, plafonds_per: { p1: [{ annee: 2024, montant: 2100 }, { annee: 2019, montant: 50 }] }, ...SRC });
  eq(r.ok.items[0].avant, { avis_impot: {} });
  assert.equal(r.ok.items[0].apres.avis_impot.annee_revenus, 2025);
  assert.equal(r.ok.extra.avertissements.length, 1);
  assert.match(r.ok.extra.avis_propose, /revenus 2025, revenu fiscal de référence 31\s000 €, plafond épargne retraite p1 : 2024 2\s100 €, 2019 50 €/);
  assert.equal(db.appels.filter(a => a.ops.some(o => ["insert", "update", "upsert", "delete"].includes(o[0]))).length, 0);
  const rr = await T.regler_avis_impot.handler({ annee_revenus: 1990, ...SRC });
  assert.match(rr.erreur, /annee_revenus/);
});

/* ---------------------------------------------------------------- outil calendrier (lecture) */
const outilCalendrier = (db, extra = {}) => serveur(M.registerCalendrier, db, extra).calendrier;
const CFG_FOYER = {
  enveloppes_infos: {
    "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", versements_cumules: 92000, source: SRC.source, le: "2026-02-12" },
    "Assurance vie Exemple": { type: "assurance_vie", titulaire: "p2", date_ouverture: "2018-03-01", source: SRC.source, le: "2026-02-12" },
    "PEE Exemple": { type: "pee", titulaire: "p1", versements: [{ le: "2023-04-20", montant: 800, origine: "versement" }], source: SRC.source, le: "2026-02-12" },
  },
  prets_infos: { ["credit:" + CREDIT]: { date_signature: "2022-04-15", duree_mois: 84, source: "offre de prêt (exemple)", le: "2026-02-12" } },
  donations: [], avis_impot: {},
};
test("calendrier : annotations RO, schéma (horizon 1 à 480), jalons du foyer, à compléter, seuils, sources, conduite", { skip: SANS_STRIP }, async () => {
  const db = baseCal({ config: CFG_FOYER });
  const t = outilCalendrier(db);
  assert.equal(t.def.annotations.readOnlyHint, true);
  const r = (await t.handler({})).ok;
  assert.equal(r.date, TODAY);
  const cles = r.jalons.map(j => j.cle + ":" + j.enveloppe);
  assert.ok(cles.includes("pea_5_ans:PEA Exemple") && cles.includes("av_8_ans:Assurance vie Exemple") && cles.includes("pee_disponible:PEE Exemple") && cles.includes("pret_fin:credit:" + CREDIT));
  assert.ok(r.a_completer.some(a => a.enveloppe === "PEA|p1" && a.champ === "date_ouverture"), "PEA sans informations (deux titulaires) : à compléter, clé |p1");
  assert.ok(!r.a_completer.some(a => a.enveloppe === "Assurance vie Exemple" && a.champ === "naissance"), "naissance de Charlie connue dans le profil");
  assert.equal(r.seuils[0].reste, 58000);
  assert.ok(r.sources.length >= 3 && r.sources.every(s => /^https:\/\//.test(s.url) && s.verifie_le && typeof s.a_verifier === "boolean"));
  eq(J(r.conduite), J(M.CONDUITE_CALENDRIER));
  assert.equal(r.conduite.length, 5);
  assert.match(r.conduite.join(" "), /une seule fois/);
  assert.match(r.conduite.join(" "), /Décris l'effet d'une échéance, jamais une recommandation de produit/);
  const passes = r.jalons.filter(j => j.statut === "passe").map(j => j.enveloppe);
  assert.equal(new Set(passes).size, passes.length, "au plus un jalon passé par enveloppe (le dernier)");
});
test("calendrier : passés exclus par défaut sauf le dernier de chaque enveloppe ; inclure_passes les donne tous", { skip: SANS_STRIP }, async () => {
  const cfg = { ...CFG, enveloppes_infos: { "PEL Exemple": { type: "pel", titulaire: "p1", date_ouverture: "2014-09-01", source: SRC.source, le: "2026-02-12" } } };
  const t = outilCalendrier(baseCal({ config: cfg, positions: [{ envelope: "PEL Exemple", owner: "p1", status: "actif" }] }));
  let r = (await t.handler({})).ok;
  eq(r.jalons.map(j => j.cle), ["pel_12_ans", "pel_15_ans"], "le dernier jalon passé (12 ans) puis ce qui vient");
  r = (await t.handler({ inclure_passes: true })).ok;
  eq(r.jalons.map(j => j.cle), ["pel_2_ans", "pel_4_ans", "pel_10_ans", "pel_12_ans", "pel_15_ans"]);
});
test("calendrier : filtres horizon_mois et enveloppe (casse et accents ignorés), sans résultat → avertissement", { skip: SANS_STRIP }, async () => {
  const t = outilCalendrier(baseCal({ config: CFG_FOYER }));
  const tous = (await t.handler({ inclure_passes: true })).ok;
  const court = (await t.handler({ horizon_mois: 3, inclure_passes: false })).ok;
  assert.ok(court.jalons.filter(j => j.statut !== "passe").every(j => j.jours <= 92 + 31));
  assert.ok(court.jalons.length < tous.jalons.length);
  const une = (await t.handler({ enveloppe: "pea exemple" })).ok;
  assert.ok(une.jalons.length > 0 && une.jalons.every(j => j.enveloppe === "PEA Exemple"));
  assert.ok(une.seuils.every(s => s.enveloppe === "PEA Exemple"));
  const rien = (await t.handler({ enveloppe: "Inconnue" })).ok;
  eq([rien.jalons, rien.a_completer, rien.seuils], [[], [], []]);
  assert.match(rien.avertissements[0], /Aucun résultat pour « Inconnue »/);
});
test("calendrier : sortie bornée — 60 jalons au plus (jalons_omis), effets raccourcis et prochains / dans_3_mois sans détail en mode compact (défaut)", { skip: SANS_STRIP }, async () => {
  const infos = {};
  for (let i = 1; i <= 30; i++) infos["PEL n°" + i] = { type: "pel", titulaire: "p1", date_ouverture: "2019-0" + (1 + i % 9) + "-1" + (i % 10), source: SRC.source, le: "2026-02-12" };
  infos["Assurance vie n°1"] = { type: "assurance_vie", titulaire: "p2", date_ouverture: "2008-03-01", source: SRC.source, le: "2026-02-12" }; // 8 ans passés, parmi les premiers : effet long
  const t = outilCalendrier(baseCal({ config: { ...CFG, enveloppes_infos: infos }, positions: [] }));
  const complet = (await t.handler({ compact: false, inclure_passes: true })).ok;
  assert.ok(complet.jalons_omis > 0 && complet.jalons.length === 60, "60 jalons au plus, le reste compté");
  assert.match(complet.avertissements[0], new RegExp(complet.jalons_omis + " jalons plus lointains non listés \\(60 au plus\\)"));
  assert.ok(complet.jalons.every((j, i, l) => i === 0 || l[i - 1].date <= j.date), "les plus proches dans le temps sont gardés");
  assert.ok(complet.prochains[0].effet && complet.prochains[0].calcul, "compact: false : jalons complets");
  const compact = (await t.handler({ inclure_passes: true })).ok;
  assert.equal(compact.jalons.length, 60);
  assert.equal(compact.jalons_omis, complet.jalons_omis);
  assert.ok(compact.jalons.every(j => j.effet.length <= 160), "effets raccourcis à 160 caractères");
  assert.ok(compact.jalons.some(j => j.effet.endsWith("…")) && compact.jalons.every(j => j.calcul && j.source), "calcul et source gardés");
  eq(Object.keys(compact.prochains[0]).sort(), ["confiance", "date", "delai", "enveloppe", "id", "statut", "titre"]);
  assert.ok(compact.dans_3_mois.every(j => !("effet" in j)));
  assert.ok(JSON.stringify(compact).length < JSON.stringify(complet).length, "plus court que le mode complet");
  // peu de jalons : rien d'omis, pas d'avertissement
  const petit = outilCalendrier(baseCal({ config: CFG_FOYER }));
  const r = (await petit.handler({})).ok;
  assert.equal(r.jalons_omis, 0);
  assert.equal(r.avertissements, undefined);
});
test("abreger : coupe au dernier espace, ajoute …, laisse un texte court intact", { skip: SANS_STRIP }, () => {
  assert.equal(M.abreger("court", 160), "court");
  const long = "Les gains retirés bénéficient chaque année d'un abattement de quatre mille six cents euros pour une personne seule et de neuf mille deux cents euros pour un couple.";
  const a = M.abreger(long, 60);
  assert.ok(a.length <= 60 && a.endsWith("…") && long.startsWith(a.slice(0, -1)), a);
  assert.doesNotMatch(a, /\s…$/, "pas d'espace avant …");
});
test("calendrier : une lecture en échec lève l'erreur de la base (l'outil direct), demarrer_session et la revue retombent sur null sans lever", { skip: SANS_STRIP }, async () => {
  const db = baseCal({ erreur: "panne" });
  const r = await outilCalendrier(db).handler({});
  assert.match(r.erreur, /panne/);
  assert.equal(await M.calendrierDeSession(db, must, TODAY), null);
  assert.equal(await M.echeancesDeRevue(db, must, TODAY), null);
});
test("demarrer_session : calendrier { prochains (3), a_completer { nombre, premiers (3) } } ; demarrer_routine : echeances_3_mois et données à compléter", { skip: SANS_STRIP }, async () => {
  const db = baseCal({ config: CFG_FOYER });
  const s = await M.calendrierDeSession(db, must, TODAY);
  assert.ok(s.prochains.length <= 3 && s.prochains.length > 0);
  eq(Object.keys(s.prochains[0]).sort(), ["confiance", "date", "delai", "enveloppe", "statut", "titre"]);
  assert.equal(typeof s.a_completer.nombre, "number");
  assert.ok(s.a_completer.premiers.length <= 3);
  assert.ok(s.a_completer.nombre >= s.a_completer.premiers.length);
  const rv = await M.echeancesDeRevue(db, must, TODAY);
  assert.ok(Array.isArray(rv.echeances_3_mois));
  assert.ok(rv.echeances_3_mois.every(e => e.statut === "proche" && e.effet));
  assert.ok(rv.echeances_3_mois.length >= 1, "l'abattement de l'assurance-vie tombe dans les 3 mois");
  assert.equal(rv.a_completer.nombre, s.a_completer.nombre);
  // branchement dans index.ts et routines.ts
  const code = srcIndex.replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /const calendrierLu = calendrierDeSession\(db, must, today\(\)\)/);
  assert.match(code, /doublons_probables,\n\s+calendrier,/);
  assert.match(srcRoutines, /const calendrier = await echeancesDeRevue\(db, must, auj\)/);
  assert.match(srcRoutines, /echeances_3_mois: calendrier\?\.echeances_3_mois \?\? null/);
});
test("CONDUITE_REVUE cite les échéances des 3 mois ; INSTRUCTIONS portent la règle de conduite du calendrier, au tutoiement", () => {
  const conduite = srcRoutines.slice(srcRoutines.indexOf("export const CONDUITE_REVUE"), srcRoutines.indexOf("export const CONDUITE_PAUSE"));
  assert.match(conduite, /2 sexies\. Calendrier patrimonial \(echeances_3_mois/);
  assert.match(conduite, /UNE seule donnée manquante/);
  const instr = srcIndex.slice(srcIndex.indexOf("const INSTRUCTIONS"), srcIndex.indexOf("].join(\"\\n\");", srcIndex.indexOf("const INSTRUCTIONS")));
  const bloc = instr.slice(instr.indexOf("Calendrier patrimonial (calendrier"));
  for (const k of ["regler_infos_enveloppe", "regler_infos_pret", "regler_donations", "regler_avis_impot", "demande d'abord le document", "une seule fois", "date_ouverture_approx", "N'invente jamais une date",
    "premier versement", "l'âge qui compte est celui de l'assuré", "jamais une recommandation de produit", "notaire", "une seule donnée manquante"]) assert.ok(bloc.toLowerCase().includes(k.toLowerCase()), "instructions : " + k);
  for (const t of [conduite, bloc]) {
    assert.equal((t.match(/(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu) || [])[0], undefined);
    assert.equal((t.match(/conseill?er|conseillère/i) || [])[0], undefined);
  }
});
test("tropVolumineux : mesure en octets UTF-8 avec 10 % de marge sur la limite de 20 000 octets (avant comme apres)", { skip: SANS_STRIP }, () => {
  const taille = n => ({ apres: { x: "a".repeat(n - JSON.stringify({ x: "" }).length) } });
  assert.equal(Buffer.byteLength(JSON.stringify(taille(18000).apres)), 18000);
  assert.equal(R.tropVolumineux([taille(18000)]), null, "18 000 octets : encore accepté");
  assert.match(R.tropVolumineux([taille(18001)]), /trop volumineuse/);
  // 3 octets par caractère : 6 000 « € » dépassent la marge bien que JSON.stringify(...).length reste sous 18 000
  const euros = { apres: { x: "€".repeat(6000) } };
  assert.ok(JSON.stringify(euros.apres).length < 18000 && Buffer.byteLength(JSON.stringify(euros.apres)) > 18000);
  assert.match(R.tropVolumineux([euros]), /trop volumineuse/);
  assert.match(R.tropVolumineux([{ avant: taille(19000).apres, apres: { x: 1 } }]), /trop volumineuse/);
  assert.equal(R.tropVolumineux([{ avant: null, apres: { x: 1 } }, {}]), null);
});
test("propositions trop volumineuses (apres > 20 000 octets) : message clair avant la table ; listes vides non stockées", { skip: SANS_STRIP }, async () => {
  const T = outilsReglages(baseCal());
  const d = { date: "2015-07-01", montant: 20000, donateur: "p1", lien: "enfant", beneficiaire: "Enfant 1", nature: "donation" };
  const r = await T.regler_donations.handler({ mode: "remplacer", donations: Array(100).fill(d), source: "x".repeat(300) });
  assert.match(r.erreur, /trop volumineuse/);
  const e = ev({ type: "pee", versements: [] });
  assert.equal(e.infos.versements, undefined);
});
