// SEC2 : garde globale de la double authentification dans le connecteur MCP (supabase/functions/mcp/garde-mfa.ts, branchée dans
// index.ts / handleMcp). Un jeton aal1 d'un compte à facteur vérifié ne doit jamais faire répondre « rien » : message explicite.
// Le module est exécuté dans un contexte vm (types retirés), avec un faux client utilisateur (RPC mfa_exigee) et un faux serveur MCP.
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
/** Faux client utilisateur : rpc(nom) → réponse donnée (ou rejet). `reponse` vaut pour toutes les RPC, ou { mfa_exigee, lier_connecteur }
    pour une réponse par RPC (0033 : lier_connecteur après mfa_exigee). */
const parRpc = r => r && typeof r === "object" && !(r instanceof Error) && ("mfa_exigee" in r || "lier_connecteur" in r);
const fauxDb = (reponse, appels = []) => ({
  rpc: async (nom, args) => {
    appels.push([nom, ...(args === undefined ? [] : [args])]);
    const choisie = parRpc(reponse) ? reponse[nom] : reponse;
    const r = typeof choisie === "function" ? choisie() : choisie;
    if (r instanceof Error) throw r;
    if (r === undefined) throw new Error("RPC inattendue : " + nom);
    return r;
  },
});
const exigee = valeur => ({ data: valeur, error: null });
/** Compte à facteur vérifié, jeton aal1 ; lier_connecteur répond `etat` (0033). */
const lie = etat => ({ mfa_exigee: exigee(true), lier_connecteur: { data: etat, error: null } });
const MSG_EXPIREE = "Double authentification requise : l'autorisation du connecteur Boussole, accordée avec ton code, a expiré (elle vaut 90 jours). Reconnecte le connecteur Boussole dans Claude (Réglages › Connecteurs) et saisis ton code à 6 chiffres sur la page d'autorisation.";

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

test("verdict : aal2 → ok sans aucun appel à la base", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger(), appels = [];
  assert.equal(await G.verdictMfa(fauxDb(exigee(true), appels), "aal2"), "ok");
  assert.equal(appels.length, 0, "mfa_exigee n'est même pas appelée en aal2");
});

test("verdict : aal1 + double authentification exigée, sans autorisation de connecteur → requise (RPC mfa_exigee puis lier_connecteur, sans paramètre)", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger(), appels = [];
  assert.equal(await G.verdictMfa(fauxDb(lie("absente"), appels), "aal1"), "requise");
  assert.deepEqual(JSON.parse(JSON.stringify(appels)), [["mfa_exigee"], ["lier_connecteur"]], "client_id et session_id sont lus par la base dans le jeton signé, jamais passés en paramètre");
});

test("verdict (0033) : autorisation liée au second facteur → autorise ; expirée → expiree ; tout autre refus → requise", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const journal = [], G = charger(journal);
  assert.equal(await G.verdictMfa(fauxDb(lie("autorise")), "aal1"), "autorise");
  assert.equal(await G.verdictMfa(fauxDb(lie("expiree")), "aal1"), "expiree");
  for (const e of ["sans_client", "absente", "revoquee", "autre_session", "hors_delai", "en_attente", "ambigu", "non_liee"])
    assert.equal(await G.verdictMfa(fauxDb(lie(e)), "aal1"), "requise", e);
  assert.ok(journal.some(l => /autre_session/.test(l)) && journal.some(l => /ambigu/.test(l)), "une autre session ou une liaison ambiguë est journalisée (signal d'un mot de passe volé)");
  assert.ok(!journal.some(l => /absente|en_attente/.test(l)), "les cas ordinaires ne sont pas journalisés");
});

test("verdict (0033) : lier_connecteur illisible → incertain (échec fermé) ; fonction absente (0033 pas encore appliquée) → requise comme avant", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  for (const [r, m] of [[{ data: null, error: { message: "panne" } }, "erreur"], [new Error("réseau"), "rejet"], [{ data: null, error: null }, "vide"], [{ data: true, error: null }, "booléen"],
    [{ data: "inconnu", error: null }, "état inconnu"], [{ data: ["autorise"], error: null }, "liste"], [{ data: "sans_facteur", error: null }, "facteur disparu entre les deux appels"]])
    assert.equal(await G.verdictMfa(fauxDb({ mfa_exigee: exigee(true), lier_connecteur: r }), "aal1"), "incertain", m);
  assert.equal(await G.verdictMfa(fauxDb({ mfa_exigee: exigee(true), lier_connecteur: { data: null, error: { code: "PGRST202", message: "Could not find the function public.lier_connecteur" } } }), "aal1"), "requise");
});

test("garde (0033) : connecteur autorisé → tous les outils tournent ; autorisation expirée → message dédié, rien n'est exécuté", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  const a = monter(G, await G.verdictMfa(fauxDb(lie("autorise")), "aal1"));
  for (const nom of TOUS) assert.equal(texte(await a.s.appeler(nom)), "données de " + nom);
  assert.deepEqual(a.executes, TOUS);
  const e = monter(G, "expiree");
  for (const nom of ["get_overview", "demarrer_session", "lire_banque"]) {
    const r = await e.s.appeler(nom);
    assert.equal(r.isError, true); assert.equal(texte(r), MSG_EXPIREE);
  }
  assert.deepEqual(e.executes, []);
  assert.equal(G.MSG_MFA_EXPIREE, MSG_EXPIREE);
  assert.equal(texte(await e.s.appeler("reperes")), "données de reperes", "savoir commun toujours ouvert");
});

test("verdict : aal1 sans facteur vérifié (mfa_exigee faux) → ok (comportement inchangé)", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  assert.equal(await G.verdictMfa(fauxDb(exigee(false)), "aal1"), "ok");
});

test("verdict : échec de lecture → incertain (échec fermé), jamais ok", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const journal = [], G = charger(journal);
  assert.equal(await G.verdictMfa(fauxDb({ data: null, error: { message: "panne" } }), "aal1"), "incertain");
  assert.equal(await G.verdictMfa(fauxDb(new Error("réseau")), "aal1"), "incertain");
  assert.equal(await G.verdictMfa(fauxDb({ data: null, error: null }), "aal1"), "incertain", "réponse vide");
  assert.equal(await G.verdictMfa(fauxDb({ data: "true", error: null }), "aal1"), "incertain", "réponse qui n'est pas un booléen");
  assert.equal(await G.verdictMfa(fauxDb({ data: [true], error: null }), "aal1"), "incertain", "liste inattendue");
  assert.equal(await G.verdictMfa({}, "aal1"), "incertain", "client sans rpc");
  assert.equal(journal.length, 6, "chaque échec est journalisé");
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
  const { s, executes } = monter(G, await G.verdictMfa(fauxDb(exigee(true)), "aal2"));
  for (const nom of TOUS) assert.equal(texte(await s.appeler(nom)), "données de " + nom);
  assert.deepEqual(executes, TOUS);
});

test("garde : sans facteur → tous les outils tournent normalement", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  const { s, executes } = monter(G, await G.verdictMfa(fauxDb(exigee(false)), "aal1"));
  for (const nom of TOUS) assert.equal(texte(await s.appeler(nom)), "données de " + nom);
  assert.deepEqual(executes, TOUS);
});

test("garde : échec de lecture des facteurs → message d'incertitude (échec fermé), jamais les données", async t => {
  if (SANS_STRIP) return t.skip(SANS_STRIP);
  const G = charger();
  const { s, executes } = monter(G, await G.verdictMfa(fauxDb(new Error("panne")), "aal1"));
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
  const expiree = srcGarde.match(/MSG_MFA_EXPIREE = "([^"]*)"/)[1];
  assert.doesNotMatch(expiree, VOUS);
  assert.match(expiree, /^Double authentification requise/, "même début : la règle 19 du Copilote s'applique");
  assert.match(expiree, /Réglages › Connecteurs/); assert.match(expiree, /90 jours/);
});

test("index.ts : branchement (verdict après getUser, avant buildServer ; garde avant tout outil ; conduite et instructions)", () => {
  const code = sansCommentaires(src);
  const h = code.slice(code.indexOf("async function handleMcp("));
  const iUser = h.indexOf("auth.getUser(token)"), iAal = h.indexOf("const aal = aalDuJeton(token)"), iVerdict = h.indexOf("await verdictMfa("), iBuild = h.indexOf("buildServer(");
  assert.ok(iUser >= 0 && iUser < iAal && iAal < iVerdict && iVerdict < iBuild, "getUser, puis aal, puis verdict, puis buildServer");
  assert.match(h, /buildServer\(\{ db, user: \{[^}]*\}, client: clientDuJeton\(token\), aal, mfa \}\)/, "buildServer reçoit aal et mfa");
  assert.match(h, /await verdictMfa\(db, aal\)/, "RPC mfa_exigee avec le client de l'utilisateur (celui qui a validé le jeton par getUser)");
  assert.doesNotMatch(h, /SERVICE_ROLE|service_role|auth\.admin/, "aucune clé de service dans le connecteur");
  const b = code.slice(code.indexOf("export function buildServer("), code.indexOf("registerSavoir(server, h)"));
  assert.match(b, /gardeOutils\(server, mfa \?\? "ok"\)/, "garde appliquée avant l'enregistrement du premier outil");
  assert.ok(b.indexOf("validateToolInput =") < b.indexOf("gardeOutils("), "garde appliquée après la validation française des paramètres");
  // 0033 : un connecteur autorisé lit comme une session aal2 (la RLS le permet ; la banque en lecture seulement)
  assert.match(code, /export function buildServer\(\{ db, user, client, aal: aalJeton, mfa \}: Ctx\)/);
  assert.match(b, /const aal = mfa === "autorise" \? "aal2" : aalJeton;/);
  assert.ok(b.indexOf('const aal = mfa === "autorise"') < b.indexOf("const h = {"), "niveau effectif fixé avant les outils");
  const conduite = src.slice(src.indexOf("const CONDUITE_COPILOTE"), src.indexOf("const PROMPT_ONBOARDING"));
  assert.match(conduite, /"19\. Double authentification du connecteur[^"]*Ne conclus jamais qu'il n'a rien/);
  const instr = src.slice(src.indexOf("const INSTRUCTIONS"), src.indexOf("/* Parcours d'entretien"));
  assert.match(instr, /Double authentification du connecteur[^"]*N'en conclus jamais que l'utilisateur n'a rien/);
});

test("garde-mfa.ts : seules les RPC mfa_exigee et lier_connecteur (sans paramètre) sont appelées, sans clé de service ni API admin Auth", () => {
  const code = sansCommentaires(srcGarde);
  assert.match(code, /db\.rpc\("mfa_exigee"\)/);
  assert.match(code, /db\.rpc\("lier_connecteur"\)/);
  assert.deepEqual([...code.matchAll(/db\.rpc\("(\w+)"/g)].map(m => m[1]).sort(), ["lier_connecteur", "mfa_exigee"]);
  assert.doesNotMatch(code, /\.from\(|deleteUser|createUser|updateUserById|SERVICE_ROLE|service_role|auth\.admin|listFactors/);
  assert.doesNotMatch(code, /sb_secret_|eyJ/);
});
