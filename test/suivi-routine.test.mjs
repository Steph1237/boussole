// SUIVI et la revue mensuelle (RT1) : la revue fige un plan chaque mois (figer_projection, source « revue mensuelle de <mois> », une fois par mois),
// reçoit les déclencheurs du mois selon la politique de suivi et écrit sa mémoire (routines.etat_suivi) à la clôture, calculée côté serveur.
// Exécution des modules dans un contexte vm (types retirés, zod simulé, base factice), sur le modèle de test/routines-mcp.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as nodeModule from "node:module";
import vm from "node:vm";
import { chargerSuiviGen } from "./helpers/suivi-gen.mjs";
import { MoteurGen } from "./helpers/moteur-gen.mjs";
import { CAS, donneesDe } from "./helpers/suivi-cas.mjs";

const path = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
const lire = rel => readFileSync(path(rel), "utf8");
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const J = v => JSON.parse(JSON.stringify(v));
const TODAY = "2026-10-15";
const sansCommentaires = s => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

class UserErrorT extends Error {}
const fauxZ = () => { const f = new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : f), apply: () => f }); return f; };
function chargerModule(source, globaux = {}) {
  const noms = [...source.matchAll(/^export (?:const|function|async function) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`,
    { z: fauxZ(), RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console, isFinite, Infinity, TextEncoder, Intl, ...globaux });
}
function fauxDb(reponse = () => ({ data: null, error: null })) {
  const appels = [];
  const from = table => {
    const r = { table, ops: [] }; appels.push(r);
    const p = new Proxy({}, { get: (_, k) => (k === "then" ? (ok, ko) => Promise.resolve(reponse(r)).then(ok, ko) : (...a) => { r.ops.push([k, ...a]); return p; }) });
    return p;
  };
  return { appels, from, rpc: async (nom, args) => { const r = { rpc: nom, args, ops: [] }; appels.push(r); return reponse(r); } };
}
const must = (t, r) => { if (r.error) throw new UserErrorT(`Erreur base de données (${t}) : ${r.error.message}`); return r.data; };
function serveur(register, db, extra = {}) {
  const outils = {};
  const h = {
    db, UserError: UserErrorT, RO: { readOnlyHint: true }, RW: { readOnlyHint: false }, source: "Claude", aal: "aal2", today: () => TODAY, must,
    wrap: fn => async a => { try { return { ok: await fn(a) }; } catch (e) { if (e instanceof UserErrorT) return { erreur: e.message }; throw e; } },
    ...extra,
  };
  register({ registerTool: (nom, def, handler) => { outils[nom] = { def, handler }; } }, h);
  return outils;
}
const SuiviGen = chargerSuiviGen().Suivi;
const chargerSuivi = () => chargerModule(lire("supabase/functions/mcp/suivi.ts"), { Suivi: SuiviGen, Projection: MoteurGen.Projection });
const chargerRoutines = () => {
  const M = chargerModule(lire("supabase/functions/mcp/memoire.ts")), S = chargerModule(lire("supabase/functions/mcp/savoir.ts")), B = chargerModule(lire("supabase/functions/mcp/banque.ts"));
  const Jn = chargerModule(lire("supabase/functions/mcp/journal.ts"), { estSensible: M.estSensible }), Cal = chargerModule(lire("supabase/functions/mcp/calendrier.ts"));
  return chargerModule(lire("supabase/functions/mcp/routines.ts"), { estSensible: M.estSensible, etatFige: Jn.etatFige, journalDeSession: Jn.journalDeSession,
    lireConsentement: Jn.lireConsentement, JOURNAL: Jn.JOURNAL, REFUS_SENSIBLE: Jn.REFUS_SENSIBLE, nouveautes: S.nouveautes, banqueDeRoutine: B.banqueDeRoutine, echeancesDeRevue: Cal.echeancesDeRevue });
};
const calculFaux = () => ({
  charger: async () => ({ donnees: { positions: [], lignes: [] }, objectifs: [], risque: null, classes: null }),
  bilan: () => ({ net: 100000, financier: 60000, dettes: 20000 }), bonnesPratiques: () => ({ total: 72, provisoire: false }), syntheseRisque: () => null, lireReperes: async () => [],
  budgetTotaux: () => ({ revenus: 5000, depenses: 3000, epargne: 800, reste: 1200 }), situationObjectifs: () => ({ epargneMensuelle: 0, objectifs: [] }),
});
const ROUTINE = { type: "revue_mensuelle", jour: 1, active: true, consentement_journal: true, dernier_passage: "2026-10-01T06:00:00+00:00", dernier_client: "Claude", prochain_passage: "2026-11-01", questions: [], synthese: null };
function dbRoutines({ rpcPremiere } = {}) {
  let n = 0;
  return fauxDb(r => {
    if (r.rpc === "cloturer_routine") { n++; return rpcPremiere && n === 1 ? { data: null, error: rpcPremiere } : { data: { ...ROUTINE, dernier_passage: TODAY + "T06:00:00+00:00", synthese: r.args.p_synthese, questions: r.args.p_questions }, error: null }; }
    if (r.table === "profiles") return { data: { journal_consentement: "demander" }, error: null };
    if (r.table === "journal") return { data: r.ops.some(o => o[0] === "insert") ? { id: "j1", titre: "t", statut: "a_relire" } : [], error: null, count: 0 };
    if (r.table === "routines") return { data: ROUTINE, error: null };
    return { data: [], error: null };
  });
}

/* ---------- plan figé du mois ---------- */
test("conduite de la revue : une étape propose figer_projection (raison revue_mensuelle, source « revue mensuelle de <mois> »), une fois par mois", { skip: SANS_STRIP }, () => {
  const { CONDUITE_REVUE } = chargerRoutines();
  assert.match(CONDUITE_REVUE, /5 bis\. Plan figé du mois \(plan_du_mois\)/);
  assert.match(CONDUITE_REVUE, /figer_projection avec raison revue_mensuelle et la source plan_du_mois\.source \(« revue mensuelle de <mois> »\)/);
  assert.match(CONDUITE_REVUE, /Une seule fois par mois : si plan_du_mois\.existe est vrai .* ou si plan_du_mois\.en_attente est vrai/);
  assert.match(CONDUITE_REVUE, /à l'exception du plan figé du mois \(5 bis\)/, "la règle 5 (aucune proposition sans l'utilisateur) fait exception pour ce plan, qui attend sa validation");
  assert.match(CONDUITE_REVUE, /2 septies\. Suivi des lignes/);
  assert.doesNotMatch(CONDUITE_REVUE, /conseiller|Copilote|\bvous\b|\bvotre\b/i);
});

test("planDuMois : à figer sans plan ni proposition ce mois-ci ; jamais deux fois ; un plan d'un autre mois ne compte pas", { skip: SANS_STRIP }, async () => {
  const S = chargerSuivi();
  const db = ({ plans = [], propositions = [] }) => fauxDb(r => (r.table === "plans_figes" ? { data: plans, error: null } : r.table === "propositions" ? { data: propositions, error: null } : { data: [], error: null }));
  let p = await S.planDuMois(db({}), must, TODAY);
  assert.deepEqual(J(p), { mois: "2026-10", existe: false, en_attente: false, a_figer: true, source: "revue mensuelle d'octobre 2026" });
  p = await S.planDuMois(db({ plans: [{ id: "p1", cree_le: "2026-10-03T08:00:00+00:00", raison: "revue_mensuelle" }] }), must, TODAY);
  assert.equal(p.existe, true); assert.equal(p.a_figer, false, "un plan de ce mois existe : on ne fige pas deux fois");
  p = await S.planDuMois(db({ propositions: [{ id: "x", cree_le: "2026-10-09T08:00:00+00:00" }] }), must, TODAY);
  assert.equal(p.en_attente, true); assert.equal(p.a_figer, false, "une proposition de plan attend déjà sa validation");
  p = await S.planDuMois(db({ propositions: [{ id: "x", cree_le: "2026-09-29T08:00:00+00:00" }] }), must, TODAY);
  assert.equal(p.a_figer, true, "une proposition du mois dernier ne compte pas");
  // le plan est lu par date de création à partir du 1er du mois, en date de Paris (23 h 30 UTC du 30 septembre = 1er octobre à Paris)
  p = await S.planDuMois(db({ plans: [{ id: "p0", cree_le: "2026-09-30T23:30:00+00:00" }] }), must, TODAY);
  assert.equal(p.existe, true, "01h30 à Paris le 1er octobre : plan d'octobre");
  const lu = db({}); await S.planDuMois(lu, must, TODAY);
  assert.deepEqual(J(lu.appels.find(a => a.table === "plans_figes").ops.find(o => o[0] === "gte")), ["gte", "cree_le", "2026-10-01"]);
  // migration plans_figes absente : traité comme « aucun plan » ; panne : null sans lever
  const absente = fauxDb(r => (r.table === "plans_figes" ? { data: null, error: { code: "42P01", message: 'relation "plans_figes" does not exist' } } : { data: [], error: null }));
  assert.equal((await S.planDuMois(absente, must, TODAY)).a_figer, true);
  assert.equal(await S.planDuMois(fauxDb(() => ({ data: null, error: { message: "panne" } })), must, TODAY), null);
});

test("la source du plan du mois est « revue mensuelle de <mois> » avec l'élision (d'avril, d'août, d'octobre ; de mars)", { skip: SANS_STRIP }, () => {
  const S = chargerSuivi();
  assert.equal(S.sourcePlanDuMois("2026-10-15"), "revue mensuelle d'octobre 2026");
  assert.equal(S.sourcePlanDuMois("2027-04-01"), "revue mensuelle d'avril 2027");
  assert.equal(S.sourcePlanDuMois("2026-08-28"), "revue mensuelle d'août 2026");
  assert.equal(S.sourcePlanDuMois("2027-03-05"), "revue mensuelle de mars 2027");
  assert.equal(S.sourcePlanDuMois("2026-12-01"), "revue mensuelle de décembre 2026");
});

test("demarrer_routine renvoie plan_du_mois et le suivi du mois ; null sans bloquer la revue si le suivi échoue", { skip: SANS_STRIP }, async () => {
  const R = chargerRoutines(), S = chargerSuivi();
  const c = CAS.find(x => x.id === "DE-9"), d = donneesDe(c);
  const db = fauxDb(r => (r.table === "routines" ? { data: ROUTINE, error: null } : { data: [], error: null }));
  const suivi = { revue: () => S.suiviDeRevue(db, must, TODAY, async () => d), planDuMois: () => S.planDuMois(db, must, TODAY) };
  const r = (await serveur(R.registerRoutines, db, { calcul: calculFaux(), suivi }).demarrer_routine.handler({ type: "revue_mensuelle" })).ok;
  assert.equal(r.plan_du_mois.a_figer, true);
  assert.equal(r.plan_du_mois.source, "revue mensuelle d'octobre 2026");
  assert.ok(r.suivi.declencheurs_du_mois.length >= 2);
  assert.match(r.conduite, /plan_du_mois/);
  const r2 = (await serveur(R.registerRoutines, db, { calcul: calculFaux(), suivi: { revue: async () => null, planDuMois: async () => null } }).demarrer_routine.handler({ type: "revue_mensuelle" })).ok;
  assert.equal(r2.suivi, null); assert.equal(r2.plan_du_mois, null);
  const r3 = (await serveur(R.registerRoutines, db, { calcul: calculFaux() }).demarrer_routine.handler({ type: "revue_mensuelle" })).ok;
  assert.equal(r3.suivi, null, "sans module de suivi : champs présents et nuls");
});

/* ---------- mémoire de la revue ---------- */
test("cloturer_routine écrit routines.etat_suivi calculé par Boussole (jamais fourni par l'agent) ; repli sans le paramètre si la migration manque", { skip: SANS_STRIP }, async () => {
  const R = chargerRoutines(), S = chargerSuivi(), d = donneesDe(CAS.find(x => x.id === "DE-1"));
  const etat = coeurRevu => S.etatSuiviDeCloture(fauxDb(), must, TODAY, async () => d, coeurRevu);
  const db = dbRoutines();
  await serveur(R.registerRoutines, db, { calcul: calculFaux(), suivi: { etat } }).cloturer_routine.handler({ type: "revue_mensuelle", synthese: "Revue.", questions: [], revue_coeur_faite: true, etat_suivi: { evil: "oui" } });
  const rpc = db.appels.find(a => a.rpc === "cloturer_routine");
  assert.equal(rpc.args.p_etat_suivi.le, TODAY);
  assert.equal(rpc.args.p_etat_suivi.revue_coeur_faite_le, TODAY);
  assert.ok(!("evil" in rpc.args.p_etat_suivi), "l'agent ne fournit pas l'état");
  assert.ok(rpc.args.p_etat_suivi.declencheurs.length >= 1);
  // sans revue du cœur déclarée : la date n'avance pas
  const db2 = dbRoutines();
  await serveur(R.registerRoutines, db2, { calcul: calculFaux(), suivi: { etat } }).cloturer_routine.handler({ type: "revue_mensuelle", synthese: "Revue.", questions: [] });
  assert.equal(db2.appels.find(a => a.rpc === "cloturer_routine").args.p_etat_suivi.revue_coeur_faite_le, null);
  // migration 0032 pas encore appliquée : la RPC ne connaît pas p_etat_suivi → la clôture se refait sans, la revue n'échoue pas
  const db3 = dbRoutines({ rpcPremiere: { code: "PGRST202", message: "Could not find the function public.cloturer_routine(p_client, p_etat_suivi, p_questions, p_synthese, p_type) in the schema cache" } });
  const r3 = await serveur(R.registerRoutines, db3, { calcul: calculFaux(), suivi: { etat } }).cloturer_routine.handler({ type: "revue_mensuelle", synthese: "Revue.", questions: [] });
  assert.ok(r3.ok, JSON.stringify(r3));
  const appels = db3.appels.filter(a => a.rpc === "cloturer_routine");
  assert.equal(appels.length, 2); assert.ok("p_etat_suivi" in appels[0].args); assert.ok(!("p_etat_suivi" in appels[1].args));
  // état indisponible : appel inchangé
  const db4 = dbRoutines();
  await serveur(R.registerRoutines, db4, { calcul: calculFaux(), suivi: { etat: async () => null } }).cloturer_routine.handler({ type: "revue_mensuelle", synthese: "Revue.", questions: [] });
  assert.ok(!("p_etat_suivi" in db4.appels.find(a => a.rpc === "cloturer_routine").args));
});

test("index.ts : le suivi est branché (outils, demarrer_session.suivi, revue : suivi, mémoire et plan du mois), instructions et conduite en parlent", () => {
  const code = sansCommentaires(lire("supabase/functions/mcp/index.ts"));
  assert.match(code, /registerSuivi\(server, \{[^}]*lireDonnees: lireDonneesSuivi \}\)/);
  assert.match(code, /registerRoutines\(server, \{[\s\S]*suivi: \{ revue: \(\) => suiviDeRevue\([\s\S]*etat: \(coeurRevu: boolean\) => etatSuiviDeCloture\([\s\S]*planDuMois: \(\) => planDuMois\(db, must, today\(\)\) \}/);
  assert.match(code, /suivi = await suiviLu/);
  assert.match(code, /projection,\n\s+suivi,\n/);
  assert.match(code, /"Suivi des lignes \(suivi_lignes, ligne, ca_vaut_le_cout, lecture ; definir_suivi, par proposition\)/);
  assert.match(code, /"21\. Suivi des lignes \(suivi : /);
  assert.match(code, /et suivi \(suivi des lignes : semaine \{ a_venir, a_faire \}/);
});
