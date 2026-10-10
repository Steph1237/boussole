// Connecteur MCP (supabase/functions/mcp) et page de consentement OAuth.
//
// Contrôles statiques, sans réseau : routes, en-têtes, outils exposés, absence de clé de service.
// Contrôle en ligne (fonction déployée) seulement avec BOUSSOLE_LIVE=1 :
//   BOUSSOLE_LIVE=1 node --test test/mcp.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);

const path = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
const src = readFileSync(path("supabase/functions/mcp/index.ts"), "utf8");
const sansCommentaires = s => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const code = sansCommentaires(src); // sans commentaires
/* Connecteur v6 (AG1) : savoir commun et mémoire de l'agent dans deux modules voisins, enregistrés par index.ts. */
const srcSavoir = readFileSync(path("supabase/functions/mcp/savoir.ts"), "utf8");
const srcMemoire = readFileSync(path("supabase/functions/mcp/memoire.ts"), "utf8");
const srcAll = [src, srcSavoir, srcMemoire].join("\n");
const codeAll = sansCommentaires(srcAll);

const BASE = "https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/mcp";
const PRM_URL = `${BASE}/.well-known/oauth-protected-resource`;
const TOOLS = [
  "get_overview", "get_profile", "update_profile", "upsert_biens", "upsert_credits", "delete_bien", "delete_credit",
  "list_positions", "upsert_positions", "record_transaction", "get_config", "update_config",
  "get_budget", "update_budget", "list_objectifs", "upsert_objectifs", "delete_objectif",
  "get_risk_profile", "annotate_instrument", "etat_du_bilan", "list_propositions", "set_risk_answers", "set_protection",
  "demarrer_onboarding",
  "demarrer_session", "consulter_savoir", "reperes", "memoriser", "se_souvenir", "oublier",
];
/* Outils d'écriture : tous déposent des propositions (source obligatoire), aucun n'écrit dans les tables du bilan. */
const ECRITURE = ["update_profile", "upsert_biens", "upsert_credits", "delete_bien", "delete_credit", "upsert_positions", "record_transaction",
  "update_budget", "upsert_objectifs", "delete_objectif", "set_risk_answers", "set_protection"];
const PROMPTS = ["bilan_complet", "profil_de_risque", "budget", "placements", "revue_mensuelle"];
/** Section du code d'un outil (de son registerTool au suivant). delete_bien / delete_credit partagent une boucle. */
function outil(nom) {
  let i = codeAll.indexOf(`registerTool("${nom}"`);
  if (i < 0 && /^delete_(bien|credit)$/.test(nom)) i = codeAll.indexOf('[["delete_bien", "biens", "bien", "Bien"]');
  assert.ok(i >= 0, `outil ${nom} introuvable`);
  const debut = codeAll.startsWith("registerTool(", i) ? i : codeAll.indexOf("registerTool(", i);
  const j = codeAll.indexOf("registerTool(", debut + 20);
  return codeAll.slice(i, j > 0 ? j : undefined);
}

test("mcp : route des métadonnées de ressource protégée (et variante suffixée)", () => {
  assert.match(code, /basePath\(\s*["']\/mcp["']\s*\)/);
  assert.match(code, /\.get\(\s*["']\/\.well-known\/oauth-protected-resource["']/);
  assert.match(code, /\.get\(\s*["']\/\.well-known\/oauth-protected-resource\/functions\/v1\/mcp["']/);
  assert.ok(code.includes('authorization_servers: ["https://oapcewpqsbbjdlcdeizi.supabase.co/auth/v1"]'));
  assert.ok(code.includes('bearer_methods_supported: ["header"]'));
});

test("mcp : 401 avec WWW-Authenticate pointant vers les métadonnées", () => {
  assert.ok(code.includes("Bearer resource_metadata="), "en-tête WWW-Authenticate absent");
  assert.ok(code.includes("/.well-known/oauth-protected-resource`"), "resource_metadata doit viser la route .well-known");
  assert.match(code, /"WWW-Authenticate"/);
  assert.match(code, /401/);
  assert.match(code, /error:\s*"unauthorized"/);
});

test("mcp : jeton vérifié par le serveur avec un client porteur du JWT (RLS)", () => {
  assert.match(code, /auth\.getUser\(token\)/, "getUser doit recevoir le jeton explicitement");
  assert.match(code, /global:\s*\{\s*headers:\s*\{\s*Authorization:/);
  assert.match(code, /persistSession:\s*false/);
  assert.match(code, /WebStandardStreamableHTTPServerTransport\(\{\s*sessionIdGenerator:\s*undefined/, "transport sans état");
});

test("mcp : tous les outils de la spec sont enregistrés, sans suppression de compte ni export", () => {
  for (const t of TOOLS) assert.match(codeAll, new RegExp(`["']${t}["']`), `outil ${t} absent`);
  assert.doesNotMatch(codeAll, /delete_me|export_all|delete_account|auth\.admin/);
});

test("mcp : budget et objectifs (schémas), get_overview expose le score de santé", () => {
  assert.match(code, /z\.enum\(\["remplacer",\s*"fusionner"\]/, "update_budget : modes remplacer / fusionner");
  assert.match(code, /z\.enum\(\["revenu",\s*"depense",\s*"epargne"\]/);
  assert.match(code, /z\.enum\(\["apport",\s*"matelas",\s*"retraite",\s*"projet"\]/);
  assert.match(code, /min\(-50[^)]*\)\.max\(50/, "rendement borné à -50..50");
  assert.match(code, /sante:\s*scoreSante\(donnees,\s*"foyer"\)/, "get_overview : score de santé");
  assert.match(code, /function affecterDeja\(/);
  assert.match(code, /function effortMensuel\(/);
  assert.match(src, /pas un conseil en investissement/);
});

test("mcp : Diagnostic — annotate_instrument (source obligatoire, RPC), get_risk_profile, get_overview enrichi, consignes", () => {
  const annot = outil("annotate_instrument");
  assert.ok(annot.includes("Renseigne les frais (TER), la zone géographique et la devise d'un fonds détenu, avec la source consultée"), "description française de annotate_instrument");
  assert.match(annot, /source:\s*z\.string\(/, "source : chaîne");
  assert.doesNotMatch(annot.slice(annot.indexOf("source: z.string("), annot.indexOf("annotations:")), /\.optional\(\)/, "source obligatoire (jamais optional)");
  assert.match(annot, /min\(0[^)]*\)\.max\(10/, "TER borné à 0..10 % par an");
  assert.match(annot, /\[A-Za-z\]\{3\}/, "devise : code ISO à 3 lettres");
  assert.match(annot, /db\.rpc\("annoter_instrument",\s*\{\s*p_isin/, "écriture par la RPC security definer (jamais d'update direct)");
  assert.doesNotMatch(code, /from\("instruments"\)\.(update|insert|upsert|delete)/, "aucune écriture directe dans instruments");
  assert.match(annot, /from\("positions"\)\.select\([^)]*\)\.eq\("isin"/, "fonds détenu vérifié avant l'appel");
  const risk = outil("get_risk_profile");
  assert.match(risk, /vueRisque\(profil\.risque/);
  assert.match(code, /profil_risque:\s*vueRisque\(/, "get_overview : profil de risque");
  assert.match(code, /bonnes_pratiques:\s*bonnesPratiques\(/, "get_overview : bonnes pratiques");
  assert.match(code, /instrument:instruments\([^)]*ter, zone, devise, annote_source, annote_le\)/, "positions jointes aux annotations");
  assert.match(src, /annotate_instrument[^"]*source[^"]*obligatoire|Source obligatoire/i, "consignes : source obligatoire");
  assert.ok(src.includes("get_risk_profile"), "consignes : profil de risque");
  assert.doesNotMatch(src, /dans le Pilotage|du Pilotage/, "libellé « Pilotage » remplacé par Bilan › Placements");
});

test("mcp : aucune écriture directe dans les tables personnelles, hors propositions, mémoire de l'agent (et réglages sans montant)", () => {
  const ecritures = [...codeAll.matchAll(/from\(\s*"(\w+)"\s*\)\s*\.(insert|update|upsert|delete)\(/g)].map(m => `${m[1]}.${m[2]}`);
  const tables = new Set(ecritures.map(e => e.split(".")[0]));
  assert.deepEqual([...tables].sort(), ["config", "memoire_agent", "propositions"], `écritures trouvées : ${ecritures.join(", ")}`);
  // memoire_agent : écriture directe (ne touche pas au bilan), seulement dans memoire.ts
  for (const e of ecritures.filter(e => e.startsWith("memoire_agent"))) assert.ok(["memoire_agent.insert", "memoire_agent.update", "memoire_agent.delete"].includes(e), e);
  assert.doesNotMatch(code, /from\("memoire_agent"\)\.(insert|update|upsert|delete)/, "écriture de la mémoire hors memoire.ts");
  assert.deepEqual([...new Set(ecritures.filter(e => e.startsWith("propositions")))], ["propositions.insert"], "propositions : insertion seulement");
  // config : seulement dans update_config, qui n'accepte plus le matelas ni les versements programmés (montants).
  const cfg = outil("update_config");
  const horsCfg = code.replace(cfg, "");
  assert.doesNotMatch(horsCfg, /from\("config"\)\.(insert|update|upsert|delete)/, "écriture de config hors update_config");
  assert.doesNotMatch(cfg, /cushion:\s*CushionPatch|recurring:\s*z\.array/, "update_config : ni matelas ni versements programmés");
  // aucune écriture par des variables de table (ancienne fonction upsertRows) ni RPC d'écriture autre qu'annoter_instrument
  assert.doesNotMatch(codeAll, /from\(\s*table\s*\)\s*\.(insert|update|upsert|delete)\(/);
  assert.deepEqual([...new Set([...codeAll.matchAll(/\.rpc\(\s*"(\w+)"/g)].map(m => m[1]))].sort(), ["annoter_instrument", "chercher_savoir", "marquer_savoir_vu", "noter_connexion"],
    "seules RPC : annoter_instrument, noter_connexion (connexion de l'assistant), chercher_savoir et marquer_savoir_vu (savoir commun)");
  assert.match(code, /Proposition|proposition/);
});

test("mcp : chaque outil d'écriture exige une source (DEPOT) et dépose des propositions", () => {
  const depot = code.slice(code.indexOf("const DEPOT = {"), code.indexOf("};", code.indexOf("const DEPOT = {")));
  const source = depot.slice(depot.indexOf("source:"), depot.indexOf("justification:"));
  assert.match(source, /z\.string\(/); assert.match(source, /min\(1/); assert.match(source, /max\(500/);
  assert.doesNotMatch(source, /\.optional\(\)/, "source jamais optionnelle");
  assert.ok(source.includes("D'où vient ce chiffre : relevé collé, déclaration de l'utilisateur, document…"), "description française de source");
  assert.match(depot, /justification:[^\n]*\n?[^\n]*\.optional\(\)/, "justification optionnelle");
  assert.match(depot, /lot:\s*uuid\.optional\(\)/, "lot optionnel (UUID)");
  for (const nom of ECRITURE) {
    const sec = outil(nom);
    assert.match(sec, /\.\.\.DEPOT/, `${nom} : paramètres source / justification / lot`);
    assert.match(sec, /deposer\(|proposerLignes\(/, `${nom} : dépôt de propositions`);
  }
  assert.match(code, /from\("propositions"\)\.insert\(rows\)/);
  assert.ok(code.includes("proposition${n > 1 ? \"s\" : \"\"} déposée${n > 1 ? \"s\" : \"\"}, ${VALIDER}"), "réponse : N proposition(s) déposée(s)…");
  assert.ok(code.includes('const VALIDER = "à valider dans Boussole › Profil et données › Propositions"'));
  assert.doesNotMatch(outil("annotate_instrument"), /\.\.\.DEPOT|deposer\(/, "annotate_instrument reste direct");
  // set_risk_answers validé contre les questions ; list_propositions et etat_du_bilan en lecture seule
  assert.match(outil("set_risk_answers"), /reponses:\s*RisqueReponses/);
  assert.match(code, /const RisqueReponses = z\.strictObject\(Object\.fromEntries\(QUESTIONS_RISQUE\.map/);
  for (const nom of ["etat_du_bilan", "list_propositions"]) assert.match(outil(nom), /annotations:\s*RO/, `${nom} en lecture seule`);
  assert.match(outil("list_propositions"), /eq\("statut", statut\)/);
});

test("mcp : prompts d'entretien enregistrés (titre, description, conduite)", () => {
  assert.match(code, /server\.registerPrompt\(p\.nom,\s*\{\s*title:\s*p\.titre,\s*description:\s*p\.description\s*\}/);
  for (const n of PROMPTS) assert.match(code, new RegExp(`nom:\\s*"${n}",\\s*titre:\\s*"[^"]+",`), `prompt ${n}`);
  const conduite = code.slice(code.indexOf("const CONDUITE = ["), code.indexOf("const PARCOURS"));
  for (const k of ["etat_du_bilan", "list_propositions", "UNE seule question", "pourquoi", "relevé", "N'invente jamais un chiffre", "récapitule", "source", "lot",
    "Boussole › Profil et données › Propositions", "aucune recommandation de produit", "pas un conseil en investissement"]) assert.ok(conduite.includes(k), `conduite : ${k}`);
  const revue = code.slice(code.indexOf('nom: "revue_mensuelle"'), code.indexOf("].map(", code.indexOf('nom: "revue_mensuelle"')));
  for (const k of ["90 jours", "budget", "get_overview"]) assert.ok(revue.includes(k), `revue_mensuelle : ${k}`);
  for (const k of ["etat_du_bilan", "list_propositions", "set_risk_answers", "set_protection", "Profil et données › Propositions", "source"]) assert.ok(src.slice(src.indexOf("const INSTRUCTIONS"), src.indexOf("const CONDUITE")).includes(k), `instructions : ${k}`);
});

/* ---------- parité de calcul avec web/src (risque.js, marche.js, pratiques.js) ---------- */
// Le bloc pur du connecteur (de « Utilitaires » à « Schémas d'entrée ») est extrait, débarrassé de ses types
// (module.stripTypeScriptTypes, Node ≥ 22.13) et exécuté dans un contexte vm, puis comparé aux modules du site.
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
function portMcp() {
  const debut = src.indexOf("/* Utilitaires"), fin = src.indexOf("/* Schémas d'entrée");
  const bloc = src.slice(src.lastIndexOf("/*", debut - 1), src.lastIndexOf("/*", fin - 1));
  const js = strip(bloc, { mode: "strip" }) + "\n;({ scoreSante, SCORE_MIN_CRITERES, bonnesPratiques, vueRisque, syntheseRisque, allocationReelle, risquePortefeuille, ecarts, classeRisque, classePoche, liquidite, PROFILS, CLASSES_RISQUE, correlation, CLASSES_POCHE });";
  return vm.runInNewContext(js, { Intl, Date, Math, JSON, Number, String, Object, Array, Set, Map, isFinite, isNaN, Infinity, Error, structuredClone, console });
}
const TODAY = "2026-10-10";
const DEMO = require("../web/src/demo-data.js");
const Calc = require("../web/src/calc.js");
const Risque = require("../web/src/risque.js");
const Marche = require("../web/src/marche.js");
const Pratiques = require("../web/src/pratiques.js");
/** Données de la démo à la forme lue par le connecteur (lignes SQL, instrument joint). */
function enLignes(D, extra = {}) {
  const positions = D.positions.map(p => ({ id: p.id, name: p.name, envelope: p.envelope, owner: p.owner, bloc: p.bloc, mode: p.mode, isin: p.isin, qty: p.qty, pru: p.pru,
    value: p.value, value_date: p.valueDate, status: p.status, price_override: null,
    instrument: p.mode === "market" ? { price: p.price, price_date: p.priceDate, ter: p.ter, zone: p.zone, devise: p.devise } : null }));
  const { biens, credits, ...profil } = D.profil;
  return { d: { profil: { ...profil, ...extra.profil }, biens, credits, positions, config: D.config, lignes: D.budget.lignes },
    objectifs: D.objectifs.map(({ dateCible, ...o }) => ({ ...o, date_cible: dateCible })) };
}
const J = v => JSON.parse(JSON.stringify(v));
const proche = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m} : ${a} ≠ ${b}`);

test("parité MCP / risque.js + marche.js + calc.js : tables identiques", { skip: SANS_STRIP }, () => {
  const M = portMcp();
  assert.deepEqual(J(M.PROFILS), J(Risque.PROFILS));
  for (const k of Marche.CLES) {
    assert.equal(M.CLASSES_RISQUE[k].volatilite, Marche.CLASSES[k].volatilite, k);
    assert.equal(M.CLASSES_RISQUE[k].pireBaisse, Marche.CLASSES[k].pireBaisse, k);
    for (const l of Marche.CLES) assert.equal(M.correlation(k, l), Marche.correlation(k, l), `${k}|${l}`);
  }
  assert.deepEqual(Object.keys(M.CLASSES_RISQUE).sort(), [...Marche.CLES].sort());
  for (const poche of [...Object.keys(M.CLASSES_POCHE), "Épargne", "Monde", "Nasdaq 2x", "Fonds euros", "Inconnue"]) assert.equal(M.classePoche(poche), Calc.classe(poche), poche);
  for (const env of ["PER", "Livret A", "Assurance vie Sam", "PEA", "Banque", "SCPI", "CTO"]) assert.equal(M.liquidite(env), Calc.liquidite(env), env);
  const cas = [["Monde", "ETF Nasdaq 2x"], ["Leverage", "X"], ["Monde", "MSCI Emerging Markets"], ["Actions", "Small caps Europe"], ["Crypto", "Bitcoin"], ["Protection", "Or physique"]];
  for (const [bloc, name] of cas) for (const sur of [undefined, { Protection: "or" }, { Leverage: "actions" }]) assert.equal(M.classeRisque({ bloc, name }, sur), Marche.classeRisque({ bloc, name }, sur), `${bloc} / ${name}`);
});

test("parité MCP / risque.js : allocation, écarts et risque réel sur la démo", { skip: SANS_STRIP }, () => {
  const M = portMcp(), { d } = enLignes(DEMO);
  for (const scope of ["foyer", "p1", "p2"]) for (const sur of [undefined, { Obligations: "fonds_euros", Convictions: "or" }]) {
    const a = M.allocationReelle(d.positions, scope, sur), b = Risque.allocationReelle(DEMO.positions, scope, { surcharge: sur });
    for (const g of Object.keys(b.pct)) proche(a.pct[g], b.pct[g], `${scope} ${g}`);
    const ra = M.risquePortefeuille(d.positions, scope, sur), rb = Risque.risquePortefeuille(DEMO.positions, scope, { surcharge: sur });
    proche(ra.volatilite, rb.volatilite, "volatilité"); proche(ra.baissePlausible, rb.baissePlausible, "baisse plausible");
    assert.equal(ra.profilEquivalent, rb.profilEquivalent);
    for (const id of Risque.PROFILS.map(p => p.id)) assert.deepEqual(J(M.ecarts(id, a.pct)).map(e => e.statut), Risque.ecarts(id, b).map(e => e.statut), id);
  }
  const v = M.vueRisque({ profil: "equilibre", score: 52, date: TODAY, reponses: {} }, d, "foyer", undefined, true);
  assert.equal(v.questionnaire_rempli, true); assert.equal(v.profil.libelle, "Équilibré");
  assert.match(v.comparaison, /^Votre portefeuille se comporte comme un profil /);
  assert.equal(M.vueRisque(null, d, "foyer", undefined, false).questionnaire_rempli, false);
});

test("parité MCP / pratiques.js : mêmes critères, points, valeurs et textes sur la démo", { skip: SANS_STRIP }, () => {
  const M = portMcp();
  const scenarios = [
    { risque: null },
    { risque: { profil: "equilibre" }, protection: { prevoyance: true, emprunteur: false }, classes: { Obligations: "fonds_euros" } },
    { risque: { profil: "prudent" }, protection: { prevoyance: true, emprunteur: true } },
    // ETF Monde annoté (frais calculés), titres européens en compte-titres, tranche à 11 % (enveloppes en défaut).
    { risque: { profil: "dynamique" }, D: {
      positions: DEMO.positions.map(p => (p.id === "pea-etf-monde" ? { ...p, ter: 0.2, zone: "Monde", devise: "USD" } : p.id === "cto-asml" ? { ...p, owner: "p1", envelope: "CTO Camille" } : p)),
      profil: { ...DEMO.profil, foyer: { ...DEMO.profil.foyer, tmi: 11 } } } },
  ];
  for (const sc of scenarios) for (const scope of ["foyer", "p1", "p2"]) {
    const extra = { profil: { protection: sc.protection || {} } };
    const D = { ...DEMO, ...(sc.D || {}) };
    const { d, objectifs } = enLignes(D, extra);
    const mcp = M.bonnesPratiques({ d, scope, objectifs, risque: sc.risque, classes: sc.classes, ref: TODAY });
    const web = Pratiques.evaluer({ positions: D.positions, profil: { ...D.profil, ...extra.profil }, config: D.config, budget: D.budget,
      objectifs: D.objectifs, scope, risque: sc.risque, classes: sc.classes, today: TODAY });
    const L = `${JSON.stringify(sc.risque)} / ${scope}`;
    assert.deepEqual(J(mcp.criteres.map(c => c.cle)), web.criteres.map(c => c.cle), L);
    web.criteres.forEach((w, i) => {
      const m = mcp.criteres[i], C = `${L} / ${w.cle}`;
      assert.equal(m.points, w.points, C + " : points"); assert.equal(m.a_completer, w.aCompleter, C);
      assert.equal(m.famille, w.famille, C); assert.equal(m.regle, w.regle, C); assert.equal(m.source, w.source, C);
      if (w.valeur != null) proche(m.valeur, Math.round(w.valeur * 1000) / 1000, C + " : valeur");
      if (!["matelas", "epargne", "endettement", "concentration"].includes(w.cle)) { assert.equal(m.texte, w.texte, C); assert.equal(m.piste, w.piste, C); }
    });
    assert.equal(mcp.total, web.total, L + " : total"); assert.equal(mcp.complet, web.complet, L);
    proche(mcp.couverture, Math.round(web.couverture * 1000) / 1000, L + " : couverture"); assert.equal(mcp.provisoire, web.provisoire, L + " : provisoire");
    assert.deepEqual(J(mcp.familles.map(f => f.total)), web.familles.map(f => f.total), L + " : familles");
    if (sc.D && scope === "foyer") {
      assert.equal(mcp.criteres.find(c => c.cle === "frais").a_completer, false, "frais calculés une fois l'ETF Monde annoté");
      assert.ok(mcp.criteres.find(c => c.cle === "enveloppes").points < 20, "enveloppes : points d'attention");
    }
  }
});

/* Scénarios clairsemés (scores honnêtes) : bilan vide, deux critères calculables, trois critères calculables. */
const Plan = require("../web/src/plan.js");
const sansMatelas = { ...DEMO.config, cushion: null };
const CLAIRSEMES = [
  ["vide", { ...DEMO, positions: [], budget: { lignes: [] }, objectifs: [], config: sansMatelas,
    profil: { ...DEMO.profil, foyer: { adultes: 1 }, personnes: { p1: { nom: "Léa" } }, autres: {}, biens: [], credits: [] } }],
  ["deux critères", { ...DEMO, budget: { lignes: [] }, config: sansMatelas,
    profil: { ...DEMO.profil, foyer: { adultes: 1 }, personnes: { p1: { nom: "Léa", salaire: 3000, salaireUnite: "nm" } }, autres: {}, biens: [], credits: [] } }],
  ["trois critères", { ...DEMO, budget: { lignes: [] }, config: sansMatelas,
    profil: { ...DEMO.profil, foyer: { adultes: 1, age: "a30" }, personnes: { p1: { nom: "Léa", salaire: 3000, salaireUnite: "nm" } }, autres: {}, biens: [], credits: [] } }],
];

test("parité MCP / plan.js : score de santé honnête (total null sous 3 critères, calcules)", { skip: SANS_STRIP }, () => {
  const M = portMcp();
  assert.equal(M.SCORE_MIN_CRITERES, Plan.SCORE_MIN_CRITERES);
  const vus = new Set();
  for (const [nom, D] of [["démo", DEMO], ...CLAIRSEMES]) for (const scope of ["foyer", "p1"]) {
    const { d } = enLignes(D);
    const mcp = M.scoreSante(d, scope);
    const web = Plan.score({ positions: D.positions, profil: D.profil, config: D.config, budget: D.budget, scope, today: new Date(TODAY + "T12:00:00") });
    const L = `${nom} / ${scope}`;
    assert.equal(mcp.total, web.total, L + " : total"); assert.equal(mcp.calcules, web.calcules, L + " : calcules"); assert.equal(mcp.complet, web.complet, L);
    assert.deepEqual(J(mcp.items.map(i => [i.cle, i.points, i.a_completer])), web.items.map(i => [i.cle, i.points, i.aCompleter]), L + " : critères");
    if (mcp.total == null) { assert.ok(mcp.calcules < 3, L); assert.match(mcp.message, /Pas de note globale/); } else assert.equal(mcp.message, undefined, L);
    vus.add(mcp.total == null ? "null" : "note");
  }
  assert.deepEqual([...vus].sort(), ["note", "null"], "les deux cas (note et pas de note) sont couverts");
  const deux = M.scoreSante(enLignes(CLAIRSEMES[1][1]).d, "foyer"), trois = M.scoreSante(enLignes(CLAIRSEMES[2][1]).d, "foyer");
  assert.equal(deux.calcules, 2); assert.equal(deux.total, null);
  assert.equal(trois.calcules, 3); assert.equal(typeof trois.total, "number");
});

test("parité MCP / pratiques.js : bilan clairsemé — total null, couverture et note provisoire", { skip: SANS_STRIP }, () => {
  const M = portMcp();
  const provisoires = [];
  for (const [nom, D] of CLAIRSEMES) {
    const { d, objectifs } = enLignes(D);
    const mcp = M.bonnesPratiques({ d, scope: "foyer", objectifs, risque: null, classes: undefined, ref: TODAY });
    const web = Pratiques.evaluer({ positions: D.positions, profil: D.profil, config: D.config, budget: D.budget, objectifs: D.objectifs, scope: "foyer", risque: null, today: TODAY });
    assert.equal(mcp.total, web.total, nom + " : total"); assert.equal(mcp.provisoire, web.provisoire, nom + " : provisoire");
    proche(mcp.couverture, Math.round(web.couverture * 1000) / 1000, nom + " : couverture");
    provisoires.push(mcp.provisoire);
    if (nom === "vide") { assert.equal(mcp.total, null, "aucune famille notée : pas de note"); assert.equal(mcp.couverture, 0); assert.equal(mcp.provisoire, true); }
  }
  assert.ok(provisoires.includes(true));
});

/* ---------- parité état du bilan : web/src/bilan-etat.js ↔ connecteur ---------- */
function portEtat() {
  const debut = src.indexOf("/* État du bilan (port de web/src/bilan-etat.js"), fin = src.indexOf("/* Schémas d'entrée");
  const bloc = src.slice(src.lastIndexOf("/*", debut - 1), src.lastIndexOf("/*", fin - 1));
  const js = strip(bloc, { mode: "strip" }) + "\n;({ BilanEtat, etatDepuisLignes, QUESTIONS_RISQUE });";
  return vm.runInNewContext(js, { Date, Math, JSON, Number, String, Object, Array, Set, isFinite });
}
const BilanEtatWeb = require("../web/src/bilan-etat.js");

test("parité MCP / bilan-etat.js : mêmes sections, questions, ordre et pourcentage", { skip: SANS_STRIP }, () => {
  const { BilanEtat, etatDepuisLignes } = portEtat();
  assert.deepEqual(J(BilanEtat.RISQUE_IDS), BilanEtatWeb.RISQUE_IDS);
  assert.deepEqual(J(BilanEtat.RISQUE_LIBELLES), BilanEtatWeb.RISQUE_LIBELLES);
  assert.equal(BilanEtat.FRAICHEUR_JOURS, BilanEtatWeb.FRAICHEUR_JOURS);
  const S = { positions: DEMO.positions, profil: DEMO.profil, budget: DEMO.budget, objectifs: DEMO.objectifs, risque: DEMO.risque, propositions: DEMO.propositions };
  const vieux = { ...S, positions: [...DEMO.positions, { name: "Vieux", envelope: "PEL", mode: "manual", value: 1, valueDate: "2025-01-01", status: "actif" }] };
  const scenarios = [
    ["démo", S],
    ["vide", { positions: [], profil: null, budget: null, objectifs: [], risque: null, propositions: [] }],
    ["un adulte, aucun bien", { ...S, profil: { ...DEMO.profil, foyer: { adultes: 1 }, biens: [], credits: [], biensRenseignes: true, protection: { prevoyance: false } } }],
    ["risque partiel, montant ancien", { ...vieux, risque: { reponses: { horizon: "8-15", reaction: "rien", connaissances: [] } } }],
    ["objectifs sans date", { ...S, objectifs: [{ id: "x" }] }],
  ];
  for (const [nom, sc] of scenarios) for (const jour of [TODAY, "2027-03-01"]) {
    assert.deepEqual(J(BilanEtat.etat(sc, jour)), J(BilanEtatWeb.etat(sc, jour)), `${nom} au ${jour}`);
  }
  // Lignes SQL (lecture du connecteur) → même état que la vue du store
  const { d, objectifs } = enLignes(DEMO);
  const lignes = { profil: { ...d.profil, risque: null }, biens: d.biens, credits: d.credits, positions: d.positions, budget: { lignes: d.lignes }, objectifs, propositions: DEMO.propositions };
  for (const jour of [TODAY, "2026-12-31"]) assert.deepEqual(J(BilanEtat.etat(etatDepuisLignes(lignes), jour)), J(BilanEtatWeb.etat(S, jour)), `lignes SQL au ${jour}`);
  const e = BilanEtat.etat(etatDepuisLignes(lignes), TODAY);
  assert.equal(e.propositionsEnAttente, 5, "les propositions en attente de la démo sont comptées");
  // « aucun bien » : foyer.biensRenseignes (écrit par update_profile) vaut réponse
  const aucun = BilanEtat.etat(etatDepuisLignes({ ...lignes, biens: [], credits: [], profil: { ...lignes.profil, foyer: { ...lignes.profil.foyer, biensRenseignes: true } } }), TODAY);
  assert.equal(aucun.sections.find(s => s.cle === "immobilier").statut, "complet");
});

test("parité MCP / risque.js : questions et valeurs permises de set_risk_answers", { skip: SANS_STRIP }, () => {
  const { QUESTIONS_RISQUE } = portEtat();
  assert.deepEqual(J(QUESTIONS_RISQUE.map(q => q.id)), Risque.QUESTIONS.map(q => q.id));
  for (const q of Risque.QUESTIONS) {
    const m = QUESTIONS_RISQUE.find(x => x.id === q.id);
    assert.equal(m.type, q.type, q.id);
    assert.deepEqual(J(m.valeurs), q.options.map(o => o.v), q.id);
  }
});

/* ---------- onboarding : outil demarrer_onboarding, prompt onboarding, feuille de conduite ---------- */
const conduiteOnboarding = () => {
  const bloc = src.slice(src.indexOf("const CONDUITE_ONBOARDING = ["), src.indexOf('].join("\\n");', src.indexOf("const CONDUITE_ONBOARDING = [")));
  return vm.runInNewContext(bloc.replace("const CONDUITE_ONBOARDING = ", "") + "]").join("\n");
};

test("onboarding : outil demarrer_onboarding (description, lecture seule, réponse) et prompt onboarding", () => {
  const sec = outil("demarrer_onboarding");
  assert.ok(sec.includes("À appeler quand l'utilisateur veut commencer ou reprendre son onboarding Boussole : renvoie la conduite de l'entretien, l'état du bilan, les prochaines questions et les propositions en attente."), "description française");
  assert.match(sec, /annotations:\s*RO/, "lecture seule");
  for (const k of ["conduite: CONDUITE_ONBOARDING", "etat: vue", "propositions_en_attente:", "lot_suggere:", "premiere_lecture_disponible:"]) assert.ok(sec.includes(k), `réponse : ${k}`);
  assert.match(sec, /crypto\.randomUUID\(\)/, "lot suggéré : UUID (nouveau lot si rien de récent en attente)");
  assert.match(sec, /scoreSante\(donnees, "foyer"\)\.total != null/, "première lecture : score de santé calculable");
  assert.match(outil("etat_du_bilan"), /lireEtat\(\)\)\.vue/, "etat_du_bilan et demarrer_onboarding partagent la même lecture");
  assert.match(code, /server\.registerPrompt\("onboarding",/);
  const prompt = src.slice(src.indexOf("const PROMPT_ONBOARDING"), src.indexOf("\n", src.indexOf("const PROMPT_ONBOARDING")));
  assert.ok(prompt.includes("demarrer_onboarding") && prompt.includes("conduite"), "le prompt demande d'appeler demarrer_onboarding et de suivre sa conduite");
  const instr = src.slice(src.indexOf("const INSTRUCTIONS"), src.indexOf("const CONDUITE"));
  assert.ok(instr.includes("demarrer_onboarding") && /nouvel utilisateur/.test(instr), "instructions : point d'entrée demarrer_onboarding");
});

test("onboarding : la feuille de conduite porte les règles de l'agent expert", () => {
  const c = conduiteOnboarding();
  const mots = c.split(/\s+/).filter(Boolean).length;
  assert.ok(mots <= 900, `feuille de conduite trop longue : ${mots} mots`);
  assert.ok(c.includes("conseiller en gestion de patrimoine pédagogue, au service de l'utilisateur, sans rien à vendre"), "persona");
  assert.match(c, /^1\. Ouverture$/m); assert.match(c, /^5\. Clôture$/m); assert.match(c, /^4\.1 /m, "règles numérotées");
  assert.match(c, /une question à la fois/i, "une question à la fois");
  assert.match(c, /pourquoi/);
  assert.match(c, /je ne sais pas/);
  assert.match(c, /petit tableau/, "relevés collés : résumé en tableau");
  for (const k of ["TMI", "PEA", "fonds euros", "matelas"]) assert.ok(c.includes(k), `jargon expliqué : ${k}`);
  assert.match(c, /fin de chaque section/, "dépôt à la fin de chaque section");
  assert.ok(c.includes("déclaré par l'utilisateur pendant l'onboarding") && c.includes("lot_suggere"), "source et lot des dépôts");
  assert.ok(c.includes("changements à valider dans Boussole › Profil et données › Propositions"), "rappel après chaque dépôt");
  const credentials = c.split("\n").find(l => /identifiants bancaires/.test(l));
  assert.ok(credentials, "règle sur les identifiants bancaires");
  for (const k of ["Ne demande jamais", "IBAN", "numéros de compte", "carte", "mots de passe", "sécurité sociale", "retirer", "ne les enregistre"]) assert.ok(credentials.includes(k), `identifiants : ${k}`);
  assert.match(c, /N'invente jamais un chiffre/);
  assert.match(c, /Aucune recommandation de produit/); assert.match(c, /aucune promesse de rendement/);
  assert.ok(c.includes("Banque de France — surendettement") && c.includes("Point conseil budget"), "orientation surendettement");
  assert.match(c, /get_overview/); assert.match(c, /2 ou 3 points d'attention/); assert.match(c, /profil_de_risque/);
  assert.match(c, /15 minutes/); assert.match(c, /reprendre/); assert.match(c, /pas un conseil en investissement réglementé/);
});

/* ---------- connexions de l'assistant (voyant de l'onboarding) ---------- */
test("connexions : écriture limitée (5 minutes, en SQL) et jamais bloquante", () => {
  const sql = readFileSync(path("supabase/migrations/0008_connexions.sql"), "utf8");
  assert.match(sql, /create table public\.connexions_assistant/);
  assert.match(sql, /primary key \(user_id, client_id\)/);
  assert.match(sql, /on delete cascade/);
  for (const op of ["select", "insert", "update", "delete"]) assert.match(sql, new RegExp(`"connexions_assistant: ${op}" on public\\.connexions_assistant for ${op} to authenticated`), `politique ${op}`);
  assert.match(sql, /function public\.noter_connexion\(p_client_id text, p_client_nom text default null\)\s*returns void\s*language plpgsql\s*security invoker/);
  assert.match(sql, /on conflict \(user_id, client_id\) do update[\s\S]*where c\.dernier_le < now\(\) - interval '5 minutes'/, "au plus une écriture toutes les 5 minutes");
  assert.match(sql, /'connexions_assistant', \(select coalesce\(jsonb_agg/, "export_all inclut les connexions");
  const noter = code.slice(code.indexOf("async function noterConnexion("), code.indexOf("async function handleMcp("));
  assert.match(noter, /try \{[\s\S]*db\.rpc\("noter_connexion", \{ p_client_id: client\.id, p_client_nom: client\.nom \}\)[\s\S]*\} catch/, "RPC dans un try / catch");
  assert.match(noter, /console\.warn/, "échec journalisé");
  const h = code.slice(code.indexOf("async function handleMcp("));
  const iUser = h.indexOf("auth.getUser(token)"), iNote = h.indexOf("const connexion = noterConnexion(db, token)"), iHandle = h.indexOf("transport.handleRequest(");
  assert.ok(iUser >= 0 && iUser < iNote && iNote < iHandle, "notée après getUser, lancée avant le traitement, sans attente préalable");
  assert.doesNotMatch(h.slice(iNote, iHandle), /await connexion/, "l'appel d'outil n'attend pas l'écriture de connexion");
  assert.match(h, /waitUntil\(connexion\)/);
});

test("connexions : client_id lu dans le jeton (Claude, inconnu, session)", () => {
  const debut = src.indexOf("const CLIENTS_CONNUS"), fin = src.indexOf("/** Note la connexion");
  const js = strip(src.slice(debut, fin).replace("export function", "function"), { mode: "strip" }) + "\n;clientDuJeton";
  const lire = vm.runInNewContext(js, { atob, TextDecoder, Uint8Array, JSON });
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jeton = claims => b64({ alg: "ES256" }) + "." + b64(claims) + ".signature";
  assert.deepEqual(J(lire(jeton({ sub: "u", client_id: "30351516-1e76-4884-8fb2-ae856799a723" }))), { id: "30351516-1e76-4884-8fb2-ae856799a723", nom: "Claude" });
  assert.deepEqual(J(lire(jeton({ sub: "u", client_id: "autre-client", nom: "é" }))), { id: "autre-client", nom: "Assistant" });
  assert.deepEqual(J(lire(jeton({ sub: "u", role: "authenticated" }))), { id: "session", nom: "Assistant" });
  assert.deepEqual(J(lire("pas-un-jeton")), { id: "session", nom: "Assistant" });
});

/* ---------- AG1 : savoir commun et mémoire de l'agent (savoir.ts, memoire.ts, demarrer_session) ---------- */
test("AG1 : demarrer_session — conduite experte, mémoire, nouveautés par marquer_savoir_vu, lecture", () => {
  const o = outil("demarrer_session");
  assert.match(o, /marquer_savoir_vu/);
  assert.match(o, /CONDUITE_EXPERT/);
  assert.match(o, /a_suivre_echus/);
  assert.match(o, /onboarding_conseille/);
  assert.match(o, /annotations:\s*RO/, "lecture seule");
  for (const k of ["memoire:", "memoire_total:", "bilan:", "propositions_en_attente:", "nouveautes_savoir:"]) assert.ok(o.includes(k), `réponse : ${k}`);
  assert.match(o, /client\?\.id \?\? "session"/, "nouveautés propres à chaque client (claim client_id du jeton)");
  const instr = code.slice(code.indexOf("const INSTRUCTIONS"), code.indexOf("].join", code.indexOf("const INSTRUCTIONS")));
  assert.match(instr, /demarrer_session/);
  for (const k of ["reperes", "consulter_savoir", "memoriser", "Mémoire de l'agent"]) assert.ok(instr.includes(k), `instructions : ${k}`);
  // le client du jeton est transmis au serveur (source des souvenirs, nouveautés par client)
  assert.match(code, /buildServer\(\{ db, user: \{[^}]*\}, client: clientDuJeton\(token\) \}\)/);
  assert.match(code, /registerSavoir\(server, h\)/); assert.match(code, /registerMemoire\(server, h\)/);
});
test("AG1 : conduite experte — reperes avant tout chiffre, consulter_savoir, mémoire effaçable, jamais d'identifiants", () => {
  const c = srcAll.slice(srcAll.indexOf("CONDUITE_EXPERT = ["), srcAll.indexOf("].join", srcAll.indexOf("CONDUITE_EXPERT = [")));
  for (const m of [/reperes/, /consulter_savoir/, /memoriser/, /Mémoire de l'agent/, /IBAN/, /mot(s)? de passe/, /pas un conseil en investissement/]) assert.match(c, m);
});
test("AG1 : filtre sensible identique au SQL (IBAN, carte, mots interdits) et ISIN accepté", () => {
  const m = srcAll.match(/export const SENSIBLE = \[([\s\S]*?)\];/);
  assert.ok(m, "SENSIBLE exporté");
  const sql = readFileSync(path("supabase/migrations/0009_savoir_memoire.sql"), "utf8");
  for (const motif of ["[A-Z]{2}[0-9]{2}( ?[A-Z0-9]){11,30}", "([0-9][ -]?){12,18}[0-9]", "mot de passe|password|code secret|code pin|identifiant de connexion"]) {
    assert.ok(sql.includes(motif) && m[1].includes(motif), "motif partagé : " + motif);
  }
  const res = [new RegExp("[A-Z]{2}[0-9]{2}( ?[A-Z0-9]){11,30}"), new RegExp("([0-9][ -]?){12,18}[0-9]"), new RegExp("mot de passe|password|code secret|code pin|identifiant de connexion", "i")];
  const sensible = t => res.some(r => r.test(t));
  assert.equal(sensible("FR76 3000 6000 0112 3456 7890 189"), true);
  assert.equal(sensible("IE00B4L5Y983 et FR0010315770"), false);
  assert.equal(sensible("Achat prévu à 350 000 € en 2028"), false);
});
test("AG1 : consulter_savoir et reperes en lecture seule, memoriser / oublier écrivent dans memoire_agent", () => {
  assert.match(outil("consulter_savoir"), /chercher_savoir/);
  assert.match(outil("consulter_savoir"), /RO/);
  assert.match(outil("reperes"), /from\("reperes"\)|lireReperes\(/);
  assert.match(srcSavoir, /from\("reperes"\)/);
  assert.match(outil("memoriser"), /from\("memoire_agent"\)\.insert/);
  assert.match(outil("oublier"), /from\("memoire_agent"\)\.delete/);
  assert.match(outil("se_souvenir"), /annotations:\s*RO/);
  assert.match(outil("oublier"), /destructiveHint:\s*true/);
});
test("AG1 : demarrer_onboarding renvoie aussi la mémoire, et sa conduite apprend à mémoriser", () => {
  assert.match(outil("demarrer_onboarding"), /memoire:/);
  const c = conduiteOnboarding();
  assert.match(c, /memoriser/); assert.match(c, /jamais d'identifiants/);
  assert.match(code, /new McpServer\(\{ name: "boussole", version: "1\.1\.0" \}/, "version du serveur");
});

/* Exécution des deux modules (types retirés, zod simulé, base factice) : refus, règles et requêtes réellement envoyées. */
class UserErrorT extends Error {}
const fauxZ = () => { const f = new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : f), apply: () => f }); return f; };
function chargerModule(source) {
  const noms = [...source.matchAll(/^export (?:const|function|async function) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, { z: fauxZ(), RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Promise, console });
}
/** Base factice : chaque requête (from / rpc) est notée avec ses appels chaînés ; `reponse(requete)` fournit { data, error }. */
function fauxDb(reponse = () => ({ data: null, error: null })) {
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
  const h = {
    db, UserError: UserErrorT, RO: { readOnlyHint: true }, RW: { readOnlyHint: false }, source: "Claude", today: () => TODAY,
    must: (t, r) => { if (r.error) throw new UserErrorT(`Erreur base de données (${t}) : ${r.error.message}`); return r.data; },
    wrap: fn => async a => { try { return { ok: await fn(a) }; } catch (e) { if (e instanceof UserErrorT) return { erreur: e.message }; throw e; } },
    ...extra,
  };
  register({ registerTool: (nom, def, handler) => { outils[nom] = { def, handler }; } }, h);
  return outils;
}

test("AG1 : memoire.ts — refus sensible, échéance réservée, insertion, limite lisible, oubli", { skip: SANS_STRIP }, async () => {
  const M = chargerModule(srcMemoire);
  assert.equal(M.estSensible("FR76 3000 6000 0112 3456 7890 189"), true);
  assert.equal(M.estSensible("Carte 4970 1012 3456 7890"), true);
  assert.equal(M.estSensible("Mon Mot de passe est soleil"), true);
  assert.equal(M.estSensible("PEA chez la banque X : IE00B4L5Y983, FR0010315770"), false);
  assert.equal(M.estSensible("Achat prévu à 350 000 € en 2028"), false);
  assert.deepEqual(J(M.CATEGORIES), ["contexte", "preference", "projet", "decision", "explique", "a_suivre"]);

  let db = fauxDb(r => ({ data: { id: "m1", ...(r.ops.find(o => o[0] === "insert") || [])[1] }, error: null }));
  let T = serveur(M.registerMemoire, db);
  assert.deepEqual(Object.keys(T).sort(), ["memoriser", "oublier", "se_souvenir"]);
  let r = await T.memoriser.handler({ categorie: "contexte", contenu: "Mon IBAN : FR76 3000 6000 0112 3456 7890 189" });
  assert.match(r.erreur, /^Refusé/); assert.equal(db.appels.length, 0, "rien n'est envoyé à la base");
  r = await T.memoriser.handler({ categorie: "projet", contenu: "Achat d'une maison", echeance: "2027-06-01" });
  assert.match(r.erreur, /a_suivre/); assert.equal(db.appels.length, 0);
  r = await T.memoriser.handler({ categorie: "a_suivre", contenu: "Revoir le PER après la naissance", echeance: "2027-01-15", epingle: true });
  assert.equal(r.ok.retenu.id, "m1"); assert.match(r.ok.rappel, /Mémoire de l'agent/);
  const ins = db.appels[0].ops.find(o => o[0] === "insert")[1];
  assert.deepEqual(J(ins), { categorie: "a_suivre", contenu: "Revoir le PER après la naissance", echeance: "2027-01-15", epingle: true, source: "Claude" });
  r = await T.memoriser.handler({ categorie: "contexte", contenu: "Deux enfants" });
  assert.deepEqual(J(db.appels[1].ops.find(o => o[0] === "insert")[1]), { categorie: "contexte", contenu: "Deux enfants", echeance: null, epingle: false, source: "Claude" });

  db = fauxDb(() => ({ data: null, error: { code: "54000", message: "Mémoire pleine : 200 souvenirs au plus. Supprimez-en dans Boussole › Profil et données › Mémoire de l'agent." } }));
  r = await serveur(M.registerMemoire, db).memoriser.handler({ categorie: "contexte", contenu: "Un de trop" });
  assert.equal(r.erreur, "Mémoire pleine : 200 souvenirs au plus. Supprimez-en dans Boussole › Profil et données › Mémoire de l'agent.", "message de la limite remonté tel quel");

  db = fauxDb(() => ({ data: [{ id: "a" }, { id: "b" }], error: null }));
  T = serveur(M.registerMemoire, db);
  assert.match((await T.oublier.handler({})).erreur, /id ou ids/);
  r = await T.oublier.handler({ id: "a", ids: ["b", "a"] });
  assert.equal(r.ok.oublies, 2);
  const del = db.appels.at(-1);
  assert.equal(del.table, "memoire_agent"); assert.ok(del.ops.some(o => o[0] === "delete"));
  assert.deepEqual(J(del.ops.find(o => o[0] === "in")), ["in", "id", ["b", "a"]], "identifiants dédoublonnés");

  db = fauxDb(() => ({ data: [], error: null }));
  await serveur(M.registerMemoire, db).se_souvenir.handler({ categorie: "projet" });
  const sel = db.appels[0].ops;
  assert.deepEqual(J(sel.filter(o => o[0] === "order").map(o => o[1])), ["epingle", "cree_le"], "épinglés d'abord, puis les plus récents");
  assert.deepEqual(J(sel.find(o => o[0] === "eq")), ["eq", "categorie", "projet"]);
});

test("AG1 : memoire.ts — mémoire de session (épinglés puis 30 récents) et points à suivre échus", { skip: SANS_STRIP }, () => {
  const M = chargerModule(srcMemoire);
  const l = [
    { id: "e1", epingle: true, categorie: "contexte" }, { id: "e2", epingle: true, categorie: "preference" },
    ...Array.from({ length: 40 }, (_, i) => ({ id: "r" + i, epingle: false, categorie: i === 3 ? "a_suivre" : "projet", echeance: i === 3 ? "2026-10-01" : null })),
    { id: "s1", epingle: false, categorie: "a_suivre", echeance: "2026-10-10" }, { id: "s2", epingle: false, categorie: "a_suivre", echeance: "2026-11-01" },
    { id: "s3", epingle: false, categorie: "a_suivre", echeance: null },
  ];
  const s = M.memoireDeSession(l);
  assert.equal(s.length, 32); assert.deepEqual(J(s.slice(0, 3).map(m => m.id)), ["e1", "e2", "r0"]);
  assert.deepEqual(J(M.aSuivreEchus(l, TODAY).map(m => m.id)), ["r3", "s1"], "échéance ≤ aujourd'hui, sans échéance exclu");
});

test("AG1 : savoir.ts — consulter_savoir (slug, recherche, rien inventé), reperes à vérifier, nouveautés", { skip: SANS_STRIP }, async () => {
  const S = chargerModule(srcSavoir);
  assert.deepEqual(J(S.THEMES), ["epargne", "enveloppes", "fiscalite", "immobilier", "retraite", "protection", "marches", "comportement", "credit"]);
  let db = fauxDb(r => (r.rpc ? { data: [], error: null } : { data: null, error: null }));
  let T = serveur(S.registerSavoir, db);
  assert.deepEqual(Object.keys(T).sort(), ["consulter_savoir", "reperes"]);
  assert.match((await T.consulter_savoir.handler({})).erreur, /question, theme ou slug/);
  assert.match((await T.consulter_savoir.handler({ slug: "livret-a" })).erreur, /Fiche introuvable : livret-a/);
  let r = await T.consulter_savoir.handler({ question: "livret A" });
  assert.equal(r.ok.nombre, 0); assert.match(r.ok.consigne, /n'inventez rien/);
  assert.deepEqual(J(db.appels.at(-1)), { rpc: "chercher_savoir", args: { p_question: "livret A", p_theme: null, p_limite: 5 }, ops: [] });

  db = fauxDb(() => ({ data: [
    { cle: "livret_a_taux", valeur: "1.7", verifie_le: "2026-09-01" },
    { cle: "pass", valeur: "47100", verifie_le: "2026-01-15" },
  ], error: null }));
  r = await serveur(S.registerSavoir, db).reperes.handler({ cles: ["livret_a_taux", "pass"] });
  assert.deepEqual(J(r.ok.reperes.map(x => [x.cle, x.valeur, x.a_verifier])), [["livret_a_taux", 1.7, false], ["pass", 47100, true]], "valeur numérique ; > 180 jours : à vérifier");
  assert.deepEqual(J(db.appels[0].ops.find(o => o[0] === "in")), ["in", "cle", ["livret_a_taux", "pass"]]);

  db = fauxDb(() => ({ data: [{ slug: "pea" }], error: null }));
  assert.deepEqual(J(await S.nouveautes(db, (t, x) => x.data, null)), [], "première session : rien");
  assert.equal(db.appels.length, 0);
  assert.deepEqual(J(await S.nouveautes(db, (t, x) => x.data, "2026-10-01T08:00:00+00:00")), [{ slug: "pea" }]);
  const ops = db.appels[0].ops;
  assert.deepEqual(J(ops.find(o => o[0] === "gt")), ["gt", "mis_a_jour_le", "2026-10-01"]);
  assert.deepEqual(J(ops.find(o => o[0] === "limit")), ["limit", 10]);
});

test("mcp : aucune clé de service", () => {
  assert.doesNotMatch(srcAll, /SERVICE_ROLE|service_role|sb_secret_/i);
});

test("mcp : verify_jwt désactivé assumé (vérification faite par le serveur) et documenté", () => {
  assert.match(src, /verify_jwt\s*=\s*false/, "le commentaire d'en-tête doit expliquer verify_jwt = false");
});

test("mcp : deno.json épingle les dépendances npm", () => {
  const deno = JSON.parse(readFileSync(path("supabase/functions/mcp/deno.json"), "utf8"));
  const specs = Object.values(deno.imports);
  assert.ok(specs.length >= 5);
  for (const s of specs) assert.match(s, /^npm:(@[^/]+\/)?[^@/]+@\d+\.\d+\.\d+/, `version non épinglée : ${s}`);
  for (const imp of srcAll.matchAll(/from\s+"([^"]+)"/g)) {
    if (imp[1].startsWith("./")) { assert.ok(existsSync(path("supabase/functions/mcp/" + imp[1].slice(2))), `module relatif absent : ${imp[1]}`); continue; }
    assert.ok(imp[1] in deno.imports, `import non mappé : ${imp[1]}`);
  }
  assert.match(src, /import \{[^}]*\bregisterSavoir\b[^}]*\} from "\.\/savoir\.ts"/);
  assert.match(src, /import \{[^}]*\bregisterMemoire\b[^}]*\bSENSIBLE\b[^}]*\} from "\.\/memoire\.ts"/);
  assert.doesNotMatch(srcSavoir + srcMemoire, /from "\.\/index\.ts"/, "pas d'import circulaire vers index.ts");
});

test("consentement : page autonome, scripts et appels OAuth attendus", () => {
  const html = readFileSync(path("web/oauth/consent.html"), "utf8");
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.includes('src="../config.js"'));
  assert.ok(html.includes('src="../app/consent.js"'));
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+\/dist\/umd\/supabase\.js" integrity="sha384-/);
  assert.match(html, /prefers-color-scheme:\s*dark/);
  const js = readFileSync(path("web/src/consent.js"), "utf8");
  for (const fn of ["getAuthorizationDetails", "approveAuthorization", "denyAuthorization", "signInWithPassword", "signInWithOtp"]) assert.ok(js.includes(fn), fn);
  assert.ok(js.includes("authorization_id"));
  assert.ok(js.includes("redirect_url"));
  assert.ok(existsSync(path("web/src/consent.js")));
});

const live = process.env.BOUSSOLE_LIVE === "1";
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "boussole-test", version: "1" } } };

test("en ligne : métadonnées de ressource protégée", { skip: !live && "BOUSSOLE_LIVE absent : test en ligne non exécuté" }, async () => {
  const res = await fetch(PRM_URL);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.resource, BASE);
  assert.deepEqual(body.authorization_servers, ["https://oapcewpqsbbjdlcdeizi.supabase.co/auth/v1"]);
});

test("en ligne : POST sans jeton → 401 + WWW-Authenticate ; jeton invalide → 401", { skip: !live && "BOUSSOLE_LIVE absent : test en ligne non exécuté" }, async () => {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  let res = await fetch(BASE, { method: "POST", headers, body: JSON.stringify(INIT) });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("www-authenticate"), `Bearer resource_metadata="${PRM_URL}"`);
  assert.equal((await res.json()).error, "unauthorized");
  res = await fetch(BASE, { method: "POST", headers: { ...headers, Authorization: "Bearer jeton.invalide.x" }, body: JSON.stringify(INIT) });
  assert.equal(res.status, 401);
  assert.ok(res.headers.get("www-authenticate").startsWith(`Bearer resource_metadata="${PRM_URL}"`));
});
