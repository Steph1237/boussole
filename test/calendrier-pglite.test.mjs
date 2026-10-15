// DAT1 « Calendrier patrimonial » (docs/superpowers/specs/2026-10-14-dat1-calendrier-design.md § 2, § 8 et § 11.2) : migration 0029
// exercée sur un vrai PostgreSQL (PGlite, en mémoire). Migrations 0001 → 0028 appliquées sur les bouchons Supabase
// (test/helpers/pglite.mjs, baseComplete), données de départ fictives, puis 0029. Couvre les quatre nouvelles colonnes de config, les
// contrôles d'appliquer_propositions (cible config : enveloppes_infos, prets_infos, donations, avis_impot ; cible profil : naissance),
// tout ou rien, la RLS, reperes.date_fin et l'unité « mois », les repères du § 11.2, les colonnes de banque_comptes réservées au service,
// les politiques MFA de 0028 et l'identité de la fonction avec 0027 hors ajouts. Aucun réseau ni secret réel ; valeurs fictives.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { baseComplete, comme } from "./helpers/pglite.mjs";
import { reperesDeMigration } from "./helpers/projection-cas.mjs";

const DIR = new URL("../supabase/migrations/", import.meta.url);
const SQL = readFileSync(new URL("0029_calendrier.sql", DIR), "utf8");
const SQL_0027 = readFileSync(new URL("0027_frais_suite.sql", DIR), "utf8");
const SPEC = readFileSync(new URL("../docs/superpowers/specs/2026-10-14-dat1-calendrier-design.md", import.meta.url), "utf8");
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", C = "33333333-3333-3333-3333-333333333333";
const CREDIT_A = "aaaaaaaa-0000-4000-8000-000000000001", BIEN_A = "aaaaaaaa-0000-4000-8000-000000000002";
const CREDIT_B = "bbbbbbbb-0000-4000-8000-000000000001", INCONNU = "cccccccc-0000-4000-8000-000000000009";
let db, AUJ, DEMAIN, HIER, ANNEE;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const superu = () => db.exec(`reset role; set test.uid = ''; set test.aal = 'aal2';`);

before(async () => {
  db = await baseComplete("0028_mfa.sql");
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
    insert into public.credits (id, user_id, nom, crd, mensualite) values ('${CREDIT_A}', '${A}', 'Crédit Exemple', 90000, 700), ('${CREDIT_B}', '${B}', 'Crédit de B', 5000, 100);
    insert into public.biens (id, user_id, nom, valeur, crd) values ('${BIEN_A}', '${A}', 'Appartement Exemple', 250000, 120000);`);
  await db.exec(SQL.replace(/^create extension[^;]*;/gim, ""));
  const j = await un(`select (now() at time zone 'Europe/Paris')::date::text auj, ((now() at time zone 'Europe/Paris')::date + 1)::text demain,
    ((now() at time zone 'Europe/Paris')::date - 1)::text hier, extract(year from now() at time zone 'Europe/Paris')::int an`);
  [AUJ, DEMAIN, HIER, ANNEE] = [j.auj, j.demain, j.hier, j.an];
});
after(async () => { await db.close(); });

/** Lignes du tableau du § 11.2 de la spec (repères à ajouter), telles qu'elles doivent se retrouver dans la base et dans la démo. */
function reperesDeLaSpec() {
  const lignes = SPEC.split("\n");
  const i = lignes.findIndex(l => l.startsWith("| Clé | Libellé | Valeur"));
  assert.ok(i > 0, "tableau du § 11.2 trouvé dans la spec");
  const attendus = [];
  for (const l of lignes.slice(i + 2)) {
    if (!l.startsWith("|")) break;
    const c = l.replace(/^\||\|$/g, "").split(" | ").map(s => s.trim());
    assert.equal(c.length, 8, l);
    const fin = c[5].replace(/\*/g, "");
    attendus.push({ cle: c[0].match(/`([a-z0-9_]+)`/)[1], libelle: c[1], valeur: Number(c[2]), unite: c[3], date_effet: c[4].match(/^\d{4}-\d{2}-\d{2}/)[0],
      date_fin: fin === "—" ? null : fin, source_titre: c[6], source_url: c[7] });
  }
  return attendus;
}

/* ---------- outils ---------- */
const proposer = async apres => (await q(`insert into public.propositions (cible, operation, apres, source) values ('config', 'modifier', $1, 'Conditions particulières du contrat') returning id`,
  [JSON.stringify(apres)]))[0].id;
const appliquer = async (ids, mods) => (await q("select public.appliquer_propositions($1::uuid[], $2::jsonb) n", [ids, JSON.stringify(mods ?? {})]))[0].n;
const NOUVELLES = ["enveloppes_infos", "prets_infos", "donations", "avis_impot"];
const cfg = async () => await un(`select enveloppes_infos, prets_infos, donations, avis_impot, cushion, recurring, frais_enveloppes from public.config where user_id = auth.uid()`);
const remise = async (uid = A) => {
  await superu();
  await db.query(`update public.config set enveloppes_infos = '{}', prets_infos = '{}', donations = '[]', avis_impot = '{}', frais_enveloppes = '{}' where user_id = $1`, [uid]);
  await db.query(`delete from public.propositions where user_id = $1`, [uid]);
  await db.query(`update public.profiles set personnes = '{"p1":{"nom":"Moi"}}' where user_id = $1`, [uid]);
  await comme(db, uid);
};
/** Dépose puis applique (session de A) ; renvoie la configuration lue ensuite. */
const ok = async (apres, mods) => { const id = await proposer(apres); assert.equal(await appliquer([id], mods), 1); return await cfg(); };
/** La proposition est refusée avec le motif, rien n'est écrit et elle reste en attente. */
const refus = async (apres, motif, msg, mods, cible = "réglages") => {
  const avant = await cfg();
  const id = await proposer(apres);
  await assert.rejects(appliquer([id], mods), e => {
    assert.match(e.message, new RegExp("^Proposition non appliquée \\(" + cible + ", modifier\\) : "), msg + " : " + e.message);
    assert.match(e.message, motif, msg + " : " + e.message);
    return true;
  }, msg + " : accepté");
  assert.deepEqual(await cfg(), avant, msg + " : aucune écriture");
  assert.equal((await un("select statut from public.propositions where id = $1", [id])).statut, "en_attente", msg + " : proposition en attente");
  await db.query("delete from public.propositions where id = $1", [id]);
};
const PEA = { type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", versements_cumules: 92000, source: "relevé annuel 2025", le: "2026-02-12" };
const DON = { id: "d1", date: "2015-07-01", montant: 20000, donateur: "p1", lien: "enfant", beneficiaire: "Enfant 1", nature: "donation", source: "acte notarié", le: "2026-02-12" };
const env = (cle, o) => ({ enveloppes_infos: { [cle]: { ...PEA, ...o } } });

/* ---------- en-tête, forme du fichier ---------- */
test("migration 0029 : en-tête (non appliquée, apply_migration name = calendrier, après 0028), tutoiement, jamais « conseiller », aucun secret", () => {
  assert.match(SQL, /^-- Boussole : calendrier patrimonial \(DAT1/);
  assert.match(SQL, /Non appliquée : à appliquer avec apply_migration \(name = "calendrier"\)/);
  assert.match(SQL, /après 0028 \(mfa\),\n-- AVANT le déploiement des fonctions mcp et powens/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu, "tutoiement : jamais vous / votre / vos");
  assert.doesNotMatch(SQL, /conseiller/i);
  assert.doesNotMatch(SQL, /sb_secret_|eyJhbGci|service_role_key/i);
  assert.doesNotMatch(SQL, /create table/i, "aucune nouvelle table (les politiques de 0028 couvrent config et banque_comptes)");
  for (const m of ["config_enveloppes_infos", "config_prets_infos", "config_donations", "config_avis_impot", "reperes_date_fin", "banque_comptes_pret"]) assert.match(SQL, new RegExp(m), m);
});

test("0029 n'ajoute aucun droit de modification sur banque_comptes et ne redéfinit que appliquer_propositions", () => {
  assert.doesNotMatch(SQL, /grant\s+update/i);
  assert.deepEqual([...SQL.matchAll(/create (?:or replace )?function\s+([\w.]+)\s*\(/gi)].map(m => m[1]), ["public.appliquer_propositions"]);
  const apres = readdirSync(DIR).filter(f => /^\d{4}_.*\.sql$/.test(f) && f > "0027_frais_suite.sql" && f !== "0029_calendrier.sql" && f !== "0031_projection.sql" && f !== "0032_suivi.sql")
    .filter(f => /function\s+public\.appliquer_propositions\s*\(/.test(readFileSync(new URL(f, DIR), "utf8")));
  assert.deepEqual(apres, [], "ni 0028 ni une migration suivante (hors 0031, qui repart de 0029 : projection-pglite, et 0032, qui repart de 0031 : suivi-pglite) ne redéfinit la fonction : 0029 repart bien de la dernière définition (0027)");
});

/* ---------- colonnes de config ---------- */
test("PGlite : config.enveloppes_infos, prets_infos, donations, avis_impot : jsonb not null, défauts {} {} [] {}", async () => {
  await superu();
  const cols = await q(`select column_name c, data_type t, is_nullable n, column_default d from information_schema.columns
    where table_schema = 'public' and table_name = 'config' and column_name in ('enveloppes_infos', 'prets_infos', 'donations', 'avis_impot') order by column_name`);
  assert.deepEqual(cols.map(c => [c.c, c.t, c.n]), [["avis_impot", "jsonb", "NO"], ["donations", "jsonb", "NO"], ["enveloppes_infos", "jsonb", "NO"], ["prets_infos", "jsonb", "NO"]]);
  const k = await un(`select enveloppes_infos, prets_infos, donations, avis_impot from public.config where user_id = '${A}'`);
  assert.deepEqual(k, { enveloppes_infos: {}, prets_infos: {}, donations: [], avis_impot: {} }, "ligne existante : défauts");
  await db.exec(`insert into auth.users (id) values ('44444444-4444-4444-4444-444444444444')`);
  assert.deepEqual(await un(`select enveloppes_infos, prets_infos, donations, avis_impot from public.config where user_id = '44444444-4444-4444-4444-444444444444'`),
    { enveloppes_infos: {}, prets_infos: {}, donations: [], avis_impot: {} }, "nouvel utilisateur : défauts");
  await db.exec(`delete from auth.users where id = '44444444-4444-4444-4444-444444444444'`);
});

test("PGlite : contraintes jsonb_typeof nommées (objet, objet, liste, objet) et not null", async () => {
  await superu();
  const noms = (await q(`select conname from pg_constraint where conrelid = 'public.config'::regclass and conname like 'config\\_%' order by conname`)).map(r => r.conname);
  for (const n of ["config_avis_impot", "config_donations", "config_enveloppes_infos", "config_prets_infos"]) assert.ok(noms.includes(n), n);
  const refuse = async (col, val, nom) => await assert.rejects(db.query(`update public.config set ${col} = $1::jsonb where user_id = '${A}'`, [val]), new RegExp(nom));
  await refuse("enveloppes_infos", "[]", "config_enveloppes_infos");
  await refuse("prets_infos", '"x"', "config_prets_infos");
  await refuse("donations", "{}", "config_donations");
  await refuse("avis_impot", "[]", "config_avis_impot");
  await assert.rejects(db.query(`update public.config set donations = null where user_id = '${A}'`), /null value|not-null/i);
  await db.query(`update public.config set donations = '[]', enveloppes_infos = '{"x":1}' where user_id = '${A}'`);
  await db.query(`update public.config set enveloppes_infos = '{}' where user_id = '${A}'`);
});

test("PGlite : 0029 est rejouable (alter ... if not exists / drop constraint if exists, repères on conflict)", async () => {
  await superu();
  const avant = await un(`select count(*)::int n from public.reperes`);
  await db.exec(SQL.replace(/^create extension[^;]*;/gim, ""));
  assert.equal((await un(`select count(*)::int n from public.reperes`)).n, avant.n);
});

/* ---------- appliquer_propositions : cible config, enveloppes_infos ---------- */
test("config : chaque nouvelle clé acceptée seule ; une proposition peut les porter toutes ensemble avec cushion", async () => {
  await remise();
  let c = await ok(env("PEA Exemple", {}));
  assert.deepEqual(c.enveloppes_infos, { "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", versements_cumules: 92000, source: "relevé annuel 2025", le: "2026-02-12" } });
  assert.deepEqual([c.prets_infos, c.donations, c.avis_impot], [{}, [], {}], "les autres clés ne bougent pas");
  c = await ok({ prets_infos: { ["credit:" + CREDIT_A]: { date_signature: "2020-04-30", duree_mois: 240, taux_pct: 1.85, source: "offre de prêt" } } });
  assert.equal(c.prets_infos["credit:" + CREDIT_A].duree_mois, 240);
  c = await ok({ donations: [DON] });
  assert.deepEqual(c.donations, [DON]);
  c = await ok({ avis_impot: { annee_revenus: ANNEE - 1, rfr: 31000, source: "avis d'impôt", le: "2026-02-12" } });
  assert.equal(c.avis_impot.annee_revenus, ANNEE - 1);
  await remise();
  c = await ok({ cushion: { mode: "amount", min: 5000, max: 8000 }, ...env("PEA Exemple", {}), prets_infos: { ["bien:" + BIEN_A]: { date_fin: "2046-01-31", source: "offre de prêt" } },
    donations: [DON], avis_impot: { annee_revenus: ANNEE - 1, plafonds_per: { p1: [{ annee: ANNEE, montant: 1234 }] }, source: "avis d'impôt" } });
  assert.deepEqual(c.cushion, { mode: "amount", min: 5000, max: 8000 });
  assert.ok(c.enveloppes_infos["PEA Exemple"] && c.prets_infos["bien:" + BIEN_A] && c.donations.length === 1 && c.avis_impot.plafonds_per.p1[0].montant === 1234);
  assert.equal(c.avis_impot.le, AUJ, "le : date du jour à Paris par défaut");
  const ex = await un(`select public.export_all()->'config'->0 c`);
  for (const k of NOUVELLES) assert.ok(k in ex.c, "export_all sort " + k);
});

test("config : liste blanche des clés étendue, anciens messages conservés, anciennes clés inchangées", async () => {
  await remise();
  await refus({ targets: {} }, /^.*réglage « targets » non modifiable par proposition \(cushion, recurring, frais_enveloppes, enveloppes_infos, prets_infos, donations ou avis_impot seulement\)/, "clé inconnue");
  await refus({ enveloppes_infos: {}, rules: [] }, /réglage « rules » non modifiable/, "clé inconnue à côté d'une bonne");
  await refus({}, /cushion ou recurring attendu \(ou frais_enveloppes, enveloppes_infos, prets_infos, donations ou avis_impot\)/, "objet vide");
  const c = await ok({ cushion: { mode: "months", months: 3, depenses: 2500 }, frais_enveloppes: { "Assurance-vie": { gestion_uc_pct: 0.6, source: "Conditions générales", le: "2026-01-15" } } });
  assert.deepEqual(c.cushion, { mode: "months", months: 3, depenses: 2500 });
  assert.deepEqual(c.frais_enveloppes, { "Assurance-vie": { gestion_uc_pct: 0.6, source: "Conditions générales", le: "2026-01-15" } });
  await refus({ frais_enveloppes: { "Assurance-vie": { gestion_uc_pct: 0.6, source: "CG", le: DEMAIN } } }, /dans le futur/, "frais_enveloppes.le futur toujours refusé (0027)");
  await refus({ cushion: { mode: "weeks" } }, /cushion\.mode « weeks » inconnu/, "cushion invalide");
  // opération autre que modifier : refusée par la table (0019), inchangé
  await assert.rejects(db.query(`insert into public.propositions (cible, operation, apres, source) values ('config', 'creer', '{"donations":[]}', 'x')`), /violates check constraint/);
});

test("enveloppes_infos : champ inconnu, type, titulaire, valeur non objet, nom d'enveloppe", async () => {
  await remise();
  await refus(env("PEA Exemple", { couleur: "bleu" }), /^.*enveloppes_infos « PEA Exemple » : champ « couleur » inconnu \(type, titulaire,/, "champ inconnu");
  await refus(env("PEA Exemple", { type: "pea2" }), /enveloppes_infos « PEA Exemple » : type invalide \(pea, pea_pme/, "type inconnu");
  await refus(env("PEA Exemple", { type: undefined }), /type invalide/, "type absent");
  await refus(env("PEA Exemple", { type: 5 }), /type invalide/, "type non texte");
  await refus(env("PEA Exemple", { titulaire: "p3" }), /enveloppes_infos « PEA Exemple » : titulaire invalide \(p1 ou p2 attendu\)/, "titulaire hors p1/p2");
  await refus(env("PEA Exemple", { titulaire: undefined }), /titulaire invalide/, "titulaire absent");
  await refus({ enveloppes_infos: { "PEA Exemple": "x" } }, /enveloppes_infos « PEA Exemple » : objet ou null attendu/, "valeur non objet");
  await refus({ enveloppes_infos: [] }, /enveloppes_infos : objet \{ enveloppe: informations \} attendu/, "liste au lieu d'un objet");
  await refus({ enveloppes_infos: { "": PEA } }, /enveloppes_infos : nom d'enveloppe invalide \(1 à 80 caractères\)/, "nom vide");
  await refus({ enveloppes_infos: { "|p1": PEA } }, /nom d'enveloppe invalide/, "clé réduite au suffixe");
  await refus({ enveloppes_infos: { ["N".repeat(81)]: PEA } }, /nom d'enveloppe invalide/, "nom de 81 caractères");
  const c = await ok({ enveloppes_infos: { ["N".repeat(80)]: PEA } });
  assert.ok(("N".repeat(80)) in c.enveloppes_infos, "80 caractères acceptés");
  const c2 = await ok({ enveloppes_infos: { ["N".repeat(80) + "|p1"]: PEA } });
  assert.ok(("N".repeat(80) + "|p1") in c2.enveloppes_infos, "80 caractères + suffixe acceptés");
  for (const t of ["pea", "pea_pme", "pea_jeune", "assurance_vie", "capitalisation", "per", "pel", "cel", "pee", "percol", "compte_titres", "livret_a", "ldds", "lep", "autre"])
    await ok({ enveloppes_infos: { ["Enveloppe " + t]: { type: t, titulaire: "p2", source: "déclaration de l'utilisateur" } } });
});

test("enveloppes_infos : clé « nom|p2 » acceptée seulement si titulaire = p2", async () => {
  await remise();
  await refus(env("PEA Exemple|p2", { titulaire: "p1" }), /enveloppes_infos « PEA Exemple\|p2 » : la clé se termine par \|p2 mais le titulaire est p1/, "|p2 avec p1");
  await refus(env("PEA Exemple|p1", { titulaire: "p2" }), /la clé se termine par \|p1 mais le titulaire est p2/, "|p1 avec p2");
  const c = await ok({ enveloppes_infos: { "PEA Exemple|p1": PEA, "PEA Exemple|p2": { ...PEA, titulaire: "p2", date_ouverture: "2018-03-01" } } });
  assert.deepEqual(Object.keys(c.enveloppes_infos).sort(), ["PEA Exemple|p1", "PEA Exemple|p2"]);
  assert.equal(c.enveloppes_infos["PEA Exemple|p2"].titulaire, "p2");
  const c2 = await ok({ enveloppes_infos: { "Livret Exemple": { type: "livret_a", titulaire: "p2", source: "déclaration de l'utilisateur" } } });
  assert.equal(c2.enveloppes_infos["Livret Exemple"].titulaire, "p2", "une clé sans suffixe peut porter p2");
});

test("enveloppes_infos : dates réelles, jamais dans le futur (date de Paris), à partir de 1950", async () => {
  await remise();
  for (const champ of ["date_ouverture", "date_cloture", "beneficiaires_revus_le"]) {
    await refus(env("PEA Exemple", { [champ]: "2026-02-30" }), new RegExp(`enveloppes_infos « PEA Exemple » : ${champ} invalide \\(AAAA-MM-JJ\\)`), champ + " : 30 février");
    await refus(env("PEA Exemple", { [champ]: "2026-13-01" }), /invalide \(AAAA-MM-JJ\)/, champ + " : mois 13");
    await refus(env("PEA Exemple", { [champ]: "15/06/2021" }), /invalide \(AAAA-MM-JJ\)/, champ + " : format français");
    await refus(env("PEA Exemple", { [champ]: 20210615 }), /invalide \(AAAA-MM-JJ\)/, champ + " : nombre");
    await refus(env("PEA Exemple", { [champ]: "2021-06-15T10:00:00" }), /invalide \(AAAA-MM-JJ\)/, champ + " : horodatage");
    await refus(env("PEA Exemple", { [champ]: DEMAIN, ...(champ === "date_cloture" ? { date_ouverture: "2021-06-15" } : {}) }), new RegExp(`${champ} dans le futur`), champ + " : demain");
    await refus(env("PEA Exemple", { [champ]: "1949-12-31" }), new RegExp(`${champ} antérieure à 1950`), champ + " : avant 1950");
  }
  let c = await ok(env("PEA Exemple", { date_ouverture: "1950-01-01", date_cloture: AUJ, beneficiaires_revus_le: AUJ }));
  assert.deepEqual([c.enveloppes_infos["PEA Exemple"].date_ouverture, c.enveloppes_infos["PEA Exemple"].date_cloture], ["1950-01-01", AUJ], "1950-01-01 et aujourd'hui acceptés");
  c = await ok(env("PEA Exemple", { date_ouverture: "2024-02-29" }));
  assert.equal(c.enveloppes_infos["PEA Exemple"].date_ouverture, "2024-02-29", "29 février d'une année bissextile");
  await refus(env("PEA Exemple", { date_ouverture: "2023-02-29" }), /date_ouverture invalide/, "29 février d'une année non bissextile");
  await refus(env("PEA Exemple", { le: DEMAIN }), /enveloppes_infos « PEA Exemple » : date \(le\) dans le futur/, "le demain");
  await refus(env("PEA Exemple", { le: "2026-02-30" }), /date \(le\) invalide \(AAAA-MM-JJ\)/, "le impossible");
  await refus(env("PEA Exemple", { le: "hier" }), /date \(le\) invalide/, "le texte");
  c = await ok(env("PEA Exemple", { le: undefined }));
  assert.equal(c.enveloppes_infos["PEA Exemple"].le, AUJ, "le par défaut : date du jour à Paris");
  c = await ok(env("PEA Exemple", { le: null }));
  assert.equal(c.enveloppes_infos["PEA Exemple"].le, AUJ, "le null : date du jour");
  c = await ok(env("PEA Exemple", { le: HIER }));
  assert.equal(c.enveloppes_infos["PEA Exemple"].le, HIER);
  // une date corrigée à la validation (p_modifications) est contrôlée aussi : seule la base voit la valeur finale
  const id = await proposer(env("PEA Exemple", {}));
  await assert.rejects(appliquer([id], { [id]: env("PEA Exemple", { date_ouverture: DEMAIN }) }), /date_ouverture dans le futur/, "corrigée vers le futur : refusée");
  assert.equal(await appliquer([id], { [id]: env("PEA Exemple", { date_ouverture: "2021-07-01" }) }), 1, "corrigée vers une date valide : appliquée");
});

test("enveloppes_infos : date_ouverture_approx (AAAA ou AAAA-MM) exclusive de date_ouverture ; date_cloture >= date_ouverture", async () => {
  await remise();
  const sans = { date_ouverture: undefined };
  await refus(env("PEA Exemple", { date_ouverture_approx: "2019" }), /enveloppes_infos « PEA Exemple » : date_ouverture et date_ouverture_approx ne vont pas ensemble/, "les deux ensemble");
  for (const v of ["2019-13", "19", "2019-1", "2019-02-03", "2019/06", 2019, "juin 2019"])
    await refus(env("PEA Exemple", { ...sans, date_ouverture_approx: v }), /date_ouverture_approx invalide \(AAAA ou AAAA-MM\)/, "approx " + JSON.stringify(v));
  await refus(env("PEA Exemple", { ...sans, date_ouverture_approx: String(ANNEE + 1) }), /date_ouverture_approx dans le futur/, "année suivante");
  await refus(env("PEA Exemple", { ...sans, date_ouverture_approx: "1949" }), /date_ouverture_approx antérieure à 1950/, "avant 1950");
  const moisSuivant = (await un(`select to_char(date_trunc('month', (now() at time zone 'Europe/Paris')::date) + interval '1 month', 'YYYY-MM') m`)).m;
  await refus(env("PEA Exemple", { ...sans, date_ouverture_approx: moisSuivant }), /date_ouverture_approx dans le futur/, "mois suivant");
  let c = await ok(env("PEA Exemple", { ...sans, date_ouverture_approx: "2019" }));
  assert.deepEqual([c.enveloppes_infos["PEA Exemple"].date_ouverture_approx, "date_ouverture" in c.enveloppes_infos["PEA Exemple"]], ["2019", false]);
  c = await ok(env("PEA Exemple", { ...sans, date_ouverture_approx: "2019-06" }));
  assert.equal(c.enveloppes_infos["PEA Exemple"].date_ouverture_approx, "2019-06");
  c = await ok(env("PEA Exemple", { ...sans, date_ouverture_approx: AUJ.slice(0, 7) }));
  assert.equal(c.enveloppes_infos["PEA Exemple"].date_ouverture_approx, AUJ.slice(0, 7), "le mois en cours est accepté");
  c = await ok(env("PEA Exemple", { date_ouverture_approx: null }));
  assert.ok(!("date_ouverture_approx" in c.enveloppes_infos["PEA Exemple"]) && c.enveloppes_infos["PEA Exemple"].date_ouverture === "2021-06-15", "approx null : ignoré");
  await refus(env("PEA Exemple", { date_cloture: "2021-06-14" }), /enveloppes_infos « PEA Exemple » : date_cloture avant date_ouverture/, "clôture avant l'ouverture");
  c = await ok(env("PEA Exemple", { date_cloture: "2021-06-15" }));
  assert.equal(c.enveloppes_infos["PEA Exemple"].date_cloture, "2021-06-15", "clôture le jour de l'ouverture : acceptée");
  c = await ok(env("PEA Exemple", { date_ouverture: undefined, date_cloture: "2020-01-01" }));
  assert.equal(c.enveloppes_infos["PEA Exemple"].date_cloture, "2020-01-01", "clôture sans date d'ouverture : acceptée");
});

test("enveloppes_infos : montants positifs ou nuls et numériques ; versements_avant_70 <= versements_cumules", async () => {
  await remise();
  for (const champ of ["versements_cumules", "versements_avant_70"]) {
    for (const v of [-1, "abc", "-5", true, [1], { a: 1 }, "NaN", "Infinity"])
      await refus(env("PEA Exemple", { type: "assurance_vie", [champ]: v }), new RegExp(`enveloppes_infos « PEA Exemple » : ${champ} invalide \\(montant positif ou nul attendu\\)`), champ + " = " + JSON.stringify(v));
  }
  await refus(env("PEA Exemple", { type: "assurance_vie", versements_cumules: 1000, versements_avant_70: 1000.01 }), /versements_avant_70 supérieur à versements_cumules/, "avant 70 ans > cumulés");
  const c = await ok(env("PEA Exemple", { type: "assurance_vie", versements_cumules: 1234, versements_avant_70: 1234 }));
  assert.deepEqual([c.enveloppes_infos["PEA Exemple"].versements_cumules, c.enveloppes_infos["PEA Exemple"].versements_avant_70], [1234, 1234], "égalité acceptée");
  const c0 = await ok(env("PEA Exemple", { versements_cumules: 0, versements_avant_70: 0 }));
  assert.equal(c0.enveloppes_infos["PEA Exemple"].versements_cumules, 0, "zéro accepté");
  const c1 = await ok(env("PEA Exemple", { versements_cumules: "1234.5" }));
  assert.equal(c1.enveloppes_infos["PEA Exemple"].versements_cumules, 1234.5, "nombre écrit en texte : accepté et stocké en nombre");
  const c2 = await ok(env("PEA Exemple", { type: "assurance_vie", versements_avant_70: 500 }));
  assert.equal(c2.enveloppes_infos["PEA Exemple"].versements_avant_70, 500, "avant 70 ans seul : accepté (rien à comparer)");
});

test("enveloppes_infos : versements seulement pee / percol (120 au plus), moins_values seulement compte_titres (15 au plus)", async () => {
  await remise();
  const V = [{ le: "2021-03-01", montant: 1200, origine: "versement", disponible_le: "2026-03-02" }, { le: "2021-03-15", montant: 300, origine: "abondement" }];
  await refus(env("PEA Exemple", { versements: V }), /enveloppes_infos « PEA Exemple » : versements réservés aux types pee et percol/, "versements sur un PEA");
  await refus(env("PEE Exemple", { type: "assurance_vie", versements: V }), /versements réservés aux types pee et percol/, "versements sur une assurance-vie");
  const MV = [{ annee: 2017, montant: 1234 }];
  await refus(env("PEA Exemple", { moins_values: MV }), /enveloppes_infos « PEA Exemple » : moins_values réservées au type compte_titres/, "moins-values sur un PEA");
  for (const t of ["pee", "percol"]) {
    const c = await ok(env("PEE Exemple", { type: t, versements: V }));
    assert.deepEqual(c.enveloppes_infos["PEE Exemple"].versements, V, t + " : versements acceptés et conservés");
  }
  const c = await ok(env("CTO Exemple", { type: "compte_titres", moins_values: MV }));
  assert.deepEqual(c.enveloppes_infos["CTO Exemple"].moins_values, MV);
  const cv = await ok(env("PEE Exemple", { type: "pee", versements: [] }));
  assert.ok(!("versements" in cv.enveloppes_infos["PEE Exemple"]), "liste vide : rien n'est gardé");
  const un120 = i => ({ le: "2021-01-01", montant: 10 + i, origine: "versement" });
  await refus(env("PEE Exemple", { type: "pee", versements: Array.from({ length: 121 }, (_, i) => un120(i)) }), /versements : 120 au plus/, "121 versements");
  const c120 = await ok(env("PEE Exemple", { type: "pee", versements: Array.from({ length: 120 }, (_, i) => un120(i)) }));
  assert.equal(c120.enveloppes_infos["PEE Exemple"].versements.length, 120, "120 acceptés");
  const P = { type: "pee" };
  await refus(env("PEE Exemple", { ...P, versements: "x" }), /versements : liste attendue/, "versements non liste");
  await refus(env("PEE Exemple", { ...P, versements: ["x"] }), /versement 1 : objet attendu/, "versement non objet");
  await refus(env("PEE Exemple", { ...P, versements: [{ ...V[0], couleur: 1 }] }), /versement 1 : champ « couleur » inconnu \(le, montant, origine, disponible_le\)/, "champ inconnu");
  await refus(env("PEE Exemple", { ...P, versements: [V[1], { ...V[0], le: DEMAIN }] }), /versement 2 : date \(le\) dans le futur/, "versement futur");
  await refus(env("PEE Exemple", { ...P, versements: [{ ...V[0], le: "2021-02-30" }] }), /versement 1 : date \(le\) invalide/, "versement impossible");
  await refus(env("PEE Exemple", { ...P, versements: [{ ...V[0], le: "1949-01-01", disponible_le: undefined }] }), /versement 1 : date \(le\) antérieure à 1950/, "versement avant 1950");
  await refus(env("PEE Exemple", { ...P, versements: [{ le: "2021-03-01", origine: "versement" }] }), /versement 1 : montant invalide/, "montant absent");
  await refus(env("PEE Exemple", { ...P, versements: [{ ...V[0], montant: -3 }] }), /versement 1 : montant invalide/, "montant négatif");
  await refus(env("PEE Exemple", { ...P, versements: [{ ...V[0], origine: "prime" }] }), /versement 1 : origine invalide \(versement, abondement, participation ou interessement attendu\)/, "origine hors liste");
  await refus(env("PEE Exemple", { ...P, versements: [{ le: "2021-03-01", montant: 5 }] }), /versement 1 : origine invalide/, "origine absente");
  await refus(env("PEE Exemple", { ...P, versements: [{ ...V[0], disponible_le: "2021-02-28" }] }), /versement 1 : disponible_le avant la date du versement/, "disponible avant le versement");
  await refus(env("PEE Exemple", { ...P, versements: [{ ...V[0], disponible_le: "2026-02-30" }] }), /versement 1 : disponible_le invalide/, "disponible_le impossible");
  const ok2 = await ok(env("PEE Exemple", { ...P, versements: [{ ...V[0], disponible_le: "2021-03-01" }, { le: "2021-04-01", montant: 0, origine: "interessement" }, { le: "2021-05-01", montant: 50, origine: "participation", disponible_le: null }] }));
  assert.deepEqual(ok2.enveloppes_infos["PEE Exemple"].versements[2], { le: "2021-05-01", montant: 50, origine: "participation" }, "disponible_le null : retiré ; disponible le jour même : accepté");
  // moins-values
  const T = { type: "compte_titres" };
  await refus(env("CTO Exemple", { ...T, moins_values: Array.from({ length: 16 }, (_, i) => ({ annee: 2000 + i, montant: 10 })) }), /moins_values : 15 au plus/, "16 moins-values");
  const c15 = await ok(env("CTO Exemple", { ...T, moins_values: Array.from({ length: 15 }, (_, i) => ({ annee: 2010 + i % 10, montant: 10 + i })) }));
  assert.equal(c15.enveloppes_infos["CTO Exemple"].moins_values.length, 15, "15 acceptées");
  await refus(env("CTO Exemple", { ...T, moins_values: "x" }), /moins_values : liste attendue/, "moins-values non liste");
  await refus(env("CTO Exemple", { ...T, moins_values: [1] }), /moins-value 1 : objet attendu/, "moins-value non objet");
  await refus(env("CTO Exemple", { ...T, moins_values: [{ annee: 2017, montant: 5, note: "x" }] }), /moins-value 1 : champ « note » inconnu \(annee, montant\)/, "champ inconnu");
  await refus(env("CTO Exemple", { ...T, moins_values: [{ annee: 1999, montant: 5 }] }), /moins-value 1 : annee invalide/, "année 1999");
  await refus(env("CTO Exemple", { ...T, moins_values: [{ annee: ANNEE + 1, montant: 5 }] }), /moins-value 1 : annee invalide/, "année suivante");
  await refus(env("CTO Exemple", { ...T, moins_values: [{ annee: 2017.5, montant: 5 }] }), /moins-value 1 : annee invalide/, "année décimale");
  await refus(env("CTO Exemple", { ...T, moins_values: [{ annee: "dix-sept", montant: 5 }] }), /moins-value 1 : annee invalide/, "année texte");
  await refus(env("CTO Exemple", { ...T, moins_values: [{ annee: 2017, montant: 0 }] }), /moins-value 1 : montant invalide \(montant strictement positif attendu\)/, "montant nul");
  await refus(env("CTO Exemple", { ...T, moins_values: [{ annee: 2017, montant: -5 }] }), /moins-value 1 : montant invalide/, "montant négatif");
  const cb = await ok(env("CTO Exemple", { ...T, moins_values: [{ annee: 2000, montant: 1 }, { annee: ANNEE, montant: 2 }] }));
  assert.deepEqual(cb.enveloppes_infos["CTO Exemple"].moins_values.map(m => m.annee), [2000, ANNEE], "bornes 2000 et année en cours acceptées");
});

test("enveloppes_infos : source obligatoire (1 à 300 caractères), fusion par clé, null retire, 30 enveloppes au plus avant et après fusion", async () => {
  await remise();
  await refus(env("PEA Exemple", { source: undefined }), /enveloppes_infos « PEA Exemple » : source obligatoire \(1 à 300 caractères\)/, "source absente");
  await refus(env("PEA Exemple", { source: "" }), /source obligatoire/, "source vide");
  await refus(env("PEA Exemple", { source: "   " }), /source obligatoire/, "source en espaces");
  await refus(env("PEA Exemple", { source: 12 }), /source obligatoire/, "source numérique");
  await refus(env("PEA Exemple", { source: "s".repeat(301) }), /source obligatoire/, "source de 301 caractères");
  let c = await ok(env("PEA Exemple", { source: "  " + "s".repeat(300) + "  " }));
  assert.equal(c.enveloppes_infos["PEA Exemple"].source, "s".repeat(300), "300 caractères acceptés, espaces retirés");
  // fusion : une enveloppe fournie remplace l'existante en entier ; les autres restent ; null retire
  await remise();
  await ok({ enveloppes_infos: { "PEA Exemple": PEA, "AV Exemple": { type: "assurance_vie", titulaire: "p1", date_ouverture: "2018-03-01", source: "conditions particulières" } } });
  c = await ok({ enveloppes_infos: { "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture_approx: "2021", source: "déclaration de l'utilisateur" } } });
  assert.deepEqual(Object.keys(c.enveloppes_infos).sort(), ["AV Exemple", "PEA Exemple"]);
  assert.deepEqual(Object.keys(c.enveloppes_infos["PEA Exemple"]).sort(), ["date_ouverture_approx", "le", "source", "titulaire", "type"], "remplacée en entier (plus de date_ouverture ni de versements_cumules)");
  c = await ok({ enveloppes_infos: { "AV Exemple": null } });
  assert.deepEqual(Object.keys(c.enveloppes_infos), ["PEA Exemple"], "null retire");
  c = await ok({ enveloppes_infos: { "Inconnue": null } });
  assert.deepEqual(Object.keys(c.enveloppes_infos), ["PEA Exemple"], "retirer une clé absente : sans effet");
  // 30 au plus
  await remise();
  const n = (de, a) => Object.fromEntries(Array.from({ length: a - de }, (_, i) => ["Enveloppe " + (de + i), { type: "autre", titulaire: "p1", source: "déclaration de l'utilisateur" }]));
  await refus({ enveloppes_infos: n(0, 31) }, /enveloppes_infos : 30 enveloppes au plus\.$/, "31 dans une proposition");
  c = await ok({ enveloppes_infos: n(0, 30) });
  assert.equal(Object.keys(c.enveloppes_infos).length, 30, "30 acceptées");
  await refus({ enveloppes_infos: n(30, 31) }, /enveloppes_infos : 30 enveloppes au plus \(31 après fusion\)/, "31 après fusion");
  c = await ok({ enveloppes_infos: { ...n(30, 31), "Enveloppe 0": null } });
  assert.equal(Object.keys(c.enveloppes_infos).length, 30, "un retrait dans la même proposition libère la place");
});

/* ---------- prets_infos ---------- */
test("prets_infos : clé d'un crédit ou d'un bien de l'utilisateur ; celle d'un autre est refusée comme une ligne inexistante", async () => {
  await remise();
  const PRET = { date_signature: "2020-04-30", date_fin: "2040-04-30", duree_mois: 240, taux_pct: 1.85, assurance_taux_pct: 0.3, ira_exoneration: true, source: "offre de prêt", le: "2026-02-12" };
  let c = await ok({ prets_infos: { ["credit:" + CREDIT_A]: PRET, ["bien:" + BIEN_A]: { date_fin: "2046-01-31", source: "tableau d'amortissement" } } });
  assert.deepEqual(c.prets_infos["credit:" + CREDIT_A], PRET);
  assert.deepEqual(Object.keys(c.prets_infos["bien:" + BIEN_A]).sort(), ["date_fin", "le", "source"]);
  // le crédit de B, un bien ou un crédit inexistant : même message
  const msg = async cle => {
    const id = await proposer({ prets_infos: { [cle]: PRET } });
    try { await appliquer([id]); } catch (e) { return e.message.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, "<uuid>"); }
    assert.fail("accepté : " + cle);
  };
  const mB = await msg("credit:" + CREDIT_B), mX = await msg("credit:" + INCONNU);
  assert.equal(mB, mX, "crédit d'un autre utilisateur = crédit inexistant (même message)");
  assert.match(mB, /^Proposition non appliquée \(réglages, modifier\) : prets_infos « credit:<uuid> » : crédit introuvable\.$/);
  assert.equal(await msg("bien:" + CREDIT_B), (await msg("bien:" + INCONNU)), "bien d'un autre utilisateur = bien inexistant");
  assert.match(await msg("bien:" + INCONNU), /bien introuvable/);
  assert.match(await msg("credit:" + BIEN_A), /crédit introuvable/, "l'identifiant d'un bien sous la clé credit: : introuvable");
  assert.match(await msg("bien:" + CREDIT_A), /bien introuvable/, "l'identifiant d'un crédit sous la clé bien: : introuvable");
  await refus({ prets_infos: { "pret:1234": PRET } }, /prets_infos : clé « pret:1234 » invalide \(credit:<identifiant> ou bien:<identifiant> attendu\)/, "préfixe inconnu");
  await refus({ prets_infos: { "credit:pas-un-uuid": PRET } }, /clé « credit:pas-un-uuid » invalide/, "pas un uuid");
  await refus({ prets_infos: [] }, /prets_infos : objet \{ prêt: informations \} attendu/, "liste au lieu d'un objet");
  await refus({ prets_infos: { ["credit:" + CREDIT_A]: "x" } }, /objet ou null attendu/, "valeur non objet");
  // la casse de l'identifiant est normalisée en minuscules
  await remise();
  c = await ok({ prets_infos: { ["credit:" + CREDIT_A.toUpperCase()]: { date_fin: "2040-04-30", source: "offre de prêt" } } });
  assert.deepEqual(Object.keys(c.prets_infos), ["credit:" + CREDIT_A]);
  // B ne peut pas écrire sur le crédit de A, A ne voit pas celui de B
  await comme(db, B);
  const idB = await proposer({ prets_infos: { ["credit:" + CREDIT_A]: PRET } });
  await assert.rejects(appliquer([idB]), /crédit introuvable/);
  assert.equal((await ok({ prets_infos: { ["credit:" + CREDIT_B]: PRET } })).prets_infos["credit:" + CREDIT_B].taux_pct, 1.85, "B écrit sur le sien");
  await remise(B);
});

test("prets_infos : dates, durée 1 à 480, taux 0 à 20, assurance 0 à 5, ira_exoneration booléen, au moins un champ, source, null, 50 au plus", async () => {
  await remise();
  const K = "credit:" + CREDIT_A, P = o => ({ prets_infos: { [K]: { source: "offre de prêt", ...o } } });
  const E = "prets_infos « " + K + " » : ";
  await refus(P({ couleur: 1, duree_mois: 12 }), new RegExp(E + "champ « couleur » inconnu"), "champ inconnu");
  await refus(P({}), new RegExp(E + "au moins une information attendue"), "aucun champ");
  await refus({ prets_infos: { [K]: { le: "2026-01-01", source: "offre de prêt" } } }, /au moins une information attendue/, "seulement source et le");
  await refus(P({ date_signature: "2020-02-30" }), new RegExp(E + "date_signature invalide \\(AAAA-MM-JJ\\)"), "date_signature impossible");
  await refus(P({ date_fin: "30/04/2040" }), new RegExp(E + "date_fin invalide"), "date_fin au format français");
  await refus(P({ date_signature: DEMAIN }), new RegExp(E + "date_signature dans le futur"), "signature demain");
  await refus(P({ date_signature: "1949-01-01" }), /date_signature antérieure à 1950/, "signature avant 1950");
  await refus(P({ date_signature: "2020-04-30", date_fin: "2020-04-30" }), new RegExp(E + "date_fin à placer après date_signature"), "date_fin = date_signature");
  await refus(P({ date_signature: "2020-04-30", date_fin: "2020-04-29" }), /date_fin à placer après date_signature/, "date_fin avant");
  let c = await ok(P({ date_signature: "2020-04-30", date_fin: "2020-05-01" }));
  assert.equal(c.prets_infos[K].date_fin, "2020-05-01", "date_fin le lendemain : acceptée");
  c = await ok(P({ date_fin: "2090-01-01" }));
  assert.equal(c.prets_infos[K].date_fin, "2090-01-01", "date_fin dans le futur : normale");
  for (const v of [0, 481, 12.5, -3, "abc", true]) await refus(P({ duree_mois: v }), new RegExp(E + "duree_mois invalide \\(entier de 1 à 480 attendu\\)"), "duree_mois " + JSON.stringify(v));
  for (const v of [1, 480]) assert.equal((await ok(P({ duree_mois: v }))).prets_infos[K].duree_mois, v);
  for (const v of [-0.1, 20.01, "x", 100]) await refus(P({ taux_pct: v }), new RegExp(E + "taux_pct invalide \\(pourcentage par an entre 0 et 20 attendu\\)"), "taux_pct " + JSON.stringify(v));
  for (const v of [0, 20, 3.45]) assert.equal((await ok(P({ taux_pct: v }))).prets_infos[K].taux_pct, v);
  for (const v of [-1, 5.01, "x"]) await refus(P({ assurance_taux_pct: v }), new RegExp(E + "assurance_taux_pct invalide \\(pourcentage par an entre 0 et 5 attendu\\)"), "assurance_taux_pct " + JSON.stringify(v));
  for (const v of [0, 5, 0.34]) assert.equal((await ok(P({ assurance_taux_pct: v }))).prets_infos[K].assurance_taux_pct, v);
  for (const v of ["oui", 1, "true"]) await refus(P({ ira_exoneration: v }), new RegExp(E + "ira_exoneration invalide \\(true ou false attendu\\)"), "ira_exoneration " + JSON.stringify(v));
  assert.equal((await ok(P({ ira_exoneration: false }))).prets_infos[K].ira_exoneration, false, "false est une information");
  await refus(P({ duree_mois: 12, source: undefined }), new RegExp(E + "source obligatoire \\(1 à 300 caractères\\)"), "source absente");
  await refus(P({ duree_mois: 12, source: "s".repeat(301) }), /source obligatoire/, "source de 301 caractères");
  await refus(P({ duree_mois: 12, le: DEMAIN }), new RegExp(E + "date \\(le\\) dans le futur"), "le demain");
  c = await ok(P({ duree_mois: 12 }));
  assert.equal(c.prets_infos[K].le, AUJ, "le par défaut : date du jour à Paris");
  // null retire, y compris quand la ligne n'existe plus (information orpheline)
  await superu();
  await db.query(`insert into public.credits (id, user_id, nom) values ('aaaaaaaa-0000-4000-8000-000000000003', '${A}', 'À supprimer')`);
  await comme(db, A);
  const K3 = "credit:aaaaaaaa-0000-4000-8000-000000000003";
  c = await ok({ prets_infos: { [K3]: { duree_mois: 60, source: "offre de prêt" } } });
  assert.ok(K3 in c.prets_infos);
  await superu(); await db.query(`delete from public.credits where id = 'aaaaaaaa-0000-4000-8000-000000000003'`); await comme(db, A);
  c = await ok({ prets_infos: { [K3]: null } });
  assert.ok(!(K3 in c.prets_infos) && K in c.prets_infos, "orpheline retirée, l'autre garde sa place");
  // 50 au plus
  const cinquante = n => Object.fromEntries(Array.from({ length: n }, (_, i) => ["bien:" + INCONNU.slice(0, -2) + String(10 + i), { duree_mois: 12, source: "offre de prêt" }]));
  await refus({ prets_infos: cinquante(51) }, /prets_infos : 50 prêts au plus\.$/, "51 prêts");
});

/* ---------- donations ---------- */
test("donations : la liste remplace la liste ; 100 au plus ; id uniques ; listes fermées ; dates et montants", async () => {
  await remise();
  const D = o => ({ donations: [{ ...DON, ...o }] });
  let c = await ok({ donations: [DON, { ...DON, id: "d2", beneficiaire: "Enfant 2", montant: 31865, nature: "don_argent_790g", date: "2023-05-04" }] });
  assert.deepEqual(c.donations.map(d => d.id), ["d1", "d2"]);
  c = await ok({ donations: [{ ...DON, id: "d3", lien: "petit_enfant", nature: "don_logement_790a_bis", date: "2025-06-01" }] });
  assert.deepEqual(c.donations.map(d => d.id), ["d3"], "la liste fournie remplace la liste");
  c = await ok({ donations: [] });
  assert.deepEqual(c.donations, [], "liste vide : efface");
  await refus({ donations: {} }, /donations : liste de donations attendue/, "objet au lieu d'une liste");
  await refus({ donations: "x" }, /donations : liste de donations attendue/, "texte");
  await refus({ donations: [1] }, /donation 1 : objet attendu/, "élément non objet");
  await refus({ donations: [DON, { ...DON }] }, /donation 2 : identifiant « d1 » en double/, "id en double");
  await refus(D({ id: undefined }), /donation 1 : identifiant \(id\) manquant ou trop long/, "id absent");
  await refus(D({ id: "" }), /identifiant \(id\) manquant/, "id vide");
  await refus(D({ id: "i".repeat(65) }), /identifiant \(id\) manquant ou trop long/, "id de 65 caractères");
  assert.equal((await ok(D({ id: "i".repeat(64) }))).donations[0].id.length, 64, "id de 64 caractères accepté");
  await refus(D({ couleur: 1 }), /donations « d1 » : champ « couleur » inconnu \(id, date, montant, donateur, lien, beneficiaire, nature, source, le\)/, "champ inconnu");
  await refus(D({ date: "2015-02-30" }), /donations « d1 » : date invalide \(AAAA-MM-JJ\)/, "date impossible");
  await refus(D({ date: "01/07/2015" }), /donations « d1 » : date invalide/, "date au format français");
  await refus(D({ date: DEMAIN }), /donations « d1 » : date dans le futur/, "donation demain");
  assert.equal((await ok(D({ date: AUJ }))).donations[0].date, AUJ, "donation aujourd'hui acceptée");
  for (const v of [0, -5, "abc", undefined, null]) await refus(D({ montant: v }), /donations « d1 » : montant invalide \(montant strictement positif attendu\)/, "montant " + JSON.stringify(v));
  await refus(D({ donateur: "p3" }), /donations « d1 » : donateur invalide \(p1 ou p2 attendu\)/, "donateur");
  await refus(D({ lien: "neveu" }), /donations « d1 » : lien invalide \(enfant, petit_enfant, arriere_petit_enfant ou autre attendu\)/, "lien");
  await refus(D({ nature: "vente" }), /donations « d1 » : nature invalide \(donation, don_argent_790g ou don_logement_790a_bis attendu\)/, "nature");
  await refus(D({ nature: undefined }), /nature invalide/, "nature absente");
  await refus(D({ beneficiaire: "" }), /donations « d1 » : bénéficiaire \(beneficiaire\) obligatoire \(1 à 40 caractères\)/, "bénéficiaire vide");
  await refus(D({ beneficiaire: "b".repeat(41) }), /bénéficiaire \(beneficiaire\) obligatoire/, "bénéficiaire de 41 caractères");
  assert.equal((await ok(D({ beneficiaire: "b".repeat(40) }))).donations[0].beneficiaire.length, 40, "40 caractères acceptés");
  await refus(D({ source: undefined }), /donations « d1 » : source obligatoire \(1 à 300 caractères\)/, "source absente");
  await refus(D({ source: "s".repeat(301) }), /source obligatoire/, "source de 301 caractères");
  await refus(D({ le: DEMAIN }), /donations « d1 » : date \(le\) dans le futur/, "le demain");
  await refus(D({ le: "hier" }), /donations « d1 » : date \(le\) invalide/, "le texte");
  for (const lien of ["enfant", "petit_enfant", "arriere_petit_enfant", "autre"]) assert.equal((await ok(D({ lien }))).donations[0].lien, lien);
  for (const nature of ["donation", "don_argent_790g", "don_logement_790a_bis"]) assert.equal((await ok(D({ nature }))).donations[0].nature, nature);
  c = await ok(D({ le: undefined }));
  assert.equal(c.donations[0].le, AUJ, "le par défaut : date du jour à Paris");
  c = await ok(D({ id: "  d9  ", beneficiaire: "  Enfant 9  ", montant: "1234.5" }));
  assert.deepEqual([c.donations[0].id, c.donations[0].beneficiaire, c.donations[0].montant], ["d9", "Enfant 9", 1234.5], "espaces retirés, montant stocké en nombre");
  const cent = n => Array.from({ length: n }, (_, i) => ({ id: "d" + i, date: "2015-07-01", montant: 1000 + i, donateur: "p1", lien: "enfant", beneficiaire: "E", nature: "donation", source: "s" }));
  await refus({ donations: cent(101) }, /donations : 100 donations au plus/, "101 donations");
  c = await ok({ donations: cent(100) });
  assert.equal(c.donations.length, 100, "100 acceptées");
});

/* ---------- avis_impot ---------- */
test("avis_impot : année des revenus de 2000 à l'année en cours, rfr, plafonds d'épargne retraite, remplacé en entier", async () => {
  await remise();
  const AV = o => ({ avis_impot: { annee_revenus: ANNEE - 1, source: "avis d'impôt", ...o } });
  const PL = { p1: [{ annee: ANNEE - 2, montant: 1234 }, { annee: ANNEE - 1, montant: 4710 }], p2: [{ annee: ANNEE, montant: 2000.5 }] };
  let c = await ok(AV({ rfr: 31000, plafonds_per: PL, le: "2026-02-12" }));
  assert.deepEqual(c.avis_impot, { annee_revenus: ANNEE - 1, rfr: 31000, plafonds_per: PL, source: "avis d'impôt", le: "2026-02-12" });
  c = await ok(AV({ annee_revenus: ANNEE - 2 }));
  assert.deepEqual(Object.keys(c.avis_impot).sort(), ["annee_revenus", "le", "source"], "remplacé en entier (plus de rfr ni de plafonds)");
  c = await ok({ avis_impot: {} });
  assert.deepEqual(c.avis_impot, {}, "objet vide : efface l'avis");
  await refus({ avis_impot: [] }, /avis_impot : objet attendu/, "liste");
  await refus({ avis_impot: null }, /avis_impot : objet attendu/, "null");
  await refus(AV({ couleur: 1 }), /avis_impot : champ « couleur » inconnu \(annee_revenus, rfr, plafonds_per, source, le\)/, "champ inconnu");
  for (const v of [1999, ANNEE + 1, 2024.5, "abc", undefined, null])
    await refus(AV({ annee_revenus: v }), /avis_impot : annee_revenus invalide \(entier de 2000 à l'année en cours attendu\)/, "annee_revenus " + JSON.stringify(v));
  for (const v of [2000, ANNEE]) assert.equal((await ok(AV({ annee_revenus: v }))).avis_impot.annee_revenus, v, "borne " + v);
  for (const v of [-1, "abc", true]) await refus(AV({ rfr: v }), /avis_impot : rfr invalide \(montant positif ou nul attendu\)/, "rfr " + JSON.stringify(v));
  assert.equal((await ok(AV({ rfr: 0 }))).avis_impot.rfr, 0, "rfr nul accepté");
  await refus(AV({ plafonds_per: [] }), /plafonds_per : objet \{ p1, p2 \} attendu/, "plafonds en liste");
  await refus(AV({ plafonds_per: { p3: [] } }), /plafonds_per : personne « p3 » inconnue \(p1 ou p2\)/, "personne inconnue");
  await refus(AV({ plafonds_per: { p1: {} } }), /plafonds_per\.p1 : liste attendue/, "plafonds d'une personne en objet");
  await refus(AV({ plafonds_per: { p1: [1] } }), /plafonds_per\.p1 : ligne 1 : objet attendu/, "ligne non objet");
  await refus(AV({ plafonds_per: { p1: [{ annee: ANNEE, montant: 5, note: "x" }] } }), /plafonds_per\.p1 : ligne 1 : champ « note » inconnu \(annee, montant\)/, "champ inconnu d'une ligne");
  for (const v of [1999, ANNEE + 2, 2024.5, "x", undefined])
    await refus(AV({ plafonds_per: { p2: [{ annee: v, montant: 5 }] } }), /plafonds_per\.p2 : ligne 1 : annee invalide/, "annee de plafond " + JSON.stringify(v));
  for (const v of [0, -4, "x", undefined]) await refus(AV({ plafonds_per: { p1: [{ annee: ANNEE, montant: v }] } }), /plafonds_per\.p1 : ligne 1 : montant invalide \(montant strictement positif attendu\)/, "montant " + JSON.stringify(v));
  await refus(AV({ plafonds_per: { p1: [{ annee: ANNEE, montant: 5 }, { annee: ANNEE, montant: 6 }] } }), new RegExp(`plafonds_per\\.p1 : annee ${ANNEE} en double`), "même année deux fois");
  const lignes = n => Array.from({ length: n }, (_, i) => ({ annee: ANNEE + 1 - i, montant: 100 + i }));
  await refus(AV({ plafonds_per: { p1: lignes(7) } }), /plafonds_per\.p1 : 6 lignes au plus/, "7 lignes pour une personne");
  c = await ok(AV({ plafonds_per: { p1: lignes(6), p2: lignes(6) } }));
  assert.equal(c.avis_impot.plafonds_per.p1.length, 6, "6 lignes par personne acceptées");
  c = await ok(AV({ plafonds_per: { p1: [], p2: null } }));
  assert.ok(!("plafonds_per" in c.avis_impot), "plafonds vides : rien n'est gardé");
  await refus(AV({ source: undefined }), /avis_impot : source obligatoire \(1 à 300 caractères\)/, "source absente");
  await refus(AV({ source: "s".repeat(301) }), /avis_impot : source obligatoire/, "source de 301 caractères");
  await refus(AV({ le: DEMAIN }), /avis_impot : date \(le\) dans le futur/, "le demain");
  await refus(AV({ le: "2026-02-30" }), /avis_impot : date \(le\) invalide/, "le impossible");
  assert.equal((await ok(AV({ le: undefined }))).avis_impot.le, AUJ, "le par défaut : date du jour à Paris");
});

/* ---------- profil : naissance ---------- */
test("profil : personnes.<p1|p2>.naissance en AAAA-MM-JJ ou AAAA-MM, réelle, pas dans le futur, pas avant 1900", async () => {
  await remise();
  const prop = async apres => (await q(`insert into public.propositions (cible, operation, apres, source) values ('profil', 'modifier', $1, 'déclaration de l''utilisateur') returning id`, [JSON.stringify(apres)]))[0].id;
  const naiss = async () => (await un(`select personnes from public.profiles where user_id = auth.uid()`)).personnes;
  const refusN = async (apres, motif, msg) => {
    const id = await prop(apres);
    await assert.rejects(appliquer([id]), e => { assert.match(e.message, /^Proposition non appliquée \(profil, modifier\) : /); assert.match(e.message, motif, msg + " : " + e.message); return true; }, msg);
    assert.equal((await un("select statut from public.propositions where id = $1", [id])).statut, "en_attente");
    await db.query("delete from public.propositions where id = $1", [id]);
  };
  const moisSuivant = (await un(`select to_char(date_trunc('month', (now() at time zone 'Europe/Paris')::date) + interval '1 month', 'YYYY-MM') m`)).m;
  for (const [v, motif, msg] of [["1985-02-30", /personnes\.p1 : naissance invalide \(AAAA-MM-JJ ou AAAA-MM\)/, "30 février"], ["12/03/1985", /naissance invalide/, "format français"],
    ["1985", /naissance invalide/, "année seule"], ["1985-3-12", /naissance invalide/, "mois sur un chiffre"], ["1985-13", /naissance invalide/, "mois 13"], [19850312, /naissance invalide/, "nombre"],
    [true, /naissance invalide/, "booléen"], [DEMAIN, /personnes\.p1 : naissance dans le futur/, "demain"], [moisSuivant, /naissance dans le futur/, "mois suivant"],
    [String(ANNEE + 1) + "-01-01", /naissance dans le futur/, "année suivante"], ["1899-12-31", /personnes\.p1 : naissance antérieure à 1900/, "avant 1900"], ["1899-12", /naissance antérieure à 1900/, "décembre 1899"]])
    await refusN({ personnes: { p1: { naissance: v } } }, motif, msg);
  await refusN({ personnes: { p2: { nom: "Sam", naissance: "1990-02-30" } } }, /personnes\.p2 : naissance invalide/, "p2 aussi contrôlée");
  for (const [v, attendu] of [["1985-03-12", "1985-03-12"], ["1985-03", "1985-03"], ["1900-01-01", "1900-01-01"], [AUJ, AUJ], [AUJ.slice(0, 7), AUJ.slice(0, 7)], ["2000-02-29", "2000-02-29"]]) {
    const id = await prop({ personnes: { p1: { naissance: v } } });
    assert.equal(await appliquer([id]), 1, "accepté : " + v);
    assert.equal((await naiss()).p1.naissance, attendu);
  }
  const id = await prop({ personnes: { p1: { naissance: null } } });
  assert.equal(await appliquer([id]), 1);
  assert.ok(!("naissance" in (await naiss()).p1) && (await naiss()).p1.nom === "Moi", "null retire la naissance, le reste de la personne est gardé");
  // les autres champs et personnes ne changent pas de comportement
  const id2 = await prop({ foyer: { statut: "couple" }, personnes: { p2: { nom: "Sam", naissance: "1988-07-09" } } });
  assert.equal(await appliquer([id2]), 1);
  assert.deepEqual((await naiss()).p2, { nom: "Sam", naissance: "1988-07-09" });
  await refusN({ personnes: { p3: { naissance: "1980-01-01" } } }, /personne « p3 » inconnue \(p1 ou p2\)/, "p3 : message de 0027 conservé");
  // correction à la validation
  const id3 = await prop({ personnes: { p1: { naissance: "1985-03-12" } } });
  await assert.rejects(appliquer([id3], { [id3]: { personnes: { p1: { naissance: DEMAIN } } } }), /naissance dans le futur/, "corrigée vers le futur : refusée");
  await db.query("delete from public.propositions where id = $1", [id3]);
});

/* ---------- tout ou rien, refus, RLS ---------- */
test("tout ou rien : une proposition invalide dans un lot n'applique rien (même les valides)", async () => {
  await remise();
  const bonne = await proposer(env("PEA Exemple", {})), bonne2 = await proposer({ donations: [DON] }), mauvaise = await proposer({ avis_impot: { annee_revenus: 1999, source: "x" } });
  await assert.rejects(appliquer([bonne, bonne2, mauvaise]), /annee_revenus invalide/);
  const c = await cfg();
  assert.deepEqual([c.enveloppes_infos, c.donations, c.avis_impot], [{}, [], {}], "aucune écriture");
  assert.deepEqual((await q(`select statut from public.propositions where id = any($1::uuid[]) order by id`, [[bonne, bonne2, mauvaise]])).map(r => r.statut), ["en_attente", "en_attente", "en_attente"]);
  // la mauvaise écartée, le lot passe
  assert.equal(await appliquer([bonne, bonne2]), 2);
  assert.equal(Object.keys((await cfg()).enveloppes_infos).length, 1);
  // corriger à la validation une proposition valide en invalide fait échouer le lot entier
  await remise();
  const x = await proposer(env("PEA Exemple", {})), y = await proposer({ donations: [DON] });
  await assert.rejects(appliquer([x, y], { [y]: { donations: [{ ...DON, montant: -1 }] } }), /montant invalide/);
  assert.deepEqual([(await cfg()).enveloppes_infos, (await cfg()).donations], [{}, []]);
  // un lot mêlant les deux cibles (profil, config) : tout ou rien aussi
  await remise();
  const p = (await q(`insert into public.propositions (cible, operation, apres, source) values ('profil', 'modifier', '{"personnes":{"p1":{"naissance":"1985-03-12"}}}', 'x') returning id`))[0].id;
  const m = await proposer({ donations: [{ ...DON, date: DEMAIN }] });
  await assert.rejects(appliquer([p, m]), /donations « d1 » : date dans le futur/);
  assert.equal((await un(`select personnes from public.profiles where user_id = auth.uid()`)).personnes.p1.naissance, undefined, "la naissance valide du même lot n'est pas écrite");
});

test("propositions refusées ou déjà décidées : aucune écriture", async () => {
  await remise();
  const id = await proposer(env("PEA Exemple", {}));
  assert.equal((await un("select public.refuser_propositions($1::uuid[]) n", [[id]])).n, 1);
  assert.equal(await appliquer([id]), 0, "une proposition refusée ne s'applique plus");
  assert.deepEqual((await cfg()).enveloppes_infos, {});
  const id2 = await proposer(env("PEA Exemple", {}));
  assert.equal(await appliquer([id2]), 1);
  assert.equal(await appliquer([id2]), 0, "déjà acceptée : rien de plus");
});

test("RLS : B n'applique pas les propositions de A et ne voit pas sa configuration", async () => {
  await remise(A);
  const idA = await proposer(env("PEA Exemple", {}));
  const idDon = await proposer({ donations: [DON] });
  await comme(db, B);
  assert.equal(await appliquer([idA, idDon]), 0, "les propositions de A sont invisibles pour B");
  const cB = await cfg();
  assert.deepEqual([cB.enveloppes_infos, cB.donations], [{}, []], "B garde sa propre configuration vide");
  await comme(db, A);
  assert.deepEqual((await un("select statut from public.propositions where id = $1", [idA])).statut, "en_attente", "la proposition de A est intacte");
  assert.deepEqual((await cfg()).enveloppes_infos, {});
  assert.equal(await appliquer([idA, idDon]), 2, "A applique les siennes");
  await comme(db, B);
  assert.deepEqual((await cfg()).enveloppes_infos, {}, "B ne voit pas la configuration de A");
  assert.equal((await q(`select 1 from public.config where user_id = '${A}'`)).length, 0, "RLS de config : la ligne de A est invisible pour B");
  await assert.rejects(db.query(`update public.config set enveloppes_infos = '{"x":{}}' where user_id = '${A}'`).then(r => { if (r.affectedRows === 0) throw new Error("0 ligne"); }), /0 ligne/, "B ne modifie pas la ligne de A");
  await remise(B);
  await remise(A);
});

test("anon n'a aucun accès aux nouvelles colonnes de config", async () => {
  await superu();
  await db.exec(`set role anon`);
  await assert.rejects(db.query(`select enveloppes_infos from public.config`), /permission denied/);
  await superu();
});

/* ---------- reperes ---------- */
test("PGlite : reperes.date_fin (date, null par défaut, >= date_effet) ; unité « mois » acceptée, une autre refusée", async () => {
  await superu();
  const col = await un(`select data_type t, is_nullable n, column_default d from information_schema.columns where table_schema = 'public' and table_name = 'reperes' and column_name = 'date_fin'`);
  assert.deepEqual([col.t, col.n, col.d], ["date", "YES", null]);
  assert.equal((await un(`select date_fin from public.reperes where cle = 'pea_plafond'`)).date_fin, null, "repère existant : date_fin null");
  const ins = (cle, unite, eff, fin) => db.query(`insert into public.reperes (cle, libelle, valeur, unite, date_effet, date_fin, source_titre, source_url, verifie_le)
    values ($1, 'Repère de test', 6, $2, $3, $4, 'Source de test', 'https://www.service-public.gouv.fr/test', '2026-10-14')`, [cle, unite, eff, fin]);
  await ins("test_mois", "mois", "2026-01-01", null);
  assert.equal((await un(`select unite from public.reperes where cle = 'test_mois'`)).unite, "mois", "unité « mois » acceptée");
  await ins("test_fin_egale", "ans", "2026-01-01", "2026-01-01");
  await assert.rejects(ins("test_fin_avant", "ans", "2026-01-01", "2025-12-31"), /reperes_date_fin/, "date_fin avant date_effet");
  await assert.rejects(ins("test_jours", "jours", "2026-01-01", null), /reperes_unite_check/, "unité inconnue");
  for (const u of ["%", "€", "ans"]) await ins("test_" + (u === "%" ? "pct" : u === "€" ? "eur" : "ans"), u, "2026-01-01", null);
  const unites = (await q(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.reperes'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%unite%'`));
  assert.equal(unites.length, 1, "une seule contrainte d'unité (l'ancienne est remplacée)");
  await db.exec(`delete from public.reperes where cle like 'test\\_%'`);
  assert.equal((await un(`select has_table_privilege('authenticated', 'public.reperes', 'insert') i, has_table_privilege('authenticated', 'public.reperes', 'update') u`)).i, false, "reperes reste en lecture seule pour authenticated");
});

test("repères du § 11.2 de la spec : insérés à l'identique (clé, libellé, valeur, unité, date d'effet, date de fin, source, URL) ; mode manuel", async () => {
  await superu();
  const attendus = reperesDeLaSpec();
  assert.equal(attendus.length, 34, "34 lignes dont 2 mises à jour");
  const base = await q(`select cle, libelle, valeur::float8 valeur, unite, date_effet::text date_effet, date_fin::text date_fin, source_titre, source_url, verifie_le::text verifie_le, mode from public.reperes`);
  for (const a of attendus) {
    const r = base.find(x => x.cle === a.cle);
    assert.ok(r, "repère présent : " + a.cle);
    assert.deepEqual({ ...r, verifie_le: undefined, mode: undefined }, { ...a, verifie_le: undefined, mode: undefined }, a.cle);
    assert.equal(r.verifie_le, "2026-10-14", a.cle + " : vérifié le 2026-10-14");
    assert.equal(r.mode, "manuel", a.cle);
    assert.match(r.source_url, /^https:\/\/(www\.)?(service-public\.gouv\.fr|service-public\.fr|bofip\.impots\.gouv\.fr|impots\.gouv\.fr|legifrance\.gouv\.fr|economie\.gouv\.fr|banque-france\.fr|amf-france\.org)\//, a.cle + " : domaine officiel");
  }
  // les deux mises à jour de 0010
  const la = base.find(r => r.cle === "livret_a_taux"), lep = base.find(r => r.cle === "lep_taux");
  assert.deepEqual([la.valeur, la.date_effet, la.date_fin], [1.7, "2026-08-01", "2027-01-31"]);
  assert.deepEqual([lep.valeur, lep.date_effet, lep.date_fin], [2.5, "2026-08-01", "2027-01-31"]);
  assert.match(la.source_url, /JORFTEXT000054541376$/);
  assert.match(lep.source_url, /JORFTEXT000054569438$/);
  // les repères de 0010 non concernés sont intacts
  const pea = base.find(r => r.cle === "pea_plafond");
  assert.deepEqual([pea.valeur, pea.date_effet, pea.date_fin, pea.verifie_le], [150000, "2014-01-01", null, "2026-10-10"]);
  assert.equal(base.length, 12 + 32, "12 repères de 0010 + 32 nouveaux");
  assert.equal((await q(`select 1 from public.reperes where date_fin is not null`)).length, 9, "9 repères à date de fin");
});

test("repères de la démo (web/src/demo-data.js) = ceux de la migration : mêmes clés, libellés, valeurs, unités, dates d'effet et de fin, URL ; marqués « démo »", async () => {
  await superu();
  const DEMO = createRequire(import.meta.url)("../web/src/demo-data.js");
  const demo = DEMO.savoir.reperes;
  const base = await q(`select cle, libelle, valeur::float8 valeur, unite, date_effet::text date_effet, date_fin::text date_fin, source_url from public.reperes`);
  const spec = reperesDeLaSpec();
  for (const a of spec) {
    const d = demo.find(r => r.cle === a.cle);
    assert.ok(d, "repère du § 11.2 absent de la démo : " + a.cle);
    assert.deepEqual({ cle: d.cle, libelle: d.libelle, valeur: d.valeur, unite: d.unite, date_effet: d.dateEffet, date_fin: d.dateFin, source_url: d.sourceUrl },
      { cle: a.cle, libelle: a.libelle, valeur: a.valeur, unite: a.unite, date_effet: a.date_effet, date_fin: a.date_fin, source_url: a.source_url }, a.cle);
    assert.ok(d.sourceTitre.startsWith("Valeur d'exemple (démo) — "), a.cle + " : marqué démo");
    assert.ok(d.sourceTitre.endsWith(a.source_titre) || a.cle === "livret_a_taux" || a.cle === "lep_taux", a.cle + " : titre de la source");
  }
  // la base de ce test s'arrête à 0029 : les repères de la capacité d'emprunt (IMMO1) viennent de 0030, lue telle quelle
  const m30 = reperesDeMigration("0030_reperes_projection.sql");
  const de30 = k => { const r = m30.get(k); return r && { cle: r.cle, libelle: r.libelle, valeur: r.valeur, unite: r.unite, date_effet: r.dateEffet, date_fin: r.dateFin, source_url: r.sourceUrl }; };
  for (const d of demo) {
    const b = base.find(r => r.cle === d.cle) || de30(d.cle);
    assert.ok(b, "repère de la démo inconnu de la base : " + d.cle);
    if (!base.find(r => r.cle === d.cle)) assert.deepEqual({ libelle: d.libelle, sourceUrl: d.sourceUrl }, { libelle: b.libelle, sourceUrl: b.source_url }, d.cle + " : libellé et URL comme 0030");
    assert.deepEqual([d.valeur, d.unite, d.dateEffet, d.dateFin], [b.valeur, b.unite, b.date_effet, b.date_fin], d.cle + " : valeur, unité, dates comme en base");
    assert.match(d.sourceTitre, /exemple/i); assert.match(d.sourceUrl, /^https:\/\//);
  }
  assert.equal(new Set(demo.map(r => r.cle)).size, demo.length);
  // les repères de 0010 cités par les règles (abattements de l'assurance-vie) sont dans la démo avec leurs valeurs de 0010
  assert.deepEqual(["av_abattement_seul", "av_abattement_couple"].map(k => demo.find(r => r.cle === k)?.valeur), [4600, 9200]);
});

/* ---------- banque_comptes ---------- */
test("PGlite : banque_comptes.ouverture_le (date), pret (jsonb objet), infos_proposees_le (timestamptz) ; modifiables par le service, pas par authenticated", async () => {
  await superu();
  const cols = await q(`select column_name c, data_type t, is_nullable n from information_schema.columns where table_schema = 'public' and table_name = 'banque_comptes'
    and column_name in ('ouverture_le', 'pret', 'infos_proposees_le') order by column_name`);
  assert.deepEqual(cols.map(c => [c.c, c.t, c.n]), [["infos_proposees_le", "timestamp with time zone", "YES"], ["ouverture_le", "date", "YES"], ["pret", "jsonb", "YES"]]);
  await db.exec(`insert into public.banque_connexions (id, user_id, etablissement) values (1, '${A}', 'Banque Exemple');
    insert into public.banque_comptes (id, user_id, connexion_id, nom, type, solde) values (10, '${A}', 1, 'Livret Exemple', 'livret', 1500);`);
  assert.deepEqual(await un(`select ouverture_le, pret, infos_proposees_le from public.banque_comptes where id = 10`), { ouverture_le: null, pret: null, infos_proposees_le: null });
  await assert.rejects(db.query(`update public.banque_comptes set pret = '[]' where id = 10`), /banque_comptes_pret/, "pret doit être un objet");
  await db.query(`update public.banque_comptes set pret = '{"rate": 1.85, "duration": 240}', ouverture_le = '2020-04-30', infos_proposees_le = now() where id = 10`);
  // droits : seules les 5 colonnes de rattachement restent modifiables par authenticated ; les nouvelles colonnes sont lisibles
  const peut = async (role, col, priv) => (await un(`select has_column_privilege('${role}', 'public.banque_comptes', '${col}', '${priv}') p`)).p;
  for (const col of ["ouverture_le", "pret", "infos_proposees_le"]) {
    assert.equal(await peut("authenticated", col, "update"), false, col + " : pas de modification par authenticated");
    assert.equal(await peut("authenticated", col, "insert"), false, col + " : pas d'insertion par authenticated");
    assert.equal(await peut("authenticated", col, "select"), true, col + " : lecture par authenticated");
    assert.equal(await peut("service_role", col, "update"), true, col + " : modification par le service");
    assert.equal(await peut("anon", col, "select"), false, col + " : rien pour anon");
  }
  for (const col of ["position_id", "enveloppe", "titulaire", "credit_id", "ignore"]) assert.equal(await peut("authenticated", col, "update"), true, col + " : rattachement toujours modifiable");
  for (const col of ["solde", "nom", "type", "actif", "suggestion"]) assert.equal(await peut("authenticated", col, "update"), false, col + " : toujours non modifiable");
  await comme(db, A);
  const lu = await un(`select ouverture_le::text o, pret->>'rate' r from public.banque_comptes where id = 10`);
  assert.deepEqual([lu.o, lu.r], ["2020-04-30", "1.85"], "A lit les nouvelles colonnes de son compte");
  for (const [champ, val] of [["ouverture_le", "'2019-01-01'"], ["pret", `'{"rate": 0}'`], ["infos_proposees_le", "null"]])
    await assert.rejects(db.query(`update public.banque_comptes set ${champ} = ${val} where id = 10`), /permission denied for table banque_comptes/, champ + " : refusé");
  await db.query(`update public.banque_comptes set enveloppe = 'Compte Exemple', titulaire = 'p1' where id = 10`);
  assert.equal((await un(`select enveloppe e from public.banque_comptes where id = 10`)).e, "Compte Exemple", "le rattachement reste possible");
  await comme(db, B);
  assert.equal((await q(`select 1 from public.banque_comptes where id = 10`)).length, 0, "B ne voit pas le compte de A");
  await superu();
  await db.exec(`delete from public.banque_comptes where id = 10; delete from public.banque_connexions where id = 1;`);
});

/* ---------- MFA (0028) ---------- */
test("0028 toujours en place : politiques restrictives sur config et banque_comptes ; un second facteur vérifié exige aal2 pour les nouvelles clés", async () => {
  await superu();
  const pol = (await q(`select tablename t, policyname n, permissive p from pg_policies where schemaname = 'public' and tablename in ('config', 'banque_comptes') and policyname like '%aal2%' order by 1, 2`));
  assert.deepEqual(pol.map(p => [p.t, p.n, p.p]), [["banque_comptes", "banque_comptes: aal2", "RESTRICTIVE"], ["config", "config: aal2 si facteur", "RESTRICTIVE"]]);
  assert.equal((await un(`select count(*)::int n from pg_proc where oid = 'public.mfa_exigee()'::regprocedure`)).n, 1);
  // C a un facteur vérifié : en aal1, ni lecture de config ni dépôt de proposition ; en aal2, tout marche
  await db.exec(`insert into auth.mfa_factors (user_id, status) values ('${C}', 'verified')`);
  await db.exec(`reset role; set test.uid = '${C}'; set test.aal = 'aal1'; set role authenticated;`);
  assert.equal((await q(`select 1 from public.config`)).length, 0, "aal1 avec facteur : config invisible");
  await assert.rejects(proposer({ donations: [DON] }), /row-level security/, "aal1 avec facteur : dépôt refusé");
  await db.exec(`reset role; set test.uid = '${C}'; set test.aal = 'aal2'; set role authenticated;`);
  assert.equal((await ok({ donations: [DON] })).donations.length, 1, "aal2 : la proposition s'applique");
  await superu();
  await db.exec(`delete from auth.mfa_factors where user_id = '${C}'`);
});

/* ---------- identité de la fonction avec 0027 ---------- */
test("appliquer_propositions de 0029 = celle de 0027 + les ajouts annoncés (trois lignes de liste blanche remplacées, le reste conservé dans l'ordre)", async () => {
  const corps = sql => {
    const i = sql.indexOf("create or replace function public.appliquer_propositions(");
    assert.ok(i >= 0);
    const j = sql.indexOf("\n$$;", i);
    return sql.slice(i, j + 4).split("\n");
  };
  const avant = corps(SQL_0027), apres = corps(SQL);
  const retirees = avant.filter(l => !apres.includes(l)).map(l => l.trim());
  assert.deepEqual(retirees, [
    "select k into v_key from jsonb_object_keys(v) k where k not in ('cushion', 'recurring', 'frais_enveloppes') limit 1;",
    "if v_key is not null then raise exception 'réglage « % » non modifiable par proposition (cushion, recurring ou frais_enveloppes seulement)', v_key; end if;",
    "if not (v ? 'cushion' or v ? 'recurring' or v ? 'frais_enveloppes') then raise exception 'réglages : cushion ou recurring attendu (ou frais_enveloppes)'; end if;",
  ], "seules les trois lignes de la liste blanche des clés de config sont remplacées");
  // toutes les autres lignes de 0027 sont conservées, dans le même ordre
  let j = 0;
  for (const l of avant.filter(l => !retirees.includes(l.trim()))) { j = apres.indexOf(l, j); assert.ok(j >= 0, "ligne de 0027 perdue ou déplacée : " + l); j++; }
  // les ajouts : variables, naissance, liste blanche, quatre blocs ; ni droits, ni suppression, ni autre table que config
  const ajoutees = apres.filter(l => !avant.includes(l));
  assert.ok(ajoutees.length > 300);
  const texte = ajoutees.join("\n");
  assert.doesNotMatch(texte, /\b(grant|revoke|security definer|drop|truncate|delete\s+from)\b/i, "aucun droit, aucune suppression ajoutés");
  assert.deepEqual([...new Set([...texte.matchAll(/update public\.(\w+) set/g)].map(m => m[1]))], ["config"], "la seule écriture ajoutée vise config");
  assert.deepEqual([...texte.matchAll(/update public\.config set (\w+) =/g)].map(m => m[1]).sort(), ["avis_impot", "donations", "enveloppes_infos", "prets_infos"]);
  for (const k of ["v_ei", "v_pi", "v_don", "v_avis", "v_auj", "v_dt", "v_nom"]) assert.ok(new RegExp("^  " + k + "\\s+\\w+;$", "m").test(texte), "variable déclarée : " + k);
  assert.match(texte, /personnes\.% : naissance invalide \(AAAA-MM-JJ ou AAAA-MM\)/);
  // après la fonction : mêmes revoke / grant que 0027
  const fin = sql => sql.slice(sql.indexOf("\n$$;", sql.indexOf("create or replace function public.appliquer_propositions(")) + 4).split("\n").filter(l => /^(revoke|grant) .*appliquer_propositions/.test(l));
  assert.deepEqual(fin(SQL), fin(SQL_0027));
  await superu();
  const f = await un(`select p.prosecdef s, p.proconfig c, has_function_privilege('anon', p.oid, 'execute') anon,
    has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('public', p.oid, 'execute') pub
    from pg_proc p where p.oid = 'public.appliquer_propositions(uuid[], jsonb)'::regprocedure`);
  assert.deepEqual([f.s, f.c, f.anon, f.auth], [false, ["search_path=\"\""], false, true], "security invoker, search_path vide, droits de 0027");
  assert.equal(f.pub, false);
});

/* ---------- chaîne complète ---------- */
test("baseComplete() complète : 0001 → 0032 s'appliquent dans l'ordre, la fonction et les colonnes sont là", async () => {
  const complet = await baseComplete();
  try {
    const r = await complet.query(`select (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'config'
        and column_name in ('enveloppes_infos', 'prets_infos', 'donations', 'avis_impot')) config,
      (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'banque_comptes'
        and column_name in ('ouverture_le', 'pret', 'infos_proposees_le')) banque,
      (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'reperes' and column_name = 'date_fin') reperes,
      (select count(*)::int from public.reperes) n_reperes,
      (select count(*)::int from pg_policies where schemaname = 'public' and policyname like '%aal2%') politiques`);
    const { politiques, ...reste } = r.rows[0];
    assert.deepEqual(reste, { config: 4, banque: 3, reperes: 1, n_reperes: 147 });
    assert.ok(politiques >= 20, "politiques MFA de 0028 en place dans la chaîne complète (" + politiques + ")");
  } finally { await complet.close(); }
});
