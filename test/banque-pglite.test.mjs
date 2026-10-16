// Banque (BQ1, Powens) exercée sur un vrai PostgreSQL (PGlite, en mémoire) : toutes les migrations 0001 → 0021 appliquées sur
// les bouchons Supabase (test/helpers/pglite.mjs, baseComplete : rôles, Vault, pg_cron, pg_net, pgcrypto). Couvre la structure,
// la RLS des tables banque_* et de fonctionnalites, l'absence d'écriture pour authenticated hors des 5 colonnes de rattachement,
// le déclencheur de rattachement, banque_recalculer_mois, banque_purger, le contenu sensible des libellés, les fonctions
// powens_* (Vault, empreinte SHA-256, réservées à service_role), le jeton de nuit, la planification, export_all et la cascade de
// delete_me. Aucun réseau ni secret réel : exécuté en CI (npm ci && npm test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { baseComplete, comme } from "./helpers/pglite.mjs";

const SQL = readFileSync(new URL("../supabase/migrations/0021_banque.sql", import.meta.url), "utf8");
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", C = "33333333-3333-3333-3333-333333333333";
const PA = "aaaaaaaa-0000-0000-0000-000000000001", PA2 = "aaaaaaaa-0000-0000-0000-000000000002", PB = "bbbbbbbb-0000-0000-0000-000000000001";
const CA = "aaaaaaaa-1111-0000-0000-000000000001", CB = "bbbbbbbb-1111-0000-0000-000000000001";
const AUJ = `(now() at time zone 'Europe/Paris')::date`;
const TABLES = ["banque_connexions", "banque_comptes", "banque_placements", "banque_operations", "banque_mois"];
const FONCTIONS = [
  ["powens_enregistrer", "uuid, bigint, text", `'${A}', 1, 'x'`],
  ["powens_jeton", "uuid", `'${A}'`],
  ["powens_utilisateur_par_empreinte", "text", `'x'`],
  ["powens_oublier", "uuid", `'${A}'`],
  ["banque_recalculer_mois", "uuid, date", `'${A}', current_date`],
  ["banque_purger", "integer", `90`],
  ["check_powens_nuit_token", "text", `'x'`],
  ["banque_verrouiller", "uuid, bigint, integer", `'${A}', 1, 120`],
  ["banque_deverrouiller", "uuid, bigint", `'${A}', 1`],
  ["powens_a_supprimer_lister", "integer", `10`],
  ["powens_a_supprimer_fait", "bigint", `1`],
];
let db;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const refuse = async (s, p, motif, m) => {
  await assert.rejects(db.query(s, p), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
};
const service = () => db.exec(`reset role; set test.uid = ''; set role service_role;`);
const superu = () => db.exec(`reset role; set test.uid = '';`);
const jour = d => d == null ? null : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
const sha = t => createHash("sha256").update(t, "utf8").digest("hex");
const num = v => v == null ? null : Number(v);

before(async () => {
  db = await baseComplete();
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
    insert into public.positions (id, user_id, name, envelope, owner, mode, value) values
      ('${PA}', '${A}', 'Livret A', 'Livrets', 'p1', 'manual', 1000), ('${PA2}', '${A}', 'Compte courant', '', 'p1', 'manual', 500),
      ('${PB}', '${B}', 'Livret A', 'Livrets', 'p1', 'manual', 2000);
    insert into public.credits (id, user_id, nom, crd) values ('${CA}', '${A}', 'Prêt immo', 100000), ('${CB}', '${B}', 'Prêt auto', 9000);
    insert into public.fonctionnalites (user_id, cle, active) values ('${A}', 'banque', true), ('${B}', 'banque', false);
    insert into public.banque_connexions (id, user_id, etablissement, etat, derniere_synchro) values
      (1, '${A}', 'Banque Test', null, now()), (2, '${A}', 'Assureur Test', 'SCARequired', now() - interval '3 days'),
      (1, '${B}', 'Banque B', null, now());
    insert into public.banque_comptes (id, user_id, connexion_id, nom, type, solde, devise, solde_le, actif) values
      (10, '${A}', 1, 'Compte courant', 'courant', 1234.5, 'EUR', ${AUJ}, true),
      (11, '${A}', 1, 'PEA', 'pea', 25000, 'EUR', ${AUJ}, true),
      (12, '${A}', 2, 'Prêt immo', 'credit', -98000, 'EUR', ${AUJ}, true),
      (10, '${B}', 1, 'Compte B', 'courant', 50, 'EUR', ${AUJ}, true);
    insert into public.banque_placements (id, user_id, compte_id, isin, libelle, quantite, valeur, prix_revient) values
      (100, '${A}', 11, 'IE00B4L5Y983', 'iShares Core MSCI World', 120, 12000, 90), (100, '${B}', 10, 'FR0010315770', 'Lyxor MSCI World', 1, 300, null);
    insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle, categorie) values
      (1000, '${A}', 10, ${AUJ}, -50, 'CARTE SUPERMARCHE', 'alimentation'),
      (1001, '${B}', 10, ${AUJ}, -20, 'CARTE B', 'divers');
    insert into public.banque_mois (user_id, mois, categorie, entrees, sorties, nombre) values
      ('${A}', date_trunc('month', ${AUJ})::date, 'alimentation', 0, 50, 1), ('${B}', date_trunc('month', ${AUJ})::date, 'divers', 0, 20, 1);`);
  await comme(db, A);
});
after(async () => { await db.close(); });

test("migration 0021 : en-tête, tutoiement des messages (ni vous, ni votre, ni vos), aucun secret", () => {
  assert.match(SQL, /^-- Boussole : banque/);
  assert.match(SQL, /Appliqué sur le projet oapcewpqsbbjdlcdeizi avec apply_migration \(name = "banque"\)/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(SQL, /conseiller/i);
  assert.doesNotMatch(SQL, /sb_secret_|eyJhbGci|POWENS_CLIENT_SECRET\s*=/);
  assert.match(SQL, /cron\.schedule\(\s*'boussole-powens-nuit',\s*'0 0 \* \* \*'/);
});

test("PGlite : structure — colonnes, clés primaires, clés étrangères, colonnes source_auto de positions", async () => {
  await superu();
  const cols = async t => (await q(`select column_name c from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position`,
    [t.split(".")[0], t.split(".")[1]])).map(r => r.c);
  assert.deepEqual(await cols("public.fonctionnalites"), ["user_id", "cle", "active", "maj_le"]);
  assert.deepEqual(await cols("prive.powens_utilisateurs"), ["user_id", "powens_user_id", "empreinte_jeton", "secret_id", "cree_le"]);
  assert.deepEqual(await cols("prive.powens_a_supprimer"), ["id", "user_id", "powens_user_id", "secret_id", "cree_le"]);
  assert.deepEqual(await cols("public.banque_connexions"), ["id", "user_id", "etablissement", "etat", "message", "derniere_synchro", "verrou_jusqua", "cree_le", "maj_le",
    "connecteur", "doublon_de"]); // + 0022
  assert.deepEqual(await cols("public.banque_comptes"), ["id", "user_id", "connexion_id", "nom", "type", "debit_differe", "solde", "devise", "solde_le", "actif",
    "position_id", "enveloppe", "titulaire", "credit_id", "ignore", "propose_le", "maj_le", "doublon_de", "rattache_auto", "cree_auto", "auto_retire_le", "suggestion",
    "ouverture_le", "pret", "infos_proposees_le"]); // + 0022, + 0029 (calendrier : données du prêt transmises par Powens)
  assert.deepEqual(await cols("public.banque_placements"), ["id", "user_id", "compte_id", "isin", "libelle", "quantite", "valeur", "prix_revient", "position_id",
    "ligne_creee_le", "maj_le"]);
  assert.deepEqual(await cols("public.banque_operations"), ["id", "user_id", "compte_id", "date", "montant", "libelle", "categorie",
    "categorie_powens", "contrepartie_id", "type_powens", "sous_categorie", "origine_categorie", "regle_id", "cle_marchand", "sous_categorie_origine"]); // + 0025, + 0035 (budget)
  assert.deepEqual(await cols("public.banque_mois"), ["user_id", "mois", "categorie", "entrees", "sorties", "nombre", "compte_id", "sous_categorie"]); // + 0025, + 0035 (budget)
  const pos = await cols("public.positions");
  assert.ok(pos.includes("source_auto") && pos.includes("source_auto_le"), "positions : source_auto, source_auto_le");
  const pk = async t => (await un(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and contype = 'p'`, [t])).d;
  assert.equal(await pk("public.fonctionnalites"), "PRIMARY KEY (user_id, cle)");
  assert.equal(await pk("prive.powens_utilisateurs"), "PRIMARY KEY (user_id)");
  for (const t of ["banque_connexions", "banque_comptes", "banque_placements", "banque_operations"]) assert.equal(await pk("public." + t), "PRIMARY KEY (user_id, id)", t);
  assert.equal(await pk("public.banque_mois"), "PRIMARY KEY (user_id, mois, compte_id, categorie, sous_categorie)"); // 0025, puis 0035 (budget)
  const fks = async t => (await q(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and contype = 'f'`, [t])).map(r => r.d);
  assert.ok((await fks("public.banque_comptes")).includes("FOREIGN KEY (user_id, connexion_id) REFERENCES banque_connexions(user_id, id) ON DELETE CASCADE"));
  assert.ok((await fks("public.banque_comptes")).includes("FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL"));
  assert.ok((await fks("public.banque_comptes")).includes("FOREIGN KEY (credit_id) REFERENCES credits(id) ON DELETE SET NULL"));
  assert.ok((await fks("public.banque_placements")).includes("FOREIGN KEY (user_id, compte_id) REFERENCES banque_comptes(user_id, id) ON DELETE CASCADE"));
  assert.ok((await fks("public.banque_placements")).includes("FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL"));
  assert.ok((await fks("public.banque_operations")).includes("FOREIGN KEY (user_id, compte_id) REFERENCES banque_comptes(user_id, id) ON DELETE CASCADE"));
  for (const t of ["public.fonctionnalites", "prive.powens_utilisateurs", ...TABLES.map(t => "public." + t)])
    assert.ok((await fks(t)).some(d => /FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/.test(d)), t + " : cascade sur auth.users");
  const idx = (await q(`select indexdef d from pg_indexes where tablename = 'banque_operations'`)).map(r => r.d).join("\n");
  assert.match(idx, /\(user_id, date DESC\)/, "index (user_id, date desc)");
  // contrôles : états Powens, types normalisés, titulaire, clé de fonctionnalité, source_auto
  await refuse(`insert into public.banque_connexions (id, user_id, etat) values (9, '${A}', 'inconnu')`, [], /banque_connexions_etat/, "état inconnu");
  for (const etat of ["SCARequired", "webauthRequired", "additionalInformationNeeded", "wrongpass", "decoupled", "validating", "actionNeeded",
    "passwordExpired", "rateLimiting", "websiteUnavailable", "bug"]) {
    await q(`insert into public.banque_connexions (id, user_id, etat) values (9, '${A}', $1)`, [etat]);
    await q(`delete from public.banque_connexions where user_id = '${A}' and id = 9`);
  }
  await refuse(`insert into public.banque_comptes (id, user_id, connexion_id, type) values (99, '${A}', 1, 'epargne')`, [], /banque_comptes_type/, "type inconnu");
  for (const type of ["courant", "livret", "pea", "compte_titres", "assurance_vie", "per", "credit", "autre"]) {
    await q(`insert into public.banque_comptes (id, user_id, connexion_id, type) values (99, '${A}', 1, $1)`, [type]);
    await q(`delete from public.banque_comptes where user_id = '${A}' and id = 99`);
  }
  await refuse(`insert into public.banque_comptes (id, user_id, connexion_id, type) values (99, '${A}', 7, 'courant')`, [], /foreign key/, "connexion absente");
  await refuse(`insert into public.banque_comptes (id, user_id, connexion_id, type, titulaire) values (99, '${A}', 1, 'courant', 'p3')`, [], /banque_comptes_titulaire/, "titulaire p3");
  await refuse(`insert into public.banque_comptes (id, user_id, connexion_id, type, enveloppe) values (99, '${A}', 1, 'pea', $1)`, ["x".repeat(101)], /banque_comptes_enveloppe/, "enveloppe de 101 caractères");
  const c0 = await un(`insert into public.banque_comptes (id, user_id, connexion_id, type) values (99, '${A}', 1, 'courant') returning ignore, debit_differe, propose_le`);
  assert.deepEqual({ ...c0 }, { ignore: false, debit_differe: false, propose_le: null }, "valeurs par défaut");
  await q(`delete from public.banque_comptes where user_id = '${A}' and id = 99`);
  await refuse(`insert into public.fonctionnalites (user_id, cle) values ('${C}', 'bourse')`, [], /fonctionnalites_cle/, "clé inconnue");
  await refuse(`update public.positions set source_auto = 'manuel' where id = '${PA}'`, [], /positions_source_auto/, "source_auto hors liste");
  await refuse(`insert into public.banque_mois (user_id, mois, categorie) values ('${A}', '2026-10-05', 'divers')`, [], /banque_mois_mois/, "mois non au 1er");
  const d = await un(`insert into public.fonctionnalites (user_id, cle) values ('${C}', 'banque') returning *`);
  assert.equal(d.active, false, "interrupteur éteint par défaut");
  await q(`delete from public.fonctionnalites where user_id = '${C}'`);
  await comme(db, A);
});

test("PGlite : RLS — B ne lit rien de A (tables banque_*, fonctionnalites) ; anon n'a aucun accès", async () => {
  await comme(db, B);
  for (const t of [...TABLES, "fonctionnalites"]) {
    const rows = await q(`select user_id from public.${t}`);
    assert.ok(rows.length >= 1, t + " : B lit ses lignes");
    assert.ok(rows.every(r => r.user_id === B), t + " : B ne lit que ses lignes");
  }
  await comme(db, A);
  for (const t of [...TABLES, "fonctionnalites"]) assert.ok((await q(`select user_id from public.${t}`)).every(r => r.user_id === A), t + " : A");
  await db.exec(`reset role; set test.uid = ''; set role anon;`);
  for (const t of [...TABLES, "fonctionnalites"]) await refuse(`select * from public.${t}`, [], /permission denied/, "anon : " + t);
  await comme(db, A);
  await refuse(`select * from prive.powens_utilisateurs`, [], /permission denied for schema prive/, "authenticated : schéma prive");
});

test("PGlite : authenticated ne peut ni insérer, ni supprimer, ni modifier hors des 5 colonnes de rattachement ; fonctionnalites en lecture seule", async () => {
  await comme(db, A);
  const ecritures = [
    [`insert into public.banque_connexions (id, etablissement) values (5, 'X')`, "insertion connexion"],
    [`insert into public.banque_comptes (id, connexion_id, type) values (50, 1, 'courant')`, "insertion compte"],
    [`insert into public.banque_placements (id, compte_id) values (500, 11)`, "insertion placement"],
    [`insert into public.banque_operations (id, compte_id, date, montant) values (5000, 10, current_date, 1)`, "insertion opération"],
    [`insert into public.banque_mois (mois, categorie) values ('2026-01-01', 'divers')`, "insertion mois"],
    [`insert into public.fonctionnalites (cle, active) values ('banque', true)`, "insertion fonctionnalité"],
    [`update public.fonctionnalites set active = true`, "activation de l'interrupteur"],
    [`delete from public.fonctionnalites`, "suppression fonctionnalité"],
    [`update public.banque_connexions set etat = null`, "modification connexion"],
    [`update public.banque_comptes set solde = 1e9`, "modification du solde"],
    [`update public.banque_comptes set nom = 'X'`, "modification du nom"],
    [`update public.banque_comptes set user_id = '${B}'`, "changement de propriétaire"],
    [`update public.banque_placements set quantite = 1`, "modification placement"],
    [`update public.banque_operations set montant = 1`, "modification opération"],
    [`update public.banque_mois set sorties = 0`, "modification mois"],
    ...TABLES.map(t => [`delete from public.${t}`, "suppression " + t]),
  ];
  for (const [s, m] of ecritures) await refuse(s, [], /permission denied/, m);
  // les colonnes de rattachement, sur ses propres comptes
  let r = await un(`update public.banque_comptes set position_id = '${PA2}', enveloppe = null, titulaire = null, credit_id = null where id = 10 returning *`);
  assert.equal(r.position_id, PA2);
  r = await un(`update public.banque_comptes set position_id = null, enveloppe = 'PEA', titulaire = 'p1' where id = 11 returning *`);
  assert.equal(r.enveloppe, "PEA"); assert.equal(r.titulaire, "p1");
  r = await un(`update public.banque_comptes set credit_id = '${CA}' where id = 12 returning *`);
  assert.equal(r.credit_id, CA);
  // 5e colonne : ignore (compte écarté par l'utilisateur) ; les autres colonnes ajoutées restent fermées
  r = await un(`update public.banque_comptes set ignore = true where id = 12 returning *`);
  assert.equal(r.ignore, true);
  r = await un(`update public.banque_comptes set ignore = false, credit_id = '${CA}' where id = 12 returning *`);
  assert.equal(r.ignore, false); assert.equal(r.credit_id, CA);
  for (const col of ["propose_le = now()", "debit_differe = true"]) await refuse(`update public.banque_comptes set ${col}`, [], /permission denied/, col);
  await refuse(`update public.banque_placements set ligne_creee_le = now()`, [], /permission denied/, "ligne_creee_le");
  await refuse(`update public.banque_connexions set verrou_jusqua = null`, [], /permission denied/, "verrou_jusqua");
  // B ne rattache pas les comptes de A
  await comme(db, B);
  assert.equal((await q(`update public.banque_comptes set position_id = null, enveloppe = null where user_id = '${A}' returning *`)).length, 0, "B : sans effet");
  await superu();
  assert.equal((await un(`select position_id from public.banque_comptes where user_id = '${A}' and id = 10`)).position_id, PA2, "rattachement de A intact");
  await comme(db, A);
});

test("PGlite : déclencheur banque_comptes_rattachement — ligne ou crédit d'un autre, ligne et enveloppe ensemble refusés", async () => {
  await comme(db, A);
  await refuse(`update public.banque_comptes set position_id = '${PB}' where id = 10`, [], /Ligne introuvable/, "position de B");
  await refuse(`update public.banque_comptes set credit_id = '${CB}' where id = 12`, [], /Crédit introuvable/, "crédit de B");
  await refuse(`update public.banque_comptes set position_id = '${PA}', enveloppe = 'Livrets' where id = 10`, [], /ligne ou à une enveloppe, pas aux deux/, "ligne et enveloppe");
  await refuse(`update public.banque_comptes set position_id = '${PA}' where id = 11`, [], /pas aux deux/, "ligne ajoutée à un compte déjà sur une enveloppe");
  // crédit seulement sur un compte de type credit
  await refuse(`update public.banque_comptes set credit_id = '${CA}' where id = 10`, [], /seulement à un compte de crédit/, "crédit sur un compte courant");
  // ignore = true : les 4 rattachements sont effacés
  await superu();
  const ig = await un(`update public.banque_comptes set ignore = true where user_id = '${A}' and id = 11 returning *`);
  assert.deepEqual([ig.position_id, ig.enveloppe, ig.titulaire, ig.credit_id], [null, null, null, null], "compte ignoré : rattachement effacé");
  const ig2 = await un(`update public.banque_comptes set enveloppe = 'PEA', titulaire = 'p1' where user_id = '${A}' and id = 11 returning *`);
  assert.equal(ig2.enveloppe, null, "compte ignoré : aucun rattachement possible");
  await q(`update public.banque_comptes set ignore = false, enveloppe = 'PEA', titulaire = 'p1' where user_id = '${A}' and id = 11`);
  // type changé par le service (ex. crédit → autre) : le crédit est détaché sans bloquer la synchronisation
  await q(`update public.banque_comptes set credit_id = '${CA}' where user_id = '${A}' and id = 12`);
  const t2 = await un(`update public.banque_comptes set type = 'autre' where user_id = '${A}' and id = 12 returning credit_id`);
  assert.equal(t2.credit_id, null, "type non credit : crédit détaché");
  await q(`update public.banque_comptes set type = 'credit', credit_id = '${CA}' where user_id = '${A}' and id = 12`);
  await comme(db, A);
  // enveloppe vide ou blanche : ramenée à null
  const r = await un(`update public.banque_comptes set enveloppe = '  ', position_id = '${PA}' where id = 11 returning *`);
  assert.equal(r.enveloppe, null); assert.equal(r.position_id, PA);
  await q(`update public.banque_comptes set position_id = null, enveloppe = 'PEA' where id = 11`);
  // la règle vaut aussi pour les écritures du service (synchro) : propriétaire contrôlé par user_id
  await service();
  await refuse(`update public.banque_comptes set position_id = '${PA}' where user_id = '${B}' and id = 10`, [], /Ligne introuvable/, "service : position de A sur un compte de B");
  await refuse(`insert into public.banque_comptes (id, user_id, connexion_id, type, credit_id) values (77, '${B}', 1, 'credit', '${CA}')`, [], /Crédit introuvable/, "service : insertion");
  // ligne supprimée : le compte se détache (on delete set null)
  await superu();
  await q(`insert into public.positions (id, user_id, name) values ('aaaaaaaa-0000-0000-0000-0000000000ff', '${A}', 'Temporaire')`);
  await q(`update public.banque_comptes set position_id = 'aaaaaaaa-0000-0000-0000-0000000000ff' where user_id = '${A}' and id = 10`);
  await q(`delete from public.positions where id = 'aaaaaaaa-0000-0000-0000-0000000000ff'`);
  assert.equal((await un(`select position_id from public.banque_comptes where user_id = '${A}' and id = 10`)).position_id, null);
  await q(`update public.banque_comptes set position_id = '${PA2}' where user_id = '${A}' and id = 10`);
  await comme(db, A);
});

test("PGlite : banque_recalculer_mois — entrées, sorties en valeur absolue, nombre, mois ≥ depuis, autres utilisateurs intacts", async () => {
  await superu();
  await q(`insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle, categorie) values
    (2001, '${A}', 10, date_trunc('month', ${AUJ})::date, 2500, 'VIR SALAIRE', 'revenus'),
    (2002, '${A}', 10, date_trunc('month', ${AUJ})::date, -80.5, 'CARTE MARCHE', 'alimentation'),
    (2003, '${A}', 10, date_trunc('month', ${AUJ})::date, 10, 'REMBOURSEMENT', 'alimentation'),
    (2004, '${A}', 10, (date_trunc('month', ${AUJ}) - interval '1 month')::date, -700, 'LOYER', 'logement'),
    (2005, '${A}', 10, (date_trunc('month', ${AUJ}) - interval '1 month')::date, -15, 'PRELEVEMENT', null)`);
  // ligne périmée du mois courant (catégorie disparue) : effacée par le recalcul
  await q(`insert into public.banque_mois (user_id, mois, categorie, entrees, sorties, nombre) values ('${A}', date_trunc('month', ${AUJ})::date, 'loisirs', 0, 999, 9)`);
  await service();
  await q(`select public.banque_recalculer_mois($1, (date_trunc('month', ${AUJ}) - interval '1 month')::date)`, [A]);
  await superu();
  const mois = async u => (await q(`select to_char(mois, 'YYYY-MM-DD') m, categorie, entrees, sorties, nombre from public.banque_mois where user_id = $1 order by mois, categorie`, [u]))
    .map(r => ({ ...r, entrees: num(r.entrees), sorties: num(r.sorties) }));
  const [m0, m1] = [jour((await un(`select (date_trunc('month', ${AUJ}) - interval '1 month')::date d`)).d), jour((await un(`select date_trunc('month', ${AUJ})::date d`)).d)];
  assert.deepEqual(await mois(A), [
    { m: m0, categorie: "divers", entrees: 0, sorties: 15, nombre: 1 },
    { m: m0, categorie: "logement", entrees: 0, sorties: 700, nombre: 1 },
    { m: m1, categorie: "alimentation", entrees: 10, sorties: 130.5, nombre: 3 },
    { m: m1, categorie: "revenus", entrees: 2500, sorties: 0, nombre: 1 },
  ]);
  assert.deepEqual(await mois(B), [{ m: m1, categorie: "divers", entrees: 0, sorties: 20, nombre: 1 }], "B intact");
  // idempotent ; un mois antérieur à depuis n'est pas touché
  await q(`update public.banque_mois set sorties = 701 where user_id = '${A}' and mois = $1 and categorie = 'logement'`, [m0]);
  await service();
  await q(`select public.banque_recalculer_mois($1, ${AUJ})`, [A]);
  await q(`select public.banque_recalculer_mois($1, ${AUJ})`, [A]);
  await superu();
  const apres = await mois(A);
  assert.equal(apres.find(r => r.m === m0 && r.categorie === "logement").sorties, 701, "mois antérieur à depuis : inchangé");
  assert.equal(apres.filter(r => r.m === m1).length, 2, "mois courant : recalculé, sans doublon");
  // mois entamé par la purge (son 1er jour a plus de 90 jours) : jamais recalculé, pour ne pas écraser un total complet
  await q(`insert into public.banque_mois (user_id, mois, categorie, entrees, sorties, nombre)
    values ('${A}', date_trunc('month', ${AUJ} - 100)::date, 'logement', 0, 700, 1)`);
  await q(`insert into public.banque_operations (id, user_id, compte_id, date, montant, categorie) values (2006, '${A}', 10, ${AUJ} - 89, -5, 'loisirs')`);
  await service();
  await q(`select public.banque_recalculer_mois($1, ${AUJ} - 200)`, [A]);
  await superu();
  const vieux = await un(`select sorties, nombre from public.banque_mois where user_id = '${A}' and mois = date_trunc('month', ${AUJ} - 100)::date and categorie = 'logement'`);
  assert.equal(num(vieux.sorties), 700, "mois entamé par la purge : gardé"); assert.equal(vieux.nombre, 1);
  // refus d'arguments nuls
  await service();
  await refuse(`select public.banque_recalculer_mois(null, current_date)`, [], /Utilisateur et date de départ obligatoires/, "utilisateur nul");
  await refuse(`select public.banque_recalculer_mois('${A}', null)`, [], /obligatoires/, "date nulle");
  await comme(db, A);
});

test("PGlite : banque_purger — opérations de plus de p_jours supprimées (tous les utilisateurs), nombre renvoyé ; durée invalide refusée", async () => {
  await superu();
  await q(`insert into public.banque_operations (id, user_id, compte_id, date, montant) values
    (3001, '${A}', 10, ${AUJ} - 91, -1), (3002, '${A}', 10, ${AUJ} - 90, -1), (3003, '${B}', 10, ${AUJ} - 200, -1), (3004, '${B}', 10, ${AUJ} - 10, -1)`);
  const avant = (await un(`select count(*)::int n from public.banque_operations`)).n;
  await service();
  const n = (await un(`select public.banque_purger() n`)).n;
  await superu();
  assert.equal(n, 2, "deux opérations de plus de 90 jours");
  const ids = (await q(`select user_id, id from public.banque_operations where id between 3001 and 3004 order by id`)).map(r => Number(r.id));
  assert.deepEqual(ids, [3002, 3004], "90 jours pile : gardée");
  assert.equal((await un(`select count(*)::int n from public.banque_operations`)).n, avant - 2);
  await service();
  assert.equal((await un(`select public.banque_purger(90) n`)).n, 0, "idempotent");
  assert.ok((await un(`select public.banque_purger(5) n`)).n >= 2, "durée plus courte : au moins 3002 et 3004 (90 et 10 jours)");
  await superu();
  assert.equal((await un(`select count(*)::int n from public.banque_operations where id in (3002, 3004)`)).n, 0);
  await service();
  for (const v of ["0", "-1", "null"]) await refuse(`select public.banque_purger(${v})`, [], /Durée de conservation invalide/, "durée " + v);
  await comme(db, A);
});

test("PGlite : contenu sensible refusé dans le libellé d'une opération (banque_operations_contenu_sensible) ; ISIN et libellé nul acceptés", async () => {
  await superu();
  const ins = (id, libelle) => q(`insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle) values ($1, '${A}', 10, ${AUJ}, -1, $2)`, [id, libelle]);
  await refuse(`insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle) values (4001, '${A}', 10, ${AUJ}, -1, 'VIR FR76 3000 6000 0112 3456 7890 189')`,
    [], /banque_operations_contenu_sensible/, "IBAN");
  await refuse(`insert into public.banque_operations (id, user_id, compte_id, date, montant, libelle) values (4002, '${A}', 10, ${AUJ}, -1, 'CB 4970 1012 3456 7890')`,
    [], /banque_operations_contenu_sensible/, "carte");
  await ins(4003, "ACHAT IE00B4L5Y983 ETF");
  await ins(4004, null);
  await q(`delete from public.banque_operations where id in (4003, 4004)`);
  const def = (await un(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'banque_operations_contenu_sensible'`)).d;
  assert.match(def, /contenu_sensible\(libelle\)/);
  await comme(db, A);
});

test("PGlite : powens_* — Vault, empreinte SHA-256, réutilisation, oubli ; réservées à service_role", async () => {
  await service();
  const jeton = "jeton-factice-A-0123456789";
  assert.equal((await un(`select public.powens_enregistrer($1, 42, $2) ok`, [A, jeton])).ok, true, "enregistré");
  assert.equal((await un(`select public.powens_jeton($1) j`, [A])).j, jeton);
  assert.equal((await un(`select public.powens_utilisateur_par_empreinte($1) u`, [sha(jeton)])).u, A);
  assert.equal((await un(`select public.powens_utilisateur_par_empreinte($1) u`, [sha("autre")])).u, null, "empreinte inconnue : null");
  assert.equal((await un(`select public.powens_jeton($1) j`, [B])).j, null, "sans compte Powens : null");
  await superu();
  const p = await un(`select * from prive.powens_utilisateurs where user_id = $1`, [A]);
  assert.equal(Number(p.powens_user_id), 42); assert.equal(p.empreinte_jeton, sha(jeton));
  assert.ok(p.cree_le);
  const s = await un(`select * from vault.secrets where id = $1`, [p.secret_id]);
  assert.equal(s.secret, jeton, "jeton dans Vault"); assert.ok(!JSON.stringify(p).includes(jeton), "jamais en clair dans prive");
  // second enregistrement (double clic sur Connecter) : refusé sans rien toucher, renvoie false ; aucun secret créé
  await service();
  const jeton2 = "jeton-factice-A-bis";
  assert.equal((await un(`select public.powens_enregistrer($1, 99, $2) ok`, [A, jeton2])).ok, false, "déjà enregistré");
  await superu();
  assert.equal((await un(`select count(*)::int n from prive.powens_utilisateurs where user_id = $1`, [A])).n, 1);
  assert.equal((await un(`select secret_id from prive.powens_utilisateurs where user_id = $1`, [A])).secret_id, p.secret_id, "ligne intacte");
  assert.equal((await un(`select count(*)::int n from vault.secrets where secret = $1`, [jeton2])).n, 0, "aucun secret pour le second jeton");
  assert.match(SQL, /pg_advisory_xact_lock\(hashtext\(p_user::text\)\)/, "verrou consultatif par utilisateur");
  // réenregistrement explicite (jeton invalide) : powens_oublier puis powens_enregistrer
  await service();
  await q(`select public.powens_oublier($1)`, [A]);
  assert.equal((await un(`select public.powens_enregistrer($1, 42, $2) ok`, [A, jeton2])).ok, true);
  await superu();
  assert.equal((await un(`select count(*)::int n from vault.secrets where id = $1`, [p.secret_id])).n, 0, "ancien secret supprimé");
  assert.equal((await un(`select count(*)::int n from vault.secrets where secret like 'jeton-factice-A%'`)).n, 1, "un seul secret pour A");
  assert.equal((await un(`select count(*)::int n from prive.powens_a_supprimer`)).n, 0, "oubli normal : rien à supprimer plus tard");
  await service();
  assert.equal((await un(`select public.powens_jeton($1) j`, [A])).j, jeton2);
  assert.equal((await un(`select public.powens_utilisateur_par_empreinte($1) u`, [sha(jeton)])).u, null, "ancienne empreinte oubliée");
  assert.equal((await un(`select public.powens_utilisateur_par_empreinte($1) u`, [sha(jeton2)])).u, A);
  // le même jeton pour un autre utilisateur : refusé (empreinte unique), sans secret orphelin
  await refuse(`select public.powens_enregistrer($1, 43, $2)`, [B, jeton2], /empreinte_jeton|unique/, "jeton partagé");
  await refuse(`select public.powens_enregistrer($1, 43, '')`, [B], /Jeton Powens manquant/, "jeton vide");
  await refuse(`select public.powens_enregistrer($1, null, 'x')`, [B], /Identifiant Powens manquant/, "identifiant nul");
  // oubli : secret et ligne supprimés ; sans compte : sans effet
  await q(`select public.powens_enregistrer($1, 43, 'jeton-factice-B')`, [B]);
  await q(`select public.powens_oublier($1)`, [B]);
  await q(`select public.powens_oublier($1)`, [B]);
  assert.equal((await un(`select public.powens_jeton($1) j`, [B])).j, null);
  await superu();
  assert.equal((await un(`select count(*)::int n from vault.secrets where secret = 'jeton-factice-B'`)).n, 0, "secret de B supprimé");
  assert.equal((await un(`select count(*)::int n from prive.powens_utilisateurs where user_id = $1`, [B])).n, 0);
  assert.equal((await un(`select count(*)::int n from prive.powens_a_supprimer`)).n, 0);
  // droits : definer, search_path vide, exécution refusée à public / anon / authenticated, accordée à service_role
  for (const [n, sig, args] of FONCTIONS) {
    const f = await un(`select prosecdef s, proconfig c from pg_proc where oid = $1::regprocedure`, [`public.${n}(${sig})`]);
    assert.equal(f.s, true, n + " : security definer"); assert.deepEqual(f.c, ['search_path=""'], n);
    for (const role of ["anon", "authenticated"])
      assert.equal((await un(`select has_function_privilege($1, $2, 'execute') x`, [role, `public.${n}(${sig})`])).x, false, `${n} : ${role}`);
    const acl = (await un(`select proacl::text a from pg_proc where oid = $1::regprocedure`, [`public.${n}(${sig})`])).a;
    assert.doesNotMatch(acl, /(^|[{,])=X/, n + " : rien pour public");
    assert.equal((await un(`select has_function_privilege('service_role', $1, 'execute') x`, [`public.${n}(${sig})`])).x, true, n + " : service_role");
    await comme(db, A);
    await refuse(`select public.${n}(${args})`, [], /permission denied/, "authenticated : " + n);
    await db.exec(`reset role; set test.uid = ''; set role anon;`);
    await refuse(`select public.${n}(${args})`, [], /permission denied/, "anon : " + n);
    await superu();
  }
  await comme(db, A);
});

test("PGlite : jeton de nuit (Vault powens_nuit_token) et planification boussole-powens-nuit", async () => {
  await superu();
  const t = (await un(`select decrypted_secret t from vault.decrypted_secrets where name = 'powens_nuit_token'`)).t;
  assert.match(t, /^[0-9a-f]{32,}$/, "jeton créé par la migration");
  await service();
  assert.equal((await un(`select public.check_powens_nuit_token($1) ok`, [t])).ok, true);
  for (const v of ["", "faux", null]) assert.equal((await un(`select public.check_powens_nuit_token($1) ok`, [v])).ok, false, String(v));
  await superu();
  const nightly = (await un(`select decrypted_secret t from vault.decrypted_secrets where name = 'nightly_token'`)).t;
  await service();
  assert.equal((await un(`select public.check_powens_nuit_token($1) ok`, [nightly])).ok, false, "le jeton nocturne existant ne vaut pas");
  await superu();
  const job = await un(`select * from cron.job where jobname = 'boussole-powens-nuit'`);
  assert.equal(job.schedule, "0 0 * * *");
  assert.match(job.command, /net\.http_post/);
  assert.match(job.command, /https:\/\/oapcewpqsbbjdlcdeizi\.supabase\.co\/functions\/v1\/powens\/nuit/);
  assert.match(job.command, /'Bearer ' \|\| \(select decrypted_secret from vault\.decrypted_secrets where name = 'powens_nuit_token'\)/);
  // purge du détail : tâche SQL séparée (ne dépend pas de la fonction serveur)
  const purge = await un(`select * from cron.job where jobname = 'boussole-banque-purge'`);
  assert.equal(purge.schedule, "30 0 * * *");
  assert.match(purge.command, /select public\.banque_purger\(90\)/);
  await comme(db, A);
});

test("PGlite : export_all — définition de 0020 + fonctionnalites et tables banque_*, propres à l'utilisateur", async () => {
  await comme(db, A);
  const e = (await un(`select public.export_all() e`)).e;
  const cles = ["exported_at", "profile", "biens", "credits", "positions", "transactions", "snapshots", "config", "status", "budget",
    "objectifs", "propositions", "connexions_assistant", "memoire_agent", "journal", "routines",
    "fonctionnalites", "banque_connexions", "banque_comptes", "banque_placements", "banque_operations", "banque_mois", "foyer_evenements", "foyer_variantes", "plans_figes", "connecteurs_autorises",
    "historique_comptes", "historique_imports", "historique_releves", "historique_banque_mois", "photos_reconstituees", "budget_regles", "banque_marchands_mois"];
  assert.deepEqual(Object.keys(e).sort(), [...cles].sort(), "clés de 0020 + 6, puis foyer_evenements, foyer_variantes et plans_figes (0031), connecteurs_autorises (0033), les cinq tables de l'historique (0034), budget_regles et banque_marchands_mois (0035)");
  for (const k of ["fonctionnalites", ...TABLES]) {
    assert.ok(Array.isArray(e[k]) && e[k].length >= 1, k);
    assert.ok(e[k].every(r => r.user_id === A), k + " : lignes de A seulement");
  }
  assert.deepEqual(e.banque_connexions.map(c => Number(c.id)), [1, 2]);
  assert.ok(!JSON.stringify(e).includes("jeton-factice"), "aucun jeton exporté");
  // définition : celle de 0020, mot pour mot, plus les 6 clés
  const src = (await un(`select prosrc s from pg_proc where proname = 'export_all'`)).s;
  const m20 = readFileSync(new URL("../supabase/migrations/0020_routines.sql", import.meta.url), "utf8");
  const corps = s => s.slice(s.indexOf("'exported_at'"), s.indexOf("'routines',"));
  assert.ok(src.includes(corps(m20)), "lignes de 0020 reprises à l'identique");
  assert.match(src, /'banque_operations',\s+\(select coalesce\(jsonb_agg\(to_jsonb\(bo\) order by bo\.date, bo\.compte_id, bo\.id\), '\[\]'\) from public\.banque_operations bo where bo\.user_id = auth\.uid\(\)\)/);
});

test("PGlite : delete_me — cascade sur fonctionnalites, prive, banque_* et suppression du secret Vault ; B intact", async () => {
  await superu();
  await db.exec(`insert into public.fonctionnalites (user_id, cle, active) values ('${C}', 'banque', true);
    insert into public.banque_connexions (id, user_id, etablissement) values (1, '${C}', 'Banque C');
    insert into public.banque_comptes (id, user_id, connexion_id, type, solde) values (10, '${C}', 1, 'pea', 10);
    insert into public.banque_placements (id, user_id, compte_id, isin) values (100, '${C}', 10, 'IE00B4L5Y983');
    insert into public.banque_operations (id, user_id, compte_id, date, montant) values (1, '${C}', 10, ${AUJ}, -3);
    insert into public.banque_mois (user_id, mois, categorie, sorties, nombre) values ('${C}', date_trunc('month', ${AUJ})::date, 'divers', 3, 1);`);
  await service();
  await q(`select public.powens_enregistrer($1, 77, 'jeton-factice-C')`, [C]);
  await superu();
  const compte = async u => {
    let n = 0;
    for (const t of ["public.fonctionnalites", "prive.powens_utilisateurs", ...TABLES.map(t => "public." + t)])
      n += (await un(`select count(*)::int n from ${t} where user_id = $1`, [u])).n;
    return n;
  };
  assert.equal(await compte(C), 7);
  const avantB = await compte(B);
  await comme(db, C);
  await q(`select public.delete_me()`);
  await superu();
  assert.equal(await compte(C), 0, "toutes les lignes de C supprimées");
  // l'utilisateur Powens n'a pas été supprimé avant delete_me : il est mis de côté pour la nuit, avec son secret (seul moyen de le
  // supprimer chez Powens) ; plus aucun lien avec le compte Boussole supprimé
  const a = await q(`select * from prive.powens_a_supprimer`);
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].user_id, Number(a[0].powens_user_id)], [null, 77], "user_id null après la cascade");
  assert.equal((await un(`select secret from vault.secrets where id = $1`, [a[0].secret_id])).secret, "jeton-factice-C", "secret gardé pour la nuit");
  assert.equal(await compte(B), avantB, "B intact");
  // la nuit : liste (jeton compris, service seulement), puis fait → secret et ligne supprimés
  await service();
  const l = await q(`select * from public.powens_a_supprimer_lister(10)`);
  assert.deepEqual(l.map(x => [Number(x.id), Number(x.powens_user_id), x.jeton]), [[Number(a[0].id), 77, "jeton-factice-C"]]);
  await q(`select public.powens_a_supprimer_fait($1)`, [a[0].id]);
  await q(`select public.powens_a_supprimer_fait($1)`, [a[0].id]);
  assert.equal((await q(`select * from public.powens_a_supprimer_lister(10)`)).length, 0);
  await superu();
  assert.equal((await un(`select count(*)::int n from vault.secrets where secret = 'jeton-factice-C'`)).n, 0, "secret Vault de C supprimé par la nuit");
  assert.equal((await un(`select count(*)::int n from prive.powens_a_supprimer`)).n, 0);
  // le déclencheur rattrape un refus d'accès à Vault : delete_me n'est jamais bloqué
  assert.match(SQL, /exception when insufficient_privilege/);
  await comme(db, A);
});

test("PGlite : banque_verrouiller — bail de 2 min par (utilisateur, connexion), connexion créée au besoin, libéré par banque_deverrouiller", async () => {
  await service();
  const v = async (u, c) => (await un(`select public.banque_verrouiller($1, $2) ok`, [u, c])).ok;
  assert.equal(await v(A, 1), true, "premier verrou");
  assert.equal(await v(A, 1), false, "déjà verrouillée");
  assert.equal(await v(A, 2), true, "autre connexion : indépendante");
  assert.equal(await v(B, 1), true, "autre utilisateur : indépendant");
  await superu();
  assert.ok((await un(`select verrou_jusqua > now() + interval '100 seconds' and verrou_jusqua <= now() + interval '120 seconds' ok from public.banque_connexions where user_id = '${A}' and id = 1`)).ok, "2 minutes");
  // bail expiré : repris
  await q(`update public.banque_connexions set verrou_jusqua = now() - interval '1 second' where user_id = '${A}' and id = 1`);
  await service();
  assert.equal(await v(A, 1), true, "bail expiré repris");
  await q(`select public.banque_deverrouiller($1, $2)`, [A, 1]);
  assert.equal(await v(A, 1), true, "libéré");
  // connexion inconnue : ligne créée, verrouillée
  assert.equal(await v(A, 55), true);
  await superu();
  assert.equal((await un(`select count(*)::int n from public.banque_connexions where user_id = '${A}' and id = 55`)).n, 1);
  await q(`delete from public.banque_connexions where user_id = '${A}' and id = 55`);
  await q(`update public.banque_connexions set verrou_jusqua = null`);
  // recalcul des mois protégé contre deux synchronisations du même utilisateur
  assert.match(SQL, /pg_advisory_xact_lock\(hashtext\('banque_mois:' \|\| p_user::text\)\)/);
  await comme(db, A);
});

test("PGlite : banque_recalculer_mois — comptes carte à débit différé exclus si un compte courant de la connexion existe", async () => {
  await superu();
  await q(`insert into public.banque_connexions (id, user_id) values (30, '${B}'), (31, '${B}')`);
  await q(`insert into public.banque_comptes (id, user_id, connexion_id, type, debit_differe) values
    (300, '${B}', 30, 'courant', false), (301, '${B}', 30, 'courant', true), (310, '${B}', 31, 'courant', true)`);
  await q(`insert into public.banque_operations (id, user_id, compte_id, date, montant, categorie) values
    (30001, '${B}', 300, ${AUJ}, -120, 'loisirs'), (30002, '${B}', 301, ${AUJ}, -40, 'loisirs'), (30003, '${B}', 301, ${AUJ}, 5, 'loisirs'),
    (31001, '${B}', 310, ${AUJ}, -7, 'loisirs')`);
  await service();
  await q(`select public.banque_recalculer_mois($1, ${AUJ})`, [B]);
  await superu();
  // un total par compte depuis 0025 : sommés ici
  const l = await un(`select sum(entrees) entrees, sum(sorties) sorties, sum(nombre)::int nombre from public.banque_mois where user_id = '${B}' and mois = date_trunc('month', ${AUJ})::date and categorie = 'loisirs'`);
  assert.deepEqual([num(l.entrees), num(l.sorties), l.nombre], [0, 127, 2], "carte de la connexion 30 exclue (relevé déjà débité sur le courant) ; carte seule (31) comptée");
  await q(`delete from public.banque_connexions where user_id = '${B}' and id in (30, 31)`);
  await service();
  await q(`select public.banque_recalculer_mois($1, ${AUJ})`, [B]);
  await comme(db, A);
});
