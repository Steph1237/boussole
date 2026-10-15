// HIS2 : import de l'historique réel (migration 0034_historique.sql), exercé sur un vrai PostgreSQL (PGlite) : toutes les migrations
// appliquées sur les bouchons Supabase (test/helpers/pglite.mjs). auth.jwt() est simulé : test.aal, test.client_id et test.session_id.
// Couvre la spec § 12.2 : contraintes de chaque table, écriture seulement par appliquer_propositions (cible historique), empreinte
// unique, remplacement des mois, on conflict do nothing sur cle_import, lignes clôturées créées, doublon_de posé et levé par le retrait,
// retirer_import qui exige aal2, régime bancaire et régime « si facteur », export_all, suppression du compte, photos non écrivables par
// authenticated. Données fictives uniquement (cas B1, B1-remp, P1, P2, A1, D1 de test/fixtures/his2-cas.json ; ISIN de
// test/helpers/isin-fictif.mjs). Les relevés sont importés avec leurs catégories larges (avant BUD1 : sous_categorie vide).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { baseComplete } from "./helpers/pglite.mjs";
import { isinFictif, isinFictifFaux, isinValide } from "./helpers/isin-fictif.mjs";

const DIR = new URL("../supabase/migrations/", import.meta.url);
const FICHIER = readdirSync(DIR).find(f => /^0034_.*\.sql$/.test(f));
const SQL = FICHIER ? readFileSync(new URL(FICHIER, DIR), "utf8") : "";
const CAS = JSON.parse(readFileSync(new URL("./fixtures/his2-cas.json", import.meta.url), "utf8"));
const cas = id => CAS.cas.find(c => c.id === id);
const GRAND = CAS.categories_utilisees.large;
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", C = "33333333-3333-3333-3333-333333333333",
  D = "44444444-4444-4444-4444-444444444444";
const CLIENT = "aaaaaaaa-0000-4000-8000-000000000001", SESSION = "bbbbbbbb-0000-4000-8000-000000000001";
const ETF_A = isinFictif(1), ETF_C = isinFictif(3), ETF_D = isinFictif(4);
const TABLES_BANCAIRES = ["historique_comptes", "historique_imports", "historique_releves", "historique_banque_mois"];
const TABLES = [...TABLES_BANCAIRES, "photos_reconstituees"];
const paris = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const MOIS_COURANT = paris().slice(0, 7);
const decaler = (mois, n) => { const [y, m] = mois.split("-").map(Number); const t = y * 12 + m - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };

let db, compteur = 0;
const q = async (s, p) => (await db.query(s, p)).rows;
const un = async (s, p) => (await q(s, p))[0];
const refuse = async (s, motif, m, p) => {
  await assert.rejects(db.query(s, p), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
};

/** Superutilisateur (préparation, vérifications). */
const superu = () => db.exec(`reset role; set test.uid = ''; set test.aal = 'aal2'; set test.client_id = ''; set test.session_id = '';`);
/** Session simulée : role authenticated, utilisateur, niveau d'assurance ; jeton OAuth si client et session sont donnés. */
async function session(uid, aal = "aal2", { client = "", sess = "" } = {}) {
  await db.exec(`reset role; set test.uid = '${uid}'; set test.aal = '${aal}'; set test.client_id = '${client}'; set test.session_id = '${sess}'; set role authenticated;`);
}
const service = () => db.exec(`reset role; set test.uid = ''; set test.aal = 'aucun'; set test.client_id = ''; set test.session_id = ''; set role service_role;`);

const hex = n => randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
const nouvelle = () => ({ ref: randomUUID(), empreinte: hex(64) });

/** Catégories larges d'un mois de la fixture (sous-catégories de BUD1 agrégées : avant BUD1, sous_categorie vide). */
function moisLarges(m) {
  const par = new Map();
  for (const l of m.sous_categories) {
    const g = GRAND[l.cle];
    const x = par.get(g) ?? { categorie: g, sous_categorie: "", entrees: 0, sorties: 0, nombre: 0 };
    x.entrees += l.entrees; x.sorties += l.sorties; x.nombre += l.nombre;
    par.set(g, x);
  }
  return { mois: m.mois, complet: m.complet, controle: m.controle, categories: [...par.values()] };
}
const moisDe = (id, ...liste) => cas(id).entree.mois.filter(m => !liste.length || liste.includes(m.mois)).map(moisLarges);
const COMPTE_B1 = { libelle: "Compte courant Exemple", type: "courant", titulaire: "p1", cle: "boursobank|courant|compte courant exemple|p1" };
const FICHIER_CSV = { format: "csv", nom: "export-compte-courant.csv", lignes: 120, octets: 5400, periode: { du: "2024-01-01", au: "2024-03-28" } };

/** apres d'un import de relevés. */
const apresReleves = (mois, { compte = COMPTE_B1, etablissement = "boursobank", empreinte, periode = { du: "2024-01-01", au: "2024-03-28" }, extra = {} } = {}) => ({
  type: "releves", empreinte: empreinte ?? hex(64), fichier: FICHIER_CSV, etablissement, compte, periode, donnees: { mois }, resume: { mois: mois.length }, avertissements: [], ...extra,
});
/** Mouvement avec une clé d'import unique. */
const mv = o => ({ cle_import: hex(32), ...o });
const achat = (date, qty, price, frais, o = {}) => mv({ date, type: "achat", qty, price, frais, amount: Math.round(qty * price * 100) / 100, ...o });
const vente = (date, qty, price, frais, o = {}) => mv({ date, type: "vente", qty, price, frais, amount: Math.round(qty * price * 100) / 100, ...o });
/** apres d'un import d'ordres ou de versements. */
const apresMouvements = (type, mouvements, { enveloppe = "PEA Exemple", etablissement = "boursobank", extra = {} } = {}) => {
  const dates = mouvements.map(m => m.date).sort();
  return {
    type, empreinte: hex(64), fichier: { format: type === "ordres" ? "pdf" : "xlsx", nom: "avis-operes.pdf" }, etablissement, enveloppe,
    periode: { du: dates[0], au: dates[dates.length - 1] }, donnees: { mouvements }, resume: {}, avertissements: [], ...extra,
  };
};

/** Appel direct de la fonction d'import (comme l'app en aal2) : renvoie le résultat ou lève l'erreur. */
async function importer(apres, { ref = randomUUID(), source = "Export déposé dans la conversation le 16/10/2026" } = {}) {
  return (await un(`select public.historique_appliquer($1, $2::jsonb, $3) r`, [ref, JSON.stringify(apres), source])).r;
}
const echoue = (apres, motif, m, o) => assert.rejects(importer(apres, o), e => { assert.match(e.message, motif, m + " : " + e.message); return true; }, m + " : accepté");
/** Dépose puis valide une proposition d'import (chemin réel de l'app). */
async function valider(apres, { ref = randomUUID(), operation = "creer", mods = {} } = {}) {
  const p = (await un(`insert into public.propositions (cible, operation, ref, apres, source) values ('historique', $1, $2, $3::jsonb, $4) returning id`,
    [operation, ref, apres ? JSON.stringify(apres) : null, "Export déposé dans la conversation le 16/10/2026"])).id;
  const n = (await un(`select public.appliquer_propositions($1::uuid[], $2::jsonb) n`, [[p], JSON.stringify(mods)])).n;
  return { ref, p, n };
}
/** Ligne du bilan de A (créée en superutilisateur), puis retour en session A aal2. */
async function ligne(nom, { isin = null, envelope = "PEA Exemple", mode = isin ? "market" : "manual", qty = null, value = null } = {}) {
  await superu();
  if (isin) await db.exec(`insert into public.instruments (isin, name) values ('${isin}', 'Instrument fictif') on conflict (isin) do nothing`);
  const r = await un(`insert into public.positions (user_id, name, envelope, owner, bloc, mode, isin, qty, value) values ('${A}', $1, $2, 'p1', 'Monde', $3, $4, $5, $6) returning id`,
    [nom + " #" + (++compteur), envelope, mode, isin, qty, value]);
  await session(A);
  return r.id;
}
const nbTx = async imp => (await un(`select count(*)::int n from public.transactions where import_id = $1`, [imp])).n;

before(async () => {
  db = await baseComplete();
  await db.exec(`
    insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}'), ('${D}');
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
    -- A, B et D : facteur vérifié (créé la veille) ; C : aucun facteur
    insert into auth.mfa_factors (user_id, status, created_at) values ('${A}', 'verified', now() - interval '1 day'), ('${B}', 'verified', now() - interval '1 day'),
      ('${D}', 'verified', now() - interval '1 day');
    -- première photo observée de A : les photos reconstituées doivent lui être antérieures
    insert into public.snapshots (user_id, date, total, p1, p2) values ('${A}', '2025-01-31', 1000, 1000, 0);
    -- autorisation de connecteur de A (liée à une session OAuth), comme 0033
    insert into auth.sessions (id, user_id, oauth_client_id) values ('${SESSION}', '${A}', '${CLIENT}');
    insert into auth.oauth_clients (id, client_name, registration_type) values ('${CLIENT}', 'Claude', 'manual');
    insert into public.connecteurs_autorises (user_id, client_id, client_nom, autorisation_id, autorisation_expire_le, accorde_aal, expire_le, session_id, lie_le)
      values ('${A}', '${CLIENT}', 'Claude', 'auth-test', now() + interval '10 minutes', 'aal2', now() + interval '90 days', '${SESSION}', now());`);
  await session(A);
});
after(async () => { await db.close(); });

/* ------------------------------------------------------------------------------------------------------------- structure */
test("0034 : fichier, en-tête (non appliquée, ordre, nom), tutoiement, sans secret, aucun caractère insécable ni espace typographique", () => {
  assert.ok(FICHIER, "migration 0034 présente");
  assert.equal(FICHIER, "0034_historique.sql");
  assert.match(SQL, /^-- Boussole : import de l'historique réel/);
  assert.match(SQL, /apply_migration \(name = "historique"\)/);
  assert.match(SQL, /après 0033/);
  assert.doesNotMatch(SQL, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.doesNotMatch(SQL, /sb_secret_|eyJhbGci/);
  assert.doesNotMatch(SQL, /\bdrop\s+policy\b/i, "aucune politique existante n'est retirée");
  assert.doesNotMatch(SQL, /[\u00A0\u2000-\u200F\u202F\u2028\u2029\uFEFF\u3000]/u, "aucun U+00A0, U+2000 à U+200F, U+202F ni autre espace typographique");
  assert.doesNotMatch(SQL, /conseiller/i);
});

test("appliquer_propositions : recopie de 0032, avec pour seuls écarts la garde « jamais un connecteur », la déclaration de v_hist, le libellé de v_quoi et la branche historique", () => {
  const corps = t => t.slice(t.indexOf("create or replace function public.appliquer_propositions"), t.indexOf("grant execute on function public.appliquer_propositions"));
  const ancien = corps(readFileSync(new URL("0032_suivi.sql", DIR), "utf8"));
  const nouveau = corps(SQL);
  assert.ok(ancien.length > 50000 && nouveau.length > ancien.length);
  const attendu = ancien
    .replace("  v_suivi  jsonb;\nbegin", "  v_suivi  jsonb;\n  v_hist   jsonb;\nbegin")
    .replace("when 'plan_fige' then 'plan figé' end);", "when 'plan_fige' then 'plan figé' when 'historique' then 'import d''historique' end);")
    .replace("    raise exception 'non authentifié' using errcode = '42501';\n  end if;\n  if jsonb_typeof(v_mods)",
      "    raise exception 'non authentifié' using errcode = '42501';\n  end if;\n" +
      "  -- 0034 : valider est l'acte de l'utilisateur dans l'app, jamais d'un connecteur (jeton OAuth : client_id)\n" +
      "  if nullif(auth.jwt()->>'client_id', '') is not null then\n" +
      "    raise exception 'Un connecteur ne peut pas valider de proposition : l''utilisateur valide dans Boussole › Agent › À valider.' using errcode = '42501';\n" +
      "  end if;\n  if jsonb_typeof(v_mods)");
  const i = nouveau.indexOf("      /* ---------- historique (0034)");
  const j = nouveau.indexOf("      end case;\n    exception");
  assert.ok(i > 0 && j > i, "la branche historique est insérée avant la fin du case");
  assert.equal(nouveau.slice(0, i) + nouveau.slice(j), attendu, "tout le reste de la fonction est identique à 0032");
});

/* ------------------------------------------------------------------------------------------------------------- fonctions pures */
test("categorie_budget_valide : les 12 catégories larges ; sous_categorie_budget_valide : la sous-catégorie vide seulement (0035 de BUD1 la redéfinit)", async () => {
  await superu();
  for (const c of CAS.categories_utilisees.larges_avant_bud1) {
    assert.equal((await un(`select public.categorie_budget_valide($1) v`, [c])).v, true, c);
    assert.equal((await un(`select public.sous_categorie_budget_valide($1, '') v`, [c])).v, true, c + " + vide");
    assert.equal((await un(`select public.sous_categorie_budget_valide($1, 'loyer') v`, [c])).v, false, c + " + loyer");
  }
  assert.equal(CAS.categories_utilisees.larges_avant_bud1.length, 12);
  for (const x of ["", "courses", "Logement", null]) assert.equal((await un(`select public.categorie_budget_valide($1) v`, [x])).v, false, String(x));
  assert.equal((await un(`select public.sous_categorie_budget_valide('inconnue', '') v`)).v, false);
  for (const f of ["categorie_budget_valide", "sous_categorie_budget_valide", "historique_isin_valide"]) {
    const r = await un(`select p.provolatile, pg_get_functiondef(p.oid) def, has_function_privilege('anon', p.oid, 'execute') an from pg_proc p where p.proname = $1`, [f]);
    assert.equal(r.provolatile, "i", f + " immuable"); assert.match(r.def, /set search_path to ''/i); assert.equal(r.an, false, f + " : anon");
  }
});

test("historique_isin_valide : clé de contrôle de l'ISIN (mêmes verdicts que l'utilitaire de test), symboles X-, formats faux", async () => {
  await superu();
  for (const s of [isinFictif(1), isinFictif(2), isinFictif(3, "XS"), isinFictif(4), "FR0010342592", "IE00B4L5Y983"]) {
    assert.equal((await un(`select public.historique_isin_valide($1) v`, [s])).v, isinValide(s), s);
    assert.equal(isinValide(s), true, s);
  }
  for (const s of [isinFictifFaux(1), "FR9990000014", "FR999000001", "fr9990000013", "", "123456789012", "FR99900000133"]) {
    assert.equal((await un(`select public.historique_isin_valide($1) v`, [s])).v, false, s);
  }
  assert.equal((await un(`select public.historique_isin_valide('X-BTC') v`)).v, true);
  assert.equal((await un(`select public.historique_isin_valide('X-') v`)).v, false);
  assert.equal((await un(`select public.historique_isin_valide(null) v`)).v, false);
});

test("historique_texte et historique_nombre : bornes, contenu sensible, suites de chiffres, nombres JSON seulement", async () => {
  await superu();
  const t = (j, max, req, ch) => un(`select public.historique_texte($1::jsonb, 'champ', $2, $3, $4) v`, [JSON.stringify(j), max, req, ch]);
  assert.equal((await t("  PEA Exemple  ", 100, true, 8)).v, "PEA Exemple", "rogné");
  assert.equal((await t(null, 10, false, 0)).v, null);
  assert.equal((await t("   ", 10, false, 0)).v, null);
  await assert.rejects(t(null, 10, true, 0), /champ : texte attendu/);
  await assert.rejects(t(12, 10, false, 0), /texte attendu/);
  await assert.rejects(t("x".repeat(11), 10, false, 0), /10 caractères au plus/);
  await assert.rejects(t("FR7630006000011234567890189", 100, false, 0), /contenu sensible/);
  await assert.rejects(t("mon mot de passe", 100, false, 0), /contenu sensible/);
  await assert.rejects(t("compte 123456", 100, false, 6), /suite de 6 chiffres/);
  assert.equal((await t("compte 12345", 100, false, 6)).v, "compte 12345");
  const n = (j, min, max, req) => un(`select public.historique_nombre($1::jsonb, 'x', $2, $3, $4) v`, [JSON.stringify(j), min, max, req]);
  assert.equal(Number((await n(12.5, 0, 100, true)).v), 12.5);
  assert.equal((await n(null, 0, 100, false)).v, null);
  await assert.rejects(n(null, 0, 100, true), /nombre attendu/);
  await assert.rejects(n("12", 0, 100, true), /nombre attendu/, "une chaîne n'est pas un nombre");
  await assert.rejects(n(101, 0, 100, true), /hors limites/);
  await assert.rejects(n(-1, 0, 100, true), /hors limites/);
});

/* ------------------------------------------------------------------------------------------------------------- tables et contraintes */
test("tables : colonnes, clés, RLS activée ; aucune colonne d'opération brute (D1) ; compte supprimé = tout part (cascade déclarée)", async () => {
  await superu();
  for (const t of TABLES) {
    assert.equal((await un(`select relrowsecurity r from pg_class where oid = ('public.' || $1)::regclass`, [t])).r, true, t + " : RLS");
    const fk = await un(`select pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = ('public.' || $1)::regclass and c.contype = 'f' and pg_get_constraintdef(c.oid) ~ 'auth.users'`, [t]);
    assert.match(fk.d, /ON DELETE CASCADE/, t + " : cascade depuis auth.users");
  }
  const cols = (await q(`select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name = any($1)`, [TABLES])).map(r => r.table_name + "." + r.column_name);
  assert.ok(cols.length >= 50);
  assert.deepEqual(cols.filter(c => /libelle_operation|tiers|beneficiaire|iban|numero|operation|detail/.test(c)), [], "aucun libellé d'opération, tiers, IBAN ni numéro");
  for (const c of ["id", "user_id", "libelle", "etablissement", "type", "titulaire", "banque_compte_id", "position_id", "cle"]) assert.ok(cols.includes("historique_comptes." + c), c);
  for (const c of ["import_id", "cle_import", "enveloppe", "frais", "doublon_de", "estime"]) assert.ok((await q(`select 1 from information_schema.columns where table_name = 'transactions' and column_name = $1`, [c])).length, "transactions." + c);
  assert.ok((await q(`select 1 from information_schema.columns where table_name = 'status' and column_name = 'historique_a_recalculer'`)).length);
  assert.equal((await un(`select count(*)::int n from pg_indexes where indexname = 'transactions_cle_import_unique' and indexdef ~ 'WHERE'`)).n, 1, "index unique partiel");
});

test("historique_comptes : libellé (2 à 40, sans contenu sensible ni suite de 6 chiffres), listes, clé unique par utilisateur, 'autre' seul avec un libellé libre", async () => {
  await superu();
  const ins = (o = {}) => db.query(`insert into public.historique_comptes (user_id, libelle, etablissement, etablissement_libre, type, titulaire, cle) values ($1, $2, $3, $4, $5, $6, $7)`,
    [A, o.libelle ?? "Compte test", o.etablissement ?? "lcl", o.libre ?? null, o.type ?? "courant", o.titulaire ?? "p1", o.cle ?? "cle-" + (++compteur)]);
  await ins();
  for (const [o, motif] of [[{ libelle: "x" }, /libelle/], [{ libelle: "x".repeat(41) }, /libelle/], [{ libelle: "Compte 123456" }, /libelle_sensible/],
    [{ libelle: "FR7630006000011234567890189" }, /libelle_sensible/], [{ etablissement: "bnp" }, /etablissement/], [{ type: "pea" }, /type/], [{ titulaire: "p3" }, /titulaire/],
    [{ libre: "Banque X" }, /etablissement_libre/], [{ etablissement: "autre", libre: "Banque 1234567" }, /etablissement_libre/], [{ cle: "" }, /cle/]]) {
    await assert.rejects(ins(o), motif, JSON.stringify(o));
  }
  await ins({ etablissement: "autre", libre: "Banque Exemple" });
  await ins({ cle: "dup" });
  await assert.rejects(ins({ cle: "dup" }), /cle_unique|duplicate/, "clé unique par utilisateur");
  await db.query(`insert into public.historique_comptes (user_id, libelle, etablissement, type, titulaire, cle) values ($1, 'Autre', 'lcl', 'courant', 'p1', 'dup')`, [B]);
  await db.exec(`delete from public.historique_comptes where user_id in ('${A}', '${B}')`);
});

test("historique_imports, historique_releves, historique_banque_mois : bornes, formats, clés, cascade (en-tête → catégories, import → en-têtes)", async () => {
  await superu();
  const cpt = (await un(`insert into public.historique_comptes (user_id, libelle, etablissement, type, titulaire, cle) values ('${A}', 'Compte contraintes', 'lcl', 'courant', 'p1', 'contraintes') returning id`)).id;
  const imp = o => db.query(`insert into public.historique_imports (id, user_id, type, empreinte, etablissement, compte_id, periode_du, periode_au, source, fichier, resume)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
  [o.id ?? randomUUID(), A, o.type ?? "releves", o.empreinte ?? hex(64), o.etab ?? "lcl", cpt, o.du ?? "2024-01-01", o.au ?? "2024-01-31", o.source ?? "source", JSON.stringify(o.fichier ?? {}), JSON.stringify(o.resume ?? {})]);
  const id1 = randomUUID(), emp1 = hex(64);
  await imp({ id: id1, empreinte: emp1 });
  for (const [o, motif] of [[{ type: "autre" }, /type/], [{ empreinte: "ABC" }, /empreinte/], [{ empreinte: emp1 }, /empreinte_unique|duplicate/], [{ etab: "bnp" }, /etablissement/],
    [{ du: "2024-02-01", au: "2024-01-01" }, /periode/], [{ du: "1989-12-31" }, /periode/], [{ source: "" }, /source/], [{ source: "x".repeat(201) }, /source/],
    [{ fichier: [] }, /fichier/], [{ fichier: { nom: "x".repeat(2100) } }, /fichier/], [{ resume: { t: "x".repeat(4100) } }, /resume/]]) {
    await assert.rejects(imp(o), motif, JSON.stringify(o).slice(0, 60));
  }
  const rel = (o = {}) => db.query(`insert into public.historique_releves (user_id, compte_id, mois, complet, solde_debut, solde_fin, total_entrees, total_sorties, nombre, import_id)
    values ($1, $2, $3, true, $4, $5, $6, $7, $8, $9)`, [A, cpt, o.mois ?? "2024-01-01", o.sd ?? null, o.sf ?? null, o.te ?? 100, o.ts ?? 50, o.n ?? 3, o.imp ?? id1]);
  await rel();
  for (const [o, motif] of [[{ mois: "2024-01-15" }, /mois/], [{ mois: "1999-12-01" }, /mois/], [{ mois: "2024-02-01", sd: 10000001 }, /soldes/], [{ mois: "2024-02-01", te: -1 }, /totaux/],
    [{ mois: "2024-02-01", ts: 10000001 }, /totaux/], [{ mois: "2024-02-01", n: 5001 }, /nombre/], [{ mois: "2024-02-01", imp: randomUUID() }, /foreign key|import_id/]]) {
    await assert.rejects(rel(o), motif, JSON.stringify(o));
  }
  await assert.rejects(rel(), /duplicate|pkey/, "un en-tête par (compte, mois)");
  const bm = (o = {}) => db.query(`insert into public.historique_banque_mois (user_id, compte_id, mois, categorie, sous_categorie, entrees, sorties, nombre) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [A, cpt, o.mois ?? "2024-01-01", o.cat ?? "logement", o.sous ?? "", o.e ?? 0, o.s ?? 10, o.n ?? 1]);
  await bm();
  for (const [o, motif] of [[{ cat: "courses" }, /categorie/], [{ sous: "loyer" }, /sous_categorie/], [{ e: -1 }, /montants/], [{ s: 10000001 }, /montants/], [{ n: 5001 }, /nombre/],
    [{ cat: "divers", mois: "2024-03-01" }, /releve|foreign key/]]) {
    await assert.rejects(bm(o), motif, JSON.stringify(o));
  }
  await assert.rejects(bm(), /duplicate|pkey/);
  await db.exec(`delete from public.historique_releves where mois = '2024-01-01' and compte_id = '${cpt}'`);
  assert.equal((await un(`select count(*)::int n from public.historique_banque_mois where compte_id = $1`, [cpt])).n, 0, "cascade : en-tête → catégories");
  await rel(); await bm();
  await db.exec(`delete from public.historique_imports where id = '${id1}'`);
  assert.equal((await un(`select count(*)::int n from public.historique_releves where compte_id = $1`, [cpt])).n, 0, "cascade : import → en-têtes");
  assert.equal((await un(`select count(*)::int n from public.historique_banque_mois where compte_id = $1`, [cpt])).n, 0, "et catégories");
  await db.exec(`delete from public.historique_comptes where id = '${cpt}'`);
});

test("transactions : une ligne OU une enveloppe, clé d'import unique par utilisateur, doublon_de jamais soi-même et remis à nul par la suppression, import supprimé = ses mouvements", async () => {
  await superu();
  const pos = (await un(`insert into public.positions (user_id, name, envelope, owner, mode, value) values ('${A}', 'Ligne contraintes', 'PEA', 'p1', 'manual', 100) returning id`)).id;
  const imp = randomUUID();
  await db.query(`insert into public.historique_imports (id, user_id, type, empreinte, etablissement, enveloppe, periode_du, periode_au, source) values ($1, $2, 'ordres', $3, 'lcl', 'PEA', '2024-01-01', '2024-01-31', 's')`, [imp, A, hex(64)]);
  const tx = (o = {}) => db.query(`insert into public.transactions (user_id, position_id, enveloppe, date, type, amount, cle_import, import_id, frais, doublon_de) values ($1, $2, $3, '2024-01-10', $4, 10, $5, $6, $7, $8) returning id`,
    [A, "position_id" in o ? o.position_id : pos, o.enveloppe ?? null, o.type ?? "versement", o.cle ?? null, o.imp ?? null, o.frais ?? null, o.doublon ?? null]);
  await assert.rejects(tx({ position_id: null }), /position_ou_enveloppe/);
  await tx({ position_id: null, enveloppe: "PEA" });
  await assert.rejects(tx({ enveloppe: "x".repeat(101) }), /enveloppe/);
  await assert.rejects(tx({ frais: -1 }), /frais/);
  const t1 = (await tx({ cle: "c1", imp })).rows[0].id;
  await assert.rejects(tx({ cle: "c1" }), /cle_import_unique|duplicate/, "clé d'import unique");
  await tx({ cle: null }); await tx({ cle: null });
  await assert.rejects(db.query(`update public.transactions set doublon_de = id where id = $1`, [t1]), /doublon_de_autre/);
  const t2 = (await tx({ doublon: t1 })).rows[0].id;
  await db.exec(`delete from public.transactions where id = '${t1}'`);
  assert.equal((await un(`select doublon_de d from public.transactions where id = $1`, [t2])).d, null, "on delete set null");
  const t3 = (await tx({ cle: "c3", imp })).rows[0].id;
  await db.exec(`delete from public.historique_imports where id = '${imp}'`);
  assert.equal((await q(`select 1 from public.transactions where id = $1`, [t3])).length, 0, "import supprimé : ses mouvements aussi");
  assert.equal((await q(`select 1 from public.transactions where id = $1`, [t2])).length, 1, "les autres transactions restent");
  await db.exec(`delete from public.positions where id = '${pos}'`);
});

test("photos_reconstituees : bornes (qualité, part, taille), mois et date cohérents, jamais à partir de la première photo observée, 240 mois au plus", async () => {
  await service();
  const ph = (mois, o = {}) => db.query(`insert into public.photos_reconstituees (user_id, mois, date, total, p1, p2, financier, net, qualite, part_estimee, methode, sources, by_bloc)
    values ($1, $2::date, ($2::date + interval '1 month - 1 day')::date, 1000, 1000, 0, 1000, 1000, $3, $4, 'historique@2', $5::jsonb, $6::jsonb)`,
    [o.uid ?? A, mois, o.qualite ?? "partiel", o.part ?? 0.2, JSON.stringify(o.sources ?? []), JSON.stringify(o.bloc ?? {})]);
  await ph("2024-12-01");
  await assert.rejects(ph("2024-12-01"), /duplicate|pkey/);
  await assert.rejects(ph("2024-11-15"), /mois/);
  await assert.rejects(ph("1999-12-01"), /mois/);
  await assert.rejects(ph("2024-10-01", { qualite: "bon" }), /qualite/);
  await assert.rejects(ph("2024-10-01", { part: 1.5 }), /part/);
  await assert.rejects(ph("2024-10-01", { sources: Array.from({ length: 31 }, () => ({ type: "cours", part: 0.1 })) }), /sources/);
  await assert.rejects(ph("2024-10-01", { bloc: { a: "x".repeat(20100) } }), /by_bloc/);
  await assert.rejects(db.query(`insert into public.photos_reconstituees (user_id, mois, date, total, p1, p2, financier, net, qualite, part_estimee, methode)
    values ($1, '2024-09-01', '2024-09-29', 1, 1, 0, 1, 1, 'complet', 0, 'x')`, [A]), /photos_reconstituees_date/);
  // la première photo observée de A date du 2025-01-31 : un mois dont le dernier jour lui est postérieur ou égal est refusé
  await assert.rejects(ph("2025-01-01"), /première photo observée/);
  // 240 mois au plus (B n'a aucune photo observée : la règle de la première photo ne joue pas)
  await db.query(`insert into public.photos_reconstituees (user_id, mois, date, total, p1, p2, financier, net, qualite, part_estimee, methode)
    select $1, m::date, (m::date + interval '1 month - 1 day')::date, 1, 1, 0, 1, 1, 'estime', 1, 'x' from generate_series('2000-01-01'::date, '2019-12-01'::date, interval '1 month') m`, [B]);
  assert.equal((await un(`select count(*)::int n from public.photos_reconstituees where user_id = $1`, [B])).n, 240, "240 photos (20 ans)");
  await assert.rejects(ph("2020-01-01", { uid: B }), /240 photos/);
  await db.query(`update public.photos_reconstituees set total = 2 where user_id = $1 and mois = '2000-01-01'`, [B]);
  await db.exec(`delete from public.photos_reconstituees where user_id in ('${A}', '${B}')`);
  await superu();
});

/* ------------------------------------------------------------------------------------------------------------- politiques et droits */
test("pg_policies : formes de 0033 (restrictive, aal2 ou connecteur en lecture, aal2 sans client_id en écriture et suppression) ; photos « si facteur » ; (select …) partout", async () => {
  await superu();
  const r = await q(`select tablename, policyname, permissive, roles::text, cmd, coalesce(qual, '') qual, coalesce(with_check, '') with_check from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABLES]);
  for (const t of TABLES_BANCAIRES) {
    const tout = r.find(p => p.tablename === t && p.policyname === `${t}: aal2`);
    assert.ok(tout, t + " : politique aal2");
    assert.equal(tout.permissive, "RESTRICTIVE"); assert.equal(tout.cmd, "ALL"); assert.match(tout.roles, /authenticated/);
    assert.match(tout.qual, /aal2/); assert.match(tout.qual, /connecteur_autorise/); assert.doesNotMatch(tout.qual, /mfa_exigee/, t + " : jamais « sans facteur »");
    assert.match(tout.with_check, /aal2/); assert.match(tout.with_check, /client_id/); assert.doesNotMatch(tout.with_check, /connecteur_autorise|mfa_exigee/, t + " : écriture en aal2 seulement");
    const sup = r.find(p => p.tablename === t && p.policyname === `${t}: suppression aal2`);
    assert.ok(sup && sup.permissive === "RESTRICTIVE" && sup.cmd === "DELETE", t + " : suppression");
    assert.match(sup.qual, /aal2/); assert.match(sup.qual, /client_id/); assert.doesNotMatch(sup.qual, /connecteur_autorise/);
    assert.deepEqual(r.filter(p => p.tablename === t && p.permissive === "PERMISSIVE").map(p => p.cmd).sort(), ["DELETE", "INSERT", "SELECT", "UPDATE"], t + " : propriétaire");
  }
  const ph = r.find(p => p.policyname === "photos_reconstituees: aal2 si facteur");
  assert.ok(ph && ph.permissive === "RESTRICTIVE" && ph.cmd === "ALL");
  for (const e of [ph.qual, ph.with_check]) { assert.match(e, /aal2/); assert.match(e, /mfa_exigee/); assert.match(e, /connecteur_autorise/); }
  assert.deepEqual(r.filter(p => p.tablename === "photos_reconstituees" && p.permissive === "PERMISSIVE").map(p => p.cmd), ["SELECT"], "photos : lecture seule pour le propriétaire");
  for (const p of r) {
    const e = (p.qual + " " + p.with_check).toLowerCase();
    for (const m of e.matchAll(/auth\.(jwt|uid)\(\)/g)) assert.equal(e.slice(Math.max(0, m.index - 7), m.index), "select ", `${p.policyname} : auth.${m[1]}() hors (select …)`);
  }
});

test("droits : anon rien ; authenticated lit les cinq tables et écrit les quatre tables bancaires, jamais les photos ; service_role tout ; fonctions réservées à authenticated et service_role", async () => {
  await superu();
  for (const t of TABLES) {
    for (const p of ["select", "insert", "update", "delete", "truncate", "references", "trigger"])
      assert.equal((await un(`select has_table_privilege('anon', $1, $2) v`, ["public." + t, p])).v, false, `${t} : anon ${p}`);
    assert.equal((await un(`select has_table_privilege('authenticated', $1, 'select') v`, ["public." + t])).v, true, t + " : authenticated lit");
    for (const p of ["insert", "update", "delete"])
      assert.equal((await un(`select has_table_privilege('authenticated', $1, $2) v`, ["public." + t, p])).v, t !== "photos_reconstituees", `${t} : authenticated ${p}`);
    for (const p of ["truncate", "references", "trigger"]) assert.equal((await un(`select has_table_privilege('authenticated', $1, $2) v`, ["public." + t, p])).v, false, `${t} : authenticated ${p}`);
    for (const p of ["select", "insert", "update", "delete"]) assert.equal((await un(`select has_table_privilege('service_role', $1, $2) v`, ["public." + t, p])).v, true, `${t} : service_role ${p}`);
  }
  for (const f of ["categorie_budget_valide(text)", "sous_categorie_budget_valide(text, text)", "historique_isin_valide(text)", "historique_texte(jsonb, text, integer, boolean, integer)",
    "historique_nombre(jsonb, text, numeric, numeric, boolean)", "historique_garde()", "historique_appliquer(text, jsonb, text)", "historique_retirer(uuid)", "retirer_import(uuid)"]) {
    const o = `public.${f}`;
    const r = await un(`select has_function_privilege('anon', $1::regprocedure, 'execute') an, has_function_privilege('public', $1::regprocedure, 'execute') pu,
      has_function_privilege('authenticated', $1::regprocedure, 'execute') au, has_function_privilege('service_role', $1::regprocedure, 'execute') se`, [o]);
    assert.deepEqual(r, { an: false, pu: false, au: true, se: true }, f);
  }
  for (const f of ["historique_appliquer(text, jsonb, text)", "historique_retirer(uuid)", "retirer_import(uuid)", "historique_garde()"]) {
    const d = await un(`select p.prosecdef, pg_get_functiondef(p.oid) def from pg_proc p where p.oid = $1::regprocedure`, ["public." + f]);
    assert.equal(d.prosecdef, false, f + " : security invoker (la RLS borne tout)");
    assert.match(d.def, /set search_path to ''/i, f);
  }
  // pas d'écriture directe des photos par authenticated, même avec une session aal2
  await session(A);
  await refuse(`insert into public.photos_reconstituees (user_id, mois, date, total, p1, p2, financier, net, qualite, part_estimee, methode)
    values ('${A}', '2024-05-01', '2024-05-31', 1, 1, 0, 1, 1, 'estime', 1, 'x')`, /permission denied/, "photos : insert par authenticated");
  await refuse(`update public.photos_reconstituees set total = 1`, /permission denied/, "photos : update par authenticated");
  await refuse(`delete from public.photos_reconstituees`, /permission denied/, "photos : delete par authenticated");
  await superu();
});

/* ------------------------------------------------------------------------------------------------------------- double authentification */
test("régime bancaire : A (facteur) lit en aal2 et rien en aal1 ni sans revendication ; B ne voit rien de A ; C (sans facteur) reste fermé", async () => {
  await superu();
  const id1 = randomUUID();
  await db.exec(`
    insert into public.historique_comptes (id, user_id, libelle, etablissement, type, titulaire, cle) values ('${id1}', '${A}', 'Compte régime', 'lcl', 'courant', 'p1', 'regime');
    insert into public.historique_imports (id, user_id, type, empreinte, etablissement, compte_id, periode_du, periode_au, source)
      values ('${id1}', '${A}', 'releves', '${hex(64)}', 'lcl', '${id1}', '2024-01-01', '2024-01-31', 'source');
    insert into public.historique_releves (user_id, compte_id, mois, complet, total_entrees, total_sorties, import_id) values ('${A}', '${id1}', '2024-01-01', true, 10, 5, '${id1}');
    insert into public.historique_banque_mois (user_id, compte_id, mois, categorie, sorties) values ('${A}', '${id1}', '2024-01-01', 'divers', 5);
    insert into public.photos_reconstituees (user_id, mois, date, total, p1, p2, financier, net, qualite, part_estimee, methode)
      values ('${A}', '2024-12-01', '2024-12-31', 1, 1, 0, 1, 1, 'estime', 1, 'x');`);
  for (const t of TABLES) {
    await session(A, "aal2");
    assert.equal((await q(`select 1 from public.${t}`)).length, 1, t + " : A lit en aal2");
    await session(A, "aal1");
    assert.deepEqual(await q(`select 1 from public.${t}`), [], t + " : fermée en aal1 (A a un facteur)");
    await session(A, "aucun");
    assert.deepEqual(await q(`select 1 from public.${t}`), [], t + " : fermée sans revendication aal");
    await session(B, "aal2");
    assert.deepEqual(await q(`select 1 from public.${t}`), [], t + " : B ne voit rien de A");
  }
  await session(C, "aal1");
  for (const t of TABLES_BANCAIRES) assert.deepEqual(await q(`select 1 from public.${t}`), [], t + " : fermée pour C (aucun facteur, jamais aal2)");
  await superu();
});

test("régime bancaire, écritures : refusées en aal1 (insert, update, delete), acceptées en aal2 pour le propriétaire, jamais au nom d'un autre", async () => {
  await session(A, "aal1");
  await refuse(`insert into public.historique_comptes (user_id, libelle, etablissement, type, titulaire, cle) values ('${A}', 'Pirate', 'lcl', 'courant', 'p1', 'pirate')`, /row-level security/, "insert en aal1");
  assert.equal((await db.query(`update public.historique_comptes set libelle = 'Piraté'`)).affectedRows, 0, "update en aal1");
  assert.equal((await db.query(`delete from public.historique_imports`)).affectedRows, 0, "delete en aal1");
  await session(A, "aal2");
  await db.exec(`update public.historique_comptes set libelle = 'Compte régime 2' where cle = 'regime'`);
  assert.equal((await un(`select libelle from public.historique_comptes where cle = 'regime'`)).libelle, "Compte régime 2");
  await refuse(`insert into public.historique_comptes (user_id, libelle, etablissement, type, titulaire, cle) values ('${B}', 'Intrus', 'lcl', 'courant', 'p1', 'intrus')`, /row-level security/, "insert au nom de B");
  await session(B, "aal2");
  assert.equal((await db.query(`update public.historique_comptes set libelle = 'Piraté par B'`)).affectedRows, 0, "B ne modifie pas la ligne de A");
  assert.equal((await db.query(`delete from public.historique_comptes`)).affectedRows, 0, "ni ne la supprime");
  await superu();
  assert.equal((await un(`select libelle from public.historique_comptes where cle = 'regime'`)).libelle, "Compte régime 2");
});

test("photos : régime « si facteur » : A (facteur) fermé en aal1, C (sans facteur) lit en aal1 ; aucun droit d'écriture ; le service écrit", async () => {
  await superu();
  await db.exec(`insert into public.photos_reconstituees (user_id, mois, date, total, p1, p2, financier, net, qualite, part_estimee, methode)
    values ('${C}', '2024-12-01', '2024-12-31', 7, 7, 0, 7, 7, 'estime', 1, 'x')`);
  await session(C, "aal1");
  assert.equal((await q(`select total::int t from public.photos_reconstituees`))[0].t, 7, "C sans facteur lit en aal1");
  await refuse(`insert into public.photos_reconstituees (user_id, mois, date, total, p1, p2, financier, net, qualite, part_estimee, methode) values ('${C}', '2024-11-01', '2024-11-30', 1, 1, 0, 1, 1, 'estime', 1, 'x')`, /permission denied/, "C n'écrit pas");
  await session(A, "aal1");
  assert.deepEqual(await q(`select 1 from public.photos_reconstituees`), [], "A (facteur) fermé en aal1");
  await session(B, "aal2");
  assert.deepEqual(await q(`select user_id from public.photos_reconstituees`), [], "B ne voit pas les photos de A ni de C");
  await service();
  assert.ok((await q(`select 1 from public.photos_reconstituees`)).length >= 2, "le service lit tout");
  await db.exec(`update public.photos_reconstituees set qualite = 'partiel' where user_id = '${C}'`);
  await superu();
});

test("connecteur autorisé (jeton OAuth aal1 lié à une session aal2) : lit les cinq tables, n'écrit ni ne supprime rien, n'appelle ni l'import ni le retrait", async () => {
  await session(A, "aal1", { client: CLIENT, sess: SESSION });
  for (const t of TABLES) assert.ok((await q(`select 1 from public.${t}`)).length >= 1, t + " : lecture par le connecteur autorisé");
  await refuse(`insert into public.historique_comptes (user_id, libelle, etablissement, type, titulaire, cle) values ('${A}', 'Connecteur', 'lcl', 'courant', 'p1', 'connecteur')`, /row-level security/, "insert");
  await refuse(`update public.historique_comptes set libelle = 'Connecteur'`, /row-level security/, "update");
  await refuse(`update public.historique_banque_mois set sorties = 1`, /row-level security/, "update des catégories");
  assert.equal((await db.query(`delete from public.historique_comptes`)).affectedRows, 0, "delete comptes");
  assert.equal((await db.query(`delete from public.historique_releves`)).affectedRows, 0, "delete relevés");
  assert.equal((await db.query(`delete from public.historique_imports`)).affectedRows, 0, "delete imports");
  const id = (await q(`select id from public.historique_imports limit 1`))[0].id;
  await refuse(`select public.retirer_import('${id}')`, /connecteur ne peut pas/i, "retirer_import par le connecteur");
  await refuse(`select public.historique_appliquer('${randomUUID()}', '{}'::jsonb, 'x')`, /connecteur ne peut pas/i, "historique_appliquer par le connecteur");
  // même un jeton OAuth qui serait aal2 ne peut pas écrire
  await session(A, "aal2", { client: CLIENT, sess: SESSION });
  await refuse(`insert into public.historique_comptes (user_id, libelle, etablissement, type, titulaire, cle) values ('${A}', 'Connecteur', 'lcl', 'courant', 'p1', 'connecteur')`, /row-level security/, "jeton OAuth aal2 hypothétique");
  assert.equal((await db.query(`delete from public.historique_comptes`)).affectedRows, 0, "ni supprimer");
  // sans autorisation (autre session) : fermé
  await session(A, "aal1", { client: CLIENT, sess: "cccccccc-0000-4000-8000-000000000009" });
  for (const t of TABLES) assert.deepEqual(await q(`select 1 from public.${t}`), [], t + " : autre session OAuth, fermée");
  // on repart d'un historique vide (les photos de A servent encore à l'export)
  await superu();
  await db.exec(`delete from public.historique_imports where user_id = '${A}'; delete from public.historique_comptes where user_id = '${A}';`);
});

/* ------------------------------------------------------------------------------------------------------------- import de relevés */
let compteId, importB1;

test("relevés B1 : la proposition validée crée le compte, l'import, les en-têtes et les catégories (cas B1, catégories larges), demande le recalcul", async () => {
  await session(A);
  const apres = apresReleves(moisDe("B1"));
  const v = await valider(apres);
  assert.equal(v.n, 1);
  assert.equal((await un(`select statut from public.propositions where id = $1`, [v.p])).statut, "acceptee");
  importB1 = v.ref;
  const cpt = await q(`select * from public.historique_comptes`);
  assert.equal(cpt.length, 1);
  assert.deepEqual([cpt[0].libelle, cpt[0].etablissement, cpt[0].type, cpt[0].titulaire, cpt[0].cle], ["Compte courant Exemple", "boursobank", "courant", "p1", COMPTE_B1.cle]);
  compteId = cpt[0].id;
  const imp = await un(`select * from public.historique_imports where id = $1`, [v.ref]);
  assert.deepEqual([imp.type, imp.empreinte, imp.compte_id, imp.etablissement], ["releves", apres.empreinte, compteId, "boursobank"]);
  assert.equal(imp.enveloppe, null);
  assert.deepEqual(await un(`select to_char(periode_du, 'YYYY-MM-DD') du, to_char(periode_au, 'YYYY-MM-DD') au from public.historique_imports where id = $1`, [v.ref]), { du: "2024-01-01", au: "2024-03-28" });
  assert.equal(imp.source, "Export déposé dans la conversation le 16/10/2026");
  assert.deepEqual(imp.fichier, { format: "csv", nom: "export-compte-courant.csv", lignes: 120, octets: 5400, periode: { du: "2024-01-01", au: "2024-03-28" } });
  assert.equal(imp.resume.mois_importes, 2); assert.equal(imp.resume.mois_remplaces, 0); assert.equal(imp.resume.mois, 2, "le résumé du connecteur est conservé");
  assert.deepEqual(imp.lignes_creees, []);
  const rel = await q(`select to_char(mois, 'YYYY-MM') m, complet, solde_debut::int sd, solde_fin::int sf, total_entrees::int te, total_sorties::int ts, nombre, import_id from public.historique_releves order by mois`);
  assert.deepEqual(rel, [
    { m: "2024-01", complet: true, sd: 2000, sf: 2200, te: 3000, ts: 2800, nombre: 15, import_id: v.ref },
    { m: "2024-02", complet: true, sd: 2200, sf: 2280, te: 3040, ts: 2960, nombre: 18, import_id: v.ref }]);
  const lig = await q(`select to_char(mois, 'YYYY-MM') m, categorie, sous_categorie, entrees::int e, sorties::int s from public.historique_banque_mois order by mois, categorie`);
  assert.equal(lig.length, 11);
  assert.deepEqual(lig.filter(l => l.m === "2024-02" && l.categorie === "divers"), [{ m: "2024-02", categorie: "divers", sous_categorie: "", e: 40, s: 60 }]);
  assert.ok((await un(`select historique_a_recalculer h from public.status`)).h, "demande de recalcul posée");
});

test("relevés : le même contenu est refusé (« déjà importé le … ») ; un autre ordre des mois et des catégories donne le même refus (idempotence du connecteur, contrainte unique ici)", async () => {
  await session(A);
  const emp = (await un(`select empreinte from public.historique_imports where id = $1`, [importB1])).empreinte;
  await echoue(apresReleves(moisDe("B1").reverse(), { empreinte: emp }), /Ce contenu a déjà été importé le \d{2}\/\d{2}\/\d{4}/, "même empreinte");
  await valider(apresReleves(moisDe("B1").reverse(), { empreinte: emp })).then(() => assert.fail("accepté"), e => assert.match(e.message, /Proposition non appliquée \(import d'historique, creer\) : Ce contenu a déjà été importé le/));
  assert.equal((await un(`select count(*)::int n from public.historique_imports`)).n, 1);
  assert.equal((await un(`select statut from public.propositions where cible = 'historique' order by cree_le desc limit 1`)).statut, "en_attente", "refusée : reste en attente");
  const redepot = await un(`select count(*)::int n from public.propositions where cible = 'historique'`);
  assert.ok(redepot.n >= 2);
});

test("relevés B1-remp : le second import remplace février (en-tête et catégories), ajoute mars, laisse janvier ; compte retrouvé par son identifiant", async () => {
  await session(A);
  const apres = apresReleves(moisDe("B1-remp"), { compte: { id: compteId }, periode: { du: "2024-02-01", au: "2024-03-28" } });
  const v = await valider(apres);
  assert.equal(v.n, 1);
  const attendu = cas("B1-remp/appliquer").attendu;
  const rel = await q(`select to_char(mois, 'YYYY-MM') m, solde_fin::int sf, import_id from public.historique_releves order by mois`);
  for (const r of rel) {
    assert.equal(r.sf, attendu.historique_releves[r.m].solde_fin, r.m);
    assert.equal(r.import_id, attendu.historique_releves[r.m].import === "B1" ? importB1 : v.ref, r.m + " : import d'origine");
  }
  const lignes = Object.fromEntries((await q(`select to_char(mois, 'YYYY-MM') m, count(*)::int n from public.historique_banque_mois group by mois`)).map(r => [r.m, r.n]));
  assert.deepEqual(lignes, attendu.historique_banque_mois_lignes);
  assert.equal((await un(`select count(*)::int n from public.historique_imports`)).n, attendu.historique_imports);
  assert.equal((await un(`select count(*)::int n from public.historique_comptes`)).n, 1, "un seul compte");
  const imp = await un(`select resume from public.historique_imports where id = $1`, [v.ref]);
  assert.deepEqual([imp.resume.mois_importes, imp.resume.mois_remplaces], [2, 1], "un mois remplacé");
  // février vient du second import : 500 € de courses et non 520
  assert.equal(Number((await un(`select sorties from public.historique_banque_mois where mois = '2024-02-01' and categorie = 'alimentation'`)).sorties), 500);
  importB1 = { premier: importB1, second: v.ref };
});

test("relevés : retirer le second import enlève ses mois et leurs catégories, pas ceux du premier ; la demande de recalcul est reposée", async () => {
  await session(A);
  await superu(); await db.exec(`update public.status set historique_a_recalculer = null where user_id = '${A}'`); await session(A);
  const r = (await un(`select public.retirer_import($1) r`, [importB1.second])).r;
  assert.deepEqual(r, { import_id: importB1.second, mouvements_retires: 0, lignes_supprimees: 0 });
  assert.deepEqual((await q(`select to_char(mois, 'YYYY-MM') m from public.historique_releves order by mois`)).map(x => x.m), ["2024-01"]);
  assert.equal((await un(`select count(*)::int n from public.historique_banque_mois`)).n, 5);
  assert.equal((await un(`select count(*)::int n from public.historique_imports`)).n, 1);
  assert.ok((await un(`select historique_a_recalculer h from public.status`)).h);
  // remise en place pour la suite : février et mars réimportés
  await valider(apresReleves(moisDe("B1-remp"), { compte: { id: compteId } }));
});

test("relevés, contrôles bloquants (spec § 5.1) : sommes des catégories, soldes, mois, doublons de mois, clés, lignes, montants", async () => {
  await session(A);
  const base = () => moisDe("B1", "2024-01");
  const avecMois = (m, o) => echoue(apresReleves(m, { compte: { id: compteId } }), o[0], o[1]);
  // B1-err : février, 2 970 € de sorties dans les catégories pour 2 960 € annoncés
  await avecMois(moisDe("B1").map((m, i) => i === 1 ? { ...m, categories: m.categories.map(c => c.categorie === "alimentation" ? { ...c, sorties: c.sorties + 10 } : c) } : m), [/mois 2024-02 : les catégories totalisent 2970 € de sorties, le contrôle en annonce 2960 €/, "B1-err"]);
  await avecMois(base().map(m => ({ ...m, controle: { total_entrees: 3010, total_sorties: 2800 } })), [/mois 2024-01 : les catégories totalisent 3000 € d'entrées, le contrôle en annonce 3010 €/, "entrées"]);
  // B-solde-faux : solde_fin 2 300 au lieu de 2 200 ; B-solde-tolerance : 0,80 € d'écart accepté
  await avecMois(base().map(m => ({ ...m, controle: { ...m.controle, solde_fin: 2300 } })), [/le solde de fin \(2300\) ne correspond pas/, "solde faux"]);
  const ok = await importer(apresReleves(base().map(m => ({ ...m, mois: "2023-05", controle: { ...m.controle, solde_fin: 2200.8 } })), { compte: { id: compteId } }));
  assert.equal(ok.mois, 1, "B-solde-tolerance");
  // formats et bornes de mois
  await avecMois(base().map(m => ({ ...m, mois: "2024-1" })), [/mois « 2024-1 » invalide/, "format"]);
  await avecMois(base().map(m => ({ ...m, mois: "1999-12" })), [/de 2000-01 au mois en cours/, "B-mois-ancien"]);
  await avecMois(base().map(m => ({ ...m, mois: decaler(MOIS_COURANT, 1) })), [/de 2000-01 au mois en cours/, "B-mois-futur"]);
  await avecMois(base().map(m => ({ ...m, mois: MOIS_COURANT, complet: true })), [new RegExp(`mois ${MOIS_COURANT} : le mois en cours ne peut pas être complet`), "B-mois-courant-complet"]);
  const partiel = await importer(apresReleves(base().map(m => ({ ...m, mois: MOIS_COURANT, complet: false })), { compte: { id: compteId }, periode: { du: MOIS_COURANT + "-01", au: paris() } }));
  assert.equal(partiel.mois, 1, "B-mois-courant-partiel");
  await avecMois([...base(), ...base()], [/mois 2024-01 en double/, "B-mois-double"]);
  await avecMois(base().map(m => ({ ...m, complet: "oui" })), [/complet \(vrai ou faux\) attendu/, "complet non booléen"]);
  // catégories : inconnue, sous-catégorie non vide (avant BUD1), doublon, plus de 30 lignes, montants
  await avecMois(base().map(m => ({ ...m, categories: [{ categorie: "courses", sous_categorie: "", entrees: 0, sorties: 1, nombre: 1 }] })), [/catégorie « courses » inconnue/, "B-cle-inconnue"]);
  await avecMois(base().map(m => ({ ...m, categories: [{ categorie: "logement", sous_categorie: "loyer", entrees: 0, sorties: 1200, nombre: 1 }] })), [/sous-catégorie « loyer » inconnue pour la catégorie « logement »/, "B-avant-bud1-fine"]);
  await avecMois(base().map(m => ({ ...m, categories: [...m.categories, m.categories[0]] })), [/plusieurs lignes pour « revenus \//, "B-cle-double"]);
  await avecMois(base().map(m => ({ ...m, categories: Array.from({ length: 31 }, () => m.categories[0]) })), [/30 lignes au plus/, "B-31-lignes"]);
  await avecMois(base().map(m => ({ ...m, controle: { ...m.controle, total_sorties: 10000001 } })), [/total_sorties : valeur hors limites/, "B-montant-max"]);
  await avecMois(base().map(m => ({ ...m, categories: [{ ...m.categories[0], entrees: -5 }] })), [/entrees : valeur hors limites/, "B-montant-negatif"]);
  await avecMois(base().map(m => ({ ...m, categories: [{ ...m.categories[0], entrees: "3000" }] })), [/entrees : nombre attendu/, "montant texte"]);
  await avecMois(base().map(m => ({ ...m, extra: 1 })), [/mois : champ « extra » inconnu/, "clé en trop"]);
  // 60 mois acceptés, 61 refusés
  const serie = n => Array.from({ length: n }, (_, i) => ({ mois: decaler("2015-01", i), complet: true, controle: { total_entrees: 0, total_sorties: 0 }, categories: [] }));
  await avecMois(serie(61), [/1 à 60 mois attendus/, "B-61-mois"]);
  const soixante = await importer(apresReleves(serie(60), { compte: { id: compteId }, periode: { du: "2015-01-01", au: "2019-12-31" } }));
  assert.equal(soixante.mois, 60, "B-60-mois");
  await avecMois([], [/1 à 60 mois attendus/, "aucun mois"]);
});

test("relevés, textes et structure : contenu sensible, numéros, établissement, période, clés inconnues, compte d'un autre refusés", async () => {
  await session(A);
  const m = () => moisDe("B1", "2024-01").map(x => ({ ...x, mois: "2022-01" }));
  const compte = o => ({ ...COMPTE_B1, cle: "cle-" + (++compteur), ...o });
  await echoue(apresReleves(m(), { compte: compte({ libelle: "FR7630006000011234567890189" }) }), /compte.libelle : contenu sensible/, "S-iban");
  await echoue(apresReleves(m(), { compte: compte({ libelle: "Compte 123456" }) }), /suite de 6 chiffres/, "S-libelle-compte");
  await echoue(apresReleves(m(), { compte: compte({ libelle: "x" }) }), /compte.libelle : 2 caractères au moins|2 caractères/, "libellé trop court");
  await echoue(apresReleves(m(), { compte: compte({ libelle: "x".repeat(41) }) }), /40 caractères au plus/, "S-libelle-long");
  await echoue(apresReleves(m(), { compte: compte({ libelle: "mon mot de passe" }) }), /contenu sensible/, "S-mot");
  await echoue(apresReleves(m(), { compte: compte({ type: "pea" }) }), /compte.type invalide/, "type de compte");
  await echoue(apresReleves(m(), { compte: compte({ titulaire: "p3" }) }), /compte.titulaire invalide/, "titulaire");
  await echoue(apresReleves(m(), { compte: compte({ extra: 1 }) }), /compte : champ « extra » inconnu/, "clé en trop du compte");
  await echoue(apresReleves(m(), { compte: { id: compteId, libelle: "Autre" } }), /avec un identifiant, seuls/, "id et libellé");
  await echoue(apresReleves(m(), { compte: { id: randomUUID() } }), /compte « .* » introuvable/, "compte inconnu");
  await echoue(apresReleves(m(), { compte: { id: compteId }, etablissement: "lcl" }), /ce compte est chez « boursobank »/, "autre établissement");
  await echoue(apresReleves(m(), { compte: compte(), extra: { fichier: { ...FICHIER_CSV, nom: "export-12345678.csv" } } }), /fichier.nom : une suite de 8 chiffres/, "S-fichier");
  await echoue(apresReleves(m(), { compte: compte(), extra: { fichier: { ...FICHIER_CSV, nom: "FR7630006000011234567890189.csv" } } }), /fichier.nom : contenu sensible/, "IBAN dans le nom");
  await echoue(apresReleves(m(), { compte: compte(), extra: { fichier: { format: "doc" } } }), /fichier : format invalide/, "format de fichier");
  await echoue(apresReleves(m(), { compte: compte(), extra: { fichier: { ...FICHIER_CSV, extra: 1 } } }), /fichier : champ « extra » inconnu/, "clé en trop du fichier");
  await echoue(apresReleves(m(), { compte: compte(), etablissement: "bnp" }), /établissement invalide/, "établissement");
  await echoue(apresReleves(m(), { compte: compte(), extra: { etablissement_libre: "Banque X" } }), /seulement pour l'établissement « autre »/, "libellé libre sans autre");
  await echoue(apresReleves(m(), { compte: compte(), etablissement: "autre", extra: { etablissement_libre: "Banque 12345678" } }), /suite de 6 chiffres/, "libellé libre à numéro");
  await echoue(apresReleves(m(), { compte: compte(), periode: { du: "2024-02-01", au: "2024-01-01" } }), /postérieure à celle de fin/, "période inversée");
  await echoue(apresReleves(m(), { compte: compte(), periode: { du: "1989-01-01", au: "2024-01-01" } }), /du 1990-01-01 à aujourd'hui/, "période trop ancienne");
  await echoue(apresReleves(m(), { compte: compte(), periode: { du: "2024-01-01", au: "2999-01-01" } }), /du 1990-01-01 à aujourd'hui/, "période future");
  await echoue({ ...apresReleves(m(), { compte: compte() }), empreinte: "ABC" }, /empreinte invalide/, "empreinte");
  await echoue({ ...apresReleves(m(), { compte: compte() }), type: "autre" }, /type invalide/, "type d'import");
  await echoue({ ...apresReleves(m(), { compte: compte() }), intrus: 1 }, /import : champ « intrus » inconnu/, "clé en trop");
  await echoue(apresReleves(m(), { compte: compte(), extra: { enveloppe: "PEA" } }), /enveloppe non attendue/, "enveloppe pour des relevés");
  await echoue(apresReleves(m(), { compte: compte(), extra: { doublons: [] } }), /ne concernent que les ordres/, "doublons pour des relevés");
  await echoue(apresReleves(m(), { compte: compte(), extra: { resume: { note: "FR7630006000011234567890189" } } }), /resume : contenu sensible/, "résumé sensible");
  await echoue(apresReleves(m(), { compte: compte(), extra: { resume: { note: "x".repeat(4200) } } }), /resume : 4 000 octets au plus/, "résumé trop gros");
  await echoue(apresReleves(m(), { compte: compte() }), /source : texte attendu/, "source vide", { source: "   " });
  await echoue(apresReleves(m(), { compte: compte() }), /import : identifiant invalide/, "ref invalide", { ref: "pas-un-uuid" });
  // un compte que B ne possède pas ne s'ouvre pas pour B
  await session(B);
  await echoue(apresReleves(m(), { compte: { id: compteId } }), /compte « .* » introuvable/, "compte de A");
  await session(A);
  assert.equal((await un(`select count(*)::int n from public.historique_comptes`)).n, 1, "aucun compte créé par les refus");
});

test("relevés : 40 comptes au plus par utilisateur, 300 imports au plus (limites claires), rattachements au bilan et à la banque vérifiés", async () => {
  await session(A);
  const m = () => moisDe("B1", "2024-01").map(x => ({ ...x, mois: "2021-03" }));
  // rattachement : ligne du bilan et compte synchronisé doivent exister pour l'utilisateur
  const pos = await ligne("Ligne compte courant", { value: 2200 });
  await echoue(apresReleves(m(), { compte: { ...COMPTE_B1, cle: "rattache", position_id: randomUUID() } }), /compte.position_id : ligne introuvable/, "ligne inconnue");
  await echoue(apresReleves(m(), { compte: { ...COMPTE_B1, cle: "rattache", banque_compte_id: 999 } }), /compte synchronisé introuvable/, "compte synchronisé inconnu");
  await superu();
  await db.exec(`insert into public.banque_connexions (id, user_id, etablissement) values (1, '${A}', 'Banque A'); insert into public.banque_comptes (id, user_id, connexion_id, nom, type) values (10, '${A}', 1, 'Compte A', 'courant');`);
  await session(A);
  const r = await importer(apresReleves(m(), { compte: { ...COMPTE_B1, cle: "rattache", libelle: "Compte rattaché", banque_compte_id: 10, position_id: pos } }));
  assert.equal(r.mois, 1);
  const c = await un(`select banque_compte_id::int b, position_id p from public.historique_comptes where cle = 'rattache'`);
  assert.deepEqual([c.b, c.p], [10, pos]);
  // 40 comptes
  await superu();
  const n0 = (await un(`select count(*)::int n from public.historique_comptes where user_id = '${A}'`)).n;
  await db.exec(`insert into public.historique_comptes (user_id, libelle, etablissement, type, titulaire, cle)
    select '${A}', 'Compte ' || g, 'lcl', 'courant', 'p1', 'lim-' || g from generate_series(1, ${40 - n0}) g`);
  await session(A);
  await echoue(apresReleves(m(), { compte: { ...COMPTE_B1, cle: "quarante-et-unieme" } }), /Limite atteinte : 40 comptes au plus/, "40 comptes");
  const ok = await importer(apresReleves(m(), { compte: { ...COMPTE_B1, cle: "rattache" } }), { ref: randomUUID() });
  assert.equal(ok.mois_remplaces, 1, "un compte existant se retrouve par sa clé même à 40 comptes");
  // 300 imports
  await superu();
  const nImp = (await un(`select count(*)::int n from public.historique_imports where user_id = '${A}'`)).n;
  await db.exec(`insert into public.historique_imports (user_id, type, empreinte, etablissement, periode_du, periode_au, source)
    select '${A}', 'ordres', encode(sha256(convert_to('lim' || g, 'UTF8')), 'hex'), 'lcl', '2024-01-01', '2024-01-02', 'source' from generate_series(1, ${300 - nImp}) g`);
  await session(A);
  await echoue(apresReleves(m(), { compte: { ...COMPTE_B1, cle: "rattache" } }), /Limite atteinte : 300 imports au plus/, "300 imports");
  await superu();
  await db.exec(`delete from public.historique_imports where user_id = '${A}' and type = 'ordres' and source = 'source'; delete from public.historique_comptes where user_id = '${A}' and cle like 'lim-%';`);
  await session(A);
});

/* ------------------------------------------------------------------------------------------------------------- import d'ordres */
test("ordres P1 : trois ordres sur une ligne cotée sont insérés avec leur import, leur clé, leurs frais ; la quantité d'aujourd'hui n'est jamais touchée", async () => {
  await session(A);
  const pos = await ligne("ETF Monde A", { isin: ETF_A, qty: 15 });
  const mouvements = [achat("2024-01-08", 10, 95, 1, { position_id: pos }), achat("2024-02-08", 10, 98, 1, { position_id: pos }), vente("2024-03-15", 5, 104, 1, { position_id: pos })];
  const apres = apresMouvements("ordres", mouvements);
  const v = await valider(apres);
  assert.equal(v.n, 1);
  const tx = await q(`select to_char(date, 'YYYY-MM-DD') d, type, qty::float q, price::float p, amount::float a, frais::float f, source, import_id, position_id, enveloppe, estime, cle_import from public.transactions where import_id = $1 order by date`, [v.ref]);
  assert.deepEqual(tx.map(t => [t.d, t.type, t.q, t.p, t.a, t.f]), [["2024-01-08", "achat", 10, 95, 950, 1], ["2024-02-08", "achat", 10, 98, 980, 1], ["2024-03-15", "vente", 5, 104, 520, 1]]);
  assert.ok(tx.every(t => t.source === "import" && t.position_id === pos && t.enveloppe === null && t.estime === false && /^[0-9a-f]{32}$/.test(t.cle_import)));
  assert.deepEqual(tx.map(t => t.cle_import), mouvements.map(m => m.cle_import));
  const imp = await un(`select type, enveloppe, compte_id, resume from public.historique_imports where id = $1`, [v.ref]);
  assert.deepEqual([imp.type, imp.enveloppe, imp.compte_id, imp.resume.mouvements_importes, imp.resume.mouvements_ignores], ["ordres", "PEA Exemple", null, 3, 0]);
  assert.equal(Number((await un(`select qty from public.positions where id = $1`, [pos])).qty), 15, "le présent n'est pas modifié");
  // idempotence : les mêmes clés dans un autre fichier sont ignorées (compte rendu dans le résumé)
  const r2 = await importer(apresMouvements("ordres", mouvements));
  assert.deepEqual([r2.mouvements, r2.ignores], [0, 3]);
  assert.equal((await un(`select count(*)::int n from public.transactions where position_id = $1`, [pos])).n, 3);
  // une clé nouvelle s'ajoute, les connues sont ignorées
  const r3 = await importer(apresMouvements("ordres", [...mouvements, achat("2024-04-08", 1, 100, 0, { position_id: pos })]));
  assert.deepEqual([r3.mouvements, r3.ignores], [1, 3]);
});

test("ordres, contrôles bloquants : quantité négative (P1-neg), relevé de titres ou quantité initiale qui relève la quantité, tolérance de montant, devise, valeurs, dates, types, clés", async () => {
  await session(A);
  const pos = await ligne("ETF Monde B", { isin: isinFictif(2), qty: 15 });
  const P = { position_id: pos };
  // P1-neg : vente de 25 parts alors que 20 seulement ont été achetées
  await echoue(apresMouvements("ordres", [achat("2024-01-08", 10, 95, 1, P), achat("2024-02-08", 10, 98, 1, P), vente("2024-03-15", 25, 104, 1, P)]),
    /quantité négative le 15\/03\/2024 pour « ETF Monde B #\d+ » : il manque des achats ou une quantité initiale/, "P1-neg");
  // P-quantite-initiale-absente puis P-quantite-initiale : un relevé de titres de 10 parts au 31/12/2023 permet la vente de 3
  await echoue(apresMouvements("ordres", [vente("2024-03-01", 3, 20, 1, P)]), /quantité négative le 01\/03\/2024/, "P-quantite-initiale-absente");
  const ok = await importer(apresMouvements("ordres", [mv({ date: "2023-12-31", type: "releve", qty: 10, ...P }), vente("2024-03-01", 3, 20, 1, P)]));
  assert.equal(ok.mouvements, 2, "P-quantite-initiale");
  // une vente le même jour qu'un achat n'est jamais vue comme négative (les entrées passent avant les sorties du jour)
  const pos2 = await ligne("ETF Monde B 2", { isin: isinFictif(2), qty: 1 });
  assert.equal((await importer(apresMouvements("ordres", [vente("2024-05-02", 4, 10, 0, { position_id: pos2 }), achat("2024-05-02", 4, 10, 0, { position_id: pos2 })]))).mouvements, 2);
  const un_ordre = (o, pos_ = pos) => apresMouvements("ordres", [achat("2024-06-03", 10, 95, 1, { position_id: pos_, ...o })]);
  // montant : P-montant-tolerance (954 pour 950 : 0,42 % < 0,5 %), P-montant refusé (956)
  assert.equal((await importer(un_ordre({ amount: 954 }))).mouvements, 1, "P-montant-tolerance");
  await echoue(un_ordre({ amount: 956 }), /le montant \(956\) ne correspond pas à quantité × prix \(950\), tolérance max\(1 €; 0,5 %\)/, "P-montant");
  assert.equal((await importer(apresMouvements("ordres", [achat("2024-06-04", 1, 100, 0, { position_id: pos, amount: 100.9 })]))).mouvements, 1, "1 € de tolérance");
  const sansMontant = await importer(apresMouvements("ordres", [mv({ date: "2024-06-05", type: "achat", qty: 3, price: 33.333, position_id: pos })]));
  assert.equal(Number((await un(`select amount from public.transactions where import_id = $1`, [sansMontant.import_id])).amount), 100, "montant absent : quantité × prix arrondi");
  await echoue(un_ordre({ devise: "USD" }), /seul l'euro est accepté/, "P-devise");
  assert.equal((await importer(un_ordre({ devise: "eur", date: "2024-06-06" }))).mouvements, 1, "EUR accepté");
  await echoue(un_ordre({ qty: 0 }), /quantité supérieure à 0 attendue/, "quantité nulle");
  await echoue(un_ordre({ qty: -1 }), /qty : valeur hors limites/, "quantité négative");
  await echoue(un_ordre({ price: 0 }), /prix supérieur à 0 attendu/, "prix nul");
  await echoue(un_ordre({ price: undefined }), /prix supérieur à 0 attendu/, "prix absent");
  await echoue(un_ordre({ frais: -1 }), /frais : valeur hors limites/, "frais négatifs");
  await echoue(un_ordre({ qty: "10" }), /qty : nombre attendu/, "quantité en texte");
  await echoue(apresMouvements("ordres", [achat("2024-06-03", 10, 95, 1, { position_id: pos, date: "1989-12-31" })], { extra: { periode: { du: "2024-01-01", au: "2024-06-30" } } }), /date hors du 1990-01-01 à aujourd'hui/, "P-date-ancienne");
  await echoue(apresMouvements("ordres", [achat("2024-06-03", 10, 95, 1, { position_id: pos, date: "2999-01-01" })], { extra: { periode: { du: "2024-01-01", au: "2024-06-30" } } }), /date hors du 1990-01-01 à aujourd'hui/, "P-date-future");
  await echoue(apresMouvements("ordres", [achat("2024-06-03", 10, 95, 1, { position_id: pos, date: "2024-02-30" })], { extra: { periode: { du: "2024-01-01", au: "2024-06-30" } } }), /date invalide/, "date impossible");
  await echoue(un_ordre({ type: "versement" }), /type « versement » non admis pour cet import \(achat, vente, releve\)/, "type d'un autre import");
  await echoue(un_ordre({ type: "programme" }), /type « programme » non admis/, "programme réservé à la nuit");
  await echoue(un_ordre({ type: "solde" }), /type « solde » non admis/, "solde réservé à l'app");
  await echoue(un_ordre({ cle_import: "XYZ" }), /cle_import invalide/, "clé d'import");
  await echoue(apresMouvements("ordres", [achat("2024-06-03", 1, 1, 0, { position_id: pos, cle_import: "a".repeat(32) }), achat("2024-06-04", 1, 1, 0, { position_id: pos, cle_import: "a".repeat(32) })]), /cle_import .* en double/, "clé en double");
  await echoue(un_ordre({ extra: 1 }), /mouvement : champ « extra » inconnu/, "champ en trop");
  await echoue(un_ordre({ position_id: randomUUID() }), /ligne introuvable/, "ligne inconnue");
  await echoue(un_ordre({ position_id: undefined }), /une ligne est attendue/, "ordre sans ligne");
  await echoue(un_ordre({ position_id: undefined, isin: ETF_C }), /ISIN .* sans ligne/, "ISIN sans ligne à créer");
  await echoue(un_ordre({ note: "FR7630006000011234567890189" }), /note : contenu sensible/, "note sensible");
  await echoue(un_ordre({ estime: "oui" }), /estime \(vrai ou faux\) attendu/, "estime non booléen");
  await echoue(apresMouvements("ordres", [releveSansValeur(pos)]), /une quantité ou une valeur est attendue/, "relevé vide");
  await echoue(apresMouvements("ordres", [], { extra: { periode: { du: "2024-01-01", au: "2024-01-02" } } }), /1 à 600 mouvements attendus/, "aucun mouvement");
  await echoue(apresMouvements("ordres", Array.from({ length: 601 }, (_, i) => achat("2024-07-01", 1, 1, 0, { position_id: pos, cle_import: String(i).padStart(32, "0") }))), /1 à 600 mouvements attendus/, "601 mouvements");
  await echoue(apresMouvements("ordres", [achat("2024-06-03", 1, 1, 0, { position_id: pos })], { enveloppe: "PEA 123456789" }), /enveloppe : une suite de 8 chiffres/, "numéro dans l'enveloppe");
  await echoue({ ...apresMouvements("ordres", [achat("2024-06-03", 1, 1, 0, { position_id: pos })]), compte: COMPTE_B1 }, /compte non attendu/, "compte pour des ordres");
  await echoue({ ...apresMouvements("ordres", [achat("2024-06-03", 1, 1, 0, { position_id: pos })]), enveloppe: undefined }, /enveloppe : texte attendu/, "enveloppe absente");
  await echoue({ ...apresMouvements("ordres", [achat("2024-06-03", 1, 1, 0, { position_id: pos })]), donnees: { mois: [] } }, /donnees : champ « mois » inconnu \(mouvements\)/, "mois pour des ordres");
  // ligne d'un autre utilisateur
  await session(B);
  await echoue(apresMouvements("ordres", [achat("2024-06-03", 1, 1, 0, { position_id: pos })]), /ligne introuvable/, "ligne de A");
  await session(A);
  function releveSansValeur(p) { return mv({ date: "2024-06-03", type: "releve", position_id: p }); }
});

test("ordres P-cloturee : le titre vendu depuis devient une ligne clôturée créée par l'import (instrument compris), retrouvée au second import, supprimée seulement quand plus rien ne la porte", async () => {
  await session(A);
  const ligneC = { isin: ETF_C, name: "ETF Europe C", envelope: "PEA Exemple", owner: "p1" };
  const o1 = [achat("2024-02-12", 6, 40, 1, { isin: ETF_C }), vente("2024-05-13", 6, 45, 1, { isin: ETF_C })];
  const v1 = await valider(apresMouvements("ordres", o1, { extra: { lignes_a_creer: [ligneC] } }));
  const l = await q(`select id, name, envelope, owner, mode, isin, qty::float q, status from public.positions where isin = $1 and user_id = '${A}'`, [ETF_C]);
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].name, l[0].envelope, l[0].owner, l[0].mode, l[0].q, l[0].status], ["ETF Europe C", "PEA Exemple", "p1", "market", 0, "clôturé"]);
  assert.equal((await q(`select 1 from public.instruments where isin = $1`, [ETF_C])).length, 1, "instrument créé");
  assert.deepEqual((await un(`select lignes_creees l from public.historique_imports where id = $1`, [v1.ref])).l, [l[0].id]);
  assert.equal((await un(`select count(*)::int n from public.transactions where position_id = $1 and import_id = $2`, [l[0].id, v1.ref])).n, 2);
  // P-cloturee-reimport : d'autres ordres du même titre retrouvent la ligne, n'en créent pas de seconde
  const v2 = await valider(apresMouvements("ordres", [achat("2024-07-01", 2, 50, 0, { isin: ETF_C }), vente("2024-07-02", 2, 51, 0, { isin: ETF_C })], { extra: { lignes_a_creer: [ligneC] } }));
  assert.equal((await un(`select count(*)::int n from public.positions where isin = $1 and user_id = '${A}'`, [ETF_C])).n, 1);
  assert.deepEqual((await un(`select lignes_creees l from public.historique_imports where id = $1`, [v2.ref])).l, [], "le second import n'a rien créé");
  // retirer le premier : la ligne porte encore les mouvements du second, elle reste
  const r1 = (await un(`select public.retirer_import($1) r`, [v1.ref])).r;
  assert.deepEqual([r1.mouvements_retires, r1.lignes_supprimees], [2, 0]);
  assert.equal((await un(`select count(*)::int n from public.positions where isin = $1 and user_id = '${A}'`, [ETF_C])).n, 1);
  // la ligne passe au dernier import qui la porte encore : le retirer la supprime à son tour
  assert.deepEqual((await un(`select lignes_creees l from public.historique_imports where id = $1`, [v2.ref])).l, [l[0].id]);
  const r2 = (await un(`select public.retirer_import($1) r`, [v2.ref])).r;
  assert.deepEqual([r2.mouvements_retires, r2.lignes_supprimees], [2, 1]);
  assert.equal((await un(`select count(*)::int n from public.positions where isin = $1 and user_id = '${A}'`, [ETF_C])).n, 0, "plus rien ne porte la ligne clôturée créée par l'import : supprimée");
  // un import qui crée puis qu'on retire emporte sa ligne
  const v3 = await valider(apresMouvements("ordres", [achat("2024-02-12", 3, 40, 1, { isin: ETF_D }), vente("2024-05-13", 3, 45, 1, { isin: ETF_D })],
    { extra: { lignes_a_creer: [{ isin: ETF_D, name: "Action Exemple D", envelope: "CTO Exemple", owner: "p1" }] } }));
  assert.equal((await un(`select count(*)::int n from public.positions where isin = $1`, [ETF_D])).n, 1);
  const r3 = (await un(`select public.retirer_import($1) r`, [v3.ref])).r;
  assert.deepEqual([r3.mouvements_retires, r3.lignes_supprimees], [2, 1]);
  assert.equal((await un(`select count(*)::int n from public.positions where isin = $1`, [ETF_D])).n, 0, "ligne clôturée créée par l'import, sans autre transaction : supprimée");
  // une ligne créée par l'import qui a ensuite d'autres transactions est conservée
  const v4 = await valider(apresMouvements("ordres", [achat("2024-02-12", 3, 40, 1, { isin: ETF_D })], { extra: { lignes_a_creer: [{ isin: ETF_D, name: "Action Exemple D", envelope: "CTO Exemple", owner: "p1" }] } }));
  const pD = (await un(`select id from public.positions where isin = $1`, [ETF_D])).id;
  await db.query(`insert into public.transactions (user_id, position_id, date, type, qty, source) values ($1, $2, '2024-09-01', 'achat', 1, 'manuel')`, [A, pD]);
  const r4 = (await un(`select public.retirer_import($1) r`, [v4.ref])).r;
  assert.deepEqual([r4.mouvements_retires, r4.lignes_supprimees], [1, 0], "une saisie sur la ligne : conservée");
  await db.exec(`delete from public.positions where id = '${pD}'`);
  // refus : ISIN de la ligne à créer faux, en double, owner inconnu, ligne déjà portée sans position
  const m1 = [achat("2024-02-12", 3, 40, 1, { isin: ETF_D })];
  await echoue(apresMouvements("ordres", m1, { extra: { lignes_a_creer: [{ ...ligneC, isin: "FR9990000014" }] } }), /ISIN « FR9990000014 » invalide \(format ou clé de contrôle\)/, "P1-isin");
  await echoue(apresMouvements("ordres", m1, { extra: { lignes_a_creer: [ligneC, ligneC] } }), /ISIN .* en double/, "ISIN en double");
  await echoue(apresMouvements("ordres", m1, { extra: { lignes_a_creer: [{ ...ligneC, owner: "p3" }] } }), /owner invalide/, "owner");
  await echoue(apresMouvements("ordres", m1, { extra: { lignes_a_creer: [{ ...ligneC, name: "Titre 123456789" }] } }), /suite de 8 chiffres/, "S-titre");
  await echoue(apresMouvements("ordres", m1, { extra: { lignes_a_creer: [{ ...ligneC, extra: 1 }] } }), /lignes_a_creer : champ « extra » inconnu/, "clé en trop");
  await echoue(apresMouvements("ordres", m1, { extra: { lignes_a_creer: Array.from({ length: 51 }, () => ligneC) } }), /50 lignes au plus/, "51 lignes");
});

/* ------------------------------------------------------------------------------------------------------------- import de versements */
test("versements P2-enveloppe : sans ligne d'espèces, un mouvement d'enveloppe (enveloppe renseignée, position_id nul) ; contrat d'assurance-vie A1 avec relevés de valeur ; rachat et frais", async () => {
  await session(A);
  const v = await valider(apresMouvements("versements", [mv({ date: "2024-01-05", type: "versement", amount: 1000 }), mv({ date: "2024-02-05", type: "versement", amount: 1000 })]));
  const tx = await q(`select to_char(date, 'YYYY-MM-DD') d, type, position_id, enveloppe, amount::float a from public.transactions where import_id = $1 order by date`, [v.ref]);
  assert.deepEqual(tx, [{ d: "2024-01-05", type: "versement", position_id: null, enveloppe: "PEA Exemple", a: 1000 }, { d: "2024-02-05", type: "versement", position_id: null, enveloppe: "PEA Exemple", a: 1000 }]);
  // enveloppe propre à un mouvement
  const w = await importer(apresMouvements("versements", [mv({ date: "2024-03-05", type: "versement", amount: 10, enveloppe: "PER Exemple" })]));
  assert.equal((await un(`select enveloppe from public.transactions where import_id = $1`, [w.import_id])).enveloppe, "PER Exemple");
  // A1 : ligne manuelle d'assurance-vie
  const av = await ligne("Assurance-vie Exemple", { envelope: "Assurance-vie Exemple", value: 6300 });
  const A1 = [mv({ date: "2023-03-01", type: "versement", amount: 5000, position_id: av }), mv({ date: "2024-06-01", type: "versement", amount: 1000, position_id: av }),
    mv({ date: "2023-12-31", type: "releve", amount: 5120, position_id: av }), mv({ date: "2024-12-31", type: "releve", amount: 6300, position_id: av })];
  const a = await valider(apresMouvements("versements", A1, { enveloppe: "Assurance-vie Exemple", etablissement: "linxea" }));
  assert.equal(a.n, 1);
  assert.deepEqual((await q(`select type, count(*)::int n from public.transactions where import_id = $1 group by type order by type`, [a.ref])), [{ type: "releve", n: 2 }, { type: "versement", n: 2 }]);
  assert.equal(Number((await un(`select amount from public.transactions where import_id = $1 and type = 'releve' order by date desc limit 1`, [a.ref])).amount), 6300, "valeur du relevé");
  assert.equal(Number((await un(`select value from public.positions where id = $1`, [av])).value), 6300, "la valeur d'aujourd'hui n'est pas touchée");
  // V-rachat-frais
  const av2 = await ligne("Assurance-vie Exemple 2", { envelope: "Assurance-vie Exemple 2", value: 8300 });
  const r = await importer(apresMouvements("versements", [mv({ date: "2022-01-10", type: "versement", amount: 10000, position_id: av2 }), mv({ date: "2023-03-31", type: "frais", amount: 30, position_id: av2 }),
    mv({ date: "2023-06-15", type: "rachat", amount: 2000, position_id: av2 }), mv({ date: "2022-12-31", type: "releve", amount: 10150, position_id: av2 })], { enveloppe: "Assurance-vie Exemple 2" }));
  assert.equal(r.mouvements, 4, "V-rachat-frais");
  // arbitrage et dividende avec une quantité
  const etf = await ligne("ETF Monde A 3", { isin: ETF_A, qty: 5 });
  assert.equal((await importer(apresMouvements("versements", [mv({ date: "2024-01-01", type: "arbitrage_entree", amount: 100, qty: 2, position_id: etf }), mv({ date: "2024-02-01", type: "dividende", amount: 5, position_id: etf })]))).mouvements, 2);
  // refus
  const base = (o) => apresMouvements("versements", [mv({ date: "2024-01-05", type: "versement", amount: 100, ...o })]);
  await echoue(base({ amount: 0 }), /montant supérieur à 0 attendu/, "montant nul");
  await echoue(base({ amount: undefined }), /montant supérieur à 0 attendu/, "montant absent");
  await echoue(base({ type: "achat" }), /type « achat » non admis pour cet import/, "ordre dans les versements");
  await echoue(base({ type: "programme" }), /type « programme » non admis/, "programme");
  await echoue(base({ qty: 0 }), /quantité supérieure à 0 attendue/, "quantité nulle");
  await echoue(base({ devise: "GBP" }), /seul l'euro/, "devise");
  await echoue(base({ type: "releve", amount: undefined }), /une quantité ou une valeur est attendue/, "relevé vide");
  assert.equal((await importer(base({ type: "releve", amount: 0, date: "2024-01-06" }))).mouvements, 1, "valeur nulle d'un relevé acceptée");
  assert.equal((await importer(base({ estime: true, date: "2024-01-07" }))).mouvements, 1);
  assert.equal((await un(`select estime from public.transactions where date = '2024-01-07' and enveloppe = 'PEA Exemple' limit 1`)).estime, true, "estime conservé");
});

/* ------------------------------------------------------------------------------------------------------------- doublons */
test("doublons D1 : le versement programmé de la nuit remplacé par l'ordre réel (doublon_de), levé par le retrait ; seules les saisies et les programmes de la nuit sont remplaçables", async () => {
  await session(A);
  const etf = await ligne("ETF Monde A D1", { isin: ETF_A, qty: 5.02512563 });
  await superu();
  const nuit = (await un(`insert into public.transactions (user_id, position_id, date, type, qty, price, amount, source) values ('${A}', '${etf}', '2026-09-05', 'programme', 5.02512563, 99.5, 500, 'nightly') returning id`)).id;
  const saisie = (await un(`insert into public.transactions (user_id, position_id, date, type, qty, source) values ('${A}', '${etf}', '2026-08-01', 'achat', 1, 'manuel') returning id`)).id;
  const autre = (await un(`insert into public.transactions (user_id, position_id, date, type, qty, source) values ('${A}', '${etf}', '2026-07-01', 'achat', 1, 'banque') returning id`)).id;
  await db.exec(`insert into public.positions (id, user_id, name, envelope, owner, mode, value) values ('${randomUUID()}', '${B}', 'Ligne de B', 'PEA', 'p1', 'manual', 1)`);
  const txB = (await un(`insert into public.transactions (user_id, position_id, date, type, qty, source) select '${B}', id, '2026-09-05', 'programme', 1, 'nightly' from public.positions where user_id = '${B}' limit 1 returning id`)).id;
  await session(A);
  const m = achat("2026-09-08", 5, 99.8, 1, { position_id: etf, amount: 499 });
  m.amount = 499;
  const apres = apresMouvements("ordres", [m], { extra: { doublons: [{ transaction_id: nuit, mouvement_cle: m.cle_import }] } });
  // refus : transaction d'un autre utilisateur, source non remplaçable, mouvement inconnu, identifiant invalide
  await echoue({ ...apres, doublons: [{ transaction_id: txB, mouvement_cle: m.cle_import }] }, /n'est pas une saisie ou un versement programmé remplaçable/, "transaction de B");
  await echoue({ ...apres, doublons: [{ transaction_id: autre, mouvement_cle: m.cle_import }] }, /remplaçable/, "source banque");
  await echoue({ ...apres, doublons: [{ transaction_id: nuit, mouvement_cle: "f".repeat(32) }] }, /mouvement « f+ » introuvable/, "mouvement inconnu");
  await echoue({ ...apres, doublons: [{ transaction_id: "x", mouvement_cle: m.cle_import }] }, /transaction_id invalide/, "identifiant");
  await echoue({ ...apres, doublons: [{ transaction_id: nuit, mouvement_cle: m.cle_import, extra: 1 }] }, /doublons : champ « extra » inconnu/, "clé en trop");
  assert.equal((await un(`select doublon_de d from public.transactions where id = $1`, [nuit])).d, null, "les refus n'ont rien posé");
  const v = await valider(apres);
  assert.equal(v.n, 1);
  const neuf = (await un(`select id from public.transactions where import_id = $1`, [v.ref])).id;
  assert.equal((await un(`select doublon_de d from public.transactions where id = $1`, [nuit])).d, neuf, "la nuit est un doublon de l'ordre réel");
  assert.equal((await un(`select resume->>'doublons_remplaces' n from public.historique_imports where id = $1`, [v.ref])).n, "1");
  // un doublon déjà posé, ou une transaction importée, n'est plus remplaçable
  const m3 = achat("2026-09-09", 1, 99, 0, { position_id: etf });
  await echoue(apresMouvements("ordres", [m3], { extra: { doublons: [{ transaction_id: nuit, mouvement_cle: m3.cle_import }] } }), /remplaçable/, "déjà doublon");
  const m2 = achat("2026-09-10", 1, 99, 0, { position_id: etf });
  await echoue(apresMouvements("ordres", [m2], { extra: { doublons: [{ transaction_id: neuf, mouvement_cle: m2.cle_import }] } }), /remplaçable/, "transaction importée");
  // le retrait de l'import fait revenir la transaction de la nuit
  await db.query(`select public.retirer_import($1)`, [v.ref]);
  assert.equal((await un(`select doublon_de d from public.transactions where id = $1`, [nuit])).d, null, "doublon_de revient à nul");
  assert.equal((await q(`select 1 from public.transactions where id = $1`, [nuit])).length, 1, "la transaction de la nuit est intacte");
  await superu(); await db.exec(`delete from public.transactions where user_id = '${B}'; delete from public.positions where user_id = '${B}'`); await session(A);
});

test("quantité cumulée : la transaction de la nuit remplacée (doublon_de) n'est pas comptée deux fois dans le contrôle « jamais négative »", async () => {
  await session(A);
  const etf = await ligne("ETF Monde A cumul", { isin: ETF_A, qty: 0 });
  await superu();
  const nuit = (await un(`insert into public.transactions (user_id, position_id, date, type, qty, amount, source) values ('${A}', '${etf}', '2026-09-05', 'programme', 5.0251, 500, 'nightly') returning id`)).id;
  await session(A);
  const ach = achat("2026-09-08", 5, 99.8, 1, { position_id: etf });
  // sans doublon posé : 5,0251 + 5 = 10,0251 parts, la vente de 10 passe ; avec le doublon : 5 parts, la même vente est refusée
  await echoue(apresMouvements("ordres", [ach, vente("2026-09-20", 10, 100, 0, { position_id: etf })], { extra: { doublons: [{ transaction_id: nuit, mouvement_cle: ach.cle_import }] } }), /quantité négative le 20\/09\/2026/, "doublon écarté du cumul");
  const ach2 = achat("2026-09-08", 5, 99.8, 1, { position_id: etf });
  assert.equal((await importer(apresMouvements("ordres", [ach2, vente("2026-09-20", 10, 100, 0, { position_id: etf })]))).mouvements, 2, "sans doublon posé");
  await superu(); await db.exec(`delete from public.transactions where position_id = '${etf}'`); await session(A);
});

/* ------------------------------------------------------------------------------------------------------------- retrait et propositions */
test("retirer_import : aal2 et jeton sans client_id obligatoires, import d'un autre ou inconnu refusé, message clair sans second facteur", async () => {
  await session(A);
  const v = await valider(apresMouvements("versements", [mv({ date: "2024-01-05", type: "versement", amount: 10 })]));
  await session(A, "aal1");
  await refuse(`select public.retirer_import('${v.ref}')`, /Double authentification requise/, "aal1");
  await session(A, "aucun");
  await refuse(`select public.retirer_import('${v.ref}')`, /Double authentification requise/, "sans revendication");
  await session(A, "aal1", { client: CLIENT, sess: SESSION });
  await refuse(`select public.retirer_import('${v.ref}')`, /Un connecteur ne peut pas/, "connecteur autorisé");
  await session(A, "aal2", { client: CLIENT, sess: SESSION });
  await refuse(`select public.retirer_import('${v.ref}')`, /Un connecteur ne peut pas/, "jeton OAuth aal2");
  await session(B);
  await refuse(`select public.retirer_import('${v.ref}')`, /introuvable/, "import de A");
  await session(A);
  await refuse(`select public.retirer_import('${randomUUID()}')`, /introuvable/, "import inconnu");
  assert.equal((await nbTx(v.ref)), 1, "rien n'a été retiré");
  const r = (await un(`select public.retirer_import($1) r`, [v.ref])).r;
  assert.equal(r.mouvements_retires, 1);
  assert.equal((await q(`select 1 from public.historique_imports where id = $1`, [v.ref])).length, 0);
  // l'import ne peut pas non plus être déposé puis appliqué en aal1 ni par un connecteur
  await session(A, "aal1");
  await refuse(`select public.historique_appliquer('${randomUUID()}', '{}'::jsonb, 'x')`, /Double authentification requise/, "import en aal1");
  await session(A);
});

test("proposition supprimer : appliquer_propositions retire l'import désigné par ref ; modifier est impossible ; les modifications de l'utilisateur sont ignorées (non modifiable avant validation)", async () => {
  await session(A);
  const v = await valider(apresMouvements("versements", [mv({ date: "2024-01-05", type: "versement", amount: 10 })]));
  const s = await valider(null, { ref: v.ref, operation: "supprimer" });
  assert.equal(s.n, 1);
  assert.equal((await q(`select 1 from public.historique_imports where id = $1`, [v.ref])).length, 0);
  assert.equal((await un(`select statut from public.propositions where id = $1`, [s.p])).statut, "acceptee");
  await valider(null, { ref: v.ref, operation: "supprimer" }).then(() => assert.fail("accepté"), e => assert.match(e.message, /Proposition non appliquée \(import d'historique, supprimer\) : import « .* » introuvable/));
  // modifier : refusé par la base à l'insertion
  await refuse(`insert into public.propositions (cible, operation, ref, apres, source) values ('historique', 'modifier', '${randomUUID()}', '{}'::jsonb, 'x')`, /propositions_historique|check/, "modifier");
  // ref obligatoire et en forme d'uuid
  await refuse(`insert into public.propositions (cible, operation, apres, source) values ('historique', 'creer', '{}'::jsonb, 'x')`, /propositions_historique|check/, "sans ref");
  await refuse(`insert into public.propositions (cible, operation, ref, apres, source) values ('historique', 'creer', 'pas-un-uuid', '{}'::jsonb, 'x')`, /propositions_historique|check/, "ref invalide");
  // une modification fournie à la validation est ignorée : l'import appliqué est celui qui a été déposé
  const m = mv({ date: "2024-01-05", type: "versement", amount: 10 });
  const depose = apresMouvements("versements", [m]);
  const p = (await un(`insert into public.propositions (cible, operation, ref, apres, source) values ('historique', 'creer', $1, $2::jsonb, 'x') returning id`, [randomUUID(), JSON.stringify(depose)])).id;
  const truque = apresMouvements("versements", [{ ...m, amount: 9999 }]);
  await db.query(`select public.appliquer_propositions($1::uuid[], $2::jsonb)`, [[p], JSON.stringify({ [p]: truque })]);
  assert.equal(Number((await un(`select amount from public.transactions where cle_import = $1`, [m.cle_import])).amount), 10, "la modification de l'utilisateur est ignorée");
  assert.deepEqual((await un(`select apres->'donnees'->'mouvements'->0->>'amount' a from public.propositions where id = $1`, [p])).a, "10");
});

test("propositions : apres jusqu'à 100 000 octets pour un import, 20 000 pour les autres cibles (inchangé), 400 000 pour un plan figé", async () => {
  await session(A);
  const gros = n => ({ type: "releves", resume: { x: "y".repeat(n) } });
  const ins = (cible, apres, op = "creer", ref = null) => db.query(`insert into public.propositions (cible, operation, ref, apres, source) values ($1, $2, $3, $4::jsonb, 'x')`, [cible, op, ref, JSON.stringify(apres)]);
  await ins("historique", gros(90000), "creer", randomUUID());
  await assert.rejects(ins("historique", gros(100100), "creer", randomUUID()), /propositions_apres_check|check/, "100 000 octets au plus");
  await assert.rejects(ins("budget", gros(25000), "creer"), /propositions_apres_check|check/, "20 000 octets pour les autres cibles");
  await ins("budget", gros(15000), "creer");
  await ins("historique", { type: "releves" }, "supprimer", randomUUID());
  await db.exec(`delete from public.propositions where user_id = '${A}'`);
});

/* ------------------------------------------------------------------------------------------------------------- export, suppression du compte */
test("export_all : les cinq tables de l'historique sortent pour A (aal2), vides en aal1, sans rien de A pour B ; les anciennes clés demeurent", async () => {
  await session(A);
  const x = (await un(`select public.export_all() j`)).j;
  for (const k of TABLES) assert.ok(Array.isArray(x[k]), k + " exporté");
  for (const k of ["historique_comptes", "historique_imports", "historique_releves", "historique_banque_mois", "photos_reconstituees"]) assert.ok(x[k].length >= 1, k + " : lignes de A");
  assert.ok(x.historique_comptes.every(c => c.user_id === A));
  for (const k of ["profile", "biens", "credits", "positions", "transactions", "snapshots", "config", "status", "budget", "objectifs", "propositions", "connexions_assistant", "memoire_agent", "journal", "routines",
    "fonctionnalites", "banque_connexions", "banque_comptes", "banque_placements", "banque_operations", "banque_mois", "foyer_evenements", "foyer_variantes", "plans_figes", "connecteurs_autorises"]) assert.ok(k in x, k + " toujours exporté");
  assert.ok(x.transactions.some(t => t.import_id), "les nouvelles colonnes de transactions sortent");
  assert.ok(x.status.some(s => "historique_a_recalculer" in s));
  await session(A, "aal1");
  const vide = (await un(`select public.export_all() j`)).j;
  for (const k of TABLES) assert.deepEqual(vide[k], [], k + " : vide en aal1");
  await session(A, "aal1", { client: CLIENT, sess: SESSION });
  await refuse(`select public.export_all()`, /Un connecteur ne peut pas exporter/, "export par le connecteur");
  await session(B);
  const xb = JSON.stringify((await un(`select public.export_all() j`)).j);
  assert.ok(!xb.includes(A) && !xb.includes(compteId), "B n'exporte rien de A");
  await superu();
});

test("suppression du compte : delete_me() emporte les cinq tables, les mouvements importés et les lignes créées (cascade depuis auth.users) ; les autres comptes restent intacts", async () => {
  await session(D);
  await superu();
  await db.exec(`insert into public.instruments (isin, name) values ('${ETF_D}', 'x'), ('${ETF_A}', 'x') on conflict (isin) do nothing`);
  await session(D);
  await importer(apresReleves(moisDe("B1", "2024-01"), { compte: { ...COMPTE_B1, cle: "compte-d" } }));
  const posD = await (async () => { await superu(); const r = await un(`insert into public.positions (user_id, name, envelope, owner, mode, isin, qty) values ('${D}', 'ETF D', 'PEA', 'p1', 'market', '${ETF_A}', 3) returning id`); await session(D); return r.id; })();
  await importer(apresMouvements("ordres", [achat("2024-01-08", 3, 95, 1, { position_id: posD })], { extra: { lignes_a_creer: [{ isin: ETF_D, name: "Action D", envelope: "PEA", owner: "p1" }] } }));
  await superu();
  await db.exec(`insert into public.photos_reconstituees (user_id, mois, date, total, p1, p2, financier, net, qualite, part_estimee, methode) values ('${D}', '2024-01-01', '2024-01-31', 1, 1, 0, 1, 1, 'estime', 1, 'x')`);
  for (const t of TABLES) assert.ok((await q(`select 1 from public.${t} where user_id = $1`, [D])).length >= 1, t + " : lignes de D avant");
  assert.ok((await q(`select 1 from public.transactions where user_id = $1 and import_id is not null`, [D])).length);
  const avantA = (await un(`select (select count(*)::int from public.historique_comptes where user_id = '${A}') c, (select count(*)::int from public.historique_imports where user_id = '${A}') i`));
  await session(D, "aal1");
  await refuse(`select public.delete_me()`, /Double authentification requise/, "delete_me sans second facteur");
  await session(D);
  await db.exec(`select public.delete_me()`);
  await superu();
  for (const t of [...TABLES, "transactions", "positions", "status"]) assert.equal((await q(`select 1 from public.${t} where user_id = $1`, [D])).length, 0, t + " : plus rien pour D");
  assert.deepEqual(await un(`select (select count(*)::int from public.historique_comptes where user_id = '${A}') c, (select count(*)::int from public.historique_imports where user_id = '${A}') i`), avantA, "A est intact");
});

test("import par une session non authentifiée ou par service_role sans utilisateur : refusé (pas d'écriture au nom de personne)", async () => {
  await db.exec(`reset role; set test.uid = ''; set test.aal = 'aal2'; set role authenticated;`);
  await refuse(`select public.historique_appliquer('${randomUUID()}', '{}'::jsonb, 'x')`, /non authentifié/, "sans utilisateur");
  await refuse(`select public.retirer_import('${randomUUID()}')`, /non authentifié/, "retrait sans utilisateur");
  await refuse(`select public.appliquer_propositions('{}'::uuid[])`, /non authentifié/, "appliquer_propositions sans utilisateur");
  await superu();
});

/* ------------------------------------------------------------------------------------------------------------- revue de sécurité */
const E = "55555555-5555-5555-5555-555555555555", F = "66666666-6666-6666-6666-666666666666";

test("clés étrangères composites : jamais l'import, la transaction ni la ligne du bilan d'un autre (import_id, doublon_de, position_id d'un compte)", async () => {
  await superu();
  await db.exec(`insert into auth.users (id) values ('${E}'), ('${F}') on conflict do nothing;
    insert into auth.mfa_factors (user_id, status, created_at) values ('${E}', 'verified', now() - interval '1 day'), ('${F}', 'verified', now() - interval '1 day');`);
  const posF = (await un(`insert into public.positions (user_id, name, envelope, owner, bloc, mode, value) values ('${F}', 'Ligne F', 'PEA', 'p1', 'Monde', 'manual', 100) returning id`)).id;
  const posE = (await un(`insert into public.positions (user_id, name, envelope, owner, bloc, mode, value) values ('${E}', 'Ligne E', 'PEA', 'p1', 'Monde', 'manual', 100) returning id`)).id;
  const txF = (await un(`insert into public.transactions (user_id, position_id, date, type, amount, source) values ('${F}', '${posF}', '2024-01-02', 'versement', 10, 'manuel') returning id`)).id;
  const txE = (await un(`insert into public.transactions (user_id, position_id, date, type, amount, source) values ('${E}', '${posE}', '2024-01-02', 'versement', 10, 'manuel') returning id`)).id;
  await session(F);
  const impF = (await importer(apresMouvements("versements", [mv({ date: "2024-01-05", type: "versement", amount: 50, position_id: posF })]))).import_id;
  // E (aal2, propriétaire de ses lignes) tente de rattacher ses lignes à celles de F, dont il connaîtrait les uuid
  await session(E);
  await refuse(`insert into public.transactions (position_id, date, type, amount, import_id) values ('${posE}', '2024-01-03', 'versement', 1, '${impF}')`, /transactions_import/, "transactions.import_id d'un autre");
  await refuse(`update public.transactions set doublon_de = '${txF}' where id = '${txE}'`, /transactions_doublon_de/, "doublon_de vers la transaction d'un autre");
  await refuse(`insert into public.historique_comptes (libelle, etablissement, type, titulaire, cle, position_id) values ('Compte E', 'lcl', 'courant', 'p1', 'compte-e', '${posF}')`,
    /historique_comptes_position/, "historique_comptes.position_id d'un autre");
  const cptE = (await un(`insert into public.historique_comptes (libelle, etablissement, type, titulaire, cle, position_id) values ('Compte E', 'lcl', 'courant', 'p1', 'compte-e', '${posE}') returning id`)).id;
  await refuse(`insert into public.historique_releves (compte_id, mois, complet, total_entrees, total_sorties, import_id) values ('${cptE}', '2024-01-01', true, 0, 0, '${impF}')`,
    /historique_releves_import/, "historique_releves.import_id d'un autre");
  // les mêmes rattachements à ses propres lignes passent
  const txE2 = (await un(`insert into public.transactions (position_id, date, type, amount, source) values ('${posE}', '2024-01-04', 'versement', 1, 'manuel') returning id`)).id;
  await db.query(`update public.transactions set doublon_de = $1 where id = $2`, [txE2, txE]);
  await superu();
  const defs = Object.fromEntries((await q(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conname = any($1)`,
    [["transactions_import", "transactions_doublon_de", "historique_releves_import", "historique_comptes_position", "historique_imports_compte", "historique_releves_compte", "historique_comptes_banque"]])).map(r => [r.conname, r.d]));
  assert.match(defs.transactions_import, /FOREIGN KEY \(user_id, import_id\) REFERENCES historique_imports\(user_id, id\) ON DELETE CASCADE/);
  assert.match(defs.transactions_doublon_de, /FOREIGN KEY \(user_id, doublon_de\) REFERENCES transactions\(user_id, id\) ON DELETE SET NULL \(doublon_de\)/);
  assert.match(defs.historique_releves_import, /FOREIGN KEY \(user_id, import_id\) REFERENCES historique_imports\(user_id, id\) ON DELETE CASCADE/);
  assert.match(defs.historique_comptes_position, /FOREIGN KEY \(user_id, position_id\) REFERENCES positions\(user_id, id\) ON DELETE SET NULL \(position_id\)/);
  for (const k of ["historique_imports_compte", "historique_releves_compte", "historique_comptes_banque"]) assert.match(defs[k], /FOREIGN KEY \(user_id, /, k);
  // aucune clé étrangère simple vers une table personnelle depuis les tables de l'historique ni depuis les nouvelles colonnes
  const simples = await q(`select c.conname from pg_constraint c where c.contype = 'f' and c.conrelid = any(array['public.historique_comptes', 'public.historique_imports',
      'public.historique_releves', 'public.historique_banque_mois', 'public.photos_reconstituees']::regclass[]) and c.confrelid <> 'auth.users'::regclass and cardinality(c.conkey) = 1`);
  assert.deepEqual(simples, [], "clés étrangères simples");
  // la suppression de la transaction désignée remet doublon_de à nul sans toucher user_id
  await db.exec(`delete from public.transactions where id = '${txE2}'`);
  assert.deepEqual(await un(`select user_id, doublon_de from public.transactions where id = $1`, [txE]), { user_id: E, doublon_de: null });
  await session(F);
  await un(`select public.retirer_import($1) r`, [impF]);
  await superu();
  await db.exec(`delete from public.historique_comptes where user_id = '${E}'; delete from public.positions where user_id in ('${E}', '${F}');`);
});

test("connecteur : n'écrit, ne modifie ni ne supprime jamais un mouvement importé ou remplacé, ni import_id, cle_import ou doublon_de ; ses autres écritures de transactions restent possibles", async () => {
  const pos = await ligne("Ligne connecteur", { value: 1000 });
  const imp = (await importer(apresMouvements("versements", [mv({ date: "2024-02-05", type: "versement", amount: 50, position_id: pos })]))).import_id;
  const txImp = (await un(`select id from public.transactions where import_id = $1`, [imp])).id;
  await superu();
  const txNuit = (await un(`insert into public.transactions (user_id, position_id, date, type, amount, source) values ('${A}', '${pos}', '2024-02-06', 'programme', 50, 'nightly') returning id`)).id;
  const txRemp = (await un(`insert into public.transactions (user_id, position_id, date, type, amount, source, doublon_de) values ('${A}', '${pos}', '2024-02-05', 'programme', 50, 'nightly', '${txImp}') returning id`)).id;
  await session(A, "aal1", { client: CLIENT, sess: SESSION });
  const motif = /Un connecteur ne peut pas/;
  await refuse(`update public.transactions set amount = 999999 where id = '${txImp}'`, motif, "modifier un mouvement importé");
  await refuse(`delete from public.transactions where id = '${txImp}'`, motif, "supprimer un mouvement importé");
  await refuse(`update public.transactions set doublon_de = null where id = '${txRemp}'`, motif, "lever un remplacement");
  await refuse(`delete from public.transactions where id = '${txRemp}'`, motif, "supprimer une transaction remplacée");
  await refuse(`update public.transactions set doublon_de = '${txImp}' where id = '${txNuit}'`, motif, "poser un remplacement");
  await refuse(`update public.transactions set cle_import = '${hex(32)}' where id = '${txNuit}'`, motif, "poser une clé d'import");
  await refuse(`insert into public.transactions (position_id, date, type, amount, cle_import) values ('${pos}', '2024-02-07', 'versement', 1, '${hex(32)}')`, motif, "insérer avec une clé d'import");
  await refuse(`insert into public.transactions (position_id, date, type, amount, import_id) values ('${pos}', '2024-02-07', 'versement', 1, '${imp}')`, motif, "insérer dans un import");
  await refuse(`delete from public.positions where id = '${pos}'`, motif, "supprimer la ligne (cascade sur les mouvements importés)");
  // rien d'autre ne change : une transaction ordinaire s'écrit et se modifie comme avant (régime « si facteur », 0033)
  const libre = (await un(`insert into public.transactions (position_id, date, type, amount, source) values ('${pos}', '2024-02-08', 'versement', 5, 'mcp') returning id`)).id;
  await db.query(`update public.transactions set amount = 6 where id = $1`, [libre]);
  assert.equal((await db.query(`delete from public.transactions where id = $1`, [libre])).affectedRows, 1);
  await superu();
  assert.equal(Number((await un(`select amount from public.transactions where id = $1`, [txImp])).amount), 50, "le mouvement importé est intact");
  assert.equal((await un(`select doublon_de from public.transactions where id = $1`, [txRemp])).doublon_de, txImp);
  // l'app (aal2, sans client_id) retire l'import : la cascade et doublon_de remis à nul passent
  await session(A);
  await un(`select public.retirer_import($1) r`, [imp]);
  await superu();
  assert.equal((await un(`select doublon_de from public.transactions where id = $1`, [txRemp])).doublon_de, null);
  await db.exec(`delete from public.positions where id = '${pos}'`);
  await session(A);
});

test("contenu sensible : IBAN et numéros de carte écrits avec des espaces insécables, fines, invisibles ou des tirets refusés ; clé de compte et source sans numéro ; pas de faux positif sur un uuid du résumé", async () => {
  await superu();
  const t = (s, ch = 0) => un(`select public.historique_texte($1::jsonb, 'champ', 200, false, $2) v`, [JSON.stringify(s), ch]);
  const iban = "FR76 3000 6000 0112 3456 7890 189", carte = "4970 1012 3456 7890";
  for (const sep of [" ", " ", " ", " ", "　", "\t", "-", ".", "​"]) {
    await assert.rejects(t("IBAN " + iban.replaceAll(" ", sep)), /contenu sensible/, "IBAN, séparateur U+" + sep.codePointAt(0).toString(16));
    await assert.rejects(t("carte " + carte.replaceAll(" ", sep)), /contenu sensible/, "carte, séparateur U+" + sep.codePointAt(0).toString(16));
  }
  await assert.rejects(t("fr76 3000 6000 0112 3456 7890 189"), /contenu sensible/, "IBAN en minuscules aux espaces insécables");
  await assert.rejects(t("compte 1234​5678", 8), /suite de 8 chiffres/, "chiffres séparés par un caractère invisible");
  assert.equal((await t("ordre du 2024-01-15 à 12.50", 8)).v, "ordre du 2024-01-15 à 12.50", "dates et prix ordinaires acceptés");
  assert.equal((await t("Livret A 2024", 6)).v, "Livret A 2024");
  assert.equal((await un(`select public.historique_sensible($1, false) v`, [JSON.stringify({ lignes: ["12345678-1234-1234-1234-123456789012"], du: "2024-01-01" })])).v, false, "uuid à chiffres dans un résumé");
  assert.equal((await un(`select public.historique_sensible($1) v`, ["IE00B4L5Y983 Amundi"])).v, false, "un ISIN n'est pas un IBAN");
  const avant = (await un(`select count(*)::int n from public.historique_comptes where user_id = $1`, [A])).n;
  await session(A);
  // clé de compte : jamais de numéro (fonction et contrainte)
  await echoue(apresReleves(moisDe("B1", "2024-01"), { compte: { ...COMPTE_B1, cle: "boursobank|courant|00012345678|p1" } }), /compte\.cle : une suite de 6 chiffres/, "clé avec numéro de compte");
  await refuse(`insert into public.historique_comptes (libelle, etablissement, type, titulaire, cle) values ('Compte X', 'lcl', 'courant', 'p1', 'lcl|courant|00012345678|p1')`, /historique_comptes_cle/, "contrainte de la clé");
  await refuse(`insert into public.historique_comptes (libelle, etablissement, type, titulaire, cle) values ('Compte FR76 3000 6000 0112', 'lcl', 'courant', 'p1', 'k-nbsp')`, /historique_comptes_libelle/, "libellé aux espaces insécables");
  // source et résumé
  await echoue(apresReleves(moisDe("B1", "2024-01")), /source : une suite de 8 chiffres/, "source avec numéro", { source: "Relevé du compte 00012345678" });
  await echoue(apresReleves(moisDe("B1", "2024-01"), { extra: { resume: { note: "IBAN FR76 3000 6000 0112 3456 7890 189" } } }), /resume : contenu sensible/, "résumé aux espaces insécables");
  await superu();
  assert.equal((await un(`select count(*)::int n from public.historique_comptes where user_id = $1`, [A])).n, avant, "rien n'a été créé");
  await session(A);
});

test("lignes_a_creer : un symbole X- doit exister dans la table des instruments (l'import n'en invente pas)", async () => {
  await session(A);
  const mvt = [mv({ date: "2024-03-04", type: "achat", qty: 0.01, price: 50000, amount: 500, isin: "X-FICTIFHIS" })];
  const lignes = { lignes_a_creer: [{ isin: "X-FICTIFHIS", name: "Crypto fictive", envelope: "Crypto", owner: "p1" }] };
  await echoue(apresMouvements("ordres", mvt, { enveloppe: "Crypto", extra: lignes }), /symbole « X-FICTIFHIS » inconnu/, "symbole inconnu");
  await superu();
  assert.equal((await q(`select 1 from public.instruments where isin = 'X-FICTIFHIS'`)).length, 0, "aucun instrument créé");
  await db.exec(`insert into public.instruments (isin, name) values ('X-FICTIFHIS', 'Crypto fictive')`);
  await session(A);
  const r = await importer(apresMouvements("ordres", mvt, { enveloppe: "Crypto", extra: lignes }));
  assert.equal(r.lignes_creees.length, 1);
  await un(`select public.retirer_import($1) r`, [r.import_id]);
  await superu();
  await db.exec(`delete from public.instruments where isin = 'X-FICTIFHIS'`);
  await session(A);
});

test("photos : à 240 mois, la nuit peut encore remplacer un mois existant (insert … on conflict do update) ; un 241e mois reste refusé", async () => {
  await service();
  const ins = (mois, total) => db.query(`insert into public.photos_reconstituees (user_id, mois, date, total, p1, p2, financier, net, qualite, part_estimee, methode)
    values ($1, $2::date, ($2::date + interval '1 month - 1 day')::date, $3, 1, 0, 1, 1, 'estime', 1, 'x')
    on conflict (user_id, mois) do update set total = excluded.total`, [B, mois, total]);
  await db.query(`insert into public.photos_reconstituees (user_id, mois, date, total, p1, p2, financier, net, qualite, part_estimee, methode)
    select $1, m::date, (m::date + interval '1 month - 1 day')::date, 1, 1, 0, 1, 1, 'estime', 1, 'x' from generate_series('2000-01-01'::date, '2019-12-01'::date, interval '1 month') m`, [B]);
  await ins("2010-06-01", 42);
  assert.equal(Number((await un(`select total from public.photos_reconstituees where user_id = $1 and mois = '2010-06-01'`, [B])).total), 42);
  await assert.rejects(ins("2020-01-01", 1), /240 photos/);
  await db.exec(`delete from public.photos_reconstituees where user_id = '${B}'`);
  await superu();
});

test("import et retrait : un à la fois par utilisateur (verrou consultatif de transaction, les limites valent pour deux validations simultanées)", async () => {
  await superu();
  for (const f of ["historique_appliquer(text, jsonb, text)", "historique_retirer(uuid)"]) {
    const d = (await un(`select pg_get_functiondef($1::regprocedure) d`, ["public." + f])).d;
    assert.match(d, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\('historique:' \|\| v_uid::text, 0\)\)/, f);
  }
  const g = await un(`select p.prosecdef, pg_get_functiondef(p.oid) def from pg_proc p where p.oid = 'public.transactions_historique_garde()'::regprocedure`);
  assert.equal(g.prosecdef, false); assert.match(g.def, /set search_path to ''/i);
  for (const f of ["historique_sensible(text, boolean)"]) {
    const r = await un(`select has_function_privilege('anon', $1::regprocedure, 'execute') an, has_function_privilege('authenticated', $1::regprocedure, 'execute') au, p.provolatile v
      from pg_proc p where p.oid = $1::regprocedure`, ["public." + f]);
    assert.deepEqual(r, { an: false, au: true, v: "i" }, f);
  }
  await session(A);
});

test("propositions : un connecteur ne valide, ne refuse, ne décide ni ne retire jamais une proposition ; il ne change que le contenu d'une proposition en attente", async () => {
  await session(A, "aal1", { client: CLIENT, sess: SESSION });
  const depot = async (nom) => (await un(`insert into public.propositions (cible, operation, apres, source) values ('objectif', 'creer', $1::jsonb, 'Claude') returning id`,
    [JSON.stringify({ nom, montant: 1000, type: "projet" })])).id;
  const p1 = await depot("Voyage revue 1"), p2 = await depot("Voyage revue 2");
  const motif = /Un connecteur ne peut/;
  await refuse(`select public.appliquer_propositions(array['${p1}']::uuid[], '{}'::jsonb)`, motif, "appliquer_propositions par le connecteur");
  await refuse(`select public.refuser_propositions(array['${p1}']::uuid[])`, motif, "refuser_propositions par le connecteur");
  await refuse(`update public.propositions set statut = 'acceptee', decide_le = now() where id = '${p1}'`, motif, "statut écrit directement");
  await refuse(`update public.propositions set statut = 'refusee', decide_le = now() where id = '${p1}'`, motif, "refus écrit directement");
  await refuse(`update public.propositions set cible = 'budget' where id = '${p1}'`, motif, "cible");
  await refuse(`update public.propositions set operation = 'supprimer', ref = '${randomUUID()}' where id = '${p1}'`, motif, "opération et ref");
  await refuse(`update public.propositions set user_id = '${B}' where id = '${p1}'`, motif, "user_id");
  await refuse(`delete from public.propositions where id = '${p1}'`, motif, "retirer une proposition");
  await refuse(`insert into public.propositions (cible, operation, apres, source, statut, decide_le) values ('objectif', 'creer', '{"nom":"x","montant":1,"type":"projet"}', 'Claude', 'acceptee', now())`,
    /que des propositions en attente/, "déposer une proposition déjà acceptée");
  // le contenu d'une proposition en attente reste modifiable (l'app montre le contenu en vigueur à la validation)
  await db.query(`update public.propositions set apres = $1::jsonb, justification = 'corrigé' where id = $2`, [JSON.stringify({ nom: "Voyage revue 1 bis", montant: 1200, type: "projet" }), p1]);
  await superu();
  assert.equal((await un(`select statut from public.propositions where id = $1`, [p1])).statut, "en_attente");
  // l'utilisateur, dans l'app (aal2, sans client_id), valide et refuse
  await session(A);
  assert.equal((await un(`select public.appliquer_propositions(array['${p1}']::uuid[], '{}'::jsonb) n`)).n, 1);
  assert.equal((await un(`select public.refuser_propositions(array['${p2}']::uuid[]) n`)).n, 1);
  // une proposition décidée n'est plus modifiable par le connecteur
  await session(A, "aal1", { client: CLIENT, sess: SESSION });
  await refuse(`update public.propositions set apres = '{"nom":"y","montant":1,"type":"projet"}' where id = '${p1}'`, /déjà décidée/, "proposition décidée");
  await superu();
  assert.ok((await q(`select 1 from public.objectifs where user_id = $1 and nom = 'Voyage revue 1 bis'`, [A])).length, "le contenu modifié a été appliqué");
  await db.exec(`delete from public.objectifs where user_id = '${A}' and nom like 'Voyage revue%'; delete from public.propositions where id in ('${p1}', '${p2}');`);
  const g = await un(`select p.prosecdef, pg_get_functiondef(p.oid) def from pg_proc p where p.oid = 'public.refuser_propositions(uuid[])'::regprocedure`);
  assert.equal(g.prosecdef, false); assert.match(g.def, /client_id/);
  await session(A);
});

test("propositions : 500 en attente au plus par utilisateur (les décidées ne comptent pas)", async () => {
  await superu();
  await db.exec(`insert into auth.users (id) values ('${E}') on conflict do nothing`);
  await db.query(`insert into public.propositions (user_id, cible, operation, apres, source)
    select $1, 'objectif', 'creer', '{"nom":"x","montant":1,"type":"projet"}', 'Claude' from generate_series(1, 500)`, [E]);
  await db.query(`insert into public.propositions (user_id, cible, operation, apres, source, statut, decide_le)
    select $1, 'objectif', 'creer', '{"nom":"x","montant":1,"type":"projet"}', 'Claude', 'refusee', now() from generate_series(1, 3)`, [E]);
  await session(E);
  await refuse(`insert into public.propositions (cible, operation, apres, source) values ('objectif', 'creer', '{"nom":"x","montant":1,"type":"projet"}', 'Claude')`,
    /500 propositions en attente/, "501e proposition en attente");
  await superu();
  await db.exec(`update public.propositions set statut = 'refusee', decide_le = now() where id = (select id from public.propositions where user_id = '${E}' and statut = 'en_attente' limit 1)`);
  await session(E);
  await db.exec(`insert into public.propositions (cible, operation, apres, source) values ('objectif', 'creer', '{"nom":"x","montant":1,"type":"projet"}', 'Claude')`);
  await superu();
  await db.exec(`delete from public.propositions where user_id = '${E}'`);
  await session(A);
});

test("transactions.position_id composite : un mouvement ne porte jamais sur la ligne d'un autre ; la nuit (apply_recurring) reste compatible", async () => {
  await superu();
  await db.exec(`insert into auth.users (id) values ('${F}') on conflict do nothing`);
  const posF = (await un(`insert into public.positions (user_id, name, envelope, owner, bloc, mode, value) values ('${F}', 'Ligne F2', 'PEA', 'p1', 'Monde', 'manual', 100) returning id`)).id;
  await session(A);
  await refuse(`insert into public.transactions (position_id, date, type, amount) values ('${posF}', '2024-01-03', 'versement', 1)`, /transactions_position/, "ligne d'un autre");
  await superu();
  await refuse(`insert into public.transactions (user_id, position_id, date, type, amount) values ('${A}', '${posF}', '2024-01-03', 'versement', 1)`, /transactions_position/, "même en superutilisateur (service)");
  assert.match((await un(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'transactions_position'`)).d,
    /FOREIGN KEY \(user_id, position_id\) REFERENCES positions\(user_id, id\) ON DELETE CASCADE/);
  assert.equal((await q(`select 1 from pg_constraint where conname = 'transactions_position_id_fkey'`)).length, 0, "l'ancienne clé simple a disparu");
  // apply_recurring ne lit que les lignes du même utilisateur (p.user_id = c.user_id) : la transaction « programme » reste valide
  const def = (await un(`select pg_get_functiondef('public.apply_recurring(date, uuid)'::regprocedure) d`)).d;
  assert.match(def, /p\.user_id = c\.user_id/);
  const tx = (await un(`insert into public.transactions (user_id, position_id, date, type, amount, source) values ('${F}', '${posF}', '2024-01-03', 'programme', 1, 'nightly') returning id`)).id;
  await db.exec(`delete from public.positions where id = '${posF}'`);
  assert.equal((await q(`select 1 from public.transactions where id = $1`, [tx])).length, 0, "cascade de la ligne vers ses mouvements");
  await session(A);
});
