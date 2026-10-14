// PROJ : migrations 0030 (repères) et 0031 (moteur de projection) exercées sur un vrai PostgreSQL (PGlite, en mémoire) : 0001 → 0029 appliquées sur les
// bouchons Supabase (test/helpers/pglite.mjs, baseComplete), données de départ, puis 0030 et 0031. Couvre les tables foyer_variantes, foyer_evenements et
// plans_figes (colonnes, défauts, contraintes, cascade, limites), la RLS et les politiques restrictives de double authentification,
// appliquer_propositions (cibles evenement, variante, plan_fige et clé projection de la cible config : tout ou rien, messages identiques à
// web/src/projection-evenements.js), export_all, indices_mensuels (contenu commun en lecture seule) et le bloc de repères.
// Le diff d'appliquer_propositions contre 0029 est limité à des ajouts (quatre lignes de messages modifiées, listées ci-dessous).
// Valeurs fictives uniquement ; aucun réseau, aucun secret.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { baseComplete } from "./helpers/pglite.mjs";
import { FIXTURE } from "./helpers/projection-cas.mjs";

const req = createRequire(import.meta.url);
const E = req("../web/src/projection-evenements.js");
const O = req("../web/src/projection-outils.js");
const MARCHE = req("../web/src/marche.js");

const DIR = new URL("../supabase/migrations/", import.meta.url);
const SQL = readFileSync(new URL("0031_projection.sql", DIR), "utf8");
const SQL_0030 = readFileSync(new URL("0030_reperes_projection.sql", DIR), "utf8");
const SQL_0029 = readFileSync(new URL("0029_calendrier.sql", DIR), "utf8");
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", C = "33333333-3333-3333-3333-333333333333";
const TYPES_V1 = ["naissance", "creche", "scolarite_privee", "achat_immobilier", "retrait", "hausse_revenu", "fin_credit", "crise", "changement_emploi", "conge_parental"];
const TYPES_RESERVES = ["chomage", "separation", "invalidite", "retraite", "heritage", "temps_partiel", "demenagement"];
let db, AUJ;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const superu = () => db.exec(`reset role; set test.uid = ''; set test.aal = 'aal2';`);
const service = () => db.exec(`reset role; set test.uid = ''; set test.aal = 'aucun'; set role service_role;`);
/** Session simulée : rôle authenticated, utilisateur uid, niveau d'assurance aal. */
const comme = (uid, aal = "aal2") => db.exec(`reset role; set test.uid = '${uid}'; set test.aal = '${aal}'; set role authenticated;`);
const refuse = async (s, motif, m, p) => {
  await assert.rejects(db.query(s, p), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
};

/* ---------- propositions ---------- */
const proposer = async (cible, apres, o = {}) => (await q(`insert into public.propositions (cible, operation, ref, apres, source)
  values ($1, $2, $3, $4, $5) returning id`, [cible, o.operation ?? (cible === "config" ? "modifier" : "creer"), o.ref ?? null,
  apres == null ? null : JSON.stringify(apres), o.source ?? "Dit par l'utilisateur"]))[0].id;
const appliquer = async (ids, mods) => (await q("select public.appliquer_propositions($1::uuid[], $2::jsonb) n", [ids, JSON.stringify(mods ?? {})]))[0].n;
/** Dépose puis applique une proposition ; renvoie { ok: true } ou { message } (message de l'exception). */
async function essayer(cible, apres, o) {
  const id = await proposer(cible, apres, o);
  try { await appliquer([id]); return { ok: true, id }; } catch (e) { return { message: e.message, id }; }
}
const refusee = async (cible, apres, motif, m, o) => {
  const r = await essayer(cible, apres, o);
  assert.ok(r.message, m + " : accepté à tort");
  assert.match(r.message, motif, m + " : " + r.message);
  return r.message;
};
const accepte = async (cible, apres, m, o) => {
  const r = await essayer(cible, apres, o);
  assert.equal(r.message, undefined, m + " : " + r.message);
  return r.id;
};
const vider = async () => { await db.exec(`delete from public.foyer_evenements; delete from public.foyer_variantes; delete from public.plans_figes;`); };
const reinitProjection = () => db.exec(`update public.config set projection = '{}'::jsonb`);

/* ---------- données de départ ---------- */
let CREDIT_A, CREDIT_B, BIEN_A, BIEN_B;
before(async () => {
  db = await baseComplete("0029_calendrier.sql");
  await db.exec(`
    insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
    insert into auth.mfa_factors (user_id, status) values ('${A}', 'verified');   -- A : double authentification ; B et C : aucun facteur
    insert into public.credits (user_id, nom, crd, mensualite) values ('${A}', 'Prêt travaux fictif', 12000, 300), ('${B}', 'Prêt de B', 5000, 100);
    insert into public.biens (user_id, nom, usage, valeur, crd, mensualite) values ('${A}', 'Appartement fictif', 'rp', 250000, 150000, 900), ('${B}', 'Maison de B', 'rp', 300000, 100000, 800);
    insert into public.config (user_id) values ('${A}'), ('${B}') on conflict (user_id) do nothing;`);
  CREDIT_A = (await un(`select id from public.credits where user_id = '${A}'`)).id;
  CREDIT_B = (await un(`select id from public.credits where user_id = '${B}'`)).id;
  BIEN_A = (await un(`select id from public.biens where user_id = '${A}'`)).id;
  BIEN_B = (await un(`select id from public.biens where user_id = '${B}'`)).id;
  // on rend l'état de départ (0029) pour comparer plus tard la fonction, puis on applique 0030
  assert.equal((await un(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename in ('foyer_evenements', 'foyer_variantes', 'plans_figes', 'indices_mensuels')`)).n, 0, "0030 pas encore appliquée");
  await db.exec(SQL_0030);
  await db.exec(SQL.replace(/^create extension[^;]*;/gim, ""));
  AUJ = (await un(`select current_date::text d`)).d;
});
after(async () => { await db.close(); });

/* =========================================================================================================== migration : texte */
test("migration 0031 : en-tête (non appliquée, après 0029 et 0030, avant mcp), tutoiement, sans « conseiller », sans secret, aucune politique retirée", () => {
  assert.match(SQL, /^-- Boussole : moteur de projection/);
  assert.match(SQL, /Non appliquée : à appliquer avec apply_migration \(name = "projection"\)/);
  assert.match(SQL, /après 0029 \(calendrier\) et\n-- 0030/);
  assert.match(SQL, /AVANT le déploiement de la fonction mcp/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(SQL, /conseiller/i);
  assert.doesNotMatch(SQL, /sb_secret_|eyJhbGci/);
  assert.doesNotMatch(SQL, /\bdrop\s+policy\b/i);
  assert.doesNotMatch(SQL, /\bdrop\s+table\b/i);
});

test("migration 0030 : en-tête (idempotente, sans table ni fonction, applicable avant le reste), tutoiement ; ne redéfinit ni appliquer_propositions ni export_all", () => {
  assert.match(SQL_0030, /^-- Boussole : repères de la projection/);
  assert.match(SQL_0030, /apply_migration \(name = "reperes_projection"\)/);
  assert.match(SQL_0030, /IDEMPOTENT, sans table ni fonction/);
  assert.match(SQL_0030, /avant le reste du chantier/);
  assert.doesNotMatch(SQL_0030, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(SQL_0030, /conseiller/i);
  assert.doesNotMatch(SQL_0030, /\bcreate\s+(or\s+replace\s+)?(table|function|policy|trigger|index)\b/i, "aucune table, fonction, politique ni déclencheur");
  assert.doesNotMatch(SQL_0030, /appliquer_propositions|export_all/);
  assert.doesNotMatch(SQL.split("\n").filter(l => !l.startsWith("--")).join("\n"), /reperes_unite_check|insert into public\.reperes/, "0031 ne touche pas aux repères");
});
test("0030 s'applique seule sur 0029, deux fois de suite, sans erreur : 68 repères, aucune autre table, appliquer_propositions inchangée", async () => {
  const d = await baseComplete("0029_calendrier.sql");
  try {
    const def = async () => (await d.query(`select pg_get_functiondef('public.appliquer_propositions(uuid[], jsonb)'::regprocedure) f`)).rows[0].f;
    const avant = await def();
    const n0 = (await d.query(`select count(*)::int n from public.reperes`)).rows[0].n;
    await d.exec(SQL_0030);
    await d.exec(SQL_0030);
    const n1 = (await d.query(`select count(*)::int n from public.reperes`)).rows[0].n;
    assert.equal(n1 - n0, 68);
    assert.equal((await d.query(`select count(*)::int n from public.reperes where cle = any($1)`, [FIXTURE.reperes.map(r => r.cle)])).rows[0].n, 68);
    assert.equal((await d.query(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename in ('foyer_evenements', 'foyer_variantes', 'plans_figes', 'indices_mensuels')`)).rows[0].n, 0);
    assert.equal(await def(), avant, "appliquer_propositions inchangée");
    assert.equal((await d.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'foyer\\_%'`)).rows[0].n, 0, "aucune fonction ajoutée");
    // une valeur modifiée à la main est remise à la valeur de la fixture au rejeu
    await d.exec(`update public.reperes set valeur = 999 where cle = 'inflation_hypothese'`);
    await d.exec(SQL_0030);
    assert.equal((await d.query(`select valeur::float8 v from public.reperes where cle = 'inflation_hypothese'`)).rows[0].v, FIXTURE.reperes.find(r => r.cle === "inflation_hypothese").valeur);
  } finally { await d.close(); }
});

/* =========================================================================================================== colonnes et défauts */
const colonnes = async t => Object.fromEntries((await q(`select column_name c, data_type t, is_nullable n, column_default d from information_schema.columns
  where table_schema = 'public' and table_name = $1`, [t])).map(r => [r.c, r]));

test("foyer_variantes : colonnes, types, défauts", async () => {
  await superu();
  const c = await colonnes("foyer_variantes");
  assert.deepEqual(Object.keys(c).sort(), ["created_at", "description", "hypotheses", "id", "nom", "retire", "updated_at", "user_id"]);
  assert.equal(c.id.t, "uuid"); assert.match(c.id.d, /gen_random_uuid/);
  assert.equal(c.user_id.n, "NO"); assert.match(c.user_id.d, /auth\.uid\(\)/);
  assert.equal(c.nom.n, "NO"); assert.equal(c.description.n, "NO"); assert.match(c.description.d, /''/);
  assert.equal(c.retire.t, "ARRAY"); assert.match(c.retire.d, /'\{\}'/);
  assert.equal(c.hypotheses.t, "jsonb"); assert.match(c.hypotheses.d, /'\{\}'/);
  assert.equal(c.created_at.n, "NO"); assert.equal(c.updated_at.n, "NO");
});
test("foyer_evenements : colonnes, types, défauts (personne foyer, params {}, variante nulle)", async () => {
  await superu();
  const c = await colonnes("foyer_evenements");
  assert.deepEqual(Object.keys(c).sort(), ["created_at", "date", "fin", "id", "libelle", "params", "personne", "source", "type", "updated_at", "user_id", "variante_id"]);
  assert.equal(c.variante_id.n, "YES"); assert.equal(c.fin.n, "YES"); assert.equal(c.date.t, "date"); assert.equal(c.date.n, "NO");
  assert.match(c.personne.d, /'foyer'/); assert.match(c.params.d, /'\{\}'/); assert.equal(c.params.t, "jsonb");
  assert.match(c.user_id.d, /auth\.uid\(\)/); assert.equal(c.user_id.n, "NO");
});
test("plans_figes : colonnes, types, défauts", async () => {
  await superu();
  const c = await colonnes("plans_figes");
  assert.deepEqual(Object.keys(c).sort(), ["cree_le", "horizon_mois", "id", "parametres", "raison", "serie", "user_id"]);
  assert.equal(c.cree_le.t, "timestamp with time zone"); assert.match(c.cree_le.d, /now\(\)/);
  assert.equal(c.horizon_mois.t, "integer");
  for (const k of ["raison", "horizon_mois", "parametres", "serie", "user_id", "cree_le"]) assert.equal(c[k].n, "NO", k);
  assert.match(c.id.d, /gen_random_uuid/); assert.match(c.user_id.d, /auth\.uid\(\)/);
});
test("indices_mensuels : colonnes et clé primaire (serie, mois), sans user_id", async () => {
  await superu();
  const c = await colonnes("indices_mensuels");
  assert.deepEqual(Object.keys(c).sort(), ["mois", "serie", "source_titre", "source_url", "valeur", "verifie_le"]);
  const pk = await q(`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.indices_mensuels'::regclass and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)`);
  assert.deepEqual(pk.map(r => r.attname), ["serie", "mois"]);
});
test("config.projection : colonne jsonb not null, défaut {}, objet exigé", async () => {
  await superu();
  const c = (await colonnes("config")).projection;
  assert.ok(c, "colonne projection");
  assert.equal(c.t, "jsonb"); assert.equal(c.n, "NO"); assert.match(c.d, /'\{\}'/);
  await refuse(`update public.config set projection = '[]'::jsonb where user_id = '${A}'`, /config_projection/, "tableau refusé");
  await refuse(`update public.config set projection = '"x"'::jsonb where user_id = '${A}'`, /config_projection/, "texte refusé");
});
test("index sur user_id pour les trois tables personnelles ; déclencheur updated_at sur variantes et événements", async () => {
  await superu();
  for (const t of ["foyer_evenements", "foyer_variantes"]) {
    const idx = await q(`select indexdef from pg_indexes where schemaname = 'public' and tablename = $1`, [t]);
    assert.ok(idx.some(i => /\(user_id\)/.test(i.indexdef)), t + " : index user_id");
    const tg = await q(`select tgname from pg_trigger where tgrelid = ('public.' || $1)::regclass and not tgisinternal`, [t]);
    assert.ok(tg.some(x => /updated_at/.test(x.tgname)), t + " : déclencheur updated_at");
  }
  assert.ok((await q(`select indexdef from pg_indexes where schemaname = 'public' and tablename = 'plans_figes'`)).some(i => /\(user_id, cree_le DESC\)/.test(i.indexdef)), "plans_figes : index (user_id, cree_le desc)");
});

/* =========================================================================================================== contraintes de table */
const ev = (o = {}) => ({ type: "retrait", personne: "foyer", libelle: "Voiture", date: "2027-01-01", fin: null, params: { montant: 1000 }, source: "cas fictif", ...o });
async function insEv(uid, o = {}) {
  const e = ev(o);
  return q(`insert into public.foyer_evenements (user_id, variante_id, type, personne, libelle, date, fin, params, source)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [uid, e.variante_id ?? null, e.type, e.personne, e.libelle, e.date, e.fin, JSON.stringify(e.params), e.source]);
}
const insVar = (uid, o = {}) => q(`insert into public.foyer_variantes (user_id, nom, description, retire, hypotheses) values ($1, $2, $3, $4, $5) returning id`,
  [uid, o.nom ?? "Variante", o.description ?? "", o.retire ?? [], JSON.stringify(o.hypotheses ?? {})]);
const insPlan = (uid, o = {}) => q(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ($1, $2, $3, $4, $5) returning id`,
  [uid, o.raison ?? "manuel", o.horizon_mois ?? 120, JSON.stringify(o.parametres ?? { a: 1 }), JSON.stringify(o.serie ?? { b: [1, 2] })]);

test("foyer_evenements : 17 types acceptés par la table (dont les 7 réservés), type inconnu refusé", async () => {
  await superu();
  for (const t of [...TYPES_V1, ...TYPES_RESERVES]) { await insEv(A, { type: t }); }
  assert.equal((await un(`select count(*)::int n from public.foyer_evenements where user_id = '${A}'`)).n, 17);
  await refuse(`insert into public.foyer_evenements (user_id, type, libelle, date, source) values ('${A}', 'inconnu', 'x', '2027-01-01', 's')`, /foyer_evenements_type_check/, "type inconnu");
  await vider();
});
test("foyer_evenements : personne, libellé 1-60, source 1-300, fin >= date, params objet, défauts", async () => {
  await superu();
  const base = (extra = "") => `insert into public.foyer_evenements (user_id, type, libelle, date, source${extra ? ", " + extra.split("=")[0] : ""}) values ('${A}', 'retrait', 'x', '2027-01-01', 's'${extra ? ", " + extra.split("=")[1] : ""})`;
  await db.exec(base());
  const d = await un(`select personne, params, fin, variante_id from public.foyer_evenements`);
  assert.deepEqual([d.personne, d.params, d.fin, d.variante_id], ["foyer", {}, null, null]);
  await vider();
  await refuse(base("personne='p3'"), /foyer_evenements_personne_check/, "personne p3");
  for (const p of ["p1", "p2", "foyer"]) { await db.exec(base(`personne='${p}'`)); }
  await vider();
  await refuse(`insert into public.foyer_evenements (user_id, type, libelle, date, source) values ('${A}', 'retrait', '', '2027-01-01', 's')`, /libelle_check/, "libellé vide");
  await refuse(`insert into public.foyer_evenements (user_id, type, libelle, date, source) values ('${A}', 'retrait', '${"x".repeat(61)}', '2027-01-01', 's')`, /libelle_check/, "libellé 61");
  await db.exec(`insert into public.foyer_evenements (user_id, type, libelle, date, source) values ('${A}', 'retrait', '${"x".repeat(60)}', '2027-01-01', 's')`);
  await refuse(`insert into public.foyer_evenements (user_id, type, libelle, date, source) values ('${A}', 'retrait', 'x', '2027-01-01', '')`, /source_check/, "source vide");
  await refuse(`insert into public.foyer_evenements (user_id, type, libelle, date, source) values ('${A}', 'retrait', 'x', '2027-01-01', '${"s".repeat(301)}')`, /source_check/, "source 301");
  await db.exec(`insert into public.foyer_evenements (user_id, type, libelle, date, source) values ('${A}', 'retrait', 'x', '2027-01-01', '${"s".repeat(300)}')`);
  await refuse(`insert into public.foyer_evenements (user_id, type, libelle, date, fin, source) values ('${A}', 'creche', 'x', '2027-01-02', '2027-01-01', 's')`, /foyer_evenements_fin/, "fin avant date");
  await db.exec(`insert into public.foyer_evenements (user_id, type, libelle, date, fin, source) values ('${A}', 'creche', 'x', '2027-01-01', '2027-01-01', 's')`);
  await refuse(`insert into public.foyer_evenements (user_id, type, libelle, date, source, params) values ('${A}', 'retrait', 'x', '2027-01-01', 's', '[]')`, /params_check/, "params tableau");
  await refuse(`insert into public.foyer_evenements (user_id, type, libelle, date, source, params) values ('${A}', 'retrait', 'x', '2027-01-01', 's', '"texte"')`, /params_check/, "params texte");
  await refuse(`insert into public.foyer_evenements (user_id, type, libelle, source) values ('${A}', 'retrait', 'x', 's')`, /null value in column "date"/, "date obligatoire");
  await vider();
});
test("foyer_variantes : nom 1-40, description <= 300, hypothèses en objet, retire par défaut vide", async () => {
  await superu();
  await refuse(`insert into public.foyer_variantes (user_id, nom) values ('${A}', '')`, /nom_check/, "nom vide");
  await refuse(`insert into public.foyer_variantes (user_id, nom) values ('${A}', '${"n".repeat(41)}')`, /nom_check/, "nom 41");
  await db.exec(`insert into public.foyer_variantes (user_id, nom) values ('${A}', '${"n".repeat(40)}')`);
  const d = await un(`select description, retire, hypotheses from public.foyer_variantes`);
  assert.deepEqual([d.description, d.retire, d.hypotheses], ["", [], {}]);
  await refuse(`insert into public.foyer_variantes (user_id, nom, description) values ('${A}', 'v', '${"d".repeat(301)}')`, /description_check/, "description 301");
  await db.exec(`insert into public.foyer_variantes (user_id, nom, description) values ('${A}', 'v', '${"d".repeat(300)}')`);
  await refuse(`insert into public.foyer_variantes (user_id, nom, hypotheses) values ('${A}', 'v', '[]')`, /hypotheses_check/, "hypothèses tableau");
  await vider();
});
test("plans_figes : raison, horizon 1-300, parametres et serie en objets, tailles 100 000 et 250 000 octets", async () => {
  await superu();
  await refuse(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ('${A}', 'autre', 12, '{}', '{}')`, /raison_check/, "raison inconnue");
  for (const r of ["revue_mensuelle", "objectif", "manuel"]) await insPlan(A, { raison: r });
  await refuse(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ('${A}', 'manuel', 0, '{}', '{}')`, /horizon_mois_check/, "horizon 0");
  await refuse(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ('${A}', 'manuel', 301, '{}', '{}')`, /horizon_mois_check/, "horizon 301");
  await db.exec(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ('${A}', 'manuel', 1, '{}', '{}'), ('${A}', 'manuel', 300, '{}', '{}')`);
  await refuse(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ('${A}', 'manuel', 12, '[]', '{}')`, /parametres_check|plans_figes_check/, "parametres tableau");
  await refuse(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ('${A}', 'manuel', 12, '{}', '[]')`, /serie_check|plans_figes_check/, "serie tableau");
  const sur = (await un(`select octet_length(jsonb_build_object('x', '')::text) n`)).n;   // surcoût de {"x": ""}
  await db.query(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ($1, 'manuel', 12, jsonb_build_object('x', repeat('a', $2)), '{}')`, [A, 100000 - sur]);
  await refuse(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ($1, 'manuel', 12, jsonb_build_object('x', repeat('a', $2)), '{}')`, /plans_figes_parametres_taille|plans_figes_check/, "parametres 100 001 octets", [A, 100000 - sur + 1]);
  await db.query(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ($1, 'manuel', 12, '{}', jsonb_build_object('x', repeat('a', $2)))`, [A, 250000 - sur]);
  await refuse(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ($1, 'manuel', 12, '{}', jsonb_build_object('x', repeat('a', $2)))`, /plans_figes_serie_taille|plans_figes_check/, "serie 250 001 octets", [A, 250000 - sur + 1]);
  await vider();
});
test("variante_id d'un autre utilisateur refusé (déclencheur), même pour le service ; variante inexistante refusée ; déplacement refusé aussi", async () => {
  await superu();
  const [vb] = await insVar(B, { nom: "Variante de B" });
  const [va] = await insVar(A, { nom: "Variante de A" });
  await refuse(`insert into public.foyer_evenements (user_id, variante_id, type, libelle, date, source) values ('${A}', '${vb.id}', 'retrait', 'x', '2027-01-01', 's')`, /n'existe pas dans tes données/, "variante de B");
  await refuse(`insert into public.foyer_evenements (user_id, variante_id, type, libelle, date, source) values ('${A}', gen_random_uuid(), 'retrait', 'x', '2027-01-01', 's')`, /n'existe pas dans tes données|foreign key/, "variante inconnue");
  await service();
  await refuse(`insert into public.foyer_evenements (user_id, variante_id, type, libelle, date, source) values ('${A}', '${vb.id}', 'retrait', 'x', '2027-01-01', 's')`, /n'existe pas dans tes données/, "service_role : variante de B");
  await superu();
  const [e] = await insEv(A, { variante_id: va.id });
  await refuse(`update public.foyer_evenements set variante_id = '${vb.id}' where id = '${e.id}'`, /n'existe pas dans tes données/, "déplacement vers la variante de B");
  await db.exec(`update public.foyer_evenements set variante_id = null where id = '${e.id}'`);   // retour à la situation actuelle : permis
  await comme(A);
  await refuse(`insert into public.foyer_evenements (variante_id, type, libelle, date, source) values ('${vb.id}', 'retrait', 'x', '2027-01-01', 's')`, /n'existe pas dans tes données/, "A (authenticated) vers la variante de B");
  await superu(); await vider();
});
test("suppression d'une variante : ses événements partent avec elle, les autres restent ; suppression de l'utilisateur : tout part", async () => {
  await superu();
  const U = "55555555-5555-5555-5555-555555555555";
  await db.exec(`insert into auth.users (id) values ('${U}')`);
  const [v1] = await insVar(U, { nom: "V1" }), [v2] = await insVar(U, { nom: "V2" });
  await insEv(U, { variante_id: v1.id }); await insEv(U, { variante_id: v1.id }); await insEv(U, { variante_id: v2.id }); await insEv(U);
  await insPlan(U);
  await db.exec(`delete from public.foyer_variantes where id = '${v1.id}'`);
  assert.equal((await un(`select count(*)::int n from public.foyer_evenements where user_id = '${U}'`)).n, 2, "2 événements de V1 supprimés, V2 et la base restent");
  await db.exec(`delete from auth.users where id = '${U}'`);
  for (const t of ["foyer_evenements", "foyer_variantes", "plans_figes"]) assert.equal((await un(`select count(*)::int n from public.${t} where user_id = '${U}'`)).n, 0, t + " : cascade");
});
test("delete_me() (security definer) : fermer son compte emporte événements, variantes et plans", async () => {
  await superu();
  const U = "66666666-6666-6666-6666-666666666666";
  await db.exec(`insert into auth.users (id) values ('${U}')`);
  const [v] = await insVar(U); await insEv(U, { variante_id: v.id }); await insPlan(U);
  await comme(U, "aal1");
  await db.exec(`select public.delete_me()`);
  await superu();
  for (const t of ["foyer_evenements", "foyer_variantes", "plans_figes"]) assert.equal((await un(`select count(*)::int n from public.${t} where user_id = '${U}'`)).n, 0, t);
  assert.equal((await q(`select 1 from auth.users where id = '${U}'`)).length, 0);
});

/* =========================================================================================================== limites */
test("limites par utilisateur (déclencheurs) : 100 événements, 10 variantes, 60 plans ; l'utilisateur voisin n'est pas touché", async () => {
  await superu(); await vider();
  await db.exec(`insert into public.foyer_evenements (user_id, type, libelle, date, source) select '${A}', 'retrait', 'e' || g, '2027-01-01', 's' from generate_series(1, 100) g`);
  await refuse(`insert into public.foyer_evenements (user_id, type, libelle, date, source) values ('${A}', 'retrait', 'de trop', '2027-01-01', 's')`, /100 événements au plus/, "101e événement");
  await db.exec(`insert into public.foyer_evenements (user_id, type, libelle, date, source) values ('${B}', 'retrait', 'B', '2027-01-01', 's')`);
  await db.exec(`insert into public.foyer_variantes (user_id, nom) select '${A}', 'v' || g from generate_series(1, 10) g`);
  await refuse(`insert into public.foyer_variantes (user_id, nom) values ('${A}', 'de trop')`, /10 variantes au plus/, "11e variante");
  await db.exec(`insert into public.foyer_variantes (user_id, nom) values ('${B}', 'B')`);
  await db.exec(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) select '${A}', 'manuel', 12, '{}', '{}' from generate_series(1, 60) g`);
  await refuse(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ('${A}', 'manuel', 12, '{}', '{}')`, /60 plans figés au plus/, "61e plan");
  await db.exec(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ('${B}', 'manuel', 12, '{}', '{}')`);
  await vider();
});

/* =========================================================================================================== RLS */
test("RLS : activée, politiques de propriétaire select/insert/update/delete (plans_figes : sans update), restrictive « aal2 si facteur » au modèle exact de 0028", async () => {
  await superu();
  for (const t of ["foyer_evenements", "foyer_variantes", "plans_figes"]) {
    assert.equal((await un(`select relrowsecurity r from pg_class where oid = ('public.' || $1)::regclass`, [t])).r, true, t + " : RLS");
    const perm = await q(`select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = $1 and permissive = 'PERMISSIVE' order by cmd`, [t]);
    const cmds = perm.map(p => p.cmd).sort();
    assert.deepEqual(cmds, t === "plans_figes" ? ["DELETE", "INSERT", "SELECT"] : ["DELETE", "INSERT", "SELECT", "UPDATE"], t + " : commandes");
    for (const p of perm) assert.match(p.qual ?? p.with_check, /auth\.uid\(\)/, t + " : " + p.policyname);
    const r = await q(`select policyname, roles::text, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = $1 and permissive = 'RESTRICTIVE'`, [t]);
    assert.equal(r.length, 1, t + " : une restrictive");
    assert.equal(r[0].policyname, t + ": aal2 si facteur");
    assert.match(r[0].roles, /authenticated/); assert.equal(r[0].cmd, "ALL");
    for (const e of [r[0].qual, r[0].with_check]) { assert.match(e, /aal2/); assert.match(e, /mfa_exigee/); }
  }
  const exact = `create policy "foyer_evenements: aal2 si facteur" on public.foyer_evenements as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()))
  with check ((select auth.jwt()->>'aal') = 'aal2' or not (select public.mfa_exigee()));`;
  assert.ok(SQL.includes(exact), "texte identique au modèle de 0028");
});
test("RLS : B ne lit, ne modifie, ne supprime ni n'insère rien de A ; anon n'a aucun droit", async () => {
  await superu(); await vider();
  const [va] = await insVar(A, { nom: "Variante A" }), [ea] = await insEv(A, { libelle: "Événement A" }), [pa] = await insPlan(A);
  await comme(B);
  for (const t of ["foyer_evenements", "foyer_variantes", "plans_figes"]) assert.deepEqual(await q(`select 1 from public.${t}`), [], t + " : B ne lit rien");
  assert.equal((await db.query(`update public.foyer_evenements set libelle = 'pirate' where id = '${ea.id}' returning id`)).rows.length, 0);
  assert.equal((await db.query(`update public.foyer_variantes set nom = 'pirate' where id = '${va.id}' returning id`)).rows.length, 0);
  assert.equal((await db.query(`delete from public.foyer_evenements where id = '${ea.id}' returning id`)).rows.length, 0);
  assert.equal((await db.query(`delete from public.foyer_variantes where id = '${va.id}' returning id`)).rows.length, 0);
  assert.equal((await db.query(`delete from public.plans_figes where id = '${pa.id}' returning id`)).rows.length, 0);
  await refuse(`insert into public.foyer_evenements (user_id, type, libelle, date, source) values ('${A}', 'retrait', 'x', '2027-01-01', 's')`, /row-level security/, "insertion pour A");
  await refuse(`insert into public.foyer_variantes (user_id, nom) values ('${A}', 'x')`, /row-level security/, "variante pour A");
  await refuse(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) values ('${A}', 'manuel', 12, '{}', '{}')`, /row-level security/, "plan pour A");
  await comme(A);
  assert.equal((await q(`select 1 from public.foyer_evenements`)).length, 1);
  assert.equal((await q(`select 1 from public.foyer_variantes`)).length, 1);
  assert.equal((await q(`select 1 from public.plans_figes`)).length, 1);
  await db.exec(`reset role; set test.uid = ''; set role anon;`);
  for (const t of ["foyer_evenements", "foyer_variantes", "plans_figes"]) await refuse(`select 1 from public.${t}`, /permission denied/, "anon " + t);
  await superu(); await vider();
});
test("plans_figes est immuable : authenticated n'a pas le droit de les modifier", async () => {
  await superu(); await vider();
  const [p] = await insPlan(A);
  await comme(A);
  await refuse(`update public.plans_figes set horizon_mois = 24 where id = '${p.id}'`, /permission denied/, "update");
  await db.exec(`delete from public.plans_figes where id = '${p.id}'`);
  await superu();
});
test("MFA : A (facteur vérifié) en aal1 ne voit ni n'écrit rien dans les trois tables ; en aal2 tout ; C (sans facteur) reste en aal1 comme avant", async () => {
  await superu(); await vider();
  await insVar(A); await insEv(A); await insPlan(A);
  await insVar(C); await insEv(C); await insPlan(C);
  for (const aal of ["aal1", "aucun"]) {
    await comme(A, aal);
    for (const t of ["foyer_evenements", "foyer_variantes", "plans_figes"]) assert.deepEqual(await q(`select 1 from public.${t}`), [], `${t} fermée en ${aal}`);
    await refuse(`insert into public.foyer_evenements (type, libelle, date, source) values ('retrait', 'x', '2027-01-01', 's')`, /row-level security/, "écriture " + aal);
    await refuse(`insert into public.foyer_variantes (nom) values ('x')`, /row-level security/, "écriture variante " + aal);
    await refuse(`insert into public.plans_figes (raison, horizon_mois, parametres, serie) values ('manuel', 12, '{}', '{}')`, /row-level security/, "écriture plan " + aal);
  }
  await comme(A, "aal2");
  for (const t of ["foyer_evenements", "foyer_variantes", "plans_figes"]) assert.equal((await q(`select 1 from public.${t}`)).length, 1, t + " lisible en aal2");
  await comme(C, "aal1");
  for (const t of ["foyer_evenements", "foyer_variantes", "plans_figes"]) assert.equal((await q(`select 1 from public.${t}`)).length, 1, t + " : sans facteur, aal1 suffit");
  await superu(); await vider();
});
test("aucune table à user_id sans politique restrictive (pendant du test de test/mfa-pglite.test.mjs, sur 0030)", async () => {
  await superu();
  const tables = (await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p')`)).map(r => r.relname);
  for (const t of ["foyer_evenements", "foyer_variantes", "plans_figes"]) assert.ok(tables.includes(t), t + " repérée");
  for (const t of tables) assert.ok((await q(`select 1 from pg_policies where schemaname = 'public' and tablename = $1 and permissive = 'RESTRICTIVE'`, [t])).length >= 1, t);
});

/* =========================================================================================================== appliquer_propositions : événements */
test("evenement : création, modification (fusion, params remplacés), suppression ; valeurs rognées ; variante_id ; ref obligatoire", async () => {
  await comme(A); await vider();
  const id = await accepte("evenement", { type: "naissance", personne: "foyer", libelle: "  Enfant 2  ", date: "2028-03-01", params: { enfant: "Enfant 2", cout_mode: "uc" }, source: " cas fictif " }, "création");
  const e = await un(`select type, personne, libelle, date::text date, fin, params, source, variante_id, user_id from public.foyer_evenements`);
  assert.deepEqual([e.type, e.personne, e.libelle, e.date, e.fin, e.params, e.source, e.variante_id, e.user_id],
    ["naissance", "foyer", "Enfant 2", "2028-03-01", null, { enfant: "Enfant 2", cout_mode: "uc" }, "cas fictif", null, A]);
  assert.equal((await un(`select statut from public.propositions where id = '${id}'`)).statut, "acceptee");
  const ref = (await un(`select id from public.foyer_evenements`)).id;
  // modifier : fusion des champs fournis, params remplacés en entier, fin retirée par null
  await accepte("evenement", { libelle: "Naissance du 2e", date: "2028-04-01", fin: "2048-04-01", params: { enfant: "Enfant 2", cout_mode: "montant", cout_mensuel: 350 } }, "modification", { operation: "modifier", ref });
  let m = await un(`select libelle, date::text date, fin::text fin, params, personne, type from public.foyer_evenements`);
  assert.deepEqual([m.libelle, m.date, m.fin, m.params, m.personne, m.type], ["Naissance du 2e", "2028-04-01", "2048-04-01", { enfant: "Enfant 2", cout_mode: "montant", cout_mensuel: 350 }, "foyer", "naissance"]);
  await accepte("evenement", { fin: null }, "fin retirée", { operation: "modifier", ref });
  assert.equal((await un(`select fin from public.foyer_evenements`)).fin, null);
  // modifier : le résultat fusionné est validé
  await refusee("evenement", { params: { enfant: "Enfant 2", cout_mode: "montant" } }, /Indique le coût mensuel de l'enfant\./, "montant manquant après fusion", { operation: "modifier", ref });
  await refusee("evenement", { date: "1949-01-01" }, /La date doit être comprise/, "date hors bornes après fusion", { operation: "modifier", ref });
  // supprimer
  await accepte("evenement", null, "suppression", { operation: "supprimer", ref });
  assert.equal((await q(`select 1 from public.foyer_evenements`)).length, 0);
  await refusee("evenement", null, /événement « .* » introuvable/, "supprimer un événement absent", { operation: "supprimer", ref });
  await refusee("evenement", { libelle: "x" }, /événement « .* » introuvable/, "modifier un événement absent", { operation: "modifier", ref });
  await refuse(`insert into public.propositions (cible, operation, apres, source) values ('evenement', 'modifier', '{"libelle":"x"}', 's')`, /propositions_ref/, "ref obligatoire pour modifier");
  await refuse(`insert into public.propositions (cible, operation, source) values ('variante', 'supprimer', 's')`, /propositions_ref/, "ref obligatoire pour supprimer");
  await superu();
});
test("evenement : variante_id vers une variante de A, refusé vers celle de B ou inexistante ; déplacement vers la situation actuelle", async () => {
  await superu(); await vider();
  const [va] = await insVar(A, { nom: "VA" }), [vb] = await insVar(B, { nom: "VB" });
  await comme(A);
  const base = { type: "retrait", personne: "foyer", libelle: "Voiture", date: "2027-06-01", params: { montant: 5000 }, source: "cas fictif" };
  await accepte("evenement", { ...base, variante_id: va.id }, "variante de A");
  assert.equal((await un(`select variante_id from public.foyer_evenements`)).variante_id, va.id);
  await refusee("evenement", { ...base, variante_id: vb.id }, /variante « .* » introuvable/, "variante de B");
  await refusee("evenement", { ...base, variante_id: "00000000-0000-4000-8000-000000000000" }, /variante « .* » introuvable/, "variante inconnue");
  await refusee("evenement", { ...base, variante_id: "pas-un-uuid" }, /variante_id invalide/, "variante_id mal formé");
  const ref = (await un(`select id from public.foyer_evenements`)).id;
  await accepte("evenement", { variante_id: null }, "retour à la situation actuelle", { operation: "modifier", ref });
  assert.equal((await un(`select variante_id from public.foyer_evenements`)).variante_id, null);
  await refusee("evenement", { variante_id: vb.id }, /variante « .* » introuvable/, "déplacement vers B", { operation: "modifier", ref });
  await superu(); await vider();
});
test("evenement : champ inconnu refusé ; types réservés refusés par la RPC (mais acceptés par la table)", async () => {
  await comme(A); await vider();
  await refusee("evenement", { type: "retrait", personne: "foyer", libelle: "x", date: "2027-01-01", params: { montant: 1 }, source: "s", montant: 5 }, /champ « montant » inconnu/, "champ inconnu");
  for (const t of TYPES_RESERVES) {
    const m = await refusee("evenement", { type: t, personne: "foyer", libelle: "x", date: "2027-01-01", params: {}, source: "s" }, /Ce type d'événement n'est pas encore pris en compte par la projection\./, "réservé " + t);
    assert.equal(m, "Proposition non appliquée (événement, creer) : Ce type d'événement n'est pas encore pris en compte par la projection..", t);   // le message se termine par un point, le gabarit ajoute le sien
  }
  assert.equal((await q(`select 1 from public.foyer_evenements`)).length, 0);
  await superu();
});

/* ---------- parité avec web/src/projection-evenements.js ---------- */
const remplacer = (o) => JSON.parse(JSON.stringify(o).replaceAll("credit:c-auto", "credit:" + CREDIT_A));
/** Contexte JS d'un utilisateur : crédits et biens de A, date du jour de la base. */
const contexte = () => ({ today: AUJ, credits: [{ id: CREDIT_A }], biens: [{ id: BIEN_A }] });
const fond = (type, params, extra) => ({ type, personne: "foyer", libelle: "Libellé", date: "2027-06-01", params, source: "cas fictif", ...extra });

test("V-1 à V-15 de la fixture : messages identiques via la RPC (contexte = crédits et biens de A ; ids de la fixture remplacés)", async () => {
  await comme(A); await vider();
  const cas = FIXTURE.cas.filter(c => c.famille === "validation");
  assert.equal(cas.length, 15);
  for (const c of cas) {
    const evt = remplacer(c.options.evenement);
    const attendu = c.attendu;
    assert.equal(E.validerEvenement(evt, contexte()), attendu, c.id + " : le JS donne l'attendu de la fixture");
    const r = await essayer("evenement", evt);
    if (attendu === null) { assert.equal(r.message, undefined, c.id + " : " + r.message); await db.exec(`delete from public.foyer_evenements`); }
    else assert.equal(r.message, `Proposition non appliquée (événement, creer) : ${attendu}.`, c.id);
  }
  await superu();
});

/* Jeu supplémentaire : chaque message de validerEvenement au moins une fois, avec les cas limites de forme (chaînes numériques, null, "", types). */
function casSupplementaires() {
  const d40 = O.ajouterAns(AUJ, 40), d40p = O.ajouterJours(d40, 1);
  const L = [
    ["date : exactement dans 40 ans", fond("retrait", { montant: 10 }, { date: d40 })],
    ["date : un jour de trop", fond("retrait", { montant: 10 }, { date: d40p })],
    ["date : 1950-01-01", fond("retrait", { montant: 10 }, { date: "1950-01-01" })],
    ["date : 1949-12-31", fond("retrait", { montant: 10 }, { date: "1949-12-31" })],
    ["date : 30 février", fond("retrait", { montant: 10 }, { date: "2027-02-30" })],
    ["date : format JJ/MM/AAAA", fond("retrait", { montant: 10 }, { date: "01/06/2027" })],
    ["date : nombre", fond("retrait", { montant: 10 }, { date: 20270601 })],
    ["fin : après la limite de 40 ans", fond("creche", { enfant: "E", mode: "psu" }, { fin: d40p })],
    ["fin : mal formée", fond("creche", { enfant: "E", mode: "psu" }, { fin: "demain" })],
    ["fin : vide ignorée", fond("creche", { enfant: "E", mode: "psu" }, { fin: "" })],
    ["fin : avant la date", fond("creche", { enfant: "E", mode: "psu" }, { fin: "2027-05-31" })],
    ["fin : égale à la date", fond("creche", { enfant: "E", mode: "psu" }, { fin: "2027-06-01" })],
    ["libellé : espaces seulement", fond("retrait", { montant: 10 }, { libelle: "   " })],
    ["libellé : 60 caractères", fond("retrait", { montant: 10 }, { libelle: "é".repeat(60) })],
    ["libellé : 61 caractères", fond("retrait", { montant: 10 }, { libelle: "é".repeat(61) })],
    ["libellé : 60 caractères entourés d'espaces", fond("retrait", { montant: 10 }, { libelle: " " + "a".repeat(60) + " " })],
    ["libellé : 30 emojis (60 unités UTF-16)", fond("retrait", { montant: 10 }, { libelle: "😀".repeat(30) })],
    ["libellé : 31 emojis (62 unités UTF-16)", fond("retrait", { montant: 10 }, { libelle: "😀".repeat(31) })],
    ["libellé : nombre", fond("retrait", { montant: 10 }, { libelle: 12 })],
    ["libellé : absent", (() => { const e = fond("retrait", { montant: 10 }); delete e.libelle; return e; })()],
    ["personne : absente", (() => { const e = fond("retrait", { montant: 10 }); delete e.personne; return e; })()],
    ["personne : majuscule", fond("retrait", { montant: 10 }, { personne: "P1" })],
    ["source : vide", fond("retrait", { montant: 10 }, { source: "" })],
    ["source : 300 caractères", fond("retrait", { montant: 10 }, { source: "s".repeat(300) })],
    ["source : 301 caractères", fond("retrait", { montant: 10 }, { source: "s".repeat(301) })],
    ["source : absente", (() => { const e = fond("retrait", { montant: 10 }); delete e.source; return e; })()],
    ["params : absent (traité comme {})", (() => { const e = fond("retrait", { montant: 10 }); delete e.params; return e; })()],
    ["params : null", fond("retrait", { montant: 10 }, { params: null })],
    ["params : tableau", fond("retrait", { montant: 10 }, { params: [] })],
    ["type : absent", (() => { const e = fond("retrait", { montant: 10 }); delete e.type; return e; })()],
    ["type : inconnu", fond("retrait", { montant: 10 }, { type: "voyage" })],
    ["type : nombre", fond("retrait", { montant: 10 }, { type: 7 })],
    ["naissance : valide, mode par défaut", fond("naissance", { enfant: "Enfant 2" })],
    ["naissance : enfant absent", fond("naissance", {})],
    ["naissance : enfant 40 caractères", fond("naissance", { enfant: "e".repeat(40) })],
    ["naissance : enfant 41 caractères", fond("naissance", { enfant: "e".repeat(41) })],
    ["naissance : mode de coût inconnu", fond("naissance", { enfant: "E", cout_mode: "forfait" })],
    ["naissance : mode de coût vide (défaut uc)", fond("naissance", { enfant: "E", cout_mode: "" })],
    ["naissance : coût négatif", fond("naissance", { enfant: "E", cout_mode: "montant", cout_mensuel: -1 })],
    ["naissance : coût en texte numérique", fond("naissance", { enfant: "E", cout_mode: "montant", cout_mensuel: "350,5" })],
    ["naissance : coût en texte numérique valide", fond("naissance", { enfant: "E", cout_mode: "montant", cout_mensuel: " 350.5 " })],
    ["naissance : mode montant sans coût", fond("naissance", { enfant: "E", cout_mode: "montant" })],
    ["naissance : mode montant, coût 0", fond("naissance", { enfant: "E", cout_mode: "montant", cout_mensuel: 0 })],
    ["naissance : fin_age 0", fond("naissance", { enfant: "E", fin_age: 0 })],
    ["naissance : fin_age 30", fond("naissance", { enfant: "E", fin_age: 30 })],
    ["naissance : fin_age 31", fond("naissance", { enfant: "E", fin_age: 31 })],
    ["naissance : fin_age en texte", fond("naissance", { enfant: "E", fin_age: "abc" })],
    ["creche : psu valide", fond("creche", { enfant: "E", mode: "psu", heures_mois: 200 })],
    ["creche : mode par défaut", fond("creche", { enfant: "E" })],
    ["creche : enfant manquant", fond("creche", { mode: "psu" })],
    ["creche : mode inconnu", fond("creche", { enfant: "E", mode: "nounou" })],
    ["creche : heures négatives", fond("creche", { enfant: "E", mode: "psu", heures_mois: -5 })],
    ["creche : ressources négatives", fond("creche", { enfant: "E", mode: "psu", ressources_mensuelles: -5 })],
    ["creche : cmg négatif", fond("creche", { enfant: "E", mode: "assistante_maternelle", cout_mensuel: 900, cmg_mensuel: -1 })],
    ["creche : assistante sans coût", fond("creche", { enfant: "E", mode: "assistante_maternelle" })],
    ["creche : assistante avec coût", fond("creche", { enfant: "E", mode: "assistante_maternelle", cout_mensuel: 900, cmg_mensuel: 300 })],
    ["creche : montant sans coût", fond("creche", { enfant: "E", mode: "montant" })],
    ["creche : montant avec coût nul", fond("creche", { enfant: "E", mode: "montant", cout_mensuel: 0 })],
    ["scolarite : valide", fond("scolarite_privee", { enfant: "E", niveau: "lycee", frais_annuels: 5000 })],
    ["scolarite : enfant manquant", fond("scolarite_privee", { niveau: "lycee", frais_annuels: 5000 })],
    ["scolarite : niveau inconnu", fond("scolarite_privee", { enfant: "E", niveau: "master", frais_annuels: 5000 })],
    ["scolarite : frais négatifs", fond("scolarite_privee", { enfant: "E", niveau: "lycee", frais_annuels: -1 })],
    ["scolarite : frais absents", fond("scolarite_privee", { enfant: "E", niveau: "lycee" })],
    ["scolarite : frais nuls", fond("scolarite_privee", { enfant: "E", niveau: "lycee", frais_annuels: 0 })],
    ["achat : valide", fond("achat_immobilier", { prix: 250000, apport: 40000, pret: { duree_ans: 20 }, charges_mensuelles: 200 })],
    ["achat : apport max, locatif, taux fourni", fond("achat_immobilier", { prix: 250000, apport: "max", usage: "locatif", pret: { duree_ans: 20, taux_pct: 3.4 }, charges_mensuelles: 0 })],
    ["achat : prix négatif", fond("achat_immobilier", { prix: -1, apport: 0, pret: { duree_ans: 20 }, charges_mensuelles: 1 })],
    ["achat : apport négatif", fond("achat_immobilier", { prix: 100, apport: -1, pret: { duree_ans: 20 }, charges_mensuelles: 1 })],
    ["achat : taux négatif", fond("achat_immobilier", { prix: 100, apport: 0, pret: { duree_ans: 20, taux_pct: -0.5 }, charges_mensuelles: 1 })],
    ["achat : assurance négative", fond("achat_immobilier", { prix: 100, apport: 0, pret: { duree_ans: 20, assurance_pct: -0.5 }, charges_mensuelles: 1 })],
    ["achat : loyer perçu négatif", fond("achat_immobilier", { prix: 100, apport: 0, pret: { duree_ans: 20 }, charges_mensuelles: 1, loyer_percu: -3 })],
    ["achat : prix absent", fond("achat_immobilier", { apport: 0, pret: { duree_ans: 20 }, charges_mensuelles: 1 })],
    ["achat : prix en texte", fond("achat_immobilier", { prix: "abc", apport: 0, pret: { duree_ans: 20 }, charges_mensuelles: 1 })],
    ["achat : usage inconnu", fond("achat_immobilier", { prix: 100, usage: "vacances", apport: 0, pret: { duree_ans: 20 }, charges_mensuelles: 1 })],
    ["achat : apport absent", fond("achat_immobilier", { prix: 100, pret: { duree_ans: 20 }, charges_mensuelles: 1 })],
    ["achat : apport « maximum »", fond("achat_immobilier", { prix: 100, apport: "maximum", pret: { duree_ans: 20 }, charges_mensuelles: 1 })],
    ["achat : prêt absent", fond("achat_immobilier", { prix: 100, apport: 0, charges_mensuelles: 1 })],
    ["achat : durée 0", fond("achat_immobilier", { prix: 100, apport: 0, pret: { duree_ans: 0 }, charges_mensuelles: 1 })],
    ["achat : durée 40", fond("achat_immobilier", { prix: 100, apport: 0, pret: { duree_ans: 40 }, charges_mensuelles: 1 })],
    ["achat : durée 41", fond("achat_immobilier", { prix: 100, apport: 0, pret: { duree_ans: 41 }, charges_mensuelles: 1 })],
    ["achat : charges absentes", fond("achat_immobilier", { prix: 100, apport: 0, pret: { duree_ans: 20 } })],
    ["achat : prêt n'est pas un objet", fond("achat_immobilier", { prix: 100, apport: 0, pret: 20, charges_mensuelles: 1 })],
    ["retrait : valide", fond("retrait", { montant: 15000 })],
    ["retrait : montant nul", fond("retrait", { montant: 0 })],
    ["retrait : montant absent", fond("retrait", {})],
    ["retrait : montant négatif", fond("retrait", { montant: -1 })],
    ["retrait : montant booléen", fond("retrait", { montant: true })],
    ["hausse : valide en delta_mensuel", fond("hausse_revenu", { personne: "p1", delta_mensuel: -400 })],
    ["hausse : valide en delta_pct", fond("hausse_revenu", { personne: "p2", delta_pct: 5 })],
    ["hausse : personne du paramètre prime", fond("hausse_revenu", { personne: "p2", delta_mensuel: 100 }, { personne: "foyer" })],
    ["hausse : personne de l'événement", fond("hausse_revenu", { delta_mensuel: 100 }, { personne: "p1" })],
    ["hausse : personne foyer", fond("hausse_revenu", { delta_mensuel: 100 })],
    ["hausse : variation absente", fond("hausse_revenu", { personne: "p1" })],
    ["hausse : part épargnée 101", fond("hausse_revenu", { personne: "p1", delta_mensuel: 100, part_epargnee_pct: 101 })],
    ["hausse : part épargnée -1", fond("hausse_revenu", { personne: "p1", delta_mensuel: 100, part_epargnee_pct: -1 })],
    ["hausse : part épargnée 100", fond("hausse_revenu", { personne: "p1", delta_mensuel: 100, part_epargnee_pct: 100 })],
    ["hausse : part épargnée en texte", fond("hausse_revenu", { personne: "p1", delta_mensuel: "100", part_epargnee_pct: "50" })],
    ["fin_credit : crédit de A", fond("fin_credit", { credit: "credit:" + CREDIT_A, part_reaffectee_epargne_pct: 40 })],
    ["fin_credit : bien de A", fond("fin_credit", { credit: "bien:" + BIEN_A })],
    ["fin_credit : crédit de B", fond("fin_credit", { credit: "credit:" + CREDIT_B })],
    ["fin_credit : bien de B", fond("fin_credit", { credit: "bien:" + BIEN_B })],
    ["fin_credit : bien donné comme crédit", fond("fin_credit", { credit: "credit:" + BIEN_A })],
    ["fin_credit : crédit donné comme bien", fond("fin_credit", { credit: "bien:" + CREDIT_A })],
    ["fin_credit : sans préfixe", fond("fin_credit", { credit: CREDIT_A })],
    ["fin_credit : préfixe inconnu", fond("fin_credit", { credit: "pret:" + CREDIT_A })],
    ["fin_credit : identifiant vide", fond("fin_credit", { credit: "credit:" })],
    ["fin_credit : absent", fond("fin_credit", {})],
    ["fin_credit : nombre", fond("fin_credit", { credit: 5 })],
    ["fin_credit : part réaffectée 120", fond("fin_credit", { credit: "credit:" + CREDIT_A, part_reaffectee_epargne_pct: 120 })],
    ["fin_credit : date_fin valide", fond("fin_credit", { credit: "credit:" + CREDIT_A, date_fin: "2028-01-01" })],
    ["fin_credit : date_fin invalide", fond("fin_credit", { credit: "credit:" + CREDIT_A, date_fin: "2028-13-01" })],
    ["fin_credit : date_fin vide ignorée", fond("fin_credit", { credit: "credit:" + CREDIT_A, date_fin: "" })],
    ["crise : covid", fond("crise", { cle: "covid_2020" })],
    ["crise : chacune des cinq", fond("crise", { cle: "inflation_1973" })],
    ["crise : inconnue", fond("crise", { cle: "krach_1929" })],
    ["crise : clé absente", fond("crise", {})],
    ["crise : clé en nombre", fond("crise", { cle: 1 })],
    ["emploi : valide, salaire nul", fond("changement_emploi", { personne: "p1", salaire_net_mensuel: 0 }, { personne: "p1" })],
    ["emploi : valide avec référence", fond("changement_emploi", { personne: "p2", salaire_net_mensuel: 2500, revenu_reference_mensuel: 2000, part_epargnee_pct: 30 }, { personne: "p2" })],
    ["emploi : personne foyer", fond("changement_emploi", { salaire_net_mensuel: 2500 })],
    ["emploi : salaire absent", fond("changement_emploi", { personne: "p2" })],
    ["emploi : salaire négatif", fond("changement_emploi", { personne: "p2", salaire_net_mensuel: -1 })],
    ["emploi : référence négative", fond("changement_emploi", { personne: "p2", salaire_net_mensuel: 1, revenu_reference_mensuel: -1 })],
    ["emploi : part épargnée 150", fond("changement_emploi", { personne: "p2", salaire_net_mensuel: 1, part_epargnee_pct: 150 })],
    ["congé : valide", fond("conge_parental", { personne: "p2", activite: "mi_temps" }, { personne: "p2", fin: "2027-12-01" })],
    ["congé : activité inconnue", fond("conge_parental", { personne: "p2", activite: "sabbatique" }, { personne: "p2", fin: "2027-12-01" })],
    ["congé : sans fin", fond("conge_parental", { personne: "p2", activite: "arret" }, { personne: "p2" })],
    ["congé : fin vide", fond("conge_parental", { personne: "p2", activite: "arret" }, { personne: "p2", fin: "" })],
    ["congé : personne foyer", fond("conge_parental", { activite: "arret" }, { fin: "2027-12-01" })],
    ["congé : quotité 101", fond("conge_parental", { personne: "p2", activite: "temps_partiel", quotite_pct: 101 }, { personne: "p2", fin: "2027-12-01" })],
    ["congé : quotité 80", fond("conge_parental", { personne: "p2", activite: "temps_partiel", quotite_pct: 80 }, { personne: "p2", fin: "2027-12-01" })],
    ["congé : rang 0", fond("conge_parental", { personne: "p2", activite: "arret", rang_enfant: 0 }, { personne: "p2", fin: "2027-12-01" })],
    ["congé : rang 1,5", fond("conge_parental", { personne: "p2", activite: "arret", rang_enfant: 1.5 }, { personne: "p2", fin: "2027-12-01" })],
    ["congé : rang 2 en texte", fond("conge_parental", { personne: "p2", activite: "arret", rang_enfant: "2" }, { personne: "p2", fin: "2027-12-01" })],
    ["congé : rang 2 valide", fond("conge_parental", { personne: "p2", activite: "arret", rang_enfant: 2 }, { personne: "p2", fin: "2027-12-01" })],
    ...TYPES_RESERVES.map(t => ["réservé : " + t, fond(t, {})]),
  ];
  return L;
}

test("parité JS ↔ SQL : au moins 15 cas supplémentaires (plus d'une centaine ici), même message ou même acceptation ; chaque message du JS est produit", async () => {
  await comme(A); await vider();
  const cas = casSupplementaires();
  assert.ok(cas.length >= 100, "jeu supplémentaire : " + cas.length);
  const vus = new Set();
  for (const [nom, evt] of cas) {
    const attendu = E.validerEvenement(evt, contexte());
    if (attendu) vus.add(attendu);
    const r = await essayer("evenement", evt);
    if (attendu === null) { assert.equal(r.message, undefined, nom + " : accepté par le JS, refusé par SQL : " + r.message); await db.exec(`delete from public.foyer_evenements`); }
    else assert.equal(r.message, `Proposition non appliquée (événement, creer) : ${attendu}.`, nom);
  }
  // couverture : toutes les phrases terminées par un point qui sont retournées par validerEvenement apparaissent dans les résultats
  const src = readFileSync(new URL("../web/src/projection-evenements.js", import.meta.url), "utf8");
  const debut = src.indexOf("function validerEvenement"), fin = src.indexOf("/* -------- variantes -------- */");
  const zone = src.slice(debut, fin) + src.slice(src.indexOf("const M = {"), src.indexOf("M.type_inconnu"));
  const phrases = [...zone.matchAll(/"([^"\n]{20,}?\.)"/g)].map(m => m[1]).filter(s => /^[A-ZÉ«]/.test(s) && !s.includes(" + "));
  for (const k of Object.values(E.MESSAGES)) if (!vus.has(k) && k !== E.MESSAGES.type_inconnu) assert.fail("message jamais produit par le jeu de cas : " + k);
  // « L'événement doit être un objet. » ne peut pas sortir d'une proposition (l'apres d'une proposition est toujours un objet) : vérifié en direct plus bas
  for (const p of phrases) if (!vus.has(p) && p !== "L'événement doit être un objet.") assert.fail("message du JS jamais produit par le jeu de cas : " + p);
  assert.ok(vus.has(E.MESSAGES.type_inconnu), "Type d'événement inconnu produit");
  assert.ok([...vus].some(m => /^Crise inconnue/.test(m)));
  await superu();
});
test("chaque message de web/src/projection-evenements.js (hors messages construits) figure à l'identique dans la migration", () => {
  const src = readFileSync(new URL("../web/src/projection-evenements.js", import.meta.url), "utf8");
  const phrases = [...src.matchAll(/"([^"\n]{20,}?[.»)])"/g)].map(m => m[1]).filter(s => /^[A-ZÉ«L]/.test(s) && s.includes(" ") && !/^Choisis parmi/.test(s));
  assert.ok(phrases.length >= 40, "phrases repérées : " + phrases.length);
  const manquantes = phrases.filter(p => !SQL.includes(p.replaceAll("'", "''")));
  assert.deepEqual(manquantes, [], "phrases du JS absentes de la migration");
});

test("liste des crises et des classes de variante : celles de web/src/marche.js (messages construits) ; objets invalides en appel direct", async () => {
  const crises = Object.keys(MARCHE.CRISES);
  assert.equal(E.validerEvenement(fond("crise", { cle: "x" }), contexte()), "Crise inconnue : choisis parmi " + crises.join(", ") + ".");
  assert.ok(SQL.includes("Crise inconnue : choisis parmi " + crises.join(", ") + "."));
  const classes = MARCHE.CLES.filter(k => k !== "levier");
  for (const k of [...classes, "actions_nasdaq100", "immobilier_physique"]) {
    assert.equal(E.validerVariante({ nom: "v", hypotheses: { hypotheses_classes: { [k]: { rendement: 3 } } } }), null, k);
    assert.ok(SQL.includes("'" + k + "'"), k + " dans la migration");
  }
  assert.ok(SQL.includes("Type d''événement inconnu : choisis parmi " + TYPES_V1.join(", ") + "."));
  assert.ok(SQL.includes("' ». Choisis parmi " + E.HYPOTHESES_VARIANTE.join(", ") + ".'"), "message de l'hypothèse inconnue");
  assert.equal(E.validerEvenement(null, contexte()), "L'événement doit être un objet.");
  assert.equal(E.validerVariante(null), "La variante doit être un objet.");
  assert.ok(SQL.includes("L''événement doit être un objet.") && SQL.includes("La variante doit être un objet."));
  await superu();
  assert.equal((await un(`select public.foyer_valider_evenement('[]'::jsonb) m`)).m, "L'événement doit être un objet.", "appel direct de la fonction pure");
  assert.equal((await un(`select public.foyer_valider_evenement(null) m`)).m, "L'événement doit être un objet.");
  assert.equal((await un(`select public.foyer_valider_variante('"x"'::jsonb) m`)).m, "La variante doit être un objet.");
});

test("limite de 100 événements par la RPC : le 100e passe, le 101e est refusé avec un message clair, rien n'est ajouté", async () => {
  await superu(); await vider();
  await db.exec(`insert into public.foyer_evenements (user_id, type, libelle, date, source) select '${A}', 'retrait', 'e' || g, '2027-01-01', 's' from generate_series(1, 99) g`);
  await comme(A);
  const e = { type: "retrait", personne: "foyer", libelle: "100e", date: "2027-01-01", params: { montant: 1 }, source: "s" };
  await accepte("evenement", e, "100e");
  const m = await refusee("evenement", { ...e, libelle: "101e" }, /Limite atteinte : 100 événements au plus/, "101e");
  assert.match(m, /^Proposition non appliquée \(événement, creer\) : /);
  assert.equal((await un(`select count(*)::int n from public.foyer_evenements`)).n, 100);
  // modifier et supprimer restent possibles à la limite
  const ref = (await un(`select id from public.foyer_evenements where libelle = '100e'`)).id;
  await accepte("evenement", { libelle: "100e bis" }, "modifier à la limite", { operation: "modifier", ref });
  await accepte("evenement", null, "supprimer à la limite", { operation: "supprimer", ref });
  await accepte("evenement", { ...e, libelle: "à nouveau 100" }, "recréer après suppression");
  await superu(); await vider();
});

/* =========================================================================================================== variantes */
const V = {
  nom: "2e enfant", description: "Avec une naissance et la crèche", retire: ["11111111-1111-4111-8111-111111111111"],
  hypotheses: { epargne_delta_mensuel: 200, reste_capacite: "cible" },
};
test("variante : création, modification (fusion), suppression ; valeurs stockées ; événements supprimés avec elle", async () => {
  await comme(A); await vider();
  await accepte("variante", V, "création");
  const v = await un(`select nom, description, retire, hypotheses, user_id from public.foyer_variantes`);
  assert.deepEqual([v.nom, v.description, v.retire, v.hypotheses, v.user_id], ["2e enfant", "Avec une naissance et la crèche", ["11111111-1111-4111-8111-111111111111"], { epargne_delta_mensuel: 200, reste_capacite: "cible" }, A]);
  const ref = (await un(`select id from public.foyer_variantes`)).id;
  await accepte("variante", { nom: "Renommée", hypotheses: { reequilibrage: "annuel" } }, "modification", { operation: "modifier", ref });
  const m = await un(`select nom, description, hypotheses, retire from public.foyer_variantes`);
  assert.deepEqual([m.nom, m.description, m.hypotheses, m.retire], ["Renommée", "Avec une naissance et la crèche", { reequilibrage: "annuel" }, ["11111111-1111-4111-8111-111111111111"]], "champs fournis remplacés, les autres conservés");
  await refusee("variante", { hypotheses: { inconnue: 1 } }, /Hypothèse inconnue : « inconnue »/, "modification invalide", { operation: "modifier", ref });
  await accepte("evenement", { type: "retrait", personne: "foyer", libelle: "Voyage", date: "2027-06-01", params: { montant: 2000 }, source: "s", variante_id: ref }, "événement de la variante");
  await accepte("evenement", { type: "retrait", personne: "foyer", libelle: "Base", date: "2027-06-01", params: { montant: 2000 }, source: "s" }, "événement de la base");
  await accepte("variante", null, "suppression", { operation: "supprimer", ref });
  assert.deepEqual((await q(`select libelle from public.foyer_evenements`)).map(r => r.libelle), ["Base"], "les événements de la variante sont partis avec elle");
  await refusee("variante", null, /variante « .* » introuvable/, "suppression d'une variante absente", { operation: "supprimer", ref });
  await refusee("variante", { nom: "x" }, /variante « .* » introuvable/, "modification d'une variante absente", { operation: "modifier", ref });
  await refusee("variante", { nom: "x", couleur: "rouge" }, /champ « couleur » inconnu/, "champ inconnu");
  await superu();
});
function casVariantes() {
  const id = "11111111-1111-4111-8111-111111111111";
  const h = hypotheses => ({ nom: "v", hypotheses });
  return [
    ["valide complète", V], ["valide minimale", { nom: "v" }], ["nom vide", { nom: "" }], ["nom 40", { nom: "n".repeat(40) }], ["nom 41", { nom: "n".repeat(41) }],
    ["nom espaces", { nom: "   " }], ["nom absent", {}], ["nom nombre", { nom: 3 }],
    ["description 300", { nom: "v", description: "d".repeat(300) }], ["description 301", { nom: "v", description: "d".repeat(301) }],
    ["description vide", { nom: "v", description: "" }], ["description nombre", { nom: "v", description: 5 }], ["description null", { nom: "v", description: null }],
    ["retire valide", { nom: "v", retire: [id, id.replace(/1/g, "A")] }], ["retire vide", { nom: "v", retire: [] }], ["retire pas un uuid", { nom: "v", retire: ["pas-un-uuid"] }],
    ["retire pas une liste", { nom: "v", retire: id }], ["retire nombre dans la liste", { nom: "v", retire: [id, 4] }], ["retire null", { nom: "v", retire: null }],
    ["hypothèses null", { nom: "v", hypotheses: null }], ["hypothèses tableau", { nom: "v", hypotheses: [] }], ["hypothèses texte", { nom: "v", hypotheses: "x" }],
    ["hypothèse inconnue", h({ inconnue: 1 })],
    ["delta d'épargne 100000", h({ epargne_delta_mensuel: 100000 })], ["delta d'épargne -100000", h({ epargne_delta_mensuel: -100000 })],
    ["delta d'épargne 100001", h({ epargne_delta_mensuel: 100001 })], ["delta d'épargne texte", h({ epargne_delta_mensuel: "abc" })], ["delta d'épargne texte numérique", h({ epargne_delta_mensuel: "250" })],
    ["reste cible", h({ reste_capacite: "cible" })], ["reste disponible", h({ reste_capacite: "disponible" })], ["reste inconnu", h({ reste_capacite: "x" })],
    ["rééquilibrage aucun", h({ reequilibrage: "aucun" })], ["rééquilibrage annuel", h({ reequilibrage: "annuel" })], ["rééquilibrage inconnu", h({ reequilibrage: "mensuel" })],
    ["part réaffectée 100", h({ part_reaffectee_epargne_pct: 100 })], ["part réaffectée 120", h({ part_reaffectee_epargne_pct: 120 })], ["part réaffectée -1", h({ part_reaffectee_epargne_pct: -1 })],
    ["part de hausse 101", h({ part_hausse_epargnee_pct: 101 })], ["part de hausse 0", h({ part_hausse_epargnee_pct: 0 })], ["part de hausse texte", h({ part_hausse_epargnee_pct: "x" })],
    ["salaire 10", h({ salaire_croissance_reelle_pct: 10 })], ["salaire -10", h({ salaire_croissance_reelle_pct: -10 })], ["salaire 10,5", h({ salaire_croissance_reelle_pct: 10.5 })], ["salaire -11", h({ salaire_croissance_reelle_pct: -11 })],
    ["classes valide", h({ hypotheses_classes: { actions: { rendement: 12 } } })], ["classes volatilité seule", h({ hypotheses_classes: { actions_nasdaq100: { volatilite: 30 } } })],
    ["classes vide", h({ hypotheses_classes: {} })], ["classes pas un objet", h({ hypotheses_classes: [] })], ["classe inconnue", h({ hypotheses_classes: { bitcoin: { rendement: 12 } } })],
    ["classe levier refusée", h({ hypotheses_classes: { levier: { rendement: 12 } } })], ["classe pas un objet", h({ hypotheses_classes: { actions: 5 } })],
    ["rendement 100", h({ hypotheses_classes: { actions: { rendement: 100 } } })], ["rendement 101", h({ hypotheses_classes: { actions: { rendement: 101 } } })],
    ["rendement -50", h({ hypotheses_classes: { actions: { rendement: -50 } } })], ["rendement -51", h({ hypotheses_classes: { actions: { rendement: -51 } } })],
    ["volatilité 200", h({ hypotheses_classes: { or: { volatilite: 200 } } })], ["volatilité 201", h({ hypotheses_classes: { or: { volatilite: 201 } } })], ["volatilité -1", h({ hypotheses_classes: { or: { volatilite: -1 } } })],
    ["classes nulles", h({ hypotheses_classes: null })],
    ["delta d'épargne 0", h({ epargne_delta_mensuel: 0 })], ["delta d'épargne vide", h({ epargne_delta_mensuel: "" })], ["reste vide", h({ reste_capacite: "" })],
    ["plusieurs hypothèses valides", h({ epargne_delta_mensuel: -250, reste_capacite: "disponible", reequilibrage: "annuel", part_reaffectee_epargne_pct: 50, part_hausse_epargnee_pct: 50, salaire_croissance_reelle_pct: 1 })],
    ["retire : majuscules", { nom: "v", retire: [id.toUpperCase()] }], ["retire : uuid trop court", { nom: "v", retire: ["11111111-1111-4111-8111-11111111111"] }],
  ];
}
test("parité JS ↔ SQL des variantes (plus de soixante cas) : même message ou même acceptation", async () => {
  await comme(A); await vider();
  const cas = casVariantes();
  assert.ok(cas.length >= 60);
  const vus = new Set();
  for (const [nom, v] of cas) {
    const attendu = E.validerVariante(v);
    if (attendu) vus.add(attendu);
    const r = await essayer("variante", v);
    if (attendu === null) { assert.equal(r.message, undefined, nom + " : accepté par le JS, refusé par SQL : " + r.message); await db.exec(`delete from public.foyer_variantes`); }
    else assert.equal(r.message, `Proposition non appliquée (variante, creer) : ${attendu}.`, nom);
  }
  const src = readFileSync(new URL("../web/src/projection-evenements.js", import.meta.url), "utf8");
  const zone = src.slice(src.indexOf("function validerVariante"), src.indexOf("/** Valeurs par défaut sourcées"));
  const phrases = [...zone.matchAll(/"([^"\n]{20,}?[.»}])"/g)].map(m => m[1]).filter(s => /^[A-ZÉ«L]/.test(s) && !s.includes(" + "));
  for (const p of phrases) if (!vus.has(p) && p !== "La variante doit être un objet.") assert.fail("message de validerVariante jamais produit : " + p);
  await superu();
});
test("limite de 10 variantes par la RPC", async () => {
  await superu(); await vider();
  await db.exec(`insert into public.foyer_variantes (user_id, nom) select '${A}', 'v' || g from generate_series(1, 9) g`);
  await comme(A);
  await accepte("variante", { nom: "10e" }, "10e");
  await refusee("variante", { nom: "11e" }, /Limite atteinte : 10 variantes au plus/, "11e");
  assert.equal((await un(`select count(*)::int n from public.foyer_variantes`)).n, 10);
  await superu(); await vider();
});

/* =========================================================================================================== plans figés */
const PLAN = { raison: "revue_mensuelle", horizon_mois: 120, parametres: { horizon_ans: 10, vue: "net" }, serie: { mois: ["2026-11-14"], p50: [100000] } };
test("plan_fige : création, suppression ; modification impossible (contrainte de la table, puis de la fonction)", async () => {
  await comme(A); await vider();
  await accepte("plan_fige", PLAN, "création");
  const p = await un(`select raison, horizon_mois, parametres, serie, user_id, cree_le is not null c from public.plans_figes`);
  assert.deepEqual([p.raison, p.horizon_mois, p.parametres, p.serie, p.user_id, p.c], ["revue_mensuelle", 120, PLAN.parametres, PLAN.serie, A, true]);
  const ref = (await un(`select id from public.plans_figes`)).id;
  await refuse(`insert into public.propositions (cible, operation, ref, apres, source) values ('plan_fige', 'modifier', '${ref}', '{"raison":"manuel"}', 's')`, /propositions_plan_fige/, "modifier refusé par la table des propositions");
  await accepte("plan_fige", null, "suppression", { operation: "supprimer", ref });
  assert.equal((await q(`select 1 from public.plans_figes`)).length, 0);
  await refusee("plan_fige", null, /plan figé « .* » introuvable/, "supprimer un plan absent", { operation: "supprimer", ref });
  await refuse(`insert into public.propositions (cible, operation, source) values ('plan_fige', 'supprimer', 's')`, /propositions_ref/, "ref obligatoire pour supprimer");
  await superu();
});
test("plan_fige : validations (raison, horizon_mois entier de 1 à 300, objets, champ inconnu, tailles)", async () => {
  await comme(A); await vider();
  const t = async (apres, motif, m) => refusee("plan_fige", apres, motif, m);
  await t({ ...PLAN, raison: "autre" }, /plan figé : raison invalide/, "raison");
  await t({ ...PLAN, raison: undefined }, /plan figé : raison invalide/, "raison absente");
  for (const h of [0, 301, 1.5, "abc", null, true]) await t({ ...PLAN, horizon_mois: h }, /plan figé : horizon_mois invalide/, "horizon " + h);
  await t({ ...PLAN, horizon_mois: undefined }, /plan figé : horizon_mois invalide/, "horizon absent");
  await t({ ...PLAN, parametres: [] }, /plan figé : parametres : objet attendu/, "parametres tableau");
  await t({ ...PLAN, parametres: undefined }, /plan figé : parametres : objet attendu/, "parametres absent");
  await t({ ...PLAN, serie: "x" }, /plan figé : serie : objet attendu/, "serie texte");
  await t({ ...PLAN, extra: 1 }, /plan figé : champ « extra » inconnu/, "champ inconnu");
  const sur = (await un(`select octet_length(jsonb_build_object('x', '')::text) n`)).n;
  await t({ ...PLAN, parametres: { x: "a".repeat(100000 - sur + 1) } }, /plan figé : parametres : 100 000 octets au plus/, "parametres trop gros");
  await t({ ...PLAN, serie: { x: "a".repeat(250000 - sur + 1) } }, /plan figé : serie : 250 000 octets au plus/, "serie trop grosse");
  for (const h of [1, 300, "24"]) await accepte("plan_fige", { ...PLAN, horizon_mois: h }, "horizon " + h);
  await accepte("plan_fige", { ...PLAN, raison: "objectif", parametres: { x: "a".repeat(100000 - sur) }, serie: { x: "a".repeat(250000 - sur) } }, "tailles maximales (la proposition accepte plus de 20 000 octets pour un plan figé)");
  await superu(); await vider();
});
test("plan_fige : limite de 60 par la RPC ; supprimer le plan d'un autre est impossible", async () => {
  await superu(); await vider();
  await db.exec(`insert into public.plans_figes (user_id, raison, horizon_mois, parametres, serie) select '${A}', 'manuel', 12, '{}', '{}' from generate_series(1, 59) g`);
  await insPlan(B);
  const pb = (await un(`select id from public.plans_figes where user_id = '${B}'`)).id;
  await comme(A);
  await accepte("plan_fige", PLAN, "60e");
  await refusee("plan_fige", PLAN, /Limite atteinte : 60 plans figés au plus/, "61e");
  await refusee("plan_fige", null, /plan figé « .* » introuvable/, "plan de B", { operation: "supprimer", ref: pb });
  assert.equal((await un(`select count(*)::int n from public.plans_figes where user_id = '${A}'`)).n, 60);
  await superu(); await vider();
});

/* =========================================================================================================== tout ou rien, isolation */
test("tout ou rien : une proposition invalide annule les autres du même appel (événement, variante, plan, réglage)", async () => {
  await comme(A); await vider(); await reinitProjection();
  const bonne = await proposer("evenement", { type: "retrait", personne: "foyer", libelle: "OK", date: "2027-06-01", params: { montant: 5 }, source: "s" });
  const bonneV = await proposer("variante", { nom: "OK" });
  const bonnePlan = await proposer("plan_fige", PLAN);
  const bonneCfg = await proposer("config", { projection: { tmi_pct: 30 } });
  const mauvaise = await proposer("evenement", { type: "retrait", personne: "foyer", libelle: "KO", date: "2027-06-01", params: { montant: -5 }, source: "s" });
  await assert.rejects(appliquer([bonne, bonneV, bonnePlan, bonneCfg, mauvaise]), /Les montants doivent être positifs ou nuls\./);
  for (const t of ["foyer_evenements", "foyer_variantes", "plans_figes"]) assert.equal((await q(`select 1 from public.${t}`)).length, 0, t + " : rien d'appliqué");
  assert.deepEqual((await un(`select projection from public.config where user_id = '${A}'`)).projection, {});
  assert.deepEqual((await q(`select statut from public.propositions where id = any($1::uuid[])`, [[bonne, bonneV, bonnePlan, bonneCfg, mauvaise]])).map(r => r.statut), ["en_attente", "en_attente", "en_attente", "en_attente", "en_attente"]);
  assert.equal(await appliquer([bonne, bonneV, bonnePlan, bonneCfg]), 4, "sans la mauvaise : tout passe");
  await vider(); await reinitProjection();
  await superu();
});
test("isolation : B ne peut ni appliquer la proposition de A ni modifier ou supprimer l'événement, la variante ou le plan de A", async () => {
  await superu(); await vider();
  const [ea] = await insEv(A), [va] = await insVar(A), [pa] = await insPlan(A);
  await comme(A);
  const idA = await proposer("evenement", { libelle: "Modifié par A" }, { operation: "modifier", ref: ea.id });
  await comme(B);
  assert.equal(await appliquer([idA]), 0, "la proposition de A n'est pas visible de B");
  await refusee("evenement", { libelle: "pirate" }, /événement « .* » introuvable/, "modifier l'événement de A", { operation: "modifier", ref: ea.id });
  await refusee("evenement", null, /événement « .* » introuvable/, "supprimer l'événement de A", { operation: "supprimer", ref: ea.id });
  await refusee("variante", { nom: "pirate" }, /variante « .* » introuvable/, "modifier la variante de A", { operation: "modifier", ref: va.id });
  await refusee("variante", null, /variante « .* » introuvable/, "supprimer la variante de A", { operation: "supprimer", ref: va.id });
  await refusee("plan_fige", null, /plan figé « .* » introuvable/, "supprimer le plan de A", { operation: "supprimer", ref: pa.id });
  await refusee("evenement", { type: "retrait", personne: "foyer", libelle: "x", date: "2027-06-01", params: { montant: 1 }, source: "s", variante_id: va.id }, /variante « .* » introuvable/, "événement rattaché à la variante de A");
  await superu();
  assert.equal((await un(`select libelle from public.foyer_evenements where id = '${ea.id}'`)).libelle, "Voiture", "événement de A intact");
  await vider();
});
test("la RPC : session obligatoire, droits inchangés (authenticated seulement), search_path vide, security invoker ; helpers sans accès anon", async () => {
  await superu();
  const f = await un(`select p.prosecdef s, p.proconfig c, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth,
      has_function_privilege('public', p.oid, 'execute') pub from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'appliquer_propositions'`);
  assert.deepEqual([f.s, f.c, f.anon, f.auth, f.pub], [false, ['search_path=""'], false, true, false]);
  for (const nom of ["foyer_present", "foyer_nombre", "foyer_date", "foyer_longueur_texte", "foyer_valider_evenement", "foyer_valider_variante"]) {
    const h = await un(`select p.prosecdef s, p.proconfig c, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('public', p.oid, 'execute') pub
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [nom]);
    assert.ok(h, nom + " présente");
    assert.deepEqual([h.s, h.c, h.anon, h.pub], [false, ['search_path=""'], false, false], nom);
  }
  await db.exec(`reset role; set test.uid = ''; set role authenticated;`);
  await refuse(`select public.appliquer_propositions(array[gen_random_uuid()], '{}')`, /non authentifié/, "sans session");
  await superu();
});

/* =========================================================================================================== config.projection */
const P = (projection, extra) => ({ projection, ...extra });
test("config.projection : champs connus enregistrés, fusion par champ, null retire, source et date du jour", async () => {
  await comme(A); await reinitProjection();
  await accepte("config", P({ base_capacite: "montant", capacite_mensuelle: 450, reste_capacite: "cible", reequilibrage: "annuel", part_reaffectee_epargne_pct: 60, part_hausse_epargnee_pct: 40,
    salaire_croissance_reelle_pct: 0.5, tmi_pct: 30, per_versements_deduits: true, assurance_pct: 0.3, source: "Dit par l'utilisateur", le: "2026-10-01" }), "tous les champs");
  const r = async () => (await un(`select projection from public.config where user_id = '${A}'`)).projection;
  assert.deepEqual(await r(), { base_capacite: "montant", capacite_mensuelle: 450, reste_capacite: "cible", reequilibrage: "annuel", part_reaffectee_epargne_pct: 60, part_hausse_epargnee_pct: 40,
    salaire_croissance_reelle_pct: 0.5, tmi_pct: 30, per_versements_deduits: true, assurance_pct: 0.3, source: "Dit par l'utilisateur", le: "2026-10-01" });
  await accepte("config", P({ tmi_pct: 41, capacite_mensuelle: -100000 }), "fusion");
  const f = await r();
  assert.equal(f.tmi_pct, 41); assert.equal(f.capacite_mensuelle, -100000); assert.equal(f.base_capacite, "montant", "les autres champs sont conservés"); assert.equal(f.source, "Dit par l'utilisateur");
  await accepte("config", P({ tmi_pct: null, per_versements_deduits: null, reequilibrage: null }), "retrait par null");
  const g = await r();
  assert.ok(!("tmi_pct" in g) && !("per_versements_deduits" in g) && !("reequilibrage" in g), "champs retirés");
  assert.equal(g.reste_capacite, "cible");
  await accepte("config", P({ part_reaffectee_epargne_pct: "75", capacite_mensuelle: "1200.5", source: "Avis d'impôt", le: undefined }), "chaînes numériques acceptées, source seule");
  const h = await r();
  assert.deepEqual([h.part_reaffectee_epargne_pct, h.capacite_mensuelle, h.source, h.le], [75, 1200.5, "Avis d'impôt", AUJ === h.le ? AUJ : h.le]);
  assert.match(h.le, /^\d{4}-\d{2}-\d{2}$/, "date du jour par défaut quand la source est fournie sans date");
  // bornes incluses
  for (const [k, v] of [["capacite_mensuelle", 100000], ["capacite_mensuelle", -100000], ["part_hausse_epargnee_pct", 0], ["part_hausse_epargnee_pct", 100], ["assurance_pct", 100], ["tmi_pct", 0], ["tmi_pct", 11], ["tmi_pct", 45], ["salaire_croissance_reelle_pct", -10], ["salaire_croissance_reelle_pct", 10]])
    await accepte("config", P({ [k]: v }), k + " = " + v);
  for (const v of ["reel", "prevu", "montant"]) await accepte("config", P({ base_capacite: v }), v);
  for (const v of ["cible", "disponible"]) await accepte("config", P({ reste_capacite: v }), v);
  for (const v of ["aucun", "annuel"]) await accepte("config", P({ reequilibrage: v }), v);
  await reinitProjection(); await superu();
});
test("config.projection : refus des champs inconnus, des valeurs hors bornes, des types faux ; messages en français", async () => {
  await comme(A); await reinitProjection();
  const t = async (proj, motif, m) => refusee("config", P(proj), motif, m);
  await t({ inconnu: 1 }, /projection : champ « inconnu » inconnu/, "champ inconnu");
  await t({ base_capacite: "x" }, /projection : base_capacite invalide \(reel, prevu ou montant attendu\)/, "base_capacite");
  await t({ base_capacite: 3 }, /base_capacite invalide/, "base_capacite nombre");
  for (const v of [100001, -100001, "abc", true, [1]]) await t({ capacite_mensuelle: v }, /projection : capacite_mensuelle invalide/, "capacité " + JSON.stringify(v));
  await t({ reste_capacite: "x" }, /projection : reste_capacite invalide \(cible ou disponible attendu\)/, "reste_capacite");
  await t({ reequilibrage: "mensuel" }, /projection : reequilibrage invalide \(aucun ou annuel attendu\)/, "reequilibrage");
  for (const k of ["part_reaffectee_epargne_pct", "part_hausse_epargnee_pct", "assurance_pct"])
    for (const v of [101, -1, "abc", false]) await t({ [k]: v }, new RegExp(`projection : ${k} invalide \\(pourcentage de 0 à 100 attendu\\)`), k + " " + JSON.stringify(v));
  for (const v of [10.5, -11, "x"]) await t({ salaire_croissance_reelle_pct: v }, /projection : salaire_croissance_reelle_pct invalide \(de −10 à 10 % par an attendu\)/, "salaire " + v);
  for (const v of [20, 12, 50, "abc", 30.5]) await t({ tmi_pct: v }, /projection : tmi_pct invalide \(0, 11, 30, 41 ou 45 attendu\)/, "tmi " + v);
  for (const v of ["oui", 1, "true"]) await t({ per_versements_deduits: v }, /projection : per_versements_deduits invalide \(vrai ou faux attendu\)/, "per " + JSON.stringify(v));
  await t({ source: "" }, /projection : source invalide \(1 à 300 caractères attendus\)/, "source vide");
  await t({ source: "s".repeat(301) }, /projection : source invalide/, "source 301");
  await t({ source: 5 }, /projection : source invalide/, "source nombre");
  const demain = (await un(`select (now() at time zone 'Europe/Paris')::date + 1 d`)).d.toISOString().slice(0, 10);
  await t({ source: "s", le: demain }, /projection : date \(le\) dans le futur/, "date dans le futur");
  await t({ source: "s", le: "2026-02-30" }, /projection : date \(le\) invalide \(AAAA-MM-JJ\)/, "date impossible");
  await t({ source: "s", le: 20260101 }, /projection : date \(le\) invalide/, "date nombre");
  await refusee("config", { projection: [] }, /projection : objet attendu/, "projection tableau");
  await refusee("config", { projection: {} }, /projection : au moins un réglage attendu/, "projection vide");
  await refusee("config", { projection: null }, /projection : objet attendu/, "projection null");
  assert.deepEqual((await un(`select projection from public.config where user_id = '${A}'`)).projection, {}, "rien d'enregistré");
  await superu();
});
test("config.projection.biens : clés « bien:<uuid> » de biens de l'utilisateur, prix_achat > 0, date_achat réelle et passée, source obligatoire ; null retire", async () => {
  await comme(A); await reinitProjection();
  const cle = "bien:" + BIEN_A;
  await accepte("config", P({ biens: { [cle]: { prix_achat: 210000, date_achat: "2018-05-15", source: "Acte de vente fictif", le: "2026-09-30" } } }), "bien de A");
  const r = async () => (await un(`select projection from public.config where user_id = '${A}'`)).projection;
  assert.deepEqual((await r()).biens[cle], { prix_achat: 210000, date_achat: "2018-05-15", source: "Acte de vente fictif", le: "2026-09-30" });
  await accepte("config", P({ biens: { [cle]: { prix_achat: "215000.5", date_achat: "2018-05-16", source: "Acte rectifié" } } }), "remplacement du bien, date du jour par défaut");
  const b = (await r()).biens[cle];
  assert.deepEqual([b.prix_achat, b.date_achat, b.source], [215000.5, "2018-05-16", "Acte rectifié"]);
  assert.match(b.le, /^\d{4}-\d{2}-\d{2}$/);
  await accepte("config", P({ tmi_pct: 11 }), "autre champ : biens conservés");
  assert.ok((await r()).biens[cle]);
  const t = async (biens, motif, m) => refusee("config", P({ biens }), motif, m);
  await t({ ["bien:" + BIEN_B]: { prix_achat: 1, date_achat: "2018-05-15", source: "s" } }, /projection\.biens : bien « bien:.* » introuvable/, "bien de B");
  await t({ "bien:00000000-0000-4000-8000-000000000000": { prix_achat: 1, date_achat: "2018-05-15", source: "s" } }, /projection\.biens : bien « bien:.* » introuvable/, "bien inconnu");
  await t({ "maison": { prix_achat: 1, date_achat: "2018-05-15", source: "s" } }, /projection\.biens : clé « maison » invalide \(bien:<identifiant> attendu\)/, "clé mal formée");
  await t({ [cle]: { prix_achat: 0, date_achat: "2018-05-15", source: "s" } }, /projection\.biens « bien:.* » : prix_achat invalide \(montant strictement positif attendu\)/, "prix nul");
  await t({ [cle]: { prix_achat: -5, date_achat: "2018-05-15", source: "s" } }, /prix_achat invalide/, "prix négatif");
  await t({ [cle]: { date_achat: "2018-05-15", source: "s" } }, /prix_achat invalide/, "prix absent");
  await t({ [cle]: { prix_achat: 1, source: "s" } }, /date_achat invalide \(AAAA-MM-JJ\)/, "date absente");
  await t({ [cle]: { prix_achat: 1, date_achat: "2018-02-30", source: "s" } }, /date_achat invalide \(AAAA-MM-JJ\)/, "date impossible");
  await t({ [cle]: { prix_achat: 1, date_achat: "1899-12-31", source: "s" } }, /date_achat antérieure à 1900/, "date avant 1900");
  const demain = (await un(`select (now() at time zone 'Europe/Paris')::date + 1 d`)).d.toISOString().slice(0, 10);
  await t({ [cle]: { prix_achat: 1, date_achat: demain, source: "s" } }, /date_achat dans le futur/, "achat dans le futur");
  await t({ [cle]: { prix_achat: 1, date_achat: "2018-05-15" } }, /source obligatoire \(1 à 300 caractères\)/, "source absente");
  await t({ [cle]: { prix_achat: 1, date_achat: "2018-05-15", source: "s", note: "x" } }, /champ « note » inconnu \(prix_achat, date_achat, source, le\)/, "champ inconnu");
  await t({ [cle]: { prix_achat: 1, date_achat: "2018-05-15", source: "s", le: demain } }, /date \(le\) dans le futur/, "le dans le futur");
  await t({ [cle]: 5 }, /objet ou null attendu/, "valeur pas un objet");
  await t([], /projection\.biens : objet \{ bien:<identifiant>: informations \} attendu/, "biens tableau");
  await accepte("config", P({ biens: { [cle]: null } }), "null retire le bien");
  assert.ok(!("biens" in (await r())) || !(cle in (await r()).biens), "bien retiré");
  await reinitProjection(); await superu();
});
test("config : projection avec d'autres réglages dans la même proposition ; les clés connues de 0029 marchent encore ; message de refus mis à jour", async () => {
  await comme(A); await reinitProjection();
  await accepte("config", { cushion: { mode: "amount", min: 3000, max: null }, projection: { tmi_pct: 30, source: "Avis d'impôt" } }, "cushion et projection");
  const c = await un(`select cushion, projection from public.config where user_id = '${A}'`);
  assert.deepEqual(c.cushion, { mode: "amount", min: 3000, max: null }); assert.equal(c.projection.tmi_pct, 30);
  await refusee("config", { targets: {} }, /réglage « targets » non modifiable par proposition \(cushion, recurring, frais_enveloppes, enveloppes_infos, prets_infos, donations, avis_impot ou projection seulement\)/, "clé inconnue");
  await refusee("config", {}, /cushion ou recurring attendu \(ou frais_enveloppes, enveloppes_infos, prets_infos, donations, avis_impot ou projection\)/, "objet vide");
  await reinitProjection(); await superu();
});

/* =========================================================================================================== diff d'appliquer_propositions contre 0029 */
function fonction(sql) {
  const d = sql.indexOf("create or replace function public.appliquer_propositions(");
  assert.ok(d >= 0, "définition trouvée");
  const f = sql.indexOf("\n$$;\n", d);
  return sql.slice(d, f + 5).split("\n");
}
/** Diff de lignes par plus longue sous-suite commune : { retirees, ajoutees }. */
function diffLignes(a, b) {
  const n = a.length, m = b.length, t = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const retirees = [], ajoutees = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) retirees.push(a[i++]); else ajoutees.push(b[j++]);
  }
  while (i < n) retirees.push(a[i++]);
  while (j < m) ajoutees.push(b[j++]);
  return { retirees, ajoutees };
}
test("appliquer_propositions : la définition de 0031 est celle de 0029 plus des ajouts ; seules quatre lignes de messages de la cible config changent", () => {
  const avant = fonction(SQL_0029), apres = fonction(SQL);
  const { retirees, ajoutees } = diffLignes(avant, apres);
  assert.deepEqual(retirees, [
    "         where k not in ('cushion', 'recurring', 'frais_enveloppes', 'enveloppes_infos', 'prets_infos', 'donations', 'avis_impot') limit 1;",
    "          raise exception 'réglage « % » non modifiable par proposition (cushion, recurring, frais_enveloppes, enveloppes_infos, prets_infos, donations ou avis_impot seulement)', v_key;",
    "        if not (v ? 'cushion' or v ? 'recurring' or v ? 'frais_enveloppes' or v ? 'enveloppes_infos' or v ? 'prets_infos' or v ? 'donations' or v ? 'avis_impot') then",
    "          raise exception 'réglages : cushion ou recurring attendu (ou frais_enveloppes, enveloppes_infos, prets_infos, donations ou avis_impot)';",
  ], "lignes retirées : la liste blanche de la cible config et ses deux messages");
  assert.ok(ajoutees.length >= 4 + 100, "ajouts : " + ajoutees.length);
  // les ajouts contiennent les quatre remplaçantes, et chacun des blocs attendus
  const texte = ajoutees.join("\n");
  assert.match(texte, /'avis_impot', 'projection'\) limit 1;/);
  assert.match(texte, /when 'evenement' then/); assert.match(texte, /when 'variante' then/); assert.match(texte, /when 'plan_fige' then/);
  assert.match(texte, /if v \? 'projection' then/);
  // tout le reste du texte de 0029 est conservé dans le même ordre (la plus longue sous-suite commune couvre toutes les lignes non retirées)
  assert.equal(apres.length, avant.length - retirees.length + ajoutees.length);
  // en-tête de la fonction, droits : identiques
  assert.equal(apres[0], avant[0]);
  assert.doesNotMatch(SQL_0030, /appliquer_propositions/, "0030 ne redéfinit pas la fonction : ni 0030 ni 0031 ne changent autre chose que les ajouts listés");
  assert.match(SQL, /revoke all on function public\.appliquer_propositions\(uuid\[\], jsonb\) from public, anon;\ngrant execute on function public\.appliquer_propositions\(uuid\[\], jsonb\) to authenticated;/);
  console.log(`# diff appliquer_propositions 0029 → 0031 : ${retirees.length} lignes modifiées (messages de la cible config), ${ajoutees.length} lignes ajoutées`);
});

/* =========================================================================================================== export_all */
test("export_all() : foyer_evenements, foyer_variantes et plans_figes (tableaux, ordonnés), seulement les lignes de l'utilisateur ; les clés précédentes sont conservées", async () => {
  await superu(); await vider();
  const [v] = await insVar(A, { nom: "V" });
  await insEv(A, { libelle: "Deuxième", date: "2028-01-01", variante_id: v.id }); await insEv(A, { libelle: "Première", date: "2027-01-01" });
  await insPlan(A, { raison: "objectif" }); await insEv(B, { libelle: "De B" }); await insVar(B); await insPlan(B);
  await comme(A);
  const j = (await un(`select public.export_all() j`)).j;
  for (const k of ["exported_at", "profile", "biens", "credits", "positions", "transactions", "snapshots", "config", "status", "budget", "objectifs", "propositions", "connexions_assistant",
    "memoire_agent", "journal", "routines", "fonctionnalites", "banque_connexions", "banque_comptes", "banque_placements", "banque_operations", "banque_mois"]) assert.ok(k in j, k + " conservée");
  assert.ok(Array.isArray(j.foyer_evenements) && Array.isArray(j.foyer_variantes) && Array.isArray(j.plans_figes));
  assert.deepEqual(j.foyer_evenements.map(e => e.libelle), ["Première", "Deuxième"], "ordre par date");
  assert.deepEqual(j.foyer_variantes.map(x => x.nom), ["V"]);
  assert.deepEqual(j.plans_figes.map(x => x.raison), ["objectif"]);
  assert.ok(j.foyer_evenements.every(e => e.user_id === A) && j.plans_figes.every(p => p.user_id === A));
  assert.ok("params" in j.foyer_evenements[0] && "retire" in j.foyer_variantes[0] && "serie" in j.plans_figes[0]);
  await comme(B);
  const jb = (await un(`select public.export_all() j`)).j;
  assert.deepEqual(jb.foyer_evenements.map(e => e.libelle), ["De B"]);
  await comme(A, "aal1");
  const sans = (await un(`select public.export_all() j`)).j;
  for (const t of ["foyer_evenements", "foyer_variantes", "plans_figes"]) assert.deepEqual(sans[t], [], t + " : vide en aal1 pour A (facteur vérifié)");
  await superu(); await vider();
});
test("export_all() : toujours security invoker, search_path public, stable, réservée à authenticated", async () => {
  await superu();
  const f = await un(`select p.prosecdef s, p.provolatile v, p.proconfig c, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'export_all'`);
  assert.deepEqual([f.s, f.v, f.c, f.anon, f.auth], [false, "s", ["search_path=public"], false, true]);
});

/* =========================================================================================================== indices_mensuels et repères */
test("indices_mensuels : la série ipc_insee de la fixture, 60 mois, à l'identique ; lisible par anon et authenticated", async () => {
  const idx = FIXTURE.indices_mensuels;
  await superu();
  const lignes = await q(`select serie, mois::text mois, valeur::float8 valeur, source_titre, source_url, verifie_le::text verifie_le from public.indices_mensuels order by mois`);
  assert.equal(lignes.length, 60);
  assert.deepEqual(lignes, idx.valeurs.map(v => ({ serie: "ipc_insee", mois: v.mois, valeur: v.valeur, source_titre: idx.titre, source_url: idx.source_url, verifie_le: idx.verifie_le })));
  assert.ok(lignes.every(l => /^\d{4}-\d{2}-01$/.test(l.mois)));
  assert.match(idx.source_url, /^https:\/\/www\.insee\.fr\//);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set test.uid = '${A}'; set role ${role};`);
    assert.equal((await un(`select count(*)::int n from public.indices_mensuels`)).n, 60, role + " lit");
  }
});
test("indices_mensuels : non modifiable par anon ni authenticated (aucun droit d'écriture, RLS en lecture seule)", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set test.uid = '${A}'; set role ${role};`);
    await refuse(`insert into public.indices_mensuels (serie, mois, valeur, source_titre, source_url, verifie_le) values ('x', '2026-01-01', 1, 'x', 'https://x', '2026-01-01')`, /permission denied/, role + " insert");
    await refuse(`update public.indices_mensuels set valeur = 1`, /permission denied/, role + " update");
    await refuse(`delete from public.indices_mensuels`, /permission denied/, role + " delete");
    await refuse(`truncate public.indices_mensuels`, /permission denied/, role + " truncate");
  }
  await superu();
  assert.equal((await un(`select relrowsecurity r from pg_class where oid = 'public.indices_mensuels'::regclass`)).r, true, "RLS activée");
  const pol = await q(`select cmd, roles::text from pg_policies where schemaname = 'public' and tablename = 'indices_mensuels'`);
  assert.deepEqual(pol.map(p => p.cmd), ["SELECT"]);
  // contraintes de contenu
  await refuse(`insert into public.indices_mensuels (serie, mois, valeur, source_titre, source_url, verifie_le) values ('essai', '2026-01-15', 1, 'xx', 'https://x', '2026-01-01')`, /indices_mensuels_mois_check/, "mois = 1er du mois");
  await refuse(`insert into public.indices_mensuels (serie, mois, valeur, source_titre, source_url, verifie_le) values ('essai', '2026-01-01', 1, 'xx', 'http://x', '2026-01-01')`, /source_url_check/, "https exigé");
});
test("repères : l'unité accepte celles des 68 repères de la fixture et refuse les autres ; 68 lignes insérées, identiques à la fixture", async () => {
  await superu();
  const unites = [...new Set(FIXTURE.reperes.map(r => r.unite))].sort();
  assert.deepEqual(unites, ["%", "UC", "dates", "h", "mois", "ans", "€"].sort());
  for (const u of unites) {
    await db.exec(`insert into public.reperes (cle, libelle, valeur, unite, date_effet, source_titre, source_url, verifie_le) values ('test_unite', 'Essai unité', 1, '${u}', '2026-01-01', 's', 'https://x', '2026-01-01')`);
    await db.exec(`delete from public.reperes where cle = 'test_unite'`);
  }
  await refuse(`insert into public.reperes (cle, libelle, valeur, unite, date_effet, source_titre, source_url, verifie_le) values ('test_unite', 'Essai unité', 1, 'jours', '2026-01-01', 's', 'https://x', '2026-01-01')`, /reperes_unite_check/, "unité inconnue");
  const lignes = await q(`select cle, libelle, valeur::float8 valeur, unite, date_effet::text date_effet, date_fin::text date_fin, source_titre, source_url, verifie_le::text verifie_le from public.reperes where cle = any($1)`, [FIXTURE.reperes.map(r => r.cle)]);
  assert.equal(lignes.length, 68);
  const parCle = Object.fromEntries(lignes.map(l => [l.cle, l]));
  for (const r of FIXTURE.reperes) {
    assert.deepEqual(parCle[r.cle], { cle: r.cle, libelle: r.libelle, valeur: r.valeur, unite: r.unite, date_effet: r.dateEffet, date_fin: r.dateFin, source_titre: r.sourceTitre, source_url: r.sourceUrl, verifie_le: r.verifieLe }, r.cle);
  }
});
test("repères et indices : le bloc d'inserts se rejoue sans erreur ni doublon (on conflict do update) ; une valeur modifiée est remise à la valeur de la fixture", async () => {
  await superu();
  const debut = SQL_0030.indexOf("-- Repères de la projection");
  assert.ok(debut > 0, "marqueur du bloc de repères");
  const debutI = SQL.indexOf("insert into public.indices_mensuels");
  assert.ok(debutI > 0, "bloc des indices");
  const bloc = SQL_0030.slice(debut) + "\n" + SQL.slice(debutI);
  assert.match(bloc, /on conflict \(cle\) do update/);
  assert.match(bloc, /on conflict \(serie, mois\) do update/);
  const avant = (await un(`select (select count(*)::int from public.reperes) r, (select count(*)::int from public.indices_mensuels) i`));
  await db.exec(`update public.reperes set valeur = 999 where cle = 'inflation_hypothese'; update public.indices_mensuels set valeur = 1 where mois = '2021-10-01'`);
  await db.exec(bloc);
  await db.exec(bloc);
  const apres = (await un(`select (select count(*)::int from public.reperes) r, (select count(*)::int from public.indices_mensuels) i`));
  assert.deepEqual(apres, avant);
  assert.equal((await un(`select valeur::float8 v from public.reperes where cle = 'inflation_hypothese'`)).v, FIXTURE.reperes.find(r => r.cle === "inflation_hypothese").valeur);
  assert.equal((await un(`select valeur::float8 v from public.indices_mensuels where mois = '2021-10-01'`)).v, FIXTURE.indices_mensuels.valeurs[0].valeur);
});
