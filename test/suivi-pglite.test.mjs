// SUIVI, partie A (GOV1 et SCO2 ; docs/superpowers/specs/2026-10-15-suivi-lignes-design.md § 3 et § 3.2, plan tâche 1) : migration 0032 exercée sur un
// vrai PostgreSQL (PGlite, en mémoire) : 0001 → 0031 appliquées sur les bouchons Supabase (test/helpers/pglite.mjs, baseComplete), données de
// départ, puis 0032 (rejouée pour vérifier qu'elle est idempotente). Couvre positions.role / role_source, config.suivi, routines.etat_suivi
// (colonnes, contraintes, bornes), appliquer_propositions (cibles position et config, frais_enveloppes), cloturer_routine (avec et sans état du
// suivi), la double authentification (0028), export_all, la suppression du compte, les 35 repères et les 6 fiches de la fixture
// test/fixtures/suivi-cas.json, la reformulation des expertises (Claude à la place de « Copilote », plus de « conseiller ») et la parité avec
// scripts/gen-expertises-demo.mjs. Valeurs fictives uniquement ; aucun réseau, aucun secret.
//
// À propos de « protégé » : comme config.projection (0031) et les autres champs de positions, role / role_source / config.suivi ne sont pas
// protégés par un droit de colonne : le propriétaire d'une ligne peut l'écrire (RLS), et l'app est en lecture seule par convention (la saisie passe
// par une proposition). Ce que la base impose : les contraintes de table (valeurs, cohérence, taille, objet) pour toute écriture, et les bornes
// détaillées pour la voie appliquer_propositions. Les tests ci-dessous disent exactement cela.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseComplete } from "./helpers/pglite.mjs";
import { lireExpertises, lireExpertisesAJour, lireReformulation, appliquerReformulation, bloc, SOURCE_MAJ } from "../scripts/gen-expertises-demo.mjs";

const DIR = new URL("../supabase/migrations/", import.meta.url);
const SQL = readFileSync(new URL("0032_suivi.sql", DIR), "utf8");
const SQL_0031 = readFileSync(new URL("0031_projection.sql", DIR), "utf8");
const SQL_0020 = readFileSync(new URL("0020_routines.sql", DIR), "utf8");
const SQL_0017 = readFileSync(new URL("0017_expertises_contenu.sql", DIR), "utf8");
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/suivi-cas.json", import.meta.url), "utf8"));
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", C = "33333333-3333-3333-3333-333333333333";
const REPRISES = FIXTURE.reperes.filter(r => r.reprise).map(r => r.cle);
const NOUVEAUX = FIXTURE.reperes.filter(r => !r.reprise);
let db, AUJ, AVANT;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const superu = () => db.exec(`reset role; set test.uid = ''; set test.aal = 'aal2';`);
/** Session simulée : rôle authenticated, utilisateur uid, niveau d'assurance aal. */
const comme = (uid, aal = "aal2") => db.exec(`reset role; set test.uid = '${uid}'; set test.aal = '${aal}'; set role authenticated;`);
const refuse = async (s, motif, m, p) => {
  await assert.rejects(db.query(s, p), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
};

/* ---------- propositions ---------- */
const proposer = async (cible, apres, o = {}) => (await q(`insert into public.propositions (cible, operation, ref, apres, source)
  values ($1, $2, $3, $4, $5) returning id`, [cible, o.operation ?? (cible === "config" || o.ref ? "modifier" : "creer"), o.ref ?? null,
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
const SRC = "Revue de la politique de suivi avec l'utilisateur";
const suiviDe = async uid => (await un(`select suivi from public.config where user_id = '${uid}'`)).suivi;
const reinitSuivi = () => db.exec(`update public.config set suivi = '{}'::jsonb`);
const positionDe = async id => await un(`select role, role_source from public.positions where id = $1`, [id]);

before(async () => {
  db = await baseComplete("0031_projection.sql");
  await db.exec(`
    insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
    insert into auth.mfa_factors (user_id, status) values ('${A}', 'verified');   -- A : double authentification ; B et C : aucun facteur
    insert into public.config (user_id) values ('${A}'), ('${B}'), ('${C}') on conflict (user_id) do nothing;`);
  AVANT = {
    reperes: Object.fromEntries((await q(`select * from public.reperes order by cle`)).map(r => [r.cle, r])),
    n: (await un(`select count(*)::int n from public.reperes`)).n,
    expertises: await q(`select slug, version, mis_a_jour_le::text d, jsonb_array_length(changelog) nj from public.expertises order by slug`),
    fiches: (await un(`select count(*)::int n from public.savoir_fiches`)).n,
  };
  await db.exec(SQL.replace(/^create extension[^;]*;/gim, ""));
  AUJ = (await un(`select (now() at time zone 'Europe/Paris')::date::text d`)).d;
});
after(async () => { await db.close(); });

/* =========================================================================================================== migration : texte */
test("migration 0032 : en-tête (non appliquée, après 0031, avant mcp), tutoiement, sans secret, aucune politique ni table retirée", () => {
  assert.match(SQL, /^-- Boussole : suivi de mes lignes, partie A/);
  assert.match(SQL, /Non appliquée : à appliquer avec apply_migration \(name = "suivi"\)/);
  assert.match(SQL, /après 0031 \(projection\), AVANT le\n-- déploiement de la fonction mcp/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(SQL, /sb_secret_|eyJhbGci/);
  assert.doesNotMatch(SQL, /\bdrop\s+policy\b/i);
  assert.doesNotMatch(SQL, /\bdrop\s+table\b/i);
  assert.doesNotMatch(SQL, /\bcreate\s+table\b/i, "aucune table nouvelle : les politiques de propriétaire et de double authentification existantes couvrent les colonnes");
  assert.doesNotMatch(SQL, /\b[A-Z]{2}[0-9A-Z]{9}[0-9]\b(?<!LEGIARTI0000)/, "aucun ISIN");
});
test("migration 0032 : « Copilote » et « conseiller » n'y figurent que dans les commentaires et dans la liste des anciens textes à reformuler", () => {
  const sansBloc = SQL.replace(/-- @expertises-reformulation — début[\s\S]*?-- @expertises-reformulation — fin/, "");
  const code = sansBloc.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(code, /Copilote|conseiller/i);
  const bloc = /-- @expertises-reformulation — début([\s\S]*?)-- @expertises-reformulation — fin/.exec(SQL)[1];
  const nouveaux = [...bloc.matchAll(/\$n\$([\s\S]*?)\$n\$/g)].map(m => m[1]).join("\n");
  assert.doesNotMatch(nouveaux, /Copilote|conseiller/i, "les nouveaux textes ne disent plus ni Copilote ni conseiller");
});
test("appliquer_propositions : le diff contre 0031 est limité à des ajouts (douze lignes modifiées, listées ici)", () => {
  const fn = s => { const i = s.indexOf("create or replace function public.appliquer_propositions"); return s.slice(i, s.indexOf("\n$$;\n", i)).split("\n"); };
  const [a, b] = [fn(SQL_0031), fn(SQL)];
  const compte = l => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const [ca, cb] = [compte(a), compte(b)];
  const retirees = a.filter(l => ca.get(l) > (cb.get(l) || 0)).map(l => l.trim());
  assert.equal(retirees.length, 12, retirees.join("\n"));
  const attendues = [/^status, hypothesis, qty_estimated, note\)$/, /^coalesce\(v->>'status', 'actif'\), v->>'hypothesis'.*v->>'note'\)$/, /^note += case when v \? 'note'/,
    /^where k not in \('cushion', 'recurring', 'frais_enveloppes'/, /^raise exception 'réglage « % » non modifiable par proposition/, /^if not \(v \? 'cushion' or v \? 'recurring'/,
    /^raise exception 'réglages : cushion ou recurring attendu/, /^-- frais_enveloppes \(0026\)/, /^select k into v_txt from jsonb_object_keys\(v_val\) k where k not in \('gestion_uc_pct'/,
    /^raise exception 'frais_enveloppes « % » : champ « % » inconnu/, /^foreach v_txt in array array\['gestion_uc_pct', 'gestion_euro_pct', 'garde_pct'\] loop$/,
    /^raise exception 'frais_enveloppes « % » : au moins un pourcentage attendu/];
  for (const re of attendues) assert.equal(retirees.filter(l => re.test(l)).length, 1, "ligne modifiée attendue : " + re);
  // les lignes ajoutées ne retirent rien : toutes les lignes de 0031 qui ne sont pas dans la liste ci-dessus sont encore là
  assert.ok(b.length > a.length + 80, "les cibles ajoutées sont bien là : " + (b.length - a.length) + " lignes de plus");
});
test("cloturer_routine : le corps ne diffère de 0020 que par le paramètre, la validation et l'écriture de l'état du suivi", () => {
  const fn = (s, nom) => { const i = s.indexOf("create or replace function public.cloturer_routine"); return s.slice(i, s.indexOf("\n$$;\n", i)).split("\n"); };
  const [a, b] = [fn(SQL_0020), fn(SQL)];
  const compte = l => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const [ca, cb] = [compte(a), compte(b)];
  const retirees = a.filter(l => ca.get(l) > (cb.get(l) || 0)).map(l => l.trim());
  assert.deepEqual(retirees, ["create or replace function public.cloturer_routine(p_type text, p_client text, p_synthese text, p_questions jsonb)"]);
  const ajoutees = b.filter(l => cb.get(l) > (ca.get(l) || 0)).map(l => l.trim());
  assert.ok(ajoutees.some(l => /^create or replace function public\.cloturer_routine\(.*p_etat_suivi jsonb default null\)$/.test(l)));
  assert.ok(ajoutees.includes("etat_suivi       = coalesce(v_etat, r.etat_suivi),"), "écrit s'il est fourni, conservé sinon");
});

/* =========================================================================================================== colonnes et contraintes */
test("colonnes : positions.role et role_source (texte, null, sans défaut), config.suivi (jsonb, non nul, {}), routines.etat_suivi (jsonb, null)", async () => {
  const col = async (t, c) => await un(`select data_type t, is_nullable n, column_default d from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`, [t, c]);
  assert.deepEqual(await col("positions", "role"), { t: "text", n: "YES", d: null });
  assert.deepEqual(await col("positions", "role_source"), { t: "text", n: "YES", d: null });
  assert.deepEqual(await col("config", "suivi"), { t: "jsonb", n: "NO", d: "'{}'::jsonb" });
  assert.deepEqual(await col("routines", "etat_suivi"), { t: "jsonb", n: "YES", d: null });
  assert.deepEqual(await suiviDe(A), {}, "les configs existantes reçoivent {}");
});
test("positions : role (reserve, coeur, satellite ou null), role_source (propose, valide ou null), pas de role_source sans role — même en écriture directe", async () => {
  await comme(A);
  await q(`insert into public.positions (user_id, name) values ('${A}', 'Ligne sans rôle')`);
  const id = (await un(`select id from public.positions where user_id = '${A}' and name = 'Ligne sans rôle'`)).id;
  const maj = (set) => db.query(`update public.positions set ${set} where id = '${id}'`);
  for (const r of ["reserve", "coeur", "satellite"]) { await maj(`role = '${r}', role_source = 'propose'`); assert.equal((await positionDe(id)).role, r); }
  await maj(`role_source = 'valide'`);
  await maj(`role = null, role_source = null`);
  await refuse(`update public.positions set role = 'noyau' where id = '${id}'`, /positions_role/, "rôle inconnu");
  await refuse(`update public.positions set role = 'Coeur' where id = '${id}'`, /positions_role/, "casse");
  await refuse(`update public.positions set role = '' where id = '${id}'`, /positions_role/, "vide");
  await refuse(`update public.positions set role = 'coeur', role_source = 'auto' where id = '${id}'`, /positions_role_source/, "source inconnue");
  await refuse(`update public.positions set role_source = 'valide' where id = '${id}'`, /positions_role_source_coherent/, "source sans rôle");
  await refuse(`insert into public.positions (user_id, name, role_source) values ('${A}', 'X', 'propose')`, /positions_role_source_coherent/, "insertion : source sans rôle");
  await refuse(`insert into public.positions (user_id, name, role) values ('${A}', 'X', 'autre')`, /positions_role/, "insertion : rôle inconnu");
  await maj(`role = 'coeur'`);
  assert.deepEqual(await positionDe(id), { role: "coeur", role_source: null }, "un rôle sans source est permis");
  await q(`delete from public.positions where id = '${id}'`);
});
test("config.suivi : objet seulement ; routines.etat_suivi : objet de 20 000 octets au plus ou null", async () => {
  await comme(A);
  await refuse(`update public.config set suivi = '[]'::jsonb where user_id = '${A}'`, /config_suivi/, "tableau refusé");
  await refuse(`update public.config set suivi = '"x"'::jsonb where user_id = '${A}'`, /config_suivi/, "texte refusé");
  await refuse(`update public.config set suivi = null where user_id = '${A}'`, /null value|not-null/i, "null refusé");
  await q(`insert into public.routines (user_id, type) values ('${A}', 'revue_mensuelle')`);
  const limite = `jsonb_build_object('a', repeat('x', 20000 - octet_length('{"a": ""}')))`;
  assert.equal((await un(`select octet_length((${limite})::text) n`)).n, 20000);
  await refuse(`update public.routines set etat_suivi = '[]'::jsonb where user_id = '${A}'`, /routines_etat_suivi/, "tableau refusé");
  await refuse(`update public.routines set etat_suivi = '1'::jsonb where user_id = '${A}'`, /routines_etat_suivi/, "nombre refusé");
  await refuse(`update public.routines set etat_suivi = jsonb_build_object('a', repeat('x', 20001 - octet_length('{"a": ""}'))) where user_id = '${A}'`, /routines_etat_suivi/, "20 001 octets refusés");
  await q(`update public.routines set etat_suivi = ${limite} where user_id = '${A}'`);
  assert.equal((await un(`select octet_length(etat_suivi::text) n from public.routines where user_id = '${A}'`)).n, 20000, "20 000 octets acceptés");
  await q(`update public.routines set etat_suivi = null where user_id = '${A}'`);
  await q(`delete from public.routines where user_id = '${A}'`);
});
test("écriture directe : B ne touche ni la ligne ni la config de A (RLS) ; ce qui s'écrit directement reste borné par les contraintes de table", async () => {
  await superu();
  await q(`insert into public.positions (user_id, name, role, role_source) values ('${A}', 'Ligne de A', 'satellite', 'valide')`);
  await comme(B);
  assert.equal((await db.query(`update public.positions set role = 'reserve' where user_id = '${A}'`)).affectedRows, 0);
  assert.equal((await db.query(`update public.config set suivi = '{"revue_coeur":"annuelle"}' where user_id = '${A}'`)).affectedRows, 0);
  assert.equal((await q(`select 1 from public.positions where user_id = '${A}'`)).length, 0, "B ne lit pas la ligne de A");
  await superu();
  assert.deepEqual(await un(`select role, role_source from public.positions where user_id = '${A}' and name = 'Ligne de A'`), { role: "satellite", role_source: "valide" });
  await q(`delete from public.positions where user_id = '${A}' and name = 'Ligne de A'`);
});

/* =========================================================================================================== appliquer_propositions : position */
test("position : création et modification avec role / role_source ; null les retire (et retire la source avec le rôle) ; valeurs bornées", async () => {
  await comme(A);
  const idp = await accepte("position", { name: "Fonds monde fictif", envelope: "PEA", role: "coeur", role_source: "propose" }, "création avec rôle");
  const pos = (await un(`select id from public.positions where user_id = '${A}' and name = 'Fonds monde fictif'`)).id;
  assert.deepEqual(await positionDe(pos), { role: "coeur", role_source: "propose" });
  assert.equal((await un(`select statut from public.propositions where id = '${idp}'`)).statut, "acceptee");
  await accepte("position", { role_source: "valide" }, "validation du rôle", { ref: pos });
  assert.deepEqual(await positionDe(pos), { role: "coeur", role_source: "valide" });
  await accepte("position", { role: "satellite" }, "autre rôle, source gardée", { ref: pos });
  assert.deepEqual(await positionDe(pos), { role: "satellite", role_source: "valide" });
  await accepte("position", { note: "autre champ" }, "un autre champ ne touche pas au rôle", { ref: pos });
  assert.deepEqual(await positionDe(pos), { role: "satellite", role_source: "valide" });
  await accepte("position", { role: null }, "rôle retiré : la source part avec lui", { ref: pos });
  assert.deepEqual(await positionDe(pos), { role: null, role_source: null });
  await accepte("position", { role: "reserve", role_source: "propose" }, "rôle et source ensemble", { ref: pos });
  await accepte("position", { role: null, role_source: null }, "les deux retirés", { ref: pos });
  assert.deepEqual(await positionDe(pos), { role: null, role_source: null });
  for (const [v, motif, m] of [
    [{ role: "noyau" }, /role invalide \(reserve, coeur ou satellite attendu\)/, "rôle inconnu"],
    [{ role: "COEUR" }, /role invalide/, "casse"],
    [{ role: 3 }, /role invalide/, "nombre"],
    [{ role: true }, /role invalide/, "booléen"],
    [{ role: ["coeur"] }, /role invalide/, "tableau"],
    [{ role: "coeur", role_source: "auto" }, /role_source invalide \(propose ou valide attendu\)/, "source inconnue"],
    [{ role: "coeur", role_source: 1 }, /role_source invalide/, "source nombre"],
  ]) {
    await refusee("position", v, motif, m + " (modification)", { ref: pos });
    await refusee("position", { name: "Autre fonds fictif", ...v }, motif, m + " (création)");
  }
  await refusee("position", { name: "Autre fonds fictif", role_source: "propose" }, /role_source sans role/, "création : source sans rôle");
  await refusee("position", { role_source: "valide" }, /refusée par la base|role_source/, "modification : source sans rôle", { ref: pos });
  assert.equal((await un(`select count(*)::int n from public.positions where user_id = '${A}' and name = 'Autre fonds fictif'`)).n, 0, "rien créé");
  assert.deepEqual(await positionDe(pos), { role: null, role_source: null }, "rien modifié");
  await accepte("position", {}, "supprimer", { ref: pos, operation: "supprimer" });
});
test("position : un role dans une modification de l'utilisateur (p_modifications) est contrôlé comme dans la proposition", async () => {
  await comme(A);
  await q(`insert into public.positions (user_id, name) values ('${A}', 'Ligne corrigée')`);
  const pos = (await un(`select id from public.positions where user_id = '${A}' and name = 'Ligne corrigée'`)).id;
  const id = await proposer("position", { role: "coeur", role_source: "propose" }, { ref: pos });
  await assert.rejects(appliquer([id], { [id]: { role: "mauvais" } }), /role invalide/);
  assert.equal(await appliquer([id], { [id]: { role: "satellite", role_source: "valide" } }), 1);
  assert.deepEqual(await positionDe(pos), { role: "satellite", role_source: "valide" }, "la valeur corrigée par l'utilisateur est celle qui s'applique");
  await q(`delete from public.positions where id = '${pos}'`);
});

/* =========================================================================================================== appliquer_propositions : config.suivi */
const COMPLET = { revue_coeur: "semestrielle", mois_revue_coeur: 4, seuil_ecart_pts: 5, plafond_satellite_pct: 15, seuil_baisse_satellite_pct: 25,
  semaine: { actif: true, jour: "lundi" }, source: SRC, le: "2026-10-01" };
test("config.suivi : une politique complète est enregistrée telle quelle ; la clé suivi est dans la liste blanche (les autres clés restent refusées)", async () => {
  await comme(A); await reinitSuivi();
  await accepte("config", { suivi: COMPLET }, "politique complète");
  assert.deepEqual(await suiviDe(A), COMPLET);
  await refusee("config", { suivi: COMPLET, autre: 1 }, /réglage « autre » non modifiable par proposition \(.*projection ou suivi seulement\)/, "clé inconnue");
  await refusee("config", {}, /réglages : cushion ou recurring attendu \(ou .*projection ou suivi\)/, "objet vide");
  await refusee("config", { suivi: [] }, /suivi : objet attendu/, "tableau");
  await refusee("config", { suivi: "x" }, /suivi : objet attendu/, "texte");
  await refusee("config", { suivi: null }, /suivi : objet attendu/, "null");
  await refusee("config", { suivi: {} }, /suivi : au moins un réglage attendu/, "objet vide");
  await refusee("config", { suivi: { source: SRC } }, /suivi : au moins un réglage attendu/, "source seule");
  await refusee("config", { suivi: { source: SRC, le: "2026-10-01" } }, /suivi : au moins un réglage attendu/, "source et date seules");
  await refusee("config", { suivi: { revue_coeur: "annuelle", source: SRC, inconnu: 1 } }, /suivi : champ « inconnu » inconnu \(revue_coeur, mois_revue_coeur, seuil_ecart_pts, plafond_satellite_pct, seuil_baisse_satellite_pct, semaine, source, le\)/, "champ inconnu");
  await refusee("config", { suivi: { revue_coeur: "annuelle", source: SRC } , cushion: { mode: "amount", min: -1 } }, /cushion\.min invalide/, "autre clé fautive : tout est refusé");
  assert.deepEqual(await suiviDe(A), COMPLET, "rien n'a changé");
});
test("config.suivi : revue_coeur (annuelle ou semestrielle)", async () => {
  await comme(A); await reinitSuivi();
  for (const v of ["annuelle", "semestrielle"]) { await accepte("config", { suivi: { revue_coeur: v, source: SRC } }, v); assert.equal((await suiviDe(A)).revue_coeur, v); }
  for (const v of ["mensuelle", "Annuelle", "", 1, true, ["annuelle"], { a: 1 }])
    await refusee("config", { suivi: { revue_coeur: v, source: SRC } }, /suivi : revue_coeur invalide \(annuelle ou semestrielle attendu\)/, "revue_coeur " + JSON.stringify(v));
});
test("config.suivi : mois_revue_coeur (entier de 1 à 12, les bornes sont acceptées)", async () => {
  await comme(A); await reinitSuivi();
  for (const [v, att] of [[1, 1], [12, 12], [6, 6], ["7", 7], [" 3 ", 3]]) { await accepte("config", { suivi: { mois_revue_coeur: v, source: SRC } }, "mois " + v); assert.equal((await suiviDe(A)).mois_revue_coeur, att); }
  for (const v of [0, 13, -1, 6.5, 0.99, 12.01, "abc", "", true, [3], 1e9])
    await refusee("config", { suivi: { mois_revue_coeur: v, source: SRC } }, /suivi : mois_revue_coeur invalide \(mois de 1 à 12 attendu\)/, "mois " + JSON.stringify(v));
});
test("config.suivi : seuil_ecart_pts (3 à 10), plafond_satellite_pct (0 à 30), seuil_baisse_satellite_pct (10 à 50) : bornes acceptées, hors bornes refusées avec message", async () => {
  await comme(A);
  const champs = [["seuil_ecart_pts", 3, 10, "écart de 3 à 10 points"], ["plafond_satellite_pct", 0, 30, "pourcentage de 0 à 30"], ["seuil_baisse_satellite_pct", 10, 50, "pourcentage de 10 à 50"]];
  for (const [c, min, max, dit] of champs) {
    await reinitSuivi();
    for (const v of [min, max, (min + max) / 2, min + 0.5, max - 0.5, String(min), String(max)]) {
      await accepte("config", { suivi: { [c]: v, source: SRC } }, c + " = " + v);
      assert.equal((await suiviDe(A))[c], +v, c + " enregistré");
    }
    for (const v of [min - 0.1, max + 0.1, min - 1, max + 1, -5, 1000, "abc", "", true, [min], { a: min }]) {
      const m = await refusee("config", { suivi: { [c]: v, source: SRC } }, new RegExp(`suivi : ${c} invalide \\(${dit} attendu\\)`), c + " = " + JSON.stringify(v));
      assert.ok(!/refusée par la base/.test(m), "message du contrôle, pas de la base");
    }
    assert.equal((await suiviDe(A))[c], max, "valeur précédente conservée après les refus");
  }
});
test("config.suivi : semaine { actif, jour } — actif booléen obligatoire, jour lundi à dimanche, aucun autre champ", async () => {
  await comme(A); await reinitSuivi();
  for (const j of ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]) {
    await accepte("config", { suivi: { semaine: { actif: true, jour: j }, source: SRC } }, j);
    assert.deepEqual((await suiviDe(A)).semaine, { actif: true, jour: j });
  }
  await accepte("config", { suivi: { semaine: { actif: false }, source: SRC } }, "actif seul");
  assert.deepEqual((await suiviDe(A)).semaine, { actif: false }, "la semaine remplace l'entrée en entier");
  await accepte("config", { suivi: { semaine: { actif: true, jour: null }, source: SRC } }, "jour null");
  assert.deepEqual((await suiviDe(A)).semaine, { actif: true });
  for (const [v, motif, m] of [
    [{ jour: "lundi" }, /suivi\.semaine : actif invalide \(vrai ou faux attendu\)/, "actif manquant"],
    [{ actif: "oui", jour: "lundi" }, /suivi\.semaine : actif invalide/, "actif texte"],
    [{ actif: 1 }, /suivi\.semaine : actif invalide/, "actif nombre"],
    [{ actif: true, jour: "Lundi" }, /suivi\.semaine : jour invalide \(lundi, mardi, mercredi, jeudi, vendredi, samedi ou dimanche attendu\)/, "casse"],
    [{ actif: true, jour: "weekend" }, /suivi\.semaine : jour invalide/, "jour inconnu"],
    [{ actif: true, jour: 1 }, /suivi\.semaine : jour invalide/, "jour nombre"],
    [{ actif: true, jour: "" }, /suivi\.semaine : jour invalide/, "jour vide"],
    [{ actif: true, jour: "lundi", heure: 8 }, /suivi\.semaine : champ « heure » inconnu \(actif, jour\)/, "champ inconnu"],
    [[], /suivi : semaine invalide \(objet \{ actif, jour \} attendu\)/, "tableau"],
    ["lundi", /suivi : semaine invalide/, "texte"],
    [true, /suivi : semaine invalide/, "booléen"],
  ]) await refusee("config", { suivi: { semaine: v, source: SRC } }, motif, "semaine " + m);
  assert.deepEqual((await suiviDe(A)).semaine, { actif: true }, "valeur précédente conservée après les refus");
});
test("config.suivi : source obligatoire (1 à 300 caractères, texte), le (AAAA-MM-JJ, pas dans le futur ; date du jour par défaut)", async () => {
  await comme(A); await reinitSuivi();
  const base = { revue_coeur: "annuelle" };
  await refusee("config", { suivi: base }, /suivi : source obligatoire \(1 à 300 caractères\)/, "source absente");
  for (const v of ["", "   ", null, 5, true, ["x"], { a: 1 }, "x".repeat(301)])
    await refusee("config", { suivi: { ...base, source: v } }, /suivi : source obligatoire \(1 à 300 caractères\)/, "source " + JSON.stringify(v).slice(0, 20));
  await accepte("config", { suivi: { ...base, source: "x".repeat(300) } }, "300 caractères");
  assert.equal((await suiviDe(A)).source.length, 300);
  await accepte("config", { suivi: { ...base, source: "  Entretien du jour  " } }, "source rognée");
  assert.equal((await suiviDe(A)).source, "Entretien du jour");
  assert.equal((await suiviDe(A)).le, AUJ, "la date du jour est posée quand « le » manque");
  await accepte("config", { suivi: { ...base, source: SRC, le: AUJ } }, "aujourd'hui accepté");
  await accepte("config", { suivi: { ...base, source: SRC, le: "2020-02-29" } }, "date passée");
  assert.equal((await suiviDe(A)).le, "2020-02-29");
  await accepte("config", { suivi: { ...base, source: SRC, le: null } }, "le null : date du jour");
  assert.equal((await suiviDe(A)).le, AUJ);
  const demain = (await un(`select ((now() at time zone 'Europe/Paris')::date + 1)::text d`)).d;
  await refusee("config", { suivi: { ...base, source: SRC, le: demain } }, /suivi : date \(le\) dans le futur/, "demain");
  for (const v of ["2026-13-01", "2026-02-30", "01/10/2026", "2026-10", "", 20261001, true])
    await refusee("config", { suivi: { ...base, source: SRC, le: v } }, /suivi : date \(le\) invalide \(AAAA-MM-JJ\)/, "le " + JSON.stringify(v));
});
test("config.suivi : fusion champ par champ, null retire un champ, tout ou rien sur plusieurs propositions", async () => {
  await comme(A); await reinitSuivi();
  await accepte("config", { suivi: { revue_coeur: "annuelle", seuil_ecart_pts: 5, source: "Première", le: "2026-09-01" } }, "première");
  await accepte("config", { suivi: { plafond_satellite_pct: 12, source: "Seconde", le: "2026-09-02" } }, "seconde");
  assert.deepEqual(await suiviDe(A), { revue_coeur: "annuelle", seuil_ecart_pts: 5, plafond_satellite_pct: 12, source: "Seconde", le: "2026-09-02" }, "fusion par champ");
  await accepte("config", { suivi: { seuil_ecart_pts: null, revue_coeur: "semestrielle", source: "Troisième" } }, "retrait");
  const s = await suiviDe(A);
  assert.equal("seuil_ecart_pts" in s, false, "null retire le champ");
  assert.equal(s.revue_coeur, "semestrielle");
  assert.equal(s.plafond_satellite_pct, 12, "les autres champs restent");
  assert.equal(s.source, "Troisième");
  // tout ou rien : une bonne et une mauvaise proposition dans le même appel
  const bonne = await proposer("config", { suivi: { mois_revue_coeur: 9, source: SRC } });
  const mauvaise = await proposer("config", { suivi: { seuil_ecart_pts: 99, source: SRC } });
  await assert.rejects(appliquer([bonne, mauvaise]), /seuil_ecart_pts invalide/);
  assert.equal("mois_revue_coeur" in (await suiviDe(A)), false, "la bonne n'a pas été appliquée non plus");
  assert.deepEqual((await q(`select statut from public.propositions where id = any($1::uuid[]) order by statut`, [[bonne, mauvaise]])).map(r => r.statut), ["en_attente", "en_attente"]);
  await q(`delete from public.propositions where id = any($1::uuid[])`, [[bonne, mauvaise]]);
  // la config d'un autre n'est pas touchée
  await superu();
  assert.deepEqual(await suiviDe(B), {}, "B n'a rien reçu");
});
test("config.suivi : une valeur corrigée par l'utilisateur (p_modifications) est contrôlée comme la proposition", async () => {
  await comme(A); await reinitSuivi();
  const id = await proposer("config", { suivi: { seuil_ecart_pts: 5, source: SRC } });
  await assert.rejects(appliquer([id], { [id]: { suivi: { seuil_ecart_pts: 2, source: SRC } } }), /seuil_ecart_pts invalide/);
  assert.equal(await appliquer([id], { [id]: { suivi: { seuil_ecart_pts: 7, source: SRC } } }), 1);
  assert.equal((await suiviDe(A)).seuil_ecart_pts, 7);
});

/* =========================================================================================================== frais_enveloppes : arbitrage_pct et courtage_pct */
const FE = async uid => (await un(`select frais_enveloppes fe from public.config where user_id = '${uid}'`)).fe;
test("frais_enveloppes : arbitrage_pct et courtage_pct (0 à 5) acceptés comme gestion_uc_pct, gestion_euro_pct et garde_pct", async () => {
  await comme(A);
  await db.exec(`update public.config set frais_enveloppes = '{}'::jsonb`);
  for (const c of ["arbitrage_pct", "courtage_pct"]) {
    for (const v of [0, 5, 0.65, "1", 0.1]) {
      await accepte("config", { frais_enveloppes: { PEA: { [c]: v, source: "Grille tarifaire consultée", le: "2026-10-01" } } }, c + " = " + v);
      assert.equal((await FE(A)).PEA[c], +v);
    }
    for (const v of [-0.01, 5.01, 6, -1, "abc", "", true, [1]])
      await refusee("config", { frais_enveloppes: { PEA: { [c]: v, source: "Grille" } } }, new RegExp(`frais_enveloppes « PEA » : ${c} invalide \\(pourcentage par an entre 0 et 5 attendu\\)`), c + " = " + JSON.stringify(v));
  }
  await accepte("config", { frais_enveloppes: { "Assurance-vie": { gestion_uc_pct: 0.8, gestion_euro_pct: 0.6, garde_pct: 0.1, arbitrage_pct: 0.5, courtage_pct: 0.2, source: "Notice", le: "2026-10-01" } } }, "les cinq ensemble");
  assert.deepEqual((await FE(A))["Assurance-vie"], { gestion_uc_pct: 0.8, gestion_euro_pct: 0.6, garde_pct: 0.1, arbitrage_pct: 0.5, courtage_pct: 0.2, source: "Notice", le: "2026-10-01" });
  await accepte("config", { frais_enveloppes: { PEA: { garde_pct: 0.2, source: "Notice", le: "2026-10-01" } } }, "ancien format toujours accepté");
  assert.deepEqual(await FE(A).then(f => f.PEA), { garde_pct: 0.2, source: "Notice", le: "2026-10-01" }, "une enveloppe fournie remplace l'existante en entier");
  await refusee("config", { frais_enveloppes: { PEA: { frais: 1, source: "Notice" } } }, /champ « frais » inconnu \(gestion_uc_pct, gestion_euro_pct, garde_pct, arbitrage_pct, courtage_pct, source, le\)/, "champ inconnu : la liste cite les nouveaux champs");
  await refusee("config", { frais_enveloppes: { PEA: { source: "Notice" } } }, /au moins un pourcentage attendu \(gestion_uc_pct, gestion_euro_pct, garde_pct, arbitrage_pct ou courtage_pct\)/, "aucun pourcentage");
  await refusee("config", { frais_enveloppes: { PEA: { courtage_pct: 0.3 } } }, /source obligatoire/, "source obligatoire");
  await refusee("config", { frais_enveloppes: { PEA: { courtage_pct: 0.3, source: "x", le: "2999-01-01" } } }, /date \(le\) dans le futur/, "date du futur toujours refusée");
  await db.exec(`update public.config set frais_enveloppes = '{}'::jsonb`);
});

/* =========================================================================================================== double authentification */
test("pg_policies : positions, config et routines gardent leur politique RESTRICTIVE « aal2 si facteur » (0028) et leurs politiques de propriétaire", async () => {
  await superu();
  for (const t of ["positions", "config", "routines"]) {
    const r = await q(`select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = $1 and permissive = 'RESTRICTIVE'`, [t]);
    assert.equal(r.length, 1, t);
    assert.equal(r[0].policyname, t + ": aal2 si facteur");
    for (const e of [r[0].qual, r[0].with_check]) { assert.match(e, /aal2/, t); assert.match(e, /mfa_exigee/, t); }
    const p = await q(`select cmd from pg_policies where schemaname = 'public' and tablename = $1 and permissive = 'PERMISSIVE' order by cmd`, [t]);
    assert.deepEqual(p.map(x => x.cmd), ["DELETE", "INSERT", "SELECT", "UPDATE"], t + " : politiques de propriétaire");
    assert.equal((await un(`select relrowsecurity r from pg_class where oid = ('public.' || $1)::regclass`, [t])).r, true, t + " : RLS activée");
  }
});
test("double authentification : A (facteur vérifié) en aal1 ne lit ni n'écrit role, role_source, config.suivi ni routines.etat_suivi ; en aal2 il les lit ; B (sans facteur) les lit en aal1", async () => {
  await superu();
  await db.exec(`insert into public.positions (user_id, name, role, role_source) values ('${A}', 'Ligne MFA A', 'coeur', 'valide'), ('${B}', 'Ligne MFA B', 'satellite', 'propose')`);
  await db.exec(`update public.config set suivi = '{"revue_coeur":"annuelle","source":"s"}'::jsonb where user_id in ('${A}', '${B}')`);
  await db.exec(`insert into public.routines (user_id, type, etat_suivi) values ('${A}', 'revue_mensuelle', '{"meteo":{"x":"ok"}}'::jsonb), ('${B}', 'revue_mensuelle', '{"meteo":{"y":"ok"}}'::jsonb)`);
  // A en aal1 : rien de lisible
  await comme(A, "aal1");
  assert.equal((await q(`select role, role_source from public.positions`)).length, 0, "positions illisibles en aal1");
  assert.equal((await q(`select suivi from public.config`)).length, 0, "config illisible en aal1");
  assert.equal((await q(`select etat_suivi from public.routines`)).length, 0, "routines illisible en aal1");
  assert.equal((await q(`select public.export_all() e`))[0].e.positions.length, 0);
  // ... ni écrivable
  assert.equal((await db.query(`update public.positions set role = 'reserve', role_source = 'propose' where user_id = '${A}'`)).affectedRows, 0);
  assert.equal((await db.query(`update public.config set suivi = '{}'::jsonb where user_id = '${A}'`)).affectedRows, 0);
  assert.equal((await db.query(`update public.routines set etat_suivi = '{}'::jsonb where user_id = '${A}'`)).affectedRows, 0);
  await refuse(`insert into public.positions (user_id, name, role) values ('${A}', 'Nouvelle ligne aal1', 'coeur')`, /row-level security/, "insertion refusée en aal1");
  await refuse(`insert into public.routines (user_id, type, etat_suivi) values ('${A}', 'revue_mensuelle', '{}'::jsonb)`, /row-level security|duplicate key/, "insertion de routine refusée en aal1");
  assert.equal((await db.query(`delete from public.positions where user_id = '${A}'`)).affectedRows, 0);
  // les RPC ne contournent pas : propositions invisibles (0 appliquée), clôture de routine sans effet sur la ligne cachée
  await superu();
  const idp = (await q(`insert into public.propositions (user_id, cible, operation, apres, source) values ('${A}', 'config', 'modifier', '{"suivi":{"revue_coeur":"semestrielle","source":"s"}}', 'x') returning id`))[0].id;
  await comme(A, "aal1");
  assert.equal(await appliquer([idp]), 0, "aal1 : la proposition n'est pas visible, donc rien n'est appliqué");
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', 'Synthèse fictive', '[]'::jsonb, '{"a":1}'::jsonb)`, /row-level security|violates|duplicate/i, "cloturer_routine refusée en aal1");
  await superu();
  assert.equal((await suiviDe(A)).revue_coeur, "annuelle", "rien n'a changé");
  assert.deepEqual(await un(`select etat_suivi from public.routines where user_id = '${A}'`), { etat_suivi: { meteo: { x: "ok" } } });
  await q(`delete from public.propositions where id = '${idp}'`);
  // A en aal2 : lit tout, seulement le sien
  await comme(A, "aal2");
  assert.deepEqual(await q(`select name, role, role_source from public.positions`), [{ name: "Ligne MFA A", role: "coeur", role_source: "valide" }]);
  assert.deepEqual((await q(`select suivi from public.config`)).map(r => r.suivi.revue_coeur), ["annuelle"]);
  assert.deepEqual((await q(`select etat_suivi from public.routines`)).map(r => r.etat_suivi), [{ meteo: { x: "ok" } }]);
  // B (aucun facteur) : aal1 suffit, et il ne voit que le sien
  await comme(B, "aal1");
  assert.deepEqual(await q(`select name, role, role_source from public.positions`), [{ name: "Ligne MFA B", role: "satellite", role_source: "propose" }]);
  assert.deepEqual((await q(`select etat_suivi from public.routines`)).map(r => r.etat_suivi), [{ meteo: { y: "ok" } }]);
  await superu();
  await db.exec(`delete from public.positions where name like 'Ligne MFA %'; delete from public.routines; update public.config set suivi = '{}'::jsonb`);
});

/* =========================================================================================================== cloturer_routine */
const cloturer = (args) => q(`select (public.cloturer_routine(${args})).* `);
const ROUT = async uid => await un(`select etat_suivi, synthese, questions, active from public.routines where user_id = '${uid}' and type = 'revue_mensuelle'`);
test("cloturer_routine : une seule fonction (cinq arguments, le dernier optionnel), droits comme avant (authenticated seulement)", async () => {
  await superu();
  const f = await q(`select pg_get_function_identity_arguments(p.oid) a, pg_get_function_arguments(p.oid) ad, prosecdef sd from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'cloturer_routine'`);
  assert.equal(f.length, 1, "l'ancienne signature à quatre arguments est remplacée");
  assert.equal(f[0].a, "p_type text, p_client text, p_synthese text, p_questions jsonb, p_etat_suivi jsonb");
  assert.match(f[0].ad, /p_etat_suivi jsonb DEFAULT NULL::jsonb$/);
  assert.equal(f[0].sd, false, "security invoker");
  assert.equal((await un(`select has_function_privilege('authenticated', 'public.cloturer_routine(text,text,text,jsonb,jsonb)', 'execute') a`)).a, true);
  assert.equal((await un(`select has_function_privilege('anon', 'public.cloturer_routine(text,text,text,jsonb,jsonb)', 'execute') n`)).n, false);
});
test("cloturer_routine : sans état du suivi (appel à quatre arguments, positionnel puis nommé), l'état reste vide ; fourni, il est écrit ; omis ensuite, il est conservé", async () => {
  await comme(A);
  const r1 = (await cloturer(`'revue_mensuelle', 'Claude', 'Première synthèse fictive', '[]'::jsonb`))[0];
  assert.equal(r1.etat_suivi, null, "ancien appel : aucun état");
  assert.equal(r1.synthese, "Première synthèse fictive");
  const etat = { vus: ["ecart_classe"], constats: { ligne1: "cout" }, meteo: { ligne1: "vigilance" }, le: "2026-10-15" };
  const r2 = (await cloturer(`'revue_mensuelle', 'Claude', 'Seconde synthèse fictive', '[]'::jsonb, '${JSON.stringify(etat)}'::jsonb`))[0];
  assert.deepEqual(r2.etat_suivi, etat, "état écrit");
  const r3 = (await cloturer(`'revue_mensuelle', 'Claude', 'Troisième synthèse fictive', '[]'::jsonb`))[0];
  assert.deepEqual(r3.etat_suivi, etat, "état conservé quand il est omis");
  assert.equal(r3.synthese, "Troisième synthèse fictive");
  const r4 = (await cloturer(`p_type => 'revue_mensuelle', p_client => 'Claude', p_synthese => 'Quatrième synthèse fictive', p_questions => '[]'::jsonb`))[0];
  assert.deepEqual(r4.etat_suivi, etat, "appel nommé à quatre arguments : conservé");
  const r5 = (await cloturer(`'revue_mensuelle', 'Claude', 'Cinquième synthèse fictive', '[]'::jsonb, null`))[0];
  assert.deepEqual(r5.etat_suivi, etat, "null explicite : conservé");
  const r6 = (await cloturer(`'revue_mensuelle', 'Claude', 'Sixième synthèse fictive', '[]'::jsonb, 'null'::jsonb`))[0];
  assert.deepEqual(r6.etat_suivi, etat, "JSON null : conservé");
  const etat2 = { vus: [], meteo: {} };
  const r7 = (await cloturer(`p_type => 'revue_mensuelle', p_client => 'Claude', p_synthese => 'Septième synthèse fictive', p_questions => '[]'::jsonb, p_etat_suivi => '${JSON.stringify(etat2)}'::jsonb`))[0];
  assert.deepEqual(r7.etat_suivi, etat2, "appel nommé à cinq arguments : remplacé en entier");
  const r8 = (await cloturer(`'revue_mensuelle', 'Claude', 'Huitième synthèse fictive', '[]'::jsonb, '{}'::jsonb`))[0];
  assert.deepEqual(r8.etat_suivi, {}, "objet vide : remet à zéro");
  assert.deepEqual((await ROUT(A)).etat_suivi, {});
  await q(`delete from public.routines where user_id = '${A}'`);
});
test("cloturer_routine : état du suivi refusé s'il n'est pas un objet ou dépasse 20 000 octets (les 20 000 octets exacts sont acceptés) ; rien n'est modifié", async () => {
  await comme(A);
  await cloturer(`'revue_mensuelle', 'Claude', 'Synthèse de départ fictive', '[]'::jsonb, '{"a":1}'::jsonb`);
  for (const [v, m] of [["[]", "tableau"], ["[1,2]", "tableau"], ["\"texte\"", "texte"], ["12", "nombre"], ["true", "booléen"]])
    await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', 'Autre synthèse fictive', '[]'::jsonb, '${v}'::jsonb)`, /État du suivi invalide : un objet est attendu\./, "forme " + m);
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', 'Autre synthèse fictive', '[]'::jsonb, jsonb_build_object('a', repeat('x', 20001 - octet_length('{"a": ""}'))))`,
    /État du suivi trop long : 20 000 octets au plus\./, "20 001 octets");
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', 'Autre synthèse fictive', '[]'::jsonb, jsonb_build_object('a', repeat('é', 15000)))`,
    /État du suivi trop long/, "des octets, pas des caractères (é = 2 octets)");
  assert.deepEqual(await ROUT(A).then(r => [r.etat_suivi, r.synthese]), [{ a: 1 }, "Synthèse de départ fictive"], "refus : ni l'état ni la synthèse ne changent");
  const r = (await cloturer(`'revue_mensuelle', 'Claude', 'Synthèse limite fictive', '[]'::jsonb, jsonb_build_object('a', repeat('x', 20000 - octet_length('{"a": ""}')))`))[0];
  assert.equal(r.etat_suivi.a.length, 20000 - '{"a": ""}'.length, "20 000 octets écrits");
  assert.equal((await un(`select octet_length(etat_suivi::text) n from public.routines where user_id = '${A}'`)).n, 20000);
  // les contrôles des questions et de la synthèse sont ceux de 0020
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', '   ', '[]'::jsonb, '{}'::jsonb)`, /Synthèse vide ou trop longue/, "synthèse vide");
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', 'ok fictive', '{"a":1}'::jsonb, '{}'::jsonb)`, /Questions invalides/, "questions invalides");
  await refuse(`select public.cloturer_routine('autre', 'Claude', 'ok fictive', '[]'::jsonb, '{}'::jsonb)`, /Type de routine inconnu/, "type inconnu");
  await q(`update public.routines set active = false where user_id = '${A}'`);
  await refuse(`select public.cloturer_routine('revue_mensuelle', 'Claude', 'ok fictive', '[]'::jsonb, '{"a":2}'::jsonb)`, /Revue mensuelle en pause/, "routine en pause");
  await q(`delete from public.routines where user_id = '${A}'`);
});
test("cloturer_routine : crée la routine si elle manque (état écrit), l'état d'un utilisateur n'atteint pas celui d'un autre", async () => {
  await comme(B);
  const r = (await cloturer(`'revue_mensuelle', 'Claude', 'Synthèse de B fictive', '[]'::jsonb, '{"b":1}'::jsonb`))[0];
  assert.equal(r.user_id, B);
  assert.deepEqual(r.etat_suivi, { b: 1 });
  assert.equal(r.consentement_journal, false, "création implicite : sans consentement au journal, comme avant");
  await comme(C);
  const c = (await cloturer(`'revue_mensuelle', 'Claude', 'Synthèse de C fictive', '[]'::jsonb`))[0];
  assert.equal(c.etat_suivi, null);
  await superu();
  assert.deepEqual(await un(`select etat_suivi from public.routines where user_id = '${B}'`), { etat_suivi: { b: 1 } });
  await q(`delete from public.routines`);
});
test("activer_routine (0020) renvoie toujours la ligne, avec la nouvelle colonne", async () => {
  await comme(C);
  const r = (await q(`select (public.activer_routine('revue_mensuelle', 5)).*`))[0];
  assert.equal(r.jour, 5);
  assert.ok("etat_suivi" in r && r.etat_suivi === null);
  await superu(); await q(`delete from public.routines`);
});

/* =========================================================================================================== export_all et suppression du compte */
test("export_all() : sort config.suivi, positions.role / role_source et routines.etat_suivi (les siens seulement)", async () => {
  await superu();
  await q(`insert into public.positions (user_id, name, role, role_source) values ('${A}', 'Export A1', 'coeur', 'valide'), ('${A}', 'Export A2', null, null), ('${B}', 'Export B1', 'reserve', 'propose')`);
  await q(`update public.config set suivi = '{"revue_coeur":"semestrielle","semaine":{"actif":true,"jour":"lundi"},"source":"s","le":"2026-10-01"}'::jsonb where user_id = '${A}'`);
  await q(`insert into public.routines (user_id, type, etat_suivi) values ('${A}', 'revue_mensuelle', '{"vus":["x"]}'::jsonb)`);
  await comme(A);
  const e = (await q(`select public.export_all() e`))[0].e;
  assert.deepEqual(e.positions.map(p => [p.name, p.role, p.role_source]).sort(), [["Export A1", "coeur", "valide"], ["Export A2", null, null]]);
  assert.equal(e.config.length, 1);
  assert.deepEqual(e.config[0].suivi, { revue_coeur: "semestrielle", semaine: { actif: true, jour: "lundi" }, source: "s", le: "2026-10-01" });
  assert.deepEqual(e.routines.map(r => r.etat_suivi), [{ vus: ["x"] }]);
  assert.equal(JSON.stringify(e).includes("Export B1"), false, "rien de B");
  await comme(B);
  const eb = (await q(`select public.export_all() e`))[0].e;
  assert.deepEqual(eb.config[0].suivi, {});
  assert.deepEqual(eb.routines, []);
  assert.deepEqual(eb.positions.map(p => p.role), ["reserve"]);
  await superu(); await db.exec(`delete from public.positions where name like 'Export %'; delete from public.routines; update public.config set suivi = '{}'::jsonb`);
});
test("suppression du compte : delete_me() efface rôles, config.suivi et état du suivi (cascade sur auth.users) ; les autres comptes restent", async () => {
  await superu();
  const D = "44444444-4444-4444-4444-444444444444";
  await db.exec(`insert into auth.users (id) values ('${D}');
    insert into public.config (user_id, suivi) values ('${D}', '{"revue_coeur":"annuelle","source":"s"}'::jsonb) on conflict (user_id) do update set suivi = excluded.suivi;
    insert into public.positions (user_id, name, role, role_source) values ('${D}', 'À effacer', 'satellite', 'valide'), ('${B}', 'À garder', 'coeur', 'valide');
    insert into public.routines (user_id, type, etat_suivi) values ('${D}', 'revue_mensuelle', '{"a":1}'::jsonb), ('${B}', 'revue_mensuelle', '{"b":1}'::jsonb);`);
  await comme(D);
  await db.exec(`select public.delete_me()`);
  await superu();
  for (const t of ["positions", "config", "routines"]) assert.equal((await q(`select 1 from public.${t} where user_id = '${D}'`)).length, 0, t + " : effacé");
  assert.equal((await q(`select 1 from auth.users where id = '${D}'`)).length, 0);
  assert.equal((await q(`select 1 from public.positions where user_id = '${B}' and role = 'coeur'`)).length, 1, "B garde sa ligne");
  assert.equal((await q(`select 1 from public.routines where user_id = '${B}'`)).length, 1, "B garde sa routine");
  await db.exec(`delete from public.positions where user_id = '${B}'; delete from public.routines`);
});

/* =========================================================================================================== repères et fiches */
test("fixture : 46 repères dont 11 repris ; 35 nouveaux", () => {
  assert.equal(FIXTURE.reperes.length, 46);
  assert.equal(REPRISES.length, 11);
  assert.equal(NOUVEAUX.length, 35);
  assert.equal(FIXTURE.fiches.length, 6);
});
test("repères : les 35 nouveaux sont en base à l'identique de la fixture (clé, libellé, valeur, unité, dates, source) ; rien d'autre n'a été ajouté", async () => {
  await superu();
  assert.equal((await un(`select count(*)::int n from public.reperes`)).n, AVANT.n + 35);
  for (const r of NOUVEAUX) {
    const l = await un(`select cle, libelle, valeur::float8 valeur, unite, date_effet::text date_effet, date_fin::text date_fin, source_titre, source_url, verifie_le::text verifie_le, mode from public.reperes where cle = $1`, [r.cle]);
    assert.ok(l, "repère manquant : " + r.cle);
    assert.deepEqual(l, { cle: r.cle, libelle: r.libelle, valeur: r.valeur, unite: r.unite, date_effet: r.dateEffet, date_fin: r.dateFin, source_titre: r.sourceTitre, source_url: r.sourceUrl, verifie_le: r.verifieLe, mode: "manuel" }, r.cle);
    assert.equal(AVANT.reperes[r.cle], undefined, r.cle + " : n'existait pas avant 0032");
  }
  const nouvelles = (await q(`select cle from public.reperes order by cle`)).map(r => r.cle).filter(c => !(c in AVANT.reperes));
  assert.deepEqual(nouvelles, NOUVEAUX.map(r => r.cle).sort());
});
test("repères : les 11 repères « reprise » existaient déjà, ne sont pas dupliqués ni modifiés, et 0032 ne les réinsère pas", async () => {
  await superu();
  for (const c of REPRISES) {
    assert.ok(AVANT.reperes[c], c + " : déjà en base avant 0032");
    const l = await q(`select * from public.reperes where cle = $1`, [c]);
    assert.equal(l.length, 1, c + " : une seule ligne");
    assert.deepEqual(l[0], AVANT.reperes[c], c + " : inchangé");
    assert.equal(SQL.includes(`('${c}'`), false, c + " : absent de 0032");
  }
});
test("repères : colonnes et forme de l'insert identiques à 0030 ; libellé jusqu'à 200 caractères ; unités déjà permises ; source en https", async () => {
  const m = /insert into public\.reperes \(([^)]*)\) values/.exec(SQL);
  assert.deepEqual(m[1].split(",").map(s => s.trim()), ["cle", "libelle", "valeur", "unite", "date_effet", "date_fin", "source_titre", "source_url", "verifie_le"]);
  assert.match(SQL, /on conflict \(cle\) do update set libelle = excluded\.libelle, valeur = excluded\.valeur, unite = excluded\.unite, date_effet = excluded\.date_effet,\n\s+date_fin = excluded\.date_fin, source_titre = excluded\.source_titre, source_url = excluded\.source_url, verifie_le = excluded\.verifie_le;/);
  assert.ok(NOUVEAUX.some(r => r.libelle.length > 120), "au moins un libellé dépasse l'ancienne limite de 120");
  await superu();
  await refuse(`insert into public.reperes (cle, libelle, valeur, unite, date_effet, source_titre, source_url, verifie_le) values ('essai_long', '${"x".repeat(201)}', 1, '%', '2026-10-15', 's', 'https://x', '2026-10-15')`, /reperes_libelle_check/, "201 caractères");
  await q(`insert into public.reperes (cle, libelle, valeur, unite, date_effet, source_titre, source_url, verifie_le) values ('essai_long', '${"x".repeat(200)}', 1, '%', '2026-10-15', 's', 'https://x', '2026-10-15')`);
  await q(`delete from public.reperes where cle = 'essai_long'`);
  for (const r of NOUVEAUX) assert.match(r.sourceUrl, /^https:\/\//, r.cle);
});
test("fiches : les 6 fiches (thème comportement) sont en base à l'identique de la fixture, version 1, publiées, trouvables par la recherche", async () => {
  await superu();
  assert.equal((await un(`select count(*)::int n from public.savoir_fiches`)).n, AVANT.fiches + 6);
  for (const f of FIXTURE.fiches) {
    const l = await un(`select slug, theme, titre, resume, contenu, mots_cles, sources, mis_a_jour_le::text mis_a_jour_le, version, statut from public.savoir_fiches where slug = $1`, [f.slug]);
    assert.ok(l, "fiche manquante : " + f.slug);
    assert.deepEqual(l, { slug: f.slug, theme: "comportement", titre: f.titre, resume: f.resume, contenu: f.contenu, mots_cles: f.mots_cles, sources: f.sources, mis_a_jour_le: f.mis_a_jour_le, version: 1, statut: "publie" }, f.slug);
  }
  const r = await q(`select slug from public.chercher_savoir('cœur et satellite', 'comportement', 5)`);
  assert.ok(r.some(x => x.slug === "coeur-et-satellite"), "la recherche trouve la fiche : " + r.map(x => x.slug));
  assert.doesNotMatch(SQL.slice(SQL.indexOf("insert into public.savoir_fiches")), /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu, "fiches au tutoiement");
});

/* =========================================================================================================== idempotence */
test("0032 rejouée : rien ne change (repères, fiches, versions des fiches et des expertises, historique)", async () => {
  await superu();
  const etat = async () => ({
    reperes: await q(`select * from public.reperes order by cle`),
    fiches: await q(`select slug, version, contenu, titre, resume, sources, mis_a_jour_le from public.savoir_fiches order by slug`),
    expertises: await q(`select slug, version, mis_a_jour_le::text d, changelog, methode, garde_fous, controles, evals from public.expertises order by slug`),
    hist: await q(`select slug, version, statut from public.expertises_versions order by slug, version, statut`),
    fonctions: await q(`select proname, pg_get_function_identity_arguments(oid) a from pg_proc where pronamespace = 'public'::regnamespace and proname in ('cloturer_routine', 'appliquer_propositions', 'expertises_reformuler') order by 1, 2`),
  });
  const avant = await etat();
  await db.exec(SQL);
  assert.deepEqual(await etat(), avant);
  assert.deepEqual(avant.fonctions.map(f => f.proname), ["appliquer_propositions", "cloturer_routine"], "expertises_reformuler est retirée en fin de migration");
});

/* =========================================================================================================== expertises */
const TEXTES = ["nom", "quand_consulter", "perimetre", "methode", "garde_fous", "format"];
test("expertises : les 8 passent à la version 2 (journal et historique), slugs inchangés, plus aucun « Copilote » ni « conseiller » dans leurs textes, contrôles et cas d'évaluation", async () => {
  await superu();
  const xs = await q(`select slug, version, statut, mis_a_jour_le::text d, changelog, nom, quand_consulter, perimetre, methode, garde_fous, format, controles, evals, themes_savoir, reperes, angles, marches from public.expertises order by slug`);
  assert.deepEqual(xs.map(x => x.slug), AVANT.expertises.map(x => x.slug), "mêmes slugs");
  assert.equal(AVANT.expertises.every(x => x.version === 1 && x.d === "2026-10-11" && x.nj === 1), true, "avant : version 1");
  for (const x of xs) {
    assert.equal(x.version, 2, x.slug);
    assert.equal(x.statut, "publie");
    assert.equal(x.d, "2026-10-15");
    assert.deepEqual(x.changelog.map(c => c.version), [1, 2]);
    assert.equal(x.changelog[1].le, "2026-10-15");
    assert.match(x.changelog[1].resume, /^Reformulation : /);
    assert.doesNotMatch(x.changelog[1].resume, /Copilote|conseiller/i);
    const tout = [...TEXTES.map(c => x[c]), JSON.stringify(x.controles), JSON.stringify(x.evals), x.changelog.map(c => c.resume).join(" ")].join("\n");
    assert.doesNotMatch(tout, /Copilote/i, x.slug);
    assert.doesNotMatch(tout, /conseiller/i, x.slug);
  }
  const h = await q(`select slug, version, statut, resume from public.expertises_versions order by slug, version`);
  assert.equal(h.length, 16, "une copie par version : v1 et v2 de chacune des 8");
  assert.deepEqual([...new Set(h.map(x => x.version))], [1, 2]);
  assert.match(h.find(x => x.slug === "crypto" && x.version === 2).resume, /^Reformulation : /);
  const v1 = await q(`select garde_fous from public.expertises_versions where version = 1`);
  assert.ok(v1.every(x => /Copilote patrimonial/.test(x.garde_fous)), "la version 1 garde son texte d'origine dans l'historique");
  // le sens est conservé : les points forts du garde-fou sont encore là
  for (const x of xs) {
    assert.match(x.garde_fous, /Tu es Claude, appuyé sur les expertises de Boussole, et non un professionnel du conseil réglementé : tu expliques, tu compares et tu montres les risques ; la décision revient toujours à l'utilisateur\./, x.slug);
    assert.match(x.garde_fous, /renvoie l'utilisateur vers un professionnel réglementé : cabinet de conseil en investissements financiers inscrit à l'ORIAS, notaire, avocat fiscaliste ou expert-comptable/, x.slug);
  }
  const fisc = xs.find(x => x.slug === "fiscalite-enveloppes");
  assert.match(fisc.perimetre, /\(notaire, avocat fiscaliste, professionnel réglementé du conseil\)/);
  assert.ok(xs.find(x => x.slug === "budget-epargne").evals.some(e => e.interdit.includes("Recommander un placement précis")));
  assert.ok(xs.find(x => x.slug === "allocation-risque").evals.some(e => (e.interdit || []).includes("Recommander d'attendre un meilleur moment de marché")));
});
test("expertises : la base (0017 puis 0032) et scripts/gen-expertises-demo.mjs donnent exactement les mêmes textes, versions, dates et journaux", async () => {
  await superu();
  const base = await q(`select slug, nom, quand_consulter, perimetre, methode, controles, garde_fous, format, evals, version, mis_a_jour_le::text mis_a_jour_le, changelog from public.expertises order by slug`);
  const js = lireExpertisesAJour(SQL_0017, SQL).sort((a, b) => (a.slug < b.slug ? -1 : 1));
  assert.equal(js.length, 8);
  for (const [i, x] of base.entries()) {
    for (const c of ["slug", "nom", "quand_consulter", "perimetre", "methode", "controles", "garde_fous", "format", "evals", "version", "mis_a_jour_le", "changelog"])
      assert.deepEqual(x[c], js[i][c], x.slug + " : " + c);
  }
});
test("gen-expertises-demo : lireReformulation lit les cinq paires dans l'ordre, la date et le résumé du journal ; appliquerReformulation reproduit replace() de la base", () => {
  const maj = lireReformulation(SQL);
  assert.equal(maj.paires.length, 5);
  assert.deepEqual(maj.paires[0], ["Tu es le Copilote patrimonial de Boussole, pas un conseiller en investissement :", "Tu es Claude, appuyé sur les expertises de Boussole, et non un professionnel du conseil réglementé :"]);
  assert.deepEqual(maj.paires[4], ["Conseiller un placement précis", "Recommander un placement précis"]);
  assert.equal(maj.le, "2026-10-15");
  assert.match(maj.resume, /^Reformulation : /);
  const x = { slug: "x", nom: "N", quand_consulter: "q", perimetre: "p", methode: "m", controles: ["un conseiller réglementé"], garde_fous: "- Tu es le Copilote patrimonial de Boussole, pas un conseiller en investissement : fin", format: "f", evals: [], version: 1, mis_a_jour_le: "2026-10-11", changelog: [{ version: 1, le: "2026-10-11", resume: "r" }] };
  const [y] = appliquerReformulation([x], maj);
  assert.equal(y.garde_fous, "- Tu es Claude, appuyé sur les expertises de Boussole, et non un professionnel du conseil réglementé : fin");
  assert.deepEqual(y.controles, ["un professionnel réglementé du conseil"]);
  assert.deepEqual([y.version, y.mis_a_jour_le, y.changelog.length], [2, "2026-10-15", 2]);
  const intact = { ...x, controles: ["rien"], garde_fous: "rien" };
  assert.deepEqual(appliquerReformulation([intact], maj), [intact], "une expertise sans texte concerné n'est pas touchée (ni version ni journal)");
  assert.throws(() => lireReformulation("-- rien"), /marqueurs @expertises-reformulation introuvables/);
  assert.throws(() => lireReformulation("-- @expertises-reformulation — début\n-- @expertises-reformulation — fin"), /paires de reformulation illisibles/);
  assert.throws(() => lireReformulation(SQL.replace("-- @expertises-journal", "-- autre")), /entrée de journal/);
  assert.throws(() => lireReformulation(SQL.replace("$n$Tu es Claude,", '$n$Tu es "Claude",')), /guillemet/);
  assert.equal(SOURCE_MAJ, "supabase/migrations/0032_suivi.sql");
});
test("gen-expertises-demo : le bloc généré ne contient ni « Copilote » ni « conseiller » (hors cas d'évaluation, jamais repris)", () => {
  const b = bloc(SQL_0017, SQL);
  assert.doesNotMatch(b, /Copilote|conseiller/i);
  assert.equal(lireExpertises(SQL_0017).length, 8, "0017 est lue telle quelle");
  assert.match(b, /version: 2, misAJourLe: "2026-10-15"/);
});
