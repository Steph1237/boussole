// SEC2 : garde globale de la double authentification dans le connecteur MCP (supabase/functions/mcp/garde-mfa.ts, branchée dans
// index.ts / handleMcp). Un jeton aal1 d'un compte à facteur vérifié ne doit jamais faire répondre « rien » : message explicite.
// Le module est exécuté dans un contexte vm (types retirés), avec un faux client admin et un faux serveur MCP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as nodeModule from "node:module";
import vm from "node:vm";

const path = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
const lire = rel => readFileSync(path(rel), "utf8");
const src = lire("supabase/functions/mcp/index.ts");
const srcGarde = lire("supabase/functions/mcp/garde-mfa.ts");
const sansCommentaires = s => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";

const MSG = "Double authentification requise : ton compte Boussole est protégé par un code. Reconnecte le connecteur Boussole dans Claude (Réglages › Connecteurs) et saisis ton code à 6 chiffres sur la page d'autorisation.";

function charger(journal = []) {
  const noms = [...srcGarde.matchAll(/^export (?:const|function|async function) (\w+)/gm)].map(m => m[1]);
  const js = strip(srcGarde, { mode: "strip" }).replace(/^export (const|function|async function)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, { Array, Set, Error, Promise, console: { error: (...a) => journal.push(a.join(" ")), warn() {}, log() {} } });
}
/** Faux client admin : listFactors → réponse donnée (ou rejet / error). */
const fauxAdmin = (reponse, appels = []) => ({
  auth: { admin: { mfa: { listFactors: async a => { appels.push(a); const r = typeof reponse === "function" ? reponse(a) : reponse; if (r instanceof Error) throw r; return r; } } } },
});
const facteurs = (...statuts) => ({ data: { factors: statuts.map((status, i) => ({ id: "f" + i, factor_type: "totp", status })) }, error: null });

/** Faux McpServer : registerTool + validateToolInput comme le SDK ; appeler(nom, args) = validation puis gestionnaire. */
function fauxServeur(journal) {
  const outils = new Map();
  const s = {
    registerTool(nom, def, handler) { outils.set(nom, { def, handler }); return { nom }; },
    async validateToolInput(tool, args, nom) { journal.push("valider:" + nom); return args; },
    async appeler(nom, args = {}) {
      const t = outils.get(nom); assert.ok(t, "outil inconnu " + nom);
      const a = await s.validateToolInput(t.def, args, nom);
      return t.handler(a);
    },
  };
  return s;
}
const TOUS = ["demarrer_session", "get_overview", "lire_banque", "memoriser", "formulaire", "analyser", "consulter_savoir", "reperes", "consulter_expertise"];
function monter(G, verdict, journal = []) {
  const s = fauxServeur(journal);
  G.gardeOutils(s, verdict);
  const executes = [];
  for (const nom of TOUS) s.registerTool(nom, { inputSchema: null }, async () => { executes.push(nom); return { content: [{ type: "text", text: "données de " + nom }] }; });
  return { s, executes };
}
const texte = r => r.content[0].text;

test("verdict : aal2 → ok sans aucune lecture des facteurs", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  let crees = 0;
  assert.equal(await G.verdictMfa(() => { crees++; return fauxAdmin(facteurs("verified")); }, "u1", "aal2"), "ok");
  assert.equal(crees, 0, "le client de service n'est même pas créé en aal2");
});

test("verdict : aal1 + facteur vérifié → requise (facteur lu côté serveur pour cet utilisateur)", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger(), appels = [];
  assert.equal(await G.verdictMfa(() => fauxAdmin(facteurs("verified"), appels), "u1", "aal1"), "requise");
  assert.deepEqual(JSON.parse(JSON.stringify(appels)), [{ userId: "u1" }]);
  assert.equal(await G.verdictMfa(() => fauxAdmin(facteurs("unverified", "verified")), "u1", "aal1"), "requise");
});

test("verdict : aal1 sans facteur, ou facteur non vérifié → ok (comportement inchangé)", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  assert.equal(await G.verdictMfa(() => fauxAdmin(facteurs()), "u1", "aal1"), "ok");
  assert.equal(await G.verdictMfa(() => fauxAdmin(facteurs("unverified")), "u1", "aal1"), "ok");
});

test("verdict : échec de lecture → incertain (échec fermé), jamais ok", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const journal = [], G = charger(journal);
  assert.equal(await G.verdictMfa(() => fauxAdmin({ data: null, error: { message: "panne" } }), "u1", "aal1"), "incertain");
  assert.equal(await G.verdictMfa(() => fauxAdmin(new Error("réseau")), "u1", "aal1"), "incertain");
  assert.equal(await G.verdictMfa(() => { throw new Error("clé de service absente"); }, "u1", "aal1"), "incertain", "clé de service absente");
  assert.equal(await G.verdictMfa(() => fauxAdmin({ data: {}, error: null }), "u1", "aal1"), "incertain", "réponse sans liste");
  assert.equal(await G.verdictMfa(() => fauxAdmin({ data: { factors: "oui" }, error: null }), "u1", "aal1"), "incertain", "liste invalide");
  assert.equal(journal.length, 5, "chaque échec est journalisé");
});

test("garde : aal1 + facteur → message sur un outil de données et sur demarrer_session, sans exécuter le code de l'outil", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  const { s, executes } = monter(G, "requise");
  for (const nom of ["get_overview", "demarrer_session", "lire_banque", "memoriser", "formulaire", "analyser"]) {
    const r = await s.appeler(nom, { n: 1 });
    assert.equal(r.isError, true, nom);
    assert.equal(texte(r), MSG, nom);
    assert.equal(r.content.length, 1, "un seul message");
  }
  assert.deepEqual(executes, [], "aucun outil de données n'a tourné");
  assert.equal(G.MSG_MFA_CONNECTEUR, MSG);
});

test("garde : le message passe même avec des paramètres invalides (validation non appliquée aux outils refusés)", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger(), journal = [];
  const s = fauxServeur(journal);
  s.validateToolInput = async () => { throw new Error("paramètres invalides"); };
  G.gardeOutils(s, "requise");
  s.registerTool("get_overview", {}, async () => ({ content: [{ type: "text", text: "x" }] }));
  s.registerTool("reperes", {}, async () => ({ content: [{ type: "text", text: "repères" }] }));
  assert.equal(texte(await s.appeler("get_overview", { n: "pas bon" })), MSG);
  await assert.rejects(s.appeler("reperes"), /paramètres invalides/, "un outil public garde sa validation");
});

test("garde : aal2 → tous les outils tournent normalement", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  const { s, executes } = monter(G, await G.verdictMfa(() => fauxAdmin(facteurs("verified")), "u1", "aal2"));
  for (const nom of TOUS) assert.equal(texte(await s.appeler(nom)), "données de " + nom);
  assert.deepEqual(executes, TOUS);
});

test("garde : sans facteur → tous les outils tournent normalement", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  const { s, executes } = monter(G, await G.verdictMfa(() => fauxAdmin(facteurs()), "u1", "aal1"));
  for (const nom of TOUS) assert.equal(texte(await s.appeler(nom)), "données de " + nom);
  assert.deepEqual(executes, TOUS);
});

test("garde : échec de lecture des facteurs → message d'incertitude (échec fermé), jamais les données", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  const { s, executes } = monter(G, await G.verdictMfa(() => fauxAdmin(new Error("panne")), "u1", "aal1"));
  for (const nom of ["get_overview", "demarrer_session", "lire_banque"]) {
    const r = await s.appeler(nom);
    assert.equal(r.isError, true);
    assert.equal(texte(r), G.MSG_MFA_INCERTAIN);
    assert.match(texte(r), /Double authentification/);
    assert.match(texte(r), /Ce n'est pas un compte vide/);
  }
  assert.deepEqual(executes, []);
});

test("garde : les outils de savoir commun restent disponibles en aal1 avec facteur (et en cas d'incertitude)", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  assert.deepEqual([...G.OUTILS_PUBLICS].sort(), ["consulter_expertise", "consulter_savoir", "reperes"]);
  for (const v of ["requise", "incertain"]) {
    const { s, executes } = monter(G, v);
    for (const nom of ["consulter_savoir", "reperes", "consulter_expertise"]) {
      const r = await s.appeler(nom);
      assert.equal(r.isError, undefined, nom);
      assert.equal(texte(r), "données de " + nom);
    }
    assert.deepEqual(executes, ["consulter_savoir", "reperes", "consulter_expertise"]);
  }
});

test("garde : aucun message ne vouvoie, et les messages guident vers le connecteur", () => {
  const VOUS = /(?<![\p{L}\p{N}_])(vous|votre|vos)(?![\p{L}\p{N}_])/iu;
  assert.doesNotMatch(MSG, VOUS);
  assert.match(MSG, /Réglages › Connecteurs/);
  assert.match(MSG, /6 chiffres/);
  assert.doesNotMatch(srcGarde.match(/MSG_MFA_INCERTAIN = "([^"]*)"/)[1], VOUS);
});

test("index.ts : branchement (verdict après getUser, avant buildServer ; garde avant tout outil ; conduite et instructions)", () => {
  const code = sansCommentaires(src);
  const h = code.slice(code.indexOf("async function handleMcp("));
  const iUser = h.indexOf("auth.getUser(token)"), iAal = h.indexOf("const aal = aalDuJeton(token)"), iVerdict = h.indexOf("await verdictMfa("), iBuild = h.indexOf("buildServer(");
  assert.ok(iUser >= 0 && iUser < iAal && iAal < iVerdict && iVerdict < iBuild, "getUser, puis aal, puis verdict, puis buildServer");
  assert.match(h, /buildServer\(\{ db, user: \{[^}]*\}, client: clientDuJeton\(token\), aal, mfa \}\)/, "buildServer reçoit aal et mfa");
  assert.match(h, /data\.user\.id, aal\)/, "facteur lu pour l'utilisateur validé par getUser");
  assert.match(h, /deps\.env\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(h, /if \(!cle\) throw/, "clé absente : échec fermé (verdict incertain)");
  const b = code.slice(code.indexOf("export function buildServer("), code.indexOf("registerSavoir(server, h)"));
  assert.match(b, /gardeOutils\(server, mfa \?\? "ok"\)/, "garde appliquée avant l'enregistrement du premier outil");
  assert.ok(b.indexOf("validateToolInput =") < b.indexOf("gardeOutils("), "garde appliquée après la validation française des paramètres");
  const conduite = src.slice(src.indexOf("const CONDUITE_COPILOTE"), src.indexOf("const PROMPT_ONBOARDING"));
  assert.match(conduite, /"19\. Double authentification du connecteur[^"]*Ne conclus jamais qu'il n'a rien/);
  const instr = src.slice(src.indexOf("const INSTRUCTIONS"), src.indexOf("/* Parcours d'entretien"));
  assert.match(instr, /Double authentification du connecteur[^"]*N'en conclus jamais que l'utilisateur n'a rien/);
});

test("garde-mfa.ts : la clé de service ne sert qu'à lister les facteurs (aucune lecture ni écriture de données)", () => {
  const code = sansCommentaires(srcGarde);
  assert.match(code, /auth\.admin\.mfa\.listFactors\(\{ userId \}\)/);
  assert.doesNotMatch(code, /\.from\(|\.rpc\(|deleteUser|createUser|updateUserById|SERVICE_ROLE/);
  assert.doesNotMatch(code, /sb_secret_|eyJ/);
});
