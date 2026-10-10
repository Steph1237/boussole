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
const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""); // sans commentaires

const BASE = "https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/mcp";
const PRM_URL = `${BASE}/.well-known/oauth-protected-resource`;
const TOOLS = [
  "get_overview", "get_profile", "update_profile", "upsert_biens", "upsert_credits", "delete_bien", "delete_credit",
  "list_positions", "upsert_positions", "record_transaction", "get_config", "update_config",
  "get_budget", "update_budget", "list_objectifs", "upsert_objectifs", "delete_objectif",
  "get_risk_profile", "annotate_instrument",
];

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
  for (const t of TOOLS) assert.match(code, new RegExp(`["']${t}["']`), `outil ${t} absent`);
  assert.doesNotMatch(code, /delete_me|export_all|delete_account|auth\.admin/);
});

test("mcp : budget et objectifs écrivent dans leurs tables, get_overview expose le score de santé", () => {
  assert.match(code, /from\("budgets"\)\.upsert\(\{\s*user_id:\s*user\.id,\s*lignes/, "update_budget : upsert de budgets sur l'utilisateur du jeton");
  assert.match(code, /onConflict:\s*"user_id"/);
  for (const t of ["objectifs"]) assert.match(code, new RegExp(`from\\("${t}"\\)\\.(insert|update|delete)`));
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
  const outil = nom => { const i = code.indexOf(`registerTool("${nom}"`); assert.ok(i >= 0, nom); return code.slice(i, code.indexOf("registerTool(", i + 20) > 0 ? code.indexOf("registerTool(", i + 20) : undefined); };
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

/* ---------- parité de calcul avec web/src (risque.js, marche.js, pratiques.js) ---------- */
// Le bloc pur du connecteur (de « Utilitaires » à « Schémas d'entrée ») est extrait, débarrassé de ses types
// (module.stripTypeScriptTypes, Node ≥ 22.13) et exécuté dans un contexte vm, puis comparé aux modules du site.
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
function portMcp() {
  const debut = src.indexOf("/* Utilitaires"), fin = src.indexOf("/* Schémas d'entrée");
  const bloc = src.slice(src.lastIndexOf("/*", debut - 1), src.lastIndexOf("/*", fin - 1));
  const js = strip(bloc, { mode: "strip" }) + "\n;({ bonnesPratiques, vueRisque, syntheseRisque, allocationReelle, risquePortefeuille, ecarts, classeRisque, classePoche, liquidite, PROFILS, CLASSES_RISQUE, correlation, CLASSES_POCHE });";
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
    assert.deepEqual(J(mcp.familles.map(f => f.total)), web.familles.map(f => f.total), L + " : familles");
    if (sc.D && scope === "foyer") {
      assert.equal(mcp.criteres.find(c => c.cle === "frais").a_completer, false, "frais calculés une fois l'ETF Monde annoté");
      assert.ok(mcp.criteres.find(c => c.cle === "enveloppes").points < 20, "enveloppes : points d'attention");
    }
  }
});

test("mcp : aucune clé de service", () => {
  assert.doesNotMatch(src, /SERVICE_ROLE|service_role|sb_secret_/i);
});

test("mcp : verify_jwt désactivé assumé (vérification faite par le serveur) et documenté", () => {
  assert.match(src, /verify_jwt\s*=\s*false/, "le commentaire d'en-tête doit expliquer verify_jwt = false");
});

test("mcp : deno.json épingle les dépendances npm", () => {
  const deno = JSON.parse(readFileSync(path("supabase/functions/mcp/deno.json"), "utf8"));
  const specs = Object.values(deno.imports);
  assert.ok(specs.length >= 5);
  for (const s of specs) assert.match(s, /^npm:(@[^/]+\/)?[^@/]+@\d+\.\d+\.\d+/, `version non épinglée : ${s}`);
  for (const imp of src.matchAll(/from\s+"([^"]+)"/g)) assert.ok(imp[1] in deno.imports, `import non mappé : ${imp[1]}`);
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
